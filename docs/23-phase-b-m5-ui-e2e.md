# 23 · Phase B：M5，用原版 UI 跑通 S1 端到端（CDP 真实输入事件）

> 接 docs/22。docs/22 第 7 节留下的风险是：原版 UI 的真实点击，包括播放器控件、Approve 按钮、导出、拖拽附件，都还没被驱动过，当时走的是 `window.videoclaw` → preload → 真 IPC。M5 补的就是这一块。
> 代码：commit `8be2803`（`port/tools/ui-e2e.mjs`、`port/tools/ui-e2e/{cdp,plan}.mjs`、`tools/collect_m5.sh`、main 侧 `VIDEOCLAW_PORT_UI_E2E=1` 模式，以及 1 个 bug 修复和 7 个新单测）。
> 证据：`artifacts/phase-b-m5/`，已脱敏。路径替换为 `<RUN>` / `<REPO>` / `<APPIMAGE_ROOT>`，`MINIMAX_API_KEY` 的值在全部证据中命中 0 次。没有提交 mp4 或 sqlite，只提交了 PNG 截图、JSON/JSONL、日志和 sha256。
> 时间均为 Asia/Singapore（UTC+8），2026-10-21。

## 0. 一览

| 项 | 结论 | 证据 |
|---|---|---|
| 用原版渲染器 UI 跑 S1 全 8 步（dev） | ✅ 2/2：devD1、devD2 `allPass=true`，`fallbacksToIpc=[]` | `devD{1,2}-ui-e2e-summary.json` |
| 用原版渲染器 UI 跑 S1 全 8 步（打包 AppImage） | ✅ 1/1：pkgP1 `allPass=true`，`mode=AppImage`，`fallbacksToIpc=[]` | `pkgP1-ui-e2e-summary.json` |
| 附件按钮 → `intake:pickFiles` 路径（只跑到 attach 为止） | ✅ pickerK1：`via=picker`，4 个文件 ready，`stopAfter=attach` | `pickerK1-ui-e2e-summary.json` |
| 原生播放器真实播放 | ✅ 3/3：currentTime 前进约 2.6 s，readyState 4 | summary `steps.play` |
| Approve V1 | ✅ 3/3：`finalizedAtMs` 已写入，versions.json 中 final n=1 via=promote | summary `steps.approve`、`*-versions.json` |
| 导出：sha(final)==sha(v1)==sha(export)，ffprobe rc 0 | ✅ 3/3 | `*-sha256.txt`、`*-export.ffprobe.json` |
| S1 验收（E1–E15 + A1…） | ✅ 3/3：`failed=[]`、`pending=[]` | `*-accept.json` |
| 发现并修复的 bug：`permission:respond` 的 `behavior:"answers"` 被当成 deny | ✅ 已修复，有单测覆盖 | devD2 证据（复现）+ `engine-session.test.ts` |
| 修复后用真 UI 重跑问题卡 | ❌ **未做**：devD2 / pkgP1 都在修复提交之前运行 | — |

## 1. M5 做了什么

- **`VIDEOCLAW_PORT_UI_E2E=1` 模式**（main，`port/src/main/index.ts`、`renderer-entry.ts`）：
  - 始终加载原版渲染器，main 不注入任何脚本。
  - 只替换原生对话框：`smokeDialog` 在该模式下用 `VIDEOCLAW_PORT_SMOKE_SAVE_AS` / `VIDEOCLAW_PORT_SMOKE_PICK_FILES` 应答。`showItemInFolder` 只记日志。
  - 在窗口打开前用 `settings:set` 预置 LLM 路由（`VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax`），原因见第 6 节。
- **驱动器 `port/tools/ui-e2e.mjs`**（PORT-NEW）：
  - 通过 `--remote-debugging-port` 连接页面 target。
  - **所有动作都是 CDP `Input.*` 事件**：`Input.dispatchMouseEvent`（press/release/move/hover）、`Input.insertText`、`Input.dispatchKeyEvent`、`Input.dispatchDragEvent`（`DragData.files` 携带真实文件）。原版 React 的事件处理器因此照常触发。
  - 页面求值只做只读用途：读元素几何、DOM 和 `<video>` 状态。驱动器**从不调用 `window.videoclaw`**。
  - main 侧效果一律从磁盘核对：sessions.json、versions.json、events JSONL、job 目录、导出文件。
