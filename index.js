// dsh-pair-link —— 用手机上的第三方 DSH 远程控制电脑 DSH 会话
//
//  同一份代码两端都跑：
//    · 基础层（两端）：左侧栏「远程电脑」页面、本机会话 API、审批浮层
//    · 远程层（可选）：配置了电脑地址后，页面通过同源 /dsh-pair/remote/api/*
//      代理电脑的 /dsh-pair/api/*，并连一条 WS 接收实时审批
//
//  所以手机端第一次装好、还没配置时页面仍然是可用的：它显示「连接电脑」，
//  保存后立即切到远程视图，不需要重启 DSH。
//
//  零依赖：自带最小 WebSocket 实现（服务端 + 客户端都用运行时自带的）。

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export const name = 'dsh-pair-link'

export const inject = ['webServer']

const VERSION = '0.4.22'
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const APPROVAL_TIMEOUT_MS = 15 * 60_000
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_BODY_BYTES = 16 * 1024 * 1024
const RECONNECT_MS = 5000
const API_PREFIX = '/dsh-pair/api'
const REMOTE_PREFIX = '/dsh-pair/remote'
const PAGE_TOKEN_HEADER = 'x-pair-token'

// 自更新只搬这些文件，且只从本包目录搬
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const PACKAGE_FILES = [
  'index.js',
  'client.js',
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
]

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function configPath() {
  return join(dshHome(), 'dsh-pair-link.json')
}

function readDiskConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDiskConfig(patch) {
  const next = { ...readDiskConfig() }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue
    next[key] = value
  }
  next.updatedAt = new Date().toISOString()
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

function acceptKey(clientKey) {
  return createHash('sha1').update(clientKey + WS_GUID).digest('base64')
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8')
  const n = payload.length
  let header
  if (n < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81
    header[1] = n
  } else if (n < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(n, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(n), 2)
  }
  return Buffer.concat([header, payload])
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        resolve('')
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

function sendJson(res, status, body) {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function cors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type, x-pair-token')
  res.setHeader('access-control-max-age', '600')
  res.setHeader('vary', 'origin')
}

function requestUrl(req) {
  try {
    return new URL(req.url ?? '/', 'http://127.0.0.1')
  } catch {
    return new URL('/', 'http://127.0.0.1')
  }
}

/** 从消息内容块里抽纯文本；未知块给一个可读占位。 */
function blocksText(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const out = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text)
    else if (block.type === 'reasoning') continue
    else if (block.type === 'file') out.push(`[文件${block.attachment?.name ? ` ${block.attachment.name}` : ''}]`)
  }
  return out.join('\n').trim()
}

/** 收集消息里的图片引用，稍后由 readMessages 内联成 base64。 */
function collectImages(content) {
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block && block.type === 'image' && block.attachment) out.push(block.attachment)
  }
  return out
}

/** DSH 会把运行上下文、技能目录等注入成 user/message，手机端不该看到这些。 */
function isInjectedUserEvent(data, text) {
  const source = data?.source
  const kind = source && typeof source.kind === 'string' ? source.kind : ''
  if (kind && kind !== 'user' && kind !== 'api' && kind !== 'remote') return true
  if (text.startsWith('<system-reminder>')) return true
  if (text.startsWith('Current runtime context.')) return true
  if (text.startsWith('Time sampled while')) return true
  return false
}

function blocksReasoning(content) {
  if (!Array.isArray(content)) return ''
  const out = []
  for (const block of content) {
    if (block && block.type === 'reasoning' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join('\n\n').trim()
}

function toDisplayMessage(event) {
  const type = event?.type
  const time = Number(event?.time ?? 0)
  const seq = Number(event?.seq ?? 0)
  if (type === 'user/message') {
    const data = event.data ?? {}
    const content = data.content ?? data.message?.content
    const text = blocksText(content)
    if (isInjectedUserEvent(data, text)) return null
    return { seq, time, role: 'user', text, images: collectImages(content) }
  }
  if (type === 'assistant/message') {
    const data = event.data ?? {}
    const content = data.message?.content ?? data.content
    return {
      seq,
      time,
      role: 'assistant',
      text: blocksText(content),
      reasoning: blocksReasoning(content),
      images: collectImages(content),
    }
  }
  if (type === 'tool/result') {
    const data = event.data ?? {}
    const content = data.message?.content
    const images = collectImages(content)
    if (images.length === 0) return null
    return { seq, time, role: 'tool-image', text: '', images, tool: data.message?.toolCallId ?? '' }
  }
  if (type === 'tool/call') {
    const data = event.data ?? {}
    const name = String(data.name ?? '工具')
    if (name === 'ask_user_question') {
      const questions = parseAskQuestions(data.arguments)
      if (questions.length > 0) {
        return {
          seq,
          time,
          role: 'question',
          text: '',
          callId: String(data.callId ?? ''),
          questions,
        }
      }
    }
    if (name === 'edit' || name === 'write') {
      const args = parseToolArgs(data.arguments)
      const filePath = String(args?.file_path ?? args?.path ?? '')
      if (filePath) {
        const body = String(args?.content ?? args?.new_string ?? '')
        const oldText = String(args?.old_string ?? '')
        const added = body ? body.split('\n').length : 0
        const removed = oldText ? oldText.split('\n').length : 0
        return {
          seq,
          time,
          role: 'file-edit',
          tool: name,
          text: filePath,
          body,
          oldText,
          added,
          removed,
          callId: String(data.callId ?? ''),
        }
      }
    }
    if (name === 'read') {
      const args = parseToolArgs(data.arguments)
      const filePath = String(args?.file_path ?? args?.path ?? '')
      if (filePath) return { seq, time, role: 'tool', text: `读取 · ${fileTail(filePath)}` }
    }
    if (name === 'pwsh') {
      const args = parseToolArgs(data.arguments)
      const desc = String(args?.description ?? '').trim()
      return { seq, time, role: 'tool', text: `运行命令 · ${desc || '命令'}` }
    }
    if (name === 'plugin_manager') {
      const args = parseToolArgs(data.arguments)
      const action = String(args?.action ?? '').trim()
      return { seq, time, role: 'tool', text: `插件 · ${action || '操作'}` }
    }
    return { seq, time, role: 'tool', text: name }
  }
  if (type === 'turn/end') {
    const kind = event.data?.reason?.kind
    if (kind && kind !== 'completed') return { seq, time, role: 'system', text: `本轮结束：${kind}` }
  }
  return null
}

/** 路径最后一段，用于工具行摘要。 */
function fileTail(value) {
  const parts = String(value ?? '').split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : String(value ?? '')
}

/** 解析工具调用的 arguments（字符串或已解析对象）。 */
function parseToolArgs(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

/** 解析 ask_user_question 工具参数里的问题列表（字符串或已解析对象都兼容）。 */
function parseAskQuestions(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const list = Array.isArray(parsed.questions) ? parsed.questions : []
  return list
    .filter((item) => item && typeof item.question === 'string')
    .map((item) => ({
      id: String(item.id ?? ''),
      question: String(item.question ?? ''),
      header: item.header ? String(item.header) : '',
      detail: item.detail ? String(item.detail) : '',
      multiSelect: Boolean(item.multiSelect),
      options: (Array.isArray(item.options) ? item.options : [])
        .filter((option) => option && typeof option.label === 'string')
        .map((option) => ({
          label: String(option.label),
          description: option.description ? String(option.description) : '',
        })),
    }))
}

function compactMessages(rows) {
  const out = []
  let current = null
  for (const row of rows) {
    if (!row) continue
    // 工具调用行只保留名字；没有文字/思考/图片/提问的整条丢弃
    if (
      row.role !== 'tool'
      && row.role !== 'file-edit'
      && !row.text
      && !row.reasoning
      && !(row.images && row.images.length)
      && !(row.questions && row.questions.length)
    ) continue

    if (row.role === 'assistant') {
      // 同一轮里思考段和正文段是多个事件，中间还夹着工具调用，合成一条显示
      if (current) {
        current.text = [current.text, row.text].filter(Boolean).join('\n\n')
        current.reasoning = [current.reasoning, row.reasoning].filter(Boolean).join('\n\n')
        current.images = [...(current.images ?? []), ...(row.images ?? [])]
        current.seq = row.seq
      } else {
        current = row
        out.push(row)
      }
      continue
    }

    if (row.role === 'user' || row.role === 'system' || row.role === 'question') current = null
    out.push(row)
  }
  return out
}

/** 把配置里的电脑地址归一到「HTTP 根 + WS 根 + 桥接令牌」。 */
function resolveRemote(pairUrl, bridgeToken) {
  const raw = String(pairUrl ?? '').trim()
  if (!raw) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null
  const originProtocol = url.protocol === 'wss:' || url.protocol === 'ws:'
    ? (url.protocol === 'wss:' ? 'https:' : 'http:')
    : url.protocol
  let basePath = url.pathname.replace(/\/+$/, '')
  if (basePath.endsWith('/dsh-pair/ws')) basePath = basePath.slice(0, -'/dsh-pair/ws'.length)
  else if (basePath.endsWith('/dsh-pair')) basePath = basePath.slice(0, -'/dsh-pair'.length)
  const httpOrigin = `${originProtocol}//${url.host}${basePath}`
  const wsOrigin = `${originProtocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${basePath}`
  const token = url.searchParams.get('token') ?? url.searchParams.get('auth') ?? String(bridgeToken ?? '')
  return { httpOrigin, wsOrigin, bridgeToken: token }
}

// ---------------------------------------------------------------------------
// 最小 WebSocket（服务端）
// ---------------------------------------------------------------------------
class PairSocket {
  constructor(socket, head) {
    this.socket = socket
    this.buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0)
    this.closed = false
    this._onText = null
    this._onClose = null
    socket.setNoDelay?.(true)
    socket.on('data', (d) => this._feed(d))
    socket.on('close', () => this._finish())
    socket.on('end', () => this._finish())
    socket.on('error', () => this._finish())
    if (this.buffer.length) this._drain()
  }

  get readyState() { return this.closed ? 3 : 1 }
  onText(fn) { this._onText = fn }
  onClose(fn) { this._onClose = fn }

  send(text) {
    if (this.closed) return false
    try { this.socket.write(encodeTextFrame(text)); return true } catch { this._finish(); return false }
  }

  close() {
    if (this.closed) return
    try { this.socket.end(Buffer.from([0x88, 0x00])) } catch { /* ignore */ }
    this._finish()
  }

  _finish() {
    if (this.closed) return
    this.closed = true
    try { this.socket.destroy() } catch { /* ignore */ }
    this._onClose?.()
  }

  _feed(chunk) {
    if (this.closed) return
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk)
    this._drain()
  }

  _drain() {
    while (!this.closed) {
      const b = this.buffer
      if (b.length < 2) return
      const fin = (b[0] & 0x80) !== 0
      const opcode = b[0] & 0x0f
      const masked = (b[1] & 0x80) !== 0
      let len = b[1] & 0x7f
      let offset = 2
      if (len === 126) {
        if (b.length < 4) return
        len = b.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (b.length < 10) return
        const big = b.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME_BYTES)) { this._finish(); return }
        len = Number(big)
        offset = 10
      }
      if (len > MAX_FRAME_BYTES) { this._finish(); return }
      const maskLen = masked ? 4 : 0
      if (b.length < offset + maskLen + len) return
      let payload = b.subarray(offset + maskLen, offset + maskLen + len)
      if (masked) {
        const mask = b.subarray(offset, offset + 4)
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
      }
      this.buffer = b.subarray(offset + maskLen + len)
      if (!fin) { this._finish(); return }
      if (opcode === 0x8) { this.close(); return }
      if (opcode === 0x9) {
        try { this.socket.write(Buffer.from([0x8a, 0x00])) } catch { this._finish() }
        continue
      }
      if (opcode === 0x1) this._onText?.(payload.toString('utf8'))
    }
  }
}

