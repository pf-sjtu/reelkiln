# 10 · 主进程模块移植状态（Phase 3，静态移植）

> 范围：`port/src/main/**`。全部工作在 box（Linux）上完成，**没有运行 Electron、没有运行真实引擎、没有 Windows 运行时**。
> 行号均指 `app/reconstructed/main/index.js`（除非注明 `out/main/...`）。"PORT-NEW" 表示原版 bundle 中不存在、为移植新增的内容。
> 校验方式：`npm run build`（gen + tsc + esbuild）与 `npm test`（67 个 node:test 用例）全绿。

## 1. IPC handler 统计（157 个 invoke 通道 + 3 个 send 通道）

| 类别 | 数量 | 通道 |
|---|---|---|
| **真实移植（ported-real）** | 4 | `editorRender:start` / `editorRender:cancel` / `editorRender:state`（EditorRenderController + utilityProcess worker，L62405-62428）、`media:voiceDictationStatus`（原算法；Windows 下无 helper → 原版文案） |
| **真实移植，需开关** | 1 | `bootstrap:run` —— 仅当 PORT-NEW 环境变量 `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1` 时走 `BootstrapCore.runAll()`；预期在 `workspace` 步骤以 `NOT PORTED: writeWorkspace L9650` 失败（见 §3） |
| **fixture 假实现（fake）** | 12 | `bootstrap:status`、`bootstrap:run`（默认）、`client:list`、`client:create`、`settings:get`、`app:restart`、`engine:pendingToast`、`hfPreview:available`、`feedback:discard`、`engine:codexHandoffOffer`、`job:get`、`app:update:state`（值来自 qaFixtures / 主进程 fallback，带行号） |
| **未实现（stub → `undefined` + 日志）** | 141 | 其余全部（4 + 12 + 141 = 157） |
| send（`permission:respond` / `permission:shown` / `quit:rendererState`） | 3 | 仅记录日志 |

注：`editorRender:start` 虽为真实实现，但 `getSession` 依赖的 session host 尚未移植，因此当前每次都返回原版的 `unknown-session` 错误（文案与原版一致）。这是"真实逻辑 + 未移植依赖"的诚实状态，而非伪造成功。

## 2. 主进程模块（非 IPC 维度）

| 模块 | 文件 | 状态 | 与原版的对照测试 |
|---|---|---|---|
| shell 命令分析（tokenizeShell / splitPipelineOnly / withOutputPipefail 等，chunk L2234-4084） | `engine/shell-command.ts` | ported-real | **差分**：对 22 条命令语料，与已发行 bundle `out/main/chunks/workbookContents-*.js` 导出 `a6` 的输出逐字节相同 |
| runBash（L25251-25387） | `engine/run-bash.ts` | ported-real | 在 Linux 上真实执行 bash：成功/退出码/pipefail/超时/abort 文案与原版一致；win32 分支用 mock 验证 shell 选择与 `taskkill /T /F` |
| job 边界（resolveJobDir / expandHome / contained） | `engine/job-boundary.ts` | ported-real | 单测；win32 额外接受 `~\` |
| EditorRenderController（L56048-56266） | `engine/editor-render.ts` | ported-real（classifyError/sanitizeErrorText 以依赖注入，默认缺省 → TODO） | 单测：校验/busy/start 消息/完成回执（读取 run.log.jsonl）/取消超时后 reap 进程组 |
| editorRenderWorker（`out/main/editorRenderWorker.js`） | `workers/editor-render-worker.ts` → `dist/main/editorRenderWorker.cjs` | ported-real | **差分**：直接 import 已发行的 `editorRenderWorker.js`，5 个场景（成功/失败/spawn error/取消/取消后宽限 SIGKILL）下 post 消息、进程组 kill、spawn 参数完全一致 |
| resolveEditorRenderEngine（L60614-60652）/ absCwd | `engine/engine-env.ts` | ported-real（engineSessionEnv 未移植 → 抛错 → 返回 null，与原版 catch 分支一致） | 单测覆盖 4 个分支 + win32 `bin\uv.exe` |
| Bootstrap 纯函数（compareEngineVersions、engineManifestCompatibility、classifyBootstrapFailure、doctorFailures） | `engine/bootstrap.ts` | ported-real | **差分**：从原版源码切片 eval，与移植版在矩阵输入上结果一致 |
| Bootstrap 流程（runAll 步骤机 L9863-9988、installEngineDir、ensureVenv、ensureRemotion、ensureHyperframes、writeEnvFile/scrubEngineGatewaySecrets、doctor/runDoctor、activateEngine、currentEngine） | `engine/bootstrap.ts` | ported-real；协作者以 `BootstrapHooks` 注入 | 单测：真实 tar 解包 + 记录型 runner，8 个步骤 ok、`uv sync --frozen --project <eng>` 参数与 env、doctor argv、npm ci 的 cwd 与 PATH、指针文件；sha 不匹配文案 |
| resolveEngineSource（L9496-9570） | `engine/bootstrap.ts#resolveBundledEngineSource` | 部分：bundled/`VIDEOCLAW_ENGINE_DIST` 分支真实；gateway 下载分支 **NOT PORTED**（刻意不发网络请求） | — |
| 命令 shim（ENGINE_COMMAND_SHIMS，L7199-7308） | `engine/command-shims.ts` | ported-real + PORT-NEW `.cmd` | **差分**：POSIX 脚本与原版源码 eval 结果逐字节相同；win32 另写 sh 版（Git Bash）与 `.cmd` 版（CRLF、goto 结构避免 `%ERRORLEVEL%` 解析期展开） |
| npm/npx/tar 调用 | `platform/npm.ts` | PORT-NEW | win32：`node.exe npm-cli.js`（规避 CVE-2024-27980 对 `.cmd` 的 EINVAL）；tar 固定为 `%SystemRoot%\System32\tar.exe`（避免 Git 的 GNU tar 把 `C:` 当远程主机） |
| AgentGatewayProxy（L28672-30374） | `gateway/agent-gateway-proxy.ts` | **形状移植**：start/绑定 127.0.0.1:0、凭据生命周期、bearer、reject 为真实；`handle` 认证后一律 501，`authorize`（spend/quote/permit，约 670 行）NOT PORTED | 回环单测（不访问上游） |
| RELATIVE_WRITER（`/bin/sh` 脚本 L2864-2918）+ writeProjectStream 循环 | `studio/relative-writer.ts` | ported-real（Node 重写） | **差分**：在 box 上实际运行原版 sh 脚本（linux 分支），与 Node 版在 0/73/75 退出码与产物上完全一致 |
| codex app-server 客户端（L23652-24267） | `codex/app-server-client.ts` | 传输层 ported-real + 类型化请求表；通知归一化/审批/动态工具 NOT PORTED（按原版"unsupported/unavailable"应答） | 单测：initialize 精确参数、版本门 0.160.1 文案、错误/未知 id/服务端请求、超时文案 |
| PDF 读取（L56880-57060） | `platform/pdf-windows.ts` | 设计 + 桩；`interpretPdfKitOutput` 真实移植 | **差分**：interpretPdfKitOutput 与原版源码 eval 在 10 个输入上一致；桩后端 = 原版非 darwin 行为 |
| preload 表面 | `preload/bridge.generated.ts` | 完整（184 成员） | 新增完整性测试：唯一 `exposeInMainWorld("videoclaw")`、成员顺序、157 invoke + 3 send、IPC 通道字符串逐一相同；原版 preload 中 L227-834 的残留代码不可从 bridge 访问 |

