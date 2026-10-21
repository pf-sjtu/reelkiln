// PORT (docs/21 M2): the session → engine wiring of the ORIGINAL AgentHost for local Claude Code
// sessions, minus the gateway/studio/spend machinery the port does not have. Everything here is
// either a verbatim slice (session-assembly.generated.ts / production-auth.generated.ts) or a
// line-referenced port of the original method, with the not-ported collaborators reduced to the
// state an original install is in WITHOUT a Videoclaw account (no gateway, no studio bundle, no
// project-memory authority, no feature flags, spend policy of a new video = unlimited_for_video).
//
//   spawnLocal (L39454)            → engineRuntimeEnv() + engineSystemAppend() + engineQueryOptions()
//   createLocalRuntime (L23059)    → engineQueryOptions(): settingSources ["project"], preset
//                                    claude_code + append, disallowedTools, canUseTool adapter,
//                                    hooks, strictMcpConfig, env (engine env + app switches)
//   makeHooks (L49787)             → makeEngineHooks()
//   makeCanUseTool (L49920)        → makeEngineCanUseTool()
//   adaptClaudeCodeCanUseTool (L22977) + claudeCodeDisallowedTools (L22949)
//   assembleBundle (L40739), sessionPolicyContext (L40763), sessionPolicyPreamble (L40802)
//   submitPreparedMessage (L41559) → firstMessageJobId() + engineTurnText()
//   maybeBindJob (L47576) / isPreexistingJob (L47938) → sniffJobIds()
//   pinBoundJobEnv (L34018), pinSessionContextEpoch (L34022)
import { selfAuthorizingStudioTools } from "../studio/studio-tools.generated";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { venvPython } from "../platform";
import { isClientJobId } from "../engine/session";
import {
  ACCOUNT_PREFERENCE_GUIDANCE,
  assembleLocalSessionContext,
  assertEnginePython,
  CHARACTER_VOICE_GUIDANCE,
  classifyPriorWorkIntent,
  legacyDevSessionContext,
  deterministicJobId,
  JOB_RE,
  permissionModeMeaning,
  policyRefusalMessage,
} from "./session-assembly.generated";
import {
  appOwnedVideoCommandRefusal,
  authorizeProductionCommand,
  BOUND_JOB_ENV,
  verdictRunsFinalRender,
  withFinalRenderWindow,
} from "./production-auth.generated";

export interface EngineRefLike { path: string; version?: string; buildSha256?: string }
export interface EngineSessionDeps {
  /** workspaceRoot (L9176): ~/Videoclaw. */
  workspaceRoot(): string;
  /** currentEngine (L9187). null = no installed engine → sessions refuse to start. */
  currentEngine(): EngineRefLike | null;
  /** engineSessionEnv (L9380) — throws SessionContextError when the workspace settings drifted. */
  engineSessionEnv(gatewayKey?: string, gatewayUrl?: string): Record<string, string>;
  /** assertInstalledEngineProductionContract (L6982). */
  assertProductionContract(enginePath: string): void;
  /** app.isPackaged (authorizeProductionCommand requireInstalledEngine). */
  isPackaged: boolean;
  /** settings().gatewayUrl — the port has no gateway (undefined). */
  gatewayUrl?(): string | undefined;
  /** runProjectBrief (L53792) override for tests; default runs the engine's project_brief.py. */
  projectBrief?(cwd: string, tenant: string | null): string;
}

export interface EngineSessionMeta {
  sessionId: string;
  cwd: string;
  clientId: string;
  jobId?: string;
  permissionMode: string;
  createdAt: number;
  policyRevision?: number;
  modelOverride?: string;
}