- **辅助模块**：`ui-e2e/cdp.mjs` 是最小 CDP 客户端（按 id 关联请求，封装 mouse、insertText、drag、screenshot）；`ui-e2e/plan.mjs` 提供几何计算、原生播放键定位、播放判定和证据脱敏，这些纯函数都有单测。
- **`tools/collect_m5.sh RUN_DIR NAME`**：
  - 把一次运行的证据收进 `artifacts/phase-b-m5/<NAME>-*`，同时做路径脱敏。
  - 跑 `accept_check.py`，计算 sha256，导出 versions/sessions。
  - 若 key 命中数不为 0，以 exit 3 拒绝；若证据里出现 mp4/sqlite/db，以 exit 4 拒绝。

CDP 日志中记录到的调用只有以下几类：

| run | Input.dispatchMouseEvent | Input.insertText | Input.dispatchDragEvent | 其他 |
|---|---|---|---|---|
| devD1 | 34 | 2 | 3 | Page.enable / Runtime.enable / Browser.close |
| devD2 | 37 | 2 | 3 | 同上 |
| pkgP1 | 31 | 2 | 3 | 同上 |
| pickerK1 | 19 | 1 | 0 | 同上 |

## 2. 真实驱动的原版 UI 元素

全部来自 summary 的 `driven` 字段：

| # | 原版元素 | 驱动方式 | 用到它的 run |
|---|---|---|---|
| 1 | 引导 “Skip tour”（`button.tour-skip`） | `Input.dispatchMouseEvent` 点击 | 全部 |
| 2 | 侧栏 “Create project” +（`button.new-client`） | 点击 | 全部 |
| 3 | 建项目对话框名称框（`input.new-client-input`） | 点击 + `Input.insertText` | 全部 |
| 4 | 建项目对话框 “Create”（`button.pd-save`） | 点击 | 全部 |
| 5 | 侧栏 “New video in S1 UI e2e”（`button.client-new-chat`） | hover + 点击 | 全部 |
| 6 | composer 拖放区（原版活动视频的 window 级 drop 处理器，落点在 composer 上） | `Input.dispatchDragEvent` dragEnter/dragOver/drop，`DragData.files` 带 4 个真实文件 | devD1、devD2、pkgP1 |
| 6′ | composer “Add footage, images, audio…”（`button.attach-btn`） | 点击 → 原版 `intake:pickFiles` → 打开对话框（env 预设应答） | pickerK1 |
| 7 | composer 文本框 | 点击 + `Input.insertText(brief)` | devD1、devD2、pkgP1 |
| 8 | composer Send（`button.send-btn`） | 点击 | devD1、devD2、pkgP1 |
| 9 | Output 面板原版播放器（`.op-preview-stage` 内的 `<video controls>`）原生播放键 | 点击控件条上播放键的位置 | devD1、devD2、pkgP1 |
| 10 | “Approve V1”（`button.v-approve`） | 点击 | devD1、devD2、pkgP1 |
| 11 | Output 面板 “Download v1.mp4”（`button.op-preview-download`） | 点击 → 原版 `file:saveItemAs` → 保存对话框（env 预设应答） | devD1、devD2、pkgP1 |
| 12 | AskUserQuestion 卡片（`.question-card`）：每题选第一个 `.q-option`，再点 “Answer”（`.q-submit`） | 点击 | devD2 |
| 13 | taste-capture 回合中被识别为 “Stop” 的 `primary` 按钮 | 点击 | devD1（见第 8 节风险） |

截图在 `*-shots/`，顺序为 01 首页 → 02 新视频 → 03 附件 → 04 已输入 brief → 05 流式中 / 05b 回合结束 → 06 播放中 → 07 已批准 → 08 已导出，以及 09 taste 回合（devD2 另有 09a 问题卡）。

