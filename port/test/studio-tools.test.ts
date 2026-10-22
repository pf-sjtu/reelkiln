// docs/30 §1: the studio MCP tools (makeStudioToolset L48166 / makeCodexToolset L49503) and the session-plan
// lifecycle (SessionPlanHost, L36986-37530) over the verbatim schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { makeStudioToolset, makeCodexToolset, type StudioToolHost } from "../src/main/studio/studio-toolset";
import { SessionPlanHost, type PlanSession } from "../src/main/studio/session-plan-host";
import { claudeCodeAllowedTools, selfAuthorizingStudioTools, sessionPlanTurnId, SESSION_PLAN_PREAMBLE_PREFIX } from "../src/main/studio/studio-tools.generated";
import { adaptClaudeCodeCanUseTool } from "../src/main/agent/engine-session";
import { appendDisplayTranscript, displayTranscriptPath } from "../src/main/agent/history.generated";

const fakeHost = (over: Partial<StudioToolHost> = {}): StudioToolHost & { inputs: any[] } => {
  const inputs: any[] = [];
  return {
    inputs,
    callSessionPlan: async (_id: string, args: unknown) => ({ ok: true, echo: args }),
    callProjectMemory: async (_m: any, args: unknown) => ({ ok: true, memory: args }),
    saveAccountPreference: (_m: any, a: { text: string }) => ({ ok: true, saved: a.text }),
    readWorkbook: () => ({ ok: false }), readPdf: () => ({ ok: false }),
    requestInput: async (req: any) => { inputs.push(req); return { kind: "cancel", reason: "no" }; },
    noteMaterial: () => {},
    ...over,
  } as any;
};
const fakeSdk = () => {
  const made: any = { tools: [] as any[] };
  return { made, sdk: { tool: (name: string, description: string, shape: any, handler: any) => { const t = { name, description, shape, handler }; made.tools.push(t); return t; }, createSdkMcpServer: (o: any) => { made.server = o; return { type: "sdk", name: o.name, instance: {} }; } } as any };
};

