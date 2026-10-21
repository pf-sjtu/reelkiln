# 20 · 功能重建路线图（Phase A：盘点 + 差距分析 + 计划）

> 2026-10-21（UTC+8），box（Debian trixie x64）。基线 HEAD `2fabdd2`。北极星：**在 box 上把原版 macOS Videoclaw 0.0.40 的主要用户流程真实跑通并校验产物，最终做到 100% 功能重建**。本轮只做盘点与计划，外加两个**只读/探针级**的可行性实验（§0.2），没有改 `port/src`。
>
> 标注约定：**[已验证]** = 本轮或此前在 box 上真实运行过、有证据文件；**[读码]** = 直接读到原版代码（`app/reconstructed/main/index.js` 行号 L…）；**[推断]** = 由命名/上下文推断，未运行；**[未知]** = 目前无法判断。

## 0. 一页结论

1. **Videoclaw 是什么** [读码+已验证]：一个 Electron 桌面“AI 短视频工作室”。用户在“项目（client）”下新建“视频（session）”，用自然语言描述想要的视频、可附上素材；主进程起一个 **Claude Code（claude-agent-sdk `query()`）或 Codex app-server** agent，agent 按引擎写好的规则（CLAUDE.md、workflows、taste、hooks）在 Bash 里调用 **Python 引擎 CLI**（`uv run … tools/<tool>.py --job <id>`）完成剪辑/生成/合成，产物落在 `~/Videoclaw/jobs/<jobId>/`；主进程监视 job 目录，把 `final.mp4` 存成版本 `versions/vN.mp4`，用户在 UI 里预览、批准（finalize）、导出。付费生成（图像/视频/配音/对口型等）全部经 Videoclaw 云网关计费。
2. **覆盖现状** [已验证，`tools/ipc_coverage.py`]：184 个原版 IPC 通道全部已在 port 注册（契约 100%），但**真实实现只有 10 个**（+1 个需 env 开关），11 个是 QA fixture 假数据，**138 个是返回 `undefined` 的桩**；23 个推送只发出 4 个。即：**通道层面真实覆盖 ≈ 8%（15/184，含 4 个推送）**。
3. **引擎** [已验证]：原版引擎 tarball 不改一字节即可在 Linux 上安装、doctor（除 gateway）全绿；本轮新增验证 **$0 主链 `assemble → compose_render(Remotion) → verify_output` 产出合格 9:16 mp4**（§3.5，`L0 ACCEPT PASS`）。凡是走网关的生成/审阅工具需要账号 key，box 上做不了真实运行。
4. **关键新发现** [已验证]：**原版 React 渲染器（`app/out/renderer`，未改一字节）可以直接挂在 port 主进程上启动**，主页完整渲染（截图 `artifacts/phase-a-probe/original-renderer-on-port.png`），首页启动只触发 6 个未实现通道。→ 路线图改为“**用原版 UI + 逐个把通道做真**”，不再自写 UI。
5. **主流程验收场景 S1**（§3）：3 段合成素材 + 1 段音乐 → 从 UI 新建视频、附件、发 brief → agent 用 $0 引擎链出片 → 版本入库、批准 → `tools/accept_check.py` 15 项 ffprobe/文件断言 + 3 项应用层断言全部通过。L0（纯引擎）今天已过；L1–L3（经 IPC / 经原版 UI / 打包版）是 Phase B 的目标。
6. **100% 的边界**（§5）：Linux box 上能真做完的是所有本地 $0 功能与原版在非 macOS 上的等价行为；**需要凭据**的（网关/账户/付费工具/ChatGPT 登录）只能在用户提供 key 后真实验证，否则只能做契约级 mock 测试；**必须 macOS** 的（Swift 语音听写 SpeechAnalyzer、PDFKit、签名公证、DMG/Squirrel 更新、麦克风 TCC 权限）只能在 Mac/CI macOS runner 上验证。

### 0.1 本轮新增文件
| 文件 | 作用 |
|---|---|
| `docs/20-reconstruction-roadmap.md` | 本文 |
| `tools/ipc_coverage.py` | 机器分类 184 通道在 port 中的实现状态（real / real-env / fixture / stub / push-real / push-none / local），`--json` 输出明细 |
| `tools/accept_fixtures.sh` | S1 的确定性合成输入（ffmpeg lavfi，带 seed；两次生成 SHA256SUMS 相同 [已验证]） |
| `tools/accept_check.py` | S1 的机器验收（E1–E15 引擎产物断言 + A1–A3 应用层断言；未实现的应用层项报 `pending`，绝不报 pass） |
| `tools/accept_engine_chain.sh` | S1 的 L0：不经应用/agent，直接跑 $0 引擎链并调用 `accept_check.py` |
| `artifacts/phase-a-probe/` | 证据：`accept-L0.json`、`final.ffprobe.json`、`final.sha256`、`render-manifest.json`、`run.log.jsonl`、`chunk_boundaries.json`、`edl.json`、`compose_render.log`、`inputs.SHA256SUMS`、`ipc-coverage.json`、`original-renderer-on-port.png`、`original-renderer-boot.log` |

