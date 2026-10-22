# 14 · MiniMax（MiniMax-M3.1-Flash）接入方案

> 状态：方案 (a) 已在 `port/` 落地（`port/src/main/llm/`），真实 key 冒烟已通过（见 §0）。日期：2026-10-21。
> **2026-10-21 更新**：MiniMax 已不再特判，改为通用自定义 LLM 框架的内置 preset `minimax`（见 [docs/15](15-generic-llm-and-models-dev.md)）；helper 调用鉴权由 `x-api-key` 改为 `Authorization: Bearer`（两者在 §0 均已验证 200，并已用通用路径重新实测）。
> 本文 **不含任何密钥**。密钥只通过环境变量 `MINIMAX_API_KEY` 提供，禁止写入文件 / 日志 / git。

## 0. 已验证 / 未验证（2026-10-21，box 上用真实 `MINIMAX_API_KEY`）

**已验证（真实请求，均为单次、并发 1）**

| 项 | 结果 |
| --- | --- |
| Base URL | **`https://api.minimaxi.com/anthropic`** → `POST /v1/messages` **HTTP 200**（第一个候选即成功，按约定未再请求 `api.minimax.cn` / `api.minimax.io`） |
| 鉴权头 | **`x-api-key: $MINIMAX_API_KEY`** → 200；**`Authorization: Bearer $MINIMAX_API_KEY`** → 200（两者均可；Claude Agent SDK 的 `ANTHROPIC_AUTH_TOKEN` 走的就是 Bearer） |
| 必需头 | `anthropic-version: 2023-06-01` + `content-type: application/json`（未测不带 version 的情况） |
| 模型 | `model: "MiniMax-M3.1-Flash"` 被接受，响应 `model` 字段回显同名；`type:"message"`、`role:"assistant"`、`stop_reason:"end_turn"`、`usage`（含 `cache_read_input_tokens`）字段齐全 |
| thinking | **不传 `thinking` 参数时，响应只有 `text` 块，没有 `thinking` 块**（output_tokens=3）；显式传 `thinking: {type:"enabled", budget_tokens:1024}` 时返回标准 `thinking` 块（含 `signature`）+ `text` 块，`usage.output_tokens_details.thinking_tokens` 有值。→ “强制 thinking” 至少在响应层面不一定可见，§2.1 的说法需修正为“可能在服务端隐式进行/不回传” |
| port 代码路径 | `VIDEOCLAW_MINIMAX_LIVE=1 node port/dist/cli/port-cli.cjs minimax-ping`（走 `resolveHelperCreds` + `anthropicMessages` + 并发闸门/退避包装）→ `{ok:true, text:"Hello!"}` |

**未验证**

- [ ] `api.minimax.cn/anthropic`、`api.minimax.io/anthropic` 是否接受同一把 key（第一个候选已 200，按“单 URL 单请求、不轰炸”约定未测）。
- [ ] Claude Agent SDK / `claude` CLI 指向 MiniMax 的端到端会话（工具调用、流式、`anthropic-beta` 头、prompt cache、subagent/haiku 后台请求）——box 上只有 darwin-arm64 的 `claude` 二进制，无法在 Linux 运行。
- [ ] 真实 429/529 时的响应形态与 `retry-after` 头（退避逻辑仅用 mock 测试）。
- [ ] `output_config.effort` 各档位、`thinking: disabled` → 400 的说法（本次未测）。
- [ ] 图片输入、2000px/4.5MB 超限报错；`createLocalRuntime` 本体与 UI 选择器尚未移植到 port（见 §9）。

