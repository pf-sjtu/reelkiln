# 31 — 付费工具平面经 MiniMax（M14）

> 本轮代码提交：`7244341`（AgentGatewayProxy 改为 verbatim 生成 + 引擎 pyc 清理证据）、`e78f059`（付费平面 shim + 真实引擎证明）、`c66d177`（少计根因修复 + 引擎 gateway env + env 清洗 + 复现脚本 + UI harness）、`b64d739`（原版 UI e2e 证据），以及本文所在的收尾提交。
> 证据目录：`artifacts/phase-b-m14/`（已脱敏；不含 mp3/mp4/jpg/sqlite；MINIMAX_API_KEY 命中数 0）。
> 时间均为 UTC+8。

## 0. 引擎 pyc 清理（Task 0）
- 只读引擎 `engine-0.1.57-rc7-15f8f2d` 中，上一轮中断时（2026-10-21 21:34–21:36 UTC+8）写入的 28 个 `.pyc` 已删除，清单见 `engine-pyc-cleanup.txt`（每个文件 birth==mtime 都落在该窗口）。删除后 engine doctor 结果见 `engine-doctor-after-cleanup.json`。
- 本轮所有 harness 都设置 `PYTHONDONTWRITEBYTECODE=1`。真实引擎证明跑完后复查：比清理记录更新的 `.pyc` 数量为 0。
- `tools/__pycache__` 里仍有 8 个 2026-10-20 23:29 的 `.pyc`（`prepare_production`、`_paths`、`job`、`cost` 等）。它们不在本次清理的时间窗口内，来源无法确定（可能是安装时生成的），所以保留未动。

## 1. 契约映射与是否适配（Task 1）

### 1.1 原版付费调用链（关键行号）
| 环节 | 原版位置 | 要点 |
|---|---|---|
| AgentGatewayProxy | L28134-30374 | 现在 port 通过 `gen-verbatim` 原样生成（`agent-gateway-proxy.generated.ts`，2353 行）。handle() 做 operation-context、local admission（prepare → `GET /v1/local-admissions/{id}` → submit），要求 `X-VideoClaw-Operation-Id` |
| 精确报价 | authorizeExactSpend → policy.prepareSpend → quoteSpendOperation | `POST {gw}/v1/spend-authorities/{job}/quote`，content-type `application/vnd.videoclaw.spend-operation`。有效报价要求 `quote_id` 以 `vsq_3.` 开头、`operation_sha256 = sha256("videoclaw-spend-operation/v1\0POST\0"+path+"\0"+body)`、`bound_proven:true`、币种 USD |
| 授权 | agentGatewayPolicy L39649、authorizeGatewaySpendAtHead L45860 | 分支：capped 和 unlimited 走 reserve+commit；raise 弹卡；ask_each 弹卡。decision 为 once 时 `POST …/permits`。新视频默认 unlimited（port agent-host L553） |
| operation recovery | `/v1/me`.operation_recovery | `{schema "videoclaw.operation-recovery/v1", account_fingerprint, environment, accepting, tools}`。gateway_url 是 shim 的 URL，所以资产必须与 shim 同源 |
| 引擎侧 | `tools/_model_call.py` | stdin 为 `{model_slug, input, model_contract?}`。`*_url(s)` 字段里的本地文件先上传，再用 `GET /v1/uploads/{32hex}` 换 read_url。`collect_operation` 下载同源签名的 `/v1/assets/{32hex}?e&sig`（不带 bearer，必须有 content_type），存为 `incoming/model-<id>.<ext>`。record_result 需要 operation_id/project_id/client_job/job_id 和终态 cost_usd |
| studio 工具 | search_models L48906、call_model L49068、get_project_budget L49163、set_video_budget L49229、plan_paid_operations L49298、preview_session_shot L48520、character_voice L48533 | 描述原文由 `tools/gen-studio-paid-tools.mjs` 原样抽取 |

