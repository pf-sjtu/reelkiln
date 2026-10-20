import { createHash } from "node:crypto";
import { rmSync, mkdirSync, createWriteStream, statfsSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import yauzl from "yauzl";
function normalizeSpendCeiling(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return null;
  const cents = Math.ceil((usd - Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e8) {
    return null;
  }
  return cents / 100;
}
const normalizeSpendCeilingUsd = normalizeSpendCeiling;
const SPEND_APPROVAL_PENDING_CODE = "SPEND_APPROVAL_PENDING";
const SPEND_AUTHORITY_REQUIRED_CODE = "SPEND_AUTHORITY_REQUIRED";
const MANAGED_DEVELOPMENT = false;
const PROD_GATEWAY_URL = "https://videoclaw-gw-650303209435.us-central1.run.app";
const STAGING_GATEWAY_URL = "".trim();
const STAGING_APP_NAME = "Videoclaw Staging";
const DEV_APP_NAME = "Videoclaw Dev";
function workspaceLeafForChannel(channel) {
  switch (channel.trim().toLowerCase()) {
    case "":
    case "prod":
      return "Videoclaw";
    case "staging":
      return "Videoclaw-Staging";
    case "dev":
      return "Videoclaw-Dev";
    default:
      throw new Error(`unsupported Videoclaw build channel: ${channel}`);
  }
}
const normalizeGatewayUrl = (url) => url.trim().replace(/\/+$/, "");
function pinGatewaySettings(openedGatewayUrl, openedGatewayKey, current) {
  const opened = normalizeGatewayUrl(openedGatewayUrl);
  return {
    ...current,
    gatewayUrl: opened,
    gatewayKey: openedGatewayKey,
  };
}
function validateStagingGatewayUrl(url) {
  const u = (url ?? "").trim();
  if (!u)
    return { ok: false, reason: "no staging gateway URL configured (set VIDEOCLAW_GATEWAY_URL)." };
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return { ok: false, reason: `staging gateway URL is malformed: ${u}` };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `staging gateway URL must be https: ${u}` };
  }
  if (normalizeGatewayUrl(u) === normalizeGatewayUrl(PROD_GATEWAY_URL)) {
    return { ok: false, reason: "staging gateway URL must not equal the prod gateway URL." };
  }
  return { ok: true, url: normalizeGatewayUrl(u) };
}
function defaultGatewayUrlForChannel(channel, stagingUrl = STAGING_GATEWAY_URL) {
  if (channel === "staging" || (channel === "dev" && MANAGED_DEVELOPMENT)) {
    const v = validateStagingGatewayUrl(stagingUrl);
    if (!v.ok) {
      throw new Error(
        `Staging build misconfigured: ${v.reason} Set VIDEOCLAW_GATEWAY_URL to a valid https staging gateway (never the prod URL) before packaging.`,
      );
    }
    return v.url;
  }
  return PROD_GATEWAY_URL;
}
function sanitizeStoredGatewayForChannel(channel, settings, stagingUrl = STAGING_GATEWAY_URL) {
  if (channel !== "staging") return { changed: false };
  const v = validateStagingGatewayUrl(settings.gatewayUrl);
  if (v.ok) return { changed: false };
  return {
    changed: true,
    gatewayUrl: defaultGatewayUrlForChannel("staging", stagingUrl),
    reason: v.reason,
  };
}
function envForGatewayUrl(url, stagingUrl = STAGING_GATEWAY_URL) {
  const u = normalizeGatewayUrl(url);
  if (u === normalizeGatewayUrl(PROD_GATEWAY_URL)) return "prod";
  if (stagingUrl && u === normalizeGatewayUrl(stagingUrl)) return "staging";
  try {
    const host = new URL(u).hostname;
    if (host === "localhost" || host === "127.0.0.1") return "local";
  } catch {}
  return "custom";
}
function channelAppIdentity(channel) {
  if (channel === "staging") return { name: STAGING_APP_NAME, userDataLeaf: STAGING_APP_NAME };
  if (channel === "dev") return { name: DEV_APP_NAME, userDataLeaf: DEV_APP_NAME };
  return null;
}
function switchGatewayKeys(current, newUrl) {
  const oldUrl = normalizeGatewayUrl(current.gatewayUrl);
  const target = normalizeGatewayUrl(newUrl);
  const keys = { ...(current.gatewayKeys ?? {}) };
  if (current.gatewayKey) keys[oldUrl] = current.gatewayKey;
  return { gatewayUrl: target, gatewayKey: keys[target], gatewayKeys: keys };
}
const KEY_METER_PATH = "/v1/me";
const topupSessionPath = (keyId) => `/v1/keys/${keyId}/topup-session`;
function keyMeterFrom(body) {
  const spentUsd = body.spend_this_month_usd ?? 0;
  const spentTotalUsd = body.spend_total_usd ?? 0;
  const limitUsd = body.limit_month_usd ?? null;
  const limitTotalUsd = body.limit_total_usd ?? null;
  const topupBalanceUsd = body.topup_balance_usd ?? 0;
  const reservedUsd = body.reserved_credit_usd ?? 0;
  const grantRooms = [
    limitUsd == null ? Number.POSITIVE_INFINITY : Math.max(0, limitUsd - spentUsd),
    limitTotalUsd == null ? Number.POSITIVE_INFINITY : Math.max(0, limitTotalUsd - spentTotalUsd),
  ];
  const legacyAvailable = grantRooms.every((room) => !Number.isFinite(room))
    ? null
    : Math.max(0, Math.min(...grantRooms) + topupBalanceUsd - reservedUsd);
  return {
    name: body.name,
    spentUsd,
    limitUsd,
    limitTotalUsd,
    spentTotalUsd,
    topupBalanceUsd,
    reservedUsd,
    availableUsd: Object.prototype.hasOwnProperty.call(body, "available_credit_usd")
      ? (body.available_credit_usd ?? null)
      : legacyAvailable,
    effectiveLimitUsd: body.effective_month_limit_usd ?? null,
    topupMinUsd: body.topup_min_usd ?? 5,
    topupMaxUsd: body.topup_max_usd ?? 500,
  };
}
const ANTHROPIC_PASSTHROUGH_PATH = "/anthropic/v1/messages";
function isAnthropicPassthroughPath(path) {
  return path === ANTHROPIC_PASSTHROUGH_PATH || path.startsWith("/anthropic/");
}
const ANTHROPIC_CLIENT_JOB_HEADER = "X-VideoClaw-Client-Job";
const CLIENT_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function isClientJobId(value) {
  return typeof value === "string" && CLIENT_JOB_ID_RE.test(value);
}
function anthropicClientJobCustomHeaders(clientJob) {
  return isClientJobId(clientJob) ? `${ANTHROPIC_CLIENT_JOB_HEADER}: ${clientJob}` : void 0;
}
const ALPHA_TERMS_VERSION = "alpha-2026-08-17";
function canAcceptTerms(serverRequiredVersion, bundled = ALPHA_TERMS_VERSION) {
  return Boolean(serverRequiredVersion) && serverRequiredVersion === bundled;
}
const ACCOUNT_PATH = "/v1/account";
const ACCOUNT_CONSENT_PATH = "/v1/account/consent";
const ACCOUNT_KEY_PATH = "/v1/account/key";
const ACCOUNT_KEY_CLAIM_PATH = "/v1/account/key/claim";
const ACCOUNT_KEY_ACCESS_PATH = "/v1/account/key/access";
const ACCOUNT_ACQUISITION_PATH = "/v1/account/acquisition";
const ACCOUNT_CAPABILITIES = ["onboarding_preview", "nightly_updates"];
function accountCapabilitiesFrom(value) {
  if (!Array.isArray(value)) return [];
  return ACCOUNT_CAPABILITIES.filter((known) => value.includes(known));
}
function canUseNightlyUpdates(snapshot) {
  return (
    snapshot?.signedIn === true &&
    !snapshot.accountUnavailable &&
    snapshot.account?.status === "active" &&
    snapshot.account.capabilities.includes("nightly_updates")
  );
}
function accountStateFrom(body) {
  const str = (v) => (typeof v === "string" && v ? v : void 0);
  return {
    userId: str(body.userId) ?? "",
    email: str(body.email),
    displayName: str(body.displayName),
    status: body.status === "revoked" ? "revoked" : "active",
    hasActiveKey: body.hasActiveKey === true,
    activeKeyId: str(body.activeKeyId),
    keyHint: str(body.keyHint),
    keyCreatedVia: str(body.keyCreatedVia),
    consentVersion: str(body.consentVersion),
    currentTermsVersion: str(body.currentTermsVersion) ?? "",
    termsAccepted: body.termsAccepted === true,
    integrity: str(body.integrity),
    // Fail CLOSED on an old gateway that does not send the field: absent means
    // "no integrity problem reported", but an explicit true is always honoured.
    supportRequired: body.supportRequired === true || Boolean(str(body.integrity)),
    // Fail CLOSED: absent, malformed or unknown entries grant nothing.
    capabilities: accountCapabilitiesFrom(body.capabilities),
  };
}
function onboardingStep(input) {
  if (!input.loaded) return "loading";
  if (!input.account && input.accountUnavailable) return "account-unavailable";
  if (!input.account) {
    return input.legacyKeyOnly && input.hasStoredKey ? "ready" : "signed-out";
  }
  if (input.account.status === "revoked") return "signed-out";
  if (!input.account.termsAccepted) return "consent";
  if (input.account.supportRequired) return "key-support-required";
  if (!input.account.hasActiveKey) {
    return "key-setup";
  }
  if (!input.hasStoredKey || input.storedKeyInvalid) {
    return "key-unrecoverable";
  }
  if (input.storedKeyId === void 0) return "key-verification-pending";
  return input.storedKeyId === input.account.activeKeyId ? "ready" : "key-conflict";
}
const VERIFY_BACKOFF_MS = [2e3, 5e3, 15e3, 6e4];
function keyVerificationRetry(step, attempt) {
  if (step !== "key-verification-pending") return { attempt: 0 };
  const i = Math.min(Math.max(attempt, 0), VERIFY_BACKOFF_MS.length - 1);
  return { retryInMs: VERIFY_BACKOFF_MS[i], attempt: attempt + 1 };
}
function buildAccountSnapshot(input) {
  const legacyKeyOnly = !input.accountSignedInOnce && input.hasStoredKey && input.hasLocalConsent;
  const account = input.signedIn ? input.account : null;
  const accountUnavailable =
    input.signedIn && account === null && input.accountUnavailable === true;
  const core = {
    account,
    loaded: input.loaded,
    hasStoredKey: input.hasStoredKey,
    storedKeyId: input.storedKeyId,
    storedKeyInvalid: input.storedKeyInvalid === true,
    legacyKeyOnly,
    accountUnavailable,
    pendingKey: input.pendingKey === true,
  };
  return {
    loaded: input.loaded,
    signInAvailable: input.signInAvailable,
    signInUnavailableReason: input.signInUnavailableReason,
    signedIn: input.signedIn,
    profileImageUrl: input.signedIn ? input.profileImageUrl : void 0,
    account,
    hasStoredKey: input.hasStoredKey,
    storedKeyId: input.storedKeyId,
    storedKeyInvalid: input.storedKeyInvalid === true,
    verifyingKey: input.verifyingKey === true,
    pendingKey: input.pendingKey === true,
    secureStorageUnavailable: input.secureStorageUnavailable === true,
    credentialVaultUnreadable: input.credentialVaultUnreadable === true,
    accountUnavailable,
    legacyKeyOnly,
    accountSignedInOnce: input.accountSignedInOnce,
    step: onboardingStep(core),
    // Whether this build can display the version the server currently requires.
    // Never derived from the server alone: acceptance may only be recorded for
    // text that was actually on screen (see alphaTerms.ts).
    bundledTermsVersion: ALPHA_TERMS_VERSION,
    canAcceptTerms: canAcceptTerms(account?.currentTermsVersion),
    message: input.message,
  };
}
function generationBlockedByAccount(snapshot) {
  if (!snapshot.loaded) return true;
  if (snapshot.legacyKeyOnly) return false;
  return snapshot.step !== "ready";
}
function accountGateEnforced(build) {
  return (
    build.packaged ||
    build.managedDevelopment === true ||
    (build.channel !== void 0 && build.channel !== "dev")
  );
}
function paidWorkBlockedFor(snapshot, build) {
  if (!accountGateEnforced(build)) return false;
  return generationBlockedByAccount(snapshot);
}
const ACCOUNT_BLOCKED_COPY =
  "Sign in to your Videoclaw account to keep generating. Your projects are all still here.";
const UNREADABLE_VAULT_COPY =
  "Videoclaw needs to refresh a saved login on this Mac. Continue with Google or email below. Your videos and projects are untouched, and the old encrypted login will be kept as a private backup.";
const INSECURE_STORAGE_COPY =
  "Videoclaw can’t store your credentials securely on this Mac — the system keychain isn’t available. Signing in would mean writing a long-lived token to disk in the clear, so it’s been stopped. Unlock your login keychain in Keychain Access, then quit and reopen Videoclaw. Nothing already saved has been touched.";
const MANAGED_KEY_MANUAL_WRITE_COPY =
  "This Mac’s generation access is managed by your Videoclaw account, so it can’t be pasted over or removed by hand. Nothing has been changed. Sign in again and Videoclaw will restore access automatically.";
