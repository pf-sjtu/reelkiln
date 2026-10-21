// PORT-NEW glue (docs/28): the Claude Code login + catalog half of the original AgentHost.
//   claudeCodeStatus L51028 · connectClaudeCode L51077 · cancelClaudeCodeConnect L51105 ·
//   claudeCodeSignOutImpact L51116 (usesMacClaudeLogin L51108) · signOutClaudeCode / runClaudeSignOut L51197 ·
//   claudeModels L51353 / discoverClaudeModels L51528 (verbatim partition: claude-routes.generated.ts)
//
// USER DIRECTIVE (docs/27/28): no real Claude subscription is ever used. The two OS seams of the original are
// therefore replaced, and everything around them is the original algorithm:
//   * claudeCodeAvailable (claudeCodeLoginAvailable L22748 = `claude auth status`) → PORT probe that is
//     constantly FALSE (the CLI is never asked; a Claude login on the box is not looked for);
//   * claudeCodeConnector (connectClaudeCode → `claude auth login`) → PORT refusal (no browser login started).
//   So status/connect/cancel/signOutImpact/signOut answer exactly the original's "Claude Code not connected"
//   branches.
//   * claudeModelSource (bundledClaudeModelSource L31855: CLI identity + SDK supportedModels) → the MiniMax
//     source: identity = the Claude-route credential this build actually has (MINIMAX_API_KEY presence), models =
//     MiniMax GET /v1/models (one gated request). The result runs through the ORIGINAL partition against the
//     ORIGINAL CLAUDE_MODEL_EVIDENCE ledger (MiniMax ids are "unqualified" → selectable, never recommended).
import { createHash } from "node:crypto";
import { canonicalClaudeModelId, partitionDiscoveredClaudeModels, CLAUDE_MODEL_EVIDENCE } from "./claude-routes.generated";
import { redactDiagnostic } from "../codex/codex-protocol.generated";
import type { ResolvedProvider } from "../llm/provider-registry";
import { providerGate } from "../llm/retry";
import { authHeaders } from "../llm/protocols";

export const CLAUDE_CATALOG_TTL_MS = 5 * 6e4; // L34385
export const CLAUDE_CATALOG_TIMEOUT_MS = 15e3; // L34386
export const CLAUDE_SIGN_IN_CHANGED = { ok: false, reason: "failed", message: "Your Claude Code sign-in changed while VideoClaw was reading its models. Try again." }; // L34389
export const CLAUDE_CONNECT_DISABLED = "Claude Code sign-in is turned off in this build: its Claude route runs on MiniMax (MINIMAX_API_KEY), never on a Claude subscription.";

export interface ClaudeModelSource {
  identity(signal: AbortSignal): Promise<{ key: string; signedIn: boolean; email?: string }>;
  discover(signal: AbortSignal): Promise<{ email?: string; models: Array<{ value: string; resolvedModel?: string; displayName?: string; description?: string; supportedEffortLevels?: string[]; supportsEffort?: boolean }> }>;
}
const isChatModel = (id: string) => /^MiniMax-M\d/i.test(id);
/** The MiniMax-backed Claude-route catalog (OpenAI-surface provider, the same GET /v1/models docs/27 uses). */
export function miniMaxClaudeModelSource(provider: () => ResolvedProvider | null, fetchImpl: typeof fetch = fetch): ClaudeModelSource {
  return {
    async identity() {
      const p = provider();
      return { key: JSON.stringify(["minimax", p?.baseUrl ?? null, p ? createHash("sha256").update(p.key).digest("hex").slice(0, 12) : null]), signedIn: !!p };
    },
    async discover(signal) {
      const p = provider();
      if (!p) throw new Error("MiniMax is not configured.");
      const body: any = await providerGate(p.gateKey ?? p.name, p.maxConcurrency).run(async () => {
        const res = await fetchImpl(`${p.baseUrl}/models`, { headers: { ...authHeaders(p.auth, p.key), accept: "application/json" }, signal });
        if (!res.ok) throw new Error(`MiniMax model list failed (HTTP ${res.status}).`);
        return res.json();
      });
      const ids: string[] = (Array.isArray(body?.data) ? body.data : []).map((m: any) => String(m?.id ?? "")).filter(isChatModel);
      if (!ids.includes(p.model) && isChatModel(p.model)) ids.unshift(p.model);
      return { models: ids.map((id) => ({ value: id, displayName: id, description: "MiniMax (Anthropic-compatible) — this build's Claude route" })) };
    },
  };
}

export interface ClaudeCodeDeps {
  /** PORT: the presence probe. Default false — `claude auth status` is never run. */
  available?: () => Promise<boolean>;
  /** PORT: the login child. Default: refuse (no Claude login is ever started). */
  connector?: (o: { signal: AbortSignal }) => Promise<void>;
  modelSource: ClaudeModelSource;
  /** usesMacClaudeLogin rows: local claude-code harness on route "claude-code", running or awaiting permission. */
  sessions: () => Iterable<{ meta: { runtime?: string; agentHarness?: string; status?: string; llmRoute?: unknown }; runtime?: unknown }>;
  sessionLlmRoute: (meta: any) => unknown;
  catalogTimeoutMs?: number;
}

export class ClaudeCodeController {
  private login?: Promise<unknown>;
  private loginAbort?: AbortController;
  private signOut?: Promise<unknown>;
  private catalogCache?: { at: number; key: string; result: any };
  private catalogEpoch = 0;
  knownModels?: { key: string; models: any[] };
  constructor(private readonly d: ClaudeCodeDeps) {}
  private available() { return (this.d.available ?? (async () => false))(); }
  invalidateCatalog() { this.catalogEpoch += 1; this.catalogCache = undefined; this.knownModels = undefined; }

