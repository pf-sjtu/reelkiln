# 24 · Phase B：M6/M7，问题卡真 UI 作答、两个渲染器 TypeError、Quickstart 目录与视频标题

> 接 docs/23。docs/23 第 10 节留下的未验证项和风险是：修复后的问题卡（`permission:respond` 的 `behavior:"answers"`）没有用真 UI 重跑过；所有 run 都有原版 bundle `index-D5K1mOs0.js:31748` / `:39778` 两个 TypeError。M6/M7 把这几项补上，同时补了 `quickstart:catalog`（原先一直显示 “Loading Quickstarts…”）和视频标题（原先一直是 “New video”）。
> 代码：commit `f96724b`（main 侧通道）、`bbd6675`（UI-e2e 驱动器 / 收集 / 覆盖脚本）、`2127880`（拒答判定收窄 + 单测 + `reverdict.mjs`）。
> 证据：`artifacts/phase-b-m6/`，已脱敏：路径替换为 `<RUN>` / `<REPO>` / `<EXTRA>`（= 95e0250 基线工作树），`MINIMAX_API_KEY` 的值在全部证据中命中 0 次。没有提交 mp4 或 sqlite。
> 时间均为 Asia/Singapore（UTC+8），2026-10-21。

## 0. 一览

| 项 | 结论 | 证据 |
|---|---|---|
| (A) 问题卡真 UI 作答，修复后答案被当作 allow+answers 接收 | ✅ 3 次真实 run：qcardC1（专门 brief，主回合）、qcardQ1 / qcardQ2（完整 S1 后的 taste-capture 回合） | `qcard*-ui-e2e-summary.json`、`qcard*-events.jsonl`、`qcard*-main-structured.log`、`qcard*-shots/` |
| (B) TypeError L31748（`.find` of undefined） | ✅ 根因 `characters:list` 是 stub（返回 undefined）；已接原版 CharacterStore。before=1 → after=0 | `bootB0before-console.jsonl` vs `bootB1` / `devA1` / `qcard*` summary |
| (B) TypeError L39778（`.length` of undefined） | ✅ 根因 `session:history` 是 stub（返回 undefined）；已按原版无 SDK transcript 分支返回 `[]`。before=1 → after=0 | 同上 |
| (C1) `quickstart:catalog` | ✅ 原版画廊显示卡片（bundled 目录 1 个 starter “Founder camera story”，3 张图，筛选 All / Founder Story）；修复前永远 “Loading” | `bootB0before` vs `bootB1` / `devA1` 的 `01b-quickstarts.png` + `steps.quickstart_catalog` |
| (C2) 视频标题 | ✅ 首次发送后先变成原版 fallback 标题，再由一次 provider 路由请求得到 automatic 标题（devA1 “三段素材竖屏快剪”，qcardQ1 “六秒半竖屏快剪”），侧栏 DOM 中可见 | summary `title` |
| 完整 S1 8 步（真 UI，dev） | ✅ devA1、qcardQ1、qcardQ2 均 8/8；sha(final)==sha(v1)==sha(export)，ffprobe rc 0，E1–E15 `failed=[]` | `*-accept.json`、`*-sha256.txt` |
| `npm test` / `npm run build` | ✅ **220/220**；build 通过 | 第 6 节 |

## A. 问题卡：真 UI 作答的结果

### A.1 驱动器做了什么（`port/tools/ui-e2e.mjs`）

- `answerQuestionCard(phase)`：一旦页面上出现原版 `.question-card .q-submit`，先截图，再对**每道题的第一个 `.q-option`** 用 `Input.dispatchMouseEvent` 真实点击，截 “selected” 图，然后点击真实的 `.q-submit`（“Answer”）。点击前做 `elementFromPoint` 命中检查（`hit.onTarget`）。驱动器从不调用 `window.videoclaw`。
- 这个函数在主回合（`phase=main`）和首次批准后的 taste-capture 回合（`phase=taste`）都会轮询调用。
- `settleVerdict` / `answerVerdict`：作答后等待该 toolUseId 的 `tool_end` 以及代理之后的文字，然后从三处独立取证：
  1. renderer 推送的 `permission_resolved`（同一 requestId）；
  2. main 新增的结构化日志 `agent.permission.decision`（只记形状：`behavior` 和 `answers` 的题数，不记答案文本）；
  3. 代理之后的 thinking / assistant_text 中是否出现拒答措辞（`DECLINE_RE`），以及是否复述了所选选项（`pickedLabelsEchoed`）。
  `accepted = permission_resolved && tool_end.isError===false && decision.behavior==="allow" && decision.answers>0 && !declined`。
