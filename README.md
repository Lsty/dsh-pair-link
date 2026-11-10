# dsh-pair-link

用手机上的第三方 DSH **远程控制这台电脑的 DSH 会话**：左侧栏「远程电脑」入口，打开就能看会话列表、读对话、直接发消息、停止当前轮，并处理审批。

两端装同一个包。**基础能力两端都有**（本机会话面板、审批浮层）；**配了电脑地址的那一端**额外获得远程能力（代理访问电脑、实时审批）。

## 它解决什么

DSH 的会话通常只在电脑上。手机上想接着推进，要么开电脑桌面（iframe 镜像），要么人回到电脑前。这个插件让手机端 DSH 出现一个**原生的会话面板**：

- 左侧栏「远程电脑」→ 电脑上的会话列表（标题、更新时间、运行中）
- 点进去 → 完整对话（用户 / 助手；工具调用默认折叠，可展开）
- 输入框直接往电脑的会话里发消息；运行中可「停止」
- 电脑发起的审批在手机上浮卡，「允许 / 拒绝」会真正作为电脑侧的原生 `ApprovalOutcome`

## 架构

```
┌─ 电脑 DSH ─────────────────────────┐        ┌─ 手机 DSH ─────────────────────┐
│ /dsh-pair/api/sessions             │        │ 左侧栏「远程电脑」(sidebar)      │
│ /dsh-pair/api/sessions/:id/messages│◀───────│ /dsh-pair/remote/api/* 同源代理   │
│ /dsh-pair/api/sessions/:id/prompt  │        │ 主面板 (main)                   │
│ /dsh-pair/api/sessions/:id/cancel  │        │ 审批浮层 (shell.overlay)         │
│ /dsh-pair/api/approvals            │        │ 设置页状态速览 (settings.section)│
│ WS /dsh-pair/ws  ← 审批实时推送     │───────▶│                                │
└────────────────────────────────────┘        └────────────────────────────────┘
```

手机端页面**从不直接跨域请求电脑**：它请求手机 DSH 自己进程里的 `/dsh-pair/remote/api/*`，由插件在服务端转发到电脑。这样：

- 没有 CORS、Cookie、SameSite 的坑
- dsh-bridge 之类的远程访问插件要求的登录令牌可在服务端拼上
- 手机端页面只认本机注入的页面令牌

**两端是同一份代码**：配了 `pairUrl` 就是「远程端」，没配就是「主机端」。手机端第一次装好、还没配置时，页面照样能用 —— 它显示「连接电脑」，填完保存**立即生效并切到远程视图**，不用重启 DSH。

## 安装

**电脑端**（`desktop` profile）

```sh
dsh plugin --profile desktop add github.com/Lsty/dsh-pair-link
```

**手机端（DSHM 等第三方 DSH）**

在它的插件安装页填同一个包名；装完重启该 App 的 DSH 进程。

> 这个包在 desktop profile 里是 `link:` 本地安装，改了工作区文件后需要禁用/启用一次插件（或重启 DSH）让 Host 侧重新加载；页面侧会热更新。

## 配置

配置来源优先级：插件 `config` > `$DSH_HOME/dsh-pair-link.json`。

### 电脑端

`~/.dsh/dsh-pair-link.json`：

```json
{ "secret": "至少 32 位随机字符串" }
```

电脑端默认会**自己起一条 cloudflared 专用隧道**（`autoTunnel`，默认开），把当前公网地址显示在「远程电脑」面板顶部，复制给手机端即可。这条隧道直连本机 DSH，**不经过 dsh-bridge 之类的登录墙**，所以手机端只需要地址 + 配对密钥。

关闭自动隧道：配置 `"autoTunnel": false`。

### 手机端

在「远程电脑」面板里点「连接电脑」填即可（会写回 `~/.dsh/dsh-pair-link.json`）：

```json
{
  "secret": "与电脑端同一个值",
  "pairUrl": "https://<电脑端面板显示的公网地址>",
  "bridgeToken": "（可选）电脑前面那个远程访问插件的免密令牌",
  "bridgePassword": "（可选）电脑前面那个远程访问插件的访问密码"
}
```

`bridgeToken` 和 `bridgePassword` 有一位就够：

- **有密码就填密码**：插件在手机端服务端 `POST /__dsh_bridge__/login` 换会话 cookie，之后代理自动带 cookie，过期了会重登。密码只需要填一次。
- 有免密 token 也可以填 token（会拼成 `?token=`）。

