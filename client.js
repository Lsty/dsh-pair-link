// dsh-pair-link —— 手机端页面
//
//  · 左侧栏（sidebar.panellist）一个「远程电脑」入口
//  · 主面板：左边工作区树（工作区 → 会话），右边对话；窄屏时两级切换
//  · 对话里带模型选择、运行范围（权限预设）、思考过程、工具调用折叠
//  · shell.overlay 里保留审批浮层；settings.section 保留状态页
//
//  样式按 DSH 原生 primitives 的规格抄（按钮 36/28、列表项 34、输入框 36），
//  只用主题 token；类名统一加 pair- 前缀，避免和宿主样式互相影响。

window.__ModuleLoader__.load({
  id: 'dsh-pair-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'dsh-pair-link'

    // -----------------------------------------------------------------------
    // 原生规格的局部样式（抄自客户端 primitives 的 CSS Modules）
    // -----------------------------------------------------------------------
    const CSS_TEXT = `
.pair-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  padding: 0 14px;
  height: 36px;
  flex: 0 0 auto;
  -webkit-tap-highlight-color: transparent;
}
.pair-btn:disabled { cursor: not-allowed; opacity: .4; }
.pair-btn--sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: var(--dsw-radius-sm); }
.pair-btn--primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.pair-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.pair-btn--ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.pair-btn--ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.pair-btn--outline { box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l3); }
.pair-btn--outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.pair-btn--danger { color: var(--dsw-alias-state-error-primary); }
.pair-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }

.pair-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  min-height: 44px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.pair-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pair-row[data-active="true"] { background: var(--dsw-alias-interactive-bg-active); }
.pair-row-title { font-size: 15px; line-height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pair-row-meta { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.pair-chevron { color: var(--dsw-alias-label-tertiary); font-size: 15px; flex: 0 0 auto; }

.pair-ws {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  min-height: 36px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  text-align: left;
}
.pair-ws:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pair-ws-caret { display: inline-block; width: 12px; color: var(--dsw-alias-label-tertiary); }
.pair-ws-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pair-ws-count { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.pair-ws-sessions { display: flex; flex-direction: column; gap: 0; margin-left: 10px; border-left: .5px solid var(--dsw-alias-border-l1); padding-left: 6px; }

.pair-card {
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg);
  padding: 14px 16px;
}

.pair-field {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.pair-field:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.pair-field input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.pair-field input::placeholder { color: var(--dsw-alias-label-dimmed); }

.pair-textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  resize: none;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 15px;
  line-height: 23px;
  padding: 2px 2px 0;
  outline: none;
  box-shadow: none;
  min-height: 44px;
}
.pair-textarea:focus { box-shadow: none; }
.pair-textarea::placeholder { color: var(--dsw-alias-label-dimmed); }
.pair-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 8px;
  border-radius: 20px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.pair-composer:focus-within { box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary); }
.pair-composer-bar { display: flex; align-items: center; gap: 8px; }
.pair-composer-bar .pair-tool {
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
  flex: 1 1 0;
  min-width: 0;
  max-width: none;
  justify-content: space-between;
}
.pair-composer-bar .pair-menu-anchor {
  flex: 1 1 0;
  min-width: 0;
}
.pair-composer-bar .pair-tool > span:first-child {
  overflow-x: auto;
  white-space: nowrap;
  text-overflow: clip;
  scrollbar-width: none;
}
.pair-composer-bar .pair-tool > span:first-child::-webkit-scrollbar { display: none; }
.pair-icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: none;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
}
.pair-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pair-send-btn {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: none;
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  flex: 0 0 auto;
}
.pair-send-btn:disabled { opacity: .4; cursor: default; }

.pair-label { display: block; font-size: 12px; line-height: 18px; margin: 12px 0 6px; color: var(--dsw-alias-label-secondary); }
.pair-hint { font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.pair-error { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary); }
.pair-ok { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-success-primary); }

.pair-menu-anchor { position: relative; display: inline-flex; }
.pair-menu-sub { display: flex; flex-direction: column; }
.pair-menu-back { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pair-process { display: flex; flex-direction: column; gap: 4px; }
.pair-process-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 2px 4px;
  font-family: inherit;
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.pair-process-toggle:hover { color: var(--dsw-alias-label-secondary); }
.pair-process-title { flex: 0 0 auto; font-weight: 500; }
.pair-process-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pair-process-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 4px 10px;
  border-left: 2px solid var(--dsw-alias-border-l2);
}
.pair-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 60;
  min-width: 180px;
  max-width: min(320px, 86vw);
  max-height: 52vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: var(--dsw-alias-bg-overlay);
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  box-shadow: 0 8px 24px rgba(0,0,0,.28);
}
.pair-menu-title { font-size: 11px; line-height: 16px; padding: 6px 8px 2px; color: var(--dsw-alias-label-tertiary); }
.pair-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}
.pair-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pair-menu-item[data-active="true"] { background: var(--dsw-alias-interactive-bg-active); }
.pair-menu-item small { display: block; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.pair-menu-check { width: 14px; color: var(--dsw-alias-state-business-primary); flex: 0 0 auto; }

.pair-attach-row { display: flex; gap: 6px; flex-wrap: wrap; padding: 2px 0; }
.pair-attach {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 46vw;
  padding: 3px 6px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l1);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.pair-attach img { width: 28px; height: 28px; object-fit: cover; border-radius: var(--dsw-radius-sm); }
.pair-attach-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pair-attach-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 12px;
}
.pair-attach-remove:hover { background: var(--dsw-alias-interactive-bg-hover); }

.pair-images { display: flex; flex-wrap: wrap; gap: 4px; }
.pair-image { display: block; max-width: 100%; max-height: 260px; border-radius: var(--dsw-radius-md); }
.pair-image-note { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

.pair-question {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-state-warn-primary);
}
.pair-question-title { font-size: 13px; line-height: 20px; font-weight: 600; }
.pair-question-item { display: flex; flex-direction: column; gap: 4px; }
.pair-question-header { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.pair-question-text { font-size: 13px; line-height: 20px; white-space: pre-wrap; word-break: break-word; }
.pair-question-options { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.pair-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l1);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--dsw-alias-label-primary);
}
.pair-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.pair-option[data-active="true"] {
  background: var(--dsw-alias-interactive-bg-active);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary);
}
.pair-option:disabled { opacity: .55; cursor: default; }
.pair-option-label { font-size: 13px; line-height: 20px; }
.pair-option-desc { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.pair-question-actions { display: flex; gap: 8px; margin-top: 2px; }
.pair-more {
  align-self: center;
  margin: 2px 0;
  padding: 4px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}
.pair-more:hover { background: var(--dsw-alias-interactive-bg-hover); }

.pair-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l1);
}
.pair-queue-title { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }
.pair-queue-item { display: flex; align-items: center; gap: 6px; }
.pair-queue-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.pair-file-link {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: var(--dsw-alias-label-primary);
  text-decoration: underline;
  text-decoration-color: var(--dsw-alias-border-l2);
  text-underline-offset: 2px;
}
.pair-file-link:hover { color: var(--dsw-alias-state-business-primary); }
.pair-file-link:disabled { cursor: default; text-decoration: none; }
.pair-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 600;
  background: rgba(0, 0, 0, .35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.pair-modal {
  width: min(760px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .28);
}
.pair-modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: .5px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.pair-modal-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.pair-modal-body { padding: 14px 16px; overflow-y: auto; }
.pair-modal-action {
  flex: 0 0 auto;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 11px;
  line-height: 22px;
  padding: 0 8px;
  cursor: pointer;
}
.pair-modal-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
body.pair-modal-open .pair-page { user-select: none; }
body.pair-modal-open .pair-modal { user-select: text; }
.pair-file-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 4px;
  border-radius: var(--dsw-radius-md);
  background: transparent;
}
.pair-file-head { display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%; text-align: left; font-family: inherit; }
.pair-file-tool {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary);
}
.pair-file-path {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}
.pair-file-preview {
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 96px;
  overflow: hidden;
}
.pair-file-code {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dsw-alias-label-secondary);
}

.pair-tree { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 120px; padding-right: 2px; box-sizing: border-box; width: 100%; }
.pair-search { position: sticky; top: 0; z-index: 2; padding: 2px 0 6px; background: var(--dsw-alias-bg-layer-1); }
.pair-search input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l1);
  font-family: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  outline: none;
}
.pair-search input:focus { box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary); }
.pair-ws-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
  color: inherit;
  text-align: left;
}
.pair-ws-add {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 18px;
  width: 22px;
  height: 22px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
  flex: 0 0 auto;
}
.pair-ws-add:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.pair-ws-more {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 18px;
  width: 22px;
  height: 22px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
  flex: 0 0 auto;
}
.pair-ws-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.pair-menu-danger { color: var(--dsw-alias-state-error-primary) !important; }
.pair-md-wrap { font-size: 15px; line-height: 1.6; color: var(--dsw-alias-label-primary); }
.pair-md { display: flex; flex-direction: column; gap: 7px; }
.pair-md-p { margin: 0; white-space: pre-wrap; word-break: break-word; }
.pair-md-h { margin: 8px 0 0; font-size: 17px; line-height: 1.35; font-weight: 600; }
.pair-md-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 3px; }
.pair-md-code {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.pair-md-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 0 0 10px 10px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
}
.pair-md-pre[data-wrap="true"] { white-space: pre-wrap; word-break: break-word; }
.pair-code {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}
.pair-code-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 10px;
  border-bottom: .5px solid var(--dsw-alias-border-l1);
}
.pair-code-lang {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pair-code-btn {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 11px;
  line-height: 20px;
  padding: 0 6px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
.pair-code-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.pair-reasoning-box { display: flex; flex-direction: column; gap: 2px; align-items: stretch; }
.pair-reasoning-item { display: flex; flex-direction: column; gap: 2px; }
.pair-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.pair-reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  padding: 2px 0;
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.pair-reasoning-toggle:hover { color: var(--dsw-alias-label-secondary); }
.pair-reasoning-icon { flex: 0 0 auto; font-size: 11px; }
.pair-reasoning-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pair-reasoning {
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  font-size: 12px;
  line-height: 1.65;
  color: var(--dsw-alias-label-secondary);
  max-height: 280px;
  overflow: auto;
}
.pair-file-stat {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.pair-tool-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  min-width: 0;
}
.pair-tool-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pair-tool-row[data-state="ok"] .pair-tool-caret { color: var(--dsw-alias-state-success-primary); }
.pair-tool-row[data-state="error"] { color: var(--dsw-alias-state-error-primary); }
.pair-diff {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  max-height: 320px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
}
.pair-diff-line { white-space: pre-wrap; word-break: break-word; display: flex; gap: 6px; }
.pair-diff-no {
  flex: 0 0 auto;
  width: 28px;
  text-align: right;
  color: var(--dsw-alias-label-dimmed);
  user-select: none;
}
.pair-diff-mark { flex: 0 0 auto; width: 8px; }
.pair-diff-text { flex: 1; min-width: 0; }
.pair-diff-skip {
  color: var(--dsw-alias-label-dimmed);
  font-style: italic;
  padding: 2px 0;
}
.pair-diff-add { color: var(--dsw-alias-state-success-primary); }
.pair-diff-del { color: var(--dsw-alias-state-error-primary); }
.pair-diff-same { color: var(--dsw-alias-label-tertiary); }
.pair-thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 4px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  flex: 0 0 auto;
}
.pair-thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  animation: pair-pulse 1.2s ease-in-out infinite;
}
@keyframes pair-pulse {
  0%, 100% { opacity: .3; }
  50% { opacity: 1; }
}
.pair-row-more {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 15px;
  line-height: 18px;
  width: 24px;
  height: 24px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
  flex: 0 0 auto;
}
.pair-row-more:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.pair-reasoning {
  margin: 2px 0 4px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 42vh;
  overflow-y: auto;
}
.pair-reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 1px 0;
  padding: 2px 6px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.pair-reasoning-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }

.pair-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  padding: 2px 0;
}
.pair-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 46vw;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pair-tool:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pair-tool-caret { font-size: 9px; color: var(--dsw-alias-label-tertiary); }

@media (min-width: 600px) {
  .pair-panes { display: flex; gap: 16px; flex: 1; min-height: 0; }
  .pair-tree-pane { width: 280px; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; gap: 8px; }
  .pair-detail-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
@media (min-width: 840px) {
  .pair-tree-pane { width: 320px; }
}
}
@media (max-width: 599px) {
  .pair-panes { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .pair-tree-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 8px; }
  .pair-detail-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
}
`

    function StyleSheet() {
      return h('style', { dangerouslySetInnerHTML: { __html: CSS_TEXT } })
    }

    // -----------------------------------------------------------------------
    // 基础
    // -----------------------------------------------------------------------
    // 页面（client.js）自身的构建版本，和 package.json 一起由发版脚本同步。
    const CLIENT_BUILD = '0.4.64'

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

    function queuedText(item) {
      const blocks = Array.isArray(item && item.content) ? item.content : []
      const text = blocks
        .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join(' ')
        .trim()
      return text || '（非文本内容）'
    }

    /** 手机拍的图通常几 MB，先压到长边 1600 的 JPEG，上传快很多。 */
    async function compressImage(file, maxEdge = 1600, quality = 0.82) {
      try {
        if (typeof createImageBitmap !== 'function') return null
        const bitmap = await createImageBitmap(file)
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
        if (scale === 1 && file.size <= 400 * 1024) return null
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(bitmap, 0, 0, width, height)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        return blob || null
      } catch {
        return null
      }
    }

    function readAsBase64(file) {      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          const comma = result.indexOf(',')
          resolve(comma >= 0 ? result.slice(comma + 1) : '')
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
    }

    function useNarrow() {
      const [narrow, setNarrow] = React.useState(false)
      React.useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined
        const mq = window.matchMedia('(max-width: 599px)')
        const update = () => setNarrow(Boolean(mq.matches))
        update()
        if (mq.addEventListener) mq.addEventListener('change', update)
        return () => { if (mq.removeEventListener) mq.removeEventListener('change', update) }
      }, [])
      return narrow
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
      return h('div', { className: 'pair-card', style }, children)
    }

    function Button({ children, onClick, kind = 'ghost', size = 'md', disabled = false, style, title }) {
      const cls = ['pair-btn', kind !== 'ghost' ? `pair-btn--${kind}` : '', size === 'sm' ? 'pair-btn--sm' : '']
        .filter(Boolean)
        .join(' ')
      return h('button', {
        type: 'button',
        title,
        onClick,
        disabled,
        className: cls,
        style,
      }, children)
    }

    function Empty({ children }) {
      return h('div', {
        style: {
          padding: '24px 12px', textAlign: 'center', fontSize: 12,
          color: 'var(--dsw-alias-label-tertiary)',
        },
      }, children)
    }

    /** 点外面关掉的浮层菜单。 */
    function PopMenu({ open, onClose, children, style }) {
      const ref = React.useRef(null)
      const [pos, setPos] = React.useState(null)
      React.useEffect(() => {
        if (!open) {
          setPos(null)
          return undefined
        }
        // 按触发元素的位置算，改成 fixed 免得被 composer 的裁剪和滚动带偏
        const frame = requestAnimationFrame(() => {
          const node = ref.current
          const anchor = node && node.parentElement
          if (!anchor) return
          const rect = anchor.getBoundingClientRect()
          const width = Math.min(240, window.innerWidth - 16)
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
          const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 120))
          // 剩下的可视高度决定菜单最大高度，否则底部会撑出屏幕、滑不到
          const maxHeight = Math.max(160, window.innerHeight - top - 12)
          setPos({ left, top, width, maxHeight })
        })
        return () => cancelAnimationFrame(frame)
      }, [open])
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const node = ref.current
          if (node && event.target instanceof Node && !node.contains(event.target)) onClose()
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [open, onClose])
      if (!open) return null
      return h('div', { ref, className: 'pair-menu', style: { position: 'fixed', ...pos, ...style } }, children)
    }

    // -----------------------------------------------------------------------
    // 配置表单（手机端）
    // -----------------------------------------------------------------------
    function ConfigForm({ info, onSaved }) {
      const [pairUrl, setPairUrl] = React.useState(info && info.host ? info.host : '')
      const [secret, setSecret] = React.useState('')
      const [bridgeToken, setBridgeToken] = React.useState('')
      const [bridgePassword, setBridgePassword] = React.useState('')
      const [giteeRepo, setGiteeRepo] = React.useState(info && info.giteeRepo ? info.giteeRepo : '')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [saved, setSaved] = React.useState(false)

      const save = async () => {
        setBusy(true)
        setError(null)
        try {
          const body = {}
          if (pairUrl.trim()) body.pairUrl = pairUrl.trim()
          if (secret.trim()) body.secret = secret.trim()
          if (bridgeToken.trim()) body.bridgeToken = bridgeToken.trim()
          if (bridgePassword.trim()) body.bridgePassword = bridgePassword.trim()
          if (giteeRepo.trim()) body.giteeRepo = giteeRepo.trim()
          await callJson('', '/dsh-pair/config', { method: 'POST', body: JSON.stringify(body) })
          setSaved(true)
          setSecret('')
          setBridgePassword('')
          if (onSaved) onSaved()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      return h(Card, { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { fontSize: 14, lineHeight: '22px', fontWeight: 600 } }, '连接这台电脑'),
        h('div', { className: 'pair-hint', style: { marginTop: 4 } },
          '填电脑上「远程电脑」面板顶部显示的公网地址和配对密钥。'),

        h('label', { className: 'pair-label' }, '电脑地址'),
        h('div', { className: 'pair-field' },
          h('input', {
            value: pairUrl,
            placeholder: 'https://xxxx.trycloudflare.com',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            onChange: (e) => setPairUrl(e.target.value),
          })),

        h('label', { className: 'pair-label' }, '配对密钥'),
        h('div', { className: 'pair-field' },
          h('input', {
            value: secret,
            type: 'password',
            placeholder: info && info.hasSecret ? '已保存，留空表示不修改' : '电脑端 secret',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            onChange: (e) => setSecret(e.target.value),
          })),

        h('label', { className: 'pair-label' }, '访问密码（可选）'),
        h('div', { className: 'pair-field' },
          h('input', {
            value: bridgePassword,
            type: 'password',
            placeholder: info && info.hasBridgePassword ? '已保存，留空表示不修改' : '只有电脑前面有登录墙时才需要',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            onChange: (e) => setBridgePassword(e.target.value),
          })),
        h('div', { className: 'pair-hint', style: { marginTop: 6 } },
          '电脑端自带专用隧道，一般不用填密码。'),

        h('label', { className: 'pair-label' }, 'Gitee 仓库（可选）'),
        h('div', { className: 'pair-field' },
          h('input', {
            value: giteeRepo,
            placeholder: 'twinklem/dsh-pair-link',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            onChange: (e) => setGiteeRepo(e.target.value),
          })),
        h('div', { className: 'pair-hint', style: { marginTop: 6 } },
          '填了就和 GitHub 一起作为地址来源，手机端会两处都试。'),

        h('label', { className: 'pair-label' }, '桥接令牌（可选）'),
        h('div', { className: 'pair-field' },
          h('input', {
            value: bridgeToken,
            type: 'password',
            placeholder: '远程访问插件的免密令牌',
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            onChange: (e) => setBridgeToken(e.target.value),
          })),

        error ? h('div', { className: 'pair-error', style: { marginTop: 10 } }, error) : null,
        saved ? h('div', { className: 'pair-ok', style: { marginTop: 10 } }, '已保存并生效') : null,

        h('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
          h(Button, { kind: 'primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存并连接'),
          info && info.host
            ? h(Button, {
              kind: 'outline',
              onClick: () => { setPairUrl(''); setSecret(''); setBridgeToken(''); setBridgePassword('') },
            }, '清空')
            : null))
    }

    // -----------------------------------------------------------------------
    // 工作区 / 会话树
    // -----------------------------------------------------------------------
    function FolderIcon({ size = 14 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary)' },
      },
      h('path', {
        d: 'M1.5 3.5h4l1.2 1.5h7.8v7.5a1 1 0 0 1-1 1H1.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinejoin: 'round',
      }))
    }

    function SessionRow({ session, active, onOpen, onMenu }) {
      const title = session.title && session.title.trim()
        ? session.title
        : `未命名 · ${basename(session.cwd) || '会话'}`
      return h('div', {
        className: 'pair-row',
        'data-active': active ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        onClick: () => onOpen(session.id),
        onKeyDown: (e) => { if (e.key === 'Enter') onOpen(session.id) },
        onContextMenu: onMenu
          ? (e) => {
            e.preventDefault()
            onMenu(session, e.currentTarget.getBoundingClientRect())
          }
          : undefined,
      },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
          session.running ? h(Dot, { tone: 'ok' }) : null,
          session.pendingInput === 'approval' || session.pendingInput === 'question'
            ? h(Dot, { tone: 'warn' })
            : null,
          h('span', { className: 'pair-row-title' }, title)),
        h('div', { className: 'pair-row-meta' },
          h('span', null, formatWhen(session.updatedAt)),
          session.cwd
            ? h('span', {
              style: {
                overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 150, whiteSpace: 'nowrap',
              },
            }, basename(session.cwd))
            : null)),
      onMenu
        ? h('button', {
          type: 'button',
          className: 'pair-row-more',
          title: '更多操作',
          onClick: (e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            onMenu(session, rect)
          },
        }, '⋯')
        : null,
      active ? h('span', { style: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 13 } }, '•') : null)
    }

    function WorkspaceTree({ tree, activeId, onOpen, collapsed, onToggle, q, onQuery, onCreate, onMenu, onWorkspaceMenu }) {
      if (!tree) return h(Empty, null, '正在读取工作区…')
      const workspaces = tree.workspaces || []
      const others = tree.others || []
      const query = String(q || '').trim().toLowerCase()
      const matches = (session) => {
        if (!query) return true
        const haystack = `${session.title || ''} ${session.cwd || ''}`.toLowerCase()
        return haystack.includes(query)
      }

      const group = (key, label, sessions, collapsible, collapsedNow, toggle, workspaceId) => {
        const visible = sessions.filter(matches)
        if (!visible.length && query) return null
        if (!visible.length && !collapsible) return null
        return h('div', { key },
          collapsible
            ? h('div', { className: 'pair-ws' },
              h('button', {
                type: 'button',
                className: 'pair-ws-main',
                onClick: toggle,
              },
              h('span', { className: 'pair-ws-caret' }, collapsedNow ? '›' : '⌄'),
              h(FolderIcon, null),
              h('span', { className: 'pair-ws-title' }, label),
              h('span', { className: 'pair-ws-count' }, String(visible.length))),
              workspaceId && onCreate
                ? h('button', {
                  type: 'button',
                  className: 'pair-ws-add',
                  title: '在这个工作区新建会话',
                  onClick: () => onCreate(workspaceId),
                }, '＋')
                : null,
              workspaceId && onWorkspaceMenu
                ? h('button', {
                  type: 'button',
                  className: 'pair-ws-more',
                  title: '工作区操作',
                  onClick: (e) => {
                    e.stopPropagation()
                    const rect = e.currentTarget.getBoundingClientRect()
                    onWorkspaceMenu({ id: workspaceId, title: label }, rect)
                  },
                }, '⋯')
                : null)
            : h('div', { className: 'pair-ws', style: { cursor: 'default' } },
              h('span', { className: 'pair-ws-caret' }),
              h('span', { className: 'pair-ws-title' }, label),
              h('span', { className: 'pair-ws-count' }, String(visible.length))),
          collapsedNow
            ? null
            : h('div', { className: 'pair-ws-sessions' },
              visible.map((session) => h(SessionRow, {
                key: session.id,
                session,
                active: session.id === activeId,
                onOpen,
                onMenu,
              }))))
      }

      return h('div', { className: 'pair-tree' },
        h('div', { className: 'pair-search' },
          h('input', {
            value: q || '',
            placeholder: '搜索会话标题 / 路径',
            onChange: (e) => onQuery(e.target.value),
          })),
        workspaces.map((workspace) => group(
          workspace.id,
          workspace.title || basename(workspace.path),
          workspace.sessions,
          true,
          collapsed.has(workspace.id),
          () => onToggle(workspace.id),
          workspace.id,
        )),
        group(
          '__others__',
        '其他会话',
        others,
        true,
        collapsed.has('__others__'),
        () => onToggle('__others__'),
      ))
    }

    // -----------------------------------------------------------------------
    // 模型 / 权限选择
    // -----------------------------------------------------------------------
    function ModelPicker({ meta, onPick, disabled }) {
      const [open, setOpen] = React.useState(false)
      const [expanded, setExpanded] = React.useState(null)
      const current = meta && meta.model ? meta.model : null
      const models = meta && meta.models ? meta.models : null
      const label = current
        ? `${current.model}${current.reasoningEffort ? ` · ${current.reasoningEffort}` : ''}`
        : '模型'

      const groups = models && Array.isArray(models.groups) ? models.groups : []
      // 同名模型合并成一条，推理强度作为二级选择
      const entries = []
      for (const group of groups) {
        for (const model of group.models ?? []) {
          const efforts = model.reasoning && Array.isArray(model.reasoning.efforts) ? model.reasoning.efforts : []
          entries.push({
            key: `${group.id}/${model.id}`,
            group: group.name || group.id,
            provider: group.id,
            model,
            efforts,
          })
        }
      }

      const pick = (entry, effortId) => {
        setOpen(false)
        setExpanded(null)
        onPick({ provider: entry.provider, model: entry.model, effort: effortId ?? null })
      }

      const isCurrentEntry = (entry) => current
        && current.model === entry.model.id
        && (!current.provider || current.provider === entry.provider)

      const renderEntry = (entry) => {
        const active = isCurrentEntry(entry)
        const activeEffort = active ? (current.reasoningEffort ?? null) : null
        const currentEffort = entry.efforts.find((effort) => effort.id === activeEffort)
        if (expanded === entry.key) {
          return h('div', { key: entry.key, className: 'pair-menu-sub' },
            h('button', {
              type: 'button',
              className: 'pair-menu-item pair-menu-back',
              onClick: () => setExpanded(null),
            }, '‹ 返回'),
            entry.efforts.map((effort) => h('button', {
              key: effort.id,
              type: 'button',
              className: 'pair-menu-item',
              'data-active': activeEffort === effort.id ? 'true' : 'false',
              onClick: () => pick(entry, effort.id),
            },
            h('span', { className: 'pair-menu-check' }, activeEffort === effort.id ? '✓' : ''),
            h('span', { style: { flex: 1, minWidth: 0 } }, effort.name || effort.id))))
        }
        const multiple = entry.efforts.length > 1
        return h('button', {
          key: entry.key,
          type: 'button',
          className: 'pair-menu-item',
          'data-active': active ? 'true' : 'false',
          onClick: () => {
            if (multiple) setExpanded(entry.key)
            else pick(entry, entry.efforts[0] ? entry.efforts[0].id : null)
          },
        },
        h('span', { className: 'pair-menu-check' }, active ? '✓' : ''),
        h('span', { style: { flex: 1, minWidth: 0 } },
          h('span', null, entry.model.name || entry.model.id),
          h('small', null, activeEffort
            ? `${entry.group} · ${currentEffort ? (currentEffort.name || currentEffort.id) : activeEffort}`
            : entry.group)),
        multiple ? h('span', { className: 'pair-tool-caret' }, '›') : null)
      }

      return h('div', { className: 'pair-menu-anchor' },
        h('button', {
          type: 'button',
          className: 'pair-tool',
          disabled,
          onClick: () => {
            setExpanded(null)
            setOpen((value) => !value)
          },
          title: '模型',
        },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
        h('span', { className: 'pair-tool-caret' }, '▾')),
        h(PopMenu, { open, onClose: () => { setOpen(false); setExpanded(null) } },
          h('div', { className: 'pair-menu-title' }, '模型'),
          entries.length === 0
            ? h('div', { className: 'pair-hint', style: { padding: '6px 8px' } }, '没有可切换的模型')
            : entries.map(renderEntry)))
    }

    function PermissionPicker({ meta, onPick, disabled }) {
      const [open, setOpen] = React.useState(false)
      const permission = meta && meta.permission ? meta.permission : null
      const options = permission && Array.isArray(permission.options) ? permission.options : []
      const current = permission && permission.current ? permission.current : ''
      const currentOption = options.find((option) => option.value === current)

      return h('div', { className: 'pair-menu-anchor' },
        h('button', {
          type: 'button',
          className: 'pair-tool',
          disabled: disabled || options.length === 0,
          onClick: () => setOpen((value) => !value),
          title: '运行范围',
        },
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } },
          currentOption ? (currentOption.name || currentOption.value) : (current || '范围')),
        h('span', { className: 'pair-tool-caret' }, '▾')),
        h(PopMenu, { open, onClose: () => setOpen(false) },
          h('div', { className: 'pair-menu-title' }, '运行范围'),
          options.map((option) => h('button', {
            key: option.value,
            type: 'button',
            className: 'pair-menu-item',
            'data-active': option.value === current ? 'true' : 'false',
            onClick: () => {
              setOpen(false)
              onPick(option.value)
            },
          },
          h('span', { className: 'pair-menu-check' }, option.value === current ? '✓' : ''),
          h('span', { style: { flex: 1, minWidth: 0 } },
            h('span', null, option.name || option.value),
            option.description ? h('small', null, option.description) : null)))))
    }

    // -----------------------------------------------------------------------
    // 对话详情
    // -----------------------------------------------------------------------
    /** 把思考正文切成有意义的几段：丢掉纯时间戳/单字碎片，短段并入相邻段。 */
    function groupReasoning(text) {
      const raw = String(text || '')
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
      const noise = (part) => {
        if (/^\**\s*(时间|time)\s*[:：]?\s*\d{1,2}[:：]\d{2}/i.test(part)) return true
        const bare = part.replace(/[\s*`#>\-]/g, '')
        return bare.length < 8
      }
      const kept = []
      for (const part of raw) {
        if (noise(part)) continue
        const last = kept[kept.length - 1]
        // 短段（不足 40 字）并入上一段，避免「执行」「写」这种碎片各占一行
        if (last !== undefined && (part.length < 40 || last.length < 40)) {
          kept[kept.length - 1] = `${last}\n\n${part}`
        } else {
          kept.push(part)
        }
      }
      return kept
    }

    function Reasoning({ text }) {
      const segments = groupReasoning(text)
      if (segments.length === 0) return null
      return h('div', { className: 'pair-reasoning-box' },
        segments.map((segment, index) => h(ReasoningSegment, {
          key: index,
          text: segment,
        })))
    }

    /** 一段思考：折叠成一行摘要，点开看全文。 */
    function ReasoningSegment({ text }) {
      const [open, setOpen] = React.useState(false)
      const flat = String(text).replace(/\s+/g, ' ').trim()
      const summary = flat.length > 64 ? `${flat.slice(0, 64)}…` : flat
      return h('div', { className: 'pair-reasoning-item' },
        h('button', {
          type: 'button',
          className: 'pair-reasoning-toggle',
          onClick: () => setOpen((value) => !value),
        },
        h(SparkIcon, null),
        h('span', { className: 'pair-reasoning-summary' }, open ? '思考' : `思考 · ${summary}`),
        h('span', { className: 'pair-tool-caret' }, open ? '⌄' : '›')),
        open
          ? h('div', { className: 'pair-reasoning' }, h(MarkdownText, { text }))
          : null)
    }

    function ImageGroup({ images }) {
      if (!Array.isArray(images) || images.length === 0) return null
      return h('div', { className: 'pair-images' },
        images.map((image, index) => {
          if (!image || image.tooLarge) {
            return h('div', { key: `large-${index}`, className: 'pair-image-note' }, '[图片过大，未内联显示]')
          }
          const src = `data:${image.mediaType || 'image/png'};base64,${image.data || ''}`
          return h('img', {
            key: `img-${index}`,
            src,
            alt: '',
            className: 'pair-image',
            loading: 'lazy',
          })
        }))
    }

    function QuestionCard({ message, onAnswer, busy, readOnly = false }) {
      const questions = Array.isArray(message.questions) ? message.questions : []
      const [selected, setSelected] = React.useState({})
      const [custom, setCustom] = React.useState({})
      const [error, setError] = React.useState(null)
      const [submitted, setSubmitted] = React.useState(false)
      const showPending = message.pending !== false
      const pending = showPending && !submitted && !readOnly

      const toggle = (question, label) => {
        if (!pending) return
        setSelected((prev) => {
          const current = prev[question.id] || []
          const next = question.multiSelect
            ? (current.includes(label) ? current.filter((item) => item !== label) : [...current, label])
            : [label]
          return { ...prev, [question.id]: next }
        })
        setCustom((prev) => ({ ...prev, [question.id]: '' }))
      }

      const answerOf = (question) => {
        const typed = String(custom[question.id] || '').trim()
        const picked = selected[question.id] || []
        return { id: question.id, selected: picked, ...(typed ? { custom: typed } : {}) }
      }

      const ready = pending && questions.every((question) => {
        const typed = String(custom[question.id] || '').trim()
        return typed.length > 0 || (selected[question.id] || []).length > 0
      })

      const submit = async () => {
        if (!ready || busy) return
        setError(null)
        try {
          await onAnswer(message.callId, questions.map(answerOf))
          setSubmitted(true)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      return h('div', { className: 'pair-question' },
        h('div', { className: 'pair-question-title' },
          showPending
            ? (readOnly ? '需要你的回答（在下方浮层作答）' : '需要你的回答')
            : '已回答'),
        questions.map((question) => h('div', { key: question.id, className: 'pair-question-item' },
          question.header ? h('div', { className: 'pair-question-header' }, question.header) : null,
          h('div', { className: 'pair-question-text' }, question.question),
          question.detail ? h('div', { className: 'pair-hint' }, question.detail) : null,
          (question.options || []).length > 0
            ? h('div', { className: 'pair-question-options' },
              question.options.map((option) => h('button', {
                key: option.label,
                type: 'button',
                className: 'pair-option',
                'data-active': (selected[question.id] || []).includes(option.label) ? 'true' : 'false',
                disabled: !pending || busy,
                onClick: () => toggle(question, option.label),
              },
              h('span', { className: 'pair-option-label' }, option.label),
              option.description ? h('span', { className: 'pair-option-desc' }, option.description) : null)))
            : null,
          pending
            ? h('div', { className: 'pair-field', style: { marginTop: 2 } },
              h('input', {
                value: custom[question.id] || '',
                placeholder: '其他（自己输入答案）',
                disabled: busy,
                onChange: (e) => {
                  const value = e.target.value
                  setCustom((prev) => ({ ...prev, [question.id]: value }))
                  if (value.trim()) setSelected((prev) => ({ ...prev, [question.id]: [] }))
                },
              }))
            : null)),
        error ? h('div', { className: 'pair-error' }, error) : null,
        pending
          ? h('div', { className: 'pair-question-actions' },
            h(Button, { kind: 'primary', size: 'sm', onClick: submit, disabled: !ready || busy },
              busy ? '提交中…' : '提交回答'))
          : null)
    }

    function FilePreviewModal({ preview, onClose, base }) {
      const [current, setCurrent] = React.useState(preview)
      React.useEffect(() => { setCurrent(preview) }, [preview])
      React.useEffect(() => {
        if (!preview) return undefined
        // 弹层打开期间让页面其它部分不可选，Ctrl+A 只会选中弹层内容
        document.body.classList.add('pair-modal-open')
        return () => document.body.classList.remove('pair-modal-open')
      }, [preview])
      if (!preview) return null

      const dirOf = (value) => {
        const parts = String(value || '').split(/[\\/]/)
        parts.pop()
        return parts.join('\\')
      }

      const openLinked = async (raw) => {
        const target = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/')
          ? raw
          : `${dirOf(current && current.path ? current.path : '')}\\${String(raw).replace(/^[.\\/]+/, '')}`
        try {
          const data = await callJson(base || '', `/file?path=${encodeURIComponent(target)}`)
          setCurrent({ path: data.path || target, content: String(data.content ?? '') })
        } catch (err) {
          setCurrent({ path: target, error: String(err && err.message ? err.message : err) })
        }
      }

      const openNative = async () => {
        const target = current && current.path ? current.path : preview.path
        if (!target) return
        const remote = String(base || '').includes('/remote/')
        if (remote) {
          // 手机端：文件在电脑上，能做的就是把它下载到手机上再用手机的方式打开
          try {
            const data = await callJson(base, `/file?path=${encodeURIComponent(target)}`)
            const blob = new Blob([String(data.content ?? '')], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = basename(target) || 'file.txt'
            document.body.appendChild(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(url), 2000)
          } catch { /* ignore */ }
          return
        }
        // 电脑端：直接交给系统默认程序
        try {
          await callJson(base || '', '/open', { method: 'POST', body: JSON.stringify({ path: target }) })
        } catch { /* ignore */ }
      }

      return h('div', { className: 'pair-modal-backdrop', onClick: onClose },
        h('div', { className: 'pair-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'pair-modal-head' },
            h('span', { className: 'pair-modal-title' }, current && current.path ? current.path : preview.path),
            h('button', { type: 'button', className: 'pair-modal-action', onClick: openNative },
              String(base || '').includes('/remote/') ? '下载到手机' : '用本机打开'),
            h('button', { type: 'button', className: 'pair-more', onClick: onClose }, '×')),
          h('div', { className: 'pair-modal-body' },
            current && current.error
              ? h('div', { className: 'pair-error' }, current.error)
              : h(MarkdownText, { text: (current || preview).content, onOpenFile: openLinked }))))
    }

    /** diff 渲染：行号 + 长段未改动折叠。 */
    function DiffView({ lines }) {
      if (!Array.isArray(lines) || lines.length === 0) return null
      const items = []
      let sameRun = []
      const flushSame = () => {
        if (sameRun.length > 8) {
          items.push(...sameRun.slice(0, 3))
          items.push({ type: 'skip', count: sameRun.length - 6 })
          items.push(...sameRun.slice(-3))
        } else {
          items.push(...sameRun)
        }
        sameRun = []
      }
      for (const line of lines) {
        if (line.type === 'same') sameRun.push(line)
        else {
          flushSame()
          items.push(line)
        }
      }
      flushSame()

      return h('div', { className: 'pair-diff' }, items.map((line, index) => {
        if (line.type === 'skip') {
          return h('div', { key: `skip${index}`, className: 'pair-diff-skip' }, `… ${line.count} 行未改动`)
        }
        return h('div', { key: index, className: `pair-diff-line pair-diff-${line.type}` },
          h('span', { className: 'pair-diff-no' }, line.oldLine === undefined ? '' : String(line.oldLine)),
          h('span', { className: 'pair-diff-no' }, line.newLine === undefined ? '' : String(line.newLine)),
          h('span', { className: 'pair-diff-mark' }, line.type === 'add' ? '+' : (line.type === 'del' ? '-' : ' ')),
          h('span', { className: 'pair-diff-text' }, line.text))
      }))
    }

    function FileEditCard({ message, base }) {
      const [open, setOpen] = React.useState(false)
      const [preview, setPreview] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const body = String(message.body || '')
      const oldText = String(message.oldText || '')
      const content = body || oldText
      const isWrite = message.tool === 'write'
      const isText = /\.(md|markdown|txt|json|jsonc|js|cjs|mjs|ts|tsx|jsx|py|yml|yaml|css|html|sh|ps1)$/i.test(message.text)

      const openFile = async () => {
        if (!isText || busy) return
        setBusy(true)
        try {
          const data = await callJson(base || '', `/file?path=${encodeURIComponent(message.text)}`)
          setPreview({ path: data.path || message.text, content: String(data.content ?? '') })
        } catch (err) {
          setPreview({ path: message.text, error: String(err && err.message ? err.message : err) })
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'pair-file-edit' },
        h('div', { className: 'pair-file-head' },
          h('span', { className: 'pair-file-tool' }, isWrite ? '写入' : '编辑'),
          h('button', {
            type: 'button',
            className: isText ? 'pair-file-path pair-file-link' : 'pair-file-path',
            onClick: openFile,
            disabled: !isText || busy,
            title: isText ? '打开文件' : '不支持预览',
          }, message.text),
          h('span', { className: 'pair-file-stat' }, `+${message.added ?? 0} -${message.removed ?? 0}`),
          content
            ? h('button', {
              type: 'button',
              className: 'pair-more',
              onClick: () => setOpen((value) => !value),
            }, open ? '⌄' : '›')
            : null),
        open && content
          ? (Array.isArray(message.diff) && message.diff.length > 0
            ? h(DiffView, { lines: message.diff })
            : h('pre', { className: 'pair-file-code' }, content))
          : null,
        h(FilePreviewModal, { preview, onClose: () => setPreview(null), base }))
    }

    function inlineNodes(text, onOpenFile) {
      const nodes = []
      const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|([A-Za-z]:\\[^\s"'`<>|]+?\.(?:md|markdown|txt|json|js|ts|jsx|tsx|py|yml|yaml|css|html)))/g
      let last = 0
      let match = re.exec(text)
      while (match) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        if (match[2] !== undefined) nodes.push(h('strong', { key: `b${match.index}` }, match[2]))
        else if (match[3] !== undefined) nodes.push(h('code', { key: `c${match.index}`, className: 'pair-md-code' }, match[3]))
        else if (match[4] !== undefined) {
          const href = match[5]
          if (/^https?:/i.test(href) || href.startsWith('#')) {
            nodes.push(h('a', { key: `a${match.index}`, href, target: '_blank', rel: 'noreferrer' }, match[4]))
          } else if (onOpenFile) {
            nodes.push(h('button', {
              key: `f${match.index}`,
              type: 'button',
              className: 'pair-file-link',
              onClick: () => onOpenFile(href),
            }, match[4]))
          } else {
            nodes.push(match[4])
          }
        } else if (match[6] !== undefined && onOpenFile) {
          nodes.push(h('button', {
            key: `p${match.index}`,
            type: 'button',
            className: 'pair-file-link',
            onClick: () => onOpenFile(match[6]),
          }, match[6]))
        }
        last = match.index + match[0].length
        match = re.exec(text)
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes.length > 0 ? nodes : [text]
    }

    /** 轻量 Markdown：标题、列表、代码块、粗体、行内代码、链接。 */
    function MarkdownText({ text, onOpenFile }) {
      const lines = String(text || '').split('\n')
      const blocks = []
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (/^```/.test(line)) {
          const lang = line.slice(3).trim()
          const body = []
          i += 1
          while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1 }
          i += 1
          blocks.push(h(CodeBlock, { key: `pre${i}`, code: body.join('\n'), lang }))
          continue
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          const level = Math.min(heading[1].length + 2, 5)
          blocks.push(h(`h${level}`, { key: `h${i}`, className: 'pair-md-h' }, inlineNodes(heading[2], onOpenFile)))
          i += 1
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const items = []
          const ordered = /^\s*\d+\./.test(line)
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
            items.push(h('li', { key: `li${i}` }, inlineNodes(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''), onOpenFile)))
            i += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key: `list${i}`, className: 'pair-md-list' }, items))
          continue
        }
        if (!line.trim()) { i += 1; continue }
        const para = []
        while (
          i < lines.length && lines[i].trim()
          && !/^```/.test(lines[i])
          && !/^(#{1,4})\s+/.test(lines[i])
          && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
        ) {
          para.push(lines[i])
          i += 1
        }
        blocks.push(h('p', { key: `p${i}`, className: 'pair-md-p' }, inlineNodes(para.join('\n'), onOpenFile)))
      }
      return h('div', { className: 'pair-md' }, blocks)
    }

    /** 一个回合里的「过程」：思考、工具、文件改动都收在这里，折叠成一个分组。 */
    /** 代码块：带「自动换行」「复制」，对齐原生渲染。 */
    function CodeBlock({ code, lang }) {
      const [wrap, setWrap] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* ignore */ }
      }
      return h('div', { className: 'pair-code' },
        h('div', { className: 'pair-code-head' },
          h('span', { className: 'pair-code-lang' }, lang || '代码块'),
          h('button', {
            type: 'button',
            className: 'pair-code-btn',
            onClick: () => setWrap((value) => !value),
            title: wrap ? '取消自动换行' : '自动换行',
          }, wrap ? '不换行' : '自动换行'),
          h('button', {
            type: 'button',
            className: 'pair-code-btn',
            onClick: copy,
            title: '复制代码',
          }, copied ? '已复制' : '复制')),
        h('pre', {
          className: 'pair-md-pre',
          'data-wrap': wrap ? 'true' : 'false',
        }, h('code', null, code)))
    }

    /** 过程分组的图标（对应 DSHM 的 square_stack_3d）。 */
    function ListIcon({ size = 12 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-tertiary)' },
      },
      h('path', {
        d: 'M3 4h10M3 8h10M3 12h6',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
      }))
    }

    /** 思考的星花图标（对应 DSHM 的 reasoning 标记）。 */
    function SparkIcon({ size = 12 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flex: '0 0 auto', color: 'var(--dsw-alias-state-success-primary)' },
      },
      h('path', {
        d: 'M8 1.8v12.4M1.8 8h12.4M3.5 3.5l9 9M12.5 3.5l-9 9',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
      }))
    }

    function ProcessGroup({ items, base, cwd }) {
      const [open, setOpen] = React.useState(false)
      if (!Array.isArray(items) || items.length === 0) return null
      const tools = items.filter((item) => item.role === 'tool').length
      const edits = items.filter((item) => item.role === 'file-edit').length
      const parts = []
      if (tools > 0) parts.push(`${tools} 次调用`)
      if (edits > 0) parts.push(`${edits} 处改动`)
      return h('div', { className: 'pair-process' },
        h('button', {
          type: 'button',
          className: 'pair-process-toggle',
          onClick: () => setOpen((value) => !value),
        },
        h('span', { className: 'pair-tool-caret' }, open ? '⌄' : '›'),
        h(ListIcon, null),
        h('span', { className: 'pair-process-title' }, '过程'),
        h('span', { className: 'pair-process-meta' }, parts.join(' · '))),
        open
          ? h('div', { className: 'pair-process-body' },
            items.map((item, index) => h(MessageBubble, {
              key: `${item.seq}-${index}`,
              message: item,
              readOnly: true,
              base,
              cwd,
            })))
          : null)
    }

    /** 同步工作区：两边各选一个目录，比对后按方向传差异文件。 */
    function SyncPanel({ base, tree, onClose }) {
      // 远端（电脑）的工作区来自传入的 tree；本机（手机）的单独向本地插件要
      const remoteWorkspaces = (tree && Array.isArray(tree.workspaces) ? tree.workspaces : [])
        .map((workspace) => ({ id: workspace.id, path: workspace.path, title: workspace.title || workspace.path }))
      const [allRemote, setAllRemote] = React.useState([])
      React.useEffect(() => {
        let alive = true
        callJson(base, '/workspaces')
          .then((data) => {
            if (!alive) return
            const list = Array.isArray(data.workspaces) ? data.workspaces : []
            setAllRemote(list.map((workspace) => ({
              id: workspace.id,
              path: workspace.path,
              title: workspace.title || workspace.path,
            })))
          })
          .catch(() => { /* 拿不到就退回 tree 里的 */ })
        return () => { alive = false }
      }, [base])
      const remoteOptions = allRemote.length > 0 ? allRemote : remoteWorkspaces
      const [localWorkspaces, setLocalWorkspaces] = React.useState([])
      React.useEffect(() => {
        let alive = true
        callJson('', '/dsh-pair/api/tree')
          .then((data) => {
            if (!alive) return
            const list = Array.isArray(data.workspaces) ? data.workspaces : []
            setLocalWorkspaces(list.map((workspace) => ({
              id: workspace.id,
              path: workspace.path,
              title: workspace.title || workspace.path,
            })))
          })
          .catch(() => { /* 本机拿不到就退回手填 */ })
        return () => { alive = false }
      }, [])
      const [manualLocal, setManualLocal] = React.useState(false)
      const [manualRemote, setManualRemote] = React.useState(false)
      const [localDir, setLocalDir] = React.useState('')
      React.useEffect(() => {
        // 本机工作区是异步拿的，回来了才把默认值填上，别覆盖用户已经改过的
        if (localDir) return
        const preferred = localWorkspaces.find((workspace) => /同步工作区$/.test(workspace.path))
        const pick = preferred || localWorkspaces[0]
        if (pick) setLocalDir(pick.path)
        else if (!manualLocal) setLocalDir('/storage/Users/currentUser/Documents/同步工作区')
      }, [localWorkspaces])
      const [remoteDir, setRemoteDir] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [comparing, setComparing] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [done, setDone] = React.useState(null)

      const registerLocal = async () => {
        const target = String(localDir || '').trim()
        if (!target) return
        setBusy(true)
        setError(null)
        setDone(null)
        try {
          await callJson('', '/dsh-pair/api/workspaces', {
            method: 'POST',
            body: JSON.stringify({ path: target }),
          })
          const data = await callJson('', '/dsh-pair/api/tree')
          const list = Array.isArray(data.workspaces) ? data.workspaces : []
          setLocalWorkspaces(list.map((workspace) => ({
            id: workspace.id,
            path: workspace.path,
            title: workspace.title || workspace.path,
          })))
          setDone('已注册为工作区，下拉里应该能看到了')
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      const compare = async () => {
        setError(null)
        setDone(null)
        setBusy(true)
        try {
          const remote = await callJson(base, `/sync?dir=${encodeURIComponent(remoteDir)}`)
          const local = await callJson('', `/dsh-pair/api/sync?dir=${encodeURIComponent(localDir)}`)
          const remoteMap = new Map((remote.files || []).map((file) => [file.path, file]))
          const localMap = new Map((local.files || []).map((file) => [file.path, file]))
          const onlyRemote = []
          const onlyLocal = []
          const differing = []
          for (const [path, file] of remoteMap) {
            const other = localMap.get(path)
            if (!other) onlyRemote.push(file)
            else if (other.sha256 !== file.sha256) differing.push({ path, remote: file, local: other })
          }
          for (const [path, file] of localMap) {
            if (!remoteMap.has(path)) onlyLocal.push(file)
          }
          setComparing({ onlyRemote, onlyLocal, differing, local, remote })
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      const transfer = async (direction) => {
        if (!comparing) return
        setBusy(true)
        setError(null)
        setDone(null)
        try {
          const localPaths = new Set([
            ...comparing.local.files.map((file) => file.path),
          ])
          let count = 0
          // 手机 -> 电脑：只在手机有的 + 内容不同的（以手机较新为准）
          if (direction === 'up') {
            const targets = [
              ...comparing.onlyLocal,
              ...comparing.differing.filter((item) => item.local.mtime > item.remote.mtime).map((item) => item.local),
            ]
            for (const file of targets) {
              const data = await callJson('', `/dsh-pair/api/sync-read`, {
                method: 'POST',
                body: JSON.stringify({ dir: localDir, path: file.path }),
              })
              await callJson(base, `/sync-write`, {
                method: 'POST',
                body: JSON.stringify({ dir: remoteDir, path: file.path, base64: data.base64 }),
              })
              count += 1
            }
          } else {
            const targets = [
              ...comparing.onlyRemote,
              ...comparing.differing.filter((item) => item.remote.mtime > item.local.mtime).map((item) => item.remote),
            ]
            for (const file of targets) {
              const data = await callJson(base, `/sync-read`, {
                method: 'POST',
                body: JSON.stringify({ dir: remoteDir, path: file.path }),
              })
              await callJson('', `/dsh-pair/api/sync-write`, {
                method: 'POST',
                body: JSON.stringify({ dir: localDir, path: file.path, base64: data.base64 }),
              })
              count += 1
            }
          }
          setDone(`已传输 ${count} 个文件`)
          await compare()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      const diffCount = comparing
        ? comparing.onlyRemote.length + comparing.onlyLocal.length + comparing.differing.length
        : 0

      return h('div', { className: 'pair-modal-backdrop', onClick: onClose },
        h('div', { className: 'pair-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'pair-modal-head' },
            h('span', { className: 'pair-modal-title' }, '同步工作区'),
            h('button', { type: 'button', className: 'pair-more', onClick: onClose }, '×')),
          h('div', { className: 'pair-modal-body', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            h('label', { className: 'pair-label' }, '手机上的目录'),
            localWorkspaces.length > 0 && !manualLocal
              ? h('div', { className: 'pair-field' },
                h('select', {
                  value: localDir,
                  onChange: (e) => setLocalDir(e.target.value),
                }, localWorkspaces.map((workspace) => h('option', {
                  key: workspace.id,
                  value: workspace.path,
                }, `${workspace.title}（${workspace.path}）`))))
              : h('div', { className: 'pair-field' },
                h('input', {
                  value: localDir,
                  placeholder: '/storage/Users/currentUser/Documents/同步工作区',
                  onChange: (e) => setLocalDir(e.target.value),
                })),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              localWorkspaces.length > 0
                ? h('button', {
                  type: 'button',
                  className: 'pair-code-btn',
                  onClick: () => setManualLocal((value) => !value),
                }, manualLocal ? '从列表选' : '手动填写路径')
                : null,
              h('button', {
                type: 'button',
                className: 'pair-code-btn',
                onClick: () => registerLocal(),
              }, '把这个目录注册为工作区')),
            h('label', { className: 'pair-label' }, '电脑上的工作区'),
            remoteOptions.length > 0 && !manualRemote
              ? h('div', { className: 'pair-field' },
                h('select', {
                  value: remoteDir,
                  onChange: (e) => setRemoteDir(e.target.value),
                },
                h('option', { value: '' }, '选择电脑上的工作区'),
                remoteOptions.map((workspace) => h('option', {
                  key: workspace.id,
                  value: workspace.path,
                }, `${workspace.title}（${workspace.path}）`)),
                h('option', { value: '__manual__' }, '手动填写路径…')))
              : h('div', { className: 'pair-field' },
                h('input', {
                  value: remoteDir,
                  placeholder: 'D:\\同步工作区',
                  onChange: (e) => setRemoteDir(e.target.value),
                })),
            h('button', {
              type: 'button',
              className: 'pair-code-btn',
              style: { alignSelf: 'flex-start' },
              onClick: () => setManualRemote((value) => !value),
            }, manualRemote ? '从列表选' : '手动填写路径'),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h(Button, { kind: 'primary', size: 'sm', onClick: compare, disabled: busy || !localDir.trim() || !remoteDir.trim() },
                busy ? '处理中…' : '比对'),
              comparing
                ? h(Button, { kind: 'outline', size: 'sm', onClick: () => transfer('down'), disabled: busy }, '电脑 → 手机')
                : null,
              comparing
                ? h(Button, { kind: 'outline', size: 'sm', onClick: () => transfer('up'), disabled: busy }, '手机 → 电脑')
                : null),
            error ? h('div', { className: 'pair-error' }, error) : null,
            done ? h('div', { className: 'pair-ok' }, done) : null,
            comparing
              ? h('div', { className: 'pair-hint' },
                `只在电脑 ${comparing.onlyRemote.length} · 只在手机 ${comparing.onlyLocal.length} · 内容不同 ${comparing.differing.length}`)
              : null,
            comparing && diffCount > 0
              ? h('div', { style: { maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 } },
                comparing.onlyRemote.slice(0, 40).map((file) => h('div', { key: `r${file.path}`, className: 'pair-hint' }, `+ 电脑  ${file.path}`)),
                comparing.onlyLocal.slice(0, 40).map((file) => h('div', { key: `l${file.path}`, className: 'pair-hint' }, `+ 手机  ${file.path}`)),
                comparing.differing.slice(0, 40).map((item) => h('div', { key: `d${item.path}`, className: 'pair-hint' },
                  `≠ ${item.path}（电脑 ${item.remote.mtime > item.local.mtime ? '较新' : '较旧'}）`)))
              : null))
      )
    }

    function MessageBubble({ message, onAnswer, answering, cwd, base }) {
      const [filePreview, setFilePreview] = React.useState(null)
      const role = message.role

      const resolvePath = (value) => {
        const raw = String(value || '').trim()
        if (!raw) return raw
        if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\')) return raw
        const basePath = String(cwd || '').replace(/[\\/]+$/, '')
        if (!basePath) return raw
        return `${basePath}\\${raw.replace(/^[.\\/]+/, '')}`
      }

      const openFile = async (filePath) => {
        if (!filePath) return
        const full = resolvePath(filePath)
        try {
          const data = await callJson(base || '', `/file?path=${encodeURIComponent(full)}`)
          setFilePreview({ path: data.path || full, content: String(data.content ?? '') })
        } catch (err) {
          setFilePreview({ path: full, error: String(err && err.message ? err.message : err) })
        }
      }

      if (role === 'question') {
        return h(QuestionCard, { message, onAnswer, busy: answering, readOnly: true })
      }
      if (role === 'reasoning') {
        return h(Reasoning, { text: message.text })
      }
      if (role === 'file-edit') {
        return h(FileEditCard, { message, base })
      }
      if (role === 'tool-image') {
        return h('div', { style: { alignSelf: 'flex-start', maxWidth: '88%' } },
          h(ImageGroup, { images: message.images }))
      }
      if (role === 'system') {
        return h('div', {
          style: {
            alignSelf: 'center', fontSize: 11, padding: '3px 9px', borderRadius: 999,
            color: 'var(--dsw-alias-label-tertiary)',
            background: 'var(--dsw-alias-bg-layer-2)',
            maxWidth: '90%', textAlign: 'center',
          },
        }, message.text)
      }
      if (role === 'tool') {
        return h('div', { className: 'pair-tool-row', 'data-state': message.state || '' },
          h('span', { className: 'pair-tool-caret' },
            message.state === 'error' ? '✗' : (message.state === 'ok' ? '✓' : '▸')),
          h('span', { className: 'pair-tool-text' }, message.text))
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
      mine ? null : h(Reasoning, { text: message.reasoning }),
      message.text
        ? (mine
          ? h('div', {
            style: {
              padding: '8px 12px',
              borderRadius: 'var(--dsw-radius-lg)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            },
          }, message.text)
          : h('div', { className: 'pair-md-wrap' }, h(MarkdownText, { text: message.text, onOpenFile: openFile })))
        : null,
      h(ImageGroup, { images: message.images }),
      h('div', {
        style: {
          fontSize: 10, color: 'var(--dsw-alias-label-tertiary)',
          textAlign: mine ? 'right' : 'left', padding: '0 2px',
        },
      }, formatClock(message.time)),
      h(FilePreviewModal, { preview: filePreview, onClose: () => setFilePreview(null), base }))
    }

    function SessionDetail({ base, session, onBack, onChanged, narrow }) {
      const [messages, setMessages] = React.useState([])
      const [meta, setMeta] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [refreshedAt, setRefreshedAt] = React.useState(0)
      const [showTools, setShowTools] = React.useState(false)
      const [pending, setPending] = React.useState([])
      const [answering, setAnswering] = React.useState(null)
      const [visibleCount, setVisibleCount] = React.useState(24)
      const [pageLimit, setPageLimit] = React.useState(60)
      const scrollRef = React.useRef(null)
      const stickToBottom = React.useRef(true)
      const fileRef = React.useRef(null)

      const load = React.useCallback(async () => {
        try {
          const body = await callJson(base, `/sessions/${encodeURIComponent(session.id)}/messages?limit=${pageLimit}`)
          setMessages(Array.isArray(body.messages) ? body.messages : [])
          setError(null)
          setRefreshedAt(Date.now())
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }, [base, session.id, pageLimit])

      const loadMeta = React.useCallback(async () => {
        try {
          const body = await callJson(base, `/sessions/${encodeURIComponent(session.id)}/meta`)
          setMeta(body)
        } catch { /* 元信息失败不挡消息 */ }
      }, [base, session.id, pageLimit])

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
        loadMeta()
        const timer = setInterval(loadMeta, 3_000)
        return () => clearInterval(timer)
      }, [loadMeta])

      const lastSeq = messages.length ? messages[messages.length - 1].seq : 0
      React.useEffect(() => {
        const node = scrollRef.current
        if (!node || !stickToBottom.current) return
        node.scrollTop = node.scrollHeight
      }, [lastSeq])

      const pickModel = async (option) => {
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/model`, {
            method: 'POST',
            body: JSON.stringify({
              provider: option.provider,
              model: option.model.id,
              ...(option.effort ? { reasoningEffort: option.effort } : {}),
            }),
          })
          await loadMeta()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const pickPermission = async (name) => {
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/permission`, {
            method: 'POST',
            body: JSON.stringify({ name }),
          })
          await loadMeta()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const send = async () => {
        const text = draft.trim()
        if ((!text && pending.length === 0) || sending) return
        const outgoing = pending
        setSending(true)
        setError(null)
        let sent = false
        try {
          if (outgoing.length > 0) {
            await callJson(base, `/sessions/${encodeURIComponent(session.id)}/upload`, {
              method: 'POST',
              body: JSON.stringify({
                text,
                images: outgoing
                  .filter((item) => item.kind === 'image')
                  .map((item) => ({ name: item.name, mediaType: item.mediaType, data: item.data })),
                files: outgoing
                  .filter((item) => item.kind !== 'image')
                  .map((item) => ({ name: item.name, data: item.data })),
              }),
            })
          } else {
            await callJson(base, `/sessions/${encodeURIComponent(session.id)}/prompt`, {
              method: 'POST',
              body: JSON.stringify({ text }),
            })
          }
          sent = true
          setDraft('')
          setPending([])
          stickToBottom.current = true
          await Promise.all([load(), loadMeta()])
          if (onChanged) onChanged()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          // 已经发出去了就一定要清干净，别让残留盖住下一轮输入
          if (sent) {
            setDraft('')
            setPending([])
          }
          setSending(false)
        }
      }

      const addFiles = async (fileList) => {
        const list = Array.from(fileList || []).slice(0, 9)
        if (list.length === 0) return
        const next = []
        for (const file of list) {
          if (file.size > 24 * 1024 * 1024) {
            setError(`${file.name} 超过 24MB，已跳过`)
            continue
          }
          try {
            const isImage = String(file.type || '').startsWith('image/')
            const blob = isImage ? await compressImage(file) : null
            const data = await readAsBase64(blob || file)
            const mediaType = blob ? 'image/jpeg' : (file.type || 'application/octet-stream')
            next.push({
              key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name || 'attachment',
              mediaType,
              data,
              kind: isImage ? 'image' : 'file',
              preview: isImage ? `data:${mediaType};base64,${data}` : '',
            })
          } catch {
            setError(`读取 ${file.name} 失败`)
          }
        }
        if (next.length) setPending((prev) => [...prev, ...next].slice(0, 9))
      }

      const removePending = (key) => {
        setPending((prev) => prev.filter((item) => item.key !== key))
      }

      const answerQuestion = async (callId, answers) => {
        setAnswering(callId)
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/answer`, {
            method: 'POST',
            body: JSON.stringify({ callId, answers }),
          })
          await load()
        } finally {
          setAnswering(null)
        }
      }

      const stop = async () => {
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/cancel`, {
            method: 'POST',
            body: '{}',
          })
          await Promise.all([load(), loadMeta()])
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const onScroll = () => {
        const node = scrollRef.current
        if (!node) return
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
      }

      const running = meta ? Boolean(meta.running) : Boolean(session.running)
      const queue = meta && Array.isArray(meta.queue) ? meta.queue : []

      const updateQueueItem = async (itemId, action) => {
        try {
          await callJson(base, `/sessions/${encodeURIComponent(session.id)}/queue`, {
            method: 'POST',
            body: JSON.stringify({ itemId, action }),
          })
          await loadMeta()
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
      }

      const headerRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' } },
        narrow
          ? h(Button, { kind: 'ghost', size: 'sm', onClick: onBack, title: '返回工作区' }, '‹ 返回')
          : null,
        h('div', {
          style: {
            flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, session.title && session.title.trim() ? session.title : '未命名会话'),
        running ? h(Dot, { tone: 'ok' }) : null,
        running
          ? h(Button, { kind: 'danger', size: 'sm', onClick: stop, title: '停止这一轮' }, '停止')
          : null)

      const toolbar = h('div', { className: 'pair-toolbar' },
        h('button', {
          type: 'button',
          className: 'pair-tool',
          onClick: () => setShowTools((value) => !value),
          title: '显示 / 隐藏工具调用',
        }, showTools ? '隐藏工具' : '工具'),
        session.cwd
          ? h('span', {
            style: {
              fontSize: 11, color: 'var(--dsw-alias-label-tertiary)',
              padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', minWidth: 0,
            },
          }, basename(session.cwd))
          : null)

      return h('div', { className: 'pair-detail-pane' },
        headerRow,
        toolbar,
        error ? h('div', { className: 'pair-error' }, error) : null,
        h('div', {
          ref: scrollRef,
          onScroll,
          style: {
            flex: 1,
            minHeight: 200,
            maxHeight: narrow ? '62vh' : 'none',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 4px 8px',
          },
        },
        messages.length === 0
          ? h(Empty, null, refreshedAt ? '这个会话还没有消息' : '正在读取…')
          : (() => {
            const filtered = messages.filter((message) => showTools || message.role !== 'tool')
            const total = filtered.length
            const shown = Math.min(visibleCount, total)
            const hidden = total - shown
            const visible = filtered.slice(hidden)
            return [
              hidden > 0
                ? h('button', {
                  key: '__more',
                  type: 'button',
                  className: 'pair-more',
                  onClick: () => {
                    if (visibleCount + 24 > total && pageLimit < 200) {
                      setPageLimit((value) => Math.min(200, value + 60))
                    }
                    setVisibleCount((value) => Math.min(total, value + 24))
                  },
                }, `显示更早的 ${Math.min(24, hidden)} 条（还剩 ${hidden} 条）`)
                : null,
              (() => {
                const blocks = []
                const pushProcess = (item) => {
                  const last = blocks[blocks.length - 1]
                  if (last && last.type === 'process') last.items.push(item)
                  else blocks.push({ type: 'process', items: [item] })
                }
                for (const message of visible) {
                  if (message.role === 'assistant') {
                    // 思考属于「过程」，正文才是回答
                    if (message.reasoning && message.reasoning.trim()) {
                      pushProcess({
                        seq: message.seq,
                        time: message.time,
                        role: 'reasoning',
                        text: message.reasoning,
                      })
                    }
                    blocks.push({
                      type: 'single',
                      message: { ...message, reasoning: '' },
                    })
                    continue
                  }
                  if (message.role === 'tool' || message.role === 'file-edit') {
                    pushProcess(message)
                    continue
                  }
                  blocks.push({ type: 'single', message })
                }
                return blocks.map((block, index) => (block.type === 'process'
                  ? h(ProcessGroup, { key: `p${index}`, items: block.items, base, cwd: session.cwd })
                  : h(MessageBubble, {
                    key: `s${block.message.seq}-${block.message.role}`,
                    message: block.message,
                    onAnswer: answerQuestion,
                    answering: answering === block.message.callId,
                    cwd: session.cwd,
                    base,
                  })))
              })(),
            ]
          })()),
        queue.length > 0
          ? h('div', { className: 'pair-queue' },
            h('div', { className: 'pair-queue-title' }, `排队中 ${queue.length} 条`),
            queue.map((item) => h('div', { key: item.id, className: 'pair-queue-item' },
              h('span', { className: 'pair-queue-text', title: queuedText(item) }, queuedText(item)),
              item.placement === 'steering'
                ? h('span', { className: 'pair-hint' }, '转向中')
                : h(Button, {
                  kind: 'ghost',
                  size: 'sm',
                  onClick: () => updateQueueItem(item.id, { kind: 'steer' }),
                  title: '现在插入到这一轮',
                }, '提前'),
              h(Button, {
                kind: 'ghost',
                size: 'sm',
                onClick: () => updateQueueItem(item.id, { kind: 'remove' }),
                title: '从队列里删掉',
              }, '删除'))))
          : null,
        pending.length > 0
          ? h('div', { className: 'pair-attach-row' },
            pending.map((item) => h('div', { key: item.key, className: 'pair-attach' },
              item.preview
                ? h('img', { src: item.preview, alt: '' })
                : h('span', null, '📎'),
              h('span', { className: 'pair-attach-name' }, item.name),
              h('button', {
                type: 'button',
                className: 'pair-attach-remove',
                onClick: () => removePending(item.key),
                title: '移除',
              }, '×'))))
          : null,
        h('input', {
          ref: fileRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: (e) => {
            addFiles(e.target.files)
            e.target.value = ''
          },
        }),
        running
          ? h('div', { className: 'pair-thinking' },
            h('span', { className: 'pair-thinking-dot' }),
            h('span', null, '深度求索中…'))
          : null,
        h('div', { className: 'pair-composer' },
          h('textarea', {
            className: 'pair-textarea',
            value: draft,
            rows: 2,
            placeholder: pending.length > 0 ? '给这些附件加一句话（可留空）…' : '发消息或创建任务，/ 调用指令，@ 文件…',
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            },
          }),
          h('div', { className: 'pair-composer-bar' },
            h('button', {
              type: 'button',
              className: 'pair-icon-btn',
              onClick: () => { if (fileRef.current) fileRef.current.click() },
              title: '添加图片或文件',
            }, '＋'),
            h(PermissionPicker, { meta, onPick: pickPermission }),
            h(ModelPicker, { meta, onPick: pickModel }),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              className: 'pair-send-btn',
              onClick: send,
              disabled: sending || (!draft.trim() && pending.length === 0),
              title: '发送',
            }, sending ? '…' : '↑'))))
    }

    // -----------------------------------------------------------------------
    // 手机连接地址（电脑端专用隧道）
    // -----------------------------------------------------------------------
    function TunnelCard({ info }) {
      const [copied, setCopied] = React.useState(false)
      const [copiedKey, setCopiedKey] = React.useState(false)
      const [publishing, setPublishing] = React.useState(false)
      const [publishMsg, setPublishMsg] = React.useState(null)
      const url = info && info.publicUrl ? info.publicUrl : ''
      const state = (info && info.tunnelState) || 'off'
      const tone = state === 'ready' ? 'ok' : state === 'starting' ? 'warn' : state === 'error' ? 'error' : 'idle'
      const stateText = state === 'ready'
        ? '已就绪'
        : state === 'starting'
          ? '正在获取…'
          : state === 'error'
            ? '获取失败'
            : '未启动'

      const copy = async () => {
        if (!url) return
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          if (typeof window !== 'undefined' && window.prompt) window.prompt('复制这个地址：', url)
        }
      }

      const copyKey = async () => {
        const key = info && info.pairKey ? String(info.pairKey) : ''
        if (!key) return
        try {
          await navigator.clipboard.writeText(key)
          setCopiedKey(true)
          setTimeout(() => setCopiedKey(false), 2000)
        } catch {
          if (typeof window !== 'undefined' && window.prompt) window.prompt('复制配对密钥：', key)
        }
      }

      const publish = async () => {
        setPublishing(true)
        setPublishMsg(null)
        try {
          await callJson('', '/dsh-pair/publish', { method: 'POST' })
          setPublishMsg('已发布到 GitHub')
        } catch (err) {
          setPublishMsg('发布失败：' + String(err && err.message ? err.message : err))
        } finally {
          setPublishing(false)
        }
      }

      return h(Card, { style: { display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Dot, { tone }),
          h('span', { style: { fontSize: 12, lineHeight: '18px', fontWeight: 600 } }, '手机连接地址'),
          h('span', {
            style: {
              marginLeft: 'auto', fontSize: 11,
              color: 'var(--dsw-alias-label-tertiary)',
            },
          }, stateText)),
        url
          ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('code', {
              style: {
                flex: 1, minWidth: 0, padding: '6px 8px',
                borderRadius: 'var(--dsw-radius-sm)',
                background: 'var(--dsw-alias-bg-base)',
                boxShadow: 'inset 0 0 0 .5px var(--dsw-alias-border-l1)',
                fontSize: 11, lineHeight: '16px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            }, url),
            h(Button, { kind: 'outline', size: 'sm', onClick: copy }, copied ? '已复制' : '复制'))
          : null,
        info && info.pairKey
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' } }, '配对密钥'),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('code', {
                style: {
                  flex: 1, minWidth: 0, padding: '6px 8px',
                  borderRadius: 'var(--dsw-radius-sm)',
                  background: 'var(--dsw-alias-bg-base)',
                  boxShadow: 'inset 0 0 0 .5px var(--dsw-alias-border-l1)',
                  fontSize: 11, lineHeight: '16px',
                  wordBreak: 'break-all',
                },
              }, String(info.pairKey)),
              h(Button, { kind: 'outline', size: 'sm', onClick: copyKey }, copiedKey ? '已复制' : '复制')))
          : null,
        !url && state !== 'starting'
          ? h('div', { className: 'pair-hint' },
            info && info.tunnelError
              ? `没拿到地址：${info.tunnelError}`
              : '没拿到公网地址，检查 cloudflared 是否安装、网络是否放行。')
          : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { className: 'pair-hint', style: { flex: 1 } },
            info && info.publishable ? '地址会自动发到 GitHub' : '想自动同步地址？在配置里填 publishToken'),
          info && info.publishable
            ? h(Button, { kind: 'outline', size: 'sm', onClick: publish, disabled: publishing || !url },
              publishing ? '发布中…' : '立即发布')
            : null),
        publishMsg
          ? h('div', { className: publishMsg.startsWith('发布失败') ? 'pair-error' : 'pair-hint' }, publishMsg)
          : null,
        h('div', { className: 'pair-hint' },
          '手机端「连接电脑」填这个地址 + 配对密钥。重启 DSH 后地址会变，回到这里复制新的。'))
    }

    // -----------------------------------------------------------------------
    // 从电脑更新
    // -----------------------------------------------------------------------
    function UpdateBar() {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)

      const check = React.useCallback(async () => {
        try {
          setStatus(await callJson('', '/dsh-pair/self-update/check'))
        } catch { /* 电脑没提供包就静默 */ }
      }, [])

      React.useEffect(() => {
        check()
        const timer = setInterval(check, 60_000)
        return () => clearInterval(timer)
      }, [check])

      const apply = async () => {
        setBusy(true)
        setMessage(null)
        try {
          const body = await callJson('', '/dsh-pair/self-update/apply', { method: 'POST' })
          setMessage(`已更新到 ${body.version || '电脑版本'} → ${body.root || '?'}，重启 DSH 后生效`)
          await check()
        } catch (err) {
          setMessage('更新失败：' + String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      if (!status) return null
      const local = status.local || ''
      const remote = status.remote || ''
      const updatable = Boolean(status.updatable) || Boolean(message && !message.startsWith('更新失败'))
      if (!updatable && !message) return null

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 4,
          padding: '8px 10px', flex: '0 0 auto',
          borderRadius: 'var(--dsw-radius-md)',
          background: 'var(--dsw-alias-bg-layer-1)',
          boxShadow: 'inset 0 0 0 .5px var(--dsw-alias-border-l1)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: '18px' } },
          `电脑 ${remote || '?'} · 本机 ${local}`),
        updatable
          ? h(Button, { kind: 'outline', size: 'sm', onClick: apply, disabled: busy },
            busy ? '更新中…' : '从电脑更新')
          : null),
      message ? h('div', { className: message.startsWith('更新失败') ? 'pair-error' : 'pair-hint' }, message) : null)
    }

    /** 连不上时从 GitHub 拉电脑发布的地址（带签名校验）。 */
    function SyncEndpointButton({ onSynced }) {
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)

      const sync = async () => {
        setBusy(true)
        setMsg(null)
        try {
          const body = await callJson('', '/dsh-pair/sync-endpoint', { method: 'POST' })
          setMsg(`已同步：${body.url}`)
          if (onSynced) onSynced()
        } catch (err) {
          setMsg('同步失败：' + String(err && err.message ? err.message : err))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' } },
        h(Button, { kind: 'outline', size: 'sm', onClick: sync, disabled: busy },
          busy ? '同步中…' : '从 GitHub 同步地址'),
        msg ? h('div', { className: msg.startsWith('同步失败') ? 'pair-error' : 'pair-hint' }, msg) : null)
    }

    // -----------------------------------------------------------------------
    // 主面板
    // -----------------------------------------------------------------------
    function PairPage() {
      const [info, setInfo] = React.useState(null)
      const [infoError, setInfoError] = React.useState(null)
      const [tree, setTree] = React.useState(null)
      const [treeError, setTreeError] = React.useState(null)
      const [activeId, setActiveId] = React.useState(null)
      const [showConfig, setShowConfig] = React.useState(false)
      const [refreshing, setRefreshing] = React.useState(false)
      const [collapsed, setCollapsed] = React.useState(() => new Set())
      const [q, setQ] = React.useState('')
      const [menuTarget, setMenuTarget] = React.useState(null)
      const [wsMenuTarget, setWsMenuTarget] = React.useState(null)
      const [showSync, setShowSync] = React.useState(false)

      const renameWorkspace = async (workspace) => {
        setWsMenuTarget(null)
        const next = window.prompt('新的工作区名称', workspace.title || '')
        if (next === null) return
        const title = next.trim()
        if (!title) return
        try {
          await callJson('', `/dsh-pair/api/workspaces/${encodeURIComponent(workspace.id)}/rename`, {
            method: 'POST',
            body: JSON.stringify({ title }),
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const deleteWorkspace = async (workspace) => {
        setWsMenuTarget(null)
        if (!window.confirm(`删除工作区「${workspace.title}」？会话和文件都会保留。`)) return
        try {
          await callJson('', `/dsh-pair/api/workspaces/${encodeURIComponent(workspace.id)}/delete`, {
            method: 'POST',
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const createIn = async (workspaceId) => {
        try {
          const body = await callJson('', '/dsh-pair/api/sessions', {
            method: 'POST',
            body: JSON.stringify({ workspaceId }),
          })
          await loadTree()
          if (body && body.sessionId) setActiveId(body.sessionId)
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const renameSession = async (session) => {
        setMenuTarget(null)
        const next = window.prompt('新的会话标题', session.title || '')
        if (next === null) return
        const title = next.trim()
        if (!title) return
        try {
          await callJson('', `/dsh-pair/api/sessions/${encodeURIComponent(session.id)}/rename`, {
            method: 'POST',
            body: JSON.stringify({ title }),
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const archiveSession = async (session) => {
        setMenuTarget(null)
        try {
          await callJson('', `/dsh-pair/api/sessions/${encodeURIComponent(session.id)}/archive`, {
            method: 'POST',
            body: JSON.stringify({ archived: true }),
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const pinSession = async (session) => {
        setMenuTarget(null)
        try {
          await callJson('', `/dsh-pair/api/sessions/${encodeURIComponent(session.id)}/pin`, {
            method: 'POST',
            body: JSON.stringify({ pinned: true }),
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const forkSession = async (session) => {
        setMenuTarget(null)
        try {
          const body = await callJson('', `/dsh-pair/api/sessions/${encodeURIComponent(session.id)}/fork`, {
            method: 'POST',
          })
          await loadTree()
          if (body && body.sessionId) setActiveId(body.sessionId)
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }

      const moveSession = async (session, direction) => {
        setMenuTarget(null)
        const groups = (tree && tree.workspaces ? tree.workspaces : [])
          .map((workspace) => ({ id: workspace.id, sessions: workspace.sessions || [] }))
        const group = groups.find((item) => item.sessions.some((row) => row.id === session.id))
        if (!group) return
        const list = group.sessions
        const index = list.findIndex((row) => row.id === session.id)
        const target = index + direction
        if (target < 0 || target >= list.length) return
        const beforeSessionId = direction < 0
          ? list[target].id
          : (list[target + 1] ? list[target + 1].id : '')
        try {
          await callJson('', `/dsh-pair/api/workspaces/${encodeURIComponent(group.id)}/move-session`, {
            method: 'POST',
            body: JSON.stringify({ sessionId: session.id, beforeSessionId }),
          })
          await loadTree()
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }
      const narrow = useNarrow()

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

      const loadTree = React.useCallback(async () => {
        if (!apiBase) return
        try {
          const body = await callJson(apiBase, '/tree')
          setTree(body)
          setTreeError(null)
        } catch (err) {
          setTreeError(String(err && err.message ? err.message : err))
        }
      }, [apiBase])

      React.useEffect(() => {
        if (!apiBase) return undefined
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          await loadTree()
          if (alive) timer = setTimeout(tick, 5000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [apiBase, loadTree])

      const refreshNow = async () => {
        setRefreshing(true)
        // 刷新顺手从 GitHub 同步一次端点，两个按钮合成一个
        if (info && info.role !== 'host') {
          try { await callJson('', '/dsh-pair/sync-endpoint', { method: 'POST' }) } catch { /* 同步失败也继续刷新 */ }
        }
        await loadInfo()
        await loadTree()
        setRefreshing(false)
      }

      const allSessions = React.useMemo(() => {
        if (!tree) return []
        const list = []
        for (const workspace of tree.workspaces || []) list.push(...workspace.sessions)
        list.push(...(tree.others || []))
        return list
      }, [tree])

      const active = allSessions.find((session) => session.id === activeId) || { id: activeId, title: '' }
      const role = info ? info.role : null

      // 换到另一套接口时，旧的会话 id 不再适用
      React.useEffect(() => {
        setActiveId(null)
      }, [role])

      const toggleWorkspace = (id) => {
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      // 未就绪时的兜底
      if (!info) {
        return h('div', { style: { padding: 20 } },
          h(StyleSheet),
          h('div', { className: 'pair-hint' },
            infoError ? `配对信息读取失败：${infoError}` : '正在读取配对状态…'))
      }

      const isHost = role === 'host'
      const linked = Boolean(info.linked)
      const statusTone = infoError
        ? 'error'
        : isHost
          ? (info.configured ? 'ok' : 'warn')
          : treeError
            ? 'warn'
            : 'ok'

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', minHeight: 52 } },
        h('div', {
          style: {
            width: 28, height: 28, borderRadius: 'var(--dsw-radius-md)',
            display: 'grid', placeItems: 'center',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-secondary)',
          },
        }, h(PairIcon, { size: 17 })),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 14, lineHeight: '22px', fontWeight: 600 } },
            isHost ? '本机' : '远程电脑',
            h('span', {
              style: {
                fontWeight: 400, fontSize: 11, marginLeft: 6,
                color: 'var(--dsw-alias-label-tertiary)',
              },
            }, `v${CLIENT_BUILD}`)),
          h('div', {
            style: {
              fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)',
              display: 'flex', alignItems: 'center', gap: 6,
            },
          },
          h(Dot, { tone: statusTone }),
          isHost
            ? (info.configured ? `${info.clients || 0} 台设备 · 主机模式` : '未配置配对密钥')
            : (treeError
              ? '连不上电脑'
              : (linked ? `已连上电脑 · 电脑 v${info.version || '?'}` : '未配对')))),
        h(Button, {
          kind: 'ghost',
          size: 'sm',
          onClick: () => setShowSync(true),
          disabled: !linked,
          title: '把两边的目录做一次手动同步',
        }, '同步'),
        h(Button, {
          kind: 'ghost',
          size: 'sm',
          onClick: refreshNow,
          disabled: refreshing,
          title: '刷新（手机端会先同步 GitHub 上的最新地址）',
        }, refreshing ? '同步中' : '刷新'))

      const treePane = h('div', { className: 'pair-tree-pane' },
        showConfig
          ? h('div', { className: 'pair-scroll' },
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', flex: '0 0 auto' } },
              h(Button, { kind: 'ghost', size: 'sm', onClick: () => setShowConfig(false) }, '收起')),
            isHost ? null : h(ConfigForm, { info, onSaved: () => { setShowConfig(false); refreshNow() } }),
            isHost ? h(TunnelCard, { info }) : null)
          : h(React.Fragment, null,
            treeError
              ? h('div', {
                style: {
                  fontSize: 12, lineHeight: 1.6, padding: '9px 10px',
                  borderRadius: 'var(--dsw-radius-md)',
                  color: 'var(--dsw-alias-state-error-primary)',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  boxShadow: 'inset 0 0 0 .5px var(--dsw-alias-border-l1)',
                  flex: '0 0 auto',
                  display: 'flex', flexDirection: 'column', gap: 8,
                },
              },
              h('div', null, treeError),
              h('div', { className: 'pair-hint' }, '点右上角「刷新」会先同步 GitHub/Gitee 上的最新地址。'))
              : null,
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, fontSize: 11, lineHeight: '16px',
                color: 'var(--dsw-alias-label-tertiary)', flex: '0 0 auto',
              },
            },
            h('span', null,
              tree ? `${(tree.workspaces || []).length} 个工作区 · ${allSessions.length} 个会话` : '工作区'),
            h(Button, {
              kind: 'outline',
              size: 'sm',
              onClick: () => setShowConfig((value) => !value),
            }, showConfig ? '收起' : (isHost ? '连接电脑' : '修改连接'))),
            h(WorkspaceTree, {
              tree,
              activeId,
              onOpen: (id) => setActiveId(id),
              collapsed,
              onToggle: toggleWorkspace,
              q,
              onQuery: setQ,
              onCreate: createIn,
              onMenu: (session, rect) => setMenuTarget({
                session,
                left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 172)),
                top: Math.min(rect.bottom + 4, window.innerHeight - 220),
              }),
              onWorkspaceMenu: (workspace, rect) => setWsMenuTarget({
                workspace,
                left: Math.max(8, Math.min(rect.right - 160, window.innerWidth - 172)),
                top: Math.min(rect.bottom + 4, window.innerHeight - 160),
              }),
            }),
            isHost
              ? h('div', { className: 'pair-hint', style: { paddingTop: 2, flex: '0 0 auto' } },
                linked
                  ? `已配对：手机端会连到 ${info.device || '本机'} 上的工作区。`
                  : '手机端第一次用：点「连接电脑」，把上面的隧道地址和配对密钥填进去。')
              : null))

      const detailPane = h('div', { className: 'pair-detail-pane' },
        activeId
          ? h(SessionDetail, {
            base: apiBase,
            session: active,
            narrow,
            onBack: () => setActiveId(null),
            onChanged: loadTree,
          })
          : h('div', {
            style: {
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 160,
            },
          }, h(Empty, null, '从左边选一个会话')))

      return h('div', {
        className: 'pair-page',
        style: {
          display: 'flex', flexDirection: 'column', gap: 10,
          height: '100%', minHeight: 420, padding: '14px 16px 18px',
          boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)',
          maxWidth: 980, margin: '0 auto', width: '100%',
        },
      },
      h(StyleSheet),
      header,
      infoError ? h('div', { className: 'pair-error' }, `配对信息读取失败：${infoError}`) : null,
      isHost ? null : h(UpdateBar),
      h('div', { className: 'pair-panes' },
        (narrow && activeId) ? null : treePane,
        (narrow && !activeId) ? null : detailPane),
      menuTarget
        ? h('div', {
          style: { position: 'fixed', inset: 0, zIndex: 500 },
          onClick: () => setMenuTarget(null),
        },
        h('div', {
          className: 'pair-menu',
          style: {
            position: 'fixed',
            left: menuTarget.left,
            top: menuTarget.top,
            width: 156,
            padding: 4,
            zIndex: 501,
          },
          onClick: (e) => e.stopPropagation(),
        },
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => renameSession(menuTarget.session) }, '重命名'),
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => pinSession(menuTarget.session) }, '置顶会话'),
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => moveSession(menuTarget.session, -1) }, '上移'),
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => moveSession(menuTarget.session, 1) }, '下移'),
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => forkSession(menuTarget.session) }, '分叉会话'),
        h('button', {
          type: 'button',
          className: 'pair-menu-item',
          onClick: () => {
            try { navigator.clipboard?.writeText(menuTarget.session.id) } catch { /* ignore */ }
            setMenuTarget(null)
          },
        }, '复制 Session ID'),
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => archiveSession(menuTarget.session) }, '归档会话')))
        : null,
      wsMenuTarget
        ? h('div', {          style: { position: 'fixed', inset: 0, zIndex: 500 },
          onClick: () => setWsMenuTarget(null),
        },
        h('div', {
          className: 'pair-menu',
          style: {
            position: 'fixed',
            left: wsMenuTarget.left,
            top: wsMenuTarget.top,
            width: 156,
            padding: 4,
            zIndex: 501,
          },
          onClick: (e) => e.stopPropagation(),
        },
        h('button', { type: 'button', className: 'pair-menu-item', onClick: () => renameWorkspace(wsMenuTarget.workspace) }, '重命名'),
        h('button', { type: 'button', className: 'pair-menu-item pair-menu-danger', onClick: () => deleteWorkspace(wsMenuTarget.workspace) }, '删除工作区')))
        : null,
      showSync
        ? h(SyncPanel, { base: apiBase, tree, onClose: () => setShowSync(false) })
        : null)
    }

    // -----------------------------------------------------------------------
    // 提问浮层：ask_user_question 走 user-questions/request，必须在这里回答
    // -----------------------------------------------------------------------
    function QuestionOverlay() {
      const [items, setItems] = React.useState([])
      const [busy, setBusy] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const body = await callJson('', '/dsh-pair/inbox')
            if (alive) setItems(Array.isArray(body.questions) ? body.questions : [])
          } catch {
            if (alive) setItems([])
          }
          if (alive) timer = setTimeout(tick, 2000)
        }
        tick()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [])

      const submit = async (id, answers) => {
        setBusy(id)
        try {
          await callJson('', '/dsh-pair/answer-question', {
            method: 'POST',
            body: JSON.stringify({ id, answers }),
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
          maxWidth: 'min(94vw, 440px)', maxHeight: '80vh', overflowY: 'auto',
        },
      },
      h(StyleSheet),
      items.map((item) => h(QuestionCard, {
        key: item.id,
        message: { callId: item.callId, questions: item.questions, pending: true },
        busy: busy === item.id,
        onAnswer: (callId, answers) => submit(item.id, answers),
      })))
    }

    // -----------------------------------------------------------------------
    // 审批浮层
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
      },
      h(StyleSheet),
      items.map((item) => h('div', {
        key: item.id,
        style: {
          background: 'var(--dsw-alias-bg-overlay)',
          color: 'var(--dsw-alias-label-primary)',
          border: '.5px solid var(--dsw-alias-border-l2)',
          borderRadius: 'var(--dsw-radius-lg)',
          padding: 14,
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          fontSize: 13,
          lineHeight: 1.55,
        },
      },
      h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } },
        '电脑请求：' + (item.toolName || '未知操作')),
      item.reason
        ? h('div', { style: { fontSize: 12, opacity: 0.78, marginBottom: 10, wordBreak: 'break-word' } }, item.reason)
        : null,
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        h(Button, {
          kind: 'outline',
          size: 'sm',
          disabled: busy === item.id,
          onClick: () => decide(item.id, 'rejected'),
        }, '拒绝'),
        h(Button, {
          kind: 'primary',
          size: 'sm',
          disabled: busy === item.id,
          onClick: () => decide(item.id, 'allowed-once'),
        }, '允许')))))
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
          padding: '7px 0',
          borderBottom: '.5px solid var(--dsw-alias-border-l1)',
          fontSize: 13, lineHeight: '20px',
        },
      },
      h('span', { style: { color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } }, key),
      h('span', { style: { textAlign: 'right', wordBreak: 'break-all' } }, String(value)))

      return h('div', { style: { padding: '4px 2px', fontSize: 13, lineHeight: 1.6 } },
        h(StyleSheet),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h(Dot, { tone: connected ? 'ok' : 'idle' }),
          h('strong', null, connected ? '已连接' : '未连接'),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '· ' + role)),
        h('div', { className: 'pair-hint', style: { marginBottom: 10 } },
          '工作区、会话和审批都在左侧栏「远程电脑」里。这里只放运行状态速览。'),
        row('角色', role === 'host' ? 'host（电脑）' : role === 'client' ? 'client（手机）' : role),
        role === 'host' ? row('已连接设备', data.clients || 0) : null,
        role === 'client' ? row('电脑地址', (data && data.host) || '—') : null,
        row('审批：收到', (data && data.approvalsSeen) || 0),
        row('审批：已回复', (data && data.approvalsAnswered) || 0),
        row('审批：回退本机', (data && data.approvalsDelegated) || 0),
        row('待审批', (data && data.approvals && data.approvals.length) || (data && data.pendingApprovals) || 0),
        data && data.lastError ? row('lastError', data.lastError) : null,
        err ? h('div', { className: 'pair-hint', style: { marginTop: 10 } }, '状态读取失败：' + err) : null,
        h('div', { className: 'pair-hint', style: { marginTop: 12, fontSize: 11 } }, '每 3 秒刷新一次'))
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

        // 提问浮层（user-questions/request 必须在浮层里回答）
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-pair-question',
          order: 90,
        }, QuestionOverlay))

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
