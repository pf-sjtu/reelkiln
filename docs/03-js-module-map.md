# 03 · JS 模块 / 导出映射

> 范围：`app/out/main/index.js`、`app/out/main/chunks/*`、5 个 worker、`app/out/preload/index.mjs`、`app/out/renderer/index.html` 及 `assets/*.js`。
> 可读版本在 `app/reconstructed/`（prettier 格式化，行号均指可读版本）。
> 标注：**[V]** = 直接读到（import/export 语句、字符串、代码）；**[I]** = 由命名/上下文推断的职责描述。
> 打包形态（[V]）：Rollup/Vite ESM。`package.json` 中的依赖里，**只有** `electron`、`electron-updater`、`semver`、`zod`、`tar`、`@anthropic-ai/claude-agent-sdk`、`xlsx`、`yauzl` 以 bare import 形式保留（运行时从 `asar/node_modules` 解析）；`@videoclaw/shared`（workspace 包）被**内联**进了 `chunks/workbookContents-*.js`；React、react-markdown、lucide-react、posthog-js 被内联进渲染端 bundle。

## 1. 文件清单

| 文件 | 字节 | 可读版行数 | 角色 |
|---|---|---|---|
| `main/index.js` | 2,342,571 | 62,760 | 主进程入口（`package.json` `"main": "out/main/index.js"`）[V] |
| `main/chunks/workbookContents-ChzKjQX1.js` | 187,003 | 5,141 | 主进程共享块：`@videoclaw/shared` 常量/策略 + 归档/表格解析 [V/I] |
| `main/chunks/compositionEdit-Dc8_ecez.js` | 2,421 | 80 | HyperFrames 合成 HTML 解析与单处文本编辑 [V] |
| `main/chunks/rangeMedia-848zXGXe.js` | 1,654 | 66 | 媒体 MIME 表、`vcmedia` scheme 定义、HTTP Range 规划 [V] |
| `main/editorRenderWorker.js` | 2,662 | 94 | utility 进程：跑引擎渲染 [V] |
| `main/hyperframesPreviewWorker.js` | 6,300 | 185 | utility 进程：本地预览 HTTP 服务器 [V] |
| `main/hyperframesPolicyWorker.js` | 6,836 | 171 | utility 进程：合成目录安全策略校验 [V] |
| `main/workbookWorker.js` | 7,599 | 236 | utility 进程：xlsx/xls/ods 解析 [V] |
| `preload/index.mjs` | 48,559 | 1,058 | preload（ESM）：IPC 通道表 + `window.videoclaw` [V] |
| `renderer/index.html` | — | 13 | 加载 `./assets/index-D5K1mOs0.js` + `./assets/index-BCvS5oVP.css` [V] |
| `renderer/assets/index-D5K1mOs0.js` | 1,657,088 | 53,634 | 渲染端入口：React 18 应用（内联 react/react-dom/scheduler/jsx-runtime、lucide-react 图标 ×102、react-markdown/remark-gfm 等）[V] |
| `renderer/assets/module-D3rt-iOB.js` | 340,002 | 13,021 | posthog-js（按需 `import()`，L44624）[V] |
| `renderer/assets/qaFixtures-E0ox5qGv.js` | 63,781 | 2,015 | QA 假桥：`installQaBridge()`，仅 `?qa` 且无 `window.videoclaw` 时加载（L53592）[V] |

## 2. 主进程入口 `main/index.js`

