// docs/39 M22: the ORIGINAL readOwnedPdf (L56967, generated verbatim) wired as host.setPdfReader (L61127).
// darwin: real /usr/bin/osascript + PDFKit (macos-latest CI); elsewhere the original's own "unavailable".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOwnedPdf, PDFKIT_READER_SCRIPT } from "../src/main/attachments/pdf-reader.generated";
import { ComposerAttachmentStore } from "../src/main/attachments/composer-attachments.generated";

/** Minimal valid PDF (correct xref offsets); one page per entry, `null` = page without text. */
function makePdf(pages: (string | null)[]): Buffer {
  const objs: string[] = [];
  const n = pages.length;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((t, i) => {
    const content = t === null ? "" : `BT /F1 18 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + n * 2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const dir = () => mkdtempSync(join(tmpdir(), "vc-pdf-"));
// docs/39 M22: the real-PDFKit cases run in the macos-native CI job (VIDEOCLAW_TEST_PDFKIT=1) until green twice
const isMac = process.platform === "darwin" && existsSync("/usr/bin/osascript") && process.env.VIDEOCLAW_TEST_PDFKIT === "1";

test("readOwnedPdf: non-darwin keeps the original's own behaviour → unread/unavailable (L56968-56970)", { skip: process.platform === "darwin" && "darwin runs the real reader" }, async () => {
  const d = dir(); const f = join(d, "a.pdf"); const b = makePdf(["x"]); writeFileSync(f, b);
  assert.deepEqual(await readOwnedPdf(f, sha(b)), { kind: "unread", cause: "unavailable" });
});

test("readOwnedPdf plumbing with an injected osascript (stdin bytes, sha check, args, interpret)", { skip: process.platform === "win32" && "fake osascript is a sh script" }, async () => {
  const d = dir(); const f = join(d, "a.pdf"); const b = makePdf(["x"]); writeFileSync(f, b);
  const fake = join(d, "osascript");
  // echoes the bytes' sha256 count and the argv contract the original passes
  writeFileSync(fake, `#!/bin/sh\n[ "$1" = "-l" ] && [ "$2" = "JavaScript" ] && [ "$3" = "-e" ] && [ "$5" = "--" ] && [ "$6" = "500" ] && [ "$7" = "1000000" ] || exit 9\ncat >/dev/null\necho '{"status":"read","pages":["hello"]}'\n`);
  chmodSync(fake, 0o755);
  const r: any = await readOwnedPdf(f, sha(b), { osascript: fake });
  assert.equal(r.kind, "read"); assert.deepEqual(r.contents.pages, ["hello"]); assert.equal(r.contents.sourceSha256, sha(b));
  assert.deepEqual(await readOwnedPdf(f, "0".repeat(64), { osascript: fake }), { kind: "unread", cause: "damaged" }, "digest mismatch");
  writeFileSync(join(d, "empty.pdf"), "");
  assert.deepEqual(await readOwnedPdf(join(d, "empty.pdf"), sha(Buffer.alloc(0)), { osascript: fake }), { kind: "unread", cause: "damaged" });
  writeFileSync(fake, "#!/bin/sh\nexit 3\n");
  assert.deepEqual(await readOwnedPdf(f, sha(b), { osascript: fake }), { kind: "unread", cause: "unavailable" }, "non-zero exit");
  assert.match(PDFKIT_READER_SCRIPT, /ObjC\.import\('PDFKit'\)/);
});

test("readOwnedPdf on macOS: real /usr/bin/osascript + PDFKit (read / image-only / damaged / sha)", { skip: !isMac && "needs macOS PDFKit" }, async () => {
  const d = dir();
  const b = makePdf(["Hello Reelkiln page one", "Second page text"]); const f = join(d, "doc.pdf"); writeFileSync(f, b);
  const r: any = await readOwnedPdf(f, sha(b));
  console.log("# pdfkit read:", JSON.stringify(r));
  assert.equal(r.kind, "read");
  assert.equal(r.contents.schema, "videoclaw.pdf-text/v1");
  assert.equal(r.contents.pages.length, 2);
  assert.match(r.contents.pages[0], /Hello Reelkiln page one/);
  assert.match(r.contents.pages[1], /Second page text/);
  const img = makePdf([null]); writeFileSync(join(d, "img.pdf"), img);
  assert.deepEqual(await readOwnedPdf(join(d, "img.pdf"), sha(img)), { kind: "unread", cause: "image-only", pages: 1 });
  const junk = Buffer.from("this is not a pdf at all\n".repeat(10)); writeFileSync(join(d, "junk.pdf"), junk);
  assert.deepEqual(await readOwnedPdf(join(d, "junk.pdf"), sha(junk)), { kind: "unread", cause: "damaged" });
  assert.deepEqual(await readOwnedPdf(f, "f".repeat(64)), { kind: "unread", cause: "damaged" });
});

test("ComposerAttachmentStore.readContents → setPdfReader(readOwnedPdf) → record.pdf summary + read_pdf window (real PDFKit on macOS, injected osascript elsewhere)", { skip: process.platform === "win32" && "fake osascript is a sh script" }, async () => {
  const d = dir();
  const store: any = new ComposerAttachmentStore(join(d, "composer-attachments.json"));
  let opts = {};
  if (!isMac) {
    const fake = join(d, "osascript");
    writeFileSync(fake, `#!/bin/sh\ncat >/dev/null\necho '{"status":"read","pages":["Brief: three clips and a song"]}'\n`); chmodSync(fake, 0o755);
    opts = { osascript: fake };
  }
  store.setPdfReader((path: string, s: string) => readOwnedPdf(path, s, opts));
  const b = makePdf(["Brief: three clips and a song"]); const f = join(d, "brief.pdf"); writeFileSync(f, b);
  const rec: any = { id: "att-1", sessionId: "s1", name: "brief.pdf", stagingPath: f, sha256: sha(b), status: "submitted", finalPath: f, materialized: true };
  store.records.set(rec.id, rec);
  await store.readContents(rec);
  console.log("# store pdf:", JSON.stringify(rec.pdf));
  assert.equal(rec.pdf?.status, "read");
  assert.equal(rec.pdf.pages, 1);
  const w: any = store.readPdf("s1", "att-1", {});
  console.log("# read_pdf:", JSON.stringify(w).slice(0, 300));
  assert.equal(w.ok, true);
  assert.match(JSON.stringify(w), /three clips and a song/);
});
