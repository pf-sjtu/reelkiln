// PORT-NEW: models.dev → SQLite sync (docs/15 §5.3).
//  - conditional GET: If-None-Match (etag) / If-Modified-Since (if a Last-Modified was ever seen);
//    304 → "not-modified", nothing rewritten.
//  - content hash: a 200 whose sha256 equals the stored one → "unchanged", nothing rewritten.
//  - idempotent: ModelsDb.replaceCatalog() is one transaction (upsert + prune).
//  - offline-safe: network/HTTP/parse failures NEVER touch catalog rows; they are recorded in
//    sync_meta (last_status/last_error) and returned as { ok:false, status:"failed" }.
//  - sanity guard: a catalog with no providers, or with less than half the previous model count,
//    or where more than half of the models fail validation, is rejected (keeps the last good data).
import { createHash } from "node:crypto";
import { getLogger, type Logger } from "../llm/logger";
import { CatalogFormatError, parseCatalog } from "./catalog";
import type { ModelsDb } from "./db";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const MODELS_DEV_SOURCE = "models.dev";
const MAX_BYTES = 64 * 1024 * 1024;

export type SyncErrorCode = "NETWORK" | "TIMEOUT" | "HTTP_ERROR" | "TOO_LARGE" | "CATALOG_INVALID" | "SANITY_CHECK_FAILED" | "DB_ERROR";
export interface SyncResult {
  ok: boolean;
  status: "updated" | "not-modified" | "unchanged" | "failed";
  url: string;
  providers: number; // rows in the DB after the run
  models: number;
  skipped?: number;
  removed?: { providers: number; models: number };
  etag?: string | null;
  error?: { code: SyncErrorCode; message: string; httpStatus?: number };
  lastSyncedAt?: string | null;
  durationMs: number;
}

export interface SyncOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Ignore etag / content hash and rewrite. */
  force?: boolean;
  logger?: Logger;
  now?: () => Date;
}

class SyncError extends Error {
  constructor(readonly code: SyncErrorCode, message: string, readonly httpStatus?: number) { super(message); }
}

export async function syncModelsDev(db: ModelsDb, o: SyncOptions = {}): Promise<SyncResult> {
  const url = o.url ?? MODELS_DEV_URL;
  const log = (o.logger ?? getLogger()).child({ component: "models-dev-sync" });
  const now = o.now ?? (() => new Date());
  const t0 = Date.now();
  const prev = db.getMeta(MODELS_DEV_SOURCE);
  const attemptAt = now().toISOString();
  const finish = (r: Omit<SyncResult, "url" | "providers" | "models" | "durationMs" | "lastSyncedAt">): SyncResult => {
    const c = db.counts();
    const res: SyncResult = { ...r, url, ...c, lastSyncedAt: db.getMeta(MODELS_DEV_SOURCE)?.last_synced_at ?? null, durationMs: Date.now() - t0 };
    (res.ok ? log.info : log.warn)("models_dev.sync", { status: res.status, providers: res.providers, models: res.models, error: res.error, durationMs: res.durationMs });
    return res;
  };
  try {
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "videoclaw-port-models-sync/1" };
    const sameSource = prev?.url === url && db.counts().models > 0; // validators only apply to the URL they came from
    if (!o.force && sameSource && prev?.etag) headers["if-none-match"] = prev.etag;
    if (!o.force && sameSource && prev?.last_modified) headers["if-modified-since"] = prev.last_modified;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 60_000);
    let res: Response, buf: ArrayBuffer;
    try {
      res = await (o.fetchImpl ?? fetch)(url, { headers, signal: controller.signal });
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > MAX_BYTES) throw new SyncError("TOO_LARGE", `catalog is ${len} bytes (> ${MAX_BYTES})`);
      buf = await res.arrayBuffer();
    } catch (e) {
      if (e instanceof SyncError) throw e;
      if (controller.signal.aborted) throw new SyncError("TIMEOUT", `timed out after ${o.timeoutMs ?? 60_000}ms`);
      const c = (e as { cause?: { code?: string; errors?: Array<{ code?: string }> } })?.cause;
      const cause = c?.code ?? c?.errors?.find((x) => x.code)?.code ?? (c as { message?: string } | undefined)?.message;
      throw new SyncError("NETWORK", `${e instanceof Error ? e.message : String(e)}${cause ? ` (${cause})` : ""}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 304) {
      db.setMeta(MODELS_DEV_SOURCE, { url, last_attempt_at: attemptAt, last_status: "not-modified", last_error: null });
      return finish({ ok: true, status: "not-modified", etag: prev?.etag ?? null });
    }
    if (!res.ok) throw new SyncError("HTTP_ERROR", `HTTP ${res.status}`, res.status);
    if (buf.byteLength > MAX_BYTES) throw new SyncError("TOO_LARGE", `catalog is ${buf.byteLength} bytes`);
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    const sha = createHash("sha256").update(new Uint8Array(buf)).digest("hex");
    if (!o.force && prev?.content_sha256 === sha && db.counts().models > 0) {
      db.setMeta(MODELS_DEV_SOURCE, { url, etag, last_modified: lastModified, last_attempt_at: attemptAt, last_status: "unchanged", last_error: null });
      return finish({ ok: true, status: "unchanged", etag });
    }
    let json: unknown;
    try { json = JSON.parse(new TextDecoder().decode(buf)); } catch { throw new SyncError("CATALOG_INVALID", "response is not valid JSON"); }
    let cat;
    try { cat = parseCatalog(json); } catch (e) { throw new SyncError("CATALOG_INVALID", e instanceof CatalogFormatError ? e.message : String(e)); }
    const prevModels = db.counts().models;
    if (cat.providers.length === 0 || cat.modelCount === 0) throw new SyncError("SANITY_CHECK_FAILED", "catalog contains no providers/models");
    if (cat.totalModelsSeen > 0 && cat.modelCount < cat.totalModelsSeen / 2) throw new SyncError("SANITY_CHECK_FAILED", `${cat.totalModelsSeen - cat.modelCount}/${cat.totalModelsSeen} models failed validation (schema change?)`);
    if (!o.force && prevModels > 0 && cat.modelCount < prevModels / 2) throw new SyncError("SANITY_CHECK_FAILED", `model count dropped from ${prevModels} to ${cat.modelCount}; use --force to accept`);
    if (cat.skipped.length) log.warn("models_dev.skipped", { count: cat.skipped.length, sample: cat.skipped.slice(0, 5) });
    const syncedAt = now().toISOString();
    let r;
    try { r = db.replaceCatalog(cat, syncedAt); } catch (e) { throw new SyncError("DB_ERROR", e instanceof Error ? e.message : String(e)); }
    db.setMeta(MODELS_DEV_SOURCE, {
      url, etag, last_modified: lastModified, content_sha256: sha, last_synced_at: syncedAt, last_attempt_at: attemptAt,
      last_status: "updated", last_error: null, provider_count: r.providers, model_count: r.models,
    });
    return finish({ ok: true, status: "updated", etag, skipped: cat.skipped.length, removed: { providers: r.removedProviders, models: r.removedModels } });
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError("DB_ERROR", e instanceof Error ? e.message : String(e));
    try { db.setMeta(MODELS_DEV_SOURCE, { url, last_attempt_at: attemptAt, last_status: "failed", last_error: `${err.code}: ${err.message}`.slice(0, 500) }); } catch { /* DB itself unusable */ }
    return finish({ ok: false, status: "failed", etag: prev?.etag ?? null, error: { code: err.code, message: err.message, ...(err.httpStatus ? { httpStatus: err.httpStatus } : {}) } });
  }
}
