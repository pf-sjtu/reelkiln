// docs/35 §1: the Windows venv startup hook that maps a bare "npx"/"npm" argv[0] (engine compose_render.py) onto
// node + npm's own npx-cli.js. The hook is exercised here with its win32 guard forced on (POSIX box).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWindowsExecShim, WIN_EXEC_PY, WIN_EXEC_PTH, WIN_EXEC_MODULE } from "../src/main/engine/win-exec-shim";

test("win exec shim: written idempotently into .venv/Lib/site-packages as a .pth import", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-winexec-")));
  try {
    const site = writeWindowsExecShim(root);
    assert.equal(site, join(root, ".venv", "Lib", "site-packages"));
    assert.equal(readFileSync(join(site, WIN_EXEC_PTH), "utf8"), `import ${WIN_EXEC_MODULE}\n`);
    assert.equal(readFileSync(join(site, `${WIN_EXEC_MODULE}.py`), "utf8"), WIN_EXEC_PY);
    writeWindowsExecShim(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("win exec shim: bare npx → node <node dir>/node_modules/npm/bin/npx-cli.js, args (JSON props) untouched, no shell", { skip: process.platform === "win32" }, () => {
  let py = "python3"; try { execFileSync(py, ["--version"]); } catch { return; }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-winexec-")));
  try {
    const nodeDir = join(root, "nodedir"); mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "");
    writeFileSync(join(nodeDir, "node"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n"); chmodSync(join(nodeDir, "node"), 0o755);
    const mod = join(root, "mod"); mkdirSync(mod);
    writeFileSync(join(mod, `${WIN_EXEC_MODULE}.py`), WIN_EXEC_PY.replace('if sys.platform == "win32":', "if True:"));
    const props = '--props={"title":"a & b | 100% ^x","p":"C:\\\\x y"}';
    const out = execFileSync(py, ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(mod)}); import ${WIN_EXEC_MODULE}, subprocess; r = subprocess.run(["npx", "--no-install", "remotion", sys.argv[1]], capture_output=True, text=True); print(r.stdout, end="")`, props], { env: { PATH: `${nodeDir}:/usr/bin:/bin` }, encoding: "utf8" });
    assert.deepEqual(out.trim().split("\n"), [join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"), "--no-install", "remotion", props]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
