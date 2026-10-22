# 40. M23：`.zip` 附件解包、工作簿读取、Rosetta 分支真机测试、macOS 测试挂起的真实原因 + 经原版渲染器附加 zip/xlsx/pdf 的 UI e2e

日期：2026-10-22（SGT）。真实 MiniMax 花费 **$0**（全部本地 / FAKE-LLM；CI 里没有任何 key）。
关闭 docs/39 §4 的纯工程缺口 #11–#14。

## 0. 提交
| 提交 | 内容 |
|---|---|
| `5dfa0dc` | zip 解包 + 工作簿读取（逐字生成 + 接线 + 测试） |
| `cc5092e` | macos-native：Rosetta 真机测试 + 逐文件句柄探针（非阻断） |
| `f9dd6af` | `ui-e2e.mjs --extra-docs`：经原版渲染器拖入 .zip/.xlsx/.pdf；macOS / Windows S1 job 各加一步（非阻断） |
| `f871cf0` | 探针循环修正（`set +e`，保留失败尾部） |
| `83f367e` | 泄漏句柄修复（`AgentHost.closeAll` 按原版退役 job watcher）+ 去掉 `--test-force-exit` + Rosetta 步骤改为阻断 + 证据 |
| `bc98561` | 本文档；docs/39 §4、docs/34、docs/13 |
| （本提交） | `--extra-docs` 两步两次全绿后改阻断；探针步骤移除（工具保留）；修复后证据 |

## 1. `.zip` 附件解包（#11）
- 依赖：`yauzl 3.4.0`（原版 `app/package.json` 锁定的同一版本；port 用 esbuild 打包，记在 devDependencies）。
- `tools/gen-verbatim.mjs` 从原版 workbookContents chunk 逐字生成 `src/main/attachments/archive-extract.generated.ts`（L4027-4319）：`ARCHIVE_LIMITS`（条目数 / 文件数 / 深度 / 单文件字节 / 总字节 / 压缩比 + 比率下限）、`FREE_SPACE_RESERVE_BYTES`、`planEntries`、`extractArchive`、`inspectZipContainer`、`storedZip`、`yauzlCause`。限额常量也逐字导出自 asset-kinds。
- `attachments-unported.ts` 改为 `ARCHIVE_EXTRACTION_PORTED = true` 并转出原版 `extractArchive`，原有的 store 代码（`unpackArchive`：子附件、嵌套工作簿 / PDF、`unpacked.skipped`）因此按原版走通。
- 测试 `test/archive-extract.test.ts`（自带 zip 生成器 `test/zip-fixture.ts`）：排序保留、sha256、跳过嵌套压缩包 / 不支持类型、忽略 `__MACOSX` / 隐藏文件；zip-slip 与不安全路径（`../`、绝对路径、`C:/`、反斜杠、`//`、`./`、控制字符、超长段、>1024 字节名）；符号链接 / 特殊文件；加密、不支持的压缩方法、损坏（垃圾、CRC 错、大小不符）；重复路径、过深、过挤、过多、单文件过大、总量过大、zip 炸弹（压缩比 + 重叠头）、空包、磁盘空间不足；每个原因的 `archiveRejectReason` 文案；`inspectZipContainer`；store 端到端。**OS 自带工具互通**：Linux/macOS 用 `zip`，Windows 用 PowerShell `Compress-Archive` 生成的包都能按原版解开（CI 三个 OS 都实际执行，box 上没有 `zip` 故跳过）。
- 原 `jobs-attachments.test.ts` 里"zip 一律拒绝"的断言改为原版行为：截断的 zip → `corrupt` 文案。

## 2. 工作簿读取（#12）
- 依赖：SheetJS `xlsx 0.20.3`（原版锁定的同一 tarball）。
- 逐字生成 `src/main/workers/workbook-worker.generated.ts`（原版 `app/out/main/workbookWorker.js` L11-187：`parseWorkbook`、`readOwnedWorkbook`、parentPort 处理），构建为 `dist/main/workbookWorker.cjs`；`src/main/attachments/workbook-reader.generated.ts`（L4447-4478：`WORKBOOK_READ_TIMEOUT_MS`、`readWorkbookInWorker`）。
- 接线同原版 L61124-61127：`real-backend.ts` 在 `setPdfReader` 之前调用 `host.setWorkbookReader(...)`，worker 用 `utilityProcess` 以 serviceName `videoclaw-workbook`、`--max-old-space-size=512` fork（原版 `forkWorkbookWorker` L60704）。
- 测试 `test/workbook-reader.test.ts`：xlsx / ods / xls(BIFF8) 解析结果、拒绝路径、摘要校验 / 符号链接、`readWorkbookInWorker` 的 worker 退出 / 超时 → too-complex、乱码 → corrupt、fork 抛错 → too-complex；store 端到端（摘要 `2 sheets — "Plan" A1:C3`，再读回单元格）。

