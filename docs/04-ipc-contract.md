# 04 · IPC 契约（主进程 ↔ 渲染进程）

> 来源：`app/reconstructed/preload/index.mjs`（`const IPC = {…}` 与 `const bridge = {…}`）和 `app/reconstructed/main/index.js`（第 354 行起同名 `const IPC`，以及 `ipcMain.handle/on(IPC.x, …)`、`sendToRenderer(IPC.x, …)`）。
> 表格由 `tools/ipc_table.py` + `tools/gen_ipc_doc.py` 从 bundle 中**机器抽取**（verified），再人工补充说明。行号均指 `app/reconstructed/main/index.js`。

## 1. 总览（verified）

| 项 | 数量 | 说明 |
|---|---|---|
| `IPC` 常量条目（main） | 184 | main 与 preload 中的 `IPC` 表逐字相同，唯一差异：main 多一个 `pathForFile: "file:pathForFile"`（preload 未用它，见下） |
| 渲染→主（请求/响应 `invoke` ↔ `ipcMain.handle`） | 157 | 全部经 `trackIpcRequests(ipcMain$1)` 包装（L2402），用于统计在途请求，`installAppUpdate` 时用 `pendingExcept` 判断是否还有其他请求在飞 |
| 渲染→主（单向 `send` ↔ `ipcMain.on`） | 3 | `permission:respond`、`permission:shown`、`quit:rendererState` |
| 主→渲染（`webContents.send` 推送，渲染侧 `ipcRenderer.on`） | 23 | 统一经 `createRendererEmitter()` 生成的 `sendToRenderer(channel, ...args)`（L55703 附近），窗口销毁时静默返回 false |
| `contextBridge` 暴露的全局对象 | 1 | `window.videoclaw`（`contextBridge.exposeInMainWorld("videoclaw", bridge)`，preload 末行） |
| `window.videoclaw` 方法数 | 184 | 183 个 IPC 绑定 + 1 个本地方法 `pathForFile(file) => webUtils.getPathForFile(file)`（不走 IPC） |
| 主进程中不经 `IPC` 常量的字符串通道 | 0 | `grep 'ipcMain\.(handle|on)\("'` 无结果 |

其它要点：
- **订阅模式**（preload L830）：`subscribe(channel, cb)` → `ipcRenderer.on(channel, (_e, payload) => cb(payload))`，返回取消订阅函数。因此**所有主→渲染事件只传第一个参数**（payload 单对象）。`accountEmailSent` 推送时不带 payload（`sendToRenderer(IPC.accountEmailSent)`，L61434）。
- **安全边界**（verified，REA 同样观测到）：`BrowserWindow` 的 `webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: join(__dirname, "../preload/index.mjs"), backgroundThrottling: !stagingFlightProfile?.hidden }`。preload 为 ESM（`.mjs`），因此 sandbox 必须为 false。
- **主进程不做 sender 校验**：未见 `event.senderFrame` / `event.sender` 校验（REA `sender_validation_observations: 0`；手工 grep 亦无）。
- preload 注释说明：账户相关通道"绝不在 IPC 上携带 ID token、refresh token 或明文 `vc_` key"（preload L102-103、L951-952）。
- QA 模式：渲染端 `boot()` 在 `!window.videoclaw && location.search` 含 `qa` 时动态加载 `qaFixtures-E0ox5qGv.js` 的 `installQaBridge()`，用假数据实现同一 `window.videoclaw` 接口（renderer index L53587-53598）。移植时可作为 IPC mock 参考。
- 自定义协议：`protocol.registerSchemesAsPrivileged([VCMEDIA_SCHEME])`（L60356）+ `protocol.handle("vcmedia", …)`（L62452）。`vcmedia://` 用于渲染端播放本地媒体（支持 Range，`planMediaResponse` 来自 `chunks/rangeMedia`）。它不是 IPC，但属于渲染↔主的数据通道。

## 2. 方向与载荷约定

- “渲染端签名”= preload 中 bridge 方法的形参（verified，原样抄录）。preload 直接把这些形参按顺序作为 `invoke(channel, ...args)` 的参数，因此主进程 handler 收到的是 `(_event, ...同样顺序的参数)`。
- “主进程 handler”= `ipcMain.handle/on(IPC.x, <首行>)` 的首行（verified，截断）。
- “推送载荷”= `sendToRenderer(IPC.x, <表达式>)` 的表达式（verified，截断）。
- 字段类型/形状的细节：**inferred**（需结合 handler 体与 zod/手写校验，见各行行号）。

## 3. 通道明细（按前缀分组）


### `sessionPlan:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `sessionPlan:read` | R→M | `readSessionPlan(scope)` | handle L61920: `(_e, scope) =>` → `host.readSessionPlan` |
| `sessionPlan:choose` | R→M | `chooseSessionPlan(scope, request)` | handle L61928: `(_e, scope, request2) =>` → `host.chooseSessionPlan` |
| `sessionPlan:retry` | R→M | `retrySessionPlan(scope)` | handle L61944: `(_e, scope) =>` → `host.retrySessionPlan` |
| `sessionPlan:changed` | M→R | `onSessionPlanChanged(cb)` *(subscribe)* | push L61096: `event),` |

