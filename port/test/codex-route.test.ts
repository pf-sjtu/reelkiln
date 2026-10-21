// docs/27: the Codex route on MiniMax — Responses structured-output emulation, the gate proxy's OpenAI
// surface, the CodexRouteController (status/models/route refusal/pins), the Codex runtime driven through
// the port AgentHost (fake app-server client: no network, no key, no codex binary), and the IPC channels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { startAgentGateProxy } from "../src/main/llm/agent-gate-proxy";
import { ResponsesStructuredSseRewriter, rewriteResponsesStructuredJson, rewriteResponsesStructuredRequest } from "../src/main/llm/structured-emulation-responses";
import { CODEX_MINIMAX_TOKEN_ENV, codexMiniMaxConfig, codexVendorLayout, discoverMiniMaxCodexModels, ensureCodexProfile, resolveCodexExecutable, resolveMiniMaxCodexProvider } from "../src/main/codex/codex-minimax";
import { CodexRouteController, portCodexEvidence, resolvedAgentHarness, resolvedCodexProvider } from "../src/main/codex/codex-host";
import { codexChannels } from "../src/main/codex/codex-channels";
import { AgentHost, type SessionEvent } from "../src/main/agent/agent-host";
import { codexChildEnv } from "../src/main/codex/codex-protocol.generated";

const silent = () => setLoggerForTests(createLogger({ level: "silent" }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 3000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(5); } }
const FAKE_KEY = "mm-test-key-0123456789";
const provider = (baseUrl = "https://api.minimaxi.com/v1") => resolveMiniMaxCodexProvider({ MINIMAX_API_KEY: FAKE_KEY, MINIMAX_OPENAI_BASE_URL: baseUrl })!;
const SCHEMA = { type: "object", properties: { fruit: { type: "string" } }, required: ["fruit"], additionalProperties: false };

test("Responses structured emulation: text.format json_schema → forced function tool; response → message/output_text", () => {
  const req = rewriteResponsesStructuredRequest({ model: "m", input: "x", text: { format: { type: "json_schema", name: "a", schema: SCHEMA, strict: true }, verbosity: "low" } })!;
  assert.deepEqual(req.tool_choice, { type: "function", name: "structured_output" });
  assert.equal(req.tools[0].name, "structured_output");
  assert.deepEqual(req.tools[0].parameters, SCHEMA);
  assert.deepEqual(req.text, { verbosity: "low" });
  const withTools = rewriteResponsesStructuredRequest({ tools: [{ type: "function", name: "exec_command" }], text: { format: { type: "json_schema", schema: SCHEMA } } })!;
  assert.equal(withTools.tool_choice, "required");
  assert.equal(withTools.tools.length, 2);
  assert.equal(withTools.text, undefined);
  assert.equal(rewriteResponsesStructuredRequest({ text: { format: { type: "text" } } }), undefined);
  const r = rewriteResponsesStructuredJson({ output: [{ type: "reasoning" }, { id: "fc1", type: "function_call", name: "structured_output", arguments: "{\"fruit\":\"mango\"}", status: "completed" }] });
  assert.equal(r.json, "{\"fruit\":\"mango\"}");
  assert.equal((r.resp as any).output[1].type, "message");
  assert.equal((r.resp as any).output[1].content[0].text, "{\"fruit\":\"mango\"}");
  assert.equal((r.resp as any).output_text, "{\"fruit\":\"mango\"}");
});

