# 33. M16：collector 余项、voice 卡、app 更新、Alpha consent / spend policy 物化、AppImage S1 回归

> 时间：2026-10-22（UTC+8）。只在 box 上操作。LLM 只用 MiniMax（环境变量 `MINIMAX_API_KEY`；key 没有打印、记录或提交，证据目录 key 命中 0）。没有 Claude 订阅凭据，也没有 Codex、OpenAI 或 gateway 凭据。
> 凡是 fake 上游的运行，都在 summary 里标了 **FAKE-LLM**，不当作真实 LLM 的通过证据。真实花费合计 **≈ $0.2845**，低于上限 $0.5（见 §7）。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `5b62140` | T1 collector：busy wrapper、late-result 平面、collectorOwned 标记（journal helper 为 verbatim）；report-only turn |
| `f600aa1` | T2 voice 卡：RecorderCard（request_voiceover）和 composer 语音便签的 UI e2e；`media:voiceDictationStatus` 改走真实后端 |
| `fc3d471`、`1a6dfbf` | T3 app 更新：createAppUpdater / quiesceForUpdate / QuitCoordinator（verbatim 生成）、`app:update:state/download/install`、本地 HTTPS feed 的 AppImage 端到端 |
| `d6640cd` | T4 AlphaConsentCoordinator（L5156-5272 verbatim）与 materializeGatewaySpendPolicy |
| `7826da1` | T6 `app:restart`（restartApp L60767）和 `engine:pendingToast`（L61306-61320）改为真实；ipc_coverage 能匹配带 `-` 的频道名 |
| `4f843ae` | T5 AppImage S1 回归（真实 MiniMax）；ui-e2e.mjs 增加 `--engine` 和私有 dbus/keyring |
| 本文档提交 | T6 覆盖率刷新和本文档 |

## 1. T1 collector 余项（`5b62140`）
- **移植内容**：operation journal 的 helper（`operation-journal.generated.ts`，verbatim），以及 AgentHost 的 collector busy 锁、late-result 平面和 collectorOwned 标记。late result 到达后走原版的 report-only turn。
- **证据**：
  - `T1-collector-proof-fake.json`（**FAKE**）：late-arrival、busy-lock、late-failure 三个场景都 PASS。
  - `T1-collector-proof-real.json`：用真实 MiniMax TTS（`minimax/speech-2.8-turbo`）测 late-arrival，PASS，ledger 记 $0.001584，未结算敞口为 0。
  - 单测：`test/m16-collector.test.ts`。

## 2. T2 voice 卡（`f600aa1`）
- **RecorderCard（request_voiceover）**：原版这张卡不做转写。录音生成 48 kHz pcm_s24le WAV，经 `input:respond` 回传。
- **Composer 语音便签**：原版依赖 macOS 本机转写 helper。Linux 上状态为 `{available:false, attach:true}`，所以录音只作为附件，以 `Voice note 0:04.wav` 的文件名进入 `jobs/<job>/incoming/`。
- **麦克风**：用 Chromium 的 fake 设备加 `--use-file-for-fake-audio-capture` 喂一个 wav，这一点在 summary 里标为 **HARNESS**。
- **证据**：
  - `T2-voice-fake5/`（**FAKE-LLM**）。
  - `T2-voice-real1/`（真实 MiniMax，$0.007952）：recorder_card 和 composer_voice_note 都 PASS，`allPass=true`。
  - `T2-remains-before-real.json`。

## 3. T3 app:update 下载和安装（`fc3d471`、`1a6dfbf`）
- **移植内容**：
  - verbatim 生成 `app-updater.generated.ts`（createAppUpdater、quiesceForUpdate）和 `quit-coordinator.generated.ts`（assessQuit、quitDialogOptions、QuitCoordinator）。
  - `before-quit` 和 powerMonitor 的 `shutdown` 都交给 QuitCoordinator 处理。
  - 用 electron-updater 6.8.9；在 Linux 上实际是 AppImageUpdater。
  - publish 配置为 generic，指向 `${gw}/v1/app/updates/latest/`。
- **证据**：`T3-update-appimage/`，`allPass=true`。
  - **测试方式**：先打包 0.0.40 和 0.0.41 两个 AppImage，再用标注为 **FAKE** 的本地 HTTPS feed（自签证书、限速）提供更新。
  - announce、download、restart_dialog_cancel、quit_and_install_relaunch 四步都 PASS。
  - 新版本确实重新启动起来，截图为 U1–U6。
