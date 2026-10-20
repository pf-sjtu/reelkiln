import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as voice from "../src/main/engine/voice-guard";
import * as ctx from "../src/main/engine/session-context.generated";
import * as money from "../src/main/engine/money-compat.generated";
import { engineSessionEnv, SessionRegistry, isClientJobId } from "../src/main/engine/session";
import { loadOriginalChunk } from "./original-loader";
import { evalOriginal, fnText } from "./original-source";

const ENGINE_SRC = join(process.cwd(), "../engine");

/** A minimal installed-engine dir: exactly the REQUIRED_SESSION_CONTEXT_FILES from repo/engine + a build digest. */
function fakeInstalledEngine(): { eng: string; ws: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), "vc-sess-"));
  const eng = join(root, "engine");
  for (const rel of Object.values(ctx.REQUIRED_SESSION_CONTEXT_FILES) as string[]) {
    if (rel === ".videoclaw-build-sha256") continue;
    mkdirSync(join(eng, rel, ".."), { recursive: true });
    cpSync(join(ENGINE_SRC, rel), join(eng, rel));
  }
  const sha = createHash("sha256").update("fake-tarball").digest("hex");
  writeFileSync(join(eng, ".videoclaw-build-sha256"), sha + "\n");
  const ws = join(root, "ws");
  mkdirSync(join(ws, ".claude"), { recursive: true });
  cpSync(join(eng, ".claude", "settings.json"), join(ws, ".claude", "settings.json"));
  return { eng, ws, sha };
}

test("voice-guard constants equal the shipped chunk exports (B, V)", async () => {
  const wb = await loadOriginalChunk("workbookContents");
  assert.deepEqual(voice.BANNED_USER_FACING_VOCABULARY, wb.B);
  assert.equal(voice.VOICE_GUARD, wb.V);
});

test("verbatim-slice modules are current (tools/gen-verbatim.mjs --check)", () => {
  execFileSync(process.execPath, ["tools/gen-verbatim.mjs", "--check"], { stdio: "pipe" });
});

test("validateEngineSessionContext accepts the real engine context files", () => {
  const { eng, sha } = fakeInstalledEngine();
  const h = ctx.validateInstalledEngineSessionContext(eng, sha);
  assert.equal(h.engineBuildSha256, sha);
  assert.match(h.laws, /^[0-9a-f]{64}$/);
  assert.throws(() => ctx.validateInstalledEngineSessionContext(eng, "0".repeat(64)), /no longer matches its verified bundle/);
  writeFileSync(join(eng, ".claude", "settings.json"), "{}");
  assert.throws(() => ctx.validateEngineSessionContext(eng), (e: any) => e.code === "VIDEOCLAW_SESSION_CONTEXT_INVALID" && /no hooks object/.test(e.message));
});

