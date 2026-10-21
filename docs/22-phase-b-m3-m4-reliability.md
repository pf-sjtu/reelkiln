# 22 · Phase B：M3（job → 版本 → 播放 → 批准 → 导出）+ M4（附件 intake）+ S1 可重复性

> 接 docs/21。范围：docs/20 路线图的 M3、M4，以及 S1 主流程在 **L2**（附件经真实 IPC 进入，brief 不含路径行）下的重复实跑。
> 证据：`artifacts/phase-b-m3/`（已脱敏：路径换成 `<RUN>`/`<ENGINE_HOME>`；`MINIMAX_API_KEY` 命中数 = 0；没有提交任何 mp4，只有 ffprobe JSON 和 sha256）。代码只改了 `port/` 和 `tools/`。
> 时间均为 Asia/Singapore（UTC+8），2026-10-21。

## 0. 已验证 / 未验证（一览）

| 项 | 结论 | 证据 |
|---|---|---|
| M3 JobWatcher → VersionStore 生成 `versions/v1.mp4` | ✅ 3/3 次真跑；**A1 sha(v1)==sha(final)** | `run{A,B,C}-sha256.txt`、`run*-accept.json` |
| M3 `job:snapshot` 推送 / `job:get` | ✅ 真跑（渲染器收到含 v1 的快照） | `run*-s1-driver.json` `snapshotsPushed`、`m3.snapshot` |
| M3 `vcmedia://` 播放（原版特权 scheme + Range） | ✅ 3/3：`206 bytes 0-1023/<size>` video/mp4；`<video>` readyState 4、6.507 s、720×1280、`playing` | `run*-summary.json` `playback` |
| M3 `version:approve` → `finalizedAtMs` + versions.json final(v1, madeFinalAtMs, qaSha256) + `✅ V1 approved` + taste-capture 后续回合 | ✅ 3/3（**A3** 过）；taste-capture 回合按原版发出，冒烟随即 interrupt（省额度） | `run*-versions.json`、`run*-sessions.json` |
| M3 `file:saveItemAs` 导出 | ✅ 3/3：sha==v1、ffprobe rc 0、h264 720×1280 30/1 + aac、6.507 s（**X1**） | `run*-export.ffprobe.json` |
| M4 `intake:pickFiles` → `attachment:stage` → ready → Send 落盘到 `jobs/<id>/incoming/` + `[APP-OWNED COMPOSER ATTACHMENTS — ordered]` 前缀 | ✅ 3/3（**L2** 过：4 个文件 SHA256 与输入一致）；代理在 job 目录 `cp incoming/clip_a.mp4 …`，0 次引用工作区外的原始路径 | `run*-accept.json`、`run*-events.jsonl` |
| **S1-L2 全流程**（brief 无路径行） | ✅ **3/3 PASS**：E1–E15 + A1–A3 + X1 + L2 全过 | `run{A,B,C}-accept.json` |
| gate proxy 并发 1 | ✅ maxInflight=1、rejected=0（请求数 48 / 33 / 63） | `run*-main-structured.log` `agent.runtime.closed` |
| 归档附件（zip 等）解压 | ❌ 未移植：一律拒绝（单测验证拒绝路径） | `attachments-unported.ts` |
| 无路由提示的忠实路径（`VIDEOCLAW_PORT_ROUTE_HINT=0`） | ⚠️ 本轮**未重跑**（为省额度）；docs/21 的 run1 在这条路径上失败过 | — |

## 1. M3：移植内容

- **逐字切片**（`tools/gen-verbatim.mjs` 新增 5 个 spec，由 `--check` 和 `check-unresolved.mjs` 守护）：
  - `jobs/workspace-boundary.generated.ts`：main L4276-4344（pathIsWithin…assertRealWorkspaceFile）。
  - `jobs/version-store.generated.ts`：main L12295-14785，包括 registry claims、`VersionStore`、`scanJob`、`resolveCut`、`JobWatcher`、`FINAL_CANDIDATE_SETTLE_MS`。版本从引擎写的 `renders/<sha>.json`（`videoclaw.render-complete/v1`）生成。
  - `media/media.generated.ts`：rangeMedia chunk（MIME、`planMediaResponse`），以及 main 的 `MediaCapabilityRegistry`（L10944）和 `mediaFailure`。
