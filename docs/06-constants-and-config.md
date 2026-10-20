# 06 · 常量与配置清单（行为一致性关键项）

> 全部值均为 bundle 原文（verified）。`S` = `app/reconstructed/main/chunks/workbookContents-ChzKjQX1.js`（共享块），`M` = `app/reconstructed/main/index.js`，`P` = `app/reconstructed/preload/index.mjs`。完整的 1014 条顶层常量见 `06a-constants-full.md`（自动生成）。

## 1. 渠道、网关、身份

| 常量 | 值 | 位置 |
|---|---|---|
| `applicationChannel()` | 恒返回 `"prod"`（`const raw = "prod"`） | M L9171 |
| `MANAGED_DEVELOPMENT` | `false` | S L19 |
| `PROD_GATEWAY_URL` | `"https://videoclaw-gw-650303209435.us-central1.run.app"` | S L20 |
| `STAGING_GATEWAY_URL` | `""` | S L21 |
| `workspaceLeafForChannel` | `prod→"Videoclaw"`, `staging→"Videoclaw-Staging"`, `dev→"Videoclaw-Dev"`；工作区 = `~/<leaf>` | S L24 |
| `channelAppIdentity` | staging → `"Videoclaw Staging"`；dev → `"Videoclaw Dev"`（同时作为 userData 目录名）；prod → null | S L96 |
| App 名 / AppUserModelId | `app.setName("Videoclaw")`、`app.setAppUserModelId("com.videoclaw.app")` | M L60295-60296 |
| `CLOUD_RUN_GATEWAY` | `/^videoclaw-gw-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/` | M L30563 |
| `ANTHROPIC_PASSTHROUGH_PATH` | `"/anthropic/v1/messages"`；`ANTHROPIC_CLIENT_JOB_HEADER = "X-VideoClaw-Client-Job"`；`CLIENT_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` | S L140-147 |
| 账户 API | `ACCOUNT_PATH="/v1/account"`, `…/consent`, `…/key`, `…/key/claim`, `…/key/access`, `…/acquisition`；`KEY_METER_PATH="/v1/me"`；`topupSessionPath=(id)=>"/v1/keys/${id}/topup-session"` | S L108-161 |
| `ACCOUNT_CAPABILITIES` | `["onboarding_preview","nightly_updates"]` | S L162 |
| `ALPHA_TERMS_VERSION` | `"alpha-2026-08-17"` | S L152 |
| `VERIFY_BACKOFF_MS` | `[2e3, 5e3, 15e3, 6e4]` | S L215 |
| `EMAIL_LINK_WAIT_HINT_MS` / `EMAIL_LINK_RESEND_INTERVAL_MS` | `45e3` / `3e4` | S L356-357 |
| 受信 Studio 公钥 | `{"prod-studio-2026-08":"wL3UT50wJm83tLVVNgUXUW2O3FcDFoNBhXlIOluco00="}`（Ed25519 raw），staging 空 | M L7466 |
| Runner | `RUNNER_PROTOCOL_VERSION = 11`；路由 `/v1/sessions`, `/v1/sessions/<id>/messages`, `/v1/sessions/<id>/events`；必需能力 `spend-budget-production-auth-v4-shell-ir`、`session-context-receipt-v1` | M L774-792 |

## 2. 更新通道（electron-updater）

- 通道只有 `"latest"` 与 `"nightly"`（`createUpdatePreferences.set` 中硬校验，M L2196）。
- `selectedUpdateChannel`：仅当偏好为 nightly、偏好记录的 `gatewayUrl` 与当前一致、`userId` 一致、且 `canUseNightlyUpdates(account)`（已登录、active、capabilities 含 `nightly_updates`，S L167）时为 `nightly`，否则 `latest`（M L2174）。
- `releaseChannel(version)`：semver prerelease 首段为 `nightly` → nightly，否则 latest（M L2220）。
- 驱动配置（M L2259-2269）：`autoDownload=false`、`autoInstallOnAppQuit=false`、`allowPrerelease=true`、`allowDowngrade=false`、`disableDifferentialDownload=true`、`setFeedURL({provider:"generic", url: "${gatewayUrl}/v1/app/updates/${channel}/"})`。
- 版本检查 `GET ${gatewayUrl}/v1/app/latest[?channel=nightly]`（M L55940）；`RECHECK_MS = 4h`、`UPDATE_RETRY_MS = 60s`、`REQUEST_TIMEOUT_MS = 15s`（M L55918-55920）。

## 3. 文案/语气守卫

