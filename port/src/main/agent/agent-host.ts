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
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import type { LlmRouteId } from "../../shared/llm-types";
import { minimalAgentOptions, type ClaudeAgentSdkLike, type AgentQuery } from "../llm/agent-sdk";
import { getLogger, redact, redactText, registerSecret, type Logger } from "../llm/logger";
import type { SessionMetaLike } from "../llm/route-service";
import { isClientJobId } from "../engine/session";
import {
  adaptClaudeCodeCanUseTool, claudeCodeDisallowedTools, engineChildEnv, engineTurnText, ensureJobDir, firstMessageJobId, isPreexistingJob, listJobIds,
  makeEngineCanUseTool, makeEngineHooks, prepareEngineSpawn, providerRouteHint, sniffJobIds,
  type CanUseToolResult, type EnginePolicyHost, type EngineSessionDeps, type PermissionRequest,
} from "./engine-session";

export type SessionStatus = "idle" | "running" | "awaiting_permission" | "error";
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
  /** Bound production job (commitBind L47615). */
  jobId?: string;
  /** PORT-NEW: marks sessions owned by this host. Never written to sessions.json. */
  portAgentHost: true;
  [k: string]: unknown;
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
  | { kind: "permission_resolved"; requestId: string }
  /** PORT-NEW diagnostic (not an original kind): route/model/SDK the runtime started with. */
  | { kind: "port_runtime"; phase: "started" | "closed"; llmRoute: string; model?: string; gateProxy?: boolean; claudeCodeVersion?: string; reason?: string };

export interface AgentHostEmit {
  sessionEvent(sessionId: string, event: SessionEvent): void;
  sessionsChanged(list: AgentSessionMeta[]): void;
  /** push permission:request (original emit.permissionRequest L61055). */
  permissionRequest?(req: PermissionRequest): void;
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
  /** docs/21 M2: when set, sessions are ENGINE sessions (original spawnLocal): cwd = workspace,
   *  engine env + assembled session context + project hooks + the original permission model, Bash
   *  open, first-message job binding. Unset = the docs/19 confined read-only chat. */
  engine?: EngineSessionDeps;
  /** docs/21 M2: persist the host's session metas (sessions.json writeRegistry L36199). */
  persist?: (rows: Array<Record<string, unknown>>) => void;
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
  /** createSession L38853 snapshot: jobs that existed before this video (never silently bound). */
  preexistingJobs?: Set<string>;
  /** pinSessionContextEpoch: one context epoch per video (persisted). */
  contextEpoch?: string;
  lastUserText?: string;
}
interface PendingPermission { request: PermissionRequest; sessionId: string; runtime?: Runtime; order: number; resolve: (r: CanUseToolResult) => void }

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

export const PORT_PAID_REFUSAL = "Paid generation needs a Videoclaw account, which this build does not have yet. Continue with the free local tools (no paid generation, review or captions)."; // PORT-NEW (M9)

export class AgentHost {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private permissionOrder = 0;
  private readonly log: Logger;
  private sdk?: Promise<{ sdk: ClaudeAgentSdkLike; executable?: string; version?: string }>;
  private readonly tools: string[];
  private readonly now: () => number;
  constructor(private readonly d: AgentHostDeps) {
    this.log = (d.logger ?? getLogger()).child({ component: "agent-host" });
    this.tools = d.tools ?? DEFAULT_AGENT_TOOLS;
    this.now = d.now ?? Date.now;
  }

