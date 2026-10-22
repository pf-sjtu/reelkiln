# 27 · Phase B M10：网关 + Codex 合约逆向，以及以 MiniMax 为后端的 Codex 路由

> 状态：2026-10-21（Asia/Singapore，UTC+8）。行号指 `app/reconstructed/main/index.js`（参考代码，只读，未编辑）。
> 约束：不使用任何真实 Claude 官方订阅，也不使用真实 Codex / OpenAI / 上游网关凭据；MiniMax 只读取 box 环境变量 `MINIMAX_API_KEY`（并发 1，单次请求，遇到 429/529 退避）。密钥从不打印、不记录、不提交。

## 1. 逆向得到的合约

### 1.1 Codex harness（原版：`codex app-server --listen stdio://`，codex 0.160.1）

| 部件 | 原版位置 | 合约要点 |
|---|---|---|
| CodexAppServerClient | L23652-24241 | JSON-RPC over stdio。`initialize{clientInfo{name,title,version}}` 之后发 `initialized`；方法有 `account/read`、`model/list`、`thread/start\|resume\|read`、`turn/start\|interrupt`；服务端请求为 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 等；`assertCompatibleServer` 校验 userAgent 中的版本 |
| createCodexRuntime | L24772-25088 | 每个视频一个 app-server 进程。`thread/start` 携带 `{model, cwd, approvalPolicy, sandbox, config}`；`turn/start` 携带 `{input, effort, outputSchema}`；审批走 `decideApproval` → canUseTool |
| codexEventToSdkMessages | L25089 | 把 `item/*`、`turn/*` 通知映射为 SDK 形状的 assistant / tool_use / tool_result / result 消息，交给同一个 consume 循环 |
| CODEX_CONTAINMENT | wb chunk L831-1103 | `{approvalPolicy:"on-request", sandbox:"read-only"}`，同一处还有路由证据账本（route evidence ledger） |
| codexRuntimeGate | L39440 | 网关特性开关 `ui/codex_runtime` |
| createSession 选择 harness | L38755-38800；resolvedAgentHarness / resolvedCodexProvider L324-333 | 新视频的 `agentHarness`、`codexProvider` 取自 settings；llmRoute 只对 claude harness 生效 |
| spawn 的 codex 分支 | L39500-39533 | 先做模型 pin、effort pin、route refusal 检查，然后 `createCodexRuntime` |
| deliver 中的 codex 检查 | L42003-42030；blockCodexRoute L42229 | 发送前执行 `codexRouteRefusal`，被拒时把会话阻塞并写入理由 |
| getHistory 的 codex 分支 | L43729 | 通过 `thread/read` 回放历史 |
| onLlmRouteChanged | L43127 | 跳过 `usesAppLlmRoute === false` 的 runtime（即 codex） |
| setSessionModel | L40895 | codex 会话校验模型是否在已发现的 catalog 中 |
| codexStatus / codexModels | L51256 / L51305（discoverCodexModels L52291） | `{available, authenticated, mode}`；`{ok, models[{id,model,displayName,isDefault,efforts…}], incompatible, runtimeDefault}` |
| codexRouteRefusal / codexModelForSession / setSessionReasoningEffort | L51670 / L51711 / L51735 | 拒绝理由、会话的实际模型、effort ∈ 模型支持的 efforts |
| accountCodexModel / resolveCodexDefaultModel / pinCodexModel / pinCodexReasoningEffort | L51803 / L51818 / L51852 / L51876 | 首次 spawn 时把模型和 effort pin 进会话 meta；之后不一致就拒绝运行，不会静默替换 |
| connect / disconnect | L52371 / L52416 / L52435 | ChatGPT 设备登录；disconnect 前计算受影响视频数（impact） |
| classifyCodexFailure | L53824 | 把错误文本归类为 auth / quota / model / network 等 |
| IPC | L61596-61670、L61784（session:setModel）、L61787（session:setReasoningEffort） | 见第 4 节 |

### 1.2 上游网关（`cfg.gatewayUrl`，Bearer = 网关 key）