### 1.2 逐工具结论
| 工具 | 是否适配 | 理由 / 实现 |
|---|---|---|
| **search_models** | **适配** | shim 的 `GET /v1/models/search` 返回 MiniMax 目录，共 3 个 slug：`minimax/speech-2.8-turbo`、`minimax/image-01`、`minimax/hailuo-02-i2v-512p`。每个都带 input_schema 和 pricing（`minimax-media.ts`） |
| **call_model** | **适配** | 全链路：studio 工具 → 引擎 `_model_call.py` → verbatim AgentGatewayProxy（admission、精确报价、授权、permit）→ shim `/v1/model_call` → MiniMax 官方媒体 API → 签名资产 → 引擎 collect 落到 `incoming/` → shim ledger 记一条 `paid_tool`（MiniMax 官方 CNY 牌价 × models.dev minimax-cn 汇率 0.1494，可用 `VIDEOCLAW_PORT_CNY_USD` 覆盖） |
| **get_project_budget / set_video_budget** | **适配** | 按原版形状移植。set_video_budget 弹原版 `budget` 权限卡，点允许后调用 setSpendCeiling（respondPermission L44605） |
| plan_paid_operations | 不适配（未注册） | 它为 mint_* 等计划内付费操作做只读估价，依赖网关的计划报价面；这些工具本身都不提供（见下），注册了也只能返回不可用 |
| mint_video / mint_image / synth_voice（引擎命名工具） | **不适配**，保留原版失败分支 | 引擎按原版具名模型路由（视频/图像/声音的上游模型组合、多参考编辑等）发请求。用 MiniMax 顶替就是换了模型，不是忠实复刻。shim 的 operation_recovery.tools 只声明 `model_call`，所以 mint_video 得到原版的 503 "durable recovery is unavailable"；它的报价返回 422 `TOOL_NOT_OFFERED`（单测 `m14-paid-plane.test.ts`） |
| preview_session_shot | 不适配 | 原版描述写明由宿主用 GPT Image 2 把整张 storyboard 生成为一张 sheet（旧计划走 NB2/H3 路由），属于具名模型路由。sessionPlan 的“Show me a preview”按钮和 choose(preview) 已经实测（§3），但预览图本身不会生成 |
| character_voice | 不适配 | 依赖 Characters 里保存的声音（原版声音后端 + rights 流程）。MiniMax 没有对等的已保存声音库，保留原版的 "Saved voices are unavailable" 分支 |

### 1.3 MiniMax 接口与计价
- TTS：`POST /v1/t2a_v2`，返回 hex 编码的 mp3，按 `extra_info.usage_characters` 计费。speech-2.8-turbo 为 ¥2/万字符，中文字符按 2 计。报价上界由 `ttsBilledCharacterBound` 计算。
- 图像：`POST /v1/image_generation`，返回 base64。image-01 为 ¥0.025/张。
- 视频：`POST /v1/video_generation`（first_frame_image 可以是 URL 或 data URL）→ `GET /v1/query/video_generation?task_id`（每 10 s 轮询，最多 180 次）→ `GET /v1/files/retrieve` → download_url。Hailuo-02 I2V 512P：6 s ¥0.6，10 s ¥1.0。
- host 取自 provider baseUrl 的 origin（api.minimaxi.com）。只在 429/529/503 或 status_code 1002/1039 时重试。媒体调用并发为 1（`providerGate(...:media, 1)`）。错误信息里的 key 会被脱敏。

## 2. 真实调用证据与花费
### 2.1 真实引擎证明（`model-call-proof-real.json`，2026-10-21 23:36–23:38 UTC+8）
harness：`port/tools/m14-model-call-proof.ts`。它直接运行**真实已安装引擎**的 `_model_call.py`，经过 verbatim AgentGatewayProxy 和 shim，最后调用真实 MiniMax。key 不进入引擎 env（harness 内有断言）。
| 调用 | 结果 | 报价上界 | 实际计费 | 落地文件 |
|---|---|---|---|---|
| TTS speech-2.8-turbo（31 计费字符） | succeeded, imported | $0.000986 | **$0.000926** | `incoming/model-….mp3`，46 068 B |
| image-01 9:16 | succeeded, imported | $0.003735 | **$0.003735** | `incoming/model-….jpg`，720×1280 |
| Hailuo-02 I2V 512P 6 s（首帧为上面那张图：本地文件 → upload → read_url → 内联） | succeeded, imported | $0.08964 | **$0.08964** | `incoming/model-….mp4`，512×910 |
| 合计 | | | **$0.094301** | job budget：capped $0.5，spent 0.094301，reserved 0，in_flight [] |

