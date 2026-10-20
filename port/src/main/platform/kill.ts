// Process-tree termination. Original:
//   runBash killTree: if (process.platform !== "win32") process.kill(-child.pid, signal)
//                     else child.kill(signal)                 — main/index.js L25300-25311
//   editorRender cancel: process.kill(-pgid, "SIGKILL")        — main/index.js L62418
//   editorRenderWorker.js L69: kill(-child.pid, sig)
// On Windows child.kill() only kills the direct child (bash/uv), orphaning python/ffmpeg.
// Port: `taskkill /T /PID <pid>` (+ /F for SIGKILL-equivalent).
import { spawnSync } from "node:child_process";
import { isWin, type Plat } from "./types";

export function taskkillArgs(pid: number, signal: NodeJS.Signals | number = "SIGTERM"): string[] {
  const force = signal === "SIGKILL" || signal === 9;
  // SIGTERM → graceful WM_CLOSE first; console apps (python/ffmpeg) usually ignore it, so
  // callers that escalate to SIGKILL (as the original does after 250ms) get /F.
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

export function killTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  o: { platform?: Plat; run?: (file: string, args: string[]) => number | null; kill?: typeof process.kill } = {},
): boolean {
  const p = o.platform ?? process.platform;
  if (isWin(p)) {
    const run = o.run ?? ((f, a) => spawnSync(f, a, { windowsHide: true, timeout: 10e3 }).status);
    return run("taskkill.exe", taskkillArgs(pid, signal)) === 0;
  }
  const kill = o.kill ?? process.kill.bind(process);
  try { kill(-pid, signal); return true; } catch {}
  try { kill(pid, signal); return true; } catch { return false; }
}
