# 09 · 引擎（engine/）Windows 兼容层

> 范围：`engine/`（引擎 0.1.57-rc7-15f8f2d 源码，与 bootstrap tarball 内容一致）。原则：**macOS/Linux 运行时行为不变**、最小 diff、每处改动可追溯。所有 Windows 分支**均未在 Windows 实机上验证**（box 是 Linux），只做了：`py_compile`、Linux 实测 POSIX 分支、以及在 Linux 上模拟 Windows 的导入冒烟测试。
>
> `engine-extract/engine/`（原始解包）未改动；原文件可用 `git show 4925847:engine/tools/<file>` 取回（Phase 1 提交即原版）。

## 1. 已做的改动

| # | 文件 | 改动 | POSIX 行为 | Windows 状态 |
|---|---|---|---|---|
| E1 | `tools/_compat_lock.py`（新增） | `flock` 兼容层：POSIX 直接 `from fcntl import flock, LOCK_*`（同一函数对象，测试断言 `m.flock is fcntl.flock`）；Windows 用 `msvcrt.locking` 锁第 0 字节 1 字节——与引擎自身 `_media/library_lock.py`、`remotion_lock.py` 已有的 Windows 写法相同 | 完全相同 | 未验证。差异：`LOCK_SH` 按独占处理；`LOCK_NB` 冲突抛 `BlockingIOError(EAGAIN)`（满足所有调用方的 `except BlockingIOError` 与 `errno in (EAGAIN, EACCES)`）；阻塞模式轮询 `LK_NBLCK`（20 ms）；对未加锁区域 `LOCK_UN` 为空操作；恢复 fd 文件位置 |
| E2 | `_render_completion.py` L57、`_takes.py` L51、`lipsync_footage.py` L77、`log.py` L27、`prepare_production.py` L30 | `import fcntl` → `import _compat_lock as fcntl`（单行；调用点不动） | 相同 | 未验证 |
| E3 | `tools/_compat_proc.py`（新增） | `new_session_kwargs()`（POSIX `{"start_new_session": True}`；Windows `CREATE_NEW_PROCESS_GROUP`）、`kill_process_group(pid)`（POSIX `os.killpg(pid, SIGKILL)`；Windows `taskkill /PID <pid> /T /F`）、`kill_own_process_group()`（POSIX `os.killpg(os.getpgrp(), SIGKILL)`；Windows taskkill 自身树后 `os._exit(137)`） | 相同 | 未验证 |
| E4 | `_render_completion.py` `_kill_group` L495、`Popen` L547 | `os.killpg(proc.pid, signal.SIGKILL)` → `_compat_proc.kill_process_group(proc.pid)`；`start_new_session=True` → `**_compat_proc.new_session_kwargs()`；原 `except (ProcessLookupError, PermissionError, OSError)` 保留 | 相同 | 未验证 |
| E5 | `_render_review_child.py` `_supervise` L62 | `os.killpg(os.getpgrp(), signal.SIGKILL)` → `_compat_proc.kill_own_process_group()`（之后原 `finally: os._exit(3)` 不变） | 相同 | 未验证；Windows 上 taskkill 会连同父 review 命令的子树？——不会：只杀 `os.getpid()` 为根的树（父进程不在其中），与 POSIX 杀“本进程组”语义接近但不等同 |
| E6 | `review_render.py` `_run_worker` L381 | `start_new_session=True` → `**_compat_proc.new_session_kwargs()` | 相同 | 未验证 |
| E7 | `prepare_production.py` L150 | `PORTABLE_ENGINE_PYTHON`：`os.name == "nt"` 时为 `${VIDEOCLAW_ENGINE:-$CLAUDE_PROJECT_DIR}/.venv/Scripts/python.exe`，否则原值 | 相同 | 未验证；**必须**配合 E9 的 Windows 版 `settings.json`，否则 doctor `hooks` 检查（`portable_settings_errors`）不通过 |
| E8 | `.claude/hooks/preflight.sh` L69 | `PY` 不可执行且 `.venv/Scripts/python.exe` 可执行时改用后者 | macOS/Linux 永远不存在 `Scripts/python.exe` → 相同 | 未验证（Git Bash 下运行） |
| E9 | `tools/make_windows_engine.py`（repo 根 tools/，**port-only**，不进引擎） | 生成 Windows 引擎 tarball：复制引擎、把 `.claude/settings.json` 中 2 处 `/.venv/bin/python` 改为 `/.venv/Scripts/python.exe`、按原布局（顶层 `engine/`、uid/gid 0）打包、更新 manifest 的 `file`/`sha256`（可复现，box 上两次构建字节一致） | — | app 只校验 manifest `sha256`（L10007-10011），无签名；`variant` 字段 app 不读取，保持不变 |
| E10 | `_takes.py` L65 模块级 `_DIR_FLAGS` | `os.O_DIRECTORY/O_NOFOLLOW/O_CLOEXEC` → `getattr(os, …, 0)` | POSIX 上取值相同 | 仅解决**导入**崩溃；运行时见 §3 B1 |

