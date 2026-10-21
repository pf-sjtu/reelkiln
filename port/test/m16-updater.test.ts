// docs/33 M16 T3: createAppUpdater (L2223) + QuitCoordinator/assessQuit (L56360-56506) — the verbatim slices
// with a fake electron-updater driver (EventEmitter + checkForUpdates/downloadUpdate/quitAndInstall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAppUpdater } from "../src/main/update/app-updater.generated";
import { assessQuit, QuitCoordinator } from "../src/main/quit/quit-coordinator.generated";

class FakeDriver extends EventEmitter {
  autoDownload = true; autoInstallOnAppQuit = true; allowPrerelease = false; channel: string | null = null; allowDowngrade = true;
  disableDifferentialDownload = false; requestHeaders: unknown = undefined; feeds: unknown[] = []; calls: string[] = [];
  offered = "0.0.41"; failDownload = false; quitThrows = false;
  setFeedURL(f: unknown) { this.feeds.push(f); }
  async checkForUpdates() { this.calls.push("check"); return { updateInfo: { version: this.offered } }; }
  async downloadUpdate() { this.calls.push("download"); this.emit("download-progress", { percent: 42.7 }); if (this.failDownload) throw new Error("net"); return ["/tmp/x.AppImage"]; }
  quitAndInstall() { this.calls.push("quitAndInstall"); if (this.quitThrows) throw new Error("nope"); }
}
const GW = "https://gw.example";
function make(over: Record<string, unknown> = {}) {
  const driver = new FakeDriver(); const published: any[] = []; const quits: string[] = []; const recovered: number[] = [];
  const u: any = createAppUpdater({ driver, currentVersion: "0.0.40", gatewayUrl: GW, trustedGatewayUrl: GW, packaged: true, platform: "darwin",
    publish: (s: unknown) => published.push(s), installBlocker: () => null, beginQuit: () => quits.push("update"), recoverInstall: () => recovered.push(1), ...over });
  return { u, driver, published, quits, recovered };
}
const release = { version: "0.0.41", minSupported: "0.0.1", autoUpdate: true };

test("createAppUpdater: Linux / unpackaged / untrusted gateway → disabled with the original copy, driver untouched", () => {
  for (const o of [{ platform: "linux" }, { packaged: false }, { trustedGatewayUrl: "https://other" }, { gatewayUrl: "http://gw", trustedGatewayUrl: "http://gw" }]) {
    const { u, driver } = make(o);
    assert.deepEqual(u.state(), { status: "disabled", version: null, percent: null, message: "In-app updates require an installed Mac build using its release gateway." });
    assert.equal(driver.feeds.length, 0); assert.equal(driver.autoDownload, true);
  }
});

test("createAppUpdater: enabled → generic feed per channel; download publishes checking → downloading → progress → downloaded", async () => {
  const { u, driver, published } = make();
  assert.equal(u.state().status, "idle");
  assert.deepEqual(driver.feeds[0], { provider: "generic", url: `${GW}/v1/app/updates/latest/` });
  assert.equal(driver.autoDownload, false); assert.equal(driver.autoInstallOnAppQuit, false); assert.equal(driver.disableDifferentialDownload, true);
  u.observeRelease(release);
  const s = await u.download("0.0.41");
  assert.equal(s.status, "downloaded"); assert.equal(s.percent, 100); assert.equal(s.version, "0.0.41");
  assert.deepEqual(published.map((p) => `${p.status}:${p.percent}`), ["checking:null", "downloading:0", "downloading:42", "downloaded:100"]);
  assert.deepEqual(driver.calls, ["check", "download"]);
});

test("createAppUpdater: refuses non-newer / wrong-channel versions; a changed release is an error; a failed download says so", async () => {
  const a = make(); a.u.observeRelease(release);
  assert.equal((await a.u.download("0.0.40")).status, "idle"); assert.equal((await a.u.download("0.0.42-nightly.1")).status, "idle"); assert.equal(a.driver.calls.length, 0);
  const b = make(); b.u.observeRelease(release); b.driver.offered = "0.0.42";
  const sb = await b.u.download("0.0.41"); assert.equal(sb.status, "error"); assert.equal(sb.message, "The release changed. Check for updates again before downloading.");
  const c = make(); c.u.observeRelease(release); c.driver.failDownload = true;
  const sc = await c.u.download("0.0.41"); assert.equal(sc.status, "error"); assert.equal(sc.message, "Couldn't download the update. Check your connection and try again.");
});