> **第四轮补充（结构化输出，详见 docs/17）**：MiniMax-M3.1-Flash 在 Anthropic 兼容、OpenAI 兼容（chat / responses）、原生 v2 四个入口上都 **静默忽略** 原生结构化输出字段（`output_config.format` / `response_format` / `text.format`，200 + 自由文本，5/5）；文档中的 `response_format` 只对旧模型 `MiniMax-Text-01`（原生接口）有效。**强制工具调用**（Anthropic `tool_choice:{type:"tool"|"any"}`、OpenAI `tool_choice:{type:"function"}|"required"`）返回符合 schema 的 JSON **12/12**。→ preset `structuredOutput:"tool"`，Claude Code 子进程由 gate proxy 模拟（`agentCompat.emulateStructuredOutputs`）。

## 1. 结论速览

| 项 | 结论 |
| --- | --- |
| 模型 ID | `MiniMax-M3.1-Flash`（大小写敏感；"minimax-m3.1-flash" 是真实模型，官方 ID 即此写法）。同系列另有 `MiniMax-M3` |
| 主协议（采用） | **Anthropic Messages API 兼容**：`POST {BASE}/v1/messages` |
| Base URL（中国站，团队给定） | `https://api.minimaxi.com/anthropic`（**2026-10-21 真实 key 验证 200**，默认值） |
| 其他官方 Base URL | 中国站文档现写 `https://api.minimax.cn/anthropic`；国际站 `https://api.minimax.io/anthropic`（三者 2026-10-21 实测均在线，未带 key 返回 401） |
| 备用协议 | OpenAI 兼容 `POST {host}/v1/chat/completions`、OpenAI Responses 兼容（同一 key） |
| 鉴权 | `x-api-key: $MINIMAX_API_KEY` 或 `Authorization: Bearer $MINIMAX_API_KEY`（**两者均已验证 200**）；**不需要 GroupId** |
| 能力 | 文本 + 图片输入（官方另支持视频理解）、强制开启 thinking（不可关闭）、1M 上下文、最多 512K 输出 token、工具调用 |
| **不支持** | **图片生成（文生图）**。M3.1-Flash 只“看图”不“出图”；出图需另接 MiniMax Image Generation 接口（独立模型/端点，见 §6） |
| 环境变量 | `MINIMAX_API_KEY`（必需）；`MINIMAX_BASE_URL`（可选，默认 `https://api.minimaxi.com/anthropic`）；`MINIMAX_MODEL`（可选，默认 `MiniMax-M3.1-Flash`）；`MINIMAX_MAX_CONCURRENCY`（可选，默认 1） |
| 推荐插入点 | **方案 (a)：复用 Claude Agent SDK 路径**，新增 `llmRoute: "minimax"`，在 `createLocalRuntime`（`app/reconstructed/main/index.js` L23060，env 块 L23306）按 gateway 分支的写法注入 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`，并在 `resolveHelperCreds`（L22343）加同样分支 |

## 2. 协议细节

### 2.1 Anthropic 兼容（主路径）

```bash
curl https://api.minimaxi.com/anthropic/v1/messages \
  -H "x-api-key: $MINIMAX_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "MiniMax-M3.1-Flash",
    "max_tokens": 4096,
    "output_config": {"effort": "medium"},
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

- 思考深度：`output_config.effort` ∈ `low | medium | high | xhigh | max`，省略时为 `max`（最慢最贵）。**本项目建议默认 `medium`**，按需上调。
- thinking 不可关闭：传 `thinking: {"type":"disabled"}` 或 effort `none` → HTTP 400（`model "MiniMax-M3.1-Flash" requires adaptive thinking`）。
- 响应 `content[]` 中会出现 `type: "thinking"` 块和 `type: "text"` 块，按 Anthropic 标准解析即可（Claude Agent SDK 原生支持）。
- `temperature` / `top_p` 目前无效（固定 1 / 0.95）。
- 输出上限：`max_tokens` 最大 524288（512K），官方建议 131072。

### 2.2 图片输入（Anthropic 格式）

```json
{
  "model": "MiniMax-M3.1-Flash",
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": [
      {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "<BASE64>"}},
      {"type": "text", "text": "描述这一帧画面"}
    ]
  }]
}
```

