// PORT-NEW: models.dev catalog parsing (docs/15 §5).
// Source: https://models.dev/api.json (verified 2026-10-21: ~5.9 MB, 232 providers / 9079 models,
// `etag` header + 304 on If-None-Match, no Last-Modified). Shape:
//   { [providerId]: { id, name, env: string[], npm?, api?, doc?, models: { [modelId]: Model } } }
// Model fields used: id, name, family, type, status, attachment, reasoning, tool_call,
// structured_output, temperature, open_weights, knowledge, release_date, last_updated,
// modalities{input[],output[]}, limit{context,input?,output}, cost{input,output,cache_read,
// cache_write,reasoning,…, tiers[], context_over_200k{}} (USD per 1M tokens), canonical_model_id.
// Parsing is lenient (unknown fields kept in raw_json); a malformed model is skipped and counted,
// never fatal, so an upstream schema addition cannot break the sync.
import { z } from "zod";

const num = z.number().finite();
const strArr = z.array(z.string());

export const ModelSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  family: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  temperature: z.boolean().optional(),
  open_weights: z.boolean().optional(),
  knowledge: z.string().optional(),
  release_date: z.string().optional(),
  last_updated: z.string().optional(),
  canonical_model_id: z.string().optional(),
  modalities: z.looseObject({ input: strArr.optional(), output: strArr.optional() }).optional(),
  limit: z.looseObject({ context: num.optional(), input: num.optional(), output: num.optional() }).optional(),
  cost: z.looseObject({ input: num.optional(), output: num.optional(), cache_read: num.optional(), cache_write: num.optional(), reasoning: num.optional() }).optional(),
});
export type CatalogModel = z.infer<typeof ModelSchema>;

export const ProviderSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  env: strArr.optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  doc: z.string().optional(),
  models: z.record(z.string(), z.unknown()),
});

export interface CatalogProvider {
  id: string;
  name: string;
  env: string[];
  npm?: string;
  api?: string;
  doc?: string;
  raw: Record<string, unknown>; // provider object minus `models`
  models: CatalogModel[];
}
export interface ParsedCatalog {
  providers: CatalogProvider[];
  modelCount: number;
  skipped: Array<{ provider: string; model?: string; issue: string }>;
  totalModelsSeen: number;
}

export class CatalogFormatError extends Error {
  readonly code = "CATALOG_INVALID";
  constructor(message: string) { super(message); this.name = "CatalogFormatError"; }
}

export function parseCatalog(json: unknown): ParsedCatalog {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new CatalogFormatError("models.dev catalog root must be an object keyed by provider id");
  const providers: CatalogProvider[] = [];
  const skipped: ParsedCatalog["skipped"] = [];
  let modelCount = 0, totalModelsSeen = 0;
  for (const [key, rawP] of Object.entries(json as Record<string, unknown>)) {
    const p = ProviderSchema.safeParse(rawP);
    if (!p.success) { skipped.push({ provider: key, issue: p.error.issues[0]?.message ?? "invalid provider" }); continue; }
    const { models, ...rest } = p.data;
    const parsed: CatalogModel[] = [];
    for (const [mk, rawM] of Object.entries(models)) {
      totalModelsSeen++;
      const m = ModelSchema.safeParse(rawM);
      if (!m.success) { skipped.push({ provider: key, model: mk, issue: `${m.error.issues[0]?.path.join(".")}: ${m.error.issues[0]?.message}` }); continue; }
      parsed.push({ ...m.data, id: mk }); // the map key is authoritative (== id in every observed entry)
    }
    modelCount += parsed.length;
    providers.push({ id: key, name: p.data.name ?? key, env: p.data.env ?? [], npm: p.data.npm, api: p.data.api, doc: p.data.doc, raw: rest, models: parsed });
  }
  return { providers, modelCount, skipped, totalModelsSeen };
}
