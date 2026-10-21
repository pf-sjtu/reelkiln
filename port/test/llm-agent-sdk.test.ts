// docs/16: the minimal real Claude Agent SDK session path, the loopback gate proxy and the
// agentCompat → Claude Code env knobs. The SDK boundary is mocked (no SDK, no network: upstream is a
// local http server); the real run is the gated `llm-agent-smoke` CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PINNED_CLAUDE_AGENT_SDK_VERSION, claudeCodeExecutableFor, discoverClaudeAgentSdk, sdkCandidates, loadClaudeAgentSdk, minimalAgentOptions, resolveSdkPackageDir, runAgentTurn, type ClaudeAgentSdkLike } from "../src/main/llm/agent-sdk";
import { proxiedAgentEnv, startAgentGateProxy } from "../src/main/llm/agent-gate-proxy";
import { agentCompatEnv, claudeAgentEnv } from "../src/main/llm/protocols";
import { loadProviderRegistry, type ProviderRegistry } from "../src/main/llm/provider-registry";
import { LlmRouteService } from "../src/main/llm/route-service";
import { LlmProviderError } from "../src/main/llm/errors";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { ConcurrencyLimiter, resetProviderGatesForTests } from "../src/main/llm/retry";

const KEY = "mm-agent-sdk-test-key-not-real-0123456789";
const silent = () => setLoggerForTests(createLogger({ level: "silent" }));
const regWith = (providers: unknown[]): ProviderRegistry => loadProviderRegistry({ json: { providers } });
const tmp = () => mkdtempSync(join(tmpdir(), "vc-agent-"));

function fakeSdk(messages: Array<Record<string, any>> | ((opts: any) => AsyncIterable<Record<string, any>>)) {
  const calls: Array<{ prompt: unknown; options: any }> = [];
  const sdk: ClaudeAgentSdkLike = {
    query({ prompt, options }) {
      calls.push({ prompt, options });
      if (typeof messages === "function") return messages(options) as any;
      return (async function* () { for (const m of messages) yield m; })() as any;
    },
  };
  return { sdk, calls };
}

test("minimalAgentOptions: passes sessionRuntimeConfig env/model through unchanged, isolated settings/MCP, executable, turn cap", () => {
  const runtime = { llmRoute: "minimax", model: "MiniMax-M3.1-Flash", env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_AUTH_TOKEN: "tok", CLAUDE_CONFIG_DIR: "/p" } };
  const o = minimalAgentOptions({ runtime, prompt: "hi", cwd: "/w", executable: "/x/claude" });
  assert.deepEqual(o.env, runtime.env);
  assert.notEqual(o.env, runtime.env, "copied, not aliased");
  assert.equal(o.model, "MiniMax-M3.1-Flash");
  assert.equal(o.pathToClaudeCodeExecutable, "/x/claude");
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.mcpServers, {});
  assert.deepEqual(o.tools, []);
  assert.equal(o.maxTurns, 1);
  assert.equal(o.persistSession, false);
  assert.deepEqual(o.systemPrompt, { type: "preset", preset: "claude_code" });
  const t = minimalAgentOptions({ runtime, prompt: "hi", cwd: "/w", allowedTools: ["Bash"] });
  assert.deepEqual(t.tools, ["Bash"]);
  assert.deepEqual(t.allowedTools, [], "nothing pre-approved: every non-auto call goes through canUseTool");
  assert.equal(t.maxTurns, 4);
  assert.equal("pathToClaudeCodeExecutable" in t, false);
});

