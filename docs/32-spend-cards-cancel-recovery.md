# 32 — 授权卡片、operation cancel / durable resume、引擎 venv 修复（M15）

> 时间：2026-10-22 00:50–02:00（UTC+8）。本轮**真实 MiniMax 花费 $0**。
> **阻塞说明**：MiniMax Token Plan 的 general 窗口（文本/图像/音频）从 01:15 左右起剩余 **0%**（错误码 **2067**），05:00（UTC+8）才重置，见 `T0-minimax-token-plan-remains.json`（`current_interval_remaining_percent: 0`，`end_time 1792616400000` = 05:00）。这个 key 和 PF 的其他流水线共用，所以 01:20 以后本轮没有再发任何真实的文本、图像或音频调用。凡是需要真实 LLM 或真实 TTS 的项目，都列在 §7「05:00 后待办」里。
> **更新（05:25–05:41 UTC+8）**：§8 的三项待办已用真实 MiniMax 补测，**全部 PASS**，结果见 §10。本次补测真实花费约 **$0.104**。

## 0. 引擎 venv 修复（Task 0）
- **根因**：`engine-0.1.57-rc7-15f8f2d/.venv/bin/python` 原本指向 `/workspace/videoclaw/m13-run/.local/share/uv/python/cpython-3.14.6…`。这是 M13 harness 用 `HOME=<run>` 运行时，uv 装在单次运行 scratch 目录里的 Python。目录被清理后，引擎报 “installed engine cannot start a session”。
- **修复**：
  - 把 symlink 和 `pyvenv.cfg` 的 `home` 改指稳定的 uv 托管 CPython 3.14.6：`/home/box/.local/share/uv/python/cpython-3.14.6-linux-x86_64-gnu`。
  - 旧目录已改名为 `python.unused-m15`。之后 venv 仍能正常 import，说明已经没有残留引用。
  - 引擎的其余文件没有改动。
- **防复发**：所有 `ui-e2e*.mjs` 和 `packaged-smoke.mjs` 都显式传入 `UV_PYTHON_INSTALL_DIR=/home/box/.local/share/uv/python`。这样 `HOME=RUN` 不会再把 uv 的 Python 装进单次运行的目录。
- **engine doctor**：用 app 原版的 doctor argv 和 env 运行（`uv run --project ENGINE python tools/doctor.py --json`，VIDEOCLAW_ENGINE/WORKSPACE/JOBS_DIR，gateway 指向本地 healthz 桩，`vcs_doctor_no_authority`），结果 **ok: true**，10/10 项通过。证据：`T0-engine-venv-repair-doctor.txt`。

## 1. raise / ask_each 原版授权卡片（Task 1）
### 1.1 移植（03463cb）
- authorizeGatewaySpend、spendAdmissionFence、authorizeGatewaySpendAtHead、respondPermission 的 spend 分支、noteSpendApprovalShown、setApprovalSpendCeiling、installSpendPolicy 都按原版逐行移植。
- 卡片文案取自 verbatim 生成的 `spend-approval.generated.ts`。PORT-NEW 的拒绝文案已经删掉。
- 单测在 `m15-spend-approval.test.ts` 中，跑的是真实 shim 和 proxy：
  - ask_each：deny / once / always；
  - raise：deny / allow；
  - 最低上限 $0.02 的校验，以及 SPEND_POLICY_CHANGED。

### 1.2 原版 UI + 真实 CDP 点击（**FAKE-LLM**，`T1-ui-fake-llm/`）
- **标注**：本节的 agent turn 由本地脚本化的 Anthropic/t2a 桩驱动（`port/tools/m15-fake-anthropic-upstream.mjs`，`MINIMAX_BASE_URL=http://127.0.0.1:47999/anthropic`）。桩按提示词返回固定的 tool_use，TTS 字节也是假的。
- **真实的部分**：原版 renderer UI、真实 CDP 鼠标点击和拖放、IPC、AgentHost、verbatim 代理、本地 gateway shim 的 spend authority、quote、permit 和 ledger、真实引擎的 `_model_call.py`，以及 models.dev 计价。
- harness 是 `port/tools/ui-e2e-m15-spend.mjs`。`m15-summary.json` 里写了 `llmUpstream: FAKE-LLM…`，**不能当作真实 LLM 的通过证据**。
- 运行 dry5 的结果是 **allPass=true**：

