# 30 · M13：Studio MCP 工具、Embeddings 决策、models.dev 计价的 spend

> 代码提交：`85d44c6`（studio MCP / session plan / project_memory / input / models.dev 计价主体）+ 本文所在的收尾提交（gateway ledger true-up、UI e2e harness、证据、本文）。
> 引擎：只读 `engine-0.1.57-rc7-15f8f2d`（harness `--engine` 指向，不修改）。所有 LLM 调用走 MiniMax（`MiniMax-M3.1-Flash`），并发 1、短 turn。
> 证据目录：`artifacts/phase-b-m13/`（已脱敏；`MINIMAX_API_KEY` 命中数 0；无 mp4 / sqlite / 凭据）。

## 1. Studio MCP 移植（行号均指 `app/reconstructed/main/index.js`）

### 1.1 注册方式
- `makeStudioToolset`（原版 L48166-49500）→ `port/src/main/studio/studio-toolset.ts`。工具名、描述、输入 schema 来自原版（verbatim 常量在 `studio-tools.generated.ts`，切片 L3419-3791 / L3859-3985 等，由 `tools/gen-verbatim.mjs` 生成）。
- Claude Agent SDK 路由：`spawnLocal` L39564 → `makeStudioToolset(meta, engineEnv).server`，用已加载 SDK 自己的 `createSdkMcpServer`/`tool` 构建，`alwaysLoad: true`；在 query options 里作为 `mcpServers: { studio }`（L23280）挂上（`agent-host.ts` L947-948、L1199）。
- Codex 路由：`makeCodexToolset`（L49503-49640）→ `dynamicTools` + `callDynamicTool`（`spawnLocal` L39507；`agent-host.ts` L1015-1016），只路由 studio 名称。

### 1.2 已移植的工具（handler → host 方法）
| 工具 | 原版行 | 说明 |
|---|---|---|
| propose_session_plan | L48526 | → `callSessionPlan` L37207 / `proposeSessionPlan` L37256 |
| project_memory | L48555 | → 本地 MEMORY.md（`userData/memory/<sha>/projects/<sha>/MEMORY.md`） |
| save_account_preference | L48561 | |
| read_workbook / read_pdf | L48567 / L48611 | |
| get_workflow / search_workflows / workflow_advisor | L48642 / L48709 / L48741 | 原版“未固定 Studio Bundle”分支 |
| request_rights_confirmation / request_voiceover / request_files | L49348 / L49380 / L49445 | → `requestInput` L48142，回答走 `respondInput` L44689 |

### 1.3 未注册的工具（都依赖付费 gateway 模型平面，MiniMax shim 拒绝）
`preview_session_shot`、`character_voice`、`quickstart_reference`、`search_models`、`call_model`、`get_project_budget`、`set_video_budget`、`plan_paid_operations`；Codex 专有的 `import_generated_image` / `write_video_project_files` / `execute_videoclaw_command`。

### 1.4 Session-plan 生命周期（`port/src/main/studio/session-plan-host.ts`）
`restoredSessionPlan` L36986、`sessionPlanBinding` L37001、`readSessionPlan` L37031、`persistSessionPlan` L37066、`emitSessionPlan` L37106、`chooseSessionPlan` L37410、`retrySessionPlan` L37442、`dispatchSessionPlan` L37500、`sessionPlanProductionRefusal` L38138、`sessionPlanBuildAccepted` L38170、`sessionPlanTurnContext` L38254，以及 writeRegistry 里的 plan 投影（L36240-36249）。schema、决策、投影、恢复都是 verbatim 代码。

## 2. Embeddings 决策：**不接 embo-01，shim 继续回 422**

结论：契约不匹配，embo-01 不能接入。证据见 `artifacts/phase-b-m13/embeddings-contract.json` 和 `embo01-probe.json`。

引擎侧契约（只读引擎）：
- `tools/_media/embedder.py` `GatewayEmbedder._run`（L266-278）：`gateway.run("embed", mode=video|image|text, params={dims, task_type, input|mime_type}, references=[path])`，取 `res["output"]["embeddings"][0]`。`DEFAULT_DIMENSIONS = 768`（L26）。
- `tools/index_media.py`：library:sync 只对**视频分段**（L211 `embed_video_chunk`）和**静态图**（L282 `embed_image`）做 embed。index 里只有视频/图像向量。
- library:search 用文本 query（L401 `embed_query`）或图像 query（L413 `embed_image_query`），和这些视频/图像向量放在同一个多模态空间（gemini-embedding-2）里比较。

MiniMax embo-01：probe 返回 HTTP 200、1536 维。但它**只接受文本**（`texts[]` + `type: db|query`），维度固定 1536，没有 output_dimensionality 参数。

