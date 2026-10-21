// PORT-NEW docs/18 §5: settings-page LLM route selector — view model, controller (load / select /
// rejection / stale responses / push), and the main-process push port:llm:routesChanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLlmSettingsController, routeRow, routeRows, type LlmSettingsState } from "../src/renderer/llm-settings";
import type { LlmRoutesView } from "../src/shared/port-ipc";
import { createLlmRuntime } from "../src/main/llm-runtime";
import { loadProviderRegistry, reloadProviderRegistry, setProviderRegistry, PROVIDERS_FILE_ENV } from "../src/main/llm/provider-registry";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const VIEW: LlmRoutesView = {
  current: "claude-code",
  routes: [
    { id: "claude-code", kind: "builtin", label: "Claude Code (local sign-in)" },
    { id: "gateway", kind: "builtin", label: "Videoclaw gateway" },
    { id: "minimax", kind: "provider", label: "MiniMax", protocol: "anthropic-messages", model: "MiniMax-M3.1-Flash", keyEnv: "MINIMAX_API_KEY", keyPresent: true, agentCapable: true, helperCapable: true, structuredOutput: "tool", preset: true },
    { id: "oai", kind: "provider", label: "OpenAI-ish", protocol: "openai-chat-completions", model: "gpt-x", keyEnv: "OAI_KEY", keyPresent: true, agentCapable: false, helperCapable: true, structuredOutput: "native", problem: "protocol-not-agent-capable" },
    { id: "nokey", kind: "provider", label: "nokey", protocol: "anthropic-messages", model: "n", keyEnv: "NOKEY_KEY", keyPresent: false, agentCapable: false, helperCapable: false, problem: "key-missing" },
  ],
};

test("routeRow: status badges (key/agent/helper/structured), selectability, reasons; built-ins", () => {
  const rows = Object.fromEntries(routeRows(VIEW).map((r) => [r.id, r]));
  assert.equal(rows["claude-code"].selected, true);
  assert.equal(rows["claude-code"].selectable, true);
  assert.ok(rows.gateway.badges.some((b) => b.tone === "warn" && /not ported/.test(b.text)));
  assert.deepEqual(rows.minimax.badges.map((b) => b.text), ["Preset", "Key set (MINIMAX_API_KEY)", "Agent", "Helper", "Structured output: tool"]);
  assert.equal(rows.minimax.detail, "Anthropic Messages · MiniMax-M3.1-Flash");
  assert.equal(rows.minimax.reason, undefined);
  assert.equal(rows.oai.selectable, true);
  assert.match(rows.oai.reason!, /helper calls only/);
  assert.ok(rows.oai.badges.some((b) => b.text === "No agent" && b.tone === "muted"));
  assert.equal(rows.nokey.selectable, false);
  assert.match(rows.nokey.reason!, /NOKEY_KEY/);
  assert.ok(rows.nokey.badges.some((b) => b.tone === "warn" && b.text === "Key missing (NOKEY_KEY)"));
  assert.equal(rows.nokey.badges.at(-1)!.text, "Structured output: native", "schema default");
  // the CURRENT route stays selectable/visible even if its key went missing
  assert.equal(routeRow(VIEW.routes[4], "nokey").selectable, true);
});

function harness(over: Partial<{ set: (id: string) => Promise<any>; routes: () => Promise<LlmRoutesView> }> = {}) {
  let view = structuredClone(VIEW);
  const states: LlmSettingsState[] = [];
  const calls: string[] = [];
  const ctl = createLlmSettingsController({
    llmRoutes: over.routes ?? (async () => structuredClone(view)),
    setLlmRoute: over.set ?? (async (id) => { calls.push(id); if (VIEW.routes.some((r) => r.id === id)) view.current = id; return { llmRoute: view.current }; }),
    onChange: (s) => states.push(s),
  });
  return { ctl, states, calls, setView: (v: LlmRoutesView) => { view = v; } };
}

test("controller: load → ready rows; select persists via setLlmRoute and re-queries; no-op for current; key-missing refused without IPC", async () => {
  const h = harness();
  assert.equal(h.ctl.state().phase, "loading");
  await h.ctl.refresh();
  assert.equal(h.ctl.state().phase, "ready");
  assert.equal(h.ctl.state().rows.find((r) => r.selected)!.id, "claude-code");
  assert.equal(await h.ctl.select("minimax"), true);
  assert.deepEqual(h.calls, ["minimax"]);
  assert.equal(h.ctl.state().rows.find((r) => r.selected)!.id, "minimax");
  assert.equal(h.ctl.state().notice!.tone, "ok");
  assert.ok(h.states.some((s) => s.pending === "minimax"), "pending state rendered while saving");
  assert.equal(h.ctl.state().pending, undefined);
  assert.equal(await h.ctl.select("minimax"), true);
  assert.deepEqual(h.calls, ["minimax"], "selecting the current route makes no IPC call");
  assert.equal(await h.ctl.select("nokey"), false);
  assert.deepEqual(h.calls, ["minimax"]);
  assert.match(h.ctl.state().notice!.text, /NOKEY_KEY/);
  assert.equal(await h.ctl.select("ghost"), false);
});