| 步骤 | 原版 UI 操作 | 结果 |
|---|---|---|
| ask_each_mode | 模式下拉 → Bypass → `.spend-transition-dialog` 点 “Enable Bypass” → Auto | policy 从 unlimited_for_video 变为 **ask_each**（`policy_installed` 日志） |
| ask_each_deny | `.permission-card.money`（“Paid operation / Running a model: up to $0.000956.” / Allow once / Deny / Always allow…）→ 点 **Deny** | decision 为 allowed=false（“Paid work was denied by the user.”），ask_settled 为 denied，**paid 条目 0** |
| ask_each_allow_once | 同一张卡 → 点 **Allow once** | decision 为 once，permit used=true，ledger 记 1 条 paid_tool $0.000956（32 字符，minimax-cn 牌价 × models.dev 汇率），引擎落地 mp3 |
| files_card（Task 4） | request_files → `.input-card .ic-drop` → CDP `Input.dispatchDragEvent` 拖入 png → **Send files** | 文件复制到 `jobs/<job>/refs/m15-ref.png`，settled 为 “1 file added” |
| raise_deny | 预算条 “Change video budget”，把上限设为 used+2¢（3¢）→ 长 TTS quote $0.020378 → `.spend-budget-card`（“Raise spending limit? / raise budget to $0.04? / This would go past the approved $0.03 total.”）→ **Deny** | decision 为 “The spending-limit increase was not approved.”，上限仍是 3¢，paid 条目 0 |
| raise_allow | 同上 → **Raise limit by $0.01** | 上限变为 4¢，ledger 记 1 条 paid_tool $0.020378，chip 显示 `$0.03 / $0.04` |

证据文件：
- `m15-summary.json`
- `cdp-clicks.jsonl`（每次点击的坐标和命中元素）
- `ipc-spend.jsonl`
- `main-spend-events.log`
- `shim-ledger.json`
- `shots/*.png`（14 张）

## 2. operation cancel + durable resume（Task 2，b17e584）
- **shim**：
  - 排队中的调用取消后不收费。
  - MiniMax 视频任务用 `DELETE /v2/video_generation/{id}` 在上游取消；上游拒绝时继续轮询，只收一次费。
  - 已经发出的同步调用标记为 not_cancellable_sync。
  - 重启后按 task_id 恢复轮询，绝不重复提交；排队中的调用记为 never_sent，收费 $0；已发出的同步调用记入 `unsettledExposure`。
- **AgentHost**：移植了原版 requestOperationCancellation 和 collectAcceptedOperations（/v1/model_call 部分）。它定时调用引擎的 `_operations.py --job`，退避间隔为 15s·2^n。
- **fake 模式证明**（`T2-recovery-proof-fake.json`，真实引擎 + 真实 AgentHost + 可被 SIGKILL 的 shim 进程），PASS ×3：
  - engine-kill
  - gateway-kill（resumed_polling）
  - stop-cancel（upstream_cancelled，$0）
- **真实尝试 1**（01:1x UTC+8）：MiniMax 返回 2067，op 记为 failed、$0，collector 正确结算了这一行。**FAIL，不算通过**（`T2-recovery-proof-real-attempt1-quota2067.json`）。
- cancel 端点探测：用假 task id 调用返回 400 “invalid task_id (2013)”，说明端点存在（`T2-minimax-cancel-endpoint-probe.txt`）。

## 3. Codex 路由干净 PASS（Task 3）
- 01:14 的预检因为引擎 venv python 缺失而失败，0 次模型调用，不计入尝试次数（`T3-codex-preflight-engine-python-missing.txt`）。这个问题已经由 §0 修复。
- **尝试 1**（01:15 UTC+8）：报 “high demand”，后来确认是 2067 配额耗尽。**FAIL**（`T3-codex-attempt1-main-excerpt.txt`）。
- 剩余 2 次尝试，都放到 05:00 之后，两次间隔 ≥5 分钟。