- `BANNED_USER_FACING_VOCABULARY = ["workflow","molecule","taste pack","tenant","job","pipeline","reading set"]`（S L4129）。
- `VOICE_GUARD`（S L4138 起，模板字符串，嵌入上面的词表 `join(" · ")`）：追加到 agent 系统提示的"Videoclaw app voice"段落。要点（原文意译）：不得提及其他客户/租户/品牌；不得泄露 key/token/.env/凭据路径/供应商与模型路由；进度叙述以视频为中心；付费或长任务开始前先写一句可见说明（不含时间/价格）；用 `call_model` 自选模型时用 `search_models` 标题（含版本）称呼该模型，且不得说出托管服务/模型 id/自身模型；不得提及 workflow/recipe/laws/specs/chunks/skills/reading set 等内部概念；不得使用 mux/demux/transcode/codec/EDL/stems/chroma/alpha/"w1""b4" 等术语；产出可看资产时给出 markdown 链接路径。**移植时必须逐字复制**（见源文件，含换行）。
- 其它 agent 提示常量：`ENGINE_TOOL_LAUNCHER`（M L840）、`ENGINE_PIPE_RULE`（M L842）、`EXECUTION_CONTRACT_MARKER = "<!-- videoclaw-execution-contract:3 -->"`（M L9573）、`CODEX_VIDEO_INSTRUCTIONS`（M L24690）、`CODEX_TOOL_MAPPING`（M L24740）、`HOUSE_FOOTER_*`（M L31975 附近）、`PROJECT_MEMORY_GUIDANCE`（M L845）、`WORKFLOW_INDEX_TOKEN_BUDGET = 2e3`（M L31930 附近）。
- `ENGINE_LINES` / `SYNTH_VOICE_MODE_LINES`（P L246-302，S 中同名）：引擎工具名 → 用户可见进度文案。

## 4. 素材入口 / 文件上限

| 常量 | 值 | 位置 |
|---|---|---|
| `INTAKE_FOLDER_MAX_DEPTH` | `8` | S L791 |
| `INTAKE_FOLDER_MAX_FILES` | `1e3` | S L792 |
| `INTAKE_FOLDER_MAX_BYTES` | `64 * 1024 * 1024 * 1024`（64 GiB） | S L793 |
| `INTAKE_FOLDER_MAX_VISITS` | `2e4` | S L794 |
| `ARCHIVE_EXTS` / `WORKBOOK_EXTS` | `[".zip"]` / `[".xlsx",".xls",".ods"]` | S L760-761 |
| `ARCHIVE_MAX_FILES/DEPTH/ENTRIES` | = `INTAKE_FOLDER_MAX_FILES/DEPTH/VISITS` | S L812-814 |
| `ARCHIVE_MAX_FILE_BYTES` / `ARCHIVE_MAX_TOTAL_BYTES` | `4 * 1024 ** 3` / `16 * 1024 ** 3` | S L815-816 |
| `ARCHIVE_MAX_RATIO` / `ARCHIVE_RATIO_FLOOR_BYTES` | `100` / `1024 * 1024` | S L817-818 |
| `ARCHIVE_MAX_WORKBOOKS` / `ARCHIVE_MAX_PDFS` | `20` / `20` | S L819-820 |
| `MAX_ENTRY_NAME_BYTES` / `MAX_SEGMENT_BYTES` | `1024` / `255` | S L4429-4430 |
| `WORKBOOK_MAX_BYTES` | `25 * 1024 * 1024` | S L856 |
| `WORKBOOK_MAX_SHEETS` / `WORKBOOK_MAX_CELLS` / `WORKBOOK_MAX_CELL_CHARS` | `64` / `1e5` / `32767` | S L857-859 |
| `WORKBOOK_MAX_OUTPUT_BYTES` | `16 * 1024 * 1024` | S L860 |
| `WORKBOOK_CONTAINER_MAX_ENTRIES/BYTES/RATIO` | `1e4` / `64 * 1024 * 1024` / `1e3` | S L861-863 |
| `WORKBOOK_PAGE_MAX_CELLS` / `_MAX_CHARS` / `_CELL_CHARS` | `500` / `6e4` / `4e3` | S L864, L4755-4756 |
| `WORKBOOK_SCHEMA` | `"videoclaw.workbook/v1"` | S L4754 |
| `WORKBOOK_READ_TIMEOUT_MS` | `2e4` | S L4947 |
| `MAX_FORMULA_CHARS` / `MAX_SHEET_NAME_CHARS` | `8192` / `100` | workbookWorker L29-30 |
| `PDF_MAX_BYTES` / `PDF_MAX_PAGES` / `PDF_MAX_TEXT_CHARS` | `64 * 1024 * 1024` / `500` / `1e6` | S L865-867 |
| `PDF_READ_TIMEOUT_MS` | `3e4`；stdout 上限 `PDF_MAX_TEXT_CHARS * 6 + 64 * 1024` | M L56908-56910 |
| `CLIPBOARD_IMAGE_MAX_BYTES` / `_MAX_PIXELS` | `64 * 1024 * 1024` / `32 * 1024 * 1024` | S L885-886 |
| `VOICE_NOTE_MAX_BYTES` / `VOICE_NOTE_MAX_SECONDS` / `VOICE_NOTE_RATE` | `2 * 1024 * 1024` / `120` / `48e3` | M L282-283, L10512 |
| `MAX_PROJECT_TEXT_BYTES` | 1 MB（错误文案 "exceeds the 1 MB authoring limit"） | M L2745 附近 |
| HyperFrames 策略 | `MAX_POLICY_FILE_BYTES=8MiB`, `MAX_POLICY_FILES=128`, `MAX_POLICY_TOTAL_BYTES=16MiB`, `MAX_RUNTIME_FILES=256`, `MAX_RUNTIME_TOTAL_BYTES=32MiB`, `REQUIRED_RUNTIME_FILES=["gsap.min.js","fonts/fonts.css"]` | hyperframesPolicyWorker L11-16 |

