# 26 · Phase B M9：a 类本地通道收尾（36/37）+ 原版 UI 真输入验证 + 会话续接（resume）上下文连续性

日期：2026-10-21（Asia/Singapore，UTC+8）。基线：`d7203d9`（M9 通道实现 + node:test）。本轮不使用任何 Claude / Codex / Videoclaw gateway 凭据；唯一 LLM 路由仍是 PORT-NEW 的 MiniMax provider 路由（`MINIMAX_API_KEY` 只在 box 环境变量中，并发 1、单请求；未打印、未写日志、未提交——`artifacts/phase-b-m9/` 命中数 **0**；无 mp4 / sqlite）。`app/out`、`app/reconstructed` 只作参照，未改动。

## 0. 一览

| 项 | 结果 |
|---|---|
| a 类本地通道 | docs/25 留下的 37 个 a 待做中 **36 个已实现**（33 个仍属 a + 3 个 `characters:voice*` 改判为 b，按原版 `ProjectMemoryError` 分支实现为 real-partial）；**1 个未做：`characters:sheetPlan`**（改判 b，原因见 §1） |
| 审计 | `python3 tools/stub_audit.py`：116 → a **56（全部 done，a_todo 0）**、b **58**、c **2**；未归类 0，"done 却仍是 stub" 0 |
| IPC 覆盖 | real **88** / real-partial **9** / stub **57**（b 55 + c 2）/ 合计 184（§5） |
| 原版 UI 真输入验证 | `local` 阶段 **15/15 PASS**、`retry` 阶段 **3/3 PASS**（MiniMax）；两次独立重跑结果一致（L1/L2、R1/R2） |
| 会话续接上下文 | **PASS（暗号证据）**：第 1 回合说暗号 `蓝色松鼠-4729` → 进程完全退出 → 新进程从侧栏重开该视频 → 第 2 回合问暗号 → 助手回答 `蓝色松鼠-4729`；同一 `sdkSessionId`、`resumed:true`、无新 transcript 文件（§4） |
| 本轮修复 | 续接 UI 运行中发现：当前回合的用户气泡被渲染两次。原因：port 给 composer 回合的 SDK 消息用 `randomUUID()`，原版用 `composerTurnMessageUuid(clientTurnId)`（L23073）。已改为原版行为（`afe1686`），复跑后不再重复 |
| 测试 / 构建 | `npm test` **243/243**（d7203d9 为 241；+1 uuid 回归测试、+1 未覆盖通道的 handler 接线测试）；`npm run build`（gen + verbatim 新鲜度 + tsc + bundle）绿 |

## 1. 36/37：实现了什么、哪个没做

docs/25 结尾的 37 个 a 待做通道，本轮（`d7203d9`）处理结果：

* **实现为 real（28）**：`quickstart:start`、`session:deletionPlan`、`session:delete`、`session:startContinuation`、`project:seedPack`、`characters:sheetStates`、`characters:retry`、`job:originalContext`、`job:adopt`、`spend:get`、`spend:setCeiling`、`library:stats/scan/addSource/removeSource/preview/setTenant`、`bootstrap:revertEngine`、`attachment:pasteImage/captureMoment/momentPreview/preview`、`materials:preview`、`hfPreview:start/stop/editApply`、`account:localResetPrepare/localResetCommit`。
* **实现为 real-partial（8）**：`session:retry`（失败输入重放；Claude 条款恢复分支属 b）、`input:respond`（pendingInputs 来自未移植的 studio MCP 请求工具）、`media:discardVoice`、`attachment:voiceNote`、`feedback:capture`（本地取证；提交属 b）、以及 3 个 `characters:voices:list / voice:approve / voice:remove`——原版 `voiceResult → characterVoiceContext → memoryBinding`（L36456）要求已验证的 Videoclaw 账号，port 逐字给出原版的 `ProjectMemoryError` 分支，**审计改判为 b**。
* **未做（1）：`characters:sheetPlan`**。原版 `plan()` 先做 engine dry-run，**再** `quoteGatewayBudget`（L19290）；没有 `agentGatewayProxy` 时原版自己返回 `status:error "couldn't confirm the price"`，`mint_image` 特性开关也由 gateway 下发。它没有可独立成立的本地部分，**改判 b**，保持 stub。

