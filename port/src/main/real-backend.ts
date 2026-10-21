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
//   docs/24: characters:list (L61860) → the verbatim CharacterStore + exposeCharacters (L60415);
//   quickstart:catalog (L61215, + push quickstart:catalogChanged) → the verbatim QuickstartCatalogStore
//   over the shipped bundled catalog (quickstart/quickstart-ipc.ts); session:history (agent-ipc.ts).
import { app, BrowserWindow, dialog, ipcMain, nativeImage, session as electronSession, shell, systemPreferences, utilityProcess } from "electron";
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
import { codexChannels } from "./codex/codex-channels";
import { resolveCodexExecutable, resolveMiniMaxCodexProvider } from "./codex/codex-minimax";
import { codexProcessesStopped } from "./codex/app-server-client";
import { claudeCodeExecutableFor, loadClaudeAgentSdk } from "./llm/agent-sdk";
import { accountSnapshot, bootstrapStatus, replayPendingInteractions, workflowSubmitEligibility } from "./home-boot";
import type { EngineSessionDeps } from "./agent/engine-session";
import { createMediaCapabilities, exposeJobSnapshot, fileIpcHandlers, smokeDialog } from "./media/media-ipc";
import { CharacterStore } from "./characters/character-store.generated";
import { createQuickstartCatalog } from "./quickstart/quickstart-ipc";
import { PORT_PROVIDER_TITLES_ENV } from "./agent/session-title";
import { localChannelHandlers } from "./local-channels";
import { localChannels26 } from "./local-channels-26";
import { QuickstartStartCoordinator } from "./quickstart/quickstart-start.generated";
import { writeProjectPack } from "./taste/project-pack.generated";
import { createLibraryMutationGate, libraryAddSource, libraryErrorMessage, libraryKey, libraryPreview, libraryRemoveSource, libraryScan, libraryStats, librarySearch, librarySync } from "./library/library.generated";
import { randomUUID } from "node:crypto";
import { configureLibraryEnv } from "./library/library-env";
import { configureVoiceTools } from "./attachments/voice-tools";
import { attachmentIntakeHandlers } from "./attachments/attachment-ipc";
import { sweepClipboardImageIntake } from "./attachments/composer-attachments.generated";
import { FeedbackService } from "./feedback/feedback.generated";
import { configureFeedbackEnv, recordMainLog } from "./feedback/feedback-env";
import { HyperframesPreviewController, validateInPolicyWorker } from "./hyperframes/hf-preview.generated";
import { LocalResetController, LocalResetRecoveryError, LOCAL_RESET_MARKER, runPendingLocalReset } from "./account/local-reset.generated";
import { CredentialStore } from "./account/local-reset-env";
import { AccountService, ACCOUNT_BLOCKED_COPY } from "./account/account-service";
import { gatewayChannels } from "./gateway/gateway-channels";
import { LocalGatewayShim, localGatewayEnabled, localGatewayMonthUsd, localGatewayPort } from "./gateway/local-gateway-shim";
import { minimaxConfig } from "./llm/minimax";
import { minimaxModelsDevProviders, priceTable } from "./gateway/pricing";
import { syncModelsDevIfStale } from "./models-dev/startup-sync";
import { registerSecret } from "./llm/logger";
import { miniMaxClaudeModelSource } from "./agent/claude-code";
import { purgeExpiredProjectTrash } from "./jobs/project-trash.generated";
// docs/29 (M12): the last category-(b) channels
import { remainingChannels } from "./remaining-channels";
import { ProjectMemoryHost } from "./memory/project-memory-host";
import { AgentGatewayProxy } from "./gateway/agent-gateway-proxy";
import { Outbox } from "./telemetry/outbox.generated";
import { sessionIndexProjection } from "./telemetry/session-index.generated";
import { createUpdatePreferences, selectedUpdateChannel, startUpdateCheck } from "./update/update-check.generated";
import { createAppUpdater, quiesceForUpdate } from "./update/app-updater.generated";
import { QuitCoordinator, quitDialogOptions, QUIT_BUTTON_INDEX, videoTitles } from "./quit/quit-coordinator.generated";
import { PROD_GATEWAY_URL } from "./settings/settings-store";
import { INVOKE_CHANNELS, SEND_CHANNELS } from "../shared/ipc-contract";
import { configureSheetEnv } from "./characters/sheet-env";
import { CharacterSheetBuilder } from "./characters/character-sheet.generated";
import { voiceTools } from "./attachments/voice-tools";
import { isVoiceNoteAudio, voiceErrors } from "./attachments/voice-note.generated";

/** exposeCharacters (L60415): grant each character's sheet + refs to vcmedia. */
export function exposeCharacters<T extends { sheetPath?: string; refs: string[] }>(media: { grant(p: string, s: string): boolean; grantMany(p: string[], s: string): void }, characters: T[]): T[] {
  for (const character of characters) {
    media.grant(character.sheetPath ?? "", "character");
    media.grantMany(character.refs, "character");
  }
  return characters;
}
/** absCwd (L60293). */
export const absCwd = (cwd: string) => cwd.replace(/^~(?=$|\/)/, homedir());

/** docs/22 M3: the main-process media capability registry (original L60408) behind vcmedia://. */
export const mediaCapabilities = createMediaCapabilities();
/** docs/22 M3: host.chatMediaRoot for the vcmedia HEAD grant (set once the AgentHost exists). */
export const mediaRoots: { chatMediaRoot: (sessionId: string) => string | null } = { chatMediaRoot: () => null };

/** PORT-NEW env var: VIDEOCLAW_PORT_AGENT_ENGINE=0 → docs/19 confined chat sessions even with an engine. */
export const PORT_AGENT_ENGINE_ENV = "VIDEOCLAW_PORT_AGENT_ENGINE";
/** Real handlers for ORIGINAL send (ipc.on) channels; index.ts routes them. */
export const sendHandlers: Partial<Record<string, Handler>> = {};
/** trackIpcRequests().pendingExcept (L2429) — index.ts binds it before createRealHandlers (installBlocker L62552). */
export const ipcTracking: { pendingExcept: (channel: string) => boolean } = { pendingExcept: () => false };
/** PORT-NEW harness seam (docs/33 M16 T3): a local HTTPS release feed standing in for the release gateway. The
 *  original enables in-app updates only for an installed Mac build on its trusted https gateway (L2227-2231); with
 *  this env set, that gate is evaluated as platform "darwin" against the harness feed, and electron-updater's real
 *  Linux driver (AppImageUpdater) does the check / download / quitAndInstall. Never set in normal runs. */
