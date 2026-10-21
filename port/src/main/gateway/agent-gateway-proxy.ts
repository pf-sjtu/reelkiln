// AgentGatewayProxy — SHAPE port of main/index.js L28672-30374 (class) + helpers L28204-28520.
// The proxy is OS-neutral (an http server on 127.0.0.1:0 that swaps per-session `vcs_…`
// capability tokens for the account key), so nothing here needs Windows-specific code.
// Ported REAL: start/bind, credential lifecycle (credentials, auxiliaryCredentials,
// issueCredentials, revokeCredential, credentialsForTools, revoke, abortSessionRequests,
// close), upstreamHeaders, bearer(), reject(), rejectHarnessReview().
// STUBBED: handle() authenticates exactly like the original (L28997-29010: header
// x-videoclaw-not-forwarded, 401 "invalid session credential") and then refuses with 501
// before forwarding anything. authorize() (L29655-30327, spend/quote/permit logic),
// settlementPolicies(), operationContext(), harnessReviewCredentials() are NOT PORTED.
// docs/29: quoteProject / setSessionSpendPolicy / getJobBudget / credentialsForBudgetedTools are ported
// (L28891-28970), and handle() forwards the TOOL-LIMITED capability subset of authorize() (L29730-29860:
// uploads, the allowed tools' quotes and submits with the fixed client_job, their child job polls) — the shape
// the Library lease (L45713) and the character-sheet build (L19216) mint. Session agent credentials (spend
// approval / quotes / permits, L29655-30327) still refuse 501 before anything is forwarded.
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { isClientJobId } from "../engine/session";

export const PROVIDER_CREDENTIAL_CODE = "PROVIDER_CREDENTIAL_MISCONFIGURED"; // L28204
export const GATEWAY_CANCEL_REASON = "videoclaw:gateway-requests-cancelled"; // L28335
export const SPEND_APPROVAL_PENDING_CODE = "SPEND_APPROVAL_PENDING"; // workbookContents chunk
export const SPEND_AUTHORITY_REQUIRED_CODE = "SPEND_AUTHORITY_REQUIRED"; // workbookContents chunk
export const NON_RETRYABLE_REFUSAL_CODES = new Set(["SPEND_POLICY_CHANGED", "ACCOUNT_DEBT", PROVIDER_CREDENTIAL_CODE, SPEND_APPROVAL_PENDING_CODE, SPEND_AUTHORITY_REQUIRED_CODE]); // L28340
export const MAX_BODY_BYTES = 16 * 1024 * 1024; // L28503

/** Policy fields observed at the original call sites (credentialsForTools L28880,
 *  harnessReviewCredentials L28765, videoRuntimeOwnsChildJob L28791). Not exhaustive:
 *  authorize() reads more (TODO when ported). */
export interface GatewaySessionPolicy {
  jobId: () => string | undefined;
  projectId?: () => string | undefined;
  allowLlm?: boolean;
  allowedUnscopedTools?: string[] | Set<string>;
  fixedUnscopedJobId?: string;
  unscopedCallLimit?: number;
  recoveryOnly?: boolean;
  harnessReviewOnly?: { jobId: string; uploadsLeft: number; uploadIds: Set<string>; reviewedUploadIds: Set<string> };
  [k: string]: unknown;
}
interface SessionEntry { sessionId: string; auxiliary: boolean; policy: GatewaySessionPolicy; childJobs: Map<string, string>; unscopedCalls: number; activeRequests: Set<AbortController> }
export interface GatewayCredentials { gatewayUrl: string; gatewayKey: string }

