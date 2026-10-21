# 15 · 通用自定义 LLM 接入框架 + models.dev 模型目录同步

> 状态：已在 `port/` 落地（2026-10-21）。本文 **不含任何密钥**；密钥只存在于环境变量中，配置文件里只写环境变量 **名**。
> 取代 docs/14 中“MiniMax 特判”的实现：MiniMax 现在只是本框架的一个内置 preset（行为保持 docs/14 已验证的结论）。

## 0. 已验证 / 未验证（2026-10-21 第三轮“真实 Claude Agent SDK 端到端”后，box，Node 24.22 / Electron 42.11.9）

> **第六轮（docs/19）**：最小 **AgentHost**（主进程会话生命周期）接在原版 IPC 契约上（`session:create` / `session:send` / `session:interrupt` + push `session:event` / `session:changed`）：每个视频一个流式输入 `query()`，经 `sessionAgentRuntime()`（gate proxy 并发 1 + key 隔离 + 结构化输出模拟）；Stop / interrupt ack 超时 teardown / 路由切换 teardown / host 级 1 回合闸门；renderer 新增 **Agent** 页。**从 UI 真实跑通** MiniMax 工具回合（Glob）+ Stop：dev 模式与打包 AppImage 各 1 次。`npm test` **190/190**。
>
> **第五轮（docs/18）**：electron-builder 打包（Linux AppImage + deb 已构建并在 box 上启动冒烟；打包后 SDK 从 `resources/claude-agent-sdk` 自动发现、node:sqlite 正常、打包二进制里真实 agent 回合 1 次成功；Windows nsis / macOS dmg 仅配置，未验证）；renderer 新增正式 **Settings** 页 LLM 路由选择器（状态徽章、不可用原因、经原版 `settings:set` 持久化、`port:llm:routesChanged` 推送 + 焦点刷新）。`npm test` **177/177**。
>
> **第四轮（docs/17）**：结构化输出（helper `structuredOutput: native|tool|off`，OpenAI `response_format` 透传 / Responses `text.format` / Anthropic `output_config.format`；MiniMax 用强制工具调用，实测 12/12）、gate proxy 结构化输出模拟、SDK 自动发现 + `npm run agent-sdk:install`、PORT-NEW `port:llm:routes` 路由列表 IPC + stub renderer 选择器。`npm test` **165/165**。
>
> 第三轮详见 **docs/16**：官方 `@anthropic-ai/claude-agent-sdk@0.3.305`（内置 Linux 原生 `claude` 2.1.305）经本框架路由对 MiniMax **真实跑通**一问一答 + Bash 工具往返；发现并处理了并发/结构化输出/key 暴露三个问题（gate proxy + `agentCompat`）。

**已验证**

| 项 | 结果 |
| --- | --- |
| `npm run build`（gen + tsc + esbuild）| 通过 |
| `npm test`（node:test）| **150/150 通过**（第一轮 111 + 第二轮 28 + 第三轮 11：`llm-agent-sdk.test.ts`） |
| **真实 Claude Agent SDK 端到端（第三轮）** | `llm-agent-smoke minimax`：一问一答 ✅、`--tool` Bash 往返 ✅、`--key-probe` 子进程只见 69 字符会话 token（非 698 字符 key）✅、Electron 42 下 `--tool` ✅；gate proxy `maxInflight` 恒为 1；输出/日志 key 0 次（docs/16 §3） |
| 同一测试套件跑在 **Node 22.13.0** | 139/139 通过（`npx node@22.13.0 --test dist-test/*.test.cjs`） |
| 原始行为差分 | `Settings` 类（加载/归一化/get/patch/写盘字节/legacy 凭据）、`rendererWritableSettingsPatch`、`sessionLlmRoute`/`sessionHelperKind`/`sessionModel`、`createLocalRuntime` 子进程 env 块（claude-code / gateway / 无 key gateway）、`anthropicClientJobCustomHeaders`（shipped chunk）——均与原文逐值一致；此前的 `resolvedLlmRoute`/`sanitizedAgentEnv`/`resolveHelperCreds` 差分仍通过 |
| 主进程接线（真 Electron）| `xvfb-run electron .` + `VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=acme`（临时 providers 文件 + 假 key）：`settings:get` → 真 Settings；`settings:set({llmRoute:"acme"})` → 写入 `userData/settings.json`、触发 `llm.route.changed`；`engine:llmRouteReadiness` → `{route:"acme",ready:true}`；userData 下所有文件中 **假 key 出现 0 次** |
| 子进程 env 注入 | 测试中真实 `spawn` 一个 node 子进程：收到 `ANTHROPIC_AUTH_TOKEN`（sha256 对上）、base URL、别名、`CLAUDE_CONFIG_DIR`、effort；父进程其他含 KEY/TOKEN 的变量 **一个都没漏过去** |
| 热重载 | 显式 reload、`fs.watchFile`（原地写 + 编辑器式 tmp+rename 都触发）、非法配置 → 只剩内置 preset（含 `configError`）、修复后恢复、闸门在线扩缩容 |
| OpenAI 兼容端点真实请求 | **1 次**：MiniMax 的 OpenAI 兼容 chat 端点（`https://api.minimaxi.com/v1`，`openai-chat-completions` + `max_completion_tokens`）+ 64×64 红色 PNG（base64 → `image_url` data URL），经 `LlmRouteService.sessionHelperComplete` → `{ok:true,text:"Red"}`，约 7.5 s；输出中 key 出现 0 次。box 上无 `OPENAI_API_KEY` / `OPENROUTER_API_KEY`，**未对 OpenAI/OpenRouter 本身发请求** |
| node:sqlite 可移植性 | `sqlite-check`：Node 24.22 → SQLite 3.53.4；Electron 42.11.9（Node 24.19）→ 3.53.3；**Node 22.13.0 → 3.47.2 可用**；**Node 22.12.0 / 20.18.0 → 明确的 `SQLITE_UNAVAILABLE` 错误**（含运行时、最低版本），进程不崩 |
| models.dev 304 | 新库 `models-sync` → `updated`（232 provider / 9079 模型，0 跳过，0.6 s）；再次 → **`not-modified`（304）**；Electron 运行时再次 → `not-modified` |