- 团队给定上限：**单图 ≤ 2000×2000 像素且 ≤ 4.5 MB**，发送前统一降采样（可用已打包的 ffmpeg：`-vf scale='min(2000,iw)':'min(2000,ih)':force_original_aspect_ratio=decrease`，再按需转 JPEG 压体积）。
- 官方文档宽松值为 ≤10 MB/图、请求体 ≤64 MB；以团队给的更严格值为准。
- 支持格式：JPEG / PNG / GIF / WEBP。

### 2.3 OpenAI 兼容（备用，不作为主路径）

`POST https://api.minimaxi.com/v1/chat/completions`（官方文档 host 为 `api.minimax.cn` / `api.minimax.io`），`Authorization: Bearer`，图片用 `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`，思考深度字段为 `reasoning_effort`，思考内容在 `message.reasoning_content`。另有 OpenAI Responses 兼容端点（Codex `wire_api: "responses"` 理论上可用；第四轮只对它发过 1 次结构化输出探测：200，`text.format` 被忽略）。OpenAI 兼容 chat 的参数表 **没有 `response_format`**（实测被忽略），结构化输出请用强制 `tool_choice`（docs/17 §2）。
> **2026-10-21 实测（docs/15 §0）**：OpenAI 兼容 chat 端点 `https://api.minimaxi.com/v1` 已通过通用框架（`openai-chat-completions`，`chatMaxTokensField: "max_completion_tokens"`，Bearer）发过 1 次带 base64 PNG 的请求，返回正确。配置见 `port/config/llm-providers.example.json` 的 `minimax-openai`（与内置 `minimax` preset 共用 `MINIMAX_API_KEY`；并发闸门按 key env 共享、取最小 `max`，所以两者同时启用时账号级并发仍为 1）。内置 preset 仍走 Anthropic 兼容端点，行为未变。

### 2.4 错误码 / 限流

- HTTP 429 / 529 → 退避重试；body 中 `base_resp.status_code`：`1002` 限流、`1004` 鉴权失败、`1008` 余额不足、`1039` token 超限、`2013` 参数错误。
- 官方速率限制（M3.1-Flash/M3 共享，按账号含子账号合计）：免费用户 20 RPM / 1M TPM；充值用户 200 RPM / 10M TPM。

## 3. 计费与配额（参考）

- 按量付费（pay-as-you-go）API key，**不是** MiniMax Code / M Plan 订阅额度。
- 单价（团队提供）：输入 $0.15 / M tokens，输出 $0.6 / M tokens，缓存读取 $0.015 / M tokens。
- 注意：thinking 输出计入输出 token；effort=max 时开销显著增加。图片每张约数百 ~ 数千 token。

## 4. 并发与共享 key 约束（重要）

同一把 key 与 **Pageway 图书流水线** 共用，RPM/TPM 是账号级合计。实现要求：

1. 进程内全局信号量，默认并发 **1**（`MINIMAX_MAX_CONCURRENCY`，上限建议 2）。
2. 429 / 529 / `1002`：指数退避 + 抖动（例如 2s → 4s → 8s → 16s → 32s，最多 5 次），优先遵循 `retry-after` 头。
3. 401/`1004`、`1008` 余额不足：不重试，直接以“提供方凭据/余额问题”报错（可复用现有 `PROVIDER_CREDENTIAL_MISCONFIGURED` 语义，见 `port/src/main/gateway/agent-gateway-proxy.ts`）。
4. CI / 测试默认不走真实 MiniMax；真实调用测试必须显式开关（如 `VIDEOCLAW_MINIMAX_LIVE=1`）。

## 5. 现有 provider 结构（逆向结果）

