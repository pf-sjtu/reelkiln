#!/usr/bin/env node
// PORT-NEW docs/23 M5 — S1 through the ORIGINAL renderer UI, driven from outside over the Chrome
// DevTools Protocol with REAL input events. The app runs in VIDEOCLAW_PORT_UI_E2E=1 mode (main injects
// no script; only native dialogs are answered from env). The driver never calls window.videoclaw:
// page evaluation is used read-only (find element geometry, read DOM / <video> state); every action is
// an Input.dispatchMouseEvent / Input.insertText / Input.dispatchDragEvent so the original renderer's own
// React handlers fire. Verification of main-process effects reads files on disk (sessions.json,
// versions.json, events JSONL, job dir, export).
//
//   node tools/ui-e2e.mjs --run RUN_DIR --engine-home SRC_HOME [--appimage PATH] [--port 9333]
//   docs/38 M21 macOS:   node tools/ui-e2e.mjs --run RUN_DIR --engine ENGINE --exe release/mac-arm64/videoclaw-port.app
//   docs/36 M19 Windows: node tools/ui-e2e.mjs --run RUN_DIR --engine ENGINE --exe <win-unpacked or installed>\videoclaw-port.exe
//   (no Xvfb / dbus / gnome-keyring: the packaged CredentialStore uses Windows DPAPI; HOME and USERPROFILE → RUN)
//
// RUN_DIR must not exist; it becomes HOME (userData = RUN/.config/videoclaw-port). SRC_HOME has an
// installed engine (engine-current.json reused, like tools/accept_s1_app.sh). Needs MINIMAX_API_KEY in env
// (never printed). One run at a time (MiniMax concurrency 1).
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, dropFiles, screenshot } from "./ui-e2e/cdp.mjs";
import { answerDeclined, attachFileList, attachmentReadyRe, center, lastSpendMetered, nativePlayButton, playbackVerdict, S1_UI_STEPS } from "./ui-e2e/plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT_DIR = resolve(HERE, "..");
const REPO = resolve(PORT_DIR, "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = resolve(opt("--run") ?? "");
const SRC = opt("--engine-home") ? resolve(opt("--engine-home")) : null;
const ENGINE = opt("--engine") ? resolve(opt("--engine")) : null; // docs/33: point at an installed (read-only) engine dir instead of copying an engine home
const APPIMAGE = opt("--appimage");
const EXE = opt("--exe"); // docs/36: a packaged Windows (or any directly runnable) app executable
const WIN = process.platform === "win32";
const CDP_PORT = Number(opt("--port", "9351"));
const PROJECT = opt("--project", "S1 UI e2e");
const TURN_TIMEOUT_MS = Number(opt("--turn-timeout-ms", String(26 * 60_000))); // the HARNESS wait only
// docs/43 M26: the original has no per-turn wall clock, so the app gets one only on request (PORT-NEW, opt-in)
const APP_TURN_TIMEOUT_MS = opt("--app-turn-timeout-ms") ? Number(opt("--app-turn-timeout-ms")) : null;
const ATTACH_VIA = opt("--attach-via", "drop"); // drop | picker
const EXTRA_DOCS = argv.includes("--extra-docs"); // docs/40 M23: also drop a .zip, an .xlsx and a .pdf (archive / workbook / PDF readers)
const STOP_AFTER = opt("--stop-after"); // "attach" ($0 UI check) | "quickstart" | "card" (stop once an answered question card is acknowledged)
const ANSWER_CARD = !argv.includes("--no-answer-card");
const TASTE_WAIT_MS = Number(opt("--taste-wait-ms", String(6 * 60_000)));
const CHECK_QUICKSTART = argv.includes("--check-quickstart"); // docs/24: open the original Quickstarts gallery after home
const TITLE_WAIT_MS = Number(opt("--title-wait-ms", String(90_000)));
if (!opt("--run") || (!opt("--engine-home") && !opt("--engine"))) { console.error("usage: ui-e2e.mjs --run RUN_DIR --engine-home SRC_HOME [--appimage PATH]"); process.exit(2); }
if (!process.env.MINIMAX_API_KEY) { console.error("MINIMAX_API_KEY not set"); process.exit(2); }
if (existsSync(RUN)) { console.error(`${RUN} exists; use a fresh dir`); process.exit(2); }

const UD = join(RUN, ".config", "videoclaw-port");
const OUT = join(RUN, "out"); const SHOTS = join(OUT, "shots"); const IN = join(RUN, "in"); const EXPORT = join(RUN, "export", "s1.mp4");
mkdirSync(UD, { recursive: true }); mkdirSync(SHOTS, { recursive: true }); mkdirSync(dirname(EXPORT), { recursive: true });
if (WIN) mkdirSync(join(RUN, "Downloads"), { recursive: true }); // USERPROFILE=RUN: app.getPath("downloads") (save-as default dir) needs it
if (SRC) {
  cpSync(join(SRC, ".config", "videoclaw-port", "engine-current.json"), join(UD, "engine-current.json"));
  for (const d of [".cache", ".local", ".npm"]) if (existsSync(join(SRC, d))) execFileSync("cp", ["-al", join(SRC, d), RUN]);
}
if (ENGINE) { // the engine's own version + build digest (bootstrap.ts L389), as tools/ui-e2e-m16-voice.mjs does
  const version = JSON.parse(readFileSync(join(ENGINE, "ENGINE_VERSION.json"), "utf8")).version;
  let digest = null; try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; if (/^[0-9a-f]{64}$/.test(d)) digest = d; } catch {}
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ version, path: ENGINE, ...(digest ? { buildSha256: digest } : {}) }));
}
execFileSync("bash", [join(REPO, "tools", "accept_fixtures.sh"), IN], { stdio: "ignore" });
const BRIEF_DEFAULT = "我有三段短素材和一段配乐。帮我做一个 6.5 秒的竖屏 9:16 快剪：按 a→b→c 顺序，a 取 0.5–3.0 s，b 取 0–2.0 s，c 取 0.5–2.5 s；只用 music.mp3 做音轨（不要素材原声）；不要字幕、不要叠加、不要任何付费工具。渲染成片。";
// docs/24: --brief-file overrides the S1 brief (e.g. a brief that makes the agent ask an AskUserQuestion first)
const BRIEF = opt("--brief-file") ? readFileSync(resolve(opt("--brief-file")), "utf8").trim() : BRIEF_DEFAULT;
// docs/42 M25: --files a,b,c attaches these (absolute) files instead of the S1 fixtures (e.g. a real production's sources).
const FILES = attachFileList(opt("--files"), IN, { join, resolve });

