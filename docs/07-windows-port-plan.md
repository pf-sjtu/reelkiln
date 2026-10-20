# 07 · Windows 移植计划（port/ 脚手架）

> 原则：**忠实对齐，不重新设计**。移植版保持原版 0.0.40 的 IPC 表面（184 个 channel / `window.videoclaw` 184 个方法）、进程模型（main + preload + renderer + utilityProcess worker + 外部 CLI 子进程）与行为；仅把 macOS 专有假设替换为跨平台实现。`app/out` 与 `app/reconstructed/` 保持原样不动。
>
> 所有 "原版" 行号均指 `app/reconstructed/main/index.js`（除非另注）。

## 1. port/ 架构

```
port/
├─ package.json / tsconfig.json / package-lock.json
├─ tools/
│  ├─ gen-ipc-contract.mjs      # 生成器（可复现）：ipc-channels.json → 契约 + preload bridge
│  ├─ ipc-verified-shapes.json  # 人工核验过、带行号证据的载荷形状（唯一的“手写类型”来源）
│  ├─ bridge-order.json         # 原 preload `bridge` 对象的成员顺序（184）
│  └─ build.mjs                 # esbuild：main/preload → CJS，renderer → IIFE；--tests 打包测试
├─ src/
│  ├─ shared/ipc-contract.ts    # 【生成】IPC 常量表 + 三个方向的契约接口 + VideoclawBridge
│  ├─ preload/
│  │  ├─ bridge.generated.ts    # 【生成】与原 preload 逐成员一致（invoke/send/subscribe + 本地 pathForFile）
│  │  └─ index.ts               # contextBridge.exposeInMainWorld("videoclaw", bridge)
│  ├─ main/
│  │  ├─ index.ts               # BrowserWindow（与原 createWindow 相同的隔离参数）+ 注册全部 handler
│  │  ├─ ipc-tracking.ts        # 原 trackIpcRequests / createRendererEmitter 逻辑逐行移植
│  │  ├─ fake-backend.ts        # 仿 qaFixtures.installQaBridge 的假后端（13 个 channel 有值，其余记录日志返回 undefined）
│  │  └─ platform/              # 平台抽象层（见 §2）
│  └─ renderer/                 # 冒烟测试页：列出 window.videoclaw 方法并 ping 若干 channel
└─ test/                        # node:test（29 项）
   ├─ platform.test.ts          # 平台层：darwin 与 win32 两条路径都在 Linux 上可测
   ├─ ipc-contract.test.ts      # 184/157/3/23/1 计数 + IPC 表与 app/out/main/index.js 逐字比对
   ├─ preload-fidelity.test.ts  # 驱动生成的 bridge 每个成员，比对原 preload 源码的 (fn, channel, 参数顺序)
   └─ main-ipc.test.ts          # 每个 channel 恰好注册一次；假后端、pendingExcept、推送
```

### 1.1 IPC 契约覆盖率（生成器输出 `CONTRACT_STATS`）

| 方向 | 数量 | 有真实类型 | 占位 `Unknown_*` |
|---|---|---|---|
| renderer→main `invoke`↔`handle`（返回值） | 157 | 1（`app:update:state`，partial：4 个键，L61340-61349） | 156 |
| renderer→main `send`↔`on` | 3 | 3（返回 `void`，由 `ipcRenderer.send` 语义确定） | 0 |
| main→renderer 推送载荷 | 23 | 10（`account:emailSent`=void 完整；`session:event`/`job:snapshot`/`spend:snapshot`/`memory:changed`/`engine:updated`/`window:state`/`library:syncProgress`/`bootstrap:progress`/`app:update` 为 partial） | 13 |
| 请求参数 | 198 个具名参数 | **名称**全部来自原 preload（已核验）；**类型**全部为 `unknown` 占位 | 198 |
| 未使用 | 1（`file:pathForFile`，preload 用 `webUtils.getPathForFile` 本地实现） | — | — |

