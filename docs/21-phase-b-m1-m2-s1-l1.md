# 21 · Phase B：M1（原版 UI 上线）+ M2（引擎化 AgentHost）+ S1-L1 实跑

> 范围：docs/20 路线图的 M1、M2 与主流程场景 S1 的 L1 验收（真实 MiniMax、真实引擎、真实 IPC）。
> 证据：`artifacts/phase-b-L1/`（已脱敏；`MINIMAX_API_KEY` 命中数 = 0）。代码只在 `port/` 与 `tools/`。

## 0. 已验证 / 未验证（一览）

| 项 | 结论 | 证据 |
|---|---|---|
| M1 port 默认加载**未改一字节的**原版渲染器 | ✅ 已验证 | `m1-home-smoke.log`：`renderer: original file:///…/app/out/renderer/index.html` |
| M1 首页渲染（What are we making today? / New video / Personal / composer / 无登录门） | ✅ 已验证（DOM 断言 5/5，renderer console error 0） | `m1-home.png`、`m1-home-smoke.log` |
| M1 首次启动“选 AI 订阅”页（原版行为，`llmRouteAcknowledgedAt` 未设时出现） | ✅ 观察到 | `m1-first-launch-route-picker.png` |
| M1 启动期 `NOT IMPLEMENTED` 通道 | 仅剩 `quickstart:catalog`（见 §5） | `m1-home-smoke.log` 同次运行主日志 |
| M2 会话 cwd = 工作区、engineSessionEnv、绑定 job、上下文 epoch、组装的 session context（laws 1.20.0，append 79 120 B） | ✅ 真跑验证 | `run2-main-structured.log` 的 `agent.runtime.started` |
| M2 首条消息铸 job + commitBind（先于 spawn）+ `[APP-OWNED PRODUCTION ID]` 前缀 | ✅ 真跑 + 单测 | `agent.job.bound`；`test/engine-session.test.ts` |
| M2 Bash 开放 + 原版权限模型（PreToolUse hook → `authorizeProductionCommand` → engine `production_guard.py --verdict-json`） | ✅ 真跑：28 次判决（23 read_only、4 protected 放行、1 次原版 app-owned 拒绝） | `run2-main-structured.log` `agent.production.decision` |
| M2 权限卡（`permission:request` / `permission:respond` / `interaction:replayPending`） | ✅ 单测；真跑中 0 张卡（`auto` 模式下 CLI 未询问） | `test/engine-session.test.ts` |
| M2 sessions.json 写入（原版 writeRegistry 合并写）+ 重启恢复 | ✅ 真跑：重启后 `restored 2 session(s)`，侧栏列出 2 个视频 | `reload-smoke.log`、`reload-home.png`、`sessions.json.snapshot.json` |
| **S1-L1** | ✅ **PASS**：E1–E15 全过；A2（会话绑定 job）过；A1/A3 pending（M3） | `run2-accept-engine.json`、`run2-accept-with-app.json`、`run2-final.ffprobe.json` |
| gate proxy 并发 1 / key 隔离 | ✅ 53 次请求、maxInflight=1、rejected=0；子进程只拿会话 token | `run2-main-structured.log` `agent.runtime.closed` |
| 结构化输出仿真 | 本次未触发（`structuredEmulated=0`），仍由 docs/17 的单测覆盖 | 同上 |

## 1. M1：原版 UI 上线

- **渲染器选择**（`port/src/main/renderer-entry.ts`）：默认 = 原版 `app/out/renderer/index.html`（开发态相对 app 路径；打包态 `resources/renderer-original/`，由 `tools/packaging-config.mjs` 的 `originalRendererDir` 作为 extraResources 拷贝）。`VIDEOCLAW_PORT_RENDERER=port` 切回 PORT-NEW 诊断页；`ELECTRON_RENDERER_URL` 仍最优先（原版 L60539）；旧冒烟（`VIDEOCLAW_PORT_SMOKE=1` 且无 HOME/S1/RELOAD）保持 port 页，旧冒烟脚本不受影响。
- **首页启动通道做真**（`port/src/main/home-boot.ts`，接线在 `real-backend.ts`）：