## 4. file 卡 / voice 卡（Task 4）
- **file 卡**：见 §1.2 的 files_card，在 FAKE-LLM 下走真实 UI 拖放，PASS。
- **voice 卡（RecorderCard）**：需要麦克风和 `getUserMedia`。xvfb 下没有音频输入设备；用假媒体流（`--use-fake-device-for-media-stream`）注入不是忠实路径，所以**未验证**。

## 5. 覆盖率（刷新）
- ipc_coverage：TOTAL 184，分布为 real 110、real-partial 43、push-real 19、push-none 4、fixture 4、stub 2、local 1、real-env 1。
  - setPermissionMode 的 spend 分支已经移植，但因为 Codex 部分仍是 real-partial。
  - permission:shown 已完成。
- stub_audit：共审计 116 项。a 56/56；b 58 项中 55 项完成、3 项 partial_other；c 2 项。
- 证据：`ipc-coverage.txt`、`stub-audit.txt`。

## 6. 花费
| 项目 | 真实花费 |
|---|---|
| Task 2 真实尝试 1（2067，op failed） | $0 |
| Codex 尝试 1（2067） | $0（上游拒绝） |
| cancel 端点探测（假 id，400） | $0 |
| FAKE-LLM UI 运行 / fake 模式证明 | $0（本地桩） |
| **合计** | **$0**（预算 < $1） |

## 7. 已验证 / 未验证 / 风险
### 已验证
- raise 和 ask_each 卡片的 allow 与 deny，在原版 UI 中用真实点击完成。卡片、IPC、AgentHost 和 shim ledger 都是真的，LLM 是 **FAKE**。
- file 卡的拖放和 Send files（同样是 FAKE-LLM）。
- cancel 和恢复的三种中断场景（fake 上游、真实引擎、真实进程 kill）。
- 引擎 venv 已修复，doctor 通过。
### 未验证
- 真实 LLM 驱动下的授权卡片（需要等 05:00 之后）。
- cancel 和恢复的真实 TTS 尝试（因 2067 失败）。
- Codex 路由的干净 PASS。
- voice 卡（没有麦克风）。
- 用真实排队中的视频任务做上游取消（会占用每周视频配额，没有执行）。
### 风险
- FAKE-LLM 的提示词是严格脚本化的。真实模型可能会在 deny 之后重试、改写文本，或者去调用 search_models。到时用真实模型跑可能需要更明确的提示词（不在 app 里加非原版提示）。
- 共享 key 的配额随时可能被其他流水线耗尽，05:00 后也可能很快再次见底。
- collector 没有移植 busy collector、late-result lines 和 collectorOwned 标记。

## 8. 05:00（UTC+8）后待办（需要真实调用；先用 remains API 确认 general 窗口 > 0）
1. **Task 1 真实 LLM 授权卡片**：`node tools/ui-e2e-m15-spend.mjs --run /tmp/m15ui/real1 --engine ENGINE`（真实 key，不设 MINIMAX_BASE_URL）。范围包括 ask_each 的 deny/allow、raise 的 deny/allow 和 files 卡，预计几美分。
2. **Task 2 真实恢复尝试**（1 次 TTS）：`npx tsx tools/m15-recovery-proof.ts /tmp/m15proof-real --engine ENGINE --mode real`。
3. **Task 3 Codex 干净 PASS**：尝试 2 和 3，用 `ui-e2e-m14-routes.mjs --phase codex`，两次间隔 ≥5 分钟。

## 9. 离 100% 还差
1. 多模态 embedding 后端（library:sync/search）。
2. 不适配的付费工具：mint_video/mint_image/synth_voice 的具名模型路由、preview_session_shot、character_voice、plan_paid_operations。
3. 授权卡片的**真实 LLM** UI 证据（卡片本身已移植，FAKE-LLM 下已通过）。
4. voice 卡（RecorderCard）的 UI 证据（需要麦克风）。
5. 真实 Claude 订阅分支（creditHandoffOffer），目前只能注入。
6. `app:update:download/install`、macOS 语音听写、AlphaConsentCoordinator、`materializeGatewaySpendPolicy` 的完整语义。
7. Codex 路由的干净 UI PASS。
8. cancel 和恢复的真实中断证明；collector 的 busy/late-result/collectorOwned 部分。

