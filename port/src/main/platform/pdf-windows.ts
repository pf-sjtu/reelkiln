// Windows PDF reader — DESIGN + STUB.
// Original reader (main/index.js L56880-57060): a JXA script run by /usr/bin/osascript using
// PDFKit; it prints ONE JSON object `{status:"read",pages:string[]} | {status:"locked"|
// "too-large",pages:number} | {status:"damaged"}` that interpretPdfKitOutput (L56911-56952)
// maps to the attachment-store result. readOwnedPdf (L56967) returns
// {kind:"unread",cause:"unavailable"} on every non-darwin platform — the port's current
// Windows behaviour (platform/pdf.ts) and therefore already "faithful".
//
// Design for a real Windows reader (keeps everything downstream byte-identical):
//   1. Emit the SAME JSON contract as PDFKIT_READER_SCRIPT and reuse interpretPdfKitOutput
//      verbatim (ported below), so caps/causes/schema stay identical.
//   2. Backend: pdf.js (`pdfjs-dist` legacy build) inside an Electron utilityProcess
//      (mirrors the original isolation: untrusted bytes are parsed out of the main process).
//      Per page: getTextContent() → join items' `str`, inserting "\n" where `hasEOL`.
//      Windows.Data.Pdf (WinRT) is rejected: it renders bitmaps only, no text extraction.
//   3. Known divergence: PDFKit's `page.string` and pdf.js text ordering/whitespace differ
//      for multi-column and rotated text. Unverifiable without macOS side-by-side samples →
//      TODO(verify): collect 10 sample PDFs, compare PDFKit vs pdf.js output on a Mac.
//   4. Same limits: PDF_MAX_BYTES 64 MiB, PDF_MAX_PAGES 500, PDF_MAX_TEXT_CHARS 1e6
//      (out/main/chunks/workbookContents-ChzKjQX1.js L809-811), 30 s timeout (L56908),
//      concurrency 2 (L56953).
// The dependency (pdfjs-dist) is NOT added yet: no network installs beyond the build set.
export const PDF_SCHEMA = "videoclaw.pdf-text/v1"; // L16412
export const PDF_MAX_BYTES = 64 * 1024 * 1024;
export const PDF_MAX_PAGES = 500;
export const PDF_MAX_TEXT_CHARS = 1e6;
export const PDF_READ_TIMEOUT_MS = 3e4;

export type PdfResult =
  | { kind: "read"; contents: { schema: typeof PDF_SCHEMA; sourceSha256: string; pages: string[] } }
  | { kind: "unread"; cause: "unavailable" | "encrypted" | "damaged" | "too-large" | "image-only"; pages?: number };

const hasText = (page: string) => page.trim().length > 0; // L16415

/** interpretPdfKitOutput (L56911), verbatim. */
export function interpretPdfKitOutput(stdout: string, sha256: string): PdfResult {
  let value: any;
  try { value = JSON.parse(stdout); } catch { return { kind: "unread", cause: "unavailable" }; }
  const out = value;
  const count = typeof out?.pages === "number" && Number.isSafeInteger(out.pages) && out.pages > 0 ? out.pages : undefined;
  switch (out?.status) {
    case "locked": return { kind: "unread", cause: "encrypted", ...(count ? { pages: count } : {}) };
    case "damaged": return { kind: "unread", cause: "damaged" };
    case "too-large": return { kind: "unread", cause: "too-large", ...(count ? { pages: count } : {}) };
    case "read": {
      const pages = out.pages;
      if (!Array.isArray(pages) || pages.length === 0 || pages.length > PDF_MAX_PAGES || !pages.every((p: unknown) => typeof p === "string")) return { kind: "unread", cause: "unavailable" };
      if (pages.reduce((s: number, p: string) => s + p.length, 0) > PDF_MAX_TEXT_CHARS) return { kind: "unread", cause: "too-large", pages: pages.length };
      if (!pages.some(hasText)) return { kind: "unread", cause: "image-only", pages: pages.length };
      return { kind: "read", contents: { schema: PDF_SCHEMA, sourceSha256: sha256, pages } };
    }
    default: return { kind: "unread", cause: "unavailable" };
  }
}

/** Backend seam: produce the PDFKit-script JSON for given bytes. */
export interface PdfTextBackend { extract(bytes: Uint8Array, maxPages: number, maxChars: number): Promise<string> }

/** STUB backend: identical to the original non-darwin behaviour. */
export const unavailableBackend: PdfTextBackend = { extract: async () => "" /* → JSON parse fails → unavailable */ };

export async function readPdfWindows(bytes: Uint8Array, sha256: string, backend: PdfTextBackend = unavailableBackend): Promise<PdfResult> {
  if (bytes.length === 0) return { kind: "unread", cause: "damaged" };
  if (bytes.length > PDF_MAX_BYTES) return { kind: "unread", cause: "too-large" };
  return interpretPdfKitOutput(await backend.extract(bytes, PDF_MAX_PAGES, PDF_MAX_TEXT_CHARS), sha256);
}