test("install → beginQuit → QuitCoordinator(update) with no blockers → beginInstall → finishInstall → driver.quitAndInstall once", async () => {
  let u: any; const shut: string[] = [];
  const qc: any = new QuitCoordinator({
    readState: () => ({ runningTurns: 0, pendingInteractions: 0, stagedAttachments: 0, copyingAttachments: 0 }),
    beginInstall: () => u.beginInstall() === true,
    confirm: async () => { throw new Error("no dialog expected"); },
    beginShutdown: (p: string) => { shut.push(p); qc.shutdownSettled(); assert.equal(u.finishInstall(), true); assert.equal(u.finishInstall(), true); },
  });
  const m = make({ beginQuit: () => qc.requestQuit("update") }); u = m.u;
  m.u.observeRelease(release); await m.u.download("0.0.41");
  const s = m.u.install();
  assert.deepEqual(shut, ["update"]); assert.equal(s.status, "installing"); assert.deepEqual(m.driver.calls, ["check", "download", "quitAndInstall"]);
  assert.equal(qc.currentPhase(), "complete");
});

test("Restart to update with blockers asks first (update copy); Cancel keeps the payload, Restart proceeds", async () => {
  const state = { runningTurns: 1, pendingInteractions: 0, unsentDraft: true, stagedAttachments: 0, copyingAttachments: 0, videos: { working: ["海边日出"] } };
  const a = assessQuit(state, "update");
  assert.equal(a.title, "Restart to update?"); assert.equal(a.proceedLabel, "Restart to Update"); assert.deepEqual(a.blockers, ["agent-turn", "composer-draft"]);
  assert.equal(a.message, "Videoclaw is still working and has unsent changes.");
  assert.match(a.detail, /“海边日出” is still working\.\nYou have an unsent message\.\n\nRestarting now will interrupt that work\. Your unsent changes will still be here after the update\./);
  let answer = false; let u: any; const asked: any[] = []; const shut: string[] = [];
  const qc: any = new QuitCoordinator({ readState: () => state, beginInstall: () => u.beginInstall() === true, confirm: async (x: any) => { asked.push(x); return answer; },
    beginShutdown: (p: string) => { shut.push(p); qc.shutdownSettled(); u.finishInstall(); } });
  const m = make({ beginQuit: () => qc.requestQuit("update") }); u = m.u;
  m.u.observeRelease(release); await m.u.download("0.0.41");
  m.u.install(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(asked.length, 1); assert.equal(qc.currentPhase(), "idle"); assert.equal(m.u.state().status, "downloaded"); assert.equal(shut.length, 0);
  answer = true; m.u.install(); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(shut, ["update"]); assert.equal(m.driver.calls.at(-1), "quitAndInstall");
});

test("install guards: stale payload resets; installBlocker surfaces its message; quitAndInstall throwing recovers", async () => {
  const a = make(); a.u.observeRelease(release); await a.u.download("0.0.41");
  a.u.observeRelease({ ...release, version: "0.0.42" });
  assert.equal(a.u.state().status, "idle");
  const b = make({ installBlocker: () => ({ message: "Wait for the current request to finish, then restart to update.", offerInstaller: true }) });
  b.u.observeRelease(release); await b.u.download("0.0.41");
  const sb = b.u.install(); assert.equal(sb.message, "Wait for the current request to finish, then restart to update."); assert.equal(sb.installBlocked, true); assert.equal(b.quits.length, 0);
  const c = make(); c.u.observeRelease(release); await c.u.download("0.0.41"); c.driver.quitThrows = true;
  assert.equal(c.u.beginInstall(), true); c.u.finishInstall();
  assert.equal(c.u.state().status, "error"); assert.equal(c.recovered.length, 1);
});
