// PORT-NEW: registry of configured LLM providers + resolution against the environment (docs/15 §3).
// Resolution reads the key from the UNSANITIZED environment (sanitizedAgentEnv strips every *KEY*
// name), registers it with the logger's redactor, and returns a ResolvedProvider. A ResolvedProvider
// holds the key: pass it to describeProvider() before printing/logging anything.
import { unwatchFile, watchFile, type Stats } from "node:fs";
import { LlmProviderError } from "./errors";
import { getLogger, registerSecret } from "./logger";
import { baseUrlProblem, loadProvidersFile, parseProviderConfigs, parseProvidersFile, type AuthConfig, type LlmProtocol, type ProviderConfig, type ProviderConfigInput, BUILTIN_PRESETS } from "./provider-config";
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
  /** openai-chat-completions output-token field (default max_tokens). */
  chatMaxTokensField?: "max_tokens" | "max_completion_tokens";
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

const warned = new Set<string>();
function warnOnce(event: string, fields: Record<string, unknown>): void {
  const k = `${event}:${JSON.stringify(fields)}`;
  if (warned.has(k)) return;
  warned.add(k);
  getLogger().warn(event, fields);
}

function resolveNonSecretFields(c: ProviderConfig, env: NodeJS.ProcessEnv): { baseUrl: string; model: string; maxConcurrency: number } {
  const ov = c.envOverrides;
  let baseUrl = c.baseUrl;
  const envBase = ov.baseUrl ? env[ov.baseUrl]?.trim() : undefined;
  if (envBase) {
    const problem = baseUrlProblem(envBase, c.allowInsecureHttp);
    // an invalid override is ignored (graceful degradation) — logged by env NAME, never by value
    if (problem) warnOnce("llm.provider.env_override_ignored", { provider: c.name, env: ov.baseUrl, problem });
    else baseUrl = envBase;
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  let model = c.model;
  const envModel = ov.model ? env[ov.model]?.trim() : undefined;
  if (envModel) {
    if (envModel.length <= 200 && !/[\u0000-\u001f\u007f]/.test(envModel)) model = envModel;
    else warnOnce("llm.provider.env_override_ignored", { provider: c.name, env: ov.model, problem: "invalid model id" });
  }
  let maxConcurrency = c.concurrency.max;
  if (ov.maxConcurrency && env[ov.maxConcurrency] !== undefined) {
    const n = Math.floor(Number(env[ov.maxConcurrency]));
    maxConcurrency = Number.isFinite(n) && n >= 1 ? n : c.concurrency.max;
  }
  maxConcurrency = Math.max(1, Math.min(c.concurrency.cap, maxConcurrency));
  return { baseUrl, model, maxConcurrency };
}

/** A key with whitespace/control characters inside would corrupt the auth header (or, for the
 *  header scheme, ANTHROPIC_CUSTOM_HEADERS) — treated as not configured. */
const KEY_SHAPE = /^[\x21-\x7e]+$/;

export function resolveProviderConfig(c: ProviderConfig, env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
  const key = env[c.apiKeyEnv]?.trim();
  if (!key) return null;
  registerSecret(key);
  if (!KEY_SHAPE.test(key) || key.length > 4096) {
    warnOnce("llm.provider.key_invalid", { provider: c.name, keyEnv: c.apiKeyEnv, problem: "contains whitespace/non-ASCII/control characters or is too long" });
    return null;
  }
  const { baseUrl, model, maxConcurrency } = resolveNonSecretFields(c, env);
  const a = c.aliases;
  return {
    name: c.name, protocol: c.protocol, baseUrl, auth: c.auth, keyEnv: c.apiKeyEnv, key, model,
    aliases: { opus: a.opus ?? model, sonnet: a.sonnet ?? model, haiku: a.haiku ?? model, smallFast: a.smallFast ?? model, subagent: a.subagent ?? model },
    defaultParams: c.defaultParams, headers: c.headers, ...(c.agentEffort ? { agentEffort: c.agentEffort } : {}),
    maxConcurrency, retry: c.retry, timeoutMs: c.timeoutMs, chatMaxTokensField: c.chatMaxTokensField,
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
let generation = 0;
function presetsOnly(error: string): ProviderRegistry { return new ProviderRegistry(parseProviderConfigs([]), undefined, error); }
function loadGraceful(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  try {
    return loadProviderRegistry({ env });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().error("llm.providers.config_invalid", { error: msg, file: env[PROVIDERS_FILE_ENV] });
    return presetsOnly(msg);
  }
}
/** Graceful variant used by the route plumbing: an invalid providers file is logged (without
 *  content) and the built-in presets stay usable; `configError` records what went wrong. */
export function getProviderRegistry(): ProviderRegistry {
  return (current ??= loadGraceful());
}
export function setProviderRegistry(r: ProviderRegistry | undefined): void { current = r; }
/** Increments on every effective registry change (reload that altered the provider set/config). */
export function providerRegistryGeneration(): number { return generation; }

// ---------------------------------------------------------------------------------------------
// Hot reload (docs/15 §2.2): explicit reloadProviderRegistry() — called by the file watcher, by
// SIGHUP in the main process, or by tests — re-runs the SAME strict load. Invalid config never
// half-applies: the registry falls back to the built-in presets (configError set, error logged)
// exactly like an invalid file at startup; fixing the file and reloading restores it.

export interface RegistryChange { previous: ProviderRegistry; current: ProviderRegistry; generation: number; added: string[]; removed: string[]; changed: string[] }
export type RegistryListener = (change: RegistryChange) => void;
const listeners = new Set<RegistryListener>();
/** Subscribe to effective registry changes; returns an unsubscribe function. Listener errors are
 *  logged and never break the reload. */
export function onProviderRegistryChange(fn: RegistryListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const fp = (c: ProviderConfig) => JSON.stringify(c);
export function diffRegistries(a: ProviderRegistry, b: ProviderRegistry): { added: string[]; removed: string[]; changed: string[] } {
  const added = b.names().filter((n) => !a.has(n));
  const removed = a.names().filter((n) => !b.has(n));
  const changed = b.names().filter((n) => a.has(n) && fp(a.get(n)!) !== fp(b.get(n)!));
  return { added, removed, changed };
}

export interface ReloadResult { ok: boolean; changed: boolean; generation: number; providers: string[]; error?: string; added: string[]; removed: string[]; updated: string[] }
export function reloadProviderRegistry(o: { env?: NodeJS.ProcessEnv; reason?: string } = {}): ReloadResult {
  const previous = getProviderRegistry();
  const next = loadGraceful(o.env ?? process.env);
  const d = diffRegistries(previous, next);
  const changed = d.added.length + d.removed.length + d.changed.length > 0 || previous.configError !== next.configError;
  const log = getLogger();
  if (changed) {
    current = next;
    generation++;
    log.info("llm.providers.reloaded", { reason: o.reason ?? "explicit", generation, providers: next.names(), added: d.added, removed: d.removed, updated: d.changed, configError: next.configError });
    for (const fn of [...listeners]) {
      try { fn({ previous, current: next, generation, ...d }); } catch (e) { log.error("llm.providers.listener_failed", { error: e }); }
    }
  } else log.debug("llm.providers.reload_noop", { reason: o.reason ?? "explicit" });
  return { ok: !next.configError, changed, generation, providers: next.names(), ...(next.configError ? { error: next.configError } : {}), added: d.added, removed: d.removed, updated: d.changed };
}

export interface ProvidersFileWatcher { readonly file: string; close(): void }
/** Watches the providers file and reloads on change. Uses fs.watchFile (stat polling): identical
 *  behaviour on Windows/macOS/Linux, survives editors' atomic save (write tmp + rename) and the file
 *  being created later or deleted (deletion → reload → CONFIG_INVALID → presets only). The poller is
 *  unref'd so it never keeps the process alive. Changes are debounced. */
export function watchProvidersFile(o: { file?: string; intervalMs?: number; debounceMs?: number; env?: NodeJS.ProcessEnv } = {}): ProvidersFileWatcher | null {
  const env = o.env ?? process.env;
  const file = o.file ?? env[PROVIDERS_FILE_ENV]?.trim();
  if (!file) return null;
  let timer: NodeJS.Timeout | undefined;
  const onStat = (cur: Stats, prev: Stats) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size && cur.ino === prev.ino) return;
    clearTimeout(timer);
    timer = setTimeout(() => reloadProviderRegistry({ env, reason: "file-changed" }), o.debounceMs ?? 200);
    timer.unref?.();
  };
  watchFile(file, { interval: o.intervalMs ?? 1000, persistent: false }, onStat);
  getLogger().info("llm.providers.watching", { file, intervalMs: o.intervalMs ?? 1000 });
  return { file, close: () => { clearTimeout(timer); unwatchFile(file, onStat); } };
}