test("engineSessionEnv: differential vs original L9380 (epoch excluded)", () => {
  const { eng, ws, sha } = fakeInstalledEngine();
  const deps = { currentEngine: () => ({ path: eng, buildSha256: sha }), workspaceRoot: () => ws, enginePathEnv: (p: string) => `${p}/bin:/usr/bin` };
  const port = engineSessionEnv(deps);
  const orig = evalOriginal<any>(
    [fnText(/^function configuredGatewayEnv\(/), fnText(/^function engineSessionEnv\(/)].join("\n"),
    "engineSessionEnv",
    { engineGatewaySessionConfig: undefined, studioBundleSessionEnv: () => ({}), currentEngine: deps.currentEngine, workspaceRoot: ws ? () => ws : null,
      validateInstalledEngineSessionContext: ctx.validateInstalledEngineSessionContext, createHash, readFileSync, join, SessionContextError: ctx.SessionContextError,
      randomUUID, UV_PYTHON_POLICY_ENV: { UV_PYTHON_PREFERENCE: "only-managed" }, enginePath_: deps.enginePathEnv },
  )();
  delete port.VIDEOCLAW_CONTEXT_EPOCH; delete orig.VIDEOCLAW_CONTEXT_EPOCH;
  assert.deepEqual(port, orig);
  assert.equal(port.VIDEOCLAW_ENGINE, eng);
  assert.equal(port.VIDEOCLAW_FINAL_QA_AUTHORITY, "videoclaw.app-final-qa/v1");
  // gateway configured → URL + key
  const g = engineSessionEnv({ ...deps, gatewaySessionConfig: () => ({ gatewayUrl: "https://gw.example" }) }, "k1");
  assert.equal(g.VIDEOCLAW_GATEWAY_URL, "https://gw.example");
  assert.equal(g.VIDEOCLAW_API_KEY, "k1");
  // tampered workspace settings → SessionContextError
  writeFileSync(join(ws, ".claude", "settings.json"), "{}");
  assert.throws(() => engineSessionEnv(deps), /differ from the verified engine settings/);
  // no engine → only gateway/studio/qa
  assert.deepEqual(engineSessionEnv({ ...deps, currentEngine: () => null }), { VIDEOCLAW_FINAL_QA_AUTHORITY: "videoclaw.app-final-qa/v1" });
});

test("SessionRegistry: loadRegistry healing subset + listSessions ordering", () => {
  const root = mkdtempSync(join(tmpdir(), "vc-reg-"));
  const ws = join(root, "ws");
  mkdirSync(join(ws, "jobs", "job-ok"), { recursive: true });
  const file = join(root, "sessions.json");
  writeFileSync(file, JSON.stringify({
    clients: [{ clientId: "personal" }],
    sessions: [
      { sessionId: "a", cwd: ws, jobId: "job-ok", status: "running", createdAt: 1, sessionPlan: { x: 1 } },
      { sessionId: "b", cwd: ws, jobId: "job-missing", status: "idle", createdAt: 2, title: "New session" },
      { sessionId: "c", cwd: ws, jobId: "../evil", status: "idle", createdAt: 3 },
      { nope: true },
    ],
  }));
  const reg = new SessionRegistry(file, { now: () => 42 });
  assert.equal(reg.load(), true);
  const list = reg.listSessions();
  assert.deepEqual(list.map((s) => s.sessionId), ["c", "b", "a"]);
  const a: any = reg.liveSession("a")!;
  assert.equal(a.jobId, "job-ok");
  assert.equal(a.status, "idle");
  assert.equal(a.interruptedFromStatus, "running");
  assert.equal(a.interruptedAtMs, 42);
  assert.equal("sessionPlan" in a, false);
  assert.equal(reg.liveSession("b")!.jobId, undefined);
  assert.equal(reg.liveSession("b")!.title, "New video");
  assert.equal(reg.liveSession("c")!.jobId, undefined);
  assert.equal(isClientJobId("linux-e2e-20261020-a1b2c3"), true);
});

test("money compat: PAID_GEN_TOOLS/unpriced equal the chunk; inspect runs the engine python (stub)", { skip: process.platform === "win32" && "sh stub" }, async () => {
  const wb = await loadOriginalChunk("workbookContents");
  assert.deepEqual(money.unpricedPaidGenTools([], []), wb.u([], []));
  const eng = mkdtempSync(join(tmpdir(), "vc-money-"));
  mkdirSync(join(eng, ".venv", "bin"), { recursive: true });
  mkdirSync(join(eng, "tools"));
  writeFileSync(join(eng, "tools", "cost.py"), "");
  const prices = JSON.stringify(money.PAID_GEN_TOOLS);
  const contract = JSON.stringify({ commands: { plan: "videoclaw.cost-cli.plan/v1" }, schema: "videoclaw.cost-cli-capabilities/v2" });
  writeFileSync(join(eng, ".venv", "bin", "python"), `#!/bin/sh\nif [ "$1" = "-c" ]; then echo '{"prices": ${prices}, "perSecondKeys": [], "invalidPrices": [], "invalidPerSecondKeys": []}'; else echo '${contract}'; fi\n`);
  chmodSync(join(eng, ".venv", "bin", "python"), 0o755);
  const r = await money.inspectEngineMoneyCompatibility(eng);
  assert.deepEqual(r, { status: "compatible", capabilities: { plan: true, advisoryEstimate: false } });
  await money.assertEngineMoneyCompatibility(eng);
});