### `memory:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `memory:read` | R→M | `readProjectMemory(scope)` | handle L61955: `(_e, scope) =>` → `host.readProjectMemory` |
| `memory:update` | R→M | `updateProjectMemory(scope, mutation)` | handle L61960: `(_e, scope, mutation) =>` → `host.updateProjectMemory` |
| `memory:undo` | R→M | `undoProjectMemory(scope, undoId, revision)` | handle L61965: `(_e, scope, undoId, revision2) =>` → `host.undoProjectMemory` |
| `memory:openSource` | R→M | `openProjectMemorySource(scope, source)` | handle L61970: `(_e, scope, source2) =>` → `host.resolveProjectMemorySource` |
| `memory:changed` | M→R | `onProjectMemoryChanged(cb)` *(subscribe)* | push L61098: `{` |

### `quickstart:*`（6）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `quickstart:catalog` | R→M | `quickstartCatalog()` | handle L61215: `() => {` → `quickstartCatalog.cached`, `quickstartCatalog.refresh` |
| `quickstart:impression` | R→M | `quickstartImpression(journeyId, catalogSha256, durationMs)` | handle L61254: `(_e, journeyId, catalogSha256, durationMs) => {` → `quickstartCatalog.load` |
| `quickstart:previewed` | R→M | `quickstartPreviewed(journeyId, starterId, durationMs)` | handle L61274: `(_e, journeyId, starterId, durationMs) => {` → `quickstartCatalog.starter`, `quickstartCatalog.load` |
| `quickstart:start` | R→M | `quickstartStart(req)` | handle L61294: `async (_e, request2) => {` 〔守卫: assertGenerationAllowed〕 |
| `quickstart:mark` | R→M | `quickstartMark(stage, durationMs, journeyId)` | handle L61250: `(_e, stage, durationMs, journeyId) => {` |
| `quickstart:catalogChanged` | M→R | `onQuickstartCatalogChanged(cb)` *(subscribe)* | push L61239: `fresh);` |

### `session:*`（17）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `session:create` | R→M | `createSession(req)` | handle L61690: `async (_e, req) => {` → `bootstrap.prepareNewSession`, `host.createSession` 〔守卫: assertGenerationAllowed〕 |
| `session:list` | R→M | `listSessions()` | handle L61697: `() => host.listSessions());` → `host.listSessions` |
| `session:reorder` | R→M | `reorderSessions(clientId, sessionIds)` | handle L61698: `(_e, clientId, sessionIds) =>` → `host.reorderSessions` |
| `session:rename` | R→M | `renameSession(sessionId, title)` | handle L61731: `(_e, sessionId, title) => host.renameSession(sessionId, title));` → `host.renameSession` |
| `session:deletionPlan` | R→M | `projectDeletionPlan(sessionId)` | handle L61732: `(_e, sessionId) => host.planProjectDeletion(sessionId));` → `host.planProjectDeletion` |
| `session:delete` | R→M | `deleteProject(sessionId)` | handle L61739: `async (_e, sessionId) => {` → `host.listSessions`, `host.deleteProject` |
| `session:send` | R→M | `sendMessage(sessionId, request)` | handle L61772: `(_e, sessionId, request2) => {` → `host.sendMessage` 〔守卫: assertGenerationAllowed〕 |
| `session:retry` | R→M | `retryTurn(sessionId)` | handle L61776: `(_e, sessionId) => {` → `host.retryTurn` 〔守卫: assertGenerationAllowed〕 |
| `session:interrupt` | R→M | `interrupt(sessionId, reason)` | handle L61780: `(_e, sessionId, reason) => host.interrupt(sessionId, reason));` → `host.interrupt` |
| `session:setPermissionMode` | R→M | `setPermissionMode(sessionId, mode, options)` | handle L61781: `(_e, sessionId, mode, options) =>` → `host.setPermissionMode` |
| `session:setModel` | R→M | `setSessionModel(sessionId, model)` | handle L61784: `(_e, sessionId, model) =>` → `host.setSessionModel` |
| `session:setReasoningEffort` | R→M | `setSessionReasoningEffort(sessionId, effort)` | handle L61787: `(_e, sessionId, effort) =>` → `host.setSessionReasoningEffort` |
| `session:history` | R→M | `getHistory(sessionId)` | handle L61747: `(_e, sessionId) => {` → `host.getHistory` |
| `session:unfinalize` | R→M | `unfinalizeSession(sessionId)` | handle L61765: `(_e, sessionId) => host.unfinalizeSession(sessionId));` → `host.unfinalizeSession` |
| `session:startContinuation` | R→M | `startContinuationChat(sessionId, clientActionId)` | handle L61766: `(_e, sessionId, clientActionId) =>` → `host.startContinuationChat` |
| `session:event` | M→R | `onSessionEvent(cb)` *(subscribe)* | push L61049: `{ sessionId, event }),` |
| `session:changed` | M→R | `onSessionsChanged(cb)` *(subscribe)* | push L61051: `sessions);` |

