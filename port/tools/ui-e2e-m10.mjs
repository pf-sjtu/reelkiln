#!/usr/bin/env node
// PORT-NEW docs/27 M10 — the Codex route (MiniMax-backed) through the ORIGINAL renderer: Settings → Agent & models →
// Codex → model provider/model → a new video → composer model + reasoning-effort pickers → a real agent turn.
// Infrastructure copied from ui-e2e-m9.mjs (docs/26 M9), which drives channels through the ORIGINAL renderer with
// REAL CDP input (mouse / keyboard / intercepted drag / OS file drop). Page evaluation is read-only (element
// geometry, DOM text); window.videoclaw is never called. Main-process truth is read from disk (sessions.json,
// spend-budgets.json, taste files, job dirs, trash) and from VIDEOCLAW_PORT_IPC_LOG (one redacted row per
// invoke the renderer made — proves the click reached the real handler).
//
//   node tools/ui-e2e-m9.mjs --phase local   --run RUN [--prepare-from FINISHED_S1_RUN] [--port 9371]
//   node tools/ui-e2e-m9.mjs --phase retry   --run RUN            (MiniMax: Quickstart start + timed-out turn + Retry)
//   node tools/ui-e2e-m9.mjs --phase resume1 --run RUN            (MiniMax: turn 1 states a code word)
//   node tools/ui-e2e-m9.mjs --phase resume2 --run RUN            (MiniMax: after restart, turn 2 asks for it)
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, dropFiles, dragElement, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "codex");
const RUN = resolve(opt("--run") ?? "");
const FROM = opt("--prepare-from");
const CDP_PORT = Number(opt("--port", "9371"));
const CODE = opt("--code", "青柠檬-6153");
if (!opt("--run")) { console.error("usage: ui-e2e-m10.mjs --phase codex|codex-resume --run RUN [--prepare-from S1_RUN]"); process.exit(2); }
if (PHASE !== "local" && !process.env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY not set"); process.exit(2); }

// ---- fixture preparation (copy of a finished S1 run; nothing in the source run is modified) -------------
const UD = join(RUN, ".config", "videoclaw-port");
if (FROM && !existsSync(RUN)) {
  mkdirSync(RUN, { recursive: true });
  for (const e of readdirSync(FROM)) if (!/^out/.test(e)) cpSync(join(FROM, e), join(RUN, e), { recursive: true, verbatimSymlinks: true });
  // the registry / version / attachment stores carry absolute paths of the source run
  for (const f of readdirSync(UD).filter((n) => n.endsWith(".json"))) writeFileSync(join(UD, f), readFileSync(join(UD, f), "utf8").split(resolve(FROM)).join(RUN));
}
// docs/27: --engine re-points the copied run at an installed engine that exists on this box (the source run's
// engine directory may have been removed); the engine is only read
const ENGINE = opt("--engine");
if (ENGINE) { const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } }; const cur = rj(join(UD, "engine-current.json")) ?? {}; writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ ...cur, path: ENGINE, version: rj(join(ENGINE, "ENGINE_VERSION.json"))?.version ?? cur.version })); }
if (!existsSync(join(UD, "sessions.json"))) { console.error(`${RUN} has no sessions.json (use --prepare-from)`); process.exit(2); }
const OUT = join(RUN, `out-m10-${PHASE}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m10 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const sessions = () => readJson(join(UD, "sessions.json")) ?? { sessions: [], clients: [] };
const ipcRows = () => { try { return readFileSync(IPC, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ipcCalls = (ch) => ipcRows().filter((r) => r.ch === ch);
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 600)}`); };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const S0 = sessions();
const src = S0.sessions.find((s) => s.jobId && s.finalizedAtMs) ?? S0.sessions.find((s) => s.jobId);
function prepareHyperframes(s) { // a minimal job-owned HyperFrames composition (index.html + pinned runtime copy)
  const engine = readJson(join(UD, "engine-current.json"));
  const runtime = engine && join(engine.path, "hyperframes", "runtime");
  const comp = join(s.cwd, "jobs", s.jobId, "hyperframes");
  if (!runtime || !existsSync(runtime) || existsSync(join(comp, "index.html"))) return existsSync(join(comp, "index.html"));
  mkdirSync(comp, { recursive: true }); cpSync(runtime, join(comp, "runtime"), { recursive: true });
  writeFileSync(join(comp, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="runtime/fonts/fonts.css"></head><body style="margin:0;background:#123">
<div id="root" data-composition-id="m9-demo" data-width="1080" data-height="1920" data-duration="4" data-fps="30" style="width:1080px;height:1920px;position:relative">
<h1 id="headline" class="ov-title" style="color:#fff;font-size:120px;position:absolute;top:700px;width:100%;text-align:center">原始标题</h1>
</div><script src="runtime/gsap.min.js"></script></body></html>\n`);
  return true;
}
function pngFile(path, rgb) { // a small valid RGB PNG (no image libraries on the box)
  const w = 64, h = 64; const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3); }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return path;
}

// ---- launch ------------------------------------------------------------------------------------------
const env = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "minimax", VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC };
if (PHASE === "retry") env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS = opt("--turn-timeout-ms", "6000");
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
if (PHASE === "local") delete env.MINIMAX_API_KEY; // the local phase must not be able to reach MiniMax
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
const evRows = () => { try { return readFileSync(join(OUT, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const liveMeta = (sid) => { const ch = evRows().filter((r) => r.ch === "session:changed").slice(-1)[0]; return ch?.payload?.find?.((x) => x.sessionId === sid) ?? null; };
const settingsJson = () => readJson(join(UD, "settings.json")) ?? {};
const sessEvents = (sid) => evRows().filter((r) => r.ch === "session:event" && r.payload?.sessionId === sid).map((r) => r.payload.event);
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  if (PHASE === "codex") {
    // ---- Settings → Agent & models → Codex (AgentHarnessChoice L33650; selectAgentHarness → codexStatus → setSettings)
    await step("select_codex_harness", async () => {
      await click("profile button", "button.profile-button"); await sleep(400);
      await click("Settings", "button[role='menuitem']", { text: "Settings" });
      await waitFor("Agent & models", () => find("h2", { text: "^Agent & models$" }), { timeoutMs: 15_000 });
      await click("Agent & models nav", "button", { text: "Agent & models" }); await sleep(600);
      await waitFor("codex status known", async () => { const t = await bodyText(); return /ChatGPT connected|Click to connect ChatGPT|Codex runtime unavailable/.test(t) ? t : null; }, { timeoutMs: 30_000 });
      await shot("01a-agent-section");
      await click("Codex radio", "button.llm-route-option", { text: "^Codex" });
      const s = await waitFor("settings.json agentHarness", async () => (settingsJson().agentHarness === "codex-app-server" ? settingsJson() : null), { timeoutMs: 20_000 });
      await sleep(800); await shot("01b-codex-selected");
      // onAccountSettingsChange (renderer L39097): the open (Claude) video keeps its agent → the original closes Settings
      // and offers "New video on …?" — decline, then reopen Settings for the provider/model step
      summary.mismatchPrompt = !!(await find("button", { text: "^New video$" }));
      if (summary.mismatchPrompt) { await click("Cancel (keep this video)", "button", { text: "^Cancel$" }); await sleep(600); }
      verdict("select_codex_harness", s.agentHarness === "codex-app-server" && ipcCalls("engine:codexStatus").some((r) => r.ok && r.real && /"authenticated":true/.test(r.result)), { codexStatus: ipcCalls("engine:codexStatus").map((r) => r.result.slice(0, 200)).slice(-2), setSettings: ipcCalls("settings:set").map((r) => r.args.slice(0, 160)).slice(-2) });
    });
    // ---- CodexProviderChoice: ChatGPT-slot (MiniMax backend) → model list (engine:codexModels) → "Use for new videos"
    await step("codex_provider_model", async () => {
      if (!(await find("h2", { text: "^Agent & models$" }))) {
        await click("profile button", "button.profile-button"); await sleep(400);
        await click("Settings", "button[role='menuitem']", { text: "Settings" });
        await waitFor("Agent & models", () => find("h2", { text: "^Agent & models$" }), { timeoutMs: 15_000 });
        await click("Agent & models nav", "button", { text: "Agent & models" }); await sleep(600);
      }
      const opt0 = await waitFor("model select", () => find("label.am-field select.am-input"), { timeoutMs: 30_000 });
      await sleep(500); await shot("02a-codex-models");
      const options = await cdp.eval(`[...document.querySelectorAll("label.am-field select.am-input option")].map((o) => ({ v: o.value, t: o.textContent, d: o.disabled }))`);
      // pick the exact model with the keyboard (focus the <select>, ArrowDown to the first listed model)
      const btnState = await cdp.eval(`(() => { const b = [...document.querySelectorAll("button.am-save")].find((x) => /Use for new videos/.test(x.innerText)); return b ? { disabled: b.disabled, text: b.innerText } : null; })()`);
      log({ saveButton: btnState });
      const before = ipcCalls("settings:set").length;
      // the Settings body is a smooth-scrolling pane taller than the 650px window: bring the save button on screen first
      await find("button.am-save", { text: "Use for new videos", center: true }); await sleep(900); await shot("02b-save-visible");
      await click("Use for new videos", "button.am-save", { text: "Use for new videos" }); await sleep(300);
      await waitFor("settings:set from Use for new videos", async () => (ipcCalls("settings:set").length > before ? true : null), { timeoutMs: 15_000 });
      const s = settingsJson();
      await sleep(600); await shot("02b-codex-saved");
      verdict("codex_provider_model", !!opt0 && options.length > 1 && ipcCalls("engine:codexModels").some((r) => r.ok && r.real && /"ok":true/.test(r.result)), { options, models: ipcCalls("engine:codexModels").map((r) => r.result.slice(0, 300)).slice(-1), keyStatus: ipcCalls("engine:agentProviderKeyStatus").map((r) => r.result).slice(-1), saveButton: btnState, setSettings: ipcCalls("settings:set").slice(-1).map((r) => r.args), settings: { agentHarness: s.agentHarness, codexProvider: s.codexProvider ?? "(default chatgpt)", codexModel: s.codexModel ?? null } });
      await key("Escape", 27); await sleep(800);
    });
    // ---- a new video on the Codex harness
    let sid;
    await step("codex_new_video", async () => {
      const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
      await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
      const created = await waitFor("session:create", async () => ipcCalls("session:create").find((r) => r.ok) ?? null, { timeoutMs: 15_000 });
      const meta = JSON.parse(created.result); sid = meta.sessionId; writeFileSync(join(RUN, "m10-codex-session.txt"), sid);
      await sleep(1000); await shot("03-new-codex-video");
      verdict("codex_new_video", meta.agentHarness === "codex-app-server" && meta.codexProvider === "chatgpt" && !meta.llmRoute, { sessionId: sid, agentHarness: meta.agentHarness, codexProvider: meta.codexProvider, modelOverride: meta.modelOverride ?? null, llmRoute: meta.llmRoute ?? null });
    });
    // ---- composer model picker (openCodexModelMenu → codexModels; chooseModel → session:setModel)
    await step("composer_model_pick", async () => {
      await click("model button", "button.model-btn", { aria: "Model for this video" }).catch(() => click("model button", "div.model-picker button.model-btn"));
      await waitFor("model menu with discovered models", () => find("div.model-menu button.model-menu-item", { text: "MiniMax-M3\\.1-Flash" }), { timeoutMs: 30_000 }); await sleep(600); await shot("04a-model-menu");
      const items = await cdp.eval(`[...document.querySelectorAll("div.model-menu button.model-menu-item")].map((b) => b.innerText.replace(/\\n/g, " | "))`);
      await click("MiniMax-M3.1-Flash", "div.model-menu button.model-menu-item", { text: "MiniMax-M3\\.1-Flash" , last: true });
      const r = await waitFor("session:setModel", async () => ipcCalls("session:setModel").find((x) => x.ok) ?? null, { timeoutMs: 15_000 });
      await sleep(800); await shot("04b-model-picked");
      const m = await waitFor("liveMeta modelOverride", async () => { const x = liveMeta(sid); return x?.modelOverride ? x : null; }, { timeoutMs: 10_000 }).catch(() => liveMeta(sid) ?? {});
      verdict("composer_model_pick", r.real && m.modelOverride === "MiniMax-M3.1-Flash", { items, setModel: { args: r.args, modelOverride: m.modelOverride, agentHarness: m.agentHarness } });
    });
    // ---- composer effort picker (openCodexEffortMenu; chooseEffort → session:setReasoningEffort)
    await step("composer_effort_pick", async () => {
      await click("effort button", "div.model-picker button.model-btn", { aria: "Reasoning effort" });
      await waitFor("effort menu", () => find("div.model-menu button.model-menu-item", { text: "high" }), { timeoutMs: 20_000 }); await sleep(500); await shot("05a-effort-menu");
      const items = await cdp.eval(`[...document.querySelectorAll("div.model-menu button.model-menu-item")].map((b) => b.innerText.replace(/\\n/g, " | "))`);
      await click("high", "div.model-menu button.model-menu-item", { text: "^high" });
      const r = await waitFor("session:setReasoningEffort", async () => ipcCalls("session:setReasoningEffort").find((x) => x.ok) ?? null, { timeoutMs: 15_000 });
      await sleep(800); await shot("05b-effort-picked");
      const m = await waitFor("liveMeta effort", async () => { const x = liveMeta(sid); return x?.codexReasoningEffort ? x : null; }, { timeoutMs: 10_000 }).catch(() => liveMeta(sid) ?? {});
      verdict("composer_effort_pick", r.real && m.codexReasoningEffort === "high", { items, setEffort: { args: r.args, codexReasoningEffort: m.codexReasoningEffort, modelOverride: m.modelOverride } });
    });
    // ---- a REAL Codex turn: text + one provider command round-trip, through the gate proxy to MiniMax
    await step("codex_turn", async () => {
      const ask = `请用一个只读的 shell 命令（例如 pwd）看一下当前目录，然后只回复：完成 ${CODE}。不要写任何文件。`;
      await click("composer", "textarea"); await typeText(cdp, ask); await shot("06a-typed"); await key("Enter", 13);
      await waitFor("session:send accepted", async () => ipcCalls("session:send").find((r) => r.ok && String(r.args).includes(sid)) ?? null, { timeoutMs: 15_000 });
      const res = await waitFor("result event", async () => sessEvents(sid).find((e) => e.kind === "result" || e.kind === "error") ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
      await sleep(2500); await shot("06b-answered");
      const ev = sessEvents(sid);
      const tools = ev.filter((e) => e.kind === "tool_start").map((e) => ({ toolName: e.toolName, summary: e.summary }));
      const text = ev.filter((e) => e.kind === "assistant_text").map((e) => e.text).join(" ");
      const meta = liveMeta(sid) ?? {};
      const dom = await bodyText();
      const proxyStarted = mainLogRows(/agent_proxy\.started/).filter((l) => /"surface":"openai"/.test(l)).length;
      const rtStarted = mainLogRows(/agent\.runtime\.started/).filter((l) => l.includes(sid)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 400));
      summary.turn = { result: res, tools, text: text.slice(0, 400), meta: { status: meta.status, agentHarness: meta.agentHarness, modelOverride: meta.modelOverride, codexReasoningEffort: meta.codexReasoningEffort, sdkSessionId: meta.sdkSessionId }, proxyStarted, rtStarted, errors: ev.filter((e) => e.kind === "error").map((e) => e.message) };
      verdict("codex_turn", res.kind === "result" && !res.isError && tools.length > 0 && text.includes(CODE) && dom.includes(CODE) && proxyStarted > 0 && meta.codexReasoningEffort === "high" && !!meta.sdkSessionId, summary.turn);
    });
  }
  if (PHASE === "codex-resume") {
    // after an app restart: the Codex video's history (getHistory → thread/read) and a second turn on the same thread
    const sid = readFileSync(join(RUN, "m10-codex-session.txt"), "utf8").trim();
    const pre = sessions().sessions.find((x) => x.sessionId === sid);
    await step("codex_history_and_resume", async () => {
      await openSession(pre); await sleep(2500); await shot("10a-reopened");
      const domBefore = await bodyText();
      const ask = "我上一条消息里让你回复的暗号是什么？只回复暗号本身，不要调用任何工具。";
      await click("composer", "textarea"); await typeText(cdp, ask); await key("Enter", 13);
      const res = await waitFor("result event", async () => sessEvents(sid).find((e) => e.kind === "result" || e.kind === "error") ?? null, { timeoutMs: 6 * 60_000, every: 1000 });
      await sleep(2500); await shot("10b-answered");
      const text = sessEvents(sid).filter((e) => e.kind === "assistant_text").map((e) => e.text).join(" ");
      const meta = liveMeta(sid) ?? {};
      const rtStarted = mainLogRows(/agent\.runtime\.started/).filter((l) => l.includes(sid)).map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 400));
      summary.resume = { before: { sdkSessionId: pre?.sdkSessionId, historyShowsCode: domBefore.includes(CODE) }, result: res, text: text.slice(0, 300), after: { sdkSessionId: meta.sdkSessionId, status: meta.status }, rtStarted, history: ipcCalls("session:history").map((r) => r.result.slice(0, 200)).slice(-1) };
      verdict("codex_history_and_resume", res.kind === "result" && !res.isError && text.includes(CODE) && meta.sdkSessionId === pre?.sdkSessionId && rtStarted.some((l) => /"resumed":true/.test(l)), summary.resume);
    });
  }
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m10-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