// ---------------------------------------------------------------------------
// 运行状态（host 基础层 + 可选远程层共享）
// ---------------------------------------------------------------------------
function createRuntime(ctx, config, disk) {
  const runtime = {
    startedAt: Date.now(),
    pageToken: String(config?.pageToken ?? '') || String(disk.pageToken ?? '') || randomBytes(18).toString('hex'),
    secret: String(config?.secret ?? '') || String(disk.secret ?? ''),
    wsPath: String(config?.path ?? '/dsh-pair/ws'),
    remote: resolveRemote(
      String(config?.pairUrl ?? '') || String(disk.pairUrl ?? ''),
      String(config?.bridgeToken ?? '') || String(disk.bridgeToken ?? ''),
    ),
    // 电脑前面的远程访问插件（dsh-bridge 等）的访问密码：手机端服务端自己登录换 cookie
    bridgePassword: String(config?.bridgePassword ?? '') || String(disk.bridgePassword ?? ''),
    bridgeCookie: '',
    // 专用隧道：电脑端自己起一条 cloudflared，页面直接显示地址给手机端填
    autoTunnel: (config?.autoTunnel ?? disk.autoTunnel ?? true) !== false,
    cloudflaredPath: String(config?.cloudflaredPath ?? '') || String(disk.cloudflaredPath ?? '') || 'cloudflared',
    publicUrl: '',
    tunnelState: 'off',
    tunnelError: null,
    tunnel: null,
    // GitHub 地址同步：开发期兜底，隧道换地址后手机端从这里拉
    publishToken: String(config?.publishToken ?? '') || String(disk.publishToken ?? ''),
    publishRepo: String(config?.publishRepo ?? '') || String(disk.publishRepo ?? 'Lsty/dsh-pair-link'),
    publishPath: String(config?.publishPath ?? '') || String(disk.publishPath ?? 'endpoint.json'),
    giteeToken: String(config?.giteeToken ?? '') || String(disk.giteeToken ?? ''),
    giteeRepo: String(config?.giteeRepo ?? '') || String(disk.giteeRepo ?? ''),
    giteePath: String(config?.giteePath ?? '') || String(disk.giteePath ?? 'endpoint.json'),
    giteeUser: String(config?.giteeUser ?? '') || String(disk.giteeUser ?? ''),
    publishPrivateKey: String(disk.publishPrivateKey ?? ''),
    publishPublicKey: String(config?.publishPublicKey ?? '') || String(disk.publishPublicKey ?? ''),
    publishStatus: '',
    publishError: null,
    signingKey: null,
    // 端点来源：client 启动时先问 GitHub，失败再退回配置文件
    endpointSource: 'config',
    endpointUpdatedAt: null,
    fallbackRemote: null,
    fallbackTimer: null,
    // host 侧
    clients: new Set(),
    approvals: new Map(),
    questions: new Map(),
    questionsSeen: 0,
    questionsAnswered: 0,
    questionsDelegated: 0,
    connections: 0,
    approvalsSeen: 0,
    approvalsAnswered: 0,
    approvalsDelegated: 0,
    streamed: 0,
    apiCalls: 0,
    // client 侧
    socket: null,
    reconnectTimer: null,
    connected: false,
    lastError: null,
    reconnects: 0,
    stopped: false,
  }

  runtime.broadcast = (payload) => {
    if (runtime.clients.size === 0) return
    const text = JSON.stringify(payload)
    for (const client of runtime.clients) client.send(text)
  }

  runtime.decide = (id, outcome) => {
    const entry = runtime.approvals.get(String(id))
    if (!entry) return false
    entry.resolve(outcome === 'allowed-once' ? 'allowed-once' : 'rejected')
    return true
  }

  return runtime
}

