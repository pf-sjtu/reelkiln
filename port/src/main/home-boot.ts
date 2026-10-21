// docs/21 M1: the home-boot channels the ORIGINAL renderer calls on launch, served for real
// (Electron-free so they are unit-tested; real-backend.ts wires them):
//   account:snapshot           L61406 → resolveAccountSnapshot L55423 → buildAccountSnapshot (verbatim
//                              chunk slice, account-snapshot.generated.ts) with the honest inputs of a
//                              build that has NO account service (no gateway, no stored key) …
//                              … plus the PORT-NEW "local studio" policy (default ON; opt out with
//                              VIDEOCLAW_PORT_ACCOUNT_GATE=1): the snapshot is built as a grandfathered
//                              legacy-key studio (legacyKeyOnly → step "ready"), exactly the renderer's
//                              own QA_ACCOUNT_READY fallback, so the home opens instead of the sign-in
//                              gate. Paid work stays refused (no key reaches the engine).
//   app:update:get             L61370 → currentUpdateInfo (initially null L60463; no update checker)
//   interaction:replayPending  L61701 → re-push every pending permission/input request
//   workflowSubmit:eligibility L62398 → WorkflowSubmission.eligibility() with no gateway configured
//   bootstrap:status           L61300 → Bootstrap.status() L9802 (all fields; unported stores report
//                              their ORIGINAL unconfigured values)
//   client:list / client:create L61817 → registry listClients / createClient (L36329 / L36346)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAccountSnapshot } from "./account-snapshot.generated";

export const PORT_ACCOUNT_GATE_ENV = "VIDEOCLAW_PORT_ACCOUNT_GATE";
/** PORT: resolvePool(gatewayUrl).reason text when no account service exists (original copy unknown). */
export const NO_ACCOUNT_SERVICE_REASON = "This build has no Videoclaw account service configured.";

export function accountSnapshot(o: { env?: NodeJS.ProcessEnv; accountSignedInOnce?: boolean } = {}) {
  const localStudio = (o.env ?? process.env)[PORT_ACCOUNT_GATE_ENV] !== "1";
  const snap = buildAccountSnapshot({
    loaded: true,
    signInAvailable: false,
    signInUnavailableReason: NO_ACCOUNT_SERVICE_REASON,
    signedIn: false,
    account: null,
    // honest: no stored gateway key. Local studio: treated like a grandfathered key-only install.
    hasStoredKey: localStudio,
    hasLocalConsent: localStudio,
    accountSignedInOnce: o.accountSignedInOnce === true,
    pendingKey: false,
    secureStorageUnavailable: false,
    credentialVaultUnreadable: false,
  });
  return localStudio ? { ...snap, portLocalStudio: true } : snap;
}

export function workflowSubmitEligibility() { // WorkflowSubmission.eligibility, no gateway
  return { eligible: false, githubUsername: null, workflowsRepo: "", configured: false };
}

export interface StatusCore {
  status(): { ready: boolean; engineVersion?: string; enginePath?: string; workspacePath: string; doctor?: unknown; packaged: boolean };
  currentEngine(): { path: string; version?: string; buildSha256?: string } | null;
}
/** Bootstrap.status() L9802 — fields owned by unported stores carry their unconfigured values. */
export function bootstrapStatus(core: StatusCore, o: { packaged: boolean; env?: NodeJS.ProcessEnv; productionCompatible: (p: string) => boolean; previousEngineVersion?: string }) {
  const base = core.status();
  const eng = core.currentEngine();
  const productionCompatible = eng ? o.productionCompatible(eng.path) : false;
  const MANAGED_DEVELOPMENT = false; // L9xxx: only true in Videoclaw's managed dev launcher
  return {
    ...base,
    shouldOffer: (o.packaged || MANAGED_DEVELOPMENT) && (!eng || !productionCompatible), // channel "prod" (no staging)
    managedDevelopment: MANAGED_DEVELOPMENT,
    packaged: o.packaged,
    devMode: !o.packaged || (o.env ?? process.env).VIDEOCLAW_DEV === "1",
    engineLatest: undefined, // latestKnown: no update feed
    engineUpdate: "unknown", // updateState initial value L9776
    enginePrevious: o.previousEngineVersion,
    studioBundle: { state: "disabled" }, // studioBundleStatus L8223 without processStore$1
    engineIdentity: eng ? currentEngineIdentity(eng) : undefined, // L9218
    featureFlags: undefined, // featureFlagStatus L9158 without processStore
  };
}
function currentEngineIdentity(pointer: { path: string; buildSha256?: string }) {
  const identity: Record<string, string> = {};
  if (pointer.buildSha256) identity.buildSha256 = pointer.buildSha256;
  try {
    const stamp = JSON.parse(readFileSync(join(pointer.path, "ENGINE_VERSION.json"), "utf-8"));
    for (const key of ["gitSha", "gitBranch", "gitDirty", "builtAt"]) {
      const value = stamp[key];
      if (typeof value === "string" && value.length > 0) identity[key] = value;
    }
  } catch {}
  return identity;
}

/** interaction:replayPending L61701. */
export function replayPendingInteractions(pending: Array<{ kind: string; request: unknown }>, push: (ch: string, ...a: unknown[]) => unknown): void {
  for (const p of pending) push(p.kind === "permission" ? "permission:request" : "input:request", p.request);
}
