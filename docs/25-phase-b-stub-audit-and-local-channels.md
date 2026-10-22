# 25 · Phase B M8：116 个 stub 通道审计 + 本地通道真实化 + session:history 回放 + AppImage 复验

日期：2026-10-21（Asia/Singapore）。基线：`246ca12`（docs/24）。本轮不使用任何 Claude / Codex / 上游 gateway 凭据；唯一的 LLM 路由仍是 PORT-NEW 的 MiniMax provider 路由（`MINIMAX_API_KEY` 只在 box 环境变量中，串行、单请求；未打印、未写日志、未提交——证据目录命中数 0）。`app/out`、`app/reconstructed` 只作参照，未改动；新代码都在 `port/` 与 `tools/`。

## 0. 一览

| 项 | 结果 |
|---|---|
| 审计 | M8 开始时的 116 个 stub 全部归类：**a（本地/无凭据可实现）60**（本轮已实现 23，余 37）、**b（需 Claude/Codex/gateway 凭据）54**、**c（仅 macOS/Windows，Linux 上 N/A）2**。机器可校验：`python3 tools/stub_audit.py`（任一 stub 未归类、或标 done 却仍是 stub → 退出码 1） |
| 本轮真实化 | 23 个通道（22 real + `session:setPermissionMode` real-partial），外加 `session:history` 由 real-partial → **real**（真实 transcript 回放） |
| session:history | **已验证（打包 AppImage，真 UI）**：重启应用后从侧栏重新打开上一条视频，原版渲染器显示原 brief、助手文字、10/4/4 steps 工具行、V1 版本；主进程日志 `agent.history.replayed sdkMessages=97 displayRows=2 events=77` |
| AppImage 复验 | 重新打包（含本轮代码）后 `APPIMAGE_EXTRACT_AND_RUN=1`、无 sudo：quickstart:catalog **PASS**、标题自动生成 **PASS**（`三段素材竖屏快剪`，titleOrigin=automatic）、TypeError L31748/L39778 **0/0**（console error 总数 0）、问题卡作答 **PASS**（allow, answers=2, tool_end ok）、完整流程 **PASS**（home→project→attach→send→stream→play→approve→export，sha 链 final=v1=export） |
| IPC 覆盖 | real **35 → 58**，real-partial 1（现为 `session:setPermissionMode`），stub **116 → 93**，合计 184 |
| 测试 / 构建 | `npm test` **228/228**（docs/24 为 220；+8 个 `test/local-channels.test.ts`）；`npm run build`（gen + verbatim 新鲜度 + tsc + bundle）绿 |

## 1. 审计方法与口径

* 来源：`python3 tools/ipc_coverage.py --json` 在 `246ca12` 上的 116 个 `stub`。每个通道给出原版 `app/reconstructed/main/index.js` 中 `ipcMain.handle/on` 注册行；当类别取决于 host 方法或模块时，再给出该方法行（例如 `memoryBinding` L36456、`createAppUpdater` L2223、`voiceTools` L10465、`getSpendSnapshot` L45686）。
* **a**：原版实现只依赖本机文件/进程/ffmpeg/engine CLI，没有账号或网关前提；Linux 上可以逐字移植。若原版在实现内部顺带向 gateway outbox 发 beacon（`this.outbox?.enqueue`），本地部分算 a，beacon 部分在 port 中是 `outbox` 缺省的 no-op 分支（原版同样写成可选链）。
* **b**：原版 handler 本身要求已验证的 上游账号 / gateway（`memoryBinding` 的 "Project memory is unavailable until this account and project are verified"、`resolveHelperCreds`、`acquireLibraryGatewayLease`、`assertGenerationAllowed` + 付费生成）或 Claude Code / Codex 登录与模型目录。
* **c**：原版在 Linux 上本来就禁用或依赖 mac 专有助手：`createAppUpdater` 仅在 `platform === "darwin"` 时启用（L2227-2231，Linux 状态为 `disabled`，消息 "In-app updates require an installed Mac build…"）；`media:transcribeVoice` 依赖 `voice-dictation` 原生助手（mac）且要求登录，故记为 b（兼 c）。`media:requestMic` 的 darwin `systemPreferences` 分支为 c，非 darwin 分支（返回 true）已实现。

