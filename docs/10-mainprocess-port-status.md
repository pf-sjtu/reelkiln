# 10 · 主进程模块移植状态（Phase 3，静态移植）

> 范围：`port/src/main/**`。全部工作在 box（Linux）上完成，**没有运行 Electron、没有运行真实引擎、没有 Windows 运行时**。
> 行号均指 `app/reconstructed/main/index.js`（除非注明 `out/main/...`）。"PORT-NEW" 表示原版 bundle 中不存在、为移植新增的内容。
> 校验方式：`npm run build`（gen + tsc + esbuild）与 `npm test`（67 个 node:test 用例）全绿。

## 1. IPC handler 统计（157 个 invoke 通道 + 3 个 send 通道）

| 类别 | 数量 | 通道 |
|---|---|---|
| **真实移植（ported-real）** | 5 | `editorRender:start` / `editorRender:cancel` / `editorRender:state`（EditorRenderController + utilityProcess worker，L62405-62428；`getSession` = SessionRegistry.liveSession，`resolveEngine` 走真实 `engineSessionEnv`）、`media:voiceDictationStatus`、`session:list`（L61697，只读 SessionRegistry，见 docs/12） |
| **真实移植，需开关** | 1 | `bootstrap:run` —— 仅当 PORT-NEW `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1` 时走 `BootstrapCore.runAll()`。doctor 的 `gateway` 检查需要凭据必为红，runAll 按原版在 doctor 步结束；PORT-NEW `VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1` 可接受“只有 gateway 红”的报告，随后真实执行激活：`assertEngineMoneyCompatibility`（L6426）、`assertInstalledEngineProductionContract`（L6982）、`validateEngineSessionContext`（L4188）均已移植（docs/12）。Linux 上已端到端跑通 |
| **fixture 假实现（fake）** | 12 | `bootstrap:status`、`bootstrap:run`（默认）、`client:list`、`client:create`、`settings:get`、`app:restart`、`engine:pendingToast`、`hfPreview:available`、`feedback:discard`、`engine:codexHandoffOffer`、`job:get`、`app:update:state`（值来自 qaFixtures / 主进程 fallback，带行号） |
| **未实现（stub → `undefined` + 日志）** | 140 | 其余全部（5 + 12 + 140 = 157） |
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
- `writeWorkspace`（L9650）—— **部分移植**：`initializeWorkspaceChannel` 的 6 个目录（L4456-4463）、taste packs 种子复制（L9651-9662）、`.claude/settings.json` 逐字节复制（L9685-9688）已移植（正是 doctor 的 workspace/hooks/taste packs 检查所读内容）；CLAUDE.md 生成/迁移、`auditWorkspaceChannel`、工作区符号链接逃逸防护未移植。真实模式下 `validateEngineSessionContext` 记录 SKIPPED 日志后跳过
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


## 增补（Linux 基线阶段，docs/11、docs/12）

新增移植（逐字节切片，由 `port/tools/gen-verbatim.mjs` 从原 bundle 生成，`--check` 测试保证与原文一致，仅允许列出的平台层替换）：

| 文件 | 来源 | 替换 |
|---|---|---|
| `session-context.generated.ts` | L972-978、L4024-4208（REQUIRED_SESSION_CONTEXT_FILES、SessionContextError、validateCanonicalSettings、readRequired、sourceHashes、validate(Installed)EngineSessionContext、assertEnginePython） | `.venv/bin/python` → `venvPython()`（1 处） |
| `money-compat.generated.ts` | 分块 L1737-1799（PAID_GEN_TOOLS、unpricedPaidGenTools）、L6239-6434（billing CLI 契约、PRICE_SURFACE_DUMP、inspect/cached/assertEngineMoneyCompatibility） | `.venv/bin/python` → `venvPython()`（2 处） |
| `production-contract.generated.ts` | L6439-6441、L6892-6987（exactPythonConstant、inspect/assertInstalledEngineProductionContract） | 无 |
| `voice-guard.ts` | 分块 L3767+（BANNED_USER_FACING_VOCABULARY、VOICE_GUARD） | 无（测试与分块导出 `B`/`V` 比对） |

手写移植：`session.ts`（`engineSessionEnv` L9380 逐行，含差分测试；`SessionRegistry` = `loadRegistry` L35661 的只读子集 + `listSessions` L38348 + `liveSession` L62403）。

已从“未移植协作者”列表中移除：`validateEngineSessionContext`、`assertInstalledEngineProductionContract`、`inspectInstalledEngineProductionContract`、`assertEngineMoneyCompatibility`、`engineSessionEnv`。仍未移植：AgentHost 运行时（createSession、agent turn、registry 写入）、Studio bundle store、gateway 引擎下载、mediaCapabilities 授权。

