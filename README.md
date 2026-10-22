# Reelkiln

> Reelkiln is an independent, unofficial reconstruction / cross-platform port of a third-party macOS app (referred to as "the original macOS app" or "the upstream app"). It is not affiliated with or endorsed by the upstream vendor.
>
> Naming note: wire-compatibility identifiers of the upstream app (environment variables such as `VIDEOCLAW_*`, the `window.videoclaw` preload bridge, `X-VideoClaw-*` HTTP headers, bundle ids, on-disk paths) are kept verbatim in code and in code spans of the docs because the port must stay byte-compatible with the upstream engine. Quoted upstream UI strings in docs use `[App]` in place of the product name.

逆向工程 + Windows 移植工作区：目标应用为**原版 macOS 应用 0.0.40（arm64）**（下文统称"原版应用"或"上游应用"）。

目标（分阶段）：
1. **字节级对齐（当前阶段）**：忠实还原现有应用的源码与结构，可复现构建，先不做任何改动。
2. 跨平台移植到 Windows。
3. 优化与升级。

## 应用构成（0.0.40）
原版应用是一个 **Electron + React 桌面应用**，由 AI agent 驱动的视频/媒体创作工具。

| 层 | 技术 | 本仓库位置 | 还原方式 |
|---|---|---|---|
| 桌面外壳 | Electron (`Electron Framework.framework`) + Squirrel 自更新 | `app/` | 外壳为上游 Electron，业务为打包 JS |
| 主进程/渲染进程 | TypeScript + React 18，Vite/Rollup 打包 | `app/out/{main,preload,renderer}` | 从 `app.asar` 还原的打包产物（含 worker） |
| 媒体引擎 | **Python 3.14.6**（remotion 渲染、skills、workflows、taste、sfx） | `engine/` | 随包发布为**源码**，字节级完整 |
| AI agent | `@anthropic-ai/claude-agent-sdk` + 内置 **Codex 0.160.1** CLI | `app/`, `bootstrap/codex/` | SDK 为 npm 依赖；Codex 为预编译 Rust 二进制（仅留清单） |
| 原生子进程 | `ffmpeg`/`ffprobe`、`uv`(Python 安装器)、Swift `voice-dictation`（on-device Speech） | `app/native/swift/`, 清单见 `artifacts/manifests/` | Swift 为源码；其余为第三方二进制（哈希存档） |

## 目录
- `app/` — Electron 桌面端（TS/React 打包产物 + 原生 Swift 源 + 资源）
- `engine/` — Python 媒体引擎源码（字节级完整，来自 `engine-0.1.57-rc7-15f8f2d.tar.gz`）
- `bootstrap/` — 引擎/Codex 清单（不含二进制）
- `artifacts/manifests/` — 所有未入库二进制的 SHA256，用于复现校验
- `docs/` — 架构、原生组件、Windows 移植计划

## 版本与来源
- app: 原版桌面包 v0.0.40
- engine: `0.1.57-rc7-15f8f2d`（built 2026-10-06，Python 3.14.6）
- codex: `0.160.1` (aarch64-apple-darwin)
- 来源 dmg: 原版 0.0.40 arm64 dmg（见 `artifacts/manifests/app.asar.sha256`）

> 未入库的大体积第三方二进制（ffmpeg/ffprobe/uv/node/codex/voice-dictation 编译产物、app.asar、dmg）通过 `artifacts/manifests/*.sha256` 记录指纹，以支持字节级复现校验。

## Windows port (scaffold)

**功能重建路线图（覆盖表 / 主流程验收场景 / 里程碑）：`docs/20-reconstruction-roadmap.md`。**

`port/` — faithful Electron+TS Windows port scaffold (typed IPC contract, fake backend,
platform layer). Plan and status: `docs/07-windows-port-plan.md`.