### 0.2 本轮做的两个探针（无代码改动）
- **P-1 原版渲染器挂 port 主进程**：`ELECTRON_RENDERER_URL=file://…/app/out/renderer/index.html VIDEOCLAW_PORT_FAKE_SETTINGS=1 xvfb-run electron --no-sandbox --remote-debugging-port=… .`（`port/` 目录），用 CDP 取 `document.body.innerText` 与截图。结果：侧栏（New video / Quickstarts / Characters / Projects: Personal, Humeo / Your account · Local studio）、“What are we making today?”、10 个 quickstart 磁贴、新手引导 Step 1 of 3、输入框 “Make me a reel about…” 全部渲染。主进程日志中未实现调用：`account:snapshot`×2、`app:update:get`、`engine:llmRouteReadiness`（因 FAKE_SETTINGS）、`interaction:replayPending`、`quickstart:catalog`、`workflowSubmit:eligibility`。**更深的流程（发消息、看视频）未试** [未知]。
- **P-2 $0 引擎链**：见 §3.5。

---

## 1. 产品与主流程（读码 + 已验证片段）

### 1.1 用户可见的功能面（来自原版 UI 与 IPC 前缀）
- **New video**（核心）：对话式做视频；Quickstarts（“Clone a meme / Newsletter to video / Article to video / Podcast to video / Video ad / Talking head / Lip sync / Voice cloning / AI avatar / Long to short / More(16)”，由网关下发的签名目录 `quickstart:*`）。
- **Projects**（`client:*`）：项目=客户/品牌，可绑定 tenant（taste pack）；项目下是视频列表（`session:list/reorder/rename/delete`）。
- **Characters**（`characters:*`）：用真人照片做角色设定图（`build_character_sheet.py`）、角色声音（`characters:voice*`）。
- **Library**（`library:*`）：本地素材库扫描/索引/搜索（`index_media.py`）。
- **编辑器**（`hfPreview:*` / `editorRender:*`）：HyperFrames 合成的预览服务 + 文本/样式编辑 + 重新渲染（`hyperframes_render.py`）。
- **账户/计费**（`account:*`/`gateway:*`/`spend:*`）：Google / 邮件链接登录、额度、充值、单视频花费上限、付费确认卡片。
- **Agent 提供方**（`engine:*`）：Claude Code（用户自己的 claude.ai 登录或网关路由）、Codex（ChatGPT 登录或 provider key），模型/推理强度切换，额度不足时“转到 Codex/Credits”。
- **语音**：输入框语音听写（`media:transcribeVoice`，Swift on-device Speech，macOS 26+）与语音备注附件（`attachment:voiceNote`）。
- 其余：项目记忆（`memory:*`）、品味（`taste:*`）、反馈/诊断包（`feedback:*`）、工作流投稿（`workflowSubmit:*`）、自动更新（`app:update*`）、引擎安装（`bootstrap:*`）。

### 1.2 主流程 F1：「新建视频 → 附素材 → agent 剪辑 → 出片 → 批准 → 导出」

| # | 用户动作 | 渲染端调用（`window.videoclaw.*`） | 主进程（原版，行号） | 引擎 / 外部进程 | 产物 |
|---|---|---|---|---|---|
| 0 | 首次启动 / Setup | `bootstrapStatus`、`bootstrapRun`，订阅 `onBootstrapProgress` | `Bootstrap.runAll()` L9863：layout→engine→venv→remotion→hyperframes→workspace→env→doctor | `tar`、`uv sync --frozen`、`npm ci`、`npx remotion browser ensure`、`doctor.py --json` | `<userData>/engines/engine-<ver>/`、`engine-current.json`、`~/Videoclaw/{jobs,incoming,assets,taste,…}`、工作区 `CLAUDE.md`、`.claude/settings.json` |
| 1 | 点 New video、输入 brief | `createSession({clientId, continueFromSessionId})` | `session:create` L61690 → `bootstrap.prepareNewSession` + `AgentHost.createSession` L38726：meta（cwd=工作区、`permissionMode:"auto"`、`agentHarness`、`llmRoute`、`sessionPlanRequired`）、写 `sessions.json` | — | `<userData>/sessions.json` |
| 2 | 拖入/选择素材 | `intakePickFiles(scope)` / `attachmentStage({…})`，订阅 `onAttachmentChanged` | `ComposerAttachmentStore` L16681、`secureComposerDestination` L44705：落到 `~/Videoclaw/incoming/`（已绑定 job 时 `jobs/<id>/incoming/`）；视频预览抽帧 | ffmpeg/ffprobe | `incoming/<file>` |
| 3 | 发送 | `sendMessage(sessionId, {text, attachmentIds, clientTurnId})`，订阅 `onSessionEvent` / `onSessionsChanged` | `session:send` L61772（`assertGenerationAllowed`）→ `sendMessage` L41400 → `spawnLocal` L39454 → SDK `query()` L23237：`settingSources:["project"]`（引擎 hooks）、`systemPrompt` preset+append（项目简报 `project_brief.py` L53798、workflow 索引、执行契约 L9572）、`mcpServers:{studio}` L48511、`canUseTool`→权限卡、`env`=`engineSessionEnv` L9380 | `claude` CLI 子进程（或 `codex app-server --listen stdio://` L24259） | SDK 会话、`session:event` 流 |
| 4 | （可选）方案卡 | 订阅 `onSessionPlanChanged`，`readSessionPlan`、`chooseSessionPlan(scope,{…Build})` | studio 工具 `propose_session_plan` → `callSessionPlan`；`SESSION_PLAN_GUIDANCE` L1963：多镜头新视频默认先出方案，等用户 Build（Bypass 模式除外） | — | 会话方案状态 |
| 5 | agent 干活 | 订阅 `onPermissionRequest` → `respondPermission`（付费/提问卡）；`onInputRequest` → `respondInput` | agent Bash → PreToolUse hook `production_guard.py`（无路由回执时自动记录，L6842）；付费命令先 `cost.py plan` L34616 报价 → 权限卡 → 网关代理 `AgentGatewayProxy` L28672 | `uv run … tools/prepare_production.py`、`assemble.py`、`compose_render.py`、`pull_video/mint_*/synth_voice…`（付费）、`review_render.py` | `jobs/<id>/{edl.json, footage/, final_raw.mp4, final.mp4, render-manifest.json, run.log.jsonl, route-receipt.json, …}` |
| 6 | job 绑定 | `onSessionsChanged`（meta.jobId） | 从 Bash 命令嗅探 `--job <id>`，目录存在即 `commitBind(s,id,"sniff")` L47614；`ensureWatcher` | — | `sessions.json` 中 `jobId` |
| 7 | 看到成片 | 订阅 `onJobSnapshot`，`getJobSnapshot(id)`；`<video src="vcmedia://…">` | `JobWatcher` L14717（`fs.watch` 递归，600 ms 去抖）→ `scanJob` L14365（renders/assets/spend/cut，`final.mp4` 稳定 500 ms 后为 candidate）→ `VersionStore` L13344 铸版本 | — | `jobs/<id>/versions/v<n>.mp4`、`<userData>/versions.json` |
| 8 | 批准 / 回退 | `approveVersion(sessionId, n)` / `revertFinal` | `approveVersion` L47488：`versionStore.approve`、`finalizedAtMs` | — | 版本记录 final |
| 9 | 导出 / 定位 | `saveItemAs(path)` / `revealItem` / `openPath` | `file:*` L61917-61985（系统对话框 / shell） | — | 用户选的路径 |
| 10 | 再改 | 继续 `sendMessage`；或编辑器 `hfPreviewStart`/`hfEditApply`/`editorRenderStart` | `HyperframesPreviewController` L56530、`EditorRenderController` L56048 → utility worker | `hyperframes_render.py --job` → 无头 Chrome | `final_hyperframes.mp4` |