| 通道 | 原版 | port 实现 |
|---|---|---|
| `account:snapshot` | L61406 → resolveAccountSnapshot L55423 → buildAccountSnapshot | **逐字切片** `account-snapshot.generated.ts`（chunk `workbookContents` L148-251）+ 诚实输入（无账号服务、未登录）。**PORT-NEW“本地工作室”策略**（默认开，`VIDEOCLAW_PORT_ACCOUNT_GATE=1` 关闭）：按“老 key 用户”输入构建（`legacyKeyOnly → step "ready"`），与渲染器自带的 `QA_ACCOUNT_READY` 回退语义一致；关闭时得到原版真实的 `signed-out`（登录门）。快照带 `portLocalStudio:true` 标识。 |
| `app:update:get` | `currentUpdateInfo`（初值 null） | `null`（port 无更新检查器） |
| `interaction:replayPending` | L61701 重推 pending 权限/输入请求 | 同逻辑，读 AgentHost 的 pending 卡 |
| `workflowSubmit:eligibility` | L62398 | 无网关时的原版形状 `{eligible:false, githubUsername:null, workflowsRepo:"", configured:false}` |
| `bootstrap:status` | L9802 | `BootstrapCore.status()` + 原版其余字段（`shouldOffer`/`devMode`/`engineUpdate:"unknown"`/`studioBundle:{state:"disabled"}`/`engineIdentity`…，未移植的 store 给原版“未配置”值） |
| `client:list` / `client:create` | L36329 / L36346 + projectNameError L288 | 逐行移植，读写 sessions.json 的 `clients`（缺省 `DEFAULT_CLIENTS` = Personal） |

- **原版 UI 冒烟驱动**（`port/src/main/original-ui-smoke.ts`，PORT-NEW）：`VIDEOCLAW_PORT_SMOKE_HOME=1`（DOM 断言 + 截图）、`VIDEOCLAW_PORT_SMOKE_S1=<brief 文件>`（经 `window.videoclaw` → preload → 真 IPC：createSession → sendMessage → 等 result，权限卡按 `VIDEOCLAW_PORT_SMOKE_PERMISSION=allow|deny` 应答）、`VIDEOCLAW_PORT_SMOKE_RELOAD=1`（重启后列会话）。`VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=<route>` 在窗口加载前 `settings:set({llmRoute, llmRouteAcknowledgedAt})`（相当于用户在首启页/设置页选过一次路由）。`VIDEOCLAW_PORT_EVENT_LOG=<file>` 把 `session:event`/`session:changed`/`permission:request` 推送脱敏写成 JSONL。

## 2. M2：引擎化 AgentHost

有已安装引擎时（`VIDEOCLAW_PORT_AGENT_ENGINE=0` 可退回 docs/19 的只读聊天），AgentHost 跑**引擎会话**，对应原版 `spawnLocal`(L39454) / `createLocalRuntime`(L23059, L23237)：

- **逐字切片**（`tools/gen-verbatim.mjs` 新增 2 个 spec，`test/verbatim.test.ts` 保证与 bundle 一致；`tools/check-unresolved.mjs` 保证无未解析标识符）：
  - `agent/session-assembly.generated.ts`：policy refusal、CHARACTER_VOICE_GUIDANCE…assembleSessionContext、assertEnginePython / assembleLocalSessionContext / legacyDevSessionContext、EXECUTION_CONTRACT / workspaceClaudeMd / migrateWorkspaceClaudeMd、permissionModeMeaning、JOB_RE、classifyPriorWorkIntent、deriveTitle、deterministicJobId。替换 1 处（`.venv/bin/python` → `venvPython()`）。
  - `agent/production-auth.generated.ts`：checkProductionVerdict / parseProductionVerdictResult、PROTECTED_TOOLS、authorizeProductionCommand、appOwnedVideoCommandRefusal、withFinalRenderWindow 等。替换 1 处（venvPython）。未移植协作者集中在 `production-auth-unported.ts`（feature-flag store 缺省 = 原版“absent”；无引擎分支的分类器关闭；付费 input-bound 计划 = 无 → 拒绝）。
