// The Codex-route half of the original AgentHost (index.js), ported for the MiniMax backend (docs/27):
//   codexRuntimeGate L39440 · codexStatus L51256 · codexModels L51305 / discoverCodexModels L52291 ·
//   codexRouteRefusal L51670 · codexModelForSession L51711 · setSessionReasoningEffort (codex half) L51735 ·
//   accountCodexModel L51803 · resolveCodexDefaultModel L51818 · pinCodexModel L51852 ·
//   pinCodexReasoningEffort L51876 · setSessionModel (codex half) L40895 · agentProviderKeyStatus L60359 ·
//   discoveredCodexIds L34395 · resolvedAgentHarness / resolvedCodexProvider L324-333.
// PORT-NEW substitutions (each one documented in docs/27 §3/§6):
//   - codexRuntimeGate: the original reads the gateway-fed feature flag ui/codex_runtime; the port's local
//     gateway shim enables it when the MiniMax backend is configured (MINIMAX_API_KEY) — no gateway exists.
//   - discovery: account/read through the REAL codex binary (app-owned profile), but the model list comes
//     from MiniMax GET /v1/models (codex's model/list only describes OpenAI's catalog).
//   - evidence ledger: the verbatim AGENT_ROUTE_EVIDENCE plus PORT rows for the MiniMax default model,
//     backed by this port's own live conformance run (artifacts/phase-b-m10) — NOT the original's bench.
//   - "openai-api" is served by the same backend; "openrouter" stays unavailable (no OpenRouter key).
import { CodexAppServerClient, CodexProcessCapacityError, SUPPORTED_CODEX_VERSION, type CodexAccountStatus, type CodexModel } from "./app-server-client";
import { codexChildEnv, redactDiagnostic } from "./codex-protocol.generated";
import {
  AGENT_ROUTE_EVIDENCE, agentRouteId, codexEffortDiagnostic, codexModelUnverifiedDiagnostic, codexPinRefusal, codexRouteDiagnostic as codexRouteDiagnosticRaw,
  isQualifiedCodexRoute, partitionDiscoveredCodexModels, resolveCodexReasoningEffort,
} from "./codex-routes.generated";
const codexRouteDiagnostic = codexRouteDiagnosticRaw as (provider: string, modelId?: string, ledger?: any[]) => string;
import { discoverMiniMaxCodexModels, ensureCodexProfile, MINIMAX_CODEX_SLOTS } from "./codex-minimax";
import type { ResolvedProvider } from "../llm/provider-registry";

export const DEFAULT_AGENT_HARNESS = "claude-code";
export const DEFAULT_CODEX_PROVIDER = "chatgpt";
export function resolvedAgentHarness(s: Record<string, unknown>): "claude-code" | "codex-app-server" { // L324
  return s.agentHarness === "codex-app-server" ? "codex-app-server" : DEFAULT_AGENT_HARNESS;
}
export function resolvedCodexProvider(s: Record<string, unknown>): string { // L328
  return s.codexProvider === "openai-api" || s.codexProvider === "openrouter" ? String(s.codexProvider) : DEFAULT_CODEX_PROVIDER;
}
const CODEX_CATALOG_TTL_MS = 5 * 60_000;

/** PORT rows: the MiniMax default model on the two slots the backend serves (docs/27 §5). */
export function portCodexEvidence(model: string, validatedAt = "2026-10-21") {
  return MINIMAX_CODEX_SLOTS.map((provider) => ({
    routeId: agentRouteId("codex-app-server", provider, model), harness: "codex-app-server", provider, modelId: model,
    level: "qualified", validatedAt, runtimeVersion: "0.160.1", recommendedReasoningEffort: "medium",
    evidence: [
      "PORT conformance (docs/27 §7, artifacts/phase-b-m10): initialize 0.160.1, account/read authenticated (external), thread/start exact model on the wire, a real turn with a provider command round-trip, structured final answer via turn/start.outputSchema (gate-proxy emulation), reasoning effort pinned via model_reasoning_effort",
    ],
    notYetCovered: ["VideoClaw Bench", "studio dynamic tools (not ported)", "interrupt/resume conformance suite", "read-only containment write probe"],
    port: true,
  }));
}

