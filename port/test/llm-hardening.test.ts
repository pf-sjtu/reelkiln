// Production hardening (docs/15 §3.5): config validation, env-override/key sanity, typed errors,
// response caps, deadlines/cancellation, secret-free logs and results. All HTTP is local/mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseProviderConfigs } from "../src/main/llm/provider-config";
import { loadProviderRegistry, resolveProviderConfig } from "../src/main/llm/provider-registry";
import { anthropicMessages, helperCredsForProvider, resolveHelperCreds } from "../src/main/llm/llm-route";
import { LlmProviderError } from "../src/main/llm/errors";
import { createLogger, redact, redactText, setLoggerForTests, clearSecretsForTests, type LogRecord } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { ModelsDb } from "../src/main/models-dev/db";
import { syncModelsDev } from "../src/main/models-dev/sync";

const KEY = "sk-hardening-test-key-not-real-0123456789";
const base = (over: Record<string, unknown> = {}) => ({ name: "hx", protocol: "anthropic-messages", baseUrl: "https://llm.hx.test/anthropic", apiKeyEnv: "HX_KEY", model: "hx-1", ...over });
const isCI = (re: RegExp) => (e: unknown) => e instanceof LlmProviderError && e.code === "CONFIG_INVALID" && re.test(e.message);
function capture() {
  const logs: LogRecord[] = [];
  setLoggerForTests(createLogger({ level: "debug", sink: (r) => logs.push(r) }));
  return { logs, text: () => JSON.stringify(logs) };
}

test("config: baseUrl credentials/query/fragment/insecure http refused; loopback http + allowInsecureHttp ok; CR/LF and control chars refused", () => {
  for (const [u, re] of [["https://user:pw@llm.test/x", /credentials/], ["https://llm.test/x?key=abc", /query/], ["https://llm.test/x#f", /query string or fragment/], ["http://llm.test/x", /plain http/]] as const) {
    assert.throws(() => parseProviderConfigs([base({ baseUrl: u })], []), isCI(re), u);
  }
  for (const u of ["http://127.0.0.1:8080/v1", "http://localhost:1234", "http://[::1]:9/x"]) assert.equal(parseProviderConfigs([base({ baseUrl: u })], [])[0].baseUrl.startsWith("http://"), true, u);
  assert.equal(parseProviderConfigs([base({ baseUrl: "http://proxy.internal/v1", allowInsecureHttp: true })], [])[0].allowInsecureHttp, true);
  assert.throws(() => parseProviderConfigs([base({ headers: { "X-A": "v\r\nInjected: 1" } })], []), isCI(/line breaks/));
  assert.throws(() => parseProviderConfigs([base({ auth: { scheme: "header", header: "X-Auth", prefix: "T\n" } })], []), isCI(/line breaks/));
  assert.throws(() => parseProviderConfigs([base({ model: "m\u0007" })], []), isCI(/control/));
});

test("env overrides: invalid base URL / model ignored with a warning naming only the env var; malformed key → not configured", () => {
  const cap = capture();
  try {
    const [c] = parseProviderConfigs([base({ envOverrides: { baseUrl: "HX_BASE", model: "HX_MODEL" } })], []);
    const r = resolveProviderConfig(c, { HX_KEY: KEY, HX_BASE: "http://evil.example/steal?x=1", HX_MODEL: "bad\u0000model" })!;
    assert.equal(r.baseUrl, "https://llm.hx.test/anthropic");
    assert.equal(r.model, "hx-1");
    assert.equal(resolveProviderConfig(c, { HX_KEY: KEY, HX_BASE: "https://alt.hx.test/a/" })!.baseUrl, "https://alt.hx.test/a");
    const warn = cap.logs.filter((l) => l.event === "llm.provider.env_override_ignored");
    assert.deepEqual(warn.map((w) => w.env).sort(), ["HX_BASE", "HX_MODEL"]);
    assert.ok(!cap.text().includes("evil.example"));
    for (const badKey of ["sk-has space-inside-123", "sk-line\nbreak-123456", "sk-ünïcode-1234567"]) assert.equal(resolveProviderConfig(c, { HX_KEY: badKey }), null);
    assert.ok(cap.logs.some((l) => l.event === "llm.provider.key_invalid" && l.keyEnv === "HX_KEY"));
    assert.ok(!cap.text().includes("has space"));
  } finally { setLoggerForTests(undefined); }
});

