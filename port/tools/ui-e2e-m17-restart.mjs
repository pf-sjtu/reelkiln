#!/usr/bin/env node
// PORT-NEW docs/34 M17 task 1 — runtime proof of engine:pendingToast, window:state and app:restart on the PACKAGED
// AppImage through the ORIGINAL renderer (CDP, own Xvfb so the relaunched app keeps a display):
//   A  fresh profile → launch → engine:pendingToast() = null, no .engine-toast; Browser fullscreen → window:state push →
//      the original's `.app.fullscreen` class; leave → class gone; SIGTERM.
//   H  HARNESS (labelled, app is down): settings.json lastEngineVersion := an older version; append a harness `vc_` key
//      (id = sha256) to the local-gateway ledger so verifyGatewayKey succeeds.
//   B  launch → engine:pendingToast() = {version} and the original ".engine-toast" "engine updated — new tricks available";
//      Settings → Billing & credits → paste key → Save → "Saved for next launch…" → "Restart now" → app:restart →
//      the process exits and Electron relaunches the AppImage itself (relaunchOptions, VIDEOCLAW_PORT_RESTART_REAL=1).
//   C  the relaunched process answers CDP → pendingToast null, no toast, the new key is the stored key.
// No model calls: MINIMAX_API_KEY is a fake ("FAKE-LLM"); spend $0.
//   node tools/ui-e2e-m17-restart.mjs --run RUN --app X.AppImage --engine ENGINE_DIR
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { Cdp, waitForPageTarget, mouseClick, typeText, screenshot } from "./ui-e2e/cdp.mjs";

