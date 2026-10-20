# 02 · 外部依赖与环境变量（不还原，env/路径配置连接）

> 结论先行（verified）：**Videoclaw 0.0.40 的 JS 层没有任何 `FFMPEG_PATH` / `FFPROBE_PATH` / `UV_PATH` / `NODE_PATH` 一类的"指向可执行文件"的环境变量**（全 bundle grep 无结果）。旧 stub 表中的 `VIDEOCLAW_FFMPEG`、`FFMPEG_PATH`、`VIDEOCLAW_FFPROBE`、`FFPROBE_PATH`、`VIDEOCLAW_NODE`、`VIDEOCLAW_UV`、`CODEX_PATH` **均为 not found in bundle**，已删除。
> 实际机制是"**固定目录约定 + 少量开发期覆盖变量**"：
> 1. 二进制随包放在 `<process.resourcesPath>/bootstrap/`；
> 2. 引擎安装时把 `ffmpeg / ffprobe / uv` **复制**进 `<engine>/bin/`；
> 3. 之后所有子进程以 `PATH = <engine>/bin : <bootstrap>/node/bin : $PATH` 运行，引擎 Python 端用 `shutil.which("ffmpeg")` 查找（`engine/tools/hyperframes_render.py:961/978`、`tools/_media/chunker.py:36/51`）。
>
> 唯一可"重定向"这些工具的 env：`VIDEOCLAW_ENGINE_DIST`（工具根目录，前插）、`VIDEOCLAW_CODEX_BIN`（codex，仅非 requireBundled 时）。行号均指 `app/reconstructed/main/index.js`。

## 1. 工具根目录解析 `resolveBootstrapToolRoots()`（L9292-9304，verified）

```js
roots = [ join(resourcesPath, "bootstrap") ]                 // resourcesPath = process.resourcesPath
if (!app.isPackaged) roots.push(join(appPath,"resources","bootstrap"),
                                join(appPath,"apps","desktop","resources","bootstrap"))
devOverride = process.env.VIDEOCLAW_ENGINE_DIST?.trim()      // 注意：打包版也生效（没有 isPackaged 判断）
if (devOverride) roots.unshift(devOverride)                  // 最高优先级
→ 去重、去空
bootstrapTool(name) = roots.map(r => join(r, name)).find(existsSync)
tool(name)          = bootstrapTool(name) ?? name            // L9427：找不到时退回裸命令名（走 PATH）
```

`VIDEOCLAW_ENGINE_DIST` 同时也是**引擎 tarball 的离线来源目录**（需含 `engine.manifest.json` + `engine-<ver>.tar.gz`，L9544-9562；错误提示原文："dev: set VIDEOCLAW_ENGINE_DIST to a dir with engine.manifest.json + tarball"）。

## 2. 逐个依赖

