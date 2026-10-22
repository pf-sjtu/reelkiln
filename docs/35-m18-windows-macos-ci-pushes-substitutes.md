# 35. M18：真实 Windows / macOS CI、两个 push 的运行时证明、embeddings 与具名模型付费工具的替代路线

日期：2026-10-22（SGT）。仓库已公开，GitHub Actions 恢复运行。真实 MiniMax 花费合计约 **$0.0054**（上限 $0.40）。CI 里从来没有 MiniMax key；需要 agent 的流程一律走 FAKE-LLM。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `347bc21` | 第一次真实 Windows/macOS 运行后的修正：codex `close()` 在 win32 上温和 taskkill 失败时升级为 `/F`（runbook 卡在 codex-handshake）；runbook 的握手加了上限；packaged smoke 给 GUI 路由单选一个 FAKE key（CI 没有 key 时单选被禁用）；`--test-timeout`/`--test-force-exit` 和各 job 的 timeout（macOS port job 在 m16-collector 之后挂住）；UI-e2e 的引擎更新 kick 接缝 |
| `605892b` | macOS 测试对 mkdtemp 根取 realpath（`/var` → `/private/var`，3 个失败）；win32 codex profile 检查改用原生 realpath（8.3 短名 `RUNNER~1`），大小写折叠，不一致时只打印路径 |
| `58f3844` | T1 运行时证明：`engine:updated`、`characters:voices:changed`（原版渲染器 + CDP，FAKE-LLM，$0）；第一批 CI 证据 |
| `7f2e1da` | T3：`synth_voice`/tts 的可选、带标注 MiniMax 替代路线 + 真实证明（$0.001703）；embeddings 探测证据 |
| `a319414` | CI：L0 失败时输出 step 日志；master 上的 push 不再取消正在跑的 CI（`cancel-in-progress` 只对 PR 生效） |
| `6f2099b` | Windows：引擎 venv 启动钩子把裸 `npx`/`npm` 映射到 `node.exe npx-cli.js`（compose_render 在真 Windows 上 `WinError 2`） |
| `f85cd9b` | T3：`mint_image`（纯文本、jpeg）→ MiniMax image-01 的替代路线 + 真实证明（$0.003735） |
| `8f26558` | Windows：同一钩子里，对只读句柄的 `os.fsync` 改用写句柄刷新（引擎 `publish()` 在真 Windows 上 EBADF） |
| `c400edf` | `accept_check.py` 解析 Git for Windows `sha256sum` 的 `hash *name` |
| `a5aa800` | L0 通过那一轮的 CI 证据、覆盖率 |
| （本文档提交） | docs/35、docs/10 增补、docs/13 §4、覆盖率 |

## 1. Phase 1：真实 Windows / macOS CI
所有时间为 SGT（UTC+8）。job 名称见 `.github/workflows/ci.yml`；日志在 `artifacts/phase-b-m18/ci/`。

