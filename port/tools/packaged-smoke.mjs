#!/usr/bin/env node
// PORT-NEW (docs/18 §3): launch smoke for a PACKAGED Linux build (AppImage, .deb or linux-unpacked).
//   npm run package:smoke -- release/Videoclaw-Port-*.AppImage [--live]
// For each artifact:
//   1. GUI smoke: the packaged executable under xvfb-run with VIDEOCLAW_PORT_SMOKE=1 (main boots →
//      renderer → preload → IPC): port:llm:routes, port:diagnostics (packaged, SDK source, node:sqlite),
//      Settings page selects minimax via its radio and restores the previous route.
//   2. Node-mode SDK check: ELECTRON_RUN_AS_NODE=1 <exe> resources/app.asar/dist/cli/port-cli.cjs agent-sdk-check
//   3. --live only: ONE real agent turn through the bundled SDK + native claude (MiniMax route).
// Isolation: temp HOME + --user-data-dir, VIDEOCLAW_CLAUDE_AGENT_SDK unset → only the bundled SDK can be found.
// Never prints keys (CLI output is scrubbed; we only print parsed fields).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const live = args.includes("--live");
const targets = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
if (!targets.length) { console.error("usage: packaged-smoke.mjs <AppImage|deb|linux-unpacked> … [--live]"); process.exit(2); }

const onPath = (bin) => (process.env.PATH ?? "").split(":").map((d) => join(d, bin)).find((f) => existsSync(f));
const findExe = (dir) => { const e = join(dir, "videoclaw-port"); if (!existsSync(e)) throw new Error(`no videoclaw-port executable in ${dir}`); return e; };
function prepare(t) {
  const work = mkdtempSync(join(tmpdir(), "vc-pkg-smoke-"));
  if (statSync(t).isDirectory()) return { kind: "unpacked", exe: findExe(t), appDir: t, work };
  if (t.endsWith(".deb")) {
    const info = execFileSync("dpkg-deb", ["-f", t, "Package", "Version", "Architecture", "Depends", "Installed-Size"], { encoding: "utf8" });
    execFileSync("dpkg-deb", ["-x", t, join(work, "root")]);
    const opt = join(work, "root", "opt");
    const appDir = join(opt, readdirSync(opt)[0]);
    return { kind: "deb", exe: findExe(appDir), appDir, work, control: info.trim().split("\n") };
  }
  if (t.endsWith(".AppImage")) {
    // run the AppImage itself for the GUI smoke (FUSE, or APPIMAGE_EXTRACT_AND_RUN fallback) and an
    // extracted copy for node-mode checks
    execFileSync(t, ["--appimage-extract"], { cwd: work, stdio: "ignore" });
    const appDir = join(work, "squashfs-root");
    return { kind: "AppImage", exe: t, appDir, work, extractedExe: findExe(appDir) };
  }
  throw new Error(`unsupported artifact ${t}`);
}

