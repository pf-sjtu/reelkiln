# 15 · 通用自定义 LLM 接入框架 + models.dev 模型目录同步

> 状态：已在 `port/` 落地（2026-10-21）。本文 **不含任何密钥**；密钥只存在于环境变量中，配置文件里只写环境变量 **名**。
> 取代 docs/14 中“MiniMax 特判”的实现：MiniMax 现在只是本框架的一个内置 preset（行为保持 docs/14 已验证的结论）。

## 0. 已验证 / 未验证（2026-10-21，box，Node 24.22 / Electron 42.11.9）

**已验证**

| 项 | 结果 |
| --- | --- |
| `npm run build`（gen + tsc + esbuild）| 通过 |
| `npm test`（node:test，非 vitest，见 §8）| **111/111 通过**（原 86 + 新增 25） |
| 原始路由行为 | `resolvedLlmRoute` / settings 校验 / `sanitizedAgentEnv` / `resolveHelperCreds`(gateway) 与原 bundle 的差分测试仍全部通过 |
| models.dev 真实同步 | `models-sync` → `updated`，**232 个 provider / 9079 个模型，0 条被跳过**，约 0.5 s，DB 约 10 MB |
| 条件请求 | 第二次 `models-sync` 带 `If-None-Match` → 服务器 **304** → `not-modified`（不重写数据）；`--force` 重新写入，行数不变（幂等） |
| 离线 / 坏数据 | 不可达 URL → `NETWORK`；返回 HTML 的 URL → `CATALOG_INVALID`；两种情况下 9079 行均保留，`sync_meta.last_status=failed` 并记录错误 |
| Electron 运行时 | `ELECTRON_RUN_AS_NODE=1 electron dist/cli/port-cli.cjs models-sync/models-show` 正常（Electron 42 内置 Node 24.19，`node:sqlite` 可用，SQLite 3.53.3） |
| 元数据查询 | `llm-model-info minimax` → `minimax-cn/MiniMax-M3.1-Flash`：context 1,000,000，output 524,288，USD/1M：input 0.1494 / output 0.5976 / cache_read 0.0149，输入模态 text/image/video |
| MiniMax 真实请求（通用路径）| `VIDEOCLAW_LLM_LIVE=1 port-cli llm-ping minimax` → **1 次请求**，并发 1，`Authorization: Bearer` → `{ok:true, text:"pong"}`，约 2 s；输出中不含 key |

**未验证**

- [ ] `openai-chat-completions` / `openai-responses` 两种协议只用本地 mock 测试，**未对任何真实 OpenAI 兼容端点发过请求**（请求/响应形状按公开 API 文档实现）。
- [ ] `auth.scheme = "header"`、`x-api-key` 在 **Claude Agent SDK 子进程** 中的效果（`ANTHROPIC_CUSTOM_HEADERS` / `ANTHROPIC_API_KEY`）——box 上没有可运行的 Linux `claude` 二进制，只测了生成的 env。
- [ ] `agentEffort` → `CLAUDE_CODE_EFFORT_LEVEL` 是否被 Claude Code 采纳（原版只是删除该变量，说明它存在；未实测取值）。
- [ ] 真实 429/529 + `retry-after`（仍只有 mock）。
- [ ] `createLocalRuntime` 本体、设置 UI 的 provider 选择器尚未移植到 port（`llm-route.ts` 仍是可调用的库层，未接入 Electron 主进程 IPC）。
- [ ] models.dev 的 `?type=all` / `models.json` / `catalog.json` 变体未接入（只同步默认 `api.json`）。
- [ ] Windows / macOS 上 `node:sqlite` 的实际运行（理论上随 Node/Electron 内置，无原生编译）。

## 1. 总体结构

```
port/src/main/llm/
  provider-config.ts    zod schema、内置 preset（MINIMAX_PRESET）、providers 文件加载/合并
  provider-registry.ts  ProviderRegistry：按名查找、从“未清洗的”env 解析 key、安全摘要
  protocols.ts          三种协议的 URL/鉴权头/请求体转换/文本提取；Claude Agent SDK 子进程 env
  retry.ts              每 provider 一个进程级并发闸门；按配置的重试/退避策略
  errors.ts             LlmProviderError（typed code）
  logger.ts             JSON 行结构化日志 + 密钥脱敏
  llm-route.ts          原版路由管线（差分测试）+ “任意已注册 provider” 分支
  minimax.ts            docs/14 兼容薄封装（minimaxConfig / withMiniMaxRetry …）
port/src/main/models-dev/
  catalog.ts  db.ts  sync.ts  lookup.ts
port/src/cli/models-cli.ts   models-* / llm-model-info 子命令
port/src/shared/llm-types.ts LlmRouteId 等共享类型
port/config/llm-providers.example.json
```

