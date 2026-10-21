#!/usr/bin/env node
// PORT-NEW docs/32 M15 — the original's spend-approval cards through the ORIGINAL renderer with real CDP input (page
// evaluation is read-only DOM/geometry; window.videoclaw is never called). Infrastructure copied from ui-e2e-m14.mjs.
// Paid op = MiniMax TTS through the engine's call_model (proxy → shim /v1/model_call). Concurrency 1.
// Video A (ask_each): composer mode select → Bypass (confirm "Enable Bypass") → Auto ⇒ ask_each (spendPolicyForMaterialChange)
//   → call_model → "Paid operation" card → Deny (no charge) → again → "Allow once" (permit, mp3, one ledger charge)
//   → [task 4] request_files → the files card → OS drag-and-drop a PNG → "Send files".
// Video B (raise): strip "Set production budget" = used + 2¢ → a TTS quote > remaining → "Raise spending limit?" card
//   → Deny (cap unchanged, no charge) → again → Allow (cap raised to exactly the required ceiling, one charge).
// Session A (plan): propose -> "Show me a preview" -> "Change it" + "Send changes" -> (while B runs) "Build it" fails
//   -> "Retry" -> a new proposal -> "Dismiss plan".
// Session B (paid): set_video_budget -> the budget card -> Allow (capped $0.05) -> search_models + call_model (MiniMax
//   TTS) -> the mp3 in jobs/<id>/incoming, a paid_tool ledger entry, the chip -> project_memory save citing that file
//   -> Edit + "Save note" (memory:update) -> the source button (memory:openSource).
//   node tools/ui-e2e-m15-spend.mjs --run RUN --engine ENGINE_DIR [--port 9387] [--only A|B]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot, dropFiles } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "m15");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9387"));
const ONLY = opt("--only");
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m14.mjs --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); // the installer's record next to the read-only engine (its verified build digest)
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version, ...(src0?.path === ENGINE && src0.buildSha256 ? { buildSha256: src0.buildSha256 } : (() => { try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; return /^[0-9a-f]{64}$/.test(d) ? { buildSha256: d } : {}; } catch { return {}; } })()) })); } // the engine's own build digest file (bootstrap.ts L389)
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m15-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m15 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
const env = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47733"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
for (const k of Object.keys(env)) if (k.startsWith("__CURSOR_SANDBOX")) delete env[k]; // box sandbox env-restore blobs embed provider keys under innocuous names
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete env[k];
if (!env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY is required for the credits-route turn"); process.exit(2); }
env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE = "gateway"; // new videos open on the VideoClaw-credits route = the shim → MiniMax (first-launch picker skipped)
env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS = "300000";
env.PYTHONDONTWRITEBYTECODE = "1"; // engine tools run from the shared read-only engine: never write __pycache__ into it
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
async function waitIdle(sid, timeoutMs) { return waitFor(`session ${sid} idle/error`, async () => { const r = sessions().sessions.find((x) => x.sessionId === sid); return r && (r.status === "idle" || r.status === "error") && !(await find("button.send-btn.stop")) ? r : null; }, { timeoutMs, every: 1000 }); }



const CODE = `VC${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const evRows = () => { try { return readFileSync(join(OUT, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const sessEvents = (sid) => evRows().filter((r) => r.ch === "session:event" && r.payload?.sessionId === sid).map((r) => r.payload.event);
// When MINIMAX_BASE_URL points at a local scripted stub, the agent's LLM turns are FAKE (scripted tool_use);
// the UI, cards, IPC, AgentHost, gateway proxy, shim ledger and engine are still the real port code.
const LLM_UPSTREAM = process.env.MINIMAX_BASE_URL && /127\.0\.0\.1|localhost/.test(process.env.MINIMAX_BASE_URL)
  ? "FAKE-LLM: local scripted Anthropic/t2a stub (" + process.env.MINIMAX_BASE_URL + ") — cards/IPC/ledger real, LLM + TTS bytes fake, $0 real spend"
  : "REAL MiniMax";
const summary = { phase: PHASE, llmUpstream: LLM_UPSTREAM, started: new Date().toISOString(), steps, code: CODE };
const sessRow = (sid) => sessions().sessions.find((x) => x.sessionId === sid);
async function sendTurn(text) { await click("composer", "textarea"); await selectAll(); await key("Backspace", 8); await typeText(cdp, text); await key("Enter", 13); }
const results = (sid) => sessEvents(sid).filter((e) => e.kind === "result" || e.kind === "error");
const spendRow = (id) => (readJson(join(UD, "spend-budgets.json"))?.entries ?? []).find((x) => x.sessionId === id) ?? null; // the original SpendBudgetStore v3 rows
const usedCents = (r) => (r?.committedCents ?? 0) + (r?.reservedCents ?? 0) + (r?.provisionalLlmCents ?? 0) + (r?.gatewayReservedCents ?? 0);
async function newVideo() {
  const before = ipcCalls("session:create").filter((r) => r.ok).length;
  const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
  await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
  const created = await waitFor("session:create", async () => ipcCalls("session:create").filter((r) => r.ok)[before] ?? null, { timeoutMs: 15_000 });
  await sleep(1200); return JSON.parse(created.result);
}
async function openById(id) { const r = sessRow(id); await openSession({ title: r.title, clientId: r.clientId }); }
const jobPaid = (jobId) => (ledger()?.entries ?? []).filter((e) => e.kind === "paid_tool" && e.clientJob === jobId);
const incomingFiles = (sid) => { const r = sessRow(sid); const inc = r?.cwd && r?.jobId ? join(r.cwd, "jobs", r.jobId, "incoming") : null; return inc && existsSync(inc) ? readdirSync(inc).filter((f) => /^model-[0-9a-f]{32}\./.test(f)).map((f) => ({ f, bytes: readFileSync(join(inc, f)).length })) : []; };
const decisions = (sid) => mainLogRows(/agent\.paid\.spend_decision/).filter((l) => l.includes(sid)).map((l) => { try { return JSON.parse(l.slice(l.indexOf("{"))); } catch { return { raw: l.slice(0, 300) }; } }).map((d) => ({ tool: d.tool, maximumUsd: d.maximumUsd, allowed: d.allowed, once: d.once, reason: d.reason }));
const approvals = (sid) => mainLogRows(/agent\.spend\.approval/).filter((l) => l.includes(sid)).map((l) => { try { const d = JSON.parse(l.slice(l.indexOf("{"))); return { phase: d.phase, purpose: d.purpose, decision: d.decision, maximumUsd: d.maximumUsd }; } catch { return null; } }).filter(Boolean);
const settled = (sid) => sessEvents(sid).filter((e) => e.kind === "ask_settled").map((e) => ({ family: e.record?.family, outcome: e.record?.outcome, title: e.record?.title, summary: e.record?.summary }));
const cardText = (sel) => cdp.eval(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); return c ? c.innerText.slice(0, 600) : null; })()`);
const SHORT_TTS = "你好，这是一次付费配音审批测试。";
const LONG_TTS = "清晨的海边小镇慢慢醒来，渔船在薄雾里轻轻摇晃，面包店飘出刚出炉的香气，老人沿着石板路散步，孩子们背着书包奔向学校，海鸥在码头上空盘旋鸣叫，阳光一点点穿过云层洒在屋顶上".repeat(4) + "。愿每一天都美好。";
const ttsTurn = (jobId, text) => `现在只做一件事：调用 call_model 工具一次，model_id 为 "minimax/speech-2.8-turbo"，job_id 为 "${jobId}"，input 为 {"text": ${JSON.stringify(text)}, "voice_id": "female-shaonv"}（text 必须逐字原样传入，不要改写或缩短）。不要调用 search_models 或任何其他工具，不要读写文件。工具返回后只用一句话回复结果（成功就给出保存的文件路径，被拒绝就说被拒绝）和 ${CODE}`;
async function bindTurn(sid) { const r0 = results(sid).length; await sendTurn(`只回复 OK ${CODE}。不要调用任何工具。`); await waitFor("bind turn result", async () => results(sid).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 }); await waitIdle(sid, 60_000).catch(() => null); await sleep(1500); return sessRow(sid)?.jobId; }
async function chooseMode(target) {
  const sel = await waitFor("mode select", () => find("select.mode-select"));
  const order = ["default", "acceptEdits", "auto", "bypassPermissions"];
  const cur = await cdp.eval(`document.querySelector("select.mode-select")?.value`);
  const n0 = ipcCalls("session:setPermissionMode").length;
  await mouseClick(cdp, center(sel).x, center(sel).y); await sleep(400);
  const delta = order.indexOf(target) - order.indexOf(cur);
  for (let i = 0; i < Math.abs(delta); i++) { await key(delta > 0 ? "ArrowDown" : "ArrowUp", delta > 0 ? 40 : 38); await sleep(150); }
  await key("Enter", 13); await sleep(800);
  return { cur, n0 };
}
let sidA, sidB, jobA, jobB;
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await waitFor("account ready", async () => ipcCalls("account:snapshot").some((r) => r.ok && field(r.result, "step") === "ready") || null, { timeoutMs: 30_000 }).catch(() => null);
  if (ONLY !== "B") {
  // ---- A0/A1: bind the job, then Bypass → Auto ⇒ ask_each
  await step("ask_each_mode", async () => {
    const c = await newVideo(); sidA = c.sessionId; summary.sessionA = sidA; summary.llmRouteA = c.llmRoute;
    jobA = await bindTurn(sidA); summary.jobA = jobA;
    const before = spendRow(sidA)?.policy;
    const b = await chooseMode("bypassPermissions");
    const dlg = await waitFor("Enable Bypass dialog", () => find(".spend-transition-dialog .remove-confirm"), { timeoutMs: 10_000 });
    await shot("A1a-bypass-confirm");
    await click("Enable Bypass", ".spend-transition-dialog .remove-confirm");
    const toBypass = await waitFor("setPermissionMode(bypass)", async () => ipcCalls("session:setPermissionMode").slice(b.n0).find((r) => r.ok && /bypassPermissions/.test(r.args)) ?? null, { timeoutMs: 15_000 });
    await waitFor("unlimited (bypass)", async () => spendRow(sidA)?.policy === "unlimited_for_video" || null, { timeoutMs: 10_000 }).catch(() => null);
    await sleep(800);
    const a = await chooseMode("auto");
    const toAuto = await waitFor("setPermissionMode(auto)", async () => ipcCalls("session:setPermissionMode").slice(a.n0).find((r) => r.ok && /"auto"/.test(r.args)) ?? null, { timeoutMs: 15_000 });
    const askEach = await waitFor("ask_each", async () => spendRow(sidA)?.policy === "ask_each" || null, { timeoutMs: 15_000 }).catch(() => null);
    await sleep(800); await shot("A1b-auto-ask-each");
    const installed = mainLogRows(/agent\.spend\.policy_installed/).filter((l) => l.includes(sidA)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 260));
    summary.mode = { before, dialog: !!dlg, toBypass: toBypass.args, toAuto: toAuto.args, policy: spendRow(sidA)?.policy, installed };
    verdict("ask_each_mode", !!askEach && !!dlg, summary.mode);
  });
  // ---- A2: the per-operation card → Deny
  await step("ask_each_deny", async () => {
    const r0 = results(sidA).length; const paid0 = jobPaid(jobA).length;
    await sendTurn(ttsTurn(jobA, SHORT_TTS));
    const card = await waitFor("paid-operation card", () => find(".permission-card.money button.deny"), { timeoutMs: 6 * 60_000, every: 1000 });
    const text = await cardText(".permission-card.money"); await sleep(500); await shot("A2a-money-card");
    await click("Deny", ".permission-card.money button.deny");
    await waitFor("deny turn result", async () => results(sidA).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sidA, 60_000).catch(() => null); await sleep(1500); await shot("A2b-denied");
    const reply = sessEvents(sidA).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.askDeny = { card: text, decisions: decisions(sidA), approvals: approvals(sidA), settled: settled(sidA), paidEntries: jobPaid(jobA).length - paid0, files: incomingFiles(sidA), policy: spendRow(sidA)?.policy, reply: String(reply ?? "").slice(0, 200) };
    verdict("ask_each_deny", !!card && /Allow once|Deny/.test(text ?? "") && summary.askDeny.paidEntries === 0 && summary.askDeny.decisions.some((d) => d.allowed === false && /denied by the user/.test(d.reason ?? "")) && summary.askDeny.settled.some((s) => s.outcome === "denied"), summary.askDeny);
  });
  // ---- A3: the per-operation card → Allow once
  await step("ask_each_allow_once", async () => {
    const r0 = results(sidA).length; const paid0 = jobPaid(jobA).length;
    await sendTurn(ttsTurn(jobA, SHORT_TTS));
    const card = await waitFor("paid-operation card", () => find(".permission-card.money button.allow", { text: "^Allow once$" }), { timeoutMs: 6 * 60_000, every: 1000 });
    const text = await cardText(".permission-card.money"); await sleep(500); await shot("A3a-money-card");
    await click("Allow once", ".permission-card.money button.allow", { text: "^Allow once$" });
    await waitFor("allow turn result", async () => results(sidA).length > r0 || null, { timeoutMs: 8 * 60_000, every: 1000 });
    await waitIdle(sidA, 60_000).catch(() => null); await sleep(2000); await shot("A3b-allowed");
    const paid = jobPaid(jobA).slice(paid0);
    const permits = (ledger()?.permits ?? []).map((p) => ({ used: p.used, maximumUsd: p.maximumUsd ?? p.maximum_approved_usd }));
    const reply = sessEvents(sidA).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.askAllow = { card: text, decisions: decisions(sidA).slice(-2), approvals: approvals(sidA).slice(-3), settled: settled(sidA).slice(-1), paid: paid.map((e) => ({ model: e.model, usd: e.usd, units: e.units, maximumUsd: e.pricing?.maximumUsd, pricing: e.pricing?.source })), permits, files: incomingFiles(sidA), policy: spendRow(sidA)?.policy, reply: String(reply ?? "").slice(0, 200) };
    verdict("ask_each_allow_once", !!card && paid.length === 1 && paid[0].usd > 0 && summary.askAllow.files.some((x) => /\.mp3$/.test(x.f) && x.bytes > 1000) && summary.askAllow.decisions.some((d) => d.allowed === true && d.once === true) && summary.askAllow.policy === "ask_each" && permits.some((p) => p.used === true), summary.askAllow);
  });
  // ---- task 4: request_files → the files card → OS drag-and-drop → Send files
  await step("files_card", async () => {
    const png = join(OUT, "m15-ref.png");
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const r0 = results(sidA).length;
    await sendTurn(`现在只做一件事：调用 request_files 工具一次，description 为 "请提供一张参考图（PNG）"，dest_dir 为 "jobs/${jobA}/refs"，accept 为 [".png"]。不要调用任何其他工具。工具返回后只回复保存了几个文件和 ${CODE}`);
    const drop = await waitFor("files card", () => find(".input-card .ic-drop"), { timeoutMs: 6 * 60_000, every: 1000 });
    const text = await cardText(".input-card"); await shot("T4a-files-card");
    await dropFiles(cdp, center(drop).x, center(drop).y, [png]);
    const listed = await waitFor("dropped file listed", () => find(".input-card .ic-file"), { timeoutMs: 15_000 });
    await shot("T4b-file-dropped");
    await click("Send files", ".input-card button.ic-save", { text: "^Send files$" });
    await waitFor("files turn result", async () => results(sidA).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sidA, 60_000).catch(() => null); await sleep(1500); await shot("T4c-files-sent");
    const r = sessRow(sidA); const dest = join(r.cwd, "jobs", jobA, "refs");
    const copied = existsSync(dest) ? readdirSync(dest) : [];
    const tools = sessEvents(sidA).filter((e) => e.kind === "tool_start").map((e) => e.toolName ?? e.name).slice(-3);
    const reply = sessEvents(sidA).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.files = { card: text, listed: listed?.label, copied, tools, settled: settled(sidA).slice(-1), reply: String(reply ?? "").slice(0, 200) };
    verdict("files_card", copied.some((f) => /\.png$/.test(f)) && tools.some((t) => /request_files/.test(String(t))), summary.files);
  });
  }
  if (ONLY !== "A") {
  // ---- B0/B1: bind, then cap = used + 2¢ through the strip's "Set production budget"
  const setCap = async (label) => {
    const row = spendRow(sidB); const cents = usedCents(row) + 2;
    const opener = await find("button", { aria: "^Set production budget|Change video budget" });
    await click("budget strip", "button", { aria: "^Set production budget|Change video budget" });
    await click("budget input", "#video-production-budget"); await selectAll(); await key("Backspace", 8); await typeText(cdp, (cents / 100).toFixed(2));
    await shot(`${label}-cap-form`);
    await click("Save budget", ".vs-budget-form button[type=submit]");
    const ok = await waitFor("capped", async () => { const r = spendRow(sidB); return r?.policy === "capped" && r.ceilingCents === cents ? r : null; }, { timeoutMs: 15_000 });
    await key("Escape", 27).catch(() => {}); await sleep(600);
    return { usedCentsBefore: usedCents(row), ceilingCents: ok.ceilingCents, opener: opener?.label };
  };
  await step("raise_deny", async () => {
    const c = await newVideo(); sidB = c.sessionId; summary.sessionB = sidB; summary.llmRouteB = c.llmRoute;
    jobB = await bindTurn(sidB); summary.jobB = jobB;
    const cap = await setCap("B1");
    const r0 = results(sidB).length; const paid0 = jobPaid(jobB).length;
    await sendTurn(ttsTurn(jobB, LONG_TTS));
    const card = await waitFor("raise card", () => find(".spend-budget-card button.deny"), { timeoutMs: 6 * 60_000, every: 1000 });
    const text = await cardText(".spend-budget-card"); await sleep(500); await shot("B2a-raise-card");
    await click("Deny", ".spend-budget-card button.deny");
    await waitFor("deny turn result", async () => results(sidB).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sidB, 60_000).catch(() => null); await sleep(1500); await shot("B2b-raise-denied");
    const reply = sessEvents(sidB).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.raiseDeny = { cap, card: text, decisions: decisions(sidB), approvals: approvals(sidB), settled: settled(sidB), paidEntries: jobPaid(jobB).length - paid0, ceilingCentsAfter: spendRow(sidB)?.ceilingCents, reply: String(reply ?? "").slice(0, 200) };
    verdict("raise_deny", /Raise spending limit\?/.test(text ?? "") && summary.raiseDeny.paidEntries === 0 && summary.raiseDeny.ceilingCentsAfter === cap.ceilingCents && summary.raiseDeny.decisions.some((d) => d.allowed === false && /increase was not approved/.test(d.reason ?? "")), summary.raiseDeny);
  });
  await step("raise_allow", async () => {
    const cap = await setCap("B3");
    const r0 = results(sidB).length; const paid0 = jobPaid(jobB).length;
    await sendTurn(ttsTurn(jobB, LONG_TTS));
    const card = await waitFor("raise card", () => find(".spend-budget-card button.allow"), { timeoutMs: 6 * 60_000, every: 1000 });
    const text = await cardText(".spend-budget-card"); await sleep(500); await shot("B3a-raise-card");
    await click("Allow (raise)", ".spend-budget-card button.allow");
    await waitFor("allow turn result", async () => results(sidB).length > r0 || null, { timeoutMs: 8 * 60_000, every: 1000 });
    await waitIdle(sidB, 60_000).catch(() => null); await sleep(2000); await shot("B3b-raised");
    const paid = jobPaid(jobB).slice(paid0);
    const reply = sessEvents(sidB).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    const chip = await cdp.eval(`(() => { const b = document.querySelector("button.vs-spend"); return b ? b.innerText : null; })()`);
    summary.raiseAllow = { cap, card: text, decisions: decisions(sidB).slice(-2), approvals: approvals(sidB).slice(-3), settled: settled(sidB).slice(-1), paid: paid.map((e) => ({ model: e.model, usd: e.usd, units: e.units, maximumUsd: e.pricing?.maximumUsd })), ceilingCentsAfter: spendRow(sidB)?.ceilingCents, files: incomingFiles(sidB), chip, reply: String(reply ?? "").slice(0, 200) };
    verdict("raise_allow", /Raise spending limit\?/.test(text ?? "") && paid.length === 1 && summary.raiseAllow.ceilingCentsAfter > cap.ceilingCents && summary.raiseAllow.files.some((x) => /\.mp3$/.test(x.f) && x.bytes > 1000), summary.raiseAllow);
  });
  }
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.length, usd: L.entries.reduce((a, e) => a + e.usd, 0), paidToolUsd: L.entries.filter((e) => e.kind === "paid_tool").reduce((a, e) => a + e.usd, 0), llmUsd: L.entries.filter((e) => e.kind !== "paid_tool").reduce((a, e) => a + e.usd, 0) }; })();
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m15-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
