// Real (ported) handlers that replace fake-backend entries. Each entry cites the original
// registration. Anything whose collaborators are still unported stays on the fake backend.
//
//   editorRender:start/cancel/state  — original L62405-62428 (EditorRenderController +
//                                      utilityProcess editorRenderWorker.js, killGroup)
//   bootstrap:run                    — original Bootstrap.runAll; ONLY when the PORT-NEW env
//                                      var VIDEOCLAW_PORT_REAL_BOOTSTRAP=1 is set. Stops at doctor on
//                                      the `gateway` check (no gatewayUrl/key in the port) unless the
//                                      PORT-NEW VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1 accepts a report whose
//                                      ONLY failure is `gateway`; activation then runs the ported
//                                      assertEngineMoneyCompatibility (L6426) for real.
//   session:list                     — original L61697 host.listSessions(); served by the read-only
//                                      SessionRegistry over userData/sessions.json (no agent runtime).
//   editorRender getSession          — original liveSession L62403 → SessionRegistry.liveSession;
//   editorRender resolveEngine       — original resolveEditorRenderEngine + engineSessionEnv L9380.
//   settings:get / settings:set /    — original Settings (L5291) + setSettings (L61680) + host.llmRouteReadiness
//   engine:llmRouteReadiness           (L51052) with PORT-NEW custom-provider routes (docs/15 §3.4) — llm-runtime.ts.
//                                      PORT-NEW opt-out: VIDEOCLAW_PORT_FAKE_SETTINGS=1 keeps the QA fixtures.
//   session:create / session:send /  — original L61690 / L61772 / L61780 → host.createSession / sendMessage /
//   session:interrupt (+ push         interrupt, served by the PORT-NEW minimal AgentHost (docs/19, agent/agent-host.ts)
//   session:event / session:changed)  bound to the LLM route service; session:list merges sessions.json + host sessions.
//   docs/21 M2: when an engine is installed the AgentHost runs ENGINE sessions (agent/engine-session.ts):
//   workspace cwd, engineSessionEnv, assembled session context, project hooks, the original Bash
//   permission model, first-message job binding; sessions.json is WRITTEN (writeRegistry L36199) and
//   restored on launch. PORT-NEW opt-out: VIDEOCLAW_PORT_AGENT_ENGINE=0 keeps the docs/19 confined chat.
//   permission:respond (send, L61790) / interaction:replayPending (L61701) → host permission cards.
//   docs/21 M1 home boot (home-boot.ts): account:snapshot, app:update:get, workflowSubmit:eligibility,
//   bootstrap:status, client:list / client:create.
//   docs/22 M3: job:get / job:historicalSnapshot (+ push job:snapshot) → AgentHost + the verbatim
//   VersionStore / scanJob / JobWatcher (jobs/version-store.generated.ts); version:approve /
//   version:revertFinal / session:unfinalize; vcmedia:// (index.ts, media/media-ipc.ts);
//   file:saveItemAs / file:revealItem / file:openPath. docs/22 M4: intake:pickFiles,
//   attachment:stage/list/ownership/remove/retry/destination (+ push attachment:changed) → the
//   verbatim ComposerAttachmentStore (attachments/composer-attachments.generated.ts).
import { app, dialog, shell, utilityProcess } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InvokeChannel } from "../shared/ipc-contract";
import { EditorRenderController, type RenderWorker } from "./engine/editor-render";
import { resolveEditorRenderEngine } from "./engine/engine-env";
import { BootstrapCore, createRunner, notPortedHooks, resolveBundledEngineSource } from "./engine/bootstrap";
import { ensureEngineCommandShims } from "./engine/command-shims";
import { writeWorkspacePartial } from "./engine/workspace";
import { engineSessionEnv, SessionRegistry } from "./engine/session";
import { assertEngineMoneyCompatibility } from "./engine/money-compat.generated";
import { validateEngineSessionContext } from "./engine/session-context.generated";
import { assertInstalledEngineProductionContract, inspectInstalledEngineProductionContract } from "./engine/production-contract.generated";
import { bootstrapTool, killTree, resolveBootstrapToolRoots } from "./platform";
import { createLlmRuntime } from "./llm-runtime";
import { PORT_IPC, PORT_PUSH, type PortInvokeChannel } from "../shared/port-ipc";
import { portDiagnostics } from "./port-diagnostics";
import { AgentHost } from "./agent/agent-host";
import { agentHostEmit, agentIpcHandlers, agentToolsFromEnv, PORT_AGENT_TOOLS_ENV } from "./agent/agent-ipc";
import { claudeCodeExecutableFor, loadClaudeAgentSdk } from "./llm/agent-sdk";
import { accountSnapshot, bootstrapStatus, replayPendingInteractions, workflowSubmitEligibility } from "./home-boot";
import type { EngineSessionDeps } from "./agent/engine-session";
import { createMediaCapabilities, exposeJobSnapshot, fileIpcHandlers, smokeDialog } from "./media/media-ipc";