  listSessions(): AgentSessionMeta[] {
    // listSessions L38348: meta + liveWork snapshot + media recovery (not ported → [] / false)
    return [...this.sessions.values()].sort((a, b) => b.meta.createdAt - a.meta.createdAt).map((s) => ({ ...s.meta, ...(this.d.engine ? { liveWork: [], mediaRecoveryNeeded: false } : {}) }));
  }
  /** writeRegistry (L36199) projection: what goes to sessions.json (no live/port-only fields). */
  registryRows(): Array<Record<string, unknown>> {
    return [...this.sessions.values()].map((s) => {
      const { portAgentHost: _p, liveWork: _l, mediaRecoveryNeeded: _m, turnStartedAtMs: _t, ...persisted } = s.meta as Record<string, unknown>;
      return { ...persisted, ...(s.contextEpoch ? { contextEpoch: s.contextEpoch } : {}) };
    });
  }
  private saveRegistry(): void {
    if (!this.d.persist) return;
    try { this.d.persist(this.registryRows()); } catch (e) { this.log.warn("agent.registry.save_failed", { error: e }); }
  }
  /** loadRegistry (L35661) hand-off: adopt the healed sessions.json rows so a restarted app can
   *  list and continue them (a fresh runtime; SDK resume is not ported). */
  restoreSessions(rows: Array<Record<string, any>>): number {
    let n = 0;
    for (const row of rows) {
      if (!row || typeof row.sessionId !== "string" || this.sessions.has(row.sessionId)) continue;
      const { liveWork: _l, mediaRecoveryNeeded: _m, contextEpoch, ...meta } = row;
      this.sessions.set(row.sessionId, { meta: { ...meta, status: "idle", portAgentHost: true } as AgentSessionMeta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0, ...(typeof contextEpoch === "string" ? { contextEpoch } : {}) });
      n++;
    }
    return n;
  }
  has(sessionId: string): boolean { return this.sessions.has(sessionId); }
  /** Test/diagnostic view (no secrets). */
  runtimeInfo(sessionId: string): { running: boolean; llmRoute?: string; status?: string } {
    const s = this.sessions.get(sessionId);
    return { running: !!s?.runtime && !s.runtime.dead, llmRoute: s?.runtime?.llmRoute, status: s?.meta.status };
  }

