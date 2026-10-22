// PORT-NEW glue (docs/26): the original attachment intake handlers (app/reconstructed/main/index.js
// L62219-62290) over the verbatim intake modules. Electron's nativeImage is injected (`image`) so the
// node:test suite drives the same bodies with a fake decoder.
import { CLIPBOARD_IMAGE_MAX_BYTES, CLIPBOARD_IMAGE_MAX_PIXELS } from "./asset-kinds.generated";
import { clipboardImageIntakeFile, isClipboardPng } from "./composer-attachments.generated";
import { stageVideoMoment, videoMomentThumbnail } from "./video-moment.generated";
import { voiceNoteIntakeFile } from "./voice-note.generated";

export interface NativeImageLike { isEmpty(): boolean; getSize(): { width: number; height: number }; toPNG(): Buffer; resize(o: { width?: number; height?: number; quality?: string }): NativeImageLike; toJPEG(q: number): Buffer }
export interface AttachmentIpcDeps {
  host: any;
  intakeDir: string;
  media: unknown;
  image: (bytes: Buffer) => NativeImageLike;
  onChanged: (a: unknown) => void;
}

export function attachmentIntakeHandlers(d: AttachmentIpcDeps) {
  const host = d.host;
  return {
    intakeDir: d.intakeDir,
    // L62219 attachmentCaptureMoment (owner(): the account fields are constant in the port — no account)
    captureMoment: (request2: any) => stageVideoMoment(request2, {
      intakeDir: d.intakeDir,
      media: d.media,
      owner: () => {
        host.assertComposerWritable(request2.sessionId);
        const session2 = host.listSessions().find((s: any) => s.sessionId === request2.sessionId);
        return JSON.stringify([session2.clientId, session2.cwd, session2.jobId, undefined, false, false]);
      },
      decodes: (bytes: Buffer) => !d.image(bytes).isEmpty(),
      stage: (file: unknown, moment: unknown) => host.stageComposerMoment({ sessionId: request2.sessionId, destination: "video", files: [file] }, d.onChanged, moment),
    }),
    // L62246
    momentPreview: (sessionId: string, attachmentId: string, full: unknown) =>
      host.composerMomentPreview(sessionId, attachmentId, full === true ? undefined : (bytes: Buffer) => videoMomentThumbnail(d.image(bytes))),
    // L62253
    preview: (sessionId: string, attachmentId: string, full: unknown) =>
      host.composerAttachmentPreview(sessionId, attachmentId, (bytes: Buffer) => {
        const image = d.image(bytes);
        const { width, height } = image.getSize();
        if (!width || !height || width * height > CLIPBOARD_IMAGE_MAX_PIXELS) throw new Error("Preview unavailable.");
        return full === true ? image.toPNG() : videoMomentThumbnail(image);
      }),
    // L62262
    voiceNote: async (sessionId: string, recordingId: unknown, audio: unknown) => {
      host.assertComposerWritable(sessionId);
      if (typeof recordingId !== "string" || !/^[a-f0-9-]{36}$/.test(recordingId)) throw new Error("Invalid recording.");
      const note = await voiceNoteIntakeFile(d.intakeDir, recordingId, audio);
      return host.stageVoiceNote(sessionId, recordingId, note, audio, d.onChanged); // L62270
    },
    // L62269
    pasteImage: (sessionId: string, destination: unknown, png: unknown) => {
      host.assertComposerWritable(sessionId);
      if (!(png instanceof ArrayBuffer) || !png.byteLength || png.byteLength > CLIPBOARD_IMAGE_MAX_BYTES) {
        throw new Error("Could not paste that image. Save it and use Attach instead.");
      }
      const bytes = Buffer.from(png);
      if (!isClipboardPng(bytes)) throw new Error("Could not read that pasted image. Save it and use Attach instead.");
      let file;
      try {
        const image = d.image(bytes);
        file = clipboardImageIntakeFile(d.intakeDir, image.isEmpty() ? null : bytes);
      } catch {
        throw new Error("Could not read that image from the clipboard.");
      }
      if (!file) throw new Error("Could not read that pasted image. Try copying it again.");
      return host.stageComposerAttachments({ sessionId, destination, files: [file], origin: "paste" }, d.onChanged);
    },
  };
}