## 2. 116 个通道完整表（a ✅ = 本轮已实现）

| # | channel | 类 | 原始 handler 行 | 依据 |
|---|---|---|---|---|
| 1 | `session:rename` | a ✅ | L61731 | done-M8: host.renameSession L38915, registry flush |
| 2 | `session:reorder` | a ✅ | L61698 | done-M8: host.reorderSessions L38482 (sidebarOrder) |
| 3 | `session:setPermissionMode` | a ✅ | L61781 | done-M8 (real-partial): host.setPermissionMode L43987; spend/codex branches not ported |
| 4 | `client:rename` | a ✅ | L61819 | done-M8: SessionRegistry renameClient L36367 |
| 5 | `client:remove` | a ✅ | L61820 | done-M8: removeClient L36384 + tombstones |
| 6 | `client:reorder` | a ✅ | L61826 | done-M8: reorderClients L36332 |
| 7 | `file:openExternal` | a ✅ | L61979 | done-M8: shell.openExternal http(s) only |
| 8 | `media:requestMic` | a ✅ | L61904 | done-M8: non-darwin returns true (darwin systemPreferences branch = c, N/A) |
| 9 | `analytics:playbackCompleted` | a ✅ | L62003 | done-M8: local validation; beacon upload is gateway (outbox absent) |
| 10 | `taste:list` | a ✅ | L61843 | done-M8: verbatim taste module L15178 |
| 11 | `taste:commit` | a ✅ | L61849 | done-M8: verbatim commitTaste |
| 12 | `taste:decline` | a ✅ | L61850 | done-M8: verbatim declineProposal |
| 13 | `stats:stageEtas` | a ✅ | L62297 | done-M8: verbatim computeStageEtas |
| 14 | `bootstrap:revealSetupLog` | a ✅ | L61303 | done-M8: userData/setup.log (appendSetupLog L9850) |
| 15 | `characters:create` | a ✅ | L61882 | done-M8: CharacterStore.create + exposeCharacter |
| 16 | `characters:approve` | a ✅ | L61893 | done-M8: CharacterStore.approve |
| 17 | `characters:discard` | a ✅ | L61900 | done-M8: CharacterStore.discard |
| 18 | `characters:delete` | a ✅ | L61903 | done-M8: CharacterStore.delete |
| 19 | `permission:shown` | a ✅ | L61803 | done-M8: send; local log only |
| 20 | `quit:rendererState` | a ✅ | L61804 | done-M8: send; verbatim normalisation into quit coordinator state |
| 21 | `quickstart:mark` | a ✅ | L61250 | done-M8: verbatim validation + latency ring |
| 22 | `quickstart:impression` | a ✅ | L61254 | done-M8: validation; outbox?.enqueue no-op (gateway) |
| 23 | `quickstart:previewed` | a ✅ | L61274 | done-M8: validation; outbox?.enqueue no-op (gateway) |
| 24 | `quickstart:start` | a | L61294 | quickstartCoordinator.start: copies starter media into a new video, first turn on the active route (MiniMax ok) |
| 25 | `session:deletionPlan` | a | L61732 | host.planProjectDeletion L39205 (ownedProjectData, deletionBlock) |
| 26 | `session:delete` | a | L61739 | host.deleteProject L39248 → moveProjectToTrash (local trash); session-index retire is gateway, optional |
| 27 | `session:retry` | a | L61776 | host.retryTurn L42565 (failedInputs replay; Claude terms-recovery branch is b) |
| 28 | `session:startContinuation` | a | L61766 | host.startContinuationChat (local continuation chat over a finalized video) |
| 29 | `project:seedPack` | a | L61827 | host.seedProjectPack L36444 → writeProjectPack (local files) |
| 30 | `characters:voices:list` | a | L61873 | host.readCharacterVoices (local voice store; samples are produced by paid TTS = b) |
| 31 | `characters:voice:approve` | a | L61876 | host.approveCharacterVoice (local, sha-pinned) |
| 32 | `characters:voice:remove` | a | L61879 | host.removeCharacterVoice (local) |
| 33 | `characters:sheetPlan` | a | L61885 | CharacterSheetBuilder.plan L34875 (engine dry-run, free) |
| 34 | `characters:sheetStates` | a | L61892 | host.characterSheetStates (local state files) |
| 35 | `characters:retry` | a | L61896 | store retry + assertGenerationAllowed; the rebuild it queues is paid (b) |
| 36 | `job:originalContext` | a | L61754 | host.getOriginalContext (local job files) |
| 37 | `job:adopt` | a | L61759 | host.adoptJob (local registry/job fence) |
| 38 | `spend:get` | a | L61755 | host.getSpendSnapshot L45686 → spendBudgets.snapshot (local ledger; only paid work moves it) |
| 39 | `spend:setCeiling` | a | L61756 | host.setSpendCeiling (local spend-budget store) |
| 40 | `input:respond` | a | L61830 | host.respondInput L44689 (pendingInputs from studio MCP request tools, not ported yet) |
| 41 | `media:discardVoice` | a | L61914 | drops a pending dictation; trivial, pairs with transcribeVoice (b/c) |
| 42 | `library:stats` | a | L62065 | engine library CLI, local index |
| 43 | `library:scan` | a | L62068 | engine library CLI, local scan |
| 44 | `library:addSource` | a | L62071 | local source list + scan |
| 45 | `library:removeSource` | a | L62085 | local source list |
| 46 | `library:preview` | a | L62122 | local ffmpeg thumbnail |
| 47 | `library:setTenant` | a | L62154 | local tenant binding |
| 48 | `bootstrap:revertEngine` | a | L61302 | bootstrap.revertEngine (previous engine-current.json) |
| 49 | `attachment:pasteImage` | a | L62272 | clipboard nativeImage → intake file |
| 50 | `attachment:voiceNote` | a | L62265 | voiceNoteIntakeFile L10535 (ffmpeg, local) |
| 51 | `attachment:captureMoment` | a | L62220 | ffmpeg frame grab of a version |
| 52 | `attachment:momentPreview` | a | L62249 | ffmpeg preview |
| 53 | `attachment:preview` | a | L62256 | local thumbnail |
| 54 | `materials:preview` | a | L62197 | local materials ledger preview |
| 55 | `feedback:capture` | a | L62341 | local evidence capture (screenshot + logs); submit is b |
| 56 | `hfPreview:start` | a | L62440 | local HyperFrames preview worker |
| 57 | `hfPreview:stop` | a | L62441 | local HyperFrames preview worker |
| 58 | `hfPreview:editApply` | a | L62444 | local composition edit |
| 59 | `account:localResetPrepare` | a | L61496 | local data reset plan (no network) |
| 60 | `account:localResetCommit` | a | L61497 | local data reset commit (relaunch) |
| 61 | `sessionPlan:read` | b | L61920 | host.readSessionPlan L37031 → memoryBinding L36456 requires verified account+gateway authority |
| 62 | `sessionPlan:choose` | b | L61928 | memoryBinding (account authority) + plan budget |
| 63 | `sessionPlan:retry` | b | L61944 | memoryBinding (account authority) |
| 64 | `memory:read` | b | L61955 | readProjectMemory L36472 → memoryBinding: 'unavailable until this account and project are verified' |
| 65 | `memory:update` | b | L61960 | memoryBinding (account authority) |
| 66 | `memory:undo` | b | L61965 | memoryBinding (account authority) |
| 67 | `memory:openSource` | b | L61970 | memoryBinding (account authority) |
| 68 | `taste:titles` | b | L61854 | resolveHelperCreds → Claude/gateway helper LLM |
| 69 | `characters:sheetBuild` | b | L61888 | assertGenerationAllowed + paid image generation via gateway |
| 70 | `outbox:authoritySnapshot` | b | L61709 | telemetry outbox authority (gateway account) |
| 71 | `telemetry:bindReplay` | b | L61710 | telemetry replay upload (gateway) |
| 72 | `settings:saveGatewayKey` | b | L61393 | gateway API key |
| 73 | `settings:switchGateway` | b | L61377 | gateway selection (dev/staging gateways) |
| 74 | `gateway:verify` | b | L61376 | gateway reachability/auth |
| 75 | `gateway:meter` | b | L61593 | gateway credit meter |
| 76 | `gateway:topup` | b | L61596 | gateway billing |
| 77 | `account:refresh` | b | L61407 | upstream account (gateway) |
| 78 | `account:signInGoogle` | b | L61408 | upstream account OAuth |
| 79 | `account:signInEmail` | b | L61431 | upstream account email sign-in |
| 80 | `account:resendEmail` | b | L61420 | upstream account email sign-in |
| 81 | `account:cancelSignIn` | b | L61428 | upstream account sign-in flow |
| 82 | `account:signOut` | b | L61445 | upstream account |
| 83 | `account:consent` | b | L61498 | account consent record (gateway) |
| 84 | `account:ensureAccess` | b | L61508 | account access check (gateway) |
| 85 | `account:mintKey` | b | L61557 | gateway key minting |
| 86 | `account:claimKey` | b | L61574 | gateway key claim |
| 87 | `engine:claudeCodeStatus` | b | L61603 | Claude Code login state |
| 88 | `engine:claudeCodeConnect` | b | L61604 | Claude Code login |
| 89 | `engine:claudeCodeConnectCancel` | b | L61605 | Claude Code login |
| 90 | `engine:claudeCodeSignOutImpact` | b | L61606 | Claude Code login |
| 91 | `engine:claudeCodeSignOut` | b | L61607 | Claude Code login |
| 92 | `engine:codexStatus` | b | L61609 | Codex / ChatGPT login |
| 93 | `engine:codexConnectChatGpt` | b | L61610 | Codex / ChatGPT login |
| 94 | `engine:codexConnectCancel` | b | L61619 | Codex / ChatGPT login |
| 95 | `engine:codexDisconnectImpact` | b | L61620 | Codex / ChatGPT login |
| 96 | `engine:codexDisconnectChatGpt` | b | L61621 | Codex / ChatGPT login |
| 97 | `engine:codexModels` | b | L61622 | Codex model catalog (ChatGPT account) |
| 98 | `engine:claudeModels` | b | L61659 | Claude Code model catalog (Claude account) |
| 99 | `engine:continueOnCodex` | b | L61661 | route handoff to Codex |
| 100 | `engine:creditHandoffOffer` | b | L61655 | upstream credits route |
| 101 | `engine:continueOnCredits` | b | L61656 | upstream credits route |
| 102 | `engine:agentProviderKeyStatus` | b | L61664 | agent-provider key for Codex harness |
| 103 | `engine:saveAgentProviderKey` | b | L61665 | agent-provider key for Codex harness |
| 104 | `session:setModel` | b | L61784 | host.setSessionModel: model list comes from the Claude/Codex account catalog |
| 105 | `session:setReasoningEffort` | b | L61787 | host.setSessionReasoningEffort: Claude/Codex route capability |
| 106 | `library:sync` | b | L62092 | guardedAppLibrary → acquireLibraryGatewayLease |
| 107 | `library:search` | b | L62115 | guardedAppLibrary → gateway lease |
| 108 | `feedback:submit` | b | L62346 | feedback upload (gateway outbox) |
| 109 | `feedback:grantUsageSharing` | b | L62350 | usage-sharing grant (gateway account) |
| 110 | `workflowSubmit:start` | b | L62399 | workflow submission to gateway |
| 111 | `app:update:check` | b | L61372 | startUpdateCheck L62583: release feed via gateway (nightly needs account) |
| 112 | `app:update:preferences` | b | L61330 | createUpdatePreferences L62572: needs account (nightly entitlement) |
| 113 | `app:update:channel` | b | L61334 | update channel switch; canSwitch needs enabled updater (darwin) + account |
| 114 | `media:transcribeVoice` | b | L61911 | host.transcribeVoice: 'sign in before transcribing' + voice-dictation helper (mac-only, L10465) → b and c |
| 115 | `app:update:download` | c | L61362 | createAppUpdater L2223: enabled only when platform === 'darwin' (Linux state = disabled) |
| 116 | `app:update:install` | c | L61367 | createAppUpdater L2223: Squirrel/mac installer only |

