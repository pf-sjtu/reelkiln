// PORT-NEW glue (docs/25): the LOCAL / no-credential stub channels made real. Electron-free (every
// platform call is injected) so test/local-channels.test.ts drives the exact handlers real-backend.ts
// registers. Each entry cites the original registration in app/reconstructed/main/index.js.
//
//   session:rename          L61731 → host.renameSession (L38915)
//   session:reorder         L61698 → host.reorderSessions (L38482)
//   session:setPermissionMode L61781 → host.setPermissionMode (L43987; docs/32: spend-policy branch ported)
//   client:rename / client:remove / client:reorder  L61819-61826 → registry (L36332-36423)
//   permission:shown (send) L61803 → host.noteSpendApprovalShown (L46776) (docs/32: raise / ask_each cards)
//   quit:rendererState (send) L61804 → rendererQuitState (verbatim normalisation)
//   file:openExternal       L61979 → shell.openExternal for http(s) only
//   media:requestMic        L61904 → non-darwin: true; darwin: systemPreferences
//   analytics:playbackCompleted L62003 → validation + the original's `outbox?.enqueue` (no outbox → no beacon)
//   taste:list / taste:commit / taste:decline L61843-61852 → verbatim taste module (taste.generated.ts)
//   stats:stageEtas         L62297 → verbatim computeStageEtas (stage-etas.generated.ts)
//   bootstrap:revealSetupLog L61303 → shell.showItemInFolder(userData/setup.log) (L9847)
//   characters:create / approve / discard / delete L61882-61903 → the verbatim CharacterStore + exposeCharacter
import { join } from "node:path";
import { commitTaste, declineProposal, listTaste } from "./taste/taste.generated";
import { computeStageEtas } from "./jobs/stage-etas.generated";

type Handler = (...a: any[]) => unknown;
export interface RendererQuitState { composerSessionId: string | null; unsentDraft: boolean; pendingSendAttachmentIds: string[]; recordingVoice: boolean }

export interface LocalChannelDeps {
  host?: {
    renameSession(id: string, title: string): unknown;
    reorderSessions(clientId: string, ids: string[]): unknown;
    setPermissionMode(id: string, mode: string, options?: unknown): Promise<void>;
    listSessions(): Array<{ sessionId: string; clientId: string; status: string; quickstart?: any; jobId?: string }>;
    removeSession(id: string): boolean;
    noteSpendApprovalShown?(requestId: string): void;
  };
  registry: {
    listClients(): Array<{ clientId: string; name: string; tenant?: string }>;
    getClient(id: string): { clientId: string; name: string; tenant?: string } | undefined;
    reorderClients(ids: unknown, save: () => void): unknown;
    renameClient(id: string, name: unknown, flush: () => boolean): unknown;
    removeClient(id: string, sessionIds: string[], busy: boolean, flush: () => boolean, removeSession: (id: string) => void): unknown;
  };
  saveRegistry: () => void;
  flushRegistry: () => boolean;
  shell: { openExternal(url: string): Promise<unknown>; showItemInFolder(p: string): void };
  platform: NodeJS.Platform;
  systemPreferences?: { getMediaAccessStatus(kind: string): string; askForMediaAccess(kind: string): Promise<boolean> };
  absCwd: (cwd: string) => string;
  userData: string;
  characterStore: { create(cwd: string, name: string, isSelf: boolean, photos: Array<{ path: string; name: string }>): Promise<any> | any; approve(cwd: string, slug: string): any; discard(cwd: string, slug: string): any; delete(cwd: string, slug: string): any };
  exposeCharacter: (c: any) => any;
  /** The original's telemetry outbox; the port has none (undefined → the `outbox?.` no-op branch). */
  outbox?: { enqueue(kind: string, payload: unknown): void };
  log?: (m: string) => void;
}

