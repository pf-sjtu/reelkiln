// PORT-NEW: registry of configured LLM providers + resolution against the environment (docs/15 §3).
// Resolution reads the key from the UNSANITIZED environment (sanitizedAgentEnv strips every *KEY*
// name), registers it with the logger's redactor, and returns a ResolvedProvider. A ResolvedProvider
// holds the key: pass it to describeProvider() before printing/logging anything.
import { LlmProviderError } from "./errors";
import { getLogger, registerSecret } from "./logger";
import { loadProvidersFile, parseProviderConfigs, parseProvidersFile, type AuthConfig, type LlmProtocol, type ProviderConfig, type ProviderConfigInput, BUILTIN_PRESETS } from "./provider-config";
import type { RetryPolicy } from "./retry";

export interface ModelAliases { opus: string; sonnet: string; haiku: string; smallFast: string; subagent: string }

export interface ResolvedProvider {
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  auth: AuthConfig;
  keyEnv: string;
  /** SECRET. */
  key: string;
  model: string;
  aliases: ModelAliases;
  defaultParams: Record<string, unknown>;
  headers: Record<string, string>;
  agentEffort?: string;
  maxConcurrency: number;
  retry: RetryPolicy;
  timeoutMs: number;
  modelsDev: { provider: string; model: string };
}

export interface ProviderSummary {
  name: string;
  displayName?: string;
  protocol: LlmProtocol;
  baseUrl: string;
  authScheme: AuthConfig["scheme"];
  apiKeyEnv: string;
  /** true when apiKeyEnv is set (the value itself is never exposed). */
  configured: boolean;
  model: string;
  maxConcurrency: number;
  builtin: boolean;
}

export class ProviderRegistry {
  private readonly byName: Map<string, ProviderConfig>;
  constructor(readonly configs: readonly ProviderConfig[], readonly builtinNames: ReadonlySet<string> = new Set(BUILTIN_PRESETS.map((p) => p.name)), readonly configError?: string) {
    this.byName = new Map(configs.map((c) => [c.name, c]));
  }
  names(): string[] { return [...this.byName.keys()]; }
  has(name: unknown): name is string { return typeof name === "string" && this.byName.has(name); }
  get(name: string): ProviderConfig | undefined { return this.byName.get(name); }
  require(name: string): ProviderConfig {
    const c = this.byName.get(name);
    if (!c) throw new LlmProviderError("UNKNOWN_PROVIDER", `unknown LLM provider "${name}" (registered: ${this.names().join(", ") || "none"})`, { provider: name });
    return c;
  }
  /** Returns null when the key env var is missing/blank (so callers can degrade like the original
   *  gateway branch does without a key). Throws UNKNOWN_PROVIDER for unregistered names. */
  resolve(name: string, env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
    return resolveProviderConfig(this.require(name), env);
  }
  /** Like resolve() but a missing key is a typed KEY_MISSING error. */
  resolveOrThrow(name: string, env: NodeJS.ProcessEnv = process.env): ResolvedProvider {
    const r = this.resolve(name, env);
    if (!r) {
      const c = this.require(name);
      throw new LlmProviderError("KEY_MISSING", `The "${name}" provider is selected but ${c.apiKeyEnv} is not set.`, { provider: name });
    }
    return r;
  }
  summaries(env: NodeJS.ProcessEnv = process.env): ProviderSummary[] {
    return this.configs.map((c) => {
      const r = resolveNonSecretFields(c, env);
      return {
        name: c.name, ...(c.displayName ? { displayName: c.displayName } : {}), protocol: c.protocol, baseUrl: r.baseUrl, authScheme: c.auth.scheme,
        apiKeyEnv: c.apiKeyEnv, configured: !!env[c.apiKeyEnv]?.trim(), model: r.model, maxConcurrency: r.maxConcurrency, builtin: this.builtinNames.has(c.name),
      };
    });
  }
}

