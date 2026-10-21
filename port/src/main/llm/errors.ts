// PORT-NEW: typed errors for the generic LLM provider framework (docs/15).
// Messages may name env vars / provider names / HTTP statuses, but NEVER a key or a response body.
import { PROVIDER_CREDENTIAL_CODE } from "../gateway/agent-gateway-proxy";

export type LlmErrorCode =
  | "CONFIG_INVALID" // providers file unreadable / fails schema validation
  | "UNKNOWN_PROVIDER"
  | "KEY_MISSING" // apiKeyEnv not set in the (unsanitized) environment
  | "UNSUPPORTED_PROTOCOL" // e.g. an openai-* provider selected for the Claude Agent SDK runtime
  | "UNSUPPORTED_CONTENT" // a content block / tool the target protocol cannot represent (never silently dropped)
  | typeof PROVIDER_CREDENTIAL_CODE // 401/403 or provider-specific credential/balance body codes; never retried
  | "RATE_LIMITED" // retries exhausted
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_RESPONSE";

export class LlmProviderError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly provider?: string;
  constructor(code: LlmErrorCode, message: string, o: { status?: number; retryable?: boolean; provider?: string; cause?: unknown } = {}) {
    super(message, o.cause !== undefined ? { cause: o.cause } : undefined);
    this.name = "LlmProviderError";
    this.code = code;
    this.status = o.status ?? 0;
    this.retryable = o.retryable ?? false;
    this.provider = o.provider;
  }
  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, status: this.status, retryable: this.retryable, provider: this.provider, message: this.message };
  }
}

export { PROVIDER_CREDENTIAL_CODE };
