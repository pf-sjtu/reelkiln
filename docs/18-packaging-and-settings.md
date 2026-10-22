# 18 · electron-builder 打包 + 设置页 LLM 路由选择器（第五轮）

> 2026-10-21，box（Debian trixie x64，Node 24.22，Electron 42.11.9 / Node 24.19 / SQLite 3.53.3）。代码全部在 `port/`；`app/out`、`app/reconstructed` 未改动。

## 0. 已验证 / 未验证（一览）

| 项 | 状态 | 证据 |
|---|---|---|
| Linux AppImage 构建 | ✅ 已验证 | `npm run package:linux` → `port/release/Videoclaw-Port-0.0.40-port.0-linux-x86_64.AppImage`（266,919,834 B ≈ 255 MiB） |
| Linux deb 构建 | ✅ 已验证 | `port/release/Videoclaw-Port-0.0.40-port.0-linux-amd64.deb`（209,408,600 B ≈ 200 MiB；Installed-Size 636,327 KiB ≈ 621 MiB） |
| AppImage 启动冒烟（FUSE 直接运行） | ✅ | xvfb 下主进程启动 → renderer → preload（184 方法）→ `port:llm:routes` / `port:diagnostics`（`packaged:true`，SDK `source:"resources"`，node:sqlite ok）→ 设置页单选切到 minimax 并恢复，`DONE failed=[]` |
| AppImage `APPIMAGE_EXTRACT_AND_RUN=1` | ✅ | 同上（无 FUSE 主机的回退方式） |
| deb 启动冒烟（`dpkg-deb -x` 后运行 `/opt/Videoclaw Port/videoclaw-port`） | ✅ | 同上；control：`videoclaw-port 0.0.40~port.0 amd64` |
| 打包产物中的 SDK 被自动发现 | ✅ | GUI 主进程与 `ELECTRON_RUN_AS_NODE` 两条路径都是 `source:"resources"`、0.3.305 = pin、原生 `claude` 可执行（隔离：临时 HOME，未设 `VIDEOCLAW_CLAUDE_AGENT_SDK`） |
| 打包产物里真实 agent 回合 | ✅（1 次，并发 1） | deb 解包后的 Electron 二进制以 node 模式跑 `port-cli llm-agent-smoke minimax`：SDK 0.3.305（resources）→ 内置 `claude` 2.1.305 → gate proxy → MiniMax-M3.1-Flash，`success`，1 turn，2.6 s，子进程 env 不含 provider key |
| 打包后 node:sqlite | ✅ | 主进程（diagnostics）与 node 模式（`sqlite-check`）均 ok，SQLite 3.53.3 |
| Windows `win-unpacked` 目录布局 | ⚠️ 只构建、未运行 | `--platform win --targets dir` 成功；`resources/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` 就位（交叉安装 `--os win32 --cpu x64` 有效） |
| Windows nsis 安装包 | ❌ box 上无法生成 | electron-builder 在 Linux 上生成 nsis 需要 `wine`（`spawn wine ENOENT`）；未安装 wine |
| macOS `.app` 目录布局（arm64） | ⚠️ 只构建、未运行 | `--platform mac --arch arm64 --targets dir` 成功（"skipped macOS application code signing: supported only on macOS"）；`Contents/Resources/claude-agent-sdk/…/claude-agent-sdk-darwin-arm64/claude` 就位 |
| macOS dmg | ❌ 未尝试/无法验证 | dmg、签名、公证需要 macOS |
| **（第六轮）打包 AppImage GUI 内从 UI 发起真实 agent 回合 + Stop** | ✅（1 次，extract-and-run） | docs/19 §0；`artifacts/agent-ui-run/appimage-*`。本轮 FUSE 直跑失败（`fusermount` 缺失，仅 `fusermount3`），未改系统 |
| 设置页 LLM 路由选择器 | ✅ | 单测 5 个 + dev Electron 冒烟 + 打包产物冒烟（真实点击单选 → `settings:get` 持久化 → push 收到 → 页面重渲染 → 恢复）+ 截图人工检查 |

## 1. 打包方案

- 依赖：`electron-builder@26.15.3`（devDependency，精确 pin）。原版是 electron-builder（`app/electron-builder.staging.yml` extends 的 prod 配置不在仓库里），所以沿用同一工具。
- 配置不是静态 yml，而是 `port/tools/packaging-config.mjs` 的纯函数 `builderConfig({platform, arch, sdkDir, version})`（可单测）；`port/tools/package.mjs` 负责：检查 `dist/` → 按**目标平台**准备 SDK → 调 electron-builder API。
- 脚本：

