// PORT-NEW glue (docs/26): the remaining category-(a) LOCAL / no-credential stub channels made real.
// Electron-free (every platform call is injected) so test/local-channels-26.test.ts drives the exact
// handlers real-backend.ts registers. Each entry cites the original registration in
// app/reconstructed/main/index.js; the bodies are the original's, over verbatim-sliced modules.
//
//   quickstart:start          L61294 → QuickstartStartCoordinator (L33623, quickstart-start.generated.ts)
//   session:deletionPlan/delete L61733-61737 → host.planProjectDeletion / deleteProject (L39205/L39248)
//   session:retry             L61776 → host.retryTurn (L42565)
//   session:startContinuation L61766 → host.startContinuationChat (L38972)
//   job:originalContext       L61749 → host.getOriginalContext (L45675)
//   job:adopt                 L61759 → host.adoptJob (L47802)
//   spend:get / setCeiling    L61755-61758 → host.getSpendSnapshot / setSpendCeiling (L45686 / L47158)
//   input:respond             L61829 → host.respondInput (L44689)
//   media:discardVoice        L61914 → host.discardVoice (L45705)
//   attachment:pasteImage / voiceNote / captureMoment / momentPreview / preview  L62219-62290
//   materials:preview         L62197 → host.materialPreview (L44876) + vcmedia grant
//   project:seedPack          L61827 → registry.seedProjectPack (L36444) + writeProjectPack (L15532)
//   library:stats/scan/addSource/removeSource/preview/setTenant  L62027-62156 (library.generated.ts)
//   characters:sheetStates / retry  L61892 / L61896 → sheet builder statesFor (L19470) / CharacterStore.retry
//   characters:voices:list / voice:approve / voice:remove  L61862-61881 → voiceResult over
//                             characterVoiceContext → memoryBinding (L36456): no verified account → the
//                             original's ProjectMemoryError("unavailable") answer (category b: needs an account)
//   characters:sheetPlan      L61885 → the dry-run needs the engine tool + a gateway quote (category b)
//   bootstrap:revertEngine    L61302 → BootstrapCore.revertEngine (L10240)
//   feedback:capture / discard L62342-62349 → FeedbackService (L57172)
//   hfPreview:available/start/stop/editApply L62430-62436 → HyperframesPreviewController (L56487)
//   account:localResetPrepare / Commit L61497-61498 → LocalResetController (L5826)
//   media:voiceDictationStatus L61910 → voiceDictationStatus(voiceTools()) (L10472; docs/33 M16)
import { voiceDictationStatus } from "./platform/voice";
import { voiceTools } from "./attachments/voice-tools";
type Handler = (...a: any[]) => unknown;

export interface LocalChannels26Deps {
  host?: any;
  registry: { getClient(id: string): { clientId: string; name: string; tenant?: string } | undefined; setClientTenant(id: string, tenant: unknown, save: () => void): unknown; seedProjectPack(id: string, cwd: string, brief: unknown, save: () => void, write: (cwd: string, slug: string, name: string, brief: string) => string): unknown };
  saveRegistry: () => void;
  absCwd: (cwd: string) => string;
  media: { grant(p: string, scope: string): boolean; resolve(p: string): { state: string; path: string } };
  pathToVcmedia: (p: string) => string;
  quickstart?: { start(req: unknown): Promise<any> };
  writeProjectPack: (cwd: string, slug: string, name: string, brief: string) => string;
  library: {
    stats(cwd: string, tenant: string): Promise<unknown>; scan(cwd: string, tenant: string): Promise<unknown>;
    addSource(cwd: string, tenant: string, type: unknown, dir: string): Promise<unknown>; removeSource(cwd: string, tenant: string, path: unknown, purge: boolean): Promise<unknown>;
    preview(cwd: string, sourceFile: string, inSec: unknown, outSec: unknown, cacheDir: string): Promise<string>;
    errorMessage(e: unknown): string; key(tenant: string, cwd: string): string; gate: (key: string, kind: string, fn: () => Promise<unknown>) => Promise<unknown>;
    previewCacheDir: string;
  };
  pickDirectory: () => Promise<string | null>;
  characterStore: { retry(cwd: string, slug: string): unknown };
  exposeCharacter: (c: any) => any;
  /** CharacterSheetBuilder.statesFor (L19470): builds only start through characters:sheetBuild (paid, b). */
  sheetStates: (cwd: string) => unknown[];
  characterVoiceUnavailable: () => { ok: false; message: string };
  bootstrap?: { revertEngine(): Promise<unknown> };
  feedback?: { capture(req: unknown): Promise<any>; discard(reportId: unknown): void };
  hfPreview?: { availability(req: unknown): unknown; start(req: unknown): unknown; stop(reason: string): void; applyEdit(req: unknown): unknown };
  localReset?: { prepare(): unknown; commit(planId: unknown): Promise<unknown> };
  attachments?: {
    intakeDir: string;
    pasteImage(sessionId: string, destination: unknown, png: unknown): unknown;
    voiceNote(sessionId: string, recordingId: unknown, audio: unknown): Promise<unknown>;
    captureMoment(request: any): Promise<unknown>;
    momentPreview(sessionId: string, attachmentId: string, full: unknown): unknown;
    preview(sessionId: string, attachmentId: string, full: unknown): unknown;
  };
  recordMainLog?: (kind: string, detail: string) => void;
}

