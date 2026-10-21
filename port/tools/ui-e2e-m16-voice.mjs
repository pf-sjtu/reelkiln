#!/usr/bin/env node
// PORT-NEW docs/33 M16 task 2 — the voice cards through the ORIGINAL renderer with real CDP input:
//   V1 recorder_card: request_voiceover → RecorderCard (media:requestMic → getUserMedia → AudioWorklet capture →
//      encodeWav) → Record → Start now → Stop → "Use this take" → input:respond → WAV written into the job.
//   V2 composer_voice_note: composer "Record a voice note" → media:voiceDictationStatus (the original's on-device
//      transcription helper is absent on Linux → {available:false, attach:true, "On-device transcription is
//      unavailable…"}; Transcribe disabled) → Stop recording → "Attach as audio" → attachment:voiceNote (ffmpeg → WAV).
// The microphone is Chromium's fake capture device fed from a WAV file (harness input, see appArgs).
//   node tools/ui-e2e-m16-voice.mjs --run RUN --engine ENGINE_DIR [--port 9391] [--fake-wav file.wav] [--only V1|V2]
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot, dropFiles } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PHASE = opt("--phase", "voice");
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
const OUT = join(RUN, `out-m16-${PHASE}-${RUNIDX}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[m16 ${PHASE} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
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
// HARNESS INPUT ONLY (not app code): Chromium's fake capture device plays FAKE_WAV as the microphone; the permission
// prompt is auto-accepted by Chromium's fake UI. Everything after getUserMedia is the original renderer + port main.
const FAKE_WAV = resolve(opt("--fake-wav") ?? join(RUN, "fake-mic.wav"));
if (!existsSync(FAKE_WAV)) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=8", "-af", "volume=0.5,tremolo=f=3:d=0.6", "-ac", "1", "-c:a", "pcm_s16le", FAKE_WAV]);
const appArgs = ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${FAKE_WAV}`];
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
const summary = { phase: PHASE, llmUpstream: LLM_UPSTREAM, micInput: "HARNESS: Chromium --use-fake-device-for-media-stream + --use-file-for-fake-audio-capture=" + FAKE_WAV.split("/").pop(), started: new Date().toISOString(), steps, code: CODE };
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

