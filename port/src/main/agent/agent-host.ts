// PORT-NEW (docs/19): minimal-but-real AgentHost — the main-process session lifecycle the renderer
// drives over the ORIGINAL IPC contract (session:create / session:send / session:interrupt →
// push session:event {sessionId, event} + session:changed). Modelled on the original AgentHost
// (app/reconstructed/main/index.js L34784): createSession L38726, sendMessage/submitMessage L41400,
// spawnLocal L39454 + createLocalRuntime L23059 (streaming-input query()), consume L50152,
// reduce L50416 (event shapes), setStatus L50990, interrupt L43860 + acknowledgedInterrupt L43844,
// teardownRuntime L42932, onLlmRouteChanged L43127.
//
// What it keeps from the original:
//   - one long-lived SDK query() per session runtime, fed by an async-iterable input queue
//     (createLocalRuntime's queue/pending/wake), torn down with query.close()
//   - the route pin at createSession (service.newSessionLlmRoute) and spawn through
//     LlmRouteService.sessionAgentRuntime() — i.e. the same child env / model aliases / isolated
//     CLAUDE_CONFIG_DIR / loopback gate proxy (concurrency gate + key isolation + structured-output
//     emulation, docs/16-17) the CLI path uses; the proxy is closed with the runtime
//   - event kinds + fields: status, text_delta, assistant_text, thinking, tool_start, tool_end,
//     result, error (subset of reduce())
//   - Stop = interrupt(sessionId,"stop"): synthetic result {stoppedAfterMs}, status idle,
//     query.interrupt() bounded by interruptAckTimeoutMs, teardown when the ack does not come
//   - onLlmRouteChanged(): every runtime whose meta.llmRoute is not a builtin literal is torn down;
//     an active turn gets the original error card + status "error"
// PORT-NEW policy:
//   - host-wide turn gate (maxConcurrentTurns, default 1): the MiniMax key is shared with another
//     pipeline; a second video's send is refused instead of queued (the gate proxy additionally
//     serialises every HTTP request of every child on the provider's gateKey)
//   - a send while the same video is still running is refused (original folds it into the turn)
//   - tools: an explicit allow-list (default Read/Glob/Grep) and a canUseTool that only allows
//     paths inside the session cwd; no Bash, no MCP, no hooks, no permission UI
// DEFERRED (docs/19 §5): display transcript / session:history, registry persistence of these
//   sessions, resume, attachments, spend gates, permission cards, titles, job binding, studio MCP,
//   hooks, steer/queued turns, retry, setModel/setPermissionMode.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { LlmRouteId } from "../../shared/llm-types";
import { minimalAgentOptions, type ClaudeAgentSdkLike, type AgentQuery } from "../llm/agent-sdk";
import { getLogger, redact, redactText, registerSecret, type Logger } from "../llm/logger";
import type { SessionMetaLike } from "../llm/route-service";

export type SessionStatus = "idle" | "running" | "error";
export interface AgentSessionMeta {
  sessionId: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  permissionMode: string;
  totalCostUsd: number;
  createdAt: number;
  clientId: string;
  agentHarness: "claude-code";
  llmRoute?: LlmRouteId;
  /** PORT-NEW: marks sessions owned by this host (not read from sessions.json). */
  portAgentHost: true;
}
export type SessionEvent =
  | { kind: "status"; status: SessionStatus }
  | { kind: "text_delta"; text: string; messageId?: string; blockIndex?: number }
  | { kind: "assistant_text"; text: string; messageId?: string; blockIndex?: number }
  | { kind: "thinking"; text: string }
  | { kind: "tool_start"; toolName: string; toolUseId: string; summary: string; detail: string; background: boolean }
  | { kind: "tool_end"; toolUseId: string; isError: boolean; terminal: "ok" | "error" | "cancelled" | "abandoned" }
  | { kind: "result"; isError: boolean; totalCostUsd: number; numTurns: number; durationMs: number; stoppedAfterMs?: number; stopTurnId?: string }
  | { kind: "error"; message: string; canRetry: boolean }
  /** PORT-NEW diagnostic (not an original kind): route/model/SDK the runtime started with. */
  | { kind: "port_runtime"; phase: "started" | "closed"; llmRoute: string; model?: string; gateProxy?: boolean; claudeCodeVersion?: string; reason?: string };