**原版 agent 侧的执行约定 [读码]**：每个引擎工具都用 `uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/<tool>.py" --job <bare-id>`（`ENGINE_TOOL_LAUNCHER` L840），cwd 为工作区，`--job` 必填；`prepare_production` 先于规划/付费工作（L41624）；成片默认“即是草稿”，建议出片后跑一次 `review_render`（引擎 README）。

### 1.3 其它流程（简述）
- **F2 Quickstart**：`quickstartCatalog`（网关签名目录）→ 选磁贴 → `quickstartStart` → 带 workflow 卡的首回合（L33562）。依赖网关。
- **F3 角色**：`createCharacter` → 照片 → `characterSheetPlan/Build`（`build_character_sheet.py --from-photos`，L19380）→ approve；角色声音（ElevenLabs，经网关）。
- **F4 素材库**：`libraryAddSource/Scan/Sync/Search/Preview`（`index_media.py`，L16122）。
- **F5 编辑器重渲染**：已在 port 中验证（docs/12）。
- **F6 语音听写**：`media:requestMic`（macOS TCC）→ 录音 → `transcribeVoice`（Swift `voice-dictation <file>`，JSON 回显）。
- **F7 账户**：Google / 邮件链接登录 → `account:snapshot` → 网关 key（`mintKey/claimKey`）→ 计费、`spend:*`。
- **F8 Codex**：`codexConnectChatGpt`（app-server `account/login/start`）→ `codex-app-server` harness 会话。

---

## 2. 覆盖盘点

### 2.1 IPC：184 通道 × 功能区（`python3 tools/ipc_coverage.py`，2026-10-21 [已验证]）

> Phase B（docs/21）后：real 18 + real-env 1 + fixture 8 + stub 133 + push 5/23。下表为 Phase A 基线。

分类说明：**real** = 真实移植或 PORT-NEW 真实实现；**real-env** = 仅在 `VIDEOCLAW_PORT_REAL_BOOTSTRAP=1` 时真实；**fixture** = 返回原版 QA fixture 的固定值；**stub** = 已注册，返回 `undefined`/只打日志；**push-real/none** = 推送有/没有发出；**local** = preload 本地方法。**“not-present”为 0**：契约生成器保证 184 个都已注册、preload 成员逐一对齐（`preload-completeness`/`preload-fidelity` 测试）。