fake 模式（`model-call-proof-fake.json`）跑通同样三步，花费 $0。

### 2.2 原版 UI 中的真实付费 agent 流程（`U-m14-*`，r4 全部通过）
harness：`port/tools/ui-e2e-m14.mjs`。原版 renderer、CDP 真实输入，gateway 路由（Claude Agent SDK → shim → MiniMax）。
1. **budget_card**：agent 调 `set_video_budget(0.05)`，原版 `spend-budget-card` 出现（“Set a $0.05 maximum for this video?”），真实点击 “Set $0.05 limit”。spend-budgets 行变为 `policy capped, ceilingCents 5, ceilingApprovalId …`，chip 显示 `$0.01 / $0.05`。
2. **paid_tts**：agent 依次调 `mcp__studio__search_models` 和 `mcp__studio__call_model`，生成 `jobs/<job>/incoming/model-9de8….mp3`（41 460 B，sha256 见 `U-m14-incoming.txt`）。ledger 记一条 `paid_tool`：minimax/speech-2.8-turbo，$0.000717，上界 $0.000777，24 计费字符。此时 chip 为 `$0.02 / $0.05`（该 job 的 ledger 合计 $0.01723，向上取整到分）。走的是 capped 分支（reserve + commit 都在 $0.05 内）。

## 3. 其余 UI 证据（Task 2）
| 项目 | 结果 | 证据 |
|---|---|---|
| sessionPlan “Show me a preview” | PASS：choose(preview) real，按钮变为 “Preview requested”，dispatch 出的 preview turn 被 Stop | `U-m14-shots/02a`、`02b` |
| sessionPlan “Change it” | PASS：打开纠正表单 → 输入 → “Send changes”，choose(change) real，agent 重新提案（revision+1，awaiting-decision） | `03a`、`03b` |
| sessionPlan Retry | PASS：B 视频占用唯一的 turn 槽时点 “Build it”，dispatch 失败，plan 进入 `failed`（“This choice is saved. Retry…”），出现 “Retry”。B 结束后点 Retry，`sessionPlan:retry` real，计划变为 accepted/build，build turn 启动 | `05a`、`07a` |
| sessionPlan Dismiss | PASS：新提案 → “Dismiss plan”，choose(dismiss) real，返回 `dismissed:true`。落盘为原版标记 `dismissedSessionPlan = "<id>:<rev>"`（L36248），不写在 plan 上 | `08a`、`08b` |
| memory Edit | PASS：agent 用 project_memory save 保存一条以 TTS 文件为 file source 的笔记 → 点 “Edit” → 改写文字 → “Save note”，`memory:update` real，MEMORY.md 已更新 | `09a`–`09c` |
| memory openSource | PASS：点 source 按钮 “配音样例”，`memory:openSource` real，返回 `available:true`（sha256 校验通过），主进程实际打开的就是该 mp3（UI_E2E 下记录为 `[smoke] openPath …`） | `09d` |
| Codex 路由的 studio 工具 | 见 §3.1 | |
| provider 路由的 gate-proxy 用量显示 | 见 §3.1 | |
| voice 卡 / file 卡 | **不可达，未验证**：voice 卡需要 character_voice 或 voiceover 生产流程（不适配）；本轮没有触发原版 file 卡的生产路径 | — |

失败分支的 Retry 是用 port 的单 turn 并发闸门触发的（原版没有这道闸门）。Retry 按钮和 retrySessionPlan 的逻辑本身是原版的。

### 3.1 非 gateway 路由（`ui-e2e-m14-routes.mjs`）
两条路由各最多 2 次尝试，尝试之间退避 ≥45–90 s。共用的 MiniMax key 同时被其他流水线使用，这是 429 的来源。

