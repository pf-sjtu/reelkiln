#!/usr/bin/env node
// PORT-NEW (docs/18): build an installable app with electron-builder.
//   npm run package:linux            → release/Videoclaw-Port-<v>-linux-x64.AppImage + .deb (+ linux-unpacked/)
//   npm run package:win / :mac       → config present, UNVERIFIED (cannot be built/run on the Linux box)
// Options: --platform linux|win|mac  --arch x64|arm64  --targets AppImage,deb|dir  --no-sdk  --out <dir>
// Steps: 1) dist/ must exist (the npm scripts run `npm run build` first)
//        2) stage the Claude Agent SDK for the TARGET platform: host platform → vendor/claude-agent-sdk
//           (same dir `npm run agent-sdk:install` fills); other platforms → build/agent-sdk/<os>-<arch>
//           via install-agent-sdk.mjs --os/--cpu. Installed on demand, validated against the pin.
//        3) electron-builder with builderConfig() (tools/packaging-config.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builderConfig, PLATFORMS, validateSdkStaging } from "./packaging-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const hostPlatform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
const platform = opt("platform") ?? hostPlatform;
const arch = opt("arch") ?? (process.arch === "arm64" ? "arm64" : "x64");
const p = PLATFORMS[platform];
if (!p) throw new Error(`--platform must be one of ${Object.keys(PLATFORMS).join(", ")}`);
if (!existsSync(join(root, "dist/main/index.cjs"))) throw new Error("dist/ missing — run `npm run build` first (package:* scripts do this)");
if (!p.verifiedOnBox || platform !== hostPlatform) console.error(`[package] WARNING: ${platform}-${arch} packaging is config-only/UNVERIFIED in this repo (docs/18 §6)`);

let sdkDir = null;
if (!args.includes("--no-sdk")) {
  const pinned = pkg.config.claudeAgentSdkVersion;
  const isHost = p.os === process.platform && arch === process.arch;
  sdkDir = isHost ? join(root, "vendor", "claude-agent-sdk") : join(root, "build", "agent-sdk", `${p.os}-${arch}`);
  const check = () => validateSdkStaging(sdkDir, { os: p.os, arch, pinned, exists: existsSync, readJson: (f) => JSON.parse(readFileSync(f, "utf8")) });
  let problems = check();
  if (problems.length) {
    console.error(`[package] staging Claude Agent SDK ${pinned} for ${p.os}-${arch}: ${problems.join("; ")}`);
    const installArgs = [join(root, "tools/install-agent-sdk.mjs"), "--dir", sdkDir];
    if (!isHost) installArgs.push("--os", p.os, "--cpu", arch);
    execFileSync(process.execPath, installArgs, { stdio: "inherit" });
    problems = check();
    if (problems.length) throw new Error(`Claude Agent SDK staging failed: ${problems.join("; ")}`);
  }
  console.error(`[package] bundling Claude Agent SDK from ${sdkDir} → resources/claude-agent-sdk`);
} else console.error("[package] --no-sdk: the agent path will need VIDEOCLAW_CLAUDE_AGENT_SDK or ~/.videoclaw/claude-agent-sdk");

const outDir = resolve(root, opt("out") ?? "release");
const originalRendererDir = join(root, "..", "app", "out", "renderer");
const quickstartsDir = join(root, "..", "app", "resources", "quickstarts");
// docs/39 M22: macOS — build the original VoiceDictation.swift helper (macOS 26 SpeechAnalyzer) into
// resources/bootstrap/voice-dictation, the original layout (voiceTools L10465 → resolveBootstrapToolRoots L9296).
// Needs swiftc (Xcode / CLT) on a Mac host; elsewhere (or with --no-voice-helper) the .app ships without it and
// reports the original's "On-device transcription is unavailable on this Mac" copy.
let bootstrapDir = null;
if (p.os === "darwin" && !args.includes("--no-voice-helper")) {
  if (process.platform !== "darwin") console.error("[package] not on macOS: the voice-dictation helper is NOT built (swiftc needs a Mac)");
  else {
    bootstrapDir = join(root, "build", "native", `darwin-${arch}`, "bootstrap");
    mkdirSync(bootstrapDir, { recursive: true });
    const swiftSrc = join(root, "..", "app", "native", "VoiceDictation.swift");
    // deployment target below 26 so the helper itself can answer {"error":"unsupported_os"} on an older Mac (the
    // Swift source guards with #available(macOS 26, *)); falls back to the SDK default target if that fails
    const target = `${arch === "arm64" ? "arm64" : "x86_64"}-apple-macos14.0`;
    const out = join(bootstrapDir, "voice-dictation");
    try { execFileSync("xcrun", ["swiftc", "-parse-as-library", "-O", "-target", target, swiftSrc, "-o", out], { stdio: "inherit" }); console.error(`[package] built voice-dictation (${target}) → resources/bootstrap/voice-dictation`); }
    catch { execFileSync("xcrun", ["swiftc", "-parse-as-library", "-O", swiftSrc, "-o", out], { stdio: "inherit" }); console.error("[package] built voice-dictation (SDK default target) → resources/bootstrap/voice-dictation"); }
  }
}
const config = builderConfig({ platform, arch, sdkDir, version: opt("version") ?? pkg.version, outDir, originalRendererDir: existsSync(join(originalRendererDir, "index.html")) ? originalRendererDir : null, quickstartsDir: existsSync(join(quickstartsDir, "catalog.json")) ? quickstartsDir : null, bootstrapDir });
const targetsArg = opt("targets");
if (targetsArg) config[platform].target = targetsArg.split(",").map((t) => ({ target: t, arch: [arch] }));

const { build, Platform } = await import("electron-builder");
const plat = { linux: Platform.LINUX, win: Platform.WINDOWS, mac: Platform.MAC }[platform];
const files = await build({ projectDir: root, targets: plat.createTarget(), config, publish: "never" });
const artifacts = files.filter((f) => existsSync(f) && statSync(f).isFile()).map((f) => ({ file: f, bytes: statSync(f).size }));
console.log(JSON.stringify({ ok: true, platform, arch, sdkBundled: !!sdkDir, artifacts, unpacked: readdirSync(outDir).filter((d) => d.endsWith("-unpacked") || /^mac(-|$)/.test(d)).map((d) => join(outDir, d)) }, null, 2));
