// PORT-NEW (docs/27 §3): the MiniMax backend of the Codex route.
//
// The original runs the official Codex app-server against ChatGPT (subscription login), the OpenAI API or
// OpenRouter (keyed `model_providers` with `wire_api: "responses"`, codexOpenAiConfig L23454). The port has
// no ChatGPT/OpenAI credentials by design (user directive): the SAME external codex binary (0.160.1, kept
// external like the Claude SDK) is pointed at MiniMax's OpenAI-compatible Responses endpoint through a
// per-runtime loopback gate proxy (agent-gate-proxy.ts, surface "openai"):
//   - the child gets `model_providers.videoclaw_minimax.base_url = <proxy>/v1` and env_key
//     VIDEOCLAW_MINIMAX_GATE_TOKEN = a per-runtime vcgp_ token (never MINIMAX_API_KEY — codexChildEnv's
//     sanitizedAgentEnv strips *KEY* vars, and shell_environment_policy inherit:none hides the token from
//     the agent's own commands);
//   - every upstream request runs inside providerGate("key:MINIMAX_API_KEY") — the same account gate the
//     Anthropic route and the helper calls use (concurrency 1);
//   - Responses `text.format` json_schema is emulated as a forced function call (structured-emulation-responses.ts).
// The app-owned CODEX_HOME profile (userData/codex-profile, codexProfileDir L51xxx) carries a config.toml
// whose default model_provider is videoclaw_minimax with requires_openai_auth=false, so the real
// `account/read` answers {account:null, requiresOpenaiAuth:false} → authenticated, mode "external"
// (normalizeCodexAccount, verbatim logic). Model discovery is MiniMax GET /v1/models (codex's own
// model/list only knows the OpenAI catalog).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger, registerSecret, type Logger } from "../llm/logger";
import { authHeaders } from "../llm/protocols";
import { parseProviderConfigs, type ProviderConfigInput } from "../llm/provider-config";
import { resolveProviderConfig, type ResolvedProvider } from "../llm/provider-registry";
import { providerGate } from "../llm/retry";
import { startAgentGateProxy, type AgentGateProxy, type AgentGateProxyOptions } from "../llm/agent-gate-proxy";
import type { CodexModel } from "./app-server-client";

export const CODEX_MINIMAX_PROVIDER_ID = "videoclaw_minimax";
export const CODEX_MINIMAX_TOKEN_ENV = "VIDEOCLAW_MINIMAX_GATE_TOKEN";
/** codexProvider slots the MiniMax backend serves: "chatgpt" is the only slot the ORIGINAL renderer
 *  offers in the first-run picker and the composer model/effort picker (activeCodexDiscoverable); the
 *  renderer still labels it "ChatGPT" (docs/27 §6 divergence). "openai-api" maps to the same backend. */
export const MINIMAX_CODEX_SLOTS = ["chatgpt", "openai-api"] as const;

export const MINIMAX_CODEX_PRESET: ProviderConfigInput = {
  name: "minimax-codex",
  displayName: "MiniMax (OpenAI-compatible, Codex route)",
  protocol: "openai-responses",
  baseUrl: "https://api.minimaxi.com/v1",
  auth: { scheme: "bearer" },
  apiKeyEnv: "MINIMAX_API_KEY",
  model: "MiniMax-M3.1-Flash",
  concurrency: { max: 1, cap: 2 },
  agentCompat: { gateProxy: true, emulateStructuredOutputs: true },
  structuredOutput: "tool",
  retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60_000, retryStatuses: [429, 529], credentialStatuses: [401, 403], bodyCodePath: "base_resp.status_code", retryBodyCodes: [1002], credentialBodyCodes: [1004, 1008] },
  modelsDev: { provider: "minimax-cn" },
  envOverrides: { baseUrl: "MINIMAX_OPENAI_BASE_URL", model: "MINIMAX_CODEX_MODEL", maxConcurrency: "MINIMAX_MAX_CONCURRENCY" },
};

/** The resolved MiniMax Codex provider, or null when MINIMAX_API_KEY is absent (or invalid). */
export function resolveMiniMaxCodexProvider(env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
  const [cfg] = parseProviderConfigs([], [MINIMAX_CODEX_PRESET]);
  return resolveProviderConfig(cfg, env);
}

/** The per-thread `config` overlay (sibling of codexOpenAiConfig L23464). */
export function codexMiniMaxConfig(proxyUrl: string): Record<string, unknown> {
  return {
    model_providers: {
      [CODEX_MINIMAX_PROVIDER_ID]: { name: "MiniMax (via VideoClaw gate)", base_url: `${proxyUrl.replace(/\/+$/, "")}/v1`, env_key: CODEX_MINIMAX_TOKEN_ENV, wire_api: "responses", requires_openai_auth: false },
    },
  };
}

const PROFILE_MARKER = "# videoclaw-port managed codex profile (docs/27)";
/** Writes the app-owned CODEX_HOME/config.toml (only when absent or ours). The base_url here is a dead
 *  loopback placeholder: every thread overrides it with the live gate proxy (verified: thread config wins). */