计数：a 60（✅ 23 + 待做 37）/ b 54 / c 2，合计 116。

### 2.1 仍为 stub 的 93 个通道去向

* **需要凭据（b，54）**：account:* 10 个（refresh/signInGoogle/signInEmail/resendEmail/cancelSignIn/signOut/consent/ensureAccess/mintKey/claimKey）、gateway:verify/meter/topup、settings:saveGatewayKey/switchGateway、engine:claudeCode* 5 个、engine:codex* 6 个、engine:claudeModels/continueOnCodex/creditHandoffOffer/continueOnCredits/agentProviderKeyStatus/saveAgentProviderKey、session:setModel/setReasoningEffort、sessionPlan:read/choose/retry、memory:read/update/undo/openSource、taste:titles、characters:sheetBuild、outbox:authoritySnapshot、telemetry:bindReplay、library:sync/search、feedback:submit/grantUsageSharing、workflowSubmit:start、app:update:check/preferences/channel、media:transcribeVoice。
* **仅 mac/win（c，2）**：app:update:download、app:update:install。
* **本地可做但本轮未做（a 待做，37）**：quickstart:start、session:deletionPlan/delete/retry/startContinuation、project:seedPack、characters:voices:list/voice:approve/voice:remove/sheetPlan/sheetStates/retry、job:originalContext/adopt、spend:get/setCeiling、input:respond、media:discardVoice、library:stats/scan/addSource/removeSource/preview/setTenant、bootstrap:revertEngine、attachment:pasteImage/voiceNote/captureMoment/momentPreview/preview、materials:preview、feedback:capture、hfPreview:start/stop/editApply、account:localResetPrepare/localResetCommit。

