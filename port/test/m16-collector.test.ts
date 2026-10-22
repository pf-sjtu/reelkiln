// docs/33 M16 task 1: the accepted-operation collector's busy / late-result / collectorOwned parts (L39793-40527,
// L52670), driven through AgentHost against a FAKE engine (tools/_operations.py + tools/log.py stand-ins written by
// the test; python3 runs them, including the original BUSY_COLLECTOR wrapper). No gateway, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { AgentHost } from "../src/main/agent/agent-host";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { readDisplayTranscript, displayTranscriptPath } from "../src/main/agent/history.generated";
import { busyCollectorArgs, readOperationJournal, lateResultReportNote, savedGatewayOperations } from "../src/main/agent/operation-journal.generated";

const WIN = process.platform === "win32";
const PY = (() => {
  if (WIN) { try { return execFileSync("python", ["-c", "import sys; print(sys.executable)"]).toString().trim(); } catch { return ""; } }
  for (const p of ["/usr/bin/python3", "/usr/local/bin/python3"]) if (existsSync(p)) return p; try { return execFileSync("which", ["python3"]).toString().trim(); } catch { return ""; }
})();
// PORT-WIN docs/36 (W14): on Windows the fake engine gets a real `python -m venv --without-pip` (.venv\Scripts\python.exe,
// what venvPython() resolves) instead of a POSIX symlink; the fake job lock skips the directory fd (os.open(dir) is POSIX-only).
const SKIP_COLLECTOR: boolean | string = !PY ? true : false;
const GW = "http://127.0.0.1:1";
const OPS = `import json, os, sys
from pathlib import Path
from log import job_lock_at
def collect_command(argv):
    job = Path(argv[argv.index("--job") + 1]); op = argv[argv.index("--operation-id") + 1]
    fd = os.open(job, os.O_RDONLY) if os.name != "nt" else -1
    with job_lock_at(fd):
        return _collect(job, op, argv)
def _collect(job, op, argv):
    plan = json.loads((job / "fake-collector.json").read_text())
    (job / "fake-collector-argv.json").write_text(json.dumps({"argv": argv, "busyEnv": os.environ.get("VIDEOCLAW_COLLECTOR_DELIVERY")}))
    if plan.get("exit"):
        print(json.dumps({"operation_id": op, "status": "recovery_required", "error": plan.get("error", "boom")})); return plan["exit"]
    rec_path = job / "operations" / f"{op}.json"; rec = json.loads(rec_path.read_text())
    if plan["status"] == "succeeded":
        (job / "incoming").mkdir(exist_ok=True); out = rec["outputs"][0]; (job / out).write_bytes(b"ID3fake")
        rec["delivered"] = {out: {"state": "delivered", "bytes": 7}}
    rec["result"] = {"status": plan["status"], "cost_usd": plan.get("cost", 0.001), **({"error": plan["error"]} if plan.get("error") else {})}
    rec_path.write_text(json.dumps(rec))
    completion = {"operation_id": op, "status": plan["status"], "model": "minimax/speech-2.8-turbo", "saved": [str(job / rec["outputs"][0])] if plan["status"] == "succeeded" else [], "cost_usd": plan.get("cost", 0.001)}
    print(json.dumps({"operation_id": op, "status": plan["status"], "complete": True, "completion": completion})); return 0
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(collect_command(sys.argv[1:]))
`;
const LOG = `import contextlib, os
class JobLockTimeout(TimeoutError):
    pass
@contextlib.contextmanager
def job_lock_at(job_fd, timeout=None):
    if os.path.exists(os.path.join(os.environ["FAKE_LOCK_DIR"], "locked")):
        raise JobLockTimeout()
    yield
`;

