// docs/34 M17 task 1: the docs/33 leftovers — the three push senders (characters:voices:changed, engine:updated,
// window:state), readQuitState's attachment counts, and the signed-in work pause (authenticatedWorkPaused).
// SDK boundary, engine runner and gateway are FAKE (no network, no model).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHost, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import type { EngineSessionDeps } from "../src/main/agent/engine-session";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import * as B from "../src/main/engine/bootstrap";
import { readQuitState } from "../src/main/quit/read-quit-state";
import { assessQuit } from "../src/main/quit/quit-coordinator.generated";
import { fullscreenStateForWindow, wireWindowState } from "../src/main/window-state";
import { relaunchOptions } from "../src/main/relaunch";
import { ProjectMemoryHost } from "../src/main/memory/project-memory-host";
import { CharacterStore } from "../src/main/characters/character-store.generated";
import { evalOriginal, fnText } from "./original-source";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(10); } }
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** A query that never answers: the turn stays running until the runtime is torn down. */
class HangingQuery {
  closed = false; turns: string[] = [];
  private wake: (() => void) | null = null;
  constructor(public readonly prompt: AsyncIterable<any>) { void (async () => { for await (const m of prompt) this.turns.push(m?.message?.content?.[0]?.text ?? ""); })(); }
  async interrupt() {}
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *[Symbol.asyncIterator]() { while (!this.closed) await new Promise<void>((r) => { this.wake = r; }); }
}
function harness() {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-m17-")));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "userData"); mkdirSync(ud, { recursive: true });
  const events: Array<{ sessionId: string; event: SessionEvent }> = []; const queries: HangingQuery[] = [];
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => "minimax" as any,
    llmRouteReadiness: async (m) => ({ route: m?.llmRoute, ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "m", env: { ANTHROPIC_AUTH_TOKEN: "vcgp_session_token" }, close: async () => {} }),
  };
  const engine: EngineSessionDeps = {
    workspaceRoot: () => ws, currentEngine: () => ({ path: join(root, "engine"), version: "0.1.57-test" }),
    engineSessionEnv: () => ({ VIDEOCLAW_CONTEXT_EPOCH: "epoch-1", PATH: "/engine/path" }), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "",
  };
  const revoked: string[] = [];
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId: string, event: SessionEvent) => events.push({ sessionId, event }), sessionsChanged: () => {} },
    service, loadSdk: async () => ({ sdk: { query: ({ prompt }: any) => { const q = new HangingQuery(prompt); queries.push(q); return q as any; } } }),
    sessionsRoot: join(root, "agent-sessions"), engine, persist: () => {}, stateDir: ud,
    agentGatewayProxy: () => ({ revoke: (id: string) => revoked.push(id), revokeCredential: () => {}, credentials: () => undefined }) as any,
  } as any);
  return { host, root, ws, ud, events, queries, revoked, cleanup: async () => { await host.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test("M17 stopAuthenticatedWork (L43256): running turn interrupted → idle, runtime retired, proxy revoked; paused stays paused (L43232)", async () => {
  const h = harness();
  try {
    const a = h.host.createSession({}); const b = h.host.createSession({});
    await h.host.sendMessage(a.sessionId, "make a short video");
    await until(() => h.host.listSessions().find((m) => m.sessionId === a.sessionId)?.status === "running" && h.queries.length === 1);
    assert.equal(h.host.needsSpendAccountingRestart(), false);
    const { interrupted } = h.host.stopAuthenticatedWork();
    assert.deepEqual(interrupted.map((m) => m.sessionId), [a.sessionId], "only the active video is reported");
    assert.equal(h.host.listSessions().find((m) => m.sessionId === a.sessionId)?.status, "idle");
    assert.equal(h.queries[0].closed, true, "the runtime was torn down");
    assert.deepEqual(h.revoked.sort(), [a.sessionId, b.sessionId].sort(), "every session's gateway capability is revoked");
    assert.equal(h.host.authenticatedWorkPaused, true);
    assert.equal(h.host.needsSpendAccountingRestart(), true, "sign-out pause is only cleared by a restart");
    assert.equal(h.host.spendBlockMessage(), "Paid work is paused. Sign in again to restore your saved budgets.");
  } finally { await h.cleanup(); }
});

test("M17 authenticatedWorkPaused gates: send shows the original error card, retry/fence/transcribe/spend writes refuse, no new runtime", async () => {
  const h = harness();
  try {
    const a = h.host.createSession({});
    h.host.stopAuthenticatedWork();
    await assert.rejects(h.host.sendMessage(a.sessionId, { text: "hello", clientTurnId: "t-1" }), /Paid work is paused\. Sign in again to restore your saved budgets\./);
    const card = h.events.filter((e) => e.sessionId === a.sessionId && e.event.kind === "error").at(-1)?.event as any;
    assert.equal(card?.message, "Paid work is paused. Sign in again to restore your saved budgets.");
    assert.equal(card?.canRetry, false);
    assert.equal(h.host.listSessions()[0].status, "error");
    assert.equal(h.queries.length, 0, "nothing was spawned");
    const s: any = (h.host as any).sessions.get(a.sessionId);
    s.failedInputs = [{ msg: { message: { content: [{ type: "text", text: "x" }] } } }];
    assert.equal(h.host.retryTurn(a.sessionId), false, "retryTurn → gateSpendTurn blocked (L42596)");
    const fence = (h.host as any).spendAdmissionFence(s, { jobId: "job-x", quote: { tool: "mint_image", maximumUsd: 1 } }, 0);
    assert.deepEqual(fence, { refusal: { allowed: false, reason: "Sign in again to restart Videoclaw before paid work." } });
    await assert.rejects(h.host.transcribeVoice(a.sessionId, "0".repeat(36), new Uint8Array(4), { helper: "x", ffmpeg: "y" }, () => true, "bad"), /Open an editable conversation and sign in before transcribing\./);
    await assert.rejects((h.host as any).installSpendPolicy(a.sessionId, { kind: "ask_each" }), /Sign in again to restart Videoclaw before changing spending settings\./);
    await assert.rejects((h.host as any).writeGatewaySpendPolicy("job-x", { kind: "ask_each" }), /Budget accounting is unavailable; the draft is safe\./);
    assert.deepEqual(h.host.collectAcceptedOperations(), [], "the operation collector does not start");
    assert.deepEqual(h.host.completedModelContext(s.meta), []);
    assert.equal(h.host.requestWitness(a.sessionId, false)(), false, "every in-flight request witness goes stale");
  } finally { await h.cleanup(); }
});

test("M17 readQuitState (L62681): staged/copying attachment counts come from ComposerAttachmentStore.draftCounts; assessQuit names them", async () => {
  const h = harness();
  try {
    const a = h.host.createSession({ title: "Clip edit" });
    const inputs = join(h.root, "in"); mkdirSync(inputs);
    const files = ["a.mp3", "b.mp3"].map((n) => { const p = join(inputs, n); writeFileSync(p, Buffer.from(`ID3-${n}`.repeat(64))); return { path: p, name: n, sizeBytes: readFileSync(p).length }; });
    const staged: any[] = h.host.stageComposerAttachments({ sessionId: a.sessionId, destination: "video", files }, () => {});
    await until(() => (h.host.listComposerAttachments(a.sessionId) as any[]).filter((x) => x.status === "ready").length === 2);
    const renderer = { composerSessionId: a.sessionId, unsentDraft: false, pendingSendAttachmentIds: [] as string[], recordingVoice: false };
    let state = readQuitState({ host: h.host as any, renderer, renderActive: false, previewActive: false });
    assert.equal(state.stagedAttachments, 2); assert.equal(state.copyingAttachments, 0); assert.equal(state.runningTurns, 0);
    const assessment: any = assessQuit(state);
    assert.ok(assessment.blockers.includes("staged-attachment"));
    assert.match(JSON.stringify(assessment), /2 attachments you never sent/);
    // a Send in flight freezes its ids (pendingSendAttachmentIds) — those no longer count as unsent
    state = readQuitState({ host: h.host as any, renderer: { ...renderer, pendingSendAttachmentIds: [staged[0].id] }, renderActive: false, previewActive: false });
    assert.equal(state.stagedAttachments, 1);
    // another video's composer on screen → this video's chips are not "on screen"
    state = readQuitState({ host: h.host as any, renderer: { ...renderer, composerSessionId: "other" }, renderActive: false, previewActive: false });
    assert.equal(state.stagedAttachments, 0);
    // no window → no renderer half; the host half still reports nothing staged on screen
    state = readQuitState({ host: h.host as any, renderer: null, renderActive: true, previewActive: false });
    assert.equal(state.stagedAttachments, 0); assert.equal(state.renderActive, true);
    assert.deepEqual(h.host.composerAttachmentDrafts(a.sessionId), { ready: 2, copying: [] });
    // workingSessionIds counts a running turn
    await h.host.sendMessage(a.sessionId, "go");
    await until(() => h.host.workingSessionIds().includes(a.sessionId));
    state = readQuitState({ host: h.host as any, renderer, renderActive: false, previewActive: false });
    assert.equal(state.runningTurns, 1); assert.equal(state.videos.working?.length, 1);
    assert.equal(h.host.hasActiveVoiceTranscription(), false);
  } finally { await h.cleanup(); }
});

test("M17 window:state (L60574-60580): enter/leave-full-screen and did-finish-load push {fullscreen}; a stale/destroyed window pushes nothing", () => {
  // fullscreenStateForWindow matches the original source
  const orig = evalOriginal<any>([fnText(/^function isDestroyedObjectError\(error\)/), fnText(/^function liveWindow\(currentWindow\)/), fnText(/^function fullscreenStateForWindow\(/)].join("\n"), "fullscreenStateForWindow");
  const listeners: Record<string, Array<() => void>> = {};
  let fs = false; let destroyed = false;
  const w: any = { isDestroyed: () => destroyed, isFullScreen: () => fs, on: (e: string, cb: () => void) => (listeners[e] ??= []).push(cb), webContents: { isDestroyed: () => destroyed, on: (e: string, cb: () => void) => (listeners[e] ??= []).push(cb) } };
  let current: any = w;
  const sent: any[] = [];
  wireWindowState(w, () => current, (ch, p) => sent.push([ch, p]));
  listeners["did-finish-load"][0](); fs = true; listeners["enter-full-screen"][0](); fs = false; listeners["leave-full-screen"][0]();
  assert.deepEqual(sent, [["window:state", { fullscreen: false }], ["window:state", { fullscreen: true }], ["window:state", { fullscreen: false }]]);
  for (const [cur, d] of [[w, false], [null, false], [{}, false], [w, true]] as const) {
    current = cur; destroyed = d;
    assert.equal(fullscreenStateForWindow(w, () => current), orig(w, () => current));
  }
  current = null; listeners["enter-full-screen"][0]();
  assert.equal(sent.length, 3, "a replaced window is never reported");
});

function engineTarball(root: string, version: string) {
  const src = join(root, `src-${version}`, "engine");
  mkdirSync(join(src, "tools"), { recursive: true });
  writeFileSync(join(src, "ENGINE_VERSION.json"), JSON.stringify({ version }));
  mkdirSync(join(src, "hyperframes"), { recursive: true }); writeFileSync(join(src, "hyperframes", "package-lock.json"), "{}");
  const tgz = join(root, `engine-${version}.tar.gz`);
  execFileSync("tar", ["-czf", tgz, "-C", join(root, `src-${version}`), "engine"]);
  return { tgz, sha: sha(readFileSync(tgz)) };
}
test("M17 engine:updated: background engine update installs alongside, parks while a video runs, flips when idle → onEngineUpdated (L10304-10430)", async () => {
  const P = process.platform === "win32" ? "win32" : "linux";
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-m17-eng-")));
  try {
    const bootDir = join(root, "bootstrap"); mkdirSync(bootDir); writeFileSync(join(bootDir, "uv"), "#!/bin/sh\n");
    const real = B.createRunner();
    const run: B.Runner = async (cmd, args, opts) => {
      if (cmd === "tar" || /[\\/]tar\.exe$/i.test(cmd)) return real(cmd, args, opts);
      if (args.includes("--json")) return '{"ok":true,"checks":{"ffmpeg":{"ok":true}}}';
      return "";
    };
    let source = engineTarball(root, "9.9.9"); let version = "9.9.9";
    let running = false; const updated: string[] = []; const beacons: string[] = [];
    const core = new B.BootstrapCore(
      { platform: P, userData: join(root, "ud"), workspaceRoot: join(root, "ws"), bootstrapRoots: [bootDir], packaged: true, inheritedPath: "/usr/bin", bootstrapTool: (n) => (n === "uv" ? join(bootDir, "uv") : undefined) },
      B.notPortedHooks({
        resolveEngineSource: async () => ({ manifest: { version, minAppVersion: "0.0.12", sha256: source.sha }, fetch: async () => source.tgz }),
        validateEngineSessionContext: () => {}, assertInstalledEngineProductionContract: () => {}, inspectProductionCompatible: () => true,
        writeWorkspace: () => {}, assertEngineMoneyCompatibility: async () => {}, ensureEngineCommandShims: () => {},
        safeToFlip: () => !running, onEngineUpdated: (v) => updated.push(v),
      }),
      run, () => {}, () => {}, (kind) => beacons.push(kind),
    );
    await core.runAll();
    assert.equal(core.currentEngine()?.version, "9.9.9");
    assert.equal(await core.checkForEngineUpdate(), "current", "same version → current, nothing installed");
    assert.deepEqual(updated, []);
    source = engineTarball(root, "9.9.10"); version = "9.9.10"; running = true;
    assert.equal(await core.checkForEngineUpdate(), "pending-flip", "a running video parks the flip");
    assert.equal(core.currentEngine()?.version, "9.9.9", "the live engine never notices");
    assert.ok(existsSync(join(root, "ud", "engines", "engine-9.9.10", "ENGINE_VERSION.json")), "installed alongside");
    running = false;
    await core.tryFlipPendingEngine(); // the roster changed (sessionsChanged → tryFlipPendingEngine)
    assert.equal(core.updateState, "updated");
    assert.deepEqual(updated, ["9.9.10"], "onEngineUpdated fires once with the flipped version");
    const pointer = JSON.parse(readFileSync(join(root, "ud", "engine-current.json"), "utf8"));
    assert.equal(pointer.version, "9.9.10"); assert.equal(pointer.previous.version, "9.9.9");
    assert.deepEqual(beacons.filter((b) => b.startsWith("engine-")), ["engine-updated"]);
    // a failing candidate keeps the installed engine and is not retried this launch
    source = engineTarball(root, "9.9.11"); version = "9.9.11";
    const badSha = { ...source, sha: "0".repeat(64) }; source = badSha;
    assert.equal(await core.checkForEngineUpdate(), "failed");
    assert.equal(core.currentEngine()?.version, "9.9.10");
    assert.equal(await core.checkForEngineUpdate(), "failed", "failedUpdateVersion is not retried");
    assert.deepEqual(updated, ["9.9.10"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("M17 characters:voices:changed (L45041-45063): approve and remove emit the scope; the store is the verbatim CharacterVoiceStore", async () => {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-m17-voice-")));
  try {
    const ud = join(root, "ud"); const cwd = join(root, "project"); mkdirSync(ud); mkdirSync(cwd);
    const authority = { gatewayUrl: "http://127.0.0.1:47735", canonicalKeyId: "k".repeat(64) };
    const emitted: any[] = [];
    const memory = new ProjectMemoryHost({
      stateDir: ud, authority: () => authority, settingsGatewayUrl: () => authority.gatewayUrl,
      getClient: (id) => (id === "client-1" ? { clientId: id } : undefined), isClientRemoved: () => false,
      session: () => undefined, sessions: () => [], isSessionGone: () => true, emitProjectMemoryChanged: () => {},
      characterStore: new (CharacterStore as any)(), emitCharacterVoicesChanged: (scope) => emitted.push(scope),
    });
    const scope = { clientId: "client-1", ...authority };
    assert.deepEqual(await memory.readCharacterVoices(scope), { scope, voices: [] });
    const ref = join(cwd, "ref.wav"); writeFileSync(ref, Buffer.from("RIFF-ref".repeat(32)));
    const sampleFile = join(cwd, "sample.wav"); writeFileSync(sampleFile, Buffer.from("RIFF-sample".repeat(32)));
    const { binding, assertCurrent } = memory.characterVoiceContext("client-1", scope);
    const store = memory.characterVoiceStore;
    const id = await store.prepare(binding, cwd, "Ada", "Narration for this channel", [{ filePath: ref, sha256: sha(readFileSync(ref)) }], undefined, [], false, assertCurrent);
    await store.attachSample(binding, id, { filePath: sampleFile, sha256: sha(readFileSync(sampleFile)) }, assertCurrent);
    let snap = await memory.readCharacterVoices(scope);
    assert.equal(snap.voices[0].state, "pending");
    snap = await memory.approveCharacterVoice(scope, id, snap.voices[0].sampleSha256);
    assert.equal(snap.voices[0].state, "approved");
    assert.deepEqual(emitted, [scope], "approve emits the exact scope the renderer compares (JSON key order clientId, gatewayUrl, canonicalKeyId)");
    assert.equal(JSON.stringify(emitted[0]), JSON.stringify(snap.scope));
    await assert.rejects(memory.approveCharacterVoice({ ...scope, canonicalKeyId: "other" }, id, "x"), /The active account changed\. Reopen Characters before continuing\./);
    snap = await memory.removeCharacterVoice(scope, id);
    assert.equal(emitted.length, 2, "remove emits (finally)");
    assert.equal(snap.voices.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("docs/34: relaunchOptions — inside an AppImage relaunch the AppImage file (not the temporary runtime mount); elsewhere Electron's default", () => {
  const argv = ["/tmp/.mount_X/videoclaw-port", "--no-sandbox", "--user-data-dir=/u"];
  assert.deepEqual(relaunchOptions({ APPIMAGE: "/apps/Videoclaw.AppImage" }, "linux", argv), { execPath: "/apps/Videoclaw.AppImage", args: ["--no-sandbox", "--user-data-dir=/u"] });
  assert.equal(relaunchOptions({}, "linux", argv), undefined);
  assert.equal(relaunchOptions({ APPIMAGE: "/x" }, "win32", argv), undefined);
  assert.equal(relaunchOptions({ APPIMAGE: "/x" }, "darwin", argv), undefined);
});
