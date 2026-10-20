// Process enumeration. Original (L31601-31650):
//   listProcesses(): execFileSync("ps", ["-Awwo", "pid=,ppid=,command="])
//   processCwd(pid): realpath(/proc/<pid>/cwd) → lsof -a -d cwd -Fn -p <pid>
// Windows: Win32_Process via PowerShell CIM (wmic is deprecated/removed in Win11 24H2).
// A process' cwd is NOT exposed by any supported Windows API without reading the PEB of
// another process (needs native code) → returns undefined (TODO, see docs/07).
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isWin, type Plat } from "./types";

export interface ProcRow { pid: number; ppid: number; command: string }

/** Verbatim parser from the original listProcesses. */
export function parsePsOutput(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return rows;
}

export const WIN_PS_SCRIPT =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress";

/** Parse ConvertTo-Json output (object when one row, array otherwise). Rows with no
 *  CommandLine (access denied / system) fall back to ExecutablePath, else are dropped —
 *  mirroring the original which only matches on command text. */
export function parseWin32ProcessJson(json: string): ProcRow[] {
  if (!json.trim()) return [];
  const data = JSON.parse(json);
  const list: any[] = Array.isArray(data) ? data : [data];
  const rows: ProcRow[] = [];
  for (const r of list) {
    const command = r.CommandLine ?? r.ExecutablePath;
    if (typeof r.ProcessId !== "number" || !command) continue;
    rows.push({ pid: r.ProcessId, ppid: Number(r.ParentProcessId ?? 0), command: String(command) });
  }
  return rows;
}

export function listProcesses(p: Plat = process.platform): ProcRow[] {
  try {
    if (isWin(p)) {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_PS_SCRIPT], {
        encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15e3, windowsHide: true,
      });
      return parseWin32ProcessJson(out);
    }
    return parsePsOutput(execFileSync("ps", ["-Awwo", "pid=,ppid=,command="], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 5e3,
    }));
  } catch {
    return [];
  }
}

export function processCwd(pid: number, p: Plat = process.platform): string | undefined {
  if (isWin(p)) return undefined; // TODO(win): no supported API; see docs/07 §blockers
  try { return realpathSync(`/proc/${pid}/cwd`); } catch {}
  for (const lsof of ["/usr/sbin/lsof", "lsof"]) {
    try {
      const out = execFileSync(lsof, ["-a", "-d", "cwd", "-Fn", "-p", String(pid)], { encoding: "utf8", maxBuffer: 1 << 20, timeout: 5e3 });
      for (const line of out.split("\n")) if (line.startsWith("n")) return line.slice(1);
      return undefined;
    } catch {}
  }
  return undefined;
}
