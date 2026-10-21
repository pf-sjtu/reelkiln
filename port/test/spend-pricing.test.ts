// docs/30: models.dev is THE price source — provider-aware lookup, logged source, per-job ledger spend for
// readGatewaySpend, the gate proxy's usage meter, and the startup sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";
import { resetProviderGatesForTests } from "../src/main/llm/retry";
import { LocalGatewayShim } from "../src/main/gateway/local-gateway-shim";
import { priceTable, modelsDevLookup, minimaxModelsDevProviders } from "../src/main/gateway/pricing";
import { ModelsDb } from "../src/main/models-dev/db";
import { parseCatalog } from "../src/main/models-dev/catalog";
import { minimaxConfig } from "../src/main/llm/minimax";
import { UsageMeter } from "../src/main/llm/agent-gate-proxy";
import { syncModelsDevIfStale } from "../src/main/models-dev/startup-sync";

const FAKE_KEY = "mm-test-key-0123456789";
const quiet = () => { setLoggerForTests(createLogger({ level: "silent" })); resetProviderGatesForTests(); };
const model = (cost: any) => ({ id: "MiniMax-M3.1-Flash", name: "Flash", cost, limit: { context: 1000, output: 100 }, modalities: { input: ["text"], output: ["text"] } });
// the live models.dev rows (api.json synced 2026-10-21): minimax / minimax-cn / a $0 coding-plan bundle
const CATALOG = {
  minimax: { id: "minimax", name: "MiniMax", env: [], models: { "MiniMax-M3.1-Flash": model({ input: 0.15, output: 0.6, cache_read: 0.015 }) } },
  "minimax-cn": { id: "minimax-cn", name: "MiniMax CN", env: [], models: { "MiniMax-M3.1-Flash": model({ input: 0.1494, output: 0.5976, cache_read: 0.0149 }) } },
  "minimax-coding-plan": { id: "minimax-coding-plan", name: "plan", env: [], models: { "MiniMax-M3.1-Flash": model({ input: 0, output: 0 }), "Other-Model": model({ input: 0, output: 0 }) } },
};

