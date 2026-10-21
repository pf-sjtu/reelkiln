// PORT-NEW glue (docs/29): the last 23 category-(b) stub channels, each running the ORIGINAL handler body
// (app/reconstructed/main/index.js) over verbatim-sliced modules and the docs/28 local gateway shim.
// Electron-free (every collaborator is injected) so test/m12-channels.test.ts drives the exact handlers
// real-backend.ts registers.
//
//   sessionPlan:read/choose/retry  L61920-61950 → sessionPlanReply (L3995) over host.readSessionPlan… (no plan
//                                  can exist: propose_session_plan is a studio-MCP tool, not ported)
//   memory:read/update/undo/openSource L61955-61975 → projectMemoryReply / openProjectMemorySource (L10711/L10755)
//                                  over ProjectMemoryStore (L3256, LOCAL MEMORY.md) bound by memoryBinding (L36456)
//   outbox:authoritySnapshot       L61709 → Outbox.authoritySnapshot (L58000)
//   telemetry:bindReplay           L61710 → replayIdsBySession + enqueueSessionIndex (L60490, durable)
//   feedback:submit / grantUsageSharing L62346 / L62350 → FeedbackService (outbox "feedback" lane)
//   library:sync / library:search  L62092 / L62115 → guardedAppLibrary (L62042) + acquireLibraryGatewayLease (L45713)
//   engine:creditHandoffOffer / continueOnCredits L61655-61658 → host (L51901 / L52012)
//   engine:saveAgentProviderKey    L61665 (store only)
//   workflowSubmit:start           L62399 → WorkflowSubmissionService.submit (L59760) up to its eligibility refusal
//   app:update:check / preferences / channel L61330-61372 → startUpdateCheck (L55921) / createUpdatePreferences (L2182)
//   characters:sheetPlan / sheetBuild L61885-61891 → CharacterSheetBuilder (L19216)
//   media:transcribeVoice          L61911 → host.transcribeVoice (L45689) → VoiceDictation unavailable branch
import { randomUUID } from "node:crypto";
import {
  assertPlanGenerationAllowed, openProjectMemorySource, projectMemoryReply, sessionPlanReply,
} from "./memory/project-memory.generated";
import type { ProjectMemoryHost, MemoryAuthority } from "./memory/project-memory-host";
type Handler = (...a: any[]) => unknown;

export interface RemainingChannelsDeps {
  host?: any;
  memory?: ProjectMemoryHost;
  /** currentProjectMemoryScope (main L60451) */
  currentProjectMemoryScope: () => MemoryAuthority | null;
  openLocalPath: (path: string) => Promise<void>;
  /** assertGenerationAllowed (main L60842) */
  assertGenerationAllowed: () => void;
  absCwd: (cwd: string) => string;
  // ── outbox / telemetry / feedback ──
  outbox?: { authoritySnapshot(): unknown; enqueue(kind: string, data: unknown): void; enqueueDurable(kind: string, data: unknown): Promise<void> };
  sessionIndex?: (meta: any, posthogSessionId?: string, durable?: boolean) => Promise<void>;
  listSessions: () => Array<{ sessionId: string }>;
  feedback?: { submit(req: unknown): Promise<unknown>; grantUsageSharing(): Promise<unknown> };
  // ── library ──
  library?: {
    tenantFor(clientId: string): string | null;
    acquireLease(clientId: string, cwd: string, operation: "index" | "search"): Promise<{ gatewayUrl: string; gatewayKey: string; jobId: string; release(): void }>;
    sync(cwd: string, tenant: string, onLine: (line: string) => void, lease: unknown): Promise<number>;
    search(cwd: string, tenants: string[], query: unknown, type: unknown, lease: unknown): Promise<any[]>;
    errorMessage(e: unknown): string;
    gate(key: string, kind: string, fn: () => Promise<unknown>): Promise<unknown>;
    key(tenant: string, cwd: string): string;
    exposeHits(hits: any[]): any[];
    log(kind: string, detail: string): void;
  };
  push: (channel: string, payload: unknown) => void;
  // ── agent provider keys ──
  providerKeys?: { get(provider: string): string | undefined; set(provider: string, key: string | undefined): void; status(): unknown };
  // ── workflow submission ──
  workflow?: { authorizedRequest(path: string, init?: unknown): Promise<Response> };
  // ── updates ──
  update?: { checker(): { checkNow(): Promise<unknown> } | null; preferences(): { get(): Promise<unknown>; set(channel: unknown): Promise<unknown> } | null; appVersion: string };
  // ── characters ──
  sheets?: { plan(cwd: string, slug: string): Promise<unknown>; build(cwd: string, slug: string): Promise<unknown> };
  // ── voice ──
  voice?: { tools(): { helper: string; ffmpeg: string }; isAudio(a: unknown): boolean; invalidAudio: string };
}

