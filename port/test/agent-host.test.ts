// docs/19: the minimal AgentHost (session start / stream / stop / cancel / route-switch teardown /
// concurrency) with the SDK boundary mocked, its IPC glue on the ORIGINAL channels, and the
// renderer chat reducer. One integration test runs the real LlmRouteService + gate proxy against a
// local upstream (no network, no real key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHost, ComposerDeliveryError, confinedToolPolicy, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import { agentHostEmit, agentIpcHandlers, agentToolsFromEnv } from "../src/main/agent/agent-ipc";
import { addUserTurn, initialChat, reduceChat, type ChatState } from "../src/renderer/agent-chat-model";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { loadProviderRegistry } from "../src/main/llm/provider-registry";
import { LlmRouteService } from "../src/main/llm/route-service";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { INVOKE_CHANNELS, PUSH_CHANNELS } from "../src/shared/ipc-contract";

const silent = () => setLoggerForTests(createLogger({ level: "silent" }));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 2000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(5); } }

type Script = (turn: { text: string; index: number }, ctl: FakeQuery) => AsyncGenerator<Record<string, any>>;
class FakeQuery {
  closed = false; interrupts = 0; interruptBehaviour: "ack" | "hang" = "ack";
  private outQ: Array<Record<string, any>> = []; private wake: (() => void) | null = null;
  interruptedFlag = false;
  constructor(public readonly prompt: AsyncIterable<any>, public readonly options: any, script: Script) {
    void (async () => {
      let index = 0;
      for await (const m of prompt) {
        const text = m?.message?.content?.[0]?.text ?? "";
        this.interruptedFlag = false;
        for await (const out of script({ text, index: index++ }, this)) { if (this.closed) return; if (this.interruptedFlag) break; this.push(out); }
        if (this.interruptedFlag) this.push({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1, duration_ms: 1 });
        if (this.closed) return;
      }
    })();
  }
  push(m: Record<string, any>) { this.outQ.push(m); this.wake?.(); this.wake = null; }
  async interrupt() { this.interrupts++; if (this.interruptBehaviour === "hang") return new Promise<void>(() => {}); this.interruptedFlag = true; }
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) { const m = this.outQ.shift(); if (m) { yield m; continue; } await new Promise<void>((r) => { this.wake = r; }); }
  }
}
const textTurn = (reply: string, id = "msg_1"): Script => async function* () {
  yield { type: "system", subtype: "init", model: "MiniMax-M3.1-Flash", claude_code_version: "2.1.305" };
  yield { type: "stream_event", event: { type: "message_start", message: { id } } };
  for (const c of reply.match(/.{1,4}/g) ?? []) yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: c } } };
  yield { type: "assistant", message: { id, content: [{ type: "text", text: reply }] }, parent_tool_use_id: null };
  yield { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 12, total_cost_usd: 0.01 };
};
function harness(o: { script?: Script; readiness?: Record<string, unknown>; maxConcurrentTurns?: number; interruptAckTimeoutMs?: number; route?: string; price?: (m: string) => any; proxyStats?: () => any } = {}) {
  silent();
  const root = mkdtempSync(join(tmpdir(), "vc-agenthost-"));
  const events: Array<{ sessionId: string; event: SessionEvent }> = [];
  const changed: number[] = [];
  const queries: FakeQuery[] = [];
  const handles: Array<{ closed: number; meta: any }> = [];
  let route = o.route ?? "minimax";
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => route as any,
    llmRouteReadiness: async (meta) => o.readiness ?? { route: meta?.llmRoute, ready: true },
    sessionAgentRuntime: async (meta) => { const h = { closed: 0, meta }; handles.push(h); return { llmRoute: meta.llmRoute as any, model: "MiniMax-M3.1-Flash", env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1", ANTHROPIC_AUTH_TOKEN: "vcgp_session_token" }, proxy: { url: "x", ...(o.proxyStats ? { stats: o.proxyStats } : {}) }, close: async () => { h.closed++; } }; },
  };
  let sdkLoads = 0;
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: (l) => changed.push(l.length) },
    service,
    loadSdk: async () => { sdkLoads++; return { sdk: { query: ({ prompt, options }) => { const q = new FakeQuery(prompt as any, options, o.script ?? textTurn("Hello from the agent.")); queries.push(q); return q as any; } }, executable: "/x/claude" }; },
    sessionsRoot: root, maxConcurrentTurns: o.maxConcurrentTurns, interruptAckTimeoutMs: o.interruptAckTimeoutMs ?? 200,
    ...(o.price ? { price: o.price, servedModel: () => "MiniMax-M3.1-Flash" } : {}),
  });
  const kinds = (sid: string) => events.filter((e) => e.sessionId === sid).map((e) => e.event.kind);
  return { host, events, changed, queries, handles, root, kinds, setRoute: (r: string) => { route = r; }, sdkLoads: () => sdkLoads, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("AgentHost.createSession: pins the current route, per-session cwd, idle, session:changed", () => {
  const h = harness();
  try {
    const m = h.host.createSession({ title: "t" });
    assert.equal(m.llmRoute, "minimax");
    assert.equal(m.status, "idle");
    assert.equal(m.agentHarness, "claude-code");
    assert.ok(existsSync(m.cwd) && m.cwd.startsWith(h.root));
    assert.deepEqual(h.changed, [1]);
    h.setRoute("claude-code");
    assert.equal(h.host.createSession({}).llmRoute, "claude-code", "later sessions pin the then-current route");
    assert.equal(h.host.listSessions().length, 2);
  } finally { h.cleanup(); }
});

test("AgentHost.sendMessage: spawns ONE streaming-input query bound to sessionAgentRuntime, streams original-shaped events, second turn reuses the runtime", async () => {
  const h = harness();
  try {
    const { sessionId } = h.host.createSession({});
    const r = await h.host.sendMessage(sessionId, { text: "hi", clientTurnId: "c1", attachmentIds: [] });
    assert.deepEqual(r, { submitted: true, duplicate: false, attachmentIds: [] });
    await until(() => h.host.runtimeInfo(sessionId).status === "idle");
    assert.deepEqual(h.kinds(sessionId), ["status", "port_runtime", "port_runtime", "text_delta", "text_delta", "text_delta", "text_delta", "text_delta", "text_delta", "assistant_text", "result", "status"]);
    const ev = h.events.map((e) => e.event);
    assert.deepEqual(ev[0], { kind: "status", status: "running" });
    assert.equal(ev.filter((e) => e.kind === "text_delta").map((e: any) => e.text).join(""), "Hello from the agent.");
    assert.deepEqual(ev.find((e) => e.kind === "assistant_text"), { kind: "assistant_text", text: "Hello from the agent.", messageId: "msg_1", blockIndex: 0 });
    const res = ev.find((e) => e.kind === "result") as any;
    assert.equal(res.isError, false); assert.equal(res.numTurns, 1); assert.equal(res.totalCostUsd, 0, "provider route: cost is not billed to the video (gateway only)");
    // SDK boundary
    assert.equal(h.queries.length, 1);
    const o = h.queries[0].options;
    assert.equal(typeof (h.queries[0].prompt as any)[Symbol.asyncIterator], "function", "streaming input (createLocalRuntime)");
    assert.equal(o.env.ANTHROPIC_AUTH_TOKEN, "vcgp_session_token");
    assert.equal(o.model, "MiniMax-M3.1-Flash");
    assert.equal(o.pathToClaudeCodeExecutable, "/x/claude");
    assert.equal(o.includePartialMessages, true);
    assert.deepEqual(o.tools, ["Read", "Glob", "Grep"]);
    assert.deepEqual(o.mcpServers, {}); assert.equal(o.strictMcpConfig, true); assert.deepEqual(o.settingSources, []);
    assert.equal(typeof o.canUseTool, "function");
    assert.equal(h.handles[0].meta.llmRoute, "minimax");
    // second turn: same runtime
    await h.host.sendMessage(sessionId, { text: "again", clientTurnId: "c2" });
    await until(() => h.kinds(sessionId).filter((k) => k === "result").length === 2);
    assert.equal(h.queries.length, 1); assert.equal(h.handles.length, 1); assert.equal(h.sdkLoads(), 1);
    // duplicate composer turn id
    assert.equal((await h.host.sendMessage(sessionId, { text: "again", clientTurnId: "c2" })).duplicate, true);
    await assert.rejects(h.host.sendMessage(sessionId, { text: "  " }), /Write a message/);
    await assert.rejects(h.host.sendMessage("nope", { text: "x" }), /Unknown session/);
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost: tool_use → tool_start, tool_result → tool_end; canUseTool confined to the session cwd", async () => {
  const toolScript: Script = async function* () {
    yield { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Glob", input: { pattern: "*" } }] }, parent_tool_use_id: null };
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "README.txt" }] } };
    yield { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "README.txt" }] }, parent_tool_use_id: null };
    yield { type: "result", subtype: "success", is_error: false, num_turns: 2, duration_ms: 5 };
  };
  const h = harness({ script: toolScript });
  try {
    const { sessionId, cwd } = h.host.createSession({});
    await h.host.sendMessage(sessionId, "list files");
    await until(() => h.host.runtimeInfo(sessionId).status === "idle");
    const start = h.events.find((e) => e.event.kind === "tool_start")!.event as any;
    assert.equal(start.toolName, "Glob"); assert.equal(start.toolUseId, "tu1"); assert.equal(start.summary, "Glob *"); assert.equal(start.background, false);
    assert.deepEqual(h.events.find((e) => e.event.kind === "tool_end")!.event, { kind: "tool_end", toolUseId: "tu1", isError: false, terminal: "ok" });
    const can = h.queries[0].options.canUseTool;
    assert.equal((await can("Read", { file_path: join(cwd, "README.txt") })).behavior, "allow");
    assert.equal((await can("Read", { file_path: "/etc/passwd" })).behavior, "deny");
    assert.equal((await can("Read", { file_path: "../../x" })).behavior, "deny");
    assert.equal((await can("Bash", { command: "echo hi" })).behavior, "deny");
    const p = confinedToolPolicy("/w/s1", ["Grep"]);
    assert.equal(p("Grep", { pattern: "x", path: "/w/s1/sub" }).allowed, true);
    assert.equal(p("Grep", { pattern: "x", path: "/w/s10" }).allowed, false, "prefix sibling is outside");
    assert.deepEqual(agentToolsFromEnv(undefined), ["Read", "Glob", "Grep"]);
    assert.deepEqual(agentToolsFromEnv("none"), []);
    assert.deepEqual(agentToolsFromEnv("Read, Bad-Name ,Glob"), ["Read", "Glob"]);
  } finally { await h.host.dispose(); h.cleanup(); }
});

