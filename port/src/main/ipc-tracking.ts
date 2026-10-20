// Verbatim-logic ports of two main-process IPC helpers.
import type { IpcMain, BrowserWindow } from "electron";

/** trackIpcRequests (original main/index.js L2402-2431): counts in-flight requests per channel. */
export function trackIpcRequests(ipc: Pick<IpcMain, "handle" | "on">) {
  const active = new Map<string, number>();
  const track =
    (channel: string, listener: (...a: any[]) => any) =>
    (...args: any[]) => {
      active.set(channel, (active.get(channel) ?? 0) + 1);
      const settled = () => {
        const remaining = (active.get(channel) ?? 1) - 1;
        if (remaining) active.set(channel, remaining);
        else active.delete(channel);
      };
      try {
        const result = listener(...args);
        if (result && typeof result.then === "function") return Promise.resolve(result).finally(settled);
        settled();
        return result;
      } catch (error) {
        settled();
        throw error;
      }
    };
  const tracked = {
    handle: (channel: string, listener: (...a: any[]) => any) => ipc.handle(channel, track(channel, listener)),
    on: (channel: string, listener: (...a: any[]) => any) => ipc.on(channel, track(channel, listener)),
  };
  return {
    ipc: tracked,
    pendingExcept: (channel: string) => [...active].some(([name, count]) => name !== channel && count > 0),
  };
}

/** isDestroyedObjectError$1 (original L55698-55700), verbatim. */
const isDestroyedObjectError = (error: unknown) =>
  /object has been destroyed/i.test(error instanceof Error ? error.message : String(error));

/** createRendererEmitter (original L55701+): safe webContents.send that tolerates teardown. */
export function createRendererEmitter(currentWindow: () => BrowserWindow | null | undefined) {
  return (channel: string, ...args: unknown[]): boolean => {
    let webContents: Electron.WebContents | undefined;
    try {
      webContents = currentWindow()?.webContents;
      if (!webContents || webContents.isDestroyed()) return false;
      webContents.send(channel, ...args);
      return true;
    } catch (error) {
      if (isDestroyedObjectError(error)) return false;
      if (!webContents) throw error;
      try {
        if (webContents.isDestroyed()) return false;
      } catch (e2) {
        if (isDestroyedObjectError(e2)) return false;
        throw e2;
      }
      throw error;
    }
  };
}
