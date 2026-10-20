import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as B from "../src/main/engine/bootstrap";
import { resolveEditorRenderEngine, absCwd } from "../src/main/engine/engine-env";
import { npmInvocation, tarInvocation } from "../src/main/platform";
import { evalOriginal, fnText, lineOf, slice } from "./original-source";

test("pure helpers match the original source (compareEngineVersions, manifest compat, classify, doctorFailures, scrub regex)", () => {
  const code = [fnText(/^function compareEngineVersions\(/), slice(lineOf(/^const STORAGE_FAILURE =/), lineOf(/^const STORAGE_FAILURE =/) + 1), fnText(/^function classifyBootstrapFailure\(/), 'const MIN_PLAN_FREE_ENGINE_APP_VERSION = "0.0.11";', fnText(/^function engineManifestCompatibility\(/), fnText(/^function doctorFailures\(/)].join("\n");
  const o = evalOriginal<any>(code, "{ compareEngineVersions, classifyBootstrapFailure, engineManifestCompatibility, doctorFailures }");
  const vs = ["0.0.40", "0.0.9", "v1.2", "1.2.0", "1.2.0-rc1", "1.2.0-rc2", "x", "0.0.11"];
  for (const a of vs) for (const b of vs) assert.equal(Math.sign(B.compareEngineVersions(a, b)), Math.sign(o.compareEngineVersions(a, b)), `${a} ${b}`);
  const ms = [null, [], {}, { version: "1" }, { version: "1", minAppVersion: "bad" }, { version: "1", minAppVersion: "0.0.5" }, { version: "1", minAppVersion: "0.0.99" }, { version: "1", minAppVersion: "0.0.12" }];
  for (const m of ms) assert.deepEqual(B.engineManifestCompatibility(m, "0.0.40"), o.engineManifestCompatibility(m, "0.0.40"));
  const errs = [{ code: "ENOSPC" }, new Error("No space left on device"), { message: "x", cause: { stderr: "disk full" } }, new Error("nope")];
  for (const e of errs) assert.equal(B.classifyBootstrapFailure(e), o.classifyBootstrapFailure(e));
  const rep = { checks: { a: { ok: true }, b: { ok: false, detail: "d" }, c: { ok: false, detail: "d", fix: "f" } } };
  assert.equal(B.doctorFailures(rep), o.doctorFailures(rep));
});

test("argv / env builders match the original call sites", () => {
  assert.deepEqual(B.doctorArgv("/e", "darwin"), ["run", "--project", "/e", "python", "/e/tools/doctor.py", "--json"]);
  assert.deepEqual(B.doctorArgv("C:\\e", "win32"), ["run", "--project", "C:\\e", "python", "C:\\e\\tools\\doctor.py", "--json"]);
  assert.deepEqual(B.syncArgv("/e"), ["sync", "--frozen", "--project", "/e"]);
  assert.deepEqual(B.engineDoctorEnv({ enginePath: "/e", workspace: "/w", enginePathEnv: "P", gatewayUrl: "https://g", platform: "darwin" }), {
    VIDEOCLAW_GATEWAY_URL: "https://g", VIDEOCLAW_API_KEY: "vcs_doctor_no_authority", VIDEOCLAW_ENGINE: "/e", VIDEOCLAW_WORKSPACE: "/w", VIDEOCLAW_JOBS_DIR: "/w/jobs", UV_PYTHON_PREFERENCE: "only-managed", PATH: "P",
  });
  assert.deepEqual(B.parseDoctorOutput('warning: x\n{"ok":true,"checks":{}}'), { ok: true, checks: {} });
  assert.deepEqual(B.mergeEnv({ Path: "a", X: "1" }, { PATH: "b" }, "win32"), { X: "1", PATH: "b" });
  assert.deepEqual(B.mergeEnv({ Path: "a" }, { PATH: "b" }, "linux"), { Path: "a", PATH: "b" });
});

test("platform npm/tar invocations", () => {
  assert.deepEqual(npmInvocation("npm", ["ci"], { platform: "darwin" }), { file: "npm", args: ["ci"] });
  const ex = (p: string) => p.startsWith("C:\\b\\node\\");
  assert.deepEqual(npmInvocation("npx", ["remotion"], { platform: "win32", nodeDirs: ["C:\\b\\node"], exists: ex }), { file: "C:\\b\\node\\node.exe", args: ["C:\\b\\node\\node_modules\\npm\\bin\\npx-cli.js", "remotion"] });
  assert.deepEqual(npmInvocation("npm", ["ci"], { platform: "win32", nodeDirs: [], exists: () => false }), { file: "npm.cmd", args: ["ci"], shell: true });
  assert.deepEqual(tarInvocation(["-xf"], { platform: "win32", env: { SystemRoot: "C:\\WINDOWS" } }), { file: "C:\\WINDOWS\\System32\\tar.exe", args: ["-xf"] });
  assert.deepEqual(tarInvocation(["-xf"], { platform: "linux" }), { file: "tar", args: ["-xf"] });
});

test("scrubEngineGatewaySecrets output identical to original", () => {
  const d = mkdtempSync(join(tmpdir(), "vc-env-"));
  writeFileSync(join(d, ".env"), "A=1\nexport VIDEOCLAW_API_KEY=x\nVIDEOCLAW_GW_URL=y\n\nB=2\n");
  B.scrubEngineGatewaySecrets(d, "linux");
  assert.equal(readFileSync(join(d, ".env"), "utf8"), "A=1\n\nB=2\n# Videoclaw injects a private session gateway credential at runtime.\n");
});

function makeEngineTarball(root: string) {
  const src = join(root, "src", "engine");
  mkdirSync(join(src, "tools"), { recursive: true });
  writeFileSync(join(src, "ENGINE_VERSION.json"), JSON.stringify({ version: "9.9.9" }));
  mkdirSync(join(src, "hyperframes"), { recursive: true });
  writeFileSync(join(src, "hyperframes", "package-lock.json"), "{}");
  const tgz = join(root, "engine-9.9.9.tar.gz");
  execFileSync("tar", ["-czf", tgz, "-C", join(root, "src"), "engine"]);
  const sha = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  return { tgz, sha };
}

test("BootstrapCore.runAll: full step machine with a recording runner (real tar, fake uv/npm)", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-boot-"));
  const { tgz, sha } = makeEngineTarball(root);
  const bootDir = join(root, "bootstrap");
  mkdirSync(bootDir);
  writeFileSync(join(bootDir, "uv"), "#!/bin/sh\n");
  const calls: any[] = [];
  const real = B.createRunner();
  const run: B.Runner = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd, env: opts?.env });
    if (cmd === "tar") return real(cmd, args, opts);
    if (args.includes("--json")) return 'noise {"ok":true,"checks":{"ffmpeg":{"ok":true}}}';
    return "";
  };
  const progress: any[] = [];
  const shims: string[] = [];
  const core = new B.BootstrapCore(
    { platform: "linux", userData: join(root, "ud"), workspaceRoot: join(root, "ws"), bootstrapRoots: [bootDir], packaged: true, inheritedPath: "/usr/bin", bootstrapTool: (n) => (n === "uv" ? join(bootDir, "uv") : undefined) },
    B.notPortedHooks({
      resolveEngineSource: async () => ({ manifest: { version: "9.9.9", minAppVersion: "0.0.12", sha256: sha }, fetch: async () => tgz }),
      validateEngineSessionContext: () => {},
      assertInstalledEngineProductionContract: () => {},
      inspectProductionCompatible: () => true,
      writeWorkspace: () => {},
      assertEngineMoneyCompatibility: async () => {},
      ensureEngineCommandShims: (e) => { shims.push(e); },
    }),
    run,
    (p) => progress.push(p),
  );
  const status = await core.runAll();
  const eng = join(root, "ud", "engines", "engine-9.9.9");
  assert.deepEqual(progress.filter((p) => p.status !== "running").map((p) => `${p.step}:${p.status}`), ["layout:ok", "engine:ok", "venv:ok", "remotion:ok", "hyperframes:ok", "workspace:ok", "env:ok", "doctor:ok"]);
  assert.equal(status.ready, true);
  assert.equal(status.engineVersion, "9.9.9");
  assert.ok(existsSync(join(eng, "bin", "uv")));
  assert.equal(readFileSync(join(eng, ".videoclaw-build-sha256"), "utf8"), `${sha}\n`);
  const uvSync = calls.find((c) => c.args[0] === "sync");
  assert.deepEqual(uvSync, { cmd: join(bootDir, "uv"), args: ["sync", "--frozen", "--project", eng], cwd: eng, env: { UV_PYTHON_PREFERENCE: "only-managed" } });
  const npmCi = calls.filter((c) => c.cmd === "npm");
  assert.deepEqual(npmCi.map((c) => c.cwd), [join(eng, "remotion"), join(eng, "hyperframes")]);
  assert.equal(npmCi[0].env.PATH, `${join(eng, "bin")}:/usr/bin`);
  const doc = calls.find((c) => c.args.includes("--json"));
  assert.deepEqual(doc.args, ["run", "--project", eng, "python", join(eng, "tools", "doctor.py"), "--json"]);
  assert.equal(JSON.parse(readFileSync(join(root, "ud", "engine-current.json"), "utf8")).path, eng);
  assert.deepEqual(shims, [eng, eng]);
});