## 10. 05:00 后真实调用补测（2026-10-22 05:25–05:41 UTC+8）
> 并发 1，按顺序执行，每项开始前都用 remains API 复查配额（免费接口），快照为 `T*-remains-*.json`。所有运行都显式 `unset MINIMAX_BASE_URL`，即**真实 MiniMax**，没有用本地桩。没有使用 Claude 官方订阅凭据。全程没有遇到 429/529/2067。

### 10.1 配额读数（general 窗口 current_interval_remaining_percent）
| 时间（UTC+8） | 时机 | general | video | 快照 |
|---|---|---|---|---|
| 05:25 | 第 1 项之前 | 100% | 100% | `T1-remains-before-item1.json` |
| 05:35 | 第 1 项 B 段重跑之前 | 99% | 100% | `T1-remains-before-item1-retryB.json` |
| 05:37 | 第 2 项之前 | 99% | 100% | `T2-remains-before-item2.json` |
| 05:38 | 第 3 项（Codex 尝试 2）之前 | 99% | 100% | `T3-remains-before-item3-attempt2.json` |
| 05:40 | 全部结束后 | 99% | 100% | `T9-remains-after-all.json` |

停止阈值为 general < 30%，全程没有触发。

### 10.2 第 1 项：真实 LLM 授权卡片 — **PASS**（全量运行 1 次 + B 段重跑 1 次）
- **运行 1**（`--run /tmp/m15ui/real1`，05:25–05:34，`llmUpstream: REAL MiniMax`）结果 5/6：
  - ask_each_mode：PASS。
  - ask_each_deny：PASS。“Paid operation / Running a model: up to $0.000956.” → Deny，paid 条目 0。
  - ask_each_allow_once：PASS。ledger 记 1 条 paid_tool `minimax/speech-2.8-turbo` $0.000896（30 字符），mp3 时长 3.24s。
  - files_card：PASS。拖入 `m15-ref.png` → Send files，回复 “保存了 1 个文件”。
  - raise_deny：PASS。上限仍为 3¢，paid 条目 0。
  - raise_allow：**FAIL**（`timeout waiting for raise card`）。
- **raise_allow 失败根因**（真实模型行为，不是卡片或 shim 的问题）：在 deny 之后的那一轮，真实模型调用 `call_model` 时把参数名写成了 `input_id`（应为 `model_id`）。工具因参数校验失败而拒绝，没有产生 quote，所以 raise 卡片不会出现。模型随后回复 “模型 ID 不被接受…”。这正是 §7 风险里预计到的“真实模型可能改写参数”。证据：`T1-ui-real-llm/run1-full/`（`err-raise_allow.png`、`main.log`）。
- **运行 2**（`--only B`，`--run /tmp/m15ui/real1b`，05:35–05:37）：harness 和 app **都没有改动**，只重跑了 raise 段。
  - raise_deny：PASS。卡片文案为 “Raise spending limit? / raise budget to $0.04? / This would go past the approved $0.03 total.”，Deny 后上限仍为 3¢，paid 条目 0。
  - raise_allow：PASS。上限 4¢ → 卡片 “raise budget to $0.05?” → **Raise limit by $0.01** → 上限变为 5¢。ledger 记 1 条 paid_tool $0.019601（656 计费字符，quote 上限 $0.020378）。mp3 为 1,164,084 字节，ffprobe 时长 72.6s。chip 显示 `$0.04 / $0.05`。
- **结论**：ask_each deny/allow、raise deny/allow 和 file 卡，都已在**真实 LLM** 驱动下，通过原版 UI 和真实 CDP 点击跑通。raise_allow 的通过证据来自运行 2；运行 1 的那次失败如实保留。
- **观察**：
  - LLM 推理 token 也计入视频预算。bind 轮之后，used 已经是 1–2¢，所以 harness 的 “used+2¢” 上限取法在真实 LLM 下仍然成立。
  - 计价来源：LLM 按 `models.dev:minimax-cn/MiniMax-M3.1-Flash`（输入 $0.1494/MTok，输出 $0.5976/MTok），TTS 按 minimax-cn 牌价 × models.dev 汇率。SDK 估算（如 $0.1139）只记录，不用于计费。
- 证据目录 `T1-ui-real-llm/run1-full/`、`run2-onlyB/`，内容包括：
  - `m15-summary.json`
  - `cdp-log.jsonl`
  - `ipc-spend.jsonl`
  - `main-spend-events.log`
  - `shim-ledger.json`
  - `shots/*.png`
  - `console.log`