## 2. 每个通道的验证方式

验证口径：**UI** = 原版渲染器（`app/out/renderer`）由真实 CDP 输入事件驱动（鼠标 / 键盘 / 拦截后的真实拖拽 / OS 文件拖放 / X 剪贴板 + Ctrl+V），页面内只做只读 DOM 查询（唯一的副作用是把目标元素 `scrollIntoView` 以便点击），**从不调用 `window.videoclaw`**；主进程侧以磁盘状态（sessions.json、spend-budgets.json、taste 文件、job 目录、回收站）+ `VIDEOCLAW_PORT_IPC_LOG`（主进程每个 invoke 一行脱敏记录：通道、是否 real handler、ok/错误、参数/结果摘要）判定。**node:test** = 只在单元/集成测试中按原版语义验证。

### 2.1 M9 的 36 个通道

| 通道 | 验证 | UI 证据（步骤 → 判定依据） |
|---|---|---|
| `materials:preview` | **UI** | 重开视频后素材行自动加载预览（MaterialArrival）：16 次调用全部 ok/real；粘贴图片后新素材 `Pasted image….png` 的预览（retry 阶段） |
| `spend:get` / `spend:setCeiling` | **UI** | VideoStrip "Set production budget" → 输入 4.5 → Enter；spend-budgets.json `policy=capped ceilingCents=450`，条带显示 `$4.50` |
| `hfPreview:start` / `editApply` / `stop` | **UI** | 输出面板 "Fine-tune (HyperFrames)" → 编辑器就绪 → 改文本 "M9 新标题" → Apply → 组合 `index.html` 被改写 → 关闭（stop 调用 1 次）。截图 `03c-hf-applied.png` |
| `feedback:capture`（real-partial） | **UI** | "Report a problem" → 对话框 → Esc；capture 返回 `canSend:false, consentRequired:true, blockedRoute:true`（提交属 b），随后 `feedback:discard` |
| `project:seedPack` | **UI** | Create project → StarterFlow "Set up" → 输入 brief → Continue；`taste/packs/<client>/README.md` 写入 brief |
| `characters:sheetStates` | **UI**（只读） | 打开 Characters 面板时渲染器自行调用，ok |
| `session:deletionPlan` / `session:delete` | **UI** | ① 草稿视频：行 ⋯ → Delete video… → 计划 `items:[] exact:true` → Delete，sessions.json 中移除；② **拥有 job 的视频**：计划文案 "The chat and this video's own files go to the trash for 7 days…" → Delete → `{"ok":true,"trashedBytes":77548751,"retentionDays":7}`，job 目录移入 `<workspace>/.videoclaw-trash` |
| `session:startContinuation` | **UI** | 已定稿视频 → "Start New Video" → 新会话 `… · continued` 接管 jobId，源会话 `jobId=null, priorJobId` 保留，`continuation.sessionId` 指向新会话 |
| `attachment:pasteImage` / `attachment:preview` | **UI**（MiniMax 阶段） | xclip 把真实 PNG 放进 X 剪贴板（TARGETS 含 image/png）→ composer Ctrl+V → `Pasted image 0c0471.png` 入库 → 发送 |
| `session:retry`（real-partial） | **UI**（MiniMax） | `VIDEOCLAW_PORT_TURN_TIMEOUT_MS=6000` 强制首回合超时 → 失败卡 "Retry" → 点击 → `session:retry`=true，`agent.turn.retried resent=1`，第二次 `agent.turn.delivered resumed:true`（同 sdkSessionId）；R2 中重试回合正常完成（`result isError:false`，助手回复 "收到"，SDK transcript 中该用户消息只出现一次） |
| `quickstart:start` | **UI（部分）** | Quickstarts → 打开 starter → "Try this template" → 原版启动路径创建视频（`meta.quickstart.activationId`、`starterId=starter.founder-camera-story`、`quickstart:mark destination_ready`）。**但首回合未发出**：本地 fixture 目录的核心文件是 `image/svg+xml`，`extensionFor()` 命名为 `.bin`，逐字移植的 composer intake 拒收 `.bin`（`vc-warm-open.bin:failed`），会话状态为 error。这与原版代码路径一致，但"从 Quickstart 一路跑到首回合"**未验证** |
| `characters:voices:list` | node:test（行为） | 原版 UI 路径本身要求已验证账号（b）；测试确认返回原版的账号不可用分支 |
| `characters:voice:approve` / `voice:remove` | node:test（仅 handler 接线，`8e072ef`） | 同上 |
| `characters:retry` | node:test（仅 handler 接线） | 需要一次失败的角色图构建（付费生成，b）；store.retry 本身是逐字切片，没有独立行为测试 |
| `job:originalContext` / `job:adopt` | node:test（行为） | harness 未构造"孤儿 job / 继续视频的原始上下文"界面状态 |
| `input:respond`（real-partial） | node:test（仅 handler 接线） | pendingInputs 来自未移植的 studio MCP 请求工具，UI 中不会出现对应卡片；host 端只记日志 |
| `media:discardVoice`（real-partial） | node:test（仅 handler 接线） | 需要麦克风录音，Xvfb 下无音频输入；host 端为空操作（无 dictation 助手） |
| `attachment:voiceNote`（real-partial） | node:test（只测了拒收非法 recordingId） | 需要麦克风录音；ffmpeg 转码的正常路径**没有测试** |
| `attachment:captureMoment` / `momentPreview` | **无专门测试**（仅构建 / 类型检查 + 逐字切片新鲜度） | harness 未驱动"播放中截取时刻"控件；**这两个通道目前没有任何运行时验证** |
| `library:stats/addSource/removeSource/preview/setTenant` | node:test（行为，engine CLI 为假实现） | harness 未覆盖 Library 界面 |
| `library:scan` | node:test（仅 handler 接线：租户守卫 + engine 错误） | 同上 |
| `bootstrap:revertEngine` | node:test（行为） | 需要存在上一版 engine 才有回退入口 |
| `account:localResetPrepare` / `localResetCommit` | node:test（行为） | 破坏性（清本地数据并重启应用），未在 UI 中驱动 |

