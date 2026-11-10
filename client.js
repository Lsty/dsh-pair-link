// dsh-pair-link —— 手机端页面
//
//  · 左侧栏（sidebar.panellist）一个「远程电脑」入口
//  · 主面板（main）里显示电脑上的会话列表、对话内容，可直接发消息 / 停止
//  · shell.overlay 里保留审批浮层（来自电脑的 approval 请求）
//  · settings.section 保留「DSH 配对」状态页

window.__ModuleLoader__.load({
  id: 'dsh-pair-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-pair-link'

    // -----------------------------------------------------------------------
    // 基础
    // -----------------------------------------------------------------------
    function pageToken() {
      return typeof window !== 'undefined' && typeof window.__DSH_PAIR_TOKEN__ === 'string'
        ? window.__DSH_PAIR_TOKEN__
        : ''
    }

    async function callJson(base, path, init) {
      const headers = { 'x-pair-token': pageToken() }
      if (init && init.body) headers['content-type'] = 'application/json'
      const res = await fetch(base + path, {
        ...init,
        headers,
        cache: 'no-store',
      })
      let body = null
      try { body = await res.json() } catch { /* 非 JSON */ }
      if (!res.ok || !body) {
        const message = body && body.error ? body.error : `HTTP ${res.status}`
        const err = new Error(message)
        err.status = res.status
        err.body = body
        throw err
      }
      return body
    }

    function formatWhen(ms) {
      const t = Number(ms)
      if (!Number.isFinite(t) || t <= 0) return ''
      const diff = Date.now() - t
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
      const d = new Date(t)
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    function formatClock(ms) {
      const d = new Date(Number(ms) || Date.now())
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    function basename(path) {
      const text = String(path ?? '').replace(/[\\/]+$/, '')
      const parts = text.split(/[\\/]/)
      return parts[parts.length - 1] || text
    }

    // -----------------------------------------------------------------------
    // 侧栏图标
    // -----------------------------------------------------------------------
    function PairIcon({ size = 20, active = false }) {
      const edge = Number(size) || 20
      return h('svg', {
        viewBox: '0 0 24 24',
        width: edge,
        height: edge,
        'aria-hidden': true,
        style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor' },
      },
      h('rect', {
        x: 2.4, y: 4.6, width: 8.2, height: 14.8, rx: 2,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
      }),
      h('rect', {
        x: 13.4, y: 4.6, width: 8.2, height: 14.8, rx: 2,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, opacity: 0.65,
      }),
      h('path', {
        d: 'M10.6 12h2.8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
      }),
      h('circle', { cx: 6.5, cy: 16.4, r: 1.05, fill: 'currentColor' }),
      h('circle', { cx: 17.5, cy: 16.4, r: 1.05, fill: 'currentColor', opacity: 0.65 }))
    }

    // -----------------------------------------------------------------------
    // 共用小件
    // -----------------------------------------------------------------------
    function Dot({ tone }) {
      const color = tone === 'ok'
        ? 'var(--dsw-alias-state-success-primary)'
        : tone === 'warn'
          ? 'var(--dsw-alias-state-warn-primary)'
          : tone === 'error'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-state-idle-primary)'
      return h('span', {
        style: {
          display: 'inline-block', width: 8, height: 8, borderRadius: 999,
          background: color, flex: '0 0 auto',
        },
      })
    }

    function Card({ children, style }) {
      return h('div', {
        style: {
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12,
          padding: 14,
          ...style,
        },
      }, children)
    }

    function Button({ children, onClick, kind = 'ghost', disabled = false, style, title }) {
      const palette = kind === 'primary'
        ? { background: 'var(--dsw-alias-brand-primary)', color: '#fff', border: '1px solid transparent' }
        : kind === 'danger'
          ? { background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-state-error-primary)' }
          : { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)' }
      return h('button', {
        type: 'button',
        title,
        onClick,
        disabled,
        style: {
          ...palette,
          borderRadius: 9,
          padding: '8px 13px',
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          lineHeight: 1.35,
          ...style,
        },
      }, children)
    }

    function Empty({ children }) {
      return h('div', {
        style: {
          padding: '22px 12px', textAlign: 'center', fontSize: 13,
          color: 'var(--dsw-alias-label-secondary)',
        },
      }, children)
    }

    // -----------------------------------------------------------------------
    // 配置表单（手机端）
    // -----------------------------------------------------------------------
    function ConfigForm({ info, onSaved }) {
      const [pairUrl, setPairUrl] = React.useState(info && info.host ? info.host : '')
      const [secret, setSecret] = React.useState('')
      const [bridgeToken, setBridgeToken] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [saved, setSaved] = React.useState(false)

      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box',
        padding: '9px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
      }
      const labelStyle = {
        display: 'block', fontSize: 12, margin: '10px 0 5px',
        color: 'var(--dsw-alias-label-secondary)',
      }

      const save = async () => {
        setBusy(true)
        setError(null)
        try {
          const body = {}
          if (pairUrl.trim()) body.pairUrl = pairUrl.trim()
          if (secret.trim()) body.secret = secret.trim()
          if (bridgeToken.trim()) body.bridgeToken = bridgeToken.trim()
          await callJson('', '/dsh-pair/config', { method: 'POST', body: JSON.stringify(body) })
          setSaved(true)
          setSecret('')
          if (onSaved) onSaved()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      return h(Card, { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, '连接这台电脑'),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
          '填电脑上 DSH 的公网地址（隧道域名）和配对密钥；两者与电脑端 dsh-pair-link.json 里的一致。'),

        h('label', { style: labelStyle }, '电脑地址'),
        h('input', {
          style: inputStyle,
          value: pairUrl,
          placeholder: 'https://xxxx.trycloudflare.com',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          onChange: (e) => setPairUrl(e.target.value),
        }),

        h('label', { style: labelStyle }, '配对密钥'),
        h('input', {
          style: inputStyle,
          value: secret,
          type: 'password',
          placeholder: info && info.hasSecret ? '已保存，留空表示不修改' : '电脑端 secret',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          onChange: (e) => setSecret(e.target.value),
        }),

        h('label', { style: labelStyle }, '桥接令牌（可选）'),
        h('input', {
          style: inputStyle,
          value: bridgeToken,
          type: 'password',
          placeholder: '电脑前面的 dsh-bridge 免密令牌',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          onChange: (e) => setBridgeToken(e.target.value),
        }),

        error ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,
        saved ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, '已保存并生效') : null,

        h('div', { style: { display: 'flex', gap: 8, marginTop: 14 } },
          h(Button, { kind: 'primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存并连接'),
          info && info.host
            ? h(Button, { onClick: () => { setPairUrl(''); setSecret(''); setBridgeToken('') } }, '清空输入')
            : null))
    }

    // -----------------------------------------------------------------------
    // 会话列表
    // -----------------------------------------------------------------------
    function SessionRow({ session, active, onOpen }) {
      const title = session.title && session.title.trim() ? session.title : `未命名 · ${basename(session.cwd) || '会话'}`
      return h('button', {
        type: 'button',
        onClick: () => onOpen(session.id),
        style: {
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          textAlign: 'left', padding: '11px 12px', borderRadius: 10,
          border: active ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
          background: active ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
          font: 'inherit',
        },
      },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 } },
        h('div', {
          style: {
            fontSize: 13.5, fontWeight: 600, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, title),
        h('div', {
          style: {
            fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
            display: 'flex', gap: 8, flexWrap: 'wrap',
          },
        },
        session.running
          ? h('span', { style: { color: 'var(--dsw-alias-state-success-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(Dot, { tone: 'ok' }), '运行中')
          : null,
        h('span', null, formatWhen(session.updatedAt)),
        session.cwd ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150, whiteSpace: 'nowrap' } }, basename(session.cwd)) : null)),
      h('span', {
        'aria-hidden': true,
        style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 16, flex: '0 0 auto' },
      }, '›'))
    }

    // -----------------------------------------------------------------------
    // 对话详情
    // -----------------------------------------------------------------------
    function MessageBubble({ message }) {
      const role = message.role
      if (role === 'system') {
        return h('div', {
          style: {
            alignSelf: 'center', fontSize: 11.5, padding: '3px 9px', borderRadius: 999,
            color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-2)',
            maxWidth: '90%', textAlign: 'center',
          },
        }, message.text)
      }
      if (role === 'tool') {
        return h('div', {
          style: {
            fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', padding: '2px 4px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          },
        }, '🔧 ' + message.text)
      }
      const mine = role === 'user'
      return h('div', {
        style: {
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '88%',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        },
      },
      h('div', {
        style: {
          padding: '9px 12px',
          borderRadius: 12,
          borderTopRightRadius: mine ? 4 : 12,
          borderTopLeftRadius: mine ? 12 : 4,
          background: mine ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
          color: mine ? '#fff' : 'var(--dsw-alias-label-primary)',
          border: mine ? '1px solid transparent' : '1px solid var(--dsw-alias-border-l1)',
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        },
      }, message.text),
      h('div', {
        style: {
          fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)',
          textAlign: mine ? 'right' : 'left', padding: '0 2px',
        },
      }, formatClock(message.time)))
    }

    function SessionDetail({ base, session, onBack, onChanged }) {
      const [messages, setMessages] = React.useState([])
      const [error, setError] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [refreshedAt, setRefreshedAt] = React.useState(0)
      const [showTools, setShowTools] = React.useState(false)
      const scrollRef = React.useRef(null)
      const stickToBottom = React.useRef(true)

      const load = React.useCallback(async () => {
        try {
          const body = await callJson(base, `/sessions/${encodeURIComponent(session.id)}/messages?limit=60`)
          setMessages(Array.isArray(body.messages) ? body.messages : [])
          setError(null)
          setRefreshedAt(Date.now())
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }, [base, session.id])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await load()
          if (alive) timer = setTimeout(tick, 3000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [load])

      React.useEffect(() => {
        const node = scrollRef.current
        if (!node || !stickToBottom.current) return
        node.scrollTop = node.scrollHeight
      }, [messages])

      const send = async () => {
        const text = draft.trim()
        if (!text || sending) return
        setSending(true)
        setError(null)
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/prompt`, {
            method: 'POST',
            body: JSON.stringify({ text }),
          })
          setDraft('')
          stickToBottom.current = true
          await load()
          if (onChanged) onChanged()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setSending(false)
        }
      }

      const stop = async () => {
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/cancel`, {
            method: 'POST',
            body: '{}',
          })
          await load()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const onScroll = () => {
        const node = scrollRef.current
        if (!node) return
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Button, { onClick: onBack, title: '返回会话列表' }, '‹ 返回'),
          h('div', {
            style: {
              flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
          }, session.title && session.title.trim() ? session.title : '未命名会话'),
          session.running
            ? h(Button, { kind: 'danger', onClick: stop, title: '停止这一轮' }, '停止')
            : null,
          h(Button, {
            onClick: () => setShowTools((value) => !value),
            title: '显示 / 隐藏工具调用',
            style: { padding: '6px 9px', fontSize: 12, opacity: showTools ? 1 : 0.75 },
          }, showTools ? '隐藏工具' : '工具')),

        error
          ? h('div', {
            style: {
              fontSize: 12, padding: '8px 10px', borderRadius: 8,
              color: 'var(--dsw-alias-state-error-primary)',
              background: 'var(--dsw-alias-bg-layer-2)',
            },
          }, error)
          : null,

        h('div', {
          ref: scrollRef,
          onScroll,
          style: {
            flex: 1,
            minHeight: 220,
            maxHeight: '58vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '2px 2px 8px',
          },
        },
        messages.length === 0
          ? h(Empty, null, refreshedAt ? '这个会话还没有消息' : '正在读取…')
          : messages
            .filter((message) => showTools || message.role !== 'tool')
            .map((message, index) => h(MessageBubble, { key: `${message.seq}-${index}`, message }))),

        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end' } },
          h('textarea', {
            value: draft,
            rows: 2,
            placeholder: '发到电脑上的这个会话…',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            },
            style: {
              flex: 1,
              resize: 'none',
              boxSizing: 'border-box',
              padding: '9px 11px',
              borderRadius: 10,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13.5,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              minHeight: 44,
            },
          }),
          h(Button, {
            kind: 'primary',
            onClick: send,
            disabled: sending || !draft.trim(),
            style: { minWidth: 64, padding: '10px 14px' },
          }, sending ? '发送中…' : '发送')))
    }

    // -----------------------------------------------------------------------
    // 主面板
    // -----------------------------------------------------------------------
    function PairPage() {
      const [info, setInfo] = React.useState(null)
      const [infoError, setInfoError] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [listError, setListError] = React.useState(null)
      const [activeId, setActiveId] = React.useState(null)
      const [showConfig, setShowConfig] = React.useState(false)
      const [refreshing, setRefreshing] = React.useState(false)

      const apiBase = info && info.apiBase ? info.apiBase : ''

      const loadInfo = React.useCallback(async () => {
        try {
          const body = await callJson('', '/dsh-pair/page-info')
          setInfo(body)
          setInfoError(null)
          return body
        } catch (err) {
          setInfoError(String(err && err.message ? err.message : err))
          return null
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await loadInfo()
          if (alive) timer = setTimeout(tick, 6000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [loadInfo])

      const loadSessions = React.useCallback(async () => {
        if (!apiBase) return
        try {
          const body = await callJson(apiBase, '/sessions')
          setSessions(Array.isArray(body.sessions) ? body.sessions : [])
          setListError(null)
        } catch (err) {
          setListError(String(err && err.message ? err.message : err))
        }
      }, [apiBase])

      React.useEffect(() => {
        if (!apiBase) return undefined
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await loadSessions()
          if (alive) timer = setTimeout(tick, 5000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [apiBase, loadSessions])

      const refreshNow = async () => {
        setRefreshing(true)
        await loadInfo()
        await loadSessions()
        setRefreshing(false)
      }

      const active = sessions.find((session) => session.id === activeId) || { id: activeId, title: '' }
      const role = info ? info.role : null

      // 换到另一套接口时，旧的会话 id 不再适用
      React.useEffect(() => {
        setActiveId(null)
      }, [role])

      // 未就绪时的兜底
      if (!info) {
        return h('div', { style: { padding: 20, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
          infoError ? `配对信息读取失败：${infoError}` : '正在读取配对状态…')
      }

      const isHost = role === 'host'
      const linked = Boolean(info.linked)
      const statusTone = infoError
        ? 'error'
        : isHost
          ? (info.configured ? 'ok' : 'warn')
          : listError
            ? 'warn'
            : 'ok'

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, flex: '0 0 auto' } },
        h('div', {
          style: {
            width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
            background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-brand-primary)',
          },
        }, h(PairIcon, { size: 19 })),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 700, fontSize: 15, lineHeight: 1.3 } }, '远程电脑'),
          h('div', {
            style: {
              fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
            },
          },
          h(Dot, { tone: statusTone }),
          isHost
            ? (linked ? '本机 · 已配对手机' : `本机作为主机 · ${info.clients || 0} 台设备`)
            : (listError ? '连不上电脑' : '已连上电脑'))),
        h(Button, {
          onClick: refreshNow,
          disabled: refreshing,
          title: '刷新',
          style: { padding: '6px 10px' },
        }, refreshing ? '刷新中' : '刷新'))

      const listBody = () => {
        if (showConfig) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h(ConfigForm, { info, onSaved: () => { setShowConfig(false); refreshNow() } }),
            h(Button, { onClick: () => setShowConfig(false) }, '取消'))
        }
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 } },
          listError
            ? h('div', {
              style: {
                fontSize: 12, padding: '9px 10px', borderRadius: 8,
                color: 'var(--dsw-alias-state-error-primary)',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l1)',
                lineHeight: 1.6,
              },
            }, listError)
            : null,
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
            },
          },
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            isHost
              ? (sessions.length ? `本机 ${sessions.length} 个会话` : '本机会话')
              : (info.host || '电脑')),
          h(Button, {
            onClick: () => setShowConfig(true),
            style: { padding: '5px 9px', fontSize: 12, flex: '0 0 auto' },
          }, isHost ? '连接电脑' : '修改连接')),
          h('div', {
            style: {
              display: 'flex', flexDirection: 'column', gap: 7,
              overflowY: 'auto', flex: 1, minHeight: 140, paddingRight: 2,
            },
          },
          sessions.length
            ? sessions.map((session) => h(SessionRow, {
              key: session.id,
              session,
              active: session.id === activeId,
              onOpen: (id) => setActiveId(id),
            }))
            : h(Empty, null, listError ? '接口返回了错误，先看上面的提示' : '还没有会话')),
          isHost
            ? h('div', {
              style: {
                fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
                lineHeight: 1.65, paddingTop: 4,
              },
            },
            linked
              ? `这台设备已配对：手机端面板会连到 ${info.device || '本机'} 上的会话。`
              : '手机端第一次用：点「连接电脑」，把这里的隧道地址和配对密钥填进去。')
            : null)
      }

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 12,
          height: '100%', minHeight: 420, padding: '14px 16px 18px',
          boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)',
          maxWidth: 860, margin: '0 auto', width: '100%',
        },
      },
      header,
      infoError
        ? h('div', {
          style: {
            fontSize: 12, padding: '9px 10px', borderRadius: 8,
            color: 'var(--dsw-alias-state-error-primary)',
            background: 'var(--dsw-alias-bg-layer-1)',
          },
        }, `配对信息读取失败：${infoError}`)
        : null,
      activeId
        ? h(SessionDetail, {
          base: apiBase,
          session: active,
          onBack: () => setActiveId(null),
          onChanged: loadSessions,
        })
        : listBody())
    }

    // -----------------------------------------------------------------------
    // 审批浮层（保留）
    // -----------------------------------------------------------------------
    function ApprovalOverlay() {
      const [items, setItems] = React.useState([])
      const [busy, setBusy] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const body = await callJson('', '/dsh-pair/inbox')
            if (alive) setItems(Array.isArray(body.approvals) ? body.approvals : [])
          } catch {
            if (alive) setItems([])
          }
          if (alive) timer = setTimeout(tick, 2000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [])

      const decide = async (id, outcome) => {
        setBusy(id)
        try {
          await callJson('', '/dsh-pair/decide', {
            method: 'POST',
            body: JSON.stringify({ id, outcome }),
          })
          setItems((prev) => prev.filter((item) => item.id !== id))
        } catch {
          /* 下一轮轮询会纠正 */
        } finally {
          setBusy(null)
        }
      }

      if (!items.length) return null

      return h('div', {
        style: {
          position: 'fixed', right: 12, bottom: 12, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 'min(92vw, 420px)',
        },
      }, items.map((item) => h('div', {
        key: item.id,
        style: {
          background: 'var(--dsw-alias-bg-overlay)',
          color: 'var(--dsw-alias-label-primary)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 12, padding: 14,
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          fontSize: 14, lineHeight: 1.5,
        },
      },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '电脑请求：' + (item.toolName || '未知操作')),
      item.reason
        ? h('div', { style: { opacity: 0.78, marginBottom: 10, wordBreak: 'break-word' } }, item.reason)
        : null,
      h('div', { style: { display: 'flex', gap: 8 } },
        h(Button, {
          kind: 'primary',
          disabled: busy === item.id,
          onClick: () => decide(item.id, 'allowed-once'),
          style: { flex: 1 },
        }, '允许'),
        h(Button, {
          kind: 'danger',
          disabled: busy === item.id,
          onClick: () => decide(item.id, 'rejected'),
          style: { flex: 1 },
        }, '拒绝')))))
    }

    // -----------------------------------------------------------------------
    // 设置页（保留状态页）
    // -----------------------------------------------------------------------
    function PairSettings() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          let next = null
          try {
            const res = await fetch('/dsh-pair/inbox', {
              cache: 'no-store',
              headers: { 'x-pair-token': pageToken() },
            })
            if (res.ok) next = await res.json()
          } catch { /* try status next */ }
          if (next === null) {
            try {
              const res = await fetch('/dsh-pair/status', { cache: 'no-store' })
              if (res.ok) next = await res.json()
            } catch (error) {
              if (alive) setErr(String(error && error.message ? error.message : error))
            }
          }
          if (alive && next) { setData(next); setErr(null) }
          if (alive) timer = setTimeout(tick, 3000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [])

      const role = data && data.role ? data.role : '未知'
      const connected = data && (data.connected === true || (data.clients || 0) > 0)
      const row = (key, value) => h('div', {
        key,
        style: {
          display: 'flex', justifyContent: 'space-between', gap: 16,
          padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: 13,
        },
      },
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } }, key),
      h('span', { style: { textAlign: 'right', wordBreak: 'break-all' } }, String(value)))

      return h('div', { style: { padding: '4px 2px', fontSize: 13, lineHeight: 1.6 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          h(Dot, { tone: connected ? 'ok' : 'idle' }),
          h('strong', null, connected ? '已连接' : '未连接'),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '· ' + role)),
        h('div', {
          style: {
            fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
            marginBottom: 10, lineHeight: 1.65,
          },
        }, '会话列表、发消息和审批都在左侧栏「远程电脑」里。这里只放运行状态速览。'),
        row('角色', role === 'host' ? 'host（电脑）' : role === 'client' ? 'client（手机）' : role),
        role === 'host' ? row('已连接设备', data.clients || 0) : null,
        role === 'client' ? row('电脑地址', (data && data.host) || '—') : null,
        row('审批：收到', (data && data.approvalsSeen) || 0),
        row('审批：已回复', (data && data.approvalsAnswered) || 0),
        row('审批：回退本机', (data && data.approvalsDelegated) || 0),
        row('待审批', (data && data.approvals && data.approvals.length) || (data && data.pendingApprovals) || 0),
        data && data.lastError ? row('lastError', data.lastError) : null,
        err ? h('div', { style: { marginTop: 10, color: 'var(--dsw-alias-label-secondary)' } }, '状态读取失败：' + err) : null,
        h('div', { style: { marginTop: 14, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, '每 3 秒刷新一次'))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 左侧栏入口：点图标后主面板按同一个 id 打开
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: '远程电脑',
        }, (props) => h(PairIcon, { size: props && props.size ? props.size : 20, active: Boolean(props && props.active) })))

        // 主面板
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, PairPage))

        // 设置页状态速览
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: PANEL_ID,
          order: 60,
          label: 'DSH 配对',
        }, PairSettings))

        // 审批浮层
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-pair-approval',
          order: 100,
        }, ApprovalOverlay))
      },
    }
  },
})
