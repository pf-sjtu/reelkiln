// docs/30 PORT-NEW: models.dev is THE price source of every displayed / ledgered LLM cost (gateway/pricing.ts). The
// app refreshes the local catalog in the background at launch when it was never synced or is older than a day
// (VIDEOCLAW_PORT_MODELS_DEV_SYNC=0 disables; the CLI `models-sync` stays the manual path). Failure is non-fatal:
// prices then come from the env table / the documented MiniMax fallback, and the source is logged per model.
import { defaultModelsDbPath, ModelsDb } from "./db";
import { syncModelsDev } from "./sync";

export const MODELS_DEV_MAX_AGE_MS = 24 * 3600 * 1000;
export async function syncModelsDevIfStale(o: { env?: NodeJS.ProcessEnv; log?: (line: string) => void; now?: () => number; sync?: typeof syncModelsDev; dbPath?: string } = {}): Promise<"disabled" | "fresh" | "synced" | "failed"> {
  const env = o.env ?? process.env;
  if (env.VIDEOCLAW_PORT_MODELS_DEV_SYNC === "0") return "disabled";
  let db: ModelsDb | undefined;
  try {
    db = new ModelsDb(o.dbPath ?? defaultModelsDbPath(env));
    const last = Date.parse(String(db.getMeta()?.last_synced_at ?? ""));
    if (Number.isFinite(last) && (o.now ?? Date.now)() - last < MODELS_DEV_MAX_AGE_MS) { o.log?.(`[port] models.dev catalog fresh (last synced ${new Date(last).toISOString()})`); return "fresh"; }
    const r: any = await (o.sync ?? syncModelsDev)(db);
    o.log?.(`[port] models.dev catalog ${r?.status ?? "synced"}: ${r?.providers ?? "?"} providers / ${r?.models ?? "?"} models`);
    return "synced";
  } catch (e) {
    o.log?.(`[port] models.dev sync failed (prices fall back per docs/30): ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  } finally { try { db?.close(); } catch {} }
}
