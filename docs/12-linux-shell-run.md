# 12 · Linux 上运行 Electron 外壳（对接真实引擎）

> 结论：移植版 Electron 主进程（Electron 42.11.9，box 上 xvfb 无头运行）在 Linux 上启动，preload 暴露 184 个方法。经**真实的 renderer → preload → ipcMain** 路径做了以下验证：
> 1. `bootstrap:run` 全流程真实执行（安装原版引擎 tarball、uv venv、remotion/hyperframes `npm ci`、工作区、doctor、激活）；
> 2. `editorRender:start` 端到端产出视频：utilityProcess worker → `uv run python tools/hyperframes_render.py` → HyperFrames CLI → 无头 Chrome → `final_hyperframes.mp4`，并收到 `completed` 推送事件。
> 日志：`artifacts/linux-run/shell-smoke.log`。

## 1. 构建与运行

```bash
export PATH=/home/box/.n/bin:$PATH          # node v24（CI 用 22）
cd port
npm ci                                       # 会下载 Electron 二进制（node_modules/electron/dist）
npm run build                                # gen（IPC 契约 + 逐字节切片）→ tsc → esbuild
npm test                                     # 76 项
# 交互运行（有桌面时）：npm run start
# 无头冒烟（box / CI）：
bash ../tools/linux_baseline.sh /tmp/vc            # 先准备 /tmp/vc/bootstrap（并跑引擎基线）
bash ../tools/linux_shell_smoke.sh /tmp/vc/bootstrap /tmp/vc-shell-home /tmp/shell-smoke.log
```

`linux_shell_smoke.sh` 用临时 `HOME` 隔离：userData = `$HOME/.config/videoclaw-port`（Electron 默认，应用名取自 `port/package.json` 的 `name`），工作区 = `$HOME/Videoclaw`（原版 `workspaceLeafForChannel("prod")`）。Electron 需要 `--no-sandbox`（box 上 `chrome-sandbox` 没有 setuid root；这是运行环境问题，与移植无关）。

环境变量（原版 vs PORT-NEW）：

| 变量 | 来源 | 作用 |
|---|---|---|
| `VIDEOCLAW_ENGINE_DIST` | 原版（L9301） | 开发态引擎来源目录 |
| `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1` | PORT-NEW | `bootstrap:run` 走真实 `BootstrapCore.runAll()` |
| `VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1` | PORT-NEW | 接受“只有 `gateway` 红”的 doctor 报告并继续激活（原版要求 doctor 全绿，gateway 需要凭据） |
| `VIDEOCLAW_PORT_SMOKE=1` | PORT-NEW | 页面加载后由主进程 `executeJavaScript` 调用 `window.videoclaw.*`，结果以 `[smoke]` 行打印，然后退出 |
| `VIDEOCLAW_PORT_SMOKE_SESSION` / `_JOB` | PORT-NEW | 冒烟中 `editorRender:start` 用的 session/job |

## 2. 本阶段移植的会话层

editorRender 原先被三件事卡住：没有会话（`unknown-session`）、`engineSessionEnv` 未移植、引擎从未激活。现状：

