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

export interface S1SmokeOptions {
  brief: string; timeoutMs: number; permission: "allow" | "deny"; permissionMode?: string; llmRoute?: string;
  /** docs/22 M4 (S1-L2): attach through intake:pickFiles (dialog answered by VIDEOCLAW_PORT_SMOKE_PICK_FILES)
   *  → attachment:stage → wait for attachment:changed ready → Send with attachmentIds. */
  attach?: boolean;
  /** docs/22 M3: after the turn, wait for job:snapshot v1, play it over vcmedia:// in a <video>, approve it,
   *  stop the original taste-capture follow-up turn (bounded spend), export it with file:saveItemAs. */
  m3?: boolean;
  /** let the taste-capture follow-up run instead of stopping it (default: stop after it starts). */
  keepTasteTurn?: boolean;
  /** run only the M3 part against an already-bound session (no create/send; $0 dry run). */
  existingSession?: string;
}
export function s1SmokeScript(o: S1SmokeOptions): string {
  return `(async () => {
    const api = window.videoclaw; const events = []; const t0 = Date.now(); let sid; let done = null; const snaps = []; const atts = {};
    const offE = api.onSessionEvent((p) => { if (!sid || p.sessionId !== sid) { if (!sid) events.push({ t: Date.now() - t0, early: true, ...p }); return; } events.push({ t: Date.now() - t0, event: p.event }); const k = p.event && p.event.kind; if (k === "result" || (k === "status" && p.event.status === "error")) done = done || p.event; });
    const offP = api.onPermissionRequest((req) => { events.push({ t: Date.now() - t0, permissionRequest: { requestId: req.requestId, kind: req.kind, toolName: req.toolName, title: req.title, reason: req.decisionReason, command: req.input && req.input.command ? String(req.input.command).slice(0, 300) : undefined } }); api.respondPermission(req.requestId, ${o.permission === "allow" ? `{ behavior: "allow" }` : `{ behavior: "deny", message: "Declined by smoke" }`}); });
    const offS = api.onJobSnapshot ? api.onJobSnapshot((p) => { if (p && p.sessionId === sid) snaps.push({ t: Date.now() - t0, versions: (p.snapshot.versions || []).map((v) => ({ n: v.n, path: v.path, approved: v.approved })), renders: (p.snapshot.renders || []).filter((r) => r.isCandidate).map((r) => ({ path: r.path, versionN: r.versionN })) }); }) : null;
    const offA = api.onAttachmentChanged ? api.onAttachmentChanged((a) => { atts[a.id] = { name: a.name, status: a.status, error: a.error }; }) : null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    ${o.llmRoute ? `await api.setSettings({ llmRoute: ${JSON.stringify(o.llmRoute)} });` : ""}
    ${o.existingSession ? `sid = ${JSON.stringify(o.existingSession)}; done = { kind: "result", isError: false, existingSession: true };` : `const meta = await api.createSession(${o.permissionMode ? `{ permissionMode: ${JSON.stringify(o.permissionMode)} }` : "{}"});
    sid = meta.sessionId;`}
    let attachment = null; let attachmentIds = [];
    ${o.attach ? `
    const picked = await api.intakePickFiles({ kind: "composer", sessionId: sid });
    const staged = await api.attachmentStage({ sessionId: sid, destination: "video", files: picked.files });
    attachmentIds = staged.filter((a) => a.status !== "failed").map((a) => a.id);
    const ta = Date.now();
    let list = [];
    while (Date.now() - ta < 60000) { list = await api.attachmentList(sid); if (list.length && list.every((a) => a.status === "ready" || a.status === "failed")) break; await sleep(200); }
    attachment = { picked: picked.files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes })), staged: staged.map((a) => ({ id: a.id, name: a.name, status: a.status })), settled: list.map((a) => ({ id: a.id, name: a.name, status: a.status, destination: a.destination, error: a.error })), pushed: atts, settleMs: Date.now() - ta };
    attachmentIds = list.filter((a) => a.status === "ready").map((a) => a.id);` : ""}
    const sent = done ? null : await api.sendMessage(sid, { text: ${JSON.stringify(o.brief)}, clientTurnId: "s1-" + Date.now(), ...(attachmentIds.length ? { attachmentIds } : {}) });
    while (!done && Date.now() - t0 < ${o.timeoutMs}) await sleep(500);
    const turnMs = Date.now() - t0;
    // let trailing events (status idle) land
    await sleep(1500);
    let m3 = null;
    ${o.m3 ? `
    if (done && !done.isError) {
      m3 = {};
      const tj = Date.now(); let snap = null;
      while (Date.now() - tj < 90000) { snap = await api.getJobSnapshot(sid); if (snap && snap.versions && snap.versions.length) break; await sleep(1000); }
      m3.snapshot = snap && { jobId: snap.jobId, versions: snap.versions.map((v) => ({ n: v.n, path: v.path, approved: v.approved, sizeBytes: v.sizeBytes })), candidates: snap.renders.filter((r) => r.isCandidate).map((r) => ({ path: r.path, versionN: r.versionN })), waitedMs: Date.now() - tj };
      const v1 = snap && snap.versions.find((v) => v.n === 1);
      if (v1) {
        // the original player: <video src="vcmedia://local<abs path>"> (renderer mediaUrl())
        const src = "vcmedia://local" + v1.path.split("/").map(encodeURIComponent).join("/");
        const head = await fetch(src, { headers: { Range: "bytes=0-1023" } }).then(async (r) => ({ status: r.status, contentRange: r.headers.get("content-range"), type: r.headers.get("content-type"), state: r.headers.get("x-videoclaw-media-state"), bytes: (await r.arrayBuffer()).byteLength })).catch((e) => ({ error: String(e) }));
        const play = await new Promise((resolve) => { const v = document.createElement("video"); v.muted = true; v.preload = "auto"; const fin = (why) => resolve({ why, readyState: v.readyState, duration: v.duration, width: v.videoWidth, height: v.videoHeight, error: v.error && v.error.code }); const timer = setTimeout(() => fin("timeout"), 20000); v.addEventListener("canplay", () => { clearTimeout(timer); v.play().then(() => setTimeout(() => fin("playing"), 800)).catch((e) => fin("play-rejected " + e)); }); v.addEventListener("error", () => { clearTimeout(timer); fin("error"); }); v.src = src; document.body.appendChild(v); });
        m3.playback = { src, range: head, video: play };
        await api.approveVersion(sid, 1);
        await sleep(1500);
        const rows = await api.listSessions(); const r1 = rows.find((s) => s.sessionId === sid);
        m3.finalizedAtMs = r1 && r1.finalizedAtMs;
        const ttaste = Date.now(); let tasteStarted = false;
        while (Date.now() - ttaste < 15000) { if (events.some((e) => e.t > turnMs && e.event && e.event.kind === "status" && e.event.status === "running")) { tasteStarted = true; break; } await sleep(250); }
        m3.tasteCaptureTurnStarted = tasteStarted;
        ${o.keepTasteTurn ? "" : `if (tasteStarted) { await api.interrupt(sid, "stop").catch(() => {}); m3.tasteCaptureStopped = true; await sleep(1500); }`}
        m3.exported = await api.saveItemAs(v1.path).catch((e) => ({ error: String(e) }));
        const after = await api.getJobSnapshot(sid);
        m3.finalsAfter = after && after.finals && after.finals.map((f) => ({ n: f.n, via: f.via, madeFinalAtMs: f.madeFinalAtMs }));
      }
    }` : ""}
    offE && offE(); offP && offP(); offS && offS(); offA && offA();
    const list = await api.listSessions();
    const row = list.find((s) => s.sessionId === sid) || null;
    return { ok: !!done && !done.isError && done.kind === "result", sessionId: sid, sent, final: done, turnMs, timedOut: !done, attachment, m3, snapshotsPushed: snaps.slice(-5), snapshotPushCount: snaps.length, session: row && { sessionId: row.sessionId, jobId: row.jobId, status: row.status, cwd: row.cwd, permissionMode: row.permissionMode, llmRoute: row.llmRoute, title: row.title, finalizedAtMs: row.finalizedAtMs }, events };
  })()`;
}

/** VIDEOCLAW_PORT_SMOKE_RELOAD=1: after a restart, the persisted sessions are listed again. */
export function reloadSmokeScript(): string {
  return `(async () => { const list = await window.videoclaw.listSessions(); return { ok: list.length > 0, sessions: list.map((s) => ({ sessionId: s.sessionId, jobId: s.jobId, status: s.status, title: s.title, cwd: s.cwd, interruptedFromStatus: s.interruptedFromStatus })) }; })()`;
}
