# 28 · Phase B M11：本地网关 + billing shim（MiniMax 后端）与账号/计费 channel

> 本轮目标：按 docs/27 §2 实现 loopback 本地网关 + billing shim，并在原版合约允许的范围内，把 account / key / meter / top-up / taste:titles / Claude Code / claudeModels / continueOnCodex 这些 channel 做成真实实现。
> 约束不变：不使用真实 Claude 订阅，也不使用 Codex/OpenAI/网关凭据，所有模型调用都走 MiniMax；MINIMAX_API_KEY 不打印、不写日志、不提交；证据已脱敏。

## 1. 先看原版合约：它在本地网关上会做什么

逆向 `app/reconstructed/main/index.js` 与 `app/out/main/chunks/workbookContents-ChzKjQX1.js` 的结论：

| 原版函数 | 行为 | 对 shim 的含义 |
|---|---|---|
| `envForGatewayUrl`（wb） | gatewayUrl 是 `localhost`/`127.0.0.1` 时返回 `"local"` | shim 地址 `http://127.0.0.1:<port>` → local（UI 右上角显示 “Local” 徽标） |
| `resolveAuthPool`（main L55293 起） | local → staging pool（本构建为 null）→ `unconfigured`；custom → `untrusted-gateway` | **原版从不在本地网关上做托管登录**，也不会请求账号平面（`/v1/token`、`/v1/account*`） |
| `FeatureFlagStore.target`（L8706） | local/custom → 使用内置默认值，不 fetch | 原版不会请求本地网关的 `/v1/config/flags` |
| `verifyKeyAt` / `loadKeyMeter` / `keyMeterFrom`（wb L110） | 只走 `vc_` key 平面：`GET /v1/me` | shim 必须完整提供 `/v1/me` 的 meter 字段 |
| `startTopUp` | 需要 https checkout URL | shim 返回 503，触发原版文案 “Checkout is unavailable right now. Try again in a moment.” |
| `TasteTitleStore` + `resolveHelperCreds` | `llmRoute === "gateway"` 且有 key 时，向 `{gateway}/anthropic/v1/messages` 发一次批量请求（TITLE_MODEL `claude-haiku-4-5-20251001`） | shim 必须提供 `/anthropic/v1/messages` |

所以 shim 的设计原则是：凡是原版在本地网关上会用到的，都真实提供；原版不会碰的部分（账号平面）明确返回 404 “不提供”，不伪造账号。

## 2. 设计

```
原版 renderer ──IPC──> AccountService（verbatim IPC 主体） ── CredentialStore（verbatim，userData/credentials.dat）
                         │  verifyKeyAt / loadKeyMeter / startTopUp / resolveAccountSnapshot（verbatim 生成）
                         ▼
             LocalGatewayShim  http://127.0.0.1:47719（仅 loopback，响应头 x-videoclaw-port-shim: 1）
               ├─ GET  /v1/me                         key meter（ledger 计算）
               ├─ POST /v1/keys/{id}/topup-session    503（无托管 checkout）
               ├─ GET  /v1/config/flags               未签名的空 flags（仅为完整性，原版不调用）
               ├─ POST /v1/quotes/project             本地价目表报价（+20% reserve）
               ├─ GET/PUT /v1/spend-authorities/{job} 记录 per-job 授权（capped/unlimited/per_operation）
               ├─ PUT  /v1/budgets/{job}              记录 per-job 预算上限
               ├─ /v1/token, /v1/account*             404 account-plane-not-offered
               └─ POST /anthropic/v1/messages         额度检查 → providerGate("key:MINIMAX_API_KEY")
                                                       + withMiniMaxRetry → https://api.minimaxi.com/anthropic/v1/messages
                                                       → 按 usage 记账
```

- **启用方式**：设置 `VIDEOCLAW_PORT_LOCAL_GATEWAY=1` 后才启用，默认关闭，以免改变既有 UI e2e 的行为。`VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT` 默认 47719；`VIDEOCLAW_PORT_LOCAL_GATEWAY_MONTH_USD` 默认 5，设为 `none` 表示不设上限。
- **启动流程**（`real-backend.ts`）：
  1. 创建 shim（目录 `userData/local-gateway/`），把 `settings.gatewayUrl` 设为 shim 地址；
  2. 如果 vault 里没有该网关的 key，用 shim 签发一把 `vc_`+40hex 的 key，经 verbatim `CredentialStore.setActiveKey` 存入，并 `registerSecret` 以便日志脱敏；
  3. 启动后执行 `void resolveAccount()`（对应原版启动时的 L60955）。
