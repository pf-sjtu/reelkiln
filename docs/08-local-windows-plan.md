# 08 · Windows x64 本地执行计划（首轮实机验证 Runbook）

> 适用对象：在一台 **Windows 10/11 x64** 机器上首次运行移植版。
> 基线：仓库 `pf-sjtu/reelkiln` 分支 `master` 上包含本文档的最新提交（`git log -1 -- docs/08-local-windows-plan.md` 可查）。
> 原则：每一步都是**可独立验证**的小步；每步结束把“回报清单”中的内容原样贴回（JSON 行或截图）。任何一步失败都**停止**，先回报，不要自行修改引擎源码。
> **参考基线（2026-10-20 更新）：Linux 已实机跑通。** 本 Runbook 的每一步在 box（Debian 13 x86_64）上都有对应的已通过运行，可作为 Windows 结果的对照：引擎安装 / venv / doctor / 端到端出片见 `docs/11-linux-baseline.md` 与 `tools/linux_baseline.sh`；Electron 外壳真实 bootstrap + `editorRender:*` 出片见 `docs/12-linux-shell-run.md` 与 `tools/linux_shell_smoke.sh`；CI 中 `windows-latest` 已真实跑过移植版单元测试与引擎兼容层测试（`docs/13-ci.md`）。Windows 上的结果应与 Linux 基线**逐项一致**；不一致处即为 Windows 特有问题。
> 记号：**PORT-NEW** = 移植新增（原版 bundle 中不存在）；**原版** = 0.0.40 bundle 中已有的名字/行为。所有原版行号指 `app/reconstructed/main/index.js`。

---

## 0. 总览：本轮要回答的问题

| # | 问题 | 对应步骤 |
|---|---|---|
| Q1 | Windows 引擎 tarball 能否被移植版 `installEngineDir` 正确校验、解包（bsdtar、长路径、符号链接占位） | S3、S4 |
| Q2 | `uv sync --frozen` 能否在 Windows 上用托管 CPython 3.14.6 完成（120 个包均有 cp314/win_amd64 或纯 wheel，box 上已静态核对） | S5 |
| Q3 | 引擎 Python 侧 POSIX 兼容层（`_compat_proc` / `_compat_lock` / `_compat_dirfd`，docs/09）在真实 Windows 上是否工作 | S7、S8 |
| Q4 | remotion / hyperframes 的 `npm ci`（`node.exe npm-cli.js` 调用方式）能否装上 win32-x64 原生包 | S6 |
| Q5 | doctor 是否“只剩 gateway 红” | S8 |
| Q6 | codex 0.160.1 Windows 版能否完成 app-server 握手 | S9 |
| Q7 | Electron 外壳 + preload（184 个方法）+ 真实 `bootstrap:run`（开关）能否启动 | S10、S11 |

不在本轮范围：登录/网关/计费、Studio 会话、真正出片（会话层未移植，见 docs/10）。

---

## 1. 前置条件（S0）

### 1.1 系统设置

1. **长路径**：管理员 PowerShell 执行  
   `New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`  
   然后重启。（remotion/hyperframes 的 `node_modules` 很深；W4。）