const LOG = join(OUT, "cdp-log.jsonl");
const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[ui-e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const steps = {}; const verdict = (id, ok, detail) => { steps[id] = { ok, ...detail }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(detail).slice(0, 400)}`); };

// ---- launch ----------------------------------------------------------------------------------
const env = { ...process.env, HOME: RUN, ...(WIN ? { USERPROFILE: RUN } : { UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? join(process.env.HOME ?? "/home/box", ".local", "share", "uv", "python") }), ...(ATTACH_VIA === "picker" ? { VIDEOCLAW_PORT_SMOKE_PICK_FILES: FILES.join("\n") } : {}), VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "minimax",
  VIDEOCLAW_PORT_SMOKE_SAVE_AS: EXPORT, VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl") };
delete env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS; if (APP_TURN_TIMEOUT_MS) env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS = String(APP_TURN_TIMEOUT_MS);
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
// docs/38 M21: macOS — HOME=RUN has no login keychain; Chromium's mock keychain keeps safeStorage off the real one
const appArgs = ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`, ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])];
let cmd, args;
let keyringPids = [];
if (EXE) {
  cmd = resolve(EXE);
  // docs/38 M21: a macOS .app bundle → its Contents/MacOS executable
  if (cmd.endsWith(".app")) { const macos = join(cmd, "Contents", "MacOS"); cmd = join(macos, readdirSync(macos)[0]); }
  args = appArgs;
}
else if (APPIMAGE) {
  env.APPIMAGE_EXTRACT_AND_RUN = "1";
  // docs/33 harness input: a packaged build stores credentials only through the OS keychain (CredentialStore) —
  // give it a private session bus + an unlocked gnome-keyring Secret Service, and tell Chromium to use it.
  const bus = execFileSync("dbus-daemon", ["--session", "--fork", "--print-address=1", "--print-pid=1"]).toString().trim().split("\n");
  env.DBUS_SESSION_BUS_ADDRESS = bus[0];
  const kr = execFileSync("bash", ["-c", "printf 'ui-e2e-harness' | gnome-keyring-daemon --unlock --components=secrets"], { env: { ...env } }).toString();
  keyringPids = [Number(bus[1]), Number(/GNOME_KEYRING_PID=(\d+)/.exec(kr)?.[1] ?? 0)].filter(Boolean);
  cmd = "xvfb-run"; args = ["-a", "-s", "-screen 0 1440x960x24", resolve(APPIMAGE), ...appArgs, "--password-store=gnome-libsecret"];
}
else { cmd = "xvfb-run"; args = ["-a", "-s", "-screen 0 1440x960x24", join(PORT_DIR, "node_modules", ".bin", "electron"), ...appArgs, PORT_DIR]; }
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) { console.error(`port ${CDP_PORT} already in use — pick another --port`); process.exit(2); }
say(`launch ${EXE ? "exe " + EXE : APPIMAGE ? "AppImage " + APPIMAGE : "dev electron"} (UI_E2E mode, CDP :${CDP_PORT})`);
const mainLog = join(OUT, "main.log");
const child = spawn(cmd, args, { cwd: PORT_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: !WIN, windowsHide: true });
child.stdout.on("data", (b) => appendFileSync(mainLog, b)); child.stderr.on("data", (b) => appendFileSync(mainLog, b));
let exited = false; child.on("exit", (c) => { exited = true; say(`app exited ${c}`); });

const target = await waitForPageTarget(CDP_PORT, { timeoutMs: 120_000, match: (t) => t.type === "page" && /(app\/out\/renderer|renderer-original)\/index\.html$/.test(t.url) });
const cdp = await Cdp.connect(target.webSocketDebuggerUrl, (o) => log(o));
await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
const consoleErrors = []; const consoleFull = [];
const CONSOLE_LOG = join(OUT, "console.jsonl"); // docs/24: every renderer console error / exception, untruncated
cdp.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") { const m = p.args.map((a) => a.value ?? a.description).join(" "); consoleErrors.push(m.slice(0, 300)); consoleFull.push(m); appendFileSync(CONSOLE_LOG, JSON.stringify({ t: Date.now() - t0, kind: "console.error", text: m }) + "\n"); } });
cdp.on("Runtime.exceptionThrown", (p) => { const m = String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text); consoleErrors.push(m.slice(0, 300)); consoleFull.push(m); appendFileSync(CONSOLE_LOG, JSON.stringify({ t: Date.now() - t0, kind: "exception", text: m, url: p.exceptionDetails?.url, line: p.exceptionDetails?.lineNumber }) + "\n"); });
say(`page target ${target.url}`);

