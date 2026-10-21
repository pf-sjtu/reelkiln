// LLM route plumbing for the Claude Agent SDK path.
//  - ORIGINAL (ported line-for-line, differential-tested): DEFAULT_LLM_ROUTE/resolvedLlmRoute
//    (main/index.js L319-322), settings llmRoute validation (L5397-5399), AGENT_STARTUP_ENV_DENYLIST
//    + sanitizedAgentEnv (L16004-16033), the sdkEnv preparation of createLocalRuntime
//    (L23216-23230), the gateway env branch (L23306-23313), ANTHROPIC_VERSION/resolveHelperCreds/
//    anthropicMessages (L22342-22385).
//  - PORT-NEW (docs/15): besides "claude-code" and "gateway", llmRoute may name ANY provider
//    registered in the generic provider registry (built-in preset "minimax" + user providers file).
//    Every place the original branches on "gateway" gets a sibling "provider" branch; behaviour for
//    the two original routes is unchanged. Provider keys live in env vars that sanitizedAgentEnv
//    strips (/KEY|TOKEN|…/), so they are read from the *unsanitized* env and passed to the child
//    explicitly (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_CUSTOM_HEADERS).
import type { BuiltinLlmRoute, LlmRouteId } from "../../shared/llm-types";
import { LlmProviderError } from "./errors";
import { getLogger, redactText } from "./logger";
import { ANTHROPIC_VERSION, buildRequestBody, claudeAgentEnv, endpointUrl, extractText, requestHeaders } from "./protocols";
import type { LlmProtocol } from "./provider-config";
import { getProviderRegistry, type ProviderRegistry, type ResolvedProvider } from "./provider-registry";
import { providerGate, withRetry, type RetryOptions, type RetryPolicy } from "./retry";

export { ANTHROPIC_VERSION };
export type LlmRoute = LlmRouteId;
export const DEFAULT_LLM_ROUTE: BuiltinLlmRoute = "claude-code"; // L319
export const BUILTIN_LLM_ROUTES: readonly BuiltinLlmRoute[] = ["claude-code", "gateway"];
/** Every route currently accepted: the two original ones + every registered provider name. */
export function llmRoutes(registry: ProviderRegistry = getProviderRegistry()): LlmRoute[] {
  return [...BUILTIN_LLM_ROUTES, ...registry.names()];
}
export function isProviderRoute(route: unknown, registry: ProviderRegistry = getProviderRegistry()): route is string {
  return route !== "claude-code" && route !== "gateway" && registry.has(route);
}

/** L320. PORT-NEW: a registered provider name is accepted. */
export function resolvedLlmRoute(settings: { llmRoute?: unknown }, registry: ProviderRegistry = getProviderRegistry()): LlmRoute {
  if (settings.llmRoute === "gateway") return "gateway";
  if (isProviderRoute(settings.llmRoute, registry)) return settings.llmRoute;
  return DEFAULT_LLM_ROUTE;
}

/** Settings normalisation (L5397-5399): unknown routes are deleted. PORT-NEW: keeps registered providers. */
export function normalizeLlmRouteSetting<T extends { llmRoute?: unknown }>(value: T, registry: ProviderRegistry = getProviderRegistry()): T {
  if (value.llmRoute !== "claude-code" && value.llmRoute !== "gateway" && !isProviderRoute(value.llmRoute, registry)) delete value.llmRoute;
  return value;
}

export const AGENT_STARTUP_ENV_DENYLIST = new Set([ // L16004
  "BASH_ENV", "BASHOPTS", "CDPATH", "ENV", "GLOBIGNORE", "PYTHONHOME", "PYTHONINSPECT", "PYTHONPATH",
  "PYTHONSTARTUP", "PYTHONUSERBASE", "PYTHONEXECUTABLE", "SHELLOPTS", "UV_ENV_FILE", "UV_PROJECT",
  "UV_PROJECT_ENVIRONMENT", "UV_PYTHON", "UV_PYTHON_PREFERENCE", "UV_WORKING_DIR", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__",
]);