- **端口化方法**（`agent/engine-session.ts`，逐行引用原版行号）：sessionPolicyContext / sessionPolicyPreamble（新视频 = `unlimited_for_video`）、firstMessageJobId + engineTurnText（L41559-41600）、assembleBundle、pinBoundJobEnv / pinSessionContextEpoch、engineSupportsOperationRecovery、claudeCodeDisallowedTools、adaptClaudeCodeCanUseTool、makeEngineHooks（L49787）、makeEngineCanUseTool（L49920，含 reauthorizeBashAtAllow）、sniffJobIds / isPreexistingJob。
- **query 选项**（`AgentHost.engineQueryOptions`）：cwd=工作区、`permissionMode`（新视频默认 `auto`；`bypassPermissions` 时补 SDK 要求的 `allowDangerouslySkipPermissions`）、`settingSources:["project"]`（引擎 `.claude/settings.json` 的 SessionStart/PreToolUse/Stop hooks 生效）、`systemPrompt` preset claude_code + append、disallowedTools、canUseTool、hooks、`mcpServers:{}` + strictMcpConfig、env = 路由子环境（会话 token）→ CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK → 引擎 env → 原版 app 开关（顺序同原版）。**不再有 `tools` 只读白名单**。
- **工作区**：`engine/workspace.ts` 现按原版 writeWorkspace 顺序创建/迁移 `CLAUDE.md`（执行契约 `videoclaw-execution-contract:3`，原子 tmp+rename）并 `validateEngineSessionContext`；启动时（引擎模式）也跑一次，让旧 port 版本 stage 的工作区补上 CLAUDE.md。
- **job 绑定**：首条消息（非“继续”意图）`deterministicJobId` → `mkdir jobs/<id>` → commitBind（保存 registry、session:changed、空闲 runtime 退役以便下次 spawn 钉 `VIDEOCLAW_BOUND_JOB`）→ 再 spawn；tool_use 中出现的**新** `jobs/<id>` 由 maybeBindJob 嗅探绑定，会话创建前已存在的 job 不会被收养。
- **权限卡**：canUseTool 的 permission/question 走 `permission:request` 推送，`status=awaiting_permission`，`permission:respond`（send 通道，index.ts 路由到 `sendHandlers`）回填；Stop/拆 runtime 时 pending 卡以 deny+interrupt 结束；money 类（engine 判 spendRisk≠free）直接拒绝（无账号，M9）。
- **sessions.json**：`SessionRegistry.writeRegistry`（原版 L36199：与磁盘行合并、tmp→fsync→rename→fsync 目录；win32 跳过目录 fsync）+ 250 ms 去抖 + will-quit flush；启动时 loadRegistry 自愈后交给 AgentHost（`restoreSessions`），重启后可列出并继续（新 runtime；SDK resume 未移植）。

## 3. S1-L1 实跑

- 环境：box（Linux），HOME=`/workspace/s1/h`，引擎 `engine-0.1.57-rc7-15f8f2d`（真实 bootstrap 安装），路由 `minimax`（MiniMax-M3.1-Flash，Anthropic 兼容，经 gate proxy），Claude Agent SDK 0.3.305 / Claude Code 2.1.305。
- 输入：`tools/accept_fixtures.sh` 生成到 `~/Videoclaw/incoming/s1/`；brief = docs/20 的 S1 原文 + 一行“素材在工作区 incoming/s1/ 下：clip_a.mp4、clip_b.mp4、clip_c.mp4、music.mp3”（附件上传是 M4，未移植，故以路径告知——**偏差**）。
- **run1（无额外提示，最忠实）**：❌ 20 min 超时。MiniMax 连续 68 条只读命令研读引擎源码（全部经 guard 判 read_only 放行），从未开始制作。job 已绑定、route receipt 已由 guard 自动记录。证据 `run1-*`。
- **run2（加 PORT-NEW 提供商路由提示）**：✅ 292 s、41 轮、40 次工具调用、0 张权限卡、$0。代理按引擎自己的文档走：`prepare_production` → 拷素材 → 写 `edl.json` → `assemble.py --check`（两次修正）→ `assemble.py` → `compose_render.py --mode render --resolution 720p --no-captions --no-overlays --allow-stub-overlays …` → `review_render.py` → ffprobe/抽帧自检，最后用中文汇报。`accept_check.py --engine-only`：**E1–E15 全部通过**（720×1280、30 fps、6.507 s、切点 2.5/4.5、330 Hz 音乐为音轨、render manifest v4 绑定、run log 含 assemble/compose 事件、spend=0、输入未改）。带 `--userdata/--session`：A2 ✅，A1/A3 pending（VersionStore = M3）。

### 3.1 为 $0 路径做的改动（MiniMax）与忠实度

| 改动 | 性质 | 忠实度说明 |
|---|---|---|
| `PROVIDER_ROUTE_PRODUCTION_HINT`（`engine-session.ts`）追加在 systemPrompt append 末尾，仅对非 `claude-code`/`gateway` 路由；`VIDEOCLAW_PORT_ROUTE_HINT=0` 关闭 | **PORT-NEW 偏差** | 原版只跑 Claude 模型，没有这段。内容是引擎通用的（指向引擎自带的 `skills/primitives/assemble.md`、`--help`、assemble→compose_render 标准链，限制约 8 条探索命令），不含 S1 的任何参数；原版 laws/preflight/执行契约原样注入，guard 判决不受影响 |
| 引擎回合超时 20 min（`VIDEOCLAW_PORT_TURN_TIMEOUT_MS` 可调；run2 用 28 min 上限，实际 5 min）、`maxTurns` 120 | PORT-NEW 安全网 | 原版无回合上限；共享 key 下防失控 |
| 新视频 `permissionMode` = 原版默认 `auto` | 忠实 | 本次 CLI 未询问任何工具；`default` 模式下每条非只读 Bash 会出权限卡（单测覆盖），冒烟可自动 Allow |

