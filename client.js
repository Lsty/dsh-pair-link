// dsh-pair-link —— 手机端审批卡（Web UI）
// 注册到 shell.overlay：只要有来自电脑的待审批请求，就在手机上浮一张卡。
// 点「允许」/「拒绝」会 POST /dsh-pair/decide，最终作为电脑侧的原生 ApprovalOutcome 生效。

window.__ModuleLoader__.load({
  id: 'dsh-pair-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function ApprovalOverlay() {
      const [items, setItems] = React.useState([])
      const [busy, setBusy] = React.useState(null)

      const token = typeof window !== 'undefined' ? window.__DSH_PAIR_TOKEN__ : ''
      const authHeaders = token ? { 'x-pair-token': token } : {}

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const res = await fetch('/dsh-pair/inbox', { cache: 'no-store', headers: authHeaders })
            const json = await res.json()
            if (alive) setItems(Array.isArray(json?.approvals) ? json.approvals : [])
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
          await fetch('/dsh-pair/decide', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authHeaders },
            body: JSON.stringify({ id, outcome }),
          })
          setItems((prev) => prev.filter((x) => x.id !== id))
        } catch {
          /* 下一轮轮询会纠正 */
        } finally {
          setBusy(null)
        }
      }

      if (!items.length) return null

      return h('div', {
        style: {
          position: 'fixed',
          right: 12,
          bottom: 12,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 'min(92vw, 420px)',
        },
      }, items.map((a) => h('div', {
        key: a.id,
        style: {
          background: 'var(--dsh-surface, #1e1e2e)',
          color: 'var(--dsh-text, #f3f4f6)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 12,
          padding: 14,
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          fontSize: 14,
          lineHeight: 1.5,
        },
      },
      h('div', { style: { fontWeight: 600, marginBottom: 6 } },
        '电脑请求：' + (a.toolName || '未知操作')),
      a.reason
        ? h('div', { style: { opacity: 0.75, marginBottom: 10, wordBreak: 'break-word' } }, a.reason)
        : null,
      h('div', { style: { display: 'flex', gap: 8 } },
        h('button', {
          type: 'button',
          disabled: busy === a.id,
          onClick: () => decide(a.id, 'allowed-once'),
          style: {
            flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
            background: '#22c55e', color: '#08120b', fontWeight: 600,
            cursor: 'pointer', opacity: busy === a.id ? 0.6 : 1,
          },
        }, '允许'),
        h('button', {
          type: 'button',
          disabled: busy === a.id,
          onClick: () => decide(a.id, 'rejected'),
          style: {
            flex: 1, padding: '8px 12px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)', background: 'transparent',
            color: 'inherit', fontWeight: 600,
            cursor: 'pointer', opacity: busy === a.id ? 0.6 : 1,
          },
        }, '拒绝'),
      ),
      )))
    }

    function PairSettings() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const token = typeof window !== 'undefined' ? window.__DSH_PAIR_TOKEN__ : ''
      const authHeaders = token ? { 'x-pair-token': token } : {}

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          let next = null
          try {
            const res = await fetch('/dsh-pair/inbox', { cache: 'no-store', headers: authHeaders })
            if (res.ok) next = await res.json()
          } catch { /* try status next */ }
          if (next === null) {
            try {
              const res = await fetch('/dsh-pair/status', { cache: 'no-store' })
              if (res.ok) next = await res.json()
            } catch (e2) {
              if (alive) setErr(String(e2?.message ?? e2))
            }
          }
          if (alive) { if (next) { setData(next); setErr(null) } }
          if (alive) timer = setTimeout(tick, 2000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [])

      const role = data?.role ?? '未知'
      const connected = data?.connected === true || (data?.clients ?? 0) > 0
      const dot = connected ? '#22c55e' : '#6b7280'
      const accent = '#4d6bfe'

      const row = (k, v) => h('div', {
        key: k,
        style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 13 },
      },
      h('span', { style: { opacity: 0.6, flex: '0 0 auto' } }, k),
      h('span', { style: { textAlign: 'right', wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }, String(v)))

      return h('div', { style: { padding: '4px 2px', fontSize: 13, lineHeight: 1.6 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
          h('span', { style: { width: 9, height: 9, borderRadius: 999, background: dot, display: 'inline-block', boxShadow: connected ? '0 0 8px ' + dot : 'none' } }),
          h('strong', null, connected ? '已连接' : '未连接'),
          h('span', { style: { opacity: 0.55 } }, '· ' + role)),

        row('角色', role === 'host' ? 'host（电脑）' : role === 'client' ? 'client（手机）' : role),
        role === 'host' ? row('已连接设备', data?.clients ?? 0) : null,
        role === 'host'
          ? row('公网地址', '由 cloudflared 隧道暴露（在 cloudflared 侧查看）')
          : row('电脑地址', data?.host ?? '—'),
        role === 'host' ? row('累计连接', data?.connections ?? 0) : null,
        role === 'host' ? row('审批：收到', data?.approvalsSeen ?? 0) : row('审批：收到', data?.approvalsSeen ?? 0),
        row('审批：已回复', data?.approvalsAnswered ?? 0),
        row('审批：回退本机', data?.approvalsDelegated ?? 0),
        row('待审批', data?.approvals?.length ?? data?.pendingApprovals ?? 0),
        role === 'host' ? row('流式片段', data?.streamed ?? 0) : row('重连次数', data?.reconnects ?? 0),
        data?.lastError ? h('div', { style: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' } }, 'lastError: ' + data.lastError) : null,
        err ? h('div', { style: { marginTop: 10, opacity: 0.7 } }, '状态读取失败：' + err) : null,
        h('div', { style: { marginTop: 14, opacity: 0.45, fontSize: 12 } }, '每 2 秒刷新一次'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-pair-link',
          order: 60,
          label: 'DSH 配对',
        }, PairSettings))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-pair-approval',
          order: 100,
        }, ApprovalOverlay))
      },
    }
  },
})
