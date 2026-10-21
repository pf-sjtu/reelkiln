// Provider config hot reload (docs/15 §2.2): explicit reload + file watcher, strict validation,
// fallback to built-in presets on invalid config, listeners, live gate resize.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getProviderRegistry, loadProviderRegistry, onProviderRegistryChange, providerRegistryGeneration, reloadProviderRegistry, setProviderRegistry, watchProvidersFile,
  PROVIDERS_FILE_ENV, type RegistryChange,
} from "../src/main/llm/provider-registry";
import { ConcurrencyLimiter, providerGate, resetProviderGatesForTests } from "../src/main/llm/retry";
import { createLogger, setLoggerForTests, type LogRecord } from "../src/main/llm/logger";
import { resolvedLlmRoute } from "../src/main/llm/llm-route";

const entry = (name: string, model = "m1", max = 1) => ({ name, protocol: "anthropic-messages", baseUrl: "https://llm.example.test/anthropic", apiKeyEnv: "HR_KEY", model, concurrency: { max } });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "vc-hr-"));
  const file = join(dir, "providers.json");
  const env = { [PROVIDERS_FILE_ENV]: file, HR_KEY: "hr-test-key-000000" };
  const logs: LogRecord[] = [];
  setLoggerForTests(createLogger({ level: "debug", sink: (r) => logs.push(r) }));
  const write = (providers: unknown[] | string) => writeFileSync(file, typeof providers === "string" ? providers : JSON.stringify({ version: 1, providers }));
  return { dir, file, env, logs, write, done: () => { setProviderRegistry(undefined); setLoggerForTests(undefined); rmSync(dir, { recursive: true, force: true }); } };
}

test("reloadProviderRegistry: add/update/remove providers, listeners + generation, no-op when unchanged", () => {
  const t = setup();
  try {
    t.write([entry("alpha")]);
    setProviderRegistry(loadProviderRegistry({ env: t.env }));
    const changes: RegistryChange[] = [];
    const off = onProviderRegistryChange((c) => changes.push(c));
    const g0 = providerRegistryGeneration();
    assert.equal(reloadProviderRegistry({ env: t.env }).changed, false);
    t.write([entry("alpha", "m2"), entry("beta")]);
    const r = reloadProviderRegistry({ env: t.env });
    assert.deepEqual({ ok: r.ok, changed: r.changed, added: r.added, updated: r.updated, removed: r.removed }, { ok: true, changed: true, added: ["beta"], updated: ["alpha"], removed: [] });
    assert.equal(getProviderRegistry().get("alpha")!.model, "m2");
    assert.equal(providerRegistryGeneration(), g0 + 1);
    assert.equal(changes.length, 1);
    assert.equal(resolvedLlmRoute({ llmRoute: "beta" }), "beta");
    t.write([entry("alpha", "m2")]);
    assert.deepEqual(reloadProviderRegistry({ env: t.env }).removed, ["beta"]);
    assert.equal(resolvedLlmRoute({ llmRoute: "beta" }), "claude-code"); // removed provider → original default
    off();
    t.write([entry("alpha", "m3")]);
    reloadProviderRegistry({ env: t.env });
    assert.equal(changes.length, 2); // unsubscribed
  } finally { t.done(); }
});

test("invalid config on reload → strict CONFIG_INVALID, presets only (minimax kept), error logged without file content; fix restores", () => {
  const t = setup();
  try {
    t.write([entry("alpha")]);
    setProviderRegistry(loadProviderRegistry({ env: t.env }));
    for (const bad of ['{"providers": [', JSON.stringify({ providers: [{ ...entry("alpha"), apiKey: "sk-should-not-be-here-123456" }] }), JSON.stringify({ providers: [{ ...entry("alpha"), protocol: "grpc" }] })]) {
      t.write(bad);
      const r = reloadProviderRegistry({ env: t.env });
      assert.equal(r.ok, false);
      assert.match(r.error!, /providers|protocol|secrets/);
      assert.deepEqual(getProviderRegistry().names(), ["minimax"]);
      assert.ok(getProviderRegistry().configError);
      assert.ok(!JSON.stringify(t.logs).includes("sk-should-not-be-here"));
    }
    rmSync(t.file);
    assert.match(reloadProviderRegistry({ env: t.env }).error!, /cannot read providers file/); // env-pointed file must exist
    t.write([entry("alpha")]);
    const ok = reloadProviderRegistry({ env: t.env });
    assert.equal(ok.ok, true);
    assert.deepEqual(getProviderRegistry().names(), ["minimax", "alpha"]);
    assert.equal(getProviderRegistry().configError, undefined);
    assert.ok(t.logs.some((l) => l.event === "llm.providers.config_invalid"));
  } finally { t.done(); }
});

test("watchProvidersFile: in-place write and atomic rename both trigger a reload; close() stops watching", async () => {
  const t = setup();
  try {
    t.write([entry("alpha")]);
    setProviderRegistry(loadProviderRegistry({ env: t.env }));
    const seen: string[][] = [];
    const off = onProviderRegistryChange((c) => seen.push(c.current.names()));
    const w = watchProvidersFile({ env: t.env, intervalMs: 25, debounceMs: 10 })!;
    const waitFor = async (n: number) => { for (let i = 0; i < 200 && seen.length < n; i++) await new Promise((r) => setTimeout(r, 15)); assert.equal(seen.length, n); };
    await new Promise((r) => setTimeout(r, 60));
    t.write([entry("alpha"), entry("gamma")]);
    await waitFor(1);
    assert.deepEqual(seen[0], ["minimax", "alpha", "gamma"]);
    const tmp = `${t.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ providers: [entry("delta-provider")] }));
    renameSync(tmp, t.file); // editor-style atomic save
    await waitFor(2);
    assert.deepEqual(seen[1], ["minimax", "delta-provider"]);
    w.close();
    t.write([entry("after-close")]);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(seen.length, 2);
    off();
    assert.equal(watchProvidersFile({ env: {} }), null);
  } finally { t.done(); }
});

test("ConcurrencyLimiter.setMax / providerGate resize after a reload changes concurrency", async () => {
  const l = new ConcurrencyLimiter(1);
  let running = 0, peak = 0;
  const releases: Array<() => void> = [];
  const job = () => l.run(async () => { running++; peak = Math.max(peak, running); await new Promise<void>((r) => releases.push(r)); running--; });
  const all = [job(), job(), job()];
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(l.running, 1);
  assert.equal(l.pending, 2);
  l.setMax(3);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(l.running, 3);
  l.setMax(1); // shrink: in-flight finish, nothing new admitted until below 1
  releases.splice(0).forEach((r) => r());
  await Promise.all(all);
  assert.equal(l.running, 0);
  assert.equal(peak, 3);
  assert.throws(() => l.setMax(0));
  resetProviderGatesForTests();
  const g = providerGate("p", 1);
  assert.equal(providerGate("p", 4), g);
  assert.equal(g.max, 4);
  resetProviderGatesForTests();
});