合计：**UI 16**（其中 `quickstart:start` 只验证到创建视频这一段）、**node:test-only 20**——其中有行为测试 11 个、只有 handler 接线测试 6 个、只测了拒收路径 1 个（voiceNote）、**没有任何运行时验证 2 个**（captureMoment / momentPreview）。d7203d9 时这 20 个里有 8 个完全没有测试，本轮补了 6 个的接线测试。

### 2.2 docs/25 中"只有 node:test"的 M8 通道，本轮转为 UI 验证

| 通道 | UI 证据 |
|---|---|
| `session:reorder` | **真实拖拽**：`Input.setInterceptDrags` 拦截，页面自己的 dragstart 填 DataTransfer（MIME `application/x-videoclaw-video`），再在目标行上半部 dragEnter→dragOver→drop；侧栏 `[Draft, Draft, M8 重命名…] → [M8 重命名…, Draft, Draft]`，sessions.json sidebarOrder 0/1/2 |
| `client:reorder` | 真实拖拽（MIME `application/x-videoclaw-project`）：`[Personal, M8 项目, M9 拖拽] → [Personal, M9 拖拽, M8 项目]` |
| `client:remove` | 项目 ⋯ → Delete project → Remove；sessions.json 中项目消失 |
| `session:setPermissionMode`（real-partial） | 草稿视频 composer 的模式 `<select>`，键盘选择：`auto → acceptEdits`，磁盘与 DOM 一致 |
| `taste:list` / `taste:commit` | 项目 ⋯ → Edit project → 添加规则 "M9：片头不要超过两秒" → Save；`{"committed":true,"filesUpdated":1}`，规则写入项目 taste README |
| `characters:list` / `characters:create` / `characters:discard` | Characters 面板 → 名字 + **OS 文件拖放**三张 PNG → Create（pending 角色）→ 删除 → 原版对 pending 角色调用 `characters:discard`（=true） |
| `quickstart:previewed` / `quickstart:mark` / `quickstart:impression` | 画廊 → 切换分类（mark `category_switch`）→ 打开 starter（previewed）；impression 本次两轮均被调用（原版是 best-effort：已加载的目录被重新加载时 afterPaint 可能被取消，L32033） |

