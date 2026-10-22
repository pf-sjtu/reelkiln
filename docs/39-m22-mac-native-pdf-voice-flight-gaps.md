# 39. M22：macOS 原生路径（PDFKit 读 PDF、语音听写 helper 打包与转写链路、隐藏 Flight 的 accessory 策略）+ 缺口清单全面复核

日期：2026-10-22（SGT）。真实 MiniMax 花费 **$0**（全部 FAKE-LLM / 本地；CI 里没有任何 key）。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `a26d9b5` | 代码：`readOwnedPdf` 逐字生成并接为 `host.setPdfReader`；`VoiceDictation` 逐字生成，`transcribeVoice` / `discardVoice` / `stageVoiceNote` 后台转写 / 各处取消路径按原版接线；staging Flight profile 逐字生成 + 启动时应用（含 accessory）；mac 标题栏；`package.mjs` 在 macOS 上把 `VoiceDictation.swift` 编进 `Contents/Resources/bootstrap/voice-dictation`；测试 |
| `bfee5ce` | `macos-native` CI job（先非阻断） |
| `fa4ff78` | run-1 证据 |
| （后续提交） | 两次全绿后改为阻断；本文档；docs/34 |

## 1. 三项移植
### 1.1 PDF 附件读取（原版 L56880-57058，L61127）
- `src/main/attachments/pdf-reader.generated.ts`：`PDFKIT_READER_SCRIPT`、`interpretPdfKitOutput`、`withReadSlot`（并发 2）、`readOwnedPdf`、`readWithPdfKit` **逐字切片**（tools/gen-verbatim.mjs，verbatim.test 校验）。
- 接线：`AgentHost.setPdfReader`（L44737）→ `ComposerAttachmentStore.setPdfReader`；`real-backend.ts` 里 `h.setPdfReader((path, sha2562) => readOwnedPdf(path, sha2562))`，与 L61127 相同。
- 非 darwin：原版 `readOwnedPdf` 自己返回 `{kind:"unread",cause:"unavailable"}`（L56968-56970），port 原样保留（Linux/Windows 行为不变）。
- 测试：`test/pdf-reader.test.ts`
  - 全平台：注入 osascript 验证 stdin 字节、sha 复核、参数契约（`-l JavaScript -e <script> -- 500 1000000`）、非零退出 → unavailable、空文件 → damaged；store 层 `readContents → record.pdf → read_pdf` 窗口。
  - macos-latest（真 `/usr/bin/osascript` + PDFKit）：2 页文本 PDF → `read`，页面文本正确；无文本页 → `image-only`；非 PDF → `damaged`；sha 不符 → `damaged`；store 层 `read_pdf` 返回真实提取的文字。