export interface CodexHostDeps {
  settings(): Record<string, unknown>;
  /** userData/codex-profile (codexProfileDir) */
  profileDir(): string;
  executable(): string;
  appVersion?: string;
  /** the MiniMax backend provider, null when MINIMAX_API_KEY is absent */
  provider(): ResolvedProvider | null;
  /** tests */
  discoverModels?: (p: ResolvedProvider) => Promise<CodexModel[]>;
  accountStatus?: () => Promise<CodexAccountStatus>;
  persist(): void;
  sessionsChanged(): void;
}
type Catalog = { ok: true; models: CodexModel[]; recommended: string[]; incompatible: any[]; runtimeDefault: any } | { ok: false; reason: string; message: string; incompatible?: any[]; runtimeDefault?: any };
export interface CodexMetaLike { agentHarness?: string; codexProvider?: string; modelOverride?: string; codexReasoningEffort?: string; [k: string]: unknown }

export function discoveredCodexIds(result: Catalog): Array<{ id: string }> | undefined { // L34395
  if (result.ok) return [...result.models, ...result.incompatible];
  return result.runtimeDefault ? (result.incompatible ?? []) : undefined;
}

export class CodexRouteController {
  private catalogCache?: { at: number; account: string; result: Catalog };
  private catalogEpoch = 0;
  constructor(private readonly d: CodexHostDeps) {}
  get evidence(): any[] { const p = this.d.provider(); return [...AGENT_ROUTE_EVIDENCE, ...(p ? portCodexEvidence(p.model) : [])]; }

  runtimeGate(): { enabled: boolean; message: string } { // L39440 (PORT-NEW local shim for the ui/codex_runtime flag)
    const p = this.d.provider();
    return p ? { enabled: true, message: "" } : { enabled: false, message: "Codex in this build runs on MiniMax — set MINIMAX_API_KEY in the environment to use it." };
  }
  assertEnabled(): void { const g = this.runtimeGate(); if (!g.enabled) throw new Error(g.message); }
  private ensureProfile(): void { const p = this.d.provider(); if (p) ensureCodexProfile(this.d.profileDir(), p.model); }
  private async account(timeoutMs: number): Promise<CodexAccountStatus> {
    if (this.d.accountStatus) return this.d.accountStatus();
    this.ensureProfile();
    const client = new CodexAppServerClient({ requestTimeoutMs: timeoutMs, appVersion: this.d.appVersion, executable: this.d.executable(), profileDir: this.d.profileDir(), env: codexChildEnv(undefined, {}, this.d.profileDir()) });
    try { return await client.accountStatus(); } finally { client.close(); }
  }
  private fingerprint(s: CodexAccountStatus) { return `${s.authenticated ? "in" : "out"}:${s.mode ?? "?"}:${s.plan ?? "?"}`; }
  invalidateCatalog(): void { this.catalogEpoch += 1; this.catalogCache = undefined; }

  async status(): Promise<Record<string, unknown>> { // codexStatus L51256
    const gate = this.runtimeGate();
    if (!gate.enabled) return { available: false, authenticated: false, recovery: gate.message };
    try {
      const status = await this.account(8e3);
      if (this.catalogCache && this.catalogCache.account !== this.fingerprint(status)) this.invalidateCatalog();
      return { available: true, authenticated: status.authenticated, mode: status.mode === "managed" ? "external" : status.mode, ...(status.plan ? { plan: status.plan } : {}), ...(status.recovery ? { recovery: status.recovery } : {}) };
    } catch (error) {
      return { available: false, authenticated: false, ...classifyCodexFailure(error) };
    }
  }

