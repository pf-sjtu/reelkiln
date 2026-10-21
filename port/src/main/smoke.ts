// PORT-NEW headless smoke driver (NOT in the original app). Enabled by VIDEOCLAW_PORT_SMOKE=1.
// Drives the REAL renderer → preload (window.videoclaw) → ipcMain path from inside the page
// via webContents.executeJavaScript, so every call crosses the same IPC boundary the UI uses.
// Optional: VIDEOCLAW_PORT_SMOKE_SESSION + VIDEOCLAW_PORT_SMOKE_JOB select an editorRender job.
// Optional (PORT-NEW, docs/15): VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=<route> → settings:set({llmRoute}) + readiness.
// Optional (PORT-NEW, docs/18): VIDEOCLAW_PORT_SMOKE_UI_SELECT=<route> → click that route's radio on the
// Settings page, check settings:get + the port:llm:routesChanged push + the re-rendered page, then click
// the previously active route again (restores the user's choice).
// Optional (PORT-NEW, docs/19): VIDEOCLAW_PORT_SMOKE_AGENT=<prompt> → open the Agent tab, type the prompt,
// click Send, wait for the turn to end; VIDEOCLAW_PORT_SMOKE_AGENT_STOP=<prompt> → then a second turn in
// the same chat, click Stop as soon as output streams, check that it settles idle and stays quiet.
export function smokeScript(o: { runBootstrap: boolean; session?: string; job?: string; renderTimeoutMs: number; llmRoute?: string; uiSelect?: string; agentPrompt?: string; agentStopPrompt?: string }): string {
  return `(async () => {
    const api = window.videoclaw; const out = [];
    const rec = async (name, fn) => { const t0 = Date.now(); try { const v = await fn(); out.push({ name, ok: true, ms: Date.now() - t0, value: v }); return v; } catch (e) { out.push({ name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) }); } };
    out.push({ name: "preload", ok: !!api, value: api ? Object.keys(api).length : 0 });
    await rec("media:voiceDictationStatus", () => api.voiceDictationStatus());
    await rec("session:list", () => api.listSessions());
    await rec("settings:get", () => api.getSettings());
    ${o.llmRoute ? `await rec("settings:set(llmRoute)", () => api.setSettings({ llmRoute: ${JSON.stringify(o.llmRoute)} }));` : ""}
    await rec("engine:llmRouteReadiness", () => api.llmRouteReadiness(undefined));
    await rec("port:llm:routes", () => window.videoclawPort ? window.videoclawPort.llmRoutes() : Promise.reject(new Error("window.videoclawPort missing")));
    await rec("port:diagnostics", () => window.videoclawPort.diagnostics());
    await new Promise((r) => setTimeout(r, 300));
    const pageRows = () => [...document.querySelectorAll("#llmRoutes label.route")].map((l) => { const i = l.querySelector("input"); return { id: l.dataset.route, checked: !!(i && i.checked), disabled: !!(i && i.disabled), badges: [...l.querySelectorAll(".badge")].map((b) => b.textContent) }; });
    const pageSelected = () => (pageRows().find((r) => r.checked) || {}).id;
    await rec("settings-page:llmRoutes", () => { const rows = pageRows(); if (!rows.length) throw new Error("no rows rendered"); return { status: document.getElementById("llmRouteStatus").textContent, rows }; });
    await rec("settings-page:diagnostics", () => [...document.querySelectorAll("#diagnostics dt")].map((dt) => dt.textContent + ": " + dt.nextElementSibling.textContent));
    ${o.uiSelect ? `
    const waitFor = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
    const clickRoute = async (id) => {
      const pushes = []; const off = window.videoclawPort.onLlmRoutesChanged((v) => pushes.push(v.current));
      const input = document.querySelector('#llmRoutes label.route[data-route="' + id + '"] input');
      if (!input) { off(); throw new Error("route row not rendered: " + id); }
      if (input.disabled) { off(); throw new Error("route row disabled: " + id); }
      input.click();
      const rendered = await waitFor(() => pageSelected() === id && pushes.includes(id), 5000);
      off();
      const persisted = (await api.getSettings()).llmRoute;
      if (!rendered || persisted !== id) throw new Error(JSON.stringify({ rendered, persisted, pushes, selected: pageSelected() }));
      return { selected: pageSelected(), persisted, pushes, notice: document.getElementById("llmNotice").textContent };
    };
    const before = pageSelected();
    await rec("settings-page:select(" + ${JSON.stringify(o.uiSelect)} + ")", () => clickRoute(${JSON.stringify(o.uiSelect)}));
    if (before && before !== ${JSON.stringify(o.uiSelect)}) await rec("settings-page:restore(" + before + ")", () => clickRoute(before));` : ""}
    ${o.agentPrompt ? `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(100); } return false; };
    const chat = window.__videoclawAgentChat;
    const statusOf = () => document.getElementById("agentStatus").dataset.status;
    const uiTurn = async (prompt) => {
      document.getElementById("tab-agent").click();
      const before = chat.eventLog().length;
      document.getElementById("agentInput").value = prompt;
      document.getElementById("agentSend").click();
      const started = await until(() => chat.eventLog().slice(before).some((e) => e.kind === "status") && statusOf() === "running", 60000);
      return { before, started };
    };
    const transcript = () => [...document.querySelectorAll("#agentTranscript .msg")].map((d) => ({ cls: d.className, text: d.textContent.slice(0, 400) }));
    await rec("agent-ui:turn", async () => {
      const { before, started } = await uiTurn(${JSON.stringify(o.agentPrompt)});
      const ended = await until(() => statusOf() !== "running" && chat.eventLog().slice(before).some((e) => e.kind === "result" || e.kind === "error"), 280000);
      const ev = chat.eventLog().slice(before);
      const kinds = {}; for (const e of ev) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
      const st = chat.state();
      const ok = started && ended && st.status === "idle" && !!kinds.text_delta && !!kinds.assistant_text && st.lastResult && !st.lastResult.isError;
      if (!ok) throw new Error(JSON.stringify({ started, ended, status: st.status, kinds, notice: document.getElementById("agentNotice").textContent, transcript: transcript() }).slice(0, 1400));
      return { sessionId: st.sessionId, runtime: st.runtime, kinds, tools: st.items.filter((i) => i.type === "tool").map((i) => i.name + ":" + i.state), transcript: transcript() };
    });
    ${o.agentStopPrompt ? `
    await rec("agent-ui:stop", async () => {
      const { before, started } = await uiTurn(${JSON.stringify(o.agentStopPrompt)});
      const streaming = await until(() => chat.eventLog().slice(before).some((e) => e.kind === "text_delta" || e.kind === "tool_start"), 120000);
      const clickedAt = Date.now();
      document.getElementById("agentStop").click();
      const settled = await until(() => statusOf() === "idle", 15000);
      const settleMs = Date.now() - clickedAt;
      const atStop = chat.eventLog().length;
      await sleep(4000);
      const after = chat.eventLog().slice(atStop).filter((e) => e.kind === "text_delta" || e.kind === "assistant_text" || e.kind === "tool_start");
      const st = chat.state();
      const ok = started && streaming && settled && st.lastResult && st.lastResult.stopped && after.length === 0 && document.getElementById("agentStop").disabled;
      const value = { started, streaming, settled, settleMs, stoppedResult: st.lastResult, outputAfterStop: after.length, status: st.status, transcriptTail: transcript().slice(-3) };
      if (!ok) throw new Error(JSON.stringify(value).slice(0, 1400));
      return value;
    });` : ""}` : ""}
    ${o.runBootstrap ? `await rec("bootstrap:run", () => api.bootstrapRun());` : ""}
    ${o.session && o.job ? `
    const events = [];
    const done = new Promise((resolve) => {
      api.onEditorRenderEvent((ev) => { events.push(ev); if (ev.kind === "completed" || ev.kind === "failed" || (ev.kind === "phase" && (ev.phase === "cancelled"))) resolve(ev); });
      setTimeout(() => resolve({ kind: "timeout" }), ${o.renderTimeoutMs});
    });
    await rec("editorRender:start(bad job)", () => api.editorRenderStart({ requestId: "smoke-0", sessionId: ${JSON.stringify(o.session)}, jobId: "no-such-job" }));
    const started = await rec("editorRender:start", () => api.editorRenderStart({ requestId: "smoke-1", sessionId: ${JSON.stringify(o.session)}, jobId: ${JSON.stringify(o.job)} }));
    await rec("editorRender:state(running)", () => api.editorRenderState());
    if (started && started.accepted) { const last = await done; out.push({ name: "editorRender:event(terminal)", ok: last.kind === "completed", value: last }); }
    out.push({ name: "editorRender:events", ok: true, value: events.map((e) => e.kind === "phase" ? "phase:" + e.phase : e.kind) });
    await rec("editorRender:state(after)", () => api.editorRenderState());` : ""}
    return out;
  })()`;
}
