// Main-process LLM route service — the part of AgentHost / createLocalRuntime that decides WHO
// pays for a video's LLM traffic, ported so a registered custom provider (docs/15) is usable end
// to end in the Electron main process:
//   ORIGINAL (differential-tested in test/llm-main-wiring.test.ts):
//     - AgentHost.sessionLlmRoute (L40823), sessionHelperKind (L40838), sessionHelperCreds
//       (L22358 + L40854), sessionModel (L40865), llmRouteReadiness (L51052),
//       createSession's route pin (L38769-38777), setSettings route-change hook (L61680-61688)
//     - createLocalRuntime's SDK child env (L23214-23230 + L23283-23330), incl. the gateway branch,
//       CLAUDEAI_CONNECTORS_OFF (L22736) and CLAUDE_CODE_NO_SELF_STARTING_WORK (L22737)
//     - anthropicClientJobCustomHeaders (chunk workbookContents L149)
//   PORT-NEW: every gateway branch gets a sibling "provider" branch (see llm-route.ts). A video
//   pinned to a provider keeps that provider (like the original's two literals); if the provider is
//   later removed from the config, the video FAILS CLOSED (UNKNOWN_PROVIDER / not ready) instead of
//   silently moving its spend to another payer.
// DEFERRED (not ported, see docs/15 §3.4): the Claude Agent SDK query() spawn itself (the SDK is not a
//   port dependency), AgentHost session lifecycle/teardown, CredentialStore (gateway key vault),
//   the claude-code presence probe. The env/options this service builds are exactly what
//   createLocalRuntime hands to query(); a future AgentHost port passes them through unchanged.
import type { LlmRouteId } from "../../shared/llm-types";
import { LlmProviderError } from "./errors";
import { getLogger, type Logger } from "./logger";
import { anthropicMessages, claudeRouteEnv, claudeSdkBaseEnv, DEFAULT_LLM_ROUTE, resolveHelperCreds, resolvedLlmRoute, type AnthropicOpts, type AnthropicResult, type HelperCreds } from "./llm-route";
import { getProviderRegistry, onProviderRegistryChange, type ProviderRegistry, type ResolvedProvider } from "./provider-registry";

export const CLAUDEAI_CONNECTORS_OFF = { ENABLE_CLAUDEAI_MCP_SERVERS: "0" } as const; // L22736
export const CLAUDE_CODE_NO_SELF_STARTING_WORK = { CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CODE_DISABLE_WORKFLOWS: "1" } as const; // L22737
export const CLAUDE_AGENT_SDK_CLIENT_APP = "videoclaw-app/0.0.1"; // L23286

const ANTHROPIC_CLIENT_JOB_HEADER = "X-VideoClaw-Client-Job"; // chunk L145
const CLIENT_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function anthropicClientJobCustomHeaders(clientJob: unknown): string | undefined { // chunk L149
  return typeof clientJob === "string" && CLIENT_JOB_ID_RE.test(clientJob) ? `${ANTHROPIC_CLIENT_JOB_HEADER}: ${clientJob}` : undefined;
}

export interface SessionMetaLike { runtime?: "local" | "remote" | string; llmRoute?: unknown; agentHarness?: string; modelOverride?: string; jobId?: string }
/** settings() as AgentHost sees it: public settings + the resolved gateway key (vault not ported). */
export type RouteSettings = { llmRoute?: unknown; agentHarness?: unknown; gatewayUrl: string; gatewayKey?: string; [k: string]: unknown };
export type HelperKind = "codex" | "claude-gateway" | "claude-code" | "claude-provider";

export interface LocalRuntimeEnvInput {
  gateway: { llmRoute: LlmRouteId; gatewayKey?: string; gatewayUrl?: string; clientJob?: string };
  engineEnv?: Record<string, string>;
  sessionContext?: { assembled?: boolean };
  tenant?: string;
  profileDir: string;
}

const isPinnedProviderShape = (v: unknown): v is string => typeof v === "string" && v !== "claude-code" && v !== "gateway" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);

export interface LlmRouteServiceDeps {
  settings: () => RouteSettings;
  registry?: () => ProviderRegistry;
  /** UNSANITIZED env provider keys are read from (default process.env). */
  env?: () => NodeJS.ProcessEnv;
  /** userData/engine-profile (AgentHost.engineProfileDir L52521). */
  profileDir: () => string;
  /** AgentHost.claudeCodeAvailable — NOT PORTED; when absent readiness for claude-code is unknown. */
  claudeCodeAvailable?: () => Promise<boolean>;
  logger?: Logger;
}

