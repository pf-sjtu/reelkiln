// Generic custom-LLM provider framework (docs/15). All HTTP goes to local mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProviderConfigs, parseProvidersFile, MINIMAX_PRESET } from "../src/main/llm/provider-config";
import { loadProviderRegistry, getProviderRegistry, setProviderRegistry, describeProvider, ProviderRegistry, PROVIDERS_FILE_ENV } from "../src/main/llm/provider-registry";
import { buildRequestBody, endpointUrl, extractText, authHeaders } from "../src/main/llm/protocols";
import { anthropicMessages, claudeRouteEnv, claudeSdkBaseEnv, defaultSessionModel, helperCredsForProvider, llmRoutes, normalizeLlmRouteSetting, resolveHelperCreds, resolvedLlmRoute, sanitizedAgentEnv } from "../src/main/llm/llm-route";
import { LlmProviderError } from "../src/main/llm/errors";
import { createLogger, registerSecret, redact, clearSecretsForTests, setLoggerForTests, type LogRecord } from "../src/main/llm/logger";
import { resetProviderGatesForTests, withRetry, bodyCode } from "../src/main/llm/retry";
import { PROVIDER_CREDENTIAL_CODE } from "../src/main/gateway/agent-gateway-proxy";
import type { PublicSettings } from "../src/shared/ipc-contract";

const KEY = "sk-custom-test-key-not-real-abcdef";
const noSleep = { sleep: async () => {}, jitter: () => 0 };
const silent = () => setLoggerForTests(createLogger({ level: "silent" }));

function reg(providers: unknown[]): ProviderRegistry { return loadProviderRegistry({ json: { providers } }); }
const base = (over: Record<string, unknown> = {}) => ({ name: "acme", protocol: "openai-chat-completions", baseUrl: "https://llm.acme.test/v1/", apiKeyEnv: "ACME_API_KEY", model: "acme-large", ...over });

test("config: defaults applied, trailing slash trimmed, preset present, strict schema", () => {
  const [c] = parseProviderConfigs([base()], []);
  assert.equal(c.baseUrl, "https://llm.acme.test/v1");
  assert.deepEqual(c.auth, { scheme: "bearer" });
  assert.deepEqual(c.concurrency, { max: 1, cap: 64 });
  assert.equal(c.retry.maxRetries, 5);
  assert.deepEqual(c.retry.retryStatuses, [429, 529]);
  assert.deepEqual(c.retry.credentialStatuses, [401, 403]);
  assert.equal(c.timeoutMs, 60_000);
  assert.deepEqual(c.defaultParams, {});
  const r = reg([base()]);
  assert.deepEqual(r.names(), ["minimax", "acme"]);
  assert.equal(r.get("minimax")!.protocol, "anthropic-messages");
});

test("config: validation errors are CONFIG_INVALID with a path; secrets and auth headers are refused", () => {
  const bad: Array<[unknown, RegExp]> = [
    [base({ apiKey: KEY }), /secrets must not be stored/],
    [base({ token: "x" }), /secrets must not be stored/],
    [base({ name: "gateway" }), /reserved/],
    [base({ name: "Bad Name" }), /name/],
    [base({ protocol: "grpc" }), /protocol/],
    [base({ baseUrl: "ftp://x" }), /baseUrl/],
    [base({ apiKeyEnv: "has space" }), /apiKeyEnv/],
    [base({ headers: { Authorization: "Bearer x" } }), /auth headers/],
    [base({ auth: { scheme: "header" } }), /auth/],
    [base({ concurrency: { max: 0 } }), /concurrency\.max/],
    [base({ unknownField: 1 }), /unknownField|Unrecognized/],
    [base({ model: "" }), /model/],
  ];
  for (const [entry, re] of bad) {
    assert.throws(() => parseProviderConfigs([entry], []), (e: unknown) => e instanceof LlmProviderError && e.code === "CONFIG_INVALID" && re.test(e.message), JSON.stringify(entry));
  }
  assert.throws(() => parseProviderConfigs([base(), base()], []), /duplicate/);
  assert.throws(() => parseProvidersFile({ providers: "nope" }), /CONFIG_INVALID|providers/);
  // the error text never contains the would-be secret
  try { parseProviderConfigs([base({ apiKey: KEY })], []); } catch (e) { assert.ok(!String((e as Error).message).includes(KEY)); }
});

