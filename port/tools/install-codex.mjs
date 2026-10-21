// docs/27: installs the EXTERNAL Codex runtime the original bundles (resources/bootstrap/codex, 0.160.1)
// into port/vendor/codex (gitignored) — the same official npm package, never reconstructed.
// resolveCodexExecutable (src/main/codex/codex-minimax.ts) finds it there; VIDEOCLAW_CODEX_BIN overrides.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const dir = join(import.meta.dirname, "..", "vendor", "codex");
mkdirSync(dir, { recursive: true });
execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", "--prefix", dir, "@openai/codex@0.160.1"], { stdio: "inherit" });
console.log(`codex 0.160.1 installed under ${dir}`);
