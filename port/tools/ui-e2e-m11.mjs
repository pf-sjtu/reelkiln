#!/usr/bin/env node
// PORT-NEW docs/28 M11 — the local gateway + billing shim through the ORIGINAL renderer (real CDP input; page
// evaluation is read-only DOM/geometry, window.videoclaw is never called). Infrastructure copied from
// ui-e2e-m10.mjs. The app is launched with VIDEOCLAW_PORT_LOCAL_GATEWAY=1 on a FRESH userData (only
// engine-current.json is seeded): the main process starts the loopback shim, points gatewayUrl at it and issues a
// vc_ key into the verbatim CredentialStore. MINIMAX_API_KEY is removed from the app env (no model call in UI).
//   node tools/ui-e2e-m11.mjs --phase account --run RUN --engine ENGINE_DIR [--expect-spend] [--port 9381]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "account");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9381"));
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m11.mjs --phase account --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version })); }
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m11-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m11 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
const env = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47719"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
delete env.MINIMAX_API_KEY; env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE = "claude-code"; // the UI phase must not be able to reach MiniMax; the route is preset+acknowledged (first-launch picker skipped)
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


const summary = { phase: PHASE, started: new Date().toISOString(), steps };
async function openSettings() {
  if (await find("h2", { text: "^Account$" })) return;
  await click("profile button", "button.profile-button"); await sleep(400);
  await click("Settings", "button[role='menuitem']", { text: "Settings" });
  await waitFor("Settings Account", () => find("h2", { text: "^Account$" }), { timeoutMs: 15_000 });
}
const sectionText = (id) => cdp.eval(`(document.getElementById(${JSON.stringify(id)})?.innerText ?? "")`);
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  const L0 = ledger();
  summary.ledgerAtLaunch = L0 && { schema: L0.schema, keys: L0.keys.map((k) => ({ id: k.id.slice(0, 12) + "…", hint: k.hint, revoked: !!k.revokedAt })), limits: L0.limits, entries: L0.entries.length, topupBalanceUsd: L0.topupBalanceUsd };
  // ---- Settings → Account: AccountIdentity (account:snapshot → resolveAccountSnapshot, legacy key → ready)
  await step("account_identity", async () => {
    await openSettings(); await sleep(800);
    const t = await waitFor("Videoclaw account row", async () => { const x = await sectionText("settings-account"); return /Videoclaw account/.test(x) ? x : null; }, { timeoutMs: 20_000 });
    await shot("01-account");
    const snaps = ipcCalls("account:snapshot").filter((r) => r.ok);
    const lr = snaps.length ? snaps[snaps.length - 1].result : "";
    const last = Object.fromEntries(["step", "legacyKeyOnly", "hasStoredKey", "storedKeyId", "storedKeyInvalid", "signInUnavailableReason", "loaded"].map((k) => [k, field(lr, k)]));
    verdict("account_identity", /Not signed in — running on your alpha key/.test(t) && last.step === "ready" && last.legacyKeyOnly === true && last.hasStoredKey === true && snaps.some((r) => r.real), { domAccount: t.slice(0, 300), snapshot: { ...last, storedKeyId: String(last.storedKeyId ?? "").slice(0, 12) + "…" }, ledgerKeyIdPrefix: summary.ledgerAtLaunch?.keys?.[0]?.id });
  });
  // ---- Billing & credits: SpendingMeter (gateway:meter → loadKeyMeter → shim /v1/me → keyMeterFrom)
  await step("billing_meter", async () => {
    await openSettings();
    await click("Billing & credits nav", "button", { text: "^Billing & credits$" }).catch(() => null); await sleep(900);
    const t = await waitFor("Generation credit", async () => { const x = await sectionText("settings-billing"); return /Generation credit/.test(x) ? x : null; }, { timeoutMs: 30_000 });
    await find("#settings-billing", { center: true }); await sleep(900); await shot("02-billing-meter");
    const m = ipcCalls("gateway:meter").filter((r) => r.ok).slice(-1)[0]; const meter = m ? JSON.parse(m.result) : null;
    const L = ledger(); const spentLedger = (L?.entries ?? []).reduce((a, e) => a + e.usd, 0);
    const ok = !!meter && m.real && meter.limitUsd === L.limits.monthUsd && Math.abs((meter.spentUsd ?? 0) - spentLedger) < 1e-6 && Math.abs(meter.availableUsd - (L.limits.monthUsd + L.topupBalanceUsd - spentLedger)) < 1e-6 && (!EXPECT_SPEND || spentLedger > 0);
    verdict("billing_meter", ok && /\$/.test(t), { domBilling: t.slice(0, 500), meter, ledgerSpentUsd: spentLedger, ledgerEntries: L?.entries?.length });
  });
  // ---- Get more credits → $ amount → Continue → startTopUp → shim 503 → the original's checkout-unavailable copy
  await step("topup_unavailable", async () => {
    await openSettings();
    await click("Get more credits", "button.am-credit-cta", { text: "Get more credits" }); await sleep(600);
    await waitFor("top-up form", () => find("input.am-topup-input"), { timeoutMs: 10_000 }); await shot("03a-topup-form");
    await click("Continue", "button.am-save", { text: "^Continue$" });
    const r = await waitFor("gateway:topup", async () => ipcCalls("gateway:topup").find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    const msg = await waitFor("status message", async () => { const x = await sectionText("settings-billing"); return /Checkout is unavailable|Could not start checkout|Opened checkout/.test(x) ? x : null; }, { timeoutMs: 15_000 });
    await sleep(500); await shot("03b-topup-unavailable");
    const res = JSON.parse(r.result);
    verdict("topup_unavailable", r.real && res.ok === false && /Checkout is unavailable right now/.test(msg), { args: r.args, result: res, dom: msg.slice(0, 400), ledgerTopups: ledger()?.topups?.length ?? 0 });
  });
  // ---- Agent & models: Claude Code status (engine:claudeCodeStatus → PORT probe: no Claude login)
  await step("claude_code_status", async () => {
    await openSettings();
    await click("Agent & models nav", "button", { text: "^Agent & models$" }); await sleep(900);
    const t = await sectionText("settings-agent"); await shot("04-agent-claude");
    const rows = ipcCalls("engine:claudeCodeStatus").filter((r) => r.ok);
    verdict("claude_code_status", rows.length > 0 && rows.every((r) => r.real && JSON.parse(r.result).available === false), { calls: rows.length, results: [...new Set(rows.map((r) => r.result))], domAgent: t.slice(0, 500) });
  });
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.map((e) => ({ kind: e.kind, model: e.model, upstreamModel: e.upstreamModel, inputTokens: e.inputTokens, outputTokens: e.outputTokens, usd: e.usd })), refusals: L.refusals.length, topups: L.topups.length, limits: L.limits }; })();
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m11-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
