// PORT-NEW: generic concurrency gate + retry/backoff policy for custom LLM providers (docs/15 §4).
// Generalised from the docs/14 MiniMax implementation; the MiniMax preset's policy reproduces the
// verified behaviour exactly (429/529 + body code 1002 retried, 401/403 + 1004/1008 never retried).
import { LlmProviderError, PROVIDER_CREDENTIAL_CODE } from "./errors";

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private limit: number) {
    if (!(limit >= 1)) throw new Error("ConcurrencyLimiter: max must be >= 1");
  }
  get max(): number { return this.limit; }
  get running(): number { return this.active; }
  get pending(): number { return this.waiters.length; }
  /** Resize in place (provider config hot-reload). Growing admits waiters immediately; shrinking
   *  lets in-flight calls finish and only admits new ones once below the new limit. */
  setMax(n: number): void {
    if (!(n >= 1)) throw new Error("ConcurrencyLimiter: max must be >= 1");
    this.limit = n;
    while (this.active < this.limit && this.waiters.length) { this.active++; this.waiters.shift()!(); }
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiters.push(r));
    else this.active++;
    try {
      return await fn();
    } finally {
      if (this.active > this.limit || !this.waiters.length) this.active--;
      else this.waiters.shift()!(); // hand the slot over directly (active unchanged)
    }
  }
}

const gates = new Map<string, ConcurrencyLimiter>();
/** One process-wide gate per provider name (keys are often shared with other pipelines, so the
 *  limit is account-level, not per-call-site). Callers pass the provider's CURRENT resolved limit;
 *  after a config hot-reload changes it the gate is resized in place (in-flight calls unaffected). */
export function providerGate(provider: string, maxConcurrency: number): ConcurrencyLimiter {
  let g = gates.get(provider);
  if (!g) gates.set(provider, (g = new ConcurrencyLimiter(maxConcurrency)));
  else if (maxConcurrency >= 1 && g.max !== maxConcurrency) g.setMax(maxConcurrency);
  return g;
}
export function resetProviderGatesForTests(): void { gates.clear(); }

/** Provider-level retry/error classification policy (comes from the provider config). */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryStatuses: readonly number[];
  credentialStatuses: readonly number[];
  /** Dotted path to a numeric error code in the JSON error body (e.g. "base_resp.status_code"). */
  bodyCodePath?: string;
  retryBodyCodes: readonly number[];
  credentialBodyCodes: readonly number[];
}
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60_000, retryStatuses: [429, 529], credentialStatuses: [401, 403], retryBodyCodes: [], credentialBodyCodes: [],
};

/** Per-call knobs (tests / callers); override the policy's numeric fields. */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: () => number; // [0,1); default Math.random; delay *= 1 + 0.25*jitter
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

export function bodyCode(bodyText: string, path: string | undefined): number | undefined {
  if (!path) return undefined;
  try {
    let v: unknown = JSON.parse(bodyText);
    for (const seg of path.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[seg] : undefined;
    return typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
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
  const base = o.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs;
  const raw = base * 2 ** attempt * (1 + 0.25 * (o.jitter ?? Math.random)());
  return Math.min(o.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs, Math.round(raw));
}

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal!.reason ?? new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Runs `attempt()` (one HTTP request) and retries retryable statuses / body codes with exponential
 *  backoff, honouring `retry-after` (capped at maxDelayMs). Credential statuses / body codes throw
 *  LlmProviderError(PROVIDER_CREDENTIAL_MISCONFIGURED) immediately. Other non-2xx responses are
 *  returned to the caller unchanged. Response bodies are inspected but never echoed. */
export async function withRetry(
  attempt: () => Promise<Response>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  o: RetryOptions = {},
  ctx: { provider?: string; keyEnv?: string } = {},
): Promise<Response> {
  const maxRetries = o.maxRetries ?? policy.maxRetries;
  const maxDelayMs = o.maxDelayMs ?? policy.maxDelayMs;
  const sleep = o.sleep ?? defaultSleep;
  const who = ctx.provider ? `Provider "${ctx.provider}"` : "The provider";
  for (let i = 0; ; i++) {
    const res = await attempt();
    if (res.ok) return res;
    const text = policy.bodyCodePath ? await res.clone().text().catch(() => "") : "";
    const code = bodyCode(text, policy.bodyCodePath);
    if (policy.credentialStatuses.includes(res.status) || (code !== undefined && policy.credentialBodyCodes.includes(code))) {
      throw new LlmProviderError(PROVIDER_CREDENTIAL_CODE,
        `${who} rejected the credential (http ${res.status}${code !== undefined ? `, code ${code}` : ""}). Check ${ctx.keyEnv ?? "the API key"} / account balance.`,
        { status: res.status, provider: ctx.provider });
    }
    const retryable = policy.retryStatuses.includes(res.status) || (code !== undefined && policy.retryBodyCodes.includes(code));
    if (!retryable) return res;
    if (i >= maxRetries) throw new LlmProviderError("RATE_LIMITED", `${who} still rate-limited after ${maxRetries} retries (http ${res.status})`, { status: res.status, retryable: true, provider: ctx.provider });
    const ra = retryAfterMs(res.headers.get("retry-after"));
    const delayMs = ra !== undefined ? Math.min(ra, maxDelayMs) : backoffDelayMs(i, { baseDelayMs: o.baseDelayMs ?? policy.baseDelayMs, maxDelayMs, jitter: o.jitter });
    o.onRetry?.({ attempt: i + 1, delayMs, status: res.status });
    await sleep(delayMs, o.signal);
  }
}
