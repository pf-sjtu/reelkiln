// PORT-NEW glue (docs/26) for the verbatim library slice (library.generated.ts): the collaborators the
// original resolves from module scope. engineSessionEnv (L9380) is the port's ported engineSessionEnv,
// bound at runtime by real-backend.ts (configureLibraryEnv); EXTRA_PATHS is the original value (L9322).
import { homedir } from "node:os";
import { join } from "node:path";
export { UV_PYTHON_POLICY_ENV } from "../engine/bootstrap";
export { classifyError, errorCauses, sanitizeErrorText } from "../agent/history.generated";

/** EXTRA_PATHS (L9322-9327), verbatim. */
export const EXTRA_PATHS = [
  join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".cargo", "bin"),
];
let sessionEnv: (gatewayKey?: string, gatewayUrl?: string) => Record<string, string> = () => ({});
export function configureLibraryEnv(impl: (gatewayKey?: string, gatewayUrl?: string) => Record<string, string>): void { sessionEnv = impl; }
/** engineSessionEnv(gatewayKey?, gatewayUrl?) as the original library module calls it. */
export function engineSessionEnv(gatewayKey?: string, gatewayUrl?: string): Record<string, string> {
  try { return sessionEnv(gatewayKey, gatewayUrl); } catch { return {}; }
}
