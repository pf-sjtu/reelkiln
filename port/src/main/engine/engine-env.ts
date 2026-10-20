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

/** claudeCodeExecutable (L22710-22719). Original joins `.../claude-agent-sdk-${platform}-${arch}/claude`
 *  with NO extension; dev (unpackaged) returns bare "claude". PORT: exeName on win32.
 *  TODO(verify on Windows): file name inside @anthropic-ai/claude-agent-sdk-win32-x64@0.3.281 —
 *  not in the macOS bundle; `claude.exe` assumed. */
export function claudeCodeExecutable(o: { isPackaged: boolean; appPath: string; platform?: Plat; arch?: string }): string {
  const p = o.platform ?? process.platform;
  if (!o.isPackaged) return "claude";
  return pathMod(p).join(o.appPath.replace("app.asar", "app.asar.unpacked"), "node_modules", "@anthropic-ai", `claude-agent-sdk-${p}-${o.arch ?? process.arch}`, exeName("claude", p));
}

/** resolveCodexExecutable (L23422-23446) minus devStagedCodexRoots. ORIGINAL env var
 *  VIDEOCLAW_CODEX_BIN is honoured exactly as in the bundle. PORT: `codex.exe` on win32. */
export function resolveCodexExecutable(o: { explicit?: string; env: NodeJS.ProcessEnv; resourcesPath?: string; requireBundled?: boolean; exists?: (p: string) => boolean; platform?: Plat }): string {
  const p = o.platform ?? process.platform;
  const exists = o.exists ?? existsSync;
  const bundled = o.resourcesPath ? pathMod(p).join(o.resourcesPath, "bootstrap", "codex", "bin", exeName("codex", p)) : undefined;
  if (o.requireBundled) {
    if (!bundled || !exists(bundled)) throw new Error("The packaged Codex runtime is unavailable. Reinstall VideoClaw.");
    return bundled;
  }
  if (o.explicit) return o.explicit;
  const devOverride = o.env.VIDEOCLAW_CODEX_BIN?.trim();
  if (devOverride) return devOverride;
  if (bundled && exists(bundled)) return bundled;
  return "codex";
}