| 依赖 | 查找顺序（verified） | 调用形态（verified） | 相关 env |
|---|---|---|---|
| **ffmpeg** | ① 引擎内：`join(resolveEngineRoot(cwd), "bin", "ffmpeg")`（库预览 L16293、海报帧 L59694，**不存在即报错，不回退 PATH**）；② 语音：`voiceTools().ffmpeg = roots.map(r=>join(r,"ffmpeg")).find(existsSync) ?? ""`（L10469，即 bootstrap 根）；③ 引擎 Python 工具：PATH（`<engine>/bin` 在最前） | 见 §3 | 无专用 env；间接受 `VIDEOCLAW_ENGINE_DIST` 影响 |
| **ffprobe** | `[<currentEngine>/bin/ffprobe, ...bootstrapRoots/ffprobe].find(existsSync)`；L41116 找不到就跳过，L45069 找不到回退裸 `"ffprobe"` | `ffprobe -v error -show_entries format=duration:stream=codec_type[,codec_name] -of json <file>`，`env: sanitizedAgentEnv(process.env)`，超时 5s/15s | 同上 |
| **uv** | ① Bootstrap/doctor：`tool("uv")`（bootstrap 根 → 裸 `uv`）；② 编辑器渲染：`<engineRoot>/bin/uv` 存在则用，否则 `"uv"`（L60647）；③ 媒体库索引 `uvBin()`（L16109）：依次查 `EXTRA_PATHS = [~/.local/bin, /opt/homebrew/bin, /usr/local/bin, ~/.cargo/bin]` 下的 `uv`，否则 `"uv"` | `uv sync --frozen --project <engine> [--python cpython-X.Y.Z-macos-aarch64]`（L10035）；`uv run --project <engine> python <engine>/tools/doctor.py --json`（L9690）；`uv python find --system [--project P] [--show-version]`（L7180）；`uv run python tools/index_media.py …`（L16122）；`uv run python tools/hyperframes_render.py --job <id>`（L56097） | **写入**子进程：`UV_PYTHON_PREFERENCE=only-managed`（`UV_PYTHON_POLICY_ENV`，L7145）。**剥离**（`AGENT_STARTUP_ENV_DENYLIST` L16003）：`UV_ENV_FILE, UV_PROJECT, UV_PROJECT_ENVIRONMENT, UV_PYTHON, UV_PYTHON_PREFERENCE, UV_WORKING_DIR` 以及 `PYTHONHOME/PYTHONPATH/PYTHONSTARTUP/PYTHONUSERBASE/PYTHONEXECUTABLE/PYTHONINSPECT/VIRTUAL_ENV/__PYVENV_LAUNCHER__/BASH_ENV/BASHOPTS/CDPATH/ENV/GLOBIGNORE/SHELLOPTS` |
| **node / npm** | `<bootstrapRoot>/node/bin/node` + `<bootstrapRoot>/node/lib/node_modules/npm/bin/npm-cli.js`（L7083-7090）；引擎 PATH 中加入 `<bootstrapRoot>/node/bin`（`enginePath_` L9313） | `npm ci --no-audit --no-fund`（`<engine>/remotion`、`<engine>/hyperframes`）；`npx remotion browser ensure`（L10055-10080）。引擎 `bin/npm` 是生成的 sh shim：`export PATH=<node>/bin:"$PATH"; exec <node>/bin/node <npm-cli.js> "$@"`（L7092-7094） | 无专用 env |
| **Electron-as-node** | `process.execPath` | `spawn(process.execPath, ["-e", RELATIVE_TEXT_REPLACER, identity, filename, stagingName, maxBytes])`（L2752，项目文本原子写入） | 写入 `ELECTRON_RUN_AS_NODE=1`, `LANG=C`, `PATH`（L2715） |
| **codex** | `resolveCodexExecutable(explicit, env, resourcesPath, requireBundled)`（L23422）：`requireBundled` → 只认 `<resources>/bootstrap/codex/bin/codex`（缺失即报 "The packaged Codex runtime is unavailable"）；否则 `explicit` → **`VIDEOCLAW_CODEX_BIN`** → bundled → 开发期 `<out>/../../resources/bootstrap/codex/bin/codex` 等 → 裸 `"codex"` | `codex app-server --listen stdio://`（L24259），换行分隔 JSON 消息（见 05 文档）。版本硬性要求 `SUPPORTED_CODEX_VERSION = "0.160.1"`（L23381），握手时校验 userAgent | `CODEX_HOME` = `CODEX_SQLITE_HOME` = `<userData>/codex-profile`（L52527，app 自管隔离 profile）；`VIDEOCLAW_OPENAI_API_KEY` / `VIDEOCLAW_OPENROUTER_API_KEY`（app 把已保存的 provider key **注入**子进程，codex `config` 里 `env_key` 指向它们，L23420-23477） |
| **claude-agent-sdk / claude CLI** | `claudeCodeExecutable()`（L22710）：未打包 → `"claude"`（PATH）；打包 → `<app.asar.unpacked>/node_modules/@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude` | SDK `query({ prompt, options:{ pathToClaudeCodeExecutable, env, … } })`；辅助命令：`claude --version`、`claude auth status --json`（退出码 1 = 未登录，L22767） | 见 §4 |
| **voice-dictation**（Swift 原生助手，源码 `asar-src/native/VoiceDictation.swift`） | `roots.map(r=>join(r,"voice-dictation")).find(existsSync) ?? ""`（L10468） | `voice-dictation --check` → JSON `{available, error?}`（15s）；`voice-dictation <wav>` → JSON `{text}` 或 `{error}`（300s）（L10481、L10683） | 无 |
| **osascript**（macOS PDFKit 读 PDF） | `/usr/bin/osascript`（仅 darwin，L56968） | `osascript -l JavaScript -e <PDFKIT_READER_SCRIPT> -- <PDF_MAX_PAGES> <PDF_MAX_TEXT_CHARS>`，PDF 字节经 stdin | 写入 `PATH=/usr/bin:/bin, HOME, TMPDIR` |
| **ps / lsof**（孤儿引擎子进程清扫） | `ps`；`/usr/sbin/lsof` → `lsof` | `ps -Awwo pid=,ppid=,command=`；`lsof -a -d cwd -Fn -p <pid>`（L31604/L31630） | — |
| **/bin/sh, /bin/bash, tar** | 绝对路径 / PATH | `/bin/sh -c RELATIVE_WRITER …`（L2928，`PATH=/usr/bin:/bin`）；`/bin/bash -c withOutputPipefail(cmd)`（device/codex 命令执行 L25331）；`tar -xf <tgz> -C <staging> --strip-components 1`（L10016） | — |
| **python（引擎 venv）** | 固定 `<engine>/.venv/bin/python`（多处；缺失时提示 `PYTHON_REPAIR_MESSAGE`） | 见 05 文档 §3 | `PYTHON_DOTENV_DISABLED=1`（禁止引擎读 `.env`） |

