// Main-process LLM route wiring (docs/15 §3.4): settings store, route service, createLocalRuntime
// env, helper creds, readiness, IPC handlers, hot-reload interplay. Differential against the
// original text where the original has an equivalent; all HTTP goes to local mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalOriginal, fnText, lineOf, slice } from "./original-source";
import { loadOriginalChunk } from "./original-loader";
import { rendererWritableSettingsPatch, SettingsStore, PROD_GATEWAY_URL, normalizedAlphaConsentRecords } from "../src/main/settings/settings-store";
import { anthropicClientJobCustomHeaders, LlmRouteService, CLAUDEAI_CONNECTORS_OFF, CLAUDE_CODE_NO_SELF_STARTING_WORK } from "../src/main/llm/route-service";
import { createLlmRuntime } from "../src/main/llm-runtime";
import { loadProviderRegistry, reloadProviderRegistry, setProviderRegistry, getProviderRegistry, PROVIDERS_FILE_ENV, type ProviderRegistry } from "../src/main/llm/provider-registry";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";

const KEY = "acme-wiring-test-key-not-real-123456";
const MM = "mm-wiring-test-key-not-real-0000000";
const silent = () => setLoggerForTests(createLogger({ level: "silent" }));
const tmp = () => mkdtempSync(join(tmpdir(), "vc-wire-"));
const acme = (over: Record<string, unknown> = {}) => ({ name: "acme", protocol: "anthropic-messages", baseUrl: "https://llm.acme.test/anthropic", apiKeyEnv: "ACME_API_KEY", model: "acme-large", aliases: { haiku: "acme-small" }, ...over });
const regWith = (providers: unknown[]): ProviderRegistry => loadProviderRegistry({ json: { providers } });