## 3. 本轮实现的通道

| 通道 | 原版行 | port 实现 | 验证 |
|---|---|---|---|
| `session:history` | L61747 → getHistory L43698、historyToEvents L53433 | `agent-host.ts getHistory`：显示 transcript 旁车 `userData/display-transcripts/<id>.jsonl`（逐字 `appendDisplayTranscript`/`readDisplayTranscript`）+ vendor SDK `getSessionMessages`（先 fs，后 `engineProfileStore` 读 `userData/engine-profile/projects`）→ 逐字 `historyToEvents`；`sdkSessionId` 由 `observeSdkSessionIdentity` 记录；之后的回合 `resume: sdkSessionId`（transcript 缺失时丢弃过期 id，PORT-NEW 代替 `tryStaleResumeFallback`） | **真 UI（AppImage）** + node:test（真 SDK `getSessionMessages`） |
| `session:rename` | L61731 / L38915 | `AgentHost.renameSession`（titleOrigin=manual） | **真 UI（AppImage）**：侧栏双击 → rename-input → Enter；sessions.json 与 DOM 同步 |
| `client:rename` | L61819 / L36367 | `SessionRegistry.renameClient`（逐字校验 `projectNameError`） | **真 UI（AppImage）**：项目 ⋯ 菜单 → Rename → Project name → Enter |
| `session:reorder` | L61698 / L38482 | `reorderSessions` + 原版 listSessions 排序（项目序、sidebarOrder、createdAt desc） | node:test（侧栏拖拽需要自定义 DataTransfer 类型，未用 CDP 驱动） |
| `session:setPermissionMode`（real-partial） | L61781 / L43987 | 模式校验、运行中推迟到下回合、空闲时 `query.setPermissionMode` 失败则 teardown；spend/codex 分支未移植 | node:test |
| `client:reorder` / `client:remove` | L61826 / L61820；L36332 / L36384 | 注册表重排、删除（tombstone 在整文件写回后仍生效；运行中拒绝） | node:test |
| `taste:list` / `taste:commit` / `taste:decline` | L61843/61849/61850 | 逐字切片 `taste.generated.ts`（L15178 起） | node:test（COMMITMENTS / ANTI-COMMITMENTS 往返） |
| `characters:create/approve/discard/delete` | L61882/61893/61900/61903 | 逐字 CharacterStore + exposeCharacter | node:test |
| `quickstart:mark/impression/previewed` | L61250/61254/61274 | 逐字校验 + 本地 latency ring；outbox 缺省（gateway） | node:test；AppImage 中画廊正常加载，未单独抓取这三个调用 |
| `stats:stageEtas` | L62297 | 逐字 `computeStageEtas` | node:test |
| `bootstrap:revealSetupLog` | L61303 | `userData/setup.log`（逐字 appendSetupLog L9850） | node:test |
| `file:openExternal`、`media:requestMic`、`analytics:playbackCompleted`、`permission:shown`、`quit:rendererState` | L61979/61904/62003/61803/61804 | `local-channels.ts` | node:test |