### 1.2 隐藏 staging Flight profile 的 `setActivationPolicy("accessory")`（L60305-60318）
- `src/main/platform/staging-flight.generated.ts`：`resolveStagingFlightProfile`、`realContainedDirectory`、`isWithin$2`、`applicationChannel`、`workspaceLeafForChannel` 逐字。
- `src/main/staging-flight.ts`：L60306-60318 原样（hidden + darwin → accessory；userData → Flight 目录；补 `remote-debugging-address=127.0.0.1` / `remote-debugging-port=0`；否则未打包时的 `VIDEOCLAW_USERDATA_DIR` 分支），以及窗口 `show` / `backgroundThrottling`（L60542/L60552）。`index.ts` 在 ready 前调用。
- **注意（忠实）**：原版发布版的 `applicationChannel()` 写死为 `"prod"`（L9172），所以生产构建里 profile 恒为 undefined，这段永不触发——port 也是如此；行为用 channel `"staging"` 测。
- 测试：`test/staging-flight.test.ts`（解析 / 缺项抛错 / marker 不匹配 / accessory 只在 darwin + hidden / 开关不重复追加 / 窗口标志）；macos-native 里用**真 Electron** 跑 `tools/m22-flight-probe.ts`：hidden → `dock.isVisible()=false`、窗口不可见、backgroundThrottling 关、userData 为 Flight 目录、CDP 只绑 127.0.0.1；对照组（不 hidden）→ Dock 可见、窗口可见。
- 顺带：此前 port 没有设置 `titleBarStyle: "hiddenInset"` + `trafficLightPosition {16,16}`（docs/38 §2 写成"已移植"是**错误**，此处更正）；现在只在 darwin 上设置（原版只发 macOS；在 Windows/Linux 上这个值会去掉原生边框）。
### 1.3 语音听写转写链路 + 打包 helper
- `VoiceDictation`（L10599-10705）逐字生成进 `voice-note.generated.ts`。AgentHost 按原版：`voiceDictations` / `voiceNoteTranscripts`、`transcribeVoice`（L45689）、`discardVoice`（L45705）、`hasActiveVoiceTranscription`（L44824，退出确认读它）、`stageVoiceNote` 后台转写（L44753-44786，`--check` 可用才跑，完成后 `setVoiceNoteTranscript`）、`cancelVoiceNoteTranscripts`，以及 removeSession / stopAuthenticatedWork / closeAll / approve / 移除附件时的取消。
- 修正一个 port bug：`platform/voice.ts` 的错误表把原版键 `unsupported_os` 写成了 `os_version`（导致老系统上显示通用文案）；现与生成的原版表做 deepEqual 测试。
- 打包：`tools/package.mjs` 在 macOS 主机上用 `xcrun swiftc -parse-as-library -O -target arm64-apple-macos14.0` 编译 `app/native/VoiceDictation.swift` → `build/native/darwin-arm64/bootstrap/voice-dictation` → electron-builder `extraResources` → **`Contents/Resources/bootstrap/voice-dictation`**（原版布局：`resolveBootstrapToolRoots` L9296 → `voiceTools` L10465；原版清单 `artifacts/manifests/bootstrap-binaries.sha256` 同目录还有 ffmpeg/ffprobe/uv）。部署目标 14.0 是为了让 helper 在旧系统上自己回答 `unsupported_os`（源码有 `#available(macOS 26, *)` 守卫）。非 Mac 主机打 mac 包时跳过并告警。ffmpeg 不随包，沿用 PORT-NEW 回退（已安装引擎的 `bin/ffmpeg`）。
- CI 实测（macos-latest，macOS 26.6.2）：.app 内 helper 为 `Mach-O 64-bit executable arm64`，`minos 14.0`，`sdk 26.5`，ad-hoc（linker-signed）签名；`--check` → `{"error":"unavailable"}`。打包应用自身（S1 运行中经 CDP 调 `window.videoclaw.voiceDictationStatus()`）返回原版文案 `{available:false, attach:true, "On-device transcription is unavailable on this Mac…"}`——证明打包应用从 `Resources/bootstrap` 找到并执行了 helper。
- 转写链路：
  - **已验证（假 helper，同 CLI 契约，三平台 port 测试）**：webm(opus) → ffmpeg `-ar 16000 -ac 1 pcm_s16le` → helper `<wav>`（helper 读到的就是 RIFF/WAVE、单声道、16 kHz、16 bit）→ `complete` 去空白；`no_speech` / `model_download` / 其他错误 → 原版文案；非 EBML 音频 → invalid_audio；无 helper → "unavailable in this build"；取消 → `cancelled`；结果缓存；AgentHost 的 `hasActiveVoiceTranscription` 进行中为 true；`attachment:voiceNote` → 48 kHz wav 附件 → 后台转写写入 `voiceNote.transcript`。
  - **已验证（真 helper，macos-latest）**：`say` 录音 → webm → `VoiceDictation.execute` → 真 helper → `{"error":"unavailable"}` → `failed` + 原版文案。即一直到 `SpeechTranscriber.isAvailable` 这一步都走通。
  - **未验证（需要语音资源）**：`SpeechTranscriber.isAvailable == true` 之后的一切——locale 支持判断、`AssetInventory` 预留/下载、`SpeechAnalyzer` 实际识别、`{text}` 返回、真实文本写入附件。托管 runner 上这一步固定返回 unavailable。

## 2. CI
| run | 提交 | macos-native | 其余 job |
|---|---|---|---|
| 39735839892 | bfee5ce | 绿（非阻断，第 1 次） | 全绿（macOS S1 allPass，voiceDictationStatus 见上） |
| 39736813182 | fa4ff78 | 绿（非阻断，第 2 次）→ 改为**阻断** | 全部 macOS job 绿 |
| 39737837690 | a9f7643 | 绿（**阻断**） | 全绿 |

## 3. 本机测试
port：358 项，0 失败（Linux box）。

