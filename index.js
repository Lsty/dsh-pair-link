// dsh-pair-link —— 双模式插件
//
//  host  模式（电脑）：拦截 approval/request，通过 WebSocket 推给已配对的手机；
//                      手机的回复会作为原生 ApprovalOutcome 直接结束桌面审批。
//  client 模式（手机）：配置了 pairUrl 时启用；主动连电脑的 WS，收审批请求，
//                      暴露 /dsh-pair/inbox 与 /dsh-pair/decide 给手机 Web UI。
//
// 零依赖：自带最小 WebSocket 服务端实现（RFC 6455 文本帧），
// 因为 profile 用 link: 安装本地包时不会安装 dependencies。

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-pair-link'

export const inject = ['webServer']

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const APPROVAL_TIMEOUT_MS = 120_000
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const RECONNECT_MS = 5000

function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

function readDiskConfig() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  try {
    return JSON.parse(readFileSync(join(home, 'dsh-pair-link.json'), 'utf8')) ?? {}
  } catch {
    return {}
  }
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

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { resolve(''); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

function sendJson(res, status, obj) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(obj))
}

// ---------------------------------------------------------------------------
// host：电脑侧
// ---------------------------------------------------------------------------
function applyHost(ctx, { secret, wsPath }) {
  const state = {
    startedAt: Date.now(),
    connections: 0,
    approvalsSeen: 0,
    approvalsAnswered: 0,
    approvalsDelegated: 0,
    streamed: 0,
  }

  const clients = new Set()
  const pending = new Map()

  const broadcast = (payload) => {
    if (clients.size === 0) return
    const text = JSON.stringify(payload)
    for (const c of clients) c.send(text)
  }

  const attach = (socket, head) => {
    const peer = new PairSocket(socket, head)
    clients.add(peer)
    state.connections += 1
    ctx.logger?.info?.('dsh-pair-link: client connected (%d total)', clients.size)

    peer.onClose(() => {
      clients.delete(peer)
      ctx.logger?.info?.('dsh-pair-link: client disconnected (%d left)', clients.size)
    })

    peer.onText((text) => {
      let msg
      try { msg = JSON.parse(text) } catch { return }
      if (msg?.type === 'approval-decision') {
        const resolve = pending.get(msg.id)
        if (resolve) resolve(msg.outcome === 'allowed-once' ? 'allowed-once' : 'rejected')
      }
    })

    peer.send(JSON.stringify({ type: 'hello', role: 'host', version: '0.2.0', at: Date.now() }))
    return peer
  }

  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: wsPath,
    handler(req, socket, head) {
      let token = ''
      try { token = new URL(req.url, 'http://127.0.0.1').searchParams.get('token') ?? '' } catch { /* ignore */ }
      const key = req.headers['sec-websocket-key']
      if (!secret || !safeEqual(token, secret) || typeof key !== 'string') {
        try { socket.destroy() } catch { /* ignore */ }
        return
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      )
      attach(socket, head)
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-pair/status',
    handler(req, res) {
      sendJson(res, 200, {
        ok: true,
        plugin: name,
        version: '0.2.0',
        role: 'host',
        configured: Boolean(secret),
        clients: clients.size,
        pendingApprovals: pending.size,
        ...state,
        now: Date.now(),
      })
    },
  }))

  ctx.effect(() => ctx.on('approval/request', async (req, next) => {
    try {
      if (clients.size === 0) return next()
      state.approvalsSeen += 1
      const id = randomUUID()

      const decision = new Promise((resolve) => {
        pending.set(id, resolve)
        broadcast({
          type: 'approval',
          id,
          toolName: req?.toolName ?? '',
          reason: req?.reason ?? '',
          displayReason: req?.displayReason ?? null,
          callId: req?.callId ?? null,
          sessionId: req?.agent?.id ?? null,
          at: Date.now(),
        })
      })

      let timer
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), APPROVAL_TIMEOUT_MS)
      })
      let onAbort = null
      const aborted = new Promise((resolve) => {
        if (!req?.signal) return
        if (req.signal.aborted) return resolve(null)
        onAbort = () => resolve(null)
        req.signal.addEventListener('abort', onAbort, { once: true })
      })

      const outcome = await Promise.race([decision, timeout, aborted])
      clearTimeout(timer)
      if (onAbort && req?.signal) req.signal.removeEventListener('abort', onAbort)
      pending.delete(id)

      if (outcome === 'allowed-once' || outcome === 'rejected') {
        state.approvalsAnswered += 1
        broadcast({ type: 'approval-resolved', id, outcome })
        return outcome
      }
      state.approvalsDelegated += 1
      broadcast({ type: 'approval-delegated', id, reason: 'timeout-or-abort' })
      return next()
    } catch (err) {
      ctx.logger?.warn?.('dsh-pair-link: approval bridge error: %s', err?.message ?? err)
      return next()
    }
  }))

  ctx.effect(() => ctx.on('agent/assistant-stream', (payload) => {
    if (clients.size === 0) return
    state.streamed += 1
    broadcast({
      type: 'assistant-stream',
      sessionId: payload?.agent?.id ?? null,
      frame: payload?.frame ?? null,
      at: Date.now(),
    })
  }))

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (clients.size === 0) return
    broadcast({ type: 'session-event', sessionId: session?.id ?? null, event, at: Date.now() })
  }))

  ctx.effect(() => () => {
    for (const c of clients) c.close()
    clients.clear()
    pending.clear()
  })

  if (!secret) ctx.logger?.warn?.('dsh-pair-link: 未配置 secret，WS 端点会拒绝所有连接')
  else ctx.logger?.info?.('dsh-pair-link: host ready at %s', wsPath)
}