// ---------------------------------------------------------------------------
// 本机会话 API
// ---------------------------------------------------------------------------
function applySessionApi(ctx, runtime) {
  const sessionsOf = () => ctx.get?.('sessions')
  const controllerOf = () => ctx.get?.('sessionController')
  const queryOf = () => ctx.get?.('sessionQuery')

  async function listSessions(signal) {
    const controller = controllerOf()
    const query = queryOf()
    let rows = []

    if (controller?.list) {
      try {
        const value = await controller.list({}, signal)
        rows = Array.isArray(value?.items) ? value.items : []
      } catch (err) {
        ctx.logger?.warn?.('dsh-pair-link: sessionController.list failed: %s', err?.message ?? err)
      }
    }

    if (rows.length === 0 && query?.listSessions) {
      try {
        const records = await query.listSessions(signal)
        rows = (records ?? []).map((record) => ({
          sessionId: record?.header?.id,
          updatedAt: record?.header?.createdAt ?? 0,
          running: false,
          cwd: record?.header?.cwd ?? '',
          agentAvailable: record?.live === true,
        }))
      } catch (err) {
        ctx.logger?.warn?.('dsh-pair-link: sessionQuery.listSessions failed: %s', err?.message ?? err)
      }
    }

    const ids = rows.map((row) => String(row.sessionId ?? '')).filter(Boolean)
    const titles = new Map()
    if (query?.readTitleSnapshots && ids.length > 0) {
      try {
        const results = await query.readTitleSnapshots(ids, signal)
        for (const result of results ?? []) {
          const id = String(result?.sessionId ?? '')
          const title = result?.status === 'fulfilled' ? result.value?.title?.title : ''
          if (id && typeof title === 'string' && title.trim()) titles.set(id, title.trim())
        }
      } catch { /* 标题只是装饰 */ }
    }

    return rows
      .filter((row) => row.sessionId && row.origin !== 'subagent' && !row.parentSessionId)
      .map((row) => {
        const id = String(row.sessionId)
        return {
          id,
          title: titles.get(id) ?? '',
          updatedAt: Number(row.updatedAt ?? 0),
          running: Boolean(row.running),
          cwd: String(row.cwd ?? ''),
          blank: Boolean(row.blank),
        }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 120)
  }

  /** 把消息里的图片引用读成 base64 内联，手机端才能直接显示。 */
  async function inlineImages(messages) {
    const attachments = ctx.get?.('attachments')
    if (!attachments?.readImage) return
    for (const message of messages) {
      if (!Array.isArray(message.images) || message.images.length === 0) continue
      const resolved = []
      for (const ref of message.images) {
        try {
          const stored = await attachments.readImage(ref)
          if (!stored || !stored.data) continue
          if (stored.data.length > 2 * 1024 * 1024) {
            resolved.push({ mediaType: ref.mediaType, tooLarge: true })
            continue
          }
          resolved.push({ mediaType: ref.mediaType, data: Buffer.from(stored.data).toString('base64') })
        } catch { /* 读不到就跳过这张 */ }
      }
      message.images = resolved
    }
  }

  async function readMessages(sessionId, options, signal) {
    const limit = Math.min(Math.max(Number(options?.limit ?? 40), 1), 200)
    const beforeSeq = options?.beforeSeq == null ? undefined : Number(options.beforeSeq)
    const controller = controllerOf()
    const query = queryOf()
    let events = []
    let cursor = null

    if (controller?.events) {
      const page = await controller.events({
        address: { kind: 'session', sessionId },
        maxMessages: limit,
        ...(Number.isFinite(beforeSeq) ? { beforeSeq } : {}),
      }, signal)
      events = (page?.records ?? []).map((record) => record?.event).filter(Boolean)
      cursor = page?.cursor ?? null
    } else if (query?.readSurface) {
      const surface = await query.readSurface(sessionId)
      events = (surface?.events ?? []).slice(-limit)
    } else if (sessionsOf()?.get?.(sessionId)) {
      events = sessionsOf().get(sessionId).snapshotEvents().slice(-limit)
    } else {
      throw new Error('这个 DSH 版本没有可用的会话历史服务')
    }

    const messages = compactMessages(events.map(toDisplayMessage))

    // 有 tool/result 的提问就是已经答过的，没有的才是待回答
    const answered = new Set()
    for (const event of events) {
      if (event?.type === 'tool/result') {
        const callId = event.data?.message?.toolCallId
        if (callId) answered.add(String(callId))
      }
    }
    for (const message of messages) {
      if (message.role === 'question' && message.callId) {
        message.pending = !answered.has(message.callId)
      }
    }

    await inlineImages(messages)
    return { messages, cursor }
  }

  async function promptSession(sessionId, content) {
    const controller = controllerOf()
    if (!controller?.prompt) throw new Error('这个 DSH 版本没有可用的会话写入服务')
    const parts = Array.isArray(content)
      ? content
      : [{ type: 'text', text: String(content ?? '') }]
    await controller.prompt({
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: parts,
    }, AbortSignal.timeout(60_000))
    return { accepted: true }
  }

  /** 手机端附件：base64 图片/文件先落盘到附件服务，再作为一条 prompt 发出去。 */
  async function uploadToSession(sessionId, body) {
    const attachments = ctx.get?.('attachments')
    if (!attachments?.saveImage) throw new Error('这个 DSH 版本没有附件服务')

    const parts = []
    const text = String(body?.text ?? '').trim()
    if (text) parts.push({ type: 'text', text })

    const images = Array.isArray(body?.images) ? body.images.slice(0, 4) : []
    const files = Array.isArray(body?.files) ? body.files.slice(0, 4) : []

    for (const image of images) {
      const data = Buffer.from(String(image?.data ?? ''), 'base64')
      if (data.length === 0) continue
      if (data.length > 8 * 1024 * 1024) throw new Error(`图片 ${image?.name ?? ''} 超过 8MB`)
      const ref = await attachments.saveImage({
        data,
        mediaType: String(image?.mediaType ?? 'image/png'),
        ...(image?.name ? { name: String(image.name) } : {}),
      })
      parts.push({ type: 'image', attachment: ref })
    }

    for (const file of files) {
      const data = Buffer.from(String(file?.data ?? ''), 'base64')
      if (data.length === 0) continue
      if (data.length > 12 * 1024 * 1024) throw new Error(`文件 ${file?.name ?? ''} 超过 12MB`)
      const ref = await attachments.saveFile({
        data,
        ...(file?.name ? { name: String(file.name) } : {}),
      })
      parts.push({ type: 'file', attachment: ref })
    }

    if (parts.length === 0) throw new Error('没有可发送的内容')
    return promptSession(sessionId, parts)
  }

  async function cancelSession(sessionId) {
    const controller = controllerOf()
    if (!controller?.cancel) throw new Error('这个 DSH 版本没有可用的取消接口')
    return controller.cancel({ sessionId })
  }

  async function ensureLiveSession(sessionId) {
    const store = ctx.get?.('sessions')
    let session = store?.get?.(sessionId)
    if (session) return session
    const controller = controllerOf()
    if (controller?.resolveAgent) {
      try { await controller.resolveAgent(sessionId) } catch { /* 冷会话就取不到 */ }
      session = store?.get?.(sessionId)
    }
    return session ?? null
  }

  async function ensureLiveAgent(sessionId) {
    const agents = ctx.get?.('agents')
    let agent = agents?.get?.(sessionId)
    if (agent) return agent
    const controller = controllerOf()
    if (controller?.resolveAgent) {
      try { await controller.resolveAgent(sessionId) } catch { /* ignore */ }
      agent = agents?.get?.(sessionId)
    }
    return agent ?? null
  }

  /** 回答 ask_user_question：把选中的选项交回提问服务。 */
  async function answerQuestion(sessionId, callId, answers) {
    const userQuestions = ctx.get?.('userQuestions')
    if (!userQuestions?.answer) throw new Error('这个 DSH 版本没有提问服务')
    if (!callId) throw new Error('缺少 callId')
    const agent = await ensureLiveAgent(sessionId)
    if (!agent) throw new Error('会话没有加载，暂时不能回答')
    const list = Array.isArray(answers) ? answers : []
    if (list.length === 0) throw new Error('没有回答内容')
    const accepted = userQuestions.answer(agent, callId, {
      answers: list.map((item) => ({
        id: String(item?.id ?? ''),
        selected: Array.isArray(item?.selected) ? item.selected.map(String) : [],
        ...(item?.custom ? { custom: String(item.custom) } : {}),
      })),
    })
    return { accepted: Boolean(accepted) }
  }

  /** 工作区树：工作区（按注册顺序）→ 会话列表。 */
  async function buildTree(signal) {
    const flat = await listSessions(signal)
    const byId = new Map(flat.map((row) => [row.id, row]))
    const registry = ctx.get?.('workspaceRegistry')

    let workspaces = []
    if (registry?.list) {
      try {
        workspaces = registry.list()
          .map((workspace) => ({
            id: String(workspace.id),
            title: workspace.title || basenameOf(workspace.path),
            path: workspace.path,
            sessions: (workspace.sessionIds ?? [])
              .map((id) => byId.get(String(id)))
              .filter(Boolean),
          }))
          .filter((workspace) => workspace.sessions.length > 0)
      } catch (err) {
        ctx.logger?.warn?.('dsh-pair-link: workspaceRegistry.list failed: %s', err?.message ?? err)
      }
    }

    const used = new Set()
    for (const workspace of workspaces) {
      for (const session of workspace.sessions) used.add(session.id)
    }
    const others = flat.filter((row) => !used.has(row.id))
    return { workspaces, others, device: hostname() }
  }

  /** 会话的模型 / 权限 / 运行状态。 */
  async function sessionMeta(sessionId) {
    const controller = controllerOf()
    const session = await ensureLiveSession(sessionId)

    let model = null
    if (session?.requestHeader) {
      try {
        const header = session.requestHeader()
        const config = header?.config
        if (config) {
          model = {
            provider: String(config.provider ?? ''),
            model: String(config.model ?? ''),
            reasoningEffort: config.reasoningEffort ? String(config.reasoningEffort) : null,
          }
        }
      } catch { /* ignore */ }
    }

    let models = null
    try {
      if (controller?.modelCatalog) models = await controller.modelCatalog()
    } catch { /* ignore */ }

    let permission = null
    const presets = ctx.get?.('permissionPresets')
    if (presets && session) {
      try {
        const catalog = presets.catalog()
        permission = {
          current: presets.current(session),
          options: catalog?.options ?? [],
        }
      } catch { /* ignore */ }
    }

    const state = await controller?.state?.({ sessionId }, AbortSignal.timeout(8000)).catch(() => null)

    return {
      ok: true,
      sessionId,
      model,
      models,
      permission,
      running: Boolean(state?.running),
      pendingInput: state?.pendingInput ?? [],
      queue: Array.isArray(state?.queue) ? state.queue : null,
    }
  }

  /** 操作排队中的发言：remove / steer / edit。 */
  async function updateQueue(sessionId, itemId, action) {
    const controller = controllerOf()
    if (!controller?.updateQueue) throw new Error('这个 DSH 版本没有排队管理接口')
    if (!itemId || !action || typeof action.kind !== 'string') throw new Error('缺少 itemId 或 action')
    const result = await controller.updateQueue({ sessionId, itemId, action })
    return { ok: true, ...result }
  }

  async function setSessionModel(sessionId, input) {
    const controller = controllerOf()
    if (!controller?.selectModel) throw new Error('这个 DSH 版本没有可用的模型切换接口')
    const provider = String(input?.provider ?? '')
    const model = String(input?.model ?? '')
    if (!provider || !model) throw new Error('缺少 provider / model')
    const result = await controller.selectModel({
      sessionId,
      provider,
      model,
      ...(input?.reasoningEffort ? { reasoningEffort: String(input.reasoningEffort) } : {}),
    })
    return { ok: true, ...result }
  }

  async function setSessionPermission(sessionId, name) {
    const presets = ctx.get?.('permissionPresets')
    if (!presets?.set) throw new Error('这个 DSH 版本没有可用的权限预设')
    const session = await ensureLiveSession(sessionId)
    if (!session) throw new Error('会话没有加载，暂时不能切换权限')
    presets.set(session, String(name ?? ''))
    return { ok: true, name: String(name ?? '') }
  }

  /** 会话内容搜索（不恢复 Agent）。 */
  async function searchSessions(query) {
    const controller = controllerOf()
    if (!controller?.search) throw new Error('这个 DSH 版本没有搜索接口')
    const result = await controller.search({ query: String(query ?? '') }, AbortSignal.timeout(20_000))
    return {
      items: Array.isArray(result?.items) ? result.items : [],
      hasMore: Boolean(result?.hasMore),
    }
  }

  async function createSession(workspaceId) {
    const controller = controllerOf()
    if (!controller?.create) throw new Error('这个 DSH 版本没有新建会话接口')
    const result = await controller.create({ ...(workspaceId ? { workspaceId } : {}) })
    return { sessionId: result?.sessionId ?? null }
  }

  async function renameSession(sessionId, title) {
    const controller = controllerOf()
    if (!controller?.rename) throw new Error('这个 DSH 版本没有改名接口')
    const result = await controller.rename({ sessionId, title: String(title ?? '') })
    return { title: result?.title ?? String(title ?? '') }
  }

  async function forkSession(sessionId) {
    const controller = controllerOf()
    if (!controller?.fork) throw new Error('这个 DSH 版本没有分叉接口')
    const result = await controller.fork({ sessionId, allowMigration: false })
    return { sessionId: result?.sessionId ?? null }
  }

  async function archiveSession(sessionId, archived) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.archiveSession) throw new Error('这个 DSH 版本没有归档接口')
    const result = archived === false
      ? await workspaces.unarchiveSession({ sessionId })
      : await workspaces.archiveSession({ sessionId })
    return { archivedSessionIds: result?.archivedSessionIds ?? [] }
  }

  async function pinSession(sessionId, pinned) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.pinSession) throw new Error('这个 DSH 版本没有固定接口')
    const result = pinned === false
      ? await workspaces.unpinSession({ sessionId })
      : await workspaces.pinSession({ sessionId })
    return { pinnedSessionIds: result?.pinnedSessionIds ?? [] }
  }

  async function renameWorkspace(workspaceId, title) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.rename) throw new Error('这个 DSH 版本没有工作区改名接口')
    const result = await workspaces.rename({ workspaceId, title: String(title ?? '') })
    return { workspace: result?.workspace ?? null }
  }

  async function deleteWorkspace(workspaceId) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.delete) throw new Error('这个 DSH 版本没有删除工作区接口')
    const result = await workspaces.delete({ workspaceId })
    return { deleted: Boolean(result?.deleted) }
  }

  async function moveWorkspace(workspaceId, beforeWorkspaceId) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.insertBefore) throw new Error('这个 DSH 版本没有工作区排序接口')
    const result = await workspaces.insertBefore({
      workspaceId,
      ...(beforeWorkspaceId ? { beforeWorkspaceId } : {}),
    })
    return { workspaceIds: result?.workspaceIds ?? [] }
  }

  async function moveSession(workspaceId, sessionId, beforeSessionId) {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.insertSessionBefore) throw new Error('这个 DSH 版本没有会话排序接口')
    const result = await workspaces.insertSessionBefore({
      workspaceId,
      sessionId,
      ...(beforeSessionId ? { beforeSessionId } : {}),
    })
    return { ok: true }
  }

  /** 读一个文本文件给页面预览（限制大小）。 */
  function readTextFile(filePath) {
    const resolved = String(filePath ?? '').trim()
    if (!resolved) throw new Error('缺少路径')
    let content = ''
    try {
      content = readFileSync(resolved, 'utf8')
    } catch (err) {
      throw new Error(`读文件失败：${err?.message ?? err}`)
    }
    if (content.length > 400_000) throw new Error('文件太大（超过 400KB），请到电脑上查看')
    return { content, path: resolved }
  }

  /** 读一次工作区 baseline，拿到归档/固定集合。 */
  async function readWorkspaceMarks() {
    const workspaces = ctx.get?.('workspaceController')
    if (!workspaces?.follow) return { archived: [], pinned: [] }
    const controller = new AbortController()
    try {
      for await (const frame of workspaces.follow(controller.signal)) {
        if (frame?.type === 'baseline') {
          const value = frame.value ?? {}
          return {
            archived: Array.isArray(value.archivedSessionIds) ? value.archivedSessionIds : [],
            pinned: Array.isArray(value.pinnedSessionIds) ? value.pinnedSessionIds : [],
          }
        }
        break
      }
    } catch { /* ignore */ } finally {
      try { controller.abort() } catch { /* ignore */ }
    }
    return { archived: [], pinned: [] }
  }

  return {
    listSessions,
    readMessages,
    promptSession,
    cancelSession,
    uploadToSession,
    answerQuestion,
    searchSessions,
    createSession,
    renameSession,
    forkSession,
    archiveSession,
    pinSession,
    renameWorkspace,
    deleteWorkspace,
    moveWorkspace,
    moveSession,
    readTextFile,
    readWorkspaceMarks,
    buildTree,
    sessionMeta,
    updateQueue,
    setSessionModel,
    setSessionPermission,
  }
}

function basenameOf(path) {
  const text = String(path ?? '').replace(/[\\/]+$/, '')
  const parts = text.split(/[\\/]/)
  return parts[parts.length - 1] || text
}

