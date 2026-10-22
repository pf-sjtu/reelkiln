// docs/40 M23: the ORIGINAL extractArchive (wb chunk L4199, yauzl 3.4.0) — limits, zip-slip guards and every
// rejection cause, on all three OSes; plus the store path readContents → unpackArchive → child attachments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_LIMITS, extractArchive, inspectZipContainer } from "../src/main/attachments/archive-extract.generated";
import { archiveRejectReason } from "../src/main/attachments/asset-kinds.generated";
import { ARCHIVE_EXTRACTION_PORTED } from "../src/main/attachments/attachments-unported";
import { ComposerAttachmentStore } from "../src/main/attachments/composer-attachments.generated";
import { makeZip, type ZipEntry } from "./zip-fixture";

const dir = () => mkdtempSync(join(tmpdir(), "vc-zip-"));
async function run(entries: ZipEntry[] | Buffer, limits: any = ARCHIVE_LIMITS, free?: (d: string) => number): Promise<any> {
  const d = dir(); const z = join(d, "a.zip"); writeFileSync(z, Buffer.isBuffer(entries) ? entries : makeZip(entries));
  const out = join(d, "out");
  const r: any = await extractArchive(z, out, limits, free);
  if (r.kind === "rejected") assert.equal(existsSync(out), false, `${r.cause}: nothing left half-unpacked`);
  return r;
}
const cause = async (entries: ZipEntry[] | Buffer, limits?: any, free?: any) => { const r = await run(entries, limits, free); assert.equal(r.kind, "rejected", JSON.stringify(r)); return r.cause; };

test("extractArchive is ported (no longer the docs/22 refusal)", () => { assert.equal(ARCHIVE_EXTRACTION_PORTED, true); });

test("extract: kept files (sorted, sha256, sizes, temp files in outDir), skipped nested/unsupported, hidden + __MACOSX ignored, deflate + stored", async () => {
  const clip = Buffer.alloc(5000, 7);
  const r = await run([
    { name: "shots/", dir: true },
    { name: "shots/b.png", data: "png-bytes" },
    { name: "shots/a.mp4", data: clip, method: 8 },
    { name: "inner.zip", data: "zz" },
    { name: "notes.exe", data: "x" },
    { name: "__MACOSX/shots/._a.mp4", data: "junk" },
    { name: ".DS_Store", data: "junk" },
  ]);
  assert.equal(r.kind, "extracted");
  assert.deepEqual(r.files.map((f: any) => [f.path, f.name, f.sizeBytes]), [["shots/a.mp4", "a.mp4", 5000], ["shots/b.png", "b.png", 9]]);
  assert.equal(r.files[0].sha256, createHash("sha256").update(clip).digest("hex"));
  assert.deepEqual(readFileSync(r.files[0].tempPath), clip);
  assert.deepEqual(r.skipped, [{ path: "inner.zip", reason: "nested-archive" }, { path: "notes.exe", reason: "unsupported" }]);
});

test("zip-slip and path guards → unsafe-path (absolute, .., backslash, empty segment, control chars, overlong names)", async () => {
  for (const name of ["../evil.png", "a/../../evil.png", "/etc/evil.png", "C:/evil.png", "a\\..\\evil.png", "a//b.png", "./a.png", "bad\u0001.png", "x".repeat(256) + ".png", ("d/".repeat(520)) + "a.png"]) {
    assert.equal(await cause([{ name, data: "x" }]), "unsafe-path", name.slice(0, 40));
  }
});

test("entry types: symlink → link; device / fifo → special-file; dir bit vs trailing slash mismatch → special-file", async () => {
  assert.equal(await cause([{ name: "l.png", data: "target", mode: 0o120777 }]), "link");
  assert.equal(await cause([{ name: "dev.png", data: "", mode: 0o020644 }]), "special-file");
  assert.equal(await cause([{ name: "fifo.png", data: "", mode: 0o010644 }]), "special-file");
  assert.equal(await cause([{ name: "d.png", data: "", mode: 0o040755 }]), "special-file");
});

test("encrypted / unsupported-compression / corrupt (garbage, bad CRC, short data)", async () => {
  assert.equal(await cause([{ name: "a.png", data: "x", flags: 1 }]), "encrypted");
  assert.equal(await cause([{ name: "a.png", data: "x", method: 12 }]), "unsupported-compression");
  assert.equal(await cause(Buffer.from("definitely not a zip file ".repeat(20))), "corrupt");
  assert.equal(await cause([{ name: "a.png", data: "hello", crc: 1234 }]), "corrupt");
  assert.equal(await cause([{ name: "a.png", data: "hello", uncompressed: 4 }]), "corrupt");
});

