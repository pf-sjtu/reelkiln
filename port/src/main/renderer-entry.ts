// docs/21 M1: which renderer the window loads.
//   default            → the ORIGINAL renderer, unmodified (dev: <repo>/app/out/renderer/index.html;
//                        packaged: resources/renderer-original/index.html, copied by tools/packaging-config.mjs)
//   VIDEOCLAW_PORT_RENDERER=port → the PORT-NEW diagnostics page (dist/renderer/index.html)
//   ELECTRON_RENDERER_URL        → original dev-server override (L60539), wins over both
//   legacy smoke (VIDEOCLAW_PORT_SMOKE=1 without HOME/S1/RELOAD modes) keeps the port page it drives.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PORT_RENDERER_ENV = "VIDEOCLAW_PORT_RENDERER";
export function resolveRendererEntry(o: { env: NodeJS.ProcessEnv; packaged: boolean; appPath: string; resourcesPath: string; mainDir: string; exists: (p: string) => boolean }): { url: string; kind: "override" | "original" | "port"; note?: string } {
  if (o.env.ELECTRON_RENDERER_URL) return { url: o.env.ELECTRON_RENDERER_URL, kind: "override" };
  const portPage = pathToFileURL(join(o.mainDir, "../renderer/index.html")).toString();
  const legacySmoke = o.env.VIDEOCLAW_PORT_SMOKE === "1" && !o.env.VIDEOCLAW_PORT_SMOKE_HOME && !o.env.VIDEOCLAW_PORT_SMOKE_S1 && !o.env.VIDEOCLAW_PORT_SMOKE_RELOAD;
  const mode = o.env[PORT_RENDERER_ENV] ?? (legacySmoke ? "port" : "original");
  if (mode === "port") return { url: portPage, kind: "port" };
  const original = o.packaged ? join(o.resourcesPath, "renderer-original", "index.html") : join(o.appPath, "..", "app", "out", "renderer", "index.html");
  if (!o.exists(original)) return { url: portPage, kind: "port", note: `original renderer not found at ${original}; using the port page` };
  return { url: pathToFileURL(original).toString(), kind: "original" };
}
