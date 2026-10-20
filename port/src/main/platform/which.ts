// shutil.which-style lookup. The original never needs this for bundled tools (it uses
// absolute bootstrap paths), but relies on PATH lookup for `bash`, `git`, `uv` fallbacks
// and the agent's own shell. Windows needs PATHEXT handling.
import { isWin, type Plat } from "./types";
import { pathDelimiter, pathEnvKey, pathMod } from "./paths";

export function which(
  cmd: string,
  opts: { env?: NodeJS.ProcessEnv; platform?: Plat; isFile: (p: string) => boolean },
): string | undefined {
  const p = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const pm = pathMod(p);
  const exts = isWin(p)
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase())
    : [""];
  const hasExt = isWin(p) && exts.includes(pm.extname(cmd).toLowerCase());
  const variants = (base: string) => (isWin(p) ? (hasExt ? [base] : exts.map((e) => base + e)) : [base]);
  if (cmd.includes("/") || (isWin(p) && cmd.includes("\\"))) return variants(cmd).find(opts.isFile);
  const dirs = (env[pathEnvKey(env, p)] ?? "").split(pathDelimiter(p)).filter(Boolean);
  // cmd.exe semantics: current dir first. shutil.which does the same on Windows; we
  // deliberately DO NOT (safer, matches POSIX behaviour of the original).
  for (const d of dirs) {
    const hit = variants(pm.join(d.replace(/^"|"$/g, ""), cmd)).find(opts.isFile);
    if (hit) return hit;
  }
  return undefined;
}
