// PORT-NEW (docs/17 §5): IPC surface that does NOT exist in the original app. Kept out of the
// generated, 184-method `window.videoclaw` bridge (faithfulness tests) and exposed separately as
// `window.videoclawPort`. Selecting a route still goes through the ORIGINAL settings:set
// (window.videoclaw.setSettings({ llmRoute })), which validates against the provider registry.
import type { LlmProtocolId, LlmRouteId } from "./llm-types";

export const PORT_IPC = {
  /** () → LlmRoutesView: every selectable LLM route + the current one. */
  llmRoutes: "port:llm:routes",
  /** () → PortDiagnostics: packaged-app self check (docs/18): SDK discovery, node:sqlite, paths. */
  diagnostics: "port:diagnostics",
} as const;
export type PortInvokeChannel = (typeof PORT_IPC)[keyof typeof PORT_IPC];
/** PORT-NEW push channels (main → renderer). */
export const PORT_PUSH = {
  /** (view: LlmRoutesView) — effective route changed (settings:set) or the providers file was
   *  (re)loaded (hot reload / SIGHUP: providers added/removed, configError set/cleared). */
  llmRoutesChanged: "port:llm:routesChanged",
} as const;
export type PortPushChannel = (typeof PORT_PUSH)[keyof typeof PORT_PUSH];

export interface LlmRouteOption {
  id: LlmRouteId;
  kind: "builtin" | "provider";
  label: string;
  /** provider routes only */
  protocol?: LlmProtocolId;
  model?: string;
  /** Name of the env var holding the key (never the key). */
  keyEnv?: string;
  /** Key env var is set (provider routes); undefined for built-ins (readiness is per route, see llmRouteReadiness). */
  keyPresent?: boolean;
  /** Can run the Claude Agent SDK session path (anthropic-messages + key present). */
  agentCapable?: boolean;
  /** Can serve helper calls (any protocol + key present). */
  helperCapable?: boolean;
  /** docs/17 structured-output mode used for helper calls. */
  structuredOutput?: "native" | "tool" | "off";
  /** Built-in preset (e.g. minimax) vs. user providers file. */
  preset?: boolean;
  /** Why the route cannot be selected/used right now (UI hint). */
  problem?: "key-missing" | "protocol-not-agent-capable";
}
export interface LlmRoutesView {
  /** settings.llmRoute after normalisation (what new videos use). */
  current: LlmRouteId;
  routes: LlmRouteOption[];
  /** The providers file failed to load; only presets are listed (message is safe to show). */
  configError?: string;
}

export interface AgentSdkStatus {
  ok: boolean;
  source?: string;
  packageDir?: string;
  version?: string;
  pinned: string;
  matchesPin?: boolean;
  /** native `claude` executable next to the SDK (null = not found) */
  executable?: string | null;
  error?: string;
}
export interface PortDiagnostics {
  app: { version: string; packaged: boolean; resourcesPath: string | null; appPath: string; userData: string; electron?: string; node: string; chrome?: string; platform: string; arch: string };
  sqlite: { ok: boolean; sqliteVersion?: string; error?: string };
  agentSdk: AgentSdkStatus;
}

export interface VideoclawPortBridge {
  llmRoutes(): Promise<LlmRoutesView>;
  diagnostics(): Promise<PortDiagnostics>;
  /** Subscribe to port:llm:routesChanged; returns an unsubscribe function. */
  onLlmRoutesChanged(cb: (view: LlmRoutesView) => void): () => void;
}
declare global {
  interface Window { videoclawPort?: VideoclawPortBridge }
}
