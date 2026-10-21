#!/usr/bin/env node
// PORT-NEW docs/31 M14 — studio tools + the displayed spend on the NON-gateway routes, through the ORIGINAL renderer
// (real CDP input; page evaluation is read-only). --phase codex: the Codex harness (codex app-server → gate proxy,
// OpenAI surface → MiniMax), studio tools as Codex dynamicTools. --phase provider: the MiniMax provider route
// (Claude Agent SDK → gate proxy → MiniMax). One project_memory turn each; the spend chip / breakdown must show the
// gate proxy's metered usage (models.dev price), never the SDK estimate.
//   node tools/ui-e2e-m14-routes.mjs --phase codex|provider --run RUN --engine ENGINE_DIR
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "provider");
const RUN = resolve(opt("--run") ?? "");
const CDP_PORT = Number(opt("--port", "9388"));
const EXPECT_SPEND = argv.includes("--expect-spend");
if (!opt("--run")) { console.error("usage: ui-e2e-m14.mjs --run RUN --engine ENGINE_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); // the installer's record next to the read-only engine (its verified build digest)
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version, ...(src0?.path === ENGINE && src0.buildSha256 ? { buildSha256: src0.buildSha256 } : (() => { try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; return /^[0-9a-f]{64}$/.test(d) ? { buildSha256: d } : {}; } catch { return {}; } })()) })); } // the engine's own build digest file (bootstrap.ts L389)
const RUNIDX = argv.includes("--tag") ? opt("--tag") : String(Date.now());
const OUT = join(RUN, `out-m14r-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
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
const env = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47741"), VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000" };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
for (const k of Object.keys(env)) if (k.startsWith("__CURSOR_SANDBOX")) delete env[k]; // box sandbox env-restore blobs embed provider keys under innocuous names
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete env[k];
if (!env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY is required for the credits-route turn"); process.exit(2); }
env.VIDEOCLAW_PORT_SMOKE_LLM_ROUTE = "minimax"; // provider phase: the PORT-NEW MiniMax provider route (Claude Agent SDK → gate proxy → MiniMax)
// codex phase: the harness selection M10 proved through Settings is preseeded (agentHarness codex-app-server, ChatGPT
// slot = the MiniMax backend behind the gate proxy, OpenAI Responses surface)
if (PHASE === "codex") { const f = join(UD, "settings.json"); const cur = readJson(f) ?? {}; writeFileSync(f, JSON.stringify({ ...cur, agentHarness: "codex-app-server", codexProvider: "chatgpt" }, null, 2)); }
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

const TOOLTEXT = `现在只做一件事：调用 project_memory 工具一次，action 为 save，记住这条项目偏好："片尾统一使用白色字幕"。不要运行任何其他工具。保存后只回复：已记住 ${CODE}`;
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await step("studio_tool_on_route", async () => {
    const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
    await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
    const created = await waitFor("session:create", async () => ipcCalls("session:create").find((r) => r.ok) ?? null, { timeoutMs: 15_000 });
    const meta = JSON.parse(created.result); sid = meta.sessionId; summary.session = { sessionId: sid, llmRoute: meta.llmRoute ?? null, agentHarness: meta.agentHarness, codexProvider: meta.codexProvider ?? null };
    await sleep(1200);
    await sendTurn(TOOLTEXT);
    const notice = await waitFor("Remembered something", () => find("div.memory-notice", { text: "Remembered something" }), { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("turn result", async () => results(sid)[0] ?? null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sid, 60_000).catch(() => null); await sleep(1500); await shot("01-memory-notice");
    // the Codex harness surfaces studio dynamicTools as provider_dynamic with the tool's summary (codexEventToSdkMessages)
    const tools = sessEvents(sid).filter((e) => e.kind === "tool_start").map((e) => `${e.toolName ?? e.name}${e.detail ? " " + e.detail : ""}`);
    const disk = memoryOnDisk().filter((f) => /MEMORY\.md$/.test(f.file)).map((f) => f.text).join("\n");
    summary.tool = { tools, notice: notice.label, onDisk: /白色字幕/.test(disk), result: results(sid)[0] };
    verdict("studio_tool_on_route", (PHASE === "codex" ? meta.agentHarness === "codex-app-server" : meta.llmRoute === "minimax") && tools.some((t) => /project_memory|Use project memory/.test(String(t))) && /白色字幕/.test(disk), { ...summary.session, ...summary.tool });
  });
  await step("usage_display", async () => {
    await sleep(2000);
    const metered = mainLogRows(/agent\.spend\.metered/).filter((l) => l.includes(sid)).map((l) => ({ meter: /"meter":"([^"]+)"/.exec(l)?.[1], totalUsd: Number(/"totalUsd":([0-9.e-]+)/.exec(l)?.[1]), runtimeUsd: Number(/"runtimeUsd":([0-9.e-]+)/.exec(l)?.[1]), sdkEstimateUsd: Number(/"sdkEstimateUsd":([0-9.e-]+)/.exec(l)?.[1]), sources: /"priceSources":\[([^\]]*)\]/.exec(l)?.[1] }));
    const proxyUsage = mainLogRows(/agent_proxy\.(request|drained)/).length;
    const chip = await bodyText().then((t) => /\$([0-9]+\.[0-9]{2}) spent/.exec(t)?.[0] ?? null);
    let breakdown = null;
    try { await click("spend chip", "button.vs-spend"); breakdown = await waitFor("spend breakdown", async () => cdp.eval(`(() => { const b = document.querySelector(".vs-breakdown"); return b ? b.innerText : null; })()`), { timeoutMs: 10_000 }); await sleep(500); await shot("02-spend-breakdown"); await key("Escape", 27); } catch (e) { breakdown = `error: ${String(e?.message ?? e).slice(0, 200)}`; }
    const lastM = metered.at(-1);
    // the meta is persisted lazily (as in the original, L50739-50777 does not save): read what the renderer was
    // pushed (session:changed) — the value behind the breakdown's reasoning row
    const pushed = () => evRows().filter((r) => r.ch === "session:changed").flatMap((r) => (Array.isArray(r.payload) ? r.payload : [])).filter((x) => x?.sessionId === sid).map((x) => x.totalCostUsd).at(-1);
    const total = await waitFor("pushed totalCostUsd", async () => { const t = pushed(); return lastM && Number.isFinite(t) && Math.abs(t - lastM.totalUsd) < 1e-9 ? { t } : null; }, { timeoutMs: 20_000, every: 500 }).then((x) => x.t, () => pushed());
    const resultCost = results(sid).at(-1)?.totalCostUsd;
    const reasoningRow = /Videoclaw gateway reasoning\s*\$([0-9]+\.[0-9]{2})/.exec(breakdown ?? "")?.[1];
    const spend = (readJson(join(UD, "spend-budgets.json"))?.entries ?? []).find((x) => x.sessionId === sid) ?? null;
    summary.usage = { metered, proxyRequestLogs: proxyUsage, chip, breakdown, displayedTotalCostUsd: total, resultEventTotalCostUsd: resultCost, reasoningRow, expectedReasoningRow: Number.isFinite(total) ? total.toFixed(2) : null, spend };
    const last = metered.at(-1);
    verdict("usage_display", !!last && last.meter === "proxy" && /models\.dev/.test(String(last.sources)) && Number.isFinite(total) && Math.abs(total - last.totalUsd) < 1e-9 && (!Number.isFinite(last.sdkEstimateUsd) || last.sdkEstimateUsd !== total) && reasoningRow === total.toFixed(2) && Math.abs(resultCost - total) < 1e-9, summary.usage);
  });
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m14r-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