## 2. 验证（box 上）

- `python3 -m py_compile` 全部改动文件通过。
- `python3 tools/test_engine_compat.py`：8 项通过——POSIX `flock` 为原函数、跨进程 `LOCK_NB` 冲突得到 `BlockingIOError`；Windows 分支用假 `msvcrt`（字节区间锁模型）验证冲突/错误码/重复解锁/位置恢复/阻塞等待；`kill_process_group` 在 Linux 上实际杀掉孙进程；`PORTABLE_ENGINE_PYTHON` 两个分支。
- `python3 tools/engine_import_smoke.py both`：逐模块（子进程、引擎临时副本）导入 `engine/tools/*.py`，第三方包统一替换为桩模块。
  - `posix`：79/79 导入成功。
  - `winsim`（删除 `fcntl/pwd/grp/termios/resource/tty/pty`，删除 `os.O_NOFOLLOW/O_DIRECTORY/O_CLOEXEC/O_NONBLOCK/killpg/getpgrp/setsid/getuid/fchmod/…`、`signal.SIGKILL/SIGHUP/…`，提供假 `msvcrt`）：**改动前 31/77 → 改动后 79/79**。这是近似模拟，不能替代 Windows 实机。

## 3. 全量 POSIX-only 位点清单（grep 完整，`engine/` 下 `*.py` 与 `*.sh`）

