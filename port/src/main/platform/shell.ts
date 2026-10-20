// Shell invocation. Original:
//   * agent Bash tool (codex/credits route): spawn("/bin/bash", ["-c", withOutputPipefail(cmd)],
//     { detached: process.platform !== "win32" })   — main/index.js L25331-25335
//   * writeProjectStream: spawn("/bin/sh", ["-c", RELATIVE_WRITER, …])   — L2928-2931
// Agent-authored commands are bash syntax (`uv run … | tail`, `$VIDEOCLAW_ENGINE`), so on
// Windows the faithful choice is a real bash (Git for Windows). cmd/powershell cannot run
// them unmodified; they are only a last-resort fallback flagged as degraded.
import { isWin, type Plat } from "./types";

export interface ShellChoice {
  file: string;
  argsFor: (command: string) => string[];
  kind: "bash" | "sh" | "cmd" | "powershell";
  /** true when the shell cannot run the original bash-syntax commands verbatim. */
  degraded: boolean;
}

/** Common Git-for-Windows bash locations (checked after PATH). */
export function gitBashCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const pf = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Programs`].filter(Boolean);
  return pf.flatMap((d) => [`${d}\\Git\\bin\\bash.exe`, `${d}\\Git\\usr\\bin\\bash.exe`]);
}

export function bashShell(o: {
  platform?: Plat;
  env?: NodeJS.ProcessEnv;
  which: (cmd: string) => string | undefined;
  exists: (p: string) => boolean;
}): ShellChoice {
  const p = o.platform ?? process.platform;
  if (!isWin(p)) return { file: "/bin/bash", argsFor: (c) => ["-c", c], kind: "bash", degraded: false };
  // Avoid C:\Windows\System32\bash.exe (WSL launcher): different filesystem view.
  const onPath = o.which("bash");
  const viaPath = onPath && !/\\system32\\bash\.exe$/i.test(onPath) ? onPath : undefined;
  const bash = viaPath ?? gitBashCandidates(o.env).find(o.exists);
  if (bash) return { file: bash, argsFor: (c) => ["-c", c], kind: "bash", degraded: false };
  const env = o.env ?? process.env;
  const comspec = env.ComSpec ?? env.COMSPEC ?? "cmd.exe";
  return { file: comspec, argsFor: (c) => ["/d", "/s", "/c", c], kind: "cmd", degraded: true };
}

/** `/bin/sh` equivalent for the small POSIX helper scripts (RELATIVE_WRITER). On Windows
 *  TODO: re-implement RELATIVE_WRITER in Node fs (it only does confined O_EXCL writes). */
export function posixSh(o: Parameters<typeof bashShell>[0]): ShellChoice {
  const p = o.platform ?? process.platform;
  if (!isWin(p)) return { file: "/bin/sh", argsFor: (c) => ["-c", c], kind: "sh", degraded: false };
  return { ...bashShell(o), kind: "sh" };
}

/** Original: `detached: process.platform !== "win32"` — already cross-platform in the bundle. */
export function spawnDetachedForGroup(p: Plat = process.platform): boolean {
  return !isWin(p);
}
