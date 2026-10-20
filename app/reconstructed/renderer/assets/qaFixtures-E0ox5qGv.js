import {
  s as settledAskFromPermission,
  I as INSECURE_STORAGE_COPY,
  f as feedbackConsentState,
  q as quotedSpendDescription,
  r as recommendedClaudeModelIds,
  p as partitionDiscoveredCodexModels,
  u as unknownCostHoldDescription,
  a as raiseBudgetDescription,
} from "./index-D5K1mOs0.js";
const QA_SPEND_SNAPSHOT = {
  policy: "capped",
  ceilingUsd: 12,
  spentUsd: 3.1,
  reservedUsd: 2.9,
  remainingUsd: 6,
  unknownSpend: false,
};
const QA_KEY_METER = {
  name: "Alpha key",
  spentUsd: 21.5,
  limitUsd: 25,
  limitTotalUsd: null,
  spentTotalUsd: 63.2,
  topupBalanceUsd: 12,
  reservedUsd: 0,
  availableUsd: 15.5,
  effectiveLimitUsd: 37,
  topupMinUsd: 5,
  topupMaxUsd: 200,
};
const qaOptionalUpdate = {
  version: "0.0.9",
  minSupported: "0.0.1",
  dmgUrl: "https://qa-lander.invalid/alpha/download",
  notes: "",
  blocked: false,
  currentVersion: "0.0.4",
};
let qaAppUpdateState = { status: "idle", version: null, percent: null, message: null };
const qaAppUpdateListeners = /* @__PURE__ */ new Set();
function qaPushAppUpdate(patch) {
  qaAppUpdateState = { ...qaAppUpdateState, ...patch };
  for (const cb of qaAppUpdateListeners) cb(qaAppUpdateState);
}
let qaPublishedUpdate = null;
const qaBootstrapProgressCbs = /* @__PURE__ */ new Set();
const qaBootstrapStatus = {
  ready: true,
  workspacePath: "/qa/workspace",
  shouldOffer: false,
  packaged: false,
  devMode: true,
  doctor: {
    ok: true,
    engine: "/qa/engine",
    workspace: "/qa/workspace",
    checks: {
      ffmpeg: { ok: true, detail: "ok" },
      ffprobe: { ok: true, detail: "ok" },
      node: { ok: true, detail: "ok" },
      "python venv": { ok: true, detail: "ok" },
      "yt-dlp": { ok: true, detail: "ok" },
      remotion: { ok: true, detail: "ok" },
      gateway: { ok: true, detail: "ok" },
      workspace: { ok: true, detail: "ok" },
      hooks: { ok: true, detail: "ok" },
      "taste packs": { ok: true, detail: "ok" },
    },
  },
};
const now = Date.now();
const JOB = "/qa/workspace/jobs/job-desk-reel";
const qaCodexWithdrawn = new URLSearchParams(window.location.search).has("codex-withdrawn");
const qaCodexNoAstra = new URLSearchParams(window.location.search).has("codex-no-astra");
const qaClaudeUnlistedPin = new URLSearchParams(window.location.search).has("claude-unlisted")
  ? "claude-opus-4-8"
  : void 0;