```bash
cd port
npm run package:linux        # build + AppImage + deb（已验证）
npm run package:linux:dir    # 只出 release/linux-unpacked（快速迭代）
npm run package:win          # nsis x64（未验证；Linux 上需 wine）
npm run package:mac          # dmg arm64（未验证；需 macOS）
npm run package:smoke -- release/*.AppImage release/*.deb [--live]   # 启动冒烟（§3）
# 其它：node tools/package.mjs --platform linux --arch x64 --targets AppImage,deb|dir --no-sdk --out <dir>
```

- `app.asar` 只含 `package.json` + `dist/**`（去掉 `.map`），**没有 node_modules**：esbuild 已把除 `electron` 外的一切打进 bundle；因此 `zod` 从 `dependencies` 挪到 `devDependencies`，`dependencies` 为空（测试保证）。asar 只有 ≈1.9 MB。
- 身份：`appId com.videoclaw.port`、`productName "Videoclaw Port"`、可执行名 `videoclaw-port` —— **故意与原版 `Videoclaw` 不同**，userData 是 `~/.config/Videoclaw Port`，打包的 port 不会改写真正的原版应用 的 `settings.json`。
- `npmRebuild:false`：没有原生 addon（node:sqlite 是 Electron 内置模块）。
- 未设置图标（用 Electron 默认图标）、未签名、`publish: null`（不做自动更新发布）。
- 产物与交叉平台 SDK 暂存目录 `port/release/`、`port/build/` 已加入 `.gitignore`（还有原来的 `port/vendor/`）。

## 2. Claude Agent SDK 如何进包

- **来源**：`npm run agent-sdk:install` 的目录。`package.mjs` 对**本机平台**直接用 `port/vendor/claude-agent-sdk`（缺失或版本 ≠ pin 时自动调用安装脚本）；**其它平台**装到 `port/build/agent-sdk/<os>-<arch>`（`install-agent-sdk.mjs --dir … --os … --cpu …`）。打包前 `validateSdkStaging()` 检查：SDK 存在、版本 = `config.claudeAgentSdkVersion`（0.3.305）、**目标平台**的原生 `claude[.exe]` 存在，否则中止。
- **位置**：`extraResources: {from: <sdkDir>/node_modules, to: claude-agent-sdk/node_modules}` → `<resources>/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk`（+ `claude-agent-sdk-<os>-<arch>/claude` + peer 依赖 `@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`、`zod` 等约 99 个包）。命中 `agent-sdk.ts` 发现顺序第 4 条 `<resourcesPath>/claude-agent-sdk`；若将来改为原版的 `asarUnpack` 布局（第 3 条 `app.asar.unpacked/node_modules`）也能被发现，且优先级更高（测试覆盖）。
- 为什么不放进 asar：SDK 要 `spawn` 原生 `claude`，asar 里的文件不能被执行；放在 `resources/` 下是普通文件，可执行位保留（已检查 `-rwxr-xr-x`）。
- 过滤：只保留目标平台的原生包，其它平台（含同平台 `-musl`）、`.bin`、`.map` 被排除。
- 体积：SDK 目录 ≈ 326 MB（其中原生 `claude` ≈ 277 MiB）是包体的大头；linux-unpacked 共 ≈ 640 MB。
- 许可证：SDK 为 “SEE LICENSE IN README.md”（Anthropic 商业条款）。**是否允许随应用再分发需要法务确认**（原版应用 也是打包分发的）。

## 3. 启动冒烟（`port/tools/packaged-smoke.mjs`）

对每个产物：
1. **GUI 冒烟**：用打包后的可执行文件在 `xvfb-run` 下启动（`VIDEOCLAW_PORT_SMOKE=1`、`VIDEOCLAW_PORT_SMOKE_UI_SELECT=minimax`、`--no-sandbox`、临时 HOME + `--user-data-dir`、清掉 `VIDEOCLAW_CLAUDE_AGENT_SDK`）。判定：`DONE failed=[]` 且 diagnostics 中 `packaged:true`、SDK `ok && source==="resources"`、`sqlite.ok`。AppImage 先直接（FUSE）运行，失败再用 `APPIMAGE_EXTRACT_AND_RUN=1`。
2. **node 模式**：`ELECTRON_RUN_AS_NODE=1 <exe> resources/app.asar/dist/cli/port-cli.cjs agent-sdk-check` 与 `sqlite-check`（`process.resourcesPath` 在 node 模式下同样可用）。
3. `--live`：一次真实 `llm-agent-smoke minimax`（SDK + 原生 claude + gate proxy + MiniMax）。只输出解析后的字段，从不打印 key。

