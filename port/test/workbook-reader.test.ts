// docs/40 M23: the ORIGINAL workbook reader — workbookWorker.js (SheetJS 0.20.3, generated verbatim) behind
// readWorkbookInWorker (wb L4448) and ComposerAttachmentStore.setWorkbookReader (L61124-61126).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbook, readOwnedWorkbook } from "../src/main/workers/workbook-worker.generated";
import { readWorkbookInWorker } from "../src/main/attachments/workbook-reader.generated";
import { isWorkbookContents, workbookPage, workbookRejectReason } from "../src/main/attachments/asset-kinds.generated";
import { ComposerAttachmentStore } from "../src/main/attachments/composer-attachments.generated";
import { makeZip } from "./zip-fixture";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function book(bookType: "xlsx" | "ods" | "biff8"): Buffer {
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet([["Shot", "Seconds", "Date"], ["Intro", 2.5, new Date(2026, 9, 22) /* SheetJS writes local midnight; the worker reads with UTC:true */], ["Total", { t: "n", v: 2.5, f: "SUM(B2:B2)" } as any]], { cellDates: true });
  XLSX.utils.book_append_sheet(wb, s1, "Plan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["secret"]]), "Notes");
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] } as any;
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType }));
}
/** An in-process stand-in for forkWorkbookWorker: same message protocol as the utilityProcess. */
const inProcessFork = (o: { exit?: boolean; garble?: boolean } = {}) => () => {
  let cb: (m: any) => void = () => {}; let onExit: () => void = () => {};
  return {
    postMessage: (m: any) => { if (o.exit) { setTimeout(() => onExit(), 5); return; } void readOwnedWorkbook(m).then((result: any) => cb({ type: "result", result: o.garble ? { kind: "read", contents: { schema: "nope" } } : result })); },
    onMessage: (f: any) => { cb = f; }, onExit: (f: any) => { onExit = f; }, kill: () => {},
  };
};

test("parseWorkbook: xlsx / ods / xls → the original contents schema (cached values, formulas as text, dates ISO, hidden sheets)", async () => {
  for (const [bt, name, format] of [["xlsx", "plan.xlsx", "xlsx"], ["ods", "plan.ods", "ods"], ["biff8", "plan.xls", "xls"]] as const) {
    const b = book(bt);
    const r: any = await parseWorkbook(b, name, sha(b));
    assert.equal(r.kind, "read", `${name}: ${JSON.stringify(r)}`);
    assert.equal(r.contents.format, format);
    assert.ok(isWorkbookContents(r.contents, sha(b)), name);
    const plan = r.contents.sheets[0];
    assert.equal(plan.name, "Plan"); assert.equal(plan.hidden, false);
    assert.equal(plan.cells.find((c: any) => c.ref === "A2").value, "Intro");
    assert.equal(plan.cells.find((c: any) => c.ref === "B2").value, 2.5);
    assert.equal(plan.cells.find((c: any) => c.ref === "C2").value, "2026-10-22", `${name} date`);
    if (format === "xlsx") assert.equal(plan.cells.find((c: any) => c.ref === "B3").formula, "SUM(B2:B2)", `${name} formula`);
    if (format === "xlsx") assert.equal(r.contents.sheets[1].hidden, true);
    const page: any = workbookPage(r.contents, { sheet: "Plan", range: "A1:B2" });
    assert.equal(page.ok, true); assert.equal(page.cells.length, 4);
  }
});

test("parseWorkbook refusals (original causes): extension, CFB-as-xlsx → encrypted, garbage → corrupt, container bomb → too-complex, missing parts → corrupt", async () => {
  const b = book("xlsx");
  assert.deepEqual(await parseWorkbook(b, "plan.csv", sha(b)), { kind: "rejected", cause: "corrupt" });
  const cfb = Buffer.concat([Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]), Buffer.alloc(512)]);
  assert.deepEqual(await parseWorkbook(cfb, "locked.xlsx", sha(cfb)), { kind: "rejected", cause: "encrypted" });
  assert.deepEqual(await parseWorkbook(Buffer.from("hello"), "x.xlsx", "0".repeat(64)), { kind: "rejected", cause: "corrupt" });
  const bomb = makeZip([{ name: "[Content_Types].xml", data: Buffer.alloc(80 * 1024 * 1024), method: 8 }, { name: "xl/workbook.xml", data: "<w/>" }]);
  assert.deepEqual(await parseWorkbook(bomb, "bomb.xlsx", sha(bomb)), { kind: "rejected", cause: "too-complex" });
  const partial = makeZip([{ name: "[Content_Types].xml", data: "<x/>" }]);
  assert.deepEqual(await parseWorkbook(partial, "p.xlsx", sha(partial)), { kind: "rejected", cause: "corrupt" });
  assert.match(workbookRejectReason("plan.xlsx", "encrypted"), /plan\.xlsx/);
});