export interface AgentHostEmit {
  sessionEvent(sessionId: string, event: SessionEvent): void;
  sessionsChanged(list: AgentSessionMeta[]): void;
}
export interface AgentRuntimeHandle { llmRoute: LlmRouteId; model: string | undefined; env: Record<string, string>; proxy?: unknown; close(): Promise<void> }
export interface AgentHostRouteService {
  newSessionLlmRoute(o?: { runtime?: string; agentHarness?: string }): LlmRouteId | undefined;
  llmRouteReadiness(meta?: SessionMetaLike): Promise<Record<string, unknown> | undefined>;
  sessionAgentRuntime(meta: SessionMetaLike): Promise<AgentRuntimeHandle>;
}
export interface AgentHostDeps {
  emit: AgentHostEmit;
  service: AgentHostRouteService;
  /** Loads the Claude Agent SDK (+ native executable). Called lazily on the first spawn. */
  loadSdk: () => Promise<{ sdk: ClaudeAgentSdkLike; executable?: string; version?: string }>;
  /** Parent dir for per-session working dirs (default: caller supplies userData/agent-sessions). */
  sessionsRoot: string;
  /** Tools the model may use (default Read/Glob/Grep, path-confined to the session cwd). */
  tools?: string[];
  maxConcurrentTurns?: number;
  maxTurns?: number;
  interruptAckTimeoutMs?: number;
  /** Safety net for a turn that never produces a result (default 5 min). */
  turnTimeoutMs?: number;
  logger?: Logger;
  now?: () => number;
}

export class ComposerDeliveryError extends Error { constructor(m: string) { super(m); this.name = "ComposerDeliveryError"; } }

interface Runtime {
  query: AgentQuery;
  handle: AgentRuntimeHandle;
  llmRoute: LlmRouteId;
  queue: Array<Record<string, unknown>>;
  wake: (() => void) | null;
  inputClosed: boolean;
  dead: boolean;
  launched: boolean;
  consumed: Promise<void>;
  closed?: Promise<void>;
}
interface Session {
  meta: AgentSessionMeta;
  runtime?: Runtime;
  spawning?: Promise<Runtime>;
  turnStartedAtMs?: number;
  /** Results still owed by turns the user stopped (each acknowledged interrupt yields one). Output is
   *  dropped while > 0 so a stopped turn's tail never lands in the next one (L43900 stoppedTurn). */
  staleResults: number;
  /** Bumped by teardown / route change so a spawn that was in flight cannot install a stale runtime. */
  epoch: number;
  interrupting?: Promise<void>;
  activeMessageId?: string;
  openTools: Set<string>;
  clientTurns: Set<string>;
  turnTimer?: ReturnType<typeof setTimeout>;
}

export const DEFAULT_AGENT_TOOLS = ["Read", "Glob", "Grep"];
const PATH_KEYS = ["file_path", "path", "notebook_path"];
const ROUTE_CHANGED_MESSAGE = "The language-model account changed before this turn finished. Retry to continue with the account you selected."; // L43142

/** canUseTool: allow-listed tool AND every path-like input inside the session cwd. */
export function confinedToolPolicy(cwd: string, tools: string[]) {
  const root = resolvePath(cwd);
  const inside = (p: string) => { const abs = isAbsolute(p) ? resolvePath(p) : resolvePath(root, p); const rel = relative(root, abs); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };
  return (name: string, input: Record<string, unknown>): { allowed: boolean; reason?: string } => {
    if (!tools.includes(name)) return { allowed: false, reason: `tool ${name} is not enabled in this port` };
    for (const k of PATH_KEYS) { const v = input[k]; if (typeof v === "string" && v && !inside(v)) return { allowed: false, reason: `${k} is outside this video's folder` }; }
    return { allowed: true };
  };
}

