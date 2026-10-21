// docs/28: the local gateway + billing shim, the account / gateway-key / billing channels over the verbatim
// CredentialStore + resolveAccountSnapshot, taste:titles through the shim, the Claude Code "not connected"
// branches, the MiniMax-backed claudeModels catalog and continueOnCodex. No network: the shim listens on
// loopback and its MiniMax upstream is a fake fetch (no key, no MiniMax call).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { LocalGatewayShim, keyIdFor, SHIM_HEADER } from "../src/main/gateway/local-gateway-shim";
import { priceTable } from "../src/main/gateway/pricing";
import { CredentialStore } from "../src/main/account/local-reset-env";
import { AccountService, portResolveAuthPool } from "../src/main/account/account-service";
import { gatewayChannels } from "../src/main/gateway/gateway-channels";
import { SettingsStore } from "../src/main/settings/settings-store";
import { minimaxConfig } from "../src/main/llm/minimax";
import { resolveMiniMaxCodexProvider } from "../src/main/codex/codex-minimax";
import { ClaudeCodeController, CLAUDE_CONNECT_DISABLED, miniMaxClaudeModelSource } from "../src/main/agent/claude-code";
import { AgentHost } from "../src/main/agent/agent-host";
import { codexChannels } from "../src/main/codex/codex-channels";
import { ALPHA_TERMS_VERSION } from "../src/main/account-snapshot.generated";
import { tasteTitleKey } from "../src/main/taste/taste-titles.generated";

const silent = () => setLoggerForTests(createLogger({ level: "silent" }));
const FAKE_KEY = "mm-test-key-0123456789";
const mm = () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!;
const UNCONFIGURED = "Account sign-in isn’t set up for this Videoclaw environment in this build. Use “I already have an alpha key” instead.";

/** A fake MiniMax Anthropic upstream: records requests, answers with usage. */
function fakeUpstream(reply: (body: any) => { text: string; input: number; output: number; status?: number }) {
  const seen: Array<{ url: string; auth: string | null; body: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url, auth: new Headers(init.headers).get("x-api-key") ?? new Headers(init.headers).get("authorization"), body });
    const r = reply(body);
    if (body.stream) {
      const ev = (o: any) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
      const sse = ev({ type: "message_start", message: { id: "m", usage: { input_tokens: r.input, output_tokens: 1 } } }) + ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text } }) + ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: r.output } }) + ev({ type: "message_stop" });
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ id: "m", type: "message", content: [{ type: "text", text: r.text }], usage: { input_tokens: r.input, output_tokens: r.output } }), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}