export function bearer(headers: IncomingHttpHeaders): string | undefined { // L28514
  const value = headers.authorization;
  if (typeof value !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

export class AgentGatewayProxy {
  readonly sessions = new Map<string, SessionEntry>();
  constructor(readonly server: Server, readonly origin: string, readonly gatewayUrl: string, private gatewayKey: string) {}

  static async start(gatewayUrl: string, gatewayKey: string): Promise<AgentGatewayProxy> { // L28714
    const normalized = gatewayUrl.replace(/\/+$/, "");
    let proxy!: AgentGatewayProxy;
    const server = createServer((req, res) => { void proxy.handle(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address() as AddressInfo | string | null;
    if (!address || typeof address === "string") { server.close(); throw new Error("Could not start the private gateway proxy."); }
    proxy = new AgentGatewayProxy(server, `http://127.0.0.1:${address.port}`, normalized, gatewayKey);
    return proxy;
  }
  credentials(sessionId: string, policy: GatewaySessionPolicy): GatewayCredentials { // L28740
    for (const [token, entry] of this.sessions) if (entry.sessionId === sessionId && !entry.auxiliary) this.revokeCredential(token);
    return this.issueCredentials(sessionId, policy, false);
  }
  auxiliaryCredentials(sessionId: string, policy: GatewaySessionPolicy): GatewayCredentials { // L28752
    return this.issueCredentials(sessionId, policy, true);
  }
  issueCredentials(sessionId: string, policy: GatewaySessionPolicy, auxiliary: boolean): GatewayCredentials { // L28799
    const token = `vcs_${randomBytes(32).toString("hex")}`;
    this.sessions.set(token, { sessionId, auxiliary, policy, childJobs: new Map(), unscopedCalls: 0, activeRequests: new Set() });
    return { gatewayUrl: this.origin, gatewayKey: token };
  }
  upstreamHeaders(extra: Record<string, string> = {}): Record<string, string> { // L28811
    return { authorization: `Bearer ${this.gatewayKey}`, ...extra };
  }
  revokeCredential(gatewayKey: string): void { // L28873
    const entry = this.sessions.get(gatewayKey);
    if (!entry) return;
    for (const c of entry.activeRequests) c.abort(GATEWAY_CANCEL_REASON);
    entry.activeRequests.clear();
    this.sessions.delete(gatewayKey);
  }
  credentialsForTools(sessionId: string, tools: string[], maxCalls: number): GatewayCredentials { // L28880
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1e4) throw new Error("tool-limited gateway capability requires a bounded call count");
    return this.credentials(sessionId, { jobId: () => undefined, allowedUnscopedTools: new Set(tools), unscopedCallLimit: maxCalls, allowLlm: false });
  }
  async quoteProject(jobId: string, items: unknown, signal?: AbortSignal): Promise<any> { // L28891
    if (!isClientJobId(jobId)) throw new Error("project quote job id is invalid");
    const response = await fetch(`${this.gatewayUrl}/v1/quotes/project`, {
      method: "POST", headers: this.upstreamHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ job_id: jobId, items }), signal: AbortSignal.any([AbortSignal.timeout(1e4), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`gateway project quote failed (${response.status})`);
    const quote: any = await response.json();
    for (const field of ["planned_total_cents", "reserve_cents", "total_cents"]) {
      if (!Number.isSafeInteger(quote[field]) || Number(quote[field]) < 0) throw new Error("gateway project quote returned invalid cents");
    }
    return quote;
  }
  async setSessionSpendPolicy(jobId: string, policy: { kind: string; ceilingUsd?: number }): Promise<void> { // L28910
    if (!isClientJobId(jobId)) throw new Error("session spend policy job id is invalid");
    const body = policy.kind === "capped" ? { mode: "capped", ceiling_usd: Number(policy.ceilingUsd).toFixed(2) } : policy.kind === "unlimited_for_video" ? { mode: "unlimited" } : { mode: "per_operation" };
    const response = await fetch(`${this.gatewayUrl}/v1/spend-authorities/${encodeURIComponent(jobId)}`, { method: "PUT", headers: this.upstreamHeaders({ "content-type": "application/json" }), body: JSON.stringify(body), signal: AbortSignal.timeout(1e4) });
    if (!response.ok) throw new Error(`The gateway could not update this video's spending policy (HTTP ${response.status}).`);
  }
  async getJobBudget(jobId: string): Promise<any> { // L28933
    if (!isClientJobId(jobId)) throw new Error("gateway budget job id is invalid");
    const response = await fetch(`${this.gatewayUrl}/v1/spend-authorities/${encodeURIComponent(jobId)}`, { headers: this.upstreamHeaders(), signal: AbortSignal.timeout(5e3) });
    if (!response.ok) throw new Error(`The gateway budget read failed (HTTP ${response.status}).`);
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The gateway returned an invalid budget response.");
    return body;
  }
  async credentialsForBudgetedTools(sessionId: string, tools: Iterable<string>, maxCalls: number, jobId: string, ceilingUsd: number): Promise<GatewayCredentials> { // L28951
    if (!isClientJobId(jobId)) throw new Error("tool-limited gateway job id is invalid");
    if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) throw new Error("tool-limited gateway ceiling is invalid");
    const response = await fetch(`${this.gatewayUrl}/v1/budgets/${encodeURIComponent(jobId)}`, { method: "PUT", headers: this.upstreamHeaders({ "content-type": "application/json" }), body: JSON.stringify({ ceiling_usd: ceilingUsd }), signal: AbortSignal.timeout(1e4) });
    if (!response.ok) throw new Error(`gateway helper budget registration failed (${response.status})`);
    const credentials2 = this.credentialsForTools(sessionId, [...tools], maxCalls);
    const entry = this.sessions.get(credentials2.gatewayKey);
    if (!entry) throw new Error("tool-limited gateway capability was not created");
    entry.policy.fixedUnscopedJobId = jobId;
    return credentials2;
  }
  revoke(sessionId: string, keepRecovery = false): void { // L28972
    for (const [token, entry] of this.sessions) {
      if (entry.sessionId === sessionId && !(keepRecovery && entry.policy.recoveryOnly)) {
        for (const c of entry.activeRequests) c.abort(GATEWAY_CANCEL_REASON);
        entry.activeRequests.clear();
        this.sessions.delete(token);
      }
    }
  }
  abortSessionRequests(sessionId: string): void { // L28983
    for (const entry of this.sessions.values()) {
      if (entry.sessionId !== sessionId || entry.policy.recoveryOnly) continue;
      for (const c of entry.activeRequests) c.abort(GATEWAY_CANCEL_REASON);
      entry.activeRequests.clear();
    }
  }
  close(): void { // L28990
    for (const entry of this.sessions.values()) for (const c of entry.activeRequests) c.abort(GATEWAY_CANCEL_REASON);
    this.sessions.clear();
    this.server.close();
  }
  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> { // L28997 (auth prefix only)
    response.setHeader("x-videoclaw-not-forwarded", "1");
    const token = bearer(request.headers);
    const entry = token ? this.sessions.get(token) : undefined;
    if (!entry) return void this.reject(response, 401, "invalid session credential");
    if (entry.policy.allowedUnscopedTools && entry.policy.allowLlm === false) return this.forwardToolLimited(request, response, entry);
    request.resume();
    // PORT STUB: authorize()/forwarding (L29010-29654) for session agent credentials not ported. Nothing is sent upstream.
    this.reject(response, 501, "NOT PORTED: gateway forwarding (AgentGatewayProxy.authorize) is not implemented in the Windows port yet");
  }
  /** docs/29: the tool-limited capability subset of authorize() (L29730-29860). */
  private async forwardToolLimited(request: IncomingMessage, response: ServerResponse, entry: SessionEntry): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of request) { size += (c as Buffer).length; if (size > MAX_BODY_BYTES) return void this.reject(response, 413, "request body is too large"); chunks.push(c as Buffer); }
    let body: Buffer | undefined = Buffer.concat(chunks);
    const tools = new Set(entry.policy.allowedUnscopedTools as Iterable<string>);
    let remember = false;
    let m: RegExpExecArray | null;
    if ((method === "POST" && path === "/v1/uploads") || (method === "GET" && /^\/v1\/uploads\/[a-f0-9]{32}$/.test(path))) {
      // allowed (L29730)
    } else if (method === "POST" && (m = /^\/v1\/quotes\/([a-z][a-z0-9_.-]{0,63})$/.exec(path)) && m[1] !== "project") {
      if (!tools.has(m[1])) return void this.reject(response, 403, "this helper is not authorized for that production tool");
    } else if (method === "GET" && (m = /^\/v1\/jobs\/([A-Za-z0-9_.:-]{1,200})$/.exec(path))) {
      if (!entry.childJobs.has(m[1])) return void this.reject(response, 403, "gateway control route is unavailable to agents");
    } else if (method === "POST" && (m = /^\/v1\/([a-z][a-z0-9_.-]{0,63})$/.exec(path)) && tools.has(m[1])) {
      if (entry.policy.unscopedCallLimit === undefined || entry.unscopedCalls >= entry.policy.unscopedCallLimit) return void this.reject(response, 402, "tool-limited gateway capability is exhausted");
      entry.unscopedCalls += 1;
      if (entry.policy.fixedUnscopedJobId) {
        let payload: any;
        try { payload = JSON.parse(body.toString("utf8")); } catch { return void this.reject(response, 400, "production request must be JSON"); }
        payload.client_job = entry.policy.fixedUnscopedJobId;
        body = Buffer.from(JSON.stringify(payload));
      }
      remember = true;
    } else {
      return void this.reject(response, 403, "gateway control route is unavailable to agents");
    }
    const controller = new AbortController();
    entry.activeRequests.add(controller);
    try {
      const upstream = await fetch(`${this.gatewayUrl}${path}${url.search}`, {
        method, headers: this.upstreamHeaders(typeof request.headers["content-type"] === "string" ? { "content-type": request.headers["content-type"] } : {}),
        ...(method === "GET" ? {} : { body: new Uint8Array(body) }), signal: controller.signal,
      });
      const text = Buffer.from(await upstream.arrayBuffer());
      if (remember && upstream.ok) { try { const j = JSON.parse(text.toString("utf8")); if (typeof j?.job_id === "string") entry.childJobs.set(j.job_id, j.job_id); } catch {} }
      response.removeHeader("x-videoclaw-not-forwarded");
      response.statusCode = upstream.status;
      for (const h of ["content-type", "x-should-retry", "retry-after"]) { const v = upstream.headers.get(h); if (v) response.setHeader(h, v); }
      response.end(text);
    } catch (e) {
      response.removeHeader("x-videoclaw-not-forwarded");
      this.reject(response, 502, `gateway request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { entry.activeRequests.delete(controller); }
  }
  rejectHarnessReview(response: ServerResponse, verdict: { status: number; code: string; reason?: string; message: string }): void { // L30336
    response.statusCode = verdict.status;
    response.setHeader("x-should-retry", "false");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ detail: { code: verdict.code, ...(verdict.reason ? { reason: verdict.reason } : {}), message: verdict.message, retryable: false, not_submitted: true } }));
  }
  reject(response: ServerResponse, status: number, detail: string, code?: string, recovery?: { retry_after_s: number; [k: string]: unknown }): void { // L30352
    response.statusCode = status;
    if (recovery) response.setHeader("retry-after", String(recovery.retry_after_s));
    if (code && NON_RETRYABLE_REFUSAL_CODES.has(code)) response.setHeader("x-should-retry", "false");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      detail,
      ...(code ? { code } : {}),
      ...recovery,
      ...(code === "BILLING_RECONCILIATION_PENDING" ? { retryable: true, not_submitted: true } : {}),
      ...(code === "ACCOUNT_DEBT" || code === PROVIDER_CREDENTIAL_CODE ? { retryable: false, not_submitted: true } : {}),
    }));
  }
}
