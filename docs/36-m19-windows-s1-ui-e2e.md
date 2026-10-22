# 36. M19：Windows S1 UI e2e（FAKE-LLM）在 windows-latest 上通过；W11 / W13 / W14；macOS packaged smoke

日期：2026-10-22（SGT）。本轮真实 MiniMax 花费 **$0**（全部 FAKE-LLM）。CI 里没有任何模型 key。opt-in 的 MiniMax 替代路线（docs/35）保留，默认关闭。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `8b50625` | `port/tools/s1-fake-upstream.mjs`：确定性的 Anthropic 兼容假上游，按 M16 真实 MiniMax S1 运行（`artifacts/phase-b-m16/T5-*`）的关键路径回放 6 个工具调用（Bash 暂存素材 → prepare_production → Write edl.json → assemble --check → assemble → compose_render）+ 最终消息；Linux dev-electron S1 allPass，导出 sha `1ea15d39…` 与真实运行**逐字节相同** |
| `3ab7d87` | CDP 驱动 `tools/ui-e2e.mjs` 的 Windows 启动路径：`--exe <win-unpacked\videoclaw-port.exe>`、`USERPROFILE=RUN`、没有 Xvfb / gnome-keyring、`taskkill /T /F` 收尾；新 CI job `windows-s1-ui`（非阻塞） |
| `e7c847d` | **W14**：collector 与原生 model-call 恢复路径改用 `venvPython()`（之前写死 `.venv/bin/python`，Windows 上 collector 根本不会启动）；collector 单测在 win32 上用真实 `python -m venv` 跑。**W13**：没有 Git Bash 时 runBash 直接报错（fail closed），不再退回 cmd |
| `a35dda3` | W14 在真 Windows 上发现：model completion 的 `saved` 路径校验用 `relative()` 结果匹配 `incoming/model-…`，Windows 上是反斜杠 → 改为按 `sep` 归一；macOS `.app` packaged smoke（非阻塞） |
| `7d1ed35` | ui-e2e 用 `basename()` 取附件名（Windows 路径） |
| `da4e93b` | **Windows S1 发现的真实缺陷**：production verdict（`production_guard.py --verdict-json`）在 Windows 上以 `\r\n` 结尾，原版解析只去掉 `\n` → **每一次 agent Bash 调用都被拒绝**（“Production verdict must contain exactly one JSON line.”）。gen-verbatim 增加一处替换：仅 win32 去掉一个结尾 CRLF；内嵌 `\r` 或多行仍然拒绝 |
| `daceceb` | **W11**：原版渲染器 `mediaUrl()` 用 `/` 切分路径，Windows 原生路径得到 `vcmedia://localD%3A%5C…`（路径进了 host，Chromium 拒绝），Output 面板显示 “This source is offline”。渲染器保持原样；preload 只在 win32 通过 `contextBridge.executeInMainWorld` 装一个小 shim，在 DOM（`src`/`poster`/`setAttribute`）和 `fetch` 边界把它改写成 `vcmedia://local/D%3A/a/…`，main 侧 `vcmediaFilePath` 再映射回 `D:\a\…` |
| `ffb244c` | ui-e2e：144 px 高的播放器原生播放按钮位置（之前点到进度条，只 seek 不播放）；`USERPROFILE` 重定向后创建 `Downloads`（`app.getPath("downloads")` 是另存为对话框的默认目录） |
| （本文档提交） | docs/36、docs/10、docs/34、docs/13，CI 证据 |