### `permission:*`（3）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `permission:respond` | R→M | `respondPermission(requestId, response)` *(send)* | on L61790: `(_e, requestId, response) =>` → `host.respondPermission` 〔守卫: paidWorkBlocked〕 |
| `permission:shown` | R→M | `notePermissionShown(requestId)` *(send)* | on L61803: `(_e, requestId) => host.noteSpendApprovalShown(requestId));` → `host.noteSpendApprovalShown` |
| `permission:request` | M→R | `onPermissionRequest(cb)` *(subscribe)* | push L61056: `req);`<br>push L61704: `(replayPendingInteractions 重放)` |

### `quit:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `quit:rendererState` | R→M | `noteQuitState(state)` *(send)* | on L61804: `(_e, state) => {` |

### `interaction:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `interaction:replayPending` | R→M | `replayPendingInteractions()` | handle L61701: `() => {` → `host.listPendingInteractions` |

### `file:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `file:openPath` | R→M | `openPath(path)` | handle L61917: `async (_e, path) => {` |
| `file:openExternal` | R→M | `openExternal(url)` | handle L61979: `async (_e, url) => {` |
| `file:revealItem` | R→M | `revealItem(path)` | handle L61982: `(_e, path) => {` |
| `file:saveItemAs` | R→M | `saveItemAs(path)` | handle L61985: `async (e, path) => {` |
| `file:pathForFile` | — | — | 未使用（preload 以 `webUtils.getPathForFile` 本地实现） |

### `analytics:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `analytics:playbackCompleted` | R→M | `playbackCompleted(path)` | handle L62003: `(_e, path) => {` |

### `client:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `client:list` | R→M | `listClients()` | handle L61817: `() => host.listClients());` → `host.listClients` |
| `client:create` | R→M | `createClient(name)` | handle L61818: `(_e, name) => host.createClient(name));` → `host.createClient` |
| `client:rename` | R→M | `renameClient(clientId, name)` | handle L61819: `(_e, clientId, name) => host.renameClient(clientId, name));` → `host.renameClient` |
| `client:remove` | R→M | `removeClient(clientId)` | handle L61820: `async (_e, clientId) => {` → `host.listSessions`, `host.removeClient` |
| `client:reorder` | R→M | `reorderClients(clientIds)` | handle L61826: `(_e, clientIds) => host.reorderClients(clientIds));` → `host.reorderClients` |

### `project:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `project:seedPack` | R→M | `seedProjectPack(clientId, cwd, brief)` | handle L61827: `(_e, clientId, cwd, brief) =>` → `host.seedProjectPack` |

### `taste:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `taste:list` | R→M | `listTaste(clientId, cwd)` | handle L61843: `(_e, clientId, cwd) =>` → `host.listClients` |
| `taste:commit` | R→M | `commitTaste(cwd, files)` | handle L61849: `(_e, cwd, files) => commitTaste(absCwd(cwd), files));` |
| `taste:decline` | R→M | `declineProposal(cwd, file, cards, antiText)` | handle L61850: `(_e, cwd, file, cards, antiText) =>` |
| `taste:titles` | R→M | `tasteTitles(entries)` | handle L61854: `(_e, entries) =>` → `tasteTitles.getTitles` 〔守卫: paidWorkBlocked〕 |

### `characters:*`（14）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `characters:list` | R→M | `charactersList(cwd)` | handle L61860: `(_e, cwd) =>` → `host.listCharacters` |
| `characters:voices:list` | R→M | `characterVoicesList(scope)` | handle L61873: `(_e, scope) =>` → `host.readCharacterVoices` |
| `characters:voice:approve` | R→M | `characterVoiceApprove(scope, id, sampleSha256)` | handle L61876: `(_e, scope, id2, sampleSha256) =>` → `host.approveCharacterVoice` |
| `characters:voice:remove` | R→M | `characterVoiceRemove(scope, id)` | handle L61879: `(_e, scope, id2) =>` → `host.removeCharacterVoice` |
| `characters:voices:changed` | M→R | `onCharacterVoicesChanged(cb)` *(subscribe)* | push L61104: `scope),` |
| `characters:create` | R→M | `charactersCreate(cwd, name, isSelf, photos)` | handle L61882: `async (_e, cwd, name, isSelf, photos) =>` → `host.createCharacter` |
| `characters:sheetPlan` | R→M | `charactersSheetPlan(cwd, slug)` | handle L61885: `(_e, cwd, slug) =>` → `host.characterSheetPlan` |
| `characters:sheetBuild` | R→M | `charactersSheetBuild(cwd, slug)` | handle L61888: `(_e, cwd, slug) => {` → `host.characterSheetBuild` 〔守卫: assertGenerationAllowed〕 |
| `characters:sheetStates` | R→M | `charactersSheetStates(cwd)` | handle L61892: `(_e, cwd) => host.characterSheetStates(absCwd(cwd)));` → `host.characterSheetStates` |
| `characters:approve` | R→M | `charactersApprove(cwd, slug)` | handle L61893: `(_e, cwd, slug) =>` → `host.approveCharacter` |
| `characters:retry` | R→M | `charactersRetry(cwd, slug)` | handle L61896: `(_e, cwd, slug) => {` → `host.retryCharacter` 〔守卫: assertGenerationAllowed〕 |
| `characters:discard` | R→M | `charactersDiscard(cwd, slug)` | handle L61900: `(_e, cwd, slug) =>` → `host.discardCharacter` |
| `characters:delete` | R→M | `charactersDelete(cwd, slug)` | handle L61903: `(_e, cwd, slug) => host.deleteCharacter(absCwd(cwd), slug));` → `host.deleteCharacter` |
| `characters:build` | M→R | `onCharacterBuild(cb)` *(subscribe)* | push L61092: `evt),` |

