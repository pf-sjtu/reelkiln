// docs/24 (M6): the channels behind the two renderer TypeErrors (characters:list → L31748 `.find`,
// session:history → L39778 `.length`), quickstart:catalog over the shipped bundled catalog, and the
// session title naming (verbatim fallback + PORT-NEW provider-route proposal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CharacterStore } from "../src/main/characters/character-store.generated";
import { createQuickstartCatalog, quickstartCandidateRoots } from "../src/main/quickstart/quickstart-ipc";
import { validateRawCatalog } from "../src/main/quickstart/quickstart-catalog.generated";
import { fallbackSessionTitle, NEW_VIDEO_TITLE, sessionTitleText } from "../src/main/agent/session-title.generated";
import { acceptProposedTitle, proposeProviderSessionTitle, sessionTitlePrompt, SESSION_TITLE_SYSTEM_PROMPT } from "../src/main/agent/session-title";
import { AgentHost, type AgentHostRouteService, type SessionEvent } from "../src/main/agent/agent-host";
import { agentIpcHandlers } from "../src/main/agent/agent-ipc";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const ORIGINAL_MAIN = readFileSync(resolve(process.cwd(), "../app/reconstructed/main/index.js"), "utf8");
const ORIGINAL_RENDERER = readFileSync(resolve(process.cwd(), "../app/out/renderer/assets/index-D5K1mOs0.js"), "utf8").split("\n");
const BUNDLED_QUICKSTARTS = resolve(process.cwd(), "../app/resources/quickstarts");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 2000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(5); } }