export function ensureCodexProfile(profileDir: string, model: string): void {
  mkdirSync(profileDir, { recursive: true });
  const file = join(profileDir, "config.toml");
  if (existsSync(file) && !readFileSync(file, "utf8").startsWith(PROFILE_MARKER)) return;
  const body = [
    PROFILE_MARKER,
    `model = ${JSON.stringify(model)}`,
    `model_provider = ${JSON.stringify(CODEX_MINIMAX_PROVIDER_ID)}`,
    "",
    `[model_providers.${CODEX_MINIMAX_PROVIDER_ID}]`,
    `name = "MiniMax (via VideoClaw gate)"`,
    `base_url = "http://127.0.0.1:9/v1"`,
    `env_key = ${JSON.stringify(CODEX_MINIMAX_TOKEN_ENV)}`,
    `wire_api = "responses"`,
    `requires_openai_auth = false`,
    "",
  ].join("\n");
  const prev = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (prev !== body) writeFileSync(file, body, { mode: 0o600 });
}

/** resolveCodexExecutable (L23423) for this box: explicit → VIDEOCLAW_CODEX_BIN → the packaged
 *  resources/bootstrap/codex/bin/codex → the port's vendored native binary (port/vendor/codex, npm
 *  @openai/codex, gitignored — an external dependency, never reconstructed) → "codex" on PATH. */
export function resolveCodexExecutable(o: { explicit?: string; env?: NodeJS.ProcessEnv; resourcesPath?: string; appRoot?: string; exists?: (p: string) => boolean } = {}): string {
  const env = o.env ?? process.env;
  const exists = o.exists ?? existsSync;
  if (o.explicit) return o.explicit;
  const fromEnv = env.VIDEOCLAW_CODEX_BIN?.trim();
  if (fromEnv) return fromEnv;
  const triple = process.arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  const plat = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  const candidates = [
    o.resourcesPath ? join(o.resourcesPath, "bootstrap", "codex", "bin", "codex") : "",
    o.appRoot ? join(o.appRoot, "vendor", "codex", "node_modules", "@openai", `codex-${plat}`, "vendor", triple, "bin", "codex") : "",
  ].filter(Boolean);
  return candidates.find((p) => exists(p)) ?? "codex";
}

const EFFORTS = ["low", "medium", "high"] as const;
const EFFORT_COPY: Record<string, string> = { low: "Fast responses with lighter reasoning", medium: "Balances speed and reasoning depth", high: "Greater reasoning depth for complex problems" };
/** Text-generation models of the MiniMax catalog (GET /v1/models also lists speech/video ids). */
const isChatModel = (id: string) => /^MiniMax-M\d/i.test(id);

/** MiniMax model discovery → the CodexModel shape normalizedCodexModel (L24613) produces. Runs inside the
 *  account gate (one request). `isDefault` marks the provider's configured model. */
export async function discoverMiniMaxCodexModels(p: ResolvedProvider, o: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CodexModel[]> {
  const doFetch = o.fetchImpl ?? fetch;
  const gate = providerGate(p.gateKey ?? p.name, p.maxConcurrency);
  const body: any = await gate.run(async () => {
    const signal = o.signal ?? AbortSignal.timeout(o.timeoutMs ?? 15_000);
    const res = await doFetch(`${p.baseUrl}/models`, { headers: { ...authHeaders(p.auth, p.key), accept: "application/json" }, signal });
    if (!res.ok) throw new Error(`MiniMax model list failed (HTTP ${res.status}).`);
    return res.json();
  });
  const ids: string[] = (Array.isArray(body?.data) ? body.data : []).map((m: any) => String(m?.id ?? "")).filter(isChatModel);
  if (!ids.includes(p.model) && isChatModel(p.model)) ids.unshift(p.model);
  return ids.map((id) => ({
    id, model: id, displayName: id, description: "MiniMax via the VideoClaw gate proxy (OpenAI Responses)", isDefault: id === p.model,
    defaultReasoningEffort: "medium", supportedReasoningEfforts: EFFORTS.map((effort) => ({ effort, description: EFFORT_COPY[effort] })),
  }));
}

export interface CodexMiniMaxBackend {
  provider: ResolvedProvider;
  proxy: Pick<AgentGateProxy, "url" | "stats">;
  modelProvider: string;
  config: Record<string, unknown>;
  secret: { envName: string; key: string };
  close(): Promise<void>;
}
/** One gate proxy per Codex runtime (closed when the runtime is torn down). */
export async function startCodexMiniMaxBackend(p: ResolvedProvider, o: { logger?: Logger; proxy?: AgentGateProxyOptions } = {}): Promise<CodexMiniMaxBackend> {
  const proxy = await startAgentGateProxy(p, { logger: o.logger ?? getLogger(), ...o.proxy, surface: "openai" });
  registerSecret(proxy.token);
  return {
    provider: p, proxy: { url: proxy.url, stats: proxy.stats }, modelProvider: CODEX_MINIMAX_PROVIDER_ID,
    config: codexMiniMaxConfig(proxy.url), secret: { envName: CODEX_MINIMAX_TOKEN_ENV, key: proxy.token }, close: () => proxy.close(),
  };
}
