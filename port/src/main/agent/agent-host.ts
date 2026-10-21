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
// docs/21 M2 added engine sessions, job binding, permission cards, sessions.json; docs/22 M3/M4 add
//   the original VersionStore + JobWatchers (job snapshots, versions, approve/finalize) and the
//   ComposerAttachmentStore (stage → materialize on Send).
// docs/24: session titles (fallback naming verbatim + PORT-NEW provider-route proposal, session-title.ts).
// docs/25: session:history replays the display-transcript sidecar + the SDK transcript (resume on respawn).
// DEFERRED: spend gates, studio MCP,
//   steer/queued turns, retry, setModel/setPermissionMode, materials ledger, done-accounting.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from "node:path";
import { JobWatcher, VersionStore, resolveCut, scanJob } from "../jobs/version-store.generated";
import { deletionBlockMessage, moveProjectToTrash, planProjectTrash, PROJECT_TRASH_RETENTION_MS } from "../jobs/project-trash.generated";
import { assembleOriginalVideoContext, readPromiseBrief } from "../jobs/original-context.generated";
import { MaterialsLedger } from "../materials/materials-ledger.generated";
import { SessionSpendBudgets, spendBudgetAuthority } from "../spend/spend-budgets.generated";
import { normalizeSpendCeilingUsd } from "../spend/spend-wb.generated";
import { resolveJobDir } from "../engine/job-boundary";
import { attachmentContextLines, ComposerAttachmentStore, composerTurnMessageUuid } from "../attachments/composer-attachments.generated";
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
import { fallbackSessionTitle, NEW_VIDEO_TITLE } from "./session-title.generated";
import { CodexAppServerClient, CodexProcessCapacityError } from "../codex/app-server-client";
import { codexChildEnv, codexEventToSdkMessages } from "../codex/codex-protocol.generated";
import { codexRouteDiagnostic, isQualifiedCodexRoute } from "../codex/codex-routes.generated";
import { codexQuery, createCodexRuntime } from "../codex/codex-runtime";
import { ensureCodexProfile, startCodexMiniMaxBackend, type CodexMiniMaxBackend } from "../codex/codex-minimax";
import { CodexRouteController, DEFAULT_CODEX_PROVIDER, resolvedAgentHarness, resolvedCodexProvider } from "../codex/codex-host";
import type { ResolvedProvider } from "../llm/provider-registry";
import { PORT_PROVIDER_TITLES_ENV, proposeProviderSessionTitle, type HelperComplete } from "./session-title";
import {
  appendDisplayMaterial, appendDisplayStop, appendDisplayTranscript, displayTranscriptPath, historyToEvents, isDisplayTurnId, isFlattenedClaudeCompactedHistory,
  readDisplayTranscript, rejectedFallbackMessageIds, sdkUserMessageText, visibleInSdkHistory,
} from "./history.generated";

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
  agentHarness: "claude-code" | "codex-app-server";
  /** docs/27: the Codex inference account slot (createSession L38764) */
  codexProvider?: string;
  modelOverride?: string;
  codexReasoningEffort?: string;
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
  /** approveVersion (L47513): the approval line shown in the transcript. */
  | { kind: "user_text"; text: string }
  /** PORT-NEW diagnostic (not an original kind): route/model/SDK the runtime started with. */
  | { kind: "port_runtime"; phase: "started" | "closed"; llmRoute: string; model?: string; gateProxy?: boolean; claudeCodeVersion?: string; reason?: string };

export interface AgentHostEmit {
  sessionEvent(sessionId: string, event: SessionEvent): void;
  sessionsChanged(list: AgentSessionMeta[]): void;
  /** push permission:request (original emit.permissionRequest L61055). */
  permissionRequest?(req: PermissionRequest): void;
  /** push job:snapshot {sessionId, snapshot} (original emit.jobSnapshot L61077). */
  jobSnapshot?(sessionId: string, snapshot: any): void;
  /** docs/26: push materials:changed (original emit.materials L61095). */
  materials?(sessionId: string, ledger: unknown): void;
  /** docs/26: push spend:snapshot {sessionId, snapshot} (original emit.spendSnapshot L61086). */
  spendSnapshot?(sessionId: string, snapshot: unknown): void;
}
export interface AgentRuntimeHandle { llmRoute: LlmRouteId; model: string | undefined; env: Record<string, string>; proxy?: unknown; close(): Promise<void> }
export interface AgentHostRouteService {
  newSessionLlmRoute(o?: { runtime?: string; agentHarness?: string }): LlmRouteId | undefined;
  llmRouteReadiness(meta?: SessionMetaLike): Promise<Record<string, unknown> | undefined>;
  sessionAgentRuntime(meta: SessionMetaLike): Promise<AgentRuntimeHandle>;
  /** docs/24: the video's resolved route (L40823) and a helper call on its behalf (title proposal). */
  sessionLlmRoute?(meta: SessionMetaLike): LlmRouteId;
  sessionHelperComplete?(meta: SessionMetaLike | undefined, body: Record<string, unknown>, opts: { timeoutMs: number; deadlineMs?: number; signal?: AbortSignal }): ReturnType<HelperComplete>;
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
  /** docs/24: PORT-NEW provider-route title proposals (default on; VIDEOCLAW_PORT_PROVIDER_TITLES=0 disables). */
  providerTitles?: boolean;
  /** docs/21 M2: persist the host's session metas (sessions.json writeRegistry L36199). */
  persist?: (rows: Array<Record<string, unknown>>) => void;
  /** docs/22 M3/M4: the registry directory (original dirname(registryFile) = userData). When set
   *  (engine mode), the host owns the ORIGINAL VersionStore (versions.json, L34848) + JobWatchers
   *  and the ComposerAttachmentStore (composer-attachments.json, L34841). */
  stateDir?: string;
  /** docs/25: the engine runtime profile dir (route-service profileDir = userData/engine-profile, the child's
   *  CLAUDE_CONFIG_DIR) — where the SDK writes the per-video transcript that session:history replays. */
  engineProfileDir?: () => string;
  /** docs/25: the project order (clients) listSessions (L38348) ranks videos by. */
  clientOrder?: () => string[];
  /** docs/26: the registry half deleteProject (L39248) needs — trashWorkspaces, a synchronous flush,
   *  and the removedSessionIds tombstone a whole-file write must honour. */
  registry?: { addTrashWorkspace(path: string): void; flush(): boolean; markRemoved(sessionId: string): void; unmarkRemoved(sessionId: string): void };
  /** docs/26: setJobBusyProbe (L39083) — an editor render / HyperFrames preview holding a job's files. */
  jobBusyProbe?: (jobId: string) => boolean;
  /** docs/27: the Codex harness (agentHarness "codex-app-server"), backed by MiniMax through the gate proxy. */
  codex?: AgentHostCodexDeps;
}
export interface AgentHostCodexDeps {
  /** settings.get() — agentHarness / codexProvider / codexModel (resolvedAgentHarness L324) */
  settings(): Record<string, unknown>;
  profileDir(): string;
  executable(): string;
  appVersion?: string;
  provider(): ResolvedProvider | null;
  /** tests: a fake backend / client */
  startBackend?: (p: ResolvedProvider) => Promise<CodexMiniMaxBackend>;
  createClient?: Parameters<typeof createCodexRuntime>[0]["createClient"];
  discoverModels?: ConstructorParameters<typeof CodexRouteController>[0]["discoverModels"];
  accountStatus?: ConstructorParameters<typeof CodexRouteController>[0]["accountStatus"];
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
  /** nameSession / cancelSessionTitle (L41772-41805). */
  titleRequest?: AbortController;
  titleCancellation?: number;
  /** docs/25: last assistant message id (display-transcript anchor, persistDisplayTurn L41820). */
  lastAssistantMessageId?: string;
  /** docs/26: the batch delivered to the live turn; becomes failedInputs when the turn errors (retryTurn L42565). */
  inflight?: DeliveredInput[];
  failedInputs?: DeliveredInput[];
  failedTurnCanRetry?: boolean;
  /** publishMaterials (L44932) digest of the last pushed ledger. */
  materialsDigest?: string;
}
interface DeliveredInput { msg: Record<string, any>; displayTexts: string[]; attachmentIds: string[] }
interface PendingPermission { request: PermissionRequest; sessionId: string; runtime?: Runtime; order: number; resolve: (r: CanUseToolResult) => void }