/** docs/22 M3: the main-process media capability registry (original L60408) behind vcmedia://. */
export const mediaCapabilities = createMediaCapabilities();
/** docs/22 M3: host.chatMediaRoot for the vcmedia HEAD grant (set once the AgentHost exists). */
export const mediaRoots: { chatMediaRoot: (sessionId: string) => string | null } = { chatMediaRoot: () => null };

/** PORT-NEW env var: VIDEOCLAW_PORT_AGENT_ENGINE=0 → docs/19 confined chat sessions even with an engine. */
export const PORT_AGENT_ENGINE_ENV = "VIDEOCLAW_PORT_AGENT_ENGINE";
/** Real handlers for ORIGINAL send (ipc.on) channels; index.ts routes them. */
export const sendHandlers: Partial<Record<string, Handler>> = {};

/** PORT-NEW env var (not in the original bundle). */
export const PORT_REAL_BOOTSTRAP_ENV = "VIDEOCLAW_PORT_REAL_BOOTSTRAP";
/** PORT-NEW env var: accept a doctor report whose only failing check is `gateway` (needs credentials). */
export const PORT_ACCEPT_GATEWAY_RED_ENV = "VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED";
export function onlyGatewayFailed(report: any): boolean {
  const failing = Object.entries(report?.checks ?? {}).filter(([, c]: any) => !c.ok).map(([k]) => k);
  return failing.length === 1 && failing[0] === "gateway";
}

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