async function shimHarness(o: { monthUsd?: number | null; reply?: Parameters<typeof fakeUpstream>[0] } = {}) {
  silent(); resetProviderGatesForTests();
  const root = mkdtempSync(join(tmpdir(), "vc-shim-"));
  const up = fakeUpstream(o.reply ?? (() => ({ text: "[\"Bold captions, no music\"]", input: 1000, output: 500 })));
  const shim = new LocalGatewayShim({ dir: join(root, "local-gateway"), provider: () => mm(), fetchImpl: up.fetchImpl, monthUsd: o.monthUsd === undefined ? 5 : o.monthUsd, price: priceTable({ env: {}, catalog: null }), appVersion: "0.0.40-port.0" });
  const url = await shim.start();
  return { root, shim, url, up, cleanup: async () => { await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}
const get = (url: string, key?: string) => fetch(url, { headers: key ? { authorization: `Bearer ${key}` } : {} });

test("local gateway shim: key plane (/v1/me = keyMeterFrom body, id = sha256(key)), refusals, account plane not offered, billing endpoints", async () => {
  const h = await shimHarness();
  try {
    const { key, id, hint } = h.shim.issueKey();
    assert.match(key, /^vc_[0-9a-f]{40}$/);
    assert.equal(id, keyIdFor(key));
    assert.ok(hint.startsWith("vc_") && hint.includes("…"));
    const ledgerText = readFileSync(join(h.root, "local-gateway", "ledger.json"), "utf8");
    assert.ok(!ledgerText.includes(key), "the shim never stores the plaintext key");
    assert.equal(statSync(join(h.root, "local-gateway", "ledger.json")).mode & 0o777, 0o600);
    const me = await get(`${h.url}/v1/me`, key);
    assert.equal(me.status, 200);
    assert.equal(me.headers.get(SHIM_HEADER), "1");
    const body: any = await me.json();
    assert.equal(body.id, id);
    assert.equal(body.limit_month_usd, 5);
    assert.equal(body.spend_this_month_usd, 0);
    assert.equal(body.available_credit_usd, 5);
    assert.equal((await get(`${h.url}/v1/me`, "vc_" + "0".repeat(40))).status, 401);
    assert.equal((await get(`${h.url}/v1/me`)).status, 401);
    for (const p of ["/v1/token", "/v1/accounts", "/v1/account", "/v1/account/key", "/v1/account/key/claim"]) {
      const r = await fetch(`${h.url}${p}`, { method: "POST", headers: { authorization: `Bearer ${key}` } });
      assert.equal(r.status, 404, p);
      assert.equal(((await r.json()) as any).error, "account-plane-not-offered");
    }
    const topup = await fetch(`${h.url}/v1/keys/${id}/topup-session`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: "{\"usd\":10}" });
    assert.equal(topup.status, 503);
    const q: any = await (await fetch(`${h.url}/v1/quotes/project`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ job_id: "j1", items: [{ tool: "mint_image", count: 2 }, { tool: "model_call" }] }) })).json();
    assert.deepEqual([q.planned_total_cents, q.reserve_cents, q.total_cents], [9, 2, 11]);
    for (const f of ["planned_total_cents", "reserve_cents", "total_cents"]) assert.ok(Number.isSafeInteger(q[f]) && q[f] >= 0); // quoteProject L28893 validation
    const put = await fetch(`${h.url}/v1/spend-authorities/j1`, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "capped", ceiling_usd: "2.50" }) });
    assert.equal(put.status, 200);
    const sa: any = await (await get(`${h.url}/v1/spend-authorities/j1`, key)).json();
    assert.deepEqual([sa.mode, sa.ceiling_usd], ["capped", 2.5]);
    assert.equal((await fetch(`${h.url}/v1/budgets/j1`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ ceiling_usd: 1 }) })).status, 200);
    assert.equal((await fetch(`${h.url}/v1/budgets/j1`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ ceiling_usd: -1 }) })).status, 400);
    const flags: any = await (await get(`${h.url}/v1/config/flags`, key)).json();
    assert.equal(flags.signed, false);
    assert.ok(h.shim.revokeKey(id));
    assert.equal((await get(`${h.url}/v1/me`, key)).status, 401, "a revoked key is refused");
  } finally { await h.cleanup(); }
});