// ---------------------------------------------------------------------------
// client：手机侧
// ---------------------------------------------------------------------------
function applyClient(ctx, { secret, pairUrl }) {
  const state = {
    startedAt: Date.now(),
    connected: false,
    lastError: null,
    approvalsSeen: 0,
    approvalsAnswered: 0,
    reconnects: 0,
  }
  const approvals = new Map()
  let ws = null
  let reconnectTimer = null
  let stopped = false

  const url = () => {
    const sep = pairUrl.includes('?') ? '&' : '?'
    return `${pairUrl}${sep}token=${encodeURIComponent(secret)}`
  }

  const connect = () => {
    if (stopped) return
    if (typeof WebSocket === 'undefined') {
      state.lastError = 'this runtime has no global WebSocket'
      ctx.logger?.error?.('dsh-pair-link: 宿主运行时没有全局 WebSocket，client 模式不可用')
      return
    }
    try {
      ws = new WebSocket(url())
    } catch (err) {
      state.lastError = String(err?.message ?? err)
      scheduleReconnect()
      return
    }

    ws.addEventListener('open', () => {
      state.connected = true
      state.lastError = null
      ctx.logger?.info?.('dsh-pair-link: connected to host %s', pairUrl)
    })

    ws.addEventListener('message', (ev) => {
      let msg
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg?.type === 'approval') {
        state.approvalsSeen += 1
        approvals.set(msg.id, { ...msg, receivedAt: Date.now() })
        ctx.logger?.info?.('dsh-pair-link: approval %s (%s) queued', msg.id, msg.toolName)
      } else if (msg?.type === 'approval-resolved' || msg?.type === 'approval-delegated') {
        approvals.delete(msg.id)
      }
    })

    ws.addEventListener('close', () => {
      state.connected = false
      scheduleReconnect()
    })
    ws.addEventListener('error', () => { /* close 会跟着来 */ })
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    state.reconnects += 1
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, RECONNECT_MS)
  }

  const decide = (id, outcome) => {
    if (!approvals.has(id)) return { ok: false, error: 'no such pending approval' }
    if (!ws || !state.connected) return { ok: false, error: 'not connected to host' }
    try {
      ws.send(JSON.stringify({ type: 'approval-decision', id, outcome }))
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) }
    }
    approvals.delete(id)
    state.approvalsAnswered += 1
    return { ok: true }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-pair/inbox',
    handler(req, res) {
      sendJson(res, 200, {
        ok: true,
        plugin: name,
        role: 'client',
        connected: state.connected,
        lastError: state.lastError,
        host: pairUrl,
        approvals: [...approvals.values()],
        ...state,
        now: Date.now(),
      })
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-pair/decide',
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
      const raw = await readBody(req)
      let body
      try { body = JSON.parse(raw) } catch { return sendJson(res, 400, { ok: false, error: 'bad json' }) }
      const outcome = body?.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
      const result = decide(String(body?.id ?? ''), outcome)
      return sendJson(res, result.ok ? 200 : 409, result)
    },
  }))

  connect()

  ctx.effect(() => () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    try { ws?.close() } catch { /* ignore */ }
  })

  ctx.logger?.info?.('dsh-pair-link: client mode, host=%s', pairUrl)
}

// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const disk = readDiskConfig()
  const secret = String(config?.secret ?? '') || String(disk.secret ?? '')
  const pairUrl = String(config?.pairUrl ?? '') || String(disk.pairUrl ?? '')
  if (pairUrl) return applyClient(ctx, { secret, pairUrl })
  return applyHost(ctx, { secret, wsPath: String(config?.path ?? '/dsh-pair/ws') })
}
