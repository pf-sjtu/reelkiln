// Videoclaw Windows-port main process — SCAFFOLD.
// Mirrors the original createWindow (out/main/index.js L60537-60560) and the IPC
// registration pattern (trackIpcRequests → ipc.handle / ipc.on for every channel),
// handlers are served by real-backend.ts where ported, else by the fake backend.
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INVOKE_CHANNELS, SEND_CHANNELS, type InvokeChannel } from "../shared/ipc-contract";
import { trackIpcRequests, createRendererEmitter } from "./ipc-tracking";
import { createFakeBackend } from "./fake-backend";
import { createRealHandlers, finishPendingLocalReset, mediaCapabilities, mediaRoots, portHandlers, sendHandlers } from "./real-backend";
import { VCMEDIA_SCHEME } from "./media/media.generated";
import { handleVcmedia } from "./media/media-ipc";
import { smokeScript } from "./smoke";
import { homeSmokeScript, reloadSmokeScript, s1SmokeScript } from "./original-ui-smoke";
import { resolveRendererEntry } from "./renderer-entry";
import { redactText } from "./llm/logger";
// PORT-NEW smoke helper: surface renderer-side exceptions instead of an opaque "Script failed to execute"
const catchingScript = (script: string) => `(async () => { try { return await ${script}; } catch (e) { return { ok: false, error: String((e && e.stack) || e), events: [] }; } })()`;

/** PORT-NEW docs/23 M5: UI-e2e mode — the original renderer is driven from OUTSIDE over the Chrome
 *  DevTools Protocol (port/tools/ui-e2e.mjs); main injects no script. Only the native dialogs are
 *  answered from env (same presets as the smoke) and pushes are logged. Overrides VIDEOCLAW_PORT_SMOKE. */
const UI_E2E = process.env.VIDEOCLAW_PORT_UI_E2E === "1";
const SMOKE = process.env.VIDEOCLAW_PORT_SMOKE === "1" && !UI_E2E; // PORT-NEW
/** PORT-NEW: append every session:event / permission:request push (redacted JSONL) — evidence capture. */
const EVENT_LOG = process.env.VIDEOCLAW_PORT_EVENT_LOG;

// docs/22 M3: original L60356 — vcmedia:// is a privileged, streamable, CSP-bypassing scheme
protocol.registerSchemesAsPrivileged([VCMEDIA_SCHEME as any]);

let win: BrowserWindow | null = null;
const sendToRenderer = createRendererEmitter(() => win);
const log = (m: string) => console.log(m);
const backend = createFakeBackend(sendToRenderer, log);

function registerIpc() {
  const { ipc } = trackIpcRequests(ipcMain);
  const record = (ch: string, a: unknown[]) => {
    if (!EVENT_LOG || !/^(session:event|session:changed|permission:request)$/.test(ch)) return;
    try { appendFileSync(EVENT_LOG, redactText(JSON.stringify({ t: new Date().toISOString(), ch, payload: a[0] })) + "\n"); } catch {}
  };
  const push = SMOKE || EVENT_LOG || UI_E2E
    ? (ch: string, ...a: unknown[]) => { record(ch, a); if (SMOKE || UI_E2E) log(`[smoke] push ${ch} ${JSON.stringify(a).slice(0, 400)}`); return sendToRenderer(ch as any, ...(a as [])); }
    : sendToRenderer;
  const real = createRealHandlers(push as typeof sendToRenderer, log);
  for (const ch of INVOKE_CHANNELS) {
    const h = real[ch as InvokeChannel];
    ipc.handle(ch, (_e: unknown, ...args: unknown[]) => (h ? h(...args) : backend.invoke(ch as InvokeChannel, args)));
  }
  log(`[port] real (ported) handlers: ${Object.keys(real).join(", ")}`);
  // PORT-NEW channels (docs/17 §5) — not part of the original contract
  for (const [ch, h] of Object.entries(portHandlers)) ipc.handle(ch, (_e: unknown, ...args: unknown[]) => h!(...args));
  for (const ch of SEND_CHANNELS) ipc.on(ch, (_e: unknown, ...args: unknown[]) => { const h = sendHandlers[ch]; if (h) { try { h(...args); } catch (e) { log(`[port] send ${ch} failed: ${String(e)}`); } } else log(`[fake-backend] send ${ch} ${JSON.stringify(args).slice(0, 200)}`); });
  log(`[port] registered ${INVOKE_CHANNELS.length} handle + ${SEND_CHANNELS.length} on; fake-implemented: ${backend.implemented().length}`);
  return real;
}

