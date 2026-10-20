// Real (ported) handlers that replace fake-backend entries. Each entry cites the original
// registration. Anything whose collaborators are still unported stays on the fake backend.
//
//   editorRender:start/cancel/state  — original L62405-62428 (EditorRenderController +
//                                      utilityProcess editorRenderWorker.js, killGroup)
//   bootstrap:run                    — original Bootstrap.runAll; ONLY when the PORT-NEW env
//                                      var VIDEOCLAW_PORT_REAL_BOOTSTRAP=1 is set. Expected to run
//                                      through doctor, then fail at activation:
//                                      NOT PORTED assertEngineMoneyCompatibility.
import { app, utilityProcess } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InvokeChannel } from "../shared/ipc-contract";
import { EditorRenderController, type RenderWorker } from "./engine/editor-render";
import { resolveEditorRenderEngine } from "./engine/engine-env";
import { BootstrapCore, createRunner, notPortedHooks, resolveBundledEngineSource } from "./engine/bootstrap";
import { ensureEngineCommandShims } from "./engine/command-shims";
import { writeWorkspacePartial } from "./engine/workspace";
import { bootstrapTool, killTree, resolveBootstrapToolRoots } from "./platform";

/** PORT-NEW env var (not in the original bundle). */
export const PORT_REAL_BOOTSTRAP_ENV = "VIDEOCLAW_PORT_REAL_BOOTSTRAP";

type Handler = (...args: any[]) => unknown;

function forkEditorRenderWorker(): RenderWorker { // original L60654-60670
  const child = utilityProcess.fork(join(__dirname, "editorRenderWorker.cjs"), [], { serviceName: "videoclaw-editor-render" });
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => { child.on("message", (m: any) => cb(m)); },
    onExit: (cb) => { child.on("exit", (code: number) => cb(code)); },
    kill: () => { child.kill(); },
  };
}

export function createRealHandlers(push: (channel: string, ...a: unknown[]) => boolean, log: (m: string) => void): Partial<Record<InvokeChannel, Handler>> {
  const roots = resolveBootstrapToolRoots({ resourcesPath: process.resourcesPath ?? "", appPath: app.getAppPath(), packaged: app.isPackaged });
  // workspaceRoot (main/index.js L9176-9180): join(homedir(), workspaceLeafForChannel("prod")),
  // leaf "Videoclaw" (out/main/chunks/workbookContents-ChzKjQX1.js L24). The staging-flight
  // profile branch (resolveStagingFlightProfile) only applies to channel "staging" — skipped.
  const workspaceRoot = () => join(homedir(), "Videoclaw");
  const core = new BootstrapCore(
    {
      platform: process.platform,
      userData: app.getPath("userData"),
      workspaceRoot: workspaceRoot(),
      bootstrapRoots: roots,
      packaged: app.isPackaged,
      inheritedPath: process.env.PATH ?? process.env.Path,
      bootstrapTool: (n) => bootstrapTool(n, { roots, exists: existsSync }),
    },
    notPortedHooks({
      resolveEngineSource: async () => resolveBundledEngineSource({ resourcesPath: process.resourcesPath ?? "", env: process.env, appVersion: app.getVersion(), packaged: app.isPackaged }),
      assertInstalledEngineProductionContract: () => log("[port] SKIPPED assertInstalledEngineProductionContract (NOT PORTED)"),
      ensureEngineCommandShims: (e) => ensureEngineCommandShims(e),
      writeWorkspace: (e, ws) => { const r = writeWorkspacePartial(e, ws ?? workspaceRoot()); log(`[port] PARTIAL writeWorkspace; NOT PORTED: ${r.notPorted.join(", ")}`); },
      validateEngineSessionContext: () => log("[port] SKIPPED validateEngineSessionContext (NOT PORTED)"),
    }),
    createRunner(),
    (p) => push("bootstrap:progress", p),
    (line) => log(`[setup] ${line}`),
  );
  const editorRender = new EditorRenderController({
    getSession: () => undefined, // TODO: session host not ported → every start is "unknown-session"
    resolveEngine: () => resolveEditorRenderEngine({
      isPackaged: app.isPackaged,
      env: process.env,
      currentEngine: () => core.currentEngine(),
      engineSessionEnv: () => { throw new Error("NOT PORTED: engineSessionEnv L9380"); },
      workspaceRoot,
    }),
    forkWorker: forkEditorRenderWorker,
    emit: (event) => push("editorRender:event", event), // original also grants mediaCapabilities (NOT PORTED)
    killGroup: (pgid) => { try { killTree(pgid, "SIGKILL"); } catch {} }, // original: process.kill(-pgid,"SIGKILL")
    log: (kind, detail) => log(`[main-log] ${kind} ${detail}`),
  });
  const handlers: Partial<Record<InvokeChannel, Handler>> = {
    "editorRender:start": (req: unknown) => editorRender.start(req as any),
    "editorRender:cancel": (requestId: unknown) => editorRender.cancel(requestId as string),
    "editorRender:state": () => editorRender.state(),
  };
  if (process.env[PORT_REAL_BOOTSTRAP_ENV] === "1") handlers["bootstrap:run"] = () => core.runAll();
  return handlers;
}
