// docs/31: the paid MODEL plane end to end over loopback — the verbatim AgentGatewayProxy (operation context, local
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
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { minimaxConfig } from "../src/main/llm/minimax";
import { catalog, priceCall, ttsBilledCharacterBound, operationSha256, MODELS_DEV_MINIMAX_CN_USD_PER_CNY } from "../src/main/gateway/minimax-media";

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

async function harness() {
  setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests();
  const root = mkdtempSync(join(tmpdir(), "vc-m14-"));
  const calls: string[] = [];
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, mediaFetch: fakeMiniMax(calls), sleep: async () => {}, monthUsd: 5 });
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
  return { root, shim, proxy, call, runOperation, calls, decisions, finished, remembered, close: async () => { proxy.close(); await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("m14 catalog: official MiniMax input names, proven list-price bounds (CNY list × models.dev 0.1494)", () => {
  const c = catalog({});
  assert.deepEqual(c.map((m) => m.model_slug), ["minimax/speech-2.8-turbo", "minimax/image-01", "minimax/hailuo-02-i2v-512p"]);
  assert.equal(ttsBilledCharacterBound("你好 ok"), 2 + 2 + 3);
  const tts = priceCall("minimax/speech-2.8-turbo", { text: "你好 world", voice_id: "female-shaonv" }, {});
  assert.equal(tts.maximumUsd, Math.round(10 * 0.0002 * MODELS_DEV_MINIMAX_CN_USD_PER_CNY * 1e6) / 1e6);
  assert.equal(priceCall("minimax/image-01", { prompt: "x", n: 2 }, {}).maximumUsd, Math.round(2 * 0.025 * 0.1494 * 1e6) / 1e6);
  assert.equal(priceCall("minimax/hailuo-02-i2v-512p", { prompt: "x", first_frame_image_url: "https://a/b.png", duration: 6 }, {}).maximumUsd, Math.round(0.6 * 0.1494 * 1e6) / 1e6);
  assert.throws(() => priceCall("minimax/hailuo-02-i2v-512p", { prompt: "x", first_frame_image_url: "u", duration: 5 }, {}), /duration must be one of 6, 10/);
  assert.throws(() => priceCall("minimax/image-01", { prompt: "x", seed: 1 }, {}), /seed is not accepted/);
  assert.throws(() => priceCall("seedance/whatever", {}, {}), /not in the self-hosted catalog/);
});

test("m14 proxy+shim: search, operation context, local admission, exact quote, durable model_call → signed asset + ledger charge", async () => {
  const h = await harness();
  try {
    const search: any = await (await h.call("GET", "/v1/models/search?q=speech&limit=5")).json();
    assert.equal(search.results[0].model_slug, "minimax/speech-2.8-turbo");
    assert.equal(search.results[0].callable, true);
    assert.equal("upstream_model" in search.results[0], false);
    const ctx: any = await (await h.call("GET", "/v1/operation-context")).json();
    assert.equal(ctx.schema, "videoclaw.operation-recovery/v1");
    assert.match(ctx.account_id, /^[a-f0-9]{64}$/);
    assert.deepEqual([ctx.gateway_url, ctx.project_id, ctx.client_job, ctx.accepting, ctx.tools, ctx.local_admission], [h.shim.url, "proj-1", "job-a", true, ["model_call"], "videoclaw.local-admission/v1"]);
    const bodyText = JSON.stringify({ params: { text: "你好 world", voice_id: "female-shaonv" }, client_job: "job-a", model: "minimax/speech-2.8-turbo" });
    const { id, result } = await h.runOperation("/v1/model_call", bodyText);
    assert.equal(result.status, "succeeded");
    assert.deepEqual([result.operation_id, result.project_id, result.client_job, result.tool], [id, "proj-1", "job-a", "model_call"]);
    assert.equal(h.decisions.length, 1);
    assert.equal(h.decisions[0].tool, "model_call");
    assert.equal(h.decisions[0].maximumUsd, priceCall("minimax/speech-2.8-turbo", JSON.parse(bodyText).params, {}).maximumUsd);
    assert.equal(h.remembered[0].sha256, operationSha256("/v1/model_call", bodyText));
    assert.deepEqual(h.finished, ["r1"]);
    // collect_operation download: same-origin signed /v1/assets/<32hex>?e&sig, no bearer
    const asset = result.assets[0];
    assert.equal(asset.content_type, "audio/mpeg");
    const au = new URL(asset.url);
    assert.equal(`${au.protocol}//${au.host}`, h.shim.url);
    assert.equal(au.pathname, `/v1/assets/${asset.asset_id}`);
    const media = await fetch(asset.url);
    assert.equal(media.status, 200);
    assert.equal(Buffer.from(await media.arrayBuffer()).toString(), "ID3-fake-mp3-bytes");
    assert.equal((await fetch(asset.url.replace(/sig=[0-9a-f]+/, "sig=" + "0".repeat(64)))).status, 403);
    // ledger: one paid_tool entry, charged at usage_characters (9) × list price; job budget shows it, reasoning share 0
    const led: any = h.shim.snapshot();
    const e = led.entries.find((x: any) => x.kind === "paid_tool");
    assert.equal(e.usd, Math.round(9 * 0.0002 * 0.1494 * 1e6) / 1e6);
    assert.deepEqual([e.clientJob, e.operationId, e.model], ["job-a", id, "minimax/speech-2.8-turbo"]);
    const budget = await h.proxy.getJobBudget("job-a");
    assert.deepEqual([budget.spent_usd, budget.llm_spent_usd, budget.reserved_usd, budget.mode], [e.usd, 0, 0, "unlimited"]);
    // idempotent: the same operation id never buys twice
    const before = h.calls.filter((c) => c.endsWith("/v1/t2a_v2")).length;
    const shimKey = (h.proxy as any).gatewayKey;
    const again: any = await (await fetch(`${h.shim.url}/v1/model_call`, { method: "POST", headers: { authorization: `Bearer ${shimKey}`, "x-videoclaw-operation-id": id, "x-videoclaw-project-id": "proj-1" }, body: bodyText })).json();
    assert.deepEqual([again.operation_id, again.job_id, again.status], [id, result.job_id, "succeeded"]);
    assert.equal(h.shim.snapshot().entries.filter((x: any) => x.kind === "paid_tool").length, 1);
    assert.equal(h.calls.filter((c) => c.endsWith("/v1/t2a_v2")).length, before);
  } finally { await h.close(); }
});

test("m14 image-to-video: the engine's uploaded first frame is inlined for MiniMax; async task → poll → mp4 asset", async () => {
  const h = await harness();
  try {
    const png = Buffer.from("\x89PNG-fake");
    const ticket: any = await (await h.call("POST", "/v1/uploads", { filename: "frame.png", content_type: "image/png", size_bytes: png.length, md5_base64: createHash("md5").update(png).digest("base64") })).json();
    assert.match(ticket.upload_id, /^[a-f0-9]{32}$/);
    assert.equal((await fetch(ticket.put_url, { method: "PUT", headers: ticket.headers, body: png })).status, 200);
    const read: any = await (await h.call("GET", `/v1/uploads/${ticket.upload_id}`)).json();
    assert.match(read.read_url, /\/v1\/uploads\/[a-f0-9]{32}\/content\?e=\d+&sig=/);
    const bodyText = JSON.stringify({ params: { prompt: "slow push in", first_frame_image_url: read.read_url, duration: 6 }, client_job: "job-a", model: "minimax/hailuo-02-i2v-512p" });
    const { result } = await h.runOperation("/v1/model_call", bodyText);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(result.assets[0].content_type, "video/mp4");
    assert.equal(result.cost_usd, Math.round(0.6 * 0.1494 * 1e6) / 1e6);
    assert.deepEqual(h.calls.filter((c) => c.includes("/v1/")), ["POST /v1/video_generation", "GET /v1/query/video_generation", "GET /v1/files/retrieve"]);
  } finally { await h.close(); }
});

test("m14 non-fitting paid tools keep the original failure branches: mint_video is not durable here (503 before any quote), and its quote is TOOL_NOT_OFFERED", async () => {
  const h = await harness();
  try {
    const id = randomUUID();
    const r = await h.call("POST", "/v1/mint_video", JSON.stringify({ params: {}, mode: "insert", client_job: "job-a" }), { "X-VideoClaw-Operation-Id": id, "X-VideoClaw-Local-Admission": "prepare" });
    assert.equal(r.status, 503);
    assert.match((await r.json()).detail, /durable recovery is unavailable for this operation; paid work was not started/);
    assert.equal(h.decisions.length, 0);
    const shimKey = (h.proxy as any).gatewayKey;
    const q = await fetch(`${h.shim.url}/v1/spend-authorities/job-a/quote`, { method: "POST", headers: { authorization: `Bearer ${shimKey}`, "content-type": "application/vnd.videoclaw.spend-operation", "x-videoclaw-operation-method": "POST", "x-videoclaw-operation-path": "/v1/mint_video" }, body: "{}" });
    assert.equal(q.status, 422);
    assert.equal((await q.json()).detail.code, "TOOL_NOT_OFFERED");
    // a model_call without a quote for its exact bytes is refused not_submitted
    const direct = await fetch(`${h.shim.url}/v1/model_call`, { method: "POST", headers: { authorization: `Bearer ${shimKey}`, "x-videoclaw-operation-id": randomUUID(), "x-videoclaw-project-id": "proj-1" }, body: JSON.stringify({ params: { prompt: "x" }, client_job: "job-a", model: "minimax/image-01" }) });
    assert.equal(direct.status, 409);
    assert.deepEqual([(await direct.json()).detail.code], ["SPEND_AUTHORITY_REQUIRED"]);
  } finally { await h.close(); }
});
