// Port of the job-directory boundary checks (out/main/index.js L19636-19707):
// JOB_ID_RE$2 L19639, COMPOSITION_* L19640-19641, expandHome L19642-19644,
// contained$1 L19645-19648, resolveJobDir L19649-19684, resolveJobBoundary L19688-19707.
import { realpathSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const COMPOSITION_DIR_REL = "hyperframes";
export const COMPOSITION_ENTRY_REL = path.join("hyperframes", "index.html");

/** Original: `cwd.replace(/^~(?=$|\/)/, homedir())`. PORT: also accepts `~\` on win32. */
export function expandHome(cwd: string, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return platform === "win32" ? cwd.replace(/^~(?=$|[\\/])/, home) : cwd.replace(/^~(?=$|\/)/, home);
}
export function contained(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type JobDirCode = "invalid-request" | "unknown-session" | "job-mismatch" | "job-not-found" | "composition-not-found";
export interface SessionLike { jobId?: unknown; cwd: string }

export function resolveJobDir(req: any, getSession: (id: string) => SessionLike | undefined):
  { ok: true; jobsDir: string; jobPath: string } | { ok: false; code: JobDirCode } {
  if (typeof req?.sessionId !== "string" || !req.sessionId || typeof req?.jobId !== "string" || !req.jobId) {
    return { ok: false, code: "invalid-request" };
  }
  const { sessionId, jobId } = req;
  if (!JOB_ID_RE.test(jobId)) return { ok: false, code: "invalid-request" };
  const session = getSession(sessionId);
  if (!session) return { ok: false, code: "unknown-session" };
  if (session.jobId !== jobId) return { ok: false, code: "job-mismatch" };
  const jobsDirLexical = path.join(expandHome(session.cwd), "jobs");
  const jobPathLexical = path.resolve(jobsDirLexical, jobId);
  const rel = path.relative(jobsDirLexical, jobPathLexical);
  if (rel !== jobId || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, code: "invalid-request" };
  let jobsDir: string;
  try { jobsDir = realpathSync(jobsDirLexical); } catch { return { ok: false, code: "job-not-found" }; }
  let jobPath: string;
  try {
    jobPath = realpathSync(jobPathLexical);
    if (!statSync(jobPath).isDirectory()) return { ok: false, code: "job-not-found" };
  } catch {
    return { ok: false, code: "job-not-found" };
  }
  if (!contained(jobPath, jobsDir)) return { ok: false, code: "job-not-found" };
  return { ok: true, jobsDir, jobPath };
}

export function resolveJobBoundary(req: any, getSession: (id: string) => SessionLike | undefined):
  { ok: true; boundary: { jobsDir: string; jobPath: string; compositionDir: string; entry: string } } | { ok: false; code: JobDirCode } {
  const job = resolveJobDir(req, getSession);
  if (!job.ok) return job;
  const { jobsDir, jobPath } = job;
  const entryLexical = path.join(jobPath, COMPOSITION_ENTRY_REL);
  if (!existsSync(entryLexical)) return { ok: false, code: "composition-not-found" };
  let compositionDir: string;
  let entry: string;
  try {
    compositionDir = realpathSync(path.join(jobPath, COMPOSITION_DIR_REL));
    entry = realpathSync(entryLexical);
    if (!statSync(entry).isFile()) return { ok: false, code: "composition-not-found" };
  } catch {
    return { ok: false, code: "composition-not-found" };
  }
  if (!contained(compositionDir, jobPath) || !contained(entry, compositionDir)) return { ok: false, code: "composition-not-found" };
  return { ok: true, boundary: { jobsDir, jobPath, compositionDir, entry } };
}
