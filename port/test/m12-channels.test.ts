// docs/29 §3-§9: the last 23 category-(b) channels, driven through the SAME remainingChannels() handlers
// real-backend.ts registers, over the real verbatim modules (ProjectMemoryStore, sessionPlanReply,
// createUpdatePreferences / startUpdateCheck, CharacterSheetBuilder, AgentGatewayProxy, LocalGatewayShim).
// No network beyond loopback: MiniMax is never called (the shim's upstream is a fake that fails the test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { remainingChannels, _test as wf } from "../src/main/remaining-channels";
import { ProjectMemoryHost } from "../src/main/memory/project-memory-host";
import { appendDisplayTranscript, displayTranscriptPath } from "../src/main/agent/history.generated";
import { createUpdatePreferences, startUpdateCheck } from "../src/main/update/update-check.generated";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { priceTable } from "../src/main/gateway/pricing";
import { minimaxConfig } from "../src/main/llm/minimax";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { AgentHost, claudeLimitInjection } from "../src/main/agent/agent-host";
import { modelAccountLimit } from "../src/main/agent/account-limit.generated";
import { sessionIndexProjection } from "../src/main/telemetry/session-index.generated";

const FAKE_KEY = "mm-test-key-0123456789";
const quiet = () => { setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests(); };
const GW = "http://127.0.0.1:47719";
const AUTH = { gatewayUrl: GW, canonicalKeyId: "ab".repeat(32) };
const base = (o: Record<string, unknown> = {}): any => ({
  currentProjectMemoryScope: () => AUTH, openLocalPath: async () => {}, assertGenerationAllowed: () => {}, absCwd: (c: string) => c,
  listSessions: () => [], push: () => {}, ...o,
});
async function withShim<T>(fn: (s: { shim: LocalGatewayShim; url: string; key: string; root: string }) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "vc-m12c-"));
  const fetchImpl = (async () => { throw new Error("MiniMax must not be called in this test"); }) as unknown as typeof fetch;
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, fetchImpl, monthUsd: 5, price: priceTable({ env: {}, catalog: null }), appVersion: "0.0.40-port.0" } as any);
  const url = await shim.start();
  const { key } = shim.issueKey();
  try { return await fn({ shim, url, key, root }); } finally { await shim.close(); rmSync(root, { recursive: true, force: true }); }
}