const qaClaudeEffortUntested = new URLSearchParams(window.location.search).has(
  "claude-effort-untested",
);
const qaClaudeGateway = new URLSearchParams(window.location.search).has("claude-gateway");
const qaWorkflowEligible = new URLSearchParams(window.location.search).has("workflow-eligible");
const qaBypass = new URLSearchParams(window.location.search).has("bypass");
const qaWindow = window;
qaWindow.__qaSpendCeilingCalls = [];
let qaSpendCeilingHold = null;
qaWindow.__qaHoldSpendCeiling = () => {
  let release;
  qaSpendCeilingHold = new Promise((resolve) => {
    release = resolve;
  });
  return release;
};
const qaSetSnapshots = /* @__PURE__ */ new Map();
let qaSessionsChanged = null;
const qaOnboardingPreview = new URLSearchParams(window.location.search).has("onboarding-preview");
const qaSupportRequired = new URLSearchParams(window.location.search).has("support-required");
const qaKeychainRefused = new URLSearchParams(window.location.search).get("keychain-refused");
let qaKeychainKnown = qaKeychainRefused === "launch";
let qaAccountChanged = null;
const qaKeychainSnapshot = () => ({
  loaded: true,
  signInAvailable: true,
  signedIn: false,
  account: null,
  hasStoredKey: false,
  verifyingKey: false,
  pendingKey: false,
  secureStorageUnavailable: qaKeychainKnown,
  credentialVaultUnreadable: true,
  accountUnavailable: false,
  legacyKeyOnly: false,
  accountSignedInOnce: true,
  step: "signed-out",
  bundledTermsVersion: "alpha-fixture",
  canAcceptTerms: false,
});
const codexEfforts = (...ids) => ids.map((effort) => ({ effort }));
const codexDiscovered = [
  {
    id: "gpt-6-astra",
    model: "gpt-6-astra",
    displayName: "GPT-6-Astra",
    description: "Frontier reasoning",
    isDefault: true,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: codexEfforts(
      "low",
      "medium",
      "high",
      "xhigh",
      ...(qaCodexWithdrawn ? [] : ["max", "ultra"]),
    ),
  },
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6-Sol",
    isDefault: false,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: codexEfforts("low", "medium", "high", "xhigh", "max", "ultra"),
  },
  {
    id: "gpt-5.6-terra",
    model: "gpt-5.6-terra",
    displayName: "GPT-5.6-Terra",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: codexEfforts("low", "medium", "high", "xhigh", "max", "ultra"),
  },
  {
    id: "gpt-5.6-luna",
    model: "gpt-5.6-luna",
    displayName: "GPT-5.6-Luna",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: codexEfforts("low", "medium", "high", "xhigh", "max"),
  },
  {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: codexEfforts("low", "medium", "high", "xhigh"),
  },
];
const qaCodexCatalog = () => {
  const account = qaCodexNoAstra
    ? codexDiscovered
        .filter((model) => model.id !== "gpt-6-astra")
        .map((model, index) => ({ ...model, isDefault: index === 0 }))
    : codexDiscovered;
  const { selectable, recommended, incompatible, runtimeDefault } = partitionDiscoveredCodexModels(
    "chatgpt",
    account,
  );
  return selectable.length
    ? { ok: true, models: selectable, recommended, incompatible, runtimeDefault }
    : {
        ok: false,
        reason: "failed",
        message: "Codex lists no model VideoClaw can run for this account.",
        incompatible,
        runtimeDefault,
      };
};
const qaClaudeCatalog = () => {
  const mode = qaClaudeEffortUntested
    ? "untested"
    : new URLSearchParams(window.location.search).get("claude-catalog");
  if (mode === "failed") {
    return {
      ok: false,
      reason: "failed",
      message: "Claude Code took too long to list its models. Try again.",
    };
  }
  const ids = [...recommendedClaudeModelIds("claude-code")];
  const models = ids.map((id) => ({ id, displayName: id, description: id }));
  if (mode === "untested") {
    models.push({
      id: "claude-nova-6",
      displayName: "Nova 6",
      description: "Newest model",
      supportedEffortLevels: ["low", "high"],
    });
  }
  return {
    ok: true,
    models,
    recommended: ids,
    discovered: models.map((m) => m.id),
  };
};
const sessions = [
  {
    sessionId: "s1",
    title: "Desk-setup reel",
    cwd: "/qa/workspace",
    status: new URLSearchParams(window.location.search).has("composer-waiting")
      ? "awaiting_permission"
      : new URLSearchParams(window.location.search).has("composer-running")
        ? "running"
        : "idle",
    ...(new URLSearchParams(window.location.search).has("composer-running")
      ? {
          turnStartedAtMs:
            now -
            Number(new URLSearchParams(window.location.search).get("elapsed-seconds") || 90) * 1e3,
        }
      : {}),
    permissionMode: "default",
    totalCostUsd: 1.42,
    createdAt: now - 864e5,
    clientId: "humeo",
    jobId: "job-desk-reel",
    qaMarkedAtMs: now - 36e5,
    ...(qaClaudeUnlistedPin ? { modelOverride: qaClaudeUnlistedPin } : {}),
    ...(qaClaudeEffortUntested
      ? { modelOverride: "claude-nova-6", claudeReasoningEffort: "high" }
      : {}),
    // #1064 — `?qa&late-results&import-failed` also shows the three-failure
    // banner for a finished result; `&check-failed` for one still unknown.
    // #1116 — `&check-failed` is an accepted (paid) request; `&check-unknown`
    // one the app cannot tell; `&not-accepted` one the gateway never accepted.
    // videoclaw#322 — `&billing-support` for a delivered result whose bill
    // needs support to settle.
    ...(new URLSearchParams(window.location.search).has("import-failed")
      ? { mediaRecoveryNeeded: true, mediaRecoveryIssue: { code: "import_failed" } }
      : new URLSearchParams(window.location.search).has("check-failed")
        ? { mediaRecoveryNeeded: true, mediaRecoveryIssue: { code: "check_failed", paid: true } }
        : new URLSearchParams(window.location.search).has("check-unknown")
          ? { mediaRecoveryNeeded: true, mediaRecoveryIssue: { code: "check_failed" } }
          : new URLSearchParams(window.location.search).has("not-accepted")
            ? { mediaRecoveryNeeded: true, mediaRecoveryIssue: { code: "not_accepted" } }
            : new URLSearchParams(window.location.search).has("billing-support")
              ? { mediaRecoveryNeeded: true, mediaRecoveryIssue: { code: "billing_support" } }
              : {}),
  },
  {
    // #843 — under `?qa&adopt` this video carries the fail-closed adoption
    // offer. It has no jobId and getJobSnapshot returns null for it, so the
    // OUTPUT rail is the AdoptCard rather than the Output panel.
    sessionId: "s2",
    title: "Coffee-gear teaser",
    cwd: "/qa/workspace",
    status: "idle",
    permissionMode: qaBypass ? "bypassPermissions" : "default",
    totalCostUsd: 0,
    createdAt: now - 1728e5,
    clientId: "personal",
    ...(new URLSearchParams(window.location.search).has("adopt")
      ? {
          adoptCandidate: {
            jobId: "job-desk-reel",
            ownerSessionId: "s1",
            ownerTitle: "Desk-setup reel",
            reason: "owned",
          },
        }
      : {}),
  },
  {
    // Deliberately hostile title — regression witness for the sidebar row's
    // ellipsis/⋯-button gutter (JC's live repro wording).
    sessionId: "s3",
    title: "can you take a VO from me and make it fit the pacing of the reel",
    cwd: "/qa/workspace",
    status: "idle",
    permissionMode: "default",
    totalCostUsd: 0.35,
    createdAt: now - 2592e5,
    clientId: "personal",
  },
  {
    // #108 — the Codex video: the composer's model and reasoning-depth pickers
    // render only for this harness. Unpinned by default, so the depth control
    // reads VideoClaw's recommendation until a turn or a click pins one.
    sessionId: "s4",
    title: "Launch teaser — Codex",
    cwd: "/qa/workspace",
    status: "idle",
    permissionMode: "default",
    totalCostUsd: 0.18,
    createdAt: now - 432e5,
    clientId: "personal",
    agentHarness: "codex-app-server",
    codexProvider: "chatgpt",
    codexResolvedModel: "gpt-6-astra",
    // #589 — under `?qa&codex-no-astra` this video is PINNED to a model the
    // connected account no longer has. It must stay named and stay refused,
    // never quietly relocated to whatever else is qualified.
    ...(qaCodexNoAstra ? { modelOverride: "gpt-6-astra" } : {}),
    ...(qaCodexWithdrawn ? { codexReasoningEffort: "ultra" } : {}),
  },
];
const VO_SCRIPT = `Morning light through the window, and the desk is already awake.

This setup started with one rule: nothing on the surface that doesn't earn its place. The monitor floats, the keyboard sits low, and the cables — all of them — live underneath in one quiet tray.

The lamp is warm on purpose. Cold light makes late nights feel like work; warm light makes them feel like a studio.

Everything within reach, nothing in the way. The plant is the only thing allowed to sprawl.

If you're building your own corner like this, start with the cable tray. It's the least glamorous thing on the desk and it changes everything.

That's the whole tour. Thirty seconds, one desk, zero clutter.`;
const voRequest = {
  requestId: "qa-vo-1",
  sessionId: "s1",
  kind: "voiceover",
  prompt: VO_SCRIPT,
  destDir: `${JOB}/vo`,
};
const clients = [
  { clientId: "personal", name: "Personal" },
  { clientId: "humeo", name: "Humeo", tenant: "humeo" },
];
let moneySeq = 0;
const moneyRequest = (priced) => ({
  requestId: `qa-money-${++moneySeq}`,
  sessionId: "s1",
  kind: "money",
  toolName: "Bash",
  input: {
    command: `python tools/mint_image.py --job job-desk-reel --count 1 --frame ${moneySeq}`,
  },
  ...(priced ? { estimateUsd: 0.04, estimateCount: 1 } : {}),
  ...(new URLSearchParams(window.location.search).has("estimated-spend")
    ? {
        estimateUsd: 0.08,
        reservationUsd: 0.1,
        settlementPolicy: "estimated_actual_v1",
        description: quotedSpendDescription("Creating a still", {
          estimateUsd: 0.08,
          maximumUsd: 0.1,
        }),
      }
    : {}),
});
let unknownCostSeq = 0;
const unknownCostRequest = () => ({
  requestId: `qa-unknown-cost-${++unknownCostSeq}`,
  sessionId: "s1",
  kind: "money",
  toolName: "model_call",
  input: { operation: "model_call", mode: null },
  description: unknownCostHoldDescription(10),
  settlementPolicy: "unknown_actual_v1",
  reservationUsd: 10,
});
let budgetSeq = 0;
const estimatedRaiseRequest = () => ({
  requestId: `qa-budget-${++budgetSeq}`,
  sessionId: "s1",
  kind: "budget",
  toolName: "mint_video",
  input: { operation: "mint_video", mode: "keyframe" },
  title: "Raise spending limit?",
  description: raiseBudgetDescription("Generating footage", 38.91),
  estimateUsd: 10.23,
  settlementPolicy: "estimated_actual_v1",
  reservationUsd: 12.79,
  budgetUsd: 38.91,
  budgetCeilingUsd: 30,
  budgetRaiseUsd: 8.91,
  budgetBlockReason: "over_ceiling",
});
const budgetRequest = (state) => ({
  requestId: `qa-budget-${++budgetSeq}`,
  sessionId: "s1",
  kind: "budget",
  toolName: "mcp__studio__set_video_budget",
  input: { amount_usd: 10 },
  title: "Set a $10.00 maximum for this video?",
  description: "This is a hard total limit for paid work in this video.",
  budgetUsd: 10,
  ...(state === "headroom"
    ? { budgetReservedUsd: 8, budgetCeilingUsd: 12 }
    : state === "past-ceiling"
      ? { budgetReservedUsd: 7.5, budgetCeilingUsd: 8, budgetRaiseUsd: 2 }
      : state
        ? { budgetReservedUsd: 4, budgetCeilingUsd: 10 }
        : {}),
});
const asset = (rel, kind, mb) => ({
  path: `${JOB}/${rel}`,
  name: rel.split("/").pop(),
  kind,
  scope: "output",
  mtimeMs: now - 72e5,
  sizeBytes: mb * 1e6,
});
const assets = [
  // Deliberately hostile filename — regression fixture for label truncation.
  asset("broll/match_IMG_0064_00m00s-00m03s_desk_wide_establishing.mp4", "video", 21),
  asset("broll/desk_pan.mp4", "video", 18),
  asset("broll/keyboard_close.mp4", "video", 12),
  asset("broll/window_light.mp4", "video", 15),
  asset("images/hero_desk.png", "image", 2.1),
  asset("images/plant_detail.png", "image", 1.8),
  asset("images/monitor_glow.png", "image", 2.4),
  asset("images/cable_tray.png", "image", 1.2),
  asset("audio/music_bed_v1.mp3", "audio", 4.2),
  asset("audio/music_bed_alt.mp3", "audio", 3.9),
  asset("vo/vo_take1.wav", "audio", 6.1),
  asset("vo/vo_take2.wav", "audio", 5.8),
];
const snapshot = {
  jobId: "job-desk-reel",
  jobPath: JOB,
  renders: [
    {
      path: `${JOB}/working-preview.mp4`,
      name: "working-preview.mp4",
      mtimeMs: now - 35e5,
      sizeBytes: 24e6,
    },
  ],
  assets,
  assetCounts: { videos: 3, images: 4, audio: 4 },
  spendUsd: 3.1,
  spendItems: [
    { key: "video", label: "Video generation", usd: 2.7, count: 3 },
    { key: "voice", label: "Voice generation", usd: 0.4, count: 1 },
  ],
  qaMarkedAtMs: now - 35e5,
  versions: [
    {
      n: 1,
      path: `${JOB}/versions/v1.mp4`,
      createdAtMs: now - 86e6,
      sizeBytes: 23e6,
      approved: false,
      reviewed: true,
      feedback: ["Tighter cuts in the middle", "Warmer grade on the window shots"],
    },
    {
      n: 2,
      path: `${JOB}/versions/v2.mp4`,
      createdAtMs: now - 35e5,
      sizeBytes: 24e6,
      approved: false,
      reviewed: true,
      feedback: [],
    },
  ],
  cut: {
    source: "timeline",
    usedPaths: [
      `${JOB}/broll/desk_pan.mp4`,
      `${JOB}/broll/window_light.mp4`,
      `${JOB}/images/hero_desk.png`,
      `${JOB}/images/monitor_glow.png`,
      `${JOB}/audio/music_bed_v1.mp3`,
      `${JOB}/vo/vo_take1.wav`,
    ],
    anchor: 2,
    perVersion: {},
    unresolved: [],
    note: "From the edit map: footage and stills are exact; music and voice are matched by delivery.",
  },
};
const qaSpendState = () => {
  const state = new URLSearchParams(window.location.search).get("spend");
  return state === "empty" ||
    state === "assets" ||
    state === "near" ||
    state === "over" ||
    state === "unknown" ||
    state === "no-budget"
    ? state
    : "partial";
};
const qaOutputState = () => {
  const state = new URLSearchParams(window.location.search).get("output");
  return state === "candidate" || state === "attention" || state === "working" ? state : "default";
};
const qaJobSnapshot = () => {
  const state = qaSpendState();
  if (state === "empty") {
    return {
      ...snapshot,
      renders: [],
      assets: [],
      assetCounts: { videos: 0, images: 0, audio: 0 },
      versions: [],
      spendUsd: 0,
      spendItems: [],
    };
  }
  const outputState = qaOutputState();
  if (outputState === "candidate") {
    return {
      ...snapshot,
      qaMarkedAtMs: null,
      versions: [],
      renders: [
        {
          path: `${JOB}/final.mp4`,
          name: "final.mp4",
          mtimeMs: now - 1e3,
          sizeBytes: 24e6,
          isCandidate: true,
        },
        ...snapshot.renders,
      ],
    };
  }
  if (outputState === "working") {
    return {
      ...snapshot,
      qaMarkedAtMs: null,
      renders: [
        {
          path: `${JOB}/final.mp4`,
          name: "final.mp4",
          mtimeMs: now - 4e3,
          sizeBytes: 24e6,
          isCandidate: true,
          versionN: 1,
        },
        ...snapshot.renders,
      ],
      versions: [
        {
          n: 1,
          path: `${JOB}/versions/v1.mp4`,
          createdAtMs: now - 4e3,
          sizeBytes: 24e6,
          approved: false,
          reviewed: false,
          feedback: [],
        },
      ],
    };
  }
  if (outputState === "attention") {
    return {
      ...snapshot,
      renders: [
        {
          path: `${JOB}/final.mp4`,
          name: "final.mp4",
          mtimeMs: now - 4e3,
          sizeBytes: 24e6,
          isCandidate: true,
          versionN: 1,
        },
        ...snapshot.renders,
      ],
      versions: [
        {
          n: 1,
          path: `${JOB}/versions/v1.mp4`,
          createdAtMs: now - 3500,
          sizeBytes: 24e6,
          qaStatus: "needs_attention",
          approved: false,
          reviewed: true,
          feedback: [],
        },
      ],
    };
  }
  if (state === "assets") return { ...snapshot, spendUsd: 0, spendItems: [] };
  if (state === "near") return { ...snapshot, spendUsd: 8.5 };
  if (state === "over") return { ...snapshot, spendUsd: 13.25 };
  return snapshot;
};
const qaSpendSnapshot = () => {
  switch (qaSpendState()) {
    case "empty":
    case "assets":
      return { policy: "ask_each", reservedUsd: 0, unknownSpend: false };
    case "near":
      return {
        policy: "capped",
        ceilingUsd: 12,
        spentUsd: 8.5,
        reservedUsd: 1.5,
        remainingUsd: 2,
        unknownSpend: false,
      };
    case "over":
      return {
        policy: "capped",
        ceilingUsd: 12,
        spentUsd: 13.25,
        reservedUsd: 0,
        remainingUsd: 0,
        unknownSpend: false,
      };
    case "unknown":
      return {
        policy: "capped",
        ceilingUsd: 12,
        spentUsd: 3.1,
        reservedUsd: 2,
        unknownSpend: true,
      };
    case "no-budget":
      return { policy: "ask_each", spentUsd: 3.1, reservedUsd: 0, unknownSpend: false };
    default:
      return { ...QA_SPEND_SNAPSHOT };
  }
};
const history = [
  {
    kind: "user_text",
    atMs: 178950246e4,
    text: "Make me a 30s reel about my desk setup — cozy, fast cuts.",
  },
  {
    kind: "tool_start",
    toolUseId: "q0a",
    toolName: "Bash",
    summary: "Reviewing the project",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q0a", isError: false },
  {
    kind: "tool_start",
    toolUseId: "q0b",
    toolName: "Bash",
    summary: "Checking the budget",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q0b", isError: false },
  {
    kind: "tool_start",
    toolUseId: "q0c",
    toolName: "Bash",
    summary: "Checking the budget",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q0c", isError: false },
  {
    kind: "tool_start",
    toolUseId: "q1",
    toolName: "Bash",
    summary: "Planning the story",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q1", isError: false },
  {
    kind: "tool_start",
    toolUseId: "q2",
    toolName: "Bash",
    summary: "Generating footage — desk b-roll",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q2", isError: false },
  {
    kind: "tool_start",
    toolUseId: "q3",
    toolName: "Bash",
    summary: "Assembling the video",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "q3", isError: false },
  {
    kind: "assistant_text",
    atMs: 178950258e4,
    text:
      "V2 is up — tighter cuts through the middle and the warmer grade on the window shots. Take a look in the output panel." +
      (new URLSearchParams(window.location.search).has("code-copy")
        ? '\n\n```js\nconst caption = "Keep the warmer grade on the window shots.";\n```'
        : ""),
  },
];
const codexHistory = [
  { kind: "user_text", text: "Cut a 15s launch teaser from the three clips I dropped in." },
  {
    kind: "tool_start",
    toolUseId: "c1",
    toolName: "Bash",
    summary: "Reviewing the project",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "c1", isError: false },
  {
    kind: "tool_start",
    toolUseId: "c2",
    toolName: "Bash",
    summary: "Assembling the video",
    detail: "",
  },
  { kind: "tool_end", toolUseId: "c2", isError: false },
  {
    kind: "assistant_text",
    text: "First pass is up — 14s, hook on the unboxing frame. Tell me where to tighten it.",
  },
];
const taste = {
  scopes: [
    {
      scope: "default",
      label: "Defaults",
      file: "/qa/workspace/taste/DEFAULTS.md",
      cards: [
        "## Pacing\nCut on action; nothing holds longer than 2.5s unless it is the hook.",
        "## Captions\nBurned-in, high-contrast, max two lines.",
      ],
      antiCards: [],
      readonly: true,
      exists: true,
    },
    {
      scope: "global",
      label: "You",
      file: "/qa/workspace/taste/YOU.md",
      cards: [
        "**[voice]** **Always use my real voice.** Never a synth read for the main VO. *(2026-06-30)*",
        "**Hooks land inside the first second.** No logo stings, no fade-ins. *(2026-07-04)*",
      ],
      antiCards: ["Auto-captions on every cut *(declined 2026-07-02)*"],
      exists: true,
    },
    {
      scope: "client",
      label: "This project",
      file: "/qa/workspace/taste/packs/humeo/README.md",
      cards: ["**Grade warm.** Lean amber, never teal-orange. *(2026-07-08)*"],
      antiCards: [],
      exists: true,
    },
  ],
  proposals: [
    {
      id: "p1",
      targetScope: "global",
      file: "/qa/workspace/taste/YOU.md",
      takeaway: "**End on a still.** The last frame holds a beat before the loop.",
      count: 3,
      quote: "love how it lands on the freeze frame again",
    },
  ],
};
const qaAttachment = (id, name, status, copiedBytes, error) => ({
  id,
  sessionId: "s1",
  name,
  sizeBytes: 8e6,
  destination: "video",
  status,
  copiedBytes,
  canRetry: status === "failed",
  ...(error ? { error } : {}),
});
let qaAttachments = new URLSearchParams(window.location.search).has("attachments")
  ? [
      qaAttachment("qa-att-ready", "desk-reference-wide.mp4", "ready", 8e6),
      qaAttachment("qa-att-uploading", "voiceover-take.wav", "uploading", 52e5),
      qaAttachment(
        "qa-att-failed",
        "moved-photo.png",
        "failed",
        0,
        "That file moved. Retry after restoring it.",
      ),
      // Issue #475 — opaque source bytes render as ordinary cards.
      qaAttachment("qa-att-svg", "brand-logo.svg", "ready", 8e6),
      qaAttachment("qa-att-zip", "brand-kit.zip", "ready", 8e6),
    ]
  : [];
let qaAttachmentChanged = null;
let qaLostAck = new URLSearchParams(window.location.search).has("lost-attachment-ack");
const qaFeedbackConsent = { telemetry: false };
const qaMaterial = (over) => ({
  kind: "video",
  origin: "upload",
  destination: "video",
  addedAtMs: now,
  state: "present",
  ...over,
});
const QA_MATERIALS = [
  qaMaterial({ id: "m1", name: "desk-wide-01.mp4", sizeBytes: 412 * 1024 * 1024 }),
  qaMaterial({ id: "m2", name: "desk-closeup-02.mov", sizeBytes: 168 * 1024 * 1024 }),
  qaMaterial({
    id: "m3",
    name: "keyboard-swatch.png",
    kind: "image",
    origin: "paste",
    sizeBytes: 840 * 1024,
  }),
  qaMaterial({
    id: "m4",
    name: "brand-lockup.png",
    kind: "image",
    destination: "library",
    sizeBytes: 2 * 1024 * 1024,
  }),
  qaMaterial({
    id: "m5",
    name: "client-interview.mov",
    origin: "studio-files",
    sizeBytes: 1290 * 1024 * 1024,
  }),
  qaMaterial({
    id: "m6",
    name: "vo_take2.wav",
    kind: "audio",
    origin: "voiceover",
    takes: 3,
    sizeBytes: 18 * 1024 * 1024,
  }),
  qaMaterial({
    id: "m7",
    name: "hook-frame.png",
    kind: "image",
    origin: "quickstart",
    detail: "desk-setup-reel",
    sizeBytes: 1100 * 1024,
  }),
  qaMaterial({
    id: "m8",
    name: "youtube.com/watch?v=7fT0nQ2xK1c",
    origin: "agent-pull",
    state: "unverified",
  }),
];
let qaMaterialsSession = "s1";
let qaMaterialsLedger = {
  sessionId: "s1",
  total: QA_MATERIALS.length,
  entries: QA_MATERIALS,
};
const qaMaterialsChanged = /* @__PURE__ */ new Set();
const qaSessionEventListeners = /* @__PURE__ */ new Set();
const emitQaSessionEvent = (sessionId, event) => {
  qaSessionEventListeners.forEach((listener) => listener({ sessionId, event }));
};
const longTranscriptHistory = () =>
  Array.from({ length: 36 }, (_, turn) => [
    {
      kind: "user_text",
      turnId: `long-${turn}`,
      text: `Pass ${turn + 1}: tighten the middle and keep the warmer grade.`,
    },
    ...["Reviewing the project", "Planning the story", "Assembling the video"].flatMap(
      (summary, step) => [
        {
          kind: "tool_start",
          toolUseId: `long-${turn}-${step}`,
          toolName: "Bash",
          summary,
          detail: "",
        },
        { kind: "tool_end", toolUseId: `long-${turn}-${step}`, isError: false },
      ],
    ),
    ...(turn % 6 === 0 && QA_MATERIALS[turn / 6]
      ? [{ kind: "material_arrived", entry: QA_MATERIALS[turn / 6] }]
      : []),
    ...(turn === 8
      ? [
          {
            kind: "ask_settled",
            record: settledAskFromPermission(
              {
                requestId: "long-ask",
                kind: "permission",
                toolName: "Bash",
                title: "Render a draft cut",
              },
              "approved",
            ),
          },
        ]
      : []),
    {
      kind: "assistant_text",
      messageId: `long-a${turn}`,
      text: `**Pass ${turn + 1} is up.**

- The hook lands inside the first second.
- The middle is ${turn + 2}s tighter.

Tell me what to change next.`,
    },
    ...(turn === 12
      ? [{ kind: "error", message: "That render step failed, so I retried it and kept going." }]
      : []),
  ]).flat();
const qaPendingAsks = /* @__PURE__ */ new Map();
const qaFire = (request, cb) => {
  qaPendingAsks.set(request.requestId, request);
  cb(request);
};
function qaMaterialsFor(state) {
  if (state === "empty") return { sessionId: qaMaterialsSession, total: 0, entries: [] };
  if (state === "missing") {
    return {
      sessionId: qaMaterialsSession,
      total: QA_MATERIALS.length,
      entries: QA_MATERIALS.map((entry) =>
        entry.id === "m5" ? { ...entry, state: "missing" } : entry,
      ),
    };
  }
  return { sessionId: qaMaterialsSession, total: QA_MATERIALS.length, entries: QA_MATERIALS };
}
const qaPlanState = new URLSearchParams(window.location.search).get("session-plan");
const qaPlanKeyId = "a".repeat(64);
function qaSessionPlan() {
  if (!qaPlanState) return null;
  const long = qaPlanState === "long";
  const fourPreviews = qaPlanState === "preview-ready-four";
  const shots = [
    ["Windowsill light", 4, "Bottle on the windowsill as the light turns."],
    ["Out of the crate", 4, "Hands lifting it out of the crate, unhurried."],
    ["The pour", 5, "Pour into a heavy glass, steam curling off the rim."],
    ["Still kitchen", 3, "Wide of the kitchen, everything still."],
    ["Label close-up", 4, "Close on the label, held just long enough to read."],
    ["Mug set down", 4, "Back of the room, the mug set down for good."],
    ["Last light", 4, "The last of the light going off the counter."],
    ["Logo card", 2, "Logo card, one beat, then out."],
  ]
    .slice(0, long ? 8 : fourPreviews ? 4 : 2)
    .map(([label, seconds, description], index) => ({
      description,
      label,
      seconds,
      ...(index === 2 ? { motionReason: "The pour is the only thing that has to move." } : {}),
    }));
  const treatment = long
    ? [
        "## Treatment",
        "A slow morning, shot the way one actually goes — **your actual bottle**, your actual kitchen, no set dressing beyond what is already on the counter.",
        "The grade stays warm and a little underexposed so the window does the work. Nothing moves except the pour.",
        "## Script",
        "“Make space for a slower morning.”",
        "“Everything else can wait until the cup is empty.”",
        "## Assumptions",
        "- We use the footage already in this project and buy nothing new.",
        "- The voice is the one saved in taste, read flat.",
        "- Final delivery is landscape; the square cut comes later from the same master.",
        "## What I still need from you",
        "Confirm the bottle on the windowsill is the current label, and whether the logo card ends the film or opens it.",
      ].join("\n\n")
    : "## Treatment\nA calm launch using **your actual bottle**.\n\n## Script\n“Make space for a slower morning.”";
  const base = {
    id: "qa-plan",
    revision: 1,
    phase: "awaiting-decision",
    sourceTurnId: "qa-plan-turn",
    title: "Slow morning launch",
    videoSeconds: long ? 30 : fourPreviews ? 16 : 8,
    canvas: { width: 1920, height: 1080 },
    text: treatment,
    shots,
    budget: { ceilingCents: 1200, spentCents: 240, heldCents: 60, estimatedCents: 460 },
  };
  if (qaPlanState === "storyboard")
    return {
      ...base,
      storyboard: true,
      phase: "accepted",
      decision: { action: "preview", clientActionId: "qa-storyboard", text: "Show me a preview" },
      preview: [
        {
          shot: 0,
          kind: "image",
          status: "ready",
          mediaUrl:
            new URLSearchParams(window.location.search).get("storyboard-url") ??
            QA_QUICKSTART_PIXEL,
        },
      ],
    };
  if (qaPlanState === "failed")
    return {
      ...base,
      phase: "failed",
      message: "The planner is unavailable right now. Try again, or continue in chat.",
    };
  if (qaPlanState === "preview")
    return {
      ...base,
      phase: "accepted",
      decision: { action: "preview", clientActionId: "qa-preview", text: "Show me a preview" },
      preview: shots.map((_, shot) => ({ shot, kind: "image", status: "pending" })),
    };
  if (qaPlanState === "preview-ready" || fourPreviews)
    return {
      ...base,
      phase: "accepted",
      decision: { action: "preview", clientActionId: "qa-preview", text: "Show me a preview" },
      preview: shots.map((_, shot) => ({
        shot,
        kind: "image",
        status: "ready",
        mediaUrl: QA_QUICKSTART_PIXEL,
      })),
    };
  if (qaPlanState === "settled")
    return {
      ...base,
      phase: "accepted",
      decision: { action: "build", clientActionId: "qa-build", text: "Build it." },
    };
  return base;
}
const QA_QUICKSTART_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4efsKAAUZAomEHVlVAAAAAElFTkSuQmCC";
const qaQuickstartStarter = (id, title, summary, category) => ({
  id,
  version: "1.0.0",
  title,
  summary,
  status: "published",
  category,
  tags: [category],
  galleryPreview: { videoMimeType: "image/png", posterDataUrl: QA_QUICKSTART_PIXEL },
  prompt: `Make a ${title.toLowerCase()}.`,
  creativeNotesMarkdown: `## ${title}

Keep the cuts tight.`,
  references: [1, 2].map((index) => ({
    id: `${id}-r${index}`,
    sourceType: "videoclaw_output",
    role: "possible_result",
    title: `${title} example ${index}`,
    contribution: "Pacing and grade.",
    delivery: "core_agent_reference",
    source: "VideoClaw",
    platform: "instagram",
    previewMimeType: "image/png",
    previewDataUrl: QA_QUICKSTART_PIXEL,
    previewPosterDataUrl: QA_QUICKSTART_PIXEL,
    attachable: true,
  })),
  coreReferenceIds: [`${id}-r1`],
  advisoryWorkflowIds: [],
});
const qaQuickstartCatalog = {
  schema: "videoclaw.quickstart-catalog-view/v1",
  generation: "2026-09-01T00:00:00.000Z",
  catalogSha256: "qa-quickstart-catalog",
  source: "bundled",
  starters: [
    qaQuickstartStarter("desk-setup", "Desk setup reel", "A calm tour of one desk.", "product"),
    qaQuickstartStarter(
      "coffee-ritual",
      "Coffee ritual teaser",
      "A slow pour, one line of VO.",
      "product",
    ),
    qaQuickstartStarter(
      "founder-note",
      "Founder note",
      "One take, straight to camera.",
      "talking-head",
    ),
  ],
};
function qaQuickstartStart(request) {
  const w = window;
  (w.__qaQuickstartStarts ??= []).push(request);
  const mode = new URLSearchParams(window.location.search).get("quickstart-start");
  if (mode === "hang") return new Promise(() => {});
  if (mode === "fail") {
    return Promise.reject(new Error("Quickstart could not begin. The workspace did not answer."));
  }
  return Promise.resolve({
    session: {
      sessionId: `qa-${request.starterId}`,
      title: request.starterId,
      cwd: "/qa/workspace",
      status: "idle",
      permissionMode: "default",
      totalCostUsd: 0,
      createdAt: Date.now(),
      clientId: request.clientId,
    },
    duplicate: false,
    attachedReferenceIds: [],
  });
}
let qaChatGptLoginReject;
const fixtures = {
  quickstartCatalog: () => Promise.resolve(qaQuickstartCatalog),
  quickstartStart: qaQuickstartStart,
  listSessions: () => Promise.resolve(sessions),
  readSessionPlan: () => Promise.resolve({ ok: true, value: qaSessionPlan() }),
  feedbackCapture: (req) =>
    Promise.resolve({
      reportId: req.reportId,
      screenshotPath: null,
      contact: "",
      ...feedbackConsentState(qaFeedbackConsent),
    }),
  feedbackGrantUsageSharing: () => {
    qaFeedbackConsent.telemetry = true;
    qaFeedbackConsent.usageSharingConsentAt = Date.now();
    return Promise.resolve(feedbackConsentState(qaFeedbackConsent));
  },
  feedbackSubmit: () => Promise.resolve({ queued: true, delivery: "delivered" }),
  feedbackDiscard: () => Promise.resolve(),
  listClients: () => Promise.resolve(clients),
  createClient: (name) => Promise.resolve({ clientId: "qa-new", name }),
  renameClient: async (clientId, name) => {
    const client = clients.find((item) => item.clientId === clientId);
    if (!client) return { error: "Project not found." };
    client.name = name;
    return { ...client };
  },
  bootstrapStatus: () => Promise.resolve(qaBootstrapStatus),
  // Setup repair modal (PR #94): a live-looking idempotent run — streams the
  // seven steps through the progress channel, then lands on the healthy
  // status, so shots/demos can show idle → running → all-green ✓ cascade.
  onBootstrapProgress: (cb) => {
    qaBootstrapProgressCbs.add(cb);
    return () => {
      qaBootstrapProgressCbs.delete(cb);
    };
  },
  bootstrapRun: async () => {
    const steps = [
      "layout",
      "engine",
      "venv",
      "remotion",
      "hyperframes",
      "workspace",
      "env",
      "doctor",
    ];
    for (const step of steps) {
      qaBootstrapProgressCbs.forEach((cb) => cb({ step, status: "running" }));
      await new Promise((ok) => setTimeout(ok, 550));
      qaBootstrapProgressCbs.forEach((cb) => cb({ step, status: "ok" }));
    }
    return qaBootstrapStatus;
  },
  getSettings: () =>
    Promise.resolve({
      gatewayUrl: "https://qa.invalid",
      llmRoute: qaClaudeGateway ? "gateway" : "claude-code",
      llmRouteAcknowledgedAt: now - 864e5,
      telemetry: false,
    }),
  // The Account meter renders only with a stored key, and "is a key stored" now
  // comes from the account snapshot rather than settings (videoclaw-backend#41)
  // — settings carries no credentials. `?qa&meter` opts in.
  accountSnapshot: () =>
    Promise.resolve(
      qaKeychainRefused !== null
        ? qaKeychainSnapshot()
        : {
            loaded: true,
            signInAvailable: false,
            signedIn: qaOnboardingPreview || qaSupportRequired,
            account:
              qaOnboardingPreview || qaSupportRequired
                ? {
                    userId: "qa-admin",
                    email: "qa@videoclaw.test",
                    status: "active",
                    hasActiveKey: !qaSupportRequired,
                    currentTermsVersion: "alpha-fixture",
                    termsAccepted: true,
                    supportRequired: qaSupportRequired,
                    capabilities: qaOnboardingPreview ? ["onboarding_preview"] : [],
                  }
                : null,
            hasStoredKey: new URLSearchParams(window.location.search).has("meter"),
            ...(qaPlanState ? { storedKeyId: qaPlanKeyId, hasStoredKey: true } : {}),
            verifyingKey: false,
            pendingKey: false,
            secureStorageUnavailable: false,
            credentialVaultUnreadable: false,
            accountUnavailable: false,
            legacyKeyOnly: true,
            // The QA fixture is a grandfathered install: unmanaged, so the shots keep
            // exercising the manual key field.
            accountSignedInOnce: false,
            // Built staging renders this gate on load; Dev opens it at first Send.
            step: qaSupportRequired ? "key-support-required" : "ready",
            bundledTermsVersion: "alpha-fixture",
            canAcceptTerms: false,
          },
    ),
  onAccountChanged: (cb) => {
    qaAccountChanged = cb;
    return () => {
      qaAccountChanged = null;
    };
  },
  accountSignInGoogle: async () => {
    if (qaKeychainRefused === null) return void 0;
    qaKeychainKnown = true;
    qaAccountChanged?.(qaKeychainSnapshot());
    return { ok: false, reason: "insecure-storage", message: INSECURE_STORAGE_COPY };
  },
  restartApp: async () => {
    const w = window;
    w.__qaRestarts = (w.__qaRestarts ?? 0) + 1;
    return true;
  },
  codexStatus: async () => ({
    available: true,
    authenticated: !new URLSearchParams(window.location.search).has("codex-auth"),
    mode: "subscription",
    plan: "plus",
    recovery: "Reconnect ChatGPT to continue.",
  }),
  codexConnectChatGpt: () =>
    new Promise((_resolve, reject) => {
      qaChatGptLoginReject = reject;
    }),
  codexConnectCancel: async () => {
    qaChatGptLoginReject?.(new Error("ChatGPT sign-in did not finish. Try again."));
    qaChatGptLoginReject = void 0;
  },
  codexModels: () => Promise.resolve(qaCodexCatalog()),
  claudeModels: () => Promise.resolve(qaClaudeCatalog()),
  enginePendingToast: () => Promise.resolve(null),
  workflowSubmitEligibility: () =>
    Promise.resolve({
      eligible: qaWorkflowEligible,
      configured: qaWorkflowEligible,
      githubUsername: qaWorkflowEligible ? "qa-creator" : null,
      workflowsRepo: "INFR-Organisation/videoclaw-workflows",
    }),
  getJobSnapshot: (id) => Promise.resolve(id === "s1" ? qaJobSnapshot() : null),
  // Release 11 / #242 visual matrix: ?qa&spend=empty|assets|partial|near|over|
  // unknown|no-budget. The default is a partially spent budget mid-flight.
  getSpendSnapshot: (id) =>
    Promise.resolve(
      id === "s1"
        ? qaSpendSnapshot()
        : (qaSetSnapshots.get(id) ??
            (qaBypass && id === "s2"
              ? { policy: "unlimited_for_video", reservedUsd: 0, unknownSpend: false }
              : { policy: "ask_each", reservedUsd: 0, unknownSpend: false })),
    ),
  onSessionsChanged: (cb) => {
    qaSessionsChanged = cb;
    return () => {
      if (qaSessionsChanged === cb) qaSessionsChanged = null;
    };
  },
  // #834 — Set & continue answers the card it was typed into, as main does:
  // the save lands first, then that ask settles with the budget it SAVED.
  // `window.__qaSpendSaveFails = true` makes the save fail, leaving the card
  // pending with its error and no receipt.
  setSpendCeiling: async (id, usd, options) => {
    const confirmDisableBypass = options?.confirmDisableBypass === true;
    qaWindow.__qaSpendCeilingCalls.push({ sessionId: id, usd, confirmDisableBypass });
    const hold = qaSpendCeilingHold;
    qaSpendCeilingHold = null;
    if (hold) await hold;
    if (window.__qaSpendSaveFails) {
      throw new Error("The budget could not be saved. Try again.");
    }
    const session = sessions.find((item) => item.sessionId === id);
    if (session?.permissionMode === "bypassPermissions") {
      if (!confirmDisableBypass)
        throw new Error("Turn off Bypass before setting a hard spending limit.");
      session.permissionMode = "auto";
      qaSessionsChanged?.(sessions.map((item) => ({ ...item })));
    }
    const snapshot2 = {
      policy: "capped",
      ceilingUsd: usd,
      reservedUsd: 4.9,
      remainingUsd: Math.max(0, usd - 4.9),
      unknownSpend: false,
    };
    qaSetSnapshots.set(id, snapshot2);
    const request = options?.approvalRequestId
      ? qaPendingAsks.get(options.approvalRequestId)
      : void 0;
    if (request) {
      qaPendingAsks.delete(request.requestId);
      emitQaSessionEvent(request.sessionId, {
        kind: "permission_resolved",
        requestId: request.requestId,
      });
      emitQaSessionEvent(request.sessionId, {
        kind: "ask_settled",
        record: settledAskFromPermission(request, "approved", void 0, void 0, snapshot2.ceilingUsd),
      });
    }
    return {
      snapshot: snapshot2,
      ...(usd < 4.9
        ? {
            warning: `You've already used $4.90. New paid work will wait until you raise the budget.`,
          }
        : {}),
    };
  },
  // Shot trigger: window.__qaFullscreen(true) simulates macOS fullscreen (no
  // traffic lights), so scripts can show the fullscreen-only titlebar bird.
  onWindowState: (cb) => {
    window.__qaFullscreen = (on) => cb({ fullscreen: on });
    return () => {
      delete window.__qaFullscreen;
    };
  },
  // Shot trigger: window.__qaSpend(snapshot) pushes any budget state at the
  // open video, so scripts can show used-up / unknown-spend variants.
  onSpendSnapshot: (cb) => {
    window.__qaSpend = (s) => cb({ sessionId: "s1", snapshot: s });
    return () => {
      delete window.__qaSpend;
    };
  },
  getHistory: (id) =>
    Promise.resolve(
      // #832 — the absent-sign-in failure card, so its reconnect can be seen
      // and screenshotted like every other surface here.
      id === "s1" && new URLSearchParams(window.location.search).has("claude-auth")
        ? [
            { kind: "user_text", text: "make a simple video of 5 seconds" },
            {
              kind: "error",
              message:
                "Claude is not signed in on this Mac, so this step did not run. Connect Claude and send again — your message is still here.",
              canRetry: true,
              llmRouteRequired: true,
              claudeAuthRequired: true,
              chargeState: "not_charged",
            },
          ]
        : id === "s1" && new URLSearchParams(window.location.search).has("codex-auth")
          ? [
              { kind: "user_text", text: "make a ginjetsu video of 10 seconds of this picture." },
              {
                kind: "error",
                message:
                  "Your ChatGPT sign-in has expired, so this step could not run. Reconnect ChatGPT, then send your instruction again.",
                canRetry: false,
                llmRouteRequired: true,
                codexAuthRequired: true,
                chargeState: "unknown",
              },
            ]
          : id === "s1" && new URLSearchParams(window.location.search).has("late-results")
            ? [
                {
                  kind: "user_text",
                  turnId: "qa-late-turn",
                  text: "Swap the striped guy for my character.",
                },
                {
                  kind: "assistant_text",
                  messageId: "late-1",
                  text: "The swap went through before you stopped it and is still generating now. When it comes back, I’ll check it and send you the link.",
                },
                {
                  kind: "result",
                  isError: false,
                  totalCostUsd: 0,
                  numTurns: 0,
                  durationMs: 14e3,
                  stoppedAfterMs: 14e3,
                  stopTurnId: "late-stop",
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-1",
                    outcome: "arrived",
                    tool: "mint_video",
                    mode: "genjutsu",
                    files: ["genjutsu/striped_guy_swap.mp4"],
                    costUsd: 6.81,
                  },
                },
                {
                  kind: "assistant_text",
                  messageId: "late-2",
                  text: "Your swap arrived: genjutsu/striped_guy_swap.mp4 is in the video now, with the original audio.",
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-2",
                    outcome: "import_failed",
                    tool: "mint_video",
                    mode: "genjutsu",
                    files: ["genjutsu/second_take.mp4"],
                    costUsd: 3.405,
                    reason: "import_error",
                  },
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-3",
                    outcome: "parked",
                    tool: "audio.enhance",
                    files: ["audio/interview_clean.wav"],
                    costUsd: 0.12,
                    reason: "refused",
                  },
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-4",
                    outcome: "failed",
                    tool: "mint_video",
                    mode: "genjutsu",
                    files: [],
                    costUsd: 0,
                  },
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-5",
                    outcome: "canceled",
                    tool: "mint_video",
                    mode: "genjutsu",
                    files: [],
                    costUsd: 0,
                  },
                },
                // #1218 — the provider's own reason: a refusal, a cancel, a failure.
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-7",
                    outcome: "failed",
                    tool: "mint_video",
                    files: [],
                    costUsd: 0,
                    providerRefusal: "content_policy",
                    providerReason:
                      "Output has sensitive content. Potential copyright violation. [content_policy_violation]",
                  },
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-8",
                    outcome: "canceled",
                    tool: "mint_video",
                    files: [],
                    costUsd: 0,
                    providerReason: "the provider reports this generation was cancelled",
                  },
                },
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-9",
                    outcome: "failed",
                    tool: "mint_video",
                    files: [],
                    costUsd: 0,
                    providerReason:
                      "the provider couldn’t finish this mint_video job — please try again",
                  },
                },
                // #1108 — a model the agent picked, named on its line.
                {
                  kind: "late_result",
                  line: {
                    operationId: "qa-late-6",
                    outcome: "arrived",
                    tool: "model_call",
                    model: "kling-video/v2.5-turbo/pro/image-to-video",
                    files: ["incoming/model-7409efaefb0e5de79be4d209fecaa30f.mp4"],
                    costUsd: 0.336,
                  },
                },
              ]
            : id === "s1" && new URLSearchParams(window.location.search).has("late-batch")
              ? [
                  {
                    kind: "user_text",
                    turnId: "qa-batch-turn",
                    text: "Make covers for the next six posts.",
                  },
                  {
                    kind: "assistant_text",
                    messageId: "batch-1",
                    text: "Six covers are generating now. I’ll check them as they land.",
                  },
                  {
                    kind: "result",
                    isError: false,
                    totalCostUsd: 0,
                    numTurns: 0,
                    durationMs: 6e5,
                    stoppedAfterMs: 6e5,
                    stopTurnId: "batch-stop",
                  },
                  ...[
                    "p10_C7_voice_clone",
                    "p11_A2_ads_scratch",
                    "p12_F2_outreach",
                    "p13_VB3_tool_sprawl",
                    "p14_T6_comic_trend",
                    "p15_C5_mumble",
                  ].map((name, n) => ({
                    kind: "late_result",
                    line: {
                      operationId: `qa-batch-${n}`,
                      outcome: "arrived",
                      tool: "mint_image",
                      files: [`images/${name}.png`],
                      costUsd: 0.08,
                    },
                  })),
                  {
                    kind: "late_result",
                    line: {
                      operationId: "qa-batch-failed",
                      outcome: "failed",
                      tool: "mint_image",
                      files: [],
                      costUsd: 0,
                    },
                  },
                ]
              : id === "s1" && new URLSearchParams(window.location.search).has("failed-step")
                ? [
                    { kind: "user_text", text: "Find two strong references for this cut." },
                    {
                      kind: "tool_start",
                      toolUseId: "fail-1",
                      toolName: "Bash",
                      summary: "Researching references",
                      detail: "",
                    },
                    { kind: "tool_end", toolUseId: "fail-1", isError: true, terminal: "error" },
                    {
                      kind: "tool_start",
                      toolUseId: "fail-2",
                      toolName: "Bash",
                      summary: "Researching references",
                      detail: "",
                    },
                    { kind: "tool_end", toolUseId: "fail-2", isError: true, terminal: "error" },
                    { kind: "assistant_text", text: "I found another route and kept going." },
                  ]
                : id === "s1" && new URLSearchParams(window.location.search).has("long-transcript")
                  ? longTranscriptHistory()
                  : id === "s1" &&
                      new URLSearchParams(window.location.search).has("feedback-layout")
                    ? [
                        {
                          kind: "user_text",
                          turnId: "qa-plan-turn",
                          text: "Use these two images for a calm launch video.",
                          attachmentIds: ["m3", "m4"],
                        },
                        { kind: "material_arrived", entry: QA_MATERIALS[2] },
                        { kind: "material_arrived", entry: QA_MATERIALS[3] },
                        {
                          kind: "assistant_text",
                          text: "The plan is ready. Review the shots and choose the next step.",
                        },
                      ]
                    : id === "s1"
                      ? new URLSearchParams(window.location.search).has("version-jump")
                        ? [
                            { kind: "user_text", text: "Make me a 30s reel about my desk setup." },
                            {
                              kind: "assistant_text",
                              messageId: "vj-1",
                              recordedAtMs: now - 86e6 + 2e4,
                              text: `V1 is ready: [final.mp4](${JOB}/final.mp4)`,
                            },
                            ...Array.from({ length: 12 }, (_, index) => [
                              {
                                kind: "user_text",
                                text: `Note ${index + 1}: tighten the middle a little more.`,
                              },
                              {
                                kind: "assistant_text",
                                messageId: `vj-f${index}`,
                                text: "On it — adjusting the pacing through the middle section.\n\nThat keeps the hook and the ending intact.",
                              },
                            ]).flat(),
                            {
                              kind: "assistant_text",
                              messageId: "vj-2",
                              recordedAtMs: now - 35e5 + 2e4,
                              text: `V2 is up: [final.mp4](${JOB}/final.mp4)`,
                            },
                            {
                              kind: "assistant_text",
                              messageId: "vj-3",
                              recordedAtMs: now - 34e5,
                              text: "Want any other changes?",
                            },
                          ]
                        : new URLSearchParams(window.location.search).has("materials")
                          ? history.flatMap((event, index) => [
                              event,
                              ...(QA_MATERIALS[index]
                                ? [{ kind: "material_arrived", entry: QA_MATERIALS[index] }]
                                : []),
                            ])
                          : history
                      : id === "s4"
                        ? codexHistory
                        : [],
    ),
  getStageEtas: () => Promise.resolve({}),
  attachmentList: (sessionId) =>
    Promise.resolve(qaAttachments.filter((attachment) => attachment.sessionId === sessionId)),
  attachmentPreview: async (sessionId, id) =>
    qaAttachments.some(
      (item) => item.sessionId === sessionId && item.id === id && item.status === "ready",
    )
      ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII="
      : void 0,
  attachmentOwnership: async (sessionId, attachmentId) =>
    qaAttachments.some(
      (attachment) => attachment.sessionId === sessionId && attachment.id === attachmentId,
    )
      ? "draft"
      : "missing",
  attachmentRemove: (_sessionId, attachmentId) => {
    qaAttachments = qaAttachments.filter((attachment) => attachment.id !== attachmentId);
    return Promise.resolve(true);
  },
  attachmentRetry: async (_sessionId, attachmentId) => {
    const current = qaAttachments.find((attachment) => attachment.id === attachmentId);
    const uploading = { ...current, status: "uploading", copiedBytes: 0, error: void 0 };
    qaAttachments = qaAttachments.map((attachment) =>
      attachment.id === attachmentId ? uploading : attachment,
    );
    setTimeout(() => {
      const ready = { ...uploading, status: "ready", copiedBytes: uploading.sizeBytes };
      qaAttachments = qaAttachments.map((attachment) =>
        attachment.id === attachmentId ? ready : attachment,
      );
      qaAttachmentChanged?.(ready);
    }, 350);
    return uploading;
  },
  attachmentDestination: (_sessionId, ids, destination) => {
    const selected = new Set(ids);
    qaAttachments = qaAttachments.map((attachment) =>
      selected.has(attachment.id) ? { ...attachment, destination } : attachment,
    );
    return Promise.resolve(qaAttachments.filter((attachment) => selected.has(attachment.id)));
  },
  onAttachmentChanged: (cb) => {
    qaAttachmentChanged = cb;
    const w = window;
    w.__qaFinishAttachments = () => {
      qaAttachments = qaAttachments.map((attachment) => {
        if (attachment.status !== "uploading") return attachment;
        const ready = { ...attachment, status: "ready", copiedBytes: attachment.sizeBytes };
        cb(ready);
        return ready;
      });
    };
    return () => {
      if (qaAttachmentChanged === cb) qaAttachmentChanged = null;
      delete w.__qaFinishAttachments;
    };
  },
  sendMessage: (_sessionId, request) => {
    if (new URLSearchParams(window.location.search).has("codex-capacity")) {
      return Promise.reject(
        new Error(
          "Error invoking remote method 'session:send': Error: Codex is at its limit of 4 active chats or setup tasks. Wait for one to finish, or stop a working chat, then try again. Your message is saved.",
        ),
      );
    }
    const w = window;
    (w.__qaSent ??= []).push(request);
    if (qaLostAck) {
      qaLostAck = false;
      return Promise.reject(new Error("The send acknowledgement was interrupted. Try again."));
    }
    return Promise.resolve({
      submitted: true,
      duplicate: (w.__qaSent?.length ?? 0) > 1,
      attachmentIds: [...request.attachmentIds],
    });
  },
  // `?qa&placeholder-taste` swaps the project scope for one whose ONLY bullet
  // is the `_(none yet)_` placeholder seed a fresh pack ships with — the info
  // corner must suppress that scope block entirely (placeholder filtering,
  // #200 review), not render an empty "This project" header.
  listTaste: () =>
    Promise.resolve(
      new URLSearchParams(window.location.search).has("placeholder-taste")
        ? {
            ...taste,
            scopes: taste.scopes.map((scope) =>
              scope.scope === "client"
                ? { ...scope, cards: ["_(none yet)_"], antiCards: [] }
                : scope,
            ),
          }
        : taste,
    ),
  commitTaste: async (_cwd, files) => {
    for (const file of files) {
      const scope = taste.scopes.find((item) => item.file === file.file);
      if (scope) scope.cards = [...file.cards];
    }
    return { committed: true, filesUpdated: files.length };
  },
  charactersList: () => Promise.resolve([]),
  // Meter default stays null so existing shot lists render without the
  // paid-gen heads-up; `?qa&meter` opts a script into the Account meter
  // (86% of the included $25 + topped-up credit — issue #187 vocabulary).
  // `?qa&meter&available=4.99` (issue #649) spends the whole monthly grant and
  // leaves that much prepaid credit, which is how the low/exhausted reminder
  // states are captured for review.
  keyMeter: () => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("meter")) return Promise.resolve(null);
    const available = params.get("available");
    if (available === null) return Promise.resolve({ ...QA_KEY_METER });
    const credit = Math.max(0, Number(available) || 0);
    return Promise.resolve({
      ...QA_KEY_METER,
      spentUsd: QA_KEY_METER.limitUsd,
      topupBalanceUsd: credit,
      availableUsd: credit,
      effectiveLimitUsd: QA_KEY_METER.limitUsd + credit,
    });
  },
  libraryStats: () =>
    Promise.resolve({
      tenant: "humeo",
      video: { records: 0, files: 0 },
      image: { records: 0, files: 0 },
      sources: [],
    }),
  // The recorder gates on the macOS mic-permission bridge before getUserMedia;
  // in a browser there is no TCC, so the fixture always says yes (Chrome's own
  // permission/fake-device flags take it from there).
  requestMicAccess: () => Promise.resolve(true),
  // The VO recorder only appears on an agent-initiated input request, so the
  // shot script needs a trigger: subscribing exposes window.__qaVoiceover(),
  // which fires the canned request on demand (never automatically — the
  // existing density shots must stay recorder-free).
  onInputRequest: (cb) => {
    window.__qaVoiceover = () => cb(voRequest);
    return () => {
      delete window.__qaVoiceover;
    };
  },
  // Money cards only appear on an agent-initiated canUseTool, so the shot
  // script needs a trigger (never automatic — existing shot lists stay clean).
  onPermissionRequest: (cb) => {
    window.__qaMoneyStack = (n, unpriced = 0) => {
      for (let i = 0; i < n; i++) qaFire(moneyRequest(i < n - unpriced), cb);
    };
    window.__qaBudgetCard = (state = false) => qaFire(budgetRequest(state), cb);
    window.__qaUnknownCostCard = () => qaFire(unknownCostRequest(), cb);
    window.__qaEstimatedRaiseCard = () => qaFire(estimatedRaiseRequest(), cb);
    const waitingTimer = new URLSearchParams(window.location.search).has("composer-waiting")
      ? setTimeout(() => qaFire(moneyRequest(true), cb), 0)
      : void 0;
    return () => {
      clearTimeout(waitingTimer);
      delete window.__qaMoneyStack;
      delete window.__qaBudgetCard;
      delete window.__qaUnknownCostCard;
      delete window.__qaEstimatedRaiseCard;
    };
  },
  // Update surfaces appear only when main pushes an UpdateInfo, so the shot
  // script needs triggers: subscribing exposes window.__qaUpdate*() (never
  // automatic — the other shots must stay update-free). The qa gateway is a
  // CUSTOM environment, so a routable manifest names its own lander; a prod
  // lander would be refused, exactly as a staging build must refuse one
  // (issue #21). openExternal records into window.__qaOpened.
  onUpdateInfo: (cb) => {
    const w = window;
    const push = (info) => cb((qaPublishedUpdate = info));
    w.__qaUpdate = () => push(qaOptionalUpdate);
    w.__qaUpdateNative = (blocked = false) =>
      push({ ...qaOptionalUpdate, autoUpdate: true, blocked });
    w.__qaUpdaterState = qaPushAppUpdate;
    w.__qaUpdateUnroutable = () => push({ ...qaOptionalUpdate, dmgUrl: null });
    w.__qaUpdateBlocked = () => push({ ...qaOptionalUpdate, minSupported: "0.0.9", blocked: true });
    return () => {
      delete w.__qaUpdate;
      delete w.__qaUpdateNative;
      delete w.__qaUpdaterState;
      delete w.__qaUpdateUnroutable;
      delete w.__qaUpdateBlocked;
    };
  },
  getAppUpdatePreferences: async () => ({
    channel: "latest",
    nightlyAllowed: false,
    installedVersion: qaOptionalUpdate.currentVersion,
  }),
  setAppUpdateChannel: async (channel) => {
    if (channel !== "latest") throw new Error("Nightly updates require an invitation.");
    return { channel, nightlyAllowed: false, installedVersion: qaOptionalUpdate.currentVersion };
  },
  getAppUpdateState: async () => qaAppUpdateState,
  onAppUpdateState: (cb) => {
    qaAppUpdateListeners.add(cb);
    return () => {
      qaAppUpdateListeners.delete(cb);
    };
  },
  downloadAppUpdate: async () => {
    qaPushAppUpdate({ status: "downloading", percent: 42 });
    return qaAppUpdateState;
  },
  installAppUpdate: async () => {
    qaPushAppUpdate({
      status: "downloaded",
      installBlocked: true,
      message: "Wait for the current request to finish, then restart to update.",
    });
    return qaAppUpdateState;
  },
  getUpdateInfo: () => Promise.resolve(qaPublishedUpdate),
  // #874 — the manual check. window.__qaCheckResult picks the outcome
  // ('current' default, 'failed', 'available'); __qaCheckDelayMs holds the busy
  // state; __qaChecks counts calls.
  checkForUpdates: async () => {
    const w = window;
    w.__qaChecks = (w.__qaChecks ?? 0) + 1;
    await new Promise((ok) => setTimeout(ok, w.__qaCheckDelayMs ?? 400));
    const kind = w.__qaCheckResult ?? "current";
    if (kind === "available") return { kind, info: (qaPublishedUpdate = qaOptionalUpdate) };
    return { kind, currentVersion: qaOptionalUpdate.currentVersion };
  },
  materialPreview: async (_sessionId, id) => {
    const entry = qaMaterialsLedger.entries.find((item) => item.id === id);
    return entry ? { entry } : null;
  },
  onSessionEvent: (cb) => {
    qaSessionEventListeners.add(cb);
    window.__qaSessionEvent = emitQaSessionEvent;
    return () => {
      qaSessionEventListeners.delete(cb);
    };
  },
  // Answering an ask settles it, exactly as main does: ONE durable record,
  // projected by the shared `settledAskFromPermission`, pushed down the same
  // session-event channel the app reads. Without this the harness could show a
  // pending card but never the history it leaves behind.
  respondPermission: async (requestId, response) => {
    const request = qaPendingAsks.get(requestId);
    if (!request) return;
    qaPendingAsks.delete(requestId);
    emitQaSessionEvent(request.sessionId, {
      kind: "ask_settled",
      record: settledAskFromPermission(
        request,
        response.behavior === "allow" ? "approved" : "denied",
      ),
    });
  },
  onMaterialsChanged: (cb) => {
    qaMaterialsChanged.add(cb);
    const w = window;
    w.__qaMaterials = (state = "default") => {
      qaMaterialsLedger = qaMaterialsFor(state);
      qaMaterialsChanged.forEach((listener) => listener(qaMaterialsLedger));
    };
    w.__qaMaterialArrives = () => {
      const arrival = qaMaterial({
        id: "m9",
        name: "downloaded-reference.mp4",
        origin: "agent-pull",
        state: "unverified",
      });
      qaMaterialsLedger = {
        sessionId: qaMaterialsSession,
        total: qaMaterialsLedger.total + 1,
        entries: [...qaMaterialsLedger.entries, arrival],
      };
      qaMaterialsChanged.forEach((listener) => listener(qaMaterialsLedger));
      emitQaSessionEvent(qaMaterialsSession, { kind: "material_arrived", entry: arrival });
    };
    return () => {
      qaMaterialsChanged.delete(cb);
      if (!qaMaterialsChanged.size) {
        delete w.__qaMaterials;
        delete w.__qaMaterialArrives;
      }
    };
  },
  openExternal: (url) => {
    const w = window;
    (w.__qaOpened ??= []).push(url);
    return Promise.resolve();
  },
};
function installQaBridge() {
  if (new URLSearchParams(window.location.search).get("new-video") === "hang") {
    fixtures.createSession = () => new Promise(() => {});
  }
  if (new URLSearchParams(window.location.search).has("credit-continuation")) {
    const source = { ...sessions[0], agentHarness: "claude-code", llmRoute: "claude-code" };
    const pending = "Shorten the final title, keeping the existing footage and music.";
    let rows = [source];
    let changed;
    window.localStorage.setItem("videoclaw.active-session.v1", source.sessionId);
    window.localStorage.setItem(
      "videoclaw.tour.v1",
      JSON.stringify({ outcome: "skipped", at: now }),
    );
    Object.assign(fixtures, {
      listSessions: async () => rows,
      onSessionsChanged: (callback) => {
        changed = callback;
        return () => {
          changed = void 0;
        };
      },
      getHistory: async (id) =>
        id === source.sessionId
          ? [
              { kind: "user_text", turnId: "credit-839-edit", text: pending },
              {
                kind: "assistant_text",
                messageId: "credit-839-saved",
                text: "The cut and earlier versions are saved. I reached my Claude account limit before making this edit.",
              },
              {
                kind: "error",
                message: "Claude usage limit reached.",
                llmRouteRequired: true,
                accountLimit: { account: "claude", kind: "usage" },
                canRetry: true,
              },
            ]
          : [],
      getJobSnapshot: async () => qaJobSnapshot(),
      historicalJobSnapshot: async () => qaJobSnapshot(),
      getSpendSnapshot: async () => ({ ...QA_SPEND_SNAPSHOT, reservedUsd: 0, remainingUsd: 8.9 }),
      hfPreviewAvailable: async () => ({ available: false }),
      creditHandoffOffer: async () => ({ available: true }),
      codexHandoffOffer: async () => ({ available: false, reason: "not-applicable" }),
      startContinuationChat: async () => rows.find((row) => row.sessionId === "credits-839"),
      continueOnCredits: async (_id, request) => {
        if (request.consent !== "videoclaw-credits")
          throw new Error("Explicit credit consent is required.");
        const existing = rows.find((row) => row.sessionId === "credits-839");
        if (existing) return existing;
        const target = {
          ...source,
          sessionId: "credits-839",
          title: `${source.title} · continued`,
          llmRoute: "gateway",
          continuedFromSessionId: source.sessionId,
          continuationDraft: pending,
        };
        rows = [
          {
            ...source,
            jobId: void 0,
            priorJobId: source.jobId,
            finalizedAtMs: Date.now(),
            continuation: { sessionId: target.sessionId, clientActionId: request.clientActionId },
          },
          target,
        ];
        changed?.(rows);
        return target;
      },
      sendMessage: async () => {
        throw new Error("Screenshot fixture: sending is disabled.");
      },
    });
  }
  if (new URLSearchParams(window.location.search).has("blocked-draft-storage")) {
    Object.defineProperty(window.localStorage, "setItem", {
      configurable: true,
      value: () => {
        throw new DOMException("Storage is blocked.", "QuotaExceededError");
      },
    });
  }
  const stub = new Proxy(fixtures, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop.startsWith("on")) return () => () => {};
      return () => Promise.resolve(void 0);
    },
  });
  window.videoclaw = stub;
}
export { installQaBridge };
