// Original: contextBridge.exposeInMainWorld("videoclaw", bridge) — out/preload/index.mjs L1058.
import { contextBridge, ipcRenderer } from "electron";
import { bridge } from "./bridge.generated";
import { PORT_IPC, PORT_PUSH, type LlmRoutesView, type VideoclawPortBridge } from "../shared/port-ipc";
contextBridge.exposeInMainWorld("videoclaw", bridge);
// PORT-NEW (docs/17 §5, docs/18): port-only surface, kept separate from the faithful 184-method bridge.
const portBridge: VideoclawPortBridge = {
  llmRoutes: () => ipcRenderer.invoke(PORT_IPC.llmRoutes),
  diagnostics: () => ipcRenderer.invoke(PORT_IPC.diagnostics),
  onLlmRoutesChanged: (cb) => {
    const listener = (_e: unknown, view: LlmRoutesView) => cb(view);
    ipcRenderer.on(PORT_PUSH.llmRoutesChanged, listener);
    return () => { ipcRenderer.removeListener(PORT_PUSH.llmRoutesChanged, listener); };
  },
};
contextBridge.exposeInMainWorld("videoclawPort", portBridge);