- **AgentHost**（`agent/agent-host.ts`，按原版行号逐方法移植）：getJobSnapshot(L45620)、snapshotJobDir(L45608)、chatMediaRoot、historicalJobSnapshot(L45643)、nameCandidateVersion、enrich(L47448)、ensureWatcher(L47956)/retireWatcher、commitBind(…, watchImmediately)(L47615)、approveVersion(L47488)、revertFinal、unfinalizeSession、mustGetWritable(L51017)。approveVersion 的行为和原版一致：写 finalizedAtMs，推送 `✅ V{n} approved`，只在首次批准时追加原版的 taste-capture 回合。会话 finalized 之后，composer 的发送和附件 stage 都会被拒绝。
- **IPC**（`real-backend.ts` + `media/media-ipc.ts`）：`job:get`、`job:historicalSnapshot`、推送 `job:snapshot`（同时授权 vcmedia 访问）、`version:approve`、`version:revertFinal`、`session:unfinalize`、`file:saveItemAs`(L61987)、`file:revealItem`、`file:openPath`(L55678)。`vcmedia` 在 `index.ts` 顶层 `registerSchemesAsPrivileged`(L60356)，在 whenReady 里 `protocol.handle`(L62452)，只服务已授权路径（403/200/206/416/HEAD 都有单测）。

## 2. M4：移植内容

- **逐字切片**：
  - `attachments/asset-kinds.generated.ts`：wb chunk 的 VIDEO_EXTS…CLIPBOARD_IMAGE_MAX_PIXELS、WORKBOOK_SCHEMA…workbookSummary。
  - `attachments/composer-attachments.generated.ts`：voiceNoteClock、sha256Utf8、composerTurnMessageUuid、L11240 拷贝进度/错误文案、convertHeicToJpg、L16364 PNG_SIGNATURE…`ComposerAttachmentStore` 末尾。
- **未移植协作者**集中放在 `attachments/attachments-unported.ts`：`extractArchive` 返回 `{kind:"rejected", cause:"unsupported-compression"}`，因为 port 不带 yauzl，归档一律拒绝（`ARCHIVE_EXTRACTION_PORTED=false`）。
- **发送路径**按原版 submitPreparedMessage(L41559-41715) 实现：prepareTurn → 生成 job → materialize 到 `secureComposerDestination`（已绑定 job 时为 `jobs/<id>/incoming`，L44705）→ 加上 `[APP-OWNED COMPOSER ATTACHMENTS — ordered]` 前缀 → freezeRuntimeText → 投递 → markTurnSubmitted。附件 id 重复会被拒绝；带附件但没有 `clientTurnId` 会报 `Missing composer turn id`。
- **IPC**：`intake:pickFiles`(L62157，`isIntakePickerScope` L304)、`attachment:stage/list/ownership/remove/retry/destination` 和推送 `attachment:changed`。`destination:"library"` 会报原版的 “no library yet”，因为没有 tenant。

## 3. S1 可重复性（真实 MiniMax、真实引擎、原版渲染器、真实 IPC，并发 1）

驱动脚本是 `tools/accept_s1_app.sh RUN_DIR SOURCE_HOME L2`（PORT-NEW）。每次都用全新 HOME；引擎沿用已安装的 `engine-0.1.57-rc7-15f8f2d`（不重跑 bootstrap）。fixtures 生成在**工作区之外**的 `<RUN>/in/`，只能经由文件选择器预设 → `intake:pickFiles` → `attachment:stage` 这条路进入工作区。brief 是 docs/20 S1 原文的单行版，**没有路径行**。路由为 `minimax`（MiniMax-M3.1-Flash）。

| run | 级别 | 结果 | 回合耗时 | numTurns | 工具调用 | gate 请求 | guard 判决 | 时间（UTC+8） |
|---|---|---|---|---|---|---|---|---|
| docs/21 run1 | L1，无提示 | ❌ 20 min 超时 | — | — | 68 | — | — | 2026-10-21 下午 |
| docs/21 run2 | L1 + 提示 | ✅ | 292 s | 41 | 40 | 53 | 28 | 2026-10-21 下午 |
| **runA** | **L2 + 提示 + M3** | ✅ | 305 s | 33 | 32 | 48 | 21 | 15:09–15:14 |
| **runB** | **L2 + 提示 + M3** | ✅ | 246 s | 26 | 25 | 33 | 16 | 15:14–15:19 |
| **runC** | **L2 + 提示 + M3** | ✅ | 651 s | 47 | 46 | 63 | 39 | 15:19–15:30 |