| 合约 | 位置 | 用途 |
|---|---|---|
| `GET /v1/me` | L8660/L8680、L28823 | 账号身份、cohort id、余额权限 |
| `GET /v1/config/flags` | L8813 | 特性开关（含 `ui/codex_runtime`） |
| `/v1/studio/channels/*`、`/v1/studio/bundles/{sha}` | L7742、L7505 | studio MCP bundle（request_input 等 studio 工具） |
| `/v1/engine/latest`、`/v1/app/latest`、`/v1/app/updates/*` | L9502、L55940、L2268 | 引擎、应用更新源 |
| `POST /v1/quotes/project`、`/v1/budgets/*`、`/v1/spend-authorities/*` | L28893、L28956、L28919/L28936/L30085 | 报价、预算、花费授权（billing） |
| `POST /v1/model_call`、`/v1/mint_image`、`/v1/mint_video`、`/v1/audio/enhance`、`/v1/media/pull`、`/v1/uploads` | L3592、L18580、L29905、L22590、L28507、L18126、L29093 | 付费生成工具 |
| `{gateway}/anthropic/v1/messages` | resolveHelperCreds L22343-22357 | 辅助 LLM（taste:titles 等）；Claude-gateway 路由 |
| `/v1/token`、`/v1/accounts`、`/v1/account`、`/v1/account/key`、`/v1/account/key/claim` | L54208、L54455、L54626、L54757、L54901 | 登录、建号、mint/claim key |
| `/v1/telemetry/*`、`/v1/feedback*`、`/v1/workflow-submissions*` | L19738-19818、L57422/L57492、L59387-59388 | 遥测、反馈、workflow 提交 |
| memoryBinding | L36456/L36474/L36607 | 项目记忆和 sessionPlan 需要“已验证的账号 + 项目”权限 |
| acquireLibraryGatewayLease | L45713、L62048 | 素材库同步和搜索的租约 |
| quoteGatewayBudget | L19221-19283 | characters:sheetPlan 的报价 |

## 2. 以 MiniMax 为后端的设计（已实现）

```
renderer (原版 UI) ──IPC──> AgentHost.spawnCodex
   └─ codex app-server (真二进制 0.160.1, CODEX_HOME=userData/codex-profile)
        thread config: model_provider=videoclaw_minimax
          base_url=<loopback gate proxy>/v1, env_key=VIDEOCLAW_MINIMAX_GATE_TOKEN (vcgp_ 令牌),
          wire_api="responses", requires_openai_auth=false
   └─ agent-gate-proxy (surface "openai")  ─ providerGate("key:MINIMAX_API_KEY") ─>  https://api.minimaxi.com/v1/responses
```

- **凭据隔离**：codex 进程只能看到每个 runtime 独立的 `vcgp_` 令牌。真实 key 只存在于 proxy 进程内存中，与 Anthropic 路由使用相同的 per-session 隔离方式。
- **并发**：与 Anthropic 路由共用同一个 `providerGate("key:MINIMAX_API_KEY")`。默认并发 1，可用 `MINIMAX_MAX_CONCURRENCY` 调到 2；429/529 退避沿用现有实现。
- **账号**：app 自有的 `codex-profile/config.toml`（带 marker 行，已有的外来 profile 绝不覆盖）使 `account/read` 返回 authenticated，mode 为 `external`。thread config 会覆盖 config.toml 中的 base_url；已验证占位端口 9 从未被使用。
- **模型目录**：通过 gate 调用 MiniMax `GET /v1/models`。efforts 为 low/medium/high，默认 medium；`isDefault` 为配置的模型（默认 `MiniMax-M3.1-Flash`，可用 `MINIMAX_CODEX_MODEL` 覆盖）。目录带 TTL 缓存。
- **结构化输出**：Responses 的 `text.format: json_schema` 被改写成强制调用的函数 `structured_output`，响应（JSON 和 SSE）再改写回 `output_text`。实现在 `structured-emulation-responses.ts`，作用与 Anthropic 路由的结构化模拟相同。
- **路由证据**：`portCodexEvidence` 加入 PORT 证据行，把 MiniMax 上的 chatgpt 和 openai-api 槽位标成 qualified，原版的 qualification 逻辑保持不变。
- **可执行文件**：查找顺序为 `VIDEOCLAW_CODEX_BIN` → `resources/bootstrap/codex/bin/codex` → `vendor/codex/node_modules/@openai/codex-linux-x64/...` → PATH 中的 `codex`。可用 `npm run codex:install` 安装（外部依赖，不重建）。

