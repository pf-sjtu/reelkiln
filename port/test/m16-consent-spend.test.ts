// docs/33 M16 T4: AlphaConsentCoordinator (L5221, verbatim slice) and materializeGatewaySpendPolicy /
// putGatewaySpendPolicy / writeGatewaySpendPolicy (L47055-47155) with the adopted-job reset mark (L47920, L35785).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlphaConsentCoordinator, activeAlphaConsentAt, activeAlphaConsentComplete, alphaConsentKeyId } from "../src/main/account/alpha-consent.generated";
import { AgentHost, type AgentHostRouteService } from "../src/main/agent/agent-host";
import type { EngineSessionDeps } from "../src/main/agent/engine-session";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";

const GW = "http://127.0.0.1:47733/";
function consentHarness(over: Record<string, unknown> = {}) {
  let value: any = { gatewayUrl: GW, gatewayKey: " vc_key_1 ", telemetry: true, alphaConsentsByKey: {}, ...over };
  const writes: any[] = [];
  const settings = { get: () => value, patchDurable: (u: any) => { writes.push(u); value = { ...value, ...u }; return value; } };
  const beacons: any[] = []; let fail = false; let t = 1_790_000_000_000;
  const c: any = new AlphaConsentCoordinator(settings, async (b: any) => { if (fail) throw new Error("disk full"); beacons.push(b); }, () => ++t);
  const keyId = alphaConsentKeyId("vc_key_1", GW);
  return { c, settings, writes, beacons, keyId, setFail: (f: boolean) => { fail = f; }, verified: { ok: true, gatewayUrl: "http://127.0.0.1:47733", keyId } };
}

test("AlphaConsentCoordinator: a verified active key gets one consent record + one durable alpha-consent beacon; alphaConsentAt only after the beacon is queued", async () => {
  const h = consentHarness();
  assert.equal(activeAlphaConsentAt(h.settings.get()), undefined);
  const next = await h.c.ensureVerifiedActiveKey(h.verified);
  const rec = next.alphaConsentsByKey[h.keyId];
  assert.ok(rec.acceptedAt > 0 && rec.beaconQueuedAt > rec.acceptedAt);
  assert.equal(h.beacons.length, 1);
  assert.deepEqual(Object.keys(h.beacons[0]).sort(), ["detail", "durable", "kind", "outboxId", "scopeGatewayUrl", "scopeKeyId"]);
  assert.equal(h.beacons[0].kind, "alpha-consent"); assert.equal(h.beacons[0].outboxId, `alpha-consent:${h.keyId}`);
  assert.equal(h.beacons[0].scopeGatewayUrl, "http://127.0.0.1:47733");
  assert.equal(h.beacons[0].detail, `consent_id=${h.keyId}; accepted_at=${new Date(rec.acceptedAt).toISOString()}`);
  assert.equal(activeAlphaConsentAt(next), rec.acceptedAt); assert.equal(activeAlphaConsentComplete(next), true);
  await h.c.ensureVerifiedActiveKey(h.verified);
  assert.equal(h.beacons.length, 1, "idempotent once complete"); assert.equal(h.writes.length, 2);
});

test("AlphaConsentCoordinator: telemetry off / another key / another gateway → nothing; a failed beacon keeps the record un-queued and retries", async () => {
  const off = consentHarness({ telemetry: false });
  await off.c.ensureVerifiedActiveKey(off.verified); assert.equal(off.writes.length, 0);
  const other = consentHarness();
  await other.c.ensureVerifiedActiveKey({ ...other.verified, keyId: alphaConsentKeyId("vc_other", GW) }); assert.equal(other.writes.length, 0);
  await other.c.ensureVerifiedActiveKey({ ...other.verified, gatewayUrl: "https://elsewhere" }); assert.equal(other.writes.length, 0);
  const h = consentHarness(); h.setFail(true);
  await assert.rejects(h.c.ensureVerifiedActiveKey(h.verified), /disk full/);
  const rec = h.settings.get().alphaConsentsByKey[h.keyId];
  assert.ok(rec.acceptedAt > 0 && rec.beaconQueuedAt === undefined); assert.equal(activeAlphaConsentAt(h.settings.get()), undefined);
  h.setFail(false);
  const next = await h.c.ensureVerifiedActiveKey(h.verified); // the serial chain recovered from the failure
  assert.equal(next.alphaConsentsByKey[h.keyId].acceptedAt, rec.acceptedAt, "the original acceptance time is kept");
  assert.equal(h.beacons.length, 1);
});