**未验证 / 风险**

- [x] ~~Claude Agent SDK `query()` 从未真实拉起~~ → **第三轮已真实跑通**（docs/16）。仍延后：原版 `createLocalRuntime` 的完整选项（resume、hooks、studio MCP、权限适配/UI、session store）；~~AgentHost 会话生命周期~~（第六轮：最小 AgentHost + 流式输入 + UI 真实回合，docs/19）；SDK 不是 port 的 npm 依赖；第四轮起自动发现（`npm run agent-sdk:install` → `port/vendor/`，或打包布局 / env，docs/17 §4）。
- [ ] `agentCompat` 中 `disablePromptCaching` / `disableExperimentalBetas` / `disableThinking*` 的效果未实测（MiniMax 不需要）；`disableStructuredOutputs` 下 Claude Code 的回退行为只看到 1 个样本（docs/17 §8）。MiniMax preset 已改用 `emulateStructuredOutputs`（真实验证，docs/17 §3）。
- [ ] `openai-responses` 协议从未对任何真实端点发过请求（只有 mock）；`openai-chat-completions` 只对 MiniMax 的兼容端点实测过，未对 OpenAI/OpenRouter/DeepSeek 实测。
- [ ] 多模态：PDF（`file`/`input_file`）、URL 图片、tool_use/tool_result 的转换只按公开 schema + mock 测试；真实端点只验证了 base64 PNG → chat `image_url`。
- [ ] `auth.scheme="header"` / `x-api-key` 经**真实** Claude Code 子进程的效果（bearer 已实测；另两种只有 mock + gate proxy 单测）、`CLAUDE_CODE_EFFORT_LEVEL` 是否被采纳（实测请求体中 `output_config.effort` 为 `"high"`，preset 未设 effort）——未实测。
- [ ] Windows / macOS 上实际运行（`fs.watchFile`、`node:sqlite`、settings 原子写 `rename`/`chmod`）——只在 Linux 上跑过；代码按跨平台 API 写，`SIGHUP` 在 win32 上不安装。
- [ ] 真实 429/529 + `retry-after`、真实 deadline 触发——仍只有 mock。
- [ ] `claude-code` 路由的 readiness（原版的 Claude Code 登录探测）未移植：该情况下 `engine:llmRouteReadiness` 返回 `undefined`（与原 fake backend 相同）。
- [ ] gateway 凭据库（CredentialStore）未移植：port 中 gateway 路由没有 key，helper 凭据为 null（与上一轮一致）。
- [ ] 网络错误 / 超时 **不自动重试**（只重试配置的 HTTP 状态 / 响应体错误码），以免 POST 重复计费；如需要可后续按 provider 配置开启。

## 1. 总体结构

```
port/src/main/llm/
  provider-config.ts    zod schema、内置 preset（MINIMAX_PRESET）、providers 文件加载/合并
  provider-registry.ts  ProviderRegistry：按名查找、从“未清洗的”env 解析 key、安全摘要
  protocols.ts          三种协议的 URL/鉴权头/请求体转换/文本提取；Claude Agent SDK 子进程 env
  retry.ts              每 provider 一个进程级并发闸门；按配置的重试/退避策略
  errors.ts             LlmProviderError（typed code）
  logger.ts             JSON 行结构化日志 + 密钥脱敏
  llm-route.ts          原版路由管线（差分测试）+ “任意已注册 provider” 分支；anthropicMessages（helper 请求）
  content-convert.ts    Anthropic content → OpenAI chat / responses（图片、文档、工具调用）
  route-service.ts      LlmRouteService：AgentHost 的路由决策 + createLocalRuntime 子进程 env（主进程用）
  minimax.ts            docs/14 兼容薄封装（minimaxConfig / withMiniMaxRetry …）
port/src/main/settings/settings-store.ts   原版 Settings 类移植（+ provider 路由）
port/src/main/llm-runtime.ts               主进程装配：Settings + LlmRouteService + 热重载 + IPC handlers
port/src/main/models-dev/sqlite.ts         node:sqlite 能力检测 / 懒加载
port/src/main/models-dev/
  catalog.ts  db.ts  sync.ts  lookup.ts
port/src/cli/models-cli.ts   models-* / llm-model-info 子命令
port/src/shared/llm-types.ts LlmRouteId 等共享类型
port/config/llm-providers.example.json
```

路由：`settings.llmRoute` 取值 = `"claude-code"` | `"gateway"` | **任意已注册 provider 名**（类型 `LlmRouteId`，`PublicSettings.llmRoute` 已由 `unknown` 改为该联合类型）。未注册的值与原版一致：`resolvedLlmRoute` 回落到 `claude-code`，settings 归一化时删除。

## 2. 配置格式

