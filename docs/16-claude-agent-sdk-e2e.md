# 16 · 真实 Claude Agent SDK 端到端：通用 LLM 路由 → MiniMax

> 状态：2026-10-21 在 box（Linux x86_64，Node 24.22 / Electron 42.11.9）上 **真实跑通**。本文不含任何密钥；所有证据已脱敏（实际输出中 key 出现 0 次，见 §3）。
> 承接 docs/15 §3.4 中“延后”的那一块：把 `LlmRouteService.sessionRuntimeConfig()` 产出的 env/model 真正交给 Claude Agent SDK 的 `query()`。

## 1. 安装的官方包（不进仓库）

| 项 | 值 |
| --- | --- |
| npm 包 | **`@anthropic-ai/claude-agent-sdk@0.3.305`**（npm `latest`；原版 `app/package.json` 依赖 `^0.3.281`，0.3.305 在该范围内） |
| 原生二进制 | 由 optionalDependency **`@anthropic-ai/claude-agent-sdk-linux-x64@0.3.305`** 提供：`node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude`，ELF 64-bit x86-64，约 277 MB，`claude --version` → **`2.1.305 (Claude Code)`** |
| 安装位置 | `/workspace/claude-sdk-sandbox`（仓库外的一次性目录；`npm i @anthropic-ai/claude-agent-sdk@0.3.305`）。**未加入 port 依赖，未提交 node_modules** |
| 是否需要 `@anthropic-ai/claude-code` CLI 包 | **不需要**。SDK 0.3.x 自带按平台分发的 `claude` 原生二进制（原版打包也正是 `claude-agent-sdk-${platform}-${arch}/claude`，见 `claudeCodeExecutable` L19505）。`@anthropic-ai/claude-code` 最新为 2.1.305，与 SDK 内置二进制同版本，本轮未安装 |
| 运行时 | Node 24.22.0 ✅；Electron 42.11.9（`ELECTRON_RUN_AS_NODE=1`，内置 Node 24.19.0）✅ |

先前的阻塞点“box 上只有 macOS 版 bundled claude” 就此解决。

## 2. 最小真实会话路径（代码）

```
LlmRouteService.sessionAgentRuntime(meta)          route-service.ts（PORT-NEW）
  └─ sessionRuntimeConfig(meta)                    原版 createLocalRuntime 的 options.env + sessionModel
  └─ provider.agentCompat.gateProxy ? startAgentGateProxy(provider) → proxiedAgentEnv(env)
loadClaudeAgentSdk()  (env → 自动发现, docs/17 §4)  agent-sdk.ts：运行时 import() ESM sdk.mjs（esbuild 不改写）
claudeCodeExecutableFor(packageDir)                原版 L19505 的打包分支：…/claude-agent-sdk-<plat>-<arch>[-musl]/claude[.exe]
runAgentTurn(sdk, { runtime, prompt, cwd, executable, allowedTools, allowTool })
  └─ sdk.query({ prompt, options: minimalAgentOptions(...) })
```

`minimalAgentOptions` 是原版 `query()` 选项（L19964-20030）的最小子集：`cwd`、`model`（= `sessionModel`）、`env`（= 上面的 env，原样拷贝）、`pathToClaudeCodeExecutable`、`permissionMode:"default"`、`includePartialMessages:true`、`settingSources:[]`（原版只加载经签名校验的 project 设置——未移植，故全部关闭）、`strictMcpConfig:true` + `mcpServers:{}`、`systemPrompt:{type:"preset",preset:"claude_code"}`、`tools`（默认空；工具冒烟时 `["Bash"]`）、`allowedTools:[]`（不预先放行，交给 `canUseTool`）、`maxTurns`（无工具 1，有工具 4）、`persistSession:false`、`abortController`（超时）、`stderr`。
`runAgentTurn` 永不抛异常：收集 init（模型、`apiKeySource`、Claude Code 版本、工具）、顶层 assistant 文本、`tool_use`、`tool_result`、`canUseTool` 决策、result（subtype / is_error / turns / usage），出错放进 `error`；返回前过脱敏器，并把交给子进程的凭据（provider key 或 proxy token）登记为 secret。

CLI（**只在 `VIDEOCLAW_LLM_LIVE=1` 时发真实请求**，正常 `npm test` / CI 永远不会跑）：

```bash
VIDEOCLAW_LLM_LIVE=1 VIDEOCLAW_CLAUDE_AGENT_SDK=/workspace/claude-sdk-sandbox \
  node port/dist/cli/port-cli.cjs llm-agent-smoke minimax [prompt] [--tool | --key-probe]
```