test("BootstrapCore: sha mismatch fails the engine step with the original message; unported hooks never pass silently", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-boot2-"));
  const { tgz } = makeEngineTarball(root);
  const progress: any[] = [];
  const core = new B.BootstrapCore(
    { platform: "linux", userData: join(root, "ud"), workspaceRoot: join(root, "ws"), bootstrapRoots: [], packaged: true, bootstrapTool: () => undefined },
    B.notPortedHooks({ resolveEngineSource: async () => ({ manifest: { version: "1", minAppVersion: "0.0.12", sha256: "0".repeat(64) }, fetch: async () => tgz }) }),
    async () => "", (p) => progress.push(p));
  await assert.rejects(core.runAll(), /engine sha mismatch: got /);
  assert.equal(progress.at(-1).step, "engine");
  assert.equal(progress.at(-1).status, "fail");
  assert.throws(() => B.notPortedHooks().writeWorkspace("/x"), /NOT PORTED: writeWorkspace/);
});

test("resolveEditorRenderEngine mirrors the original branches", () => {
  const base = { env: { A: "1" } as NodeJS.ProcessEnv, engineSessionEnv: () => ({ VIDEOCLAW_ENGINE: "/eng" }), workspaceRoot: () => "/ws", platform: "linux" as const, home: "/h" };
  assert.equal(resolveEditorRenderEngine({ ...base, isPackaged: true, currentEngine: () => null }), null);
  const r = resolveEditorRenderEngine({ ...base, isPackaged: true, currentEngine: () => ({ path: "/eng" }), gatewayKey: () => "k", exists: (p) => p === "/eng/bin/uv" })!;
  assert.deepEqual(r, { root: "/eng", executable: "/eng/bin/uv", env: { A: "1", VIDEOCLAW_ENGINE: "/eng", VIDEOCLAW_API_KEY: "k", UV_PYTHON_PREFERENCE: "only-managed" } });
  const dev = resolveEditorRenderEngine({ ...base, env: { VIDEOCLAW_HYPERFRAMES_ENGINE: " ~/x " }, isPackaged: false, currentEngine: () => null, exists: () => true })!;
  assert.equal(dev.root, "/h/x");
  assert.equal(dev.env.VIDEOCLAW_WORKSPACE, "/ws");
  assert.equal(resolveEditorRenderEngine({ ...base, env: { VIDEOCLAW_HYPERFRAMES_ENGINE: "/x" }, isPackaged: true, currentEngine: () => null }), null, "dev override ignored when packaged");
  const w = resolveEditorRenderEngine({ ...base, platform: "win32", isPackaged: true, currentEngine: () => ({ path: "C:\\eng" }), exists: (p) => p === "C:\\eng\\bin\\uv.exe" })!;
  assert.equal(w.executable, "C:\\eng\\bin\\uv.exe");
  assert.equal(absCwd("~\\a", "win32", "C:\\h"), "C:\\h\\a");
});

