// docs/40 M23: the Rosetta branch of nativePythonArgs (original L7172) for REAL on Apple silicon (macos-latest):
// an x86_64 CPython (uv's macos-x86_64 build) is the only managed interpreter and the project's venv python is
// x86_64 → the original forces `--python cpython-X.Y.Z-macos-aarch64`; uv then resolves that request to an arm64
// interpreter. Enabled with VIDEOCLAW_TEST_ROSETTA=1 + VIDEOCLAW_TEST_UV (+ UV_PYTHON_INSTALL_DIR holding only x86_64).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machOHasArm64, nativePythonArgs } from "../src/main/platform/python";

const on = process.platform === "darwin" && process.arch === "arm64" && process.env.VIDEOCLAW_TEST_ROSETTA === "1" && !!process.env.VIDEOCLAW_TEST_UV;
test("Rosetta: x86_64 venv + x86_64 managed python on arm64 → --python cpython-…-macos-aarch64 → uv resolves an arm64 interpreter", { skip: !on && "macOS arm64 + VIDEOCLAW_TEST_ROSETTA=1 only" }, async () => {
  const uv = process.env.VIDEOCLAW_TEST_UV!;
  const env = { ...process.env, UV_PYTHON_PREFERENCE: "only-managed" };
  const x86 = realpathSync(execFileSync(uv, ["python", "find", "--system"], { env }).toString().trim());
  assert.equal(machOHasArm64(x86), false, `${x86} must be x86_64-only`);
  const machine = execFileSync("arch", ["-x86_64", x86, "-c", "import platform; print(platform.machine())"]).toString().trim();
  assert.equal(machine, "x86_64", "the x86_64 interpreter runs under Rosetta");
  const project = mkdtempSync(join(tmpdir(), "vc-rosetta-")); mkdirSync(join(project, ".venv", "bin"), { recursive: true });
  symlinkSync(x86, join(project, ".venv", "bin", "python3"));
  const args = await nativePythonArgs(uv, { cwd: project, project, env });
  const version = execFileSync(x86, ["-c", "import platform; print(platform.python_version())"]).toString().trim();
  console.log("# rosetta:", JSON.stringify({ x86, machine, version, args }));
  assert.deepEqual(args, ["--python", `cpython-${version}-macos-aarch64`]);
  execFileSync(uv, ["python", "install", args[1]], { env, stdio: "inherit" });
  const arm = realpathSync(execFileSync(uv, ["python", "find", args[1]], { env }).toString().trim());
  assert.equal(machOHasArm64(arm), true, `${arm} is arm64`);
  assert.equal(execFileSync(arm, ["-c", "import platform; print(platform.machine())"]).toString().trim(), "arm64");
  // with an arm64 venv the original returns [] (ownVenv === true)
  const p2 = mkdtempSync(join(tmpdir(), "vc-rosetta2-")); mkdirSync(join(p2, ".venv", "bin"), { recursive: true }); symlinkSync(arm, join(p2, ".venv", "bin", "python3"));
  assert.deepEqual(await nativePythonArgs(uv, { cwd: p2, project: p2, env }), []);
});