export const DEFAULT_AGENT_TOOLS = ["Read", "Glob", "Grep"];
const PATH_KEYS = ["file_path", "path", "notebook_path"];
/** FALLBACK_EVIDENCE_MARKERS (L34378). */
const FALLBACK_EVIDENCE_MARKERS = ["supersedes", "retractedMessageUuids", "retracted_message_uuids"];
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
  /** docs/22 M3: original AgentHost.versionStore / watchers (L34848, L47956). */
  readonly versionStore?: any;
  private readonly watchers = new Map<string, any>();
  /** docs/22 M4: original AgentHost.attachmentStore (L34841). */
  readonly attachmentStore?: any;
  /** sends between the turn-slot claim and the runtime enqueue (attachment copies, job mint) */
  private readonly preparing = new Set<string>();
  /** docs/26: deleteProject latch (L39154). */
  private readonly deletingSessions = new Set<string>();
  /** docs/26: MaterialsLedger (L34844) + SessionSpendBudgets (L34832). */
  readonly materialsLedger?: any;
  readonly spendBudgets: any;
  private spendBudgetFile?: string;
  /** #479 quickstartResume (setQuickstartResume L38880). */
  private quickstartResume?: (meta: AgentSessionMeta) => boolean;
  /** docs/27: the Codex-route half of the original AgentHost (codex-host.ts). */
  readonly codex?: CodexRouteController;
  constructor(private readonly d: AgentHostDeps) {
    this.log = (d.logger ?? getLogger()).child({ component: "agent-host" });
    if (d.codex) {
      const c = d.codex;
      this.codex = new CodexRouteController({
        settings: () => c.settings(), profileDir: () => c.profileDir(), executable: () => c.executable(), appVersion: c.appVersion, provider: () => c.provider(),
        discoverModels: c.discoverModels, accountStatus: c.accountStatus,
        persist: () => this.saveRegistry(), sessionsChanged: () => this.d.emit.sessionsChanged(this.listSessions()),
      });
    }
    this.tools = d.tools ?? DEFAULT_AGENT_TOOLS;
    this.now = d.now ?? Date.now;
    if (d.engine && d.stateDir) {
      // L34848: onNewVersion → outbox job-log/job-final uploads + noteNewVersion ("done" notify);
      // the port has no outbox/gateway, so the hook only logs (NOT PORTED: uploads, videoDone).
      this.versionStore = new VersionStore(join(d.stateDir, "versions.json"), (jobId: string, _jobPath: string, version: any, event: string) => {
        this.log.info("agent.version.new", { jobId, n: version?.n, event });
      }, d.engine.workspaceRoot());
      this.attachmentStore = new ComposerAttachmentStore(join(d.stateDir, "composer-attachments.json"));
      this.materialsLedger = new MaterialsLedger(d.stateDir);
    }
    // L34832: the per-video spend ledger. No gateway key exists in the port → the original's
    // spendBudgetAuthority(gatewayUrl, undefined) authority; persisted to spend-budgets.json (L34826).
    this.spendBudgetFile = d.stateDir ? join(d.stateDir, "spend-budgets.json") : undefined;
    this.spendBudgets = new SessionSpendBudgets(
      (sessionId: string, snapshot: unknown) => { try { this.d.emit.spendSnapshot?.(sessionId, snapshot); } catch {} },
      (state: unknown) => this.writeSpendBudgets(state),
      spendBudgetAuthority("http://localhost", undefined),
    );
    this.loadSpendBudgets();
  }

  listSessions(): AgentSessionMeta[] {
    // listSessions L38348: meta + liveWork snapshot + media recovery (not ported → [] / false), ordered by
    // project rank, then sidebarOrder (session:reorder), then newest first (docs/25: verbatim sort)
    const projectRank = new Map((this.d.clientOrder?.() ?? []).map((clientId, index) => [clientId, index]));
    return [...this.sessions.values()]
      .map((s) => ({ ...s.meta, ...(this.d.engine ? { liveWork: [], mediaRecoveryNeeded: false } : {}) }) as AgentSessionMeta)
      .sort((a, b) => {
        const projectDelta = (projectRank.get(a.clientId) ?? Number.MAX_SAFE_INTEGER) - (projectRank.get(b.clientId) ?? Number.MAX_SAFE_INTEGER);
        if (projectDelta !== 0) return projectDelta;
        const aOrder = a.sidebarOrder as number | undefined;
        const bOrder = b.sidebarOrder as number | undefined;
        if (aOrder !== void 0 || bOrder !== void 0) {
          if (aOrder === void 0) return 1;
          if (bOrder === void 0) return -1;
          if (aOrder !== bOrder) return aOrder - bOrder;
        }
        return b.createdAt - a.createdAt;
      });
  }
  /** reorderSessions (L38482) — session:reorder. */
  reorderSessions(clientId: string, sessionIds: string[]): AgentSessionMeta[] {
    const owned = [...this.sessions.values()].filter((session2) => session2.meta.clientId === clientId).map((session2) => session2.meta.sessionId);
    const current = new Set(owned);
    if (sessionIds.length !== owned.length || new Set(sessionIds).size !== sessionIds.length || sessionIds.some((sessionId) => !current.has(sessionId))) {
      throw new Error("video reorder must contain every video in one project exactly once");
    }
    sessionIds.forEach((sessionId, sidebarOrder) => {
      const session2 = this.sessions.get(sessionId);
      if (!session2 || session2.meta.clientId !== clientId) throw new Error("video reorder cannot move a video between projects");
      session2.meta.sidebarOrder = sidebarOrder;
    });
    const next = this.listSessions();
    this.d.emit.sessionsChanged(next);
    this.saveRegistry();
    return next;
  }
  /** renameSession (L38915) — session:rename: inline sidebar rename, persisted. */
  renameSession(sessionId: string, title: string): AgentSessionMeta | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    const next = String(title ?? "").trim();
    if (!next) return s.meta;
    this.cancelSessionTitle(s);
    s.meta.titleOrigin = "manual";
    s.meta.title = next.length > 80 ? next.slice(0, 79) + "…" : next;
    this.d.emit.sessionsChanged(this.listSessions());
    this.saveRegistry();
    return s.meta;
  }
  /** setPermissionMode (L43987) + deferPermissionMode (L44025) + applyPermissionMode slice — session:setPermissionMode.
   *  NOT PORTED: spend policy (no spend ledger → never "capped"), codex containment, credit handoffs,
   *  applyPendingPermissionMode at turn end (a deferred pick applies on the next send). */
  async setPermissionMode(sessionId: string, mode: string, _options?: { confirmSpendLimitRemoval?: boolean }): Promise<void> {
    const s = this.mustGet(sessionId);
    if (typeof mode !== "string" || !["default", "acceptEdits", "auto", "plan", "bypassPermissions"].includes(mode)) throw new Error("Invalid permission mode.");
    delete s.meta.permissionModeSwitchFailed;
    if (s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(sessionId)) {
      if (mode === s.meta.permissionMode) delete s.meta.pendingPermissionMode;
      else s.meta.pendingPermissionMode = mode;
      this.saveRegistry();
      this.d.emit.sessionsChanged(this.listSessions());
      return;
    }
    delete s.meta.pendingPermissionMode;
    const runtime = s.runtime && !s.runtime.dead ? s.runtime : undefined;
    if (runtime) {
      try { await (runtime.query as any).setPermissionMode?.(mode); } catch { if (s.runtime === runtime) this.teardownRuntime(s, "permission-mode"); }
    }
    s.meta.permissionMode = mode;
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
  }
  /** removeSession (L39046) slice for client:remove — sidebar record only; files stay on disk. */
  removeSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    this.teardownRuntime(s, "removed");
    this.retireWatcher(sessionId);
    this.cancelSessionTitle(s);
    this.sessions.delete(sessionId);
    this.d.emit.sessionsChanged(this.listSessions());
    this.saveRegistry();
    return true;
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

  /** createSession (L38726) slice: id, cwd, route pin, status idle, session:changed. docs/26: the
   *  continuation branch (continueFromSessionId → same cwd/route/client, "· continued", adoptCandidate),
   *  Quickstart provenance (meta.quickstart), sidebarOrder at the top of the project, internal sessionId. */
  createSession(req: { title?: string; clientId?: string; permissionMode?: string; continueFromSessionId?: string } = {}, quickstart?: Record<string, unknown>, internal?: { sessionId?: string; deferJobAdoption?: boolean }): AgentSessionMeta {
    const sessionId = internal?.sessionId ?? randomUUID();
    const continued = req?.continueFromSessionId ? this.sessions.get(req.continueFromSessionId) : undefined;
    if (req?.continueFromSessionId && !continued) throw new Error("The conversation to continue no longer exists.");
    const priorContinuation = continued ? this.completedContinuation(continued) : undefined;
    if (priorContinuation) {
      if (!internal?.deferJobAdoption && continued?.meta.jobId && !priorContinuation.meta.jobId && (priorContinuation.meta.adoptCandidate as any)?.jobId === continued.meta.jobId) {
        return (this.adoptJob(priorContinuation.meta.sessionId, continued.meta.jobId) ?? priorContinuation.meta) as AgentSessionMeta;
      }
      return priorContinuation.meta;
    }
    let cwd: string;
    if (continued) cwd = continued.meta.cwd;
    else if (this.d.engine) {
      // resolveSessionCwd (L36115): an installed engine → the channel-owned workspace, created on demand
      cwd = this.d.engine.workspaceRoot();
      mkdirSync(cwd, { recursive: true });
    } else {
      cwd = join(this.d.sessionsRoot, sessionId);
      mkdirSync(cwd, { recursive: true });
      // a small fixture so a read-only tool call has something to find (PORT-NEW)
      writeFileSync(join(cwd, "README.txt"), "Videoclaw port agent session folder.\n");
    }
    // createSession L38755-38800: the harness + Codex account slot + model pin of a new video
    const codexSettings = this.d.codex?.settings() ?? {};
    const agentHarness = continued ? (continued.meta.agentHarness ?? "claude-code") : (this.codex ? resolvedAgentHarness(codexSettings) : "claude-code");
    const codexProvider = continued ? ((continued.meta.codexProvider as string | undefined) ?? DEFAULT_CODEX_PROVIDER) : resolvedCodexProvider(codexSettings);
    const codexModelOverride = agentHarness === "codex-app-server" ? (continued ? (continued.meta.modelOverride as string | undefined) : this.codex!.accountCodexModel(codexProvider)) : undefined;
    if (agentHarness === "codex-app-server") {
      if (!this.codex) throw new Error("Codex is unavailable right now.");
      this.codex.assertEnabled();
      if (codexProvider !== "chatgpt" && !isQualifiedCodexRoute(codexProvider, codexModelOverride, this.codex.evidence)) throw new Error((codexRouteDiagnostic as any)(codexProvider, codexModelOverride, this.codex.evidence));
    }
    const llmRoute = agentHarness !== "claude-code" ? undefined : continued ? continued.meta.llmRoute : this.d.service.newSessionLlmRoute({});
    const clientId = continued?.meta.clientId ?? (typeof req?.clientId === "string" ? req.clientId : "personal");
    const existingSidebarOrders = [...this.sessions.values()].filter((o) => o.meta.clientId === clientId).map((o) => o.meta.sidebarOrder as number | undefined).filter((order): order is number => order !== undefined);
    const sidebarOrder = existingSidebarOrders.length ? Math.min(...existingSidebarOrders) - 1 : undefined;
    const title = continued ? `${continued.meta.title} · continued` : typeof req?.title === "string" && req.title ? req.title.slice(0, 120) : NEW_VIDEO_TITLE;
    const meta: AgentSessionMeta = {
      sessionId, title, ...(continued || (typeof req?.title === "string" && req.title) ? { titleOrigin: "manual" } : {}), cwd, status: "idle",
      permissionMode: typeof req?.permissionMode === "string" ? req.permissionMode : "auto", totalCostUsd: 0, createdAt: this.now(),
      clientId, ...(sidebarOrder !== undefined ? { sidebarOrder } : {}), agentHarness,
      ...(agentHarness === "codex-app-server" ? { codexProvider, ...(codexModelOverride ? { modelOverride: codexModelOverride } : {}) } : {}),
      ...(llmRoute ? { llmRoute } : {}),
      ...(quickstart ? { quickstart } : {}),
      ...(continued?.meta.jobId ? { adoptCandidate: { jobId: continued.meta.jobId, reason: "owned", ownerSessionId: continued.meta.sessionId, ownerTitle: continued.meta.title } } : {}),
      portAgentHost: true,
    };
    this.sessions.set(sessionId, { meta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0, ...(this.d.engine ? { preexistingJobs: listJobIds(cwd) } : {}) });
    if (!continued) { try { this.spendBudgets.setUnlimited(sessionId); } catch (e) { this.log.warn("agent.spend.set_unlimited_failed", { sessionId, error: e }); } } // L38866
    this.log.info("agent.session.created", { sessionId, llmRoute, agentHarness, engine: !!this.d.engine, continued: !!continued, quickstart: !!quickstart });
    if (continued && !internal?.deferJobAdoption) continued.meta.continuation = { clientActionId: `recovery:${sessionId}`, sessionId };
    if (continued?.meta.jobId && !internal?.deferJobAdoption) return (this.adoptJob(sessionId, continued.meta.jobId) ?? meta) as AgentSessionMeta;
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
    // docs/26 (retryTurn L42565): an errored turn keeps what it was delivering as failedInputs; a clean end drops it
    if (status === "error" && s.inflight?.length) { s.failedInputs = s.inflight; s.inflight = undefined; }
    else if (status === "idle") s.inflight = undefined;
    s.meta.status = status;
    this.send(s, { kind: "status", status });
    this.d.emit.sessionsChanged(this.listSessions());
  }
  private activeTurns(): number { let n = 0; for (const s of this.sessions.values()) if (s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(s.meta.sessionId)) n++; return n; }

  /** sendMessage (L41400) / submitMessage / submitPreparedMessage (L41559) slice. Resolves when the
   *  message is queued into the runtime. docs/22 M4: composer attachments are materialized into the
   *  session's destination (secureComposerDestination L44705) and listed ahead of the turn text. */
  async sendMessage(sessionId: string, input: string | { text: string; clientTurnId?: string; attachmentIds?: string[] }, displayTexts?: string[]): Promise<{ submitted: true; duplicate: boolean; attachmentIds: string[] }> {
    const composer = typeof input !== "string";
    if (composer && this.sessions.get(sessionId)?.meta.finalizedAtMs) { // L41425
      throw new ComposerDeliveryError("This video is finalized. Undo Final to reopen it, or start a new video for this one.");
    }
    const s = this.mustGet(sessionId);
    if (this.deletingSessions.has(sessionId)) throw new ComposerDeliveryError("This video is being deleted."); // ensureRuntime L39388
    if (s.interrupting) await s.interrupting;
    const req = typeof input === "string" ? { text: input, clientTurnId: "", attachmentIds: [] as string[] } : { text: String(input?.text ?? ""), clientTurnId: String(input?.clientTurnId ?? ""), attachmentIds: Array.isArray(input?.attachmentIds) ? input.attachmentIds.map(String) : [] };
    const store = this.attachmentStore;
    if (req.attachmentIds.length && !store) throw new ComposerDeliveryError("Attachments are not supported in this port yet.");
    if (!req.text.trim() && req.attachmentIds.length === 0) throw new Error("Write a message or attach a file before sending."); // L41445
    if (new Set(req.attachmentIds).size !== req.attachmentIds.length) throw new Error("Duplicate attachment ids are not allowed.");
    if (req.attachmentIds.length && !req.clientTurnId.trim()) throw new Error("Missing composer turn id.");
    if (req.clientTurnId && store && store.checkTurn(sessionId, req.clientTurnId, req.text, req.attachmentIds) === "duplicate") return { submitted: true, duplicate: true, attachmentIds: [...req.attachmentIds] };
    if (req.clientTurnId && s.clientTurns.has(req.clientTurnId)) return { submitted: true, duplicate: true, attachmentIds: [...req.attachmentIds] };
    if (s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(sessionId)) throw new ComposerDeliveryError("This video is still working. Wait for the reply or press Stop.");
    // L41460-41476: the first text (or first attachment's name) names the video before delivery
    const hasText2 = Boolean(req.text.trim());
    const firstAttachmentName = !hasText2 && store ? store.list(sessionId, req.clientTurnId).find((a: any) => req.attachmentIds.includes(a.id))?.name : undefined;
    const canName = (!s.meta.titleOrigin && s.meta.title === NEW_VIDEO_TITLE) || (hasText2 && s.meta.titleOrigin === "attachment");
    if (canName && !req.text.startsWith("✅") && (hasText2 || firstAttachmentName)) {
      const titleSource = hasText2 ? req.text : fallbackSessionTitle(firstAttachmentName) === NEW_VIDEO_TITLE ? "Attached file" : firstAttachmentName;
      this.nameSession(s, titleSource, false, hasText2 ? "fallback" : "attachment");
    }
    const titleCancellation = s.titleCancellation;
    const limit = this.d.maxConcurrentTurns ?? 1;
    if (this.activeTurns() >= limit) throw new ComposerDeliveryError(`Another video is still working (this port runs ${limit} agent turn${limit === 1 ? "" : "s"} at a time). Wait for it or press Stop there.`);
    // claim the turn slot before any await so two concurrent sends cannot both pass the gate
    if (req.clientTurnId) s.clientTurns.add(req.clientTurnId);
    this.preparing.add(sessionId);
    const release = () => { if (req.clientTurnId) s.clientTurns.delete(req.clientTurnId); };
    let wireText = req.text;
    const useStore = !!(store && req.clientTurnId && this.d.engine);
    try {
      if (this.d.engine) {
        s.lastUserText = req.text;
        if (useStore && store.prepareTurn(sessionId, req.clientTurnId, req.text, req.attachmentIds) === "duplicate") { release(); return { submitted: true, duplicate: true, attachmentIds: [...req.attachmentIds] }; } // continueSend L41520
        // submitPreparedMessage L41559-41600: first message mints + binds the job (watcher deferred)
        const jobId = firstMessageJobId(s.meta as any, req.text);
        if (jobId) {
          try { ensureJobDir(s.meta.cwd, jobId); } catch (e: any) { throw new ComposerDeliveryError(redactText(String(e?.message ?? e))); }
          this.commitBind(s, jobId, "first-message", false);
        }
        // L41588-41612: materialize every attachment into its destination, in order
        const materialized: any[] = [];
        if (req.attachmentIds.length) {
          const draft = new Map<string, any>(store.list(sessionId, req.clientTurnId).map((a: any) => [a.id, a]));
          for (const attachmentId of req.attachmentIds) {
            const attachment = draft.get(attachmentId);
            if (!attachment) throw new Error("One of those attachments is no longer in this draft.");
            const destDir = this.secureComposerDestination(s, attachment.destination);
            materialized.push(await store.materialize(sessionId, attachmentId, destDir, true));
          }
          if (materialized.some((a) => a.destination === "video")) this.watchers.get(sessionId)?.emit();
        }
        wireText = engineTurnText(s.meta as any, req.text);
        if (materialized.length > 0) { // L41630-41656 (readerTools: local runtime)
          const list2 = materialized.map((a) => `- ${a.id}: ${a.path}` + attachmentContextLines(a, true).map((line: string) => `\n${line}`).join("")).join("\n");
          wireText = `[APP-OWNED COMPOSER ATTACHMENTS — ordered]\n${list2}\n[Use these files as source material where relevant.]\n\n` + wireText;
        }
        if (useStore) wireText = store.freezeRuntimeText(sessionId, req.clientTurnId, req.text, req.attachmentIds, wireText);
      }
    } catch (e) {
      this.preparing.delete(sessionId);
      release();
      throw e;
    }
    this.preparing.delete(sessionId);
    if (typeof s.meta.pendingPermissionMode === "string") { s.meta.permissionMode = s.meta.pendingPermissionMode; delete s.meta.pendingPermissionMode; if (s.runtime && !s.runtime.dead) this.teardownRuntime(s, "permission-mode"); this.saveRegistry(); } // applyPendingPermissionMode (before a send)
    const msg = { type: "user", message: { role: "user", content: [{ type: "text", text: wireText }] }, parent_tool_use_id: null, session_id: "",
      // docs/26: createLocalRuntime pushInput L23073 — a composer turn's SDK uuid is composerTurnMessageUuid(clientTurnId),
      // the same id the ORIGINAL renderer gives its optimistic row (displayTurnId) and persistDisplayTurn records, so
      // session:history (re-fetched on every status change) reconciles onto that row instead of duplicating it
      uuid: req.clientTurnId ? composerTurnMessageUuid(sessionId, req.clientTurnId) : randomUUID() };
    s.failedInputs = undefined; s.failedTurnCanRetry = undefined; // a new send supersedes the failed one (L41700)
    this.setStatus(s, "running");
    const delivered = await this.deliver(s, { msg, displayTexts: displayTexts ?? (req.text.trim() ? [req.text] : []), attachmentIds: req.attachmentIds }, release);
    if (!delivered) return { submitted: true, duplicate: false, attachmentIds: [...req.attachmentIds] };
    // L41757-41763: once delivered, a fallback/attachment title may be replaced by a proposed one
    if (req.text.trim() && (s.meta.titleOrigin === "fallback" || s.meta.titleOrigin === "attachment") && !req.text.startsWith("✅")) {
      this.nameSession(s, req.text, titleCancellation === s.titleCancellation);
    }
    if (useStore) {
      try { store.markTurnSubmitted(sessionId, req.clientTurnId, req.text, req.attachmentIds); } catch (e) { this.log.warn("agent.attachments.mark_submitted_failed", { sessionId, error: e }); } // L41715
      if (req.attachmentIds.length > 0) this.publishMaterials(sessionId); // L41746
    }
    return { submitted: true, duplicate: false, attachmentIds: [...req.attachmentIds] };
  }
  /** deliver (L41860) slice — spawn/resume the runtime, arm the turn timer, persist the display row, enqueue.
   *  Shared by sendMessage and retryTurn. Returns false when the turn was stopped while spawning. */
  private async deliver(s: Session, input: DeliveredInput, release: () => void = () => {}): Promise<boolean> {
    const sessionId = s.meta.sessionId;
    s.inflight = [input];
    if (s.meta.agentHarness === "codex-app-server") {
      // deliver L42003-42030: catalog capacity, route refusal, exact model pin, reasoning-effort pin
      let refusal: string | undefined;
      try {
        if (!this.codex) throw new Error("Codex is unavailable right now.");
        refusal = await this.codex.turnRefusal(s.meta);
      } catch (e: any) {
        refusal = e instanceof CodexProcessCapacityError ? e.message : redactText(String(e?.message ?? e));
      }
      if (refusal) {
        release();
        if ((s.meta.status as SessionStatus) !== "running") return false;
        this.blockCodexRoute(s, input, refusal);
        return false;
      }
    }
    let rt: Runtime;
    try {
      rt = await this.ensureRuntime(s);
    } catch (e: any) {
      release();
      if ((s.meta.status as SessionStatus) !== "running") return false; // stopped / reset while spawning
      const message = redactText(String(e?.message ?? e));
      this.log.warn("agent.spawn_failed", { sessionId, error: e });
      this.send(s, { kind: "error", message, canRetry: true });
      this.setStatus(s, "error");
      throw new ComposerDeliveryError(message);
    }
    if ((s.meta.status as SessionStatus) !== "running" || s.runtime !== rt) return false; // stopped while spawning
    const timeoutMs = this.d.turnTimeoutMs ?? (this.d.engine ? 20 * 60_000 : 5 * 60_000);
    s.turnTimer = setTimeout(() => { if (s.meta.status === "running" || s.meta.status === "awaiting_permission") { this.send(s, { kind: "error", message: `The turn did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`, canRetry: true }); this.teardownRuntime(s, "turn-timeout"); this.setStatus(s, "error"); } }, timeoutMs);
    (s.turnTimer as any).unref?.();
    // docs/25: persistDisplayTurn (L41820) BEFORE delivery — the sidecar row the history replay maps
    // the SDK transcript's engine text back to (what the user typed, not the app-owned preambles)
    this.persistDisplayTurn(s, input.msg, input.displayTexts, input.attachmentIds);
    rt.queue.push(input.msg);
    rt.wake?.(); rt.wake = null;
    this.log.info("agent.turn.delivered", { sessionId, resumed: !!s.meta.sdkSessionId, sdkSessionId: s.meta.sdkSessionId ?? null });
    return true;
  }

  /** cancelSessionTitle (L41772). */
  cancelSessionTitle(s: Session): void { s.titleCancellation = (s.titleCancellation ?? 0) + 1; s.titleRequest?.abort(); }
  /** nameSession (L41776). The original requests a title only for route "claude-code" (+ subscription
   *  login, local runtime, claude-code harness); the port does the same request for PORT-NEW provider
   *  routes instead (session-title.ts) — claude-code proposals are NOT PORTED (no login probe). */
  private nameSession(s: Session, text2: string, mayRequest: boolean, origin: "fallback" | "attachment" = "fallback"): void {
    const fallback = fallbackSessionTitle(text2);
    if ((!s.meta.titleOrigin && s.meta.title === NEW_VIDEO_TITLE) || (s.meta.titleOrigin === "attachment" && origin === "fallback")) {
      s.meta.title = fallback;
      s.meta.titleOrigin = origin;
      this.d.emit.sessionsChanged(this.listSessions());
      this.saveRegistry();
    }
    const route = this.d.service.sessionLlmRoute?.({ llmRoute: s.meta.llmRoute, agentHarness: "claude-code" }) ?? s.meta.llmRoute;
    const providerRoute = typeof route === "string" && route !== "claude-code" && route !== "gateway";
    if (!mayRequest || s.meta.titleOrigin !== "fallback" || s.meta.title !== fallback || this.sessions.get(s.meta.sessionId) !== s
      || (s.meta.agentHarness ?? "claude-code") !== "claude-code" || !providerRoute || this.d.providerTitles === false || !this.d.service.sessionHelperComplete) return;
    const controller = new AbortController();
    s.titleRequest = controller;
    const meta: SessionMetaLike = { llmRoute: s.meta.llmRoute, agentHarness: "claude-code" };
    this.log.info("agent.title.request", { sessionId: s.meta.sessionId, llmRoute: route });
    void proposeProviderSessionTitle(text2, controller, (body, opts) => this.d.service.sessionHelperComplete!(meta, body, opts))
      .then(({ title, reason }) => {
        if (!title || controller.signal.aborted || this.sessions.get(s.meta.sessionId) !== s || s.meta.titleOrigin !== "fallback" || s.meta.title !== fallback) {
          this.log.info("agent.title.kept_fallback", { sessionId: s.meta.sessionId, reason: reason ?? (title ? "superseded" : "no title") });
          return;
        }
        s.meta.title = title;
        s.meta.titleOrigin = "automatic";
        this.saveRegistry();
        this.d.emit.sessionsChanged(this.listSessions());
        this.log.info("agent.title.automatic", { sessionId: s.meta.sessionId, chars: title.length });
      })
      .finally(() => { if (s.titleRequest === controller) s.titleRequest = undefined; });
  }
  /** persistDisplayTurn (L41820) slice: append the display-transcript row for a delivered turn.
   *  NOT PORTED: message_time push, failedDisplayTexts bookkeeping, write-failure beacon. */
  private persistDisplayTurn(s: Session, msg: Record<string, any>, displayTexts: string[], attachmentIds?: string[]): void {
    if (!this.d.stateDir || displayTexts.length === 0) return;
    const file = displayTranscriptPath(this.d.stateDir, s.meta.sessionId);
    const turnId = isDisplayTurnId(msg.uuid) ? msg.uuid : randomUUID();
    const previous = readDisplayTranscript(file).byTurnId.get(turnId);
    const atMs = previous ? previous.atMs : Date.now();
    const engineText = sdkUserMessageText(msg);
    if (engineText !== null) appendDisplayTranscript(file, engineText, displayTexts, turnId, s.lastAssistantMessageId, (err: unknown) => this.log.warn("agent.display_transcript.write_failed", { sessionId: s.meta.sessionId, error: err }), attachmentIds?.length ? attachmentIds : undefined, atMs);
  }
  /** observeSdkSessionIdentity (L36172): record the SDK transcript identity at every ingress seam. */
  private observeSdkSessionIdentity(s: Session, sdkSessionId: unknown): void {
    if (typeof sdkSessionId !== "string" || !sdkSessionId) return;
    if (s.meta.sdkSessionId === sdkSessionId) return;
    s.meta.sdkSessionId = sdkSessionId;
    this.saveRegistry();
  }
  /** engineProfileStore (L43343) — the SessionStore over <engine-profile>/projects/<key>/<sdkId>.jsonl. */
  private engineProfileStore(): Record<string, unknown> | undefined {
    if (!this.d.engineProfileDir) return undefined;
    const root = join(this.d.engineProfileDir(), "projects");
    return {
      append: async () => {},
      load: ({ projectKey, sessionId }: { projectKey: string; sessionId: string }) => {
        let file = join(root, projectKey, `${sessionId}.jsonl`);
        if (!existsSync(file)) {
          try {
            const hit = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, e.name, `${sessionId}.jsonl`)).find((p) => existsSync(p));
            if (!hit) return Promise.resolve(null);
            file = hit;
          } catch { return Promise.resolve(null); }
        }
        let raw: string;
        try { raw = readFileSync(file, "utf-8"); } catch { return Promise.resolve(null); }
        const entries: unknown[] = [];
        for (const line of raw.split("\n")) { if (!line.trim()) continue; try { entries.push(JSON.parse(line)); } catch {} }
        return Promise.resolve(entries.length ? entries : null);
      },
    };
  }
  /** The transcript roots rawClaudeTranscript (L43391) searches: claudeCodeConfigDir() (L22720) + the engine profile. */
  private transcriptRoots(): string[] {
    const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
    const home = homedir();
    const cc = !configured ? join(home, ".claude") : configured === "~" ? home : configured.startsWith("~/") ? join(home, configured.slice(2)) : configured;
    return [join(cc, "projects"), ...(this.d.engineProfileDir ? [join(this.d.engineProfileDir(), "projects")] : [])];
  }
  /** rawClaudeTranscript (L43391): every row of the retained local transcript, wrapper metadata intact. */
  rawClaudeTranscript(sdkSessionId: string, requireMarker?: string[]): unknown[] | null {
    for (const root of this.transcriptRoots()) {
      try {
        for (const dirent of readdirSync(root, { withFileTypes: true })) {
          if (!dirent.isDirectory()) continue;
          const file = join(root, dirent.name, `${sdkSessionId}.jsonl`);
          if (!existsSync(file) || statSync(file).size > 128 * 1024 * 1024) continue;
          const text2 = readFileSync(file, "utf8");
          if (requireMarker && !requireMarker.some((marker) => text2.includes(marker))) continue;
          const entries: unknown[] = [];
          for (const line of text2.split("\n")) { if (!line.trim()) continue; try { entries.push(JSON.parse(line)); } catch {} }
          if (entries.some(visibleInSdkHistory)) return entries;
        }
      } catch {}
    }
    return null;
  }
  /** restoreHistoryState (L43646) slice: rejected-message filter + conversationTooLarge. NOT PORTED:
   *  attachment moments, liveWork / tool-spend settlement (no live-work ledger in the port). */
  private restoreHistoryState(s: Session, events: any[]): any[] {
    const rejected = new Set<string>((s.meta.rejectedMessageIds as string[] | undefined) ?? []);
    if (rejected.size > 0) events = events.filter((e) => !((e.kind === "assistant_text" || e.kind === "text_delta") && e.messageId !== undefined && rejected.has(e.messageId)));
    return events;
  }
  /** getHistory (L43698) — docs/25: the ORIGINAL local claude-code branch. The display-transcript sidecar
   *  (userData/display-transcripts/<id>.jsonl) + the SDK transcript of meta.sdkSessionId read with
   *  getSessionMessages (filesystem, then the engine-profile SessionStore) → historyToEvents (verbatim).
   *  NOT PORTED: remote/codex runtimes, publishMaterials, runtimeTurnStore.logicalMessageUuid (identity),
   *  restoreFailedTurn (no turn-receipt store → failure cards are not rebuilt), compacted-history beacon. */
  async getHistory(sessionId: string): Promise<any[]> {
    const s = this.mustGet(sessionId);
    this.publishMaterials(sessionId, false); // L43700
    const composerMaterials = this.attachmentStore ? this.attachmentStore.materials(sessionId) : [];
    const displayIndex = readDisplayTranscript(this.d.stateDir ? displayTranscriptPath(this.d.stateDir, sessionId) : "", composerMaterials);
    if (!s.meta.sdkSessionId) return this.restoreHistoryState(s, historyToEvents([], displayIndex, undefined));
    if (s.meta.agentHarness === "codex-app-server") { // getHistory L43729: thread/read → codexEventToSdkMessages → historyToEvents
      let client: CodexAppServerClient | undefined;
      try {
        const c = this.d.codex!;
        const p = c.provider();
        if (p) ensureCodexProfile(c.profileDir(), p.model);
        client = new CodexAppServerClient({ appVersion: c.appVersion, executable: c.executable(), profileDir: c.profileDir(), env: codexChildEnv(undefined, {}, c.profileDir()) });
        const providerEvents = await client.readHistory(String(s.meta.sdkSessionId));
        const codexEntries: any[] = providerEvents.flatMap((e: any) => codexEventToSdkMessages(e) as any[]);
        return this.restoreHistoryState(s, historyToEvents(codexEntries, displayIndex, s.meta.rejectedMessageIds));
      } catch (e) {
        this.log.warn("agent.history.codex_read_failed", { sessionId, error: e });
        return this.restoreHistoryState(s, historyToEvents([], displayIndex, undefined));
      } finally { client?.close(); }
    }
    try {
      const { sdk } = await this.loadSdk();
      const getSessionMessages = (sdk as any).getSessionMessages as (id: string, o: Record<string, unknown>) => Promise<any[]>;
      if (typeof getSessionMessages !== "function") throw new Error("SDK has no getSessionMessages");
      const sdkId = String(s.meta.sdkSessionId);
      const empty2: any[] = [];
      let messages = await getSessionMessages(sdkId, { dir: s.meta.cwd, includeSystemMessages: true }).catch(() => empty2);
      if (messages.length === 0) messages = await getSessionMessages(sdkId, { includeSystemMessages: true }).catch(() => empty2);
      const store = this.engineProfileStore();
      if (messages.length === 0 && store) messages = await getSessionMessages(sdkId, { dir: s.meta.cwd, sessionStore: store, includeSystemMessages: true });
      const sdkHistory = messages;
      const compacted = isFlattenedClaudeCompactedHistory(sdkHistory);
      const rawTranscript = this.rawClaudeTranscript(sdkId, compacted ? undefined : FALLBACK_EVIDENCE_MARKERS);
      const derived = rejectedFallbackMessageIds(rawTranscript ?? sdkHistory);
      if (derived.length > 0) { s.meta.rejectedMessageIds = [...new Set([...((s.meta.rejectedMessageIds as string[]) ?? []), ...derived])].slice(-200); this.saveRegistry(); }
      const visibleRaw = rawTranscript?.filter(visibleInSdkHistory) ?? [];
      const fullHistory = compacted && visibleRaw.length > 0 ? visibleRaw : null;
      const events = historyToEvents(fullHistory ?? sdkHistory, displayIndex, s.meta.rejectedMessageIds);
      if (!s.meta.jobId && this.d.engine) {
        for (const raw of messages) {
          if (raw?.type !== "assistant") continue;
          const content = raw.message?.content;
          if (!Array.isArray(content)) continue;
          for (const block of content) if (block.type === "tool_use") this.maybeBindJob(s, JSON.stringify(block.input ?? {}));
        }
      }
      this.log.info("agent.history.replayed", { sessionId, sdkMessages: messages.length, displayRows: displayIndex.ordered.length, events: events.length });
      return this.restoreHistoryState(s, events);
    } catch (e) {
      this.log.warn("agent.history.read_failed", { sessionId, error: e });
      return this.restoreHistoryState(s, historyToEvents([], displayIndex, undefined));
    }
  }
  /** Whether the SDK transcript a resume would continue is still on disk (stale-resume guard, PORT-NEW
   *  stand-in for tryStaleResumeFallback L43295: the port drops a dead id before spawning instead). */
  private resumableSdkSession(s: Session): string | undefined {
    const id = s.meta.sdkSessionId as string | undefined;
    if (!id) return undefined;
    if (s.meta.agentHarness === "codex-app-server") return id; // a Codex thread id (thread/resume), not a Claude transcript
    if (this.rawClaudeTranscript(id)) return id;
    this.log.warn("agent.history.stale_resume_dropped", { sessionId: s.meta.sessionId });
    s.meta.sdkSessionId = undefined;
    this.saveRegistry();
    return undefined;
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
    if (s.meta.agentHarness === "codex-app-server") return this.spawnCodex(s);
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

  /** spawnLocal L39500-39533 (codex-app-server branch) → createCodexRuntime, with the MiniMax backend:
   *  a per-runtime gate proxy (surface "openai") is the child's only upstream (docs/27 §3). */
  private async spawnCodex(s: Session): Promise<Runtime> {
    const epoch = s.epoch;
    const c = this.d.codex;
    if (!c || !this.codex) throw new Error("Codex is unavailable right now.");
    this.codex.assertEnabled();
    const p = c.provider();
    if (!p) throw new Error(this.codex.runtimeGate().message);
    const engineSpawn = this.d.engine ? prepareEngineSpawn(this.d.engine, s.meta as any, s.contextEpoch) : undefined;
    if (engineSpawn?.contextEpoch && engineSpawn.contextEpoch !== s.contextEpoch) { s.contextEpoch = engineSpawn.contextEpoch; this.saveRegistry(); }
    ensureCodexProfile(c.profileDir(), p.model);
    const backend = await (c.startBackend ?? ((pp: ResolvedProvider) => startCodexMiniMaxBackend(pp, { logger: this.log })))(p);
    if (s.epoch !== epoch) { await backend.close().catch(() => {}); throw new Error("The session was reset before the agent started."); }
    const handle: AgentRuntimeHandle = { llmRoute: "codex" as LlmRouteId, model: s.meta.modelOverride, env: {}, proxy: backend.proxy, close: () => backend.close() };
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
    const sessionId = s.meta.sessionId;
    let canUseTool: (name: string, toolInput: Record<string, unknown>, o: { signal: AbortSignal; requestId?: string; toolUseID?: string }) => Promise<any>;
    if (this.d.engine && engineSpawn) {
      const engineCan = makeEngineCanUseTool(this.d.engine, this.enginePolicyHost(), sessionId, engineSpawn.engineEnv);
      canUseTool = (name, toolInput, o) => engineCan(name, toolInput, o as any);
    } else {
      const policy = confinedToolPolicy(s.meta.cwd, this.tools);
      canUseTool = async (name, toolInput) => { const v = policy(name, toolInput); this.log.info("agent.tool.permission", { sessionId, tool: name, allowed: v.allowed }); return v.allowed ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: v.reason ?? "not allowed" }; };
    }
    let codexRt;
    try {
      codexRt = createCodexRuntime({
        sessionId, cwd: s.meta.cwd, resume: this.resumableSdkSession(s), model: s.meta.modelOverride,
        ...(s.meta.codexReasoningEffort ? { reasoningEffort: s.meta.codexReasoningEffort } : {}),
        permissionMode: String(s.meta.permissionMode || "auto"), provider: s.meta.codexProvider ?? DEFAULT_CODEX_PROVIDER, backend,
        sessionContext: { append: engineSpawn?.append ?? "", assembled: !!engineSpawn, lawsVersion: engineSpawn?.lawsVersion },
        engineEnv: engineSpawn?.engineEnv ?? { PATH: process.env.PATH ?? "/usr/bin:/bin" }, profileDir: c.profileDir(), appVersion: c.appVersion, executable: c.executable(),
        canUseTool, createClient: c.createClient,
        onWarning: (m) => { stderr = (stderr + m + "\n").slice(-4000); },
      });
    } catch (e) { await backend.close().catch(() => {}); throw e; }
    rt.query = codexQuery(codexRt, input) as unknown as AgentQuery;
    s.runtime = rt;
    this.send(s, { kind: "port_runtime", phase: "started", llmRoute: "codex", model: s.meta.modelOverride, gateProxy: true });
    this.log.info("agent.runtime.started", { sessionId, harness: "codex-app-server", codexProvider: s.meta.codexProvider, model: s.meta.modelOverride, effort: s.meta.codexReasoningEffort, resumed: !!codexRt.resumedFrom, engine: !!engineSpawn });
    rt.consumed = this.consume(s, rt, () => stderr);
    return rt;
  }
  /** blockCodexRoute L42229 (no outbox beacon in the port). */
  private blockCodexRoute(s: Session, input: DeliveredInput, reason: string): void {
    if (s.runtime) this.teardownRuntime(s, "codex-route-unavailable");
    s.inflight = undefined;
    s.failedTurnCanRetry = undefined;
    s.failedInputs = [input];
    this.send(s, { kind: "error", message: `${reason} Pick a validated model in Account, or start a new video.`, canRetry: true });
    this.setStatus(s, "error");
  }
  /** setSessionModel L40895: the Codex half validates against discovery + the evidence ledger and pins
   *  the exact id; the Claude half (provider routes) only records the pick (claudeModelVerdict not ported). */
  async setSessionModel(sessionId: string, model: unknown): Promise<AgentSessionMeta | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    let selected = typeof model === "string" && model ? model : undefined;
    if (s.meta.agentHarness === "codex-app-server") {
      if (!this.codex) throw new Error("Codex is unavailable right now.");
      selected = await this.codex.pickModel(s.meta, selected);
    }
    if (this.sessions.get(sessionId) !== s) return null;
    const unchanged = s.meta.modelOverride === selected;
    s.meta.modelOverride = selected;
    this.d.emit.sessionsChanged(this.listSessions());
    this.saveRegistry();
    const rt = s.runtime;
    if (s.meta.agentHarness === "codex-app-server") {
      if (rt && !rt.dead && !unchanged) void (rt.query as any).setModel?.(selected)?.catch?.(() => {});
      return { ...s.meta };
    }
    if (rt && !rt.dead && !unchanged && s.meta.status !== "running" && s.meta.status !== "awaiting_permission") this.teardownRuntime(s, "model-changed");
    return { ...s.meta };
  }
  /** setSessionReasoningEffort L51735 (Codex half; the Claude-effort half is NOT PORTED). */
  async setSessionReasoningEffort(sessionId: string, effort: unknown): Promise<AgentSessionMeta | null> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    const wanted = typeof effort === "string" && effort.trim() ? effort.trim() : undefined;
    if (s.meta.agentHarness !== "codex-app-server") throw new Error("Claude effort is not available in this build.");
    if (!this.codex) throw new Error("Codex is unavailable right now.");
    const model = s.meta.modelOverride;
    await this.codex.checkEffort(s.meta, wanted);
    if (this.sessions.get(sessionId) !== s) return null;
    if (s.meta.modelOverride !== model) throw new Error("This video’s model changed while VideoClaw checked its efforts. Choose the effort again.");
    if (s.meta.codexReasoningEffort === wanted) return { ...s.meta };
    s.meta.codexReasoningEffort = wanted;
    // the effort is thread-local config (model_reasoning_effort): an idle live thread respawns with it
    if (s.runtime && !s.runtime.dead && s.meta.status !== "running" && s.meta.status !== "awaiting_permission") this.teardownRuntime(s, "effort-changed");
    this.d.emit.sessionsChanged(this.listSessions());
    this.saveRegistry();
    return { ...s.meta };
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
      this.send(s, { kind: "error", message: rt.launched || rt.llmRoute === "codex" ? redactText(String(e?.message ?? e)).slice(0, 500) : "The studio couldn't start — try again in a moment, or check Setup.", canRetry: true }); // L50245
      this.setStatus(s, "error");
    }
  }

  /** reduce (L50416) — the event subset this port renders. */
  private reduce(s: Session, m: Record<string, any>, rt: Runtime): void {
    if (s.runtime !== rt || rt.dead) return;
    this.observeSdkSessionIdentity(s, m.session_id); // L36172 (every ingress seam)
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
        if (typeof messageId === "string") s.lastAssistantMessageId = messageId;
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

  private enginePolicyHost(): EnginePolicyHost {
    return {
      sessionCwd: (id) => this.sessions.get(id)?.meta.cwd,
      sessionJobId: (id) => this.sessions.get(id)?.meta.jobId,
      sessionPlanRefusal: () => undefined, // no plan can exist (propose_session_plan not ported) → L45xxx returns undefined
      askHuman: (req, signal) => this.askHuman(req, signal),
      paidRefusal: () => PORT_PAID_REFUSAL,
      log: (event, detail) => this.log.info(event, detail),
    };
  }
  /** createLocalRuntime options (L23237-23314) for an engine session. */
  private engineQueryOptions(s: Session, handle: AgentRuntimeHandle, sp: { engineEnv: Record<string, string>; append: string }, executable: string | undefined, stderr: (t: string) => void): Record<string, unknown> {
    const sessionId = s.meta.sessionId;
    const engine = this.d.engine!;
    const policyHost = this.enginePolicyHost();
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
      // docs/25: the original keeps the SDK's local transcript (persistSession default) and resumes the
      // video's sdkSessionId on every respawn (createLocalRuntime resume L39544) — session:history replays it
      ...(this.resumableSdkSession(s) ? { resume: s.meta.sdkSessionId } : {}),
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
  commitBind(s: Session, jobId: string, via: string, watchImmediately = true): void {
    if (!isClientJobId(jobId)) return;
    const changed = s.meta.jobId !== jobId;
    s.meta.jobId = jobId;
    delete (s.meta as any).adoptCandidate;
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
    this.log.info("agent.job.bound", { sessionId: s.meta.sessionId, jobId, via });
    if (changed && s.runtime && !s.runtime.dead && s.meta.status !== "running" && s.meta.status !== "awaiting_permission") this.teardownRuntime(s, "job-attribution");
    if (watchImmediately) this.ensureWatcher(s, true);
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
  respondPermission(requestId: string, response: { behavior?: string; message?: string; updatedInput?: Record<string, unknown>; answers?: unknown; selections?: unknown } | undefined): void {
    const pending = this.pendingPermissions.get(String(requestId));
    if (!pending) return;
    this.pendingPermissions.delete(String(requestId));
    const s = this.sessions.get(pending.sessionId);
    if (s) this.send(s, { kind: "permission_resolved", requestId: pending.request.requestId });
    if (s && s.meta.status === "awaiting_permission") this.setStatus(s, "running"); // resumeAfterInteraction
    this.log.info("agent.permission.response", { sessionId: pending.sessionId, requestId, behavior: response?.behavior });
    // original L37581-37617: the question card answers with behavior "answers" (renderer answerQuestion
    // L40098) → allow with { ...input, answers }; "allow" → allow with the request's own input; anything
    // else → deny ("Denied by user" when no message). docs/23: found by the M5 UI-e2e (the card's answer
    // was being turned into a deny).
    const input = pending.request.input as Record<string, unknown>;
    let decision: CanUseToolResult;
    if (response?.behavior === "answers") decision = { behavior: "allow", updatedInput: { ...input, answers: response.answers } };
    else if (response?.behavior === "allow") decision = { behavior: "allow", updatedInput: input };
    else decision = { behavior: "deny", message: response?.message ?? "Denied by user" };
    // docs/24: what canUseTool hands back to the SDK (shape only — no answer text is logged)
    const answers = response?.behavior === "answers" && response.answers && typeof response.answers === "object" ? Object.keys(response.answers as object).length : 0;
    this.log.info("agent.permission.decision", { sessionId: pending.sessionId, requestId, tool: pending.request.toolName, behavior: decision.behavior, answers });
    pending.resolve(decision);
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
      const stopTurnId = randomUUID();
      // docs/25: L43906-43921 — a Stop leaves its display row so a reopened video shows "stopped after …"
      if (reason === "stop" && this.d.stateDir) appendDisplayStop(displayTranscriptPath(this.d.stateDir, sessionId), stoppedAfterMs, stopTurnId, s.lastAssistantMessageId);
      this.send(s, { kind: "result", isError: false, totalCostUsd: s.meta.totalCostUsd, numTurns: 0, durationMs: stoppedAfterMs, stoppedAfterMs, stopTurnId });
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
      if (s.meta.agentHarness === "codex-app-server") continue; // capabilities.usesAppLlmRoute false (createCodexRuntime L25031)
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
    for (const sessionId of [...this.watchers.keys()]) this.retireWatcher(sessionId); // L45572
    const closing: Promise<void>[] = [];
    for (const s of this.sessions.values()) { const rt = s.runtime; if (rt) { this.teardownRuntime(s, "dispose"); if (rt.closed) closing.push(rt.closed); } }
    await Promise.all(closing);
  }

  // ── docs/22 M3: job snapshot / versions (original L45608-45626, L47448-47520, L47950-47983) ──

  /** snapshotJobDir (L45608): THE job directory for a snapshot read; fails closed on traversal. */
  snapshotJobDir(s: Session, jobId: string): string | null {
    if (!isClientJobId(jobId)) return null;
    const jobsRoot = join(s.meta.cwd, "jobs"); // expandTilde$1: port cwds are absolute
    const jobPath = resolvePath(jobsRoot, jobId);
    return relative(jobsRoot, jobPath) === jobId ? jobPath : null;
  }
  /** chatMediaRoot (L45616): read-only media scope of a video. */
  chatMediaRoot(sessionId: string): string | null {
    const s = this.sessions.get(sessionId);
    const jobId = (s?.meta.jobId ?? (s?.meta as any)?.priorJobId) as string | undefined;
    return s && jobId ? this.snapshotJobDir(s, jobId) : null;
  }
  /** getJobSnapshot (L45620) → job:get. */
  getJobSnapshot(sessionId: string): any {
    const s = this.mustGet(sessionId);
    if (!s.meta.jobId || !this.versionStore) return null;
    this.ensureWatcher(s);
    const jobPath = this.snapshotJobDir(s, s.meta.jobId);
    if (!jobPath) return null;
    return this.enrich(scanJob(s.meta.jobId, jobPath));
  }
  /** historicalJobSnapshot (L45643): read-only projection of a released job (pure: no enrich, no watcher). */
  historicalJobSnapshot(sessionId: string): any {
    const s = this.sessions.get(sessionId);
    const jobId = (s?.meta as any)?.priorJobId as string | undefined;
    if (!s || !jobId || s.meta.jobId || !this.versionStore) return null;
    const jobPath = this.snapshotJobDir(s, jobId);
    if (!jobPath || !existsSync(jobPath)) return null;
    const snapshot = scanJob(jobId, jobPath);
    snapshot.versions = this.versionStore.versions(jobId);
    snapshot.finals = this.versionStore.finals(jobId);
    this.nameCandidateVersion(snapshot);
    return snapshot;
  }
  /** nameCandidateVersion (L45661). */
  private nameCandidateVersion(snapshot: any): void {
    for (const render of snapshot.renders) {
      if (!render.isCandidate) continue;
      const n = this.versionStore.versionHolding(snapshot.jobId, render.path);
      if (n !== undefined) render.versionN = n;
    }
  }
  /** enrich (L47448): attach versions (minting finished renders) to a scan. NOT PORTED:
   *  accountVersions (turn "done" accounting / videoDone notify, needs turnWindows). */
  enrich(snapshot: any): any {
    const vs = this.versionStore;
    snapshot.versions = vs.sync(snapshot.jobId, snapshot.jobPath);
    snapshot.finals = vs.finals(snapshot.jobId);
    if (vs.hasBacklog(snapshot.jobId)) {
      for (const watcher of this.watchers.values()) if (watcher.jobId === snapshot.jobId) watcher.rescanSoon();
    }
    this.nameCandidateVersion(snapshot);
    snapshot.qaMarkedAtMs = [...snapshot.versions].reverse().find((v: any) => v.qaStatus === "clean")?.createdAtMs ?? null;
    if (snapshot.cut.source !== "none") {
      for (const v of snapshot.versions) {
        const perVer = join(snapshot.jobPath, "versions", `v${v.n}.timeline.json`);
        if (existsSync(perVer)) snapshot.cut.perVersion[v.n] = resolveCut(snapshot.jobPath, perVer, v.n).usedPaths;
      }
    }
    return snapshot;
  }
  /** retireWatcher (L47949). */
  retireWatcher(sessionId: string): void {
    const watcher = this.watchers.get(sessionId);
    if (!watcher) return;
    watcher.close();
    this.watchers.delete(sessionId);
    this.versionStore?.releaseJob(watcher.jobId);
  }
  /** ensureWatcher (L47956). NOT PORTED in the snapshot hook: spendBudgets.reconcileSpend (no
   *  spend ledger, $0), observePulseMedia (telemetry), publishMaterials (materials ledger). */
  ensureWatcher(s: Session, replace = false): void {
    if (!this.versionStore) return;
    const existing = this.watchers.get(s.meta.sessionId);
    if (existing && !replace) return;
    if (existing) this.retireWatcher(s.meta.sessionId);
    if (!s.meta.jobId) return;
    const sessionId = s.meta.sessionId;
    const jobId = s.meta.jobId;
    this.watchers.set(sessionId, new JobWatcher(jobId, join(s.meta.cwd, "jobs", jobId), (snapshot: any) => {
      try { this.d.emit.jobSnapshot?.(sessionId, this.enrich(snapshot)); } catch (e) { this.log.warn("agent.job_snapshot_failed", { sessionId, error: e }); }
      this.publishMaterials(sessionId); // L47978
    }));
    if (this.versionStore.hasBacklog(jobId)) this.watchers.get(sessionId)?.rescanSoon();
  }
  /** revertFinal (L47478). */
  revertFinal(sessionId: string, n: number): void {
    const s = this.mustGet(sessionId);
    if (!s.meta.jobId || !this.versionStore) return;
    const version = this.versionStore.revertFinal(s.meta.jobId, n);
    if (!version) return;
    this.watchers.get(sessionId)?.emit();
  }
  /** approveVersion (L47488) → version:approve: finalize, then (first approval only) the original
   *  taste-capture follow-up turn. NOT PORTED: recordProductMilestone beacon, voice dictation cancel. */
  approveVersion(sessionId: string, n: number): void {
    const s = this.mustGet(sessionId);
    if (!s.meta.jobId || !this.versionStore) return;
    const vs = this.versionStore;
    const everFinal = vs.finals(s.meta.jobId).some((r: any) => r.n === n);
    const isCurrentFinal = vs.currentFinal(s.meta.jobId)?.n === n;
    if (everFinal && !isCurrentFinal) { this.revertFinal(sessionId, n); return; }
    const version = vs.approve(s.meta.jobId, n);
    if (!version) return;
    (s.meta as any).finalizedAtMs = Date.now();
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
    this.log.info("agent.version.approved", { sessionId, jobId: s.meta.jobId, n });
    this.watchers.get(sessionId)?.emit();
    if (everFinal) return;
    const quotes = vs.versions(s.meta.jobId).flatMap((v: any) => v.feedback.map((f: string) => `V${v.n}: "${f}"`)).join("\n");
    this.send(s, { kind: "user_text", text: `✅ V${n} approved` });
    void this.sendMessage(sessionId, `✅ I'm approving V${n} — this is the one.

Per the taste-capture protocol, distill the feedback I gave across the versions into a SHORT list of durable taste rules (project-level; promote to client/global ONLY if clearly generalizable). Propose them to me with AskUserQuestion (multiSelect) so I pick which to keep — do NOT write any taste file until I confirm. After I confirm, write the kept rules to the appropriate COMMITMENTS blocks and reply with what was committed.` + (quotes ? `

Feedback log:
${quotes}` : ""), [`✅ V${n} approved`]).catch((e) => this.log.info("agent.version.taste_capture_not_sent", { sessionId, error: e }));
  }
  /** unfinalizeSession (L…unfinalizeSession) → session:unfinalize (continuations not ported). */
  unfinalizeSession(sessionId: string): AgentSessionMeta {
    const s = this.mustGet(sessionId);
    delete (s.meta as any).finalizedAtMs;
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
    return { ...s.meta };
  }

  // ── docs/22 M4: composer attachments (original L44705-44985, L51017) ──

  /** mustGetWritable (L51017). */
  mustGetWritable(sessionId: string): Session {
    const s = this.mustGet(sessionId);
    if ((s.meta as any).finalizedAtMs) throw new Error("This video is finalized. Undo Final to change its attachments.");
    return s;
  }
  private requireStore(): any {
    if (!this.attachmentStore) throw new Error("Attachments are not supported in this port yet.");
    return this.attachmentStore;
  }
  /** secureComposerDestination (L44705): component-by-component, no symlinks, inside the workspace. */
  secureComposerDestination(s: Session, destination: string): string {
    const workspace = realpathSync(s.meta.cwd);
    const tenant = ""; // getClient(clientId)?.tenant — port clients carry no tenant (library drops refused)
    const parts = destination === "library" ? ["assets", tenant, "drops"] : s.meta.jobId ? ["jobs", s.meta.jobId, "incoming"] : ["incoming"];
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("/"))) throw new Error("Attachment destination is not safely scoped to this project.");
    let current = workspace;
    for (const part of parts) {
      current = join(current, part);
      if (!existsSync(current)) mkdirSync(current);
      const st = lstatSync(current);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Attachment destination is not a safe project directory.");
    }
    const canonical = realpathSync(current);
    const rel = relative(workspace, canonical);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Attachment destination escaped this project.");
    return canonical;
  }
  composerAttachmentSourcePaths(): Set<string> { return this.attachmentStore?.sourcePaths() ?? new Set(); }
  stageComposerAttachments(request: any, onChanged: (a: unknown) => void): unknown[] {
    this.mustGetWritable(String(request?.sessionId));
    return this.requireStore().stage(request, onChanged);
  }
  listComposerAttachments(sessionId: string): unknown[] { this.mustGet(sessionId); return this.attachmentStore ? this.attachmentStore.list(sessionId) : []; }
  composerAttachmentOwnership(sessionId: string, attachmentId: string): unknown { this.mustGet(sessionId); return this.requireStore().ownership(sessionId, attachmentId); }
  removeComposerAttachment(sessionId: string, attachmentId: string): unknown { this.mustGetWritable(sessionId); return this.requireStore().remove(sessionId, attachmentId); }
  retryComposerAttachment(sessionId: string, attachmentId: string, onChanged: (a: unknown) => void): unknown { this.mustGetWritable(sessionId); return this.requireStore().retry(sessionId, attachmentId, onChanged); }
  setComposerAttachmentDestination(sessionId: string, attachmentIds: string[], destination: string): unknown {
    this.mustGetWritable(sessionId);
    if (destination === "library") throw new Error("This project has no library yet."); // libraryDropDir L44998 (no tenant)
    return this.requireStore().setDestination(sessionId, attachmentIds, destination);
  }
  composerAttachmentPreview(sessionId: string, attachmentId: string, thumbnail?: (b: Buffer) => Buffer): Promise<unknown> { this.mustGet(sessionId); return this.requireStore().attachmentPreview(sessionId, attachmentId, thumbnail); }

  // ── docs/26: local / no-credential channels (original line refs per method) ──

  /** hasActiveJobWork (L47569). */
  private hasActiveJobWork(s: Session): boolean { return s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(s.meta.sessionId); }
  /** jobOwners (L47549). */
  private jobOwners(sessionId: string, jobId: string): Session[] {
    const target = this.sessions.get(sessionId);
    const cwd = target?.meta.cwd;
    if (!cwd) return [];
    return [...this.sessions.values()]
      .filter((other) => other.meta.sessionId !== sessionId && other.meta.jobId === jobId && other.meta.cwd === cwd)
      .sort((a, b) => a.meta.createdAt - b.meta.createdAt || a.meta.sessionId.localeCompare(b.meta.sessionId));
  }
  /** completedContinuation (L38929). */
  private completedContinuation(s: Session): Session | undefined {
    const receipt = s.meta.continuation as { sessionId?: string } | undefined;
    if (!receipt?.sessionId) return undefined;
    return this.sessions.get(receipt.sessionId);
  }
  /** deletionBlock (L39140): credit handoffs / workflow submissions do not exist in the port. */
  private deletionBlock(s: Session): string | undefined {
    if (this.hasActiveJobWork(s)) return "active-production";
    if (s.meta.jobId && this.d.jobBusyProbe?.(s.meta.jobId)) return "active-render";
    return undefined;
  }
  /** isDeleting (L39154). */
  isDeleting(sessionId: string): boolean { return this.deletingSessions.has(sessionId); }
  /** canonicalPath (L39196). */
  private canonicalPath(path: string): string { try { return realpathSync(resolvePath(path)); } catch { return resolvePath(path); } }
  /** jobDirectorySharedElsewhere (L39183). */
  private jobDirectorySharedElsewhere(sessionId: string, jobPath: string): boolean {
    const mine = this.canonicalPath(jobPath);
    for (const other of this.sessions.values()) {
      if (other.meta.sessionId === sessionId || !other.meta.jobId) continue;
      if (this.canonicalPath(join(other.meta.cwd, "jobs", other.meta.jobId)) === mine) return true;
    }
    return false;
  }
  /** ownedProjectData (L39172): only `jobs/<jobId>/` is ever owned, and only when no other video names it. */
  private ownedProjectData(s: Session): Array<{ label: string; path: string }> {
    const jobId = s.meta.jobId;
    if (!jobId || !isClientJobId(jobId)) return [];
    if (this.jobOwners(s.meta.sessionId, jobId).length > 0) return [];
    const jobPath = join(s.meta.cwd, "jobs", jobId);
    if (!existsSync(jobPath)) return [];
    if (this.jobDirectorySharedElsewhere(s.meta.sessionId, jobPath)) return [];
    return [{ label: `jobs/${jobId}`, path: jobPath }];
  }
  /** planProjectDeletion (L39205) — session:deletionPlan: read-only preview of a delete. */
  async planProjectDeletion(sessionId: string): Promise<unknown> {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    const blocked = this.deletionBlock(s);
    const sharedJob = Boolean(s.meta.jobId && this.jobOwners(sessionId, s.meta.jobId).length > 0);
    const base = { sessionId, title: s.meta.title, ...(s.meta.jobId ? { jobId: s.meta.jobId } : {}), ...(sharedJob ? { sharedJob: true } : {}) };
    try {
      const plan = await planProjectTrash(s.meta.cwd, this.ownedProjectData(s));
      return { ...base, ...(blocked ? { blocked } : {}), items: plan.items.map(({ label, bytes }: any) => ({ label, bytes })), totalBytes: plan.totalBytes, exact: plan.exact };
    } catch {
      return { ...base, blocked: "unreadable", items: [], totalBytes: 0, exact: false };
    }
  }
  /** jobNamedByAnySession (L39352). */
  private jobNamedByAnySession(sessionId: string, jobId: string): boolean {
    for (const other of this.sessions.values()) if (other.meta.sessionId !== sessionId && other.meta.jobId === jobId) return true;
    return false;
  }
  /** deleteProject (L39248) — session:delete: the video's own job moves into the workspace trash
   *  (verbatim moveProjectToTrash, 7-day retention) and the registry row goes. Beacons: no outbox. */
  async deleteProject(sessionId: string): Promise<unknown> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, reason: "That video is no longer in the sidebar." };
    if (this.deletingSessions.has(sessionId)) return { ok: false, reason: "This video is already being deleted." };
    const blocked = this.deletionBlock(s);
    if (blocked) return { ok: false, blocked, reason: deletionBlockMessage(blocked) };
    const reg = this.d.registry;
    const flush = () => (reg ? reg.flush() : true);
    this.deletingSessions.add(sessionId);
    try {
      const candidates = this.ownedProjectData(s);
      const jobId = candidates.length > 0 ? s.meta.jobId : undefined;
      if (candidates.length > 0) {
        reg?.addTrashWorkspace(this.canonicalPath(s.meta.cwd));
        if (!flush()) return { ok: false, reason: "Videoclaw could not save the trash location. Nothing was moved." };
      }
      let registryRemoved = false;
      const persistRemoval = () => {
        reg?.markRemoved(sessionId);
        if (!flush()) { reg?.unmarkRemoved(sessionId); throw new Error("Videoclaw could not save the video deletion."); }
        registryRemoved = true;
      };
      this.teardownRuntime(s, "delete");
      if (s.interrupting) await s.interrupting;
      this.retireWatcher(sessionId);
      let trashedBytes = 0;
      if (candidates.length > 0) {
        const late = this.deletionBlock(s);
        if (late) { this.ensureWatcher(s, true); return { ok: false, blocked: late, reason: deletionBlockMessage(late) }; }
        const moved: any = await moveProjectToTrash({
          workspace: s.meta.cwd, sessionId, clientId: s.meta.clientId, title: s.meta.title, ...(jobId ? { jobId } : {}), candidates,
          beforeComplete: persistRemoval,
          beforeMove: () => { const racing = this.deletionBlock(s); if (racing) throw new Error(deletionBlockMessage(racing)); },
        });
        if (!moved.ok) {
          if (registryRemoved) {
            this.sessions.set(sessionId, s);
            reg?.unmarkRemoved(sessionId);
            if (!flush()) moved.reason += " The video list could not be restored on disk; keep this app open and retry.";
          }
          this.ensureWatcher(s, true);
          return { ok: false, reason: moved.reason };
        }
        trashedBytes = moved.entry.totalBytes;
        if (jobId && !this.jobNamedByAnySession(sessionId, jobId)) this.versionStore?.forgetJob(jobId, candidates[0].path);
      }
      if (!registryRemoved) {
        try { persistRemoval(); } catch (error: any) { this.ensureWatcher(s, true); return { ok: false, reason: error.message }; }
      }
      this.removeSession(sessionId);
      try { this.spendBudgets.clear(sessionId); } catch {}
      this.log.info("agent.project.deleted", { sessionId, jobId: jobId ?? null, trashedBytes });
      return { ok: true, trashedBytes, retentionDays: Math.round(PROJECT_TRASH_RETENTION_MS / 864e5) };
    } finally {
      this.deletingSessions.delete(sessionId);
    }
  }
  /** setQuickstartResume (L38880). */
  setQuickstartResume(resume: (meta: AgentSessionMeta) => boolean): void { this.quickstartResume = resume; }
  /** quickstartStartFailed (L38888). */
  quickstartStartFailed(sessionId: string, message: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.send(s, { kind: "error", message: redactText(message), stage: "Starting your Quickstart", canRetry: true } as any);
    this.setStatus(s, "error");
  }
  /** updateQuickstartFirstTurn (L38899). */
  updateQuickstartFirstTurn(sessionId: string, firstTurn: { clientTurnId: string; attachmentIds: string[]; submittedAt?: number }): AgentSessionMeta {
    const s = this.mustGet(sessionId);
    if (!s.meta.quickstart) throw new Error("That video was not created from a Quickstart.");
    s.meta.quickstart = { ...(s.meta.quickstart as object), firstTurn: { clientTurnId: firstTurn.clientTurnId, attachmentIds: [...firstTurn.attachmentIds], ...(firstTurn.submittedAt === undefined ? {} : { submittedAt: firstTurn.submittedAt }) } };
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
    return { ...s.meta };
  }
  /** retryTurn (L42565) — session:retry: the normal (non-terms-recovery) path. Re-delivers the failed batch
   *  into a fresh (resumed) runtime. NOT PORTED: spend gate (no paid work), terms recovery (no mac login),
   *  heldTurnReplay (no spend holds). The port's host-wide turn gate refuses while another video works. */
  retryTurn(sessionId: string): boolean {
    const s = this.mustGet(sessionId);
    if (s.failedTurnCanRetry === false) return false;
    if (s.meta.finalizedAtMs) return false;
    const batch = s.failedInputs ?? [];
    if (batch.length === 0) {
      const qs = s.meta.quickstart as { firstTurn?: { submittedAt?: number } } | undefined;
      if (qs && !qs.firstTurn?.submittedAt) return this.quickstartResume?.(s.meta) ?? false;
      return false;
    }
    if (s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(sessionId)) return false;
    const limit = this.d.maxConcurrentTurns ?? 1;
    if (this.activeTurns() >= limit) throw new ComposerDeliveryError(`Another video is still working (this port runs ${limit} agent turn${limit === 1 ? "" : "s"} at a time). Wait for it or press Stop there.`);
    s.failedTurnCanRetry = undefined;
    s.failedInputs = undefined;
    this.log.info("agent.turn.retried", { sessionId, jobId: s.meta.jobId ?? null, sdkSessionId: s.meta.sdkSessionId ?? null, resent: batch.length });
    this.setStatus(s, "running");
    for (const input of batch) void this.deliver(s, input).catch((e) => this.log.warn("agent.retry.deliver_failed", { sessionId, error: e }));
    return true;
  }
  /** noteAdoptCandidate (L47697) slice (no beacon). */
  private noteAdoptCandidate(s: Session, jobId: string, reason: string): void {
    if (s.meta.jobId) return;
    const cur = s.meta.adoptCandidate as any;
    const owners = this.jobOwners(s.meta.sessionId, jobId);
    const owner = owners.find((c) => this.hasActiveJobWork(c)) ?? owners[0];
    const nextReason = owner ? "owned" : reason === "owned" ? "preexisting" : reason;
    if (cur?.jobId !== jobId && cur?.reason === "owned" && nextReason === "preexisting") return;
    const next = { jobId, reason: nextReason, ...(owner ? { ownerSessionId: owner.meta.sessionId, ownerTitle: owner.meta.title } : {}) };
    if (cur?.jobId === next.jobId && cur.reason === next.reason && cur.ownerSessionId === (next as any).ownerSessionId && cur.ownerTitle === (next as any).ownerTitle && cur.blockedReason === undefined) return;
    s.meta.adoptCandidate = next;
    this.saveRegistry();
    this.d.emit.sessionsChanged(this.listSessions());
  }
  /** adoptJob (L47802) — job:adopt: the explicit OUTPUT-rail adopt / dismiss. NOT PORTED: saved gateway
   *  operations, completed model results, gateway spend-policy materialization (no gateway). */
  adoptJob(sessionId: string, jobId: string | null): AgentSessionMeta | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (jobId === null) {
      if (s.meta.adoptCandidate) { delete s.meta.adoptCandidate; this.saveRegistry(); this.d.emit.sessionsChanged(this.listSessions()); }
      return s.meta;
    }
    if (s.meta.jobId || (s.meta.adoptCandidate as any)?.jobId !== jobId) return s.meta;
    if (this.deletingSessions.has(sessionId)) return s.meta;
    if (!existsSync(join(s.meta.cwd, "jobs", jobId))) {
      delete s.meta.adoptCandidate; this.saveRegistry(); this.d.emit.sessionsChanged(this.listSessions());
      return s.meta;
    }
    let owners = this.jobOwners(sessionId, jobId);
    let owner = owners.find((c) => this.hasActiveJobWork(c)) ?? owners[0];
    const offeredOwnerId = (s.meta.adoptCandidate as any).ownerSessionId as string | undefined;
    if ((offeredOwnerId && !owners.some((c) => c.meta.sessionId === offeredOwnerId)) || (!offeredOwnerId && owners.length > 0)) {
      this.noteAdoptCandidate(s, jobId, owner ? "owned" : "preexisting");
      return s.meta;
    }
    const activeOwner = owners.find((c) => this.hasActiveJobWork(c));
    if (activeOwner) {
      s.meta.adoptCandidate = { jobId, reason: "owned", ownerSessionId: activeOwner.meta.sessionId, ownerTitle: activeOwner.meta.title, blockedReason: "owner-active" };
      this.saveRegistry(); this.d.emit.sessionsChanged(this.listSessions());
      return s.meta;
    }
    owners = this.jobOwners(sessionId, jobId);
    owner = owners[0];
    if (owners.some((c) => this.deletingSessions.has(c.meta.sessionId))) { this.noteAdoptCandidate(s, jobId, owner ? "owned" : "preexisting"); return s.meta; }
    for (const priorOwner of owners) {
      try { this.spendBudgets.clear(priorOwner.meta.sessionId); } catch {} // clearSpendAccounting
      delete priorOwner.meta.jobId;
      if (priorOwner.runtime && !priorOwner.runtime.dead) this.teardownRuntime(priorOwner, "job-attribution"); // rotateRuntimeForJobAttribution
      this.retireWatcher(priorOwner.meta.sessionId);
      this.log.info("agent.job.transferred", { jobId, from: priorOwner.meta.sessionId, to: sessionId });
    }
    this.commitBind(s, jobId, "adopt", true);
    return s.meta;
  }
  /** startContinuationChat (L38972) — session:startContinuation: the finalized video's job moves into a new
   *  chat whose id is a pure function of {source, clientActionId}. Credit continuations: none in the port. */
  startContinuationChat(sourceSessionId: string, clientActionId: string): AgentSessionMeta {
    const src = this.mustGet(sourceSessionId);
    if (this.deletingSessions.has(sourceSessionId)) throw new Error("This video is being deleted.");
    if (typeof clientActionId !== "string" || !clientActionId.trim()) throw new Error("Missing continuation action id.");
    if (!src.meta.finalizedAtMs) throw new Error("Only a finalized video can be continued in a new video.");
    const targetId = (src.meta.continuation as any)?.sessionId ?? continuationSessionUuid(sourceSessionId, clientActionId);
    if (src.meta.jobId && this.hasActiveJobWork(src)) throw new Error("Finish or stop the current step first.");
    if (!this.sessions.get(targetId)) this.createSession({ continueFromSessionId: sourceSessionId }, undefined, { sessionId: targetId, deferJobAdoption: true });
    if ((src.meta.continuation as any)?.sessionId !== targetId) src.meta.continuation = { clientActionId, sessionId: targetId };
    this.flushRegistry();
    const movedJobId = src.meta.jobId;
    if (movedJobId) {
      this.adoptJob(targetId, movedJobId);
      if (this.sessions.get(targetId)?.meta.jobId !== movedJobId) throw new Error("Finish or stop the current step first.");
      src.meta.priorJobId = movedJobId;
      this.flushRegistry();
    } else {
      const owned = this.sessions.get(targetId)?.meta.jobId;
      if (owned && src.meta.priorJobId !== owned) { src.meta.priorJobId = owned; this.flushRegistry(); }
    }
    this.d.emit.sessionsChanged(this.listSessions());
    return this.mustGet(targetId).meta;
  }
  private flushRegistry(): boolean {
    if (this.d.registry) return this.d.registry.flush();
    this.saveRegistry();
    return true;
  }
  /** getOriginalContext (L45675) — job:originalContext. */
  async getOriginalContext(sessionId: string): Promise<unknown> {
    const s = this.sessions.get(sessionId);
    if (!s?.meta.jobId) return null;
    const jobPath = this.snapshotJobDir(s, s.meta.jobId);
    if (!jobPath) return null;
    const brief = readPromiseBrief(dirname(jobPath), jobPath);
    const events = await this.getHistory(sessionId);
    return assembleOriginalVideoContext(brief, events);
  }
  /** getSpendSnapshot (L45686) — spend:get. Safe for any id. */
  getSpendSnapshot(sessionId: string): unknown { return this.spendBudgets.snapshot(sessionId); }
  /** setSpendCeiling (L47158) + installSpendPolicy (L47222) — spend:setCeiling. The original asks the gateway
   *  first (writeGatewaySpendPolicy); with no gateway key it returns before any request (L47290), which is
   *  the only state the port can be in — so the local ledger is the whole authority. */
  async setSpendCeiling(sessionId: string, usd: unknown, options?: { confirmDisableBypass?: boolean; approvalRequestId?: string }): Promise<unknown> {
    const current = this.mustGet(sessionId);
    if (current.meta.permissionMode === "bypassPermissions" && options?.confirmDisableBypass !== true) throw new Error("Turn off Bypass before setting a hard spending limit.");
    const requestedUsd = normalizeSpendCeilingUsd(usd as number);
    if (requestedUsd === null || requestedUsd <= 0) throw new Error("Spend budget must be a positive finite amount.");
    if (options?.approvalRequestId !== undefined) throw new Error("That spending approval is no longer waiting."); // setApprovalSpendCeiling: no pending spend approvals exist
    const disablingBypass = current.meta.permissionMode === "bypassPermissions";
    if (this.spendBudgets.isBlocked()) throw new Error("Budget accounting is unavailable; the draft is safe.");
    this.spendBudgets.setCeiling(sessionId, requestedUsd);
    if (disablingBypass) {
      current.meta.permissionMode = "auto";
      this.saveRegistry();
      this.d.emit.sessionsChanged(this.listSessions());
      try { if (current.runtime && !current.runtime.dead) await (current.runtime.query as any).setPermissionMode?.("auto"); } catch { this.teardownRuntime(current, "permission-mode"); }
    }
    const snapshot = this.spendBudgets.snapshot(sessionId);
    const usedUsd = (snapshot.spentUsd ?? 0) + snapshot.reservedUsd;
    return { snapshot, ...(usedUsd > requestedUsd ? { warning: `You've already used $${usedUsd.toFixed(2)}. New paid work will wait until you raise the budget.` } : {}) };
  }
  /** loadSpendBudgets (L36570) slice: restore spend-budgets.json; NOT PORTED: the storage-block marker. */
  private loadSpendBudgets(): void {
    if (!this.spendBudgetFile) return;
    let saved: string | undefined;
    try {
      saved = readFileSync(this.spendBudgetFile, "utf-8");
      const { migrated } = this.spendBudgets.restore(JSON.parse(saved));
      if (migrated) this.writeSpendBudgets(this.spendBudgets.exportState());
    } catch (err: any) {
      if (this.spendBudgets.isBlocked()) return;
      if (saved === undefined && err?.code === "ENOENT") return;
      this.spendBudgets.blockDueToCorruption();
      this.log.warn("agent.spend.load_failed", { error: err });
    }
  }
  /** writeSpendBudgets (L36640) slice: tmp → rename. */
  private writeSpendBudgets(state: unknown): void {
    if (!this.spendBudgetFile) return;
    mkdirSync(dirname(this.spendBudgetFile), { recursive: true });
    const temporary = `${this.spendBudgetFile}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    renameSync(temporary, this.spendBudgetFile);
  }
  /** respondInput (L44689) — input:respond. The port has no request_input tool (studio MCP not ported), so
   *  pendingInputs is always empty: takePendingInput finds nothing and the answer is dropped (original branch). */
  respondInput(requestId: string, response: unknown): void {
    this.log.info("agent.input.respond_no_pending", { requestId: String(requestId).slice(0, 64), kind: (response as any)?.kind ?? null });
  }
  /** discardVoice (L45705) — media:discardVoice: voiceDictations is empty (no on-device dictation helper). */
  discardVoice(_sessionId: string, _recordingId: string): void {}
  /** assertComposerWritable (L44801). */
  assertComposerWritable(sessionId: string): void { this.mustGetWritable(sessionId); }
  /** stageComposerAttachments with a captured moment (L44747). */
  stageComposerMoment(request: any, onChanged: (a: unknown) => void, moment: unknown): unknown[] {
    this.mustGetWritable(String(request?.sessionId));
    return this.requireStore().stage(request, onChanged, moment);
  }
  /** stageVoiceNote (L44753): an ordinary audio chip. The on-device transcript (voiceDictationStatus) is
   *  unavailable off macOS, so no background transcription starts — the original's `available:false` path. */
  stageVoiceNote(sessionId: string, _recordingId: string, note: { file: unknown; seconds: number }, onChanged: (a: unknown) => void): unknown[] {
    this.mustGetWritable(sessionId);
    return this.requireStore().stage({ sessionId, destination: "video", files: [note.file] }, onChanged, undefined, { seconds: note.seconds });
  }
  /** composerMomentPreview (L44956). */
  composerMomentPreview(sessionId: string, attachmentId: string, thumbnail?: (b: Buffer) => Buffer): unknown { this.mustGet(sessionId); return this.requireStore().momentPreview(sessionId, attachmentId, thumbnail); }
  /** sessionMaterials (L44828). */
  sessionMaterials(sessionId: string): unknown { return this.readMaterials(this.mustGet(sessionId)); }
  /** readMaterials (L44913). */
  private readMaterials(s: Session, limit?: number): any {
    if (!this.materialsLedger) return { entries: [], total: 0 };
    const boundJob: any = resolveJobDir({ sessionId: s.meta.sessionId, jobId: s.meta.jobId }, (id) => this.sessions.get(id)?.meta as any);
    const qs = s.meta.quickstart as { starterId?: string } | undefined;
    return this.materialsLedger.read(s.meta.sessionId, this.attachmentStore.materials(s.meta.sessionId),
      boundJob.ok ? { dir: join(boundJob.jobPath, "incoming", "quickstart"), ...(qs?.starterId ? { starterId: qs.starterId } : {}) } : undefined, limit);
  }
  /** materialPreview (L44876) — materials:preview (the vcmedia grant is added by the IPC layer, L62197). */
  materialPreview(sessionId: string, id: string): any {
    const s = this.mustGet(sessionId);
    if (!this.materialsLedger) return null;
    const entry = this.readMaterials(s, Infinity).entries.find((item: any) => item.id === id);
    if (!entry) return null;
    const bound: any = resolveJobDir({ sessionId, jobId: s.meta.jobId }, (key) => this.sessions.get(key)?.meta as any);
    const path = this.materialsLedger.resolve(sessionId, id, this.attachmentStore.materials(sessionId), bound.ok ? { dir: join(bound.jobPath, "incoming", "quickstart") } : undefined);
    if (!path || !["image", "video", "audio"].includes(entry.kind)) return { entry };
    try {
      const st = statSync(path);
      if (!st.isFile()) return { entry: { ...entry, state: "missing" } };
      return { entry, asset: { path, name: entry.name, kind: entry.kind, scope: "source", sizeBytes: st.size, mtimeMs: st.mtimeMs } };
    } catch {
      return { entry: { ...entry, state: "missing" } };
    }
  }
  /** publishMaterials (L44932): journal new ledger rows into the display transcript, push material_arrived
   *  + materials:changed. */
  publishMaterials(sessionId: string, emitArrivals = true): void {
    const s = this.sessions.get(sessionId);
    if (!s || !this.materialsLedger || !this.d.stateDir) return;
    try {
      const ledger = this.readMaterials(s, Infinity);
      const digest = JSON.stringify(ledger);
      if (s.materialsDigest === digest) return;
      let persisted = true;
      const file = displayTranscriptPath(this.d.stateDir, sessionId);
      const seen = new Set(readDisplayTranscript(file).ordered.flatMap((row: any) => (row.kind === "material" ? [row.entry.id] : [])));
      for (const entry of ledger.entries) {
        if (seen.has(entry.id)) continue;
        if (appendDisplayMaterial(file, entry, s.lastAssistantMessageId)) {
          if (emitArrivals) this.send(s, { kind: "material_arrived", entry } as any);
        } else persisted = false;
      }
      if (persisted) s.materialsDigest = digest;
      this.d.emit.materials?.(sessionId, ledger);
    } catch {}
  }
  /** codexDisconnectImpact L52416: Codex videos with a live runtime mid-turn. */
  codexRunningVideoCount(): number { let n = 0; for (const s of this.sessions.values()) if (s.meta.agentHarness === "codex-app-server" && s.runtime && (s.meta.status === "running" || s.meta.status === "awaiting_permission")) n++; return n; }
  /** retireCodexRuntimes (runCodexDisconnect L52467): tear down every Codex runtime; returns how many were mid-turn. */
  retireCodexRuntimes(): number {
    let stopped = 0;
    for (const s of this.sessions.values()) {
      if (s.meta.agentHarness !== "codex-app-server" || !s.runtime) continue;
      const active = s.meta.status === "running" || s.meta.status === "awaiting_permission";
      this.teardownRuntime(s, "codex-disconnect");
      if (active) { stopped++; this.send(s, { kind: "error", message: "Codex was disconnected before this turn finished.", canRetry: true }); this.setStatus(s, "error"); }
    }
    return stopped;
  }
  /** runningVideoCount (local reset prepare). */
  runningVideoCount(): number { let n = 0; for (const s of this.sessions.values()) if (s.meta.status === "running" || s.meta.status === "awaiting_permission") n++; return n; }
  /** closeAll (L43010) slice: tear every runtime down (local reset commit). */
  closeAll(): number[] { for (const s of this.sessions.values()) this.teardownRuntime(s, "local-reset"); return []; }
  /** host session meta by id (HyperFrames preview / editor render liveSession L62403). */
  liveSession(sessionId: string): AgentSessionMeta | undefined { return this.isDeleting(sessionId) ? undefined : this.sessions.get(sessionId)?.meta; }
}

/** continuationSessionUuid (L1200) — verbatim. */
export function continuationSessionUuid(sourceSessionId: string, clientActionId: string): string {
  const hex = createHash("sha256").update(`videoclaw-continuation-chat\0${sourceSessionId}\0${clientActionId}`, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
