import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/main/platform/index";

const set = (...xs: string[]) => { const s = new Set(xs); return (p: string) => s.has(p); };

test("pathDelimiter", () => {
  assert.equal(P.pathDelimiter("darwin"), ":");
  assert.equal(P.pathDelimiter("win32"), ";");
});

test("composeEnginePath: POSIX output identical to original enginePath_", () => {
  const out = P.composeEnginePath({
    engineDir: "/E", bootstrapRoots: ["/R/bootstrap", "/A/resources/bootstrap"],
    inheritedPath: "/usr/bin:/bin", exists: set("/A/resources/bootstrap/node/bin"), platform: "darwin",
  });
  assert.equal(out, "/E/bin:/A/resources/bootstrap/node/bin:/usr/bin:/bin");
});

test("composeEnginePath: win32 uses ; and accepts node.exe at node root", () => {
  const out = P.composeEnginePath({
    engineDir: "C:\\E", bootstrapRoots: ["C:\\R\\bootstrap"], inheritedPath: "C:\\Windows",
    exists: set("C:\\R\\bootstrap\\node\\node.exe"), platform: "win32",
  });
  assert.equal(out, "C:\\E\\bin;C:\\R\\bootstrap\\node;C:\\Windows");
});

test("composeEngineChildPath dedupes (case-insensitive on win32)", () => {
  assert.equal(P.composeEngineChildPath("/a:/b::/a", ["/b", "/c"], "darwin"), "/a:/b:/c");
  assert.equal(P.composeEngineChildPath("C:\\A;c:\\a", ["C:\\B"], "win32"), "C:\\A;C:\\B");
});

test("pathEnvKey finds Windows 'Path'", () => {
  assert.equal(P.pathEnvKey({ Path: "x" }, "win32"), "Path");
  assert.equal(P.pathEnvKey({ Path: "x" }, "linux"), "PATH");
});

test("venvPython", () => {
  assert.equal(P.venvPython("/E", "darwin"), "/E/.venv/bin/python");
  assert.equal(P.venvPython("C:\\E", "win32"), "C:\\E\\.venv\\Scripts\\python.exe");
});

test("exeName", () => {
  assert.equal(P.exeName("ffmpeg", "darwin"), "ffmpeg");
  assert.equal(P.exeName("ffmpeg", "win32"), "ffmpeg.exe");
  assert.equal(P.exeName("x.cmd", "win32"), "x.cmd");
});

test("extraPaths POSIX matches original EXTRA_PATHS", () => {
  assert.deepEqual(P.extraPaths("/h", "darwin"), ["/h/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/h/.cargo/bin"]);
});

test("which: POSIX", () => {
  assert.equal(P.which("uv", { env: { PATH: "/a:/b" }, platform: "linux", isFile: set("/b/uv") }), "/b/uv");
  assert.equal(P.which("uv", { env: { PATH: "/a" }, platform: "linux", isFile: set() }), undefined);
});

test("which: win32 PATHEXT + Path key + quoted dirs", () => {
  const env = { Path: 'C:\\x;"C:\\Git\\bin"', PATHEXT: ".EXE;.CMD" };
  assert.equal(P.which("bash", { env, platform: "win32", isFile: set("C:\\Git\\bin\\bash.exe") }), "C:\\Git\\bin\\bash.exe");
  assert.equal(P.which("npm", { env, platform: "win32", isFile: set("C:\\x\\npm.cmd") }), "C:\\x\\npm.cmd");
  assert.equal(P.which("bash.exe", { env, platform: "win32", isFile: set("C:\\Git\\bin\\bash.exe") }), "C:\\Git\\bin\\bash.exe");
});

test("resolveBootstrapToolRoots order + VIDEOCLAW_ENGINE_DIST", () => {
  assert.deepEqual(
    P.resolveBootstrapToolRoots({ resourcesPath: "/res", appPath: "/app", packaged: false, env: { VIDEOCLAW_ENGINE_DIST: " /dev " }, platform: "darwin" }),
    ["/dev", "/res/bootstrap", "/app/resources/bootstrap", "/app/apps/desktop/resources/bootstrap"],
  );
  assert.deepEqual(P.resolveBootstrapToolRoots({ resourcesPath: "/res", appPath: "/app", packaged: true, env: {}, platform: "darwin" }), ["/res/bootstrap"]);
});

test("bootstrapTool: exe suffix + port-only override", () => {
  const roots = ["C:\\R\\bootstrap"];
  assert.equal(P.bootstrapTool("ffmpeg", { roots, exists: set("C:\\R\\bootstrap\\ffmpeg.exe"), env: {}, platform: "win32" }), "C:\\R\\bootstrap\\ffmpeg.exe");
  assert.equal(P.bootstrapTool("ffmpeg", { roots, exists: set("D:\\ff.exe"), env: { VIDEOCLAW_PORT_FFMPEG: "D:\\ff.exe" }, platform: "win32" }), "D:\\ff.exe");
  assert.equal(P.bootstrapTool("ffmpeg", { roots: ["/r"], exists: set("/r/ffmpeg"), env: {}, platform: "darwin" }), "/r/ffmpeg");
});

