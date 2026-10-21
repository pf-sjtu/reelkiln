// PORT-NEW (docs/16 §4.1): loopback "gate proxy" between a Claude Code child and an
// anthropic-messages provider. Found necessary by the real end-to-end run (Claude Code 2.1.305
// against MiniMax):
//   1. The child issues requests the main process never sees (the turn itself, a parallel
//      generate_session_title side-request, subagents, several videos at once), so the
//      account-level concurrency gate of the provider framework (docs/15 §4) was bypassed — MiniMax's
//      key is shared with another pipeline and must stay at concurrency 1.
//   2. The provider key sat in the child env (ANTHROPIC_AUTH_TOKEN) and the agent's own Bash tool
//      could read it (verified: `echo ${#ANTHROPIC_AUTH_TOKEN}` printed the real key length).
// With the proxy the child gets ANTHROPIC_BASE_URL=http://127.0.0.1:<port> and a random per-session
// token; the proxy checks that token, swaps in the real auth header and runs every upstream request
// inside providerGate(gateKey) (held until the streamed response has ended).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getLogger, registerSecret, type Logger } from "./logger";
import { authHeaders } from "./protocols";
import type { ResolvedProvider } from "./provider-registry";
import { providerGate, type ConcurrencyLimiter } from "./retry";

export interface AgentGateProxy {
  url: string;
  /** Per-session credential the child presents (ANTHROPIC_AUTH_TOKEN). Not the provider key. */
  token: string;
  stats(): { requests: number; rejected: number; maxInflight: number; inflight: number };
  close(): Promise<void>;
}
export interface AgentGateProxyOptions {
  gate?: ConcurrencyLimiter;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  maxBodyBytes?: number;
}

const HOP_BY_HOP = new Set(["host", "connection", "keep-alive", "content-length", "transfer-encoding", "accept-encoding", "authorization", "x-api-key", "proxy-authorization", "upgrade", "te", "trailer"]);
const RESPONSE_DROP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

function presented(req: IncomingMessage): string | undefined {
  const a = req.headers.authorization;
  if (typeof a === "string" && /^Bearer /i.test(a)) return a.slice(7).trim();
  const k = req.headers["x-api-key"];
  return typeof k === "string" ? k.trim() : undefined;
}
function sameToken(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function jsonError(res: ServerResponse, status: number, type: string, message: string): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type, message } }));
}

export async function startAgentGateProxy(p: Pick<ResolvedProvider, "name" | "baseUrl" | "auth" | "key" | "headers" | "maxConcurrency" | "gateKey">, o: AgentGateProxyOptions = {}): Promise<AgentGateProxy> {
  const log = (o.logger ?? getLogger()).child({ component: "agent-gate-proxy", provider: p.name });
  const doFetch = o.fetchImpl ?? fetch;
  const maxBody = o.maxBodyBytes ?? 64 * 1024 * 1024;
  const token = `vcgp_${randomBytes(32).toString("hex")}`;
  registerSecret(token);
  const gate = () => o.gate ?? providerGate(p.gateKey ?? p.name, p.maxConcurrency);
  const extra = Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k.toLowerCase(), v]));
  let requests = 0, rejected = 0, inflight = 0, maxInflight = 0;

  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    const path = req.url ?? "/";
    // Only the Messages API surface is forwarded; Claude Code's unauthenticated HEAD /api/hello
    // reachability probe and anything else is answered locally (never forwarded with the real key).
    if (!/^\/v1\//.test(path)) { req.resume(); res.writeHead(req.method === "HEAD" ? 200 : 404); res.end(); return; }
    if (!sameToken(presented(req), token)) { rejected++; req.resume(); return jsonError(res, 401, "authentication_error", "invalid gate-proxy session token"); }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const c of req) { size += (c as Buffer).length; if (size > maxBody) return jsonError(res, 413, "request_too_large", "request body too large"); chunks.push(c as Buffer); }
    } catch { return; }
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });
    let waitedMs = 0;
    const queuedAt = Date.now();
    try {
      await gate().run(async () => {
        waitedMs = Date.now() - queuedAt;
        if (abort.signal.aborted) return;
        requests++; inflight++; maxInflight = Math.max(maxInflight, inflight);
        try {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k) && typeof v === "string") headers[k] = v;
          Object.assign(headers, extra, authHeaders(p.auth, p.key));
          const method = req.method ?? "GET";
          const upstream = await doFetch(p.baseUrl + path, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks), signal: abort.signal });
          const rh: Record<string, string> = {};
          upstream.headers.forEach((v, k) => { if (!RESPONSE_DROP.has(k)) rh[k] = v; });
          res.writeHead(upstream.status, rh);
          if (upstream.body) for await (const c of upstream.body as any) { if (!res.write(c)) await new Promise((r) => res.once("drain", r)); }
          res.end();
          log.debug("agent_proxy.request", { method, path: path.split("?")[0], status: upstream.status, waitedMs, ms: Date.now() - t0 });
        } finally { inflight--; }
      });
    } catch (e: any) {
      if (abort.signal.aborted) { res.destroy(); return; }
      log.warn("agent_proxy.upstream_failed", { path: path.split("?")[0], error: e });
      jsonError(res, 502, "api_error", "gate proxy could not reach the provider");
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const port = (server.address() as AddressInfo).port;
  log.info("agent_proxy.started", { port, maxConcurrency: p.maxConcurrency });
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    stats: () => ({ requests, rejected, maxInflight, inflight }),
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** Rewrites a provider child env (claudeAgentEnv output) to go through the proxy: base URL → proxy,
 *  the only credential left is the session token; non-secret custom headers are kept, an auth
 *  header (auth.scheme "header") is removed. */
export function proxiedAgentEnv(env: Record<string, string>, proxy: Pick<AgentGateProxy, "url" | "token">, p: Pick<ResolvedProvider, "headers">): Record<string, string> {
  const out: Record<string, string> = { ...env, ANTHROPIC_BASE_URL: proxy.url, ANTHROPIC_AUTH_TOKEN: proxy.token };
  delete out.ANTHROPIC_API_KEY;
  const custom = Object.entries(p.headers).map(([k, v]) => `${k}: ${v}`);
  if (custom.length) out.ANTHROPIC_CUSTOM_HEADERS = custom.join("\n"); else delete out.ANTHROPIC_CUSTOM_HEADERS;
  return out;
}