export class LlmRouteService {
  private readonly log: Logger;
  private readonly routeListeners = new Set<(route: LlmRouteId) => void>();
  constructor(private readonly d: LlmRouteServiceDeps) { this.log = (d.logger ?? getLogger()).child({ component: "llm-route" }); }
  private registry(): ProviderRegistry { return (this.d.registry ?? getProviderRegistry)(); }
  private env(): NodeJS.ProcessEnv { return (this.d.env ?? (() => process.env))(); }

  /** Global route (L320 + providers). */
  resolvedRoute(): LlmRouteId { return resolvedLlmRoute(this.d.settings(), this.registry()); }
  /** createSession's pin (L38769-38777) for a claude-code-harness video. */
  newSessionLlmRoute(o: { runtime?: string; agentHarness?: string } = {}): LlmRouteId | undefined {
    if ((o.agentHarness ?? "claude-code") !== "claude-code") return undefined;
    return o.runtime === "remote" ? "gateway" : this.resolvedRoute();
  }
  /** L40823. PORT-NEW: a pinned provider name is honoured even if currently unregistered (fail closed). */
  sessionLlmRoute(meta: SessionMetaLike): LlmRouteId {
    if ((meta.runtime ?? "local") === "remote") return "gateway";
    if (meta.llmRoute === "claude-code" || meta.llmRoute === "gateway") return meta.llmRoute;
    if (isPinnedProviderShape(meta.llmRoute)) return meta.llmRoute;
    return this.resolvedRoute();
  }
  /** L40838 + "claude-provider". */
  sessionHelperKind(meta: SessionMetaLike): HelperKind {
    if ((meta.agentHarness ?? "claude-code") === "codex-app-server") return "codex";
    const r = this.sessionLlmRoute(meta);
    return r === "gateway" ? "claude-gateway" : r === "claude-code" ? "claude-code" : "claude-provider";
  }
  /** sessionHelperCreds (L22358/L40854): spend caused by one video follows that video's payer.
   *  PORT-NEW: provider videos get their provider's creds (null when unregistered / key missing). */
  sessionHelperCreds(meta: SessionMetaLike | undefined): HelperCreds | null {
    if (!meta) return null;
    const kind = this.sessionHelperKind(meta);
    const cfg = this.d.settings();
    if (kind === "claude-gateway") return resolveHelperCreds({ ...cfg, llmRoute: "gateway" }, this.env(), this.registry());
    if (kind !== "claude-provider") return null;
    const route = this.sessionLlmRoute(meta);
    if (!this.registry().has(route)) return null;
    return resolveHelperCreds({ ...cfg, llmRoute: route }, this.env(), this.registry());
  }
  /** Helper call (proposeSessionTitle, Conductor judge …) on behalf of one video. */
  async sessionHelperComplete(meta: SessionMetaLike | undefined, body: Record<string, unknown>, opts: AnthropicOpts): Promise<AnthropicResult> {
    const creds = this.sessionHelperCreds(meta);
    if (!creds) return { ok: false, reason: "no helper credentials for this video's LLM route", code: "NO_CREDENTIALS" };
    return anthropicMessages(creds, body, opts);
  }
  /** L40865. PORT-NEW: provider routes default to the provider's model (its aliases cover opus/sonnet/haiku). */
  sessionModel(meta: SessionMetaLike): string | undefined {
    if ((meta.agentHarness ?? "claude-code") === "codex-app-server") return meta.modelOverride;
    if (meta.modelOverride) return meta.modelOverride;
    if (meta.runtime === "remote") return "sonnet";
    const r = this.sessionLlmRoute(meta);
    if (r === "gateway") return "sonnet";
    if (r === "claude-code") return undefined;
    return this.provider(r)?.model ?? this.registry().get(r)?.model;
  }
  private provider(route: string): ResolvedProvider | null {
    const reg = this.registry();
    return reg.has(route) ? reg.resolve(route, this.env()) : null;
  }

  /** L51052 + PORT-NEW provider readiness: registered, key present, anthropic-messages protocol. */
  /** undefined = unknown: the claude-code presence probe is not ported (same answer as the fake backend). */
  async llmRouteReadiness(meta?: SessionMetaLike): Promise<Record<string, unknown> | undefined> {
    const route = meta ? this.sessionLlmRoute(meta) : this.resolvedRoute();
    const harness = meta ? (meta.agentHarness ?? "claude-code") : (this.d.settings().agentHarness === "codex-app-server" ? "codex-app-server" : "claude-code");
    if (route !== "claude-code" && route !== "gateway" && harness === "claude-code") {
      const reg = this.registry();
      const cfg = reg.get(route);
      if (!cfg) return { route, ready: false, reason: "provider-unavailable", ...(reg.configError ? { configError: true } : {}) };
      if (!this.provider(route)) return { route, ready: false, reason: "provider-key-missing", keyEnv: cfg.apiKeyEnv };
      if (cfg.protocol !== "anthropic-messages") return { route, ready: false, reason: "provider-protocol-unsupported", protocol: cfg.protocol };
      return { route, ready: true };
    }
    if (route !== "claude-code" || harness !== "claude-code") return { route, ready: true };
    if (!this.d.claudeCodeAvailable) return undefined;
    return (await this.d.claudeCodeAvailable()) ? { route, ready: true } : { route, ready: false, claudeAuthRequired: true, reason: "signed-out" };
  }