本轮结果见 §0。box 特有的坑（都不是产物问题）：
- 本机原本没有 `libfuse.so.2` → 装了 `libfuse2t64`；只有 `fusermount3` 没有 `fusermount` → 冒烟脚本在临时 PATH 里放一个 `fusermount → fusermount3` 的软链接（不改系统）；`/etc/mtab` 缺失导致卸载失败 → 建了标准软链接 `/etc/mtab → /proc/self/mounts`。
- 容器里没有 D-Bus，Chromium 打印 `Failed to connect to the bus`（无害）。
- `--no-sandbox`：解包的 deb / AppImage 中 `chrome-sandbox` 不是 setuid root；正式 `apt install` 时 deb 的 postinst 会设置。真正 `dpkg -i` 安装**未执行**（不想改动共享 box 的系统包）。

此外 dev 模式（`electron .`）也跑了同样的冒烟，SDK `source:"vendor"`。

## 4. 外部依赖（不打包、不重建）

打包产物**只**包含 Electron 壳 + 主进程/渲染进程 bundle + Claude Agent SDK。以下仍是外部依赖，靠环境变量 / PATH 配置（与 docs/02、docs/12 一致）：

| 依赖 | 打包后如何找到 |
|---|---|
| Python 引擎 | bootstrap 从 `<resources>/bootstrap/engine.manifest.json`（本包**没有**该目录）或 `VIDEOCLAW_ENGINE_DIST`（含 manifest + tarball 的目录）安装；gateway 下载路径未移植 |
| ffmpeg / ffprobe | `<resources>/bootstrap/…`（无）→ `VIDEOCLAW_PORT_FFMPEG` / `VIDEOCLAW_PORT_FFPROBE` → PATH |
| uv | `VIDEOCLAW_PORT_UV` → PATH |
| node（Remotion/Hyperframes 等引擎侧工具） | PATH |
| codex | `VIDEOCLAW_CODEX_BIN` → `<bootstrap>/codex/bin/codex` |
| LLM 提供方 key | 环境变量（如 `MINIMAX_API_KEY`），自定义 provider 文件 `VIDEOCLAW_LLM_PROVIDERS_FILE`；**桌面启动器（.desktop）不会继承 shell 的环境变量** → 需要在会话环境（如 `~/.profile` / systemd user env）里设置，或从终端启动 |
| models.dev 目录 | `VIDEOCLAW_MODELS_DB`（默认 userData 下），运行时同步，不随包分发 |

## 5. 设置页 LLM 路由选择器

**位置**：port renderer（`port/src/renderer/`）新增 **Settings** 视图（默认打开），原来的 IPC 冒烟页改为 **Debug** 标签页。截图验证见冒烟 `VIDEOCLAW_PORT_SMOKE_SCREENSHOT=<png>`。

- `llm-settings.ts`（无 DOM，可在 node 下单测）：
  - `routeRow()`：每个路由一行 —— 标题、`协议 · 模型`、徽章：`Preset/Custom provider`、`Key set (ENV)` / `Key missing (ENV)`（只显示变量名，从不显示 key）、`Agent`/`No agent`、`Helper`/`No helper`、`Structured output: native|tool|off`；内置路由：Claude Code（Agent+Helper）、Gateway（警告“Gateway sign-in not ported”）。
  - 不可用原因：缺 key → “设置 `XXX_API_KEY` 并重启”，且**不可选**（当前已选中的路由除外，保证可见）；非 Anthropic 协议 → “只能做 helper 调用”，仍可选（与 `settings:set` 的校验一致）。
  - 控制器：`refresh()`（序号保护，后发请求的结果不会被先发的慢响应覆盖）、`select(id)`（保存中忽略二次点击；走**原版** `window.videoclaw.setSettings({llmRoute})`；返回的 settings 里 `llmRoute !== id` 视为主进程拒绝（路由已不再注册）并提示；之后重新拉取）、`applyView(view)`（推送直接采用）。
- `settings-page.ts`：纯 DOM 渲染（单选组 + 徽章 + 原因 + providers 文件错误横幅 + 状态/提示行 + Refresh 按钮），只用 `textContent`。
- **刷新时机**：主进程推送 **`port:llm:routesChanged`**（PORT-NEW；生效路由变化或 providers 文件热重载/SIGHUP 时，携带最新 `LlmRoutesView`，相同内容去重）、窗口 `focus`、`visibilitychange → visible`、手动 Refresh。
- **About this build**：新的 PORT-NEW `port:diagnostics` —— 版本/是否打包/Electron/Node/平台、SDK 发现结果（来源、版本、是否等于 pin、`claude` 路径或错误）、node:sqlite、userData 路径。
- 桥：`window.videoclawPort` 增加 `diagnostics()`、`onLlmRoutesChanged(cb) → unsubscribe`；原版 184 方法的 `window.videoclaw` 未改（忠实性测试仍通过）。
- **与完整原版设置页的差距**（原版设置 UI 在尚未移植的 React bundle 里）：账户/登录、gateway key 管理（CredentialStore 未移植）、Codex harness/provider/model、更新渠道、遥测与使用分享同意、alpha consent、语音、主题/本地化等；路由切换后原版会经 `AgentHost.onLlmRouteChanged` 拆掉运行中的 runtime（第六轮已接上最小 AgentHost，docs/19；本页文案仍只说“对新视频生效”——已有视频保持其固定路由）；文案为英文、未本地化；在 UI 里编辑 providers 文件 / 输入 key 未实现（key 只走环境变量，刻意不在渲染进程出现）。