- **密钥**：ledger 只存 key 的 sha256（即 `/v1/me` 的 `id`，与原版 64-hex cohort id 同形）和 hint，不存明文；鉴权使用 `timingSafeEqual`。MiniMax key 只在 shim 进程内存中，转发时通过 `registerSecret` 脱敏。
- **账号快照**：使用 verbatim `resolveAccountSnapshot`。没有登录记录、有存储的 key、并且有本地 consent 时，`legacyKeyOnly` 为 true，结果是 `step: "ready"`。PORT local-studio 策略（`VIDEOCLAW_PORT_ACCOUNT_GATE != "1"`）提供 `alphaConsentAt = "port-local-studio"`，因为原版的 AlphaConsentCoordinator 尚未移植。
- **verbatim 生成**：新增 4 个生成文件，由 `tools/gen-verbatim.mjs` 生成，`--check` 通过：
  - `account/credential-store.generated.ts`
  - `account/account-gateway.generated.ts`
  - `taste/taste-titles.generated.ts`
  - `agent/claude-routes.generated.ts`
- **Electron safeStorage**：`account/safe-storage.ts` 懒加载；在 node:test 或 Electron 不可用时，退化为 “unavailable”。

### 2.1 与 docs/27 §2 草案的偏差（均为有意）
1. **不再“固定 local-studio 账号 + 余额取自 spend-budgets”**：改为 shim 自己的 ledger（`ledger.json`）。spend-budgets 是 per-video 的授权状态，不是账户余额；混用会破坏原版语义。
2. **账号平面不提供**：`/v1/token`、`/v1/account*` 返回 404。原因见 §1：原版对 local 网关本来就是 `unconfigured`，不会调用这些端点。因此 `account:signInGoogle/...` 走的是原版自己的 pool 拒绝分支，而不是伪造一个已登录账号。
3. **付费工具（mint_image/mint_video/…）不转发**：shim 只给它们报价，不执行生成。原因是 port 的 `agentGatewayProxy` 仍是 501 stub，没有调用方。只有 `model_call`（`/anthropic/v1/messages`）真实转发到 MiniMax。
4. **`/anthropic/v1/messages` 不复用 agent-gate-proxy 进程**：shim 直接用同一个 `providerGate("key:MINIMAX_API_KEY")` 和 `withMiniMaxRetry`，所以并发上限（默认 1）和 429/529 退避与其他 MiniMax 路由共享。
5. **模型映射**：请求中的 `claude-*` 模型 id（如 TITLE_MODEL）映射为配置的 MiniMax 模型（默认 `MiniMax-M3.1-Flash`）；`MiniMax-*` 原样透传。ledger 同时记录请求模型和上游模型。
6. **top-up**：没有托管 checkout，返回 503，走原版 UI 文案。加额度由 owner 在本地调用 `shim.topUp(usd)` 写入 ledger。未提供 IPC/UI 入口（原版 UI 只会打开浏览器 checkout）。
7. **flags**：返回 `signed:false` 的空 flags；原版对 local 网关不 fetch，这一端点只为完整性。

## 3. Ledger 行为

`userData/local-gateway/ledger.json`，schema `videoclaw-port.local-gateway-ledger/v1`，文件权限 0600，写入方式为 tmp+rename 原子写。

| 字段 | 含义 |
|---|---|
| `account` | `{id: acct_local_…, name: "Local studio (self-hosted)"}` |
| `keys[]` | `{id: sha256(key), hint, createdAt, revokedAt?}`（无明文） |
| `limits` | `{monthUsd (默认 5 / null), totalUsd (默认 null)}` |
| `topupBalanceUsd`, `topups[]` | owner 加的额度 |
| `entries[]` | 每次成功（2xx）的 model_call：`usd/inputTokens/outputTokens/model/upstreamModel/pricing/status` |
| `refusals[]` | 因额度不足返回 402 的记录 |
| `spendAuthorities`, `budgets`, `quotes` | per-job 记录；quotes 最多保留 200 条 |
| `pricing` | `port-local-table/v1`：输入 0.3 / 输出 1.2 USD 每百万 token |

