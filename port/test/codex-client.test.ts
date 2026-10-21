import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexAppServerClient, assertCompatibleServer, codexAppServerVersion } from "../src/main/codex/app-server-client";

function fakeCodex(respond: (msg: any, reply: (o: any) => void) => void) {
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
  const proc: any = new EventEmitter();
  Object.assign(proc, { stdin, stdout, stderr, pid: 1, kill: () => { setImmediate(() => proc.emit("exit", null, "SIGTERM")); return true; } });
  const written: any[] = [];
  let buf = "";
  stdin.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); written.push(m); respond(m, (o) => stdout.write(JSON.stringify(o) + "\n")); }
  });
  return { proc, written, stdout };
}

test("initialize handshake: exact params, version gate 0.160.1, then `initialized` notification", async () => {
  const f = fakeCodex((m, reply) => { if (m.method === "initialize") reply({ id: m.id, result: { userAgent: "videoclaw_desktop/0.160.1 (Windows)" } }); });
  const c = new CodexAppServerClient({ spawnProcess: () => f.proc, appVersion: "0.0.40" });
  await c.initialize();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(f.written[0], { method: "initialize", id: 1, params: { clientInfo: { name: "videoclaw_desktop", title: "VideoClaw", version: "0.0.40" }, capabilities: { experimentalApi: true, requestAttestation: false } } });
  assert.deepEqual(f.written[1], { method: "initialized", params: {} });
  c.close();
});

test("version mismatch rejects with the original message; errors/unknown ids/server requests handled", async () => {
  assert.throws(() => assertCompatibleServer({ userAgent: "Codex Desktop/0.161.0" }, "0.160.1", undefined), /Unsupported Codex app-server protocol \(0\.161\.0\); VideoClaw requires 0\.160\.1\. Server identity: Codex Desktop\/0\.161\.0\./);
  assert.equal(codexAppServerVersion("videoclaw_desktop/0.160.1"), "0.160.1");
  const events: any[] = [];
  const f = fakeCodex((m, reply) => {
    if (m.method === "account/read") reply({ id: m.id, error: { message: "nope" } });
  });
  const c = new CodexAppServerClient({ spawnProcess: () => f.proc });
  c.onEvent((e) => events.push(e));
  await assert.rejects(c.request("account/read", { refreshToken: false }), /nope/);
  f.stdout.write(JSON.stringify({ id: 99, result: 1 }) + "\n");
  f.stdout.write(JSON.stringify({ id: "s1", method: "item/commandExecution/requestApproval", params: {} }) + "\n");
  f.stdout.write(JSON.stringify({ id: "s2", method: "item/tool/call", params: {} }) + "\n");
  f.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "t", turn: { id: "u" } } }) + "\n");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events[0], { kind: "warning", message: "Codex app server returned an unknown response." });
  // docs/27: notifications are normalized by the verbatim normalizeCodexNotification (L24268)
  assert.equal(events[1]?.kind, "turn_started");
  assert.equal(events[1]?.threadId, "t");
  assert.equal(events[1]?.turnId, "u");
  assert.deepEqual(f.written.at(-2), { id: "s1", error: { code: -32601, message: "Unsupported server request." } });
  assert.equal(f.written.at(-1).result.success, false);
  c.close();
  await assert.rejects(c.request("account/logout"), /closed/);
});

test("request timeout message", async () => {
  const f = fakeCodex(() => {});
  const c = new CodexAppServerClient({ spawnProcess: () => f.proc, requestTimeoutMs: 20 });
  await assert.rejects(c.request("thread/read", { threadId: "x", includeTurns: true }), /Codex app server request timed out: thread\/read/);
  c.close();
});