## 增补（M17，docs/34）：Windows 上到底验证了什么

**结论先说：本轮在真实 Windows 上新验证的内容为零。** GitHub Actions 自 2026-10-21 13:03 SGT（run 39547313316）之后所有 run 都因账单问题未启动（“recent account payments have failed or your spending limit needs to be increased”），本轮 4 个 run 同样如此（`artifacts/phase-b-m17/ci-billing-blocked.txt`）。以下是可以诚实陈述的层级：

| 层级 | 内容 | 状态 |
|---|---|---|
| 真 Windows（CI windows-latest，最后一次能跑是 39547313316） | port 单测 161/163，2 个失败均为测试里写死 POSIX 路径 | 两处已在 4071f42 修正；**修正后未在真 Windows 上跑过** |
| WINE（box 上 wine 10 + 官方 win-x64 Node 22.23.4，`process.platform === "win32"`） | 全部 324 个单测 | 修正前 297/323 通过；修正后 **311 通过 / 6 失败 / 7 跳过**。剩下 6 个失败都是环境限制：wine 没有 System32 `tar.exe`（3 个）和 Git Bash（runBash 3 个，退回到了 cmd）（`artifacts/phase-b-m17/wine-win32-tests/`）。**WINE 不等于 Windows。** |
| 在 Linux 上交叉构建 | `npm run package:win` → nsis `-setup.exe` + `-portable.exe` + win-unpacked（需要 wine32 跑 NSIS 卸载器 stub） | 能构建（sha 见 `win-cross-build/`）；NSIS 在 wine 下静默安装 `/S /D=` 返回 exit 2，**结论不明** |
| WINE 下的打包主进程 | `videoclaw-port.exe` 设置 `VIDEOCLAW_PORT_SMOKE=1` | 主进程能启动：注册了 157 个 handle 和 3 个 on，renderer URL 已解析；渲染器 smoke 150 s 内没跑完（wine 的 GPU/DirectComposition），**未验证** |

这轮用 WINE 找到并修掉的真实 Windows 缺陷，都是原版只在 `sep === "/"` 的环境里跑过造成的，修法都是 POSIX 上行为不变的平台层替换：
- `CharacterStore.assertInside`、`Quickstart contained()`：改成按 `root + sep` 判断是否在目录内（之前所有角色操作和 Quickstart 目录在 Windows 上都会被拒绝）。
- `attestCandidate`（project trash）：`suffix.split(sep)`。之前在 Windows 上删除视频的计划永远为空。
- `CharacterVoiceStore`：voices.json 里存 `posixRelative()`。原版 `read()` 会拒绝含 `\` 的路径，导致在 Windows 上保存一次音色之后音色就再也读不出来。
- `taste` 标题：取 `file.split(sep)` 的倒数第二段作为父目录名。
- `codex-minimax.resolveCodexExecutable`：按平台选择 `@openai/codex-<os>-<arch>` 和目标三元组，Windows 上用 `codex.exe`。之前只有 linux-musl。
- `vcmedia://`：main 侧用 `pathToFileURL().pathname` 生成 URL，Windows 上是 `/C:/…`，现在映射回 `C:\…`（`vcmediaFilePath`）。

新增的 Windows 风险条目（接在 W1–W10 后面）：

| # | 改动/现象 | 风险 |
|---|---|---|
| W11 | 原版渲染器 `mediaUrl(abs)` 只按 `/` 切分并编码 | 渲染器拿到原生 `C:\…` 路径时，生成的 `vcmedia://localC%3A%5C…` 会把路径并入 host，媒体预览会失效。main 侧只能兜住自己生成的 URL。需要在真 Windows 上看哪些路径会传到渲染器 |
| W12 | NSIS `oneClick:false, perMachine:false` 的静默安装 | wine 下 exit 2，需要在真 Windows 上验证 `/S /D=` |
| W13 | 找不到 Git Bash 时 runBash 退回 cmd | wine 下已经实际观察到这种退回（`sleep` 不是内部命令）。引擎命令依赖 bash 语法，没有 Git 的机器会表现为“能跑但结果错” |
| W14 | M16 collector 的单测在 win32 上跳过 | 假引擎用的是 POSIX python 软链接，Windows 上的 late-result collector 没有覆盖 |