function setup() {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-m16-col-"));
  const engine = join(root, "engine"); mkdirSync(join(engine, "tools"), { recursive: true });
  if (WIN) execFileSync(PY, ["-m", "venv", "--without-pip", join(engine, ".venv")]);
  else { mkdirSync(join(engine, ".venv", "bin"), { recursive: true }); symlinkSync(PY, join(engine, ".venv", "bin", "python")); }
  writeFileSync(join(engine, "tools", "_operations.py"), OPS); writeFileSync(join(engine, "tools", "log.py"), LOG);
  process.env.FAKE_LOCK_DIR = root;
  const ws = join(root, "ws"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "ud"); mkdirSync(ud);
  const events: any[] = []; const delivered: any[] = [];
  const proxy = { auxiliaryCredentials: () => ({ gatewayKey: "vcs_fake", gatewayUrl: GW }), revokeCredential: () => {} };
  const host = new AgentHost({
    emit: { sessionEvent: (sid: string, e: any) => events.push({ sid, ...e }), sessionsChanged: () => {}, permissionRequest: () => {} } as any,
    service: { newSessionLlmRoute: () => "minimax" } as any, loadSdk: async () => { throw new Error("unused"); }, sessionsRoot: join(root, "s"), persist: () => {}, stateDir: ud,
    engine: { workspaceRoot: () => ws, currentEngine: () => ({ path: engine, version: "0" }), engineSessionEnv: () => ({ PATH: process.env.PATH }), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "" } as any,
    registry: { addTrashWorkspace: () => {}, flush: () => true, markRemoved: () => {}, unmarkRemoved: () => {} },
    agentGatewayProxy: () => proxy as any, gatewaySettings: () => ({ gatewayUrl: GW, gatewayKey: "vc_testkey_m16" }), operationSweepMs: 0,
  } as any);
  (host as any).deliver = async (s: any, input: any) => { delivered.push({ sid: s.meta.sessionId, text: input.msg.message.content[0].text, displayTexts: input.displayTexts }); return true; };
  const video = (jobId = `job-${randomUUID().slice(0, 6)}`) => {
    const m = host.createSession({});
    const s = (host as any).sessions.get(m.sessionId);
    mkdirSync(join(ws, "jobs", jobId, "operations"), { recursive: true });
    host.commitBind(s, jobId, "test", false);
    const jobPath = join(ws, "jobs", jobId);
    const addOp = (o: { createdAt?: number; status?: string; delivered?: boolean } = {}) => {
      const id = randomUUID(); const path = "/v1/model_call"; const body = JSON.stringify({ model: "minimax/speech-2.8-turbo", input: { text: "x" } });
      const sha256 = createHash("sha256").update(`videoclaw-spend-operation/v1\0POST\0${path}\0`).update(body).digest("hex");
      const owner = { account_id: "a".repeat(64), gateway_url: GW, environment: "local", project_id: s.meta.clientId, client_job: jobId };
      const out = `incoming/model-${id.replaceAll("-", "")}.mp3`;
      const rec: any = { schema: "videoclaw.local-operation/v1", id, path, sha256, body, owner, outputs: [out] };
      if (o.status) rec.result = { status: o.status, cost_usd: 0.001 };
      if (o.delivered) { mkdirSync(join(jobPath, "incoming"), { recursive: true }); writeFileSync(join(jobPath, out), "ID3fake"); rec.delivered = { [out]: { state: "delivered", bytes: 7 } }; }
      writeFileSync(join(jobPath, "operations", `${id}.json`), JSON.stringify(rec));
      const row = { id, path, sha256, owner, cwd: s.meta.cwd, createdAt: o.createdAt ?? Date.now() };
      s.meta.acceptedOperations = [...(s.meta.acceptedOperations ?? []), row];
      return row;
    };
    const plan = (p: any) => writeFileSync(join(jobPath, "fake-collector.json"), JSON.stringify(p));
    const argv = () => JSON.parse(readFileSync(join(jobPath, "fake-collector-argv.json"), "utf8"));
    const lateRows = () => readDisplayTranscript(displayTranscriptPath(ud, m.sessionId)).ordered.filter((r: any) => r.kind === "late_result").map((r: any) => r.line);
    return { s, sid: m.sessionId, jobPath, addOp, plan, argv, lateRows };
  };
  return { root, host, events, delivered, video, done: () => { const watched = (host as any).watchers.size; host.closeAll(); assert.equal((host as any).watchers.size, 0, `closeAll retired ${watched} job watcher(s)`); rmSync(root, { recursive: true, force: true }); } }; // docs/40 M23: closeAll retires the job watchers (L45572)
}

