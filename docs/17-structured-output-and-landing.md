# 17 · MiniMax 结构化输出（格式化输出）+ 第四轮落地（SDK 自动发现、路由选择 IPC）

> 2026-10-21 第四轮。box 上真实 `MINIMAX_API_KEY`，**全程串行（并发 1）、单请求、key 从未打印/写盘**（脚本输出都做了 key 替换）。
> 代码只在 `port/`；`app/out`、`app/reconstructed` 未改。

## 0. 已验证 / 未验证（本轮）

**已验证（真实请求）**
- MiniMax-M3.1-Flash 的 **原生结构化输出字段全部被静默忽略**：OpenAI 兼容 `response_format`（`json_schema` 与 `json_object`）、Responses `text.format`、Anthropic 兼容 `output_config.format`、原生 `/v1/text/chatcompletion_v2` 的 `response_format` —— 均 **HTTP 200 + Markdown 自由文本**（5/5 NOT_JSON，另经 `llm-structured --mode native` 再测 2/2 NOT_JSON）。
- **强制工具调用**能稳定拿到符合 schema 的 JSON：Anthropic 端点 `tool_choice {type:"tool"}` / `{type:"any"}`、OpenAI 端点 `tool_choice {type:"function",function:{name}}` / `"required"`，含嵌套 object/array/enum 的 schema —— **12/12 schema-valid**（10 次裸探测 + 2 次经 port 框架 `llm-structured`）。
- 经 port 框架（`LlmRouteService` → `anthropicMessages`）：`minimax`（Anthropic 协议）与 `minimax-openai`（OpenAI chat）在 `structuredOutput:"tool"` 下均返回 `SCHEMA_VALID`；`--mode native` 下均 `NOT_JSON`（对照组）。
- 真实 Claude Code 2.1.305 子进程 + gate proxy 结构化输出模拟：标题侧请求（`output_config.format`）被改写为强制工具调用，proxy 回给 Claude Code 的是 `{"title": "Surfing cats"}` 文本，**Claude Code 把它持久化为 `ai-title: "Surfing cats"`**（会话 JSONL 中可见）；`structuredEmulated:1, structuredJsonOk:1, maxInflight:1`。
- SDK 的 `outputFormat`（agent 结果结构化）**不需要任何处理**：Claude Code 用内部 `StructuredOutput` 工具实现（请求里没有 `output_config.format`），对 MiniMax 实测 `result.structured_output = {"answer":"Paris","confidence":1}`。
- `npm run agent-sdk:install` 把 SDK 0.3.305 + Linux 原生 `claude` 装进 `port/vendor/`（gitignored）；**不设 `VIDEOCLAW_CLAUDE_AGENT_SDK`** 时 `agent-sdk-check` 自动发现（`source:"vendor"`），`llm-agent-smoke minimax --tool` 真实跑通（Bash 往返，`maxInflight:1`）。
- Electron 42 真窗口（xvfb）：`window.videoclawPort.llmRoutes()` 经 IPC 返回路由列表；stub renderer 的 `<select>` 正确列出 5 个路由、缺 key 的置灰；`settings:set({llmRoute})` 后 `current` 更新；userData 中假 key 出现 0 次。
- models.dev 实时数据：`minimax-cn/MiniMax-M3.1-Flash` `structured_output:false, tool_call:true`，与实测一致；`llm-model-info minimax` 给出 `suggested:"tool", matches:true`。

**未验证**：见 §8。

## 1. 结论（回答“我记得 minimax 支持格式化的”）

- **部分正确**：MiniMax 官方文档里确实有 `response_format: {type:"json_schema", json_schema:{name, schema}}`，但它写明 **“当前仅 `MiniMax-Text-01` 支持此参数”**，而且只在 **原生** `/v1/text/chatcompletion_v2` 接口上；OpenAI 兼容 `/v1/chat/completions` 与 Anthropic 兼容 `/anthropic/v1/messages` 的参数表里 **没有** 结构化输出字段（Anthropic 侧只支持 `output_config.effort`）；Responses 接口 `text.format.type` 的 enum 只有 `"text"`。
- 我们用的 **MiniMax-M3.1-Flash 在任何一个端点上都不会按 `response_format`/`output_config.format` 约束输出**（实测：200 且直接忽略，不报错）。Text-01 在原生接口上返回了 JSON，但 **没有遵守 schema**（多包了一层 `{"storyboard":{…}}`、shots 重复），而且是旧模型，不适合作为路径。
- **真正可用的“格式化输出”机制是工具调用**：把 schema 作为唯一工具的参数 schema，并 `tool_choice` 强制调用；模型返回的 tool arguments 就是符合 schema 的 JSON（12/12）。这在 MiniMax 两个兼容端点上都成立，也和 models.dev 的能力位（`structured_output:false, tool_call:true`）一致。
- 因此：**重新启用**结构化输出，但不是“透传原生字段”，而是 **按 provider 配置选择机制**：helper 调用用 `structuredOutput:"tool"`；Claude Code 子进程由 gate proxy 做同样的改写（`agentCompat.emulateStructuredOutputs`），**不再** 设置 `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS`。

