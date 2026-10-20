// Port of the engine/app command shims (main/index.js L6435-6438, L7199-7308):
// ENGINE_COMMAND_SHIMS, pythonShimScript, pipShimScript, gitShimScript, commandShimScript,
// isCurrentShim, writeCommandShims, ensureEngineCommandShims, installAppCommandShims.
//
// POSIX output is byte-identical to the original (tested against the reconstructed source).
// win32 (PORT-NEW, unverified on Windows):
//   * Git Bash (MSYS) resolves `python` only as `python` / `python.exe` — it does NOT try
//     `.cmd`. So the extensionless `#!/bin/sh` shim is still written (Git Bash honours the
//     shebang), with the venv path switched to `.venv/Scripts/python.exe`.
//   * cmd.exe / CreateProcess-with-shell callers resolve via PATHEXT, so a `<name>.cmd`
//     sibling is written too.
//   * The original git shim exists only to dodge the macOS Xcode-CLT install prompt; there is
//     no such prompt on Windows. The win32 git shim forwards to the first real git.exe found
//     on PATH after the shim dir (resolved by the app at write time), else prints a port-new
//     message. The xcode-select probe has no Windows equivalent and is dropped.
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join as hostJoin } from "node:path"; // FS paths always use the HOST path module; `platform` only selects script content
import { isWin, pathDelimiter, pathEnvKey, type Plat } from "../platform";

export const PYTHON_MISSING_REASON = "VideoClaw's own Python is missing or damaged, so it can't run commands safely."; // L6435
export const SETUP_REPAIR_ACTION = "Repair VideoClaw"; // L6437
export const PYTHON_REPAIR_MESSAGE = `${PYTHON_MISSING_REASON} Click ${SETUP_REPAIR_ACTION} in the chat to fix it.`; // L6438
export const GIT_UNAVAILABLE_MESSAGE = "git isn't available because this Mac doesn't have Apple's developer tools."; // L7199
export const PIP_UNAVAILABLE_MESSAGE = "pip isn't available in VideoClaw. Setup installs its Python packages."; // L7201
/** PORT-NEW (not in bundle): Windows wording for the git shim. */
export const PORT_WIN_GIT_UNAVAILABLE_MESSAGE = "git isn't available. Install Git for Windows and restart VideoClaw.";
export const ENGINE_COMMAND_SHIMS = ["python3", "python", "pip3", "pip", "git"] as const; // L7203
export type ShimLocation = "engine" | "app";