### 2.1 导入（[V]，L1-262）
- `./chunks/workbookContents-ChzKjQX1.js`：148 个符号（共享块共导出 161 个；其余 13 个 `bu…bG` 仅 workbookWorker 使用，`W` 两者共用）。
- `electron-updater`（default）、`semver`（default）、`zod` `{ z }`、`tar` `{ extract, list, create }`、`@anthropic-ai/claude-agent-sdk` `{ query, getSessionMessages, createSdkMcpServer, tool as tool$1 }`。
- `electron` `{ safeStorage, app, nativeImage, shell, BrowserWindow, protocol, session, dialog, powerMonitor, systemPreferences, ipcMain as ipcMain$1, utilityProcess, Notification }`。
- Node 内置：`node:util {isDeepStrictEqual, promisify}`、`node:fs`（29 个同步 API）、`node:crypto {randomUUID, createHash, randomBytes, timingSafeEqual, createPublicKey, verify, createHmac}`、`node:path`、`node:child_process {spawn, execFile, execFileSync}`、`node:stream {Readable}`、`node:stream/promises {pipeline}`、`node:fs/promises`、`node:os {homedir, tmpdir, version}`、`node:url`、`node:readline {createInterface}`、`node:string_decoder`、`node:events {once}`、`node:http {createServer, request}`、`node:https {request}`、`node:module`（`__cjs_mod__`，CJS 互操作）、副作用导入 `node:zlib`、`yauzl`。
- `./chunks/rangeMedia-848zXGXe.js` `{ V: VCMEDIA_SCHEME, p: planMediaResponse, m: mimeFor }`；`./chunks/compositionEdit-Dc8_ecez.js` `{ p: parseComposition, a: applyTextEdit }`。
- 导出：无（入口文件；L7093 的 `export PATH=` 是模板字符串里的 shell 文本）。

### 2.2 内部"模块"分区（顶层 class，行号 [V]；职责 [I]）
Rollup 已将源模块拼平，以下以顶层类为锚点还原逻辑分区：

