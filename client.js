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

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-pair-approval',
          order: 100,
        }, ApprovalOverlay))
      },
    }
  },
})