// ---- read-only DOM helpers -------------------------------------------------------------------
const shot = async (name) => { const p = join(SHOTS, `${name}.png`); writeFileSync(p, await screenshot(cdp)); log({ screenshot: `${name}.png` }); return p; };
const bodyText = () => cdp.eval("document.body ? document.body.innerText : ''");
async function waitFor(desc, fn, { timeoutMs = 30_000, every = 300 } = {}) {
  const ts = Date.now(); let v;
  while (Date.now() - ts < timeoutMs) { v = await fn().catch(() => null); if (v) return v; await sleep(every); }
  throw new Error(`timeout waiting for ${desc}`);
}
/** geometry of the first VISIBLE element matching selector (+ optional text/aria regex); read-only. */
async function find(selector, { text, aria, last = false } = {}) {
  return cdp.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    ${text ? `if (!new RegExp(${JSON.stringify(text)}).test((e.innerText || e.value || "").trim())) return false;` : ""}
    ${aria ? `if (!new RegExp(${JSON.stringify(aria)}).test((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || ""))) return false;` : ""}
    return true; }); const e = els[${last ? "els.length - 1" : "0"}]; if (!e) return null; e.scrollIntoView({ block: "nearest", inline: "nearest" }); const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, tag: e.tagName, cls: String(e.className).slice(0, 80), label: (e.getAttribute("aria-label") || e.getAttribute("title") || e.innerText || "").trim().slice(0, 80) }; })()`);
}
/** REAL click at the element's center after checking the hit target is that element (no synthetic .click()). */
async function click(desc, selector, o = {}) {
  const el = await waitFor(desc, () => find(selector, o), { timeoutMs: o.timeoutMs ?? 30_000 });
  const p = o.point ? o.point(el) : center(el);
  const hit = await cdp.eval(`(() => { const h = document.elementFromPoint(${p.x}, ${p.y}); const t = [...document.querySelectorAll(${JSON.stringify(selector)})]; return { hitTag: h && h.tagName, hitCls: h && String(h.className).slice(0, 60), onTarget: !!h && t.some((e) => e === h || e.contains(h)) }; })()`);
  log({ action: "click", desc, selector, at: p, element: el, hit });
  if (o.hover) { await mouseMove(cdp, o.hover.x, o.hover.y); await sleep(250); }
  await mouseClick(cdp, p.x, p.y);
  return { el, at: p, hit };
}

// ---- session discovery from disk (main-process truth) -----------------------------------------
const sessions = () => readJson(join(UD, "sessions.json")) ?? { sessions: [], clients: [] };
const events = () => { try { return readFileSync(join(OUT, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

// ---- docs/24 (A): the original AskUserQuestion card, answered like a user ---------------------
/** first .q-option of every question, then the real "Answer" (.q-submit) — all real mouse events. */
async function answerQuestionCard(phase) {
  if (!ANSWER_CARD || !(await find(".question-card .q-submit"))) return null;
  const n = summary.questionCards.length + 1;
  await shot(`${phase === "taste" ? "09a" : "05q"}-question-card-${n}`);
  const nq = await cdp.eval(`document.querySelectorAll(".question-card .question").length`);
  const picked = [];
  for (let i = 0; i < nq; i++) {
    const o = await cdp.eval(`(() => { const q = document.querySelectorAll(".question-card .question")[${i}]; const b = q && q.querySelector(".q-option"); if (!b) return null; b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, label: b.innerText.trim().slice(0, 60) }; })()`);
    if (!o) continue;
    const p = center(o); log({ action: "click", desc: `question ${i + 1} first option`, at: p, element: o });
    await mouseClick(cdp, p.x, p.y); picked.push(o.label); await sleep(300);
  }
  await shot(`${phase === "taste" ? "09b" : "05r"}-question-card-${n}-selected`);
  const reqEv = [...events()].reverse().find((e) => e.ch === "permission:request" && e.payload?.sessionId === sid && e.payload?.toolName === "AskUserQuestion");
  await click("question card Answer", ".question-card .q-submit");
  if (!summary.driven.some((d) => /AskUserQuestion card/.test(d.element))) drove("AskUserQuestion card (.question-card): first .q-option per question + 'Answer' (.q-submit)", "click");
  const card = { phase, questions: nq, picked, atMs: Date.now(), requestId: reqEv?.payload?.requestId ?? null, toolUseId: reqEv?.payload?.toolUseId ?? null };
  summary.questionCards.push(card);
  say(`answered question card ${n} (${phase}) ${JSON.stringify(picked)}`);
  return card;
}
/** Was the answer received as allow+answers (not a decline)? Events after the click + main's decision line. */
function answerVerdict(card) {
  const after = events().filter((e) => e.ch === "session:event" && e.payload?.sessionId === sid && Date.parse(e.t) >= card.atMs - 2000).map((e) => ({ t: e.t, ...e.payload.event }));
  const toolEnd = after.find((e) => e.kind === "tool_end" && e.toolUseId === card.toolUseId);
  const resolved = after.find((e) => e.kind === "permission_resolved" && e.requestId === card.requestId);
  const texts = after.filter((e) => e.kind === "thinking" || e.kind === "assistant_text").map((e) => String(e.text));
  const declinedMentioned = answerDeclined(texts); // plan.mjs DECLINE_RE (docs/24: refusal phrasing only)
  const pickedLabelsEchoed = card.picked.filter((l) => texts.some((t) => t.includes(l.split("\n")[0].slice(0, 24))));
  const decisions = [...readFileSync(mainLog, "utf8").matchAll(/^\{[^\n]*"event":"agent\.permission\.decision"[^\n]*$/gm)].map((m) => JSON.parse(m[0])).filter((d) => d.requestId === card.requestId);
  const decision = decisions.pop() ?? null;
  return {
    permissionResolved: !!resolved, toolEnd: toolEnd ? { isError: toolEnd.isError, terminal: toolEnd.terminal } : null,
    mainDecision: decision && { behavior: decision.behavior, answers: decision.answers, tool: decision.tool },
    declinedMentioned, pickedLabelsEchoed, textsAfter: texts.length, firstTextsAfter: texts.slice(0, 3).map((t) => t.slice(0, 500)),
    accepted: !!resolved && !!toolEnd && toolEnd.isError === false && !declinedMentioned && decision?.behavior === "allow" && decision?.answers > 0,
  };
}
async function settleVerdict(card, ms = 180_000) { // wait for the tool_end + the agent's next words (or the turn's end)
  const ts = Date.now(); let v;
  while (Date.now() - ts < ms) { v = answerVerdict(card); const done = events().some((e) => e.ch === "session:event" && e.payload?.sessionId === sid && Date.parse(e.t) >= card.atMs && e.payload.event?.kind === "result"); if ((v.toolEnd && v.textsAfter > 0) || done) break; await sleep(1500); }
  card.verdict = answerVerdict(card); say(`answer verdict ${JSON.stringify(card.verdict).slice(0, 700)}`); return card.verdict;
}

const summary = { started: new Date().toISOString(), mode: EXE ? `exe (${process.platform})` : APPIMAGE ? "AppImage" : "dev", steps, driven: [], notDriven: [], fallbacksToIpc: [], questionCards: [] };
const drove = (el, how) => summary.driven.push({ element: el, how });

/** docs/43 M26: harness wait-timeout → click the original composer Stop, wait for the turn to settle and for the
 *  main process's agent.spend.metered record, then let the normal quit (original QuitCoordinator dialog) run. */
async function stopTurnFromUi(sessionId, phase) {
  const sinceIso = new Date().toISOString(); const out = { phase, at: sinceIso };
  try {
    await click("Stop (harness wait timed out)", "button.send-btn.stop", { timeoutMs: 15_000 });
    drove("composer Stop (button.send-btn.stop) on harness wait-timeout", "click → session interrupt");
    out.clicked = true;
  } catch (e) { out.clicked = false; out.clickError = String(e?.message ?? e).slice(0, 200); }
  const settled = await waitFor("turn settled after Stop", async () => {
    const evs = events().filter((e) => e.ch === "session:event" && e.payload?.sessionId === sessionId).map((e) => e.payload.event);
    const r = sessions().sessions.find((x) => x.sessionId === sessionId);
    return evs.some((e) => e?.kind === "result") || (r && r.status !== "running" && r.status !== "awaiting_permission") ? (r?.status ?? "result") : null;
  }, { timeoutMs: 90_000, every: 1000 }).catch(() => null);
  out.settled = settled;
  out.metered = await waitFor("agent.spend.metered after Stop", async () => lastSpendMetered(readFileSync(mainLog, "utf8"), sessionId, sinceIso), { timeoutMs: 60_000, every: 1000 }).catch(() => null);
  await shot(`05x-${phase}-stopped`).catch(() => {});
  log({ turnWaitTimeout: out });
  return out;
}
let sid = null, jobId = null;
try {
  // 1. home -----------------------------------------------------------------------------------
  await waitFor("original home", async () => /What are we making today\?/.test(await bodyText()), { timeoutMs: 90_000 });
  await sleep(1200);
  if (await find("button.tour-skip")) { await click("Skip tour", "button.tour-skip"); drove("onboarding tour 'Skip tour' (button.tour-skip)", "Input.dispatchMouseEvent click"); await sleep(500); }
  await shot("01-home");
  const homeText = await bodyText();
  verdict("home", /What are we making today\?/.test(homeText) && /New video/.test(homeText) && !/Welcome to Videoclaw/.test(homeText), { composer: !!(await find("textarea.new-video-composer")) });
  // docs/39 M22 (information, not a verdict): what the packaged app's OWN media:voiceDictationStatus reports — on macOS
  // it finds resources/bootstrap/voice-dictation (the helper built from VoiceDictation.swift) and runs `--check`.
  try { summary.voiceDictationStatus = await cdp.eval("window.videoclaw.voiceDictationStatus()"); say(`voiceDictationStatus ${JSON.stringify(summary.voiceDictationStatus)}`); } catch (e) { summary.voiceDictationStatus = { error: String(e?.message ?? e) }; }
  if (CHECK_QUICKSTART) {
    // docs/24 (C1): sidebar "Quickstarts" → original gallery → quickstart:catalog; "Loading Quickstarts…" must give way to cards
    await click("sidebar Quickstarts", "button.quickstart-entry"); drove("sidebar 'Quickstarts' (button.quickstart-entry)", "click → original quickstart:catalog");
    const card = await waitFor("quickstart cards (or the error card)", async () => (await find(".qs-gallery .qs-card")) ?? (await find(".qs-state-card")), { timeoutMs: 20_000 }).catch(() => null);
    await sleep(800);
    await shot("01b-quickstarts");
    const qs = await cdp.eval(`(() => ({ loading: !!document.querySelector(".qs-loading"), error: (document.querySelector(".qs-state-card")||{}).innerText || null, cards: [...document.querySelectorAll(".qs-gallery .qs-card")].map((c) => (c.querySelector("h3,h2,.qs-card-title")||c).innerText.split("\\n")[0].slice(0, 80)), images: document.querySelectorAll(".qs-gallery img").length, filters: [...document.querySelectorAll(".qs-filters button")].map((b) => b.innerText.trim()).slice(0, 12) }))()`);
    verdict("quickstart_catalog", !!card && !qs.loading && !qs.error && qs.cards.length > 0, qs);
    if (STOP_AFTER === "quickstart") throw Object.assign(new Error("stop-after quickstart"), { planned: true });
  }

  // 2. project + video ------------------------------------------------------------------------
  await click("Projects + (Create project)", "button.new-client"); drove("sidebar 'Create project' + (button.new-client)", "click");
  await waitFor("Create project dialog", () => find("input.new-client-input"));
  await click("Project name input", "input.new-client-input");
  await typeText(cdp, PROJECT); log({ action: "insertText", into: "input.new-client-input", text: PROJECT }); drove("Create project dialog name field (input.new-client-input)", "click + Input.insertText");
  await click("Create", "button.pd-save", { text: "^Create$" }); drove("Create project dialog 'Create' (button.pd-save)", "click");
  const toggle = await waitFor("project in sidebar", () => find("button.client-toggle", { text: `^${PROJECT}$` }));
  await click(`New video in ${PROJECT}`, "button.client-new-chat", { aria: `New video in ${PROJECT}`, hover: center(toggle) }); drove(`sidebar 'New video in ${PROJECT}' (button.client-new-chat)`, "hover + click");
  const created = await waitFor("session created in project (sessions.json)", async () => { const c = sessions().clients.find((x) => x.name === PROJECT); const s = c && sessions().sessions.find((x) => x.clientId === c.clientId); return s && { client: c, session: s }; });
  sid = created.session.sessionId;
  await waitFor("video composer", () => find("button.send-btn"));
  await shot("02-new-video");
  verdict("project_video", true, { clientId: created.client.clientId, sessionId: sid, title: created.session.title });

  // 3. drag-and-drop attachments --------------------------------------------------------------
  const ta = await waitFor("composer textarea", () => find("textarea"));
  if (ATTACH_VIA === "picker") {
    await click("Add footage, images, audio… (attach button)", "button.attach-btn", { aria: "Add footage" }); drove("composer 'Add footage, images, audio…' (button.attach-btn)", "click → original intake:pickFiles → open dialog (answered by env preset)");
  } else {
    const dropAt = center(ta);
    log({ action: "dropFiles", at: dropAt, files: FILES.map((f) => basename(f)) });
    await dropFiles(cdp, dropAt.x, dropAt.y, FILES); drove("composer dropzone (original window-level drop handler of the active video; dropped over the composer)", `Input.dispatchDragEvent dragEnter/dragOver/drop with DragData.files (${FILES.length} real files)`);
  }
  const attStore = join(UD, "composer-attachments.json");
  const atts = await waitFor(`${FILES.length} attachments ready (main store) + tiles in composer`, async () => {
    const txt = await bodyText(); if (!FILES.every((f) => txt.includes(basename(f)))) return null;
    const ev = readFileSync(mainLog, "utf8"); const ready = FILES.filter((f) => attachmentReadyRe(basename(f)).test(ev));
    return ready.length === FILES.length ? ready.map((f) => basename(f)) : null;
  }, { timeoutMs: 120_000 });
  await sleep(800);
  await shot("03-attachments");
  verdict("attach", true, { via: ATTACH_VIA, ready: atts, storeFile: existsSync(attStore) });
  if (EXTRA_DOCS) {
    // docs/40 M23: the original intake readers through the ORIGINAL renderer — extractArchive (yauzl) unpacks the
    // zip into child chips, the workbook utilityProcess (SheetJS) reads the xlsx, readOwnedPdf reads the PDF
    // (PDFKit on macOS; the original's own "unavailable" elsewhere). Files are generated here (harness inputs).
    const { makeDocs } = await import("./ui-e2e/docs-fixtures.mjs");
    const docs = await makeDocs(IN);
    const dropAt = center(await find("textarea"));
    await dropFiles(cdp, dropAt.x, dropAt.y, docs.files); drove("composer dropzone: docs.zip + plan.xlsx + brief.pdf", "Input.dispatchDragEvent drop (3 real files)");
    const want = ["cover.png", "storyboard.pdf", "plan.xlsx", "brief.pdf"];
    const rec = await waitFor("zip children + workbook + pdf ready (store)", async () => {
      const st = readJson(attStore); const rows = (st?.attachments ?? []).filter((a) => a.sessionId === sid);
      const by = (n) => rows.find((a) => a.name === n);
      return want.every((n) => by(n)?.status === "ready") ? { rows: rows.map((a) => ({ name: a.name, status: a.status, archive: a.archive ? { parentName: a.archive.parentName, entryPath: a.archive.entryPath } : undefined, workbook: a.workbook ? { sheets: a.workbook.sheets, cells: a.workbook.cells, summary: a.workbook.summary } : undefined, pdf: a.pdf ? { status: a.pdf.status, pages: a.pdf.pages, summary: a.pdf.summary } : undefined, unpacked: a.unpacked })), by } : null;
    }, { timeoutMs: 120_000 });
    await sleep(600); await shot("03b-extra-docs");
    const by = (n) => rec.rows.find((a) => a.name === n);
    const pdfWant = process.platform === "darwin" ? "read" : "unavailable";
    const ok = by("cover.png")?.archive?.parentName === "docs.zip" && by("storyboard.pdf")?.archive?.entryPath === "boards/storyboard.pdf"
      && by("plan.xlsx")?.workbook?.sheets === 2 && by("brief.pdf")?.pdf?.status === pdfWant && by("docs.zip")?.unpacked?.files === 2 && by("docs.zip")?.unpacked?.skippedTotal === 1;
    const chips = await bodyText();
    verdict("extra_docs", ok && want.every((n) => chips.includes(n)), { rows: rec.rows.filter((a) => [...want, "docs.zip", "skip.exe"].includes(a.name)), pdfExpected: pdfWant, chipsInComposer: want.filter((n) => chips.includes(n)) });
  }
  if (STOP_AFTER === "attach") throw Object.assign(new Error("stop-after attach"), { planned: true });

  // 4. brief + Send ---------------------------------------------------------------------------
  await click("composer textarea", "textarea");
  await typeText(cdp, BRIEF); log({ action: "insertText", into: "textarea", chars: BRIEF.length }); drove("composer textarea", "click + Input.insertText(brief)");
  await sleep(400);
  const typed = await cdp.eval("(document.querySelector('textarea')||{}).value || ''");
  await shot("04-brief-typed");
  await click("Send", "button.send-btn"); drove("composer Send (button.send-btn)", "click");
  const tSend = Date.now();
  await waitFor("brief bubble in transcript", async () => (await bodyText()).includes(BRIEF.slice(0, 12)), { timeoutMs: 30_000 });
  verdict("brief_send", typed === BRIEF, { typedMatches: typed === BRIEF });

  // 5. stream ---------------------------------------------------------------------------------
  let streamShot = false, controlsDuringTurn = null, lastLen = 0, growth = 0, result = null;
  while (Date.now() - tSend < TURN_TIMEOUT_MS) {
    const evs = events().filter((e) => e.ch === "session:event" && e.payload?.sessionId === sid);
    result = evs.map((e) => e.payload.event).find((e) => e?.kind === "result") ?? null;
    const txt = await bodyText().catch(() => ""); if (txt.length !== lastLen) { growth++; lastLen = txt.length; }
    const tools = evs.filter((e) => e.payload.event?.kind === "tool_start").length;
    if (!streamShot && tools >= 3) {
      await shot("05-turn-streaming"); streamShot = true;
      controlsDuringTurn = await cdp.eval(`[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width&&/stop|send|interrupt/i.test((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+b.className)).map(b=>({cls:String(b.className),aria:b.getAttribute('aria-label'),title:b.getAttribute('title'),disabled:b.disabled}))`);
      log({ controlsDuringTurn });
    }
    if (result) break;
    // docs/43 M26: a turn that ended in an error (e.g. the SDK failed to spawn) never yields a result — fail now, not at the wait limit
    const errEv = evs.map((e) => e.payload.event).filter((e) => e?.kind === "error").pop();
    const row = errEv && sessions().sessions.find((x) => x.sessionId === sid);
    if (errEv && row && row.status !== "running" && row.status !== "awaiting_permission") throw new Error(`turn ended in error (status ${row.status}): ${String(errEv.message).slice(0, 300)}`);
    const card = await answerQuestionCard("main");
    if (card) {
      await settleVerdict(card);
      verdict(`question_card_${summary.questionCards.length}`, card.verdict.accepted, card.verdict);
      if (STOP_AFTER === "card") throw Object.assign(new Error("stop-after card"), { planned: true });
    }
    await sleep(2000);
  }
  if (!result) {
    // docs/43 M26: stop the turn the way a user would (composer Stop) BEFORE quitting, so the app writes its spend record
    summary.turnWaitTimeout = await stopTurnFromUi(sid, "main");
    throw new Error(`turn timeout: harness wait ${Math.round(TURN_TIMEOUT_MS / 1000)} s elapsed; stopped from the UI (${JSON.stringify(summary.turnWaitTimeout).slice(0, 300)})`);
  }
  const evs = events().filter((e) => e.ch === "session:event" && e.payload?.sessionId === sid).map((e) => e.payload.event);
  await sleep(2000);
  await shot("05b-turn-done");
  jobId = sessions().sessions.find((s) => s.sessionId === sid)?.jobId ?? null;
  // docs/24 (C2): the video's title — fallback right after Send (original nameSession), then the proposed one
  const titleRow = await waitFor("proposed title (titleOrigin automatic)", async () => { const r = sessions().sessions.find((x) => x.sessionId === sid); return r?.titleOrigin === "automatic" ? r : null; }, { timeoutMs: TITLE_WAIT_MS }).catch(() => sessions().sessions.find((x) => x.sessionId === sid));
  const titleInSidebar = titleRow?.title ? await cdp.eval(`[...document.querySelectorAll("aside, nav, .sidebar, [class*=sidebar]")].some((e) => (e.innerText || "").includes(${JSON.stringify(String(titleRow.title).slice(0, 30))}))`) : false;
  const titleChanges = events().filter((e) => e.ch === "session:changed").map((e) => (e.payload || []).find((m) => m.sessionId === sid)).filter(Boolean).map((m) => `${m.titleOrigin ?? "-"}:${m.title}`).filter((v, i, a) => a.indexOf(v) === i);
  summary.title = { title: titleRow?.title, titleOrigin: titleRow?.titleOrigin ?? null, notNewVideo: !!titleRow?.title && titleRow.title !== "New video", inSidebarDom: titleInSidebar, sequence: titleChanges };
  say(`title ${JSON.stringify(summary.title)}`);
  await shot("05c-title");
  verdict("stream", !!result && !result.isError, { turnS: Math.round((Date.now() - tSend) / 1000), toolStarts: evs.filter((e) => e.kind === "tool_start").length, textDeltas: evs.filter((e) => e.kind === "text_delta").length, domTextChanges: growth, numTurns: result.numTurns, isError: result.isError, jobId, controlsDuringTurn });

  // 5b. docs/37 (W11b): the agent reply's relative job link ([Watch the finished cut](jobs/<id>/final.mp4)) must render
  // as the original inline media block (resolveDeliveryUrl → InlineVideo), not "Link unavailable".
  const replyProbe = `(() => { const vs = [...document.querySelectorAll("video.inline-media")].filter((v) => /\\/final\\.mp4/.test(decodeURIComponent(v.currentSrc || v.src || ""))); const unavailable = [...document.querySelectorAll(".inline-media-status")].filter((e) => /Link unavailable/.test(e.innerText)).length; const v = vs[0]; return { inlineVideos: vs.length, unavailable, src: v ? (v.currentSrc || v.src).slice(0, 220) : null, readyState: v ? v.readyState : null, duration: v ? v.duration : null, openLink: !!document.querySelector("a.media-open") }; })()`;
  const reply = await waitFor("reply link inline video", async () => { const r = await cdp.eval(replyProbe); return r.inlineVideos > 0 && r.readyState >= 1 ? r : null; }, { timeoutMs: 30_000 }).catch(async () => cdp.eval(replyProbe));
  verdict("reply_link", reply.inlineVideos > 0 && reply.readyState >= 1 && reply.unavailable === 0 && /^vcmedia:\/\/local\//.test(reply.src ?? ""), { ...reply, src: reply.src && reply.src.replace(RUN, "<RUN>") });

  // 6. play in the original Output panel player -----------------------------------------------
  await waitFor("V1 in the version strip", () => find("button.v-pill", { text: "^V1" }), { timeoutMs: 120_000 });
  const vSel = ".op-preview-stage video";
  const vEl = await waitFor("Output panel player", async () => { const r = await find(vSel); if (!r) return null; const rs = await cdp.eval(`document.querySelector(${JSON.stringify(vSel)}).readyState`); return rs >= 1 ? r : null; }, { timeoutMs: 60_000 }).catch(async (e) => {
    const diag = await cdp.eval(`[...document.querySelectorAll("video, img")].slice(0, 6).map((v) => ({ tag: v.tagName, src: (v.currentSrc || v.src || "").slice(0, 200), err: v.error && v.error.code, rs: v.readyState }))`).catch(() => null);
    say(`player diag ${JSON.stringify(diag)}`); throw e; });
  const vInfo = await cdp.eval(`(() => { const v = document.querySelector(${JSON.stringify(vSel)}); return { src: v.currentSrc, controls: v.controls, paused: v.paused, readyState: v.readyState, duration: v.duration, w: v.videoWidth, h: v.videoHeight }; })()`);
  await click("player native play control", vSel, { point: nativePlayButton }); drove("Output panel player (original <video controls> in .op-preview-stage) native play button", "click at the controls' play button position");
  const samples = [];
  for (let i = 0; i < 6; i++) { await sleep(500); samples.push(await cdp.eval(`(() => { const v = document.querySelector(${JSON.stringify(vSel)}); return { t: Date.now(), currentTime: v.currentTime, paused: v.paused, ended: v.ended, readyState: v.readyState, error: v.error && v.error.code }; })()`)); if (i === 2) await shot("06-player-playing"); }
  log({ playbackSamples: samples });
  const pv = playbackVerdict(samples);
  verdict("play", pv.ok && /^vcmedia:\/\//.test(vInfo.src) && /\/versions\/v1\.mp4/.test(vInfo.src), { ...pv, src: vInfo.src.replace(RUN, "<RUN>"), duration: vInfo.duration, size: `${vInfo.w}x${vInfo.h}`, controls: vInfo.controls });

  // 7. approve --------------------------------------------------------------------------------
  const approveEl = (await find("button.v-approve", { aria: "final one" })) ? { aria: "final one" } : {};
  await click("Approve V1", "button.v-approve", { text: "Approve V1", ...approveEl }); drove("'Approve V1' (button.v-approve, Output panel)", "click");
  await waitFor("approved UI", async () => { const t = await bodyText(); return /V1 approved/.test(t) && /This video is finalized/.test(t); }, { timeoutMs: 30_000 });
  const row = await waitFor("finalizedAtMs on disk", async () => { const s = sessions().sessions.find((x) => x.sessionId === sid); return s?.finalizedAtMs ? s : null; }, { timeoutMs: 15_000 });
  await sleep(1500);
  await shot("07-approved");
  const vers = readJson(join(UD, "versions.json"))?.[jobId];
  verdict("approve", true, { finalizedAtMs: row.finalizedAtMs, v1Approved: vers?.versions?.find((v) => v.n === 1)?.approved, finals: vers?.finals?.map((f) => ({ n: f.n, via: f.via, madeFinalAtMs: f.madeFinalAtMs })) });
  // original: the first approval starts the taste-capture follow-up turn. The original renderer renders
  // no Stop control while the video is finalized (index-*.js L41911: `!activeFinalized && … "send-btn stop"`),
  // so a user cannot stop it from the UI — the driver lets it run (bounded by --taste-wait-ms) after export.
  const stopVisible = !!(await find("button.send-btn.stop"));
  summary.tasteCapture = { stopControlVisibleWhileFinalized: stopVisible };
  // 8. export ---------------------------------------------------------------------------------
  await click("Download v1.mp4", "button.op-preview-download"); drove("Output panel 'Download v1.mp4' (button.op-preview-download)", "click → original file:saveItemAs → save dialog (answered by env preset)");
  await waitFor("export file", async () => { if (!existsSync(EXPORT)) return null; const a = statSync(EXPORT).size; await sleep(500); return a > 0 && statSync(EXPORT).size === a; }, { timeoutMs: 60_000 });
  await sleep(800);
  await shot("08-exported");
  const jobDir = join(RUN, "Videoclaw", "jobs", jobId);
  const chain = { final: sha(join(jobDir, "final.mp4")), v1: sha(join(jobDir, "versions", "v1.mp4")), export: sha(EXPORT) };
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", EXPORT], { encoding: "utf8" });
  writeFileSync(join(OUT, "export.ffprobe.json"), probe.stdout);
  const pj = JSON.parse(probe.stdout || "{}"); const vs = pj.streams?.find((s) => s.codec_type === "video"); const as = pj.streams?.find((s) => s.codec_type === "audio");
  verdict("export", probe.status === 0 && chain.export === chain.v1 && chain.v1 === chain.final, { sha: chain, ffprobeRc: probe.status, video: vs && `${vs.codec_name} ${vs.width}x${vs.height} ${vs.r_frame_rate}`, audio: as?.codec_name, durationS: pj.format?.duration, saveDialogLog: /save dialog answered/.test(readFileSync(mainLog, "utf8")) });
  summary.sha = chain;

  // 9. taste-capture follow-up turn (original behaviour after the first approval) ------------
  const tTaste = Date.now(); let tasteResult = null; let tasteStarted = false;
  while (Date.now() - tTaste < TASTE_WAIT_MS) {
    const evs2 = events().filter((e) => e.ch === "session:event" && e.payload?.sessionId === sid && Date.parse(e.t) >= row.finalizedAtMs).map((e) => e.payload.event);
    tasteStarted = tasteStarted || evs2.some((e) => e?.kind === "status" && e.status === "running");
    tasteResult = evs2.find((e) => e?.kind === "result") ?? null;
    if (tasteResult || (!tasteStarted && Date.now() - tTaste > 20_000)) break;
    // the taste-capture turn ends in the original AskUserQuestion card (.question-card): answer it from
    // the UI like a user — first option of every question, then "Answer" (permission:respond).
    if (!summary.tasteCapture.cardAnswered) {
      const card = await answerQuestionCard("taste");
      if (card) { summary.tasteCapture.cardAnswered = { questions: card.questions, picked: card.picked }; summary.tasteCapture.answerVerdict = await settleVerdict(card); verdict("taste_question_card", card.verdict.accepted, card.verdict); if (STOP_AFTER === "card") break; }
    }
    await sleep(2000);
  }
  await shot("09-after-taste-turn");
  Object.assign(summary.tasteCapture, { started: tasteStarted, finished: !!tasteResult, isError: tasteResult?.isError ?? null, waitedS: Math.round((Date.now() - tTaste) / 1000), endedBy: tasteResult ? "result" : summary.tasteCapture.cardAnswered && STOP_AFTER === "card" ? "stop-after card (answer acknowledged)" : tasteStarted ? "app quit (teardown) after --taste-wait-ms" : "not started" });
  say(`taste-capture ${JSON.stringify(summary.tasteCapture).slice(0, 800)}`);
} catch (e) {
  if (e?.planned) say(String(e.message)); else { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); }
  try { await shot("99-error"); } catch {}
} finally {
  summary.sessionId = sid; summary.jobId = jobId; summary.consoleErrors = consoleErrors.slice(0, 20);
  // docs/24 (B): the two TypeErrors every M5 run hit (original bundle lines)
  summary.consoleErrorCount = consoleErrors.length;
  summary.knownTypeErrors = { "index-D5K1mOs0.js:31748": consoleFull.filter((m) => /index-D5K1mOs0\.js:31748/.test(m)).length, "index-D5K1mOs0.js:39778": consoleFull.filter((m) => /index-D5K1mOs0\.js:39778/.test(m)).length };
  summary.notDriven = [
    { what: "LLM route selection", why: "the original first-launch picker offers only Codex / Claude Code / credits; the box's only agent route is the PORT-NEW minimax provider route → preset via settings:set before the window opens (VIDEOCLAW_PORT_SMOKE_LLM_ROUTE)" },
    { what: "native GTK save dialog of file:saveItemAs", why: "OS dialog outside the renderer (not a DOM element, not reachable over CDP) → answered by VIDEOCLAW_PORT_SMOKE_SAVE_AS in UI_E2E mode; the renderer's Download button and main's copy are real" },
  ];
  summary.attachVia = ATTACH_VIA; summary.stopAfter = STOP_AFTER ?? null;
  summary.allPass = STOP_AFTER ? Object.values(steps).every((x) => x.ok) && !summary.error : S1_UI_STEPS.length > 0 && ["home", "project_video", "attach", "brief_send", "stream", "reply_link", "play", "approve", "export"].every((k) => steps[k]?.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "ui-e2e-summary.json"), JSON.stringify(summary, null, 1));
  // graceful quit: Browser.close over the browser endpoint (will-quit flushes the registry)
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, (o) => log(o)); await Promise.race([b.send("Browser.close").catch(() => {}), sleep(5000)]); b.close(); } catch {}
  // docs/33: since M16 T3 every quit goes through the original QuitCoordinator — if a turn (e.g. the taste-capture
  // follow-up) is still running, the original native "Videoclaw is still working" dialog blocks Browser.close.
  cdp.close();
  for (let i = 0; i < 40 && !exited; i++) await sleep(250);
  if (!exited && WIN) { say("teardown: app still running after Browser.close → taskkill /T /F"); spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]); for (let i = 0; i < 20 && !exited; i++) await sleep(250); }
  if (!exited) { say("teardown: app still running after Browser.close (QuitCoordinator dialog?) → SIGTERM, then SIGKILL"); try { process.kill(-child.pid, "SIGTERM"); } catch {} for (let i = 0; i < 20 && !exited; i++) await sleep(250); }
  if (!exited) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
  for (const pid of keyringPids) { try { process.kill(pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass}`);
  process.exit(summary.allPass ? 0 : 1);
}