test("local gateway shim ledger: /anthropic/v1/messages → MiniMax (model mapped, MiniMax key only), metered (JSON + SSE usage), ceiling → 402, top-up restores", async () => {
  const h = await shimHarness({ monthUsd: 0.0008 });
  try {
    const { key } = h.shim.issueKey();
    const send = (body: any) => fetch(`${h.url}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    const r1 = await send({ model: "claude-haiku-4-5-20251001", max_tokens: 64, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r1.status, 200);
    assert.equal(h.up.seen[0].url, "https://api.minimaxi.com/anthropic/v1/messages");
    assert.equal(h.up.seen[0].body.model, "MiniMax-M3.1-Flash", "a Claude id is served by the configured MiniMax model");
    assert.ok(h.up.seen[0].auth?.includes(FAKE_KEY) && !h.up.seen[0].auth?.includes(key), "upstream sees only the MiniMax key");
    let led = h.shim.snapshot();
    assert.equal(led.entries.length, 1);
    assert.deepEqual([led.entries[0].inputTokens, led.entries[0].outputTokens], [1000, 500]);
    assert.equal(led.entries[0].usd, (1000 * 0.15 + 500 * 0.6) / 1e6); // 0.00045 at MiniMax-M3.1-Flash (docs/29 §1)
    assert.equal(led.entries[0].pricing.source, "minimax-fallback/2026-10");
    assert.equal(led.entries[0].model, "claude-haiku-4-5-20251001");
    // SSE: usage read from message_start / message_delta while bytes pass through
    const r2 = await send({ model: "MiniMax-M3", stream: true, max_tokens: 64, messages: [{ role: "user", content: "hi" }] });
    assert.match(await r2.text(), /message_stop/);
    led = h.shim.snapshot();
    assert.equal(led.entries[1].upstreamModel, "MiniMax-M3");
    assert.deepEqual([led.entries[1].inputTokens, led.entries[1].outputTokens], [1000, 500]);
    const meter: any = h.shim.meter();
    assert.equal(meter.spend_this_month_usd, 0.0009);
    assert.equal(meter.available_credit_usd, 0, "the 0.0008 USD monthly grant is used up (overspend floors at 0)");
    const r3 = await send({ model: "claude-haiku-4-5-20251001", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
    assert.equal(r3.status, 402);
    assert.equal(((await r3.json()) as any).error.type, "billing_error");
    assert.equal(h.up.seen.length, 2, "a refused call never reaches MiniMax");
    assert.equal(h.shim.snapshot().refusals.length, 1);
    h.shim.topUp(1);
    assert.equal((h.shim.meter() as any).available_credit_usd, 0.9999, "top-up pays the 0.0001 overspend first");
    assert.equal((await send({ model: "claude-haiku-4-5-20251001", max_tokens: 8, messages: [{ role: "user", content: "hi" }] })).status, 200);
    assert.equal(h.shim.snapshot().entries.length, 3);
    // unlimited account: available null (keyMeterFrom's "no grant ceiling")
    h.shim.setLimits({ monthUsd: null });
    assert.equal((h.shim.meter() as any).available_credit_usd, null);
  } finally { await h.cleanup(); }
});

async function accountHarness(o: { reply?: Parameters<typeof fakeUpstream>[0]; env?: NodeJS.ProcessEnv } = {}) {
  const h = await shimHarness({ reply: o.reply });
  const ud = join(h.root, "ud");
  const settings = new SettingsStore(join(ud, "settings.json"), h.url);
  const credentials = new CredentialStore({ file: join(ud, "credentials.dat"), packaged: false } as any);
  const issued = h.shim.issueKey();
  (credentials as any).setActiveKey(h.url, issued.key);
  const pushes: any[] = [];
  const opened: string[] = [];
  const service = new AccountService({ settings, credentials: credentials as any, openedGatewayUrl: h.url, packaged: false, appVersion: "0.0.40", env: o.env ?? {}, push: (ch, ...a) => { pushes.push({ ch, a }); }, openExternal: async (u) => { opened.push(u); } });
  const ch = gatewayChannels(service, { userData: ud }); // the helper call goes over real loopback HTTP to the shim
  return { ...h, ud, settings, credentials, issued, service, ch, pushes, opened };
}

test("account channels over the shim: snapshot ready (legacy key, storedKeyId = shim id), verify, meter, top-up branch, saveGatewayKey, switchGateway, revoked key", async () => {
  const h = await accountHarness();
  try {
    const vault = readFileSync(join(h.ud, "credentials.dat"), "utf8");
    assert.ok(vault.startsWith("{"), "unpackaged + no keychain under node:test → the original's plaintext vault");
    assert.equal(statSync(join(h.ud, "credentials.dat")).mode & 0o777, 0o600);
    const snap: any = await h.ch["account:snapshot"]();
    assert.equal(snap.step, "ready");
    assert.equal(snap.legacyKeyOnly, true);
    assert.equal(snap.hasStoredKey, true);
    assert.equal(snap.storedKeyId, h.issued.id);
    assert.equal(snap.storedKeyInvalid, false);
    assert.equal(snap.signInAvailable, false);
    assert.equal(snap.signInUnavailableReason, "unconfigured");
    assert.equal(snap.portLocalStudio, undefined, "a real key → no local-studio stand-in");
    assert.equal(h.pushes.at(-1).ch, "account:changed");
    assert.deepEqual(h.service.projectMemoryIdentity && { url: h.service.projectMemoryIdentity.gatewayUrl, id: h.service.projectMemoryIdentity.canonicalKeyId }, { url: h.url, id: h.issued.id });
    assert.equal(await h.ch["account:snapshot"](), snap, "loaded → the same object (L61406)");
    assert.deepEqual(await h.ch["gateway:verify"](h.issued.key), { ok: true, name: "Local studio (self-hosted)", id: h.issued.id });
    assert.deepEqual(await h.ch["gateway:verify"]("vc_" + "1".repeat(40)), { ok: false, status: 401 });
    const meter: any = await h.ch["gateway:meter"]();
    assert.deepEqual([meter.spentUsd, meter.limitUsd, meter.availableUsd, meter.topupMinUsd, meter.topupMaxUsd], [0, 5, 5, 5, 500]);
    assert.deepEqual(await h.ch["gateway:topup"](10), { ok: false, error: "Checkout is unavailable right now. Try again in a moment." });
    assert.equal(h.opened.length, 0, "no checkout page is ever opened");
    // a fresh key from the shim pasted under "I already have an alpha key"
    const next = h.shim.issueKey();
    await h.ch["settings:saveGatewayKey"](next.key);
    assert.equal((h.credentials as any).activeKey(h.url), next.key);
    assert.equal(((await h.ch["account:refresh"]()) as any).storedKeyId, next.id);
    // the key revoked in the ledger → 401 → storedKeyInvalid (the original's verdict)
    h.shim.revokeKey(next.id);
    const revoked: any = await h.ch["account:refresh"]();
    assert.equal(revoked.storedKeyInvalid, true);
    assert.equal(revoked.storedKeyId, undefined);
    assert.equal(await h.ch["gateway:meter"](), null, "loadKeyMeter: !ok → null");
    // switchGateway: persisted, verified with the target's key, applies after restart
    const sw: any = await h.ch["settings:switchGateway"]("https://gw.example.invalid/");
    assert.equal(sw.requiresRestart, true);
    assert.equal(sw.settings.gatewayUrl, "https://gw.example.invalid");
    assert.equal(sw.verify, null, "no key stored for the target gateway");
    assert.equal(h.service.opened, h.url, "this process keeps the opened gateway");
  } finally { await h.cleanup(); }
});

test("account sign-in / consent / access / mint / claim on a self-hosted gateway: the original's unconfigured-pool refusals (no network)", async () => {
  const h = await accountHarness();
  try {
    assert.deepEqual(portResolveAuthPool(h.url), { config: null, reason: "unconfigured" });
    assert.deepEqual(portResolveAuthPool("https://videoclaw-gw-650303209435.us-central1.run.app"), { config: null, reason: "unconfigured" });
    assert.deepEqual(portResolveAuthPool("https://gw.example.com"), { config: null, reason: "untrusted-gateway" });
    assert.deepEqual(await h.ch["account:signInGoogle"](), { ok: false, reason: "unconfigured", message: UNCONFIGURED });
    assert.deepEqual(await h.ch["account:signInEmail"]("me@example.com"), { ok: false, reason: "unconfigured", message: UNCONFIGURED });
    assert.deepEqual(await h.ch["account:resendEmail"](), { ok: false, reason: "cancelled", message: "That sign-in is no longer waiting — start again." });
    assert.equal(await h.ch["account:cancelSignIn"](), undefined);
    assert.equal(((await h.ch["account:consent"]("alpha-1999")) as any).message, "Videoclaw has updated its alpha terms. Update the app to read the current terms — we won’t agree to them on your behalf.");
    assert.deepEqual(await h.ch["account:consent"](ALPHA_TERMS_VERSION), { ok: false, reason: "unconfigured", message: UNCONFIGURED });
    assert.deepEqual(await h.ch["account:ensureAccess"](), { ok: false, reason: "rejected", message: "Sign in to Videoclaw first." });
    assert.deepEqual(await h.ch["account:mintKey"](), { ok: false, reason: "rejected", message: UNCONFIGURED });
    assert.deepEqual(await h.ch["account:claimKey"](""), { ok: false, reason: "rejected", message: UNCONFIGURED }, "falls back to the stored key, then the pool refusal");
    const out: any = await h.ch["account:signOut"]();
    // sign-out drops only a managed session (none exists); the stored vc_ key is NOT touched (AccountAuth.signOut
    // L54192) → the legacy-key studio stays ready, exactly as the original resolves it
    assert.equal(out.step, "ready");
    assert.equal((h.credentials as any).activeKey(h.url), h.issued.key);
  } finally { await h.cleanup(); }
});

test("taste:titles: gateway route + key → one batched helper call through the shim (MiniMax, metered), cached; claude-code route → no helper call", async () => {
  const h = await accountHarness({ reply: (b) => ({ text: JSON.stringify(b.messages[0].content.split("\n").slice(1).map((_: string, i: number) => ["Bold captions, no music", "Always use my real voice"][i])), input: 200, output: 30 }) });
  try {
    const entries = [{ text: "captions must be bold; never add music", scope: "p1" }, { text: "use my own recorded voice for narration", scope: "p1" }];
    // paidWorkBlocked() is true until the account has resolved (the original resolves it at launch, L60955)
    assert.deepEqual(await h.ch["taste:titles"](entries), {});
    await h.ch["account:snapshot"]();
    // default route claude-code → resolveHelperCreds null → only cache hits (none)
    assert.deepEqual(await h.ch["taste:titles"](entries), {});
    assert.equal(h.up.seen.length, 0);
    h.settings.patch({ llmRoute: "gateway" });
    const titles: any = await h.ch["taste:titles"](entries);
    assert.equal(titles[tasteTitleKey(entries[0].text, "p1")], "Bold captions, no music");
    assert.equal(titles[tasteTitleKey(entries[1].text, "p1")], "Always use my real voice");
    assert.equal(h.up.seen.length, 1, "ONE batched call");
    assert.equal(h.up.seen[0].body.model, "MiniMax-M3.1-Flash");
    assert.match(h.up.seen[0].body.system, /title saved preferences/);
    assert.equal(h.shim.snapshot().entries.length, 1, "the helper call is charged to the local ledger");
    assert.ok(existsSync(join(h.ud, "taste-titles.json")));
    assert.deepEqual(await h.ch["taste:titles"](entries), titles, "second call: cache only");
    assert.equal(h.up.seen.length, 1);
  } finally { await h.cleanup(); }
});

test("Claude Code channels: the original's not-connected branches (no probe, no login child); claudeModels on the MiniMax source", async () => {
  silent(); resetProviderGatesForTests();
  const sessions: any[] = [{ meta: { agentHarness: "claude-code", llmRoute: "claude-code", status: "running" }, runtime: {} }, { meta: { agentHarness: "claude-code", llmRoute: "minimax", status: "running" }, runtime: {} }];
  let listed = 0;
  const fetchImpl = (async (url: string) => { listed++; assert.equal(url, "https://api.minimaxi.com/v1/models"); return new Response(JSON.stringify({ data: [{ id: "MiniMax-M3.1-Flash" }, { id: "MiniMax-M3" }, { id: "speech-02" }] }), { status: 200 }); }) as typeof fetch;
  const c = new ClaudeCodeController({ modelSource: miniMaxClaudeModelSource(() => resolveMiniMaxCodexProvider({ MINIMAX_API_KEY: FAKE_KEY }), fetchImpl), sessions: () => sessions, sessionLlmRoute: (m) => m.llmRoute });
  assert.deepEqual(await c.status(), { available: false });
  await assert.rejects(c.connect(), (e: any) => e.message === CLAUDE_CONNECT_DISABLED);
  assert.deepEqual(await c.status(), { available: false }, "no lingering connecting:true");
  c.cancelConnect();
  assert.deepEqual(c.signOutImpact(), { runningVideos: 1 }, "only the running video on route claude-code counts (usesMacClaudeLogin)");
  assert.deepEqual(await c.signOutClaudeCode(), { ok: false, stoppedVideos: 0, status: { available: false }, error: "VideoClaw could not find a Claude Code sign-in on this Mac, so nothing was signed out." });
  const models: any = await c.models(true);
  assert.equal(models.ok, true);
  assert.deepEqual(models.models.map((m: any) => m.id), ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  assert.deepEqual(models.recommended, [], "MiniMax ids are unqualified in the original evidence ledger → never recommended");
  assert.deepEqual(models.discovered, ["MiniMax-M3.1-Flash", "MiniMax-M3"]);
  await c.models(false);
  assert.equal(listed, 1, "TTL cache (CLAUDE_CATALOG_TTL_MS)");
  const off = new ClaudeCodeController({ modelSource: miniMaxClaudeModelSource(() => null, fetchImpl), sessions: () => [], sessionLlmRoute: () => "claude-code" });
  assert.deepEqual(await off.models(true), { ok: false, reason: "unauthenticated", message: "Connect Claude Code to choose a model." });
  const broken = new ClaudeCodeController({ modelSource: { identity: async () => { throw new Error("x"); }, discover: async () => ({ models: [] }) }, sessions: () => [], sessionLlmRoute: () => "claude-code" });
  assert.deepEqual(await broken.models(true), { ok: false, reason: "unavailable", message: "VideoClaw could not reach Claude Code to read its models. Try again." });
});

test("codexHandoffOffer / continueOnCodex: a Claude video continues as a NEW Codex (MiniMax) chat; source untouched; second call returns the same continuation", async () => {
  silent(); resetProviderGatesForTests();
  const root = mkdtempSync(join(tmpdir(), "vc-handoff-"));
  try {
    const settings: Record<string, unknown> = { agentHarness: "claude-code" };
    const fakeModels = async () => ["MiniMax-M3.1-Flash"].map((id) => ({ id, model: id, displayName: id, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"].map((effort) => ({ effort })) }));
    const host = new AgentHost({
      emit: { sessionEvent: () => {}, sessionsChanged: () => {} },
      service: { newSessionLlmRoute: () => "minimax" as any, llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("no turn in this test"); } } as any,
      loadSdk: async () => { throw new Error("no SDK"); },
      sessionsRoot: root,
      codex: { settings: () => settings, profileDir: () => join(root, "cp"), executable: () => "codex", appVersion: "0.0.40", provider: () => resolveMiniMaxCodexProvider({ MINIMAX_API_KEY: FAKE_KEY }), discoverModels: fakeModels as any, accountStatus: async () => ({ harness: "codex-app-server", provider: "openai", authenticated: true, mode: "external" }) as any } as any,
    });
    const ch = codexChannels(host);
    const src = host.createSession({ title: "Cat video" });
    assert.equal(src.agentHarness, "claude-code");
    const offer: any = await ch["engine:codexHandoffOffer"](src.sessionId);
    assert.equal(offer.available, true, JSON.stringify(offer));
    await assert.rejects(Promise.resolve(ch["engine:continueOnCodex"](src.sessionId, " ")), /Missing continuation action id/);
    const cont: any = await ch["engine:continueOnCodex"](src.sessionId, "act-1");
    assert.equal(cont.agentHarness, "codex-app-server");
    assert.equal(cont.codexProvider, "chatgpt");
    assert.equal(cont.llmRoute, undefined);
    assert.equal(cont.title, "Cat video · continued");
    assert.equal(cont.cwd, src.cwd);
    const srcAfter = host.listSessions().find((m) => m.sessionId === src.sessionId)!;
    assert.equal(srcAfter.agentHarness, "claude-code", "the source video is not touched");
    assert.equal((srcAfter as any).continuation.sessionId, cont.sessionId);
    const again: any = await ch["engine:continueOnCodex"](src.sessionId, "act-2");
    assert.equal(again.sessionId, cont.sessionId, "one continuation per source");
    assert.equal(((await ch["engine:codexHandoffOffer"](cont.sessionId)) as any).reason, "not-applicable", "the Codex continuation is not a Claude video");
    const noCodex = new AgentHost({ emit: { sessionEvent: () => {}, sessionsChanged: () => {} }, service: { newSessionLlmRoute: () => "minimax" as any, llmRouteReadiness: async () => ({ ready: true }) } as any, loadSdk: async () => { throw new Error("no"); }, sessionsRoot: root });
    const s2 = noCodex.createSession({});
    assert.deepEqual(await codexChannels(noCodex)["engine:codexHandoffOffer"](s2.sessionId), { available: false, reason: "unavailable", message: "Codex is unavailable right now." });
    // Claude Code channels are registered on every host (PORT defaults)
    assert.deepEqual(await codexChannels(noCodex)["engine:claudeCodeStatus"](), { available: false });
    assert.deepEqual(await codexChannels(noCodex)["engine:claudeModels"](), { ok: false, reason: "unauthenticated", message: "Connect Claude Code to choose a model." });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