test("readOwnedWorkbook: digest mismatch / symlink (O_NOFOLLOW) → corrupt", async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-wb-")); const b = book("xlsx"); const f = join(d, "plan.xlsx"); writeFileSync(f, b);
  assert.equal(((await readOwnedWorkbook({ path: f, name: "plan.xlsx", sha256: sha(b) })) as any).kind, "read");
  assert.deepEqual(await readOwnedWorkbook({ path: f, name: "plan.xlsx", sha256: "f".repeat(64) }), { kind: "rejected", cause: "corrupt" });
  if (process.platform !== "win32") { symlinkSync(f, join(d, "link.xlsx")); assert.deepEqual(await readOwnedWorkbook({ path: join(d, "link.xlsx"), name: "link.xlsx", sha256: sha(b) }), { kind: "rejected", cause: "corrupt" }); }
});

test("readWorkbookInWorker (wb L4448): result validated by isWorkbookContents; worker exit / timeout → too-complex; malformed → corrupt", async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-wbw-")); const b = book("xlsx"); const f = join(d, "plan.xlsx"); writeFileSync(f, b);
  const req = { path: f, name: "plan.xlsx", sha256: sha(b) };
  assert.equal(((await readWorkbookInWorker(inProcessFork(), req)) as any).kind, "read");
  assert.deepEqual(await readWorkbookInWorker(inProcessFork({ exit: true }), req), { kind: "rejected", cause: "too-complex" });
  assert.deepEqual(await readWorkbookInWorker(inProcessFork({ garble: true }), req), { kind: "rejected", cause: "corrupt" });
  assert.deepEqual(await readWorkbookInWorker(() => ({ postMessage() {}, onMessage() {}, onExit() {}, kill() {} }) as any, req, 50), { kind: "rejected", cause: "too-complex" });
  assert.deepEqual(await readWorkbookInWorker(() => { throw new Error("fork failed"); }, req), { kind: "rejected", cause: "too-complex" });
});

test("ComposerAttachmentStore.setWorkbookReader → readContents → record.workbook summary → read_workbook window", async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-wbs-"));
  const store: any = new ComposerAttachmentStore(join(d, "composer-attachments.json"));
  store.setWorkbookReader((path: string, name: string, s: string) => readWorkbookInWorker(inProcessFork(), { path, name, sha256: s }));
  const b = book("xlsx"); const f = join(d, "plan.xlsx"); writeFileSync(f, b);
  const rec: any = { id: "att-wb", sessionId: "s1", name: "plan.xlsx", stagingPath: f, sha256: sha(b), status: "submitted", finalPath: f, materialized: true };
  store.records.set(rec.id, rec);
  const r: any = await store.readContents(rec);
  assert.equal(r.refusal, undefined);
  assert.equal(rec.workbook.sheets, 2); assert.match(rec.workbook.summary, /^2 sheets — "Plan" A1:C3/);
  const w: any = store.readWorkbook("s1", "att-wb", { sheet: "Plan", cell: "A2" });
  assert.equal(w.ok, true); assert.equal(w.value, "Intro");
  const bad = Buffer.from("not a workbook"); const g = join(d, "bad.xlsx"); writeFileSync(g, bad);
  const rec2: any = { ...rec, id: "att-bad", name: "bad.xlsx", stagingPath: g, sha256: sha(bad) };
  store.records.set(rec2.id, rec2);
  assert.equal((await store.readContents(rec2)).refusal, workbookRejectReason("bad.xlsx", "corrupt"));
});
