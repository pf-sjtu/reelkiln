# 还原进度

## 已完成
- dmg 挂载/提取，确认 Electron 应用结构
- `app.asar` 提取 → `app/out`（main/preload/renderer + 4 个 utility worker + 3 个 chunk，12 个 JS/MJS bundle；字节级原样，不修改）
- Python 引擎 tar.gz 提取 → `engine/`（91 个 .py，字节级完整源码）
- 组件版本、构建时间、二进制 SHA256 存档（`artifacts/manifests/`）
- [x] **JS 可读化**：`app/reconstructed/`（prettier@3 逐文件格式化，结构/文件名与 `app/out` 一一对应）
- [x] **REA** `analyze-javascript-application`：摘要 `artifacts/rea/summary.json`、`selected-nodes.json`（原始 371MB 留在 box，未入库）
- [x] **模块/导出映射**：`docs/03-js-module-map.md`
- [x] **IPC 契约**：`docs/04-ipc-contract.md`（184 个通道常量 / 160 个 handler / 23 个推送 / `window.videoclaw` 184 个方法；机器抽取表 `artifacts/manifests/ipc-channels.json`）
- [x] **进程与架构边界**：`docs/05-architecture.md`（引擎 = 按需 CLI，无常驻服务；Codex app-server stdio 换行 JSON；claude-agent-sdk `query()`；4 个 utility worker；loopback 网关代理）
- [x] **外部依赖 env 映射**：`docs/02-external-dependencies.md`（结论：无 FFMPEG_PATH 类变量；bootstrap 目录约定 + `VIDEOCLAW_ENGINE_DIST` / `VIDEOCLAW_CODEX_BIN`）
- [x] **常量/配置清单**：`docs/06-constants-and-config.md` + 自动生成全量 `docs/06a-constants-full.md`（1014 条）
- 抽取脚本：`tools/ipc_table.py`、`tools/gen_ipc_doc.py`、`tools/consts.py`（脚本内写死了 box 路径 `/workspace/videoclaw/...`）

## 待办
- [ ] `session:event` 事件联合类型完整枚举（AgentHost 内所有 `sessionEvent(...)` 调用）
- [ ] 各 IPC 请求/响应的精确 TS 类型（目前只有形参名与委托目标）
- [ ] 引擎 `tools/*.py` stdout JSON schema 与主进程解析点对照
- [ ] `node_modules/@anthropic-ai/claude-agent-sdk` 线协议（不在 out/ 范围）
- [ ] 将 main/index.js 按 03 §2.2 的分区拆成源码级模块（TS 化）
- [ ] 产出 Windows 移植计划（语言选型：Rust/TS/Python）

## 功能重建路线（2026-10-21，docs/20）
北极星：在 box 上 100% 功能重建并真实跑通主流程。现状与计划见 `docs/20-reconstruction-roadmap.md`。
- 覆盖（`python3 tools/ipc_coverage.py`，2026-10-21 Phase B 后）：184 通道 = real 18 + real-env 1 + fixture 8 + stub 133 + push 发出 5/23 + local 1（Phase A 时为 10+1+11+138+4/23）
- 验收场景 S1：`tools/accept_fixtures.sh` → 应用内 agent 出片 → `tools/accept_check.py`（E1–E15 + A1–A3）；L0（纯引擎）已 PASS
- 原版渲染器可直接挂 port 主进程（探针，`artifacts/phase-a-probe/original-renderer-on-port.png`）

### 下一轮待办（Phase B）
- [x] M1 原版 UI 上线：port 默认加载 `app/out/renderer`，首页启动通道做真（`quickstart:catalog` 除外），HOME 冒烟入库 — docs/21
- [x] M2 引擎化 AgentHost：工作区 cwd、`engineSessionEnv`、完整 writeWorkspace（CLAUDE.md/执行契约）、引擎 hooks、Bash + 原版权限模型、job 绑定、sessions.json 持久化 → **S1-L1 PASS（E1–E15，MiniMax + PORT-NEW 路由提示）** — docs/21
- [ ] M3 JobWatcher/scanJob/VersionStore/vcmedia/导出 → A1/A3
- [ ] M4 附件 → S1-L2；M5 原版 UI 端到端 → S1-L3（+ AppImage）
- [ ] M6 编辑器；M7 其余本地功能；M8 Codex（凭据）；M9 账户/网关（凭据，mock 契约）；M10 mac/Win 平台专属（CI/手动）