test("duplicates / depth / crowding / counts / sizes / bombs / empty / disk space (original limits and the injected-limits branch)", async () => {
  assert.equal(await cause([{ name: "A.png", data: "1" }, { name: "a.png", data: "2" }]), "duplicate-path", "case-insensitive NFC key");
  assert.equal(await cause([{ name: "a.png", data: "1" }, { name: "a.png/b.png", data: "2" }]), "duplicate-path", "file used as a parent");
  const deep = Array.from({ length: ARCHIVE_LIMITS.maxDepth + 1 }, (_, i) => `d${i}`).join("/") + ".png";
  assert.equal(await cause([{ name: deep, data: "x" }]), "too-deep");
  const small = { ...ARCHIVE_LIMITS, maxEntries: 3, maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 15 };
  assert.equal(await cause([1, 2, 3, 4].map((i) => ({ name: `${i}.png`, data: "x" })), small), "too-crowded");
  assert.equal(await cause([1, 2, 3].map((i) => ({ name: `${i}.png`, data: "x" })), small), "too-many");
  assert.equal(await cause([{ name: "big.png", data: "x".repeat(11) }], small), "file-too-large");
  assert.equal(await cause([{ name: "a.png", data: "x".repeat(8) }, { name: "b.png", data: "x".repeat(8) }], small), "too-large");
  const zeros = Buffer.alloc(ARCHIVE_LIMITS.ratioFloorBytes + 1024 * 1024);
  assert.equal(await cause([{ name: "z.png", data: zeros, method: 8 }]), "bomb", "compression ratio");
  assert.equal(await cause([{ name: "a.png", data: "aaaa" }, { name: "b.png", data: "bbbb", offsetOverride: 0 }]), "bomb", "overlapping local headers");
  assert.equal(await cause([{ name: "only.exe", data: "x" }, { name: ".hidden.png", data: "x" }]), "empty");
  assert.equal(await cause([{ name: "a.png", data: "x" }], ARCHIVE_LIMITS, () => 0), "no-space");
  for (const c of ["corrupt", "encrypted", "unsupported-compression", "unsafe-path", "link", "special-file", "duplicate-path", "too-deep", "too-many", "too-crowded", "file-too-large", "too-large", "bomb", "empty", "no-space"]) {
    assert.ok(typeof archiveRejectReason("clips.zip", c) === "string" && archiveRejectReason("clips.zip", c).length > 10, c);
  }
});

test("interop: an archive made by the OS's own zip tool (zip on Linux/macOS, Compress-Archive on Windows)", async (t) => {
  const d = dir(); const src = join(d, "src"); mkdirSync(join(src, "clips"), { recursive: true });
  writeFileSync(join(src, "clips", "one.mp4"), Buffer.alloc(3000, 1)); writeFileSync(join(src, "cover.png"), "png");
  const z = join(d, "os.zip");
  try {
    if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${join(src, "*")}' -DestinationPath '${z}'`]);
    else execFileSync("zip", ["-qr", z, "."], { cwd: src });
  } catch { t.skip("no OS zip tool"); return; }
  const r: any = await extractArchive(z, join(d, "out"));
  assert.equal(r.kind, "extracted", JSON.stringify(r));
  assert.deepEqual(r.files.map((f: any) => f.path), ["clips/one.mp4", "cover.png"]);
});

test("inspectZipContainer (workbook container helper): parts map, and the same guards", async () => {
  const ok: any = await inspectZipContainer(makeZip([{ name: "[Content_Types].xml", data: "<x/>" }, { name: "xl/workbook.xml", data: "<w/>", method: 8 }]), { maxEntries: 100, maxTotalBytes: 1e6, maxRatio: 100, ratioFloorBytes: 1e6 });
  assert.equal(ok.kind, "ok"); assert.equal(ok.parts.get("xl/workbook.xml").toString(), "<w/>");
  assert.deepEqual(await inspectZipContainer(makeZip([{ name: "../x.xml", data: "" }]), { maxEntries: 100, maxTotalBytes: 1e6, maxRatio: 100, ratioFloorBytes: 1e6 }), { kind: "rejected", cause: "unsafe-path" });
});

test("ComposerAttachmentStore.readContents → unpackArchive → child attachments (the store path the renderer drives)", async () => {
  const d = dir();
  const store: any = new ComposerAttachmentStore(join(d, "composer-attachments.json"));
  const bytes = makeZip([{ name: "a.png", data: "png" }, { name: "b.mp4", data: Buffer.alloc(100, 2) }]);
  const f = join(d, "clips.zip"); writeFileSync(f, bytes);
  const rec: any = { id: "att-zip", sessionId: "s1", name: "clips.zip", stagingPath: f, sha256: createHash("sha256").update(bytes).digest("hex"), status: "copying", destination: "video" };
  store.records.set(rec.id, rec);
  const r: any = await store.readContents(rec);
  assert.equal(r.refusal, undefined, JSON.stringify(r).slice(0, 300));
  assert.deepEqual(r.children.map((c: any) => c.name ?? c.file?.name).sort(), ["a.png", "b.mp4"]);
  const bad = makeZip([{ name: "../x.png", data: "x" }]); const g = join(d, "bad.zip"); writeFileSync(g, bad);
  const rec2: any = { ...rec, id: "att-bad", name: "bad.zip", stagingPath: g, sha256: createHash("sha256").update(bad).digest("hex") };
  store.records.set(rec2.id, rec2);
  assert.equal((await store.readContents(rec2)).refusal, archiveRejectReason("bad.zip", "unsafe-path"));
  void readdirSync;
});
