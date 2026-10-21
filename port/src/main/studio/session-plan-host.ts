// PORT-NEW glue (docs/30 §1): the AgentHost session-plan lifecycle — the original methods restoredSessionPlan L36986,
// sessionPlanBinding L37001, sessionPlanFacts L37020, planSession L37025, readSessionPlan L37031, persistSessionPlan L37066,
// emitSessionPlan L37106, currentPlanSource L37127, recordAcceptedPlanSource L37138, sessionPlanOutdated L37152,
// planBudget L37178, callSessionPlan L37207, proposeSessionPlan L37256, chooseSessionPlan L37410, retrySessionPlan L37442,
// dispatchSessionPlan L37500, sessionPlanProductionRefusal L38138, sessionPlanBuildAccepted L38170,
// sessionPlanTurnContext L38254 and the writeRegistry plan projection (L36240-36249) — over the VERBATIM schemas,
// decision, projection and restore (studio-tools.generated.ts L3419-3985).
//
// Faithful except (each documented in docs/30 §1.4):
//  * runtimeTurnStore.isAccepted (L36990 / L38179) → the ComposerAttachmentStore send receipt ("committed") for that
//    clientTurnId, the port's only durable record that a composer turn reached the runtime.
//  * sessionPlanEstimateCents (L37192) → undefined: the engine advisory estimator (estimatePlanDisplayCents) is not
//    wired, which is the original's own "no amount" branch (the card never shows an invented number).
//  * preview operations (preview_session_shot) are not ported, so a port plan never carries previewOperations.
//  * recordPulse / refreshPulseMode (the journey pulse) are not ported (no-op).
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SessionPlanChoiceError, SessionPlanStateError, SessionPlanBindingError, SessionPlanPersistError, SessionPlanDispatchError,
  sessionPlanFailureDiagnostic,
} from "../memory/project-memory.generated";
import {
  sessionPlanToolSchema, storedSessionPlanSchema, splitSessionPlanForDisk, mergeSessionPlanDetails, sessionPlanChanges,
  projectSessionPlan, sessionPlanTurnId, decideSessionPlan, restoreSessionPlan, SessionPlanJobMissingError, SESSION_PLAN_JOB_MISSING,
  SESSION_PLAN_PREAMBLE_PREFIX, SESSION_PLAN_GUIDANCE, SESSION_PREVIEW_GUIDANCE,
} from "./studio-tools.generated";
import { displayTranscriptPath, readDisplayTranscript } from "../agent/history.generated";
import { composerTurnMessageUuid } from "../attachments/composer-attachments.generated";
import { recordMainLog } from "../feedback/feedback-env";

/** The mutable per-video record the plan state lives on (the original `session2`). */
export interface PlanSession {
  meta: { sessionId: string; clientId: string; cwd: string; jobId?: string; permissionMode?: string; status?: string; turnStartedAtMs?: number; runtime?: string };
  runtime?: { dead: boolean } | undefined;
  sessionPlan?: any;
  sessionPlanRequired?: boolean;
  lastUserTurnId?: string;
  sessionPlannerRequest?: unknown;
}
export interface SessionPlanHostDeps {
  stateDir: string;
  session(sessionId: string): PlanSession | undefined;
  /** this.sessions.get(id) === s && !removed && !deleting (sessionPlanBinding L37003) */
  isLive(s: PlanSession): boolean;
  memoryBinding(clientId: string): { gatewayUrl: string; canonicalKeyId: string };
  verifiedMemorySource(clientId: string, source: unknown): Promise<any>;
  flushRegistry(): boolean;
  sendMessage(sessionId: string, req: { clientTurnId: string; text: string; attachmentIds: string[] }): Promise<unknown>;
  spendSnapshot(sessionId: string): { ceilingUsd?: number; spentUsd?: number; reservedUsd: number; unknownSpend?: boolean };
  requestWitness(sessionId: string, requireRuntime: boolean): () => boolean;
  turnAccepted(sessionId: string, clientTurnId: string): boolean;
  continuedTurnIds?(sessionId: string): string[];
  emitSessionPlanChanged(payload: { scope: { sessionId: string; gatewayUrl: string; canonicalKeyId: string }; plan: unknown }): void;
  /** sessionPlanSendError L34311: ComposerDeliveryError → "refused" (the port has no TurnNotAcceptedError). */
  isComposerDeliveryError(error: unknown): boolean;
}

