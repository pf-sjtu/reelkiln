// docs/39 M22: the packaged staging Flight profile at startup — original main/index.js L60305-60318 (applied before
// app ready) and the window flags it drives (L60542 show, L60552 backgroundThrottling). resolveStagingFlightProfile /
// applicationChannel are the ORIGINAL code (platform/staging-flight.generated.ts). NOTE: the shipped build hard-wires
// applicationChannel() to "prod" (L9172), so in a production build the profile is always undefined and none of this
// fires — exactly as in the original. The behaviour is exercised by tests with channel "staging".
export interface StagingFlightProfile { root: string; instanceId: string; userDataDir: string; workspaceDir: string; hidden?: true }
export interface FlightStartupApp {
  isPackaged: boolean;
  setActivationPolicy(policy: "regular" | "accessory" | "prohibited"): void;
  setPath(name: "userData", path: string): void;
  commandLine: { hasSwitch(name: string): boolean; appendSwitch(name: string, value?: string): void };
}

/** L60306-60318, verbatim apart from the injected app / env / platform. */
export function applyStagingFlightStartup(app: FlightStartupApp, stagingFlightProfile: StagingFlightProfile | undefined, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): void {
  if (stagingFlightProfile) {
    if (stagingFlightProfile.hidden && platform === "darwin")
      app.setActivationPolicy("accessory");
    app.setPath("userData", stagingFlightProfile.userDataDir);
    if (!app.commandLine.hasSwitch("remote-debugging-address")) {
      app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
    }
    if (!app.commandLine.hasSwitch("remote-debugging-port")) {
      app.commandLine.appendSwitch("remote-debugging-port", "0");
    }
  } else if (!app.isPackaged && env.VIDEOCLAW_USERDATA_DIR) {
    app.setPath("userData", env.VIDEOCLAW_USERDATA_DIR);
  }
}

/** createWindow (L60541-60553): a hidden Flight window is never shown and keeps rendering in the background. */
export function flightWindowFlags(stagingFlightProfile: StagingFlightProfile | undefined): { show: boolean; backgroundThrottling: boolean } {
  return { show: !stagingFlightProfile?.hidden, backgroundThrottling: !stagingFlightProfile?.hidden };
}
