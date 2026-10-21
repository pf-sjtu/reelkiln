// PORT-NEW: local SQLite store for the models.dev catalog (docs/15 §5.2).
// Engine: node:sqlite (DatabaseSync) — built into Node ≥22.5 and into Electron 42's Node 24.19
// (verified on the box: `ELECTRON_RUN_AS_NODE=1 electron -e "require('node:sqlite')"` → SQLite
// 3.53.3), so there is no native addon to rebuild per Electron ABI / per OS (better-sqlite3 would
// need electron-rebuild + prebuilt binaries for win32/darwin/linux).
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CatalogModel, ParsedCatalog } from "./catalog";

export const MODELS_DB_ENV = "VIDEOCLAW_MODELS_DB";
export function defaultModelsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[MODELS_DB_ENV]?.trim() || join(homedir(), ".videoclaw-port", "models-dev.sqlite");
}

/** Ordered migrations; PRAGMA user_version = number applied. Never edit a shipped entry — append. */
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE providers (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     api TEXT,
     npm TEXT,
     doc TEXT,
     env_json TEXT NOT NULL DEFAULT '[]',
     raw_json TEXT NOT NULL,
     synced_at TEXT NOT NULL
   );
   CREATE TABLE models (
     provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
     model_id TEXT NOT NULL,
     name TEXT,
     family TEXT,
     type TEXT,
     status TEXT,
     canonical_id TEXT,
     context_limit INTEGER,
     input_limit INTEGER,
     output_limit INTEGER,
     cost_input REAL,
     cost_output REAL,
     cost_cache_read REAL,
     cost_cache_write REAL,
     cost_json TEXT,
     input_modalities TEXT NOT NULL DEFAULT '[]',
     output_modalities TEXT NOT NULL DEFAULT '[]',
     reasoning INTEGER,
     tool_call INTEGER,
     attachment INTEGER,
     structured_output INTEGER,
     temperature INTEGER,
     open_weights INTEGER,
     knowledge TEXT,
     release_date TEXT,
     last_updated TEXT,
     raw_json TEXT NOT NULL,
     synced_at TEXT NOT NULL,
     PRIMARY KEY (provider_id, model_id)
   );
   CREATE INDEX models_by_model_id ON models(model_id COLLATE NOCASE);
   CREATE INDEX models_by_canonical ON models(canonical_id);
   CREATE TABLE sync_meta (
     source TEXT PRIMARY KEY,
     url TEXT,
     etag TEXT,
     last_modified TEXT,
     content_sha256 TEXT,
     last_synced_at TEXT,
     last_attempt_at TEXT,
     last_status TEXT,
     last_error TEXT,
     provider_count INTEGER,
     model_count INTEGER
   );`,
];

export class ModelsDb {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }
  close(): void { this.db.close(); }

  schemaVersion(): number { return Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version); }

  migrate(): number {
    const from = this.schemaVersion();
    if (from > MIGRATIONS.length) throw new Error(`models DB schema v${from} is newer than this build (v${MIGRATIONS.length})`);
    for (let v = from; v < MIGRATIONS.length; v++) {
      this.tx(() => { this.db.exec(MIGRATIONS[v]); this.db.exec(`PRAGMA user_version = ${v + 1}`); });
    }
    return MIGRATIONS.length - from;
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getMeta(source = "models.dev"): SyncMeta | undefined {
    return this.db.prepare("SELECT * FROM sync_meta WHERE source = ?").get(source) as SyncMeta | undefined;
  }
  /** Upserts the given columns of the sync_meta row (others untouched). */
  setMeta(source: string, fields: Partial<Omit<SyncMeta, "source">>): void {
    const cols = Object.keys(fields) as Array<keyof typeof fields>;
    if (!cols.length) return;
    this.db.prepare(`INSERT INTO sync_meta (source, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})
      ON CONFLICT(source) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`)
      .run(source, ...cols.map((c) => (fields[c] ?? null) as string | number | null));
  }

  /** Replaces the catalog snapshot in ONE transaction: upserts every provider/model, then deletes
   *  rows absent from the snapshot. Idempotent — the same catalog yields the same rows. */
  replaceCatalog(cat: ParsedCatalog, syncedAt = new Date().toISOString()): { providers: number; models: number; removedProviders: number; removedModels: number } {
    const upP = this.db.prepare(`INSERT INTO providers (id, name, api, npm, doc, env_json, raw_json, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, api=excluded.api, npm=excluded.npm, doc=excluded.doc, env_json=excluded.env_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at`);
    const upM = this.db.prepare(`INSERT INTO models (provider_id, model_id, name, family, type, status, canonical_id, context_limit, input_limit, output_limit,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_json, input_modalities, output_modalities, reasoning, tool_call, attachment,
        structured_output, temperature, open_weights, knowledge, release_date, last_updated, raw_json, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, model_id) DO UPDATE SET name=excluded.name, family=excluded.family, type=excluded.type, status=excluded.status,
        canonical_id=excluded.canonical_id, context_limit=excluded.context_limit, input_limit=excluded.input_limit, output_limit=excluded.output_limit,
        cost_input=excluded.cost_input, cost_output=excluded.cost_output, cost_cache_read=excluded.cost_cache_read, cost_cache_write=excluded.cost_cache_write,
        cost_json=excluded.cost_json, input_modalities=excluded.input_modalities, output_modalities=excluded.output_modalities, reasoning=excluded.reasoning,
        tool_call=excluded.tool_call, attachment=excluded.attachment, structured_output=excluded.structured_output, temperature=excluded.temperature,
        open_weights=excluded.open_weights, knowledge=excluded.knowledge, release_date=excluded.release_date, last_updated=excluded.last_updated,
        raw_json=excluded.raw_json, synced_at=excluded.synced_at`);
    const b = (v: boolean | undefined) => (v === undefined ? null : v ? 1 : 0);
    const n = (v: number | undefined) => (v === undefined ? null : v);
    const s = (v: string | undefined) => (v === undefined ? null : v);
    this.db.exec("CREATE TEMP TABLE IF NOT EXISTS seen_p (id TEXT PRIMARY KEY); CREATE TEMP TABLE IF NOT EXISTS seen_m (provider_id TEXT, model_id TEXT, PRIMARY KEY (provider_id, model_id));");
    const seenP = this.db.prepare("INSERT OR IGNORE INTO seen_p (id) VALUES (?)");
    const seenM = this.db.prepare("INSERT OR IGNORE INTO seen_m (provider_id, model_id) VALUES (?, ?)");
    return this.tx(() => {
      this.db.exec("DELETE FROM seen_p; DELETE FROM seen_m;");
      let models = 0;
      for (const p of cat.providers) {
        seenP.run(p.id);
        upP.run(p.id, p.name, s(p.api), s(p.npm), s(p.doc), JSON.stringify(p.env), JSON.stringify(p.raw), syncedAt);
        for (const m of p.models) {
          upM.run(p.id, m.id, s(m.name), s(m.family), s(m.type), s(m.status), s(m.canonical_model_id),
            n(m.limit?.context), n(m.limit?.input), n(m.limit?.output),
            n(m.cost?.input), n(m.cost?.output), n(m.cost?.cache_read), n(m.cost?.cache_write), m.cost ? JSON.stringify(m.cost) : null,
            JSON.stringify(m.modalities?.input ?? []), JSON.stringify(m.modalities?.output ?? []),
            b(m.reasoning), b(m.tool_call), b(m.attachment), b(m.structured_output), b(m.temperature), b(m.open_weights),
            s(m.knowledge), s(m.release_date), s(m.last_updated), JSON.stringify(m), syncedAt);
          seenM.run(p.id, m.id);
          models++;
        }
      }
      const removedModels = Number(this.db.prepare("DELETE FROM models WHERE NOT EXISTS (SELECT 1 FROM seen_m s WHERE s.provider_id = models.provider_id AND s.model_id = models.model_id)").run().changes);
      const removedProviders = Number(this.db.prepare("DELETE FROM providers WHERE id NOT IN (SELECT id FROM seen_p)").run().changes);
      return { providers: cat.providers.length, models, removedProviders, removedModels };
    });
  }

  counts(): { providers: number; models: number } {
    const p = this.db.prepare("SELECT COUNT(*) AS c FROM providers").get() as { c: number };
    const m = this.db.prepare("SELECT COUNT(*) AS c FROM models").get() as { c: number };
    return { providers: Number(p.c), models: Number(m.c) };
  }

  listModels(o: { provider?: string; search?: string; limit?: number; offset?: number } = {}): ModelRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (o.provider) { where.push("provider_id = ?"); args.push(o.provider); }
    if (o.search) { where.push("(model_id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR family LIKE ? ESCAPE '\\')"); const q = `%${o.search.replace(/[\\%_]/g, (c) => "\\" + c)}%`; args.push(q, q, q); }
    const sql = `SELECT * FROM models ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY provider_id, model_id LIMIT ? OFFSET ?`;
    return (this.db.prepare(sql).all(...args, Math.max(1, Math.min(10_000, o.limit ?? 50)), Math.max(0, o.offset ?? 0)) as unknown as ModelRow[]);
  }

  getModel(providerId: string, modelId: string): ModelRow | undefined {
    return this.db.prepare("SELECT * FROM models WHERE provider_id = ? AND model_id = ?").get(providerId, modelId) as ModelRow | undefined;
  }

  /** Resolution order: exact (provider, model) → "provider/model" ref split on the first "/" →
   *  canonical id → model id (case-insensitive) across providers (first by provider id). */
  findModel(ref: { provider?: string; model: string }): ModelRow | undefined {
    if (ref.provider) {
      const exact = this.getModel(ref.provider, ref.model);
      if (exact) return exact;
    } else {
      const i = ref.model.indexOf("/");
      if (i > 0) { const hit = this.getModel(ref.model.slice(0, i), ref.model.slice(i + 1)); if (hit) return hit; }
    }
    const canon = ref.provider ? `${ref.provider}/${ref.model}` : ref.model;
    return (this.db.prepare("SELECT * FROM models WHERE canonical_id = ? ORDER BY provider_id LIMIT 1").get(canon) as ModelRow | undefined)
      ?? (this.db.prepare("SELECT * FROM models WHERE model_id = ? COLLATE NOCASE ORDER BY provider_id LIMIT 1").get(ref.model) as ModelRow | undefined);
  }
}

export interface SyncMeta {
  source: string; url: string | null; etag: string | null; last_modified: string | null; content_sha256: string | null;
  last_synced_at: string | null; last_attempt_at: string | null; last_status: string | null; last_error: string | null;
  provider_count: number | null; model_count: number | null;
}
export interface ModelRow {
  provider_id: string; model_id: string; name: string | null; family: string | null; type: string | null; status: string | null; canonical_id: string | null;
  context_limit: number | null; input_limit: number | null; output_limit: number | null;
  cost_input: number | null; cost_output: number | null; cost_cache_read: number | null; cost_cache_write: number | null; cost_json: string | null;
  input_modalities: string; output_modalities: string; reasoning: number | null; tool_call: number | null; attachment: number | null;
  structured_output: number | null; temperature: number | null; open_weights: number | null; knowledge: string | null; release_date: string | null;
  last_updated: string | null; raw_json: string; synced_at: string;
}

/** The metadata view the provider framework consumes. Costs: USD per 1M tokens (models.dev). */
export interface ModelMetadata {
  provider: string;
  model: string;
  name?: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  pricing?: { currency: "USD"; per: "1M tokens"; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; raw?: Record<string, unknown> };
  modalities: { input: string[]; output: string[] };
  capabilities: { reasoning?: boolean; toolCall?: boolean; attachment?: boolean; structuredOutput?: boolean; temperature?: boolean };
  status?: string;
  knowledge?: string;
  releaseDate?: string;
  lastUpdated?: string;
  syncedAt: string;
}

export function toMetadata(r: ModelRow): ModelMetadata {
  const bool = (v: number | null) => (v === null ? undefined : v === 1);
  const opt = <T>(v: T | null) => (v === null ? undefined : v);
  const caps = Object.fromEntries(Object.entries({ reasoning: bool(r.reasoning), toolCall: bool(r.tool_call), attachment: bool(r.attachment), structuredOutput: bool(r.structured_output), temperature: bool(r.temperature) }).filter(([, v]) => v !== undefined));
  const md: ModelMetadata = {
    provider: r.provider_id, model: r.model_id,
    modalities: { input: JSON.parse(r.input_modalities), output: JSON.parse(r.output_modalities) },
    capabilities: caps, syncedAt: r.synced_at,
  };
  const set = <K extends keyof ModelMetadata>(k: K, v: ModelMetadata[K] | undefined) => { if (v !== undefined) md[k] = v; };
  set("name", opt(r.name) ?? undefined);
  set("contextWindow", opt(r.context_limit));
  set("maxInputTokens", opt(r.input_limit));
  set("maxOutputTokens", opt(r.output_limit));
  if (r.cost_json) {
    const p: NonNullable<ModelMetadata["pricing"]> = { currency: "USD", per: "1M tokens" };
    if (r.cost_input !== null) p.input = r.cost_input;
    if (r.cost_output !== null) p.output = r.cost_output;
    if (r.cost_cache_read !== null) p.cacheRead = r.cost_cache_read;
    if (r.cost_cache_write !== null) p.cacheWrite = r.cost_cache_write;
    const raw = JSON.parse(r.cost_json) as Record<string, unknown>;
    const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !["input", "output", "cache_read", "cache_write"].includes(k)));
    if (Object.keys(extra).length) p.raw = extra;
    md.pricing = p;
  }
  set("status", opt(r.status));
  set("knowledge", opt(r.knowledge));
  set("releaseDate", opt(r.release_date));
  set("lastUpdated", opt(r.last_updated));
  return md;
}
export type { CatalogModel };