- 默认：一问一答；`--tool`：让 agent 用 Bash 执行 `echo <随机 marker>`，校验 tool_result 中有 marker；`--key-probe`：让 agent 的 Bash 打印 `${#ANTHROPIC_AUTH_TOKEN}`（**只打印长度**），校验子进程看到的是会话 token 而不是 provider key。
- 每次使用临时 `CLAUDE_CONFIG_DIR`（隔离，不读 `~/.claude`）和临时 cwd；`canUseTool` 只放行 `^echo [A-Za-z0-9 _.-]+$`（或 key-probe 的那一条命令）。
- `VIDEOCLAW_CLAUDE_CODE_EXECUTABLE` 可覆盖二进制路径。

## 3. 真实端到端结果（并发 1、单轮、key 未打印）

全部 **成功**。以下为脱敏后的关键字段（完整 JSON 中 `grep -c $MINIMAX_API_KEY` = 0，stdout 与 stderr 均为 0）：

**① 一问一答（Node 24.22）**
```json
{"ok":true,"mode":"plain","childEnvHasProviderKey":false,"gateProxy":{"requests":1,"rejected":0,"maxInflight":1},
 "turn":{"ok":true,"assistantText":"I’m working.","streamEvents":7,"ms":4953,
  "init":{"model":"MiniMax-M3.1-Flash","apiKeySource":"none","claudeCodeVersion":"2.1.305","tools":[]},
  "result":{"subtype":"success","isError":false,"numTurns":1,"stopReason":"end_turn","usage":{"input_tokens":1032,"output_tokens":6,"cache_read_input_tokens":128}}}}
```
**② 工具往返（Bash `echo`）**
```json
{"ok":true,"mode":"tool","gateProxy":{"requests":2,"maxInflight":1},"toolMarker":"vc-tool-mvhic12q",
 "turn":{"assistantText":"vc-tool-mvhic12q",
  "toolCalls":[{"name":"Bash","input":{"command":"echo vc-tool-mvhic12q","description":"Echo test string"}}],
  "toolResults":[{"isError":false,"text":"vc-tool-mvhic12q"}],
  "result":{"subtype":"success","numTurns":2,"stopReason":"end_turn"}}}
```
**③ key-probe（证明 provider key 不在子进程 env 中）**
```json
{"ok":true,"mode":"key-probe","keyProbe":{"childSawTokenLength":69,"sessionTokenLength":69,"providerKeyLength":698,"childSawProviderKey":false},
 "turn":{"permissionChecks":[{"name":"Bash","input":{"command":"echo LEN=${#ANTHROPIC_AUTH_TOKEN}"},"allowed":true}],"toolResults":[{"isError":false,"text":"LEN=69"}]}}
```
**④ Electron 42.11.9（`ELECTRON_RUN_AS_NODE=1`）跑 `--tool`**：`ok:true`，tool_result = marker，gate proxy `requests:2, maxInflight:1`，约 4.8 s。
**⑤ canUseTool 拒绝路径**：要求执行带参数展开的命令（不在白名单）→ 两次 `canUseTool` 均 deny，SDK 把 `tool Bash is not allowed…` 作为 `is_error` tool_result 回给模型，模型如实说明无法执行，turn 正常结束（`success`）。

proxy 的 debug 日志（`VIDEOCLAW_LOG_LEVEL=debug`）每个上游请求一行：`agent_proxy.request {method:"POST", path:"/v1/messages", status:200, waitedMs, ms}`，不含任何头或 body。

## 4. 发现的不兼容 / 问题，以及处理

调试方法：先在仓库外用一个只记录“形状”的回环转发器（不记录鉴权头）观察 Claude Code 2.1.305 发往 MiniMax 的每个请求，再逐个开关 Claude Code 的 env 开关复测。