// ── session policy (L40763 / L40802). New videos get spendBudgets.setUnlimited (L38858). ──
export function sessionPolicyContext(meta: EngineSessionMeta) {
  return {
    schema: "videoclaw.session-policy/v2",
    revision: meta.policyRevision ?? 0,
    toolPermissions: { mode: meta.permissionMode, meaning: permissionModeMeaning(meta.permissionMode) },
    spending: {
      mode: "unlimited_for_video",
      meaning: "Paid operations proceed without a money prompt or a session spending limit. Account limits still apply. A model with no price estimate requires a temporary $10 hold, settled against its actual bill.",
    },
  };
}
export function sessionPolicyPreamble(meta: EngineSessionMeta): string {
  const policy = sessionPolicyContext(meta);
  return `[APP-OWNED SESSION POLICY — authoritative revision ${policy.revision}]
${JSON.stringify(policy)}
This is live host state, not a user message. Follow it without asking the user to restate it. Do not require a budget when spending mode is ask_each; the app will collect exact spend approval when needed.
[END APP-OWNED SESSION POLICY]

`;
}

/** submitPreparedMessage L41561-41564: the first message of an unbound video mints its job. */
export function firstMessageJobId(meta: EngineSessionMeta, text: string): string | undefined {
  if (meta.jobId || text.startsWith("✅") || classifyPriorWorkIntent(text) === "continue") return undefined;
  return deterministicJobId(text, meta.sessionId, meta.createdAt);
}
export function ensureJobDir(cwd: string, jobId: string): void { mkdirSync(join(cwd, "jobs", jobId), { recursive: true }); }

/** submitPreparedMessage L41594-41600 (no quickstart, no completed paid results, no attachments,
 *  no plan context, no character mentions in the port). */
export function engineTurnText(meta: EngineSessionMeta, text: string): string {
  return sessionPolicyPreamble(meta) + (meta.jobId
    ? `[APP-OWNED PRODUCTION ID — authoritative]
This video is already bound to the bare id "${meta.jobId}" and jobs/${meta.jobId}/ already exists. Use exactly this literal id for every --job and job_id. Do not choose, create, or switch to another id. Run prepare_production for this id before planning or paid work.

${text}`
    : text);
}

