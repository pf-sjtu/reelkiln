// PORT-NEW: config schema + loader for generic custom LLM providers (docs/15 §2).
// A provider is pure configuration: protocol, base URL, auth scheme, the NAME of the env var that
// holds the key (never the key itself), model id/aliases, default params, concurrency and retry
// policy. Built-in presets (MiniMax) are just entries of the same schema; a user entry with the same
// name is merged over the preset (top-level fields replace, nested objects merge one level deep,
// `auth` is replaced as a whole).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { LlmProviderError } from "./errors";
import { DEFAULT_RETRY_POLICY } from "./retry";
import { STRUCTURED_OUTPUT_MODES } from "./structured-output";

export const LLM_PROTOCOLS = ["anthropic-messages", "openai-chat-completions", "openai-responses"] as const;
export type LlmProtocol = (typeof LLM_PROTOCOLS)[number];
/** Route ids owned by the original app; a provider may not take these names. */
export const RESERVED_ROUTE_NAMES = ["claude-code", "gateway"] as const;

const ENV_NAME = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name");
const HEADER_NAME = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, "must be an HTTP header name");
const NO_CRLF = /^[^\r\n\u0000]*$/;
const SECRETISH_HEADER = /^(authorization|x-api-key|api-key|cookie|proxy-authorization)$/i;

export const AuthSchema = z.discriminatedUnion("scheme", [
  z.strictObject({ scheme: z.literal("x-api-key") }),
  z.strictObject({ scheme: z.literal("bearer") }),
  /** `<header>: <prefix><key>`, e.g. { header: "api-key" } (Azure) or { header: "X-Auth", prefix: "Token " }. */
  z.strictObject({ scheme: z.literal("header"), header: HEADER_NAME, prefix: z.string().max(64).regex(NO_CRLF, "must not contain line breaks").default("") }),
]);
export type AuthConfig = z.infer<typeof AuthSchema>;

const MODEL_ID = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/, "must not contain control characters");

/** Base URL rules shared by the schema and env overrides (production hardening, docs/15 §3.5):
 *  http(s) only; no userinfo (credentials belong in apiKeyEnv); no query/fragment (the protocol
 *  path is appended); plain http only for loopback hosts unless allowInsecureHttp. */
export function baseUrlProblem(raw: string, allowInsecureHttp = false): string | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return "must be an absolute URL"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "must be http(s)";
  if (u.username || u.password) return "must not contain credentials (use apiKeyEnv)";
  if (u.search || u.hash) return "must not contain a query string or fragment";
  const loopback = u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]" || /^127\./.test(u.hostname);
  if (u.protocol === "http:" && !loopback && !allowInsecureHttp) return "plain http is only allowed for localhost (set allowInsecureHttp: true to override)";
  return undefined;
}

