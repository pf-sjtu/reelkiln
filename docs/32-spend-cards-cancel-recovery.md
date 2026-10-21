# 32 — 授权卡片、operation cancel / durable resume、引擎 venv 修复（M15）

> 时间：2026-10-22 00:50–02:00（UTC+8）。本轮**真实 MiniMax 花费 $0**。
> **阻塞说明**：MiniMax Token Plan 的 general 窗口（文本/图像/音频）从 01:15 左右起剩余 **0%**（错误码 **2067**），05:00（UTC+8）才重置，见 `T0-minimax-token-plan-remains.json`（`current_interval_remaining_percent: 0`，`end_time 1792616400000` = 05:00）。这个 key 和 PF 的其他流水线共用，所以 01:20 以后本轮没有再发任何真实的文本、图像或音频调用。凡是需要真实 LLM 或真实 TTS 的项目，都列在 §7「05:00 后待办」里。

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