/** L16026 — strips every variable whose name contains KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL or AUTH. */
export function sanitizedAgentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(name)) continue;
    if (name === "VIDEOCLAW_BOUND_JOB") continue;
    if (AGENT_STARTUP_ENV_DENYLIST.has(name) || name.startsWith("BASH_FUNC_") || name.startsWith("DYLD_") || name.startsWith("LD_")) continue;
    safe[name] = value;
  }
  return safe;
}

/** createLocalRuntime L23216-23230: the base env handed to the Claude Agent SDK. */
export function claudeSdkBaseEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const sdkEnv = sanitizedAgentEnv(source);
  delete sdkEnv.ANTHROPIC_CUSTOM_HEADERS;
  delete sdkEnv.ANTHROPIC_BASE_URL;
  delete sdkEnv.CLAUDE_CODE_EFFORT_LEVEL;
  for (const name of ["CLAUDE_CODE_USE_ANTHROPIC_AWS", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_GATEWAY", "CLAUDE_CODE_USE_MANTLE", "CLAUDE_CODE_USE_VERTEX"]) {
    delete sdkEnv[name];
  }
  sdkEnv.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = "1";
  return sdkEnv;
}

export interface RouteGateway {
  llmRoute: LlmRoute;
  gatewayUrl?: string;
  gatewayKey?: string;
  /** Pre-resolved provider for a provider route; defaults to registry.resolve(llmRoute, env). */
  provider?: ResolvedProvider | null;
  registry?: ProviderRegistry;
  /** UNSANITIZED env the provider key is read from (default process.env). */
  env?: NodeJS.ProcessEnv;
}

function routeProvider(route: string, g: { provider?: ResolvedProvider | null; registry?: ProviderRegistry; env?: NodeJS.ProcessEnv }): ResolvedProvider | null {
  return g.provider !== undefined ? g.provider : (g.registry ?? getProviderRegistry()).resolve(route, g.env ?? process.env);
}

/** The route-specific slice of the createLocalRuntime env block (L23306-23313) + PORT-NEW provider
 *  sibling. Spread AFTER claudeSdkBaseEnv()/engineEnv, exactly where the original spreads it.
 *  Throws KEY_MISSING / UNSUPPORTED_PROTOCOL for an unusable provider route. */
export function claudeRouteEnv(gateway: RouteGateway, profileDir: string, customHeaders?: string): Record<string, string> {
  if (gateway.llmRoute === "gateway" && gateway.gatewayKey) {
    return {
      ANTHROPIC_BASE_URL: `${gateway.gatewayUrl}/anthropic`,
      ANTHROPIC_AUTH_TOKEN: gateway.gatewayKey,
      ...(customHeaders ? { ANTHROPIC_CUSTOM_HEADERS: customHeaders } : {}),
      CLAUDE_CONFIG_DIR: profileDir,
    };
  }
  if (gateway.llmRoute !== "gateway" && gateway.llmRoute !== "claude-code") {
    const registry = gateway.registry ?? getProviderRegistry();
    if (gateway.provider === undefined && !registry.has(gateway.llmRoute)) return {}; // unregistered → behaves like claude-code (resolvedLlmRoute)
    const p = routeProvider(gateway.llmRoute, { ...gateway, registry });
    if (!p) {
      const keyEnv = registry.get(gateway.llmRoute)?.apiKeyEnv ?? "its API key env var";
      throw new LlmProviderError("KEY_MISSING", `The "${gateway.llmRoute}" provider is selected but ${keyEnv} is not set.`, { provider: gateway.llmRoute });
    }
    return claudeAgentEnv(p, profileDir); // never forwards gateway customHeaders
  }
  return {};
}