| 类别 | 位点 | 处理 |
|---|---|---|
| `fcntl` | `_media/library_lock.py` L58-77、`remotion_lock.py` L32-51（**已自带** `os.name == "nt"` 的 msvcrt 分支）；`_render_completion.py`、`_takes.py`、`lipsync_footage.py`、`log.py`、`prepare_production.py` | 前 2 个无需改；后 5 个 E1/E2 |
| `os.fork` | 无 | — |
| `os.register_at_fork` | `log.py` L87（已 `hasattr` 保护） | 无需改 |
| `os.killpg` | `_render_completion.py` L494、`_render_review_child.py` L60 | E4/E5 |
| `setsid` / `start_new_session` | `_render_completion.py` L546、`review_render.py` L380 | E4/E6 |
| `signal.SIGKILL` | 同上 2 处（随 killpg 一并替换） | E4/E5 |
| `signal.SIGTERM` | `_gateway.py` L452/459（`signal.signal(SIGTERM, …)`，Windows 可用）、`_render_completion.py` L562（`SIGHUP` 已 `getattr`） | 无需改 |
| `os.uname` / `resource` / `termios` / `tty` / `pty` / `grp` | 无 | — |
| `pwd` + `os.getuid` | `_media/chunker.py` L221-222（已 `try/except (ImportError, AttributeError, …)`） | 无需改 |
| `os.fchmod` | `prepare_production.py` L3529、`taste_contract.py` L76 | Python ≥3.13 在 Windows 上提供 `os.fchmod`（引擎固定 3.14.6）→ 无需改（未验证） |
| `O_NOFOLLOW/O_DIRECTORY/O_CLOEXEC/O_NONBLOCK` | 44 处 / 10 个文件：`_operations.py`(9 NOFOLLOW/4 DIRECTORY)、`_refusal_guard.py`、`_render_review_child.py` L127、`_takes.py`、`cost.py` L1561（已 getattr）、`lipsync_footage.py` L195、`log.py`、`mint_image.py`、`prepare_production.py`（已 hasattr）、`sfx_catalog.py` L189 | 仅模块级的 `_takes.py` L65 已改（E10）；其余在函数内，**运行时**在 Windows 上抛 `AttributeError` → B1 |
| `dir_fd=` / `src_dir_fd` / 目录 fd | 65 处 / 5 个文件：`_operations.py` 19、`_refusal_guard.py` 1、`_takes.py` 13、`log.py` 16、`mint_image.py` 24；另 `os.open(<目录>, O_DIRECTORY)` 见于 `_operations.py`、`_refusal_guard.py`、`_render_review_child.py`、`log.py` L289/L645、`sfx_catalog.py` | **TODO B1**（见下） |
| `/tmp` 硬编码 | `build_carousel.py` L487（日志路径）、`check_layout.py` L1027、`prepare_production.py` L7294（字符串常量，非路径操作） | TODO B3：改 `tempfile.gettempdir()` 会改变 macOS 行为（`$TMPDIR` ≠ `/tmp`），故暂不改 |
| `/usr/…` 硬编码 | `render_timeline_strip.py` L102-103（字体候选列表，找不到会继续回退）、`prepare_production.py` L7480（字符串） | 无需改 |
| `.venv/bin/python` | `prepare_production.py` L150（E7）、`build_character_sheet.py` L10（docstring）、`.claude/hooks/preflight.sh` L69（E8）、`.claude/settings.json` L19/L29（E9 在打包时改写） | 已处理 |
| `#!/bin/sh` / bash 脚本 | `.claude/hooks/preflight.sh`（由 `bash "…/preflight.sh"` 调用） | Windows 需 Git Bash（Claude Code 在 Windows 上本身即要求 Git Bash） |
| 子进程裸名 `npx`/`npm` | `compose_render.py` L340、`remotion_render.py` L482（`subprocess` 列表形式调用 `npx`） | **TODO B2**：Windows 上 `npx` 是 `npx.cmd`，`CreateProcess` 不会解析 `.cmd` → `FileNotFoundError`。`doctor.py` 的 `check_remotion --deep` 直接调用 `node_modules/.bin/remotion`（Windows 为 `remotion.cmd`）同理 |
| `shell=True` / `preexec_fn` / `select.poll` / `os.statvfs` / `os.symlink` | 无（`review_render.py` 用 `selectors.DefaultSelector` 读管道——**Windows 的 select 不支持管道** → TODO B4） | B4 |

## 4. 阻塞项（需要设计或 Windows 实机）

- **B1（最关键）目录 fd + `dir_fd` 安全 I/O。** `log.py` 的 `log_event()`（被 43 个工具 `from log import …`）先 `os.open(job_dir, O_RDONLY|O_DIRECTORY|O_CLOEXEC)`，再 `os.open/stat/mkdir/unlink/replace(..., dir_fd=job_fd)`。Windows 上 `os.O_DIRECTORY` 不存在（AttributeError），`os.supports_dir_fd` 为空（`NotImplementedError`），也不能 `os.open` 目录。→ **几乎所有引擎工具第一次写 job 日志即失败**。建议设计：新增 `_compat_dirfd.py`，POSIX 原样透传（`open_dir/open_at/stat_at/mkdir_at/unlink_at/replace_at/close_dir` 直接调用 os 对应 dir_fd 版本）；Windows 用“伪目录 fd”注册表（整数句柄 → 绝对路径，打开时 `os.stat` 记录 `st_ino/st_dev` 以保留“目录未被替换”的检查），各 `*_at` 退化为路径拼接 + `follow_symlinks=False` 校验。需要机械替换 5 个文件约 65 处调用并在 Windows 上实测 TOCTOU 语义差异——这是下一轮的主要引擎工作。
- **B2** `npx`/`.bin/remotion` 的 `.cmd` 解析（见上表）。最小修复：`shutil.which("npx")` 得到 `npx.cmd` 全路径后再调用（POSIX 上 which 结果与裸名等价）。未改，待 Windows 实测确认失败形态。
- **B3** `/tmp` 硬编码 2 处。
- **B4** `review_render.py` 对 `subprocess.PIPE` 使用 `selectors`（Windows `select()` 只支持 socket）→ 需线程读取替代。
- **B5** 文件锁语义：msvcrt 锁是强制锁；我们只锁专用锁文件的第 0 字节，与引擎已有 Windows 分支一致，但未实测。
