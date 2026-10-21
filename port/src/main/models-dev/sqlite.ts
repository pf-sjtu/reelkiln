// PORT-NEW (docs/15 §4.2): node:sqlite capability guard. node:sqlite is built into Node/Electron
// (no native addon), but only in recent versions, so it is loaded LAZILY through this module: a
// runtime without it gets a clear typed error at the point of use instead of the whole bundle
// failing to load (a static `import … from "node:sqlite"` throws at module-evaluation time).
//
// Minimum versions (sources: nodejs.org/api/sqlite.html history; electron/electron#45532, #47671, #47706):
//   Node      ≥ 22.13.0 (22.x LTS) or ≥ 23.4.0 — unflagged. 22.5–22.12 need --experimental-sqlite.
//   Electron  ≥ 35.0.2 (bundles Node 22.14). Known regression "No such binding: sqlite" in 37.2.0–37.2.2
//             and the 36.x releases before 36.7.3 that took the same Node update (fixed by #47706).
//             This port pins Electron 42.11.9 (Node 24.19, SQLite 3.53.3 — verified on Linux).
// The check below is authoritative regardless of the table: it actually loads the module and opens
// an in-memory database. Node prints an ExperimentalWarning on first use (harmless).
import type * as NodeSqlite from "node:sqlite";

export const SQLITE_MIN_NODE = "22.13.0";
export const SQLITE_MIN_ELECTRON = "35.0.2";

export class SqliteUnavailableError extends Error {
  readonly code = "SQLITE_UNAVAILABLE";
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "SqliteUnavailableError"; }
}

export interface SqliteCapability {
  ok: boolean;
  node: string;
  electron?: string;
  platform: string;
  arch: string;
  sqliteVersion?: string;
  minimum: { node: string; electron: string };
  error?: string;
}

type Loader = () => typeof NodeSqlite;
const defaultLoader: Loader = () => {
  const gbm = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const m = gbm ? gbm("node:sqlite") : require("node:sqlite");
  if (!m) throw new Error("node:sqlite is not a builtin module in this runtime");
  return m as typeof NodeSqlite;
};
let loader: Loader = defaultLoader;
let cached: typeof NodeSqlite | undefined;
/** Test seam: simulate a runtime without node:sqlite. */
export function setSqliteLoaderForTests(l: Loader | undefined): void { loader = l ?? defaultLoader; cached = undefined; }

function runtimeLabel(): string {
  const e = process.versions.electron;
  return `${e ? `Electron ${e} (Node ${process.versions.node})` : `Node ${process.versions.node}`} on ${process.platform}/${process.arch}`;
}

/** Returns the node:sqlite module or throws SqliteUnavailableError with an actionable message. */
export function loadSqlite(): typeof NodeSqlite {
  if (cached) return cached;
  try {
    const m = loader();
    if (typeof m?.DatabaseSync !== "function") throw new Error("node:sqlite has no DatabaseSync export");
    return (cached = m);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new SqliteUnavailableError(
      `The models.dev catalog needs the built-in node:sqlite module, which is unavailable in ${runtimeLabel()} (${why}). ` +
      `Requires Node >= ${SQLITE_MIN_NODE} (or 23.4+) / Electron >= ${SQLITE_MIN_ELECTRON}. LLM routing itself does not need it; only model metadata is unavailable.`,
      { cause: e },
    );
  }
}

/** Non-throwing capability probe (CLI `sqlite-check`, startup diagnostics). */
export function checkSqliteCapability(): SqliteCapability {
  const base = { node: process.versions.node, ...(process.versions.electron ? { electron: process.versions.electron } : {}), platform: process.platform, arch: process.arch, minimum: { node: SQLITE_MIN_NODE, electron: SQLITE_MIN_ELECTRON } };
  try {
    const { DatabaseSync } = loadSqlite();
    const db = new DatabaseSync(":memory:");
    try {
      const v = (db.prepare("select sqlite_version() as v").get() as { v: string }).v;
      return { ok: true, ...base, sqliteVersion: v };
    } finally { db.close(); }
  } catch (e) {
    return { ok: false, ...base, error: e instanceof Error ? e.message : String(e) };
  }
}