| 路由 | 尝试 | 结果 | 证据 |
|---|---|---|---|
| **provider**（`SMOKE_LLM_ROUTE=minimax`，claude-code harness → gate proxy → MiniMax） | prov1（2026-10-22 00:37 UTC+8） | **PASS（2/2）**：`studio_tool_on_route`：agent 调用 `mcp__studio__project_memory` save “片尾统一使用白色字幕”，UI 出现 “Remembered something”。`usage_display`：最后一次计量 `meter:"proxy"`，价格来源 `models.dev:minimax-cn/MiniMax-M3.1-Flash`，totalUsd 0.008377843。push 的 `totalCostUsd`、result 事件 cost 和计量值三者相等；breakdown 的 “[App] gateway reasoning $0.01” 等于 total.toFixed(2)；chip 显示 “$0.01 spent”。SDK 自报估算 0.2854（按 Anthropic 价目）被 proxy 计量取代 | `U-m14-provider-*` |
| **Codex**（`agentHarness=codex-app-server`，`codexProvider=chatgpt` → gate proxy openai surface → MiniMax） | attempt1 codex4（00:41） | **FAIL**：前 3 次 `provider_dynamic`（“Use project memory”）里，第 1 次 isError，后 2 次 ok，但 save 没有落盘。turn 以 `exceeded retry limit, last status: 429 Too Many Requests` 结束。proxy 计量 0.006711099（models.dev），chip/breakdown $0.01 | `U-m14-codex-attempt1-*` |
| | attempt2 codex5（00:51） | **FAIL**：模型没有调用 studio 工具，而是用 `provider_command` 在 shell 里查找 project_memory；最后同样以 429 retry limit 结束。proxy 计量 0.005819742 | `U-m14-codex-attempt2-*` |

**结论：Codex 路由的 studio 工具和用量显示在本轮的正式 harness 下“未验证”，原因是共享 key 429（第 2 次还叠加了模型行为不稳定）。**
补充佐证（不算 PASS）：本轮更早的 codex1 运行（00:18 UTC+8，当时的 harness 判定还是旧逻辑，判为失败）中，`provider_dynamic {"summary":"Use project memory"}` 成功，UI 出现 notice，MEMORY.md 落盘 “片尾统一使用白色字幕”（`U-m14-codex-early-MEMORY-excerpt.txt`）。同一次运行里，proxy 计量 0.008106128（models.dev），breakdown 显示 “[App] gateway reasoning $0.01”，chip 显示 “$0.01 spent / $0.01 in progress · paid work allowed”（`U-m14-codex-early-*`）。所以链路本身是通的，缺的是一次在当前 harness 下的干净 PASS。

provider 路由的 breakdown 行在原版里叫 “[App] gateway reasoning”，而 provider 路由的成本来自 gate proxy 计量。这个行名沿用了原版文案，是已知的文案偏差，不影响数值。

## 4. SDK 少计：根因与修复（Task 3）
### 4.1 复现（`port/tools/m14-undercount-repro.ts`，真实 SDK 0.3.305 原生 CLI → shim → MiniMax）
在 shim 和 MiniMax 之间记录每个上游请求（不记 header），与 SDK result 的 `modelUsage`、shim ledger 三方对比：
| 场景 | ledger 调用数 | SDK modelUsage 输入/输出 | ledger 输入/输出 | 差额来源 |
|---|---|---|---|---|
| `mid3`：第 3 次调用流式进行中按 Stop | 4 | 3665 / 281 | 6658 / 400 | 正在流式的那次调用（2993 in / 119 out）：CLI 中止读取，从不计入；shim 继续读完上游，MiniMax 照常计费 |
| `tool3`：第 4 次调用流式中按 Stop | 5 | 3944 / 479 | 5117 / 556 | 同上（1173 / 77） |
| `i3`：工具执行中按 Stop | 5 | 3818 / 415 | 4999 / 501 | 同上：Stop 时有一次调用还在流式中 |
| **`auto`：不中断，permissionMode auto（新视频的默认值）** | 7 | 5155 / 578 | **35 562** / 640 | **auto 模式的安全分类器**（system 为 “You are a security monitor for autonomous AI coding agents”）带完整 transcript 的旁路调用：30 407 in，cache miss。它**不进 result 的 modelUsage**。差额 = 35562 − 5155 = 30407，完全吻合 |

UI 实测的佐证：r2 中 B 视频一次没有中断的 turn，SDK 计量 $0.00217，ledger $0.00801。差额 $0.005834 恰好是一次 33 860-token 的 cache-miss 调用加一次小调用，trueUp 记录为 0.005834176。

