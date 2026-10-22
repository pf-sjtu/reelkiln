#!/usr/bin/env node
// PORT-NEW docs/35 M18 task 1 — runtime proof of the two push channels that M17 only unit-tested, through the ORIGINAL
// renderer (dev Electron + CDP real mouse input), FAKE-LLM (MINIMAX_API_KEY is a fake string; no model call), $0:
//   L1  fresh profile → home → "New video" (sidebar) → read the account scope (storedKeyId), gateway URL, client/cwd → quit.
//   H   HARNESS (app down): one saved voice prepared through the VERBATIM CharacterVoiceStore (tools/m18-seed-voice.ts,
//       what the not-ported character_voice tool does after its rights card); a candidate engine dist
//       (--dist: engine.manifest.json + tarball of the SAME engine with ENGINE_VERSION bumped; its remotion/hyperframes
//       node_modules are symlinks to the read-only installed engine's — disk budget; .venv is a real `uv sync`).
//   L2  launch with VIDEOCLAW_ENGINE_DIST=<dist> + VIDEOCLAW_PORT_ENGINE_UPDATE_KICK_MS (harness seam: calls the real
//       core.checkForEngineUpdate on a short cadence instead of the 4 h app-update tick).
//     V  Characters → "Saved voices" shows the seeded voice → play its sample (real click; the original enables
//        "Sounds right" only after the sample has played to the end) → click "Sounds right · use for this project" →
//        main emits characters:voices:changed {scope} → the renderer's subscription re-lists (a characters:voices:list
//        call AFTER the approve call — the original's act() never re-lists on success) → "Project voice" chip.
//        Then "Remove…" → "Remove voice" → push again → re-list → the voice is gone.
//     E  background engine update installs the candidate alongside, doctor, flips the pointer while no video runs →
//        main pushes engine:updated {version} → the original's live ".engine-toast" "engine updated — new tricks
//        available" (no relaunch) → settings.lastEngineVersion advanced to the candidate (so the next launch won't repeat).
//   node tools/ui-e2e-m18-pushes.mjs --run RUN --engine RO_ENGINE --dist DIST --seed m18-seed-voice.cjs
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, screenshot } from "./ui-e2e/cdp.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = resolve(opt("--run")); const ENGINE = resolve(opt("--engine")); const DIST = resolve(opt("--dist")); const SEED = resolve(opt("--seed"));
const CDP_PORT = Number(opt("--port", "9398"));
const OUT = join(RUN, `out-m18-pushes-${Date.now()}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "harness.jsonl"); const mainLog = join(OUT, "main.log"); const t0 = Date.now();
const say = (m) => { console.log(`[m18 pushes +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, note: m }) + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const ipcRows = () => { try { return readFileSync(IPC, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const calls = (ch, since = 0) => ipcRows().filter((r) => r.ch === ch && Date.parse(r.t) >= since);
const pushes = (ch) => { try { return readFileSync(mainLog, "utf8").split("\n").filter((l) => l.includes(`[smoke] push ${ch} `)).map((l) => l.replace(/^.*\[smoke\] push \S+ /, "").slice(0, 300)); } catch { return []; } };
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 900)}`); };
const engineVersion = rj(join(ENGINE, "ENGINE_VERSION.json")).version;
const candidate = rj(join(DIST, "engine.manifest.json")).version;
const summary = { llm: "FAKE-LLM (MINIMAX_API_KEY is a fake string; no model call is made)", spendUsd: 0,
  harnessInputs: ["own Xvfb (xvfb-run)", "saved voice prepared through the verbatim CharacterVoiceStore while the app is down (tools/m18-seed-voice.ts)", "fake WAV reference + sample (ffmpeg sine)", `candidate engine dist ${candidate} = the installed ${engineVersion} tarball with ENGINE_VERSION bumped; remotion/hyperframes node_modules symlinked to the read-only engine (disk budget)`, "VIDEOCLAW_PORT_ENGINE_UPDATE_KICK_MS (re-check cadence seam)", "VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1 (doctor's gateway check needs a real key)"],
  engine: { installed: engineVersion, candidate }, started: new Date().toISOString(), steps };
{ let digest = null; try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; if (/^[0-9a-f]{64}$/.test(d)) digest = d; } catch {}
  if (!digest) { const src0 = rj(join(dirname(dirname(ENGINE)), "engine-current.json")); if (src0?.path === ENGINE) digest = src0.buildSha256; }
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ version: engineVersion, path: ENGINE, ...(digest ? { buildSha256: digest } : {}) })); }
const baseEnv = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1",
  VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47738"), VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "6000", MINIMAX_API_KEY: "fake-key-m18-pushes", PYTHONDONTWRITEBYTECODE: "1", VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "gateway" };
for (const k of Object.keys(baseEnv)) if (k.startsWith("__CURSOR_SANDBOX") || /^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete baseEnv[k];
delete baseEnv.VIDEOCLAW_CLAUDE_AGENT_SDK; delete baseEnv.VIDEOCLAW_PORT_SMOKE; delete baseEnv.VIDEOCLAW_ENGINE_DIST;
const DISPLAY_NUM = String(CDP_PORT - 9200);
let app = null; let cdp = null;
const launch = (tag, extra = {}) => {
  const p = spawn("xvfb-run", ["-n", DISPLAY_NUM, "-s", "-screen 0 1440x960x24", join(PORT_DIR, "node_modules", ".bin", "electron"), "--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`, "--autoplay-policy=no-user-gesture-required", PORT_DIR], { cwd: PORT_DIR, env: { ...baseEnv, ...extra }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const st = { proc: p, exited: null, tag };
  p.stdout.on("data", (b) => appendFileSync(mainLog, b)); p.stderr.on("data", (b) => appendFileSync(mainLog, b));
  p.on("exit", (c, s) => { st.exited = { code: c, signal: s, at: Date.now() - t0 }; say(`${tag} exited ${c ?? s}`); });
  say(`${tag} launched pid ${p.pid}`); return st;
};
const ev = (e) => cdp.eval(e);
async function waitFor(desc, fn, { timeoutMs = 30_000, every = 300 } = {}) { const ts = Date.now(); while (Date.now() - ts < timeoutMs) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } throw new Error(`timeout waiting for ${desc}`); }
const rect = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.height && ${text ? `new RegExp(${JSON.stringify(text)}).test((x.innerText || "").trim())` : "true"}; }); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, disabled: !!e.disabled }; })()`);
const click = async (desc, sel, text, o = {}) => { const r = await waitFor(desc, async () => { const q = await rect(sel, text); return q && (!o.enabled || !q.disabled) ? q : null; }, { timeoutMs: o.timeoutMs ?? 30_000 }); appendFileSync(LOG, JSON.stringify({ action: "click", desc, at: r }) + "\n"); await mouseClick(cdp, r.x, r.y); return r; };
const shot = async (n) => { try { writeFileSync(join(SHOTS, `${n}.png`), await screenshot(cdp)); } catch (e) { say(`shot ${n} failed ${e}`); } };
const connect = async () => {
  const page = await waitForPageTarget(CDP_PORT, { timeoutMs: 120_000, match: (t) => t.type === "page" && /app\/out\/renderer\/index\.html$/.test(t.url) });
  cdp = await Cdp.connect(page.webSocketDebuggerUrl, () => {}); await cdp.send("Runtime.enable");
  await waitFor("home", () => ev(`/What are we making today\\?/.test(document.body.innerText)`), { timeoutMs: 90_000 });
  await sleep(1200); if (await rect("button.tour-skip").catch(() => null)) await click("Skip tour", "button.tour-skip");
};
const stop = async (st) => { try { cdp?.close(); } catch {} try { process.kill(-st.proc.pid, "SIGTERM"); } catch {} await waitFor(`${st.tag} exit`, async () => st.exited || null, { timeoutMs: 30_000 }).catch(() => null); await sleep(1500); };
try {
  // ---------------- L1
  app = launch("L1"); await connect(); await shot("L1-home");
  const tNew = Date.now();
  await click("New video", "button.sidebar-new-chat", "New video");
  const created = await waitFor("session:create", async () => calls("session:create", tNew - 500).find((r) => r.ok) ?? null, { timeoutMs: 30_000 }).catch(() => null);
  await sleep(2500); await shot("L1-new-video");
  const reg = rj(join(UD, "sessions.json")) ?? {}; const sess = (reg.sessions ?? []).slice(-1)[0];
  const snap = calls("account:snapshot").filter((r) => r.ok).slice(-1)[0];
  const storedKeyId = snap ? /"storedKeyId":"([0-9a-f]{64})"/.exec(snap.result)?.[1] ?? null : null;
  const step = snap ? /"step":"([a-z-]+)"/.exec(snap.result)?.[1] ?? null : null;
  const settings = rj(join(UD, "settings.json")) ?? {};
  const gatewayUrl = String(settings.gatewayUrl ?? "").replace(/\/+$/, "");
  const clientId = sess?.clientId ?? sess?.meta?.clientId; const cwd = sess?.cwd ?? sess?.meta?.cwd;
  summary.scope = { accountStep: step, storedKeyIdPrefix: storedKeyId?.slice(0, 12), gatewayUrl, clientId, cwd, sessionCreate: !!created, lastEngineVersionL1: settings.lastEngineVersion };
  verdict("L1_setup", step === "ready" && !!storedKeyId && !!gatewayUrl && !!clientId && !!cwd && settings.lastEngineVersion === engineVersion, summary.scope);
  await stop(app);
  if (!steps.L1_setup.ok) throw new Error("L1 setup incomplete");
  // ---------------- H (HARNESS, app down)
  const wavRef = join(RUN, "voice-ref.wav"), wavSample = join(RUN, "voice-sample.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=2", "-ac", "1", "-c:a", "pcm_s16le", wavRef]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-ac", "1", "-c:a", "pcm_s16le", wavSample]);
  const seedOut = execFileSync(process.execPath, [SEED, UD, cwd, clientId, gatewayUrl, storedKeyId, wavRef, wavSample], { encoding: "utf8" }).trim().split("\n").pop();
  const seeded = JSON.parse(seedOut); summary.seed = { ...seeded, file: seeded.file?.replace(RUN, "$RUN") };
  say(`HARNESS seeded voice ${JSON.stringify(summary.seed).slice(0, 400)}`);
  if (!seeded.ok) throw new Error("seed failed");
  // ---------------- L2
  const tL2 = Date.now();
  app = launch("L2", { VIDEOCLAW_ENGINE_DIST: DIST, VIDEOCLAW_PORT_ENGINE_UPDATE_KICK_MS: opt("--kick-ms", "20000"), VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED: "1" });
  await connect(); await shot("L2-home");
  // toast watcher (the original shows .engine-toast for ~8 s)
  const toast = { text: "", at: null, shot: false };
  const watcher = setInterval(async () => { if (toast.text) return; const t = await ev(`(() => { const t = [...document.querySelectorAll(".engine-toast")].map((e) => e.innerText.trim()).filter((x) => /engine updated/.test(x)); return t[0] ?? ""; })()`).catch(() => ""); if (t && !toast.text) { toast.text = t; toast.at = Date.now() - t0; await shot("E-toast-live"); toast.shot = true; } }, 250);
  // V
  await click("Characters (sidebar)", "button.you-entry", "^Characters$");
  await waitFor("Saved voices", () => rect("section.char-voices h3", "^Saved voices$"), { timeoutMs: 20_000 });
  await waitFor("seeded voice card", () => rect("section.char-voices .approval-card strong", "Ada \\(M18 harness\\)"), { timeoutMs: 20_000 });
  await shot("V1-pending");
  const audio = await rect("section.char-voices audio");
  let heard = false;
  const audioState = () => ev(`(() => { const a = document.querySelector("section.char-voices audio"); return a ? { paused: a.paused, ended: a.ended, t: a.currentTime, err: a.error ? a.error.code : null, ready: a.readyState } : null; })()`);
  summary.sampleAttempts = [];
  for (let attempt = 1; audio && attempt <= 4 && !heard; attempt++) {
    // the native <audio controls> play button sits at the left edge of the control strip (real mouse click)
    const a = await rect("section.char-voices audio");
    await mouseClick(cdp, Math.round(a.x - a.w / 2 + 16), Math.round(a.y));
    heard = !!(await waitFor("approve enabled after the sample played", async () => { const b = await rect("section.char-voices button.approve-yes"); return b && !b.disabled ? b : null; }, { timeoutMs: 8_000 }).catch(() => null));
    summary.sampleAttempts.push({ attempt, heard, audio: await audioState().catch(() => null) });
    if (!heard) { await shot(`V1-play-attempt-${attempt}`); await sleep(1000); }
  }
  summary.sampleHeard = heard;
  const tApprove = Date.now();
  if (heard) await click("Sounds right · use for this project", "section.char-voices button.approve-yes", "Sounds right", { enabled: true });
  const approveRow = heard ? await waitFor("approve call", async () => calls("characters:voice:approve", tApprove - 200).find((r) => r.ok) ?? null, { timeoutMs: 15_000 }).catch(() => null) : null;
  await sleep(1500);
  const relistAfterApprove = approveRow ? calls("characters:voices:list").filter((r) => Date.parse(r.t) >= Date.parse(approveRow.t) - 50 && r !== approveRow).length : 0;
  const chip = await rect("section.char-voices .char-chip", "^Project voice$").catch(() => null);
  await shot("V2-approved");
  const pushV1 = pushes("characters:voices:changed");
  verdict("V_approve_push", heard && !!approveRow && approveRow.real !== false && pushV1.length >= 1 && pushV1[0].includes(storedKeyId) && relistAfterApprove >= 1 && !!chip, { sampleHeard: heard, approve: approveRow ? { ok: approveRow.ok, real: approveRow.real } : null, pushes: pushV1.map((p) => p.replace(storedKeyId, storedKeyId.slice(0, 12) + "…")), relistAfterApprove, projectVoiceChip: !!chip });
  const tRemove = Date.now();
  await click("Remove…", "section.char-voices button.approve-no", "^Remove…$");
  await click("Remove voice", ".remove-dialog button.remove-confirm", "^Remove voice$");
  const removeRow = await waitFor("remove call", async () => calls("characters:voice:remove", tRemove - 200).find((r) => r.ok) ?? null, { timeoutMs: 15_000 }).catch(() => null);
  const gone = await waitFor("voice card gone", async () => !(await rect("section.char-voices .approval-card strong", "Ada \\(M18 harness\\)")), { timeoutMs: 15_000 }).catch(() => false);
  await sleep(1000);
  const relistAfterRemove = removeRow ? calls("characters:voices:list").filter((r) => Date.parse(r.t) >= Date.parse(removeRow.t) - 50).length : 0;
  const pushV2 = pushes("characters:voices:changed");
  await shot("V3-removed");
  const voicesFile = rj(seeded.file);
  verdict("V_remove_push", !!removeRow && pushV2.length >= pushV1.length + 1 && relistAfterRemove >= 1 && gone && (voicesFile?.voices ?? []).length === 0, { remove: removeRow ? { ok: removeRow.ok, real: removeRow.real } : null, pushesTotal: pushV2.length, relistAfterRemove, cardGone: gone, voicesOnDisk: (voicesFile?.voices ?? []).length });
  // close the panel so the toast host is visible
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {}); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
  // E
  const flipped = await waitFor("engine:updated push", async () => pushes("engine:updated")[0] ?? null, { timeoutMs: Number(opt("--update-timeout-ms", "900000")), every: 2000 }).catch(() => null);
  await waitFor("live toast", async () => toast.text || null, { timeoutMs: 15_000 }).catch(() => null);
  clearInterval(watcher);
  await sleep(1000);
  const s2 = rj(join(UD, "settings.json")) ?? {}; const ptr = rj(join(UD, "engine-current.json")) ?? {};
  const updLog = readFileSync(mainLog, "utf8").split("\n").filter((l) => /\[engine-update\]|engine updated →|HARNESS: engine update/.test(l)).slice(-12).map((l) => l.slice(0, 240));
  const sameProcess = !app.exited;
  summary.engineUpdate = { push: flipped, toast: toast.text || null, toastAtMs: toast.at, lastEngineVersion: s2.lastEngineVersion, pointer: { version: ptr.version, previous: ptr.previous?.version ?? null, path: ptr.path?.replace(RUN, "$RUN") }, sameProcessNoRelaunch: sameProcess, log: updLog };
  verdict("E_engine_updated_live", !!flipped && flipped.includes(candidate) && /engine updated — new tricks available/.test(toast.text) && s2.lastEngineVersion === candidate && ptr.version === candidate && ptr.previous?.version === engineVersion && sameProcess, summary.engineUpdate);
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrors = undefined;
  summary.allPass = !summary.error && ["L1_setup", "V_approve_push", "V_remove_push", "E_engine_updated_live"].every((k) => steps[k]?.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m18-pushes-summary.json"), JSON.stringify(summary, null, 1));
  if (app && !app.exited) await stop(app);
  say(`DONE allPass=${summary.allPass} ${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")} out=${OUT}`);
  process.exit(summary.allPass ? 0 : 1);
}
