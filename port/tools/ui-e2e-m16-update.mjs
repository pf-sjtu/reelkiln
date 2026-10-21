#!/usr/bin/env node
// PORT-NEW docs/33 M16 task 3 — in-app update on the PACKAGED AppImage through the ORIGINAL renderer:
//   release gateway (LABELLED FAKE: tools/m16-update-feed.mjs, local HTTPS) announces a newer port build →
//   sidebar "Update now" (InAppUpdateButton) → app:update:download → createAppUpdater.download → electron-updater
//   AppImageUpdater check + download (sha512-verified) → "Restart to update" → app:update:install → QuitCoordinator
//   ("update"; first with an unsent draft → native "Restart to update?" dialog, cancelled; then clean) → beginInstall →
//   quiesceForUpdate → finishInstall → quitAndInstall → the old AppImage is replaced by the new file and relaunched.
// Harness inputs (not app code): own Xvfb (so the relaunched app keeps a display), the feed's self-signed cert
// (NODE_EXTRA_CA_CERTS for the Node release check, --ignore-certificate-errors for electron-updater's Chromium net),
// and VIDEOCLAW_PORT_UPDATE_HARNESS_GATEWAY (the PORT-NEW seam that evaluates the darwin/release-gateway gate).
//   node tools/ui-e2e-m16-update.mjs --run RUN --old OLD.AppImage --new NEW.AppImage --new-version 0.0.41-port.0
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, typeText, screenshot } from "./ui-e2e/cdp.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2); const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = resolve(opt("--run")); const OLD = resolve(opt("--old")); const NEW = resolve(opt("--new")); const NEW_VERSION = opt("--new-version");
const CDP_PORT = Number(opt("--port", "9395")); const FEED_PORT = Number(opt("--feed-port", "47811")); const DISPLAY = `:${opt("--display", "195")}`;
const OUT = join(RUN, `out-m16-update-${Date.now()}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const APPS = join(RUN, "apps"); mkdirSync(APPS, { recursive: true }); const FEED = join(RUN, "feed"); mkdirSync(FEED, { recursive: true });
const IPC = join(OUT, "ipc.jsonl"); const LOG = join(OUT, "harness.jsonl"); const t0 = Date.now();
const say = (m) => { console.log(`[m16 update +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, note: m }) + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const ipcRows = () => { try { return readFileSync(IPC, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 900)}`); };
const summary = { feed: "FAKE UPSTREAM (labelled): local HTTPS release gateway tools/m16-update-feed.mjs on the box", harnessInputs: ["own Xvfb", "own dbus session + gnome-keyring-daemon (unlocked login keyring) so safeStorage works for the packaged build", "--password-store=gnome-libsecret", "NODE_EXTRA_CA_CERTS=feed cert", "--ignore-certificate-errors", "VIDEOCLAW_PORT_UPDATE_HARNESS_GATEWAY"], started: new Date().toISOString(), steps };

// the AppImage under test is a COPY (quitAndInstall unlinks it)
const oldCopy = join(APPS, basename(OLD)); copyFileSync(OLD, oldCopy); chmodSync(oldCopy, 0o755);
summary.old = { file: basename(oldCopy), sha256: sha(oldCopy).slice(0, 16), bytes: statSync(oldCopy).size };
summary.new = { file: basename(NEW), version: NEW_VERSION, sha256: sha(NEW).slice(0, 16), bytes: statSync(NEW).size };
const procs = [];
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1440x960x24", "-nolisten", "tcp"], { stdio: "ignore", detached: true }); procs.push(xvfb);
const feed = spawn(process.execPath, [join(PORT_DIR, "tools/m16-update-feed.mjs"), "--dir", FEED, "--artifact", NEW, "--version", NEW_VERSION, "--port", String(FEED_PORT), "--log", join(OUT, "feed-requests.jsonl")], { stdio: ["ignore", "pipe", "inherit"], detached: true }); procs.push(feed);
summary.feedStart = await new Promise((r) => feed.stdout.once("data", (b) => r(JSON.parse(String(b)))));
// a session bus + Secret Service that outlive the old app (the relaunched AppImage inherits the address)
const busAddr = execFileSync("dbus-daemon", ["--session", "--fork", "--print-address=1", "--print-pid=1"]).toString().trim().split("\n");
const DBUS = busAddr[0]; const dbusPid = Number(busAddr[1]);
const keyring = execFileSync("bash", ["-c", "printf 'm16-harness' | gnome-keyring-daemon --unlock --components=secrets"], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: DBUS, HOME: RUN, DISPLAY } }).toString();
const keyringPid = Number(/GNOME_KEYRING_PID=(\d+)/.exec(keyring)?.[1] ?? 0);
summary.secretService = { dbus: "private session bus", keyringStarted: !!keyringPid };
const xshot = (n) => { try { execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "x11grab", "-video_size", "1440x960", "-i", DISPLAY, "-frames:v", "1", join(SHOTS, `${n}.png`)], { env: { ...process.env, DISPLAY } }); } catch (e) { say(`xshot ${n} failed ${String(e).slice(0, 120)}`); } };
const env = { ...process.env, HOME: RUN, DISPLAY, APPIMAGE_EXTRACT_AND_RUN: "1", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY: "1", VIDEOCLAW_PORT_LOCAL_GATEWAY_PORT: opt("--gw-port", "47735"),
  VIDEOCLAW_PORT_IPC_LOG: IPC, VIDEOCLAW_PORT_IPC_LOG_MAX: "4000", NODE_EXTRA_CA_CERTS: join(FEED, "feed-cert.pem"), VIDEOCLAW_PORT_UPDATE_HARNESS_GATEWAY: `https://127.0.0.1:${FEED_PORT}`,
  MINIMAX_API_KEY: "fake-key-m16-update", PYTHONDONTWRITEBYTECODE: "1", DBUS_SESSION_BUS_ADDRESS: DBUS, VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "gateway" };
