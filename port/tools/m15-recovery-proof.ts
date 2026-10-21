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
const outDir = resolve(process.argv[2] ?? "m15-proof"); mkdirSync(outDir, { recursive: true });
const ENGINE = resolve(arg("--engine") ?? "");
const MODE = arg("--mode", "fake")!;
const SCEN = (arg("--scenarios", MODE === "real" ? "engine-kill" : "engine-kill,gateway-kill,stop-cancel") ?? "").split(",");
const realKey = process.env.MINIMAX_API_KEY;
for (const k of Object.keys(process.env)) if (k.startsWith("__CURSOR_SANDBOX")) delete process.env[k];
if (MODE === "real" && !realKey) { console.error("MINIMAX_API_KEY missing"); process.exit(2); }
if (realKey) registerSecret(realKey);
const scrub = (s: string) => (realKey ? s.split(realKey).join("[MINIMAX_API_KEY]") : s);
const events: any[] = [];
setLoggerForTests(createLogger({ level: "info", sink: (e: any) => { if (/^agent\.(paid|spend)/.test(e.event)) events.push(e); } } as any));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const say = (m: string) => console.log(scrub(`[m15-proof ${new Date().toISOString().slice(11, 19)}Z] ${m}`));

async function until<T>(f: () => T | undefined | false, what: string, ms = 60_000): Promise<T> { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(100); } }