## 3. ffmpeg 精确参数（verified）

- **语音笔记入库**（L10548，`voiceNoteIntakeFile`）：
  `ffmpeg -nostdin -v error -protocol_whitelist file -f matroska -i <note.webm> -t 120 -vn -map_metadata -1 -ac 1 -ar 48000 -c:a pcm_s16le -f wav <out.part>`（30s 超时，SIGKILL）
- **语音转写前转码**（L10659）：
  `ffmpeg -nostdin -v error -protocol_whitelist file -f matroska -i <note.webm> -t 120 -vn -ac 1 -ar 16000 -c:a pcm_s16le <note.wav>`
- **素材库片段预览**（L16298，`libraryPreview`）：
  `ffmpeg -hide_banner -loglevel error -ss <start> -i <src> -t <dur≤30> -map 0:v:0 -map 0:a:0? -vf scale=w='trunc(min(1280,iw)/2)*2':h=-2 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart -y <tmp.mp4>`，`env: engineEnv()`，60s 超时
- **海报帧**（L59701）：`ffmpeg -hide_banner -loglevel error -ss 1.0 -i <video> -frames:v 1 -vf scale=w='trunc(min(1080,iw)/2)*2':h=-2 -q:v …`（其余参数见源文件）

## 4. 环境变量全表

### 4.1 app 自身**读取**的 env（`process.env.X` 或以 `process.env` 作参数读取；verified）

| 变量 | 位置 | 作用 | 仅开发版？ |
|---|---|---|---|
| `VIDEOCLAW_ENGINE_DIST` | L9301, L9546 | 工具根目录前插 + 离线引擎 tarball 目录 | **否**（打包版也读） |
| `VIDEOCLAW_CODEX_BIN` | L23439 | codex 可执行文件覆盖（`requireBundled` 时忽略） | 否（但打包版 codex 会话通常 requireBundled，inferred） |
| `CLAUDE_CONFIG_DIR` | L22721 | Claude 配置目录（默认 `~/.claude`，支持 `~`） | 否 |
| `PATH` | L9314 等 | 拼接引擎 PATH | 否 |
| `HOME`, `TMPDIR` | L56990 | 传给 osascript | 否 |
| `HTTP_PROXY, HTTPS_PROXY, NO_PROXY`（及小写）, `NODE_EXTRA_CA_CERTS`, `USER`, `LOGNAME` | L22727-22745 | 透传给 claude 辅助进程 | 否 |
| `VIDEOCLAW_USERDATA_DIR` | L60316 | 覆盖 userData 目录 | 是（或 staging Flight） |
| `VIDEOCLAW_DEBUG_PORT` | L60319 | `--remote-debugging-port` | 是 |
| `VIDEOCLAW_SHOTS_PORT` | L60322 | 本地截图服务端口（127.0.0.1） | 是 |
| `ELECTRON_RENDERER_URL` | L60539, L60582 | 渲染端 dev server URL（electron-vite） | 实际是 dev |
| `VIDEOCLAW_QUICKSTART_FIXTURE_DIR` | L61017 | Quickstart 夹具目录 | 是 |
| `VIDEOCLAW_DEV` | L9822 | `=== "1"` 时 devMode | 否（打包版也可开） |
| `VIDEOCLAW_MANAGED_DEV` | L9564 | `=== "1"` 改错误提示 | 是 |
| `VIDEOCLAW_HYPERFRAMES_ENGINE` | L60615 | 编辑器渲染用的引擎根 | 是 |
| `VIDEOCLAW_CHAR_SHEET_ENGINE` | L19095 | 角色设定图工具的引擎根（`~` 展开） | **否**（无 isPackaged 判断） |
| `VC_JOBBIND_PROBE_MS`(默认 500), `VC_JOBBIND_TTL_MS`(120000), `VC_MARKER_CHECK_DELAY_MS`(1500), `VC_INPUT_QUOTE_TIMEOUT_MS` | L34374-34579 | 时序调参 | 否 |
| `VIDEOCLAW_FLIGHT_ROOT`, `VIDEOCLAW_FLIGHT_INSTANCE_ID`, `VIDEOCLAW_USERDATA_DIR`, `VIDEOCLAW_WORKSPACE_DIR`, `VIDEOCLAW_FLIGHT_HIDDEN` | L6174-6236 | staging 渠道 "Flight" 测试档案（4 个必须同时出现） | 仅 channel=staging |
| `VIDEOCLAW_FLIGHT_RESTART_SECRET` / `VIDEOCLAW_DEV_RESTART_CONTROLLER` | L53845-53847 | 受控重启（退出码 86 / 75） | staging / managed dev |