const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = resolve(opt("--run")); const APP = resolve(opt("--app")); const ENGINE = resolve(opt("--engine"));
const CDP_PORT = Number(opt("--port", "9397")); const DISPLAY = `:${opt("--display", "197")}`;
const OUT = join(RUN, `out-m17-restart-${Date.now()}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const APPS = join(RUN, "apps"); mkdirSync(APPS, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "harness.jsonl"); const t0 = Date.now();
const say = (m) => { console.log(`[m17 restart +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, note: m }) + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const rj = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const ipcRows = () => { try { return readFileSync(IPC, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 900)}`); };
const summary = { llm: "FAKE-LLM (MINIMAX_API_KEY is a fake string; no model call is made)", harnessInputs: ["own Xvfb", "own dbus session + gnome-keyring-daemon", "--password-store=gnome-libsecret", "HARNESS edit of settings.json lastEngineVersion while the app is down", "HARNESS-issued vc_ key appended to the local-gateway ledger (hash only) + its alpha-consent record in settings.json", "VIDEOCLAW_PORT_RESTART_REAL=1"], started: new Date().toISOString(), steps };

const appCopy = join(APPS, basename(APP)); copyFileSync(APP, appCopy); chmodSync(appCopy, 0o755);
summary.app = { file: basename(appCopy), sha256: sha(appCopy).slice(0, 16) };
const UD = join(RUN, ".config", "videoclaw-port"); mkdirSync(UD, { recursive: true });
const engineVersion = rj(join(ENGINE, "ENGINE_VERSION.json")).version;
{ let digest = null; try { const d = readFileSync(join(ENGINE, ".videoclaw-build-sha256"), "utf8").trim().split(/\s+/)[0]; if (/^[0-9a-f]{64}$/.test(d)) digest = d; } catch {}
  writeFileSync(join(UD, "engine-current.json"), JSON.stringify({ version: engineVersion, path: ENGINE, ...(digest ? { buildSha256: digest } : {}) })); }
summary.engine = { version: engineVersion, path: ENGINE };
const procs = [];
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1440x960x24", "-nolisten", "tcp"], { stdio: "ignore", detached: true }); procs.push(xvfb);
const busAddr = execFileSync("dbus-daemon", ["--session", "--fork", "--print-address=1", "--print-pid=1"]).toString().trim().split("\n");
const DBUS = busAddr[0]; const dbusPid = Number(busAddr[1]);
const keyring = execFileSync("bash", ["-c", "printf 'm17-harness' | gnome-keyring-daemon --unlock --components=secrets"], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: DBUS, HOME: RUN, DISPLAY } }).toString();
const keyringPid = Number(/GNOME_KEYRING_PID=(\d+)/.exec(keyring)?.[1] ?? 0);
const xshot = (n) => { try { execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "x11grab", "-video_size", "1440x960", "-i", DISPLAY, "-frames:v", "1", join(SHOTS, `${n}.png`)], { env: { ...process.env, DISPLAY } }); } catch (e) { say(`xshot ${n} failed ${String(e).slice(0, 120)}`); } };
const env = { ...process.env, HOME: RUN, DISPLAY, APPIMAGE_EXTRACT_AND_RUN: "1", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47737"),
  VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000", VIDEOCLAW_PORT_RESTART_REAL: "1",
  MINIMAX_API_KEY: "fake-key-m17-restart", PYTHONDONTWRITEBYTECODE: "1", DBUS_SESSION_BUS_ADDRESS: DBUS, VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "gateway" };
for (const k of Object.keys(env)) if (k.startsWith("__CURSOR_SANDBOX") || /^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete env[k];
const mainLog = join(OUT, "main.log");
const launch = (tag) => {
  const p = spawn(appCopy, ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`, "--password-store=gnome-libsecret"], { cwd: RUN, env, stdio: ["ignore", "pipe", "pipe"], detached: true }); procs.push(p);
  const st = { proc: p, exited: null };
  p.stdout.on("data", (b) => appendFileSync(mainLog, b)); p.stderr.on("data", (b) => appendFileSync(mainLog, b));
  p.on("exit", (c, s) => { st.exited = { code: c, signal: s, at: Date.now() - t0 }; say(`${tag} exited ${c ?? s}`); });
  say(`${tag} launched pid ${p.pid}`); return st;
};
let cdp;
const ev = (e) => cdp.eval(e);
async function waitFor(desc, fn, { timeoutMs = 30_000, every = 300 } = {}) { const ts = Date.now(); while (Date.now() - ts < timeoutMs) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } throw new Error(`timeout waiting for ${desc}`); }
const rect = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.height && ${text ? `new RegExp(${JSON.stringify(text)}).test(x.innerText.trim())` : "true"}; }); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: e.innerText.trim(), disabled: !!e.disabled }; })()`);
const click = async (desc, sel, text) => { const r = await waitFor(desc, () => rect(sel, text), { timeoutMs: 30_000 }); appendFileSync(LOG, JSON.stringify({ action: "click", desc, at: r }) + "\n"); await mouseClick(cdp, r.x, r.y); return r; };
const shot = async (n) => { try { writeFileSync(join(SHOTS, `${n}.png`), await screenshot(cdp)); } catch { xshot(n); } };
const toastText = () => ev(`(() => { const t = [...document.querySelectorAll(".engine-toast")].map((e) => e.innerText.trim()).filter((x) => /engine updated/.test(x)); return t[0] ?? ""; })()`);
const calls = (ch, since = 0) => ipcRows().filter((r) => r.ch === ch && Date.parse(r.t) >= since);
// connect + watch for the 8 s toast from the very first paint
async function connect(tag) {
  const page = await waitForPageTarget(CDP_PORT, { timeoutMs: 120_000, match: (t) => t.type === "page" && /index\.html/.test(t.url) });
  cdp = await Cdp.connect(page.webSocketDebuggerUrl, () => {}); await cdp.send("Runtime.enable");
  const seen = { toast: "", at: null };
  const tStart = Date.now();
  while (Date.now() - tStart < 90_000) {
    const [t, home] = await Promise.all([toastText().catch(() => ""), ev(`/What are we making today\\?/.test(document.body.innerText)`).catch(() => false)]);
    if (t && !seen.toast) { seen.toast = t; seen.at = Date.now() - t0; await shot(`${tag}-toast`); }
    if (home && Date.now() - tStart > 2500) break;
    await sleep(150);
  }
  // keep watching a little longer (pendingToast resolves right after mount)
  for (let i = 0; i < 20 && !seen.toast; i++) { const t = await toastText().catch(() => ""); if (t) { seen.toast = t; seen.at = Date.now() - t0; await shot(`${tag}-toast`); } await sleep(150); }
  if (await rect("button.tour-skip").catch(() => null)) await click("Skip tour", "button.tour-skip");
  return seen;
}
const pendingToastResults = (since) => calls("engine:pendingToast", since).map((r) => ({ ok: r.ok, real: r.real, result: r.result }));
try {
  // ---------------- A
  const tA = Date.now(); const A = launch("A");
  const seenA = await connect("A"); await shot("A-home");
  const ptA = await waitFor("A pendingToast call", async () => (pendingToastResults(tA).length ? pendingToastResults(tA) : null), { timeoutMs: 20_000 });
  const sA = rj(join(UD, "settings.json")) ?? {};
  verdict("A_no_toast_fresh_profile", !seenA.toast && ptA.every((r) => r.ok && r.real && r.result === "null") && sA.lastEngineVersion === engineVersion, { pendingToast: ptA, toast: seenA.toast || null, lastEngineVersion: sA.lastEngineVersion });
  // window:state via a real BrowserWindow fullscreen (CDP Browser.setWindowBounds → Electron enter-full-screen)
  {
    // Electron has no Browser.getWindowForTarget: toggle the real BrowserWindow with the default menu's F11
    // (role togglefullscreen) sent through X; fall back to the HTML fullscreen API with a CDP user gesture.
    const before = await ev(`document.querySelector(".app")?.className ?? null`);
    const xkey = (k) => { try { const w = execFileSync("xdotool", ["search", "--name", "Videoclaw"], { env: { ...process.env, DISPLAY } }).toString().trim().split("\n")[0]; execFileSync("xdotool", ["windowfocus", "--sync", w], { env: { ...process.env, DISPLAY } }); execFileSync("xdotool", ["key", "--window", w, k], { env: { ...process.env, DISPLAY } }); return true; } catch (e) { say(`xdotool ${k}: ${String(e).slice(0, 120)}`); return false; } };
    const isOn = async () => (await ev(`document.querySelector(".app.fullscreen") ? document.querySelector(".app").className : null`)) || null;
    let method = "F11 (default menu togglefullscreen)";
    xkey("F11");
    let on = await waitFor(".app.fullscreen", isOn, { timeoutMs: 8_000 }).catch(() => null);
    if (!on) { method = "document.documentElement.requestFullscreen() (CDP userGesture)"; await cdp.send("Runtime.evaluate", { expression: "document.documentElement.requestFullscreen()", userGesture: true, awaitPromise: true }).catch((e) => say(`requestFullscreen ${e}`)); on = await waitFor(".app.fullscreen", isOn, { timeoutMs: 8_000 }).catch(() => null); }
    await shot("A-fullscreen"); xshot("A-fullscreen-x11");
    if (method.startsWith("F11")) xkey("F11"); else await cdp.send("Runtime.evaluate", { expression: "document.exitFullscreen()", awaitPromise: true }).catch(() => null);
    const off = await waitFor("leave fullscreen", async () => (await ev(`document.querySelector(".app") && !document.querySelector(".app.fullscreen") ? "ok" : null`)) || null, { timeoutMs: 15_000 }).catch(() => null);
    const pushes = readFileSync(mainLog, "utf8").split("\n").filter((l) => /\[smoke\] push window:state/.test(l)).map((l) => l.replace(/^.*push /, "").slice(0, 80));
    verdict("A_window_state", /\bapp\b/.test(before ?? "") && !/fullscreen/.test(before ?? "") && !!on && !!off && pushes.some((p) => /"fullscreen":true/.test(p)) && pushes.some((p) => /"fullscreen":false/.test(p)), { method, classBefore: before, classFullscreen: on, leftFullscreen: !!off, pushes });
  }
  try { cdp.close(); } catch {}
  try { process.kill(-A.proc.pid, "SIGTERM"); } catch {}
  await waitFor("A exit", async () => A.exited || null, { timeoutMs: 30_000 }).catch(() => null);
  await sleep(2000);
  // ---------------- H (HARNESS, app down)
  const OLD_ENGINE = "0.1.56-m17-harness";
  const settingsPath = join(UD, "settings.json"); const s0 = rj(settingsPath); s0.lastEngineVersion = OLD_ENGINE; writeFileSync(settingsPath, JSON.stringify(s0, null, 2));
  const ledgerPath = join(UD, "local-gateway", "ledger.json"); const L = rj(ledgerPath);
  const harnessKey = `vc_${randomBytes(20).toString("hex")}`; const harnessId = createHash("sha256").update(harnessKey).digest("hex");
  // HARNESS: the alpha agreement already accepted for this key (alphaConsentKeyId L5161, KEY_ID_DOMAIN L5156). Without
  // it the original resolves the new manual key to step "signed-out" (legacyKeyOnly needs hasLocalConsent) → Welcome screen.
  const consentId = createHash("sha256").update("videoclaw-alpha-consent-key/v1\0").update(String(s0.gatewayUrl).trim().replace(/\/+$/, "")).update("\0").update(harnessKey).digest("hex");
  s0.alphaConsentsByKey = { ...(s0.alphaConsentsByKey ?? {}), [consentId]: { acceptedAt: Date.now(), beaconQueuedAt: Date.now() } }; writeFileSync(settingsPath, JSON.stringify(s0, null, 2));
  L.keys.push({ id: harnessId, hint: `${harnessKey.slice(0, 7)}…${harnessKey.slice(-4)}`, createdAt: Date.now() }); writeFileSync(ledgerPath, JSON.stringify(L, null, 2));
  summary.harness = { lastEngineVersionSetTo: OLD_ENGINE, ledgerKeys: L.keys.map((k) => ({ id: k.id.slice(0, 12) + "…", hint: k.hint.slice(0, 5) + "…" })), harnessKeyId: harnessId.slice(0, 12) + "…" };
  say(`HARNESS lastEngineVersion=${OLD_ENGINE}, harness key id ${harnessId.slice(0, 12)}…`);
  // ---------------- B
  const tB = Date.now(); const B = launch("B");
  const seenB = await connect("B");
  const ptB = await waitFor("B pendingToast call", async () => (pendingToastResults(tB).length ? pendingToastResults(tB) : null), { timeoutMs: 20_000 });
  const sB = rj(settingsPath) ?? {};
  verdict("B_pending_toast", /engine updated — new tricks available/.test(seenB.toast) && ptB.some((r) => r.ok && r.real && JSON.parse(r.result)?.version === engineVersion) && sB.lastEngineVersion === engineVersion, { pendingToast: ptB, toast: seenB.toast, toastAtMs: seenB.at, lastEngineVersionAfter: sB.lastEngineVersion });
  // Settings → Billing & credits → key → Save → Restart now
  await click("profile button", "button.profile-button"); await sleep(400);
  await click("Settings", "button[role='menuitem']", "^Settings$");
  await waitFor("Settings", () => rect("h2", "^Account$"), { timeoutMs: 15_000 });
  await click("Billing & credits nav", "button", "^Billing & credits$").catch(() => null); await sleep(900);
  await click("key input", "#settings-billing input.am-input");
  await typeText(cdp, harnessKey); await sleep(300);
  await click("Save", "#settings-billing button.am-save", "^Save$");
  const status = await waitFor("save status", async () => (await ev(`document.querySelector("#settings-billing .am-status")?.innerText ?? ""`)) || null, { timeoutMs: 30_000 });
  const restartBtn = await waitFor("Restart now", () => rect("#settings-billing button.am-save", "^Restart now$"), { timeoutMs: 20_000 }).catch(() => null);
  await shot("B-restart-now");
  const verify = calls("gateway:verify", tB).concat(calls("settings:saveGatewayKey", tB)).map((r) => ({ ch: r.ch, ok: r.ok, real: r.real, result: String(r.result).slice(0, 160) }));
  verdict("B_save_key", /Saved for next launch as /.test(status) && !!restartBtn, { status, verify, restartButton: !!restartBtn });
  const tRestart = Date.now();
  await click("Restart now", "#settings-billing button.am-save", "^Restart now$");
  try { cdp.close(); } catch {}
  await waitFor("B exit", async () => B.exited || null, { timeoutMs: 60_000 }).catch(() => null);
  const restartRows = calls("app:restart", tRestart - 1000).map((r) => ({ ok: r.ok, real: r.real, result: r.result }));
  // ---------------- C (relaunched by Electron, not by this harness)
  await sleep(3000);
  const psRows = () => execFileSync("ps", ["-eo", "pid,ppid,etimes,args"]).toString().split("\n").filter((l) => (l.includes(appCopy) || /appimage_extracted_|\.mount_/.test(l)) && !l.includes("ui-e2e-m17-restart")).map((l) => l.trim().replace(/\s+/g, " ").slice(0, 220));
  const relaunched = await waitFor("relaunched process", async () => { const r = psRows(); return r.length ? r : null; }, { timeoutMs: 60_000, every: 1000 }).catch(() => []);
  const tC = Date.now();
  const seenC = await connect("C").catch((e) => ({ error: String(e) }));
  await sleep(1500); await shot("C-home");
  const ptC = pendingToastResults(tRestart + 1500);
  const ipcAfter = [...new Set(ipcRows().filter((r) => Date.parse(r.t) > tRestart + 1500).map((r) => r.ch))];
  const snap = calls("account:snapshot", tC - 30_000).filter((r) => r.ok).slice(-1)[0];
  const storedKeyId = snap ? /"storedKeyId":"([0-9a-f]+)"/.exec(snap.result)?.[1] ?? null : null;
  const restartLog = readFileSync(mainLog, "utf8").split("\n").filter((l) => /\[restart\]|quit: begin shutdown|\[quit\]/.test(l)).slice(-6).map((l) => l.slice(0, 200));
  summary.restart = { appRestartIpc: restartRows, oldExit: B.exited, relaunched, restartLog, ipcChannelsAfterRestart: ipcAfter.slice(0, 25) };
  verdict("C_app_restart_relaunch", restartRows.some((r) => r.ok && r.real) && !!B.exited && B.exited.code === 0 && relaunched.length > 0 && !seenC.error && ipcAfter.length > 0, summary.restart);
  verdict("C_no_toast_after_restart", !seenC.error && !seenC.toast && ptC.length > 0 && ptC.every((r) => r.ok && r.result === "null"), { pendingToast: ptC, toast: seenC.toast ?? null, storedKeyIdPrefix: storedKeyId?.slice(0, 12) ?? null, harnessKeyIdPrefix: harnessId.slice(0, 12), storedKeyIsHarnessKey: storedKeyId === harnessId });
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { xshot("99-error"); } catch {} }
finally {
  summary.allPass = !summary.error && Object.keys(steps).length === 6 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m17-restart-summary.json"), JSON.stringify(summary, null, 1));
  try { for (const l of execFileSync("ps", ["-eo", "pid,args"]).toString().split("\n")) { const m = /^\s*(\d+)\s+(.*)$/.exec(l); if (m && Number(m[1]) !== process.pid && (m[2].startsWith(appCopy) || m[2].includes(`--user-data-dir=${UD}`))) { try { process.kill(Number(m[1]), "SIGTERM"); } catch {} } } } catch {}
  await sleep(1500);
  for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
  for (const pid of [keyringPid, dbusPid]) { try { if (pid) process.kill(pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} ${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")} out=${OUT}`);
  process.exit(summary.allPass ? 0 : 1);
}