新增生成文件（`port/tools/gen-verbatim.mjs` 规格，`test/verbatim` 校验新鲜度，`tools/check-unresolved.mjs` 无未声明标识符）：`src/main/agent/history.generated.ts`、`src/main/taste/taste.generated.ts`、`src/main/jobs/stage-etas.generated.ts`；quickstart 规格新增导出 `milestoneDurationMs`。

## 4. session:history 回放证据（打包二进制）

* 运行：`/workspace/m8/A1`（AppImage 全流程，见 §5），然后 `node tools/ui-e2e-reopen.mjs --run /workspace/m8/A1 --appimage release/Videoclaw-Port-0.0.40-port.0-linux-x86_64.AppImage`（新进程，无内存状态继承）。
* 磁盘前提：sessions.json 中 `sdkSessionId` 已记录；engine-profile 下 SDK transcript 175 行（7 段助手文字、34 次 tool_use）；显示旁车 2 行。
* 启动后原版直接恢复上次活动的视频；驱动先点侧栏 "Quickstarts" 离开该视频，再点侧栏视频行重新打开（真鼠标事件）。
* 结果 `history_replay: PASS`：DOM 中出现用户 brief 前缀与最后一段助手文字 "Locked: A only, at both projec…"，工具行 15、版本按钮 2；主进程 `agent.history.replayed sdkMessages=97 displayRows=2 events=77`。截图：`artifacts/phase-b-m8/A1-reopen-shots/02-reopened-transcript.png`。
* 同一次运行：`session_rename: PASS`（titleOrigin=manual）、`client_rename: PASS`。

