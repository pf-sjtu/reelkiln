# 43. M26：产品内 agent 为什么撞上 44 分钟上限；修复后在产品内完整跑通

日期：2026-10-23（SGT）。只在 box 上运行；`MINIMAX_API_KEY` 只从环境读取，从未打印或提交；并发为 1。
成片：`/workspace/share/reelkiln-m26-inproduct.mp4`（box 本地，不入库）。证据：`artifacts/phase-b-m26/`。

## 1. 结论
- **根因（port 自己引入）**：M25 的那一轮不是被原版的什么限制停下的，而是被 port 自己加的**每轮墙钟计时器**停下的。
  - 该计时器在 port 提交 33b87bf（M2）引入，引擎会话默认 20 分钟，M25 的 harness 又把它设成了 44 分钟（2640 s）。
  - 原版 `app/out` 没有每轮墙钟上限，也没有停滞看门狗。
  - 原版的引擎会话也**不设 `maxTurns`**，只有生成标题的辅助查询用了 `maxTurns: 1`。port 给引擎会话默认设了 `maxTurns: 120`。M25 在 44 分钟里发了 106 次代理请求，所以即使没有计时器，一条完整制作也很可能撞上这个 120。
- **修复**：两者都改为可选（opt-in），默认不设，与原版一致。另外修了一个计量漏洞（见 §3）。
- **复跑**：同一份 M25 brief、同一批 M25 素材（未重新生成），走原版 UI → AgentHost → 引擎 → MiniMax-M3.1-Flash。
  - 18 分钟内完成了拼装、字幕烧录、渲染和引擎 review，之后在 UI 里依次通过了播放、Approve V1 和导出。全程没有人工补做。
  - 例外：这一轮在 agent 自查字幕时序的最后阶段，被**额度规则**（general 窗口 <30%）由看门狗点 Stop 停下了。详见 §5。

## 2. M25 时间线（来自 SDK transcript）

| 时间 (SGT) | 事件 |
|---|---|
| 13:52–14:07 | 约 15 分钟在读引擎和 Remotion 源码，弄清字幕怎么按「2–4 个词」分组 |
| 14:06 | `propose_session_plan` 被拒两次（约 20 s），原因见 §4 |
| 14:07 | 第一次 minterpolate（mci + aobmc，preset slow）撞上 SDK Bash 默认的 2 分钟超时 |
| 之后 | 做基准测试：2 s 的输出要 43 s；第 1 段慢放耗时 3:40 |
| 14:16:54 | 同时发起 3 个「并行」Bash，分别在 14:23:42、14:29:21、14:31:56 结束。Claude Code SDK 会把非只读 Bash 串行执行，原版也是一样 |
| 之后 | 输出时长短了 3–4 帧，agent 用 `-frames:v` 重编码 |
| 14:36:00 | 到 2640 s，被 port 的计时器停下 |

- **为什么这么慢**：ffmpeg 的 minterpolate（mci）是单线程的，在 8 vCPU 的 box 上 user 时间约等于 real 时间，每输出 1 秒约要 21 秒。
  - 引擎的 `assemble.py` 对视频段只做裁剪，不做变速；引擎的 skills 里也没有慢放或 minterpolate 的指引。
  - 所以选 mci 是模型和 brief 共同决定的，并且受 CPU 限制。原版在同一台机器上也会一样慢，区别只在于原版不会在 44 分钟时把它停掉。
- M26 复跑中，agent 自己判断「MCI interpolation is too slow for this clip length」，改用了 blend 模式，5 个慢放片段大约 1 分钟就做完了。

## 3. 改了什么（都有测试）
- `port/src/main/agent/agent-host.ts`
  - 每轮计时器改为只在显式传入 `turnTimeoutMs` 时才启用，默认不计时。
  - 引擎查询只在显式传入 `maxTurns` 时才带上它，默认不传。非引擎路径的 `maxTurns ?? 8` 没有改动。
  - `teardownRuntime` 现在会先对代理已记录的上游用量计一次费。旧逻辑只在收到 SDK `result` 时才计费，所以如果一个 runtime 在超时、重置等没有 `result` 的情况下被回收，`totalCostUsd` 会一直是 0。这正是 M25 的计费是 0 的原因。
    - 计费沿用原来的 max() 合并，不会重复计算。
