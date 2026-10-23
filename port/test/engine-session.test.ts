// docs/21: AgentHost ENGINE sessions (session → engine wiring, original permission model, job
// binding, sessions.json persistence/restore) with the SDK boundary mocked, plus the M1 home-boot
// handlers and renderer selection. The real L1 run is in artifacts/phase-b-L1 (not a unit test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AgentHost, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import { engineTurnText, firstMessageJobId, sessionPolicyPreamble, sniffJobIds, claudeCodeDisallowedTools, engineChildEnv, type EngineSessionDeps } from "../src/main/agent/engine-session";
import { SessionRegistry } from "../src/main/engine/session";
import { accountSnapshot, bootstrapStatus, replayPendingInteractions, workflowSubmitEligibility } from "../src/main/home-boot";
import { resolveRendererEntry } from "../src/main/renderer-entry";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 2000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(5); } }

class FakeQuery {
  closed = false; turns: string[] = [];
  private outQ: Array<Record<string, any>> = []; private wake: (() => void) | null = null;
  constructor(public readonly prompt: AsyncIterable<any>, public readonly options: any, script: (text: string, q: FakeQuery) => AsyncGenerator<Record<string, any>>) {
    void (async () => { for await (const m of prompt) { const text = m?.message?.content?.[0]?.text ?? ""; this.turns.push(text); for await (const out of script(text, this)) { if (this.closed) return; this.push(out); } } })();
  }
  push(m: Record<string, any>) { this.outQ.push(m); this.wake?.(); this.wake = null; }
  async interrupt() {}
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *[Symbol.asyncIterator]() { while (!this.closed) { const m = this.outQ.shift(); if (m) { yield m; continue; } await new Promise<void>((r) => { this.wake = r; }); } }
}
const result = { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0 };

function engineHarness(o: { script?: (text: string, q: FakeQuery) => AsyncGenerator<Record<string, any>>; engineEnv?: Record<string, string>; maxTurns?: number; turnTimeoutMs?: number } = {}) {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-engsess-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const events: Array<{ sessionId: string; event: SessionEvent }> = [];
  const perms: any[] = []; const persisted: any[][] = []; const queries: FakeQuery[] = [];
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => "minimax" as any,
    llmRouteReadiness: async (m) => ({ route: m?.llmRoute, ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "MiniMax-M3.1-Flash", env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_AUTH_TOKEN: "vcgp_session_token", PATH: "/route/path" }, close: async () => {} }),
  };
  const engine: EngineSessionDeps = {
    workspaceRoot: () => ws,
    currentEngine: () => ({ path: join(root, "engine"), version: "0.1.57-test" }),
    // no VIDEOCLAW_ENGINE → legacyDevSessionContext branch (no engine files needed in a unit test)
    engineSessionEnv: () => ({ VIDEOCLAW_FINAL_QA_AUTHORITY: "videoclaw.app-final-qa/v1", VIDEOCLAW_CONTEXT_EPOCH: `epoch-${Math.random()}`, PATH: "/engine/path", ...(o.engineEnv ?? {}) }),
    assertProductionContract: () => {},
    isPackaged: false,
    projectBrief: () => "",
  };
  const script = o.script ?? (async function* () { yield { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } }; yield result; });
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: () => {}, permissionRequest: (r) => perms.push(r) },
    service,
    loadSdk: async () => ({ sdk: { query: ({ prompt, options }: any) => { const q = new FakeQuery(prompt, options, script); queries.push(q); return q as any; } }, executable: "/x/claude" }),
    sessionsRoot: join(root, "agent-sessions"),
    engine,
    persist: (rows) => persisted.push(rows),
    ...(o.maxTurns !== undefined ? { maxTurns: o.maxTurns } : {}),
    ...(o.turnTimeoutMs !== undefined ? { turnTimeoutMs: o.turnTimeoutMs } : {}),
  });
  return { host, root, ws, events, perms, persisted, queries, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("first-message job id (submitPreparedMessage L41559-41600): deterministic, minted once, turn text = session policy + APP-OWNED PRODUCTION ID", () => {
  const meta = { sessionId: "s-1", cwd: "/w", clientId: "personal", permissionMode: "auto", createdAt: 1_700_000_000_000 };
  const id = firstMessageJobId(meta, "make a 6.5 s vertical cut")!;
  assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.equal(firstMessageJobId(meta, "make a 6.5 s vertical cut"), id);
  assert.equal(firstMessageJobId({ ...meta, jobId: id }, "again"), undefined);
  const text = engineTurnText({ ...meta, jobId: id }, "BRIEF");
  assert.ok(text.startsWith(sessionPolicyPreamble(meta)));
  assert.match(text, /\[APP-OWNED SESSION POLICY — authoritative revision 0\]/);
  assert.match(text, /"mode":"unlimited_for_video"/);
  assert.match(text, new RegExp(`\\[APP-OWNED PRODUCTION ID — authoritative\\]\\nThis video is already bound to the bare id "${id}"`));
  assert.ok(text.endsWith("\n\nBRIEF"));
  assert.deepEqual(sniffJobIds('{"command":"python x.py --job a && ls jobs/abc-1/final.mp4 jobs/abc-1 jobs/../x"}'), ["abc-1"]);
  assert.ok(claudeCodeDisallowedTools().includes("Task") && claudeCodeDisallowedTools().includes("EnterPlanMode"));
  const env = engineChildEnv({ ANTHROPIC_AUTH_TOKEN: "t", PATH: "/r" }, { PATH: "/e", VIDEOCLAW_ENGINE: "/eng" }, true);
  assert.equal(env.PATH, "/e"); assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, "videoclaw-app/0.0.1"); assert.equal(env.VIDEOCLAW_LAWS_VIA_APPEND, "1"); assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, "0");
});