providers 文件路径：环境变量 **`VIDEOCLAW_LLM_PROVIDERS_FILE`**（设置了就必须存在且合法）。不设置时只有内置 preset。
文件非法时：严格加载 `loadProviderRegistry()` 抛 `CONFIG_INVALID`；进程级 `getProviderRegistry()` **降级**为只用内置 preset，并打一条 `llm.providers.config_invalid` 错误日志（不含文件内容），`llm-providers` 命令会显示 `configError`。配置可热重载，见 §2.2。

```jsonc
{
  "version": 1,
  "providers": [
    { "name": "minimax", "concurrency": { "max": 1 }, "agentEffort": "medium" },   // 与 preset 同名 → 覆盖合并
    {
      "name": "my-anthropic-proxy",                 // 小写字母/数字/._-，不得为 claude-code / gateway
      "displayName": "Internal Anthropic-compatible proxy",
      "protocol": "anthropic-messages",             // | "openai-chat-completions" | "openai-responses"
      "baseUrl": "https://llm-proxy.example.com/anthropic",
      "auth": { "scheme": "x-api-key" },            // | {"scheme":"bearer"} | {"scheme":"header","header":"api-key","prefix":""}
      "apiKeyEnv": "MY_PROXY_API_KEY",              // 只写 env 名；写 apiKey/token/secret 字段会被拒绝
      "model": "claude-sonnet-4-5",
      "aliases": { "haiku": "claude-haiku-4-5", "smallFast": "claude-haiku-4-5" },  // opus/sonnet/haiku/smallFast/subagent，缺省 = model
      "defaultParams": { "thinking": { "type": "enabled", "budget_tokens": 1024 } }, // 合并在请求体之下（请求字段优先）
      "headers": { "X-Team": "videoclaw" },         // 额外非敏感头；Authorization/x-api-key/api-key/cookie 被拒绝
      "concurrency": { "max": 4 },                  // 进程级闸门；cap 为硬上限（env 覆盖也受限）
      "retry": { "maxRetries": 3, "baseDelayMs": 1000, "retryStatuses": [429, 503, 529] },
      "modelsDev": { "provider": "anthropic" }      // models.dev 查表键，缺省 provider=name, model=model
    },
    { "name": "deepseek", "protocol": "openai-chat-completions", "baseUrl": "https://api.deepseek.com/v1",
      "auth": { "scheme": "bearer" }, "apiKeyEnv": "DEEPSEEK_API_KEY", "model": "deepseek-v4-flash", "concurrency": { "max": 2 } },
    { "name": "azure-openai", "protocol": "openai-responses", "baseUrl": "https://my-resource.openai.azure.com/openai/v1",
      "auth": { "scheme": "header", "header": "api-key" }, "apiKeyEnv": "AZURE_OPENAI_API_KEY", "model": "gpt-5.5",
      "defaultParams": { "reasoning": { "effort": "low" } }, "timeoutMs": 120000, "modelsDev": { "provider": "azure" } }
  ]
}
```

（完整可校验示例见 `port/config/llm-providers.example.json`，测试会加载它；示例中的第三方 URL/模型名仅为示意，未实测。）

全部字段与默认值：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `protocol` | 必填 | 端点：anthropic → `{baseUrl}/v1/messages`（自动加 `anthropic-version: 2023-06-01`）；chat → `{baseUrl}/chat/completions`；responses → `{baseUrl}/responses` |
| `auth` | `{scheme:"bearer"}` | `x-api-key` → `x-api-key: K`；`bearer` → `Authorization: Bearer K`；`header` → `<header>: <prefix>K` |
| `concurrency` | `{max:1, cap:64}` | 进程级信号量**按 `apiKeyEnv` 共享**（账号级）：共用同一 key 的多个 provider（如 `minimax` + `minimax-openai`）共用一个闸门，大小取它们中最小的 `max`；热重载后在线调整；退避 sleep 期间占着槽位 |
| `retry` | `maxRetries 5, baseDelayMs 2000, maxDelayMs 60000, retryStatuses [429,529], credentialStatuses [401,403]` | 退避 `base·2^i·(1+0.25·jitter)`，封顶 maxDelayMs；有 `retry-after`（秒或日期）则优先（同样封顶）。`bodyCodePath`（如 `base_resp.status_code`）+ `retryBodyCodes` / `credentialBodyCodes` 用于按响应体错误码分类 |
| `timeoutMs` | 60000 | 每次尝试（含读完 body） |
| `envOverrides` | `{}` | 允许用 env 覆盖 `baseUrl` / `model` / `maxConcurrency`（MiniMax 用它保持 `MINIMAX_BASE_URL` 等兼容） |
| `agentEffort` | 无 | 子进程 `CLAUDE_CODE_EFFORT_LEVEL`（low/medium/high/xhigh/max） |
| `chatMaxTokensField` | `max_tokens` | 仅 openai-chat：输出上限字段名；OpenAI 新模型（o 系列 / gpt-5.x）与 MiniMax 兼容端点用 `max_completion_tokens` |
| `allowInsecureHttp` | `false` | 允许对非回环地址用明文 http（默认只允许 localhost/127.x/::1） |

`agentCompat`（第三轮新增，docs/16 §4.2）：Claude Code 子进程兼容开关，`gateProxy` / `disableNonessentialTraffic` / `disableStructuredOutputs` / `emulateStructuredOutputs`（第四轮，需 `gateProxy`，docs/17 §3.2）/ `disablePromptCaching` / `disableExperimentalBetas` / `disableThinking` / `disableAdaptiveThinking`，全部默认 false，未知字段报 `CONFIG_INVALID`。