| 行 | 类 | 职责 [I] |
|---|---|---|
| 1149 | `LogRing` | 主进程日志环形缓冲 |
| 2402 | `trackIpcRequests()`（函数） | 包装 ipcMain，统计在途请求 [V] |
| 2700-2960 | `writeProjectTextFile / writeProjectStream`（函数） | 受限目录内原子写文件（子进程 + 身份校验）[V] |
| 3006/3256 | `ProjectMemoryError` / `ProjectMemoryStore` | 项目记忆（`memory:*`） |
| 3792-3810 | `SessionPlan*Error` | 会话计划（`sessionPlan:*`） |
| 4038 | `SessionContextError` | 引擎/工作区哈希不一致时阻断会话 [V] |
| 4534/4540 | `CredentialStore(Error)` | `credentials.dat`，基于 `safeStorage` 的凭据库 [V/I] |
| 5221 | `AlphaConsentCoordinator` | Alpha 条款同意 |
| 5291 | `Settings` | `settings.json`（gatewayUrl/agentHarness/llmRoute/world3/runnerUrl…）[V] |
| 5679-5826 | `WorkspaceUnavailable` / `LocalResetController` | 本地重置（`account:localReset*`） |
| 6425 | `EngineMoneyCompatibilityError` | 引擎计价面兼容性检查 [V] |
| 7022 | `ExecutorToolStorageError` | 修复 `bin/` 工具时磁盘不足 [V] |
| 7607 | `StudioBundleStore` | 已签名 Studio 工作流包（Ed25519 验签、下载、激活）[V/I] |
| 8413/8438 | `InapplicableFile` / `FeatureFlagStore` | 远程特性开关 |
| 9727 | `Bootstrap` | 引擎安装/更新/回滚/doctor（`bootstrap:*`）[V] |
| 10599 | `VoiceDictation` | 语音转写（ffmpeg + voice-dictation）[V] |
| 10944 | `MediaCapabilityRegistry` | 媒体能力登记 |
| 11568/11809 | `CharacterStore` / `CharacterVoiceStore` | 角色与角色声音（`characters:*`） |
| 13344 | `VersionStore` | 视频版本（approve/revert） |
| 14717 | `JobWatcher` | 监视 `jobs/<id>` 目录变化 → job snapshot |
| 16109-16340 | `uvBin/runEngine/libraryPreview`（函数） | 素材库（`library:*`）[V] |
| 16681 | `ComposerAttachmentStore` | 附件暂存（`attachment:*`） |
| 18163 | `MaterialsLedger` | 会话素材账本（`materials:*`） |
| 18487/18842 | `OversizedJournal` / `RuntimeTurnStore` | 回合持久化 |
| 19172/19216 | `BuildLog` / `CharacterSheetBuilder` | 角色设定图构建 [V] |
| 22396 | `Conductor` | （名称推断）回合编排/判定 |
| 22603 | `LiveWorkRegistry` | 进行中工作登记 |
| 22710-23380 | Claude Code 适配（函数） | `claudeCodeExecutable`、登录状态、`query()` 主会话 [V] |
| 23385-25230 | `CodexProcessCapacityError` / `CodexMessagePhases` / `CodexAppServerClient` | Codex app-server 客户端 [V] |
| 25251-25450 | `runBash/runRead/runWrite/executeDeviceCall` | 设备工具执行（远程 runner / codex）[V] |
| 25464/25492 | `RunnerHttpError` / `RemoteRuntime` | 远程 runner（World 3）[V] |
| 26976/27393 | `SessionSpendBudgets` 等 | 会话花费预算 |
| 28520-28672 | `GatewayHttpError` / `AgentGatewayProxy` | loopback 网关代理，发放 `vcs_` 会话 token [V] |
| 30772 | `QuickstartCatalogStore` | Quickstart 目录（签名校验）[I] |
| 31658 | `EngineChildren` | 引擎子进程登记与清扫 [V/I] |
| 33663 | `QuickstartStartCoordinator` | Quickstart 启动 |
| 34309-34367 | `ComposerDeliveryError` 等 | 回合投递错误 |
| 34784 | `AgentHost` | **核心**：会话、回合、权限/输入请求、job/spend 快照，几乎所有 `session:*` IPC 的落点 [V] |
| 53953/53984 | `AccountAuth(Error)` | 账户登录（Google/邮件链接，Firebase 配置）[V/I] |
| 55206 | `AcquisitionDeliveryStore` | 获客归因 |
| 55409 | `ManualKeyWriteRefused` | 手工 key 写入拒绝 |
| 55824 | `TasteTitleStore` | 品味条目标题 |
| 56048 | `EditorRenderController` | 编辑器渲染（`editorRender:*`）[V] |
| 56419 | `QuitCoordinator` | 退出协调 |
| 56530 | `HyperframesPreviewController` | 预览（`hfPreview:*`）[V] |
| 56908-57140 | PDF 读取（osascript PDFKit） | [V] |
| 57172 | `FeedbackService` | 问题反馈（`feedback:*`） |
| 57833 | `Outbox` | 遥测/记录离线发件箱（重试退避） |
| 58729-59760 | `Crc32c`、`CandidateRefusal`、`StarterRefusal`、`JobTooLarge`、`ArchiveRefused`、`MemberScanner`、`WorkflowSubmissionService` | 工作流打包上传（`workflowSubmit:*`） |
| 60292-62760 | 应用装配 | `app` 生命周期、窗口、IPC 注册（L61215 起）、更新器、协议 [V] |

## 3. 共享块与小 chunk

