// docs/40 M23: harness-generated document inputs for `ui-e2e.mjs --extra-docs` — a .zip (png + nested-path pdf +
// an unsupported .exe the original skips), a two-sheet .xlsx (SheetJS, the version the original pins) and a
// one-page text PDF. Nothing here is product code; the product reads these through its own original readers.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export function minimalPdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objs[3] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n"; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export function zip(entries) {
  const locals = []; const central = []; let off = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, "utf8"); const comp = deflateRawSync(data); const crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x0314, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, comp); central.push(ch, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

export async function makeDocs(dir) {
  const XLSX = (await import("xlsx")).default ?? (await import("xlsx"));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Shot", "Clip", "Seconds"], ["Intro", "clip_a.mp4", 3], ["Outro", "clip_c.mp4", 2]]), "Plan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Note"], ["Warm grade"]]), "Notes");
  const files = { zip: join(dir, "docs.zip"), xlsx: join(dir, "plan.xlsx"), pdf: join(dir, "brief.pdf") };
  writeFileSync(files.xlsx, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  writeFileSync(files.pdf, minimalPdf("Brief: a calm 8 second recap."));
  writeFileSync(files.zip, zip([
    { name: "cover.png", data: PNG },
    { name: "boards/storyboard.pdf", data: minimalPdf("Storyboard: intro, outro.") },
    { name: "tools/skip.exe", data: Buffer.from("MZ not a program") },
  ]));
  return { files: [files.zip, files.xlsx, files.pdf] };
}
