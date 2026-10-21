// docs/29 §1-§2: per-model ledger pricing (env → models.dev → MiniMax fallback, cache-read accounting) and the
// shim's local sinks / release feed / upload intake / paid-tool refusal. No network: MiniMax is faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { priceTable, costUsd, modelsDevLookup, MINIMAX_FALLBACK_PRICES, LOCAL_GATEWAY_PRICES_ENV } from "../src/main/gateway/pricing";
import { ModelsDb } from "../src/main/models-dev/db";
import { parseCatalog } from "../src/main/models-dev/catalog";
import { minimaxConfig } from "../src/main/llm/minimax";

const FAKE_KEY = "mm-test-key-0123456789";
const quiet = () => { setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests(); };

test("pricing: MiniMax-M3.1-Flash fallback is 0.15 / 0.6 / cache-read 0.015 per M tokens; the sample call costs half the old flat table", () => {
  const price = priceTable({ env: {}, catalog: null });
  const p = price("MiniMax-M3.1-Flash");
  assert.deepEqual([p.inputPerMTokUsd, p.outputPerMTokUsd, p.cacheReadPerMTokUsd], [0.15, 0.6, 0.015]);
  assert.equal(p.source, "minimax-fallback/2026-10");
  // docs/28 sample live call: 340 in / 93 out — old flat table 0.3/1.2 → 0.0002136; now 0.0001068
  assert.equal(costUsd(p, { inputTokens: 340, outputTokens: 93 }), 0.0001068);
  // cache reads are charged at the cache-read price, writes at the input price when no write price is listed
  assert.equal(costUsd(p, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 10_000, cacheWriteTokens: 200 }), (100 * 0.15 + 10_000 * 0.015 + 200 * 0.15 + 10 * 0.6) / 1e6);
  // an unpriced model is never free: it is charged at the default model's price and says so
  const u = price("MiniMax-M3");
  assert.equal(u.inputPerMTokUsd, 0.15);
  assert.match(u.source, /default for MiniMax-M3/);
});