export function localChannels26(d: LocalChannels26Deps): Record<string, Handler> {
  const host = d.host;
  const needHost = () => { if (!host) throw new Error("Videos are not available in this build."); return host; };
  const log = d.recordMainLog ?? (() => {});
  // L62020-62030: tenant-guarded library calls
  const tenantFor = (clientId: unknown) => d.registry.getClient(String(clientId))?.tenant ?? null;
  const guarded = async (clientId: unknown, fn: (tenant: string) => Promise<unknown>) => {
    const tenant = tenantFor(clientId);
    if (!tenant) return { error: "no-tenant" };
    try {
      return await fn(tenant);
    } catch (err: any) {
      log("library-failure", String(err?.cause ?? err));
      return { error: "engine", message: d.library.errorMessage(err) };
    }
  };
  const withLibraryMutation = (tenant: string, cwd: string, kind: string, fn: () => Promise<unknown>) => d.library.gate(d.library.key(tenant, d.absCwd(cwd)), kind, fn);
  const h: Record<string, Handler> = {
    // L61294 (assertGenerationAllowed: the port has no account gate — same policy as session:send)
    "quickstart:start": async (request: unknown) => {
      if (!d.quickstart) throw new Error("Videos are not available in this build.");
      return d.quickstart.start(request);
    },
    "session:deletionPlan": (sessionId: unknown) => needHost().planProjectDeletion(String(sessionId)),
    "session:delete": (sessionId: unknown) => needHost().deleteProject(String(sessionId)),
    "session:retry": (sessionId: unknown) => needHost().retryTurn(String(sessionId)),
    "session:startContinuation": (sessionId: unknown, clientActionId: unknown) => needHost().startContinuationChat(String(sessionId), String(clientActionId ?? "")),
    "job:originalContext": (sessionId: unknown) => needHost().getOriginalContext(String(sessionId)),
    "job:adopt": (sessionId: unknown, jobId: unknown) => needHost().adoptJob(String(sessionId), jobId === null ? null : String(jobId)),
    "spend:get": (sessionId: unknown) => needHost().getSpendSnapshot(String(sessionId)),
    "spend:setCeiling": (sessionId: unknown, usd: unknown, options: unknown) => needHost().setSpendCeiling(String(sessionId), usd, options as any),
    // L61829: paidWorkBlocked() is false in the port (no account gate) → the response passes through
    "input:respond": (requestId: unknown, r: unknown) => needHost().respondInput(String(requestId), r),
    // L61910: ipcMain.handle(IPC.voiceDictationStatus, () => voiceDictationStatus()) — default arg voiceTools()
    "media:voiceDictationStatus": () => voiceDictationStatus(voiceTools()),
    "media:discardVoice": (sessionId: unknown, recordingId: unknown) => { needHost().discardVoice(String(sessionId), String(recordingId)); },
    // L62197
    "materials:preview": (sessionId: unknown, id: unknown) => {
      if (typeof sessionId !== "string" || typeof id !== "string") return null;
      const preview = needHost().materialPreview(sessionId, id);
      if (!preview?.asset) return preview;
      const path = preview.asset.path;
      if (!d.media.grant(path, "job")) return { entry: { ...preview.entry, state: "missing" } };
      return { ...preview, url: d.pathToVcmedia(path) };
    },
    // L61827
    "project:seedPack": (clientId: unknown, cwd: unknown, brief: unknown) => d.registry.seedProjectPack(String(clientId), d.absCwd(String(cwd)), brief, d.saveRegistry, d.writeProjectPack),
    // L62154
    "library:setTenant": (clientId: unknown, tenant: unknown) => d.registry.setClientTenant(String(clientId), tenant, d.saveRegistry),
    "library:stats": (clientId: unknown, cwd: unknown) => guarded(clientId, (tenant) => d.library.stats(cwd as string, tenant)),
    "library:scan": (clientId: unknown, cwd: unknown) => guarded(clientId, (tenant) => d.library.scan(cwd as string, tenant)),
    "library:addSource": (clientId: unknown, cwd: unknown, type: unknown, path: unknown) => guarded(clientId, async (tenant) => {
      let dir = path as string;
      if (!dir) {
        const picked = await d.pickDirectory();
        if (!picked) return d.library.stats(cwd as string, tenant);
        dir = picked;
      }
      return d.library.addSource(cwd as string, tenant, type, dir);
    }),
    "library:removeSource": (clientId: unknown, cwd: unknown, path: unknown, purge: unknown) => guarded(clientId, (tenant) => withLibraryMutation(tenant, cwd as string, "remove", () => d.library.removeSource(cwd as string, tenant, path, purge === true))),
    // L62122
    "library:preview": async (cwd: unknown, sourceFile: unknown, inSec: unknown, outSec: unknown) => {
      const source = d.media.resolve(String(sourceFile));
      if (source.state !== "ready") return { error: "media", message: source.state === "offline" ? "This source is currently offline." : "This source is no longer available to preview." };
      try {
        const preview = await d.library.preview(d.absCwd(String(cwd)), source.path, inSec, outSec, d.library.previewCacheDir);
        d.media.grant(preview, "temporary");
        return preview;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        log("library-preview-failure", String(error));
        return { error: "media", message: /operation not permitted|permission denied|eacces|eperm/i.test(detail) ? "VideoClaw needs permission to reopen this source folder." : d.library.errorMessage(error) };
      }
    },
    // L61892 / L61896 (retry: assertGenerationAllowed — no account gate in the port)
    "characters:sheetStates": (cwd: unknown) => d.sheetStates(d.absCwd(String(cwd))),
    "characters:retry": (cwd: unknown, slug: unknown) => d.exposeCharacter(d.characterStore.retry(d.absCwd(String(cwd)), String(slug))),
    // L61862-61881: voiceResult(() => host.readCharacterVoices(scope)) → memoryBinding throws without a
    // verified account → { ok:false, message: characterVoiceErrorText(err) }
    "characters:voices:list": async () => d.characterVoiceUnavailable(),
    "characters:voice:approve": async () => d.characterVoiceUnavailable(),
    "characters:voice:remove": async () => d.characterVoiceUnavailable(),
    // L61302
    "bootstrap:revertEngine": () => { if (!d.bootstrap) throw new Error("No previous engine is available."); return d.bootstrap.revertEngine(); },
    // L62342-62349
    "feedback:capture": async (req: unknown) => {
      if (!d.feedback) throw new Error("Feedback is unavailable.");
      const capture = await d.feedback.capture(req);
      if (capture.screenshotPath) d.media.grant(capture.screenshotPath, "temporary");
      return capture;
    },
    "feedback:discard": (reportId: unknown) => { d.feedback?.discard(reportId); },
    // L62430-62436
    "hfPreview:available": (sessionId: unknown, jobId: unknown) => (d.hfPreview ? d.hfPreview.availability({ sessionId, jobId }) : { available: false }),
    "hfPreview:start": (req: unknown) => { if (!d.hfPreview) throw new Error("Preview is unavailable."); return d.hfPreview.start(req); },
    "hfPreview:stop": () => { d.hfPreview?.stop("closed"); },
    "hfPreview:editApply": (req: unknown) => { if (!d.hfPreview) throw new Error("Preview is unavailable."); return d.hfPreview.applyEdit(req); },
    // L61497-61498
    "account:localResetPrepare": () => { if (!d.localReset) throw new Error("Reset is unavailable."); return d.localReset.prepare(); },
    "account:localResetCommit": (planId: unknown) => { if (!d.localReset) throw new Error("Reset is unavailable."); return d.localReset.commit(planId); },
  };
  if (d.attachments) {
    const a = d.attachments;
    Object.assign(h, {
      "attachment:pasteImage": (sessionId: unknown, destination: unknown, png: unknown) => a.pasteImage(String(sessionId), destination, png),
      "attachment:voiceNote": (sessionId: unknown, recordingId: unknown, audio: unknown) => a.voiceNote(String(sessionId), recordingId, audio),
      "attachment:captureMoment": (request: unknown) => a.captureMoment(request),
      "attachment:momentPreview": (sessionId: unknown, attachmentId: unknown, full: unknown) => a.momentPreview(String(sessionId), String(attachmentId), full),
      "attachment:preview": (sessionId: unknown, attachmentId: unknown, full: unknown) => a.preview(String(sessionId), String(attachmentId), full),
    });
  }
  return h;
}
