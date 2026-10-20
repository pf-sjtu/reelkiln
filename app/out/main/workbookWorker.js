import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { bu as assetExt, bv as WORKBOOK_MAX_BYTES, bw as WORKBOOK_MAX_SHEETS, bx as WORKBOOK_MAX_CELLS, W as WORKBOOK_MAX_OUTPUT_BYTES, by as WORKBOOK_SCHEMA, bz as inspectZipContainer, bA as storedZip, bB as WORKBOOK_MAX_CELL_CHARS, bC as ARCHIVE_RATIO_FLOOR_BYTES, bD as WORKBOOK_CONTAINER_MAX_RATIO, bE as WORKBOOK_CONTAINER_MAX_BYTES, bF as WORKBOOK_CONTAINER_MAX_ENTRIES, bG as columnName } from "./chunks/workbookContents-ChzKjQX1.js";
import * as XLSX from "xlsx";
import "node:stream";
import "node:stream/promises";
import "node:path";
import "node:zlib";
import "yauzl";
const ZIP_MAGIC = Buffer.from([80, 75, 3, 4]);
const CFB_MAGIC = Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]);
const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";
const MAX_FORMULA_CHARS = 8192;
const MAX_SHEET_NAME_CHARS = 100;
const PARSE_OPTIONS = {
  type: "buffer",
  dense: true,
  cellFormula: true,
  cellText: true,
  cellDates: true,
  UTC: true,
  cellHTML: false,
  cellNF: false,
  cellStyles: false,
  sheetStubs: false,
  bookVBA: false,
  bookFiles: false,
  bookDeps: false,
  bookProps: false,
  WTF: false
};
class Refusal extends Error {
  constructor(cause) {
    super(cause);
    this.cause = cause;
  }
}
async function parserInput(bytes, format) {
  if (format === "xls") {
    if (!bytes.subarray(0, 8).equals(CFB_MAGIC)) throw new Refusal("corrupt");
    return bytes;
  }
  if (!bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new Refusal(bytes.subarray(0, 8).equals(CFB_MAGIC) ? "encrypted" : "corrupt");
  }
  const inspection = await inspectZipContainer(bytes, {
    maxEntries: WORKBOOK_CONTAINER_MAX_ENTRIES,
    maxTotalBytes: WORKBOOK_CONTAINER_MAX_BYTES,
    maxRatio: WORKBOOK_CONTAINER_MAX_RATIO,
    ratioFloorBytes: ARCHIVE_RATIO_FLOOR_BYTES
  });
  if (inspection.kind === "rejected") {
    const cause = inspection.cause;
    throw new Refusal(cause === "encrypted" ? "encrypted" : cause === "bomb" || cause === "too-large" || cause === "too-crowded" || cause === "file-too-large" ? "too-complex" : "corrupt");
  }
  const parts = inspection.parts;
  const ok = format === "xlsx" ? parts.has("[Content_Types].xml") && parts.has("xl/workbook.xml") : parts.get("mimetype")?.toString("ascii") === ODS_MIMETYPE && parts.has("content.xml");
  if (!ok) throw new Refusal("corrupt");
  return storedZip(parts);
}
function normalizeCell(cell, row, col) {
  const ref = `${columnName(col)}${row + 1}`;
  const formula = typeof cell.f === "string" && cell.f ? cell.f : void 0;
  if (formula && formula.length > MAX_FORMULA_CHARS) throw new Refusal("corrupt");
  const text = typeof cell.w === "string" ? cell.w : void 0;
  let type;
  let value;
  switch (cell.t) {
    case "s":
      type = "string";
      value = String(cell.v ?? "");
      break;
    case "n":
      type = "number";
      value = Number(cell.v);
      if (!Number.isFinite(value)) return null;
      break;
    case "b":
      type = "boolean";
      value = Boolean(cell.v);
      break;
    case "d": {
      type = "date";
      const date = cell.v instanceof Date ? cell.v : new Date(String(cell.v));
      if (Number.isNaN(date.getTime())) return null;
      const iso = date.toISOString();
      value = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
      break;
    }
    case "e":
      type = "error";
      value = text ?? "#ERROR";
      break;
    default:
      if (!formula) return null;
      type = "string";
      value = "";
  }
  if (typeof value === "string" && value.length > WORKBOOK_MAX_CELL_CHARS) throw new Refusal("corrupt");
  if (text !== void 0 && text.length > WORKBOOK_MAX_CELL_CHARS) throw new Refusal("corrupt");
  return {
    ref,
    row,
    col,
    type,
    value,
    ...text !== void 0 && text !== String(value) ? { text } : {},
    ...formula ? { formula } : {}
  };
}
async function parseWorkbook(bytes, name, sha256) {
  try {
    const ext = assetExt(name);
    const format = ext === ".xlsx" ? "xlsx" : ext === ".xls" ? "xls" : ext === ".ods" ? "ods" : null;
    if (!format) throw new Refusal("corrupt");
    if (bytes.length > WORKBOOK_MAX_BYTES) throw new Refusal("too-large");
    const input = await parserInput(bytes, format);
    let book;
    try {
      book = XLSX.read(input, PARSE_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      throw new Refusal(/password|encrypt/i.test(message) ? "encrypted" : "corrupt");
    }
    if (!Array.isArray(book.SheetNames) || book.SheetNames.length === 0) throw new Refusal("corrupt");
    if (book.SheetNames.length > WORKBOOK_MAX_SHEETS) throw new Refusal("too-many-sheets");
    if (book.SheetNames.some((name2) => typeof name2 !== "string" || name2.length > MAX_SHEET_NAME_CHARS || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name2))) throw new Refusal("corrupt");
    let cellCount = 0;
    let textBytes = 0;
    const sheets = book.SheetNames.map((sheetName, index) => {
      const sheet = book.Sheets[sheetName];
      const cells = [];
      const rows = sheet?.["!data"] ?? [];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          const raw = row[c];
          if (!raw) continue;
          const cell = normalizeCell(raw, r, c);
          if (!cell) continue;
          cellCount += 1;
          if (cellCount > WORKBOOK_MAX_CELLS) throw new Refusal("too-many-cells");
          textBytes += cell.ref.length + String(cell.value).length + (cell.text?.length ?? 0) + (cell.formula?.length ?? 0) + 48;
          if (textBytes > WORKBOOK_MAX_OUTPUT_BYTES) throw new Refusal("too-complex");
          cells.push(cell);
        }
      }
      const hidden = Number(book.Workbook?.Sheets?.[index]?.Hidden ?? 0) !== 0;
      const range = cells.length > 0 && typeof sheet?.["!ref"] === "string" ? sheet["!ref"] : null;
      return { name: String(sheetName), hidden, range, cellCount: cells.length, cells };
    });
    const contents = { schema: WORKBOOK_SCHEMA, format, sourceSha256: sha256, cellCount, sheets };
    if (Buffer.byteLength(JSON.stringify(contents)) > WORKBOOK_MAX_OUTPUT_BYTES) throw new Refusal("too-complex");
    return { kind: "read", contents };
  } catch (error) {
    return { kind: "rejected", cause: error instanceof Refusal ? error.cause : "corrupt" };
  }
}
async function readOwnedWorkbook(request) {
  let file;
  try {
    file = await open(request.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) return { kind: "rejected", cause: "corrupt" };
    if (stat.size > WORKBOOK_MAX_BYTES) return { kind: "rejected", cause: "too-large" };
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || createHash("sha256").update(bytes).digest("hex") !== request.sha256) {
      return { kind: "rejected", cause: "corrupt" };
    }
    return await parseWorkbook(bytes, request.name, request.sha256);
  } catch {
    return { kind: "rejected", cause: "corrupt" };
  } finally {
    await file?.close().catch(() => {
    });
  }
}
const parentPort = process.parentPort;
if (parentPort) {
  parentPort.on("message", ({ data }) => {
    if (data?.type !== "read") return;
    void readOwnedWorkbook(data).then((result) => parentPort.postMessage({ type: "result", result }));
  });
}
export {
  readOwnedWorkbook
};