test("config: a user entry named like a preset merges over it (nested one level, auth replaced)", () => {
  const r = reg([{ name: "minimax", model: "MiniMax-M3", concurrency: { max: 2 }, auth: { scheme: "x-api-key" } }]);
  const c = r.get("minimax")!;
  assert.equal(c.model, "MiniMax-M3");
  assert.equal(c.baseUrl, MINIMAX_PRESET.baseUrl);
  assert.deepEqual(c.concurrency, { max: 2, cap: 2 });
  assert.deepEqual(c.auth, { scheme: "x-api-key" });
  assert.deepEqual(c.retry.credentialBodyCodes, [1004, 1008]);
});

test("registry: providers file via env var; missing explicit file errors; invalid file degrades to presets", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-prov-"));
  const f = join(dir, "llm-providers.json");
  writeFileSync(f, JSON.stringify({ version: 1, providers: [base()] }));
  assert.deepEqual(loadProviderRegistry({ env: { [PROVIDERS_FILE_ENV]: f } }).names(), ["minimax", "acme"]);
  assert.throws(() => loadProviderRegistry({ env: { [PROVIDERS_FILE_ENV]: join(dir, "missing.json") } }), /cannot read/);
  assert.deepEqual(loadProviderRegistry({ file: join(dir, "missing.json") }).names(), ["minimax"]); // explicit optional file
  writeFileSync(f, `{"providers":[{"name":"x","apiKey":"${KEY}"`);
  assert.throws(() => loadProviderRegistry({ file: f }), (e: any) => e.code === "CONFIG_INVALID" && !e.message.includes(KEY));
  const recs: LogRecord[] = [];
  setLoggerForTests(createLogger({ sink: (r) => recs.push(r) }));
  const prev = process.env[PROVIDERS_FILE_ENV];
  process.env[PROVIDERS_FILE_ENV] = f;
  try {
    setProviderRegistry(undefined);
    const g = getProviderRegistry();
    assert.deepEqual(g.names(), ["minimax"]);
    assert.match(g.configError!, /not valid JSON/);
    assert.equal(recs[0].event, "llm.providers.config_invalid");
    assert.ok(!JSON.stringify(recs).includes(KEY));
  } finally {
    if (prev === undefined) delete process.env[PROVIDERS_FILE_ENV]; else process.env[PROVIDERS_FILE_ENV] = prev;
    setProviderRegistry(undefined); setLoggerForTests(undefined);
  }
});

