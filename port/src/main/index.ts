// Videoclaw Windows-port main process — SCAFFOLD.
// Mirrors the original createWindow (out/main/index.js L60537-60560) and the IPC
// registration pattern (trackIpcRequests → ipc.handle / ipc.on for every channel),
// handlers are served by real-backend.ts where ported, else by the fake backend.
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { INVOKE_CHANNELS, SEND_CHANNELS, type InvokeChannel } from "../shared/ipc-contract";
import { trackIpcRequests, createRendererEmitter } from "./ipc-tracking";
import { createFakeBackend } from "./fake-backend";
import { createRealHandlers, portHandlers } from "./real-backend";
import { smokeScript } from "./smoke";

const SMOKE = process.env.VIDEOCLAW_PORT_SMOKE === "1"; // PORT-NEW

let win: BrowserWindow | null = null;
const sendToRenderer = createRendererEmitter(() => win);
const log = (m: string) => console.log(m);
const backend = createFakeBackend(sendToRenderer, log);

function registerIpc() {
  const { ipc } = trackIpcRequests(ipcMain);
  const push = SMOKE
    ? (ch: string, ...a: unknown[]) => { log(`[smoke] push ${ch} ${JSON.stringify(a).slice(0, 400)}`); return sendToRenderer(ch as any, ...(a as [])); }
    : sendToRenderer;
  const real = createRealHandlers(push as typeof sendToRenderer, log);
  for (const ch of INVOKE_CHANNELS) {
    const h = real[ch as InvokeChannel];
    ipc.handle(ch, (_e: unknown, ...args: unknown[]) => (h ? h(...args) : backend.invoke(ch as InvokeChannel, args)));
  }
  log(`[port] real (ported) handlers: ${Object.keys(real).join(", ")}`);
  // PORT-NEW channels (docs/17 §5) — not part of the original contract
  for (const [ch, h] of Object.entries(portHandlers)) ipc.handle(ch, (_e: unknown, ...args: unknown[]) => h!(...args));
  for (const ch of SEND_CHANNELS) ipc.on(ch, (_e: unknown, ...args: unknown[]) => log(`[fake-backend] send ${ch} ${JSON.stringify(args)}`));
  log(`[port] registered ${INVOKE_CHANNELS.length} handle + ${SEND_CHANNELS.length} on; fake-implemented: ${backend.implemented().length}`);
}

function createWindow() {
  const rendererEntry = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, "../renderer/index.html")).toString();
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
  if (SMOKE) {
    created.webContents.once("did-finish-load", async () => {
      try {
        const results = await created.webContents.executeJavaScript(smokeScript({
          runBootstrap: process.env.VIDEOCLAW_PORT_REAL_BOOTSTRAP === "1",
          session: process.env.VIDEOCLAW_PORT_SMOKE_SESSION,
          job: process.env.VIDEOCLAW_PORT_SMOKE_JOB,
          renderTimeoutMs: 10 * 60_000,
          llmRoute: process.env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE,
        }));
        for (const r of results) log(`[smoke] ${JSON.stringify(r).slice(0, 1500)}`);
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

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