- `--stop-after card`：问题卡作答且代理确认之后立即结束（控制花费）；taste 阶段也生效。`--brief-file` 可替换 brief。

### A.2 三次真实 run

| run | 时间（UTC+8） | 回合 | 卡片内容 | 真实点击的选项 | main 决策 | tool_end | 代理之后的文字 |
|---|---|---|---|---|---|---|---|
| **qcardC1** | 17:15:39–17:16:03 | 主回合，brief 要求先用 AskUserQuestion 问画幅（`--brief-file`） | 1 题单选：竖屏 9:16 / 横屏 16:9 | “竖屏 9:16” | `behavior:"allow", answers:1` | `isError:false, terminal:"ok"` | assistant_text：**“你选了竖屏 9:16。”** |
| **qcardQ1** | 17:20:57–17:29:15 | 完整 S1（8/8）→ Approve V1 → 原版 taste-capture 回合 | 2 题多选：Rules（Music-only audio / No captions or overlays / No paid tools for edits / Honor my exact timecodes）；Framing（Center-crop to fill 9:16 (Recommended) / Skip this one） | “Music-only audio”、“Center-crop to fill 9:16 (Recommended)” | `behavior:"allow", answers:2` | `isError:false, terminal:"ok"` | thinking：**“User kept only: 1. Music-only audio (project-level) 2. Center-crop to fill 9:16 (project-level)”**；assistant_text：**“Locked: music-only audio and center-crop to fill 9:16. Let me check the exact commitment format before writing.”** |
| **qcardQ2** | 17:32:08–17:46:08 | 同 qcardQ1 | 2 题多选：剪辑偏好（只用音乐床，丢弃素材原声 / 快剪不加字幕、不加叠加图形 / 能本地剪就别花钱）；格式与剪法（严格照我给的顺序和入出点 / 横版素材裁切填满 9:16 / 成片按竖屏 9:16 交付） | “只用音乐床，丢弃素材原声”、“严格照我给的顺序和入出点” | `behavior:"allow", answers:2` | `isError:false, terminal:"ok"` | thinking：**“The user kept: 1. 只用音乐床，丢弃素材原声 → project scope … 2. 严格照我给的顺序和入出点 → user scope … Not kept: no captions/overlays, local-no-paid, crop-to-fill, vertical 9:16.”**；assistant_text：**“Got it — two rules kept. Writing them now.”** |

qcardQ1 的事件链（`qcardQ1-events.jsonl`，UTC 时间戳原样保留，+8 h 即本地时间）：

```
09:28:55.776 permission:request  kind=question tool=AskUserQuestion requestId=7c5cff05… toolUseId=call_01a15dcac8…
09:28:58.375 permission_resolved requestId=7c5cff05…          ← 真实点击 .q-submit 之后
09:28:58.376 main log: agent.permission.response behavior="answers"
09:28:58.376 main log: agent.permission.decision tool=AskUserQuestion behavior="allow" answers=2
09:28:58.382 tool_end toolUseId=call_01a15dcac8… isError=false terminal=ok
09:29:13.516 thinking "User kept only: 1. Music-only audio … 2. Center-crop to fill 9:16 …"
09:29:13.776 assistant_text "Locked: music-only audio and center-crop to fill 9:16. …"
09:29:15.041 port_runtime closed (reason=dispose)               ← --stop-after card，按设计在确认后停止
```

对比 docs/23 的 devD2（修复前）：同样的 taste 卡片作答后，代理的 thinking 是 “The user declined the question … "declined this step"”。修复后三次 run 中代理都复述了所选的具体选项，没有出现对问题本身的拒答。截图：`qcardQ1-shots/09a-question-card-1.png`（卡片）、`09b-…-selected.png`（两项已选中，高亮）、`09-after-taste-turn.png`（“Locked: …”）。

