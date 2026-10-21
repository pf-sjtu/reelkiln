// PORT-NEW: MiniMax (MiniMax-M3.1-Flash) as an Anthropic-compatible LLM route — docs/14 方案 (a).
// Nothing here exists in the original bundle. The route reuses the Claude Agent SDK path: the
// child runtime gets ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN pointing at MiniMax (same shape as
// the gateway branch of createLocalRuntime, main/index.js L23306), and every model alias the
// Claude runtime may request is pinned to MINIMAX_MODEL.
//
// SECURITY: the key is read from process.env at call time only. It is never logged, never part of
// an error message, and `describeMiniMaxConfig()` is the only representation meant for output.
//
// The key is shared with another pipeline (account-level RPM/TPM), so all main-process calls go
// through one process-wide gate (default concurrency 1) with exponential backoff on 429/529.
import { PROVIDER_CREDENTIAL_CODE } from "../gateway/agent-gateway-proxy";

/** Verified 2026-10-21 (docs/14 §8): 200 with both `x-api-key` and `Authorization: Bearer`. */
export const MINIMAX_DEFAULT_BASE_URL = "https://api.minimaxi.com/anthropic";
export const MINIMAX_DEFAULT_MODEL = "MiniMax-M3.1-Flash";
export const MINIMAX_MAX_CONCURRENCY_CAP = 2; // docs/14 §4: shared key, never more than 2
export const MINIMAX_ROUTE = "minimax" as const;

export interface MiniMaxConfig {
  key: string;
  baseUrl: string; // no trailing slash, e.g. https://api.minimaxi.com/anthropic
  model: string;
  maxConcurrency: number;
}

/** Reads MINIMAX_* from `env` (call BEFORE sanitizedAgentEnv, which strips *KEY* names).
 *  Returns null when MINIMAX_API_KEY is missing/blank. */
export function minimaxConfig(env: NodeJS.ProcessEnv = process.env): MiniMaxConfig | null {
  const key = env.MINIMAX_API_KEY?.trim();
  if (!key) return null;
  const n = Math.floor(Number(env.MINIMAX_MAX_CONCURRENCY));
  return {
    key,
    baseUrl: (env.MINIMAX_BASE_URL?.trim() || MINIMAX_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.MINIMAX_MODEL?.trim() || MINIMAX_DEFAULT_MODEL,
    maxConcurrency: Number.isFinite(n) && n >= 1 ? Math.min(MINIMAX_MAX_CONCURRENCY_CAP, n) : 1,
  };
}

/** Safe-to-print view (key → configured:boolean only). */
export function describeMiniMaxConfig(mm: MiniMaxConfig | null): { configured: boolean; baseUrl?: string; model?: string; maxConcurrency?: number } {
  return mm ? { configured: true, baseUrl: mm.baseUrl, model: mm.model, maxConcurrency: mm.maxConcurrency } : { configured: false };
}

/** Env slice for the Claude Agent SDK child when llmRoute === "minimax" (sibling of the gateway
 *  branch at L23306). The isolated CLAUDE_CONFIG_DIR keeps a local claude.ai login from shadowing
 *  the endpoint (gateway gotcha #4). ANTHROPIC_CUSTOM_HEADERS is deliberately NOT set: the
 *  gateway job headers must never be sent to a third party. */
export function minimaxClaudeRuntimeEnv(mm: MiniMaxConfig, profileDir: string): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: mm.baseUrl,
    ANTHROPIC_AUTH_TOKEN: mm.key,
    ANTHROPIC_MODEL: mm.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: mm.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: mm.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: mm.model,
    ANTHROPIC_SMALL_FAST_MODEL: mm.model,
    CLAUDE_CODE_SUBAGENT_MODEL: mm.model,
    CLAUDE_CONFIG_DIR: profileDir,
  };
}

// ---------------------------------------------------------------------------------------------
// Concurrency gate (process-wide semaphore)

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(readonly max: number) {
    if (!(max >= 1)) throw new Error("ConcurrencyLimiter: max must be >= 1");
  }
  get running(): number { return this.active; }
  get pending(): number { return this.waiters.length; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next(); // hand the slot over directly (active unchanged)
      else this.active--;
    }
  }
}