### 3.1 `chunks/workbookContents-ChzKjQX1.js`
- 导入 [V]：`node:crypto {createHash}`、`node:fs {rmSync, mkdirSync, createWriteStream, statfsSync}`、`node:stream {Transform}`、`node:stream/promises {pipeline}`、`node:path {join}`、`node:zlib {crc32}`、`yauzl`。
- 导出 [V]（L4979，别名→本名，共 161 个；按主题归类）：
  - 网关/渠道：`PROD_GATEWAY_URL(P)`、`STAGING_GATEWAY_URL(bn)`、`MANAGED_DEVELOPMENT(M)`、`envForGatewayUrl(b)`、`defaultGatewayUrlForChannel(bl)`、`validateStagingGatewayUrl(bk)`、`sanitizeStoredGatewayForChannel(bo)`、`channelAppIdentity(bm)`、`workspaceLeafForChannel(w)`、`switchGatewayKeys(bq)`、`pinGatewaySettings(br)`、`canUseNightlyUpdates(c)`。
  - 账户：`ACCOUNT_*_PATH(b2,b6,b7,b8,b9,bb)`、`KEY_METER_PATH(bc)`、`keyMeterFrom(bd)`、`topupSessionPath(bf)`、`accountStateFrom(b4)`、`buildAccountSnapshot(bi)`、`ALPHA_TERMS_VERSION(b5)`、`EMAIL_LINK_*(a_,b0,b1)`、`classifyEmailLinkSendFailure(ba)`、各类 `*_COPY` 文案、`manualKeyWriteRefusal(bg)`、`keyVerificationRetry(bt)`、`paidWorkBlockedFor(bs)`。
  - 文案/语气守卫：`VOICE_GUARD(V)`、`BANNED_USER_FACING_VOCABULARY(B)`、`friendlyErrorLine(f)`、`friendlyToolLine(aL)`、`engineFamilyLine(bj)`、`sanitizeErrorText(s)`、`safeProviderText(H)`、`sanitizeModelLine(aV)`。
  - 错误分类：`classifyError(a)`、`errorCauses(e)`、`runtimeFailureKind(r)`、`providerFailureKind(aG)`、`providerFailureCopy(at)`、`isRuntimeAuthFailure(ap)`、`isCodex*Rejected(aq,ar)`、`isClaudeTerms*(as,aB,aI)`、`isVideoclawCreditExhausted(aw)`、`isConversationTooLargeError(aK)`、`isStaleResumeError(ay)`、`modelAccountLimit*(ao,av)` 等。
  - 付费/计价：`classifyPaidGen(a7)`、`budgetSafePaidGen(aX)`、`normalizeEnginePaidCommand(aW)`、`unpricedPaidGenTools(u)`、`INPUT_BOUND_MINT_VIDEO_ROLES(aY)`、`SPEND_*_CODE(aa,ab)`、`normalizeSpendCeilingUsd(az)`、`videoclawCreditRefusal(aJ)`、`upstreamUnavailableRefusal(ac)`。
  - 命令解析/守卫（agent 发出的 shell 命令）：`CURL_HEADS(L)`、`CURL_FORCE_HEAD_FLAGS(K)`、`NESTED_CURL_LAUNCHERS(N)`、`PROVIDER_READ_ONLY_HEADS(J)`、`READER_SHELL_OUT_PATTERNS(_)`、`executableShellFragments(O)`、`resolveProviderInvocation(Q)`、`resolveNestedCurlArgs(T)`、`splitCurlTransfers(X)`、`curlMutatesTransfer(Y)`、`httpieOffline(R)`、`httpieIgnoresStdin(Z)`、`acquisitionOriginMatch(S)`、`withOutputPipefail(a6)`。
  - Agent 路由与模型：`AGENT_ROUTE_EVIDENCE(ag)`、`CLAUDE_MODEL_EVIDENCE(af)`、`isRecommendedClaudeRoute(ah)`、`isQualifiedCodexRoute(ai)`、`claudeRoute*(am,an)`、`codexRouteDiagnostic(aj)`、`claudeModelVerdict(al)`、`canonicalClaudeModelId(aM)`、`partitionDiscovered{Claude,Codex}Models(aN,aU)`、`claudeReasoningEffortChoices(aO)`、`resolveCodexReasoningEffort(aT)`、`codexPinRefusal(aR)`、`CODEX_CONTAINMENT(a4)`、`resolveCodexContainment(a5)`、`resolveAuthPool(aZ)`。
  - Claude Code 适配：`ClaudeCodeMessageAdapter(a3)`、`claudeCodePlanModeDenial($)`、`withClaudeCodeInternalToolsDisabled(a0)`、`CLAUDE_CODE_SELF_STARTING_TOOLS(a1)`、`anthropicClientJobCustomHeaders(a2)`、`isAnthropicPassthroughPath(a9)`、`CLIENT_JOB_ID_RE(ae)`、`isClientJobId(a8)`。
  - 素材入口限制：`INTAKE_FOLDER_MAX_*(d,g,h,i)`、`isAcceptedAsset(j)`、`assetKind(k)`、`assetExt(bu)`、`assetRejectReason(p)`、`folderRejectReason(q)`、`PDF_MAX_*(l,m,n)`、`isPdfName(A)`、`CLIPBOARD_IMAGE_MAX_*(C,o)`。
  - 归档/表格：`extractArchive(D)`、`archiveRejectReason(E)`、`ARCHIVE_MAX_{PDFS,WORKBOOKS}(F,G)`、`ARCHIVE_RATIO_FLOOR_BYTES(bC)`、`inspectZipContainer(bz)`、`storedZip(bA)`、`WORKBOOK_*(W,bv,bw,bx,bB,bD,bE,bF,by)`、`isWorkbookName(y)`、`isWorkbookContents(t)`、`workbookPage(v)`、`workbookSummary(x)`、`workbookRejectReason(z)`、`columnName(bG)`、`readWorkbookInWorker(bp)`（内部 `fork()` workbook worker，L4964）。