export class SessionPlanHost {
  constructor(private readonly d: SessionPlanHostDeps) {}

  private visibleTurns(sessionId: string): any[] {
    return (readDisplayTranscript(displayTranscriptPath(this.d.stateDir, sessionId)) as any).ordered
      .filter((turn: any) => turn.kind === "turn").filter((turn: any) => turn.displayTexts.length > 0);
  }
  private sendError(error: unknown, notStarted: string, facts: unknown) { // sessionPlanSendError L34311
    if (this.d.isComposerDeliveryError(error)) return new (SessionPlanDispatchError as any)("refused", (error as Error).message, facts);
    return new (SessionPlanDispatchError as any)("error", notStarted, facts, error);
  }

  /** restoredSessionPlan (L36986) — from a sessions.json row. */
  restoredSessionPlan(meta: Record<string, any>): { sessionPlanRequired?: true; sessionPlan?: any } {
    if (meta.sessionPlan === void 0) return meta.sessionPlanRequired === true ? { sessionPlanRequired: true } : {};
    try {
      const plan: any = mergeSessionPlanDetails(restoreSessionPlan(meta.sessionPlan, (turnId: string) => this.d.turnAccepted(meta.sessionId, turnId)), meta.sessionPlanDetails);
      if (meta.dismissedSessionPlan === `${plan.id}:${plan.revision}`) plan.dismissed = true;
      return { sessionPlanRequired: true, sessionPlan: plan };
    } catch {
      return { sessionPlanRequired: true, sessionPlan: null };
    }
  }
  /** writeRegistry (L36240-36249) — the plan fields of a sessions.json row. */
  registryFields(s: PlanSession): Record<string, unknown> {
    const plan = s.sessionPlan;
    const planOnDisk: any = plan ? splitSessionPlanForDisk(plan) : undefined;
    const out: Record<string, unknown> = {};
    if (plan !== void 0) out.sessionPlan = planOnDisk ? { ...planOnDisk.plan, dismissed: void 0 } : plan;
    if (planOnDisk?.details) out.sessionPlanDetails = planOnDisk.details;
    if (plan?.dismissed) out.dismissedSessionPlan = `${plan.id}:${plan.revision}`;
    if (s.sessionPlanRequired) out.sessionPlanRequired = true;
    return JSON.parse(JSON.stringify(out));
  }
  sessionPlanBinding(s: PlanSession) { // L37001
    const authority = this.d.memoryBinding(s.meta.clientId);
    const notReady = "This video is not ready to save a plan. Your brief is still here.";
    if (!this.d.isLive(s)) throw new (SessionPlanBindingError as any)("not-ready", notReady);
    if (!s.meta.jobId) throw new (SessionPlanJobMissingError as any)(notReady);
    return { gatewayUrl: authority.gatewayUrl.replace(/\/+$/, ""), canonicalKeyId: authority.canonicalKeyId, clientId: s.meta.clientId, jobId: s.meta.jobId };
  }
  sessionPlanFacts(sessionId: unknown) { // L37020
    const plan = typeof sessionId === "string" ? this.d.session(sessionId)?.sessionPlan : void 0;
    return plan ? { planId: plan.id, revision: plan.revision, action: plan.decision?.action } : {};
  }
  planSession(sessionId: string): PlanSession { // L37025
    const s = this.d.session(sessionId);
    if (!s) throw new (SessionPlanStateError as any)("unknown-session", `Unknown session: ${sessionId}`);
    return s;
  }
  readSessionPlan(sessionId: string): any { // L37031
    const s = this.planSession(sessionId);
    this.d.memoryBinding(s.meta.clientId);
    if (s.sessionPlan === void 0) return null;
    const binding = this.sessionPlanBinding(s);
    if (s.sessionPlan === null) throw new (SessionPlanStateError as any)("recovery", "The saved plan needs recovery. Your conversation is still available.");
    const plan = s.sessionPlan;
    if (!plan || JSON.stringify(plan.binding) !== JSON.stringify(binding)) return null;
    const view: any = projectSessionPlan(plan);
    if (this.sessionPlanOutdated(sessionId, plan)) view.outdated = true;
    view.budget = { ...this.planBudget(sessionId), ...(view.budget.estimatedCents === void 0 ? {} : { estimatedCents: view.budget.estimatedCents }) };
    // previewOperations: preview_session_shot not ported → a port plan never has any (L37049-37064)
    return view;
  }
  persistSessionPlan(s: PlanSession, proposed: unknown): void { // L37066
    const plan: any = storedSessionPlanSchema.parse(proposed);
    if (JSON.stringify(this.sessionPlanBinding(s)) !== JSON.stringify(plan.binding)) {
      throw new (SessionPlanBindingError as any)("changed", "The account or video changed before this plan was saved.");
    }
    const previous = s.sessionPlan;
    const wasRequired = s.sessionPlanRequired;
    s.sessionPlan = plan;
    s.sessionPlanRequired = true;
    if (!this.d.flushRegistry()) {
      s.sessionPlan = previous;
      s.sessionPlanRequired = wasRequired;
      throw new (SessionPlanPersistError as any)("The plan could not be saved. Your brief and choice are still here.");
    }
    this.emitSessionPlan(s);
  }
  emitSessionPlan(s: PlanSession): void { // L37106 (pulse not ported)
    const plan = s.sessionPlan;
    if (!plan) return;
    try {
      const pulsePlan = this.readSessionPlan(s.meta.sessionId);
      this.d.emitSessionPlanChanged({ scope: { sessionId: s.meta.sessionId, gatewayUrl: plan.binding.gatewayUrl, canonicalKeyId: plan.binding.canonicalKeyId }, plan: pulsePlan });
    } catch {}
  }
  currentPlanSource(s: PlanSession): string { // L37127
    const latest = this.visibleTurns(s.meta.sessionId).at(-1);
    if (!latest || latest.turnId !== s.lastUserTurnId) throw new Error("Use the current accepted brief before proposing a plan.");
    return latest.turnId;
  }
  recordAcceptedPlanSource(s: PlanSession, message: { uuid?: string }): void { // L37138
    const latest = this.visibleTurns(s.meta.sessionId).at(-1);
    if (latest && latest.turnId === message.uuid) s.lastUserTurnId = latest.turnId;
    if (s.sessionPlan) this.emitSessionPlan(s);
  }
  sessionPlanOutdated(sessionId: string, plan: any): boolean { // L37152
    const visible = this.visibleTurns(sessionId);
    const own = new Set([
      plan.sourceTurnId,
      composerTurnMessageUuid(sessionId, `plan-retry-${plan.id}-${plan.revision}`),
      ...(plan.decision ? [composerTurnMessageUuid(sessionId, sessionPlanTurnId(plan))] : []),
    ]);
    const continued = new Set((this.d.continuedTurnIds?.(sessionId) ?? []).map((id2) => composerTurnMessageUuid(sessionId, id2)));
    for (let index = visible.length - 1; index >= 0; index--) {
      if (own.has(visible[index].turnId)) return false;
      if (!continued.has(visible[index].turnId)) return true;
    }
    return true;
  }
  planBudget(sessionId: string) { // L37178
    const spend = this.d.spendSnapshot(sessionId);
    return {
      ...(spend.ceilingUsd === void 0 ? {} : { ceilingCents: Math.round(spend.ceilingUsd * 100) }),
      spentCents: spend.unknownSpend || spend.spentUsd === void 0 ? null : Math.round(spend.spentUsd * 100),
      heldCents: Math.round(spend.reservedUsd * 100),
    };
  }
  /** sessionPlanEstimateCents (L37192): the engine advisory estimator is not wired → no amount (its own fallback). */
  async sessionPlanEstimateCents(_declared: unknown): Promise<number | undefined> { return undefined; }

