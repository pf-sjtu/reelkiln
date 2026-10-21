// Minimal esbuild build. main/preload → CJS for Electron (preload CJS works with or
// without sandbox), renderer → IIFE for a <script> tag. `--tests` bundles test/*.test.ts.
import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const common = { bundle: true, sourcemap: true, logLevel: "info", absWorkingDir: root };
if (process.argv.includes("--tests")) {
  rmSync(join(root, "dist-test"), { recursive: true, force: true });
  const entries = readdirSync(join(root, "test")).filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`);
  await build({ ...common, entryPoints: entries, outdir: "dist-test", platform: "node", format: "cjs", target: "node20", outExtension: { ".js": ".cjs" }, alias: { electron: "./test/electron-mock.ts" } });
} else {
  rmSync(join(root, "dist"), { recursive: true, force: true });
  await build({ ...common, entryPoints: { "main/index": "src/main/index.ts" }, outdir: "dist", platform: "node", format: "cjs", target: "node20", external: ["electron"], outExtension: { ".js": ".cjs" } });
  // utilityProcess worker (original out/main/editorRenderWorker.js)
  await build({ ...common, entryPoints: { "main/editorRenderWorker": "src/main/workers/editor-render-worker.ts" }, outdir: "dist", platform: "node", format: "cjs", target: "node20", external: ["electron"], outExtension: { ".js": ".cjs" } });
  // docs/26: HyperFrames preview + policy utilityProcess workers (original out/main/hyperframesPreviewWorker.js / hyperframesPolicyWorker.js)
  await build({ ...common, entryPoints: { "main/hyperframesPreviewWorker": "src/main/workers/hf-preview-worker.generated.ts", "main/hyperframesPolicyWorker": "src/main/workers/hf-policy-worker.generated.ts" }, outdir: "dist", platform: "node", format: "cjs", target: "node20", external: ["electron"], outExtension: { ".js": ".cjs" } });
  // PORT-NEW verification CLI (no Electron): dist/cli/port-cli.cjs
  await build({ ...common, entryPoints: { "cli/port-cli": "src/cli/port-cli.ts" }, outdir: "dist", platform: "node", format: "cjs", target: "node20", external: ["electron"], outExtension: { ".js": ".cjs" } });
  await build({ ...common, entryPoints: { "preload/index": "src/preload/index.ts" }, outdir: "dist", platform: "node", format: "cjs", target: "node20", external: ["electron"], outExtension: { ".js": ".cjs" } });
  await build({ ...common, entryPoints: { "renderer/renderer": "src/renderer/renderer.ts" }, outdir: "dist", platform: "browser", format: "iife", target: "chrome120" });
  mkdirSync(join(root, "dist/renderer"), { recursive: true });
  cpSync(join(root, "src/renderer/index.html"), join(root, "dist/renderer/index.html"));
}
