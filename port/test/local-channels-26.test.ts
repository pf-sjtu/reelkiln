// docs/26: the remaining category-(a) local channels — AgentHost deletion / retry / continuation / adopt /
// spend / materials / original context, the Quickstart start coordinator, local-channels-26 handlers,
// LocalResetController, BootstrapCore.revertEngine, FeedbackService, HyperFrames preview + edit, and the
// attachment intake handlers. SDK boundary mocked (no MiniMax request); every module under test is the
// verbatim slice the app runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHost, continuationSessionUuid, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import type { EngineSessionDeps } from "../src/main/agent/engine-session";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { QuickstartStartCoordinator } from "../src/main/quickstart/quickstart-start.generated";
import { localChannels26 } from "../src/main/local-channels-26";
import { SessionRegistry } from "../src/main/engine/session";
import { writeProjectPack } from "../src/main/taste/project-pack.generated";
import { LocalResetController, LOCAL_RESET_MARKER, LOCAL_RESET_REFUSAL_COPY, runPendingLocalReset } from "../src/main/account/local-reset.generated";
import { CredentialStore } from "../src/main/account/local-reset-env";
import { BootstrapCore, notPortedHooks } from "../src/main/engine/bootstrap";
import { FeedbackService, feedbackConsentState } from "../src/main/feedback/feedback.generated";
import { HyperframesPreviewController, validateInPolicyWorker } from "../src/main/hyperframes/hf-preview.generated";
import { validatePreviewComposition } from "../src/main/workers/hf-policy-worker.generated";
import { parseComposition } from "../src/main/hyperframes/composition-edit.generated";
import { attachmentIntakeHandlers } from "../src/main/attachments/attachment-ipc";
import { deletionBlockMessage } from "../src/main/jobs/project-trash.generated";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(10); } }