不匹配点：
1. **模态**：sync 必须 embed 视频和图片，embo-01 一个文档向量都产不出来。
2. **向量空间**：search 是拿文本 query 去查视频/图像向量，纯文本空间答不了这个问题。
3. **维度**：引擎要 768，embo-01 固定给 1536。它不是 Matryoshka 模型，截断不是有效投影。

已否决的替代方案：
- 先用 LLM 给每张图/每段视频写 caption，再 embed caption。这是另一种检索契约，排序语义会变，而且要求 M3.1-Flash 有视觉能力。
- 1536→768 截断或补零。

因此 **library:sync / library:search 仍是 real-partial**：scoped gateway lease 是真的，embed 被 422 `TOOL_NOT_OFFERED`（`not_submitted`）拒绝，不扣费。**这次没有跑 library 搜索命中证明**，因为没有忠实的 embedding 后端，没有可证明的东西。

## 3. 价格来源链与 spend

### 3.1 价格解析顺序（`port/src/main/gateway/pricing.ts` `priceTable` L100）
同一个解析器（`real-backend.ts` L454 `sharedPrice`）同时用于两处：local gateway shim 的 ledger（`LocalGatewayShim({ price: sharedPrice })`），以及 AgentHost 每条路由的显示 spend（`meteredRuntimeCost` L2070）。对每个模型，按顺序第一个命中的生效：
1. `VIDEOCLAW_PORT_LOCAL_GATEWAY_PRICES`：owner 覆盖（env JSON）。本次未设置。
2. **models.dev 目录**：app 启动时同步（`syncModelsDevIfStale`，`real-backend.ts` L458；超过 24h 或从未同步才拉 `https://models.dev/api.json`），存到 `~/.videoclaw-port/models-dev.sqlite`。只读取**实际被调用的 MiniMax provider** 那一行：`minimaxModelsDevProviders`（L71）把 `api.minimaxi.com` 映射为 `["minimax-cn", "minimax"]`。读的字段是 `cost_input / cost_output / cost_cache_read / cost_cache_write`。reseller 行和 $0 的 `*-coding-plan` 行永远不参与计价。
3. `MINIMAX_FALLBACK_PRICES`（`minimax-fallback/2026-10`：0.15 / 0.6 / cacheRead 0.015），文档化的兜底。
4. 默认模型的价格：未知模型不会被当作免费。

单次调用成本（`costUsd` L39，Anthropic usage 语义，input 不含 cache）：`(input·in + cacheRead·cacheRead$ + cacheWrite·(cacheWrite$ ?? in) + output·out) / 1e6`。

### 3.2 models.dev 确实提供了 MiniMax-M3.1-Flash 的价格（已验证）
`artifacts/phase-b-m13/models-dev-minimax-row.json`（本次 run 启动时同步的 sqlite）：

| provider | in | out | cacheRead | cacheWrite |
|---|---|---|---|---|
| **minimax-cn（实际使用）** | 0.1494 | 0.5976 | 0.0149 | 无 |
| minimax | 0.15 | 0.6 | 0.015 | 无 |
| minimax-coding-plan / minimax-cn-coding-plan | 0 | 0 | 0 | 0（不参与计价） |

models.dev 没有给 M3.1-Flash 提供 cache-write 价格，按公式回落到 input 价。MiniMax 本次也没有报告 cache-write token。

### 3.3 使用了哪个价格来源（日志）
`U-m13-main-structured.log`：
- `[port] models.dev catalog updated: 232 providers / 9168 models`（先于第一次计价）
- `[port] pricing: MiniMax-M3.1-Flash priced from models.dev:minimax-cn/MiniMax-M3.1-Flash (USD/MTok in 0.1494 out 0.5976 cacheRead 0.0149 cacheWrite -)`
- 每条 ledger entry 自带 `pricing.source`。本次 10 条全部是 `models.dev:minimax-cn/MiniMax-M3.1-Flash`（`U-m13-ledger.json`）。
- 每次 result 写一条 `agent.spend.metered` 日志：`priceSources` 为同一来源，`sdkEstimateUsd` 只记录、不使用。

### 3.4 gateway 路由：ledger 为准（本次新增，PORT-NEW）
在中断执行者的 r4 run 里（85d44c6 + WIP），Build-it turn 被中断，跑了 242 s。SDK result 的累计 `modelUsage` 计量为 $0.0526，同一 job 的 ledger（同一 models.dev 价）却是 $0.109：被中断的 turn 有已经发往上游、已计费的调用没有计进 modelUsage。于是 chip（来自 ledger）显示 $0.11，而 `meta.totalCostUsd`（“[App] gateway reasoning”那一行的数据来源）停在 $0.05。

