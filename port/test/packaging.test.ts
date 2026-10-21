// PORT-NEW docs/18: electron-builder configuration + where the bundled Claude Agent SDK lands vs.
// the runtime discovery in agent-sdk.ts, SDK staging validation, packaged-app diagnostics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { builderConfig, PLATFORMS, sdkResourceFilter, validateSdkStaging, SDK_RESOURCE_DIR, nativeSdkPackage } from "../tools/packaging-config.mjs";
import { discoverClaudeAgentSdk, PINNED_CLAUDE_AGENT_SDK_VERSION } from "../src/main/llm/agent-sdk";
import { agentSdkStatus, portDiagnostics } from "../src/main/port-diagnostics";

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("builderConfig (linux): asar app = dist + package.json only; SDK as extraResources → resources/claude-agent-sdk/node_modules; AppImage+deb; own identity", () => {
  const c = builderConfig({ platform: "linux", arch: "x64", sdkDir: "/v/sdk", version: pkg.version });
  assert.equal(c.asar, true);
  assert.deepEqual(c.linux.target, [{ target: "AppImage", arch: ["x64"] }, { target: "deb", arch: ["x64"] }]);
  for (const ex of ["!node_modules{,/**/*}", "!vendor{,/**/*}", "!dist-test{,/**/*}"]) assert.ok(c.files.includes(ex), ex);
  assert.ok(c.files.includes("dist/**/*") && c.files.includes("package.json"));
  assert.equal(c.extraMetadata.main, pkg.main);
  assert.deepEqual(c.extraResources.map((e: any) => [e.from, e.to]), [["/v/sdk/node_modules", `${SDK_RESOURCE_DIR}/node_modules`]]);
  assert.equal(c.npmRebuild, false, "no native addons (node:sqlite is builtin)");
  assert.notEqual(c.productName, "Videoclaw", "separate userData from the original app");
  assert.equal(c.publish, null);
  assert.deepEqual(builderConfig({ platform: "linux", arch: "x64", sdkDir: null, version: "1" }).extraResources, []);
  // docs/21 M1: the unmodified original renderer ships as resources/renderer-original
  assert.deepEqual(builderConfig({ platform: "linux", arch: "x64", sdkDir: null, version: "1", originalRendererDir: "/r/app/out/renderer" }).extraResources.map((e: any) => [e.from, e.to]), [["/r/app/out/renderer", "renderer-original"]]);
  // docs/24: the shipped bundled Quickstart catalog → resources/quickstarts (original candidate root L61021)
  assert.deepEqual(builderConfig({ platform: "linux", arch: "x64", sdkDir: null, version: "1", quickstartsDir: "/r/app/resources/quickstarts" }).extraResources.map((e: any) => [e.from, e.to]), [["/r/app/resources/quickstarts", "quickstarts"]]);
  assert.throws(() => builderConfig({ platform: "beos" as any, arch: "x64", version: "1" }));
});

test("builderConfig (win/mac): nsis / dmg targets configured but marked unverified on the box", () => {
  const w = builderConfig({ platform: "win", arch: "x64", sdkDir: "/s", version: "1" });
  assert.deepEqual(w.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(w.linux.target, undefined);
  const m = builderConfig({ platform: "mac", arch: "arm64", sdkDir: "/s", version: "1" });
  assert.deepEqual(m.mac.target, [{ target: "dmg", arch: ["arm64"] }]);
  assert.equal(PLATFORMS.linux.verifiedOnBox, true);
  assert.equal(PLATFORMS.win.verifiedOnBox, false);
  assert.equal(PLATFORMS.mac.verifiedOnBox, false);
});

test("sdkResourceFilter: keeps the target native package, drops every other platform (incl. musl)", () => {
  const f = sdkResourceFilter("win32", "x64");
  assert.equal(f[0], "**/*");
  assert.ok(!f.some((p) => p.includes(`${nativeSdkPackage("win32", "x64")}{`)));
  for (const other of ["linux-x64", "linux-x64-musl", "darwin-arm64", "win32-arm64"]) assert.ok(f.includes(`!@anthropic-ai/claude-agent-sdk-${other}{,/**/*}`), other);
});

/** builds a fake installed SDK (package.json + sdk.mjs + native binary) under `nm` */
function fakeSdk(nm: string, version = PINNED_CLAUDE_AGENT_SDK_VERSION, plat = `${process.platform}-${process.arch}`) {
  const d = join(nm, "@anthropic-ai", "claude-agent-sdk");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version, type: "module" }));
  writeFileSync(join(d, "sdk.mjs"), "export function query(){ return { async *[Symbol.asyncIterator](){} }; }\n");
  const n = join(nm, "@anthropic-ai", `claude-agent-sdk-${plat}`);
  mkdirSync(n, { recursive: true });
  const exe = join(n, plat.startsWith("win32") ? "claude.exe" : "claude");
  writeFileSync(exe, "#!/bin/sh\necho fake\n");
  chmodSync(exe, 0o755);
  return { pkgDir: d, exe };
}