const slowTurn: Script = async function* () {
  yield { type: "stream_event", event: { type: "message_start", message: { id: "s1" } } };
  for (let i = 0; i < 200; i++) { yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `w${i} ` } } }; await tick(10); }
  yield { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 2000 };
};

test("AgentHost.interrupt('stop'): synthetic stopped result, idle at once, query.interrupt(), no output after Stop, stale result swallowed, next turn works", async () => {
  let n = 0;
  const h = harness({ script: (t, c) => (n++ === 0 ? slowTurn(t, c) : textTurn("after stop", "m9")(t, c)) });
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, "write a lot");
    await until(() => h.kinds(sessionId).includes("text_delta"));
    await h.host.interrupt(sessionId, "stop");
    assert.equal(h.queries[0].interrupts, 1);
    assert.equal(h.host.runtimeInfo(sessionId).status, "idle");
    assert.equal(h.host.runtimeInfo(sessionId).running, true, "an acknowledged interrupt keeps the runtime (original)");
    const stop = h.events.filter((e) => e.event.kind === "result").at(-1)!.event as any;
    assert.equal(stop.isError, false); assert.equal(typeof stop.stoppedAfterMs, "number"); assert.equal(typeof stop.stopTurnId, "string");
    const at = h.events.length;
    await tick(80);
    assert.deepEqual(h.events.slice(at).filter((e) => e.event.kind !== "status").map((e) => e.event.kind), [], "the stopped turn's tail (incl. its error result) is swallowed");
    await h.host.sendMessage(sessionId, "next");
    await until(() => h.events.some((e) => e.event.kind === "assistant_text" && (e.event as any).text === "after stop"));
    await until(() => h.host.runtimeInfo(sessionId).status === "idle");
    assert.equal(h.events.filter((e) => e.event.kind === "result").length, 2, "stop result + next turn result; the interrupted turn's own result is never shown");
    assert.equal(h.queries.length, 1);
    await assert.rejects(h.host.interrupt(sessionId, "bogus"), /Invalid interruption reason/);
    await h.host.interrupt(sessionId, "stop"); // idle → no-op
    assert.equal(h.queries[0].interrupts, 1);
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost.interrupt: no ack within interruptAckTimeoutMs → runtime torn down (query.close + gate proxy close); next send respawns", async () => {
  const h = harness({ script: slowTurn, interruptAckTimeoutMs: 50 });
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, "x");
    await until(() => h.kinds(sessionId).includes("text_delta"));
    h.queries[0].interruptBehaviour = "hang";
    await h.host.interrupt(sessionId, "stop");
    assert.equal(h.queries[0].closed, true);
    await until(() => h.handles[0].closed === 1);
    assert.equal(h.host.runtimeInfo(sessionId).running, false);
    assert.equal(h.host.runtimeInfo(sessionId).status, "idle");
    const closed = h.events.find((e) => e.event.kind === "port_runtime" && (e.event as any).phase === "closed")!.event as any;
    assert.equal(closed.reason, "interrupt-ack-timeout");
    await h.host.sendMessage(sessionId, "y");
    assert.equal(h.queries.length, 2);
    assert.equal(h.handles.length, 2);
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost: Stop while the runtime is still spawning → idle, nothing is queued into the new runtime", async () => {
  silent();
  const h = harness();
  try {
    const { sessionId } = h.host.createSession({});
    const p = h.host.sendMessage(sessionId, "x");
    await h.host.interrupt(sessionId, "stop");
    await p;
    await tick(30);
    assert.equal(h.host.runtimeInfo(sessionId).status, "idle");
    assert.ok(!h.kinds(sessionId).includes("text_delta"));
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost.onLlmRouteChanged: active turn → original error card + status error + teardown; idle runtime → teardown; builtin-pinned skipped; next send respawns", async () => {
  const h = harness({ script: slowTurn, maxConcurrentTurns: 3 });
  try {
    const a = h.host.createSession({}).sessionId; // minimax, running
    const b = h.host.createSession({}).sessionId; // minimax, idle runtime
    h.setRoute("claude-code");
    const c = h.host.createSession({}).sessionId; // builtin pin
    await h.host.sendMessage(a, "x");
    await h.host.sendMessage(b, "x"); await h.host.interrupt(b, "stop");
    await h.host.sendMessage(c, "x");
    await until(() => h.kinds(a).includes("text_delta"));
    const r = h.host.onLlmRouteChanged();
    assert.deepEqual(r.interrupted.map((m) => m.sessionId), [a]);
    assert.equal(h.host.runtimeInfo(a).status, "error");
    assert.equal(h.host.runtimeInfo(a).running, false);
    assert.equal(h.host.runtimeInfo(b).running, false);
    assert.equal(h.host.runtimeInfo(b).status, "idle");
    assert.equal(h.host.runtimeInfo(c).running, true, "claude-code/gateway pins are not touched (L43130)");
    const err = h.events.filter((e) => e.sessionId === a && e.event.kind === "error").at(-1)!.event as any;
    assert.match(err.message, /language-model account changed/); assert.equal(err.canRetry, true);
    await until(() => h.handles.filter((x) => x.closed).length === 2);
    assert.equal(h.queries[0].closed && h.queries[1].closed, true);
    const at = h.events.length;
    await tick(60);
    assert.equal(h.events.slice(at).filter((e) => e.sessionId === a && e.event.kind === "text_delta").length, 0, "retired runtime output is dropped");
    await h.host.sendMessage(a, "retry");
    assert.equal(h.handles.at(-1)!.meta.llmRoute, "minimax", "a video keeps its pinned route after the switch");
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost.onLlmRouteChanged while spawning: the late runtime is discarded (gate proxy closed), status error", async () => {
  silent();
  const root = mkdtempSync(join(tmpdir(), "vc-agenthost-"));
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  let closed = 0; let queried = 0;
  const host = new AgentHost({
    emit: { sessionEvent: () => {}, sessionsChanged: () => {} },
    service: { newSessionLlmRoute: () => "minimax", llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async (m) => { await gate; return { llmRoute: "minimax", model: "m", env: {}, close: async () => { closed++; } }; } },
    loadSdk: async () => ({ sdk: { query: () => { queried++; return { async *[Symbol.asyncIterator]() {} } as any; } } }),
    sessionsRoot: root,
  });
  try {
    const { sessionId } = host.createSession({});
    const p = host.sendMessage(sessionId, "x");
    await tick(10);
    host.onLlmRouteChanged();
    release();
    await p; // resolves quietly: the error card was already sent by onLlmRouteChanged
    assert.equal(closed, 1); assert.equal(queried, 0);
    assert.equal(host.runtimeInfo(sessionId).status, "error");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AgentHost concurrency: host-wide 1 turn at a time (shared MiniMax key); same-video send while running refused; slot frees after result/stop", async () => {
  const h = harness({ script: slowTurn });
  try {
    const a = h.host.createSession({}).sessionId, b = h.host.createSession({}).sessionId;
    // two sends in the same tick: exactly one wins
    const rs = await Promise.allSettled([h.host.sendMessage(a, "x"), h.host.sendMessage(b, "y")]);
    assert.deepEqual(rs.map((r) => r.status), ["fulfilled", "rejected"]);
    assert.ok((rs[1] as PromiseRejectedResult).reason instanceof ComposerDeliveryError);
    assert.match(String((rs[1] as PromiseRejectedResult).reason.message), /1 agent turn at a time/);
    await assert.rejects(h.host.sendMessage(a, "again"), /still working/);
    assert.equal(h.host.runtimeInfo(b).status, "idle", "the refused video did not change state");
    assert.equal(h.queries.length, 1, "no second SDK child was started");
    await h.host.interrupt(a, "stop");
    await h.host.sendMessage(b, "y");
    assert.equal(h.host.runtimeInfo(b).status, "running");
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("AgentHost: route not ready / SDK missing → error event + status error + rejected send; error result → error card", async () => {
  const h = harness({ readiness: { route: "minimax", ready: false, reason: "provider-key-missing", keyEnv: "MINIMAX_API_KEY" } });
  try {
    const { sessionId } = h.host.createSession({});
    await assert.rejects(h.host.sendMessage(sessionId, "x"), /not ready \(provider-key-missing: set MINIMAX_API_KEY\)/);
    assert.equal(h.host.runtimeInfo(sessionId).status, "error");
    assert.deepEqual(h.kinds(sessionId), ["status", "error", "status"]);
    assert.equal(h.queries.length, 0);
  } finally { h.cleanup(); }
  silent();
  const root = mkdtempSync(join(tmpdir(), "vc-agenthost-"));
  const ev: SessionEvent[] = [];
  const host = new AgentHost({ emit: { sessionEvent: (_s, e) => ev.push(e), sessionsChanged: () => {} }, service: { newSessionLlmRoute: () => "minimax", llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("unused"); } }, loadSdk: async () => { throw new Error("Claude Agent SDK not installed"); }, sessionsRoot: root });
  try {
    const { sessionId } = host.createSession({});
    await assert.rejects(host.sendMessage(sessionId, "x"), /SDK not installed/);
    assert.equal(host.runtimeInfo(sessionId).status, "error");
  } finally { rmSync(root, { recursive: true, force: true }); }
  const h2 = harness({ script: async function* () { yield { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 8, duration_ms: 1 }; } });
  try {
    const { sessionId } = h2.host.createSession({});
    await h2.host.sendMessage(sessionId, "x");
    await until(() => h2.host.runtimeInfo(sessionId).status === "error");
    const err = h2.events.find((e) => e.event.kind === "error")!.event as any;
    assert.match(err.message, /error_max_turns/);
  } finally { await h2.host.dispose(); h2.cleanup(); }
});

test("agent IPC glue: original channel names, {sessionId, event} push payload, session:changed list", async () => {
  for (const ch of ["session:create", "session:send", "session:interrupt", "session:list"]) assert.ok((INVOKE_CHANNELS as readonly string[]).includes(ch), ch);
  for (const ch of ["session:event", "session:changed"]) assert.ok((PUSH_CHANNELS as readonly string[]).includes(ch), ch);
  const pushes: Array<[string, unknown]> = [];
  const h = harness();
  try {
    const emit = agentHostEmit((ch, p) => pushes.push([ch, p]), () => [{ sessionId: "from-registry" }, ...h.host.listSessions()]);
    emit.sessionEvent("s1", { kind: "status", status: "running" });
    emit.sessionsChanged([]);
    assert.deepEqual(pushes[0], ["session:event", { sessionId: "s1", event: { kind: "status", status: "running" } }]);
    assert.equal(pushes[1][0], "session:changed");
    const handlers = agentIpcHandlers(h.host, () => ["merged"]);
    const meta = await handlers["session:create"]!(undefined) as any;
    assert.equal(meta.llmRoute, "minimax");
    assert.deepEqual(await handlers["session:list"]!(), ["merged"]);
    const sent = await handlers["session:send"]!(meta.sessionId, { text: "hi", attachmentIds: [], clientTurnId: "t1" });
    assert.deepEqual(sent, { submitted: true, duplicate: false, attachmentIds: [] });
    await until(() => h.host.runtimeInfo(meta.sessionId).status === "idle");
    await handlers["session:interrupt"]!(meta.sessionId, "stop");
    await assert.rejects(Promise.resolve().then(() => handlers["session:send"]!(meta.sessionId, { text: "x", attachmentIds: ["a1"], clientTurnId: "t2" })), /Attachments are not supported/);
  } finally { await h.host.dispose(); h.cleanup(); }
});

test("renderer chat reducer: deltas stream into one bubble, final text replaces, tools, stop notice, foreign sessions ignored", () => {
  let st: ChatState = { ...initialChat(), sessionId: "s" };
  st = addUserTurn(st, "hi");
  const ev = (event: any, sessionId = "s") => { st = reduceChat(st, { sessionId, event }); };
  ev({ kind: "status", status: "running" });
  ev({ kind: "text_delta", text: "Hel", messageId: "m1" });
  ev({ kind: "text_delta", text: "lo", messageId: "m1" });
  ev({ kind: "text_delta", text: "IGNORED", messageId: "m1" }, "other");
  assert.deepEqual(st.items[1], { type: "assistant", messageId: "m1", text: "Hello", final: false });
  ev({ kind: "assistant_text", text: "Hello!", messageId: "m1", blockIndex: 0 });
  assert.deepEqual(st.items[1], { type: "assistant", messageId: "m1", text: "Hello!", final: true });
  ev({ kind: "tool_start", toolName: "Glob", toolUseId: "t", summary: "Glob *", detail: "{}", background: false });
  ev({ kind: "tool_end", toolUseId: "t", isError: false, terminal: "ok" });
  assert.equal((st.items[2] as any).state, "ok");
  ev({ kind: "result", isError: false, totalCostUsd: 0, numTurns: 0, durationMs: 1500, stoppedAfterMs: 1500 });
  assert.equal(st.lastResult!.stopped, true);
  assert.equal((st.items.at(-1) as any).text, "Stopped after 1.5 s");
  ev({ kind: "status", status: "idle" });
  ev({ kind: "port_runtime", phase: "started", llmRoute: "minimax", model: "M", gateProxy: true });
  assert.equal(st.status, "idle"); assert.equal(st.runtime, "minimax · M · gate proxy");
});

test("AgentHost + real LlmRouteService + gate proxy (local upstream): child env carries only the session token, the upstream sees the real key, proxy closes on teardown", async () => {
  silent(); resetProviderGatesForTests();
  const KEY = "mm-agenthost-test-key-not-real-0123456789";
  const seen: Array<{ auth?: string }> = [];
  const up = createServer((req, res) => { seen.push({ auth: req.headers.authorization }); req.resume(); req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "message", content: [{ type: "text", text: "pong" }] })); }); });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", () => r()));
  const upUrl = `http://127.0.0.1:${(up.address() as AddressInfo).port}`;
  const root = mkdtempSync(join(tmpdir(), "vc-agenthost-"));
  try {
    const reg = loadProviderRegistry({ json: { providers: [{ name: "minimax", baseUrl: upUrl + "/anthropic" }] } });
    const service = new LlmRouteService({ settings: () => ({ gatewayUrl: "", llmRoute: "minimax" }), registry: () => reg, env: () => ({ MINIMAX_API_KEY: KEY, PATH: "/usr/bin" }), profileDir: () => root });
    let childEnv: Record<string, string> = {};
    const host = new AgentHost({
      emit: { sessionEvent: () => {}, sessionsChanged: () => {} }, service, sessionsRoot: root,
      loadSdk: async () => ({ sdk: { query: ({ prompt, options }: any) => { childEnv = options.env; return (async function* () {
        for await (const _m of prompt) {
          const r = await fetch(options.env.ANTHROPIC_BASE_URL + "/v1/messages", { method: "POST", headers: { authorization: `Bearer ${options.env.ANTHROPIC_AUTH_TOKEN}` }, body: "{}" });
          const j = await r.json() as any;
          yield { type: "assistant", message: { id: "m", content: [{ type: "text", text: j.content[0].text }] } };
          yield { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1 };
        }
      })() as any; } } }),
    });
    const { sessionId } = host.createSession({});
    await host.sendMessage(sessionId, "ping");
    await until(() => host.runtimeInfo(sessionId).status === "idle", 5000);
    assert.ok(!Object.values(childEnv).includes(KEY), "provider key never in the child env");
    assert.match(childEnv.ANTHROPIC_AUTH_TOKEN, /^vcgp_/);
    assert.equal(seen[0].auth, `Bearer ${KEY}`);
    const proxyUrl = childEnv.ANTHROPIC_BASE_URL;
    host.onLlmRouteChanged();
    await tick(50);
    await assert.rejects(fetch(proxyUrl + "/v1/messages", { method: "POST", body: "{}" }), "gate proxy closed with the runtime");
    await host.dispose();
  } finally { rmSync(root, { recursive: true, force: true }); await new Promise<void>((r) => up.close(() => r())); }
});