每个占位类型都带 `// TODO: payload not yet recovered`，并在契约接口注释中引用 main 的 handler 行号、签名首行与委托调用（`delegates to host.xxx`）。未编造任何载荷形状；partial 形状中未被代码证明的叶子仍为 `unknown`。

## 2. macOS 假设 → Windows 替换 → 状态

| # | 原版 macOS 假设（证据） | Windows 替换（port/src/main/platform/） | 状态 |
|---|---|---|---|
| 1 | PATH 用 `":"` 拼接：`enginePath_` L9313-9321、`engineChildPath` L9328-9331 | `pathDelimiter()` / `composeEnginePath()` / `composeEngineChildPath()`；POSIX 输出与原版逐字节一致；Windows 用 `;`、大小写不敏感去重、`pathEnvKey()` 处理 `Path` | **done**（已测） |
| 2 | 随包 node 位于 `<bootstrap>/node/bin` | Windows 官方 node zip 的 `node.exe` 在根目录 → 额外接受 `<bootstrap>/node`（**移植版差异**，已注释） | **done** |
| 3 | `EXTRA_PATHS = [~/.local/bin, /opt/homebrew/bin, /usr/local/bin, ~/.cargo/bin]` L9322 | `extraPaths()`：Windows 用 `~/.local/bin`（uv 安装器）、`~/.cargo/bin`、`%LOCALAPPDATA%\Microsoft\WinGet\Links` | **done** |
| 4 | `<engine>/.venv/bin/python`（约 15 处，如 L4206、L6344、L19077） | `venvPython()` → `.venv\Scripts\python.exe`；`venvBinDir()` | **done**（尚需在真实后端各调用点替换） |
| 5 | 裸名 `bin/ffmpeg`、`bootstrap/uv`、`codex/bin/codex` | `exeName()` 加 `.exe`；`bootstrapTool()`、`codexBinCandidates()` | **done** |
| 6 | 无 `which` 需求（全用绝对路径）但 agent 依赖 PATH 查找 | `which()`：PATHEXT、带引号目录、`Path` 键；故意不搜索当前目录 | **done** |
| 7 | `resolveBootstrapToolRoots` + `VIDEOCLAW_ENGINE_DIST`（原版变量，L9291-9303） | `resolveBootstrapToolRoots()` 顺序与原版一致 | **done** |
| 8 | （原版**不存在** ffmpeg/ffprobe/uv 路径覆盖变量） | **移植版新增，非原版**：`VIDEOCLAW_PORT_FFMPEG` / `VIDEOCLAW_PORT_FFPROBE` / `VIDEOCLAW_PORT_UV`（`PORT_ONLY_TOOL_ENV`），仅为 Windows 开发机在没有 Windows bootstrap 包前指向系统工具 | **done**（port-only） |
| 9 | `/bin/bash -c withOutputPipefail(cmd)` L25331；`/bin/sh -c RELATIVE_WRITER` L2928 | `bashShell()`：优先 Git for Windows 的 `bash.exe`（排除 `System32\bash.exe` WSL 启动器）；找不到才退回 `cmd.exe /d /s /c`，并标记 `degraded: true`（agent 写的是 bash 语法，cmd 无法逐字执行） | **done**（cmd 回退为降级）；`RELATIVE_WRITER` 改写为 Node fs 实现 **TODO** |
| 10 | `detached: process.platform !== "win32"` L25334 | 原版已跨平台，`spawnDetachedForGroup()` 照搬 | **done** |
| 11 | `kill(-pid)` 进程组：runBash L25300-25311、editorRender L62418、editorRenderWorker L69 | `killTree()`：POSIX 仍为 `kill(-pid)`；Windows 为 `taskkill /PID <pid> /T`（SIGKILL → 加 `/F`）。原版在 win32 只会 `child.kill()`，会遗留 python/ffmpeg 孙进程 | **done**（已测）；接入 worker **TODO** |
| 12 | `ps -Awwo pid=,ppid=,command=` L31604 | `listProcesses()`：Windows 用 PowerShell `Get-CimInstance Win32_Process … ConvertTo-Json`（wmic 在 Win11 24H2 已移除）；`parsePsOutput` 为原版正则 | **done**（解析已测，Windows 实机未测） |
| 13 | `/proc/<pid>/cwd` → `lsof -a -d cwd -Fn -p` L31627-31645 | Windows 无受支持的 API 读取他进程 cwd（需读 PEB，需原生代码）→ `processCwd()` 在 win32 返回 `undefined`；EngineChildren 回收逻辑需改为仅按命令行匹配 | **stub / TODO** |
| 14 | `/usr/bin/osascript -l JavaScript` PDFKit 读 PDF L56966-57000 | 原版在非 darwin 上本就返回 `{kind:"unread", cause:"unavailable"}`（L56968-56970），`pdfReaderFor()` 保持该行为 | **stub**（与原版一致）；Windows 读取器（pdf.js / Windows.Data.Pdf）**TODO**，且无法保证与 PDFKit 文本顺序逐字节一致 |
| 15 | Swift `voice-dictation` 助手（`--check` → `{available,error}`；`<wav>` → `{text}`），L10452-10500 | `voiceDictationStatus()` 原逻辑逐行移植 + 原错误文案；无助手时返回原版同样的 `{available:false, attach:true, message: errors.unavailable}` | **stub**；同 CLI 契约的 `voice-dictation.exe`（Windows.Media.SpeechRecognition 或 whisper.cpp）**TODO** |
| 16 | `nativePythonArgs` Mach-O arm64 检测 L7172+，`--python cpython-X.Y.Z-macos-aarch64` L7194/L7197 | 原版在非 darwin/arm64 已返回 `[]`；`needsNativePythonProbe()` | **done**（原版即为 no-op） |
| 17 | `writeCommandShims`（L7271）为 `ENGINE_COMMAND_SHIMS = ["python3","python","pip3","pip","git"]`（L7203）生成 sh 脚本 shim，xcode-select git shim L7242 | 需生成 `.cmd` 等价 shim；`installAppCommandShims` 已用 `path.delimiter`（L7289-7290） | **TODO** |
| 18 | 窗口 `titleBarStyle: "hiddenInset"` + `trafficLightPosition` | Windows 忽略；port 的 BrowserWindow 去掉这两项，其余（尺寸/背景色/contextIsolation/nodeIntegration/sandbox:false）一致；preload 由 ESM `.mjs` 改为 CJS `.cjs`（两种 sandbox 设置下都可用） | **done** |
| 19 | 随包 `codex`（aarch64-apple-darwin 0.160.1）、claude-agent-sdk `-darwin-arm64` 原生 claude | 需 `codex` 0.160.1 的 `x86_64-pc-windows-msvc` 版本、`@anthropic-ai/claude-agent-sdk-win32-x64` 包 | **TODO**（外部依赖） |
| 20 | 随包 `ffmpeg`/`ffprobe`/`uv`/`node`（Mach-O arm64） | 需 Windows x64 构建；过渡期可用 #8 的 port-only 变量 | **TODO**（外部依赖） |