### A.3 驱动器判定的一次误报（如实记录）

- qcardQ1 运行时驱动器给出的 `taste_question_card` 判定是 **FAIL**（`allPass=false`），原因是 `declinedMentioned=true`。
- 查证：当时的正则是宽泛的 `/declin|…/`，命中的是代理 thinking 里**引用的 taste 文件标题** “`## ANTI-COMMITMENTS (declined proposals — do not re-raise)`”，不是拒答。其他四项（permission_resolved、tool_end ok、decision allow/answers=2、所选两项均被复述）全部成立。
- 修正：拒答判定移到 `ui-e2e/plan.mjs` 的 `DECLINE_RE` / `answerDeclined`，只匹配 SDK deny 文案（“declined this step” / “Denied by user”）以及代理对**问题本身**的拒答转述（“user declined the question”、“question was declined” 等）。多选题中未勾选的选项被代理说成 “the user declined "No captions…"” 属于正常作答，不算拒答（qcardQ1 的 thinking 里正好有这句）。`test/ui-e2e.test.ts` 新增 1 个测试，正例为 devD2 原文和 “Denied by user”，反例为上述两段 qcardQ1 文本。
- `port/tools/ui-e2e/reverdict.mjs qcardQ1` 用新正则对已收集的 qcardQ1 证据重新判定，结果为 `accepted=true, declinedMentioned=false`，写入 `qcardQ1-answer-reverdict.json`（同时保留了旧正则命中的上下文和运行时原始判定）。qcardQ1 的原始 summary 没有改动。
- qcardQ2 是收窄正则之后重跑的一次：运行时判定直接为 **PASS**（`taste_question_card.ok=true`，`allPass=true`）。用的是中间版正则（`(user|you) declined\b`，未要求宾语是 question/step），代理文本中没有命中；最终提交版 `DECLINE_RE` 下 `reverdict.mjs qcardQ2` 也给出 `accepted=true`（`qcardQ2-answer-reverdict.json`）。代理还写出了 “Not kept: …”，把没选的四项一一列出，说明它读到的是逐项答案，而不是笼统的 allow。

### A.4 结论

**已验证**：修复后，用户在原版问题卡上通过真实鼠标事件作答，main 将 `behavior:"answers"` 映射为 `allow` 并附带 `updatedInput.answers`，SDK 的 AskUserQuestion `tool_end` 为 ok，代理按所选内容继续工作，没有再出现 “user declined”。
**未验证**：taste 规则最终落盘。为控制花费，run 在代理确认答案后即停止，代理还没把 COMMITMENTS 写进 taste 文件。另外每次都只选每题的第一个选项，没有测 “Other…” 自由文本和单题多选多项。

### A.5 M6 代码上的完整 S1 run 一览（真 UI，dev）

| run | 时间（UTC+8） | 主回合 | 原生播放 | sha(final)=sha(v1)=sha(export) | ffprobe | E1–E15 | taste 回合 |
|---|---|---|---|---|---|---|---|
| devA1 | 16:43:09–17:10:58 | 1295 s，62 次工具调用，isError=false | +2.592 s，720×1280 | `1ea15d39…1c9fe9` | rc 0 | `failed=[]` | 开始了，但 361 s 内代理一直在查 taste 文件，没走到 AskUserQuestion；按 `--taste-wait-ms` 默认 6 min 结束（当时的驱动器也还没有本节的作答逻辑） |
| qcardQ1 | 17:20:57–17:29:15 | 388 s，23 次工具调用 | +2.592 s，720×1280 | `a6db779e…7f51f7` | rc 0 | `failed=[]` | 批准后约 80 s 出卡 → 作答 → 确认 → 停止 |
| qcardQ2 | 17:32:08–17:46:08 | 544 s，30 次工具调用 | +2.546 s，1080×1920 | `e6ff9742…84c7b5` | rc 0 | `failed=[]` | 批准（17:41:20）后约 4 min 16 s 出卡 → 作答 → 确认 → 停止 |

为了让 taste 卡来得及出现，qcardQ1/Q2 把 `--taste-wait-ms` 放宽到 20 min，并配合 `--stop-after card` 使用。MiniMax 全程并发 1：同一时刻只跑一个 run，代理请求经 gate proxy 发出。

