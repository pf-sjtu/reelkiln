# docs/29 — M12：剩余 23 个 (b) 类通道 + 按模型计价的 ledger

> 分支 `master`（pf-sjtu/videoclaw-reverse）。提交：`4580b57`（计价）、`a625f0b`（23 个通道接线）、本文档提交（UI e2e 证据、注入缝、`assertGenerationAllowed` L60842、审计/覆盖率脚本）。
> 时间均为 Asia/Singapore（UTC+8）。参考实现 `app/reconstructed/main/index.js` 只读，未改动。
> 约束：没用任何真实 Claude 订阅，也没用 Codex/OpenAI/网关凭据。所有 LLM 流量都走 MiniMax：通用 provider 框架 → gate proxy → M11 本地网关 shim（`VIDEOCLAW_PORT_LOCAL_GATEWAY=1`）。MiniMax 一律单请求、并发 1。

## 1. 计价修正（Task 0，`4580b57`）

M11 的 shim ledger 用的是一张平价表 `port-local-table/v1`（输入 0.3 / 输出 1.2 USD/百万 token），不分模型，cache 命中也按输入价计费。M12 把它换成 `port-per-model/v2`（`port/src/main/gateway/pricing.ts`），按以下顺序取价，先命中者生效：

1. `VIDEOCLAW_PORT_LOCAL_GATEWAY_PRICES`：所有者用 env JSON 覆盖，`"*"` 是默认值。
2. 已同步的 models.dev 目录（`models-dev/db.ts`）：优先取 provider `minimax` 的行，`cost_input/output/cache_read/cache_write`。
3. `MINIMAX_FALLBACK_PRICES`：`MiniMax-M3.1-Flash` 输入 0.15 / 输出 0.6 / cache-read 0.015。
4. 默认模型的价格。未知模型不会被记成 0。

另外两点：

- 每条 ledger entry 都记录当时用的 `pricing{…, source}`，以后改价不会改写历史账目。
- MiniMax 返回的 `cache_read_input_tokens` 在 JSON 和 SSE 两种响应里都会入账，并按 cache-read 价计费。

**样例前后对比**（docs/28 那次真实调用：340 in / 93 out）：

- 旧价：340×0.3/1e6 + 93×1.2/1e6 = **$0.0002136**
- 新价：340×0.15/1e6 + 93×0.6/1e6 = **$0.0001068**

单测 `m12-shim.test.ts › pricing: …` 断言了这个值。

本次 UI e2e（t3）的两条真实记账都来自 `minimax-fallback/2026-10`：

| 调用 | input | output | cache-read | 记账金额 |
|---|---|---|---|---|
| 1 | 121 | 92 | 1105 | **$0.000089925** |
| 2 | 25640 | 6 | 199 | **$0.003852585** |
| **合计** | | | | **$0.00394251** |

## 2. 实现方式

- 新文件 `port/src/main/remaining-channels.ts` 承载 23 个通道。语义从原版逐段移植，并标注原版行号。
  - 能用 gen-verbatim 生成的部分都改成了生成。新增或扩展的生成模块：`project-memory.generated.ts`、`update-check.generated.ts`、`character-sheet.generated.ts`、`session-index.generated.ts`、`account-limit.generated.ts`（wb L1008-1012 / L1652-1685）。
  - `gen-verbatim --check` 是绿的。
- 本地自托管账号的“权威”是 M11 shim 签发的网关 key。
  - `currentProjectMemoryScope()`（L60451）的 `canonicalKeyId` = key 的 sha256（64 hex），满足 ProjectMemoryStore 的要求。
- 付费工具都走原版路径：`AgentGatewayProxy.credentialsForBudgetedTools` → shim `PUT /v1/budgets` → 引擎拿到 scoped capability 后调用。
  - shim 对 `mint_image` / `embed` 回 **422 `TOOL_NOT_OFFERED`**，因为 MiniMax 没有等价能力。之后进入原版自己的失败分支。
- `assertGenerationAllowed` 按 L60842 实现：
  - `currentUpdateInfo.blocked` → "Update Videoclaw before starting new work."
  - `paidWorkBlocked` → `ACCOUNT_BLOCKED_COPY`

## 3. 逐通道结果（23 个）

