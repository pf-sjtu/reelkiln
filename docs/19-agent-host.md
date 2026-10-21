# 19 · 最小 AgentHost：从 UI 发起真实 agent 回合（第六轮）

> 2026-10-21，box（Debian trixie x64，Electron 42.11.9 / Node 24.19，Claude Agent SDK 0.3.305 + 内置 Claude Code 2.1.305）。代码全部在 `port/`；`app/out`、`app/reconstructed` 只作参照、未改动。MiniMax key 只来自 box 环境变量，未打印/记录/提交（证据文件 grep key 命中 0）。

> **后续（docs/21）**：有已安装引擎时 AgentHost 默认跑引擎会话（工作区 cwd、原版权限模型、job 绑定、sessions.json 持久化）；本文描述的只读确认聊天保留为 `VIDEOCLAW_PORT_AGENT_ENGINE=0` / 无引擎时的回退。

## 0. 已验证 / 未验证（一览）

| 项 | 状态 | 证据 |
|---|---|---|
| UI → IPC → AgentHost → SDK `query()` → Claude Code → gate proxy → MiniMax，真实回合（dev 模式） | ✅ 已验证（1 次运行，2 个回合，并发 1） | `artifacts/agent-ui-run/dev-run.events.log` + `dev-ui.png`：在 Agent 页输入框填提示词、点 **Send**；`Glob` 工具调用（`tool_start`→`tool_end ok`），流式 `text_delta` 6 个、`assistant_text` 2 个，`result` success，状态回到 idle，耗时 25.8 s |
| 同上，**打包 AppImage**（`APPIMAGE_EXTRACT_AND_RUN=1`） | ✅ 已验证（1 次运行，2 个回合） | `artifacts/agent-ui-run/appimage-run.events.log` + `appimage-ui.png`：`packaged:true`，SDK `source:"resources"`；`Glob` 工具调用 ok，回答 “The directory contains a single file: `README.txt`.”，9.3 s |
| UI 上 **Stop** 真实生效 | ✅ 已验证（dev + AppImage 各 1 次） | 第二回合开始流式输出后点 Stop：100 ms 内回到 idle，出现 “Stopped after x s”，之后 4 s 内 0 条输出事件；AppImage 那次是在**文本流式中途**停下（转录只有半句 “1. The Nile is … (”）；dev 那次是在模型先调用 `Read` 工具时停下 |
| 工具调用经 IPC 显示 | ✅ | `tool_start {toolName:"Glob", summary:"Glob *"}` / `tool_end {terminal:"ok"}`，截图中的 “⚙ Glob * — ok” |
| 子进程拿不到 provider key | ✅（沿用 docs/16 的 gate proxy；本轮日志确认 `gateProxy:true`、`maxConcurrency:1`） | 本轮没有重复 key-probe（为少打 MiniMax）；单测断言 child env 只有 `vcgp_` 会话 token、上游看到真 key |
| 路由切换时拆 runtime（`onLlmRouteChanged`） | ✅ 单测；⚠️ 真实 UI 中未专门演示 | 冒烟里 `settings:set(minimax)` 触发了钩子（当时无 runtime，`interrupted=0`）；运行中切换路由的行为只在 mock 测试里验证 |
| host 级并发 1 | ✅ 单测；真实运行中两回合串行 | 第二个视频在第一个运行中发送 → `ComposerDeliveryError`，不会起第二个 SDK 子进程 |
| interrupt ack 超时 → teardown | ✅ 单测（mock） | 真实 Claude Code 两次 interrupt 都及时 ack，未触发超时路径 |
| deb 包 / Windows / macOS 上从 UI 跑回合 | ❌ 未验证 | 本轮只跑了 dev 与 AppImage |
| AppImage FUSE 直接运行 | ⚠️ 本轮失败 | `fuse: failed to exec fusermount`（box 上只有 `fusermount3`）；改用 `APPIMAGE_EXTRACT_AND_RUN=1`。未做系统改动（docs/18 记录的 FUSE 直跑本轮无法复现，原因未深究） |

真实 MiniMax 请求量：dev 一次运行 + AppImage 一次运行，每次 2 个用户回合（含 1 次工具往返、1 次被 Stop 中断），全程并发 1（gate proxy `maxConcurrency:1` + host 级 1 回合闸门）。

## 1. 原版参照（`app/reconstructed/main/index.js`）

| 原版 | 行 | port 中的对应 |
|---|---|---|
| `class AgentHost` 构造（`emit.sessionEvent` 包装） | L34784 | `AgentHost`（`port/src/main/agent/agent-host.ts`） |
| `createSession(req)`：新 id、cwd、`llmRoute` 固定为当前路由、`status:"idle"`、`sessionsChanged` | L38726 | `createSession`（路由 pin 走 `LlmRouteService.newSessionLlmRoute()`） |
| `sendMessage` / `submitMessage`：`{text, attachmentIds, clientTurnId}`，同一 clientTurnId 去重，返回 `{submitted, duplicate, attachmentIds}` | L41400 / L41419 | `sendMessage`（同形状；附件拒绝） |
| `spawnLocal` + `createLocalRuntime`：**流式输入**（queue/pending/wake 的 async iterable 作为 `prompt`），一个会话一个长寿 `query()` | L39454 / L23059 | `spawn()`：同样的输入队列；env/model 来自 `sessionAgentRuntime()` |
| `consume(s)`：`for await (m of rt.query)` → `reduce`，流结束/异常处理 | L50152 | `consume()` |
| `reduce(s, m)`：`text_delta`、`assistant_text`、`thinking`、`tool_start`、`tool_end`、`result` | L50416 | `reduce()`（子集，字段名一致） |
| `setStatus` → `{kind:"status", status}` + `sessionsChanged` | L50990 | `setStatus()` |
| `interrupt(sessionId, "stop"\|"steer")`：Stop 先发合成 `result {stoppedAfterMs, stopTurnId}`、置 idle，再 `acknowledgedInterrupt`（8 s 上限，超时 teardown） | L43860 / L43844 | `interrupt()` / `acknowledgedInterrupt()`（上限可配，默认 8 s） |
| `teardownRuntime`：`rt.dead`、关工具、`query.close()` | L42932 | `teardownRuntime()`（另外关闭 gate proxy） |
| `onLlmRouteChanged`：跳过固定为 `claude-code`/`gateway` 的视频，其余拆 runtime；运行中的回合发原版错误卡片 + `status:"error"` | L43127 | `onLlmRouteChanged()`（同文案） |
| IPC：`session:create` / `session:send` / `session:interrupt` handler | L61690 / L61772 / L61780 | `agent-ipc.ts` |
| push：`sendToRenderer("session:event", {sessionId, event})` | L61049 | `agentHostEmit()` |

## 2. 设计

```
renderer Agent 页 (agent-chat.ts)
  window.videoclaw.createSession / sendMessage / interrupt / onSessionEvent   ← 原版 184 方法 bridge，未改
        │ ipcRenderer.invoke("session:create"|"session:send"|"session:interrupt")
        ▼
main: real-backend.ts → agentIpcHandlers(host)                  push "session:event" {sessionId, event}
        ▼                                                        push "session:changed" [metas]
AgentHost ── createSession: pin llmRoute = service.newSessionLlmRoute()
          ── sendMessage: 闸门(1) → ensureRuntime → 入队 SDKUserMessage
          ── spawn: readiness → loadSdk(自动发现) → service.sessionAgentRuntime(meta)
          │          → query({ prompt: <async iterable>, options: minimalAgentOptions(...) })
          ── consume/reduce → 原版事件
          ── interrupt / teardownRuntime / onLlmRouteChanged / dispose
        ▼
Claude Code 子进程（env 只有 vcgp_ 会话 token）→ loopback gate proxy（providerGate 并发 1、换真 key、结构化输出模拟）→ MiniMax
```

- **会话 runtime**：每个视频一个 `query()`，`prompt` 是 async iterable（原版 createLocalRuntime 的做法），第二回合复用同一个 Claude Code 子进程和 gate proxy（单测断言只有 1 次 `query()`）。runtime 被拆掉后下次发送重新 spawn。
- **选项**：沿用 docs/16 的 `minimalAgentOptions`（`settingSources: []`、`strictMcpConfig`、`mcpServers: {}`、`persistSession:false`、`includePartialMessages:true`、`permissionMode:"default"`），`maxTurns` 8，`tools` 为白名单。
- **工具策略（PORT-NEW）**：默认 `Read, Glob, Grep`（可用 `VIDEOCLAW_PORT_AGENT_TOOLS=Read,Glob` 或 `none` 覆盖）；`canUseTool` 只允许白名单内且所有路径参数（`file_path`/`path`/`notebook_path`）都在本会话目录 `userData/agent-sessions/<id>/` 内的调用。**不开放 Bash**（docs/16 发现 Claude Code 会对“只读”命令跳过 canUseTool）。每个会话目录里放一个 `README.txt`，好让只读工具有东西可找。注意：本轮真实运行中 Claude Code 对会话目录内的 Glob/Read **自动放行、没有咨询 canUseTool**（日志里没有 `agent.tool.permission`）——目录外的路径仍会走 canUseTool 并被拒（单测）。
- **并发（PORT-NEW）**：`maxConcurrentTurns` 默认 1，跨视频生效：另一个视频还在跑时发送直接拒绝（`ComposerDeliveryError`，原版会排队/折叠），同一视频运行中再次发送也拒绝（原版会折叠进当前回合）。闸门在任何 `await` 之前占位，同一 tick 的两次发送只有一个成功（单测）。HTTP 层面每个子进程的所有请求（含 Claude Code 自己的旁路请求）仍经 gate proxy 的 `providerGate(gateKey)` 串行。
- **Stop**：先发合成 `result {stoppedAfterMs, stopTurnId}`、立刻 idle（与原版一致），再 `query.interrupt()`；被中断回合随后吐出的尾巴（部分文本、`error_during_execution` 结果）用 `staleResults` 计数吞掉，不会串到下一回合。8 s 内没有 ack → `teardownRuntime`（`query.close()` 杀子进程 + 关 gate proxy）。在 runtime 还没起来时点 Stop：回 idle，起来后不入队。
- **路由切换**：`settings:set` → `LlmRouteService.notifyIfRouteChanged` → `host.onLlmRouteChanged()`（原来这里只打日志）。与原版相同：固定为 `claude-code`/`gateway` 的视频不动，其余（含 provider 固定视频）拆 runtime；运行中的回合收到原版文案的错误卡片并进入 `error`；spawn 进行中的会话用 `epoch` 作废迟到的 runtime（gate proxy 立即关闭）。视频的路由 pin 不变（与 docs/15 fail-closed 语义一致），下一次发送仍走它固定的路由；要用新路由请点 “New chat”。
- **错误**：route 未就绪（如缺 key → `not ready (provider-key-missing: set MINIMAX_API_KEY)`）、SDK 缺失 → `error` 事件 + `status:"error"` + `session:send` reject；`result` 非 success → `result {isError:true}` + 错误卡片；流意外结束 → 错误卡片。所有文本过 `redactText`，工具输入过 `redact`。
- **turn 超时安全网**：5 分钟没有 `result` → 错误卡片 + teardown。

## 3. IPC 面

| 通道 | 方向 | 原版 / port | 形状 |
|---|---|---|---|
| `session:create` | invoke | **复用原版** | `(req) → meta`；meta 含 `sessionId,title,cwd,status,permissionMode,totalCostUsd,createdAt,clientId,agentHarness,llmRoute` + PORT-NEW `portAgentHost:true` |
| `session:send` | invoke | **复用原版** | `(sessionId, {text, attachmentIds, clientTurnId}) → {submitted, duplicate, attachmentIds}`；也接受字符串 |
| `session:interrupt` | invoke | **复用原版** | `(sessionId, "stop"\|"steer")`；本 port 中 steer 与 stop 行为相同（不支持折叠） |
| `session:list` | invoke | **复用原版** | `sessions.json`（只读 registry）+ host 内存会话 |
| `session:event` | push | **复用原版** | `{sessionId, event}`；event kind：`status`、`text_delta`、`assistant_text`、`thinking`、`tool_start`、`tool_end`、`result`、`error` —— 字段与原版 `reduce()` 相同；另有 **PORT-NEW** 诊断 kind `port_runtime {phase:"started"\|"closed", llmRoute, model, gateProxy, claudeCodeVersion?, reason?}`（原版渲染器会忽略未知 kind） |
| `session:changed` | push | **复用原版** | 会话列表 |

没有新增 `port:*` 通道；renderer 用的就是生成的 184 方法 `window.videoclaw` bridge（`createSession`/`sendMessage`/`interrupt`/`onSessionEvent`）。路由标签用已有的 `port:llm:routes`。

**与原版的差异**：`session:history`、`session:retry`、`session:setModel`、`session:setPermissionMode`、`permission:*`、`input:*`、`spend*` 等仍走 fake backend（未实现）；host 会话**不写** `sessions.json`，重启后消失；`totalCostUsd` 只在 gateway 路由累计（与原版一致，provider 路由不计费）。

## 4. Renderer：Agent 页

`port/src/renderer/agent-chat.ts`（DOM）+ `agent-chat-model.ts`（纯 reducer，单测）。顶部导航新增 **Agent** 标签：状态行（会话 id · status）、runtime 行（`minimax · MiniMax-M3.1-Flash · gate proxy · Claude Code 2.1.305`）、New chat、流式转录（用户气泡 / 助手气泡随 `text_delta` 增长、`assistant_text` 落定 / 工具芯片 “⚙ Glob * — ok” / 错误与 “Stopped after x s” 提示）、输入框（Ctrl+Enter 发送）、**Send**、**Stop**（只在 running 时可点）。第一次 Send 自动 `createSession`。

## 5. 仍延后（及原因）

- **持久化**：display transcript、`session:history`、写 `sessions.json`、resume（`sdkSessionId`）——需要原版 transcript store / turn store，量大；本轮只要求一个真实回合。
- **权限 UI / permission 卡片 / `setPermissionMode`**：原版的权限体系和 spend gate 依赖 gateway 计费与 studio 工具策略；这里用静态白名单 + 目录约束代替，不开放写工具和 Bash。
- **MCP（studio MCP）、hooks、技能、引擎 env（`engineSessionEnv`/production contract）**：依赖引擎安装与 attested hooks，超出本轮。
- **steer / 回合中追加消息、排队、retry、附件、标题生成、job 绑定、pulse/遥测**：原版逻辑庞大；当前用“运行中拒绝发送”保证并发 1。
- **Codex harness、remote runtime、claude-code 登录探测**：未移植（`claude-code` 路由 readiness 仍为 unknown，可能在 spawn 时失败并显示错误卡片）。

## 6. 复现

```bash
cd port && npm run build
# dev 模式，从 UI 驱动 1 个工具回合 + 1 个 Stop 回合（真实 MiniMax，需要 MINIMAX_API_KEY 在环境中）
T=$(mktemp -d) && mkdir -p $T/home $T/ud
env -u VIDEOCLAW_CLAUDE_AGENT_SDK HOME=$T/home VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax \
  VIDEOCLAW_PORT_SMOKE_AGENT="Use the Glob tool to list the files in the current directory. Then reply with one short sentence naming the file you found." \
  VIDEOCLAW_PORT_SMOKE_AGENT_STOP="Without using any tools, write a numbered list of 40 short facts about rivers, one fact per line." \
  VIDEOCLAW_PORT_SMOKE_SCREENSHOT=$T/ui.png \
  xvfb-run -a npx electron . --no-sandbox --user-data-dir=$T/ud
# 打包：npm run package:linux，然后把 `npx electron .` 换成
#   APPIMAGE_EXTRACT_AND_RUN=1 ./release/Videoclaw-Port-0.0.40-port.0-linux-x86_64.AppImage
```

冒烟驱动（`port/src/main/smoke.ts`）是真点击：切到 Agent 标签 → 填 `#agentInput` → 点 `#agentSend` → 等 `status` 从 running 回到 idle 且有 `result`；Stop 场景等到第一个 `text_delta`/`tool_start` 后点 `#agentStop`，要求 15 s 内 idle、合成 stopped result、之后 4 s 内没有输出事件。判定 `DONE failed=[]`。

## 7. 测试

`port/test/agent-host.test.ts` 13 个（mock SDK 边界 + IPC），全量 **190/190** 通过，`npm run build` 绿：

- createSession 路由 pin / 会话目录 / `session:changed`
- 发送 → 只起 1 个流式输入 `query()`，选项（env token、model、executable、tools、隔离 MCP/settings、canUseTool）、事件顺序与字段；第二回合复用 runtime；clientTurnId 去重；空消息 / 未知会话
- 工具事件 + canUseTool 目录约束（含 `/w/s10` 前缀兄弟目录、`../`、Bash 拒绝）+ `VIDEOCLAW_PORT_AGENT_TOOLS` 解析
- Stop：合成 stopped result、立即 idle、`interrupt()` 被调用、被中断回合尾巴被吞、下一回合正常
- interrupt ack 超时 → `query.close()` + gate proxy close，下次发送重新 spawn
- spawn 中 Stop：不入队
- 路由切换：运行中 → 原版错误卡片 + error + teardown；空闲 runtime → teardown；`claude-code` 固定视频不动；之后发送仍走固定路由；spawn 中切换 → 迟到 runtime 被丢弃且 proxy 关闭
- 并发：同 tick 两个视频只成功一个、同视频运行中拒绝、不会起第二个子进程、Stop 后释放
- 未就绪 / SDK 缺失 / 错误 result → 错误事件与状态
- IPC glue：原版通道名存在于契约、push 形状 `{sessionId, event}`
- renderer reducer
- 集成：真实 `LlmRouteService` + gate proxy + 本地上游：子进程 env 无 key、上游收到真 key、路由切换后 proxy 端口关闭

## 8. 未验证 / 风险

- 只在 Linux（dev + AppImage extract-and-run）从 UI 验证；deb、Windows、macOS 未从 UI 跑过。AppImage FUSE 直跑本轮失败（box 只有 `fusermount3`），未做系统改动。
- 真实运行中没有演示“运行中切路由”和“interrupt ack 超时”，这两条只有 mock 测试。
- Claude Code 对会话目录内的只读工具自动放行，不咨询 canUseTool；我们的目录约束只对目录外路径生效（依赖 Claude Code 自身的“工作目录内只读自动允许”规则，版本升级可能改变）。
- host 会话不持久化；应用重启后对话消失（gate proxy / 子进程随 `will-quit` 的 `dispose()` 关闭；冒烟用 `app.exit(0)` 不触发 will-quit，进程退出后没有残留 `claude` 进程，已用 `pgrep` 检查）。
- 跨视频“拒绝而不是排队”是 port 的策略，与原版 UX 不同；原版 renderer 移植时需要改成排队或给出 UI 提示。
- MiniMax 偶发的 429/529 在 UI 中预计表现为错误卡片（重试行为取决于 Claude Code 与 gate proxy，本轮未遇到、未验证）。
- `port_runtime` 是 PORT-NEW 事件 kind；若将来接原版 React renderer，需要确认它会忽略未知 kind（预计会，未验证）。