// workflow-submission helpers (L1579-1618, L59387-59426), verbatim
const SUBMISSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
function isValidSubmissionId(value: unknown) { return typeof value === "string" && SUBMISSION_ID_RE.test(value); }
const WORKFLOW_NAME_MAX_LEN = 60;
function workflowSlug(name: string) { return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/^-+|-+$/g, ""); }
function workflowNameError(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Give the workflow a short name.";
  if (trimmed.length > WORKFLOW_NAME_MAX_LEN) return `Keep the name under ${WORKFLOW_NAME_MAX_LEN} characters.`;
  if (!workflowSlug(trimmed)) return "Use letters or digits in the name.";
  return null;
}
const ELIGIBILITY_PATH = "/v1/workflow-submissions/eligibility";
const SUBMISSION_PATH = "/v1/workflow-submissions";
function fail(submissionId: string, failure: string, message: string) { return { ok: false, submissionId, failure, message }; }

export function remainingChannels(d: RemainingChannelsDeps): Record<string, Handler> {
  const host = d.host;
  const needHost = () => { if (!host) throw new Error("Videos are not available in this build."); return host; };
  const mem = () => { if (!d.memory) throw Object.assign(new Error("Project memory is unavailable until this account and project are verified."), { code: "unavailable" }); return d.memory; };
  const replayIdsBySession = new Map<string, Set<string>>(); // main L60488
  const workflowInFlight = new Map<string, Promise<unknown>>();

  // WorkflowSubmissionService (L59760) — eligibility / completedAttempt / run up to the eligibility refusal.
  const wfEligibility = async () => {
    const unavailable = { eligible: false, githubUsername: null, workflowsRepo: "", configured: false };
    try {
      if (!d.workflow) return unavailable;
      const res = await d.workflow.authorizedRequest(ELIGIBILITY_PATH);
      if (!res.ok) return unavailable;
      const body: any = await res.json();
      return { eligible: body.eligible === true, githubUsername: typeof body.githubUsername === "string" ? body.githubUsername : null, workflowsRepo: typeof body.workflowsRepo === "string" ? body.workflowsRepo : "", configured: body.configured === true };
    } catch { return unavailable; }
  };
  const wfCompleted = async (submissionId: string) => {
    try {
      if (!d.workflow) return null;
      const res = await d.workflow.authorizedRequest(`${SUBMISSION_PATH}/${encodeURIComponent(submissionId)}`);
      if (!res.ok) return null;
      const body: any = await res.json();
      return body.pr ?? null;
    } catch { return null; }
  };
  const wfRun = async (req: any) => {
    const submissionId = req.submissionId;
    const alreadyDone = await wfCompleted(submissionId);
    if (alreadyDone) return { ok: true, submissionId, pr: alreadyDone };
    const nameError = workflowNameError(String(req?.workflowName ?? ""));
    if (nameError) return fail(submissionId, "name-required", nameError);
    const eligibility = await wfEligibility();
    if (!eligibility.eligible) return fail(submissionId, "not-eligible", "Workflow submission is limited to Videoclaw workflow creators.");
    if (!eligibility.configured) return fail(submissionId, "not-configured", "This Videoclaw gateway is not set up to receive workflow submissions yet.");
    // collect() (job walk / secret scan / archive / PUT) is unreachable: no account plane can say eligible
    return fail(submissionId, "not-configured", "This Videoclaw gateway is not set up to receive workflow submissions yet.");
  };

  // guardedAppLibrary (L62042)
  const guardedAppLibrary = async (clientId: unknown, cwd: unknown, operation: "index" | "search", fn: (tenant: string, lease: any) => Promise<unknown>) => {
    const L = d.library;
    const tenant = L?.tenantFor(String(clientId)) ?? null;
    if (!tenant || !L) return { error: "no-tenant" };
    let lease: any;
    try {
      d.assertGenerationAllowed();
      lease = await L.acquireLease(String(clientId), d.absCwd(String(cwd)), operation);
    } catch (error) {
      return { error: "paid-work-unavailable", message: error instanceof Error ? error.message : "Paid Library work is unavailable right now." };
    }
    try {
      return await fn(tenant, lease);
    } catch (error: any) {
      L.log("library-failure", String(error?.cause ?? error));
      return { error: "engine", message: L.errorMessage(error) };
    } finally { lease.release(); }
  };

  return {
    // ── session plans (L61920-61950) ──
    "sessionPlan:read": (scope: any) => sessionPlanReply(scope, d.currentProjectMemoryScope, () => mem().readSessionPlan(scope.sessionId), { op: "read", ...d.memory?.sessionPlanFacts(scope?.sessionId) }),
    "sessionPlan:choose": (scope: any, request2: any) => sessionPlanReply(scope, d.currentProjectMemoryScope, () => {
      if (request2.action !== "dismiss") assertPlanGenerationAllowed(d.assertGenerationAllowed);
      return mem().chooseSessionPlan(scope.sessionId, request2);
    }, { op: "choose", action: request2?.action, planId: request2?.planId, revision: request2?.revision }),
    "sessionPlan:retry": (scope: any) => sessionPlanReply(scope, d.currentProjectMemoryScope, () => {
      assertPlanGenerationAllowed(d.assertGenerationAllowed);
      return mem().retrySessionPlan(scope.sessionId);
    }, { op: "retry", ...d.memory?.sessionPlanFacts(scope?.sessionId) }),
    // ── project memory (L61955-61975) ──
    "memory:read": (scope: any) => projectMemoryReply(scope, d.currentProjectMemoryScope, () => mem().readProjectMemory(scope.clientId)),
    "memory:update": (scope: any, mutation: unknown) => projectMemoryReply(scope, d.currentProjectMemoryScope, () => mem().updateProjectMemory(scope.clientId, mutation)),
    "memory:undo": (scope: any, undoId: unknown, revision2: unknown) => projectMemoryReply(scope, d.currentProjectMemoryScope, () => mem().undoProjectMemory(scope.clientId, undoId, revision2)),
    "memory:openSource": (scope: any, source2: unknown) => openProjectMemorySource(scope, source2, d.currentProjectMemoryScope, (clientId: string, ref: unknown) => mem().resolveProjectMemorySource(clientId, ref), d.openLocalPath),
    // ── outbox / telemetry (L61709-61730) ──
    "outbox:authoritySnapshot": () => {
      if (!d.outbox) throw new Error("Usage sharing is unavailable in this build: no Videoclaw gateway is configured.");
      return d.outbox.authoritySnapshot();
    },
    "telemetry:bindReplay": async (binding: any) => {
      if (!binding || typeof binding.appSessionId !== "string" || typeof binding.posthogSessionId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(binding.appSessionId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.posthogSessionId)) {
        throw new Error("invalid telemetry replay binding");
      }
      const meta = d.listSessions().find((s) => s.sessionId === binding.appSessionId);
      if (!meta) throw new Error("telemetry replay session is not registered");
      let replayIds = replayIdsBySession.get(meta.sessionId);
      if (!replayIds) { replayIds = new Set(); replayIdsBySession.set(meta.sessionId, replayIds); }
      replayIds.add(binding.posthogSessionId);
      await d.sessionIndex?.(meta, binding.posthogSessionId, true);
    },
    // ── feedback (L62346-62351) ──
    "feedback:submit": (req: unknown) => { if (!d.feedback) throw new Error("Feedback is unavailable."); return d.feedback.submit(req); },
    "feedback:grantUsageSharing": () => { if (!d.feedback) throw new Error("Feedback is unavailable."); return d.feedback.grantUsageSharing(); },
    // ── library (L62092-62121) ──
    "library:sync": (clientId: unknown, cwd: unknown) => guardedAppLibrary(clientId, cwd, "index", async (tenant, lease) =>
      d.library!.gate(d.library!.key(tenant, d.absCwd(String(cwd))), "index", async () => {
        const code = await d.library!.sync(d.absCwd(String(cwd)), tenant, (line) => d.push("library:syncProgress", { clientId, kind: "line", text: line }), lease);
        d.push("library:syncProgress", { clientId, kind: "done", code });
        return { code };
      })),
    "library:search": (clientId: unknown, cwd: unknown, query2: unknown, type: unknown, tenants: unknown) => guardedAppLibrary(clientId, cwd, "search", async (tenant, lease) =>
      d.library!.exposeHits(await d.library!.search(d.absCwd(String(cwd)), Array.isArray(tenants) && tenants.length ? tenants.map(String) : [tenant], query2, type, lease))),
    // ── VideoClaw credits (L61655-61658) ──
    "engine:creditHandoffOffer": (sessionId: unknown) => needHost().creditHandoffOffer(String(sessionId)),
    "engine:continueOnCredits": (sessionId: unknown, request2: unknown) => needHost().continueOnCredits(String(sessionId), request2),
    // ── agent provider key (L61665): stored in the credential vault; never validated, never sent ──
    "engine:saveAgentProviderKey": (provider: unknown, key: unknown) => {
      if (provider !== "openai-api" && provider !== "openrouter") throw new Error("Unsupported agent provider.");
      if (key !== undefined && (typeof key !== "string" || key.length > 4096)) throw new Error("Invalid agent provider key.");
      if (!d.providerKeys) throw new Error("Agent provider keys are unavailable in this build.");
      d.providerKeys.set(provider, key as string | undefined);
      return d.providerKeys.status();
    },
    // ── workflow submission (L62399) ──
    "workflowSubmit:start": (req: any) => {
      if (!isValidSubmissionId(req?.submissionId)) return Promise.resolve(fail("", "invalid-submission-id", "Videoclaw could not start this submission — reopen the dialog and try again."));
      const key = req.submissionId;
      const existing = workflowInFlight.get(key);
      if (existing) return existing;
      const attempt = wfRun(req).finally(() => workflowInFlight.delete(key));
      workflowInFlight.set(key, attempt);
      return attempt;
    },
    // ── updates (L61330-61372) ──
    "app:update:preferences": async () => {
      const prefs = d.update?.preferences();
      if (!prefs) throw new Error("Updates are starting.");
      return prefs.get();
    },
    "app:update:channel": async (channel: unknown) => {
      const prefs = d.update?.preferences();
      if (!prefs) throw new Error("Updates are starting.");
      const result = await prefs.set(channel);
      await d.update?.checker()?.checkNow();
      return result;
    },
    "app:update:check": () => d.update?.checker()?.checkNow() ?? { kind: "failed", currentVersion: d.update?.appVersion ?? "" },
    // ── characters (L61885-61891) ──
    "characters:sheetPlan": (cwd: unknown, slug: unknown) => {
      if (!d.sheets) return { status: "unavailable", message: "Building sheets needs a newer version of your studio than you have right now — it'll arrive with the next update. Your photos are saved." };
      return d.sheets.plan(d.absCwd(String(cwd)), String(slug));
    },
    "characters:sheetBuild": (cwd: unknown, slug: unknown) => {
      d.assertGenerationAllowed();
      if (!d.sheets) return false;
      return d.sheets.build(d.absCwd(String(cwd)), String(slug));
    },
    // ── voice (L61911) ──
    "media:transcribeVoice": (sessionId: unknown, recordingId: unknown, audio: unknown) => {
      const v = d.voice ?? { tools: () => ({ helper: "", ffmpeg: "" }), isAudio: () => true, invalidAudio: "This recording could not be read. Record a new short note." };
      return needHost().transcribeVoice(String(sessionId), recordingId, audio, v.tools(), v.isAudio, v.invalidAudio);
    },
  };
}
export const _test = { workflowNameError, workflowSlug, isValidSubmissionId, randomUUID };