### 1.1 逐轮结果
| run | 提交 | 结果 |
|---|---|---|
| [39708170235](https://github.com/pf-sjtu/reelkiln/actions/runs/39708170235) | 公开后第一轮 | port windows 316/324（8 跳过）✅；port ubuntu ✅；engine-static ×3 ✅；linux-baseline ✅；macos-package ✅（dmg 276,750,076 B）；windows-package ❌（GUI smoke 选 minimax 单选失败：CI 无 key → 单选禁用）；port macos 挂住；windows-runbook S3–S8 ✅，S9 codex-handshake 挂住 |
| [39710539898](https://github.com/pf-sjtu/reelkiln/actions/runs/39710539898) | 347bc21 | windows-package ✅（win-unpacked 与 NSIS `/S /D=` 静默安装后的 smoke 都是 `DONE failed=[]`）；port macos 3 个失败（/private/var）；runbook codex profile 不一致（8.3 短名） |
| [39711079050](https://github.com/pf-sjtu/reelkiln/actions/runs/39711079050) | 605892b | port windows/macos/ubuntu ✅；其余 ✅；runbook 被我的 push 取消 |
| [39711542276](https://github.com/pf-sjtu/reelkiln/actions/runs/39711542276) | 58f3844 | **WINDOWS RUNBOOK OK**（S3–S9 全过，含 codex-handshake `{"ok":true}` 762 ms、Git Bash runBash）；L0 在 compose_render 失败（无日志） |
| [39712365635](https://github.com/pf-sjtu/reelkiln/actions/runs/39712365635) | a319414 | L0 日志：`subprocess.run(["npx", …])` → `FileNotFoundError: [WinError 2]` |
| [39713813148](https://github.com/pf-sjtu/reelkiln/actions/runs/39713813148) | 6f2099b | Remotion 在 Windows 上渲完 195/195 帧、编码完成；`publish()` 里 `os.fsync` 只读句柄 → `OSError: [Errno 9]`。port windows 322 通过 / 9 跳过 / 0 失败，macos 329/2/0，ubuntu 330/1/0（331 项） |
| [39714959830](https://github.com/pf-sjtu/reelkiln/actions/runs/39714959830) | 8f26558 | compose_render 发布成功，`verify_output STATUS: OK`；`accept_check.py` 读 `*clip_a.mp4` 失败 |
| [39716976884](https://github.com/pf-sjtu/reelkiln/actions/runs/39716976884) | c400edf | **全部 job 通过**：runbook S3–S9 OK + **L0 ACCEPT PASS（E1–E15 全部 true）**，final.mp4 sha `879b301a…`，h264 + aac，6.5 s；windows-package 两种 smoke `DONE failed=[]`（setup 240,463,103 B sha `1e0f31ea…`，portable 210,794,478 B sha `a55221ec…`）；macos-package dmg 276,805,305 B sha `56f71b75…`；port windows 323/9 跳过/0 失败，macos 330/2/0，ubuntu 331/1/0（332 项） |

### 1.2 在真实 Windows（windows-latest）上验证过的
- **port 单测**：322 通过 / 9 跳过 / 0 失败（run 39713813148）。跳过项是需要 POSIX 假引擎的 collector 等测试（W14 仍然成立）。
- **runbook S3–S9**：引擎安装、POSIX 兼容 shim（python/pip/git 的 sh 与 `.cmd`）、uv + CPython 3.14.6、remotion `npm ci` + browser ensure、hyperframes、engine contracts、doctor（除 gateway 外全绿；gateway 需要真 key）、assemble + verify e2e、codex win32 握手（W9：温和 taskkill 对无窗口控制台程序无效，现在升级为 `/F`）、Git Bash runBash。
- **L0 E1–E15**（`tools/accept_engine_chain.sh` 在 runbook 装好的引擎上，Git Bash）：fixtures → production_guard → assemble → compose_render（Remotion 在 Windows 上真实渲染）→ verify_output `STATUS: OK` → `accept_check.py --engine-only`：E1–E15 全部通过（`artifacts/phase-b-m18/ci/run39716976884-accept-L0.json`、`-l0-final.ffprobe.json`）。这是第一次在真实 Windows 上完成原版引擎的完整 $0 渲染链。
- **windows-package**：nsis setup（240,461,954 B）+ portable（210,793,326 B）；win-unpacked 和 NSIS 静默安装后的打包应用 smoke 都是 `DONE failed=[]`（**W12 已在真 Windows 上解决**：wine 下的 exit 2 是 wine 的问题）。
- **macos-package**：未签名 dmg 能构建；port 单测在 macos-latest 上 329/2/0。没有在 macOS 上跑打包应用 smoke 或 runbook。

### 1.3 这一轮在真 Windows 上找到并修掉的缺陷
1. codex app-server 关闭：不带 `/F` 的 taskkill 对无窗口控制台程序返回失败，`close()` 没有升级，事件循环被 codex.exe 挂住。
2. codex profile 检查：Node 的 JS `realpathSync` 在 Windows 上保留 8.3 短名，原生实现会展开；比较前统一改用 `realpathSync.native`，去掉 `\\?\`，大小写折叠。
3. **引擎（原版只在 macOS 上跑）**在 Windows 上的两处问题，没有改引擎源码，而是在端口创建的 venv 里放一个启动钩子（`.venv/Lib/site-packages/videoclaw_port_winexec.pth`，只在 win32 写入、只在 win32 生效）：
   - 裸 `npx`/`npm`：CreateProcess 只补 `.exe`，而 npm 的启动器是 `.cmd`。钩子把它映射为 `node.exe <node 目录>/node_modules/npm/bin/npx-cli.js …`，不经过 cmd.exe（JSON `--props=` 里的 `& | % ^` 不会被二次解析），和端口自己的 `npmInvocation` 做法一致。
   - `publish()` 对 `"rb"` 打开的句柄 `os.fsync`：Windows 的 `_commit` 需要写权限。钩子在 EBADF 时用 `GetFinalPathNameByHandleW` 取路径，以 `r+b` 再开一次并 fsync，原版要求的持久化没有被跳过。
4. 测试和工具：macOS `/private/var`；Git for Windows 的 `sha256sum` 输出 `hash *name`。
5. 打包 smoke：CI 没有 key 时原版的路由单选是禁用的，smoke 用一个明显的假 key（smoke 从不调用模型）。

### 1.4 Windows FAKE-LLM S1 UI e2e：**没有做**
现有的 S1 UI 驱动（`port/tools/ui-e2e.mjs`）依赖 xvfb-run、dbus + gnome-keyring、`cp -al`，而现有的 FAKE 上游（`m15-fake-anthropic-upstream.mjs`）只会回放单步工具调用，不会编排 S1 的 assemble → compose → export。要在 windows-latest 上做，需要新写一个能编排 S1 的 FAKE 上游、给驱动加 Windows 启动分支（DPAPI 凭据、无 Xvfb）、确认 claude agent SDK 的 win32 二进制在打包里可用，每次 CI 迭代约 15 分钟。本轮优先把 L0 引擎链在真 Windows 上跑通（这是 S1 的前提）。**原版 UI 主流程在 Windows 上仍未验证。**

### 1.5 CI 配置变化
- `concurrency.cancel-in-progress` 只对 PR 生效：之前每次 push 都会取消正在跑的 runbook，两次丢了结果。
- 之前 `windows-runbook`、`windows-package`、`macos-package` 是 `continue-on-error: true`，run 的总结论是 success 不代表这些 job 通过（上表各轮以 job 结论为准）。L0_CONTINUE

## 2. Phase 2（M18）
### 2.1 `engine:updated` 与 `characters:voices:changed` 的运行时证明（FAKE-LLM，$0）
`node port/tools/ui-e2e-m18-pushes.mjs --run RUN --engine ENGINE --dist DIST --seed SEED`，证据在 `artifacts/phase-b-m18/pushes-proof/`（路径已替换为 `$RUN`，key 命中 0）。
| 步骤 | 断言 | 结果 |
|---|---|---|
| L1_setup | 全新 profile，New video，读取 scope，`lastEngineVersion` = 已装版本 | PASS |
| V_approve_push | HARNESS 用 verbatim `CharacterVoiceStore` 准备一个音色（app 关闭时）；原版 UI 播放样本后点 approve → main 发出 `characters:voices:changed` → 原版重新 `characters:voices:list`，项目音色 chip 出现 | PASS |
| V_remove_push | 原版 UI remove → 第二次 push → 再次 list，卡片消失，磁盘上 0 个音色 | PASS |
| E_engine_updated_live | 候选引擎 `0.1.57-rc8-m18harness`（HARNESS：已装 tarball 改版本号）经 `VIDEOCLAW_ENGINE_DIST`；原版启动时的 update tick 触发后台安装 → venv/remotion/hyperframes → doctor → flip → `engine:updated {version}` → 原版实时显示 “engine updated — new tricks available” toast（13.5 s），`lastEngineVersion` 更新 | PASS |
HARNESS 输入：Xvfb、预先准备的音色和 sine WAV、候选引擎 dist（node_modules 软链到只读引擎以省磁盘）、`VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1`（doctor 的 gateway 检查需要真 key）。kick 接缝这次没有用上（启动 tick 已触发）。

### 2.2 embeddings（真实探测，16 tokens，<$0.00001）
- `POST https://api.minimaxi.com/v1/embeddings` 的 OpenAI 形状 `{model:"embo-01", input:[…]}` 被拒（`status_code 2013 … texts missing`）：**不是 OpenAI 兼容**。原生形状 `{texts, type}` 返回 1536 维、仅文本。
- 原版引擎的用法（`tools/_media/embedder.py` GatewayEmbedder，`index_media.py`）：`library:sync` 对**视频片段和静态图**做 768 维多模态嵌入，搜索时用文本/图像查询在同一空间里比对。
- 结论：embo-01 没有视频/图像模态，没有共享的文本↔视频空间，1536 ≠ 768。**不能服务**；shim 对 `embed` 维持 422 `TOOL_NOT_OFFERED`（not_submitted，$0）。证据：`artifacts/phase-b-m18/embeddings-probe.json`、`remains-before-real.json`。

### 2.3 具名模型付费工具：可选、带标注的 MiniMax 替代路线
默认行为不变（与原版失败分支一致：422 `TOOL_NOT_OFFERED`，不收费）。设置 `VIDEOCLAW_PORT_MINIMAX_SUBSTITUTE=synth_voice,mint_image`（所有者自行开启）后，shim 用 MiniMax 服务以下请求，走与 `model_call` 完全相同的耐久 operation / 精确报价 / permit / 签名 asset / 账本流程；**每个报价、operation 视图、账本行、日志都带 `substitute` 标注**（`label: "SUBSTITUTE (not the named model)"`、`requested_model`、`served_model`，TTS 还有 `requested_voice`/`served_voice`），`route_mode` 为 `substitute:<slug>`。这不是对原版的忠实再现：模型和音色都不同。
| 工具 | 何时替代 | 服务模型 | 真实证明（真实引擎脚本 → 端口 verbatim AgentGatewayProxy → shim → MiniMax） |
|---|---|---|---|
| `synth_voice` | 仅 `mode:"tts"` 且有 text；音色：`VIDEOCLAW_PORT_MINIMAX_SUBSTITUTE_VOICE`，否则中文用 `female-shaonv`、其他用 `English_expressive_narrator` | `minimax/speech-2.8-turbo` | `synth_voice.py --mode tts --voice Kore --no-stretch`（请求的是 `gemini-3.1-flash-tts`）：57 计费字符，**$0.001703**（报价上限同值），4.428 s mp3 被引擎下载到 `tts/m18sub.mp3` 并写入 json |
| `mint_image` | 仅纯文本（无 references = 不是编辑）、`--output-format jpeg`（image-01 只返回 JPEG，png 交付会是错误字节）、image-01 支持的宽高比、1–4 张 | `minimax/image-01` | `mint_image.py --role cover --aspect 9:16 --output-format jpeg`：1 张 720×1280 JPEG，**$0.003735**，引擎写入 `images/m18img.jpeg` 和 `_index.json` |
证据：`artifacts/phase-b-m18/substitute-proof/`（fake 与 real 各一份、前后 token-plan remains；key 命中 0，不含 mp3/jpg）。单测：`port/test/m18-substitute.test.ts`（默认关闭、标注、拒绝范围）。
注意：引擎自己写的 `tts/*.json` / `images/_index.json` 仍记录它**请求**的模型（例如 `provider_model: fal-ai/gemini-3.1-flash-tts`）；真实服务模型以 shim 账本和 operation 的 `substitute` 字段为准。

仍然拒绝（422，不收费）以及原因：
- `synth_voice` 的 design / voice_change / transcribe / reference_tts：需要音色设计、变声或语音识别，MiniMax 对应能力的契约不同（克隆需要参考音频与授权确认），没有做小规模可验证的映射。
- `mint_image` 的编辑（references）、png/webp 输出：image-01 不支持编辑语义，也不出 PNG。
- `mint_video`：引擎请求具名视频模型（含参考图/首尾帧、时长档位），只有 hailuo-02 i2v 512p 已经通过 `model_call` 提供；具名映射会改变分辨率和时长语义，本轮不做。
- `preview_session_shot`、`character_voice`、`plan_paid_operations`：前两者是托管服务的会话预览/角色音色流水线，后者是托管网关的批量规划 API，MiniMax 没有对应端点。
- `embed`：见 2.2。

## 3. 覆盖率与测试
- IPC 共 184 项：real 117、real-partial 42、push-real 23、local 1、real-env 1、push-none 0（`artifacts/phase-b-m18/ipc-coverage.txt`）。`engine:updated` 与 `characters:voices:changed` 现在有运行时证明。
- stub_audit 116 项，stub 0（`stub-audit.txt`）。
- 测试 332/332（Linux 本机）；CI run 39716976884：windows 323 通过/9 跳过、macos 330/2、ubuntu 331/1，0 失败。

## 4. 花费
| 项目 | 花费 |
|---|---|
| embeddings 探测（16 tokens） | <$0.00001 |
| synth_voice 替代证明 | $0.001703 |
| mint_image 替代证明 | $0.003735 |
| **合计** | **≈ $0.0054**（上限 $0.40）。调用前 token-plan general 窗口剩余 85% / 83% / 74% |
| CI | 公开仓库，免费 |

## 5. 离 100% 还差（更新）
1. Windows S1 UI e2e（FAKE-LLM，原版渲染器）——见 1.4。
2. W11（原版渲染器用 `/` 拼 `vcmedia://`，原生 Windows 路径会让媒体预览失效）仍需在真 Windows 的 UI 里观察；W13（无 Git Bash 时退回 cmd）；W14（collector 在 win32 跳过）。
3. macOS：只验证了单测和 dmg 构建；没有打包应用 smoke、runbook、签名/公证。
4. macOS 上 port job 曾挂住的真正原因（泄漏的句柄）没有定位，现在靠 `--test-force-exit` 兜住。
5. 多模态 embeddings 后端（library:sync/search）——MiniMax 无法提供。
6. 具名模型付费工具中仍拒绝的部分（2.3 列表）；替代路线是可选的近似，不是原版。
7. 真实 Claude 订阅分支、macOS 本机语音听写、托管登录 / nightly / 生产更新源——与 docs/34 相同。
