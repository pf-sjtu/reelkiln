// PORT-NEW (docs/19 §4): minimal agent chat view. Drives the ORIGINAL bridge methods
// window.videoclaw.createSession / sendMessage / interrupt / onSessionEvent (same channels and
// argument shapes as the original renderer: session:create(req), session:send(sessionId,
// {text, attachmentIds, clientTurnId}), session:interrupt(sessionId, "stop")). textContent only.
import { addUserTurn, initialChat, reduceChat, type ChatState } from "./agent-chat-model";

export interface AgentChatHandle { state(): ChatState; eventLog(): any[] }

export function mountAgentChat(root: HTMLElement): AgentChatHandle {
  const api = (window as any).videoclaw;
  const port = (window as any).videoclawPort;
  let st = initialChat();
  const log: any[] = [];
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const input = $<HTMLTextAreaElement>("#agentInput");
  const sendBtn = $<HTMLButtonElement>("#agentSend");
  const stopBtn = $<HTMLButtonElement>("#agentStop");
  const newBtn = $<HTMLButtonElement>("#agentNew");
  const out = $<HTMLElement>("#agentTranscript");
  const statusEl = $<HTMLElement>("#agentStatus");
  const routeEl = $<HTMLElement>("#agentRoute");
  const noticeEl = $<HTMLElement>("#agentNotice");
  let sending = false;

  const render = () => {
    statusEl.textContent = st.sessionId ? `Session ${st.sessionId.slice(0, 8)} · ${st.status}` : "No session yet — Send starts one";
    statusEl.dataset.status = st.status;
    if (st.runtime) routeEl.textContent = `Runtime: ${st.runtime}`;
    sendBtn.disabled = sending || st.status === "running";
    stopBtn.disabled = st.status !== "running";
    out.textContent = "";
    for (const it of st.items) {
      const d = document.createElement("div");
      d.className = `msg ${it.type}` + (it.type === "notice" ? ` ${it.tone}` : it.type === "tool" ? ` ${it.state}` : "");
      if (it.type === "user") d.textContent = `You: ${it.text}`;
      else if (it.type === "assistant") { d.textContent = it.text; d.dataset.final = String(it.final); }
      else if (it.type === "tool") { d.textContent = `⚙ ${it.summary} — ${it.state}`; d.title = it.detail; d.dataset.tool = it.name; }
      else d.textContent = it.text;
      out.appendChild(d);
    }
    out.scrollTop = out.scrollHeight;
  };
  const refreshRoute = async () => {
    try { const v = await port?.llmRoutes(); if (v && !st.runtime) routeEl.textContent = `Route for new chats: ${v.current}`; } catch {}
  };
  api?.onSessionEvent((payload: any) => {
    if (payload?.sessionId !== st.sessionId) return;
    log.push({ t: Date.now(), kind: payload.event?.kind, ...(payload.event?.kind === "text_delta" ? { len: String(payload.event.text ?? "").length } : {}) });
    st = reduceChat(st, payload);
    render();
  });
  port?.onLlmRoutesChanged?.(() => { void refreshRoute(); });

  const send = async () => {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; noticeEl.textContent = ""; render();
    try {
      if (!st.sessionId) {
        const meta = await api.createSession({ title: "Port agent chat" });
        st = { ...initialChat(), sessionId: meta.sessionId };
        routeEl.textContent = `Route: ${meta.llmRoute ?? "?"}`;
      }
      st = addUserTurn(st, text);
      input.value = "";
      render();
      await api.sendMessage(st.sessionId, { text, attachmentIds: [], clientTurnId: `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` });
    } catch (e: any) {
      noticeEl.textContent = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    } finally { sending = false; render(); }
  };
  sendBtn.addEventListener("click", () => { void send(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } });
  stopBtn.addEventListener("click", async () => {
    if (!st.sessionId) return;
    stopBtn.disabled = true;
    try { await api.interrupt(st.sessionId, "stop"); } catch (e: any) { noticeEl.textContent = String(e?.message ?? e); }
    render();
  });
  newBtn.addEventListener("click", () => { st = initialChat(); routeEl.textContent = ""; void refreshRoute(); render(); });
  void refreshRoute();
  render();
  return { state: () => st, eventLog: () => log.slice() };
}
