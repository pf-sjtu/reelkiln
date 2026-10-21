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
import { modelAccountLimit, modelAccountLimitPresentation } from "./account-limit.generated";
import { deletionBlockMessage, moveProjectToTrash, planProjectTrash, PROJECT_TRASH_RETENTION_MS } from "../jobs/project-trash.generated";
import { assembleOriginalVideoContext, readPromiseBrief } from "../jobs/original-context.generated";
import { MaterialsLedger } from "../materials/materials-ledger.generated";
import { SessionSpendBudgets, requiredSpendCeilingUsd, spendBudgetAuthority } from "../spend/spend-budgets.generated";
import { PLAN_FIRST_REFUSAL, UNKNOWN_COST_BUDGET_REFUSAL, quotedOperationLine, quotedSpendDescription, raiseBudgetDescription, settledAskFromPermission as settledAskFromPermissionGenerated, spendPolicyForMaterialChange } from "../spend/spend-approval.generated";
/** the generated slice is untyped JS: its trailing parameters are optional in the original */
const settledAskFromPermission = settledAskFromPermissionGenerated as (request: any, outcome: string, answers?: unknown, selections?: unknown, savedBudgetUsd?: number) => any;
import { costUsd, type ModelPrice } from "../gateway/pricing";
import { normalizeSpendCeilingUsd } from "../spend/spend-wb.generated";
import { resolveJobDir } from "../engine/job-boundary";
import { attachmentContextLines, ComposerAttachmentStore, composerTurnMessageUuid } from "../attachments/composer-attachments.generated";
import type { LlmRouteId } from "../../shared/llm-types";
import { ClaudeCodeController, type ClaudeCodeDeps } from "./claude-code";
import { minimalAgentOptions, type ClaudeAgentSdkLike, type AgentQuery } from "../llm/agent-sdk";
import { getLogger, redact, redactText, registerSecret, type Logger } from "../llm/logger";
import type { SessionMetaLike } from "../llm/route-service";
import { isClientJobId } from "../engine/session";
import type { AgentGatewayProxy, GatewaySessionPolicy } from "../gateway/agent-gateway-proxy";
import { isAnthropicPassthroughPath, isUnknownCostQuote, SPEND_POLICY_CONFLICT_MESSAGE } from "../gateway/agent-gateway-proxy";
import { sanitizedAgentEnv } from "../llm/llm-route";
import { execFile } from "node:child_process";
import {
  adaptClaudeCodeCanUseTool, claudeCodeDisallowedTools, engineChildEnv, engineTurnText, ensureJobDir, firstMessageJobId, isPreexistingJob, listJobIds,
  makeEngineCanUseTool, makeEngineHooks, prepareEngineSpawn, providerRouteHint, sniffJobIds,
  type CanUseToolResult, type EnginePolicyHost, type EngineSessionDeps, type PermissionRequest,
} from "./engine-session";
import { fallbackSessionTitle, NEW_VIDEO_TITLE } from "./session-title.generated";
import { SessionPlanHost } from "../studio/session-plan-host";
import { makeStudioToolset, makeCodexToolset, type StudioInputRequest } from "../studio/studio-toolset";
import { claudeCodeAllowedTools, settledAskFromInput } from "../studio/studio-tools.generated";
import { appendDisplayAsk, appendDisplayPreference } from "./history.generated";
import { saveAccountCommitment } from "../taste/taste.generated";
import type { ProjectMemoryHost } from "../memory/project-memory-host";
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
  /** docs/30: push input:request (original emit.inputRequest L61068). */
  inputRequest?(req: unknown): void;
  /** docs/30: push sessionPlan:changed (original emit.sessionPlanChanged, emitSessionPlan L37106). */
  sessionPlanChanged?(payload: unknown): void;
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
  /** docs/28: the Claude Code login + catalog seams (claude-code.ts). Absent → the controller still runs with
   *  the PORT defaults (no login probe, connect refused) and an empty model source. */
  claude?: Pick<ClaudeCodeDeps, "available" | "connector" | "modelSource" | "catalogTimeoutMs">;
  /** docs/29: host.setCreditHandoffEligibility (main L61622 → AccountService.creditHandoffEligibility) and the
   *  pinned gateway settings (activeSettings) the credit route runs on (the docs/28 local gateway shim). */
  creditEligibility?: () => Promise<Record<string, any>>;
  gatewaySettings?: () => { gatewayUrl?: string; gatewayKey?: string };
  /** docs/31: agentGatewayProxy (L39643) — the verbatim AgentGatewayProxy started over the self-hosted gateway. */
  agentGatewayProxy?: () => AgentGatewayProxy | undefined;
  /** docs/31: currentEngine()?.version for the proxy's diagnostic headers (agentGatewayPolicy L39708). */
  engineVersion?: () => string | undefined;
  /** docs/32: IDLE_ENGINE_CHILD_SWEEP_MS (L34782) for the accepted-operation collector sweep; 0 disables (tests). */
  operationSweepMs?: number;
  /** docs/30: THE price table (gateway/pricing.ts priceTable: env → models.dev → MiniMax fallback) — the same resolver
   *  the local gateway ledger charges with. Every route's displayed spend is priced with it from metered token usage;
   *  the SDK's Claude-priced total_cost_usd is never shown. Absent → no LLM spend is shown (tests / chat mode). */
  price?: (model: string) => ModelPrice;
  /** docs/30: the model a non-MiniMax id (a Claude alias the shim / proxy maps) is actually served by. */
  servedModel?: () => string | undefined;
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
  /** docs/31: spawnLocal's engineEnv2 (L39462) — the studio paid tools read VIDEOCLAW_GATEWAY_URL/API_KEY from it. */
  engineEnv?: Record<string, string>;
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
  /** docs/29: emitFailureCard (L42367) — the Claude account limit ended the last turn. */
  claudeAllowanceExhausted?: boolean;
  claudeAllowanceTurnIds?: string[];
  /** docs/30: the session plan (L36986 restoredSessionPlan / L37066 persistSessionPlan) + its brief anchor (L41756). */
  sessionPlan?: any;
  sessionPlanRequired?: boolean;
  lastUserTurnId?: string;
  sessionPlannerRequest?: unknown;
}
interface DeliveredInput { msg: Record<string, any>; displayTexts: string[]; attachmentIds: string[] }
interface PendingPermission { request: PermissionRequest; sessionId: string; runtime?: Runtime; order: number; resolve: (r: CanUseToolResult) => void; spendPolicyCeilingUsd?: number }

export const DEFAULT_AGENT_TOOLS = ["Read", "Glob", "Grep"];
/** PORT-NEW UI-e2e fault injection (docs/29 §6): the Claude subscription limit is an EXTERNAL precondition the
 *  port can never reach (USER DIRECTIVE: no real Claude subscription). Only with VIDEOCLAW_PORT_UI_E2E=1 and
 *  VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT set, a claude-code-route turn fails with that raw CLI text instead of
 *  starting the Claude CLI; everything after it (classification, card, offer, continuation) is the real path. */
