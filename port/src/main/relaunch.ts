// PORT-NEW docs/34 (Linux): inside an AppImage process.execPath is the runtime's temporary mount/extraction, which
// is gone once this process exits — relaunch the AppImage file itself (what electron-updater does too). Elsewhere
// (macOS .app, Windows nsis/portable, dev) Electron's default relaunch of process.execPath is kept.
export interface RelaunchOptionsLike { execPath?: string; args?: string[] }
export const relaunchOptions = (env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, argv: string[] = process.argv): RelaunchOptionsLike | undefined =>
  platform === "linux" && env.APPIMAGE ? { execPath: env.APPIMAGE, args: argv.slice(1) } : undefined;