const short = (v: unknown, n = 300) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? {}); return s.length > n ? s.slice(0, n) + "…" : s; };
function toolSummary(name: string, input: Record<string, any>): string { // friendlyToolLine (simplified)
  const target = input?.file_path ?? input?.path ?? input?.pattern ?? input?.command;
  return target ? `${name} ${short(String(target), 80)}` : name;
}

export class AgentHost {
  private readonly sessions = new Map<string, Session>();
  private readonly log: Logger;
  private sdk?: Promise<{ sdk: ClaudeAgentSdkLike; executable?: string; version?: string }>;
  private readonly tools: string[];
  private readonly now: () => number;
  constructor(private readonly d: AgentHostDeps) {
    this.log = (d.logger ?? getLogger()).child({ component: "agent-host" });
    this.tools = d.tools ?? DEFAULT_AGENT_TOOLS;
    this.now = d.now ?? Date.now;
  }

  listSessions(): AgentSessionMeta[] { return [...this.sessions.values()].map((s) => ({ ...s.meta })); }
  has(sessionId: string): boolean { return this.sessions.has(sessionId); }
  /** Test/diagnostic view (no secrets). */
  runtimeInfo(sessionId: string): { running: boolean; llmRoute?: string; status?: string } {
    const s = this.sessions.get(sessionId);
    return { running: !!s?.runtime && !s.runtime.dead, llmRoute: s?.runtime?.llmRoute, status: s?.meta.status };
  }

  /** createSession (L38726) slice: id, cwd, route pin, status idle, session:changed. */
  createSession(req: { title?: string; clientId?: string; permissionMode?: string } = {}): AgentSessionMeta {
    const sessionId = randomUUID();
    const cwd = join(this.d.sessionsRoot, sessionId);
    mkdirSync(cwd, { recursive: true });
    // a small fixture so a read-only tool call has something to find (PORT-NEW)
    writeFileSync(join(cwd, "README.txt"), "Videoclaw port agent session folder.\n");
    const llmRoute = this.d.service.newSessionLlmRoute({});
    const meta: AgentSessionMeta = {
      sessionId, title: typeof req?.title === "string" && req.title ? req.title.slice(0, 120) : "New video", cwd, status: "idle",
      permissionMode: typeof req?.permissionMode === "string" ? req.permissionMode : "auto", totalCostUsd: 0, createdAt: this.now(),
      clientId: typeof req?.clientId === "string" ? req.clientId : "personal", agentHarness: "claude-code", ...(llmRoute ? { llmRoute } : {}), portAgentHost: true,
    };
    this.sessions.set(sessionId, { meta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0 });
    this.log.info("agent.session.created", { sessionId, llmRoute });
    this.d.emit.sessionsChanged(this.listSessions());
    return { ...meta };
  }