## 3. Rosetta 分支（#13）——真机测试，已阻断
macos-native 新步骤（`port/test/mac-rosetta.test.ts`，仅在 darwin arm64 + `VIDEOCLAW_TEST_ROSETTA=1` 时运行）：runner 上按需装 Rosetta，`uv python install cpython-3.12-macos-x86_64` → 该解释器 `arch -x86_64` 下报告 `x86_64`，原版 `machOHasArm64` 判为非 arm64；用它建的 x86_64 venv 交给原版 `nativePythonArgs` → `["--python","cpython-3.12.15-macos-aarch64"]`；uv 真按这个参数装出 arm64 解释器并能找到；arm64 venv → `[]`。
两次全绿（39740107828、39741744182）后去掉 `continue-on-error`。证据 `artifacts/phase-b-m23/macos-native-ci-*/rosetta*.txt`。

## 4. macOS 测试挂起的真实原因（#14）——已修复，`--test-force-exit` 已删除
- 方法：`port/tools/hang-probe.cjs`（经 `NODE_OPTIONS=--require` 预加载，20 s 后打印仍存活的句柄），在 macos-latest 上不带 `--test-force-exit` 逐个跑 61 个测试文件。
- 结果（39741744182）：只有 `m16-collector.test.cjs` 不退出（60 s 被 test-timeout 杀掉，6/6 子测试本身通过）；子进程残留 **3 个 `FSWatcher`（FSEventWrap）**。
- 根因：原版 `JobWatcher` 对 job 目录做递归 `fs.watch`；port 的 `AgentHost.closeAll()` 没有按原版 L45572 退役 watcher（也漏了 L45551 中止 operation collector）。Linux 上递归 watch 是 inotify，目录被删时 watcher 随之出错关闭，所以不挂；macOS 上 FSEvents watcher 在目录删除后依然存活 → 进程不退。这也是产品退出路径（`beginShutdown` → `h.closeAll()`）与原版的一处真实偏差。
- 修复：`closeAll()` 现在按原版中止 collector、退役所有 watcher 并清空 map；测试 teardown 调用 `host.closeAll()` 并断言 watcher 数为 0。`port/package.json` 的 test 脚本去掉 `--test-force-exit`（保留 `--test-timeout`）。本机全量 373 个测试（363 过 / 10 跳过 / 0 失败）7 s 正常退出。
- 验证（39743103095）：三个 OS 的 port job 不带 `--test-force-exit` 全绿（373 个测试，0 失败）；macOS 逐文件探针 61/61 rc=0、无残留句柄，`m16-collector` 6 s 退出。探针步骤随后从 CI 移除（`tools/hang-probe.cjs` 保留，用法见文件头）。

## 5. UI e2e：经原版渲染器附加 zip / 工作簿 / PDF（额外项）
`node tools/ui-e2e.mjs … --extra-docs --stop-after attach`：在 4 个媒体附件之后，再把 harness 生成的 `docs.zip`（cover.png + boards/storyboard.pdf + tools/skip.exe）、`plan.xlsx`（两张表）、`brief.pdf` 拖到原版渲染器的 composer 上，然后从 main 的附件存储读结果。判定：zip 解出 2 个子附件（带 `archive.parentName/entryPath`）且 `skip.exe` 以 `unsupported` 跳过；xlsx 经 utilityProcess worker 读出 `2 sheets — "Plan" A1:C3, "Notes" A1:A2`；PDF 在 macOS 上 `read`（PDFKit，1 页、有文字，含 zip 里的那份），在 Linux/Windows 上为原版自己的 `unavailable`；四个 chip 都出现在 composer。
| 环境 | 结果 |
|---|---|
| box Linux（dev） | PASS |
| macOS 打包 .app（CI 39740107828） | PASS（PDF `read`） |
| Windows win-unpacked（CI 39740107828） | PASS（PDF `unavailable`） |
第二次（CI 39741744182）macOS / Windows 同样 PASS → 两步改为阻断。证据：`artifacts/phase-b-m23/ui-docs-*`（summary + 截图）。

## 6. 未验证 / 说明
- yauzl / SheetJS 与原版同版本，但原版二进制里它们是否被打补丁无法从 bundle 外部确认；逐字生成的是原版自己的调用代码。
- `RELATIVE_WRITER` 差分测试曾在全量负载下失败一次，单独 3 次 + 全量多次未复现（疑似偶发，若再现另查）。