  async models(force = false): Promise<Catalog> { // codexModels L51305
    const cached = this.catalogCache;
    if (!force && cached && Date.now() - cached.at < CODEX_CATALOG_TTL_MS) return cached.result;
    const epoch = this.catalogEpoch;
    const { result, account } = await this.discover();
    if (epoch === this.catalogEpoch) this.catalogCache = result.ok ? { at: Date.now(), account, result } : undefined;
    return result;
  }
  private async discover(): Promise<{ result: Catalog; account: string }> { // discoverCodexModels L52291
    const gate = this.runtimeGate();
    if (!gate.enabled) return { result: { ok: false, reason: "unavailable", message: gate.message }, account: "unknown" };
    let account = "unknown";
    let started = false;
    try {
      started = true;
      const status = await this.account(15e3);
      account = this.fingerprint(status);
      if (!status.authenticated) return { result: { ok: false, reason: "unauthenticated", message: status.recovery ?? "Connect ChatGPT to choose a model." }, account };
      const p = this.d.provider()!;
      const discovered = await (this.d.discoverModels ?? discoverMiniMaxCodexModels)(p);
      if (!discovered.length) return { result: { ok: false, reason: "failed", message: "Codex reported no models for this account." }, account };
      const { selectable, recommended, incompatible, runtimeDefault } = partitionDiscoveredCodexModels("chatgpt", discovered, this.evidence);
      if (!selectable.length) return { result: { ok: false, reason: "failed", message: "Codex lists no model VideoClaw can run for this account.", incompatible, runtimeDefault }, account };
      return { result: { ok: true, models: selectable, recommended, incompatible, runtimeDefault }, account };
    } catch (error) {
      const message = error instanceof Error ? redactDiagnostic(error.message) : "Codex could not list models.";
      return { result: { ok: false, reason: error instanceof CodexProcessCapacityError ? "capacity" : started ? "failed" : "unavailable", message }, account };
    }
  }

  /** accountCodexModel L51803 */
  accountCodexModel(provider: string): string | undefined {
    const s = this.d.settings();
    return provider === resolvedCodexProvider(s) && typeof s.codexModel === "string" ? s.codexModel : undefined;
  }

  /** codexRouteRefusal L51670. The keyed slot the backend serves ("openai-api") is judged like the
   *  original keyed providers: ledger only (the PORT row makes the MiniMax default qualified). */
  async routeRefusal(meta: CodexMetaLike, intent: "turn" | "pick" = "turn"): Promise<string | undefined> {
    if ((meta.agentHarness ?? "claude-code") !== "codex-app-server") return undefined;
    const provider = meta.codexProvider ?? DEFAULT_CODEX_PROVIDER;
    if (provider !== "chatgpt") return isQualifiedCodexRoute(provider, meta.modelOverride, this.evidence) ? undefined : codexRouteDiagnostic(provider, meta.modelOverride, this.evidence);
    if (meta.modelOverride) {
      const catalog2 = await this.models();
      const discovered = discoveredCodexIds(catalog2);
      if (!discovered) {
        return intent === "turn" && isQualifiedCodexRoute("chatgpt", meta.modelOverride, this.evidence) ? undefined : codexModelUnverifiedDiagnostic(meta.modelOverride, catalog2.ok ? undefined : catalog2.message);
      }
      return codexPinRefusal("chatgpt", discovered, meta.modelOverride, this.evidence);
    }
    const catalog = await this.models();
    const runtimeDefault = (catalog as any).runtimeDefault;
    if (!runtimeDefault) return catalog.ok ? codexRouteDiagnostic("chatgpt") : `VideoClaw could not confirm which model Codex would use. ${catalog.message}`;
    if (!runtimeDefault.selectable) return runtimeDefault.reason;
    return intent === "pick" || runtimeDefault.defaultEligible ? undefined : (runtimeDefault.note ?? codexRouteDiagnostic("chatgpt"));
  }

  async modelForSession(meta: CodexMetaLike): Promise<{ model: CodexModel } | { refusal: string }> { // L51711
    const catalog = await this.models();
    if (!catalog.ok) {
      if (catalog.reason === "capacity") throw new CodexProcessCapacityError(catalog.message);
      return { refusal: `VideoClaw could not confirm this video's reasoning effort. ${catalog.message}` };
    }
    const modelId = meta.modelOverride ?? catalog.runtimeDefault.modelId;
    const model = modelId ? catalog.models.find((entry) => entry.id === modelId) : undefined;
    if (!model) return { refusal: `Codex no longer describes ${modelId ?? "the model for this video"}, so VideoClaw cannot confirm its reasoning effort (#108).` };
    return { model };
  }

  async resolveDefaultModel(intent: "turn" | "pick"): Promise<{ model: string } | { refusal: string }> { // L51818
    const catalog = await this.models();
    const runtimeDefault = (catalog as any).runtimeDefault;
    if (!runtimeDefault) return { refusal: catalog.ok ? codexRouteDiagnostic("chatgpt") : `VideoClaw could not confirm which model Codex would use. ${catalog.message}` };
    if (!runtimeDefault.selectable) return { refusal: runtimeDefault.reason };
    return intent === "pick" || runtimeDefault.defaultEligible ? { model: runtimeDefault.modelId } : { refusal: runtimeDefault.note ?? codexRouteDiagnostic("chatgpt") };
  }