test("bashShell: POSIX is /bin/bash; win32 prefers Git bash, skips WSL launcher, falls back to cmd (degraded)", () => {
  assert.equal(P.bashShell({ platform: "darwin", which: () => undefined, exists: () => false }).file, "/bin/bash");
  const g = P.bashShell({ platform: "win32", env: { ProgramFiles: "C:\\PF" }, which: () => "C:\\Windows\\System32\\bash.exe", exists: set("C:\\PF\\Git\\bin\\bash.exe") });
  assert.equal(g.file, "C:\\PF\\Git\\bin\\bash.exe");
  assert.equal(g.degraded, false);
  const c = P.bashShell({ platform: "win32", env: { ComSpec: "C:\\Windows\\system32\\cmd.exe" }, which: () => undefined, exists: () => false });
  assert.equal(c.kind, "cmd");
  assert.equal(c.degraded, true);
  assert.deepEqual(c.argsFor("echo hi"), ["/d", "/s", "/c", "echo hi"]);
});

test("spawnDetachedForGroup mirrors original", () => {
  assert.equal(P.spawnDetachedForGroup("darwin"), true);
  assert.equal(P.spawnDetachedForGroup("win32"), false);
});

test("parsePsOutput (original regex)", () => {
  assert.deepEqual(P.parsePsOutput("  1     0 /sbin/launchd\n 42 1 uv run python x.py --job a\nbad\n"), [
    { pid: 1, ppid: 0, command: "/sbin/launchd" },
    { pid: 42, ppid: 1, command: "uv run python x.py --job a" },
  ]);
});

test("parseWin32ProcessJson handles single object, array, null CommandLine", () => {
  assert.deepEqual(P.parseWin32ProcessJson('{"ProcessId":4,"ParentProcessId":0,"CommandLine":null,"ExecutablePath":null}'), []);
  assert.deepEqual(
    P.parseWin32ProcessJson('[{"ProcessId":10,"ParentProcessId":4,"CommandLine":"python.exe x.py","ExecutablePath":"C:\\\\p.exe"},{"ProcessId":11,"ParentProcessId":10,"CommandLine":null,"ExecutablePath":"C:\\\\f.exe"}]'),
    [{ pid: 10, ppid: 4, command: "python.exe x.py" }, { pid: 11, ppid: 10, command: "C:\\f.exe" }],
  );
  assert.deepEqual(P.parseWin32ProcessJson(""), []);
});

test("processCwd on win32 is an explicit unsupported (undefined)", () => {
  assert.equal(P.processCwd(1234, "win32"), undefined);
});

test("killTree: POSIX signals the process group (-pid)", () => {
  const calls: [number, string][] = [];
  assert.equal(P.killTree(77, "SIGTERM", { platform: "darwin", kill: ((pid: number, s: string) => { calls.push([pid, s]); return true; }) as any }), true);
  assert.deepEqual(calls, [[-77, "SIGTERM"]]);
});

test("killTree: win32 uses taskkill /T (+/F for SIGKILL)", () => {
  const runs: [string, string[]][] = [];
  const run = (f: string, a: string[]) => { runs.push([f, a]); return 0; };
  P.killTree(77, "SIGTERM", { platform: "win32", run });
  P.killTree(77, "SIGKILL", { platform: "win32", run });
  assert.deepEqual(runs, [["taskkill.exe", ["/PID", "77", "/T"]], ["taskkill.exe", ["/PID", "77", "/T", "/F"]]]);
});

test("pdfReaderFor: non-darwin = original's unread/unavailable", () => {
  assert.deepEqual(P.pdfReaderFor("win32"), { kind: "unread", cause: "unavailable" });
  assert.deepEqual(P.pdfReaderFor("darwin"), { kind: "delegate-to-original", osascript: "/usr/bin/osascript" });
});

test("voiceDictationStatus without helper = original's message", async () => {
  assert.deepEqual(await P.voiceDictationStatus({ helper: "", ffmpeg: "" }), { available: false, attach: false, message: "Voice notes are unavailable in this build." });
  assert.deepEqual(await P.voiceDictationStatus({ helper: "", ffmpeg: "C:\\ff.exe" }), { available: false, attach: true, message: P.VOICE_ERRORS.unavailable });
});

test("needsNativePythonProbe only on darwin/arm64", () => {
  assert.equal(P.needsNativePythonProbe("win32", "x64"), false);
  assert.equal(P.needsNativePythonProbe("darwin", "arm64"), true);
});
