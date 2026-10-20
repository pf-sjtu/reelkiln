import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { dirIdentity, relativeWrite, writeProjectStream } from "../src/main/studio/relative-writer";
import { slice, lineOf } from "./original-source";

async function* chunks(...c: string[]) { for (const x of c) yield x; }

test("writeProjectStream (Node) writes, never overwrites, numbers duplicates, leaves no staging files", async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-rw-"));
  const dir = { path: d, identity: dirIdentity(d) };
  const w = (name: string, ...c: string[]) => writeProjectStream({ prepare: () => dir, reattest: () => {}, preferredName: name, input: () => chunks(...c) });
  assert.equal(await w("a.txt", "he", "llo"), join(d, "a.txt"));
  assert.equal(await w("a.txt", "second"), join(d, "a_1.txt"));
  assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "hello");
  assert.equal(readFileSync(join(d, "a_1.txt"), "utf8"), "second");
  assert.equal(statSync(join(d, "a.txt")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(d).sort(), ["a.txt", "a_1.txt"]);
});

test("identity change → 73 / original message; stream error → 76 rethrows the stream error", async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-rw2-"));
  const dir = { path: d, identity: "0:0" };
  await assert.rejects(writeProjectStream({ prepare: () => dir, reattest: () => {}, preferredName: "x", input: () => chunks("a") }), /Studio destination changed before the relative write\./);
  async function* bad() { yield "a"; throw new Error("boom"); }
  const ok = { path: d, identity: dirIdentity(d) };
  await assert.rejects(writeProjectStream({ prepare: () => ok, reattest: () => {}, preferredName: "x", input: bad }), /boom/);
  assert.deepEqual(readdirSync(d), []);
});

test("differential: original RELATIVE_WRITER shell script vs Node port (linux branch, same exit codes)", { skip: process.platform !== "linux" && "the original script's linux branch needs GNU coreutils" }, async (t) => {
  const script = slice(lineOf(/^const RELATIVE_WRITER = String\.raw`/) + 1, lineOf(/^const RELATIVE_WRITER = String\.raw`/) + 54).replace(/`;$/, "");
  const runSh = (dir: string, ident: string, name: string, data: string) => new Promise<number>((resolve) => {
    const c = spawn("/bin/sh", ["-c", script, "videoclaw-relative-writer", ident, name, "linux", `.videoclaw-write-${Math.random()}`, "0"], { cwd: dir, env: { LANG: "C", PATH: "/usr/bin:/bin" }, stdio: ["pipe", "ignore", "pipe", "pipe"] });
    c.on("exit", (code) => resolve(code ?? -1));
    (c.stdio[3] as any).on("error", () => {});
    c.stdin!.end(data, () => (c.stdio[3] as any).end("publish\n"));
  });
  try { statSync("/usr/bin/stat"); statSync("/bin/dd"); statSync("/bin/ln"); } catch { t.skip("coreutils not at original paths"); return; }
  const a = mkdtempSync(join(tmpdir(), "vc-sh-"));
  const b = mkdtempSync(join(tmpdir(), "vc-nd-"));
  const node = async (name: string, data: string, ident = dirIdentity(b)) => (await relativeWrite({ dir: b, expectedIdentity: ident, name, stagingName: `.s-${Math.random()}`, input: chunks(data) })).code;
  // stat -c '%d:%i' prints decimal dev; Node bigint dev is the same st_dev value
  const shIdent = dirIdentity(a);
  assert.equal(await runSh(a, shIdent, "f", "x"), 0);
  assert.equal(await node("f", "x"), 0);
  assert.equal(await runSh(a, shIdent, "f", "y"), 75, "sh: exists");
  assert.equal(await node("f", "y"), 75, "node: exists");
  assert.equal(await runSh(a, "1:1", "g", "z"), 73);
  assert.equal(await node("g", "z", "1:1"), 73);
  assert.equal(readFileSync(join(a, "f"), "utf8"), readFileSync(join(b, "f"), "utf8"));
  assert.deepEqual(readdirSync(a), readdirSync(b));
  void writeFileSync; void renameSync; void mkdirSync;
});