test("AgentHost ENGINE session: workspace cwd, first message binds + mkdirs the job and persists it, createLocalRuntime-shaped options, policy-prefixed turn", async () => {
  const h = engineHarness();
  try {
    const meta = h.host.createSession({});
    assert.equal(meta.cwd, h.ws);
    assert.equal(meta.permissionMode, "auto");
    assert.equal(h.persisted.length, 1);
    await h.host.sendMessage(meta.sessionId, { text: "make the S1 cut", clientTurnId: "t1" });
    await until(() => h.events.some((e) => e.event.kind === "result"));
    const s = h.host.listSessions()[0];
    assert.ok(s.jobId && existsSync(join(h.ws, "jobs", s.jobId)), "job dir minted");
    const rows = h.persisted.at(-1)!;
    assert.equal(rows[0].jobId, s.jobId);
    assert.ok(!("portAgentHost" in rows[0]) && !("liveWork" in rows[0]), "sessions.json rows carry no live/port fields");
    assert.match(String(rows[0].contextEpoch), /^epoch-/);
    const q = h.queries[0];
    const opt = q.options;
    assert.equal(opt.cwd, h.ws);
    assert.deepEqual(opt.settingSources, ["project"]);
    assert.equal(opt.strictMcpConfig, true);
    assert.deepEqual(opt.mcpServers, {});
    assert.equal(opt.permissionMode, "auto");
    assert.equal(opt.tools, undefined, "Bash is open (no read-only whitelist)");
    assert.ok(opt.disallowedTools.includes("Task") && opt.disallowedTools.includes("Agent"));
    assert.equal(opt.systemPrompt.type, "preset"); assert.equal(opt.systemPrompt.preset, "claude_code");
    assert.ok(typeof opt.systemPrompt.append === "string" && opt.systemPrompt.append.length > 100);
    assert.equal(opt.env.VIDEOCLAW_BOUND_JOB, s.jobId);
    assert.equal(opt.env.ANTHROPIC_AUTH_TOKEN, "vcgp_session_token");
    assert.equal(opt.env.PATH, "/engine/path");
    assert.equal(opt.env.VIDEOCLAW_LAWS_VIA_APPEND, undefined, "legacy (unassembled) context → no laws-via-append switch");
    assert.equal(typeof opt.canUseTool, "function");
    assert.ok(Array.isArray(opt.hooks.PreToolUse) && opt.hooks.PreToolUse.some((m: any) => m.matcher === "Bash"));
    assert.equal(opt.allowDangerouslySkipPermissions, undefined);
    assert.ok(q.turns[0].startsWith("[APP-OWNED SESSION POLICY"));
    assert.match(q.turns[0], new RegExp(`bound to the bare id "${s.jobId}"`));
    assert.ok(q.turns[0].endsWith("make the S1 cut"));
    // a second turn keeps the id and the same pinned context epoch
    await h.host.sendMessage(meta.sessionId, { text: "again", clientTurnId: "t2" });
    await until(() => h.events.filter((e) => e.event.kind === "result").length === 2);
    assert.equal(h.host.listSessions()[0].jobId, s.jobId);
  } finally { h.cleanup(); }
});