| 功能区 | 前缀（通道数） | 总 | real | real-env | fixture | stub | push 发出/总 | 已做真的通道 |
|---|---|---|---|---|---|---|---|---|
| A 会话/agent 核心 | session(17) permission(3) input(2) interaction(1) sessionPlan(4) memory(5) quit(1) | 33 | 4 | – | – | 23 | 2/6 | `session:create/send/interrupt/list`（**PORT-NEW 最小 AgentHost**：只读工具、无 job/hook/MCP、不持久化）+ `session:event/changed` |
| B 项目/素材资产 | client(5) project(1) taste(4) characters(14) library(9) | 33 | – | – | 2 | 28 | 0/3 | `client:list/create` 为 fixture |
| C 作业/版本/花费 | job(5) version(2) spend(3) materials(2) stats(1) | 13 | – | – | 1 | 9 | 0/3 | `job:get` fixture（恒 null） |
| D 输入/附件/语音 | intake(1) attachment(12) media(4) | 17 | – | – | 1 | 15 | 0/1 | `media:voiceDictationStatus`（真实平台逻辑，非 mac 恒“不可用”，与原版非 darwin 分支一致） |
| E 编辑器/渲染 | editorRender(4) hfPreview(5) | 9 | 3 | – | 1 | 3 | 1/2 | `editorRender:start/cancel/state` + `event`（端到端已验证，docs/12） |
| F 引擎安装 | bootstrap(5) | 5 | – | 1 | 1 | 2 | 1/1 | `bootstrap:run`（env 开关下真实，docs/12）+ `progress`；`status` 为 fixture |
| G Agent 提供方 | engine(21) | 21 | 1 | – | 2 | 17 | 0/1 | `engine:llmRouteReadiness`（含 PORT-NEW 自定义 provider 路由） |
| H 账户/网关/设置 | account(15) gateway(3) settings(4) | 22 | 2 | – | – | 18 | 0/2 | `settings:get/set`（原版 Settings 移植 + PORT-NEW 路由） |
| I 应用壳/更新/文件 | app(10) file(5) window(1) | 16 | – | – | 2 | 10 | 0/3 | `app:restart`、`app:update:state` fixture；`pathForFile` = local |
| J 增长/反馈/遥测 | quickstart(6) workflowSubmit(2) feedback(4) analytics(1) telemetry(1) outbox(1) | 15 | – | – | 1 | 13 | 0/1 | `feedback:discard` fixture |
| **合计** | 36 个前缀 | **184** | **10** | **1** | **11** | **138** | **4/23** | + 1 local |

> 160 个 R→M 中：真实 11（含 env 开关的 1）/ fixture 11 / 桩 138（含 3 个单向 send：`permission:respond`、`permission:shown`、`quit:rendererState` 只打日志）。原版渲染器实际引用的 bridge 方法 176 个（183 个 IPC 绑定方法中的 175 个 + 本地 `pathForFile`）；8 个从未被渲染器调用（`tasteTitles`、`getOriginalContext`、`outboxAuthoritySnapshot`、`telemetryBindReplay`、`accountMintKey`、`accountClaimKey`、`bootstrapRevertEngine`、`attachmentDestination`）[已验证：渲染器 bundle grep]，优先级最低。

### 2.2 port 中已移植但尚未接到 IPC 的部件（docs/10–19）
| 部件 | 状态 | 用于 |
|---|---|---|
| `BootstrapCore`（runAll 全步骤、shims、money/production/session 契约） | 真实，box 上跑通 | F（已接 `bootstrap:run`） |
| `engineSessionEnv`、`SessionRegistry`（只读）、`resolveEditorRenderEngine` | 真实 | A/E：agent 会话 env 尚未使用它 |
| `runBash`、`shell-command`（逐字节差分） | 真实 | Codex 动态工具 / device bash（未接） |
| `CodexAppServerClient` | 传输层真实（box 上握手 `initialize`+`account/read` 通过）；通知归一化/审批/动态工具未移植 | G/F8 |
| `AgentGatewayProxy` | 只有形状：认证后一律 501；`authorize` 未移植 | H |
| LLM 路由框架（MiniMax 等自定义 provider、gate proxy、结构化输出模拟） | 真实（PORT-NEW） | A/G：让 agent 在没有 Anthropic/网关账号时也能跑 |
| `relative-writer`、`pdf-windows`（解析部分）、`voice-guard`、`job-boundary` | 真实（差分） | 各处 |
| `writeWorkspace` | **部分**：目录、taste 种子、`.claude/settings.json`；**缺** CLAUDE.md 生成/迁移（含执行契约）、audit、链接逃逸防护 | A：agent 读的规则文件 |

### 2.3 引擎能力盘点（`engine/`，0.1.57-rc7，Python 3.14.6）

63 个 `tools/*.py`（不含 `_` 前缀内部模块），`CANONICAL_TOOLS.md`：21 生成 + 10 检查 + 5 QA/契约 + 基础设施。

| 能力 | 工具 | 费用/依赖 | box 状态 |
|---|---|---|---|
| 安装体检 | `doctor.py --json [--deep]` | $0 | **[已验证]** 除 `gateway`（需 key）外全绿 |
| 路由回执 / 守卫 | `prepare_production.py`、`.claude/hooks/production_guard.py`、`qa_gate.py --hook`、`session_marker.py` | $0，无网络 | **[已验证]** guard 对 assemble/compose 命令 exit 0 并自动写 `route-receipt.json` |
| 计费契约 | `cost.py contract/plan/estimate --json` | $0 本地 | **[已验证]** `contract`（docs/12 money 契约 compatible）；`plan/estimate` [推断] |
| EDL 剪辑合成 | `assemble.py [--check|--declare]` | $0（ffmpeg） | **[已验证]** 3 beat 横竖混合 → 归一化 → concat → 配乐 |
| Remotion 合成 | `compose_render.py --mode render/retrofit/bespoke/episode` | 本地 $0；**字幕需要 `transcript.json`（`synth_voice` 转写，付费/网关）** | **[已验证]** `--mode render --no-captions --no-overlays`（本轮）；带字幕路径需要 key |
| HyperFrames 渲染 | `hyperframes_render.py`、`hyperframes_{compose,captions,overlays,layout,style,dataviz}.py` | $0（无头 Chrome） | **[已验证]** render（docs/12，自带 fixture 合成）；其余 [推断] $0 |
| 机械校验 | `verify_output.py --mode render`、`render_timeline_strip.py --selftest`、`check_layout.py`、`red_zones.py`、`delivery_safety.py` | $0 | **[已验证]** 前两个；其余 [推断] |
| 观看 | `look_at_video.py`（`--no-transcript` 时 $0）、`dense_sample.py` | $0 / 转写 $0.05 网关 | [推断] |
| 本地变换 | `reframe.py`、`frame_insert.py`、`assemble_plate.py`、`decode_audio.py`（本地路径） | $0 [推断] | 未运行 |
| 素材 | `index_media.py`（素材库）、`job_inputs.py`、`project_brief.py`、`fetch_asset.py`、`website_style.py` | 多为 $0 [推断]；`index_media` 的向量化可能需 key [未知] | 未运行 |
| **付费生成（需网关 key）** | `mint_image`、`mint_video`、`synth_voice`（TTS/转写/变声）、`lipsync_footage`、`cast_avatar`、`perform_avatar`、`score_bed`、`clean_audio`、`sam3`、`densify`、`fx_parallax`、`gemini_video`、`analyze_reference`、`breakdown_reference`、`pull_video`（URL 拉取）、`sfx_catalog`、`build_carousel` 插画、`build_character_sheet` | 网关计费（`VIDEOCLAW_API_KEY`） | **无法真实验证**（无账号）；无 key 时应返回 `videoclaw.authorization-required/v1` [读码：README]，该拒绝路径可在 box 验证 |
| 成片审阅 | `review_render.py`、`review_output.py` | 对用户 $0，但走网关 `/v1/harness/review` [读码：prepare_production L394 注释] | 无 key 时行为 [未知] |