// ── assembleBundle (L40739) ──
function readTextFileQuiet(file: string): string { try { return readFileSync(file, "utf-8"); } catch { return ""; } } // L53785
export function listJobIds(cwd: string): Set<string> { // L34411
  try { return new Set(readdirSync(join(cwd, "jobs"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)); } catch { return new Set(); }
}
export function runProjectBrief(enginePath: string | undefined, cwd: string, tenant: string | null): string { // L53792
  try {
    if (!enginePath) return "";
    const py = venvPython(enginePath);
    const script = join(enginePath, "tools", "project_brief.py");
    if (!existsSync(py) || !existsSync(script)) return "";
    return execFileSync(py, [script, "--tenant", tenant ?? "", "--workspace", cwd], { cwd: enginePath, timeout: 5e3, encoding: "utf-8" }).trim();
  } catch { return ""; }
}
export function assembleBundle(d: EngineSessionDeps, meta: EngineSessionMeta) {
  const cwd = meta.cwd;
  const tenant: string | null = null; // getClient(clientId)?.tenant — the port's clients carry no tenant
  const eng = d.currentEngine();
  return {
    ...(meta.jobId ? { clientJob: meta.jobId } : {}),
    tenant,
    model: meta.modelOverride ?? null,
    permissionMode: meta.permissionMode,
    sessionPolicy: sessionPolicyContext(meta),
    taste: { global: readTextFileQuiet(join(cwd, "taste", "GLOBAL.md")), packs: {} as Record<string, string> },
    brief: d.projectBrief ? d.projectBrief(cwd, tenant) : runProjectBrief(eng?.path, cwd, tenant),
    workspaceSnapshot: { jobs: [...listJobIds(cwd)], engineVersion: eng?.version ?? "" },
  };
}
/** localSessionSections (L38345): [...projectMemoryContext(clientId) (L38323), ACCOUNT_PREFERENCE_GUIDANCE]. */
export function localSessionSections(memoryContext: string[] = []): string[] { return [...memoryContext, ACCOUNT_PREFERENCE_GUIDANCE]; }

/** pinBoundJobEnv (L34018) + pinSessionContextEpoch (L34022). */
export function pinBoundJobEnv(env: Record<string, string>, jobId: string | undefined): void {
  delete env[BOUND_JOB_ENV];
  if (jobId && isClientJobId(jobId)) env[BOUND_JOB_ENV] = jobId;
}
export function pinSessionContextEpoch(env: Record<string, string>, current: string | undefined): string | undefined {
  const fresh = env.VIDEOCLAW_CONTEXT_EPOCH;
  if (!fresh) return current;
  const pinned = current ?? fresh;
  env.VIDEOCLAW_CONTEXT_EPOCH = pinned;
  return pinned;
}

export interface EngineSpawnContext { engineEnv: Record<string, string>; append: string; contextEpoch?: string; lawsVersion?: string; appendSha256?: string }
/** spawnLocal L39461-39495 (local claude-code branch): engine env + assembled session context. */
export function prepareEngineSpawn(d: EngineSessionDeps, meta: EngineSessionMeta, contextEpoch: string | undefined, memoryContext: string[] = [], gateway?: { gatewayKey: string; gatewayUrl: string }): EngineSpawnContext {
  if (!d.currentEngine()) throw new Error("Production is blocked because no installed engine can validate the current route. Run Setup, then retry.");
  // L39462: engineSessionEnv(gateway.gatewayKey, gateway.gatewayUrl) — docs/31: the session's AgentGatewayProxy credential
  const engineEnv: Record<string, string> = { ...(gateway ? d.engineSessionEnv(gateway.gatewayKey, gateway.gatewayUrl) : d.engineSessionEnv()) };
  assertEnginePython(engineEnv.VIDEOCLAW_ENGINE);
  if (engineSupportsOperationRecovery(engineEnv.VIDEOCLAW_ENGINE)) engineEnv.VIDEOCLAW_OPERATION_RECOVERY = "1";
  pinBoundJobEnv(engineEnv, meta.jobId);
  const epoch = engineEnv.VIDEOCLAW_CONTEXT_EPOCH ? pinSessionContextEpoch(engineEnv, contextEpoch) : contextEpoch;
  if (engineEnv.VIDEOCLAW_ENGINE) d.assertProductionContract(engineEnv.VIDEOCLAW_ENGINE);
  const bundle = { ...assembleBundle(d, meta) };
  const sc: any = engineEnv.VIDEOCLAW_ENGINE
    ? assembleLocalSessionContext(engineEnv.VIDEOCLAW_ENGINE, bundle, localSessionSections(memoryContext) as any, undefined)
    : legacyDevSessionContext([...localSessionSections(memoryContext), CHARACTER_VOICE_GUIDANCE] as any, undefined);
  return { engineEnv, append: sc.append, contextEpoch: epoch, lawsVersion: sc.lawsVersion, appendSha256: sc.hashes?.append };
}
/** engineSupportsOperationRecovery (L9202), verbatim logic. */
export function engineSupportsOperationRecovery(enginePath: string | undefined): boolean {
  if (!enginePath) return false;
  try {
    const contract = JSON.parse(readFileSync(join(enginePath, "executor-capabilities.json"), "utf8"));
    return (
      contract?.schema === "videoclaw.executor-capabilities/v1" &&
      contract.executor_api === "videoclaw-executor/v1" &&
      Array.isArray(contract.capabilities) &&
      contract.capabilities.includes("operations.recover/accepted-media@1")
    );
  } catch {
    return false;
  }
}

// ── createLocalRuntime option constants (L22736-22740, L22949-22976; chunk L3920-3940) ──
export const CLAUDEAI_CONNECTORS_OFF = { ENABLE_CLAUDEAI_MCP_SERVERS: "0" };
export const CLAUDE_CODE_NO_SELF_STARTING_WORK = { CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CODE_DISABLE_WORKFLOWS: "1" };
const CLAUDE_CODE_SELF_STARTING_TOOLS = ["CronCreate", "CronDelete", "CronList", "ScheduleWakeup", "RemoteTrigger", "Workflow", "SendMessage", "ListAgents", "PushNotification"];
// CLAUDE_CODE_INTERNAL_PLAN_TOOLS (chunk, provider plan-mode tools)
export const CLAUDE_CODE_INTERNAL_PLAN_TOOLS = ["EnterPlanMode", "ExitPlanMode"];
export const claudeCodeDisallowedTools = () => [...new Set(["Task", "Agent", "Monitor", ...CLAUDE_CODE_SELF_STARTING_TOOLS, ...CLAUDE_CODE_INTERNAL_PLAN_TOOLS])];
const CLAUDE_CODE_PLAN_MODE_REDIRECT = "Special plan mode is not available in this studio. You may reason about or describe your approach in ordinary conversation, then continue the current request without asking for plan approval. Tool permissions and paid-operation approval are enforced separately by the app.";

export type CanUseToolResult = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string; interrupt?: boolean };
export type CanUseTool = (toolName: string, input: Record<string, unknown>, options: { signal?: AbortSignal; toolUseID?: string; requestId?: string; title?: string; displayName?: string; description?: string; decisionReason?: unknown; suggestions?: unknown }) => Promise<CanUseToolResult>;
/** adaptClaudeCodeCanUseTool (L22977): plan-mode tools are redirected; the studio self-authorizing MCP tools
 *  (CLAUDE_CODE_SELF_AUTHORIZING_STUDIO_TOOLS L22956, docs/30) are allowed without a permission card. */