test("studio toolset: 11 tools registered as the original's dynamic specs + one alwaysLoad SDK MCP server named studio", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-studio-")));
  try {
    const { made, sdk } = fakeSdk();
    const t = makeStudioToolset({ sessionId: "s1", cwd: root, clientId: "c1" }, fakeHost(), sdk);
    assert.deepEqual(t.names, ["propose_session_plan", "project_memory", "save_account_preference", "read_workbook", "read_pdf", "get_workflow", "search_workflows", "workflow_advisor", "request_rights_confirmation", "request_voiceover", "request_files"]);
    assert.deepEqual([made.server.name, made.server.version, made.server.alwaysLoad, made.server.tools.length], ["studio", "1.0.0", true, 11]);
    for (const spec of t.dynamicTools) { assert.equal(spec.type, "function"); assert.equal((spec.inputSchema as any).type, "object"); }
    const plan = t.dynamicTools.find((d) => d.name === "propose_session_plan")!;
    assert.deepEqual((plan.inputSchema as any).required.sort(), ["context", "fallback"]);
    assert.deepEqual(await t.call("search_workflows", { query: "x" }), { ok: false, reason: "This session has no pinned Studio Bundle. Continue with the engine router." });
    await assert.rejects(t.call("nope", {}), /Unknown VideoClaw Studio tool/);
    await assert.rejects(t.call("save_account_preference", { text: "  " }), "the zod shape validates the input");
    // every studio tool the SDK may call is allowed (claudeCodeAllowedTools L22956); the self-authorizing ones skip the permission card
    const allowed = claudeCodeAllowedTools();
    for (const n of ["propose_session_plan", "project_memory", "request_rights_confirmation", "request_files", "request_voiceover"]) assert.ok(allowed.includes(`mcp__studio__${n}`), n);
    assert.ok(selfAuthorizingStudioTools.has("mcp__studio__propose_session_plan"));
    const canUse = adaptClaudeCodeCanUseTool(async () => ({ behavior: "deny", message: "delegate" }));
    assert.deepEqual(await canUse("mcp__studio__project_memory", { a: 1 }, {}), { behavior: "allow", updatedInput: { a: 1 } });
    assert.equal((await canUse("Bash", {}, {})).behavior, "deny");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("studio input tools: rights card → receipt; files card copies into the confined dest; Codex dynamic tools route only studio names", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-studio-")));
  try {
    mkdirSync(join(root, "jobs", "j1"), { recursive: true });
    const src = join(realpathSync(mkdtempSync(join(tmpdir(), "vc-src-"))), "clip.mp4"); writeFileSync(src, "fake");
    const noted: any[] = [];
    let answer: any = { kind: "rights", accepted: true };
    const host = fakeHost({ requestInput: async (req) => { (host as any).inputs.push(req); return answer; }, noteMaterial: (_s, a) => noted.push(a) });
    const t = makeStudioToolset({ sessionId: "s1", cwd: root, clientId: "c1" }, host);
    const r: any = await t.call("request_rights_confirmation", { subject: "Ana", purpose: "her voice in the intro" });
    assert.equal(r.confirmed, true); assert.match(r.rights_confirmation, /^rights_[0-9a-f]{32}$/);
    assert.deepEqual((host as any).inputs[0], { sessionId: "s1", kind: "rights", prompt: "Ana\n\nher voice in the intro", destDir: root });
    answer = { kind: "cancel", reason: "User declined" };
    assert.deepEqual(await t.call("request_rights_confirmation", { subject: "Ana", purpose: "p" }), { confirmed: false, reason: "User declined" });
    answer = { kind: "files", paths: [src] };
    const f: any = await t.call("request_files", { description: "your clip", dest_dir: "jobs/j1" });
    assert.equal(f.count, 1); assert.ok(existsSync(f.saved[0]) && f.saved[0].startsWith(join(root, "jobs", "j1")));
    assert.equal(readFileSync(f.saved[0], "utf8"), "fake"); assert.equal(noted[0].origin, "studio-files");
    await assert.rejects(t.call("request_files", { description: "x", dest_dir: "../outside" }));
    const codex = makeCodexToolset(t);
    assert.equal(codex.dynamicTools.length, 11);
    assert.deepEqual(await codex.call({ tool: "save_account_preference", arguments: { text: "short videos" } }), { ok: true, saved: "short videos" });
    await assert.rejects(codex.call({ tool: "Bash", arguments: {} }), /Unknown VideoClaw tool/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function planHarness() {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "vc-plan-")));
  const sessionId = randomUUID();
  const s: PlanSession = { meta: { sessionId, clientId: "client-1", cwd: stateDir, jobId: "job_20261021_a1", permissionMode: "auto" }, runtime: { dead: false }, sessionPlanRequired: true };
  const emitted: any[] = []; const sent: any[] = []; let flushes = 0;
  const accepted = new Set<string>();
  const host = new SessionPlanHost({
    stateDir, session: (id) => (id === sessionId ? s : undefined), isLive: () => true,
    memoryBinding: () => ({ gatewayUrl: "http://127.0.0.1:8787/", canonicalKeyId: "a".repeat(64) }),
    verifiedMemorySource: async () => ({ available: false }), flushRegistry: () => { flushes++; return true; },
    sendMessage: async (_id, req) => { sent.push(req); accepted.add(req.clientTurnId); return { submitted: true }; },
    spendSnapshot: () => ({ spentUsd: 0.01, reservedUsd: 0 }), requestWitness: () => () => true,
    turnAccepted: (_id, t) => accepted.has(t), emitSessionPlanChanged: (p) => emitted.push(p), isComposerDeliveryError: () => false,
  });
  const userTurn = (text: string) => { const turnId = randomUUID(); (appendDisplayTranscript as any)(displayTranscriptPath(stateDir, sessionId), text, [text], turnId); s.lastUserTurnId = turnId; return turnId; };
  return { stateDir, sessionId, s, host, emitted, sent, flushes: () => flushes, userTurn, cleanup: () => rmSync(stateDir, { recursive: true, force: true }) };
}
const proposal = { context: "A 10s coffee pour teaser.", fallback: { title: "Coffee pour", text: "Three close shots of a pour.", canvas: { width: 1080, height: 1920 }, shots: [{ description: "Beans close-up", label: "Beans" }, { description: "Pour", seconds: 4 }] } };

test("session plan: propose (bound to job + account, awaiting decision) → Build it dispatches the original plan turn → accepted; production refusal lifts only then", async () => {
  const h = planHarness();
  try {
    assert.equal(h.host.sessionPlanProductionRefusal(h.sessionId), undefined, "no plan yet: nothing to refuse");
    const ctx = h.host.sessionPlanTurnContext(h.s, "t");
    assert.ok(ctx.startsWith(SESSION_PLAN_PREAMBLE_PREFIX), "new sessions carry the plan preamble (L41666)");
    h.userTurn("Make a coffee teaser");
    const r = await h.host.callSessionPlan(h.sessionId, proposal);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.plan.phase, "awaiting-decision"); assert.equal(r.plan.revision, 1); assert.equal(r.plan.shots.length, 2);
    assert.equal(h.emitted.length, 1); assert.deepEqual(h.emitted[0].scope, { sessionId: h.sessionId, gatewayUrl: "http://127.0.0.1:8787", canonicalKeyId: "a".repeat(64) });
    assert.match(h.host.sessionPlanProductionRefusal(h.sessionId)!, /waiting for the user’s choice/);
    assert.equal((await h.host.callSessionPlan(h.sessionId, proposal)).ok, false, "a second proposal for the same brief waits for a real choice");
    const fields: any = h.host.registryFields(h.s);
    assert.equal(fields.sessionPlanRequired, true); assert.equal(fields.sessionPlan.id, r.plan.id);
    const view = await h.host.chooseSessionPlan(h.sessionId, { planId: r.plan.id, revision: 1, action: "build", clientActionId: "act-1" });
    assert.equal(view.phase, "accepted");
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].clientTurnId, sessionPlanTurnId(h.s.sessionPlan));
    assert.equal(h.host.sessionPlanProductionRefusal(h.sessionId), undefined);
    assert.match(h.host.sessionPlanTurnContext(h.s, h.sent[0].clientTurnId), /chose Build it/);
    // restore from the registry row (restoredSessionPlan L36986)
    const restored = h.host.restoredSessionPlan({ sessionId: h.sessionId, ...JSON.parse(JSON.stringify(h.host.registryFields(h.s))) });
    assert.equal(restored.sessionPlan.phase, "accepted"); assert.equal(restored.sessionPlanRequired, true);
  } finally { h.cleanup(); }
});

