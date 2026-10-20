import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEngineRender } from "../src/main/workers/editor-render-worker";
import { EditorRenderController, OUTPUT_NAME, RUN_LOG_NAME, RENDER_SCRIPT_REL } from "../src/main/engine/editor-render";
import { resolveJobDir, expandHome } from "../src/main/engine/job-boundary";
import { loadOriginalWorker } from "./original-loader";

function fakeSpawn(record: any[]) {
  let pid = 4242;
  const children: any[] = [];
  const spawn = (file: string, args: string[], opts: any) => {
    record.push({ file, args, opts: { ...opts, env: undefined, windowsHide: undefined } });
    const child: any = new EventEmitter();
    child.pid = pid++;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (sig: string) => record.push({ childKill: sig });
    children.push(child);
    return child;
  };
  return { spawn, children };
}

async function drive(startEngineRenderImpl: any, script: (child: any, job: any) => void) {
  const posts: any[] = [];
  const spawns: any[] = [];
  const kills: any[] = [];
  const { spawn, children } = fakeSpawn(spawns);
  const job = startEngineRenderImpl(
    { requestId: "r1", executable: "uv", args: ["run", "python", RENDER_SCRIPT_REL, "--job", "j1"], cwd: "/e", env: {} },
    { spawn, post: (m: any) => posts.push(m), kill: (pid: number, sig: string) => kills.push([pid, sig]), cancelGraceMs: 5 },
  );
  script(children[0], job);
  await new Promise((r) => setTimeout(r, 20));
  return { posts, spawns, kills };
}

test("ported editor-render worker matches the shipped editorRenderWorker.js message-for-message", async () => {
  const orig = await loadOriginalWorker("editorRenderWorker.js");
  const scenarios: [string, (c: any, j: any) => void][] = [
    ["success", (c) => { c.stdout.emit("data", "hello\n"); c.emit("close", 0, null); }],
    ["failure", (c) => { c.stderr.emit("data", "boom"); c.emit("close", 1, null); }],
    ["error", (c) => c.emit("error", new Error("ENOENT"))],
    ["cancel", (c, j) => { j.cancel(); setTimeout(() => c.emit("close", null, "SIGTERM"), 10); }],
    ["cancel-then-grace", (c, j) => { j.cancel(); }],
  ];
  for (const [name, s] of scenarios) {
    const a = await drive(orig.startEngineRender, s);
    const b = await drive(startEngineRender, s);
    assert.deepEqual(b.posts, a.posts, `${name}: posts`);
    assert.deepEqual(b.kills, a.kills, `${name}: group kills`);
    assert.deepEqual(b.spawns, a.spawns, `${name}: spawn args/options`);
  }
});

function setupJob() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-er-"))); // macOS: /var → /private/var (controller realpaths the job)
  const cwd = join(root, "ws");
  const job = join(cwd, "jobs", "j1");
  mkdirSync(join(job, "hyperframes"), { recursive: true });
  writeFileSync(join(job, "hyperframes", "index.html"), "<html/>");
  const engine = join(root, "engine");
  mkdirSync(join(engine, "tools"), { recursive: true });
  writeFileSync(join(engine, RENDER_SCRIPT_REL), "");
  return { root, cwd, job, engine };
}

test("EditorRenderController: validation, start message, completion receipt, cancel/reap", async () => {
  const { cwd, job, engine } = setupJob();
  const events: any[] = [];
  const posted: any[] = [];
  const killed: number[] = [];
  let onMsg: any, onExit: any;
  const ctl = new EditorRenderController({
    getSession: (id) => (id === "s1" ? { jobId: "j1", cwd } : undefined),
    resolveEngine: () => ({ root: engine, executable: "uv", env: { A: "1" } }),
    forkWorker: () => ({ postMessage: (m) => posted.push(m), onMessage: (cb) => (onMsg = cb), onExit: (cb) => (onExit = cb), kill: () => {} }),
    emit: (e) => events.push(e),
    killGroup: (pgid) => killed.push(pgid),
    cancelTimeoutMs: 10,
  });
  assert.deepEqual(ctl.start({}), { requestId: "", accepted: false, error: { code: "invalid-request", message: "That render request wasn't valid.", retryable: false } });
  assert.equal((ctl.start({ requestId: "x", sessionId: "nope", jobId: "j1" }) as any).error.code, "unknown-session");
  assert.equal((ctl.start({ requestId: "x", sessionId: "s1", jobId: "j2" }) as any).error.code, "job-mismatch");
  assert.deepEqual(ctl.start({ requestId: "r1", sessionId: "s1", jobId: "j1" }), { requestId: "r1", accepted: true });
  assert.equal((ctl.start({ requestId: "r2", sessionId: "s1", jobId: "j1" }) as any).error.code, "busy");
  assert.equal(posted[0].type, "start");
  assert.deepEqual(posted[0].args, ["run", "python", "tools/hyperframes_render.py", "--job", "j1"]);
  assert.equal(posted[0].env.VIDEOCLAW_JOBS_DIR.endsWith(join("ws", "jobs")), true);
  assert.deepEqual(ctl.state(), { requestId: "r1", jobId: "j1", phase: "queued" });
  onMsg({ type: "spawned", requestId: "r1", pgid: 777 });
  onMsg({ type: "phase", requestId: "r1", phase: "rendering" });
  writeFileSync(join(job, OUTPUT_NAME), "mp4");
  appendFileSync(join(job, RUN_LOG_NAME), JSON.stringify({ event: "render_completed", renderer: "hyperframes", output_path: `/x/${OUTPUT_NAME}`, width: 1080, height: 1920, fps: 30, duration: 12.5, size_bytes: 0, has_audio: true }) + "\n");
  onMsg({ type: "exit", requestId: "r1", code: 0, signal: null });
  const done = events.find((e) => e.kind === "completed");
  assert.deepEqual(done.result, { requestId: "r1", jobId: "j1", outputPath: join(job, OUTPUT_NAME), width: 1080, height: 1920, fps: 30, durationSeconds: 12.5, sizeBytes: 3, hasAudio: true });
  assert.equal(ctl.state(), null);
  // cancel path with timeout → reap group
  ctl.start({ requestId: "r3", sessionId: "s1", jobId: "j1" });
  onMsg({ type: "spawned", requestId: "r3", pgid: 888 });
  assert.equal(ctl.cancel("nope"), false);
  assert.equal(ctl.cancel("r3"), true);
  assert.equal(posted.at(-1).type, "cancel");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(killed, [888]);
  assert.deepEqual(events.at(-1), { kind: "progress", progress: { requestId: "r3", jobId: "j1", phase: "cancelled" } });
  void onExit;
});

test("expandHome: POSIX regex unchanged; win32 also expands ~\\", () => {
  assert.equal(expandHome("~/a", "darwin", "/h"), "/h/a");
  assert.equal(expandHome("~\\a", "darwin", "/h"), "~\\a");
  assert.equal(expandHome("~\\a", "win32", "C:\\h"), "C:\\h\\a");
  assert.equal(resolveJobDir({ sessionId: "s", jobId: "../x" }, () => ({ jobId: "../x", cwd: "/" })).ok, false);
});