// ---------------------------------------------------------------------------
// host 路由：API / 页面信息 / 配置 / 审批
// ---------------------------------------------------------------------------
function applyHostRoutes(ctx, runtime, sessions) {
  const route = (kind, path, handler) => ctx.effect(() => ctx.webServer.register({ kind, path, handler }))

  // 页面令牌：优先校验注入的 token；本机请求也放行，
  // 这样浏览器缓存了旧 HTML、或 Electron 壳不带 referer 时不会整页 403。
  // 远程（经隧道）请求仍必须带配对密钥，不会被这条放行影响。
  const pageOk = (req) => {
    const header = String(req.headers[PAGE_TOKEN_HEADER] ?? '')
    if (safeEqual(header, runtime.pageToken)) return true
    const remote = String(req.socket?.remoteAddress ?? '')
    const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    if (!local) return false
    const host = String(req.headers.host ?? '')
    const source = String(req.headers.referer ?? req.headers.origin ?? '')
    if (!source) return true
    return Boolean(host) && source.includes(`//${host}`)
  }

  const authorize = (req) => {
    if (pageOk(req)) return 'page'
    const header = String(req.headers[PAGE_TOKEN_HEADER] ?? '')
    if (runtime.secret) {
      if (safeEqual(header, runtime.secret)) return 'pair'
      const candidate = requestUrl(req).searchParams.get('pair') ?? ''
      if (safeEqual(candidate, runtime.secret)) return 'pair'
    }
    return null
  }

  // --- /dsh-pair/api/* ---
  route('prefix', API_PREFIX, async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
    if (!authorize(req)) { sendJson(res, 401, { ok: false, error: 'unauthorized' }); return }

    runtime.apiCalls += 1
    const url = requestUrl(req)
    const rest = url.pathname.slice(API_PREFIX.length) || '/'
    const segments = rest.split('/').filter(Boolean)
    const controller = new AbortController()
    res.on('close', () => controller.abort())

    try {
      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
        sendJson(res, 200, {
          ok: true,
          role: runtime.remote ? 'client' : 'host',
          version: VERSION,
          host: hostname(),
          startedAt: runtime.startedAt,
          clients: runtime.clients.size,
          configured: Boolean(runtime.secret),
          api: API_PREFIX,
        })
        return
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'sessions') {
        const rows = await sessions.listSessions(controller.signal)
        sendJson(res, 200, { ok: true, sessions: rows, clients: runtime.clients.size, now: Date.now() })
        return
      }

      if (req.method === 'POST' && segments.length === 1 && segments[0] === 'sessions') {
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const result = await sessions.createSession(body?.workspaceId ? String(body.workspaceId) : '')
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'search') {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const result = await sessions.searchSessions(url.searchParams.get('q') ?? '')
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'file') {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const result = sessions.readTextFile(url.searchParams.get('path') ?? '')
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'marks') {
        const marks = await sessions.readWorkspaceMarks()
        sendJson(res, 200, { ok: true, ...marks })
        return
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'tree') {
        const tree = await sessions.buildTree(controller.signal)
        sendJson(res, 200, { ok: true, ...tree, now: Date.now() })
        return
      }

      if (req.method === 'POST' && segments.length >= 3 && segments[0] === 'workspaces' && segments[2] === 'rename') {
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const result = await sessions.renameWorkspace(decodeURIComponent(segments[1]), String(body?.title ?? ''))
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'POST' && segments.length >= 3 && segments[0] === 'workspaces' && segments[2] === 'delete') {
        const result = await sessions.deleteWorkspace(decodeURIComponent(segments[1]))
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'POST' && segments.length >= 3 && segments[0] === 'workspaces' && segments[2] === 'move') {
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const result = await sessions.moveWorkspace(
          decodeURIComponent(segments[1]),
          body?.beforeWorkspaceId ? String(body.beforeWorkspaceId) : '',
        )
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (req.method === 'POST' && segments.length >= 3 && segments[0] === 'workspaces' && segments[2] === 'move-session') {
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw || '{}') } catch { body = {} }
        const result = await sessions.moveSession(
          decodeURIComponent(segments[1]),
          String(body?.sessionId ?? ''),
          body?.beforeSessionId ? String(body.beforeSessionId) : '',
        )
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      if (segments[0] === 'sessions' && segments.length >= 2) {
        const sessionId = decodeURIComponent(segments[1])

        if (req.method === 'GET' && segments[2] === 'meta') {
          const meta = await sessions.sessionMeta(sessionId)
          sendJson(res, 200, meta)
          return
        }

        if (req.method === 'GET' && segments[2] === 'messages') {
          const page = await sessions.readMessages(sessionId, {
            limit: url.searchParams.get('limit'),
            beforeSeq: url.searchParams.get('before'),
          }, controller.signal)
          sendJson(res, 200, { ok: true, sessionId, ...page })
          return
        }

        if (req.method === 'POST' && segments[2] === 'model') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.setSessionModel(sessionId, body)
          sendJson(res, 200, result)
          return
        }

        if (req.method === 'POST' && segments[2] === 'permission') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.setSessionPermission(sessionId, body?.name)
          sendJson(res, 200, result)
          return
        }

        if (req.method === 'POST' && segments[2] === 'prompt') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const text = String(body?.text ?? '').trim()
          if (!text) { sendJson(res, 400, { ok: false, error: 'empty text' }); return }
          if (text.length > 40_000) { sendJson(res, 413, { ok: false, error: 'text too long' }); return }
          const result = await sessions.promptSession(sessionId, text)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'upload') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.uploadToSession(sessionId, body)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'answer') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.answerQuestion(sessionId, String(body?.callId ?? ''), body?.answers)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'queue') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.updateQueue(sessionId, String(body?.itemId ?? ''), body?.action)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'rename') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
          const result = await sessions.renameSession(sessionId, String(body?.title ?? ''))
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'fork') {
          const result = await sessions.forkSession(sessionId)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'archive') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw || '{}') } catch { body = {} }
          const result = await sessions.archiveSession(sessionId, body?.archived === false ? false : true)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'pin') {
          const raw = await readBody(req)
          let body
          try { body = JSON.parse(raw || '{}') } catch { body = {} }
          const result = await sessions.pinSession(sessionId, body?.pinned === false ? false : true)
          sendJson(res, 200, { ok: true, ...result })
          return
        }

        if (req.method === 'POST' && segments[2] === 'cancel') {
          const result = await sessions.cancelSession(sessionId)
          sendJson(res, 200, { ok: true, ...result })
          return
        }
      }

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'approvals') {
        const approvals = [...runtime.approvals.entries()].map(([id, entry]) => ({
          id,
          ...entry.info,
          pendingForMs: Date.now() - Number(entry.info?.at ?? Date.now()),
        }))
        sendJson(res, 200, { ok: true, approvals })
        return
      }

      if (req.method === 'POST' && segments[0] === 'approvals' && segments.length === 2) {
        const id = decodeURIComponent(segments[1])
        const raw = await readBody(req)
        let body
        try { body = JSON.parse(raw) } catch { sendJson(res, 400, { ok: false, error: 'bad json' }); return }
        if (!runtime.approvals.has(id)) { sendJson(res, 409, { ok: false, error: 'no such pending approval' }); return }
        const outcome = body?.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
        runtime.decide(id, outcome)
        sendJson(res, 200, { ok: true, id, outcome })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (err) {
      ctx.logger?.warn?.('dsh-pair-link: api %s failed: %s', rest, err?.message ?? err)
      sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  // --- 页面信息 ---
  const pageAuthorized = (req) => {
    if (pageOk(req)) return true
    const header = String(req.headers[PAGE_TOKEN_HEADER] ?? '')
    return runtime.secret ? safeEqual(header, runtime.secret) : false
  }

  route('exact', '/dsh-pair/page-info', (req, res) => {
    cors(res)
    if (!pageAuthorized(req)) { sendJson(res, 403, { ok: false, error: 'bad page token' }); return }
    sendJson(res, 200, {
      ok: true,
      version: VERSION,
      role: runtime.remote ? 'client' : 'host',
      configured: Boolean(runtime.secret),
      linked: Boolean(runtime.remote),
      host: runtime.remote?.httpOrigin ?? '',
      hasSecret: Boolean(runtime.secret),
      hasBridgeToken: Boolean(runtime.remote?.bridgeToken),
      hasBridgePassword: Boolean(runtime.bridgePassword),
      apiBase: runtime.remote ? `${REMOTE_PREFIX}/api` : API_PREFIX,
      connected: runtime.connected,
      lastError: runtime.lastError,
      reconnects: runtime.reconnects,
      clients: runtime.clients.size,
      device: hostname(),
      publicUrl: runtime.publicUrl,
      tunnelState: runtime.tunnelState,
      tunnelError: runtime.tunnelError,
      packageVersion: localPackageVersion(),
      publishable: Boolean(runtime.publishToken),
      publishRepo: runtime.publishRepo,
      publishStatus: runtime.publishStatus,
      publishError: runtime.publishError,
      endpointSource: runtime.endpointSource,
      endpointUpdatedAt: runtime.endpointUpdatedAt,
      giteeRepo: runtime.giteeRepo,
    })
  })

  // --- 自更新：清单 / 文件 ---
  route('exact', '/dsh-pair/pkg/manifest', (req, res) => {
    cors(res)
    if (!authorize(req)) { sendJson(res, 401, { ok: false, error: 'unauthorized' }); return }
    sendJson(res, 200, packageManifest())
  })

  route('exact', '/dsh-pair/pkg/file', (req, res) => {
    cors(res)
    if (!authorize(req)) { sendJson(res, 401, { ok: false, error: 'unauthorized' }); return }
    const rel = requestUrl(req).searchParams.get('path') ?? ''
    const buf = packageFile(rel)
    if (!buf) { sendJson(res, 404, { ok: false, error: 'no such package file' }); return }
    res.statusCode = 200
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('cache-control', 'no-store')
    res.end(buf)
  })

  // --- 自更新：检查 / 执行（只认本机页面令牌，远程密钥不能改手机代码） ---
  route('exact', '/dsh-pair/self-update/check', async (req, res) => {
    cors(res)
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    const local = localPackageVersion()
    if (!runtime.remote) return sendJson(res, 200, { ok: true, local, remote: null, updatable: false })
    try {
      const manifestRes = await fetch(`${runtime.remote.httpOrigin}/dsh-pair/pkg/manifest`, {
        headers: { [PAGE_TOKEN_HEADER]: runtime.secret },
        signal: AbortSignal.timeout(8000),
      })
      if (!manifestRes.ok) {
        return sendJson(res, 200, { ok: true, local, remote: null, updatable: false, error: `电脑返回 HTTP ${manifestRes.status}` })
      }
      const manifest = await manifestRes.json()
      const remote = String(manifest?.version ?? '')
      return sendJson(res, 200, {
        ok: true,
        local,
        remote,
        updatable: Boolean(remote) && remote !== local,
        files: Array.isArray(manifest?.files) ? manifest.files.length : 0,
      })
    } catch (err) {
      return sendJson(res, 200, { ok: true, local, remote: null, updatable: false, error: String(err?.message ?? err) })
    }
  })

  route('exact', '/dsh-pair/self-update/apply', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    try {
      const result = await applySelfUpdate(runtime)
      return sendJson(res, 200, { ...result, local: localPackageVersion(), restartRequired: true })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  // --- GitHub 地址同步：检查当前发布状态 / 手机端拉取 / 电脑端手动发布 ---
  route('exact', '/dsh-pair/api/endpoint', (req, res) => {
    cors(res)
    if (!authorize(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    sendJson(res, 200, {
      ok: true,
      repo: runtime.publishRepo,
      path: runtime.publishPath,
      publicUrl: runtime.publicUrl,
      publishable: Boolean(runtime.publishToken),
      publishStatus: runtime.publishStatus,
      publishError: runtime.publishError,
      publicKey: runtime.publishPrivateKey ? (() => {
        try { return ensureSigningKey(runtime).publicKey } catch { return '' }
      })() : '',
    })
  })

  route('exact', '/dsh-pair/sync-endpoint', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    try {
      const result = await syncEndpoint(ctx, runtime)
      return sendJson(res, 200, { ok: true, ...result })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  route('exact', '/dsh-pair/publish', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    try {
      await publishEndpoint(runtime)
      return sendJson(res, 200, { ok: true, repo: runtime.publishRepo, path: runtime.publishPath, url: runtime.publicUrl })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  // --- 审批链路自测：直接向 approval 服务发一条请求 ---
  route('exact', '/dsh-pair/test-approval', async (req, res) => {
    cors(res)
    if (!authorize(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    const approval = ctx.get?.('approval')
    const agents = ctx.get?.('agents')
    if (!approval?.request) return sendJson(res, 501, { ok: false, error: '这个 DSH 版本没有 approval 服务' })
    const wanted = requestUrl(req).searchParams.get('session') ?? ''
    let agent = wanted ? agents?.get?.(wanted) ?? null : null
    if (!agent) agent = (agents?.list?.() ?? [])[0] ?? null
    if (!agent) return sendJson(res, 409, { ok: false, error: '没有活动 agent' })
    try {
      const outcome = await approval.request({
        agent,
        toolName: 'dsh-pair-link.test',
        reason: '这是插件发出的一条测试审批，用来验证手机端能不能收到并回传。',
      })
      return sendJson(res, 200, { ok: true, outcome, sessionId: agent.id })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  // --- 保存连接配置（立即生效，不需要重启） ---
  route('exact', '/dsh-pair/config', async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    const raw = await readBody(req)
    let body
    try { body = JSON.parse(raw) } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }) }

    const patch = {}
    if (typeof body?.pairUrl === 'string' && body.pairUrl.trim()) patch.pairUrl = body.pairUrl.trim()
    if (typeof body?.secret === 'string' && body.secret.trim()) patch.secret = body.secret.trim()
    if (typeof body?.bridgeToken === 'string' && body.bridgeToken.trim()) patch.bridgeToken = body.bridgeToken.trim()
    if (typeof body?.bridgePassword === 'string' && body.bridgePassword.trim()) patch.bridgePassword = body.bridgePassword.trim()
    if (typeof body?.giteeRepo === 'string' && body.giteeRepo.trim()) patch.giteeRepo = body.giteeRepo.trim()

    const nextRemote = resolveRemote(
      patch.pairUrl ?? runtime.remote?.httpOrigin ?? '',
      patch.bridgeToken ?? runtime.remote?.bridgeToken ?? '',
    )
    if (!nextRemote) {
      return sendJson(res, 400, { ok: false, error: '电脑地址无法解析，请填 https://域名 或 wss://域名/dsh-pair/ws' })
    }

    try {
      writeDiskConfig(patch)
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: `保存到 ${configPath()} 失败：${err?.message ?? err}` })
    }

    if (patch.secret) runtime.secret = patch.secret
    if (patch.bridgePassword) runtime.bridgePassword = patch.bridgePassword
    if (patch.giteeRepo) runtime.giteeRepo = patch.giteeRepo
    runtime.bridgeCookie = ''
    runtime.remote = nextRemote
    runtime.approvals.clear()
    runtime.lastError = null
    runtime.reconnects = 0
    restartPairing(ctx, runtime)

    return sendJson(res, 200, {
      ok: true,
      applied: true,
      host: nextRemote.httpOrigin,
      role: 'client',
    })
  })

  // --- 状态 / 模拟审批 ---
  route('exact', '/dsh-pair/status', (req, res) => {
    cors(res)
    sendJson(res, 200, {
      ok: true,
      plugin: name,
      version: VERSION,
      role: runtime.remote ? 'client' : 'host',
      configured: Boolean(runtime.secret),
      clients: runtime.clients.size,
      pendingApprovals: runtime.approvals.size,
      startedAt: runtime.startedAt,
      connections: runtime.connections,
      approvalsSeen: runtime.approvalsSeen,
      approvalsAnswered: runtime.approvalsAnswered,
      approvalsDelegated: runtime.approvalsDelegated,
      streamed: runtime.streamed,
      apiCalls: runtime.apiCalls,
      connected: runtime.connected,
      reconnects: runtime.reconnects,
      endpointSource: runtime.endpointSource,
      endpointUpdatedAt: runtime.endpointUpdatedAt,
      lastError: runtime.lastError,
      now: Date.now(),
    })
  })

  route('exact', '/dsh-pair/simulate', async (req, res) => {
    cors(res)
    if (runtime.clients.size === 0) { sendJson(res, 409, { ok: false, error: 'no client connected' }); return }
    const id = randomUUID()
    const info = { toolName: 'simulate.write-file', reason: '这是电脑发来的一条测试审批请求，点「允许」或「拒绝」即可。', at: Date.now() }
    const decision = new Promise((resolve) => { runtime.approvals.set(id, { resolve, info }) })
    runtime.broadcast({ type: 'approval', id, ...info })
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 45_000) })
    const outcome = await Promise.race([decision, timeout])
    clearTimeout(timer)
    runtime.approvals.delete(id)
    if (outcome) runtime.approvalsAnswered += 1
    sendJson(res, 200, { ok: true, id, outcome: outcome ?? 'timeout' })
  })

  // --- 手机端审批（页面浮层） ---
  route('exact', '/dsh-pair/inbox', (req, res) => {
    cors(res)
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    sendJson(res, 200, {
      ok: true,
      plugin: name,
      role: runtime.remote ? 'client' : 'host',
      version: VERSION,
      connected: runtime.connected,
      lastError: runtime.lastError,
      host: runtime.remote?.httpOrigin ?? '',
      configured: Boolean(runtime.remote),
      approvals: [...runtime.approvals.entries()].map(([id, entry]) => ({ id, ...entry.info })),
      questions: [...runtime.questions.entries()].map(([id, entry]) => ({
        id,
        callId: entry.callId ?? null,
        questions: entry.questions,
        at: entry.at ?? Date.now(),
      })),
      questionsSeen: runtime.questionsSeen,
      questionsAnswered: runtime.questionsAnswered,
      questionsDelegated: runtime.questionsDelegated,
      approvalsSeen: runtime.approvalsSeen,
      approvalsAnswered: runtime.approvalsAnswered,
      approvalsDelegated: runtime.approvalsDelegated,
      reconnects: runtime.reconnects,
      clients: runtime.clients.size,
      now: Date.now(),
    })
  })

  // --- 手机端回答问题（浮层） ---
  route('exact', '/dsh-pair/answer-question', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    const raw = await readBody(req)
    let body
    try { body = JSON.parse(raw) } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }) }
    const id = String(body?.id ?? '')
    if (!id) return sendJson(res, 400, { ok: false, error: 'missing id' })
    if (!runtime.socket || !runtime.connected) {
      return sendJson(res, 409, { ok: false, error: 'not connected to host' })
    }
    try {
      runtime.socket.send(JSON.stringify({
        type: 'question-answer',
        id,
        answers: Array.isArray(body?.answers) ? body.answers : [],
      }))
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
    runtime.questions.delete(id)
    runtime.questionsAnswered += 1
    return sendJson(res, 200, { ok: true })
  })

  route('exact', '/dsh-pair/decide', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    const raw = await readBody(req)
    let body
    try { body = JSON.parse(raw) } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }) }
    const id = String(body?.id ?? '')
    const outcome = body?.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
    const socket = runtime.socket
    if (!runtime.approvals.has(id)) return sendJson(res, 409, { ok: false, error: 'no such pending approval' })
    if (socket && runtime.connected) {
      try { socket.send(JSON.stringify({ type: 'approval-decision', id, outcome })) } catch { /* fallthrough */ }
    }
    runtime.decide(id, outcome)
    runtime.approvalsAnswered += 1
    return sendJson(res, 200, { ok: true })
  })

  // 本机页面令牌注入
  ctx.effect(() => ctx.webServer.tapIndex((html) =>
    html.replace('</head>', `<script>window.__DSH_PAIR_TOKEN__=${JSON.stringify(runtime.pageToken)}</script></head>`),
  ))
}