  /** createSession (L38726) slice: id, cwd, route pin, status idle, session:changed. */
  createSession(req: { title?: string; clientId?: string; permissionMode?: string } = {}): AgentSessionMeta {
    const sessionId = randomUUID();
    let cwd: string;
    if (this.d.engine) {
      // resolveSessionCwd (L36115): an installed engine → the channel-owned workspace, created on demand
      cwd = this.d.engine.workspaceRoot();
      mkdirSync(cwd, { recursive: true });
    } else {
      cwd = join(this.d.sessionsRoot, sessionId);
      mkdirSync(cwd, { recursive: true });
      // a small fixture so a read-only tool call has something to find (PORT-NEW)
      writeFileSync(join(cwd, "README.txt"), "Videoclaw port agent session folder.\n");
    }
    const llmRoute = this.d.service.newSessionLlmRoute({});
    const meta: AgentSessionMeta = {
      sessionId, title: typeof req?.title === "string" && req.title ? req.title.slice(0, 120) : "New video", cwd, status: "idle",
      permissionMode: typeof req?.permissionMode === "string" ? req.permissionMode : "auto", totalCostUsd: 0, createdAt: this.now(),
      clientId: typeof req?.clientId === "string" ? req.clientId : "personal", agentHarness: "claude-code", ...(llmRoute ? { llmRoute } : {}), portAgentHost: true,
    };
    this.sessions.set(sessionId, { meta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0, ...(this.d.engine ? { preexistingJobs: listJobIds(cwd) } : {}) });
    this.log.info("agent.session.created", { sessionId, llmRoute, engine: !!this.d.engine });
    this.saveRegistry();
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
  private activeTurns(): number { let n = 0; for (const s of this.sessions.values()) if (s.meta.status === "running" || s.meta.status === "awaiting_permission") n++; return n; }

  /** sendMessage (L41400) slice. Resolves when the message is queued into the runtime. */
  async sendMessage(sessionId: string, input: string | { text: string; clientTurnId?: string; attachmentIds?: string[] }): Promise<{ submitted: true; duplicate: boolean; attachmentIds: string[] }> {
    const s = this.mustGet(sessionId);
    if (s.interrupting) await s.interrupting;
    const req = typeof input === "string" ? { text: input, clientTurnId: "", attachmentIds: [] as string[] } : { text: String(input?.text ?? ""), clientTurnId: String(input?.clientTurnId ?? ""), attachmentIds: input?.attachmentIds ?? [] };
    if (req.attachmentIds.length) throw new ComposerDeliveryError("Attachments are not supported in this port yet.");
    if (!req.text.trim()) throw new Error("Write a message or attach a file before sending."); // L41445
    if (req.clientTurnId && s.clientTurns.has(req.clientTurnId)) return { submitted: true, duplicate: true, attachmentIds: [] };
    if (s.meta.status === "running" || s.meta.status === "awaiting_permission") throw new ComposerDeliveryError("This video is still working. Wait for the reply or press Stop.");
    const limit = this.d.maxConcurrentTurns ?? 1;
    if (this.activeTurns() >= limit) throw new ComposerDeliveryError(`Another video is still working (this port runs ${limit} agent turn${limit === 1 ? "" : "s"} at a time). Wait for it or press Stop there.`);
    // claim the turn slot before any await so two concurrent sends cannot both pass the gate
    if (req.clientTurnId) s.clientTurns.add(req.clientTurnId);
    let wireText = req.text;
    if (this.d.engine) {
      // submitPreparedMessage L41559-41600: first message mints + binds the job, then the turn text
      // carries the app-owned session policy and production id.
      s.lastUserText = req.text;
      const jobId = firstMessageJobId(s.meta as any, req.text);
      if (jobId) {
        try { ensureJobDir(s.meta.cwd, jobId); } catch (e: any) { if (req.clientTurnId) s.clientTurns.delete(req.clientTurnId); throw new ComposerDeliveryError(redactText(String(e?.message ?? e))); }
        this.commitBind(s, jobId, "first-message");
      }
      wireText = engineTurnText(s.meta as any, req.text);
    }
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
    const timeoutMs = this.d.turnTimeoutMs ?? (this.d.engine ? 20 * 60_000 : 5 * 60_000);
    s.turnTimer = setTimeout(() => { if (s.meta.status === "running" || s.meta.status === "awaiting_permission") { this.send(s, { kind: "error", message: `The turn did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`, canRetry: true }); this.teardownRuntime(s, "turn-timeout"); this.setStatus(s, "error"); } }, timeoutMs);
    (s.turnTimer as any).unref?.();
    rt.queue.push({ type: "user", message: { role: "user", content: [{ type: "text", text: wireText }] }, parent_tool_use_id: null, session_id: "", uuid: randomUUID() });
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
    // spawnLocal L39461-39495: engine env (+ bound job, pinned context epoch) and the assembled
    // session context are computed BEFORE the runtime starts, so a broken engine fails fast.
    const engineSpawn = this.d.engine ? prepareEngineSpawn(this.d.engine, s.meta as any, s.contextEpoch) : undefined;
    if (engineSpawn?.contextEpoch && engineSpawn.contextEpoch !== s.contextEpoch) { s.contextEpoch = engineSpawn.contextEpoch; this.saveRegistry(); }
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
    let stderr = "";
    let options: Record<string, unknown>;
    if (this.d.engine && engineSpawn) {
      options = this.engineQueryOptions(s, handle, engineSpawn, executable, (t) => { stderr = (stderr + t).slice(-4000); });
    } else {
      const policy = confinedToolPolicy(s.meta.cwd, this.tools);
      const canUseTool = async (name: string, toolInput: Record<string, unknown>) => {
        const v = policy(name, toolInput);
        this.log.info("agent.tool.permission", { sessionId: s.meta.sessionId, tool: name, allowed: v.allowed });
        return v.allowed ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: v.reason ?? "not allowed" };
      };
      options = minimalAgentOptions(
        { runtime: handle, prompt: "", cwd: s.meta.cwd, executable, allowedTools: this.tools, maxTurns: this.d.maxTurns ?? 8, includePartialMessages: true },
        { canUseTool, stderr: (t) => { stderr = (stderr + t).slice(-4000); } },
      );
    }
    rt.query = sdk.query({ prompt: input, options });
    s.runtime = rt;
    this.send(s, { kind: "port_runtime", phase: "started", llmRoute: handle.llmRoute, model: handle.model, gateProxy: !!handle.proxy });
    this.log.info("agent.runtime.started", { sessionId: s.meta.sessionId, llmRoute: handle.llmRoute, model: handle.model, gateProxy: !!handle.proxy, engine: !!engineSpawn, boundJob: engineSpawn?.engineEnv.VIDEOCLAW_BOUND_JOB, lawsVersion: engineSpawn?.lawsVersion, appendBytes: engineSpawn ? Buffer.byteLength(engineSpawn.append) : undefined });
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
        const wasRunning = s.meta.status === "running" || s.meta.status === "awaiting_permission";
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
            if (this.d.engine && !s.meta.jobId) this.maybeBindJob(s, JSON.stringify(b.input ?? {})); // L50644
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

  /** createLocalRuntime options (L23237-23314) for an engine session. */
  private engineQueryOptions(s: Session, handle: AgentRuntimeHandle, sp: { engineEnv: Record<string, string>; append: string }, executable: string | undefined, stderr: (t: string) => void): Record<string, unknown> {
    const sessionId = s.meta.sessionId;
    const engine = this.d.engine!;
    const policyHost: EnginePolicyHost = {
      sessionCwd: (id) => this.sessions.get(id)?.meta.cwd,
      sessionJobId: (id) => this.sessions.get(id)?.meta.jobId,
      sessionPlanRefusal: () => undefined, // no plan can exist (propose_session_plan not ported) → L45xxx returns undefined
      askHuman: (req, signal) => this.askHuman(req, signal),
      paidRefusal: () => PORT_PAID_REFUSAL,
      log: (event, detail) => this.log.info(event, detail),
    };
    const permissionMode = String(s.meta.permissionMode || "auto");
    return {
      cwd: s.meta.cwd,
      permissionMode,
      // PORT: this SDK version requires the explicit opt-in for the original "Bypass" mode
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      includePartialMessages: true,
      model: handle.model,
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      settings: { autoCompactEnabled: true, autoCompactWindow: 2e5 },
      // Project settings carry the verified SessionStart/PreToolUse/Stop hooks (engine .claude/settings.json)
      settingSources: ["project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: [sp.append, providerRouteHint(String(handle.llmRoute))].filter(Boolean).join("\n\n") },
      disallowedTools: claudeCodeDisallowedTools(),
      allowedTools: [], // claudeCodeAllowedTools(): studio self-authorizing MCP tools — no studio MCP in the port
      canUseTool: adaptClaudeCodeCanUseTool(makeEngineCanUseTool(engine, policyHost, sessionId, sp.engineEnv)),
      hooks: makeEngineHooks(engine, policyHost, sessionId, sp.engineEnv),
      mcpServers: {}, // studio MCP (L48511) not ported
      strictMcpConfig: true,
      // PORT-NEW safety net (the original sets none): bounds a looping model on a shared key
      maxTurns: this.d.maxTurns ?? 120,
      persistSession: false, // resume/history not ported (docs/21 §deferred)
      env: engineChildEnv(handle.env, sp.engineEnv, !!sp.engineEnv.VIDEOCLAW_ENGINE),
      stderr,
    };
  }

  /** maybeBindJob (L47576) — silent sniff bind of a NEW job this video started. */
  private maybeBindJob(s: Session, haystack: string): void {
    if (s.meta.jobId) return;
    for (const id of sniffJobIds(haystack)) {
      if (this.jobOwnedElsewhere(s.meta.sessionId, id, s.meta.cwd)) continue;
      if (isPreexistingJob(s.preexistingJobs, s.meta.cwd, s.meta.createdAt, id)) continue;
      if (existsSync(join(s.meta.cwd, "jobs", id))) { this.commitBind(s, id, "sniff"); return; }
      // schedulePendingBind (L47731) not ported: a job dir that does not exist yet is not bound
    }
  }
  private jobOwnedElsewhere(sessionId: string, jobId: string, cwd: string): boolean { // jobOwners L47548
    for (const o of this.sessions.values()) if (o.meta.sessionId !== sessionId && o.meta.jobId === jobId && o.meta.cwd === cwd) return true;
    return false;
  }
  /** commitBind (L47615): persist, surface. Not ported: spend-accounting resets, JobWatcher
   *  (ensureWatcher → M3), beacon. rotateRuntimeForJobAttribution: an idle live runtime is retired so
   *  the next spawn pins VIDEOCLAW_BOUND_JOB; a RUNNING turn keeps its runtime (no replay — divergence). */
  commitBind(s: Session, jobId: string, via: string): void {
    if (!isClientJobId(jobId)) return;
    const changed = s.meta.jobId !== jobId;
    s.meta.jobId = jobId;
    delete (s.meta as any).adoptCandidate;
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
    this.log.info("agent.job.bound", { sessionId: s.meta.sessionId, jobId, via });
    if (changed && s.runtime && !s.runtime.dead && s.meta.status !== "running" && s.meta.status !== "awaiting_permission") this.teardownRuntime(s, "job-attribution");
  }

  /** canUseTool → permission card: rememberPermission + emit.permissionRequest (L50060-50085). */
  private askHuman(req: PermissionRequest, signal?: AbortSignal): Promise<CanUseToolResult> {
    const s = this.sessions.get(req.sessionId);
    if (!s) return Promise.resolve({ behavior: "deny", message: "Session runtime changed", interrupt: true });
    return new Promise<CanUseToolResult>((resolve) => {
      this.pendingPermissions.set(req.requestId, { request: req, sessionId: req.sessionId, runtime: s.runtime, order: ++this.permissionOrder, resolve });
      this.setStatus(s, "awaiting_permission");
      this.log.info("agent.permission.request", { sessionId: req.sessionId, requestId: req.requestId, kind: req.kind, tool: req.toolName });
      try { this.d.emit.permissionRequest?.(req); } catch (e) { this.log.warn("agent.emit_failed", { error: e }); }
      signal?.addEventListener("abort", () => {
        if (this.pendingPermissions.delete(req.requestId)) {
          this.send(s, { kind: "permission_resolved", requestId: req.requestId });
          if (s.meta.status === "awaiting_permission") this.setStatus(s, "running");
          resolve({ behavior: "deny", message: "Aborted", interrupt: true });
        }
      });
    });
  }
  /** respondPermission (L44432) for ordinary permission / question cards. */
  respondPermission(requestId: string, response: { behavior?: string; message?: string; updatedInput?: Record<string, unknown>; answers?: unknown } | undefined): void {
    const pending = this.pendingPermissions.get(String(requestId));
    if (!pending) return;
    this.pendingPermissions.delete(String(requestId));
    const s = this.sessions.get(pending.sessionId);
    if (s) this.send(s, { kind: "permission_resolved", requestId: pending.request.requestId });
    if (s && s.meta.status === "awaiting_permission") this.setStatus(s, "running"); // resumeAfterInteraction
    this.log.info("agent.permission.response", { sessionId: pending.sessionId, requestId, behavior: response?.behavior });
    if (response?.behavior === "allow") {
      const base = response.updatedInput ?? pending.request.input;
      pending.resolve({ behavior: "allow", updatedInput: response.answers !== undefined ? { ...base, answers: response.answers } : base });
    } else pending.resolve({ behavior: "deny", message: response?.message || "The user declined this step." });
  }
  /** listPendingInteractions (L38511) → interaction:replayPending. */
  listPendingInteractions(): Array<{ kind: "permission"; request: PermissionRequest; order: number }> {
    return [...this.pendingPermissions.values()].map((p) => ({ kind: "permission" as const, request: p.request, order: p.order })).sort((a, b) => a.order - b.order);
  }
  private cancelPendingPermissions(s: Session, rt?: Runtime): void {
    for (const [id, p] of this.pendingPermissions) {
      if (p.sessionId !== s.meta.sessionId || (rt && p.runtime !== rt)) continue;
      this.pendingPermissions.delete(id);
      this.send(s, { kind: "permission_resolved", requestId: id });
      p.resolve({ behavior: "deny", message: "Aborted", interrupt: true });
    }
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
    const wasRunning = s.meta.status === "running" || s.meta.status === "awaiting_permission";
    this.cancelPendingPermissions(s);
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
    this.cancelPendingPermissions(s, rt);
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
      const wasActive = s.meta.status === "running" || s.meta.status === "awaiting_permission";
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
