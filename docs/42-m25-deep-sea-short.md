# 42. M25：真实制作一条竖屏 Short「Bioluminescent creatures of the deep sea」

日期：2026-10-22（SGT）。只在 box 上运行；`MINIMAX_API_KEY` 只从环境读取，从未打印或提交；并发为 1。
成片：`/workspace/share/reelkiln-deep-sea-short.mp4`（box 本地，不入库）。证据：`artifacts/phase-b-m25/`。

## 1. 结果
- **成片**：h264 High，1080x1920，30 fps，yuv420p（tv range）；aac 48 kHz 单声道；41.63 s。
  - 响度：-14.2 LUFS integrated，LRA 1.8 LU，峰值 -1.3 dBFS。
  - blackdetect 和 freezedetect（>0.6 s）都是 0。
- **对照版**：`/workspace/share/reelkiln-deep-sea-short-ai.mp4`，纯 AI 素材，43.6 s，-14.3 LUFS。这一版保留下来，用于对比。
- **计划变更（PF 指示）**：主素材改用 NOAA Ocean Exploration 的公有领域真实影像，AI 片段只补 NOAA 没有的镜头。
  - 真实镜头共 14.5 s，AI 镜头共 27.1 s。逐段见 `m25-summary.json` 的 `timeline_final`。

| 时间 (s) | 内容 | 来源 |
|---|---|---|
| 0–1.9 | 发光的鮟鱇鱼饵（hook） | AI：image-01 首帧 → Hailuo-2.3 I2V |
| 1.9–10.0 | Schaefer's anglerfish，3 个镜头 | **NOAA**，2019 Southeastern U.S. Deep-sea Exploration，Dive 12（928–973 m） |
| 10.0–17.5 | 萤火鱿 | AI |
| 17.5–21.1 | Atolla 水母 | **NOAA**，Voyage to the Ridge 2022（900 m） |
| 21.1–24.7 | 「防盗警报」蓝色光环 | AI |
| 24.7–31.6 | 吸血鬼乌贼释放发光云 | AI |
| 31.6–34.7 | 发光海浪 | AI |
| 34.7–37.5 | Crossota 水母 | **NOAA**，2016 Deepwater Exploration of the Marianas（约 3,700 m） |
| 37.5–41.6 | 发光水母群片尾 + 署名 | AI 静帧，由引擎 kenburns 推近 |

## 2. 每个部分由谁生成
- **媒体**：都由我写的直连 MiniMax API 脚本生成，不经过 app。
  - image-01：18 张，选用 6 张。
  - Hailuo-2.3 I2V：5 条，1080P、6 s。
  - speech-2.8-hd TTS：第一版 2 次，修订版 2 次。
  - music-3.0：纯音乐 1 条。
- **剪辑：先走真实产品流程**。原版 UI → AgentHost → 引擎，LLM 为 MiniMax-M3.1-Flash，由 `ui-e2e.mjs --files … --brief-file` 驱动。
  - 通过的步骤：home、project_video、attach（9 个文件）、brief_send。
  - agent 做了这些事：检查全部素材；分析字幕分组；提出 plan；用 minterpolate 做 30 fps 慢动作，覆盖第 2–5 段素材；做了音乐 bed。
  - 它在重做第 1 段时撞上 app 的 44 min turn 上限（`agent.runtime.closed reason=turn-timeout`），没有走到 assemble/render。
  - 用量：75 次工具调用，106 次 LLM 调用，0 次限流。
- **剪辑：其余部分由我直接调用引擎完成（如实说明）**。
  - `tools/assemble.py`：由我编写 EDL；bed 比人声低 16 dB；母带处理到 -14 LUFS。
  - `tools/compose_render.py --mode render`：字幕用 `tiktok` preset 并覆盖部分参数（粗体白字，无底框，描边，当前词青色），`switch_ms` 700，anchor 0.745。字幕逐词计时，时间来自 TTS 返回的 word timestamps，不是伪造的。
  - 我自己用 ffmpeg 做的处理：
    - 第 1 段的 slow-mo 重编码，沿用 agent 的滤镜；
    - NOAA 竖屏化：中间是 1080 正方形画面，背景用模糊填充，画面上加标签「Real footage: NOAA Ocean Exploration」；
    - 片尾署名「Footage: NOAA Ocean Exploration / Glow sequences: AI-generated illustrations」；
    - 音乐裁剪和淡出；
    - 最终转换到 tv range。
- **迭代一次**：第一版里字幕压在 NOAA 主体上，而且断句别扭（"This tiny light is a" / "trap."）。修改：正方形上移，字幕改放在它下方的模糊区域，`switch_ms` 从 900 改为 700。

## 3. NOAA 素材与版权
- **依据**：NOAA OER FAQ 写明 "Unless otherwise noted … information presented on this website is in the public domain"，并要求使用页面上列出的 credit。三段素材的页面 credit 都是 NOAA Ocean Exploration（或 NOAA OER）。URL 和所用区间见 `production/noaa-sources.json`。
- **排除的素材**：
  - Journey into Midnight 2019 的发光视频：credit 为 "Edie Widder and Nathan Robinson"，非联邦机构。
  - 吸血鬼乌贼：NOAA 只有静图，已知视频来自 OET 或 MBARI。
  - 萤火鱿和发光海浪：没有找到 NOAA 视频。
  - NOAA 源视频里的片头、logo 和水印都已剪掉。
- **旁白按真实画面修改**：原句是 "Two thousand meters down … dangles a glowing lure"，改为 "A real anglerfish, nearly a kilometer down … a fishing rod on its head"，因为 Dive 12 的实际深度是 928–973 m，画面里能看到 illicium。Atolla 那句改为点名 Atolla，这是有文献记载的 burglar-alarm 物种。修改后重新 TTS，时长 40.7 s。

## 4. 花费与配额
- **花费**：媒体按 CNY 标价 × 0.1494 计 $2.9864；agent turn 按 models.dev `minimax-cn/MiniMax-M3.1-Flash` 计 $0.3833。合计 **$3.37**，上限 $5。
  - Hailuo 用的是 token plan 的 video 配额，所以按标价计是偏高的上界。
- **general 窗口**：72% → 56%（agent 前）→ 51% → **28%**（结束）。窗口在 00:00 SGT 重置。
  - 同一 key 上还有别的负载在消耗。降到 30% 以下之后没有再发起任何 LLM 调用。
- **video 配额**：5 → 0。

## 5. harness 改进
- `ui-e2e.mjs --files a,b,c`：附加任意文件，不再只能用 S1 fixtures。逻辑在 `plan.mjs` 的 `attachFileList()` 里。
- 「附件 ready」的正则改用 `attachmentReadyRe()` 生成，转义所有元字符。旧写法只转义第一个 `.`。
- 单测：`test/ui-e2e.test.ts` 新增一项。

## 6. 质量备注（诚实）
- NOAA 原片是 720p，放大约 1.5 倍，比 AI 片段软一些，ROV 灯光下的颜色也偏青绿，和 AI 片段的风格反差明显。为此每个真实镜头都加了标签，片尾也标明哪些是 AI。
- 真实镜头里的动物没有在发光（ROV 白光拍摄）。发光效果都来自 AI 示意镜头，描述里已写明。
- 剪辑点比对应句子提前 0.1–0.4 s。音频是单声道（引擎的 mix 输出）。
- 上传时需要勾选 YouTube 的 "Altered or synthetic content"。title、description、tags 见 `production/youtube-metadata.md`。