| 位置（`app/reconstructed/main/index.js`） | 作用 |
| --- | --- |
| L321 `resolvedLlmRoute` / L319 `DEFAULT_LLM_ROUTE="claude-code"` | Claude 路径的路由：`claude-code`（用户本机 claude.ai 登录）或 `gateway`（上游计费网关） |
| L5397 settings 校验 | `llmRoute` 只允许 `claude-code` / `gateway`，其他值被删除 |
| L4531 / L4899 `CredentialStore.providerKeys` / `providerKey()` / `setProviderKey()` | 加密 vault 中的 BYO provider key（目前 `openai-api`、`openrouter`） |
| L5114 `rendererWritableSettingsPatch` | 禁止渲染进程写 `openaiApiKey` / `openRouterApiKey` / `providerKeys` |
| L16026 `sanitizedAgentEnv` | **会剥掉所有名字含 KEY/TOKEN/SECRET/AUTH 的环境变量**，所以 `MINIMAX_API_KEY` 不会自动传给子进程，必须显式注入 |
| L22343 `resolveHelperCreds` | 主进程直接调 `/anthropic/v1/messages` 的辅助调用（如 L23002 `proposeSessionTitle`），目前仅 gateway 有凭据 |
| L23060 `createLocalRuntime`，env 块 L23306 | Claude Agent SDK `query()`；gateway 分支注入 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、独立 `CLAUDE_CONFIG_DIR` |
| L23420–23477 `CODEX_OPENROUTER_ENV` / `codexOpenRouterConfig` / `codexOpenAiConfig` | Codex 的 `model_providers`（openrouter → `https://openrouter.ai/api/v1`，openai → `https://api.openai.com/v1`，`wire_api: "responses"`） |
| L329 `resolvedCodexProvider`、L5132、L5383、L24851、L24916 | Codex provider 白名单与 env 名选择 |
| L40865 `sessionModel` | gateway 路由默认模型别名 `"sonnet"` |
| `port/src/shared/ipc-contract.ts` L216 / L511 | `AgentProviderKeyStatus`、`saveAgentProviderKey` 的 provider 枚举 `"openai-api" \| "openrouter"` |

## 6. 方案对比与推荐

### (a) 走 Claude Agent SDK / Anthropic 路径（**推荐**）

做法：新增 `llmRoute: "minimax"`，复用 gateway 分支的注入方式，把 Anthropic 端点指向 MiniMax。

优点：
- 协议原生匹配（MiniMax 官方推荐 Anthropic 兼容，thinking 块、工具调用、图片 content block 均与 Claude 一致），**无需新 adapter**，`ClaudeCodeMessageAdapter`、工具权限、Studio MCP、hooks 全部复用。
- 改动集中在 4–5 处，且全部有 gateway 先例可照抄。
- 主进程辅助调用（`anthropicMessages`）也能同一套凭据复用。

风险 / 需处理：
- Claude Code 会发送 `sonnet`/`haiku` 等别名及后台小模型请求 → 必须把所有模型别名映射到 `MiniMax-M3.1-Flash`（见下方 env）。
- 必须用独立 `CLAUDE_CONFIG_DIR`，防止用户本机 claude.ai 登录抢占（与 gateway 的 gotcha #4 相同）。
- `effort` 映射：Claude Code 的 effort 级别需对齐 MiniMax 的 `low…max`，且不能出现 “关闭思考”。
- Claude Code 某些 Anthropic 专有 beta 特性 MiniMax 可能不支持 → 需真实 key 冒烟验证（见 §8）。

### (b) 作为独立 provider（Codex `model_providers` 或自写 adapter）

- 走 Codex：在 L23454 旁新增 `codexMiniMaxConfig()`（`base_url: https://api.minimaxi.com/v1`，`wire_api: "responses"`，`env_key: VIDEOCLAW_MINIMAX_API_KEY`），并扩展 L329/L5132/L5383/L24851/L24916 及 IPC 枚举。缺点：依赖 MiniMax 的 Responses 兼容层（团队未确认、未实测），白名单分散在 6+ 处，且 Codex harness 不是默认路径。
- 自写 adapter：工作量最大，需重写流式解析、工具调用、图片封装，无必要。

