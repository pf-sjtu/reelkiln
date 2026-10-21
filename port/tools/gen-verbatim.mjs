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

export const SPECS = [
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
    exports: ["voiceNoteClock", "sha256Utf8", "composerTurnMessageUuid", "expandIntakeFolder", "streamCopyFileTo", "friendlyCopyError", "isClipboardPng", "clipboardImageIntakeFile", "sweepClipboardImageIntake", "attachmentContextLines", "ComposerAttachmentStore"],
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