  async pinModel(meta: CodexMetaLike): Promise<{ model: string } | { refusal: string }> { // L51852
    if (meta.modelOverride) return { model: meta.modelOverride };
    const resolved = await this.resolveDefaultModel("turn");
    if ("refusal" in resolved) return resolved;
    meta.modelOverride = resolved.model;
    this.d.persist(); this.d.sessionsChanged();
    return resolved;
  }

  async pinReasoningEffort(meta: CodexMetaLike): Promise<{ effort: string } | { refusal: string }> { // L51876
    const resolved = await this.modelForSession(meta);
    if ("refusal" in resolved) return resolved;
    const pin = resolveCodexReasoningEffort(meta.codexProvider ?? DEFAULT_CODEX_PROVIDER, resolved.model, meta.codexReasoningEffort);
    if (!pin.ok) return { refusal: String(pin.reason) };
    if (pin.baseline && meta.codexReasoningEffort !== pin.effort) {
      meta.codexReasoningEffort = pin.effort;
      this.d.persist(); this.d.sessionsChanged();
    }
    return { effort: String(pin.effort) };
  }

  /** deliver L42003-42030: the turn-boundary checks (catalog capacity, route refusal, model pin, effort pin). */
  async turnRefusal(meta: CodexMetaLike): Promise<string | undefined> {
    if ((meta.codexProvider ?? DEFAULT_CODEX_PROVIDER) === "chatgpt") {
      const catalog = await this.models();
      if (!catalog.ok && catalog.reason === "capacity") throw new CodexProcessCapacityError(catalog.message);
    }
    const refusal = await this.routeRefusal(meta);
    if (refusal) return refusal;
    const modelPin = await this.pinModel(meta);
    if ("refusal" in modelPin) return modelPin.refusal;
    const pin = await this.pinReasoningEffort(meta);
    if ("refusal" in pin) return pin.refusal;
    return undefined;
  }

  /** setSessionModel L40895 (codex half): validates, resolves the alias, returns the exact id to persist. */
  async pickModel(meta: CodexMetaLike, model: string | undefined): Promise<string | undefined> {
    let selected = model || undefined;
    const intent = selected && selected === meta.modelOverride ? "turn" : "pick";
    const refusal = await this.routeRefusal({ agentHarness: "codex-app-server", codexProvider: meta.codexProvider, modelOverride: selected }, intent);
    if (refusal) throw new Error(refusal);
    if (!selected) {
      const resolved = await this.resolveDefaultModel("pick");
      if ("refusal" in resolved) throw new Error(resolved.refusal);
      selected = resolved.model;
    }
    return selected;
  }

  /** setSessionReasoningEffort L51735 (codex half): throws on an unsupported depth. */
  async checkEffort(meta: CodexMetaLike, wanted: string | undefined): Promise<void> {
    if (!wanted) return;
    const resolved = await this.modelForSession(meta);
    if ("refusal" in resolved) throw new Error(resolved.refusal);
    if (!resolved.model.supportedReasoningEfforts.some((o) => o.effort === wanted)) throw new Error(codexEffortDiagnostic(resolved.model.id, wanted));
  }

  /** agentProviderKeyStatus L60359: the keyed Codex providers. openai-api is the MiniMax backend here
   *  (configured = MINIMAX_API_KEY present); OpenRouter has no key in this build. */
  providerKeyStatus(): { openaiApi: { configured: boolean }; openrouter: { configured: boolean } } {
    return { openaiApi: { configured: !!this.d.provider() }, openrouter: { configured: false } };
  }
}

/** classifyCodexFailure L53824 (verbatim). */
export function classifyCodexFailure(error: unknown): { reason: string; recovery: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/Unsupported Codex app-server protocol/i.test(raw)) {
    return { reason: "unsupported-version", recovery: `This Mac has a Codex runtime VideoClaw does not support. VideoClaw requires ${SUPPORTED_CODEX_VERSION}.` };
  }
  if (/ENOENT|not found|could not start|is unavailable|Reinstall VideoClaw/i.test(raw)) {
    return { reason: "missing", recovery: "The Codex runtime is not installed for this build." };
  }
  return { reason: "start-failed", recovery: `Codex could not start: ${redactDiagnostic(raw).slice(0, 200)}` };
}