| 通道 | 结果 | 实现要点 | 验证方式 | 剩余差距 |
|---|---|---|---|---|
| memory:read | **real** | projectMemoryReply L10711 → 原版 ProjectMemoryStore（本地 MEMORY.md），memoryBinding 绑定到已验证的 shim key | **原版 UI/CDP**（打开会话时 renderer 自动调用，`{ok:true,value:{revision:null,entries:[]}}`）+ node:test | — |
| memory:update | **real** | updateProjectMemory L36628（来源校验）→ store.update + push `memory:changed` | node:test | UI 里只能从 studio MCP `project_memory` 产生的“Remembered something”通知进入编辑，该 MCP 未移植，所以 UI 不可达 |
| memory:undo | **real** | undoProjectMemory L36790 | node:test | 同上 |
| memory:openSource | **real** | openProjectMemorySource L10755 → shell.openPath | node:test | 同上 |
| sessionPlan:read | real-partial | sessionPlanReply（gen）+ memoryBinding | **原版 UI/CDP**（自动调用，`{ok:true,value:null}`）+ node:test | 计划只能由 studio MCP `propose_session_plan` 产生（未移植），所以永远是 null |
| sessionPlan:choose | real-partial | + assertPlanGenerationAllowed → 原版 missing-state 回复 | node:test | 同上 |
| sessionPlan:retry | real-partial | 同上 | node:test | 同上 |
| outbox:authoritySnapshot | real-partial | 原版 Outbox.authoritySnapshot | node:test | 只在 shim 开启且网关为 loopback 时存在 outbox |
| telemetry:bindReplay | real-partial | 原版校验 + replayIdsBySession + 持久 session-index 入队（投影为生成代码）→ shim sink | node:test | 没有 PostHog，renderer 不会产生 replay 绑定 |
| feedback:submit | real-partial | FeedbackService.submit → Outbox feedback 通道 → shim `/v1/feedback`，截图走 PUT | **原版 UI/CDP**：Report 弹窗 → 快捷选项 → 文本 → Send，结果 `{queued:true,delivery:"delivered"}`，shim sinks feedback 1 / feedback-screenshot 1，出现 toast“Thanks — report sent” | 投递目标是本地 shim，不是厂商后台 |
| feedback:grantUsageSharing | real-partial | 持久化 consent patch（telemetry + usageSharingConsentAt） | node:test | UI 中 consent 已满足，grant 按钮没出现，**UI 未覆盖** |
| library:sync | real-partial | guardedAppLibrary L62042 + acquireLibraryGatewayLease L45713（index：5000 次 / $5，jobId `library-index-<uuid>`）→ 引擎 → embed 被 422 拒绝 | node:test（真实 shim + proxy；lease 能到达引擎调用；没有 proxy 时走 paid-work-unavailable） | 没有 embedding provider，**实际无法建索引**；未对真实引擎跑过（会在共享只读引擎里触发 `uv run`，为避免改动它而没跑） |
| library:search | real-partial | 同上（search：1 次 / $0.10） | node:test | 同上 |
| engine:creditHandoffOffer | real-partial | host.creditHandoffOffer L51901 | **原版 UI/CDP**：`{available:true,budgetResets:"always-allow"}` | 前置条件（Claude 订阅额度耗尽）只能靠 UI-e2e 注入；spend-authority 判断简化成 isBlocked |
| engine:continueOnCredits | real-partial | continueOnCredits / finishCreditContinuation L52012 → gateway 路由续接会话 | **原版 UI/CDP + 真实 MiniMax 计费轮次**（见 §4） | 同上 |
| engine:saveAgentProviderKey | real-partial | 原版校验 L61665 → CredentialStore.setProviderKey，并 registerSecret | node:test | 只保存。按用户指令，Codex/OpenRouter 实际仍跑 MiniMax，从不使用或校验这个 key |
| workflowSubmit:start | real-partial | WorkflowSubmissionService L59760（顺序：completedAttempt → name → eligibility）→ 原版 not-eligible 分支 | node:test | 没有 account plane 能判定 eligible，collect/归档/PUT 不可达 |
| app:update:check | **real** | 原版 startUpdateCheck → shim `GET /v1/app/latest` | **原版 UI/CDP**：Profile 菜单 → Check for updates → “Videoclaw is up to date (0.0.40-port.0)” | — |
| app:update:preferences | real-partial | 原版 createUpdatePreferences.get | node:test | nightly 不允许（Linux 没有 appUpdater） |
| app:update:channel | real-partial | createUpdatePreferences.set → canSwitch=false → 原版拒绝 | node:test | 同上 |
| characters:sheetPlan | real-partial | 原版 CharacterSheetBuilder.plan：真实引擎 `--dry-run --json` + proxy.quoteProject → shim quote | node:test + **真实引擎脚本** `tools/m12-sheet-proof.ts`：plan ok，3 个付费步骤，报价 $0.12 + 预留 $0.03 = $0.15 | 价格是 shim 报价，不是厂商报价 |
| characters:sheetBuild | real-partial | 原版 build：上传 3 张照片（shim sink），然后 scoped `mint_image` → shim 422 → 原版 failBuild | **真实引擎脚本**：事件依次为 running 1/6 → 2/6 → `phase:"error", failure:"rejected"`，sheet.png 不存在，MiniMax 上游调用 0 次 | 不能真正生成角色表，原因见 §5 |
| media:transcribeVoice | real-partial（原版 unavailable 分支） | 原版会话检查 → VoiceDictation 的 unavailable 分支 | node:test | 依赖 macOS Speech helper（c 类），Linux 上不可移植 |