// ---------------------------------------------------------------------------
// 远程代理 / 远程 WS 连接
// ---------------------------------------------------------------------------
function restartPairing(ctx, runtime) {
  stopPairing(runtime)
  startPairing(ctx, runtime)
}

function stopPairing(runtime) {
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = null
  }
  if (runtime.fallbackTimer) {
    clearTimeout(runtime.fallbackTimer)
    runtime.fallbackTimer = null
  }
  const socket = runtime.socket
  runtime.socket = null
  runtime.connected = false
  if (socket) {
    try { socket.close() } catch { /* ignore */ }
  }
}

function wsTarget(runtime) {
  if (!runtime.remote || !runtime.secret) return null
  let url
  try { url = new URL(runtime.remote.wsOrigin) } catch { return null }
  url.protocol = runtime.remote.wsOrigin.startsWith('wss:') ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${runtime.wsPath || '/dsh-pair/ws'}`
  url.searchParams.set('pair', runtime.secret)
  if (runtime.remote.bridgeToken) url.searchParams.set('token', runtime.remote.bridgeToken)
  return url.toString()
}

function startPairing(ctx, runtime) {
  if (runtime.stopped || !runtime.remote) return
  if (runtime.reconnectTimer) { clearTimeout(runtime.reconnectTimer); runtime.reconnectTimer = null }

  if (typeof WebSocket === 'undefined') {
    runtime.lastError = '这个运行时没有全局 WebSocket，实时审批不可用（会话面板仍可用）'
    ctx.logger?.warn?.('dsh-pair-link: 宿主运行时没有全局 WebSocket')
    return
  }

  const target = wsTarget(runtime)
  if (!target) {
    runtime.lastError = '还没有配置配对密钥'
    return
  }

  let socket
  try {
    socket = new WebSocket(target)
  } catch (err) {
    runtime.lastError = String(err?.message ?? err)
    scheduleReconnect(ctx, runtime)
    return
  }
  runtime.socket = socket

  socket.addEventListener('open', () => {
    runtime.connected = true
    runtime.lastError = null
    if (runtime.fallbackTimer) {
      clearTimeout(runtime.fallbackTimer)
      runtime.fallbackTimer = null
    }
    runtime.fallbackRemote = null
    ctx.logger?.info?.('dsh-pair-link: connected to host %s', runtime.remote?.httpOrigin ?? '?')
  })

  const queueApproval = (message) => {
    runtime.approvalsSeen += 1
    runtime.approvals.set(String(message.id), {
      resolve: (outcome) => {
        try { socket.send(JSON.stringify({ type: 'approval-decision', id: message.id, outcome })) } catch { /* ignore */ }
        runtime.approvals.delete(String(message.id))
      },
      info: message,
    })
    ctx.logger?.info?.('dsh-pair-link: approval %s (%s) queued', message.id, message.toolName)
  }

  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (message?.type === 'approval') {
      queueApproval(message)
    } else if (message?.type === 'approvals' && Array.isArray(message.items)) {
      for (const item of message.items) {
        if (!item || item.id === undefined) continue
        if (!runtime.approvals.has(String(item.id))) queueApproval(item)
      }
    } else if (message?.type === 'approval-resolved' || message?.type === 'approval-delegated') {
      runtime.approvals.delete(String(message.id))
    } else if (message?.type === 'question') {
      runtime.questionsSeen += 1
      runtime.questions.set(String(message.id), {
        questions: Array.isArray(message.questions) ? message.questions : [],
        callId: message.callId ?? null,
        at: message.at ?? Date.now(),
      })
      ctx.logger?.info?.('dsh-pair-link: question %s queued', message.id)
    } else if (message?.type === 'question-resolved' || message?.type === 'question-delegated') {
      runtime.questions.delete(String(message.id))
    }
  })

  socket.addEventListener('close', () => {
    runtime.connected = false
    if (runtime.socket === socket) runtime.socket = null
    scheduleReconnect(ctx, runtime)
  })
  socket.addEventListener('error', () => { /* close 会跟着来 */ })
}

function scheduleReconnect(ctx, runtime) {
  if (runtime.stopped || runtime.reconnectTimer) return
  runtime.reconnects += 1
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null
    startPairing(ctx, runtime)
  }, RECONNECT_MS)
}

// ---------------------------------------------------------------------------
// 专用隧道：电脑端自己起一条 cloudflared，把地址显示给手机端
// ---------------------------------------------------------------------------
function tunnelStatePath() {
  return join(dshHome(), 'dsh-pair-link-tunnel.json')
}

function readTunnelState() {
  try {
    return JSON.parse(readFileSync(tunnelStatePath(), 'utf8'))
  } catch {
    return null
  }
}

function writeTunnelState(patch) {
  try {
    const current = readTunnelState() ?? {}
    writeFileSync(tunnelStatePath(), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, 'utf8')
  } catch { /* ignore */ }
}

function pidAlive(pid) {
  const value = Number(pid)
  if (!Number.isInteger(value) || value <= 0) return false
  try {
    process.kill(value, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 插件重载时不要换隧道：上次那个 cloudflared 还活着就复用它的地址，
 * 否则每次重载都会把手机端甩到一个已经不存在的 URL 上。
 */
function reuseTunnelIfAny(runtime, origin) {
  const saved = readTunnelState()
  if (!saved || !saved.url || !saved.pid) return false
  if (!pidAlive(saved.pid)) return false
  if (saved.origin && saved.origin !== origin) {
    try { process.kill(Number(saved.pid)) } catch { /* ignore */ }
    return false
  }
  runtime.publicUrl = String(saved.url)
  runtime.tunnelState = 'ready'
  runtime.tunnelReused = true
  return true
}

function startQuickTunnel(ctx, runtime) {
  if (!runtime.autoTunnel || runtime.tunnel || runtime.stopped) return
  if (runtime.remote) return // 已是对端（手机），不需要再暴露自己
  if (process.platform === 'android' || process.platform === 'ios') return

  let origin
  try {
    origin = ctx.webServer.getOrigin()
  } catch {
    return
  }

  if (reuseTunnelIfAny(runtime, origin)) {
    ctx.logger?.info?.('dsh-pair-link: 复用现有隧道 %s（重载不换地址）', runtime.publicUrl)
    void publishEndpoint(runtime).catch((err) => {
      runtime.publishError = String(err?.message ?? err)
    })
    return
  }

  let child
  try {
    child = spawn(runtime.cloudflaredPath, ['tunnel', '--url', origin, '--no-autoupdate'], {
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    runtime.tunnelState = 'error'
    runtime.tunnelError = String(err?.message ?? err)
    ctx.logger?.warn?.('dsh-pair-link: 专用隧道启动失败：%s', runtime.tunnelError)
    return
  }
  child.unref?.()

  runtime.tunnel = child
  runtime.tunnelState = 'starting'
  runtime.tunnelError = null
  writeTunnelState({ pid: child.pid, origin, url: null, startedAt: Date.now() })
  let settled = false

  const scan = (chunk) => {
    const text = String(chunk)
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)
    if (match && !settled) {
      settled = true
      runtime.publicUrl = match[0]
      runtime.tunnelState = 'ready'
      if (runtime.tunnelTimer) { clearTimeout(runtime.tunnelTimer); runtime.tunnelTimer = null }
      writeTunnelState({ pid: child.pid, origin, url: runtime.publicUrl, startedAt: Date.now() })
      ctx.logger?.info?.('dsh-pair-link: 专用隧道就绪 %s', runtime.publicUrl)
      void publishEndpoint(runtime).catch((err) => {
        runtime.publishError = String(err?.message ?? err)
        ctx.logger?.warn?.('dsh-pair-link: 地址发布失败：%s', runtime.publishError)
      })
    }
    if (!settled && /failed to|unauthorized|error/i.test(text)) {
      runtime.tunnelError = text.trim().slice(0, 240)
    }
  }
  child.stdout?.on('data', scan)
  child.stderr?.on('data', scan)
  child.on('error', (err) => {
    runtime.tunnelState = 'error'
    runtime.tunnelError = String(err?.message ?? err)
  })
  child.on('exit', (code) => {
    if (runtime.tunnel === child) runtime.tunnel = null
    if (runtime.tunnelState !== 'error') runtime.tunnelState = 'stopped'
    ctx.logger?.warn?.('dsh-pair-link: 专用隧道退出（code=%s）', code)
  })

  runtime.tunnelTimer = setTimeout(() => {
    if (!settled && runtime.tunnelState === 'starting') {
      runtime.tunnelState = 'error'
      runtime.tunnelError = '45 秒内没有拿到公网地址（cloudflared 可能被墙或未安装）'
    }
  }, 45_000)
}

function stopTunnel(runtime) {
  if (runtime.tunnelTimer) {
    clearTimeout(runtime.tunnelTimer)
    runtime.tunnelTimer = null
  }
  // 故意不杀 cloudflared：重载后新实例复用同一地址，避免手机端被甩掉。
  runtime.tunnel = null
  runtime.tunnelState = 'off'
  runtime.publicUrl = ''
}

// ---------------------------------------------------------------------------
// 自更新：电脑端提供包清单/文件，手机端自己拉取替换
// ---------------------------------------------------------------------------
function localPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return String(pkg.version ?? VERSION)
  } catch {
    return VERSION
  }
}

function packageManifest() {
  const files = []
  for (const rel of PACKAGE_FILES) {
    try {
      const buf = readFileSync(join(PACKAGE_ROOT, rel))
      files.push({
        path: rel,
        sha256: createHash('sha256').update(buf).digest('hex'),
        size: buf.length,
      })
    } catch { /* 缺文件就跳过 */ }
  }
  return { ok: true, version: localPackageVersion(), files }
}

function packageFile(rel) {
  if (!PACKAGE_FILES.includes(rel)) return null
  try {
    return readFileSync(join(PACKAGE_ROOT, rel))
  } catch {
    return null
  }
}

async function applySelfUpdate(runtime) {
  if (!runtime.remote) throw new Error('还没有配置电脑地址')
  if (!runtime.secret) throw new Error('还没有配置配对密钥')
  const base = runtime.remote.httpOrigin
  const headers = { [PAGE_TOKEN_HEADER]: runtime.secret }

  const manifestRes = await fetch(`${base}/dsh-pair/pkg/manifest`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  if (!manifestRes.ok) throw new Error(`电脑返回 HTTP ${manifestRes.status}`)
  const manifest = await manifestRes.json()
  const files = Array.isArray(manifest?.files) ? manifest.files : []
  if (files.length === 0) throw new Error('电脑没有提供可更新的文件')

  const downloaded = []
  for (const file of files) {
    if (!PACKAGE_FILES.includes(file.path)) continue
    const res = await fetch(`${base}/dsh-pair/pkg/file?path=${encodeURIComponent(file.path)}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`下载 ${file.path} 失败：HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const sha = createHash('sha256').update(buf).digest('hex')
    if (sha !== file.sha256) throw new Error(`${file.path} 校验失败，已放弃更新`)
    downloaded.push({ path: file.path, buf })
  }
  if (downloaded.length === 0) throw new Error('没有可用的文件')

  // 先备份再覆盖：中途失败时旧文件还在备份目录里
  const backupDir = join(PACKAGE_ROOT, `.backup-${Date.now()}`)
  mkdirSync(backupDir, { recursive: true })
  for (const item of downloaded) {
    try {
      copyFileSync(join(PACKAGE_ROOT, item.path), join(backupDir, item.path.replace(/[\\/]/g, '_')))
    } catch { /* 本地还没有这个文件 */ }
  }
  for (const item of downloaded) {
    const full = join(PACKAGE_ROOT, item.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, item.buf)
  }

  return {
    ok: true,
    version: String(manifest?.version ?? ''),
    files: downloaded.map((item) => item.path),
    backup: backupDir,
  }
}

// ---------------------------------------------------------------------------
// GitHub 地址同步：电脑发布（带 ed25519 签名），手机连不上时来拉
// ---------------------------------------------------------------------------
function endpointPayload(device, url, ts) {
  return `${device ?? ''}|${url ?? ''}|${ts ?? ''}`
}

function ensureSigningKey(runtime) {
  if (runtime.signingKey) return runtime.signingKey
  let pem = runtime.publishPrivateKey
  if (!pem) {
    const pair = generateKeyPairSync('ed25519')
    pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    runtime.publishPrivateKey = pem
    try { writeDiskConfig({ publishPrivateKey: pem }) } catch { /* ignore */ }
    runtime.signingKey = {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }
    return runtime.signingKey
  }
  try {
    const privateKey = createPrivateKey(pem)
    runtime.signingKey = {
      privateKey,
      publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(),
    }
    return runtime.signingKey
  } catch {
    runtime.signingKey = null
    throw new Error('本机签名私钥损坏：删掉配置里的 publishPrivateKey 再试')
  }
}

function signedEndpoint(runtime) {
  const key = ensureSigningKey(runtime)
  const device = hostname()
  const ts = Date.now()
  const sig = sign(null, Buffer.from(endpointPayload(device, runtime.publicUrl, ts)), key.privateKey).toString('base64')
  return { device, url: runtime.publicUrl, ts, publicKey: key.publicKey, sig }
}

async function publishToGitHub(runtime) {
  const body = signedEndpoint(runtime)
  const api = `https://api.github.com/repos/${runtime.publishRepo}/contents/${runtime.publishPath}`
  const headers = {
    authorization: `Bearer ${runtime.publishToken}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'dsh-pair-link',
    'x-github-api-version': '2022-11-28',
  }

  let sha
  try {
    const current = await fetch(api, { headers, signal: AbortSignal.timeout(8000) })
    if (current.ok) {
      const json = await current.json()
      sha = json?.sha
    }
  } catch { /* 当作新文件 */ }

  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'chore: publish dsh-pair-link endpoint',
      content: Buffer.from(`${JSON.stringify(body, null, 2)}\n`).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`GitHub 发布失败：HTTP ${res.status}`)
}

async function publishToGitee(runtime) {
  const body = signedEndpoint(runtime)
  const content = Buffer.from(`${JSON.stringify(body, null, 2)}\n`).toString('base64')
  const token = encodeURIComponent(runtime.giteeToken)
  const base = `https://gitee.com/api/v5/repos/${runtime.giteeRepo}/contents/${runtime.giteePath}`

  let sha
  try {
    const current = await fetch(`${base}?access_token=${token}`, { signal: AbortSignal.timeout(8000) })
    if (current.ok) {
      const json = await current.json()
      sha = json?.sha
    }
  } catch { /* 当作新文件 */ }

  const res = await fetch(`${base}?access_token=${token}`, {
    method: sha ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'dsh-pair-link' },
    body: JSON.stringify({
      content,
      message: 'chore: publish dsh-pair-link endpoint',
      ...(sha ? { sha } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 120) } catch { /* ignore */ }
    throw new Error(`Gitee 发布失败：HTTP ${res.status} ${detail}`)
  }
}

/** 电脑端拿到新隧道地址后，把签名端点写到所有已配置的仓库。 */
async function publishEndpoint(runtime) {
  if (!runtime.publicUrl) return
  const targets = []
  if (runtime.publishToken && runtime.publishRepo) targets.push({ name: 'GitHub', run: publishToGitHub(runtime) })
  if (runtime.giteeToken && runtime.giteeRepo) targets.push({ name: 'Gitee', run: publishToGitee(runtime) })
  if (targets.length === 0) return

  const results = await Promise.allSettled(targets.map((target) => target.run))
  const done = []
  const failed = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') done.push(targets[index].name)
    else failed.push(`${targets[index].name}: ${result.reason?.message ?? result.reason}`)
  })
  if (done.length > 0) runtime.publishStatus = `已发布 ${done.join(' + ')} ${new Date().toISOString()}`
  runtime.publishError = failed.length > 0 ? failed.join('；') : null
}

