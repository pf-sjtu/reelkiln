// Port of out/main/editorRenderWorker.js (94 lines, utilityProcess). Identical message
// protocol: in {type:"start"|"cancel"}, out {type:"phase"|"spawned"|"exit"|"cancelled"}.
// OS touch point: original `kill(-child.pid, sig)` (process-group signal; on win32 it
// throws and falls back to child.kill). PORT: default `kill` routes negative pids through
// platform.killTree (taskkill /T on win32; identical kill(-pid) on POSIX).
import { spawn as nodeSpawn } from "node:child_process";
import { killTree } from "../platform/kill";

export const CANCEL_GRACE_MS = 4e3;

export function defaultGroupKill(pid: number, signal: NodeJS.Signals) {
  if (pid < 0) {
    if (!killTree(-pid, signal)) throw new Error(`could not signal group ${-pid}`);
    return;
  }
  process.kill(pid, signal);
}

export function startEngineRender(cmd: any, io: { spawn: typeof nodeSpawn | any; post: (m: any) => void; kill?: (pid: number, sig: NodeJS.Signals) => void; cancelGraceMs?: number }) {
  const spawn2 = io.spawn;
  const kill = io.kill ?? defaultGroupKill;
  const graceMs = io.cancelGraceMs ?? CANCEL_GRACE_MS;
  let logTail = "";
  const collect = (chunk: unknown) => { logTail = (logTail + String(chunk)).slice(-16384); };
  let settled = false;
  let cancelling = false;
  let graceHandle: NodeJS.Timeout | null = null;
  io.post({ type: "phase", requestId: cmd.requestId, phase: "preparing" });
  let child: any;
  try {
    child = spawn2(cmd.executable, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, // PORT: avoid a console window for the detached child on win32
    });
  } catch (err) {
    io.post({ type: "exit", requestId: cmd.requestId, code: null, signal: null, spawnError: (err as Error).message, logTail });
    return { cancel: () => {} };
  }
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  if (child.pid !== undefined) io.post({ type: "spawned", requestId: cmd.requestId, pgid: child.pid });
  io.post({ type: "phase", requestId: cmd.requestId, phase: "rendering" });
  const finish = (message: any) => {
    if (settled) return;
    settled = true;
    if (graceHandle) clearTimeout(graceHandle);
    io.post(message);
  };
  child.on("error", (err: Error) =>
    finish({ type: "exit", requestId: cmd.requestId, code: null, signal: null, spawnError: err.message, logTail }));
  child.on("close", (code: number | null, signal: string | null) =>
    finish(cancelling ? { type: "cancelled", requestId: cmd.requestId, logTail } : { type: "exit", requestId: cmd.requestId, code, signal, logTail }));
  const signalGroup = (sig: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} }
  };
  return {
    cancel: () => {
      if (settled || cancelling) return;
      cancelling = true;
      signalGroup("SIGTERM");
      graceHandle = setTimeout(() => signalGroup("SIGKILL"), graceMs);
    },
  };
}

const parentPort = (process as any).parentPort;
if (parentPort) {
  let job: { cancel(): void } | null = null;
  const post = (message: unknown) => parentPort.postMessage(message);
  parentPort.on("message", ({ data }: any) => {
    if (data.type === "start") job = startEngineRender(data, { spawn: nodeSpawn, post });
    else if (data.type === "cancel") job?.cancel();
  });
}
