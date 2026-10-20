// Bootstrap tool resolution — port of resolveBootstrapToolRoots / bootstrapTool
// (main/index.js L9291-9311). Same root order; only the executable suffix differs.
import { type Plat } from "./types";
import { exeName, pathMod } from "./paths";

export function resolveBootstrapToolRoots(o: {
  resourcesPath: string;
  appPath: string;
  packaged: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: Plat;
}): string[] {
  const pm = pathMod(o.platform);
  const roots = [pm.join(o.resourcesPath, "bootstrap")];
  if (!o.packaged) {
    roots.push(pm.join(o.appPath, "resources", "bootstrap"));
    roots.push(pm.join(o.appPath, "apps", "desktop", "resources", "bootstrap"));
  }
  // ORIGINAL env var (L9301): VIDEOCLAW_ENGINE_DIST dev override, prepended.
  const devOverride = (o.env ?? process.env).VIDEOCLAW_ENGINE_DIST?.trim();
  if (devOverride) roots.unshift(devOverride);
  return [...new Set(roots.filter((r) => r.length > 0))];
}

/** Bootstrap binaries the original resolves by bare name. */
export type BootstrapTool = "ffmpeg" | "ffprobe" | "uv" | "voice-dictation";

/** PORT-ONLY env overrides — NOT present in the original 0.0.40 bundle (verified: no
 *  FFMPEG/FFPROBE/UV path variable exists there; see docs/02). Added so a Windows dev box
 *  can point at system-installed tools before a Windows bootstrap bundle exists. */
export const PORT_ONLY_TOOL_ENV: Partial<Record<BootstrapTool, string>> = {
  ffmpeg: "VIDEOCLAW_PORT_FFMPEG",
  ffprobe: "VIDEOCLAW_PORT_FFPROBE",
  uv: "VIDEOCLAW_PORT_UV",
};

export function bootstrapTool(
  name: BootstrapTool,
  o: { roots: string[]; exists: (p: string) => boolean; env?: NodeJS.ProcessEnv; platform?: Plat },
): string | undefined {
  const envKey = PORT_ONLY_TOOL_ENV[name];
  const override = envKey ? (o.env ?? process.env)[envKey]?.trim() : undefined;
  if (override && o.exists(override)) return override; // PORT-ONLY
  const pm = pathMod(o.platform);
  return o.roots.map((r) => pm.join(r, exeName(name, o.platform))).find(o.exists);
}

/** Original: `codex/bin/codex` under bootstrap, override VIDEOCLAW_CODEX_BIN (original env var). */
export function codexBinCandidates(roots: string[], platform?: Plat): string[] {
  const pm = pathMod(platform);
  return roots.map((r) => pm.join(r, "codex", "bin", exeName("codex", platform)));
}