- **meter**（`/v1/me`，即 `keyMeterFrom` 的输入）：
  - 本月花费按 UTC 月份统计；
  - `grantRoom = min(month 上限 − 本月花费, total 上限 − 累计花费)`；
  - 超出 grant 的部分由 top-up 余额抵扣；
  - `available = max(0, grantRoom) + 剩余 top-up`；
  - 两个上限都为 null 时 `available = null`（不封顶）；
  - `topup_min/max = 5/500`，`reserved = 0`。
- **额度上限执行**：每次 `/anthropic/v1/messages` 调用前先检查，`available ≤ 0` 时返回 402 `billing_error` 并写入 `refusals`，此时不会请求 MiniMax。调用成功后按 MiniMax 返回的 usage（JSON 或 SSE 的 `message_start` / `message_delta`）记账，即后付费。因此最后一次调用可以把余额打成负的 grant room，之后的调用都会被拒绝。top-up 后恢复（node:test 已覆盖）。
- **报价**：`TOOL_QUOTE_CENTS` 为 model_call 1、mint_image 4、mint_video 50、audio_enhance 2、media_pull 0，其他 5（单位：美分）；另加 `ceil(20%)` reserve。
- **限制**：per-job 的 spend authority 和 budget **只记录、不执行**，因为 `/anthropic/v1/messages` 请求不携带 job id，port 中也没有发送 job 级付费请求的调用方。真正执行的上限只有账户级的 month/total 上限。

## 4. 本轮变为真实（或真实的原版分支）的 channel 及验证方式

图例：**UI** = 在原版 renderer 中经 CDP 真实点击并核对 DOM 与 IPC 日志；**T** = node:test（`port/test/account-gateway.test.ts`，7 个测试）；**L** = 一次真实 MiniMax 调用。

| channel | 分类 | 实现 | 验证 |
|---|---|---|---|
| `account:snapshot` | real（已有，改为真实快照） | verbatim `resolveAccountSnapshot`，key 来自 vault；`storedKeyId` 等于 shim id | UI（“Not signed in — running on your alpha key”，step=ready）+ T |
| `account:refresh` | real | `resolveAccount` | T |
| `gateway:verify` | real | verbatim `verifyKeyAt` → shim `/v1/me` | T |
| `gateway:meter` | real | `loadKeyMeter` / `keyMeterFrom` | UI（“$5.00 available / $0.00 used this month / Monthly grant: $5.00 remaining”；真实花费后显示 “<$0.01 used this month”，与 ledger 一致）+ T |
| `gateway:topup` | real-partial | `startTopUp` → 503 → 原版文案 | UI（Get more credits → $25 → Continue → “Checkout is unavailable right now. Try again in a moment.”）+ T |
| `settings:saveGatewayKey` | real | `applyManualKeyWrite` → `CredentialStore.setActiveKey` → `resolveAccount` | T |
| `settings:switchGateway` | real | `switchGatewayKeys` → `settings.patch` → `verifyKeyAt`（requiresRestart） | T |
| `account:signInGoogle` / `signInEmail` / `consent` / `mintKey` / `claimKey` | real-partial | 原版 IPC 主体 → pool `unconfigured` 拒绝，文案为 “Account sign-in isn’t set up for this [App] environment in this build. Use “I already have an alpha key” instead.” | T |
| `account:resendEmail` / `cancelSignIn` / `ensureAccess` / `signOut` | real-partial | 原版分支：没有等待中的邮件 / 无操作 / “Sign in to [App] first.” / clearSession 但保留 vc_ key（仍为 ready） | T |
| `taste:titles` | real | verbatim `TasteTitleStore`：批量 1 次请求 → shim → MiniMax，结果缓存到 `taste-titles.json` | T + **L**（见下）。**原版 renderer 从不调用 `tasteTitles`**（preload 暴露了，但 assets 中 0 处引用），所以无法做 UI 验证 |
| `engine:claudeCodeStatus` | real-partial | 原版主体；PORT probe 固定为“无 Claude 登录”（USER DIRECTIVE），返回 `{available:false}` | UI（Agent & models 显示 “Click to connect your Claude Code plan”）+ T |
| `engine:claudeCodeConnect` / `ConnectCancel` / `SignOutImpact` / `SignOut` | real-partial | 原版的 single-flight / abort / `usesMacClaudeLogin` 计数 / “could not find a Claude Code sign-in” 分支；connector 拒绝，不启动 `claude auth login` 子进程 | T |
| `engine:claudeModels` | real-partial | 原版 `claudeModels` 算法（TTL 5 min、超时 15 s）+ verbatim partition / evidence；模型来源换成 MiniMax `GET /v1/models` | T（fake 源）。未做真实 MiniMax `/models` 调用 |
| `engine:codexHandoffOffer` | real（原为 fixture） | `codexHandoffOffer`（L52172） | T |
| `engine:continueOnCodex` | real | `continueOnCodex`（L52242）+ `createSession` providerMigration（L38756）：新建 Codex（MiniMax）视频，源视频不动，重复调用幂等 | T |