### 4.2 根因
1. **auto 模式分类器调用**：Claude Code 在 auto 权限模式下为工具调用做旁路安全分类，这些调用由上游计费，但 SDK 的 `modelUsage`/`total_cost_usd` 不包含它们。r4 之类长 turn 每次工具调用都可能触发一次，而且 transcript 越长越贵，这是 docs/30 §3.4 里 $0.0526 对 $0.109 大幅少计的主因。
2. **Stop 时在途的那次调用**：CLI 放弃读取，不计 usage；上游已经生成，按完整调用计费。
原版同样如此：原版 gateway 路由的 “[App] gateway reasoning” 来自 SDK `total_cost_usd`，chip 来自网关 ledger。两者的偏差是原版固有的，port 的 true-up 属于 PORT-NEW。

### 4.3 修复
- **shim**（`local-gateway-shim.ts`）：调用一旦发往上游，即使客户端已离开也读完整个流（只有完整的流才带有让 ledger 精确的 usage），并记录 `drained a call whose client left`。客户端在**排队中**离开的调用不发往 MiniMax，不计费。`GET /v1/spend-authorities/{job}` 新增 `llm_in_flight`（PORT-NEW）。
- **gate proxy**（provider / Codex 路由，`agent-gate-proxy.ts`）：原来客户端断开就 abort 上游，在途调用的 usage 丢失。现在排队中断开的才 abort；已发出的调用读完流并计量（`agent_proxy.drained_after_disconnect`）。这两条路由的计量来源本来就是 gate proxy 看到的每个上游回复，分类器这类旁路调用同样经过 proxy，所以不受 SDK 少计影响。
- **host**（`agent-host.ts settleSpendAfterStop`）：Stop 之后，provider/Codex 路由等 proxy `inflight==0` 再重新计量一次；gateway 路由等 shim `llm_in_flight==0` 再做一次 `reconcileGatewaySpend`，即 docs/30 的 ledger true-up。上限 80×1.5 s，尽力而为。
- 单测：`llm-agent-sdk.test.ts`（排队中断开不发出；在途断开仍读完并计量）、`m14-paid-plane.test.ts`（shim 读完、在途数、排队中离开不计费）、`agent-host.test.ts`（Stop 后先等在途清零，再 reconcile 或重新计量）。

### 4.4 长 turn 中断的真实复现（UI，r4 `stop_settles_spend`）
Retry 之后 build turn 运行约 100 s，在模型生成时按 Stop（2026-10-22 00:17:05 UTC+8）：
- shim 读完了离开的调用：`49 in / 42 out` 和 `2966 in / 329 out`
- `gateway_reconciled`：ledgerSpent 0.01372 → 0.014999，SDK meteredJobUsd 0.007414，trueUp 0.006306
- `settled_after_stop` 时 totalUsd **0.014999 = ledger LLM 部分 0.014999338**（差 < 1e-6）。这次 turn 结束时 SDK 自己的计量只有 $0.008022

## 5. 其他修复
- **引擎会话缺 `VIDEOCLAW_GATEWAY_URL`**：原版启动时调用 `configureEngineGatewaySession`（L9356，L60937），之后每个引擎会话都通过 `configuredGatewayEnv`（L9372）拿到 gateway URL。port 的 sessionEnvDeps 没有接上这一步，结果 UI 里 search_models 报 “not connected to the model gateway”（r1）。已在 `real-backend.ts` 接上。
- **`sanitizedAgentEnv`**：盒子的沙箱变量 `__CURSOR_SANDBOX_ENV_RESTORE` 名字看起来无害，值里却带着 MiniMax key，能绕过按名字过滤。现在凡是值里包含任一密钥类变量值（≥16 字符、非路径）的变量一律丢弃（单测已覆盖）。harness 也会删除 `__CURSOR_SANDBOX*`。

## 6. 覆盖率（刷新）
- ipc_coverage：TOTAL 184，real 110、real-partial 43、push-real 19、push-none 4、fixture 4、stub 2、local 1、real-env 1（`ipc-coverage.txt`），与 docs/30 相同。分类表没有变化：`sessionPlan:choose` 仍是 real-partial，因为 preview 分支的图片生成（preview_session_shot）不适配。本轮新增的 UI 实证属于证据层，不改变分类。
- stub_audit：audited 116；a 56/56；b 58（done 55、partial_other 3、stub 0）；c 2（`stub-audit.txt`）。
- 测试：`npm test` **291/291**（本轮净增 8 个：新增 9，改写 1）；`npm run build`（gen + typecheck + bundle）通过。

