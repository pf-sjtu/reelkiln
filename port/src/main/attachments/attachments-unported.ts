// PORT (docs/22 M4): collaborators of the verbatim ComposerAttachmentStore that are NOT ported yet.
//
// extractArchive (shipped workbookContents chunk L4199) unpacks .zip attachments through `yauzl`,
// which the port does not ship. Until it is ported, every archive is REFUSED (never silently
// accepted or half-unpacked): the store's own unpackArchive() turns this into the original
// archiveRejectReason(name, "unsupported-compression") chip text. Ordinary files (video / image /
// audio / docs) are unaffected.
export const ARCHIVE_EXTRACTION_PORTED = false;
export async function extractArchive(_zipPath: string, _outDir: string): Promise<{ kind: "rejected"; cause: string }> {
  return { kind: "rejected", cause: "unsupported-compression" };
}