## 2. 调研与实测细节

### 2.1 官方文档（2026-10-21 抓取）
| 来源 | 结构化输出相关内容 |
| --- | --- |
| `platform.minimaxi.com/docs/api-reference/text-post`（原生 chatcompletion_v2） | `response_format`：“指定模型输出的格式，**当前仅 `MiniMax-Text-01` 支持此参数**”，`type` 仅 `json_schema`，`json_schema{name, description?, schema}`；`tool_choice` 只有 `none`/`auto` |
| `…/text/api/openapi-chat-openai.json`（OpenAI 兼容） | 请求 schema 无 `response_format`；model enum 只有 `MiniMax-M3.1-Flash` / `MiniMax-M3`；有 `tools`、`reasoning_effort`、`max_completion_tokens` |
| `…/text/api/openapi-chat-anthropic.json`（Anthropic 兼容） + `platform.minimax.io/docs/api-reference/text-anthropic-api` | 支持参数表：`output_config.effort` Fully supported，**没有 `output_config.format`**；`tools`/`tool_choice` Fully supported；`temperature/top_p/top_k/stop_sequences/context_management…` Ignored |
| `…/text/api/openapi-responses.json`（Responses） | `text.format.type` enum = `["text"]` |
| GitHub `MiniMax-AI/MiniMax-M2.5#4` | 社区反馈：OpenAI 兼容接口 `response_format`（json_object/json_schema）被静默忽略 |
| GitHub `MiniMax-AI/MiniMax-M2.7#17`、`M2.5#28` | 更早版本对 Claude Code 的 `output_config.format` 返回 400 `invalid params`；**本轮实测 M3.1-Flash 已改为 200 + 忽略** |

### 2.2 裸探测（`port/tools/minimax-structured-probe.mjs`，提示词里**不要求** JSON，只靠机制本身）
| # | 端点 / 机制 | HTTP | 结果 |
| --- | --- | --- | --- |
| 1 | OpenAI chat `response_format: json_schema (strict)` | 200 | NOT_JSON（`**Title:** *Purrfect Waves at Sunset*…`） |
| 2 | OpenAI chat `response_format: json_object` | 200 | NOT_JSON |
| 3 | OpenAI chat 强制 `tool_choice:{type:function}` | 200 `finish_reason:tool_calls` | **VALID** |
| 4 | Responses `text.format: json_schema` | 200 | NOT_JSON |
| 5 | Anthropic `output_config.format: json_schema` + beta `structured-outputs-2025-12-15` | 200 `end_turn` | NOT_JSON |
| 6 | Anthropic 强制 `tool_choice:{type:tool}` | 200 `stop_reason:tool_use` | **VALID** |
| 7-9 | Anthropic 强制 tool，嵌套 schema（object 数组 + enum）×3 | 200 | **VALID ×3** |
| 10-12 | OpenAI 强制 function，嵌套 schema ×3 | 200 | **VALID ×3** |
| 13 | OpenAI `tool_choice:"required"` | 200 | **VALID** |
| 14 | Anthropic `tool_choice:{type:any}` | 200 | **VALID** |
| 15 | 原生 v2 + `MiniMax-Text-01` + `response_format json_schema` | 200 | JSON_BUT_NOT_SCHEMA（多一层包装 + 重复项） |
| 16 | 原生 v2 + `MiniMax-M3.1-Flash` + `response_format` | 200 | NOT_JSON（Markdown 表格） |

M3.1-Flash 总是 thinking（`thinking:disabled` 会 400），强制 tool_choice 与 thinking 同时使用 **MiniMax 接受**（Anthropic 官方 API 对此有限制，其他 provider 用 tool 模式前需自行确认）。

