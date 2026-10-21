// AgentGatewayProxy — docs/31: the VERBATIM shipped class (main/index.js L28672-30374) and helpers
// (L28134-28671), generated into agent-gateway-proxy.generated.ts by tools/gen-verbatim.mjs. This module only
// re-exports it with the types the rest of the port uses. (Until docs/30 this file was a SHAPE port whose handle()
// refused session credentials with 501; the full handle()/authorize() — operation context, local spending
// admission, exact quotes and permits, durable operation identity — now runs as shipped.)
import {
  AgentGatewayProxy as GeneratedAgentGatewayProxy, GatewayHttpError, UpstreamGatewayHttpError, PROVIDER_CREDENTIAL_CODE, GATEWAY_CANCEL_REASON,
  NON_RETRYABLE_REFUSAL_CODES, SPEND_APPROVAL_PENDING_CODE, SPEND_AUTHORITY_REQUIRED_CODE, SPEND_APPROVAL_PENDING_MESSAGE, SPEND_POLICY_CONFLICT_MESSAGE,
  isAnthropicPassthroughPath, isUnknownCostQuote, UNKNOWN_COST_POLICY, ESTIMATED_SETTLEMENT_POLICY, EXACT_OPERATION_MEDIA_TYPE, MAX_BODY_BYTES, bearer,
  UNKNOWN_COST_APPROVAL_REQUIRED,
} from "./agent-gateway-proxy.generated";
import type { Server } from "node:http";

export {
  GatewayHttpError, UpstreamGatewayHttpError, PROVIDER_CREDENTIAL_CODE, GATEWAY_CANCEL_REASON, NON_RETRYABLE_REFUSAL_CODES, SPEND_APPROVAL_PENDING_CODE,
  SPEND_AUTHORITY_REQUIRED_CODE, SPEND_APPROVAL_PENDING_MESSAGE, SPEND_POLICY_CONFLICT_MESSAGE, isAnthropicPassthroughPath, isUnknownCostQuote,
  UNKNOWN_COST_POLICY, ESTIMATED_SETTLEMENT_POLICY, EXACT_OPERATION_MEDIA_TYPE, MAX_BODY_BYTES, bearer, UNKNOWN_COST_APPROVAL_REQUIRED,
};

/** The policy fields the shipped authorize()/handle() read (agentGatewayPolicy L39649, credentialsForTools L28880,
 *  harnessReviewCredentials L28765, the Library lease L45713, the sheet build L19216). */
export interface GatewaySessionPolicy {
  jobId: () => string | undefined;
  projectId?: () => string | undefined;
  allowLlm?: boolean;
  requireOperationIdentity?: boolean;
  allowedUnscopedTools?: Set<string>;
  allowedScopedTools?: Set<string>;
  fixedUnscopedJobId?: string;
  fixedScopedJobId?: string;
  unscopedCallLimit?: number;
  recoveryOnly?: boolean;
  rememberOperation?: (operation: { id: string; path: string; sha256: string; owner: Record<string, string> }) => boolean;
  forgetRefusedOperation?: (operation: { id: string; path: string; sha256: string; owner: Record<string, string> }) => void;
  prepareSpend?: (jobId: string, signal: AbortSignal) => Promise<void>;
  authorizeSpend?: (request: { jobId: string; method: "POST"; path: string; body: Buffer; quote: any }, signal: AbortSignal) => Promise<any>;
  finishSpend?: (reservationId?: string) => void;
  noteOperationStatus?: (operationId: string, status: string) => void;
  noteMediaPull?: (acquisition: unknown) => void;
  diagnostic?: { appVersion?: string; engineVersion?: string };
  [k: string]: unknown;
}
export interface GatewayCredentials { gatewayUrl: string; gatewayKey: string }

export interface AgentGatewayProxy {
  readonly server: Server; readonly origin: string; readonly gatewayUrl: string;
  sessions: Map<string, any>;
  credentials(sessionId: string, policy: GatewaySessionPolicy): GatewayCredentials;
  auxiliaryCredentials(sessionId: string, policy: GatewaySessionPolicy): GatewayCredentials;
  issueCredentials(sessionId: string, policy: GatewaySessionPolicy, auxiliary: boolean): GatewayCredentials;
  harnessReviewCredentials(sessionId: string, video: { jobId: string; projectId?: string; stillCurrent?: () => boolean }, ttlMs?: number): GatewayCredentials;
  upstreamHeaders(extra?: Record<string, string>): Record<string, string>;
  revokeCredential(gatewayKey: string): void;
  credentialsForTools(sessionId: string, tools: Iterable<string>, maxCalls: number): GatewayCredentials;
  quoteProject(jobId: string, items: unknown, signal?: AbortSignal): Promise<any>;
  setSessionSpendPolicy(jobId: string, policy: { kind: string; ceilingUsd?: number }): Promise<void>;
  getJobBudget(jobId: string): Promise<any>;
  credentialsForBudgetedTools(sessionId: string, tools: Iterable<string>, maxCalls: number, jobId: string, ceilingUsd: number): Promise<GatewayCredentials>;
  revoke(sessionId: string, keepRecovery?: boolean): void;
  abortSessionRequests(sessionId: string): void;
  close(): void;
}
export const AgentGatewayProxy: { start(gatewayUrl: string, gatewayKey: string): Promise<AgentGatewayProxy>; new (server: Server, origin: string, gatewayUrl: string, gatewayKey: string): AgentGatewayProxy } = GeneratedAgentGatewayProxy as any;
