import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretPdfKitOutput, readPdfWindows } from "../src/main/platform/pdf-windows";
import { evalOriginal, fnText, slice, lineOf } from "./original-source";

test("interpretPdfKitOutput identical to original source on all statuses", () => {
  const code = ['const PDF_MAX_PAGES = 500; const PDF_MAX_TEXT_CHARS = 1e6;', slice(lineOf(/^const PDF_SCHEMA =/), lineOf(/^const PDF_SCHEMA =/)), fnText(/^function hasText\(/), fnText(/^function interpretPdfKitOutput\(/)].join("\n");
  const o = evalOriginal<any>(code, "interpretPdfKitOutput");
  const cases = ["", "x", '{"status":"locked","pages":3}', '{"status":"damaged"}', '{"status":"too-large","pages":900}', '{"status":"read","pages":["a"," "]}', '{"status":"read","pages":[" "]}', '{"status":"read","pages":[]}', '{"status":"read","pages":[1]}', '{"status":"other"}'];
  for (const c of cases) assert.deepEqual(interpretPdfKitOutput(c, "s"), o(c, "s"), c);
});

test("stub backend reproduces the original non-darwin result", async () => {
  assert.deepEqual(await readPdfWindows(new Uint8Array([1]), "s"), { kind: "unread", cause: "unavailable" });
  assert.deepEqual(await readPdfWindows(new Uint8Array(), "s"), { kind: "unread", cause: "damaged" });
});