export const PORT_UPDATE_HARNESS_ENV = "VIDEOCLAW_PORT_UPDATE_HARNESS_GATEWAY";

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

/** forkHfPreviewWorker / forkHfPolicyWorker (original L60687 / L60716). */
function forkUtility(file: string, serviceName: string): RenderWorker {
  const child = utilityProcess.fork(join(__dirname, file), [], { serviceName });
  return {
    postMessage: (m) => child.postMessage(m),
    onMessage: (cb) => { child.on("message", (m: any) => cb(m)); },
    onExit: (cb) => { child.on("exit", (code: number) => cb(code)); },
    kill: () => { child.kill(); },
  };
}

/** PORT-NEW env: the workspace root (original workspaceRoot L9176, channel "prod"). */
const portWorkspaceRoot = () => join(homedir(), "Videoclaw");
/** finishPendingLocalReset (L62614): a committed local reset finishes BEFORE anything else opens. */
export async function finishPendingLocalReset(log: (m: string) => void): Promise<boolean> {
  const userData = app.getPath("userData");
  if (!existsSync(join(userData, LOCAL_RESET_MARKER))) return true;
  for (;;) {
    try {
      await runPendingLocalReset({
        userDataDir: userData,
        channel: "prod",
        workspace: portWorkspaceRoot(),
        packaged: app.isPackaged,
        // initializeWorkspaceChannel (L4454) directory set
        initializeWorkspace: (workspace: string) => { for (const d of ["jobs", "assets", "incoming", "taste", join("taste", "packs"), ".claude"]) mkdirSync(join(workspace, d), { recursive: true }); },
        rebuildEngineWorkspace: () => false, // PORT: the engine pointer lived in userData and is gone; setup re-runs
        verifyEngineWorkspace: () => {},
        clearBrowserStorage: async () => { await electronSession.defaultSession.clearStorageData(); await electronSession.defaultSession.clearCache(); },
        log: (line: string) => { recordMainLog("local-reset", line); log(`[local-reset] ${line}`); },
      });
      return true;
    } catch (err) {
      const step = err instanceof LocalResetRecoveryError ? (err as any).step : "unknown";
      log(`[local-reset] blocked at ${step}`);
      if (process.env.VIDEOCLAW_PORT_UI_E2E === "1" || process.env.VIDEOCLAW_PORT_SMOKE === "1") { app.exit(1); return false; }
      const { response } = await dialog.showMessageBox({
        type: "error", buttons: ["Try again", "Quit VideoClaw"], defaultId: 0, cancelId: 1,
        message: "VideoClaw didn’t finish resetting this Mac",
        detail: `${err instanceof LocalResetRecoveryError ? (err as Error).message : "Something went wrong."} VideoClaw won’t open until the reset is finished, so nothing runs half-reset. Your archived workspace and your other AI accounts are untouched.`,
      });
      if (response !== 0) { app.exit(0); return false; }
    }
  }
}

/** PORT-NEW channels (shared/port-ipc.ts) filled by createRealHandlers; index.ts registers them. */
export const portHandlers: Partial<Record<PortInvokeChannel, Handler>> = {
  // fallback when the LLM runtime is not running (fake settings): an honest "nothing to choose"
  [PORT_IPC.llmRoutes]: () => ({ current: "claude-code", routes: [], configError: "LLM runtime not running (fake settings backend)" }),
  // docs/18: packaged-app self check (SDK discovery, node:sqlite, paths) — independent of the LLM runtime
  [PORT_IPC.diagnostics]: () => portDiagnostics({ version: app.getVersion(), packaged: app.isPackaged, resourcesPath: process.resourcesPath ?? null, appPath: app.getAppPath(), userData: app.getPath("userData") }),
};

