# 38. M21：macOS（macos-latest，arm64，原版的原生平台）验证提到与 Windows 同级

日期：2026-10-22（SGT）。真实 MiniMax 花费 **$0**（全部 FAKE-LLM；CI 里没有任何 key）。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `3a19fd9` | `tools/macos_runbook.sh`（docs/08 S3–S9 的 macOS 版，codex `0.160.1-darwin-arm64` 校验 integrity）+ L0 E1–E15；`macos-s1-ui`（打包 `.app` → FAKE-LLM → CDP 驱动原版渲染器）；`ui-e2e.mjs` 支持 `.app` 与 `--use-mock-keychain`；L0/fixtures 脚本兼容 BSD `shasum` |
| `6f620e1` | run-1 证据；mac 专用 VoiceDictation.swift 探针步骤 + `mac-voice-helper.test.ts` |
| `40c18a2` | 两次全绿后 `macos-runbook` / `macos-s1-ui` 改为**阻断**；RELATIVE_WRITER 差分测试在 macOS 上跑原版脚本的 **darwin 分支** |
| `31ad8bd` | 移植 `nativePythonArgs` + `machOHasArm64`（L7145-7199，逐字）；此前 port 恒返回 `[]` |
| （本文档提交） | docs/38、docs/34、docs/13 |

## 1. CI 结果（macos-latest：Darwin arm64，macOS 26.6.2，Homebrew ffmpeg，uv python 3.14.6）
| run | 提交 | macos-runbook + L0 | macos-s1-ui | 备注 |
|---|---|---|---|---|
| 39730783411 | 3a19fd9 | 绿（MACOS RUNBOOK OK；L0 ACCEPT PASS，failed=[]） | 绿（allPass） | 非阻断，第 1 次 |
| 39731859255 | 6f620e1 | 绿（同上 + 语音探针） | 绿（allPass） | 非阻断，第 2 次 → 改阻断 |
| 39732796887 | 40c18a2 | 绿（阻断） | 绿（阻断） | 第 3 次，首次阻断 |
| 39732935060 | 31ad8bd | 绿（阻断） | 绿（阻断） | nativePythonArgs 真实路径（venv 为 arm64 → `[]`） |

### 1.1 runbook + L0（`tools/macos_runbook.sh`）
- 引擎：`make_windows_engine.py --target posix` 打 tarball → port-cli `install-engine` → shims → `uv sync --frozen` → remotion / hyperframes `npm ci` → 三项引擎契约 → 工作区 → doctor（只容忍 `gateway` 红，其余全 OK）。
- 端到端：assemble + verify 出片；L0 E1–E15 全过，最终 sha `f1c3f6ff…bee0f`（两次一致），ffprobe 证据在 `artifacts/phase-b-m21/macos-run-ci-*`。
- S9：`@openai/codex@0.160.1-darwin-arm64`（integrity 校验）app-server 握手 OK（约 121 ms）；`runBash` 得到 `Darwin arm64`，`python3` 指向引擎 shim。

### 1.2 S1 UI e2e（打包 `.app`，FAKE-LLM，`port/tools/s1-fake-upstream.mjs` 回放 6 个工具调用）
- `electron-builder --mac --arm64 --dir` → `release/mac-arm64/*.app` → `Contents/MacOS/<exe> --remote-debugging-port --use-mock-keychain`，独立 HOME。
- verdict 全部 PASS：home、project_video、attach（drop）、brief_send、stream（约 73 s，6 工具 / 7 轮）、**reply_link**（聊天里的任务链接内联成 `vcmedia://local/…/final.mp4`，readyState 正常）、**play**（currentTime 前进约 2.6 s）、**approve**、**export**；final / v1 / 导出文件 sha 三者一致 `386f00ca…a1`；consoleErrors 0。两次 run 结果相同。
- 收尾：关窗后应用仍在运行，需要 SIGTERM——这与原版一致（`window-all-closed` 在 darwin 上不退出，L62672）。

