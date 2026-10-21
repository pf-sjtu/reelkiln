# port/ — Videoclaw 0.0.40 Windows port scaffold

Faithful (not redesigned) cross-platform port of the Electron shell. See
`../docs/07-windows-port-plan.md` for the full plan (Chinese).

```bash
cd port
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install   # box/CI: no Electron binary needed to build
npm run build      # gen IPC contract → tsc --noEmit → esbuild (dist/)
npm test           # node:test — platform layer, IPC table vs app/out, preload fidelity, main IPC
# On Windows (with the Electron binary installed by a plain `npm install`):
npm run start      # electron .  → Settings page (LLM route selector) + Debug tab (184 window.videoclaw methods)
# Installable app (docs/18): Linux verified, Windows/macOS config only
npm run agent-sdk:install   # optional: package.mjs stages the pinned Claude Agent SDK on demand
npm run package:linux       # → release/Videoclaw-Port-<v>-linux-x86_64.AppImage + -linux-amd64.deb
npm run package:smoke -- release/*.AppImage release/*.deb   # launch smoke (xvfb) [--live: 1 real agent turn]
```

| Path | What |
|---|---|
| `tools/gen-ipc-contract.mjs` | generator: `artifacts/manifests/ipc-channels.json` + `tools/ipc-verified-shapes.json` + `tools/bridge-order.json` → `src/shared/ipc-contract.ts`, `src/preload/bridge.generated.ts` |
| `src/shared/ipc-contract.ts` | GENERATED typed contract (184 channels, 157 invoke / 3 send / 23 push / 1 unused) |
| `src/preload/` | contextBridge `window.videoclaw`, generated member-for-member from the original |
| `src/main/index.ts` | BrowserWindow + IPC registration (original pattern), fake backend |
| `src/main/fake-backend.ts` | QA-fixture-derived fake (qaFixtures-E0ox5qGv.js), rest = logged stubs |
| `src/main/platform/` | macOS→Windows platform abstraction (tested) |
| `src/renderer/` | Settings page (PORT-NEW LLM route selector + About this build, docs/18 §5) + Debug/IPC smoke tab |
| `tools/packaging-config.mjs`, `tools/package.mjs`, `tools/packaged-smoke.mjs` | PORT-NEW electron-builder config (pure, tested), packaging driver (stages the Claude Agent SDK per target → `resources/claude-agent-sdk`), packaged-app launch smoke (docs/18) |
| `src/main/llm/` | PORT-NEW generic custom-LLM provider framework (docs/15; MiniMax = built-in preset, docs/14): zod-validated providers config, anthropic-messages / openai-chat-completions / openai-responses, x-api-key / bearer / custom-header auth, per-provider gate + retry policy, redacting logger; sanitizedAgentEnv/resolveHelperCreds/anthropicMessages ports |
| `src/main/models-dev/` | PORT-NEW models.dev catalog → SQLite (node:sqlite) sync + metadata lookup (docs/15); CLI `models-sync` / `models-list` / `models-show` / `llm-model-info` |