export function claudeLimitInjection(llmRoute: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const text = env.VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT;
  return env.VIDEOCLAW_PORT_UI_E2E === "1" && llmRoute === "claude-code" && text ? text : undefined;
}
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
  /** docs/32 M15: spend-approval cards (pendingSpendOperations L34930, retiredSpendApprovals, budgetApprovalSaves,
   *  spendPolicyChangeGenerations, raiseRepricesScheduled). */
  private readonly pendingSpendOperations = new Map<string, any>();
  private readonly retiredSpendApprovals = new Map<string, { sessionId: string; reason: string }>();
  private readonly budgetApprovalSaves = new Set<string>();
  private readonly spendPolicyChangeGenerations = new Map<string, number>();
  private readonly raiseRepricesScheduled = new Set<string>();
  /** docs/30: studio input requests (pendingInputs L34985, rememberInput L38545). */
  private readonly pendingInputs = new Map<string, { request: any; sessionId: string; runtime?: Runtime; order: number; resolve: (r: any) => void; resolveOnRetire: boolean }>();
  /** docs/30: the session-plan lifecycle (studio/session-plan-host.ts) and the project-memory host it binds through. */
  readonly plans?: SessionPlanHost;
  private memory?: ProjectMemoryHost;
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
  /** docs/28: the Claude Code half (claude-code.ts). */
  readonly claude: ClaudeCodeController;
  constructor(private readonly d: AgentHostDeps) {
    this.log = (d.logger ?? getLogger()).child({ component: "agent-host" });
    this.claude = new ClaudeCodeController({
      ...(d.claude ?? { modelSource: { identity: async () => ({ key: "none", signedIn: false }), discover: async () => ({ models: [] }) } }),
      sessions: () => this.sessions.values() as any,
      sessionLlmRoute: (meta: any) => this.d.service.sessionLlmRoute?.({ llmRoute: meta.llmRoute, agentHarness: "claude-code" }) ?? meta.llmRoute ?? "claude-code",
    });
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
      const stateDir = d.stateDir;
      this.plans = new SessionPlanHost({
        stateDir,
        session: (id) => this.sessions.get(id) as any,
        isLive: (ps) => this.sessions.get(ps.meta.sessionId) === (ps as any) && !this.deletingSessions.has(ps.meta.sessionId),
        memoryBinding: (clientId) => { if (!this.memory) throw new Error("Project memory is unavailable until this account and project are verified."); return this.memory.memoryBinding(clientId); },
        verifiedMemorySource: (clientId, source) => { if (!this.memory) throw new Error("Project memory is unavailable."); return this.memory.verifiedMemorySource(clientId, source); },
        flushRegistry: () => this.flushRegistry(),
        sendMessage: (id, req) => this.sendMessage(id, req),
        spendSnapshot: (id) => this.spendBudgets.snapshot(id),
        requestWitness: (id, requireRuntime) => this.requestWitness(id, requireRuntime),
        turnAccepted: (id, clientTurnId) => { const r = (this.attachmentStore as any)?.turns?.get(clientTurnId); return !!r && r.sessionId === id && r.state === "committed"; },
        emitSessionPlanChanged: (payload) => { try { this.d.emit.sessionPlanChanged?.(payload); } catch {} },
        isComposerDeliveryError: (e) => e instanceof ComposerDeliveryError,
      });
    }
    // L34832: the per-video spend ledger. No gateway key exists in the port → the original's
    // spendBudgetAuthority(gatewayUrl, undefined) authority; persisted to spend-budgets.json (L34826).
    this.spendBudgetFile = d.stateDir ? join(d.stateDir, "spend-budgets.json") : undefined;
    this.spendBudgets = new SessionSpendBudgets(
      (sessionId: string, snapshot: unknown) => { try { this.d.emit.spendSnapshot?.(sessionId, snapshot); } catch {} this.scheduleRaiseReprice(sessionId); },
      (state: unknown) => this.writeSpendBudgets(state),
      spendBudgetAuthority("http://localhost", undefined),
    );
    this.loadSpendBudgets();
    // L34905-34913: the idle sweep collects accepted operations (collectAcceptedOperations L39793)
    const sweepMs = d.operationSweepMs ?? 15e3;
    if (d.engine && d.agentGatewayProxy && sweepMs > 0) {
      this.operationSweep = setInterval(() => this.collectAcceptedOperations(), sweepMs);
      this.operationSweep.unref?.();
    }
  }
  private operationSweep?: ReturnType<typeof setInterval>;
  /** operationCollectors (L39795) keyed JSON.stringify([sessionId, owner, id]) */
  private readonly operationCollectors = new Map<string, AbortController>();
  private operationCollectorCursor = 0;
  /** interrupt L43868-43893 — Stop marks this video's accepted operations cancelRequested (due now) and aborts
   *  their running collectors, so the next collection passes --cancel. */
  private requestOperationCancellation(s: Session): Error | undefined {
    try {
      const rows: any[] = Array.isArray((s.meta as any).acceptedOperations) ? (s.meta as any).acceptedOperations : [];
      const pending = rows.map((row) =>
        (!row.cancelRequested || (row.nextRecoveryAt ?? 0) > Date.now()) && row.owner?.client_job === s.meta.jobId && row.cwd === s.meta.cwd
          ? { ...row, cancelRequested: true, nextRecoveryAt: 0 } : row);
      if (pending.some((row, index) => row !== rows[index])) {
        (s.meta as any).acceptedOperations = pending;
        if (!this.flushRegistry()) {
          (s.meta as any).acceptedOperations = rows;
          throw new Error("The app could not save media cancellation. Your accepted media is still being recovered; try Stop again.");
        }
        for (const row of pending) if (row.cancelRequested) this.operationCollectors.get(JSON.stringify([s.meta.sessionId, row.owner, row.id]))?.abort();
        this.log.info("agent.paid.cancel_requested", { sessionId: s.meta.sessionId, operations: pending.filter((r) => r.cancelRequested).map((r) => r.id) });
      }
      return undefined;
    } catch (error) {
      this.log.warn("agent.paid.cancel_request_failed", { sessionId: s.meta.sessionId, error });
      return error instanceof Error ? error : new Error("Media cancellation could not be saved.");
    }
  }
  /** collectAcceptedOperations (L39793) — the /v1/model_call slice (the only durable path the port's tools
   *  create). Runs engine tools/_operations.py with a recovery-only proxy capability (auxiliaryCredentials with
   *  recoveryOnly + cancelOperationId on a Stop): a completed operation leaves acceptedOperations, its completion
   *  joins completedModelResults, the job watcher picks up incoming/, and spend reconciles; a failed collection
   *  backs off 15s·2^n (≤1h). NOT PORTED: busy-collector lock wrapper, late-result lines/reports, materials
   *  reconcile for media pulls, collectorOwned journal marks (docs/32). Returns the collections it started. */
  collectAcceptedOperations(): Promise<void>[] {
    const proxy = this.d.agentGatewayProxy?.();
    const started: Promise<void>[] = [];
    if (!proxy || this.operationCollectors.size >= 2) return started;
    const engine = this.d.engine?.currentEngine()?.path;
    if (!engine) return started;
    const python = join(engine, ".venv", "bin", "python");
    const script = join(engine, "tools", "_operations.py");
    if (!existsSync(python) || !existsSync(script)) return started;
    const gatewayUrl = (this.d.gatewaySettings?.().gatewayUrl ?? "").replace(/\/+$/, "");
    const pending: Array<{ s: Session; operation: any }> = [];
    for (const s of this.sessions.values()) {
      if (s.interrupting || this.deletingSessions.has(s.meta.sessionId)) continue;
      const rows: any[] = Array.isArray((s.meta as any).acceptedOperations) ? (s.meta as any).acceptedOperations : [];
      for (const operation of rows) {
        if (operation?.path !== "/v1/model_call" || typeof operation.id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(operation.id)) continue;
        // collectionDue (L40429)
        if (operation.owner?.gateway_url !== gatewayUrl || (operation.nextRecoveryAt ?? 0) > Date.now() || operation.recoveryParked?.engine === engine) continue;
        pending.push({ s, operation });
      }
    }
    for (let checked = 0; checked < pending.length && this.operationCollectors.size < 2; checked++) {
      const { s, operation } = pending[this.operationCollectorCursor++ % pending.length];
      const sessionId = s.meta.sessionId;
      const key = JSON.stringify([sessionId, operation.owner, operation.id]);
      if (this.operationCollectors.has(key)) continue;
      const controller = new AbortController();
      const activeJobId = s.meta.jobId;
      const current = () => !controller.signal.aborted && this.sessions.get(sessionId) === s && s.meta.jobId === activeJobId;
      const boundJob: any = resolveJobDir({ sessionId, jobId: operation.owner.client_job }, () => ({ ...s.meta, cwd: operation.cwd, jobId: operation.owner.client_job }) as any);
      let refused: string | undefined;
      let notFound = false;
      let credentials2: { gatewayKey: string; gatewayUrl: string };
      try {
        credentials2 = proxy.auxiliaryCredentials(sessionId, {
          projectId: () => operation.owner.project_id,
          jobId: () => operation.owner.client_job,
          recoveryOnly: true,
          noteCapabilityRefusal: (method: string, path: string) => { refused ??= `${method} ${path}`; },
          noteOperationNotFound: (operationId: string) => { if (operationId === operation.id) notFound = true; },
          ...(operation.cancelRequested ? { cancelOperationId: operation.id } : {}),
        } as any) as any;
      } catch { continue; }
      this.operationCollectors.set(key, controller);
      const collectorArgs = boundJob.ok ? ["--job", boundJob.jobPath, "--operation-id", operation.id, "--owner-json", JSON.stringify(operation.owner), "--request-sha256", operation.sha256, ...(operation.cancelRequested ? ["--cancel"] : [])] : [];
      const collect = boundJob.ok
        ? new Promise<string>((resolve2, reject) => {
          execFile(python, [script, ...collectorArgs], {
            cwd: dirname(boundJob.jobsDir), timeout: 3e5, signal: controller.signal, maxBuffer: 16 * 1024 * 1024,
            env: {
              ...sanitizedAgentEnv(process.env), PATH: (() => { try { return this.d.engine!.engineSessionEnv().PATH ?? process.env.PATH ?? ""; } catch { return process.env.PATH ?? ""; } })(), UV_PYTHON_PREFERENCE: "only-managed",
              VIDEOCLAW_ENGINE: engine, VIDEOCLAW_WORKSPACE: dirname(boundJob.jobsDir), VIDEOCLAW_JOBS_DIR: boundJob.jobsDir, PYTHON_DOTENV_DISABLED: "1",
              VIDEOCLAW_COLLECTOR_DELIVERY: "v1", VIDEOCLAW_API_KEY: credentials2.gatewayKey, VIDEOCLAW_GATEWAY_URL: credentials2.gatewayUrl,
            },
          }, (error, out) => { if (error) { (error as any).stdout = String(out ?? ""); reject(error); } else resolve2(String(out)); });
        })
        : Promise.reject(new Error("The original video directory is unavailable for recovery."));
      const run = collect.then(async (output) => {
        if (!current()) return;
        const last = output.trimEnd().split("\n").at(-1)?.trim();
        let result: any; try { result = last?.startsWith("{") ? JSON.parse(last) : undefined; } catch {}
        if (!result || result.operation_id !== operation.id || typeof result.complete !== "boolean") throw new Error("Collector returned an invalid operation result.");
        const rows: any[] = Array.isArray((s.meta as any).acceptedOperations) ? (s.meta as any).acceptedOperations : [];
        if (!rows.includes(operation)) return;
        this.log.info("agent.paid.operation_collected", { sessionId, operationId: operation.id, status: result.status, complete: result.complete, cancelRequested: operation.cancelRequested === true });
        if (!result.complete) {
          if (operation.recoveryFailures || operation.gatewayNotFound) { operation.recoveryFailures = 0; delete operation.nextRecoveryAt; delete operation.gatewayNotFound; this.saveRegistry(); }
          return;
        }
        const previousCompletions = (s.meta as any).completedModelResults;
        if (result.completion !== undefined && boundJob.ok) {
          const completion = result.completion;
          if (completion?.operation_id !== operation.id || completion.status !== result.status || (Array.isArray(completion.saved) && completion.saved.some((path: string) => !isAbsolute(path) || !/^incoming\/model-[A-Za-z0-9._-]+$/.test(relative(boundJob.jobPath, path))))) {
            throw new Error("Collector returned an invalid model completion.");
          }
          (s.meta as any).completedModelResults = [...(previousCompletions ?? []).filter((row: any) => row?.result?.operation_id !== operation.id),
            { projectId: operation.owner.project_id, jobId: operation.owner.client_job, cwd: operation.cwd, requestSha256: operation.sha256, result: completion }].slice(-32);
        }
        (s.meta as any).acceptedOperations = rows.filter((row) => row !== operation);
        if (!this.flushRegistry()) {
          (s.meta as any).acceptedOperations = rows;
          (s.meta as any).completedModelResults = previousCompletions;
          throw new Error("The collected result could not be saved yet.");
        }
        if (result.status === "succeeded") { try { this.ensureWatcher(s, true); } catch {} }
        await this.reconcileGatewaySpend(s);
      }).catch((error) => {
        if (controller.signal.aborted || this.sessions.get(sessionId) !== s) return;
        const rows: any[] = Array.isArray((s.meta as any).acceptedOperations) ? (s.meta as any).acceptedOperations : [];
        if (!rows.includes(operation)) return;
        const failures = Math.min((operation.recoveryFailures ?? 0) + 1, 10);
        if (notFound && (!operation.recoveryFailures || operation.gatewayNotFound)) operation.gatewayNotFound = true; else delete operation.gatewayNotFound;
        operation.recoveryFailures = failures;
        operation.nextRecoveryAt = Date.now() + Math.min(15e3 * 2 ** failures, 36e5);
        if (refused !== undefined) { operation.recoveryParked = { engine }; delete operation.nextRecoveryAt; } else delete operation.recoveryParked;
        this.saveRegistry();
        this.log.warn("agent.paid.operation_collect_failed", { sessionId, operationId: operation.id, failures, refused, error: redactText(error instanceof Error ? error.message : String(error)).slice(0, 400) });
      }).finally(() => { if (this.operationCollectors.get(key) === controller) this.operationCollectors.delete(key); });
      started.push(run);
    }
    return started;
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
  async setPermissionMode(sessionId: string, mode: string, options?: { confirmSpendLimitRemoval?: boolean }): Promise<void> {
    const s = this.mustGet(sessionId);
    if (typeof mode !== "string" || !["default", "acceptEdits", "auto", "plan", "bypassPermissions"].includes(mode)) throw new Error("Invalid permission mode.");
    // L43996-44003 (docs/32): Bypass removes a hard limit only with explicit consent
    const spend = this.spendBudgets.snapshot(sessionId);
    if (mode === "bypassPermissions" && spend.policy === "capped" && options?.confirmSpendLimitRemoval !== true) throw new Error("Bypass requires explicit confirmation to remove the hard spending limit.");
    delete s.meta.permissionModeSwitchFailed;
    if (s.meta.status === "running" || s.meta.status === "awaiting_permission" || this.preparing.has(sessionId)) {
      if (mode === s.meta.permissionMode) delete s.meta.pendingPermissionMode;
      else s.meta.pendingPermissionMode = mode;
      this.saveRegistry();
      this.d.emit.sessionsChanged(this.listSessions());
      return;
    }
    delete s.meta.pendingPermissionMode;
    this.beginSettingsSpendPolicyChange(sessionId, "settings"); // L44011
    await this.enqueueSpendPolicyUpdate(sessionId, async () => {
      const priorMode = s.meta.permissionMode;
      const runtime = s.runtime && !s.runtime.dead ? s.runtime : undefined;
      let runtimeSwitched = false;
      if (runtime) {
        try { await (runtime.query as any).setPermissionMode?.(mode); runtimeSwitched = true; } catch { if (s.runtime === runtime) this.teardownRuntime(s, "permission-mode"); }
      }
      // applyPermissionMode L44128: Bypass ⇒ unlimited_for_video; leaving Bypass ⇒ ask_each (spendPolicyForMaterialChange L34057)
      try {
        const modePolicy = spendPolicyForMaterialChange({ priorMode, mode }) as any;
        if (modePolicy) await this.installSpendPolicy(sessionId, modePolicy);
      } catch (error) {
        if (runtimeSwitched && s.runtime === runtime) await (runtime!.query as any).setPermissionMode?.(priorMode).catch(() => { if (s.runtime === runtime) this.teardownRuntime(s, "permission-mode"); });
        throw new Error(`Videoclaw couldn't switch this video to ${mode}.`);
      }
      s.meta.permissionMode = mode;
      this.saveRegistry();
      this.d.emit.sessionsChanged(this.listSessions());
    });
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
      return { ...persisted, ...(s.contextEpoch ? { contextEpoch: s.contextEpoch } : {}), ...(this.plans ? this.plans.registryFields(s as any) : s.sessionPlanRequired ? { sessionPlanRequired: true } : {}) };
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
      const { liveWork: _l, mediaRecoveryNeeded: _m, contextEpoch, sessionPlan: _p, sessionPlanDetails: _pd, dismissedSessionPlan: _dp, sessionPlanRequired: _pr, ...meta } = row;
      const planState = this.plans ? this.plans.restoredSessionPlan(row) : {}; // restoredSessionPlan L36986 (public meta strips the plan, L35717)
      this.sessions.set(row.sessionId, { meta: { ...meta, status: "idle", portAgentHost: true } as AgentSessionMeta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0, ...(typeof contextEpoch === "string" ? { contextEpoch } : {}), ...planState });
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
  createSession(req: { title?: string; clientId?: string; permissionMode?: string; continueFromSessionId?: string } = {}, quickstart?: Record<string, unknown>, internal?: { sessionId?: string; deferJobAdoption?: boolean; providerMigration?: { agentHarness: "codex-app-server" | "claude-code"; codexProvider?: string; llmRoute?: string } }): AgentSessionMeta {
    const sessionId = internal?.sessionId ?? randomUUID();
    const migration = internal?.providerMigration; // L38756
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
    const agentHarness = migration ? migration.agentHarness : continued ? (continued.meta.agentHarness ?? "claude-code") : (this.codex ? resolvedAgentHarness(codexSettings) : "claude-code");
    const codexProvider = migration ? (migration.codexProvider ?? DEFAULT_CODEX_PROVIDER) : continued ? ((continued.meta.codexProvider as string | undefined) ?? DEFAULT_CODEX_PROVIDER) : resolvedCodexProvider(codexSettings);
    const codexModelOverride = agentHarness === "codex-app-server" ? (continued && !migration ? (continued.meta.modelOverride as string | undefined) : this.codex?.accountCodexModel(codexProvider)) : undefined;
    if (agentHarness === "codex-app-server") {
      if (!this.codex) throw new Error("Codex is unavailable right now.");
      this.codex.assertEnabled();
      if (codexProvider !== "chatgpt" && !isQualifiedCodexRoute(codexProvider, codexModelOverride, this.codex.evidence)) throw new Error((codexRouteDiagnostic as any)(codexProvider, codexModelOverride, this.codex.evidence));
    }
    const llmRoute = agentHarness !== "claude-code" ? undefined : migration?.llmRoute ?? (continued && !migration ? continued.meta.llmRoute : this.d.service.newSessionLlmRoute({}));
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
    this.sessions.set(sessionId, { meta, openTools: new Set(), clientTurns: new Set(), staleResults: 0, epoch: 0, ...(this.d.engine ? { preexistingJobs: listJobIds(cwd), sessionPlanRequired: true } : {}) }); // L38862
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
        // L41666: the app-owned session-plan preamble (sessionPlanTurnContext L38254) leads the engine text
        const planContext = this.plans && req.clientTurnId ? this.plans.sessionPlanTurnContext(s as any, req.clientTurnId) : "";
        if (planContext) wireText = `${planContext}\n\n${wireText}`;
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
    s.lastUserTurnId = msg.uuid; // L41756
    this.plans?.recordAcceptedPlanSource(s as any, msg); // L42071
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
    const engineSpawn = this.d.engine ? prepareEngineSpawn(this.d.engine, s.meta as any, s.contextEpoch, this.projectMemoryContext(s.meta.clientId), this.agentGatewayCredentials(s)) : undefined;
    if (engineSpawn?.contextEpoch && engineSpawn.contextEpoch !== s.contextEpoch) { s.contextEpoch = engineSpawn.contextEpoch; this.saveRegistry(); }
    s.engineEnv = engineSpawn?.engineEnv;
    // spawnLocal L39461: the gateway branch's X-VideoClaw-Client-Job header carries the bound job (docs/30 spend reconcile)
    const handle = await this.d.service.sessionAgentRuntime(s.meta.jobId ? { ...meta, jobId: s.meta.jobId } : meta);
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
      // spawnLocal L39564: studioServer = makeStudioToolset(meta, engineEnv).server, built with the loaded SDK
      const studioServer = typeof (sdk as any).createSdkMcpServer === "function" ? this.makeStudioToolset(s, sdk as any).server : undefined;
      options = this.engineQueryOptions(s, handle, engineSpawn, executable, (t) => { stderr = (stderr + t).slice(-4000); }, studioServer);
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
    const injected = claudeLimitInjection(handle.llmRoute);
    rt.query = injected ? (async function* () { throw new Error(injected); })() as unknown as AgentQuery : sdk.query({ prompt: input, options });
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
    const engineSpawn = this.d.engine ? prepareEngineSpawn(this.d.engine, s.meta as any, s.contextEpoch, this.projectMemoryContext(s.meta.clientId), this.agentGatewayCredentials(s)) : undefined;
    if (engineSpawn?.contextEpoch && engineSpawn.contextEpoch !== s.contextEpoch) { s.contextEpoch = engineSpawn.contextEpoch; this.saveRegistry(); }
    s.engineEnv = engineSpawn?.engineEnv;
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
        // spawnLocal L39507: dynamicTools / callDynamicTool = makeCodexToolset(meta, engineEnv)
        ...(this.d.engine ? (() => { const ct = makeCodexToolset(this.makeStudioToolset(s)); return { dynamicTools: ct.dynamicTools, callDynamicTool: (call: any, signal: AbortSignal) => ct.call(call, signal) }; })() : {}),
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
      this.send(s, this.failureEvent(s, e, rt.launched || rt.llmRoute === "codex" ? redactText(String(e?.message ?? e)).slice(0, 500) : "The studio couldn't start — try again in a moment, or check Setup.", rt)); // L50245 + emitFailureCard accountLimit
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
        this.meterResultCost(s, rt, m);
        if (s.staleResults > 0) { s.staleResults--; break; } // the Stop already sent its result (L43900)
        this.send(s, { kind: "result", isError, totalCostUsd: s.meta.totalCostUsd, numTurns: m.num_turns ?? 0, durationMs: m.duration_ms ?? 0 });
        if (isError) {
          const detail = Array.isArray(m.errors) && m.errors.length ? `: ${short(m.errors.join("; "), 300)}` : m.api_error_status ? ` (api status ${m.api_error_status})` : "";
          this.send(s, this.failureEvent(s, Array.isArray(m.errors) && m.errors.length ? m.errors.join("; ") : String(m.result ?? ""), redactText(`The turn ended with ${subtype}${detail}`), rt));
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
      sessionPlanRefusal: (id) => this.plans?.sessionPlanProductionRefusal(id), // sessionPlanProductionRefusal L38138
      askHuman: (req, signal) => this.askHuman(req, signal),
      paidRefusal: () => PORT_PAID_REFUSAL,
      log: (event, detail) => this.log.info(event, detail),
    };
  }
  /** createLocalRuntime options (L23237-23314) for an engine session. */
  private engineQueryOptions(s: Session, handle: AgentRuntimeHandle, sp: { engineEnv: Record<string, string>; append: string }, executable: string | undefined, stderr: (t: string) => void, studioServer?: unknown): Record<string, unknown> {
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
      allowedTools: claudeCodeAllowedTools(), // L23270: the studio self-authorizing MCP tools
      canUseTool: adaptClaudeCodeCanUseTool(makeEngineCanUseTool(engine, policyHost, sessionId, sp.engineEnv)),
      hooks: makeEngineHooks(engine, policyHost, sessionId, sp.engineEnv),
      mcpServers: studioServer ? { studio: studioServer } : {}, // L23280: the studio MCP (makeStudioToolset L48166)
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
  private askHuman(req: PermissionRequest, signal?: AbortSignal, spendPolicyCeilingUsd?: number): Promise<CanUseToolResult> {
    const s = this.sessions.get(req.sessionId);
    if (!s) return Promise.resolve({ behavior: "deny", message: "Session runtime changed", interrupt: true });
    return new Promise<CanUseToolResult>((resolve) => {
      this.pendingPermissions.set(req.requestId, { request: req, sessionId: req.sessionId, runtime: s.runtime, order: ++this.permissionOrder, resolve, ...(spendPolicyCeilingUsd !== undefined ? { spendPolicyCeilingUsd } : {}) });
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
  respondPermission(requestId: string, response: { behavior?: string; message?: string; updatedInput?: Record<string, unknown>; answers?: unknown; selections?: unknown; spendDecision?: string; spendCeilingUsd?: number; shownBudgetUsd?: number } | undefined): void {
    if (response?.behavior === "allow" && this.budgetApprovalSaves.has(String(requestId))) return; // L44433
    if (this.respondSpendOperation(String(requestId), response)) return; // docs/32: the spend-operation branch (L44434-44575)
    const pending = this.pendingPermissions.get(String(requestId));
    if (!pending) {
      // L44577-44589: a late click on a withdrawn spend card is answered honestly
      const retired = this.retiredSpendApprovals.get(String(requestId));
      if (retired) {
        this.retiredSpendApprovals.delete(String(requestId));
        const rs = this.sessions.get(retired.sessionId);
        if (rs) this.send(rs, { kind: "error", message: retired.reason, canRetry: Boolean(rs.failedInputs?.length) } as any);
      }
      return;
    }
    this.pendingPermissions.delete(String(requestId));
    const s = this.sessions.get(pending.sessionId);
    if (s) this.send(s, { kind: "permission_resolved", requestId: pending.request.requestId });
    if (s && s.meta.status === "awaiting_permission") this.setStatus(s, "running"); // resumeAfterInteraction
    this.log.info("agent.permission.response", { sessionId: pending.sessionId, requestId, behavior: response?.behavior });
    // original L37581-37617: the question card answers with behavior "answers" (renderer answerQuestion
    // L40098) → allow with { ...input, answers }; "allow" → allow with the request's own input; anything
    // else → deny ("Denied by user" when no message). docs/23: found by the M5 UI-e2e (the card's answer
    // was being turned into a deny).
    const input = ((pending as any).input ?? pending.request.input) as Record<string, unknown>;
    let decision: CanUseToolResult;
    if (response?.behavior === "answers") decision = { behavior: "allow", updatedInput: { ...input, answers: response.answers } };
    else if (response?.behavior === "allow") decision = { behavior: "allow", updatedInput: input };
    else decision = { behavior: "deny", message: response?.message ?? "Denied by user" };
    // respondPermission L44605: a budget card's allow installs the exact ceiling before the tool sees "approved"
    if (decision.behavior === "allow" && pending.spendPolicyCeilingUsd !== undefined) {
      const ceiling = pending.spendPolicyCeilingUsd;
      void this.setSpendCeiling(pending.sessionId, ceiling).then(
        () => pending.resolve({ behavior: "allow", updatedInput: { ...input, amount_usd: ceiling } }),
        (error) => pending.resolve({ behavior: "deny", message: error instanceof Error ? error.message : "The spending limit could not be saved." }),
      );
      this.log.info("agent.permission.decision", { sessionId: pending.sessionId, requestId, tool: pending.request.toolName, behavior: "allow", budgetUsd: ceiling });
      return;
    }
    // docs/24: what canUseTool hands back to the SDK (shape only — no answer text is logged)
    const answers = response?.behavior === "answers" && response.answers && typeof response.answers === "object" ? Object.keys(response.answers as object).length : 0;
    this.log.info("agent.permission.decision", { sessionId: pending.sessionId, requestId, tool: pending.request.toolName, behavior: decision.behavior, answers });
    pending.resolve(decision);
  }
  /** listPendingInteractions (L38511) → interaction:replayPending. */
  listPendingInteractions(): Array<{ kind: "permission" | "input"; request: any; order: number }> {
    return [
      ...[...this.pendingPermissions.values()].map((p) => ({ kind: "permission" as const, request: p.request, order: p.order })),
      ...[...this.pendingSpendOperations.values()].map((p) => ({ kind: "permission" as const, request: p.request, order: p.order })),
      ...[...this.pendingInputs.values()].map((p) => ({ kind: "input" as const, request: p.request, order: p.order })),
    ].sort((a, b) => a.order - b.order);
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
    if (reason === "stop") this.beginSettingsSpendPolicyChange(sessionId, "turn_ended"); // L43866
    const cancellationError = reason === "stop" ? this.requestOperationCancellation(s) : undefined; // L43868-43893
    if (cancellationError) this.log.warn("agent.paid.cancel_not_saved", { sessionId, error: cancellationError.message });
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
    void this.settleSpendAfterStop(s, rt);
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
    // L42935: a retired runtime retires this video's spend cards (the operation it was asked for is gone)
    for (const [requestId, pending] of [...this.pendingSpendOperations]) {
      if (pending.sessionId !== s.meta.sessionId) continue;
      this.takePendingSpendOperation(requestId, "retired");
      this.send(s, { kind: "permission_resolved", requestId } as any);
      pending.resolve("deny");
    }
    const rt = s.runtime;
    if (!rt) return;
    rt.dead = true;
    s.runtime = undefined;
    s.staleResults = 0;
    this.cancelPendingPermissions(s, rt);
    this.retireRuntimeInputs(s, rt);
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
    if (this.operationSweep) clearInterval(this.operationSweep);
    for (const c of this.operationCollectors.values()) c.abort();
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
    if (options?.approvalRequestId !== undefined) return this.setApprovalSpendCeiling(sessionId, requestedUsd, String(options.approvalRequestId)); // L47173
    this.beginSettingsSpendPolicyChange(sessionId, "settings");
    return this.enqueueSpendPolicyUpdate(sessionId, async () => {
      const session2 = this.mustGet(sessionId);
      const disablingBypass = session2.meta.permissionMode === "bypassPermissions";
      if (disablingBypass && options?.confirmDisableBypass !== true) throw new Error("Turn off Bypass before setting a hard spending limit.");
      if (this.spendBudgets.isBlocked()) throw new Error("Budget accounting is unavailable; the draft is safe.");
      await this.installSpendPolicy(sessionId, { kind: "capped", ceilingUsd: requestedUsd });
      if (disablingBypass) {
        session2.meta.permissionMode = "auto";
        this.saveRegistry();
        this.d.emit.sessionsChanged(this.listSessions());
        try { if (session2.runtime && !session2.runtime.dead) await (session2.runtime.query as any).setPermissionMode?.("auto"); } catch { this.teardownRuntime(session2, "permission-mode"); }
      }
      const snapshot = this.spendBudgets.snapshot(sessionId);
      const usedUsd = (snapshot.spentUsd ?? 0) + snapshot.reservedUsd;
      return { snapshot, ...(usedUsd > requestedUsd ? { warning: `You've already used $${usedUsd.toFixed(2)}. New paid work will wait until you raise the budget.` } : {}) };
    });
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
  /** respondInput (L44689) — input:respond (pulse not ported). */
  respondInput(requestId: string, response: any): void {
    const pending = this.takePendingInput(String(requestId), response?.kind === "cancel" ? "cancelled" : "answered", response);
    this.log.info("agent.input.respond", { requestId: String(requestId).slice(0, 64), kind: response?.kind ?? null, pending: !!pending });
    pending?.resolve(response);
  }
  /** requestInput (L48142) — a studio tool's blocking card (rights / voiceover / files). */
  requestInput(req: StudioInputRequest): Promise<any> {
    const requestId = randomUUID();
    const inputRequest = { ...req, requestId };
    const runtime = this.sessions.get(req.sessionId)?.runtime;
    const turnAtRequestMs = this.sessions.get(req.sessionId)?.turnStartedAtMs;
    return new Promise<any>((resolvePromise) => {
      const s = this.sessions.get(req.sessionId);
      if (!s || !runtime || runtime.dead) { resolvePromise({ kind: "cancel", reason: "Session runtime changed" }); return; }
      this.pendingInputs.set(requestId, { request: inputRequest, sessionId: req.sessionId, runtime, resolve: resolvePromise, resolveOnRetire: true, order: ++this.permissionOrder }); // rememberInput L38545
      this.setStatus(s, "awaiting_permission");
      this.log.info("agent.input.request", { sessionId: req.sessionId, requestId, kind: req.kind });
      try { this.d.emit.inputRequest?.(inputRequest); } catch (e) { this.log.warn("agent.emit_failed", { error: e }); }
    }).then((response) => { this.resumeAfterInteraction(req.sessionId, runtime, turnAtRequestMs); return response; });
  }
  /** takePendingInput (L38703) → recordSettledAsk (L38607): the durable settled-ask card. */
  private takePendingInput(requestId: string, outcome: string, response?: unknown) {
    const pending = this.pendingInputs.get(requestId);
    if (!pending) return undefined;
    this.pendingInputs.delete(requestId);
    try {
      const record2 = settledAskFromInput(pending.request, outcome, response);
      if (this.d.stateDir) appendDisplayAsk(displayTranscriptPath(this.d.stateDir, pending.sessionId), record2, this.sessions.get(pending.sessionId)?.lastAssistantMessageId);
      const s = this.sessions.get(pending.sessionId);
      if (s) this.send(s, { kind: "ask_settled", record: record2 } as any);
    } catch (e) { this.log.warn("agent.input.settle_record_failed", { error: e }); }
    return pending;
  }
  /** retireRuntimeInputs (L43018). */
  private retireRuntimeInputs(s: Session, runtime: Runtime): void {
    for (const [requestId, pending] of [...this.pendingInputs]) {
      if (pending.sessionId !== s.meta.sessionId || pending.runtime !== runtime) continue;
      this.takePendingInput(requestId, "retired");
      this.send(s, { kind: "input_resolved", requestId } as any);
      if (pending.resolveOnRetire) pending.resolve({ kind: "cancel", reason: "Session runtime changed" });
    }
  }
  /** resumeAfterInteraction (L45491) slice: back to running while the turn is open, else idle. */
  private resumeAfterInteraction(sessionId: string, runtime: Runtime | undefined, _turnAtRequestMs: number | undefined): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.meta.status !== "awaiting_permission") return;
    for (const p of this.pendingPermissions.values()) if (p.sessionId === sessionId) return;
    for (const p of this.pendingInputs.values()) if (p.sessionId === sessionId) return;
    for (const p of this.pendingSpendOperations.values()) if (p.sessionId === sessionId) return; // sessionHasPendingInteraction L45540
    const live = s.runtime && !s.runtime.dead ? s.runtime : undefined;
    if (live && runtime !== undefined && live !== runtime) return;
    if (live && s.turnStartedAtMs !== undefined) { this.setStatus(s, "running"); return; }
    this.setStatus(s, "idle");
  }
  /** requestWitness (L38229) — no dispatchEpoch / sign-out pause in the port (epoch stands in). */
  requestWitness(sessionId: string, requireRuntime: boolean): () => boolean {
    const atStart = this.sessions.get(sessionId);
    const runtime = atStart?.runtime, epoch = atStart?.epoch;
    const turn = atStart?.turnStartedAtMs, jobId = atStart?.meta.jobId, cwd = atStart?.meta.cwd;
    const active = (status: unknown) => status === "running" || status === "awaiting_permission";
    const wasActive = active(atStart?.meta.status);
    return () => {
      const live = this.sessions.get(sessionId);
      return Boolean(atStart && live === atStart && (runtime ? !runtime.dead : !requireRuntime) && live.runtime === runtime && live.epoch === epoch
        && live.turnStartedAtMs === turn && live.meta.jobId === jobId && live.meta.cwd === cwd && (!wasActive || active(live.meta.status)));
    };
  }
  /** docs/30: main wires the ProjectMemoryHost (constructed after the host) — memory binding for plans + tools. */
  attachStudio(memory: ProjectMemoryHost): void {
    this.memory = memory;
    if (this.plans) memory.attachPlans(this.plans);
  }
  /** projectMemoryContext (L38323) for localSessionSections (L38345). */
  projectMemoryContext(clientId: string): string[] { return this.memory ? this.memory.projectMemoryContext(clientId) : []; }
  /** saveAccountPreference (L36851). */
  saveAccountPreference(meta: any, input: { text: string }): Record<string, unknown> {
    try {
      const s = this.sessions.get(meta.sessionId);
      if (!s || s.meta !== meta) return { ok: false, reason: "This video is no longer active." };
      const saved: any = saveAccountCommitment(meta.cwd.replace(/^~(?=$|\/)/, homedir()), input.text);
      const notice = { noticeId: randomUUID(), text: saved.text };
      if (!this.deletingSessions.has(meta.sessionId)) {
        if (this.d.stateDir) appendDisplayPreference(displayTranscriptPath(this.d.stateDir, meta.sessionId), notice, s.lastAssistantMessageId);
        try { this.send(s, { kind: "preference_noted", notice } as any); } catch {}
      }
      return { ok: true, scope: "account", alreadySaved: saved.alreadySaved, visibleIn: "Settings → Taste → All your projects", notice: 'The user now sees a "Saved for all your projects" notice in this chat.', instruction: "Do not also save this preference to project_memory." };
    } catch (err) {
      this.log.warn("agent.account_preference.failed", { error: err });
      return { ok: false, reason: "The preference could not be saved. Tell the user it was not saved." };
    }
  }
  /** makeStudioToolset (L48166) over this host (studio/studio-toolset.ts). */
  makeStudioToolset(s: Session, sdk?: any) {
    const meta = s.meta;
    return makeStudioToolset(meta as any, {
      callSessionPlan: async (sessionId, args) => this.plans ? this.plans.callSessionPlan(sessionId, args) : { ok: false, message: "The plan could not be proposed for the current brief. Continue the conversation or retry the saved plan; do not repeat this call unchanged." },
      callProjectMemory: async (m, args) => this.memory ? this.memory.callProjectMemory(m, args) : { ok: false, code: "unavailable", message: "Project memory is unavailable until this account and project are verified." },
      saveAccountPreference: (m, args) => this.saveAccountPreference(m, args),
      readWorkbook: (sessionId, attachmentId, o) => this.attachmentStore ? this.attachmentStore.readWorkbook(sessionId, attachmentId, o) : { ok: false, reason: "Attachments are unavailable." },
      readPdf: (sessionId, attachmentId, o) => this.attachmentStore ? this.attachmentStore.readPdf(sessionId, attachmentId, o) : { ok: false, reason: "Attachments are unavailable." },
      requestInput: (req) => this.requestInput(req),
      noteMaterial: (sessionId, arrival) => { try { this.materialsLedger?.record({ ...arrival, sessionId }); this.publishMaterials(sessionId); } catch (e) { this.log.warn("agent.materials.note_failed", { error: e }); } },
      ...(this.d.agentGatewayProxy ? { paid: this.paidStudioHost(s) } : {}),
    }, sdk);
  }
  /** docs/30: emit a session event on behalf of a collaborator (ProjectMemoryHost memory_noted, L36848). */
  emitSessionEvent(sessionId: string, event: Record<string, unknown>): void {
    const s = this.sessions.get(sessionId);
    if (s) this.send(s, event as any);
  }
  /** transcribeVoice (L45689) — media:transcribeVoice. The session checks are the original's; VoiceDictation.execute
   *  (L10599) then needs the bundled macOS `voice-dictation` helper (Apple on-device speech). Linux ships no such
   *  helper, so the run ends in the original's own "unavailable in this build" result (docs/29 §9). */
  async transcribeVoice(sessionId: string, recordingId: unknown, audio: unknown, tools: { helper: string; ffmpeg: string }, isAudio: (a: unknown) => boolean, invalidAudio: string): Promise<{ status: string; message: string }> {
    const s = this.mustGet(sessionId);
    if (s.meta.finalizedAtMs) throw new Error("Open an editable conversation and sign in before transcribing.");
    if (typeof recordingId !== "string" || !/^[a-f0-9-]{36}$/.test(recordingId)) throw new Error("Invalid recording.");
    if (!isAudio(audio)) return { status: "failed", message: invalidAudio };
    if (!tools.helper || !tools.ffmpeg) return { status: "failed", message: "Voice notes are unavailable in this build." };
    // a helper binary named voice-dictation on Linux would still be the macOS Speech bridge — not ported
    return { status: "failed", message: "Voice notes are unavailable in this build." };
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
  // ── docs/30 spend: L50739-50777 with the cost read from metered usage priced by THE price table ──────────
  /** runtimeCostTotals (keyed by costEpoch = the runtime here) and llmJobChargeTotals (L50755). */
  private readonly runtimeCostTotals = new WeakMap<Runtime, number>();
  private readonly llmJobChargeTotals = new Map<string, { jobId: string; totalUsd: number; ledgerTrueUpUsd?: number }>();
  private readonly unsavedLlmSpend = new Map<string, number>();
  /** The model whose models.dev row prices a usage key: MiniMax ids price as themselves; a Claude alias (the SDK
   *  reports the id it asked for) prices as the model the route really serves. */
  private pricedModel(rt: Runtime, key: string): string {
    if (/^minimax-/i.test(key)) return key;
    if (rt.handle.model && !/^claude-|^(opus|sonnet|haiku)$/i.test(rt.handle.model)) return rt.handle.model;
    return this.d.servedModel?.() ?? key;
  }
  /** Cumulative USD of one runtime, priced per model: the gate proxy's metered upstream usage when the route has
   *  one (provider / Codex routes), else the SDK result's cumulative modelUsage token counts (gateway route). */
  meteredRuntimeCost(rt: Runtime, m: any): { usd: number; meter: "proxy" | "modelUsage"; sources: string[] } | undefined {
    const price = this.d.price;
    if (!price) return undefined;
    const sources = new Set<string>();
    const sum = (rows: Array<[string, { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }]>) =>
      rows.reduce((a, [k, u]) => { const p = price(this.pricedModel(rt, k)); sources.add(p.source); return a + costUsd(p, u); }, 0);
    const stats = (rt.handle.proxy as { stats?: () => any } | undefined)?.stats?.();
    if (stats?.usage && Object.keys(stats.usage).length) return { usd: sum(Object.entries(stats.usage) as any), meter: "proxy", sources: [...sources] };
    const mu = m?.modelUsage;
    if (mu && typeof mu === "object" && Object.keys(mu).length) {
      const rows = Object.entries(mu).map(([k, u]: [string, any]) => [k, {
        inputTokens: Number(u?.inputTokens) || 0, outputTokens: Number(u?.outputTokens) || 0,
        cacheReadTokens: Number(u?.cacheReadInputTokens) || 0, cacheWriteTokens: Number(u?.cacheCreationInputTokens) || 0,
      }]) as any;
      return { usd: sum(rows), meter: "modelUsage", sources: [...sources] };
    }
    return undefined;
  }
  /** L50739-50777: accumulate the runtime's cost delta into meta.totalCostUsd, charge whole cents to the job's
   *  spend budget (chargeUnreservable), and reconcile with the gateway's per-job ledger. */
  private meterResultCost(s: Session, rt: Runtime, m: any) {
    const metered = this.meteredRuntimeCost(rt, m);
    if (!metered) return;
    const previousTotal = s.meta.totalCostUsd;
    const previousRuntimeTotal = this.runtimeCostTotals.get(rt) ?? 0;
    const nextRuntimeTotal = Math.max(previousRuntimeTotal, metered.usd);
    this.runtimeCostTotals.set(rt, nextRuntimeTotal);
    const nextTotal = previousTotal + (nextRuntimeTotal - previousRuntimeTotal);
    s.meta.totalCostUsd = nextTotal;
    const costDelta = nextTotal - previousTotal;
    this.log.info("agent.spend.metered", { sessionId: s.meta.sessionId, llmRoute: rt.llmRoute, meter: metered.meter, priceSources: metered.sources, runtimeUsd: nextRuntimeTotal, totalUsd: nextTotal, sdkEstimateUsd: Number.isFinite(m?.total_cost_usd) ? m.total_cost_usd : undefined });
    if (s.meta.jobId && costDelta > 0) {
      let charge = this.llmJobChargeTotals.get(s.meta.sessionId);
      if (!charge || charge.jobId !== s.meta.jobId) { charge = { jobId: s.meta.jobId, totalUsd: 0 }; this.llmJobChargeTotals.set(s.meta.sessionId, charge); }
      const previousCents = Math.ceil((charge.totalUsd - Number.EPSILON) * 100);
      charge.totalUsd += costDelta;
      const nextCents = Math.ceil((charge.totalUsd - Number.EPSILON) * 100);
      const chargeUsd = (nextCents - previousCents) / 100;
      try { this.spendBudgets.chargeUnreservable(s.meta.sessionId, chargeUsd); }
      catch (err) {
        this.unsavedLlmSpend.set(s.meta.sessionId, (this.unsavedLlmSpend.get(s.meta.sessionId) ?? 0) + chargeUsd);
        if (!this.spendBudgets.isStorageBlocked()) this.log.warn("agent.spend.charge_failed", { sessionId: s.meta.sessionId, error: err });
      }
      if (rt.llmRoute === "gateway") void this.reconcileGatewaySpend(s);
    }
  }
  /** readGatewaySpend (L48020): the agentGatewayProxy.getJobBudget branch when the proxy runs, else the direct fetch. */
  async readGatewaySpend(s: Session): Promise<any> {
    const jobId = s.meta.jobId!;
    const proxy = this.d.agentGatewayProxy?.();
    let body: any;
    if (proxy) body = await proxy.getJobBudget(jobId);
    else {
      const cfg = this.d.gatewaySettings?.() ?? {};
      if (!cfg.gatewayUrl) throw new Error("No gateway");
      const response = await fetch(`${cfg.gatewayUrl.replace(/\/+$/, "")}/v1/spend-authorities/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${cfg.gatewayKey}` }, signal: AbortSignal.timeout(5e3) });
      if (!response.ok) throw new Error(`Gateway spending read returned HTTP ${response.status}`);
      body = await response.json();
    }
    if (!body || typeof body.spent_usd !== "number" || !Number.isFinite(body.spent_usd) || body.spent_usd < 0
      || typeof body.reserved_usd !== "number" || !Number.isFinite(body.reserved_usd) || body.reserved_usd < 0
      || !Number.isSafeInteger(Math.ceil(body.spent_usd * 100)) || !Number.isSafeInteger(Math.ceil(body.reserved_usd * 100))
      || body.client_job !== jobId) throw new Error("Invalid gateway spending response");
    return body;
  }
  /** PORT-NEW (docs/30 §3.4): on the gateway route the shim's per-job ledger (MiniMax-reported usage × the SAME
   *  models.dev price) is authoritative. The SDK result's cumulative modelUsage can under-count (an interrupted turn
   *  ends without the calls already billed upstream), so the displayed "Videoclaw gateway reasoning"
   *  (meta.totalCostUsd) is raised to max(metered, ledger) for this session's job. Idempotent: only the difference to
   *  the previous true-up is applied, so a later catching-up modelUsage never double counts. */
  trueUpGatewayReasoning(s: Session, jobId: string, ledgerSpentUsd: number): { meteredJobUsd?: number; trueUpUsd?: number; displayedUsd?: number } {
    const charge = this.llmJobChargeTotals.get(s.meta.sessionId);
    if (!charge || charge.jobId !== jobId || !Number.isFinite(ledgerSpentUsd)) return {};
    const target = Math.max(charge.totalUsd, ledgerSpentUsd);
    const nextTrueUp = Math.round((target - charge.totalUsd) * 1e9) / 1e9;
    const delta = nextTrueUp - (charge.ledgerTrueUpUsd ?? 0);
    charge.ledgerTrueUpUsd = nextTrueUp;
    if (Math.abs(delta) > 1e-12) {
      s.meta.totalCostUsd = Math.max(0, s.meta.totalCostUsd + delta);
      this.saveRegistry();
      try { this.d.emit.sessionsChanged(this.listSessions()); } catch {}
    }
    return { meteredJobUsd: Math.round(charge.totalUsd * 1e9) / 1e9, trueUpUsd: nextTrueUp, displayedUsd: Math.round(s.meta.totalCostUsd * 1e9) / 1e9 };
  }
  /** PORT-NEW docs/31 §5: a Stop mid-stream leaves one upstream call that the CLI walked away from (its usage never
   *  reaches the SDK's modelUsage) but that the gate proxy / the local shim drain to the end and meter. Once those
   *  drained calls are in (proxy inflight 0 / shim llm_in_flight 0), meter the proxy route again, or reconcile the
   *  gateway route with the job ledger (which trues up "Videoclaw gateway reasoning"). Bounded; best effort. */
  async settleSpendAfterStop(s: Session, rt: Runtime, o: { pollMs?: number; maxPolls?: number } = {}): Promise<void> {
    const pollMs = o.pollMs ?? 1500, maxPolls = o.maxPolls ?? 80;
    const pause = () => new Promise<void>((r) => { const t = setTimeout(r, pollMs); (t as any).unref?.(); });
    const live = () => this.sessions.get(s.meta.sessionId) === s;
    try {
      const stats = () => (rt.handle.proxy as { stats?: () => any } | undefined)?.stats?.();
      if (stats()) {
        for (let i = 0; i < maxPolls && (stats()?.inflight ?? 0) > 0; i++) await pause();
        if (live()) this.meterResultCost(s, rt, {});
        return;
      }
      if (rt.llmRoute !== "gateway" || !s.meta.jobId || !this.d.gatewaySettings?.()?.gatewayKey) return;
      for (let i = 0; i < maxPolls; i++) {
        const body = await this.readGatewaySpend(s).catch(() => undefined);
        if (!body || !(Number(body.llm_in_flight) > 0)) break;
        await pause();
      }
      if (live()) await this.reconcileGatewaySpend(s);
      this.log.info("agent.spend.settled_after_stop", { sessionId: s.meta.sessionId, llmRoute: rt.llmRoute, totalUsd: s.meta.totalCostUsd });
    } catch (e) { this.log.debug("agent.spend.settle_after_stop_failed", { sessionId: s.meta.sessionId, error: e }); }
  }
  /** applyGatewaySpend (L48047) + reconcileGatewaySpend (L48078). */
  async reconcileGatewaySpend(s: Session): Promise<void> {
    const queriedJobId = s.meta.jobId;
    const cfg = this.d.gatewaySettings?.() ?? {};
    if (!queriedJobId || !cfg.gatewayKey) return;
    try {
      const token = this.spendBudgets.gatewayReconciliationToken(s.meta.sessionId, queriedJobId);
      const body = await this.readGatewaySpend(s);
      if (this.sessions.get(s.meta.sessionId) !== s || s.meta.jobId !== queriedJobId) return;
      const snapshot2 = this.spendBudgets.snapshot(s.meta.sessionId);
      const settleRestored = body.client_job === s.meta.jobId && body.mode === "capped" && body.ceiling_usd === snapshot2.ceilingUsd && body.reserved_usd === 0
        && (body.state === "ready" || body.state === "exhausted") && Array.isArray(body.in_flight) && body.in_flight.length === 0 && !s.runtime;
      this.spendBudgets.reconcileGatewayLedger(s.meta.sessionId, body.spent_usd, body.reserved_usd, s.meta.jobId, token, settleRestored);
      // docs/31: the job ledger now also holds paid model_call spend; the reasoning true-up compares only the shim's
      // reasoning share (llm_spent_usd, PORT-NEW field) — an older shim without it reports reasoning only.
      const trueUp = this.trueUpGatewayReasoning(s, queriedJobId, typeof body.llm_spent_usd === "number" ? body.llm_spent_usd : body.spent_usd);
      this.log.info("agent.spend.gateway_reconciled", { sessionId: s.meta.sessionId, jobId: queriedJobId, ledgerSpentUsd: body.spent_usd, ...trueUp });
    } catch (e) { this.log.debug("agent.spend.gateway_reconcile_failed", { sessionId: s.meta.sessionId, error: e }); }
  }

  // ── docs/31: the paid tool plane — agentGatewayCredentials / agentGatewayPolicy (L39643-39745), the spend
  //    decision authorizeGatewaySpend (L45755-46140, the branches this port can honour) and the studio paid tools ──
  /** agentGatewayCredentials (L39643): the proxy's per-session vcs_ capability; no proxy → the engine gets no key. */
  agentGatewayCredentials(s: Session): { gatewayKey: string; gatewayUrl: string } | undefined {
    const proxy = this.d.agentGatewayProxy?.();
    if (!proxy) return undefined;
    return proxy.credentials(s.meta.sessionId, this.agentGatewayPolicy(s));
  }
  private readonly materializedSpendPolicies = new Map<string, string>();
  private readonly spendPolicyQueues = new Map<string, Promise<unknown>>();
  /** enqueueSpendPolicyUpdate (L47369): one spend decision / policy write at a time per video. */
  private enqueueSpendPolicyUpdate<T>(sessionId: string, apply: () => Promise<T>): Promise<T> {
    const previous = this.spendPolicyQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(apply);
    this.spendPolicyQueues.set(sessionId, next.catch(() => {}));
    return next;
  }
  /** materializeGatewaySpendPolicy (L47123): install the saved policy on the gateway before quoting against it. */
  private async materializeGatewaySpendPolicy(s: Session): Promise<void> {
    const jobId = s.meta.jobId;
    const proxy = this.d.agentGatewayProxy?.();
    if (!jobId || !proxy) return;
    const snapshot2 = this.spendBudgets.snapshot(s.meta.sessionId);
    const key = `${jobId}:${snapshot2.policy}:${snapshot2.ceilingUsd ?? ""}`;
    if (this.materializedSpendPolicies.get(s.meta.sessionId) === key) return;
    await proxy.setSessionSpendPolicy(jobId, snapshot2.policy === "capped" ? { kind: "capped", ceilingUsd: snapshot2.ceilingUsd } : snapshot2.policy === "unlimited_for_video" ? { kind: "unlimited_for_video" } : { kind: "ask_each" });
    this.materializedSpendPolicies.set(s.meta.sessionId, key);
  }
  /** agentGatewayPolicy (L39649). */
  agentGatewayPolicy(s: Session): GatewaySessionPolicy {
    const sessionId = s.meta.sessionId;
    const MAX_PENDING_OPERATIONS = 32;
    const rows = (): any[] => (Array.isArray((s.meta as any).acceptedOperations) ? (s.meta as any).acceptedOperations : []);
    return {
      jobId: () => s.meta.jobId,
      projectId: () => s.meta.clientId,
      requireOperationIdentity: true,
      rememberOperation: (operation) => {
        if (this.sessions.get(sessionId) !== s || operation.owner.project_id !== s.meta.clientId || operation.owner.client_job !== s.meta.jobId) {
          throw new Error("The operation no longer belongs to this video.");
        }
        const saved = rows();
        const existing = saved.find((row) => row.id === operation.id && row.owner.account_id === operation.owner.account_id && row.owner.gateway_url === operation.owner.gateway_url);
        if (existing) {
          if (existing.sha256 !== operation.sha256 || existing.path !== operation.path || existing.cwd !== s.meta.cwd || JSON.stringify(existing.owner) !== JSON.stringify(operation.owner)) {
            throw new Error("This operation ID already belongs to a different request.");
          }
          return false;
        }
        if (saved.length >= MAX_PENDING_OPERATIONS) throw new Error("Collect or repair the unfinished media in this video before starting another generation.");
        (s.meta as any).acceptedOperations = [...saved, { ...operation, cwd: s.meta.cwd, createdAt: Date.now() }];
        this.saveRegistry();
        this.log.info("agent.paid.operation_remembered", { sessionId, operationId: operation.id, path: operation.path });
        return true;
      },
      forgetRefusedOperation: (operation) => {
        (s.meta as any).acceptedOperations = rows().filter((row) => row.id !== operation.id || row.sha256 !== operation.sha256 || JSON.stringify(row.owner) !== JSON.stringify(operation.owner));
        this.saveRegistry();
      },
      diagnostic: { appVersion: this.d.codex?.appVersion, engineVersion: this.d.engineVersion?.() },
      prepareSpend: (jobId, signal) => this.enqueueSpendPolicyUpdate(sessionId, async () => {
        if (signal.aborted || this.sessions.get(sessionId) !== s || s.meta.jobId !== jobId) throw new Error("This paid operation is no longer current.");
        // L39731: an ask_each video keeps the gateway's per_operation authority (installed by installSpendPolicy)
        if (this.spendBudgets.snapshot(sessionId).policy !== "ask_each") await this.materializeGatewaySpendPolicy(s);
      }),
      authorizeSpend: (request2, signal) => this.authorizeGatewaySpend(s, request2, signal),
      finishSpend: (reservationId) => {
        if (reservationId) { try { this.spendBudgets.settle(sessionId, reservationId); } catch (e) { this.log.warn("agent.spend.settle_failed", { sessionId, error: e }); } }
        void this.reconcileGatewaySpend(s);
      },
      noteOperationStatus: (operationId, status) => this.log.info("agent.paid.operation_status", { sessionId, operationId, status }),
    };
  }
  /** authorizeGatewaySpend (L45755) → authorizeGatewaySpendAtHead (L45860), queued per video (enqueueSpendPolicyUpdate)
   *  and fenced by the video's spend-policy generation (spendAdmissionFence L45795). docs/32 M15: the raise card
   *  (requestExactSpendChoice "raise", a capped video whose remaining budget cannot cover the exact quote) and the
   *  per-operation card (ask_each → GET the gateway's spend authority, per_operation → "Allow this paid operation?")
   *  are now the original flows. NOT PORTED (unreachable here): unknown-cost holds (the shim advertises no
   *  unknown-cost policy → the proxy refuses such quotes first), the Anthropic-passthrough held-turn approvals
   *  (the gateway route's reasoning reaches the shim directly, not through this proxy), the advisory-budget
   *  recommendation (plan_paid_operations is not registered — advisoryBudgetEligible is always false). */
  async authorizeGatewaySpend(s: Session, request2: { jobId: string; method: "POST"; path: string; body: Buffer; quote: any }, signal?: AbortSignal): Promise<any> {
    const sessionId = s.meta.sessionId;
    const generation = this.spendPolicyChangeGenerations.get(sessionId) ?? 0;
    const observed = this.enqueueSpendPolicyUpdate(sessionId, () => this.authorizeGatewaySpendAtHead(s, request2, generation, signal))
      .then((d) => { this.log.info("agent.paid.spend_decision", { sessionId, tool: request2.quote?.tool, maximumUsd: request2.quote?.maximumUsd, allowed: d.allowed, once: d.once ? true : undefined, reason: d.allowed ? undefined : d.reason }); return d; });
    if (!signal) return observed;
    if (signal.aborted) return { allowed: false, reason: "This paid operation was cancelled." };
    return new Promise((resolve2, reject) => {
      const onAbort = () => resolve2({ allowed: false, reason: "This paid operation was cancelled." });
      signal.addEventListener("abort", onAbort, { once: true });
      void observed.then(resolve2, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }
  /** spendAdmissionFence (L45795) slice: the plan gate + the liveness check re-run after every await. */
  private spendAdmissionFence(s: Session, request2: { jobId: string; quote: any }, generation: number, signal?: AbortSignal): { refusal: any } | { current: () => boolean } {
    const sessionId = s.meta.sessionId;
    const creative = new Set(["mint_image", "mint_video", "cast_avatar", "perform_avatar", "synth_voice", "lipsync", "music", "model_call"]);
    const voiceDiscovery = request2.quote.tool === "synth_voice" && request2.quote.routeMode === "list_voices" && request2.quote.maximumUsd === 0;
    const transcription = request2.quote.tool === "synth_voice" && request2.quote.routeMode === "transcribe";
    const needsPlan = creative.has(request2.quote.tool) && !voiceDiscovery && !transcription;
    const planRefusal = () => (needsPlan ? this.plans?.sessionPlanProductionRefusal(sessionId) : undefined);
    { const refusal2 = planRefusal(); if (refusal2) return { refusal: { allowed: false, reason: refusal2 } }; }
    const current = () => !signal?.aborted && !planRefusal() && s.meta.jobId === request2.jobId && this.sessions.get(sessionId) === s
      && (this.spendPolicyChangeGenerations.get(sessionId) ?? 0) === generation;
    if ((this.spendPolicyChangeGenerations.get(sessionId) ?? 0) !== generation) return { refusal: { allowed: false, reason: "This paid operation is no longer current." } };
    if (!current()) return { refusal: { allowed: false, reason: "This paid operation no longer belongs to this video." } };
    return { current };
  }
  /** authorizeGatewaySpendAtHead (L45860) — runs only while this video's spend-policy queue is held. */
  private async authorizeGatewaySpendAtHead(s: Session, request2: { jobId: string; method: "POST"; path: string; body: Buffer; quote: any }, generation: number, signal?: AbortSignal): Promise<any> {
    const fence = this.spendAdmissionFence(s, request2, generation, signal);
    if ("refusal" in fence) return fence.refusal;
    const { current } = fence;
    // authorizeUnknownCostAtHead (L46265) is unreachable: the shim advertises no unknown-cost policy
    if (isUnknownCostQuote(request2.quote)) return { allowed: false, reason: "This operation does not have a reliable maximum price." };
    const sessionId = s.meta.sessionId;
    let snapshot2 = this.spendBudgets.snapshot(sessionId);
    if (request2.quote.maximumUsd === 0) return { allowed: true, isCurrent: current };
    if (snapshot2.policy === "capped") {
      const reservation2 = this.spendBudgets.reserve(sessionId, request2.quote.maximumUsd, { gatewayJobId: request2.jobId });
      if (reservation2.allowed) {
        this.spendBudgets.commit(sessionId, reservation2.reservationId);
        return { allowed: true, reservationId: reservation2.reservationId, isCurrent: current };
      }
      snapshot2 = reservation2.snapshot;
      if (reservation2.reason !== "over_ceiling") {
        const reason = reservation2.reason === "unknown_spend" ? "An earlier paid operation still needs spend reconciliation." : reservation2.reason === "unpriced" ? "This operation does not have a reliable maximum price." : "This video no longer has an active spending limit.";
        return { allowed: false, reason };
      }
      if ((snapshot2.remainingUsd ?? 0) <= 0) return { allowed: false, reason: "This video’s budget is exhausted. Change the budget before starting more paid work. Nothing was sent." };
      const requiredCeilingUsd = requiredSpendCeilingUsd(snapshot2, request2.quote.maximumUsd);
      const currentCeilingUsd = snapshot2.ceilingUsd ?? 0;
      if (requiredCeilingUsd === null || requiredCeilingUsd <= currentCeilingUsd) {
        return { allowed: false, reason: "Spend accounting changed while this operation was being checked. Retry once under the current displayed budget." };
      }
      // isAnthropicPassthroughPath → requireHostedReasoningAuthority: unreachable (reasoning does not pass this proxy)
      const { choice: choice2, permissionRequest: permissionRequest2 } = await this.requestExactSpendChoice(sessionId, request2, "raise", requiredCeilingUsd, signal);
      if (typeof choice2 !== "string") {
        try { await choice2.applyVideoBudget(current); } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : "The budget could not be saved." }; }
        return this.authorizeGatewaySpendAtHead(s, request2, generation, signal);
      }
      if (choice2 === "repriced") return this.authorizeGatewaySpendAtHead(s, request2, generation, signal);
      if (choice2 === "policy_changed") return { allowed: false, status: 409, code: "SPEND_POLICY_CHANGED", reason: "Spending settings were edited. This operation was not submitted. Retry under the current settings." };
      if (choice2 !== "once") return { allowed: false, reason: "The spending-limit increase was not approved." };
      if (!current()) return { allowed: false, reason: "This paid operation no longer belongs to this video." };
      snapshot2 = this.spendBudgets.snapshot(sessionId);
      if (snapshot2.policy === "capped") {
        if (snapshot2.unknownSpend) return { allowed: false, reason: "An earlier paid operation still needs spend reconciliation." };
        const neededCeilingUsd = requiredSpendCeilingUsd(snapshot2, request2.quote.maximumUsd);
        if (neededCeilingUsd === null) return { allowed: false, reason: "Spending is still being reconciled. Try again shortly." };
        if (neededCeilingUsd > (permissionRequest2.budgetUsd ?? 0)) return this.authorizeGatewaySpendAtHead(s, request2, generation, signal);
        if (neededCeilingUsd > (snapshot2.ceilingUsd ?? 0)) {
          try {
            await this.installSpendPolicy(sessionId, { kind: "capped", ceilingUsd: Math.max(neededCeilingUsd, snapshot2.ceilingUsd ?? 0) });
          } catch (error) {
            this.recordSettledAsk(sessionId, () => settledAskFromPermission(permissionRequest2, "failed"));
            throw error;
          }
        }
      } else if (snapshot2.policy !== "unlimited_for_video") {
        return { allowed: false, reason: "This video no longer has an active spending limit." };
      }
      if (!current()) return { allowed: false, reason: "This paid operation no longer belongs to this video." };
      const afterRaise = this.spendBudgets.reserve(sessionId, request2.quote.maximumUsd, { gatewayJobId: request2.jobId });
      if (!afterRaise.allowed) return { allowed: false, reason: "The new spending limit still cannot cover this operation." };
      this.spendBudgets.commit(sessionId, afterRaise.reservationId);
      return { allowed: true, reservationId: afterRaise.reservationId, isCurrent: current };
    }
    if (snapshot2.policy === "unlimited_for_video") {
      const reservation2 = this.spendBudgets.reserve(sessionId, request2.quote.maximumUsd, { gatewayJobId: request2.jobId });
      if (!reservation2.allowed) return { allowed: false, reason: "Spend accounting could not safely reserve this operation." };
      this.spendBudgets.commit(sessionId, reservation2.reservationId);
      return { allowed: true, reservationId: reservation2.reservationId, isCurrent: current };
    }
    if (this.advisoryBudgetEligible(sessionId)) return { allowed: false, reason: PLAN_FIRST_REFUSAL };
    let authority: any = null;
    try {
      const cfg = this.d.gatewaySettings?.() ?? {};
      const response = await fetch(`${String(cfg.gatewayUrl ?? "").replace(/\/+$/, "")}/v1/spend-authorities/${encodeURIComponent(request2.jobId)}`, {
        headers: { authorization: `Bearer ${cfg.gatewayKey}` },
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5e3)]),
      });
      const body = await response.json();
      if (response.ok && body && typeof body === "object" && !Array.isArray(body)) authority = body;
    } catch {}
    if (!current()) return { allowed: false, reason: "This paid operation is no longer current." };
    if (authority?.client_job !== request2.jobId || typeof authority?.revision !== "number" || !Number.isSafeInteger(authority.revision) || authority.revision < 0
      || typeof authority?.mode !== "string" || !["per_operation", "capped", "unlimited"].includes(authority.mode)) {
      return { allowed: false, reason: "Saved spending settings could not be verified. Paid work is paused; no spending limit was changed." };
    }
    if (authority.mode !== "per_operation") return { allowed: false, status: 409, reason: SPEND_POLICY_CONFLICT_MESSAGE };
    // approvalKey (spendApprovalKey) exists only for the Anthropic passthrough — never on this path
    const { choice, permissionRequest } = await this.requestExactSpendChoice(sessionId, request2, "operation", undefined, signal);
    if (typeof choice !== "string") {
      try { await choice.applyVideoBudget(current); } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : "The budget could not be saved." }; }
      return this.authorizeGatewaySpendAtHead(s, request2, generation, signal);
    }
    if (choice === "repriced") return this.authorizeGatewaySpendAtHead(s, request2, generation, signal);
    if (choice === "policy_changed") return { allowed: false, status: 409, code: "SPEND_POLICY_CHANGED", reason: "Spending settings were edited. This operation was not submitted. Retry under the current settings." };
    if (choice === "deny") return { allowed: false, reason: "Paid work was denied by the user." };
    if (!current()) return { allowed: false, reason: "This paid operation is no longer current." };
    if (choice === "always") {
      try {
        await this.installSpendPolicy(sessionId, { kind: "unlimited_for_video" });
      } catch (error) {
        this.recordSettledAsk(sessionId, () => settledAskFromPermission(permissionRequest, "failed"));
        throw error;
      }
      if (!current()) return { allowed: false, reason: "This paid operation no longer belongs to this video." };
      const reservation2 = this.spendBudgets.reserve(sessionId, request2.quote.maximumUsd, { gatewayJobId: request2.jobId });
      if (!reservation2.allowed) return { allowed: false, reason: "Spend accounting could not safely reserve this operation." };
      this.spendBudgets.commit(sessionId, reservation2.reservationId);
      return { allowed: true, reservationId: reservation2.reservationId, isCurrent: current };
    }
    const reservation = this.spendBudgets.reserveExplicit(sessionId, request2.quote.maximumUsd, request2.jobId);
    this.spendBudgets.commit(sessionId, reservation.reservationId);
    return { allowed: true, isCurrent: current, reservationId: reservation.reservationId, once: { idempotencyKey: randomUUID(), maximumApprovedUsd: request2.quote.maximumUsd } };
  }
  /** advisoryBudgetEligible (L44224): needs plan_paid_operations' advisory estimator (recommendVideoBudget L44263),
   *  which the port does not register (docs/31 §1.2) — so no video is ever eligible and ask_each goes straight to
   *  the ordinary per-operation card, exactly the original's branch for an engine without advisoryEstimate. */
  private advisoryBudgetEligible(_sessionId: string): boolean { return false; }

  // ── docs/32 M15: the spend-approval cards (L38557-38700, L46640-47370) ──
  /** rememberSpendOperation (L38557). */
  private rememberSpendOperation(request2: any, pending: any): void {
    const s = pending.sessionId ? this.sessions.get(pending.sessionId) : undefined;
    this.pendingSpendOperations.set(request2.requestId, { ...pending, turnAtRequestMs: s?.turnStartedAtMs, request: request2, order: ++this.permissionOrder });
  }
  /** recordSettledAsk (L38607): the durable settled-ask card on the display transcript + the live event. */
  private recordSettledAsk(sessionId: string, project: () => any): void {
    try {
      const record2 = project();
      if (this.d.stateDir) appendDisplayAsk(displayTranscriptPath(this.d.stateDir, sessionId), record2, this.sessions.get(sessionId)?.lastAssistantMessageId);
      const s = this.sessions.get(sessionId);
      if (s) this.send(s, { kind: "ask_settled", record: record2 } as any);
    } catch (e) { this.log.warn("agent.ask.settle_record_failed", { sessionId, error: e }); }
  }
  /** takePendingSpendOperation (L38659). */
  private takePendingSpendOperation(requestId: string, outcome: string, decision2: string = "deny"): any {
    const pending = this.pendingSpendOperations.get(requestId);
    if (!pending) return undefined;
    this.pendingSpendOperations.delete(requestId);
    if (outcome !== "approved" && outcome !== "denied") {
      this.rememberRetiredSpendApproval(requestId, pending.sessionId, "That spending approval had already been withdrawn, so nothing was sent. Send your message again to continue.");
      this.noteSpendApprovalPhase(pending.sessionId, requestId, "aborted", { outcome });
    }
    this.recordSettledAsk(pending.sessionId, () => settledAskFromPermission(pending.request, outcome, undefined, undefined, pending.savedBudgetUsd));
    for (const join2 of pending.joined ?? []) join2(decision2);
    pending.joined = undefined;
    return pending;
  }
  /** withdrawSpendCard (L38687). */
  private withdrawSpendCard(requestId: string): void {
    const pending = this.pendingSpendOperations.get(requestId);
    if (!this.takePendingSpendOperation(requestId, "aborted")) return;
    const s = this.sessions.get(pending.sessionId);
    if (s) this.send(s, { kind: "permission_resolved", requestId } as any);
    pending.resolve("deny");
  }
  /** rememberRetiredSpendApproval (L38695). */
  private rememberRetiredSpendApproval(requestId: string, sessionId: string, reason: string): void {
    if (this.retiredSpendApprovals.has(requestId)) return;
    this.retiredSpendApprovals.set(requestId, { sessionId, reason });
    if (this.retiredSpendApprovals.size > 64) {
      const oldest = this.retiredSpendApprovals.keys().next().value;
      if (oldest !== undefined) this.retiredSpendApprovals.delete(oldest);
    }
  }
  /** noteSpendApprovalPhase (L46766): the original's spend-approval beacon → the structured log (no outbox). */
  private noteSpendApprovalPhase(sessionId: string, requestId: string, phase: string, extra: Record<string, unknown> = {}): void {
    this.log.info("agent.spend.approval", { sessionId, jobId: this.sessions.get(sessionId)?.meta.jobId, requestId, phase, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) });
  }
  /** noteSpendApprovalShown (L46776) — permission:shown. */
  noteSpendApprovalShown(requestId: string): void {
    const pending = this.pendingSpendOperations.get(String(requestId));
    if (!pending) return;
    this.noteSpendApprovalPhase(pending.sessionId, String(requestId), "shown", { waitedMs: Date.now() - (pending.requestedAtMs ?? Date.now()) });
  }
  /** spendPermissionRequest (L46816). */
  private spendPermissionRequest(sessionId: string, request2: any, purpose: string, requiredCeilingUsd?: number): any {
    const operation = quotedOperationLine(request2.quote.tool, request2.quote.routeMode);
    return {
      requestId: randomUUID(),
      sessionId,
      kind: purpose === "raise" ? "budget" : "money",
      toolName: request2.quote.tool,
      input: { operation: request2.quote.tool, mode: request2.quote.routeMode },
      title: purpose === "raise" ? "Raise spending limit?" : "Allow this paid operation?",
      description: purpose === "raise"
        ? raiseBudgetDescription(operation, requiredCeilingUsd)
        : quotedSpendDescription(operation, { estimateUsd: request2.quote.estimateUsd, maximumUsd: request2.quote.maximumUsd, estimated: request2.quote.settlementPolicy === "estimated_actual_v1" }),
      estimateUsd: request2.quote.settlementPolicy ? request2.quote.estimateUsd : request2.quote.maximumUsd,
      ...(request2.quote.settlementPolicy ? { settlementPolicy: request2.quote.settlementPolicy, reservationUsd: request2.quote.maximumUsd } : {}),
      ...(purpose === "raise"
        ? {
            budgetUsd: requiredCeilingUsd,
            budgetCeilingUsd: this.spendBudgets.snapshot(sessionId).ceilingUsd,
            budgetRaiseUsd: (requiredCeilingUsd as number) - (this.spendBudgets.snapshot(sessionId).ceilingUsd ?? 0),
            budgetBlockReason: "over_ceiling",
          }
        : {}),
    };
  }
  /** requestExactSpendChoice (L46853) — no approvalKey (the passthrough-only card join) on this proxy's paths. */
  private requestExactSpendChoice(sessionId: string, request2: any, purpose: string, requiredCeilingUsd: number | undefined, signal?: AbortSignal): Promise<{ choice: any; permissionRequest: any }> {
    const runtime = this.sessions.get(sessionId)?.runtime;
    const turnAtRequestMs = this.sessions.get(sessionId)?.turnStartedAtMs;
    const quote = request2.quote;
    const permissionRequest = this.spendPermissionRequest(sessionId, { ...request2, quote }, purpose, requiredCeilingUsd);
    const requestId = permissionRequest.requestId;
    let cancel: (() => void) | undefined;
    let pending: any;
    return new Promise<any>((resolve2) => {
      cancel = () => { this.withdrawSpendCard(requestId); resolve2("deny"); };
      if (signal?.aborted) { resolve2("deny"); return; }
      this.rememberSpendOperation(permissionRequest, {
        sessionId, maximumUsd: quote.maximumUsd, requestedAtMs: Date.now(), resolve: resolve2,
        ...(purpose === "raise" ? { raiseRequest: { ...request2, quote } } : {}),
      });
      pending = this.pendingSpendOperations.get(requestId);
      const s = this.sessions.get(sessionId);
      if (s) this.setStatus(s, "awaiting_permission");
      try { this.d.emit.permissionRequest?.(permissionRequest); } catch (e) { this.log.warn("agent.emit_failed", { error: e }); }
      this.noteSpendApprovalPhase(sessionId, requestId, "requested", { tool: quote.tool, maximumUsd: quote.maximumUsd, purpose, held: false });
      signal?.addEventListener("abort", cancel, { once: true });
    })
      .finally(() => { if (cancel) signal?.removeEventListener("abort", cancel); this.resumeAfterInteraction(sessionId, runtime, turnAtRequestMs); })
      .then((choice) => ({ choice, permissionRequest: pending?.request ?? permissionRequest }));
  }
  /** scheduleRaiseReprice (L46947) — the spend observer re-derives open raise cards once per microtask. */
  private scheduleRaiseReprice(sessionId: string): void {
    if (this.raiseRepricesScheduled.has(sessionId)) return;
    this.raiseRepricesScheduled.add(sessionId);
    queueMicrotask(() => { this.raiseRepricesScheduled.delete(sessionId); this.repriceRaiseCards(sessionId); });
  }
  /** repriceRaiseCards (L46963). */
  private repriceRaiseCards(sessionId: string): void {
    const snapshot2 = this.spendBudgets.snapshot(sessionId);
    if (snapshot2.policy !== "capped" || snapshot2.unknownSpend) return;
    for (const [requestId, pending] of [...this.pendingSpendOperations]) {
      if (pending.sessionId !== sessionId || !pending.raiseRequest) continue;
      if (this.budgetApprovalSaves.has(requestId)) continue;
      if (pending.maximumUsd === null) continue;
      const requiredCeilingUsd = requiredSpendCeilingUsd(snapshot2, pending.maximumUsd);
      if (requiredCeilingUsd === null) continue;
      if (requiredCeilingUsd <= (snapshot2.ceilingUsd ?? 0)) {
        this.rememberRetiredSpendApproval(requestId, sessionId, "That raise was no longer needed: the operation fit under the current limit and continued.");
        this.takePendingSpendOperation(requestId, "retired", "repriced");
        const s = this.sessions.get(sessionId);
        if (s) this.send(s, { kind: "permission_resolved", requestId } as any);
        pending.resolve("repriced");
        continue;
      }
      if (requiredCeilingUsd === pending.request.budgetUsd && snapshot2.ceilingUsd === pending.request.budgetCeilingUsd) continue;
      pending.request = { ...this.spendPermissionRequest(sessionId, pending.raiseRequest, "raise", requiredCeilingUsd), requestId };
      try { this.d.emit.permissionRequest?.(pending.request); } catch {}
    }
  }
  /** respondPermission (L44432), the spend-operation branch. The held-turn (#736) and per-message approval-grant
   *  parts belong to the Anthropic passthrough, which never reaches this proxy in the port. */
  private respondSpendOperation(requestId: string, response: any): boolean {
    const spendOperation = this.pendingSpendOperations.get(requestId);
    if (!spendOperation) return false;
    const decision2 = response?.behavior === "allow" ? (response.spendDecision === "always" ? "always" : "once") : "deny";
    const shownBudgetUsd = response?.behavior === "allow" ? response.shownBudgetUsd : undefined;
    if (decision2 === "once" && spendOperation.raiseRequest && typeof shownBudgetUsd === "number" && Number.isFinite(shownBudgetUsd) && shownBudgetUsd !== spendOperation.request.budgetUsd) {
      spendOperation.request = { ...this.spendPermissionRequest(spendOperation.sessionId, spendOperation.raiseRequest, "raise", shownBudgetUsd), requestId };
    }
    this.takePendingSpendOperation(requestId, decision2 === "deny" ? "denied" : "approved", decision2);
    this.noteSpendApprovalPhase(spendOperation.sessionId, requestId, "resolved", { decision: decision2, held: false });
    const s = this.sessions.get(spendOperation.sessionId);
    if (s) this.send(s, { kind: "permission_resolved", requestId } as any);
    spendOperation.resolve(decision2);
    if (decision2 === "always") {
      for (const [otherId, other] of [...this.pendingSpendOperations]) {
        if (other.sessionId !== spendOperation.sessionId) continue;
        this.takePendingSpendOperation(otherId, "approved", "always");
        if (s) this.send(s, { kind: "permission_resolved", requestId: otherId } as any);
        other.resolve("always");
      }
    }
    return true;
  }
  /** setApprovalSpendCeiling (L47213): a card answer that sets the video budget keeps its waiting operation. */
  private async setApprovalSpendCeiling(sessionId: string, usd: number, requestId: string): Promise<unknown> {
    const operation = this.pendingSpendOperations.get(requestId);
    const permission: any = this.pendingPermissions.get(requestId);
    const pending = operation ?? permission;
    if (!pending || pending.sessionId !== sessionId || !["money", "budget"].includes(pending.request.kind)) throw new Error("That spending approval is no longer waiting.");
    if (!operation && [...this.pendingSpendOperations.values()].some((entry) => entry.sessionId === sessionId)) throw new Error("Resolve the pending paid-operation card first, then retry this approval.");
    if (this.budgetApprovalSaves.has(requestId)) throw new Error("This budget is already being saved.");
    if (operation && operation.maximumUsd === null) throw new Error(UNKNOWN_COST_BUDGET_REFUSAL);
    const session2 = this.mustGet(sessionId);
    const runtime = session2.runtime;
    const turnAtRequestMs = pending.turnAtRequestMs;
    if (session2.meta.permissionMode === "bypassPermissions") throw new Error("Turn off Bypass before setting a hard spending limit.");
    const generation = this.spendPolicyChangeGenerations.get(sessionId) ?? 0;
    const jobId = session2.meta.jobId;
    const current = () => this.sessions.get(sessionId) === session2 && session2.meta.jobId === jobId && (this.spendPolicyChangeGenerations.get(sessionId) ?? 0) === generation
      && (operation ? this.pendingSpendOperations.get(requestId) === operation : this.pendingPermissions.get(requestId) === permission);
    const validate = () => {
      if (!current()) throw new Error("That spending approval is no longer waiting.");
      const required = requiredSpendCeilingUsd(this.spendBudgets.snapshot(sessionId), operation?.maximumUsd ?? 0);
      if (required === null) throw new Error("Spending is still being reconciled. Try again shortly.");
      if (usd < required) throw new Error(`Set a total video budget of at least $${required.toFixed(2)}.`);
    };
    validate();
    this.budgetApprovalSaves.add(requestId);
    try {
      return await new Promise((resolve2, reject) => {
        const applyVideoBudget = async (operationCurrent: () => boolean) => {
          try {
            validate();
            if (!operationCurrent()) throw new Error("This paid operation is no longer current.");
            const snapshot2 = await this.installSpendPolicy(sessionId, { kind: "capped", ceilingUsd: usd });
            if (!current() || !operationCurrent()) throw new Error("The budget was saved, but this operation is no longer waiting.");
            const savedBudgetUsd = snapshot2.ceilingUsd ?? usd;
            if (operation) {
              operation.savedBudgetUsd = savedBudgetUsd;
              this.takePendingSpendOperation(requestId, "approved");
              this.send(session2, { kind: "permission_resolved", requestId } as any);
              this.noteSpendApprovalPhase(sessionId, requestId, "resolved", { decision: "video_budget", held: false });
            }
            if (permission) {
              permission.spendPolicyCeilingUsd = undefined;
              permission.savedBudgetUsd = savedBudgetUsd;
              if (permission.request.kind === "budget") permission.input = { ...(permission.input ?? permission.request.input), amount_usd: usd };
              this.budgetApprovalSaves.delete(requestId);
              this.respondPermission(requestId, { behavior: "allow" });
            }
            resolve2({ snapshot: snapshot2 });
          } catch (error) {
            if (operation && this.pendingSpendOperations.get(requestId) === operation) {
              this.takePendingSpendOperation(requestId, "failed");
              this.send(session2, { kind: "permission_resolved", requestId } as any);
              this.send(session2, { kind: "error", message: "The budget could not be saved. No paid operation was submitted; try the request again.", canRetry: false } as any);
            }
            reject(error);
            throw error;
          }
        };
        if (operation) operation.resolve({ applyVideoBudget });
        else void this.enqueueSpendPolicyUpdate(sessionId, () => applyVideoBudget(current)).catch(() => {});
      });
    } finally {
      this.budgetApprovalSaves.delete(requestId);
      this.resumeAfterInteraction(sessionId, runtime, turnAtRequestMs);
    }
  }
  /** beginSettingsSpendPolicyChange (L47338): a settings edit or Stop supersedes every queued spend decision. */
  private beginSettingsSpendPolicyChange(sessionId: string, cause: "settings" | "turn_ended" | "idle"): void {
    this.spendPolicyChangeGenerations.set(sessionId, (this.spendPolicyChangeGenerations.get(sessionId) ?? 0) + 1);
    const s = this.sessions.get(sessionId);
    for (const [requestId, pending] of [...this.pendingPermissions]) {
      if (pending.sessionId !== sessionId || (pending.request.kind as string) !== "budget") continue;
      this.pendingPermissions.delete(requestId);
      if (s) this.send(s, { kind: "permission_resolved", requestId } as any);
      pending.resolve({ behavior: "deny", message: "Video spending settings changed." });
    }
    for (const [requestId, pending] of [...this.pendingSpendOperations]) {
      if (pending.sessionId !== sessionId) continue;
      this.takePendingSpendOperation(requestId, "retired", cause === "settings" ? "policy_changed" : "deny");
      if (s) this.send(s, { kind: "permission_resolved", requestId } as any);
      pending.resolve(cause === "settings" ? "policy_changed" : "deny");
    }
  }
  /** raiseVideoSpendCeiling (L47004). */
  private raiseVideoSpendCeiling(sessionId: string, ceilingUsd: number): Promise<void> {
    return this.enqueueSpendPolicyUpdate(sessionId, async () => {
      const snapshot2 = this.spendBudgets.snapshot(sessionId);
      if (snapshot2.policy === "unlimited_for_video") return;
      await this.installSpendPolicy(sessionId, { kind: "capped", ceilingUsd: Math.max(ceilingUsd, snapshot2.policy === "capped" ? (snapshot2.ceilingUsd ?? 0) : 0) });
    });
  }
  /** installSpendPolicy (L47018) + putGatewaySpendPolicy / writeGatewaySpendPolicy (L47053-47121) via the proxy. */
  private async installSpendPolicy(sessionId: string, policy: { kind: "capped"; ceilingUsd: number } | { kind: "unlimited_for_video" } | { kind: "ask_each" }): Promise<any> {
    const session2 = this.mustGet(sessionId);
    const jobId = session2.meta.jobId;
    if (jobId) {
      if (this.spendBudgets.isBlocked()) throw new Error("Budget accounting is unavailable; the draft is safe.");
      const proxy = this.d.agentGatewayProxy?.();
      this.materializedSpendPolicies.delete(sessionId);
      if (proxy) await proxy.setSessionSpendPolicy(jobId, policy as any);
    }
    const current = this.sessions.get(sessionId);
    if (!current || current.meta.jobId !== jobId) throw new Error("This video changed while its spending policy was being updated.");
    const snapshot2 = policy.kind === "capped" ? this.spendBudgets.setCeiling(sessionId, policy.ceilingUsd).snapshot
      : policy.kind === "unlimited_for_video" ? this.spendBudgets.setUnlimited(sessionId) : this.spendBudgets.setAskEach(sessionId);
    if (jobId) this.materializedSpendPolicies.set(sessionId, `${jobId}:${snapshot2.policy}:${snapshot2.ceilingUsd ?? ""}`);
    else this.materializedSpendPolicies.delete(sessionId);
    this.log.info("agent.spend.policy_installed", { sessionId, jobId, policy: policy.kind, ceilingUsd: (policy as any).ceilingUsd });
    return snapshot2;
  }
  /** The studio paid tools' handlers (makeStudioToolset L48247-49297) bound to one session. */
  private paidStudioHost(s0: Session) {
    const sessionId = s0.meta.sessionId;
    const meta = s0.meta;
    const env = () => this.sessions.get(sessionId)?.engineEnv ?? {};
    return {
      // search_models handler L48939-49065 (no retry wait: the local catalog never answers retryable)
      searchModels: async (args: { query: string; limit: number; kind?: string; inputs?: string[]; cursor?: string }) => {
        const gatewayUrl = env().VIDEOCLAW_GATEWAY_URL?.replace(/\/+$/, "");
        const gatewayKey = env().VIDEOCLAW_API_KEY;
        if (!gatewayUrl || !gatewayKey) return { ok: false, reason: "The app is not connected to the model gateway." };
        try {
          const query2 = new URLSearchParams({ q: args.query, limit: String(args.limit) });
          if (args.kind) query2.set("kind", args.kind);
          for (const input of args.inputs ?? []) query2.append("inputs", input);
          if (args.cursor) query2.set("cursor", args.cursor);
          const response = await fetch(`${gatewayUrl}/v1/models/search?${query2}`, { headers: { authorization: `Bearer ${gatewayKey}` }, signal: AbortSignal.timeout(45e3) });
          const body: any = await response.json().catch(() => ({}));
          if (!response.ok) {
            const temporary = body.detail?.retryable !== false && (response.status === 408 || response.status === 429 || response.status >= 500);
            return { ok: false, retryable: temporary, next_action: temporary ? "retry_read" : "change_input", reason: temporary ? `Model search is temporarily unavailable (HTTP ${response.status}); search again after retry_after_s.` : `Model search failed (HTTP ${response.status}).` };
          }
          const results = body.results?.map(({ model_slug, ...item }: any) => ({ model_id: model_slug, ...item, ...(item.pricing && typeof item.pricing === "object" && item.pricing.kind === "unknown-cost" && !("pricing_note" in item) ? { pricing_note: "No usable pre-run price estimate; a temporary hold is required and final cost may exceed it." } : {}) }));
          return { ok: true, ...body, ...(results ? { results } : {}) };
        } catch {
          return { ok: false, retryable: true, next_action: "retry_read", reason: "Model search is temporarily unavailable." };
        }
      },
      // callOneModel L48247 — the VIDEOCLAW_OPERATION_RECOVERY branch (engine tools/_model_call.py)
      callOneModel: async (args: { model_id?: string; model_slug?: string; model_contract?: string; input: Record<string, unknown> }) => {
        const model = args.model_id ?? args.model_slug;
        if (!model || (args.model_id && args.model_slug && args.model_id !== args.model_slug)) {
          return { ok: false, retryable: false, next_action: "change_input", reason: model ? "model_id and model_slug name different models; pass only the model_id from search_models." : "Pass the model_id returned by search_models." };
        }
        const planRefusal = this.plans?.sessionPlanProductionRefusal(sessionId);
        if (planRefusal) return { ok: false, retryable: false, reason: planRefusal };
        const engineEnv2 = env();
        const gatewayUrl = engineEnv2.VIDEOCLAW_GATEWAY_URL?.replace(/\/+$/, "");
        const gatewayKey = engineEnv2.VIDEOCLAW_API_KEY;
        if (!gatewayUrl || !gatewayKey) return { ok: false, reason: "The app is not connected to the model gateway." };
        if (!meta.jobId) return { ok: false, reason: "Prepare this video before calling a paid model." };
        const localJobId = meta.jobId;
        if (engineEnv2.VIDEOCLAW_OPERATION_RECOVERY !== "1") {
          // the legacy direct POST branch (L48352-48500) is for engines without durable recovery; the pinned engine has it
          return { ok: false, retryable: false, reason: "Native model recovery is unavailable. Paid work was not started." };
        }
        const engine = engineEnv2.VIDEOCLAW_ENGINE;
        const script = engine && join(engine, "tools", "_model_call.py");
        const python = engine && join(engine, ".venv", "bin", "python");
        const boundJob: any = resolveJobDir({ sessionId, jobId: localJobId }, (id2) => this.sessions.get(id2)?.meta as any);
        if (!boundJob.ok || !script || !python || !existsSync(script) || !existsSync(python)) {
          return { ok: false, retryable: false, reason: "Native model recovery is unavailable. Paid work was not started." };
        }
        try {
          const stdout = await new Promise<string>((resolve2, reject) => {
            const child = execFile(python, [script, "--job", boundJob.jobPath], {
              cwd: dirname(boundJob.jobsDir), timeout: 30 * 6e4, maxBuffer: 16 * 1024 * 1024,
              env: { ...sanitizedAgentEnv(process.env), ...engineEnv2, VIDEOCLAW_WORKSPACE: dirname(boundJob.jobsDir), VIDEOCLAW_JOBS_DIR: boundJob.jobsDir, PYTHON_DOTENV_DISABLED: "1" },
            }, (error, out) => (error ? reject(error) : resolve2(String(out))));
            child.stdin?.end(JSON.stringify({ model_slug: model, input: args.input, ...(args.model_contract ? { model_contract: args.model_contract } : {}) }));
          });
          const result = JSON.parse(stdout);
          this.log.info("agent.paid.model_call", { sessionId, model, ok: result?.ok, status: result?.status, imported: result?.imported, saved: Array.isArray(result?.saved) ? result.saved.length : undefined, next_action: result?.next_action });
          if (result?.ok === false && ["failed", "canceled", "timeout"].includes(String(result.status)) && result.not_submitted !== true && result.next_action === "change_input") {
            return { ...result, retryable: false, next_action: "report_failure" };
          }
          if (result?.ok && result.imported) { try { this.ensureWatcher(this.mustGet(sessionId), true); } catch {} }
          return result;
        } catch (e) {
          this.log.warn("agent.paid.model_call_failed", { sessionId, model, error: e });
          return { ok: false, retryable: false, status: "pending", next_action: "resume_original", reason: "The model call may still be running. The app will recover its original result; do not generate it again." };
        }
      },
      // get_project_budget L49163
      getProjectBudget: async (args: { job_id: string }) => {
        if (!meta.jobId || args.job_id !== meta.jobId) return { ok: false, reason: "The budget query must name the job owned by this video." };
        const cfg = this.d.gatewaySettings?.() ?? {};
        if (!cfg.gatewayKey) return { ok: false, reason: "The app is not connected to the gateway." };
        try {
          const reconciliationToken = this.spendBudgets.gatewayReconciliationToken(sessionId, args.job_id);
          const budget2 = await this.readGatewaySpend(this.mustGet(sessionId));
          if (meta.jobId !== args.job_id) throw new Error("The active video changed during the budget read.");
          const spent = budget2.spent_usd, reserved = budget2.reserved_usd;
          const reservedUsd = typeof reserved === "number" && Number.isFinite(reserved) && reserved >= 0 ? reserved : 0;
          if (typeof spent === "number" && Number.isFinite(spent) && spent >= 0 && typeof reserved === "number" && Number.isFinite(reserved) && reserved >= 0) {
            this.spendBudgets.reconcileGatewayLedger(sessionId, spent, reserved, meta.jobId, reconciliationToken);
          }
          return {
            ok: true, authoritative: true, ...budget2,
            instruction: "This read reports spend and spending permission, not a production estimate. per_operation does not prevent a separate read-only plan estimate; do not infer estimate availability from this budget mode. " +
              (reservedUsd > 0 ? "Work is in flight. Wait or inspect those jobs; do not call this spent and do not request more budget yet." : "No money is in flight. A higher budget is only appropriate if actual remaining headroom cannot cover the next exact quote."),
          };
        } catch {
          return { ok: false, retryable: true, reason: "The authoritative gateway budget is temporarily unavailable." };
        }
      },
      // set_video_budget L49229 — the "budget" permission card; allow → setSpendCeiling (respondPermission L44605)
      setVideoBudget: async (args: { amount_usd: number }) => {
        const amount = normalizeSpendCeilingUsd(args.amount_usd);
        if (amount === null || amount <= 0) return { approved: false, reason: "The requested limit was invalid." };
        const s = this.sessions.get(sessionId);
        const runtime = s?.runtime;
        if (!s || !runtime || runtime.dead) return { approved: false, reason: "Session runtime changed" };
        if (s.meta.permissionMode === "bypassPermissions") {
          return { approved: false, reason: "Bypass is enabled, so this video cannot also have a hard spending limit. The user can switch out of Bypass in the app before setting a budget.", instruction: "Do not ask again or open a spending-limit card while Bypass remains enabled." };
        }
        const requestId = randomUUID();
        const permissionRequest: any = {
          requestId, sessionId, kind: "budget", toolName: "mcp__studio__set_video_budget", input: { amount_usd: amount },
          title: `Set a $${amount.toFixed(2)} maximum for this video?`,
          description: "This budget pauses new paid work when exhausted. Actual costs may exceed estimates.",
          budgetUsd: amount, budgetCeilingUsd: this.spendBudgets.snapshot(sessionId).ceilingUsd,
        };
        const response: any = await this.askHuman(permissionRequest, undefined, amount);
        if (response.behavior !== "allow") return { approved: false, reason: response.message ?? "User declined" };
        return { approved: true, ceiling_usd: response.updatedInput?.amount_usd, instruction: "The budget is active. Continue while reservations fit; actual costs may exceed estimates, after which new paid work pauses. Do not wait for a separate budget-plan confirmation." };
      },
    };
  }

  // ── docs/29: the VideoClaw-credits continuation (creditHandoffOffer L51901 / continueOnCredits L52012) ──
  private readonly creditHandoffs = new Map<string, Promise<AgentSessionMeta>>();
  /** PORT-NEW seam: the original sets this from emitFailureCard (L42367) when the Claude CLI reports the
   *  subscription limit. The port has no Claude subscription (USER DIRECTIVE), so the limit can never arrive
   *  naturally; tests / the UI-e2e harness seed it explicitly (docs/29 §6). */
  /** emitFailureCard (L42348) account-limit slice: limitedAccount (L42318) → modelAccountLimit; a Claude limit
   *  marks the allowance exhausted (credits hand-off precondition) and the card carries accountLimit +
   *  llmRouteRequired with the original headline. Every other failure keeps the port's message. */
  private failureEvent(s: Session, raw: unknown, fallback: string, rt?: Runtime): SessionEvent {
    const account2 = (s.meta.runtime as string | undefined) === "remote" ? undefined
      : s.meta.agentHarness === "codex-app-server" ? ((s.meta as any).codexProvider ?? "chatgpt")
      : (rt?.llmRoute ?? s.meta.llmRoute) === "claude-code" ? "claude" : undefined;
    const accountLimit: any = account2 ? modelAccountLimit(raw, account2) : undefined;
    const exhausted = accountLimit?.account === "claude";
    s.claudeAllowanceExhausted = exhausted;
    s.claudeAllowanceTurnIds = exhausted ? [...new Set((s.inflight ?? s.failedInputs ?? []).flatMap((input) => (typeof input.msg?.uuid === "string" && input.msg.uuid ? [input.msg.uuid as string] : [])))] : undefined;
    if (!accountLimit) return { kind: "error", message: fallback, canRetry: true };
    const headline = modelAccountLimitPresentation(accountLimit, undefined)?.headline;
    return { kind: "error", message: headline ?? fallback, accountLimit, ...(exhausted ? { llmRouteRequired: true } : {}), canRetry: true } as any;
  }
  markClaudeAllowanceExhausted(sessionId: string, turnIds: string[] = []): void {
    const s = this.mustGet(sessionId);
    s.claudeAllowanceExhausted = true;
    s.claudeAllowanceTurnIds = turnIds;
  }
  private creditSettings(): { gatewayUrl?: string; gatewayKey?: string } { return this.d.gatewaySettings?.() ?? {}; }
  /** creditTransferBudget (L51990) + spendPolicyForMaterialChange (L34057). */
  private creditTransferBudget(src: Session): { permissionMode: string; budget: any; budgetResets?: string } {
    const priorMode = src.meta.permissionMode as string;
    const permissionMode = priorMode === "bypassPermissions" ? "auto" : priorMode;
    const sourceBudget: any = this.spendBudgets.snapshot(src.meta.sessionId);
    const policy = permissionMode === "bypassPermissions" ? { kind: "unlimited_for_video" } : priorMode === "bypassPermissions" ? { kind: "ask_each" } : sourceBudget.policy === "unlimited_for_video" ? { kind: "ask_each" } : undefined;
    if (!policy) return { permissionMode, budget: sourceBudget };
    const { ceilingUsd: _c, remainingUsd: _r, ...kept } = sourceBudget;
    return { permissionMode, budget: { ...kept, policy: policy.kind }, budgetResets: priorMode === "bypassPermissions" ? "bypass" : "always-allow" };
  }
  async creditHandoffOffer(sessionId: string): Promise<Record<string, unknown>> {
    const s = this.mustGet(sessionId);
    const refuse = (reason: string, message: string) => ({ available: false, reason, message });
    if (((s.meta.runtime as string | undefined) ?? "local") !== "local" || (s.meta.agentHarness ?? "claude-code") !== "claude-code" || s.meta.llmRoute !== "claude-code") {
      return refuse("not-applicable", "This chat is not using a Claude subscription.");
    }
    const existing = this.completedContinuation(s);
    if (s.meta.continuation && !existing) return refuse("already-continued", "The continuation chat was removed. The original chat remains available as history.");
    if (existing && existing.meta.continuedFromSessionId !== sessionId) return refuse("already-continued", "This video already has a continuation chat.");
    const transfer: any = existing?.meta.creditContinuation;
    if (existing && !transfer?.pending) return { available: true, existingSessionId: existing.meta.sessionId };
    if (transfer && transfer.budget?.unknownSpend) return refuse("account-unavailable", "The original video budget could not be verified for this account.");
    if (!existing && !s.claudeAllowanceExhausted) {
      const events = await this.getHistory(sessionId);
      const terminal: any = [...events].reverse().find((event: any) => event.kind === "error" || event.kind === "result" || event.kind === "user_text");
      if (terminal?.kind !== "error" || terminal.accountLimit?.account !== "claude") return refuse("not-applicable", "Continue with credits is available after your Claude allowance runs out.");
    }
    if (this.deletingSessions.has(sessionId) || this.hasActiveJobWork(s) || s.interrupting || (s.runtime?.queue.length ?? 0) > 0 || (s.openTools?.size ?? 0) > 0) {
      return refuse("active-work", "Finish or stop the current step first.");
    }
    // PORT: the per-video spend ledger is local-authority (no paid gateway spend flows through it), so the
    // original's ledger-authority equality check reduces to the blocked check (docs/29 §6).
    if (this.spendBudgets.isBlocked()) return refuse("unsettled-spend", "Wait for accepted work and its charges to finish reconciling.");
    const cfg = { ...this.creditSettings() };
    const eligibility: any = this.d.creditEligibility ? await this.d.creditEligibility() : { available: false, reason: "account-unavailable", message: "Verify your VideoClaw account before continuing." };
    const current = this.creditSettings();
    if (current.gatewayKey !== cfg.gatewayKey || current.gatewayUrl !== cfg.gatewayUrl || this.sessions.get(sessionId) !== s) return refuse("account-unavailable", "Your account changed. Try again.");
    const { budgetResets } = this.creditTransferBudget(s);
    return eligibility.available && budgetResets ? { ...eligibility, budgetResets } : eligibility;
  }
  continueOnCredits(sessionId: string, request2: any): Promise<AgentSessionMeta> {
    if (!request2 || request2.consent !== "videoclaw-credits" || typeof request2.clientActionId !== "string" || !request2.clientActionId.trim()) {
      return Promise.reject(new Error("Explicit VideoClaw credit consent is required."));
    }
    const inFlight = this.creditHandoffs.get(sessionId);
    if (inFlight) return inFlight;
    const result = this.finishCreditContinuation(sessionId, request2.clientActionId);
    this.creditHandoffs.set(sessionId, result);
    void result.finally(() => this.creditHandoffs.delete(sessionId)).catch(() => {});
    return result;
  }
  private async finishCreditContinuation(sessionId: string, clientActionId: string): Promise<AgentSessionMeta> { // L52027
    const src = this.mustGet(sessionId);
    const offer: any = await this.creditHandoffOffer(sessionId);
    if (!offer.available) throw new Error(offer.message);
    const prior = this.completedContinuation(src);
    if (prior && !(prior.meta.creditContinuation as any)?.pending) return prior.meta;
    const events = await this.getHistory(sessionId);
    const targetId = (src.meta.continuation as any)?.sessionId ?? continuationSessionUuid(sessionId, clientActionId);
    let target = this.sessions.get(targetId);
    const pendingTurnIds = src.claudeAllowanceTurnIds ?? (src.failedInputs ?? []).flatMap((input) => (input.msg?.uuid ? [input.msg.uuid as string] : []));
    const pending = [...new Set(pendingTurnIds)].flatMap((id2) => events.filter((event: any) => event.kind === "user_text" && event.turnId?.replace(/:\d+$/, "") === id2));
    const draft = pending.map((event: any) => event.text).join("\n");
    const attachmentIds = [...new Set(pending.flatMap((event: any) => event.attachmentIds ?? []))] as string[];
    if (!target && draft.length > 1e5) throw new Error("These queued edits exceed the message limit. They are safe in the original conversation; shorten them before continuing.");
    const cfg = { ...this.creditSettings() };
    if (!target && attachmentIds.length && this.attachmentStore) await this.attachmentStore.validateContinuationDraft(sessionId, attachmentIds, (destination: string) => this.secureComposerDestination(src, destination));
    const eligibility: any = this.d.creditEligibility ? await this.d.creditEligibility() : { available: false, message: "Verify your VideoClaw account before continuing." };
    if (!eligibility.available) throw new Error(eligibility.message);
    if (this.creditSettings().gatewayKey !== cfg.gatewayKey || this.creditSettings().gatewayUrl !== cfg.gatewayUrl || this.sessions.get(sessionId) !== src || this.deletingSessions.has(sessionId)
      || this.hasActiveJobWork(src) || src.interrupting || (src.runtime?.queue.length ?? 0) > 0 || (src.openTools?.size ?? 0) > 0 || this.spendBudgets.isBlocked()) {
      throw new Error("The video or account changed. Wait for active work and try again.");
    }
    if (!target) {
      const { permissionMode, budget: budget22 } = this.creditTransferBudget(src);
      this.createSession({ continueFromSessionId: sessionId, permissionMode }, undefined, { sessionId: targetId, deferJobAdoption: true, providerMigration: { agentHarness: "claude-code", codexProvider: "chatgpt", llmRoute: "gateway" } });
      target = this.mustGet(targetId);
      target.meta.continuedFromSessionId = sessionId;
      if (pending.length) target.meta.continuationDraft = draft;
      target.meta.creditContinuation = {
        authority: this.spendBudgets.exportState().authority, budget: budget22,
        context: events.filter((event: any) => event.kind === "user_text" || event.kind === "assistant_text").slice(-20).map((event: any) => `${event.kind}: ${event.text}`).join("\n").slice(-3e4),
        attachmentIds, pending: true,
      };
      src.meta.continuation = { clientActionId, sessionId: targetId };
      (src.meta as any).finalizedAtMs ??= Date.now();
    }
    const tgt = target;
    if (!tgt.meta.creditContinuation) throw new Error("This video already has a different continuation.");
    if (!this.flushRegistry()) throw new Error("Could not save the continuation. Try again.");
    this.teardownRuntime(src, "credit-handoff");
    const jobId = src.meta.jobId;
    if (jobId) {
      this.adoptJob(targetId, jobId);
      if (tgt.meta.jobId !== jobId) throw new Error("The video is still owned by another active chat.");
      src.meta.priorJobId = jobId;
    } else if (tgt.meta.jobId) src.meta.priorJobId = tgt.meta.jobId;
    const transfer: any = tgt.meta.creditContinuation;
    const budget2 = transfer.budget;
    if (budget2.policy === "capped") this.spendBudgets.setCeiling(targetId, budget2.ceilingUsd);
    else if (budget2.policy === "unlimited_for_video") this.spendBudgets.setUnlimited(targetId);
    else this.spendBudgets.setAskEach(targetId);
    this.spendBudgets.reconcileSpend(targetId, budget2.spentUsd ?? 0);
    if (transfer.attachmentIds.length && this.attachmentStore) {
      await this.attachmentStore.copyContinuationDraft(sessionId, targetId, transfer.attachmentIds, (attachment: unknown) => (this.d.emit as any).attachmentChanged?.(attachment), (destination: string) => this.secureComposerDestination(tgt, destination));
    }
    if (this.creditSettings().gatewayKey !== cfg.gatewayKey || this.creditSettings().gatewayUrl !== cfg.gatewayUrl || this.sessions.get(sessionId) !== src || this.sessions.get(targetId) !== tgt) {
      throw new Error("The account or video changed. Try again.");
    }
    if (!this.flushRegistry()) throw new Error("Could not save the transferred video. Try again.");
    // materializeGatewaySpendPolicy (L47222): no gateway spend policy is written for a local-authority ledger
    transfer.pending = false;
    if (!this.flushRegistry()) { transfer.pending = true; throw new Error("Could not save the continuation. Try again."); }
    this.log.info("agent.credit_handoff", { from: sessionId, to: targetId });
    this.d.emit.sessionsChanged(this.listSessions());
    return tgt.meta;
  }
  /** codexDisconnectImpact L52416: Codex videos with a live runtime mid-turn. */
  /** codexHandoffOffer (L52172): may this blocked local Claude video continue on Codex (MiniMax-backed)? */
  async codexHandoffOffer(sessionId: string): Promise<Record<string, unknown>> {
    const s = this.sessions.get(sessionId);
    if (!s || ((s.meta.runtime as string | undefined) ?? "local") !== "local" || (s.meta.agentHarness ?? "claude-code") !== "claude-code") {
      return { available: false, reason: "not-applicable", message: "This video is not running on Claude Code." };
    }
    const prior = this.completedContinuation(s);
    if (prior && !(prior.meta.agentHarness === "codex-app-server" && ((prior.meta.codexProvider as string | undefined) ?? DEFAULT_CODEX_PROVIDER) === "chatgpt")) {
      return { available: false, reason: "already-continued", message: "This video already continues in another chat." };
    }
    if (!this.codex) return { available: false, reason: "unavailable", message: "Codex is unavailable right now." };
    const gate = this.codex.runtimeGate();
    if (!gate.enabled) return { available: false, reason: "unavailable", message: gate.message };
    const status: any = await this.codex.status();
    if (!status.available) return { available: false, reason: "unavailable", message: status.recovery ?? "Codex runtime unavailable" };
    if (!status.authenticated) return { available: false, reason: "unauthenticated", message: "Connect ChatGPT to continue this video with Codex." };
    const model = this.codex.accountCodexModel("chatgpt");
    const refusal2 = await this.codex.routeRefusal({ agentHarness: "codex-app-server", codexProvider: "chatgpt", modelOverride: model });
    if (refusal2) return { available: false, reason: "no-validated-model", message: refusal2 };
    return { available: true, ...(model ? { model } : {}) };
  }
  /** continueOnCodex (L52242): a NEW continuation of the video on the Codex harness; the source is untouched. */
  async continueOnCodex(sessionId: string, clientActionId: string): Promise<AgentSessionMeta> {
    if (!String(clientActionId ?? "").trim()) throw new Error("Missing continuation action id.");
    const offer: any = await this.codexHandoffOffer(sessionId);
    if (!offer.available) throw new Error(offer.message);
    const src = this.mustGet(sessionId);
    const existing = this.completedContinuation(src);
    if (existing) return existing.meta;
    const meta = this.createSession({ continueFromSessionId: sessionId }, undefined, { providerMigration: { agentHarness: "codex-app-server", codexProvider: "chatgpt" } });
    // outbox beacon "codex-handoff" (no outbox in the port) → main log
    this.log.info("agent.codex_handoff", { from: sessionId, to: meta.sessionId, model: meta.modelOverride ?? "runtime-default" });
    return meta;
  }
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
  /** docs/29: the session view ProjectMemoryHost reads (the original reads this.sessions directly). */
  memorySessionView(sessionId: string): { meta: any; lastAssistantMessageId?: string } | undefined {
    const s = this.sessions.get(sessionId);
    return s ? { meta: s.meta, lastAssistantMessageId: s.lastAssistantMessageId } : undefined;
  }
  memorySessionViews(): Array<{ meta: any; lastAssistantMessageId?: string }> {
    return [...this.sessions.values()].map((s) => ({ meta: s.meta, lastAssistantMessageId: s.lastAssistantMessageId }));
  }
  liveSession(sessionId: string): AgentSessionMeta | undefined { return this.isDeleting(sessionId) ? undefined : this.sessions.get(sessionId)?.meta; }
}

/** continuationSessionUuid (L1200) — verbatim. */
export function continuationSessionUuid(sourceSessionId: string, clientActionId: string): string {
  const hex = createHash("sha256").update(`videoclaw-continuation-chat\0${sourceSessionId}\0${clientActionId}`, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