## 4. 缺口清单（端到端复核 docs/34 §6 + docs/35 §5 + docs/37 §4 + docs/38 §4 + 源码中的 NOT PORTED）
"需要什么"只写外部条件；"无"表示纯工程、不需要任何账号/密钥/硬件。
| # | 缺口 | 当前状态 | 需要的外部条件 |
|---|---|---|---|
| 1 | W8(b)：Windows 上控制台窗口是否闪现 | 托管 runner 无法观察（对照组也为 0） | 一台**有交互桌面的 Windows**，人工看 |
| 2 | 真实模型下的 agent 行为（Windows / macOS CI） | CI 只用 FAKE-LLM 回放；Linux box 上有过小额真实证明 | **模型 API key**（按约束不进 CI；只能在 box 上经批准、限额使用） |
| 3 | 多模态 embedding 后端（library:sync / search） | MiniMax 经实测无法提供 | 一个**提供图像/视频 embedding 的服务账号 + key**，或原版上游网关账号 |
| 4 | 具名模型付费工具（mint_video / mint_image / synth_voice 的具名路由、preview_session_shot、character_voice、plan_paid_operations） | 拒绝或可选的标注替代（默认关） | **原版上游网关账号（vc_ key）+ 额度**，或每个具名模型的**供应商账号 + key** |
| 5 | Claude 订阅分支（creditHandoffOffer）、claude-code 标题提议 / 登录探测 | 只能注入 | **Claude 订阅登录**（按约束禁止使用 → 不做） |
| 6 | macOS 真实语音转写（§1.3 未验证部分）+ 麦克风 TCC 弹窗 + 听写 UI | 链路已到 `isAvailable` | **真 Mac**：Apple 芯片、macOS 26+、可用的设备端语音资源（系统语言受支持、可联网下载资源）、麦克风、登录的图形会话 |
| 7 | 托管登录（上游账号平面）、nightly 通道、网关引擎下载（resolveEngineSource 网关分支） | 未移植 / 跳过 | **原版上游网关账号**（及其服务端） |
| 8 | 生产 update feed（原版只在 packaged + darwin + 可信 https 网关时启用） | darwin 分支在、无 feed | **托管更新源**（上游网关或自建 https 存储）+ macOS 自动更新要求的**签名构建**（见 9） |
| 9 | 签名 / 公证（macOS）、Authenticode（Windows）；Gatekeeper / dock 行为 | 未签名构建（helper 为 ad-hoc） | **Apple Developer Program 账号 + Developer ID 证书 + notarytool 凭据**；**Windows 代码签名证书**；Gatekeeper 观察需真 Mac |
| 10 | 非 darwin 平台的更新门槛 | 忠实于原版（仅 darwin） | 无（产品决策，不是移植缺口） |
| 11 | `.zip` 附件解包（extractArchive，原版用 yauzl） | 一律拒绝（原版拒绝文案） | 无（加依赖 + 移植 chunk L4199） |
| 12 | 工作簿读取（setWorkbookReader / readWorkbookInWorker 子进程） | 未接线 → 工作簿附件被拒为 too-complex | 无（移植 worker） |
| 13 | `nativePythonArgs` 的 Rosetta 分支真机路径 | 合成 Mach-O 单测 | 无硬性外部条件：需要 Apple 芯片 + Rosetta + x86_64 python（hosted runner 是否装了 Rosetta 未确认） |
| 14 | macOS port job 曾挂住的真正原因 | `--test-force-exit` 兜底 | 无 |
| 15 | Windows 上的 PDF 读取 / 语音 helper | 原版在非 darwin 本身就是 unavailable，port 一致 | 无（可选的 PORT-NEW 扩展，不是缺口） |
| 16 | staging 通道本身 | 原版发布版写死 prod，port 一致 | 无（不是缺口） |
已关闭（本轮）：docs/38 的 PDF 读取未接线、staging accessory 策略、语音 helper 未构建/未随包/转写未移植（除第 6 条的语音资源部分）、mac 标题栏。

## 5. 可存档摘要
M22 把原版剩下的三条 macOS 原生路径接进 port，并在 macos-latest 上实测：PDF 附件经 `/usr/bin/osascript` + PDFKit 读取（原版代码逐字，非 darwin 行为不变）；VoiceDictation.swift 在打包时编进 `.app/Contents/Resources/bootstrap/voice-dictation`（原版布局），打包应用能找到并执行它，转写链路一直验证到 Apple 语音资源这一步（runner 上 `SpeechTranscriber` 不可用，之后的部分未验证）；隐藏 staging Flight 的 accessory 策略在真 Electron 里让 Dock 图标消失（对照组可见）。顺带修了语音错误表的键名和 mac 标题栏。剩余缺口都需要外部条件（账号、key、证书或真 Mac / 有桌面的 Windows），只有 zip 解包、工作簿读取、Rosetta 分支和测试挂起原因是纯工程。花费 $0。