### 2.3 上一轮为什么“标题请求回来是纯文本”
- 上一轮（docs/16 #2）是 **手工把 Claude Code 的标题请求体发给 MiniMax**，并用了自己的提示词：MiniMax 忽略 `output_config.format` → 自由文本。结论“MiniMax 不执行 Anthropic 结构化输出”是对的。
- 本轮补测发现：**真实 Claude Code 的标题请求自带“返回 JSON”的系统提示**，所以即使 MiniMax 忽略 format，标题多数情况下仍是 `{"title":"…"}`（对照组 2/2，Claude Code 也存下了 `ai-title`）。也就是说之前关掉结构化输出“修”的其实是 **约束没有被执行** 这件事：结果是否是合法 JSON 只取决于模型是否听提示词，而不是被强制。
- 不是“Anthropic 端点不支持、OpenAI 端点支持”：**两个兼容端点都不支持原生结构化输出字段，两个端点都支持强制工具调用。**

## 3. 代码改动

### 3.1 helper 调用（`port/src/main/llm/structured-output.ts`，`protocols.ts`）
- 请求侧三种写法统一识别并从 body 取出：Anthropic GA `output_config.format`、Anthropic beta `output_format`、OpenAI `response_format`（`json_schema` / `json_object`；`text` = 无格式）；同时出现两种 → `UNSUPPORTED_CONTENT`。
- provider 新字段 **`structuredOutput: "native" | "tool" | "off"`**（默认 `native`）：

| 模式 | anthropic-messages | openai-chat-completions | openai-responses |
| --- | --- | --- | --- |
| `native` | `output_config.format={type:"json_schema",schema}` | **`response_format` 透传**（`json_schema{name,schema,strict?,description?}` / `json_object`） | `text.format={type:"json_schema",name,schema,strict?}` / `json_object` |
| `tool` | `tools+=[{name:"structured_output",input_schema}]`，`tool_choice={type:"tool"}` | `tools+=[{type:"function",function:{…parameters}}]`，`tool_choice={type:"function",function:{name}}` | `tools+=[{type:"function",name,parameters}]`，`tool_choice={type:"function",name}` |
| `off` | 丢弃（debug 日志 `dropped_fields: structured_output`） | 同左 | 同左 |

- 响应侧：`extractText` 优先识别名为 `structured_output` 的工具调用（Anthropic `tool_use.input` / chat `tool_calls[].function.arguments` / Responses `function_call.arguments`），返回规范化 JSON 文本；参数不是合法 JSON 时原样返回，由调用方校验。
- 顺带修正：`output_config.effort` 以前会原样漏到 OpenAI 请求里；现在映射为 `reasoning_effort`（chat）/ `reasoning.effort`（responses），其余 `output_config.*` 记为 dropped。body 里显式的 `reasoning_effort`/`reasoning` 优先。
- MiniMax preset：`structuredOutput:"tool"`；示例配置 `minimax-openai` 同样设为 `tool`。用户 providers 文件可改回 `native`（例如 MiniMax 将来支持时）。

### 3.2 Claude Code 子进程（`port/src/main/llm/structured-emulation.ts` + `agent-gate-proxy.ts`）
- 新开关 **`agentCompat.emulateStructuredOutputs`**（必须同时开 `gateProxy`，否则 `CONFIG_INVALID`）。
- proxy 对 `POST /v1/messages`：若 body 有 `output_config.format(json_schema)` 且 **没有客户端工具** → 去掉 format、加唯一工具 `structured_output` 并强制调用（`effort` 保留）。有工具的请求（agent 轮次）**从不改写**，避免劫持正常轮次。
- 响应改写：SSE（流式）逐事件改写 —— `tool_use(structured_output)` 块 → `text` 块，`input_json_delta.partial_json` → `text_delta.text`，thinking 块原样保留，模型额外输出的 text 块丢弃，块 index 重新编号，`stop_reason:"tool_use"` → `"end_turn"`；非流式 JSON 同理；非 200 原样透传。
- 统计：`stats().structuredEmulated / structuredJsonOk`；debug 日志 `agent_proxy.structured_emulated`。
- MiniMax preset `agentCompat` 现为 `{gateProxy:true, disableNonessentialTraffic:true, emulateStructuredOutputs:true}`（`disableStructuredOutputs` 不再开启；仍可在 providers 文件里覆盖）。注意 `disableNonessentialTraffic` 仍开着，所以默认配置下标题请求根本不发；模拟器覆盖的是“用户关掉它”或 Claude Code 其它无工具结构化侧请求的情况。

