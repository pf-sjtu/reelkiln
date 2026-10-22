# 34. M17：docs/33 余项（restart / pendingToast / 三个 push / 退出计数 / 工作暂停）+ Windows 移植

日期：2026-10-22（SGT）。这一轮没有调用真实模型：$0（MiniMax 只用了 fake key）。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `c3b9c08` | T1 主体：verbatim `CharacterVoiceStore`，`characters:voices:list/approve/remove` 改为真实实现，并发出 `characters:voices:changed`；Bootstrap 后台引擎更新路径（`checkForEngineUpdate`/`installEngineUpdate`/`tryFlipPendingEngine`/`refusePendingEngine`）加 `engine:updated` push；`window:state`（`wireWindowState`）；`stopAuthenticatedWork` 与 `authenticatedWorkPaused` 的 14 处门禁；`readQuitState` 的附件 / 工作中 / 语音计数；新增 6 个单测 |
| `4071f42` | T1 运行时证明：`tools/ui-e2e-m17-restart.mjs`，在 AppImage 上走原版 UI，6/6 PASS；AppImage 内 relaunch 改用 `$APPIMAGE`（`src/main/relaunch.ts`）；修正 agent-sdk 测试里写死的 POSIX 路径（真 Windows CI 最后一次运行时的 2 个失败） |
| `37d0ac9` | T2 CI：Windows runbook 之后接 L0 E1–E15；新增 `windows-package`（nsis + portable + packaged smoke）和 `macos-package`；`accept_engine_chain.sh` 支持 Git Bash；`packaged-smoke.mjs` 支持 Windows（win-unpacked / NSIS 静默安装） |
| `9ac3c01` | T2：在 WINE 中以 win32 Node 跑单测，据此修掉 6 处真实 Windows 缺陷；测试改为 win32 安全；`ipc_coverage` 能识别 `sendToRenderer` 发出的 push |
| （本文档提交） | docs/34、docs/10 增补、证据 |

## 1. T1 余项
### 1.1 运行时证明（packaged AppImage + 原版渲染器 + CDP，FAKE-LLM，$0）
`node tools/ui-e2e-m17-restart.mjs --run RUN --app release/Videoclaw-Port-0.0.40-port.0-linux-x86_64.AppImage --engine $ENGINE`，证据在 `artifacts/phase-b-m17/restart-proof/`：

| 步骤 | 断言 | 结果 |
|---|---|---|
| A_no_toast_fresh_profile | 全新 profile 下 `engine:pendingToast()` 返回 null，没有 `.engine-toast`；settings 的 `lastEngineVersion` 被写成当前引擎版本 | PASS |
| A_window_state | 进入全屏后 main 发出 `window:state {fullscreen:true}`，原版 `.app` 带上 `fullscreen` class；退出全屏后发出 false，class 去掉。push 序列为 false（did-finish-load）→ true → false | PASS（方法见下方说明） |
| B_pending_toast | HARNESS 在应用关闭时把 `lastEngineVersion` 改成旧值；重新启动后 `pendingToast` 返回 `{version}`，原版显示 “engine updated — new tricks available”（截图 `B-toast.png`） | PASS |
| B_save_key | Settings → Billing & credits → 粘贴 key → Save → `gateway:verify` ok → 显示 “Saved for next launch as Local studio…” → 出现 “Restart now” 按钮 | PASS |
| C_app_restart_relaunch | 点击 “Restart now” → `app:restart` → 旧进程 exit 0 → Electron 自己用 AppImage 路径重新拉起（ps 里的命令行是 `…/apps/Videoclaw-Port-….AppImage --no-sandbox --remote-debugging-port=… --user-data-dir=…`）；新进程能接上 CDP，并且发起 settings/account/session 等 IPC | PASS |
| C_no_toast_after_restart | 重启后 `pendingToast` 返回 null，没有 toast；新进程的 storedKeyId 等于 harness key 的 sha256 | PASS |

几点说明：
- 原版的手动 key 必须有该 key 自己的 alpha consent，否则 `legacyKeyOnly=false`，会落到 signed-out 的 Welcome 页。我第一次运行时就落到了这里，这正是原版的行为。为了证明 restart 路径，harness 预先写入了这把 key 的 consent 记录（按 `alphaConsentKeyId` L5161 计算），并明确标注为 HARNESS 输入。
- `window:state`：Electron 没有实现 `Browser.getWindowForTarget`；在 Xvfb 下没有 WM，xdotool 发 F11 拿不到焦点。所以用的是 `document.documentElement.requestFullscreen()`（CDP userGesture）。它会让真实的 BrowserWindow 发出 enter/leave-full-screen，push 是 main 真实发出的，但触发方式不是用户按键。
- 端口修正（Linux）：AppImage 内 `process.execPath` 指向临时挂载或解包目录，进程退出后即消失，因此 relaunch 改为 `{ execPath: $APPIMAGE, args: argv.slice(1) }`（与 electron-updater 做法一致）。macOS 和 Windows 保持 Electron 默认。我**没有**在 AppImage 上做 A/B 对比（不改时是否一定失败）。
- `VIDEOCLAW_PORT_RESTART_REAL=1` 是新增的 harness 开关：UI-e2e 模式默认只记录 restart、不真正执行，加了这个开关才会真的 relaunch。