test("runAgentTurn: SDK boundary gets the runtime env/model; init/assistant/tool_use/tool_result/result collected; canUseTool allow-list; key scrubbed", async () => {
  silent();
  const runtime = { llmRoute: "acme", model: "acme-large", env: { ANTHROPIC_BASE_URL: "https://acme.test", ANTHROPIC_AUTH_TOKEN: KEY } };
  let decisions: unknown[] = [];
  const { sdk, calls } = fakeSdk((options) => (async function* () {
    yield { type: "system", subtype: "init", model: "acme-large", apiKeySource: "none", claude_code_version: "2.1.305", tools: ["Bash"] };
    yield { type: "stream_event", event: {} };
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "running " }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "echo ok" } }] } };
    decisions.push(await options.canUseTool("Bash", { command: "echo ok" }, {}));
    decisions.push(await options.canUseTool("Bash", { command: "cat /etc/passwd" }, {}));
    decisions.push(await options.canUseTool("Write", { file_path: "/x" }, {}));
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }] }] } };
    yield { type: "assistant", parent_tool_use_id: "sub", message: { content: [{ type: "text", text: "SUBAGENT" }] } };
    yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `done ${KEY}` }] } };
    yield { type: "result", subtype: "success", is_error: false, num_turns: 2, duration_ms: 5, result: `done ${KEY}`, usage: { input_tokens: 3, output_tokens: 4 } };
  })());
  const r = await runAgentTurn(sdk, { runtime, prompt: "p", cwd: "/w", allowedTools: ["Bash"], allowTool: (n, i) => n === "Bash" && /^echo /.test(String(i.command)) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, "p");
  assert.equal(calls[0].options.env.ANTHROPIC_AUTH_TOKEN, KEY, "the child gets the env as built");
  assert.equal(calls[0].options.model, "acme-large");
  assert.ok(calls[0].options.abortController instanceof AbortController);
  assert.equal(r.ok, true);
  assert.equal(r.init?.claudeCodeVersion, "2.1.305");
  assert.equal(r.streamEvents, 1);
  assert.deepEqual(r.toolCalls, [{ id: "t1", name: "Bash", input: { command: "echo ok" } }]);
  assert.deepEqual(decisions.map((d: any) => d.behavior), ["allow", "deny", "deny"]);
  assert.deepEqual(r.permissionChecks.map((c) => c.allowed), [true, false, false]);
  assert.deepEqual(r.toolResults, [{ isError: false, text: "ok" }]);
  assert.ok(!r.assistantText.includes("SUBAGENT"), "subagent text is not the top-level reply");
  assert.ok(!JSON.stringify(r).includes(KEY), "provider key never in the result");
  assert.match(r.assistantText, /^running done /);
});

