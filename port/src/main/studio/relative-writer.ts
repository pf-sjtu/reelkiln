// Node re-implementation of RELATIVE_WRITER (main/index.js L2864-2918, a `/bin/sh -c` script)
// and the loop of writeProjectStream (L2920-2996) that drives it.
//
// Original protocol (argv: $1 expected "dev:ino" of cwd, $2 final name, $3 platform,
// $4 staging name, $5 ulimit -f blocks; fd3 = publish control line):
//   73 cwd identity changed · 74 unsupported platform · 75 name already exists (retry next
//   candidate) · 76 stream/publish-control failure · 77 interrupted · 78 publish failed.
//   staging is created with noclobber (`set -C`, umask 077), filled via `dd conv=fsync`,
//   then published WITHOUT overwrite: darwin renamex_np(RENAME_EXCL), linux `ln` (hard link),
//   staging removed afterwards.
//
// Port mapping (PORT-NEW, the shell script cannot run on Windows without MSYS):
//   identity  → fs.statSync(dir,{bigint:true}) `${dev}:${ino}` (NTFS: volume serial + file id)
//   noclobber → open(staging, "wx", 0o600)
//   dd fsync  → stream write + fsyncSync
//   publish   → linkSync(staging, target) (EEXIST → 75); if hard links are unsupported
//               (EPERM/ENOTSUP/EXDEV, e.g. FAT/exFAT) → copyFileSync(COPYFILE_EXCL)
//   ulimit -f → optional byte limit (original passes "0" = unlimited at its only call site)
// WEAKER THAN ORIGINAL (documented in docs/10): the shell ran with cwd = the attested directory
// and used relative names only, so a directory swap after attestation was caught by the
// identity check *inside* that cwd. Node cannot chdir per call (process-wide) and has no
// openat(); the port re-attests the directory identity immediately before create and before
// publish, which narrows but does not close the TOCTOU window.
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";

export const RELATIVE_WRITER_CODES = { identityChanged: 73, unsupported: 74, exists: 75, stream: 76, interrupted: 77, publish: 78 } as const;

export function dirIdentity(path: string): string {
  const s = statSync(path, { bigint: true });
  return `${s.dev}:${s.ino}`;
}

export function candidateName(preferred: string, attempt: number): string { // L2651
  if (attempt === 0) return preferred;
  const ext = extname(preferred);
  return `${basename(preferred, ext)}_${attempt}${ext}`;
}

/** One RELATIVE_WRITER invocation. Returns the would-be shell exit code. */
export async function relativeWrite(o: {
  dir: string; expectedIdentity: string; name: string; stagingName: string;
  input: AsyncIterable<Uint8Array | string>; limitBytes?: number;
}): Promise<{ code: number; streamError?: unknown }> {
  const C = RELATIVE_WRITER_CODES;
  if (dirIdentity(o.dir) !== o.expectedIdentity) return { code: C.identityChanged };
  const staging = join(o.dir, o.stagingName);
  const target = join(o.dir, o.name);
  let fd: number;
  try {
    fd = openSync(staging, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch {
    return { code: existsSync(staging) || isLink(staging) ? C.exists : C.publish };
  }
  let published = false;
  try {
    let total = 0;
    try {
      for await (const chunk of o.input) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        total += buf.length;
        if (o.limitBytes && o.limitBytes > 0 && total > o.limitBytes) throw new Error("File size limit exceeded");
        writeSync(fd, buf);
      }
      fsyncSync(fd);
    } catch (streamError) {
      return { code: C.stream, streamError };
    } finally {
      closeSync(fd);
    }
    if (dirIdentity(o.dir) !== o.expectedIdentity) return { code: C.identityChanged }; // PORT: re-attest before publish
    try {
      linkSync(staging, target);
    } catch (e: any) {
      if (e?.code === "EEXIST" || existsSync(target) || isLink(target)) return { code: C.exists };
      if (["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"].includes(e?.code)) {
        try { copyFileSync(staging, target, constants.COPYFILE_EXCL); } catch (e2: any) {
          return { code: e2?.code === "EEXIST" ? C.exists : C.publish };
        }
      } else {
        return { code: C.publish };
      }
    }
    published = true;
    return { code: 0 };
  } finally {
    try { unlinkSync(staging); } catch {}
    void published;
  }
}
function isLink(p: string) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

/** writeProjectStream (L2920) loop + identical error strings. Directory attestation helpers
 *  (prepareConfinedProjectDirectory L2656 / reattestWriteDirectory L2666) are injected. */
export async function writeProjectStream(o: {
  prepare: () => { path: string; identity: string };
  reattest: (dir: { path: string; identity: string }) => void;
  preferredName: string;
  input: () => AsyncIterable<Uint8Array | string>;
}): Promise<string> {
  const directory = o.prepare();
  for (let attempt = 0; attempt < 1e3; attempt += 1) {
    const name = candidateName(o.preferredName, attempt);
    const target = join(directory.path, name);
    if (existsSync(target)) continue;
    const stagingName = `.videoclaw-write-${randomUUID()}`;
    const { code, streamError } = await relativeWrite({ dir: directory.path, expectedIdentity: directory.identity, name, stagingName, input: o.input() });
    if (code === 73) throw new Error("Studio destination changed before the relative write.");
    if (code === 74) throw new Error("Studio relative-write helper is unsupported on this platform.");
    if (code === 75) continue;
    if (code === 76) throw streamError ?? new Error("Studio relative write failed before the file was published.");
    if (code === 77) throw new Error("Studio relative write was interrupted before publication.");
    if (code === 78) throw new Error("Studio could not publish the completed file in this directory.");
    o.reattest(directory);
    const written = lstatSync(target);
    if (!written.isFile() || written.isSymbolicLink()) throw new Error("Studio target is not a regular file.");
    return target;
  }
  throw new Error("Studio could not allocate a unique destination filename.");
}