export function adaptClaudeCodeCanUseTool(delegate: CanUseTool): CanUseTool {
  return async (toolName, input, options) => {
    if (CLAUDE_CODE_INTERNAL_PLAN_TOOLS.includes(toolName)) return { behavior: "deny", message: CLAUDE_CODE_PLAN_MODE_REDIRECT };
    if (selfAuthorizingStudioTools.has(toolName)) return { behavior: "allow", updatedInput: input };
    return delegate(toolName, input, options);
  };
}

/** createLocalRuntime env (L23268-23314) for the port's provider route: the route's own child env
 *  (gate-proxy token, base URL, model aliases, isolated CLAUDE_CONFIG_DIR) takes the place of the
 *  gateway branch; then the engine env and the app switches, exactly in the original order. */
export function engineChildEnv(routeEnv: Record<string, string>, engineEnv: Record<string, string>, assembled: boolean): Record<string, string> {
  return {
    ...routeEnv,
    CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: "1",
    ...engineEnv,
    CLAUDE_AGENT_SDK_CLIENT_APP: "videoclaw-app/0.0.1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    ...(assembled ? { VIDEOCLAW_LAWS_VIA_APPEND: "1", VIDEOCLAW_SERVER_ASSEMBLY: "1" } : {}),
    ...CLAUDEAI_CONNECTORS_OFF,
    ...CLAUDE_CODE_NO_SELF_STARTING_WORK,
  };
}

// ── permission model ──
export interface EnginePolicyHost {
  sessionCwd(sessionId: string): string | undefined;
  sessionJobId(sessionId: string): string | undefined;
  /** creativeActionRefusal → sessionPlanProductionRefusal (L38138, docs/30). */
  sessionPlanRefusal?(sessionId: string): string | undefined;
  /** Ask the human (permission:request card). Resolves with their decision. */
  askHuman(req: PermissionRequest, signal?: AbortSignal): Promise<CanUseToolResult>;
  /** Paid generation: the port has no gateway account (M9) → refusal text. */
  paidRefusal(): string;
  log?(event: string, detail: Record<string, unknown>): void;
}
export interface PermissionRequest {
  requestId: string; toolUseId?: string; sessionId: string; kind: "permission" | "question" | "money"; toolName: string; input: Record<string, unknown>;
  questions?: unknown; title?: string; displayName?: string; description?: string; decisionReason?: unknown; suggestions?: unknown;
}

