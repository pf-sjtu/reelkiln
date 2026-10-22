// docs/37 M20: W6 / W7 / W8 exercised for real on the windows-latest runner (skipped elsewhere).
//   W6  mergeEnv: one PATH entry in the child's environment block, and the extra PATH really resolves commands
//   W7  NTFS dev:ino (bigint) identity: stable across reads / content changes / a rename, different after a swap;
//       relativeWrite end-to-end (73 identity changed, 75 exists)
//   W8  editorRenderWorker spawn (detached + windowsHide): the child's console window is not visible; cancel
//       (taskkill /T, then /F after the grace) takes the grandchild down too
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRunner } from "../src/main/engine/bootstrap";
import { dirIdentity, relativeWrite, RELATIVE_WRITER_CODES } from "../src/main/studio/relative-writer";
import { startEngineRender } from "../src/main/workers/editor-render-worker";

const WIN = process.platform === "win32";
const SKIP = !WIN && "win32 only (real Windows behaviour)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function* chunks(...xs: string[]) { for (const x of xs) yield x; }

test("W6 (real win32): mergeEnv → exactly one Path entry in the child env block; the extra PATH dir resolves commands", { skip: SKIP }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-w6-"));
  try {
    writeFileSync(join(dir, "w6probe.cmd"), "@echo W6-PROBE-OK\r\n");
    const orig = process.env.Path ?? process.env.PATH ?? "";
    // base env carries the Windows-cased `Path` (what process.env enumerates); extra uses `PATH`
    const run = createRunner({ baseEnv: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH")), Path: orig } });
    const set = await run("cmd.exe", ["/d", "/c", "set"], { env: { PATH: `${dir};${orig}` } });
    const pathLines = set.split(/\r?\n/).filter((l) => /^path=/i.test(l));
    assert.equal(pathLines.length, 1, `one PATH entry, got ${pathLines.map((l) => l.slice(0, 5)).join(",")}`);
    assert.ok(pathLines[0].slice(5).toLowerCase().startsWith(dir.toLowerCase()), "the merged PATH is the extra one");
    assert.match(await run("cmd.exe", ["/d", "/c", "w6probe"], { env: { PATH: `${dir};${orig}` } }), /W6-PROBE-OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("W7 (real win32/NTFS): dir identity stable across reads, content changes and rename; differs after a swap; relativeWrite codes", { skip: SKIP }, async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-w7-"));
  try {
    const d = join(root, "job"); mkdirSync(d);
    const id0 = dirIdentity(d);
    assert.match(id0, /^\d+:\d+$/); assert.notEqual(id0.split(":")[1], "0", "NTFS file id is non-zero");
    for (let i = 0; i < 5; i++) assert.equal(dirIdentity(d), id0, "stable across reads");
    writeFileSync(join(d, "x.txt"), "1"); unlinkSync(join(d, "x.txt"));
    assert.equal(dirIdentity(d), id0, "stable across content changes");
    renameSync(d, join(root, "moved")); assert.equal(dirIdentity(join(root, "moved")), id0, "NTFS keeps the file id across a rename");
    mkdirSync(d); assert.notEqual(dirIdentity(d), id0, "a swapped-in directory has a different identity");
    const other = join(root, "other"); mkdirSync(other); assert.notEqual(dirIdentity(other), dirIdentity(d));
    // relativeWrite end-to-end on NTFS
    const ok = await relativeWrite({ dir: d, expectedIdentity: dirIdentity(d), name: "a.txt", stagingName: ".a.stage", input: chunks("hello ", "w7") });
    assert.equal(ok.code, 0); assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "hello w7"); assert.equal(existsSync(join(d, ".a.stage")), false);
    const exists = await relativeWrite({ dir: d, expectedIdentity: dirIdentity(d), name: "a.txt", stagingName: ".b.stage", input: chunks("x") });
    assert.equal(exists.code, RELATIVE_WRITER_CODES.exists); assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "hello w7", "no overwrite");
    const swapped = await relativeWrite({ dir: d, expectedIdentity: id0, name: "c.txt", stagingName: ".c.stage", input: chunks("x") });
    assert.equal(swapped.code, RELATIVE_WRITER_CODES.identityChanged); assert.equal(existsSync(join(d, "c.txt")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const CONSOLE_PROBE = [
  'Add-Type -Namespace W8 -Name K -MemberDefinition \'[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);\'',
  '$h = [W8.K]::GetConsoleWindow()',
  '[Console]::Out.WriteLine("W8 hwnd=" + $h + " visible=" + [W8.K]::IsWindowVisible($h))',
].join("; ");

function runWorker(cmd: any, o: { cancelAfterMs?: number; graceMs?: number } = {}) {
  return new Promise<{ posts: any[]; out: string }>((resolve) => {
    const posts: any[] = []; let out = "";
    const tapSpawn = (f: string, a: string[], opts: any) => { const c = spawn(f, a, opts); c.stdout?.on("data", (b) => { out += String(b); }); c.stderr?.on("data", (b) => { out += String(b); }); return c; };
    const job = startEngineRender({ type: "start", requestId: "w8", ...cmd }, {
      spawn: tapSpawn as any, cancelGraceMs: o.graceMs ?? 1500,
      post: (m) => { posts.push(m); if (m.type === "exit" || m.type === "cancelled") resolve({ posts, out }); },
    });
    if (o.cancelAfterMs !== undefined) setTimeout(() => job.cancel(), o.cancelAfterMs);
  });
}

test("W8 (real win32): the detached render child gets no visible console window (windowsHide)", { skip: SKIP, timeout: 90_000 }, async () => {
  const r = await runWorker({ executable: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(CONSOLE_PROBE, "utf16le").toString("base64")], cwd: tmpdir(), env: process.env });
  const m = /W8 hwnd=(\d+) visible=(True|False)/.exec(r.out);
  assert.ok(m, `probe output: ${r.out.slice(0, 300)}`);
  console.log(`# W8 console: hwnd=${m![1]} visible=${m![2]} (exit ${r.posts.at(-1)?.code})`);
  assert.equal(m![2], "False", "no visible console window for the detached child");
  assert.equal(r.posts.at(-1).type, "exit"); assert.equal(r.posts.at(-1).code, 0);
});

test("W8 (real win32): cancel takes down the detached child AND its grandchild (taskkill /T, /F after the grace)", { skip: SKIP, timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-w8-"));
  const pidFile = join(dir, "grandchild.pid");
  try {
    const script = `const { spawn } = require("child_process"); const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000);`;
    let childPid = 0;
    const p = runWorker({ executable: process.execPath, args: ["-e", script], cwd: dir, env: process.env }, { cancelAfterMs: 3000, graceMs: 1500 });
    const r = await p;
    childPid = r.posts.find((m) => m.type === "spawned")?.pgid;
    assert.equal(r.posts.at(-1).type, "cancelled");
    const gpid = Number(readFileSync(pidFile, "utf8"));
    for (let i = 0; i < 20 && (alive(childPid) || alive(gpid)); i++) await sleep(250);
    assert.equal(alive(childPid), false, "child gone"); assert.equal(alive(gpid), false, "grandchild gone (tree kill)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