## B. 两个渲染器 TypeError：根因与修复

| | L31748 | L39778 |
|---|---|---|
| 报错 | `TypeError: Cannot read properties of undefined (reading 'find')` at `index-D5K1mOs0.js:31748:24` | `TypeError: Cannot read properties of undefined (reading 'length')` at `index-D5K1mOs0.js:39778:18` |
| 原版渲染器代码 | 首启 / 新视频引导组件的 `useEffect`：`window.videoclaw.charactersList(cwd2).then((list2) => { … list2.find((c) => c.state === "approved" && c.isSelf) … })` | 激活视频时的 `useEffect`：`window.videoclaw.getHistory(activeId).then((events) => { … if (events.length === 0) return; … })` |
| 根因 | port 的 `characters:list` 是 stub，返回 `undefined`；原版 main 返回的永远是数组（`host.listCharacters(absCwd(cwd))` → `CharacterStore.list`，L61860 / L45016） | port 的 `session:history` 是 stub，返回 `undefined`；原版 `getHistory`（L43698）永远返回数组 |
| 修复 | `characters:list` 接入 **verbatim** 原版 `CharacterStore`（`gen-verbatim.mjs` 新增 spec → `characters/character-store.generated.ts`，L11564–11792），外面套原版 `exposeCharacters`（L60415，把 sheet/refs 授权给 vcmedia）和 `absCwd`（L60293）。空工作区返回 `[]` | `session:history` → `AgentHost.getHistory`。port 不持久化 SDK session（`meta.sdkSessionId` 从不设置），因此每个视频都走原版 `!s.meta.sdkSessionId` 分支：`historyToEvents([], …)` = `[]`。未知 id 与原版 `mustGet` 一样抛错。transcript 回放未移植，所以覆盖表里记为 `real-partial` |
| 单测 | `m6-channels.test.ts`：渲染器 L31748/L39778 的消费点断言；`characters:list` 返回数组（空 → `[]`；approved + pending 带 sheet/refs） | `m6-channels.test.ts`：无 SDK transcript 的视频返回 `[]`；未知 id reject |

**before / after 控制台证据**（驱动器监听 `Runtime.exceptionThrown` / `console.error`，写入 `console.jsonl`，并在 summary 中计数）：

| run | 代码 | consoleErrorCount | L31748 | L39778 |
|---|---|---|---|---|
| **bootB0before** | 95e0250 基线工作树（`<EXTRA>`），同一驱动器，`--check-quickstart --stop-after attach` | **2** | **1** | **1** |
| bootB1 | M6 工作树，同参数 | 0 | 0 | 0 |
| devA1 | M6，完整 S1 8 步 + taste 回合（16:43–17:10） | 0 | 0 | 0 |
| qcardC1 / qcardQ1 / qcardQ2 | M6（含问题卡作答） | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

`bootB0before-console.jsonl` 中这两条异常分别出现在 t=23510 ms 和 t=24099 ms（创建视频、附件之后）。

## C. Quickstart 目录与视频标题

### C1. `quickstart:catalog`

- **修复前**：stub，返回 `undefined`。原版画廊一直停在 “Loading Quickstarts…”。bootB0before 中 `steps.quickstart_catalog = {ok:false, loading:true, cards:[]}`，见 `bootB0before-shots/01b-quickstarts.png`。
- **修复**（`quickstart/quickstart-ipc.ts`，`quickstart-catalog.generated.ts` 为 verbatim）：
  - 由原版 `QuickstartCatalogStore`（L30772，含 `validateRawCatalog` / `validateRoot`、latency ring、channel verifier、`canonicalStudioJson`）提供目录。
  - candidate roots 与原版 L61015–61041 相同，另加一个 PORT-NEW dev root `<port>/../app/resources/quickstarts`；打包时由 `packaging-config.mjs` 把它作为 `extraResources` 放到 `resources/quickstarts`，这正是原版自己的 root。
  - 预览图走 `mediaCapabilities.grant(path,"quickstart")` → `vcmedia://`。
  - warm 命中时后台刷新，视图变化则推送 `quickstart:catalogChanged`（L61215–61250）。
  - 签名远程通道需要 gateway key，port 没有账户服务，因此走原版的无 key 分支（只用 bundled 目录）。