  async callSessionPlan(sessionId: string, raw: unknown, stillCurrent: () => boolean = () => true): Promise<any> { // L37207
    try {
      const parsed: any = sessionPlanToolSchema.safeParse(raw);
      if (!parsed.success) {
        if (parsed.error.issues.some((issue: any) => issue.path[0] === "buildApproval")) {
          throw new (SessionPlanChoiceError as any)("Use the current plan id and revision, the app-owned userTurnId, and the current user message exactly as sent. Build confirmation must be at most 4,000 characters; ask for a short confirmation if needed.");
        }
        if (parsed.error.issues.some((issue: any) => issue.path[0] === "fallback" && issue.path[1] === "paidOperations")) {
          return { ok: false, message: "fallback.paidOperations takes only a canonical lowercase tool (e.g. mint_image), an optional role, a count (1–500) and, for duration-priced work, the planned seconds per unit, for up to 32 paid operations, never amounts. Correct it or omit paidOperations, then call propose_session_plan again; this never approves production." };
        }
        if (parsed.error.issues.some((issue: any) => issue.path[0] === "fallback")) {
          return { ok: false, message: "Supply fallback as a separate JSON object with text, canvas and shots. Do not embed parameter markup inside context. Correct the arguments and call propose_session_plan again; this never approves production." };
        }
        throw parsed.error;
      }
      return { ok: true, plan: await this.proposeSessionPlan(this.planSession(sessionId), parsed.data, stillCurrent) };
    } catch (error) {
      recordMainLog("warn", sessionPlanFailureDiagnostic({ op: "propose", ...this.sessionPlanFacts(sessionId) }, error));
      return {
        ok: false,
        message: error instanceof (SessionPlanChoiceError as any) ? (error as Error).message
          : error instanceof (SessionPlanJobMissingError as any) ? SESSION_PLAN_JOB_MISSING
          : "The plan could not be proposed for the current brief. Continue the conversation or retry the saved plan; do not repeat this call unchanged.",
      };
    }
  }
  async proposeSessionPlan(s: PlanSession, args: any, stillCurrent: () => boolean = () => true): Promise<any> { // L37256
    if (!stillCurrent()) throw new (SessionPlanStateError as any)("ended", "The planning request ended.");
    const binding = this.sessionPlanBinding(s);
    const sourceTurnId = this.currentPlanSource(s);
    const previous = s.sessionPlan;
    const approval = args.buildApproval;
    const runtime = s.runtime;
    const requestCurrent = this.d.requestWitness(s.meta.sessionId, false);
    const approvalCurrent = () => !approval || Boolean(runtime && !runtime.dead && s.runtime === runtime && ((s as any).turnStartedAtMs ?? s.meta.turnStartedAtMs) !== void 0);
    const sourceText = (readDisplayTranscript(displayTranscriptPath(this.d.stateDir, s.meta.sessionId)) as any).ordered
      .filter((turn: any) => turn.kind === "turn").find((turn: any) => turn.turnId === sourceTurnId)?.displayTexts.join("\n").trim();
    const repeatedApproval = Boolean(approval && previous?.phase === "accepted" && previous.decision?.action === "build" && previous.decision.clientActionId === `chat-${sourceTurnId}`);
    if (approval && (!approvalCurrent() || approval.turnId !== sourceTurnId || approval.text !== sourceText || approval.planId !== previous?.id
      || JSON.stringify(previous?.binding) !== JSON.stringify(binding) || (!repeatedApproval && approval.revision !== previous?.revision))) {
      throw new (SessionPlanChoiceError as any)("Use the current user message exactly as sent, with its app-owned userTurnId and the current plan id and revision. Retry with those values during this turn; if you cannot match them, ask for a short build confirmation.");
    }
    if (s.sessionPlannerRequest) throw new Error("Planning is already underway.");
    if (approval && !repeatedApproval && previous?.sourceTurnId === sourceTurnId) {
      throw new (SessionPlanChoiceError as any)("This proposal was created during the current user turn. Show it to the user and wait for their build confirmation before approving it.");
    }
    if (previous?.sourceTurnId === sourceTurnId && (previous.phase !== "failed" || previous.dismissed) && !approval) {
      throw new Error("This brief already has a proposal or a failed attempt. Wait for a real user choice.");
    }
    const references: any[] = [];
    for (const source2 of args.references ?? []) {
      const resolved = await this.d.verifiedMemorySource(s.meta.clientId, source2);
      if (!resolved.available) throw new Error("A selected plan reference is unavailable.");
      references.push(resolved.source);
    }
    const estimatedCents = repeatedApproval ? void 0 : await this.sessionPlanEstimateCents(args.fallback.paidOperations);
    if (!requestCurrent()) {
      throw new (SessionPlanChoiceError as any)("This turn was stopped or changed while the plan was being prepared, so it was not saved. Propose it again in the current turn if it is still wanted.");
    }
    if (!stillCurrent() || !approvalCurrent() || this.currentPlanSource(s) !== sourceTurnId || JSON.stringify(this.sessionPlanBinding(s)) !== JSON.stringify(binding)
      || s.sessionPlan?.id !== previous?.id || s.sessionPlan?.revision !== previous?.revision || s.sessionPlan?.phase !== previous?.phase
      || s.sessionPlan?.dismissed !== previous?.dismissed || s.sessionPlan?.decision?.clientActionId !== previous?.decision?.clientActionId) {
      throw new Error("The brief or account changed before planning.");
    }
    const plan: any = {
      version: 1,
      id: previous?.id ?? randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      binding,
      sourceTurnId,
      phase: approval ? "accepted" : "awaiting-decision",
      shots: args.fallback.shots.map(({ description, label, seconds }: any) => ({ description, ...(label === void 0 ? {} : { label }), ...(seconds === void 0 ? {} : { seconds }) })),
      budget: { ...this.planBudget(s.meta.sessionId), ...(estimatedCents === void 0 ? {} : { estimatedCents }) },
      references,
      canvas: args.fallback.canvas,
      brief: args.context,
      text: args.fallback.text,
      simpleFallback: true,
      ...(approval && previous?.previewOperations?.length && !previous.storyboard ? {} : { storyboard: true }),
      ...(args.fallback.title === void 0 ? {} : { title: args.fallback.title }),
      ...(args.fallback.videoSeconds === void 0 ? {} : { videoSeconds: args.fallback.videoSeconds }),
      ...(args.fallback.paidOperations === void 0 ? {} : { paidOperations: args.fallback.paidOperations }),
      ...(approval && previous?.previewOperations?.length ? { previewOperations: previous.previewOperations.filter((slot: any) => slot.kind === "image" && slot.operation && args.fallback.shots[slot.shot]) } : {}),
      ...(approval ? { decision: { action: "build", clientActionId: `chat-${sourceTurnId}`, text: approval.text } } : {}),
    };
    if (repeatedApproval) {
      if (!["title", "text", "canvas", "videoSeconds", "shots", "paidOperations", "references", "brief"].every((key) => isDeepStrictEqual(plan[key], previous[key]))) {
        throw new Error("This user choice was already recorded for different content.");
      }
      return this.readSessionPlan(s.meta.sessionId);
    }
    if (approval) plan.chatApproval = { changes: sessionPlanChanges(previous, plan) };
    this.persistSessionPlan(s, plan);
    return projectSessionPlan(plan);
  }
  async chooseSessionPlan(sessionId: string, request2: any): Promise<any> { // L37410 (recordPulse not ported)
    const s = this.planSession(sessionId);
    if (!this.readSessionPlan(sessionId) || !s.sessionPlan) {
      throw new (SessionPlanStateError as any)(s.sessionPlan ? "binding-mismatch" : "missing", "There is no current proposal to choose.");
    }
    const existing = s.sessionPlan;
    const outdated = this.sessionPlanOutdated(sessionId, existing);
    const decided: any = decideSessionPlan(s.sessionPlan, request2);
    if (request2.action === "dismiss") {
      this.persistSessionPlan(s, decided);
      return this.readSessionPlan(sessionId);
    }
    if (decided.phase === "accepted") return this.readSessionPlan(sessionId);
    if (outdated && existing.decision?.clientActionId === request2.clientActionId) {
      throw new (SessionPlanChoiceError as any)("The conversation changed since this saved choice. Continue in chat with your latest instructions.");
    }
    if (outdated && request2.action !== "change") {
      throw new (SessionPlanChoiceError as any)(request2.action === "build"
        ? "The conversation changed. Tell me to build it in chat so it uses your latest instructions."
        : "The conversation changed. Ask for a preview in chat so it uses your latest instructions.");
    }
    this.persistSessionPlan(s, { ...decided, phase: "dispatching", message: void 0 });
    return this.dispatchSessionPlan(s);
  }
  async retrySessionPlan(sessionId: string): Promise<any> { // L37442
    const s = this.planSession(sessionId);
    if (!this.readSessionPlan(sessionId)) {
      throw new (SessionPlanStateError as any)(s.sessionPlan ? "binding-mismatch" : "missing", "There is no current proposal to retry.");
    }
    const plan = s.sessionPlan;
    const facts = this.sessionPlanFacts(sessionId);
    if (!plan || plan.phase !== "failed") throw new (SessionPlanStateError as any)("not-failed", "There is no failed plan action to retry.", facts);
    if (plan.dismissed) throw new (SessionPlanChoiceError as any)("This plan was dismissed. Continue in chat with your latest instructions.");
    if (!plan.decision) {
      const source2 = this.visibleTurns(sessionId).at(-1);
      const retryTurnId = `plan-retry-${plan.id}-${plan.revision}`;
      if (source2?.turnId !== plan.sourceTurnId && source2?.turnId !== composerTurnMessageUuid(sessionId, retryTurnId)) {
        throw new (SessionPlanStateError as any)("brief-changed", "The brief changed. Ask for a new proposal.", facts);
      }
      try {
        await this.d.sendMessage(sessionId, { clientTurnId: retryTurnId, text: "Please propose the plan again for this brief. Do not generate media or start the build yet.", attachmentIds: [] });
      } catch (error) {
        throw this.sendError(error, "Your brief is saved, but planning could not start. Retry when you are ready.", facts);
      }
      return projectSessionPlan(s.sessionPlan ?? plan);
    }
    return this.chooseSessionPlan(sessionId, {
      planId: plan.id, revision: plan.revision, action: plan.decision.action, clientActionId: plan.decision.clientActionId,
      ...(plan.decision.action === "change" ? { correction: plan.decision.text } : {}),
    });
  }
  async dispatchSessionPlan(s: PlanSession): Promise<any> { // L37500
    const plan = s.sessionPlan;
    const turnId = sessionPlanTurnId(plan);
    const currentDecision = () => {
      const current = s.sessionPlan;
      return current?.id === plan.id && current.revision === plan.revision && current.phase === "dispatching" && current.decision?.clientActionId === plan.decision.clientActionId ? current : void 0;
    };
    try {
      await this.d.sendMessage(s.meta.sessionId, { clientTurnId: turnId, text: plan.decision.text, attachmentIds: [] });
      const current = currentDecision();
      if (current) this.persistSessionPlan(s, { ...current, phase: "accepted", message: void 0 });
    } catch (error) {
      const current = currentDecision();
      if (!current) throw error;
      this.persistSessionPlan(s, { ...current, phase: "failed", message: "This choice is saved. Retry to continue the same request." });
      throw this.sendError(error, "Your choice is saved, but it could not start. Retry to continue the same request.", { planId: plan.id, revision: plan.revision, action: plan.decision.action });
    }
    return this.readSessionPlan(s.meta.sessionId);
  }
  /** sessionPlanBuildAccepted (L38170). */
  sessionPlanBuildAccepted(s: PlanSession): boolean {
    const plan = s.sessionPlan;
    try {
      return Boolean(plan && JSON.stringify(plan.binding) === JSON.stringify(this.sessionPlanBinding(s)) && plan.decision?.action === "build"
        && (plan.phase === "accepted" || this.d.turnAccepted(s.meta.sessionId, sessionPlanTurnId(plan))));
    } catch { return false; }
  }
  /** sessionPlanProductionRefusal (L38138) — EnginePolicyHost.sessionPlanRefusal (local runtime: no remote branch). */
  sessionPlanProductionRefusal(sessionId: string): string | undefined {
    const s = this.d.session(sessionId);
    if (!s) return "This video is no longer available.";
    const plan = s.sessionPlan;
    if (plan === void 0) return void 0;
    if (s.meta.permissionMode === "bypassPermissions") return void 0;
    if (this.sessionPlanBuildAccepted(s)) return void 0;
    if (plan === null) return "The saved plan for this video could not be read. Propose the plan again with propose_session_plan from the current brief and wait for the user’s choice before production. Preparation, questions and accepted-job collection remain available.";
    if (plan.decision?.action === "preview") return "This choice permits only the bounded shot preview. Use preview_session_shot; collect accepted jobs normally. If the current user clearly asked to build, record buildApproval through propose_session_plan with the current brief and proceed. Otherwise finish this turn and offer the next step.";
    if (plan.dismissed) return "The user dismissed the proposed plan. Before production, record their clear go-ahead in chat with buildApproval using the current brief, or propose a replacement from their new direction. Preparation, questions and accepted-job collection remain available. Explain once; do not repeat an unchanged attempt.";
    return "This video has a proposed plan waiting for the user’s choice. Before production, wait for Build it or record their clear go-ahead in chat with buildApproval. Propose a revised plan only if the user changed what the plan covers. Preparation, questions and accepted-job collection remain available. Explain once; do not repeat an unchanged attempt.";
  }
  /** sessionPlanTurnContext (L38254) — local runtime (meta.runtime !== "remote" → SESSION_PLAN_GUIDANCE). */
  sessionPlanTurnContext(s: PlanSession, turnId: string): string {
    const plan = s.sessionPlan;
    if (plan?.decision && sessionPlanTurnId(plan) === turnId) {
      const bypass = s.meta.permissionMode === "bypassPermissions";
      const direction = !bypass && plan.decision.action === "preview"
        ? SESSION_PREVIEW_GUIDANCE
        : !bypass && plan.decision.action === "change"
          ? "The user requested a revised proposal. Supply fallback: {text, canvas, shots} directly to propose_session_plan, using the current brief and correction. Do not regenerate media. Simple previews use still images only; omit motionReason."
          : (bypass
            ? "Bypass is enabled. Proceed to the full build from this plan, applying any requested correction with reasonable assumptions; do not wait for another plan or Build choice, even after Preview."
            : "The user chose Build it for this saved text revision. Build from this plan and collect reusable preview assets.") +
            (plan.canvas
              ? " Write the saved canvas width/height to job_inputs.style_directives and preserve it through composition. Check the selected model/mode supports the requested native shape; use the stated framing adaptation or discuss a consequential change. Measure final display dimensions, including rotation and pixel aspect, against this canvas before delivery; do not silently deliver a different shape."
              : "");
      return `${SESSION_PLAN_PREAMBLE_PREFIX}${JSON.stringify({
        direction, action: plan.decision.action, planId: plan.id, revision: plan.revision, title: plan.title, text: plan.text ?? plan.brief,
        canvas: plan.canvas, videoSeconds: plan.videoSeconds,
        shots: plan.simpleFallback ? plan.shots.map(({ motionReason: _motion, ...shot }: any) => shot) : plan.shots,
        ...(plan.storyboard ? { storyboard: "This preview is one annotated sheet, not individual seed frames. Request preview_session_shot once with shot=0, kind=image. Keep the sheet as the creative reference on Build; never use the entire sheet as a shot frame." } : {}),
        paidOperations: plan.paidOperations, references: plan.references,
      })}\n[END APP-OWNED SESSION PLAN]`;
    }
    const guidance = SESSION_PLAN_GUIDANCE;
    return s.sessionPlanRequired
      ? `${SESSION_PLAN_PREAMBLE_PREFIX}${JSON.stringify({
        ...(guidance ? { guidance } : {}),
        userTurnId: composerTurnMessageUuid(s.meta.sessionId, turnId),
        ...(plan?.dismissed ? { direction: "The user dismissed this plan. Continue discussing their direction in chat; do not require a choice on the dismissed card. Propose a replacement only from their new instructions. Dismissal grants no production, spending or rights approval and does not cancel already accepted work." } : {}),
        ...(plan ? { currentPlan: { id: plan.id, revision: plan.revision, phase: plan.phase, action: plan.decision?.action, dismissed: plan.dismissed } } : {}),
      })}\n[END APP-OWNED SESSION PLAN]`
      : "";
  }
}