/** PORT-NEW channels (shared/port-ipc.ts) filled by createRealHandlers; index.ts registers them. */
export const portHandlers: Partial<Record<PortInvokeChannel, Handler>> = {
  // fallback when the LLM runtime is not running (fake settings): an honest "nothing to choose"
  [PORT_IPC.llmRoutes]: () => ({ current: "claude-code", routes: [], configError: "LLM runtime not running (fake settings backend)" }),
  // docs/18: packaged-app self check (SDK discovery, node:sqlite, paths) — independent of the LLM runtime
  [PORT_IPC.diagnostics]: () => portDiagnostics({ version: app.getVersion(), packaged: app.isPackaged, resourcesPath: process.resourcesPath ?? null, appPath: app.getAppPath(), userData: app.getPath("userData") }),
};

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
      assertInstalledEngineProductionContract: (e) => assertInstalledEngineProductionContract(e),
      inspectProductionCompatible: (e) => inspectInstalledEngineProductionContract(e).compatible,
      ensureEngineCommandShims: (e) => ensureEngineCommandShims(e),
      writeWorkspace: (e, ws) => { const r = writeWorkspacePartial(e, ws ?? workspaceRoot()); log(`[port] writeWorkspace (CLAUDE.md + session-context validated); NOT PORTED: ${r.notPorted.join(", ")}`); },
      validateEngineSessionContext: (e) => { validateEngineSessionContext(e); },
      assertEngineMoneyCompatibility: (e) => assertEngineMoneyCompatibility(e),
      ...(process.env[PORT_ACCEPT_GATEWAY_RED_ENV] === "1"
        ? { doctorAccepts: (r: any) => { const ok = r.ok || onlyGatewayFailed(r); if (ok && !r.ok) log("[port] PORT-NEW: doctor accepted with only `gateway` red (needs credentials)"); return ok; } }
        : {}),
    }),
    createRunner(),
    (p) => push("bootstrap:progress", p),
    (line) => log(`[setup] ${line}`),
  );
  // AgentHost registry file: join(app.getPath("userData"), "sessions.json") (original L61106).
  const registry = new SessionRegistry(join(app.getPath("userData"), "sessions.json"));
  registry.load();
  const editorRender = new EditorRenderController({
    getSession: (id) => registry.liveSession(id) as any,
    resolveEngine: () => resolveEditorRenderEngine({
      isPackaged: app.isPackaged,
      env: process.env,
      currentEngine: () => core.currentEngine(),
      engineSessionEnv: () => engineSessionEnv({ currentEngine: () => core.currentEngine(), workspaceRoot, enginePathEnv: (p) => core.enginePathEnv(p) }),
      workspaceRoot,
    }),
    forkWorker: forkEditorRenderWorker,
    emit: (event) => push("editorRender:event", event), // original also grants mediaCapabilities (NOT PORTED)
    killGroup: (pgid) => { try { killTree(pgid, "SIGKILL"); } catch {} }, // original: process.kill(-pgid,"SIGKILL")
    log: (kind, detail) => log(`[main-log] ${kind} ${detail}`),
  });
  let registryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRows: () => Array<Record<string, unknown>> = () => [];
  const saveRegistry = () => { // saveRegistry L36125: 250 ms debounce
    if (registryTimer) return;
    registryTimer = setTimeout(() => { registryTimer = null; registry.writeRegistry(pendingRows()); }, 250);
  };
  const flushRegistry = () => { if (registryTimer) { clearTimeout(registryTimer); registryTimer = null; } return registry.writeRegistry(pendingRows()); };
  const handlers: Partial<Record<InvokeChannel, Handler>> = {
    "editorRender:start": (req: unknown) => editorRender.start(req as any),
    "editorRender:cancel": (requestId: unknown) => editorRender.cancel(requestId as string),
    "editorRender:state": () => editorRender.state(),
    "session:list": () => registry.listSessions(),
    // docs/21 M1 home boot
    "account:snapshot": () => accountSnapshot(),
    "app:update:get": () => null, // currentUpdateInfo (L60463) — no update checker in the port
    "workflowSubmit:eligibility": () => workflowSubmitEligibility(),
    "bootstrap:status": () => bootstrapStatus(core, { packaged: app.isPackaged, productionCompatible: (p) => inspectInstalledEngineProductionContract(p).compatible }),
    "client:list": () => registry.listClients(),
    "client:create": (name: unknown) => registry.createClient(name, saveRegistry),
    "interaction:replayPending": () => undefined,
    // docs/22 M3/M4: file:* + intake:pickFiles (original L61917-62001, L62157)
    ...(fileIpcHandlers({
      dialog: smokeDialog({ showSaveDialog: (o) => dialog.showSaveDialog(o), showOpenDialog: (o) => dialog.showOpenDialog(o as any) }, process.env, log),
      shell: { showItemInFolder: (p) => { if (process.env.VIDEOCLAW_PORT_SMOKE === "1") { log(`[smoke] showItemInFolder ${p}`); return; } shell.showItemInFolder(p); }, openPath: (p) => shell.openPath(p) },
      downloadsDir: () => app.getPath("downloads"),
      media: mediaCapabilities,
      sessionIds: () => (handlers["session:list"]?.() as any[] ?? []).map((m: any) => m.sessionId),
    }) as Partial<Record<InvokeChannel, Handler>>),
  };
  if (process.env[PORT_REAL_BOOTSTRAP_ENV] === "1") handlers["bootstrap:run"] = () => core.runAll();
  if (process.env.VIDEOCLAW_PORT_FAKE_SETTINGS !== "1") {
    try {
      let host: AgentHost | undefined;
      const llm = createLlmRuntime({
        userData: app.getPath("userData"),
        sessionMeta: (id) => (registry.sessions.get(id)?.meta as any) ?? host?.listSessions().find((m) => m.sessionId === id),
        // original setSettings → host.onLlmRouteChanged() (L61685)
        onLlmRouteChanged: () => { const r = host?.onLlmRouteChanged(); log(`[port] llmRoute changed — AgentHost retired runtimes; interrupted=${r?.interrupted.length ?? 0}`); },
        onRoutesChanged: (view) => { push(PORT_PUSH.llmRoutesChanged, view); },
      });
      Object.assign(handlers, llm.handlers);
      Object.assign(portHandlers, llm.portHandlers);
      const allSessions = () => [...(registry.listSessions() as any[]), ...(host?.listSessions() ?? [])];
      const engineMode = process.env[PORT_AGENT_ENGINE_ENV] !== "0" && !!core.currentEngine();
      const sessionEnvDeps = { currentEngine: () => core.currentEngine(), workspaceRoot, enginePathEnv: (p: string) => core.enginePathEnv(p) };
      const engineDeps: EngineSessionDeps | undefined = engineMode ? {
        workspaceRoot,
        currentEngine: () => core.currentEngine(),
        engineSessionEnv: () => engineSessionEnv(sessionEnvDeps),
        assertProductionContract: (e) => assertInstalledEngineProductionContract(e),
        isPackaged: app.isPackaged,
      } : undefined;
      if (engineDeps) {
        // writeWorkspace at session start keeps CLAUDE.md / settings current (the original runs it on
        // every activation; an engine staged by an older port build lacks CLAUDE.md)
        try { const eng = core.currentEngine(); if (eng) writeWorkspacePartial(eng.path, workspaceRoot()); } catch (e) { log(`[port] writeWorkspace at launch failed: ${e instanceof Error ? e.message : String(e)}`); }
      }
      const emit = agentHostEmit(push, allSessions);
      host = new AgentHost({
        emit: {
          ...emit,
          permissionRequest: (req) => { push("permission:request", req); },
          // original emit.jobSnapshot L61077: grant the snapshot's files, then push
          jobSnapshot: (sessionId, snapshot) => { exposeJobSnapshot(mediaCapabilities, snapshot); push("job:snapshot", { sessionId, snapshot }); },
        },
        engine: engineDeps,
        // docs/22: versions.json + composer-attachments.json live next to sessions.json (L34841-34848)
        ...(engineDeps ? { stateDir: app.getPath("userData") } : {}),
        persist: engineDeps ? () => saveRegistry() : undefined,
        service: llm.service,
        loadSdk: async () => { const l = await loadClaudeAgentSdk(); log(`[port] Claude Agent SDK ${l.version} from ${l.source}`); return { sdk: l.sdk, version: l.version, executable: claudeCodeExecutableFor(l.packageDir) }; },
        sessionsRoot: join(app.getPath("userData"), "agent-sessions"),
        tools: agentToolsFromEnv(process.env[PORT_AGENT_TOOLS_ENV]),
        // PORT-NEW: VIDEOCLAW_PORT_TURN_TIMEOUT_MS overrides the per-turn safety net (engine default 20 min)
        ...(Number(process.env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS) > 0 ? { turnTimeoutMs: Number(process.env.VIDEOCLAW_PORT_TURN_TIMEOUT_MS) } : {}),
      });
      const h = host;
      if (engineDeps) {
        // loadRegistry hand-off: the host owns (and persists) every sessions.json row from now on
        pendingRows = () => h.registryRows();
        const restored = h.restoreSessions(registry.takeSessions() as any);
        log(`[port] AgentHost ENGINE mode; restored ${restored} session(s) from sessions.json`);
      }
      Object.assign(handlers, agentIpcHandlers(h, allSessions));
      if (engineDeps) {
        mediaRoots.chatMediaRoot = (sessionId) => h.chatMediaRoot(sessionId);
        const attachmentChanged = (attachment: unknown) => { push("attachment:changed", attachment); }; // L62190
        Object.assign(handlers, {
          // docs/22 M3 (original L61751-61771)
          "job:get": (sessionId: unknown) => exposeJobSnapshot(mediaCapabilities, h.getJobSnapshot(String(sessionId))),
          "job:historicalSnapshot": (sessionId: unknown) => exposeJobSnapshot(mediaCapabilities, h.historicalJobSnapshot(String(sessionId))),
          "version:approve": (sessionId: unknown, n: unknown) => h.approveVersion(String(sessionId), Number(n)),
          "version:revertFinal": (sessionId: unknown, n: unknown) => h.revertFinal(String(sessionId), Number(n)),
          "session:unfinalize": (sessionId: unknown) => h.unfinalizeSession(String(sessionId)),
          // docs/22 M4 (original L62193-62219)
          "attachment:stage": (req: unknown) => h.stageComposerAttachments(req, attachmentChanged),
          "attachment:list": (sessionId: unknown) => h.listComposerAttachments(String(sessionId)),
          "attachment:ownership": (sessionId: unknown, id: unknown) => h.composerAttachmentOwnership(String(sessionId), String(id)),
          "attachment:remove": (sessionId: unknown, id: unknown) => h.removeComposerAttachment(String(sessionId), String(id)),
          "attachment:retry": (sessionId: unknown, id: unknown) => h.retryComposerAttachment(String(sessionId), String(id), attachmentChanged),
          "attachment:destination": (sessionId: unknown, ids: unknown, destination: unknown) => h.setComposerAttachmentDestination(String(sessionId), (Array.isArray(ids) ? ids : []).map(String), String(destination)),
        } as Partial<Record<InvokeChannel, Handler>>);
      }
      handlers["interaction:replayPending"] = () => replayPendingInteractions(h.listPendingInteractions(), push);
      sendHandlers["permission:respond"] = (requestId: unknown, response: unknown) => h.respondPermission(String(requestId), response as any);
      app.on("will-quit", () => { void h.dispose(); llm.dispose(); if (engineDeps) flushRegistry(); });
    } catch (e) {
      // graceful degradation: the fake settings fixtures stay in place
      log(`[port] LLM runtime failed to start, settings stay on the fake backend: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return handlers;
}