## 3. 已知未移植的协作者（全部以 `NOT PORTED: <name> L<line>` 抛错，绝不静默通过）

- `validateEngineSessionContext`（L4188）、`assertInstalledEngineProductionContract`（L6982）、`inspectInstalledEngineProductionContract`（L6952）
- `writeWorkspace`（L9650，含 CLAUDE.md 迁移、taste packs、settings.json 复制）
- `assertEngineMoneyCompatibility`、Studio bundle / feature flags（`configureStudioBundleStore` 等）
- `engineSessionEnv`（L9380，依赖 session-context 哈希）
- session host（`host.listSessions`）、mediaCapabilities.grant
- 网关引擎下载（resolveEngineSource 的 gateway 分支）

在 `real-backend.ts` 中，`assertInstalledEngineProductionContract` 被替换为"记录日志后跳过"（标注 SKIPPED），以便开关模式下能走到 venv/remotion/hyperframes 步骤；这是**唯一**被放宽的检查，且仅在 `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1` 时生效。

## 4. 弱于原版之处（需在 Windows 上评估）

1. **RELATIVE_WRITER 的 TOCTOU 保证变弱**：原版在 cwd=已验证目录中以相对名写入；Node 无法按调用 chdir 也无 openat，移植版在创建前、发布前各复核一次目录 identity，缩小但未消除竞争窗口。
2. **硬链接发布**：NTFS 支持 `linkSync`；FAT/exFAT 回退为 `copyFileSync(COPYFILE_EXCL)`（非原子）。
3. **进程组**：Windows 无进程组，统一用 `taskkill /PID <pid> /T [/F]`；SIGTERM 映射为不带 `/F` 的 taskkill，控制台程序通常会忽略，依赖随后的 SIGKILL（`/F`）升级。
4. **AgentGatewayProxy** 仅形状：任何经代理的付费调用都会得到 501。

## 5. 在 Windows 上未验证的改动清单（主进程侧）

| # | 改动 | 风险 |
|---|---|---|
| W1 | `platform.killTree` → `taskkill.exe /T` | 需确认 uv→python→ffmpeg 整棵树被终止 |
| W2 | Git Bash 作为 runBash shell（`bashShell`） | 未安装 Git 时降级为 cmd（degraded），引擎命令语法不兼容 |
| W3 | `npmInvocation`（node.exe + npm-cli.js） | 依赖 bundled node 目录结构为官方 zip 布局 |
| W4 | `tarInvocation`（System32 bsdtar） | 需确认 `--strip-components 1` 与长路径（>260）行为 |
| W5 | `.cmd` shim 与 Git Bash sh shim | `%~dp0` 解析、引号、`exit /b %ERRORLEVEL%` |
| W6 | `mergeEnv` 合并 `Path`/`PATH` | 子进程 PATH 是否只有一份 |
| W7 | `relativeWrite` 的 `dev:ino`（bigint stat） | NTFS 下 ino 是否稳定 |
| W8 | editorRenderWorker 的 `windowsHide` + `detached:true` | detached 在 Windows 上会新开控制台；windowsHide 应抑制 |
| W9 | codex client 在 win32 用 killTree 关闭 | codex.exe 子进程（rg 等）是否被清理 |
| W10 | `installEngineDir` 复制 `uv.exe/ffmpeg.exe/ffprobe.exe` 到 `bin\` | 与引擎 doctor 的 ffmpeg 检查路径是否匹配 |