## 5. AppImage 复验（M6/M7 修复）

`npm run package:linux` 重新打包（含 c738664 代码）；`node tools/ui-e2e.mjs --run /workspace/m8/A1 --engine-home /workspace/m6/cardC1 --appimage release/…AppImage --check-quickstart --taste-wait-ms 1200000 --stop-after card`：

| 检查 | 结果 |
|---|---|
| quickstart:catalog | PASS：卡片 "Founder camera story"，3 张图，筛选 All / Founder Story |
| 标题自动生成 | PASS：`-:New video` → `fallback:<brief 前缀>` → `automatic:三段素材竖屏快剪`，侧栏 DOM 可见 |
| TypeError L31748 / L39778 | 0 / 0（console error 总数 0） |
| 问题卡 | PASS：taste-capture 的 AskUserQuestion（2 题）点第一项 + Answer → main decision allow answers=2，tool_end ok，助手复述所选 |
| 完整流程 | PASS：home、quickstart、project_video、attach（拖放 4 文件）、brief_send、stream（327 s，28 次 tool_start，isError=false）、play（vcmedia v1.mp4 推进 2.59 s）、approve、export（h264 720x1280 30fps + aac，6.507 s，final=v1=export sha `049200c9…`）；accept_check 无失败项 |

证据：`artifacts/phase-b-m8/A1-appimage-*`、`A1-reopen-*`（路径已脱敏为 `<RUN>`/`<APPIMAGE_ROOT>`/`<REPO>`；MINIMAX_API_KEY 命中 0；无 mp4/sqlite）。

