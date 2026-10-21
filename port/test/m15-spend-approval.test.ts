// docs/32 M15 task 1: the original's raise (capped) and ask_each (per-operation) spend-approval flows —
// authorizeGatewaySpendAtHead (L45860), requestExactSpendChoice (L46853), respondPermission spend branch (L44432),
// setApprovalSpendCeiling (L47213), the policy-change fence — over the real shim spend authority and the verbatim proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHost, type AgentHostRouteService } from "../src/main/agent/agent-host";
import type { EngineSessionDeps } from "../src/main/agent/engine-session";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(10); } }

async function harness() {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-m15s-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "userData"); mkdirSync(ud, { recursive: true });
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => null, monthUsd: 5 });
  await shim.start();
  const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(shim.url, key);
  const cards: any[] = []; const events: any[] = [];
  const service: AgentHostRouteService = { newSessionLlmRoute: () => "minimax" as any, llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("unused"); } } as any;
  const engine: EngineSessionDeps = { workspaceRoot: () => ws, currentEngine: () => null, engineSessionEnv: () => ({}), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "" } as any;
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId: string, event: any) => events.push({ sessionId, event }), sessionsChanged: () => {}, permissionRequest: (r: any) => cards.push(r) } as any,
    service, loadSdk: async () => { throw new Error("unused"); }, sessionsRoot: join(root, "agent-sessions"), engine, persist: () => {}, stateDir: ud,
    registry: { addTrashWorkspace: () => {}, flush: () => true, markRemoved: () => {}, unmarkRemoved: () => {} },
    agentGatewayProxy: () => proxy, gatewaySettings: () => ({ gatewayUrl: shim.url, gatewayKey: key }), operationSweepMs: 0,
  } as any);
  const m = host.createSession({});
  mkdirSync(join(ws, "jobs", "job-s"), { recursive: true });
  host.commitBind((host as any).sessions.get(m.sessionId), "job-s", "test", false);
  const s = (host as any).sessions.get(m.sessionId);
  const quote = (maximumUsd: number) => ({ tool: "model_call", routeMode: "minimax/speech-2.8-turbo", maximumUsd, estimateUsd: maximumUsd });
  const authorize = (maximumUsd: number) => host.authorizeGatewaySpend(s, { jobId: "job-s", method: "POST", path: "/v1/model_call", body: Buffer.from("{}"), quote: quote(maximumUsd) });
  const authority = async () => (await fetch(`${shim.url}/v1/spend-authorities/job-s`, { headers: { authorization: `Bearer ${key}` } })).json() as Promise<any>;
  const nextCard = async (n: number) => { await until(() => cards.length >= n); return cards[n - 1]; };
  return { host, sid: m.sessionId, s, shim, proxy, cards, events, authorize, authority, nextCard, cleanup: async () => { await host.dispose(); proxy.close(); await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("m15 ask_each: leaving Bypass makes the video ask before each paid operation (spendPolicyForMaterialChange); deny / allow once (permit) / always (unlimited)", async () => {
  const h = await harness();
  try {
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).policy, "unlimited_for_video");
    await h.host.setPermissionMode(h.sid, "bypassPermissions");
    await h.host.setPermissionMode(h.sid, "auto");
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).policy, "ask_each");
    assert.equal((await h.authority()).mode, "per_operation");
    // deny
    let p = h.authorize(0.0105);
    let card = await h.nextCard(1);
    assert.deepEqual([card.kind, card.title, card.toolName, card.estimateUsd], ["money", "Allow this paid operation?", "model_call", 0.0105]);
    assert.equal(card.description, "Running a model: up to $0.01."); // formatUsd (verbatim) rounds to cents
    assert.equal(h.host.runtimeInfo(h.sid).status, "awaiting_permission");
    h.host.noteSpendApprovalShown(card.requestId); // permission:shown
    assert.ok(h.host.listPendingInteractions().some((r: any) => r.request.requestId === card.requestId)); // pending:list re-shows it
    h.host.respondPermission(card.requestId, { behavior: "deny" });
    assert.deepEqual(await p, { allowed: false, reason: "Paid work was denied by the user." });
    assert.ok(h.events.some((e) => e.event.kind === "ask_settled" && e.event.record.outcome === "denied"));
    assert.ok(h.events.some((e) => e.event.kind === "permission_resolved" && e.event.requestId === card.requestId));
    // a second answer to the same card is refused
    h.host.respondPermission(card.requestId, { behavior: "allow" });
    // allow once → a one-shot permit (the proxy mints it at the shim)
    p = h.authorize(0.0105);
    card = await h.nextCard(2);
    h.host.respondPermission(card.requestId, { behavior: "allow", spendDecision: "once" });
    const once: any = await p;
    assert.equal(once.allowed, true);
    assert.equal(once.once.maximumApprovedUsd, 0.0105);
    assert.match(once.once.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).policy, "ask_each", "allow once does not change the video's policy");
    // always → unlimited for this video
    p = h.authorize(0.0105);
    card = await h.nextCard(3);
    h.host.respondPermission(card.requestId, { behavior: "allow", spendDecision: "always" });
    const always: any = await p;
    assert.equal(always.allowed, true); assert.equal(always.once, undefined);
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).policy, "unlimited_for_video");
    assert.equal((await h.authority()).mode, "unlimited");
    // now unlimited: no card
    assert.equal(((await h.authorize(0.0105)) as any).allowed, true);
    assert.equal(h.cards.length, 3);
  } finally { await h.cleanup(); }
});

