import { spawn } from "node:child_process";
const CANCEL_GRACE_MS = 4e3;
function startEngineRender(cmd, io) {
  const spawn2 = io.spawn;
  const kill = io.kill ?? ((pid, signal) => process.kill(pid, signal));
  const graceMs = io.cancelGraceMs ?? CANCEL_GRACE_MS;
  let logTail = "";
  const collect = (chunk) => {
    logTail = (logTail + String(chunk)).slice(-16384);
  };
  let settled = false;
  let cancelling = false;
  let graceHandle = null;
  io.post({ type: "phase", requestId: cmd.requestId, phase: "preparing" });
  let child;
  try {
    child = spawn2(cmd.executable, cmd.args, {
      cwd: cmd.cwd,
      env: cmd.env,
      // Detached so the child leads its own process group: a single signal to
      // -pid tears down the engine CLI and every descendant (Chromium, ffmpeg)
      // without matching on executable names.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    io.post({
      type: "exit",
      requestId: cmd.requestId,
      code: null,
      signal: null,
      spawnError: err.message,
      logTail,
    });
    return { cancel: () => {} };
  }
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  if (child.pid !== void 0) {
    io.post({ type: "spawned", requestId: cmd.requestId, pgid: child.pid });
  }
  io.post({ type: "phase", requestId: cmd.requestId, phase: "rendering" });
  const finish = (message) => {
    if (settled) return;
    settled = true;
    if (graceHandle) clearTimeout(graceHandle);
    io.post(message);
  };
  child.on("error", (err) =>
    finish({
      type: "exit",
      requestId: cmd.requestId,
      code: null,
      signal: null,
      spawnError: err.message,
      logTail,
    }),
  );
  child.on("close", (code, signal) =>
    finish(
      cancelling
        ? { type: "cancelled", requestId: cmd.requestId, logTail }
        : { type: "exit", requestId: cmd.requestId, code, signal, logTail },
    ),
  );
  const signalGroup = (sig) => {
    if (child.pid === void 0) return;
    try {
      kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {}
    }
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
const parentPort = process.parentPort;
if (parentPort) {
  let job = null;
  const post = (message) => parentPort.postMessage(message);
  parentPort.on("message", ({ data }) => {
    if (data.type === "start") job = startEngineRender(data, { spawn, post });
    else if (data.type === "cancel") job?.cancel();
  });
}
export { startEngineRender };
