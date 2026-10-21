// PORT-NEW: provider framework ↔ models.dev metadata (docs/15 §5.4).
import type { ProviderConfig } from "../llm/provider-config";
import type { ResolvedProvider } from "../llm/provider-registry";
import { toMetadata, type ModelMetadata, type ModelsDb } from "./db";

/** Metadata (context window, pricing, modalities, capabilities) for a provider's model, keyed by
 *  its `modelsDev` config (provider defaults to the provider name, model to the configured model).
 *  Falls back to a cross-provider lookup by model id. undefined when the DB has no match (e.g. never
 *  synced) — callers must treat metadata as optional. */
export function providerModelMetadata(db: ModelsDb, p: Pick<ResolvedProvider, "modelsDev"> | ProviderConfig, model?: string): ModelMetadata | undefined {
  const ref = "apiKeyEnv" in p
    ? { provider: p.modelsDev.provider ?? p.name, model: model ?? p.modelsDev.model ?? p.model }
    : { provider: p.modelsDev.provider, model: model ?? p.modelsDev.model };
  const row = db.findModel(ref);
  return row ? toMetadata(row) : undefined;
}