`structuredOutput`（第四轮，docs/17 §3.1）：`"native"`（默认，协议自身字段：chat `response_format` 透传 / responses `text.format` / anthropic `output_config.format`）| `"tool"`（强制调用唯一工具 `structured_output`，参数即答案）| `"off"`。helper body 可用三种写法之一请求结构化输出：`output_config.format`、`output_format`、`response_format`。

`baseUrl` 额外规则（§3.5）：不得含用户名/密码、query、fragment；非回环 http 需 `allowInsecureHttp`。`headers` 值与 `auth.prefix` 不得含换行；`model` 不得含控制字符。

### 2.1 内置 preset：`minimax`

`protocol: anthropic-messages`，`baseUrl: https://api.minimaxi.com/anthropic`，`auth: bearer`，`apiKeyEnv: MINIMAX_API_KEY`，`model: MiniMax-M3.1-Flash`，`concurrency {max:1, cap:2}`（key 与 Pageway 共享），重试 429/529 + `base_resp.status_code=1002`，**不重试** 401/403 + 1004（鉴权）/1008（余额）→ `PROVIDER_CREDENTIAL_MISCONFIGURED`；`modelsDev.provider = "minimax-cn"`（minimaxi.com 为国内站）；env 覆盖 `MINIMAX_BASE_URL` / `MINIMAX_MODEL` / `MINIMAX_MAX_CONCURRENCY`；**第三轮**：`agentCompat {gateProxy, disableNonessentialTraffic} = true`（真实 Claude Code 2.1.305 实测所需，原因见 docs/16 §4）；**第四轮**：`disableStructuredOutputs` 改为不开、`emulateStructuredOutputs = true`，并新增 `structuredOutput: "tool"`（docs/17）。
与 docs/14 唯一差异：helper 调用的鉴权头由 `x-api-key` 改为 `Bearer`（与子进程的 `ANTHROPIC_AUTH_TOKEN` 统一；两者在 docs/14 §0 均验证 200，本次用 Bearer 再次实测通过）。如需旧行为，在 providers 文件里写 `{"name":"minimax","auth":{"scheme":"x-api-key"}}`（注意这同时会让子进程改用 `ANTHROPIC_API_KEY`）。

### 2.2 热重载

- **触发方式**：① 主进程启动时若设置了 `VIDEOCLAW_LLM_PROVIDERS_FILE`，用 `fs.watchFile`（stat 轮询，1 s，`persistent:false` 不阻止退出，200 ms 去抖）监视该文件——Windows/macOS/Linux 行为一致，能识别编辑器的“写临时文件 + rename”原子保存、文件后建/被删；② POSIX 上 `kill -HUP <主进程 pid>` 立即重载（win32 不安装）；③ 代码调用 `reloadProviderRegistry()`。
- **语义**：重载走与启动**完全相同**的严格加载。成功 → 原子替换注册表，`generation++`，日志 `llm.providers.reloaded`（含 added/removed/updated 名称）。失败（JSON 坏、schema 不过、出现密钥字段、env 指向的文件不存在）→ **退回只有内置 preset**（`configError` 有值），日志 `llm.providers.config_invalid`（不含文件内容）；修好文件后下一次重载自动恢复。内容未变 → no-op。
- **对正在使用的路由的影响**：设置里选中的 provider 被移除（或配置失效）时，全局路由按原版语义退回 `claude-code`，并触发与 `settings:set` 改路由相同的 route-changed 钩子；用户的选择在 `settings.json` 中**保留**（`other.llmRoute`，不经 `get()` 暴露），provider 重新出现后自动恢复。**已固定（pinned）在某 provider 上的视频不会被改投到别的付费方**——它们 fail-closed（`UNKNOWN_PROVIDER` / readiness `provider-unavailable`）。
- **并发闸门**：`concurrency.max` 变化后，下一次调用按新值在线扩/缩（扩容立即放行排队者；缩容让在途请求跑完）。
- **部署前校验**：`port-cli llm-providers-validate <file>`（严格；非法 exit 1），建议先校验再替换被监视的文件。

## 3. 运行时行为

### 3.1 Claude Agent SDK 子进程 env（`claudeRouteEnv`）

原版 `sanitizedAgentEnv` 会剥掉所有名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH 的变量，所以 provider key 从 **未清洗** 的 env 读取，再显式注入：

| auth | 注入 |
| --- | --- |
| bearer | `ANTHROPIC_AUTH_TOKEN=K` |
| x-api-key | `ANTHROPIC_API_KEY=K` |
| header | `ANTHROPIC_CUSTOM_HEADERS="<header>: <prefix>K"`（与 provider `headers` 一起，换行分隔） |

（第三轮：`agentCompat.gateProxy` 开启时，上表的 key 不再进入子进程——`sessionAgentRuntime()` 把 `ANTHROPIC_BASE_URL` 换成回环 gate proxy、`ANTHROPIC_AUTH_TOKEN` 换成每会话随机 token，见 docs/16 §4.1。）

