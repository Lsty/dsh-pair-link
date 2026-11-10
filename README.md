# dsh-pair-link

PC 与手机上的 DeepSeek Harness 配对互联：**实时对话流 + 审批同步**，两端各装一个插件，走 WebSocket 直连，不需要第三方服务器。

## 它解决什么

DSH 的审批卡、提问、流式输出默认只出现在电脑上。这个插件让手机端的 DSH 也能收到同样的内容，并且**手机上的决定会真正接管电脑上的审批**——不是镜像，是原生 `ApprovalOutcome`。

## 架构

```
┌─ PC DSH (role: host) ─────────────┐         ┌─ 手机 DSH (role: client) ─┐
│  approval/request   ──拦截──▶ WS  │────────▶│  渲染审批卡 / 对话流        │
│  user-questions     ──拦截──▶ WS  │◀────────│  回传 allowed-once/rejected │
│  agent/assistant-stream ──▶ WS    │         │                            │
│  session/event      ──▶ WS        │         │                            │
└───────────────────────────────────┘         └────────────────────────────┘
```

- 零依赖：自带最小 WebSocket 服务端实现（RFC 6455 文本帧），不需要 `ws` 之类的运行时依赖。
- 审批 **fail-open**：超时（120s）/ 断线 / 异常一律 `next()` 交回桌面，绝不让任务卡死。
- 鉴权：连接需带 `?token=<pairing secret>`，常量时间比对。

## 安装

**电脑端**

```sh
dsh plugin --profile desktop add github.com/Lsty/dsh-pair-link
```

**手机端（DSHM）**

设置页「插件安装」填：

```
github.com/Lsty/dsh-pair-link
```

手机端 `patchReload` 是 `startup`，**装完必须重启 DSH 才生效**。

## 配置

### 配对密钥

电脑端在 `$DSH_HOME/dsh-pair-link.json` 写：

```json
{ "secret": "至少 32 位随机字符串" }
```

或用插件配置项 `secret` 覆盖。手机端填同一个值。

### 端点

| 端点 | 说明 |
| --- | --- |
| `GET /dsh-pair/status` | 运行状态（不含 secret） |
| `WS /dsh-pair/ws?token=…` | 配对连接 |

## 协议

服务端 → 客户端：

```jsonc
{ "type": "hello", "role": "host", "version": "0.1.0" }
{ "type": "approval", "id": "uuid", "toolName": "pwsh", "reason": "...", "sessionId": "..." }
{ "type": "approval-resolved", "id": "uuid", "outcome": "allowed-once" }
{ "type": "approval-delegated", "id": "uuid", "reason": "timeout-or-abort" }
{ "type": "assistant-stream", "sessionId": "...", "frame": { } }
{ "type": "session-event", "sessionId": "...", "event": { } }
```

客户端 → 服务端：

```jsonc
{ "type": "approval-decision", "id": "uuid", "outcome": "allowed-once" }
{ "type": "approval-decision", "id": "uuid", "outcome": "rejected" }
```

## 安全边界

- 只转发审批/提问/流式片段，不暴露 shell、文件写入、任意 RPC。
- 密钥只存在本机文件，不写日志、不上报。
- 跨网请自行用 `cloudflared` 或组网把 WS 暴露成 `wss://`，不要直接裸奔到公网。

MIT License