---

## 3. 主流程验收场景 S1（Phase B 必须真实跑通）

### 3.1 场景
> “我有三段短素材和一段配乐。帮我做一个 6.5 秒的竖屏 9:16 快剪：按 a→b→c 顺序，a 取 0.5–3.0 s，b 取 0–2.0 s，c 取 0.5–2.5 s；只用 music.mp3 做音轨（不要素材原声）；不要字幕、不要叠加、不要任何付费工具。渲染成片。”

选它的理由：覆盖 F1 的每一步（建视频、附件、agent 多步 Bash、引擎 guard/回执、assemble、Remotion 合成、job 绑定、版本、批准），**全程 $0、不需要任何账号**，且输出可被精确机器校验（时长、画幅、切点位置、音轨来源）。brief 写死参数，降低 LLM 不确定性。

### 3.2 输入（确定性合成，无版权问题）
`tools/accept_fixtures.sh OUT` 生成（ffmpeg lavfi，带 seed，两次生成 SHA256 一致 [已验证]）：

| 文件 | 规格 | 作用 |
|---|---|---|
| `clip_a.mp4` | 1920×1080 30 fps 4 s，testsrc2 + 440 Hz 正弦 AAC | 横屏、带原声（用于检验“丢弃原声”） |
| `clip_b.mp4` | 1080×1920 30 fps 3 s，mandelbrot，无音轨 | 竖屏、无音频 |
| `clip_c.mp4` | 1280×720 **25 fps** 3 s，life(seed 7) + 粉噪 AAC | 不同帧率/画幅 |
| `music.mp3` | 6.5 s 330 Hz 正弦（−6 dB） | 配乐 |
| `SHA256SUMS` | 上述 4 个文件 | 检验原件未被改写 |

可选 S1-real：换成真实 CC0/CC-BY 片段（如 Blender 开放电影片段），用同一 brief；验收只放宽 E10（切点检测阈值）。本轮未下载，[未验证]。

### 3.3 步骤（L3 = 原版 UI 驱动；L1/L2 为降级层次）
| 步 | 动作（L3：CDP 驱动原版渲染器） | 期望的 IPC / 产物 |
|---|---|---|
| S1.0 | 全新 `HOME`/userData 启动 port（原版渲染器），完成 Setup | `bootstrap:run` 真实；doctor 仅 `gateway` 红（PORT-NEW 接受开关）；`engine-current.json` |
| S1.1 | 设置里 LLM 路由选 `minimax`（box 上唯一可用的 agent LLM；key 只来自环境变量） | `settings:set` → `engine:llmRouteReadiness` ready |
| S1.2 | New video；附 4 个文件（CDP `DOM.setFileInputFiles` 或 `intakePickFiles` 的对话框在 smoke 模式下由 env 预置路径） | `session:create` → meta；`attachment:stage` → `attachment:changed`(ready)；文件落到 `~/Videoclaw/incoming/` |
| S1.3 | 输入 §3.1 的 brief，发送 | `session:send` → `{submitted:true}`；`session:event` 流 |
| S1.4 | 若出现方案卡 → 点 Build（或以 `bypassPermissions` 跑 S1-bypass 变体） | `sessionPlan:changed` → `sessionPlan:choose` |
| S1.5 | agent 自行：`prepare_production`（或 guard 自动回执）→ 建 job、把素材放进 job、写 `edl.json` → `assemble.py` → `compose_render.py --mode render --no-captions` | `tool_start{toolName:"Bash"}` 若干；`session:changed` 带 `jobId`；`job:snapshot` 推送 |
| S1.6 | 成片出现在播放器，点批准 | `job:snapshot.renders[0]` 为 `final.mp4` candidate → `versions/v1.mp4`；`version:approve(sid,1)` → `finalizedAtMs` |
| S1.7 | 导出到 `~/export/s1.mp4` | `file:saveItemAs`（smoke 模式下对话框目标由 env 预置） |
| S1.8 | 运行 `accept_check.py` | 全部通过 |