/** appendSetupLog (L9850, verbatim body): the plain-text setup trail bootstrap:revealSetupLog reveals (docs/25). */
function appendSetupLog(line: string): void {
  try {
    const file = join(app.getPath("userData"), "setup.log");
    if (existsSync(file) && statSync(file).size > 512 * 1024) rmSync(file, { force: true });
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 384 });
  } catch {}
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
    (line) => { log(`[setup] ${line}`); appendSetupLog(line); },
  );
  // AgentHost registry file: join(app.getPath("userData"), "sessions.json") (original L61106).
  const registry = new SessionRegistry(join(app.getPath("userData"), "sessions.json"));
  registry.load();
  // docs/26: liveSession (L62403) — the AgentHost owns the rows in engine mode (registry.takeSessions)
  let hostRef: AgentHost | undefined;
  const liveSession = (id: string) => ((hostRef?.liveSession(id) as any) ?? registry.liveSession(id)) as any;
  const editorRender = new EditorRenderController({
    getSession: (id) => liveSession(id),
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
  const characterStore = new CharacterStore(); // AgentHost.characterStore (L35028)
  const quickstart = createQuickstartCatalog({
    packaged: app.isPackaged, env: process.env, resourcesPath: process.resourcesPath ?? "", appPath: app.getAppPath(), userData: app.getPath("userData"),
    grant: (p, s) => mediaCapabilities.grant(p, s), push, log: (kind, detail) => log(`[main-log] ${kind} ${detail}`),
  });
  let registryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRows: () => Array<Record<string, unknown>> = () => [];
  const saveRegistry = () => { // saveRegistry L36125: 250 ms debounce
    if (registryTimer) return;
    registryTimer = setTimeout(() => { registryTimer = null; registry.writeRegistry(pendingRows()); }, 250);
  };
  const flushRegistry = () => { if (registryTimer) { clearTimeout(registryTimer); registryTimer = null; } return registry.writeRegistry(pendingRows()); };
  // smoke / UI-e2e runs never open a real file manager or browser (the call is logged instead)
  const smoke = () => process.env.VIDEOCLAW_PORT_SMOKE === "1" || process.env.VIDEOCLAW_PORT_UI_E2E === "1";
  const guardedShell = {
    showItemInFolder: (p: string) => { if (smoke()) { log(`[smoke] showItemInFolder ${p}`); return; } shell.showItemInFolder(p); },
    openExternal: async (url: string) => { if (smoke()) { log(`[smoke] openExternal ${url.slice(0, 200)}`); return; } await shell.openExternal(url); },
  };
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
    // docs/24 (B): host.listCharacters(absCwd(cwd)) = characterStore.list (L45016)
    "characters:list": (cwd: unknown) => exposeCharacters(mediaCapabilities as any, characterStore.list(absCwd(cwd as string))),
    // docs/24 (C1): original L61215 over the bundled catalog
    "quickstart:catalog": () => quickstart.handlers["quickstart:catalog"](),
    // docs/25: original L61250-61293 (local latency ring; no outbox → no beacon)
    "quickstart:mark": (...a: unknown[]) => quickstart.handlers["quickstart:mark"](...a),
    "quickstart:impression": (...a: unknown[]) => quickstart.handlers["quickstart:impression"](...a),
    "quickstart:previewed": (...a: unknown[]) => quickstart.handlers["quickstart:previewed"](...a),
    // docs/22 M3/M4: file:* + intake:pickFiles (original L61917-62001, L62157)
    ...(fileIpcHandlers({
      dialog: smokeDialog({ showSaveDialog: (o) => dialog.showSaveDialog(o), showOpenDialog: (o) => dialog.showOpenDialog(o as any) }, process.env, log),
      shell: { showItemInFolder: guardedShell.showItemInFolder, openPath: (p) => shell.openPath(p) },
      downloadsDir: () => app.getPath("downloads"),
      media: mediaCapabilities,
      sessionIds: () => (handlers["session:list"]?.() as any[] ?? []).map((m: any) => m.sessionId),
    }) as Partial<Record<InvokeChannel, Handler>>),
  };
  if (process.env[PORT_REAL_BOOTSTRAP_ENV] === "1") handlers["bootstrap:run"] = () => core.runAll();
  // docs/25: local / no-credential channels (local-channels.ts). Host-backed entries are re-bound below
  // once the AgentHost exists; without one they refuse instead of returning undefined.
  const localDeps = {
    registry, saveRegistry, flushRegistry, shell: guardedShell, platform: process.platform, systemPreferences: systemPreferences as any,
    absCwd, userData: app.getPath("userData"), characterStore,
    exposeCharacter: (c: any) => { if (c) exposeCharacters(mediaCapabilities as any, [c]); return c; }, // L60422
    log,
  };
  let latestLocal: ReturnType<typeof localChannelHandlers> | null = null;
  const bindLocal = (host?: AgentHost) => {
    const local = localChannelHandlers({ ...localDeps, host }); latestLocal = local;
    Object.assign(handlers, local.invoke);
    Object.assign(sendHandlers, local.send);
  };
  bindLocal();
  // ── docs/26: the remaining local channels (local-channels-26.ts) ──
  const sessionEnvDeps0 = { currentEngine: () => core.currentEngine(), workspaceRoot, enginePathEnv: (p: string) => core.enginePathEnv(p) };
  // docs/29: mutable links the M12 wiring fills once the gateway / account / host exist
  const m12: { shimUrl?: string; outbox?: any; account?: AccountService; settings?: { get(): any; patch(u: any): unknown }; sheetBuilder?: any; proxy?: AgentGatewayProxy | null } = {};
  // engineSessionEnv(gatewayKey?, gatewayUrl?) as the Library module calls it (L9380): the scoped lease's
  // loopback capability reaches the engine as VIDEOCLAW_GATEWAY_URL / VIDEOCLAW_API_KEY (engineGatewaySessionConfig
  // L9332 = the opened gateway — set only when the docs/28 local gateway is on)
  const leaseEnvDeps = { ...sessionEnvDeps0, gatewaySessionConfig: () => (m12.shimUrl ? { gatewayUrl: m12.shimUrl } : undefined) };
  configureLibraryEnv((k?: string, u?: string) => engineSessionEnv(leaseEnvDeps, k, u) as Record<string, string>);
  configureSheetEnv({ userData: () => app.getPath("userData"), isPackaged: () => app.isPackaged, currentEngine: () => core.currentEngine(), engineSessionEnv: (k?: string, u?: string) => engineSessionEnv(leaseEnvDeps, k, u) as Record<string, string> });
  // voiceTools (L10465) = the bundled helper roots; PORT-NEW fallback: the installed engine's bin/ffmpeg
  configureVoiceTools(() => [...roots, ...(core.currentEngine() ? [join(core.currentEngine()!.path, "bin")] : [])]);
  configureFeedbackEnv({ currentEngine: () => core.currentEngine() });
  const resolveEngineForPreview = () => resolveEditorRenderEngine({
    isPackaged: app.isPackaged, env: process.env, currentEngine: () => core.currentEngine(),
    engineSessionEnv: () => engineSessionEnv(sessionEnvDeps0), workspaceRoot,
  });
  const hfPreview = new HyperframesPreviewController({ // L62417
    getSession: liveSession,
    resolvePreviewAssets: () => { // resolveHyperframesPreviewAssets (L60671)
      const engine: any = resolveEngineForPreview();
      if (!engine) return null;
      const playerScriptPath = join(engine.root, "hyperframes", "node_modules", "hyperframes", "dist", "hyperframes-player.global.js");
      const runtimeDir = join(engine.root, "hyperframes", "runtime");
      return existsSync(playerScriptPath) && existsSync(runtimeDir) ? { playerScriptPath, runtimeDir } : null;
    },
    forkWorker: () => forkUtility("hyperframesPreviewWorker.cjs", "videoclaw-hf-preview"),
    validateComposition: (compositionDir: string, entryPath: string, runtimeDir: string) => validateInPolicyWorker(() => forkUtility("hyperframesPolicyWorker.cjs", "videoclaw-hf-policy"), { compositionDir, entryPath, runtimeDir }),
    emit: (event: unknown) => push("hfPreview:event", event),
    isRenderActive: (jobId: string) => (editorRender.state() as any)?.jobId === jobId,
    log: (kind: string, detail: string) => { recordMainLog(kind, detail); log(`[main-log] ${kind} ${detail}`); },
  });
  const feedback = new FeedbackService({ // L62298 — docs/29: outbox / account / settings linked once they exist
    win: () => BrowserWindow.getAllWindows()[0] ?? null,
    settings: () => (m12.account ? m12.account.activeSettings() : { telemetry: false }),
    listSessions: () => (handlers["session:list"]?.() as any[]) ?? [],
    getJobSnapshot: (sessionId: string) => { try { return hostRef?.getJobSnapshot(sessionId) ?? null; } catch { return null; } },
    mediaRecoveryEvidence: () => undefined,
    bootstrapStatus: () => core.status(),
    outboxSummary: () => (m12.outbox ? m12.outbox.summary() : { pending: 0 }),
    updateDiagnostics: () => ({ state: null }), // appUpdater is darwin-only (category c)
    outboxFailureEvidence: () => (m12.outbox ? m12.outbox.failureEvidence() : []),
    enqueueFeedback: async (data: unknown) => {
      if (!m12.outbox) throw new Error("Feedback delivery needs a Videoclaw account.");
      return m12.outbox.enqueueDurableAndTry("feedback", data);
    },
    patchSettings: (patch: any) => { m12.settings?.patch(patch); },
    blockedReason: () => (m12.account ? String(m12.account.account.step ?? "signed-out") : "signed-out"),
    // #378 (L62334): durable consent record; reconcileUsageSharing's alpha-consent half is the local-studio policy
    grantUsageSharing: async () => {
      const already = m12.account?.activeSettings().usageSharingConsentAt;
      m12.settings?.patch({ telemetry: true, usageSharingConsentAt: already ?? Date.now() });
    },
  });
  feedback.sweep();
  const localReset = new LocalResetController({ // L61459
    userDataDir: app.getPath("userData"),
    channel: "prod",
    workspace: () => portWorkspaceRoot(),
    keepSharedDevWorkspace: false,
    assertCredentialsMutable: () => new CredentialStore({ file: join(app.getPath("userData"), "credentials.dat"), packaged: app.isPackaged }).assertCanMutate(),
    runningVideos: () => hostRef?.runningVideoCount() ?? 0,
    unsyncedRecords: () => 0, // no outbox
    blockPaidWork: () => {},
    stopAuthenticatedWork: () => {},
    stopEditorRendering: () => { try { const st: any = editorRender.state(); if (st?.requestId) void editorRender.cancel(st.requestId); } catch {} hfPreview.stop("closed"); return []; },
    codexProcessesStopped: (timeoutMs: number) => codexProcessesStopped(timeoutMs), // docs/27: the port's codex process slots (L23382)
    stopEngineChildren: () => hostRef?.closeAll() ?? [],
    processesExited: async () => true,
    flushOutbox: async () => {},
    stopOutbox: async () => {},
    relaunch: () => { if (smoke()) { log("[smoke] local-reset relaunch requested"); return; } app.relaunch(); app.exit(0); },
    log: (line: string) => { recordMainLog("local-reset", line); log(`[local-reset] ${line}`); },
  });
  const clipboardIntakeDir = join(app.getPath("userData"), "composer-clipboard"); // L62215
  const libraryGate = createLibraryMutationGate();
  let quickstartStart: { start(req: unknown): Promise<any> } | undefined;
  const bindLocal26 = (host?: AgentHost) => {
    Object.assign(handlers, localChannels26({
      host, registry, saveRegistry, absCwd,
      media: mediaCapabilities as any,
      pathToVcmedia: (p) => `vcmedia://local${pathToFileURL(p).pathname}`,
      quickstart: quickstartStart,
      writeProjectPack: (cwd, slug, name, brief) => writeProjectPack(cwd, slug, name, brief),
      library: {
        stats: libraryStats, scan: libraryScan, addSource: libraryAddSource, removeSource: libraryRemoveSource, preview: libraryPreview,
        errorMessage: libraryErrorMessage, key: libraryKey, gate: libraryGate, previewCacheDir: join(app.getPath("userData"), "library-previews"),
      },
      pickDirectory: async () => {
        const preset = process.env.VIDEOCLAW_PORT_SMOKE_PICK_DIR;
        if (smoke() && preset) return preset;
        const res = await dialog.showOpenDialog({ title: "Add a footage or stills folder", properties: ["openDirectory", "createDirectory"] });
        return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
      },
      characterStore,
      exposeCharacter: localDeps.exposeCharacter,
      sheetStates: (cwd: string) => m12.sheetBuilder?.statesFor(cwd) ?? [], // CharacterSheetBuilder.statesFor (L19470)
      // characterVoiceErrorText(ProjectMemoryError) from memoryBinding (L36456): no verified account
      characterVoiceUnavailable: () => ({ ok: false, message: "Project memory is unavailable until this account and project are verified." }),
      bootstrap: core,
      feedback,
      hfPreview,
      localReset,
      attachments: host?.attachmentStore ? attachmentIntakeHandlers({ host, intakeDir: clipboardIntakeDir, media: mediaCapabilities, image: (b) => nativeImage.createFromBuffer(b) as any, onChanged: (a) => { push("attachment:changed", a); } }) : undefined,
      recordMainLog,
    }) as Partial<Record<InvokeChannel, Handler>>);
  };
  bindLocal26();
  if (process.env.VIDEOCLAW_PORT_FAKE_SETTINGS !== "1") {
    try {
      let host: AgentHost | undefined;
      const llm = createLlmRuntime({
        userData: app.getPath("userData"),
        activeSettings: () => (m12.account ? m12.account.activeSettings() : null), // docs/29: the vault gatewayKey
        sessionMeta: (id) => (registry.sessions.get(id)?.meta as any) ?? host?.listSessions().find((m) => m.sessionId === id),
        // original setSettings → host.onLlmRouteChanged() (L61685)
        onLlmRouteChanged: () => { const r = host?.onLlmRouteChanged(); log(`[port] llmRoute changed — AgentHost retired runtimes; interrupted=${r?.interrupted.length ?? 0}`); },
        onRoutesChanged: (view) => { push(PORT_PUSH.llmRoutesChanged, view); },
      });
      Object.assign(handlers, llm.handlers);
      Object.assign(portHandlers, llm.portHandlers);
      // ── docs/28: the local gateway + billing shim (opt-in VIDEOCLAW_PORT_LOCAL_GATEWAY=1) and the account /
      // gateway-key / billing channels over the verbatim CredentialStore + resolveAccountSnapshot ──
      const userDataDir = app.getPath("userData");
      const credentials = new CredentialStore({ file: join(userDataDir, "credentials.dat"), packaged: app.isPackaged, log: (line: string) => recordMainLog("credentials", line) } as any);
      let shimReady: Promise<unknown> = Promise.resolve();
      // docs/30: THE price table — models.dev first (row of the MiniMax provider actually called), shared by the
      // local gateway ledger and every route's displayed spend; each model's resolved source is logged
      const pricedVia = minimaxConfig();
      const sharedPrice = priceTable({
        providers: minimaxModelsDevProviders(pricedVia?.baseUrl),
        onResolve: (model, p) => log(`[port] pricing: ${model} priced from ${p.source} (USD/MTok in ${p.inputPerMTokUsd} out ${p.outputPerMTokUsd} cacheRead ${p.cacheReadPerMTokUsd ?? "-"} cacheWrite ${p.cacheWritePerMTokUsd ?? "-"})`),
      });
      void syncModelsDevIfStale({ log });
      if (localGatewayEnabled()) {
        const shimPort = localGatewayPort();
        const shimUrl = `http://127.0.0.1:${shimPort}`;
        const shim = new LocalGatewayShim({ dir: join(userDataDir, "local-gateway"), provider: () => minimaxConfig(), price: sharedPrice, port: shimPort, monthUsd: localGatewayMonthUsd(), log, appVersion: app.getVersion() });
        // PORT-NEW: this process opens on the self-hosted gateway, and a first launch provisions its vc_ key
        // into the vault (the key the user would otherwise paste under "I already have an alpha key")
        if (String(llm.settings.get().gatewayUrl ?? "").replace(/\/+$/, "") !== shimUrl) llm.settings.patch({ gatewayUrl: shimUrl });
        const existing = credentials.activeKey(shimUrl);
        if (existing) registerSecret(existing);
        else { const issued = shim.issueKey(); registerSecret(issued.key); credentials.setActiveKey(shimUrl, issued.key); log(`[port] local gateway: issued key ${issued.hint} for the self-hosted account`); }
        shimReady = shim.start().then((url) => log(`[port] local gateway shim listening on ${url}`), (e) => log(`[port] local gateway shim failed to start: ${e instanceof Error ? e.message : String(e)}`));
        app.on("will-quit", () => { void shim.close(); });
      }
      const accountService = new AccountService({
        settings: llm.settings as any, credentials: credentials as any, openedGatewayUrl: String(llm.settings.get().gatewayUrl ?? ""),
        packaged: app.isPackaged, appVersion: app.getVersion(), push: (ch, ...a) => { push(ch, ...a); },
        openExternal: guardedShell.openExternal, stopAuthenticatedWork: () => { (host as any)?.stopAuthenticatedWork?.(); },
      });
      void shimReady.then(() => accountService.resolveAccount()).catch(() => {}); // `void resolveAccount()` at launch (L60955)
      m12.account = accountService;
      m12.settings = llm.settings as any;
      // docs/29: outbox (L60953) + AgentGatewayProxy (L61003) — only against the self-hosted loopback gateway,
      // so the port never posts telemetry / feedback to the production gateway
      const openedUrl = String(accountService.activeSettings().gatewayUrl ?? "");
      const loopbackGateway = /^http:\/\/127\.0\.0\.1:\d+$/.test(openedUrl.replace(/\/+$/, ""));
      if (localGatewayEnabled() && loopbackGateway) {
        m12.shimUrl = openedUrl.replace(/\/+$/, "");
        const outbox: any = new (Outbox as any)(join(userDataDir, "outbox.json"), () => accountService.activeSettings());
        outbox.start();
        m12.outbox = outbox;
        app.on("will-quit", () => { try { outbox.stop(); } catch {} });
        const openedKey = accountService.activeSettings().gatewayKey;
        if (openedKey) {
          const shimBase = m12.shimUrl;
          void shimReady.then(() => AgentGatewayProxy.start(shimBase, String(openedKey))).then((proxy) => {
            m12.proxy = proxy;
            log(`[port] agent gateway proxy on ${proxy.origin}`);
          }, (e) => log(`[port] agent gateway proxy failed to start: ${e instanceof Error ? e.message : String(e)}`));
          app.on("will-quit", () => { m12.proxy?.close(); });
        }
      }
      for (const [ch, fn] of Object.entries(gatewayChannels(accountService, { userData: userDataDir }))) {
        (handlers as any)[ch] = async (...a: unknown[]) => { await shimReady; return fn(...a); };
      }
      const allSessions = () => [...(registry.listSessions() as any[]), ...(host?.listSessions() ?? [])];
      const engineMode = process.env[PORT_AGENT_ENGINE_ENV] !== "0" && !!core.currentEngine();
      // configureEngineGatewaySession (L9356, called at startup L60937 with the opened gateway URL): configuredGatewayEnv
      // (L9372) gives every engine session VIDEOCLAW_GATEWAY_URL (+ the session's proxy credential when one is minted)
      const sessionEnvDeps = { currentEngine: () => core.currentEngine(), workspaceRoot, enginePathEnv: (p: string) => core.enginePathEnv(p),
        gatewaySessionConfig: () => { const u = m12.shimUrl ?? (accountService.activeSettings() as { gatewayUrl?: string })?.gatewayUrl; return u ? { gatewayUrl: String(u).trim().replace(/\/+$/, "") } : undefined; } };
      const engineDeps: EngineSessionDeps | undefined = engineMode ? {
        workspaceRoot,
        currentEngine: () => core.currentEngine(),
        engineSessionEnv: (k?: string, u?: string) => engineSessionEnv(sessionEnvDeps, k, u),
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
          // docs/26: L61095 / L61086
          materials: (_sessionId, ledger) => { push("materials:changed", ledger); },
          spendSnapshot: (sessionId, snapshot) => { push("spend:snapshot", { sessionId, snapshot }); },
          // docs/30: L61068 / L61096
          inputRequest: (req) => { push("input:request", req); },
          sessionPlanChanged: (event) => { push("sessionPlan:changed", event); },
        },
        // docs/26: deleteProject's registry half + setJobBusyProbe (L62438)
        registry: {
          addTrashWorkspace: (p) => { registry.trashWorkspaces.add(p); },
          flush: () => flushRegistry(),
          markRemoved: (id) => { registry.removedSessionIds.add(id); },
          unmarkRemoved: (id) => { registry.removedSessionIds.delete(id); },
        },
        jobBusyProbe: (jobId) => (editorRender.state() as any)?.jobId === jobId || hfPreview.activeJobId() === jobId,
        // docs/29: setCreditHandoffEligibility (L61622) + the opened gateway the credits continuation bills
        creditEligibility: () => accountService.creditHandoffEligibility(),
        gatewaySettings: () => accountService.activeSettings() as { gatewayUrl?: string; gatewayKey?: string },
        // docs/31: agentGatewayCredentials (L39643) — the session's private loopback proxy (verbatim AgentGatewayProxy)
        agentGatewayProxy: () => m12.proxy ?? undefined,
        engineVersion: () => core.currentEngine()?.version,
        price: sharedPrice, servedModel: () => minimaxConfig()?.model,
        engine: engineDeps,
        // docs/22: versions.json + composer-attachments.json live next to sessions.json (L34841-34848)
        ...(engineDeps ? { stateDir: app.getPath("userData") } : {}),
        persist: engineDeps ? () => saveRegistry() : undefined,
        service: llm.service,
        loadSdk: async () => { const l = await loadClaudeAgentSdk(); log(`[port] Claude Agent SDK ${l.version} from ${l.source}`); return { sdk: l.sdk, version: l.version, executable: claudeCodeExecutableFor(l.packageDir) }; },
        sessionsRoot: join(app.getPath("userData"), "agent-sessions"),
        // docs/25: the child's CLAUDE_CONFIG_DIR (llm-runtime profileDir, L52521) — session:history reads the SDK transcript there
        engineProfileDir: () => join(app.getPath("userData"), "engine-profile"),
        clientOrder: () => registry.listClients().map((c) => c.clientId),
        providerTitles: process.env[PORT_PROVIDER_TITLES_ENV] !== "0",
        tools: agentToolsFromEnv(process.env[PORT_AGENT_TOOLS_ENV]),
        // docs/27: the Codex harness on MiniMax (codex 0.160.1 external binary + per-runtime gate proxy)
        codex: {
          settings: () => llm.settings.get() as Record<string, unknown>,
          profileDir: () => join(app.getPath("userData"), "codex-profile"), // codexProfileDir
          executable: () => resolveCodexExecutable({ resourcesPath: app.isPackaged ? process.resourcesPath : undefined, appRoot: app.getAppPath() }),
          appVersion: app.getVersion(),
          provider: () => resolveMiniMaxCodexProvider(),
        },
        // docs/28: the Claude Code half — no login probe / login child (PORT defaults); catalog = MiniMax
        claude: { modelSource: miniMaxClaudeModelSource(() => resolveMiniMaxCodexProvider()) },
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
      hostRef = h;
      Object.assign(handlers, agentIpcHandlers(h, allSessions));
      Object.assign(handlers, codexChannels(h) as Partial<Record<InvokeChannel, Handler>>); // docs/27
      bindLocal(h);
      if (engineDeps) {
        // QuickstartStartCoordinator wiring (L61195); prepareNewSession = studio bundle revalidation (not ported → no-op)
        const attachmentChangedQ = (attachment: unknown) => { push("attachment:changed", attachment); };
        const coordinator: any = new QuickstartStartCoordinator(quickstart.store, {
          listSessions: () => h.listSessions(),
          createSession: (req: any, provenance: any) => h.createSession(req, provenance),
          listComposerAttachments: (id: string) => h.listComposerAttachments(id),
          stageComposerAttachments: (req: any, cb: any) => h.stageComposerAttachments(req, cb),
          retryComposerAttachment: (id: string, aid: string, cb: any) => h.retryComposerAttachment(id, aid, cb),
          updateQuickstartFirstTurn: (id: string, ft: any) => h.updateQuickstartFirstTurn(id, ft),
          sendMessage: (id: string, req: any) => h.sendMessage(id, req), // 3rd arg (composer=true) is implied by the object request
        }, {
          prepareNewSession: async () => {},
          onAttachmentChanged: attachmentChangedQ,
          onStarted: (session: any) => log(`[port] quickstart started ${String(session?.sessionId ?? "").slice(0, 8)}`), // starter_started beacon: no outbox
          onFailed: (session: any, message: string) => h.quickstartStartFailed(session.sessionId, message),
          now: () => Date.now(),
          wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
        });
        h.setQuickstartResume((session: any) => {
          const attempt = coordinator.resume(session);
          if (!attempt) return false;
          void attempt.catch((reason: unknown) => h.quickstartStartFailed(session.sessionId, reason instanceof Error ? reason.message : "Quickstart could not resume."));
          return true;
        });
        quickstartStart = coordinator;
        sweepClipboardImageIntake(clipboardIntakeDir, h.composerAttachmentSourcePaths()); // L62216
        // startup trash purge (L62509): every workspace that may hold a .videoclaw-trash
        void (async () => {
          const rootsToPurge = new Set<string>([workspaceRoot(), ...registry.trashWorkspaces]);
          for (const m of h.listSessions()) if (m.cwd) rootsToPurge.add(absCwd(m.cwd));
          for (const root of rootsToPurge) {
            const result: any = await purgeExpiredProjectTrash(root).catch(() => undefined);
            if (result && (result.purged.length > 0 || result.skipped > 0 || result.unreconciled > 0)) recordMainLog("project-trash-purge", `root=${root} purged=${result.purged.length} retained=${result.retained} skipped=${result.skipped} unreconciled=${result.unreconciled} deferred=${result.deferred}`);
          }
        })();
      }
      bindLocal26(h);
      // ── docs/29 (M12): the last 23 category-(b) channels ──
      const memoryHost = new ProjectMemoryHost({
        stateDir: userDataDir,
        authority: () => accountService.currentProjectMemoryScope(), // setProjectMemoryAuthority (L61128)
        settingsGatewayUrl: () => String(accountService.activeSettings().gatewayUrl ?? ""),
        authenticatedWorkPaused: () => accountService.signedOutInProcess,
        getClient: (id) => registry.getClient(id) as any,
        isClientRemoved: (id) => registry.removedClientIds.has(id),
        session: (id) => h.memorySessionView(id),
        sessions: () => h.memorySessionViews(),
        isSessionGone: (id) => registry.removedSessionIds.has(id) || !h.liveSession(id),
        libraryStats: (cwd, tenant) => libraryStats(cwd, tenant) as any,
        emitProjectMemoryChanged: ({ clientId, change, authority, sessionId, notice }) => {
          push("memory:changed", { scope: { clientId, ...authority }, change, sessionId, ...(notice ? { notice } : {}) }); // L61097
        },
        emitSessionEvent: (id, event) => h.emitSessionEvent(id, event as any), // memory_noted (L36848)
      });
      h.attachStudio(memoryHost); // docs/30: the studio MCP + session plans bind through project memory
      const sheetBuilder: any = new (CharacterSheetBuilder as any)(llm.settings, (evt: unknown) => { push("characters:build", evt); }, { // L34875
        quoteGatewayBudget: (jobId: string, items: unknown) => {
          if (!m12.proxy) throw new Error("gateway pricing is unavailable");
          return m12.proxy.quoteProject(jobId, items);
        },
        gatewayCredentials: async (scopeId: string, jobId: string, ceilingUsd: number) =>
          m12.proxy ? m12.proxy.credentialsForBudgetedTools(scopeId, new Set(["mint_image"]), 6, jobId, ceilingUsd) : undefined,
        releaseGatewayCredentials: (scopeId: string) => m12.proxy?.revoke(scopeId),
      });
      m12.sheetBuilder = sheetBuilder;
      app.on("will-quit", () => { try { sheetBuilder.closeAll(); } catch {} });
      const pendingChar = (cwd: string, slug: string) => { // L45328
        const c: any = characterStore.list(cwd).find((x: any) => x.slug === slug && x.state === "pending");
        return c ? { slug: c.slug, name: c.name, dir: c.dir } : null;
      };
      // updates (L62529-62600): createAppUpdater (darwin + packaged + trusted https release gateway only, so
      // "disabled" on Linux exactly like the original) + preferences + the release-feed check (self-hosted gateway,
      // or the PORT-NEW harness feed — see PORT_UPDATE_HARNESS_ENV).
      let currentUpdateInfo: any = null;
      const harnessFeed = String(process.env[PORT_UPDATE_HARNESS_ENV] ?? "").replace(/\/+$/, "") || null;
      if (harnessFeed) log(`[port] UPDATE HARNESS: release gateway = ${harnessFeed} (PORT-NEW harness seam; darwin gate evaluated as darwin)`);
      const updateGateway = () => harnessFeed ?? accountService.activeSettings().gatewayUrl;
      const updateSettings = () => ({ ...llm.settings.get(), gatewayUrl: updateGateway() });
      const updateChannel = () => selectedUpdateChannel(updateSettings(), accountService.account) as "nightly" | "latest";
      let updateChecker: { checkNow(): Promise<any>; invalidate(): void; stop(): void } | null = null;
      let updateShutdownStarted = false;
      // readQuitState (L62681). PORT adaptations: workingSessionIds = sessions with status "running"; the composer
      // attachment drafts / active voice transcription counters are not tracked by the port host (0 / false).
      const readQuitState = () => {
        const sessions: any[] = h.listSessions() as any[];
        const renderer: any = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed()) ? latestLocal?.quitState() ?? null : null;
        const working = sessions.filter((x) => x.status === "running").map((x) => x.sessionId);
        const pending: any[] = h.listPendingInteractions() as any[];
        const awaiting = sessions.filter((x) => x.status === "awaiting_permission");
        const titleOf = new Map(sessions.map((x) => [x.sessionId, x.title ?? ""]));
        return {
          runningTurns: working.length,
          pendingInteractions: Math.max(pending.length, awaiting.length),
          renderActive: editorRender.state() != null,
          previewActive: hfPreview.activeJobId() !== undefined,
          recordingVoice: renderer?.recordingVoice === true,
          transcribingVoice: false,
          unsentDraft: renderer?.unsentDraft === true,
          stagedAttachments: 0,
          copyingAttachments: 0,
          videos: {
            working: videoTitles(working, titleOf),
            waiting: videoTitles([...pending.map((row) => row.request?.sessionId || undefined), ...awaiting.map((x) => x.sessionId)], titleOf),
            copying: videoTitles([], titleOf),
          },
        };
      };
      let appUpdater: any = null;
      // quitCoordinator (L62722) — the "update" purpose (Restart to update). PORT gap: before-quit (plain Cmd+Q)
      // is not routed through it yet.
      const quitCoordinator: any = new QuitCoordinator({
        readState: readQuitState,
        beginInstall: () => appUpdater?.beginInstall() === true,
        confirm: async (assessment: any) => {
          const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
          if (parent) { if (parent.isMinimized()) parent.restore(); parent.focus(); }
          const options = quitDialogOptions(assessment) as any;
          const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
          return response === QUIT_BUTTON_INDEX;
        },
        beginShutdown: (purpose: string) => {
          log(`[port] quit: begin shutdown (${purpose})`);
          if (purpose === "update") {
            updateShutdownStarted = true;
            quiesceForUpdate(ipcMain, [...INVOKE_CHANNELS, ...SEND_CHANNELS], BrowserWindow.getAllWindows());
          }
          h.closeAll();
          try { editorRender.shutdown?.(); } catch {}
          try { hfPreview.shutdown(); } catch {}
          try { m12.proxy?.close(); } catch {}
          void Promise.resolve((m12.outbox as any)?.stop?.())
            .catch((err: unknown) => console.error("outbox shutdown failed", err))
            .finally(() => {
              quitCoordinator.shutdownSettled();
              if (!appUpdater?.finishInstall()) app.quit();
            });
        },
        log: (message: string) => log(`[quit] ${message}`),
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electronUpdater = require("electron-updater");
      appUpdater = createAppUpdater({
        driver: electronUpdater.autoUpdater,
        channel: updateChannel,
        requestHeaders: async (channel: string) => {
          if (channel !== "nightly") return {};
          throw new Error("Nightly access is unavailable."); // the port has no signed-in account (canUseNightlyUpdates false)
        },
        currentVersion: app.getVersion(),
        gatewayUrl: updateGateway(),
        trustedGatewayUrl: harnessFeed ?? PROD_GATEWAY_URL, // defaultGatewayUrlForChannel(CHANNEL)
        packaged: app.isPackaged,
        platform: harnessFeed ? "darwin" : process.platform,
        publish: (state: unknown) => push("app:update:state-changed", state),
        installBlocker: () =>
          updateChannel() === "nightly"
            ? { message: "Nightly access is unavailable.", offerInstaller: false }
            : ipcTracking.pendingExcept("app:update:install")
              ? { message: "Wait for the current request to finish, then restart to update.", offerInstaller: true }
              : quitCoordinator.currentPhase() !== "idle"
                ? { message: "Videoclaw is already closing.", offerInstaller: true }
                : null,
        beginQuit: () => { quitCoordinator.requestQuit("update"); },
        recoverInstall: () => {
          log("[update] Native installation failed; reopening the current app after orderly shutdown.");
          app.relaunch();
          app.quit();
        },
      });
      const updatePreferences: any = createUpdatePreferences({
        settings: updateSettings,
        account: () => accountService.account,
        refreshAccount: () => accountService.resolveAccount(),
        save: (preference: unknown) => { llm.settings.patch({ updateChannelPreference: preference }); },
        canSwitch: () => appUpdater?.canSwitchChannel() === true,
        invalidate: () => { appUpdater?.invalidate(); if (!currentUpdateInfo?.blocked) { currentUpdateInfo = null; push("app:update", null); } updateChecker?.invalidate(); }, // invalidateAppUpdate L60478 (clearUpdateNotice)
        installedVersion: app.getVersion(),
      });
      if (m12.shimUrl || harnessFeed) {
        void shimReady.then(() => {
          updateChecker = startUpdateCheck({
            currentVersion: app.getVersion(),
            channel: updateChannel,
            settings: () => ({ ...accountService.activeSettings(), gatewayUrl: updateGateway() }),
            onTick: () => {}, // bootstrap.checkForEngineUpdate (engine re-check cadence) — not ported
            onInfo: (info: any) => { currentUpdateInfo = info; appUpdater?.observeRelease(info); push("app:update", info); },
            onClear: () => { currentUpdateInfo = null; push("app:update", null); },
          });
          app.on("will-quit", () => updateChecker?.stop());
        });
      }
      // L61341-61369
      handlers["app:update:state"] = () => appUpdater?.state() ?? { status: "disabled", version: null, percent: null, message: "Updates are starting." };
      const refreshInstallRelease = async () => {
        const result = await updateChecker?.checkNow();
        if (!result || result.kind === "failed") { appUpdater?.checkFailed(); return false; }
        if (result.kind === "current") { appUpdater?.observeRelease(null); return false; }
        return result.info.autoUpdate === true;
      };
      handlers["app:update:download"] = async () =>
        (await refreshInstallRelease()) && currentUpdateInfo ? appUpdater?.download(currentUpdateInfo.version) : appUpdater?.state();
      handlers["app:update:install"] = async () => ((await refreshInstallRelease()) ? appUpdater?.install() : appUpdater?.state());
      void updateShutdownStarted;
      handlers["app:update:get"] = () => currentUpdateInfo; // L61329
      const credentialsVault: any = credentials;
      Object.assign(handlers, remainingChannels({
        host: h,
        memory: memoryHost,
        currentProjectMemoryScope: () => accountService.currentProjectMemoryScope(),
        openLocalPath: async (path) => { if (smoke()) { log(`[smoke] openPath ${path.slice(0, 200)}`); return; } const err = await shell.openPath(path); if (err) throw new Error(err); },
        assertGenerationAllowed: () => { // L60842
          if ((currentUpdateInfo as any)?.blocked) throw new Error("Update Videoclaw before starting new work.");
          if (accountService.paidWorkBlocked()) throw new Error(ACCOUNT_BLOCKED_COPY);
        },
        absCwd,
        outbox: m12.outbox,
        sessionIndex: async (meta, posthogSessionId, durable = false) => { // enqueueSessionIndex (L60490)
          const cfg: any = accountService.activeSettings();
          if (!m12.outbox || !cfg?.gatewayKey || !cfg.telemetry) return;
          const data = sessionIndexProjection(meta, { observedAt: Date.now(), appVersion: app.getVersion(), engineVersion: core.currentEngine()?.version, posthogSessionId });
          if (durable) await m12.outbox.enqueueDurable("session-index", { ...data });
          else m12.outbox.enqueue("session-index", { ...data });
        },
        listSessions: () => h.listSessions() as any,
        feedback: feedback as any,
        library: {
          tenantFor: (id) => (registry.getClient(id) as any)?.tenant ?? null,
          acquireLease: async (clientId, cwd, operation) => { // acquireLibraryGatewayLease (L45713)
            if (accountService.signedOutInProcess) throw new Error("Sign in again to restart Videoclaw before paid work.");
            const client: any = registry.getClient(clientId);
            if (!client || !client.tenant || !cwd) throw new Error("This project does not have a Library yet.");
            const proxy = m12.proxy;
            if (!proxy) throw new Error("Paid Library work is unavailable until this app is connected to Videoclaw.");
            const id2 = randomUUID();
            const scopeId = `library-operation-${id2}`;
            const jobId = `library-${operation}-${id2}`;
            const limits = operation === "search" ? { calls: 1, ceilingUsd: 0.1 } : { calls: 5e3, ceilingUsd: 5 };
            const creds = await proxy.credentialsForBudgetedTools(scopeId, new Set(["embed"]), limits.calls, jobId, limits.ceilingUsd);
            let released = false;
            return { ...creds, jobId, release: () => { if (released) return; released = true; proxy.revokeCredential(creds.gatewayKey); } } as any;
          },
          sync: (cwd, tenant, onLine, lease) => librarySync(cwd, tenant, onLine, lease) as Promise<number>,
          search: (cwd, tenants, query2, type, lease) => librarySearch(cwd, tenants, query2, type, lease) as Promise<any[]>,
          errorMessage: libraryErrorMessage, gate: libraryGate, key: libraryKey,
          exposeHits: (hits) => { mediaCapabilities.grantMany(hits.map((hit: any) => hit.sourceFile), "external"); return hits; }, // L60426
          log: (kind, detail) => recordMainLog(kind, detail),
        },
        push: (ch, payload) => { push(ch, payload); },
        providerKeys: {
          get: (provider) => credentialsVault.providerKey(provider),
          set: (provider, key) => { if (key && key.trim()) registerSecret(key.trim()); credentialsVault.setProviderKey(provider, key); },
          // currentAgentProviderKeyStatus (L61662) over the vault; openai-api is also configured by the MiniMax backend
          status: () => ({
            openaiApi: { configured: Boolean(credentialsVault.providerKey("openai-api")) || (h.codex?.providerKeyStatus().openaiApi.configured ?? false) },
            openrouter: { configured: Boolean(credentialsVault.providerKey("openrouter")) },
          }),
        },
        workflow: { authorizedRequest: (path, init) => accountService.auth.accountApiRequest(path, init) },
        update: { checker: () => updateChecker, preferences: () => updatePreferences, appVersion: app.getVersion() },
        sheets: {
          plan: async (cwd, slug) => { const c = pendingChar(cwd, slug); return c ? sheetBuilder.plan(c) : { status: "error", message: "That character is no longer pending." }; },
          build: async (cwd, slug) => { const c = pendingChar(cwd, slug); if (!c || existsSync(join(c.dir, "sheet.png"))) return false; return sheetBuilder.build(cwd, c); },
        },
        voice: { tools: () => voiceTools() as any, isAudio: isVoiceNoteAudio as any, invalidAudio: (voiceErrors as any).invalid_audio },
      }) as Partial<Record<InvokeChannel, Handler>>);
      // agentProviderKeyStatus (L61660) reads the same vault saveAgentProviderKey writes
      handlers["engine:agentProviderKeyStatus"] = () => ({
        openaiApi: { configured: Boolean(credentialsVault.providerKey("openai-api")) || (h.codex?.providerKeyStatus().openaiApi.configured ?? false) },
        openrouter: { configured: Boolean(credentialsVault.providerKey("openrouter")) },
      });
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
