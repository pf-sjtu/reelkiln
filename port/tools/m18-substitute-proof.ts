// docs/35 M18 (copied from m14-model-call-proof): the OPT-IN substitute route. The REAL installed engine's
// tools/synth_voice.py --mode tts (named model gemini-3.1-flash-tts) is served by MiniMax speech-2.8-turbo via the
// shim's substitutes=["synth_voice"]; every row carries the SUBSTITUTE label.
// Original header: docs/31 §2: the REAL installed engine's tools/_model_call.py (read-only engine, --engine) through the PORT's
// verbatim AgentGatewayProxy (durable operations + local admission + exact quote) and the local gateway shim's
// MiniMax model plane. --mode fake: MiniMax is faked in-process (no network, $0). --mode real: the shim calls
// MiniMax's official media APIs with MINIMAX_API_KEY from the box env (never printed/written), concurrency 1.
// Usage: node m18-substitute-proof.cjs <outDir> --engine ENGINE --ws-settings SETTINGS.json --mode fake|real --calls tts,image,video
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { minimaxConfig } from "../src/main/llm/minimax";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { engineSessionEnv } from "../src/main/engine/session";
import { sanitizedAgentEnv } from "../src/main/llm/llm-route";
import { createLogger, setLoggerForTests, redactText, registerSecret } from "../src/main/llm/logger";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const outDir = resolve(process.argv[2] ?? "m14-proof"); mkdirSync(outDir, { recursive: true });
const ENGINE = resolve(arg("--engine") ?? "");
const MODE = arg("--mode", "fake");
const CALLS = (arg("--calls", "tts") ?? "tts").split(",");
setLoggerForTests(createLogger({ level: "silent" }));
const realKey = process.env.MINIMAX_API_KEY;
// the box sandbox keeps a copy of the whole env (key included) in one variable: never hand it to a child
for (const k of Object.keys(process.env)) if (k.startsWith("__CURSOR_SANDBOX")) delete process.env[k];
if (MODE === "real" && !realKey) { console.error("MINIMAX_API_KEY missing"); process.exit(2); }
if (realKey) registerSecret(realKey);
const scrub = (s: string) => (realKey ? s.split(realKey).join("[MINIMAX_API_KEY]") : s);