export function shellQuote(value: string): string { // L7204
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function pythonShimScript(location: ShimLocation = "engine", p: Plat = "darwin"): string {
  const venvPy = isWin(p) ? ".venv/Scripts/python.exe" : ".venv/bin/python"; // PORT: win32 venv layout
  const findVenv = location === "engine"
    ? [
        'case "$0" in */*) bin_dir=${0%/*} ;; *) bin_dir=. ;; esac',
        `engine_python="$bin_dir/../${venvPy}"`,
        'if [ -x "$engine_python" ]; then exec "$engine_python" "$@"; fi',
      ]
    : [
        "# On the app PATH: the venv of the engine this process runs for.",
        'case "${VIDEOCLAW_ENGINE:-}" in',
        ...(isWin(p)
          // PORT: Git Bash sees VIDEOCLAW_ENGINE as `C:\...` (not `/…`); accept drive paths too.
          ? [`  /*|[A-Za-z]:*) engine_python="$VIDEOCLAW_ENGINE/${venvPy}"`]
          : [`  /*) engine_python="$VIDEOCLAW_ENGINE/${venvPy}"`]),
        '      if [ -x "$engine_python" ]; then exec "$engine_python" "$@"; fi ;;',
        "esac",
      ];
  return ["#!/bin/sh", "# VideoClaw (#1038): run the engine's own Python, never /usr/bin/python3.", ...findVenv, `echo "${PYTHON_REPAIR_MESSAGE}" >&2`, "exit 1", ""].join("\n");
}

export function pipShimScript(): string {
  return ["#!/bin/sh", "# VideoClaw (#1038): /usr/bin/pip3 asks to install Apple's developer tools.", `echo "${PIP_UNAVAILABLE_MESSAGE}" >&2`, "exit 1", ""].join("\n");
}

export function gitShimScript(tools = { xcodeSelect: "/usr/bin/xcode-select", git: "/usr/bin/git" }): string {
  return [
    "#!/bin/sh",
    "# VideoClaw (#1038): /usr/bin/git asks to install Apple's developer tools",
    "# when they are missing. Run it only when they are installed.",
    `if developer_dir=$(${shellQuote(tools.xcodeSelect)} -p 2>/dev/null) && [ -x "$developer_dir/usr/bin/git" ]; then`,
    `  exec ${shellQuote(tools.git)} "$@"`,
    "fi",
    `echo "${GIT_UNAVAILABLE_MESSAGE}" >&2`,
    "exit 1",
    "",
  ].join("\n");
}

/** PORT-NEW: Git-Bash flavoured git shim (no xcode-select on Windows). */
export function winGitShScript(realGit: string | undefined): string {
  return [
    "#!/bin/sh",
    "# VideoClaw port: forward to Git for Windows (the macOS Xcode probe has no Windows equivalent).",
    ...(realGit ? [`exec ${shellQuote(realGit.replace(/\\/g, "/"))} "$@"`] : [`echo "${PORT_WIN_GIT_UNAVAILABLE_MESSAGE}" >&2`, "exit 1"]),
    "",
  ].join("\n");
}

export function commandShimScript(name: string, location: ShimLocation = "engine", p: Plat = "darwin", realGit?: string): string {
  if (name === "git") return isWin(p) ? winGitShScript(realGit) : gitShimScript();
  if (name === "pip3" || name === "pip") return pipShimScript();
  return pythonShimScript(location, p);
}

/** PORT-NEW: cmd.exe batch equivalents. `%ERRORLEVEL%` is read outside any ( ) block so it
 *  is expanded after the call, not at parse time. Output messages identical to the sh shims. */
export function commandShimCmd(name: string, location: ShimLocation = "engine", realGit?: string): string {
  const L = (...l: string[]) => l.join("\r\n") + "\r\n";
  if (name === "pip3" || name === "pip") return L("@echo off", "rem VideoClaw (#1038) port: pip is not available; Setup installs Python packages.", `echo ${PIP_UNAVAILABLE_MESSAGE} 1>&2`, "exit /b 1");
  if (name === "git") {
    return realGit
      ? L("@echo off", "rem VideoClaw port: forward to Git for Windows.", `"${realGit}" %*`, "exit /b %ERRORLEVEL%")
      : L("@echo off", `echo ${PORT_WIN_GIT_UNAVAILABLE_MESSAGE} 1>&2`, "exit /b 1");
  }
  const find = location === "engine"
    ? ['set "engine_python=%~dp0..\\.venv\\Scripts\\python.exe"']
    : ['if "%VIDEOCLAW_ENGINE%"=="" goto missing', 'set "engine_python=%VIDEOCLAW_ENGINE%\\.venv\\Scripts\\python.exe"'];
  // `'` in PYTHON_REPAIR_MESSAGE is literal in cmd; no metacharacters (&|<>^) occur in it.
  return L("@echo off", "rem VideoClaw (#1038) port: run the engine's own Python, never a system python.", "setlocal", ...find, 'if not exist "%engine_python%" goto missing', '"%engine_python%" %*', "exit /b %ERRORLEVEL%", ":missing", `echo ${PYTHON_REPAIR_MESSAGE} 1>&2`, "exit /b 1");
}

export function isCurrentShim(path: string, script: string, p: Plat = process.platform): boolean { // L7263
  try {
    const st = lstatSync(path);
    // win32 has no exec bits (mode reports 0o666/0o444); PORT: skip the 0o111 check there.
    return st.isFile() && (isWin(p) || (st.mode & 73) === 73) && readFileSync(path, "utf8") === script;
  } catch {
    return false;
  }
}

function writeAtomic(target: string, script: string) {
  const staging = `${target}.tmp-${randomUUID()}`;
  writeFileSync(staging, script, { mode: 493 });
  chmodSync(staging, 493);
  renameSync(staging, target);
}

export function writeCommandShims(bin: string, location: ShimLocation, o: { platform?: Plat; realGit?: string } = {}): void { // L7271
  const p = o.platform ?? process.platform;
  mkdirSync(bin, { recursive: true });
  for (const name of ENGINE_COMMAND_SHIMS) {
    const target = hostJoin(bin, name);
    const script = commandShimScript(name, location, p, o.realGit);
    if (!isCurrentShim(target, script, p)) writeAtomic(target, script);
    if (isWin(p)) {
      const cmd = commandShimCmd(name, location, o.realGit);
      if (!isCurrentShim(`${target}.cmd`, cmd, p)) writeAtomic(`${target}.cmd`, cmd);
    }
  }
}

export function ensureEngineCommandShims(enginePath: string, o: { platform?: Plat; realGit?: string } = {}): void { // L7283
  writeCommandShims(hostJoin(enginePath, "bin"), "engine", o);
}

export function installAppCommandShims(userData: string, env: NodeJS.ProcessEnv = process.env, o: { platform?: Plat; realGit?: string } = {}): string { // L7286
  const p = o.platform ?? process.platform;
  const bin = hostJoin(userData, "bin");
  writeCommandShims(bin, "app", o);
  const key = pathEnvKey(env, p);
  const d = pathDelimiter(p);
  const rest = (env[key] ?? "").split(d).filter((e) => e && e !== bin);
  env[key] = [bin, ...rest].join(d);
  return bin;
}