## 3. 构建与运行

```bash
cd port
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install   # 在 box/CI 上：构建不需要 Electron 二进制
npm run build    # = npm run gen（重新生成契约）→ tsc --noEmit → esbuild 输出 dist/
npm test         # node:test，29 项全部通过（box，Linux，Node v24.22.0）
```

- Electron 版本固定为 **42.11.9**，与原 dmg 内 `Electron Framework.framework/.../Info.plist` 的 `CFBundleVersion` 一致。
- 构建产物 `port/dist/`、`port/dist-test/` 已加入 `.gitignore`。
- 运行（Windows 机器上，目前只有假后端）：`npm install`（不跳过 Electron 下载）→ `npm run build` → `npm run start`。窗口显示 `window.videoclaw exposes 184 methods`，点 "Ping" 可调用 `bootstrapStatus/listClients/getAppUpdateState/voiceDictationStatus/bootstrapRun`（含 `bootstrap:progress` 推送）以及一个未实现的 `listSessions`（返回 undefined 并在 main 控制台记录 `NOT IMPLEMENTED`）。
- box 上未运行 Electron（规则：不运行应用；且未下载 Electron 二进制）。

## 4. 阻塞项与关键发现

1. **引擎本身并不是 arm64-darwin 专用。** 解开的 `engine-0.1.57-rc7-15f8f2d.tar.gz`（`engine-extract/engine/`，315 个文件）只有 Python 源码、`pyproject.toml` + `uv.lock`、remotion/hyperframes 的 `package.json`、skills/taste/laws 等数据——**没有** `.venv`、`.so`/`.dylib`、Mach-O 或 node_modules。`uv.lock` 中含 199 处 `win_amd64` wheel（对比 209 处 macOS arm64）。真正绑定 macOS 的是：
   - App 侧 `uv sync --frozen … --python cpython-X.Y.Z-macos-aarch64`（仅 darwin/arm64 才附加，L7194/L7197）；
   - 随包的 `uv`/`ffmpeg`/`ffprobe`/`node`/`codex`/claude 原生二进制（Mach-O arm64）；
   - 引擎 Python 代码中的 POSIX 依赖（见下一条）。
   因此 "Windows 版引擎" 的第一步不是重编引擎，而是在 Windows 上对**同一 tarball** 执行 `uv sync --frozen`（manifest `pythonVersion: 3.14.6`），再跑 `tools/doctor.py --json` 看哪些检查失败。