test("AgentHost ENGINE: Hooks deny Task/Agent; Bash app-owned final render is refused by the original appOwnedVideoCommandRefusal; plan-mode tools redirected", async () => {
  const h = engineHarness();
  try {
    const meta = h.host.createSession({});
    await h.host.sendMessage(meta.sessionId, "go");
    await until(() => h.events.some((e) => e.event.kind === "result"));
    const opt = h.queries[0].options;
    const task = await opt.hooks.PreToolUse.find((m: any) => m.matcher === "Task").hooks[0]({});
    assert.equal(task.hookSpecificOutput.permissionDecision, "deny");
    const plan = await opt.canUseTool("EnterPlanMode", {}, {});
    assert.equal(plan.behavior, "deny");
  } finally { h.cleanup(); }
});

test("AgentHost ENGINE: permission card round-trip (canUseTool → permission:request → respondPermission) + replay + abort on Stop", async () => {
  const h = engineHarness();
  try {
    const meta = h.host.createSession({});
    await h.host.sendMessage(meta.sessionId, "go");
    await until(() => h.events.some((e) => e.event.kind === "result"));
    const opt = h.queries[0].options;
    // a non-Bash write tool → ordinary permission card
    const p = opt.canUseTool("Write", { file_path: join(h.ws, "x.txt"), content: "x" }, { toolUseID: "tu1", requestId: "req-1" });
    await until(() => h.perms.length === 1);
    assert.equal(h.perms[0].kind, "permission"); assert.equal(h.perms[0].requestId, "req-1"); assert.equal(h.perms[0].sessionId, meta.sessionId);
    assert.equal(h.host.listSessions()[0].status, "awaiting_permission");
    const pushed: any[] = []; replayPendingInteractions(h.host.listPendingInteractions(), (ch, r) => pushed.push([ch, (r as any).requestId]));
    assert.deepEqual(pushed, [["permission:request", "req-1"]]);
    h.host.respondPermission("req-1", { behavior: "allow" });
    const r = await p;
    assert.equal(r.behavior, "allow"); assert.deepEqual((r as any).updatedInput, { file_path: join(h.ws, "x.txt"), content: "x" });
    assert.ok(h.events.some((e) => e.event.kind === "permission_resolved"));
    assert.equal(h.host.listPendingInteractions().length, 0);
    // deny
    const p2 = opt.canUseTool("Write", { file_path: "y" }, { requestId: "req-2" });
    await until(() => h.perms.length === 2);
    h.host.respondPermission("req-2", { behavior: "deny", message: "no" });
    assert.equal((await p2).behavior, "deny");
    // question kind
    const p3 = opt.canUseTool("AskUserQuestion", { questions: [{ question: "Which?" }] }, { requestId: "req-3" });
    await until(() => h.perms.length === 3);
    assert.equal(h.perms[2].kind, "question");
    // original renderer answerQuestion (L40098) sends behavior "answers" (+ selections) — main L37581 → allow
    h.host.respondPermission("req-3", { behavior: "answers", answers: { "Which?": "A" }, selections: { "Which?": { chosen: ["A"] } } });
    const r3 = (await p3) as any;
    assert.equal(r3.behavior, "allow");
    assert.deepEqual(r3.updatedInput, { questions: [{ question: "Which?" }], answers: { "Which?": "A" } });
    // the question card's ✕ (dismissQuestion) denies with its own message; a bare deny gets the original default
    const p3b = opt.canUseTool("AskUserQuestion", { questions: [{ question: "Again?" }] }, { requestId: "req-3b" });
    await until(() => h.perms.length === 4);
    h.host.respondPermission("req-3b", { behavior: "deny" });
    assert.deepEqual(await p3b, { behavior: "deny", message: "Denied by user" });
    // pending card aborted by Stop
    const p4 = opt.canUseTool("Write", { file_path: "z" }, { requestId: "req-4" });
    await until(() => h.perms.length === 5);
    await h.host.interrupt(meta.sessionId, "stop");
    assert.equal((await p4).behavior, "deny");
    assert.equal(h.host.listPendingInteractions().length, 0);
  } finally { h.cleanup(); }
});