仍只有 node:test 的 M8 通道：`taste:decline`、`characters:approve`、`characters:delete`（pending 角色在 UI 中走 discard）、`stats:stageEtas`、`bootstrap:revealSetupLog`、`file:openExternal`、`media:requestMic`、`analytics:playbackCompleted`、`permission:shown`、`quit:rendererState`（后两者是 send 通道，IPC 证据日志只记录 invoke）。`session:rename`、`client:rename`、`session:history` 在 docs/25 已于 AppImage 真 UI 验证。

## 3. UI 验证运行记录

复现：

```
cd port && npm run build
node tools/ui-e2e-m9.mjs --phase local   --run /workspace/m9b/L2 --prepare-from /workspace/m8/A1 --port 9371
node tools/ui-e2e-m9.mjs --phase retry   --run /workspace/m9b/R2 --prepare-from /workspace/m8/A1 --port 9372
node tools/ui-e2e-m9.mjs --phase resume1 --run /workspace/m9b/RV --prepare-from /workspace/m8/A1 --port 9373
node tools/ui-e2e-m9.mjs --phase resume2 --run /workspace/m9b/RV --port 9373        # 新进程
tools/collect_m9.sh /workspace/m9b/RV resume2 RV-resume2 --sdk-transcript
```

`--prepare-from` 复制 docs/25 的 AppImage 完整 S1 运行（已定稿视频，源目录不被修改）。`local` 阶段从子进程环境中删除 `MINIMAX_API_KEY`，物理上不可能访问 MiniMax。

| 运行 | 阶段 | 结果 | console error | 备注 |
|---|---|---|---|---|
| L1 | local | 15/15 PASS | 0 | 修复前构建 |
| **L2** | local | **15/15 PASS** | 2 | 修复后构建；2 个错误见下 |
| R1 | retry | 3/3 PASS | 0 | 修复前构建；重试回合仍被 6 s 超时截断 |
| **R2** | retry | **3/3 PASS** | 0 | 修复后构建；重试回合完成（"收到"） |
| RU | resume1+2 | PASS / PASS | 0 | 修复前：当前回合用户气泡重复（截图 `RU-before-fix-resume2-shots/31-resume2-answered.png`） |
| **RV** | resume1+2 | **PASS / PASS** | 0 | 修复后：不重复（`RV-resume2-shots/31-resume2-answered.png`） |

L2 的 2 个 console error：删除"拥有 job 的活动视频"后，渲染器对已删除的会话又调用了一次 `job:get` / `session:history`，得到 `Unknown session`。原版这两个 handler 同样走 `mustGet` 抛同样的错误（L43698、L45621），是渲染器侧的时序竞争（L1 同一步骤为 0），**不是 port 偏差**，记为风险。

MiniMax 花费：retry 两轮各约 3 次请求（含标题生成），resume 三组各 2 个回合 + 标题，单请求串行。另有前任执行者遗留的、被中断的 `/workspace/m9/*` 运行（未纳入证据）。

证据（`artifacts/phase-b-m9/`，路径脱敏为 `<RUN>` / `<SOURCE_RUN>` / `<ENGINE_HOME>` / `<REPO>`）：`L2-local-*`、`R2-retry-*`、`RV-resume1-*`、`RV-resume2-*`、`RU-before-fix-resume2-*`；每组含 `summary.json`（逐步判定）、`ipc.jsonl`、`cdp-log.jsonl`（每次点击的选择器/坐标/元素）、`events.jsonl`、`main-structured.log`、`sessions.json`、`shots/*.png`；续接组另含 `sdk-transcript.jsonl`（只保留 user/assistant 行的类型、uuid、sessionId、时间戳与文本尾部，系统提示和请求 blob 已丢弃）。

## 4. 会话续接（resume）上下文连续性：判定 PASS

流程（RV）：

1. **resume1（进程 #1）**：侧栏 Personal "New video" → composer 输入 `请记住这个暗号：蓝色松鼠-4729。现在只回复"好的"，不要调用任何工具，也不要写任何文件。` → Enter。会话 `1cf66a56-…`；主进程 `agent.turn.delivered resumed:false sdkSessionId:null`；SDK 记录 `sdkSessionId=43622a60-ff91-4f4b-a4cd-5635f98f1cc9`；助手回答 "好的"。应用经 `Browser.close` 正常退出。
2. **resume2（进程 #2，全新启动，无内存状态）**：从侧栏点该视频行重新打开（`session:history` 回放第 1 回合）→ 输入 `我在上一条消息里让你记住的暗号是什么？只回复暗号本身，不要调用任何工具。` → Enter。