function manualKeyWriteRefusal(input) {
  return input.signedInOnce ? MANAGED_KEY_MANUAL_WRITE_COPY : void 0;
}
const SIGN_OUT_NOT_PERSISTED_COPY =
  "You’ve been signed out and everything running has been stopped, but Videoclaw couldn’t update its saved credentials. If you reopen Videoclaw and it’s still signed in, sign out again. Your Videoclaw key and your projects have not been touched.";
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
      googleClientSecret: p.googleClientSecret?.trim() || void 0,
    };
  } catch {
    return null;
  }
};
const FIREBASE_PROD_CONFIG = parseConfig(
  '{"apiKey":"***REDACTED***","authDomain":"videoclaw-backend.firebaseapp.com","googleClientId":"650303209435-n9j48rb7bh1moo40381ndrr8sitg4va6.apps.googleusercontent.com","googleClientSecret":"***REDACTED***"}',
);
const FIREBASE_STAGING_CONFIG = parseConfig("");
function resolveAuthPool(gatewayUrl, configs = {}) {
  const prod = configs.prod === void 0 ? FIREBASE_PROD_CONFIG : configs.prod;
  const staging = configs.staging === void 0 ? FIREBASE_STAGING_CONFIG : configs.staging;
  const env = envForGatewayUrl(gatewayUrl, configs.stagingGatewayUrl ?? STAGING_GATEWAY_URL);
  if (env === "custom") return { config: null, reason: "untrusted-gateway" };
  const pool = env === "prod" ? prod : staging;
  return pool ? { config: pool } : { config: null, reason: "unconfigured" };
}
const SIGN_IN_UNAVAILABLE_COPY = {
  unconfigured: "Account sign-in isn’t set up for this Videoclaw environment in this build.",
  "untrusted-gateway":
    "Account sign-in is only available on the official Videoclaw gateways. Paste a vc_ key to use this custom gateway.",
};
function classifyEmailLinkSendFailure(status, code) {
  const c = (code ?? "").trim().toUpperCase();
  if (
    c === "UNAUTHORIZED_DOMAIN" ||
    c === "UNAUTHORIZED_CONTINUE_URI" ||
    c === "INVALID_CONTINUE_URI" ||
    c === "MISSING_CONTINUE_URI" ||
    c === "INVALID_DYNAMIC_LINK_DOMAIN" ||
    c === "OPERATION_NOT_ALLOWED" ||
    c === "ADMIN_ONLY_OPERATION" ||
    c === "PERMISSION_DENIED" ||
    c === "PROJECT_NOT_FOUND" ||
    c.startsWith("API_KEY") ||
    status === 401 ||
    status === 403
  ) {
    return "unavailable";
  }
  if (c === "TOO_MANY_ATTEMPTS_TRY_LATER" || c === "QUOTA_EXCEEDED" || status === 429) {
    return "throttled";
  }
  if (c === "INVALID_EMAIL" || c === "MISSING_EMAIL") return "invalid-email";
  return "unknown";
}
const EMAIL_LINK_SEND_COPY = {
  unavailable:
    "Email sign-in isn’t set up for this Videoclaw environment right now. Signing in with Google still works.",
  throttled: "Too many sign-in emails were requested — wait a few minutes and try again.",
  "invalid-email": "Enter a valid email address.",
  unknown: "Couldn't send the sign-in email — check the address and try again.",
};
const EMAIL_LINK_WAIT_HINT_MS = 45e3;
const EMAIL_LINK_RESEND_INTERVAL_MS = 3e4;
const SUPPORT_EMAIL = "founders@humeo.com";
const ACCOUNT_DISABLED_COPY = `This Videoclaw account has been disabled. Contact the Videoclaw team at ${SUPPORT_EMAIL}.`;
const GENERIC_ACTIVITY = "Working on the video…";
const ENGINE_LINES = {
  // JC-specified lines (verbatim from the chunk spec) ───────────────────────
  mint_image: (s) => (s ? `Creating a still — ${s}` : "Creating a still"),
  mint_video: (s) => (s ? `Generating footage — ${s}` : "Generating footage"),
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
  cost: () => "Checking the budget",
};
const SUBJECT_TOOLS = /* @__PURE__ */ new Set(["mint_image", "mint_video"]);
const SYNTH_VOICE_MODE_LINES = {
  tts: "Creating the voiceover",
  reference_tts: "Creating the approved voiceover",
  design: "Creating the voiceover",
  voice_change: "Re-voicing your recording",
  transcribe: "Transcribing your recording",
  list_voices: "Choosing a voice",
};
const SYNTH_VOICE_GENERATION_MODES = ["tts", "reference_tts", "design", "voice_change"];
const ENGINE_ALIASES = {
  lipsync: "lipsync_footage",
};
function engineFamilyLine(tool) {
  let key = String(tool ?? "")
    .replace(/\.py$/i, "")
    .trim()
    .toLowerCase();
  key = ENGINE_ALIASES[key] ?? key;
  const fn = ENGINE_LINES[key];
  return fn ? fn(null) : null;
}
const QUOTED_TOOL_ENGINE = {
  music: "score_bed",
  depth_map: "fx_parallax",
  audio_enhance: "clean_audio",
  media_pull: "pull_video",
  enumerate_profile: "pull_video",
  embed: "index_media",
  llm: "check_script",
};
const QUOTED_TOOL_LINES = {
  qa_video: "Reviewing footage",
  model_call: "Running a model",
};
const quoteKey = (tool) =>
  String(tool ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.py$/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
function quotedOperationLine(tool, routeMode) {
  const key = quoteKey(tool);
  if (key === "synth_voice")
    return SYNTH_VOICE_MODE_LINES[routeMode ?? ""] ?? "This audio operation";
  if (key === "seed_voice")
    return SYNTH_VOICE_MODE_LINES[routeMode ?? ""] ?? "Creating the voiceover";
  const line = QUOTED_TOOL_LINES[key] ?? engineFamilyLine(QUOTED_TOOL_ENGINE[key] ?? key);
  if (line) return line;
  const words = key.replace(/_/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "This operation";
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
  "stem_split",
  // audio work
];
const GENERATION_FAMILY_LINES = /* @__PURE__ */ new Set([
  ...GENERATION_TOOLS.map((t) => engineFamilyLine(t)).filter((l) => l !== null),
  // synth_voice generation modes carry mode-specific lines (e.g. voice_change
  // → "Re-voicing your recording") — still live audio generation, still strip-worthy.
  ...SYNTH_VOICE_GENERATION_MODES.map((m) => SYNTH_VOICE_MODE_LINES[m]),
]);
function isGenerationLine(summary) {
  return GENERATION_FAMILY_LINES.has(
    String(summary ?? "")
      .split("—")[0]
      .trim(),
  );
}
function friendlyToolLine(toolName, input) {
  const obj = input ?? {};
  if (toolName === "mcp__studio__request_voiceover")
    return { line: "Setting up your voiceover", generic: false };
  if (toolName === "mcp__studio__request_files")
    return { line: "Asking you for footage", generic: false };
  if (toolName === "mcp__studio__request_rights_confirmation")
    return { line: "Confirming usage rights", generic: false };
  if (toolName === "mcp__studio__search_models" || toolName === "search_models")
    return { line: "Searching available models", generic: false };
  if (toolName === "mcp__studio__call_model" || toolName === "call_model")
    return { line: "Generating with a selected model", generic: false };
  if (toolName === "AskUserQuestion") return { line: "Checking in with you", generic: false };
  switch (toolName) {
    case "Read": {
      const p = String(obj.file_path ?? "");
      if (/\.(png|jpe?g|webp|gif)$/i.test(p)) return { line: "Looking at a frame", generic: false };
      return { line: "Reviewing the project", generic: false };
    }
    case "Write":
      return { line: "Writing up the plan", generic: false };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { line: "Refining the details", generic: false };
    case "Grep":
    case "Glob":
      return { line: "Looking through the project", generic: false };
    case "WebFetch":
    case "WebSearch":
      return { line: "Researching references", generic: false };
    case "TodoWrite":
      return { line: "Planning the next steps", generic: false };
    case "Task":
    case "Agent":
      return { line: GENERIC_ACTIVITY, generic: false };
    case "Bash":
      break;
    // fall through to command parsing
    default:
      return { line: GENERIC_ACTIVITY, generic: true };
  }
  const cmd = String(obj.command ?? "");
  const tokens = tokenize(cmd);
  const match = /tools\/([a-z0-9_]+)\.py/.exec(cmd) ?? /(?:^|[\s/])([a-z0-9_]+)\.py\b/.exec(cmd);
  const engineTool = match?.[1];
  if (engineTool && ENGINE_LINES[engineTool]) {
    if (engineTool === "synth_voice") {
      const mode = String(flagValue(tokens, ["--mode"]) ?? "").toLowerCase();
      const modeLine = SYNTH_VOICE_MODE_LINES[mode];
      if (modeLine) return { line: modeLine, generic: false };
    }
    const subject = SUBJECT_TOOLS.has(engineTool)
      ? cleanSubject(flagValue(tokens, ["--prompt"]))
      : null;
    return { line: ENGINE_LINES[engineTool](subject), generic: false };
  }
  if (
    /^\s*(?:sudo\s+)?(ls|find|cat|head|tail|wc|pwd|tree|stat|file|du|mkdir|cp|mv|rm|echo)\b/.test(
      cmd,
    )
  )
    return { line: "Looking around the project", generic: false };
  if (/\b(ffmpeg|ffprobe)\b/.test(cmd)) return { line: "Processing the footage", generic: false };
  if (/^\s*git\b/.test(cmd)) return { line: "Saving your progress", generic: false };
  if (/\bcost\.py\b/.test(cmd)) return { line: "Checking the budget", generic: false };
  return { line: GENERIC_ACTIVITY, generic: true };
}
const COMMAND_WORDS = /* @__PURE__ */ new Set([
  "sh",
  "bash",
  "zsh",
  "rm",
  "mv",
  "cp",
  "ls",
  "cat",
  "grep",
  "sed",
  "awk",
  "curl",
  "wget",
  "git",
  "npm",
  "npx",
  "node",
  "python",
  "python3",
  "uv",
  "pip",
  "pip3",
  "ffmpeg",
  "ffprobe",
  "chmod",
  "chown",
  "sudo",
  "mkdir",
  "touch",
  "kill",
  "tar",
  "ssh",
  "scp",
  "find",
  "head",
  "tail",
  "echo",
]);
const INTERNAL_WORDS = /* @__PURE__ */ new Set([
  // models + providers, matched in any casing
  "claude",
  "sonnet",
  "opus",
  "haiku",
  "anthropic",
  "gpt",
  "gpt-image",
  "openai",
  "gemini",
  "seedance",
  "seedream",
  "bytedance",
  "kling",
  "kwaivgi",
  "replicate",
  "fal",
  "elevenlabs",
  "whisper",
  "sam3",
  // pipeline jargon
  "mux",
  "muxing",
  "muxed",
  "demux",
  "remux",
  "transcode",
  "transcoding",
  "codec",
  "bitrate",
  "edl",
  "stems",
  "waveform",
  "chroma",
  "lipsync",
]);
const BEAT_ID_RE = /^(?:[wb]\d{1,3}|seg\d{1,3})$/i;
function sanitizeModelLine(raw) {
  let s = String(raw ?? "")
    .split("\n")[0]
    .trim();
  s = s.replace(/^["'`\s]+|["'`\s]+$/g, "").trim();
  if (!s) return null;
  const tokens = s.split(/\s+/);
  const bare = (w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toLowerCase();
  if (tokens.some((w) => COMMAND_WORDS.has(bare(w)) || INTERNAL_WORDS.has(bare(w)))) return null;
  const words = tokens.filter(
    (w) =>
      !w.includes("/") &&
      !w.startsWith("-") &&
      !w.startsWith("$") &&
      !/[`$|<>=\\]/.test(w) &&
      !/\.[a-z0-9]{1,5}$/i.test(w) &&
      !BEAT_ID_RE.test(bare(w)),
  );
  s = words.join(" ").trim();
  if (s.length < 2) return null;
  if (s.length > 48) s = s.slice(0, 47).replace(/\s+\S*$/, "") + "…";
  return s;
}
function tokenize(cmd) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}
function flagValue(tokens, flags) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    for (const f of flags) {
      if (t === f) return tokens[i + 1] ?? null;
      if (t.startsWith(f + "=")) return t.slice(f.length + 1);
    }
  }
  return null;
}
const SUBJECT_LEAD_JARGON = /* @__PURE__ */ new Set([
  "vertical",
  "horizontal",
  "square",
  "portrait",
  "landscape",
  "widescreen",
  "cinematic",
  "photorealistic",
  "photoreal",
  "hyperrealistic",
  "realistic",
  "photo",
  "photograph",
  "photography",
  "image",
  "still",
  "shot",
  "render",
  "frame",
  "close-up",
  "closeup",
  "wide",
  "macro",
  "pov",
  "overhead",
  "minimalist",
  "stylized",
  "moody",
  "dramatic",
  "gritty",
  "extreme",
  "action",
  "8k",
  "4k",
  "hd",
  "uhd",
  "dslr",
  "bokeh",
]);
const bareWord = (w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toLowerCase();
function cleanSubject(raw) {
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const words = collapsed
    .split(" ")
    .filter((w) => !w.includes("/") && !w.startsWith("-") && !w.startsWith("$"))
    .filter((w) => !/^\d+:\d+$/.test(bareWord(w)))
    .filter((w) => !(w.length >= 4 && /^[A-Z0-9-]+$/.test(w)));
  let start = 0;
  while (start < words.length && SUBJECT_LEAD_JARGON.has(bareWord(words[start]))) start++;
  if (start < words.length && bareWord(words[start]) === "of") start++;
  if (start >= words.length) return null;
  let s = words.slice(start).join(" ").trim();
  if (s.length < 2) return null;
  if (s.length > 42) s = s.slice(0, 41).replace(/\s+\S*$/, "") + "…";
  return s;
}
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".tiff", ".tif"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".aiff", ".aif", ".ogg"];
const DOC_EXTS = [
  ".pdf",
  ".txt",
  ".md",
  ".rtf",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".xlsx",
  ".xls",
  ".ods",
  ".srt",
  ".vtt",
  ".ass",
  ".ssa",
  ".edl",
];
const OPAQUE_EXTS = [".svg"];
const ARCHIVE_EXTS = [".zip"];
const WORKBOOK_EXTS = [".xlsx", ".xls", ".ods"];
function assetExt(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}
function assetKind(name) {
  const e = assetExt(name);
  if (VIDEO_EXTS.includes(e)) return "video";
  if (IMAGE_EXTS.includes(e)) return "image";
  if (AUDIO_EXTS.includes(e)) return "audio";
  if (DOC_EXTS.includes(e)) return "doc";
  if (OPAQUE_EXTS.includes(e)) return "opaque";
  if (ARCHIVE_EXTS.includes(e)) return "archive";
  return "other";
}
function isWorkbookName(name) {
  return WORKBOOK_EXTS.includes(assetExt(name));
}
function isPdfName(name) {
  return assetExt(name) === ".pdf";
}
function isAcceptedAsset(name) {
  return assetKind(name) !== "other";
}
function assetRejectReason(name) {
  const e = assetExt(name);
  const what = e ? `${e} files` : "files without a recognisable type";
  return `I work with video, images, audio, scripts, vector art, and archives — ${what} aren’t something I can use here.`;
}
const ACCEPTED_ASSET_HINT = "Video, images, audio, scripts, vector art, and archives";
const INTAKE_FOLDER_MAX_DEPTH = 8;
const INTAKE_FOLDER_MAX_FILES = 1e3;
const INTAKE_FOLDER_MAX_BYTES = 64 * 1024 * 1024 * 1024;
const INTAKE_FOLDER_MAX_VISITS = 2e4;
function folderRejectReason(name, cause) {
  const folder = name ? `“${name}”` : "that folder";
  switch (cause) {
    case "unreadable":
      return `I couldn’t read inside ${folder}.`;
    case "too-deep":
      return `${folder} nests more than ${INTAKE_FOLDER_MAX_DEPTH} levels deep — drop the folder that actually holds the files.`;
    case "too-many":
      return `${folder} holds more than ${INTAKE_FOLDER_MAX_FILES} files I can use — drop a smaller folder, or the files themselves.`;
    case "too-large":
      return `${folder} adds up to more than ${Math.round(INTAKE_FOLDER_MAX_BYTES / 1024 ** 3)} GB — drop a smaller folder, or the files themselves.`;
    case "too-crowded":
      return `I’d have to look through more than ${INTAKE_FOLDER_MAX_VISITS} items to read ${folder} — drop the folder that actually holds your files, not one above it.`;
    default:
      return `Nothing in ${folder} is something I can use — ${ACCEPTED_ASSET_HINT.toLowerCase()}.`;
  }
}
const ARCHIVE_MAX_FILES = INTAKE_FOLDER_MAX_FILES;
const ARCHIVE_MAX_DEPTH = INTAKE_FOLDER_MAX_DEPTH;
const ARCHIVE_MAX_ENTRIES = INTAKE_FOLDER_MAX_VISITS;
const ARCHIVE_MAX_FILE_BYTES = 4 * 1024 ** 3;
const ARCHIVE_MAX_TOTAL_BYTES = 16 * 1024 ** 3;
const ARCHIVE_MAX_RATIO = 100;
const ARCHIVE_RATIO_FLOOR_BYTES = 1024 * 1024;
const ARCHIVE_MAX_WORKBOOKS = 20;
const ARCHIVE_MAX_PDFS = 20;
function archiveRejectReason(name, cause) {
  const zip = name ? `“${name}”` : "that archive";
  switch (cause) {
    case "corrupt":
      return `${zip} is damaged or incomplete, so I didn’t unpack any of it.`;
    case "encrypted":
      return `${zip} is password-protected — unzip it yourself and drop the files.`;
    case "unsupported-compression":
      return `${zip} uses a compression method I can’t unpack — re-zip it with standard compression.`;
    case "unsafe-path":
      return `${zip} contains a file path that points outside the archive, so I didn’t unpack any of it.`;
    case "link":
      return `${zip} contains links to other files, so I didn’t unpack any of it.`;
    case "special-file":
      return `${zip} contains something that isn’t an ordinary file, so I didn’t unpack any of it.`;
    case "duplicate-path":
      return `${zip} lists the same file more than once, so I didn’t unpack any of it.`;
    case "too-deep":
      return `${zip} nests more than ${ARCHIVE_MAX_DEPTH} folders deep — zip the folder that actually holds the files.`;
    case "too-many":
      return `${zip} holds more than ${ARCHIVE_MAX_FILES} files I can use — split it into smaller archives.`;
    case "too-crowded":
      return `${zip} lists more than ${ARCHIVE_MAX_ENTRIES} items — zip just the files you need.`;
    case "file-too-large":
      return `A file inside ${zip} is larger than ${Math.round(ARCHIVE_MAX_FILE_BYTES / 1024 ** 3)} GB — drop that file directly instead.`;
    case "too-large":
      return `${zip} unpacks to more than ${Math.round(ARCHIVE_MAX_TOTAL_BYTES / 1024 ** 3)} GB — split it, or drop the files directly.`;
    case "bomb":
      return `${zip} expands far more than real files do, so I didn’t unpack it.`;
    case "no-space":
      return `There isn’t enough free disk space to unpack ${zip}.`;
    default:
      return `Nothing in ${zip} is something I can use — ${ACCEPTED_ASSET_HINT.toLowerCase()}.`;
  }
}
const WORKBOOK_MAX_BYTES = 25 * 1024 * 1024;
const WORKBOOK_MAX_SHEETS = 64;
const WORKBOOK_MAX_CELLS = 1e5;
const WORKBOOK_MAX_CELL_CHARS = 32767;
const WORKBOOK_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const WORKBOOK_CONTAINER_MAX_ENTRIES = 1e4;
const WORKBOOK_CONTAINER_MAX_BYTES = 64 * 1024 * 1024;
const WORKBOOK_CONTAINER_MAX_RATIO = 1e3;
const WORKBOOK_PAGE_MAX_CELLS = 500;
const PDF_MAX_BYTES = 64 * 1024 * 1024;
const PDF_MAX_PAGES = 500;
const PDF_MAX_TEXT_CHARS = 1e6;
function workbookRejectReason(name, cause) {
  const book = name ? `“${name}”` : "that workbook";
  switch (cause) {
    case "encrypted":
      return `${book} is password-protected — save an unprotected copy and attach that.`;
    case "too-large":
      return `${book} is larger than ${Math.round(WORKBOOK_MAX_BYTES / 1024 ** 2)} MB — attach just the sheets you need.`;
    case "too-many-sheets":
      return `${book} has more than ${WORKBOOK_MAX_SHEETS} sheets — attach just the sheets you need.`;
    case "too-many-cells":
      return `${book} has more than ${WORKBOOK_MAX_CELLS.toLocaleString("en-US")} filled cells — attach just the sheets you need.`;
    case "too-complex":
      return `${book} is too large or complex for me to read safely — attach just the sheets you need.`;
    default:
      return `${book} is damaged or isn’t a workbook I can read.`;
  }
}
const CLIPBOARD_IMAGE_MAX_BYTES = 64 * 1024 * 1024;
const CLIPBOARD_IMAGE_MAX_PIXELS = 32 * 1024 * 1024;
const DEFAULT_ELIGIBLE_ROUTE_LEVELS = ["qualified"];
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
  "persistence and default isolation",
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
    `VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (${benchManifest})`,
  ];
}
const CODEX_QUALIFIED_RESIDUAL_GAPS = [
  "perceptual/rubric scoring and human calibration",
  "monetary cost and token accounting (not exposed by Codex subscription mode)",
  "a LIVE file-change approval event — precluded by the intentional read-only production sandbox, and covered deterministically rather than by weakening that sandbox",
  `evidence at any reasoning effort other than the recommended one — the model's other supported depths stay selectable, and which of them a benchmark covers is recorded HERE rather than narrated in the picker (a RECORDED deviation from "exposure requires a current benchmark record": effort is a parameter inside a qualified route, not part of route identity)`,
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
      "bench/runs/vcb-mm-inspect-001-gpt-5.6-terra-medium.json",
    ),
    bench: {
      taskId: "vcb-mm-inspect-001",
      taskVersion: "1.0.0",
      track: "system",
      rollouts: 3,
      passed: 3,
      manifest: "bench/runs/vcb-mm-inspect-001-gpt-5.6-terra-medium.json",
    },
    notYetCovered: CODEX_QUALIFIED_RESIDUAL_GAPS,
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
      "bench/runs/vcb-mm-inspect-001-gpt-6-astra-low.json",
    ),
    bench: {
      taskId: "vcb-mm-inspect-001",
      taskVersion: "1.0.0",
      track: "system",
      rollouts: 3,
      passed: 3,
      manifest: "bench/runs/vcb-mm-inspect-001-gpt-6-astra-low.json",
    },
    notYetCovered: [
      ...CODEX_QUALIFIED_RESIDUAL_GAPS,
      "a LIVE command approval for Astra on 0.160.1 — the probe raised no escalation; Terra did, and host mapping is covered deterministically",
    ],
  },
];
const BY_ROUTE_ID = new Map(AGENT_ROUTE_EVIDENCE.map((row) => [row.routeId, row]));
function codexRouteEvidence(provider, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  const model = modelId?.trim();
  if (!model) return void 0;
  const routeId = agentRouteId("codex-app-server", provider, model);
  return ledger === AGENT_ROUTE_EVIDENCE
    ? BY_ROUTE_ID.get(routeId)
    : ledger.find((row) => row.routeId === routeId);
}
function codexRouteQualification(provider, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  const level = codexRouteEvidence(provider, modelId, ledger)?.level;
  if (level === "incompatible") return "incompatible";
  return level && DEFAULT_ELIGIBLE_ROUTE_LEVELS.includes(level) ? "qualified" : "unqualified";
}
function isQualifiedCodexRoute(provider, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  return codexRouteQualification(provider, modelId, ledger) === "qualified";
}
function recommendedCodexReasoningEffort(provider, modelId) {
  return codexRouteEvidence(provider, modelId)?.recommendedReasoningEffort;
}
function codexEffortDiagnostic(modelId, effort) {
  return `${modelId} doesn’t offer reasoning effort “${effort}”.`;
}
const RECORDED_CLAUDE_EFFORT_MODELS = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5"];
const RECORDED_CLAUDE_NO_EFFORT_MODELS = ["claude-haiku-4-5-20251001"];
function claudeEffortSupportKnown(route, modelId, discovered) {
  if (!modelId || route !== "claude-code") return true;
  return (
    Boolean(discovered?.find((m) => m.id === modelId)?.supportedEffortLevels) ||
    RECORDED_CLAUDE_EFFORT_MODELS.includes(modelId) ||
    RECORDED_CLAUDE_NO_EFFORT_MODELS.includes(modelId)
  );
}
function claudeReasoningEffortChoices(route, modelId, discovered) {
  if (!modelId || route !== "claude-code") return [];
  const reported = discovered?.find((m) => m.id === modelId)?.supportedEffortLevels;
  if (reported) return reported;
  return RECORDED_CLAUDE_EFFORT_MODELS.includes(modelId)
    ? ["low", "medium", "high", "xhigh", "max"]
    : [];
}
function resolveCodexReasoningEffort(provider, model, saved) {
  const supported = (model.supportedReasoningEfforts ?? []).map((option) => option.effort);
  const pinned = saved?.trim();
  if (pinned) {
    return supported.includes(pinned)
      ? { ok: true, effort: pinned, baseline: false, source: "pinned" }
      : {
          ok: false,
          reason: `This video is pinned to ${model.id} at reasoning effort “${pinned}”, which Codex no longer offers for that model (now: ${supported.join(", ")}). VideoClaw will not silently run it at a different effort (#108).`,
        };
  }
  const recommended = recommendedCodexReasoningEffort(provider, model.id);
  if (recommended && supported.includes(recommended)) {
    return { ok: true, effort: recommended, baseline: true, source: "recommended" };
  }
  const baseline = model.defaultReasoningEffort.trim();
  return supported.includes(baseline)
    ? { ok: true, effort: baseline, baseline: true, source: "runtime-default" }
    : {
        ok: false,
        reason: `Codex reported no usable default reasoning effort for ${model.id} (#108).`,
      };
}
const CODEX_CONTAINMENT = {
  approvalPolicy: "on-request",
  sandbox: "read-only",
};
const CODEX_HOST_APPROVAL = {
  default: "ask",
  acceptEdits: "edits",
  auto: "all",
  bypassPermissions: "all",
};
function codexContainmentDiagnostic(mode) {
  return `VideoClaw has no Codex equivalent for permission mode “${mode}”, so it will not record one. Codex runs under VideoClaw's fixed containment (approvalPolicy “${CODEX_CONTAINMENT.approvalPolicy}”, sandbox “${CODEX_CONTAINMENT.sandbox}”) and the app decides each escalation itself; a mode with no rule there would be a claim about authority nothing applied (#108).`;
}
function resolveCodexContainment(mode) {
  const hostApproves = CODEX_HOST_APPROVAL[mode];
  return hostApproves
    ? {
        ok: true,
        approvalPolicy: CODEX_CONTAINMENT.approvalPolicy,
        sandbox: CODEX_CONTAINMENT.sandbox,
        hostApproves,
      }
    : { ok: false, reason: codexContainmentDiagnostic(mode) };
}
const CODEX_PROVIDER_LABELS = {
  chatgpt: "ChatGPT",
  "openai-api": "OpenAI API",
  openrouter: "OpenRouter",
};
function codexRouteDiagnostic(provider, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  if (provider !== "chatgpt") {
    return `This ${CODEX_PROVIDER_LABELS[provider]} route has not been validated for VideoClaw yet (#108).`;
  }
  const model = modelId?.trim();
  if (!model) {
    return "VideoClaw has not tested the model Codex would choose for this account, so it won’t choose it for you — pick a model (#1210).";
  }
  const row = codexRouteEvidence(provider, model, ledger);
  if (row?.level === "incompatible") {
    return `Codex refused ${model} on this ChatGPT account (#1210)${row.runtimeError ? `: ${row.runtimeError}` : "."}`;
  }
  return row
    ? `${model} passed VideoClaw's smoke checks but not full qualification, so VideoClaw doesn't recommend it yet (#108).`
    : `${model} is available on this ChatGPT account but VideoClaw hasn't tested it yet, so it isn't recommended (#1210).`;
}
function resolveCodexRuntimeDefault(provider, discovered, ledger = AGENT_ROUTE_EVIDENCE) {
  const fallback = discovered.find((model) => model.isDefault);
  if (!fallback) {
    return {
      selectable: false,
      reason:
        "Codex did not report which model it would use by default, so VideoClaw cannot offer that choice.",
    };
  }
  const qualification = codexRouteQualification(provider, fallback.id, ledger);
  if (qualification === "incompatible" || provider !== "chatgpt") {
    return {
      selectable: false,
      modelId: fallback.id,
      displayName: fallback.displayName,
      reason: codexRouteDiagnostic(provider, fallback.id, ledger),
    };
  }
  const defaultEligible = qualification === "qualified";
  return {
    selectable: true,
    modelId: fallback.id,
    displayName: fallback.displayName,
    routeId: agentRouteId("codex-app-server", provider, fallback.id),
    defaultEligible,
    ...(defaultEligible
      ? {}
      : {
          note: `Codex would use ${fallback.id} by default, which VideoClaw hasn’t tested yet, so VideoClaw won’t pick it for you — choose a model (#1210).`,
        }),
  };
}
function isDiscoveredCodexModel(discovered, modelId) {
  const model = modelId?.trim();
  return Boolean(model && discovered.some((entry) => entry.id === model));
}
function codexModelUnavailableDiagnostic(provider, modelId) {
  return `${modelId} isn’t available on the connected ${CODEX_PROVIDER_LABELS[provider]} account any more. VideoClaw won’t move this video to a different model on its own — choose one (#108).`;
}
function codexModelUnverifiedDiagnostic(modelId, detail) {
  return (
    `VideoClaw could not confirm ${modelId} is available on your ChatGPT account` +
    (detail ? `. ${detail}` : ". Try again.")
  );
}
function codexModelVerdict(provider, discovered, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  const qualification = codexRouteQualification(provider, modelId, ledger);
  const discovery = !discovered
    ? "unknown"
    : isDiscoveredCodexModel(discovered, modelId)
      ? "discovered"
      : "not-discovered";
  const refusal =
    qualification === "incompatible"
      ? codexRouteDiagnostic(provider, modelId, ledger)
      : discovery === "not-discovered"
        ? codexModelUnavailableDiagnostic(provider, modelId)
        : discovery === "unknown"
          ? codexModelUnverifiedDiagnostic(modelId)
          : void 0;
  return {
    routeId: agentRouteId("codex-app-server", provider, modelId),
    discovery,
    qualification,
    selectable: !refusal,
    defaultEligible: !refusal && qualification === "qualified",
    ...(refusal ? { refusal } : {}),
  };
}
function codexPinRefusal(provider, discovered, modelId, ledger = AGENT_ROUTE_EVIDENCE) {
  return codexModelVerdict(provider, discovered, modelId, ledger).refusal;
}
function partitionDiscoveredCodexModels(provider, discovered, ledger = AGENT_ROUTE_EVIDENCE) {
  const selectable = [];
  const incompatible = [];
  for (const model of discovered) {
    if (codexRouteQualification(provider, model.id, ledger) === "incompatible") {
      incompatible.push({
        id: model.id,
        displayName: model.displayName,
        routeId: agentRouteId("codex-app-server", provider, model.id),
        reason: codexRouteDiagnostic(provider, model.id, ledger),
      });
    } else {
      selectable.push(model);
    }
  }
  return {
    selectable,
    recommended: selectable
      .filter((model) => isQualifiedCodexRoute(provider, model.id, ledger))
      .map((model) => model.id),
    incompatible,
    runtimeDefault: resolveCodexRuntimeDefault(provider, discovered, ledger),
  };
}
const CLAUDE_CLI_TURN = ["live turn on the bundled CLI returned a completed result"];
const CLAUDE_BENCH_RUN =
  "three isolated rollouts on the bundled CLI — one fresh SDK session in a fresh workspace each, no resume, all terminating on a normal result";
const CLAUDE_BENCH_WIRE_IDENTITY =
  "the requested model id was the session model reported by `system/init` on every rollout; `modelUsage` additionally lists the CLI's own internal helper model, recorded as concurrent side usage and NOT as a fallback of the requested model";
const CLAUDE_BENCH_PAYER =
  "payer observed per rollout: signed-in claude.ai, apiProvider firstParty, Team subscription, no gateway credentials injected";
const CLAUDE_BENCH_NOT_COVERED = [
  "protocol/capability conformance on this harness — there is no Claude equivalent of the 28-check Codex conformance manifest, so structured output, interrupt/resume and approval semantics are not separately graded here",
  "perceptual/rubric scoring and human calibration",
  "monetary cost accounting — the manifests record the SDK's own `total_cost_usd` estimate for a subscription-route turn, which is not VideoClaw-paid spend and not a billing statement",
  "the `gateway` route, which never spawns this CLI and holds no Claude evidence of any kind",
];
const CLAUDE_CLI_TURN_NOT_COVERED = [
  "a VideoClaw Bench record of any kind — this row rests on one completed turn, which is why it is no longer the id a new video starts on",
  ...CLAUDE_BENCH_NOT_COVERED,
];
function claudeCodeRow(
  modelId,
  runtimeVersion,
  validatedAt,
  outcome,
  evidence,
  notYetCovered,
  extra = {},
) {
  return {
    routeId: agentRouteId("claude-code", "claude-code", modelId),
    route: "claude-code",
    modelId,
    runtimeVersion,
    validatedAt,
    outcome,
    evidence,
    notYetCovered,
    ...extra,
  };
}
function claudeBench(modelId, passed) {
  return {
    taskId: "vcb-mm-inspect-001",
    taskVersion: "1.0.0",
    track: "system",
    rollouts: 3,
    passed,
    manifest: `bench/runs/vcb-mm-inspect-001-${modelId}.json`,
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
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-opus-5.json). Precision was 0.50/0.50/0.67 — every seeded defect was found, alongside unseeded findings the task does not penalise beyond that number.",
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-opus-5", 3), supersededBy: "claude-opus-5-5" },
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
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-opus-5-5.json). Precision was 0.67/1.0/1.0.",
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-opus-5-5", 3) },
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
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-sonnet-5.json)",
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-sonnet-5", 3) },
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
    { supersededBy: "claude-fable-5-1" },
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
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 and precision 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-haiku-4-5-20251001.json)",
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-haiku-4-5-20251001", 3) },
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
    { supersededBy: "claude-opus-5-5" },
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
      "VideoClaw Bench vcb-mm-inspect-001 v1.0.0, system track, 3/3 isolated rollouts at recall 1.0 each, verifier v1.1.0 (bench/runs/vcb-mm-inspect-001-claude-fable-5-1.json). Precision was 1.0/1.0/0.67 — every seeded defect was found, alongside one unseeded finding on the third rollout.",
    ],
    CLAUDE_BENCH_NOT_COVERED,
    { bench: claudeBench("claude-fable-5-1", 3) },
  ),
];
const CLAUDE_EVIDENCE_BY_ROUTE_ID = new Map(CLAUDE_MODEL_EVIDENCE.map((row) => [row.routeId, row]));
const CLAUDE_ROUTE_LABELS = {
  "claude-code": "the Claude Code plan",
  gateway: "Videoclaw credit",
};
function claudeModelEvidence(route, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  const model = modelId?.trim();
  if (!model) return void 0;
  const routeId = agentRouteId("claude-code", route, model);
  return ledger === CLAUDE_MODEL_EVIDENCE
    ? CLAUDE_EVIDENCE_BY_ROUTE_ID.get(routeId)
    : ledger.find((row) => row.routeId === routeId);
}
function claudeRouteQualification(route, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  const outcome = claudeModelEvidence(route, modelId, ledger)?.outcome;
  return outcome === "qualified"
    ? "qualified"
    : outcome === "excluded"
      ? "incompatible"
      : "unqualified";
}
function isQualifiedClaudeRoute(route, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  return claudeRouteQualification(route, modelId, ledger) === "qualified";
}
function isRecommendedClaudeRoute(route, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  const row = claudeModelEvidence(route, modelId, ledger);
  return row?.outcome === "qualified" && !row.supersededBy;
}
function claudeRouteDiagnostic(route, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  const model = modelId?.trim();
  if (!model) {
    return `VideoClaw has not qualified a Claude model on ${CLAUDE_ROUTE_LABELS[route]} (#108).`;
  }
  const elsewhere = route === "gateway" ? "claude-code" : "gateway";
  if (isQualifiedClaudeRoute(elsewhere, model, ledger)) {
    return `${model} is validated on ${CLAUDE_ROUTE_LABELS[elsewhere]}, not on ${CLAUDE_ROUTE_LABELS[route]} — VideoClaw has run no turn on that route (#108).`;
  }
  const row = claudeModelEvidence(route, model, ledger);
  if (row?.runtimeError) {
    return `${CLAUDE_ROUTE_LABELS[route]} refused ${model} (#108): ${row.runtimeError}`;
  }
  if (row?.outcome === "did-not-qualify") {
    const cite = row.bench
      ? ` ${row.bench.passed}/${row.bench.rollouts} rollouts (${row.bench.manifest}).`
      : "";
    return `${model} ran on ${CLAUDE_ROUTE_LABELS[route]} and did not meet VideoClaw's bar (#108).${cite}${row.shortfall ? ` ${row.shortfall}` : ""}`;
  }
  if (row?.supersededBy) {
    return `VideoClaw now recommends ${row.supersededBy} instead of ${model} (#1210).`;
  }
  return route === "claude-code"
    ? `VideoClaw hasn’t tested ${model} on ${CLAUDE_ROUTE_LABELS[route]} yet, so it isn’t recommended (#1210).`
    : `VideoClaw has not validated ${model} on ${CLAUDE_ROUTE_LABELS[route]} (#108).`;
}
function canonicalClaudeModelId(entry) {
  const raw = entry.resolvedModel?.trim() || (entry.value === "default" ? "" : entry.value.trim());
  return raw.replace(/\[1m\]$/i, "") || void 0;
}
function partitionDiscoveredClaudeModels(route, discovered, ledger = CLAUDE_MODEL_EVIDENCE) {
  const unique = [...new Map(discovered.map((m) => [m.id, m])).values()];
  const refused = (id) => claudeRouteQualification(route, id, ledger) === "incompatible";
  const selectable = unique.filter((m) => !refused(m.id));
  return {
    selectable,
    recommended: selectable
      .filter((m) => isRecommendedClaudeRoute(route, m.id, ledger))
      .map((m) => m.id),
    incompatible: unique
      .filter((m) => refused(m.id))
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        routeId: agentRouteId("claude-code", route, m.id),
        reason: claudeRouteDiagnostic(route, m.id, ledger),
      })),
  };
}
function claudeModelUnavailableDiagnostic(modelId) {
  return `${modelId} isn’t offered by the signed-in Claude Code account, so VideoClaw can’t pin it. Choose another model or Default (#997).`;
}
function claudeModelVerdict(route, discovered, modelId, ledger = CLAUDE_MODEL_EVIDENCE) {
  const qualification = claudeRouteQualification(route, modelId, ledger);
  const routeId = agentRouteId("claude-code", route, modelId);
  if (route !== "claude-code") {
    const qualified = qualification === "qualified";
    return {
      routeId,
      discovery: "unknown",
      qualification,
      selectable: qualified,
      defaultEligible: qualified,
      ...(qualified ? {} : { refusal: claudeRouteDiagnostic(route, modelId, ledger) }),
    };
  }
  const discovery = !discovered
    ? "unknown"
    : discovered.includes(modelId)
      ? "discovered"
      : "not-discovered";
  const refusal =
    qualification === "incompatible"
      ? claudeRouteDiagnostic(route, modelId, ledger)
      : discovery === "not-discovered"
        ? claudeModelUnavailableDiagnostic(modelId)
        : discovery === "unknown"
          ? `VideoClaw could not confirm ${modelId} is available on your Claude Code account.`
          : void 0;
  return {
    routeId,
    discovery,
    qualification,
    selectable: !refusal,
    defaultEligible: !refusal && isRecommendedClaudeRoute(route, modelId, ledger),
    ...(refusal ? { refusal } : {}),
  };
}
const STALE_RESUME_RE = /no conversation found with session id/i;
function isStaleResumeError(raw) {
  return STALE_RESUME_RE.test(String(raw ?? ""));
}
const NETWORK_RE =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH)\b/i;
const CONVERSATION_TOO_LARGE_RE =
  /(?:API Error:\s*(?:409|413).*HTTP 413|API Error:\s*413|request_too_large|operation body is too large to quote|conversation contains too much media history)/i;