## 5. Agent 运行时 / 模型

| 常量 | 值 | 位置 |
|---|---|---|
| `SUPPORTED_CODEX_VERSION` | `"0.160.1"` | M L23381 |
| `MAX_ACTIVE_CODEX_APP_SERVERS` | `4` | M L23382 |
| `DEFAULT_CODEX_PROVIDER` | `"chatgpt"` | M L327 |
| `CODEX_CONTAINMENT` | `{ approvalPolicy: "on-request", sandbox: "read-only" }` | S L1054 |
| `CODEX_HOST_APPROVAL` | `{ default:"ask", acceptEdits:"edits", auto:"all", bypassPermissions:"all" }` | S L1058 |
| `CODEX_PROVIDER_LABELS` | `{ chatgpt:"ChatGPT", "openai-api":"OpenAI API", openrouter:"OpenRouter" }` | S L1078 |
| `AGENT_ROUTE_EVIDENCE` | 两条 qualified codex 路由：`codex-app-server:chatgpt:gpt-5.6-terra`（推荐 effort `medium`）、`codex-app-server:chatgpt:gpt-6-astra`（推荐 effort `low`），runtime 0.160.1，验证日 2026-10-06 | P L373-440 / S |
| `CLAUDE_MODEL_EVIDENCE` | claude-code 路由，runtime 2.1.281，验证日 2026-09-24：`claude-opus-5`(→superseded by `claude-opus-5-5`)、`claude-opus-5-5`、`claude-sonnet-5`、`claude-fable-5`(→`claude-fable-5-1`)、`claude-haiku-4-5-20251001`、`claude-opus-4-8`(→`claude-opus-5-5`)、`claude-fable-5-1` | P L490-613 / S L1243 |
| 标题生成模型 | `model: "haiku"`, `maxTurns: 1`, 15s | M L23017-23035 |
| Claude 会话 settings | `{ autoCompactEnabled: true, autoCompactWindow: 2e5 }`；`settingSources: ["project"]`；`CLAUDE_AGENT_SDK_CLIENT_APP = "videoclaw-app/0.0.1"` | M L23250-23290 |
| Bash 工具（device/codex） | `DEFAULT_BASH_TIMEOUT_MS=12e4`, `MAX_BASH_TIMEOUT_MS=6e5`, `MAX_OUTPUT_CHARS=3e4`, `OUTPUT_TAIL_CHARS=8e3`, `DEFAULT_READ_LIMIT=2e3`, `MAX_LINE_CHARS=2e3` | M L25251-25256 |
| 目录 TTL | `CODEX_CATALOG_TTL_MS = CLAUDE_CATALOG_TTL_MS = 5min`；`CLAUDE_CATALOG_TIMEOUT_MS=15e3` | M L34384-34386 |
| 引擎子进程 | `ENGINE_CHILD_KILL_GRACE_MS=1500`, `IDLE_ENGINE_CHILD_TTL_MS=6e4`, `IDLE_ENGINE_CHILD_SWEEP_MS=15e3` | M L31583, L34781-34782 |
| `PAID_GENERATION_TIMEOUT_MS` | `6e5` | M L52904 |
| `QUEUED_INPUT_GRACE_MS` | `5e3` | M L23059 |

## 6. 付费 / 计价