路由：`settings.llmRoute` 取值 = `"claude-code"` | `"gateway"` | **任意已注册 provider 名**（类型 `LlmRouteId`，`PublicSettings.llmRoute` 已由 `unknown` 改为该联合类型）。未注册的值与原版一致：`resolvedLlmRoute` 回落到 `claude-code`，settings 归一化时删除。

## 2. 配置格式

providers 文件路径：环境变量 **`VIDEOCLAW_LLM_PROVIDERS_FILE`**（设置了就必须存在且合法）。不设置时只有内置 preset。
文件非法时：严格加载 `loadProviderRegistry()` 抛 `CONFIG_INVALID`；进程级 `getProviderRegistry()` **降级**为只用内置 preset，并打一条 `llm.providers.config_invalid` 错误日志（不含文件内容），`llm-providers` 命令会显示 `configError`。注册表在进程内只加载一次（改文件需重启）。

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
| `concurrency` | `{max:1, cap:64}` | 每个 provider 名一个进程级信号量，首个调用者定大小；退避 sleep 期间占着槽位 |
| `retry` | `maxRetries 5, baseDelayMs 2000, maxDelayMs 60000, retryStatuses [429,529], credentialStatuses [401,403]` | 退避 `base·2^i·(1+0.25·jitter)`，封顶 maxDelayMs；有 `retry-after`（秒或日期）则优先（同样封顶）。`bodyCodePath`（如 `base_resp.status_code`）+ `retryBodyCodes` / `credentialBodyCodes` 用于按响应体错误码分类 |
| `timeoutMs` | 60000 | 每次尝试（含读完 body） |
| `envOverrides` | `{}` | 允许用 env 覆盖 `baseUrl` / `model` / `maxConcurrency`（MiniMax 用它保持 `MINIMAX_BASE_URL` 等兼容） |
| `agentEffort` | 无 | 子进程 `CLAUDE_CODE_EFFORT_LEVEL`（low/medium/high/xhigh/max） |

### 2.1 内置 preset：`minimax`

`protocol: anthropic-messages`，`baseUrl: https://api.minimaxi.com/anthropic`，`auth: bearer`，`apiKeyEnv: MINIMAX_API_KEY`，`model: MiniMax-M3.1-Flash`，`concurrency {max:1, cap:2}`（key 与 Pageway 共享），重试 429/529 + `base_resp.status_code=1002`，**不重试** 401/403 + 1004（鉴权）/1008（余额）→ `PROVIDER_CREDENTIAL_MISCONFIGURED`；`modelsDev.provider = "minimax-cn"`（minimaxi.com 为国内站）；env 覆盖 `MINIMAX_BASE_URL` / `MINIMAX_MODEL` / `MINIMAX_MAX_CONCURRENCY`。
与 docs/14 唯一差异：helper 调用的鉴权头由 `x-api-key` 改为 `Bearer`（与子进程的 `ANTHROPIC_AUTH_TOKEN` 统一；两者在 docs/14 §0 均验证 200，本次用 Bearer 再次实测通过）。如需旧行为，在 providers 文件里写 `{"name":"minimax","auth":{"scheme":"x-api-key"}}`（注意这同时会让子进程改用 `ANTHROPIC_API_KEY`）。

## 3. 运行时行为

### 3.1 Claude Agent SDK 子进程 env（`claudeRouteEnv`）

原版 `sanitizedAgentEnv` 会剥掉所有名字含 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/AUTH 的变量，所以 provider key 从 **未清洗** 的 env 读取，再显式注入：

| auth | 注入 |
| --- | --- |
| bearer | `ANTHROPIC_AUTH_TOKEN=K` |
| x-api-key | `ANTHROPIC_API_KEY=K` |
| header | `ANTHROPIC_CUSTOM_HEADERS="<header>: <prefix>K"`（与 provider `headers` 一起，换行分隔） |

