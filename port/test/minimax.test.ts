// MiniMax route (docs/14 方案 a). All HTTP goes to a local mock — never the real API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import {
  backoffDelayMs, ConcurrencyLimiter, describeMiniMaxConfig, minimaxConfig, resetMiniMaxGateForTests, retryAfterMs, withMiniMaxRetry,
  MINIMAX_DEFAULT_BASE_URL, MINIMAX_DEFAULT_MODEL,
} from "../src/main/llm/minimax";
import {
  anthropicMessages, claudeRouteEnv, claudeSdkBaseEnv, defaultSessionModel, normalizeLlmRouteSetting, resolveHelperCreds, resolvedLlmRoute, sanitizedAgentEnv,
} from "../src/main/llm/llm-route";
import { PROVIDER_CREDENTIAL_CODE } from "../src/main/gateway/agent-gateway-proxy";
import { evalOriginal, fnText, slice, lineOf } from "./original-source";

const FAKE_KEY = "mm-test-key-not-real-0123456789";
/** AGENT_STARTUP_ENV_DENYLIST verbatim (ends at its `]);` line, which fnText cannot find). */
function denylistText(): string { const a = lineOf(/^const AGENT_STARTUP_ENV_DENYLIST = /); let b = a; while (slice(b, b) !== "]);") b++; return slice(a, b); }
const noSleep = { sleep: async () => {}, jitter: () => 0 };

test("minimaxConfig: defaults, trimming, trailing slash, concurrency clamp 1..2, null without key", () => {
  assert.equal(minimaxConfig({}), null);
  assert.equal(minimaxConfig({ MINIMAX_API_KEY: "   " }), null);
  assert.deepEqual(minimaxConfig({ MINIMAX_API_KEY: ` ${FAKE_KEY} ` }), { key: FAKE_KEY, baseUrl: MINIMAX_DEFAULT_BASE_URL, model: MINIMAX_DEFAULT_MODEL, maxConcurrency: 1 });
  assert.equal(MINIMAX_DEFAULT_BASE_URL, "https://api.minimaxi.com/anthropic");
  assert.equal(MINIMAX_DEFAULT_MODEL, "MiniMax-M3.1-Flash");
  const c = minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY, MINIMAX_BASE_URL: "https://api.minimax.io/anthropic///", MINIMAX_MODEL: "MiniMax-M3", MINIMAX_MAX_CONCURRENCY: "9" })!;
  assert.equal(c.baseUrl, "https://api.minimax.io/anthropic");
  assert.equal(c.model, "MiniMax-M3");
  assert.equal(c.maxConcurrency, 2);
  for (const bad of ["0", "-3", "abc", ""]) assert.equal(minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY, MINIMAX_MAX_CONCURRENCY: bad })!.maxConcurrency, 1);
  assert.ok(!JSON.stringify(describeMiniMaxConfig(c)).includes(FAKE_KEY));
  assert.deepEqual(describeMiniMaxConfig(null), { configured: false });
});

test("resolvedLlmRoute / settings validation: differential vs original L320 + L5397 for non-minimax values; minimax accepted", () => {
  const origResolve = evalOriginal<(s: any) => string>(`const DEFAULT_LLM_ROUTE = "claude-code";\n${fnText(/^function resolvedLlmRoute\(/)}`, "resolvedLlmRoute");
  const a = lineOf(/if \(this\.value\.llmRoute !== "claude-code" && this\.value\.llmRoute !== "gateway"\)/);
  const origNormalize = evalOriginal<(v: any) => any>(`function n(value){ const self={value}; (function(){ ${slice(a, a + 2)} }).call(self); return self.value; }`, "n");
  for (const v of [undefined, "claude-code", "gateway", "codex", 1, null, "GATEWAY"]) {
    assert.equal(resolvedLlmRoute({ llmRoute: v }), origResolve({ llmRoute: v }), String(v));
    assert.deepEqual(normalizeLlmRouteSetting({ llmRoute: v, x: 1 }), origNormalize({ llmRoute: v, x: 1 }), String(v));
  }
  assert.equal(resolvedLlmRoute({ llmRoute: "minimax" }), "minimax");
  assert.equal(origResolve({ llmRoute: "minimax" }), "claude-code"); // the original has no such route
  assert.deepEqual(normalizeLlmRouteSetting({ llmRoute: "minimax" }), { llmRoute: "minimax" });
  assert.equal(defaultSessionModel("gateway"), "sonnet");
  assert.equal(defaultSessionModel("claude-code"), undefined);
  assert.equal(defaultSessionModel("minimax", minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })), "MiniMax-M3.1-Flash");
});