> 本构建 `applicationChannel()` 恒为 `"prod"`（L9172，`const raw = "prod"`），因此 staging Flight 分支在 0.0.40 正式包中不可达（verified）。

### 4.2 构建期常量（编译时替换，**不是**运行时 env）
- `__VC_MANAGED_DEVELOPMENT__`、`__VC_STAGING_GATEWAY_URL__`、`__VC_FIREBASE_PROD__`、`__VC_FIREBASE_STAGING__`（preload L225-245 残留的 `typeof` 检查；main 中已内联为 `MANAGED_DEVELOPMENT=false`、`STAGING_GATEWAY_URL=""`）。
- 错误文案中提到的 "Set `VIDEOCLAW_GATEWAY_URL` … before packaging"（shared chunk L48/L69）指**打包时**的 staging 网关注入，运行时 app 不从 env 读取网关 URL（verified：`process.env.VIDEOCLAW_GATEWAY_URL` 无读取点）。
- `VIDEOCLAW_STUDIO_PROD_PUBLIC_KEYS` / `..._STAGING_...` 只是 `parseTrustedStudioKeys` 的错误标签，值已内联（L7466：`{"prod-studio-2026-08":"wL3UT50wJm83tLVVNgUXUW2O3FcDFoNBhXlIOluco00="}`）。

### 4.3 网关 / 配置面（verified）
- `PROD_GATEWAY_URL = "https://videoclaw-gw-650303209435.us-central1.run.app"`；`STAGING_GATEWAY_URL = ""`（shared chunk `workbookContents-ChzKjQX1.js` L20-21）。
- `envForGatewayUrl(url)` → `"prod" | "staging" | "local"(localhost/127.0.0.1) | "custom"`（L86）。
- `defaultGatewayUrlForChannel(channel)`：staging（或 dev 且 MANAGED_DEVELOPMENT）→ 校验 https 且 ≠ prod；其余 → PROD（L64）。
- 实际使用的网关 URL 来自 settings（`settings.gatewayUrl`，可在 UI `settings:switchGateway` 切换，需重启生效）；`CLOUD_RUN_GATEWAY = /^videoclaw-gw-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/`（L30563）用于识别官方网关。
- 网关 API 路径：`/v1/me`(KEY_METER)、`/v1/keys/<id>/topup-session`、`/v1/account`、`/v1/account/{consent,key,key/claim,key/access,acquisition}`、`/v1/engine/latest`（L9502）、`/v1/app/updates/<channel>/`（electron-updater generic feed，L2268）、`/v1/app/latest[?channel=nightly]`（L55940）、`/anthropic/v1/messages`（Anthropic 透传）、`/v1/harness/review`、`/v1/workflow-submissions[/eligibility]`、`/health`。
- 远程 runner（"World 3"，settings `world3` + `runnerUrl`）：`POST /v1/sessions`、`POST /v1/sessions/<id>/messages`、`GET(SSE) /v1/sessions/<id>/events`，`RUNNER_PROTOCOL_VERSION = 11`（L774-782）；runner URL 必须 https（loopback 可 http）。