(async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m15-proof-"));
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
  const url = await startShim();
  const key = readFileSync(join(lg, "vc-key"), "utf8").trim();
  const proxy = await AgentGatewayProxy.start(url, key);
  const ledger = () => JSON.parse(readFileSync(join(lg, "ledger.json"), "utf8"));
  const paid = () => ledger().entries.filter((e: any) => e.kind === "paid_tool");
  const fakeCalls = () => { try { return readFileSync(join(lg, "fake", "calls.log"), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
  const engineCurrent = existsSync(join(ENGINE, "..", "..", "engine-current.json")) ? JSON.parse(readFileSync(join(ENGINE, "..", "..", "engine-current.json"), "utf8")) : { buildSha256: readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0] };
  const envDeps = { currentEngine: () => ({ path: ENGINE, buildSha256: engineCurrent.buildSha256 }), workspaceRoot: () => ws, enginePathEnv: (p: string) => `${join(p, "bin")}:${process.env.PATH}`, gatewaySessionConfig: () => ({ gatewayUrl: url }) };
  const host = new AgentHost({
    emit: { sessionEvent: () => {}, sessionsChanged: () => {}, permissionRequest: () => {} } as any,
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
  const ttsText = MODE === "real" ? "这是一次中断恢复测试：应用在配音生成途中被强制结束，重启后的收集器必须取回原来的结果，而且只计费一次，不会重复购买同一段配音。" : "中断恢复测试的一段配音。";

  // ── A. engine killed mid-call (sync TTS); gateway survives → collector recovers the original result, charged once
  if (SCEN.includes("engine-kill")) {
    knob("tts-delay-ms", "4000");
    const v = newVideo(`m15-ek-${Date.now().toString(36)}`);
    const paidBefore = paid().length;
    const run = v.runModel("minimax/speech-2.8-turbo", { text: ttsText, voice_id: "female-shaonv" });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.phase === "sent" || opOf(opId)?.status === "succeeded", "sent to MiniMax");
    const phaseAtKill = { phase: opOf(opId).phase, status: opOf(opId).status };
    run.child.kill("SIGKILL");
    const engineOut = await run.done;
    say(`engine-kill: killed _model_call.py at ${JSON.stringify(phaseAtKill)} → ${JSON.stringify(engineOut).slice(0, 120)}`);
    await until(() => opOf(opId)?.status !== "running", "shim settles", 120_000);
    const passes = await collectUntilGone(v, "engine-kill");
    results.scenarios["engine-kill"] = {
      phaseAtKill, engineExit: engineOut.killed ? `killed (${engineOut.signal})` : "finished before kill",
      shimOperation: { status: opOf(opId).status, costUsd: opOf(opId).costUsd },
      collectorPasses: passes, rowsLeft: rows(v.s), completedModelResults: (v.s.meta.completedModelResults ?? []).map((r: any) => ({ operation_id: r.result.operation_id, status: r.result.status, saved: (r.result.saved ?? []).map((p: string) => p.split("/").slice(-2).join("/")), cost_usd: r.result.cost_usd })),
      incoming: incoming(v.jobPath), paidEntriesAdded: paid().length - paidBefore, paidUsd: paid().slice(paidBefore).map((e: any) => e.usd),
      minimaxTtsRequests: MODE === "real" ? "n/a (real: one request; ledger shows the single charge)" : fakeCalls().filter((c) => c.endsWith("/v1/t2a_v2")).length,
    };
    results.scenarios["engine-kill"].pass = results.scenarios["engine-kill"].rowsLeft.length === 0 && results.scenarios["engine-kill"].paidEntriesAdded === 1 && results.scenarios["engine-kill"].incoming.length >= 1 && results.scenarios["engine-kill"].completedModelResults[0]?.status === "succeeded" && (MODE === "real" || results.scenarios["engine-kill"].minimaxTtsRequests === 1);
    say(`engine-kill: ${results.scenarios["engine-kill"].pass ? "PASS" : "FAIL"}`);
  }
  // first frame for the video scenarios (fake image)
  const firstFrame = async (v: any) => { const r = v.runModel("minimax/image-01", { prompt: "a red paper boat", aspect_ratio: "9:16", n: 1 }); const out = await r.done; await collectUntilGone(v, "image"); return out.saved?.[0] ?? "missing.png"; };
  // ── B. gateway killed with a MiniMax video task in flight; restart resumes polling (never re-submits), charged once
  if (SCEN.includes("gateway-kill") && MODE !== "real") {
    knob("video-status", "Processing");
    const v = newVideo(`m15-gk-${Date.now().toString(36)}`);
    const frame = await firstFrame(v);
    const paidBefore = paid().length;
    const run = v.runModel("minimax/hailuo-02-i2v-512p", { prompt: "the boat drifts", first_frame_image_url: frame, duration: 6 });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.upstream?.task_id, "task accepted by MiniMax");
    await killShim(); run.child.kill("SIGKILL"); const engineOut = await run.done;
    say(`gateway-kill: SIGKILLed the gateway and the engine with task ${opOf(opId).upstream.task_id} in flight`);
    const firstAttempt = await Promise.all(host.collectAcceptedOperations()).then(() => rows(v.s)); // gateway down → backoff
    knob("video-status", "Success");
    await startShim();
    await until(() => opOf(opId)?.status === "succeeded", "resumed by polling", 60_000);
    const passes = await collectUntilGone(v, "gateway-kill");
    const submits = fakeCalls().filter((c) => c.endsWith("POST /v1/video_generation"));
    results.scenarios["gateway-kill"] = {
      engineExit: engineOut.killed ? `killed (${engineOut.signal})` : "finished", collectorWhileGatewayDown: firstAttempt,
      shimOperation: { status: opOf(opId).status, costUsd: opOf(opId).costUsd, recovery: opOf(opId).recovery },
      minimaxVideoSubmits: submits.length, submitPids: [...new Set(submits.map((c) => c.split(" ")[0]))].length,
      collectorPasses: passes, rowsLeft: rows(v.s), incoming: incoming(v.jobPath).filter((f) => !/\.png$/.test(f.file)),
      paidEntriesAdded: paid().length - paidBefore,
    };
    const g = results.scenarios["gateway-kill"];
    g.pass = g.shimOperation.recovery?.outcome === "resumed_polling" && g.minimaxVideoSubmits === 1 && g.paidEntriesAdded === 1 && g.rowsLeft.length === 0 && g.incoming.some((f: any) => /model-/.test(f.file)) && firstAttempt[0]?.recoveryFailures === 1;
    say(`gateway-kill: ${g.pass ? "PASS" : "FAIL"}`);
  }
  // ── C. Stop while the video task still queues at MiniMax → collector --cancel → DELETE cancelled → $0
  if (SCEN.includes("stop-cancel") && MODE !== "real") {
    knob("video-status", "Queueing"); knob("delete-answer", "cancelled");
    const v = newVideo(`m15-sc-${Date.now().toString(36)}`);
    const frame = await firstFrame(v);
    const paidBefore = paid().length;
    const callsBefore = fakeCalls().length;
    const run = v.runModel("minimax/hailuo-02-i2v-512p", { prompt: "the boat drifts", first_frame_image_url: frame, duration: 6 });
    const opId = await until(() => (v.s.meta.acceptedOperations ?? [])[0]?.id, "operation remembered");
    await until(() => opOf(opId)?.upstream?.task_id, "task accepted by MiniMax");
    v.s.meta.status = "running";
    run.child.kill("SIGKILL"); await run.done; // the turn's tool process ends with the turn
    await host.interrupt(v.sid, "stop");
    const marked = rows(v.s);
    const passes = await collectUntilGone(v, "stop-cancel");
    results.scenarios["stop-cancel"] = {
      rowsAfterStop: marked, shimOperation: { status: opOf(opId).status, costUsd: opOf(opId).costUsd, cancel: opOf(opId).cancel },
      minimaxRequestsAfterSubmit: fakeCalls().slice(callsBefore).map((c) => c.split(" ").slice(1).join(" ")).filter((c, i, a) => a.indexOf(c) === i),
      collectorPasses: passes, rowsLeft: rows(v.s), paidEntriesAdded: paid().length - paidBefore,
      completed: (v.s.meta.completedModelResults ?? []).filter((r: any) => r.result.operation_id === opId).map((r: any) => ({ status: r.result.status, cost_usd: r.result.cost_usd })),
    };
    const c = results.scenarios["stop-cancel"];
    c.pass = marked[0]?.cancelRequested === true && c.shimOperation.status === "canceled" && c.shimOperation.cancel?.outcome === "upstream_cancelled" && c.paidEntriesAdded === 0 && c.rowsLeft.length === 0 && c.minimaxRequestsAfterSubmit.includes("DELETE /v2/video_generation/fake-task-m15");
    say(`stop-cancel: ${c.pass ? "PASS" : "FAIL"}`);
  }
  results.ledger = { paidTool: paid().map((e: any) => ({ model: e.model, usd: e.usd, clientJob: e.clientJob, operationId: e.operationId })), unsettledExposure: ledger().unsettledExposure ?? [], totalPaidUsd: Math.round(paid().reduce((a: number, e: any) => a + e.usd, 0) * 1e6) / 1e6 };
  results.hostEvents = events.map((e) => ({ event: e.event, operationId: e.operationId, status: e.status, complete: e.complete, cancelRequested: e.cancelRequested, failures: e.failures, operations: e.operations }));
  const text = scrub(redactText(JSON.stringify(results, null, 1))).split(root).join("<tmp>");
  writeFileSync(join(outDir, `m15-recovery-proof-${MODE}.json`), text);
  console.log(text.slice(0, 4000));
  proxy.close(); await host.dispose(); await killShim().catch(() => {});
  process.exit(Object.values(results.scenarios).every((s: any) => s.pass) ? 0 : 1);
})().catch((e) => { console.error(scrub(String(e?.stack ?? e))); process.exit(1); });