test("pricing: the MiniMax endpoint picks its models.dev provider row (minimaxi.com → minimax-cn first); reseller / $0 plan rows never price a call; the resolved source is logged once per model", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-price30-"));
  try {
    const dbPath = join(dir, "m.sqlite");
    const db = new ModelsDb(dbPath); db.replaceCatalog(parseCatalog(CATALOG)); db.close();
    assert.deepEqual(minimaxModelsDevProviders("https://api.minimaxi.com/anthropic"), ["minimax-cn", "minimax"]);
    assert.deepEqual(minimaxModelsDevProviders("https://api.minimax.io/anthropic"), ["minimax", "minimax-cn"]);
    assert.deepEqual(minimaxModelsDevProviders(minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!.baseUrl), ["minimax-cn", "minimax"], "the port's preset is the China endpoint");
    const logged: string[] = [];
    const cn = priceTable({ env: {}, catalog: modelsDevLookup(dbPath, ["minimax-cn", "minimax"]), onResolve: (m, p) => logged.push(`${m}=${p.source}`) });
    const p = cn("MiniMax-M3.1-Flash"); cn("MiniMax-M3.1-Flash");
    assert.deepEqual([p.inputPerMTokUsd, p.outputPerMTokUsd, p.cacheReadPerMTokUsd, p.source], [0.1494, 0.5976, 0.0149, "models.dev:minimax-cn/MiniMax-M3.1-Flash"]);
    const intl = priceTable({ env: {}, catalog: modelsDevLookup(dbPath, ["minimax", "minimax-cn"]) })("MiniMax-M3.1-Flash");
    assert.deepEqual([intl.inputPerMTokUsd, intl.source], [0.15, "models.dev:minimax/MiniMax-M3.1-Flash"]);
    const other = cn("Other-Model");
    assert.notEqual(other.inputPerMTokUsd, 0, "a $0 coding-plan row is not a MiniMax price");
    assert.equal(other.source, "models.dev:minimax-cn/MiniMax-M3.1-Flash (default for Other-Model)");
    assert.deepEqual(logged, ["MiniMax-M3.1-Flash=models.dev:minimax-cn/MiniMax-M3.1-Flash", `Other-Model=${other.source}`]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pricing: a catalog synced after startup is picked up (only positive lookups are cached); the startup sync honours freshness and the opt-out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-price30b-"));
  try {
    const dbPath = join(dir, "m.sqlite");
    new ModelsDb(dbPath).close();
    const logged: string[] = [];
    const t = priceTable({ env: {}, catalog: modelsDevLookup(dbPath, ["minimax-cn", "minimax"]), onResolve: (_m, p) => logged.push(p.source) });
    assert.match(t("MiniMax-M3.1-Flash").source, /^minimax-fallback/);
    const sync: any = async (db: ModelsDb) => { db.replaceCatalog(parseCatalog(CATALOG)); db.setMeta("models.dev", { last_synced_at: new Date(1_000_000).toISOString() }); return { status: "updated", providers: 3, models: 4 }; };
    assert.equal(await syncModelsDevIfStale({ env: { VIDEOCLAW_PORT_MODELS_DEV_SYNC: "0" }, dbPath, sync }), "disabled");
    assert.equal(await syncModelsDevIfStale({ env: {}, dbPath, sync, now: () => 1_000_000 }), "synced");
    assert.equal(await syncModelsDevIfStale({ env: {}, dbPath, sync, now: () => 1_000_000 + 3600_000 }), "fresh");
    assert.equal(await syncModelsDevIfStale({ env: {}, dbPath, sync: (async () => { throw new Error("offline"); }) as any, now: () => 1_000_000 + 48 * 3600_000 }), "failed");
    assert.equal(t("MiniMax-M3.1-Flash").source, "models.dev:minimax-cn/MiniMax-M3.1-Flash");
    assert.deepEqual(logged.map((s) => s.split("/")[0]), ["minimax-fallback", "models.dev:minimax-cn"], "the source change is logged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("shim: calls carrying X-VideoClaw-Client-Job are metered per job; GET /v1/spend-authorities/{job} answers readGatewaySpend's contract (L48020)", async () => {
  quiet();
  const root = mkdtempSync(join(tmpdir(), "vc-shim30-"));
  const fetchImpl = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000 } }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const price = () => ({ inputPerMTokUsd: 0.1494, outputPerMTokUsd: 0.5976, cacheReadPerMTokUsd: 0.0149, source: "models.dev:minimax-cn/MiniMax-M3.1-Flash" });
  const shim = new LocalGatewayShim({ dir: join(root, "lg"), provider: () => minimaxConfig({ MINIMAX_API_KEY: FAKE_KEY })!, fetchImpl, monthUsd: 5, price, appVersion: "0.0.40-port.0" });
  try {
    const url = await shim.start();
    const { key } = shim.issueKey();
    const call = (job?: string) => fetch(`${url}/anthropic/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(job ? { "x-videoclaw-client-job": job } : {}) }, body: JSON.stringify({ model: "MiniMax-M3.1-Flash", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }) }).then((r) => r.text());
    await call("job_a"); await call("job_a"); await call("job_b"); await call();
    const one = (1000 * 0.1494 + 2000 * 0.0149 + 100 * 0.5976) / 1e6;
    const r = await fetch(`${url}/v1/spend-authorities/job_a`, { headers: { authorization: `Bearer ${key}` } });
    const body: any = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.client_job, "job_a"); assert.equal(body.reserved_usd, 0); assert.equal(body.state, "ready"); assert.deepEqual(body.in_flight, []);
    assert.ok(Math.abs(body.spent_usd - 2 * one) < 1e-6, `${body.spent_usd} vs ${2 * one}`);
    assert.equal(shim.snapshot().entries.filter((e: any) => e.clientJob === "job_b").length, 1);
    assert.equal(shim.snapshot().entries.filter((e: any) => !e.clientJob).length, 1);
    assert.equal(shim.snapshot().entries[0].pricing.source, "models.dev:minimax-cn/MiniMax-M3.1-Flash");
  } finally { await shim.close(); rmSync(root, { recursive: true, force: true }); }
});

test("gate proxy UsageMeter: Anthropic SSE / JSON, OpenAI Responses SSE (cached tokens split out) and Chat Completions JSON", () => {
  const a = new UsageMeter();
  const sse = (o: any) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const text = sse({ type: "message_start", message: { model: "MiniMax-M3.1-Flash", usage: { input_tokens: 120, cache_read_input_tokens: 900, output_tokens: 1 } } }) + sse({ type: "message_delta", usage: { output_tokens: 42 } });
  a.push(text.slice(0, 37)); a.push(new TextEncoder().encode(text.slice(37)));
  assert.deepEqual([a.seen, a.model, a.inputTokens, a.cacheReadTokens, a.outputTokens], [true, "MiniMax-M3.1-Flash", 120, 900, 42]);
  const j = new UsageMeter(); j.json(JSON.stringify({ type: "message", model: "m", usage: { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 7 } }));
  assert.deepEqual([j.inputTokens, j.outputTokens, j.cacheWriteTokens], [5, 6, 7]);
  const o = new UsageMeter(); o.push(`data: ${JSON.stringify({ type: "response.completed", response: { model: "MiniMax-M3.1-Flash", usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 600 }, output_tokens: 50 } } })}\n\n`);
  assert.deepEqual([o.inputTokens, o.cacheReadTokens, o.outputTokens], [400, 600, 50]);
  const c = new UsageMeter(); c.json(JSON.stringify({ object: "chat.completion", model: "x", usage: { prompt_tokens: 10, completion_tokens: 3 } }));
  assert.deepEqual([c.inputTokens, c.outputTokens], [10, 3]);
  const n = new UsageMeter(); n.push("data: [DONE]\n\n"); assert.equal(n.seen, false);
});