### `job:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `job:get` | R→M | `getJobSnapshot(sessionId)` | handle L61751: `(_e, sessionId) =>` → `host.getJobSnapshot` |
| `job:originalContext` | R→M | `getOriginalContext(sessionId)` | handle L61754: `(_e, sessionId) => host.getOriginalContext(sessionId));` → `host.getOriginalContext` |
| `job:snapshot` | M→R | `onJobSnapshot(cb)` *(subscribe)* | push L61079: `{ sessionId, snapshot: snapshot2 });` |
| `job:adopt` | R→M | `adoptJob(sessionId, jobId)` | handle L61759: `(_e, sessionId, jobId) => host.adoptJob(sessionId, jobId));` → `host.adoptJob` |
| `job:historicalSnapshot` | R→M | `historicalJobSnapshot(sessionId)` | handle L61769: `(_e, sessionId) =>` → `host.historicalJobSnapshot` |

### `spend:*`（3）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `spend:get` | R→M | `getSpendSnapshot(sessionId)` | handle L61755: `(_e, sessionId) => host.getSpendSnapshot(sessionId));` → `host.getSpendSnapshot` |
| `spend:setCeiling` | R→M | `setSpendCeiling(sessionId, usd, options)` | handle L61756: `(_e, sessionId, usd, options) =>` → `host.setSpendCeiling` |
| `spend:snapshot` | M→R | `onSpendSnapshot(cb)` *(subscribe)* | push L61087: `{ sessionId, snapshot: snapshot2 }),` |

### `outbox:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `outbox:authoritySnapshot` | R→M | `outboxAuthoritySnapshot()` | handle L61709: `() => outbox.authoritySnapshot());` → `outbox.authoritySnapshot` |

### `telemetry:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `telemetry:bindReplay` | R→M | `telemetryBindReplay(binding)` | handle L61710: `async (_e, binding) => {` |

### `version:*`（2）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `version:approve` | R→M | `approveVersion(sessionId, n)` | handle L61760: `(_e, sessionId, n) => {` → `host.approveVersion` 〔守卫: assertGenerationAllowed〕 |
| `version:revertFinal` | R→M | `revertFinal(sessionId, n)` | handle L61764: `(_e, sessionId, n) => host.revertFinal(sessionId, n));` → `host.revertFinal` |

### `settings:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `settings:get` | R→M | `getSettings()` | handle L61321: `async () => {` → `settings.get` 〔守卫: ensureActiveAlphaConsent〕 |
| `settings:set` | R→M | `setSettings(patch)` | handle L61680: `async (_e, patch) => {` → `settings.get`, `settings.patch`, `host.onLlmRouteChanged` |
| `settings:saveGatewayKey` | R→M | `saveGatewayKey(key)` | handle L61393: `async (_e, key) => {` → `credentials.hasSignedInOnce`, `settings.legacySignedInOnceFor`, `credentials.setActiveKey` |
| `settings:switchGateway` | R→M | `switchGateway(url)` | handle L61377: `async (_e, url) => {` → `settings.patch`, `settings.get` |

### `app:*`（10）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `app:restart` | R→M | `restartApp()` | handle L61375: `restartApp);` |
| `app:update:preferences` | R→M | `getAppUpdatePreferences()` | handle L61330: `async () => {` → `updatePreferences.get` |
| `app:update:channel` | R→M | `setAppUpdateChannel(channel)` | handle L61334: `async (_event, channel) => {` → `updatePreferences.set` |
| `app:update:state` | R→M | `getAppUpdateState()` | handle L61340: `() =>` |
| `app:update:state-changed` | M→R | `onAppUpdateState(cb)` *(subscribe)* | push L62544: `state),` |
| `app:update:download` | R→M | `downloadAppUpdate()` | handle L61362: `async () =>` |
| `app:update:install` | R→M | `installAppUpdate()` | handle L61367: `async () =>` |
| `app:update:get` | R→M | `getUpdateInfo()` | handle L61370: `() => currentUpdateInfo);` |
| `app:update:check` | R→M | `checkForUpdates()` | handle L61371: `() => updateChecker?.checkNow() ?? { kind: "failed", currentVersion: app.getVersion() },` |
| `app:update` | M→R | `onUpdateInfo(cb)` *(subscribe)* | push L60476: `null);`<br>push L62602: `info);` |