test("AgentHost ENGINE: continue-intent first message does not mint; a NEW jobs/<id> named in a tool_use binds (maybeBindJob), a pre-existing one never does", async () => {
  let step = 0;
  const h = engineHarness({ script: async function* (_t, _q) {
    step++;
    yield { type: "assistant", message: { id: `m${step}`, content: [{ type: "tool_use", id: `tu${step}`, name: "Bash", input: { command: step === 1 ? "ls jobs/old-job" : "ls jobs/new-job" } }] } };
    yield result;
  } });
  try {
    mkdirSync(join(h.ws, "jobs", "old-job"));
    const meta = h.host.createSession({});
    await h.host.sendMessage(meta.sessionId, "continue the previous video");
    await until(() => h.events.some((e) => e.event.kind === "result"));
    assert.equal(h.host.listSessions()[0].jobId, undefined, "pre-existing job not adopted");
    mkdirSync(join(h.ws, "jobs", "new-job"));
    await h.host.sendMessage(meta.sessionId, "continue the previous video");
    await until(() => h.events.filter((e) => e.event.kind === "result").length === 2);
    assert.equal(h.host.listSessions()[0].jobId, "new-job");
  } finally { h.cleanup(); }
});

test("sessions.json: writeRegistry merge-with-disk (foreign rows + clients carried), load → takeSessions → AgentHost.restoreSessions (status healed idle)", () => {
  const root = mkdtempSync(join(tmpdir(), "vc-reg-"));
  try {
    const file = join(root, "sessions.json");
    writeFileSync(file, JSON.stringify({ clients: [{ clientId: "humeo", name: "Humeo" }], sessions: [{ sessionId: "foreign", cwd: root, clientId: "personal", status: "idle", createdAt: 1 }] }));
    const reg = new SessionRegistry(file);
    reg.load();
    reg.takeSessions();
    const mine = { sessionId: "mine", cwd: root, clientId: "personal", status: "running", createdAt: 2, jobId: "j1", contextEpoch: "e1" };
    mkdirSync(join(root, "jobs", "j1"), { recursive: true });
    assert.equal(reg.writeRegistry([mine]), true);
    const disk = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(disk.sessions.map((s: any) => s.sessionId), ["mine", "foreign"]);
    assert.deepEqual(disk.clients.map((c: any) => c.clientId), ["humeo"]);
    const reg2 = new SessionRegistry(file); reg2.load();
    const rows = reg2.takeSessions();
    assert.equal(reg2.listSessions().length, 0);
    setLoggerForTests(createLogger({ level: "silent" }));
    const host = new AgentHost({ emit: { sessionEvent: () => {}, sessionsChanged: () => {} }, service: {} as any, loadSdk: async () => { throw new Error("x"); }, sessionsRoot: root });
    assert.equal(host.restoreSessions(rows as any), 2);
    const m = host.listSessions().find((s) => s.sessionId === "mine")!;
    assert.equal(m.status, "idle"); assert.equal(m.jobId, "j1"); assert.equal((m as any).interruptedFromStatus, "running");
    assert.equal(host.registryRows().find((r) => r.sessionId === "mine")!.contextEpoch, undefined, "loadRegistry strips contextEpoch from the public meta");
    // createClient (L36346) + projectNameError (L288)
    const saved: number[] = [];
    assert.deepEqual(reg2.createClient("My Brand!", () => saved.push(1)), { clientId: "my-brand-", name: "My Brand!" });
    assert.throws(() => reg2.createClient("  ", () => {}), /Enter a project name/);
    assert.throws(() => reg2.createClient("humeo", () => {}), /already uses that name/);
    assert.equal(saved.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("M1 home boot: account snapshot (local studio default / honest signed-out with the gate on), eligibility, bootstrap status, renderer entry", () => {
  const a = accountSnapshot({ env: {} });
  assert.equal(a.step, "ready"); assert.equal(a.legacyKeyOnly, true); assert.equal(a.signedIn, false); assert.equal(a.account, null);
  assert.equal(a.bundledTermsVersion, "alpha-2026-08-17"); assert.equal(a.canAcceptTerms, false); assert.equal((a as any).portLocalStudio, true);
  const gated = accountSnapshot({ env: { VIDEOCLAW_PORT_ACCOUNT_GATE: "1" } });
  assert.equal(gated.step, "signed-out"); assert.equal(gated.hasStoredKey, false); assert.equal(gated.signInAvailable, false);
  assert.deepEqual(workflowSubmitEligibility(), { eligible: false, githubUsername: null, workflowsRepo: "", configured: false });
  const core = { status: () => ({ ready: false, engineVersion: "0.1.57", enginePath: "/e", workspacePath: "/w", doctor: undefined, packaged: false }), currentEngine: () => ({ path: "/nonexistent-engine", version: "0.1.57", buildSha256: "ab" }) };
  const st = bootstrapStatus(core, { packaged: false, env: {}, productionCompatible: () => true });
  assert.equal(st.shouldOffer, false); assert.equal(st.devMode, true); assert.equal(st.managedDevelopment, false); assert.equal(st.engineUpdate, "unknown");
  assert.deepEqual(st.studioBundle, { state: "disabled" }); assert.deepEqual(st.engineIdentity, { buildSha256: "ab" });
  assert.equal(bootstrapStatus({ ...core, currentEngine: () => null }, { packaged: true, env: {}, productionCompatible: () => true }).shouldOffer, true);
  const base = { packaged: false, appPath: "/repo/port", resourcesPath: "/res", mainDir: "/repo/port/dist/main", exists: () => true };
  assert.equal(resolveRendererEntry({ ...base, env: {} }).url, pathToFileURL(join("/repo", "app", "out", "renderer", "index.html")).href); // "file:///C:/repo/…" on Windows
  assert.equal(resolveRendererEntry({ ...base, env: {}, packaged: true }).url, pathToFileURL(join("/res", "renderer-original", "index.html")).href);
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_RENDERER: "port" } }).kind, "port");
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_SMOKE: "1" } }).kind, "port", "legacy smoke keeps the port page");
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_SMOKE: "1", VIDEOCLAW_PORT_SMOKE_HOME: "1" } }).kind, "original");
  assert.equal(resolveRendererEntry({ ...base, env: {}, exists: () => false }).kind, "port");
  assert.equal(resolveRendererEntry({ ...base, env: { ELECTRON_RENDERER_URL: "http://x" } }).url, "http://x");
});

