import json,collections
d=json.load(open('/workspace/videoclaw/tools/ipc.json'))
groups=collections.OrderedDict()
for o in d: groups.setdefault(o['channel'].split(':')[0],[]).append(o)
def esc(s): return s.replace('|','\\|').replace('\n',' ')
cnt=collections.Counter(o['dir'] for o in d)
nh=sum(1 for o in d for h in o['handlers'] if h[0]=='handle'); non=sum(1 for o in d for h in o['handlers'] if h[0]=='on')
out=[]
out.append(f"""# 04 · IPC 契约（主进程 ↔ 渲染进程）

> 来源：`app/reconstructed/preload/index.mjs`（`const IPC = {{…}}` 与 `const bridge = {{…}}`）和 `app/reconstructed/main/index.js`（第 354 行起同名 `const IPC`，以及 `ipcMain.handle/on(IPC.x, …)`、`sendToRenderer(IPC.x, …)`）。
> 表格由 `tools/ipc_table.py` + `tools/gen_ipc_doc.py` 从 bundle 中**机器抽取**（verified），再人工补充说明。行号均指 `app/reconstructed/main/index.js`。

## 1. 总览（verified）

| 项 | 数量 | 说明 |
|---|---|---|
| `IPC` 常量条目（main） | {len(d)} | main 与 preload 中的 `IPC` 表逐字相同，唯一差异：main 多一个 `pathForFile: "file:pathForFile"`（preload 未用它，见下） |
| 渲染→主（请求/响应 `invoke` ↔ `ipcMain.handle`） | {nh} | 全部经 `trackIpcRequests(ipcMain$1)` 包装（L2402），用于统计在途请求，`installAppUpdate` 时用 `pendingExcept` 判断是否还有其他请求在飞 |
| 渲染→主（单向 `send` ↔ `ipcMain.on`） | {non} | `permission:respond`、`permission:shown`、`quit:rendererState` |
| 主→渲染（`webContents.send` 推送，渲染侧 `ipcRenderer.on`） | {cnt['M→R']} | 统一经 `createRendererEmitter()` 生成的 `sendToRenderer(channel, ...args)`（L55703 附近），窗口销毁时静默返回 false |
| `contextBridge` 暴露的全局对象 | 1 | `window.videoclaw`（`contextBridge.exposeInMainWorld("videoclaw", bridge)`，preload 末行） |
| `window.videoclaw` 方法数 | 184 | 183 个 IPC 绑定 + 1 个本地方法 `pathForFile(file) => webUtils.getPathForFile(file)`（不走 IPC） |
| 主进程中不经 `IPC` 常量的字符串通道 | 0 | `grep 'ipcMain\\.(handle|on)\\("'` 无结果 |

其它要点：
- **订阅模式**（preload L830）：`subscribe(channel, cb)` → `ipcRenderer.on(channel, (_e, payload) => cb(payload))`，返回取消订阅函数。因此**所有主→渲染事件只传第一个参数**（payload 单对象）。`accountEmailSent` 推送时不带 payload（`sendToRenderer(IPC.accountEmailSent)`，L61434）。
- **安全边界**（verified，REA 同样观测到）：`BrowserWindow` 的 `webPreferences = {{ contextIsolation: true, nodeIntegration: false, sandbox: false, preload: join(__dirname, "../preload/index.mjs"), backgroundThrottling: !stagingFlightProfile?.hidden }}`。preload 为 ESM（`.mjs`），因此 sandbox 必须为 false。
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
""")
for g,items in groups.items():
    out.append(f"\n### `{g}:*`（{len(items)}）\n")
    out.append("| 通道 | 方向 | `window.videoclaw` 方法(形参) | 主进程 handler（行号: 首行） / 推送（行号: 载荷） |")
    out.append("|---|---|---|---|")
    for o in items:
        b='<br>'.join(f"`{n}({a})`" + (" *(send)*" if k=='send' else " *(subscribe)*" if k=='subscribe' else "") for n,a,k in o['bridge']) or '—'
        hs=[f"{'handle' if k=='handle' else 'on'} L{l}: `{esc(s)}`"+(" → "+", ".join(f"`{c}`" for c in dd['calls']) if dd['calls'] else "")+(" 〔守卫: "+", ".join(dd['guards'])+"〕" if dd['guards'] else "") for (k,l,s),dd in zip(o['handlers'],o.get('delegates',[{}]*9))]
        ss=[f"push L{l}: `{esc(s) or '(无载荷)'}`" for l,s in o['sends']]
        h='<br>'.join(hs+ss) or ('未使用（preload 以 `webUtils.getPathForFile` 本地实现）' if o['channel']=='file:pathForFile' else '—')
        out.append(f"| `{o['channel']}` | {o['dir']} | {b} | {h} |")
open('/workspace/videoclaw/repo/docs/04-ipc-contract.md','w').write('\n'.join(out)+'\n')
print('ok')
tail = """
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
- `permission:respond`：若 `paidWorkBlocked()`，主进程把渲染端的 response **改写**为 `{behavior:"deny", message: 需更新 ? "Update Videoclaw before starting new work." : ACCOUNT_BLOCKED_COPY}`（L61790-61802）。
- `settings:get` 前先 `ensureActiveAlphaConsent()`（L61321）。
"""
with open('/workspace/videoclaw/repo/docs/04-ipc-contract.md','a') as f: f.write(tail)