function baseEnv(home) {
  const env = { ...process.env, HOME: home, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? "/home/box/.local/share/uv/python", XDG_CONFIG_HOME: join(home, ".config") };
  delete env.VIDEOCLAW_CLAUDE_AGENT_SDK; delete env.VIDEOCLAW_CLAUDE_CODE_EXECUTABLE; delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function guiSmoke(p, mode) {
  const home = mkdtempSync(join(p.work, "home-"));
  const env = { ...baseEnv(home), VIDEOCLAW_PORT_SMOKE: "1", VIDEOCLAW_PORT_SMOKE_UI_SELECT: "minimax" };
  if (mode === "extract-and-run") env.APPIMAGE_EXTRACT_AND_RUN = "1";
  else if (p.kind === "AppImage" && !onPath("fusermount") && onPath("fusermount3")) {
    // type-2 AppImage runtime execs `fusermount` (FUSE 2 name); fuse3-only hosts ship fusermount3
    // (box quirk, docs/18 §3). Temp PATH shim only — nothing installed system-wide.
    const shim = mkdtempSync(join(p.work, "fuse-shim-"));
    symlinkSync(onPath("fusermount3"), join(shim, "fusermount"));
    env.PATH = `${shim}:${env.PATH}`;
  }
  const r = spawnSync("xvfb-run", ["-a", p.exe, "--no-sandbox", `--user-data-dir=${join(home, "ud")}`], { env, encoding: "utf8", timeout: 120_000 });
  const lines = (r.stdout + r.stderr).split("\n").filter((l) => l.startsWith("[smoke] {") || l.startsWith("[smoke] DONE"));
  const rec = (name) => { const l = lines.find((x) => x.includes(`"name":"${name}"`)); try { return l ? JSON.parse(l.slice(8)) : undefined; } catch { return { ok: false, error: "truncated log line" }; } };
  const diag = rec("port:diagnostics")?.value;
  const routes = rec("port:llm:routes")?.value;
  const done = lines.find((l) => l.startsWith("[smoke] DONE"));
  const failure = r.status !== 0 && !done ? (r.stdout + r.stderr).split("\n").filter((l) => /fuse|FUSE|error/i.test(l) && !/dbus/.test(l)).slice(0, 3) : undefined;
  return {
    exit: r.status, mode, done: done ?? null, ...(failure ? { failure } : {}),
    preloadMethods: rec("preload")?.value,
    llmRoutes: routes ? { current: routes.current, ids: routes.routes.map((x) => x.id) } : null,
    packaged: diag?.app?.packaged, resourcesPath: diag?.app?.resourcesPath,
    agentSdk: diag ? { ok: diag.agentSdk.ok, source: diag.agentSdk.source, version: diag.agentSdk.version, executable: diag.agentSdk.executable } : null,
    sqlite: diag?.sqlite ?? null,
    settingsPage: { select: rec("settings-page:select(minimax)")?.ok ?? null, restore: rec("settings-page:restore(claude-code)")?.ok ?? null },
    ok: r.status === 0 && done === "[smoke] DONE failed=[]" && diag?.app?.packaged === true && diag?.agentSdk?.ok === true && diag?.agentSdk?.source === "resources" && diag?.sqlite?.ok === true,
  };
}

function nodeCli(p, cliArgs, extraEnv = {}, timeout = 60_000) {
  const exe = p.extractedExe ?? p.exe;
  const home = mkdtempSync(join(p.work, "home-"));
  const r = spawnSync(exe, [join(p.appDir, "resources", "app.asar", "dist", "cli", "port-cli.cjs"), ...cliArgs], { env: { ...baseEnv(home), ELECTRON_RUN_AS_NODE: "1", ...extraEnv }, encoding: "utf8", timeout, cwd: home });
  const lastJson = r.stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  let j; try { j = JSON.parse(lastJson ?? r.stdout); } catch { j = { ok: false, error: `unparsable output (exit ${r.status})`, stderr: r.stderr.slice(-500) }; }
  return j;
}

const report = [];
for (const t of targets) {
  const p = prepare(t);
  const entry = { artifact: t, bytes: statSync(t).isFile() ? statSync(t).size : undefined, kind: p.kind, control: p.control };
  try {
    entry.gui = guiSmoke(p, "direct");
    if (!entry.gui.ok && p.kind === "AppImage") entry.guiFallback = guiSmoke(p, "extract-and-run");
    const c = nodeCli(p, ["agent-sdk-check"]);
    entry.sdkCheck = { ok: c.ok, source: c.source, version: c.version, matchesPin: c.matchesPin, executable: c.executable, resourcesPath: c.resourcesPath, error: c.error };
    const sq = nodeCli(p, ["sqlite-check"]);
    entry.sqliteNodeMode = { ok: sq.ok, sqliteVersion: sq.sqliteVersion, electron: sq.electron, node: sq.node };
    if (live) {
      const a = nodeCli(p, ["llm-agent-smoke", "minimax"], { VIDEOCLAW_LLM_LIVE: "1" }, 300_000);
      entry.liveAgentTurn = { ok: a.ok, sdk: a.sdk, model: a.turn?.init?.model ?? a.turn?.model, claudeCodeVersion: a.turn?.init?.claudeCodeVersion, assistantText: a.turn?.assistantText?.slice(0, 200), resultSubtype: a.turn?.result?.subtype, numTurns: a.turn?.result?.numTurns, gateProxy: a.gateProxy ? { requests: a.gateProxy.requests, rejected: a.gateProxy.rejected, maxInflight: a.gateProxy.maxInflight } : undefined, childEnvHasProviderKey: a.childEnvHasProviderKey, error: a.error ?? a.turn?.error, ms: a.ms };
    }
  } finally { rmSync(p.work, { recursive: true, force: true }); }
  entry.ok = !!(entry.gui?.ok || entry.guiFallback?.ok) && entry.sdkCheck?.ok && entry.sdkCheck?.source === "resources" && entry.sqliteNodeMode?.ok && (!live || entry.liveAgentTurn?.ok);
  report.push(entry);
  console.error(`[packaged-smoke] ${basename(t)}: ${entry.ok ? "OK" : "FAILED"}`);
}
console.log(JSON.stringify(report, null, 2));
if (!report.every((e) => e.ok)) process.exitCode = 1;
