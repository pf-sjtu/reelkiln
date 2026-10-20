// Port of resolveEditorRenderEngine (main/index.js L60614-60652) and absCwd (L60293).
// Collaborators (currentEngine, engineSessionEnv, workspaceRoot, settings) are injected.
// ORIGINAL env var VIDEOCLAW_HYPERFRAMES_ENGINE is honoured only when !isPackaged (L60615).
// PORT: bundled uv is `bin/uv.exe` on win32 (installEngineDir copies with exeName).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { exeName, pathMod, type Plat } from "../platform";
import { UV_PYTHON_POLICY_ENV } from "./bootstrap";

/** L60293: `cwd.replace(/^~(?=$|\/)/, homedir())`. PORT: win32 also expands `~\`. */
export function absCwd(cwd: string, p: Plat = process.platform, home = homedir()): string {
  return cwd.replace(p === "win32" ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/, home);
}

export interface ResolveEngineDeps {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  currentEngine: () => { path: string } | null;
  engineSessionEnv: () => Record<string, string>;
  workspaceRoot: () => string;
  gatewayKey?: () => string | undefined;
  exists?: (p: string) => boolean;
  platform?: Plat;
  home?: string;
}

export function resolveEditorRenderEngine(d: ResolveEngineDeps): { root: string; executable: string; env: Record<string, string | undefined> } | null {
  const p = d.platform ?? process.platform;
  const pm = pathMod(p);
  const exists = d.exists ?? existsSync;
  const devOverride = !d.isPackaged ? d.env.VIDEOCLAW_HYPERFRAMES_ENGINE?.trim() : undefined;
  const installed = d.currentEngine();
  let root: string;
  let env: Record<string, string | undefined>;
  if (devOverride) {
    root = absCwd(devOverride, p, d.home);
    if (!exists(root)) return null;
    env = { ...d.env, VIDEOCLAW_ENGINE: root, VIDEOCLAW_WORKSPACE: d.workspaceRoot() };
  } else if (installed) {
    root = installed.path;
    try { env = { ...d.env, ...d.engineSessionEnv() }; } catch { return null; }
  } else if (!d.isPackaged) {
    root = absCwd("~/projects/videoclaw", p, d.home);
    if (!exists(root)) return null;
    env = { ...d.env, VIDEOCLAW_ENGINE: root, VIDEOCLAW_WORKSPACE: d.workspaceRoot() };
  } else {
    return null;
  }
  const key = d.gatewayKey?.();
  if (key) env.VIDEOCLAW_API_KEY = key;
  const bundledUv = pm.join(root, "bin", exeName("uv", p));
  return { root, executable: exists(bundledUv) ? bundledUv : "uv", env: { ...env, ...UV_PYTHON_POLICY_ENV } };
}
