// Original: contextBridge.exposeInMainWorld("videoclaw", bridge) — out/preload/index.mjs L1058.
import { contextBridge, ipcRenderer } from "electron";
import { bridge } from "./bridge.generated";
import { PORT_IPC, type VideoclawPortBridge } from "../shared/port-ipc";
contextBridge.exposeInMainWorld("videoclaw", bridge);
// PORT-NEW (docs/17 §5): port-only surface, kept separate from the faithful 184-method bridge.
const portBridge: VideoclawPortBridge = { llmRoutes: () => ipcRenderer.invoke(PORT_IPC.llmRoutes) };
contextBridge.exposeInMainWorld("videoclawPort", portBridge);