test("resolution: every protocol × auth combo → endpoint URL + headers; env overrides; summaries never expose the key", () => {
  const protocols = ["anthropic-messages", "openai-chat-completions", "openai-responses"] as const;
  const auths = [{ scheme: "x-api-key" }, { scheme: "bearer" }, { scheme: "header", header: "api-key" }, { scheme: "header", header: "X-Auth", prefix: "Token " }] as const;
  const paths = { "anthropic-messages": "/v1/messages", "openai-chat-completions": "/chat/completions", "openai-responses": "/responses" };
  const expectAuth = (a: (typeof auths)[number]) => a.scheme === "x-api-key" ? { "x-api-key": KEY } : a.scheme === "bearer" ? { authorization: `Bearer ${KEY}` } : { [a.header.toLowerCase()]: `${"prefix" in a ? a.prefix : ""}${KEY}` };
  for (const protocol of protocols) for (const auth of auths) {
    const r = reg([base({ protocol, auth, headers: { "X-Org": "o1" } })]);
    const creds = resolveHelperCreds({ llmRoute: "acme", gatewayUrl: "" }, { ACME_API_KEY: KEY }, r)!;
    assert.equal(creds.url, `https://llm.acme.test/v1${paths[protocol]}`);
    assert.deepEqual(creds.headers, { "x-org": "o1", ...expectAuth(auth), "content-type": "application/json", ...(protocol === "anthropic-messages" ? { "anthropic-version": "2023-06-01" } : {}) }, `${protocol} ${JSON.stringify(auth)}`);
    assert.equal(creds.protocol, protocol);
    assert.equal(creds.model, "acme-large");
  }
  assert.equal(endpointUrl("openai-responses", "https://x/v1///"), "https://x/v1/responses");
  assert.deepEqual(authHeaders({ scheme: "bearer" }, "k"), { authorization: "Bearer k" });
  const r = reg([base({ envOverrides: { model: "ACME_MODEL", baseUrl: "ACME_BASE", maxConcurrency: "ACME_CONC" }, concurrency: { max: 1, cap: 3 } })]);
  const p = r.resolve("acme", { ACME_API_KEY: ` ${KEY} `, ACME_MODEL: "acme-small", ACME_BASE: "http://127.0.0.1:9/", ACME_CONC: "99" })!;
  assert.deepEqual([p.key, p.model, p.baseUrl, p.maxConcurrency], [KEY, "acme-small", "http://127.0.0.1:9", 3]);
  assert.equal(r.resolve("acme", {}), null);
  assert.throws(() => r.resolveOrThrow("acme", {}), (e: any) => e.code === "KEY_MISSING" && /ACME_API_KEY is not set/.test(e.message));
  assert.throws(() => r.resolve("nope", {}), (e: any) => e.code === "UNKNOWN_PROVIDER");
  const s = JSON.stringify([r.summaries({ ACME_API_KEY: KEY }), describeProvider(p)]);
  assert.ok(!s.includes(KEY));
  assert.equal(r.summaries({ ACME_API_KEY: KEY }).find((x) => x.name === "acme")!.configured, true);
  assert.equal(r.summaries({}).find((x) => x.name === "acme")!.configured, false);
});

test("routes: any registered provider is a valid llmRoute; unknown ones fall back / are deleted; session model", () => {
  const r = reg([base()]);
  assert.deepEqual(llmRoutes(r), ["claude-code", "gateway", "minimax", "acme"]);
  assert.equal(resolvedLlmRoute({ llmRoute: "acme" }, r), "acme");
  assert.equal(resolvedLlmRoute({ llmRoute: "other" }, r), "claude-code");
  assert.deepEqual(normalizeLlmRouteSetting({ llmRoute: "acme" }, r), { llmRoute: "acme" });
  assert.deepEqual(normalizeLlmRouteSetting({ llmRoute: "other", x: 1 }, r), { x: 1 });
  assert.equal(defaultSessionModel("acme", undefined, r), "acme-large");
  assert.equal(defaultSessionModel("other", undefined, r), undefined);
  assert.equal(resolveHelperCreds({ llmRoute: "other", gatewayUrl: "" }, { ACME_API_KEY: KEY }, r), null);
});

