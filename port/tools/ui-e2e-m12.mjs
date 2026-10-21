#!/usr/bin/env node
// PORT-NEW docs/29 M12 — the last category-(b) channels through the ORIGINAL renderer (real CDP input; page
// evaluation is read-only DOM/geometry, window.videoclaw is never called). Infrastructure copied from
// ui-e2e-m11.mjs. Launched with VIDEOCLAW_PORT_LOCAL_GATEWAY=1 on a FRESH userData (only engine-current.json is
// seeded). MINIMAX_API_KEY stays in the app env ONLY because the credits-route turn is billed through the shim,
// which forwards to MiniMax; no ANTHROPIC_* / OpenAI variables reach the app.
// The Claude subscription limit (the credits hand-off precondition) cannot happen without a real Claude
// subscription (USER DIRECTIVE: none): VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT makes the claude-code-route turn fail
// with that raw CLI text instead of starting the Claude CLI (agent-host.ts claudeLimitInjection). Everything after it
// is the real path: verbatim modelAccountLimit → error card → creditHandoffOffer → Continue → continueOnCredits →
// a gateway-route turn (Claude Agent SDK → shim /anthropic → MiniMax) charged in the ledger.
//   node tools/ui-e2e-m12.mjs --phase m12 --run RUN --engine ENGINE_DIR [--port 9383]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "m12");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9383"));
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m12.mjs --phase m12 --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); // the installer's record next to the read-only engine (its verified build digest)
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version, ...(src0?.path === ENGINE && src0.buildSha256 ? { buildSha256: src0.buildSha256 } : {}) })); }
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m12-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m12 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const ipcRows = () => { try { return readFileSync(IPC, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ipcCalls = (ch) => ipcRows().filter((r) => r.ch === ch);
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 700)}`); };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sessions = () => readJson(join(UD, "sessions.json")) ?? { sessions: [], clients: [] };
// VIDEOCLAW_PORT_IPC_LOG truncates long results: read scalar fields by regex, never JSON.parse a truncated row
const field = (txt, k) => { const m = new RegExp(`"${k}":("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?[0-9.e+-]+)`).exec(txt ?? ""); return m ? JSON.parse(m[1]) : undefined; };
const ledger = () => readJson(join(UD, "local-gateway", "ledger.json"));

// ---- launch ------------------------------------------------------------------------------------------
const env = { ...process.env, HOME: RUN, VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47719"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete env[k];
if (!env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY is required for the credits-route turn"); process.exit(2); }
env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE = "claude-code"; // new videos open on the Claude Code route (first-launch picker skipped)
env.VIDEOCLAW_PORT_E2E_CLAUDE_LIMIT_TEXT = "Claude AI usage limit reached|1760000000"; // the external precondition (see header)
env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS = "300000";
const appArgs = ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`];
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) { console.error(`port ${CDP_PORT} busy`); process.exit(2); }
const mainLog = join(OUT, "main.log");
const DISPLAY_NUM = String(CDP_PORT - 9200); const XAUTH = join(OUT, "Xauthority"); // xclip needs the server's cookie
const xenv = () => ({ ...process.env, DISPLAY: `:${DISPLAY_NUM}`, XAUTHORITY: XAUTH });
const child = spawn("xvfb-run", ["-n", DISPLAY_NUM, "-f", XAUTH, "-s", "-screen 0 1440x960x24", join(PORT_DIR, "node_modules", ".bin", "electron"), ...appArgs, PORT_DIR], { cwd: PORT_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
child.stdout.on("data", (b) => appendFileSync(mainLog, b)); child.stderr.on("data", (b) => appendFileSync(mainLog, b));
let exited = false; child.on("exit", (c) => { exited = true; say(`app exited ${c}`); });
const page = await waitForPageTarget(CDP_PORT, { timeoutMs: 120_000, match: (t) => t.type === "page" && /(app\/out\/renderer|renderer-original)\/index\.html$/.test(t.url) });
const cdp = await Cdp.connect(page.webSocketDebuggerUrl, (o) => log(o));
await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
const consoleErrors = [];
cdp.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400)); });
cdp.on("Runtime.exceptionThrown", (p) => consoleErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 400)));
const shot = async (n) => writeFileSync(join(SHOTS, `${n}.png`), await screenshot(cdp));
const bodyText = () => cdp.eval("document.body ? document.body.innerText : ''");
async function waitFor(desc, fn, { timeoutMs = 30_000, every = 300 } = {}) { const ts = Date.now(); while (Date.now() - ts < timeoutMs) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } throw new Error(`timeout waiting for ${desc}`); }
async function find(selector, { text, aria, last = false, center: mid = false } = {}) {
  return cdp.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    ${text ? `if (!new RegExp(${JSON.stringify(text)}).test((e.innerText || e.value || "").trim())) return false;` : ""}
    ${aria ? `if (!new RegExp(${JSON.stringify(aria)}).test((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || ""))) return false;` : ""}
    return true; }); const e = els[${last ? "els.length - 1" : "0"}]; if (!e) return null; e.scrollIntoView({ block: ${mid ? '"center"' : '"nearest"'} }); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hitOk: !!hit && (hit === e || e.contains(hit)), hit: hit ? hit.tagName + "." + hit.className : null, x: r.x, y: r.y, width: r.width, height: r.height, label: (e.innerText || e.getAttribute("aria-label") || e.value || "").trim().slice(0, 80) }; })()`);
}
async function click(desc, selector, o = {}) { let el = await waitFor(desc, () => find(selector, o), { timeoutMs: o.timeoutMs ?? 20_000 });
  // scroll panes use smooth scrolling: when the target was off-screen, let scrollIntoView finish and measure again
  if (el && el.hitOk === false) { await sleep(900); el = (await find(selector, o)) ?? el; } const p = center(el); log({ action: "click", desc, selector, at: p, element: el }); if (o.hover) { await mouseMove(cdp, o.hover.x, o.hover.y); await sleep(300); } await mouseClick(cdp, p.x, p.y); if (o.double) await mouseClick(cdp, p.x, p.y, { clickCount: 2 }); return el; }
const key = (k, keyCode, modifiers = 0) => pressKey(cdp, k, { code: k, keyCode, modifiers });
const selectAll = () => cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] }).then(() => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }));
async function step(id, fn) { try { await fn(); } catch (e) { verdict(id, false, { error: String(e?.message ?? e).slice(0, 400) }); try { await shot(`err-${id}`); } catch {} await key("Escape", 27).catch(() => {}); await sleep(400); } }
const mainLogRows = (re) => { try { return readFileSync(mainLog, "utf8").split("\n").filter((l) => re.test(l)); } catch { return []; } };
async function landing() {
  const where = await waitFor("home or restored video", async () => { const t = await bodyText(); return /What are we making today\?/.test(t) ? "home" : (await find("button.session.active")) ? "restored" : (await find("button.session")) ? "sidebar" : null; }, { timeoutMs: 90_000 });
  await sleep(1200); if (await find("button.tour-skip")) await click("Skip tour", "button.tour-skip"); return where;
}
async function openSession(s) {
  const row = () => find("button.session", { text: esc(String(s.title).slice(0, 16)) });
  if (!(await row())) { const c = sessions().clients.find((x) => x.clientId === (s.clientId ?? "personal")); if (c) await click("expand project", "button.client-toggle", { text: `^${esc(c.name)}$` }).catch(() => null); }
  await click(`open video ${s.title}`, "button.session", { text: esc(String(s.title).slice(0, 16)) }); await sleep(1500);
}
async function waitIdle(sid, timeoutMs) { return waitFor(`session ${sid} idle/error`, async () => { const r = sessions().sessions.find((x) => x.sessionId === sid); return r && (r.status === "idle" || r.status === "error") && !(await find("button.stop-btn, button[aria-label='Stop']")) ? r : null; }, { timeoutMs, every: 1000 }); }



