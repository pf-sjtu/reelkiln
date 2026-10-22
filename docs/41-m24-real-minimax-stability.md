# 41. M24：真实 MiniMax 下 S1 主流程稳定性（Linux box，5 次顺序运行）

日期：2026-10-22（SGT）。经 PF 批准的真实调用；只在 box 上运行，CI 中没有 key。

## 1. 运行方式
- **路径**：与 phase-b-m16 T5 相同，即原版渲染器 UI → port 的 AgentHost → 引擎。harness 为 `port/tools/ui-e2e.mjs`，跑完整流程：拖放附件、发送 brief、流式 turn、播放、Approve、导出，以及 taste 问题卡。
  - 与 M16 的差异：本次用 HEAD `33ad5ba` 的 dev 构建（Electron + dist），而不是旧的 AppImage。
  - 引擎目录 `engine-0.1.57-rc7-15f8f2d` 只读。
- **LLM**：真实 MiniMax `MiniMax-M3.1-Flash`，走 minimax provider route。`MINIMAX_BASE_URL` 已 unset，`modelsSeen` 只有这一个模型。
  - 计价由 proxy 按 models.dev `minimax-cn/MiniMax-M3.1-Flash` 计量。
  - 没有使用 Claude 订阅。
- **route-hint**：没有添加任何非原版的 route-hint。唯一的预设是 M16 以来就有的 `VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax`，它只负责选路由，在 summary 的 `notDriven` 中有标注。
- **并发与配额**：并发为 1，5 次顺序运行。每次运行前都用 remains API 检查 general 窗口，低于 30% 就停止。
- **限流**：全程没有出现 429/529/2067/overloaded，日志计数为 0。
- **判定标准**：
  - UI 步骤共 10 个：home、project_video、attach、brief_send、stream、reply_link、play、approve、export、taste_question_card。
  - `tools/accept_check.py` 的 20 项：E1–E15 加上 A/X/L 项。

## 2. 结果
| run | result | steps | accept | turn s | wall s | turns | tool calls | LLM calls | input / output / cache-read tok | cost USD | export sha256 | ffprobe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PASS | 10/10 | 20/20 | 642 | 844 | 42 | 41 | 68 | 1,016,081 / 31,316 / 2,405,693 | 0.2064 | `1ea15d39edd7…` | video:h264 720x1280 30/1, audio:aac 96000Hz ch1, 6.507 s |
| 2 | PASS | 10/10 | 20/20 | 293 | 386 | 22 | 21 | 40 | 553,933 / 15,075 / 1,430,111 | 0.1131 | `1ea15d39edd7…` | video:h264 720x1280 30/1, audio:aac 96000Hz ch1, 6.507 s |
| 3 | PASS | 10/10 | 20/20 | 598 | 778 | 36 | 35 | 62 | 808,711 / 25,214 / 2,259,978 | 0.1696 | `229c3851bd7a…` | video:h264 1080x1920 30/1, audio:aac 96000Hz ch1, 6.5 s |
| 4 | PASS | 10/10 | 19/20 | 906 | 1239 | 36 | 35 | 80 | 1,060,992 / 31,262 / 3,290,104 | 0.2262 | `898d9677fbf4…` | video:h264 720x1280 30/1, audio:aac 96000Hz ch1, 6.507 s |
| 5 | PASS | 10/10 | 20/20 | 289 | 931 | 33 | 32 | — | not recorded (see §3) | 0.1171 | `c8a168e9b65a…` | video:h264 720x1280 30/1, audio:aac 96000Hz ch1, 6.507 s |

> 注：上表 "result" 列只反映 UI 步骤 10/10，没有计入 accept 列；run 4 的 accept 是 19/20，按严格口径不算通过（见 §4）。

**通过率**：
| 口径 | 结果 |
|---|---|
| UI 全部步骤 | **5/5** |
| 严格 accept 20/20 | **4/5**（run 4 只有 19/20，见 §4） |
| 输出有效 | **5/5** |

"输出有效"指以下检查全部通过：
- E1–E12、E14、E15；
- ffprobe 正常，完整解码无错误；
- h264 加 aac，9:16，30 fps，时长 6.5 s ± 0.25 s；
- 剪切点在 2.5 s 和 4.5 s；
- 音轨是配乐；
- final、v1、export 三者 sha256 相同。

