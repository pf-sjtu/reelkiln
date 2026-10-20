import { contextBridge, ipcRenderer, webUtils } from "electron";
const IPC = {
  readSessionPlan: "sessionPlan:read",
  chooseSessionPlan: "sessionPlan:choose",
  retrySessionPlan: "sessionPlan:retry",
  sessionPlanChanged: "sessionPlan:changed",
  readProjectMemory: "memory:read",
  updateProjectMemory: "memory:update",
  undoProjectMemory: "memory:undo",
  openProjectMemorySource: "memory:openSource",
  projectMemoryChanged: "memory:changed",
  quickstartCatalog: "quickstart:catalog",
  quickstartImpression: "quickstart:impression",
  quickstartPreviewed: "quickstart:previewed",
  quickstartStart: "quickstart:start",
  /** #605 — a renderer-observed Quickstart stage duration (gallery ready,
   * category switch, destination on screen). Local diagnostics only. */
  quickstartMark: "quickstart:mark",
  createSession: "session:create",
  listSessions: "session:list",
  reorderSessions: "session:reorder",
  renameSession: "session:rename",
  /** What deleting a video would move to the trash, and whether it may run. */
  projectDeletionPlan: "session:deletionPlan",
  /** Delete a video: registry row + its own files, into the 7-day trash. */
  deleteProject: "session:delete",
  sendMessage: "session:send",
  retryTurn: "session:retry",
  interrupt: "session:interrupt",
  setPermissionMode: "session:setPermissionMode",
  setSessionModel: "session:setModel",
  setSessionReasoningEffort: "session:setReasoningEffort",
  respondPermission: "permission:respond",
  /** #736 — the renderer confirming a spend approval is actually on screen, so
   * an unattended card and a card that never rendered stop looking the same. */
  notePermissionShown: "permission:shown",
  /** #592 — the two quit-relevant facts only the renderer can see. */
  noteQuitState: "quit:rendererState",
  /** Renderer subscribed after a refresh: main replays only interactions that
   * are still backed by a live resolver. */
  replayPendingInteractions: "interaction:replayPending",
  getHistory: "session:history",
  openPath: "file:openPath",
  openExternal: "file:openExternal",
  revealItem: "file:revealItem",
  saveItemAs: "file:saveItemAs",
  playbackCompleted: "analytics:playbackCompleted",
  listClients: "client:list",
  createClient: "client:create",
  renameClient: "client:rename",
  removeClient: "client:remove",
  reorderClients: "client:reorder",
  seedProjectPack: "project:seedPack",
  listTaste: "taste:list",
  commitTaste: "taste:commit",
  declineProposal: "taste:decline",
  tasteTitles: "taste:titles",
  charactersList: "characters:list",
  characterVoicesList: "characters:voices:list",
  characterVoiceApprove: "characters:voice:approve",
  characterVoiceRemove: "characters:voice:remove",
  characterVoicesChanged: "characters:voices:changed",
  charactersCreate: "characters:create",
  charactersSheetPlan: "characters:sheetPlan",
  charactersSheetBuild: "characters:sheetBuild",
  charactersSheetStates: "characters:sheetStates",
  charactersApprove: "characters:approve",
  charactersRetry: "characters:retry",
  charactersDiscard: "characters:discard",
  charactersDelete: "characters:delete",
  getJobSnapshot: "job:get",
  getOriginalContext: "job:originalContext",
  jobSnapshot: "job:snapshot",
  // Issue #187 — the OUTPUT panel's read-only budget strip. Pull on open,
  // push on every budget mutation (approve / reserve / commit / release).
  getSpendSnapshot: "spend:get",
  outboxAuthoritySnapshot: "outbox:authoritySnapshot",
  telemetryBindReplay: "telemetry:bindReplay",
  setSpendCeiling: "spend:setCeiling",
  spendSnapshot: "spend:snapshot",
  adoptJob: "job:adopt",
  approveVersion: "version:approve",
  revertFinal: "version:revertFinal",
  unfinalizeSession: "session:unfinalize",
  startContinuationChat: "session:startContinuation",
  historicalJobSnapshot: "job:historicalSnapshot",
  getSettings: "settings:get",
  setSettings: "settings:set",
  saveGatewayKey: "settings:saveGatewayKey",
  switchGateway: "settings:switchGateway",
  restartApp: "app:restart",
  getAppUpdatePreferences: "app:update:preferences",
  setAppUpdateChannel: "app:update:channel",
  getAppUpdateState: "app:update:state",
  appUpdateState: "app:update:state-changed",
  downloadAppUpdate: "app:update:download",
  installAppUpdate: "app:update:install",
  getUpdateInfo: "app:update:get",
  checkForUpdates: "app:update:check",
  updateInfo: "app:update",
  verifyGatewayKey: "gateway:verify",
  // videoclaw-backend#41 — the managed-account control plane. None of these
  // ever carry an ID token, a refresh token or a plaintext vc_ key across IPC.
  accountSnapshot: "account:snapshot",
  accountRefresh: "account:refresh",
  accountSignInGoogle: "account:signInGoogle",
  accountSignInEmail: "account:signInEmail",
  accountResendEmail: "account:resendEmail",
  accountCancelSignIn: "account:cancelSignIn",
  accountEmailSent: "account:emailSent",
  accountSignOut: "account:signOut",
  accountConsent: "account:consent",
  accountEnsureAccess: "account:ensureAccess",
  accountMintKey: "account:mintKey",
  accountClaimKey: "account:claimKey",
  accountLocalResetPrepare: "account:localResetPrepare",
  accountLocalResetCommit: "account:localResetCommit",
  accountChanged: "account:changed",
  keyMeter: "gateway:meter",
  topUp: "gateway:topup",
  claudeCodeStatus: "engine:claudeCodeStatus",
  claudeCodeConnect: "engine:claudeCodeConnect",
  claudeCodeConnectCancel: "engine:claudeCodeConnectCancel",
  claudeCodeSignOutImpact: "engine:claudeCodeSignOutImpact",
  claudeCodeSignOut: "engine:claudeCodeSignOut",
  llmRouteReadiness: "engine:llmRouteReadiness",
  codexStatus: "engine:codexStatus",
  codexConnectChatGpt: "engine:codexConnectChatGpt",
  codexConnectCancel: "engine:codexConnectCancel",
  codexDisconnectImpact: "engine:codexDisconnectImpact",
  codexDisconnectChatGpt: "engine:codexDisconnectChatGpt",
  codexModels: "engine:codexModels",
  claudeModels: "engine:claudeModels",
  codexHandoffOffer: "engine:codexHandoffOffer",
  continueOnCodex: "engine:continueOnCodex",
  creditHandoffOffer: "engine:creditHandoffOffer",
  continueOnCredits: "engine:continueOnCredits",
  agentProviderKeyStatus: "engine:agentProviderKeyStatus",
  saveAgentProviderKey: "engine:saveAgentProviderKey",
  respondInput: "input:respond",
  requestMic: "media:requestMic",
  voiceDictationStatus: "media:voiceDictationStatus",
  transcribeVoice: "media:transcribeVoice",
  discardVoice: "media:discardVoice",
  libraryStats: "library:stats",
  libraryScan: "library:scan",
  libraryAddSource: "library:addSource",
  libraryRemoveSource: "library:removeSource",
  librarySync: "library:sync",
  librarySearch: "library:search",
  libraryPreview: "library:preview",
  librarySetTenant: "library:setTenant",
  bootstrapStatus: "bootstrap:status",
  bootstrapRun: "bootstrap:run",
  bootstrapRevertEngine: "bootstrap:revertEngine",
  /** #603 — reveal the plain-text setup log so a stuck first run is diagnosable
   *  without any raw command/path text entering the gate's DOM. */
  bootstrapRevealSetupLog: "bootstrap:revealSetupLog",
  // Chunk 14 — one-shot pull for the "engine updated" toast (main clears it).
  enginePendingToast: "engine:pendingToast",
  // main → renderer: a background engine update flipped the pointer MID-RUN
  // (chunk 21 gap #3) — show the same one-line toast without waiting for a
  // relaunch. Launch-time bumps still ride enginePendingToast.
  engineUpdated: "engine:updated",
  intakePickFiles: "intake:pickFiles",
  attachmentStage: "attachment:stage",
  attachmentList: "attachment:list",
  attachmentOwnership: "attachment:ownership",
  attachmentRemove: "attachment:remove",
  attachmentRetry: "attachment:retry",
  attachmentDestination: "attachment:destination",
  /** #494 — stage an immutable paste-event image through the same durable
   * composer attachment owner as picker/drag-drop intake. */
  attachmentPasteImage: "attachment:pasteImage",
  attachmentVoiceNote: "attachment:voiceNote",
  /** #612 — the per-session ingested-materials ledger. */
  materialPreview: "materials:preview",
  attachmentCaptureMoment: "attachment:captureMoment",
  attachmentMomentPreview: "attachment:momentPreview",
  attachmentPreview: "attachment:preview",
  // Chunk 11 — honest stage ETAs for the live activity strip.
  stageEtas: "stats:stageEtas",
  // main → renderer
  sessionEvent: "session:event",
  sessionsChanged: "session:changed",
  permissionRequest: "permission:request",
  inputRequest: "input:request",
  librarySyncProgress: "library:syncProgress",
  bootstrapProgress: "bootstrap:progress",
  windowState: "window:state",
  attachmentChanged: "attachment:changed",
  /** #612 — main recomputed a session's materials ledger (new material
   *  landed, or a turn committed its attachments). */
  materialsChanged: "materials:changed",
  /** #479 — a background Quickstart catalog refresh VERIFIED a newer signed
   * generation. Only ever carries an already-verified snapshot. */
  quickstartCatalogChanged: "quickstart:catalogChanged",
  /** Chunk 15b — background character-sheet build progress (per slug). */
  characterBuild: "characters:build",
  // "Report a problem" (videoclaw-app#105): pre-modal evidence capture, submit
  // the finalized report, discard temp capture artifacts on close-without-send.
  feedbackCapture: "feedback:capture",
  feedbackSubmit: "feedback:submit",
  feedbackDiscard: "feedback:discard",
  /** #378 — grant usage sharing from wherever the report was opened. */
  feedbackGrantUsageSharing: "feedback:grantUsageSharing",
  // "Upload workflow" (videoclaw-app#437): server-resolved creator eligibility,
  // then one submission of the CURRENT job for workflow review.
  workflowSubmitEligibility: "workflowSubmit:eligibility",
  workflowSubmitStart: "workflowSubmit:start",
  // HyperFrames editor render
  editorRenderStart: "editorRender:start",
  editorRenderCancel: "editorRender:cancel",
  editorRenderState: "editorRender:state",
  editorRenderEvent: "editorRender:event",
  // main → renderer
  // HyperFrames embedded editor preview + one fine-tuning edit
  hfPreviewAvailable: "hfPreview:available",
  hfPreviewStart: "hfPreview:start",
  hfPreviewStop: "hfPreview:stop",
  hfEditApply: "hfPreview:editApply",
  hfPreviewEvent: "hfPreview:event"
  // main → renderer
};
typeof __VC_MANAGED_DEVELOPMENT__ !== "undefined" && __VC_MANAGED_DEVELOPMENT__ === true;
typeof __VC_STAGING_GATEWAY_URL__ === "string" ? __VC_STAGING_GATEWAY_URL__.trim() : "";
const parseConfig = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const p = JSON.parse(raw);
    if (!p.apiKey?.trim() || !p.authDomain?.trim() || !p.googleClientId?.trim()) {
      return null;
    }
    return {
      apiKey: p.apiKey.trim(),
      authDomain: p.authDomain.trim(),
      googleClientId: p.googleClientId.trim(),
      googleClientSecret: p.googleClientSecret?.trim() || void 0
    };
  } catch {
    return null;
  }
};
parseConfig(
  typeof __VC_FIREBASE_PROD__ === "string" ? __VC_FIREBASE_PROD__ : void 0
);
parseConfig(
  typeof __VC_FIREBASE_STAGING__ === "string" ? __VC_FIREBASE_STAGING__ : void 0
);
const ENGINE_LINES = {
  // JC-specified lines (verbatim from the chunk spec) ───────────────────────
  mint_image: (s) => s ? `Creating a still — ${s}` : "Creating a still",
  mint_video: (s) => s ? `Generating footage — ${s}` : "Generating footage",
  lipsync_footage: () => "Syncing the voice",
  sam3: () => "Cutting out the subject",
  review_output: () => "Checking the cut",
  review_render: () => "Checking the cut",
  index_media: () => "Searching your library",
  pull_video: () => "Pulling reference footage",
  acquire_footage: () => "Pulling reference footage",
  // pre-rename engines (pull_video's old name)
  score_bed: () => "Scoring the music",
  compose_render: () => "Assembling the video",
  // Remaining canonical engine tools, mapped into the same producer families ─
  // synth_voice is GENERATION (tts/design) by default — "Recording" would
  // falsely claim the user's own mic moment (JC live QA 2026-07-17). Mode-
  // specific lines (voice_change/transcribe/…) are resolved in
  // friendlyToolLine via SYNTH_VOICE_MODE_LINES.
  synth_voice: () => "Creating the voiceover",
  perform_avatar: () => "Bringing the presenter to life",
  cast_avatar: () => "Bringing the presenter to life",
  remotion_render: () => "Assembling the video",
  assemble: () => "Assembling the video",
  qa_gate: () => "Checking the cut",
  gemini_video: () => "Checking the cut",
  check_promise: () => "Checking the cut",
  check_script: () => "Checking the script",
  check_layout: () => "Checking the cut",
  verify_output: () => "Checking the cut",
  preflight: () => "Checking the cut",
  script_preflight: () => "Checking the script",
  red_zones: () => "Checking the cut",
  fetch_asset: () => "Pulling reference footage",
  stem_split: () => "Scoring the music",
  build_carousel: () => "Building the carousel",
  clean_audio: () => "Cleaning up the audio",
  scrub_reference_vo: () => "Cleaning up the audio",
  densify: () => "Fitting the captions",
  chunk_boundaries: () => "Fitting the captions",
  project_brief: () => "Shaping the brief",
  breakdown_reference: () => "Studying the reference",
  analyze_reference: () => "Studying the reference",
  website_style: () => "Studying the reference",
  frame_insert: () => "Adding a motion beat",
  fx_parallax: () => "Adding a motion beat",
  frame_boundaries: () => "Adding a motion beat",
  cost: () => "Checking the budget"
};
const SYNTH_VOICE_MODE_LINES = {
  tts: "Creating the voiceover",
  reference_tts: "Creating the approved voiceover",
  design: "Creating the voiceover",
  voice_change: "Re-voicing your recording",
  transcribe: "Transcribing your recording",
  list_voices: "Choosing a voice"
};
const SYNTH_VOICE_GENERATION_MODES = ["tts", "reference_tts", "design", "voice_change"];
const ENGINE_ALIASES = {
  lipsync: "lipsync_footage"
};
function engineFamilyLine(tool) {
  let key = String(tool ?? "").replace(/\.py$/i, "").trim().toLowerCase();
  key = ENGINE_ALIASES[key] ?? key;
  const fn = ENGINE_LINES[key];
  return fn ? fn(null) : null;
}
const GENERATION_TOOLS = [
  "mint_image",
  // a still
  "mint_video",
  // a video clip
  "synth_voice",
  // the voiceover
  "lipsync_footage",
  // voice + avatar work
  "perform_avatar",
  "cast_avatar",
  "sam3",
  // effect work (cutouts)
  "build_carousel",
  "stem_split"
  // audio work
];
/* @__PURE__ */ new Set([
  ...GENERATION_TOOLS.map((t) => engineFamilyLine(t)).filter((l) => l !== null),
  // synth_voice generation modes carry mode-specific lines (e.g. voice_change
  // → "Re-voicing your recording") — still live audio generation, still strip-worthy.
  ...SYNTH_VOICE_GENERATION_MODES.map((m) => SYNTH_VOICE_MODE_LINES[m])
]);
function agentRouteId(harness, provider, modelId) {
  const model = modelId.trim();
  if (!model) throw new Error("agentRouteId requires an exact model id.");
  return `${harness}:${provider}:${model}`;
}
const CODEX_PACKAGED_0_153_4_SMOKE = [
  "historical packaged-app smoke on 0.153.4; native UI smoke pending for 0.160.1",
  "streaming",
  "tool execution (VideoClaw dynamic tool + provider command)",
  "image/frame understanding from a project file",
  "commentary/final-answer classification",
  "payer labelling",
  "persistence and default isolation"
];
function codexQualifiedEvidence(effort, conformanceManifest, benchManifest) {
  return [
    ...CODEX_PACKAGED_0_153_4_SMOKE,
    `live route conformance on 0.160.1: initialize, auth, discovery, runtime-default resolution, exact model on the wire, 28/28 required checks at reasoning effort “${effort}” (${conformanceManifest})`,
    "REAL structured output: a `turn/start.outputSchema` turn whose final result is an instance of the supplied schema and objectively correct",
    "structured TOOL-CALL arguments matching a VideoClaw dynamic-tool schema (tool calling, a separate capability from structured output)",
    "interrupt/steer, and resume on the same thread afterwards",
    "read-only sandbox write containment: an unauthorized write does not land on disk (graded on the filesystem, not on model prose)",
    "deterministic host-adapter approval conformance for the ten required command/file cases (scripts/codex-app-server-check.mts). Production Codex filesystem is read-only, so file-change escalation is intentionally precluded; approval-event mapping is covered by deterministic host-adapter conformance.",
    `live 0.160.1 command approval probe under the UNCHANGED read-only sandbox policy; the per-route receipt records whether escalation occurred (${conformanceManifest} → approvalConformance.liveApprovalProbe)`,
    "no silent model substitution at thread/start",
    `VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (${benchManifest})`
  ];
}
const CODEX_QUALIFIED_RESIDUAL_GAPS = [
  "perceptual/rubric scoring and human calibration",
  "monetary cost and token accounting (not exposed by Codex subscription mode)",
  "a LIVE file-change approval event — precluded by the intentional read-only production sandbox, and covered deterministically rather than by weakening that sandbox",
  `evidence at any reasoning effort other than the recommended one — the model's other supported depths stay selectable, and which of them a benchmark covers is recorded HERE rather than narrated in the picker (a RECORDED deviation from "exposure requires a current benchmark record": effort is a parameter inside a qualified route, not part of route identity)`
];
const AGENT_ROUTE_EVIDENCE = [
  {
    routeId: agentRouteId("codex-app-server", "chatgpt", "gpt-5.6-terra"),
    harness: "codex-app-server",
    provider: "chatgpt",
    modelId: "gpt-5.6-terra",
    // PROMOTED from `smoke-validated`. The same suite Astra cleared was run
    // against this exact route, re-established on 0.160.1: 28/28 conformance and a
    // 3/3 VideoClaw Bench record. It is the reason an account that cannot
    // address Astra still has a qualified option rather than an empty picker.
    level: "qualified",
    validatedAt: "2026-10-06",
    runtimeVersion: "0.160.1",
    // Retain the pre-registered qualified effort across the runtime bump;
    // the live pass explicitly pins and records it via --effort.
    recommendedReasoningEffort: "medium",
    evidence: codexQualifiedEvidence(
      "medium",
      "bench/runs/gpt-5.6-terra-medium-conformance.json",
      "bench/runs/vcb-mm-inspect-001-gpt-5.6-terra-medium.json"
    ),
    bench: {
      taskId: "vcb-mm-inspect-001",
      taskVersion: "1.0.0",
      track: "system",
      rollouts: 3,
      passed: 3,
      manifest: "bench/runs/vcb-mm-inspect-001-gpt-5.6-terra-medium.json"
    },
    notYetCovered: CODEX_QUALIFIED_RESIDUAL_GAPS
  },
  {
    routeId: agentRouteId("codex-app-server", "chatgpt", "gpt-6-astra"),
    harness: "codex-app-server",
    provider: "chatgpt",
    // Re-established by live discovery and qualification on 0.160.1.
    // GPT-6.1-Sol is now the runtime default; Astra stays explicitly selected.
    modelId: "gpt-6-astra",
    // Cleared both halves of the #108 gate: protocol/capability conformance
    // across every surface VideoClaw drives
    // (bench/runs/gpt-6-astra-low-conformance.json) and a VideoClaw Bench
    // record with three isolated rollouts
    // (bench/runs/vcb-mm-inspect-001-gpt-6-astra-low.json).
    level: "qualified",
    validatedAt: "2026-10-06",
    runtimeVersion: "0.160.1",
    // Retain the pre-registered qualified low effort across the bump.
    // The new provider default is medium; it does not move this explicit pin.
    recommendedReasoningEffort: "low",
    evidence: codexQualifiedEvidence(
      "low",
      "bench/runs/gpt-6-astra-low-conformance.json",
      "bench/runs/vcb-mm-inspect-001-gpt-6-astra-low.json"
    ),
    bench: {
      taskId: "vcb-mm-inspect-001",
      taskVersion: "1.0.0",
      track: "system",
      rollouts: 3,
      passed: 3,
      manifest: "bench/runs/vcb-mm-inspect-001-gpt-6-astra-low.json"
    },
    notYetCovered: [
      ...CODEX_QUALIFIED_RESIDUAL_GAPS,
      "a LIVE command approval for Astra on 0.160.1 — the probe raised no escalation; Terra did, and host mapping is covered deterministically"
    ]
  }
];
new Map(AGENT_ROUTE_EVIDENCE.map((row) => [row.routeId, row]));
const CLAUDE_CLI_TURN = ["live turn on the bundled CLI returned a completed result"];
const CLAUDE_BENCH_RUN = "three isolated rollouts on the bundled CLI — one fresh SDK session in a fresh workspace each, no resume, all terminating on a normal result";
const CLAUDE_BENCH_WIRE_IDENTITY = "the requested model id was the session model reported by `system/init` on every rollout; `modelUsage` additionally lists the CLI's own internal helper model, recorded as concurrent side usage and NOT as a fallback of the requested model";
const CLAUDE_BENCH_PAYER = "payer observed per rollout: signed-in claude.ai, apiProvider firstParty, Team subscription, no gateway credentials injected";
const CLAUDE_BENCH_NOT_COVERED = [
  "protocol/capability conformance on this harness — there is no Claude equivalent of the 28-check Codex conformance manifest, so structured output, interrupt/resume and approval semantics are not separately graded here",
  "perceptual/rubric scoring and human calibration",
  "monetary cost accounting — the manifests record the SDK's own `total_cost_usd` estimate for a subscription-route turn, which is not VideoClaw-paid spend and not a billing statement",
  "the `gateway` route, which never spawns this CLI and holds no Claude evidence of any kind"
];
const CLAUDE_CLI_TURN_NOT_COVERED = [
  "a VideoClaw Bench record of any kind — this row rests on one completed turn, which is why it is no longer the id a new video starts on",
  ...CLAUDE_BENCH_NOT_COVERED
];
function claudeCodeRow(modelId, runtimeVersion, validatedAt, outcome, evidence, notYetCovered, extra = {}) {
  return {
    routeId: agentRouteId("claude-code", "claude-code", modelId),
    route: "claude-code",
    modelId,
    runtimeVersion,
    validatedAt,
    outcome,
    evidence,
    notYetCovered,
    ...extra
  };
}
function claudeBench(modelId, passed) {
  return {
    taskId: "vcb-mm-inspect-001",
    taskVersion: "1.0.0",
    track: "system",
    rollouts: 3,
    passed,
    manifest: `bench/runs/vcb-mm-inspect-001-${modelId}.json`
  };
}
const CLAUDE_MODEL_EVIDENCE = [
  // The row that shows why the binary is the authority and a string search
  // over it is NOT: `claude-opus-5` occurs nowhere in this CLI's string table
  // and runs anyway. That table is a pricing/alias map, not a closed catalog,
  // so a grep-the-binary gate would reject a working model.
  //
  // Superseded by `claude-opus-5-5` as the Deep choice and the new-video
  // default (#852). Still qualified and still runnable: a video pinned here is
  // never migrated, and keeps spawning this exact id.
  claudeCodeRow(
    "claude-opus-5",
    "2.1.281",
    "2026-09-24",
    "qualified",
    [
      CLAUDE_BENCH_RUN,
      CLAUDE_BENCH_WIRE_IDENTITY,
      CLAUDE_BENCH_PAYER,
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-opus-5.json). Precision was 0.50/0.50/0.67 — every seeded defect was found, alongside unseeded findings the task does not penalise beyond that number."
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-opus-5", 3), supersededBy: "claude-opus-5-5" }
  ),
  // Refused by CLI 2.1.268 ("version 2.1.280 or newer is required") — the
  // same shape `claude-fable-5-1` had on 2.1.201, a property of the binary,
  // never of the model. That run is recorded in this manifest's `requalifies`.
  claudeCodeRow(
    "claude-opus-5-5",
    "2.1.281",
    "2026-09-24",
    "qualified",
    [
      CLAUDE_BENCH_RUN,
      CLAUDE_BENCH_WIRE_IDENTITY,
      CLAUDE_BENCH_PAYER,
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-opus-5-5.json). Precision was 0.67/1.0/1.0."
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-opus-5-5", 3) }
  ),
  claudeCodeRow(
    "claude-sonnet-5",
    "2.1.281",
    "2026-09-24",
    "qualified",
    [
      CLAUDE_BENCH_RUN,
      CLAUDE_BENCH_WIRE_IDENTITY,
      CLAUDE_BENCH_PAYER,
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-sonnet-5.json)"
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-sonnet-5", 3) }
  ),
  // Same shape as `claude-opus-4-8`: still qualified, still runnable by a
  // video pinned to it, no longer the id VideoClaw starts a new video on —
  // `claude-fable-5-1` took that slot. Recorded rather than implied, so the
  // ledger-driven offer list reproduces exactly the menu the curated list used
  // to hand-maintain. It was never put through Bench, and its `notYetCovered`
  // says so rather than letting a superseded row imply it cleared the same bar.
  claudeCodeRow(
    "claude-fable-5",
    "2.1.281",
    "2026-09-24",
    "qualified",
    CLAUDE_CLI_TURN,
    CLAUDE_CLI_TURN_NOT_COVERED,
    { supersededBy: "claude-fable-5-1" }
  ),
  // 3/3 on 2.1.281. On 2.1.268 it went 2/3 and was `did-not-qualify`: rollout
  // 2 found the seeded caption defect and wrote the word back with a Cyrillic
  // Е (U+0415), so the report was not machine-comparable. That record is kept
  // at vcb-mm-inspect-001-claude-haiku-4-5-20251001@65f5aea.json. Qualifying
  // it on the new binary is the same bar applied in the other direction —
  // withholding a 3/3 result would be the exemption #108 AC#2 forbids, turned
  // against a model instead of for one.
  claudeCodeRow(
    "claude-haiku-4-5-20251001",
    "2.1.281",
    "2026-09-24",
    "qualified",
    [
      CLAUDE_BENCH_RUN,
      CLAUDE_BENCH_WIRE_IDENTITY,
      CLAUDE_BENCH_PAYER,
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-haiku-4-5-20251001.json)"
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-haiku-4-5-20251001", 3) }
  ),
  // Kept after the allowlist dropped it: most of the existing library is
  // pinned here, and those videos still spawn this id verbatim. The picker
  // says only that VideoClaw no longer OFFERS it, which is a claim this row
  // is what makes honest — it still runs. `supersededBy` is what carries that
  // "still runs, no longer offered" distinction now that the OFFER is derived
  // from this ledger rather than from a menu list in the renderer.
  claudeCodeRow(
    "claude-opus-4-8",
    "2.1.281",
    "2026-09-24",
    "qualified",
    CLAUDE_CLI_TURN,
    CLAUDE_CLI_TURN_NOT_COVERED,
    { supersededBy: "claude-opus-5-5" }
  ),
  // Excluded on CLI 2.1.201, which refused it outright and named the version
  // that would not: "2.1.251 or newer is required". It has since gone 3/3 on
  // Bench on 2.1.268 and again on 2.1.281 — the exclusion was a property of
  // the shipped binary, never of the model.
  claudeCodeRow(
    "claude-fable-5-1",
    "2.1.281",
    "2026-09-24",
    "qualified",
    [
      CLAUDE_BENCH_RUN,
      CLAUDE_BENCH_WIRE_IDENTITY,
      CLAUDE_BENCH_PAYER,
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-fable-5-1.json). Precision was 1.0/1.0/0.67 — every seeded defect was found, alongside one unseeded finding on the third rollout."
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-fable-5-1", 3) }
  )
];
new Map(
  CLAUDE_MODEL_EVIDENCE.map((row) => [row.routeId, row])
);
const FREE_GEN_TOOLS = [
  "assemble",
  "assemble_plate",
  "check_layout",
  "check_promise",
  "chunk_boundaries",
  // compose_render is NOT here: --mode episode shells out to synth_voice,
  // lipsync_footage, and mint_image as child processes (engine make_episode),
  // so only its source-audited local modes downgrade — via FREE_MODES below.
  "cost",
  // Deterministic final-pixel QA: no CLI (no argparse, no `__main__`) and no
  // network — a library imported by review_output that uses red_zones plus
  // local cv2/ffprobe. Engine KNOWN_FREE_TOOLS (videoclaw#198).
  "delivery_safety",
  "dense_sample",
  "doctor",
  "dense_sample",
  "fetch_asset",
  // fx_parallax is NOT here since videoclaw#296: its depth map is one
  // fixed-price gateway call per still (PAID_GEN_TOOLS below).
  "hyperframes_captions",
  "hyperframes_compose",
  "hyperframes_dataviz",
  "hyperframes_layout",
  "hyperframes_overlays",
  "hyperframes_render",
  "hyperframes_style",
  "job",
  "job_inputs",
  "log",
  "preflight",
  "prepare_production",
  "project_brief",
  "qa_gate",
  "red_zones",
  "reframe",
  // Advisory fcntl/msvcrt lock around the shared Remotion source tree. No CLI
  // and no network: a library imported by compose_render and remotion_render,
  // the same shape as red_zones above. Engine KNOWN_FREE_TOOLS.
  "remotion_lock",
  "remotion_render",
  "render_timeline_strip",
  // #905 — the engine's review of a finished render. Its one model request is
  // house-paid (videoclaw-backend#287): never the user's money, so never a
  // money card. The engine's verdict must say the same (spendRisk "free").
  "review_render",
  "session_marker",
  "taste_contract",
  "website_style"
];
new Set(FREE_GEN_TOOLS);
const CURL_HEADS = ["curl", "curlie"];
const NESTED_CURL_LAUNCHERS = [
  "exec",
  "find",
  "parallel",
  "setsid",
  "stdbuf",
  "timeout",
  "watch",
  "xargs"
];
const PROVIDER_READ_ONLY_HEADS = [
  "awk",
  "basename",
  "cat",
  "column",
  "comm",
  "cut",
  "diff",
  "dirname",
  "du",
  "echo",
  "false",
  "ffprobe",
  "file",
  "find",
  "grep",
  "head",
  "jq",
  "less",
  "ls",
  "more",
  "nl",
  "printf",
  "pwd",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "true",
  "type",
  "uniq",
  "wc",
  "which",
  "xxd",
  "yq"
];
new Set(CURL_HEADS);
new Set(NESTED_CURL_LAUNCHERS);
new Set(PROVIDER_READ_ONLY_HEADS);
const CURL_BODY_FLAGS = [
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "--form",
  "--form-string",
  "--json",
  "--upload-file",
  "-F",
  "-T",
  "-d"
];
const CURL_METHOD_FLAGS = ["--request", "-X"];
const CURL_FORCE_GET_FLAGS = ["--get", "-G"];
const CURL_VALUE_SHORT_OPTIONS = [
  "A",
  "C",
  "D",
  "E",
  "F",
  "H",
  "K",
  "P",
  "Q",
  "T",
  "U",
  "X",
  "Y",
  "b",
  "c",
  "d",
  "e",
  "m",
  "o",
  "r",
  "t",
  "u",
  "w",
  "x",
  "y",
  "z"
];
const CURL_LONG_WITH_VALUE = [
  "--aws-sigv4",
  "--cacert",
  "--capath",
  "--cert",
  "--config",
  "--connect-timeout",
  "--connect-to",
  "--continue-at",
  "--cookie",
  "--cookie-jar",
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "--dump-header",
  "--form",
  "--form-string",
  "--header",
  "--interface",
  "--json",
  "--key",
  "--limit-rate",
  "--max-redirs",
  "--max-time",
  "--oauth2-bearer",
  "--output",
  "--proxy",
  "--proxy-user",
  "--range",
  "--referer",
  "--request",
  "--resolve",
  "--retry",
  "--time-cond",
  "--unix-socket",
  "--upload-file",
  "--url",
  "--user",
  "--user-agent",
  "--write-out"
];
const CURL_READ_METHODS = ["GET", "HEAD", "OPTIONS"];
new Set(CURL_BODY_FLAGS);
new Set(CURL_METHOD_FLAGS);
new Set(CURL_FORCE_GET_FLAGS);
new Set(CURL_VALUE_SHORT_OPTIONS);
new Set(CURL_LONG_WITH_VALUE);
new Set(CURL_READ_METHODS);
const BILLED_MEDIA_BY_KEY = {
  lipsync_footage: "--audio",
  "mint_video:edit": "--video",
  "mint_video:reenact": "--driver-video",
  // videoclaw#272 / backend#302: Higgsfield Genjutsu bills whole seconds of the
  // INPUT clip at the --resolution tier; the gateway re-measures the upload.
  "mint_video:genjutsu": "--video"
};
[
  ...Object.keys(BILLED_MEDIA_BY_KEY),
  "mint_video:insert",
  "mint_video:keyframe",
  "mint_video:multishot"
];
const CLAUDE_CODE_INTERNAL_PLAN_TOOLS = [
  "EnterPlanMode",
  "ExitPlanMode"
];
new Set(CLAUDE_CODE_INTERNAL_PLAN_TOOLS);
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const bridge = {
  readSessionPlan: (scope) => ipcRenderer.invoke(IPC.readSessionPlan, scope),
  chooseSessionPlan: (scope, request) => ipcRenderer.invoke(IPC.chooseSessionPlan, scope, request),
  retrySessionPlan: (scope) => ipcRenderer.invoke(IPC.retrySessionPlan, scope),
  onSessionPlanChanged: (cb) => subscribe(IPC.sessionPlanChanged, cb),
  readProjectMemory: (scope) => ipcRenderer.invoke(IPC.readProjectMemory, scope),
  updateProjectMemory: (scope, mutation) => ipcRenderer.invoke(IPC.updateProjectMemory, scope, mutation),
  undoProjectMemory: (scope, undoId, revision) => ipcRenderer.invoke(IPC.undoProjectMemory, scope, undoId, revision),
  openProjectMemorySource: (scope, source) => ipcRenderer.invoke(IPC.openProjectMemorySource, scope, source),
  onProjectMemoryChanged: (cb) => subscribe(IPC.projectMemoryChanged, cb),
  quickstartCatalog: () => ipcRenderer.invoke(IPC.quickstartCatalog),
  quickstartImpression: (journeyId, catalogSha256, durationMs) => ipcRenderer.invoke(IPC.quickstartImpression, journeyId, catalogSha256, durationMs),
  quickstartPreviewed: (journeyId, starterId, durationMs) => ipcRenderer.invoke(IPC.quickstartPreviewed, journeyId, starterId, durationMs),
  quickstartMark: (stage, durationMs, journeyId) => ipcRenderer.invoke(IPC.quickstartMark, stage, durationMs, journeyId),
  quickstartStart: (req) => ipcRenderer.invoke(IPC.quickstartStart, req),
  createSession: (req) => ipcRenderer.invoke(IPC.createSession, req),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  reorderSessions: (clientId, sessionIds) => ipcRenderer.invoke(IPC.reorderSessions, clientId, sessionIds),
  renameSession: (sessionId, title) => ipcRenderer.invoke(IPC.renameSession, sessionId, title),
  projectDeletionPlan: (sessionId) => ipcRenderer.invoke(IPC.projectDeletionPlan, sessionId),
  deleteProject: (sessionId) => ipcRenderer.invoke(IPC.deleteProject, sessionId),
  getHistory: (sessionId) => ipcRenderer.invoke(IPC.getHistory, sessionId),
  sendMessage: (sessionId, request) => ipcRenderer.invoke(IPC.sendMessage, sessionId, request),
  retryTurn: (sessionId) => ipcRenderer.invoke(IPC.retryTurn, sessionId),
  interrupt: (sessionId, reason) => ipcRenderer.invoke(IPC.interrupt, sessionId, reason),
  setPermissionMode: (sessionId, mode, options) => ipcRenderer.invoke(IPC.setPermissionMode, sessionId, mode, options),
  setSessionModel: (sessionId, model) => ipcRenderer.invoke(IPC.setSessionModel, sessionId, model),
  setSessionReasoningEffort: (sessionId, effort) => ipcRenderer.invoke(IPC.setSessionReasoningEffort, sessionId, effort),
  respondPermission: (requestId, response) => ipcRenderer.send(IPC.respondPermission, requestId, response),
  notePermissionShown: (requestId) => ipcRenderer.send(IPC.notePermissionShown, requestId),
  noteQuitState: (state) => ipcRenderer.send(IPC.noteQuitState, state),
  replayPendingInteractions: () => ipcRenderer.invoke(IPC.replayPendingInteractions),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  revealItem: (path) => ipcRenderer.invoke(IPC.revealItem, path),
  saveItemAs: (path) => ipcRenderer.invoke(IPC.saveItemAs, path),
  playbackCompleted: (path) => ipcRenderer.invoke(IPC.playbackCompleted, path),
  listClients: () => ipcRenderer.invoke(IPC.listClients),
  createClient: (name) => ipcRenderer.invoke(IPC.createClient, name),
  renameClient: (clientId, name) => ipcRenderer.invoke(IPC.renameClient, clientId, name),
  removeClient: (clientId) => ipcRenderer.invoke(IPC.removeClient, clientId),
  reorderClients: (clientIds) => ipcRenderer.invoke(IPC.reorderClients, clientIds),
  seedProjectPack: (clientId, cwd, brief) => ipcRenderer.invoke(IPC.seedProjectPack, clientId, cwd, brief),
  listTaste: (clientId, cwd) => ipcRenderer.invoke(IPC.listTaste, clientId, cwd),
  commitTaste: (cwd, files) => ipcRenderer.invoke(IPC.commitTaste, cwd, files),
  declineProposal: (cwd, file, cards, antiText) => ipcRenderer.invoke(IPC.declineProposal, cwd, file, cards, antiText),
  tasteTitles: (entries) => ipcRenderer.invoke(IPC.tasteTitles, entries),
  charactersList: (cwd) => ipcRenderer.invoke(IPC.charactersList, cwd),
  characterVoicesList: (scope) => ipcRenderer.invoke(IPC.characterVoicesList, scope),
  characterVoiceApprove: (scope, id, sampleSha256) => ipcRenderer.invoke(IPC.characterVoiceApprove, scope, id, sampleSha256),
  characterVoiceRemove: (scope, id) => ipcRenderer.invoke(IPC.characterVoiceRemove, scope, id),
  onCharacterVoicesChanged: (cb) => subscribe(IPC.characterVoicesChanged, cb),
  charactersCreate: (cwd, name, isSelf, photos) => ipcRenderer.invoke(IPC.charactersCreate, cwd, name, isSelf, photos),
  charactersSheetPlan: (cwd, slug) => ipcRenderer.invoke(IPC.charactersSheetPlan, cwd, slug),
  charactersSheetBuild: (cwd, slug) => ipcRenderer.invoke(IPC.charactersSheetBuild, cwd, slug),
  charactersSheetStates: (cwd) => ipcRenderer.invoke(IPC.charactersSheetStates, cwd),
  onCharacterBuild: (cb) => subscribe(IPC.characterBuild, cb),
  charactersApprove: (cwd, slug) => ipcRenderer.invoke(IPC.charactersApprove, cwd, slug),
  charactersRetry: (cwd, slug) => ipcRenderer.invoke(IPC.charactersRetry, cwd, slug),
  charactersDiscard: (cwd, slug) => ipcRenderer.invoke(IPC.charactersDiscard, cwd, slug),
  charactersDelete: (cwd, slug) => ipcRenderer.invoke(IPC.charactersDelete, cwd, slug),
  respondInput: (requestId, response) => ipcRenderer.invoke(IPC.respondInput, requestId, response),
  requestMicAccess: () => ipcRenderer.invoke(IPC.requestMic),
  voiceDictationStatus: () => ipcRenderer.invoke(IPC.voiceDictationStatus),
  transcribeVoice: (sessionId, recordingId, audio) => ipcRenderer.invoke(IPC.transcribeVoice, sessionId, recordingId, audio),
  discardVoice: (sessionId, recordingId) => ipcRenderer.invoke(IPC.discardVoice, sessionId, recordingId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onInputRequest: (cb) => subscribe(IPC.inputRequest, cb),
  getJobSnapshot: (sessionId) => ipcRenderer.invoke(IPC.getJobSnapshot, sessionId),
  getOriginalContext: (sessionId) => ipcRenderer.invoke(IPC.getOriginalContext, sessionId),
  onJobSnapshot: (cb) => subscribe(IPC.jobSnapshot, cb),
  getSpendSnapshot: (sessionId) => ipcRenderer.invoke(IPC.getSpendSnapshot, sessionId),
  outboxAuthoritySnapshot: () => ipcRenderer.invoke(IPC.outboxAuthoritySnapshot),
  telemetryBindReplay: (binding) => ipcRenderer.invoke(IPC.telemetryBindReplay, binding),
  setSpendCeiling: (sessionId, usd, options) => ipcRenderer.invoke(IPC.setSpendCeiling, sessionId, usd, options),
  onSpendSnapshot: (cb) => subscribe(IPC.spendSnapshot, cb),
  adoptJob: (sessionId, jobId) => ipcRenderer.invoke(IPC.adoptJob, sessionId, jobId),
  approveVersion: (sessionId, n) => ipcRenderer.invoke(IPC.approveVersion, sessionId, n),
  revertFinal: (sessionId, n) => ipcRenderer.invoke(IPC.revertFinal, sessionId, n),
  unfinalizeSession: (sessionId) => ipcRenderer.invoke(IPC.unfinalizeSession, sessionId),
  startContinuationChat: (sessionId, clientActionId) => ipcRenderer.invoke(IPC.startContinuationChat, sessionId, clientActionId),
  historicalJobSnapshot: (sessionId) => ipcRenderer.invoke(IPC.historicalJobSnapshot, sessionId),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  saveGatewayKey: (key) => ipcRenderer.invoke(IPC.saveGatewayKey, key),
  switchGateway: (url) => ipcRenderer.invoke(IPC.switchGateway, url),
  restartApp: () => ipcRenderer.invoke(IPC.restartApp),
  getAppUpdatePreferences: () => ipcRenderer.invoke(IPC.getAppUpdatePreferences),
  setAppUpdateChannel: (channel) => ipcRenderer.invoke(IPC.setAppUpdateChannel, channel),
  getAppUpdateState: () => ipcRenderer.invoke(IPC.getAppUpdateState),
  onAppUpdateState: (cb) => subscribe(IPC.appUpdateState, cb),
  downloadAppUpdate: () => ipcRenderer.invoke(IPC.downloadAppUpdate),
  installAppUpdate: () => ipcRenderer.invoke(IPC.installAppUpdate),
  getUpdateInfo: () => ipcRenderer.invoke(IPC.getUpdateInfo),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  onUpdateInfo: (cb) => subscribe(IPC.updateInfo, cb),
  onWindowState: (cb) => subscribe(IPC.windowState, cb),
  verifyGatewayKey: (key) => ipcRenderer.invoke(IPC.verifyGatewayKey, key),
  // Managed account (videoclaw-backend#41). Nothing here carries an ID token, a
  // refresh token or a plaintext vc_ key — main keeps all three.
  accountSnapshot: () => ipcRenderer.invoke(IPC.accountSnapshot),
  accountRefresh: () => ipcRenderer.invoke(IPC.accountRefresh),
  accountSignInGoogle: () => ipcRenderer.invoke(IPC.accountSignInGoogle),
  accountSignInEmail: (email) => ipcRenderer.invoke(IPC.accountSignInEmail, email),
  accountResendEmail: () => ipcRenderer.invoke(IPC.accountResendEmail),
  accountCancelSignIn: () => ipcRenderer.invoke(IPC.accountCancelSignIn),
  onAccountEmailSent: (cb) => subscribe(IPC.accountEmailSent, cb),
  accountSignOut: () => ipcRenderer.invoke(IPC.accountSignOut),
  accountConsent: (termsVersion) => ipcRenderer.invoke(IPC.accountConsent, termsVersion),
  accountEnsureAccess: () => ipcRenderer.invoke(IPC.accountEnsureAccess),
  accountMintKey: () => ipcRenderer.invoke(IPC.accountMintKey),
  accountClaimKey: (key) => ipcRenderer.invoke(IPC.accountClaimKey, key),
  accountLocalResetPrepare: () => ipcRenderer.invoke(IPC.accountLocalResetPrepare),
  accountLocalResetCommit: (planId) => ipcRenderer.invoke(IPC.accountLocalResetCommit, planId),
  onAccountChanged: (cb) => subscribe(IPC.accountChanged, cb),
  keyMeter: () => ipcRenderer.invoke(IPC.keyMeter),
  topUp: (usd) => ipcRenderer.invoke(IPC.topUp, usd),
  claudeCodeStatus: () => ipcRenderer.invoke(IPC.claudeCodeStatus),
  claudeCodeConnect: () => ipcRenderer.invoke(IPC.claudeCodeConnect),
  claudeCodeConnectCancel: () => ipcRenderer.invoke(IPC.claudeCodeConnectCancel),
  claudeCodeSignOutImpact: () => ipcRenderer.invoke(IPC.claudeCodeSignOutImpact),
  claudeCodeSignOut: () => ipcRenderer.invoke(IPC.claudeCodeSignOut),
  llmRouteReadiness: (sessionId) => ipcRenderer.invoke(IPC.llmRouteReadiness, sessionId),
  codexStatus: () => ipcRenderer.invoke(IPC.codexStatus),
  codexConnectChatGpt: () => ipcRenderer.invoke(IPC.codexConnectChatGpt),
  codexConnectCancel: () => ipcRenderer.invoke(IPC.codexConnectCancel),
  codexDisconnectImpact: () => ipcRenderer.invoke(IPC.codexDisconnectImpact),
  codexDisconnectChatGpt: () => ipcRenderer.invoke(IPC.codexDisconnectChatGpt),
  codexModels: () => ipcRenderer.invoke(IPC.codexModels),
  creditHandoffOffer: (sessionId) => ipcRenderer.invoke(IPC.creditHandoffOffer, sessionId),
  continueOnCredits: (sessionId, request) => ipcRenderer.invoke(IPC.continueOnCredits, sessionId, request),
  claudeModels: () => ipcRenderer.invoke(IPC.claudeModels),
  codexHandoffOffer: (sessionId) => ipcRenderer.invoke(IPC.codexHandoffOffer, sessionId),
  continueOnCodex: (sessionId, clientActionId) => ipcRenderer.invoke(IPC.continueOnCodex, sessionId, clientActionId),
  agentProviderKeyStatus: () => ipcRenderer.invoke(IPC.agentProviderKeyStatus),
  saveAgentProviderKey: (provider, key) => ipcRenderer.invoke(IPC.saveAgentProviderKey, provider, key),
  libraryStats: (clientId, cwd) => ipcRenderer.invoke(IPC.libraryStats, clientId, cwd),
  libraryScan: (clientId, cwd) => ipcRenderer.invoke(IPC.libraryScan, clientId, cwd),
  libraryAddSource: (clientId, cwd, type, path) => ipcRenderer.invoke(IPC.libraryAddSource, clientId, cwd, type, path),
  libraryRemoveSource: (clientId, cwd, path, purge) => ipcRenderer.invoke(IPC.libraryRemoveSource, clientId, cwd, path, purge),
  librarySync: (clientId, cwd) => ipcRenderer.invoke(IPC.librarySync, clientId, cwd),
  librarySearch: (clientId, cwd, query, type, tenants) => ipcRenderer.invoke(
    IPC.librarySearch,
    clientId,
    cwd,
    query,
    type,
    tenants
  ),
  libraryPreview: (cwd, sourceFile, inSec, outSec) => ipcRenderer.invoke(IPC.libraryPreview, cwd, sourceFile, inSec, outSec),
  librarySetTenant: (clientId, tenant) => ipcRenderer.invoke(IPC.librarySetTenant, clientId, tenant),
  bootstrapStatus: () => ipcRenderer.invoke(IPC.bootstrapStatus),
  bootstrapRun: () => ipcRenderer.invoke(IPC.bootstrapRun),
  bootstrapRevertEngine: () => ipcRenderer.invoke(IPC.bootstrapRevertEngine),
  bootstrapRevealSetupLog: () => ipcRenderer.invoke(IPC.bootstrapRevealSetupLog),
  onBootstrapProgress: (cb) => subscribe(IPC.bootstrapProgress, cb),
  enginePendingToast: () => ipcRenderer.invoke(IPC.enginePendingToast),
  onEngineUpdated: (cb) => subscribe(IPC.engineUpdated, cb),
  getStageEtas: (cwd) => ipcRenderer.invoke(IPC.stageEtas, cwd),
  intakePickFiles: (scope) => ipcRenderer.invoke(IPC.intakePickFiles, scope),
  attachmentStage: (req) => ipcRenderer.invoke(IPC.attachmentStage, req),
  attachmentList: (sessionId) => ipcRenderer.invoke(IPC.attachmentList, sessionId),
  attachmentOwnership: (sessionId, attachmentId) => ipcRenderer.invoke(IPC.attachmentOwnership, sessionId, attachmentId),
  attachmentRemove: (sessionId, attachmentId) => ipcRenderer.invoke(IPC.attachmentRemove, sessionId, attachmentId),
  attachmentRetry: (sessionId, attachmentId) => ipcRenderer.invoke(IPC.attachmentRetry, sessionId, attachmentId),
  attachmentDestination: (sessionId, attachmentIds, destination) => ipcRenderer.invoke(IPC.attachmentDestination, sessionId, attachmentIds, destination),
  attachmentPasteImage: (sessionId, destination, png) => ipcRenderer.invoke(IPC.attachmentPasteImage, sessionId, destination, png),
  attachmentVoiceNote: (sessionId, recordingId, audio) => ipcRenderer.invoke(IPC.attachmentVoiceNote, sessionId, recordingId, audio),
  attachmentCaptureMoment: (req) => ipcRenderer.invoke(IPC.attachmentCaptureMoment, req),
  attachmentMomentPreview: (sessionId, attachmentId, full) => ipcRenderer.invoke(IPC.attachmentMomentPreview, sessionId, attachmentId, full),
  attachmentPreview: (sessionId, attachmentId, full) => ipcRenderer.invoke(IPC.attachmentPreview, sessionId, attachmentId, full),
  onAttachmentChanged: (cb) => subscribe(IPC.attachmentChanged, cb),
  materialPreview: (sessionId, id) => ipcRenderer.invoke(IPC.materialPreview, sessionId, id),
  onMaterialsChanged: (cb) => subscribe(IPC.materialsChanged, cb),
  feedbackCapture: (req) => ipcRenderer.invoke(IPC.feedbackCapture, req),
  feedbackSubmit: (req) => ipcRenderer.invoke(IPC.feedbackSubmit, req),
  feedbackDiscard: (reportId) => ipcRenderer.invoke(IPC.feedbackDiscard, reportId),
  feedbackGrantUsageSharing: () => ipcRenderer.invoke(IPC.feedbackGrantUsageSharing),
  workflowSubmitEligibility: () => ipcRenderer.invoke(IPC.workflowSubmitEligibility),
  workflowSubmit: (req) => ipcRenderer.invoke(IPC.workflowSubmitStart, req),
  editorRenderStart: (req) => ipcRenderer.invoke(IPC.editorRenderStart, req),
  editorRenderCancel: (requestId) => ipcRenderer.invoke(IPC.editorRenderCancel, requestId),
  editorRenderState: () => ipcRenderer.invoke(IPC.editorRenderState),
  onEditorRenderEvent: (cb) => subscribe(IPC.editorRenderEvent, cb),
  hfPreviewAvailable: (sessionId, jobId) => ipcRenderer.invoke(IPC.hfPreviewAvailable, sessionId, jobId),
  hfPreviewStart: (req) => ipcRenderer.invoke(IPC.hfPreviewStart, req),
  hfPreviewStop: () => ipcRenderer.invoke(IPC.hfPreviewStop),
  hfEditApply: (req) => ipcRenderer.invoke(IPC.hfEditApply, req),
  onHfPreviewEvent: (cb) => subscribe(IPC.hfPreviewEvent, cb),
  onLibrarySync: (cb) => subscribe(IPC.librarySyncProgress, cb),
  onSessionEvent: (cb) => subscribe(IPC.sessionEvent, cb),
  onSessionsChanged: (cb) => subscribe(IPC.sessionsChanged, cb),
  onQuickstartCatalogChanged: (cb) => subscribe(IPC.quickstartCatalogChanged, cb),
  onPermissionRequest: (cb) => subscribe(IPC.permissionRequest, cb)
};
contextBridge.exposeInMainWorld("videoclaw", bridge);
