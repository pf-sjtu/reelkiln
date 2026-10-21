// docs/22 M3/M4: the ported VersionStore / scanJob / JobWatcher (verbatim slices), the AgentHost job
// snapshot + approve + finalize path, vcmedia:// Range serving, file:saveItemAs / intake:pickFiles,
// and the verbatim ComposerAttachmentStore through AgentHost (stage → ready → Send materializes
// into jobs/<id>/incoming/ and lists the files ahead of the turn). SDK boundary mocked; the real
// S1 runs are in artifacts/phase-b-m3 (not unit tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHost, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import type { EngineSessionDeps } from "../src/main/agent/engine-session";
import { VersionStore, scanJob, isFinishedMp4 } from "../src/main/jobs/version-store.generated";
import { createMediaCapabilities, exposeJobSnapshot, fileIpcHandlers, handleVcmedia, isIntakePickerScope, smokeDialog } from "../src/main/media/media-ipc";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(10); } }
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A minimal structurally finished MP4 (ftyp, one moov/trak with a non-empty stsz, mdat). */
function box(type: string, ...parts: Buffer[]): Buffer { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length, 0); h.write(type, 4, "latin1"); return Buffer.concat([h, body]); }
function tinyMp4(seed = "x"): Buffer {
  const stsz = Buffer.alloc(12); stsz.writeUInt32BE(0, 0); stsz.writeUInt32BE(0, 4); stsz.writeUInt32BE(1, 8);
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isom")), box("moov", box("trak", box("mdia", box("minf", box("stbl", box("stsz", stsz)))))), box("mdat", Buffer.from(`frame-${seed}`.repeat(64)))]);
}
/** What compose_render leaves behind: final.mp4 + renders/<sha>.json (render-complete/v1). */
function writeRender(jobPath: string, bytes: Buffer) {
  writeFileSync(join(jobPath, "final.mp4"), bytes);
  const past = new Date(Date.now() - 5000); utimesSync(join(jobPath, "final.mp4"), past, past); // settled (FINAL_CANDIDATE_SETTLE_MS)
  mkdirSync(join(jobPath, "renders"), { recursive: true });
  const h = sha(bytes);
  writeFileSync(join(jobPath, "renders", `${h}.json`), JSON.stringify({ schema: "videoclaw.render-complete/v1", sha256: h, path: "final.mp4", bytes: bytes.length, completed_at: Date.now() / 1000 - 5, tool: "compose_render" }));
  return h;
}

