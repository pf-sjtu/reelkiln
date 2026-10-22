// PORT-NEW docs/39 M22: real-Electron probe for the hidden staging Flight profile on macOS. Bundled with esbuild
// (electron external) and run as `electron probe.cjs`; prints one JSON line. With VIDEOCLAW_FLIGHT_HIDDEN=1 the
// ORIGINAL code path (resolveStagingFlightProfile("staging") → applyStagingFlightStartup) must hide the Dock icon
// (activation policy "accessory") and create an unshown window; without it (control) the Dock icon is visible.
import { app, BrowserWindow } from "electron";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStagingFlightProfile } from "../src/main/platform/staging-flight.generated";
import { applyStagingFlightStartup, flightWindowFlags } from "../src/main/staging-flight";

const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-flight-probe-")));
mkdirSync(join(root, "user-data")); mkdirSync(join(root, "workspace"));
writeFileSync(join(root, ".videoclaw-flight-root.json"), JSON.stringify({ schema: "videoclaw.flight-root/v2", root, campaignInstanceId: "probe" }));
const env = { VIDEOCLAW_FLIGHT_ROOT: root, VIDEOCLAW_FLIGHT_INSTANCE_ID: "probe", VIDEOCLAW_USERDATA_DIR: join(root, "user-data"), VIDEOCLAW_WORKSPACE_DIR: join(root, "workspace"), ...(process.env.VIDEOCLAW_FLIGHT_HIDDEN ? { VIDEOCLAW_FLIGHT_HIDDEN: process.env.VIDEOCLAW_FLIGHT_HIDDEN } : {}) };
const profile: any = resolveStagingFlightProfile("staging", env);
applyStagingFlightStartup(app as any, profile);
app.whenReady().then(async () => {
  const flags = flightWindowFlags(profile);
  const w = new BrowserWindow({ show: flags.show, width: 400, height: 300, webPreferences: { backgroundThrottling: flags.backgroundThrottling } });
  await w.loadURL("data:text/html,<p>flight probe</p>");
  await new Promise((r) => setTimeout(r, 1500));
  const out = {
    platform: process.platform, hidden: !!profile?.hidden,
    dockVisible: app.dock ? app.dock.isVisible() : null,
    windowVisible: w.isVisible(), backgroundThrottling: w.webContents.getBackgroundThrottling(),
    userDataIsFlight: app.getPath("userData") === profile?.userDataDir,
    cdpAddress: app.commandLine.getSwitchValue("remote-debugging-address"), cdpPort: app.commandLine.getSwitchValue("remote-debugging-port"),
  };
  console.log("FLIGHT_PROBE " + JSON.stringify(out));
  app.exit(0);
});