function blockText(startRe: RegExp, endLine: string): string { const a = lineOf(startRe); let b = a; while (slice(b, b) !== endLine) b++; return slice(a, b); }
function originalSettingsClass(write: (file: string, v: unknown) => void) {
  const code = [blockText(/^const APP_SETTINGS_KEYS = \[/, "];"), "const KEY_ID_RE$1 = /^[a-f0-9]{64}$/;", fnText(/^function normalizedAlphaConsentRecords\(/), fnText(/^class Settings \{/)].join("\n");
  return evalOriginal<any>(code, "Settings", { readFileSync, PROD_GATEWAY_URL, writeSettingsFile: write });
}

test("SettingsStore: differential vs original Settings (L5291) — load/normalise/get/patch/written bytes/legacy creds", () => {
  silent();
  const dir = tmp();
  try {
    const OrigSettings = originalSettingsClass((_f, v) => origWrites.push(JSON.parse(JSON.stringify(v))));
    const origWrites: unknown[] = [];
    const portWrites: unknown[] = [];
    const reg = regWith([]);
    const files: unknown[] = [
      {}, "not json", [], { gatewayUrl: "  ", telemetry: false },
      { gatewayUrl: "https://gw.example", llmRoute: "gateway", llmRouteAcknowledgedAt: 5, agentHarness: "bogus", codexProvider: "openrouter", codexModel: "  m  ", extra: { a: 1 } },
      // NB a provider-SHAPED unregistered value (e.g. "codex") is a documented PORT-NEW divergence:
      // hidden from get() like the original, but parked on disk (see the PORT-NEW test below).
      { llmRoute: "Codex Route", llmRouteAcknowledgedAt: -1, codexModel: "x", alphaConsentsByKey: { ["a".repeat(64)]: { acceptedAt: 3, beaconQueuedAt: 0 }, bad: { acceptedAt: 1 } } },
      { gatewayKey: "vc_legacy", gatewayKeys: { "https://a": "k" }, accountSignedInOnce: true, gatewayUrl: "https://a/" },
      { llmRoute: 7, llmRouteAcknowledgedAt: "x", gatewayKeyEncrypted: "zzz" },
    ];
    for (const [i, content] of files.entries()) {
      const f = join(dir, `s${i}.json`);
      writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
      const o = new OrigSettings(f, "https://default.gw");
      const p = new SettingsStore(f, "https://default.gw", undefined, { registry: () => reg, write: (_f, v) => portWrites.push(JSON.parse(JSON.stringify(v))) });
      assert.deepEqual(p.get(), o.get(), `get #${i}`);
      assert.deepEqual(p.legacyCredentials(), o.legacyCredentials(), `legacy #${i}`);
      assert.equal(p.legacySignedInOnceFor("https://a"), o.legacySignedInOnceFor("https://a"));
      for (const patch of [{ telemetry: false }, { codexProvider: "openai-api" }, { gatewayUrl: "https://b", llmRoute: "gateway" }]) assert.deepEqual(p.patch(patch), o.patch(patch), `patch #${i}`);
    }
    assert.deepEqual(portWrites, origWrites);
    assert.deepEqual(normalizedAlphaConsentRecords({ ["b".repeat(64)]: { acceptedAt: 1 } }), { ["b".repeat(64)]: { acceptedAt: 1 } });
  } finally { rmSync(dir, { recursive: true, force: true }); setLoggerForTests(undefined); }
});

test("rendererWritableSettingsPatch: differential vs original L5107; PORT-NEW llmRoute filter by registry", () => {
  const orig = evalOriginal<(p: any) => any>(fnText(/^function rendererWritableSettingsPatch\(/), "rendererWritableSettingsPatch");
  const patches = [
    {}, { gatewayUrl: "x", gatewayKey: "k", openaiApiKey: "o", providerKeys: {}, usageSharingConsentAt: 1, telemetry: false },
    { agentHarness: "nope", codexProvider: "chatgpt", codexModel: "  m " }, { codexProvider: "openrouter", codexModel: "  " }, { codexProvider: "openai-api", codexModel: " g " },
    { codexModel: "orphan" }, { llmRoute: "gateway" }, { llmRoute: "claude-code" },
  ];
  for (const p of patches) assert.deepEqual(rendererWritableSettingsPatch(structuredClone(p)), orig(structuredClone(p)), JSON.stringify(p));
  const reg = regWith([acme()]);
  assert.deepEqual(rendererWritableSettingsPatch({ llmRoute: "acme" }, reg), { llmRoute: "acme" });
  assert.deepEqual(rendererWritableSettingsPatch({ llmRoute: "nope", telemetry: true }, reg), { telemetry: true });
  assert.deepEqual(rendererWritableSettingsPatch({ llmRoute: "gateway" }, reg), { llmRoute: "gateway" });
});

test("SettingsStore PORT-NEW: provider route kept when registered, parked (hidden but preserved on disk) when not, re-adopted on revalidate", () => {
  const dir = tmp();
  try {
    const f = join(dir, "settings.json");
    writeFileSync(f, JSON.stringify({ llmRoute: "acme", telemetry: false }));
    let reg = regWith([]);
    const s = new SettingsStore(f, "https://gw", undefined, { registry: () => reg });
    assert.equal(s.get().llmRoute, undefined);
    assert.equal(s.parkedLlmRoute(), "acme");
    s.patch({ telemetry: true });
    assert.equal(JSON.parse(readFileSync(f, "utf8")).llmRoute, "acme"); // preserved on disk
    reg = regWith([acme()]);
    assert.equal(s.revalidateLlmRoute(), true);
    assert.equal(s.get().llmRoute, "acme");
    reg = regWith([]);
    assert.equal(s.revalidateLlmRoute(), true);
    assert.equal(s.get().llmRoute, undefined);
    s.patch({ llmRoute: "gateway" }); // explicit choice drops the parked one
    assert.equal(s.parkedLlmRoute(), undefined);
    assert.equal(JSON.parse(readFileSync(f, "utf8")).llmRoute, "gateway");
    writeFileSync(f, JSON.stringify({ llmRoute: "Not A Provider!" }));
    assert.equal(new SettingsStore(f, "https://gw", undefined, { registry: () => reg }).parkedLlmRoute(), undefined); // garbage is dropped like the original
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function originalHostMethods(settings: () => any) {
  const method = (re: RegExp) => blockText(re, "  }");
  const code = `const DEFAULT_LLM_ROUTE = "claude-code";\n${fnText(/^function resolvedLlmRoute\(/)}\nconst host = { settings, ${[method(/^  sessionLlmRoute\(meta\) \{/), method(/^  sessionHelperKind\(meta\) \{/), method(/^  sessionModel\(meta\) \{/)].join(",\n")} };`;
  return evalOriginal<any>(code, "host", { settings });
}

test("LlmRouteService: sessionLlmRoute / sessionHelperKind / sessionModel differential vs original AgentHost (L40822-40872); provider routes", () => {
  for (const globalRoute of [undefined, "claude-code", "gateway", "junk"]) {
    const cfg = { gatewayUrl: "https://gw", llmRoute: globalRoute };
    const host = originalHostMethods(() => cfg);
    const svc = new LlmRouteService({ settings: () => cfg, registry: () => regWith([acme()]), env: () => ({ ACME_API_KEY: KEY }), profileDir: () => "/p" });
    for (const meta of [{}, { runtime: "remote" }, { llmRoute: "gateway" }, { llmRoute: "claude-code" }, { llmRoute: 3 }, { agentHarness: "codex-app-server", modelOverride: "gpt" }, { modelOverride: "opus" }, { runtime: "remote", modelOverride: "x" }]) {
      assert.equal(svc.sessionLlmRoute(meta as any), host.sessionLlmRoute(meta), `route ${globalRoute} ${JSON.stringify(meta)}`);
      assert.equal(svc.sessionHelperKind(meta as any), host.sessionHelperKind(meta), `kind ${JSON.stringify(meta)}`);
      assert.equal(svc.sessionModel(meta as any), host.sessionModel(meta), `model ${JSON.stringify(meta)}`);
    }
  }
  const svc = new LlmRouteService({ settings: () => ({ gatewayUrl: "https://gw", llmRoute: "acme" }), registry: () => regWith([acme()]), env: () => ({ ACME_API_KEY: KEY }), profileDir: () => "/p" });
  assert.equal(svc.resolvedRoute(), "acme");
  assert.equal(svc.newSessionLlmRoute(), "acme");
  assert.equal(svc.newSessionLlmRoute({ runtime: "remote" }), "gateway");
  assert.equal(svc.newSessionLlmRoute({ agentHarness: "codex-app-server" }), undefined);
  assert.equal(svc.sessionLlmRoute({}), "acme");
  assert.equal(svc.sessionHelperKind({}), "claude-provider");
  assert.equal(svc.sessionModel({}), "acme-large");
  assert.equal(svc.sessionModel({ modelOverride: "acme-xl" }), "acme-xl");
  assert.equal(svc.sessionLlmRoute({ llmRoute: "removed-provider" }), "removed-provider"); // pinned: fail closed, never re-routed
});

test("localRuntimeEnv: differential vs original createLocalRuntime env (L23214-23230 + L23282-23321) for claude-code/gateway; provider branch", async () => {
  const chunk = await loadOriginalChunk("workbookContents");
  for (const job of ["job-1", "bad job!", undefined]) assert.equal(anthropicClientJobCustomHeaders(job), chunk.a2(job));
  const parentEnv = { PATH: "/bin", HOME: "/h", ACME_API_KEY: KEY, ANTHROPIC_BASE_URL: "https://stale", ANTHROPIC_CUSTOM_HEADERS: "x: y", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_EFFORT_LEVEL: "max", PARENT_SECRET_TOKEN: "s3cr3t-s3cr3t", LD_PRELOAD: "x" };
  const denylist = blockText(/^const AGENT_STARTUP_ENV_DENYLIST = /, "]);");
  const sanitized = evalOriginal<(e: any) => any>(`${denylist}\n${fnText(/^function sanitizedAgentEnv\(/)}`, "sanitizedAgentEnv");
  const a = lineOf(/^  const customHeaders =$/);
  const b = lineOf(/^  sdkEnv\.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = "1";$/);
  const envStart = 23282, envEnd = 23321;
  assert.equal(slice(envStart, envStart).trim(), "env: {");
  const consts = blockText(/^const CLAUDEAI_CONNECTORS_OFF = /, "};");
  const origEnv = evalOriginal<(deps: any) => any>(
    `${consts}\nfunction build(deps) { const { sessionContext, tenant, gateway } = deps;\n${slice(a, b)}\nreturn ({ ${slice(envStart, envEnd).trim().replace(/^env: \{/, "").replace(/\},$/, "")} }); }`,
    "build", { anthropicClientJobCustomHeaders: chunk.a2, sanitizedAgentEnv: () => sanitized(parentEnv) },
  );
  assert.deepEqual({ ...CLAUDEAI_CONNECTORS_OFF, ...CLAUDE_CODE_NO_SELF_STARTING_WORK }, evalOriginal(`${consts}`, "({...CLAUDEAI_CONNECTORS_OFF, ...CLAUDE_CODE_NO_SELF_STARTING_WORK})"));
  const svc = new LlmRouteService({ settings: () => ({ gatewayUrl: "https://gw" }), registry: () => regWith([acme()]), env: () => parentEnv, profileDir: () => "/profile" });
  const cases = [
    { gateway: { llmRoute: "claude-code" }, engineEnv: {}, sessionContext: { assembled: false } },
    { gateway: { llmRoute: "gateway", gatewayKey: "vc_k", gatewayUrl: "https://gw", clientJob: "job-7" }, engineEnv: { VIDEOCLAW_ENGINE: "/e" }, sessionContext: { assembled: true }, tenant: "humeo" },
    { gateway: { llmRoute: "gateway", gatewayUrl: "https://gw" }, engineEnv: {}, sessionContext: { assembled: false } }, // keyless gateway → no route env
  ];
  for (const c of cases) assert.deepEqual(svc.localRuntimeEnv({ ...c, profileDir: "/profile" } as any), origEnv({ ...c, profileDir: "/profile" }), JSON.stringify(c.gateway));
  const p = svc.localRuntimeEnv({ gateway: { llmRoute: "acme", clientJob: "job-7" }, engineEnv: { VIDEOCLAW_ENGINE: "/e" }, sessionContext: { assembled: true }, profileDir: "/profile" });
  const cc = origEnv({ gateway: { llmRoute: "claude-code" }, engineEnv: { VIDEOCLAW_ENGINE: "/e" }, sessionContext: { assembled: true }, profileDir: "/profile" });
  const routeKeys = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CONFIG_DIR"];
  assert.deepEqual(Object.fromEntries(Object.entries(p).filter(([k]) => !routeKeys.includes(k))), cc); // everything else identical to the original claude-code env
  assert.equal(p.ANTHROPIC_BASE_URL, "https://llm.acme.test/anthropic");
  assert.equal(p.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(p.ANTHROPIC_DEFAULT_HAIKU_MODEL, "acme-small");
  assert.equal(p.ANTHROPIC_DEFAULT_OPUS_MODEL, "acme-large");
  assert.equal(p.CLAUDE_CONFIG_DIR, "/profile");
  assert.equal((p as any).ANTHROPIC_CUSTOM_HEADERS, undefined); // gateway job header never sent to a third party
  assert.equal((p as any).PARENT_SECRET_TOKEN, undefined);
  assert.equal((p as any).ACME_API_KEY, undefined);
  assert.throws(() => svc.localRuntimeEnv({ gateway: { llmRoute: "gone" }, profileDir: "/p" }), (e: any) => e.code === "UNKNOWN_PROVIDER");
  const noKey = new LlmRouteService({ settings: () => ({ gatewayUrl: "x" }), registry: () => regWith([acme()]), env: () => ({}), profileDir: () => "/p" });
  assert.throws(() => noKey.localRuntimeEnv({ gateway: { llmRoute: "acme" }, profileDir: "/p" }), (e: any) => e.code === "KEY_MISSING" && !String(e.message).includes(KEY));
  const oa = new LlmRouteService({ settings: () => ({ gatewayUrl: "x" }), registry: () => regWith([acme({ protocol: "openai-chat-completions" })]), env: () => parentEnv, profileDir: () => "/p" });
  assert.throws(() => oa.localRuntimeEnv({ gateway: { llmRoute: "acme" }, profileDir: "/p" }), (e: any) => e.code === "UNSUPPORTED_PROTOCOL");
});

test("sessionRuntimeConfig → a REAL child process receives base URL, auth token (past sanitizedAgentEnv), aliases, isolated profile; no other secret leaks", () => {
  const parentEnv = { ...process.env, ACME_API_KEY: KEY, PARENT_SECRET_TOKEN: "parent-secret-value-xyz", OPENAI_API_KEY: "should-not-pass-0000" } as NodeJS.ProcessEnv;
  const svc = new LlmRouteService({ settings: () => ({ gatewayUrl: "https://gw", llmRoute: "acme" }), registry: () => regWith([acme({ agentEffort: "low" })]), env: () => parentEnv, profileDir: () => "/tmp/vc-profile" });
  const cfg = svc.sessionRuntimeConfig({ jobId: "job-1" }, { engineEnv: { VIDEOCLAW_ENGINE: "/engine" } });
  assert.equal(cfg.llmRoute, "acme");
  assert.equal(cfg.model, "acme-large");
  const script = `const e=process.env;const h=(v)=>v?require("crypto").createHash("sha256").update(v).digest("hex"):null;console.log(JSON.stringify({tok:h(e.ANTHROPIC_AUTH_TOKEN),base:e.ANTHROPIC_BASE_URL,model:e.ANTHROPIC_MODEL,haiku:e.ANTHROPIC_DEFAULT_HAIKU_MODEL,cfg:e.CLAUDE_CONFIG_DIR,effort:e.CLAUDE_CODE_EFFORT_LEVEL,engine:e.VIDEOCLAW_ENGINE,secretish:Object.keys(e).filter(k=>/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i.test(k)).sort()}))`;
  const out = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: cfg.env, encoding: "utf8" }));
  assert.deepEqual(out, {
    tok: createHash("sha256").update(KEY).digest("hex"), base: "https://llm.acme.test/anthropic", model: "acme-large", haiku: "acme-small", cfg: "/tmp/vc-profile",
    effort: "low", engine: "/engine", secretish: ["ANTHROPIC_AUTH_TOKEN"],
  });
});

test("helper creds + readiness per route; helper request for a provider video reaches the provider (mock)", async () => {
  silent();
  resetProviderGatesForTests();
  const seen: any[] = [];
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text: "Title" }] })); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/anthropic`;
    const reg = regWith([acme({ baseUrl: base }), acme({ name: "oai", protocol: "openai-chat-completions" })]);
    let env: NodeJS.ProcessEnv = { ACME_API_KEY: KEY };
    const svc = new LlmRouteService({ settings: () => ({ gatewayUrl: "https://gw", llmRoute: "claude-code" }), registry: () => reg, env: () => env, profileDir: () => "/p" });
    assert.equal(svc.sessionHelperCreds(undefined), null);
    assert.equal(svc.sessionHelperCreds({}), null); // claude-code → no helper creds (original)
    assert.equal(svc.sessionHelperCreds({ llmRoute: "gateway" }), null); // no gateway key (vault not ported)
    assert.equal(svc.sessionHelperCreds({ agentHarness: "codex-app-server", llmRoute: "acme" }), null);
    assert.equal(svc.sessionHelperCreds({ llmRoute: "gone" }), null);
    const r = await svc.sessionHelperComplete({ llmRoute: "acme" }, { model: "claude-haiku-4-5-20251001", max_tokens: 20, messages: [{ role: "user", content: "title?" }] }, { timeoutMs: 5000 });
    assert.deepEqual(r, { ok: true, text: "Title" });
    assert.equal(seen[0].url, "/anthropic/v1/messages");
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    assert.equal(seen[0].body.model, "acme-large");
    assert.deepEqual(await svc.llmRouteReadiness({ llmRoute: "acme" }), { route: "acme", ready: true });
    assert.deepEqual(await svc.llmRouteReadiness({ llmRoute: "oai" }), { route: "oai", ready: false, reason: "provider-protocol-unsupported", protocol: "openai-chat-completions" });
    assert.deepEqual(await svc.llmRouteReadiness({ llmRoute: "gone" }), { route: "gone", ready: false, reason: "provider-unavailable" });
    assert.deepEqual(await svc.llmRouteReadiness({ llmRoute: "gateway" }), { route: "gateway", ready: true }); // original: non-claude-code → ready
    assert.deepEqual(await svc.llmRouteReadiness({ agentHarness: "codex-app-server", llmRoute: "acme" }), { route: "acme", ready: true });
    assert.equal(await svc.llmRouteReadiness({}), undefined); // claude-code presence probe not ported
    env = {};
    assert.deepEqual(await svc.llmRouteReadiness({ llmRoute: "acme" }), { route: "acme", ready: false, reason: "provider-key-missing", keyEnv: "ACME_API_KEY" });
    assert.equal((await svc.sessionHelperComplete({ llmRoute: "acme" }, { messages: [] }, { timeoutMs: 1000 })).ok, false);
  } finally { await new Promise<void>((r) => server.close(() => r())); setLoggerForTests(undefined); }
});

test("createLlmRuntime: IPC handlers settings:get/set + engine:llmRouteReadiness; route-change hook; provider removed by hot reload → fallback + hook, restored → re-adopted", async () => {
  silent();
  const dir = tmp();
  const pfile = join(dir, "providers.json");
  writeFileSync(pfile, JSON.stringify({ providers: [acme()] }));
  const env = { [PROVIDERS_FILE_ENV]: pfile, ACME_API_KEY: KEY, MINIMAX_API_KEY: MM };
  setProviderRegistry(loadProviderRegistry({ env }));
  let changes = 0;
  const rt = createLlmRuntime({ userData: dir, env, watch: false, sighup: false, defaultGatewayUrl: "https://gw", onLlmRouteChanged: () => changes++, sessionMeta: (id) => (id === "s1" ? { llmRoute: "minimax" } : undefined) });
  try {
    const h = rt.handlers as Record<string, (...a: any[]) => Promise<any>>;
    assert.deepEqual(await h["settings:get"](), { gatewayUrl: "https://gw", telemetry: true, alphaConsentsByKey: {} });
    let s = await h["settings:set"]({ llmRoute: "acme", gatewayKey: "nope" });
    assert.equal(s.llmRoute, "acme");
    assert.equal(changes, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).gatewayKey, undefined);
    s = await h["settings:set"]({ llmRoute: "not-registered" }); // stripped → unchanged
    assert.equal(s.llmRoute, "acme");
    assert.equal(changes, 1);
    assert.deepEqual(await h["engine:llmRouteReadiness"](undefined), { route: "acme", ready: true });
    assert.deepEqual(await h["engine:llmRouteReadiness"]("s1"), { route: "minimax", ready: true });
    assert.deepEqual(await h["engine:llmRouteReadiness"]("unknown"), { route: "acme", ready: true });
    // provider removed by a config reload
    writeFileSync(pfile, JSON.stringify({ providers: [] }));
    reloadProviderRegistry({ env });
    assert.equal(changes, 2);
    assert.equal((await h["settings:get"]()).llmRoute, undefined);
    assert.equal(rt.service.resolvedRoute(), "claude-code");
    await h["settings:set"]({ telemetry: false });
    assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).llmRoute, "acme"); // user's choice preserved on disk
    // invalid config → presets only; still claude-code; no extra hook
    writeFileSync(pfile, "{");
    reloadProviderRegistry({ env });
    assert.ok(getProviderRegistry().configError);
    assert.equal(changes, 2);
    writeFileSync(pfile, JSON.stringify({ providers: [acme()] }));
    reloadProviderRegistry({ env });
    assert.equal((await h["settings:get"]()).llmRoute, "acme");
    assert.equal(changes, 3);
    const cfg = rt.service.sessionRuntimeConfig({});
    assert.equal(cfg.env.CLAUDE_CONFIG_DIR, join(dir, "engine-profile"));
  } finally { rt.dispose(); setProviderRegistry(undefined); setLoggerForTests(undefined); rmSync(dir, { recursive: true, force: true }); }
});