## 增补（M18，docs/35）：真实 Windows 上已验证的项目
仓库公开后 GitHub Actions 恢复，以下内容在 **windows-latest 真机**上跑过（不是 WINE）。最终全绿的一轮是 [39716976884](https://github.com/pf-sjtu/reelkiln/actions/runs/39716976884)（2026-10-22 11:28 SGT），各轮细节见 docs/35 §1。

| # | 原风险 | 真实 Windows 上的结果 |
|---|---|---|
| W1 | `killTree` → `taskkill /T` | 在 runbook 的 codex 握手里实际执行：不带 `/F` 的 taskkill 对无窗口控制台程序**无效**，现在升级为 `/F`，`codex-leftover-tasklist.txt` 里没有残留（[39711542276](https://github.com/pf-sjtu/reelkiln/actions/runs/39711542276) 起） |
| W2 / W13 | Git Bash 作为 runBash shell | runner 装有 Git：`run-bash` 输出 `MINGW64_NT-10.0-26100`，`python3` 解析到引擎 shim。**没有 Git 的机器仍未验证** |
| W3 | `npmInvocation`（node.exe + npm-cli.js） | remotion `npm ci` + `browser ensure`、hyperframes 都成功 |
| W4 | System32 bsdtar | 引擎 tarball 安装成功 |
| W5 | `.cmd` 与 sh shim | `python.cmd --version`、`bin/python --version`（Git Bash）都成功 |
| W9 | codex client 关闭 | 已修（见 W1）；握手 `{"ok":true}` |
| W10 | `bin\` 下的 uv/ffmpeg/ffprobe | doctor 除 gateway（需真 key）外全绿 |
| W12 | NSIS `/S /D=` 静默安装 | **已解决**：真 Windows 上 exit 0，安装后的应用 packaged smoke `DONE failed=[]`；wine 下的 exit 2 是 wine 的问题 |
| — | 原版引擎在 Windows 上的完整渲染 | **L0 E1–E15 全部通过**。为此在端口创建的 venv 里加了一个只在 win32 生效的启动钩子（`port/src/main/engine/win-exec-shim.ts`）：裸 `npx`/`npm` 映射为 `node.exe npx-cli.js`（不经 cmd.exe）；只读句柄 `os.fsync` 的 EBADF 改由写句柄刷新。引擎源码没有改 |
| — | port 单测 | 323 通过 / 9 跳过 / 0 失败 |

仍未在真 Windows 上验证：W6（PATH 合并只在 runbook 子进程里间接覆盖）、W7（NTFS `dev:ino` 稳定性没有专门测试）、W8（editorRenderWorker 的 detached 控制台窗口）、W11（原版渲染器的 `vcmedia://` 拼接，需要 Windows 上的 UI 流程）、W13（无 Git 的机器）、W14（collector 测试在 win32 跳过），以及原版 UI 主流程（S1 UI e2e 未做，docs/35 §1.4）。

新增弱于原版之处：
5. **Windows 引擎钩子**：端口在引擎 venv 的 site-packages 里放了 `.pth` 钩子，改写了 `subprocess.Popen` 对裸 `npx`/`npm` 的处理和 `os.fsync` 的 EBADF 分支。只影响 win32；如果引擎以后自己处理了 Windows，这个钩子应当删掉。

## 增补（M19，docs/36）：Windows S1 UI e2e 与 W11 / W13 / W14
CI job `windows-s1-ui`（windows-latest，win-unpacked，原版渲染器 + CDP，FAKE-LLM 回放 S1 关键路径）第一次 allPass：[39724411939](https://github.com/pf-sjtu/reelkiln/actions/runs/39724411939)（2026-10-22 12:53 SGT）。

| # | 结果 |
|---|---|
| W11 | **已验证并修复**：原版 `mediaUrl()` 对 `D:\…` 生成 `vcmedia://localD%3A%5C…`（预览全部离线，真机截图证实）。win32 preload 在主世界改写为 `vcmedia://local/D%3A/…`；Output 面板播放 2.57 s 推进。聊天内相对链接仍显示 “Link unavailable”（W11b，未修） |
| W13 | **已处理**：没有 Git Bash 时 runBash fail closed，返回安装 Git for Windows 的提示；win32 上以无 Git 的 PATH 实际验证 |
| W14 | **已验证并修复**：collector / 原生 model-call 使用 `venvPython()`；saved 路径校验按 `sep` 归一；6 个 collector 测试在 win32 上通过 |
| 新 | production verdict CRLF：Windows 上每次 agent Bash 都被拒绝，已修（仅 win32 去掉一个结尾 CRLF） |

仍未在真 Windows 上验证：W6、W7、W8、W11b、NSIS 安装版上的 S1、真实模型在 Windows 上的 agent 行为。