test("child env: key read from UNSANITIZED env and passed explicitly past sanitizedAgentEnv, per auth scheme", () => {
  const parent = { PATH: "/bin", ACME_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://stale", ANTHROPIC_CUSTOM_HEADERS: "x-videoclaw-job: 1", CLAUDE_CODE_EFFORT_LEVEL: "low" };
  assert.equal(sanitizedAgentEnv(parent).ACME_API_KEY, undefined); // stripped by the original sanitizer
  const mk = (auth: unknown, extra: Record<string, unknown> = {}) => {
    const r = reg([base({ protocol: "anthropic-messages", auth, aliases: { haiku: "acme-mini" }, ...extra })]);
    return { ...claudeSdkBaseEnv(parent), ...claudeRouteEnv({ llmRoute: "acme", registry: r, env: parent }, "/profile", "x-videoclaw-job: 1") } as Record<string, string>;
  };
  const b = mk({ scheme: "bearer" }, { agentEffort: "high" });
  assert.equal(b.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(b.ANTHROPIC_API_KEY, undefined);
  assert.equal(b.ANTHROPIC_BASE_URL, "https://llm.acme.test/v1");
  assert.equal(b.ANTHROPIC_CUSTOM_HEADERS, undefined); // gateway job header never forwarded
  assert.equal(b.ANTHROPIC_DEFAULT_HAIKU_MODEL, "acme-mini");
  assert.equal(b.ANTHROPIC_DEFAULT_SONNET_MODEL, "acme-large");
  assert.equal(b.CLAUDE_CODE_EFFORT_LEVEL, "high");
  assert.equal(b.CLAUDE_CONFIG_DIR, "/profile");
  assert.equal(b.ACME_API_KEY, undefined);
  const x = mk({ scheme: "x-api-key" });
  assert.equal(x.ANTHROPIC_API_KEY, KEY);
  assert.equal(x.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(x.CLAUDE_CODE_EFFORT_LEVEL, undefined); // base env deletes it; no agentEffort configured
  const h = mk({ scheme: "header", header: "X-Auth", prefix: "Token " }, { headers: { "X-Org": "o1" } });
  assert.equal(h.ANTHROPIC_CUSTOM_HEADERS, `X-Org: o1\nX-Auth: Token ${KEY}`);
  assert.equal(h.ANTHROPIC_AUTH_TOKEN, undefined);
  // openai-* providers cannot drive the Claude Agent SDK
  const o = reg([base()]);
  assert.throws(() => claudeRouteEnv({ llmRoute: "acme", registry: o, env: parent }, "/p"), (e: any) => e.code === "UNSUPPORTED_PROTOCOL");
  assert.throws(() => claudeRouteEnv({ llmRoute: "acme", registry: o, env: {} }, "/p"), (e: any) => e.code === "KEY_MISSING" && /ACME_API_KEY/.test(e.message));
  assert.deepEqual(claudeRouteEnv({ llmRoute: "unregistered", registry: o }, "/p"), {});
});

test("protocol adapters: Anthropic-shaped helper body → chat / responses bodies; text extraction", () => {
  const body = { model: "claude-haiku-4-5", max_tokens: 64, system: "be brief", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], temperature: 0.2 };
  // an image without a usable source used to be dropped silently; now it is a typed error (llm-multimodal.test.ts)
  assert.throws(() => buildRequestBody("openai-chat-completions", { messages: [{ role: "user", content: [{ type: "image", source: {} }] }] }), (e: any) => e.code === "UNSUPPORTED_CONTENT");
  const defaults = { reasoning_effort: "low", temperature: 1 };
  assert.deepEqual(buildRequestBody("openai-chat-completions", body, { model: "m", defaultParams: defaults }), { reasoning_effort: "low", temperature: 0.2, model: "m", messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }], max_tokens: 64 });
  assert.deepEqual(buildRequestBody("openai-responses", body, { model: "m" }), { temperature: 0.2, model: "m", input: [{ role: "user", content: "hi" }], instructions: "be brief", max_output_tokens: 64 });
  assert.deepEqual(buildRequestBody("anthropic-messages", body, { model: "m", defaultParams: { thinking: { type: "enabled", budget_tokens: 1024 } } }), { thinking: { type: "enabled", budget_tokens: 1024 }, ...body, model: "m" });
  assert.equal(extractText("openai-chat-completions", { choices: [{ message: { content: "yo", reasoning_content: "…" } }] }), "yo");
  assert.equal(extractText("openai-responses", { output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "a" }, { type: "output_text", text: "b" }] }] }), "ab");
  assert.equal(extractText("openai-responses", { output_text: "direct" }), "direct");
  assert.equal(extractText("anthropic-messages", { content: [{ type: "thinking" }, { type: "text", text: "t" }] }), "t");
  assert.throws(() => extractText("openai-chat-completions", { error: {} }), (e: any) => e.code === "BAD_RESPONSE");
});

