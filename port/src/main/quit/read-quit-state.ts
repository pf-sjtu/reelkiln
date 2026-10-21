// readQuitState (main L62681-62719), transcribed: what a quit would interrupt. The host half is AgentHost
// (listSessions / composerAttachmentDrafts / workingSessionIds / listPendingInteractions / hasActiveVoiceTranscription);
// the renderer half is the latest quit:rendererState (only while a window is alive).
import { videoTitles } from "./quit-coordinator.generated";

export interface QuitStateHost {
  listSessions(): Array<{ sessionId: string; status?: string; title?: string }>;
  composerAttachmentDrafts(visibleSessionId: string | null, frozenIds?: string[]): { ready: number; copying: string[] };
  workingSessionIds(): string[];
  listPendingInteractions(): Array<{ request?: { sessionId?: string } }>;
  hasActiveVoiceTranscription(): boolean;
}
export interface RendererQuitState { composerSessionId: string | null; unsentDraft: boolean; pendingSendAttachmentIds: string[]; recordingVoice: boolean }

export function readQuitState(o: { host: QuitStateHost | undefined; renderer: RendererQuitState | null; renderActive: boolean; previewActive: boolean }) {
  const host = o.host;
  const sessions = host?.listSessions() ?? [];
  const renderer = o.renderer;
  const attachments = host?.composerAttachmentDrafts(renderer?.composerSessionId ?? null, renderer?.pendingSendAttachmentIds) ?? { ready: 0, copying: [] };
  const working = host?.workingSessionIds() ?? [];
  const pending = host?.listPendingInteractions() ?? [];
  const awaiting = sessions.filter((s) => s.status === "awaiting_permission");
  const titleOf = new Map(sessions.map((session2) => [session2.sessionId, session2.title ?? ""]));
  return {
    runningTurns: working.length,
    pendingInteractions: Math.max(pending.length, awaiting.length),
    renderActive: o.renderActive,
    previewActive: o.previewActive,
    recordingVoice: renderer?.recordingVoice === true,
    transcribingVoice: host?.hasActiveVoiceTranscription() === true,
    unsentDraft: renderer?.unsentDraft === true,
    stagedAttachments: attachments.ready,
    copyingAttachments: attachments.copying.length,
    videos: {
      working: videoTitles(working, titleOf),
      waiting: videoTitles([...pending.map((row) => row.request?.sessionId || undefined), ...awaiting.map((s) => s.sessionId)], titleOf),
      copying: videoTitles(attachments.copying, titleOf),
    },
  };
}