function authorize(d: EngineSessionDeps, host: EnginePolicyHost, sessionId: string, command: string, engineEnv: Record<string, string>) {
  return authorizeProductionCommand({
    command,
    cwd: host.sessionCwd(sessionId) ?? d.workspaceRoot(),
    env: { ...process.env, ...engineEnv },
    gatewayUrl: d.gatewayUrl?.(),
    toolName: "Bash",
    requireInstalledEngine: d.isPackaged,
    creativeActionRefusal: () => host.sessionPlanRefusal?.(sessionId),
    sessionJobId: host.sessionJobId(sessionId),
    currentSessionJobId: () => host.sessionJobId(sessionId),
  }) as Promise<{ allowed: boolean; reason: string; verdict?: any; protected?: boolean; jobs?: string[] }>;
}

/** makeHooks (L49787): PreToolUse Bash → production authorization; AskUserQuestion → ask;
 *  Task/Agent → deny. Not ported: reportOnlyTurn, engine-integrity re-attest (ensureEngineIntegrity),
 *  quickstart clarification gates, withGenTimeoutFloor (paid only), production-decision beacons. */
export function makeEngineHooks(d: EngineSessionDeps, host: EnginePolicyHost, sessionId: string, engineEnv: Record<string, string>) {
  const ask = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } });
  const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: policyRefusalMessage(reason) } });
  const subagents = "Subagents are disabled for production turns because app-issued job approval cannot be inherited safely.";
  return {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          async (input: any) => {
            const cmd = String(input?.tool_input?.command ?? "");
            const appOwnedRefusal = appOwnedVideoCommandRefusal(cmd);
            if (appOwnedRefusal) { host.log?.("agent.production.decision", { sessionId, via: "hook", allowed: false, reason: "app-owned" }); return deny(appOwnedRefusal); }
            const route = await authorize(d, host, sessionId, cmd, engineEnv);
            host.log?.("agent.production.decision", { sessionId, via: "hook", allowed: route.allowed, classification: route.verdict?.classification, spendRisk: route.verdict?.spendRisk, jobs: route.jobs, reason: route.allowed ? undefined : String(route.reason).slice(0, 300) });
            if (!route.allowed) return deny(route.reason);
            const needsSpendApproval = route.verdict ? route.verdict.spendRisk !== "free" : false; // classifyPaidGen not ported (verdict always present on allow)
            const originalInput = input?.tool_input ?? {};
            const updatedInput = verdictRunsFinalRender(route.verdict) ? withFinalRenderWindow(originalInput) : originalInput;
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                ...(needsSpendApproval ? { permissionDecision: "ask", permissionDecisionReason: "PAID_GENERATION" } : {}),
                ...(updatedInput !== originalInput ? { updatedInput } : {}),
              },
            };
          },
        ],
      },
      { matcher: "AskUserQuestion", hooks: [async () => ask("USER_QUESTION")] },
      { matcher: "Task", hooks: [async () => deny(subagents)] },
      { matcher: "Agent", hooks: [async () => deny(subagents)] },
    ],
  };
}

let requestSeq = 0;
/** makeCanUseTool (L49920), local claude-code path. Not ported: advisory budget / plan budget offer
 *  (money → port refusal), codex containment, quickstart gates, beacons. */