### 4.1 原版 UI 验证（CDP，真实输入）
脚本为 `port/tools/ui-e2e-m11.mjs`。全新 userData，只预置 `engine-current.json`，指向只读 engine `engine-0.1.57-rc7-15f8f2d`。app 环境中删除了 MINIMAX_API_KEY，所以 UI 阶段不会产生任何模型花费。

- U1（全新 ledger）：`account_identity`、`billing_meter`、`topup_unavailable`、`claude_code_status` 全部 PASS（`artifacts/phase-b-m11/U1-fresh-summary.json`，截图 `U1-fresh-shots/`）。
- L1（app 关闭时，在同一个 ledger 上做一次真实 MiniMax 调用）：`tools/m11-live-titles.ts` 走 verbatim taste:titles → shim → MiniMax。结果：
  - 2 条中文偏好得到标题 “Bold captions, no music” / “Always use my real voice”。注意这两个标题恰好也是原版 system prompt 中的示例，与规则语义一致；
  - 输入 340 / 输出 93 token，记账 $0.000214，上游模型 `MiniMax-M3.1-Flash`，耗时 3.2 s；
  - 第二次调用命中缓存，没有新的 ledger 条目（`L1-live-taste-titles-minimax.json`）。
- U2（重启 app，`--expect-spend`）：meter 显示 spent 0.000214 / available 4.999786，与 ledger 完全一致，DOM 显示 “<$0.01 used this month”。4 步全部 PASS（`U2-after-spend-*`）。原版 renderer 此时还额外显示了 low-credit 提示（“$5.00 remains for new paid generations…”），这是原版 `accountMeterState` 的阈值逻辑，port 没有改动。

## 5. 覆盖率（`python3 tools/ipc_coverage.py`）

| 类别 | M10 结束时 | 本轮（M11） |
|---|---|---|
| real | 94 | **102** |
| real-partial | 12 | **28** |
| stub | 48（46 b + 2 c） | **25（23 b + 2 c）** |
| fixture | 5 | 4 |
| push-real / push-none | 11 / 12 | 13 / 10 |
| local / real-env | 1 / 1 | 1 / 1 |
| 合计 | 184 | 184 |

real + real-partial 合计 130/184，其中 real 为 102/184。push-real 新增的两项是 `account:changed`（真实推送）和 `account:emailSent`（已接线，但在 port 中不可达，因为邮件登录在发送前就被 pool 拒绝）。

### 5.1 上轮剩余 46 个 (b) 的状态
- **本轮完成 23 个**：
  - real 7 个：`account:refresh`、`gateway:verify`、`gateway:meter`、`settings:saveGatewayKey`、`settings:switchGateway`、`taste:titles`、`engine:continueOnCodex`；
  - real-partial 16 个：8 个 sign-in/consent/access/mint/claim/resend/cancel、`account:signOut`、`gateway:topup`、5 个 `claudeCode*`、`engine:claudeModels`。
- **仍为 stub 的 23 个 (b)，以及各自所需条件**：