const ffprobe = (f) => { try { return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample:format=duration,format_name", "-of", "json", f]).toString()); } catch (e) { return { error: String(e).slice(0, 200) }; } };
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
summary.fakeMic = { file: FAKE_WAV.split("/").pop(), sha256: sha(FAKE_WAV).slice(0, 16), probe: ffprobe(FAKE_WAV) };
let sid, job;
try {
  summary.landing = await landing(); say(`landing ${summary.landing}`); await shot("00-landing");
  await waitFor("account ready", async () => ipcCalls("account:snapshot").some((r) => r.ok && field(r.result, "step") === "ready") || null, { timeoutMs: 30_000 }).catch(() => null);
  const c = await newVideo(); sid = c.sessionId; summary.session = sid; summary.llmRoute = c.llmRoute;
  job = await bindTurn(sid); summary.job = job;
  if (ONLY !== "V2") await step("recorder_card", async () => {
    const r0 = results(sid).length; const mic0 = ipcCalls("media:requestMic").length;
    const SCRIPT = "欢迎来到海边小镇，今天我们一起看日出。";
    await sendTurn(`现在只做一件事：调用 request_voiceover 工具一次，script 为 "${SCRIPT}"，dest_dir 为 "jobs/${job}/audio"。不要调用任何其他工具，不要读写文件。工具返回后只回复保存的文件路径和 ${CODE}`);
    await waitFor("recorder card", () => find(".recorder-card"), { timeoutMs: 6 * 60_000, every: 1000 });
    await waitFor("Record button enabled", () => cdp.eval(`(() => { const b = document.querySelector(".recorder-card button.rec-primary"); return !!b && !b.disabled && /^Record$/.test(b.innerText.trim()); })()`), { timeoutMs: 30_000 });
    const cardBefore = await cardText(".recorder-card"); await shot("V1a-recorder-card");
    await click("Record", ".recorder-card button.rec-primary", { text: "^Record$" });
    await waitFor("countdown", () => find(".recorder-card .rec-countdown"), { timeoutMs: 10_000 }).catch(() => null); await shot("V1b-countdown");
    await click("Start now", ".recorder-card button.rec-primary", { text: "Start now" }).catch(() => null);
    await waitFor("recording", () => find(".recorder-card button.rec-primary.recording"), { timeoutMs: 15_000 });
    await sleep(3500); await shot("V1c-recording");
    await click("Stop", ".recorder-card button.rec-primary.recording");
    await waitFor("take", () => find(".recorder-card button.ic-save"), { timeoutMs: 15_000 }); const take = await cardText(".recorder-card .ic-take-name");
    await sleep(1500); await shot("V1d-take");
    await click("Use this take", ".recorder-card button.ic-save", { text: "^Use this take$" });
    await waitFor("voiceover turn result", async () => results(sid).length > r0 || null, { timeoutMs: 5 * 60_000, every: 1000 });
    await waitIdle(sid, 60_000).catch(() => null); await sleep(1500); await shot("V1e-after");
    const r = sessRow(sid); const dir = join(r.cwd, "jobs", job, "audio");
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const wav = files.find((f) => /\.wav$/.test(f));
    const probe = wav ? ffprobe(join(dir, wav)) : null;
    const head = wav ? readFileSync(join(dir, wav)).subarray(0, 12).toString("latin1") : "";
    const respond = ipcCalls("input:respond").slice(-1)[0];
    const tools = sessEvents(sid).filter((e) => e.kind === "tool_start").map((e) => e.toolName ?? e.name).slice(-3);
    const reply = sessEvents(sid).filter((e) => e.kind === "assistant_text").map((e) => e.text).slice(-1)[0];
    summary.recorder = { cardBefore, take, requestMicCalls: ipcCalls("media:requestMic").length - mic0, inputRespond: respond ? { ok: respond.ok, args: String(respond.args).slice(0, 160) } : null,
      files, wav: wav ? { name: wav, bytes: readFileSync(join(dir, wav)).length, sha256: sha(join(dir, wav)).slice(0, 16), riff: head.slice(0, 4) + "/" + head.slice(8, 12), probe } : null, tools, settled: settled(sid).slice(-1), reply: String(reply ?? "").slice(0, 200) };
    const st = probe?.streams?.[0];
    verdict("recorder_card", !!wav && head.startsWith("RIFF") && st?.sample_rate === "48000" && Number(probe?.format?.duration) > 2 && tools.some((t) => /request_voiceover/.test(String(t))) && summary.recorder.requestMicCalls >= 1 && respond?.ok === true, summary.recorder);
  });
  if (ONLY !== "V1") await step("composer_voice_note", async () => {
    const st0 = ipcCalls("media:voiceDictationStatus").length;
    await click("Record a voice note", "button", { aria: "^Record a voice note" });
    await waitFor("voice note recording", () => find(".voice-note.recording"), { timeoutMs: 20_000 });
    await sleep(3200); await shot("V2a-voice-note-recording");
    await click("Stop recording", ".voice-note button.voice-note-btn.primary", { text: "Stop recording" });
    const attachBtn = await waitFor("Attach as audio", () => find(".voice-note button.voice-note-btn", { text: "^Attach as audio$" }), { timeoutMs: 15_000 });
    const panel = await cardText(".voice-note");
    const transcribeDisabled = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".voice-note button.voice-note-btn")].find((x) => /^Transcribe$/.test(x.innerText.trim())); return b ? { disabled: b.disabled, title: b.title || null } : null; })()`);
    await shot("V2b-voice-note-ready");
    const status = ipcCalls("media:voiceDictationStatus").slice(st0).slice(-1)[0];
    const n0 = ipcCalls("attachment:voiceNote").length;
    await click("Attach as audio", ".voice-note button.voice-note-btn", { text: "^Attach as audio$" });
    const staged = await waitFor("attachment:voiceNote", async () => ipcCalls("attachment:voiceNote").slice(n0)[0] ?? null, { timeoutMs: 20_000 });
    await sleep(1200); await shot("V2c-voice-note-attached");
    const chip = await cdp.eval(`(() => { const t = document.body.innerText.match(/Voice note [0-9:]+\\.wav/); return t ? t[0] : null; })()`);
    const ud = UD; const intake = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/^voice-note-.*\.wav$/.test(e.name)) intake.push(p); } }; try { walk(ud); } catch {}
    const wav = intake.slice(-1)[0];
    summary.voiceNote = { statusIpc: status ? { ok: status.ok, result: String(status.result).slice(0, 220) } : null, panel, transcribeDisabled, attachIpc: { ok: staged.ok, result: String(staged.result ?? staged.error ?? "").replace(/\/[^"]*\//g, "<dir>/").slice(0, 300) }, chip,
      wav: wav ? { name: wav.split("/").pop(), bytes: readFileSync(wav).length, sha256: sha(wav).slice(0, 16), probe: ffprobe(wav) } : null };
    // send the staged voice note with a text turn: the original copies it into the job's incoming/ on send
    const r1 = results(sid).length;
    await sendTurn(`只回复 OK ${CODE}。不要调用任何工具。`);
    await waitFor("voice-note turn result", async () => results(sid).length > r1 || null, { timeoutMs: 4 * 60_000, every: 1000 });
    await waitIdle(sid, 60_000).catch(() => null); await sleep(1200); await shot("V2d-voice-note-sent");
    const r = sessRow(sid); const incDir = r?.cwd && r?.jobId ? join(r.cwd, "jobs", r.jobId, "incoming") : null; const inc = incDir && existsSync(incDir) ? readdirSync(incDir) : []; const incWav = inc.find((f) => /\.wav$/i.test(String(f)));
    const incPath = incWav && r?.cwd ? join(r.cwd, "jobs", r.jobId, "incoming", String(incWav)) : null;
    summary.voiceNote.sent = { incoming: inc, wav: incPath && existsSync(incPath) ? { sha256: sha(incPath).slice(0, 16), sameAsIntake: !!wav && sha(incPath) === sha(wav), probe: ffprobe(incPath) } : null,
      lastUserMsg: String(sessEvents(sid).filter((e) => e.kind === "user_message").map((e) => JSON.stringify(e)).slice(-1)[0] ?? "").slice(0, 400) };
    verdict("composer_voice_note", !!summary.voiceNote.sent.wav && status?.ok && /"available":false/.test(status.result) && /"attach":true/.test(status.result) && /On-device transcription is unavailable/.test(status.result) && transcribeDisabled?.disabled === true && staged.ok === true && !!chip && !!wav && summary.voiceNote.wav.probe?.streams?.[0]?.codec_name?.startsWith("pcm"), summary.voiceNote);
  });
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.ledgerAtEnd = (() => { const L = ledger(); return L && { entries: L.entries.length, usd: L.entries.reduce((a, e) => a + e.usd, 0) }; })();
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 12);
  summary.ipcChannels = [...new Set(ipcRows().map((r) => r.ch))].sort();
  summary.allPass = !summary.error && Object.values(steps).length > 0 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m16-voice-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 60 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} steps=${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")}`);
  process.exit(summary.allPass ? 0 : 1);
}