| # | 现象（实测） | 影响 | 处理 |
| --- | --- | --- | --- |
| 1 | SDK 模式下，第一轮对话的同时 Claude Code **并行**发出 `generate_session_title` 侧请求（小模型 = `ANTHROPIC_SMALL_FAST_MODEL`），外加一个无鉴权的 `HEAD {base}/api/hello` 连通性探测。观测到上游同时在途 **2 个 POST**（含探测为 3） | 违反共享 key（与 Pageway 共用）的 **并发 1** 约束；主进程的账号级闸门（docs/15 §4）完全看不到子进程流量；多个视频同时跑时更糟 | **① 新增回环 gate proxy**（见 §4.1），所有子进程请求进 `providerGate(gateKey)`；实测关闭 #1 的开关后，标题请求被串行排队（`waitedMs≈6587`，`maxInflight:1`）。**② MiniMax preset 默认 `agentCompat.disableNonessentialTraffic=true`** → `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`：实测 **标题侧请求与 `/api/hello` 探测都消失**，每轮只剩 1 个请求（同时关掉遥测）。仅开 `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` 不能去掉标题请求（已实测） |
| 2 | 标题请求带 `output_config.format = {type:"json_schema",…}`（beta `structured-outputs-2025-12-15`）。直接对 MiniMax 发同样请求：**200，但忽略 schema**，返回普通文本（外加 thinking 块） | Claude Code 依赖结构化输出的功能会拿到非 JSON（标题生成会静默失败；其他用到 `outputFormat` 的路径同理） | ~~MiniMax preset 默认 `disableStructuredOutputs=true`~~ → **第四轮（docs/17 §3）改为 gate proxy 模拟**（`emulateStructuredOutputs=true`）：无工具的 `output_config.format` 请求 → 强制工具调用 → 回写成 JSON 文本，真实 Claude Code 持久化了模拟出的 `ai-title`。补充：真实 Claude Code 的标题提示词本身要求 JSON，所以原生（被忽略）时标题通常也能解析，但不是被约束的 |
| 3 | **安全**：provider key 以 `ANTHROPIC_AUTH_TOKEN` 注入子进程，agent 自己的 Bash 工具能读到（实测 `echo LEN=${#ANTHROPIC_AUTH_TOKEN}` → 698 = 真实 key 长度） | 模型 / 提示注入可以把 key 读进上下文或外传 | gate proxy：子进程只拿到 69 字符的每会话随机 token（`vcgp_`+64 hex），proxy 校验 token 后换成真实鉴权头；子进程 env 中 provider key 出现 0 次（`childEnvHasProviderKey:false`，key-probe 实测 `LEN=69`）。proxy 拒绝真实 key 本身（只认 token），只转发 `/v1/*`，`/api/hello` 本地答 200 不外发 |
| 4 | stderr：`[claude-code:unrecognized_model] {"model":"MiniMax-M3.1-Flash",…}` | 无功能影响；Claude Code 不认识模型 → `total_cost_usd`/`costUSD` 按默认价目估算（`costBasis:"unknown"`），**数字不可信** | 记录在案。provider 路由不要使用 SDK 结果里的费用字段；计费以 MiniMax 账单为准 |
| 5 | Claude Code 对它判定为只读的命令（如 `echo hello`）**不调用 `canUseTool`** 直接执行；带参数展开的命令才会询问 | 不是 MiniMax 问题，但意味着 `canUseTool` 不是完整的工具审计点 | `runAgentTurn` 另外记录模型发出的所有 `tool_use`（`toolCalls`），与 `permissionChecks` 分开；完整权限体系（原版 `adaptClaudeCodeCanUseTool` + hooks）仍属延后项 |
| 6 | 请求体里的 `thinking:{type:"adaptive",display:"omitted"/"updates"}`、`context_management.edits[clear_thinking_20251015]`、`output_config.effort`、`cache_control`（3 处）、`metadata.user_id`、12 个工具定义、一长串 `anthropic-beta`（claude-code / interleaved-thinking / context-management / prompt-caching-scope / effort / advanced-tool-use / mid-conversation-tool-changes …） | **全部被 MiniMax 接受**（200，流式 SSE 正常，返回带 signature 的 thinking 块，tool_use→tool_result 往返正常，usage 中有 `cache_read_input_tokens`） | 无需处理。为将来不兼容的服务器预留了开关：`disablePromptCaching`（`DISABLE_PROMPT_CACHING`）、`disableExperimentalBetas`（`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`）、`disableThinking`、`disableAdaptiveThinking`。MiniMax 均保持关闭 |
| 7 | 小模型（haiku / small-fast）请求：模型名由 `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` 决定，docs/15 的别名机制已全部映射到 `MiniMax-M3.1-Flash` | 无 404 / 未知模型错误 | 已有 `aliases` 配置即可重映射 |
| 8 | `result.subtype` 可能是 `"success"` 但 `is_error:true`（例如上游不可达时：`API Error: Connection refused …`），SDK 随后还会抛 `Claude Code returned an error result` | 只看 subtype 会误判成功 | `runAgentTurn` 以 `subtype==="success" && !is_error` 判定，异常进入 `error` |

### 4.1 gate proxy（`port/src/main/llm/agent-gate-proxy.ts`）