降级层次：**L0** 纯引擎（无应用、无 agent，`tools/accept_engine_chain.sh`）**[今天已 PASS]**；**L1** 经 IPC smoke 驱动（主进程 `executeJavaScript` 直接调用 `window.videoclaw.*`，不点 UI）；**L2** = L1 + 原版附件/方案/权限通道；**L3** = 原版 UI 真点击；**L3-pkg** = 在 AppImage 上重复 L3。

### 3.4 机器验收标准（`tools/accept_check.py JOB_DIR --inputs IN --userdata UD --session SID`）
退出码 0 当且仅当没有 fail 且没有 pending。

| ID | 断言 | 工具 |
|---|---|---|
| E1 | `jobs/<id>/final.mp4` 存在且非空 | fs |
| E2 | `ffprobe -show_format -show_streams` 退出码 0 | ffprobe |
| E3 | 恰好 1 路视频，h264，pix_fmt ∈ {yuv420p, yuvj420p} | ffprobe |
| E4 | 分辨率 ∈ {720×1280, 1080×1920}（9:16） | ffprobe |
| E5 | `r_frame_rate == 30/1` | ffprobe |
| E6 | 恰好 1 路音频，aac | ffprobe |
| E7 | 时长 6.5 ± 0.25 s | ffprobe |
| E8 | `ffmpeg -v error -i final.mp4 -f null -` 退出 0 且 stderr 为空（全片可解码） | ffmpeg |
| E9 | `blackdetect=d=0.5:pix_th=0.1` 无黑场 | ffmpeg |
| E10 | `scdet=threshold=10` 恰好 2 个切点，分别在 2.5±0.2 s、4.5±0.2 s（验证顺序与剪切点） | ffmpeg |
| E11 | 330 Hz 带通均值 > −30 dB 且比 440 Hz 带通高 ≥ 12 dB（音轨是配乐而不是 clip_a 原声） | ffmpeg |
| E12 | `render-manifest.json` 的 `output.path == "final.mp4"` 且 `output.sha256 == sha256(final.mp4)` | fs |
| E13 | `run.log.jsonl` 含 3×`beat_assembled`、`timeline_assembled`、`render_completed` | fs |
| E14 | `run.log.jsonl` 中 `estimate_usd` 之和 = 0（零花费） | fs |
| E15 | 输入原件 SHA256 不变 | sha256 |
| A1 | `jobs/<id>/versions/v1.mp4` 存在且与 final.mp4 同 sha256 | fs |
| A2 | `<userData>/sessions.json` 中该 session 的 `jobId == <id>` | fs |
| A3 | 该 session `finalizedAtMs` 存在（已批准） | fs |
| 过程 | agent 回合以 `result{subtype:success}` 结束、无 `error` 事件、15 min 内回到 idle；无残留 `claude`/`ffmpeg`/`chrome` 进程（`pgrep`）；网关请求数 0 | smoke 日志 |
| 导出 | `~/export/s1.mp4` 与 `versions/v1.mp4` 字节相同 | sha256 |

已知与原版无关的容差：E10 依赖 agent 严格按 brief 剪；E4 接受 720p/1080p（`compose_render` 默认 720p）；`review_render` 若被 agent 调用，没有 key 时的失败**不计入**验收（[未知] 其具体表现，Phase B 记录）。

### 3.5 L0 证据（本轮 [已验证]）
`bash tools/accept_engine_chain.sh /workspace/vc-linux/ud/engines/engine-0.1.57-rc7-15f8f2d /tmp/p20/l0` → `[verify_output] STATUS: OK`、`L0 ACCEPT PASS`（约 42 s）。`artifacts/phase-a-probe/accept-L0.json`：E1–E15 全部 ok。实测 final.mp4：h264 yuvj420p 720×1280 30/1，aac（96 kHz 单声道——由 assemble 的配乐混音得出，原样记录），6.507 s，切点 [2.5, 4.5]，330 Hz −13.2 dB vs 440 Hz −34.6 dB。注意：`compose_render` 会在引擎的 `remotion/public/_jobs/` 下建指向 job 的符号链接（原版引擎设计），脚本结束时删除。final.mp4 是否逐字节可复现 [未验证]。

---

## 4. 里程碑路线图（按优先级；每个都以真实运行为验收）

规模为粗估（S≈1 轮，M≈2–3 轮，L≈4+ 轮）[推断]。