### 4.4 app **写入**子进程的 env（verified）
| 变量 | 写入方 | 值 |
|---|---|---|
| `VIDEOCLAW_ENGINE` | `engineSessionEnv()` L9406 | 当前引擎目录（`<userData>/engines/engine-<ver>`，由 `<userData>/engine-current.json` 指向） |
| `VIDEOCLAW_WORKSPACE` | 同上 | `~/Videoclaw`（prod；`workspaceLeafForChannel`） |
| `VIDEOCLAW_JOBS_DIR` | 同上 | `<workspace>/jobs` |
| `VIDEOCLAW_CONTEXT_EPOCH` | 同上 | 每次 `randomUUID()` |
| `VIDEOCLAW_ENGINE_BUILD_SHA256`, `VIDEOCLAW_EFFECTIVE_{LAWS,PREFLIGHT,SETTINGS}_SHA256` | 同上 | 已验证的引擎/工作区哈希 |
| `VIDEOCLAW_FINAL_QA_AUTHORITY` | 同上 | `"videoclaw.app-final-qa/v1"` |
| `VIDEOCLAW_GATEWAY_URL`, `VIDEOCLAW_API_KEY` | `configuredGatewayEnv()` L9372 及多处 | 网关 URL（通常是**本地 loopback 代理** `http://127.0.0.1:<port>`，见 05）+ 会话级 scoped key；doctor 时 key 固定为 `"vcs_doctor_no_authority"` |
| `VIDEOCLAW_STUDIO_ROOT` 等 `VIDEOCLAW_STUDIO_*` | `studioBundleSessionEnv()` L8192 | 已激活 Studio 工作流包路径与哈希 |
| `VIDEOCLAW_TENANT` | L23302, L39499 | 租户 |
| `UV_PYTHON_PREFERENCE` | 多处 | `only-managed` |
| `PYTHON_DOTENV_DISABLED` | 多处 | `1` |
| `VIDEOCLAW_OPERATION_RECOVERY`, `VIDEOCLAW_COLLECTOR_DELIVERY`, `VIDEOCLAW_QUOTE_SNAPSHOT_ROOT`, `VIDEOCLAW_INPUT_BINDING`, `VIDEOCLAW_REQUIRE_INPUT_BINDING`, `VIDEOCLAW_BOUND_JOB` | 付费/恢复路径 | 见源文件 |
| `VIDEOCLAW_LAWS_VIA_APPEND`, `VIDEOCLAW_SERVER_ASSEMBLY` | Claude 会话 L23298 | `1`（服务器端已拼装上下文时） |
| `ANTHROPIC_BASE_URL`=`<gw>/anthropic`, `ANTHROPIC_AUTH_TOKEN`=gatewayKey, `ANTHROPIC_CUSTOM_HEADERS`=`X-VideoClaw-Client-Job: <job>`, `CLAUDE_CONFIG_DIR`=隔离 profile | Claude 会话（仅 `llmRoute==="gateway"`）L23304-23311 | |
| `CLAUDE_AGENT_SDK_CLIENT_APP`=`videoclaw-app/0.0.1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1`, `CLAUDE_CODE_DISABLE_CRON=1`, `CLAUDE_CODE_DISABLE_WORKFLOWS=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=0` | Claude 会话 | |
| 删除：`ANTHROPIC_CUSTOM_HEADERS, ANTHROPIC_BASE_URL, CLAUDE_CODE_EFFORT_LEVEL, CLAUDE_CODE_USE_{ANTHROPIC_AWS,BEDROCK,FOUNDRY,GATEWAY,MANTLE,VERTEX}` | Claude 会话 L23216-23227 | 防止用户 shell 改变付费方 |
| `CODEX_HOME`, `CODEX_SQLITE_HOME`, `VIDEOCLAW_OPENAI_API_KEY` / `VIDEOCLAW_OPENROUTER_API_KEY` | `codexChildEnv()` L23478 | |

`sanitizedAgentEnv()`（L16026）：从 `process.env` 去掉名字匹配 `/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i` 的变量、`VIDEOCLAW_BOUND_JOB`、`BASH_FUNC_*`、`DYLD_*`、`LD_*` 及上面的 denylist。`commandBrokerEnv()`（L16075）只放行 `HOME, LANG, LC_ALL, PATH, SSL_CERT_DIR, SSL_CERT_FILE, TMP, TMPDIR, TEMP, TZ` + 引擎白名单。

## 5. 二进制指纹
所有随包二进制 SHA256 见 `artifacts/manifests/`。codex 随包版本 0.160.1（aarch64-apple-darwin），与 `SUPPORTED_CODEX_VERSION` 一致。claude CLI 证据表记录的运行时版本为 `2.1.281`（`CLAUDE_MODEL_EVIDENCE`，preload L490 起）。

## 6. Windows 移植要点（inferred）
- 需要替换的 POSIX 假设：`enginePath_` 用 `":"` 拼 PATH（应改 `path.delimiter`）；`.venv/bin/python`（Windows 为 `.venv\Scripts\python.exe`）；`bin/ffmpeg` 无 `.exe`；`/bin/sh`、`/bin/bash`、`/usr/bin/osascript`、`ps`、`lsof`、`xcode-select` shim、`nativePythonArgs` 的 Mach-O 检测；`kill(-pid)` 进程组。
- 建议在移植版中**新增**显式 env（例如 `VIDEOCLAW_FFMPEG`）只作为对 `bootstrap` 目录约定的补充，并在文档中注明这是移植版新增、原版不存在。