function isConversationTooLargeError(raw) {
  return CONVERSATION_TOO_LARGE_RE.test(String(raw ?? ""));
}
function errorCauses(raw) {
  const causes = [];
  for (let error = raw; error != null && causes.length < 8;) {
    const detail = typeof error === "object" ? error : {};
    causes.push({
      message: String(detail.message ?? error),
      code: detail.code,
      name: detail.name,
      status: detail.status ?? detail.statusCode,
    });
    error = detail.cause;
  }
  return causes;
}
function classifyError(raw) {
  if (isConversationTooLargeError(raw)) return "conversation_too_large";
  const causes = errorCauses(raw);
  if (
    causes.some(
      ({ message, code, name, status }) =>
        name === "AbortError" ||
        code === "ABORT_ERR" ||
        (typeof status === "number" && status >= 400 && status <= 599) ||
        /\b(?:HTTP|API Error:|returned)\s*[45]\d\d\b/i.test(message),
    )
  )
    return "unknown";
  for (const [kind, copy] of Object.entries(FRIENDLY)) {
    if (kind !== "unknown" && causes.some(({ message }) => message.includes(copy))) return kind;
  }
  const filesystem = causes.map(({ message, code }) => `${code ?? ""} ${message}`).join("\n");
  if (/\b(?:ENOSPC|EDQUOT)\b|no space left on device|disk quota exceeded/i.test(filesystem))
    return "storage_full";
  if (/\b(?:EACCES|EPERM)\b/i.test(filesystem)) return "file_permission";
  if (/\b(?:EIO|EROFS)\b/i.test(filesystem)) return "storage_unavailable";
  if (/\bENOENT\b/i.test(filesystem)) return "file_missing";
  return causes.some(
    ({ message, code, name }) =>
      NETWORK_RE.test(String(code ?? "")) ||
      NETWORK_RE.test(message) ||
      name === "APIConnectionError" ||
      /^(?:API Error:\s*|TypeError:\s*)?(?:fetch failed|connection error\.?|network error\.?|offline|socket hang up(?:\s+on\s+\S+)?)$/i.test(
        message,
      ),
  )
    ? "network"
    : "unknown";
}
const FRIENDLY = {
  conversation_too_large:
    "This chat has grown too large to continue here. Continue in a fresh chat — your video and files will come with you.",
  network: "The connection failed. Check your connection before trying again.",
  storage_full: "There is not enough disk space to save. Free up space, then try again.",
  storage_unavailable:
    "Storage is unavailable for saving. Check that the drive is connected and writable, then try again.",
  file_permission:
    "Access to a required file was denied. Check file permissions before trying again.",
  file_missing:
    "A required file could not be found. Check that it is still available before trying again.",
  unknown: "Something broke on my side. Check the current work before trying again.",
};
function sanitizeErrorText(raw) {
  return FRIENDLY[classifyError(raw)];
}
function friendlyErrorLine(errorClass) {
  return typeof errorClass === "string" && Object.hasOwn(FRIENDLY, errorClass)
    ? FRIENDLY[errorClass]
    : FRIENDLY.unknown;
}
const RUNTIME_ERROR_KINDS = {
  authentication_failed: "access",
  oauth_org_not_allowed: "access",
  account_on_hold: "access",
  verification_required: "access",
  billing_error: "access",
  cloud_credential_error: "access",
  rate_limit: "access",
  model_not_found: "model-unavailable",
  overloaded: "outage",
  server_error: "outage",
  claude_terms_required: "access",
  codex_chatgpt_auth_rejected: "access",
  codex_api_key_rejected: "access",
  videoclaw_credit_exhausted: "access",
};
const CODEX_CHATGPT_AUTH_REJECTED = "codex_chatgpt_auth_rejected";
const CODEX_API_KEY_REJECTED = "codex_api_key_rejected";
function isCodexChatGptAuthRejected(raw) {
  return runtimeErrorCode(raw) === CODEX_CHATGPT_AUTH_REJECTED;
}
function isCodexAuthRejected(raw) {
  const code = runtimeErrorCode(raw);
  return code === CODEX_CHATGPT_AUTH_REJECTED || code === CODEX_API_KEY_REJECTED;
}
const VIDEOCLAW_CREDIT_EXHAUSTED = "videoclaw_credit_exhausted";
function isVideoclawCreditExhausted(raw) {
  return runtimeErrorCode(raw) === VIDEOCLAW_CREDIT_EXHAUSTED;
}
const CLAUDE_TERMS_REQUIRED = "claude_terms_required";
const CLAUDE_TERMS_NOTICE = /\b(?:consumer terms|privacy policy|updated terms)\b/i;
const CLAUDE_TERMS_ACTION =
  /\baccept(?:ed|ing|ance)?\b|\baction required\b|\breview the updated terms\b/i;
function isClaudeTermsNotice(text) {
  const value = typeof text === "string" ? text : "";
  return CLAUDE_TERMS_NOTICE.test(value) && CLAUDE_TERMS_ACTION.test(value);
}
function isClaudeTermsRequired(raw) {
  return runtimeErrorCode(raw) === CLAUDE_TERMS_REQUIRED;
}
function claudeTermsRequiredLine(canRetry) {
  return (
    "Claude needs you to accept its updated Consumer Terms and Privacy Policy. Open claude.ai signed in to the same Claude account this app uses, accept them, then " +
    (canRetry ? "press Retry." : "send your message again.")
  );
}
const RUNTIME_ERROR_HEADLINE = {
  authentication_failed:
    "The model account is signed out, so this step could not run. Reconnect it, then send your instruction again.",
  oauth_org_not_allowed:
    "The model account is signed in, but its organisation is not allowed to run this. Reconnect with an account that is, or switch to Videoclaw credit.",
  account_on_hold:
    "The model account is on hold, so it refused this step. That is a state on the account itself — not a problem with your video.",
  verification_required:
    "The model account needs to be verified before it can run this step. Finish that where the account lives, then try again.",
  cloud_credential_error:
    "The model account credential was rejected, so this step could not run. Reconnect it, then send your instruction again.",
  billing_error:
    "The model account refused this step for a billing reason. That is a setting on the plan behind that account — not a problem with your video and not a Videoclaw budget.",
  rate_limit:
    "The model account is being throttled right now, so this step could not run. That is a limit on how fast it may be used — not a problem with your video.",
  model_not_found:
    "The model this video is set to is not available on that account. Pick a different model in Account, then try again.",
  claude_terms_required: claudeTermsRequiredLine(true),
  codex_chatgpt_auth_rejected:
    "Your ChatGPT sign-in has expired, so this step could not run. Reconnect ChatGPT, then send your instruction again.",
  codex_api_key_rejected:
    "The API key this video uses was rejected, so this step could not run. Update it in Account, then send your instruction again.",
  videoclaw_credit_exhausted:
    "Your Videoclaw credit can't cover this chat's next step, so it did not run.",
};
function runtimeFailureHeadline(raw) {
  const code = runtimeErrorCode(raw);
  return code ? RUNTIME_ERROR_HEADLINE[code] : void 0;
}
const RUNTIME_AUTH_ERRORS = /* @__PURE__ */ new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "verification_required",
  "cloud_credential_error",
]);
function runtimeErrorCode(raw) {
  if (!raw || typeof raw !== "object") return void 0;
  const code = raw.error;
  return typeof code === "string" && code ? code : void 0;
}
function runtimeFailureKind(raw) {
  const code = runtimeErrorCode(raw);
  return code ? RUNTIME_ERROR_KINDS[code] : void 0;
}
function isRuntimeAuthFailure(raw) {
  const code = runtimeErrorCode(raw);
  return code !== void 0 && RUNTIME_AUTH_ERRORS.has(code);
}
const MODEL_REFUSAL_CODE =
  /\b(?:model[_ -](?:not[_ -]found|unavailable|unsupported|access[_ -]denied)|unsupported[_ -]model|invalid[_ -]model|unknown[_ -]model)\b/i;
const MODEL_WORD = /\bmodels?\b/i;
const MODEL_REFUSAL_PHRASE =
  /\b(?:is not available|isn't available|not available|no longer available|not supported|unsupported|not found|does not exist|doesn't exist|no access|(?:does not|doesn't) have access|denied access|access denied|not authorized|not entitled|not enabled|cannot be used)\b/i;
const ACCESS_REFUSAL =
  /\b40[13]\b|\b(?:unauthorized|forbidden|access denied|permission denied|insufficient[_ ]quota|quota exceeded|rate limit exceeded|plan (?:limit|does not include)|subscription (?:required|expired))\b/i;
const UPSTREAM_TIMEOUT =
  /\b504\b|\bgateway time-?out\b|\b(?:request|upstream|stream) timed out\b|\btimed out after\b/i;
const UPSTREAM_OUTAGE =
  /\b(?:HTTP|API Error:?|status(?: code)?|error code|returned status|responded(?: with)?)\s*(?:50[0-9]|52[0-9])\b|\b(?:internal server error|bad gateway|service unavailable|server error|no healthy upstream|upstream connect error|temporarily unavailable|currently unavailable|(?:is|are) (?:down|offline)|overloaded(?:_error)?|server is busy)\b/i;
const RATE_LIMITED =
  /\b(?:HTTP|API Error:?|status(?: code)?|error code|responded(?: with)?)\s*429\b|\b(?:rate[_ -]?limit(?:ed|_error)?|rate limit exceeded|too many requests|slow down)\b/i;
const QUOTA_EXHAUSTED =
  /\b(?:usage limits?|insufficient[_ ]quota|quota exceeded|plan limit|workspace is out of credits)\b/i;
const SUBSCRIPTION_PLAN_OFFER = /\bupgrade to (?:plus|pro|team|business|enterprise)\b/i;
function quotaClass(message) {
  if (!QUOTA_EXHAUSTED.test(message)) return void 0;
  return SUBSCRIPTION_PLAN_OFFER.test(message) ? "subscription" : "provider";
}
const PROVIDER_ERROR_PATTERNS = [
  [
    "model-unavailable",
    (text) =>
      MODEL_REFUSAL_CODE.test(text) || (MODEL_WORD.test(text) && MODEL_REFUSAL_PHRASE.test(text)),
  ],
  [
    "access",
    (text) => ACCESS_REFUSAL.test(text) || QUOTA_EXHAUSTED.test(text) || RATE_LIMITED.test(text),
  ],
  ["timeout", (text) => UPSTREAM_TIMEOUT.test(text)],
  ["outage", (text) => UPSTREAM_OUTAGE.test(text)],
];
function safeProviderText(raw, max = 180) {
  const scrubbed = raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "")
    .replace(/\b(?:visit|see|go to)\s+[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
    .replace(/(?:\/[\w.@+-]+){2,}\/?/g, "")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "")
    .replace(/\b[0-9a-f]{16,}\b/gi, "")
    .replace(/claude\s*code/gi, "the model runtime")
    .replace(/anthropic/gi, "the model provider")
    .replace(/\bSDK\b/gi, "the runtime")
    .replace(/\(\s*(?=[^)]*$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:)])/g, "$1")
    .trim();
  return scrubbed.length > max ? `${scrubbed.slice(0, max - 1).trimEnd()}…` : scrubbed;
}
function providerErrorDetail(raw) {
  const kind = providerFailureKind(raw);
  if (!kind) return void 0;
  if (isClaudeTermsRequired(raw)) return void 0;
  if (isCodexAuthRejected(raw)) return void 0;
  if (isVideoclawCreditExhausted(raw)) return void 0;
  const text = safeProviderText(providerMessage(raw));
  return text.length >= 12 ? { kind, text } : void 0;
}
function providerMessage(raw) {
  return String(
    (typeof raw === "object" && raw !== null && "message" in raw ? raw.message : raw) ?? "",
  );
}
function providerFailureKind(raw) {
  if (classifyError(raw) !== "unknown") return void 0;
  const structured = runtimeFailureKind(raw);
  if (structured) return structured;
  const message = providerMessage(raw);
  if (!message.trim()) return void 0;
  return PROVIDER_ERROR_PATTERNS.find(([, matches]) => matches(message))?.[0];
}
const TURN_CHARGE_NOTE = {
  not_charged: "This turn was not charged.",
  unknown: "Charge status for this turn could not be confirmed.",
};
const CAPABILITY_LABELS = [
  // Longest/most specific engine tool names first — `lipsync_footage` must not
  // be read as the bare `lipsync` alias, and `script_preflight` is a script
  // check rather than the cut's preflight.
  [/\blipsync(?:_footage)?\b/i, "Lip sync"],
  [/\b(?:perform_avatar|cast_avatar)\b/i, "Presenter video"],
  [/\b(?:score_bed|stem_split)\b/i, "Music generation"],
  [/\bsfx_catalog\b/i, "Sound effects"],
  [/\bmint_video\b/i, "Video generation"],
  [/\bmint_image\b/i, "Image generation"],
  [/\b(?:pull_video|acquire_footage|fetch_asset|media[./]pull)\b/i, "Footage download"],
  [/\b(?:clean_audio|scrub_reference_vo|audio[./]enhance)\b/i, "Audio cleanup"],
  [/\bdecode_audio\b/i, "Audio analysis"],
  [/\bsam3\b/i, "Subject cutout"],
  [/\bindex_media\b/i, "Library search"],
  [/\b(?:densify|chunk_boundaries)\b/i, "Caption fitting"],
  [/\b(?:frame_insert|fx_parallax|frame_boundaries)\b/i, "Motion beats"],
  [/\bbuild_carousel\b/i, "Carousel building"],
  [/\b(?:compose_render|remotion_render|assemble)\b/i, "Video assembly"],
  [
    /\b(?:review_output|review_render|verify_output|qa_gate|gemini_video|check_promise|check_layout|red_zones|preflight)\b/i,
    "Video analysis",
  ],
  [/\b(?:check_script|script_preflight)\b/i, "Script checking"],
  [/\bmodel_call\b/i, "The writing model"],
];
const SYNTH_VOICE_CAPABILITIES = [
  [/\btranscribe\b/i, "Transcription"],
  [/\b(?:voice_change|reference_tts|voice clon\w*|clone[_ -]?voice)\b/i, "Voice cloning"],
  [/\blist_voices\b/i, "The voice list"],
];
function providerCapabilityLabel(hint) {
  const text = String(hint ?? "");
  if (!text) return void 0;
  if (/\bsynth_voice\b/i.test(text)) {
    return (
      SYNTH_VOICE_CAPABILITIES.find(([pattern]) => pattern.test(text))?.[1] ?? "Voice generation"
    );
  }
  if (/\bvoice clon\w*\b/i.test(text)) return "Voice cloning";
  return CAPABILITY_LABELS.find(([pattern]) => pattern.test(text))?.[1];
}
function providerFailureDisposition(kind, raw) {
  if (kind === "outage" || kind === "timeout") return "transient";
  const code = runtimeErrorCode(raw);
  const message = providerMessage(raw);
  if (!QUOTA_EXHAUSTED.test(message)) {
    if (code === "rate_limit") return "transient";
    if (code && RUNTIME_ERROR_KINDS[code]) return "terminal";
  }
  if (kind === "access" && QUOTA_EXHAUSTED.test(message)) return "terminal";
  if (kind === "access" && RATE_LIMITED.test(message)) return "transient";
  return "terminal";
}
function providerFailureCopy(raw, chargeState) {
  const kind = providerFailureKind(raw);
  if (!kind) return void 0;
  const message = providerMessage(raw);
  const capability = providerCapabilityLabel(message);
  const disposition = providerFailureDisposition(kind, raw);
  const quota = kind === "access" ? quotaClass(message) : void 0;
  const runtimeHeadline = quota ? void 0 : runtimeFailureHeadline(raw);
  const subject = capability ?? "A service this step needs";
  return {
    kind,
    disposition,
    ...(capability ? { capability } : {}),
    // #831 — the runtime named this failure itself, so its own line is the
    // most specific thing the app can say. It outranks both the capability
    // headline and the quota one, neither of which was derived from anything
    // as reliable as the enum.
    ...(runtimeHeadline
      ? { headline: runtimeHeadline }
      : kind === "outage" || kind === "timeout"
        ? {
            headline:
              kind === "outage"
                ? `${subject} is unavailable right now. That is an outage in the service it runs on — not a problem with your video and not a spending limit.`
                : `${subject} did not answer in time. That is the service it runs on being slow — not a problem with your video and not a spending limit.`,
          }
        : quota
          ? {
              // #773 — the third class where "Something broke on my side" is
              // simply FALSE. Nothing here broke; an allowance ran out. The
              // provider's own sentence (rendered underneath) names the runtime
              // and any reset time; this says whose limit it is — and says only
              // as much as the message actually established (#774 review).
              headline: QUOTA_HEADLINE[quota],
            }
          : {}),
    // #925 — "choose a different option" is the wrong advice here: accepting
    // the terms clears it, and nothing else does.
    guidance: isCodexChatGptAuthRejected(raw)
      ? "Reconnect ChatGPT, then send a new instruction to continue this video."
      : isCodexAuthRejected(raw)
        ? "Replace the rejected API key in Account, then send a new instruction."
        : isClaudeTermsRequired(raw)
          ? CLAUDE_TERMS_GUIDANCE
          : isVideoclawCreditExhausted(raw)
            ? VIDEOCLAW_CREDIT_GUIDANCE
            : PROVIDER_GUIDANCE[disposition],
    // #1164 — `not_submitted` proves only the refused call; earlier work in the
    // same turn may have been billed, so the turn-wide claim is kept beside it.
    turnNote:
      isVideoclawCreditExhausted(raw) && raw.notSubmitted === true && chargeState !== "not_charged"
        ? `The refused step was not charged.
${TURN_CHARGE_NOTE[chargeState ?? "unknown"]}`
        : TURN_CHARGE_NOTE[chargeState ?? "unknown"],
  };
}
const VIDEOCLAW_CREDIT_GUIDANCE =
  "Each step holds its worst-case cost before it starts, and this one needs more than your remaining balance. Top up, then send a new instruction to continue — the rest of your video is kept.";