## 2. 原版的 mac 专用行为 vs port
| 行为（原版位置） | port 状态 | 托管 runner 上能否无头测试 |
|---|---|---|
| `nativePythonArgs` / `machOHasArm64`（L7145-7199：Apple Silicon 上若 venv / uv 找到的 python 是 x86_64，强制 `cpython-X.Y.Z-macos-aarch64`） | **本轮移植**（逐字）；单测覆盖 thin/fat/非 Mach-O、版本解析、venv 已是 arm64 等分支 | 部分：runner 原生 arm64，走"已是 arm64 → []"分支；Rosetta 分支只用合成 Mach-O 单测 |
| RELATIVE_WRITER darwin 分支（L2864：BSD `stat -f`，`osascript` JXA `renamex_np(RENAME_EXCL)` 发布） | port 用 Node 实现；**本轮**差分测试在 macOS 上直接跑原版 darwin 分支，退出码 / 内容一致 | 能（port 测试 · macos-latest） |
| VoiceDictation（`app/native/VoiceDictation.swift`，macOS 26 SpeechAnalyzer；状态 L10472，执行 L10599） | 状态逻辑逐字；**不构建也不随包分发 helper，转写（VoiceDictation.execute）未移植** | 部分：runner 上 `swiftc` 能编译 helper（Swift 6.3.3，arm64-apple-macosx26.0），但 `--check` 与真实转写都返回 `{"error":"unavailable"}`（runner 没有语音资源）；port 的状态函数据此给出原版文案 "On-device transcription is unavailable on this Mac…"。真实转写需要有语音资源的真 Mac |
| 麦克风权限 `systemPreferences.askForMediaAccess`（L61905） | 已移植（local-channels.ts） | 否：TCC 弹窗无法无头 |
| PDF 读取 `readOwnedPdf` 经 `/usr/bin/osascript`（L56967） | `pdfReaderFor` 存在但**未接线** → 附件 PDF 读取在所有平台都未移植 | 能（osascript 在 runner 上可用），未做 |
| `setActivationPolicy("accessory")`（L60307，隐藏的 staging 飞行配置） | 未移植（仅内部 staging 通道） | 能起，但无可见效果可断言 |
| 应用菜单 | 原版不调用 `setApplicationMenu`（Electron 默认菜单），无缺口 | — |
| `titleBarStyle: hiddenInset` + `trafficLightPosition`、`activate` 重建窗口、`window-all-closed` 不退出、`before-quit` QuitCoordinator | 已移植；S1 收尾印证了不退出行为 | 部分（仅进程行为；视觉/dock 不可） |
| 自动更新（L2229：仅 packaged + darwin + 可信 https gateway） | app-updater 有 darwin 分支 | 否：没有生产 update feed |
| Gatekeeper / 公证、dock 行为 | 未签名构建 | 否 |

## 3. 平台验证矩阵（可存档摘要）
| 层级 | Linux（ubuntu） | Windows（windows-latest） | macOS（macos-latest arm64） |
|---|---|---|---|
| port 单测 | 阻断 | 阻断 | 阻断 |
| 引擎静态 / 导入 | 阻断 | 阻断 | 阻断 |
| runbook S3–S9 + doctor + 出片 | 阻断（linux-baseline） | 阻断 | **阻断（M21）** |
| L0 E1–E15 | 阻断 | 阻断 | **阻断（M21）** |
| 打包 + packaged smoke | AppImage（box） | nsis + portable | dmg + `.app` |
| S1 UI e2e（FAKE-LLM，原版渲染器，含 reply_link/play/approve/export/sha） | box | 阻断（unpacked + NSIS） | **阻断（打包 `.app`，M21）** |

存档摘要：M21 把 macOS arm64 提到与 Windows 同级——runbook + L0 + 打包 `.app` 上的 S1 UI e2e 两次全绿后阻断；顺带移植了原版 Apple Silicon 的 Python 架构选择（nativePythonArgs），并在 macOS 上对原版 RELATIVE_WRITER darwin 分支做差分。剩余 mac 缺口：语音听写转写（helper 能编译，但 runner 不可用）、PDF 读取未接线、staging 的 accessory 策略、更新 feed、签名/公证。花费 $0。

## 4. 剩余缺口（mac 相关）
1. VoiceDictation：构建并随包分发 helper + 移植 execute；真实转写需要有语音资源的真 Mac。
2. PDF 附件读取（`readOwnedPdf`）接线——可在 macos-latest 上测。
3. staging 的 `setActivationPolicy("accessory")`。
4. 签名 / 公证 / 生产 update feed（需要账号与证书）。
