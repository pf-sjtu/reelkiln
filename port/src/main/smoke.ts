// PORT-NEW headless smoke driver (NOT in the original app). Enabled by VIDEOCLAW_PORT_SMOKE=1.
// Drives the REAL renderer → preload (window.videoclaw) → ipcMain path from inside the page
// via webContents.executeJavaScript, so every call crosses the same IPC boundary the UI uses.
// Optional: VIDEOCLAW_PORT_SMOKE_SESSION + VIDEOCLAW_PORT_SMOKE_JOB select an editorRender job.
// Optional (PORT-NEW, docs/15): VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=<route> → settings:set({llmRoute}) + readiness.
export function smokeScript(o: { runBootstrap: boolean; session?: string; job?: string; renderTimeoutMs: number; llmRoute?: string }): string {
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
    await new Promise((r) => setTimeout(r, 300));
    await rec("renderer:llmRoute selector", () => { const s = document.getElementById("llmRoute"); return s ? { options: [...s.options].map((o) => o.value + (o.disabled ? "(disabled)" : "")), selected: s.value } : null; });
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