外加 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 与五个别名变量（`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）、可选 `CLAUDE_CODE_EFFORT_LEVEL`、隔离的 `CLAUDE_CONFIG_DIR`。**gateway 的 job 头（customHeaders）永不转发给第三方。** 只有 `anthropic-messages` provider 能驱动 Claude Agent SDK；`openai-*` provider 被选为 agent 路由时抛 `UNSUPPORTED_PROTOCOL`（仍可用于 helper 调用）。key 缺失 → `KEY_MISSING`（消息只含 env 名）。

### 3.2 主进程 helper 调用（`resolveHelperCreds` + `anthropicMessages`）

调用方仍构造 Anthropic 形状的 body（`{model, max_tokens, system?, messages}`）。provider 路由下：`model` 被替换为 provider 模型；`defaultParams` 合并在下；openai-chat 转成 `messages`（system 放首条）+ `max_tokens`（或 `max_completion_tokens`）；openai-responses 转成 `input` + `instructions` + `max_output_tokens`；**图片/文档/工具调用按 §3.3 完整转换**。响应只取文本（thinking / reasoning 块忽略）。返回 `{ok:true,text}` 或 `{ok:false,status?,reason,code?}`，`code ∈ PROVIDER_CREDENTIAL_MISCONFIGURED | RATE_LIMITED | TIMEOUT | NETWORK | BAD_RESPONSE | UNSUPPORTED_CONTENT`。可选 `deadlineMs`（整体预算，含重试退避）与 `signal`（调用方取消）。gateway 路径与原版逐字一致。

### 3.3 多模态转换（`content-convert.ts`）

| Anthropic 块 | openai-chat-completions | openai-responses |
| --- | --- | --- |
| `text` | `{type:"text"}`（纯文本消息仍是字符串） | `{type:"input_text"}`（纯文本仍是字符串） |
| `image` base64 | `{type:"image_url",image_url:{url:"data:<mt>;base64,…"}}` | `{type:"input_image",image_url:"data:…",detail:"auto"}` |
| `image` url | `image_url.url = url` | `input_image.image_url = url` |
| `document` base64（PDF）| `{type:"file",file:{filename,file_data:"data:…"}}` | `{type:"input_file",filename,file_data}` |
| `document` url | **UNSUPPORTED_CONTENT**（chat 无 URL 文件）| `{type:"input_file",file_url}` |
| `document` text / content | 文本（content 内的图片同上转换） | 同左 |
| `tool_use`（assistant）| `tool_calls[]`（`arguments` = JSON 字符串） | `{type:"function_call",call_id,name,arguments}` |
| `tool_result`（user）| `{role:"tool",tool_call_id,content}`；结果里的图片随后作为 user 消息发送 | `{type:"function_call_output",call_id,output}`；图片同左 |
| `thinking` / `redacted_thinking` | 丢弃（provider 内部，不可移植） | 同左 |
| Files API `file` 源、server tool 块、未知类型、assistant 中的图片、system 中的非文本 | **UNSUPPORTED_CONTENT** | 同左 |

`tools`（只接受带 `input_schema` 的自定义工具）与 `tool_choice`（auto/any→required/none/tool，`disable_parallel_tool_use`→`parallel_tool_calls:false`）同样转换；`stop_sequences` → chat `stop`（最多 4 个），responses 无对应参数则丢弃。Anthropic 专有字段（`top_k`、`thinking`、`metadata`、`service_tier`、`container`、`mcp_servers`、`context_management`、`stream`…）被移除并记 debug 日志。**无法表示的内容一律返回 typed 错误，不再静默丢弃**。`anthropic-messages` provider 原样透传。Anthropic 本身没有音频/视频输入块，所以目前没有可转换的音频/视频来源。

### 3.4 主进程接线（`llm-runtime.ts` / `route-service.ts` / `settings-store.ts`）

已接入 Electron 主进程（`real-backend.ts`，默认开启；`VIDEOCLAW_PORT_FAKE_SETTINGS=1` 可退回 QA fixture；启动失败时也自动退回 fake 并记日志）：

| IPC（既有契约，未新增 channel） | 实现 |
| --- | --- |
| `settings:get` | 原版 `Settings`（L5291）移植，`userData/settings.json`，原子写、0600 |
| `settings:set` | 原版 L61680：`rendererWritableSettingsPatch` → `patch` → 有效路由变化时触发 route-changed 钩子（第六轮起调用最小 AgentHost 的 `onLlmRouteChanged()` 拆 runtime，docs/19 §2）。PORT-NEW：未注册的 provider 名从 patch 中剔除 |
| `engine:llmRouteReadiness` | 原版 L51052 + provider 分支：`provider-unavailable` / `provider-key-missing`（附 env 名）/ `provider-protocol-unsupported`；gateway → ready；claude-code → `undefined`（登录探测未移植） |

`LlmRouteService` 移植了 AgentHost 中决定“谁付费”的部分：`newSessionLlmRoute`（L38769，新视频固定当前路由）、`sessionLlmRoute`（L40823，PORT-NEW：固定的 provider 名即使暂时未注册也保持 → fail-closed）、`sessionHelperKind`/`sessionHelperCreds`（provider 视频的 helper 请求走该 provider）、`sessionModel`（L40865，provider 默认用其 model）、`sessionHelperComplete`、`localRuntimeEnv`/`sessionRuntimeConfig`（`createLocalRuntime` L23214-23330 的完整 `options.env`：`sanitizedAgentEnv` 之后显式注入 base URL + token/header + 5 个别名 + 隔离 `CLAUDE_CONFIG_DIR=userData/engine-profile` + 原版的 connectors-off / no-self-starting-work 等）。

**第三轮已补上的部分**：`sessionAgentRuntime()`（= `sessionRuntimeConfig()` + 可选 gate proxy）+ `agent-sdk.ts`（运行时加载 SDK、原版打包布局的 `claude` 路径、最小 `query()` 选项、单轮 `runAgentTurn`），经 `llm-agent-smoke` 对 MiniMax 真实跑通，见 docs/16。

**仍延后（及原因）**：原版 `query()` 的完整选项与 AgentHost 会话/权限/hooks/MCP 体系（未移植）；~~AgentHost 的会话生命周期与 `onLlmRouteChanged` 的 runtime teardown~~（第六轮最小版本，docs/19；持久化/权限/MCP 仍延后）；CredentialStore（gateway key 库）；Claude Code 登录探测；~~设置 UI 的 provider 选择器~~（第五轮：port renderer 的 Settings 页已有，docs/18 §5；原版完整设置页仍未移植）。这些接入时把 `sessionAgentRuntime()` 的 `env`/`model` 原样传给 `query()`，子进程退出后调用 `close()`。

### 3.5 生产加固

- 配置：baseUrl 规则（§2）、header/prefix 禁止换行（防 header 注入 / `ANTHROPIC_CUSTOM_HEADERS` 注入）、model 禁止控制字符；env 覆盖（如 `MINIMAX_BASE_URL`）不合法时**忽略并告警**（只记 env 名，不记值）；key 含空白/非 ASCII/控制字符或 >4 KB → 视为未配置（`KEY_MISSING`）并告警。
- 并发：闸门从“按 provider 名”改为“按 `apiKeyEnv`”（账号级，取最小 `max`），避免为同一 key 再配一个端点就把共享 key（MiniMax 与 Pageway 共用）的并发翻倍。
- 请求：响应体流式读取并封顶 16 MB；provider 返回非 JSON → `BAD_RESPONSE`（不回显响应体，原先会把 JSON.parse 的报错——含响应片段——透出）；`deadlineMs` / `AbortSignal`；NETWORK 错误带底层原因码（如 `ECONNREFUSED`）；请求体转换失败在发请求前返回 `UNSUPPORTED_CONTENT`。
- 日志/结果脱敏：除已注册 key 与字段名规则外，新增模式脱敏：`Bearer …`、`x-api-key:/api-key:/authorization: …`、`sk-…`/`sk-ant-…`/`sk-proj-…`/`sk-or-…`、URL 中的密码、`?key=/api_key=/token=/sig=`；数字类型的敏感字段也会脱敏；所有返回给调用方的 `reason` 与 `LlmProviderError.toJSON()` 都经过脱敏；日志 sink 异常（如 EPIPE）被吞掉，不影响请求。测试覆盖：成功/401/429 耗尽/500/超时全流程的日志与结果中 key 与 `Bearer <token>` 出现 0 次。
- models.dev：自定义 `--url` 中的凭据不会出现在结果、日志或 `sync_meta`；只接受 http(s)；无 content-length 的分块响应也按 64 MB 流式封顶；DB 不可用时返回 `DB_ERROR` 而不是抛出。

### 3.6 日志与密钥

`logger.ts` 输出 JSON 行到 stderr（`VIDEOCLAW_LOG_LEVEL=debug|info|warn|error|silent`）。两层脱敏：字段名以 key/token/secret/password/authorization/cookie/credential 结尾的字符串值 → `[REDACTED]`；所有从 env 读到的 key 在解析时注册，任何字符串里出现都会被替换；`Bearer xxx` 模式也会被抹掉。错误消息只含 provider 名、env 名、HTTP 状态和错误码，从不回显响应体。`describeProvider()` / `summaries()` 只给出 `configured: true/false`。

## 4. models.dev 同步

### 4.1 数据源（2026-10-21 实测）

- URL：**`https://models.dev/api.json`**（README 还列出 `?type=all`、`models.json`、`catalog.json`、`model-schema.json`，本次未接入）。
- 响应：`application/json`，约 5.9 MB；`etag` 头（Node fetch 拿到的是弱 etag `W/"…"`，因为 gzip）；`cache-control: public, max-age=0, must-revalidate`；**无 `Last-Modified`**；带 `If-None-Match` 返回 **304**。
- 形状：`{ [providerId]: { id, name, env: string[], npm, api?, doc, models: { [modelId]: Model } } }`。Model 主要字段：`id, name, family, type?, status?(deprecated/beta/alpha), attachment, reasoning, reasoning_options?, tool_call, structured_output, temperature, interleaved?, open_weights, knowledge?, release_date, last_updated, modalities{input[],output[]}, limit{context, input?, output}, cost{input, output, cache_read?, cache_write?, reasoning?, input_audio?, output_audio?, tiers?[], context_over_200k?{}}, canonical_model_id?, provider?{npm,api,shape}`。价格单位：**美元 / 百万 token**（models.dev README）。实测全部 9079 个模型的 map key 都等于 `id`；有的 model id 本身含 `/`（如 `cloudflare-ai-gateway` 的 `openai/gpt-5.5-pro`）。

