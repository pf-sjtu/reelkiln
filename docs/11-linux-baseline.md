# 11 · Linux 基线：引擎在 Linux 上真实运行

> 环境：box，Debian GNU/Linux 13 (trixie) x86_64，8 核。日期 2026-10-20（UTC+8）。
> 结论：**原版 0.0.40 自带的引擎 tarball（`engine-0.1.57-rc7-15f8f2d.tar.gz`，sha256 `0202ae15…`，与 manifest 一致）不改一个字节即可在 Linux 上安装、建 venv、通过 doctor（除需要凭据的 `gateway` 外全绿），并真实执行了一个无云端依赖的端到端渲染。** 移植版（打了 Windows 兼容补丁的 `repo/engine`）在 Linux 上产出逐字节相同的视频，`_compat_dirfd` 强制模拟模式下也相同。

## 1. 工具链安装

| 组件 | box 上的版本 | 命令 / 来源 | 与原版 bundle 的差异 |
|---|---|---|---|
| uv | 0.13.1 | 已预装于 `/usr/local/bin/uv`（官方安装脚本：`curl -LsSf https://astral.sh/uv/install.sh \| sh`） | 原版 uv 版本无法从 bundle 确定（docs/02） |
| CPython | **3.14.6**（uv 托管） | `uv python install 3.14.6` | 与 `engine/.python-version`、manifest `pythonVersion` 一致 |
| ffmpeg / ffprobe | 7.1.5-0+deb13u1 | `apt-get install ffmpeg`（box 已装） | 原版为 9.0.1（martin-riedl 构建）。doctor 只检查可执行与版本输出；本基线的渲染未触发版本相关差异 |
| node / npm | v24.22.0 | `/home/box/.n`（n 安装） | 原版 bundled node 为 22.17.0。目录布局与 bundle 相同（`node/bin/node`、`node/bin/npm`），直接把整个前缀链接为 `bootstrap/node` |

## 2. 走移植版主进程代码安装（port-cli）

不是手工 `uv sync`，而是让**移植的** `BootstrapCore`（`port/src/main/engine/bootstrap.ts`，原版 L9863-10085 的逐行移植）完成每一步，验证主进程 → 引擎的 spawn 链路。bootstrap 目录的布局仿照原版 `Resources/bootstrap`：

```
/workspace/vc-linux/bootstrap/
  engine.manifest.json                      # 原版（未改）
  engine-0.1.57-rc7-15f8f2d.tar.gz          # 原版（未改，sha256 0202ae15…）
  uv -> /usr/local/bin/uv
  ffmpeg -> /usr/bin/ffmpeg
  ffprobe -> /usr/bin/ffprobe
  node -> /home/box/.n                      # 含 bin/node、bin/npm
```

```bash
export PATH=/home/box/.n/bin:$PATH
cd /workspace/videoclaw/repo/port && npm run build
CLI=dist/cli/port-cli.cjs B=/workspace/vc-linux/bootstrap
node $CLI install-engine $B /workspace/vc-linux/ud     # sha256 校验 → tar 解包 → 复制 uv/ffmpeg/ffprobe 到 bin/
ENG=/workspace/vc-linux/ud/engines/engine-0.1.57-rc7-15f8f2d
node $CLI shims $ENG                                   # python3/python/pip3/pip/git shim（POSIX 版与原版逐字节相同）
node $CLI venv $ENG $B                                 # uv sync --frozen --project $ENG（UV_PYTHON_PREFERENCE=only-managed）
node $CLI remotion $ENG $B                             # npm ci + remotion browser ensure
node $CLI hyperframes $ENG $B                          # npm ci
node $CLI stage-workspace $ENG /workspace/vc-linux/ws  # 部分移植的 writeWorkspace
node $CLI doctor $ENG /workspace/vc-linux/ws $B
```

结果（`artifacts/linux-run/port-cli.repo-engine.jsonl` 为同流程用 repo 引擎的记录）：全部 `ok:true`；`uv sync --frozen` **无需任何偏离**（lockfile 在 Linux 上直接解析成功），venv 内 `python --version` → `Python 3.14.6`。

## 3. doctor 结果

完整 JSON：`artifacts/linux-run/doctor.json`（原版引擎）、`artifacts/linux-run/doctor-deep.json`（`--deep`，额外运行 `remotion versions`）、`artifacts/linux-run/doctor.repo-engine.json`（移植补丁版引擎）。手动复现命令：

```bash
env VIDEOCLAW_ENGINE=$ENG VIDEOCLAW_WORKSPACE=/workspace/vc-linux/ws VIDEOCLAW_JOBS_DIR=/workspace/vc-linux/ws/jobs \
    UV_PYTHON_PREFERENCE=only-managed PATH=$ENG/bin:$B/node/bin:/usr/bin:/bin \
    uv run --project $ENG python $ENG/tools/doctor.py --json
```

| 检查 | 结果 | detail |
|---|---|---|
| ffmpeg | ✅ | `$ENG/bin/ffmpeg · ffmpeg version 7.1.5-0+deb13u1` |
| ffprobe | ✅ | 同上 |
| node | ✅ | `v24.22.0` |
| python venv | ✅ | `imports ok: PIL, numpy, scipy, requests, dotenv, elevenlabs, fontTools, openai` |
| yt-dlp | ✅ | `venv yt-dlp 2026.06.09` |
| remotion | ✅ | `--deep`：`All packages have the correct version.` |
| **gateway** | ❌ **需要凭据** | `no VIDEOCLAW_API_KEY (env or engine .env)`。原版由 bootstrap 注入 `VIDEOCLAW_GATEWAY_URL` 与占位 key（L9704）并联网 `GET /healthz`；我们没有账号 key，按要求保留为红 |
| workspace | ✅ | `split · jobs=…/ws/jobs` |
| hooks | ✅ | `all hook paths use portable engine root · workspace bytes canonical` |
| taste packs | ✅ | `2 pack(s): _default, _starter` |