test("pricing: owner override (env JSON) beats models.dev, which beats the MiniMax fallback; bad JSON is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-price-"));
  try {
    const dbPath = join(dir, "models.sqlite");
    const db = new ModelsDb(dbPath);
    db.replaceCatalog(parseCatalog({ minimax: { id: "minimax", name: "MiniMax", env: [], models: { "MiniMax-M3.1-Flash": { id: "MiniMax-M3.1-Flash", name: "Flash", cost: { input: 0.2, output: 0.8, cache_read: 0.02, cache_write: 0.25 }, limit: { context: 1000, output: 100 }, modalities: { input: ["text"], output: ["text"] } } } } }));
    db.close();
    const cat = modelsDevLookup(dbPath);
    const fromCatalog = priceTable({ env: {}, catalog: cat })("MiniMax-M3.1-Flash");
    assert.deepEqual([fromCatalog.inputPerMTokUsd, fromCatalog.outputPerMTokUsd, fromCatalog.cacheReadPerMTokUsd, fromCatalog.cacheWritePerMTokUsd, fromCatalog.source], [0.2, 0.8, 0.02, 0.25, "models.dev:minimax/MiniMax-M3.1-Flash"]);
    const env = { [LOCAL_GATEWAY_PRICES_ENV]: JSON.stringify({ "MiniMax-M3.1-Flash": { input: 1, output: 2, cacheRead: 0.1 }, "*": { input: 9, output: 9 } }) };
    const t = priceTable({ env, catalog: cat });
    assert.deepEqual([t("MiniMax-M3.1-Flash").inputPerMTokUsd, t("MiniMax-M3.1-Flash").source], [1, "env"]);
    assert.deepEqual([t("other").inputPerMTokUsd, t("other").source], [9, "env"]);
    assert.equal(priceTable({ env: { [LOCAL_GATEWAY_PRICES_ENV]: "{nope" }, catalog: null })("MiniMax-M3.1-Flash").inputPerMTokUsd, MINIMAX_FALLBACK_PRICES["MiniMax-M3.1-Flash"].inputPerMTokUsd);
    assert.equal(modelsDevLookup(join(dir, "missing.sqlite"))("MiniMax-M3.1-Flash"), undefined, "an unsynced catalog falls through");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function harness(usage: Record<string, number>) {
  quiet();
  const root = mkdtempSync(join(tmpdir(), "vc-m12-"));
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(String(init.body));
    if (body.stream) {
      const ev = (o: any) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
      return new Response(ev({ type: "message_start", message: { usage: { input_tokens: usage.input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens, output_tokens: 1 } } }) + ev({ type: "message_delta", usage: { output_tokens: usage.output_tokens } }) + ev({ type: "message_stop" }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, fetchImpl, monthUsd: 5, price: priceTable({ env: {}, catalog: null }), appVersion: "0.0.40-port.0" });
  const url = await shim.start();
  const { key } = shim.issueKey();
  return { root, shim, url, key, cleanup: async () => { await shim.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("ledger: cache-read tokens reported by MiniMax are recorded and charged at the cache-read price (JSON and SSE)", async () => {
  const h = await harness({ input_tokens: 200, cache_read_input_tokens: 5000, output_tokens: 50 });
  try {
    for (const stream of [false, true]) {
      const r = await fetch(`${h.url}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${h.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "MiniMax-M3.1-Flash", stream, max_tokens: 8, messages: [{ role: "user", content: "hi" }] }) });
      assert.equal(r.status, 200); await r.text();
    }
    const [a, b] = h.shim.snapshot().entries as any[];
    for (const e of [a, b]) {
      assert.deepEqual([e.inputTokens, e.cacheReadTokens, e.outputTokens], [200, 5000, 50]);
      assert.equal(e.usd, (200 * 0.15 + 5000 * 0.015 + 50 * 0.6) / 1e6);
      assert.equal(e.pricing.cacheReadPerMTokUsd, 0.015);
    }
  } finally { await h.cleanup(); }
});

test("shim sinks: feedback (+ bound screenshot PUT), blocked feedback without a key, telemetry deliveries, final-video PUT, uploads, release feed, paid-tool refusal", async () => {
  const h = await harness({ input_tokens: 1, output_tokens: 1 });
  const auth = { authorization: `Bearer ${h.key}`, "content-type": "application/json" };
  try {
    const png = Buffer.from("\x89PNG fake screenshot");
    const sha = createHash("sha256").update(png).digest("hex");
    let r = await fetch(`${h.url}/v1/feedback`, { method: "POST", headers: auth, body: JSON.stringify({ reportId: "rep_1", message: "hello", screenshot: true, screenshotBytes: png.length, screenshotSha256: sha }) });
    assert.equal(r.status, 200);
    const fb: any = await r.json();
    assert.equal(fb.screenshotPutHeaders["x-goog-content-sha256"], sha);
    assert.equal((await fetch(fb.screenshotPutUrl, { method: "PUT", body: Buffer.from("wrong") })).status, 400, "the PUT is bound to the declared bytes");
    assert.equal((await fetch(fb.screenshotPutUrl, { method: "PUT", body: png })).status, 200);
    assert.equal((await fetch(fb.screenshotPutUrl, { method: "PUT", body: png })).status, 404, "single use");
    assert.deepEqual(readFileSync(join(h.shim.sinkDir, "feedback", "rep_1.png")), png);
    assert.equal(JSON.parse(readFileSync(join(h.shim.sinkDir, "feedback", "rep_1.json"), "utf8")).report.message, "hello");
    assert.equal((await fetch(`${h.url}/v1/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401, "authenticated feedback needs the key");
    assert.equal((await fetch(`${h.url}/v1/feedback/blocked`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId: "blk_1", message: "no key" }) })).status, 200);
    assert.ok(existsSync(join(h.shim.sinkDir, "feedback-blocked", "blk_1.json")));
    // telemetry
    assert.equal((await fetch(`${h.url}/v1/telemetry/beacon`, { method: "POST", headers: auth, body: JSON.stringify({ event: "app_open" }) })).status, 200);
    assert.equal((await fetch(`${h.url}/v1/telemetry/sessions/s1/entries`, { method: "POST", headers: auth, body: JSON.stringify({ entries: [1] }) })).status, 200);
    assert.equal((await fetch(`${h.url}/v1/telemetry/sessions/s1/index`, { method: "PUT", headers: auth, body: JSON.stringify({ title: "t" }) })).status, 200);
    assert.equal((await fetch(`${h.url}/v1/telemetry/sessions/s1/index`, { method: "POST", headers: auth, body: "{}" })).status, 404, "index is PUT only");
    const vid = Buffer.from("fake mp4 bytes");
    r = await fetch(`${h.url}/v1/telemetry/jobs/j1/final`, { method: "POST", headers: auth, body: JSON.stringify({ contentType: "video/mp4", bytes: vid.length, sha256: createHash("sha256").update(vid).digest("hex") }) });
    const fin: any = await r.json();
    assert.equal((await fetch(fin.putUrl, { method: "PUT", body: vid })).status, 200);
    assert.equal((await fetch(`${h.url}/v1/telemetry/jobs/j1/final/complete`, { method: "POST", headers: auth, body: JSON.stringify({ object: fin.object }) })).status, 200);
    const tele = readdirSync(join(h.shim.sinkDir, "telemetry")).sort();
    assert.deepEqual(tele, ["beacon.jsonl", "job-final-complete.jsonl", "job-final.jsonl", "session-entries.jsonl", "session-index.jsonl"]);
    // uploads (engine _gateway.upload ticket contract)
    const ref = Buffer.from("reference image");
    r = await fetch(`${h.url}/v1/uploads`, { method: "POST", headers: auth, body: JSON.stringify({ filename: "ref.png", content_type: "image/png", size_bytes: ref.length, md5_base64: createHash("md5").update(ref).digest("base64") }) });
    const up: any = await r.json();
    assert.match(up.upload_id, /^[a-f0-9]{32}$/);
    assert.equal((await fetch(up.put_url, { method: "PUT", headers: up.headers, body: ref })).status, 200);
    // release feed
    r = await fetch(`${h.url}/v1/app/latest?channel=latest`);
    assert.deepEqual(((await r.json()) as any).version, "0.0.40-port.0");
    assert.equal((await fetch(`${h.url}/v1/app/latest?channel=nightly`)).status, 404);
    // paid tools refused before anything is reserved
    r = await fetch(`${h.url}/v1/mint_image`, { method: "POST", headers: auth, body: JSON.stringify({ mode: "portrait", model: "google/nano-banana-2/edit" }) });
    assert.equal(r.status, 422);
    const d: any = (await r.json()).detail;
    assert.deepEqual([d.code, d.retryable, d.not_submitted], ["TOOL_NOT_OFFERED", false, true]);
    assert.equal(h.shim.snapshot().entries.length, 0, "nothing charged");
    assert.equal(h.shim.snapshot().sinks?.feedback, 1);
  } finally { await h.cleanup(); }
});
