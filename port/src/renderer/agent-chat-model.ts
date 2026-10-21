// PORT-NEW (docs/19 §4): pure reducer for the minimal agent chat surface — folds the ORIGINAL
// session:event payloads ({sessionId, event}, main/index.js L61049; kinds from AgentHost.reduce
// L50416) into a transcript. DOM-free so it is unit-tested (test/agent-host.test.ts).
export type ChatItem =
  | { type: "user"; text: string }
  | { type: "assistant"; messageId: string; text: string; final: boolean }
  | { type: "tool"; toolUseId: string; name: string; summary: string; detail: string; state: "running" | "ok" | "error" | "cancelled" | "abandoned" }
  | { type: "notice"; tone: "error" | "info" | "stop"; text: string };
export interface ChatState { sessionId?: string; status: string; items: ChatItem[]; runtime?: string; lastResult?: { isError: boolean; durationMs: number; stopped: boolean } }
export const initialChat = (): ChatState => ({ status: "idle", items: [] });

export function reduceChat(st: ChatState, payload: { sessionId?: string; event?: any }): ChatState {
  if (!payload || payload.sessionId !== st.sessionId || !payload.event) return st;
  const e = payload.event;
  const items = st.items.slice();
  const assistant = (id: string) => items.findIndex((i) => i.type === "assistant" && i.messageId === id);
  switch (e.kind) {
    case "status": return { ...st, status: String(e.status) };
    case "text_delta": {
      const id = String(e.messageId ?? "m");
      const i = assistant(id);
      if (i < 0) items.push({ type: "assistant", messageId: id, text: String(e.text ?? ""), final: false });
      else { const a = items[i] as Extract<ChatItem, { type: "assistant" }>; items[i] = { ...a, text: a.text + String(e.text ?? "") }; }
      return { ...st, items };
    }
    case "assistant_text": {
      // the complete block replaces what the deltas streamed (one bubble per message id)
      const id = String(e.messageId ?? "m");
      const i = assistant(id);
      const blk = { type: "assistant" as const, messageId: id, text: String(e.text ?? ""), final: true };
      if (i < 0) items.push(blk);
      else {
        const a = items[i] as Extract<ChatItem, { type: "assistant" }>;
        // several text blocks in one message: keep earlier finished blocks
        items[i] = a.final && !a.text.endsWith(blk.text) ? { ...blk, text: a.text + "\n" + blk.text } : blk;
      }
      return { ...st, items };
    }
    case "tool_start": items.push({ type: "tool", toolUseId: String(e.toolUseId), name: String(e.toolName), summary: String(e.summary ?? e.toolName), detail: String(e.detail ?? ""), state: "running" }); return { ...st, items };
    case "tool_end": {
      const i = items.findIndex((x) => x.type === "tool" && x.toolUseId === e.toolUseId);
      if (i >= 0) items[i] = { ...(items[i] as Extract<ChatItem, { type: "tool" }>), state: e.terminal ?? (e.isError ? "error" : "ok") };
      return { ...st, items };
    }
    case "result": {
      const stopped = e.stoppedAfterMs !== undefined;
      if (stopped) items.push({ type: "notice", tone: "stop", text: `Stopped after ${(Number(e.stoppedAfterMs) / 1000).toFixed(1)} s` });
      return { ...st, items, lastResult: { isError: !!e.isError, durationMs: Number(e.durationMs ?? 0), stopped } };
    }
    case "error": items.push({ type: "notice", tone: "error", text: String(e.message ?? "error") }); return { ...st, items };
    case "port_runtime": return { ...st, runtime: e.phase === "closed" ? `closed (${e.reason ?? ""})` : `${e.llmRoute}${e.model ? " · " + e.model : ""}${e.gateProxy ? " · gate proxy" : ""}${e.claudeCodeVersion ? " · Claude Code " + e.claudeCodeVersion : ""}` };
    default: return st;
  }
}
export function addUserTurn(st: ChatState, text: string): ChatState { return { ...st, items: [...st.items, { type: "user", text }] }; }
