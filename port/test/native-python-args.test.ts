// docs/38 M21: nativePythonArgs / machOHasArm64 (original L7145-7199) ported verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machOHasArm64, nativePythonArgs } from "../src/main/platform/python";

const macho = (cpu: number) => { const b = Buffer.alloc(64); b.writeUInt32LE(0xfeedfacf, 0); b.writeInt32LE(cpu, 4); return b; };
const fat = (cpus: number[]) => { const b = Buffer.alloc(8 + 20 * cpus.length); b.writeUInt32BE(0xcafebabe, 0); b.writeUInt32BE(cpus.length, 4); cpus.forEach((c, i) => b.writeInt32BE(c, 8 + 20 * i)); return b; };
const ARM64 = 16777228, X86_64 = 16777223;

test("machOHasArm64: thin/fat/not-Mach-O/missing (L7150)", () => {
  const d = mkdtempSync(join(tmpdir(), "vc-macho-"));
  const w = (n: string, b: Buffer) => { writeFileSync(join(d, n), b); return join(d, n); };
  assert.equal(machOHasArm64(w("arm", macho(ARM64))), true);
  assert.equal(machOHasArm64(w("x86", macho(X86_64))), false);
  assert.equal(machOHasArm64(w("fat", fat([X86_64, ARM64]))), true);
  assert.equal(machOHasArm64(w("fatx", fat([X86_64]))), false);
  assert.equal(machOHasArm64(w("elf", Buffer.from("\x7fELF\x02\x01\x01\x00padding"))), undefined);
  assert.equal(machOHasArm64(join(d, "missing")), undefined);
  if (process.platform === "darwin" && process.arch === "arm64") assert.equal(machOHasArm64(process.execPath), true);
});

test("nativePythonArgs: [] off darwin-arm64; forces cpython-…-macos-aarch64 when venv + found python are x86_64 (L7172)", { skip: process.platform === "win32" && "fake uv is a sh script" }, async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-npa-"));
  const proj = join(d, "proj"); mkdirSync(join(proj, ".venv", "bin"), { recursive: true });
  writeFileSync(join(proj, ".venv", "bin", "python3"), macho(X86_64));
  const sysPy = join(d, "python3.12"); writeFileSync(sysPy, macho(X86_64));
  const uv = join(d, "uv");
  writeFileSync(uv, `#!/bin/sh\ncase "$*" in *--show-version*) echo "\${FAKE_VER}" ;; *) echo "${sysPy}" ;; esac\n`); chmodSync(uv, 0o755);
  const env = { ...process.env, FAKE_VER: "3.12.4" };
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env }, { platform: "linux", arch: "x64" }), []);
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env }, { platform: "darwin", arch: "x64" }), []);
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env }, { platform: "darwin", arch: "arm64" }), ["--python", "cpython-3.12.4-macos-aarch64"]);
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env: { ...env, FAKE_VER: "3.13" } }, { platform: "darwin", arch: "arm64" }), ["--python", "cpython-3.13-macos-aarch64"]);
  writeFileSync(join(proj, ".venv", "bin", "python3"), macho(ARM64));
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env }, { platform: "darwin", arch: "arm64" }), [], "own venv already arm64");
  writeFileSync(sysPy, fat([X86_64, ARM64])); writeFileSync(join(proj, ".venv", "bin", "python3"), "not macho");
  assert.deepEqual(await nativePythonArgs(uv, { project: proj, env }, { platform: "darwin", arch: "arm64" }), [], "found python has arm64 slice");
  assert.deepEqual(await nativePythonArgs(join(d, "nope"), { project: proj, env }, { platform: "darwin", arch: "arm64" }), [], "uv failure → []");
});
