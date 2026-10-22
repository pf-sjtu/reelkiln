// docs/36 M19: Windows Python ends the production verdict line with CRLF; the parser strips exactly one trailing
// CRLF on win32 (found by the Windows S1 UI e2e: every agent Bash call was refused before this).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductionVerdictResult } from "../src/main/agent/production-auth.generated";

const asPlatform = <T>(p: NodeJS.Platform, fn: () => T): T => {
  const d = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...d, value: p });
  try { return fn(); } finally { Object.defineProperty(process, "platform", d); }
};
const ONE_LINE = "Production verdict must contain exactly one JSON line.";

test("production verdict: win32 accepts one trailing CRLF; embedded CR / two lines still refused; POSIX unchanged", () => {
  assert.notEqual(asPlatform("win32", () => parseProductionVerdictResult("{}\r\n", "", 0)).reason, ONE_LINE);
  assert.equal(asPlatform("win32", () => parseProductionVerdictResult("{}\r\r\n", "", 0)).reason, ONE_LINE);
  assert.equal(asPlatform("win32", () => parseProductionVerdictResult("{}\r\n{}\r\n", "", 0)).reason, ONE_LINE);
  assert.equal(asPlatform("linux", () => parseProductionVerdictResult("{}\r\n", "", 0)).reason, ONE_LINE);
  assert.notEqual(asPlatform("linux", () => parseProductionVerdictResult("{}\n", "", 0)).reason, ONE_LINE);
});