test("packaged layout ↔ discovery: what extraResources produces is found as source 'resources' with the native binary (no env, no vendor, no ~/.videoclaw)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-pack-"));
  try {
    const c = builderConfig({ platform: "linux", arch: "x64", sdkDir: "/x", version: "1" });
    const resourcesPath = join(dir, "resources");
    const { pkgDir, exe } = fakeSdk(join(resourcesPath, c.extraResources[0].to));
    const appRoot = join(resourcesPath, "app.asar"); // __dirname/../.. in the packaged main bundle
    const d = discoverClaudeAgentSdk({ env: {}, appRoot, resourcesPath, home: join(dir, "home") });
    assert.equal(d.source, "resources");
    assert.equal(d.packageDir, pkgDir);
    const st = agentSdkStatus({ env: {}, appRoot, resourcesPath, home: join(dir, "home") });
    assert.deepEqual({ ok: st.ok, source: st.source, matchesPin: st.matchesPin, executable: st.executable }, { ok: true, source: "resources", matchesPin: true, executable: exe });
    // the original's asarUnpack layout wins if both are present (candidate #3 before #4)
    fakeSdk(join(resourcesPath, "app.asar.unpacked", "node_modules"));
    assert.equal(discoverClaudeAgentSdk({ env: {}, appRoot, resourcesPath, home: join(dir, "home") }).source, "resources-unpacked");
    // nothing bundled → typed failure, not a throw
    const none = agentSdkStatus({ env: {}, appRoot: join(dir, "nope"), resourcesPath: join(dir, "nope"), home: join(dir, "nope") });
    assert.equal(none.ok, false);
    assert.match(none.error!, /agent-sdk:install/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validateSdkStaging: missing / wrong version / missing native binary for the TARGET platform", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-stage-"));
  const io = { exists: (p: string) => { try { readFileSync(p); return true; } catch { return false; } }, readJson: (p: string) => JSON.parse(readFileSync(p, "utf8")) };
  try {
    assert.match(validateSdkStaging(dir, { os: "linux", arch: "x64", pinned: "0.3.305", ...io })[0], /not installed/);
    fakeSdk(join(dir, "node_modules"), "0.3.305", "linux-x64");
    assert.deepEqual(validateSdkStaging(dir, { os: "linux", arch: "x64", pinned: "0.3.305", ...io }), []);
    assert.match(validateSdkStaging(dir, { os: "linux", arch: "x64", pinned: "0.3.999", ...io }).join(), /!= pinned/);
    assert.match(validateSdkStaging(dir, { os: "win32", arch: "x64", pinned: "0.3.305", ...io }).join(), /claude-agent-sdk-win32-x64\/claude\.exe.*--os win32/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("package.json / repo hygiene for packaging: no runtime deps (all bundled), scripts, electron-builder pinned, outputs gitignored", () => {
  assert.deepEqual(pkg.dependencies ?? {}, {}, "esbuild bundles everything except electron → app.asar needs no node_modules");
  assert.match(readFileSync(join(root, "tools/build.mjs"), "utf8"), /external: \["electron"\]/);
  for (const s of ["package:linux", "package:win", "package:mac", "package:smoke", "agent-sdk:install"]) assert.ok(pkg.scripts[s], s);
  assert.match(pkg.devDependencies["electron-builder"], /^\d+\.\d+\.\d+$/, "exact pin");
  assert.equal(pkg.config.claudeAgentSdkVersion, PINNED_CLAUDE_AGENT_SDK_VERSION);
  const gi = readFileSync(join(root, "..", ".gitignore"), "utf8");
  for (const p of ["port/vendor/", "port/release/", "port/build/", "*.sqlite"]) assert.ok(gi.includes(p), p);
});

test("portDiagnostics: app facts + node:sqlite probe + SDK status (no secrets)", () => {
  const d = portDiagnostics({ version: "9.9.9", packaged: true, resourcesPath: "/nowhere/resources", appPath: "/nowhere/resources/app.asar", userData: "/tmp/ud", env: { ANTHROPIC_API_KEY: "sk-should-not-appear" } });
  assert.equal(d.app.version, "9.9.9");
  assert.equal(d.app.packaged, true);
  assert.equal(d.sqlite.ok, true);
  assert.match(d.sqlite.sqliteVersion!, /^3\./);
  assert.equal(typeof d.agentSdk.ok, "boolean");
  assert.equal(d.agentSdk.pinned, PINNED_CLAUDE_AGENT_SDK_VERSION);
  assert.ok(!JSON.stringify(d).includes("sk-should-not-appear"));
});