export const ProviderConfigSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "lowercase letters, digits, . _ - (max 64)")
    .refine((n) => !(RESERVED_ROUTE_NAMES as readonly string[]).includes(n), "is a reserved route name"),
  displayName: z.string().max(100).optional(),
  protocol: z.enum(LLM_PROTOCOLS),
  /** Root the protocol path is appended to: anthropic → {baseUrl}/v1/messages,
   *  openai-chat-completions → {baseUrl}/chat/completions, openai-responses → {baseUrl}/responses. */
  baseUrl: z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, "")),
  /** Allow plain http to a non-loopback host (e.g. an in-cluster proxy). Default false. */
  allowInsecureHttp: z.boolean().default(false),
  auth: AuthSchema.prefault({ scheme: "bearer" }),
  apiKeyEnv: ENV_NAME,
  model: MODEL_ID,
  /** Claude-runtime aliases (anthropic-messages only); each defaults to `model`. */
  aliases: z.strictObject({ opus: MODEL_ID, sonnet: MODEL_ID, haiku: MODEL_ID, smallFast: MODEL_ID, subagent: MODEL_ID }).partial().prefault({}),
  /** Merged UNDER every helper request body (request fields win), e.g. {"thinking":{...}} or {"reasoning_effort":"low"}. */
  defaultParams: z.record(z.string(), z.unknown()).prefault({}),
  /** Extra NON-secret request headers. Auth headers are rejected here — use `auth` + `apiKeyEnv`. */
  headers: z.record(HEADER_NAME, z.string().max(2000).regex(NO_CRLF, "must not contain line breaks")).prefault({})
    .refine((h) => !Object.keys(h).some((k) => SECRETISH_HEADER.test(k)), "must not contain auth headers (use auth/apiKeyEnv)"),
  /** Claude Agent SDK effort level for the child runtime (CLAUDE_CODE_EFFORT_LEVEL). */
  agentEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  /** Claude Code child-runtime compatibility switches for non-Anthropic servers (docs/16 §4).
   *  Each maps to a Claude Code env knob, except gateProxy (route the child through the
   *  main-process loopback gate proxy: account-level concurrency + the real key never enters the
   *  child env). All default false; the MiniMax preset turns on the ones verified necessary. */
  agentCompat: z.strictObject({
    gateProxy: z.boolean(),
    disableNonessentialTraffic: z.boolean(), // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: no title side-request, no HEAD /api/hello probe, no telemetry
    disableStructuredOutputs: z.boolean(), // CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS: server ignores output_config.format json_schema
    disablePromptCaching: z.boolean(), // DISABLE_PROMPT_CACHING: server rejects cache_control
    disableExperimentalBetas: z.boolean(), // CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: server rejects anthropic-beta values / beta body fields
    disableThinking: z.boolean(), // CLAUDE_CODE_DISABLE_THINKING
    disableAdaptiveThinking: z.boolean(), // CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING
  }).partial().prefault({}),
  concurrency: z.strictObject({
    max: z.int().min(1).max(64).default(1),
    /** Hard ceiling also applied to env overrides (MiniMax: 2, the key is shared). */
    cap: z.int().min(1).max(64).default(64),
  }).prefault({}),
  retry: z.strictObject({
    maxRetries: z.int().min(0).max(10).default(DEFAULT_RETRY_POLICY.maxRetries),
    baseDelayMs: z.int().min(0).max(600_000).default(DEFAULT_RETRY_POLICY.baseDelayMs),
    maxDelayMs: z.int().min(0).max(600_000).default(DEFAULT_RETRY_POLICY.maxDelayMs),
    retryStatuses: z.array(z.int().min(400).max(599)).default([...DEFAULT_RETRY_POLICY.retryStatuses]),
    credentialStatuses: z.array(z.int().min(400).max(599)).default([...DEFAULT_RETRY_POLICY.credentialStatuses]),
    bodyCodePath: z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/).optional(),
    retryBodyCodes: z.array(z.int()).default([]),
    credentialBodyCodes: z.array(z.int()).default([]),
  }).prefault({}),
  timeoutMs: z.int().min(1000).max(600_000).default(60_000),
  /** openai-chat-completions only: name of the output-token limit field. OpenAI's newer models
   *  (o-series, gpt-5.x) reject `max_tokens`; most OpenAI-compatible servers still expect it. */
  chatMaxTokensField: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  /** How helper calls request structured (JSON-Schema) output (docs/17): "native" = the protocol's
   *  own field (output_config.format / response_format / text.format), "tool" = one forced tool
   *  call carrying the schema (for servers that ignore the native field, e.g. MiniMax), "off" =
   *  drop it. */
  structuredOutput: z.enum(STRUCTURED_OUTPUT_MODES).default("native"),
  /** Key into the models.dev catalog (docs/15 §5); defaults: provider=name, model=model. */
  modelsDev: z.strictObject({ provider: z.string().min(1).optional(), model: z.string().min(1).optional() }).prefault({}),
  /** Names of env vars that may override fields at resolve time (kept for MINIMAX_* compatibility). */
  envOverrides: z.strictObject({ baseUrl: ENV_NAME, model: ENV_NAME, maxConcurrency: ENV_NAME }).partial().prefault({}),
}).superRefine((c, ctx) => {
  const problem = baseUrlProblem(c.baseUrl, c.allowInsecureHttp);
  if (problem) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: problem });
});
export type ProviderConfig = z.output<typeof ProviderConfigSchema>;
export type ProviderConfigInput = z.input<typeof ProviderConfigSchema>;
export type AgentCompat = ProviderConfig["agentCompat"];

export const ProvidersFileSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1).default(1),
  providers: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
});

// ---------------------------------------------------------------------------------------------
// Built-in presets

/** MiniMax (docs/14, verified 2026-10-21): Anthropic-compatible endpoint, Bearer (= the Claude
 *  SDK's ANTHROPIC_AUTH_TOKEN; x-api-key was verified too), concurrency 1 (cap 2, key shared with
 *  another pipeline), 429/529 + base_resp 1002 retried, 401/403 + 1004/1008 never retried. */