- **修复后**：bootB1 / devA1 中 `steps.quickstart_catalog.ok=true, loading:false, error:null, cards:["Founder camera story"], images:3`，devA1 的筛选为 `["All","Founder Story"]`。bundled `catalog.json` 中 `starters` 正好只有 1 个，所以 1 张卡片就是正确结果。
- **单测**：冷 / 暖两次读取；没有有效 root 时 reject（渲染器显示错误卡片，而不是永远 Loading）；packaging 的 extraResources 断言。

### C2. 视频标题

- **修复前**：port 从不改标题，侧栏一直显示 “New video”。
- **修复**（`agent-host.ts` `sendMessage` → `nameSession`，`session-title.generated.ts` 为 verbatim）：
  - 首次发送时按原版 L41460–41476 / L41776，标题变为 `fallbackSessionTitle(text)`，`titleOrigin:"fallback"`。
  - 原版只在 `claude-code` 路由且有 claude.ai 订阅登录时才请求模型起名（`proposeSessionTitle` L23002）。box 上没有这个条件，所以 port 对 PORT-NEW provider 路由（minimax）发同样的请求：相同的 system prompt（单测与 bundle 逐字节比对）、同样 ≤600 字符的脱敏用户文本、同样的结果校验。这是一次 `sessionHelperComplete` helper 调用，走 provider 的全局闸门（MiniMax 并发 1）。
  - 结果合法则 `titleOrigin:"automatic"`；失败、被取代或被中止时保留 fallback。`VIDEOCLAW_PORT_PROVIDER_TITLES=0` 可关闭。claude-code 订阅路径未移植。
- **证据**：

| run | 标题序列（`session:changed`） | 侧栏 DOM |
|---|---|---|
| devA1 | `New video` → `fallback: 我有三段短素材和一段配乐。…` → **`automatic: 三段素材竖屏快剪`** | ✅ |
| qcardQ1 | `New video` → fallback → **`automatic: 六秒半竖屏快剪`** | ✅（截图左栏可见） |
| qcardQ2 | `New video` → fallback → **`automatic: 三段素材六秒半竖屏快剪`** | ✅ |

- **单测**：首次发送先 fallback，再接受一次 proposal；claude-code 路由保留 fallback；opt-out；proposal 失败、被拒或被中止时保留 fallback。

## D. IPC 覆盖（`python3 tools/ipc_coverage.py`，2026-10-21 重新运行）

新增类别 `real-partial`：handler 是真实实现，返回形状与原版一致，但只移植了部分分支（在脚本的 `PARTIAL` 表里列出原因）。

| 类别 | docs/23 | **docs/24** | 变化 |
|---|---|---|---|
| real | 33 | **35** | +`characters:list`、+`quickstart:catalog` |
| real-partial | — | **1** | `session:history`（只有 `[]` 分支，transcript 回放未移植） |
| real-env | 1 | 1 | |
| fixture | 7 | 7 | |
| stub | 119 | **116** | −3 |
| push-real | 7 | **8** | +`quickstart:catalogChanged` |
| push-none | 16 | **15** | −1 |
| local | 1 | 1 | |
| 合计 | 184 | 184 | |

按组：`quickstart` 6 个中 real 1、push-real 1、stub 4；`characters` 14 个中 real 1、stub 11、push-none 2；`session` 17 个中 real 5、real-partial 1、push-real 2、stub 9。

## E. 测试与构建

- `npm test`（port/，node:test）：**220/220 通过**（docs/23 为 210）。新增：`test/m6-channels.test.ts` 9 个（L31748/L39778 消费点、characters:list、session:history、quickstart 冷/暖/无 root、标题 helpers 与 prompt 逐字节比对、AgentHost 起名、claude-code / opt-out / 失败保留 fallback、proposal 被拒/中止）；`test/ui-e2e.test.ts` 1 个（`answerDeclined`）。`packaging.test.ts` 中加了 quickstarts extraResources 断言（不新增测试数）。
- `npm run build`（gen-verbatim + typecheck + bundle）：通过。gen 可重复执行，重跑后 generated 文件没有差异。

## F. 复现

