// PORT-NEW (docs/29 §1): the local gateway ledger's PER-MODEL price table.
//
// Resolution order for a model id (first hit wins; every ledger entry records the price it was charged at and
// where that price came from, so a later table change never rewrites history):
//   1. VIDEOCLAW_PORT_LOCAL_GATEWAY_PRICES  — owner override, JSON {"<model>": {"input":…, "output":…, "cacheRead":…, "cacheWrite":…}}
//                                             (USD per million tokens; "*" = default for any other model)
//   2. the models.dev catalog the port syncs (models-dev/db.ts, node:sqlite; the app syncs it at startup, docs/30) —
//      cost_input / cost_output / cost_cache_read / cost_cache_write of the row of the MiniMax provider actually called
//      (minimaxModelsDevProviders: api.minimaxi.com → "minimax-cn" then "minimax"; never a reseller / $0 plan row)
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

/** docs/30: the models.dev provider ids whose rows price the MiniMax endpoint actually called. api.minimaxi.com is
 *  the China site (models.dev "minimax-cn"), api.minimax.io the international one ("minimax"); each falls back to
 *  the other. Rows of other providers (resellers, $0 "coding-plan" bundles) never price a MiniMax call. */
export function minimaxModelsDevProviders(baseUrl: string | undefined): string[] {
  return /minimaxi\.com/i.test(baseUrl ?? "") ? ["minimax-cn", "minimax"] : ["minimax", "minimax-cn"];
}
/** Look a model up in the synced models.dev catalog (read-only; undefined when never synced / no row). Only
 *  positive hits are cached, so a catalog synced after startup is picked up on the next lookup. */
export type CatalogLookup = (model: string) => ModelPrice | undefined;
export function modelsDevLookup(dbPath = defaultModelsDbPath(), providers: string[] = ["minimax", "minimax-cn"]): CatalogLookup {
  const cache = new Map<string, ModelPrice>();
  return (model) => {
    const cached = cache.get(model);
    if (cached) return cached;
    let hit: ModelPrice | undefined;
    let d: ModelsDb | undefined;
    try {
      if (!existsSync(dbPath)) return undefined;
      d = new ModelsDb(dbPath);
      for (const provider of providers) {
        const row = d.getModel(provider, model);
        const md = row ? toMetadata(row) : undefined;
        if (md?.pricing) { hit = fromRecord(md.pricing, `models.dev:${md.provider}/${md.model}`); if (hit) break; }
      }
    } catch { hit = undefined; } finally { try { (d as any)?.close?.(); } catch {} }
    if (hit) cache.set(model, hit);
    return hit;
  };
}

export interface PriceTableOptions { env?: NodeJS.ProcessEnv; catalog?: CatalogLookup | null; defaultModel?: string; providers?: string[]; onResolve?: (model: string, price: ModelPrice) => void }
/** The resolver the shim charges with — and (docs/30) the one every route's displayed spend is priced with. */
export function priceTable(o: PriceTableOptions = {}): (model: string) => ModelPrice {
  const resolve = priceTableRaw(o);
  const seen = new Map<string, string>();
  return (model) => {
    const p = resolve(model);
    if (o.onResolve && seen.get(model) !== p.source) { seen.set(model, p.source); try { o.onResolve(model, p); } catch {} }
    return p;
  };
}
function priceTableRaw(o: PriceTableOptions): (model: string) => ModelPrice {
  const overrides = envPrices(o.env ?? process.env);
  const catalog = o.catalog === undefined ? modelsDevLookup(undefined, o.providers) : o.catalog;
  const def = o.defaultModel ?? DEFAULT_PRICED_MODEL;
  const fallback = (m: string) => { const f = MINIMAX_FALLBACK_PRICES[m]; return f ? { ...f, source: FALLBACK_SOURCE } : undefined; };
  return (model) => overrides[model]
    ?? catalog?.(model)
    ?? fallback(model)
    ?? overrides["*"]
    ?? (catalog?.(def) ? { ...catalog(def)!, source: `${catalog(def)!.source} (default for ${model})` } : undefined)
    ?? { ...fallback(def)!, source: `${FALLBACK_SOURCE} (default for ${model})` };
}