- 监听 `127.0.0.1:<随机端口>`，生命周期 = 一个 SDK 子进程（`sessionAgentRuntime().close()`）。
- 每个上游请求在 `providerGate(gateKey, maxConcurrency)` 内执行，**直到流式响应结束才释放**；与主进程 helper 调用共用同一个账号级闸门（同一 `apiKeyEnv` 的所有 provider 取最小并发）。客户端中断 → 中止上游并释放名额。
- 鉴权：只认会话 token（`Authorization: Bearer` 或 `x-api-key`，定长比较）；转发时剥掉逐跳头/`accept-encoding`/鉴权头，补上 provider 的真实鉴权（bearer / x-api-key / 自定义 header 三种）与非密钥自定义头；响应去掉 `content-encoding/length`。
- 请求体上限 64 MB；上游不可达 → 502（不含 key）。
- 开关：provider 配置 `agentCompat.gateProxy`（MiniMax preset 默认开）。未开启的 provider 维持 docs/15 的直连 env 不变。

### 4.2 `agentCompat` 配置（provider schema 新字段，全部默认 false）

| 字段 | Claude Code env | MiniMax preset |
| --- | --- | --- |
| `gateProxy` | （走 §4.1 proxy） | **true** |
| `disableNonessentialTraffic` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | **true** |
| `disableStructuredOutputs` | `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS=1` | false（第四轮起；原为 true） |
| `emulateStructuredOutputs` | （gate proxy 改写，无 env） | **true**（第四轮，docs/17 §3.2） |
| `disablePromptCaching` | `DISABLE_PROMPT_CACHING=1` | false（实测支持 cache_control） |
| `disableExperimentalBetas` | `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` | false（实测接受全部 beta） |
| `disableThinking` / `disableAdaptiveThinking` | `CLAUDE_CODE_DISABLE_THINKING=1` / `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` | false |

env 名取自 Claude Code 2.1.305 二进制中的字符串，前三个已实测生效；后四个仅确认名字存在，**效果未实测**。用户 providers 文件可逐项覆盖（与 preset 一层深合并），例如 `{"name":"minimax","agentCompat":{"disableNonessentialTraffic":false}}`。

## 5. 仍延后

- 原版 `createLocalRuntime` 的完整选项：流式输入（`prompt: inputStream()`）、`resume` / `sessionStore` / `enableFileCheckpointing`、`replay-user-messages`、project 设置 + 签名校验的 hooks、studio MCP 服务器、`adaptClaudeCodeCanUseTool` 权限适配与 UI、`allowedTools/disallowedTools` 产品清单、`autoCompact` 设置、`effort` 选项。
- AgentHost 会话生命周期（spawn/teardown、路由变更时 teardown、并发会话管理）、Claude Code 登录探测（`claude-code` 路由 readiness）、CredentialStore。
- ~~SDK 需手动设置 `VIDEOCLAW_CLAUDE_AGENT_SDK`~~ → 第四轮：自动发现 + `npm run agent-sdk:install`（docs/17 §4）；~~electron-builder 打包配置仍未做~~ → 第五轮：SDK + 原生 `claude` 作为 extraResources 进包（`resources/claude-agent-sdk`），Linux 打包产物中已真实跑通一次 agent 回合（docs/18 §2–3）。
- 每个 proxy token 会登记进进程级脱敏集合且不移除（每会话 69 字节，长时间运行的轻微增长）。

## 6. 已验证 / 未验证

**已验证**：Linux 上官方 SDK 0.3.305 + 原生 claude 2.1.305 正常运行；Node 24.22 与 Electron 42.11.9 均可加载 SDK 并跑通；经 `sessionRuntimeConfig()`/`sessionAgentRuntime()` 的 env/model 驱动真实 agent 对 MiniMax Anthropic 兼容端点完成一问一答、Bash 工具往返、canUseTool 允许/拒绝两条路径；gate proxy 下 `maxInflight` 始终为 1（含故意打开标题请求时的串行化）；子进程 env 不含 provider key（Bash 实测）；输出与日志中 key 出现 0 次；不兼容 #1-#3 的处理实测有效。

**第四轮更新**：结构化输出改为 proxy 模拟并真实验证（docs/17）；SDK 自动发现真实验证（不设 env，`source:"vendor"`）。

**未验证**：`disableStructuredOutputs` 下 Claude Code 的回退行为（仅 1 个样本）；`disablePromptCaching` / `disableExperimentalBetas` / `disableThinking*` 的实际效果；子 agent（`Agent` 工具）、长对话自动压缩、图片输入经真实 Claude Code → MiniMax；`x-api-key` / `header` 鉴权方案经真实 Claude Code（只有 mock + proxy 单测）；Windows / macOS 原生二进制（第五轮只验证了交叉安装与进包布局，未运行，docs/18 §6）；多个视频同时运行时的实际排队时延；MiniMax 真实 429/529 下 Claude Code 自身的重试与我们闸门的叠加效果。