```bash
cd port && npm run build
node tools/ui-e2e.mjs --run /workspace/m6/X --engine-home <home> --check-quickstart --stop-after attach    # TypeError / 目录检查，$0
node tools/ui-e2e.mjs --run /workspace/m6/Y --engine-home <home> --taste-wait-ms 1200000 --stop-after card # 完整 S1 + taste 卡作答
node tools/ui-e2e.mjs --run /workspace/m6/Z --engine-home <home> --brief-file card-brief.txt --stop-after card # 主回合问题卡（qcardC1）
cd .. && ARTIFACTS_PHASE=phase-b-m6 EXTRA_REDACT=<baseline worktree> tools/collect_m5.sh /workspace/m6/Y qcardQx
node port/tools/ui-e2e/reverdict.mjs qcardQx    # 用当前 DECLINE_RE 复核
```

qcardC1 用的 brief（`--brief-file`）：「动手之前，请先用 AskUserQuestion 工具问我一个单选问题：这条视频的成片画幅要「竖屏 9:16」还是「横屏 16:9」（就这两个选项）。等我在卡片上回答之后，用一句话复述我选了哪个，然后结束本回合，这一回合不要调用其他任何工具、不要开始剪辑。」

## G. 已验证 / 未验证 / 风险

**已验证**
- 问题卡由原版 UI 真实作答（单选 1 次、多选两题 2 次），答案以 allow+answers 被 SDK 接收（main decision、`tool_end` ok、代理复述所选），不再变成 “user declined”。docs/23 的头号未验证项就此关闭。
- 两个 TypeError 的根因是 stub 返回 `undefined`，现在两个通道都返回原版形状；before 各 1 次，after 在 bootB1、devA1、qcard* 中均为 0（consoleErrorCount=0）。
- 原版 Quickstarts 画廊能加载出 bundled 目录（修复前一直 Loading）。
- 视频标题在首次发送后由 “New video” 变为 fallback，再变为 automatic，侧栏可见。
- 完整 S1 8 步在 M6 代码上通过：devA1，以及 qcardQ1 / qcardQ2 的前 8 步。sha 链一致，E1–E15 `failed=[]`。

**未验证**
- taste 规则最终写入 COMMITMENTS（run 在确认后主动停止）；“Other…” 自由文本作答；同一题勾选多项。
- 驱动器对 qcardQ1 的运行时判定是 FAIL（误报，见 A.3），通过是事后用修正正则复核得出的。qcardQ2 的运行时判定为 PASS，但它使用的是中间版正则（见 A.3），不是最终提交版。
- `session:history` 的真实 transcript 回放（显示 transcript / SDK transcript / Codex），以及 `noteSessionOpened`。
- claude-code 订阅路由的原版起名路径（无 claude.ai 登录）。
- Quickstart 的签名远程通道（无 gateway key）；从卡片 “开始” 一个 quickstart 的后续通道（其余 4 个 `quickstart:*` 仍是 stub）。
- characters 的其余 11 个通道（创建 / 审批 / 删除等）仍是 stub。`characters:list` 只在空工作区上真实跑过，非空只有单测。
- 打包 AppImage 形态下的 M6 改动（quickstarts extraResources 只有单测，没有打包后再跑 UI）。
- 样本量：问题卡 3 次（全部 dev），TypeError after 6 次（全部 dev）。

**风险**
- 标题 proposal 是 PORT-NEW 行为：原版在这个 box 的条件下不会起名。它会额外发一次 MiniMax helper 请求；该请求走 provider 闸门，与代理串行，增加一点延迟和花费。可以用 `VIDEOCLAW_PORT_PROVIDER_TITLES=0` 关闭。
- 拒答判定仍是基于文本的启发式。现在主证据是 main 的 decision 日志和 `tool_end`，文本只作辅证，但代理措辞变化仍可能造成误报或漏报。
- `session:history` 永远返回 `[]`：重开旧视频时 transcript 是空的（与原版无 SDK session 的分支一致，但和用户预期不同）。
- devA1 的主回合耗时 1295 s，qcardQ1 为 388 s，MiniMax 回合耗时方差仍然很大。
- 原版 L37581 `"allow"` 分支里的 spend ceiling 处理仍未移植（spend 子系统还是 stub）。
