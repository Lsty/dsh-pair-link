# dsh-pair-link

PC 与手机上的 DeepSeek Harness 配对互联：**实时对话流 + 审批同步**，两端各装一个插件，走 WebSocket 直连，不需要第三方服务器。

## 它解决什么

DSH 的审批卡、流式输出默认只出现在电脑上。这个插件让手机端的 DSH 也能收到同样的内容，并且**手机上的决定会真正接管电脑上的审批**——不是镜像，是原生 `ApprovalOutcome`。

## 架构

```
┌─ PC DSH (role: host) ─────────────┐         ┌─ 手机 DSH (role: client) ─┐
│  approval/request   ──拦截──▶ WS  │────────▶│  /dsh-pair/inbox  (轮询)   │
│  agent/assistant-stream ──▶ WS    │◀────────│  /dsh-pair/decide (POST)   │
│  session/event      ──▶ WS        │         │  shell.overlay 审批卡       │
└───────────────────────────────────┘         └────────────────────────────┘
```

- 零依赖：自带最小 WebSocket 服务端实现（RFC 6455 文本帧），不需要 `ws` 之类的运行时依赖。
- 审批 **fail-open**：超时（120s）/ 断线 / 异常一律 `next()` 交回桌面，绝不让任务卡死。
- 鉴权：WS 连接需带 `?token=<pairing secret>`，常量时间比对。

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

### 角色自动判定

同一个包，两种角色，**按配置自动切**：

- 配置里**没有** `pairUrl` → 走 **host**（电脑）
- 配置里**有** `pairUrl` → 走 **client**（手机）

配置来源优先级：插件 `config` > `$DSH_HOME/dsh-pair-link.json`

### 计算机（host）

`$DSH_HOME/dsh-pair-link.json`：

```json
{ "secret": "至少 32 位随机字符串" }
```

### 手机（client）

```json
{
  "secret": "与电脑端同一个值",
  "pairUrl": "wss://<隧道域名>/dsh-pair/ws"
}
```

> `pairUrl` **不要带 token**，插件会自己拼 `?token=`。

## 端点

| 端点 | 角色 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `GET /dsh-pair/status` | host | 无 | 运行状态、连接数、审批计数（不含 secret） |
| `WS /dsh-pair/ws?token=…` | host | pairing secret | 配对连接 |
| `GET /dsh-pair/simulate` | host | 无 | 注入一条测试审批，验证手机端卡片与回传 |
| `GET /dsh-pair/inbox` | client | `x-pair-token` | 手机 Web UI 拉取待审批 |
| `POST /dsh-pair/decide` | client | `x-pair-token` | 手机 Web UI 回传决定 |

`x-pair-token` 是 client 侧每次启动随机生成的页面令牌，通过 `webServer.tapIndex` 注入到页面（`window.__DSH_PAIR_TOKEN__`），不落盘、不进日志。

## 协议

服务端 → 客户端：

```jsonc
{ "type": "hello", "role": "host", "version": "0.2.0" }
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

## 已验证的闭环

```
GET /dsh-pair/simulate
→ {"ok":true,"id":"b21dd0aa-…","outcome":"allowed-once"}

/dsh-pair/status
→ approvalsAnswered=1, approvalsDelegated=0, pendingApprovals=0
```

`allowed-once` 是 DSH 原生 `ApprovalOutcome` 值，证明「推出去 → 手机点按钮 → 收回来 → 记账」四步都成立。

## 已知限制

1. **隧道是临时的**：`cloudflared` 的 `*.trycloudflare.com` 地址随进程重启变化，变了要改手机端 `pairUrl` 并重启。长期固定需要 Cloudflare 命名隧道 + 自有域名。
2. **审批 120 秒超时**：超时后电脑回退本机审批，手机端收到 `approval-delegated`，卡片自动消失。
3. **手机卡片只在前台存活**：2 秒轮询，锁屏或 App 被系统冻结时收不到。这是轮询机制的边界，不是断线。
4. **真实 `approval/request` 依赖工具进入询问模式**：DSH 的三档文件权限（只读/工作区/完全）只控制沙箱边界，不产生审批事件。用 `/dsh-pair/simulate` 可随时自检。
5. **`/inbox`、`/decide` 目前只监听 `127.0.0.1`**：若把 DSH 的监听地址改成 `0.0.0.0`，这两个端点会一起暴露。页面令牌能挡盲扫，但不是加密通道，仍建议保持回环绑定。

## 安全边界

- 只转发审批/流式片段/会话事件，不暴露 shell、文件写入、任意 RPC。
- 配对密钥只存在本机文件，不写日志、不上报。
- 页面令牌每次启动重新生成，不落盘。
- 跨网请用 `cloudflared` 或组网把 WS 暴露成 `wss://`，不要裸奔到公网。

MIT License
