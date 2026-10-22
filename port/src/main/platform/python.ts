// nativePythonArgs (main/index.js L7145-7199), verbatim: forces an arm64 interpreter on Apple
// Silicon via Mach-O inspection. The ORIGINAL returns [] when
// process.platform !== "darwin" || process.arch !== "arm64", so on Windows/Linux it is a no-op.
// docs/38 M21: previously the port always returned []; now the darwin-arm64 branch is ported.
import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Plat } from "./types";

const execFileP = promisify(execFile);
const UV_PYTHON_POLICY_ENV = { UV_PYTHON_PREFERENCE: "only-managed" };
const CPU_TYPE_ARM64 = 16777228;
const MH_MAGIC_64 = 4277009103;
const FAT_MAGIC = 3405691582;
const FAT_MAGIC_64 = 3405691583;

export function needsNativePythonProbe(p: Plat = process.platform, arch: string = process.arch): boolean {
  return p === "darwin" && arch === "arm64";
}

/** L7150 verbatim: true = has an arm64 slice, false = Mach-O without one, undefined = unreadable / not Mach-O. */
export function machOHasArm64(file: string): boolean | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(realpathSync(file), "r");
    const header = Buffer.alloc(4096);
    const size = readSync(fd, header, 0, header.length, 0);
    if (size < 8) return undefined;
    if (header.readUInt32LE(0) === MH_MAGIC_64) return header.readInt32LE(4) === CPU_TYPE_ARM64;
    const fat = header.readUInt32BE(0);
    if (fat !== FAT_MAGIC && fat !== FAT_MAGIC_64) return undefined;
    const entrySize = fat === FAT_MAGIC ? 20 : 32;
    const count = header.readUInt32BE(4);
    for (let i = 0; i < count && 8 + (i + 1) * entrySize <= size; i++) {
      if (header.readInt32BE(8 + i * entrySize) === CPU_TYPE_ARM64) return true;
    }
    return false;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** L7172 verbatim (platform/arch injectable for tests). */
export async function nativePythonArgs(
  uv: string,
  opts: { cwd?: string; project?: string; env?: NodeJS.ProcessEnv } = {},
  plat: { platform?: string; arch?: string } = {},
): Promise<string[]> {
  if ((plat.platform ?? process.platform) !== "darwin" || (plat.arch ?? process.arch) !== "arm64") return [];
  const ownVenv = opts.project ? machOHasArm64(join(opts.project, ".venv", "bin", "python3")) : undefined;
  if (ownVenv === true) return [];
  const project = opts.project ? ["--project", opts.project] : [];
  const find = (extra: string[]) =>
    execFileP(uv, ["python", "find", "--system", ...project, ...extra], {
      cwd: opts.cwd,
      env: { ...(opts.env ?? process.env), ...UV_PYTHON_POLICY_ENV },
      timeout: 6e4,
    }).then(({ stdout }) => String(stdout).trim());
  let path: string;
  let version2: string;
  try {
    [path, version2] = await Promise.all([find([]), find(["--show-version"])]);
  } catch {
    return [];
  }
  if (ownVenv !== false && machOHasArm64(path) !== false) return [];
  const exact2 = /^\d+\.\d+\.\d+$/.exec(version2);
  if (exact2) return ["--python", `cpython-${exact2[0]}-macos-aarch64`];
  const minor = /^(\d+)\.(\d+)(?:\.|$)/.exec(version2);
  if (!minor) return [];
  return ["--python", `cpython-${minor[1]}.${minor[2]}-macos-aarch64`];
}
