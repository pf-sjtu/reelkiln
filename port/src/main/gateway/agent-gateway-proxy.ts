// AgentGatewayProxy — SHAPE port of main/index.js L28672-30374 (class) + helpers L28204-28520.
// The proxy is OS-neutral (an http server on 127.0.0.1:0 that swaps per-session `vcs_…`
// capability tokens for the account key), so nothing here needs Windows-specific code.
// Ported REAL: start/bind, credential lifecycle (credentials, auxiliaryCredentials,
// issueCredentials, revokeCredential, credentialsForTools, revoke, abortSessionRequests,
// close), upstreamHeaders, bearer(), reject(), rejectHarnessReview().
// STUBBED: handle() authenticates exactly like the original (L28997-29010: header
// x-videoclaw-not-forwarded, 401 "invalid session credential") and then refuses with 501
// before forwarding anything. authorize() (L29655-30327, spend/quote/permit logic),
// settlementPolicies(), operationContext(), quoteProject(), setSessionSpendPolicy(),
// getJobBudget(), credentialsForBudgetedTools(), harnessReviewCredentials() are NOT PORTED.
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

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
  allowedUnscopedTools?: string[];
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
    return this.credentials(sessionId, { jobId: () => undefined, allowedUnscopedTools: tools, unscopedCallLimit: maxCalls, allowLlm: false });
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
    request.resume();
    // PORT STUB: authorize()/forwarding (L29010-29654) not ported. Nothing is sent upstream.
    this.reject(response, 501, "NOT PORTED: gateway forwarding (AgentGatewayProxy.authorize) is not implemented in the Windows port yet");
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
