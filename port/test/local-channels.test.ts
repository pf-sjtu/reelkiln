// docs/25: the local / no-credential channels made real (local-channels.ts, AgentHost, SessionRegistry,
// quickstart-ipc) and session:history transcript replay (history.generated.ts + AgentHost.getHistory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHost, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import { displayTranscriptPath, historyToEvents, readDisplayTranscript, appendDisplayTranscript, engineMessageSha256 } from "../src/main/agent/history.generated";
import { localChannelHandlers } from "../src/main/local-channels";
import { SessionRegistry } from "../src/main/engine/session";
import { CharacterStore } from "../src/main/characters/character-store.generated";
import { createQuickstartCatalog } from "../src/main/quickstart/quickstart-ipc";
import { quickstartLatencySnapshot } from "../src/main/quickstart/quickstart-catalog.generated";
import { loadClaudeAgentSdk } from "../src/main/llm/agent-sdk";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { SECTION, ANTI } from "../src/main/taste/taste.generated";
import { composerTurnMessageUuid } from "../src/main/attachments/composer-attachments.generated";

const PORT = resolve(__dirname, "..");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 3000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(5); } }
const SID = "11111111-2222-4333-8444-555555555555";

/** A host whose fake query echoes one assistant reply per input and reports the SDK session id. */
function harness(o: { getSessionMessages?: unknown; clientOrder?: () => string[] } = {}) {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-local-"));
  const events: Array<{ sessionId: string; event: SessionEvent }> = [];
  const pushed: Record<string, any>[] = [];
  const queries: any[] = [];
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => "minimax" as any,
    llmRouteReadiness: async () => ({ ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "m", env: {}, close: async () => {} }),
  };
  const query = ({ prompt, options }: any) => {
    const out: any[] = []; let wake: any = null; let closed = false;
    const q: any = { options, modes: [] as string[], close() { closed = true; wake?.(); }, async interrupt() {}, async setPermissionMode(m: string) { q.modes.push(m); },
      async *[Symbol.asyncIterator]() { while (!closed) { const m = out.shift(); if (m) { yield m; continue; } await new Promise((r) => { wake = r; }); } } };
    (async () => { for await (const m of prompt) { pushed.push(m); const add = (x: any) => { out.push(x); wake?.(); };
      add({ type: "system", subtype: "init", session_id: SID, model: "m" });
      add({ type: "assistant", session_id: SID, message: { id: `msg_${pushed.length}`, content: [{ type: "text", text: `reply ${pushed.length}` }] }, parent_tool_use_id: null });
      add({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1, session_id: SID }); } })();
    queries.push(q); return q;
  };
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: () => {} },
    service,
    loadSdk: async () => ({ sdk: { query, ...(o.getSessionMessages ? { getSessionMessages: o.getSessionMessages } : {}) } as any, executable: "/x/claude" }),
    now: (() => { let t = 1_000; return () => (t += 10); })(),
    sessionsRoot: join(root, "sessions"), stateDir: join(root, "state"), engineProfileDir: () => join(root, "engine-profile"),
    ...(o.clientOrder ? { clientOrder: o.clientOrder } : {}),
  });
  return { host, events, pushed, queries, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("session:history replays the SDK transcript through the ORIGINAL historyToEvents: typed text (display sidecar), assistant text, tool rows; sdkSessionId captured", async (t) => {
  let sdk: any;
  try { sdk = (await loadClaudeAgentSdk(join(PORT, "vendor", "claude-agent-sdk"))).sdk; } catch { t.skip("Claude Agent SDK not installed (npm run agent-sdk:install)"); return; }
  const h = harness({ getSessionMessages: sdk.getSessionMessages });
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, { text: "做一个竖屏快剪", clientTurnId: "c1", attachmentIds: [] });
    await until(() => h.host.runtimeInfo(sessionId).status === "idle");
    assert.equal(h.host.listSessions()[0].sdkSessionId, SID, "observeSdkSessionIdentity (L36172)");
    // display sidecar row (persistDisplayTurn L41820): keyed by the delivered message uuid, digest of the wire text
    const side = readDisplayTranscript(displayTranscriptPath(join(h.root, "state"), sessionId));
    assert.equal(side.ordered.length, 1);
    const userMsg = h.pushed[0];
    assert.equal((side.ordered[0] as any).turnId, userMsg.uuid);
    assert.deepEqual((side.ordered[0] as any).displayTexts, ["做一个竖屏快剪"]);
    // what the SDK child would have written under <engine-profile>/projects/<key>/<sid>.jsonl (with an app preamble on the wire)
    const wire = userMsg.message.content[0].text;
    assert.equal((side.ordered[0] as any).engineSha256, engineMessageSha256(wire));
    const rows = [
      { type: "user", uuid: userMsg.uuid, parentUuid: null, sessionId: SID, isSidechain: false, timestamp: "2026-10-21T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: wire }] } },
      { type: "assistant", uuid: "aaaaaaaa-0000-4000-8000-000000000002", parentUuid: userMsg.uuid, sessionId: SID, isSidechain: false, timestamp: "2026-10-21T10:00:01.000Z", message: { id: "msg_1", role: "assistant", model: "m", content: [{ type: "text", text: "好的，先看素材。" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls jobs" } }] } },
      { type: "user", uuid: "aaaaaaaa-0000-4000-8000-000000000003", parentUuid: "aaaaaaaa-0000-4000-8000-000000000002", sessionId: SID, isSidechain: false, timestamp: "2026-10-21T10:00:02.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.mp4", is_error: false }] } },
      { type: "assistant", uuid: "aaaaaaaa-0000-4000-8000-000000000004", parentUuid: "aaaaaaaa-0000-4000-8000-000000000003", sessionId: SID, isSidechain: false, timestamp: "2026-10-21T10:00:03.000Z", message: { id: "msg_2", role: "assistant", model: "m", content: [{ type: "text", text: "V1 已经剪好。" }] } },
    ];
    mkdirSync(join(h.root, "engine-profile", "projects", "-any-key"), { recursive: true });
    writeFileSync(join(h.root, "engine-profile", "projects", "-any-key", `${SID}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await h.host.dispose(); // the "reopen": no live runtime
    const events = await h.host.getHistory(sessionId);
    const shape = events.map((e: any) => e.kind === "user_text" ? `user:${e.text}` : e.kind === "assistant_text" ? `assistant:${e.text}` : e.kind === "tool_start" ? `tool_start:${e.toolName}:${e.summary}` : e.kind === "tool_end" ? `tool_end:${e.terminal}` : e.kind);
    assert.deepEqual(shape, ["user:做一个竖屏快剪", "assistant:好的，先看素材。", "tool_start:Bash:Looking around the project", "tool_end:ok", "assistant:V1 已经剪好。"]);
    assert.equal((events[0] as any).turnId, userMsg.uuid, "the replayed bubble converges with the live optimistic id");
    // a resume would continue this transcript (resumableSdkSession); a missing one is dropped
    assert.equal((h.host as any).resumableSdkSession((h.host as any).sessions.get(sessionId)), SID);
    rmSync(join(h.root, "engine-profile"), { recursive: true, force: true });
    assert.equal((h.host as any).resumableSdkSession((h.host as any).sessions.get(sessionId)), undefined);
    assert.equal(h.host.listSessions()[0].sdkSessionId, undefined, "stale id dropped (persisted)");
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("historyToEvents (verbatim): no SDK transcript → display rows only; legacy app preambles stripped; unanswered tool closes as abandoned", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-hist-"));
  try {
    const file = displayTranscriptPath(dir, "s1");
    const turnId = "0b6f3c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
    appendDisplayTranscript(file, "[APP-OWNED PRODUCTION ID — authoritative]\nX\nRun prepare_production for this id before planning or paid work.\n\nhello", ["hello"], turnId, undefined, undefined, undefined, undefined);
    const idx = readDisplayTranscript(file);
    assert.deepEqual(historyToEvents([], idx, undefined).map((e: any) => [e.kind, e.text, e.turnId]), [["user_text", "hello", turnId]]);
    const legacy = historyToEvents([
      { type: "user", uuid: "u1", message: { role: "user", content: "[APP-OWNED PRODUCTION ID — authoritative]\nX\nRun prepare_production for this id before planning or paid work.\n\nplain words" } },
      { type: "assistant", uuid: "a1", message: { id: "m1", content: [{ type: "tool_use", id: "t9", name: "Read", input: { file_path: "/x/a.png" } }] } },
    ], { ordered: [], byDigest: new Map(), byTurnId: new Map(), messageTimes: new Map() }, undefined) as any[];
    assert.equal(legacy[0].kind, "user_text"); assert.equal(legacy[0].text, "plain words");
    assert.equal(legacy[1].summary, "Looking at a frame"); assert.equal(legacy[1].mediaPath, "/x/a.png");
    assert.deepEqual(legacy[2], { kind: "tool_end", toolUseId: "t9", isError: false, terminal: "abandoned" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("session:rename / session:reorder / session:setPermissionMode / removeSession (AgentHost, original L38915 / L38482 / L43987 / L39046)", async () => {
  const h = harness({ clientOrder: () => ["personal", "acme"] });
  try {
    const a = h.host.createSession({}); const b = h.host.createSession({}); const c = h.host.createSession({ clientId: "acme" });
    const r = h.host.renameSession(a.sessionId, "  我的第一条视频  ") as any;
    assert.equal(r.title, "我的第一条视频"); assert.equal(r.titleOrigin, "manual");
    assert.equal((h.host.renameSession(a.sessionId, "x".repeat(90)) as any).title.length, 80);
    assert.equal(h.host.renameSession("nope", "t"), null);
    assert.equal((h.host.renameSession(a.sessionId, "   ") as any).titleOrigin, "manual", "blank keeps the title");
    // newest first by default, then the user's drag order
    assert.deepEqual(h.host.listSessions().map((m) => m.sessionId), [b.sessionId, a.sessionId, c.sessionId]);
    const next = h.host.reorderSessions("personal", [a.sessionId, b.sessionId]);
    assert.deepEqual(next.map((m) => m.sessionId), [a.sessionId, b.sessionId, c.sessionId]);
    assert.throws(() => h.host.reorderSessions("personal", [a.sessionId]), /exactly once/);
    assert.throws(() => h.host.reorderSessions("personal", [a.sessionId, c.sessionId]), /exactly once/);
    // permission mode: idle → applied (+ live runtime switched); during a turn → pending, applied before the next send
    await h.host.setPermissionMode(a.sessionId, "acceptEdits");
    assert.equal(h.host.listSessions().find((m) => m.sessionId === a.sessionId)!.permissionMode, "acceptEdits");
    await assert.rejects(h.host.setPermissionMode(a.sessionId, "yolo"), /Invalid permission mode/);
    await h.host.sendMessage(a.sessionId, { text: "hi", clientTurnId: "t1" });
    await until(() => h.host.runtimeInfo(a.sessionId).status === "idle");
    await h.host.setPermissionMode(a.sessionId, "default");
    assert.deepEqual(h.queries[0].modes, ["default"], "query.setPermissionMode on the live runtime (applyPermissionMode)");
    assert.equal(h.host.removeSession(c.sessionId), true);
    assert.equal(h.host.listSessions().length, 2);
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("client:rename / client:reorder / client:remove (SessionRegistry L36332-36423): validation, rollback, tombstones survive the whole-file write", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-clients-"));
  try {
    const file = join(dir, "sessions.json");
    writeFileSync(file, JSON.stringify({ clients: [{ clientId: "personal", name: "Personal" }, { clientId: "acme", name: "Acme" }], sessions: [{ sessionId: "s-acme", clientId: "acme", cwd: dir, status: "idle", createdAt: 1 }] }));
    const reg = new SessionRegistry(file); reg.load();
    const flush = () => reg.writeRegistry([]);
    assert.deepEqual(reg.renameClient("acme", "Acme Studio", flush), { clientId: "acme", name: "Acme Studio" });
    assert.deepEqual(reg.renameClient("acme", "personal", flush), { error: "A project already uses that name." });
    assert.deepEqual(reg.renameClient("gone", "x", flush), { error: "This project is no longer available." });
    assert.deepEqual((reg.reorderClients(["acme", "personal"], () => {}) as any[]).map((c) => c.clientId), ["acme", "personal"]);
    assert.throws(() => reg.reorderClients(["acme"], () => {}), /exactly once/);
    assert.deepEqual(reg.removeClient("personal", [], false, flush, () => {}), { error: "This project cannot be removed." });
    assert.deepEqual(reg.removeClient("acme", ["s-acme"], true, flush, () => {}), { error: "Finish running or recovering work in this project before removing it." });
    const removed: string[] = [];
    assert.deepEqual((reg.removeClient("acme", ["s-acme"], false, flush, (id) => removed.push(id)) as any[]).map((c) => c.clientId), ["personal"]);
    assert.deepEqual(removed, ["s-acme"]);
    const disk = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(disk.clients.map((c: any) => c.clientId), ["personal"], "removed project is not resurrected from disk");
    assert.deepEqual(disk.sessions, [], "its videos' sidebar rows are gone (files stay)");
    assert.ok(existsSync(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("local channels: quit:rendererState / permission:shown / file:openExternal / media:requestMic / analytics / revealSetupLog / stageEtas", async () => {
  const opened: string[] = []; const revealed: string[] = [];
  const reg = new SessionRegistry(join(tmpdir(), "nope-sessions.json"));
  const local = localChannelHandlers({
    registry: reg as any, saveRegistry: () => {}, flushRegistry: () => true,
    shell: { openExternal: async (u) => { opened.push(u); }, showItemInFolder: (p) => { revealed.push(p); } },
    platform: "linux", absCwd: (c) => c, userData: "/ud", characterStore: new CharacterStore() as any, exposeCharacter: (c) => c,
  });
  local.send["quit:rendererState"]({ composerSessionId: "s1", unsentDraft: 1, pendingSendAttachmentIds: ["a", 2, "b"], recordingVoice: true });
  assert.deepEqual(local.quitState(), { composerSessionId: "s1", unsentDraft: false, pendingSendAttachmentIds: ["a", "b"], recordingVoice: true });
  local.send["quit:rendererState"](null);
  assert.deepEqual(local.quitState(), { composerSessionId: null, unsentDraft: false, pendingSendAttachmentIds: [], recordingVoice: false });
  assert.equal(local.send["permission:shown"]("req-1"), undefined);
  await local.invoke["file:openExternal"]("https://videoclaw.ai/help"); await local.invoke["file:openExternal"]("file:///etc/passwd"); await local.invoke["file:openExternal"]("javascript:alert(1)");
  assert.deepEqual(opened, ["https://videoclaw.ai/help"]);
  assert.equal(await local.invoke["media:requestMic"](), true, "non-darwin branch");
  assert.equal(local.invoke["analytics:playbackCompleted"]("/w/jobs/j/final.mp4"), undefined);
  local.invoke["bootstrap:revealSetupLog"]();
  assert.deepEqual(revealed, ["/ud/setup.log"]);
  const ws = mkdtempSync(join(tmpdir(), "vc-etas-"));
  try { const etas = local.invoke["stats:stageEtas"](ws); assert.equal(typeof etas, "object"); assert.ok(etas !== null); } finally { rmSync(ws, { recursive: true, force: true }); }
  await assert.rejects(Promise.resolve().then(() => local.invoke["session:rename"]("s", "t")), /not available/);
});

test("taste:list / taste:commit / taste:decline (verbatim taste module): scopes, COMMITMENTS round-trip, ANTI-COMMITMENTS", () => {
  const ws = mkdtempSync(join(tmpdir(), "vc-taste-"));
  try {
    const reg = { listClients: () => [{ clientId: "acme", name: "Acme" }] } as any;
    const local = localChannelHandlers({ registry: reg, saveRegistry: () => {}, flushRegistry: () => true, shell: { openExternal: async () => {}, showItemInFolder: () => {} }, platform: "linux", absCwd: (c) => c, userData: "/ud", characterStore: new CharacterStore() as any, exposeCharacter: (c) => c });
    const listed = local.invoke["taste:list"]("acme", ws) as any;
    assert.deepEqual(listed.scopes.map((s: any) => s.scope), ["default", "global", "client"]);
    assert.deepEqual(listed.proposals, []);
    const file = join(ws, "taste", "packs", "acme", "README.md");
    assert.deepEqual(local.invoke["taste:commit"](ws, [{ file, cards: ["Music-only audio"] }]), { committed: true, filesUpdated: 1 });
    const md = readFileSync(file, "utf8");
    assert.ok(md.includes(SECTION) && md.includes("- Music-only audio"), md);
    assert.deepEqual(local.invoke["taste:decline"](ws, file, ["Music-only audio"], "No captions"), { committed: true, filesUpdated: 1 });
    const md2 = readFileSync(file, "utf8");
    assert.ok(md2.includes(ANTI) && md2.includes("No captions"), md2);
    const client = (local.invoke["taste:list"]("acme", ws) as any).scopes.find((s: any) => s.scope === "client");
    assert.ok(JSON.stringify(client).includes("Music-only audio"));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test("characters:create / approve / discard / delete over the verbatim CharacterStore (+ exposeCharacter grants)", async () => {
  const ws = mkdtempSync(join(tmpdir(), "vc-chars-"));
  try {
    const granted: any[] = [];
    const local = localChannelHandlers({ registry: {} as any, saveRegistry: () => {}, flushRegistry: () => true, shell: { openExternal: async () => {}, showItemInFolder: () => {} }, platform: "linux", absCwd: (c) => c, userData: "/ud", characterStore: new CharacterStore() as any, exposeCharacter: (c) => { if (c) granted.push(c.slug); return c; } });
    const photo = join(ws, "me.png"); writeFileSync(photo, Buffer.from("89504e470d0a1a0a", "hex"));
    const created = await local.invoke["characters:create"](ws, "  Ada  ", true, [{ path: photo, name: "me.png" }]) as any;
    assert.equal(created.name, "Ada"); assert.equal(created.state, "pending"); assert.equal(created.refs.length, 1);
    assert.equal(local.invoke["characters:approve"](ws, created.slug), null, "no sheet yet → consent gate refuses");
    writeFileSync(join(created.dir, "sheet.png"), "x");
    const approved = local.invoke["characters:approve"](ws, created.slug) as any;
    assert.equal(approved.state, "approved");
    assert.deepEqual(granted, [created.slug, created.slug]);
    assert.equal(local.invoke["characters:delete"](ws, approved.slug), true);
    const other = await local.invoke["characters:create"](ws, "Bo", false, []) as any;
    assert.equal(local.invoke["characters:discard"](ws, other.slug), true);
    assert.equal(local.invoke["characters:discard"](ws, "../x"), false);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test("quickstart:mark / impression / previewed (L61250-61293) over the shipped catalog: validation + local latency ring, no outbox", async () => {
  const ud = mkdtempSync(join(tmpdir(), "vc-qs-"));
  try {
    const qs = createQuickstartCatalog({ packaged: false, env: {}, resourcesPath: "", appPath: PORT, userData: ud, grant: () => true, push: () => true });
    const cat = await qs.handlers["quickstart:catalog"]() as any;
    const journey = "0b6f3c1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
    qs.handlers["quickstart:mark"]("gallery_ready", 120, journey);
    assert.throws(() => qs.handlers["quickstart:mark"]("nope", 1), /Unknown Quickstart latency stage/);
    qs.handlers["quickstart:impression"](journey, cat.catalogSha256, 140);
    assert.throws(() => qs.handlers["quickstart:impression"](journey, "0".repeat(64), 1), /Invalid Quickstart impression/);
    qs.handlers["quickstart:previewed"](journey, cat.starters[0].id, 90);
    assert.throws(() => qs.handlers["quickstart:previewed"]("bad", cat.starters[0].id, 1), /Invalid Quickstart preview/);
    assert.throws(() => qs.handlers["quickstart:previewed"](journey, "no-such-starter", 1));
    const stages = JSON.stringify(quickstartLatencySnapshot(journey));
    assert.ok(stages.includes("gallery_ready") && stages.includes("preview_ready"), stages);
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test("docs/26: a composer turn is delivered with uuid composerTurnMessageUuid(clientTurnId) (pushInput L23073) — the ORIGINAL renderer's optimistic row id — so history re-fetches do not duplicate the live user bubble", async () => {
  const h = harness();
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, { text: "请记住暗号", clientTurnId: "turn-abc", attachmentIds: [] });
    await until(() => h.host.runtimeInfo(sessionId).status === "idle");
    const expected = composerTurnMessageUuid(sessionId, "turn-abc");
    assert.equal(h.pushed[0].uuid, expected);
    assert.match(expected, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    const side = readDisplayTranscript(displayTranscriptPath(join(h.root, "state"), sessionId));
    assert.equal((side.ordered[0] as any).turnId, expected, "persistDisplayTurn keys the row by the same id");
    const replay = await h.host.getHistory(sessionId);
    assert.equal(replay.filter((e: any) => e.kind === "user_text").length, 1);
    assert.equal((replay.find((e: any) => e.kind === "user_text") as any)?.turnId, expected, "user:<turnId> == renderer displayTurnId");
    // a turn without a composer id (e.g. the approve follow-up) still gets a fresh uuid
    await h.host.sendMessage(sessionId, "follow-up");
    await until(() => h.pushed.length === 2 && h.host.runtimeInfo(sessionId).status === "idle");
    assert.notEqual(h.pushed[1].uuid, expected);
  } finally { await h.host.dispose(); h.cleanup(); }
});