## 3. 各 run 的 8 步判定

| run | 形态 | 时间（UTC+8） | home | 建项目 + New video | 附件（真实拖放） | 输入 + Send | 代理流式 | 原生播放 | Approve V1 | 下载导出 | allPass |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **devD1** | dev | 15:42:46–15:48:40 | ✅ | ✅ | ✅ drop，4/4 ready，已落 store | ✅ typedMatches | ✅ 335 s、27 次工具调用、28 turns、isError=false | ✅ +2.606 s，rs 4 | ✅ | ✅ | **✅** |
| **devD2** | dev | 16:11:04–16:19:16 | ✅ | ✅ | ✅ drop，4/4 ready | ✅ | ✅ 381 s、34 次工具调用、35 turns | ✅ +2.598 s，rs 4 | ✅ | ✅ | **✅** |
| **pkgP1** | AppImage | 15:54:03–16:09:43 | ✅ | ✅ | ✅ drop，4/4 ready | ✅ | ✅ 568 s、39 次工具调用、40 turns、90 个 text delta | ✅ +2.605 s，rs 4 | ✅ | ✅ | **✅** |
| pickerK1 | dev | 15:55:42–15:55:46 | ✅ | ✅ | ✅ **picker**，4/4 ready | — | — | — | — | — | ✅（按设计只跑到 attach） |

- 回合进行中，三次 run 都看到 Send 按钮切换成 `send-btn stop`（title “Stop”），这是原版的运行中控件。
- gate proxy：maxInflight=1，rejected=0。请求数为 devD1 42、devD2 63、pkgP1 63。
- pickerK1 的 `99-error.png` 并不是错误。驱动器在 `--stop-after attach` 时会抛出 planned stop，进入 catch 分支后也会截一张同名图。该图与 `03-attachments.png` 字节相同，summary 中没有 `error` 字段。
- pickerK1（15:55）和 pkgP1（15:54–16:09）在时间上有重叠，两个 app 实例同时存在过。pickerK1 不发 LLM 请求，因此不影响 MiniMax 的并发 1 约束。

## 4. 播放证明

`steps.play` 中，播放器的 src 都是原版 `vcmedia://local<RUN>/Videoclaw/jobs/<job>/versions/v1.mp4?consumer=primary-preview-N&version=<sha>`，`controls=true`。驱动器点击原生播放键之后多次采样，判定条件是：未暂停、readyState 达到 4、currentTime 前进超过 0.5 s、没有 error。

| run | advancedS | maxReadyState | duration | 尺寸 |
|---|---|---|---|---|
| devD1 | 2.606 | 4 | 6.507 | 720×1280 |
| devD2 | 2.598 | 4 | 6.507 | 720×1280 |
| pkgP1 | 2.605 | 4 | 6.549333 | 1080×1920 |

`06-player-playing.png` 中可以看到原版控件处于暂停图标（即正在播放）状态，时间为 0:01 / 0:06。

## 5. 批准与导出证明

- **Approve**：点击 `button.v-approve` 后，`finalizedAtMs` 被写入：devD1 1792568909625、devD2 1792570653390、pkgP1 1792569818785。`versions.json` 的 finals 为 `[{n:1, via:"promote"}]`，`v1Approved=true`。UI 中出现 “✅ V1 approved” 和 “This video is finalized”（见 `07-approved.png`）。
- **Export**：点击 `button.op-preview-download` 后，走原版 `file:saveItemAs`，保存对话框由 env 应答，main 真实复制文件到 `<RUN>/export/s1.mp4`。`saveDialogLog=true`。

| run | sha256(final) = sha256(v1) = sha256(export) | ffprobe rc | 视频 | 音频 | 时长 |
|---|---|---|---|---|---|
| devD1 | `f366c606…098779`（三者相同） | 0 | h264 720×1280 30/1 | aac | 6.507 s |
| devD2 | `898d9677…a683d`（三者相同） | 0 | h264 720×1280 30/1 | aac | 6.507 s |
| pkgP1 | `e64bd116…2c7e10`（三者相同） | 0 | h264 1080×1920 30/1 | aac | 6.549 s |

