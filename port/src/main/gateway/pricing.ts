// PORT-NEW (docs/29 §1): the local gateway ledger's PER-MODEL price table.
//
// Resolution order for a model id (first hit wins; every ledger entry records the price it was charged at and
// where that price came from, so a later table change never rewrites history):
//   1. VIDEOCLAW_PORT_LOCAL_GATEWAY_PRICES  — owner override, JSON {"<model>": {"input":…, "output":…, "cacheRead":…, "cacheWrite":…}}
//                                             (USD per million tokens; "*" = default for any other model)
//   2. the models.dev catalog the port already syncs (models-dev/db.ts, node:sqlite) — cost_input / cost_output /
//      cost_cache_read / cost_cache_write of the best matching row (provider "minimax" first, then any provider)
//   3. MINIMAX_FALLBACK_PRICES                — MiniMax's published per-token price for the models the shim serves
//   4. the default model's fallback price     — an unknown model is never free
//
// Cost of one call (Anthropic usage semantics: input_tokens EXCLUDES cache hits/writes):
//   usd = (input·in + cacheRead·cacheRead$ + cacheWrite·(cacheWrite$ ?? in) + output·out) / 1e6
import { existsSync } from "node:fs";
import { defaultModelsDbPath, ModelsDb, toMetadata } from "../models-dev/db";

export const LOCAL_GATEWAY_PRICES_ENV = "VIDEOCLAW_PORT_LOCAL_GATEWAY_PRICES";

export interface ModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheReadPerMTokUsd?: number;
  cacheWritePerMTokUsd?: number;
  /** where this price came from: "env", "models.dev:<provider>/<model>", "minimax-fallback/2026-10", … */
  source: string;
}
export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }

/** MiniMax's price for the models the shim forwards to (USD per million tokens). M3.1-Flash: input 0.15,
 *  output 0.6, cache read 0.015 (task brief, docs/29 §1). */
export const MINIMAX_FALLBACK_PRICES: Readonly<Record<string, Omit<ModelPrice, "source">>> = {
  "MiniMax-M3.1-Flash": { inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6, cacheReadPerMTokUsd: 0.015 },
};
export const FALLBACK_SOURCE = "minimax-fallback/2026-10";
export const DEFAULT_PRICED_MODEL = "MiniMax-M3.1-Flash";

const round9 = (n: number) => Math.round(n * 1e9) / 1e9;
export function costUsd(price: ModelPrice, u: TokenUsage): number {
  const cr = u.cacheReadTokens ?? 0, cw = u.cacheWriteTokens ?? 0;
  const usd = u.inputTokens * price.inputPerMTokUsd
    + cr * (price.cacheReadPerMTokUsd ?? price.inputPerMTokUsd)
    + cw * (price.cacheWritePerMTokUsd ?? price.inputPerMTokUsd)
    + u.outputTokens * price.outputPerMTokUsd;
  return round9(usd / 1e6);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
function fromRecord(r: any, source: string): ModelPrice | undefined {
  const input = num(r?.input ?? r?.inputPerMTokUsd), output = num(r?.output ?? r?.outputPerMTokUsd);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = num(r?.cacheRead ?? r?.cache_read ?? r?.cacheReadPerMTokUsd), cacheWrite = num(r?.cacheWrite ?? r?.cache_write ?? r?.cacheWritePerMTokUsd);
  return { inputPerMTokUsd: input, outputPerMTokUsd: output, ...(cacheRead !== undefined ? { cacheReadPerMTokUsd: cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWritePerMTokUsd: cacheWrite } : {}), source };
}

/** Parse the owner override (bad JSON → ignored, never fatal). */
export function envPrices(env: NodeJS.ProcessEnv = process.env): Record<string, ModelPrice> {
  const raw = env[LOCAL_GATEWAY_PRICES_ENV];
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    const out: Record<string, ModelPrice> = {};
    for (const [model, r] of Object.entries(j ?? {})) { const p = fromRecord(r, "env"); if (p) out[model] = p; }
    return out;
  } catch { return {}; }
}

/** Look a model up in the synced models.dev catalog (read-only; undefined when never synced / no row). */
export type CatalogLookup = (model: string) => ModelPrice | undefined;
export function modelsDevLookup(dbPath = defaultModelsDbPath()): CatalogLookup {
  let db: ModelsDb | null | undefined;
  const open = () => {
    if (db !== undefined) return db;
    try { db = existsSync(dbPath) ? new ModelsDb(dbPath) : null; } catch { db = null; }
    return db;
  };
  const cache = new Map<string, ModelPrice | undefined>();
  return (model) => {
    if (cache.has(model)) return cache.get(model);
    let hit: ModelPrice | undefined;
    const d = open();
    if (d) {
      try {
        const row = d.findModel({ provider: "minimax", model }) ?? d.findModel({ model });
        const md = row ? toMetadata(row) : undefined;
        if (md?.pricing) hit = fromRecord(md.pricing, `models.dev:${md.provider}/${md.model}`);
      } catch {}
    }
    cache.set(model, hit);
    return hit;
  };
}

export interface PriceTableOptions { env?: NodeJS.ProcessEnv; catalog?: CatalogLookup | null; defaultModel?: string }
/** The resolver the shim charges with. */
export function priceTable(o: PriceTableOptions = {}): (model: string) => ModelPrice {
  const overrides = envPrices(o.env ?? process.env);
  const catalog = o.catalog === undefined ? modelsDevLookup() : o.catalog;
  const def = o.defaultModel ?? DEFAULT_PRICED_MODEL;
  const fallback = (m: string) => { const f = MINIMAX_FALLBACK_PRICES[m]; return f ? { ...f, source: FALLBACK_SOURCE } : undefined; };
  return (model) => overrides[model]
    ?? catalog?.(model)
    ?? fallback(model)
    ?? overrides["*"]
    ?? (catalog?.(def) ? { ...catalog(def)!, source: `${catalog(def)!.source} (default for ${model})` } : undefined)
    ?? { ...fallback(def)!, source: `${FALLBACK_SOURCE} (default for ${model})` };
}
