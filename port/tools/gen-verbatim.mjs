// PORT-NEW generator: emits TypeScript modules that are VERBATIM line slices of the shipped
// main process (app/reconstructed/main/index.js, the prettier-formatted app/out/main/index.js)
// or a shipped chunk, plus an explicit, reviewed list of textual substitutions (each one a
// platform-layer routing, e.g. `.venv/bin/python` → venvPython()). Slices are located by
// anchor regexes, not hard-coded line numbers, and the emitted header records the lines.
// test/verbatim.test.ts re-runs the generator in memory and asserts the files are current.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const portRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(portRoot, "..");
const SRC = {
  main: "app/reconstructed/main/index.js",
  wb: "app/out/main/chunks/workbookContents-ChzKjQX1.js",
  rm: "app/out/main/chunks/rangeMedia-848zXGXe.js",
  ce: "app/out/main/chunks/compositionEdit-Dc8_ecez.js",
  hfw: "app/out/main/hyperframesPreviewWorker.js",
  hfp: "app/out/main/hyperframesPolicyWorker.js",
};
const lines = Object.fromEntries(Object.entries(SRC).map(([k, f]) => [k, readFileSync(join(repo, f), "utf8").split(/\r?\n/)]));

function find(src, re, from = 0) {
  const i = lines[src].findIndex((l, n) => n >= from && re.test(l));
  if (i < 0) throw new Error(`anchor not found in ${SRC[src]}: ${re}`);
  return i;
}
/** [start, end] inclusive, end = first line matching `endRe` at/after start (inclusive). */
function slice(src, startRe, endRe, afterRe) {
  const s = find(src, startRe);
  const e = find(src, endRe, afterRe ? find(src, afterRe, s) : s);
  return { src, s, e, text: lines[src].slice(s, e + 1).join("\n") };
}

/** [start, stop) — from the line matching `startRe` up to (not including) the first `stopRe` line after it, or EOF. */
function sliceUntil(src, startRe, stopRe) {
  const s = find(src, startRe);
  let e = lines[src].length - 1;
  if (stopRe) e = find(src, stopRe, s + 1) - 1;
  while (e > s && lines[src][e].trim() === "") e--;
  return { src, s, e, text: lines[src].slice(s, e + 1).join("\n") };
}