test("controller: main process drops the route (unregistered meanwhile) → error notice, page shows the real current route", async () => {
  const h = harness({ set: async () => ({ llmRoute: undefined }) });
  await h.ctl.refresh();
  assert.equal(await h.ctl.select("minimax"), false);
  assert.equal(h.ctl.state().notice!.tone, "error");
  assert.match(h.ctl.state().notice!.text, /rejected/);
  assert.equal(h.ctl.state().rows.find((r) => r.selected)!.id, "claude-code");
  const h2 = harness({ set: async () => { throw new Error("disk full"); } });
  await h2.ctl.refresh();
  assert.equal(await h2.ctl.select("minimax"), false);
  assert.match(h2.ctl.state().notice!.text, /disk full/);
  assert.equal(h2.ctl.state().pending, undefined);
});

test("controller: concurrent select ignored while pending; stale refresh response cannot overwrite a newer one; push applies immediately; load error", async () => {
  let release!: () => void;
  const h = harness({ set: (id) => new Promise((r) => { release = () => r({ llmRoute: id }); }) });
  await h.ctl.refresh();
  const p1 = h.ctl.select("minimax");
  assert.equal(await h.ctl.select("oai"), false, "second click while saving is ignored");
  release();
  await p1;
  // stale ordering: first (slow) response must not win over the second
  const resolvers: Array<(v: LlmRoutesView) => void> = [];
  const h3 = harness({ routes: () => new Promise((r) => resolvers.push(r)) });
  const a = h3.ctl.refresh("focus");
  const b = h3.ctl.refresh("push");
  resolvers[1]({ ...VIEW, current: "minimax" });
  await b;
  resolvers[0]({ ...VIEW, current: "claude-code" });
  await a;
  assert.equal(h3.ctl.state().view!.current, "minimax");
  // push payload is adopted directly (and supersedes an in-flight refresh)
  h3.ctl.applyView({ ...VIEW, current: "oai", configError: "providers.json: bad" });
  assert.equal(h3.ctl.state().rows.find((r) => r.selected)!.id, "oai");
  assert.equal(h3.ctl.state().configError, "providers.json: bad");
  const h4 = harness({ routes: async () => { throw new Error("no handler"); } });
  await h4.ctl.refresh();
  assert.equal(h4.ctl.state().phase, "error");
  assert.match(h4.ctl.state().notice!.text, /no handler/);
});

test("main: port:llm:routesChanged pushed on settings:set route change and on providers-file reload (deduped, no secrets)", async () => {
  setLoggerForTests(createLogger({ level: "silent" }));
  const dir = mkdtempSync(join(tmpdir(), "vc-push-"));
  const pfile = join(dir, "providers.json");
  const KEY = "acme-push-test-key-not-real-0001";
  const acme = { name: "acme", protocol: "anthropic-messages", baseUrl: "https://llm.acme.test", apiKeyEnv: "ACME_API_KEY", model: "acme-large" };
  writeFileSync(pfile, JSON.stringify({ providers: [acme] }));
  const env = { [PROVIDERS_FILE_ENV]: pfile, ACME_API_KEY: KEY };
  setProviderRegistry(loadProviderRegistry({ env }));
  const pushes: LlmRoutesView[] = [];
  const rt = createLlmRuntime({ userData: dir, env, watch: false, sighup: false, defaultGatewayUrl: "https://gw", onRoutesChanged: (v) => pushes.push(v) });
  try {
    const set = (rt.handlers as any)["settings:set"];
    await set({ telemetry: false });
    assert.equal(pushes.length, 0, "no push without a route change");
    await set({ llmRoute: "acme" });
    assert.deepEqual(pushes.map((p) => p.current), ["acme"]);
    // provider removed → route falls back AND registry changed → exactly one push
    writeFileSync(pfile, JSON.stringify({ providers: [] }));
    reloadProviderRegistry({ env });
    assert.deepEqual(pushes.map((p) => p.current), ["acme", "claude-code"]);
    assert.ok(!pushes[1].routes.some((r) => r.id === "acme"));
    // a provider ADDED without changing the route still pushes (new row for the page)
    writeFileSync(pfile, JSON.stringify({ providers: [{ ...acme, name: "other", apiKeyEnv: "OTHER_KEY" }] }));
    reloadProviderRegistry({ env });
    assert.equal(pushes.length, 3);
    assert.ok(pushes[2].routes.some((r) => r.id === "other" && r.problem === "key-missing"));
    // identical reload → deduped
    reloadProviderRegistry({ env });
    assert.equal(pushes.length, 3);
    // broken file → configError pushed
    writeFileSync(pfile, "{");
    reloadProviderRegistry({ env });
    assert.ok(pushes.at(-1)!.configError);
    assert.ok(!JSON.stringify(pushes).includes(KEY));
  } finally { rt.dispose(); setProviderRegistry(undefined as any); setLoggerForTests(undefined); rmSync(dir, { recursive: true, force: true }); }
});