  async status() { return { available: await this.available(), ...(this.login ? { connecting: true } : {}) }; } // L51028
  async connect() { // L51077
    if (this.login) return this.login;
    if (this.signOut) throw new Error("Claude Code is still signing out. Try again in a moment.");
    const controller = new AbortController();
    this.loginAbort = controller;
    const login = (async () => {
      try {
        await (this.d.connector ?? (async () => { throw new Error(CLAUDE_CONNECT_DISABLED); }))({ signal: controller.signal });
      } finally {
        this.invalidateCatalog();
        this.login = undefined;
        this.loginAbort = undefined;
      }
      return await this.status();
    })();
    this.login = login;
    return login;
  }
  cancelConnect() { this.loginAbort?.abort(); } // L51105
  usesMacClaudeLogin(s: { meta: any }) { // L51108
    return (s.meta.runtime ?? "local") === "local" && (s.meta.agentHarness ?? "claude-code") === "claude-code" && this.d.sessionLlmRoute(s.meta) === "claude-code";
  }
  signOutImpact() { // L51116
    let runningVideos = 0;
    for (const s of this.d.sessions()) if (this.usesMacClaudeLogin(s) && s.runtime && (s.meta.status === "running" || s.meta.status === "awaiting_permission")) runningVideos += 1;
    return { runningVideos };
  }
  async signOutClaudeCode() { // L51197
    if (this.signOut) return this.signOut;
    const run = Promise.resolve().then(() => this.runSignOut()).finally(() => { this.signOut = undefined; });
    this.signOut = run;
    return run;
  }
  private async runSignOut() {
    this.invalidateCatalog();
    const login = this.login;
    if (login) { this.loginAbort?.abort(); await login.catch(() => {}); }
    if (!(await this.available())) {
      return { ok: false, stoppedVideos: 0, status: { available: false }, error: "VideoClaw could not find a Claude Code sign-in on this Mac, so nothing was signed out." };
    }
    // PORT: unreachable with the default probe; an injected probe that reports a login gets an honest refusal
    // (the original would retire runtimes and run `claude auth logout` on the user's real profile).
    return { ok: false, stoppedVideos: 0, status: { available: true }, error: "Claude Code sign-out is not available in this build." };
  }

  async models(force = false): Promise<any> { // claudeModels L51353 (single-flight join / boundary-read bookkeeping not ported)
    if (this.signOut) return { ok: false, reason: "unavailable", message: "Claude Code is signing out." };
    if (force) this.catalogCache = undefined;
    const epoch = this.catalogEpoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.d.catalogTimeoutMs ?? CLAUDE_CATALOG_TIMEOUT_MS);
    (timer as any).unref?.();
    try {
      let identity: { key: string; signedIn: boolean; email?: string };
      try { identity = await this.d.modelSource.identity(controller.signal); } catch {
        if (epoch !== this.catalogEpoch) return CLAUDE_SIGN_IN_CHANGED;
        return { ok: false, reason: "unavailable", message: "VideoClaw could not reach Claude Code to read its models. Try again." };
      }
      if (!identity.signedIn) { this.knownModels = undefined; return { ok: false, reason: "unauthenticated", message: "Connect Claude Code to choose a model." }; }
      if (epoch !== this.catalogEpoch) return CLAUDE_SIGN_IN_CHANGED;
      const cached = this.catalogCache;
      if (!force && cached && cached.key === identity.key && Date.now() - cached.at < CLAUDE_CATALOG_TTL_MS) return cached.result;
      const result: any = await this.discover(identity, controller.signal);
      if (result.ok && epoch === this.catalogEpoch) {
        this.catalogCache = { at: Date.now(), key: identity.key, result };
        this.knownModels = { key: identity.key, models: result.models };
      }
      return epoch === this.catalogEpoch ? result : CLAUDE_SIGN_IN_CHANGED;
    } finally { clearTimeout(timer); }
  }
  /** The last good catalog inside its reuse window (freshClaudeCatalog L51476). */
  freshCatalog(): any { const c = this.catalogCache; return c && Date.now() - c.at < CLAUDE_CATALOG_TTL_MS ? c.result : undefined; }
  private async discover(identity: { email?: string }, signal: AbortSignal) { // discoverClaudeModels L51528
    try {
      const catalog = await this.d.modelSource.discover(signal);
      if (identity.email && catalog.email && catalog.email !== identity.email) return CLAUDE_SIGN_IN_CHANGED;
      const discovered = catalog.models.flatMap((entry) => {
        const id2 = canonicalClaudeModelId(entry);
        const efforts = entry.supportedEffortLevels ? [...entry.supportedEffortLevels] : entry.supportsEffort === false ? [] : undefined;
        return id2 ? [{ id: id2, displayName: entry.displayName, description: entry.description, ...(efforts ? { supportedEffortLevels: efforts } : {}) }] : [];
      });
      if (!discovered.length) return { ok: false, reason: "failed", message: "Claude Code reported no models for this account." };
      const { selectable, recommended } = partitionDiscoveredClaudeModels("claude-code", discovered, CLAUDE_MODEL_EVIDENCE);
      return { ok: true, models: selectable, recommended, discovered: [...new Set(discovered.map((m: any) => m.id))] };
    } catch (error) {
      return { ok: false, reason: "failed", message: signal.aborted ? "Claude Code took too long to list its models. Try again." : error instanceof Error ? redactDiagnostic(error.message) : "Claude Code could not list its models." };
    }
  }
}