function resolveNonSecretFields(c: ProviderConfig, env: NodeJS.ProcessEnv): { baseUrl: string; model: string; maxConcurrency: number } {
  const ov = c.envOverrides;
  const baseUrl = ((ov.baseUrl && env[ov.baseUrl]?.trim()) || c.baseUrl).replace(/\/+$/, "");
  const model = (ov.model && env[ov.model]?.trim()) || c.model;
  let maxConcurrency = c.concurrency.max;
  if (ov.maxConcurrency && env[ov.maxConcurrency] !== undefined) {
    const n = Math.floor(Number(env[ov.maxConcurrency]));
    maxConcurrency = Number.isFinite(n) && n >= 1 ? n : c.concurrency.max;
  }
  maxConcurrency = Math.max(1, Math.min(c.concurrency.cap, maxConcurrency));
  return { baseUrl, model, maxConcurrency };
}

export function resolveProviderConfig(c: ProviderConfig, env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
  const key = env[c.apiKeyEnv]?.trim();
  if (!key) return null;
  registerSecret(key);
  const { baseUrl, model, maxConcurrency } = resolveNonSecretFields(c, env);
  const a = c.aliases;
  return {
    name: c.name, protocol: c.protocol, baseUrl, auth: c.auth, keyEnv: c.apiKeyEnv, key, model,
    aliases: { opus: a.opus ?? model, sonnet: a.sonnet ?? model, haiku: a.haiku ?? model, smallFast: a.smallFast ?? model, subagent: a.subagent ?? model },
    defaultParams: c.defaultParams, headers: c.headers, ...(c.agentEffort ? { agentEffort: c.agentEffort } : {}),
    maxConcurrency, retry: c.retry, timeoutMs: c.timeoutMs,
    modelsDev: { provider: c.modelsDev.provider ?? c.name, model: c.modelsDev.model ?? model },
  };
}

/** Safe-to-print view of a resolved provider (key → configured:true; never the value). */
export function describeProvider(p: ResolvedProvider | null): { configured: boolean; name?: string; protocol?: string; baseUrl?: string; authScheme?: string; keyEnv?: string; model?: string; maxConcurrency?: number } {
  return p ? { configured: true, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, authScheme: p.auth.scheme, keyEnv: p.keyEnv, model: p.model, maxConcurrency: p.maxConcurrency } : { configured: false };
}

// ---------------------------------------------------------------------------------------------
// Process-wide registry

export const PROVIDERS_FILE_ENV = "VIDEOCLAW_LLM_PROVIDERS_FILE";

/** Builds a registry from the built-in presets + (optionally) a providers JSON file. Strict: throws
 *  CONFIG_INVALID on any problem. `file` defaults to $VIDEOCLAW_LLM_PROVIDERS_FILE (required to
 *  exist when set explicitly through the env var). */
export function loadProviderRegistry(o: { file?: string; json?: unknown; env?: NodeJS.ProcessEnv; presets?: readonly ProviderConfigInput[] } = {}): ProviderRegistry {
  const env = o.env ?? process.env;
  const presets = o.presets ?? BUILTIN_PRESETS;
  const builtin = new Set(presets.map((p) => p.name));
  if (o.json !== undefined) {
    const json = o.json as { providers?: unknown[] };
    return new ProviderRegistry(Array.isArray(json) ? parseProviderConfigs(json, presets) : parseProvidersFile(json, presets), builtin);
  }
  const file = o.file ?? env[PROVIDERS_FILE_ENV]?.trim();
  return new ProviderRegistry(file ? loadProvidersFile(file, { required: !o.file, presets }) : parseProviderConfigs([], presets), builtin);
}
let current: ProviderRegistry | undefined;
/** Graceful variant used by the route plumbing: an invalid providers file is logged (without
 *  content) and the built-in presets stay usable; `configError` records what went wrong. */
export function getProviderRegistry(): ProviderRegistry {
  if (current) return current;
  try {
    current = loadProviderRegistry();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().error("llm.providers.config_invalid", { error: msg, file: process.env[PROVIDERS_FILE_ENV] });
    current = new ProviderRegistry(parseProviderConfigs([]), undefined, msg);
  }
  return current;
}
export function setProviderRegistry(r: ProviderRegistry | undefined): void { current = r; }