- `port/src/main/real-backend.ts`：新增环境变量 `VIDEOCLAW_PORT_MAX_TURNS`（可选），和已有的 `VIDEOCLAW_PORT_TURN_TIMEOUT_MS` 放在一起。两者都是 PORT-NEW。
- `port/tools/ui-e2e.mjs`
  - `--turn-timeout-ms` 现在只控制 harness 自己等多久，默认不再把它传给 app。需要给 app 设上限时用 `--app-turn-timeout-ms`。
  - harness 等待超时后会先点原版输入框的 **Stop**（`button.send-btn.stop`），等这一轮结束、并且 main log 里出现该会话的 `agent.spend.metered`，然后才走正常退出流程。原版 QuitCoordinator 的退出对话框行为保持不变。
  - 如果一轮以 error 结束（例如 SDK 或引擎没能启动），没有 `result` 时会立刻失败，不再空等到上限。
  - 新增辅助函数 `plan.mjs: lastSpendMetered`。
- 测试
  - `engine-session.test.ts`：引擎轮默认没有计时器、没有 `maxTurns`；显式设置时仍然生效。
  - `agent-host.test.ts`：没有 `result` 时 teardown 仍会计费，且不重复计费。
  - `ui-e2e.test.ts`：覆盖 `lastSpendMetered`。
  - `npm test` 结果：377 个测试，366 通过，0 失败（其余跳过）。
- **现场验证**：M26 看门狗点 Stop 后，main log 在 35 ms 内写出了 `agent.spend.metered`，金额 0.5067 USD，来源为 proxy meter。

## 4. `propose_session_plan` 被拒（次要问题，与原版一致）
- 原因：harness 没有已验证的账号，`accountService.currentProjectMemoryScope()` 返回 null，于是 `memoryBinding` 抛错；本地网关 shim（`VIDEOCLAW_PORT_LOCAL_GATEWAY`）没有开启。
- 原版在未验证账号时也是这样。
- 离线复现：给一个合法的 64 位十六进制 `canonicalKeyId` 绑定后，M25 的两份 plan 都能正常提交。
- agent 遇到拒绝后直接开始制作（「The plan card was declined … go straight to the build」），不影响结果。

## 5. M26 复跑结果
- 前两次尝试没有调用 LLM，都是因为 box 被回滚到旧快照后丢了运行依赖：
  - 第 1 次：`vendor/claude-agent-sdk` 丢失。用 `npm run agent-sdk:install` 重新安装。
  - 第 2 次：引擎的 `.venv`、`remotion/node_modules`、`hyperframes/node_modules` 丢失。按 bootstrap 的同样步骤重建：`uv sync --frozen`、`npm ci`、`npx remotion browser ensure`。
- 第 3 次（run3）：13:27:16Z 发送 brief，13:45:41Z 被停下，共 1092 s。
  - 过程：99 次工具调用，依次完成慢放、配乐处理、`assemble.py`（混音 -14.4 LUFS）、`compose_render`（字幕烧录）、ffprobe/ebur128/抽帧自查、`review_render`。
  - 被停时 agent 正在微调字幕的切换时序。
  - 之后 UI 中依次通过：play PASS、Approve V1 PASS、export PASS（sha 链一致：final = v1 = export）。
  - `reply_link` FAIL：agent 在发出带内嵌视频的回复之前就被停下了。
- **额度规则**
  - 21:45:41 SGT general 降到 29%，看门狗按规则点了 Stop。
  - **违规说明**：之后 harness 照常驱动了批准后的 taste 问卡，这一轮又发了 14 个 SDK turn，计费 0.058 USD。这是在 general <30% 之后发生的。下次看门狗应该同时终止 harness。