### `gateway:*`（3）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `gateway:verify` | R→M | `verifyGatewayKey(key)` | handle L61376: `(_e, key) => verifyKeyAt(openedGatewayUrl, key));` |
| `gateway:meter` | R→M | `keyMeter()` | handle L61593: `async () => {` |
| `gateway:topup` | R→M | `topUp(usd)` | handle L61596: `async (_e, usd) => {` |

### `account:*`（15）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `account:snapshot` | R→M | `accountSnapshot()` | handle L61406: `() => (account.loaded ? account : resolveAccount()));` |
| `account:refresh` | R→M | `accountRefresh()` | handle L61407: `() => resolveAccount());` |
| `account:signInGoogle` | R→M | `accountSignInGoogle()` | handle L61408: `async () => {` → `accountAuth.signInWithGoogle` |
| `account:signInEmail` | R→M | `accountSignInEmail(email)` | handle L61431: `async (_e, email) => {` → `accountAuth.signInWithEmailLink` |
| `account:resendEmail` | R→M | `accountResendEmail()` | handle L61420: `async () => {` → `accountAuth.resendEmailLink` |
| `account:cancelSignIn` | R→M | `accountCancelSignIn()` | handle L61428: `() => {` → `accountAuth.cancelInteractiveSignIn` |
| `account:emailSent` | M→R | `onAccountEmailSent(cb)` *(subscribe)* | push L61434: `(无载荷)` |
| `account:signOut` | R→M | `accountSignOut()` | handle L61445: `async () => {` → `host.stopAuthenticatedWork`, `accountAuth.signOut` |
| `account:consent` | R→M | `accountConsent(termsVersion)` | handle L61498: `async (_e, termsVersion) => {` → `accountAuth.acceptConsent` |
| `account:ensureAccess` | R→M | `accountEnsureAccess()` | handle L61508: `async () => {` |
| `account:mintKey` | R→M | `accountMintKey()` | handle L61557: `async () => {` → `accountAuth.issueKey` |
| `account:claimKey` | R→M | `accountClaimKey(key)` | handle L61574: `async (_e, key) => {` → `accountAuth.claimKey` |
| `account:localResetPrepare` | R→M | `accountLocalResetPrepare()` | handle L61496: `() => localReset.prepare());` → `localReset.prepare` |
| `account:localResetCommit` | R→M | `accountLocalResetCommit(planId)` | handle L61497: `(_e, planId) => localReset.commit(planId));` → `localReset.commit` |
| `account:changed` | M→R | `onAccountChanged(cb)` *(subscribe)* | push L60839: `account);` |