test("memory:read/update/undo/openSource: the verbatim ProjectMemoryStore bound to the verified authority; refusal without one", async () => {
  quiet();
  const root = mkdtempSync(join(tmpdir(), "vc-mem-"));
  try {
    const sid = randomUUID(); const turnId = randomUUID();
    appendDisplayTranscript(displayTranscriptPath(root, sid), "engine text", ["Keep the brand teal."], turnId, undefined, undefined, undefined, undefined);
    const pushed: any[] = [];
    let authority: any = AUTH;
    const memory = new ProjectMemoryHost({
      stateDir: root, authority: () => authority, settingsGatewayUrl: () => GW,
      getClient: (id) => (id === "personal" ? { clientId: "personal" } : undefined), isClientRemoved: () => false,
      session: (id) => (id === sid ? { meta: { sessionId: sid, clientId: "personal", cwd: root } } : undefined),
      sessions: () => [{ meta: { sessionId: sid, clientId: "personal", cwd: root } }], isSessionGone: () => false,
      emitProjectMemoryChanged: (e) => pushed.push(e),
    });
    const ch = remainingChannels(base({ memory, currentProjectMemoryScope: () => authority }));
    const scope = { clientId: "personal", ...AUTH };
    const r0: any = await ch["memory:read"](scope);
    assert.equal(r0.ok, true, JSON.stringify(r0)); assert.deepEqual(r0.value.entries, []);
    const up: any = await ch["memory:update"](scope, { action: "save", expectedRevision: r0.value.revision, entry: { text: "Brand colour is teal.", sources: [{ kind: "message", sessionId: sid, turnId, label: "x" }], relatedIds: [] } });
    assert.equal(up.ok, true, JSON.stringify(up));
    assert.equal(up.value.snapshot.entries.length, 1);
    assert.equal(up.value.snapshot.entries[0].sources[0].label, "Keep the brand teal.", "the label is the verified display text, not the renderer's");
    assert.equal(pushed.length, 1); assert.deepEqual(pushed[0].authority, AUTH);
    const open: any = await ch["memory:openSource"](scope, up.value.snapshot.entries[0].sources[0]);
    assert.equal(open.ok, true); assert.equal(open.value.available, true); assert.equal(open.value.filePath, undefined, "the private path never reaches the renderer");
    const undo: any = await ch["memory:undo"](scope, up.value.undoId, up.value.snapshot.revision);
    assert.equal(undo.ok, true); assert.deepEqual(undo.value.entries, []);
    const bad: any = await ch["memory:update"](scope, { action: "save", expectedRevision: undo.value.revision, entry: { text: "x", sources: [], relatedIds: [] } });
    assert.equal(bad.ok, false); assert.equal(bad.code, "invalid");
    authority = null;
    const off: any = await ch["memory:read"](scope);
    assert.equal(off.ok, false); assert.equal(off.code, "unavailable");
    const offHost: any = await remainingChannels(base({ currentProjectMemoryScope: () => null }))["memory:read"](scope);
    assert.equal(offHost.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sessionPlan:read/choose/retry: no plan can exist (propose_session_plan is studio MCP) → null / the original missing-state reply", async () => {
  quiet();
  const memory: any = { readSessionPlan: () => null, chooseSessionPlan: () => { throw new Error("missing"); }, retrySessionPlan: () => { throw new Error("missing"); }, sessionPlanFacts: () => ({}) };
  const ch = remainingChannels(base({ memory }));
  const scope = { sessionId: "s1", ...AUTH };
  assert.deepEqual(await ch["sessionPlan:read"](scope), { ok: true, value: null });
  const c: any = await ch["sessionPlan:choose"](scope, { action: "choose", planId: "p", revision: 1 });
  assert.equal(c.ok, false); assert.match(c.message, /The plan could not be loaded or saved/);
  const wrong: any = await ch["sessionPlan:read"]({ ...scope, canonicalKeyId: "other" });
  assert.equal(wrong.ok, false);
  const blocked: any = await remainingChannels(base({ memory, assertGenerationAllowed: () => { throw new Error("blocked"); } }))["sessionPlan:retry"](scope);
  assert.equal(blocked.ok, false);
});

test("workflowSubmit:start: invalid id / name / eligibility branches of WorkflowSubmissionService.run (L59760)", async () => {
  const calls: string[] = [];
  const ch = remainingChannels(base({ workflow: { authorizedRequest: async (p: string) => { calls.push(p); throw new Error("Sign in to continue."); } } }));
  assert.deepEqual(await ch["workflowSubmit:start"]({ submissionId: "x" }), { ok: false, submissionId: "", failure: "invalid-submission-id", message: "Videoclaw could not start this submission — reopen the dialog and try again." });
  assert.equal((await ch["workflowSubmit:start"]({ submissionId: "abcdefgh12", workflowName: "  " }) as any).failure, "name-required");
  assert.deepEqual(await ch["workflowSubmit:start"]({ submissionId: "abcdefgh12", workflowName: "Teal promo" }), { ok: false, submissionId: "abcdefgh12", failure: "not-eligible", message: "Workflow submission is limited to Videoclaw workflow creators." });
  assert.deepEqual(calls, ["/v1/workflow-submissions/abcdefgh12", "/v1/workflow-submissions/abcdefgh12", "/v1/workflow-submissions/eligibility"]);
  assert.equal(wf.workflowSlug(" Hello, World! "), "hello-world");
});

test("engine:saveAgentProviderKey: the original validation; stored in the vault, never validated or sent", () => {
  const vault = new Map<string, string>();
  const ch = remainingChannels(base({ providerKeys: { get: (p: string) => vault.get(p), set: (p: string, k?: string) => { if (k && k.trim()) vault.set(p, k.trim()); else vault.delete(p); }, status: () => ({ openaiApi: { configured: vault.has("openai-api") }, openrouter: { configured: vault.has("openrouter") } }) } }));
  assert.throws(() => ch["engine:saveAgentProviderKey"]("anthropic", "k"), /Unsupported agent provider\./);
  assert.throws(() => ch["engine:saveAgentProviderKey"]("openrouter", "x".repeat(4097)), /Invalid agent provider key\./);
  assert.throws(() => ch["engine:saveAgentProviderKey"]("openrouter", 42), /Invalid agent provider key\./);
  assert.deepEqual(ch["engine:saveAgentProviderKey"]("openrouter", " sk-or-test "), { openaiApi: { configured: false }, openrouter: { configured: true } });
  assert.deepEqual(ch["engine:saveAgentProviderKey"]("openrouter", undefined), { openaiApi: { configured: false }, openrouter: { configured: false } });
});

test("app:update:preferences/channel/check: createUpdatePreferences + startUpdateCheck against the shim's release feed", async () => {
  quiet();
  await withShim(async ({ url, key }) => {
    const settings = { gatewayUrl: url, gatewayKey: key };
    const account = { step: "ready", legacyKeyOnly: true };
    const timers = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
    const checker: any = startUpdateCheck({ currentVersion: "0.0.40-port.0", settings: () => settings, onInfo: () => {}, onClear: () => {}, onTick: () => {}, timers } as any);
    const prefs: any = createUpdatePreferences({ settings: () => settings, account: () => account, refreshAccount: async () => account, save: () => {}, canSwitch: () => false, invalidate: () => {}, installedVersion: "0.0.40-port.0" });
    const ch = remainingChannels(base({ update: { checker: () => checker, preferences: () => prefs, appVersion: "0.0.40-port.0" } }));
    assert.deepEqual(await ch["app:update:check"](), { kind: "current", currentVersion: "0.0.40-port.0" });
    assert.deepEqual(await ch["app:update:preferences"](), { channel: "latest", nightlyAllowed: false, installedVersion: "0.0.40-port.0" });
    await assert.rejects(ch["app:update:channel"]("beta") as Promise<unknown>, /Unknown update channel\./);
    await assert.rejects(ch["app:update:channel"]("latest") as Promise<unknown>, /Wait for the current update to finish before changing channels\./);
    const older: any = startUpdateCheck({ currentVersion: "0.0.39", settings: () => settings, onInfo: () => {}, onClear: () => {}, onTick: () => {}, timers } as any);
    const r: any = await older.checkNow();
    assert.equal(r.kind, "available"); assert.equal(r.info.version, "0.0.40-port.0");
    checker.stop(); older.stop();
    assert.deepEqual(await remainingChannels(base({ update: { checker: () => null, preferences: () => prefs, appVersion: "1.0.0" } }))["app:update:check"](), { kind: "failed", currentVersion: "1.0.0" });
  });
});

test("library:search/sync: the scoped lease (credentialsForBudgetedTools → shim PUT /v1/budgets) reaches the engine call; no proxy → paid-work-unavailable", async () => {
  quiet();
  await withShim(async ({ url, key, root }) => {
    const proxy = await AgentGatewayProxy.start(url, key);
    try {
      const seen: any[] = [];
      const lib = {
        tenantFor: (id: string) => (id === "personal" ? "t1" : null),
        acquireLease: async (_c: string, _cwd: string, operation: "index" | "search") => {
          const id2 = randomUUID(); const jobId = `library-${operation}-${id2}`;
          const creds = await proxy.credentialsForBudgetedTools(`library-operation-${id2}`, new Set(["embed"]), operation === "search" ? 1 : 5e3, jobId, operation === "search" ? 0.1 : 5);
          return { ...creds, jobId, release: () => proxy.revokeCredential(creds.gatewayKey) };
        },
        sync: async () => 0,
        search: async (_cwd: string, tenants: string[], q: unknown, _t: unknown, lease: any) => {
          seen.push({ tenants, q, lease });
          // the engine's embed call through the scoped capability → the shim refuses it (MiniMax has no multimodal embedding)
          const r = await fetch(`${lease.gatewayUrl}/v1/embed`, { method: "POST", headers: { authorization: `Bearer ${lease.gatewayKey}`, "content-type": "application/json" }, body: JSON.stringify({ input: [String(q)] }) });
          const body: any = await r.json();
          throw new Error(`embed ${r.status} ${body.detail?.code}`);
        },
        errorMessage: (e: any) => String(e?.message ?? e), gate: (_k: string, _kind: string, fn: () => Promise<unknown>) => fn(), key: (t: string, c: string) => `${t}\0${c}`,
        exposeHits: (h: any[]) => h, log: () => {},
      };
      const ch = remainingChannels(base({ library: lib }));
      const r: any = await ch["library:search"]("personal", "/tmp/x", "teal logo", "image", []);
      assert.equal(r.error, "engine"); assert.match(r.message, /embed 422 TOOL_NOT_OFFERED/);
      assert.match(seen[0].lease.jobId, /^library-search-[0-9a-f-]{36}$/);
      assert.ok(JSON.parse(readFileSync(join(root, "lg", "ledger.json"), "utf8")).budgets[seen[0].lease.jobId], "the gateway budget was registered for the lease job");
      assert.equal((await ch["library:search"]("nobody", "/tmp/x", "q", "image", []) as any).error, "no-tenant");
      const s: any = await ch["library:sync"]("personal", "/tmp/x");
      assert.deepEqual(s, { code: 0 });
      const noProxy = remainingChannels(base({ library: { ...lib, acquireLease: async () => { throw new Error("Paid Library work is unavailable until this app is connected to Videoclaw."); } } }));
      assert.deepEqual(await noProxy["library:sync"]("personal", "/tmp/x"), { error: "paid-work-unavailable", message: "Paid Library work is unavailable until this app is connected to Videoclaw." });
    } finally { proxy.close(); }
  });
});

test("credits: a Claude usage-limit failure → accountLimit card → creditHandoffOffer available → continueOnCredits = a gateway-route continuation", async () => {
  quiet();
  const root = mkdtempSync(join(tmpdir(), "vc-credits-"));
  try {
    const ev: any[] = []; const runtimes: any[] = [];
    const host = new AgentHost({
      emit: { sessionEvent: (_s, e) => ev.push(e), sessionsChanged: () => {} },
      service: { newSessionLlmRoute: () => "claude-code", llmRouteReadiness: async () => undefined, sessionAgentRuntime: async (meta: any) => { runtimes.push(meta.llmRoute); return { llmRoute: meta.llmRoute, model: "m", env: {}, close: async () => {} }; } } as any,
      loadSdk: async () => ({ sdk: { query: ({ prompt }: any) => (async function* () { for await (const _m of prompt) { throw new Error("Claude AI usage limit reached|1760000000"); } })() as any } }),
      sessionsRoot: root, stateDir: root,
      creditEligibility: async () => ({ available: true }),
      gatewaySettings: () => ({ gatewayUrl: GW, gatewayKey: "vc_test" }),
    });
    const ch = remainingChannels(base({ host }));
    const src = host.createSession({ title: "Teal promo" });
    assert.equal(src.llmRoute, "claude-code");
    assert.equal(((await ch["engine:creditHandoffOffer"](src.sessionId)) as any).reason, "not-applicable", "no Claude limit yet");
    await host.sendMessage(src.sessionId, { text: "make it teal", clientTurnId: randomUUID(), attachmentIds: [] } as any);
    for (let i = 0; i < 100 && host.runtimeInfo(src.sessionId).status !== "error"; i++) await new Promise((r) => setTimeout(r, 20));
    const card = ev.filter((e) => e.kind === "error").at(-1);
    assert.deepEqual(card.accountLimit, { account: "claude", kind: "usage" });
    assert.equal(card.llmRouteRequired, true); assert.equal(card.message, "Claude usage limit reached.");
    const offer: any = await ch["engine:creditHandoffOffer"](src.sessionId);
    assert.equal(offer.available, true, JSON.stringify(offer));
    await assert.rejects(Promise.resolve(ch["engine:continueOnCredits"](src.sessionId, { clientActionId: "a" })) as Promise<unknown>, /Explicit VideoClaw credit consent is required\./);
    const cont: any = await ch["engine:continueOnCredits"](src.sessionId, { clientActionId: "act-1", consent: "videoclaw-credits" });
    assert.equal(cont.llmRoute, "gateway"); assert.equal(cont.continuedFromSessionId, src.sessionId);
    assert.equal(cont.continuationDraft, "make it teal", "the pending edit is ready to send");
    assert.equal(cont.creditContinuation.pending, false);
    const again: any = await ch["engine:continueOnCredits"](src.sessionId, { clientActionId: "act-2", consent: "videoclaw-credits" });
    assert.equal(again.sessionId, cont.sessionId);
    assert.deepEqual(await ch["engine:creditHandoffOffer"](src.sessionId), { available: true, existingSessionId: cont.sessionId });
    await host.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
  assert.deepEqual(modelAccountLimit("Claude AI usage limit reached|1760000000", "claude"), { account: "claude", kind: "usage" });
  assert.equal(modelAccountLimit("ECONNREFUSED 127.0.0.1", "claude"), undefined);
  assert.equal(claudeLimitInjection("claude-code", { VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT: "x" }), undefined, "only under VIDEOCLAW_PORT_UI_E2E=1");
  assert.equal(claudeLimitInjection("gateway", { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT: "x" }), undefined, "never on the credits route");
});

test("media:transcribeVoice: the original session checks, then VoiceDictation's unavailable branch", async () => {
  quiet();
  const root = mkdtempSync(join(tmpdir(), "vc-voice-"));
  try {
    const host = new AgentHost({ emit: { sessionEvent: () => {}, sessionsChanged: () => {} }, service: { newSessionLlmRoute: () => "minimax", llmRouteReadiness: async () => ({ ready: true }) } as any, loadSdk: async () => { throw new Error("no"); }, sessionsRoot: root });
    const { sessionId } = host.createSession({});
    const ch = remainingChannels(base({ host, voice: { tools: () => ({ helper: "", ffmpeg: "/usr/bin/ffmpeg" }), isAudio: (a: unknown) => a instanceof Uint8Array, invalidAudio: "bad audio" } }));
    await assert.rejects(Promise.resolve(ch["media:transcribeVoice"](sessionId, "nope", new Uint8Array(4))) as Promise<unknown>, /Invalid recording\./);
    assert.deepEqual(await ch["media:transcribeVoice"](sessionId, randomUUID(), "x"), { status: "failed", message: "bad audio" });
    assert.deepEqual(await ch["media:transcribeVoice"](sessionId, randomUUID(), new Uint8Array(4)), { status: "failed", message: "Voice notes are unavailable in this build." });
    await host.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("outbox / telemetry / feedback / sheets: authority snapshot, replay binding validation + durable session index, feedback passthrough, sheet plan/build guards", async () => {
  const enq: any[] = [];
  const outbox = { authoritySnapshot: () => ({ snapshot: 1 }), enqueue: (k: string, d: unknown) => enq.push([k, d]), enqueueDurable: async (k: string, d: unknown) => { enq.push([k, d, "durable"]); } };
  const sid = "11111111-2222-4333-8444-555555555555";
  const ch = remainingChannels(base({
    outbox, listSessions: () => [{ sessionId: sid, status: "idle" }],
    sessionIndex: async (meta: any, ph?: string, durable?: boolean) => { const d = sessionIndexProjection(meta, { observedAt: 1, appVersion: "0.0.40", posthogSessionId: ph }); if (durable) await outbox.enqueueDurable("session-index", d); },
    feedback: { submit: async (r: unknown) => ({ ok: true, r }), grantUsageSharing: async () => ({ telemetry: true }) },
    sheets: { plan: async () => ({ status: "error", message: "That character is no longer pending." }), build: async () => false },
  }));
  assert.deepEqual(ch["outbox:authoritySnapshot"](), { snapshot: 1 });
  assert.throws(() => remainingChannels(base())["outbox:authoritySnapshot"](), /Usage sharing is unavailable/);
  await assert.rejects(ch["telemetry:bindReplay"]({ appSessionId: "-bad", posthogSessionId: "p" }) as Promise<unknown>, /invalid telemetry replay binding/);
  await assert.rejects(ch["telemetry:bindReplay"]({ appSessionId: "unknown", posthogSessionId: "p" }) as Promise<unknown>, /not registered/);
  await ch["telemetry:bindReplay"]({ appSessionId: sid, posthogSessionId: "ph_1" });
  assert.deepEqual(enq, [["session-index", { appSessionId: sid, status: "created", observedAt: 1, posthogSessionId: "ph_1", appVersion: "0.0.40" }, "durable"]]);
  assert.deepEqual(await ch["feedback:submit"]({ reportId: "r" }), { ok: true, r: { reportId: "r" } });
  assert.deepEqual(await ch["feedback:grantUsageSharing"](), { telemetry: true });
  assert.deepEqual(await ch["characters:sheetPlan"]("/w", "ava"), { status: "error", message: "That character is no longer pending." });
  assert.equal(await ch["characters:sheetBuild"]("/w", "ava"), false);
  assert.throws(() => remainingChannels(base({ assertGenerationAllowed: () => { throw new Error("Verify your VideoClaw account before starting paid work."); } }))["characters:sheetBuild"]("/w", "ava"), /Verify your VideoClaw account/);
});

test("M12 credits precondition: modelAccountLimit classifies the Claude usage limit; the e2e injection seam is inert outside UI-e2e", async () => {
  const { modelAccountLimit } = await import("../src/main/agent/account-limit.generated");
  const { claudeLimitInjection } = await import("../src/main/agent/agent-host");
  const lim: any = modelAccountLimit("Claude AI usage limit reached|1760000000", "claude");
  assert.equal(modelAccountLimit("Claude AI usage limit reached|1760000000", undefined as any), undefined); // account required (L1652)
  assert.equal(lim?.account, "claude");
  assert.equal(lim?.kind, "usage");
  const text = "Claude AI usage limit reached|1760000000";
  assert.equal(claudeLimitInjection("claude-code", { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT: text }), text);
  assert.equal(claudeLimitInjection("claude-code", { VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT: text }), undefined); // not in UI-e2e
  assert.equal(claudeLimitInjection("gateway", { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT: text }), undefined); // only the claude route
  assert.equal(claudeLimitInjection("claude-code", { VIDEOCLAW_PORT_UI_E2E: "1" }), undefined);
});
