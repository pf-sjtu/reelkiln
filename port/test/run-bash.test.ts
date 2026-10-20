import { test } from "node:test";
import assert from "node:assert/strict";
import { runBash, truncate, MAX_OUTPUT_CHARS } from "../src/main/engine/run-bash";

const env = { cwd: process.cwd(), env: { PATH: process.env.PATH } as NodeJS.ProcessEnv };

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
  const r = runBash({ command: "x | tail", timeout: 30 }, {
    ...env,
    deps: {
      platform: "win32",
      shell: { file: "C:\\Git\\bin\\bash.exe", argsFor: (c) => ["-c", c], kind: "bash", degraded: false },
      spawn: ((f: string, a: string[], o: any) => { calls.push({ f, a, detached: o.detached }); const c: any = new EventEmitter(); c.pid = 9; c.kill = () => {}; return c; }) as any,
      killTree: (pid, sig) => { calls.push({ pid, sig }); return true; },
    },
  });
  assert.deepEqual((await r).isError, true);
  assert.deepEqual(calls[0], { f: "C:\\Git\\bin\\bash.exe", a: ["-c", "set -o pipefail\nx | tail"], detached: false });
  assert.deepEqual(calls[1], { pid: 9, sig: "SIGKILL" });
});

test("truncate keeps head+tail like the original", () => {
  const s = "a".repeat(MAX_OUTPUT_CHARS + 10);
  assert.match(truncate(s, MAX_OUTPUT_CHARS), /\[truncated — 10 characters omitted\]/);
});