2. **开发者模式（可选，推荐）**：设置 → 系统 → 开发者选项 → 开启。开启后 git 可创建真实符号链接；不开也行，`make_windows_engine.py` 会把符号链接占位文件物化为真实目录。
3. 建议把工作目录放在短路径，例如 `C:\vc\`。本文以下全部使用：
   - `C:\vc\repo` —— 仓库
   - `C:\vc\bootstrap` —— 引擎分发目录（`VIDEOCLAW_ENGINE_DIST`）
   - `C:\vc\ud` —— port-cli 用的 userData（Electron 运行时用 `%APPDATA%\videoclaw-port`）
   - `C:\vc\ws` —— port-cli 用的工作区（Electron 运行时原版行为是 `%USERPROFILE%\Videoclaw`）

### 1.2 需要安装 / 下载的东西

| 组件 | 版本要求 | 来源 | 放置位置 | 依据 |
|---|---|---|---|---|
| Git for Windows（含 Git Bash） | 任意近期版本 | git-scm.com | 默认 `C:\Program Files\Git` | `runBash` 在 Windows 上优先 PATH 上的 bash，否则查 `%ProgramFiles%\Git\bin\bash.exe` 等（`src/main/platform/shell.ts`）；找不到会降级为 cmd（degraded，引擎命令语法不兼容）。`git` shim 也依赖它 |
| Python（仅用于运行打包脚本） | ≥ 3.9 任意 | python.org 或 `uv python install` | PATH | 只运行 `tools\make_windows_engine.py`，与引擎 venv 无关 |
| Node.js（开发用，运行 npm/Electron） | 22.x（原版 bundle 内 node 为 **22.17.0**） | nodejs.org | PATH | `npm install && npm run build` |
| Node.js（bundled，给引擎用） | **22.17.0** win-x64 **zip** | `https://nodejs.org/dist/v22.17.0/node-v22.17.0-win-x64.zip` | 解压后**把内层目录内容**放到 `C:\vc\bootstrap\node\`，使 `C:\vc\bootstrap\node\node.exe` 与 `C:\vc\bootstrap\node\node_modules\npm\bin\npm-cli.js` 存在 | `npmInvocation` 依赖官方 zip 布局（W3） |
| uv | 原版 bundle 中 uv 版本**无法从 bundle 确定**（字符串暗示 0.11.x，未确认）；用最新稳定版并**记录版本号** | github.com/astral-sh/uv releases：`uv-x86_64-pc-windows-msvc.zip` | `C:\vc\bootstrap\uv.exe` | `bootstrapTool("uv")` 在 roots 中找 `uv.exe` |
| ffmpeg / ffprobe | 原版为 **9.0.1**（martin-riedl 构建，macOS）；Windows 取 9.x 的 win64 静态构建（如 gyan.dev 或 BtbN），**记录版本号** | — | `C:\vc\bootstrap\ffmpeg.exe`、`C:\vc\bootstrap\ffprobe.exe` | `installEngineDir` 会复制到 `<engine>\bin\`（W10） |
| codex | **严格 0.160.1** | npm：**`@openai/codex@0.160.1-win32-x64`**（已核实：`@openai/codex@0.160.1` 的 optionalDependencies 是 `npm:@openai/codex@0.160.1-<platform>` 别名；原版 bundle 的 `payload.manifest.json` npmIntegrity `sha512-6Znu97…` 正是 `0.160.1-darwin-arm64` 的 dist.integrity，故 Windows 取其同版本兄弟包）。dist.integrity：`sha512-yyqykHtHNhm0ZViofGozz9a4ffUyXDsiyRu9Q2hPNg/cu4uzSsovNr5kDmzBXPFWAilmlZuNkwpw1W7uae2nlg==`。获取：`npm pack @openai/codex@0.160.1-win32-x64` 后 `tar -xzf` | 把包内 `package\vendor\x86_64-pc-windows-msvc\` **下的全部内容**复制到 `C:\vc\bootstrap\codex\`，得到 `codex\bin\codex.exe`、`codex\bin\codex-code-mode-host.exe`、`codex\codex-package.json`（`"entrypoint": "bin/codex.exe"`）、`codex\codex-path\rg.exe`、`codex\codex-resources\{codex-command-runner.exe,codex-windows-sandbox-setup.exe,voice\…}`——与原版 macOS `bootstrap/codex/` 布局同构 | `resolveCodexExecutable`（L23422）：`VIDEOCLAW_CODEX_BIN` → `resources/bootstrap/codex/bin/codex` → `codex`；移植版在 win32 加 `.exe` |
| claude-agent-sdk 原生包 | `@anthropic-ai/claude-agent-sdk-win32-x64@0.3.281` | npm（原版 `claude-agent-sdk@0.3.281` 的 optionalDependencies 中列出） | 本轮无需放置（会话层的 claude 接入未移植） | `claudeCodeExecutable`（L22710）拼 `…/claude-agent-sdk-${platform}-${arch}/claude`，无扩展名；移植版在 win32 用 `claude.exe`——**已核实**：该包 `package.json` 的 `"files": ["claude.exe", …]`，包内为 `package/claude.exe`（linux-x64 包内为 `package/claude`） |

> 不要下载任何 macOS 引擎或从网关拉引擎：网关会下发 macOS 引擎，移植版已跳过网关分支（`resolveBundledEngineSource`，gateway 分支 NOT PORTED）。

### S0 回报清单
- [ ] `git --version`、`node -v`、`npm -v`、`python --version`
- [ ] `C:\vc\bootstrap\uv.exe --version`
- [ ] `C:\vc\bootstrap\ffmpeg.exe -version` 第一行、`ffprobe.exe -version` 第一行
- [ ] `C:\vc\bootstrap\node\node.exe -v`（应为 v22.17.0）
- [ ] `C:\vc\bootstrap\codex\bin\codex.exe --version`（应为 0.160.1），以及 `npm pack` 输出的 integrity 是否等于上表值
- [ ] `where bash`、`where git`
- [ ] LongPathsEnabled 是否已设为 1、是否开启开发者模式

---

## 2. S1 · 克隆仓库（禁止换行转换）

```bat
git config --global core.autocrlf false
git config --global core.longpaths true
git clone -c core.symlinks=true https://github.com/pf-sjtu/reelkiln.git C:\vc\repo
cd C:\vc\repo
git log -1 --format="%H %cI"
git status --short
```

说明：仓库 `.gitattributes` 已设置 `* text=auto eol=lf`（所有文本以 LF 检出——CI 首次在 windows-latest 上运行时，runner 默认 `core.autocrlf=true` 导致 `gen-verbatim` 的行锚点失配，由此加入）以及 `engine/** -text`、`bootstrap/** -text`，但仍请关闭 autocrlf 以防万一（引擎 `.claude/settings.json` 必须与工作区副本逐字节相等，doctor `hooks` 检查依赖这一点）。

### S1 回报清单
- [ ] 提交哈希
- [ ] `git status --short` 是否为空
- [ ] `dir C:\vc\repo\engine\remotion\public\sfx` 显示的是目录（符号链接）还是一个小文本文件（占位）——两者都可接受

---

## 3. S2 · 构建移植版（npm）

```bat
cd C:\vc\repo\port
npm install
npm run build
npm test
```

预期：`npm run build` 依次执行 gen（IPC 契约生成）、tsc、esbuild，产出 `dist\main\index.cjs`、`dist\main\editorRenderWorker.cjs`、`dist\preload\…`、`dist\renderer\…`、`dist\cli\port-cli.cjs`。box（Linux）上 `npm test` 为 **76/76** 通过；CI 的 `windows-latest` 同样运行这 76 项（POSIX 专属的差分/模式位断言在 win32 上显式 skip，`BootstrapCore.runAll` 步骤机用宿主平台运行，从而覆盖 win32 的 `uv.exe` 复制、`npm.cmd`、`Path` 键分支），结果见 `docs/13-ci.md`。本机结果应与 CI 一致；不一致请回报失败测试的名称与报错（本机多出的差异多半来自 Git Bash/PATH）。

### S2 回报清单
- [ ] `npm run build` 最后 20 行
- [ ] `npm test` 的 `tests / pass / fail` 统计，以及每个失败测试的名称 + 第一行错误

---

## 4. S3 · 生成 Windows 引擎 tarball

```bat
cd C:\vc\repo
python tools\make_windows_engine.py C:\vc\bootstrap
dir C:\vc\bootstrap
```

该脚本（PORT-NEW）做三件事：复制 `engine\`（已含兼容补丁）；把 `.claude\settings.json` 中 2 处 `/.venv/bin/python` 改为 `/.venv/Scripts/python.exe`；按原版布局（顶层 `engine/`、uid/gid 0、排序、固定 mtime）写 `engine-0.1.57-rc7-15f8f2d-win.tar.gz` 与只改了 `file`/`sha256` 的 `engine.manifest.json`。

参考值：box（Linux）上对当前源码生成的 sha256 为 `ea9f80af4c674113d90668f93c93e00833cc96f3b5b8baafee282848f2dbe3a1`。Windows 上生成的值**可能不同**（权限位/符号链接占位物化差异），**这是预期的**——安装时只校验与同目录 manifest 是否一致。

此时 `C:\vc\bootstrap` 应为：

```
C:\vc\bootstrap\
  engine.manifest.json
  engine-0.1.57-rc7-15f8f2d-win.tar.gz
  uv.exe
  ffmpeg.exe
  ffprobe.exe
  node\node.exe
  node\node_modules\npm\bin\npm-cli.js
  codex\bin\codex.exe
```

### S3 回报清单
- [ ] 脚本输出的 JSON（含 sha256）
- [ ] `dir /s /b C:\vc\bootstrap | findstr /v node_modules`

---

## 5. S4 · 安装引擎（port-cli，Electron 外）

`port-cli` 是 PORT-NEW 验证工具：直接调用**移植的**主进程代码路径，不启动 Electron；每个子命令输出一行 JSON `{ok, step, …}`。

```bat
cd C:\vc\repo\port
node dist\cli\port-cli.cjs install-engine C:\vc\bootstrap C:\vc\ud
```

内部：`resolveBundledEngineSource`（读 manifest、校验 `minAppVersion`）→ `installEngineDir`（sha256 校验 → `%SystemRoot%\System32\tar.exe` 解包 → 复制 uv/ffmpeg/ffprobe 到 `bin\`，带 `.exe`）。

预期成功输出含 `"path":"C:\\vc\\ud\\engines\\engine-0.1.57-rc7-15f8f2d"`。下文把这个路径记为 `%ENG%`：

```bat
set ENG=C:\vc\ud\engines\engine-0.1.57-rc7-15f8f2d
```

可能的首轮失败与含义：
| 现象 | 含义 / 处理 |
|---|---|
| `sha256 mismatch` | manifest 与 tarball 不是同一次生成；重跑 S3 |
| tar 报路径过长 | LongPathsEnabled 未生效（需重启），或 bsdtar 不支持长路径（W4）→ 回报完整 stderr |
| `bin\uv.exe` 不存在 | bootstrap 目录缺 `uv.exe`（W10） |

### S4 回报清单
- [ ] 完整 JSON 输出（含 `phase` 行）
- [ ] `dir %ENG%\bin`、`dir %ENG%\remotion\public\sfx`（应为一个有内容的目录）
- [ ] `type %ENG%\.videoclaw-build-sha256`

---

## 6. S5 · 命令 shim + Python venv（Q2）

```bat
node dist\cli\port-cli.cjs shims %ENG%
dir %ENG%\bin
node dist\cli\port-cli.cjs venv %ENG% C:\vc\bootstrap
```

`venv` 等价于原版 `ensureVenv`（L10036）：`uv sync --frozen --project %ENG%`，环境 `UV_PYTHON_PREFERENCE=only-managed`（原版 L7145）。非 darwin-arm64 上原版不追加 `--python`（L7172 提前返回），uv 会按 `engine\.python-version` = **3.14.6** 下载托管 CPython（需联网）。

如 port-cli 失败，手动复现（便于看完整输出）：

```bat
set UV_PYTHON_PREFERENCE=only-managed
C:\vc\bootstrap\uv.exe sync --frozen --project %ENG% -v
%ENG%\.venv\Scripts\python.exe --version
```

预期：`.venv\Scripts\python.exe --version` → `Python 3.14.6`。`uvloop` 因 `sys_platform != 'win32'` 标记被排除，属正常。

shim 说明：Windows 上 `%ENG%\bin\` 下应生成 `python3/python/pip3/pip/git` 的 sh 版（供 Git Bash）与 `.cmd` 版（CRLF，供 cmd/PowerShell）。`git` shim 在找不到 Git 时输出 PORT-NEW 提示 `git isn't available. Install Git for Windows and restart VideoClaw.`

### S5 回报清单
- [ ] 两条 port-cli 的 JSON
- [ ] `dir %ENG%\bin` 文件列表
- [ ] `%ENG%\bin\python.cmd --version` 与 Git Bash 中 `"$ENG/bin/python" --version`（W5）
- [ ] uv 失败时：`uv sync -v` 最后 60 行（重点：哪个包没有 wheel / 哪个包构建失败）

---

## 7. S6 · remotion / hyperframes 依赖（Q4）

```bat
node dist\cli\port-cli.cjs remotion %ENG% C:\vc\bootstrap
node dist\cli\port-cli.cjs hyperframes %ENG% C:\vc\bootstrap
```

等价于原版 `ensureRemotion`（L10047）/ `ensureHyperframes`（L10067）：在 `remotion\`、`hyperframes\` 下 `npm ci --no-audit --no-fund`，PATH 前置引擎 `bin` 与 bundled node。Windows 上 npm 以 `C:\vc\bootstrap\node\node.exe …\npm-cli.js` 调用（避免 `.cmd` + `shell:false` 的 CVE-2024-27980 限制）。package-lock 中已有 `@remotion/compositor-win32-x64-msvc`、`@rspack/*`、`@esbuild/*`、`@img/sharp-*` 的 win32-x64 条目。

### S6 回报清单
- [ ] 两条 JSON（失败时含 stderr 尾部）
- [ ] `dir %ENG%\remotion\node_modules\@remotion | findstr compositor`

---

## 8. S7 · 引擎 Python 兼容层冒烟（Q3）

```bat
cd C:\vc\repo
%ENG%\.venv\Scripts\python.exe tools\test_engine_compat.py
python tools\engine_import_smoke.py posix
```

- `test_engine_compat.py`：共 14 项。Linux 上 11 过 3 skip（`WindowsReal` 类）；Windows 上 POSIX 专属类 skip，`WindowsReal` 实跑：真实 `msvcrt` 跨进程锁冲突、`CREATE_NEW_PROCESS_GROUP` + `taskkill /T` 杀孙进程（以 `tasklist` 确认），`_compat_dirfd` 走模拟路径并与原生产物差分。**CI windows-latest 上已全部通过**（docs/13），本机复跑用于确认与 CI 一致。
- `engine_import_smoke.py posix`：逐模块导入 `engine\tools\*.py`（第三方包用桩），box 上 80/80。Windows 上的 “posix” 模式其实就是真实 Windows 导入。

注意：这两个脚本是针对仓库内 `engine\` 运行的。

### S7 回报清单
- [ ] 两个脚本的完整输出（失败用例的 traceback）

---

## 9. S8 · 工作区 + doctor（Q5，核心验收）

```bat
cd C:\vc\repo\port
node dist\cli\port-cli.cjs stage-workspace %ENG% C:\vc\ws
node dist\cli\port-cli.cjs doctor %ENG% C:\vc\ws C:\vc\bootstrap
```

- `stage-workspace`（PORT-NEW 子命令）调用部分移植的 `writeWorkspacePartial`：创建 `jobs/assets/incoming/taste/taste\packs/.claude`（原版 L4456-4463），复制 `_starter`/`_default` taste pack（L9651-9662），逐字节复制 `.claude\settings.json`（L9685-9688）。CLAUDE.md 未移植（doctor 不检查它）。
- `doctor` 等价于原版 `runDoctor`（L9689）：`uv run --project %ENG% python %ENG%\tools\doctor.py --json`，环境 `VIDEOCLAW_ENGINE=%ENG%`、`VIDEOCLAW_WORKSPACE=C:\vc\ws`、`VIDEOCLAW_JOBS_DIR=C:\vc\ws\jobs`、`UV_PYTHON_PREFERENCE=only-managed`、`PATH=`引擎 bin + bootstrap 工具目录 + 继承 PATH。

手动复现（输出完整 JSON；**务必带 `--json`**，非 JSON 模式输出 emoji，cp936 控制台会 `UnicodeEncodeError`；或设 `PYTHONUTF8=1`）：

```bat
set VIDEOCLAW_ENGINE=%ENG%
set VIDEOCLAW_WORKSPACE=C:\vc\ws
set VIDEOCLAW_JOBS_DIR=C:\vc\ws\jobs
set UV_PYTHON_PREFERENCE=only-managed
set PATH=%ENG%\bin;C:\vc\bootstrap;C:\vc\bootstrap\node;%PATH%
C:\vc\bootstrap\uv.exe run --project %ENG% python %ENG%\tools\doctor.py --json
```

doctor 检查项（`engine\tools\doctor.py` `CHECKS`）与预期：

| 检查 | 预期 | 若红 |
|---|---|---|
| ffmpeg / ffprobe | 绿 | PATH 中没有 `ffmpeg.exe` → 看 `%ENG%\bin` |
| node | 绿 | bundled node 不在 PATH |
| python venv | 绿 | S5 未完成 |
| yt-dlp | 绿（venv 内 yt-dlp） | 回报 detail |
| remotion | 绿（`node_modules` 存在） | S6 未完成 |
| **gateway** | **红（预期）**：`no VIDEOCLAW_API_KEY (env or engine .env)` | 移植版不设 gatewayUrl；原版会注入 `VIDEOCLAW_GATEWAY_URL` 与占位 key `vcs_doctor_no_authority`（L9704）并联网 `GET /healthz`。本轮**不要**设置真实 key |
| workspace | 绿 | 写探针失败 → 权限/路径问题 |
| hooks | 绿 | `portable_settings_errors` 报错 → settings.json 的 `.venv/Scripts/python.exe` 改写或字节不一致（CRLF？） |
| taste packs | 绿 | stage-workspace 未执行 |

**本步通过标准：除 `gateway` 外全部绿。**

### S8 回报清单
- [ ] 两条 port-cli JSON
- [ ] 手动 doctor 的完整 JSON 输出

---

## 10. S9 · codex 握手 + runBash（Q6）

```bat
node dist\cli\port-cli.cjs codex-handshake C:\vc\bootstrap\codex\bin\codex.exe
node dist\cli\port-cli.cjs run-bash "echo hi && uname -a && which python3"
```

- Linux 对照（box 实测，`artifacts/linux-run/codex-handshake.json`）：`{"ok":true,"step":"codex-handshake","account":{"account":null,"requiresOpenaiAuth":true,"workspaceRouting":null},…,"ms":171}`。Windows 上 `account` 部分应完全相同。
- `codex-handshake`：用临时 `CODEX_HOME` 启动 `codex app-server`（stdio JSON-RPC），发 `initialize` → 校验服务端版本（`assertCompatibleServer`）→ `account/read {refreshToken:false}`；结束时 win32 下用 `taskkill /T` 关闭（W9）。预期 `ok:true`，`account` 为未登录状态。不登录、不发起 turn。
- `run-bash`：经 Git Bash 执行（W2）。若输出显示是 cmd 执行（`uname` 不存在），说明没找到 Git Bash。

### S9 回报清单
- [ ] 两条 JSON
- [ ] 握手后任务管理器中是否残留 `codex.exe` / `rg.exe` 进程

---

## 11. S10 · 启动 Electron 外壳（假后端）（Q7）

```bat
cd C:\vc\repo\port
npm run start
```

预期：窗口显示 `window.videoclaw exposes 184 methods (expected 184).`；控制台（启动它的终端）打印 `[port] real (ported) handlers: …` 与 `[port] registered 157 handle + 3 on; fake-implemented: …`。点击 **Ping** 按钮：`bootstrapStatus`/`listClients`/`getAppUpdateState` 返回 fixture，`voiceDictationStatus` 与 `listSessions` 走真实移植实现（`listSessions` 读 `%APPDATA%\videoclaw-port\sessions.json`，不存在时返回空列表），`bootstrapRun` 返回 fixture（未开开关时）。

### S10 回报清单
- [ ] 窗口截图
- [ ] 终端输出全部 `[port]` 行
- [ ] Ping 后窗口日志区文本

---

## 12. S11 · 真实 bootstrap（开关，可选）

```bat
set VIDEOCLAW_ENGINE_DIST=C:\vc\bootstrap
set VIDEOCLAW_PORT_REAL_BOOTSTRAP=1
npm run start
```

- `VIDEOCLAW_ENGINE_DIST`：**原版**环境变量（L9301 等），开发态引擎来源目录。
- `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1`：**PORT-NEW** 开关，使 `bootstrap:run` 走移植的 `BootstrapCore.runAll()`。
- 此模式写入真实位置：引擎 → `%APPDATA%\videoclaw-port\engines\`，工作区 → `%USERPROFILE%\Videoclaw`（原版 `workspaceLeafForChannel("prod")`）。如不想污染，先跳过本步。

点 Ping 后观察 `bootstrap:progress` 推送，预期依次：`engine → venv → remotion → hyperframes → workspace → env → doctor`，在 **doctor 步因 `gateway` 失败而结束**（`doctor failed → gateway: …`）。`validateEngineSessionContext`、生产契约（`assertInstalledEngineProductionContract`/`inspectProductionCompatible`）、`assertEngineMoneyCompatibility` 现已是从原版逐字生成的真实实现（docs/12 §3），不再出现 `SKIPPED … (NOT PORTED)`；`writeWorkspace` 仍为部分移植（`[port] PARTIAL writeWorkspace`）。

可选：再加 **PORT-NEW** 开关 `set VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1`，则“唯一失败项为 gateway”的 doctor 报告被接受，继续激活（money 兼容检查 → 写 `engine-current.json`），`bootstrap:status` 变为 `ready:true`。这与 Linux 上 `tools/linux_shell_smoke.sh` 第 1 轮完全相同。

无人值守版（与 Linux 冒烟同一脚本，PORT-NEW 开关 `VIDEOCLAW_PORT_SMOKE=1`，跑完自动退出并打印 `[smoke]` 行；Windows 下以 PowerShell 设置环境变量后执行 `npx electron .`）。第 2 轮 `editorRender:start` 需要 `sessions.json` 与合成目录 fixture，其写法见 `tools/linux_shell_smoke.sh`（目前只有 bash 版，Windows 等价 `.ps1` **未编写**——TODO，需在 Windows 上编写并验证，不在 box 上臆造）。

### S11 回报清单
- [ ] 窗口日志区全部 `push bootstrap:progress` 行
- [ ] 终端中 `[setup]` 与 `[port]` 行

---

## 13. 预期首轮失败与兼容层对应关系

| 失败点 | 根因 | 现有处理 | 状态 |
|---|---|---|---|
| 引擎工具导入 `fcntl`/`pwd`/`termios` 失败 | POSIX-only 模块 | `_compat_lock`、`_compat_proc`、模块级条件导入（docs/09 E1-E10） | box 上 winsim 80/80；未实机 |
| `os.O_DIRECTORY` AttributeError / `dir_fd` NotImplementedError | Windows 无目录 fd | `_compat_dirfd` 路径模拟（E11/E12） | 未实机；语义弱于 POSIX（TOCTOU） |
| 读写偏移错乱 / 二进制损坏 | Windows `os.open` 默认文本模式 | `O_BINARY`（E11/E14） | 未实机 |
| `os.killpg`/`setsid` 缺失 | 无进程组 | `_compat_proc.kill_process_group` → `taskkill /T /F` | 未实机（W1） |
| `npm.cmd` spawn EINVAL | CVE-2024-27980 后 `.cmd` 需 shell | `npmInvocation` 用 `node.exe npm-cli.js` | 未实机（W3） |
| hooks 检查不一致 | settings.json 指向 `.venv/bin/python` | `make_windows_engine.py` 改写为 `.venv/Scripts/python.exe` | 未实机 |
| `msvcrt` 锁 / `taskkill /T` 行为不符 | — | `_compat_lock` / `_compat_proc` | **CI windows-latest 实测通过**（`WindowsReal`） |
| `editorRender:start` 返回 `unknown-session` | `sessions.json` 中无此会话 | 会话注册表只读子集已移植（docs/12）；需要先有会话（创建会话未移植，冒烟用 fixture） | Linux 已验证 |
| 约 140 个通道报未实现 | 未移植 | 无（预期，docs/10） | — |

## 14. 本轮之后

把 S0–S11 的回报贴回后，按失败点分类修复（引擎兼容层 → docs/09；主进程 → docs/10），然后进入下一阶段：会话层其余部分（创建会话、session host / AgentHost 运行时、claude-agent-sdk 接入；`engineSessionEnv`/`validateEngineSessionContext` 已移植并在 Linux 验证）、处理剩余无 `.exe` 的主进程路径（L16293/L59694 库预览/海报）。
