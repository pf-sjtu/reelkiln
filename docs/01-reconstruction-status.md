# 还原进度

## 已完成
- dmg 挂载/提取，确认 Electron 应用结构
- `app.asar` 提取 → `app/out`（main/preload/renderer + 5 个 worker，11 个 JS bundle）
- Python 引擎 tar.gz 提取 → `engine/`（91 个 .py，字节级完整源码）
- 组件版本、构建时间、二进制 SHA256 存档

## 进行中 / 待办
- [ ] 用 REA `analyze-javascript-application` 做证据化的 JS 应用图还原
- [ ] 将 `app/out` 打包 bundle 拆分/美化为可读模块（main/renderer/preload + workers）
- [ ] 梳理 preload 暴露的 IPC 契约（主↔渲染）
- [ ] 梳理桌面端 ↔ Python 引擎 ↔ Codex/Claude agent 的进程边界与协议
- [ ] 清点原生/子进程依赖（ffmpeg、uv、voice-dictation）的调用点与参数
- [ ] 产出 Windows 移植计划（语言选型：Rust/TS/Python）