判定（`RV-resume2-summary.json`，全部为真才 PASS）：

| 检查 | 结果 |
|---|---|
| 助手回答（取自 SDK transcript） | **`蓝色松鼠-4729`**（DOM 中提问之后也出现） |
| 第 2 回合投递 | `agent.turn.delivered resumed:true sdkSessionId:43622a60-…`（与第 1 回合记录的 id 相同） |
| 没有新 SDK 会话 | 第 2 回合前后 engine-profile 下 transcript 文件数都是 2（源运行的 `ae09475f…` + `43622a60…`），没有新文件；回合后 sdkSessionId 不变 |
| 同一 transcript 连续 | `43622a60….jsonl` 依次是：user（第 1 回合，含暗号）→ assistant "好的" → user（第 2 回合）→ assistant "蓝色松鼠-4729"，四行 `sessionId` 相同 |
| 防泄漏 | 第 2 回合的 prompt 不含完整暗号（`turn2PromptHasCode:false`）；"蓝色松鼠" 四个字在第 2 回合发出的用户消息中不存在。注意：数字 `4729` 出现在会话策略前缀的已绑定 job id `4729-20261021-…` 中（job id 由第 1 回合文本派生），所以"蓝色松鼠"这一半只能来自续接的历史。系统提示 append 由 engine laws + 路由提示组成（代码阅读，不含标题） |
| 过期 id 丢弃 | `stale_resume_dropped` 0 次 |

RU（修复前构建）也是同样结论（回答 `蓝色松鼠-4729`，同 id，同文件），这说明续接本身与 uuid 修复无关；修复只消除了重复气泡。

结论：port 的续接行为与原版一致：视频的 `sdkSessionId` 在每次重新拉起运行时时作为 `resume` 传入（createLocalRuntime L39544），SDK 在同一个 transcript 上继续，第 1 回合的上下文确实带到了重启之后的第 2 回合。仍有差异：transcript 丢失时 port 直接丢弃该 id（PORT-NEW），而不是原版的 `tryStaleResumeFallback`（L43295）。

## 5. IPC 覆盖（`python3 tools/ipc_coverage.py`）

| 类别 | docs/25 | **docs/26** |
|---|---|---|
| real | 58 | **88** |
| real-partial | 1 | **9** |
| real-env | 1 | 1 |
| fixture | 7 | 5 |
| stub | 93 | **57** |
| push-real | 8 | 11 |
| push-none | 15 | 12 |
| local | 1 | 1 |
| 合计 | 184 | 184 |

相对 docs/25（`f406913`）的变化：stub→real 28、stub→real-partial 8、fixture→real 2（`feedback:discard`、`hfPreview:available`）、push-none→push-real 3（`spend:snapshot`、`materials:changed`、`hfPreview:event`）。

剩余 57 个 stub 按 `tools/stub_audit.py` 分类：**a 0、b 55、c 2**（b 共 58，其中 3 个 `characters:voice*` 已是 real-partial）。

* **b（55，需要 Claude Code / Codex / Videoclaw gateway / 账号）**：`sessionPlan:*`、`memory:*`、`taste:titles`、`characters:sheetBuild`、`characters:sheetPlan`、`outbox:authoritySnapshot`、`telemetry:bindReplay`、`settings:saveGatewayKey/switchGateway`、`gateway:verify/meter/topup`、`account:*`（登录/刷新等）、`engine:claudeCode*`、`engine:codex*`、`engine:claudeModels/continueOnCodex/creditHandoffOffer/continueOnCredits/agentProviderKeyStatus/saveAgentProviderKey`、`session:setModel/setReasoningEffort`、`library:sync/search`、`feedback:submit/grantUsageSharing`、`workflowSubmit:start`、`app:update:check/preferences/channel`、`media:transcribeVoice` 等（完整列表：`python3 tools/stub_audit.py --md`）。
* **c（2，仅 macOS/Windows）**：`app:update:download`、`app:update:install`。

## 6. 本轮代码变更