- **`engineSessionEnv`（L9380-9418）**：`port/src/main/engine/session.ts` 逐行移植；模块级依赖注入。`engineGatewaySessionConfig`、Studio bundle store 未配置时与原版初始状态一致，返回 `{}`。与原函数文本做差分测试（`VIDEOCLAW_CONTEXT_EPOCH` 是随机 UUID，比较时排除）。
- **`validateEngineSessionContext` / `validateInstalledEngineSessionContext`（L4188/L4191）及其依赖**：逐字节切片生成（`session-context.generated.ts`），唯一替换是 `.venv/bin/python` → `venvPython()`。依赖包括 REQUIRED_SESSION_CONTEXT_FILES、validateCanonicalSettings、readRequired、parseSessionLawsVersion，以及 workbookContents 分块中的 VOICE_GUARD/BANNED 词表。
- **会话宿主**：只移植了只读子集 `SessionRegistry`，即 `AgentHost.loadRegistry` 的修复逻辑（L35661-35830：status→idle、interrupted 标记、私有字段剔除、非法/缺失 jobId 清理、"New session"→"New video"），加上 `listSessions` 的排序（L38348）和 `liveSession`（L62403）。数据源与原版相同：`userData/sessions.json`（L61106）。**没有** agent 运行时，因此不会新建会话、也不会绑定 job。冒烟用的 `sessions.json` 是**按原版 meta 字段集手写的 fixture**（字段依据 `createSession` L38800-38850），这一点在脚本中已注明。
- **激活所需的三个契约**：`assertEngineMoneyCompatibility`（L6426，真实运行引擎 venv 的 `cost.py contract --json` 和价格面 dump）、`inspect/assertInstalledEngineProductionContract`（L6952/L6982）、`validateEngineSessionContext`。三者均为逐字节切片。`port-cli engine-contracts <engineDir>` 可单独运行，结果见 `artifacts/linux-run/engine-contracts.json`：`production {compatible:true}`、`money {status:"compatible", capabilities:{plan:true, advisoryEstimate:true}}`。

## 3. 已端到端证明的 IPC 路径（Linux）

| 通道 | 结果（摘自 shell-smoke.log） | 下游实际执行 |
|---|---|---|
| preload | `window.videoclaw` 184 个方法 | contextBridge |
| `media:voiceDictationStatus` | `{available:false, attach:false, message:"Voice notes are unavailable in this build."}`（原版在无 helper 时的文案） | 平台层 voice |
| `session:list` | 返回 registry 中的会话，带 `liveWork: []`、`mediaRecoveryNeeded: false` | SessionRegistry |
| `bootstrap:run` | `ok`，约 20 s；推送 `bootstrap:progress`；doctor 中只有 gateway 红；`engine-current.json` 已写入（`buildSha256` = 原版 tarball 的 `0202ae15…`）；返回 `ready:false`（原版语义：doctor.ok 为 false） | install（sha256、tar）→ uv sync → npm ci ×2 → writeWorkspacePartial → doctor.py → money/production/session 契约 → 写指针 |
| `editorRender:start`（job 不匹配） | `{accepted:false, error:{code:"job-mismatch", …}}` | resolveJobBoundary |
| `editorRender:start` | `{accepted:true}` → 推送 `queued → preparing → rendering → completed`，最终 `completed`，结果 `{width:540, height:960, fps:30, durationSeconds:2, sizeBytes:59859, hasAudio:false}` | utilityProcess worker → uv → hyperframes_render.py（lint、check、render）→ 无头 Chrome |
| `editorRender:state` | 运行中 `{phase:"queued"}`，结束后 `null` | — |

HyperFrames 合成 fixture：`artifacts/linux-run/fixtures/hyperframes-card/index.html`，按 hyperframes 0.7.90 自带 `templates/blank` 的写法编写（`data-composition-id`、`window.__timelines`），引用引擎自带的 `runtime/gsap.min.js`。原版 tarball 不含 `hyperframes/examples/`，因此 `--init textcard` 不可用（docs/11 §4）。

## 4. 仍需凭据或不可在 box 上完成的部分

- 账号与网关：doctor `gateway`、`configureEngineGatewaySession`、所有付费工具、网关下发引擎。
- Agent 会话：创建会话、agent turn（需要 claude-agent-sdk 原生二进制及 Anthropic/网关凭据，或 codex 0.160.1 及 ChatGPT/OpenAI 凭据）。codex Linux 二进制可从 npm 获取，但要登录才能做有意义的 turn；无凭据的 `initialize` + `account/read` 握手见 `port-cli codex-handshake`（本阶段未在 box 上执行，因为 box 上没有 codex 二进制）。
- mediaCapabilities 授权（`completed` 时原版会对 outputPath 调用 `grant`）：未移植。