test("m15 raise: a capped video whose remaining budget cannot cover the exact quote shows 'Raise spending limit?'; deny keeps the cap, allow installs exactly the needed ceiling", async () => {
  const h = await harness();
  try {
    await h.host.setSpendCeiling(h.sid, 0.01);
    assert.deepEqual([(await h.authority()).mode, (await h.authority()).ceiling_usd ?? (await h.authority()).ceilingUsd], ["capped", 0.01]);
    let p = h.authorize(0.0105); // rounds up to 2 cents > 1 cent ceiling
    let card = await h.nextCard(1);
    assert.deepEqual([card.kind, card.title, card.budgetUsd, card.budgetCeilingUsd, card.budgetBlockReason], ["budget", "Raise spending limit?", 0.02, 0.01, "over_ceiling"]);
    assert.ok(Math.abs(card.budgetRaiseUsd - 0.01) < 1e-9);
    h.host.respondPermission(card.requestId, { behavior: "deny" });
    assert.deepEqual(await p, { allowed: false, reason: "The spending-limit increase was not approved." });
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).ceilingUsd, 0.01);
    p = h.authorize(0.0105);
    card = await h.nextCard(2);
    h.host.respondPermission(card.requestId, { behavior: "allow", spendDecision: "once", shownBudgetUsd: 0.02 });
    const ok: any = await p;
    assert.equal(ok.allowed, true); assert.ok(ok.reservationId);
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).ceilingUsd, 0.02);
    const a = await h.authority();
    assert.equal(a.mode, "capped");
  } finally { await h.cleanup(); }
});

test("m15 raise card: 'set a budget' on the card (setApprovalSpendCeiling) keeps the waiting operation; a settings edit while a card waits retires it as SPEND_POLICY_CHANGED", async () => {
  const h = await harness();
  try {
    await h.host.setSpendCeiling(h.sid, 0.01);
    let p = h.authorize(0.0105);
    let card = await h.nextCard(1);
    await assert.rejects(h.host.setSpendCeiling(h.sid, 0.01, { approvalRequestId: card.requestId }), /at least \$0\.02/);
    await h.host.setSpendCeiling(h.sid, 0.05, { approvalRequestId: card.requestId });
    const ok: any = await p;
    assert.equal(ok.allowed, true);
    assert.equal((h.host.getSpendSnapshot(h.sid) as any).ceilingUsd, 0.05);
    // policy change while a card waits
    p = h.authorize(0.05);
    card = await h.nextCard(2);
    assert.equal(card.title, "Raise spending limit?");
    await h.host.setSpendCeiling(h.sid, 1);
    const changed: any = await p;
    assert.equal(changed.allowed, false);
    assert.equal(changed.code, "SPEND_POLICY_CHANGED");
    assert.equal(h.host.listPendingInteractions().length, 0);
  } finally { await h.cleanup(); }
});