2. **引擎 Python 中的 POSIX-only 用法**（`repo/engine` 中 grep）：
   - `fcntl` 文件锁：`tools/_media/library_lock.py`、`_render_completion.py`、`_takes.py`、`lipsync_footage.py`、`log.py`、`prepare_production.py`、`remotion_lock.py`（Windows 无 `fcntl` → ImportError，需 `msvcrt.locking` 或 `portalocker`）；
   - `os.killpg` / `os.setsid` / `start_new_session` / `signal.SIGKILL`：`_render_completion.py`、`_render_review_child.py`、`review_render.py`；
   - `os.getuid/getpgid` 类：`tools/_media/chunker.py`；
   - 硬编码 `.venv/bin/python`：`prepare_production.py` L150（`PORTABLE_ENGINE_PYTHON`）、`build_character_sheet.py`（文档字符串）。
   这些属于引擎仓库的修改，不在本 JS 移植范围内，但它们会阻塞 Windows 上的真实渲染。
3. **agent 命令是 bash 语法**（`uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/<tool>.py" --job <id>`），Claude Code / Codex 的 Bash 工具在 Windows 上需要 Git Bash；项目内 shim（#17）也需 `.cmd` 版本。
4. 外部二进制的 Windows 版本：codex 0.160.1（`SUPPORTED_CODEX_VERSION` 硬性要求该版本）、claude-agent-sdk 的 win32-x64 原生包、ffmpeg/ffprobe、uv、node。
5. `processCwd` 在 Windows 上无法实现（#13），EngineChildren 的孤儿进程回收需要降级策略。
6. IPC 载荷：157 个返回值中 156 个仍为占位，后续应以原 main handler 代码为证据逐个回填 `ipc-verified-shapes.json`（只加有行号证据的形状）。

## 5. 下一步（通往可运行的 Windows 构建）

1. **在 Windows x64 上验证引擎**：拿同一个 tarball，`uv sync --frozen --project <engine>`（Python 3.14.6），然后 `uv run --project <engine> python <engine>/tools/doctor.py --json`；记录失败项（预计 `fcntl` 导入为首个硬错误）。
2. 准备 `port/resources/bootstrap/` 的 Windows 二进制清单（ffmpeg/ffprobe/uv/node/codex 0.160.1），用 SHA256 manifest 记录来源（不入库）；过渡期可用 `VIDEOCLAW_PORT_*`。
3. 把真实 main 后端按模块从 `app/reconstructed/main/index.js` 移植进 `port/src/main/`，在调用点改用 platform 层（优先：Bootstrap/doctor、engine 安装与 `ensureVenv`、runBash、editorRenderWorker 的 killTree）。
4. 逐步把假后端的 channel 换成真实实现，同时回填契约类型（证据驱动）。