修复：`AgentHost.trueUpGatewayReasoning`（`agent-host.ts` L2135），在 `reconcileGatewaySpend`（L2150，原版 L48078）之后调用。把本 session 当前 job 的显示值抬到 `max(metered, ledger)`。它是幂等的，只应用与上次 true-up 的差值，所以 modelUsage 之后追上来也不会重复计数。别的 job 的 ledger 不影响本 session。单测见 `agent-host.test.ts`“gateway route — the job's ledger … trues up”。

### 3.5 spend 前后对比（`artifacts/phase-b-m13/spend-before-after.json`）
| | chip | gateway reasoning 行 | ledger（models.dev 价） | SDK 估算 |
|---|---|---|---|---|
| M12 之前（d2ce307） | **$0.05 spent**（SDK `total_cost_usd` 0.0526，按 Claude sonnet 估算） | 同左 | $0.00394，价格来源是 `minimax-fallback`，不是 models.dev | 0.0526 |
| M13 r4（无 true-up） | $0.11 | $0.0526（metered） | $0.109 | 0.529 |
| **M13 r6（本次，最终代码）** | **$0.02 spent** | **$0.01** | **$0.012075942** | 0.1354（只记录） |

r6 的详细数据：
- `meta.totalCostUsd = 0.012076`，与 ledger 之差 < 1e-6。
- 4 次 result 时 metered 与 ledger 的对比（`perResult`）：0.006554845 = 0.006554845（完全相等）；0.007548131 vs 0.007547976；0.010595033 vs 0.010595009；0.012075941 vs 0.012075942。差值 ≤ 1.6e-7。
- chip 和 breakdown 数字不同，是原版自己的显示规则，两个数来自同一个 ledger 值：
  - chip 是 spend 预算的 `spentUsd`：`reconcileGatewayLedger` 把 ledger 的 `spent_usd` 用原版 `toCents` **向上取整到分**，$0.01208 → $0.02。
  - breakdown 的“[App] gateway reasoning”是 `meta.totalCostUsd.toFixed(2)`，$0.01208 → $0.01。
- SDK 的 Claude 估算 $0.135 不再出现在任何显示位置。

## 4. 原版 renderer 上的 UI 证明（CDP，真实鼠标/键盘输入，真实短 MiniMax turn）
harness：`port/tools/ui-e2e-m13.mjs`。新 userData，gateway 路由（Claude Agent SDK → local shim `/anthropic` → MiniMax）。page eval 只读 DOM/几何，**从不调用 `window.videoclaw`**。

结果：r6 四步全部 PASS，console error 0（`U-m13-summary.json`、`U-m13-harness.log`、`U-m13-shots/`）。

1. **plan**
   - 输入要求只调用 `propose_session_plan` → push `sessionPlan:changed`（phase `awaiting-decision`, rev 1）→ 原版 plan 卡出现，按钮 Show me a preview / Change it / Build it（`01a-plan-card.png`）。
   - **真实点击 Build it** → `sessionPlan:choose` 到达真实 handler（`real: true`），结果 phase `accepted`，registry decision `build`。
   - agent 按选择继续：dispatched 的 Build-it turn 第一个动作是 `Bash uv run … prepare_production.py`（`01c-proceeding.png`）。随后真实点击 Stop，不做媒体生产。
2. **memory**
   - agent 调用 `project_memory`（save）→ 原版 notice “Remembered something / 本项目的视频统一使用青色色调。/ Edit / Undo”（`02a`）。
   - 磁盘上 MEMORY.md 有这条 entry → **真实点击 Undo** → `memory:undo` 真实 handler，返回 `entries: []` → 显示 “Remembered, then forgotten”（`02b`）。
   - 磁盘上 MEMORY.md 的 `forgottenIds` 记下了该 id，entry 已移除（`U-m13-MEMORY-after-undo.md`）。
3. **input**
   - agent 调用 `request_rights_confirmation` → push `input:request`（kind rights）→ 原版 rights 卡（`03a`）。
   - 真实勾选 checkbox，点击 “Confirm and continue” → `input:respond`（`{kind:"rights", accepted:true}`，real）→ `ask_settled` outcome `answered`。
   - 工具结果回到 agent，回复 “true VCQ9L32”（`03b`）。
4. **spend**：chip “$0.02 spent” 等于按 ledger 取整到分的预期值。**真实点击 chip** 打开 breakdown，“[App] gateway reasoning $0.01” 等于 ledger `toFixed(2)`（`04-spend-chip.png`、`04b-spend-breakdown.png`）。ledger 10 条，全部 `models.dev:minimax-cn/…`，`untaggedEntries` 0。

