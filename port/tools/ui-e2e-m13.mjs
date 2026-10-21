#!/usr/bin/env node
// PORT-NEW docs/30 M13 — the studio MCP tools through the ORIGINAL renderer (real CDP input; page evaluation is
// read-only DOM/geometry, window.videoclaw is never called). Infrastructure copied from ui-e2e-m12.mjs. Launched
// with VIDEOCLAW_PORT_LOCAL_GATEWAY=1 on a FRESH userData; new videos open on the gateway route (Claude Agent SDK →
// local shim /anthropic → MiniMax), so every turn is a REAL MiniMax agent turn metered in the shim ledger.
// Steps (short turns, concurrency 1):
//   plan     — the agent calls mcp__studio__propose_session_plan → sessionPlan:changed → the plan card → real click
//              "Build it" → sessionPlan:choose → the dispatched plan turn (stopped right away: no production)
//   memory   — the agent calls mcp__studio__project_memory (save) → "Remembered something" notice → real click Undo
//              → memory:undo
//   input    — the agent calls mcp__studio__request_rights_confirmation → input:request → the rights card → tick
//              the checkbox → "Confirm and continue" → input:respond → the tool result reaches the agent
//   spend    — the spend chip equals the ledger's per-job spend (models.dev-priced), not the SDK estimate
//   node tools/ui-e2e-m13.mjs --phase m13 --run RUN --engine ENGINE_DIR [--port 9384]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "m13");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9384"));
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m13.mjs --phase m13 --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); // the installer's record next to the read-only engine (its verified build digest)
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version, ...(src0?.path === ENGINE && src0.buildSha256 ? { buildSha256: src0.buildSha256 } : (() => { try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; return /^[0-9a-f]{64}$/.test(d) ? { buildSha256: d } : {}; } catch { return {}; } })()) })); } // the engine's own build digest file (bootstrap.ts L389)
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m13-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m13 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
const env = { ...process.env, HOME: RUN, VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47721"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
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
const summary = { phase: PHASE, started: new Date().toISOString(), steps, code: CODE };
async function openProfileMenu() {
  if (await find("button[role='menuitem']", { text: "Check for updates|Checking for updates" })) return;
  await click("profile button", "button.profile-button"); await sleep(500);
}

// the original's local memory store: userData/memory/<sha>/projects/<sha>/MEMORY.md (+ siblings)
function memoryOnDisk() { const out = []; const walk = (d) => { let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(md|json|jsonl)$/.test(e.name)) { try { out.push({ file: f.slice(UD.length + 1), text: readFileSync(f, "utf8").slice(0, 600) }); } catch {} } } }; walk(join(UD, "memory")); return out; }
const sessRow = (sid) => sessions().sessions.find((x) => x.sessionId === sid);
const jobLedger = (jobId) => (ledger()?.entries ?? []).filter((e) => e.clientJob === jobId);
async function sendTurn(text) { await click("composer", "textarea"); await selectAll(); await key("Backspace", 8); await typeText(cdp, text); await key("Enter", 13); }
const STOP = "button.send-btn.stop"; // the original composer's Stop button (title "Stop")
async function stopIfRunning() { const b = await waitFor("Stop button", () => find(STOP), { timeoutMs: 20_000 }).catch(() => null); if (b) { await click("Stop", STOP); await sleep(1500); } return !!b; }
const results = (sid) => sessEvents(sid).filter((e) => e.kind === "result" || e.kind === "error");
let sid;
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await waitFor("account ready", async () => ipcCalls("account:snapshot").some((r) => r.ok && field(r.result, "step") === "ready") || null, { timeoutMs: 30_000 }).catch(() => null);
  // ---- PLAN: new video → the agent proposes a plan → card → Build it
  await step("plan_card_build", async () => {
    const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
    await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
    const created = await waitFor("session:create", async () => ipcCalls("session:create").find((r) => r.ok) ?? null, { timeoutMs: 15_000 });
    sid = JSON.parse(created.result).sessionId; summary.sessionId = sid; summary.llmRoute = JSON.parse(created.result).llmRoute;
    await sleep(1200);
    await sendTurn(`做一个10秒竖屏咖啡倒入的短视频。现在只做方案：直接调用 propose_session_plan 工具一次（context 写简短说明；fallback 里给 title、text、canvas {width:1080,height:1920} 和 2 个 shots），不要运行任何其他工具、不要读写文件、不要生成媒体。调用后用一句话告诉我方案已提出，然后结束本轮等待我选择。${CODE}`);
    // the main process logs every push ("[smoke] push <channel> [payload]"): the plan push is read from there
    const pushRows = (ch) => mainLogRows(new RegExp(`\\[smoke\\] push ${esc(ch)} `)).map((l) => ({ raw: l.slice(l.indexOf(" [") + 1, l.indexOf(" [") + 401), sessionId: /"sessionId":"([^"]+)"/.exec(l)?.[1], phase: /"phase":"([^"]+)"/.exec(l)?.[1], revision: Number(/"revision":([0-9]+)/.exec(l)?.[1]), gatewayUrl: /"gatewayUrl":"([^"]+)"/.exec(l)?.[1] }));
    const changed = await waitFor("sessionPlan:changed push", async () => pushRows("sessionPlan:changed").find((p) => p.sessionId === sid) ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sid)[0] ?? null, { timeoutMs: 5 * 60_000, every: 1000 });
    const btn = await waitFor("Build it button", () => find("button.session-plan-primary", { text: "^Build it$" }), { timeoutMs: 30_000 });
    await sleep(800); await shot("01a-plan-card");
    const cardText = await cdp.eval(`(() => { const b = document.querySelector("button.session-plan-primary"); let e = b; for (let i = 0; i < 6 && e && e.parentElement; i++) e = e.parentElement; return e ? e.innerText.slice(0, 600) : null; })()`);
    const before = results(sid).length; const evAtChoose = sessEvents(sid).length;
    await click("Build it", "button.session-plan-primary", { text: "^Build it$" });
    const chose = await waitFor("sessionPlan:choose", async () => ipcCalls("sessionPlan:choose").find((x) => x.ok) ?? null, { timeoutMs: 60_000 });
    const plan = sessRow(sid)?.sessionPlan;
    await sleep(1500); await shot("01b-built");
    // the agent PROCEEDS with the choice: the dispatched Build-it turn (plan.decision.text, L37500) starts and the
    // agent's first action of that turn is captured; then it is stopped (short turns; no media spend)
    const evBefore = summary.evAtChoose = evAtChoose;
    const proceeded = await waitFor("agent acts on the Build-it turn", async () => { const ev = sessEvents(sid).slice(evBefore); const act = ev.find((e) => e.kind === "tool_start" || e.kind === "assistant_text"); return act ? { firstAction: act.kind === "tool_start" ? { tool: act.toolName, summary: String(act.summary ?? "").slice(0, 160) } : { text: String(act.text).slice(0, 200) }, userText: ev.filter((e) => e.kind === "user_text").map((e) => String(e.text).slice(0, 200)) } : null; }, { timeoutMs: 4 * 60_000, every: 1000 }).catch(() => null);
    await shot("01c-proceeding");
    summary.planTurnStopped = await stopIfRunning();
    await waitFor("plan turn ended", async () => results(sid).length > before || null, { timeoutMs: 120_000, every: 1000 }).catch(() => null);
    await waitIdle(sid, 120_000).catch(() => null);
    const toolUse = sessEvents(sid).filter((e) => e.kind === "tool_start" || e.kind === "tool_use").map((e) => e.name ?? e.toolName).filter(Boolean);
    summary.plan = { changedPush: { sessionId: changed.sessionId, gatewayUrl: changed.gatewayUrl, phase: changed.phase, revision: changed.revision }, cardText, choose: { real: chose.real, args: String(chose.args).slice(0, 300), result: String(chose.result).slice(0, 400) }, registryPlan: plan && { phase: plan.phase, revision: plan.revision, decision: plan.decision?.action }, jobId: sessRow(sid)?.jobId, tools: [...new Set(toolUse)], proceeded, planPhaseAfter: sessRow(sid)?.sessionPlan?.phase };
    verdict("plan_card_build", !!btn && chose.real && /"phase":"(accepted|dispatching)"/.test(chose.result) && plan?.decision?.action === "build" && !!proceeded, summary.plan);
  });
  // ---- MEMORY: the agent saves a project note → notice → Undo
  await step("memory_notice_undo", async () => {
    const before = results(sid).length;
    await sendTurn(`现在只做一件事：调用 project_memory 工具一次，action 为 save，记住这条项目偏好："本项目的视频统一使用青色色调"。不要运行任何其他工具。保存后只回复：已记住 ${CODE}`);
    const notice = await waitFor("Remembered something notice", () => find("div.memory-notice", { text: "Remembered something" }), { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sid).length > before || null, { timeoutMs: 5 * 60_000, every: 1000 }).catch(() => null);
    await sleep(800); await shot("02a-memory-notice");
    const diskSaved = memoryOnDisk();
    const undoBtn = await waitFor("Undo enabled", async () => { const ok = await cdp.eval(`(() => { const n = [...document.querySelectorAll("div.memory-notice")].find((d) => /Remembered something/.test(d.innerText)); const b = n && [...n.querySelectorAll("button")].find((x) => x.innerText.trim() === "Undo"); return !!b && !b.disabled; })()`); return ok || null; }, { timeoutMs: 20_000 });
    await click("Undo", "div.memory-notice button", { text: "^Undo$" });
    const undo = await waitFor("memory:undo", async () => ipcCalls("memory:undo").find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    const after = await waitFor("notice after undo", async () => { const t = await bodyText(); const m = /Remembered, then forgotten|Forgotten for this project/.exec(t); return m ? m[0] : null; }, { timeoutMs: 20_000 }).catch(() => null);
    await sleep(800); await shot("02b-memory-undone");
    await sleep(500); const diskUndone = memoryOnDisk();
    const updates = ipcCalls("memory:update").length;
    summary.memory = { notice: notice.label, undo: { real: undo.real, result: String(undo.result).slice(0, 400) }, afterUndo: after, diskSaved, diskUndone, rendererMemoryUpdates: updates, memoryEvents: sessEvents(sid).filter((e) => /memory/.test(e.kind)).map((e) => ({ kind: e.kind, action: e.action ?? e.notice?.action })).slice(0, 5) };
    verdict("memory_notice_undo", !!notice && !!undoBtn && undo.real && !/"error"/.test(undo.result) && !!after && diskSaved.some((f) => /MEMORY\.md$/.test(f.file) && /青色/.test(f.text)) && !diskUndone.some((f) => /MEMORY\.md$/.test(f.file) && /青色/.test(f.text)), summary.memory);
    await waitIdle(sid, 60_000).catch(() => null);
  });
  // ---- INPUT: the agent asks for a rights confirmation → card → tick → Confirm and continue
  await step("input_rights_card", async () => {
    const before = results(sid).length;
    await sendTurn(`现在只做一件事：调用 request_rights_confirmation 工具一次（subject: "Ana Test"，purpose: "片头配音示例"），不要运行任何其他工具。等工具返回后，只回复工具结果里 confirmed 字段的值和 ${CODE}`);
    await waitFor("rights card", () => find("div.rights-card"), { timeoutMs: 6 * 60_000, every: 1000 });
    const req = mainLogRows(/\[smoke\] push input:request /).map((l) => l.slice(l.indexOf(" [") + 1, l.indexOf(" [") + 400))[0];
    await sleep(800); await shot("03a-rights-card");
    await click("rights checkbox", "label.rights-check input[type='checkbox']");
    await sleep(300);
    await click("Confirm and continue", "button.ic-save", { text: "^Confirm and continue$" });
    const resp = await waitFor("input:respond", async () => ipcCalls("input:respond").find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    const res = await waitFor("turn result", async () => results(sid).length > before ? results(sid).slice(-1)[0] : null, { timeoutMs: 5 * 60_000, every: 1000 });
    await sleep(2000); await shot("03b-rights-done");
    const text = sessEvents(sid).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-2).join(" ");
    const settled = sessEvents(sid).find((e) => e.kind === "ask_settled");
    summary.input = { request: req ?? null, respond: { real: resp.real, args: String(resp.args).slice(0, 200) }, settled: settled?.record, result: res, reply: text.slice(0, 300) };
    verdict("input_rights_card", resp.real && /"accepted":true/.test(resp.args) && settled?.record?.outcome === "answered" && res.kind === "result" && /true/i.test(text), summary.input);
  });
  // ---- SPEND: chip == the ledger's per-job spend (models.dev prices), never the SDK estimate
  await step("spend_chip_matches_ledger", async () => {
    await waitIdle(sid, 60_000).catch(() => null); await sleep(3000);
    const jobId = sessRow(sid)?.jobId;
    const entries = jobLedger(jobId);
    const ledgerUsd = entries.reduce((a, e) => a + e.usd, 0);
    const chip = await waitFor("spend chip", async () => { const t = await bodyText(); const m = /\$([0-9]+\.[0-9]{2}) spent/.exec(t); return m ? m[0] : null; }, { timeoutMs: 20_000 }).catch(() => null);
    // the chip shows the spend budget's spentUsd: whole cents of the gateway ledger (reconcileGatewayLedger → toCents, ceil)
    const cents = (usd) => { const raw = usd * 100, n = Math.round(raw); return Math.abs(raw - n) < 1e-9 ? n : Math.ceil(raw); };
    const expectedChip = `$${(cents(ledgerUsd) / 100).toFixed(2)} spent`;
    await shot("04-spend-chip");
    // real click on the original spend chip → the "where the spend went" popover (gateway reasoning = meta.totalCostUsd)
    let breakdown = null;
    try { await click("spend chip", "button.vs-spend"); breakdown = await waitFor("spend breakdown", async () => cdp.eval(`(() => { const b = document.querySelector(".vs-breakdown"); return b ? b.innerText : null; })()`), { timeoutMs: 10_000 }); await sleep(500); await shot("04b-spend-breakdown"); await key("Escape", 27); } catch (e) { breakdown = `error: ${String(e?.message ?? e).slice(0, 200)}`; }
    const metaTotalCostUsd = sessRow(sid)?.totalCostUsd;
    const metered = mainLogRows(/agent\.spend\.metered/).filter((l) => l.includes(sid)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 420));
    const reconciled = mainLogRows(/agent\.spend\.gateway_reconciled/).filter((l) => l.includes(sid)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 300));
    const pricing = mainLogRows(/\[port\] pricing: |models\.dev catalog/).slice(0, 6);
    const meteredRows = metered.map((l) => ({ ts: Date.parse(/"ts":"([^"]+)"/.exec(l)?.[1] ?? ""), runtimeUsd: Number(/"runtimeUsd":([0-9.e-]+)/.exec(l)?.[1]), totalUsd: Number(/"totalUsd":([0-9.e-]+)/.exec(l)?.[1]), sdkEstimateUsd: Number(/"sdkEstimateUsd":([0-9.e-]+)/.exec(l)?.[1]) }));
    const metaTotal = meteredRows.at(-1)?.totalUsd; const sdkEst = meteredRows.at(-1)?.sdkEstimateUsd;
    // per-result check: the agent's metered cost (SDK modelUsage tokens × the models.dev price) vs the ledger entries
    // the shim had recorded for this job by that result
    const perResult = meteredRows.map((r) => { const led = entries.filter((e) => e.at <= r.ts).reduce((a, e) => a + e.usd, 0); return { meteredTotalUsd: r.totalUsd, ledgerUsdThen: Math.round(led * 1e9) / 1e9, sdkEstimateUsd: r.sdkEstimateUsd }; });
    const firstExact = perResult.length > 0 && Math.abs(perResult[0].meteredTotalUsd - perResult[0].ledgerUsdThen) < 1e-6;
    summary.spend = { jobId, ledgerEntries: entries.length, ledgerUsd, entrySources: [...new Set(entries.map((e) => e.pricing?.source))], chip, expectedChip, breakdown, metaTotalCostUsd, meteredTotalUsd: metaTotal, sdkEstimateUsd: sdkEst, perResult, firstResultExact: firstExact, reconciled: reconciled.slice(-2), pricingLog: pricing, untaggedEntries: (ledger()?.entries ?? []).filter((e) => !e.clientJob).length };
    const reasoningRow = /Videoclaw gateway reasoning\s*\$([0-9]+\.[0-9]{2})/.exec(breakdown ?? "")?.[1];
    summary.spend.reasoningRow = reasoningRow; summary.spend.expectedReasoningRow = ledgerUsd.toFixed(2);
    summary.spend.displayedEqualsLedger = Number.isFinite(metaTotalCostUsd) && Math.abs(metaTotalCostUsd - ledgerUsd) < 1e-6;
    verdict("spend_chip_matches_ledger", entries.length > 0 && chip === expectedChip && reasoningRow === ledgerUsd.toFixed(2) && summary.spend.displayedEqualsLedger && entries.every((e) => /^models\.dev:/.test(e.pricing?.source ?? "")) && firstExact && Number.isFinite(metaTotal) && metaTotal < sdkEst, summary.spend);
  });
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.length, usd: L.entries.reduce((a, e) => a + e.usd, 0), sources: [...new Set(L.entries.map((e) => e.pricing?.source))] }; })();
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.m13Channels = Object.fromEntries(["sessionPlan:read", "sessionPlan:choose", "sessionPlan:retry", "memory:read", "memory:update", "memory:undo", "memory:openSource", "input:respond"].map((c) => [c, ipcCalls(c).map((r) => ({ ok: r.ok, real: r.real }))]));
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m13-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