let sharedGate: ConcurrencyLimiter | undefined;
/** The single gate every MiniMax call in this process goes through. First caller fixes the size. */
export function minimaxGate(mm: Pick<MiniMaxConfig, "maxConcurrency">): ConcurrencyLimiter {
  return (sharedGate ??= new ConcurrencyLimiter(mm.maxConcurrency));
}
/** Test hook. */
export function resetMiniMaxGateForTests(): void { sharedGate = undefined; }

// ---------------------------------------------------------------------------------------------
// Retry / error classification (docs/14 §2.4, §4)

export const MINIMAX_RETRY_STATUSES = new Set([429, 529]);
export const MINIMAX_RATE_LIMIT_CODE = 1002;
export const MINIMAX_CREDENTIAL_CODES = new Set([1004, 1008]); // auth failure, insufficient balance

export interface RetryOptions {
  maxRetries?: number; // default 5 → up to 6 attempts
  baseDelayMs?: number; // default 2000 → 2s,4s,8s,16s,32s
  maxDelayMs?: number; // default 60000
  jitter?: () => number; // [0,1); default Math.random; delay *= 1 + 0.25*jitter
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

export class MiniMaxError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryable = false) {
    super(message);
    this.name = "MiniMaxError";
  }
}

/** base_resp.status_code from a MiniMax error body, if any (body text is never echoed). */
export function minimaxStatusCode(bodyText: string): number | undefined {
  try {
    const v = JSON.parse(bodyText)?.base_resp?.status_code;
    return typeof v === "number" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function retryAfterMs(h: string | null | undefined, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}

export function backoffDelayMs(attempt: number, o: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitter"> = {}): number {
  const base = o.baseDelayMs ?? 2000;
  const raw = base * 2 ** attempt * (1 + 0.25 * (o.jitter ?? Math.random)());
  return Math.min(o.maxDelayMs ?? 60_000, Math.round(raw));
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal!.reason ?? new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Runs `attempt()` (one HTTP request) and retries on 429/529 or base_resp 1002 with exponential
 *  backoff, honouring `retry-after` (capped at maxDelayMs). Credential/balance errors
 *  (401/403, 1004, 1008) throw MiniMaxError(code=PROVIDER_CREDENTIAL_MISCONFIGURED) immediately.
 *  Other non-2xx responses are returned to the caller unchanged. */
export async function withMiniMaxRetry(attempt: () => Promise<Response>, o: RetryOptions = {}): Promise<Response> {
  const maxRetries = o.maxRetries ?? 5;
  const sleep = o.sleep ?? defaultSleep;
  for (let i = 0; ; i++) {
    const res = await attempt();
    if (res.ok) return res;
    const text = await res.clone().text().catch(() => "");
    const code = minimaxStatusCode(text);
    if (res.status === 401 || res.status === 403 || (code !== undefined && MINIMAX_CREDENTIAL_CODES.has(code))) {
      throw new MiniMaxError(
        `MiniMax rejected the provider credential (http ${res.status}${code !== undefined ? `, code ${code}` : ""}). Check MINIMAX_API_KEY / account balance.`,
        res.status, PROVIDER_CREDENTIAL_CODE, false);
    }
    const retryable = MINIMAX_RETRY_STATUSES.has(res.status) || code === MINIMAX_RATE_LIMIT_CODE;
    if (!retryable) return res;
    if (i >= maxRetries) throw new MiniMaxError(`MiniMax still rate-limited after ${maxRetries} retries (http ${res.status})`, res.status, "RATE_LIMITED", true);
    const ra = retryAfterMs(res.headers.get("retry-after"));
    const delayMs = ra !== undefined ? Math.min(ra, o.maxDelayMs ?? 60_000) : backoffDelayMs(i, o);
    o.onRetry?.({ attempt: i + 1, delayMs, status: res.status });
    await sleep(delayMs, o.signal);
  }
}