| 提交 | 内容 |
|---|---|
| `7d9eda0` | `port/tools/ui-e2e-m9.mjs`（四个阶段）、`ui-e2e/cdp.mjs dragElement`（拦截式真实拖拽）、`src/main/index.ts` 的 `VIDEOCLAW_PORT_IPC_LOG`（仅在设置该环境变量时启用，逐行脱敏）。续接阶段从渲染器自己的 `session:create` 结果取会话 id、从推送的 SDK `result` 事件判定回合结束（sessions.json 在 idle 时不落盘）、并做 §4 的各项检查；修正 materials_preview 判定里计数覆盖 `ok` 的错误 |
| `8e072ef` | +1 node:test：UI 未覆盖通道的 handler 接线（voice:approve/remove、library:scan、characters:retry、input:respond、media:discardVoice），243 |
| `afe1686` | `AgentHost.sendMessage`：composer 回合的 SDK 消息 uuid = `composerTurnMessageUuid(sessionId, clientTurnId)`（原版 pushInput L23073）；无 clientTurnId 的回合（如 approve 跟进）仍用随机 uuid。+1 node:test |
| 本提交 | `tools/collect_m9.sh`（证据收集 + 脱敏 + key 命中/媒体检查）、`artifacts/phase-b-m9/`、本文 |

## 7. 已验证 / 未验证 / 风险

**已验证**
* M9 的 36 个通道中，16 个在原版渲染器中由真实输入驱动并在主进程/磁盘侧得到确认（§2.1）。
* docs/25 中 11 个只有 node:test 的 M8 通道转为 UI 验证，包括此前因自定义 MIME 无法驱动的侧栏拖拽重排（视频、项目各一）。
* 会话续接上下文连续性：重启后同一 sdkSessionId 续接，助手正确复述暗号（§4）。
* 失败回合 Retry：同一 SDK 会话重投，重试回合正常完成。
* 重复用户气泡问题已按原版 uuid 规则修复，并复跑确认。

**未验证**
* 20 个 M9 通道只有 node:test（§2.1 表中 node:test 行），其中 6 个只有 handler 接线测试，`attachment:voiceNote` 只测了拒收路径，`attachment:captureMoment` / `momentPreview` **没有任何运行时验证**。
* `quickstart:start` 只验证到"创建视频 + quickstart 元数据"；fixture 的 `.bin` 核心文件被拒，首回合没有发出，完整的 Quickstart 首回合未验证。
* M8 中仍只有 node:test 的 10 个通道（§2.2 末）。
* 续接没有做"不 resume 时答不出"的反向对照运行；证据依赖"蓝色松鼠"不在第 2 回合 prompt 中这一点。系统提示是否完全不含标题只做了代码阅读（SDK 只记录了首个请求的 blob）。
* 本轮 UI 运行都是 dev 构建（`node_modules/.bin/electron` + `dist`），没有重新打包 AppImage 复跑。
* 打包二进制、长会话、自动压缩（autoCompact）之后的续接没有测试。

**风险**
* 删除活动视频后渲染器对已删除会话的 `job:get` / `session:history` 竞争（与原版行为一致，但会在 console 里出现 `Unknown session`）。
* uuid 改为确定性后，同一 clientTurnId 的重投依赖 SDK 对已存在 uuid 的处理；R2 中重试正常、transcript 不重复，但其它失败形态（例如超时发生在用户消息写入之前/之后的不同时间点）只覆盖了这一次。
* 过期 resume id 的处理仍是 PORT-NEW 简化分支（transcript 缺失即丢弃），不是原版 `tryStaleResumeFallback`；`restoreFailedTurn`（L43489）仍未移植。
* 55 个 b 类通道和 2 个 c 类通道仍为 stub。

## 8. 下一步

a 类本地通道到此基本完成（a_todo 0；20 个只有 node:test 的通道可以继续补 UI 驱动）。剩下的是 **b 类**和 **c 类**（仅 mac/win，Linux 上原版本身禁用）。用户已确认不使用 Claude 官方订阅；下一轮计划改用 MiniMax 提供的 Codex 兼容接口和 gateway/计费类接口去配置 b 类通道（代替真实的 Claude / Codex / Videoclaw gateway 凭据）。本轮没有开始这部分。