**推荐 (a)**。(b) 中的 Codex 变体可作为后续可选项。

## 7. 具体改动清单（方案 a）

> 以下为原始重建代码位置；port（`port/src/main`）中对应模块迁移时同步落地，建议新建 `port/src/main/llm/minimax.ts` 集中放常量、并发闸门与图片降采样工具。

1. **常量**（新模块）：
   ```ts
   export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic";
   export const MINIMAX_DEFAULT_MODEL = "MiniMax-M3.1-Flash";
   export function minimaxConfig(env = process.env) {
     const key = env.MINIMAX_API_KEY?.trim();
     if (!key) return null;
     return {
       key,
       baseUrl: (env.MINIMAX_BASE_URL?.trim() || MINIMAX_DEFAULT_BASE_URL).replace(/\/+$/, ""),
       model: env.MINIMAX_MODEL?.trim() || MINIMAX_DEFAULT_MODEL,
       maxConcurrency: Math.max(1, Math.min(2, Number(env.MINIMAX_MAX_CONCURRENCY) || 1)),
     };
   }
   ```
   注意：必须在 `sanitizedAgentEnv()` 之前从 `process.env` 读取。
2. **路由枚举**：L321 `resolvedLlmRoute` 与 L5397 settings 校验允许 `"minimax"`；`port/src/shared/ipc-contract.ts` 的 `PublicSettings.llmRoute` 同步。
3. **会话运行时**：L23306 env 块新增分支（与 gateway 并列）：
   ```js
   ...(gateway.llmRoute === "minimax" && mm
     ? {
         ANTHROPIC_BASE_URL: mm.baseUrl,
         ANTHROPIC_AUTH_TOKEN: mm.key,
         ANTHROPIC_MODEL: mm.model,
         ANTHROPIC_DEFAULT_OPUS_MODEL: mm.model,
         ANTHROPIC_DEFAULT_SONNET_MODEL: mm.model,
         ANTHROPIC_DEFAULT_HAIKU_MODEL: mm.model,
         ANTHROPIC_SMALL_FAST_MODEL: mm.model,
         CLAUDE_CODE_SUBAGENT_MODEL: mm.model,
         CLAUDE_CONFIG_DIR: deps.profileDir,
       }
     : {}),
   ```
   且 `customHeaders`（`anthropicClientJobCustomHeaders`）仅限 gateway，不发给 MiniMax。
4. **默认模型**：L40865 `sessionModel` 在 `llmRoute === "minimax"` 时返回 `mm.model`（或 `"sonnet"` 别名由第 3 步 env 映射）。
5. **辅助调用**：L22343 `resolveHelperCreds` 新增：
   ```js
   if (resolvedLlmRoute(cfg) === "minimax" && mm) {
     return { url: `${mm.baseUrl}/v1/messages`,
       headers: { "x-api-key": mm.key, "content-type": "application/json", ...ANTHROPIC_VERSION },
       model: mm.model };
   }
   ```
   调用方（如 `proposeSessionTitle`）需改用 `creds.model` 而不是写死的 Claude 模型名，并传低 effort（`output_config: {effort: "low"}`）。
6. **并发闸门 + 重试**：在 `anthropicMessages`（L22360 后）外包一层全局信号量与 429/529 退避（§4）。Claude Agent SDK 会话本身也计入信号量（会话并发上限 = `MINIMAX_MAX_CONCURRENCY`）。
7. **图片降采样**：所有发往 MiniMax 的图片（帧截图、参考图）先过 `ensureImageWithinLimits(path)`：≤2000×2000、≤4.5MB，使用已打包 ffmpeg。
8. **登录检查**：`minimax` 路由跳过 `claudeCodeLoginAvailable` / claude.ai 订阅校验（L22741 附近），改为检查 `MINIMAX_API_KEY` 是否存在。
9. **UI / 设置**：llmRoute 选择器新增 “MiniMax（BYO key，环境变量）”；key 状态只显示 configured true/false，**不回显 key**。后续若要在 UI 输入 key，存入 `CredentialStore.providerKeys["minimax"]`（L4899），环境变量优先。