test("M16 idle collection: collectorOwned mark → late 'arrived' line (sidecar + live event) → one report-only turn that refuses spend", { skip: SKIP_COLLECTOR }, async () => {
  const h = setup();
  try {
    const v = h.video(); const op = v.addOp(); v.plan({ status: "succeeded", cost: 0.0004 });
    const started = h.host.collectAcceptedOperations();
    assert.deepEqual(v.s.meta.acceptedOperations[0].collectorOwned, { delivered: [] }, "the mark is taken (and flushed) before the collector runs");
    await Promise.all(started);
    assert.equal(v.argv().argv[0], "--job", "an idle video runs the plain collector (no busy wrapper)");
    assert.equal(v.s.meta.acceptedOperations.length, 0);
    const lines = v.lateRows();
    assert.equal(lines.length, 1); assert.equal(lines[0].outcome, "arrived"); assert.equal(lines[0].operationId, op.id); assert.equal(lines[0].costUsd, 0.0004);
    assert.deepEqual(lines[0].files, [`incoming/model-${op.id.replaceAll("-", "")}.mp3`]);
    assert.equal(h.events.filter((e) => e.kind === "late_result").length, 1);
    assert.equal(h.delivered.length, 1, "exactly one report turn");
    assert.equal(h.delivered[0].displayTexts.length, 0, "the note is invisible");
    assert.match(h.delivered[0].text, /^\[APP NOTE, not from the user; do not quote it\] A result the user already paid for arrived/);
    assert.match(h.delivered[0].text, /"completed_model_results"/);
    const refusal = await h.host.authorizeGatewaySpend(v.s, { jobId: v.s.meta.jobId, method: "POST", path: "/v1/model_call", body: Buffer.from("{}"), quote: {} });
    assert.equal(refusal.allowed, false); assert.match(refusal.reason, /only reports a result/);
    (h.host as any).setStatus(v.s, "idle");
    assert.equal(v.s.reportTurn, undefined, "the report turn settles at idle");
    // a second sweep owes nothing: no duplicate line, no second report
    h.host.writeLateResultLines(v.s); h.host.reportLateResults(v.s);
    assert.equal(v.lateRows().length, 1); assert.equal(h.delivered.length, 1);
  } finally { h.done(); }
});

test("M16 busy collection: BUSY_COLLECTOR wrapper, lock_busy leaves the row untouched; an operation the open tool may own gets no late line", { skip: SKIP_COLLECTOR }, async () => {
  const h = setup();
  try {
    const v = h.video(); v.s.openTools.add("toolu_1"); (v.s.openToolStartedAt ??= new Map()).set("toolu_1", Date.now() - 2000);
    const op = v.addOp(); v.plan({ status: "succeeded" });
    writeFileSync(join(h.root, "locked"), "1");
    await Promise.all(h.host.collectAcceptedOperations());
    assert.equal(v.s.meta.acceptedOperations.length, 1, "lock_busy: still owed");
    assert.equal(v.s.meta.acceptedOperations[0].recoveryFailures, undefined, "lock_busy is not a failure");
    assert.equal(v.s.meta.acceptedOperations[0].collectorOwned, undefined, "no mark while a tool is open");
    rmSync(join(h.root, "locked"));
    await Promise.all(h.host.collectAcceptedOperations());
    assert.equal(v.s.meta.acceptedOperations.length, 0);
    assert.equal(v.lateRows().length, 0, "the open tool publishes its own result");
    assert.equal(h.delivered.length, 0);
    assert.equal(v.s.meta.completedModelResults[0].result.operation_id, op.id);
  } finally { h.done(); }
});

test("M16 busy collection of an operation older than every open tool is late (mayBelongToOpenTool margin)", { skip: SKIP_COLLECTOR }, async () => {
  const h = setup();
  try {
    const v = h.video(); v.s.openTools.add("toolu_2"); (v.s.openToolStartedAt ??= new Map()).set("toolu_2", Date.now());
    v.addOp({ createdAt: Date.now() - 60_000, status: "running" }); v.plan({ status: "succeeded" });
    await Promise.all(h.host.collectAcceptedOperations());
    assert.equal(v.lateRows().length, 1, "accepted >10s before the oldest open tool → not that tool's");
    assert.equal(h.delivered.length, 0, "no report while a tool is open (reportLateResults waits for idle)");
    assert.deepEqual(v.s.meta.lateResultReports?.length, 1);
    v.s.openTools.clear(); h.host.reportLateResults(v.s);
    assert.equal(h.delivered.length, 1);
  } finally { h.done(); }
});