/** sessionModel (L40865) default for a route when the video has no override. PORT-NEW: providers. */
export function defaultSessionModel(route: LlmRoute, provider?: ResolvedProvider | null, registry: ProviderRegistry = getProviderRegistry()): string | undefined {
  if (route === "gateway") return "sonnet";
  if (route === "claude-code") return undefined;
  if (provider !== undefined) return provider?.model;
  return registry.has(route) ? (registry.resolve(route)?.model ?? registry.get(route)!.model) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Main-process helper calls (proposeSessionTitle, Conductor judge, …)

export interface HelperCreds {
  url: string;
  headers: Record<string, string>;
  /** PORT-NEW: provider routes — overrides body.model (callers hard-code Claude model ids). */
  model?: string;
  provider?: string; // "gateway" | provider name
  protocol?: LlmProtocol; // undefined ≙ anthropic-messages (gateway)
  maxConcurrency?: number;
  retry?: RetryPolicy;
  defaultParams?: Record<string, unknown>;
  keyEnv?: string;
  timeoutMs?: number;
  chatMaxTokensField?: "max_tokens" | "max_completion_tokens";
}
export interface HelperCfg { llmRoute?: unknown; gatewayUrl: string; gatewayKey?: string }

export function helperCredsForProvider(p: ResolvedProvider): HelperCreds {
  return {
    url: endpointUrl(p.protocol, p.baseUrl), headers: requestHeaders(p), model: p.model, provider: p.name, protocol: p.protocol,
    maxConcurrency: p.maxConcurrency, retry: p.retry, defaultParams: p.defaultParams, keyEnv: p.keyEnv, timeoutMs: p.timeoutMs,
    ...(p.chatMaxTokensField ? { chatMaxTokensField: p.chatMaxTokensField } : {}),
  };
}

/** L22343. PORT-NEW provider branch (any registered provider, any protocol). */
export function resolveHelperCreds(cfg: HelperCfg, env: NodeJS.ProcessEnv = process.env, registry: ProviderRegistry = getProviderRegistry()): HelperCreds | null {
  const route = resolvedLlmRoute(cfg, registry);
  if (route === "gateway" && cfg.gatewayKey) {
    return {
      url: `${cfg.gatewayUrl.replace(/\/$/, "")}/anthropic/v1/messages`,
      headers: { authorization: `Bearer ${cfg.gatewayKey}`, "content-type": "application/json", "accept-encoding": "identity", ...ANTHROPIC_VERSION },
      provider: "gateway",
    };
  }
  if (route !== "gateway" && route !== "claude-code") {
    const p = registry.resolve(route, env);
    return p ? helperCredsForProvider(p) : null;
  }
  return null;
}

export type AnthropicResult = { ok: true; text: string } | { ok: false; status?: number; reason: string; code?: string };
export interface AnthropicOpts {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  retry?: RetryOptions;
  /** PORT-NEW (provider routes): overall budget across attempts + backoff sleeps → TIMEOUT. */
  deadlineMs?: number;
  /** PORT-NEW (provider routes): caller cancellation (e.g. session closed). */
  signal?: AbortSignal;
}
/** Responses larger than this are refused (BAD_RESPONSE) for provider routes. */
export const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;

function netCause(e: unknown): string {
  const c = (e as { cause?: { code?: string; message?: string; errors?: Array<{ code?: string }> } })?.cause;
  return c?.code ?? c?.errors?.find((x) => x.code)?.code ?? (typeof c?.message === "string" ? c.message.slice(0, 200) : "");
}
async function readCapped(res: Response, max: number): Promise<ArrayBuffer> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) { await res.body?.cancel().catch(() => {}); throw new LlmProviderError("BAD_RESPONSE", `response too large (${len} bytes)`); }
  if (!res.body) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new LlmProviderError("BAD_RESPONSE", `response too large (> ${max} bytes)`); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

/** L22362. Unchanged for gateway. PORT-NEW for provider creds: the Anthropic-shaped body is
 *  translated to the provider's protocol (body.model := creds.model, defaultParams merged under),
 *  the call runs inside the provider's process-wide gate, and retryable statuses/body codes are
 *  retried with backoff per the provider's policy (timeoutMs applies per attempt; optional
 *  deadlineMs/signal bound the whole call). Provider failures are typed (`code`), responses are
 *  size-capped, unparseable bodies are BAD_RESPONSE, and every reason string is secret-scrubbed. */
