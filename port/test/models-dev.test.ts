// models.dev catalog → SQLite (docs/15 §5). Uses a trimmed REAL capture of https://models.dev/api.json
// (test/fixtures/models-dev-api.sample.json, fetched 2026-10-21). No network: fetch is mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseCatalog, CatalogFormatError } from "../src/main/models-dev/catalog";
import { ModelsDb, MIGRATIONS, toMetadata, defaultModelsDbPath, MODELS_DB_ENV } from "../src/main/models-dev/db";
import { syncModelsDev, MODELS_DEV_URL } from "../src/main/models-dev/sync";
import { providerModelMetadata } from "../src/main/models-dev/lookup";
import { runModelsCommand } from "../src/cli/models-cli";
import { loadProviderRegistry } from "../src/main/llm/provider-registry";
import { createLogger, type LogRecord } from "../src/main/llm/logger";

const SAMPLE_TEXT = readFileSync(join(process.cwd(), "test/fixtures/models-dev-api.sample.json"), "utf8");
const sample = () => JSON.parse(SAMPLE_TEXT) as Record<string, any>;
const quiet = createLogger({ level: "silent" });
const tmpDb = () => join(mkdtempSync(join(tmpdir(), "vc-models-")), "models.sqlite");

type Reply = { status: number; body?: string; headers?: Record<string, string> } | Error;
function fakeFetch(replies: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    if (r instanceof Error) throw r;
    return new Response(r.status === 304 ? null : r.body ?? "", { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("fixture is a real models.dev capture with the expected shape", () => {
  const s = sample();
  assert.deepEqual(Object.keys(s).sort(), ["alibaba-cn", "anthropic", "cloudflare-ai-gateway", "minimax-cn", "openai"]);
  for (const p of Object.values(s)) {
    for (const k of ["id", "name", "env", "models"]) assert.ok(k in p, k);
    for (const [mk, m] of Object.entries<any>(p.models)) { assert.equal(m.id, mk); assert.ok(m.limit && typeof m.limit.context === "number"); }
  }
});

test("parseCatalog: providers/models normalised; malformed entries skipped not fatal; root must be an object", () => {
  const cat = parseCatalog(sample());
  assert.equal(cat.providers.length, 5);
  assert.equal(cat.modelCount, 10);
  assert.deepEqual(cat.skipped, []);
  const mm = cat.providers.find((p) => p.id === "minimax-cn")!;
  assert.equal(mm.api, "https://api.minimax.cn/anthropic/v1");
  assert.deepEqual(mm.env, ["MINIMAX_API_KEY"]);
  assert.equal("models" in mm.raw, false);
  const flash = mm.models.find((m) => m.id === "MiniMax-M3.1-Flash")!;
  assert.equal(flash.limit!.context, 1_000_000);
  assert.deepEqual(flash.modalities!.input, ["text", "image", "video"]);
  const bad = sample();
  bad.openai.models["broken"] = { id: "broken", limit: { context: "big" } };
  bad.openai.models["also-broken"] = "nope";
  bad["no-models"] = { id: "no-models", name: "x" };
  const c2 = parseCatalog(bad);
  assert.equal(c2.modelCount, 10);
  assert.equal(c2.skipped.length, 3);
  assert.ok(c2.skipped.some((s) => s.provider === "no-models"));
  for (const v of [null, [], "x", 1]) assert.throws(() => parseCatalog(v), CatalogFormatError);
});

test("DB: migration creates schema v1 once; reopening is a no-op; newer schema refuses to open", () => {
  const p = tmpDb();
  const db = new ModelsDb(p);
  assert.equal(db.schemaVersion(), MIGRATIONS.length);
  const tables = (db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  assert.deepEqual(tables, ["models", "providers", "sync_meta"]);
  db.close();
  const again = new ModelsDb(p);
  assert.equal(again.migrate(), 0);
  again.close();
  const raw = new DatabaseSync(p); raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`); raw.close();
  assert.throws(() => new ModelsDb(p), /newer than this build/);
  assert.equal(defaultModelsDbPath({ [MODELS_DB_ENV]: "/x/y.sqlite" }), "/x/y.sqlite");
  assert.match(defaultModelsDbPath({}), /models-dev\.sqlite$/);
});

test("DB: replaceCatalog is idempotent and prunes rows missing from the next snapshot", () => {
  const db = new ModelsDb(":memory:");
  const strip = () => (db.db.prepare("SELECT * FROM models ORDER BY provider_id, model_id").all() as any[]).map(({ synced_at, ...r }) => r);
  const r1 = db.replaceCatalog(parseCatalog(sample()), "2026-10-21T00:00:00.000Z");
  assert.deepEqual(r1, { providers: 5, models: 10, removedProviders: 0, removedModels: 0 });
  const snap = strip();
  const r2 = db.replaceCatalog(parseCatalog(sample()), "2026-10-21T00:00:00.000Z"); // same timestamp on purpose
  assert.deepEqual(r2, r1);
  assert.deepEqual(strip(), snap);
  assert.deepEqual(db.counts(), { providers: 5, models: 10 });
  const next = sample();
  delete next["alibaba-cn"];
  delete next.openai.models["gpt-5.5"];
  next.anthropic.models["claude-sonnet-4-5"].limit.context = 1_000_000;
  const r3 = db.replaceCatalog(parseCatalog(next));
  assert.deepEqual(r3, { providers: 4, models: 8, removedProviders: 1, removedModels: 2 });
  assert.equal(db.getModel("anthropic", "claude-sonnet-4-5")!.context_limit, 1_000_000);
  assert.equal(db.getModel("openai", "gpt-5.5"), undefined);
  db.close();
});

test("DB: lookup order (exact, provider/model, canonical, model id) and metadata view incl. tiered pricing", () => {
  const db = new ModelsDb(":memory:");
  db.replaceCatalog(parseCatalog(sample()));
  assert.equal(db.findModel({ provider: "minimax-cn", model: "MiniMax-M3.1-Flash" })!.provider_id, "minimax-cn");
  assert.equal(db.findModel({ model: "openai/gpt-5.5-pro" })!.provider_id, "openai"); // split on first "/"
  assert.equal(db.findModel({ model: "cloudflare-ai-gateway/openai/gpt-5.5-pro" })!.provider_id, "cloudflare-ai-gateway");
  assert.equal(db.findModel({ model: "minimax-mini-unknown" }), undefined);
  assert.equal(db.findModel({ model: "minimax-m3.1-flash" })!.model_id, "MiniMax-M3.1-Flash"); // case-insensitive id
  assert.equal(db.findModel({ provider: "minimax", model: "MiniMax-M3.1-Flash" })!.provider_id, "minimax-cn"); // canonical minimax/…
  const md = toMetadata(db.getModel("minimax-cn", "MiniMax-M3.1-Flash")!);
  assert.equal(md.contextWindow, 1_000_000);
  assert.equal(md.maxOutputTokens, 524_288);
  assert.deepEqual(md.pricing, { currency: "USD", per: "1M tokens", input: 0.1494, output: 0.5976, cacheRead: 0.0149 });
  assert.deepEqual(md.modalities, { input: ["text", "image", "video"], output: ["text"] });
  assert.equal(md.capabilities.reasoning, true);
  const tiered = toMetadata(db.getModel("alibaba-cn", "qwen3.6-flash")!);
  assert.ok(Array.isArray((tiered.pricing!.raw as any).tiers));
  assert.deepEqual(db.listModels({ search: "100%_" }), []); // LIKE wildcards are escaped
  assert.deepEqual(db.listModels({ provider: "anthropic", limit: 2 }).map((r) => r.model_id), ["claude-haiku-4-5-20251001", "claude-sonnet-4-5"]);
  assert.equal(db.listModels({ search: "flash" }).length, 2);
  db.close();
});

test("provider framework → models.dev metadata (preset modelsDev key, defaults, explicit override)", () => {
  const db = new ModelsDb(":memory:");
  db.replaceCatalog(parseCatalog(sample()));
  const reg = loadProviderRegistry({ json: { providers: [
    { name: "openai", protocol: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-5.5" },
    { name: "my-proxy", protocol: "anthropic-messages", baseUrl: "https://p.test", apiKeyEnv: "P_KEY", model: "sonnet-proxy", modelsDev: { provider: "anthropic", model: "claude-sonnet-4-5" } },
    { name: "nomatch", protocol: "openai-chat-completions", baseUrl: "https://n.test", apiKeyEnv: "N_KEY", model: "zzz" },
  ] } });
  assert.equal(providerModelMetadata(db, reg.get("minimax")!)!.contextWindow, 1_000_000);
  assert.equal(providerModelMetadata(db, reg.get("openai")!)!.provider, "openai");
  assert.equal(providerModelMetadata(db, reg.get("my-proxy")!)!.pricing!.input, 3);
  assert.equal(providerModelMetadata(db, reg.get("nomatch")!), undefined);
  const resolved = reg.resolve("minimax", { MINIMAX_API_KEY: "k-123456789", MINIMAX_MODEL: "MiniMax-M3" })!;
  assert.equal(providerModelMetadata(db, resolved)!.model, "MiniMax-M3"); // env override flows into the lookup
  db.close();
});

test("sync: 200 → updated; etag → 304 not-modified; same bytes → unchanged; force rewrites", async () => {
  const db = new ModelsDb(":memory:");
  const etag = '"abc123"';
  const { f, calls } = fakeFetch([
    { status: 200, body: SAMPLE_TEXT, headers: { etag, "content-type": "application/json" } },
    { status: 304, headers: { etag } },
    { status: 200, body: SAMPLE_TEXT }, // server dropped the etag, same content
    { status: 200, body: SAMPLE_TEXT, headers: { etag } },
  ]);
  const t = (n: number) => () => new Date(Date.UTC(2026, 9, 21, 0, 0, n));
  const r1 = await syncModelsDev(db, { fetchImpl: f, logger: quiet, now: t(1) });
  assert.equal(r1.status, "updated");
  assert.equal(r1.ok, true);
  assert.deepEqual([r1.providers, r1.models, r1.skipped], [5, 10, 0]);
  assert.equal(calls[0].url, MODELS_DEV_URL);
  assert.equal(calls[0].headers["if-none-match"], undefined);
  const r2 = await syncModelsDev(db, { fetchImpl: f, logger: quiet, now: t(2) });
  assert.equal(calls[1].headers["if-none-match"], etag);
  assert.equal(r2.status, "not-modified");
  assert.equal(r2.lastSyncedAt, "2026-10-21T00:00:01.000Z");
  const r3 = await syncModelsDev(db, { fetchImpl: f, logger: quiet, now: t(3) });
  assert.equal(r3.status, "unchanged");
  const r4 = await syncModelsDev(db, { fetchImpl: f, logger: quiet, now: t(4), force: true });
  assert.equal(calls[3].headers["if-none-match"], undefined);
  assert.equal(r4.status, "updated");
  assert.equal(db.getMeta()!.last_synced_at, "2026-10-21T00:00:04.000Z");
  assert.equal(db.counts().models, 10);
  db.close();
});

test("sync is offline-safe: network/timeout/HTTP/JSON/sanity failures keep the last good data and record the error", async () => {
  const db = new ModelsDb(":memory:");
  const recs: LogRecord[] = [];
  const logger = createLogger({ sink: (r) => recs.push(r) });
  const shrunk = sample(); for (const k of ["openai", "anthropic", "alibaba-cn", "cloudflare-ai-gateway"]) delete shrunk[k];
  const halfBad = sample(); for (const p of Object.values<any>(halfBad)) for (const k of Object.keys(p.models)) p.models[k] = { id: k, limit: "x" };
  const { f } = fakeFetch([
    { status: 200, body: SAMPLE_TEXT, headers: { etag: '"v1"' } },
    Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
    { status: 503, body: "busy" },
    { status: 200, body: "<html>not json</html>" },
    { status: 200, body: "{}" },
    { status: 200, body: JSON.stringify(halfBad) },
    { status: 200, body: JSON.stringify(shrunk) },
    { status: 200, body: JSON.stringify(shrunk) },
  ]);
  assert.equal((await syncModelsDev(db, { fetchImpl: f, logger })).status, "updated");
  const expectFail = async (code: string, extra: Partial<Parameters<typeof syncModelsDev>[1]> = {}) => {
    const r = await syncModelsDev(db, { fetchImpl: f, logger, ...extra });
    assert.equal(r.ok, false, code);
    assert.equal(r.status, "failed");
    assert.equal(r.error!.code, code);
    assert.equal(r.models, 10, `data kept after ${code}`);
    assert.equal(db.getMeta()!.last_status, "failed");
    assert.match(db.getMeta()!.last_error!, new RegExp(code));
    return r;
  };
  assert.match((await expectFail("NETWORK")).error!.message, /ENOTFOUND/);
  assert.equal((await expectFail("HTTP_ERROR")).error!.httpStatus, 503);
  await expectFail("CATALOG_INVALID");
  await expectFail("SANITY_CHECK_FAILED"); // {} → no providers
  await expectFail("SANITY_CHECK_FAILED"); // every model invalid
  await expectFail("SANITY_CHECK_FAILED"); // 10 → 2 models without --force
  const forced = await syncModelsDev(db, { fetchImpl: f, logger, force: true });
  assert.equal(forced.status, "updated");
  assert.equal(forced.models, 2);
  assert.ok(recs.some((r) => r.level === "warn" && r.event === "models_dev.sync"));
  // timeout
  const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
  const r = await syncModelsDev(db, { fetchImpl: hang, timeoutMs: 20, logger: quiet });
  assert.equal(r.error!.code, "TIMEOUT");
  assert.equal(r.models, 2);
  db.close();
});

test("sync: validators are only sent to the URL they came from", async () => {
  const db = new ModelsDb(":memory:");
  const { f, calls } = fakeFetch([{ status: 200, body: SAMPLE_TEXT, headers: { etag: '"v1"' } }, { status: 200, body: SAMPLE_TEXT }]);
  await syncModelsDev(db, { fetchImpl: f, logger: quiet });
  await syncModelsDev(db, { fetchImpl: f, logger: quiet, url: "https://mirror.test/api.json" });
  assert.equal(calls[1].headers["if-none-match"], undefined);
  db.close();
});

test("CLI: models-sync / models-list / models-show / llm-model-info against a temp DB (mock fetch)", async () => {
  const dbPath = tmpDb();
  const { f } = fakeFetch([{ status: 200, body: SAMPLE_TEXT, headers: { etag: '"v1"' } }, { status: 304 }]);
  const deps = { fetchImpl: f, logger: quiet, env: { VIDEOCLAW_MODELS_DB: dbPath } };
  const empty = await runModelsCommand("models-list", [], deps);
  assert.equal(empty.total, 0);
  assert.match(String(empty.hint), /models-sync/);
  const s1 = await runModelsCommand("models-sync", [], deps);
  assert.deepEqual([s1.ok, s1.status, s1.models, s1.db], [true, "updated", 10, dbPath]);
  const s2 = await runModelsCommand("models-sync", ["--db", dbPath], deps);
  assert.equal(s2.status, "not-modified");
  const list = await runModelsCommand("models-list", ["--provider", "anthropic", "--limit", "2"], deps) as any;
  assert.equal(list.count, 2);
  assert.equal(list.total, 10);
  assert.deepEqual(Object.keys(list.models[0]), ["id", "name", "context", "output", "input$", "output$", "modalities"]);
  const search = await runModelsCommand("models-list", ["--search", "MiniMax"], deps) as any;
  assert.deepEqual(search.models.map((m: any) => m.id), ["minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M3.1-Flash"]);
  const show = await runModelsCommand("models-show", ["minimax-cn/MiniMax-M3.1-Flash", "--raw"], deps) as any;
  assert.equal(show.model.contextWindow, 1_000_000);
  assert.equal(show.raw.canonical_model_id, "minimax/MiniMax-M3.1-Flash");
  const miss = await runModelsCommand("models-show", ["nope/nothing"], deps);
  assert.equal(miss.ok, false);
  const info = await runModelsCommand("llm-model-info", ["minimax"], { ...deps, registry: loadProviderRegistry({ json: { providers: [] } }) }) as any;
  assert.equal(info.ok, true);
  assert.equal(info.metadata.provider, "minimax-cn");
  await assert.rejects(runModelsCommand("models-list", ["--limit=-1"], deps), /non-negative/);
  await assert.rejects(runModelsCommand("models-list", ["--bogus"], deps), /Unknown option/);
  await assert.rejects(runModelsCommand("models-show", [], deps), /usage/);
  await assert.rejects(runModelsCommand("llm-model-info", ["unknown-provider"], deps), /unknown LLM provider/);
});