- 职责 [I]：这是 monorepo 中 `@videoclaw/shared` 被 Rollup 抽出的公共块（同一批常量也部分出现在 preload 中，如 `CLAUDE_MODEL_EVIDENCE`、`CURL_*`），因 `workbookWorker` 与 `index` 都依赖它而单独成块，文件名取了其中一个源模块名 `workbookContents`。

### 3.2 `chunks/compositionEdit-Dc8_ecez.js`
导出 [V]：`applyTextEdit as a`、`parseComposition as p`。被 `index.js`（`hfPreview:editApply`）与 `hyperframesPolicyWorker.js` 使用。职责 [V]：用正则读取合成 HTML 属性（`attr`/`num`）、HTML 转义/反转义，做"一处文本编辑"。

### 3.3 `chunks/rangeMedia-848zXGXe.js`
导入 `node:path {extname}`；导出 [V]：`VCMEDIA_SCHEME as V`（`{scheme:"vcmedia", privileges:{standard,secure,stream,supportFetchAPI,corsEnabled,bypassCSP:true}}`）、`mimeFor as m`、`planMediaResponse as p`（HTTP Range → 200/206/416 计划）。被 `index.js` 与 `hyperframesPreviewWorker.js` 使用。

## 4. Workers
| 文件 | 导入 [V] | 导出 [V] | 入口协议 / 职责 |
|---|---|---|---|
| `editorRenderWorker.js` | `node:child_process {spawn}` | `startEngineRender` | `process.parentPort` 消息 `start/cancel`；见 05 §7 |
| `hyperframesPreviewWorker.js` | `node:http {createServer}`、`node:fs`、`node:path`、`rangeMedia {p}` | `startPreviewServer` | `start/stop`；127.0.0.1 随机端口；`HTML_CSP` |
| `hyperframesPolicyWorker.js` | `node:fs`、`compositionEdit {p}`、`node:path` | 无 | `validate` → `{type:"result", ok}` |
| `workbookWorker.js` | `node:crypto`、`node:fs`、`node:fs/promises`、shared 块 14 个符号（`bu…bG`, `W`）、`xlsx`（`* as XLSX`） | `readOwnedWorkbook` | `read` → `{type:"result", result}`；`O_NOFOLLOW` 打开、sha256 校验后 `XLSX.read` |