test("Responses SSE rewriter: function_call events of structured_output become output_text events (other calls untouched)", () => {
  const ev = (type: string, data: any) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const rw = new ResponsesStructuredSseRewriter();
  const input = [
    ev("response.created", { response: { id: "r", output: [] } }),
    ev("response.output_item.added", { output_index: 0, item: { id: "x1", type: "function_call", name: "exec_command", arguments: "" } }),
    ev("response.function_call_arguments.delta", { item_id: "x1", delta: "{}" }),
    ev("response.output_item.added", { output_index: 1, item: { id: "fc", type: "function_call", name: "structured_output", arguments: "" } }),
    ev("response.function_call_arguments.delta", { item_id: "fc", output_index: 1, delta: "{\"fruit\":" }),
    ev("response.function_call_arguments.delta", { item_id: "fc", output_index: 1, delta: "\"mango\"}" }),
    ev("response.function_call_arguments.done", { item_id: "fc", output_index: 1, arguments: "{\"fruit\":\"mango\"}" }),
    ev("response.output_item.done", { output_index: 1, item: { id: "fc", type: "function_call", name: "structured_output", arguments: "{\"fruit\":\"mango\"}" } }),
    ev("response.completed", { response: { id: "r", output: [{ id: "fc", type: "function_call", name: "structured_output", arguments: "{\"fruit\":\"mango\"}" }] } }),
  ].join("");
  // split into awkward chunks
  let out = "";
  for (let i = 0; i < input.length; i += 37) out += rw.push(input.slice(i, i + 37));
  out += rw.flush();
  const frames = out.split("\n\n").filter(Boolean).map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
  const types = frames.map((f) => f.type);
  assert.ok(types.includes("response.function_call_arguments.delta"), "exec_command call untouched");
  assert.equal(frames.filter((f) => f.type === "response.output_text.delta").map((f) => f.delta).join(""), "{\"fruit\":\"mango\"}");
  assert.equal(frames.find((f) => f.type === "response.output_text.done").text, "{\"fruit\":\"mango\"}");
  const done = frames.find((f) => f.type === "response.output_item.done");
  assert.equal(done.item.type, "message");
  assert.equal(done.item.content[0].text, "{\"fruit\":\"mango\"}");
  assert.equal(frames.at(-1).response.output[0].type, "message");
  assert.equal(rw.sawTool, true);
  assert.equal(rw.json, "{\"fruit\":\"mango\"}");
});

