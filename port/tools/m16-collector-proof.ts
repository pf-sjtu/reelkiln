// docs/33 M16 task 1 — the collector's busy / late-result / collectorOwned parts through the REAL app code paths
// (derived from tools/m15-recovery-proof.ts; same verbatim proxy, real read-only engine _model_call.py/_operations.py,
// the shim in its own process). Scenarios:
//   late-arrival  — engine SIGKILLed mid-TTS, video idle → collectorOwned mark → late "arrived" chat line (display
//                   transcript + live late_result event) → report-only turn (note captured; spend refused meanwhile)
//   busy-lock     — an open tool + the job lock held by another process → BUSY_COLLECTOR wrapper → lock_busy (no
//                   failure counted) → lock released → collected; the operation may belong to the open tool → no line
//   late-failure  — video task in flight, engine killed, provider fails → late "failed" line + failure report note
// --mode fake (FAKE MiniMax upstream in the shim child) runs all; --mode real runs ONLY late-arrival (one real TTS).
// (header of the M15 harness follows)
// docs/32 M15 task 2 — interrupt recovery and Stop-cancellation through the REAL app code paths:
//   AgentHost.agentGatewayPolicy (rememberOperation → acceptedOperations), the verbatim AgentGatewayProxy, the real
//   read-only engine's tools/_model_call.py and tools/_operations.py (run by AgentHost.collectAcceptedOperations with
//   a recovery-only proxy capability), and the local gateway shim running in its OWN process (tools/m15-shim-child.ts)
//   so it can be SIGKILLed mid-operation and restarted on the same ledger.
// Scenarios: engine-kill (sync TTS) · gateway-kill (video task in flight → resume by polling) · stop-cancel (queued
// video → MiniMax DELETE cancel) — fake mode; --mode real runs ONLY engine-kill with one real TTS call.
//   npx tsx tools/m15-recovery-proof.ts <outDir> --engine ENGINE --mode fake|real [--scenarios a,b,c]
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHost } from "../src/main/agent/agent-host";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { engineSessionEnv } from "../src/main/engine/session";
import { createLogger, setLoggerForTests, redactText, registerSecret } from "../src/main/llm/logger";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outDir = resolve(process.argv[2] ?? "m16-proof"); mkdirSync(outDir, { recursive: true });
const ENGINE = resolve(arg("--engine") ?? "");
const MODE = arg("--mode", "fake")!;
const SCEN = (arg("--scenarios", MODE === "real" ? "late-arrival" : "late-arrival,busy-lock,late-failure") ?? "").split(",");
const realKey = process.env.MINIMAX_API_KEY;
for (const k of Object.keys(process.env)) if (k.startsWith("__CURSOR_SANDBOX")) delete process.env[k];
if (MODE === "real" && !realKey) { console.error("MINIMAX_API_KEY missing"); process.exit(2); }
if (realKey) registerSecret(realKey);
const scrub = (s: string) => (realKey ? s.split(realKey).join("[MINIMAX_API_KEY]") : s);
const events: any[] = [];
setLoggerForTests(createLogger({ level: "info", sink: (e: any) => { if (/^agent\.(paid|spend|beacon)/.test(e.event)) events.push(e); } } as any));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const say = (m: string) => console.log(scrub(`[m16-proof ${new Date().toISOString().slice(11, 19)}Z] ${m}`));

async function until<T>(f: () => T | undefined | false, what: string, ms = 60_000): Promise<T> { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(100); } }

