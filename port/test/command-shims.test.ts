import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as port from "../src/main/engine/command-shims";
import { evalOriginal, fnText, lineOf, slice } from "./original-source";

function loadOriginal() {
  const consts = slice(lineOf(/^const PYTHON_MISSING_REASON =/), lineOf(/^const PYTHON_REPAIR_MESSAGE =/));
  const shimConsts = slice(lineOf(/^const GIT_UNAVAILABLE_MESSAGE =/), lineOf(/^const ENGINE_COMMAND_SHIMS =/));
  const fns = ["shellQuote\\$1", "pythonShimScript", "pipShimScript", "gitShimScript", "commandShimScript"].map((n) => fnText(new RegExp(`^function ${n}\\(`))).join("\n");
  return evalOriginal<any>(`${consts}\n${shimConsts}\n${fns}`, "{ PYTHON_REPAIR_MESSAGE, GIT_UNAVAILABLE_MESSAGE, PIP_UNAVAILABLE_MESSAGE, ENGINE_COMMAND_SHIMS, shellQuote: shellQuote$1, pythonShimScript, pipShimScript, gitShimScript, commandShimScript }");
}

test("POSIX shim scripts are byte-identical to the original source", () => {
  const o = loadOriginal();
  assert.equal(port.PYTHON_REPAIR_MESSAGE, o.PYTHON_REPAIR_MESSAGE);
  assert.equal(port.GIT_UNAVAILABLE_MESSAGE, o.GIT_UNAVAILABLE_MESSAGE);
  assert.equal(port.PIP_UNAVAILABLE_MESSAGE, o.PIP_UNAVAILABLE_MESSAGE);
  assert.deepEqual([...port.ENGINE_COMMAND_SHIMS], o.ENGINE_COMMAND_SHIMS);
  for (const loc of ["engine", "app"] as const)
    for (const name of o.ENGINE_COMMAND_SHIMS) assert.equal(port.commandShimScript(name, loc, "darwin"), o.commandShimScript(name, loc), `${name}/${loc}`);
  assert.equal(port.shellQuote("a'b"), o.shellQuote("a'b"));
});

test("win32 shims: sh flavour points at .venv/Scripts/python.exe, .cmd siblings use CRLF + goto", () => {
  const sh = port.pythonShimScript("engine", "win32");
  assert.match(sh, /engine_python="\$bin_dir\/\.\.\/\.venv\/Scripts\/python\.exe"/);
  assert.match(port.pythonShimScript("app", "win32"), /\/\*\|\[A-Za-z\]:\*\)/);
  const cmd = port.commandShimCmd("python", "engine");
  assert.ok(cmd.includes("\r\n") && !/[^\r]\n/.test(cmd));
  assert.match(cmd, /set "engine_python=%~dp0\.\.\\\.venv\\Scripts\\python\.exe"/);
  assert.match(cmd, /^"%engine_python%" %\*\r$/m);
  assert.ok(!/\([^)]*%ERRORLEVEL%/.test(cmd), "no %ERRORLEVEL% inside a parenthesised block");
  assert.match(port.commandShimCmd("git", "app", "C:\\Program Files\\Git\\cmd\\git.exe"), /"C:\\Program Files\\Git\\cmd\\git\.exe" %\*/);
  assert.match(port.winGitShScript(undefined), /Install Git for Windows/);
});

test("writeCommandShims writes 5 POSIX shims (0755) and is idempotent; win32 adds .cmd", () => {
  const d = mkdtempSync(join(tmpdir(), "vc-shim-"));
  port.ensureEngineCommandShims(d, { platform: "linux" });
  const bin = join(d, "bin");
  assert.deepEqual(readdirSync(bin).sort(), ["git", "pip", "pip3", "python", "python3"]);
  if (process.platform !== "win32") assert.equal(statSync(join(bin, "python")).mode & 0o777, 0o755); // NTFS has no POSIX mode bits
  const m1 = statSync(join(bin, "python")).mtimeMs;
  port.ensureEngineCommandShims(d, { platform: "linux" });
  assert.equal(statSync(join(bin, "python")).mtimeMs, m1);
  const w = mkdtempSync(join(tmpdir(), "vc-shimw-"));
  port.writeCommandShims(w, "engine", { platform: "win32" });
  assert.equal(readdirSync(w).length, 10);
  assert.equal(readFileSync(join(w, "pip.cmd"), "utf8").includes(port.PIP_UNAVAILABLE_MESSAGE), true);
});

test("installAppCommandShims prepends bin to PATH (win32: replaces the case-variant key)", () => {
  const d = mkdtempSync(join(tmpdir(), "vc-app-"));
  if (process.platform !== "win32") { // linux sub-case needs host paths without a drive colon
    const env: NodeJS.ProcessEnv = { PATH: `/a:${join(d, "bin")}:/b` };
    port.installAppCommandShims(d, env, { platform: "linux" });
    assert.equal(env.PATH, `${join(d, "bin")}:/a:/b`);
  }
  const wenv: NodeJS.ProcessEnv = { Path: "C:\\x;C:\\y" };
  const bin = port.installAppCommandShims(d, wenv, { platform: "win32" });
  assert.equal(wenv.Path, `${bin};C:\\x;C:\\y`);
});

test("linux git shim forwards to the real git (original xcode probe would block it)", () => {
  assert.equal(port.commandShimScript("git", "engine", "linux", "/usr/bin/git"), "#!/bin/sh\n# VideoClaw port: forward to the system git (the macOS Xcode probe has no Linux equivalent).\nexec '/usr/bin/git' \"$@\"\n");
  assert.match(port.commandShimScript("git", "engine", "linux", undefined), /Install git and restart/);
  // darwin keeps the original bytes
  assert.match(port.commandShimScript("git", "engine", "darwin"), /xcode-select/);
  const files: Record<string, string> = { "/shim/git": "#!/bin/sh\n# VideoClaw port: x", "/fake/git": "#!/bin/sh\n# VideoClaw (#1038): y", "/usr/bin/git": "\x7fELF" };
  const found = port.findRealGit({ platform: "linux", env: { PATH: "/shim:/fake:/usr/bin" }, skipDir: "/shim", exists: (p: string) => p in files, read: (p: string) => files[p] });
  assert.equal(found, "/usr/bin/git");
  const w = port.findRealGit({ platform: "win32", env: { Path: "C:\\vc\\bin;C:\\Program Files\\Git\\cmd" }, skipDir: "C:\\vc\\bin", exists: (p: string) => p === "C:\\Program Files\\Git\\cmd\\git.exe" });
  assert.equal(w, "C:\\Program Files\\Git\\cmd\\git.exe");
  assert.equal(port.findRealGit({ platform: "darwin" }), undefined);
});