外加 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` 与五个别名变量（`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`、`ANTHROPIC_SMALL_FAST_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`）、可选 `CLAUDE_CODE_EFFORT_LEVEL`、隔离的 `CLAUDE_CONFIG_DIR`。**gateway 的 job 头（customHeaders）永不转发给第三方。** 只有 `anthropic-messages` provider 能驱动 Claude Agent SDK；`openai-*` provider 被选为 agent 路由时抛 `UNSUPPORTED_PROTOCOL`（仍可用于 helper 调用）。key 缺失 → `KEY_MISSING`（消息只含 env 名）。

### 3.2 主进程 helper 调用（`resolveHelperCreds` + `anthropicMessages`）

调用方仍构造 Anthropic 形状的 body（`{model, max_tokens, system?, messages}`）。provider 路由下：`model` 被替换为 provider 模型；`defaultParams` 合并在下；openai-chat 转成 `messages`（system 放首条）+ `max_tokens`；openai-responses 转成 `input` + `instructions` + `max_output_tokens`；多模态块目前只保留文本。响应只取文本（thinking / reasoning 块忽略）。返回 `{ok:true,text}` 或 `{ok:false,status?,reason,code?}`，`code ∈ PROVIDER_CREDENTIAL_MISCONFIGURED | RATE_LIMITED | TIMEOUT | NETWORK | BAD_RESPONSE`。gateway 路径与原版逐字一致。

### 3.3 日志与密钥

`logger.ts` 输出 JSON 行到 stderr（`VIDEOCLAW_LOG_LEVEL=debug|info|warn|error|silent`）。两层脱敏：字段名以 key/token/secret/password/authorization/cookie/credential 结尾的字符串值 → `[REDACTED]`；所有从 env 读到的 key 在解析时注册，任何字符串里出现都会被替换；`Bearer xxx` 模式也会被抹掉。错误消息只含 provider 名、env 名、HTTP 状态和错误码，从不回显响应体。`describeProvider()` / `summaries()` 只给出 `configured: true/false`。

## 4. models.dev 同步

### 4.1 数据源（2026-10-21 实测）

- URL：**`https://models.dev/api.json`**（README 还列出 `?type=all`、`models.json`、`catalog.json`、`model-schema.json`，本次未接入）。
- 响应：`application/json`，约 5.9 MB；`etag` 头（Node fetch 拿到的是弱 etag `W/"…"`，因为 gzip）；`cache-control: public, max-age=0, must-revalidate`；**无 `Last-Modified`**；带 `If-None-Match` 返回 **304**。
- 形状：`{ [providerId]: { id, name, env: string[], npm, api?, doc, models: { [modelId]: Model } } }`。Model 主要字段：`id, name, family, type?, status?(deprecated/beta/alpha), attachment, reasoning, reasoning_options?, tool_call, structured_output, temperature, interleaved?, open_weights, knowledge?, release_date, last_updated, modalities{input[],output[]}, limit{context, input?, output}, cost{input, output, cache_read?, cache_write?, reasoning?, input_audio?, output_audio?, tiers?[], context_over_200k?{}}, canonical_model_id?, provider?{npm,api,shape}`。价格单位：**美元 / 百万 token**（models.dev README）。实测全部 9079 个模型的 map key 都等于 `id`；有的 model id 本身含 `/`（如 `cloudflare-ai-gateway` 的 `openai/gpt-5.5-pro`）。

### 4.2 数据库选择：`node:sqlite`

选 Node 内置的 `node:sqlite`（`DatabaseSync`），不选 better-sqlite3：Node 24 与 Electron 42（内置 Node 24.19）都自带，box 上两者都实测可用；**无原生 addon**，不需要 electron-rebuild，也不需要为 win32/darwin/linux × Electron ABI 准备预编译包；esbuild 自动把 `node:*` 外部化。代价：API 仍标为 release candidate 级别，功能比 better-sqlite3 少（够用）。

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
| `llm-ping <provider> [prompt]` | **需 `VIDEOCLAW_LLM_LIVE=1`**；走通用 helper 路径发 1 次真实请求 |
| `llm-model-info <provider> [--db P]` | provider → models.dev 元数据 |
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
| `VIDEOCLAW_LLM_LIVE=1` | 允许 `llm-ping` 发真实请求 |

## 7. 错误码

`LlmProviderError.code`：`CONFIG_INVALID | UNKNOWN_PROVIDER | KEY_MISSING | UNSUPPORTED_PROTOCOL | PROVIDER_CREDENTIAL_MISCONFIGURED | RATE_LIMITED | TIMEOUT | NETWORK | BAD_RESPONSE`；同步错误码见 §4.4。

## 8. 测试

测试框架是仓库已有的 **`node:test`**（`npm test` = esbuild 打包 `test/*.test.ts` → `node --test`），不是 vitest；为避免引入第二套运行器，沿用之。新增：

- `test/llm-providers.test.ts`（15）：配置默认值/严格校验/拒绝密钥字段与鉴权头/preset 合并、providers 文件与降级、3 协议 × 4 种鉴权组合的 URL 与头、env 覆盖、路由归一化、子进程 env（key 穿过 sanitizedAgentEnv、三种鉴权注入方式、UNSUPPORTED_PROTOCOL、KEY_MISSING）、协议转换、mock 端到端（chat+自定义头+配置化 503 重试；responses+bearer+响应体凭据码不重试；500 透传）、并发闸门=2、NETWORK/TIMEOUT、retry-after 封顶、日志脱敏、示例配置可加载、PublicSettings 类型。
- `test/models-dev.test.ts`（10）：fixture（`test/fixtures/models-dev-api.sample.json`，2026-10-21 真实 api.json 裁剪：5 个 provider / 10 个模型，含 tiers、`provider` 覆盖、embedding、deprecated、含 `/` 的 model id）、宽松解析、迁移、幂等 upsert + 剪枝、查找顺序、provider 元数据、304/unchanged/force、离线安全各失败分支、validator 只发给同源 URL、CLI 四个命令。测试不访问网络。
- `test/minimax.test.ts`（已有 10 个，改为断言 preset 行为；Bearer）。