function fakeMiniMax(): typeof fetch {
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  return (async (url: any, init: any) => {
    const u = new URL(String(url)); const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname === "/v1/t2a_v2") return j({ data: { audio: (process.env.M18_FAKE_MP3 && existsSync(process.env.M18_FAKE_MP3) ? readFileSync(process.env.M18_FAKE_MP3) : Buffer.from("ID3fake")).toString("hex"), status: 2 }, extra_info: { usage_characters: JSON.parse(init.body).text.length }, base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/image_generation") return j({ data: { image_base64: [jpeg.toString("base64")] }, metadata: { success_count: 1 }, base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/video_generation") return j({ task_id: "fake-task", base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/query/video_generation") return j({ status: "Success", file_id: "f1", base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/files/retrieve") return j({ file: { download_url: "https://fake.invalid/v.mp4" }, base_resp: { status_code: 0 } });
    if (u.hostname === "fake.invalid") return new Response(Buffer.from("fake-mp4"));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}
const probe = (f: string) => { try { return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size,format_name:stream=codec_name,codec_type,width,height,sample_rate", "-of", "json", f], { encoding: "utf8" })); } catch { return null; } };

(async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m18-sub-proof-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, ".claude"), { recursive: true }); mkdirSync(join(ws, "jobs"), { recursive: true });
  copyFileSync(resolve(arg("--ws-settings") ?? ""), join(ws, ".claude", "settings.json"));
  const shim = new LocalGatewayShim({ substitutes: ["synth_voice"], dir: join(root, "lg"), provider: () => minimaxConfig(MODE === "real" ? process.env : { MINIMAX_API_KEY: "fake-key-proof-only" }), ...(MODE === "real" ? {} : { mediaFetch: fakeMiniMax(), sleep: async () => {} }), monthUsd: 5, log: (l) => console.log(scrub(l)) });
  const url = await shim.start(); const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(url, key);
  const jobId = `m18sub-${Date.now().toString(36)}`; const jobPath = join(ws, "jobs", jobId); mkdirSync(jobPath, { recursive: true });
  const decisions: any[] = []; const remembered: any[] = [];
  const policy: any = {
    jobId: () => jobId, projectId: () => "personal", requireOperationIdentity: true,
    rememberOperation: (op: any) => { remembered.push({ id: op.id, path: op.path, sha256: op.sha256 }); return true; },
    prepareSpend: async (j: string) => proxy.setSessionSpendPolicy(j, { kind: "capped", ceilingUsd: 0.5 }),
    authorizeSpend: async (req: any) => { decisions.push({ tool: req.quote.tool, routeMode: req.quote.routeMode, maximumUsd: req.quote.maximumUsd, quoteId: req.quote.quoteId.slice(0, 10) + "…" }); return { allowed: true, isCurrent: () => true }; },
    finishSpend: () => {},
  };
  const creds = proxy.credentials("m14-proof", policy);
  const engineCurrent = JSON.parse(readFileSync(join(ENGINE, "..", "..", "engine-current.json"), "utf8"));
  const deps = { currentEngine: () => ({ path: ENGINE, buildSha256: engineCurrent.buildSha256 }), workspaceRoot: () => ws, enginePathEnv: (p: string) => `${join(p, "bin")}:${process.env.PATH}`, gatewaySessionConfig: () => ({ gatewayUrl: url }) };
  const env: Record<string, string> = { ...sanitizedAgentEnv(process.env), ...engineSessionEnv(deps as any, creds.gatewayKey, creds.gatewayUrl), VIDEOCLAW_OPERATION_RECOVERY: "1", VIDEOCLAW_BOUND_JOB: jobId, VIDEOCLAW_WORKSPACE: ws, VIDEOCLAW_JOBS_DIR: join(ws, "jobs"), PYTHON_DOTENV_DISABLED: "1", PYTHONDONTWRITEBYTECODE: "1" };
  if (Object.values(env).some((v) => realKey && v.includes(realKey))) throw new Error("the MiniMax key must never reach the engine env");
  const runTts = (text: string) => new Promise<any>((res, rej) => {
    execFile(join(ENGINE, ".venv", "bin", "python"), [join(ENGINE, "tools", "synth_voice.py"), "--job", jobPath, "--mode", "tts", "--voice", "Kore", "--text", text, "--beat-id", "m18sub", "--no-stretch"], { cwd: ws, env, timeout: 10 * 60_000, maxBuffer: 16 << 20 }, (e, out, err) => (e ? rej(new Error(scrub(String(out) + "\n" + String(err || e)))) : res({ stdout: scrub(String(out)).slice(-2500), stderr: scrub(String(err)).slice(-1500) })));
  });
  const results: any = { mode: MODE, jobId, engine: ENGINE.split("/").pop(), calls: [] };
  const t = Date.now();
  const r = await runTts(arg("--text", "Hello. This line is spoken by the substitute voice route.")!);
  const ttsDir = join(jobPath, "tts");
  const saved = existsSync(ttsDir) ? readdirSync(ttsDir).map((rel) => { const f = join(ttsDir, rel); const b = readFileSync(f); return { rel: `tts/${rel}`, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex"), ffprobe: rel.endsWith(".mp3") ? probe(f) : undefined, json: rel.endsWith(".json") ? JSON.parse(b.toString("utf8")) : undefined }; }) : [];
  results.calls.push({ call: "synth_voice --mode tts --voice Kore", seconds: (Date.now() - t) / 1000, stdout: r.stdout, stderr: r.stderr, saved });
  const led: any = shim.snapshot();
  results.decisions = decisions; results.remembered = remembered;
  results.ledger = { paidTool: led.entries.filter((e: any) => e.kind === "paid_tool").map((e: any) => ({ tool: e.tool, substitute: e.substitute, model: e.model, upstreamModel: e.upstreamModel, usd: e.usd, units: e.units, maximumUsd: e.pricing.maximumUsd, clientJob: e.clientJob })), operations: Object.values(led.operations ?? {}).map((o: any) => ({ tool: o.tool, substitute: o.substitute, status: o.status, model: o.model, costUsd: o.costUsd, maximumUsd: o.maximumUsd, upstream: o.upstream, error: o.error })), quotes: (led.spendQuotes ?? []).length };
  results.jobBudget = await proxy.getJobBudget(jobId);
  results.engineJournal = readdirSync(join(jobPath, "operations")).map((f) => { const r = JSON.parse(readFileSync(join(jobPath, "operations", f), "utf8")); return { file: f, path: r.path, status: r.result?.status, outputs: r.outputs, delivered: r.delivered ? Object.keys(r.delivered) : undefined }; });
  try { results.runLogCost = readFileSync(join(jobPath, "run.log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "gateway_call").map((e) => ({ tool: e.tool, status: e.status, cost_usd: e.cost_usd, cost_source: e.cost_source })); } catch {}
  results.totalPaidUsd = Math.round(results.ledger.paidTool.reduce((a: number, e: any) => a + e.usd, 0) * 1e6) / 1e6;
  const text = scrub(redactText(JSON.stringify(results, null, 1)));
  writeFileSync(join(outDir, `substitute-proof-${MODE}.json`), text);
  console.log(text.slice(0, 3000));
  proxy.close(); await shim.close();
  process.exit(0);
})().catch((e) => { console.error(scrub(String(e?.stack ?? e))); process.exit(1); });
