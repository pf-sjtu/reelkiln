// LLM route plumbing for the Claude Agent SDK path.
//  - ORIGINAL (ported line-for-line, differential-tested): DEFAULT_LLM_ROUTE/resolvedLlmRoute
//    (main/index.js L319-322), settings llmRoute validation (L5397-5399), AGENT_STARTUP_ENV_DENYLIST
//    + sanitizedAgentEnv (L16004-16033), the sdkEnv preparation of createLocalRuntime
//    (L23216-23230), the gateway env branch (L23306-23313), ANTHROPIC_VERSION/resolveHelperCreds/
//    anthropicMessages (L22342-22385).
//  - PORT-NEW (docs/14 方案 a): a third route "minimax". Every place the original branches on
//    "gateway" gets a sibling "minimax" branch; non-minimax behaviour is unchanged.
//    The MiniMax key lives in MINIMAX_API_KEY, which sanitizedAgentEnv strips (name matches /KEY/),
//    so it is read from the *unsanitized* env here and passed to the child explicitly as
//    ANTHROPIC_AUTH_TOKEN.
import { minimaxClaudeRuntimeEnv, minimaxConfig, minimaxGate, withMiniMaxRetry, MiniMaxError, MINIMAX_ROUTE, type MiniMaxConfig, type RetryOptions } from "./minimax";

export type LlmRoute = "claude-code" | "gateway" | typeof MINIMAX_ROUTE;
export const DEFAULT_LLM_ROUTE: LlmRoute = "claude-code"; // L319
export const LLM_ROUTES: readonly LlmRoute[] = ["claude-code", "gateway", MINIMAX_ROUTE];

/** L320. PORT-NEW: "minimax" is accepted. */
export function resolvedLlmRoute(settings: { llmRoute?: unknown }): LlmRoute {
  if (settings.llmRoute === "gateway") return "gateway";
  if (settings.llmRoute === MINIMAX_ROUTE) return MINIMAX_ROUTE;
  return DEFAULT_LLM_ROUTE;
}

/** Settings normalisation (L5397-5399): unknown routes are deleted. PORT-NEW: keeps "minimax". */
export function normalizeLlmRouteSetting<T extends { llmRoute?: unknown }>(value: T): T {
  if (!LLM_ROUTES.includes(value.llmRoute as LlmRoute)) delete value.llmRoute;
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
  /** Pre-resolved MiniMax config; defaults to minimaxConfig(process.env) for the minimax route. */
  minimax?: MiniMaxConfig | null;
}

/** The route-specific slice of the createLocalRuntime env block (L23306-23313) + PORT-NEW minimax
 *  sibling. Spread AFTER claudeSdkBaseEnv()/engineEnv, exactly where the original spreads it. */
export function claudeRouteEnv(gateway: RouteGateway, profileDir: string, customHeaders?: string): Record<string, string> {
  if (gateway.llmRoute === "gateway" && gateway.gatewayKey) {
    return {
      ANTHROPIC_BASE_URL: `${gateway.gatewayUrl}/anthropic`,
      ANTHROPIC_AUTH_TOKEN: gateway.gatewayKey,
      ...(customHeaders ? { ANTHROPIC_CUSTOM_HEADERS: customHeaders } : {}),
      CLAUDE_CONFIG_DIR: profileDir,
    };
  }
  if (gateway.llmRoute === MINIMAX_ROUTE) {
    const mm = gateway.minimax === undefined ? minimaxConfig() : gateway.minimax;
    if (!mm) throw new MiniMaxError("The MiniMax route is selected but MINIMAX_API_KEY is not set.", 0, "MINIMAX_KEY_MISSING");
    return minimaxClaudeRuntimeEnv(mm, profileDir); // never forwards gateway customHeaders
  }
  return {};
}

/** sessionModel (L40865) default for a route when the video has no override. PORT-NEW: minimax. */
export function defaultSessionModel(route: LlmRoute, mm?: MiniMaxConfig | null): string | undefined {
  if (route === "gateway") return "sonnet";
  if (route === MINIMAX_ROUTE) return (mm === undefined ? minimaxConfig() : mm)?.model;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Main-process helper calls (proposeSessionTitle, Conductor judge, …)

export const ANTHROPIC_VERSION = { "anthropic-version": "2023-06-01" } as const; // L22342
export interface HelperCreds {
  url: string;
  headers: Record<string, string>;
  /** PORT-NEW: set for minimax — overrides body.model (callers hard-code Claude model ids). */
  model?: string;
  provider?: "gateway" | typeof MINIMAX_ROUTE;
  maxConcurrency?: number;
}
export interface HelperCfg { llmRoute?: unknown; gatewayUrl: string; gatewayKey?: string }

/** L22343. PORT-NEW minimax branch (x-api-key, verified 2026-10-21). */
export function resolveHelperCreds(cfg: HelperCfg, env: NodeJS.ProcessEnv = process.env): HelperCreds | null {
  const route = resolvedLlmRoute(cfg);
  if (route === "gateway" && cfg.gatewayKey) {
    return {
      url: `${cfg.gatewayUrl.replace(/\/$/, "")}/anthropic/v1/messages`,
      headers: { authorization: `Bearer ${cfg.gatewayKey}`, "content-type": "application/json", "accept-encoding": "identity", ...ANTHROPIC_VERSION },
      provider: "gateway",
    };
  }
  if (route === MINIMAX_ROUTE) {
    const mm = minimaxConfig(env);
    if (!mm) return null;
    return {
      url: `${mm.baseUrl}/v1/messages`,
      headers: { "x-api-key": mm.key, "content-type": "application/json", ...ANTHROPIC_VERSION },
      model: mm.model,
      provider: MINIMAX_ROUTE,
      maxConcurrency: mm.maxConcurrency,
    };
  }
  return null;
}

export type AnthropicResult = { ok: true; text: string } | { ok: false; status?: number; reason: string; code?: string };
export interface AnthropicOpts { timeoutMs: number; fetchImpl?: typeof fetch; retry?: RetryOptions }

/** L22362. Unchanged for gateway. PORT-NEW for minimax creds: body.model := creds.model, the call
 *  runs inside the process-wide MiniMax gate, and 429/529/1002 are retried with backoff
 *  (timeoutMs applies per attempt). */
export async function anthropicMessages(creds: HelperCreds, body: Record<string, unknown>, opts: AnthropicOpts): Promise<AnthropicResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const payload = creds.model ? { ...body, model: creds.model } : body;
  const once = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await doFetch(creds.url, { method: "POST", signal: controller.signal, headers: creds.headers, body: JSON.stringify(payload) });
      // read the body inside the timeout window so retry/parse see a complete Response
      const buf = await res.arrayBuffer();
      return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const res = creds.provider === MINIMAX_ROUTE
      ? await minimaxGate({ maxConcurrency: creds.maxConcurrency ?? 1 }).run(() => withMiniMaxRetry(once, opts.retry))
      : await once();
    if (!res.ok) return { ok: false, status: res.status, reason: `http ${res.status}` };
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = Array.isArray(data.content) ? data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ") : "";
    return { ok: true, text };
  } catch (err) {
    if (err instanceof MiniMaxError) return { ok: false, status: err.status, reason: err.message, code: err.code };
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