| channel | 所需条件 |
|---|---|
| `sessionPlan:read/choose/retry`、`memory:read/update/undo/openSource`、`characters:voices:list` / `voice:approve` / `voice:remove`（后三个为 real-partial 的错误分支） | `memoryBinding`（L36456）需要“已验证账号 + 网关 authority”。`projectMemoryIdentity` 已由 AccountService 设置，下一步是把 memoryBinding 接到 local-studio 账号上，并且需要网关 memory API（shim 尚未提供） |
| `characters:sheetPlan` / `sheetBuild` | `quoteGatewayBudget` + mint_image：需要 `agentGatewayProxy`（仍为 501）以及 shim 的付费图像转发（MiniMax image） |
| `outbox:authoritySnapshot`、`telemetry:bindReplay`、`feedback:submit`、`feedback:grantUsageSharing` | 遥测/反馈上传到网关 outbox：可在 shim 中做本地落盘 sink |
| `library:sync` / `library:search` | `acquireLibraryGatewayLease`：需要 shim 的 library lease 与 search |
| `workflowSubmit:start` | 网关 workflow 提交 |
| `engine:creditHandoffOffer` / `continueOnCredits` | 需要 gateway 路由的 agent runtime（`AgentGatewayProxy` 仍为 stub）；shim 已能提供 `/anthropic/v1/messages`，下一步把 gateway route 的 Claude harness 指向 shim |
| `engine:saveAgentProviderKey` | OpenAI / OpenRouter key：USER DIRECTIVE 禁止真实 OpenAI 凭据，只能做存储，不能做验证 |
| `app:update:check` / `preferences` / `channel` | 网关 release feed + nightly 权益 |
| `media:transcribeVoice` | 需要登录，外加 mac-only 的 voice-dictation helper（b + c） |
| (c) `app:update:download` / `install` | 按要求保持现状 |

## 6. 测试与构建
- `npm test`（port/）：**257/257 pass**（基线 250，新增 7 个：`test/account-gateway.test.ts`）。
- `npm run build`（gen-verbatim --check + typecheck + esbuild）：通过；`tsc --noEmit` 干净。
- 其他小改动：
  - `src/main/index.ts` 新增 `VIDEOCLAW_PORT_IPC_LOG_MAX`（默认 300，仅用于证据日志长度）；
  - `tools/stub_audit.py` 新增 done-M11 标注；
  - `tools/ipc_coverage.py` 扫描新文件并加入 PARTIAL 说明。

## 7. 已验证 / 未验证 / 风险

**已验证**
- 原版 UI 经 CDP：账号身份行、Generation credit meter（花费前后各一次，数值与 ledger 一致）、top-up 的 503 原版文案、Claude Code “未连接”状态。
- 一次真实 MiniMax 调用经 shim 完成 taste:titles：已记账、缓存命中、没有重复调用。
- node:test 覆盖：
  - `/v1/me` 字段与 id 的形状；
  - 401/403/404 拒绝；
  - 额度耗尽返回 402 且不请求上游；top-up 后恢复；
  - SSE 和 JSON 两种 usage 的记账；
  - vault 文件为 0600；
  - 账号平面 404；
  - pool 拒绝文案；
  - continueOnCodex 幂等。
- 证据脱敏扫描：22 个文件中 MiniMax key 命中 0 次，完整 `vc_` key 命中 0 次。

**未验证**
- `taste:titles` 无法做 UI 验证，因为原版 renderer 不调用它。
- `engine:claudeModels` 没有做真实 MiniMax `/models` 调用，也没有做 UI 验证（本轮 UI 脚本没有覆盖 Claude 模型菜单）。
- `continueOnCodex` / `codexHandoffOffer` 没有做 UI 验证；也没有在继续后的 Codex 视频上跑真实 turn。
- `settings:saveGatewayKey` / `switchGateway` / `gateway:verify` 只经 node:test 验证，没有在 UI 中粘贴 key。
- quotes / budgets / spend-authorities / flags 端点只经 node:test 验证；port 中没有调用方，原版也不会对 local 网关发起这些请求。

**风险**
- **Linux 上 vault 是明文**：没有 keyring 时 `safeStorage` 不可用，verbatim CredentialStore 在未打包时按原版逻辑写明文 JSON（权限 0600）。原版 UI 文案仍写着 “stores it encrypted in your Mac’s keychain”，与实际不符。shim key 只对 loopback shim 有效，但仍应视为本地凭据。
- per-job 的 spend authority 和 budget 只记录、不执行。
- 后付费记账：最后一次调用可能超出上限，超出量为一次调用的成本。
- 价目表为本地估算（`port-local-table/v1`），不是 MiniMax 官方价格。
- 端口 47719 固定。端口被占用时 shim 启动失败（main.log 会记录 `local gateway shim failed to start`），账号 channel 随后访问一个不存在的 gatewayUrl，走原版的网络错误分支；尚未实现自动换端口。
