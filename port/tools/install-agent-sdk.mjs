#!/usr/bin/env node
// PORT-NEW (docs/17 §4): installs the pinned @anthropic-ai/claude-agent-sdk (+ the per-platform
// native `claude` binary it pulls in as an optional dependency, ~280 MB) OUTSIDE the port's own
// node_modules, into vendor/claude-agent-sdk (gitignored). agent-sdk.ts discovers it there, so the
// agent path works without VIDEOCLAW_CLAUDE_AGENT_SDK. Not part of `npm install` on purpose: CI and
// helper-only installs never download the binary.
// Usage: npm run agent-sdk:install [-- --dir <dir>] [--version X] [--os win32 --cpu x64]  (cross-platform packaging)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const version = opt("version") ?? pkg.config?.claudeAgentSdkVersion;
if (!version) throw new Error("package.json config.claudeAgentSdkVersion missing");
const dir = resolve(opt("dir") ?? join(root, "vendor", "claude-agent-sdk"));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "videoclaw-claude-agent-sdk-vendor", private: true, description: "installed by port/tools/install-agent-sdk.mjs — do not commit", dependencies: { "@anthropic-ai/claude-agent-sdk": version } }, null, 2) + "\n");
const npmArgs = ["install", "--no-audit", "--no-fund", "--omit=dev"];
for (const k of ["os", "cpu", "libc"]) if (opt(k)) npmArgs.push(`--${k}=${opt(k)}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
console.error(`installing @anthropic-ai/claude-agent-sdk@${version} into ${dir} …`);
execFileSync(npm, npmArgs, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
const sdkDir = join(dir, "node_modules", "@anthropic-ai", "claude-agent-sdk");
const got = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version;
const plat = `${opt("os") ?? process.platform}-${opt("cpu") ?? process.arch}`;
const exe = join(dir, "node_modules", "@anthropic-ai", `claude-agent-sdk-${plat}`, (opt("os") ?? process.platform) === "win32" ? "claude.exe" : "claude");
console.log(JSON.stringify({ ok: got === version, dir, version: got, nativeBinary: existsSync(exe) ? exe : null }));
if (got !== version) process.exitCode = 1;