type Handler = (req: IncomingMessage, body: any) => { status: number; headers?: Record<string, string>; body: unknown };
async function mock(handler: Handler) {
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
      setTimeout(() => { inFlight--; res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) }); res.end(JSON.stringify(r.body)); }, 10);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, maxInFlight: () => maxInFlight, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("helper call end-to-end (mock) for openai-chat-completions with custom header auth + config retry policy", async () => {
  silent(); resetProviderGatesForTests();
  const statuses = [503, 503];
  const m = await mock((req) => {
    const s = statuses.shift();
    return s ? { status: s, body: { error: { code: "overloaded" } } } : { status: 200, body: { choices: [{ message: { role: "assistant", content: "pong" } }] } };
  });
  try {
    const r = reg([base({ baseUrl: m.url + "/v1", auth: { scheme: "header", header: "api-key" }, retry: { retryStatuses: [503], maxRetries: 3, baseDelayMs: 1 }, defaultParams: { reasoning_effort: "low" } })]);
    const creds = resolveHelperCreds({ llmRoute: "acme", gatewayUrl: "" }, { ACME_API_KEY: KEY }, r)!;
    const retries: number[] = [];
    const res = await anthropicMessages(creds, { model: "claude-haiku", max_tokens: 8, messages: [{ role: "user", content: "ping" }] }, { timeoutMs: 5000, retry: { ...noSleep, onRetry: (i) => retries.push(i.status) } });
    assert.deepEqual(res, { ok: true, text: "pong" });
    assert.deepEqual(retries, [503, 503]);
    assert.equal(m.seen.length, 3);
    for (const s of m.seen) {
      assert.equal(s.path, "/v1/chat/completions");
      assert.equal(s.headers["api-key"], KEY);
      assert.equal(s.headers.authorization, undefined);
      assert.deepEqual(s.body, { reasoning_effort: "low", model: "acme-large", messages: [{ role: "user", content: "ping" }], max_tokens: 8 });
    }
  } finally { await m.close(); setLoggerForTests(undefined); }
});

test("helper call (mock) for openai-responses + bearer; credential body code from config is not retried; 500 passes through", async () => {
  silent(); resetProviderGatesForTests();
  const m = await mock((req) => req.headers["x-case"] === "cred" ? { status: 400, body: { error: { code: 4011 } } }
    : req.headers["x-case"] === "500" ? { status: 500, body: {} }
    : { status: 200, body: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } });
  try {
    const r = reg([base({ protocol: "openai-responses", baseUrl: m.url, retry: { bodyCodePath: "error.code", credentialBodyCodes: [4011] } })]);
    const creds = resolveHelperCreds({ llmRoute: "acme", gatewayUrl: "" }, { ACME_API_KEY: KEY }, r)!;
    assert.deepEqual(await anthropicMessages(creds, { messages: [{ role: "user", content: "x" }] }, { timeoutMs: 5000, retry: noSleep }), { ok: true, text: "ok" });
    assert.equal(m.seen[0].path, "/responses");
    assert.equal(m.seen[0].headers.authorization, `Bearer ${KEY}`);
    const c = await anthropicMessages({ ...creds, headers: { ...creds.headers, "x-case": "cred" } }, { messages: [] }, { timeoutMs: 5000, retry: noSleep });
    assert.equal((c as any).code, PROVIDER_CREDENTIAL_CODE);
    assert.match((c as any).reason, /ACME_API_KEY/);
    assert.ok(!JSON.stringify(c).includes(KEY));
    const f = await anthropicMessages({ ...creds, headers: { ...creds.headers, "x-case": "500" } }, { messages: [] }, { timeoutMs: 5000, retry: noSleep });
    assert.deepEqual(f, { ok: false, status: 500, reason: "http 500" });
    assert.equal(m.seen.length, 3);
  } finally { await m.close(); setLoggerForTests(undefined); }
});

test("per-provider gates: concurrency from config (2), independent across providers; network error → typed NETWORK", async () => {
  silent(); resetProviderGatesForTests();
  const m = await mock(() => ({ status: 200, body: { choices: [{ message: { content: "x" } }] } }));
  try {
    const r = reg([base({ baseUrl: m.url, concurrency: { max: 2 } })]);
    const creds = helperCredsForProvider(r.resolve("acme", { ACME_API_KEY: KEY })!);
    const rs = await Promise.all(Array.from({ length: 6 }, () => anthropicMessages(creds, { messages: [] }, { timeoutMs: 5000 })));
    assert.ok(rs.every((x) => x.ok));
    assert.equal(m.maxInFlight(), 2);
  } finally { await m.close(); }
  const r = reg([base({ name: "down", baseUrl: "http://127.0.0.1:1", retry: { retryStatuses: [] } })]);
  const res = await anthropicMessages(helperCredsForProvider(r.resolve("down", { ACME_API_KEY: KEY })!), { messages: [] }, { timeoutMs: 2000 });
  assert.equal(res.ok, false);
  assert.equal((res as any).code, "NETWORK");
  resetProviderGatesForTests(); setLoggerForTests(undefined);
});