## 4. 端到端引擎运行（无云端）

工具：`assemble.py`（引擎自述 “deterministic, $0, no API” 的 EDL 执行器）+ `verify_output.py --mode render`（渲染后机械完整性检查）+ `render_timeline_strip.py --selftest`。

夹具（ffmpeg lavfi 生成，见 `tools/linux_baseline.sh`）：1280×720 testsrc2 + 440 Hz 正弦（2 s）、720×1280 彩条（2 s）、540×960 卡片 PNG、5.5 s 220 Hz 正弦 VO（mp3）。EDL：`artifacts/linux-run/e2e-assemble/edl.json`（3 个 beat：横屏 broll → 静帧卡片（默认 Ken Burns）→ 竖屏 broll，540×960@30）。

| 步骤 | 输出 | 证据 |
|---|---|---|
| `assemble.py --check` | `VO vo.mp3: 5.54s · timeline 5.50s · delta -0.04s [OK]` | — |
| `assemble.py` | 3 段归一化 + concat + VO 混音/响度 → `final_raw.mp4`（h264 540×960 30fps + aac，5.500 s），写出 `chunk_boundaries.json`、`run.log.jsonl`（3× `beat_assembled` + `timeline_assembled`）、`run.md`、`.videoclaw-job.lock` | `artifacts/linux-run/e2e-assemble/{assemble.stdout.txt, final_raw.ffprobe.json, chunk_boundaries.json, run.log.jsonl, run.md}` |
| `verify_output.py --mode render` | `STATUS: OK (mechanical checks passed)`，抽帧 2.75 s | `verify_output.stdout.txt`、`verify_frame_002.75s.png` |
| `render_timeline_strip.py --selftest` | `selftest: 20/20 passed` | — |

**等价性证明**（`artifacts/linux-run/e2e-assemble/final_raw.sha256`）：同一 job 分别用 ① 原版引擎、② 移植补丁版引擎（原生 dir_fd 路径）、③ 移植补丁版 + `VIDEOCLAW_PORT_DIRFD_EMULATE=1`（强制走 Windows 用的 `_compat_dirfd` 模拟路径）渲染，`final_raw.mp4` sha256 均为 `669ff565a825ad70…`；三者 `run.log.jsonl` 事件序列与字段集合一致。这说明 docs/09 的兼容补丁在 POSIX 上零行为变化，且模拟路径能完成一条真实的 log/锁/写文件链路。

未完成：`hyperframes_render.py --init textcard` 报 `Example not found: …/hyperframes/examples/textcard`——原版 tarball **不含** `hyperframes/examples/`（tarball 内容如此，非 Linux 问题）。需要自带合成目录（`--source-dir`）才能跑，留作后续。

## 5. 为在 Linux 上运行所需的引擎源码修改

**无。** 原版 tarball 原样运行。移植仓库对引擎的全部修改（docs/09 E1–E15）都是 Windows 兼容，在 Linux 上经上述等价性验证。

辅助工具改动（PORT-NEW）：
- `tools/make_windows_engine.py` 新增 `--target posix`（不改写 hooks 的 python 路径，产出 `engine-<v>-posix.tar.gz`，供 Linux 基线与 CI 用 repo 引擎打包）；并修复 Windows 上构建时 tar 成员名会含反斜杠的问题（`as_posix()`）。Windows tarball 在 Linux 上构建的 sha256 不变（`ea9f80af…`）。
- `tools/linux_baseline.sh`：一键复现本文全部步骤（bootstrap 目录 → port-cli 各步 → doctor 判定“除 gateway 外全绿” → 夹具 → assemble → verify）。用法：`OUT=/tmp/out tools/linux_baseline.sh [ROOT] [BOOTSTRAP_SRC]`；不给 `BOOTSTRAP_SRC` 时用 repo 引擎打 posix 包（CI 用法，因为原版 tarball 不入库）。

## 6. 需要凭据的部分（box 上无法完成）

- doctor `gateway`；以及所有走 `_gateway` 的付费工具（`mint_image`、`mint_video`、`synth_voice`、`lipsync_footage`、`gemini_video`、`look_at_video` 等）——需要 `VIDEOCLAW_API_KEY`。
- 网关下发引擎（`resolveEngineSource` 的 gateway 分支）。

## 7. Linux 上发现的主进程问题（已修复）

- **git shim 在 Linux 上屏蔽 git。** 原版 `gitShimScript`（L7238-7256）无条件写出探测 `/usr/bin/xcode-select` 的脚本——它是 macOS 应用，未区分平台。Linux 上 `xcode-select` 不存在，于是 `$ENG/bin/git` 永远输出 `git isn't available because this Mac doesn't have Apple's developer tools.` 并退出 1；而 `$ENG/bin` 在引擎 PATH 最前面，等于整个引擎会话里没有 git（box 上实测触发）。修复（PORT-NEW）：非 darwin、非 win32 平台改写 `posixGitShScript`，转发到 PATH 上真正的 git（`findRealGit` 跳过 shim 目录本身及其他 上游shim）；找不到时输出 PORT-NEW 文案 `git isn't available. Install git and restart VideoClaw.`。darwin 保持原版字节不变（差分测试仍断言相等）。同一个 `findRealGit` 也补上了 Windows 侧此前从未被传入的 `realGit`（之前 Windows git shim 总是“不可用”）。
- pip shim 的注释提到 Apple 开发者工具，但行为（拒绝 pip，提示由 Setup 安装包）是平台无关的，保持原样。
