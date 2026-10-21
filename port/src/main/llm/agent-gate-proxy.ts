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
  /** docs/30: cumulative token usage per upstream model, read from every upstream reply (the displayed spend of a
   *  provider / Codex route is priced from it with the models.dev-first table — never the SDK's Claude estimate). */
  usage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; calls: number }>;
}
/** docs/30: reads token usage out of an upstream reply as it streams past (Anthropic Messages SSE / JSON, OpenAI
 *  Responses SSE / JSON, Chat Completions JSON). Anthropic input_tokens exclude cache reads; OpenAI input_tokens
 *  include input_tokens_details.cached_tokens, which are moved to cacheRead so the price split is the same. */
export class UsageMeter {
  private buf = "";
  private readonly dec = new TextDecoder();
  inputTokens = 0; outputTokens = 0; cacheReadTokens = 0; cacheWriteTokens = 0; model?: string; seen = false;
  private anthropic(u: any) {
    if (!u || typeof u !== "object") return;
    if (Number.isFinite(u.input_tokens) && u.input_tokens > 0) this.inputTokens = u.input_tokens;
    if (Number.isFinite(u.cache_read_input_tokens) && u.cache_read_input_tokens > 0) this.cacheReadTokens = u.cache_read_input_tokens;
    if (Number.isFinite(u.cache_creation_input_tokens) && u.cache_creation_input_tokens > 0) this.cacheWriteTokens = u.cache_creation_input_tokens;
    if (Number.isFinite(u.output_tokens) && u.output_tokens > 0) this.outputTokens = u.output_tokens;
    this.seen = true;
  }
  private openai(u: any) {
    if (!u || typeof u !== "object") return;
    const input = Number(u.input_tokens ?? u.prompt_tokens ?? 0) || 0;
    const cached = Number(u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0) || 0;
    this.inputTokens = Math.max(0, input - cached); this.cacheReadTokens = cached;
    this.outputTokens = Number(u.output_tokens ?? u.completion_tokens ?? 0) || 0;
    this.seen = true;
  }
  event(ev: any) {
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "message_start") { this.model ??= ev.message?.model; this.anthropic(ev.message?.usage); }
    else if (ev.type === "message_delta") this.anthropic(ev.usage);
    else if (ev.type === "response.completed" || ev.type === "response.done") { this.model ??= ev.response?.model; this.openai(ev.response?.usage); }
    else if (ev.type === "message" && ev.usage) { this.model ??= ev.model; this.anthropic(ev.usage); }
    else if (ev.object === "response" && ev.usage) { this.model ??= ev.model; this.openai(ev.usage); }
    else if (ev.object === "chat.completion" && ev.usage) { this.model ??= ev.model; this.openai(ev.usage); }
  }
  push(chunk: string | Uint8Array) {
    this.buf += typeof chunk === "string" ? chunk : this.dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (line.startsWith("data:")) { try { this.event(JSON.parse(line.slice(5).trim())); } catch {} }
    }
  }
  json(text: string) { try { this.event(JSON.parse(text)); } catch {} }
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
  const usage: NonNullable<AgentGateProxyStats["usage"]> = {};
  const record = (meter: UsageMeter, requestModel: string | undefined) => {
    if (!meter.seen) return;
    const model = requestModel || meter.model || "unknown";
    const u = (usage[model] ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 0 });
    u.inputTokens += meter.inputTokens; u.outputTokens += meter.outputTokens; u.cacheReadTokens += meter.cacheReadTokens; u.cacheWriteTokens += meter.cacheWriteTokens; u.calls++;
  };
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
          const meter = new UsageMeter();
          let requestModel: string | undefined;
          try { const m = JSON.parse(reqBody.toString("utf8"))?.model; if (typeof m === "string") requestModel = m; } catch {}
          const sse = /text\/event-stream/i.test(upstream.headers.get("content-type") ?? "");
          let jsonBuf = "";
          const okStatus = upstream.status >= 200 && upstream.status < 300;
          const textOf = (c: string | Uint8Array) => (typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
          const write = async (c: string | Uint8Array) => {
            if (okStatus) { if (sse) meter.push(c); else if (jsonBuf.length < 4_000_000) jsonBuf += textOf(c); }
            if (c.length && !res.write(c)) await new Promise((r) => res.once("drain", r));
          };
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
          if (okStatus && !sse) meter.json(jsonBuf);
          res.end();
          record(meter, requestModel);
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
    stats: () => ({ requests, rejected, maxInflight, inflight, structuredEmulated, structuredJsonOk, usage: JSON.parse(JSON.stringify(usage)) }),
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