(async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m16-proof-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true }); mkdirSync(join(ws, ".claude"), { recursive: true });
  writeFileSync(join(ws, ".claude", "settings.json"), readFileSync(join(ENGINE, "..", "..", "..", "ws", ".claude", "settings.json")));
  const lg = join(root, "lg"); mkdirSync(join(lg, "fake"), { recursive: true });
  const port = 47790 + Math.floor(Math.random() * 100);
  const knob = (k: string, v: string) => writeFileSync(join(lg, "fake", k), v);
  const childEnv = () => { const e: Record<string, string> = { ...(process.env as any) }; if (MODE !== "real") delete e.MINIMAX_API_KEY; return e; };
  let shimChild: ChildProcess | undefined;
  // one plain node process (no tsx relay parent) so SIGKILL really kills the gateway
  const shimBundle = join(root, "m15-shim-child.cjs");
  execFileSync(join(process.cwd(), "node_modules", ".bin", "esbuild"), [join(process.cwd(), "tools", "m15-shim-child.ts"), "--bundle", "--platform=node", "--format=cjs", "--log-level=warning", `--outfile=${shimBundle}`]);
  const startShim = async () => {
    const c = spawn(process.execPath, [shimBundle, lg, String(port), MODE], { env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout!.on("data", (b) => { out += b; }); c.stderr!.on("data", (b) => process.stderr.write(scrub(String(b))));
    await until(() => out.includes('"ready":true'), "shim ready", 60_000);
    shimChild = c; return JSON.parse(out.trim().split("\n")[0]).url as string;
  };
  const killShim = async () => { shimChild!.kill("SIGKILL"); await new Promise((r) => shimChild!.once("exit", r)); };
  const sessionEvents: any[] = [];
  const url = await startShim();
  const key = readFileSync(join(lg, "vc-key"), "utf8").trim();
  const proxy = await AgentGatewayProxy.start(url, key);
  const ledger = () => JSON.parse(readFileSync(join(lg, "ledger.json"), "utf8"));
  const paid = () => ledger().entries.filter((e: any) => e.kind === "paid_tool");
  const fakeCalls = () => { try { return readFileSync(join(lg, "fake", "calls.log"), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
  const engineCurrent = existsSync(join(ENGINE, "..", "..", "engine-current.json")) ? JSON.parse(readFileSync(join(ENGINE, "..", "..", "engine-current.json"), "utf8")) : { buildSha256: readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0] };
  const envDeps = { currentEngine: () => ({ path: ENGINE, buildSha256: engineCurrent.buildSha256 }), workspaceRoot: () => ws, enginePathEnv: (p: string) => `${join(p, "bin")}:${process.env.PATH}`, gatewaySessionConfig: () => ({ gatewayUrl: url }) };
  const host = new AgentHost({
    emit: { sessionEvent: (sid: string, e: any) => { sessionEvents.push({ sid, kind: e.kind, ...(e.kind === "late_result" ? { line: e.line } : e.kind === "status" ? { status: e.status } : {}) }); }, sessionsChanged: () => {}, permissionRequest: () => {} } as any,
    service: { newSessionLlmRoute: () => "minimax", llmRouteReadiness: async () => ({ ready: true }), sessionAgentRuntime: async () => { throw new Error("unused"); } } as any,
    loadSdk: async () => { throw new Error("unused"); }, sessionsRoot: join(root, "agent-sessions"), persist: () => {}, stateDir: join(root, "ud"),
    engine: { workspaceRoot: () => ws, currentEngine: () => ({ path: ENGINE, version: "0.1.57" }), engineSessionEnv: () => engineSessionEnv(envDeps as any), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "" } as any,
    registry: { addTrashWorkspace: () => {}, flush: () => true, markRemoved: () => {}, unmarkRemoved: () => {} },
    agentGatewayProxy: () => proxy, gatewaySettings: () => ({ gatewayUrl: url, gatewayKey: key }), operationSweepMs: 0,
  } as any);
  mkdirSync(join(root, "ud"), { recursive: true });
  const results: any = { mode: MODE, engine: ENGINE.split("/").pop(), scenarios: {} };

  const newVideo = (jobId: string) => {
    const m = host.createSession({ cwd: ws } as any);
    mkdirSync(join(ws, "jobs", jobId), { recursive: true });
    const s = (host as any).sessions.get(m.sessionId);
    s.meta.cwd = ws;
    host.commitBind(s, jobId, "test", false);
    const creds = proxy.credentials(m.sessionId, host.agentGatewayPolicy(s));
    const env: Record<string, string> = { ...engineSessionEnv(envDeps as any, creds.gatewayKey, creds.gatewayUrl), VIDEOCLAW_OPERATION_RECOVERY: "1", VIDEOCLAW_BOUND_JOB: jobId, VIDEOCLAW_WORKSPACE: ws, VIDEOCLAW_JOBS_DIR: join(ws, "jobs"), PYTHON_DOTENV_DISABLED: "1", PYTHONDONTWRITEBYTECODE: "1", PATH: process.env.PATH ?? "" };
    if (realKey && Object.values(env).some((v) => v.includes(realKey))) throw new Error("the MiniMax key must never reach the engine env");
    const jobPath = join(ws, "jobs", jobId);
    const runModel = (model_slug: string, input: Record<string, unknown>) => {
      let child!: ChildProcess;
      const done = new Promise<any>((res) => {
        child = execFile(join(ENGINE, ".venv", "bin", "python"), [join(ENGINE, "tools", "_model_call.py"), "--job", jobPath], { cwd: ws, env, timeout: 10 * 60_000, maxBuffer: 16 << 20 }, (e, out, err) => res(e ? { killed: true, signal: (e as any).signal, stderr: scrub(String(err)).slice(-300) } : JSON.parse(String(out))));
        child.stdin?.end(JSON.stringify({ model_slug, input }));
      });
      return { child, done };
    };
    return { sid: m.sessionId, s, jobPath, runModel };
  };
  const rows = (s: any) => (s.meta.acceptedOperations ?? []).map((r: any) => ({ id: r.id, cancelRequested: r.cancelRequested === true, recoveryFailures: r.recoveryFailures }));
  const opOf = (id: string) => ledger().operations?.[id];
  const collectUntilGone = async (v: any, label: string) => {
    const passes: any[] = [];
    for (let i = 0; i < 30 && (v.s.meta.acceptedOperations ?? []).length; i++) {
      for (const r of v.s.meta.acceptedOperations ?? []) r.nextRecoveryAt = 0; // the sweep's 15s·2^n backoff, compressed for the proof
      await Promise.all(host.collectAcceptedOperations());
      passes.push(rows(v.s));
      if ((v.s.meta.acceptedOperations ?? []).length) await sleep(1000);
    }
    say(`${label}: collector passes=${passes.length} left=${(v.s.meta.acceptedOperations ?? []).length}`);
    return passes.length;
  };
  const incoming = (jobPath: string) => { try { return readdirSync(join(jobPath, "incoming")).map((f) => { const b = readFileSync(join(jobPath, "incoming", f)); return { file: f, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex").slice(0, 16) }; }); } catch { return []; } };
  const ttsText = MODE === "real" ? "迟到结果测试：配音途中应用被强制结束，收集器取回原结果。" : "迟到结果测试的一段配音。";


  // the report-only turn's delivery is captured here (no LLM runtime in this proof: the note itself is the evidence)
  const delivered: any[] = [];
  (host as any).deliver = async (s: any, input: any) => { delivered.push({ sid: s.meta.sessionId, uuid: input.msg.uuid, displayTexts: input.displayTexts, text: input.msg.message.content[0].text }); return true; };
  const transcriptRows = (sid: string) => { try { return readFileSync(join(root, "ud", `${sid}.display.jsonl`), "utf8"); } catch { return ""; } };
  const lateRows = (sid: string) => { const { readDisplayTranscript, displayTranscriptPath } = require("../src/main/agent/history.generated"); return readDisplayTranscript(displayTranscriptPath(join(root, "ud"), sid)).ordered.filter((r: any) => r.kind === "late_result").map((r: any) => r.line); };
  const collectorStarts = (opId: string) => events.filter((e) => e.event === "agent.paid.collector_started" && e.operationId === opId).map((e) => ({ busy: e.busy, wrapper: e.wrapper, collectorOwned: e.collectorOwned, deferPublication: e.deferPublication }));
  const collectedEv = (opId: string) => events.filter((e) => e.event === "agent.paid.operation_collected" && e.operationId === opId).map((e) => ({ status: e.status, complete: e.complete, busy: e.busy }));
  const quote = { tool: "model_call", maximumUsd: 0.001, quoteId: "vsq_3.x" };

  // ── A. late arrival: engine killed mid-TTS while the video is idle → collectorOwned → late line → report-only turn
  if (SCEN.includes("late-arrival")) {
    knob("tts-delay-ms", "4000");
    const v = newVideo(`m16-la-${Date.now().toString(36)}`);
    const paidBefore = paid().length;
    const run = v.runModel("minimax/speech-2.8-turbo", { text: ttsText, voice_id: "female-shaonv" });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.phase === "sent" || opOf(opId)?.status === "succeeded", "sent to MiniMax");
    run.child.kill("SIGKILL"); const engineOut = await run.done;
    await until(() => opOf(opId)?.status !== "running", "shim settles", 120_000);
    const statusBefore = v.s.meta.status;
    const passes = await collectUntilGone(v, "late-arrival");
    await sleep(300);
    const lines = lateRows(v.sid);
    const report = delivered.find((d) => d.sid === v.sid);
    // during the report-only turn the spend seam refuses paid work (authorizeGatewaySpend L45756)
    const refusal = report ? await host.authorizeGatewaySpend(v.s, { jobId: v.s.meta.jobId, method: "POST", path: "/v1/model_call", body: Buffer.from("{}"), quote }) : undefined;
    const statusDuringReport = v.s.meta.status;
    (host as any).setStatus(v.s, "idle"); // the report turn's result
    results.scenarios["late-arrival"] = {
      engineExit: engineOut.killed ? `killed (${engineOut.signal})` : "finished before kill", statusBefore,
      shimOperation: { status: opOf(opId).status, costUsd: opOf(opId).costUsd },
      collectorStarts: collectorStarts(opId), collected: collectedEv(opId), collectorPasses: passes, rowsLeft: rows(v.s),
      lateResultLines: lines, liveLateResultEvents: sessionEvents.filter((e) => e.sid === v.sid && e.kind === "late_result").map((e) => e.line),
      reportTurn: report ? { displayTexts: report.displayTexts, notePrefix: report.text.slice(0, 420), hasCompletedResults: report.text.includes('"completed_model_results"') } : null,
      spendDuringReport: refusal, statusDuringReport, reportTurnSettled: v.s.reportTurn === undefined, lateResultReportsLeft: v.s.meta.lateResultReports ?? null,
      incoming: incoming(v.jobPath), paidEntriesAdded: paid().length - paidBefore,
    };
    const a = results.scenarios["late-arrival"];
    a.pass = a.engineExit.startsWith("killed") && a.collectorStarts[0]?.collectorOwned === 0 && a.collectorStarts[0]?.wrapper === "plain" && a.rowsLeft.length === 0
      && lines.length === 1 && lines[0].outcome === "arrived" && lines[0].operationId === opId && lines[0].files.length === 1 && /^incoming\/model-/.test(lines[0].files[0])
      && a.liveLateResultEvents.length === 1 && !!report && report.displayTexts.length === 0 && report.text.startsWith("[APP NOTE, not from the user; do not quote it] A result the user already paid for arrived")
      && refusal?.allowed === false && /only reports a result/.test(refusal?.reason ?? "") && a.reportTurnSettled && a.paidEntriesAdded === 1 && a.incoming.length === 1;
    say(`late-arrival: ${a.pass ? "PASS" : "FAIL"}`);
  }

  // ── B. busy collector: open tool + job lock held elsewhere → lock_busy; then released → collected, no late line
  if (SCEN.includes("busy-lock") && MODE !== "real") {
    knob("tts-delay-ms", "1500");
    const v = newVideo(`m16-bl-${Date.now().toString(36)}`);
    v.s.openTools.add("toolu_m16_open"); (v.s.openToolStartedAt ??= new Map()).set("toolu_m16_open", Date.now() - 1000); // a tool the turn opened just before this request
    const run = v.runModel("minimax/speech-2.8-turbo", { text: "忙碌收集器测试。", voice_id: "female-shaonv" });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.phase === "sent" || opOf(opId)?.status === "succeeded", "sent to MiniMax");
    run.child.kill("SIGKILL"); await run.done;
    await until(() => opOf(opId)?.status !== "running", "shim settles", 60_000);
    // hold the engine's own job lock (log.job_lock_at) from another process
    const holder = spawn(join(ENGINE, ".venv", "bin", "python"), ["-c", "import os,sys,time; sys.path.insert(0, sys.argv[1]); import log; fd=os.open(sys.argv[2], os.O_RDONLY|os.O_DIRECTORY); l=log.job_lock_at(fd); l.__enter__(); print('held', flush=True); time.sleep(120)", join(ENGINE, "tools"), v.jobPath], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let held = ""; holder.stdout!.on("data", (b) => { held += b; }); await until(() => held.includes("held"), "lock held", 30_000);
    v.s.meta.acceptedOperations[0].nextRecoveryAt = 0;
    const t0 = Date.now(); await Promise.all(host.collectAcceptedOperations()); const lockedMs = Date.now() - t0;
    const whileLocked = { rows: rows(v.s), collectorOwned: v.s.meta.acceptedOperations?.[0]?.collectorOwned ?? null };
    holder.kill("SIGKILL"); await new Promise((r) => holder.once("exit", r));
    const passes = await collectUntilGone(v, "busy-lock");
    await sleep(300);
    results.scenarios["busy-lock"] = {
      collectorStarts: collectorStarts(opId), collected: collectedEv(opId), lockedPassMs: lockedMs, whileLocked, collectorPassesAfterRelease: passes, rowsLeft: rows(v.s),
      lateResultLines: lateRows(v.sid), lateResultReports: v.s.meta.lateResultReports ?? null, reportTurns: delivered.filter((d) => d.sid === v.sid).length,
      completed: (v.s.meta.completedModelResults ?? []).map((r: any) => ({ operation_id: r.result.operation_id, status: r.result.status })),
    };
    const b = results.scenarios["busy-lock"];
    b.pass = b.collectorStarts[0]?.wrapper === "busy" && b.collected[0]?.status === "lock_busy" && b.collected[0]?.complete === false && whileLocked.rows.length === 1 && !whileLocked.rows[0].recoveryFailures && whileLocked.collectorOwned === null
      && b.rowsLeft.length === 0 && b.collected.some((c: any) => c.status === "succeeded" && c.complete) && b.lateResultLines.length === 0 && b.reportTurns === 0 && b.completed[0]?.status === "succeeded";
    v.s.openTools.clear();
    say(`busy-lock: ${b.pass ? "PASS" : "FAIL"}`);
  }

  // ── C. late provider failure: video task in flight, engine killed, MiniMax reports Fail → late "failed" line + report
  if (SCEN.includes("late-failure") && MODE !== "real") {
    knob("video-status", "Processing");
    const v = newVideo(`m16-lf-${Date.now().toString(36)}`);
    const fr = v.runModel("minimax/image-01", { prompt: "a red paper boat", aspect_ratio: "9:16", n: 1 }); const frOut = await fr.done; await collectUntilGone(v, "image");
    const linesAfterImage = lateRows(v.sid).length;
    const run = v.runModel("minimax/hailuo-02-i2v-512p", { prompt: "the boat drifts", first_frame_image_url: frOut.saved?.[0] ?? "missing.png", duration: 6 });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.upstream?.task_id, "task accepted by MiniMax");
    run.child.kill("SIGKILL"); await run.done;
    knob("video-status", "Fail");
    await until(() => opOf(opId)?.status === "failed", "provider failure settles", 60_000);
    const passes = await collectUntilGone(v, "late-failure");
    await sleep(300);
    const report = delivered.find((d) => d.sid === v.sid);
    (host as any).setStatus(v.s, "idle");
    results.scenarios["late-failure"] = {
      linesAfterImage, shimOperation: { status: opOf(opId).status, costUsd: opOf(opId).costUsd },
      collectorStarts: collectorStarts(opId), collected: collectedEv(opId), collectorPasses: passes, rowsLeft: rows(v.s),
      lateResultLines: lateRows(v.sid), lateResultFailuresLeft: v.s.meta.lateResultFailures ?? null,
      reportTurn: report ? { displayTexts: report.displayTexts, note: report.text.slice(0, 700) } : null,
    };
    const c = results.scenarios["late-failure"];
    const ln = c.lateResultLines.find((l: any) => l.operationId === opId);
    c.pass = linesAfterImage === 0 && c.collectorStarts[0]?.collectorOwned === 0 && c.rowsLeft.length === 0 && ln?.outcome === "failed" && ln?.tool === "model_call"
      && !!report && /failed at the provider/.test(report.text) && /start no paid work/.test(report.text) && c.lateResultFailuresLeft === null;
    say(`late-failure: ${c.pass ? "PASS" : "FAIL"}`);
  }
  results.sessionEventKinds = [...new Set(sessionEvents.map((e) => e.kind))];
  results.ledger = { paidTool: paid().map((e: any) => ({ model: e.model, usd: e.usd, operationId: e.operationId })), unsettledExposure: ledger().unsettledExposure ?? [], totalPaidUsd: Math.round(paid().reduce((a: number, e: any) => a + e.usd, 0) * 1e6) / 1e6 };
  results.hostEvents = events.filter((e) => !/spend_decision/.test(e.event)).map((e) => ({ event: e.event, operationId: e.operationId, status: e.status, complete: e.complete, busy: e.busy, wrapper: e.wrapper, collectorOwned: e.collectorOwned, outcome: e.outcome, detail: e.detail }));
  const text = scrub(redactText(JSON.stringify(results, null, 1))).split(root).join("<tmp>");
  writeFileSync(join(outDir, `m16-collector-proof-${MODE}.json`), text);
  console.log(text.slice(0, 6000));
  proxy.close(); await host.dispose(); await killShim().catch(() => {});
  process.exit(Object.values(results.scenarios).every((s: any) => s.pass) ? 0 : 1);
})().catch((e) => { console.error(scrub(String(e?.stack ?? e))); process.exit(1); });