### 4.2 数据库选择：`node:sqlite`

选 Node 内置的 `node:sqlite`（`DatabaseSync`），不选 better-sqlite3：Node 24 与 Electron 42（内置 Node 24.19）都自带，box 上两者都实测可用；**无原生 addon**，不需要 electron-rebuild，也不需要为 win32/darwin/linux × Electron ABI 准备预编译包；esbuild 自动把 `node:*` 外部化。代价：API 仍标为 release candidate 级别，功能比 better-sqlite3 少（够用）。

**版本要求与能力检测**（`models-dev/sqlite.ts`）：

| 运行时 | 要求 |
| --- | --- |
| Node | **≥ 22.13.0**（22.x LTS）或 ≥ 23.4.0（无需 flag）；22.5–22.12 需 `--experimental-sqlite`，不支持 |
| Electron | **≥ 35.0.2**（内置 Node 22.14）；已知回归：37.2.0–37.2.2 及 36.7.3 之前的部分 36.x 出现 “No such binding: sqlite”（electron#47671，#47706 修复）。本 port 固定 Electron 42.11.9 |

`node:sqlite` 改为**懒加载**（`process.getBuiltinModule` → `require` 回退），不再在模块顶层静态 import：不满足版本的运行时只会在用到目录时得到 `SqliteUnavailableError`（`code: "SQLITE_UNAVAILABLE"`，消息含运行时版本/平台与最低版本，并说明 LLM 路由本身不受影响），而不是整个 bundle 加载失败。`port-cli sqlite-check` 输出能力探测结果（实际加载模块并打开内存库，以此为准，版本表仅供参考）。Windows/macOS：`node:sqlite` 是 Node 静态编译进来的，不需要原生依赖；但这两个平台尚未实测。首次使用时 Node 会打印 ExperimentalWarning（无害）。