- **PORT 差异**：
  - createAppUpdater 的门槛是 darwin、packaged、https 三者同时满足。Linux 上只能通过 harness seam（`PORT_UPDATE_HARNESS_ENV`）绕过 darwin 判断，正常的 Linux 启动仍然是 disabled。
  - nightly 的 header 被拒绝。
  - readQuitState 里附件 staged/copying 的计数固定为 0。

## 4. T4 AlphaConsentCoordinator 和 materializeGatewaySpendPolicy（`d6640cd`）
- **consent**：
  - `alpha-consent.generated.ts` 是 L5156-5272 的 verbatim 代码。
  - 每个 key 的 consent 记录存在 `alphaConsentsByKey` 里；`beaconQueuedAt` 写入之后才设置 `alphaConsentAt`。
  - durable outbox 发出 `alpha-consent` beacon。
  - 启动顺序为先 `ensureActiveAlphaConsent`，再 `resolveAccount`。
  - `settings:get/set` 被包装，`grantUsageSharing` 改为 patchDurable 再 reconcile。
- **spend policy**：
  - 物化的 key 按会话区分，格式为 `${jobId}:${policy}:${ceiling}`。
  - `putGatewaySpendPolicy` 对同一 job 的写入串行化。
  - adoptJob 时设置 reset 标记，强制重写；restoreSessions 会修复过期的标记；sendMessage 发送前先物化（L41566-41584）。
- **证据**：
  - `T4-consent-fresh-profile/consent-evidence.json`（**FAKE-LLM** 全新 profile）：`alphaConsentsByKey` 同时有 acceptedAt 和 beaconQueuedAt；account 为 `hasStoredKey:true`。
  - 单测：`test/m16-consent-spend.test.ts`（5 条）。

## 5. T5 AppImage S1 回归（真实 MiniMax，`4f843ae`）
- **运行条件**：
  - AppImage 在 T4 之后重新打包：`Videoclaw-Port-0.0.40-port.0-linux-x86_64.AppImage`。
  - 引擎目录 `engine-0.1.57-rc7-15f8f2d` 只读。
  - 第 1 次尝试即通过，上限是 2 次。
  - 开始前 general 为 99%，结束后为 97%。
- **harness 输入**（已标注）：packaged 构建的 CredentialStore 只认 OS 钥匙串。所以 ui-e2e.mjs 在 AppImage 模式下启动私有 dbus-daemon 和已解锁的 gnome-keyring（secrets），并传入 `--password-store=gnome-libsecret`。
- **结果**：`allPass=true`。
  - home、project_video、attach（拖放）、brief_send、stream（769 s，45 次工具调用，`isError:false`）、play、approve、export、taste_question_card 共 9 步全部 PASS。
  - accept_check 20/20。
  - 输出为 h264 720x1280 30fps 加 aac，时长 6.507 s，剪切点在 2.5 s 和 4.5 s。
  - final、v1、export 三者 sha256 相同：`1ea15d39…c9fe9`。
  - 原版的两处已知 TypeError 计数为 0，console 错误为 0。
- **花费**：$0.274949（proxy 按 models.dev `minimax-cn/MiniMax-M3.1-Flash` 计量，包含原版的 taste-capture 追问 turn）。
- **teardown 观察**：
  - harness 发 Browser.close 时 taste-capture turn 还在运行，于是原版 QuitCoordinator 弹出 “Videoclaw is still working” 对话框（T3 移植的行为，截图 `99-teardown-quit-dialog.png`），卡住了 Browser.close。
  - 我在 Xvfb 上用 xdotool 手动点了 “Quit Videoclaw”，日志出现 `quit: begin shutdown (quit)`，进程退出码 0。这一步发生在所有判定之后，**不计入 PASS**。
  - harness 已改为 Browser.close 最多等 5 s，之后依次 SIGTERM、SIGKILL。
- **说明**：这个 AppImage 是在 `7826da1`（app:restart/pendingToast）之前打包的。
- **证据**：`T5-s1-appimage-real1-*`（summary、accept、cdp-log、events、ffprobe、edl、sha256、versions、sessions、shots），以及 `T5-s1-appimage-real1-NOTE.json`、`T5-remains-*.json`。