## 1. CI 逐轮（windows-s1-ui）
| run | 提交 | 结果 |
|---|---|---|
| [39720157457](https://github.com/pf-sjtu/reelkiln/actions/runs/39720157457) | e7c847d | home、project_video PASS；attach 超时（驱动按 `/` 取文件名；拖放本身已成功，四个附件都 ready）。port windows：3 个 collector 测试失败（W14 的真实发现） |
| [39721017937](https://github.com/pf-sjtu/reelkiln/actions/runs/39721017937) | 7d1ed35 | attach、brief_send PASS；stream 只有 1 个工具：第 2 个 Bash 被 PreToolUse 钩子拒绝（CRLF verdict）。port windows 全绿（W13/W14 测试在 win32 上实际运行并通过） |
| [39722063287](https://github.com/pf-sjtu/reelkiln/actions/runs/39722063287) | da4e93b | stream PASS（6 个工具、7 轮、57 s）；V1 出现，但播放器 “This source is offline”（W11 实证） |
| [39723449397](https://github.com/pf-sjtu/reelkiln/actions/runs/39723449397) | daceceb | W11 修好：`currentSrc = vcmedia://local/D%3A/a/_temp/…/versions/v1.mp4`，readyState 4，6.5 s，720x1280；play 点到进度条；approve PASS；export：`Failed to get 'downloads' path` |
| [39724411939](https://github.com/pf-sjtu/reelkiln/actions/runs/39724411939) | ffb244c | **allPass=true**（第一次全绿） |

第一次全绿的 verdict（`artifacts/phase-b-m19/windows-s1-ci-39724411939/`）：
- home ✅ → project_video ✅ → attach ✅（拖放，4 个文件 ready）→ brief_send ✅ → stream ✅（53 s，6 个工具，7 轮，isError=false，自动标题 “S1 vertical cut”）
- play ✅：`vcmedia://local/D%3A/…/versions/v1.mp4`，播放 2.57 s 推进（**W11 在真 Windows 上验证**）
- approve ✅（V1 promote 为 final）
- export ✅：sha(final) == sha(v1) == sha(export) = `afd73a7c…`；ffprobe h264 720x1280 30fps + aac，6.500 s。与 Linux 的 sha 不同是因为 Windows 用的是 choco 的 ffmpeg 9 构建，编码器不同；时长、分辨率、编码与 Linux 一致。

## 2. 结论
- Windows 上原版 UI 主流程（导入 → agent 编辑 → 播放 → 批准 → 导出）跑通。过程中找到并修掉 3 个只在真 Windows 上出现、用户必然会碰到的缺陷：CRLF verdict（agent 完全不能执行命令）、W11 媒体 URL（所有预览离线）、collector 的 python 路径与 saved 路径校验（付费结果迟到后无法回收）。
- W13：没有 Git Bash 时 runBash 现在返回明确的错误（“安装 Git for Windows”），不再在 cmd 里“能跑但结果错”。win32 上用只含 System32 的 PATH 和空 Program Files 实际验证了选择 cmd → fail closed。
- W14：6 个 collector 测试在 win32 上全部运行并通过。
- macOS：`.app` packaged smoke（GUI 启动 + node 模式 SDK / sqlite 检查）在 macos-latest 上通过（非阻塞）。
- `windows-s1-ui` 两次全绿后改为阻塞（见 §3）。

## 3. 阻塞状态
`windows-s1-ui` 和 macOS packaged smoke 在连续两次全绿之前是 `continue-on-error`。第二次全绿的 run 和改为阻塞的提交记录在 docs/10 的 M19 增补里。

## 4. 仍未验证 / 弱于原版
- **W11b（新）**：聊天消息里 agent 给出的相对链接（`[Watch](jobs/<id>/final.mp4)`）在 Windows 上显示 “Link unavailable”。原版 `resolveDeliveryUrl()` 用 `file://${cwd}` 作为 base，Windows 的 `cwd` 会进入 URL host。Output 面板不受影响。修法需要改变传给渲染器的 `cwd` 形式，影响面大，本轮没做。
- Windows 渲染器 shim 是端口新增的：如果原版渲染器以后自己处理 Windows 路径，应删除。
- NSIS 安装后的应用没有跑 S1（只跑了 win-unpacked）；NSIS 安装 + packaged smoke 仍由 windows-package 覆盖。
- W6、W7、W8 仍未专门验证。
- Windows S1 只覆盖 FAKE-LLM 回放的关键路径；真实模型在 Windows 上的行为没有测（CI 里不放 key）。