- **成功率**：带提示时 **4/4**（L1 1 次、L2 3 次）；无提示 0/1（只试过一次，样本太小）。花费 $0（引擎 spend 0，`E14`）。
- **方差**：runC 在动手制作前用了约 30 条只读命令去读引擎源码和技能文档（提示里写的是“约 8 条”），耗时是 runB 的 2.6 倍，但仍远低于 20 min 的回合上限。3 次都通过，**按标准不算 flaky**，所以本轮**没有收紧**路由提示或 guardrail，提示原文和 docs/21 一样。如果以后出现失败，再考虑按路由加探索预算之类的通用约束（不含 S1 参数）。
- **三次成片**：sha 各不相同（runA 的 final 与 docs/21 run2 的 sha 恰好相同，因为 EDL 相同、渲染是确定性的），但 ffprobe 结果完全一致（h264 720×1280 30/1 + aac，6.507 s），切点都在 2.5/4.5。

## 4. 测试 / 构建 / 覆盖

- `npm test`：**203/203** 通过。新增 `test/jobs-attachments.test.ts` 6 个：VersionStore 生成/批准/重载；AgentHost 的 job 路径（watcher 推送 → v1 → approve → finalizedAtMs 持久化 → taste 回合 → finalized 后禁止 send/stage → unfinalize）；vcmedia 403/200/206/416/HEAD；saveItemAs/pickFiles/smokeDialog；附件端到端（拒 .xyz、拒 zip、落盘 sha 一致、turn 前缀、重复回执）；冒烟脚本在所有选项组合下的语法检查。L2 第一次真跑前就靠最后这一项抓到了一个 `let list` 重复声明。SDK 边界在单测里 mock；验收实跑不 mock。
- `npm run build`（gen + typecheck + bundle）：通过。
- IPC 覆盖（`python3 tools/ipc_coverage.py`）：184 个通道中 **real 33 + real-env 1**（docs/21 时为 18+1），fixture 7，stub 119（之前 133），push-real 7（之前 5），push-none 16，local 1。

## 5. 偏差 / 仍延后

- PORT-NEW：冒烟专用的对话框预设 `VIDEOCLAW_PORT_SMOKE_SAVE_AS`、`VIDEOCLAW_PORT_SMOKE_PICK_FILES`，只在 `VIDEOCLAW_PORT_SMOKE=1` 时替换 `dialog`，`showItemInFolder` 只记日志。冒烟会 interrupt taste-capture 回合（`VIDEOCLAW_PORT_SMOKE_KEEP_TASTE=1` 可保留）。
- 仍未移植：accountVersions、完成通知、outbox、materials ledger、spend 对账、归档解压、HEIC 以外的转码路径真机验证、`quickstart:catalog`。
- 小差异（待核对）：route 未就绪（例如没有 key）时，port 会先把附件落盘到 job incoming/，然后在投递时报错。原版的检查顺序还没逐行确认。

## 6. 复现

```bash
cd port && npm run build && cd ..
tools/accept_s1_app.sh /workspace/s3/runX <home-with-installed-engine> L2   # 需要 MINIMAX_API_KEY；一次只跑一个
cat /workspace/s3/runX/out/summary.json
```

## 7. 未验证 / 风险

- 无提示的忠实路径本轮没有重跑；Claude 路由（原版目标模型）没有凭据，未实跑。
- 样本只有 3 次 L2，耗时方差大（246–651 s）。MiniMax 的探索深度不稳定，偶发超时的可能性没有排除。
- 原版 UI 里真实点击（播放器控件、Approve 按钮、导出菜单、拖拽附件）没有驱动；当前经 `window.videoclaw` → preload → 真 IPC，`<video>` 是脚本创建的元素，不是原版播放器组件。
- 重启后 versions.json 的恢复、`historicalJobSnapshot`、`revertFinal` 只有单测，没有真跑。
- 归档附件、HEIC、剪贴板图片、PDF 附件没有真跑。
- Windows/macOS 没有运行。