| # | 里程碑 | 范围 | 真实运行验收 | 规模 | 平台 |
|---|---|---|---|---|---|
| **M0** ✅ | 基线 | 引擎 Linux 运行、bootstrap、editorRender、最小 AgentHost（docs/11–19）；本轮 L0 + 原版渲染器探针 | `accept_engine_chain.sh` PASS；截图 | – | Linux |
| **M1** | **原版 UI 上线** | port 默认加载 `app/out/renderer`（打包时作为资源；保留现有 PORT-NEW 设置页作诊断页）；首页启动路径通道给出原版形状的本地值：`account:snapshot`（“Local studio”无账号态）、`app:update:get`、`interaction:replayPending`、`quickstart:catalog`（离线空目录）、`workflowSubmit:eligibility`、`bootstrap:status`（真实）、`client:*`（真实，读写 `sessions.json` 中 clients）、`session:list`；CSP 头 | CDP 脚本：0 个 renderer 异常；首页 DOM 断言；启动阶段 `NOT IMPLEMENTED` 日志 0 条；Settings/Projects/新建项目可点 | M | Linux（Win/mac 构建同代码） |
| **M2** | **引擎化 AgentHost（S1-L1 的核心）** | 会话 cwd=`~/Videoclaw`；agent env=`engineSessionEnv`；完整 `writeWorkspace`（CLAUDE.md 生成 + 执行契约 L9572 + audit）；`settingSources:["project"]` 启用引擎 hooks；系统提示 append（`project_brief.py`、workflow 索引）；开放 Bash，权限走原版模型（`canUseTool` → `permission:request` ↔ `permission:respond`，permissionMode auto/bypass）；job 嗅探绑定 `commitBind`；`sessions.json` 写入与恢复；`session:history`；studio MCP 先移植 $0 子集（`get_workflow`、`search_workflows`、`propose_session_plan`、`project_memory` 只读） | **S1-L1**：IPC smoke 驱动 MiniMax 跑完 S1，`accept_check.py` E1–E15 + A2 通过 | L | Linux |
| **M3** | 作业/版本/播放/导出 | `JobWatcher`+`scanJob` → `job:get`/`job:snapshot`；`VersionStore`（铸 `versions/vN.mp4`、`versions.json`）、`version:approve/revertFinal`、`session:unfinalize`；`vcmedia://` 协议（Range）；`file:openPath/revealItem/saveItemAs`；`spend:get/snapshot`（$0 时恒 0） | A1、A3 通过；vcmedia Range 请求单测 + 原版播放器真实播放（`<video>` `readyState≥3`）；导出字节相同 | M | Linux |
| **M4** | 附件与素材导入 | `ComposerAttachmentStore` 全套 `attachment:*`、`intake:pickFiles`（对话框 + smoke 预置）、`materials:*`、预览抽帧 | **S1-L2**：附件经 IPC 进入，E15 通过，agent 从 `incoming/` 取素材 | M | Linux |
| **M5** | **S1 从原版 UI 端到端** | 方案卡 `sessionPlan:*`、权限/输入卡、`session:retry/setModel/setPermissionMode/setReasoningEffort/rename/delete/deletionPlan/reorder`、`input:*`、`quit:*` | **S1-L3**：CDP 真点击全流程，截图序列 + `accept_check.py` 全绿；**S1-L3-pkg**：AppImage 重复 | M | Linux |
| **M6** | 编辑器 | `hfPreview:*`（预览 worker 静态服务、`hfEditApply`）、编辑器 UI 下的 `editorRender` | S2：agent 用 `hyperframes_compose`（$0 [推断]）出 HyperFrames 合成 → UI 编辑文字 → 重渲染 → ffprobe + 文本帧比对 | M | Linux |
| **M7** | 其余本地功能 | `memory:*`、`taste:*`、`project:seedPack`、`library:*`（`index_media.py`）、`characters:*` 本地部分、`stats:stageEtas`、`feedback:capture/discard`（本地诊断包）、`account:localReset*`、`session:startContinuation`、`job:adopt/historicalSnapshot` | 每项一个 IPC 冒烟 + 产物断言；S3：重启应用后恢复会话与 job、继续对话 | L | Linux |
| **M8** | Codex harness | app-server 通知归一化、审批、动态工具（→ `runBash`）、`engine:codex*`、`saveAgentProviderKey`、`continueOnCodex` | S1 用 `agentHarness:"codex-app-server"` 重跑：需要 OpenAI 兼容 provider key 或 ChatGPT 登录（**凭据**） | M | Linux（凭据） |
| **M9** | 账户/网关/计费 | `AccountAuth`（Google/邮件）、`AgentGatewayProxy.authorize`（spend/quote/permit）、`gateway:*`、`spend:setCeiling`、付费权限卡、引擎网关下载、quickstart 签名目录、`creditHandoff*`、`workflowSubmit`、`feedback:submit`、outbox/遥测 | 无凭据：按原版请求/响应形状做**本地 mock 网关契约测试**（不重建云服务本身）+ 无 key 时 `authorization-required/v1` 拒绝路径真实运行；有凭据（用户提供）：S4 一个最小付费步骤（如 1 张 `mint_image`）真实扣费并回显 | L | Linux（凭据） |
| **M10** | 平台专属 | 语音听写/语音备注、PDF、麦克风权限、凭据加密、自动更新、签名公证、Windows W1–W10 | 见 §5 | L | **mac / Win** |

### 4.1 关键风险
1. **agent LLM 不是 Claude** [未知]：box 上只有 MiniMax（经 Claude Code + gate proxy）。原版系统提示、CLAUDE.md、studio MCP 都是给 Claude 写的；MiniMax 能否稳定按 brief 完成多步 Bash 剪辑、是否会擅自调用付费工具或字幕，需要 M2 实测。缓解：brief 写死参数；`accept_check` 只看产物；必要时 S1-bypass 变体。
2. **系统提示/会话上下文体量** [读码]：`sessionContext.append`、workflow 索引、quickstart 卡、执行契约分散在 L24709、L31545、L33238、L41624、L53273 等多处，移植量大；需逐字节切片（沿用 `gen-verbatim.mjs`）避免手写偏差。
3. **原版渲染器对 `undefined` 返回的容错** [未知]：首页可容忍，深层流程（发消息、播放器）可能因桩返回崩溃 → M1/M3 期间逐通道补齐“原版形状”的返回。
4. **权限模型与 Bash** [读码 + docs/16]：Claude Code 对“只读”命令可能跳过 `canUseTool`；开放 Bash 后要依赖原版的 hooks（`production_guard`）+ 权限模式，而不是 port 现在的目录白名单。需要在一次性 HOME 中运行，避免影响 box 其它数据。
5. **付费路径不可真实验证**：没有账号时 M8/M9 只能做到契约级；“100%”在这一层必须由用户提供凭据后补验。
6. **`review_render` 无 key 行为** [未知]：agent 可能在出片后调用它；需确认失败不阻塞回合。

