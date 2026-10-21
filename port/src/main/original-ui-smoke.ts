// PORT-NEW headless drivers for the ORIGINAL renderer (docs/21). Not in the original app.
//   VIDEOCLAW_PORT_SMOKE_HOME=1   wait for the original home ("What are we making today?"), collect
//                                 DOM facts + renderer errors; index.ts writes the screenshot.
//   VIDEOCLAW_PORT_SMOKE_S1=<file> read a brief, then through window.videoclaw (preload → real IPC):
//                                 createSession → sendMessage(brief) → wait for the turn's result,
//                                 answering permission cards with the env-selected behaviour
//                                 (VIDEOCLAW_PORT_SMOKE_PERMISSION=allow|deny, default allow =
//                                 a user clicking Allow), recording every pushed event.
export function homeSmokeScript(o: { timeoutMs: number }): string {
  return `(async () => {
    const t0 = Date.now(); const errors = window.__vcErrors || [];
    const text = () => document.body ? document.body.innerText : "";
    while (Date.now() - t0 < ${o.timeoutMs}) {
      if (/What are we making today\\?/.test(text())) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 800));
    const body = text();
    const has = (re) => re.test(body);
    const checks = {
      home: has(/What are we making today\\?/),
      newVideo: has(/New video/),
      noSignInGate: !has(/Welcome to Videoclaw/),
      composer: !!document.querySelector("textarea, [contenteditable=true]"),
      projectsPersonal: has(/Personal/),
    };
    const api = window.videoclaw;
    const account = await api.accountSnapshot().catch((e) => ({ error: String(e) }));
    const status = await api.bootstrapStatus().catch((e) => ({ error: String(e) }));
    const clients = await api.listClients().catch((e) => ({ error: String(e) }));
    return { ok: Object.values(checks).every(Boolean) && errors.length === 0, ms: Date.now() - t0, checks, errors, account: { step: account.step, legacyKeyOnly: account.legacyKeyOnly, signedIn: account.signedIn, portLocalStudio: account.portLocalStudio }, bootstrap: { ready: status.ready, engineVersion: status.engineVersion, shouldOffer: status.shouldOffer, devMode: status.devMode }, clients, textHead: body.slice(0, 600) };
  })()`;
}

export function s1SmokeScript(o: { brief: string; timeoutMs: number; permission: "allow" | "deny"; permissionMode?: string; llmRoute?: string }): string {
  return `(async () => {
    const api = window.videoclaw; const events = []; const t0 = Date.now(); let sid; let done = null;
    const offE = api.onSessionEvent((p) => { if (!sid || p.sessionId !== sid) { if (!sid) events.push({ t: Date.now() - t0, early: true, ...p }); return; } events.push({ t: Date.now() - t0, event: p.event }); const k = p.event && p.event.kind; if (k === "result" || (k === "status" && p.event.status === "error")) done = done || p.event; });
    const offP = api.onPermissionRequest((req) => { events.push({ t: Date.now() - t0, permissionRequest: { requestId: req.requestId, kind: req.kind, toolName: req.toolName, title: req.title, reason: req.decisionReason, command: req.input && req.input.command ? String(req.input.command).slice(0, 300) : undefined } }); api.respondPermission(req.requestId, ${o.permission === "allow" ? `{ behavior: "allow" }` : `{ behavior: "deny", message: "Declined by smoke" }`}); });
    ${o.llmRoute ? `await api.setSettings({ llmRoute: ${JSON.stringify(o.llmRoute)} });` : ""}
    const meta = await api.createSession(${o.permissionMode ? `{ permissionMode: ${JSON.stringify(o.permissionMode)} }` : "{}"});
    sid = meta.sessionId;
    const sent = await api.sendMessage(sid, { text: ${JSON.stringify(o.brief)}, clientTurnId: "s1-" + Date.now() });
    while (!done && Date.now() - t0 < ${o.timeoutMs}) await new Promise((r) => setTimeout(r, 500));
    // let trailing events (status idle) land
    await new Promise((r) => setTimeout(r, 1500));
    offE && offE(); offP && offP();
    const list = await api.listSessions();
    const row = list.find((s) => s.sessionId === sid) || null;
    return { ok: !!done && !done.isError && done.kind === "result", sessionId: sid, sent, final: done, timedOut: !done, session: row && { sessionId: row.sessionId, jobId: row.jobId, status: row.status, cwd: row.cwd, permissionMode: row.permissionMode, llmRoute: row.llmRoute, title: row.title }, events };
  })()`;
}

/** VIDEOCLAW_PORT_SMOKE_RELOAD=1: after a restart, the persisted sessions are listed again. */
export function reloadSmokeScript(): string {
  return `(async () => { const list = await window.videoclaw.listSessions(); return { ok: list.length > 0, sessions: list.map((s) => ({ sessionId: s.sessionId, jobId: s.jobId, status: s.status, title: s.title, cwd: s.cwd, interruptedFromStatus: s.interruptedFromStatus })) }; })()`;
}