test("runAgentTurn: error result, SDK throw and timeout become a typed failure (no throw)", async () => {
  silent();
  const runtime = { llmRoute: "acme", model: "m", env: {} };
  const err = await runAgentTurn(fakeSdk([{ type: "result", subtype: "success", is_error: true, api_error_status: 401, result: "API Error: 401" }]).sdk, { runtime, prompt: "p", cwd: "/w" });
  assert.equal(err.ok, false);
  assert.match(err.error!, /api status 401/);
  const thrown = await runAgentTurn(fakeSdk(() => (async function* () { throw new Error(`spawn failed ${KEY}`); })()).sdk, { runtime, prompt: "p", cwd: "/w" });
  assert.equal(thrown.ok, false);
  assert.ok(thrown.error!.includes("spawn failed") && !thrown.error!.includes(KEY));
  const hang = await runAgentTurn(fakeSdk((options) => (async function* () {
    await new Promise((_r, rej) => options.abortController.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  })()).sdk, { runtime, prompt: "p", cwd: "/w", timeoutMs: 30 });
  assert.match(hang.error!, /timed out after 30 ms/);
  const none = await runAgentTurn(fakeSdk([]).sdk, { runtime, prompt: "p", cwd: "/w" });
  assert.match(none.error!, /without a result/);
});

test("loadClaudeAgentSdk: SDK_UNAVAILABLE when unset/missing/wrong package; loads an ESM package from a node_modules dir", async () => {
  const nowhere = { env: {}, appRoot: "/nonexistent-vc", home: "/nonexistent-home", resourcesPath: undefined };
  await assert.rejects(loadClaudeAgentSdk("", nowhere), (e: unknown) => e instanceof LlmProviderError && e.code === "SDK_UNAVAILABLE" && /agent-sdk:install/.test(e.message));
  const dir = tmp();
  try {
    await assert.rejects(loadClaudeAgentSdk(dir), /not found/);
    const pkg = join(dir, "node_modules", "@anthropic-ai", "claude-agent-sdk");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "9.9.9", type: "module" }));
    writeFileSync(join(pkg, "sdk.mjs"), "export function query() { return (async function*(){ yield { type: 'result', subtype: 'success', is_error: false }; })(); }\n");
    assert.equal(resolveSdkPackageDir(dir), pkg);
    const loaded = await loadClaudeAgentSdk(dir);
    assert.equal(loaded.version, "9.9.9");
    assert.equal(loaded.packageDir, pkg);
    const r = await runAgentTurn(loaded.sdk, { runtime: { llmRoute: "x", model: "m", env: {} }, prompt: "p", cwd: dir });
    assert.equal(r.ok, true);
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "evil-sdk", version: "1.0.0" }));
    await assert.rejects(loadClaudeAgentSdk(pkg), /not @anthropic-ai\/claude-agent-sdk/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SDK discovery (docs/17 §4): env > app node_modules > resources(unpacked) > vendor > ~/.videoclaw; env misconfig is an error, not a fallback", async () => {
  const has = (dirs: string[]) => (p: string) => dirs.some((d) => p === join(d, "package.json") || p === join(d, "sdk.mjs"));
  const SDK = (root: string) => join(root, "@anthropic-ai", "claude-agent-sdk");
  const base = { appRoot: "/app", resourcesPath: "/res", home: "/home/u" };
  assert.deepEqual(sdkCandidates({ ...base, env: { VIDEOCLAW_CLAUDE_AGENT_SDK: "/x" } }).map((c) => [c.source, c.dir]), [
    ["env", "/x"], ["app-node_modules", "/app/node_modules"], ["resources-unpacked", "/res/app.asar.unpacked/node_modules"],
    ["resources", "/res/claude-agent-sdk"], ["vendor", "/app/vendor/claude-agent-sdk"], ["home", "/home/u/.videoclaw/claude-agent-sdk"],
  ]);
  const vendorPkg = join("/app/vendor/claude-agent-sdk", "node_modules", "@anthropic-ai", "claude-agent-sdk");
  let d = discoverClaudeAgentSdk({ ...base, env: {}, exists: has([vendorPkg, SDK("/res/app.asar.unpacked/node_modules")]) });
  assert.equal(d.source, "resources-unpacked");
  d = discoverClaudeAgentSdk({ ...base, env: {}, exists: has([vendorPkg]) });
  assert.deepEqual([d.source, d.packageDir], ["vendor", vendorPkg]);
  d = discoverClaudeAgentSdk({ ...base, env: {}, exists: has([SDK("/home/u/.videoclaw/claude-agent-sdk/node_modules")]) });
  assert.equal(d.source, "home");
  assert.throws(() => discoverClaudeAgentSdk({ ...base, env: { VIDEOCLAW_CLAUDE_AGENT_SDK: "/typo" }, exists: has([vendorPkg]) }), /not found under \/typo/);
  assert.throws(() => discoverClaudeAgentSdk({ ...base, env: {}, exists: () => false }), (e: unknown) => e instanceof LlmProviderError && e.code === "SDK_UNAVAILABLE" && /Looked in: .*vendor/.test(e.message));
});

test("pinned SDK version: agent-sdk.ts constant == package.json config (install script source)", () => {
  const pkgJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkgJson.config.claudeAgentSdkVersion, PINNED_CLAUDE_AGENT_SDK_VERSION);
});

