#!/usr/bin/env node
// PORT-NEW docs/25 M8 — reopen a PRIOR video in the ORIGINAL renderer after an app restart and check that
// session:history (original getHistory L43698 → historyToEvents L53433) replays the transcript from disk
// (SDK session JSONL under userData/engine-profile + the display-transcript sidecar). Then drives two more
// newly-real local channels from the real UI: session:rename (sidebar double-click → rename-input, original
// renderer L40854) and client:rename (project ⋯ menu → "Rename", L21671). Real CDP input only; page
// evaluation is read-only. Never calls window.videoclaw. No MiniMax request is made (no Send).
//
//   node tools/ui-e2e-reopen.mjs --run RUN_DIR_OF_A_FINISHED_ui-e2e [--appimage PATH] [--port 9361]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, waitForPageTarget, mouseClick, mouseMove, typeText, pressKey, screenshot } from "./ui-e2e/cdp.mjs";
import { center } from "./ui-e2e/plan.mjs";

const PORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const RUN = resolve(opt("--run") ?? "");
const APPIMAGE = opt("--appimage");
const CDP_PORT = Number(opt("--port", "9361"));
const TAG = opt("--tag", "reopen");
if (!opt("--run") || !existsSync(join(RUN, ".config", "videoclaw-port", "sessions.json"))) { console.error("usage: ui-e2e-reopen.mjs --run FINISHED_RUN_DIR"); process.exit(2); }
const UD = join(RUN, ".config", "videoclaw-port");
const OUT = join(RUN, `out-${TAG}`); const SHOTS = join(OUT, "shots"); mkdirSync(SHOTS, { recursive: true });
const LOG = join(OUT, "cdp-log.jsonl"); const t0 = Date.now();
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, ...o }) + "\n");
const say = (m) => { console.log(`[reopen +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`); log({ note: m }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const steps = {}; const verdict = (id, ok, d) => { steps[id] = { ok, ...d }; say(`STEP ${id}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(d).slice(0, 500)}`); };
const sessions = () => readJson(join(UD, "sessions.json")) ?? { sessions: [], clients: [] };

// ---- disk truth BEFORE launch ------------------------------------------------------------------
const before = sessions();
const target = before.sessions.find((s) => s.jobId && s.sdkSessionId) ?? before.sessions.find((s) => s.jobId);
if (!target) { console.error("no finished session in sessions.json"); process.exit(2); }
const sid = target.sessionId;
const displayFile = join(UD, "display-transcripts", `${sid}.jsonl`);
const display = existsSync(displayFile) ? readFileSync(displayFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const findJsonl = (root, name) => { if (!existsSync(root)) return null; for (const e of readdirSync(root, { withFileTypes: true })) { const p = join(root, e.name); if (e.isDirectory()) { const r = findJsonl(p, name); if (r) return r; } else if (e.name === name) return p; } return null; };
const sdkFile = target.sdkSessionId ? findJsonl(join(UD, "engine-profile", "projects"), `${target.sdkSessionId}.jsonl`) : null;
const sdkRows = sdkFile ? readFileSync(sdkFile, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const assistantTexts = sdkRows.filter((r) => r.type === "assistant").flatMap((r) => (r.message?.content ?? []).filter((c) => c.type === "text").map((c) => String(c.text).trim())).filter((t) => t.length >= 12);
const toolUses = sdkRows.filter((r) => r.type === "assistant").flatMap((r) => (r.message?.content ?? []).filter((c) => c.type === "tool_use")).length;
const typed = display.find((r) => Array.isArray(r.displayTexts) || r.text)?.displayTexts?.[0] ?? display[0]?.text ?? null;
const disk = { sessionId: sid, title: target.title, sdkSessionId: target.sdkSessionId ?? null, sdkTranscript: !!sdkFile, sdkRows: sdkRows.length, assistantTexts: assistantTexts.length, toolUses, displayRows: display.length, typedPrefix: typed ? String(typed).slice(0, 24) : null };
say(`disk ${JSON.stringify(disk)}`);

// ---- launch (fresh process; no in-memory state survives) ----------------------------------------
const env = { ...process.env, HOME: RUN, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE_LLM_ROUTE: "minimax", VIDEOCLAW_PORT_EVENT_LOG: join(OUT, "events.jsonl") };
delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_PORT_SMOKE;
const appArgs = ["--no-sandbox", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${UD}`];
let cmd = "xvfb-run", args;
if (APPIMAGE) { env.APPIMAGE_EXTRACT_AND_RUN = "1"; args = ["-a", "-s", "-screen 0 1440x960x24", resolve(APPIMAGE), ...appArgs]; }
else args = ["-a", "-s", "-screen 0 1440x960x24", join(PORT_DIR, "node_modules", ".bin", "electron"), ...appArgs, PORT_DIR];
const mainLog = join(OUT, "main.log");
const child = spawn(cmd, args, { cwd: PORT_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
async function find(selector, { text, aria } = {}) {
  return cdp.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    ${text ? `if (!new RegExp(${JSON.stringify(text)}).test((e.innerText || e.value || "").trim())) return false;` : ""}
    ${aria ? `if (!new RegExp(${JSON.stringify(aria)}).test((e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || ""))) return false;` : ""}
    return true; }); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, label: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 80) }; })()`);
}
async function click(desc, selector, o = {}) { const el = await waitFor(desc, () => find(selector, o)); const p = center(el); log({ action: "click", desc, selector, at: p, element: el }); if (o.hover) { await mouseMove(cdp, o.hover.x, o.hover.y); await sleep(300); } await mouseClick(cdp, p.x, p.y); if (o.double) await mouseClick(cdp, p.x, p.y, { clickCount: 2 }); return el; }
const selectAll = () => cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] }).then(() => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const summary = { started: new Date().toISOString(), mode: APPIMAGE ? "AppImage" : "dev", disk, steps };
try {
  // the original reopens the last active video on launch (or shows home when there is none)
  const landing = await waitFor("original home or the restored video", async () => { const t = await bodyText(); return /What are we making today\?/.test(t) ? "home" : (await find("button.session.active")) ? "restored-active-video" : null; }, { timeoutMs: 90_000 });
  summary.landing = landing; say(`landing ${landing}`);
  await sleep(1200);
  if (await find("button.tour-skip")) await click("Skip tour", "button.tour-skip");
  await shot("01-after-restart");
  // leave the video (Quickstarts gallery) so the sidebar click below is a real re-open, not a no-op
  if (await find("button.quickstart-entry")) { await click("sidebar Quickstarts", "button.quickstart-entry"); await sleep(1500); await shot("01b-left-video"); }
  // 1. reopen the prior video from the sidebar (its project may be collapsed)
  const client = before.clients.find((c) => c.clientId === target.clientId);
  if (client && !(await find("button.session", { text: esc(String(target.title).slice(0, 20)) }))) await click("expand project", "button.client-toggle", { text: `^${esc(client.name)}$` }).catch(() => null);
  await click("prior video in sidebar", "button.session", { text: esc(String(target.title).slice(0, 20)) });
  const tOpen = Date.now();
  const want = { typed: disk.typedPrefix, assistant: assistantTexts.slice(-1)[0]?.split("\n")[0].slice(0, 30) ?? null };
  const seen = await waitFor("replayed transcript in the DOM", async () => { const t = await bodyText(); const ok = (!want.typed || t.includes(want.typed)) && (!want.assistant || t.includes(want.assistant)); return ok ? t : null; }, { timeoutMs: 30_000 }).catch(() => null);
  await sleep(1500); await shot("02-reopened-transcript");
  const dom = await cdp.eval(`(() => ({ toolRows: document.querySelectorAll('[class*="tool"]').length, userBubbles: document.querySelectorAll('[class*="user"]').length, versionPills: document.querySelectorAll('button.v-pill').length }))()`);
  const replayed = [...readFileSync(mainLog, "utf8").matchAll(/^\{[^\n]*"agent\.history\.replayed"[^\n]*$/gm)].map((m) => { try { return JSON.parse(m[0]); } catch { return m[0]; } }).filter((r) => JSON.stringify(r).includes(sid));
  verdict("history_replay", !!seen && replayed.length > 0 && (replayed[0].sdkMessages ?? 0) > 0, { want, typedVisible: !!seen, waitedMs: Date.now() - tOpen, dom, replayed: replayed.slice(0, 2) });

  // 2. session:rename — double-click the row → rename-input → select all, type, Enter
  const newTitle = `M8 重命名 ${String(Date.now()).slice(-5)}`;
  await click("double-click video row", "button.session.active", { double: true });
  await waitFor("rename input", () => find("input.session.rename-input"));
  await selectAll(); await typeText(cdp, newTitle); await pressKey(cdp, "Enter");
  const renamed = await waitFor("renamed on disk", async () => { const r = sessions().sessions.find((s) => s.sessionId === sid); return r?.title === newTitle ? r : null; }, { timeoutMs: 15_000 }).catch(() => null);
  const inDom = renamed ? !!(await waitFor("renamed video in sidebar", () => find("button.session", { text: esc(newTitle) }), { timeoutMs: 8_000 }).catch(() => null)) : false;
  await shot("03-session-renamed");
  verdict("session_rename", !!renamed && inDom, { newTitle, disk: renamed && { title: renamed.title, titleOrigin: renamed.titleOrigin ?? null }, inDom });

  // 3. client:rename — project ⋯ menu → Rename → "Project name" input
  if (client) {
    const newName = `M8 项目 ${String(Date.now()).slice(-4)}`;
    const tg = await waitFor("project row", () => find("button.client-toggle", { text: `^${esc(client.name)}$` }));
    await click("project actions", "summary.client-new-chat", { aria: `Project actions for ${esc(client.name)}`, hover: center(tg) });
    await sleep(400); await shot("03b-project-menu");
    await click("Rename project", "details.client-menu[open] .client-menu-options button", { text: "^Rename$" });
    await waitFor("project name input", () => find("input", { aria: "Project name" }));
    await selectAll(); await typeText(cdp, newName); await pressKey(cdp, "Enter");
    const cr = await waitFor("client renamed on disk", async () => sessions().clients.find((c) => c.clientId === client.clientId && c.name === newName) ?? null, { timeoutMs: 15_000 }).catch(() => null);
    const cDom = cr ? !!(await waitFor("renamed project in sidebar", () => find("button.client-toggle", { text: `^${esc(newName)}$` }), { timeoutMs: 8_000 }).catch(() => null)) : false;
    await shot("04-project-renamed");
    verdict("client_rename", !!cr && cDom, { newName, onDisk: !!cr, inDom: cDom });
  }
} catch (e) { summary.error = String(e?.stack ?? e); say(`ERROR ${summary.error}`); try { await shot("99-error"); } catch {} }
finally {
  summary.consoleErrorCount = consoleErrors.length; summary.consoleErrors = consoleErrors.slice(0, 10);
  summary.knownTypeErrors = { "index-D5K1mOs0.js:31748": consoleErrors.filter((m) => /31748/.test(m)).length, "index-D5K1mOs0.js:39778": consoleErrors.filter((m) => /39778/.test(m)).length };
  summary.allPass = !summary.error && Object.values(steps).length >= 2 && Object.values(steps).every((s) => s.ok);
  summary.finished = new Date().toISOString();
  writeFileSync(join(OUT, "reopen-summary.json"), JSON.stringify(summary, null, 1));
  try { const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); const b = await Cdp.connect(v.webSocketDebuggerUrl, () => {}); await b.send("Browser.close").catch(() => {}); b.close(); } catch {}
  cdp.close();
  for (let i = 0; i < 40 && !exited; i++) await sleep(250);
  if (!exited) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  say(`DONE allPass=${summary.allPass}`);
  process.exit(summary.allPass ? 0 : 1);
}