## 5. Preload `preload/index.mjs`
- 导入 [V]：`electron {contextBridge, ipcRenderer, webUtils}`。
- 导出：无；副作用 `contextBridge.exposeInMainWorld("videoclaw", bridge)`。
- 内容 [V]：`IPC` 通道表（L2-224，183 条）、构建期常量残留（L225-245）、与 shared 重复的常量（`ENGINE_LINES`、`AGENT_ROUTE_EVIDENCE`、`CLAUDE_MODEL_EVIDENCE`、`FREE_GEN_TOOLS`、`CURL_*`、`BILLED_MEDIA_BY_KEY` 等，L246-829，大多只做 `new Set(...)`/`new Map(...)` 而不使用 —— Rollup 未能 tree-shake 的副作用残留 [I]）、`subscribe()` 与 `bridge`（L830-1057）。详见 04。

## 6. 渲染端
- `index.html` → `index-D5K1mOs0.js`（[V]）。
- `index-D5K1mOs0.js`：导入 无（内联全部依赖）；动态导入 `./module-D3rt-iOB.js`（posthog，L44624）、`./qaFixtures-E0ox5qGv.js`（L53592）。导出 [V]（供 qaFixtures 复用）：`INSECURE_STORAGE_COPY as I`、`raiseBudgetDescription as a`、`feedbackConsentState as f`、`partitionDiscoveredCodexModels as p`、`quotedSpendDescription as q`、`recommendedClaudeModelIds as r`、`settledAskFromPermission as s`、`unknownCostHoldDescription as u`。启动：`installConsoleRing(); installRendererCrashGuards(window); boot()` → `createRoot(#root).render(<App/>)`（L53580-53601）。对 `window.videoclaw` 的引用 272 处。
- 顶层 React 组件（[V] 名称，`^function [A-Z]`，共 ~314 个大写函数，节选）：`App, Shell, SetupGate, SetupModal, AccountGate, AccountModal, SignedOut, EmailLinkWait, Consent, LlmRouteGate, AgentHarnessChoice, CodexProviderChoice, CodexChatGptConnection, ClaudeCodeSignOut, OutputPanel, AssetsBrowser, HyperframesEditor, QuickstartPanel, StarterFlow, NewVideoWelcome, FirstUseTour, TourOverlay, LibraryPanel, CharactersPanel, CharacterVoices, TasteEditor, ProjectModal, CreateProjectModal, SessionPlanCard, PlanView, QuestionCard, RightsCard, RecorderCard, UploadCard, VoiceDictation, Markdown, ComposerAttachments, AskStack, MoneyStack, UnknownCostCard, SpendingMeter, TopUp, SpendCeilingField, ReportProblem, UploadWorkflow, LocalResetDialog, UpdateChannelSettings, InAppUpdateButton, RequiredUpdateCard, EnvironmentSwitcher, TranscriptRows, LiveProgress, ThinkingFold, ToolFrame …`
- 渲染端本地存储键（REA 观测 [V]）：`videoclaw.tour.v1`、`videoclaw.media-open.v1`、`videoclaw.active-session.v1`、`lastSeenSurveyDate`（posthog）。
- `module-D3rt-iOB.js`：posthog-js；导出 `PostHog, posthog(default), Compression, SurveyType, …`（L13009）。
- `qaFixtures-E0ox5qGv.js`：导入 index 的上述 8 个符号；导出 `installQaBridge`（实现一个假的 `window.videoclaw`）。

## 7. REA 交叉验证
`rea analyze-javascript-application`（6.4.0）对 12 个 `out/` 源文件的结果摘要见 `artifacts/rea/summary.json`、`artifacts/rea/selected-nodes.json`（原始 371 MB JSON 留在 box 上 `artifacts/rea/analyze-javascript-application.json`，已 gitignore）。REA 识别出：1 个 BrowserWindow（含 webPreferences）、1 个 contextBridge API、4 个 utilityProcess、161 个 IPC 操作（全部为 `IPC.x` 动态通道，REA 未解析出字面通道名，`main_handlers: 0`），0 个 native addon。本文与 04 的通道表以手工+脚本解析为准（184 条，覆盖 REA 的 161 个操作）。