const CLAUDE_TERMS_GUIDANCE =
  "Until the terms are accepted, Claude will refuse every step the same way. Your video is not the problem.";
const QUOTA_HEADLINE = {
  subscription:
    "You've reached the usage limit on your model runtime plan. That is a quota on that plan — not a problem with your video and not a spending limit.",
  provider:
    "The model runtime refused this step because its quota is used up. That is a limit on the plan or billing behind that account — not a problem with your video.",
};
const PROVIDER_GUIDANCE = {
  transient:
    "This usually clears on its own. Wait a few minutes and retry — the rest of your video is untouched.",
  terminal:
    "Retrying will not clear this on its own. Choose a different option for this step, or carry on with the rest of the video.",
};
function upstreamUnavailableRefusal(capability, kind = "outage", nothingStarted = true) {
  const subject = capability ?? "A service this step needs";
  const cause =
    kind === "timeout"
      ? `${subject} did not answer in time.`
      : `${subject} is unavailable right now.`;
  return (
    `${cause} This is an outage in the service it runs on — not a spending limit, and not a problem with your video. ` +
    (nothingStarted ? "No paid work started, so nothing was charged for it. " : "") +
    `${PROVIDER_GUIDANCE.transient}`
  );
}
const LIMITED_ACCOUNT_LABELS = {
  ...CODEX_PROVIDER_LABELS,
  claude: "Claude",
};
const LIMITED_ACCOUNT_URLS = {
  chatgpt: "https://chatgpt.com/codex/settings/usage",
  "openai-api": "https://platform.openai.com/",
  openrouter: "https://openrouter.ai/",
  claude: "https://claude.ai/",
};
function modelAccountLimit(raw, account) {
  const message = providerMessage(raw);
  if (
    !account ||
    !(account in LIMITED_ACCOUNT_URLS) ||
    providerFailureKind(raw) !== "access" ||
    !QUOTA_EXHAUSTED.test(message) ||
    providerCapabilityLabel(message)
  )
    return void 0;
  return {
    account,
    kind: /workspace is out of credits/i.test(message)
      ? "workspace-credits"
      : /usage limits?|plan limit/i.test(message)
        ? "usage"
        : "quota",
  };
}
function modelAccountLimitPresentation(limit, detail) {
  if (!limit || !["usage", "workspace-credits", "quota"].includes(limit.kind)) return void 0;
  const name = LIMITED_ACCOUNT_LABELS[limit.account];
  const url = LIMITED_ACCOUNT_URLS[limit.account];
  if (!url) return void 0;
  if (limit.account === "chatgpt" && limit.kind === "usage") {
    return {
      headline: "Your ChatGPT subscription has reached its usage limit.",
      action: "Open ChatGPT",
      url,
      ...{},
    };
  }
  return {
    headline:
      limit.kind === "workspace-credits"
        ? `${name} workspace credits exhausted.`
        : `${name} ${limit.kind === "usage" ? "usage limit reached" : "account quota exhausted"}.`,
    action: `Open ${name}`,
    url,
  };
}
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
  "website_style",
];
const FREE_GEN_TOOL_SET = new Set(FREE_GEN_TOOLS);
const PAID_GEN_TOOLS = [
  "acquire_footage",
  "analyze_reference",
  "breakdown_reference",
  "build_carousel",
  "build_character_sheet",
  "cast_avatar",
  "check_script",
  "clean_audio",
  "compose_render",
  // Reference-sensitive: every mode is local numpy/scipy + ffmpeg measurement,
  // but resolve_ref hands a remote http(s) --input/--candidates/--vocal-stem(s)
  // to pull_video's own audio-only gateway rip. Local paths, file:// URLs and
  // --selftest are downgraded in classifyPaidGen below; engine
  // ANALYSIS_SPEND_TOOLS with a cost.py row on the acquisition rail
  // (videoclaw#198).
  "decode_audio",
  "densify",
  "frame_insert",
  // One fixed-price gateway depth map per still, reused on re-runs
  // (videoclaw#296, backend depth_map/estimate). Engine ALWAYS_PAID_TOOLS.
  "fx_parallax",
  "gemini_video",
  // Command-sensitive: Gemini-backed index/search/img/sync spend, while
  // metadata-only and explicit local/dummy embedding forms are downgraded in
  // classifyPaidGen below.
  "index_media",
  "lipsync_footage",
  // Transcript-sensitive: the timeline strips are local ffmpeg/PIL work, but
  // each video with no transcript on hand costs one metered Scribe pass
  // (cost.py prices it per video, so a two-video stack plans two).
  // `--no-transcript` and `-h`/`--help` before any `--` are downgraded in
  // classifyPaidGen below; engine ANALYSIS_SPEND_TOOLS (videoclaw#271).
  "look_at_video",
  "mint_image",
  "mint_video",
  "perform_avatar",
  "pull_video",
  // The engine's safe vendor-wrapper CLI is ALWAYS_PAID engine-side; its
  // absence here was the drift class check:money-drift now pins (an
  // engine-declared spender missing from this list priced UNKNOWN → the
  // sticky-trap card).
  "replicate_safe",
  "review_output",
  "sam3",
  "score_bed",
  "script_preflight",
  "scrub_reference_vo",
  // Authenticated, networked catalog retrieval is zero-cost, but it is not a
  // local-only FREE tool. Keep it on the guarded surface so a gateway-backed
  // operation can never inherit the unknown-tool path or masquerade as local.
  "sfx_catalog",
  "stem_split",
  "synth_voice",
  "verify_output",
];
function unpricedPaidGenTools(prices, perSecondKeys) {
  const priced = /* @__PURE__ */ new Set([
    ...prices,
    ...perSecondKeys.map((key) => key.split(":", 1)[0]),
  ]);
  return PAID_GEN_TOOLS.filter((tool) => !priced.has(tool));
}
const PAID_GEN_RE = new RegExp(`\\b(${PAID_GEN_TOOLS.join("|")})\\b`);
const PAID_TARGET_RE = new RegExp(`^(?:\\S*/)?(${PAID_GEN_TOOLS.join("|")})(?:\\.py)?$`);
const TOOLS_PATH_TARGET_RE = /^(?:\S*\/)?tools\/([^/\s]+?)\.py$/;
function paidToolFromTarget(token) {
  const exact = PAID_TARGET_RE.exec(token)?.[1];
  if (exact) return exact;
  const scripted = TOOLS_PATH_TARGET_RE.exec(token)?.[1];
  if (scripted !== void 0 && !FREE_GEN_TOOL_SET.has(scripted)) {
    return scripted;
  }
  return void 0;
}
const FREE_SUBCOMMANDS = {
  lipsync_footage: /* @__PURE__ */ new Set([
    "plan",
    "face-envelope",
    "motion-envelope",
    "composite",
  ]),
};
const FREE_FLAGS = {
  check_script: /* @__PURE__ */ new Set(["--skip-llm"]),
  script_preflight: /* @__PURE__ */ new Set(["--skip-llm"]),
  verify_output: /* @__PURE__ */ new Set(["--pre-gen"]),
};
const FREE_MODES = {
  compose_render: /* @__PURE__ */ new Set(["render", "retrofit", "cover_bake"]),
  synth_voice: /* @__PURE__ */ new Set(["list_voices"]),
  verify_output: /* @__PURE__ */ new Set(["render", "audio", "pre-gen"]),
  // score_bed --mode bed ASSEMBLES a bed from already-acquired stems locally
  // (ffmpeg), so cost.py rates it $0 on purpose; generate/split genuinely spend
  // and stay paid. Downgrading bed here (not just leaning on cost.py's `free`)
  // keeps it auto-approving on a PRE-#74 engine too — one that returns 0 with
  // no `free` field would otherwise render an unpriced card whose approval
  // latches the sticky unknown-spend flag (videoclaw#74 A5). This is a
  // specific audited-free mode, NOT an ambiguous zero row like
  // compose_render[_default] (whose --mode episode also resolves to _default).
  score_bed: /* @__PURE__ */ new Set(["bed"]),
};
const DECODE_AUDIO_REF_FLAGS = ["--input", "--candidates", "--vocal-stems", "--vocal-stem"];
const DECODE_AUDIO_MULTI_REF_FLAGS = /* @__PURE__ */ new Set(["--candidates", "--vocal-stems"]);
const DECODE_AUDIO_NO_RESOLVE_FLAGS = /* @__PURE__ */ new Set(["--selftest", "-h", "--help"]);
const REMOTE_SCHEMES = /* @__PURE__ */ new Set(["http", "https"]);
function refScheme(ref) {
  const normalized = ref.replace(/^[\x00-\x20]+/, "").replace(/[\t\r\n]/g, "");
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(normalized);
  return match ? match[1].toLowerCase() : "";
}
function isRemoteRef(ref) {
  return REMOTE_SCHEMES.has(refScheme(ref));
}
const AMBIGUOUS_REF_FLAG = Symbol("ambiguous");
function resolveRefFlag(name) {
  if (DECODE_AUDIO_REF_FLAGS.includes(name)) return name;
  if (!name.startsWith("--") || name === "--") return void 0;
  const matches = DECODE_AUDIO_REF_FLAGS.filter((flag) => flag.startsWith(name));
  if (matches.length === 1) return matches[0];
  return matches.length > 1 ? AMBIGUOUS_REF_FLAG : void 0;
}
function decodeAudioRefs(tokens) {
  const values = /* @__PURE__ */ new Map();
  let flag;
  let provable = true;
  for (const token of tokens) {
    if (token === "--") {
      provable = false;
      flag = void 0;
      continue;
    }
    if (token.startsWith("-") && token !== "-") {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      const resolved = resolveRefFlag(name);
      flag = void 0;
      if (resolved === AMBIGUOUS_REF_FLAG) {
        provable = false;
      } else if (resolved !== void 0) {
        values.set(resolved, eq === -1 ? [] : [token.slice(eq + 1)]);
        if (eq === -1) flag = resolved;
      }
      continue;
    }
    if (flag !== void 0) {
      values.get(flag)?.push(token);
      if (!DECODE_AUDIO_MULTI_REF_FLAGS.has(flag)) flag = void 0;
    }
  }
  const refs = DECODE_AUDIO_REF_FLAGS.flatMap((name) => values.get(name) ?? []);
  return { refs, provable };
}
function decodeAudioSpends(tokens) {
  if (tokens.some((token) => DECODE_AUDIO_NO_RESOLVE_FLAGS.has(token))) {
    return false;
  }
  const { refs, provable } = decodeAudioRefs(tokens);
  if (refs.some((ref) => isRemoteRef(ref))) return true;
  return !provable || refs.length === 0;
}
const LOOK_AT_VIDEO_FREE_TOKENS = ["--no-transcript", "-h", "--help"];
function lookAtVideoIsFree(args) {
  for (const token of args) {
    if (token === "--") return false;
    if (LOOK_AT_VIDEO_FREE_TOKENS.includes(token)) return true;
  }
  return false;
}
function modeValues(tokens) {
  const values = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "--mode") {
      if (tokens[i + 1] !== void 0) values.push(tokens[i + 1]);
    } else if (tokens[i].startsWith("--mode=")) {
      values.push(tokens[i].slice("--mode=".length));
    }
  }
  return values;
}
const READER_HEADS = /* @__PURE__ */ new Set([
  "cat",
  "grep",
  "rg",
  "head",
  "tail",
  "echo",
  "printf",
  "ls",
  "wc",
  "nl",
  "diff",
  "stat",
  "file",
  "du",
  "uniq",
  "cut",
  "tr",
  "which",
  "type",
  "basename",
  "dirname",
  "test",
  "true",
]);
const EXEC_HOOK_ENV_RE =
  /^(?:LESSOPEN|LESSCLOSE|BASH_ENV|ENV|PYTHONSTARTUP|PYTHONINSPECT|NODE_OPTIONS|PERL5OPT|RUBYOPT|LD_PRELOAD|DYLD_INSERT_LIBRARIES)=/;
const PRICE_DETERMINING_FLAGS = [
  // count
  "--count",
  "--variants",
  "--slides",
  "--num",
  "--n",
  // role / mode
  "--role",
  "--mode",
  "--vision-mode",
  "--rail",
  // gateway route / fixed-output duration
  "--model",
  "--duration",
  "--quality",
  "--resolution",
  "--fast",
  "--multishot-file",
  "--multishot",
  "--eye-check-method",
  "--skip-eye-check",
  // billed media
  "--video",
  "--driver-video",
  "--audio",
  // batch fleet
  "--batch",
  // content-dependent fan-out branches (synth_voice/perform_avatar/gemini_video
  // read --script/--chunk; pull_video/acquire_footage read --bed)
  "--script",
  "--chunk",
  "--bed",
];
function abbreviatesPriceFlag(args) {
  for (const arg of args) {
    if (!arg.startsWith("--") || arg === "--") continue;
    const name = arg.split("=", 1)[0];
    if (PRICE_DETERMINING_FLAGS.includes(name)) continue;
    if (
      name.length > 2 &&
      PRICE_DETERMINING_FLAGS.some((flag) => flag !== name && flag.startsWith(name))
    ) {
      return true;
    }
  }
  return false;
}
const WRAPPER_HEADS = /* @__PURE__ */ new Set(["env", "nohup", "time", "command", "exec"]);
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PYTHON_RE = /^python(?:\d+(?:\.\d+)*)?$/;
const IN_WORD_BLANK_RE = /[^\S \t\n\r]/;
let splitEveryBlank = false;
function tokenizeShell(command) {
  const tokens = [];
  let value = "";
  let started = false;
  let quoted = false;
  let escaped = false;
  let quote = null;
  let opaque = false;
  let stillLiteral = true;
  let literalPrefixLen = 0;
  const addLiteral = (ch) => {
    value += ch;
    started = true;
    if (stillLiteral) literalPrefixLen += ch.length;
  };
  const addNonLiteral = (ch, wasEscape) => {
    value += ch;
    started = true;
    stillLiteral = false;
    if (wasEscape) escaped = true;
  };
  const flush = () => {
    if (!started) return;
    tokens.push({ value, quoted, escaped, literalPrefixLen });
    value = "";
    started = false;
    quoted = false;
    escaped = false;
    stillLiteral = true;
    literalPrefixLen = 0;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") {
        quote = null;
        quoted = true;
      } else {
        addNonLiteral(c, false);
      }
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = null;
        quoted = true;
      } else if (c === "\\" && command[i + 1] === "\n") {
        i++;
      } else if (
        c === "\\" &&
        i + 1 < command.length &&
        (command[i + 1] === "$" ||
          command[i + 1] === "`" ||
          command[i + 1] === '"' ||
          command[i + 1] === "\\")
      ) {
        addNonLiteral(command[++i], true);
      } else {
        if (c === "$" || c === "`") opaque = true;
        addNonLiteral(c, false);
      }
      continue;
    }
    if (c === " " || c === "	" || c === "\n" || c === "\r" || (splitEveryBlank && /\s/.test(c))) {
      if (c === "\n" || c === "\r") opaque = true;
      flush();
      continue;
    }
    if (/\s/.test(c)) opaque = true;
    if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
      started = true;
      stillLiteral = false;
      continue;
    }
    if (c === "\\") {
      if (command[i + 1] === "\n") {
        i++;
        continue;
      }
      if (command[i + 1] === "\r" && command[i + 2] === "\n") {
        i += 2;
        continue;
      }
      if (i + 1 >= command.length) {
        opaque = true;
        continue;
      }
      addNonLiteral(command[++i], true);
      continue;
    }
    if (";&|<>(){}*?[]".includes(c) || c === "`" || c === "$" || c === "#") {
      opaque = true;
    }
    addLiteral(c);
  }
  flush();
  return { tokens, unclosedQuote: quote !== null, opaque };
}
function paidMentionText(command) {
  return command.replace(/['"\\]/g, "");
}
function expandBraces(pattern) {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const choices = match[1].split(",");
  if (choices.length > 16) return [pattern];
  return choices.flatMap((choice) =>
    expandBraces(
      pattern.slice(0, match.index) + choice + pattern.slice(match.index + match[0].length),
    ),
  );
}
function globPattern(pattern) {
  if (!/[*?[\]]/.test(pattern)) return null;
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) return null;
      const content = pattern.slice(i + 1, end);
      source += `[${content.startsWith("!") ? "^" + content.slice(1) : content}]`;
      i = end;
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }
  try {
    return new RegExp(source + "$");
  } catch {
    return null;
  }
}
function potentialPaidTool(command) {
  const exact = PAID_GEN_RE.exec(paidMentionText(command))?.[1];
  if (exact) return exact;
  const tokens = tokenizeShell(command).tokens.map((token) => token.value);
  for (const token of tokens) {
    for (const expanded of expandBraces(token)) {
      const target = paidToolFromTarget(expanded);
      if (target) return target;
      const pattern = globPattern(baseName(expanded));
      if (!pattern) continue;
      for (const tool of PAID_GEN_TOOLS) {
        if (pattern.test(tool) || pattern.test(`${tool}.py`)) return tool;
      }
    }
  }
  return void 0;
}
function splitSegments(command) {
  const segments = [];
  let cur = "";
  let quote = null;
  let redirectOperator = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const afterRedirectOperator = redirectOperator;
    redirectOperator = false;
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) {
        cur += command[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      cur += c + command[++i];
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "\n" || c === ";") {
      segments.push(cur);
      cur = "";
      continue;
    }
    if (c === "|" && afterRedirectOperator) {
      cur += c;
      continue;
    }
    if ((c === "&" || c === "|") && command[i + 1] === c) {
      segments.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === "|") {
      segments.push(cur);
      cur = "";
      continue;
    }
    redirectOperator = c === ">";
    cur += c;
  }
  segments.push(cur);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}