test("claudeCodeExecutableFor: original packaged layout (claude-agent-sdk-<platform>-<arch>/claude), musl, win32 .exe, override", () => {
  const pkg = "/app/node_modules/@anthropic-ai/claude-agent-sdk";
  const has = (set: string[]) => (p: string) => set.includes(p);
  assert.equal(claudeCodeExecutableFor(pkg, { platform: "linux", arch: "x64", env: {}, exists: has(["/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"]) }), "/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  assert.equal(claudeCodeExecutableFor(pkg, { platform: "linux", arch: "arm64", env: {}, exists: has(["/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude"]) }), "/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude");
  assert.match(claudeCodeExecutableFor(pkg, { platform: "win32", arch: "x64", env: {}, exists: (p) => p.endsWith("claude.exe") })!, /claude-agent-sdk-win32-x64[\\/]claude\.exe$/);
  assert.equal(claudeCodeExecutableFor(pkg, { platform: "linux", arch: "x64", env: {}, exists: () => false }), undefined);
  assert.equal(claudeCodeExecutableFor(pkg, { env: { VIDEOCLAW_CLAUDE_CODE_EXECUTABLE: "/opt/claude" }, exists: () => false }), "/opt/claude");
});

test("agentCompat: MiniMax preset → verified Claude Code knobs + gate proxy; user file can turn them off; other providers unaffected", () => {
  silent();
  assert.deepEqual(agentCompatEnv({ disablePromptCaching: true, disableExperimentalBetas: false, gateProxy: true }), { DISABLE_PROMPT_CACHING: "1" });
  const reg = regWith([{ name: "acme", protocol: "anthropic-messages", baseUrl: "https://acme.test/anthropic", apiKeyEnv: "ACME_KEY", model: "a" }]);
  const mm = reg.resolve("minimax", { MINIMAX_API_KEY: KEY })!;
  assert.deepEqual(mm.agentCompat, { gateProxy: true, disableNonessentialTraffic: true, emulateStructuredOutputs: true });
  const env = claudeAgentEnv(mm, "/p");
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  assert.equal(env.CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS, undefined, "docs/17: structured outputs emulated by the proxy, not disabled");
  assert.equal(env.EMULATE_STRUCTURED_OUTPUTS, undefined);
  assert.ok(!Object.keys(env).some((k) => /EMULATE/i.test(k)), "emulation is a proxy feature, not an env knob");
  assert.equal(env.DISABLE_PROMPT_CACHING, undefined, "MiniMax accepts cache_control (verified) — caching stays on");
  const acme = claudeAgentEnv(reg.resolve("acme", { ACME_KEY: KEY })!, "/p");
  assert.equal(acme.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, undefined);
  const off = regWith([{ name: "minimax", agentCompat: { disableNonessentialTraffic: false } }]).resolve("minimax", { MINIMAX_API_KEY: KEY })!;
  assert.equal(off.agentCompat?.disableNonessentialTraffic, false);
  assert.equal(off.agentCompat?.gateProxy, true, "nested objects merge one level deep over the preset");
  assert.throws(() => regWith([{ name: "acme2", protocol: "anthropic-messages", baseUrl: "https://a.test", apiKeyEnv: "K", model: "m", agentCompat: { bogus: true } }]), (e: unknown) => e instanceof LlmProviderError && e.code === "CONFIG_INVALID");
});

async function upstreamServer(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void | Promise<void>) {
  const seen: Array<{ method?: string; url?: string; headers: IncomingMessage["headers"]; body: string }> = [];
  let inflight = 0, maxInflight = 0;
  const srv = createServer(async (req, res) => {
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    let body = ""; for await (const c of req) body += c;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    try { await handler(req, body, res); } finally { inflight--; }
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/anthropic`, seen, maxInflight: () => maxInflight, close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }) };
}
function send(url: string, o: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) {
  return fetch(url, { method: o.method ?? "POST", headers: o.headers, body: o.body, signal: o.signal });
}
const P = (baseUrl: string, over: Record<string, unknown> = {}) => ({ name: "mm", baseUrl, auth: { scheme: "bearer" as const }, key: KEY, headers: { "X-Team": "vc" }, maxConcurrency: 1, gateKey: "key:TEST_GATE", ...over });

test("gate proxy: session token required, real auth swapped in upstream, custom headers kept, streamed body passed through, non-/v1 answered locally", async () => {
  silent(); resetProviderGatesForTests();
  const up = await upstreamServer(async (_req, _body, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "request-id": "r1" });
    res.write("event: message_start\ndata: {}\n\n"); await new Promise((r) => setTimeout(r, 20)); res.end("event: message_stop\ndata: {}\n\n");
  });
  const proxy = await startAgentGateProxy(P(up.url));
  try {
    assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(proxy.token, KEY);
    const bad = await send(proxy.url + "/v1/messages", { headers: { authorization: `Bearer ${KEY}` }, body: "{}" });
    assert.equal(bad.status, 401, "the real key is NOT accepted by the proxy — only the session token");
    assert.equal(up.seen.length, 0);
    const probe = await send(proxy.url + "/api/hello", { method: "HEAD" });
    assert.equal(probe.status, 200);
    assert.equal(up.seen.length, 0, "reachability probe is never forwarded");
    const ok = await send(proxy.url + "/v1/messages?beta=true", { headers: { authorization: `Bearer ${proxy.token}`, "anthropic-beta": "claude-code-20250219", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "m" }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("request-id"), "r1");
    assert.equal(await ok.text(), "event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n");
    const u = up.seen[0];
    assert.equal(u.url, "/anthropic/v1/messages?beta=true");
    assert.equal(u.headers.authorization, `Bearer ${KEY}`);
    assert.equal(u.headers["anthropic-beta"], "claude-code-20250219");
    assert.equal(u.headers["x-team"], "vc");
    assert.equal(u.body, JSON.stringify({ model: "m" }));
    const xk = await send(proxy.url + "/v1/messages", { headers: { "x-api-key": proxy.token }, body: "{}" });
    assert.equal(xk.status, 200);
    await xk.text();
    assert.deepEqual(proxy.stats(), { requests: 2, rejected: 1, maxInflight: 1, inflight: 0, structuredEmulated: 0, structuredJsonOk: 0 });
  } finally { await proxy.close(); await up.close(); }
});

test("gate proxy: x-api-key / header auth schemes upstream; upstream unreachable → 502 without leaking", async () => {
  silent(); resetProviderGatesForTests();
  const up = await upstreamServer((_q, _b, res) => { res.writeHead(200); res.end("{}"); });
  const a = await startAgentGateProxy(P(up.url, { auth: { scheme: "x-api-key" } }));
  const h = await startAgentGateProxy(P(up.url, { auth: { scheme: "header", header: "api-key", prefix: "K " } }));
  const dead = await startAgentGateProxy(P("http://127.0.0.1:1/x"));
  try {
    await (await send(a.url + "/v1/messages", { headers: { authorization: `Bearer ${a.token}` }, body: "{}" })).text();
    await (await send(h.url + "/v1/messages", { headers: { authorization: `Bearer ${h.token}` }, body: "{}" })).text();
    assert.equal(up.seen[0].headers["x-api-key"], KEY);
    assert.equal(up.seen[0].headers.authorization, undefined);
    assert.equal(up.seen[1].headers["api-key"], `K ${KEY}`);
    const r = await send(dead.url + "/v1/messages", { headers: { authorization: `Bearer ${dead.token}` }, body: "{}" });
    assert.equal(r.status, 502);
    assert.ok(!(await r.text()).includes(KEY));
  } finally { await a.close(); await h.close(); await dead.close(); await up.close(); }
});

test("gate proxy: concurrent child requests are serialised by the account gate (shared with helper calls); client abort frees the slot", async () => {
  silent(); resetProviderGatesForTests();
  const up = await upstreamServer(async (req, _b, res) => { await new Promise((r) => setTimeout(r, req.url?.includes("slow") ? 400 : 40)); res.writeHead(200); res.end("x"); });
  const gate = new ConcurrencyLimiter(1);
  const proxy = await startAgentGateProxy(P(up.url), { gate });
  try {
    const hdr = { authorization: `Bearer ${proxy.token}` };
    const rs = await Promise.all([1, 2, 3].map(() => send(proxy.url + "/v1/messages", { headers: hdr, body: "{}" }).then((r) => r.text())));
    assert.deepEqual(rs, ["x", "x", "x"]);
    assert.equal(up.maxInflight(), 1, "never more than maxConcurrency upstream");
    // a helper call holding the same gate blocks the child until released
    let release!: () => void;
    const held = gate.run(() => new Promise<void>((r) => { release = r; }));
    const t0 = Date.now();
    const waiting = send(proxy.url + "/v1/messages", { headers: hdr, body: "{}" }).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(up.seen.length, 3, "child request queued behind the helper call");
    release(); await held; await waiting;
    assert.ok(Date.now() - t0 >= 80);
    // abort mid-flight releases the slot
    const ac = new AbortController();
    const slow = send(proxy.url + "/v1/messages/slow", { headers: hdr, body: "{}", signal: ac.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 50)); ac.abort(); await slow;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(gate.running, 0);
  } finally { await proxy.close(); await up.close(); }
});

test("proxiedAgentEnv: base URL → proxy, only the session token, auth header dropped from ANTHROPIC_CUSTOM_HEADERS", () => {
  const env = { ANTHROPIC_BASE_URL: "https://up", ANTHROPIC_API_KEY: KEY, ANTHROPIC_CUSTOM_HEADERS: `X-Team: vc\napi-key: ${KEY}`, ANTHROPIC_MODEL: "m", CLAUDE_CONFIG_DIR: "/p" };
  const out = proxiedAgentEnv(env, { url: "http://127.0.0.1:9", token: "vcgp_x" }, { headers: { "X-Team": "vc" } });
  assert.deepEqual(out, { ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: "vcgp_x", ANTHROPIC_CUSTOM_HEADERS: "X-Team: vc", ANTHROPIC_MODEL: "m", CLAUDE_CONFIG_DIR: "/p" });
  assert.equal("ANTHROPIC_CUSTOM_HEADERS" in proxiedAgentEnv({ ANTHROPIC_CUSTOM_HEADERS: `api-key: ${KEY}` }, { url: "u", token: "t" }, { headers: {} }), false);
});

test("LlmRouteService.sessionAgentRuntime: gateProxy provider → proxied env (no provider key anywhere); others unchanged; end-to-end through a mock SDK + mock upstream", async () => {
  silent(); resetProviderGatesForTests();
  const up = await upstreamServer((_q, _b, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "message", content: [{ type: "text", text: "pong" }] })); });
  const dir = tmp();
  try {
    const reg = regWith([{ name: "minimax", baseUrl: up.url.replace("/anthropic", "") + "/anthropic" }, { name: "plain", protocol: "anthropic-messages", baseUrl: "https://plain.test", apiKeyEnv: "PLAIN_KEY", model: "p1" }]);
    const env = { MINIMAX_API_KEY: KEY, PLAIN_KEY: KEY, PATH: "/usr/bin" };
    const svc = (route: string) => new LlmRouteService({ settings: () => ({ gatewayUrl: "", llmRoute: route }), registry: () => reg, env: () => env, profileDir: () => dir });
    const rt = await svc("minimax").sessionAgentRuntime({ llmRoute: "minimax" });
    try {
      assert.equal(rt.model, "MiniMax-M3.1-Flash");
      assert.equal(rt.env.ANTHROPIC_BASE_URL, rt.proxy!.url);
      assert.ok(!Object.values(rt.env).includes(KEY), "provider key not in the child env");
      assert.match(rt.env.ANTHROPIC_AUTH_TOKEN, /^vcgp_[0-9a-f]{64}$/);
      assert.equal(rt.env.CLAUDE_CONFIG_DIR, dir);
      assert.equal(rt.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
      // mock SDK that behaves like the child: one Messages call with the env it was given
      const { sdk, calls } = fakeSdk((options) => (async function* () {
        const r = await fetch(options.env.ANTHROPIC_BASE_URL + "/v1/messages?beta=true", { method: "POST", headers: { authorization: `Bearer ${options.env.ANTHROPIC_AUTH_TOKEN}` }, body: JSON.stringify({ model: options.model }) });
        const j = await r.json() as any;
        yield { type: "result", subtype: "success", is_error: false, result: j.content[0].text };
      })());
      const turn = await runAgentTurn(sdk, { runtime: rt, prompt: "p", cwd: dir });
      assert.equal(turn.ok, true);
      assert.equal(turn.result?.text, "pong");
      assert.equal(calls[0].options.model, "MiniMax-M3.1-Flash");
      assert.equal(up.seen[0].headers.authorization, `Bearer ${KEY}`);
      assert.equal(JSON.parse(up.seen[0].body).model, "MiniMax-M3.1-Flash");
      assert.equal(rt.proxy!.stats().requests, 1);
    } finally { await rt.close(); }
    const plain = await svc("plain").sessionAgentRuntime({ llmRoute: "plain" });
    assert.equal(plain.proxy, undefined);
    assert.equal(plain.env.ANTHROPIC_AUTH_TOKEN, KEY, "no gateProxy → env exactly as sessionRuntimeConfig built it");
    await plain.close();
    const cc = await svc("claude-code").sessionAgentRuntime({ llmRoute: "claude-code" });
    assert.equal(cc.proxy, undefined);
    assert.equal(cc.model, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); await up.close(); }
});


// ---- docs/17 §3: structured-output emulation in the gate proxy -----------------------------
import { rewriteStructuredMessage, rewriteStructuredRequest, StructuredSseRewriter } from "../src/main/llm/structured-emulation";
import { STRUCTURED_TOOL_NAME } from "../src/main/llm/structured-output";

const titleSchema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
const titleReq = (extra: Record<string, unknown> = {}) => ({ model: "m", max_tokens: 100, stream: true, system: "Generate a title. Return JSON.", messages: [{ role: "user", content: "hi" }], tools: [], output_config: { effort: "high", format: { type: "json_schema", schema: titleSchema } }, ...extra });
const sse = (events: Array<[string, unknown]>) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const toolStream = sse([
  ["message_start", { type: "message_start", message: { id: "x", type: "message", role: "assistant", content: [], model: "m", stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Sure! " } }],
  ["content_block_stop", { type: "content_block_stop", index: 1 }],
  ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: STRUCTURED_TOOL_NAME, input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"title": "Su' } }],
  ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: 'rf Cat"}' } }],
  ["content_block_stop", { type: "content_block_stop", index: 2 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } }],
  ["message_stop", { type: "message_stop" }],
]);
const parseSse = (t: string) => t.split("\n\n").filter(Boolean).map((e) => JSON.parse(e.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));

test("structured emulation: request rewrite only for tool-less output_config.format; effort kept", () => {
  const r = rewriteStructuredRequest(titleReq())!;
  assert.deepEqual(r.output_config, { effort: "high" });
  assert.deepEqual(r.tools, [{ name: STRUCTURED_TOOL_NAME, description: r.tools[0].description, input_schema: titleSchema }]);
  assert.deepEqual(r.tool_choice, { type: "tool", name: STRUCTURED_TOOL_NAME });
  assert.equal(rewriteStructuredRequest(titleReq({ tools: [{ name: "Bash", input_schema: { type: "object" } }] })), undefined, "agent turns with tools are never hijacked");
  assert.equal(rewriteStructuredRequest({ ...titleReq(), output_config: { effort: "high" } }), undefined);
  assert.equal(rewriteStructuredRequest("nope"), undefined);
});

test("structured emulation: SSE tool_use → one text block with the JSON (thinking kept, stray text dropped, indices renumbered, stop_reason end_turn); split chunks OK", () => {
  for (const step of [toolStream.length, 7, 1]) {
    const rw = new StructuredSseRewriter();
    let out = "";
    for (let i = 0; i < toolStream.length; i += step) out += rw.push(toolStream.slice(i, i + step));
    out += rw.flush();
    const ev = parseSse(out);
    const starts = ev.filter((e) => e.type === "content_block_start");
    assert.deepEqual(starts.map((e) => [e.index, e.content_block.type]), [[0, "thinking"], [1, "text"]]);
    const text = ev.filter((e) => e.type === "content_block_delta" && e.delta.type === "text_delta").map((e) => e.delta.text).join("");
    assert.equal(text, '{"title": "Surf Cat"}');
    assert.deepEqual(JSON.parse(text), { title: "Surf Cat" });
    assert.ok(ev.every((e) => e.type !== "content_block_delta" || e.index <= 1));
    assert.equal(ev.find((e) => e.type === "message_delta").delta.stop_reason, "end_turn");
    assert.equal(rw.json, '{"title": "Surf Cat"}');
  }
});

test("structured emulation: non-streamed reply rewritten; replies without the tool untouched", () => {
  const r = rewriteStructuredMessage({ content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "noise" }, { type: "tool_use", id: "t", name: STRUCTURED_TOOL_NAME, input: { title: "T" } }], stop_reason: "tool_use" });
  assert.deepEqual(r.msg, { content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: '{"title":"T"}' }], stop_reason: "end_turn" });
  const plain = { content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" };
  assert.equal(rewriteStructuredMessage(plain).msg, plain);
});

test("gate proxy + emulateStructuredOutputs: upstream sees the forced tool, client gets JSON text; other requests and errors untouched; config needs gateProxy", async () => {
  silent(); resetProviderGatesForTests();
  const up = await upstreamServer(async (_req, body, res) => {
    const b = JSON.parse(body);
    if (b.max_tokens === 1) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"type":"error"}'); return; }
    if (b.tool_choice?.name === STRUCTURED_TOOL_NAME) { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(toolStream); return; }
    res.writeHead(200, { "content-type": "text/event-stream" }); res.end("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
  });
  const proxy = await startAgentGateProxy(P(up.url, { agentCompat: { gateProxy: true, emulateStructuredOutputs: true } }));
  const h = { authorization: `Bearer ${proxy.token}`, "content-type": "application/json" };
  try {
    const r = await send(proxy.url + "/v1/messages?beta=true", { headers: h, body: JSON.stringify(titleReq()) });
    const ev = parseSse(await r.text());
    assert.equal(ev.filter((e) => e.delta?.type === "text_delta").map((e) => e.delta.text).join(""), '{"title": "Surf Cat"}');
    const sent = JSON.parse(up.seen[0].body);
    assert.equal(sent.output_config.format, undefined);
    assert.equal(sent.tool_choice.name, STRUCTURED_TOOL_NAME);
    const agent = await send(proxy.url + "/v1/messages", { headers: h, body: JSON.stringify(titleReq({ tools: [{ name: "Bash", input_schema: {} }] })) });
    await agent.text();
    assert.ok(JSON.parse(up.seen[1].body).output_config.format, "requests with tools pass through unchanged");
    const err = await send(proxy.url + "/v1/messages", { headers: h, body: JSON.stringify(titleReq({ max_tokens: 1 })) });
    assert.equal(err.status, 400);
    assert.equal(await err.text(), '{"type":"error"}');
    const st = proxy.stats();
    assert.equal(st.structuredEmulated, 2);
    assert.equal(st.structuredJsonOk, 1);
  } finally { await proxy.close(); await up.close(); }
  assert.throws(() => regWith([{ name: "acme3", protocol: "anthropic-messages", baseUrl: "https://a.test", apiKeyEnv: "K", model: "m", agentCompat: { emulateStructuredOutputs: true } }]), /needs agentCompat.gateProxy/);
});