### `engine:*`（21）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `engine:claudeCodeStatus` | R→M | `claudeCodeStatus()` | handle L61603: `() => host.claudeCodeStatus());` → `host.claudeCodeStatus` |
| `engine:claudeCodeConnect` | R→M | `claudeCodeConnect()` | handle L61604: `() => host.connectClaudeCode());` → `host.connectClaudeCode` |
| `engine:claudeCodeConnectCancel` | R→M | `claudeCodeConnectCancel()` | handle L61605: `() => host.cancelClaudeCodeConnect());` → `host.cancelClaudeCodeConnect` |
| `engine:claudeCodeSignOutImpact` | R→M | `claudeCodeSignOutImpact()` | handle L61606: `() => host.claudeCodeSignOutImpact());` → `host.claudeCodeSignOutImpact` |
| `engine:claudeCodeSignOut` | R→M | `claudeCodeSignOut()` | handle L61607: `() => host.signOutClaudeCode());` → `host.signOutClaudeCode` |
| `engine:llmRouteReadiness` | R→M | `llmRouteReadiness(sessionId)` | handle L61608: `(_e, sessionId) => host.llmRouteReadiness(sessionId));` → `host.llmRouteReadiness` |
| `engine:codexStatus` | R→M | `codexStatus()` | handle L61609: `() => host.codexStatus());` → `host.codexStatus` |
| `engine:codexConnectChatGpt` | R→M | `codexConnectChatGpt()` | handle L61610: `async () => {` → `host.connectCodexChatGpt` |
| `engine:codexConnectCancel` | R→M | `codexConnectCancel()` | handle L61619: `() => host.stopPendingCodexLogin());` → `host.stopPendingCodexLogin` |
| `engine:codexDisconnectImpact` | R→M | `codexDisconnectImpact()` | handle L61620: `() => host.codexDisconnectImpact());` → `host.codexDisconnectImpact` |
| `engine:codexDisconnectChatGpt` | R→M | `codexDisconnectChatGpt()` | handle L61621: `() => host.disconnectCodexChatGpt());` → `host.disconnectCodexChatGpt` |
| `engine:codexModels` | R→M | `codexModels()` | handle L61622: `() => host.codexModels(true));` → `host.codexModels`, `host.setCreditHandoffEligibility` 〔守卫: paidWorkBlocked〕 |
| `engine:claudeModels` | R→M | `claudeModels()` | handle L61659: `() => host.claudeModels(true));` → `host.claudeModels` |
| `engine:codexHandoffOffer` | R→M | `codexHandoffOffer(sessionId)` | handle L61660: `(_e, sessionId) => host.codexHandoffOffer(sessionId));` → `host.codexHandoffOffer` |
| `engine:continueOnCodex` | R→M | `continueOnCodex(sessionId, clientActionId)` | handle L61661: `(_e, sessionId, clientActionId) =>` → `host.continueOnCodex` |
| `engine:creditHandoffOffer` | R→M | `creditHandoffOffer(sessionId)` | handle L61655: `(_e, sessionId) => host.creditHandoffOffer(sessionId));` → `host.creditHandoffOffer` |
| `engine:continueOnCredits` | R→M | `continueOnCredits(sessionId, request)` | handle L61656: `(_e, sessionId, request2) =>` → `host.continueOnCredits` |
| `engine:agentProviderKeyStatus` | R→M | `agentProviderKeyStatus()` | handle L61664: `() => currentAgentProviderKeyStatus());` |
| `engine:saveAgentProviderKey` | R→M | `saveAgentProviderKey(provider, key)` | handle L61665: `(_e, provider, key) => {` → `credentials.providerKey`, `host.onCodexProviderCredentialChanged`, `credentials.setProviderKey` |
| `engine:pendingToast` | R→M | `enginePendingToast()` | handle L61316: `() => {` |
| `engine:updated` | M→R | `onEngineUpdated(cb)` *(subscribe)* | push L61161: `{ version: version2 })) {` |

### `input:*`（2）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `input:respond` | R→M | `respondInput(requestId, response)` | handle L61830: `(_e, requestId, r) =>` → `host.respondInput` 〔守卫: paidWorkBlocked〕 |
| `input:request` | M→R | `onInputRequest(cb)` *(subscribe)* | push L61069: `req);`<br>push L61704: `(replayPendingInteractions 重放)` |

### `media:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `media:requestMic` | R→M | `requestMicAccess()` | handle L61904: `async () => {` |
| `media:voiceDictationStatus` | R→M | `voiceDictationStatus()` | handle L61910: `() => voiceDictationStatus());` |
| `media:transcribeVoice` | R→M | `transcribeVoice(sessionId, recordingId, audio)` | handle L61911: `(_e, sessionId, recordingId, audio) => {` → `host.transcribeVoice` |
| `media:discardVoice` | R→M | `discardVoice(sessionId, recordingId)` | handle L61914: `(_e, sessionId, recordingId) => {` → `host.discardVoice` |

### `library:*`（9）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `library:stats` | R→M | `libraryStats(clientId, cwd)` | handle L62065: `(_e, clientId, cwd) =>` |
| `library:scan` | R→M | `libraryScan(clientId, cwd)` | handle L62068: `(_e, clientId, cwd) =>` |
| `library:addSource` | R→M | `libraryAddSource(clientId, cwd, type, path)` | handle L62071: `async (_e, clientId, cwd, type, path) =>` |
| `library:removeSource` | R→M | `libraryRemoveSource(clientId, cwd, path, purge)` | handle L62085: `(_e, clientId, cwd, path, purge) =>` |
| `library:sync` | R→M | `librarySync(clientId, cwd)` | handle L62092: `(_e, clientId, cwd) =>` |
| `library:search` | R→M | `librarySearch(clientId, cwd, query, type, tenants)` | handle L62115: `(_e, clientId, cwd, query2, type, tenants) =>` |
| `library:preview` | R→M | `libraryPreview(cwd, sourceFile, inSec, outSec)` | handle L62122: `async (_e, cwd, sourceFile, inSec, outSec) => {` |
| `library:setTenant` | R→M | `librarySetTenant(clientId, tenant)` | handle L62154: `(_e, clientId, tenant) =>` → `host.setClientTenant` |
| `library:syncProgress` | M→R | `onLibrarySync(cb)` *(subscribe)* | push L62099: `{`<br>push L62106: `{` |

### `bootstrap:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `bootstrap:status` | R→M | `bootstrapStatus()` | handle L61300: `() => bootstrap.status());` → `bootstrap.status` |
| `bootstrap:run` | R→M | `bootstrapRun()` | handle L61301: `() => bootstrap.runAll());` → `bootstrap.runAll` |
| `bootstrap:revertEngine` | R→M | `bootstrapRevertEngine()` | handle L61302: `() => bootstrap.revertEngine());` → `bootstrap.revertEngine` |
| `bootstrap:revealSetupLog` | R→M | `bootstrapRevealSetupLog()` | handle L61303: `() => {` → `bootstrap.setupLogPath`, `settings.get`, `settings.patch` |
| `bootstrap:progress` | M→R | `onBootstrapProgress(cb)` *(subscribe)* | push L61142: `p),` |