## 6. Windows / macOS 注意事项（全部未验证）

- **Windows**：`npm run package:win`（或在 Windows 上 `node tools/package.mjs --platform win`）。Linux 上生成 nsis 需要 wine；Windows 主机上不需要。SDK 用 `--os win32 --cpu x64` 交叉安装已验证能取到 `claude.exe`，但**从未在 Windows 上运行**：`claude.exe` 启动、路径含空格（`C:\Program Files\Videoclaw Port\resources\…`）、Defender/SmartScreen 对未签名 exe 的拦截、长路径都未测。没有代码签名证书（electron-builder 尝试 signtool 但无证书 → 未签名）。arm64 未配置测试。
- **macOS**：需要在 macOS 上构建 dmg；需要 Developer ID 签名 + 公证。配置开了 `hardenedRuntime:true`、`identity:null`（未签名）。**风险**：hardened runtime 下原生 `claude`（Bun 编译的单文件可执行）大概率需要单独签名并可能需要 JIT 等 entitlements，否则会被 Gatekeeper 阻止 —— 未验证。x64 / universal 未配置。
- 两个平台的 userData、Python 引擎、外部工具路径的适配见 docs/07–09；打包本身不改变这些。

## 7. 测试 / 提交

- `npm test`：**177/177**（上轮 165；新增 `test/packaging.test.ts` 7 个：linux 配置、win/mac 目标、平台过滤、**打包布局 ↔ 运行时发现**（按配置的 `to` 路径造假 SDK，断言 `source:"resources"` 且找到原生二进制；同时存在时 asarUnpack 布局优先）、暂存校验、package.json/gitignore 卫生、diagnostics 不含秘密；`test/settings-llm.test.ts` 5 个：行模型、选择/持久化/无操作/拒绝、主进程拒绝与异常、并发与过期响应与推送、主进程推送（settings:set、热重载增删 provider、去重、configError、无 key 泄露））。
- `npm run build`（gen + tsc + esbuild）通过。
- 提交：`75ca316`（设置页 + diagnostics + 推送）、`65792ca`（electron-builder 打包 + 冒烟脚本）、本文档提交。

## 8. 未验证 / 风险

- Windows nsis / macOS dmg：只有配置（及目录布局构建），从未安装或运行；签名、公证、SmartScreen/Gatekeeper 全未处理。
- deb 未通过 `dpkg -i`/`apt` 真正安装（只解包运行）；依赖列表手写（GTK3/NSS 等常规 Electron 依赖），未在干净系统上验证；未用 sandbox（`--no-sandbox`）运行。
- AppImage 在本 box 需要额外系统配置（libfuse2、fusermount 软链接、/etc/mtab）；其它发行版行为未测。
- ~~真实 agent 回合是在打包二进制的 **node 模式**（CLI）里跑的；GUI 主进程里还没有“发起会话”的入口~~ → 第六轮：打包 AppImage 的 GUI 里从 Agent 页真实跑通工具回合 + Stop（docs/19 §0）。注意本轮 AppImage FUSE 直跑失败（`fusermount` 不存在，只有 `fusermount3`），用的是 `APPIMAGE_EXTRACT_AND_RUN=1`。
- 包体 ≈ 200–255 MB（压缩），一半以上是 `claude` 原生二进制；SDK 再分发许可未确认。
- 打包时 SDK 版本固定为 pin（0.3.305）；升级 pin 需重新 `agent-sdk:install` 并重测 MiniMax 兼容性。
- 桌面环境启动时环境变量（provider key、工具路径）可能拿不到；未做“在设置页里配置 key”的功能。
- 设置页文案仅英文；在一个窗口里改路由时另一个窗口靠推送刷新（只有单窗口实测）；env 中的 key 变更仍需重启应用才会被看到（focus 刷新只是重新查询主进程，主进程的 env 不会变）。
- 图标、desktop 集成（`desktopName`/`StartupWMClass`）只做了最低限度配置，未在真实桌面环境检查。