test("gate proxy surface \"openai\": token auth (OpenAI error shape), /v1 stripped onto the provider base, key swapped in, gate + emulation", async () => {
  silent(); resetProviderGatesForTests();
  const seen: Array<{ url: string; auth: string | null; body: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    seen.push({ url, auth: new Headers(init.headers).get("authorization"), body: init.body ? JSON.parse(Buffer.from(init.body).toString()) : undefined });
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "MiniMax-M3.1-Flash" }] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "r", output: [{ id: "fc", type: "function_call", name: "structured_output", arguments: "{\"fruit\":\"mango\"}" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  const p = provider("https://upstream.example/v1");
  const proxy = await startAgentGateProxy(p, { surface: "openai", fetchImpl });
  try {
    const bad = await fetch(proxy.url + "/v1/responses", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
    assert.equal(bad.status, 401);
    assert.deepEqual(Object.keys((await bad.json()) as any), ["error"]);
    const ok = await fetch(proxy.url + "/v1/responses", { method: "POST", headers: { authorization: `Bearer ${proxy.token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "MiniMax-M3.1-Flash", input: "x", text: { format: { type: "json_schema", schema: SCHEMA } } }) });
    const body: any = await ok.json();
    assert.equal(ok.status, 200);
    assert.equal(body.output[0].type, "message");
    assert.equal(seen[0].url, "https://upstream.example/v1/responses");
    assert.equal(seen[0].auth, `Bearer ${FAKE_KEY}`);
    assert.equal(seen[0].body.tool_choice.name, "structured_output");
    const models = await fetch(proxy.url + "/v1/models", { headers: { authorization: `Bearer ${proxy.token}` } });
    assert.equal(models.status, 200);
    assert.equal(seen[1].url, "https://upstream.example/v1/models");
    const st = proxy.stats();
    assert.equal(st.rejected, 1); assert.equal(st.structuredEmulated, 1); assert.equal(st.structuredJsonOk, 1); assert.equal(st.maxInflight, 1);
    assert.ok(proxy.token.startsWith("vcgp_"));
    assert.notEqual(proxy.token, FAKE_KEY);
  } finally { await proxy.close(); }
});

test("MiniMax backend: provider resolution, profile, thread config, child env without the key, executable discovery, model catalog", async () => {
  silent(); resetProviderGatesForTests();
  assert.equal(resolveMiniMaxCodexProvider({}), null);
  const p = provider();
  assert.equal(p.protocol, "openai-responses"); assert.equal(p.maxConcurrency, 1); assert.equal(p.gateKey, "key:MINIMAX_API_KEY");
  const dir = mkdtempSync(join(tmpdir(), "vc-codex-prof-"));
  try {
    ensureCodexProfile(dir, "MiniMax-M3.1-Flash");
    const toml = readFileSync(join(dir, "config.toml"), "utf8");
    assert.match(toml, /model_provider = "videoclaw_minimax"/);
    assert.match(toml, /requires_openai_auth = false/);
    assert.doesNotMatch(toml, new RegExp(FAKE_KEY));
    writeFileSync(join(dir, "config.toml"), "user = 1\n");
    ensureCodexProfile(dir, "MiniMax-M3.1-Flash"); // never overwrites a profile it does not own
    assert.equal(readFileSync(join(dir, "config.toml"), "utf8"), "user = 1\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const cfg: any = codexMiniMaxConfig("http://127.0.0.1:1234");
  assert.equal(cfg.model_providers.videoclaw_minimax.base_url, "http://127.0.0.1:1234/v1");
  assert.equal(cfg.model_providers.videoclaw_minimax.env_key, CODEX_MINIMAX_TOKEN_ENV);
  const prev = process.env.MINIMAX_API_KEY; process.env.MINIMAX_API_KEY = FAKE_KEY;
  try {
    const env: any = codexChildEnv({ envName: CODEX_MINIMAX_TOKEN_ENV, key: "vcgp_x" }, { PATH: "/bin" }, "/prof");
    assert.equal(env.MINIMAX_API_KEY, undefined);
    assert.equal(env[CODEX_MINIMAX_TOKEN_ENV], "vcgp_x");
    assert.equal(env.CODEX_HOME, "/prof");
  } finally { if (prev === undefined) delete process.env.MINIMAX_API_KEY; else process.env.MINIMAX_API_KEY = prev; }
  assert.equal(resolveCodexExecutable({ env: { VIDEOCLAW_CODEX_BIN: "/x/codex" } }), "/x/codex");
  const bundledCodex = join("/r", "bootstrap", "codex", "bin", process.platform === "win32" ? "codex.exe" : "codex"); // platform separators + .exe
  assert.equal(resolveCodexExecutable({ env: {}, resourcesPath: "/r", exists: (q) => q === bundledCodex }), bundledCodex);
  assert.equal(resolveCodexExecutable({ env: {}, resourcesPath: "/r", platform: "win32", exists: (q) => q.endsWith("codex.exe") }), join("/r", "bootstrap", "codex", "bin", "codex.exe"));
  assert.deepEqual(codexVendorLayout("win32", "x64"), { pkg: "codex-win32-x64", triple: "x86_64-pc-windows-msvc", exe: "codex.exe" });
  assert.deepEqual(codexVendorLayout("linux", "arm64"), { pkg: "codex-linux-arm64", triple: "aarch64-unknown-linux-musl", exe: "codex" });
  assert.equal(resolveCodexExecutable({ env: {}, exists: () => false }), "codex");
  const models = await discoverMiniMaxCodexModels(p, { fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: "MiniMax-M3" }, { id: "speech-2.8-hd" }, { id: "MiniMax-M3.1-Flash" }] }), { status: 200 })) as any });
  assert.deepEqual(models.map((m) => m.id), ["MiniMax-M3", "MiniMax-M3.1-Flash"]);
  assert.equal(models.find((m) => m.isDefault)?.id, "MiniMax-M3.1-Flash");
  assert.deepEqual(models[0].supportedReasoningEfforts.map((e) => e.effort), ["low", "medium", "high"]);
});

const fakeModels = async () => ["MiniMax-M3.1-Flash", "MiniMax-M3"].map((id) => ({ id, model: id, displayName: id, isDefault: id === "MiniMax-M3.1-Flash", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"].map((effort) => ({ effort })) }));
const authed = async () => ({ harness: "codex-app-server" as const, provider: "openai" as const, authenticated: true, mode: "external" });

test("CodexRouteController: gate, status, catalog partition with the PORT evidence rows, refusals, pins", async () => {
  let p: any = provider();
  const settings: Record<string, unknown> = { agentHarness: "codex-app-server", codexProvider: "chatgpt" };
  let persisted = 0;
  const c = new CodexRouteController({ settings: () => settings, profileDir: () => "/nonexistent", executable: () => "codex", provider: () => p, discoverModels: fakeModels, accountStatus: authed, persist: () => { persisted++; }, sessionsChanged: () => {} });
  assert.deepEqual(await c.status(), { available: true, authenticated: true, mode: "external" });
  const cat: any = await c.models(true);
  assert.equal(cat.ok, true);
  assert.deepEqual(cat.recommended, ["MiniMax-M3.1-Flash"]);
  assert.equal(cat.runtimeDefault.modelId, "MiniMax-M3.1-Flash");
  assert.equal(cat.runtimeDefault.defaultEligible, true);
  assert.equal(await c.routeRefusal({ agentHarness: "codex-app-server", codexProvider: "chatgpt" }), undefined);
  assert.match(String(await c.routeRefusal({ agentHarness: "codex-app-server", codexProvider: "chatgpt", modelOverride: "gpt-x" })), /isn’t available on the connected ChatGPT account/);
  assert.equal(await c.routeRefusal({ agentHarness: "codex-app-server", codexProvider: "openai-api", modelOverride: "MiniMax-M3.1-Flash" }), undefined);
  assert.match(String(await c.routeRefusal({ agentHarness: "codex-app-server", codexProvider: "openrouter", modelOverride: "x" })), /OpenRouter route has not been validated/);
  const meta: any = { agentHarness: "codex-app-server", codexProvider: "chatgpt" };
  assert.equal(await c.turnRefusal(meta), undefined);
  assert.equal(meta.modelOverride, "MiniMax-M3.1-Flash");
  assert.equal(meta.codexReasoningEffort, "medium"); // runtime default (MiniMax rows are not in the verbatim recommended table)
  assert.ok(persisted >= 2);
  await assert.rejects(c.checkEffort(meta, "xhigh"), /doesn’t offer reasoning effort “xhigh”/);
  await c.checkEffort(meta, "high");
  assert.equal(await c.pickModel(meta, undefined), "MiniMax-M3.1-Flash");
  assert.equal(await c.pickModel(meta, "MiniMax-M3"), "MiniMax-M3");
  await assert.rejects(c.pickModel(meta, "gpt-6-astra"), /isn’t available/);
  assert.deepEqual(c.providerKeyStatus(), { openaiApi: { configured: true }, openrouter: { configured: false } });
  assert.equal(portCodexEvidence("MiniMax-M3.1-Flash").length, 2);
  assert.equal(resolvedAgentHarness({ agentHarness: "codex-app-server" }), "codex-app-server");
  assert.equal(resolvedCodexProvider({ codexProvider: "bogus" }), "chatgpt");
  p = null; c.invalidateCatalog();
  const off: any = await c.status();
  assert.equal(off.available, false); assert.match(off.recovery, /MINIMAX_API_KEY/);
  assert.equal(((await c.models(true)) as any).reason, "unavailable");
});

/** A scripted stand-in for CodexAppServerClient (events in the normalized shapes the client emits). */
function fakeCodexClient(log: any[], o: { failStart?: boolean; threadEffort?: (e?: string) => string | undefined } = {}) {
  const listeners = new Set<(e: any) => void>();
  const emit = (e: any) => { for (const l of listeners) l(e); };
  let n = 0;
  return (handlers: { decideApproval?: any }) => {
    const client: any = {
      onEvent: (l: any) => { listeners.add(l); return () => listeners.delete(l); },
      accountStatus: async () => authed(),
      startThread: async (opts: any) => {
        log.push({ startThread: opts });
        return { threadId: opts.resumeThreadId ?? "thread-1", model: opts.model, modelProvider: opts.modelProvider, reasoningEffort: o.threadEffort ? o.threadEffort(opts.config?.model_reasoning_effort) : opts.config?.model_reasoning_effort };
      },
      startTurn: async (threadId: string, text: string, model: string, uuid: string) => {
        log.push({ startTurn: { threadId, text, model, uuid } });
        const turnId = `turn-${++n}`;
        setTimeout(async () => {
          emit({ kind: "turn_started", threadId, turnId });
          emit({ kind: "assistant_delta", threadId, turnId, itemId: "a1", text: "Reading", phase: "final_answer" });
          emit({ kind: "tool_started", threadId, turnId, itemId: "c1", toolKind: "command", title: "Run bash", command: "cat hello.txt" });
          const decision = await handlers.decideApproval({ kind: "approval", threadId, turnId, itemId: "c1", requestId: 7, toolKind: "command", command: "rm -rf x", title: "Run bash" }, new AbortController().signal);
          log.push({ approval: decision });
          emit({ kind: "tool_completed", threadId, turnId, itemId: "c1", title: "Run bash", success: true });
          emit({ kind: "assistant_message", threadId, turnId, itemId: "a2", text: "The secret fruit is mango.", phase: "final_answer" });
          emit({ kind: "turn_completed", threadId, turnId, status: "completed", durationMs: 5 });
        }, 5);
        return { turnId };
      },
      interrupt: async () => { log.push({ interrupt: true }); },
      readHistory: async () => [],
      close: () => { log.push({ close: true }); },
    };
    return client;
  };
}

function codexHarness(o: { threadEffort?: (e?: string) => string | undefined } = {}) {
  silent(); resetProviderGatesForTests();
  const root = mkdtempSync(join(tmpdir(), "vc-codexhost-"));
  const events: Array<{ sessionId: string; event: SessionEvent }> = [];
  const log: any[] = [];
  const settings: Record<string, unknown> = { agentHarness: "codex-app-server", codexProvider: "chatgpt" };
  let backends = 0, closed = 0;
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: () => {} },
    service: { newSessionLlmRoute: () => "minimax" as any, llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("the Claude path must not be used for a Codex video"); } },
    loadSdk: async () => { throw new Error("the Claude SDK must not load for a Codex video"); },
    sessionsRoot: root,
    codex: {
      settings: () => settings, profileDir: () => join(root, "codex-profile"), executable: () => "codex", provider: () => provider(),
      discoverModels: fakeModels, accountStatus: authed, createClient: fakeCodexClient(log, o) as any,
      startBackend: async () => { backends++; return { provider: provider(), proxy: { url: "http://127.0.0.1:1", stats: () => ({ requests: 0, rejected: 0, maxInflight: 0, inflight: 0, structuredEmulated: 0, structuredJsonOk: 0 }) }, modelProvider: "videoclaw_minimax", config: codexMiniMaxConfig("http://127.0.0.1:1"), secret: { envName: CODEX_MINIMAX_TOKEN_ENV, key: "vcgp_t" }, close: async () => { closed++; } }; },
    },
  });
  return { host, events, log, settings, root, backends: () => backends, closed: () => closed, kinds: (sid: string) => events.filter((e) => e.sessionId === sid).map((e) => e.event.kind), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("AgentHost + Codex harness: createSession pins the harness, a turn runs (text + tool + declined approval), stream ends, resume on the next send", async () => {
  const h = codexHarness();
  try {
    const meta = h.host.createSession({});
    assert.equal(meta.agentHarness, "codex-app-server");
    assert.equal(meta.codexProvider, "chatgpt");
    assert.equal(meta.llmRoute, undefined);
    await h.host.sendMessage(meta.sessionId, "Read hello.txt and tell me the fruit.");
    await until(() => h.kinds(meta.sessionId).includes("result"));
    await until(() => h.host.runtimeInfo(meta.sessionId).running === false);
    const after = h.host.listSessions().find((m) => m.sessionId === meta.sessionId)!;
    assert.equal(after.status, "idle");
    assert.equal(after.modelOverride, "MiniMax-M3.1-Flash"); // pinModel at the turn boundary
    assert.equal(after.codexReasoningEffort, "medium"); // pinCodexReasoningEffort
    assert.equal(after.sdkSessionId, "thread-1");
    const start = h.log.find((l) => l.startThread).startThread;
    assert.equal(start.modelProvider, "videoclaw_minimax");
    assert.equal(start.sandbox, "read-only"); // CODEX_CONTAINMENT
    assert.equal(start.config.model_reasoning_effort, "medium");
    assert.equal(start.config.model_providers.videoclaw_minimax.env_key, CODEX_MINIMAX_TOKEN_ENV);
    assert.deepEqual(start.config.mcp_servers, {});
    assert.match(start.developerInstructions, /VideoClaw/);
    assert.equal(h.log.find((l) => l.approval)?.approval, "decline"); // confined policy: Bash is not an allowed tool
    const ev = h.events.filter((e) => e.sessionId === meta.sessionId).map((e) => e.event);
    assert.ok(ev.some((e) => e.kind === "text_delta"));
    assert.ok(ev.some((e) => e.kind === "tool_start" && (e as any).toolName === "provider_command"));
    assert.ok(ev.some((e) => e.kind === "tool_end"));
    assert.ok(ev.some((e) => e.kind === "assistant_text" && /mango/.test((e as any).text)));
    assert.equal(h.backends(), 1); await until(() => h.closed() === 1); // per-runtime gate proxy closed with the runtime
    // second send: new runtime, thread/resume of the same thread
    await h.host.sendMessage(meta.sessionId, "Again.");
    await until(() => h.kinds(meta.sessionId).filter((k) => k === "result").length === 2);
    const starts = h.log.filter((l) => l.startThread).map((l) => l.startThread);
    assert.equal(starts[1].resumeThreadId, "thread-1");
  } finally { h.cleanup(); }
});

test("AgentHost + Codex: setModel / setReasoningEffort (channels), effort pin mismatch refused, unavailable without the key", async () => {
  const h = codexHarness();
  try {
    const meta = h.host.createSession({});
    const ch = codexChannels(h.host);
    const m1: any = await ch["session:setModel"](meta.sessionId, "MiniMax-M3");
    assert.equal(m1.modelOverride, "MiniMax-M3");
    await assert.rejects(Promise.resolve(ch["session:setModel"](meta.sessionId, "gpt-6-astra")), /isn’t available/);
    const m2: any = await ch["session:setModel"](meta.sessionId, "");
    assert.equal(m2.modelOverride, "MiniMax-M3.1-Flash"); // the alias resolves to an exact id
    const e1: any = await ch["session:setReasoningEffort"](meta.sessionId, "high");
    assert.equal(e1.codexReasoningEffort, "high");
    await assert.rejects(Promise.resolve(ch["session:setReasoningEffort"](meta.sessionId, "max")), /doesn’t offer reasoning effort/);
    assert.deepEqual(await ch["engine:codexStatus"](), { available: true, authenticated: true, mode: "external" });
    const cat: any = await ch["engine:codexModels"]();
    assert.equal(cat.ok, true);
    assert.deepEqual(await ch["engine:agentProviderKeyStatus"](), { openaiApi: { configured: true }, openrouter: { configured: false } });
    assert.deepEqual(await ch["engine:codexDisconnectImpact"](), { runningVideos: 0 });
    const disc: any = await ch["engine:codexDisconnectChatGpt"]();
    assert.equal(disc.ok, false); assert.match(disc.error, /MINIMAX_API_KEY/);
    await h.host.sendMessage(meta.sessionId, "hi");
    await until(() => h.kinds(meta.sessionId).includes("result"));
    assert.equal(h.log.find((l) => l.startThread).startThread.config.model_reasoning_effort, "high");
  } finally { h.cleanup(); }
  const bad = codexHarness({ threadEffort: () => "low" });
  try {
    const meta = bad.host.createSession({});
    await bad.host.sendMessage(meta.sessionId, "hi").catch(() => {});
    await until(() => bad.kinds(meta.sessionId).includes("error"));
    const err: any = bad.events.find((e) => e.sessionId === meta.sessionId && e.event.kind === "error")!.event;
    assert.match(err.message, /instead of the pinned “medium”/);
  } finally { bad.cleanup(); }
});
