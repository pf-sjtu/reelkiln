// PATH composition, venv python and executable naming.
// Original (macOS-only) behaviour cited per function; the port keeps POSIX output
// byte-identical and only diverges on win32.
import path from "node:path";
import { isWin, type Plat } from "./types";

export const pathMod = (p: Plat = process.platform) => (isWin(p) ? path.win32 : path.posix);

/** Original: hard-coded ":" — `parts.join(":")` in enginePath_ (main/index.js L9320). */
export function pathDelimiter(p: Plat = process.platform): string {
  return isWin(p) ? ";" : ":";
}

/** Windows env keys are case-insensitive ("Path" is common); POSIX uses "PATH". */
export function pathEnvKey(env: NodeJS.ProcessEnv, p: Plat = process.platform): string {
  if (!isWin(p)) return "PATH";
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "Path";
}

/** Port of enginePath_(engineDir) (L9313-9321):
 *  `<engine>/bin` + first existing `<bootstrapRoot>/node/bin` + inherited PATH.
 *  On win32 the official Node zip has node.exe at the archive ROOT (no bin/), so the
 *  port also accepts `<root>/node` when it contains node.exe. (PORT DIVERGENCE, documented.) */
export function composeEnginePath(opts: {
  engineDir: string;
  bootstrapRoots: string[];
  inheritedPath: string | undefined;
  exists: (p: string) => boolean;
  platform?: Plat;
}): string {
  const p = opts.platform ?? process.platform;
  const pm = pathMod(p);
  const parts = [pm.join(opts.engineDir, "bin")];
  const candidates = opts.bootstrapRoots.flatMap((root) =>
    isWin(p) ? [pm.join(root, "node", "bin"), pm.join(root, "node")] : [pm.join(root, "node", "bin")],
  );
  const bundledNode = candidates.find((c) =>
    isWin(p) ? opts.exists(pm.join(c, "node.exe")) : opts.exists(c),
  );
  if (bundledNode) parts.push(bundledNode);
  parts.push(opts.inheritedPath ?? "");
  return parts.join(pathDelimiter(p));
}

/** Original: join(engine, ".venv", "bin", "python") at ~15 call sites (L4206, L6344, L19077 VENV_PY …).
 *  uv/venv on Windows lays out `.venv\Scripts\python.exe`. */
export function venvPython(engineDir: string, p: Plat = process.platform, name = "python"): string {
  const pm = pathMod(p);
  return isWin(p) ? pm.join(engineDir, ".venv", "Scripts", `${name}.exe`) : pm.join(engineDir, ".venv", "bin", name);
}
export function venvBinDir(engineDir: string, p: Plat = process.platform): string {
  const pm = pathMod(p);
  return isWin(p) ? pm.join(engineDir, ".venv", "Scripts") : pm.join(engineDir, ".venv", "bin");
}

/** Original looks for bare names (`bin/ffmpeg`, `bootstrap/uv`, `codex/bin/codex`). */
export function exeName(name: string, p: Plat = process.platform): string {
  return isWin(p) && !/\.(exe|cmd|bat|com)$/i.test(name) ? `${name}.exe` : name;
}

/** Original EXTRA_PATHS (L9322-9327): ~/.local/bin, /opt/homebrew/bin, /usr/local/bin, ~/.cargo/bin.
 *  Win32 equivalents are where the same tools' official installers put binaries. */
export function extraPaths(home: string, p: Plat = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  const pm = pathMod(p);
  if (!isWin(p)) return [pm.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", pm.join(home, ".cargo", "bin")];
  const local = env.LOCALAPPDATA ?? pm.join(home, "AppData", "Local");
  return [pm.join(home, ".local", "bin"), pm.join(home, ".cargo", "bin"), pm.join(local, "Microsoft", "WinGet", "Links")];
}

/** Port of engineChildPath (L9328-9331): split enginePath_, append EXTRA_PATHS, dedupe. */
export function composeEngineChildPath(enginePath: string, extra: string[], p: Plat = process.platform): string {
  const d = pathDelimiter(p);
  const dirs = [...enginePath.split(d), ...extra];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs.filter(Boolean)) {
    const k = isWin(p) ? dir.toLowerCase() : dir; // Windows paths are case-insensitive
    if (!seen.has(k)) { seen.add(k); out.push(dir); }
  }
  return out.join(d);
}

/** PORT-WIN docs/34: a relative path stored in a ledger/JSON the original only wrote on macOS (always "/"-joined, and
 *  its readers refuse "\\") — identical to path.relative on POSIX. */
export function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}
