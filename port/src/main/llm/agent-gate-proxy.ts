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
import { rewriteStructuredMessage, rewriteStructuredRequest, StructuredSseRewriter } from "./structured-emulation";
import { ResponsesStructuredSseRewriter, rewriteResponsesStructuredJson, rewriteResponsesStructuredRequest } from "./structured-emulation-responses";

export interface AgentGateProxy {
  url: string;
  /** Per-session credential the child presents (ANTHROPIC_AUTH_TOKEN). Not the provider key. */
  token: string;
  stats(): AgentGateProxyStats;
  close(): Promise<void>;
}
export interface AgentGateProxyStats {
  requests: number; rejected: number; maxInflight: number; inflight: number;
  /** docs/17 §3: structured-output requests rewritten to a forced tool call / of those, replies that
   *  came back as parseable JSON text. */
  structuredEmulated: number; structuredJsonOk: number;
}
export interface AgentGateProxyOptions {
  /** Override of p.agentCompat.emulateStructuredOutputs. */
  emulateStructuredOutputs?: boolean;
  gate?: ConcurrencyLimiter;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  maxBodyBytes?: number;
  /** docs/27: which client surface the proxy serves. "anthropic" (default): Claude Code →
   *  /v1/messages, upstream = baseUrl + path. "openai": a Codex child (OpenAI-compatible, base_url =
   *  <proxy>/v1) → /v1/responses (+ /v1/models, /v1/chat/completions), upstream = baseUrl (which ends in
   *  /v1) + path without the /v1 prefix; errors in the OpenAI shape; structured outputs emulated on the
   *  Responses API (structured-emulation-responses.ts). */
  surface?: "anthropic" | "openai";
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
function jsonError(res: ServerResponse, status: number, type: string, message: string, surface: "anthropic" | "openai" = "anthropic"): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(surface === "openai" ? { error: { type, message, code: type } } : { type: "error", error: { type, message } }));
}

export async function startAgentGateProxy(p: Pick<ResolvedProvider, "name" | "baseUrl" | "auth" | "key" | "headers" | "maxConcurrency" | "gateKey"> & Partial<Pick<ResolvedProvider, "agentCompat">>, o: AgentGateProxyOptions = {}): Promise<AgentGateProxy> {
  const log = (o.logger ?? getLogger()).child({ component: "agent-gate-proxy", provider: p.name });
  const doFetch = o.fetchImpl ?? fetch;
  const maxBody = o.maxBodyBytes ?? 64 * 1024 * 1024;
  const token = `vcgp_${randomBytes(32).toString("hex")}`;
  registerSecret(token);
  const gate = () => o.gate ?? providerGate(p.gateKey ?? p.name, p.maxConcurrency);
  const extra = Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k.toLowerCase(), v]));
  let requests = 0, rejected = 0, inflight = 0, maxInflight = 0, structuredEmulated = 0, structuredJsonOk = 0;
  const emulate = o.emulateStructuredOutputs ?? !!p.agentCompat?.emulateStructuredOutputs;
  const jsonOk = (t: string) => { try { JSON.parse(t); return true; } catch { return false; } };
  const surface = o.surface ?? "anthropic";
  const fail = (res: ServerResponse, status: number, type: string, message: string) => jsonError(res, status, type, message, surface);
  const upstreamUrl = (path: string) => (surface === "openai" ? p.baseUrl + path.replace(/^\/v1(?=\/|\?|$)/, "") : p.baseUrl + path);

  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    const path = req.url ?? "/";
    // Only the Messages API surface is forwarded; Claude Code's unauthenticated HEAD /api/hello
    // reachability probe and anything else is answered locally (never forwarded with the real key).
    if (!/^\/v1\//.test(path)) { req.resume(); res.writeHead(req.method === "HEAD" ? 200 : 404); res.end(); return; }
    if (!sameToken(presented(req), token)) { rejected++; req.resume(); return fail(res, 401, "authentication_error", "invalid gate-proxy session token"); }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const c of req) { size += (c as Buffer).length; if (size > maxBody) return fail(res, 413, "request_too_large", "request body too large"); chunks.push(c as Buffer); }
    } catch { return; }
    let reqBody = Buffer.concat(chunks);
    let emulated = false;
    const structuredPath = surface === "openai" ? /^\/v1\/responses(\?|$)/ : /^\/v1\/messages(\?|$)/;
    if (emulate && req.method === "POST" && structuredPath.test(path)) {
      let parsed: unknown;
      try { parsed = JSON.parse(reqBody.toString("utf8")); } catch { parsed = undefined; }
      const rewritten = surface === "openai" ? rewriteResponsesStructuredRequest(parsed) : rewriteStructuredRequest(parsed);
      if (rewritten) { reqBody = Buffer.from(JSON.stringify(rewritten)); emulated = true; structuredEmulated++; }
    }
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
          const upstream = await doFetch(upstreamUrl(path), { method, headers, body: method === "GET" || method === "HEAD" ? undefined : reqBody, signal: abort.signal });
          const rh: Record<string, string> = {};
          upstream.headers.forEach((v, k) => { if (!RESPONSE_DROP.has(k)) rh[k] = v; });
          const write = async (c: string | Uint8Array) => { if (c.length && !res.write(c)) await new Promise((r) => res.once("drain", r)); };
          if (emulated && upstream.status === 200 && /text\/event-stream/i.test(upstream.headers.get("content-type") ?? "")) {
            res.writeHead(upstream.status, rh);
            const rw = surface === "openai" ? new ResponsesStructuredSseRewriter() : new StructuredSseRewriter();
            const dec = new TextDecoder();
            if (upstream.body) for await (const c of upstream.body as any) await write(rw.push(dec.decode(c, { stream: true })));
            await write(rw.push(dec.decode()) + rw.flush());
            if (rw.sawTool && jsonOk(rw.json)) structuredJsonOk++;
            log.debug("agent_proxy.structured_emulated", { stream: true, sawTool: rw.sawTool, jsonOk: jsonOk(rw.json) });
          } else if (emulated && upstream.status === 200) {
            const text = await upstream.text();
            let outText = text;
            try {
              if (surface === "openai") {
                const r = rewriteResponsesStructuredJson(JSON.parse(text));
                outText = JSON.stringify(r.resp);
                if (r.json !== undefined && jsonOk(r.json)) structuredJsonOk++;
              } else {
                const r = rewriteStructuredMessage(JSON.parse(text));
                outText = JSON.stringify(r.msg);
                if (r.json !== undefined) structuredJsonOk++;
              }
            } catch { /* not JSON: pass through */ }
            res.writeHead(upstream.status, rh);
            await write(outText);
            log.debug("agent_proxy.structured_emulated", { stream: false });
          } else {
            res.writeHead(upstream.status, rh);
            if (upstream.body) for await (const c of upstream.body as any) await write(c);
          }
          res.end();
          log.debug("agent_proxy.request", { method, path: path.split("?")[0], status: upstream.status, waitedMs, emulated, ms: Date.now() - t0 });
        } finally { inflight--; }
      });
    } catch (e: any) {
      if (abort.signal.aborted) { res.destroy(); return; }
      log.warn("agent_proxy.upstream_failed", { path: path.split("?")[0], error: e });
      fail(res, 502, "api_error", "gate proxy could not reach the provider");
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const port = (server.address() as AddressInfo).port;
  log.info("agent_proxy.started", { port, maxConcurrency: p.maxConcurrency, surface });
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    stats: () => ({ requests, rejected, maxInflight, inflight, structuredEmulated, structuredJsonOk }),
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
