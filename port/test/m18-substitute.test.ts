// docs/35 M18: the OPT-IN substitute route (synth_voice/tts → MiniMax speech-2.8-turbo) through the same paid MODEL plane end to end over loopback — the verbatim AgentGatewayProxy (operation context, local
// spending admission, exact quote, durable operation identity) in front of the shim's MiniMax-backed model_call,
// driven exactly as engine tools/_gateway.py + _model_call.py drive it. MiniMax is faked (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { LocalGatewayShim, } from "../src/main/gateway/local-gateway-shim";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { minimaxConfig } from "../src/main/llm/minimax";
import { substituteCall, substitutesFromEnv } from "../src/main/gateway/local-gateway-shim";

const FAKE_KEY = "mm-test-key-0123456789";
const AUDIO_HEX = Buffer.from("ID3-fake-mp3-bytes").toString("hex");

function fakeMiniMax(calls: string[]) {
  return (async (url: any, init: any) => {
    const u = new URL(String(url));
    calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
    assert.equal(init?.headers?.authorization, u.hostname === "api.minimaxi.com" ? `Bearer ${FAKE_KEY}` : undefined);
    const j = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/t2a_v2") {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "speech-2.8-turbo"); assert.equal(body.stream, false); assert.equal(body.output_format, "hex");
      return j({ data: { audio: AUDIO_HEX, status: 2 }, extra_info: { usage_characters: 9, audio_length: 1200 }, trace_id: "t1", base_resp: { status_code: 0, status_msg: "success" } });
    }
    if (u.pathname === "/v1/video_generation") {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "MiniMax-Hailuo-02"); assert.equal(body.resolution, "512P"); assert.equal(body.duration, 6);
      assert.match(body.first_frame_image, /^data:image\/png;base64,/); // the shim's own upload, inlined (MiniMax cannot reach loopback)
      return j({ task_id: "task-1", base_resp: { status_code: 0 } });
    }
    if (u.pathname === "/v1/query/video_generation") return j({ status: "Success", file_id: "f-1", video_width: 512, video_height: 912, base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/files/retrieve") return j({ file: { download_url: "https://cdn.fake.example/v.mp4" }, base_resp: { status_code: 0 } });
    if (u.hostname === "cdn.fake.example") return new Response(Buffer.from("fake-mp4"), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

async function harness(substitutes?: any[]) {
  setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests();
  const root = mkdtempSync(join(tmpdir(), "vc-m14-"));
  const calls: string[] = [];
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, mediaFetch: fakeMiniMax(calls), sleep: async () => {}, monthUsd: 5, ...(substitutes ? { substitutes } : {}) });
  await shim.start();
  const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(shim.url, key);
  const decisions: any[] = [];
  const finished: string[] = [];
  const remembered: any[] = [];
  const policy = {
    jobId: () => "job-a", projectId: () => "proj-1", requireOperationIdentity: true,
    rememberOperation: (op: any) => { remembered.push(op); return true; },
    prepareSpend: async (jobId: string) => { await proxy.setSessionSpendPolicy(jobId, { kind: "unlimited_for_video" }); },
    authorizeSpend: async (req: any) => { decisions.push(req.quote); return { allowed: true, reservationId: "r1", isCurrent: () => true }; },
    finishSpend: (rid?: string) => { if (rid) finished.push(rid); },
  };
  const creds = proxy.credentials("s1", policy as any);
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${creds.gatewayUrl}${path}`, { method, headers: { authorization: `Bearer ${creds.gatewayKey}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  /** _submit_request L835 with local admission (L911-955): prepare → poll → submit → poll the operation */
  const runOperation = async (path: string, bodyText: string) => {
    const id = randomUUID();
    const h = { "X-VideoClaw-Operation-Id": id };
    const prep = await (await call("POST", path, bodyText, { ...h, "X-VideoClaw-Local-Admission": "prepare" })).json();
    assert.deepEqual(prep, { schema: "videoclaw.local-admission/v1", operation_id: id, status: "pending" });
    let st: any;
    for (let i = 0; i < 50; i++) { st = await (await call("GET", `/v1/local-admissions/${id}`)).json(); if (st.status !== "pending") break; await new Promise((r) => setTimeout(r, 20)); }
    assert.equal(st.status, "approved", JSON.stringify(st));
    const submit = await call("POST", path, bodyText, { ...h, "X-VideoClaw-Local-Admission": "submit", "X-VideoClaw-Pending-Settlement": "v1" });
    let result: any = await submit.json();
    assert.equal(submit.status, 200, JSON.stringify(result));
    for (let i = 0; i < 50 && result.status === "running"; i++) { await new Promise((r) => setTimeout(r, 20)); result = await (await call("GET", `/v1/operations/${id}?client_job=job-a`)).json(); }
    return { id, result };
  };
  return { root, shim, proxy, call, runOperation, calls, decisions, close: async () => { proxy.close(); await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}
// engine tools/synth_voice.py L195-221 (tts, TTS_MODEL branch): gateway.run("synth_voice", mode="tts", params=..., model=TTS_MODEL)
const engineBody = (text: string) => JSON.stringify({ params: { text, voice: "Kore", style_instructions: "calm", language_code: "English (US)", temperature: 1, output_format: "mp3" }, mode: "tts", client_job: "job-a", model: "gemini-3.1-flash-tts" });

test("substitute: off by default — synth_voice stays the original refusal and is not a recovery tool", async () => {
  assert.deepEqual(substitutesFromEnv({}), []);
  assert.deepEqual(substitutesFromEnv({ VIDEOCLAW_PORT_MINIMAX_SUBSTITUTE: "synth_voice, mint_video" }), ["synth_voice"]);
  const h = await harness([]);
  try {
    const me = { operation_recovery: (h.shim as any).operationRecovery() };
    assert.deepEqual(me.operation_recovery.tools, ["model_call"]);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test("substitute: synth_voice/tts is served by MiniMax speech-2.8-turbo with a SUBSTITUTE label everywhere", async () => {
  const h = await harness(["synth_voice"]);
  try {
    const me = { operation_recovery: (h.shim as any).operationRecovery() };
    assert.deepEqual(me.operation_recovery.tools, ["model_call", "synth_voice"]);
    const { result } = await h.runOperation("/v1/synth_voice", engineBody("Hello from the substitute route."));
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(result.tool, "synth_voice"); // engine _operations.record_result: tool must equal the path
    assert.equal(result.model, "minimax/speech-2.8-turbo");
    assert.equal(result.substitute.label, "SUBSTITUTE (not the named model)");
    assert.equal(result.substitute.requested_model, "gemini-3.1-flash-tts");
    assert.equal(result.substitute.requested_voice, "Kore");
    assert.equal(result.substitute.served_voice, "English_expressive_narrator");
    assert.equal(result.assets.length, 1); assert.equal(result.assets[0].content_type, "audio/mpeg");
    assert.ok(result.cost_usd > 0 && result.cost_usd < 0.01);
    assert.deepEqual(h.calls, ["POST /v1/t2a_v2"]);
    assert.equal(h.decisions.length, 1); assert.equal(h.decisions[0].tool, "synth_voice");
    const led: any = h.shim.snapshot();
    const e = led.entries.find((x: any) => x.kind === "paid_tool");
    assert.equal(e.tool, "synth_voice"); assert.equal(e.substitute.served_model, "minimax/speech-2.8-turbo");
  } finally { await h.close(); }
});

test("substitute: unmappable synth_voice modes (design/voice_change) and other paid tools are still refused, nothing sent", async () => {
  assert.equal(substituteCall("synth_voice", { mode: "design", params: { text: "x" } }), null);
  assert.equal(substituteCall("mint_image", { mode: "tts", params: { text: "x" } }), null);
  assert.equal(substituteCall("synth_voice", { mode: "tts", params: { text: "你好" } })!.label.served_voice, "female-shaonv");
  assert.equal(substituteCall("synth_voice", { mode: "tts", params: { text: "hi" } }, { VIDEOCLAW_PORT_MINIMAX_SUBSTITUTE_VOICE: "presenter_male" })!.params.voice_id, "presenter_male");
  const h = await harness(["synth_voice"]);
  try {
    const id = randomUUID();
    const r = await h.call("POST", "/v1/synth_voice", JSON.stringify({ params: { name: "x", description: "y" }, mode: "design", client_job: "job-a" }), { "X-VideoClaw-Operation-Id": id, "X-VideoClaw-Local-Admission": "prepare" });
    const prep: any = await r.json();
    let st: any = prep;
    for (let i = 0; i < 50 && st.status === "pending"; i++) { await new Promise((res) => setTimeout(res, 20)); st = await (await h.call("GET", `/v1/local-admissions/${id}`)).json(); }
    assert.notEqual(st.status, "approved", JSON.stringify(st));
    const m = await h.call("POST", "/v1/mint_image", JSON.stringify({ params: {}, client_job: "job-a" }));
    assert.ok(m.status >= 400);
    assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});