## 8. 待验证项（拿到授权后用真实 key 冒烟）

- [x] `api.minimaxi.com/anthropic` 接受该 key（x-api-key 与 Bearer 均 200）。`api.minimax.cn` / `api.minimax.io` 未测（见 §0）。
- [ ] Claude Agent SDK（claude CLI）指向 MiniMax 后：工具调用、流式、`thinking` 块、prompt cache、`--replay-user-messages` 是否正常；是否有不兼容的 `anthropic-beta` 头导致 400。
- [ ] Claude Code effort 级别 → MiniMax `output_config.effort` 的实际映射。
- [ ] 图片 2000px / 4.5MB 限制的超限报错形态。
- [ ] 文生图需求是否存在：如需要，另行接入 MiniMax Image Generation（`POST /v1/image_generation`，模型如 `image-01`，官方 10 RPM），不属于 M3.1-Flash。

## 9. port 实现（方案 a，已落地）

| 文件 | 内容 |
| --- | --- |
| `port/src/main/llm/minimax.ts` | PORT-NEW：`MINIMAX_DEFAULT_BASE_URL`/`MINIMAX_DEFAULT_MODEL`、`minimaxConfig(env)`（`MINIMAX_API_KEY` 必需；`MINIMAX_BASE_URL`/`MINIMAX_MODEL`/`MINIMAX_MAX_CONCURRENCY` 可选，并发钳制到 1..2）、`describeMiniMaxConfig`（只输出 configured:true/false，不回显 key）、`minimaxClaudeRuntimeEnv`（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + 全部模型别名 → MINIMAX_MODEL + 独立 `CLAUDE_CONFIG_DIR`，不带 gateway 的 `ANTHROPIC_CUSTOM_HEADERS`）、`ConcurrencyLimiter` + 进程级 `minimaxGate`、`withMiniMaxRetry`（429/529/`1002` 指数退避 2s→4s→8s→16s→32s + 抖动，优先 `retry-after`，最多 5 次；401/403/`1004`/`1008` 不重试 → `PROVIDER_CREDENTIAL_MISCONFIGURED`） |
| `port/src/main/llm/llm-route.ts` | 原版逐行移植（差分测试对照 `app/reconstructed`）：`resolvedLlmRoute`、settings `llmRoute` 校验、`AGENT_STARTUP_ENV_DENYLIST`/`sanitizedAgentEnv`、`createLocalRuntime` 的 sdkEnv 预处理（`claudeSdkBaseEnv`）、gateway env 分支（`claudeRouteEnv`）、`resolveHelperCreds`、`anthropicMessages`；每处新增 `"minimax"` 兄弟分支。`sanitizedAgentEnv` 会剥掉 `MINIMAX_API_KEY`，因此 key 从**未清洗**的 env 读取后以 `ANTHROPIC_AUTH_TOKEN` 显式注入子进程。辅助调用对 minimax 强制 `body.model = MINIMAX_MODEL` 并经过闸门 + 退避 |
| `port/src/cli/port-cli.ts` | `minimax-config`（离线）/ `minimax-ping`（需 `VIDEOCLAW_MINIMAX_LIVE=1`，单次真实请求） |
| `port/test/minimax.test.ts` | 10 个测试，全部用本地 mock HTTP 服务，不访问真实 API |

尚未接入：port 里还没有 `createLocalRuntime` / `AgentHost.sessionModel` / UI 路由选择器本体（原版这些模块尚未移植），接入时把 `claudeSdkBaseEnv()` + `engineEnv` + `claudeRouteEnv()` 按原顺序展开、`sessionModel` 用 `defaultSessionModel()` 即可；`ipc-contract.ts` 是生成文件，`PublicSettings.llmRoute` 仍为 `unknown`，未改。