已知残留：`characters:voices:list / voice:approve / voice:remove` 这 3 个**不在 23 个之内**，仍然是 b_partial_other，返回常量 unavailable 回答。

## 4. 真实 credits 路由轮次（原版 UI，CDP）

这次运行的两个前提：

- 驱动程序是 `port/tools/ui-e2e-m12.mjs`，运行标签 t3，时间 2026-10-21 约 21:38 SGT。
- 应用 env 只保留 `MINIMAX_API_KEY`，删除了 `ANTHROPIC_* / OPENAI_* / OPENROUTER_* / CLAUDE_CODE_*`。

步骤如下：

1. **注入缝（只用于前置条件）**：`claudeLimitInjection(llmRoute, env)`。
   - 只有同时满足 `VIDEOCLAW_PORT_UI_E2E=1`、设置了 `VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT`、路由为 `claude-code` 时才生效。
   - 生效时，spawn 让 SDK query 抛出 `Claude AI usage limit reached|…`，Claude CLI 根本不会启动。
   - 单测断言了这个缝在其他情况下都不生效。
   - 后面的步骤全部是真实代码：原版 modelAccountLimit（生成代码）→ failureEvent。
2. 原版 renderer 显示卡片“Claude usage limit reached.”，带按钮 **Continue this video with VideoClaw credits / Open Claude / Change provider / Retry when ready**（`shots/03-claude-limit-card.png`）。
3. 点击按钮后出现原版 spend 确认框 → “Continue with credits”（`04a-confirm.png`）。
   - 结果：续接会话 `eb799223-…`，`llmRoute:"gateway"`，`continuedFromSessionId` 指向原会话，标题“… · continued”（`04b-continuation.png`）。
4. 在续接会话中发送“只回复：完成 VCE94DO”，回复 **“完成 VCE94DO”**（`05b-answered.png`）。
   - runtime 日志：`llmRoute:"gateway", model:"sonnet", engine:true`。
5. **ledger 入账 2 条 model_call**，upstreamModel `MiniMax-M3.1-Flash`，合计 **$0.00394251**（`ledger-after-run.json`）。
6. 全程 console error 0 个；5 步全部 PASS（`U-m12-harness.log` / `U-m12-summary.json`）。
   - 在 `assertGenerationAllowed` 改动之前的 t2 也全部 PASS，记账 $0.00412401，证据未提交。
   - t3 是最终代码上的复跑。

注意：UI 顶部 chip 显示“$0.05 spent”。这个数是 SDK 结果里的 `totalCostUsd`（0.0526），SDK 按 Claude sonnet 价格自己估算的，**不是实际扣费**。实际扣费以 ledger 为准，见 §7 风险。

## 5. 图像生成决策

原版的角色表是**多参考图、锁定身份的编辑**：`google/nano-banana-2/edit`，三个画面都要以全部照片为参考。

MiniMax `image-01` 的 `subject_reference`：

- 每次请求只接受 **1 张**人物参考图；
- 输出是“基于参考的新生成”，而不是编辑。