test("logger: pattern scrubbing (sk-…, x-api-key:, URL userinfo, ?key=), numeric secret fields, failing sink never throws", () => {
  clearSecretsForTests();
  assert.equal(redactText("token sk-ant-abcdefghijklmnop1234 end"), "token [REDACTED] end");
  assert.equal(redactText("x-api-key: abcdefgh12345"), "x-api-key: [REDACTED]");
  assert.equal(redactText("Authorization: Bearer abc.def-ghi_123"), "Authorization: Bearer [REDACTED]");
  assert.equal(redactText("https://u:hunter22@host/x"), "https://u:[REDACTED]@host/x");
  assert.equal(redactText("https://h/x?api_key=abc123&y=1"), "https://h/x?api_key=[REDACTED]&y=1");
  assert.deepEqual(redact({ pin: 1, accessToken: 123456789, nested: { authorization: "Bearer zzzzzzzzzz" }, keyEnv: "HX_KEY" }), { pin: 1, accessToken: "[REDACTED]", nested: { authorization: "[REDACTED]" }, keyEnv: "HX_KEY" });
  const l = createLogger({ level: "debug", sink: () => { throw new Error("EPIPE"); } });
  assert.doesNotThrow(() => l.error("x", { a: 1 }));
  const e = new LlmProviderError("NETWORK", `failed with Bearer ${KEY}`);
  assert.ok(!JSON.stringify(e).includes(KEY));
});

type H = (req: IncomingMessage, res: ServerResponse, n: number) => void;
async function server(h: H) {
  let n = 0;
  const s = createServer((req, res) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => h(req, res, n++)); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, count: () => n, close: () => new Promise<void>((r) => { s.closeAllConnections?.(); s.close(() => r()); }) };
}
const creds = (baseUrl: string, over: Record<string, unknown> = {}) => {
  const reg = loadProviderRegistry({ json: { providers: [base({ baseUrl, ...over })] } });
  return resolveHelperCreds({ llmRoute: "hx", gatewayUrl: "x" }, { HX_KEY: KEY }, reg)!;
};
const BODY = { max_tokens: 5, messages: [{ role: "user", content: "hi" }] };

test("provider responses: non-JSON → BAD_RESPONSE without echoing the body; oversized → BAD_RESPONSE; gateway path unchanged", async () => {
  const cap = capture();
  resetProviderGatesForTests();
  const s = await server((req, res, n) => {
    if (n === 0) { res.writeHead(200, { "content-type": "text/html" }); res.end(`<html>secret-body-marker ${KEY}</html>`); return; }
    res.writeHead(200, { "content-type": "application/json" });
    const chunk = "x".repeat(1024 * 1024);
    let i = 0;
    const push = () => { while (i < 20) { i++; if (!res.write(chunk)) return res.once("drain", push); } res.end(); };
    push();
  });
  try {
    const c = creds(`${s.url}/anthropic`);
    const r1 = await anthropicMessages(c, BODY, { timeoutMs: 5000 });
    assert.deepEqual(r1, { ok: false, status: 200, reason: "response is not valid JSON (http 200)", code: "BAD_RESPONSE" });
    const r2 = await anthropicMessages(c, BODY, { timeoutMs: 10000 });
    assert.equal(r2.ok, false);
    assert.equal((r2 as any).code, "BAD_RESPONSE");
    assert.match((r2 as any).reason, /too large/);
    assert.ok(!cap.text().includes("secret-body-marker") && !cap.text().includes(KEY));
  } finally { await s.close(); setLoggerForTests(undefined); }
});