  /** createLocalRuntime's `options.env` (L23214-23230 + L23283-23330), PORT-NEW provider branch.
   *  Throws UNKNOWN_PROVIDER (pinned provider no longer registered), KEY_MISSING, UNSUPPORTED_PROTOCOL. */
  localRuntimeEnv(i: LocalRuntimeEnvInput): Record<string, string> {
    const { gateway } = i;
    const reg = this.registry();
    if (gateway.llmRoute !== "claude-code" && gateway.llmRoute !== "gateway" && !reg.has(gateway.llmRoute)) {
      throw new LlmProviderError("UNKNOWN_PROVIDER", `This video runs on the "${gateway.llmRoute}" provider, which is not configured any more. Restore it in the providers file or choose another LLM route.`, { provider: gateway.llmRoute });
    }
    const customHeaders = gateway.llmRoute === "gateway" ? anthropicClientJobCustomHeaders(gateway.clientJob) : undefined;
    const env = this.env();
    const routeEnv = claudeRouteEnv({ llmRoute: gateway.llmRoute, gatewayKey: gateway.gatewayKey, gatewayUrl: gateway.gatewayUrl, registry: reg, env }, i.profileDir, customHeaders);
    return {
      ...claudeSdkBaseEnv(env),
      ...(i.engineEnv ?? {}),
      CLAUDE_AGENT_SDK_CLIENT_APP,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      ...(i.sessionContext?.assembled ? { VIDEOCLAW_LAWS_VIA_APPEND: "1", VIDEOCLAW_SERVER_ASSEMBLY: "1" } : {}),
      ...(i.tenant ? { VIDEOCLAW_TENANT: i.tenant } : {}),
      ...routeEnv,
      ...CLAUDEAI_CONNECTORS_OFF,
      ...CLAUDE_CODE_NO_SELF_STARTING_WORK,
    };
  }
  /** spawnLocal (L39456-39575) slice: route + model + env for one video, as handed to createLocalRuntime. */
  sessionRuntimeConfig(meta: SessionMetaLike, o: { engineEnv?: Record<string, string>; sessionContext?: { assembled?: boolean }; tenant?: string } = {}): { llmRoute: LlmRouteId; model: string | undefined; env: Record<string, string> } {
    const llmRoute = this.sessionLlmRoute(meta);
    const cfg = this.d.settings();
    const env = this.localRuntimeEnv({ gateway: { llmRoute, gatewayKey: cfg.gatewayKey, gatewayUrl: cfg.gatewayUrl, clientJob: meta.jobId }, engineEnv: o.engineEnv, sessionContext: o.sessionContext, tenant: o.tenant, profileDir: this.d.profileDir() });
    return { llmRoute, model: this.sessionModel(meta), env };
  }

  /** setSettings hook (L61682-61686): fire when the EFFECTIVE global route changes. */
  onRouteChanged(fn: (route: LlmRouteId) => void): () => void { this.routeListeners.add(fn); return () => { this.routeListeners.delete(fn); }; }
  notifyIfRouteChanged(previous: LlmRouteId): boolean {
    const now = this.resolvedRoute();
    if (now === previous) return false;
    this.log.info("llm.route.changed", { from: previous, to: now });
    for (const fn of [...this.routeListeners]) { try { fn(now); } catch (e) { this.log.error("llm.route.listener_failed", { error: e }); } }
    return true;
  }
}

/** Wires the settings store to provider-config reloads: a reload can register/unregister the
 *  provider the user selected, which changes the effective route exactly like a settings change. */
export function bindRegistryReloads(service: LlmRouteService, settings: { revalidateLlmRoute(): boolean }): () => void {
  let previous = service.resolvedRoute();
  const offRoute = service.onRouteChanged((r) => { previous = r; });
  const offReg = onProviderRegistryChange(() => {
    settings.revalidateLlmRoute();
    service.notifyIfRouteChanged(previous);
  });
  return () => { offRoute(); offReg(); };
}
export { DEFAULT_LLM_ROUTE };
