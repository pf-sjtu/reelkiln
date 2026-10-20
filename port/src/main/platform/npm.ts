// npm / npx / tar invocation. Original (macOS) calls them by bare name through execFile:
//   run("npm", ["ci","--no-audit","--no-fund"])          — main/index.js L10054 (ensureRemotion), L10073 (ensureHyperframes)
//   run("npx", ["remotion","browser","ensure"])          — L10059
//   run("tar", ["-xf", tarball, "-C", staging, "--strip-components", "1"]) — L10016
// win32 problems (PORT, unverified on Windows):
//   * npm/npx are `npm.cmd`/`npx.cmd`; since Node 18.20.2/20.12.2 (CVE-2024-27980) execFile/spawn
//     of a .cmd without `shell:true` throws EINVAL. Port runs `node.exe <npm-cli.js>` directly
//     when the bundled/official Node layout is found, else falls back to `<name>.cmd` + shell.
//   * `tar` on PATH may be Git's GNU tar, which parses `C:\...` as `host:path`. Port pins
//     `%SystemRoot%\System32\tar.exe` (bsdtar, ships with Windows 10 1803+; supports -xf on
//     .tar.gz and --strip-components).
import { isWin, type Plat } from "./types";
import { pathMod } from "./paths";

export interface Invocation { file: string; args: string[]; shell?: boolean }

export function npmCliCandidates(nodeDirs: string[], tool: "npm" | "npx", p: Plat = process.platform): { node: string; cli: string }[] {
  const pm = pathMod(p);
  const cli = tool === "npm" ? "npm-cli.js" : "npx-cli.js";
  return nodeDirs.map((d) => ({ node: pm.join(d, "node.exe"), cli: pm.join(d, "node_modules", "npm", "bin", cli) }));
}

export function npmInvocation(
  tool: "npm" | "npx",
  args: string[],
  o: { platform?: Plat; nodeDirs?: string[]; exists?: (p: string) => boolean } = {},
): Invocation {
  const p = o.platform ?? process.platform;
  if (!isWin(p)) return { file: tool, args }; // original, unchanged
  const hit = npmCliCandidates(o.nodeDirs ?? [], tool, p).find((c) => o.exists?.(c.node) && o.exists?.(c.cli));
  if (hit) return { file: hit.node, args: [hit.cli, ...args] };
  return { file: `${tool}.cmd`, args, shell: true }; // args here are constant flags (no user input)
}

export function tarInvocation(args: string[], o: { platform?: Plat; env?: NodeJS.ProcessEnv } = {}): Invocation {
  const p = o.platform ?? process.platform;
  if (!isWin(p)) return { file: "tar", args };
  const root = (o.env ?? process.env).SystemRoot ?? "C:\\Windows";
  return { file: pathMod(p).join(root, "System32", "tar.exe"), args };
}