### `intake:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `intake:pickFiles` | R→M | `intakePickFiles(scope)` | handle L62157: `async (_event, scope) => {` → `host.listSessions` |

### `attachment:*`（12）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `attachment:stage` | R→M | `attachmentStage(req)` | handle L62193: `(_e, req) =>` → `host.stageComposerAttachments` |
| `attachment:list` | R→M | `attachmentList(sessionId)` | handle L62196: `(_e, sessionId) => host.listComposerAttachments(sessionId));` → `host.listComposerAttachments` |
| `attachment:ownership` | R→M | `attachmentOwnership(sessionId, attachmentId)` | handle L62206: `(_e, sessionId, attachmentId) =>` → `host.composerAttachmentOwnership` |
| `attachment:remove` | R→M | `attachmentRemove(sessionId, attachmentId)` | handle L62209: `(_e, sessionId, attachmentId) =>` → `host.removeComposerAttachment` |
| `attachment:retry` | R→M | `attachmentRetry(sessionId, attachmentId)` | handle L62212: `(_e, sessionId, attachmentId) =>` → `host.retryComposerAttachment` |
| `attachment:destination` | R→M | `attachmentDestination(sessionId, attachmentIds, destination)` | handle L62215: `(_e, sessionId, attachmentIds, destination) =>` → `host.setComposerAttachmentDestination` |
| `attachment:pasteImage` | R→M | `attachmentPasteImage(sessionId, destination, png)` | handle L62272: `(_e, sessionId, destination, png) => {` → `host.assertComposerWritable` |
| `attachment:voiceNote` | R→M | `attachmentVoiceNote(sessionId, recordingId, audio)` | handle L62265: `async (_e, sessionId, recordingId, audio) => {` → `host.assertComposerWritable`, `host.stageVoiceNote` |
| `attachment:captureMoment` | R→M | `attachmentCaptureMoment(req)` | handle L62220: `(_e, request2) =>` → `host.assertComposerWritable`, `host.listSessions` |
| `attachment:momentPreview` | R→M | `attachmentMomentPreview(sessionId, attachmentId, full)` | handle L62249: `(_e, sessionId, attachmentId, full) =>` → `host.composerMomentPreview` |
| `attachment:preview` | R→M | `attachmentPreview(sessionId, attachmentId, full)` | handle L62256: `(_e, sessionId, attachmentId, full) =>` → `host.composerAttachmentPreview` |
| `attachment:changed` | M→R | `onAttachmentChanged(cb)` *(subscribe)* | push L61045: `attachment),`<br>push L61197: `attachment),`<br>push L62191: `attachment);` |

### `materials:*`（2）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `materials:preview` | R→M | `materialPreview(sessionId, id)` | handle L62197: `(_e, sessionId, id2) => {` → `host.materialPreview` |
| `materials:changed` | M→R | `onMaterialsChanged(cb)` *(subscribe)* | push L61095: `ledger),` |

### `stats:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `stats:stageEtas` | R→M | `getStageEtas(cwd)` | handle L62297: `(_e, cwd) => computeStageEtas(absCwd(cwd)));` → `host.listSessions`, `host.getJobSnapshot`, `host.mediaRecoveryEvidence` |

### `window:*`（1）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `window:state` | M→R | `onWindowState(cb)` *(subscribe)* | push L60577: `{ fullscreen });` |

### `feedback:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `feedback:capture` | R→M | `feedbackCapture(req)` | handle L62341: `async (_e, req) => {` → `feedback.capture` |
| `feedback:submit` | R→M | `feedbackSubmit(req)` | handle L62346: `(_e, req) => feedback.submit(req));` → `feedback.submit` |
| `feedback:discard` | R→M | `feedbackDiscard(reportId)` | handle L62347: `(_e, reportId) => {` → `feedback.discard` |
| `feedback:grantUsageSharing` | R→M | `feedbackGrantUsageSharing()` | handle L62350: `() => feedback.grantUsageSharing());` → `feedback.grantUsageSharing`, `host.listSessions`, `host.beginWorkflowSubmission` |

### `workflowSubmit:*`（2）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `workflowSubmit:eligibility` | R→M | `workflowSubmitEligibility()` | handle L62398: `() => workflowSubmission.eligibility());` → `workflowSubmission.eligibility` |
| `workflowSubmit:start` | R→M | `workflowSubmit(req)` | handle L62399: `(_e, req) => workflowSubmission.submit(req));` → `workflowSubmission.submit` |