test("sanitizedAgentEnv: differential vs original L16026; it strips MINIMAX_API_KEY so the route must inject it", () => {
  const orig = evalOriginal<(e: any) => any>(`${denylistText()}\n${fnText(/^function sanitizedAgentEnv\(/)}`, "sanitizedAgentEnv");
  const src = { PATH: "/bin", HOME: "/h", MINIMAX_API_KEY: FAKE_KEY, MINIMAX_BASE_URL: "https://x", MINIMAX_MODEL: "m", ANTHROPIC_AUTH_TOKEN: "t", VIDEOCLAW_BOUND_JOB: "j", PYTHONPATH: "p", LD_PRELOAD: "x", BASH_FUNC_x: "y", MY_SECRET: "s", OAuthThing: "o", undef: undefined };
  assert.deepEqual(sanitizedAgentEnv(src), orig(src));
  assert.equal(sanitizedAgentEnv(src).MINIMAX_API_KEY, undefined);
  assert.equal(sanitizedAgentEnv(src).MINIMAX_BASE_URL, "https://x");
});

test("claudeRouteEnv minimax: base URL, explicit auth token from MINIMAX_API_KEY, all aliases → MiniMax-M3.1-Flash, isolated profile, no gateway headers", () => {
  const parent = { PATH: "/bin", MINIMAX_API_KEY: FAKE_KEY, ANTHROPIC_BASE_URL: "https://stale", ANTHROPIC_CUSTOM_HEADERS: "x-a: b" };
  const mm = minimaxConfig(parent);
  const child = { ...claudeSdkBaseEnv(parent), ...claudeRouteEnv({ llmRoute: "minimax", minimax: mm }, "/profile", "x-videoclaw-job: 1") };
  assert.equal(child.ANTHROPIC_BASE_URL, "https://api.minimaxi.com/anthropic");
  assert.equal(child.ANTHROPIC_AUTH_TOKEN, FAKE_KEY);
  for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) assert.equal((child as any)[k], "MiniMax-M3.1-Flash", k);
  assert.equal(child.CLAUDE_CONFIG_DIR, "/profile");
  assert.equal((child as any).ANTHROPIC_CUSTOM_HEADERS, undefined);
  assert.equal((child as any).MINIMAX_API_KEY, undefined); // only as ANTHROPIC_AUTH_TOKEN
  assert.equal(child.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK, "1");
  assert.throws(() => claudeRouteEnv({ llmRoute: "minimax", minimax: null }, "/p"), /MINIMAX_API_KEY is not set/);
  // gateway / claude-code unchanged (L23306)
  assert.deepEqual(claudeRouteEnv({ llmRoute: "gateway", gatewayUrl: "https://gw", gatewayKey: "gk" }, "/p", "h: 1"), { ANTHROPIC_BASE_URL: "https://gw/anthropic", ANTHROPIC_AUTH_TOKEN: "gk", ANTHROPIC_CUSTOM_HEADERS: "h: 1", CLAUDE_CONFIG_DIR: "/p" });
  assert.deepEqual(claudeRouteEnv({ llmRoute: "claude-code" }, "/p"), {});
});