- `incoming/` 中 4 个附件与 `in/` 原件的 sha256 逐一一致（见 `*-sha256.txt`），说明附件确实经拖放进入了 job。
- `*-accept.json`：E1–E15 和 A1… 全部 ok，`failed=[]`。切点都在 2.5 / 4.5（E10），spend 为 0（E14），原件未被改动（E15）。
- pkgP1 的分辨率是 1080×1920，dev 两次是 720×1280。这是代理自己的选择（它说明 b 源片本身就是 1080×1920），属于 S1 允许的范围；E4 只要求竖屏 9:16。

## 6. 无法 headless 驱动的部分

| 项 | 原因 | 处理方式 |
|---|---|---|
| LLM 路由选择 | 原版首启 picker 只提供 Codex / Claude Code / credits。box 上唯一可用的代理路由是 PORT-NEW 的 minimax provider 路由，它不在原版 picker 里，所以无法用 UI 选中。 | 窗口打开前用 `settings:set` 预置（`VIDEOCLAW_PORT_SMOKE_LLM_ROUTE`）。截图里的 “Claude Code plan” 标签来自原版 UI，实际路由是 minimax（sessions.json 中 `llmRoute:"minimax"`）。 |
| `file:saveItemAs` / `intake:pickFiles` 的原生 GTK 对话框 | 这是渲染器之外的 OS 对话框，既不是 DOM 元素，也不能通过 CDP 访问。 | UI_E2E 模式下由 `VIDEOCLAW_PORT_SMOKE_SAVE_AS` / `_PICK_FILES` 应答。渲染器的按钮和 main 的复制都是真实执行的。 |

## 7. 驱动器发现并修复的 bug：`permission:respond` 把 “answers” 当成了 deny

- **现象（devD2）**：首次批准后，原版追加 taste-capture 回合，代理调用 `AskUserQuestion`。UI 弹出问题卡，驱动器选了 “Music-only audio track” 并点击 Answer。main 日志记录了 `agent.permission.response behavior:"answers"`，但代理随后的 thinking 是 *“The user declined the question … "declined this step"”*（`devD2-events.jsonl` 第 157 行左右）。也就是说，答案被转换成了 deny，返回的是旧的 deny 文案 “The user declined this step.”。
- **原因**：原版渲染器 `answerQuestion`（renderer L40098–40100）发送的是 `behavior:"answers"`（附带 `answers`/`selections`）。原版 main L37581 的处理是：`"answers"` → allow，`updatedInput:{...input, answers}`；`"allow"` → allow，用请求本身的 input；其余一律 deny。port 的 `AgentHost.respondPermission` 只认 `"allow"`，所以 `"answers"` 落到了 deny 分支。
- **修复**（`agent-host.ts`，在 8be2803 中）：按原版三分支实现，deny 的默认文案改为原版的 `"Denied by user"`。单测 `engine-session.test.ts` 改为发送原版形状 `{behavior:"answers", answers, selections}`，断言结果为 allow 且 updatedInput 为 `{questions, answers}`；另外新增裸 deny 的测试，断言返回 `"Denied by user"`。
- **说明**：devD2（16:11–16:19）和 pkgP1 都是在修复提交（16:21）之前运行的，所以**修复后的问题卡还没有用真 UI 重跑过**，目前只有单测验证。pkgP1 中问题卡出现了（有 permission.request），但没有作答；taste 回合等了 361 s 后由 teardown 结束。

## 8. 测试、构建与覆盖

- `npm test`（port/）：**210/210** 通过（docs/22 为 203，新增 7 个）。`test/ui-e2e.test.ts` 新增 6 个：
  - UI_E2E 模式用 env 应答对话框，否则使用真实对话框；
  - CDP 客户端的 id 关联、错误、事件、按值 eval，以及 socket 关闭时拒绝挂起请求；
  - Input.* 辅助函数（鼠标 press/release、insertText、Enter 用 `\r`、带文件的 OS 拖放）；
  - 几何计算与判定辅助函数；
  - 证据脱敏；
  - 驱动器 `node --check`。

  另有 `engine-session.test.ts` 新增一个 deny 断言，见第 7 节。
