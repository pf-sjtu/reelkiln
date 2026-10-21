// docs/27: the Codex-route IPC channels on the real backend (original registrations L61609-61670,
// L61784-61789), served by the port AgentHost + CodexRouteController (MiniMax backend).
import type { AgentHost } from "../agent/agent-host";

const unavailable = "Codex is unavailable right now.";
export function codexChannels(host: AgentHost): Record<string, (...args: any[]) => unknown> {
  const c = host.codex;
  return {
    "engine:codexStatus": () => (c ? c.status() : { available: false, authenticated: false, recovery: unavailable }), // L61609
    "engine:codexModels": () => (c ? c.models(true) : { ok: false, reason: "unavailable", message: unavailable }), // L61620
    "engine:agentProviderKeyStatus": () => (c ? c.providerKeyStatus() : { openaiApi: { configured: false }, openrouter: { configured: false } }), // L61660
    "session:setModel": (sessionId: unknown, model: unknown) => host.setSessionModel(String(sessionId), model), // L61784
    "session:setReasoningEffort": (sessionId: unknown, effort: unknown) => host.setSessionReasoningEffort(String(sessionId), effort), // L61787
    // codexDisconnectImpact L52416 (verbatim count)
    "engine:codexDisconnectImpact": () => ({ runningVideos: host.codexRunningVideoCount() }),
    // PORT-NEW substitutes (docs/27 §6): there is no ChatGPT account behind this build's Codex — it runs on
    // MiniMax (env key). Connect reports the live status without opening any OpenAI sign-in; there is never
    // a pending browser login to cancel; disconnect retires the Codex runtimes and explains how the account
    // is actually removed (unset MINIMAX_API_KEY), reporting ok:false honestly.
    "engine:codexConnectChatGpt": async () => (c ? c.status() : { available: false, authenticated: false, recovery: unavailable }),
    "engine:codexConnectCancel": async () => undefined,
    "engine:codexDisconnectChatGpt": async () => {
      const stoppedVideos = host.retireCodexRuntimes();
      c?.invalidateCatalog();
      const status = c ? await c.status() : { available: false, authenticated: false, recovery: unavailable };
      return { ok: false, stoppedVideos, status, error: "Codex in this build runs on MiniMax, not a ChatGPT sign-in. Remove MINIMAX_API_KEY from the environment to disconnect it." };
    },
    // docs/28: the Claude Code login channels (L61603-61607) — the original bodies over claude-code.ts, whose
    // login probe / login child are the PORT "never a real Claude subscription" seams.
    "engine:claudeCodeStatus": () => host.claude.status(),
    "engine:claudeCodeConnect": () => host.claude.connect(),
    "engine:claudeCodeConnectCancel": () => { host.claude.cancelConnect(); },
    "engine:claudeCodeSignOutImpact": () => host.claude.signOutImpact(),
    "engine:claudeCodeSignOut": () => host.claude.signOutClaudeCode(),
    // docs/28: claudeModels L61659 → host.claudeModels(true) (MiniMax model source)
    "engine:claudeModels": () => host.claude.models(true),
    // docs/28: codexHandoffOffer / continueOnCodex L61660-61663
    "engine:codexHandoffOffer": (sessionId: unknown) => host.codexHandoffOffer(String(sessionId ?? "")),
    "engine:continueOnCodex": (sessionId: unknown, clientActionId: unknown) => host.continueOnCodex(String(sessionId ?? ""), String(clientActionId ?? "")),
  };
}