export const MINIMAX_PRESET: ProviderConfigInput = {
  name: "minimax",
  displayName: "MiniMax (Anthropic-compatible)",
  protocol: "anthropic-messages",
  baseUrl: "https://api.minimaxi.com/anthropic",
  auth: { scheme: "bearer" },
  apiKeyEnv: "MINIMAX_API_KEY",
  model: "MiniMax-M3.1-Flash",
  concurrency: { max: 1, cap: 2 },
  // docs/16: verified against the real Claude Code 2.1.305 child — the title side-request runs in
  // parallel with the turn (breaks concurrency 1 on the shared key) and MiniMax ignores
  // output_config.format; the gate proxy keeps the child within the account gate and keeps the key
  // out of the child env (the agent's Bash tool could otherwise read ANTHROPIC_AUTH_TOKEN).
  agentCompat: { gateProxy: true, disableNonessentialTraffic: true, disableStructuredOutputs: true },
  // docs/17 (verified 2026-10-21, 15 live probes): MiniMax-M3.1-Flash IGNORES output_config.format,
  // response_format (json_schema and json_object) and Responses text.format — 200 + free text —
  // but a forced tool call returned schema-valid JSON 9/9 on both endpoints.
  structuredOutput: "tool",
  retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60_000, retryStatuses: [429, 529], credentialStatuses: [401, 403], bodyCodePath: "base_resp.status_code", retryBodyCodes: [1002], credentialBodyCodes: [1004, 1008] },
  // api.minimaxi.com is the China site; models.dev lists the same models under minimax-cn.
  modelsDev: { provider: "minimax-cn" },
  envOverrides: { baseUrl: "MINIMAX_BASE_URL", model: "MINIMAX_MODEL", maxConcurrency: "MINIMAX_MAX_CONCURRENCY" },
};
export const BUILTIN_PRESETS: readonly ProviderConfigInput[] = [MINIMAX_PRESET];

// ---------------------------------------------------------------------------------------------
// Parsing / loading

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function mergeOverPreset(preset: Record<string, unknown>, user: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...preset };
  for (const [k, v] of Object.entries(user)) out[k] = k !== "auth" && isPlainObject(v) && isPlainObject(preset[k]) ? { ...preset[k], ...v } : v;
  return out;
}

function formatIssues(err: z.ZodError, where: string): string {
  return err.issues.slice(0, 8).map((i) => `${where}${i.path.length ? "." + i.path.join(".") : ""}: ${i.message}`).join("; ");
}

const KEY_LIKE_FIELD = /^(api[_-]?key|key|token|secret|password|authToken|accessToken)$/i;

/** Validates presets + user entries and returns the effective provider list (user entries override
 *  presets of the same name; duplicates within the user file are an error). Throws CONFIG_INVALID. */
export function parseProviderConfigs(userEntries: unknown[], presets: readonly ProviderConfigInput[] = BUILTIN_PRESETS): ProviderConfig[] {
  const byName = new Map<string, Record<string, unknown>>();
  for (const p of presets) byName.set(p.name, p as Record<string, unknown>);
  const seen = new Set<string>();
  userEntries.forEach((raw, i) => {
    const where = `providers[${i}]`;
    if (!isPlainObject(raw)) throw new LlmProviderError("CONFIG_INVALID", `${where}: must be an object`);
    const leaked = Object.keys(raw).find((k) => KEY_LIKE_FIELD.test(k));
    if (leaked) throw new LlmProviderError("CONFIG_INVALID", `${where}.${leaked}: secrets must not be stored in the providers file — put the key in an env var and reference it with "apiKeyEnv"`);
    const name = typeof raw.name === "string" ? raw.name : "";
    if (seen.has(name)) throw new LlmProviderError("CONFIG_INVALID", `${where}.name: duplicate provider "${name}"`);
    seen.add(name);
    const preset = byName.get(name);
    byName.set(name, preset ? mergeOverPreset(preset, raw) : raw);
  });
  const out: ProviderConfig[] = [];
  for (const [name, raw] of byName) {
    const r = ProviderConfigSchema.safeParse(raw);
    if (!r.success) throw new LlmProviderError("CONFIG_INVALID", formatIssues(r.error, `provider "${name}"`));
    out.push(r.data);
  }
  return out;
}

export function parseProvidersFile(json: unknown, presets?: readonly ProviderConfigInput[]): ProviderConfig[] {
  const r = ProvidersFileSchema.safeParse(json);
  if (!r.success) throw new LlmProviderError("CONFIG_INVALID", formatIssues(r.error, "providers file"));
  return parseProviderConfigs(r.data.providers, presets);
}

/** Reads + validates a providers JSON file. A missing file is an error only when `required`. */
export function loadProvidersFile(path: string, o: { required?: boolean; presets?: readonly ProviderConfigInput[] } = {}): ProviderConfig[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" && !o.required) return parseProviderConfigs([], o.presets);
    throw new LlmProviderError("CONFIG_INVALID", `cannot read providers file ${path}: ${(e as NodeJS.ErrnoException).code ?? "error"}`, { cause: e });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new LlmProviderError("CONFIG_INVALID", `providers file ${path} is not valid JSON` /* parser message omitted: it can quote file content */, { cause: e });
  }
  return parseProvidersFile(json, o.presets);
}