### 1.2 只有单测、没有运行时证明的部分
- `engine:updated`：后台更新 9.9.9 → 9.9.10，视频运行中先停放，空闲后切换并触发 onEngineUpdated，sha 失败后不会重试（`m17-leftovers.test.ts`）。原版渲染器收到这个 push 后显示的 toast 与 pendingToast 是同一个组件，后者已有运行时证明。
- `characters:voices:changed`：approve 和 remove 都会发出 scope（verbatim store）。
- `readQuitState`：附件计数与原版 `assessQuit` 的文案逐字比对（“2 attachments you never sent”）。
- `stopAuthenticatedWork` / `authenticatedWorkPaused`：14 处门禁都有单测。

## 2. T2 Windows
### 2.1 CI（**被账单阻断，没有任何 job 启动**）
本轮 4 个 run：[39693619800](https://github.com/pf-sjtu/reelkiln/actions/runs/39693619800)、[39694780613](https://github.com/pf-sjtu/reelkiln/actions/runs/39694780613)、[39695184650](https://github.com/pf-sjtu/reelkiln/actions/runs/39695184650)、[39696799047](https://github.com/pf-sjtu/reelkiln/actions/runs/39696799047)。每个 job 的注解都是 “The job was not started because recent account payments have failed or your spending limit needs to be increased”。最后一次 job 真正执行的是 39547313316（2026-10-21 13:03 SGT）：windows-latest 上 port 单测 161/163，2 个失败已在 `4071f42` 修正。需要 PF 修复 GitHub 账单或调高 spending limit。把仓库改为 public 也能免费跑 Actions，但这是对外可见的变更，我没有做。

已经写进 `ci.yml`，等账单恢复后会自动跑：
- `windows-runbook`：原有 S3–S9（引擎安装、POSIX 兼容 shim、uv/CPython 3.14.6、remotion/hyperframes、doctor 除 gateway 外全绿、assemble+verify e2e、codex win32 握手、Git Bash runBash）。之后新增 **L0 E1–E15**：在 runbook 装好的引擎上跑 `accept_engine_chain.sh`，并上传 `accept-L0.json`、final.mp4 的 sha256 和 ffprobe。
- `windows-package`：`npm run package:win`（nsis + portable）→ `packaged-smoke.mjs release/win-unpacked release/*-setup.exe`（GUI smoke + node 模式 SDK/sqlite 检查；NSIS 用 `/S /D=` 静默安装到临时目录）→ 上传产物。
- `macos-package`：`npm run package:mac`（未签名 dmg），只记录能否构建以及 sha。
- S1 UI e2e over CDP（FAKE-LLM）**没有写进 Windows CI**。它依赖完整引擎、agent SDK 和 scripted upstream，在 CI 从未能启动的情况下堆这一层性价比太低，留作下一步。

### 2.2 box 上能做的替代验证（全部标注为 **WINE**，WINE ≠ Windows）
- **win32 单测**：wine 10，加官方 `node-v22.23.4-win-x64`（`process.platform === "win32"`），跑全部 324 个测试。修正前 297/323；修正后 **311 通过 / 6 失败 / 7 跳过**。剩下的 6 个失败都是 wine 环境缺东西：没有 `tar.exe`（3 个），没有 Git Bash、runBash 退回 cmd（3 个）。证据在 `artifacts/phase-b-m17/wine-win32-tests/*.tap`。
- **修掉的真实 Windows 缺陷**（详见 docs/10 增补）：CharacterStore 和 Quickstart 的目录包含判断、project trash 的分段、voices.json 的 POSIX 路径、taste 标题、codex 的 win32/darwin vendor 布局、vcmedia 的 `/C:/` 路径。另外还有测试侧问题：POSIX 文件权限断言、写死的 POSIX 路径、unref 定时器导致事件循环提前结束。
- **交叉构建**：box 上装好 wine32 之后，`npm run package:win` 产出 `Videoclaw-Port-0.0.40-port.0-win-x64-setup.exe`（240 MB）和 `-portable.exe`（211 MB），sha 见 `artifacts/phase-b-m17/win-cross-build/`。NSIS 在 wine 下静默安装返回 exit 2，结论不明。
- **WINE 下的打包主进程**：main 能启动（注册了 157 个 handle、renderer URL 已解析），渲染器 smoke 在 150 s 内没有完成（wine 的 GPU 和 DirectComposition 问题），记为未验证。
- **Linux 回归**：改成同时支持 Git Bash 之后的 `accept_engine_chain.sh`，在只读 ENGINE 的副本上重跑得到 `L0 ACCEPT PASS`（`artifacts/phase-b-m17/linux-l0/`）。副本跑完已删除，原 ENGINE 没有写入。

## 3. 覆盖率（`T3-ipc-coverage.txt` / `T3-stub-audit.txt`）
- IPC 共 184 项：real 117、real-partial 42、push-real 23、local 1、real-env 1、**push-none 0**（M16 时为 3）。
- stub_audit 共 116 项，stub 为 0（a 类 56/56；b 类 58 项中 55 项完成、3 项 partial；c 类 2 项）。
- 测试 **324/324** 通过（Linux）；`npm run build` 通过；`tsc --noEmit` 干净；`npm run gen` 结果确定（重复生成无 diff）。

## 4. 花费
| 项目 | 花费 |
|---|---|
| 真实 MiniMax | **$0**（没有任何真实调用，所以也没有查询 token-plan） |
| CI | 0 分钟（被账单阻断） |

## 5. 已验证 / 未验证 / 风险
### 已验证
- `engine:pendingToast`、`app:restart`（含自动 relaunch）、`window:state`：packaged AppImage + 原版 UI，6/6 PASS。
- `engine:updated`、`characters:voices:changed`、`readQuitState` 计数、`authenticatedWorkPaused` 门禁：单测。
- L0 E1–E15 在 Linux 上通过（改动后回归）。
- win32 Node 单测 311/324（WINE），修掉了 6 处 Windows 路径缺陷。
- Windows nsis 和 portable 能在 Linux 上交叉构建。

### 未验证
- **真实 Windows 上的一切**：engine doctor、L0、package、packaged smoke、S1。CI 被账单阻断。
- macOS package。
- `engine:updated` 和 `characters:voices:changed` 在 UI 中的运行时效果；退出对话框里附件计数的运行时显示。
- relaunch 修正的 A/B 对比；Windows 和 macOS 上的 relaunch。

### 风险
- W11：原版渲染器用 `/` 拼接 `vcmedia://` URL，原生 Windows 路径会让媒体预览失效。
- W12：NSIS 静默安装在 wine 下 exit 2。
- W13：没有 Git Bash 时 runBash 退回 cmd，“能跑但结果错”。
- W14：Windows 上没有 collector 测试覆盖。
- 真 Windows CI 停在 2026-10-21，之后新增的 161 个测试在真 Windows 上从未跑过，只在 WINE 下跑过。

## 6. 离 100% 还差（更新）
> **M19 更新（docs/36）**：Windows S1 UI e2e（FAKE-LLM）在 windows-latest 上 allPass（run 39724411939），途中修掉 CRLF verdict、W11 媒体 URL、W14 collector 路径；W13 改为 fail closed；macOS `.app` packaged smoke 通过。第 1、2 条除 W11b（聊天内相对链接）外完成。
> **M18 更新（docs/35）**：第 1 条已基本完成——Actions 已恢复（仓库公开），windows-runbook + L0 E1–E15、windows-package（nsis + portable + 两种 packaged smoke）、macos-package 在真机上全部通过（run 39716976884）；Windows S1 UI e2e 仍未做。第 2 条里 W12 已解决。第 3 条：MiniMax embo-01 经真实探测确认无法提供多模态 embedding。第 4 条：`synth_voice`/tts 与 `mint_image`（纯文本 jpeg）有了可选、带标注的 MiniMax 替代路线（真实证明 $0.0054），其余仍拒绝。第 8 条：`engine:updated` 与 voices push 已有运行时证明。最新清单见 docs/35 §5。

1. **恢复 GitHub Actions**（PF：修复账单 / spending limit，或批准把仓库设为 public），然后跑 windows-runbook + L0、windows-package，修掉实际出现的问题；再加 Windows S1 UI e2e（FAKE-LLM scripted upstream，用 ffprobe/sha 核验）。
2. W11 的 Windows 媒体 URL（需要在真 Windows 上确认哪些路径会到渲染器）；W12 NSIS 安装；W13 和 W14。
3. 多模态 embedding 后端（library:sync/search）。
4. 不适配的付费工具：mint_video/mint_image/synth_voice 的具名模型路由、preview_session_shot、character_voice、plan_paid_operations。
5. 真实 Claude 订阅分支（creditHandoffOffer），目前只能注入。
6. macOS 本机语音听写（平台限制）。
7. 托管登录（上游官网账号平面）和 nightly 通道；生产环境 update feed；非 darwin 平台的更新门槛。
8. ~~push-none 3 项~~、~~readQuitState 附件计数~~、~~authenticatedWorkPaused~~、~~app:restart 和 engine:pendingToast 的运行时证明~~：本轮已完成。`engine:updated` 和 voices push 仍只有单测。