test("docs/43: an ENGINE turn has no wall-clock limit and no maxTurns by default (the original sets neither); both stay opt-in", async () => {
  const hang = async function* () { yield { type: "system", subtype: "init", model: "MiniMax-M3.1-Flash" }; await new Promise(() => {}); };
  const h = engineHarness({ script: hang });
  try {
    const meta = h.host.createSession({});
    await h.host.sendMessage(meta.sessionId, "long production");
    await until(() => h.queries.length === 1);
    assert.equal("maxTurns" in h.queries[0].options, false, "no maxTurns on the engine query (original parity)");
    const s: any = (h.host as any).sessions.get(meta.sessionId);
    assert.equal(s.turnTimer, undefined, "no per-turn wall-clock timer");
    assert.equal(h.host.listSessions()[0].status, "running");
  } finally { await h.host.dispose(); h.cleanup(); }
  const o = engineHarness({ script: hang, maxTurns: 7, turnTimeoutMs: 40 });
  try {
    const meta = o.host.createSession({});
    await o.host.sendMessage(meta.sessionId, "bounded test turn");
    await until(() => o.queries.length === 1);
    assert.equal(o.queries[0].options.maxTurns, 7, "explicit opt-in bound is passed through");
    await until(() => o.events.some((e) => e.event.kind === "error"));
    assert.match((o.events.find((e) => e.event.kind === "error")!.event as any).message, /did not finish within 0 s/);
    assert.equal(o.host.listSessions()[0].status, "error");
  } finally { await o.host.dispose(); o.cleanup(); }
});
