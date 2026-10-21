#!/usr/bin/env node
// PORT-NEW docs/26 M9 — drive the channels made real in docs/25 + docs/26 through the ORIGINAL renderer with
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
const PHASE = opt("--phase", "local");
const RUN = resolve(opt("--run") ?? "");
const FROM = opt("--prepare-from");
const CDP_PORT = Number(opt("--port", "9371"));
const CODE = opt("--code", "蓝色松鼠-4729");
if (!opt("--run")) { console.error("usage: ui-e2e-m9.mjs --phase local|retry|resume1|resume2 --run RUN [--prepare-from S1_RUN]"); process.exit(2); }
if (PHASE !== "local" && !process.env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY not set"); process.exit(2); }

// ---- fixture preparation (copy of a finished S1 run; nothing in the source run is modified) -------------
const UD = join(RUN, ".config", "videoclaw-port");
if (FROM && !existsSync(RUN)) {
  mkdirSync(RUN, { recursive: true });
  for (const e of readdirSync(FROM)) if (!/^out/.test(e)) cpSync(join(FROM, e), join(RUN, e), { recursive: true, verbatimSymlinks: true });
  // the registry / version / attachment stores carry absolute paths of the source run
  for (const f of readdirSync(UD).filter((n) => n.endsWith(".json"))) writeFileSync(join(UD, f), readFileSync(join(UD, f), "utf8").split(resolve(FROM)).join(RUN));
}
if (!existsSync(join(UD, "sessions.json"))) { console.error(`${RUN} has no sessions.json (use --prepare-from)`); process.exit(2); }
const OUT = join(RUN, `out-m9-${PHASE}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m9 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
const env = { ...process.env, HOME: RUN, VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "minimax", VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl"), VIDEOCLAW_PORT_IPC_LOG: IPC };
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
async function find(selector, { text, aria, last = false } = {}) {
  return cdp.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    ${text ? `if (!new RegExp(${JSON.stringify(text)}).test((e.innerText || e.value || "").trim())) return false;` : ""}
    ${aria ? `if (!new RegExp(${JSON.stringify(aria)}).test((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || ""))) return false;` : ""}
    return true; }); const e = els[${last ? "els.length - 1" : "0"}]; if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, label: (e.innerText || e.getAttribute("aria-label") || e.value || "").trim().slice(0, 80) }; })()`);
}
async function click(desc, selector, o = {}) { const el = await waitFor(desc, () => find(selector, o), { timeoutMs: o.timeoutMs ?? 20_000 }); const p = center(el); log({ action: "click", desc, selector, at: p, element: el }); if (o.hover) { await mouseMove(cdp, o.hover.x, o.hover.y); await sleep(300); } await mouseClick(cdp, p.x, p.y); if (o.double) await mouseClick(cdp, p.x, p.y, { clickCount: 2 }); return el; }
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
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");

  if (PHASE === "local") {
    const hf = prepareHyperframes(src); say(`hyperframes fixture ${hf}`);
    await openSession(src); await shot("01-source-video");

    // ---- materials:preview — the replayed material rows load their previews on their own (MaterialArrival L27143)
    await step("materials_preview", async () => {
      const rows = await waitFor("materialPreview calls", async () => (ipcCalls("materials:preview").length ? ipcCalls("materials:preview") : null), { timeoutMs: 15_000 });
      const okRows = rows.filter((r) => r.ok && r.real && r.result !== "null");
      verdict("materials_preview", okRows.length > 0, { calls: rows.length, okCalls: okRows.length, sample: okRows[0]?.result?.slice(0, 160) });
    });

    // ---- spend:get / spend:setCeiling — VideoStrip "Set production budget" (L31005) → $ input → Enter
    await step("spend_set_ceiling", async () => {
      const opened = (await find("button.vs-budget-set")) ? await click("Set production budget", "button.vs-budget-set") : await click("Change video budget", "button.vs-budget-edit");
      await click("budget input", "input[aria-label='Total video budget in dollars']"); await selectAll(); await typeText(cdp, "4.5"); await shot("02a-budget-form"); await key("Enter", 13);
      const disk = await waitFor("spend-budgets.json ceiling", async () => (readJson(join(UD, "spend-budgets.json"))?.entries ?? []).find((e) => e.sessionId === src.sessionId && e.policy === "capped") ?? null, { timeoutMs: 10_000 });
      await sleep(800); await shot("02b-budget-set");
      const strip = await bodyText();
      verdict("spend_set_ceiling", !!disk && ipcCalls("spend:setCeiling").some((r) => r.ok && r.real), { opened: opened.label, get: ipcCalls("spend:get").length, set: ipcCalls("spend:setCeiling").map((r) => r.result.slice(0, 200)), stripShows45: /\$4\.50/.test(strip), diskEntry: { policy: disk.policy, ceilingCents: disk.ceilingCents ?? disk.ceilingUsdCents ?? null } });
    });

    // ---- hfPreview:available → Fine-tune → hfPreview:start → edit text → hfPreview:editApply → close (stop)
    await step("hf_preview_edit", async () => {
      const avail = ipcCalls("hfPreview:available");
      let btn = await find("button", { text: "Fine-tune \\(HyperFrames\\)" });
      if (!btn) { // the output panel lives behind the current version; open it the way a user would
        const pill = await find("button.v-pill", { last: true }); if (pill) { await mouseClick(cdp, center(pill).x, center(pill).y); await sleep(1200); }
        btn = await find("button", { text: "Fine-tune \\(HyperFrames\\)" });
      }
      await shot("03a-output-panel");
      if (!btn) throw new Error(`no Fine-tune button (available calls ${JSON.stringify(avail.map((r) => r.result))})`);
      await click("Fine-tune (HyperFrames)", "button", { text: "Fine-tune \\(HyperFrames\\)" });
      const state = await waitFor("editor ready or error", async () => ((await find(".hfe-textarea")) ? "ready" : (await find(".hfe-error")) ? "error" : null), { timeoutMs: 45_000 });
      await sleep(1500); await shot("03b-hf-editor");
      if (state !== "ready") throw new Error(`editor ${state}: ${(await find(".hfe-error"))?.label}`);
      await click("edit textarea", ".hfe-textarea"); await selectAll(); await typeText(cdp, "M9 新标题");
      await click("Apply", "button.hfe-btn.primary");
      const html = await waitFor("composition rewritten", async () => { const t = readFileSync(join(src.cwd, "jobs", src.jobId, "hyperframes", "index.html"), "utf8"); return t.includes("M9 新标题") ? t : null; }, { timeoutMs: 10_000 });
      await sleep(1200); await shot("03c-hf-applied");
      await click("Close editor", "button.hfe-close"); await sleep(800);
      verdict("hf_preview_edit", !!html && ipcCalls("hfPreview:start").some((r) => r.ok && /"accepted":true/.test(r.result)) && ipcCalls("hfPreview:editApply").some((r) => /"ok":true/.test(r.result)), { available: avail.map((r) => r.result).slice(-2), start: ipcCalls("hfPreview:start").map((r) => r.result.slice(0, 160)), edit: ipcCalls("hfPreview:editApply").map((r) => r.result.slice(0, 160)), stopSent: mainLogRows(/hfPreview:stop|hf-preview.*stop/).length });
    });

    // ---- feedback:capture / feedback:discard — "Report a problem" → dialog → close
    await step("feedback_capture", async () => {
      await click("Report a problem", "button[aria-label='Report a problem']");
      await waitFor("feedback dialog", () => find("[aria-label='Report a problem'] .t-title, .t-title", { text: "^Report a problem$" }), { timeoutMs: 10_000 });
      await sleep(600); await shot("04a-feedback-dialog");
      await key("Escape", 27); await sleep(800);
      const closeBtn = await find("button", { text: "^(Cancel|Close)$" }); if (closeBtn && ipcCalls("feedback:discard").length === 0) { await mouseClick(cdp, center(closeBtn).x, center(closeBtn).y); await sleep(600); }
      await shot("04b-feedback-closed");
      verdict("feedback_capture", ipcCalls("feedback:capture").some((r) => r.ok && r.real), { capture: ipcCalls("feedback:capture").map((r) => r.result.slice(0, 220)), discard: ipcCalls("feedback:discard").length });
    });

    // ---- taste:list / taste:commit — project ⋯ → Edit project → add a rule → Save
    const proj = S0.clients.find((c) => c.clientId === src.clientId) ?? S0.clients[0];
    await step("taste_commit", async () => {
      const tg = await waitFor("project row", () => find("button.client-toggle", { text: `^${esc(proj.name)}$` }));
      await click("project actions", "summary.client-new-chat", { aria: `Project actions for ${esc(proj.name)}`, hover: center(tg) });
      await click("Edit project", "details.client-menu[open] .client-menu-options button", { text: "Edit project" });
      await waitFor("project dialog", () => find("dialog.project-dialog"));
      await click("add a rule", "dialog.project-dialog button.t-add");
      await waitFor("rule textarea", () => find("dialog.project-dialog .t-card.editing textarea"));
      await typeText(cdp, "M9：片头不要超过两秒"); await click("Save rule", "dialog.project-dialog button.t-save");
      await waitFor("commitTaste", async () => ipcCalls("taste:commit").length > 0, { timeoutMs: 10_000 }); await sleep(800); await shot("05-taste-saved");
      const files = execFileSync("grep", ["-rl", "片头不要超过两秒", src.cwd, "--include=*.md"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      await click("close project dialog", "dialog.project-dialog button.remove-cancel").catch(() => key("Escape", 27)); await sleep(500);
      verdict("taste_commit", files.length > 0 && ipcCalls("taste:commit").some((r) => /"committed":true/.test(r.result)), { list: ipcCalls("taste:list").length, commit: ipcCalls("taste:commit").map((r) => r.result.slice(0, 160)), files: files.map((f) => f.replace(RUN, "<RUN>")) });
    });

    // ---- client:create → StarterFlow → project:seedPack ("Set up" → brief → Continue)
    const projName = `M9 拖拽 ${String(Date.now()).slice(-4)}`;
    await step("project_seed_pack", async () => {
      await click("Create project", "button.new-client"); await waitFor("project name input", () => find("input.new-client-input"));
      await typeText(cdp, projName); await key("Enter", 13);
      await waitFor("starter intro", () => find("button.walkthrough-primary"), { timeoutMs: 15_000 }); await shot("06a-starter-intro");
      await click("Set up project", "button.walkthrough-primary");
      await click("brief input", ".starter-input"); await typeText(cdp, "每周烹饪短视频——节奏快、温馨、不拖沓");
      await click("Continue", "button.starter-primary");
      const pack = await waitFor("seedPack", async () => ipcCalls("project:seedPack").find((r) => r.ok), { timeoutMs: 10_000 });
      await sleep(800); await shot("06b-starter-offers");
      const c = sessions().clients.find((x) => x.name === projName);
      const readme = execFileSync("grep", ["-rl", "每周烹饪短视频", src.cwd], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      verdict("project_seed_pack", !!c && readme.length > 0, { client: c && { clientId: c.clientId }, seed: pack.result.slice(0, 200), files: readme.map((f) => f.replace(RUN, "<RUN>")) });
    });

    // ---- characters:create / list / delete — StarterFlow "Add yourself" (or You → Characters) → name + dropped photos
    await step("characters_create_delete", async () => {
      if (await find("button.starter-seed-btn")) await click("Add yourself", "button.starter-seed-btn"); else await click("Characters", "button.you-entry");
      await waitFor("characters panel", () => find(".characters-panel")); await sleep(1200);
      if (await find("button.empty-cta")) await click("Add yourself (panel)", "button.empty-cta"); else await click("Add character", "button.char-add-btn");
      await click("name", "input.char-name-in"); await typeText(cdp, "M9 测试角色");
      const photos = [[200, 60, 60], [60, 200, 60], [60, 60, 200]].map((c, i) => pngFile(join(OUT, `m9-photo-${i + 1}.png`), c));
      const dz = await waitFor("dropzone", () => find(".char-dropzone")); await dropFiles(cdp, center(dz).x, center(dz).y, photos);
      await waitFor("photo grid", () => find(".char-photo")); await shot("07a-character-form");
      await click("Create", "button.char-form-create");
      const created = await waitFor("charactersCreate", async () => ipcCalls("characters:create").find((r) => r.ok), { timeoutMs: 15_000 });
      await sleep(1200); await shot("07b-character-created");
      const del = await find("button.char-del") ?? await find("button", { text: "^(Discard|Delete)" });
      let deleted = null;
      if (del) { await mouseClick(cdp, center(del).x, center(del).y); await sleep(500); if (await find("button.remove-confirm")) await click("confirm delete", "button.remove-confirm"); deleted = await waitFor("delete/discard", async () => [...ipcCalls("characters:delete"), ...ipcCalls("characters:discard")].find((r) => r.ok) ?? null, { timeoutMs: 8_000 }).catch(() => null); await sleep(600); await shot("07c-character-removed"); }
      await click("close characters", ".characters-panel button.t-close").catch(() => key("Escape", 27)); await sleep(400);
      verdict("characters_create_delete", !!created, { list: ipcCalls("characters:list").length, create: created.result.slice(0, 200), removed: deleted && { ch: deleted.ch, result: deleted.result.slice(0, 120) } });
    });

    // ---- two empty videos in the source project → session:reorder by dragging (custom MIME application/x-videoclaw-video)
    const made = [];
    await step("session_reorder_drag", async () => {
      for (let i = 0; i < 2; i++) {
        const tg = await waitFor("project row", () => find("button.client-toggle", { text: `^${esc(proj.name)}$` }));
        const before = sessions().sessions.length;
        await click("New video in project", "button.client-new-chat", { aria: `New video in ${esc(proj.name)}`, hover: center(tg) });
        const s = await waitFor("new session on disk", async () => (sessions().sessions.length > before ? sessions().sessions.find((x) => !made.includes(x.sessionId) && x.sessionId !== src.sessionId && (x.clientId ?? "personal") === proj.clientId && !x.jobId) : null), { timeoutMs: 15_000 });
        made.push(s.sessionId); await sleep(800);
        // an untouched draft is hidden from the sidebar (visibleSessions L40545) and reused by the next "New video";
        // a typed draft makes it a real sidebar row, exactly as for a user
        await click("composer", "textarea"); await typeText(cdp, `M9 草稿 ${i + 1}`); await sleep(600);
      }
      await shot("08a-two-new-videos");
      const rowsBefore = await cdp.eval(`[...document.querySelectorAll("button.session")].map((e) => e.innerText.trim().slice(0, 40))`);
      const all = await cdp.eval(`[...document.querySelectorAll("button.session")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, t: e.innerText.trim().slice(0, 40) }; })`);
      const srcRow = all.find((r) => r.t.startsWith(String(src.title).slice(0, 10)));
      const first = all.find((r) => r !== srcRow && Math.abs(r.x - srcRow.x) < 5);
      // drag the source video (last in its project) onto the upper half of the first row
      const data = await dragElement(cdp, center(srcRow), { x: center(first).x, y: first.y + 3 });
      await sleep(1200); await shot("08b-after-drag");
      const rowsAfter = await cdp.eval(`[...document.querySelectorAll("button.session")].map((e) => e.innerText.trim().slice(0, 40))`);
      const disk = sessions().sessions.filter((x) => (x.clientId ?? "personal") === proj.clientId).map((x) => ({ id: x.sessionId.slice(0, 8), sidebarOrder: x.sidebarOrder }));
      const srcOrder = sessions().sessions.find((x) => x.sessionId === src.sessionId)?.sidebarOrder;
      const minOther = Math.min(...sessions().sessions.filter((x) => x.sessionId !== src.sessionId && (x.clientId ?? "personal") === proj.clientId).map((x) => x.sidebarOrder ?? Infinity));
      verdict("session_reorder_drag", !!data && ipcCalls("session:reorder").some((r) => r.ok) && typeof srcOrder === "number" && srcOrder < minOther, { mime: data?.items?.map((i) => i.mimeType), rowsBefore, rowsAfter, disk });
    });

    // ---- client:reorder — drag the new project above the source project (application/x-videoclaw-project)
    await step("client_reorder_drag", async () => {
      const before = sessions().clients.map((c) => c.name);
      const groups = await cdp.eval(`[...document.querySelectorAll("div.client-group")].map((g) => { const t = g.querySelector("button.client-toggle"); const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, t: t.innerText.trim() }; })`);
      const from = groups.find((g) => g.t === projName); const to = groups.find((g) => g.t === proj.name);
      const data = await dragElement(cdp, center(from), { x: center(to).x, y: to.y + 2 });
      await sleep(1000); await shot("09-project-reordered");
      const after = sessions().clients.map((c) => c.name);
      verdict("client_reorder_drag", !!data && ipcCalls("client:reorder").some((r) => r.ok) && after.indexOf(projName) < after.indexOf(proj.name), { mime: data?.items?.map((i) => i.mimeType), before, after });
    });

    // ---- session:setPermissionMode — the composer's mode <select> on a fresh (not finalized) video, keyboard only
    await step("set_permission_mode", async () => {
      // the typed drafts show as "Draft" rows (sidebarTitle); open the first one
      await click("draft video row", "button.session", { text: "^Draft" }); await sleep(1000);
      const sel = await waitFor("mode select", () => find("select.mode-select"));
      const shownBefore = await cdp.eval(`document.querySelector("select.mode-select")?.value`);
      await mouseClick(cdp, center(sel).x, center(sel).y); await sleep(400); await key("ArrowUp", 38); await key("Enter", 13); await sleep(800);
      if (!ipcCalls("session:setPermissionMode").length) { await key("Escape", 27); await sleep(200); await key("ArrowUp", 38); await sleep(800); }
      await shot("10-permission-mode");
      const call = await waitFor("setPermissionMode", async () => ipcCalls("session:setPermissionMode").find((r) => r.ok) ?? null, { timeoutMs: 5_000 });
      const [id, mode] = JSON.parse(call.args); const disk = sessions().sessions.find((x) => x.sessionId === id)?.permissionMode;
      const shown = await cdp.eval(`document.querySelector("select.mode-select")?.value`);
      verdict("set_permission_mode", made.includes(id) && disk === mode && mode !== shownBefore, { shownBefore, requested: mode, disk, shown, draftSession: made.indexOf(id) });
    });

    // ---- session:deletionPlan / session:delete — row "⋯" → Delete video… → plan → Delete (the other draft)
    await step("session_delete", async () => {
      const rows = await cdp.eval(`[...document.querySelectorAll("button.session")].filter((e) => e.innerText.trim().startsWith("Draft")).map((e) => { const m = e.querySelector(".session-more"); const r = e.getBoundingClientRect(); const q = m.getBoundingClientRect(); return { row: { x: r.x, y: r.y, width: r.width, height: r.height }, more: { x: q.x, y: q.y, width: q.width || 14, height: q.height || 14 }, active: e.classList.contains("active") }; })`);
      const victim = rows.find((r) => !r.active) ?? rows[rows.length - 1];
      await mouseMove(cdp, center(victim.row).x, center(victim.row).y); await sleep(300);
      await mouseClick(cdp, center(victim.more).x, center(victim.more).y); await sleep(400);
      await click("Delete video…", ".row-menu .row-menu-item.danger");
      await waitFor("plan measured", async () => ((await find(".remove-dialog .remove-confirm")) && !/Checking what this video owns/.test(await bodyText()) ? true : null), { timeoutMs: 10_000 });
      await shot("11a-delete-plan");
      await click("Delete", ".remove-dialog button.remove-confirm");
      const call = await waitFor("session:delete", async () => ipcCalls("session:delete").find((r) => r.ok) ?? null, { timeoutMs: 10_000 });
      const [id] = JSON.parse(call.args);
      const gone = await waitFor("row removed from sessions.json", async () => (!sessions().sessions.some((x) => x.sessionId === id) ? true : null), { timeoutMs: 10_000 });
      await sleep(600); await shot("11b-deleted");
      verdict("session_delete", gone && made.includes(id) && /"ok":true/.test(call.result), { plan: ipcCalls("session:deletionPlan").map((r) => r.result.slice(0, 200)), del: call.result.slice(0, 160), draftSession: made.indexOf(id) });
    });

    // ---- client:remove — project ⋯ → Delete project → Remove
    await step("client_remove", async () => {
      const tg = await waitFor("new project row", () => find("button.client-toggle", { text: `^${esc(projName)}$` }));
      await click("project actions", "summary.client-new-chat", { aria: `Project actions for ${esc(projName)}`, hover: center(tg) });
      await click("Delete project", "details.client-menu[open] .client-menu-options button.client-menu-danger");
      await click("Remove", "dialog.project-dialog button.remove-confirm");
      const gone = await waitFor("client removed", async () => (!sessions().clients.some((c) => c.name === projName) ? true : null), { timeoutMs: 10_000 });
      await sleep(500); await shot("12-project-removed");
      verdict("client_remove", gone && ipcCalls("client:remove").some((r) => r.ok && !/"error"/.test(r.result)), { remove: ipcCalls("client:remove").map((r) => r.result.slice(0, 160)) });
    });

    // ---- quickstart:impression / previewed / mark — Quickstarts gallery (no Start here; Start is in --phase retry)
    await step("quickstart_gallery_beacons", async () => {
      await click("Quickstarts", "button.quickstart-entry");
      await waitFor("gallery", () => find(".qs-card"), { timeoutMs: 20_000 }); await sleep(800);
      const filters = await cdp.eval(`[...document.querySelectorAll(".qs-filters button")].map((b) => b.innerText.trim())`);
      if (filters.length > 1) { await click("category filter", ".qs-filters button", { text: `^${esc(filters[1])}$` }); await sleep(800); }
      await click("open a starter", ".qs-card .qs-view, .qs-card button, .qs-card"); await sleep(1200); await shot("13-quickstart-preview");
      await key("Escape", 27); await sleep(600);
      // quickstart:impression is best-effort in the original renderer: opening the gallery reloads the catalog, and
      // the new snapshot object cancels the pending afterPaint (L32033 effect cleanup) once the catalog was loaded earlier
      verdict("quickstart_gallery_beacons", ipcCalls("quickstart:previewed").some((r) => r.ok) && ipcCalls("quickstart:mark").some((r) => r.ok), { impression: ipcCalls("quickstart:impression").map((r) => r.result.slice(0, 80)), previewed: ipcCalls("quickstart:previewed").length, mark: ipcCalls("quickstart:mark").map((r) => r.args.slice(0, 80)), filters });
    });

    // ---- session:startContinuation — finalized source video → "Start New Video" (moves the job into a new chat)
    await step("start_continuation", async () => {
      await openSession(sessions().sessions.find((x) => x.sessionId === src.sessionId));
      await click("Start New Video", ".chat-closed-actions button.primary", { text: "^Start New Video$" });
      const next = await waitFor("continuation session", async () => { const cs = sessions().sessions.find((x) => x.sessionId === src.sessionId)?.continuation?.sessionId; return cs ? sessions().sessions.find((x) => x.sessionId === cs) ?? null : null; }, { timeoutMs: 15_000 });
      await sleep(1500); await shot("14-continuation");
      const srcAfter = sessions().sessions.find((x) => x.sessionId === src.sessionId);
      verdict("start_continuation", next.jobId === src.jobId && !srcAfter.jobId && srcAfter.continuation?.sessionId === next.sessionId, { next: { sessionId: next.sessionId, title: next.title, jobId: next.jobId === src.jobId }, source: { jobId: srcAfter.jobId ?? null, priorJobId: srcAfter.priorJobId === src.jobId, continuation: srcAfter.continuation }, titleInSidebar: !!(await find("button.session", { text: " · continued" })) });
    });

    // ---- session:delete of a video that OWNS a job: the job dir moves into <workspace>/.videoclaw-trash
    await step("session_delete_with_job", async () => {
      const next = sessions().sessions.find((x) => x.jobId === src.jobId);
      const jobDir = join(src.cwd, "jobs", src.jobId);
      const row = await waitFor("continued row", () => find("button.session", { text: " · continued" }));
      await mouseMove(cdp, center(row).x, center(row).y); await sleep(300);
      const more = await cdp.eval(`(() => { const b = [...document.querySelectorAll("button.session")].find((e) => e.innerText.includes(" · continued")); const m = b.querySelector(".session-more").getBoundingClientRect(); return { x: m.x, y: m.y, width: m.width || 14, height: m.height || 14 }; })()`);
      await mouseClick(cdp, center(more).x, center(more).y); await sleep(400);
      await click("Delete video…", ".row-menu .row-menu-item.danger");
      await waitFor("plan measured", async () => ((await find(".remove-dialog .remove-item")) ? true : null), { timeoutMs: 20_000 });
      await sleep(400); await shot("15a-delete-plan-with-job");
      const planText = (await find(".remove-dialog .remove-body"))?.label;
      await click("Delete", ".remove-dialog button.remove-confirm");
      const call = await waitFor("session:delete", async () => ipcCalls("session:delete").filter((r) => r.ok).find((r) => JSON.parse(r.args)[0] === next.sessionId) ?? null, { timeoutMs: 30_000 });
      await sleep(800); await shot("15b-deleted-with-job");
      const trash = join(src.cwd, ".videoclaw-trash"); const trashed = existsSync(trash) ? readdirSync(trash) : [];
      verdict("session_delete_with_job", /"ok":true/.test(call.result) && !existsSync(jobDir) && trashed.length > 0 && !sessions().sessions.some((x) => x.sessionId === next.sessionId), { planText, del: call.result.slice(0, 160), jobDirGone: !existsSync(jobDir), trashEntries: trashed.length, trashWorkspaces: (sessions().trashWorkspaces ?? []).map((p) => p.replace(RUN, "<RUN>")) });
    });
  }

  if (PHASE === "retry") {
    // a new video in Personal; a PNG really on the X clipboard; Ctrl+V in the composer (attachment:pasteImage L62269)
    let sid;
    await step("paste_image_send", async () => {
      const before = sessions().sessions.length;
      const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
      await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
      const s = await waitFor("new session", async () => (sessions().sessions.length > before ? sessions().sessions.find((x) => !x.jobId && !x.quickstart && x.title === "New video") : null), { timeoutMs: 15_000 });
      sid = s.sessionId; summary.retrySession = sid;
      const png = pngFile(join(OUT, "m9-paste.png"), [240, 180, 30]);
      const xc = spawn("xclip", ["-selection", "clipboard", "-t", "image/png", "-i", png], { env: xenv(), stdio: "ignore", detached: true }); xc.unref();
      await sleep(800);
      summary.clipboardTargets = (() => { try { return execFileSync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], { env: xenv(), encoding: "utf8", timeout: 3000 }).trim().split("\n"); } catch (e) { return String(e.message).slice(0, 120); } })();
      say(`X clipboard targets ${JSON.stringify(summary.clipboardTargets)}`);
      await click("composer", "textarea");
      const ctrlV = async (withCommand) => { await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2, ...(withCommand ? { commands: ["paste"] } : {}) }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 }); };
      await ctrlV(false);
      let pasted = await waitFor("attachment:pasteImage (Ctrl+V)", async () => ipcCalls("attachment:pasteImage").find((r) => r.ok) ?? null, { timeoutMs: 5_000 }).catch(() => null);
      if (!pasted) { await ctrlV(true); pasted = await waitFor("attachment:pasteImage (paste command)", async () => ipcCalls("attachment:pasteImage").find((r) => r.ok) ?? null, { timeoutMs: 8_000 }); }
      if (argv.includes("--paste-only")) { await shot("20a-pasted-chip"); verdict("paste_image", !!pasted, { paste: pasted.result.slice(0, 200) }); summary.pasteOnly = true; return; }
      await waitFor("chip ready", async () => (JSON.stringify(ipcCalls("attachment:list").slice(-1)).includes("ready") || (await bodyText()).includes("Pasted image") ? true : null), { timeoutMs: 15_000 }).catch(() => null);
      await sleep(1200); await shot("20a-pasted-chip");
      await typeText(cdp, "看一下这张图，只回复“收到”两个字，不要调用任何工具。"); await key("Enter", 13);
      const prev = await waitFor("material arrival → materials:preview", async () => ipcCalls("materials:preview").find((r) => r.ok && JSON.parse(r.args)[0] === sid && r.result.includes("Pasted image")) ?? null, { timeoutMs: 30_000 }).catch(() => null);
      await sleep(800); await shot("20b-material-arrived");
      verdict("paste_image_send", !!pasted && !!prev, { paste: pasted.result.slice(0, 200), materialPreview: prev?.result?.slice(0, 200) ?? null, materialsChanged: mainLogRows(/push materials:changed/).length });
    });
    if (!summary.pasteOnly) await step("session_retry", async () => {
      const errCard = await waitFor("timed-out turn → Retry", () => find("button.failure-retry", { text: "Retry" }), { timeoutMs: 120_000 }); await shot("21a-error-card");
      const before = mainLogRows(/agent\.turn\.delivered/).length;
      await click("Retry", "button.failure-retry", { text: "Retry" });
      await waitFor("retried", async () => (mainLogRows(/agent\.turn\.retried/).length ? true : null), { timeoutMs: 15_000 });
      await waitFor("re-delivered", async () => (mainLogRows(/agent\.turn\.delivered/).length > before ? true : null), { timeoutMs: 60_000 }).catch(() => null);
      await sleep(2000); await shot("21b-retried");
      const delivered = mainLogRows(/agent\.turn\.delivered/);
      verdict("session_retry", ipcCalls("session:retry").some((r) => r.ok && r.result === "true") && delivered.length > before, { errCard: errCard.label, retry: ipcCalls("session:retry").map((r) => r.result), deliveredBefore: before, deliveredAfter: delivered.length, retriedLog: mainLogRows(/agent\.turn\.retried/).map((l) => l.slice(0, 300)) });
      await waitIdle(sid, 90_000).catch(() => null);
    });
    if (!summary.pasteOnly) await step("quickstart_start", async () => {
      await click("Quickstarts", "button.quickstart-entry"); await waitFor("gallery", () => find(".qs-card"), { timeoutMs: 20_000 }); await sleep(800);
      await click("open a starter", ".qs-card .qs-view, .qs-card button, .qs-card"); await sleep(1200); await shot("22a-quickstart-modal");
      await click("Try this template", "button.qs-modal-try", { timeoutMs: 10_000 });
      const qs = await waitFor("quickstart session", async () => sessions().sessions.find((x) => x.quickstart) ?? null, { timeoutMs: 30_000 });
      const ft = await waitFor("first turn submitted", async () => sessions().sessions.find((x) => x.sessionId === qs.sessionId)?.quickstart?.firstTurn?.submittedAt ?? null, { timeoutMs: 20_000 }).catch(() => null);
      await sleep(1500); await shot("22b-quickstart-started");
      const atts = ipcCalls("attachment:list").filter((r) => r.result.includes(qs.sessionId)).slice(-1)[0]?.result ?? "";
      summary.quickstartCoreFiles = atts.slice(0, 400);
      // ok = the original start path ran (one durable destination carrying meta.quickstart). firstTurn is reported as-is:
      // the bundled local fixture catalog ships image/svg+xml core files → extensionFor() names them ".bin" and the
      // verbatim composer intake refuses .bin, so the opening brief is not sent (the same code path as the original).
      verdict("quickstart_start", ipcCalls("quickstart:start").some((r) => r.ok) && !!qs.quickstart?.activationId, { start: ipcCalls("quickstart:start").map((r) => r.result.slice(0, 200)), meta: { title: qs.title, starterId: qs.quickstart?.starterId, firstTurnSubmitted: !!ft, coreFileStates: [...atts.matchAll(/"name":"([^"]+)"[^}]*?"status":"([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`), status: sessions().sessions.find((x) => x.sessionId === qs.sessionId)?.status }, mark: ipcCalls("quickstart:mark").map((r) => r.args.slice(0, 60)) });
      await waitIdle(qs.sessionId, 90_000).catch(() => null);
    });
  }

  if (PHASE === "resume1" || PHASE === "resume2") {
    const ask = PHASE === "resume1" ? `请记住这个暗号：${CODE}。现在只回复“好的”，不要调用任何工具，也不要写任何文件。` : "我在上一条消息里让你记住的暗号是什么？只回复暗号本身，不要调用任何工具。";
    const projects = join(UD, "engine-profile", "projects");
    const transcripts = () => { const out = []; if (!existsSync(projects)) return out; for (const d of readdirSync(projects)) for (const f of readdirSync(join(projects, d))) if (f.endsWith(".jsonl")) out.push(join(projects, d, f)); return out; };
    const sdkRows = (id) => { const f = transcripts().find((p) => p.endsWith(`/${id}.jsonl`)); if (!f) return []; return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); };
    const textOf = (r) => { const c = r?.message?.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x.type === "text" ? x.text : x.type === "tool_use" ? `<tool_use ${x.name}>` : "")).join("") : ""; };
    let sid;
    if (PHASE === "resume1") {
      const tg = await waitFor("Personal project", () => find("button.client-toggle", { text: "^Personal$" }));
      await click("New video in Personal", "button.client-new-chat", { aria: "New video in Personal", hover: center(tg) });
      // the id the ORIGINAL renderer got back from session:create (robust against restored/draft rows)
      const created = await waitFor("session:create", async () => ipcCalls("session:create").find((r) => r.ok) ?? null, { timeoutMs: 15_000 });
      sid = JSON.parse(created.result).sessionId; writeFileSync(join(RUN, "m9-resume-session.txt"), sid);
      await sleep(800);
    } else {
      sid = readFileSync(join(RUN, "m9-resume-session.txt"), "utf8").trim();
      await openSession(sessions().sessions.find((x) => x.sessionId === sid));
    }
    const pre = sessions().sessions.find((x) => x.sessionId === sid);
    summary.sessionId = sid; summary.before = { sdkSessionId: pre?.sdkSessionId ?? null, transcriptFiles: transcripts().map((f) => f.split("/").slice(-1)[0]) };
    await click("composer", "textarea"); await typeText(cdp, ask); await shot(`30-${PHASE}-typed`); await key("Enter", 13);
    await waitFor("session:send accepted", async () => ipcCalls("session:send").find((r) => r.ok && JSON.parse(r.args)[0] === sid) ?? null, { timeoutMs: 15_000 });
    await waitFor("turn delivered", async () => (mainLogRows(/agent\.turn\.delivered/).some((l) => l.includes(sid)) ? true : null), { timeoutMs: 30_000 }).catch(() => null);
    // sessions.json is only flushed on some transitions, so the turn end is read from the pushes the renderer
    // got (VIDEOCLAW_PORT_EVENT_LOG): the SDK `result` event for this video, then its latest session:changed row
    const evRows = () => { try { return readFileSync(join(OUT, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
    const liveMeta = () => { const ch = evRows().filter((r) => r.ch === "session:changed").slice(-1)[0]; return ch?.payload?.find?.((x) => x.sessionId === sid) ?? null; };
    const resultEv = await waitFor("SDK result event", async () => evRows().find((r) => r.ch === "session:event" && r.payload?.sessionId === sid && r.payload?.event?.kind === "result") ?? null, { timeoutMs: 8 * 60_000, every: 1000 });
    const done = await waitFor("idle with sdkSessionId", async () => { const m = liveMeta(); return m && m.status !== "running" && m.sdkSessionId && !(await find("button.stop-btn, button[aria-label='Stop']")) ? m : null; }, { timeoutMs: 30_000 });
    summary.result = resultEv.payload.event;
    await sleep(1500); await shot(`31-${PHASE}-answered`);
    const askIdx = (rs) => rs.map((x, i) => [x, i]).filter(([x]) => x.type === "user" && textOf(x).includes(ask.slice(0, 12))).slice(-1)[0]?.[1] ?? -1;
    const rows = await waitFor("SDK transcript has the answer", async () => { const rs = sdkRows(done.sdkSessionId); const i = askIdx(rs); return i >= 0 && rs.slice(i + 1).some((x) => x.type === "assistant" && textOf(x).trim()) ? rs : null; }, { timeoutMs: 20_000 });
    const iAsk = askIdx(rows);
    const answer = rows.slice(iAsk + 1).filter((x) => x.type === "assistant").map(textOf).join(" ").trim();
    // user TEXT turns (tool_result rows excluded); the app prefixes each with its session policy, so keep the tail
    const userTexts = rows.filter((x) => x.type === "user" && (typeof x.message?.content === "string" || (Array.isArray(x.message?.content) && x.message.content.some((c) => c.type === "text")))).map(textOf);
    const userTurns = userTexts.map((t) => t.slice(-90));
    const domTail = (await bodyText()).split(ask).slice(-1)[0] ?? "";
    const delivered = mainLogRows(/agent\.turn\.delivered/).filter((l) => l.includes(sid));
    summary.after = { status: done.status, sdkSessionId: done.sdkSessionId ?? null, transcriptFiles: transcripts().map((f) => f.split("/").slice(-1)[0]) };
    summary.delivered = delivered.map((l) => l.slice(l.indexOf("{"), l.indexOf("{") + 400));
    summary.sdkTranscript = { file: `${done.sdkSessionId}.jsonl`, rows: rows.length, userTextTurns: userTurns, sessionIdsInRows: [...new Set(rows.map((x) => x.sessionId).filter(Boolean))] };
    summary.answer = answer.slice(0, 300);
    summary.staleDropped = mainLogRows(/stale_resume_dropped/).length;
    if (PHASE === "resume1") verdict("resume_turn1", done.status === "idle" && !!done.sdkSessionId && delivered.some((l) => /"resumed":false/.test(l)), { sessionId: sid, sdkSessionId: done.sdkSessionId, answer: summary.answer, delivered: summary.delivered });
    else {
      const resumedRow = delivered.some((l) => /"resumed":true/.test(l) && l.includes(String(summary.before.sdkSessionId)));
      const noFreshSession = summary.after.transcriptFiles.length === summary.before.transcriptFiles.length;
      const priorTurnInSameTranscript = userTexts.slice(0, -1).some((t) => t.includes(CODE));
      // anti-leak: the code word must not be in the turn-2 prompt the SDK sent (only in the resumed history)
      const turn2PromptHasCode = (userTexts.slice(-1)[0] ?? "").includes(CODE);
      verdict("resume_turn2", done.status === "idle" && answer.includes(CODE) && summary.before.sdkSessionId === done.sdkSessionId && resumedRow && noFreshSession && priorTurnInSameTranscript && !turn2PromptHasCode && summary.staleDropped === 0,
        { before: summary.before, after: summary.after, answer: summary.answer, answerInDomAfterAsk: domTail.includes(CODE), resumedRow, noFreshSession, priorTurnInSameTranscript, turn2PromptHasCode, staleDropped: summary.staleDropped, delivered: summary.delivered });
    }
  }
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m9-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