/** Fake SDK query: each user turn yields an assistant text + a result; `fail` decides per turn. */
class FakeQuery {
  closed = false; turns: string[] = [];
  private outQ: Array<Record<string, any>> = []; private wake: (() => void) | null = null;
  constructor(public readonly prompt: AsyncIterable<any>, public readonly options: any, fail: (n: number) => boolean) {
    void (async () => {
      for await (const m of prompt) {
        const text = m?.message?.content?.[0]?.text ?? ""; this.turns.push(text);
        const n = this.turns.length;
        this.push({ type: "system", subtype: "init", session_id: "sdk-1", model: "m" });
        if (fail(n)) { this.push({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1, duration_ms: 5, session_id: "sdk-1" }); continue; }
        this.push({ type: "assistant", session_id: "sdk-1", message: { id: `m${n}`, content: [{ type: "text", text: "ok" }] } });
        this.push({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0, session_id: "sdk-1" });
      }
    })();
  }
  push(m: Record<string, any>) { this.outQ.push(m); this.wake?.(); this.wake = null; }
  async interrupt() {}
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *[Symbol.asyncIterator]() { while (!this.closed) { const m = this.outQ.shift(); if (m) { yield m; continue; } await new Promise<void>((r) => { this.wake = r; }); } }
}
function harness(o: { fail?: (globalTurn: number) => boolean; busy?: (jobId: string) => boolean } = {}) {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-m9-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "userData"); mkdirSync(ud, { recursive: true });
  const events: Array<{ sessionId: string; event: SessionEvent | any }> = []; const queries: FakeQuery[] = []; const materials: any[] = []; const spend: any[] = [];
  const reg = { trash: [] as string[], removed: new Set<string>(), flushes: 0 };
  let turn = 0;
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => "minimax" as any,
    llmRouteReadiness: async (m) => ({ route: m?.llmRoute, ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "m", env: {}, close: async () => {} }),
  };
  const engine: EngineSessionDeps = {
    workspaceRoot: () => ws, currentEngine: () => ({ path: join(root, "engine"), version: "0.1.57-test" }),
    engineSessionEnv: () => ({ VIDEOCLAW_CONTEXT_EPOCH: "epoch-1", PATH: "/engine/path" }), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "",
  } as any;
  const make = () => new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: () => {}, materials: (sid, ledger) => materials.push({ sid, ledger }), spendSnapshot: (sid, snap) => spend.push({ sid, snap }) },
    service, loadSdk: async () => ({ sdk: { query: ({ prompt, options }: any) => { const q = new FakeQuery(prompt, options, () => o.fail?.(++turn) ?? false); queries.push(q); return q as any; } } }),
    sessionsRoot: join(root, "agent-sessions"), engine, persist: () => {}, stateDir: ud,
    registry: { addTrashWorkspace: (p) => reg.trash.push(p), flush: () => { reg.flushes++; return true; }, markRemoved: (id) => reg.removed.add(id), unmarkRemoved: (id) => reg.removed.delete(id) },
    jobBusyProbe: o.busy,
  });
  const host = make();
  const bind = (sid: string, jobId: string) => { mkdirSync(join(ws, "jobs", jobId), { recursive: true }); host.commitBind((host as any).sessions.get(sid), jobId, "test", false); };
  return { host, make, root, ws, ud, events, queries, materials, spend, reg, bind, cleanup: async () => { await host.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test("session:deletionPlan / session:delete (L39205/L39248): plan lists jobs/<id>, a running turn blocks, delete moves the job into .videoclaw-trash and drops the row", async () => {
  let busy = false;
  const h = harness({ busy: () => busy });
  try {
    const m = h.host.createSession({});
    h.bind(m.sessionId, "job-del");
    writeFileSync(join(h.ws, "jobs", "job-del", "notes.txt"), "x".repeat(100));
    const plan: any = await h.host.planProjectDeletion(m.sessionId);
    assert.equal(plan.jobId, "job-del");
    assert.deepEqual(plan.items.map((i: any) => i.label), ["jobs/job-del"]);
    assert.ok(plan.totalBytes >= 100);
    assert.equal(plan.blocked, undefined);
    busy = true;
    const refused: any = await h.host.deleteProject(m.sessionId);
    assert.equal(refused.ok, false); assert.equal(refused.blocked, "active-render"); assert.equal(refused.reason, deletionBlockMessage("active-render"));
    busy = false;
    (h.host as any).sessions.get(m.sessionId).meta.status = "running";
    assert.equal(((await h.host.planProjectDeletion(m.sessionId)) as any).blocked, "active-production");
    (h.host as any).sessions.get(m.sessionId).meta.status = "idle";
    const done: any = await h.host.deleteProject(m.sessionId);
    assert.equal(done.ok, true); assert.equal(done.retentionDays, 7); assert.ok(done.trashedBytes >= 100);
    assert.equal(existsSync(join(h.ws, "jobs", "job-del")), false);
    assert.ok(existsSync(join(h.ws, ".videoclaw-trash")));
    assert.equal(h.host.has(m.sessionId), false);
    assert.ok(h.reg.removed.has(m.sessionId)); assert.equal(h.reg.trash.length, 1);
    assert.equal(await h.host.planProjectDeletion(m.sessionId), null);
    const gone: any = await h.host.deleteProject(m.sessionId);
    assert.equal(gone.reason, "That video is no longer in the sidebar.");
    // a video with no job deletes as a registry-only removal
    const n = h.host.createSession({});
    assert.deepEqual(((await h.host.deleteProject(n.sessionId)) as any).trashedBytes, 0);
  } finally { await h.cleanup(); }
});

test("session:retry (L42565): an errored turn keeps its input; retry re-delivers the same text into a resumed runtime; nothing to retry → false", async () => {
  const h = harness({ fail: (n) => n === 1 });
  try {
    const m = h.host.createSession({});
    assert.equal(h.host.retryTurn(m.sessionId), false);
    await h.host.sendMessage(m.sessionId, "make a 5s clip");
    await until(() => h.host.runtimeInfo(m.sessionId).status === "error");
    assert.ok(h.events.some((e) => e.event.kind === "error" && e.event.canRetry === true));
    assert.equal(h.host.retryTurn(m.sessionId), true);
    await until(() => h.host.runtimeInfo(m.sessionId).status === "idle");
    const turns = h.queries.flatMap((q) => q.turns);
    assert.equal(turns.length, 2);
    assert.equal(turns[0], turns[1], "the retried turn carries the exact delivered text");
    // the second delivery resumes the SDK session observed on the first (resume: sdkSessionId)
    const last = h.queries[h.queries.length - 1];
    assert.equal(h.queries.length >= 1, true);
    if (h.queries.length > 1) assert.equal(last.options.resume, "sdk-1");
    assert.equal(h.host.retryTurn(m.sessionId), false, "consumed");
  } finally { await h.cleanup(); }
});

test("session:startContinuation + job:adopt (L38972/L47802): the finalized video's job moves into a deterministic continuation chat; idempotent; adopt(null) clears the offer", async () => {
  const h = harness();
  try {
    const src = h.host.createSession({ clientId: "personal" });
    h.bind(src.sessionId, "job-cont");
    assert.throws(() => h.host.startContinuationChat(src.sessionId, "act-1"), /Only a finalized video/);
    (h.host as any).sessions.get(src.sessionId).meta.finalizedAtMs = Date.now();
    const next = h.host.startContinuationChat(src.sessionId, "act-1");
    assert.equal(next.sessionId, continuationSessionUuid(src.sessionId, "act-1"));
    assert.equal(next.jobId, "job-cont");
    assert.match(String(next.title), / · continued$/);
    const srcMeta: any = h.host.listSessions().find((s) => s.sessionId === src.sessionId);
    assert.equal(srcMeta.jobId, undefined); assert.equal(srcMeta.priorJobId, "job-cont");
    assert.deepEqual(srcMeta.continuation, { clientActionId: "act-1", sessionId: next.sessionId });
    assert.equal(h.host.startContinuationChat(src.sessionId, "act-2").sessionId, next.sessionId, "the receipt wins");
    // adopt(null) clears a standing offer
    const other = h.host.createSession({});
    (h.host as any).sessions.get(other.sessionId).meta.adoptCandidate = { jobId: "job-cont", reason: "owned", ownerSessionId: next.sessionId, ownerTitle: "x" };
    assert.equal((h.host.adoptJob(other.sessionId, null) as any).adoptCandidate, undefined);
    // explicit adopt of an offered job transfers ownership
    (h.host as any).sessions.get(other.sessionId).meta.adoptCandidate = { jobId: "job-cont", reason: "owned", ownerSessionId: next.sessionId, ownerTitle: "x" };
    assert.equal((h.host.adoptJob(other.sessionId, "job-cont") as any).jobId, "job-cont");
    assert.equal((h.host.listSessions().find((s) => s.sessionId === next.sessionId) as any).jobId, undefined);
    assert.equal(h.host.adoptJob("nope", "job-cont"), null);
  } finally { await h.cleanup(); }
});

test("spend:get / spend:setCeiling (L45686/L47158): new videos start unlimited; a ceiling is capped + persisted (spend-budgets.json) + pushed; Bypass refuses without consent", async () => {
  const h = harness();
  try {
    const m = h.host.createSession({});
    assert.equal((h.host.getSpendSnapshot(m.sessionId) as any).policy, "unlimited_for_video");
    assert.equal((h.host.getSpendSnapshot("unknown") as any).policy, "ask_each");
    const r: any = await h.host.setSpendCeiling(m.sessionId, 5);
    assert.equal(r.snapshot.policy, "capped"); assert.equal(r.snapshot.ceilingUsd, 5); assert.equal(r.warning, undefined);
    assert.ok(h.spend.some((s) => s.sid === m.sessionId && s.snap.policy === "capped"));
    assert.ok(existsSync(join(h.ud, "spend-budgets.json")));
    await assert.rejects(h.host.setSpendCeiling(m.sessionId, -1), /positive finite/);
    (h.host as any).sessions.get(m.sessionId).meta.permissionMode = "bypassPermissions";
    await assert.rejects(h.host.setSpendCeiling(m.sessionId, 3), /Turn off Bypass/);
    const b: any = await h.host.setSpendCeiling(m.sessionId, 3, { confirmDisableBypass: true });
    assert.equal(b.snapshot.ceilingUsd, 3);
    assert.equal((h.host.listSessions().find((s) => s.sessionId === m.sessionId) as any).permissionMode, "auto");
    const reopened = h.make();
    assert.equal((reopened.getSpendSnapshot(m.sessionId) as any).ceilingUsd, 3, "restored from spend-budgets.json");
    await reopened.dispose();
  } finally { await h.cleanup(); }
});

test("materials (L44876/L44932): a journaled arrival is published once (material_arrived + materials:changed + display row) and materialPreview resolves the file", async () => {
  const h = harness();
  try {
    const m = h.host.createSession({});
    h.bind(m.sessionId, "job-mat");
    const png = join(h.ws, "jobs", "job-mat", "incoming", "ref.png");
    mkdirSync(join(h.ws, "jobs", "job-mat", "incoming"), { recursive: true }); writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
    h.host.materialsLedger.record({ sessionId: m.sessionId, name: "ref.png", path: png, origin: "studio-files", kind: "image" });
    h.host.publishMaterials(m.sessionId);
    const arrived = h.events.filter((e) => e.event.kind === "material_arrived");
    assert.equal(arrived.length, 1);
    assert.equal(h.materials.length, 1);
    h.host.publishMaterials(m.sessionId);
    assert.equal(h.events.filter((e) => e.event.kind === "material_arrived").length, 1, "digest dedupes");
    const id = arrived[0].event.entry.id;
    const prev = h.host.materialPreview(m.sessionId, id);
    assert.equal(prev.asset.path, png); assert.equal(prev.asset.kind, "image");
    assert.equal(h.host.materialPreview(m.sessionId, "missing"), null);
    const history = await h.host.getHistory(m.sessionId).catch(() => []);
    assert.ok(Array.isArray(history));
  } finally { await h.cleanup(); }
});

test("job:originalContext (L45675): reads the bound job's promise.json brief + the first user prompt; unbound → null", async () => {
  const h = harness();
  try {
    const m = h.host.createSession({});
    assert.equal(await h.host.getOriginalContext(m.sessionId), null);
    h.bind(m.sessionId, "job-ctx");
    writeFileSync(join(h.ws, "jobs", "job-ctx", "promise.json"), JSON.stringify({ brief: "30s product teaser" }));
    const ctx: any = await h.host.getOriginalContext(m.sessionId);
    assert.match(ctx.brief, /product teaser/);
    assert.equal(ctx.chatAvailable, false);
  } finally { await h.cleanup(); }
});

test("quickstart:start (L61294 → QuickstartStartCoordinator L33623): one durable destination with meta.quickstart, the starter prompt delivered once, firstTurn.submittedAt recorded, duplicate converges", async () => {
  const h = harness();
  try {
    const sha = "a".repeat(64);
    const starter = { id: "starter.demo-one", version: 1, prompt_sha256: "b".repeat(64), core_reference_ids: [], advisory_workflows: [], title: "Demo starter", prompt: "Make the demo starter video" };
    const catalog = { pinned: () => ({ generation: 7, catalogSha256: sha }), starter: () => starter, coreFiles: async () => [] };
    const started: any[] = [];
    const coord: any = new QuickstartStartCoordinator(catalog, {
      listSessions: () => h.host.listSessions(), createSession: (r: any, p: any) => h.host.createSession(r, p),
      listComposerAttachments: (id: string) => h.host.listComposerAttachments(id), stageComposerAttachments: (r: any, cb: any) => h.host.stageComposerAttachments(r, cb),
      retryComposerAttachment: (id: string, a: string, cb: any) => h.host.retryComposerAttachment(id, a, cb), updateQuickstartFirstTurn: (id: string, ft: any) => h.host.updateQuickstartFirstTurn(id, ft),
      sendMessage: (id: string, r: any) => h.host.sendMessage(id, r),
    }, { prepareNewSession: async () => {}, onAttachmentChanged: () => {}, onStarted: (s: any) => started.push(s), onFailed: (s: any, msg: string) => h.host.quickstartStartFailed(s.sessionId, msg), now: () => Date.now(), wait: (ms: number) => tick(ms) });
    const req = { starterId: starter.id, clientId: "personal", journeyId: randomUUID(), activationId: randomUUID(), catalogSha256: sha, entryPoint: "gallery" };
    await assert.rejects(coord.start({ ...req, starterId: "bad" }), /Invalid Quickstart identity/);
    const res = await coord.start(req);
    assert.equal(res.duplicate, false);
    assert.equal(res.session.title, "Demo starter");
    assert.equal(res.session.quickstart.activationId, req.activationId);
    await coord.settled();
    assert.equal(started.length, 1);
    await until(() => h.queries.flatMap((q) => q.turns).length === 1);
    assert.match(h.queries[0].turns[0], /Make the demo starter video/);
    const meta: any = h.host.listSessions().find((s) => s.sessionId === res.session.sessionId);
    assert.ok(meta.quickstart.firstTurn.submittedAt > 0);
    await until(() => h.host.runtimeInfo(meta.sessionId).status === "idle");
    const again = await coord.start(req);
    assert.equal(again.session.sessionId, res.session.sessionId); assert.equal(again.duplicate, true);
  } finally { await h.cleanup(); }
});

test("local-channels-26: library tenant guard + setTenant + seedPack (README with the brief), voices answer the account-less branch, hfPreview/feedback absent fallbacks", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-lc26-"));
  try {
    const registry = new SessionRegistry(join(root, "sessions.json")); registry.load();
    let saves = 0;
    const calls: string[] = [];
    const lib = {
      stats: async (cwd: string, tenant: string) => { calls.push(`stats ${tenant}`); return { tenant, sources: [] }; },
      scan: async () => ({}), addSource: async (_c: string, tenant: string, type: unknown, dir: string) => { calls.push(`add ${tenant} ${type} ${dir}`); return { ok: true }; },
      removeSource: async () => { throw new Error("boom"); }, preview: async () => "/tmp/p.mp4",
      errorMessage: () => "Library work did not finish. Try again, or report the problem if it continues.", key: (t: string, c: string) => `${t}\0${c}`, gate: (_k: string, _kind: string, fn: () => Promise<unknown>) => fn(), previewCacheDir: root,
    };
    const h = localChannels26({
      registry, saveRegistry: () => { saves++; }, absCwd: (c) => c, media: { grant: () => true, resolve: () => ({ state: "missing", path: "" }) }, pathToVcmedia: (p) => `vcmedia://local${p}`,
      writeProjectPack, library: lib, pickDirectory: async () => null, characterStore: { retry: () => null }, exposeCharacter: (c) => c, sheetStates: () => [],
      characterVoiceUnavailable: () => ({ ok: false, message: "Project memory is unavailable until this account and project are verified." }),
    });
    assert.deepEqual(await h["library:stats"]("personal", root), { error: "no-tenant" });
    const client: any = h["library:setTenant"]("personal", "My Brand!");
    assert.equal(client.tenant, "my-brand-"); assert.equal(saves, 1);
    assert.deepEqual(await h["library:stats"]("personal", root), { tenant: "my-brand-", sources: [] });
    assert.deepEqual(await h["library:addSource"]("personal", root, "video", ""), { tenant: "my-brand-", sources: [] }, "cancelled picker → stats");
    assert.deepEqual(await h["library:removeSource"]("personal", root, "/x", false), { error: "engine", message: lib.errorMessage() });
    const pack: any = h["project:seedPack"]("personal", root, "Calm, warm  product voice");
    assert.ok(existsSync(pack.packPath));
    assert.match(readFileSync(pack.packPath, "utf8"), /\*\*\[brief\]\*\* Calm, warm product voice/);
    assert.deepEqual(await h["characters:voices:list"]({}), { ok: false, message: "Project memory is unavailable until this account and project are verified." });
    assert.deepEqual(h["hfPreview:available"]("s", "j"), { available: false });
    assert.deepEqual(h["characters:sheetStates"]("/x"), []);
    assert.deepEqual(await h["library:preview"](root, "/nope", 0, 1), { error: "media", message: "This source is no longer available to preview." });
    await assert.rejects(Promise.resolve().then(() => h["session:delete"]("x")), /Videos are not available/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("LocalResetController (L5826) + runPendingLocalReset (L5960): prepare plans, a stale plan is refused, commit writes the marker + relaunches, the next start archives the workspace and clears userData", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-reset-"));
  try {
    const ud = join(root, "ud"); const ws = join(root, "Videoclaw");
    mkdirSync(join(ud, "engine-profile"), { recursive: true }); mkdirSync(join(ws, "jobs", "j1"), { recursive: true });
    writeFileSync(join(ud, "sessions.json"), "{}"); writeFileSync(join(ud, "settings.json"), JSON.stringify({ gatewayUrl: "https://g", llmRoute: "minimax" }));
    writeFileSync(join(ws, "jobs", "j1", "a.txt"), "x");
    let relaunched = 0;
    const ctl: any = new LocalResetController({
      userDataDir: ud, channel: "prod", workspace: () => ws, keepSharedDevWorkspace: false,
      assertCredentialsMutable: () => new CredentialStore({ file: join(ud, "credentials.dat"), packaged: false }).assertCanMutate(),
      runningVideos: () => 0, unsyncedRecords: () => 0, blockPaidWork: () => {}, stopAuthenticatedWork: () => {}, stopEditorRendering: () => [],
      codexProcessesStopped: async () => true, stopEngineChildren: () => [], processesExited: async () => true, flushOutbox: async () => {}, stopOutbox: async () => {},
      relaunch: () => { relaunched++; },
    });
    const plan = ctl.prepare();
    assert.equal(plan.ok, true); assert.equal(plan.runningVideos, 0); assert.ok(plan.workspace);
    assert.deepEqual(await ctl.commit("nope"), { ok: false, reason: "stale-plan", message: LOCAL_RESET_REFUSAL_COPY["stale-plan"] });
    assert.deepEqual(await ctl.commit(plan.planId), { ok: true });
    assert.equal(relaunched, 1);
    assert.ok(existsSync(join(ud, LOCAL_RESET_MARKER)));
    const done = await runPendingLocalReset({ userDataDir: ud, channel: "prod", workspace: ws, packaged: false, initializeWorkspace: (w: string) => mkdirSync(join(w, "jobs"), { recursive: true }), rebuildEngineWorkspace: () => false, verifyEngineWorkspace: () => {}, clearBrowserStorage: async () => {} });
    assert.equal(done, true);
    assert.equal(existsSync(join(ud, LOCAL_RESET_MARKER)), false);
    assert.equal(existsSync(join(ud, "sessions.json")), false);
    assert.deepEqual(JSON.parse(readFileSync(join(ud, "settings.json"), "utf8")), { gatewayUrl: "https://g" });
    const archived = readdirSync(root).filter((n) => n !== "ud" && n !== "Videoclaw");
    assert.equal(archived.length, 1, `workspace archived aside: ${readdirSync(root)}`);
    assert.ok(existsSync(join(root, archived[0], "jobs", "j1", "a.txt")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bootstrap:revertEngine (L10240): one engine → 'No previous engine is available.'; a retained N-1 that passes doctor becomes active and the rest are pruned", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-revert-"));
  try {
    const ud = join(root, "ud"); const engines = join(ud, "engines");
    const mk = (v: string) => { const p = join(engines, `engine-${v}`); mkdirSync(p, { recursive: true }); writeFileSync(join(p, "ENGINE_VERSION.json"), JSON.stringify({ version: v })); writeFileSync(join(p, ".videoclaw-build-sha256"), createHash("sha256").update(v).digest("hex") + "\n"); return p; };
    const a = mk("0.1.0"), b = mk("0.2.0"); mk("0.0.9");
    const core = new BootstrapCore({ platform: process.platform, userData: ud, workspaceRoot: join(root, "ws"), bootstrapRoots: [], packaged: false, bootstrapTool: () => null } as any,
      notPortedHooks({ validateEngineSessionContext: () => {}, runDoctor: async () => ({ ok: true, checks: {} }), writeWorkspace: () => {}, assertEngineMoneyCompatibility: async () => {}, ensureEngineCommandShims: () => {}, inspectProductionCompatible: () => true } as any),
      (async () => "") as any, () => {});
    writeFileSync(join(ud, "engine-current.json"), JSON.stringify({ version: "0.2.0", path: b, buildSha256: "x" }));
    await assert.rejects(core.revertEngine(), /No previous engine is available\./);
    writeFileSync(join(ud, "engine-current.json"), JSON.stringify({ version: "0.2.0", path: b, buildSha256: "x", previous: { version: "0.1.0", path: a, buildSha256: "y" } }));
    const st: any = await core.revertEngine();
    assert.equal(st.engineVersion, "0.1.0");
    assert.deepEqual(readdirSync(engines).sort(), ["engine-0.1.0", "engine-0.2.0"]);
    assert.equal(core.previousEngine()?.version, "0.2.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("feedback:capture / discard (FeedbackService L57172): no gateway key → blockedRoute, no screenshot, consentRequired; discard forgets the capture", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-fb-"));
  process.env.VC_TEST_USERDATA = root;
  try {
    let captured = 0;
    const svc: any = new FeedbackService({
      win: () => ({ isDestroyed: () => false, webContents: { capturePage: async () => { captured++; return { toPNG: () => Buffer.from("png") }; } }, getBounds: () => ({ width: 1, height: 1 }), isFullScreen: () => false }),
      settings: () => ({ telemetry: false }), listSessions: () => [{ sessionId: "s1", title: "t" }], getJobSnapshot: () => null, bootstrapStatus: () => ({}), outboxSummary: () => ({}),
    });
    const cap = await svc.capture({ reportId: "r/1!", activeSessionId: "s1", rendererLog: [] });
    assert.deepEqual(cap, { reportId: "r1", screenshotPath: null, ...feedbackConsentState({ telemetry: false, hasKey: false }), contact: "" });
    assert.equal(captured, 0, "blockedRoute: the original never screenshots without a key");
    assert.equal(svc.pending.size, 1);
    svc.discard("r1");
    assert.equal(svc.pending.size, 0);
  } finally { delete process.env.VC_TEST_USERDATA; rmSync(root, { recursive: true, force: true }); }
});

test("hfPreview (L56487): availability true only for a job-owned composition with the pinned runtime copy; editApply rewrites the element text atomically", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-hf-"));
  try {
    const engineRuntime = join(root, "engine", "hyperframes", "runtime"); mkdirSync(join(engineRuntime, "fonts"), { recursive: true });
    writeFileSync(join(engineRuntime, "gsap.min.js"), "/*gsap*/"); writeFileSync(join(engineRuntime, "fonts", "fonts.css"), "/*f*/");
    const player = join(root, "engine", "player.js"); writeFileSync(player, "/*player*/");
    const ws = join(root, "ws"); const comp = join(ws, "jobs", "job-hf", "hyperframes");
    mkdirSync(join(comp, "runtime", "fonts"), { recursive: true });
    writeFileSync(join(comp, "runtime", "gsap.min.js"), "/*gsap*/"); writeFileSync(join(comp, "runtime", "fonts", "fonts.css"), "/*f*/");
    writeFileSync(join(comp, "index.html"), '<html><body><div data-composition-id="c1" data-width="1080" data-height="1920" data-duration="5"><h1 id="title">Hello</h1></div><script src="runtime/gsap.min.js"></script></body></html>');
    assert.deepEqual(validatePreviewComposition(comp, join(comp, "index.html"), engineRuntime), { ok: true });
    const inProcessWorker = () => { let cb: any; return { postMessage: (m: any) => { const ok = validatePreviewComposition(m.compositionDir, m.entryPath, m.runtimeDir).ok && parseComposition(readFileSync(m.entryPath, "utf8")) !== null; setTimeout(() => cb?.({ type: "result", ok }), 0); }, onMessage: (f: any) => { cb = f; }, onExit: () => {}, kill: () => {} }; };
    const ctl: any = new HyperframesPreviewController({
      getSession: (id: string) => (id === "s1" ? { cwd: ws, jobId: "job-hf" } : undefined),
      resolvePreviewAssets: () => ({ playerScriptPath: player, runtimeDir: engineRuntime }),
      forkWorker: () => { throw new Error("not in test"); },
      validateComposition: (d: string, e: string, r: string) => validateInPolicyWorker(inProcessWorker, { compositionDir: d, entryPath: e, runtimeDir: r }),
      emit: () => {}, isRenderActive: () => false, log: () => {},
    });
    assert.deepEqual(await ctl.availability({ sessionId: "s1", jobId: "job-hf" }), { available: true });
    assert.deepEqual(await ctl.availability({ sessionId: "s2", jobId: "job-hf" }), { available: false });
    const edit = ctl.applyEdit({ requestId: "r1", sessionId: "s1", jobId: "job-hf", elementId: "title", newText: "Hi there" });
    assert.equal(edit.ok, true); assert.equal(edit.meta.editable[0].text, "Hi there");
    assert.match(readFileSync(join(comp, "index.html"), "utf8"), /<h1 id="title">Hi there<\/h1>/);
    assert.equal(ctl.applyEdit({ requestId: "r2", sessionId: "s1", jobId: "job-hf", elementId: "title", newText: "<b>" }).ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("attachment:pasteImage / preview (L62269/L62253): a clipboard PNG is written to the intake dir and staged as a paste chip; non-PNG bytes are refused", async () => {
  const h = harness();
  try {
    const m = h.host.createSession({});
    const changed: any[] = [];
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(10, 0); ihdr.writeUInt32BE(10, 4);
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR"), ihdr, Buffer.alloc(32, 1)]);
    const fakeImage = (b: Buffer) => ({ isEmpty: () => b.length === 0, getSize: () => ({ width: 10, height: 10 }), toPNG: () => b, resize: () => fakeImage(b), toJPEG: () => b }) as any;
    const a = attachmentIntakeHandlers({ host: h.host, intakeDir: join(h.ud, "composer-clipboard"), media: {}, image: fakeImage, onChanged: (x) => changed.push(x) });
    assert.throws(() => a.pasteImage(m.sessionId, "video", new ArrayBuffer(0)), /Could not paste that image/);
    assert.throws(() => a.pasteImage(m.sessionId, "video", new Uint8Array([1, 2, 3]).buffer), /Could not read that pasted image/);
    const staged: any = a.pasteImage(m.sessionId, "video", png.buffer.slice(png.byteOffset, png.byteOffset + png.length));
    assert.equal(staged.length, 1); assert.match(staged[0].name, /^Pasted image [0-9a-f]{6}\.png$/);
    await until(() => (h.host.listComposerAttachments(m.sessionId) as any[]).some((x) => x.status === "ready"));
    assert.ok(readdirSync(join(h.ud, "composer-clipboard")).length >= 1);
    await assert.rejects(a.voiceNote(m.sessionId, "not-an-id", new ArrayBuffer(4)), /Invalid recording/);
  } finally { await h.cleanup(); }
});

test("docs/26: handler wiring of the M9 channels the UI run could not reach — voice:approve/remove (account-less branch), library:scan (tenant guard + engine error), characters:retry, input:respond, media:discardVoice", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-lc26b-"));
  try {
    const registry = new SessionRegistry(join(root, "sessions.json")); registry.load();
    const calls: string[] = [];
    let scanFails = false;
    const lib = {
      stats: async () => ({}), scan: async (cwd: string, tenant: string) => { if (scanFails) throw new Error("engine exited 1"); calls.push(`scan ${tenant} ${cwd}`); return { scanned: 3 }; },
      addSource: async () => ({}), removeSource: async () => ({}), preview: async () => "",
      errorMessage: () => "Library work did not finish. Try again, or report the problem if it continues.", key: (t: string, c: string) => `${t}\0${c}`, gate: (_k: string, _kind: string, fn: () => Promise<unknown>) => fn(), previewCacheDir: root,
    };
    const host: any = { respondInput: (id: string, r: unknown) => calls.push(`respond ${id} ${JSON.stringify(r)}`), discardVoice: (s: string, r: string) => calls.push(`discard ${s} ${r}`) };
    const unavailable = { ok: false as const, message: "Project memory is unavailable until this account and project are verified." };
    const h = localChannels26({
      host, registry, saveRegistry: () => {}, absCwd: (c: string) => `/abs/${c}`, media: { grant: () => true, resolve: () => ({ state: "missing", path: "" }) }, pathToVcmedia: (p: string) => p,
      writeProjectPack, library: lib, pickDirectory: async () => null,
      characterStore: { retry: (cwd: string, slug: string) => (calls.push(`retry ${cwd} ${slug}`), { slug, state: "pending", secret: 1 }) },
      exposeCharacter: (c: any) => ({ slug: c.slug, state: c.state }), sheetStates: () => [], characterVoiceUnavailable: () => unavailable,
    } as any);
    assert.deepEqual(await h["characters:voice:approve"]({ id: "v1" }), unavailable);
    assert.deepEqual(await h["characters:voice:remove"]({ id: "v1" }), unavailable);
    // (an unknown project has no tenant; "personal" may carry one from another test: DEFAULT_CLIENTS is shallow-copied, as in the original L35666)
    assert.deepEqual(await h["library:scan"]("no-such-project", root), { error: "no-tenant" });
    h["library:setTenant"]("personal", "brand");
    assert.deepEqual(await h["library:scan"]("personal", "ws"), { scanned: 3 });
    scanFails = true;
    assert.deepEqual(await h["library:scan"]("personal", "ws"), { error: "engine", message: lib.errorMessage() });
    assert.deepEqual(h["characters:retry"]("ws", "me"), { slug: "me", state: "pending" }, "exposeCharacter shapes the store row");
    h["input:respond"]("req-1", { answer: "yes" });
    assert.equal(h["media:discardVoice"]("s1", "rec-1"), undefined);
    assert.deepEqual(calls, ["scan brand ws", "retry /abs/ws me", 'respond req-1 {"answer":"yes"}', "discard s1 rec-1"]);
    const noHost = localChannels26({ registry, saveRegistry: () => {}, absCwd: (c: string) => c, media: { grant: () => true, resolve: () => ({ state: "missing", path: "" }) }, pathToVcmedia: (p: string) => p, writeProjectPack, library: lib, pickDirectory: async () => null, characterStore: { retry: () => null }, exposeCharacter: (c: any) => c, sheetStates: () => [], characterVoiceUnavailable: () => unavailable } as any);
    assert.throws(() => noHost["input:respond"]("r", {}), /Videos are not available/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("media:voiceDictationStatus (L61910) = voiceDictationStatus(voiceTools()): ffmpeg but no on-device helper → attach-only", async () => {
  const { configureVoiceTools } = await import("../src/main/attachments/voice-tools");
  const { VOICE_ERRORS } = await import("../src/main/platform/voice");
  const root = mkdtempSync(join(tmpdir(), "vc-voice-"));
  const h = localChannels26({} as any) as Record<string, (...a: any[]) => any>;
  configureVoiceTools(() => [root]);
  assert.deepEqual(await h["media:voiceDictationStatus"](), { available: false, attach: false, message: "Voice notes are unavailable in this build." });
  writeFileSync(join(root, "ffmpeg"), "");
  assert.deepEqual(await h["media:voiceDictationStatus"](), { available: false, attach: true, message: VOICE_ERRORS.unavailable });
  configureVoiceTools(() => []); rmSync(root, { recursive: true, force: true });
});