import { claudeCodeExecutable, resolveCodexExecutable } from "../src/main/engine/engine-env";
test("claude / codex executable resolution (original order; win32 suffix)", () => {
  assert.equal(claudeCodeExecutable({ isPackaged: false, appPath: "/x" }), "claude");
  assert.equal(claudeCodeExecutable({ isPackaged: true, appPath: "/A/Resources/app.asar", platform: "darwin", arch: "arm64" }), "/A/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude");
  assert.equal(claudeCodeExecutable({ isPackaged: true, appPath: "C:\\V\\resources\\app.asar", platform: "win32", arch: "x64" }), "C:\\V\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe");
  assert.equal(resolveCodexExecutable({ env: { VIDEOCLAW_CODEX_BIN: " C:\\c\\codex.exe " }, platform: "win32" }), "C:\\c\\codex.exe");
  assert.equal(resolveCodexExecutable({ env: {}, resourcesPath: "C:\\r", exists: () => true, platform: "win32" }), "C:\\r\\bootstrap\\codex\\bin\\codex.exe");
  assert.equal(resolveCodexExecutable({ env: {}, resourcesPath: "/r", exists: () => false, platform: "darwin" }), "codex");
  assert.throws(() => resolveCodexExecutable({ env: {}, requireBundled: true, exists: () => false }), /The packaged Codex runtime is unavailable/);
});

import { writeWorkspacePartial } from "../src/main/engine/workspace";
test("writeWorkspacePartial: dirs, taste packs, verbatim settings.json", () => {
  const root = mkdtempSync(join(tmpdir(), "vc-wsp-"));
  const eng = join(root, "e");
  mkdirSync(join(eng, ".claude"), { recursive: true });
  mkdirSync(join(eng, "taste", "packs", "_starter"), { recursive: true });
  writeFileSync(join(eng, "taste", "packs", "_starter", "README.md"), "x");
  writeFileSync(join(eng, ".claude", "settings.json"), '{"a":1}\r\n');
  const ws = join(root, "w");
  writeWorkspacePartial(eng, ws);
  for (const d of ["jobs", "assets", "incoming", "taste/packs", ".claude"]) assert.ok(existsSync(join(ws, d)), d);
  assert.equal(readFileSync(join(ws, "taste", "packs", "_starter", "README.md"), "utf8"), "x");
  assert.equal(readFileSync(join(ws, ".claude", "settings.json"), "utf8"), '{"a":1}\r\n');
});