export const SPECS = [
  {
    // docs/31: the ORIGINAL AgentGatewayProxy (L28672-30374) with its refusal copy and request helpers
    // (L28134-28671), the provider-origin host guard it uses for media pulls (L19897-19918, L19992-20010),
    // gatewayRefusalCopy (L1283-1303) and the wb-chunk spend/passthrough constants. Replaces the docs/29 shape port:
    // session capabilities (vcs_), operation context, local spending admission, exact quotes / permits, durable
    // operation identity and child-job scoping are now the shipped code, run against the self-hosted shim.
    out: "src/main/gateway/agent-gateway-proxy.generated.ts",
    imports: [
      'import { once } from "node:events";',
      'import { createServer, request as request$1 } from "node:http";',
      'import { request } from "node:https";',
      'import { createHash, randomBytes } from "node:crypto";',
      'import { isClientJobId } from "../engine/session";',
      'import { envForGatewayUrl } from "../account/account-gateway.generated";',
      'import { policyRefusalMessage } from "../agent/session-assembly.generated";',
      'import { providerCapabilityLabel } from "../agent/history.generated";',
    ],
    slices: () => [
      slice("wb", /^const SPEND_APPROVAL_PENDING_CODE = /, /^const SPEND_AUTHORITY_REQUIRED_CODE = /),
      slice("wb", /^const ANTHROPIC_PASSTHROUGH_PATH = /, /^}$/),
      slice("wb", /^const PROVIDER_GUIDANCE = \{/, /^}$/, /^function upstreamUnavailableRefusal\(/),
      slice("main", /^const FEATURE_FLAG_REASON_COPY = \{/, /^}$/, /^function gatewayRefusalCopy\(code\) \{/),
      slice("main", /^const PROVIDER_SERVICE_PATTERNS = \[/, /^\];$/),
      sliceUntil("main", /^const PROVIDER_BARE_NAME_PATTERNS = \[/, /^const PROVIDER_SERVICE_RE = /),
      sliceUntil("main", /^const UNMETERED_ACQUISITION_REFUSAL =/, /^const QUICKSTART_RENDERER_LATENCY_STAGES = /),
    ],
    subs: [],
    exports: ["AgentGatewayProxy", "GatewayHttpError", "UpstreamGatewayHttpError", "PROVIDER_CREDENTIAL_CODE", "GATEWAY_CANCEL_REASON", "NON_RETRYABLE_REFUSAL_CODES", "SPEND_APPROVAL_PENDING_CODE", "SPEND_AUTHORITY_REQUIRED_CODE", "SPEND_APPROVAL_PENDING_MESSAGE", "SPEND_POLICY_CONFLICT_MESSAGE", "isAnthropicPassthroughPath", "isUnknownCostQuote", "UNKNOWN_COST_POLICY", "ESTIMATED_SETTLEMENT_POLICY", "EXACT_OPERATION_MEDIA_TYPE", "MAX_BODY_BYTES", "bearer", "UNKNOWN_COST_APPROVAL_REQUIRED", "gatewayRefusalCopy", "FEATURE_FLAG_REASON_COPY"],
  },
  {
    out: "src/main/engine/session-context.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { existsSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { BANNED_USER_FACING_VOCABULARY, VOICE_GUARD } from "./voice-guard";',
      'import { venvPython } from "../platform";',
    ],
    slices: () => [
      slice("main", /^const SESSION_LAWS_VERSION = /, /^}$/ /* end of parseSessionLawsVersion */),
      slice("main", /^const REQUIRED_SESSION_CONTEXT_FILES = \{/, /^};$/),
      slice("main", /^class SessionContextError extends Error \{/, /^}$/, /^function assertEnginePython\(/),
    ],
    subs: [
      // assertEnginePython: the engine venv interpreter path differs on win32 (.venv\Scripts\python.exe).
      ['existsSync(join(engineDir, ".venv", "bin", "python"))', "existsSync(venvPython(engineDir))", 1],
    ],
    exports: ["REQUIRED_SESSION_CONTEXT_FILES", "SessionContextError", "PORTABLE_ENGINE_ROOT", "validateCanonicalSettings", "parseSessionLawsVersion", "readRequired", "sourceHashes", "validateEngineSessionContext", "validateInstalledEngineSessionContext", "ENGINE_PYTHON_PROBLEM", "assertEnginePython", "sha256$4 as sessionSha256"],
  },
  {
    out: "src/main/engine/money-compat.generated.ts",
    imports: [
      'import { execFile } from "node:child_process";',
      'import { existsSync, statSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { venvPython } from "../platform";',
    ],
    slices: () => [
      slice("wb", /^const PAID_GEN_TOOLS = \[/, /^\];$/),
      slice("wb", /^function unpricedPaidGenTools\(/, /^}$/),
      slice("main", /^const BILLING_CLI_CONTRACT_SCHEMA = /, /^const compatibilityCache = /),
      slice("main", /^function stringArray\(value\)/, /^async function assertEngineMoneyCompatibility\(/),
      slice("main", /^  const result = await inspectEngineMoneyCompatibility\(enginePath\);/, /^}$/),
    ],
    subs: [
      ['join(enginePath, ".venv", "bin", "python")', "venvPython(enginePath)", 2],
    ],
    exports: ["PAID_GEN_TOOLS", "unpricedPaidGenTools", "billingCliCapabilities", "PRICE_SURFACE_DUMP", "inspectEngineMoneyCompatibility", "cachedEngineMoneyCompatibility", "EngineMoneyCompatibilityError", "assertEngineMoneyCompatibility"],
  },
  {
    out: "src/main/engine/production-contract.generated.ts",
    imports: ['import { readFileSync } from "node:fs";', 'import { join } from "node:path";'],
    slices: () => [
      slice("main", /^const PRODUCTION_VERDICT_SCHEMA = /, /^const ROUTE_RECEIPT_SCHEMA = /),
      slice("main", /^function exactPythonConstant\(/, /^}$/, /^function assertInstalledEngineProductionContract\(/),
    ],
    subs: [],
    exports: ["PRODUCTION_VERDICT_SCHEMA", "PRODUCTION_ANALYZER", "ROUTE_RECEIPT_SCHEMA", "exactPythonConstant", "inspectInstalledEngineProductionContract", "assertInstalledEngineProductionContract"],
  },
  {
    // PORT (docs/21 M2): the app-owned session context the original injects into every local
    // Claude Code session (systemPrompt.append) + the workspace CLAUDE.md / execution contract.
    out: "src/main/agent/session-assembly.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { existsSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { VOICE_GUARD } from "../engine/voice-guard";',
      'import { readRequired, sourceHashes, sessionSha256 as sha256$4, SessionContextError } from "../engine/session-context.generated";',
      'import { venvPython } from "../platform";',
    ],
    slices: () => [
      slice("main", /^const POLICY_REFUSAL_MARKER = /, /^}$/, /^function isPolicyRefusalMessage\(/),
      slice("main", /^const CHARACTER_VOICE_GUIDANCE = /, /^}$/, /^function assembleSessionContext\(/),
      slice("main", /^const ENGINE_PYTHON_PROBLEM = /, /^}$/, /^function legacyDevSessionContext\(/),
      slice("main", /^const WORKSPACE_LAUNCHER_LINE = /, /^}$/, /^function migrateWorkspaceClaudeMd\(/),
      slice("main", /^function permissionModeMeaning\(/, /^}$/),
      slice("main", /^const JOB_RE = /, /^const JOB_RE = /),
      slice("main", /^const PRIOR_WORK_REFERENCE = /, /^}$/, /^function classifyPriorWorkIntent\(/),
      slice("main", /^function deriveTitle\(/, /^}$/),
      slice("main", /^function deterministicJobId\(/, /^}$/),
    ],
    subs: [
      ['existsSync(join(engineDir, ".venv", "bin", "python"))', "existsSync(venvPython(engineDir))", 1],
    ],
    exports: ["POLICY_REFUSAL_MARKER", "policyRefusalMessage", "isPolicyRefusalMessage", "CHARACTER_VOICE_GUIDANCE", "ENGINE_TOOL_LAUNCHER", "ENGINE_PIPE_RULE", "PROJECT_MEMORY_GUIDANCE", "ACCOUNT_PREFERENCE_GUIDANCE", "WORKFLOW_ADVISOR_GUIDANCE", "workflowIndexSection", "assembleSessionContext", "assertEnginePython", "assembleLocalSessionContext", "legacyDevSessionContext", "EXECUTION_CONTRACT_MARKER", "EXECUTION_CONTRACT", "workspaceClaudeMd", "migrateWorkspaceClaudeMd", "permissionModeMeaning", "JOB_RE", "classifyPriorWorkIntent", "deriveTitle", "deterministicJobId"],
  },
  {
    // PORT (docs/21 M2): the ORIGINAL production permission model for agent Bash — the engine's
    // production_guard.py --verdict-json analyzer + authorizeProductionCommand + app-owned refusals.
    out: "src/main/agent/production-auth.generated.ts",
    imports: [
      'import { spawn } from "node:child_process";',
      'import { createHash } from "node:crypto";',
      'import { existsSync } from "node:fs";',
      'import { isAbsolute, join, resolve } from "node:path";',
      'import { venvPython } from "../platform";',
      'import { policyRefusalMessage } from "./session-assembly.generated";',
      'import { classifyProductionCommand, buildInputBoundExecutionPlan, processStore } from "./production-auth-unported";',
    ],
    slices: () => [
      slice("main", /^const ENGINE_TO_GATEWAY_TOOL = /, /^};$/, /^const FEATURE_FLAG_REASON_COPY = /),
      slice("main", /^function featureFlagDecision\(/, /^}$/),
      slice("main", /^const PYTHON_MISSING_REASON =/, /^}$/, /^function checkProductionVerdict\(/),
      slice("main", /^const JOB_ID_RE\$1 = /, /^const BOUND_JOB_ENV = /),
      slice("main", /^const PROTECTED_TOOLS = /, /^\]\);$/),
      slice("main", /^const READ_ONLY_MODES = \{/, /^};$/),
      slice("main", /^function productionVerdictNeedsInputBinding\(/, /^}$/),
      slice("main", /^function argValue\(/, /^}$/),
      slice("main", /^function sha256\$2\(/, /^}$/, /^async function authorizeProductionCommand\(/),
      slice("main", /^const PYTHON_HELPER = /, /^}$/, /^function appOwnedVideoCommandRefusal\(/),
      slice("main", /^const FINAL_RENDER_TIMEOUT_MS = /, /^}$/, /^function withFinalRenderWindow\(/),
    ],
    subs: [
      ['const python = join(engine, ".venv", "bin", "python");', "const python = venvPython(engine);", 1],
    ],
    exports: ["PRODUCTION_VERDICT_SCHEMA", "PRODUCTION_ANALYZER", "parseProductionVerdictResult", "checkProductionVerdict", "BOUND_JOB_ENV", "PROTECTED_TOOLS", "READ_ONLY_MODES", "productionVerdictNeedsInputBinding", "argValue", "blockedGatewayToolForVerdict", "authorizeProductionCommand", "AUTOMATIC_ENGINE_STEP_REFUSAL", "appOwnedVideoCommandRefusal", "FINAL_RENDER_TIMEOUT_MS", "verdictRunsFinalRender", "verdictRunsVerifiedEngineTool", "withFinalRenderWindow"],
  },
  {
    // docs/21 M1: account:snapshot (L61406) — the pure snapshot builder from the shipped chunk.
    out: "src/main/account-snapshot.generated.ts",
    imports: [],
    slices: () => [
      slice("wb", /^const ALPHA_TERMS_VERSION = /, /^}$/, /^function buildAccountSnapshot\(/),
    ],
    subs: [],
    exports: ["ALPHA_TERMS_VERSION", "canAcceptTerms", "ACCOUNT_CAPABILITIES", "accountCapabilitiesFrom", "canUseNightlyUpdates", "accountStateFrom", "onboardingStep", "keyVerificationRetry", "buildAccountSnapshot"],
  },
  {
    // docs/22 M3: the channel-workspace containment checks the version store / attachments rely on.
    out: "src/main/jobs/workspace-boundary.generated.ts",
    imports: [
      'import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";',
      'import { isAbsolute, join, relative, resolve, sep } from "node:path";',
    ],
    slices: () => [
      slice("main", /^function pathIsWithin\$1\(root, candidate\) \{/, /^}$/, /^function assertRealWorkspaceFile\(/),
    ],
    subs: [],
    exports: ["pathIsWithin$1 as workspacePathIsWithin", "workspaceRootIdentity", "assertRealWorkspaceDirectory", "ensureRealWorkspaceDirectory", "assertRealWorkspaceFile"],
  },
  {
    // docs/22 M3: VersionStore (L13344) + its registry claim/ops, scanJob (L14365) and JobWatcher (L14717).
    out: "src/main/jobs/version-store.generated.ts",
    imports: [
      'import { createHash, randomUUID } from "node:crypto";',
      'import { closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, ftruncateSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, watch, writeFileSync, writeSync } from "node:fs";',
      'import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";',
      'import { assertRealWorkspaceDirectory, assertRealWorkspaceFile, ensureRealWorkspaceDirectory } from "./workspace-boundary.generated";',
    ],
    slices: () => [
      slice("main", /^const CLAIM_SCHEMA = "videoclaw\.version-registry-claim\/v1";/, /^}$/, /^class JobWatcher \{/),
    ],
    subs: [],
    exports: ["readRenderRecords", "isFinishedMp4", "hashStableFile", "presentedVersions", "currentFinalRecord", "readRegistryStrict", "VersionStore", "scanJob", "resolveCut", "FINAL_CANDIDATE_SETTLE_MS", "JobWatcher"],
  },
  {
    // docs/22 M3: vcmedia:// — the shipped rangeMedia chunk, MediaCapabilityRegistry (L10944), mediaFailure (L60433).
    out: "src/main/media/media.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { lstatSync, realpathSync } from "node:fs";',
      'import { extname, isAbsolute, normalize as normalize$2, relative } from "node:path";',
    ],
    slices: () => [
      slice("rm", /^const MIME = \{/, /^}$/, /^function planMediaResponse\(/),
      slice("main", /^function exactPath\(filePath\) \{/, /^}$/, /^class MediaCapabilityRegistry \{/),
      slice("main", /^function mediaFailure\(state\) \{/, /^}$/),
    ],
    subs: [],
    exports: ["VCMEDIA_SCHEME", "mimeFor", "planMediaResponse", "exactPath", "mediaFileIdentity", "inspectedFile", "MediaCapabilityRegistry", "mediaFailure"],
  },
  {
    // docs/22 M4: the asset-kind / intake / workbook-page helpers of the shipped workbookContents chunk.
    out: "src/main/attachments/asset-kinds.generated.ts",
    imports: [],
    slices: () => [
      slice("wb", /^const VIDEO_EXTS = /, /^const CLIPBOARD_IMAGE_MAX_PIXELS = /),
      slice("wb", /^const WORKBOOK_SCHEMA = /, /^}$/, /^function workbookSummary\(/),
    ],
    subs: [],
    exports: ["assetExt", "assetKind", "isWorkbookName", "isPdfName", "isAcceptedAsset", "assetRejectReason", "INTAKE_FOLDER_MAX_DEPTH", "INTAKE_FOLDER_MAX_FILES", "INTAKE_FOLDER_MAX_BYTES", "INTAKE_FOLDER_MAX_VISITS", "folderRejectReason", "archiveRejectReason", "ARCHIVE_MAX_WORKBOOKS", "ARCHIVE_MAX_PDFS", "WORKBOOK_MAX_OUTPUT_BYTES", "PDF_MAX_BYTES", "PDF_MAX_PAGES", "PDF_MAX_TEXT_CHARS", "workbookRejectReason", "CLIPBOARD_IMAGE_MAX_BYTES", "CLIPBOARD_IMAGE_MAX_PIXELS", "isWorkbookContents", "workbookPage", "workbookSummary"],
  },
  {
    // docs/22 M4: ComposerAttachmentStore (L16681) + intake copy helpers (L11240-11407), HEIC (L11525),
    // clipboard/PDF context helpers (L16364-16680), composerTurnMessageUuid (L1194).
    out: "src/main/attachments/composer-attachments.generated.ts",
    imports: [
      'import { execFile } from "node:child_process";',
      'import { createHash, randomUUID } from "node:crypto";',
      'import { chmodSync, closeSync, constants, copyFileSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";',
      'import { copyFile, link, open, rm } from "node:fs/promises";',
      'import { basename, dirname, extname, join, resolve } from "node:path";',
      'import { promisify } from "node:util";',
      'import { mediaFileIdentity } from "../media/media.generated";',
      'import { extractArchive } from "./attachments-unported";',
      'import { ARCHIVE_MAX_PDFS, ARCHIVE_MAX_WORKBOOKS, archiveRejectReason, assetKind, assetRejectReason, CLIPBOARD_IMAGE_MAX_BYTES, CLIPBOARD_IMAGE_MAX_PIXELS, folderRejectReason, INTAKE_FOLDER_MAX_BYTES, INTAKE_FOLDER_MAX_DEPTH, INTAKE_FOLDER_MAX_FILES, INTAKE_FOLDER_MAX_VISITS, isAcceptedAsset, isPdfName, isWorkbookContents, isWorkbookName, PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MAX_TEXT_CHARS, WORKBOOK_MAX_OUTPUT_BYTES, workbookPage, workbookRejectReason, workbookSummary } from "./asset-kinds.generated";',
    ],
    slices: () => [
      slice("main", /^function voiceNoteClock\(seconds\) \{/, /^}$/),
      slice("main", /^function sha256Utf8\(value\) \{/, /^}$/),
      slice("main", /^function composerTurnMessageUuid\(_sessionId, clientTurnId\) \{/, /^}$/),
      slice("main", /^const PROGRESS_INTERVAL_MS = 100;/, /^}$/, /^function friendlyCopyError\(err\) \{/),
      slice("main", /^const execFileP = promisify\(execFile\);/, /^}$/, /^async function convertHeicToJpg\(/),
      slice("main", /^const PNG_SIGNATURE = /, /^}$/, /^class ComposerAttachmentStore \{/),
    ],
    subs: [],
    exports: ["voiceNoteClock", "sha256Utf8", "composerTurnMessageUuid", "expandIntakeFolder", "streamCopyFile", "streamCopyFileTo", "HEIC_RE$1", "convertHeicToJpg", "friendlyCopyError", "fileSha256", "isClipboardPng", "clipboardImageIntakeFile", "sweepClipboardImageIntake", "attachmentContextLines", "ComposerAttachmentStore"],
  },
  {
    // docs/24 (B): characters:list (L61860) → host.listCharacters → the ORIGINAL CharacterStore (L11564-11792).
    out: "src/main/characters/character-store.generated.ts",
    imports: [
      'import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";',
      'import { join, resolve } from "node:path";',
      'import { assetKind } from "../attachments/asset-kinds.generated";',
      'import { convertHeicToJpg, HEIC_RE$1, streamCopyFile } from "../attachments/composer-attachments.generated";',
    ],
    slices: () => [
      slice("main", /^const META = "meta\.json";$/, /^}$/, /^class CharacterStore \{/),
    ],
    subs: [],
    exports: ["META", "SHEET", "REFS", "PENDING", "CharacterStore"],
  },
  {
    // docs/24 (C1): quickstart:catalog (L61215) → the ORIGINAL QuickstartCatalogStore (L30772) with its
    // validation (validateRawCatalog / validateRoot), latency ring and channel verifier (L30375-31373),
    // canonicalStudioJson (L1213) and the build-channel gateway helpers (workbookContents chunk).
    out: "src/main/quickstart/quickstart-catalog.generated.ts",
    imports: [
      'import { createHash, createPublicKey, verify } from "node:crypto";',
      'import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";',
      'import { dirname, join, resolve } from "node:path";',
      'import { isDeepStrictEqual } from "node:util";',
    ],
    slices: () => [
      slice("wb", /^const PROD_GATEWAY_URL = /, /^const STAGING_GATEWAY_URL = /),
      slice("wb", /^const normalizeGatewayUrl = /, /^const normalizeGatewayUrl = /),
      slice("wb", /^function envForGatewayUrl\(/, /^}$/),
      slice("main", /^function canonicalStudioJson\(value\) \{/, /^}$/),
      slice("main", /^const QUICKSTART_RENDERER_LATENCY_STAGES = \[/, /^}$/, /^class QuickstartCatalogStore \{/),
    ],
    subs: [],
    exports: ["envForGatewayUrl", "recordQuickstartLatency", "beginQuickstartLatency", "measureQuickstartLatency", "quickstartLatencySnapshot", "quickstartLatencyMark", "milestoneDurationMs", "validateRawCatalog", "validateRoot", "sameQuickstartCatalogView", "QuickstartCatalogStore"],
  },
  {
    // docs/24 (C2): session titles — NEW_VIDEO_TITLE (L266), redact (L1966-1994), sessionTitleText (L22987),
    // fallbackSessionTitle (L34758). proposeSessionTitle (L23002) itself is claude-code-only (see session-title.ts).
    out: "src/main/agent/session-title.generated.ts",
    imports: ['import { deriveTitle } from "./session-assembly.generated";'],
    slices: () => [
      slice("main", /^const NEW_VIDEO_TITLE = "New video";$/, /^const NEW_VIDEO_TITLE = /),
      slice("main", /^const REDACTIONS = \[$/, /^}$/, /^function redact\(serialized\) \{/),
      slice("main", /^function sessionTitleText\(text2\) \{/, /^}$/),
      slice("main", /^function fallbackSessionTitle\(text2\) \{/, /^}$/),
    ],
    subs: [],
    exports: ["NEW_VIDEO_TITLE", "REDACTIONS", "redact", "sessionTitleText", "fallbackSessionTitle"],
  },
  {
    // docs/25: session:history transcript replay (getHistory L43698) — the ORIGINAL display-transcript
    // sidecar (display-transcripts/<id>.jsonl, L52942-53223), historyToEvents (L53433) + its helpers,
    // the engine-profile SessionStore / raw transcript reader inputs (visibleInSdkHistory,
    // rejectedFallbackMessageIds) and the workbookContents ClaudeCodeMessageAdapter (L3851-4049).
    out: "src/main/agent/history.generated.ts",
    imports: [
      'import { createHash, randomUUID } from "node:crypto";',
      'import { appendFileSync, mkdirSync, readFileSync } from "node:fs";',
      'import { dirname, join } from "node:path";',
      'import { POLICY_REFUSAL_MARKER, isPolicyRefusalMessage } from "./session-assembly.generated";',
    ],
    slices: () => [
      slice("main", /^function isProviderPolicyRefusalMessage\(/, /^}$/),
      slice("main", /^function isProjectMemoryNotice\(/, /^}$/, /^function isAccountPreferenceNotice\(/),
      slice("main", /^const FAMILIES = /, /^}$/, /^function isSettledAskRecord\(/),
      slice("main", /^const ORIGINS = /, /^}$/, /^function isSessionMaterial\(/),
      slice("main", /^const PROVIDER_REFUSAL_KINDS = /, /^const UNSAFE_RUNS = /),
      slice("main", /^const LATE_RESULT_OUTCOMES = /, /^}$/, /^function validProviderText\(/),
      slice("main", /^const lateResultKey = /, /^const lateResultKey = /),
      slice("wb", /^const SPEND_APPROVAL_PENDING_CODE = /, /^const SPEND_AUTHORITY_REQUIRED_CODE = /),
      slice("wb", /^const GENERIC_ACTIVITY = /, /^}$/, /^function cleanSubject\(/),
      slice("wb", /^const STALE_RESUME_RE = /, /^}$/, /^function providerFailureCopy\(/),
      slice("wb", /^const VIDEOCLAW_CREDIT_GUIDANCE = /, /^};$/, /^const PROVIDER_GUIDANCE = \{/),
      slice("wb", /^const CLAUDE_CODE_INTERNAL_PLAN_TOOLS = \[/, /^}$/, /^class ClaudeCodeMessageAdapter \{/),
      slice("main", /^const SERVER_CLASSIFIER = /, /^}$/, /^function autoModeNoVerdict\(/),
      slice("main", /^const DISPLAY_TURN_ID_RE =$/, /^}$/, /^function isDisplayTurnId\(/),
      slice("main", /^function imagePathOf\(name, input\)/, /^}$/, /^function isRealUserText\(/),
    ],
    subs: [],
    exports: ["displayTranscriptPath", "engineMessageSha256", "sdkUserMessageText", "appendDisplayTranscript", "appendDisplayStop", "isDisplayTurnId", "readDisplayTranscript", "visibleInSdkHistory", "rejectedFallbackMessageIds", "isFlattenedClaudeCompactedHistory", "historyToEvents", "legacyDisplayText", "isRealUserText", "engineFamilyLine", "friendlyToolLine", "appendDisplayMaterial", "isSessionMaterial", "errorCauses", "classifyError", "sanitizeErrorText", "providerMessage", "providerFailureKind", "providerCapabilityLabel", "QUOTA_EXHAUSTED", "isRuntimeAuthFailure", "appendDisplayAsk", "appendDisplayPreference"],
  },

  {
    // docs/25: taste:list / taste:commit / taste:decline (L61843-61852) → the ORIGINAL taste module
    // (COMMITMENTS / ANTI-COMMITMENTS markdown, proposals ledger; L15178-15491).
    out: "src/main/taste/taste.generated.ts",
    imports: [
      'import { randomUUID } from "node:crypto";',
      'import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";',
      'import { dirname, join } from "node:path";',
      'import { recordMainLog } from "./taste-log";',
    ],
    slices: () => [
      slice("main", /^const SECTION = "## COMMITMENTS";$/, /^}$/, /^function declineProposal\(/),
    ],
    subs: [],
    exports: ["SECTION", "ANTI", "ANTI_HEADING", "readCommitments", "writeCommitments", "appendAnti", "listTaste", "commitTaste", "declineProposal", "saveAccountCommitment"],
  },
  {
    // docs/25: stats:stageEtas (L62297) → the ORIGINAL computeStageEtas (L55510-55583).
    out: "src/main/jobs/stage-etas.generated.ts",
    imports: [
      'import { existsSync, readdirSync, readFileSync } from "node:fs";',
      'import { homedir } from "node:os";',
      'import { join } from "node:path";',
      'import { engineFamilyLine } from "../agent/history.generated";',
    ],
    slices: () => [
      slice("main", /^const MIN_SAMPLES = 6;$/, /^}$/, /^function computeStageEtas\(/),
    ],
    subs: [],
    exports: ["computeStageEtas"],
  },
  // ── docs/26 (M9): the remaining local / no-credential channels ──
  {
    // session:deletionPlan / session:delete (L61732-61746 → planProjectDeletion L39205 / deleteProject L39248):
    // the ORIGINAL workspace trash (L14786-15174) + deletionBlockMessage (L339).
    out: "src/main/jobs/project-trash.generated.ts",
    imports: [
      'import { randomUUID } from "node:crypto";',
      'import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";',
      'import { lstat, readdir, rm } from "node:fs/promises";',
      'import { dirname, isAbsolute, join, relative, resolve } from "node:path";',
    ],
    slices: () => [
      slice("main", /^function deletionBlockMessage\(block\) \{/, /^}$/),
      slice("main", /^const PROJECT_TRASH_DIR = /, /^}$/, /^async function purgeExpiredProjectTrash\(/),
    ],
    subs: [],
    exports: ["deletionBlockMessage", "PROJECT_TRASH_DIR", "PROJECT_TRASH_SCHEMA", "PROJECT_TRASH_RETENTION_MS", "pathIsWithin", "planProjectTrash", "moveProjectToTrash", "readTrashEntry", "purgeExpiredProjectTrash"],
  },
  {
    // library:stats/scan/addSource/removeSource/preview (L62065-62153): the ORIGINAL engine library CLI
    // wrappers (tools/index_media.py, L16044-16362) + the mutation gate (L55792-55809).
    out: "src/main/library/library.generated.ts",
    imports: [
      'import { spawn } from "node:child_process";',
      'import { createHash, randomUUID } from "node:crypto";',
      'import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";',
      'import { homedir } from "node:os";',
      'import { join } from "node:path";',
      'import { classifyError, engineSessionEnv, errorCauses, EXTRA_PATHS, sanitizeErrorText, UV_PYTHON_POLICY_ENV } from "./library-env";',
    ],
    slices: () => [
      slice("main", /^const COMMAND_BROKER_AMBIENT_ALLOWLIST = /, /^}$/, /^async function libraryPreview\(/),
      slice("main", /^const BUSY_MESSAGE = \{$/, /^}$/, /^function createLibraryMutationGate\(/),
    ],
    subs: [],
    exports: ["commandBrokerEnv", "CLOUD_ROOT", "resolveEngineRoot", "engineEnv", "runEngine", "libraryErrorMessage", "libraryStats", "libraryScan", "libraryAddSource", "libraryRemoveSource", "librarySync", "librarySearch", "libraryPreview", "libraryKey", "createLibraryMutationGate"],
  },
  {
    // attachment:captureMoment / attachment:momentPreview (L62220-62255): stageVideoMoment + videoMomentThumbnail (L55584-55676).
    out: "src/main/attachments/video-moment.generated.ts",
    imports: [
      'import { randomUUID } from "node:crypto";',
      'import { mkdirSync, rmSync, writeFileSync } from "node:fs";',
      'import { basename, join } from "node:path";',
      'import { CLIPBOARD_IMAGE_MAX_BYTES } from "./asset-kinds.generated";',
      'import { fileSha256, friendlyCopyError, isClipboardPng } from "./composer-attachments.generated";',
    ],
    slices: () => [
      slice("main", /^async function stageVideoMoment\(request2, context\) \{/, /^}$/, /^function videoMomentThumbnail\(/),
    ],
    subs: [],
    exports: ["stageVideoMoment", "videoMomentThumbnail"],
  },
  {
    // attachment:voiceNote (L62265-62271): voiceNoteIntakeFile (L10535) + its audio checks (L10503-10534),
    // VOICE_NOTE_* (L282-283) and the transcription error copy (L10451-10464).
    out: "src/main/attachments/voice-note.generated.ts",
    imports: [
      'import { execFile } from "node:child_process";',
      'import { existsSync } from "node:fs";',
      'import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'import { voiceNoteClock } from "./composer-attachments.generated";',
      'import { voiceTools } from "./voice-tools";',
    ],
    slices: () => [
      slice("main", /^const VOICE_NOTE_MAX_BYTES = /, /^const VOICE_NOTE_MAX_SECONDS = /),
      slice("main", /^const errors = \{$/, /^};$/),
      slice("main", /^function isVoiceNoteAudio\(audio\) \{/, /^}$/, /^async function voiceNoteIntakeFile\(/),
    ],
    subs: [],
    exports: ["VOICE_NOTE_MAX_BYTES", "VOICE_NOTE_MAX_SECONDS", "errors as voiceErrors", "isVoiceNoteAudio", "wavSeconds", "voiceNoteIntakeFile"],
  },
  {
    // hfPreview:* composition helpers — the shipped compositionEdit chunk (parseComposition / applyTextEdit), whole file.
    out: "src/main/hyperframes/composition-edit.generated.ts",
    imports: [],
    slices: () => [sliceUntil("ce", /^function attr\(html, name\) \{/, /^export \{$/)],
    subs: [],
    exports: ["parseComposition", "applyTextEdit"],
  },
  {
    // hfPreview:available/start/stop/editApply (L62437-62445): HyperframesPreviewController (L56487-56842) +
    // validateInPolicyWorker (L56848-56878).
    out: "src/main/hyperframes/hf-preview.generated.ts",
    imports: [
      'import { randomBytes } from "node:crypto";',
      'import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";',
      'import { resolveJobBoundary } from "../engine/job-boundary";',
      'import { applyTextEdit, parseComposition } from "./composition-edit.generated";',
    ],
    slices: () => [
      slice("main", /^const START_TIMEOUT_MS = 1e4;$/, /^}$/, /^class HyperframesPreviewController \{/),
      slice("main", /^const POLICY_TIMEOUT_MS = 5e3;$/, /^}$/, /^function validateInPolicyWorker\(/),
    ],
    subs: [],
    exports: ["PREVIEW_ERROR", "EDIT_ERROR", "HyperframesPreviewController", "validateInPolicyWorker"],
  },
  {
    // utilityProcess worker out/main/hyperframesPreviewWorker.js (whole file; rangeMedia import → media.generated).
    out: "src/main/workers/hf-preview-worker.generated.ts",
    imports: [
      'import { createServer } from "node:http";',
      'import { existsSync, realpathSync, statSync, createReadStream } from "node:fs";',
      'import { resolve, normalize, relative, sep } from "node:path";',
      'import { planMediaResponse } from "../media/media.generated";',
    ],
    slices: () => [sliceUntil("hfw", /^const MIME = \{$/, /^export \{$/)],
    subs: [],
    exports: ["startPreviewServer"],
  },
  {
    // utilityProcess worker out/main/hyperframesPolicyWorker.js (whole file).
    out: "src/main/workers/hf-policy-worker.generated.ts",
    imports: [
      'import { realpathSync, statSync, readFileSync, lstatSync, readdirSync } from "node:fs";',
      'import { resolve, extname, relative, sep } from "node:path";',
      'import { parseComposition } from "../hyperframes/composition-edit.generated";',
    ],
    slices: () => [sliceUntil("hfp", /^const TEXT_EXTENSIONS = /, null)],
    subs: [],
    exports: ["validatePreviewComposition"],
  },
  {
    // materials:preview (L62197) → host.materialPreview (L44876) over the ORIGINAL MaterialsLedger (L18107-18352)
    // + materialKindForName (L1884-1895).
    out: "src/main/materials/materials-ledger.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";',
      'import { basename, dirname, join, resolve, sep } from "node:path";',
      'import { isSessionMaterial } from "../agent/history.generated";',
    ],
    slices: () => [
      slice("main", /^const MATERIALS_LEDGER_LIMIT = 200;$/, /^}$/, /^function materialKindForName\(/),
      slice("main", /^const JOURNAL_VERSION = 1;$/, /^}$/, /^function fileTimeMs\(/),
    ],
    subs: [],
    exports: ["MATERIALS_LEDGER_LIMIT", "materialKindForName", "ledgerPath", "materialIdForPath", "MaterialsLedger", "quickstartReceipts"],
  },
  {
    // normalizeSpendCeilingUsd (workbookContents chunk L8-16).
    out: "src/main/spend/spend-wb.generated.ts",
    imports: [],
    slices: () => [slice("wb", /^function normalizeSpendCeiling\(usd\) \{/, /^const normalizeSpendCeilingUsd = /)],
    subs: [],
    exports: ["normalizeSpendCeiling", "normalizeSpendCeilingUsd"],
  },
  {
    // feedback:capture / feedback:discard (L62342-62349) → the ORIGINAL FeedbackService (L57059-57393) +
    // feedbackConsentState (L1180) + redact (L1975). feedback:submit stays (b): outbox → gateway.
    out: "src/main/feedback/feedback.generated.ts",
    imports: [
      'import { app } from "electron";',
      'import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";',
      'import { version } from "node:os";',
      'import { join } from "node:path";',
      'import { currentEngine, mainLogSnapshot, recordMainLog } from "./feedback-env";',
      'import { classifyError } from "../agent/history.generated";',
    ],
    slices: () => [
      slice("main", /^function feedbackConsentState\(inputs\) \{/, /^}$/),
      slice("main", /^const REDACTIONS = \[$/, /^}$/, /^function redact\(serialized\) \{/),
      sliceUntil("main", /^const FEEDBACK_LIMITS = \{$/, /^async function sendBlockedFeedback\(/),
    ],
    subs: [],
    exports: ["feedbackConsentState", "redact", "FEEDBACK_LIMITS", "buildFeedbackBundle", "FeedbackService"],
  },
  {
    // account:localResetPrepare / account:localResetCommit (L61497-61498) → the ORIGINAL LocalResetController
    // (L5826) + runPendingLocalReset (L5960) + helpers (L5650-6162) + LOCAL_RESET_REFUSAL_COPY (L638).
    out: "src/main/account/local-reset.generated.ts",
    imports: [
      'import { randomUUID } from "node:crypto";',
      'import { accessSync, chmodSync, closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";',
      'import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";',
      'import { CredentialStore, CredentialStoreError, sanitizeErrorText } from "./local-reset-env";',
    ],
    slices: () => [
      slice("main", /^const LOCAL_RESET_REFUSAL_COPY = \{$/, /^};$/),
      sliceUntil("main", /^function writeSettingsFile\(file, value\) \{$/, /^function resolveGatewayKeys\(/),
      sliceUntil("main", /^const LOCAL_RESET_MARKER = "reset-pending\.json";$/, /^function realContainedDirectory\(/),
    ],
    subs: [],
    exports: ["LOCAL_RESET_REFUSAL_COPY", "LOCAL_RESET_MARKER", "LocalResetController", "LocalResetRecoveryError", "runPendingLocalReset", "readResetMarker"],
  },
  {
    // spend:get / spend:setCeiling (L61755-61756) → host.getSpendSnapshot (L45686) / setSpendCeiling (L47158):
    // the ORIGINAL per-video spend ledger SessionSpendBudgets (L26966-28133). The port has no paid tools, so
    // only setCeiling / snapshot move it; no gateway key → writeGatewaySpendPolicy's `if (!cfg.gatewayKey) return`.
    out: "src/main/spend/spend-budgets.generated.ts",
    imports: [
      'import { createHash, randomUUID } from "node:crypto";',
      'import { isDeepStrictEqual } from "node:util";',
      'import { isClientJobId } from "../engine/session";',
      'import { normalizeSpendCeilingUsd } from "./spend-wb.generated";',
    ],
    slices: () => [
      slice("main", /^function isLegacySpendPlanApproval\(value\) \{/, /^}$/, /^class SessionSpendBudgets \{/),
    ],
    subs: [],
    exports: ["SpendBudgetAuthorityMismatchError", "spendBudgetAuthority", "DEFAULT_AUTHORITY", "validatePersistedState", "toCents", "fromCents", "requiredSpendCeilingUsd", "SessionSpendBudgets"],
  },
  {
    // docs/32 M15: the ORIGINAL spend-approval cards — the settled-ask projection settledAskFromPermission and its
    // copy helpers (L1666-1797: NOT_ANSWERED, settledChoice, questionSummary, approvedSummary, MONEY_ASK_TITLE,
    // formatExactUsd, quotedSpendDescription, raiseBudgetDescription, budgetBlockLine, permissionTitle), the wb-chunk
    // quotedOperationLine (the card's operation line), the refusals PLAN_FIRST_REFUSAL / UNKNOWN_COST_BUDGET_REFUSAL
    // (L34586-34591) and spendPolicyForMaterialChange (L34057, the Bypass → ask_each transition).
    out: "src/main/spend/spend-approval.generated.ts",
    imports: ['import { engineFamilyLine } from "../agent/history.generated";'],
    slices: () => [
      slice("main", /^const NOT_ANSWERED = \{$/, /^}$/, /^function fileName\(path\)/),
      sliceUntil("main", /^function settledChoice\(selection, answer, options\) \{$/, /^function settledAskFromInput\(/),
      slice("wb", /^const SYNTH_VOICE_MODE_LINES = \{$/, /^};$/),
      slice("wb", /^const QUOTED_TOOL_ENGINE = \{$/, /^}$/, /^function quotedOperationLine\(/),
      slice("main", /^const PLAN_DECLINED_INSTRUCTION =$/, /;$/, /^const PLAN_FIRST_REFUSAL =$/),
      slice("main", /^function spendPolicyForMaterialChange\(change\) \{$/, /^}$/),
    ],
    subs: [],
    exports: ["NOT_ANSWERED", "settledAskFromPermission", "approvedSummary", "MONEY_ASK_TITLE", "formatExactUsd", "quotedSpendDescription", "raiseBudgetDescription", "budgetBlockLine", "permissionTitle", "unknownCostHoldDescription", "quotedOperationLine", "PLAN_DECLINED_INSTRUCTION", "UNKNOWN_COST_BUDGET_REFUSAL", "PLAN_FIRST_REFUSAL", "spendPolicyForMaterialChange"],
  },
  {
    // quickstart:start (L61294) → the ORIGINAL QuickstartStartCoordinator (L33623-33974).
    out: "src/main/quickstart/quickstart-start.generated.ts",
    imports: ['import { beginQuickstartLatency, measureQuickstartLatency } from "./quickstart-catalog.generated";'],
    slices: () => [
      slice("main", /^function validateRequest\(request2\) \{/, /^}$/, /^class QuickstartStartCoordinator \{/),
    ],
    subs: [],
    exports: ["validateRequest", "sameQuickstartBinding", "quickstartRequestFor", "QuickstartStartCoordinator"],
  },
  {
    // project:seedPack (L61827) → host.seedProjectPack (L36444) → writeProjectPack (L15492-15553).
    out: "src/main/taste/project-pack.generated.ts",
    imports: [
      'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { readCommitments, writeCommitments } from "./taste.generated";',
    ],
    slices: () => [
      slice("main", /^function isPlaceholder\(text2\) \{/, /^}$/),
      slice("main", /^function packReadme\(projectName, brief, briefCard\) \{/, /^}$/, /^function writeProjectPack\(/),
    ],
    subs: [],
    exports: ["packReadme", "writeProjectPack"],
  },
  {
    // job:originalContext (L61754) → host.getOriginalContext (L45675): readPromiseBrief + assembleOriginalVideoContext (L31469-…).
    out: "src/main/jobs/original-context.generated.ts",
    imports: [
      'import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";',
      'import { dirname, isAbsolute, join, relative, resolve } from "node:path";',
    ],
    slices: () => [
      slice("main", /^const MAX_PROMISE_BYTES = 256 \* 1024;$/, /^}$/, /^function assembleOriginalVideoContext\(/),
    ],
    subs: [],
    exports: ["readPromiseBrief", "assembleOriginalVideoContext"],
  },
  // docs/27: the Codex app-server PROTOCOL layer the original drives `codex app-server --listen stdio://`
  // with — thread/provider config (L23419-23527), message phases, notification / approval / dynamic-tool /
  // history normalisation, model-catalog normalisation (L24243-24689), the Codex developer instructions
  // (L24690-24771) and the Codex event → SDK message mapping createCodexRuntime feeds consume() (L25089-25250).
  {
    out: "src/main/codex/codex-protocol.generated.ts",
    imports: [
      'import { realpathSync } from "node:fs";',
      'import { sanitizedAgentEnv } from "../llm/llm-route";',
      'import { ENGINE_TOOL_LAUNCHER } from "../agent/session-assembly.generated";',
    ],
    slices: () => [
      slice("main", /^const CODEX_OPENROUTER_ENV = /, /^const CODEX_OPENAI_ENV = /),
      slice("main", /^function codexOpenRouterConfig\(/, /^}$/, /^function codexVideoConfig\(/),
      slice("main", /^const MAX_TRACKED_PHASE_TURNS = 8;$/, /^}$/, /^class CodexMessagePhases \{/),
      slice("main", /^function isDynamicToolResponse\(/, /^}$/),
      slice("main", /^function normalizeCodexNotification\(/, /^}$/, /^function codexAppServerVersion\(/),
      slice("main", /^const PREPARE_PRODUCTION_NO_PIPE = /, /^const PREPARE_PRODUCTION_NO_PIPE = /),
      slice("main", /^const CODEX_VIDEO_INSTRUCTIONS = `$/, /^}$/, /^function codexDeveloperInstructions\(/),
      slice("main", /^function codexEventToSdkMessages\(/, /^}$/, /^function sdkUserText\(/),
    ],
    subs: [],
    exports: ["CODEX_OPENROUTER_ENV", "CODEX_OPENAI_ENV", "codexOpenRouterConfig", "codexOpenAiConfig", "codexChildEnv", "codexVideoConfig", "CodexMessagePhases", "isDynamicToolResponse", "normalizeCodexNotification", "normalizeCompletedItem", "normalizeCodexApproval", "normalizeDynamicToolCall", "normalizeCodexHistory", "codexToolKind", "codexToolTitle", "MAX_CODEX_MODEL_PAGES", "normalizedCodexModel", "normalizedReasoningEfforts", "redactDiagnostic", "assertCompatibleServer", "codexAppServerVersion", "CODEX_VIDEO_INSTRUCTIONS", "CODEX_TOOL_MAPPING", "codexDeveloperInstructions", "codexEventToSdkMessages", "sdkUserText"],
  },
  // docs/27: the agent-route evidence ledger + Codex route qualification / containment / effort rules
  // (workbookContents chunk L829-1104) that createSession, codexRouteRefusal, codexModels and
  // setSessionReasoningEffort consult. AgentHost.codexEvidence (L35100) defaults to AGENT_ROUTE_EVIDENCE.
  {
    out: "src/main/codex/codex-routes.generated.ts",
    imports: [],
    slices: () => [
      slice("wb", /^const DEFAULT_ELIGIBLE_ROUTE_LEVELS = /, /^}$/, /^function partitionDiscoveredCodexModels\(/),
    ],
    subs: [],
    exports: ["DEFAULT_ELIGIBLE_ROUTE_LEVELS", "agentRouteId", "AGENT_ROUTE_EVIDENCE", "codexRouteEvidence", "codexRouteQualification", "isQualifiedCodexRoute", "recommendedCodexReasoningEffort", "codexEffortDiagnostic", "resolveCodexReasoningEffort", "CODEX_CONTAINMENT", "CODEX_HOST_APPROVAL", "resolveCodexContainment", "CODEX_PROVIDER_LABELS", "codexRouteDiagnostic", "resolveCodexRuntimeDefault", "isDiscoveredCodexModel", "codexModelUnavailableDiagnostic", "codexModelUnverifiedDiagnostic", "codexModelVerdict", "codexPinRefusal", "partitionDiscoveredCodexModels"],
  },
  // docs/28: the gateway-key CredentialStore (main L4526-5050). safeStorage comes from ../account/safe-storage
  // (Electron's when running in Electron, an "unavailable" stand-in under node:test — unpackaged builds may
  // then persist in the clear, exactly as the original's canPersistNew() allows).
  {
    out: "src/main/account/credential-store.generated.ts",
    imports: [
      'import { randomBytes } from "node:crypto";',
      'import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";',
      'import { dirname } from "node:path";',
      'import { safeStorage } from "./safe-storage";',
    ],
    slices: () => [
      slice("wb", /^const UNREADABLE_VAULT_COPY = /, /^const INSECURE_STORAGE_COPY = /),
      slice("main", /^const emptyVault = /, /^}$/, /^class CredentialStore \{/),
    ],
    subs: [],
    exports: ["UNREADABLE_VAULT_COPY", "INSECURE_STORAGE_COPY", "emptyVault", "CredentialStoreError", "CredentialStore"],
  },
  // docs/28: the account / gateway-key / billing contract the original runs against cfg.gatewayUrl — the
  // gateway-URL classification + auth-pool resolution (wb L20-332), the key meter + top-up + manual key write +
  // resolveAccountSnapshot (main L55293-55519), verifyKeyAt (L60601), signInFailure / mintFailureReason (L60857).
  {
    out: "src/main/account/account-gateway.generated.ts",
    imports: [
      'import { buildAccountSnapshot } from "../account-snapshot.generated";',
      'import { recordMainLog } from "../feedback/feedback-env";',
      'import { classifyError, sanitizeErrorText } from "../agent/history.generated";',
    ],
    slices: () => [
      slice("wb", /^const PROD_GATEWAY_URL = /, /^const STAGING_GATEWAY_URL = /),
      slice("wb", /^const normalizeGatewayUrl = /, /^}$/, /^function pinGatewaySettings\(/),
      slice("wb", /^function envForGatewayUrl\(/, /^}$/),
      slice("wb", /^function switchGatewayKeys\(/, /^const ANTHROPIC_PASSTHROUGH_PATH = /),
      slice("wb", /^function generationBlockedByAccount\(/, /^const ACCOUNT_BLOCKED_COPY = /),
      slice("wb", /^const MANAGED_KEY_MANUAL_WRITE_COPY = /, /^};$/, /^const SIGN_IN_UNAVAILABLE_COPY = /),
      slice("wb", /^const SUPPORT_EMAIL = /, /^const ACCOUNT_DISABLED_COPY = /),
      slice("main", /^class AccountAuthError extends Error \{/, /^const SESSION_CHANGED_COPY = /),
      slice("main", /^const BILLING_TIMEOUT_MS = /, /^}$/, /^async function resolveAccountSnapshot\(/),
      slice("main", /^async function verifyKeyAt\(/, /^}$/),
      slice("main", /^function signInFailure\(/, /^}$/, /^function mintFailureReason\(/),
    ],
    subs: [],
    exports: ["PROD_GATEWAY_URL", "STAGING_GATEWAY_URL", "normalizeGatewayUrl", "pinGatewaySettings", "envForGatewayUrl", "switchGatewayKeys", "KEY_METER_PATH", "topupSessionPath", "keyMeterFrom", "ANTHROPIC_PASSTHROUGH_PATH", "generationBlockedByAccount", "accountGateEnforced", "paidWorkBlockedFor", "ACCOUNT_BLOCKED_COPY", "MANAGED_KEY_MANUAL_WRITE_COPY", "manualKeyWriteRefusal", "SIGN_OUT_NOT_PERSISTED_COPY", "resolveAuthPool", "SIGN_IN_UNAVAILABLE_COPY", "SUPPORT_EMAIL", "ACCOUNT_DISABLED_COPY", "AccountAuthError", "NETWORK_COPY", "SESSION_CHANGED_COPY", "BILLING_TIMEOUT_MS", "boundedBillingFetch", "loadKeyMeter", "startTopUp", "ManualKeyWriteRefused", "applyManualKeyWrite", "REVOKED_COPY", "resolveAccountSnapshot", "verifyKeyAt", "signInFailure", "mintFailureReason"],
  },
  // docs/28: taste:titles — TasteTitleStore (main L55810-55920) over the helper-LLM creds resolveHelperCreds
  // (L22342) + anthropicMessages (L22357); tasteTitleKey / sanitizeTasteTitle (L656-686).
  {
    out: "src/main/taste/taste-titles.generated.ts",
    imports: [
      'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import { dirname } from "node:path";',
    ],
    slices: () => [
      slice("main", /^const DEFAULT_LLM_ROUTE = /, /^}$/),
      slice("main", /^function tasteTitleKey\(/, /^}$/, /^function sanitizeTasteTitle\(/),
      slice("main", /^const ANTHROPIC_VERSION = /, /^}$/, /^async function anthropicMessages\(/),
      sliceUntil("main", /^const TITLE_MODEL = /, /^const RECHECK_MS = /),
    ],
    subs: [],
    exports: ["DEFAULT_LLM_ROUTE", "resolvedLlmRoute", "tasteTitleKey", "TASTE_TITLE_BANNED", "sanitizeTasteTitle", "ANTHROPIC_VERSION", "resolveHelperCreds", "sessionHelperCreds", "anthropicMessages", "TITLE_MODEL", "MAX_BATCH", "TITLE_SYSTEM", "extractJsonArray", "TasteTitleStore"],
  },
  // docs/28: the Claude-route model evidence ledger + catalog partition (wb L955-966, L1104-1354) that
  // claudeModels (main L51353) / discoverClaudeModels (L51528) consult.
  {
    out: "src/main/agent/claude-routes.generated.ts",
    imports: ['import { agentRouteId } from "../codex/codex-routes.generated";'],
    slices: () => [
      slice("wb", /^const RECORDED_CLAUDE_EFFORT_MODELS = /, /^}$/, /^function claudeReasoningEffortChoices\(/),
      slice("wb", /^const CLAUDE_CLI_TURN = /, /^}$/, /^function claudeModelVerdict\(/),
    ],
    subs: [],
    exports: ["RECORDED_CLAUDE_EFFORT_MODELS", "RECORDED_CLAUDE_NO_EFFORT_MODELS", "claudeEffortSupportKnown", "claudeReasoningEffortChoices", "CLAUDE_MODEL_EVIDENCE", "CLAUDE_ROUTE_LABELS", "claudeModelEvidence", "claudeRouteQualification", "isQualifiedClaudeRoute", "isRecommendedClaudeRoute", "claudeRouteDiagnostic", "canonicalClaudeModelId", "partitionDiscoveredClaudeModels", "claudeModelUnavailableDiagnostic", "claudeModelVerdict"],
  },
  // docs/29: the ORIGINAL telemetry/feedback Outbox (L57833-58716) + its delivery executors (telemetry senders
  // L19708-19864, feedback senders L57393-57545) and journal validators (L57546-57832). Delivered to the
  // configured gateway — on a self-hosted gateway that is the local shim's disk sinks (no external send).
  {
    out: "src/main/telemetry/outbox.generated.ts",
    imports: [
      'import { createHash } from "node:crypto";',
      'import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";',
      'import { readFile, rename, writeFile } from "node:fs/promises";',
      'import { dirname, join } from "node:path";',
      'import { redact } from "../feedback/feedback.generated";',
      'import { recordMainLog } from "../feedback/feedback-env";',
    ],
    slices: () => [
      sliceUntil("main", /^const PATH_REDACTIONS = \[$/, /^const EXCEPTION_PROPERTY_KEYS = \[$/),
      slice("main", /^function safeExceptionText\(raw, max = EXCEPTION_MESSAGE_MAX\) \{$/, /^}$/),
      slice("main", /^const KEY_ID_DOMAIN = "videoclaw-alpha-consent-key\/v1\\0";$/, /^}$/, /^function alphaConsentKeyId\(/),
      slice("main", /^const SCREENSHOT_MAX_BYTES = /, /^const SCREENSHOT_MAX_BYTES = /),
      sliceUntil("main", /^const TELEMETRY_REQUEST_TIMEOUT_MS = /, /^const JOB_ID_RE\$1 = /),
      sliceUntil("main", /^async function sendBlockedFeedback\(/, /^class Outbox \{$/),
      slice("main", /^class Outbox \{$/, /^}$/),
    ],
    subs: [],
    exports: ["sendSessionEntries", "sendSessionIndex", "sendBeaconNow", "sendFeedback", "authorityFor", "authoritiesMatch", "isOutboxItem", "Outbox"],
  },
  {
    // docs/29: project memory (ProjectMemoryStore L3256 = LOCAL MEMORY.md under userData/memory/…) + the IPC reply
    // wrappers (projectMemoryReply L10711, openProjectMemorySource L10755) + the session-plan reply wrapper (L3995)
    out: "src/main/memory/project-memory.generated.ts",
    imports: [
      'import { createHash, randomUUID } from "node:crypto";',
      'import { closeSync, constants, createReadStream, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";',
      'import { dirname, isAbsolute, join, relative, resolve } from "node:path";',
      'import { z } from "zod";',
      'import { sanitizeErrorText } from "../agent/history.generated";',
      'import { recordMainLog } from "../feedback/feedback-env";',
    ],
    slices: () => [
      slice("main", /^const PROJECT_MEMORY_MAX_TEXT = /, /^}$/, /^function projectMemorySourceKey\(/),
      slice("main", /^function isWithin\$3\(root, target\) \{$/, /^}$/, /^function resolveProjectDestination\(/),
      sliceUntil("main", /^const MAX_FILE_BYTES = 1024 \* 1024;$/, /^const id = z\.string\(\)/),
      slice("main", /^class SessionPlanChoiceError extends Error \{\}$/, /^}$/, /^function sessionPlanFailureDiagnostic\(/),
      slice("main", /^function assertPlanGenerationAllowed\(/, /^}$/, /^async function sessionPlanReply\(/),
      slice("main", /^function assertProjectMemoryScope\(/, /^}$/, /^function openProjectMemorySource\(/),
      slice("main", /^function memoryError\(error\) \{$/, /^}$/, /^async function projectMemoryFile\(/),
    ],
    subs: [],
    exports: ["PROJECT_MEMORY_MAX_SOURCES", "projectMemorySourceKey", "resolveProjectDestination", "isExistingProjectDirectory", "ProjectMemoryError", "ProjectMemoryStore",
      "SessionPlanChoiceError", "SessionPlanBlockedError", "SessionPlanScopeError", "SessionPlanStateError", "sessionPlanFailureDiagnostic", "assertPlanGenerationAllowed", "sessionPlanReply",
      "assertProjectMemoryScope", "projectMemoryReply", "openProjectMemorySource", "memoryError", "projectMemoryFile",
      "SessionPlanDispatchError", "SessionPlanBindingError", "SessionPlanPersistError", "attestExistingProjectDirectory", "sameDirectory$1 as sameProjectDirectory"],
  },
  {
    // docs/30 (M13): the studio MCP toolset's verbatim constants + the session-plan schemas/decision/projection/restore
    // (makeStudioToolset L48166, callSessionPlan L37207, settled-ask cards L1798, self-authorizing list L22956).
    out: "src/main/studio/studio-tools.generated.ts",
    imports: [
      'import { isDeepStrictEqual } from "node:util";',
      'import { z } from "zod";',
      'import { SessionPlanChoiceError, SessionPlanBindingError } from "../memory/project-memory.generated";',
    ],
    slices: () => [
      slice("main", /^function sha256Utf8\(value\) \{$/, /^}$/),
      slice("main", /^const SAVED_VOICE_RIGHTS_EXEMPTION =$/, /;$/),
      slice("main", /^const ACCOUNT_PREFERENCE_TOOL_DESCRIPTION =$/, /;$/),
      slice("main", /^const PROJECT_MEMORY_TOOL_DESCRIPTION =$/, /;$/),
      slice("main", /^const NOT_ANSWERED = \{$/, /^}$/, /^function fileName\(path\)/),
      slice("main", /^function settledAskFromInput\(/, /^}$/, /^function inputSummary\(/),
      sliceUntil("main", /^const SESSION_PREVIEW_ASPECTS = \[$/, /^const REDACTIONS = \[$/),
      slice("main", /^const memoryLabel = z$/, /^const projectMemoryToolSchema = /),
      slice("main", /^const VOICEOVER_NAME_PREFIX_RE = /, /^const VOICEOVER_NAME_PREFIX_RE = /),
      sliceUntil("main", /^const id = z\.string\(\)\.regex/, /^class SessionPlanChoiceError extends Error \{\}$/),
      sliceUntil("main", /^const sessionPlanDecisionSchema = z$/, /^function assertPlanGenerationAllowed\(/),
      slice("main", /^const CLAUDE_CODE_SELF_AUTHORIZING_STUDIO_TOOLS = \[$/, /^const claudeCodeAllowedTools = /),
      slice("main", /^class SessionPlanJobMissingError extends SessionPlanBindingError \{$/, /;$/, /^const SESSION_PLAN_JOB_MISSING =$/),
      slice("main", /^const LIBRARY_ID = /, /^const LIBRARY_ID = /),
      slice("main", /^const SESSION_PLAN_PREAMBLE_PREFIX = /, /^const SESSION_PLAN_PREAMBLE_PREFIX = /),
    ],
    subs: [],
    exports: ["sha256Utf8", "SAVED_VOICE_RIGHTS_EXEMPTION", "ACCOUNT_PREFERENCE_TOOL_DESCRIPTION", "PROJECT_MEMORY_TOOL_DESCRIPTION", "settledAskFromInput",
      "SESSION_PREVIEW_ASPECTS", "SESSION_PLAN_GUIDANCE", "SESSION_PLAN_GUIDANCE_V1", "SESSION_PREVIEW_GUIDANCE", "PLAN_PAID_OPERATIONS_WHEN",
      "projectMemoryToolShape", "projectMemoryToolSchema", "VOICEOVER_NAME_PREFIX_RE", "sessionPlanToolShape", "sessionPlanToolSchema", "storedSessionPlanSchema",
      "splitSessionPlanForDisk", "mergeSessionPlanDetails", "sessionPlanChanges", "projectSessionPlan", "sessionPlanTurnId", "decideSessionPlan", "restoreSessionPlan",
      "CLAUDE_CODE_SELF_AUTHORIZING_STUDIO_TOOLS", "selfAuthorizingStudioTools", "claudeCodeAllowedTools", "SessionPlanJobMissingError", "SESSION_PLAN_JOB_MISSING",
      "LIBRARY_ID", "SESSION_PLAN_PREAMBLE_PREFIX"],
  },
  {
    // docs/29: app update channel preferences (createUpdatePreferences L2182) + the release-feed check
    // (startUpdateCheck L55921). The Linux app updater stays disabled (createAppUpdater is darwin-only, category c).
    out: "src/main/update/update-check.generated.ts",
    imports: [
      'import semver from "semver";',
      'import { canUseNightlyUpdates } from "../account-snapshot.generated";',
    ],
    slices: () => [
      slice("main", /^function selectedUpdateChannel\(settings2, account2\) \{$/, /^}$/, /^function releaseChannel\(/),
      sliceUntil("main", /^const RECHECK_MS = /, /^const RENDER_SCRIPT_REL = /),
    ],
    subs: [],
    exports: ["selectedUpdateChannel", "createUpdatePreferences", "releaseChannel", "startUpdateCheck"],
  },
  {
    // docs/29: CharacterSheetBuilder (L19216) — the engine dry-run plan + gateway quote and the paid build
    // (engine tools/build_character_sheet.py → POST /v1/mint_image through the scoped gateway capability)
    out: "src/main/characters/character-sheet.generated.ts",
    imports: [
      'import { spawn } from "node:child_process";',
      'import { randomBytes } from "node:crypto";',
      'import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";',
      'import { homedir } from "node:os";',
      'import { join } from "node:path";',
      'import { app, currentEngine, engineSessionEnv, featureFlagDecision, FEATURE_FLAG_REASON_COPY, policyRefusalMessage, sanitizedAgentEnv } from "./sheet-env";',
      'import { classifyError } from "../agent/history.generated";',
    ],
    slices: () => [
      sliceUntil("main", /^const DEV_FALLBACK_ENGINE = /, /^const JOB_ID_RE\$2 = /),
    ],
    subs: [],
    exports: ["resolveSheetTool", "classifySheetFailure", "CharacterSheetBuilder", "STUDIO_UPDATE_MSG", "GENERIC_FAIL"],
  },
  {
    // docs/29: the session-index projection telemetry:bindReplay enqueues (L10769-10787)
    out: "src/main/telemetry/session-index.generated.ts",
    imports: [],
    slices: () => [
      sliceUntil("main", /^function indexedSessionStatus\(meta\) \{$/, /^function journeyScope\(/),
    ],
    subs: [],
    exports: ["indexedSessionStatus", "sessionIndexProjection"],
  },
  {
    // docs/29: modelAccountLimit / modelAccountLimitPresentation (workbookContents chunk L1873-1923) — the
    // emitFailureCard (L42348) account-limit classification the credits hand-off keys on
    out: "src/main/agent/account-limit.generated.ts",
    imports: [
      'import { providerMessage, providerFailureKind, providerCapabilityLabel, QUOTA_EXHAUSTED } from "./history.generated";',
    ],
    slices: () => [
      sliceUntil("wb", /^const CODEX_PROVIDER_LABELS = \{$/, /^function codexRouteDiagnostic\(/),
      sliceUntil("wb", /^const LIMITED_ACCOUNT_LABELS = \{$/, /^const FREE_GEN_TOOLS = /),
    ],
    subs: [],
    exports: ["LIMITED_ACCOUNT_URLS", "modelAccountLimit", "modelAccountLimitPresentation"],
  },
];

export function render(spec) {
  let body = "";
  const where = [];
  for (const sl of spec.slices()) {
    where.push(`${SRC[sl.src]} L${sl.s + 1}-${sl.e + 1}`);
    body += sl.text + "\n";
  }
  for (const [from, to, n] of spec.subs) {
    const count = body.split(from).length - 1;
    if (count !== n) throw new Error(`${spec.out}: substitution ${from} expected ${n}, found ${count}`);
    body = body.split(from).join(to);
  }
  return [
    "// @ts-nocheck — GENERATED by tools/gen-verbatim.mjs. DO NOT EDIT.",
    "// Verbatim slices of the shipped bundle:",
    ...where.map((w) => `//   ${w}`),
    "// Substitutions (platform-layer routing only):",
    ...spec.subs.map(([f, t, n]) => `//   ${n}× ${f}  →  ${t}`),
    ...spec.imports,
    "",
    body.trimEnd(),
    "",
    `export { ${spec.exports.join(", ")} };`,
    "",
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const spec of SPECS) {
    const text = render(spec);
    if (!check) { writeFileSync(join(portRoot, spec.out), text); continue; }
    let cur = "";
    try { cur = readFileSync(join(portRoot, spec.out), "utf8"); } catch {}
    if (cur !== text) { stale++; console.error(`stale: ${spec.out}`); }
  }
  if (stale) process.exit(1);
}