这两点在语义上都不等价。所以不做“假装成功”的替代：shim 对 `mint_image` 回 422 `TOOL_NOT_OFFERED`，由原版 `failBuild` / “rejected”分支给出原版文案，并保留照片。

证据：`artifacts/phase-b-m12/node-sheet-proof.json`。shim sinks 为 `upload-ticket 3 / upload 3 / paid-refusal 1`，ledger entries 0，MiniMax 调用 0。

## 6. 覆盖率与 stub_audit

`tools/ipc_coverage.py`，184 个通道：

| 类别 | M11（1ddb244） | M12 |
|---|---|---|
| real | 102 | **107** |
| real-partial | 28 | **46** |
| push-real | 13 | 17 |
| push-none | 10 | 6 |
| fixture | 4 | 4 |
| local / real-env | 1 / 1 | 1 / 1 |
| **stub** | **25** | **2**（`app:update:download / install`，c 类，保持原样） |

`tools/stub_audit.py`：

```
M11: audited 116 (stub now 25): {'a': 56, 'a_done': 56, 'a_todo': 0, 'b': 58, 'b_done': 9,  'b_stub': 23, 'c': 2, 'b_partial_other': 26}
M12: audited 116 (stub now 2):  {'a': 56, 'a_done': 56, 'a_todo': 0, 'b': 58, 'b_done': 55, 'b_stub': 0,  'c': 2, 'b_partial_other': 3}
```

剩下的 push-none：`sessionPlan:changed`（没有计划来源）、`characters:voices:changed`、`app:update:state-changed`、`engine:updated`、`input:request`（studio MCP `request_input`）、`window:state`（macOS）。

## 7. 已验证 / 未验证 / 风险

**已验证**

- 在原版 UI 上通过 CDP 验证：
  - app:update:check
  - feedback:submit
  - memory:read 与 sessionPlan:read（自动调用）
  - engine:creditHandoffOffer
  - engine:continueOnCredits
  - 一次真实的 credits 路由 MiniMax 计费轮次
- 真实引擎验证：characters:sheetPlan 与 sheetBuild，走到原版失败分支，MiniMax 0 次。
- `npm test`：271/271 通过，其中 M12 新增 14 个（`artifacts/phase-b-m12/node-test-m12.txt`）。
- `npm run build`（gen + gen-verbatim --check + typecheck + bundle）通过。
- 证据脱敏检查：MINIMAX_API_KEY 命中 0，`vc_…` 完整 key 命中 0（只出现 hint `vc_434d…18b3` 这种形式），没有 sqlite / mp4。

**未验证**

- 下列通道只有 node:test 覆盖，没有原版 UI 证据：memory:update / undo / openSource、sessionPlan:choose / retry、library:*、workflowSubmit:start、engine:saveAgentProviderKey、app:update:preferences / channel、outbox:authoritySnapshot、telemetry:bindReplay、media:transcribeVoice。
  - 其中多数在原版 UI 里无法触达，需要 studio MCP、macOS 或厂商账号面。
- feedback:grantUsageSharing 在 UI 中没被触发（consent 已满足）。
- library 没对真实引擎跑过。

**风险**

1. Credits 前置条件来自注入，不是真实的 Claude 限额。注入缝只在 UI-e2e env 下生效，单测已断言。
2. spend-authority 简化成 isBlocked。
3. UI 花费 chip 显示的是 SDK 按 Claude 价格估算的 `totalCostUsd`，与 ledger 实际扣费相差约 13 倍，可能误导用户。
4. 更新检查与 outbox 只在本地 shim 开启时存在。
5. 3 个 voice-character 通道仍是常量回答。

## 8. 与 100% 的差距

所有能触达的原版 Linux 功能，现在要么是 real，要么是原版自己的 unavailable / failure 分支，没有残留的 b 类桩。剩下的差距：

1. **studio MCP 工具**未移植：`propose_session_plan`、`project_memory`、`request_input`。这导致会话计划、记忆通知和 input:request 不可达。
2. **图像与 embedding provider**：MiniMax 没有多参考编辑和 embed 能力，角色表和 Library 只能走失败分支。
3. **托管账号面**（workflow 资格、厂商 feedback / telemetry 后台、真实订阅额度）。
4. **macOS 专属**：updater 的 download / install（c 类）、语音听写、窗口状态。
