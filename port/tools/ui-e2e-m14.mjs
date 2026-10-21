#!/usr/bin/env node
// PORT-NEW docs/31 M14 — the paid tool plane + the remaining plan/memory controls through the ORIGINAL renderer
// (real CDP input; page evaluation is read-only DOM/geometry, window.videoclaw is never called). Infrastructure copied
// from ui-e2e-m13.mjs. VIDEOCLAW_PORT_LOCAL_GATEWAY=1 on a FRESH userData; new videos open on the gateway route
// (Claude Agent SDK -> local shim /anthropic -> MiniMax) and the verbatim AgentGatewayProxy fronts the engine's paid
// model_call (shim /v1/model_call -> MiniMax media). Concurrency 1.
// Session A (plan): propose -> "Show me a preview" -> "Change it" + "Send changes" -> (while B runs) "Build it" fails
//   -> "Retry" -> a new proposal -> "Dismiss plan".
// Session B (paid): set_video_budget -> the budget card -> Allow (capped $0.05) -> search_models + call_model (MiniMax
//   TTS) -> the mp3 in jobs/<id>/incoming, a paid_tool ledger entry, the chip -> project_memory save citing that file
//   -> Edit + "Save note" (memory:update) -> the source button (memory:openSource).
//   node tools/ui-e2e-m14.mjs --run RUN --engine ENGINE_DIR [--port 9386]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "m14");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9386"));
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m14.mjs --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); // the installer's record next to the read-only engine (its verified build digest)
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version, ...(src0?.path === ENGINE && src0.buildSha256 ? { buildSha256: src0.buildSha256 } : (() => { try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; return /^[0-9a-f]{64}$/.test(d) ? { buildSha256: d } : {}; } catch { return {}; } })()) })); } // the engine's own build digest file (bootstrap.ts L389)
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m14-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m14 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
const env = { ...process.env, HOME: RUN, VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47731"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
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
const pushRows = (ch) => mainLogRows(new RegExp(`\\[smoke\\] push ${esc(ch)} `)).map((l) => ({ raw: l.slice(l.indexOf(" [") + 1, l.indexOf(" [") + 401), sessionId: /"sessionId":"([^"]+)"/.exec(l)?.[1], phase: /"phase":"([^"]+)"/.exec(l)?.[1], revision: Number(/"revision":([0-9]+)/.exec(l)?.[1]), dismissed: /"dismissed":true/.test(l) }));
const planPush = (id) => pushRows("sessionPlan:changed").filter((p) => p.sessionId === id);
const planText = () => cdp.eval(`(() => { const c = document.querySelector(".session-plan-card"); return c ? c.innerText.slice(0, 700) : null; })()`);
const choices = () => ipcCalls("sessionPlan:choose");
const spendRow = (id) => (readJson(join(UD, "spend-budgets.json"))?.entries ?? []).find((x) => x.sessionId === id) ?? null; // the original SpendBudgetStore v3 rows
async function newVideo() {
  const before = ipcCalls("session:create").filter((r) => r.ok).length;
  const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
  await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
  const created = await waitFor("session:create", async () => ipcCalls("session:create").filter((r) => r.ok)[before] ?? null, { timeoutMs: 15_000 });
  await sleep(1200); return JSON.parse(created.result);
}
async function openById(id) { const r = sessRow(id); await openSession({ title: r.title, clientId: r.clientId }); }
let sidA, sidB;
const PROPOSE = (extra) => `做一个10秒竖屏咖啡倒入的短视频。现在只做方案：直接调用 propose_session_plan 工具一次（context 写简短说明；fallback 里给 title、text、canvas {width:1080,height:1920} 和 2 个 shots）${extra ?? ""}，不要运行任何其他工具、不要读写文件、不要生成媒体。调用后用一句话告诉我方案已提出，然后结束本轮等待我选择。${CODE}`;
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await waitFor("account ready", async () => ipcCalls("account:snapshot").some((r) => r.ok && field(r.result, "step") === "ready") || null, { timeoutMs: 30_000 }).catch(() => null);
  // ---- A1: proposal
  await step("plan_propose", async () => {
    const c = await newVideo(); sidA = c.sessionId; summary.sessionA = sidA; summary.llmRouteA = c.llmRoute;
    await sendTurn(PROPOSE());
    const changed = await waitFor("sessionPlan:changed push", async () => planPush(sidA)[0] ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sidA)[0] ?? null, { timeoutMs: 5 * 60_000, every: 1000 });
    const btn = await waitFor("Build it button", () => find("button.session-plan-primary", { text: "^Build it$" }), { timeoutMs: 30_000 });
    await waitIdle(sidA, 60_000).catch(() => null);
    await sleep(800); await shot("01-plan-card");
    summary.propose = { changed, card: await planText() };
    verdict("plan_propose", !!btn && changed.phase === "awaiting-decision", summary.propose);
  });
  // ---- A2: "Show me a preview" → choose(preview) → the dispatched preview turn (stopped right away)
  await step("plan_preview", async () => {
    const n0 = choices().length; const r0 = results(sidA).length;
    await click("Show me a preview", ".session-plan-card button", { text: "^Show me a preview$" });
    const chose = await waitFor("sessionPlan:choose(preview)", async () => choices().slice(n0).find((x) => x.ok) ?? null, { timeoutMs: 60_000 });
    const label = await waitFor("Preview requested", () => find(".session-plan-card button", { text: "^Preview requested$" }), { timeoutMs: 20_000 }).catch(() => null);
    await sleep(1000); await shot("02a-preview-requested");
    const ev0 = sessEvents(sidA).length;
    const acted = await waitFor("agent acts on the preview turn", async () => sessEvents(sidA).slice(ev0).find((e) => e.kind === "tool_start" || e.kind === "assistant_text") ?? null, { timeoutMs: 3 * 60_000, every: 1000 }).catch(() => null);
    const stopped = await stopIfRunning();
    await waitFor("preview turn ended", async () => results(sidA).length > r0 || null, { timeoutMs: 120_000, every: 1000 }).catch(() => null);
    await waitIdle(sidA, 120_000).catch(() => null); await sleep(1000); await shot("02b-preview-stopped");
    const plan = sessRow(sidA)?.sessionPlan;
    summary.preview = { choose: { real: chose.real, args: String(chose.args).slice(0, 300), result: String(chose.result).slice(0, 300) }, label: label?.label, firstAction: acted && { kind: acted.kind, tool: acted.toolName, text: acted.text && String(acted.text).slice(0, 160) }, stopped, plan: plan && { phase: plan.phase, decision: plan.decision?.action, revision: plan.revision } };
    verdict("plan_preview", chose.real && /"action":"preview"/.test(chose.args) && !!label && plan?.decision?.action === "preview", summary.preview);
  });
  // ---- A3: "Change it" → correction → "Send changes" → choose(change) → the agent re-proposes (new revision)
  await step("plan_change", async () => {
    const n0 = choices().length; const rev0 = sessRow(sidA)?.sessionPlan?.revision ?? 0; const r0 = results(sidA).length;
    await click("Change it", ".session-plan-card button", { text: "^Change it$" });
    await click("correction box", "#session-plan-correction-text");
    await typeText(cdp, "改成8秒。只需再调用 propose_session_plan 一次给出更新后的方案（canvas 不变），不要运行其他工具。");
    await sleep(400); await shot("03a-change-form");
    await click("Send changes", ".session-plan-card button", { text: "^Send changes$" });
    const chose = await waitFor("sessionPlan:choose(change)", async () => choices().slice(n0).find((x) => x.ok) ?? null, { timeoutMs: 60_000 });
    const re = await waitFor("re-proposal push", async () => planPush(sidA).find((p) => p.revision > rev0 && p.phase === "awaiting-decision") ?? null, { timeoutMs: 6 * 60_000, every: 1000 }).catch(() => null);
    await waitFor("change turn ended", async () => results(sidA).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 }).catch(() => null);
    await waitIdle(sidA, 120_000).catch(() => null);
    const btn = await waitFor("Build it (rev 2)", () => find("button.session-plan-primary", { text: "^Build it$" }), { timeoutMs: 30_000 }).catch(() => null);
    await sleep(800); await shot("03b-changed-plan");
    summary.change = { choose: { real: chose.real, args: String(chose.args).slice(0, 400), result: String(chose.result).slice(0, 300) }, revisionBefore: rev0, rePush: re, card: await planText() };
    verdict("plan_change", chose.real && /"action":"change"/.test(chose.args) && !!re && !!btn, summary.change);
  });
  // ---- B1: set_video_budget → the budget card → Allow
  await step("budget_card", async () => {
    const c = await newVideo(); sidB = c.sessionId; summary.sessionB = sidB; summary.llmRouteB = c.llmRoute;
    await sendTurn(`现在只做一件事：调用 set_video_budget 工具一次，amount_usd 为 0.05。不要运行任何其他工具。工具返回后只回复 approved 字段的值和 ${CODE}`);
    const card = await waitFor("budget card", () => find(".spend-budget-card"), { timeoutMs: 6 * 60_000, every: 1000 });
    const cardText = await cdp.eval(`(() => { const c = document.querySelector(".spend-budget-card"); return c ? c.innerText.slice(0, 400) : null; })()`);
    await sleep(600); await shot("04a-budget-card");
    const r0 = results(sidB).length;
    await click("budget allow", ".spend-budget-card button.allow");
    // permission:respond is an ipcRenderer.send (not logged as an invoke): the approval lands as the budget's ceilingApprovalId
    const resp = await waitFor("budget applied", async () => { const r = spendRow(sidB); return r?.policy === "capped" && r.ceilingApprovalId ? r : null; }, { timeoutMs: 20_000 }).catch(() => null);
    await waitFor("budget turn result", async () => results(sidB).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sidB, 60_000).catch(() => null); await sleep(1500); await shot("04b-budget-set");
    const chip = await cdp.eval(`(() => { const b = document.querySelector("button.vs-spend"); return b ? b.innerText : null; })()`);
    const reply = sessEvents(sidB).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.budget = { cardText, spend: spendRow(sidB), settled: sessEvents(sidB).filter((e) => e.kind === "ask_settled").map((e) => e.record).slice(-1)[0], chip, reply: String(reply ?? "").slice(0, 200), jobId: sessRow(sidB)?.jobId };
    verdict("budget_card", !!card && !!resp && resp.ceilingCents === 5 && /true/i.test(String(reply)), summary.budget);
  });
  // ---- B2: search_models + call_model (MiniMax TTS); meanwhile A: "Build it" fails (one turn at a time) → Retry
  await step("paid_tts", async () => {
    const r0 = results(sidB).length; const ev0 = sessEvents(sidB).length;
    const jobId = sessRow(sidB)?.jobId;
    await sendTurn(`现在只做配音测试：先调用 search_models（query 为 "speech"，kind 为 "audio"）找到 MiniMax 语音模型，然后用返回的 model_id 调用 call_model 一次，job_id 为 "${jobId}"，input 为 {"text":"你好，欢迎来到 Videoclaw。","voice_id":"female-shaonv"}。不要运行其他工具、不要读写文件。完成后只回复保存的文件路径和 ${CODE}`);
    // running = the turn's own status event (sessions.json is not flushed on every status change)
    await waitFor("B running", async () => sessEvents(sidB).slice(ev0).some((e) => e.kind === "status" && (e.status === "running" || e.state === "running")) || sessEvents(sidB).slice(ev0).some((e) => e.kind === "port_runtime" || e.kind === "thinking" || e.kind === "tool_start") || null, { timeoutMs: 30_000, every: 200 });
    // A while B's turn holds the only turn slot
    await step("plan_build_fails_while_busy", async () => {
      await openById(sidA);
      const n0 = choices().length;
      await click("Build it", "button.session-plan-primary", { text: "^Build it$" });
      const chose = await waitFor("sessionPlan:choose(build)", async () => choices()[n0] ?? null, { timeoutMs: 60_000 });
      const retry = await waitFor("Retry button", () => find(".session-plan-card button.session-plan-primary", { text: "^Retry$" }), { timeoutMs: 30_000 }).catch(() => null);
      await sleep(600); await shot("05a-plan-failed-retry");
      const plan = sessRow(sidA)?.sessionPlan;
      summary.buildFailed = { bTurnEnded: results(sidB).length > r0, choose: { ok: chose.ok, real: chose.real, result: String(chose.result ?? chose.error).slice(0, 300) }, retryButton: !!retry, plan: plan && { phase: plan.phase, decision: plan.decision?.action, message: plan.message }, card: await planText() };
      verdict("plan_build_fails_while_busy", results(sidB).length === r0 && plan?.phase === "failed" && plan?.decision?.action === "build" && !!retry, summary.buildFailed);
    });
    await waitFor("paid turn result", async () => results(sidB).length > r0 || null, { timeoutMs: 8 * 60_000, every: 1000 });
    await openById(sidB); await waitIdle(sidB, 60_000).catch(() => null); await sleep(2000); await shot("06-paid-done");
    const ev = sessEvents(sidB).slice(ev0);
    const tools = ev.filter((e) => e.kind === "tool_start").map((e) => e.toolName ?? e.name);
    const cwd = sessRow(sidB)?.cwd; const inc = cwd && jobId ? join(cwd, "jobs", jobId, "incoming") : null;
    const files = inc && existsSync(inc) ? readdirSync(inc).filter((f) => /^model-[0-9a-f]{32}\./.test(f)).map((f) => ({ f, bytes: readFileSync(join(inc, f)).length })) : [];
    const paid = (ledger()?.entries ?? []).filter((e) => e.kind === "paid_tool" && e.clientJob === jobId);
    const all = (ledger()?.entries ?? []).filter((e) => e.clientJob === jobId);
    const ledgerUsd = all.reduce((a, e) => a + e.usd, 0);
    const cents = (usd) => { const raw = usd * 100, n = Math.round(raw); return Math.abs(raw - n) < 1e-9 ? n : Math.ceil(raw); };
    const chip = await cdp.eval(`(() => { const b = document.querySelector("button.vs-spend"); return b ? b.innerText : null; })()`);
    const reply = ev.filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    const paidLog = mainLogRows(/agent\.paid\.model_call|\[local-gateway\] model_call/).map((l) => l.slice(0, 300)).slice(-4);
    summary.paid = { jobId, tools, files, paidEntries: paid.map((e) => ({ model: e.model, usd: e.usd, units: e.units, maximumUsd: e.pricing?.maximumUsd, pricing: e.pricing?.source })), jobLedgerUsd: ledgerUsd, expectedChipPrefix: `$${(cents(ledgerUsd) / 100).toFixed(2)}`, chip, spend: spendRow(sidB), reply: String(reply ?? "").slice(0, 300), paidLog };
    verdict("paid_tts", tools.some((t) => /search_models$/.test(t)) && tools.some((t) => /call_model$/.test(t)) && files.some((x) => /\.mp3$/.test(x.f) && x.bytes > 1000) && paid.length >= 1 && paid.every((e) => e.usd > 0 && e.usd <= e.pricing?.maximumUsd), summary.paid);
  });
  // ---- A4: Retry → the saved build choice dispatches → stop right away (no production)
  await step("plan_retry", async () => {
    await openById(sidA); await waitIdle(sidB, 60_000).catch(() => null);
    const r0 = results(sidA).length; const ev0 = sessEvents(sidA).length;
    await click("Retry", ".session-plan-card button.session-plan-primary", { text: "^Retry$" });
    const retry = await waitFor("sessionPlan:retry", async () => ipcCalls("sessionPlan:retry").find((x) => x.ok) ?? null, { timeoutMs: 60_000 });
    const acted = await waitFor("agent acts on the build turn", async () => sessEvents(sidA).slice(ev0).find((e) => e.kind === "tool_start" || e.kind === "assistant_text") ?? null, { timeoutMs: 3 * 60_000, every: 1000 }).catch(() => null);
    await shot("07a-retried");
    // docs/31 §5 reproduction: let the build turn run (several tool calls, ≤ 100 s), then Stop while the model is
    // generating (the last event is a tool_end → the next upstream call is streaming)
    const ran = await waitFor("a long build turn", async () => { const e = sessEvents(sidA).slice(ev0); const ends = e.filter((x) => x.kind === "tool_end").length; return ends >= 4 && e.at(-1)?.kind === "tool_end" ? { toolEnds: ends } : null; }, { timeoutMs: 100_000, every: 500 }).catch(() => null);
    await sleep(1500);
    const turnMs = Date.now(); const stopped = await stopIfRunning();
    await waitFor("build turn ended", async () => results(sidA).length > r0 || null, { timeoutMs: 120_000, every: 1000 }).catch(() => null);
    await waitIdle(sidA, 120_000).catch(() => null);
    // the drained call (if any) lands in the ledger; the host reconciles once the shim reports no call in flight
    const settled = await waitFor("settled after stop", async () => mainLogRows(/agent\.spend\.settled_after_stop/).find((l) => l.includes(sidA) && Date.parse(/"ts":"([^"]+)"/.exec(l)?.[1] ?? "") >= turnMs - 1000) ?? null, { timeoutMs: 150_000, every: 1000 }).catch(() => null);
    await sleep(1500);
    const jobA = sessRow(sidA)?.jobId;
    const llmA = (ledger()?.entries ?? []).filter((e) => e.clientJob === jobA && e.kind !== "paid_tool").reduce((a, e) => a + e.usd, 0);
    const paidA = (ledger()?.entries ?? []).filter((e) => e.clientJob === jobA && e.kind === "paid_tool").map((e) => ({ model: e.model, usd: e.usd }));
    const meteredA = mainLogRows(/agent\.spend\.metered/).filter((l) => l.includes(sidA)).map((l) => Number(/"totalUsd":([0-9.e-]+)/.exec(l)?.[1]));
    const reconciledA = mainLogRows(/agent\.spend\.gateway_reconciled/).filter((l) => l.includes(sidA)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 320)).slice(-2);
    summary.undercount = { buildTurn: ran, stoppedAt: new Date(turnMs).toISOString(), drainedLog: mainLogRows(/drained a call whose client left|skipped a queued call/).map((l) => l.slice(0, 220)), settledLog: settled && settled.slice(settled.indexOf("{"), settled.indexOf("{") + 300), jobId: jobA, ledgerLlmUsd: Math.round(llmA * 1e9) / 1e9, ledgerPaid: paidA, lastSdkMeteredTotalUsd: meteredA.at(-1), displayedTotalCostUsd: sessRow(sidA)?.totalCostUsd, reconciled: reconciledA };
    summary.undercount.displayedEqualsLedger = Number.isFinite(sessRow(sidA)?.totalCostUsd) && Math.abs(sessRow(sidA).totalCostUsd - llmA) < 1e-6;
    verdict("stop_settles_spend", !!settled && summary.undercount.displayedEqualsLedger, summary.undercount);
    const plan = sessRow(sidA)?.sessionPlan;
    summary.retry = { retry: { real: retry.real, result: String(retry.result).slice(0, 300) }, firstAction: acted && { kind: acted.kind, tool: acted.toolName }, stopped, plan: plan && { phase: plan.phase, decision: plan.decision?.action } };
    verdict("plan_retry", retry.real && /"phase":"(accepted|dispatching)"/.test(retry.result) && plan?.decision?.action === "build", summary.retry);
  });
  // ---- A5: a fresh proposal → "Dismiss plan"
  await step("plan_dismiss", async () => {
    const r0 = results(sidA).length; const p0 = planPush(sidA).length;
    await sendTurn(PROPOSE("（这是一个新方案：改为 6 秒）"));
    await waitFor("new proposal", async () => planPush(sidA).slice(p0).find((p) => p.phase === "awaiting-decision") ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sidA).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sidA, 60_000).catch(() => null); await sleep(800); await shot("08a-new-plan");
    const n0 = choices().length;
    await click("Dismiss plan", "button.session-plan-dismiss", { aria: "Dismiss plan" });
    const chose = await waitFor("sessionPlan:choose(dismiss)", async () => choices().slice(n0).find((x) => x.ok) ?? null, { timeoutMs: 30_000 });
    await sleep(1200); await shot("08b-dismissed");
    const plan = sessRow(sidA)?.sessionPlan; const t = await bodyText();
    const marker = sessRow(sidA)?.dismissedSessionPlan; // the original persists dismissal as this marker (L36248), never on the plan
    summary.dismiss = { choose: { real: chose.real, args: String(chose.args).slice(0, 300), result: String(chose.result).slice(0, 300) }, plan: plan && { phase: plan.phase, revision: plan.revision, id: plan.id }, dismissedSessionPlan: marker, dismissedMarker: /Dismissed plan|Plan dismissed/.exec(t)?.[0] ?? null, cardDocked: !!(await find("button.session-plan-dismiss")) };
    verdict("plan_dismiss", chose.real && /"action":"dismiss"/.test(chose.args) && /"dismissed":true/.test(chose.result) && !!plan && marker === `${plan.id}:${plan.revision}`, summary.dismiss);
  });
  // ---- B3: project_memory save citing the TTS file → Edit → Save note → open the source
  await step("memory_edit_open_source", async () => {
    await openById(sidB);
    const file = summary.paid?.files?.find((x) => /\.mp3$/.test(x.f))?.f;
    if (!file) throw new Error("no TTS file from paid_tts");
    const r0 = results(sidB).length;
    await sendTurn(`现在只做一件事：调用 project_memory 工具一次，action 为 save，记住这条项目偏好："配音统一使用 female-shaonv 音色"，sources 只放一项：{"kind":"file","sessionId":"${sidB}","path":"incoming/${file}","label":"配音样例"}。不要运行任何其他工具。保存后只回复：已记住 ${CODE}`);
    const notice = await waitFor("Remembered something", () => find("div.memory-notice", { text: "Remembered something" }), { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sidB).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 }).catch(() => null);
    await waitIdle(sidB, 60_000).catch(() => null); await sleep(800); await shot("09a-memory-notice");
    await click("Edit", "div.memory-notice button", { text: "^Edit$" });
    const panel = await waitFor("memory panel", () => find("section.memory-panel textarea"), { timeoutMs: 15_000 });
    await sleep(500); await shot("09b-memory-editor");
    await click("memory text", "section.memory-panel textarea");
    await key("End", 35, 0); await typeText(cdp, "（旁白语速放慢）");
    const u0 = ipcCalls("memory:update").length;
    await click("Save note", "section.memory-panel button.primary", { text: "^Save note$" });
    const upd = await waitFor("memory:update", async () => ipcCalls("memory:update").slice(u0).find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    await sleep(1000); await shot("09c-memory-saved");
    const diskEdited = memoryOnDisk().some((f) => /MEMORY\.md$/.test(f.file) && /语速放慢/.test(f.text));
    // the source buttons live in the open editor
    if (!(await find("div.memory-sources button"))) await click("Edit again", "div.memory-notice button", { text: "^Edit$" });
    const o0 = ipcCalls("memory:openSource").length;
    await click("memory source", "div.memory-sources button");
    const opened = await waitFor("memory:openSource", async () => ipcCalls("memory:openSource").slice(o0).find((x) => x.ok) ?? null, { timeoutMs: 20_000 });
    await sleep(1200); await shot("09d-memory-source");
    const openLog = mainLogRows(/\[smoke\] openPath /).map((l) => l.slice(l.indexOf("openPath"), l.indexOf("openPath") + 200)).slice(-2);
    summary.memory = { notice: notice.label, update: { real: upd.real, result: String(upd.result).slice(0, 300) }, diskEdited, openSource: { real: opened.real, args: String(opened.args).slice(0, 300), result: String(opened.result).slice(0, 300) }, openLog, sourceButton: await cdp.eval(`(() => { const b = document.querySelector("div.memory-sources button"); return b ? b.innerText : null; })()`) };
    verdict("memory_edit_open_source", !!panel && upd.real && diskEdited && opened.real && /"available":true/.test(opened.result) && openLog.some((l) => l.includes(file)), summary.memory);
  });
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.length, usd: L.entries.reduce((a, e) => a + e.usd, 0), paidToolUsd: L.entries.filter((e) => e.kind === "paid_tool").reduce((a, e) => a + e.usd, 0), kinds: [...new Set(L.entries.map((e) => e.kind ?? "llm"))] }; })();
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.m14Channels = Object.fromEntries(["sessionPlan:choose", "sessionPlan:retry", "memory:update", "memory:openSource"].map((c) => [c, ipcCalls(c).map((r) => ({ ok: r.ok, real: r.real }))]));
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m14-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