/**
 * 多个源并行读端点文件：手机网络到 api.github.com 可能不通，
 * 镜像源（ghfast / gitmirror）通常可达。谁先成功用谁。
 */
function endpointSources(runtime) {
  const repo = runtime.publishRepo || 'Lsty/dsh-pair-link'
  const path = runtime.publishPath || 'endpoint.json'
  const sources = []
  if (runtime.giteeRepo) {
    // Gitee raw 国内直连，作为第一优先
    sources.push(`https://gitee.com/${runtime.giteeRepo}/raw/main/${runtime.giteePath || 'endpoint.json'}`)
  }
  sources.push(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=main`,
    `https://ghfast.top/https://raw.githubusercontent.com/${repo}/main/${path}`,
    `https://raw.gitmirror.com/${repo}/main/${path}`,
    `https://raw.githubusercontent.com/${repo}/main/${path}`,
  )
  return sources
}

async function fetchEndpointFromGitHub(runtime) {
  const sources = endpointSources(runtime)

  const loadOne = async (url) => {
    const isApi = url.includes('api.github.com')
    const res = await fetch(url, {
      headers: isApi
        ? { accept: 'application/vnd.github+json', 'user-agent': 'dsh-pair-link' }
        : { 'user-agent': 'dsh-pair-link' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    let endpoint
    if (isApi) {
      const json = JSON.parse(text)
      endpoint = JSON.parse(Buffer.from(String(json?.content ?? ''), 'base64').toString('utf8'))
    } else {
      endpoint = JSON.parse(text)
    }
    if (!endpoint || typeof endpoint.url !== 'string' || endpoint.url.length === 0) {
      throw new Error('地址文件缺少 url')
    }
    // 旧文件可能没有签名字段；有就必须验过
    if (endpoint.publicKey && endpoint.sig && endpoint.ts !== undefined) {
      let ok = false
      try {
        ok = verify(
          null,
          Buffer.from(endpointPayload(endpoint.device, endpoint.url, endpoint.ts)),
          createPublicKey(endpoint.publicKey),
          Buffer.from(String(endpoint.sig), 'base64'),
        )
      } catch {
        ok = false
      }
      if (!ok) throw new Error('签名校验失败，地址可能被改过')
      if (runtime.publishPublicKey && runtime.publishPublicKey !== endpoint.publicKey) {
        throw new Error('公钥和上次记录的不一致，拒绝使用')
      }
      if (!runtime.publishPublicKey) {
        runtime.publishPublicKey = endpoint.publicKey
        try { writeDiskConfig({ publishPublicKey: endpoint.publicKey }) } catch { /* ignore */ }
      }
    }
    return endpoint
  }

  try {
    return await Promise.any(sources.map((url) => loadOne(url)))
  } catch (err) {
    const detail = err && err.errors
      ? err.errors.map((item) => item?.message ?? String(item)).join('；')
      : String(err?.message ?? err)
    throw new Error(`所有端点源都失败：${detail}`)
  }
}

function endpointStamp(endpoint) {
  const ts = Number(endpoint?.ts)
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date().toISOString()
}

/** client 启动时先问 GitHub，失败就沿用配置文件里的地址，并把原因记进 lastError。 */
async function bootstrapEndpoint(ctx, runtime) {
  const previous = runtime.remote
  try {
    const endpoint = await fetchEndpointFromGitHub(runtime)
    const next = resolveRemote(endpoint.url, runtime.remote?.bridgeToken ?? '')
    if (!next) throw new Error('GitHub 上的地址无法解析')
    const changed = next.httpOrigin !== (previous?.httpOrigin ?? '')
    runtime.remote = next
    runtime.endpointSource = 'github'
    runtime.endpointUpdatedAt = endpointStamp(endpoint)
    runtime.lastError = null
    if (changed) {
      try { writeDiskConfig({ pairUrl: endpoint.url }) } catch (err) {
        ctx.logger?.warn?.('dsh-pair-link: 写入新 pairUrl 失败：%s', err?.message ?? err)
      }
      // 新地址连不上就退回配置里的旧地址，不让手机卡死在一个失效端点上
      runtime.fallbackRemote = previous
      if (runtime.fallbackTimer) clearTimeout(runtime.fallbackTimer)
      runtime.fallbackTimer = setTimeout(() => {
        runtime.fallbackTimer = null
        if (runtime.connected || runtime.endpointSource !== 'github') return
        if (!runtime.fallbackRemote) return
        runtime.remote = runtime.fallbackRemote
        runtime.fallbackRemote = null
        runtime.endpointSource = 'config'
        runtime.lastError = `GitHub 地址连不上，已回退到配置地址 ${runtime.remote.httpOrigin}`
        ctx.logger?.warn?.('dsh-pair-link: %s', runtime.lastError)
        restartPairing(ctx, runtime)
      }, 12_000)
    }
    ctx.logger?.info?.('dsh-pair-link: 端点来自 GitHub %s（%s）', endpoint.url, changed ? '已更新' : '未变化')
  } catch (err) {
    runtime.endpointSource = 'config'
    runtime.endpointUpdatedAt = null
    runtime.lastError = `GitHub 端点读取失败，沿用配置地址：${err?.message ?? err}`
    ctx.logger?.warn?.('dsh-pair-link: %s', runtime.lastError)
  }
  if (runtime.remote) startPairing(ctx, runtime)
}

async function syncEndpoint(ctx, runtime) {
  const endpoint = await fetchEndpointFromGitHub(runtime)
  const next = resolveRemote(endpoint.url, runtime.remote?.bridgeToken ?? '')
  if (!next) throw new Error('地址无法解析')
  runtime.remote = next
  runtime.endpointSource = 'github'
  runtime.endpointUpdatedAt = endpointStamp(endpoint)
  runtime.lastError = null
  runtime.reconnects = 0
  try { writeDiskConfig({ pairUrl: endpoint.url }) } catch { /* ignore */ }
  restartPairing(ctx, runtime)
  return { url: endpoint.url, device: endpoint.device, ts: endpoint.ts }
}

/** 电脑前面有 dsh-bridge 之类的登录墙时，用访问密码换一个会话 cookie。 */
async function ensureBridgeCookie(runtime) {  if (!runtime.bridgePassword || !runtime.remote) return ''
  if (runtime.bridgeCookie) return runtime.bridgeCookie
  let res
  try {
    res = await fetch(`${runtime.remote.httpOrigin}/__dsh_bridge__/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: runtime.bridgePassword }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new Error(`登录电脑前面的远程访问插件失败：${err?.message ?? err}`)
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = String(body.error)
    } catch { /* ignore */ }
    throw new Error(`电脑前的远程访问插件拒绝了这个密码：${message}`)
  }
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  for (const cookie of cookies) {
    const match = /(?:^|;\s*)dsh_bridge_auth=([^;]+)/.exec(String(cookie ?? ''))
    if (match) {
      runtime.bridgeCookie = `dsh_bridge_auth=${match[1]}`
      return runtime.bridgeCookie
    }
  }
  throw new Error('登录成功但没拿到会话 cookie')
}

function applyProxy(ctx, runtime) {
  const route = (kind, path, handler) => ctx.effect(() => ctx.webServer.register({ kind, path, handler }))

  route('prefix', REMOTE_PREFIX, async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
    if (!pageOk(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    if (!runtime.remote) return sendJson(res, 400, { ok: false, error: '还没有配置电脑地址' })
    if (!runtime.secret) return sendJson(res, 400, { ok: false, error: '还没有配置配对密钥' })

    runtime.apiCalls += 1
    const url = requestUrl(req)
    const rest = url.pathname.slice(REMOTE_PREFIX.length) || '/'
    if (!rest.startsWith('/api')) return sendJson(res, 404, { ok: false, error: 'not found' })

    let target
    try {
      // rest 是 `/api/...`，必须补回 `/dsh-pair` 前缀，否则打到 DSH 自己的 /api 网关
      target = new URL(`${runtime.remote.httpOrigin}/dsh-pair${rest}${url.search}`)
    } catch {
      return sendJson(res, 400, { ok: false, error: 'bad target url' })
    }
    if (runtime.remote.bridgeToken) target.searchParams.set('token', runtime.remote.bridgeToken)

    let body
    if (req.method !== 'GET' && req.method !== 'HEAD') body = await readBody(req)
    const headers = { [PAGE_TOKEN_HEADER]: runtime.secret }
    if (body) headers['content-type'] = 'application/json'

    let cookie = ''
    if (runtime.bridgePassword) {
      try {
        cookie = await ensureBridgeCookie(runtime)
      } catch (err) {
        return sendJson(res, 502, { ok: false, error: String(err?.message ?? err) })
      }
    }

    const forward = async (cookieValue) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      try {
        return await fetch(target, {
          method: req.method,
          headers: cookieValue ? { ...headers, cookie: cookieValue } : headers,
          body: body || undefined,
          signal: controller.signal,
          redirect: 'manual',
        })
      } finally {
        clearTimeout(timer)
      }
    }

    let upstream
    try {
      upstream = await forward(cookie)
      // cookie 过期或电脑重启过：清掉重登一次
      if (upstream.status === 401 && cookie && runtime.bridgePassword) {
        runtime.bridgeCookie = ''
        try {
          cookie = await ensureBridgeCookie(runtime)
          upstream = await forward(cookie)
        } catch { /* 保留第一次的 401 响应 */ }
      }
    } catch (err) {
      return sendJson(res, 502, { ok: false, error: `无法连接电脑：${err?.message ?? err}` })
    }

    let text = ''
    try { text = await upstream.text() } catch { /* ignore */ }
    let parsed = null
    try { parsed = JSON.parse(text) } catch { /* not json */ }
    if (parsed && typeof parsed === 'object') {
      return sendJson(res, upstream.status, parsed)
    }
    // 电脑前面若还挡着 dsh-bridge 登录页，这里给出能看懂的提示
    const hint = upstream.status === 401
      ? '电脑前面的远程访问插件要求登录：请把它的免密令牌填到「桥接令牌」，或在电脑上放行 /dsh-pair/api。'
      : text.slice(0, 400) || `电脑返回 HTTP ${upstream.status}`
    return sendJson(res, upstream.status >= 400 ? upstream.status : 502, { ok: false, error: hint })
  })
}

// ---------------------------------------------------------------------------
// WS 服务端 + 审批桥
// ---------------------------------------------------------------------------
function applyPairingServer(ctx, runtime) {
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: runtime.wsPath,
    handler(req, socket, head) {
      const url = requestUrl(req)
      const pair = url.searchParams.get('pair') ?? url.searchParams.get('token') ?? ''
      const key = req.headers['sec-websocket-key']
      if (!runtime.secret || !safeEqual(pair, runtime.secret) || typeof key !== 'string') {
        try { socket.destroy() } catch { /* ignore */ }
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      )

      const peer = new PairSocket(socket, head)
      runtime.clients.add(peer)
      runtime.connections += 1
      ctx.logger?.info?.('dsh-pair-link: client connected (%d total)', runtime.clients.size)

      peer.onClose(() => {
        runtime.clients.delete(peer)
        ctx.logger?.info?.('dsh-pair-link: client disconnected (%d left)', runtime.clients.size)
      })

      peer.onText((text) => {
        let message
        try { message = JSON.parse(text) } catch { return }
        if (message?.type === 'approval-decision') runtime.decide(String(message.id ?? ''), message.outcome)
        if (message?.type === 'question-answer') {
          const entry = runtime.questions.get(String(message.id ?? ''))
          if (entry) entry.resolve({ answers: Array.isArray(message.answers) ? message.answers : [] })
        }
      })

      peer.send(JSON.stringify({ type: 'hello', role: 'host', version: VERSION, at: Date.now() }))
      // 断线重连后把还没处理的审批补发一遍，否则手机端永远看不到
      if (runtime.approvals.size > 0) {
        const items = [...runtime.approvals.entries()].map(([id, entry]) => ({ id, ...entry.info }))
        peer.send(JSON.stringify({ type: 'approvals', items }))
      }
    },
  }))

  ctx.effect(() => () => {
    for (const client of runtime.clients) client.close()
    runtime.clients.clear()
    runtime.approvals.clear()
  })
}

// ---------------------------------------------------------------------------
// 提问桥：用户提问走 user-questions/request waterfall
// ---------------------------------------------------------------------------
function normalizeQuestions(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.question === 'string')
    .map((item) => ({
      id: String(item.id ?? ''),
      question: String(item.question ?? ''),
      header: item.header ? String(item.header) : '',
      detail: item.detail ? String(item.detail) : '',
      multiSelect: Boolean(item.multiSelect),
      options: (Array.isArray(item.options) ? item.options : [])
        .filter((option) => option && typeof option.label === 'string')
        .map((option) => ({
          label: String(option.label),
          description: option.description ? String(option.description) : '',
        })),
    }))
}

/**
 * 插件刚重载时手机还在重连，这段窗口里审批/提问别急着交回原生，
 * 等最多几秒让客户端回来，否则手机端整条请求都看不到。
 */
async function waitForClients(runtime, timeoutMs) {
  if (runtime.clients.size > 0) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (runtime.stopped) return false
    if (runtime.clients.size > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return runtime.clients.size > 0
}

function applyQuestionBridge(ctx, runtime) {
  const handler = async (request, next) => {
    if (runtime.stopped) return next()
    if (runtime.clients.size === 0 && !(await waitForClients(runtime, 6_000))) return next()
    const questions = normalizeQuestions(request?.questions)
    if (questions.length === 0) return next()

    runtime.questionsSeen += 1
    const id = randomUUID()
    const callId = request?.wait?.callId ? String(request.wait.callId) : null
    const at = Date.now()

    const answer = new Promise((resolve) => {
      runtime.questions.set(id, { resolve, request, questions, callId, at })
      runtime.broadcast({ type: 'question', id, callId, questions, at })
    })

    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 180_000) })
    let onAbort = null
    const aborted = new Promise((resolve) => {
      if (!request?.signal) return
      if (request.signal.aborted) return resolve(null)
      onAbort = () => resolve(null)
      request.signal.addEventListener('abort', onAbort, { once: true })
    })

    const result = await Promise.race([answer, timeout, aborted])
    clearTimeout(timer)
    if (onAbort && request?.signal) request.signal.removeEventListener('abort', onAbort)
    runtime.questions.delete(id)

    if (result && Array.isArray(result.answers) && result.answers.length > 0) {
      runtime.questionsAnswered += 1
      runtime.broadcast({ type: 'question-resolved', id })
      return { answers: result.answers }
    }
    runtime.questionsDelegated += 1
    runtime.broadcast({ type: 'question-delegated', id })
    return next()
  }

  ctx.effect(() => {
    try {
      const rootCtx = ctx.root ?? ctx
      const off = rootCtx.on('user-questions/request', handler, { prepend: true })
      ctx.logger?.info?.('dsh-pair-link: question bridge attached at root')
      return () => { try { off() } catch { /* ignore */ } }
    } catch (err) {
      ctx.logger?.warn?.('dsh-pair-link: question bridge attach failed: %s', err?.message ?? err)
      return undefined
    }
  })

  ctx.effect(() => () => {
    for (const [, entry] of runtime.questions) {
      try { entry.resolve(null) } catch { /* ignore */ }
    }
    runtime.questions.clear()
  })
}

function applyApprovalBridge(ctx, runtime) {
  const probe = (line) => {
    try {
      appendFileSync(join(dshHome(), 'pair-scope-probe.log'), `${new Date().toISOString()} ${line}\n`)
    } catch { /* ignore */ }
  }
  const handler = async (request, next) => {
    // 热重载会留下旧实例的 root 监听器，它们只该把请求交回原生 answerer
    if (runtime.stopped) return next()
    probe(`FIRED tool=${request?.toolName ?? '?'} clients=${runtime.clients.size}`)
    try {
      if (runtime.clients.size === 0 && !(await waitForClients(runtime, 6_000))) return next()
      runtime.approvalsSeen += 1
      const id = randomUUID()
      const info = {
        toolName: request?.toolName ?? request?.call?.name ?? '',
        reason: request?.reason ?? '',
        displayReason: request?.displayReason ?? null,
        callId: request?.callId ?? null,
        sessionId: request?.agent?.id ?? null,
        at: Date.now(),
      }

      const decision = new Promise((resolve) => {
        runtime.approvals.set(id, { resolve, info })
        runtime.broadcast({ type: 'approval', id, ...info })
      })

      let timer
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), APPROVAL_TIMEOUT_MS) })
      let onAbort = null
      const aborted = new Promise((resolve) => {
        if (!request?.signal) return
        if (request.signal.aborted) return resolve(null)
        onAbort = () => resolve(null)
        request.signal.addEventListener('abort', onAbort, { once: true })
      })

      const outcome = await Promise.race([decision, timeout, aborted])
      clearTimeout(timer)
      if (onAbort && request?.signal) request.signal.removeEventListener('abort', onAbort)
      runtime.approvals.delete(id)

      if (outcome === 'allowed-once' || outcome === 'rejected') {
        runtime.approvalsAnswered += 1
        runtime.broadcast({ type: 'approval-resolved', id, outcome })
        return outcome
      }
      runtime.approvalsDelegated += 1
      runtime.broadcast({ type: 'approval-delegated', id, reason: 'timeout-or-abort' })
      return next()
    } catch (err) {
      ctx.logger?.warn?.('dsh-pair-link: approval bridge error: %s', err?.message ?? err)
      return next()
    }
  }

  // 只挂在 root 上：prepend 之后的 root 监听器能收到所有 agent 的审批请求。
  // 用 ctx.effect 持有 disposer，否则每次重载都会在 root 上多留一个监听器。
  ctx.effect(() => {
    try {
      const rootCtx = ctx.root ?? ctx
      const off = rootCtx.on('approval/request', handler, { prepend: true })
      probe('ROOT_ATTACHED')
      ctx.logger?.info?.('dsh-pair-link: approval bridge attached at root')
      return () => { try { off() } catch { /* ignore */ } }
    } catch (err) {
      probe(`ROOT_FAIL ${err?.message ?? err}`)
      ctx.logger?.warn?.('dsh-pair-link: approval bridge attach failed: %s', err?.message ?? err)
      return undefined
    }
  })

  ctx.effect(() => ctx.on('agent/assistant-stream', (payload) => {
    if (runtime.clients.size === 0) return
    runtime.streamed += 1
    runtime.broadcast({
      type: 'assistant-stream',
      sessionId: payload?.agent?.id ?? null,
      frame: payload?.frame ?? null,
      at: Date.now(),
    })
  }))

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (runtime.clients.size === 0) return
    runtime.broadcast({ type: 'session-event', sessionId: session?.id ?? null, event, at: Date.now() })
  }))
}

// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const disk = readDiskConfig()
  const runtime = createRuntime(ctx, config, disk)
  const sessions = applySessionApi(ctx, runtime)

  // pageToken 必须跨重载保持，否则已打开的页面全部 403、审批浮层永远是空的
  if (!disk.pageToken && runtime.pageToken) {
    try { writeDiskConfig({ pageToken: runtime.pageToken }) } catch { /* ignore */ }
  }

  applyHostRoutes(ctx, runtime, sessions)
  applyProxy(ctx, runtime)
  applyPairingServer(ctx, runtime)
  applyApprovalBridge(ctx, runtime)
  applyQuestionBridge(ctx, runtime)

  // client 模式：先问 GitHub 要最新端点，失败再退回配置里的地址
  if (runtime.remote) void bootstrapEndpoint(ctx, runtime)

  // 等 webServer 完成监听再起隧道
  const bootTimer = setTimeout(() => startQuickTunnel(ctx, runtime), 1200)

  ctx.effect(() => () => {
    runtime.stopped = true
    clearTimeout(bootTimer)
    stopPairing(runtime)
    stopTunnel(runtime)
  })

  if (!runtime.secret) ctx.logger?.warn?.('dsh-pair-link: 未配置 secret，配对与远程 API 会拒绝所有连接')
  else if (runtime.remote) ctx.logger?.info?.('dsh-pair-link: paired to %s', runtime.remote.httpOrigin)
  else ctx.logger?.info?.('dsh-pair-link: host ready at %s', runtime.wsPath)
}
