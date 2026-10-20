// Original: contextBridge.exposeInMainWorld("videoclaw", bridge) — out/preload/index.mjs L1058.
import { contextBridge } from "electron";
import { bridge } from "./bridge.generated";
contextBridge.exposeInMainWorld("videoclaw", bridge);
