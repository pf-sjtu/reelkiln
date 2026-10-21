// docs/32 M15 task 2: cancellation of in-flight model operations and durable resume after a gateway restart,
// against the shim's MiniMax-backed model_call (MiniMax faked; no network). The proxy in front is the verbatim
// AgentGatewayProxy, driven as engine _gateway.py drives it (local admission → submit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { AgentGatewayProxy } from "../src/main/gateway/agent-gateway-proxy";
import { minimaxConfig } from "../src/main/llm/minimax";

const FAKE_KEY = "mm-test-key-0123456789";
const AUDIO_HEX = Buffer.from("ID3-fake").toString("hex");
const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
const deferred = () => { let resolve!: () => void; const p = new Promise<void>((r) => { resolve = r; }); return { p, resolve }; };

interface Fake { calls: string[]; t2aHold?: Promise<void>; t2aNever?: boolean; videoStatus: string; deleteAnswer: "cancelled" | "refuse" }
function fakeMiniMax(f: Fake) {
  return (async (url: any, init: any) => {
    const u = new URL(String(url));
    f.calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/v1/t2a_v2") {
      if (f.t2aNever) await new Promise(() => {});
      if (f.t2aHold) await f.t2aHold;
      return j({ data: { audio: AUDIO_HEX, status: 2 }, extra_info: { usage_characters: 9 }, base_resp: { status_code: 0 } });
    }
    if (u.pathname === "/v1/video_generation") return j({ task_id: "task-1", base_resp: { status_code: 0 } });
    if (u.pathname === "/v2/video_generation/task-1" && init?.method === "DELETE") {
      assert.equal(init.headers.authorization, `Bearer ${FAKE_KEY}`);
      return f.deleteAnswer === "cancelled" ? j({ task_id: "task-1", action: "cancelled" }) : j({ error: { type: "invalid_request_error", message: "task is running and cannot be cancelled" } }, 400);
    }
    if (u.pathname === "/v1/query/video_generation") return j(f.videoStatus === "Success" ? { status: "Success", file_id: "f-1", base_resp: { status_code: 0 } } : { status: f.videoStatus, base_resp: { status_code: 0 } });
    if (u.pathname === "/v1/files/retrieve") return j({ file: { download_url: "https://cdn.fake.example/v.mp4" }, base_resp: { status_code: 0 } });
    if (u.hostname === "cdn.fake.example") return new Response(Buffer.from("fake-mp4"), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

async function harness(root: string, f: Fake) {
  setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests();
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, mediaFetch: fakeMiniMax(f), sleep: () => tick(5), monthUsd: 5 });
  await shim.start();
  const { key } = shim.issueKey();
  const proxy = await AgentGatewayProxy.start(shim.url, key);
  const policy = {
    jobId: () => "job-a", projectId: () => "proj-1", requireOperationIdentity: true,
    rememberOperation: () => true,
    prepareSpend: async (jobId: string) => { await proxy.setSessionSpendPolicy(jobId, { kind: "unlimited_for_video" }); },
    authorizeSpend: async () => ({ allowed: true, reservationId: "r1", isCurrent: () => true }),
    finishSpend: () => {},
  };
  const creds = proxy.credentials("s1", policy as any);
  const call = (method: string, path: string, body?: string, headers: Record<string, string> = {}) =>
    fetch(`${creds.gatewayUrl}${path}`, { method, headers: { authorization: `Bearer ${creds.gatewayKey}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body });
  /** prepare → approved → submit (NOT awaited: a held synchronous call answers only when MiniMax does) */
  const submit = async (bodyText: string) => {
    const id = randomUUID();
    const h = { "X-VideoClaw-Operation-Id": id };
    await (await call("POST", "/v1/model_call", bodyText, { ...h, "X-VideoClaw-Local-Admission": "prepare" })).json();
    for (let i = 0; i < 100; i++) { const st: any = await (await call("GET", `/v1/local-admissions/${id}`)).json(); if (st.status !== "pending") { assert.equal(st.status, "approved"); break; } await tick(); }
    const response = call("POST", "/v1/model_call", bodyText, { ...h, "X-VideoClaw-Local-Admission": "submit", "X-VideoClaw-Pending-Settlement": "v1" }).then((r) => r.json()).catch(() => undefined);
    for (let i = 0; i < 200 && !shim.snapshot().operations?.[id]; i++) await tick();
    return { id, response };
  };
  const shimKey = (proxy as any).gatewayKey;
  const cancel = async (id: string) => (await fetch(`${shim.url}/v1/operations/${id}/cancel?client_job=job-a`, { method: "POST", headers: { authorization: `Bearer ${shimKey}` } })).json();
  const op = (id: string): any => shim.snapshot().operations?.[id];
  const paid = () => shim.snapshot().entries.filter((e: any) => e.kind === "paid_tool");
  const until = async (pred: () => boolean, what: string) => { for (let i = 0; i < 400; i++) { if (pred()) return; await tick(); } assert.fail(`timed out waiting for ${what}`); };
  return { shim, proxy, submit, cancel, op, paid, until, close: async () => { proxy.close(); await shim.close(); } };
}
const TTS = (text: string) => JSON.stringify({ params: { text, voice_id: "female-shaonv" }, client_job: "job-a", model: "minimax/speech-2.8-turbo" });
const VIDEO = JSON.stringify({ params: { prompt: "slow push in", first_frame_image_url: "https://img.fake.example/a.png", duration: 6 }, client_job: "job-a", model: "minimax/hailuo-02-i2v-512p" });

test("m15 cancel: a call still queued behind the media gate is canceled before it is sent ($0); a sent synchronous call cannot be cancelled and is charged once", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m15-"));
  const hold = deferred();
  const f: Fake = { calls: [], t2aHold: hold.p, videoStatus: "Processing", deleteAnswer: "refuse" };
  const h = await harness(root, f);
  try {
    const a = await h.submit(TTS("第一段"));
    await h.until(() => h.op(a.id)?.phase === "sent", "first call sent");
    const b = await h.submit(TTS("第二段"));
    assert.equal(h.op(b.id).phase, "queued");
    const vb: any = await h.cancel(b.id);
    assert.equal(vb.status, "canceled");
    assert.deepEqual([h.op(b.id).cancel.outcome, h.op(b.id).costUsd], ["canceled_before_send", 0]);
    const va: any = await h.cancel(a.id);
    assert.equal(va.status, "running");
    assert.equal(h.op(a.id).cancel.outcome, "not_cancellable_sync");
    hold.resolve();
    await h.until(() => h.op(a.id).status === "succeeded", "first call finished");
    await tick(30);
    assert.equal(f.calls.filter((c) => c.endsWith("/v1/t2a_v2")).length, 1, "the canceled call never reached MiniMax");
    assert.equal(h.op(b.id).status, "canceled");
    assert.deepEqual(h.paid().map((e: any) => e.operationId), [a.id], "charged exactly once, only for the call MiniMax ran");
    assert.equal(h.shim.jobReservedUsd("job-a"), 0);
  } finally { await h.close(); rmSync(root, { recursive: true, force: true }); }
});

test("m15 cancel: a submitted video task MiniMax still queues is cancelled upstream (DELETE /v2/video_generation/{task_id}) — no download, no charge", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m15-"));
  const f: Fake = { calls: [], videoStatus: "Queueing", deleteAnswer: "cancelled" };
  const h = await harness(root, f);
  try {
    const v = await h.submit(VIDEO);
    await h.until(() => h.op(v.id)?.upstream?.task_id === "task-1", "task id");
    const view: any = await h.cancel(v.id);
    assert.equal(view.status, "canceled");
    assert.equal(h.op(v.id).cancel.outcome, "upstream_cancelled");
    await tick(60);
    assert.equal(h.op(v.id).status, "canceled");
    assert.equal(h.paid().length, 0);
    assert.ok(f.calls.includes("DELETE /v2/video_generation/task-1"));
    assert.ok(!f.calls.includes("GET /v1/files/retrieve"));
  } finally { await h.close(); rmSync(root, { recursive: true, force: true }); }
});

test("m15 cancel: MiniMax refuses to cancel a running video task → it finishes and is charged exactly once (never hidden)", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m15-"));
  const f: Fake = { calls: [], videoStatus: "Processing", deleteAnswer: "refuse" };
  const h = await harness(root, f);
  try {
    const v = await h.submit(VIDEO);
    await h.until(() => h.op(v.id)?.upstream?.task_id === "task-1", "task id");
    const view: any = await h.cancel(v.id);
    assert.equal(view.status, "running");
    assert.equal(h.op(v.id).cancel.outcome, "upstream_refused");
    assert.match(h.op(v.id).cancel.detail, /HTTP 400 task is running/);
    assert.ok(!JSON.stringify(h.shim.snapshot()).includes(FAKE_KEY));
    f.videoStatus = "Success";
    await h.until(() => h.op(v.id).status === "succeeded", "video finished");
    assert.equal(h.paid().length, 1);
    // cancelling a terminal operation only reads it back
    assert.equal(((await h.cancel(v.id)) as any).status, "succeeded");
    assert.equal(h.paid().length, 1);
  } finally { await h.close(); rmSync(root, { recursive: true, force: true }); }
});

test("m15 durable resume: the gateway dies mid-operation; on restart a video task is resumed by polling (never re-submitted, charged once), a sent sync call settles $0 with recorded exposure, an unsent one settles $0", async () => {
  const root = mkdtempSync(join(tmpdir(), "vc-m15-"));
  const f1: Fake = { calls: [], t2aNever: true, videoStatus: "Processing", deleteAnswer: "refuse" };
  const h1 = await harness(root, f1);
  const v = await h1.submit(VIDEO);
  await h1.until(() => h1.op(v.id)?.upstream?.task_id === "task-1", "task id");
  // a TTS call MiniMax never answers (sent) and one queued behind it in the media gate
  resetProviderGatesForTests();
  const s = await h1.submit(TTS("会被中断的一段"));
  await h1.until(() => h1.op(s.id)?.phase === "sent", "sync sent");
  const q = await h1.submit(TTS("排队中的一段"));
  assert.equal(h1.op(q.id).phase, "queued");
  // "kill": the process is gone — nothing of h1 runs again (its ledger is what survives on disk)
  const onDisk = JSON.parse(JSON.stringify(h1.shim.snapshot()));
  await h1.close();
  (h1.shim as any).write = () => {}; (h1.shim as any).ledger = onDisk; // a dead process writes nothing more
  const f2: Fake = { calls: [], videoStatus: "Success", deleteAnswer: "refuse" };
  const h2 = await harness(root, f2);
  try {
    await h2.until(() => h2.op(v.id).status === "succeeded", "video resumed");
    assert.equal(h2.op(v.id).recovery.outcome, "resumed_polling");
    assert.ok(!f2.calls.includes("POST /v1/video_generation"), "never re-submitted (no second purchase)");
    assert.equal(f1.calls.filter((c) => c === "POST /v1/video_generation").length, 1);
    assert.deepEqual([h2.op(s.id).status, h2.op(s.id).costUsd, h2.op(s.id).recovery.outcome], ["failed", 0, "sync_outcome_unknown"]);
    assert.deepEqual([h2.op(q.id).status, h2.op(q.id).costUsd, h2.op(q.id).recovery.outcome], ["failed", 0, "never_sent"]);
    assert.ok(!f2.calls.includes("POST /v1/t2a_v2"), "an interrupted sync call is never repeated");
    assert.deepEqual(h2.paid().map((e: any) => e.operationId), [v.id]);
    const exposure = (h2.shim.snapshot() as any).unsettledExposure;
    assert.deepEqual(exposure.map((e: any) => [e.operationId, e.reason]), [[s.id, "sync_call_interrupted"]]);
    assert.equal(h2.shim.jobReservedUsd("job-a"), 0);
    // a second restart changes nothing (idempotent)
    await h2.close();
    const h3 = await harness(root, { calls: [], videoStatus: "Success", deleteAnswer: "refuse" });
    try { await tick(50); assert.equal(h3.paid().length, 1); } finally { await h3.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