- `npm run build`（gen + typecheck + bundle）：通过。
- IPC 覆盖（`python3 tools/ipc_coverage.py`，2026-10-21 重新运行）：184 个通道中 real 33、real-env 1、fixture 7、stub 119、push-real 7、push-none 16、local 1，**与 docs/22 相同**。M5 没有新增 IPC handler，它的价值在于证明已有的 real 通道（`client:create`、`session:create/send`、`attachment:*`、`intake:pickFiles`、`job:snapshot`、`version:approve`、`file:saveItemAs`、`permission:respond` 等）可以由原版 UI 本身触发，而不是经 `window.videoclaw` 直接调用。

## 9. 复现

```bash
cd port && npm run build
node tools/ui-e2e.mjs --run /workspace/m5/runX --engine-home <home-with-installed-engine>              # dev
node tools/ui-e2e.mjs --run /workspace/m5/runY --engine-home <home> --appimage <path/to/AppImage>      # 打包
cd .. && tools/collect_m5.sh /workspace/m5/runX devDx    # 脱敏收集；key 命中数不为 0 / 出现 mp4 时拒绝
# 需要 env 中有 MINIMAX_API_KEY（不会打印）；一次只跑一个 LLM run
```

## 10. 已验证 / 未验证 / 风险

**已验证**
- 原版渲染器在 dev 和打包 AppImage 两种形态下，都能由外部 CDP 真实输入事件驱动，完成 S1 全 8 步（3/3 allPass，`fallbacksToIpc` 为空）。
- 真实 OS 拖放附件（3 次）和附件按钮 → pickFiles（1 次）都能把文件送进 job `incoming/`，sha 与原件一致。
- 原生播放器能真实播放，Approve V1 能落盘，Download 后的导出文件 sha 与 v1/final 一致，ffprobe rc 0。S1 验收 E1–E15 全部通过。
- `permission:respond "answers"` 的 bug 在真实运行中复现，已按原版 L37581 修复，并有单测覆盖。

**未验证**
- 修复后的问题卡回答还没有用真 UI 重跑：没有一次真实 run 证明代理收到了 answers 并据此写入 taste 规则。
- pkgP1 的 taste-capture 回合没有结束（等待 361 s 后被 teardown 结束），问题卡也没有作答。
- 原生 GTK 对话框本身（由 env 应答）。
- 原版首启路由 picker 的真实选择（minimax 不在其中）。
- Claude / Codex 路由（没有凭据）。
- Windows / macOS 形态。
- 无路由提示的忠实路径。
- 样本量：dev 2 次、AppImage 1 次。

**风险**
- **devD1 的 taste 处理可疑**：驱动器在 taste 回合中点击了一个被识别为 “Stop” 的控件，但它的 `cls` 是 `primary`，`title` 是 “Finish or stop the current step first.”，看起来更像 finalized 横幅里的 Start New Video 一类按钮，而不是真正的停止键。devD2 / pkgP1 中 `stopControlVisibleWhileFinalized=false`。这不影响 8 步判定，但 devD1 的 taste 段落不能作为证据使用。
- **渲染器控制台报错**：所有 run 都有原版 bundle `index-D5K1mOs0.js:31748`（`.find` of undefined）和 `:39778`（`.length` of undefined）抛出的 TypeError。功能未受影响，但很可能说明 port 某些 stub 通道返回的数据形状和原版不一致。尚未定位。
- 原版 L37581 的 `"allow"` 分支还包含 `spendPolicyCeilingUsd` → `setSpendCeiling` / `amount_usd` 的处理，port 修复时没有移植这一段，因为 spend 子系统仍是 stub。
- 原生播放键是按 Electron 42 控件布局用固定偏移定位的（`nativePlayButton`），Electron 升级后可能失效。
- MiniMax 回合耗时方差大（335–568 s），偶发超时的可能性没有排除。