test("resolveHelperCreds: gateway branch differential vs original L22343; minimax → {base}/v1/messages + x-api-key", () => {
  const orig = evalOriginal<(c: any) => any>(`const DEFAULT_LLM_ROUTE = "claude-code";\n${fnText(/^function resolvedLlmRoute\(/)}\nconst ANTHROPIC_VERSION = { "anthropic-version": "2023-06-01" };\n${fnText(/^function resolveHelperCreds\(/)}`, "resolveHelperCreds");
  const g = { llmRoute: "gateway", gatewayUrl: "https://gw/", gatewayKey: "k" };
  const { provider, ...port } = resolveHelperCreds(g, {})!;
  assert.equal(provider, "gateway");
  assert.deepEqual(port, orig(g));
  assert.equal(resolveHelperCreds({ llmRoute: "claude-code", gatewayUrl: "x" }, { MINIMAX_API_KEY: FAKE_KEY }), null);
  assert.equal(resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "x" }, {}), null);
  const m = resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "x" }, { MINIMAX_API_KEY: FAKE_KEY })!;
  assert.equal(m.url, "https://api.minimaxi.com/anthropic/v1/messages");
  assert.deepEqual(m.headers, { "x-api-key": FAKE_KEY, "content-type": "application/json", "anthropic-version": "2023-06-01" });
  assert.equal(m.model, "MiniMax-M3.1-Flash");
});

test("backoff: 2s,4s,8s,16s,32s (jitter 0), capped; retry-after seconds/date honoured", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => backoffDelayMs(i, { jitter: () => 0 })), [2000, 4000, 8000, 16000, 32000]);
  assert.equal(backoffDelayMs(10, { jitter: () => 0 }), 60000);
  assert.equal(backoffDelayMs(0, { jitter: () => 0.999 }) <= 2500, true);
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(retryAfterMs(undefined), undefined);
});