test("deadlineMs bounds retries+backoff (TIMEOUT); caller AbortSignal cancels; NETWORK reason carries the cause code, never the key", async () => {
  const cap = capture();
  resetProviderGatesForTests();
  const s = await server((req, res) => { res.writeHead(429, { "content-type": "application/json", "retry-after": "30" }); res.end("{}"); });
  try {
    const c = creds(`${s.url}/anthropic`);
    const t0 = Date.now();
    const r = await anthropicMessages(c, BODY, { timeoutMs: 5000, deadlineMs: 300 });
    assert.equal((r as any).code, "TIMEOUT");
    assert.match((r as any).reason, /deadline/);
    assert.ok(Date.now() - t0 < 3000, "deadline cut the 30s retry-after sleep");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const r2 = await anthropicMessages(c, BODY, { timeoutMs: 5000, signal: ac.signal });
    assert.equal((r2 as any).code, "TIMEOUT");
    assert.match((r2 as any).reason, /cancelled/);
  } finally { await s.close(); }
  const closed = await server(() => {});
  const deadUrl = closed.url;
  await closed.close(); // nothing listens there any more → ECONNREFUSED
  const dead = await anthropicMessages(creds(`${deadUrl}/anthropic`, { retry: { maxRetries: 0 } }), BODY, { timeoutMs: 2000 });
  assert.equal((dead as any).code, "NETWORK");
  assert.match((dead as any).reason, /ECONNREFUSED/);
  assert.ok(!cap.text().includes(KEY) && !JSON.stringify(dead).includes(KEY));
  assert.ok(!/Bearer [A-Za-z0-9]/.test(cap.text()));
  setLoggerForTests(undefined);
});

test("end-to-end: no key or Bearer token in ANY log line or result across success, 401, 429-exhausted, 500, timeout", async () => {
  const cap = capture();
  resetProviderGatesForTests();
  const plan = [200, 401, 429, 429, 500, "hang"];
  const s = await server((req, res, n) => {
    const st = plan[Math.min(n, plan.length - 1)];
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    if (st === "hang") return;
    res.writeHead(st as number, { "content-type": "application/json" });
    res.end(JSON.stringify(st === 200 ? { content: [{ type: "text", text: "ok" }] } : { error: { message: `echo ${req.headers.authorization}` } }));
  });
  const results: unknown[] = [];
  try {
    const c = creds(`${s.url}/anthropic`, { retry: { maxRetries: 1, baseDelayMs: 0 } });
    for (let i = 0; i < 5; i++) results.push(await anthropicMessages(c, BODY, { timeoutMs: 300, retry: { sleep: async () => {}, jitter: () => 0 } }));
  } finally { await s.close(); setLoggerForTests(undefined); }
  assert.deepEqual(results.map((r: any) => r.ok ? "ok" : r.code ?? `http ${r.status}`), ["ok", "PROVIDER_CREDENTIAL_MISCONFIGURED", "RATE_LIMITED", "http 500", "TIMEOUT"]);
  const all = cap.text() + JSON.stringify(results);
  assert.ok(!all.includes(KEY), "key leaked");
  assert.ok(!/Bearer\s+(?!\[REDACTED\])\S/.test(all), "bearer token leaked");
  assert.ok(cap.logs.some((l) => l.event === "llm.retry"));
  assert.ok(helperCredsForProvider);
});

test("models sync: credentials in a custom URL are never returned/stored; non-http URL refused; chunked body over the cap → TOO_LARGE, catalog untouched", async () => {
  const db = new ModelsDb(":memory:");
  const quiet = createLogger({ level: "silent" });
  try {
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(String(u)); return new Response("nope", { status: 503 }); }) as unknown as typeof fetch;
    const r = await syncModelsDev(db, { url: "https://user:hunter22@mirror.test/api.json?key=abc123", fetchImpl: f, logger: quiet });
    assert.equal(r.ok, false);
    assert.equal(seen[0], "https://user:hunter22@mirror.test/api.json?key=abc123"); // raw URL only used for the request
    assert.ok(!JSON.stringify(r).includes("hunter22") && !JSON.stringify(r).includes("abc123"));
    assert.ok(!JSON.stringify(db.getMeta()).includes("hunter22"));
    assert.equal((await syncModelsDev(db, { url: "file:///etc/passwd", fetchImpl: f, logger: quiet })).ok, false);
    const big = (async () => {
      let sent = 0;
      const chunk = new Uint8Array(4 * 1024 * 1024);
      return new Response(new ReadableStream({ pull(c) { if (sent >= 70 * 1024 * 1024) return c.close(); sent += chunk.byteLength; c.enqueue(chunk); } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r2 = await syncModelsDev(db, { url: "https://mirror.test/api.json", fetchImpl: big, logger: quiet });
    assert.equal(r2.error?.code, "TOO_LARGE");
    assert.equal(db.counts().models, 0);
  } finally { db.close(); }
});