test("session plan: invalid args explain themselves; no job → SESSION_PLAN_JOB_MISSING; failed dispatch persists and Retry re-sends the same choice", async () => {
  const h = planHarness();
  try {
    h.userTurn("brief");
    const bad = await h.host.callSessionPlan(h.sessionId, { context: "x", fallback: "nope" });
    assert.equal(bad.ok, false); assert.match(bad.message, /Supply fallback as a separate JSON object/);
    const jobless = { ...h.s, meta: { ...h.s.meta, jobId: undefined } };
    const h2 = new SessionPlanHost({ ...(h.host as any).d, session: () => jobless });
    assert.equal((await h2.callSessionPlan(h.sessionId, proposal)).ok, false);
    const r = await h.host.callSessionPlan(h.sessionId, proposal);
    let fail = true;
    (h.host as any).d.sendMessage = async (_id: string, req: any) => { if (fail) throw new Error("runtime down"); h.sent.push(req); return {}; };
    await assert.rejects(h.host.chooseSessionPlan(h.sessionId, { planId: r.plan.id, revision: 1, action: "build", clientActionId: "act-2" }), /could not start/);
    assert.equal(h.s.sessionPlan.phase, "failed");
    fail = false;
    const retried = await h.host.retrySessionPlan(h.sessionId);
    assert.equal(retried.phase, "accepted"); assert.equal(h.sent.length, 1);
    const dismissed = h.host.restoredSessionPlan({ sessionId: h.sessionId, sessionPlan: { broken: true } });
    assert.equal(dismissed.sessionPlan, null, "an unreadable saved plan restores as null (recovery)");
  } finally { h.cleanup(); }
});
