// Faithful port of EditorRenderController (out/main/index.js L56018-56305):
// RENDER_SCRIPT_REL/OUTPUT_NAME/RUN_LOG_NAME/DEFAULT_CANCEL_TIMEOUT_MS L56018-56023,
// ERROR_COPY L56024-56044, publicError L56045-56047, class L56048-56267,
// logSize L56268-56274, newRenderCompleted L56275-56299; and the main-side wiring
// (L62404-62425): killGroup → platform killTree (original: process.kill(-pgid, "SIGKILL")).
import { existsSync, statSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { basename, join } from "node:path";
import { resolveJobBoundary, type SessionLike } from "./job-boundary";
import type { EditorRenderError, EditorRenderPhase, EditorRenderResult } from "../../shared/ipc-contract";

export const RENDER_SCRIPT_REL = "tools/hyperframes_render.py";
export const OUTPUT_NAME = "final_hyperframes.mp4";
export const RUN_LOG_NAME = "run.log.jsonl";
export const DEFAULT_CANCEL_TIMEOUT_MS = 8e3;
export const ERROR_COPY: Record<EditorRenderError["code"], { message: string; retryable: boolean }> = {
  "invalid-request": { message: "That render request wasn't valid.", retryable: false },
  "unknown-session": { message: "That video isn't available.", retryable: false },
  "job-mismatch": { message: "That video isn't linked to this render.", retryable: false },
  "job-not-found": { message: "This video's files couldn't be found.", retryable: false },
  "composition-not-found": { message: "There's nothing to render for this video yet.", retryable: false },
  "engine-unavailable": { message: "Your studio needs setup before it can render this. Try again after setup.", retryable: true },
  busy: { message: "A render is already in progress — let it finish first.", retryable: true },
  cancelled: { message: "Render cancelled.", retryable: true },
  "render-failed": { message: "The render didn't finish. Your previous version is untouched — try again.", retryable: true },
  "worker-unavailable": { message: "The render stopped unexpectedly. Try again.", retryable: true },
};
export function publicError(code: EditorRenderError["code"]): EditorRenderError {
  return { code, ...ERROR_COPY[code] };
}

export interface RenderWorker {
  postMessage(m: unknown): void;
  onMessage(cb: (m: any) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(): void;
}
export interface EditorRenderDeps {
  getSession: (id: string) => SessionLike | undefined;
  resolveEngine: () => { root: string; executable: string; env: NodeJS.ProcessEnv } | null;
  forkWorker: () => RenderWorker;
  emit: (event: unknown) => void;
  killGroup: (pgid: number) => void;
  log?: (kind: string, detail: string) => void;
  cancelTimeoutMs?: number;
  /** Original imports classifyError/sanitizeErrorText from the shared chunk; not yet ported → injected. TODO */
  classifyError?: (cause: unknown) => string;
  sanitizeErrorText?: (cause: unknown) => string;
}
interface Active {
  requestId: string; jobId: string; jobPath: string; outputPath: string; logOffset: number;
  worker: RenderWorker; phase: EditorRenderPhase; cancelling: boolean; terminalSeen: boolean;
  pgid?: number; cancelTimer?: NodeJS.Timeout;
}

export class EditorRenderController {
  active: Active | null = null;
  cancelTimeoutMs: number;
  constructor(private deps: EditorRenderDeps) {
    this.cancelTimeoutMs = deps.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS;
  }
  state() {
    if (!this.active) return null;
    const { requestId, jobId, phase } = this.active;
    return { requestId, jobId, phase };
  }
  start(req: any) {
    const requestId = typeof req?.requestId === "string" ? req.requestId : "";
    if (!requestId || typeof req?.sessionId !== "string" || !req.sessionId || typeof req?.jobId !== "string" || !req.jobId) {
      return this.reject(requestId, "invalid-request");
    }
    if (this.active) return this.reject(requestId, "busy");
    const { jobId } = req;
    const resolved = resolveJobBoundary(req, this.deps.getSession);
    if (!resolved.ok) return this.reject(requestId, resolved.code);
    const { jobsDir, jobPath } = resolved.boundary;
    const engine = this.deps.resolveEngine();
    if (!engine) return this.reject(requestId, "engine-unavailable");
    if (!existsSync(join(engine.root, RENDER_SCRIPT_REL))) return this.reject(requestId, "engine-unavailable");
    const worker = this.deps.forkWorker();
    this.active = {
      requestId, jobId, jobPath, outputPath: join(jobPath, OUTPUT_NAME), logOffset: logSize(jobPath),
      worker, phase: "queued", cancelling: false, terminalSeen: false,
    };
    worker.onMessage((message) => this.onWorkerMessage(message));
    worker.onExit((code) => this.onWorkerExit(code));
    this.emitPhase("queued");
    worker.postMessage({
      type: "start",
      requestId,
      jobId,
      executable: engine.executable,
      args: ["run", "python", RENDER_SCRIPT_REL, "--job", jobId],
      cwd: engine.root,
      env: { ...engine.env, VIDEOCLAW_JOBS_DIR: jobsDir },
    });
    return { requestId, accepted: true as const };
  }
  cancel(requestId: string): boolean {
    const active = this.active;
    if (!active || active.requestId !== requestId) return false;
    if (active.cancelling) return true;
    active.cancelling = true;
    this.emitPhase("cancelling");
    active.worker.postMessage({ type: "cancel", requestId });
    active.cancelTimer = setTimeout(() => this.onCancelTimeout(active), this.cancelTimeoutMs);
    return true;
  }
  shutdown(): number | undefined {
    const active = this.active;
    if (!active) return undefined;
    const pgid = active.pgid;
    active.terminalSeen = true;
    this.reapGroup(active, "shutdown");
    this.clear(active);
    return pgid;
  }
  onWorkerMessage(message: any) {
    const active = this.active;
    if (!active || message.requestId !== active.requestId) return;
    switch (message.type) {
      case "spawned": active.pgid = message.pgid; return;
      case "phase": if (!active.cancelling) this.emitPhase(message.phase); return;
      case "exit": active.terminalSeen = true; this.handleExit(active, message); return;
      case "cancelled":
        active.terminalSeen = true;
        this.retainLog(active, message.logTail);
        this.reapGroup(active, "cancel-ack");
        this.emitPhase("cancelled");
        this.clear(active);
        return;
    }
  }
  onWorkerExit(code: number | null) {
    const active = this.active;
    if (!active || active.terminalSeen) return;
    this.reapGroup(active, "worker-exit");
    if (active.cancelling) {
      this.emitPhase("cancelled");
      this.clear(active);
    } else {
      this.deps.log?.("editor-render-worker-crash", `code=${code ?? "null"}`);
      this.fail(active, "worker-unavailable");
    }
  }
  onCancelTimeout(active: Active) {
    if (this.active !== active || active.terminalSeen) return;
    active.terminalSeen = true;
    this.reapGroup(active, "cancel-timeout");
    this.emitPhase("cancelled");
    this.clear(active);
  }
  reapGroup(active: Active, reason: string) {
    if (active.pgid === undefined) return;
    const pgid = active.pgid;
    active.pgid = undefined;
    this.deps.log?.("editor-render-reap-group", `pgid=${pgid} reason=${reason}`);
    try { this.deps.killGroup(pgid); } catch {}
  }
  handleExit(active: Active, message: any) {
    this.retainLog(active, message.logTail);
    if (message.spawnError || message.code !== 0) {
      this.deps.log?.("editor-render-failed", message.spawnError ?? `exit code=${message.code ?? "null"}`);
      this.fail(active, "render-failed", message.spawnError ?? message.logTail);
      return;
    }
    const result = this.readResult(active);
    if (!result) {
      this.deps.log?.("editor-render-no-receipt", `job=${active.jobId}`);
      this.fail(active, "render-failed");
      return;
    }
    this.emitPhase("completed");
    this.deps.emit({ kind: "completed", result });
    this.clear(active);
  }
  readResult(active: Active): EditorRenderResult | null {
    let size: number;
    try {
      const st = statSync(active.outputPath);
      if (!st.isFile() || st.size <= 0) return null;
      size = st.size;
    } catch {
      return null;
    }
    const receipt = newRenderCompleted(join(active.jobPath, RUN_LOG_NAME), active.logOffset);
    if (!receipt) return null;
    if (basename(String(receipt.output_path ?? "")) !== OUTPUT_NAME) return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      requestId: active.requestId, jobId: active.jobId, outputPath: active.outputPath,
      width: num(receipt.width), height: num(receipt.height), fps: num(receipt.fps),
      durationSeconds: num(receipt.duration), sizeBytes: num(receipt.size_bytes) || size,
      hasAudio: receipt.has_audio === true,
    };
  }
  emitPhase(phase: EditorRenderPhase) {
    if (this.active) this.active.phase = phase;
    const requestId = this.active?.requestId ?? "";
    const jobId = this.active?.jobId ?? "";
    this.deps.emit({ kind: "progress", progress: { requestId, jobId, phase } });
  }
  retainLog(active: Active, logTail?: string) {
    if (logTail) this.deps.log?.("editor-render-log", `job=${active.jobId} · ${logTail}`);
  }
  fail(active: Active, code: EditorRenderError["code"], cause?: unknown) {
    this.clear(active);
    active.phase = "failed";
    this.deps.emit({ kind: "progress", progress: { requestId: active.requestId, jobId: active.jobId, phase: "failed" } });
    const error = publicError(code);
    // Original: if (cause && classifyError(cause) !== "unknown") error.message = sanitizeErrorText(cause)
    if (cause && this.deps.classifyError && this.deps.sanitizeErrorText && this.deps.classifyError(cause) !== "unknown") {
      error.message = this.deps.sanitizeErrorText(cause);
    }
    this.deps.emit({ kind: "error", requestId: active.requestId, jobId: active.jobId, error });
  }
  clear(active: Active) {
    if (active.cancelTimer) clearTimeout(active.cancelTimer);
    try { active.worker.kill(); } catch {}
    if (this.active === active) this.active = null;
  }
  reject(requestId: string, code: EditorRenderError["code"]) {
    return { requestId, accepted: false as const, error: publicError(code) };
  }
}

export function logSize(jobPath: string): number {
  try { return statSync(join(jobPath, RUN_LOG_NAME)).size; } catch { return 0; }
}

export function newRenderCompleted(logPath: string, offset: number): any | null {
  let fd: number;
  try { fd = openSync(logPath, "r"); } catch { return null; }
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return null;
    const len = size - offset;
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, offset);
    const lines = buf.toString("utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || line[0] !== "{" || !line.includes("render_completed")) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.event === "render_completed" && rec.renderer === "hyperframes") return rec;
      } catch {}
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