## 6. IPC 覆盖（`python3 tools/ipc_coverage.py`）

| 类别 | docs/24 | **docs/25** | 变化 |
|---|---|---|---|
| real | 35 | **58** | +22 本地通道、`session:history` 由 partial 转正 |
| real-partial | 1 | 1 | 现为 `session:setPermissionMode` |
| real-env | 1 | 1 | |
| fixture | 7 | 7 | |
| stub | 116 | **93** | −23 |
| push-real | 8 | 8 | |
| push-none | 15 | 15 | |
| local | 1 | 1 | |
| 合计 | 184 | 184 | |

## 7. 复现

```
cd port && npm test && npm run build && npm run package:linux
python3 tools/stub_audit.py [--md|--json]
node tools/ui-e2e.mjs --run /workspace/m8/A1 --engine-home <home> --appimage release/<AppImage> --check-quickstart --taste-wait-ms 1200000 --stop-after card
node tools/ui-e2e-reopen.mjs --run /workspace/m8/A1 --appimage release/<AppImage>
ARTIFACTS_PHASE=phase-b-m8 EXTRA_REDACT=<home> tools/collect_m5.sh /workspace/m8/A1 A1-appimage
```

## 8. 已验证 / 未验证 / 风险

**已验证**
* session:history 真实 transcript 回放（打包 AppImage、重启后重开、真 UI）。
* session:rename、client:rename（打包 AppImage、真 UI）。
* M6/M7 修复在打包二进制中成立：quickstart 目录、自动标题、两个 TypeError 为 0、问题卡作答被接受、完整 S1 流程。
* 其余新通道在 node:test 中按原版语义验证（228/228）。

**未验证**
* session:reorder、client:reorder/remove、session:setPermissionMode、taste:*、characters:*、stats:stageEtas、quickstart:mark/impression/previewed、quit:rendererState、permission:shown、file:openExternal、media:requestMic、analytics:playbackCompleted、bootstrap:revealSetupLog：**只有 node:test，没有用真 UI 驱动**（拖拽重排需要自定义 MIME DataTransfer；其他多为不可见/后台通道）。
* `resume: sdkSessionId` 的续接：taste-capture 第二回合在 AppImage 中正常完成，但没有逐项比对 SDK 是否真的复用了上下文；过期 id 的恢复走的是 PORT-NEW 简化分支（transcript 缺失即丢弃 id），不是原版 `tryStaleResumeFallback`。
* `restoreFailedTurn`（L43489）未移植：失败回合的重试状态不会在回放时恢复。
* dev（非打包）模式本轮未重复跑全流程（只跑了 AppImage）。

**风险**
* 从 `persistSession:false` 改为 SDK 默认持久化 + resume：engine-profile 下会累积 transcript（与原版一致），但若 MiniMax 路由对超长续接上下文不稳定，长会话可能出现与旧行为不同的失败。
* 37 个 a 类通道仍为 stub（删除/重试/继续/素材预览/HyperFrames 预览/library 本地部分等），UI 中对应按钮仍会得到 stub 结果。
* 54 个 b 类通道需要 Claude Code / Codex / 上游 gateway 凭据，凭据缺失下无法真实实现或验证；2 个 c 类（app:update:download/install）在 Linux 上原版本身即禁用。