## 4. 测试 / 构建

- `npm test`：**197/197** 通过（新增 `test/engine-session.test.ts` 7 个：首条消息 job id/turn 文本、引擎会话 query 选项与持久化、hooks/plan 工具、权限卡往返 + replay + Stop 中止、continue 意图与嗅探绑定、sessions.json 合并写 + 恢复 + createClient、M1 首页通道与渲染器选择；更新 `bootstrap.test.ts`（writeWorkspace 现会校验引擎上下文并写 CLAUDE.md）、`packaging.test.ts`（renderer-original 资源））。SDK 与引擎边界在单测中 mock；L1 实跑不 mock。
- `npm run build`（gen + typecheck + bundle）：通过；`node tools/gen-verbatim.mjs --check`：通过。
- IPC 覆盖（`python3 tools/ipc_coverage.py`）：184 个通道中 **real 18 + real-env 1**（此前 10+1）、fixture 8（此前 11）、stub 133（此前 138）、push-real 5（此前 4，新增 `permission:request`）。

## 5. 仍延后 / 偏差

- `quickstart:catalog`：仍 NOT IMPLEMENTED（需 QuickstartCatalogStore + 媒体预览协议；首页照常渲染，“Style inspirations”停在 Loading）。
- studio MCP（workflow 工具 / propose_session_plan）、session plan 门、spend 预算/付费卡（付费一律拒）、SDK `resume`/`session:history`、`replay-user-messages`、运行中绑定后的 runtime 轮换+重放（只在空闲时退役）、pending bind（目录尚不存在的 job）、JobWatcher / VersionStore / 导出（M3）、附件（M4）、标题派生（会话标题保持 “New video”）。
- run1 时尚未设置 `VIDEOCLAW_OPERATION_RECOVERY`（之后已按原版 `engineSupportsOperationRecovery` 补上，run2 已带）。

## 6. 复现

```bash
cd port && npm run build
# M1 首页（无模型调用）
env -u VIDEOCLAW_CLAUDE_AGENT_SDK HOME=<home-with-engine> VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_HOME=1 \
  VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax VIDEOCLAW_PORT_SMOKE_SCREENSHOT=/tmp/home.png \
  xvfb-run -a npx electron --no-sandbox .
# S1-L1（真实 MiniMax，单请求并发 1）
bash ../tools/accept_fixtures.sh <home>/Videoclaw/incoming/s1
env -u VIDEOCLAW_CLAUDE_AGENT_SDK HOME=<home> VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_S1=brief.txt \
  VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax VIDEOCLAW_PORT_EVENT_LOG=events.jsonl VIDEOCLAW_PORT_SMOKE_S1_OUT=s1.json \
  xvfb-run -a npx electron --no-sandbox .
python3 ../tools/accept_check.py <home>/Videoclaw/jobs/<jobId> --inputs <home>/Videoclaw/incoming/s1 --engine-only
# 重启恢复
env ... VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_RELOAD=1 VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax xvfb-run -a npx electron --no-sandbox .
```

## 7. 未验证 / 风险

- S1-L1 只成功 **1 次**（run2）；MiniMax 行为有随机性，无提示时（run1）失败。可重复性未测。
- 无提示的忠实路径在 MiniMax 上不能完成 S1；Claude 路由（原版目标模型）未在本轮实跑（需凭据）。
- `auto` 权限模式在非 Claude 模型上的分类器行为未单独研究：本次未出现询问，原因（CLI 自动放行 vs 分类器）未拆解。
- 真实 UI 中点击 composer 发送（而非经 `window.videoclaw` API）未驱动；原版 UI 是否完整渲染引擎会话的转录（事件形状为 port 子集）未逐项核对。
- 权限卡在原版 UI 中的渲染/点击未真机验证（仅单测 + API 应答路径）。
- Windows/macOS 未运行（同代码；目录 fsync 在 win32 跳过）。
- “本地工作室”账户策略是 PORT-NEW 偏差：渲染器看到 `hasStoredKey:true` 但实际无 key；付费入口依赖引擎/guard 拒绝。