export async function anthropicMessages(creds: HelperCreds, body: Record<string, unknown>, opts: AnthropicOpts): Promise<AnthropicResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const protocol: LlmProtocol = creds.protocol ?? "anthropic-messages";
  const isProvider = !!creds.provider && creds.provider !== "gateway";
  const log = getLogger().child({ provider: creds.provider });
  let payload: Record<string, unknown>;
  try {
    payload = isProvider
      ? buildRequestBody(protocol, body, { model: creds.model, defaultParams: creds.defaultParams, provider: creds.provider, maxTokensField: creds.chatMaxTokensField, onDropped: (fields) => log.debug("llm.request.dropped_fields", { fields }) })
      : creds.model ? { ...body, model: creds.model } : body;
  } catch (err) {
    if (err instanceof LlmProviderError) return { ok: false, reason: redactText(err.message), code: err.code };
    throw err;
  }
  // overall cancellation (provider routes only; the gateway path keeps the original surface)
  const overall = new AbortController();
  const deadline = isProvider && opts.deadlineMs ? setTimeout(() => overall.abort(new LlmProviderError("TIMEOUT", `request exceeded its ${opts.deadlineMs}ms deadline`, { provider: creds.provider })), opts.deadlineMs) : undefined;
  const onCallerAbort = () => overall.abort(new LlmProviderError("TIMEOUT", "request cancelled by caller", { provider: creds.provider }));
  if (isProvider && opts.signal) { if (opts.signal.aborted) onCallerAbort(); else opts.signal.addEventListener("abort", onCallerAbort, { once: true }); }
  const once = async (): Promise<Response> => {
    if (overall.signal.aborted) throw overall.signal.reason;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    const relay = () => controller.abort();
    overall.signal.addEventListener("abort", relay, { once: true });
    try {
      const res = await doFetch(creds.url, { method: "POST", signal: controller.signal, headers: creds.headers, body: JSON.stringify(payload) });
      // read the body inside the timeout window so retry/parse see a complete Response
      const buf = isProvider ? await readCapped(res, MAX_PROVIDER_RESPONSE_BYTES) : await res.arrayBuffer();
      return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      if (!isProvider) throw e; // gateway: original error surface unchanged
      if (e instanceof LlmProviderError) throw e;
      if (overall.signal.aborted) throw overall.signal.reason;
      if (controller.signal.aborted) throw new LlmProviderError("TIMEOUT", `request timed out after ${opts.timeoutMs}ms`, { retryable: true, provider: creds.provider, cause: e });
      const cause = netCause(e);
      throw new LlmProviderError("NETWORK", `network error: ${e instanceof Error ? e.message : String(e)}${cause ? ` (${cause})` : ""}`, { retryable: true, provider: creds.provider, cause: e });
    } finally {
      clearTimeout(timer);
      overall.signal.removeEventListener("abort", relay);
    }
  };
  const t0 = Date.now();
  try {
    const res = isProvider
      ? await providerGate(creds.provider!, creds.maxConcurrency ?? 1).run(() => withRetry(once, creds.retry, {
        ...opts.retry,
        signal: overall.signal,
        onRetry: (i) => { log.warn("llm.retry", i); opts.retry?.onRetry?.(i); },
      }, { provider: creds.provider, keyEnv: creds.keyEnv }))
      : await once();
    if (!res.ok) {
      if (isProvider) log.warn("llm.request_failed", { status: res.status, ms: Date.now() - t0 });
      return { ok: false, status: res.status, reason: `http ${res.status}` };
    }
    let data: unknown;
    if (isProvider) {
      try { data = JSON.parse(await res.text()); } catch { throw new LlmProviderError("BAD_RESPONSE", `response is not valid JSON (http ${res.status})`, { status: res.status, provider: creds.provider }); }
    } else data = await res.json();
    const text = extractText(protocol, data, creds.provider);
    if (isProvider) log.debug("llm.request_ok", { ms: Date.now() - t0, protocol });
    return { ok: true, text };
  } catch (err) {
    const e = err instanceof LlmProviderError ? err : overall.signal.aborted && overall.signal.reason instanceof LlmProviderError ? overall.signal.reason : err;
    if (e instanceof LlmProviderError) {
      log.warn("llm.request_failed", { code: e.code, status: e.status, ms: Date.now() - t0 });
      return { ok: false, ...(e.status ? { status: e.status } : {}), reason: redactText(e.message), code: e.code };
    }
    return { ok: false, reason: isProvider ? redactText(e instanceof Error ? e.message : String(e)) : e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(deadline);
    opts.signal?.removeEventListener("abort", onCallerAbort);
  }
}
/** Protocol-neutral alias of anthropicMessages for new callers. */
export const providerComplete = anthropicMessages;