### `editorRender:*`（4）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `editorRender:start` | R→M | `editorRenderStart(req)` | handle L62423: `(_e, req) => editorRender.start(req));` → `editorRender.start` |
| `editorRender:cancel` | R→M | `editorRenderCancel(requestId)` | handle L62424: `(_e, requestId) => editorRender.cancel(requestId));` → `editorRender.cancel` |
| `editorRender:state` | R→M | `editorRenderState()` | handle L62425: `() => editorRender.state());` → `editorRender.state` |
| `editorRender:event` | M→R | `onEditorRenderEvent(cb)` *(subscribe)* | push L62412: `event);` |

### `hfPreview:*`（5）

| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |
|---|---|---|---|
| `hfPreview:available` | R→M | `hfPreviewAvailable(sessionId, jobId)` | handle L62437: `(_e, sessionId, jobId) =>` → `hfPreview.availability` |
| `hfPreview:start` | R→M | `hfPreviewStart(req)` | handle L62440: `(_e, req) => hfPreview.start(req));` → `hfPreview.start` |
| `hfPreview:stop` | R→M | `hfPreviewStop()` | handle L62441: `() => {` → `hfPreview.stop` |
| `hfPreview:editApply` | R→M | `hfEditApply(req)` | handle L62444: `(_e, req) => hfPreview.applyEdit(req));` → `hfPreview.applyEdit`, `host.setJobBusyProbe`, `editorRender.state` |
| `hfPreview:event` | M→R | `onHfPreviewEvent(cb)` *(subscribe)* | push L62432: `event),` |

## 4. 关键语义补充

### 4.1 委托关系（verified）
`main/index.js` L61043 创建 `host = new AgentHost({...回调...}, join(userData,"sessions.json"), activeSettings, outbox, undefined, agentGatewayProxy)`。绝大多数 `session:*`、`job:*`、`version:*`、`spend:*`、`permission:*`、`input:*`、`engine:*` 通道只是把参数原样转发给 `host.<方法>`（见上表 → 列）。`bootstrap:*` 转给 `Bootstrap` 实例（L9727 `class Bootstrap`）。账户类转给 `AccountAuth`（L53984）。

### 4.2 主→渲染推送的载荷形状（verified，来自 AgentHost 回调接线 L61043-61105）
| 通道 | 载荷 |
|---|---|
| `session:event` | `{ sessionId, event }` |
| `session:changed` | `sessions`（会话元数据数组） |
| `permission:request` | `req`；`req.kind ∈ {"money","budget","question",…}`（notify 文案据此分支） |
| `input:request` | `req`；`req.kind ∈ {"voiceover", 其它=files}` |
| `job:snapshot` | `{ sessionId, snapshot }` |
| `spend:snapshot` | `{ sessionId, snapshot }` |
| `characters:build` | `evt`（按 slug 的构建进度） |
| `materials:changed` | `ledger` |
| `sessionPlan:changed` | `event` |
| `memory:changed` | `{ scope: { clientId, ...authority }, change, sessionId, notice? }` |
| `characters:voices:changed` | `scope` |
| `attachment:changed` | `attachment` |
| `bootstrap:progress` | `p`（L61142） |
| `engine:updated` | `{ version }`（L61161） |
| `account:changed` | `account`（L60839） |
| `account:emailSent` | 无载荷 |
| `window:state` | `{ fullscreen }`（L60577） |
| `app:update` | `info` 或 `null`（L60476/L62602） |
| `app:update:state-changed` | `state`（`{status, version, percent, message}`，见 `getAppUpdateState` 默认值 L61341） |
| `library:syncProgress` | 对象（L62099/L62106） |
| `editorRender:event` | `event`（L62412） |
| `hfPreview:event` | `event`（L62432） |
| `quickstart:catalogChanged` | `fresh`（已验签的目录快照，L61239） |

### 4.3 `session:event` 的 `event.kind`（inferred）
渲染端 `window.videoclaw.onSessionEvent` 订阅点：renderer `index-D5K1mOs0.js` L31694、L49075。渲染端比较过的 `kind` 值（grep `e.kind === "…"`，可能混入其它对象的 kind）：
`ask_settled, assistant_text, background_end, error, failure_resolved, hook_warning, input_resolved, late_result, material_arrived, memory_noted, message_time, permission_resolved, policy_changed, preference_noted, result, text_delta, tool_end, tool_start, tool_summary, transcript_retract, user_text, workflow_advisor`。
精确的事件联合类型需要从 `AgentHost`（L34784 起）中所有 `sessionEvent(...)` 调用逐一整理 —— **待办**。

### 4.4 生成/付费守卫（verified）
- `assertGenerationAllowed()`：`session:send`、`session:retry`、`version:approve` 等在转发前调用；被阻止时抛错（账户被封/需要强制更新等）。
- `permission:respond`：若 `paidWorkBlocked()`，主进程把渲染端的 response **改写**为 `{behavior:"deny", message: 需更新 ? "Update [App] before starting new work." : ACCOUNT_BLOCKED_COPY}`（L61790-61802）。
- `settings:get` 前先 `ensureActiveAlphaConsent()`（L61321）。
