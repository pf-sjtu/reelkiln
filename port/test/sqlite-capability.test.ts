// node:sqlite capability guard (docs/15 §4.2): lazy load, typed error with minimum versions when the
// runtime lacks the module, probe reports the real SQLite version here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSqliteCapability, loadSqlite, setSqliteLoaderForTests, SqliteUnavailableError, SQLITE_MIN_ELECTRON, SQLITE_MIN_NODE } from "../src/main/models-dev/sqlite";
import { ModelsDb } from "../src/main/models-dev/db";

test("capability probe on this runtime: ok + SQLite version + minimums", () => {
  const c = checkSqliteCapability();
  assert.equal(c.ok, true, c.error);
  assert.match(c.sqliteVersion!, /^3\.\d+\.\d+$/);
  assert.equal(c.node, process.versions.node);
  assert.deepEqual(c.minimum, { node: SQLITE_MIN_NODE, electron: SQLITE_MIN_ELECTRON });
  assert.equal(typeof loadSqlite().DatabaseSync, "function");
  const [maj, min] = process.versions.node.split(".").map(Number);
  assert.ok(maj > 22 || (maj === 22 && min >= 13), "test runtime is above the documented minimum");
});

test("runtime WITHOUT node:sqlite → SqliteUnavailableError (code, runtime, minimum) from ModelsDb and the probe; recovers when restored", () => {
  for (const fail of [() => { throw Object.assign(new Error("No such built-in module: node:sqlite"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" }); }, () => ({}) as any]) {
    setSqliteLoaderForTests(fail);
    try {
      assert.throws(() => new ModelsDb(":memory:"), (e: unknown) => e instanceof SqliteUnavailableError && e.code === "SQLITE_UNAVAILABLE" && e.message.includes(`Node >= ${SQLITE_MIN_NODE}`) && e.message.includes(`Electron >= ${SQLITE_MIN_ELECTRON}`) && e.message.includes(process.platform));
      const c = checkSqliteCapability();
      assert.equal(c.ok, false);
      assert.match(c.error!, /node:sqlite/);
    } finally { setSqliteLoaderForTests(undefined); }
  }
  const db = new ModelsDb(":memory:");
  assert.equal(db.schemaVersion(), 1);
  db.close();
});