  private mustGet(sessionId: string): Session {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`); // L51008
    return s;
  }
  private send(s: Session, event: SessionEvent): void {
    try { this.d.emit.sessionEvent(s.meta.sessionId, event); } catch (e) { this.log.warn("agent.emit_failed", { error: e }); }
  }
  private setStatus(s: Session, status: SessionStatus): void { // L50990 slice
    if (status === "running") s.turnStartedAtMs = this.now();
    else { delete s.turnStartedAtMs; if (s.turnTimer) { clearTimeout(s.turnTimer); s.turnTimer = undefined; } }
    s.meta.status = status;
    this.send(s, { kind: "status", status });
    this.d.emit.sessionsChanged(this.listSessions());
  }
  private activeTurns(): number { let n = 0; for (const s of this.sessions.values()) if (s.meta.status === "running") n++; return n; }

  /** sendMessage (L41400) slice. Resolves when the message is queued into the runtime. */
  async sendMessage(sessionId: string, input: string | { text: string; clientTurnId?: string; attachmentIds?: string[] }): Promise<{ submitted: true; duplicate: boolean; attachmentIds: string[] }> {
    const s = this.mustGet(sessionId);
    if (s.interrupting) await s.interrupting;
    const req = typeof input === "string" ? { text: input, clientTurnId: "", attachmentIds: [] as string[] } : { text: String(input?.text ?? ""), clientTurnId: String(input?.clientTurnId ?? ""), attachmentIds: input?.attachmentIds ?? [] };
    if (req.attachmentIds.length) throw new ComposerDeliveryError("Attachments are not supported in this port yet.");
    if (!req.text.trim()) throw new Error("Write a message or attach a file before sending."); // L41445
    if (req.clientTurnId && s.clientTurns.has(req.clientTurnId)) return { submitted: true, duplicate: true, attachmentIds: [] };
    if (s.meta.status === "running") throw new ComposerDeliveryError("This video is still working. Wait for the reply or press Stop.");
    const limit = this.d.maxConcurrentTurns ?? 1;
    if (this.activeTurns() >= limit) throw new ComposerDeliveryError(`Another video is still working (this port runs ${limit} agent turn${limit === 1 ? "" : "s"} at a time). Wait for it or press Stop there.`);
    // claim the turn slot before any await so two concurrent sends cannot both pass the gate
    if (req.clientTurnId) s.clientTurns.add(req.clientTurnId);
    this.setStatus(s, "running");
    let rt: Runtime;
    try {
      rt = await this.ensureRuntime(s);
    } catch (e: any) {
      if (req.clientTurnId) s.clientTurns.delete(req.clientTurnId);
      if ((s.meta.status as SessionStatus) !== "running") return { submitted: true, duplicate: false, attachmentIds: [] }; // stopped / reset while spawning
      const message = redactText(String(e?.message ?? e));
      this.log.warn("agent.spawn_failed", { sessionId, error: e });
      this.send(s, { kind: "error", message, canRetry: true });
      this.setStatus(s, "error");
      throw new ComposerDeliveryError(message);
    }
    if ((s.meta.status as SessionStatus) !== "running" || s.runtime !== rt) return { submitted: true, duplicate: false, attachmentIds: [] }; // stopped while spawning
    const timeoutMs = this.d.turnTimeoutMs ?? 5 * 60_000;
    s.turnTimer = setTimeout(() => { if (s.meta.status === "running") { this.send(s, { kind: "error", message: `The turn did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`, canRetry: true }); this.teardownRuntime(s, "turn-timeout"); this.setStatus(s, "error"); } }, timeoutMs);
    (s.turnTimer as any).unref?.();
    rt.queue.push({ type: "user", message: { role: "user", content: [{ type: "text", text: req.text }] }, parent_tool_use_id: null, session_id: "", uuid: randomUUID() });
    rt.wake?.(); rt.wake = null;
    return { submitted: true, duplicate: false, attachmentIds: [] };
  }

  private loadSdk() { return (this.sdk ??= this.d.loadSdk().catch((e) => { this.sdk = undefined; throw e; })); }

  private async ensureRuntime(s: Session): Promise<Runtime> {
    if (s.runtime && !s.runtime.dead) return s.runtime;
    if (s.spawning) return s.spawning;
    s.spawning = this.spawn(s).finally(() => { s.spawning = undefined; });
    return s.spawning;
  }

  /** spawnLocal (L39454) + createLocalRuntime (L23059) minimal slice. */
  private async spawn(s: Session): Promise<Runtime> {
    const epoch = s.epoch;
    const meta: SessionMetaLike = { llmRoute: s.meta.llmRoute, agentHarness: "claude-code" };
    const readiness = await this.d.service.llmRouteReadiness(meta);
    if (readiness && readiness.ready === false) {
      const why = String(readiness.reason ?? "not ready");
      throw new Error(`The LLM route "${String(readiness.route)}" is not ready (${why}${readiness.keyEnv ? `: set ${String(readiness.keyEnv)}` : ""}).`);
    }
    const { sdk, executable } = await this.loadSdk();
    if (s.epoch !== epoch) throw new Error("The session was reset before the agent started.");
    const handle = await this.d.service.sessionAgentRuntime(meta);
    if (s.epoch !== epoch) { await handle.close().catch(() => {}); throw new Error("The session was reset before the agent started."); }
    for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) registerSecret(handle.env[k]);
    const rt: Runtime = { query: undefined as unknown as AgentQuery, handle, llmRoute: handle.llmRoute, queue: [], wake: null, inputClosed: false, dead: false, launched: false, consumed: Promise.resolve() };
    const input: AsyncIterable<Record<string, unknown>> = {
      async *[Symbol.asyncIterator]() {
        while (!rt.inputClosed) {
          const m = rt.queue.shift();
          if (m) { yield m; continue; }
          await new Promise<void>((r) => { rt.wake = r; });
        }
      },
    };
    const policy = confinedToolPolicy(s.meta.cwd, this.tools);
    const canUseTool = async (name: string, toolInput: Record<string, unknown>) => {
      const v = policy(name, toolInput);
      this.log.info("agent.tool.permission", { sessionId: s.meta.sessionId, tool: name, allowed: v.allowed });
      return v.allowed ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: v.reason ?? "not allowed" };
    };
    let stderr = "";
    const options = minimalAgentOptions(
      { runtime: handle, prompt: "", cwd: s.meta.cwd, executable, allowedTools: this.tools, maxTurns: this.d.maxTurns ?? 8, includePartialMessages: true },
      { canUseTool, stderr: (t) => { stderr = (stderr + t).slice(-4000); } },
    );
    rt.query = sdk.query({ prompt: input, options });
    s.runtime = rt;
    this.send(s, { kind: "port_runtime", phase: "started", llmRoute: handle.llmRoute, model: handle.model, gateProxy: !!handle.proxy });
    this.log.info("agent.runtime.started", { sessionId: s.meta.sessionId, llmRoute: handle.llmRoute, model: handle.model, gateProxy: !!handle.proxy });
    rt.consumed = this.consume(s, rt, () => stderr);
    return rt;
  }

  /** consume (L50152) slice. */
  private async consume(s: Session, rt: Runtime, stderr: () => string): Promise<void> {
    try {
      for await (const m of rt.query) {
        if (s.runtime !== rt || rt.dead) break;
        rt.launched = true;
        this.reduce(s, m, rt);
      }
      if (s.runtime === rt && !rt.dead) {
        // stream ended on its own (child exited)
        const wasRunning = s.meta.status === "running";
        this.teardownRuntime(s, "stream-ended");
        if (wasRunning) { this.send(s, { kind: "error", message: "The agent stopped before finishing this turn.", canRetry: true }); this.setStatus(s, "error"); }
      }
    } catch (e: any) {
      if (s.runtime !== rt || rt.dead) return;
      const wasStopping = s.staleResults > 0 || !!s.interrupting;
      this.teardownRuntime(s, "stream-error");
      if (wasStopping) { if (s.meta.status !== "idle") this.setStatus(s, "idle"); return; }
      const tail = stderr();
      this.log.warn("agent.turn_error", { sessionId: s.meta.sessionId, error: e, stderrTail: tail ? redactText(tail.slice(-800)) : undefined });
      this.send(s, { kind: "error", message: rt.launched ? redactText(String(e?.message ?? e)).slice(0, 500) : "The studio couldn't start — try again in a moment, or check Setup.", canRetry: true }); // L50245
      this.setStatus(s, "error");
    }
  }

  /** reduce (L50416) — the event subset this port renders. */
  private reduce(s: Session, m: Record<string, any>, rt: Runtime): void {
    if (s.runtime !== rt || rt.dead) return;
    switch (m.type) {
      case "system":
        if (m.subtype === "init") this.send(s, { kind: "port_runtime", phase: "started", llmRoute: rt.llmRoute, model: m.model, gateProxy: !!rt.handle.proxy, claudeCodeVersion: m.claude_code_version });
        break;
      case "stream_event": {
        if (s.staleResults > 0 || m.parent_tool_use_id) break;
        const e = m.event ?? {};
        if (e.type === "message_start") s.activeMessageId = e.message?.id ?? m.uuid;
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) this.send(s, { kind: "text_delta", text: redactText(e.delta.text), messageId: s.activeMessageId ?? m.uuid, blockIndex: e.index });
        break;
      }
      case "assistant": {
        if (s.staleResults > 0 || m.parent_tool_use_id) break;
        const messageId = m.message?.id ?? s.activeMessageId ?? m.uuid;
        for (const [blockIndex, b] of (m.message?.content ?? []).entries()) {
          if (b?.type === "text") this.send(s, { kind: "assistant_text", text: redactText(b.text ?? ""), messageId, blockIndex });
          else if (b?.type === "thinking") this.send(s, { kind: "thinking", text: redactText(b.thinking ?? "") });
          else if (b?.type === "tool_use") {
            s.openTools.add(b.id);
            const inputSafe = redact(b.input ?? {}) as Record<string, any>;
            this.send(s, { kind: "tool_start", toolName: b.name, toolUseId: b.id, summary: toolSummary(b.name, inputSafe), detail: short(inputSafe), background: !!b.input?.run_in_background });
          }
        }
        break;
      }
      case "user": {
        if (s.staleResults > 0 || m.isReplay === true || !Array.isArray(m.message?.content)) break;
        for (const b of m.message.content) {
          if (b?.type !== "tool_result" || !s.openTools.has(b.tool_use_id)) continue;
          s.openTools.delete(b.tool_use_id);
          this.send(s, { kind: "tool_end", toolUseId: b.tool_use_id, isError: !!b.is_error, terminal: b.is_error ? "error" : "ok" });
        }
        break;
      }
      case "result": {
        const subtype = String(m.subtype ?? "unknown");
        const isError = subtype !== "interrupted" && (m.is_error === true || subtype !== "success");
        this.closeOpenTools(s, isError ? "error" : "abandoned");
        if (Number.isFinite(m.total_cost_usd) && m.total_cost_usd >= 0 && rt.llmRoute === "gateway") s.meta.totalCostUsd = Math.max(s.meta.totalCostUsd, m.total_cost_usd);
        if (s.staleResults > 0) { s.staleResults--; break; } // the Stop already sent its result (L43900)
        this.send(s, { kind: "result", isError, totalCostUsd: s.meta.totalCostUsd, numTurns: m.num_turns ?? 0, durationMs: m.duration_ms ?? 0 });
        if (isError) {
          const detail = Array.isArray(m.errors) && m.errors.length ? `: ${short(m.errors.join("; "), 300)}` : m.api_error_status ? ` (api status ${m.api_error_status})` : "";
          this.send(s, { kind: "error", message: redactText(`The turn ended with ${subtype}${detail}`), canRetry: true });
          this.setStatus(s, "error");
        } else this.setStatus(s, "idle");
        break;
      }
    }
  }

  private closeOpenTools(s: Session, terminal: "cancelled" | "abandoned" | "error"): void {
    for (const id of s.openTools) this.send(s, { kind: "tool_end", toolUseId: id, isError: terminal === "error", terminal });
    s.openTools.clear();
  }

  /** acknowledgedInterrupt (L43844). */
  private async acknowledgedInterrupt(rt: Runtime): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ack = Promise.resolve().then(() => rt.query.interrupt?.());
    void ack.catch(() => {});
    try {
      return await Promise.race([ack.then(() => true, () => false), new Promise<boolean>((r) => { timer = setTimeout(() => r(false), this.d.interruptAckTimeoutMs ?? 8000); (timer as any).unref?.(); })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  /** interrupt (L43860) slice: "stop" | "steer". */
  async interrupt(sessionId: string, reason: string = "steer"): Promise<void> {
    const s = this.mustGet(sessionId);
    if (reason !== "stop" && reason !== "steer") throw new Error("Invalid interruption reason.");
    if (s.interrupting) { await s.interrupting; return; }
    const wasRunning = s.meta.status === "running";
    this.closeOpenTools(s, "cancelled");
    const rt = s.runtime;
    if (wasRunning) {
      const stoppedAfterMs = Math.max(0, this.now() - (s.turnStartedAtMs ?? this.now()));
      this.send(s, { kind: "result", isError: false, totalCostUsd: s.meta.totalCostUsd, numTurns: 0, durationMs: stoppedAfterMs, stoppedAfterMs, stopTurnId: randomUUID() });
    }
    if (s.meta.status !== "idle") this.setStatus(s, "idle");
    if (!rt || rt.dead) return; // nothing launched (or stopped while spawning: sendMessage sees idle and does not queue)
    if (!wasRunning) return;
    s.staleResults++;
    s.interrupting = (async () => {
      try {
        if (!(await this.acknowledgedInterrupt(rt))) {
          this.log.warn("agent.interrupt_ack_timeout", { sessionId, boundMs: this.d.interruptAckTimeoutMs ?? 8000 });
          if (s.runtime === rt) this.teardownRuntime(s, "interrupt-ack-timeout");
        }
      } finally { s.interrupting = undefined; }
    })();
    await s.interrupting;
  }

  /** teardownRuntime (L42932) slice: retire the runtime, close the child, then the gate proxy. */
  teardownRuntime(s: Session, reason: string): void {
    s.epoch++;
    const rt = s.runtime;
    if (!rt) return;
    rt.dead = true;
    s.runtime = undefined;
    s.staleResults = 0;
    this.closeOpenTools(s, "abandoned");
    rt.inputClosed = true;
    rt.wake?.(); rt.wake = null;
    try { rt.query.close?.(); } catch {}
    rt.closed = rt.handle.close().catch((e) => this.log.warn("agent.runtime.proxy_close_failed", { error: e }));
    this.send(s, { kind: "port_runtime", phase: "closed", llmRoute: rt.llmRoute, reason });
    const stats = (rt.handle.proxy as { stats?: () => unknown } | undefined)?.stats?.();
    this.log.info("agent.runtime.closed", { sessionId: s.meta.sessionId, reason, ...(stats ? { gateProxy: stats } : {}) });
  }

  /** onLlmRouteChanged (L43127): retire every runtime not pinned to a builtin literal. */
  onLlmRouteChanged(): { interrupted: AgentSessionMeta[] } {
    const interrupted: AgentSessionMeta[] = [];
    for (const s of this.sessions.values()) {
      if (s.meta.llmRoute === "claude-code" || s.meta.llmRoute === "gateway") continue;
      if (!s.runtime && !s.spawning) continue;
      const wasActive = s.meta.status === "running";
      if (wasActive) interrupted.push({ ...s.meta });
      if (s.runtime) this.teardownRuntime(s, "llm-route-changed");
      else s.epoch++; // a spawn in flight will discard its runtime
      if (wasActive) { this.send(s, { kind: "error", message: ROUTE_CHANGED_MESSAGE, canRetry: true }); this.setStatus(s, "error"); }
      else if (s.meta.status !== "idle") this.setStatus(s, "idle");
    }
    return { interrupted };
  }

  /** App quit: retire everything. */
  async dispose(): Promise<void> {
    const closing: Promise<void>[] = [];
    for (const s of this.sessions.values()) { const rt = s.runtime; if (rt) { this.teardownRuntime(s, "dispose"); if (rt.closed) closing.push(rt.closed); } }
    await Promise.all(closing);
  }
}