### 10.3 第 2 项：真实恢复尝试（单次 TTS）— **PASS**
- 命令：`npx tsx tools/m15-recovery-proof.ts /tmp/m15proof-real --engine ENGINE --mode real`，05:37，耗时约 6s。
- engine-kill 场景：
  - 引擎的 `_model_call.py` 在 `{"phase":"sent","status":"running"}` 时被 **SIGKILL**。
  - shim 端的 operation 仍为 succeeded（$0.003615）。
  - AgentHost collector 只跑 1 轮，`rowsLeft=[]`，取回 `incoming/model-1483ed79….mp3`（197,556 字节）。
  - **paidEntriesAdded=1**（只收一次费），`unsettledExposure=[]`。
  - 事件依次为 operation_remembered → operation_collected（succeeded, complete）→ gateway_reconciled。
- 证据：`T2-recovery-proof-real-attempt2.json`、`.console.log`。尝试 1（2067）见 §2，结论保持 FAIL 不变。

### 10.4 第 3 项：Codex 路由干净 PASS — **PASS（尝试 2，一次通过，没有用到尝试 3）**
- 命令：`node tools/ui-e2e-m14-routes.mjs --phase codex --run /tmp/m15ui/codex3 --engine ENGINE`，05:38–05:40。
- studio_tool_on_route：PASS。`agentHarness=codex-app-server`，`codexProvider=chatgpt`，即 gate proxy → OpenAI 表面 → MiniMax。
  - `provider_dynamic "Use project memory"` 成功。
  - UI 出现 “Remembered something / 片尾统一使用白色字幕”。
  - MEMORY.md 已落盘（onDisk=true）。
  - turn 结果 isError=false，耗时 72.7s。
- usage_display：PASS。proxy 计量 $0.015111（`models.dev:minimax-cn/MiniMax-M3.1-Flash`），chip 显示 `$0.02 spent`，Videoclaw gateway reasoning 行为 $0.02，与期望一致。
- main.log 中没有 429、retry limit 或 high demand。
- **观察（风险）**：真实模型在 Codex 下除了调用 studio 工具，还自行执行了几条 `provider_command`（`ls`、`printenv | grep videoclaw|session`、`printenv | sort`）。
  - 命令输出没有进入日志。
  - 按设计，`codexChildEnv` 只下发 per-runtime 的 `vcgp_` gate token，不下发 MINIMAX_API_KEY；在证据里 grep key 全文和前缀，均为 0 命中。
  - 这属于原版 Codex harness 的固有行为（模型可执行 shell），不在本轮修复范围。
- 证据：`T3-codex-attempt2/`，内容包括：
  - `m14r-summary.json`
  - `cdp-log.jsonl`
  - `main.log`（已去掉 dbus 噪声）
  - `shots/`
  - `console.log`

### 10.5 花费（models.dev 计价，shim ledger / proxy 计量）
| 项目 | 花费 |
|---|---|
| 第 1 项运行 1（21 条：20 条 LLM + 1 条 TTS $0.000896） | $0.045472 |
| 第 1 项运行 2，`--only B`（9 条：8 条 LLM + 1 条 TTS $0.019601） | $0.039693 |
| 第 2 项真实恢复（1 次 TTS） | $0.003615 |
| 第 3 项 Codex 尝试 2（proxy 计量） | $0.015111 |
| **合计** | **≈ $0.1039**（上限 $0.5） |

### 10.6 更新后的状态
- §7「未验证」中的 3 项（真实 LLM 授权卡片、真实 TTS 恢复、Codex 干净 PASS）已转为**已验证**。
- §9 第 3、7 项和第 8 项的“真实中断证明”部分已完成。
- 仍未验证：
  - voice 卡（没有麦克风）；
  - 用真实排队中的视频任务做上游取消；
  - collector 的 busy / late-result / collectorOwned 部分；
  - §9 的其余项。
- 新增风险：真实模型偶尔会写错工具参数名（本轮出现 1 次 `input_id`），所以 UI e2e 用真实 LLM 时会有偶发失败。对此只在 harness 层重跑，不往 app 里加非原版提示。