### 3.3 实测证据（脱敏）
```
# 标题请求开启 + 模拟（providers 覆盖 disableNonessentialTraffic:false）
gateProxy: {requests:2, maxInflight:1, structuredEmulated:1, structuredJsonOk:1}
proxy → Claude Code 的文本: {"title": "Surfing cats"}
CLAUDE_CONFIG_DIR/projects/…jsonl: {"type":"ai-title","aiTitle":"Surfing cats",…}
# 对照：不模拟、不禁用（原生 format 被忽略）→ MiniMax 按提示词仍给出 {"title":"Surfing cats"}（2/2）
# SDK outputFormat → result.structured_output = {"answer":"Paris","confidence":1}（请求中无 output_config.format，Claude Code 用 StructuredOutput 工具）
```

## 4. Claude Agent SDK 开箱即用（`agent-sdk.ts`，`tools/install-agent-sdk.mjs`）

**为什么不直接加到 `dependencies`/`optionalDependencies`**：SDK 会按平台拉原生 `claude`（Linux x64 ≈ 278 MB），每次 `npm ci`（含 CI、只用 helper 的安装）都会下载；SDK 许可证为 “SEE LICENSE IN README.md”（Anthropic 商业条款），随应用分发前需法务确认（原版 Videoclaw 是打进 `app.asar.unpacked` 的）。

**做法**：
- `package.json`：`config.claudeAgentSdkVersion = "0.3.305"`（与 `agent-sdk.ts` 的 `PINNED_CLAUDE_AGENT_SDK_VERSION` 由测试保证一致）+ 脚本 `npm run agent-sdk:install`：在 `port/vendor/claude-agent-sdk/` 生成独立 package.json 并 `npm install`（只装当前平台的原生二进制；打包其它平台用 `-- --os win32 --cpu x64`）。`port/vendor/` 已加入 `.gitignore`。
- **自动发现顺序**（`discoverClaudeAgentSdk`，首个命中即用）：
  1. `VIDEOCLAW_CLAUDE_AGENT_SDK`（显式设置但找不到 → 直接报错，不静默回退）
  2. `<appRoot>/node_modules`（开发时手动 `npm i` 了 SDK）
  3. `<resourcesPath>/app.asar.unpacked/node_modules`（与原版相同的打包布局）
  4. `<resourcesPath>/claude-agent-sdk`（electron-builder `extraResources` 拷贝 vendor 目录）
  5. `<appRoot>/vendor/claude-agent-sdk`（`npm run agent-sdk:install`）
  6. `~/.videoclaw/claude-agent-sdk`
  找不到时 `SDK_UNAVAILABLE` 报错信息里给出安装命令和全部查找路径。
- 原生 `claude` 仍由 `claudeCodeExecutableFor()` 在 SDK 旁边找 `claude-agent-sdk-<platform>-<arch>[-musl]/claude[.exe]`，`VIDEOCLAW_CLAUDE_CODE_EXECUTABLE` 可覆盖。
- 新 CLI：`node dist/cli/port-cli.cjs agent-sdk-check`（离线：发现来源、版本、是否等于 pin、原生二进制路径）。
- ~~打包建议（未实施，未验证）~~ → **第五轮已实施（docs/18 §2）**：采用 `extraResources`（`<sdkDir>/node_modules` → `resources/claude-agent-sdk/node_modules`，命中第 4 条）；Linux AppImage/deb 实测发现来源为 `resources`。

## 5. LLM 路由选择 IPC / UI

- **不动原版 184 个方法的 `window.videoclaw`**（忠实性测试）；新增 PORT-NEW 通道 **`port:llm:routes`**，经独立的 `window.videoclawPort.llmRoutes()` 暴露（`port/src/shared/port-ipc.ts`）。
- 返回 `LlmRoutesView`：
```ts
{ current: LlmRouteId,               // 归一化后的 settings.llmRoute
  routes: Array<{ id, kind: "builtin"|"provider", label,
                  protocol?, model?, keyEnv?, keyPresent?,   // 只给 key 是否存在，从不返回 key
                  agentCapable?, helperCapable?, structuredOutput?, preset?,
                  problem?: "key-missing" | "protocol-not-agent-capable" }>,
  configError?: string }              // providers 文件加载失败时（此时只列 preset）
```
- **选择仍走原版 `settings:set`**：`window.videoclaw.setSettings({ llmRoute })`（`rendererWritableSettingsPatch` 校验，未注册的名字被丢弃），变化时触发原有 `onLlmRouteChanged` 钩子。
- ~~port 的 renderer 只是 stub：已加一个最小 `<select>`~~ → **第五轮**：正式 Settings 页（状态徽章、不可用原因、单选、拒绝检测、`port:llm:routesChanged` 推送 + 焦点/可见性刷新、About this build），调试 `<select>` 已移除，见 docs/18 §5。原版完整设置页仍待 React renderer 移植。
- LLM runtime 启动失败（假 settings 后端）时 `port:llm:routes` 返回 `{current:"claude-code", routes:[], configError:"LLM runtime not running …"}`。
- Electron 冒烟（`VIDEOCLAW_PORT_SMOKE=1`）新增记录 `port:llm:routes` 和 selector 的选项。

