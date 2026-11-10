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

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

export const name = 'dsh-pair-link'

export const inject = ['webServer']

const VERSION = '0.4.0'
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const APPROVAL_TIMEOUT_MS = 120_000
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_BODY_BYTES = 512 * 1024
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
    else if (block.type === 'image') out.push('[图片]')
    else if (block.type === 'file') out.push(`[文件${block.attachment?.name ? ` ${block.attachment.name}` : ''}]`)
  }
  return out.join('\n').trim()
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
    const text = blocksText(data.content ?? data.message?.content)
    if (isInjectedUserEvent(data, text)) return null
    return { seq, time, role: 'user', text }
  }
  if (type === 'assistant/message') {
    const data = event.data ?? {}
    const content = data.message?.content ?? data.content
    return { seq, time, role: 'assistant', text: blocksText(content), reasoning: blocksReasoning(content) }
  }
  if (type === 'tool/call') {
    return { seq, time, role: 'tool', text: String(event.data?.name ?? '工具') }
  }
  if (type === 'turn/end') {
    const kind = event.data?.reason?.kind
    if (kind && kind !== 'completed') return { seq, time, role: 'system', text: `本轮结束：${kind}` }
  }
  return null
}

function compactMessages(rows) {
  const out = []
  for (const row of rows) {
    if (!row) continue
    // 工具调用行只保留名字；其余空文本（纯推理 / 纯工具调用）不占气泡
    if (row.role !== 'tool' && !row.text && !row.reasoning) continue
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
    pageToken: randomBytes(18).toString('hex'),
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
    // host 侧
    clients: new Set(),
    approvals: new Map(),
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

    return { messages: compactMessages(events.map(toDisplayMessage)), cursor }
  }

  async function promptSession(sessionId, text) {
    const controller = controllerOf()
    if (!controller?.prompt) throw new Error('这个 DSH 版本没有可用的会话写入服务')
    await controller.prompt({
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, AbortSignal.timeout(20_000))
    return { accepted: true }
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
    }
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

  return {
    listSessions,
    readMessages,
    promptSession,
    cancelSession,
    buildTree,
    sessionMeta,
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

  const authorize = (req) => {
    const header = String(req.headers[PAGE_TOKEN_HEADER] ?? '')
    if (safeEqual(header, runtime.pageToken)) return 'page'
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

      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'tree') {
        const tree = await sessions.buildTree(controller.signal)
        sendJson(res, 200, { ok: true, ...tree, now: Date.now() })
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
    const header = String(req.headers[PAGE_TOKEN_HEADER] ?? '')
    return safeEqual(header, runtime.pageToken) || (runtime.secret ? safeEqual(header, runtime.secret) : false)
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
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
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
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
      return sendJson(res, 403, { ok: false, error: 'bad page token' })
    }
    try {
      const result = await applySelfUpdate(runtime)
      return sendJson(res, 200, { ...result, local: localPackageVersion(), restartRequired: true })
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: String(err?.message ?? err) })
    }
  })

  // --- 保存连接配置（立即生效，不需要重启） ---
  route('exact', '/dsh-pair/config', async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
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
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
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
      approvalsSeen: runtime.approvalsSeen,
      approvalsAnswered: runtime.approvalsAnswered,
      approvalsDelegated: runtime.approvalsDelegated,
      reconnects: runtime.reconnects,
      clients: runtime.clients.size,
      now: Date.now(),
    })
  })

  route('exact', '/dsh-pair/decide', async (req, res) => {
    cors(res)
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
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
    ctx.logger?.info?.('dsh-pair-link: connected to host %s', runtime.remote?.httpOrigin ?? '?')
  })

  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (message?.type === 'approval') {
      runtime.approvalsSeen += 1
      runtime.approvals.set(String(message.id), {
        resolve: (outcome) => {
          try { socket.send(JSON.stringify({ type: 'approval-decision', id: message.id, outcome })) } catch { /* ignore */ }
          runtime.approvals.delete(String(message.id))
        },
        info: message,
      })
      ctx.logger?.info?.('dsh-pair-link: approval %s (%s) queued', message.id, message.toolName)
    } else if (message?.type === 'approval-resolved' || message?.type === 'approval-delegated') {
      runtime.approvals.delete(String(message.id))
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

  let child
  try {
    child = spawn(runtime.cloudflaredPath, ['tunnel', '--url', origin, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    runtime.tunnelState = 'error'
    runtime.tunnelError = String(err?.message ?? err)
    ctx.logger?.warn?.('dsh-pair-link: 专用隧道启动失败：%s', runtime.tunnelError)
    return
  }

  runtime.tunnel = child
  runtime.tunnelState = 'starting'
  runtime.tunnelError = null
  let settled = false

  const scan = (chunk) => {
    const text = String(chunk)
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)
    if (match && !settled) {
      settled = true
      runtime.publicUrl = match[0]
      runtime.tunnelState = 'ready'
      if (runtime.tunnelTimer) { clearTimeout(runtime.tunnelTimer); runtime.tunnelTimer = null }
      ctx.logger?.info?.('dsh-pair-link: 专用隧道就绪 %s', runtime.publicUrl)
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
  const child = runtime.tunnel
  runtime.tunnel = null
  runtime.tunnelState = 'off'
  runtime.publicUrl = ''
  if (!child) return
  try { child.kill() } catch { /* ignore */ }
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
    if (!safeEqual(String(req.headers[PAGE_TOKEN_HEADER] ?? ''), runtime.pageToken)) {
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
      const timer = setTimeout(() => controller.abort(), 25_000)
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
      })

      peer.send(JSON.stringify({ type: 'hello', role: 'host', version: VERSION, at: Date.now() }))
    },
  }))

  ctx.effect(() => () => {
    for (const client of runtime.clients) client.close()
    runtime.clients.clear()
    runtime.approvals.clear()
  })
}

function applyApprovalBridge(ctx, runtime) {
  const register = (scope) => scope.on('approval/request', async (request, next) => {
    try {
      if (runtime.clients.size === 0) return next()
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
  })

  try {
    const list = ctx.get?.('agents')?.list?.() ?? []
    let attached = 0
    for (const agent of list) {
      const scope = agent?.ctx && typeof agent.ctx.on === 'function' ? agent.ctx : agent
      if (typeof scope?.on === 'function') {
        register(scope)
        attached += 1
      }
    }
    ctx.logger?.info?.('dsh-pair-link: approval bridge attached to %d/%d agents', attached, list.length)
  } catch (err) {
    ctx.logger?.warn?.('dsh-pair-link: attach existing agents failed: %s', err?.message ?? err)
  }

  ctx.effect(() => ctx.on('agent/created', function onAgentCreated() {
    try {
      const scope = this?.ctx ?? this
      register(scope)
    } catch (err) {
      ctx.logger?.warn?.('dsh-pair-link: per-agent approval bridge failed: %s', err?.message ?? err)
    }
  }))

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

  applyHostRoutes(ctx, runtime, sessions)
  applyProxy(ctx, runtime)
  applyPairingServer(ctx, runtime)
  applyApprovalBridge(ctx, runtime)

  if (runtime.remote) startPairing(ctx, runtime)

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