- **成片校验**（`export/s1.mp4`）
  - 视频：h264 High，1080x1920，30 fps，1311 帧，43.70 s。
  - 音频：aac 48 kHz 单声道。
  - 响度：-14.3 LUFS integrated，LRA 2.9 LU，峰值 -1.3 dBFS。
  - blackdetect 为 0。freezedetect（>0.6 s）有 1 处：25.5–26.2 s。这是素材 `04-vampire-squid.mp4` 开头本身就有 0.875 s 静止，慢放后被拉长，不是 port 造成的。
  - 抽帧：开头直接是发光的诱饵，没有标题卡；字幕白色粗体、每次 2–4 个词、在中下部安全区内；片尾静帧有推近。见 `run3-export-frames-grid.png`。
- **花费**：0.5646 USD（主轮 0.5067 + taste 轮 0.0579），按 models.dev 的 MiniMax-M3.1-Flash 价格，由 proxy meter 计量。
- **额度**：开始时 general 50%、weekly 100%；结束时 general 26%、weekly 100%。窗口在 2026-10-24 00:00 SGT 重置。

## 6. 单声道是引擎的设计，不是 port 造成的
- `score_bed.py` L681–686 的注释说明：「amix negotiates its output layout from the FIRST input … mono narration is ordinary here (ElevenLabs returns mono…)」。`_bed_level.py` 的 docstring 也有同样的说明。
- 复现：第一个输入是单声道旁白时输出为单声道，第一个输入是立体声时输出为立体声（ffmpeg 7.1）。
- port 的 TTS（`minimax-media.ts:203`，`channel: 1`）与原版常见的单声道旁白一致。不需要修。

## 7. CI：run 39801527607 有 2 个 job 显示「in progress」
- 重新查询后，14 个 job 全部是 completed/success。
- 这些 job 在 run 创建约 8 分钟后才开始排队，最后一个在 15:26:38Z 结束。之前看到的 in_progress 只是 jobs API 的过期快照。
- 新增 `tools/ci_wait.py`：轮询直到 run 的状态是 completed、每个 job 都有 conclusion、并且 job 数等于 `--expect`（默认 14），然后才判定为 green。
  - 用 `--selftest` 做逻辑自检。
  - 匿名 API 每个 IP 每小时只有 60 次请求，需要时可以设置 `GH_TOKEN`。

## 8. 「web-capture / stock」素材搜索：原版实际有什么
- 引擎文档规定的素材优先级是 mine → shared → web-capture → stock → generate（`CANONICAL_TOOLS.md`、`laws/capability_digest.md`）。
- **web-capture**：实际对应的是本地工具。
  - `pull_video`：用 yt-dlp 拉取视频，Apify 用于抓取 profile（需要 `APIFY_TOKEN`）。
  - `fetch_asset`：从 URL 下载静图。
  - 两者都不经过网关。
  - `MEDIA_LIBRARY_PLAN.md` 计划中的「独立 Playwright 网页截图/录屏」**没有实现**，那里的开放问题也写着「Web-capture quality … to be judged」。
- **stock**：引擎和 `app/out` 里都**没有**任何 stock API 工具（没有 pexels、pixabay 等）。`MEDIA_LIBRARY_PLAN.md` 只把「license-free stock APIs」列为计划。`app/out` 里唯一的 stock 字样是「For stock/default generation, use the existing mint_image, mint_video」。
- **走网关的**：`sfx_catalog`（需要认证的 SFX 目录）、`mint_*` 生成，以及配乐生成。这些属于外部缺口，port 没有凭空实现。

## 9. 仍然存在的缺口
- run3 的结束方式是额度看门狗点了 Stop，而不是 agent 自己交付，所以 agent 没有发出带内嵌视频的最终回复（`reply_link` FAIL）。导出的是 agent 自己渲染并经过 review 的 final.mp4，没有人工补做。
- 看门狗应该同时终止 harness，避免 taste 轮在额度低于阈值后继续调用 LLM。
- 没有账号时 plan 卡会被拒。如果要测「Build it」这条路径，需要开启本地网关 shim 并使用已验证的账号。
- harness 的「等待超时 → Stop → 等计费 → 退出」逻辑本次没有在现场触发（这一轮在上限之前就结束了）。它的辅助函数有单测；Stop 之后会写出计费记录这一点，已经由看门狗那次 Stop 在现场验证过。