## 7. 花费（本轮真实 MiniMax）
全部按 MiniMax 实际请求计价：媒体按 CNY 列表价 × 0.1494；LLM 按 models.dev minimax-cn 价目。shim ledger 和 proxy 计量互不重叠。

| 来源 | USD |
|---|---|
| call_model 真实证明（TTS + 图像 + 视频，`model-call-proof-real.json` totalPaidUsd） | 0.094301 |
| 原版 UI gateway 路由 r1–r4 shim ledger（LLM 0.131347 + paid_tool TTS 0.000717×3）+ undercount 复现脚本 4 次（≈0.009658） | 0.143226 |
| 路由 harness proxy 计量：codex1 0.008106 + codex3 0.005540 + codex4 0.006711 + prov1 0.008378 + codex5 0.005820（codex2 全程 429，无计量记录，按 ≈0 计） | 0.034555 |
| **合计** | **≈ $0.272**（预算约 $2） |

误差说明：codex2 如果有未计量的成功调用，量级在 $0.01 以内；Stop 时 drain 的调用已经包含在 ledger 里。

## 8. 已验证 / 未验证 / 风险
### 已验证
- call_model 全链路（verbatim 代理 → shim → MiniMax 三种媒体 → 引擎落地 → ledger），包括真实引擎和原版 UI 中的真实 agent turn
- set_video_budget 卡片、capped 分支、chip
- plan 的 preview / Change it / Retry / Dismiss
- memory 的 Edit / openSource
- 少计的两个根因均已复现；修复在 UI 中的长中断 turn 上验证（显示值 = ledger）
- provider 路由：studio 工具（project_memory save + notice），以及 gate-proxy 用量显示（models.dev 计量 = push totalCostUsd = result cost = breakdown 行）
### 未验证
- **Codex 路由**的 studio 工具与用量显示：本轮正式 harness 跑了 2 次，均失败于共享 key 429（只有更早一次旧判定的运行有实质佐证，见 §3.1）
- voice 卡、file 卡（不可达）
- raise 和 ask_each 两个授权分支：port 用 PORT-NEW 文案拒绝，没有原版卡片
- 视频与图像的 call_model 只在真实引擎 harness 里跑过，没有在 UI agent turn 中跑（为了控制花费）
- `plan_paid_operations`
- shim 的 operation cancel 只返回 view，不真正取消
- 自动模式分类器旁路调用在 provider/Codex 路由上的计量只有单测与原理推断，没有在 UI 上单独构造
### 风险
- MiniMax 牌价是手工录入的 CNY 价格 × 0.1494 汇率。官方调价或按国际价计费时会有偏差。
- 在途调用读完流会让 Stop 无法省下剩余生成的费用。这是为了让计量精确而做的取舍。
- 共享 key 下 MiniMax 频繁 429：Codex 路由的 UI 运行（codex2–codex5）多次因 “exceeded retry limit, 429” 中断。
- Retry 失败分支依赖 port 特有的单 turn 闸门来触发。

## 9. 离 100% 还差
1. **多模态 embedding 后端**（library:sync/search）：未变。
2. **不适配的付费工具**：mint_video/mint_image/synth_voice 的具名模型路由、preview_session_shot（GPT Image 2 sheet）、character_voice（已保存声音）、plan_paid_operations。忠实复刻需要原版对应的上游。
3. **授权卡片分支**：raise / ask_each 的原版卡片（目前是 PORT-NEW 拒绝）。
4. **voice 卡 / file 卡**的 UI 证据。
5. **真实 Claude 订阅分支**（creditHandoffOffer）：只能注入。
6. `app:update:download/install`、macOS 语音听写、AlphaConsentCoordinator、`materializeGatewaySpendPolicy` 的完整语义。
7. Codex 路由在 key 不被限流时的一次干净 UI PASS（studio 工具 + 用量显示）。
8. shim 的 operation cancel 与 durable resume（`resume_original`）的真实中断恢复。