test("timeout per attempt → typed TIMEOUT", async () => {
  silent(); resetProviderGatesForTests();
  const r = reg([base()]);
  const creds = helperCredsForProvider(r.resolve("acme", { ACME_API_KEY: KEY })!);
  const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(new Error("aborted"))));
  const res = await anthropicMessages(creds, { messages: [] }, { timeoutMs: 20, fetchImpl: hang });
  assert.equal((res as any).code, "TIMEOUT");
  setLoggerForTests(undefined);
});

test("withRetry: retry-after honoured and capped by policy maxDelayMs; exhaustion → RATE_LIMITED; bodyCode path", async () => {
  const delays: number[] = [];
  let n = 0;
  const policy = { ...parseProviderConfigs([base()], [])[0].retry, maxRetries: 2, maxDelayMs: 5000 };
  await assert.rejects(withRetry(async () => { n++; return new Response("{}", { status: 429, headers: { "retry-after": "120" } }); }, policy, { sleep: async (ms) => { delays.push(ms); } }), (e: any) => e.code === "RATE_LIMITED" && e.retryable);
  assert.equal(n, 3);
  assert.deepEqual(delays, [5000, 5000]);
  assert.equal(bodyCode('{"base_resp":{"status_code":1002}}', "base_resp.status_code"), 1002);
  assert.equal(bodyCode('{"error":{"code":"42"}}', "error.code"), 42);
  assert.equal(bodyCode("not json", "a"), undefined);
});

test("logger: secret-named fields and registered secret values are redacted everywhere", () => {
  clearSecretsForTests();
  registerSecret(KEY);
  const recs: LogRecord[] = [];
  const log = createLogger({ sink: (r) => recs.push(r), level: "debug" }).child({ provider: "acme" });
  log.info("x", { apiKey: "whatever", gatewayKey: "g", headers: { authorization: "Bearer abcdefghijkl", "x-api-key": "zzz" }, msg: `failed with ${KEY}`, apiKeyEnv: "ACME_API_KEY", usage: { input_tokens: 3 } });
  const s = JSON.stringify(recs);
  assert.ok(!s.includes(KEY) && !s.includes("whatever") && !s.includes("abcdefghijkl") && !s.includes("zzz"));
  assert.match(s, /ACME_API_KEY/);
  assert.equal((recs[0] as any).usage.input_tokens, 3);
  assert.equal(recs[0].provider, "acme");
  assert.deepEqual(redact(new LlmProviderError("NETWORK", `boom ${KEY}`)), { name: "LlmProviderError", message: "boom [REDACTED]", code: "NETWORK" });
  const quiet: LogRecord[] = [];
  createLogger({ sink: (r) => quiet.push(r), level: "warn" }).info("dropped");
  assert.equal(quiet.length, 0);
});

test("shipped example providers file validates; settings type accepts provider routes", () => {
  const r = loadProviderRegistry({ file: join(process.cwd(), "config/llm-providers.example.json"), env: {} });
  assert.deepEqual(r.names(), ["minimax", "minimax-openai", "my-anthropic-proxy", "deepseek", "azure-openai"]);
  assert.equal(r.get("minimax-openai")!.chatMaxTokensField, "max_completion_tokens"); // verified live 2026-10-21 (docs/15 §0)
  assert.equal(r.get("minimax")!.agentEffort, "medium");
  assert.equal(r.get("minimax")!.baseUrl, "https://api.minimaxi.com/anthropic");
  assert.deepEqual(r.get("azure-openai")!.auth, { scheme: "header", header: "api-key", prefix: "" });
  const s: PublicSettings = { gatewayUrl: "x", telemetry: false, llmRoute: "deepseek" };
  const t: PublicSettings = { gatewayUrl: "x", telemetry: false, llmRoute: "claude-code" };
  assert.equal(normalizeLlmRouteSetting({ ...s }, r).llmRoute, "deepseek");
  assert.equal(normalizeLlmRouteSetting({ ...t }, r).llmRoute, "claude-code");
});
