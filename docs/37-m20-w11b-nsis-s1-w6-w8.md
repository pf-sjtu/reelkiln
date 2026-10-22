# 37. M20：W11b（聊天回复里的任务链接）、NSIS 安装版上的 S1、W6 / W7 / W8 在 windows-latest 上实测

日期：2026-10-22（SGT）。真实 MiniMax 花费 **$0**（全部 FAKE-LLM；CI 里没有 key）。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `9904cc4` | W11b 修复 + `reply_link` verdict；`windows-s1-ui` 同时打 NSIS 包，静默安装后再跑一遍 S1；win32 实测 W6 / W7 / W8 的测试 |
| `e676436` | W8 控制台探针改写；Linux 与 Windows（unpacked + NSIS）证据 |
| （后续提交） | W8 探针改用 `MainWindowHandle`；本文档、docs/10、docs/34 |

## 1. W11b：聊天回复里的任务链接
**现象**（M19 截图）：agent 最终消息里的 `[Watch the finished cut](jobs/<id>/final.mp4)` 在 Windows 上显示 “Link unavailable”，Linux 上是内联视频。

**原因**：原版 `resolveDeliveryUrl(href, cwd)` 执行 `new URL(href, \`file://${encodeFilePath(cwd)}/\`)`，`encodeFilePath` 只按 `/` 切分。Windows 的 `cwd`（`D:\a\…\Videoclaw`）会变成 `file://D%3A%5Ca%5C…/`，Chromium 把整段路径当成 host，`url.hostname` 非空 → `null` → “Link unavailable”。（Node 的 WHATWG 解析器能接受这种写法，所以单测复现不了“修复前”，修复前后的对比证据来自 Windows 上的 UI 运行。）

**修法（最小、只在 win32 生效）**：
- 考虑过把传给渲染器的工作区路径改成正斜杠：`D:/a/…` 仍会得到 `file://D%3A/…`，host 还是非空；只有 `/D:/a/…` 能用，但 `cwd` 会被渲染器原样回传给 main 的许多 IPC，影响面太大。
- 采用的做法：M19 的 preload 主世界 shim 里再包一层 `URL` 构造函数（子类，静态方法和 `instanceof` 不变），只把形如 `file://<盘符>(%3A|:)(%5C|\|/)…` 的输入 / base 改写成 `file:///D:/a/…/`。原版逻辑于是得到 pathname `/D:/a/…/jobs/<id>/final.mp4`，`mediaUrl()` 生成 `vcmedia://local/D%3A/…`。main 侧 `vcmediaFilePath` 本来就把 `/D:/…` 映射回 `D:\…`；`file:openPath` / `file:revealItem` / `file:saveItemAs` 也加了同样的映射（POSIX 上什么都不做）。
- 渲染器 bundle 仍然保持原样。

**验证**：新的 `reply_link` verdict（加入 allPass）要求聊天里有 `video.inline-media`，其 src 是 `vcmedia://local/…/final.mp4`，readyState ≥ 1，并且没有 “Link unavailable”。
- Windows unpacked 和 NSIS 安装版：PASS（readyState 4，6.5 s），run [39727260551](https://github.com/pf-sjtu/reelkiln/actions/runs/39727260551)
- Linux dev-electron（本机，回归）：PASS，导出 sha 仍为 `1ea15d39…`（`artifacts/phase-b-m20/linux-fake-s1/`）

## 2. NSIS 安装版上的 S1
`windows-s1-ui` 现在打 `dir,nsis` 两个目标：先用 win-unpacked 跑一遍 S1，再以 `/S /D=<dir>` 静默安装 `Videoclaw-Port-…-setup.exe`（按用户安装），然后驱动安装目录里的 `videoclaw-port.exe` 再跑一遍。run 39727260551 两遍都 **allPass=true**：home → project_video → attach → brief_send → stream → reply_link → play（2.56 s）→ approve → export（final == v1 == export，h264 720x1280 + aac，6.5 s）。证据：`artifacts/phase-b-m20/windows-s1-ci-39727260551/{,nsis/}`。

## 3. W6 / W7 / W8（`port/test/win-real-w6-w8.test.ts`，只在 win32 上运行）
| # | 测了什么 | windows-latest 结果 |
|---|---|---|
| W6 | `createRunner` + `mergeEnv`：base env 用 Windows 的 `Path`，extra 用 `PATH`；子进程 `cmd /c set` 只看到 **一条** PATH，且就是 extra 的那条；extra 目录里的 `.cmd` 能被解析执行 | ✅ |
| W7 | NTFS 上 `dirIdentity()`（bigint `dev:ino`）：多次读取稳定、目录内容变化后稳定、重命名后不变（NTFS file id 跟着目录走）、换入同名新目录后不同；`relativeWrite` 端到端：写入成功、同名返回 75 且不覆盖、目录被换后返回 73 | ✅ |
| W8 | editorRenderWorker 的 `detached:true` + `windowsHide:true`：(a) 取消时 `taskkill /T`（宽限期后 `/F`）把子进程**和孙进程**都结束；(b) 子进程没有可见的控制台窗口（用另一个 PowerShell 查 `Process.MainWindowHandle`，并与不带 `windowsHide` 的对照组比较） | (a) ✅；(b) 见 §3.1 |

### 3.1 W8 控制台窗口
第一版探针在子进程里用 P/Invoke 调 `GetConsoleWindow`，输出始终为空（detached 子进程内的 PowerShell 没有产出任何 stdout/stderr），无法判断。改为在外部查 `MainWindowHandle`；结果见 docs/10 的 M20 增补。

## 4. 仍未验证
- W8(b) 的结论取决于 runner 会话是否有可见桌面；如果对照组也是 0，说明 CI 环境无法观察窗口，只能在有桌面的 Windows 上人工确认。
- 真实模型在 Windows 上的 agent 行为（CI 不放 key）。