export function localChannelHandlers(d: LocalChannelDeps): { invoke: Record<string, Handler>; send: Record<string, Handler>; quitState: () => RendererQuitState | null } {
  let rendererQuitState: RendererQuitState | null = null;
  const host = d.host;
  const needHost = () => { if (!host) throw new Error("Videos are not available in this build."); return host; };
  const invoke: Record<string, Handler> = {
    // L61731
    "session:rename": (sessionId: unknown, title: unknown) => needHost().renameSession(String(sessionId), String(title ?? "")),
    // L61698
    "session:reorder": (clientId: unknown, sessionIds: unknown) => needHost().reorderSessions(String(clientId), Array.isArray(sessionIds) ? sessionIds.map(String) : []),
    // L61781
    "session:setPermissionMode": (sessionId: unknown, mode: unknown, options: unknown) => needHost().setPermissionMode(String(sessionId), String(mode), options),
    // L61819
    "client:rename": (clientId: unknown, name: unknown) => d.registry.renameClient(String(clientId), name, d.flushRegistry),
    // L61820-61825 (retireSessionIndex = telemetry session index → no outbox in the port)
    "client:remove": (clientId: unknown) => {
      const id = String(clientId);
      const sessions = (host?.listSessions() ?? []).filter((session2) => session2.clientId === id);
      const busy = sessions.some((s) => s.status === "running" || s.status === "awaiting_permission");
      return d.registry.removeClient(id, sessions.map((s) => s.sessionId), busy, d.flushRegistry, (sid) => { host?.removeSession(sid); });
    },
    // L61826
    "client:reorder": (clientIds: unknown) => d.registry.reorderClients(clientIds, d.saveRegistry),
    // L61979
    "file:openExternal": async (url: unknown) => { if (typeof url === "string" && /^https?:/.test(url)) await d.shell.openExternal(url); },
    // L61904
    "media:requestMic": async () => {
      if (d.platform !== "darwin") return true;
      const status = d.systemPreferences!.getMediaAccessStatus("microphone");
      if (status === "granted") return true;
      return d.systemPreferences!.askForMediaAccess("microphone");
    },
    // L62003
    "analytics:playbackCompleted": (path: unknown) => {
      if (typeof path !== "string" || !path.trim() || path.length > 4096) return;
      const quickstartSession = (host?.listSessions() ?? []).find((session2) => session2.quickstart && session2.jobId && path.includes(`/jobs/${session2.jobId}/`));
      const quickstart = quickstartSession?.quickstart;
      d.outbox?.enqueue("beacon", { kind: "product-milestone", detail: { event: "playback_completed", source: "asset_panel", ...(quickstart ? { starter_id: quickstart.starterId } : {}) } });
    },
    // L61843-61852
    "taste:list": (clientId: unknown, cwd: unknown) => listTaste(d.registry.listClients().find((c) => c.clientId === clientId), d.absCwd(String(cwd))),
    "taste:commit": (cwd: unknown, files: unknown) => commitTaste(d.absCwd(String(cwd)), files),
    "taste:decline": (cwd: unknown, file: unknown, cards: unknown, antiText: unknown) => declineProposal(d.absCwd(String(cwd)), file, cards, antiText),
    // L62297
    "stats:stageEtas": (cwd: unknown) => computeStageEtas(d.absCwd(String(cwd))),
    // L61303 + setupLogPath L9847
    "bootstrap:revealSetupLog": () => { d.shell.showItemInFolder(join(d.userData, "setup.log")); },
    // L61882-61903 (host.createCharacter … = characterStore.*, L45284-45300)
    "characters:create": async (cwd: unknown, name: unknown, isSelf: unknown, photos: unknown) => d.exposeCharacter(await d.characterStore.create(d.absCwd(String(cwd)), name as string, isSelf as boolean, photos as any)),
    "characters:approve": (cwd: unknown, slug: unknown) => d.exposeCharacter(d.characterStore.approve(d.absCwd(String(cwd)), String(slug))),
    "characters:discard": (cwd: unknown, slug: unknown) => d.characterStore.discard(d.absCwd(String(cwd)), String(slug)),
    "characters:delete": (cwd: unknown, slug: unknown) => d.characterStore.delete(d.absCwd(String(cwd)), String(slug)),
  };
  const send: Record<string, Handler> = {
    // L61803 → noteSpendApprovalShown (L46776)
    "permission:shown": (requestId: unknown) => { if (typeof requestId === "string") d.host?.noteSpendApprovalShown?.(requestId); },
    // L61804-61816 verbatim
    "quit:rendererState": (state: any) => {
      rendererQuitState = {
        composerSessionId: typeof state?.composerSessionId === "string" && state.composerSessionId ? state.composerSessionId : null,
        unsentDraft: state?.unsentDraft === true,
        pendingSendAttachmentIds: Array.isArray(state?.pendingSendAttachmentIds) ? state.pendingSendAttachmentIds.filter((id2: unknown) => typeof id2 === "string") : [],
        recordingVoice: state?.recordingVoice === true,
      };
    },
  };
  return { invoke, send, quitState: () => rendererQuitState };
}
