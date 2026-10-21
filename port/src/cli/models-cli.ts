// PORT-NEW: models.dev CLI subcommands (docs/15 §6), split out of port-cli.ts so they are testable.
//   models-sync  [--db P] [--url U] [--force] [--timeout MS]
//   models-list  [--db P] [--provider ID] [--search Q] [--limit N] [--offset N]
//   models-show  <provider/model | model> [--db P] [--provider ID] [--raw]
//   llm-model-info <providerName> [--db P]      (generic provider → models.dev metadata)
import { parseArgs } from "node:util";
import { defaultModelsDbPath, ModelsDb, toMetadata } from "../main/models-dev/db";
import { providerModelMetadata } from "../main/models-dev/lookup";
import { MODELS_DEV_SOURCE, syncModelsDev } from "../main/models-dev/sync";
import { getProviderRegistry, type ProviderRegistry } from "../main/llm/provider-registry";
import type { Logger } from "../main/llm/logger";

export const MODELS_COMMANDS = ["models-sync", "models-list", "models-show", "llm-model-info"] as const;
export interface ModelsCliDeps { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; registry?: ProviderRegistry; logger?: Logger }

export async function runModelsCommand(cmd: string, argv: string[], deps: ModelsCliDeps = {}): Promise<Record<string, unknown>> {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: { db: { type: "string" }, url: { type: "string" }, force: { type: "boolean" }, timeout: { type: "string" }, provider: { type: "string" }, search: { type: "string" }, limit: { type: "string" }, offset: { type: "string" }, raw: { type: "boolean" } },
  });
  const dbPath = values.db ?? defaultModelsDbPath(deps.env);
  const int = (v: string | undefined, name: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
    return n;
  };
  const db = new ModelsDb(dbPath);
  try {
    switch (cmd) {
      case "models-sync": {
        const r = await syncModelsDev(db, { url: values.url, force: values.force, timeoutMs: int(values.timeout, "timeout"), fetchImpl: deps.fetchImpl, logger: deps.logger });
        return { ...r, step: cmd, db: dbPath };
      }
      case "models-list": {
        const rows = db.listModels({ provider: values.provider, search: values.search, limit: int(values.limit, "limit"), offset: int(values.offset, "offset") });
        const meta = db.getMeta(MODELS_DEV_SOURCE);
        return {
          ok: true, step: cmd, db: dbPath, total: db.counts().models, lastSyncedAt: meta?.last_synced_at ?? null, count: rows.length,
          models: rows.map((r) => ({ id: `${r.provider_id}/${r.model_id}`, name: r.name, context: r.context_limit, output: r.output_limit, input$: r.cost_input, output$: r.cost_output, modalities: JSON.parse(r.input_modalities) })),
          ...(db.counts().models === 0 ? { hint: "catalog is empty — run models-sync" } : {}),
        };
      }
      case "models-show": {
        const ref = positionals[0];
        if (!ref) throw new Error("usage: models-show <provider/model | model> [--provider ID]");
        const row = db.findModel({ provider: values.provider, model: ref });
        if (!row) return { ok: false, step: cmd, db: dbPath, error: `model not found: ${ref}${db.counts().models === 0 ? " (catalog is empty — run models-sync)" : ""}` };
        return { ok: true, step: cmd, model: toMetadata(row), ...(values.raw ? { raw: JSON.parse(row.raw_json) } : {}) };
      }
      case "llm-model-info": {
        const name = positionals[0];
        if (!name) throw new Error("usage: llm-model-info <providerName>");
        const reg = deps.registry ?? getProviderRegistry();
        const cfg = reg.require(name);
        const md = providerModelMetadata(db, cfg);
        // docs/17: models.dev capability → suggested structuredOutput mode (a hint only: the catalog
        // describes the model, not whether a given compatible endpoint honors the native field)
        const caps = md?.capabilities;
        const suggested = caps?.structuredOutput === true ? "native" : caps?.structuredOutput === false ? (caps.toolCall ? "tool" : "off") : undefined;
        const structuredOutput = { configured: cfg.structuredOutput, ...(suggested ? { suggested, matches: suggested === cfg.structuredOutput } : {}) };
        return md ? { ok: true, step: cmd, provider: name, model: cfg.model, metadata: md, structuredOutput } : { ok: false, step: cmd, provider: name, model: cfg.model, error: "no models.dev metadata for this model (run models-sync, or set modelsDev.provider/model in the provider config)" };
      }
      default:
        throw new Error(`unknown models subcommand ${cmd}`);
    }
  } finally {
    db.close();
  }
}