DB 路径：`--db` > `VIDEOCLAW_MODELS_DB` > `~/.videoclaw-port/models-dev.sqlite`。WAL 模式、外键开启、`busy_timeout 5000`。`*.sqlite*` 已加入 `.gitignore`（DB 内不含任何 key）。

### 4.3 Schema（`PRAGMA user_version` 迁移，当前 v1；只追加不修改）

```sql
providers (id PK, name, api, npm, doc, env_json, raw_json, synced_at)
models    (provider_id → providers.id ON DELETE CASCADE, model_id, name, family, type, status, canonical_id,
           context_limit, input_limit, output_limit,
           cost_input, cost_output, cost_cache_read, cost_cache_write, cost_json,
           input_modalities, output_modalities,            -- JSON 数组
           reasoning, tool_call, attachment, structured_output, temperature, open_weights,  -- 0/1/NULL
           knowledge, release_date, last_updated, raw_json, synced_at,
           PRIMARY KEY (provider_id, model_id))
           INDEX models_by_model_id (model_id COLLATE NOCASE), INDEX models_by_canonical (canonical_id)
sync_meta (source PK = 'models.dev', url, etag, last_modified, content_sha256, last_synced_at,
           last_attempt_at, last_status, last_error, provider_count, model_count)
```

`raw_json` 保留上游原始对象，未建列的字段（tiers、reasoning_options、provider override…）不丢失。

### 4.4 同步语义（`syncModelsDev`）

1. 仅当上次来源 URL 相同且库非空时发送 `If-None-Match` / `If-Modified-Since`；304 → `not-modified`。
2. 200 时算 sha256，与上次相同 → `unchanged`（不重写）。
3. 解析宽松：单个坏模型/坏 provider 跳过并计数，不致命。
4. 合理性守卫（拒绝即保留旧数据）：无 provider/模型；超过一半模型校验失败；模型数比上次少一半以上（`--force` 可放行）。
5. 写入：单事务 upsert + 删除快照中已不存在的行 → 幂等。
6. 任何失败（`NETWORK | TIMEOUT | HTTP_ERROR | TOO_LARGE(>64MB) | CATALOG_INVALID | SANITY_CHECK_FAILED | DB_ERROR`）不触碰目录数据，只更新 `sync_meta.last_status/last_error`，返回 `{ok:false,status:"failed",error}`，CLI 退出码 1。

### 4.5 与 provider 框架的连接

`providerModelMetadata(db, providerConfigOrResolved)` 用 `modelsDev.provider`（缺省 provider 名）+ `modelsDev.model`（缺省配置/ env 覆盖后的 model）查表，顺序：精确 (provider, model) → `canonical_model_id = provider/model` → 跨 provider 按 model id（不区分大小写）。返回 `{contextWindow, maxInputTokens, maxOutputTokens, pricing{currency:"USD", per:"1M tokens", input, output, cacheRead, cacheWrite, raw(tiers…)}, modalities, capabilities, status, …}`；没同步过或查不到返回 `undefined`（元数据是可选的，调用方需降级）。

## 5. CLI（`node port/dist/cli/port-cli.cjs …`，每条输出一行 JSON）

| 命令 | 说明 |
| --- | --- |
| `llm-providers` | 已注册 provider 摘要（key 只显示 configured），以及 configError |
| `llm-providers-validate [file]` | 严格校验 providers 文件（热重载前用）；非法 exit 1 |
| `llm-ping <provider> [prompt] [image.png]` | **需 `VIDEOCLAW_LLM_LIVE=1`**；经 `LlmRouteService.sessionHelperComplete`（主进程同一路径）发 1 次真实请求，可带一张图片 |
| `llm-agent-smoke <provider> [prompt] [--tool\|--key-probe]` | **需 `VIDEOCLAW_LLM_LIVE=1`**；真实 Claude Agent SDK 单轮会话（docs/16 §2）；SDK 自动发现（docs/17 §4） |
| `llm-structured <provider> [--mode native\|tool\|off]` | **需 `VIDEOCLAW_LLM_LIVE=1`**；1 次真实结构化输出请求，`verdict: SCHEMA_VALID / JSON_NOT_SCHEMA / NOT_JSON`（docs/17） |
| `agent-sdk-check` | 离线：SDK 发现来源、版本、是否等于 pin、原生 `claude` 路径（docs/17 §4） |
| `sqlite-check` | node:sqlite 能力探测（运行时、SQLite 版本、最低版本） |
| `llm-model-info <provider> [--db P]` | provider → models.dev 元数据；第四轮起附 `structuredOutput {configured, suggested, matches}` |
| `models-sync [--db P] [--url U] [--force] [--timeout MS]` | 同步 |
| `models-list [--db P] [--provider ID] [--search Q] [--limit N] [--offset N]` | 列表（默认 50 条） |
| `models-show <provider/model \| model> [--provider ID] [--raw]` | 单个模型元数据（`--raw` 附上游原始对象） |
| `minimax-config` / `minimax-ping` | docs/14 兼容别名（`minimax-ping` 也接受 `VIDEOCLAW_MINIMAX_LIVE=1`） |