for (const k of Object.keys(env)) if (k.startsWith("__CURSOR_SANDBOX") || /^(ANTHROPIC_|OPENAI_|OPENROUTER_|CLAUDE_CODE_)/.test(k)) delete env[k];
const UD = join(RUN, ".config", "videoclaw-port");
const mainLog = join(OUT, "main.log");
const app = spawn(oldCopy, ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`, "--ignore-certificate-errors", "--password-store=gnome-libsecret"], { cwd: RUN, env, stdio: ["ignore", "pipe", "pipe"], detached: true }); procs.push(app);
app.stdout.on("data", (b) => appendFileSync(mainLog, b)); app.stderr.on("data", (b) => appendFileSync(mainLog, b));
let exited = null; app.on("exit", (c, s) => { exited = { code: c, signal: s, at: Date.now() - t0 }; say(`old app exited ${c ?? s}`); });
let cdp;
const ev = (e) => cdp.eval(e);
async function waitFor(desc, fn, { timeoutMs = 30_000, every = 300 } = {}) { const ts = Date.now(); while (Date.now() - ts < timeoutMs) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); } throw new Error(`timeout waiting for ${desc}`); }
const rect = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.height && ${text ? `new RegExp(${JSON.stringify(text)}).test(x.innerText.trim())` : "true"}; }); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: e.innerText.trim(), disabled: !!e.disabled }; })()`);
const click = async (desc, sel, text) => { const r = await waitFor(desc, () => rect(sel, text), { timeoutMs: 30_000 }); appendFileSync(LOG, JSON.stringify({ action: "click", desc, at: r }) + "\n"); await mouseClick(cdp, r.x, r.y); return r; };
const shot = async (n) => { try { writeFileSync(join(SHOTS, `${n}.png`), await screenshot(cdp)); } catch { xshot(n); } };
const updateState = () => ev("window.videoclaw.getAppUpdateState()");
try {
  const page = await waitForPageTarget(CDP_PORT, { timeoutMs: 120_000, match: (t) => t.type === "page" && /index\.html/.test(t.url) });
  cdp = await Cdp.connect(page.webSocketDebuggerUrl, () => {}); await cdp.send("Runtime.enable");
  await waitFor("home", async () => /What are we making today\?/.test(await ev("document.body.innerText")) || null, { timeoutMs: 90_000 });
  await sleep(1000); if (await rect("button.tour-skip")) await click("Skip tour", "button.tour-skip");
  // U1 — the release feed's announcement reaches the original sidebar row
  const row = await waitFor("sidebar Update now", () => rect(".update-row button.update-optional-action", "Update now"), { timeoutMs: 60_000 });
  const info = await ev("window.videoclaw.getUpdateInfo()"); const st0 = await updateState();
  await shot("U1-update-available");
  verdict("announce", row && info?.version === NEW_VERSION && info?.autoUpdate === true && st0?.status === "idle", { row, info, state: st0 });
  // U2 — download through electron-updater, watching the original button label
  const labels = [];
  const watch = setInterval(async () => { try { const r = await rect(".update-row button"); if (r && labels.at(-1) !== r.label) labels.push(r.label); } catch {} }, 150);
  await click("Update now", ".update-row button.update-optional-action", "Update now");
  await waitFor("Downloading", async () => labels.some((l) => /^Downloading \d+%$/.test(l)) || null, { timeoutMs: 60_000, every: 200 }).catch(() => null);
  await shot("U2-downloading");
  await waitFor("Restart to update", () => rect(".update-row button", "^Restart to update$"), { timeoutMs: 5 * 60_000, every: 300 });
  clearInterval(watch);
  const st1 = await updateState(); await shot("U3-downloaded");
  const cache = join(RUN, ".cache", "videoclaw-port-updater", "pending");
  const pending = existsSync(cache) ? readdirSync(cache) : [];
  const pendingFile = pending.find((f) => f.endsWith(".AppImage"));
  verdict("download", st1.status === "downloaded" && st1.version === NEW_VERSION && st1.percent === 100 && labels.some((l) => /^Downloading \d+%$/.test(l)) && !!pendingFile && sha(join(cache, pendingFile)) === sha(NEW),
    { labels, state: st1, pending, pendingSha: pendingFile ? sha(join(cache, pendingFile)).slice(0, 16) : null, ipc: ipcRows().filter((r) => /^app:update:(download|state)$/.test(r.ch)).map((r) => ({ ch: r.ch, real: r.real, ok: r.ok, result: String(r.result).slice(0, 160) })).slice(-3) });
  // U4 — Restart with an unsent draft: the original QuitCoordinator asks first (native dialog); Cancel (default) keeps it
  await click("composer", "textarea"); await typeText(cdp, "草稿：还没发送"); await sleep(1200);
  await click("Restart to update", ".update-row button", "^Restart to update$");
  await sleep(2500); xshot("U4-restart-dialog");
  let dialogSeen = false; try { const w = execFileSync("xdotool", ["search", "--name", "Restart to update"], { env: { ...process.env, DISPLAY } }).toString().trim(); dialogSeen = !!w; } catch {}
  try { execFileSync("xdotool", ["key", "Escape"], { env: { ...process.env, DISPLAY } }); } catch {}
  await sleep(1500);
  const st2 = await updateState(); const stillOld = existsSync(oldCopy) && exited === null;
  verdict("restart_dialog_cancel", dialogSeen && st2.status === "downloaded" && stillOld, { dialogSeen, state: st2, oldStillRunning: stillOld });
  // U5 — clear the draft and restart for real
  await click("composer", "textarea"); await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }); await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await sleep(1500); await shot("U5-before-restart");
  const tRestart = Date.now();
  await click("Restart to update", ".update-row button", "^Restart to update$").catch((e) => say(`restart click: ${e.message}`));
  try { cdp.close(); } catch {}
  await waitFor("old app exit", async () => exited || null, { timeoutMs: 60_000 }).catch(() => null);
  const newPath = join(APPS, basename(NEW));
  const relaunched = await waitFor("relaunched process", async () => { const ps = execFileSync("ps", ["-eo", "pid,etimes,args"]).toString().split("\n").filter((l) => l.includes(basename(NEW)) && !l.includes("m16-update-feed") && !l.includes("ui-e2e-m16-update")); return ps.length ? ps : null; }, { timeoutMs: 60_000, every: 1000 }).catch(() => []);
  await sleep(15_000); xshot("U6-relaunched");
  const extracted = execFileSync("bash", ["-c", "ls -d /tmp/appimage_extracted_* 2>/dev/null || true"]).toString().trim().split("\n").filter(Boolean);
  const versions = extracted.map((d) => { try { const asar = join(d, "resources", "app.asar"); const txt = readFileSync(asar).toString("latin1"); const m = /"name":\s*"videoclaw-port",\s*"version":\s*"([^"]+)"/.exec(txt); return { dir: basename(d), version: m?.[1] ?? null }; } catch { return { dir: basename(d), version: null }; } });
  const ipcAfter = ipcRows().filter((r) => Date.parse(r.t) > tRestart + 2000).map((r) => r.ch);
  const mainRows = readFileSync(mainLog, "utf8").split("\n").filter((l) => /\[quit\]|quit: begin shutdown|UPDATE HARNESS|update|AppImage/i.test(l)).slice(-12);
  summary.after = { oldExited: exited, appsDir: readdirSync(APPS).map((f) => ({ f, sha256: sha(join(APPS, f)).slice(0, 16) })), relaunched: relaunched.map((l) => l.trim().replace(/\s+/g, " ").slice(0, 200)), extractedVersions: versions, ipcChannelsAfterRestart: [...new Set(ipcAfter)].slice(0, 20), mainLog: mainRows.map((l) => l.slice(0, 240)) };
  verdict("quit_and_install_relaunch", !!exited && !existsSync(oldCopy) && existsSync(newPath) && sha(newPath) === sha(NEW) && relaunched.length > 0 && versions.some((v) => v.version === NEW_VERSION) && ipcAfter.length > 0, summary.after);
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { xshot("99-error"); } catch {} }
finally {
  summary.feedRequests = (() => { try { return readFileSync(join(OUT, "feed-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } })();
  summary.allPass = !summary.error && Object.keys(steps).length === 5 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "m16-update-summary.json"), JSON.stringify(summary, null, 1));
  try { execFileSync("bash", ["-c", `pkill -f '${basename(NEW)}' || true; pkill -f '${basename(OLD)}' || true`]); } catch {}
  await sleep(1500);
  for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
  for (const pid of [keyringPid, dbusPid]) { try { if (pid) process.kill(pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass} ${Object.entries(steps).map(([k, v]) => `${k}:${v.ok ? "ok" : "FAIL"}`).join(" ")} out=${OUT}`);
  process.exit(summary.allPass ? 0 : 1);
}