### 本地网关 / billing shim 设计（未实现，下一轮）
用一个 loopback HTTP 服务模拟网关的 `/v1/me`、`/v1/config/flags`、`/v1/quotes/project`、`/v1/budgets/*`、`/v1/spend-authorities/*`，状态存在本地 ledger：
- 账号固定为 `local-studio`，余额来自本地 spend-budgets；
- 报价用确定性的本地价目表；
- 付费工具（model_call / mint_*）转发到 MiniMax 对应能力，或返回原版的“不可用”分支；
- `/anthropic/v1/messages` 复用现有 Anthropic gate proxy。
- app 侧只需把 `gatewayUrl` 指向 shim，并设置 shim 签发的本地 key。
- 不伪造真实账号，所有响应都标注 `x-videoclaw-port-shim: 1`。

## 3. 偏差（有意，已记录）
1. UI 槽位名仍是原版的 “ChatGPT subscription / ChatGPT plan”，实际后端是 MiniMax。原版 renderer 不可编辑，只能保留文案。
2. `engine:codexConnectChatGpt`、`engine:codexConnectCancel`、`engine:codexDisconnectChatGpt` 是 PORT 替代实现（没有 OpenAI 登录）。
3. PORT 证据行和本地 gate proxy 都不是原版组件。
4. codexRuntimeGate 在原版由网关开关 `ui/codex_runtime` 控制；port 改为“存在 MiniMax key 即启用”。

**尚未移植（NOT PORTED）**：
- codex 的 turnStore 崩溃恢复；
- studio dynamic tools（来自网关 studio bundle）；
- persistContextReceipt；
- OpenAI API key 和 OpenRouter 路由（`engine:saveAgentProviderKey` 仍是 stub）。

## 4. 55 个 (b) 类 channel 的状态与解锁方式

M10 开始时 stub 中有 55 个 (b) 类 channel。本轮新增真实实现 9 个（6 个 real，3 个 PORT 替代 real-partial），剩余 46 个为 stub。另有 3 个 (b) 类 channel 在 docs/26 已是 real-partial，不计入 55，分别是 characters:voices:list、characters:voice:approve、characters:voice:remove。

