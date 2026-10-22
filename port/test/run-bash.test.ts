import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBash, truncate, MAX_OUTPUT_CHARS, NO_BASH_MESSAGE } from "../src/main/engine/run-bash";
import { bashShell } from "../src/main/platform/shell";

const env = { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME } as NodeJS.ProcessEnv }; // HOME: macOS login profiles (brew shellenv) complain without it

test("runBash: success / non-zero exit text identical to original strings", async () => {
  assert.deepEqual(await runBash({ command: "echo hi" }, env), { output: "hi\n", isError: false });
  assert.deepEqual(await runBash({ command: "echo oops; exit 3" }, env), { output: "oops\n\n\nCommand exited with code 3", isError: true });
});

test("runBash: output-pipeline commands get pipefail (failure is not masked by tail)", async () => {
  const r = await runBash({ command: "sh -c 'exit 7' | tail -n 1" }, env);
  assert.equal(r.isError, true);
  assert.match(r.output, /Command exited with code 7$/);
});

test("runBash: timeout kills the process group", async () => {
  const r = await runBash({ command: "sleep 5", timeout: 100 }, env);
  assert.deepEqual(r, { output: "\n\nCommand timed out after 100ms", isError: true });
});

test("runBash: abort", async () => {
  const ac = new AbortController();
  const p = runBash({ command: "sleep 5" }, { ...env, signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  assert.deepEqual(await p, { output: "Command aborted", isError: true });
});

test("runBash on win32 routes through the chosen shell + taskkill (mocked)", async () => {
  const calls: any[] = [];
  const { EventEmitter } = await import("node:events");
  let child: any;
  const keepAlive = setTimeout(() => {}, 5000); // the mocked child holds no real handle; keep the loop alive
  const r = runBash({ command: "x | tail", timeout: 30 }, {
    ...env,
    deps: {
      platform: "win32",
      shell: { file: "C:\\Git\\bin\\bash.exe", argsFor: (c) => ["-c", c], kind: "bash", degraded: false },
      spawn: ((f: string, a: string[], o: any) => { calls.push({ f, a, detached: o.detached }); const c: any = new EventEmitter(); c.pid = 9; c.kill = () => {}; child = c; return c; }) as any,
      killTree: (pid, sig) => { calls.push({ pid, sig }); setImmediate(() => child.emit("close", null, "SIGKILL")); return true; },
    },
  });
  assert.deepEqual((await r).isError, true);
  assert.deepEqual(calls[0], { f: "C:\\Git\\bin\\bash.exe", a: ["-c", "set -o pipefail\nx | tail"], detached: false });
  assert.deepEqual(calls[1], { pid: 9, sig: "SIGKILL" });
  clearTimeout(keepAlive);
});

test("W13: degraded shell (no Git Bash → cmd) fails closed, nothing spawned", async () => {
  let spawned = false;
  const r = await runBash({ command: "uv run python tools/x.py | tail -n 5" }, {
    ...env,
    deps: { platform: "win32", shell: { file: "cmd.exe", argsFor: (c) => ["/d", "/s", "/c", c], kind: "cmd", degraded: true }, spawn: (() => { spawned = true; throw new Error("no"); }) as any },
  });
  assert.deepEqual(r, { output: NO_BASH_MESSAGE, isError: true });
  assert.equal(spawned, false);
});

test("W13 (real win32): a machine without Git — PATH=System32 only, empty Program Files — picks cmd and fails closed", { skip: process.platform !== "win32" && "win32 only" }, async () => {
  const empty = mkdtempSync(join(tmpdir(), "vc-nogit-"));
  const sys = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`;
  const noGit = { PATH: sys, Path: undefined, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, ProgramFiles: empty, "ProgramFiles(x86)": empty, LOCALAPPDATA: empty } as NodeJS.ProcessEnv;
  try {
    const { which } = await import("../src/main/platform/which");
    const { existsSync, statSync } = await import("node:fs");
    const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
    const choice = bashShell({ platform: "win32", env: noGit, which: (c) => which(c, { env: noGit, platform: "win32", isFile }), exists: existsSync });
    assert.equal(choice.kind, "cmd"); assert.equal(choice.degraded, true);
    assert.deepEqual(await runBash({ command: "echo hi | tail -n 1" }, { cwd: empty, env: noGit }), { output: NO_BASH_MESSAGE, isError: true });
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test("truncate keeps head+tail like the original", () => {
  const s = "a".repeat(MAX_OUTPUT_CHARS + 10);
  assert.match(truncate(s, MAX_OUTPUT_CHARS), /\[truncated — 10 characters omitted\]/);
});