class FakeQuery {
  closed = false; turns: string[] = [];
  private outQ: Array<Record<string, any>> = []; private wake: (() => void) | null = null;
  constructor(public readonly prompt: AsyncIterable<any>, public readonly options: any) {
    void (async () => { for await (const m of prompt) { const text = m?.message?.content?.[0]?.text ?? ""; this.turns.push(text); this.push({ type: "assistant", message: { id: `m${this.turns.length}`, content: [{ type: "text", text: "ok" }] } }); this.push({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0 }); } })();
  }
  push(m: Record<string, any>) { this.outQ.push(m); this.wake?.(); this.wake = null; }
  async interrupt() {}
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *[Symbol.asyncIterator]() { while (!this.closed) { const m = this.outQ.shift(); if (m) { yield m; continue; } await new Promise<void>((r) => { this.wake = r; }); } }
}
function harness() {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-jobs-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "userData"); mkdirSync(ud, { recursive: true });
  const events: Array<{ sessionId: string; event: SessionEvent }> = []; const snapshots: any[] = []; const persisted: any[][] = []; const queries: FakeQuery[] = [];
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => "minimax" as any,
    llmRouteReadiness: async (m) => ({ route: m?.llmRoute, ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "m", env: { ANTHROPIC_AUTH_TOKEN: "vcgp_session_token" }, close: async () => {} }),
  };
  const engine: EngineSessionDeps = {
    workspaceRoot: () => ws, currentEngine: () => ({ path: join(root, "engine"), version: "0.1.57-test" }),
    engineSessionEnv: () => ({ VIDEOCLAW_CONTEXT_EPOCH: "epoch-1", PATH: "/engine/path" }), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "",
  };
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: () => {}, jobSnapshot: (sessionId, snapshot) => snapshots.push({ sessionId, snapshot }) },
    service, loadSdk: async () => ({ sdk: { query: ({ prompt, options }: any) => { const q = new FakeQuery(prompt, options); queries.push(q); return q as any; } } }),
    sessionsRoot: join(root, "agent-sessions"), engine, persist: (rows) => persisted.push(rows), stateDir: ud,
  });
  return { host, root, ws, ud, events, snapshots, persisted, queries, cleanup: async () => { await host.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test("VersionStore (L13344) + scanJob (L14365): a recorded final.mp4 is minted as versions/v1.mp4 (same bytes), approve records a final, registry survives a reload", () => {
  const root = mkdtempSync(join(tmpdir(), "vc-vs-"));
  try {
    const ws = join(root, "Videoclaw"); const job = join(ws, "jobs", "job-a"); mkdirSync(job, { recursive: true });
    const bytes = tinyMp4("a");
    assert.equal(isFinishedMp4(writeRender(job, bytes) && join(job, "final.mp4")), true);
    const minted: any[] = [];
    const store = new (VersionStore as any)(join(root, "versions.json"), (_j: string, _p: string, v: any, ev: string) => minted.push({ n: v.n, ev }), ws);
    const snap = scanJob("job-a", job);
    assert.ok(snap.renders.some((r: any) => r.isCandidate && r.path.endsWith("final.mp4")), "final.mp4 is the candidate render");
    const versions = store.sync("job-a", job);
    assert.equal(versions.length, 1); assert.equal(versions[0].n, 1);
    assert.equal(sha(readFileSync(join(job, "versions", "v1.mp4"))), sha(bytes), "v1.mp4 holds the exact final bytes");
    assert.deepEqual(minted, [{ n: 1, ev: "minted" }]);
    assert.equal(store.sync("job-a", job).length, 1, "a rescan does not mint again");
    const approved = store.approve("job-a", 1);
    assert.equal(approved?.approved, true);
    assert.equal(store.currentFinal("job-a")?.n, 1);
    const reloaded = new (VersionStore as any)(join(root, "versions.json"), undefined, ws);
    assert.equal(reloaded.versions("job-a")[0].approved, true, "versions.json persisted the final");
    assert.equal(reloaded.finals("job-a").length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AgentHost job path (getJobSnapshot L45620, ensureWatcher L47956, approveVersion L47488): watcher pushes job:snapshot with v1, approve finalizes + persists finalizedAtMs + sends the taste-capture turn", async () => {
  const h = harness();
  try {
    const meta = h.host.createSession({});
    await h.host.sendMessage(meta.sessionId, { text: "make the cut", clientTurnId: "t1" });
    await until(() => h.events.some((e) => e.event.kind === "result"));
    const jobId = h.host.listSessions()[0].jobId!;
    assert.ok(jobId);
    assert.equal(h.snapshots.length, 0, "first-message bind does not watch immediately (commitBind watchImmediately=false)");
    assert.equal(h.host.getJobSnapshot(meta.sessionId).versions.length, 0, "no render yet");
    const bytes = tinyMp4("b"); writeRender(join(h.ws, "jobs", jobId), bytes);
    await until(() => h.snapshots.some((s) => s.snapshot.versions?.length === 1), 6000);
    const snap = h.host.getJobSnapshot(meta.sessionId);
    assert.equal(snap.versions[0].n, 1);
    assert.equal(sha(readFileSync(join(h.ws, "jobs", jobId, "versions", "v1.mp4"))), sha(bytes));
    assert.equal(snap.renders.find((r: any) => r.isCandidate)?.versionN, 1, "nameCandidateVersion tags the candidate");
    assert.ok(existsSync(join(h.ud, "versions.json")));
    h.host.approveVersion(meta.sessionId, 1);
    const row = h.host.listSessions()[0] as any;
    assert.ok(typeof row.finalizedAtMs === "number");
    assert.ok(h.persisted.at(-1)!.find((r) => r.sessionId === meta.sessionId)?.finalizedAtMs, "sessions.json row carries finalizedAtMs");
    assert.ok(h.events.some((e) => e.event.kind === "user_text" && (e.event as any).text === "✅ V1 approved"));
    await until(() => h.queries.some((q) => q.turns.some((t) => t.includes("✅ I'm approving V1 — this is the one."))));
    const q = h.queries.find((x) => x.turns.some((t) => t.includes("✅ I'm approving V1")))!;
    assert.ok(!q.turns.at(-1)!.includes("[APP-OWNED PRODUCTION ID") || q.turns.at(-1)!.includes(jobId), "approval turn stays on the bound job");
    await until(() => h.host.listSessions()[0].status === "idle");
    await assert.rejects(h.host.sendMessage(meta.sessionId, { text: "more", clientTurnId: "t3" }), /finalized/);
    assert.throws(() => h.host.stageComposerAttachments({ sessionId: meta.sessionId, destination: "video", files: [] }, () => {}), /finalized/);
    h.host.approveVersion(meta.sessionId, 1); // already current final: idempotent, no second taste turn
    h.host.unfinalizeSession(meta.sessionId);
    assert.equal((h.host.listSessions()[0] as any).finalizedAtMs, undefined);
  } finally { await h.cleanup(); }
});

test("vcmedia:// (L62452 + rangeMedia chunk): only granted files, full / Range / HEAD / 416, identity header", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-media-"));
  try {
    const job = join(root, "jobs", "j"); mkdirSync(job, { recursive: true });
    const file = join(job, "final.mp4"); const bytes = tinyMp4("m"); writeFileSync(file, bytes);
    const media = createMediaCapabilities();
    const url = `vcmedia://local${file}`;
    assert.equal((await handleVcmedia(new Request(url), media, () => null)).status, 403, "ungranted → denied");
    exposeJobSnapshot(media, { jobPath: job, renders: [{ path: file }], assets: [], versions: [] });
    const full = await handleVcmedia(new Request(url), media, () => null);
    assert.equal(full.status, 200); assert.equal(full.headers.get("content-type"), "video/mp4"); assert.equal(full.headers.get("x-videoclaw-media-state"), "ready");
    assert.equal(sha(Buffer.from(await full.arrayBuffer())), sha(bytes));
    const part = await handleVcmedia(new Request(url, { headers: { range: "bytes=0-9" } }), media, () => null);
    assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), `bytes 0-9/${bytes.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(0, 10));
    assert.equal((await handleVcmedia(new Request(url, { headers: { range: `bytes=${bytes.length + 5}-` } }), media, () => null)).status, 416);
    const other = join(job, "other.mp4"); writeFileSync(other, bytes);
    assert.equal((await handleVcmedia(new Request(`vcmedia://local${other}?session=s1`, { method: "HEAD" }), media, () => job)).status, 200, "HEAD with session grants a file under the chat media root");
    assert.equal((await handleVcmedia(new Request(`vcmedia://elsewhere${file}`), media, () => null)).status, 403);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("file:saveItemAs (L61987) copies to the dialog's path; intake:pickFiles (L62157) checks the scope and grants picked files", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-file-"));
  try {
    const src = join(root, "v1.mp4"); writeFileSync(src, tinyMp4("s"));
    const revealed: string[] = []; let answer: string | undefined = join(root, "out", "s1.mp4"); mkdirSync(join(root, "out"));
    const media = createMediaCapabilities();
    const real = { showSaveDialog: async () => (answer ? { canceled: false, filePath: answer } : { canceled: true }), showOpenDialog: async () => ({ canceled: false, filePaths: [src] }) };
    const hs = fileIpcHandlers({ dialog: real, shell: { showItemInFolder: (p) => revealed.push(p), openPath: async () => "" }, downloadsDir: () => root, media, sessionIds: () => ["s1"] });
    assert.equal(await hs["file:saveItemAs"](src), true);
    assert.equal(sha(readFileSync(answer!)), sha(readFileSync(src))); assert.deepEqual(revealed, [answer]);
    answer = undefined; assert.equal(await hs["file:saveItemAs"](src), false, "cancel → false");
    await assert.rejects(Promise.resolve().then(() => hs["file:saveItemAs"](join(root, "missing.mp4"))), /no longer available/);
    await assert.rejects(Promise.resolve().then(() => hs["file:openPath"]("relative/x")), /Invalid file path/);
    assert.equal(isIntakePickerScope({ kind: "composer", sessionId: "s1" }), true); assert.equal(isIntakePickerScope({ kind: "input_request", sessionId: "s1" }), false);
    await assert.rejects(Promise.resolve().then(() => hs["intake:pickFiles"]({ kind: "composer", sessionId: "nope" })), /no longer belongs/);
    const picked: any = await hs["intake:pickFiles"]({ kind: "composer", sessionId: "s1" });
    assert.deepEqual(picked.files.map((f: any) => f.name), ["v1.mp4"]); assert.ok(picked.files[0].sizeBytes > 0);
    assert.equal(media.resolve(src).state, "ready", "picked files are granted as external media");
    // PORT-NEW smoke presets answer the dialogs only under VIDEOCLAW_PORT_SMOKE=1
    const d = smokeDialog(real, { VIDEOCLAW_PORT_SMOKE: "1", VIDEOCLAW_PORT_SMOKE_SAVE_AS: "/tmp/x.mp4", VIDEOCLAW_PORT_SMOKE_PICK_FILES: "/a\n/b" });
    assert.deepEqual(await d.showSaveDialog({ defaultPath: "" }), { canceled: false, filePath: "/tmp/x.mp4" });
    assert.deepEqual((await d.showOpenDialog({ title: "", buttonLabel: "", properties: [] })).filePaths, ["/a", "/b"]);
    assert.equal(smokeDialog(real, { VIDEOCLAW_PORT_SMOKE_SAVE_AS: "/tmp/x.mp4" }), real, "no smoke → the real dialog");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ComposerAttachmentStore via AgentHost (stage L44743, Send L41588-41656): copy → ready, Send mints the job then materializes into jobs/<id>/incoming/ and lists the files ahead of the turn", async () => {
  const h = harness();
  try {
    const inputs = join(h.root, "in"); mkdirSync(inputs);
    const clip = join(inputs, "clip_a.mp4"); writeFileSync(clip, tinyMp4("clip"));
    const music = join(inputs, "music.mp3"); writeFileSync(music, Buffer.from("ID3-music-bytes".repeat(100)));
    const odd = join(inputs, "notes.xyz"); writeFileSync(odd, "?");
    const zip = join(inputs, "pack.zip"); writeFileSync(zip, "PK\u0003\u0004");
    const meta = h.host.createSession({});
    const changed: any[] = [];
    const staged: any[] = h.host.stageComposerAttachments({ sessionId: meta.sessionId, destination: "video", files: [clip, music, odd, zip].map((p) => ({ path: p, name: p.split("/").pop(), sizeBytes: readFileSync(p).length })) }, (a) => changed.push(a));
    assert.equal(staged.length, 4);
    assert.equal(staged[2].status, "failed"); assert.match(staged[2].error, /\.xyz files/);
    await until(() => (h.host.listComposerAttachments(meta.sessionId) as any[]).filter((a) => a.status === "ready").length === 2 && changed.some((a) => a.name === "pack.zip" && a.status === "failed"));
    assert.match(changed.find((a) => a.name === "pack.zip" && a.status === "failed").error, /compression method/, "archives are refused while extractArchive is unported");
    const ids = staged.slice(0, 2).map((a) => a.id);
    assert.ok(!existsSync(join(h.ws, "incoming")) || readdirSync(join(h.ws, "incoming")).length === 0, "staging is private (userData), nothing in the workspace yet");
    const r = await h.host.sendMessage(meta.sessionId, { text: "cut these together", clientTurnId: "turn-1", attachmentIds: ids });
    assert.deepEqual(r.attachmentIds, ids);
    await until(() => h.events.some((e) => e.event.kind === "result"));
    const jobId = h.host.listSessions()[0].jobId!;
    const incoming = join(h.ws, "jobs", jobId, "incoming");
    assert.equal(sha(readFileSync(join(incoming, "clip_a.mp4"))), sha(readFileSync(clip)));
    assert.equal(sha(readFileSync(join(incoming, "music.mp3"))), sha(readFileSync(music)));
    const turn = h.queries[0].turns[0];
    assert.ok(turn.startsWith(`[APP-OWNED COMPOSER ATTACHMENTS — ordered]\n- ${ids[0]}: ${join(incoming, "clip_a.mp4")}`), turn.slice(0, 300));
    assert.ok(turn.includes(`- ${ids[1]}: ${join(incoming, "music.mp3")}`));
    assert.ok(turn.includes("[Use these files as source material where relevant.]"));
    assert.ok(turn.includes(`[APP-OWNED PRODUCTION ID — authoritative]\nThis video is already bound to the bare id "${jobId}"`));
    assert.ok(!(h.host.listComposerAttachments(meta.sessionId) as any[]).some((a) => ids.includes(a.id)), "sent attachments leave the draft");
    assert.equal((await h.host.sendMessage(meta.sessionId, { text: "cut these together", clientTurnId: "turn-1", attachmentIds: ids })).duplicate, true, "a re-sent receipt is a duplicate");
    assert.ok(existsSync(join(h.ud, "composer-attachments.json")));
    await assert.rejects(h.host.sendMessage(meta.sessionId, { text: "x", attachmentIds: ids }), /Missing composer turn id/);
  } finally { await h.cleanup(); }
});