**花费**：

| 项目 | 数值 |
|---|---|
| 已计量合计 | **$0.8323** |
| 加上 run 5 未计量的 taste 后续（估计，见 §3） | 约 **$0.98** |
| 每次运行 | 均值 $0.167，标准差 $0.046，范围 $0.113–$0.226 |
| 上限 | 低于 $2 |

**配额（general 窗口）**：

| 时间点 | 剩余 |
|---|---|
| 开始前 | 64% |
| run 1 后 | 58% |
| run 2 后 | 54% |
| run 3 后 | 47% |
| run 4 后 | 38% |
| run 5 后 | 28% |

run 5 开始前是 36%，高于 30% 的门槛。run 5 之后不再有计划中的运行。这个窗口与其他流水线共享。

**波动**：
| 指标 | 均值 | 标准差 | 范围 |
|---|---|---|---|
| 主 turn 时长 | 546 s | 233 s | 289–906 s |
| 工具调用次数 | 33 | — | 21–41 |
| 输入 token | — | — | 0.55M–1.06M |

## 3. run 5 的 gateProxy 为空：是记录不完整，不是没走 proxy
- **gateProxy 从哪里来**：用量汇总只在 `agent.runtime.closed` 事件中写出。
- **run 5 为什么没有这条事件**：
  - taste-capture 后续 turn 在 harness 的 `--taste-wait-ms 600000` 到期时还在运行。
  - Browser.close 被原版 QuitCoordinator 的"仍在工作"对话框拦住。
  - harness 于是 SIGTERM，再 SIGKILL（console +922 s），runtime 没有正常关闭。
- **proxy 确实在用**：
  - 主 turn 有 `agent.spend.metered`：`meter: proxy`，`priceSources: models.dev:minimax-cn/MiniMax-M3.1-Flash`，`runtimeUsd 0.117103419`。
  - 另有 `agent_proxy.drained_after_disconnect`：一个 200 响应，39,003 输入 / 1,069 输出 token。
- **对花费的影响**：
  - run 5 的 $0.1171 是**下限**，约 550 s 的 taste 后续 turn 没有计量。
  - 按 run 4 的 taste 速率（约 $0.00027/s）估算，约多出 $0.15。
- **证据**：已写入 `run5-m24-summary.json` 的 `gateProxyNote`。
- **判断**：这是 harness 收尾的问题，M16 中已有同样的记录。原版行为本身就会在 turn 进行中弹出退出确认，所以这不是 port 的 bug。
- **可选改进（未做）**：taste 等待超时后，先停止 turn，再退出。

## 4. 失败模式与差异
- **run 4 的 E13 未通过**（`E13_runlog_assemble_compose` 要求 `beat_assembled` 恰好 3 次）：
  - agent 为了验证"素材原声没有混进去"，自行做了静音配乐对照实验，额外 assemble 了两次，并多渲染了一次；run.log 里有 9 次 `beat_assembled`。
  - 最终交付有效，其余 19 项全部通过。
  - 这是模型行为的波动，不是 port 的 bug，因此没有修改。也**没有**事后放宽 E13。
- **输出 sha256 的差异**：
  - run 1 和 run 2 的字节完全相同（`1ea15d39…c9fe9`），也与 M16 T5 相同，说明在同样的编排下引擎渲染是确定的。
  - run 3 选了 1080x1920（在 E4 允许范围内）；run 4 和 run 5 的编排细节不同（`898d9677…`、`c8a168e9…`）。
  - 5 次的时长、剪切点、编码都满足验收。
- **其他差异**：taste 卡的问题和语言有变化，run 5 是中文选项。没有 console 错误，原版已知 TypeError 计数为 0。
- **本轮修复**：无。没有发现 port 的 bug。

## 5. 证据
`artifacts/phase-b-m24/`：
- 每次运行：`run{1..5}-*`，包括 summary、accept、events、cdp-log、结构化 main log、ffprobe、edl、sha256、versions、sessions、截图，以及 `run{N}-m24-summary.json`。
- 配额快照：`remains-*.json`。

已做的检查：
- 路径已替换为 `<RUN>` 等占位符；
- key 命中为 0；
- 没有 mp4/mp3/jpg/sqlite；
- 总大小约 11 MB。

每次运行的 scratch 在记录证据后已删除。