## 6. 其它
- `llm-model-info <provider>` 新增 `structuredOutput: {configured, suggested, matches}`：models.dev `structured_output:true` → `native`；`false` 且 `tool_call:true` → `tool`；否则 `off`（只是提示：目录描述的是模型，不代表某个兼容端点真的执行原生字段）。
- 新 CLI `VIDEOCLAW_LLM_LIVE=1 node dist/cli/port-cli.cjs llm-structured <provider> [--mode native|tool|off]`：一次真实结构化请求，输出 `verdict: SCHEMA_VALID | JSON_NOT_SCHEMA | NOT_JSON`。
- `tools/minimax-structured-probe.mjs`：§2.2 的裸探测脚本（`VIDEOCLAW_LLM_LIVE=1`，串行）。

## 7. 测试 / 提交
- `npm test`：**165/165**（上轮 150；新增：structured-output 8、gate-proxy 模拟 4、SDK 发现/pin 2、路由列表 1）；`npm run build` 通过（gen + tsc + esbuild）。
- 提交：`ea71e2f`（helper 结构化输出）、`0f6aec0`（proxy 模拟 + preset）、`767d897`（SDK 自动发现 + 安装脚本）、`1880eb4`（路由选择 IPC/UI）、本文档提交。

## 8. 未验证 / 风险

> 第六轮（docs/19）：gate proxy（含结构化输出模拟）现在也由 UI 发起的 AgentHost 会话使用（`gateProxy:true`、`maxConcurrency:1`）；MiniMax preset 开着 `disableNonessentialTraffic`（标题等旁路请求预计不发），本轮也没有记录 proxy 的 `structuredEmulated` 计数，所以**未确认** UI 会话中是否走到了模拟路径。
- 强制工具调用的 **schema 遵守是“模型行为”而非服务端约束**：12/12 有效，但不是保证（没有 `strict` 语义）；调用方仍应 `JSON.parse` + 校验。复杂 schema（深嵌套、大量必填、`oneOf`）、超长输出、`max_tokens` 不足时的截断表现未测。
- tool 模式下若调用方本身也传了 tools，会被追加并强制调用 `structured_output`，原有工具不会被调用（helper 场景目前没有这种调用方）。
- gate proxy 模拟只覆盖 **无工具** 的 `output_config.format` 请求；Claude Code 其它可能用到结构化输出的路径（除标题外）未枚举；Claude Code 版本升级后请求形状可能变化。
- `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS=1` 下 Claude Code 的回退：只在一个样本里看到标题请求仍返回 JSON（靠提示词），未系统测试。
- MiniMax 原生 v2 + `MiniMax-Text-01` 的 `response_format` 只测 1 次且未遵守 schema；未作为路径。
- OpenAI / Anthropic 官方端点在 `native` 模式下的真实行为未测（只有 mock 单测），Responses `text.format` 的 `json_object` 写法依 OpenAI 公开文档实现。
- SDK 打包：~~electron-builder 配置未实施~~（第五轮已实施，Linux 已验证，docs/18）；Windows/macOS 原生二进制未运行（`--os/--cpu` 交叉安装与进包布局已验证）；SDK 许可证允许随应用分发与否需要确认。
- 路由选择：~~只有 stub `<select>`、无推送~~（第五轮：Settings 页 + `port:llm:routesChanged`，docs/18 §5）；提示文案仍未本地化。
- 共享 key：本轮所有真实请求都串行，但与 Pageway 管线同时使用时有一次 OpenAI 端点请求耗时 36 s、两次 agent 冒烟合计 189 s（推测上游排队/重试），未深入。