## 5. 覆盖率（`tools/ipc_coverage.py` / `tools/stub_audit.py`，见 `ipc_coverage.txt` / `stub_audit.txt`）
| 类别 | M12（d2ce307） | M13 |
|---|---|---|
| real | 107 | **110** |
| real-partial | 46 | **43** |
| push-real | 17 | **19** |
| push-none | 6 | **4** |
| fixture / local / real-env | 4 / 1 / 1 | 4 / 1 / 1 |
| stub | 2 | 2（`app:update:download / install`，c 类） |

变化：
- `sessionPlan:read`、`sessionPlan:retry`、`input:respond` 升为 real。
- `sessionPlan:choose` 仍为 real-partial：preview 分支要用 `preview_session_shot`，这个工具没有移植。
- `sessionPlan:changed`、`input:request` 升为 push-real。

stub_audit：audited 116，a 56/56 完成，b 58（done 55、partial_other 3、stub 0），c 2。

## 6. 验证状态

### 已验证
- `npm test`：**283/283 pass**；`npm run build`（gen + typecheck + bundle）通过（`node-test-m13.txt`）。
- §4 的四步 UI 证明（原版 renderer、真实输入、真实 MiniMax turn），r6 全部 PASS。
- models.dev 确实提供了 MiniMax-M3.1-Flash 价格，ledger 和显示 spend 都用这一行（minimax-cn），来源写入日志和每条 ledger entry。
- embo-01 与引擎 embed 契约不匹配（逐条见 §2）。

### 未验证
- Codex 路由上的 studio dynamicTools 没有在 UI 里跑真实 turn，只有 node:test。
- `sessionPlan:retry`、Change it / Show me a preview / dismiss、`memory:update` / `openSource`、`request_voiceover` / `request_files` 卡只有 node:test，没有 UI 证据。
- true-up 在 r6 只被轻微触发：只有 spend-authority 6 位小数带来的 5e-8 差。r4 那种大差额的场景只有单测覆盖，修复后没有重跑长时间中断的 turn。
- r4 里 SDK `modelUsage` 少计的确切原因没有定位（推测是中断时已经计费的调用没有进入累计 usage）。
- provider / Codex 路由的 gate-proxy 计量（UsageMeter）只有单测，本次没有在 UI 上验证显示值。
- library:sync / search 没有搜索命中证明（§2，没有可用后端）。

### 风险
- minimax-cn 行（0.1494/0.5976/0.0149）和 minimax 行（0.15/0.6/0.015）略有不同。端点 api.minimaxi.com 对应 minimax-cn，但 models.dev 给 minimax-cn 标注的 API 是 api.minimax.cn。如果 MiniMax 实际按国际价计费，会有约 0.4% 的偏差。
- chip 的“取整到分向上”是原版行为。在小额花费下，chip（$0.02）会和 breakdown（$0.01）不一致，这是原版 UI 的特性，不是 port 引入的。
- models.dev 同步失败时，计价回落到 `minimax-fallback`。日志里能看出来，但 UI 上没有提示。
- 中断执行者在 21:34-21:36（UTC+8）运行引擎工具时，在只读引擎的 `tools/__pycache__` 和 `.venv` 里写入了 28 个 `.pyc` 文件。本次没有删除（不改动引擎）。harness 已加 `PYTHONDONTWRITEBYTECODE=1`，防止再次发生。
- Build-it turn 会真的开始生产（调用引擎工具），只靠 harness 及时点 Stop 来控制成本。

## 7. 离 100% 还差
1. **多模态 embedding 后端**：library:sync/search 需要一个能 embed 视频和图像、并和文本 query 同空间的 provider（原版是 gemini-embedding-2，768 维）。MiniMax 没有。
2. **付费工具平面**：preview_session_shot、call_model / search_models、character_voice、mint_image 多参考编辑、mint_video 等。shim 都按原版失败分支 422，所以 `sessionPlan:choose` 的 preview 分支、角色表、预算类工具（get_project_budget / set_video_budget / plan_paid_operations）都不完整。
3. **Codex 路由 studio 工具的 UI 实证**，以及 provider 路由 gate-proxy 计量的 UI 实证。
4. **其余 UI 证据**：retry / Change it / dismiss、memory Edit / openSource、voiceover / files 卡。
5. **真实 Claude 订阅分支**（creditHandoffOffer 的前提条件）：用户指令是不使用真实订阅，只能注入。
6. `app:update:download / install`（c 类 stub）、macOS 语音听写（`media:discardVoice`、`attachment:voiceNote`）、AlphaConsentCoordinator、`materializeGatewaySpendPolicy`。
7. 中断 turn 的 SDK usage 少计：根因待查。目前靠 ledger true-up 兜底，只覆盖 gateway 路由。