## 6. T6 覆盖率
- **ipc_coverage**（`T6-ipc-coverage.txt`）：TOTAL 184。
  - real 117、real-partial 42、push-real 20、push-none 3、local 1、real-env 1。
  - fixture 0、stub 0。
  - 对比 docs/32：real 110、real-partial 43、push-real 19、push-none 4、fixture 4、stub 2。
  - 变化原因：
    - `app:update:download/install/state`、`media:voiceDictationStatus`、`app:restart`、`engine:pendingToast` 变为 real。
    - `engine:continueOnCredits` 由 real-partial 转为 real（spend policy 物化已移植）。
    - `app:update:state-changed` 计为 push-real：脚本原来的正则不匹配 `-`，现已修正。
  - 剩余 push-none：`characters:voices:changed`、`engine:updated`、`window:state`。
- **stub_audit**（`T6-stub-audit.txt`）：共审计 116 项，stub 为 0。a 类 56/56；b 类 58 项中 55 项完成、3 项 partial_other；c 类 2 项。

## 7. 花费（真实 MiniMax，models.dev 计价）
| 项目 | 花费 |
|---|---|
| T1 真实 TTS late-arrival | $0.001584 |
| T2 真实 voice 卡 UI 运行 | $0.007952 |
| T5 AppImage S1 回归（LLM，含 taste turn） | $0.274949 |
| FAKE-LLM / fake feed / 单测 | $0 |
| **合计** | **≈ $0.2845**（上限 $0.5） |

全程没有遇到 429、529 或 2067。

## 8. 已验证 / 未验证 / 风险
### 已验证
- collector 的三个场景（fake）和真实 TTS late-arrival。
- RecorderCard 和 composer 语音便签在原版 UI 中运行（真实 LLM，harness 提供麦克风）。
- AppImage 从 0.0.40 更新到 0.0.41：发现、下载、取消、安装并重新启动（本地 fake feed）。
- 全新 profile 下 Alpha consent 落盘并发出 beacon；spend policy 物化（单测）。
- packaged AppImage 加真实 MiniMax 跑 S1 全流程：9 步和 accept 20/20。
- QuitCoordinator 的 “still working” 对话框在真实工作进行中出现，选择 Quit 后正常关闭。
- 测试 316/316；`npm run build` 通过；typecheck 干净。

### 未验证
- `app:restart` 和 `engine:pendingToast`：只做了 typecheck 和 build，没有 UI 或运行时证明。
- 真实的 update feed，即生产 gateway 的 `/v1/app/updates`；正常 Linux 启动下的自动更新（被 darwin 门槛挡住）。
- 真实 gateway 上的 spend policy PUT。只验证过 shim、proxy 和单测。
- macOS 本机语音转写。

### 风险
- Linux 的 safeStorage 依赖钥匙串。没有 Secret Service 的桌面上，packaged 构建会拒绝保存凭据，这与原版的 “keychain isn't available” 行为一致。
- readQuitState 里附件计数固定为 0；authenticatedWorkPaused 没有建模。
- 真实模型的 turn 很长（S1 用了 769 s），而且 taste turn 在 approve 之后还会继续，所以 harness 的超时要留够余量。

## 9. 离 100% 还差（更新）
1. 多模态 embedding 后端（library:sync/search）。
2. 不适配的付费工具：mint_video/mint_image/synth_voice 的具名模型路由、preview_session_shot、character_voice、plan_paid_operations。
3. 真实 Claude 订阅分支（creditHandoffOffer），目前只能注入。
4. macOS 本机语音听写（transcribeVoice/discardVoice/voiceNote 的后台转写），属于平台限制。
5. 托管登录（videoclaw.com 账号平面）和 nightly 更新通道；生产环境的 update feed 和非 darwin 平台的更新门槛。
6. push-none 的 3 个推送：`characters:voices:changed`（依赖账号）、`engine:updated`（Bootstrap 的 onEngineUpdated 引擎热更新路径）、`window:state`。
7. readQuitState 的附件计数、authenticatedWorkPaused，以及 `app:restart` 和 `engine:pendingToast` 的运行时证明。
8. ~~voice 卡 UI 证据~~、~~app:update 下载/安装~~、~~AlphaConsentCoordinator~~、~~materializeGatewaySpendPolicy~~、~~collector busy/late-result/collectorOwned~~：本轮已完成。