export function makeEngineCanUseTool(d: EngineSessionDeps, host: EnginePolicyHost, sessionId: string, engineEnv: Record<string, string>): CanUseTool {
  return async (toolName, input, options) => {
    const requestId = options?.requestId ?? `perm-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;
    if (options?.signal?.aborted) return { behavior: "deny", message: "Aborted", interrupt: true };
    const command = String(input?.command ?? "");
    let production: Awaited<ReturnType<typeof authorize>> | undefined;
    if (toolName === "Bash") {
      const appOwnedRefusal = appOwnedVideoCommandRefusal(command);
      if (appOwnedRefusal) return { behavior: "deny", message: policyRefusalMessage(appOwnedRefusal) };
      production = await authorize(d, host, sessionId, command, engineEnv);
      host.log?.("agent.production.decision", { sessionId, via: "canUseTool", allowed: production.allowed, classification: production.verdict?.classification, spendRisk: production.verdict?.spendRisk, jobs: production.jobs, reason: production.allowed ? undefined : String(production.reason).slice(0, 300) });
      if (options?.signal?.aborted) return { behavior: "deny", message: "Aborted", interrupt: true };
      if (!production.allowed) return { behavior: "deny", message: policyRefusalMessage(production.reason) };
    }
    const engineClassifiesSpend = production?.verdict && production.verdict.spendRisk !== "free";
    const kind = toolName === "AskUserQuestion" ? "question" : engineClassifiesSpend ? "money" : "permission";
    if (kind === "money") return { behavior: "deny", message: policyRefusalMessage(host.paidRefusal()) };
    const req: PermissionRequest = {
      requestId, toolUseId: options?.toolUseID, sessionId, kind, toolName, input,
      questions: kind === "question" ? ((input as any).questions ?? []) : undefined,
      title: options?.title, displayName: options?.displayName, description: options?.description, decisionReason: options?.decisionReason, suggestions: options?.suggestions,
    };
    const result = await host.askHuman(req, options?.signal);
    if (toolName === "Bash" && result.behavior === "allow") { // reauthorizeBashAtAllow (L50122)
      const again = await authorize(d, host, sessionId, command, engineEnv);
      if (!again.allowed) return { behavior: "deny", message: policyRefusalMessage(again.reason) };
    }
    return result;
  };
}

/** maybeBindJob (L47576) candidate extraction: `jobs/<id>` mentions in tool input. */
export function sniffJobIds(haystack: string): string[] {
  const out: string[] = [];
  for (const m of haystack.matchAll(JOB_RE as RegExp)) if (isClientJobId(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}
/** isPreexistingJob (L47938). */
export function isPreexistingJob(preexisting: Set<string> | undefined, cwd: string, createdAt: number, jobId: string): boolean {
  if (preexisting) return preexisting.has(jobId);
  try { const st = statSync(join(cwd, "jobs", jobId)); const bornMs = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs; return bornMs < createdAt; } catch { return false; }
}

// ── PORT-NEW (docs/21 §MiniMax): economy note for non-Claude provider routes ──
/** Env opt-out: VIDEOCLAW_PORT_ROUTE_HINT=0. Not in the original (which only ever ran Claude models).
 *  Content is engine-generic (points at the engine's OWN docs/tools; no scenario values). */
export const PORT_ROUTE_HINT_ENV = "VIDEOCLAW_PORT_ROUTE_HINT";
export const PROVIDER_ROUTE_PRODUCTION_HINT = `[PORT NOTE — non-Claude model route]
You are running on a smaller, slower model than this studio was tuned for. Work economically:
- Do not study engine source code. The engine's own docs are enough: the EDL format is in \`$VIDEOCLAW_ENGINE/skills/primitives/assemble.md\` and every tool documents itself with \`--help\`. Use at most about eight read-only exploration commands before producing.
- An edit of the user's own footage with no paid tools is fully local: copy the inputs into \`jobs/<id>/footage/\` (video) and \`jobs/<id>/audio/\` (music or voice), write \`jobs/<id>/edl.json\`, run \`assemble.py --job <id> --check\`, then \`assemble.py --job <id>\`, then \`compose_render.py --job <id> --mode render --no-captions --no-overlays\` (choose \`--resolution\` to match the requested size). The delivered file is \`jobs/<id>/final.mp4\`.
- Use the launcher from CLAUDE.md for every engine tool. If a tool refuses, read its message and fix the cause instead of exploring further.`;
export function providerRouteHint(llmRoute: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env[PORT_ROUTE_HINT_ENV] === "0") return "";
  return llmRoute === "claude-code" || llmRoute === "gateway" ? "" : PROVIDER_ROUTE_PRODUCTION_HINT;
}