function baseName(tok) {
  return tok.slice(tok.lastIndexOf("/") + 1);
}
function sedIsProvablyReadOnly(tokens, headIndex) {
  const scripts = [];
  let explicitScript = false;
  for (let i = headIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "-e" || token === "--expression") {
      explicitScript = true;
      if (tokens[i + 1] !== void 0) scripts.push(tokens[++i]);
      continue;
    }
    if (token.startsWith("--expression=")) {
      explicitScript = true;
      scripts.push(token.slice("--expression=".length));
      continue;
    }
    if (token.startsWith("-e") && token !== "-E") {
      explicitScript = true;
      scripts.push(token.slice(2));
      continue;
    }
    if (
      token === "-n" ||
      token === "--quiet" ||
      token === "--silent" ||
      token === "-E" ||
      token === "-r" ||
      token === "-s" ||
      token === "-u" ||
      /^-[nErsu]+$/.test(token)
    ) {
      continue;
    }
    if (token.startsWith("-")) return false;
    if (!explicitScript && scripts.length === 0) scripts.push(token);
    break;
  }
  if (scripts.length === 0) return false;
  const address = String.raw`(?:\d+|\$|/(?:\\.|[^/])*/)`;
  const command = String.raw`(?:p|P|d|D|q|Q|=)`;
  const unit = String.raw`(?:${address}(?:\s*,\s*${address})?\s*!?\s*)?${command}`;
  const safeScript = new RegExp(String.raw`^\s*${unit}(?:\s*;\s*${unit})*\s*;?\s*$`);
  return scripts.every((script) => safeScript.test(script));
}
function targetTokenIndex(tokens) {
  let i = 0;
  while (i < tokens.length && ENV_ASSIGN_RE.test(tokens[i])) i++;
  while (i < tokens.length && WRAPPER_HEADS.has(baseName(tokens[i]))) {
    i++;
    while (i < tokens.length && (tokens[i].startsWith("-") || ENV_ASSIGN_RE.test(tokens[i]))) i++;
  }
  if (i >= tokens.length) return null;
  const head = baseName(tokens[i]);
  if (head === "find") {
    return tokens
      .slice(i + 1)
      .some((token) => ["-exec", "-execdir", "-ok", "-okdir"].includes(token))
      ? null
      : "READER";
  }
  if (head === "sed") {
    return sedIsProvablyReadOnly(tokens, i) ? "READER" : null;
  }
  if (READER_HEADS.has(head)) return "READER";
  if (head === "sh" || head === "bash" || head === "zsh" || head === "dash") {
    return null;
  }
  if (PYTHON_RE.test(head)) {
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j] === "-c") return null;
      if (!tokens[j].startsWith("-")) return j;
    }
    return null;
  }
  if (head === "uv") {
    for (let j = i + 1; j < tokens.length; j++) {
      const name = tokens[j].split("=", 1)[0];
      if (UV_RUN_OPTIONS_WITH_VALUE.has(name) && !tokens[j].includes("=")) {
        j++;
        continue;
      }
      if (tokens[j].endsWith(".py") || PAID_TARGET_RE.test(tokens[j])) return j;
    }
    return null;
  }
  return i;
}
function targetToken(tokens) {
  const index = targetTokenIndex(tokens);
  return typeof index === "number" ? tokens[index] : index;
}
const CODE_EXEC_RE =
  /(?:\bsubprocess\b|\bcreate_subprocess_(?:exec|shell)\b|\bmultiprocessing\b|\bos\.(?:system|popen|spawn\w*|exec\w*|posix_spawn|startfile)\b|\b(?:system|popen|spawn|exec|eval|compile)\s*\(|\brunpy\b|\bimportlib\b|\b__import__\b|\bbuiltins\b|\b(?:getattr|vars|globals|locals)\s*\(|\bPopen\b|\bcheck_(?:call|output)\b|\bpty\.spawn\b)/;
function hasExecutableObfuscation(parsed) {
  const tokens = parsed.tokens.map((token) => token.value);
  for (const token of tokens) {
    if (!ENV_ASSIGN_RE.test(token)) break;
    if (EXEC_HOOK_ENV_RE.test(token) || PAID_GEN_RE.test(token.slice(token.indexOf("=") + 1))) {
      return true;
    }
  }
  const target = targetTokenIndex(tokens);
  if (typeof target === "number") {
    return /[$`*?[\]{}]/.test(tokens[target]);
  }
  if (target === "READER") return false;
  const headIndex = tokens.findIndex((token) => !ENV_ASSIGN_RE.test(token));
  const head = baseName(tokens[headIndex] ?? "");
  if (PYTHON_RE.test(head) && tokens.includes("-c")) {
    return CODE_EXEC_RE.test(tokens.slice(tokens.indexOf("-c") + 1).join(" "));
  }
  if (["sh", "bash", "zsh", "dash"].includes(head) && tokens.includes("-c")) {
    return /[$`*?[\]{}]/.test(tokens.slice(tokens.indexOf("-c") + 1).join(" "));
  }
  return false;
}
function executableShellFragments(command) {
  const fragments = [];
  const parenthesized = (open) => {
    let depth = 1;
    let quote2 = null;
    let escaped2 = false;
    for (let index = open + 1; index < command.length; index++) {
      const char = command[index];
      if (escaped2) {
        escaped2 = false;
        continue;
      }
      if (quote2 === "ansi") {
        if (char === "\\") index++;
        else if (char === "'") quote2 = null;
        continue;
      }
      if (char === "\\" && quote2 !== "'") {
        escaped2 = true;
        continue;
      }
      if (quote2) {
        if (char === quote2) quote2 = null;
        continue;
      }
      if (char === "$" && command[index + 1] === "'") {
        quote2 = "ansi";
        index++;
        continue;
      }
      if (char === "'" || char === '"') {
        quote2 = char;
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")" && --depth === 0) {
        return [command.slice(open + 1, index), index];
      }
    }
    return void 0;
  };
  const backticked = (open) => {
    let escaped2 = false;
    for (let index = open + 1; index < command.length; index++) {
      const char = command[index];
      if (escaped2) {
        escaped2 = false;
        continue;
      }
      if (char === "\\") {
        escaped2 = true;
        continue;
      }
      if (char === "`") return [command.slice(open + 1, index), index];
    }
    return void 0;
  };
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === "ansi") {
      if (char === "\\") index++;
      else if (char === "'") quote = null;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === "$" && quote === null && command[index + 1] === "'") {
      quote = "ansi";
      index++;
      continue;
    }
    if (char === "'" && quote === null) {
      quote = char;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    const commandSubstitution = char === "$" && command[index + 1] === "(";
    const processSubstitution =
      quote === null && (char === "<" || char === ">") && command[index + 1] === "(";
    if (commandSubstitution || processSubstitution) {
      const fragment = parenthesized(index + 1);
      if (fragment) {
        fragments.push(fragment[0]);
        index = fragment[1];
      }
      continue;
    }
    if (char === "`") {
      const fragment = backticked(index);
      if (fragment) {
        fragments.push(fragment[0]);
        index = fragment[1];
      }
    }
  }
  return fragments;
}
const PROVIDER_STRONG_RE =
  /(?:VIDEOCLAW_(?:API_KEY|GATEWAY(?:_URL)?|GW_URL)|vc_[A-Za-z0-9]{16,}|videoclaw-gw-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.run\.app|aiplatform\.googleapis\.com|api\.anthropic\.com|api\.apify\.com|api\.elevenlabs\.io|api\.openai\.com|api\.replicate\.com|generativelanguage\.googleapis\.com|openrouter\.ai|fal\.(?:ai|run))/i;
const PROVIDER_SDK_CALL_RE =
  /(?:\.chat\.completions\.create\s*\(|\.images\.(?:generate|edit|create_variation)\s*\(|\.messages\.(?:create|stream)\s*\(|\.models\.generate_(?:content|images)\s*\(|\.predictions\.create\s*\(|\.responses\.create\s*\(|\.audio\.(?:speech|transcriptions|translations)\.create\s*\(|\.text_to_speech\.(?:convert|stream)\s*\(|\bfal_client\.(?:run|stream|submit|subscribe)\s*\(|\bGenerativeModel\s*\([^)]*\)\s*\.generate_content\s*\()/;
const PROVIDER_GENERIC_CLIENT_RE =
  /(?:\baiohttp\b|\baxios\b|\bfetch\s*\(|\bhttpx\b|\bhttps?\.request\s*\(|\bnode-fetch\b|\brequests\b|\bundici\b|\burllib3?\b|\burlopen\s*\(|HTTPS?Connection\s*\(|XMLHttpRequest)/;
const PROVIDER_MUTATION_RE =
  /(?:(?:^|\s)-d\b|-d@|--data\b|--data-[a-z]+\b|--json\b|--form(?:-string)?\b|(?:^|\s)-F\b|(?:^|\s)-T\b|--upload-file\b|--post-data\b|--post-file\b|\b(?:DELETE|PATCH|POST|PUT)\b|\.(?:post|put|patch|send|upload)\s*\(|\b(?:aiohttp|axios|httpx|requests|urllib3)\.(?:delete|patch|post|put)\s*\(|\b(?:aiohttp|axios|httpx|requests|urllib3)\.request\s*\(\s*["'](?:post|put|patch|delete)["']|\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:aiohttp|axios|httpx|requests|urllib3)\.(?:delete|patch|post|put)\b|method\s*[:=]\s*["'](?:post|put|patch|delete|POST|PUT|PATCH|DELETE)["'])/;
const PROVIDER_ACQUISITION_HOST_PATTERNS = [String.raw`api\.apify\.com`];
const PROVIDER_ACQUISITION_HOST_RE = new RegExp(
  `(?:^|\\.)(?:${PROVIDER_ACQUISITION_HOST_PATTERNS.join("|")})$`,
  "i",
);
const SCHEMELESS_ACQUISITION_RE = new RegExp(
  String.raw`(^|[\s"'(=])((?:[\w-]+\.)*(?:${PROVIDER_ACQUISITION_HOST_PATTERNS.join("|")})\.?(?=[:/?#\s"'<>|;,)\]}+]|$))`,
  "gi",
);
function acquisitionOriginMatch(text) {
  text = text.replace(/["']\s*\+\s*["']/g, "").replace(SCHEMELESS_ACQUISITION_RE, "$1https://$2");
  return (text.match(/https?:\/\/[^\s"'<>|;,)\]}+]+/gi) ?? []).some((candidate) => {
    try {
      return PROVIDER_ACQUISITION_HOST_RE.test(new URL(candidate).hostname.replace(/\.$/, ""));
    } catch {
      return false;
    }
  });
}
const PROVIDER_ORIGIN_HOSTNAME_RE =
  /(?:^|\.)(?:videoclaw-gw-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.run\.app|aiplatform\.googleapis\.com|api\.anthropic\.com|api\.apify\.com|api\.elevenlabs\.io|api\.openai\.com|api\.replicate\.com|generativelanguage\.googleapis\.com|openrouter\.ai|fal\.(?:ai|run))$/i;
function isPaidProviderOriginUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return PROVIDER_ORIGIN_HOSTNAME_RE.test(url.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}
const PROVIDER_CLIENT_BINARY_RE = /^(?:curl|curlie|http|https|httpie|xh|wget|hurl)$/;
const HTTPIE_EXPANSION_HEAD_RE = /^[$`{~*?[\\]/;
const HTTPIE_EXPANSION_RE = /[$`{}*?[\]\\]/;
const HTTPIE_REDIRECT_TOKEN_RE = /^[0-9&]*[<>][<>&|-]*$/;
function httpieWordMayBeFlag(token) {
  return (
    HTTPIE_EXPANSION_HEAD_RE.test(token) ||
    (token.startsWith("-") && HTTPIE_EXPANSION_RE.test(token))
  );
}
function httpieExemption(tokens, flag) {
  const comment = tokens.findIndex((token) => token.startsWith("#"));
  const negation = `--no-${flag.slice(2)}`;
  return (
    tokens.slice(0, comment < 0 ? tokens.length : comment).includes(flag) &&
    !tokens.some(
      (token, index) =>
        token === negation ||
        (httpieWordMayBeFlag(token) && !HTTPIE_REDIRECT_TOKEN_RE.test(tokens[index - 1] ?? "")),
    )
  );
}
function httpieOffline(tokens) {
  return httpieExemption(tokens, "--offline");
}
function httpieIgnoresStdin(tokens) {
  return httpieExemption(tokens, "--ignore-stdin");
}
const PROVIDER_CLIENT_ANYWHERE_RE =
  /(?:^|[\s"'(;])(?:curl|curlie|http|https|httpie|xh|wget|hurl)(?=$|[\s"'();])/;
const CURL_HEADS = ["curl", "curlie"];
const NESTED_CURL_LAUNCHERS = [
  "exec",
  "find",
  "parallel",
  "setsid",
  "stdbuf",
  "timeout",
  "watch",
  "xargs",
];
const READER_SHELL_OUT_PATTERNS = [
  String.raw`(?:^|[\s;{}])e\s+\S`,
  String.raw`["']\s*\|\s*&?\s*getline`,
  String.raw`\bexecl?p?\s*\(`,
  String.raw`\bpopen\s*\(`,
  String.raw`\bs(.)(?:(?!\1).)*\1(?:(?!\1).)*\1[a-zA-Z0-9]*e(?![a-zA-Z0-9])`,
  String.raw`\bsystem\s*\(`,
  String.raw`\|\s*&?\s*["']`,
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
  "yq",
];
const CURL_HEAD_SET = new Set(CURL_HEADS);
const NESTED_CURL_LAUNCHER_SET = new Set(NESTED_CURL_LAUNCHERS);
const PROVIDER_READ_ONLY_HEAD_SET = new Set(PROVIDER_READ_ONLY_HEADS);
const FIND_EXEC_FLAGS = /* @__PURE__ */ new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const READER_SHELL_OUT_RE = new RegExp(`(?:${READER_SHELL_OUT_PATTERNS.join("|")})`, "i");
const DYNAMIC_EXEC_RE = /(?:execFile|execSync|spawn|subprocess|system)\b|\.run\s*\(/i;
const NESTED_CURL_RE = /\bcurl(?:ie)?\b/g;
function splitEnvString(value) {
  if (value.length > 8192 || value.includes("\\")) return void 0;
  const parsed = tokenizeShell(value);
  if (parsed.opaque || parsed.unclosedQuote || parsed.tokens.length > 256) {
    return void 0;
  }
  const tokens = parsed.tokens.map((token) => token.value);
  return tokens.length ? tokens : void 0;
}
function resolveProviderInvocation(tokens) {
  let remaining = [...tokens];
  const env = {};
  const recordAssignment = (token) => {
    const split = token.indexOf("=");
    env[token.slice(0, split)] = token.slice(split + 1);
  };
  for (;;) {
    const before = remaining.length;
    while (remaining[0] === "{" || remaining[0] === "}") remaining.shift();
    while (remaining[0] && ENV_ASSIGN_RE.test(remaining[0])) {
      recordAssignment(remaining[0]);
      remaining.shift();
    }
    if (baseName(remaining[0] ?? "") === "env") {
      remaining.shift();
      while (remaining.length) {
        const token = remaining[0];
        if (ENV_ASSIGN_RE.test(token)) {
          recordAssignment(token);
          remaining.shift();
        } else if (["-S", "--split-string"].includes(token)) {
          const split = splitEnvString(remaining[1] ?? "");
          if (!split) return void 0;
          remaining.splice(0, 2, ...split);
        } else if (token.startsWith("--split-string=")) {
          const split = splitEnvString(token.slice("--split-string=".length));
          if (!split) return void 0;
          remaining.splice(0, 1, ...split);
        } else if (token.startsWith("-S") && token.length > 2) {
          const split = splitEnvString(token.slice(2));
          if (!split) return void 0;
          remaining.splice(0, 1, ...split);
        } else if (["-u", "--unset", "-C", "--chdir"].includes(token)) {
          remaining.splice(0, Math.min(2, remaining.length));
        } else if (token === "--") {
          remaining.shift();
          break;
        } else if (
          ["--debug", "--ignore-environment", "--null"].includes(token) ||
          token.startsWith("--unset=") ||
          token.startsWith("--chdir=")
        ) {
          remaining.shift();
        } else if (token === "-") {
          remaining.shift();
        } else if (token.startsWith("-") && !token.startsWith("--")) {
          let consumed = false;
          for (let position = 1; position < token.length; position++) {
            const option = token[position];
            if (option === "i" || option === "0" || option === "v") continue;
            if (option !== "S" && option !== "u" && option !== "C") {
              return void 0;
            }
            const attached = token.slice(position + 1);
            const consumesNext = attached.length === 0;
            const value = consumesNext ? (remaining[1] ?? "") : attached;
            if (!value) return void 0;
            if (option === "S") {
              const split = splitEnvString(value);
              if (!split) return void 0;
              remaining.splice(0, consumesNext ? 2 : 1, ...split);
            } else {
              remaining.splice(0, consumesNext ? 2 : 1);
            }
            consumed = true;
            break;
          }
          if (!consumed) remaining.shift();
        } else if (token.startsWith("--")) {
          return void 0;
        } else {
          break;
        }
      }
    }
    if (baseName(remaining[0] ?? "") === "command") {
      remaining.shift();
      while (remaining[0]?.startsWith("-")) remaining.shift();
    }
    if (baseName(remaining[0] ?? "") === "time") {
      remaining.shift();
      while (remaining[0]?.startsWith("-")) {
        const option = remaining.shift();
        if (["-f", "--format", "-o", "--output"].includes(option ?? "")) {
          remaining.shift();
        }
      }
    }
    if (baseName(remaining[0] ?? "") === "nohup") remaining.shift();
    if (baseName(remaining[0] ?? "") === "nice") {
      remaining.shift();
      if (remaining[0] === "-n" || remaining[0] === "--adjustment") {
        remaining.splice(0, 2);
      } else if (/^(?:-\d+|-n[+-]?\d+|--adjustment=[+-]?\d+)$/.test(remaining[0] ?? "")) {
        remaining.shift();
      }
      if (remaining[0] === "--") remaining.shift();
    }
    if (remaining.length === before) break;
  }
  if (baseName(remaining[0] ?? "") === "uv") {
    for (let j = 1; j < remaining.length; j++) {
      const name = remaining[j].split("=", 1)[0];
      if (UV_RUN_OPTIONS_WITH_VALUE.has(name) && !remaining[j].includes("=")) {
        j++;
        continue;
      }
      if (!remaining[j].startsWith("-") && remaining[j] !== "run") {
        return { command: remaining.slice(j), env };
      }
    }
    return { command: [], env };
  }
  return { command: remaining, env };
}
function resolveProviderCommand(tokens) {
  return resolveProviderInvocation(tokens)?.command;
}
const XARGS_LONG_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "--arg-file",
  "--delimiter",
  "--eof",
  "--max-args",
  "--max-chars",
  "--max-lines",
  "--max-procs",
  "--process-slot-var",
  "--replace",
]);
const XARGS_LONG_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set([
  "--exit",
  "--help",
  "--interactive",
  "--no-run-if-empty",
  "--null",
  "--open-tty",
  "--show-limits",
  "--verbose",
  "--version",
]);
const XARGS_SHORT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "a",
  "d",
  "E",
  "I",
  "L",
  "n",
  "P",
  "s",
]);
const XARGS_SHORT_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["0", "o", "p", "r", "t", "x"]);
const TIMEOUT_LONG_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["--kill-after", "--signal"]);
const TIMEOUT_LONG_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set([
  "--foreground",
  "--help",
  "--preserve-status",
  "--verbose",
  "--version",
]);
const TIMEOUT_SHORT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["k", "s"]);
const TIMEOUT_SHORT_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["v"]);
const STDBUF_LONG_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["--error", "--input", "--output"]);
const STDBUF_LONG_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["--help", "--version"]);
const STDBUF_SHORT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["e", "i", "o"]);
const PARALLEL_LONG_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["--jobs"]);
const PARALLEL_LONG_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["--bar", "--keep-order"]);
const PARALLEL_SHORT_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set(["j"]);
const PARALLEL_SHORT_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["k"]);
const SETSID_LONG_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set([
  "--ctty",
  "--fork",
  "--help",
  "--version",
  "--wait",
]);
const SETSID_SHORT_BOOLEAN_OPTIONS = /* @__PURE__ */ new Set(["c", "f", "h", "V", "w"]);
const NO_OPTIONS = /* @__PURE__ */ new Set();
function optionTailStart(command, start, longWithValue, longBoolean, shortWithValue, shortBoolean) {
  let index = start;
  while (index < command.length) {
    const token = command[index];
    if (token === "--") return index + 1;
    if (token === "-" || !token.startsWith("-")) return index;
    if (token.startsWith("--")) {
      const name = token.split("=", 1)[0];
      if (longWithValue.has(name) && !token.includes("=")) {
        if (index + 1 >= command.length) return void 0;
        index += 2;
      } else if (longWithValue.has(name) || longBoolean.has(name)) {
        index++;
      } else {
        return void 0;
      }
      continue;
    }
    let consumesNext = false;
    for (let position = 1; position < token.length; position++) {
      const option = token[position];
      if (shortWithValue.has(option)) {
        consumesNext = position === token.length - 1;
        break;
      }
      if (!shortBoolean.has(option)) return void 0;
    }
    if (consumesNext) {
      if (index + 1 >= command.length) return void 0;
      index += 2;
    } else {
      index++;
    }
  }
  return void 0;
}
function nestedTargetResolution(tokens) {
  const nested = resolveProviderCommand(tokens);
  if (!nested?.length) return { kind: "ambiguous" };
  const head = baseName(nested[0]).toLowerCase();
  if (CURL_HEAD_SET.has(head)) return { kind: "curl", args: [nested.slice(1)] };
  return isProviderReadOnlyHead(head, nested) ? { kind: "non-curl" } : { kind: "ambiguous" };
}
function findNestedCurlResolution(command) {
  const args = [];
  let foundAction = false;
  for (let index = 1; index < command.length; index++) {
    if (!FIND_EXEC_FLAGS.has(command[index])) continue;
    foundAction = true;
    const end = command.findIndex(
      (token, candidate) => candidate > index && (token === ";" || token === "+"),
    );
    if (end < 0 || end === index + 1) return { kind: "ambiguous" };
    const resolution = nestedTargetResolution(command.slice(index + 1, end));
    if (resolution.kind === "ambiguous") return resolution;
    if (resolution.kind === "curl") args.push(...resolution.args);
    index = end;
  }
  if (!foundAction) return { kind: "non-curl" };
  return args.length ? { kind: "curl", args } : { kind: "non-curl" };
}
function resolveNestedCurlArgs(command) {
  const launcher = baseName(command[0] ?? "").toLowerCase();
  let targetIndex;
  if (launcher === "xargs") {
    targetIndex = optionTailStart(
      command,
      1,
      XARGS_LONG_OPTIONS_WITH_VALUE,
      XARGS_LONG_BOOLEAN_OPTIONS,
      XARGS_SHORT_OPTIONS_WITH_VALUE,
      XARGS_SHORT_BOOLEAN_OPTIONS,
    );
  } else if (launcher === "timeout") {
    const durationIndex = optionTailStart(
      command,
      1,
      TIMEOUT_LONG_OPTIONS_WITH_VALUE,
      TIMEOUT_LONG_BOOLEAN_OPTIONS,
      TIMEOUT_SHORT_OPTIONS_WITH_VALUE,
      TIMEOUT_SHORT_BOOLEAN_OPTIONS,
    );
    targetIndex = durationIndex === void 0 ? void 0 : durationIndex + 1;
  } else if (launcher === "stdbuf") {
    targetIndex = optionTailStart(
      command,
      1,
      STDBUF_LONG_OPTIONS_WITH_VALUE,
      STDBUF_LONG_BOOLEAN_OPTIONS,
      STDBUF_SHORT_OPTIONS_WITH_VALUE,
      NO_OPTIONS,
    );
  } else if (launcher === "parallel") {
    targetIndex = optionTailStart(
      command,
      1,
      PARALLEL_LONG_OPTIONS_WITH_VALUE,
      PARALLEL_LONG_BOOLEAN_OPTIONS,
      PARALLEL_SHORT_OPTIONS_WITH_VALUE,
      PARALLEL_SHORT_BOOLEAN_OPTIONS,
    );
  } else if (launcher === "setsid") {
    targetIndex = optionTailStart(
      command,
      1,
      NO_OPTIONS,
      SETSID_LONG_BOOLEAN_OPTIONS,
      NO_OPTIONS,
      SETSID_SHORT_BOOLEAN_OPTIONS,
    );
  } else if (launcher === "find") {
    return findNestedCurlResolution(command);
  } else if (["exec", "watch"].includes(launcher)) {
    targetIndex = command[1]?.startsWith("-") ? void 0 : 1;
  } else {
    return { kind: "ambiguous" };
  }
  if (targetIndex === void 0 || targetIndex >= command.length) {
    return { kind: "ambiguous" };
  }
  return nestedTargetResolution(command.slice(targetIndex));
}
function normalizedOrigin(raw) {
  try {
    if (!raw?.trim()) return void 0;
    const url = new URL(raw.trim());
    const port =
      url.port || (url.protocol === "http:" ? "80" : url.protocol === "https:" ? "443" : "");
    return port ? `${url.hostname.toLowerCase()}:${port}` : void 0;
  } catch {
    return void 0;
  }
}
function expandContextEnv(text, context) {
  return text.replace(
    /\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})/g,
    (raw, bare, braced) => context.env?.[bare ?? braced ?? ""] ?? raw,
  );
}
function contextProviderMatch(text, context) {
  const gatewayOrigin = normalizedOrigin(context.gatewayUrl);
  const expanded = expandContextEnv(text, context);
  if (PROVIDER_STRONG_RE.test(expanded)) return true;
  if (!gatewayOrigin) return false;
  return (expanded.match(/https?:\/\/[^\s"'<>|;,)]+/gi) ?? []).some(
    (candidate) => normalizedOrigin(candidate) === gatewayOrigin,
  );
}
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
  "-d",
];
const CURL_METHOD_FLAGS = ["--request", "-X"];
const CURL_FORCE_GET_FLAGS = ["--get", "-G"];
const CURL_FORCE_HEAD_FLAGS = ["--head", "-I"];
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
  "z",
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
  "--write-out",
];
const CURL_READ_METHODS = ["GET", "HEAD", "OPTIONS"];
const CURL_BODY_FLAG_SET = new Set(CURL_BODY_FLAGS);
const CURL_METHOD_FLAG_SET = new Set(CURL_METHOD_FLAGS);
const CURL_FORCE_GET_FLAG_SET = new Set(CURL_FORCE_GET_FLAGS);
const CURL_VALUE_SHORT_OPTION_SET = new Set(CURL_VALUE_SHORT_OPTIONS);
const CURL_LONG_WITH_VALUE_SET = new Set(CURL_LONG_WITH_VALUE);
const CURL_READ_METHOD_SET = new Set(CURL_READ_METHODS);
function* curlFlags(tokens) {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index++;
    if (token === "--") return;
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      if (equals !== -1) {
        yield [token.slice(0, equals), token.slice(equals + 1)];
      } else if (CURL_LONG_WITH_VALUE_SET.has(token) && index < tokens.length) {
        yield [token, tokens[index]];
        index++;
      } else {
        yield [token, void 0];
      }
      continue;
    }
    if (token.length > 1 && token.startsWith("-")) {
      for (let position = 1; position < token.length; position++) {
        const letter = token[position];
        if (!CURL_VALUE_SHORT_OPTION_SET.has(letter)) {
          yield [`-${letter}`, void 0];
          continue;
        }
        const glued = token.slice(position + 1);
        if (glued) {
          yield [`-${letter}`, glued];
        } else if (index < tokens.length) {
          yield [`-${letter}`, tokens[index]];
          index++;
        } else {
          yield [`-${letter}`, void 0];
        }
        break;
      }
    }
  }
}
function curlMutatesTransfer(tokens) {
  let method;
  let hasBody = false;
  let forceGet = false;
  for (const [flag, value] of curlFlags(tokens)) {
    if (CURL_METHOD_FLAG_SET.has(flag)) {
      if (value) method = value.toUpperCase();
    } else if (CURL_FORCE_GET_FLAG_SET.has(flag)) {
      forceGet = true;
    } else if (CURL_BODY_FLAG_SET.has(flag)) {
      hasBody = true;
    }
  }
  if (method !== void 0 && !CURL_READ_METHOD_SET.has(method)) return true;
  if (forceGet) return false;
  return hasBody;
}
function splitCurlTransfers(tokens) {
  const transfers = [[]];
  let options = true;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (options && token === "--") {
      options = false;
      transfers[transfers.length - 1].push(token);
    } else if (options && (token === "--next" || token === "-:")) {
      transfers.push([]);
      options = true;
    } else {
      let shortTakesNext = false;
      let appended = false;
      let splitShortBoundary = false;
      if (options && token.length > 2 && token.startsWith("-") && !token.startsWith("--")) {
        let piece = "";
        for (let position = 1; position < token.length; position++) {
          const letter = token[position];
          if (CURL_VALUE_SHORT_OPTION_SET.has(letter)) {
            piece += token.slice(position);
            shortTakesNext = position === token.length - 1;
            break;
          }
          if (letter === ":") {
            splitShortBoundary = true;
            if (piece) {
              transfers[transfers.length - 1].push(`-${piece}`);
              appended = true;
            }
            transfers.push([]);
            options = true;
            piece = "";
          } else {
            piece += letter;
          }
        }
        if (piece) {
          transfers[transfers.length - 1].push(`-${piece}`);
          appended = true;
        }
      }
      if (!appended && !splitShortBoundary) {
        transfers[transfers.length - 1].push(token);
      }
      const longTakesNext =
        token.startsWith("--") && !token.includes("=") && CURL_LONG_WITH_VALUE_SET.has(token);
      if (
        !appended &&
        !splitShortBoundary &&
        token.length > 1 &&
        token.startsWith("-") &&
        !token.startsWith("--")
      ) {
        for (let position = 1; position < token.length; position++) {
          if (!CURL_VALUE_SHORT_OPTION_SET.has(token[position])) continue;
          shortTakesNext = position === token.length - 1;
          break;
        }
      }
      if ((longTakesNext || shortTakesNext) && index + 1 < tokens.length) {
        transfers[transfers.length - 1].push(tokens[++index]);
      }
    }
  }
  return transfers;
}
function curlProviderMutation(tokens, context) {
  return splitCurlTransfers(tokens).some(
    (transfer) =>
      contextProviderMatch(transfer.join(" "), context) && curlMutatesTransfer(transfer),
  );
}
function nestedCurlMutation(text, context) {
  NESTED_CURL_RE.lastIndex = 0;
  let match;
  while ((match = NESTED_CURL_RE.exec(text)) !== null) {
    const rest = text.slice(match.index + match[0].length);
    const end = rest.search(/[;|&)\n`]/);
    const sub = end === -1 ? rest : rest.slice(0, end);
    if (curlProviderMutation(sub.split(/\s+/).filter(Boolean), context)) {
      return true;
    }
  }
  return false;
}
function isProviderReadOnlyHead(executable, command) {
  if (!PROVIDER_READ_ONLY_HEAD_SET.has(executable)) return false;
  if (executable === "find" && command.slice(1).some((token) => FIND_EXEC_FLAGS.has(token))) {
    return false;
  }
  return !READER_SHELL_OUT_RE.test(command.slice(1).join(" "));
}
function httpieDataItem(tokens) {
  return tokens.slice(1).some((token) => {
    if (token.startsWith("-")) return false;
    if (token.includes("://") || token.includes("?")) return false;
    return /:=/.test(token) || /@/.test(token) || /(?<![=:])=(?!=)/.test(token);
  });
}
function detectProviderCall(
  tokens,
  context,
  inputBody,
  opaqueShellExecution,
  providerShellExecution,
) {
  const invocation = resolveProviderInvocation(tokens);
  if (!invocation) return true;
  const { command } = invocation;
  const resolvedContext = {
    ...context,
    env: { ...context.env, ...invocation.env },
  };
  const head = baseName(command[0] ?? "").toLowerCase();
  const text = tokens.join(" ");
  if (isProviderReadOnlyHead(head, command)) {
    return providerShellExecution;
  }
  if (head === "git" || /\bprint\s*\(\s*["'][^"']*\bcurl\b/.test(text)) return false;
  if (/^(?:http|https|httpie|xh)$/.test(head) && httpieOffline(command)) return false;
  if (acquisitionOriginMatch(expandContextEnv(text, resolvedContext))) return true;
  if (CURL_HEAD_SET.has(head)) {
    return curlProviderMutation(command.slice(1), resolvedContext);
  }
  if (NESTED_CURL_LAUNCHER_SET.has(head)) {
    const nestedCurl = resolveNestedCurlArgs(command);
    if (nestedCurl.kind === "curl") {
      return nestedCurl.args.some((args) => curlProviderMutation(args, resolvedContext));
    }
    if (nestedCurl.kind === "non-curl") return providerShellExecution;
  }
  if (PROVIDER_SDK_CALL_RE.test(text) && !/\bprint\s*\(\s*["']/.test(text)) return true;
  if (!contextProviderMatch(text, resolvedContext)) return false;
  const nestedCurlContext =
    NESTED_CURL_LAUNCHER_SET.has(head) ||
    DYNAMIC_EXEC_RE.test(text) ||
    READER_SHELL_OUT_RE.test(text);
  if (nestedCurlContext && nestedCurlMutation(text, resolvedContext)) return true;
  const mutation =
    PROVIDER_MUTATION_RE.test(text) ||
    (/^(?:http|https|httpie|xh)$/.test(head) &&
      ((inputBody && !httpieIgnoresStdin(command)) ||
        /(?:^|\s)--raw(?:[=\s]|$)/.test(text) ||
        httpieDataItem(command)));
  if (!mutation) return false;
  return (
    PROVIDER_CLIENT_BINARY_RE.test(head) ||
    PROVIDER_CLIENT_ANYWHERE_RE.test(text) ||
    PROVIDER_GENERIC_CLIENT_RE.test(text)
  );
}
function contextWithShellAssignments(command, context) {
  const env = { ...context.env };
  for (const match of command.matchAll(
    /(?:^|[;\s])([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g,
  )) {
    env[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return { ...context, env };
}
function classifyPaidGen(command, context = {}) {
  const verdict = classifyShellWords(command, context);
  if (verdict.paid || splitEveryBlank || !IN_WORD_BLANK_RE.test(command)) {
    return verdict;
  }
  splitEveryBlank = true;
  try {
    return classifyShellWords(command, context);
  } finally {
    splitEveryBlank = false;
  }
}
function classifyShellWords(command, context) {
  const providerContext = contextWithShellAssignments(command, context);
  const providerInputBody =
    /\|\s*(?:http|https|httpie|xh)(?:\s|$)/i.test(command) ||
    /\b(?:http|https|httpie|xh)\b(?:>\||[^;&|])*</i.test(command);
  for (const segment of splitSegments(command)) {
    const parsed = tokenizeShell(segment);
    const tokens = parsed.tokens.map((token) => token.value);
    const mentionedTool = potentialPaidTool(segment);
    const executableObfuscation = hasExecutableObfuscation(parsed);
    const shellFragments = executableShellFragments(segment);
    const nestedClassifications = shellFragments.map((fragment) =>
      classifyPaidGen(fragment, providerContext),
    );
    const nestedProvider = nestedClassifications.find(
      (classification) => classification.provider === true,
    );
    const nestedPaid =
      nestedProvider ?? nestedClassifications.find((classification) => classification.paid);
    const providerCall = detectProviderCall(
      tokens,
      providerContext,
      providerInputBody,
      shellFragments.length > 0,
      nestedProvider !== void 0,
    );
    const target = targetToken(tokens);
    const targetIndex = target === null ? -1 : tokens.indexOf(target);
    const directBillingExecutor =
      target !== null &&
      (baseName(target) === "cost.py" || baseName(target) === "cost") &&
      targetIndex >= 0 &&
      tokens.slice(targetIndex + 1).find((token) => !token.startsWith("-")) === "execute";
    if (
      !mentionedTool &&
      !executableObfuscation &&
      !providerCall &&
      !nestedPaid &&
      !directBillingExecutor
    ) {
      continue;
    }
    if (target === "READER" && !parsed.unclosedQuote && shellFragments.length === 0) {
      continue;
    }
    if (nestedProvider) return nestedProvider;
    if (target === "READER" && !parsed.unclosedQuote) {
      if (nestedPaid) return nestedPaid;
      continue;
    }
    const directPaidTool = typeof target === "string" ? PAID_TARGET_RE.exec(target)?.[1] : void 0;
    if (providerCall && !directPaidTool) {
      return { paid: true, tool: "provider", provider: true, unpriceable: true };
    }
    if (parsed.unclosedQuote || executableObfuscation || (parsed.opaque && mentionedTool)) {
      return { paid: true, tool: mentionedTool };
    }
    const dashDash = tokens.indexOf("--");
    const optionTokens = dashDash === -1 ? tokens : tokens.slice(0, dashDash);
    const hasFreeFlag = optionTokens.some((t) => t === "--help" || t === "-h" || t === "--dry-run");
    if (target !== null) {
      const targetBase = baseName(target);
      if (targetBase === "cost.py" || targetBase === "cost") {
        const idx = optionTokens.indexOf(target);
        const sub =
          idx === -1 ? void 0 : optionTokens.slice(idx + 1).find((t) => !t.startsWith("-"));
        if (sub === "execute" && !hasFreeFlag) {
          return { paid: true, tool: "cost" };
        }
        continue;
      }
      const scripted = TOOLS_PATH_TARGET_RE.exec(target)?.[1];
      if (scripted !== void 0 && FREE_GEN_TOOL_SET.has(scripted)) {
        continue;
      }
      const m = PAID_TARGET_RE.exec(target);
      if (m) {
        const tool = m[1];
        if (tool === "look_at_video") {
          const idx = optionTokens.indexOf(target);
          const args = idx === -1 ? [] : optionTokens.slice(idx + 1);
          if (lookAtVideoIsFree(args)) continue;
          return { paid: true, tool };
        }
        if (hasFreeFlag) continue;
        if (tool === "index_media") {
          const idx = optionTokens.indexOf(target);
          const args = idx === -1 ? [] : optionTokens.slice(idx + 1);
          const subcommand = args.find((token) => !token.startsWith("-"));
          const backends = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i] === "--backend" && args[i + 1] !== void 0) {
              backends.push(args[i + 1]);
            } else if (args[i].startsWith("--backend=")) {
              backends.push(args[i].slice("--backend=".length));
            }
          }
          const explicitlyLocal =
            backends.length === 1 && (backends[0] === "local" || backends[0] === "dummy");
          const metadataOnly = /* @__PURE__ */ new Set([
            "reindex",
            "stats",
            "scan",
            "remove",
            "reset",
          ]).has(subcommand ?? "");
          const addSourceOnly = subcommand === "add-source" && !args.includes("--index");
          if (metadataOnly || addSourceOnly || explicitlyLocal) continue;
        }
        if (tool === "decode_audio") {
          const idx = optionTokens.indexOf(target);
          const args = idx === -1 ? [] : optionTokens.slice(idx + 1);
          if (!decodeAudioSpends(args)) continue;
        }
        const freeFlags = FREE_FLAGS[tool];
        if (freeFlags && optionTokens.some((t) => freeFlags.has(t))) continue;
        const freeModes = FREE_MODES[tool];
        if (freeModes) {
          const modes = modeValues(optionTokens);
          if (modes.length > 0 && modes.every((mode) => freeModes.has(mode))) {
            continue;
          }
        }
        if (tool === "pull_video" || tool === "acquire_footage") {
          const modes = modeValues(optionTokens);
          const idx = optionTokens.indexOf(target);
          const args = idx === -1 ? optionTokens : optionTokens.slice(idx + 1);
          if (
            modes.length === 1 &&
            modes[0] === "pull" &&
            !optionTokens.includes("--bed") &&
            !args.some((token) =>
              isPaidProviderOriginUrl(token.startsWith("--url=") ? token.slice(6) : token),
            )
          ) {
            continue;
          }
        }
        const free = FREE_SUBCOMMANDS[tool];
        if (free) {
          const idx = optionTokens.indexOf(target);
          const sub =
            idx === -1 ? void 0 : optionTokens.slice(idx + 1).find((t) => !t.startsWith("-"));
          if (sub && free.has(sub)) continue;
        }
        return { paid: true, tool };
      }
      if (scripted !== void 0) {
        return { paid: true, tool: mentionedTool ?? scripted };
      }
      return { paid: true, tool: mentionedTool };
    }
    return { paid: true, tool: mentionedTool };
  }
  return { paid: false };
}
const BILLED_MEDIA_BY_KEY = {
  lipsync_footage: "--audio",
  "mint_video:edit": "--video",
  "mint_video:reenact": "--driver-video",
  // videoclaw#272 / backend#302: Higgsfield Genjutsu bills whole seconds of the
  // INPUT clip at the --resolution tier; the gateway re-measures the upload.
  "mint_video:genjutsu": "--video",
};
const INPUT_BOUND_MINT_VIDEO_ROLES = ["edit", "reenact", "genjutsu"];
[
  ...Object.keys(BILLED_MEDIA_BY_KEY),
  "mint_video:insert",
  "mint_video:keyframe",
  "mint_video:multishot",
];
function billedMediaFlags(tool, role) {
  const key =
    role !== void 0 && `${tool}:${role}` in BILLED_MEDIA_BY_KEY ? `${tool}:${role}` : tool;
  const flag = BILLED_MEDIA_BY_KEY[key];
  return flag ? [flag] : [];
}
const UV_RUN_OPTIONS_WITH_VALUE = /* @__PURE__ */ new Set([
  "--directory",
  "--env-file",
  "--index",
  "--index-url",
  "--project",
  "--python",
  "--python-platform",
  "--resolution",
  "--with",
  "--with-editable",
  "--with-requirements",
]);
const UV_RUN_RELOCATING_OPTIONS = /* @__PURE__ */ new Set(["--directory", "--project"]);
function budgetSafeTarget(tokens) {
  const execIndices = [];
  let relocates = false;
  let i = 0;
  if (i < tokens.length && ENV_ASSIGN_RE.test(tokens[i])) return null;
  while (i < tokens.length && WRAPPER_HEADS.has(baseName(tokens[i]))) {
    execIndices.push(i);
    i++;
    if (i < tokens.length && ENV_ASSIGN_RE.test(tokens[i])) return null;
    if (i >= tokens.length || tokens[i].startsWith("-")) return null;
  }
  if (i >= tokens.length) return null;
  const head = baseName(tokens[i]);
  if (head === "uv") {
    execIndices.push(i);
    if (tokens[i + 1] !== "run") return null;
    i += 2;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      const name = tokens[i].split("=", 1)[0];
      if (!UV_RUN_OPTIONS_WITH_VALUE.has(name)) return null;
      if (UV_RUN_RELOCATING_OPTIONS.has(name)) relocates = true;
      i += tokens[i].includes("=") ? 1 : 2;
    }
    if (i >= tokens.length) return null;
  }
  if (PYTHON_RE.test(baseName(tokens[i] ?? ""))) {
    execIndices.push(i);
    i++;
    if (i >= tokens.length || tokens[i].startsWith("-")) return null;
  }
  execIndices.push(i);
  return { target: i, execIndices, relocates };
}
function tildeArgIsAmbiguous(tok, equalsForm, value) {
  if (!value.startsWith("~")) return false;
  if (!tok) return true;
  if (equalsForm) return true;
  const prefixLen = value === "~" ? 1 : value.startsWith("~/") ? 2 : Infinity;
  return tok.literalPrefixLen < prefixLen;
}
function readUniqueFlag(tokens, names) {
  let value;
  let valueArgIndex;
  let equalsForm = false;
  let seen = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const exact = names.includes(token);
    const withEquals = names.find((name) => token.startsWith(`${name}=`));
    if (!exact && !withEquals) continue;
    if (seen) return { ok: false };
    seen = true;
    if (exact) {
      const next = tokens[i + 1];
      if (next === void 0 || next.startsWith("-")) return { ok: false };
      value = next;
      valueArgIndex = i + 1;
      equalsForm = false;
      i++;
    } else {
      value = token.slice(withEquals.length + 1);
      if (!value) return { ok: false };
      valueArgIndex = i;
      equalsForm = true;
    }
  }
  return { ok: true, value, valueArgIndex, equalsForm };
}
function budgetSafePaidGen(command) {
  const parsed = tokenizeShell(command);
  if (parsed.opaque || parsed.unclosedQuote || parsed.tokens.length === 0) return null;
  const tokens = parsed.tokens.map((token) => token.value);
  const resolved = budgetSafeTarget(tokens);
  if (resolved === null) return null;
  const targetIndex = resolved.target;
  const targetMeta = parsed.tokens[targetIndex];
  if (targetMeta.quoted || targetMeta.escaped) return null;
  const match = PAID_TARGET_RE.exec(targetMeta.value);
  if (!match) return null;
  if (!classifyPaidGen(command).paid) return null;
  const args = tokens.slice(targetIndex + 1);
  if (args.includes("--") || args.some((arg) => arg === "-n" || arg.startsWith("-n="))) {
    return null;
  }
  if (abbreviatesPriceFlag(args)) return null;
  const count = readUniqueFlag(args, ["--count", "--variants", "--slides", "--num", "--n"]);
  const role = readUniqueFlag(args, ["--role", "--mode", "--vision-mode", "--rail"]);
  const model = match[1] === "mint_image" ? readUniqueFlag(args, ["--model"]) : { ok: true };
  const duration = readUniqueFlag(args, ["--duration"]);
  const quality = readUniqueFlag(args, ["--quality"]);
  const resolution = readUniqueFlag(args, ["--resolution"]);
  const multishotFile = readUniqueFlag(args, ["--multishot-file"]);
  const multishot = readUniqueFlag(args, ["--multishot"]);
  const eyeCheckMethod = readUniqueFlag(args, ["--eye-check-method"]);
  const fastCount = args.filter((arg) => arg === "--fast").length;
  const skipEyeCheckCount = args.filter((arg) => arg === "--skip-eye-check").length;
  if (
    !count.ok ||
    !role.ok ||
    !model.ok ||
    !duration.ok ||
    !quality.ok ||
    !resolution.ok ||
    !multishotFile.ok ||
    !multishot.ok ||
    !eyeCheckMethod.ok ||
    args.some((arg) => arg.startsWith("--fast=") || arg.startsWith("--skip-eye-check="))
  ) {
    return null;
  }
  const parsedCount = count.value === void 0 ? 1 : Number(count.value);
  if (!Number.isSafeInteger(parsedCount) || parsedCount <= 0) return null;
  if (role.value !== void 0 && !/^[A-Za-z0-9_-]+$/.test(role.value)) return null;
  if (
    model.value !== void 0 &&
    !["default", "nano-banana-2", "gpt-image-2"].includes(model.value)
  ) {
    return null;
  }
  if (quality.value !== void 0 && !/^[A-Za-z0-9_-]+$/.test(quality.value)) {
    return null;
  }
  const genjutsu = match[1] === "mint_video" && role.value === "genjutsu";
  if (
    resolution.value !== void 0 && // Genjutsu's resolution is its price tier and has a 480p tier; the
    // Seedance rails priced here accept only 720p/1080p.
    !(genjutsu ? /^(480p|720p|1080p)$/ : /^(720p|1080p)$/).test(resolution.value)
  ) {
    return null;
  }
  if (fastCount > 0 && quality.value === "standard") return null;
  if (eyeCheckMethod.value !== void 0 && !["opencv", "gemini"].includes(eyeCheckMethod.value)) {
    return null;
  }
  if (fastCount > 1 || skipEyeCheckCount > 1) return null;
  if (
    (eyeCheckMethod.value !== void 0 || skipEyeCheckCount > 0) &&
    !(match[1] === "mint_video" && role.value === "reenact")
  ) {
    return null;
  }
  const effectiveQuality = fastCount > 0 ? "draft" : quality.value;
  if (
    match[1] === "mint_video" &&
    effectiveQuality === "draft" &&
    !["insert", "keyframe"].includes(role.value ?? "")
  ) {
    return null;
  }
  let plannedSeconds;
  let routedResolution;
  if (match[1] === "mint_video" && (role.value === "insert" || role.value === "keyframe")) {
    const raw =
      duration.value === void 0 ? (role.value === "insert" ? 4 : 5) : Number(duration.value);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    plannedSeconds =
      role.value === "insert" ? Math.max(4, Math.min(Math.round(raw), 15)) : Math.round(raw);
    if (plannedSeconds <= 0) return null;
    routedResolution =
      role.value === "insert"
        ? effectiveQuality === "draft"
          ? "720p"
          : (resolution.value ?? "720p")
        : effectiveQuality === "draft"
          ? "720p"
          : (resolution.value ?? "720p");
  }
  if (match[1] === "mint_video" && role.value === "multishot") {
    if ((multishotFile.value === void 0) === (multishot.value === void 0)) {
      return null;
    }
  }
  if (genjutsu) {
    routedResolution = resolution.value ?? "720p";
  }
  const absent = { ok: true };
  const mediaFlags = billedMediaFlags(match[1], role.value);
  const media = mediaFlags.length ? readUniqueFlag(args, mediaFlags) : absent;
  const batch = readUniqueFlag(args, ["--batch"]);
  if (!batch.ok) return null;
  const usingBatch = batch.value !== void 0;
  if (!usingBatch && !media.ok) return null;
  const effective = usingBatch ? batch : media;
  if (effective.value !== void 0 && /^[a-z][a-z0-9+.-]*:\/\//i.test(effective.value)) {
    return null;
  }
  if (effective.value !== void 0) {
    const tok =
      effective.valueArgIndex === void 0
        ? void 0
        : parsed.tokens[targetIndex + 1 + effective.valueArgIndex];
    if (tildeArgIsAmbiguous(tok, effective.equalsForm ?? false, effective.value)) {
      return null;
    }
  }
  const billed = usingBatch
    ? { batch: batch.value }
    : effective.value
      ? { media: effective.value }
      : {};
  const swap = match[1] === "mint_video" ? readUniqueFlag(args, ["--swap-image"]) : absent;
  const promptFlag = match[1] === "mint_video" ? readUniqueFlag(args, ["--prompt"]) : absent;
  const sharedSwap =
    match[1] === "mint_video" && role.value === "reenact" && swap.ok && swap.value !== void 0
      ? { sharedSwap: swap.value }
      : {};
  const sharedPrompt =
    usingBatch && promptFlag.ok && promptFlag.value !== void 0 ? { hasSharedPrompt: true } : {};
  let references = {};
  if (genjutsu) {
    const refs = [];
    for (let i = 0; i < args.length; i++) {
      const token = args[i];
      if (token === "--reference") {
        const next = args[i + 1];
        if (next === void 0 || next.startsWith("-")) return null;
        if (tildeArgIsAmbiguous(parsed.tokens[targetIndex + 2 + i], false, next)) {
          return null;
        }
        refs.push(next);
        i++;
      } else if (token.startsWith("--reference=")) {
        const value = token.slice("--reference=".length);
        if (!value || value.startsWith("~")) return null;
        refs.push(value);
      }
    }
    if (refs.length > 8 || (!usingBatch && refs.length === 0)) return null;
    if (refs.length > 0) references = { references: refs };
  }
  if (match[1] === "build_character_sheet") {
    if (count.value !== void 0) return null;
    return {
      tool: match[1],
      count: 3,
      ...(role.value === void 0 ? {} : { role: role.value }),
    };
  }
  if (match[1] === "compose_render") {
    return {
      tool: match[1],
      count: 1,
      ...(role.value === void 0 ? {} : { role: role.value }),
    };
  }
  if (match[1] === "synth_voice") {
    const script = readUniqueFlag(args, ["--script"]);
    const chunk = readUniqueFlag(args, ["--chunk"]);
    if (!script.ok || !chunk.ok) return null;
    if (script.value !== void 0 && chunk.value === void 0) {
      return { tool: match[1], count: parsedCount, role: "script" };
    }
  }
  if (match[1] === "perform_avatar") {
    const chunk = readUniqueFlag(args, ["--chunk"]);
    if (!chunk.ok) return null;
    if (chunk.value === void 0) {
      return { tool: match[1], count: parsedCount, role: "script" };
    }
    return { tool: match[1], count: parsedCount };
  }
  if (match[1] === "gemini_video") {
    const chunk = readUniqueFlag(args, ["--chunk"]);
    if (!chunk.ok) return null;
    if (chunk.value === "all") {
      return { tool: match[1], count: parsedCount, role: "chunk_review_all" };
    }
  }
  if ((match[1] === "pull_video" || match[1] === "acquire_footage") && args.includes("--bed")) {
    return {
      tool: match[1],
      count: parsedCount,
      role: "bed",
    };
  }
  if (match[1] === "breakdown_reference") {
    const visionModeIndex = args.indexOf("--vision-mode");
    const job = readUniqueFlag(args, ["--job"]);
    const video = readUniqueFlag(args, ["--video"]);
    if (
      visionModeIndex === -1 ||
      args[visionModeIndex + 1] !== "timeline" ||
      args.some((arg) => arg.startsWith("--vision-mode=")) ||
      args.filter((arg) => arg === "--transcribe").length !== 1 ||
      !job.ok ||
      job.value === void 0 ||
      !video.ok ||
      video.value === void 0
    ) {
      return null;
    }
    return {
      tool: match[1],
      count: parsedCount,
      role: "timeline",
      job: job.value,
      video: video.value,
    };
  }
  return {
    tool: match[1],
    count: parsedCount,
    ...(role.value === void 0 ? {} : { role: role.value }),
    ...(model.value === void 0
      ? {}
      : {
          model: model.value,
        }),
    ...(plannedSeconds === void 0 ? {} : { plannedSeconds }),
    ...(effectiveQuality === void 0 ? {} : { quality: effectiveQuality }),
    ...(routedResolution === void 0 ? {} : { resolution: routedResolution }),
    ...(multishotFile.value === void 0 ? {} : { multishotFile: multishotFile.value }),
    ...(multishot.value === void 0 ? {} : { multishot: multishot.value }),
    ...(eyeCheckMethod.value === void 0 ? {} : { eyeCheckMethod: eyeCheckMethod.value }),
    ...(skipEyeCheckCount === 0 ? {} : { skipEyeCheck: true }),
    ...billed,
    ...sharedSwap,
    ...sharedPrompt,
    ...references,
  };
}
const ENGINE_REF_RE_SRC = [
  '"\\$VIDEOCLAW_ENGINE"',
  "'\\$VIDEOCLAW_ENGINE'",
  "\\$VIDEOCLAW_ENGINE",
  '"\\$\\{VIDEOCLAW_ENGINE\\}"',
  "'\\$\\{VIDEOCLAW_ENGINE\\}'",
  "\\$\\{VIDEOCLAW_ENGINE\\}",
  '"\\$\\{VIDEOCLAW_ENGINE:-[^}"\'`\\\\]*\\}"',
  "'\\$\\{VIDEOCLAW_ENGINE:-[^}\"'`\\\\]*\\}'",
  "\\$\\{VIDEOCLAW_ENGINE:-[^}\\s\"'`\\\\]*\\}",
].join("|");
const CD_ENGINE_PREFIX_RE = new RegExp(`^\\s*cd\\s+(?:${ENGINE_REF_RE_SRC})\\s+&&\\s+([^]+)$`);
const UV_DIRECTORY_ENGINE_RE = new RegExp(
  `^(\\s*uv\\s+run\\s+)--directory(?:=|\\s+)(?:${ENGINE_REF_RE_SRC})\\s+([^]+)$`,
);
const OUTPUT_FILTER_HEADS = /* @__PURE__ */ new Set([
  "tail",
  "head",
  "grep",
  "egrep",
  "fgrep",
  "wc",
  "cat",
  "uniq",
  "cut",
  "tr",
  "jq",
]);
function splitPipelineOnly(command) {
  const segments = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"' && i + 1 < command.length) {
        cur += command[++i];
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      cur += c + command[++i];
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (segments.length > 0 && cur.trim().length === 0) {
        cur += " ";
        continue;
      }
      return null;
    }
    if (c === ";") return null;
    if (c === "&") {
      if (command[i - 1] !== ">") return null;
      cur += c;
      continue;
    }
    if (c === "|") {
      if (command[i + 1] === "|") return null;
      segments.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  segments.push(cur);
  const trimmed = segments.map((s) => s.trim());
  return trimmed.every((s) => s.length > 0) ? trimmed : null;
}
function stripTrailingOutputRedirects(segment) {
  let s = segment;
  for (;;) {
    const next = s.replace(/\s+(?:2>&1|2>\/dev\/null|>\/dev\/null)\s*$/, "");
    if (next === s) return s.trim();
    s = next;
  }
}
function isPureOutputFilter(segment) {
  const parsed = tokenizeShell(segment);
  if (parsed.opaque || parsed.unclosedQuote || parsed.tokens.length === 0) {
    return false;
  }
  const head = parsed.tokens[0];
  if (head.quoted || head.escaped) return false;
  if (head.value.includes("/")) return false;
  return OUTPUT_FILTER_HEADS.has(head.value);
}
function paidCommandUsesOutputPipeline(command) {
  const cd = CD_ENGINE_PREFIX_RE.exec(command);
  const pipeline2 = splitPipelineOnly(cd ? cd[1] : command);
  return pipeline2 !== null && pipeline2.length > 1 && pipeline2.slice(1).every(isPureOutputFilter);
}
function withOutputPipefail(command) {
  return paidCommandUsesOutputPipeline(command)
    ? `set -o pipefail
${command}`
    : command;
}
const UV_PROJECT_ENGINE_RE = new RegExp(
  `^(\\s*uv\\s+run\\s+)--project(?:=|\\s+)(?:${ENGINE_REF_RE_SRC})\\s+([^]+)$`,
);
const ENGINE_REF_IN_TOKEN_RE = new RegExp(
  `\\$(?:\\{VIDEOCLAW_ENGINE\\}|VIDEOCLAW_ENGINE)(?=/|"|'|\\s|$)`,
  "g",
);
function normalizeEnginePaidCommand(command, engineDir) {
  let engineCwd = false;
  let body = command;
  const cd = CD_ENGINE_PREFIX_RE.exec(body);
  if (cd) {
    engineCwd = true;
    body = cd[1];
  }
  const segments = splitPipelineOnly(body);
  if (!segments) return null;
  let paidSegment = stripTrailingOutputRedirects(segments[0]);
  const uv = UV_DIRECTORY_ENGINE_RE.exec(paidSegment);
  if (uv) {
    engineCwd = true;
    paidSegment = `${uv[1]}${uv[2]}`.trim();
  }
  const uvProject = UV_PROJECT_ENGINE_RE.exec(paidSegment);
  if (uvProject) {
    if (!engineDir) return null;
    paidSegment = `${uvProject[1]}${uvProject[2]}`.trim();
  }
  if (ENGINE_REF_IN_TOKEN_RE.test(paidSegment)) {
    if (!engineDir) return null;
    paidSegment = paidSegment.replace(ENGINE_REF_IN_TOKEN_RE, engineDir);
  }
  for (const filter of segments.slice(1)) {
    if (!isPureOutputFilter(filter)) return null;
  }
  if (
    paidSegment === "" ||
    splitSegments(paidSegment).length !== 1 ||
    tokenizeShell(paidSegment).opaque
  ) {
    return null;
  }
  return { command: paidSegment, engineCwd };
}
const BANNED_USER_FACING_VOCABULARY = [
  "workflow",
  "molecule",
  "taste pack",
  "tenant",
  "job",
  "pipeline",
  "reading set",
];
const VOICE_GUARD = `
## Videoclaw app voice (overrides conversational habits, not operating rules)
You are the engine inside the Videoclaw desktop app; the user is a video
creator, not a developer. In everything you SAY to the user:
- NEVER name other clients, tenants, brands, or their projects (e.g. names
  found in internal preferences, commitments, or prior work). If a prior
  example is relevant, apply the technique without narrating its origin.
- NEVER reveal or echo API keys, tokens, .env contents, credential paths,
  vendor/backend service names, model routing, or infrastructure details.
  Refer to capabilities by what they do ("generate a clip", "sync the voice").
- Keep progress narration in terms of the video being made (beats, footage,
  captions, renders), not internal tooling.
- The user never sees your thinking. Before you start a paid or long-running
  step (generating, rendering), write one short visible sentence to the user
  saying what you are starting. Never leave that narration only in your
  thinking, and never add a time or price to it.
- When a paid step runs on a generation model you chose yourself (call_model),
  name that model in plain words from its search_models title, version
  included, in the sentence that starts the step ("Animating both shots with
  Kling 2.5 Turbo Pro."), so the user knows what made the result and can ask
  for it again. Name only the model: never the service that hosts or routes
  it, its model id or route string, even when the title is one. Never name
  any other model, including the intelligence behind your own replies; a step
  on the studio's default model has no name to give, so don't guess one. It
  is always just "the engine" or "the studio" otherwise.
- NEVER narrate internal routing or documentation to the user: no mention
  of workflows, recipes, disambiguators, laws, specs, chunks, skills files,
  or reading sets. Those are your working notes, not the product. State the
  creative intent directly and keep the internal method silent.
- Literal backstage vocabulary that must never be user-facing:
  ${BANNED_USER_FACING_VOCABULARY.join(" · ")}.
- NO pipeline jargon when talking to the user: never mux/demux, transcode,
  codec, EDL, stems, chroma, alpha, or internal beat/window ids like "w1" or
  "b4". Say what is happening to THEIR video in producer language: "laying
  your voice over the footage", "combining picture and sound", "the second
  beat". If a phrase would only make sense to a software engineer, translate
  it before it leaves your mouth.
When you produce a watchable asset, always give its path as a markdown link.

## Money you may not invent (app#840)
The app owns every price. It shows the maximum on the approval card before a
paid step and the running total in the spend strip, and \`get_project_budget\`
returns the same figures.
- NEVER state, estimate, guess, or round a dollar amount for the work you are
  doing. Not "about $0.15", not "a few cents", not "roughly a dollar". If the
  app has not given you the number, you do not have it, and the strip on screen
  will contradict you.
- When cost comes up, point at the card or the strip, or read the current
  figures back from \`get_project_budget\` — never a number of your own.
- Footage is acquired ONLY through the app's own pull step. If that step
  refuses, say once what could not be fetched and ask for a different link or an
  uploaded file. Never fetch media another way — no direct vendor endpoint, no
  scraping service, no alternate downloader — and never describe a substitute
  route as cheap, free, or costing some amount.

## Studio tools (ask the user for real inputs — prefer these over synthesis)
- Need the user's real voice for a VO? Call mcp__studio__request_voiceover with
  \`script\` = only the words to read aloud (the plan's script when there is
  one), any delivery note in \`direction\`, and the destination directory
  (usually jobs/<id>/real). Real voice beats synthetic 100×; ask early. The
  user keeps one take, saved as 48 kHz lossless WAV, and the engine consumes the
  returned job-relative path directly.
- Need footage, images, or documents from the user? Call
  mcp__studio__request_files with what you need and where it should land.
- Before cloning or closely imitating a real person's voice or likeness, call
  mcp__studio__request_rights_confirmation. Do not begin the clone or spend on
  it until the user checks the rights statement. Preserve the returned
  rights_confirmation receipt in the synth_voice reference_tts command.
  The one exception is an approved saved voice that mcp__studio__character_voice
  get returned for this use: the user already confirmed its rights when saving
  it, so pass that receipt unchanged and do not ask again.
These tools block until the user responds in the app; a decline comes back as
text — respect it and adapt.`;
const CLAUDE_CODE_INTERNAL_PLAN_TOOLS = ["EnterPlanMode", "ExitPlanMode"];
const internalPlanTools = new Set(CLAUDE_CODE_INTERNAL_PLAN_TOOLS);
const CLAUDE_COMPACTION_PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context.";
const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";
function syntheticProviderError(envelope) {
  const error = envelope["error"];
  const flagged =
    envelope["is_api_error_message"] === true || envelope["isApiErrorMessage"] === true;
  if (!flagged && typeof error !== "string") return void 0;
  const status = envelope["api_error_status"] ?? envelope["apiErrorStatus"];
  return {
    ...(typeof error === "string" && error ? { error } : {}),
    ...(typeof status === "number" ? { apiErrorStatus: status } : {}),
  };
}
function isClaudeTermsSyntheticRow(envelope) {
  return isClaudeTermsNotice(syntheticApiErrorText(envelope) ?? "");
}
const APP_SPEND_REFUSAL_TEXT = /^\s*API Error:\s*402\s+(\{[\s\S]*\})\s*$/;
const APP_SPEND_REFUSAL_CODES = /* @__PURE__ */ new Set([
  SPEND_APPROVAL_PENDING_CODE,
  SPEND_AUTHORITY_REQUIRED_CODE,
]);
function isAppSpendRefusalRow(envelope) {
  const failure = syntheticProviderError(envelope);
  if (failure?.apiErrorStatus !== void 0 && failure.apiErrorStatus !== 402) return false;
  const body = APP_SPEND_REFUSAL_TEXT.exec(syntheticApiErrorText(envelope) ?? "")?.[1];
  if (!body) return false;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed.detail === "string" && APP_SPEND_REFUSAL_CODES.has(parsed.code);
  } catch {
    return false;
  }
}
const GATEWAY_PREPAID_CREDIT_REFUSAL = "not enough prepaid credit; top up to continue";
function videoclawCreditRefusal(envelope) {
  const failure = syntheticProviderError(envelope);
  if (failure?.apiErrorStatus !== void 0 && failure.apiErrorStatus !== 402) return void 0;
  const body = APP_SPEND_REFUSAL_TEXT.exec(syntheticApiErrorText(envelope) ?? "")?.[1];
  if (!body) return void 0;
  try {
    const { detail } = JSON.parse(body);
    const message =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object"
          ? detail.message
          : void 0;
    if (message !== GATEWAY_PREPAID_CREDIT_REFUSAL) return void 0;
    return { notSubmitted: typeof detail === "object" && detail.not_submitted === true };
  } catch {
    return void 0;
  }
}
function syntheticApiErrorText(envelope) {
  if (envelope["type"] !== "assistant" || !syntheticProviderError(envelope)) return void 0;
  const sdkMessage = envelope["message"];
  if (!sdkMessage || typeof sdkMessage !== "object") return void 0;
  const { model, content } = sdkMessage;
  if (model !== CLAUDE_SYNTHETIC_MODEL || !Array.isArray(content)) return void 0;
  return content
    .map((block) =>
      block && typeof block === "object" && block.type === "text" ? String(block.text ?? "") : "",
    )
    .join(" ");
}
function isSyntheticProviderRow(envelope) {
  if (envelope["type"] !== "assistant") return false;
  if (syntheticProviderError(envelope)) return false;
  const sdkMessage = envelope["message"];
  if (!sdkMessage || typeof sdkMessage !== "object") return false;
  return sdkMessage["model"] === CLAUDE_SYNTHETIC_MODEL;
}
function isClaudeCodeInternalPlanTool(toolName) {
  return internalPlanTools.has(toolName);
}
const CLAUDE_CODE_PLAN_MODE_REDIRECT =
  "Special plan mode is not available in this studio. You may reason about or describe your approach in ordinary conversation, then continue the current request without asking for plan approval. Tool permissions and paid-operation approval are enforced separately by the app.";
function claudeCodePlanModeDenial(toolName) {
  if (!isClaudeCodeInternalPlanTool(toolName)) return void 0;
  return {
    behavior: "deny",
    message: CLAUDE_CODE_PLAN_MODE_REDIRECT,
  };
}
const CLAUDE_CODE_SELF_STARTING_TOOLS = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "Workflow",
  "SendMessage",
  "ListAgents",
  "PushNotification",
];
function withClaudeCodeInternalToolsDisabled(disallowedTools = []) {
  return [.../* @__PURE__ */ new Set([...disallowedTools, ...CLAUDE_CODE_INTERNAL_PLAN_TOOLS])];
}
class ClaudeCodeMessageAdapter {
  internalToolUseIds = /* @__PURE__ */ new Set();
  afterCompactBoundary = false;
  atTranscriptStart = true;
  filteredFlattenedCompaction = false;
  get filteredFlattenedCompactionSummary() {
    return this.filteredFlattenedCompaction;
  }
  adapt(message) {
    if (!message || typeof message !== "object") return message;
    const envelope = message;
    if (envelope["type"] === "system") {
      this.afterCompactBoundary =
        envelope["subtype"] === "compact_boundary" ||
        (this.atTranscriptStart && !envelope["message"]);
      this.atTranscriptStart = false;
      return message;
    }
    this.atTranscriptStart = false;
    if (
      envelope["isCompactSummary"] === true ||
      (envelope["type"] === "user" && envelope["isVisibleInTranscriptOnly"] === true)
    ) {
      if (envelope["isCompactSummary"] === true) this.filteredFlattenedCompaction = true;
      this.afterCompactBoundary = false;
      return void 0;
    }
    if (isSyntheticProviderRow(envelope) || isAppSpendRefusalRow(envelope)) return void 0;
    const sdkMessage = envelope["message"];
    if (!sdkMessage || typeof sdkMessage !== "object") {
      this.afterCompactBoundary = false;
      return message;
    }
    const content = sdkMessage["content"];
    if (envelope["type"] === "user") {
      const isFlattenedCompactionSummary =
        this.afterCompactBoundary &&
        typeof content === "string" &&
        content.startsWith(CLAUDE_COMPACTION_PREAMBLE);
      this.afterCompactBoundary = false;
      if (isFlattenedCompactionSummary) {
        this.filteredFlattenedCompaction = true;
        return void 0;
      }
    } else {
      this.afterCompactBoundary = false;
    }
    if (!Array.isArray(content)) return message;
    if (envelope["type"] === "assistant") {
      if (
        envelope["error"] &&
        sdkMessage["model"] === "<synthetic>" &&
        content.some((block) => block?.type === "text" && classifyError(block.text) === "network")
      )
        return void 0;
      const filtered = content.filter((block) => {
        if (!block || typeof block !== "object") return true;
        const value = block;
        if (
          value["type"] !== "tool_use" ||
          typeof value["name"] !== "string" ||
          !isClaudeCodeInternalPlanTool(value["name"])
        ) {
          return true;
        }
        if (typeof value["id"] === "string") {
          this.internalToolUseIds.add(value["id"]);
        }
        return false;
      });
      if (filtered.length === content.length) return message;
      if (filtered.length === 0) return void 0;
      return {
        ...envelope,
        message: {
          ...sdkMessage,
          content: filtered,
        },
      };
    }
    if (envelope["type"] === "user") {
      const filtered = content.filter((block) => {
        if (!block || typeof block !== "object") return true;
        const value = block;
        if (
          value["type"] !== "tool_result" ||
          typeof value["tool_use_id"] !== "string" ||
          !this.internalToolUseIds.has(value["tool_use_id"])
        ) {
          return true;
        }
        this.internalToolUseIds.delete(value["tool_use_id"]);
        return false;
      });
      if (filtered.length === content.length) return message;
      if (filtered.length === 0) return void 0;
      return {
        ...envelope,
        message: {
          ...sdkMessage,
          content: filtered,
        },
      };
    }
    return message;
  }
}
const ARCHIVE_LIMITS = {
  maxEntries: ARCHIVE_MAX_ENTRIES,
  maxFiles: ARCHIVE_MAX_FILES,
  maxDepth: ARCHIVE_MAX_DEPTH,
  maxFileBytes: ARCHIVE_MAX_FILE_BYTES,
  maxTotalBytes: ARCHIVE_MAX_TOTAL_BYTES,
  maxRatio: ARCHIVE_MAX_RATIO,
  ratioFloorBytes: ARCHIVE_RATIO_FLOOR_BYTES,
};
const FREE_SPACE_RESERVE_BYTES = 1024 ** 3;
const MAX_ENTRY_NAME_BYTES = 1024;
const MAX_SEGMENT_BYTES = 255;
const S_IFMT = 61440;
const S_IFREG = 32768;
const S_IFDIR = 16384;
const S_IFLNK = 40960;
const NESTED_ARCHIVE_EXTS = /* @__PURE__ */ new Set([
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".zst",
  ".lz",
  ".lzma",
  ".cab",
  ".jar",
  ".war",
  ".apk",
  ".ipa",
  ".dmg",
  ".iso",
  ".pkg",
]);
class Rejection extends Error {
  constructor(cause) {
    super(cause);
    this.cause = cause;
  }
}
function yauzlCause(error) {
  if (error instanceof Rejection) return error.cause;
  const message = error instanceof Error ? error.message : "";
  if (/^(absolute path|invalid relative path|invalid characters in fileName)/.test(message))
    return "unsafe-path";
  if (/encrypt/i.test(message)) return "encrypted";
  if (/unsupported compression method/.test(message)) return "unsupported-compression";
  return "corrupt";
}
function extOf(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}
function entryFileType(entry) {
  return (entry.externalFileAttributes >>> 16) & S_IFMT;
}
async function planEntries(zip, limits, keep, skipHidden = true) {
  if (zip.entryCount > limits.maxEntries) throw new Rejection("too-crowded");
  const kept = [];
  const skipped = [];
  const files = /* @__PURE__ */ new Set();
  const dirs = /* @__PURE__ */ new Set();
  const spans = [];
  let declaredBytes = 0;
  let seen = 0;
  for await (const entry of zip.eachEntry()) {
    seen += 1;
    if (seen > limits.maxEntries) throw new Rejection("too-crowded");
    const raw = entry.fileName;
    if (
      Buffer.byteLength(raw) > MAX_ENTRY_NAME_BYTES ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(raw)
    ) {
      throw new Rejection("unsafe-path");
    }
    const type = entryFileType(entry);
    if (type === S_IFLNK) throw new Rejection("link");
    const isDir = raw.endsWith("/") || type === S_IFDIR;
    if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) throw new Rejection("special-file");
    if (isDir !== raw.endsWith("/")) throw new Rejection("special-file");
    const path = isDir ? raw.slice(0, -1) : raw;
    const segments = path.split("/");
    if (
      segments.some(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          Buffer.byteLength(segment) > MAX_SEGMENT_BYTES,
      )
    ) {
      throw new Rejection("unsafe-path");
    }
    if (entry.isEncrypted()) throw new Rejection("encrypted");
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new Rejection("unsupported-compression");
    }
    if (
      entry.uncompressedSize >= limits.ratioFloorBytes &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > limits.maxRatio)
    )
      throw new Rejection("bomb");
    spans.push({
      start: entry.relativeOffsetOfLocalHeader,
      end: entry.relativeOffsetOfLocalHeader + 30 + entry.fileNameLength + entry.compressedSize,
    });
    const key = path.normalize("NFC").toLowerCase();
    if (files.has(key) || dirs.has(key)) {
      if (!(isDir && dirs.has(key))) throw new Rejection("duplicate-path");
    }
    const parents = segments.slice(0, -1);
    for (let i = 1; i <= parents.length; i++) {
      const parent = key.split("/").slice(0, i).join("/");
      if (files.has(parent)) throw new Rejection("duplicate-path");
      dirs.add(parent);
    }
    if (isDir) {
      if (segments.length >= limits.maxDepth) throw new Rejection("too-deep");
      dirs.add(key);
      continue;
    }
    if (segments.length > limits.maxDepth) throw new Rejection("too-deep");
    files.add(key);
    if (
      skipHidden &&
      (segments[0] === "__MACOSX" || segments.some((segment) => segment.startsWith(".")))
    )
      continue;
    const name = segments[segments.length - 1];
    const reason = keep(name);
    if (reason) {
      skipped.push({ path, reason });
      continue;
    }
    if (kept.length >= limits.maxFiles) throw new Rejection("too-many");
    if (entry.uncompressedSize > limits.maxFileBytes) throw new Rejection("file-too-large");
    declaredBytes += entry.uncompressedSize;
    if (declaredBytes > limits.maxTotalBytes) throw new Rejection("too-large");
    kept.push({ entry, path, name });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i - 1].end > spans[i].start) throw new Rejection("bomb");
  }
  kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { kept, skipped, declaredBytes };
}
class EntryMeter extends Transform {
  constructor(max, onBytes) {
    super();
    this.max = max;
    this.onBytes = onBytes;
  }
  bytes = 0;
  crc = 0;
  digest = createHash("sha256");
  _transform(chunk, _encoding, done) {
    this.bytes += chunk.length;
    if (this.bytes > this.max) {
      done(new Rejection("corrupt"));
      return;
    }
    try {
      this.onBytes(chunk.length);
    } catch (error) {
      done(error);
      return;
    }
    this.crc = crc32(chunk, this.crc);
    this.digest.update(chunk);
    done(null, chunk);
  }
  sha256() {
    return this.digest.digest("hex");
  }
}
function openZip(path) {
  return yauzl.openPromise(path, {
    lazyEntries: true,
    autoClose: false,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });
}
function defaultKeep(name) {
  if (NESTED_ARCHIVE_EXTS.has(extOf(name)) || assetKind(name) === "archive")
    return "nested-archive";
  return isAcceptedAsset(name) ? null : "unsupported";
}
async function extractArchive(
  zipPath,
  outDir,
  limits = ARCHIVE_LIMITS,
  freeBytes = (dir) => {
    const stat = statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  },
) {
  let zip;
  rmSync(outDir, { recursive: true, force: true });
  try {
    zip = await openZip(zipPath);
    const { kept, skipped, declaredBytes } = await planEntries(zip, limits, defaultKeep);
    if (kept.length === 0) throw new Rejection("empty");
    mkdirSync(outDir, { recursive: true, mode: 448 });
    if (freeBytes(outDir) < declaredBytes + FREE_SPACE_RESERVE_BYTES)
      throw new Rejection("no-space");
    let total = 0;
    const files = [];
    for (const [index, planned] of kept.entries()) {
      const tempPath = join(outDir, String(index));
      const meter = new EntryMeter(
        Math.min(planned.entry.uncompressedSize, limits.maxFileBytes),
        (n) => {
          total += n;
          if (total > limits.maxTotalBytes) throw new Rejection("too-large");
        },
      );
      const stream = await zip.openReadStreamPromise(planned.entry);
      await pipeline(stream, meter, createWriteStream(tempPath, { flags: "wx", mode: 384 }));
      if (
        meter.bytes !== planned.entry.uncompressedSize ||
        meter.crc >>> 0 !== planned.entry.crc32 >>> 0
      ) {
        throw new Rejection("corrupt");
      }
      files.push({
        path: planned.path,
        name: planned.name,
        sizeBytes: meter.bytes,
        sha256: meter.sha256(),
        tempPath,
      });
    }
    return { kind: "extracted", files, skipped };
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    return { kind: "rejected", cause: yauzlCause(error) };
  } finally {
    zip?.close();
  }
}
async function inspectZipContainer(bytes, limits) {
  let zip;
  try {
    zip = await yauzl.fromBufferPromise(bytes, {
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    const { kept } = await planEntries(
      zip,
      {
        maxEntries: limits.maxEntries,
        maxFiles: limits.maxEntries,
        maxDepth: 16,
        maxFileBytes: limits.maxTotalBytes,
        maxTotalBytes: limits.maxTotalBytes,
        maxRatio: limits.maxRatio,
        ratioFloorBytes: limits.ratioFloorBytes,
      },
      () => null,
      false,
    );
    const parts = /* @__PURE__ */ new Map();
    let total = 0;
    for (const planned of kept) {
      const chunks = [];
      const meter = new EntryMeter(planned.entry.uncompressedSize, (n) => {
        total += n;
        if (total > limits.maxTotalBytes) throw new Rejection("too-large");
      });
      const stream = await zip.openReadStreamPromise(planned.entry);
      await pipeline(stream, meter, async (source) => {
        for await (const chunk of source) chunks.push(chunk);
      });
      if (
        meter.bytes !== planned.entry.uncompressedSize ||
        meter.crc >>> 0 !== planned.entry.crc32 >>> 0
      ) {
        throw new Rejection("corrupt");
      }
      parts.set(planned.path, Buffer.concat(chunks));
    }
    return { kind: "ok", parts };
  } catch (error) {
    return { kind: "rejected", cause: yauzlCause(error) };
  } finally {
    zip?.close();
  }
}
function storedZip(parts) {
  const out = [];
  const directory = [];
  let offset = 0;
  for (const [path, data] of parts) {
    const name = Buffer.from(path, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(2048, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(33639248, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(2048, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    out.push(local, name, data);
    directory.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(parts.size, 8);
  end.writeUInt16LE(parts.size, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, cd, end]);
}
const WORKBOOK_SCHEMA = "videoclaw.workbook/v1";
const WORKBOOK_PAGE_MAX_CHARS = 6e4;
const WORKBOOK_PAGE_CELL_CHARS = 4e3;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CELL_TYPES = /* @__PURE__ */ new Set(["string", "number", "boolean", "date", "error"]);
function isWorkbookContents(value, sha256) {
  const book = value;
  if (
    !book ||
    book.schema !== WORKBOOK_SCHEMA ||
    book.sourceSha256 !== sha256 ||
    !SHA256_RE.test(sha256) ||
    !["xlsx", "xls", "ods"].includes(book.format) ||
    !Array.isArray(book.sheets) ||
    book.sheets.length > WORKBOOK_MAX_SHEETS ||
    !Number.isSafeInteger(book.cellCount)
  )
    return false;
  let cells = 0;
  for (const sheet of book.sheets) {
    if (
      typeof sheet?.name !== "string" ||
      typeof sheet.hidden !== "boolean" ||
      (sheet.range !== null && typeof sheet.range !== "string") ||
      !Array.isArray(sheet.cells) ||
      sheet.cellCount !== sheet.cells.length
    )
      return false;
    for (const cell of sheet.cells) {
      if (
        typeof cell?.ref !== "string" ||
        !Number.isSafeInteger(cell.row) ||
        !Number.isSafeInteger(cell.col) ||
        !CELL_TYPES.has(cell.type) ||
        !["string", "number", "boolean"].includes(typeof cell.value) ||
        (typeof cell.value === "string" && cell.value.length > WORKBOOK_MAX_CELL_CHARS) ||
        (cell.text !== void 0 && typeof cell.text !== "string") ||
        (cell.formula !== void 0 && typeof cell.formula !== "string")
      )
        return false;
    }
    cells += sheet.cells.length;
  }
  return cells === book.cellCount;
}
function columnIndex(letters) {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}
function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}
function parseRange(range) {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/.exec(
    range.trim().toUpperCase(),
  );
  if (!match) return null;
  const a = { c: columnIndex(match[1]), r: Number(match[2]) - 1 };
  const b = match[3] ? { c: columnIndex(match[3]), r: Number(match[4]) - 1 } : a;
  if (a.r < 0 || b.r < 0) return null;
  return {
    r0: Math.min(a.r, b.r),
    r1: Math.max(a.r, b.r),
    c0: Math.min(a.c, b.c),
    c1: Math.max(a.c, b.c),
  };
}
function workbookPage(book, args) {
  const overview = book.sheets.map((sheet2, index) => ({
    index,
    name: sheet2.name,
    range: sheet2.range,
    filled_cells: sheet2.cellCount,
    ...(sheet2.hidden ? { hidden: true } : {}),
  }));
  if (args.sheet === void 0) {
    return {
      ok: true,
      format: book.format,
      source_sha256: book.sourceSha256,
      filled_cells: book.cellCount,
      sheets: overview,
      note: 'Values are the cached results the file stored; formulas are shown as text and were never evaluated. Pass sheet (and optionally range like "A1:D20") to read cells.',
    };
  }
  const sheet =
    book.sheets.find((candidate) => candidate.name === args.sheet) ??
    (/^\d+$/.test(args.sheet) ? book.sheets[Number(args.sheet)] : void 0);
  if (!sheet) return { ok: false, reason: `No sheet named "${args.sheet}".`, sheets: overview };
  if (args.cell !== void 0) {
    const bounds = parseRange(args.cell);
    const target =
      bounds && bounds.r0 === bounds.r1 && bounds.c0 === bounds.c1
        ? sheet.cells.find((cell) => cell.row === bounds.r0 && cell.col === bounds.c0)
        : void 0;
    if (!bounds || bounds.r0 !== bounds.r1 || bounds.c0 !== bounds.c1)
      return { ok: false, reason: `"${args.cell}" is not a single cell like "B2".` };
    if (!target) return { ok: false, reason: `${args.cell} is empty on "${sheet.name}".` };
    const from = Math.max(0, Math.trunc(args.charOffset ?? 0));
    const fields = { value: target.value, text: target.text, formula: target.formula };
    const longest = Math.max(
      ...Object.values(fields).map((field) => (typeof field === "string" ? field.length : 0)),
    );
    const next2 = from + WORKBOOK_PAGE_CELL_CHARS;
    return {
      ok: true,
      sheet: sheet.name,
      source_sha256: book.sourceSha256,
      ref: target.ref,
      type: target.type,
      char_offset: from,
      ...Object.fromEntries(
        Object.entries(fields)
          .filter(([, field]) => field !== void 0)
          .map(([key, field]) => [
            key,
            typeof field === "string" ? field.slice(from, next2) : field,
          ]),
      ),
      full_length: longest,
      ...(next2 < longest ? { next_char_offset: next2 } : {}),
    };
  }
  let cells = sheet.cells;
  if (args.range !== void 0) {
    const bounds = parseRange(args.range);
    if (!bounds) return { ok: false, reason: `"${args.range}" is not a cell range like "A1:D20".` };
    cells = cells.filter(
      (cell) =>
        cell.row >= bounds.r0 &&
        cell.row <= bounds.r1 &&
        cell.col >= bounds.c0 &&
        cell.col <= bounds.c1,
    );
  }
  const limit = Math.min(
    Math.max(1, Math.trunc(args.limit ?? WORKBOOK_PAGE_MAX_CELLS)),
    WORKBOOK_PAGE_MAX_CELLS,
  );
  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const clip = (text) =>
    text.length > WORKBOOK_PAGE_CELL_CHARS ? text.slice(0, WORKBOOK_PAGE_CELL_CHARS) : text;
  const page = [];
  let chars = 0;
  for (const { ref, type, value, text, formula } of cells.slice(offset, offset + limit)) {
    const truncated = [value, text, formula].some(
      (field) => typeof field === "string" && field.length > WORKBOOK_PAGE_CELL_CHARS,
    );
    const out = {
      ref,
      type,
      value: typeof value === "string" ? clip(value) : value,
      ...(text !== void 0 ? { text: clip(text) } : {}),
      ...(formula !== void 0 ? { formula: clip(formula) } : {}),
      ...(truncated
        ? {
            truncated: true,
            full_length: Math.max(
              ...[value, text, formula].map((f) => (typeof f === "string" ? f.length : 0)),
            ),
          }
        : {}),
    };
    chars += JSON.stringify(out).length + 1;
    if (page.length > 0 && chars > WORKBOOK_PAGE_MAX_CHARS) break;
    page.push(out);
  }
  const next = offset + page.length;
  return {
    ok: true,
    sheet: sheet.name,
    ...(args.range !== void 0 ? { range: args.range } : {}),
    source_sha256: book.sourceSha256,
    total_cells: cells.length,
    offset,
    cells: page,
    ...(next < cells.length ? { next_offset: next } : {}),
  };
}
function workbookSummary(book) {
  const shown = book.sheets
    .slice(0, 12)
    .map((sheet) => `${JSON.stringify(sheet.name.slice(0, 64))} ${sheet.range ?? "(empty)"}`);
  const more =
    book.sheets.length > shown.length ? `, and ${book.sheets.length - shown.length} more` : "";
  const count = book.sheets.length === 1 ? "1 sheet" : `${book.sheets.length} sheets`;
  return `${count} — ${shown.join(", ")}${more}`;
}
const WORKBOOK_READ_TIMEOUT_MS = 2e4;
function readWorkbookInWorker(fork, request, timeoutMs = WORKBOOK_READ_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let worker;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker?.kill();
      } catch {}
      resolve(result);
    };
    const refused = { kind: "rejected", cause: "too-complex" };
    const timer = setTimeout(() => finish(refused), timeoutMs);
    try {
      worker = fork();
      worker.onMessage((message) => {
        const result = message?.type === "result" ? message.result : void 0;
        if (result?.kind === "read" && isWorkbookContents(result.contents, request.sha256))
          finish(result);
        else if (result?.kind === "rejected") finish({ kind: "rejected", cause: result.cause });
        else finish({ kind: "rejected", cause: "corrupt" });
      });
      worker.onExit(() => finish(refused));
      worker.postMessage({ type: "read", ...request });
    } catch {
      finish(refused);
    }
  });
}
export {
  claudeCodePlanModeDenial as $,
  isPdfName as A,
  BANNED_USER_FACING_VOCABULARY as B,
  CLIPBOARD_IMAGE_MAX_PIXELS as C,
  extractArchive as D,
  archiveRejectReason as E,
  ARCHIVE_MAX_PDFS as F,
  ARCHIVE_MAX_WORKBOOKS as G,
  safeProviderText as H,
  INSECURE_STORAGE_COPY as I,
  PROVIDER_READ_ONLY_HEADS as J,
  CURL_FORCE_HEAD_FLAGS as K,
  CURL_HEADS as L,
  MANAGED_DEVELOPMENT as M,
  NESTED_CURL_LAUNCHERS as N,
  executableShellFragments as O,
  PROD_GATEWAY_URL as P,
  resolveProviderInvocation as Q,
  httpieOffline as R,
  acquisitionOriginMatch as S,
  resolveNestedCurlArgs as T,
  UNREADABLE_VAULT_COPY as U,
  VOICE_GUARD as V,
  WORKBOOK_MAX_OUTPUT_BYTES as W,
  splitCurlTransfers as X,
  curlMutatesTransfer as Y,
  httpieIgnoresStdin as Z,
  READER_SHELL_OUT_PATTERNS as _,
  classifyError as a,
  SIGN_IN_UNAVAILABLE_COPY as a$,
  withClaudeCodeInternalToolsDisabled as a0,
  CLAUDE_CODE_SELF_STARTING_TOOLS as a1,
  anthropicClientJobCustomHeaders as a2,
  ClaudeCodeMessageAdapter as a3,
  CODEX_CONTAINMENT as a4,
  resolveCodexContainment as a5,
  withOutputPipefail as a6,
  classifyPaidGen as a7,
  isClientJobId as a8,
  isAnthropicPassthroughPath as a9,
  quotedOperationLine as aA,
  isClaudeTermsNotice as aB,
  CLAUDE_TERMS_REQUIRED as aC,
  CODEX_CHATGPT_AUTH_REJECTED as aD,
  CODEX_API_KEY_REJECTED as aE,
  VIDEOCLAW_CREDIT_EXHAUSTED as aF,
  providerFailureKind as aG,
  syntheticProviderError as aH,
  isClaudeTermsSyntheticRow as aI,
  videoclawCreditRefusal as aJ,
  isConversationTooLargeError as aK,
  friendlyToolLine as aL,
  canonicalClaudeModelId as aM,
  partitionDiscoveredClaudeModels as aN,
  claudeReasoningEffortChoices as aO,
  claudeEffortSupportKnown as aP,
  codexModelUnverifiedDiagnostic as aQ,
  codexPinRefusal as aR,
  codexEffortDiagnostic as aS,
  resolveCodexReasoningEffort as aT,
  partitionDiscoveredCodexModels as aU,
  sanitizeModelLine as aV,
  normalizeEnginePaidCommand as aW,
  budgetSafePaidGen as aX,
  INPUT_BOUND_MINT_VIDEO_ROLES as aY,
  resolveAuthPool as aZ,
  EMAIL_LINK_RESEND_INTERVAL_MS as a_,
  SPEND_APPROVAL_PENDING_CODE as aa,
  SPEND_AUTHORITY_REQUIRED_CODE as ab,
  upstreamUnavailableRefusal as ac,
  providerCapabilityLabel as ad,
  CLIENT_JOB_ID_RE as ae,
  CLAUDE_MODEL_EVIDENCE as af,
  AGENT_ROUTE_EVIDENCE as ag,
  isRecommendedClaudeRoute as ah,
  isQualifiedCodexRoute as ai,
  codexRouteDiagnostic as aj,
  isGenerationLine as ak,
  claudeModelVerdict as al,
  claudeRouteQualification as am,
  claudeRouteDiagnostic as an,
  modelAccountLimit as ao,
  isRuntimeAuthFailure as ap,
  isCodexAuthRejected as aq,
  isCodexChatGptAuthRejected as ar,
  isClaudeTermsRequired as as,
  providerFailureCopy as at,
  claudeTermsRequiredLine as au,
  modelAccountLimitPresentation as av,
  isVideoclawCreditExhausted as aw,
  providerErrorDetail as ax,
  isStaleResumeError as ay,
  normalizeSpendCeilingUsd as az,
  envForGatewayUrl as b,
  EMAIL_LINK_SEND_COPY as b0,
  EMAIL_LINK_WAIT_HINT_MS as b1,
  ACCOUNT_PATH as b2,
  ACCOUNT_DISABLED_COPY as b3,
  accountStateFrom as b4,
  ALPHA_TERMS_VERSION as b5,
  ACCOUNT_CONSENT_PATH as b6,
  ACCOUNT_KEY_PATH as b7,
  ACCOUNT_KEY_ACCESS_PATH as b8,
  ACCOUNT_KEY_CLAIM_PATH as b9,
  storedZip as bA,
  WORKBOOK_MAX_CELL_CHARS as bB,
  ARCHIVE_RATIO_FLOOR_BYTES as bC,
  WORKBOOK_CONTAINER_MAX_RATIO as bD,
  WORKBOOK_CONTAINER_MAX_BYTES as bE,
  WORKBOOK_CONTAINER_MAX_ENTRIES as bF,
  columnName as bG,
  classifyEmailLinkSendFailure as ba,
  ACCOUNT_ACQUISITION_PATH as bb,
  KEY_METER_PATH as bc,
  keyMeterFrom as bd,
  ACCOUNT_BLOCKED_COPY as be,
  topupSessionPath as bf,
  manualKeyWriteRefusal as bg,
  SIGN_OUT_NOT_PERSISTED_COPY as bh,
  buildAccountSnapshot as bi,
  engineFamilyLine as bj,
  validateStagingGatewayUrl as bk,
  defaultGatewayUrlForChannel as bl,
  channelAppIdentity as bm,
  STAGING_GATEWAY_URL as bn,
  sanitizeStoredGatewayForChannel as bo,
  readWorkbookInWorker as bp,
  switchGatewayKeys as bq,
  pinGatewaySettings as br,
  paidWorkBlockedFor as bs,
  keyVerificationRetry as bt,
  assetExt as bu,
  WORKBOOK_MAX_BYTES as bv,
  WORKBOOK_MAX_SHEETS as bw,
  WORKBOOK_MAX_CELLS as bx,
  WORKBOOK_SCHEMA as by,
  inspectZipContainer as bz,
  canUseNightlyUpdates as c,
  INTAKE_FOLDER_MAX_VISITS as d,
  errorCauses as e,
  friendlyErrorLine as f,
  INTAKE_FOLDER_MAX_BYTES as g,
  INTAKE_FOLDER_MAX_FILES as h,
  INTAKE_FOLDER_MAX_DEPTH as i,
  isAcceptedAsset as j,
  assetKind as k,
  PDF_MAX_PAGES as l,
  PDF_MAX_BYTES as m,
  PDF_MAX_TEXT_CHARS as n,
  CLIPBOARD_IMAGE_MAX_BYTES as o,
  assetRejectReason as p,
  folderRejectReason as q,
  runtimeFailureKind as r,
  sanitizeErrorText as s,
  isWorkbookContents as t,
  unpricedPaidGenTools as u,
  workbookPage as v,
  workspaceLeafForChannel as w,
  workbookSummary as x,
  isWorkbookName as y,
  workbookRejectReason as z,
};