test("renderer consumers: L31748 reads charactersList(cwd).find, L39778 reads getHistory(id).length (the two M5 TypeErrors)", () => {
  assert.match(ORIGINAL_RENDERER.slice(31744, 31748).join("\n"), /window\.videoclaw\.charactersList\(cwd2\)\.then\(\(list2\) => \{[\s\S]*list2\.find\(/);
  assert.match(ORIGINAL_RENDERER.slice(31747, 31748).join(""), /list2\.find/);
  assert.match(ORIGINAL_RENDERER.slice(39775, 39778).join("\n"), /window\.videoclaw\.getHistory\(activeId\)\.then\(\(events\) => \{[\s\S]*events\.length === 0/);
  assert.match(ORIGINAL_RENDERER.slice(39777, 39778).join(""), /events\.length/);
});

test("characters:list — the ORIGINAL CharacterStore returns an ARRAY (empty workspace → []), approved + pending with sheet/refs", () => {
  const ws = mkdtempSync(join(tmpdir(), "vc-chars-"));
  try {
    const store = new CharacterStore();
    assert.deepEqual(store.list(ws), [], "no characters/ dir → [] (the stub returned undefined → .find TypeError)");
    const a = join(ws, "characters", "pf");
    mkdirSync(join(a, "refs"), { recursive: true });
    writeFileSync(join(a, "meta.json"), JSON.stringify({ slug: "pf", name: "PF", createdAt: 1, approved: true, isSelf: true }));
    writeFileSync(join(a, "sheet.png"), "x"); writeFileSync(join(a, "refs", "1.jpg"), "x"); writeFileSync(join(a, "refs", "n.txt"), "x");
    const p = join(ws, "characters", "pending", "bob");
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "meta.json"), JSON.stringify({ slug: "bob", name: "Bob", createdAt: 2 }));
    const list = store.list(ws);
    assert.equal(list.length, 2);
    const me: any = list.find((c: any) => c.state === "approved" && c.isSelf); // exactly the renderer's L31748 read
    assert.equal(me.name, "PF");
    assert.equal(me.sheetPath, join(a, "sheet.png"));
    assert.deepEqual(me.refs, [join(a, "refs", "1.jpg")], "refs keep images only (assetKind)");
    assert.equal((list.find((c: any) => c.slug === "bob") as any).state, "pending");
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

function silentHost(route = "minimax", helper?: AgentHostRouteService["sessionHelperComplete"], providerTitles?: boolean) {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-m6-"));
  const events: Array<{ sessionId: string; event: SessionEvent }> = [];
  const lists: any[][] = [];
  const service: AgentHostRouteService = {
    newSessionLlmRoute: () => route as any,
    llmRouteReadiness: async () => ({ ready: true }),
    sessionAgentRuntime: async (meta) => ({ llmRoute: meta.llmRoute as any, model: "m", env: {}, close: async () => {} }),
    sessionLlmRoute: (meta) => (meta.llmRoute ?? route) as any,
    ...(helper ? { sessionHelperComplete: helper } : {}),
  };
  const script = async function* () {
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 1, total_cost_usd: 0 };
  };
  const host = new AgentHost({
    emit: { sessionEvent: (sessionId, event) => events.push({ sessionId, event }), sessionsChanged: (l) => lists.push(l) },
    service,
    loadSdk: async () => ({ sdk: { query: ({ prompt }: any) => { const out: any[] = []; let wake: any = null; (async () => { for await (const _m of prompt) for await (const o of script()) { out.push(o); wake?.(); } })(); return { close() {}, async interrupt() {}, async *[Symbol.asyncIterator]() { for (;;) { const m = out.shift(); if (m) { yield m; continue; } await new Promise((r) => { wake = r; }); } } } as any; } } as any, executable: "/x/claude" }),
    sessionsRoot: root, ...(providerTitles === undefined ? {} : { providerTitles }),
  });
  return { host, events, lists, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("session:history — an ARRAY for a video without an SDK transcript (original !sdkSessionId branch → []); unknown id rejects", async () => {
  const h = silentHost();
  try {
    const ipc = agentIpcHandlers(h.host, () => h.host.listSessions());
    const s = h.host.createSession({});
    const events = await ipc["session:history"]!(s.sessionId) as unknown[];
    assert.ok(Array.isArray(events)); assert.equal(events.length, 0);
    await assert.rejects(Promise.resolve().then(() => ipc["session:history"]!("nope")), /Unknown session/);
  } finally { h.cleanup(); }
});

test("quickstart:catalog — the ORIGINAL store validates + serves the shipped bundled catalog (cold, then warm)", async () => {
  const ud = mkdtempSync(join(tmpdir(), "vc-qs-"));
  try {
    const raw = JSON.parse(readFileSync(join(BUNDLED_QUICKSTARTS, "catalog.json"), "utf8"));
    assert.equal(validateRawCatalog(raw).catalog_sha256, raw.catalog_sha256, "digest + content-addressed assets verify");
    const pushes: unknown[][] = [];
    const roots = quickstartCandidateRoots({ packaged: false, env: {}, resourcesPath: "/nonexistent-res", appPath: resolve(process.cwd()) });
    assert.ok(roots.includes(BUNDLED_QUICKSTARTS), "PORT-NEW dev root <port>/../app/resources/quickstarts");
    assert.deepEqual(quickstartCandidateRoots({ packaged: true, env: { VIDEOCLAW_QUICKSTART_FIXTURE_DIR: "/x" }, resourcesPath: "/res", appPath: "/app.asar" }), ["/res/quickstarts", "/app.asar/resources/quickstarts", "/app.asar/apps/desktop/resources/quickstarts"], "packaged = the original's roots only (fixture dir ignored)");
    const qs = createQuickstartCatalog({ packaged: false, env: {}, resourcesPath: "/nonexistent-res", appPath: resolve(process.cwd()), userData: ud, grant: () => true, push: (...a) => { pushes.push(a); } });
    const cold: any = await qs.handlers["quickstart:catalog"]();
    assert.equal(cold.schema, "videoclaw.quickstart-catalog-view/v1");
    assert.equal(cold.source, "bundled");
    assert.equal(cold.catalogSha256, raw.catalog_sha256);
    assert.equal(cold.starters.length, raw.starters.filter((s: any) => s.visible !== false).length);
    const st = cold.starters[0];
    assert.equal(st.title, raw.starters[0].title);
    assert.ok(st.references.every((r: any) => /^data:image\/svg\+xml;base64,/.test(r.previewDataUrl)), "svg previews become data: URLs (buildPublicSnapshot imageUrl)");
    const warm: any = qs.handlers["quickstart:catalog"]();
    assert.deepEqual(warm, cold, "warm path returns the cached view synchronously");
    await tick(20);
    assert.equal(pushes.length, 0, "no quickstart:catalogChanged when the refreshed view is identical");
    assert.ok(readFileSync(join(ud, "quickstarts", "last-known-good", "current.json"), "utf8").includes(raw.catalog_sha256), "rememberLocal wrote the last-known-good pointer");
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test("quickstart:catalog — no valid root → the original rejects (renderer shows its error card, not a forever 'Loading')", async () => {
  const ud = mkdtempSync(join(tmpdir(), "vc-qs-"));
  try {
    const qs = createQuickstartCatalog({ packaged: true, env: {}, resourcesPath: "/nonexistent-res", appPath: "/nonexistent-app", userData: ud, grant: () => true, push: () => {} });
    await assert.rejects(Promise.resolve().then(() => qs.handlers["quickstart:catalog"]()));
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test("session titles — verbatim helpers + the system prompt is byte-identical to the bundle", () => {
  assert.equal(NEW_VIDEO_TITLE, "New video");
  assert.ok(ORIGINAL_MAIN.includes(JSON.stringify(SESSION_TITLE_SYSTEM_PROMPT)), "system prompt verbatim from proposeSessionTitle");
  assert.equal(fallbackSessionTitle("Make a reel about cats\nmore"), "Make a reel about cats more", "sessionTitleText folds newlines first");
  assert.equal(fallbackSessionTitle("see /Users/pf/secret.mov"), NEW_VIDEO_TITLE, "a redacted path → New video");
  assert.equal(fallbackSessionTitle("x".repeat(100)).length, 80);
  assert.equal(sessionTitlePrompt("hi  there"), JSON.stringify("hi there"));
  assert.equal(acceptProposedTitle(' "Cat reel" '), "Cat reel");
  assert.equal(acceptProposedTitle("x".repeat(49)), undefined, "> 48 chars rejected");
  assert.equal(acceptProposedTitle("see ~/a/b"), undefined, "paths rejected");
  assert.equal(sessionTitleText("token: abc"), "[private]");
});

test("AgentHost names the video on first send (fallback, verbatim) and then takes ONE provider-route proposal (automatic)", async () => {
  const calls: any[] = [];
  const h = silentHost("minimax", async (meta, body, opts) => { calls.push({ meta, body, opts }); return { ok: true, text: "竖屏快剪 a→b→c" }; });
  try {
    const s = h.host.createSession({});
    assert.equal(s.title, "New video");
    await h.host.sendMessage(s.sessionId, { text: "我有三段短素材和一段配乐。\n第二行", clientTurnId: "" } as any);
    const titles = () => h.lists.map((l) => l.find((m: any) => m.sessionId === s.sessionId)).filter(Boolean).map((m: any) => `${m.titleOrigin}:${m.title}`);
    await until(() => titles().includes("automatic:竖屏快剪 a→b→c"));
    assert.ok(titles().includes("fallback:我有三段短素材和一段配乐。 第二行"), "fallback first (sessionTitleText → deriveTitle)");
    assert.equal(calls.length, 1, "exactly one helper request");
    assert.equal(calls[0].body.system, SESSION_TITLE_SYSTEM_PROMPT);
    assert.equal(calls[0].body.messages[0].content, JSON.stringify("我有三段短素材和一段配乐。 第二行"));
    assert.equal(calls[0].meta.llmRoute, "minimax");
    assert.equal(calls[0].opts.timeoutMs, 15_000);
    // a second message never renames an automatic title
    await until(() => h.host.listSessions()[0].status === "idle");
    await h.host.sendMessage(s.sessionId, { text: "another", clientTurnId: "" } as any);
    await tick(20);
    assert.equal(calls.length, 1);
    assert.equal(h.host.listSessions()[0].title, "竖屏快剪 a→b→c");
  } finally { h.cleanup(); }
});

test("AgentHost titles: claude-code route keeps the fallback (original requests only with a subscription login — NOT PORTED); opt-out; failed proposal keeps fallback", async () => {
  for (const [route, providerTitles, reply] of [["claude-code", undefined, { ok: true, text: "X" }], ["minimax", false, { ok: true, text: "X" }], ["minimax", undefined, { ok: false, reason: "http 500" }]] as const) {
    let called = 0;
    const h = silentHost(route, async () => { called++; return reply as any; }, providerTitles as any);
    try {
      const s = h.host.createSession({});
      await h.host.sendMessage(s.sessionId, { text: "Make a cat reel", clientTurnId: "" } as any);
      await tick(30);
      const m = h.host.listSessions()[0];
      assert.equal(m.title, "Make a cat reel"); assert.equal(m.titleOrigin, "fallback");
      assert.equal(called, route === "minimax" && providerTitles === undefined ? 1 : 0, `${route}/${providerTitles}`);
    } finally { h.cleanup(); }
  }
});

test("proposeProviderSessionTitle: rejected / aborted proposals yield no title", async () => {
  const c = new AbortController();
  assert.deepEqual(await proposeProviderSessionTitle("t", c, async () => ({ ok: true, text: "x".repeat(60) })), { reason: "rejected by the original title check" });
  const c2 = new AbortController(); c2.abort();
  assert.deepEqual(await proposeProviderSessionTitle("t", c2, async () => ({ ok: true, text: "Fine" })), { reason: "aborted" });
});
