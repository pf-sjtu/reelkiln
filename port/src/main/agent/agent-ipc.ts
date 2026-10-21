// PORT-NEW (docs/19 §3): AgentHost ↔ ORIGINAL IPC contract glue (Electron-free, unit-tested).
//   invoke session:create(req)                     → host.createSession(req)          (original L61690)
//   invoke session:send(sessionId, request)        → host.sendMessage(sessionId, req) (original L61772)
//   invoke session:interrupt(sessionId, reason)    → host.interrupt(sessionId, reason) (original L61780)
//   invoke session:list()                          → sessions.json (read-only registry) + host sessions
//   push   session:event {sessionId, event}        (original emitter L61049)
//   push   session:changed <SessionMeta[]>         (original emit.sessionsChanged(listSessions()))
import type { InvokeChannel } from "../../shared/ipc-contract";
import { DEFAULT_AGENT_TOOLS, type AgentHost, type AgentHostEmit } from "./agent-host";

/** PORT-NEW env var (docs/19): comma-separated tool allow-list for UI agent sessions ("none" = no tools). */
export const PORT_AGENT_TOOLS_ENV = "VIDEOCLAW_PORT_AGENT_TOOLS";
export function agentToolsFromEnv(v: string | undefined): string[] {
  if (v === undefined || !v.trim()) return DEFAULT_AGENT_TOOLS;
  if (v.trim() === "none") return [];
  return v.split(",").map((t) => t.trim()).filter((t) => /^[A-Za-z][A-Za-z0-9_]*$/.test(t));
}

export type Push = (channel: string, ...a: unknown[]) => unknown;
export function agentHostEmit(push: Push, allSessions: () => unknown[]): AgentHostEmit {
  return {
    sessionEvent: (sessionId, event) => { push("session:event", { sessionId, event }); },
    sessionsChanged: () => { push("session:changed", allSessions()); },
  };
}
export function agentIpcHandlers(host: Pick<AgentHost, "createSession" | "sendMessage" | "interrupt">, allSessions: () => unknown[]): Partial<Record<InvokeChannel, (...a: any[]) => unknown>> {
  return {
    "session:create": (req: unknown) => host.createSession((req && typeof req === "object" ? req : {}) as any),
    "session:send": (sessionId: unknown, request: unknown) => host.sendMessage(String(sessionId), request as any),
    "session:interrupt": (sessionId: unknown, reason: unknown) => host.interrupt(String(sessionId), reason === undefined ? undefined : String(reason)),
    "session:list": () => allSessions(),
  };
}