async function hostHarness() {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-m16t4-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs", "job-s"), { recursive: true });
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => null, monthUsd: 5 });
  await shim.start();
  const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(shim.url, key);
  const service: AgentHostRouteService = { newSessionLlmRoute: () => "minimax" as any, llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("unused"); } } as any;
  const engine: EngineSessionDeps = { workspaceRoot: () => ws, currentEngine: () => null, engineSessionEnv: () => ({}), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "" } as any;
  const host: any = new AgentHost({
    emit: { sessionEvent: () => {}, sessionsChanged: () => {}, permissionRequest: () => {} } as any,
    service, loadSdk: async () => { throw new Error("unused"); }, sessionsRoot: join(root, "agent-sessions"), engine, persist: () => {}, stateDir: join(root, "ud"),
    registry: { addTrashWorkspace: () => {}, flush: () => true, markRemoved: () => {}, unmarkRemoved: () => {} },
    agentGatewayProxy: () => proxy, gatewaySettings: () => ({ gatewayUrl: shim.url, gatewayKey: key }), operationSweepMs: 0,
  } as any);
  const m = host.createSession({});
  host.commitBind(host.sessions.get(m.sessionId), "job-s", "test", false);
  const s = host.sessions.get(m.sessionId);
  const authority = async () => (await fetch(`${shim.url}/v1/spend-authorities/job-s`, { headers: { authorization: `Bearer ${key}` } })).json() as Promise<any>;
  return { host, s, sid: m.sessionId, authority, cleanup: async () => { await host.dispose(); proxy.close(); await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("materializeGatewaySpendPolicy: writes the saved policy once per key (through the real proxy → shim authority), again after a change", async () => {
  const h = await hostHarness();
  try {
    await h.host.materializeGatewaySpendPolicy(h.s);
    assert.equal((await h.authority()).mode, "unlimited");
    const writes: any[] = []; h.host.gatewaySpendPolicyWriter = async (j: string, p: any) => { writes.push([j, p]); };
    await h.host.materializeGatewaySpendPolicy(h.s);
    assert.equal(writes.length, 0, "already materialized for job-s:unlimited_for_video");
    h.host.spendBudgets.setCeiling(h.sid, 2.5);
    await h.host.materializeGatewaySpendPolicy(h.s);
    assert.deepEqual(writes, [["job-s", { kind: "capped", ceilingUsd: 2.5 }]]);
    await h.host.materializeGatewaySpendPolicy(h.s); assert.equal(writes.length, 1);
  } finally { await h.cleanup(); }
});

test("adopted job (gatewaySpendPolicyResetJobId): always re-written, mark cleared on success, kept on failure; restore heals stale marks", async () => {
  const h = await hostHarness();
  try {
    await h.host.materializeGatewaySpendPolicy(h.s);
    const writes: any[] = []; let fail = true;
    h.host.gatewaySpendPolicyWriter = async (j: string, p: any) => { if (fail) throw new Error("HTTP 503"); writes.push([j, p]); };
    h.s.meta.gatewaySpendPolicyResetJobId = "job-s";
    await assert.rejects(h.host.materializeGatewaySpendPolicy(h.s), /HTTP 503/);
    assert.equal(h.s.meta.gatewaySpendPolicyResetJobId, "job-s", "kept until the gateway accepts");
    fail = false;
    await h.host.materializeGatewaySpendPolicy(h.s);
    assert.deepEqual(writes, [["job-s", { kind: "unlimited_for_video" }]]);
    assert.equal(h.s.meta.gatewaySpendPolicyResetJobId, undefined);
    // an ask_each video skips materialization in prepareSpend — unless its job was just adopted
    h.host.spendBudgets.setAskEach(h.sid); h.host.materializedSpendPolicies.clear();
    const policy = h.host.agentGatewayPolicy(h.s);
    await policy.prepareSpend("job-s", new AbortController().signal); assert.equal(writes.length, 1);
    h.s.meta.gatewaySpendPolicyResetJobId = "job-s";
    await policy.prepareSpend("job-s", new AbortController().signal);
    assert.deepEqual(writes.at(-1), ["job-s", { kind: "ask_each" }]); assert.equal(h.s.meta.gatewaySpendPolicyResetJobId, undefined);
    // loadRegistry healing (L35785)
    const n = h.host.restoreSessions([
      { sessionId: "r1", cwd: "/tmp", title: "a", jobId: "job-a", gatewaySpendPolicyResetJobId: "job-b", createdAt: 1 },
      { sessionId: "r2", cwd: "/tmp", title: "b", jobId: "job-c", gatewaySpendPolicyResetJobId: "job-c", createdAt: 1 },
      { sessionId: "r3", cwd: "/tmp", title: "c", jobId: "../x", gatewaySpendPolicyResetJobId: "../x", createdAt: 1 },
    ]);
    assert.equal(n, 3);
    assert.equal(h.host.sessions.get("r1").meta.gatewaySpendPolicyResetJobId, undefined);
    assert.equal(h.host.sessions.get("r2").meta.gatewaySpendPolicyResetJobId, "job-c");
    assert.equal(h.host.sessions.get("r3").meta.gatewaySpendPolicyResetJobId, undefined);
  } finally { await h.cleanup(); }
});

test("putGatewaySpendPolicy: writes for one job are serialized and invalidate that job's materialized keys", async () => {
  const h = await hostHarness();
  try {
    const order: string[] = []; let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    h.host.gatewaySpendPolicyWriter = async (_j: string, p: any) => { order.push(`start:${p.kind}`); if (p.kind === "capped") await gate; order.push(`end:${p.kind}`); };
    h.host.materializedSpendPolicies.set(h.sid, "job-s:unlimited_for_video:"); h.host.materializedSpendPolicies.set("other", "job-t:capped:1");
    const a = h.host.putGatewaySpendPolicy("job-s", { kind: "capped", ceilingUsd: 1 });
    const b = h.host.putGatewaySpendPolicy("job-s", { kind: "unlimited_for_video" });
    assert.equal(h.host.materializedSpendPolicies.has(h.sid), false); assert.equal(h.host.materializedSpendPolicies.get("other"), "job-t:capped:1");
    await new Promise((r) => setTimeout(r, 20)); assert.deepEqual(order, ["start:capped"]);
    release(); await Promise.all([a, b]);
    assert.deepEqual(order, ["start:capped", "end:capped", "start:unlimited_for_video", "end:unlimited_for_video"]);
  } finally { await h.cleanup(); }
});
