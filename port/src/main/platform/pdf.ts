// PDF text extraction. Original (main/index.js L56966-57000): JXA PDFKit script via
// `/usr/bin/osascript -l JavaScript`; on non-darwin the ORIGINAL itself returns
// { kind: "unread", cause: "unavailable" } (L56968-56970). The port keeps that exact
// behaviour on Windows. TODO(win): replace with a Windows reader (pdf.js in a
// utilityProcess, or Windows.Data.Pdf) — must reproduce PDFKit's text ordering to be
// byte-faithful, which is not guaranteed; tracked in docs/07.
import { isWin, type Plat } from "./types";

export type PdfReadResult = { kind: "unread"; cause: "unavailable" } | { kind: "delegate-to-original"; osascript: string };

export function pdfReaderFor(p: Plat = process.platform, osascript?: string): PdfReadResult {
  const bin = osascript ?? (p === "darwin" ? "/usr/bin/osascript" : undefined);
  if (!bin || isWin(p)) return { kind: "unread", cause: "unavailable" };
  return { kind: "delegate-to-original", osascript: bin };
}