## 6. 环境变量

| 变量 | 作用 |
| --- | --- |
| `VIDEOCLAW_LLM_PROVIDERS_FILE` | providers JSON 文件路径 |
| `<apiKeyEnv>`（如 `MINIMAX_API_KEY`） | 各 provider 的 key（只从 env 读，永不落盘） |
| `MINIMAX_BASE_URL` / `MINIMAX_MODEL` / `MINIMAX_MAX_CONCURRENCY` | minimax preset 的 env 覆盖（并发封顶 2） |
| `VIDEOCLAW_MODELS_DB` | models.dev SQLite 路径 |
| `VIDEOCLAW_LOG_LEVEL` | 日志级别，默认 info |
| `VIDEOCLAW_LLM_LIVE=1` | 允许 `llm-ping` / `llm-structured` / `llm-agent-smoke` 发真实请求 |
| `VIDEOCLAW_CLAUDE_AGENT_SDK` | （可选，最高优先级）装有 `@anthropic-ai/claude-agent-sdk` 的目录（包目录 / node_modules / 其上级）；不设时自动发现（docs/17 §4） |
| `VIDEOCLAW_CLAUDE_CODE_EXECUTABLE` | 覆盖 `claude` 原生二进制路径（默认取 SDK 旁的 `claude-agent-sdk-<plat>-<arch>/claude`） |
| `VIDEOCLAW_PORT_FAKE_SETTINGS=1` | 主进程不启用真实 Settings/路由服务，退回 QA fixture |
| `VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=<route>` | Electron 冒烟中额外执行 `settings:set({llmRoute})` + readiness |

## 7. 错误码

`LlmProviderError.code`：`CONFIG_INVALID | UNKNOWN_PROVIDER | KEY_MISSING | UNSUPPORTED_PROTOCOL | UNSUPPORTED_CONTENT | PROVIDER_CREDENTIAL_MISCONFIGURED | RATE_LIMITED | TIMEOUT | NETWORK | BAD_RESPONSE | SDK_UNAVAILABLE`（第三轮：SDK 未配置/找不到）；helper 层另有 `NO_CREDENTIALS`（该视频的路由没有可用凭据）；同步错误码见 §4.4；`SqliteUnavailableError.code = SQLITE_UNAVAILABLE`。

## 8. 测试

测试框架是仓库已有的 **`node:test`**（`npm test` = esbuild 打包 `test/*.test.ts` → `node --test`），不是 vitest；为避免引入第二套运行器，沿用之。新增：

- `test/llm-providers.test.ts`（15）：配置默认值/严格校验/拒绝密钥字段与鉴权头/preset 合并、providers 文件与降级、3 协议 × 4 种鉴权组合的 URL 与头、env 覆盖、路由归一化、子进程 env（key 穿过 sanitizedAgentEnv、三种鉴权注入方式、UNSUPPORTED_PROTOCOL、KEY_MISSING）、协议转换、mock 端到端（chat+自定义头+配置化 503 重试；responses+bearer+响应体凭据码不重试；500 透传）、并发闸门=2、NETWORK/TIMEOUT、retry-after 封顶、日志脱敏、示例配置可加载、PublicSettings 类型。
- `test/models-dev.test.ts`（10）：fixture（`test/fixtures/models-dev-api.sample.json`，2026-10-21 真实 api.json 裁剪：5 个 provider / 10 个模型，含 tiers、`provider` 覆盖、embedding、deprecated、含 `/` 的 model id）、宽松解析、迁移、幂等 upsert + 剪枝、查找顺序、provider 元数据、304/unchanged/force、离线安全各失败分支、validator 只发给同源 URL、CLI 四个命令。测试不访问网络。
- `test/minimax.test.ts`（已有 10 个，改为断言 preset 行为；Bearer）。
- 第二轮新增：`test/llm-multimodal.test.ts`（6：两种协议的图片/PDF/文档/工具/tool_choice/stop 转换、不可表示内容的 typed 错误、mock 端到端图片上线）、`test/llm-hot-reload.test.ts`（4：显式重载增删改、非法配置回退与恢复、watcher 原地写与原子 rename、闸门扩缩容）、`test/llm-main-wiring.test.ts`（8：Settings / rendererWritableSettingsPatch / AgentHost 方法 / createLocalRuntime env 差分、provider 路由暂停与恢复、真实子进程 env 注入、helper 与 readiness、IPC handlers + 热重载联动）、`test/sqlite-capability.test.ts`（2）、`test/llm-hardening.test.ts`（8：配置规则、env 覆盖/key 校验、脱敏模式、非 JSON/超大响应、deadline/取消/网络原因、全流程无 key、models 同步 URL 脱敏与流式封顶、同 key 多 provider 共用账号级闸门）。
- 第三轮新增：`test/llm-agent-sdk.test.ts`（11：`minimalAgentOptions` 原样传 env/model、mock SDK 边界上的消息收集/canUseTool 白名单/脱敏、失败/抛错/超时、从目录加载 ESM SDK 与包名校验、原版打包布局的 `claude` 路径（含 musl / win32）、`agentCompat` → env 与 preset 合并、gate proxy 的 token 校验/鉴权替换/流式透传/本地探测、三种鉴权与 502、闸门串行化与 helper 共享闸门与中断释放、`proxiedAgentEnv`、`sessionAgentRuntime` 经 mock SDK + mock 上游端到端）。
