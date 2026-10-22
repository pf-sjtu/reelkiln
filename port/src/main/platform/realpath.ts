// PORT-WIN (docs/35 M18): realpath for path-identity checks the original only ever ran on macOS.
// POSIX: fs.realpathSync (the original's call, unchanged). win32: realpathSync.native (expands 8.3 short names such as
// RUNNER~1 that the JS implementation keeps), without a \\?\ prefix, case-folded — the result is only ever compared.
import { realpathSync } from "node:fs";

export function portRealpath(p: string, platform: NodeJS.Platform = process.platform, impl: { js: (p: string) => string; native: (p: string) => string } = { js: realpathSync, native: realpathSync.native }): string {
  if (platform !== "win32") return impl.js(p);
  let r = impl.native(p);
  if (r.startsWith("\\\\?\\UNC\\")) r = "\\\\" + r.slice(8);
  else if (r.startsWith("\\\\?\\")) r = r.slice(4);
  return r.replace(/\//g, "\\").toLowerCase();
}

/** Diagnostic only (paths, never credentials): which two directories the profile check saw. */
export function portReportProfileMismatch(actual: unknown, expected: unknown): void {
  let a = String(actual ?? ""); let e = String(expected ?? "");
  try { if (a) a += ` → ${portRealpath(a)}`; } catch {}
  try { if (e) e += ` → ${portRealpath(e)}`; } catch {}
  console.error(`[codex] profile check: server codexHome=${a || "(missing)"} · expected=${e}`);
}
