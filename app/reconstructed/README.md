# app/reconstructed — 可读化（prettier 格式化）版本

- 来源：`app/out/**`（`app.asar` 中原样提取的 Rollup/Vite ESM 产物，字节级参考，**不修改**）。
- 方法：`npx prettier@3 --no-config --print-width 100` 逐文件格式化；文件名（含 Rollup 哈希）与目录结构与 `app/out` 一一对应。
- 语义：仅改变空白/换行/引号等格式，不改标识符、不改逻辑。比对原始字节请以 `app/out` 为准。
- 未处理：`renderer/assets` 下的字体/图片/CSS 等非 JS 资源（见 `app/out/renderer/assets`）。