const CODE = `VC${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const evRows = () => { try { return readFileSync(join(OUT, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const sessEvents = (sid) => evRows().filter((r) => r.ch === "session:event" && r.payload?.sessionId === sid).map((r) => r.payload.event);
const summary = { phase: PHASE, started: new Date().toISOString(), steps, code: CODE };
async function openProfileMenu() {
  if (await find("button[role='menuitem']", { text: "Check for updates|Checking for updates" })) return;
  await click("profile button", "button.profile-button"); await sleep(500);
}
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await waitFor("account ready", async () => ipcCalls("account:snapshot").some((r) => r.ok && field(r.result, "step") === "ready") || null, { timeoutMs: 30_000 }).catch(() => null);
  // ---- profile menu → Check for updates (useManualUpdateCheck → app:update:check → startUpdateCheck → shim /v1/app/latest)
  await step("update_check", async () => {
    await openProfileMenu();
    await click("Check for updates", "button[role='menuitem']", { text: "Check for updates" });
    const r = await waitFor("app:update:check", async () => ipcCalls("app:update:check").find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    const st = await waitFor("status line", async () => { const t = await bodyText(); const m = /Videoclaw is up to date \([^)]*\)|couldn.t check|Could not check[^\n]*/i.exec(t); return m ? m[0] : null; }, { timeoutMs: 15_000 });
    await sleep(400); await shot("01-update-check");
    const res = JSON.parse(r.result);
    verdict("update_check", r.real && res.kind === "current" && /Videoclaw is up to date \(0\.0\.40-port\.0\)/.test(st), { result: res, dom: st });
    await key("Escape", 27); await sleep(500);
  });
  // ---- Report a problem → Turn on usage sharing → Send report (FeedbackService → Outbox feedback lane → shim /v1/feedback)
  await step("feedback_submit", async () => {
    await click("Report a problem", "button.report-btn", { aria: "Report a problem" });
    await waitFor("report modal", () => find("div.report-modal"), { timeoutMs: 20_000 }); await sleep(800); await shot("02a-report-modal");
    let granted = null;
    if (await find("button.report-consent-grant")) {
      await click("Turn on usage sharing", "button.report-consent-grant");
      granted = await waitFor("feedback:grantUsageSharing", async () => ipcCalls("feedback:grantUsageSharing").find((x) => x.ok) ?? null, { timeoutMs: 15_000 });
      await sleep(800); await shot("02b-consent-granted");
    }
    await click("quick option", "button.report-quick-option");
    await click("detail", "textarea.report-textarea"); await typeText(cdp, `M12 e2e report ${CODE}`);
    await sleep(300); await shot("02c-report-filled");
    await click("Send report", "button.report-send");
    const r = await waitFor("feedback:submit", async () => ipcCalls("feedback:submit").find((x) => x.ok) ?? null, { timeoutMs: 30_000 });
    await sleep(1500); await shot("02d-report-sent");
    const res = JSON.parse(r.result);
    const sinks = await waitFor("shim feedback sink", async () => { const s = ledger()?.sinks ?? {}; return s.feedback ? s : null; }, { timeoutMs: 30_000 }).catch(() => ledger()?.sinks ?? {});
    const dom = await bodyText();
    verdict("feedback_submit", r.real && res.queued === true && (sinks.feedback ?? 0) >= 1, { grant: granted && { real: granted.real, result: granted.result.slice(0, 300) }, result: res, sinks, toast: /Thanks|sent|Report/.exec(dom)?.[0] ?? null });
    if (await find("div.report-modal")) { await key("Escape", 27); await sleep(500); }
  });
  // ---- a new video on the Claude Code route → the Claude limit → the original credits card
  let srcSid, contSid;
  await step("claude_limit_card", async () => {
    const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
    await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
    const created = await waitFor("session:create", async () => ipcCalls("session:create").find((r) => r.ok) ?? null, { timeoutMs: 15_000 });
    const meta = JSON.parse(created.result); srcSid = meta.sessionId;
    await sleep(1200);
    await click("composer", "textarea"); await typeText(cdp, "把片头的颜色改成青色"); await key("Enter", 13);
    const err = await waitFor("error card event", async () => sessEvents(srcSid).find((e) => e.kind === "error") ?? null, { timeoutMs: 60_000, every: 500 });
    const btn = await waitFor("Continue with credits button", () => find("button.failure-retry", { text: "Continue this video with VideoClaw credits" }), { timeoutMs: 30_000 });
    await sleep(600); await shot("03-claude-limit-card");
    const offer = ipcCalls("engine:creditHandoffOffer").filter((x) => x.ok).slice(-1)[0];
    verdict("claude_limit_card", meta.llmRoute === "claude-code" && err.accountLimit?.account === "claude" && err.llmRouteRequired === true && !!btn && offer?.real && /"available":true/.test(offer.result), { sessionId: srcSid, llmRoute: meta.llmRoute, card: err, offer: offer?.result, memoryRead: ipcCalls("memory:read").slice(-1).map((x) => ({ real: x.real, result: x.result.slice(0, 200) })), planRead: ipcCalls("sessionPlan:read").slice(-1).map((x) => ({ real: x.real, result: x.result.slice(0, 200) })) });
  });
  // ---- Continue this video with VideoClaw credits → confirm → continueOnCredits
  await step("continue_on_credits", async () => {
    await click("Continue this video with VideoClaw credits", "button.failure-retry", { text: "Continue this video with VideoClaw credits" });
    await waitFor("spend transition dialog", () => find("div.spend-transition-dialog"), { timeoutMs: 15_000 }); await sleep(600); await shot("04a-confirm");
    await click("Continue with credits", "div.spend-transition-dialog button", { text: "^Continue with credits$" });
    const r = await waitFor("engine:continueOnCredits", async () => ipcCalls("engine:continueOnCredits").find((x) => x.ok) ?? null, { timeoutMs: 30_000 });
    await sleep(1500); await shot("04b-continuation");
    contSid = field(r.result, "sessionId");
    verdict("continue_on_credits", r.real && field(r.result, "llmRoute") === "gateway" && field(r.result, "continuedFromSessionId") === srcSid && contSid !== srcSid, { continuation: { sessionId: contSid, llmRoute: field(r.result, "llmRoute"), continuedFromSessionId: field(r.result, "continuedFromSessionId"), continuationDraft: field(r.result, "continuationDraft"), title: field(r.result, "title") } });
  });
  // ---- the REAL credits-route turn: Claude Agent SDK → shim /anthropic → MiniMax, charged in the ledger
  await step("credits_turn", async () => {
    const before = (ledger()?.entries ?? []).length;
    await click("composer", "textarea"); await selectAll(); await key("Backspace", 8);
    await typeText(cdp, `这是一次计费测试。不要调用任何工具，不要读写文件，只回复：完成 ${CODE}`); await shot("05a-typed"); await key("Enter", 13);
    await waitFor("session:send accepted", async () => ipcCalls("session:send").find((r) => r.ok && String(r.args).includes(contSid)) ?? null, { timeoutMs: 20_000 });
    const res = await waitFor("result event", async () => sessEvents(contSid).find((e) => e.kind === "result" || e.kind === "error") ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
    await sleep(2500); await shot("05b-answered");
    const ev = sessEvents(contSid);
    const text = ev.filter((e) => e.kind === "assistant_text").map((e) => e.text).join(" ");
    const L = ledger(); const fresh = (L?.entries ?? []).slice(before);
    const rt = mainLogRows(/agent\.runtime\.started/).filter((l) => l.includes(contSid)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 300));
    summary.creditsTurn = { result: res, text: text.slice(0, 300), runtime: rt, ledgerEntries: fresh.map((e) => ({ kind: e.kind, model: e.model, upstreamModel: e.upstreamModel, inputTokens: e.inputTokens, outputTokens: e.outputTokens, cacheReadTokens: e.cacheReadTokens, usd: e.usd })), ledgerUsd: fresh.reduce((a, e) => a + e.usd, 0), pricing: L?.pricing };
    verdict("credits_turn", res.kind === "result" && !res.isError && text.includes(CODE) && fresh.length > 0 && fresh.every((e) => e.usd > 0) && rt.some((l) => /"llmRoute":"gateway"/.test(l)), summary.creditsTurn);
  });
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.length, usd: L.entries.reduce((a, e) => a + e.usd, 0), sinks: L.sinks, refusals: L.refusals.length, budgets: Object.keys(L.budgets ?? {}).length, pricing: L.pricing }; })();
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.m12Channels = Object.fromEntries(["memory:read", "sessionPlan:read", "app:update:check", "feedback:grantUsageSharing", "feedback:submit", "engine:creditHandoffOffer", "engine:continueOnCredits"].map((c) => [c, ipcCalls(c).map((r) => ({ ok: r.ok, real: r.real }))]));
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m12-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