type Handler = (req: IncomingMessage, body: any) => { status: number; headers?: Record<string, string>; body: unknown };
async function mockAnthropic(handler: Handler) {
  const seen: Array<{ path: string; headers: IncomingMessage["headers"]; body: any }> = [];
  let inFlight = 0, maxInFlight = 0;
  const server = createServer((req, res) => {
    let raw = "";
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ path: req.url!, headers: req.headers, body });
      const r = handler(req, body);
      setTimeout(() => { inFlight--; res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) }); res.end(JSON.stringify(r.body)); }, 15);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/anthropic`;
  return { base, seen, maxInFlight: () => maxInFlight, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const OK_BODY = { id: "m1", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "…", signature: "s" }, { type: "text", text: "Hello!" }] };

test("anthropicMessages via minimax creds (mock): URL, headers, model override, 429/529 backoff then success; thinking blocks ignored", async () => {
  resetMiniMaxGateForTests();
  const statuses = [429, 529, 429];
  const m = await mockAnthropic(() => {
    const s = statuses.shift();
    return s ? { status: s, headers: (s === 429 ? { "retry-after": "0" } : {}) as Record<string, string>, body: { type: "error", error: { type: "rate_limit_error" }, base_resp: { status_code: 1002 } } } : { status: 200, body: OK_BODY };
  });
  try {
    const creds = resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "x" }, { MINIMAX_API_KEY: FAKE_KEY, MINIMAX_BASE_URL: m.base + "/" })!;
    const retries: Array<{ attempt: number; delayMs: number; status: number }> = [];
    const r = await anthropicMessages(creds, { model: "claude-haiku-4-5-20251001", max_tokens: 32, messages: [{ role: "user", content: "hi" }] }, { timeoutMs: 5000, retry: { ...noSleep, onRetry: (i) => retries.push(i) } });
    assert.deepEqual(r, { ok: true, text: "Hello!" });
    assert.equal(m.seen.length, 4);
    for (const s of m.seen) {
      assert.equal(s.path, "/anthropic/v1/messages");
      assert.equal(s.headers["x-api-key"], FAKE_KEY);
      assert.equal(s.headers["anthropic-version"], "2023-06-01");
      assert.equal(s.headers.authorization, undefined);
      assert.equal(s.body.model, "MiniMax-M3.1-Flash");
    }
    assert.deepEqual(retries, [{ attempt: 1, delayMs: 0, status: 429 }, { attempt: 2, delayMs: 4000, status: 529 }, { attempt: 3, delayMs: 0, status: 429 }]);
  } finally { await m.close(); }
});

test("minimax: 401 / code 1008 are not retried and map to PROVIDER_CREDENTIAL_MISCONFIGURED without leaking the key; retries exhaust → RATE_LIMITED", async () => {
  resetMiniMaxGateForTests();
  const m = await mockAnthropic((req) => req.headers["x-case"] === "1008"
    ? { status: 400, body: { base_resp: { status_code: 1008, status_msg: "insufficient balance" } } }
    : req.headers["x-case"] === "429" ? { status: 429, body: {} } : { status: 401, body: { type: "error", error: { type: "authentication_error" } } });
  try {
    const creds = resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "x" }, { MINIMAX_API_KEY: FAKE_KEY, MINIMAX_BASE_URL: m.base })!;
    const r1 = await anthropicMessages(creds, { max_tokens: 8, messages: [] }, { timeoutMs: 5000, retry: noSleep });
    assert.equal(r1.ok, false);
    assert.equal((r1 as any).code, PROVIDER_CREDENTIAL_CODE);
    assert.equal((r1 as any).status, 401);
    assert.ok(!JSON.stringify(r1).includes(FAKE_KEY));
    const r2 = await anthropicMessages({ ...creds, headers: { ...creds.headers, "x-case": "1008" } }, { messages: [] }, { timeoutMs: 5000, retry: noSleep });
    assert.equal((r2 as any).code, PROVIDER_CREDENTIAL_CODE);
    assert.equal(m.seen.length, 2); // one request each, no retries
    const r3 = await anthropicMessages({ ...creds, headers: { ...creds.headers, "x-case": "429" } }, { messages: [] }, { timeoutMs: 5000, retry: { ...noSleep, maxRetries: 2 } });
    assert.equal((r3 as any).code, "RATE_LIMITED");
    assert.equal(m.seen.length, 5); // 1 + 2 retries
  } finally { await m.close(); }
});

test("minimax: process-wide gate keeps concurrency at 1 across parallel helper calls (backoff sleeps hold the slot)", async () => {
  resetMiniMaxGateForTests();
  const m = await mockAnthropic(() => ({ status: 200, body: OK_BODY }));
  try {
    const creds = resolveHelperCreds({ llmRoute: "minimax", gatewayUrl: "x" }, { MINIMAX_API_KEY: FAKE_KEY, MINIMAX_BASE_URL: m.base })!;
    const rs = await Promise.all(Array.from({ length: 5 }, () => anthropicMessages(creds, { messages: [] }, { timeoutMs: 5000 })));
    assert.ok(rs.every((r) => r.ok));
    assert.equal(m.seen.length, 5);
    assert.equal(m.maxInFlight(), 1);
  } finally { await m.close(); resetMiniMaxGateForTests(); }
});

test("ConcurrencyLimiter(2) never exceeds 2 and releases on throw; withMiniMaxRetry passes non-retryable errors through", async () => {
  const lim = new ConcurrencyLimiter(2);
  let cur = 0, peak = 0;
  const job = (fail: boolean) => lim.run(async () => { cur++; peak = Math.max(peak, cur); await new Promise((r) => setTimeout(r, 5)); cur--; if (fail) throw new Error("x"); return 1; });
  const out = await Promise.allSettled([job(false), job(true), job(false), job(true), job(false)]);
  assert.equal(peak, 2);
  assert.equal(out.filter((o) => o.status === "fulfilled").length, 3);
  assert.equal(lim.running, 0);
  let n = 0;
  const res = await withMiniMaxRetry(async () => { n++; return new Response("{}", { status: 500 }); }, noSleep);
  assert.equal(res.status, 500);
  assert.equal(n, 1);
});