function createWindow() {
  const entry = resolveRendererEntry({ env: process.env, packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath ?? "", mainDir: __dirname, exists: existsSync });
  log(`[port] renderer: ${entry.kind} ${entry.url}${entry.note ? ` (${entry.note})` : ""}`);
  const rendererEntry = entry.url;
  const created = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Videoclaw",
    // original: titleBarStyle "hiddenInset" + trafficLightPosition (macOS-only, ignored on win32)
    backgroundColor: "#faf6ec",
    webPreferences: {
      // original preload is ESM (index.mjs) with sandbox:false; port ships CJS (index.cjs)
      // which works under both sandbox settings. Isolation flags identical to the original.
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win = created;
  created.on("closed", () => { if (win === created) win = null; });
  const originalMode = process.env.VIDEOCLAW_PORT_SMOKE_HOME === "1" ? "home" : process.env.VIDEOCLAW_PORT_SMOKE_S1 ? "s1" : process.env.VIDEOCLAW_PORT_SMOKE_RELOAD === "1" ? "reload" : undefined;
  if (SMOKE && originalMode) {
    const errors: string[] = [];
    created.webContents.on("console-message", (...a: any[]) => { const ev = a[0]; const level = ev?.level ?? a[1]; const msg = ev?.message ?? a[2]; if (level === "error" || level === 3) errors.push(String(msg).slice(0, 300)); });
    created.webContents.on("render-process-gone", (_e, d) => errors.push(`render-process-gone ${d.reason}`));
    created.webContents.once("did-finish-load", async () => {
      try {
        const shot = process.env.VIDEOCLAW_PORT_SMOKE_SCREENSHOT;
        const home = await created.webContents.executeJavaScript(homeSmokeScript({ timeoutMs: 30_000 }));
        home.rendererConsoleErrors = [...errors];
        log(`[smoke] HOME ${JSON.stringify(home).slice(0, 3000)}`);
        if (shot) { try { writeFileSync(shot, (await created.webContents.capturePage()).toPNG()); log(`[smoke] screenshot ${shot}`); } catch (e) { log(`[smoke] screenshot failed ${String(e)}`); } }
        let ok = home.ok;
        if (originalMode === "s1") {
          const brief = process.env.VIDEOCLAW_PORT_SMOKE_M3_SESSION ? "" : readFileSync(process.env.VIDEOCLAW_PORT_SMOKE_S1!, "utf8").trim();
          const r = await created.webContents.executeJavaScript(catchingScript(s1SmokeScript({ brief, timeoutMs: Number(process.env.VIDEOCLAW_PORT_SMOKE_S1_TIMEOUT_MS ?? 25 * 60_000), permission: process.env.VIDEOCLAW_PORT_SMOKE_PERMISSION === "deny" ? "deny" : "allow", permissionMode: process.env.VIDEOCLAW_PORT_SMOKE_PERMISSION_MODE, llmRoute: process.env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE, attach: !!process.env.VIDEOCLAW_PORT_SMOKE_PICK_FILES, m3: process.env.VIDEOCLAW_PORT_SMOKE_M3 === "1", keepTasteTurn: process.env.VIDEOCLAW_PORT_SMOKE_KEEP_TASTE === "1", existingSession: process.env.VIDEOCLAW_PORT_SMOKE_M3_SESSION })));
          const out = process.env.VIDEOCLAW_PORT_SMOKE_S1_OUT;
          if (out) writeFileSync(out, redactText(JSON.stringify(r, null, 2)));
          log(`[smoke] S1 ok=${r.ok} error=${r.error ?? ""} turnMs=${r.turnMs} session=${JSON.stringify(r.session)} final=${JSON.stringify(r.final)} events=${r.events.length} attachment=${JSON.stringify(r.attachment)?.slice(0, 800)} m3=${JSON.stringify(r.m3)?.slice(0, 1500)}`);
          ok = ok && r.ok;
        } else if (originalMode === "reload") {
          const r = await created.webContents.executeJavaScript(reloadSmokeScript());
          log(`[smoke] RELOAD ${JSON.stringify(r).slice(0, 2000)}`);
          ok = ok && r.ok;
        }
        log(`[smoke] DONE failed=${JSON.stringify(ok ? [] : [originalMode])}`);
        setTimeout(() => { app.quit(); setTimeout(() => app.exit(0), 5000); }, 600); // will-quit flushes the registry
      } catch (e) {
        log(`[smoke] ERROR ${String(e)}`);
        app.exit(1);
      }
    });
  } else if (SMOKE) {
    created.webContents.once("did-finish-load", async () => {
      try {
        const results = await created.webContents.executeJavaScript(smokeScript({
          runBootstrap: process.env.VIDEOCLAW_PORT_REAL_BOOTSTRAP === "1",
          session: process.env.VIDEOCLAW_PORT_SMOKE_SESSION,
          job: process.env.VIDEOCLAW_PORT_SMOKE_JOB,
          renderTimeoutMs: 10 * 60_000,
          llmRoute: process.env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE,
          uiSelect: process.env.VIDEOCLAW_PORT_SMOKE_UI_SELECT,
          agentPrompt: process.env.VIDEOCLAW_PORT_SMOKE_AGENT,
          agentStopPrompt: process.env.VIDEOCLAW_PORT_SMOKE_AGENT_STOP,
        }));
        for (const r of results) log(`[smoke] ${JSON.stringify(r).slice(0, 1500)}`);
        const shot = process.env.VIDEOCLAW_PORT_SMOKE_SCREENSHOT; // PORT-NEW docs/18: PNG of the page after the smoke
        if (shot) { try { writeFileSync(shot, (await created.webContents.capturePage()).toPNG()); log(`[smoke] screenshot ${shot}`); } catch (e) { log(`[smoke] screenshot failed ${String(e)}`); } }
        const failed = results.filter((r: any) => !r.ok).map((r: any) => r.name);
        log(`[smoke] DONE failed=${JSON.stringify(failed)}`);
        app.exit(0);
      } catch (e) {
        log(`[smoke] ERROR ${String(e)}`);
        app.exit(1);
      }
    });
  }
  void created.loadURL(rendererEntry);
}

app.whenReady().then(async () => {
  // finishPendingLocalReset (original L62452 → L62614): a committed reset completes before anything opens
  if (process.env.VIDEOCLAW_PORT_FAKE_SETTINGS !== "1" && !(await finishPendingLocalReset(log))) return;
  // original L62452: only files main granted (job snapshots, picked files) are served, with Range
  protocol.handle("vcmedia", (req) => handleVcmedia(req, mediaCapabilities, (sid) => mediaRoots.chatMediaRoot(sid)));
  const real = registerIpc();
  // PORT-NEW smoke: preselect + acknowledge an LLM route (what the user does once in the first-launch
  // route picker / port Settings page) so the original home opens on that route.
  if (UI_E2E) log(`[ui-e2e] mode on: original renderer, no injected script; dialogs answered from env (save-as ${process.env.VIDEOCLAW_PORT_SMOKE_SAVE_AS ? "preset" : "real"}, pick-files ${process.env.VIDEOCLAW_PORT_SMOKE_PICK_FILES ? "preset" : "real"})`);
  // UI_E2E: the original first-launch picker only offers Codex / Claude Code / credits; the box's only
  // agent route (minimax) is a PORT-NEW provider route chosen on the port Settings page, so it is preset here.
  const route = (UI_E2E || SMOKE) && (UI_E2E || process.env.VIDEOCLAW_PORT_SMOKE_HOME || process.env.VIDEOCLAW_PORT_SMOKE_S1 || process.env.VIDEOCLAW_PORT_SMOKE_RELOAD) ? process.env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE : undefined;
  if (route && real["settings:set"]) { try { await real["settings:set"]({ llmRoute: route, llmRouteAcknowledgedAt: Date.now() }); log(`[smoke] llmRoute preset ${route}`); } catch (e) { log(`[smoke] llmRoute preset failed ${String(e)}`); } }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
