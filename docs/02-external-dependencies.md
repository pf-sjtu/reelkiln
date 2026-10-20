# 外部依赖（不还原，env 配置连接）

以下为随包分发的第三方/外部可执行依赖。移植时**不做还原**，由环境变量指向本机或容器内的可执行文件；本仓库只记录版本、指纹与调用契约。

| 依赖 | 随包版本 | 建议 env | 说明 |
|---|---|---|---|
| ffmpeg | bundled (arm64) | `VIDEOCLAW_FFMPEG` / `FFMPEG_PATH` | 媒体转码/合成 |
| ffprobe | bundled (arm64) | `VIDEOCLAW_FFPROBE` / `FFPROBE_PATH` | 媒体探测 |
| node | bundled | `VIDEOCLAW_NODE` / 系统 node | 运行 hyperframes 等 JS 子进程 |
| uv | bundled | `VIDEOCLAW_UV` / 系统 uv | Python 引擎依赖安装/运行（Python 3.14.6） |
| codex | 0.160.1 (aarch64-apple-darwin) | `VIDEOCLAW_CODEX` / `CODEX_PATH` | 内置 Codex CLI agent |
| claude-agent-sdk | npm `^0.3.281` | API key via env | Anthropic agent SDK |

> 实际 env 名以 `app/out` 还原后代码中的读取点为准，待 JS 还原后在此表补齐确切变量名与默认查找顺序。
> 所有二进制 SHA256 见 `artifacts/manifests/`。