> 密码/令牌只写在本机 `~/.dsh/dsh-pair-link.json`，不写日志。

`pairUrl` 支持这些写法，插件会自己归一：

| 写法 | 效果 |
| --- | --- |
| `https://host` | HTTP API 与 WS 都从根路径推 |
| `https://host/dsh-pair` | 同上，自动去掉 `/dsh-pair` |
| `wss://host/dsh-pair/ws` | 兼容旧配置 |
| `https://host/?token=xxx` | 查询串里的 token 自动当作 `bridgeToken` |

## 端点

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /dsh-pair/api/health` | 配对密钥 / 页面令牌 | 存活与版本 |
| `GET /dsh-pair/api/sessions` | 同上 | 会话列表（标题、更新时间、运行中） |
| `GET /dsh-pair/api/sessions/:id/messages?limit=40` | 同上 | 对话消息（已滤掉 DSH 注入的上下文） |
| `POST /dsh-pair/api/sessions/:id/prompt` | 同上 | 发一条消息 `{ "text": "..." }` |
| `POST /dsh-pair/api/sessions/:id/cancel` | 同上 | 停止当前轮 |
| `GET /dsh-pair/api/approvals` | 同上 | 待审批列表 |
| `POST /dsh-pair/api/approvals/:id` | 同上 | `{ "outcome": "allowed-once" \| "rejected" }` |
| `GET /dsh-pair/status` | 无 | 运行状态、连接数（不含 secret） |
| `GET /dsh-pair/simulate` | 无 | 注入一条测试审批（需要手机已连上） |
| `WS /dsh-pair/ws?pair=…` | 配对密钥 | 配对连接（`?token=` 也兼容） |
| `GET /dsh-pair/page-info` | 页面令牌 / 配对密钥 | 页面判断该用哪套接口 |
| `POST /dsh-pair/config` | 页面令牌 | 保存连接配置并立即重连 |
| `GET /dsh-pair/inbox` | 页面令牌 | 待审批（浮层轮询） |
| `POST /dsh-pair/decide` | 页面令牌 | 回传审批决定 |
| `GET /dsh-pair/remote/api/*` | 页面令牌 | 代理到电脑的 `/dsh-pair/api/*` |

**页面令牌**：启动时生成一个随机串，通过 `webServer.tapIndex` 注入到页面（`window.__DSH_PAIR_TOKEN__`），不落盘、不进日志。远程访问只能用它自己的配对密钥。

## 协议（WS）

服务端 → 客户端：

```jsonc
{ "type": "hello", "role": "host", "version": "0.3.0" }
{ "type": "approval", "id": "uuid", "toolName": "pwsh", "reason": "...", "sessionId": "..." }
{ "type": "approval-resolved", "id": "uuid", "outcome": "allowed-once" }
{ "type": "approval-delegated", "id": "uuid", "reason": "timeout-or-abort" }
```

客户端 → 服务端：

```jsonc
{ "type": "approval-decision", "id": "uuid", "outcome": "allowed-once" }
```

## 已知限制

1. **专用隧道地址每次重启都会变**：`cloudflared` 的 `*.trycloudflare.com` 随进程重启变化。变了就到电脑端「远程电脑」面板顶部复制新地址，手机端「修改连接」里改一下，不用重装。
2. **电脑前面若挡着远程访问插件**（如 dsh-bridge），它会对未认证请求返回 401。在手机端「修改连接」里填它的**访问密码**（推荐，插件会自己登录换会话）或免密令牌；两者都不填就会看到 401 提示。
3. **审批桥是附加能力**：`approval/request` 只有在 DSH 真正发起审批时才有回调（工具进入询问模式）。面板里的「发送 / 停止 / 读消息」不依赖它。
4. **消息按事件分页**：`limit` 是页大小，工具调用也算一条。页面默认折叠工具行，用「工具」按钮展开。
5. **手机端审批浮层只在前台存活**：3 秒轮询，锁屏或被系统冻结时收不到。
6. **同源代理依赖手机端 DSH 进程**：手机 App 必须真的在跑 DSH 后端，纯静态页面托管用不了。
7. **页面令牌只在页面加载时注入**：插件重载后需要刷新一次页面。

## 安全边界

- 只暴露会话读写与审批，不暴露 shell、任意文件写入、任意 RPC。
- 配对密钥只存在两端本机文件里，不写日志、不上报。
- 页面令牌每次启动重新生成。
- 跨网请走 HTTPS 隧道，不要裸奔到公网。

MIT License
