// PORT-NEW (docs/17 §5): IPC surface that does NOT exist in the original app. Kept out of the
// generated, 184-method `window.videoclaw` bridge (faithfulness tests) and exposed separately as
// `window.videoclawPort`. Selecting a route still goes through the ORIGINAL settings:set
// (window.videoclaw.setSettings({ llmRoute })), which validates against the provider registry.
import type { LlmProtocolId, LlmRouteId } from "./llm-types";

export const PORT_IPC = {
  /** () → LlmRoutesView: every selectable LLM route + the current one. */
  llmRoutes: "port:llm:routes",
} as const;
export type PortInvokeChannel = (typeof PORT_IPC)[keyof typeof PORT_IPC];

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

export interface VideoclawPortBridge {
  llmRoutes(): Promise<LlmRoutesView>;
}
declare global {
  interface Window { videoclawPort?: VideoclawPortBridge }
}
