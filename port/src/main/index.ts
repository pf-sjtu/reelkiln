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
import { createRealHandlers } from "./real-backend";

let win: BrowserWindow | null = null;
const sendToRenderer = createRendererEmitter(() => win);
const log = (m: string) => console.log(m);
const backend = createFakeBackend(sendToRenderer, log);

function registerIpc() {
  const { ipc } = trackIpcRequests(ipcMain);
  const real = createRealHandlers(sendToRenderer, log);
  for (const ch of INVOKE_CHANNELS) {
    const h = real[ch as InvokeChannel];
    ipc.handle(ch, (_e: unknown, ...args: unknown[]) => (h ? h(...args) : backend.invoke(ch as InvokeChannel, args)));
  }
  log(`[port] real (ported) handlers: ${Object.keys(real).join(", ")}`);
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
  void created.loadURL(rendererEntry);
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
