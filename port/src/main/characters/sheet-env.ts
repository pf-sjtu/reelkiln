// PORT-NEW glue (docs/29 §7) for the verbatim CharacterSheetBuilder slice (character-sheet.generated.ts): the
// collaborators the original resolves from module scope, bound at runtime by real-backend.ts.
//   app.getPath("userData") / app.isPackaged  — Electron app (BuildLog dir, DEV_FALLBACK_ENGINE gate)
//   currentEngine()                           — the installed engine (bootstrap core)
//   engineSessionEnv(key?, url?)              — engine/session.ts engineSessionEnv (L9380)
//   featureFlagDecision                       — L9155: no FeatureFlagStore in the port → the original's
//                                               store-absent answer { enabled: true, state: "absent" }
export { sanitizedAgentEnv } from "../llm/llm-route";
export { policyRefusalMessage } from "../agent/session-assembly.generated";

/** FEATURE_FLAG_REASON_COPY (L1283), verbatim. */
export const FEATURE_FLAG_REASON_COPY = {
  tool_incident: "This is temporarily turned off by VideoClaw while we fix a problem. Nothing you did caused this, and you have not been charged.",
  tool_staged: "This isn't switched on for your account yet.",
  vendor_incident: "This capability is temporarily unavailable while we work around a provider problem.",
  vendor_staged: "This isn't switched on for your account yet.",
  ui_incident: "This is temporarily turned off by VideoClaw while we fix a problem.",
  ui_staged: "This isn't switched on for your account yet.",
};
/** featureFlagDecision (L9155) with processStore undefined. */
export function featureFlagDecision(_namespace: string, _key: string): { enabled: boolean; state: string; copy?: string } {
  return { enabled: true, state: "absent" };
}
interface SheetEnv {
  userData: () => string;
  isPackaged: () => boolean;
  currentEngine: () => { path: string } | null | undefined;
  engineSessionEnv: (gatewayKey?: string, gatewayUrl?: string) => Record<string, string>;
}
let env: SheetEnv = { userData: () => require("node:os").tmpdir(), isPackaged: () => false, currentEngine: () => null, engineSessionEnv: () => ({}) };
export function configureSheetEnv(e: Partial<SheetEnv>): void { env = { ...env, ...e }; }
export const app = { getPath: (_name: "userData") => env.userData(), get isPackaged() { return env.isPackaged(); } };
export function currentEngine() { return env.currentEngine(); }
export function engineSessionEnv(gatewayKey?: string, gatewayUrl?: string): Record<string, string> { return env.engineSessionEnv(gatewayKey, gatewayUrl); }