| # | channel | 原版 L | 状态 | 解锁方式 |
|---|---|---|---|---|
| 1 | engine:codexStatus | 61609 | **real (M10)** | MiniMax-backed app-server 的 account/read |
| 2 | engine:codexModels | 61622 | **real (M10)** | MiniMax /v1/models |
| 3 | engine:agentProviderKeyStatus | 61664 | **real (M10)** | 只返回 key 是否存在 |
| 4 | session:setModel | 61784 | **real (M10)** | codex 分支；claude 分支还需要 claudeModels |
| 5 | session:setReasoningEffort | 61787 | **real (M10)** | codex 分支 |
| 6 | engine:codexDisconnectImpact | 61620 | **real (M10)** | 统计运行中的 codex 视频 |
| 7 | engine:codexConnectChatGpt | 61610 | real-partial 替代 | 无 OpenAI 登录 |
| 8 | engine:codexConnectCancel | 61619 | real-partial 替代 | 无登录流程 |
| 9 | engine:codexDisconnectChatGpt | 61621 | real-partial 替代 | retire runtimes |
| 10 | engine:claudeModels | 61659 | stub | 用 MiniMax 模型目录做 Claude-route 的 catalog（Anthropic 兼容），可直接实现 |
| 11 | engine:claudeCodeStatus | 61603 | stub | 返回“未登录 / 不提供”的原版分支（禁止使用真实订阅） |
| 12-15 | engine:claudeCodeConnect / ConnectCancel / SignOutImpact / SignOut | 61604-61607 | stub | 同上：只实现原版的“不可用”分支，不接入真实 Claude 登录 |
| 16 | engine:continueOnCodex | 61661 | stub | 现在可以实现：route handoff 到 MiniMax-backed codex（新建续作视频） |
| 17 | engine:saveAgentProviderKey | 61665 | stub | 用 safeStorage 存 openai-api/openrouter key；本地没有可验证的提供方，仍需 (b) |
| 18-19 | engine:creditHandoffOffer / continueOnCredits | 61655-61656 | stub | 网关 billing shim |
| 20-21 | gateway:meter / gateway:topup | 61593-61596 | stub | billing shim（/v1/me、budgets） |
| 22 | gateway:verify | 61376 | stub | shim `/v1/me` |
| 23-24 | settings:saveGatewayKey / switchGateway | 61393 / 61377 | stub | shim 签发的本地 key 与本地 gatewayUrl |
| 25-34 | account:refresh / signInGoogle / signInEmail / resendEmail / cancelSignIn / signOut / consent / ensureAccess / mintKey / claimKey | 61407-61574 | stub | shim 的 `/v1/token`、`/v1/accounts`、`/v1/account*`（本地账号，不连真实 OAuth） |
| 35-38 | sessionPlan:read / choose / retry；characters:sheetPlan | 61920-61944；61885 | stub | memoryBinding 需要 shim 提供的账号和项目权限；sheetPlan 需要 shim 的 quotes |
| 39-42 | memory:read / update / undo / openSource | 61955-61970 | stub | memoryBinding（shim 账号） |
| 43 | taste:titles | 61854 | stub | 辅助 LLM：把 resolveHelperCreds 指向 MiniMax Anthropic gate，可直接实现 |
| 44 | characters:sheetBuild | 61888 | stub | 付费图片生成（shim + MiniMax 图片能力） |
| 45-46 | outbox:authoritySnapshot / telemetry:bindReplay | 61709-61710 | stub | shim 遥测端点（本地落盘） |
| 47-48 | library:sync / library:search | 62092 / 62115 | stub | shim 的库租约 |
| 49-50 | feedback:submit / feedback:grantUsageSharing | 62346 / 62350 | stub | shim `/v1/feedback`（本地落盘） |
| 51 | workflowSubmit:start | 62399 | stub | shim `/v1/workflow-submissions` |
| 52-54 | app:update:check / preferences / channel | 61372 / 61330 / 61334 | stub | shim 更新源（Linux 上 updater 本身是 disabled，channel 切换还依赖 darwin，部分属于 c） |
| 55 | media:transcribeVoice | 61911 | stub | 需要登录，并依赖 mac 语音 helper；同时属于 b 和 c |

说明：上表编号 1-55 与 55 个 channel 一一对应（同组的相邻行合并显示）。46 个 stub 的逐行清单以 `python3 tools/stub_audit.py --md` 为准。

## 5. 验证
- `port/tools/codex-turn-proof.ts`：真实运行 codex 0.160.1 + MiniMax，覆盖 medium、high、structured 三种情况。结果见 `artifacts/phase-b-m10/codex-turn-*.json`。
- `port/tools/ui-e2e-m10.mjs`：通过 CDP 操作原版 renderer，覆盖：
  - 选择 Codex harness；
  - Settings 中的模型目录与保存；
  - 新建视频；
  - composer 的模型菜单和 effort 菜单；
  - 一轮真实 turn（包含 provider_command 工具调用）；
  - 重启后的历史回放（thread/read）以及在同一 thread 上的续聊。

  证据见 `artifacts/phase-b-m10/ui-codex-*` 和 `ui-codex-resume-*`。
- `port/test/codex-route.test.ts`（7 个测试）和 `codex-client.test.ts`。

## 6. 风险
- MiniMax Responses 的兼容性（例如 reasoning 项、并行工具调用）只在这里描述的场景中验证过。
- 结构化模拟依赖模型遵守强制函数调用；曾观察到一次 `structuredJsonOk = 0`，原因未查明。
- codex 二进制版本升级后，协议可能漂移；`assertCompatibleServer` 会拒绝不兼容版本。
