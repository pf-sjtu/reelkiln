import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { AgentGatewayProxy, bearer, GATEWAY_CANCEL_REASON } from "../src/main/gateway/agent-gateway-proxy";

function get(origin: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: any; body: any }> {
  return new Promise((resolve, reject) => {
    const r = request(`${origin}/v1/x`, { method: "POST", headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(b) }));
    });
    r.on("error", reject);
    r.end("{}");
  });
}

test("AgentGatewayProxy binds 127.0.0.1:<ephemeral>, issues vcs_ tokens, 401s unknown tokens (loopback only, no upstream)", async () => {
  const p = await AgentGatewayProxy.start("https://gw.invalid///", "acct-key");
  try {
    assert.match(p.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(p.gatewayUrl, "https://gw.invalid");
    const c = p.credentials("s1", { jobId: () => "j" });
    assert.match(c.gatewayKey, /^vcs_[0-9a-f]{64}$/);
    assert.equal(c.gatewayUrl, p.origin);
    const r1 = await get(p.origin);
    assert.equal(r1.status, 401);
    assert.equal(r1.headers["x-videoclaw-not-forwarded"], "1");
    assert.deepEqual(r1.body, { detail: "invalid session credential" });
    const r2 = await get(p.origin, { authorization: `Bearer ${c.gatewayKey}` });
    assert.equal(r2.status, 501);
    // credentials() replaces the previous non-auxiliary token; auxiliary survives
    const aux = p.auxiliaryCredentials("s1", { jobId: () => "j" });
    const c2 = p.credentials("s1", { jobId: () => "j" });
    assert.equal(p.sessions.has(c.gatewayKey), false);
    assert.equal(p.sessions.has(aux.gatewayKey), true);
    const ac = new AbortController();
    p.sessions.get(c2.gatewayKey)!.activeRequests.add(ac);
    p.revoke("s1");
    assert.equal(ac.signal.reason, GATEWAY_CANCEL_REASON);
    assert.equal(p.sessions.size, 0);
    assert.throws(() => p.credentialsForTools("s", [], 0), /bounded call count/);
    assert.deepEqual(p.upstreamHeaders({ a: "b" }), { authorization: "Bearer acct-key", a: "b" });
  } finally { p.close(); }
});

test("bearer() parsing", () => {
  assert.equal(bearer({ authorization: "bearer  abc " }), "abc");
  assert.equal(bearer({}), undefined);
});