- `SPEND_APPROVAL_PENDING_CODE = "SPEND_APPROVAL_PENDING"`、`SPEND_AUTHORITY_REQUIRED_CODE = "SPEND_AUTHORITY_REQUIRED"`（S L16-17）。
- `normalizeSpendCeiling(usd)`：≤0/非有限 → null；向上取整到分；上限 `1e8` 分（S L8-15）。
- `PAID_GEN_TOOLS`（S L1975 起）/ `FREE_GEN_TOOLS`（P L615）/ `FREE_MODES`（S L2063）/ `HOUSE_PAID_TOOLS = {review_render, review_output, run_final_qa}`（M L15753，平台买单，不弹付费卡）。
- `URL_PULL_MAXIMUM_CENTS = 162`；`URL_PULL_TOOLS = {pull_video, acquire_footage}`（M L15758-15759）。
- `BILLED_MEDIA_BY_KEY = { lipsync_footage:"--audio", "mint_video:edit":"--video", "mint_video:reenact":"--driver-video", "mint_video:genjutsu":"--video" }`（P L814）。
- `GATEWAY_PREPAID_CREDIT_REFUSAL = "not enough prepaid credit; top up to continue"`（S L4247）。
- `keyMeterFrom()`：`topupMinUsd` 默认 5，`topupMaxUsd` 默认 500（S L131-132）。
- 命令守卫词表：`CURL_HEADS=["curl","curlie"]`、`NESTED_CURL_LAUNCHERS=[exec,find,parallel,setsid,stdbuf,timeout,watch,xargs]`、`PROVIDER_READ_ONLY_HEADS`（37 个只读命令，含 `ffprobe`）、`CURL_BODY_FLAGS`、`CURL_METHOD_FLAGS`、`CURL_READ_METHODS=["GET","HEAD","OPTIONS"]`（P L666-813 / S）。`EXEC_HOOK_ENV_RE`（S L2180）拒绝 `LESSOPEN|LESSCLOSE|BASH_ENV|ENV|PYTHONSTARTUP|PYTHONINSPECT|NODE_OPTIONS|PERL5OPT|RUBYOPT|LD_PRELOAD|DYLD_INSERT_LIBRARIES=` 前缀。

## 7. 进程环境策略（详见 02 §4.4）
`UV_PYTHON_POLICY_ENV = { UV_PYTHON_PREFERENCE: "only-managed" }`（M L7145）；`AGENT_STARTUP_ENV_DENYLIST`（M L16003）；`COMMAND_BROKER_AMBIENT_ALLOWLIST` / `COMMAND_BROKER_ENGINE_ALLOWLIST` / `GUARDED_SPEND_AUTHORITY_ALLOWLIST`（M L16044-16074）；`NETWORK_PASSTHROUGH`（M L22727）；`CLAUDEAI_CONNECTORS_OFF = { ENABLE_CLAUDEAI_MCP_SERVERS: "0" }`；`CLAUDE_CODE_NO_SELF_STARTING_WORK = { CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CODE_DISABLE_WORKFLOWS: "1" }`（M L22736-22740）；`EXTRA_PATHS = [~/.local/bin, /opt/homebrew/bin, /usr/local/bin, ~/.cargo/bin]`（M L9322）；`ENGINE_COMMAND_SHIMS = ["python3","python","pip3","pip","git"]`（M L7199）。

## 8. 重启 / 退出码
`STAGING_FLIGHT_RESTART_EXIT_CODE = 86`、`MANAGED_DEV_RESTART_EXIT_CODE = 75`、`RESTART_SCHEMA = "videoclaw.flight-restart-request/v1"`（M L53844-53849）。

## 9. 存储布局（verified 路径）
- `<userData>/settings.json`（Settings）、`<userData>/credentials.dat`（CredentialStore）、`<userData>/sessions.json`（AgentHost 注册表）、`<userData>/engine-current.json`（当前引擎指针）、`<userData>/engines/engine-<ver>[-studio-<sha12>]/`、`<userData>/bin/`（命令 shim）、`<userData>/codex-profile/`（CODEX_HOME）、`<userData>/engine-profile/`（隔离 Claude 配置目录，gateway 路由用，inferred）。
- 工作区 `~/Videoclaw/`：`.claude/settings.json`（须与引擎内已验证副本哈希一致）、`jobs/<id>/`（`final_hyperframes.mp4`、`run.log.jsonl` …）。
- prod 下 `userData` = Electron 默认 `~/Library/Application Support/Videoclaw`（inferred：`app.setName("Videoclaw")` 且 prod 不改 userData）。