// ── docs/30: displayed spend = metered usage priced by THE price table, never the SDK's Claude estimate ──
const FLASH = { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6, cacheReadPerMTokUsd: 0.015, source: "models.dev:minimax-cn/MiniMax-M3.1-Flash" };
const usageTurn = (modelUsage: Record<string, any>): Script => async function* () {
  yield { type: "system", subtype: "init", model: "MiniMax-M3.1-Flash", claude_code_version: "2.1.305" };
  yield { type: "assistant", message: { id: "m", content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null };
  yield { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 5, total_cost_usd: 0.05, modelUsage };
};
test("docs/30 spend: the SDK result's modelUsage (a Claude alias priced as the served MiniMax model) → result.totalCostUsd; total_cost_usd is ignored", async () => {
  const priced: string[] = [];
  const h = harness({ route: "gateway", price: (m) => { priced.push(m); return FLASH; }, script: usageTurn({ "claude-sonnet-4-5": { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 10000, cacheCreationInputTokens: 0 } }) });
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, { text: "hi", clientTurnId: "c1" });
    await until(() => h.kinds(sessionId).includes("result"));
    const res = h.events.map((e) => e.event).find((e) => e.kind === "result") as any;
    const expected = (1000 * 0.15 + 10000 * 0.015 + 200 * 0.6) / 1e6;
    assert.ok(Math.abs(res.totalCostUsd - expected) < 1e-12, `metered ${res.totalCostUsd} vs ${expected}`);
    assert.notEqual(res.totalCostUsd, 0.05, "never the SDK estimate");
    assert.deepEqual(priced, ["MiniMax-M3.1-Flash"]);
  } finally { await h.host.dispose(); h.cleanup(); }
});
test("docs/30 spend: a gate-proxied route (provider / Codex) is priced from the proxy's metered upstream usage, cumulative per runtime", async () => {
  let usage: any = { "MiniMax-M3.1-Flash": { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 1 } };
  const h = harness({ price: () => FLASH, proxyStats: () => ({ usage }), script: usageTurn({}) });
  try {
    const { sessionId } = h.host.createSession({});
    await h.host.sendMessage(sessionId, { text: "hi", clientTurnId: "c1" });
    await until(() => h.kinds(sessionId).includes("result"));
    usage = { "MiniMax-M3.1-Flash": { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 2 } };
    await h.host.sendMessage(sessionId, { text: "again", clientTurnId: "c2" });
    await until(() => h.kinds(sessionId).filter((k) => k === "result").length === 2);
    const results = h.events.map((e) => e.event).filter((e) => e.kind === "result") as any[];
    assert.ok(Math.abs(results[0].totalCostUsd - (100 * 0.15 + 10 * 0.6) / 1e6) < 1e-12);
    assert.ok(Math.abs(results[1].totalCostUsd - (300 * 0.15 + 30 * 0.6) / 1e6) < 1e-12, "cumulative runtime total, delta-added once");
  } finally { await h.host.dispose(); h.cleanup(); }
});
test("docs/30 spend: gateway route — the job's ledger (same models.dev price) trues up the displayed gateway reasoning to max(metered, ledger), idempotently", async () => {
  const h = harness({ route: "gateway", price: () => FLASH, script: usageTurn({}) });
  try {
    const { sessionId } = h.host.createSession({});
    const s: any = (h.host as any).sessions.get(sessionId);
    s.meta.jobId = "job-1"; s.meta.totalCostUsd = 0.04;
    (h.host as any).llmJobChargeTotals.set(sessionId, { jobId: "job-1", totalUsd: 0.04 });
    let r = h.host.trueUpGatewayReasoning(s, "job-1", 0.1);
    assert.equal(r.trueUpUsd, 0.06); assert.ok(Math.abs(s.meta.totalCostUsd - 0.1) < 1e-12, "raised to the ledger");
    r = h.host.trueUpGatewayReasoning(s, "job-1", 0.1);
    assert.ok(Math.abs(s.meta.totalCostUsd - 0.1) < 1e-12, "same ledger → no double count");
    (h.host as any).llmJobChargeTotals.get(sessionId).totalUsd = 0.12; s.meta.totalCostUsd += 0.08; // metered caught up past the ledger
    r = h.host.trueUpGatewayReasoning(s, "job-1", 0.1);
    assert.equal(r.trueUpUsd, 0); assert.ok(Math.abs(s.meta.totalCostUsd - 0.12) < 1e-12, "the earlier true-up is withdrawn when metered usage exceeds the ledger");
    assert.deepEqual(h.host.trueUpGatewayReasoning(s, "other-job", 5), {}, "another job's ledger never moves this session");
  } finally { await h.host.dispose(); h.cleanup(); }
});
test("docs/31 §5 spend: after a Stop the host waits for the drained calls (shim llm_in_flight / proxy inflight), then reconciles / re-meters once", async () => {
  const h = harness({ route: "gateway", price: () => FLASH, script: usageTurn({}) });
  // the poll pause is unref'd (never holds the app open); keep this test's own loop alive (seen on win32: nothing else does)
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const { sessionId } = h.host.createSession({});
    const host: any = h.host; const s: any = host.sessions.get(sessionId);
    s.meta.jobId = "job-1";
    host.d.gatewaySettings = () => ({ gatewayUrl: "http://gw", gatewayKey: "k" });
    const reads = [{ llm_in_flight: 1 }, { llm_in_flight: 1 }, { llm_in_flight: 0 }];
    let readN = 0, reconciled = 0, metered = 0;
    host.readGatewaySpend = async () => reads[Math.min(readN++, reads.length - 1)];
    host.reconcileGatewaySpend = async () => { reconciled++; };
    await host.settleSpendAfterStop(s, { llmRoute: "gateway", handle: {} }, { pollMs: 2 });
    assert.equal(readN, 3, "polled until the shim had no call in flight for the job"); assert.equal(reconciled, 1);
    // a proxy route: wait for the gate proxy's inflight to drain, then meter the runtime once more
    let inflight = 2;
    host.meterResultCost = () => { metered++; };
    await host.settleSpendAfterStop(s, { llmRoute: "minimax", handle: { proxy: { stats: () => ({ inflight: inflight > 0 ? inflight-- : 0 }) } } }, { pollMs: 2 });
    assert.equal(metered, 1); assert.equal(inflight, 0); assert.equal(reconciled, 1, "a proxy route never reads the gateway ledger");
  } finally { clearInterval(keepAlive); await h.host.dispose(); h.cleanup(); }
});
test("docs/30 inputs: requestInput (L48142) parks a pending input card, respondInput (L44689) answers it and records the settled ask; a dead runtime cancels", async () => {
  const h = harness();
  try {
    const { sessionId } = h.host.createSession({});
    const early = await h.host.requestInput({ sessionId, kind: "rights", prompt: "p", destDir: "/tmp" } as any);
    assert.deepEqual(early, { kind: "cancel", reason: "Session runtime changed" }, "no runtime yet");
    await h.host.sendMessage(sessionId, { text: "hi", clientTurnId: "c1" });
    await until(() => h.kinds(sessionId).includes("result"));
    const answer = h.host.requestInput({ sessionId, kind: "rights", prompt: "Ana\n\nintro", destDir: "/tmp" } as any);
    const pending = h.host.listPendingInteractions().filter((p) => p.kind === "input");
    assert.equal(pending.length, 1); assert.equal(pending[0].request.kind, "rights");
    h.host.respondInput(pending[0].request.requestId, { kind: "rights", accepted: true });
    assert.deepEqual(await answer, { kind: "rights", accepted: true });
    assert.equal(h.host.listPendingInteractions().length, 0);
    const settled = h.events.map((e) => e.event).find((e: any) => e.kind === "ask_settled") as any;
    assert.ok(settled, "ask_settled event");
    assert.deepEqual([settled.record.askId, settled.record.family, settled.record.outcome, settled.record.title], [pending[0].request.requestId, "rights", "answered", "Rights confirmation"]);
  } finally { await h.host.dispose(); h.cleanup(); }
});