---

## 5. “100%” 在 Linux box 上意味着什么

| 层级 | 定义 | 在哪验证 | 如何验证 |
|---|---|---|---|
| **T1 Linux 可完全验证** | 184 通道中所有不依赖凭据/macOS 的通道都有真实实现（或与原版在非 darwin 上完全相同的“不可用”行为）；S1–S3 + S2(编辑器) 从原版 UI 真实跑通；打包 AppImage/deb 重复 | box + GitHub Actions ubuntu（docs/13） | `accept_check.py`、CDP 截图序列、`ipc_coverage.py` 中 stub=0（T2/T3 除外） |
| **T2 需凭据** | 网关账户登录、付费生成/审阅、额度/充值、Codex ChatGPT 登录、claude.ai 登录、网关引擎下载、quickstart 目录、反馈上传 | box（用户把 key 放进环境变量或在 UI 登录，见 sign-in 流程），绝不入库 | 契约 mock 测试常驻 CI；真实凭据跑一次 S4 并留存脱敏证据 |
| **T3 需 macOS** | `voice-dictation`（Swift，`SpeechAnalyzer`，**macOS 26+**，on-device，原版刻意禁止回退到云转写）、`readWithPdfKit`（`/usr/bin/osascript -l JavaScript` + PDFKit，L56968）、`systemPreferences.askForMediaAccess`（麦克风 TCC）、`titleBarStyle:"hiddenInset"`/红绿灯、DMG + electron-updater（mac zip feed）、Developer ID 签名 + 公证 + hardened runtime entitlements（麦克风） | macOS runner（GitHub Actions `macos-15`/`macos-26` 若可用 [未知]）+ 用户本机的文档化手动步骤 | CI：编译 Swift helper、`--check` 返回 JSON、打 dmg、`codesign --verify`/`spctl`（需 Apple 证书 secrets，用户提供）；手动：在 Mac 上跑 S1-L3 + 一条语音听写 |
| **T3' 需 Windows** | docs/10 §5 的 W1–W10（taskkill 进程树、Git Bash、`.cmd` shim、System32 tar、NTFS ino、`windowsHide`）、NSIS 安装与签名 | GitHub Actions `windows-latest`（docs/13 已有 CI 骨架） | 在 Windows runner 上跑 L0 + S1-L1（需要 MiniMax key 作为 CI secret，用户决定） |

Linux 上的平台功能取舍（与原版对齐的做法）：
- **语音听写**：原版非 darwin 时 `voiceDictationStatus` 即“Voice notes are unavailable in this build.”（port 已一致）。这就是“原版在该平台的 100%”。若用户想在 Linux/Windows 上真能听写，属于 **PORT-NEW 扩展**：同一 JSON 协议（`--check` → `{"available":true}`；`<file>` → 文本/错误码）的外部 helper，由 env 指定（如 whisper.cpp），不算原版重建，需用户拍板。
- **PDF 读取**：原版非 darwin 返回 `{kind:"unread", cause:"unavailable"}`；docs/10 已有 Windows 设计；Linux 同理可选外部 `pdftotext`（PORT-NEW）。
- **凭据加密**：Electron `safeStorage` 在 Linux 依赖 libsecret/kwallet，box 上无桌面钥匙串时会退化为 `basic_text` [推断，未测]；需在 M9 前确认并按原版 `CredentialStore` 的不可用分支处理。
- **自动更新**：原版 electron-updater generic feed（网关）；Linux AppImage 可用同一机制，但 feed 属网关（T2）。

---

## 6. 下一轮（Phase B 第一轮）建议的具体任务
1. M1：port 主进程默认加载原版渲染器（开发态指向 `app/out/renderer`，打包时拷为 `resources/renderer-original`），补齐首页启动路径 6 个未实现通道（`account:snapshot`、`app:update:get`、`interaction:replayPending`、`quickstart:catalog`、`workflowSubmit:eligibility`，以及 FAKE_SETTINGS 下的 `engine:llmRouteReadiness`）的原版形状返回，CDP 冒烟脚本入库（`tools/original-ui-smoke.mjs`）。
2. M2 前半：完整 `writeWorkspace`（CLAUDE.md/执行契约逐字节切片）、agent 会话 cwd=工作区 + `engineSessionEnv` + `settingSources:["project"]` + Bash；job 嗅探绑定；`sessions.json` 写入。
3. 用 IPC smoke 跑 S1-L1（MiniMax，并发 1），用 `accept_check.py` 判定；无论成败都留存脱敏事件日志。

## 7. 复现
```bash
python3 tools/ipc_coverage.py                 # 覆盖表（--json 明细）
bash tools/accept_fixtures.sh /tmp/s1-in      # S1 输入
bash tools/accept_engine_chain.sh <ENGINE_DIR> /tmp/s1-l0   # L0：$0 引擎链 + 验收
python3 tools/accept_check.py <JOB_DIR> --inputs /tmp/s1-in [--engine-only] [--userdata UD --session SID]
# 原版渲染器探针（port/ 目录，需已 npm run build）
env HOME=$(mktemp -d) VIDEOCLAW_PORT_FAKE_SETTINGS=1 ELECTRON_RENDERER_URL=file://$PWD/../app/out/renderer/index.html \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox --remote-debugging-port=9334 .
```