test("M16 dropCollectorMarks: a tool start drops a mark the journal has not moved past; restore drops backoff + parking", { skip: SKIP_COLLECTOR }, async () => {
  const h = setup();
  try {
    const v = h.video(); const row = v.addOp(); (row as any).collectorOwned = { delivered: [] };
    const rt = { dead: false, handle: {}, queue: [] }; v.s.runtime = rt;
    (h.host as any).reduce(v.s, { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "ls" } }] } }, rt);
    v.s.runtime = undefined;
    assert.equal(v.s.meta.acceptedOperations[0].collectorOwned, undefined);
    assert.ok(v.s.openToolStartedAt.get("toolu_3"));
    const rows = h.host.registryRows().map((r: any) => r.sessionId === v.sid ? { ...r, sessionId: "restored-1", acceptedOperations: [{ ...r.acceptedOperations[0], nextRecoveryAt: Date.now() + 1e6, recoveryParked: { engine: "/x" } }], lateResultLines: [{ bogus: 1 }] } : null).filter(Boolean);
    h.host.restoreSessions(rows as any);
    const restored = (h.host as any).sessions.get("restored-1");
    assert.equal(restored.meta.acceptedOperations[0].nextRecoveryAt, undefined); assert.equal(restored.meta.acceptedOperations[0].recoveryParked, undefined);
    assert.equal(restored.meta.lateResultLines, undefined, "invalid late lines are dropped on load");
    assert.equal(savedGatewayOperations(restored.meta).length, 1);
  } finally { h.done(); }
});

test("M16 a provider failure the collector learned → late 'failed' line + failure report; three import failures → import_failed", { skip: SKIP_COLLECTOR }, async () => {
  const h = setup();
  try {
    const v = h.video(); v.addOp({ status: "running" }); v.plan({ status: "failed", error: "MiniMax video task failed", cost: 0 });
    await Promise.all(h.host.collectAcceptedOperations());
    const line = v.lateRows()[0];
    assert.equal(line.outcome, "failed"); assert.equal(line.providerReason, "MiniMax video task failed");
    assert.match(h.delivered[0].text, /failed at the provider with no result; nothing was charged/);
    (h.host as any).setStatus(v.s, "idle");
    // import failures: the journal says succeeded (delivered nothing) and the collector keeps failing
    const w = h.video(); const op = w.addOp({ status: "succeeded" }); w.plan({ exit: 3, error: "disk full" });
    for (let i = 0; i < 3; i++) { w.s.meta.acceptedOperations[0].nextRecoveryAt = 0; await Promise.all(h.host.collectAcceptedOperations()); }
    assert.equal(w.s.meta.acceptedOperations[0].recoveryFailures, 3);
    const l2 = w.lateRows();
    assert.equal(l2.length, 1); assert.equal(l2[0].outcome, "import_failed"); assert.equal(l2[0].reason, "import_error"); assert.equal(l2[0].operationId, op.id);
    assert.match(h.delivered.at(-1).text, /could not save it into the video after repeated tries \(the import step keeps failing\)/);
  } finally { h.done(); }
});

test("M16 verbatim helpers: busyCollectorArgs / readOperationJournal / lateResultReportNote", () => {
  const a = busyCollectorArgs("/e/tools/_operations.py", ["--job", "/j"], "collect");
  assert.equal(a[0], "-c"); assert.match(a[1], /log\.job_lock_at = bounded/); assert.deepEqual(a.slice(2), ["collect", "/e/tools/_operations.py", "--job", "/j"]);
  assert.equal(readOperationJournal("/nonexistent", { id: "x", path: "/v1/model_call", sha256: "0", owner: {} }), undefined);
  assert.equal(lateResultReportNote([], "/w", []), undefined);
});
