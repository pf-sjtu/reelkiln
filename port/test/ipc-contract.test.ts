import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IPC, INVOKE_CHANNELS, SEND_CHANNELS, PUSH_CHANNELS, UNUSED_CHANNELS, BRIDGE_METHOD_COUNT, INVOKE_METHOD_BY_CHANNEL } from "../src/shared/ipc-contract";

test("channel counts match docs/04 (157/3/23/1 = 184)", () => {
  assert.equal(Object.keys(IPC).length, 184);
  assert.equal(INVOKE_CHANNELS.length, 157);
  assert.equal(SEND_CHANNELS.length, 3);
  assert.equal(PUSH_CHANNELS.length, 23);
  assert.equal(UNUSED_CHANNELS.length, 1);
  assert.equal(BRIDGE_METHOD_COUNT, 184);
});

test("IPC table equals the original `const IPC = {…}` in the shipped bundle", () => {
  const src = readFileSync(new URL("../app/out/main/index.js", "file://" + process.cwd() + "/"), "utf8");
  for (const [k, v] of Object.entries(IPC)) assert.ok(src.includes(`${k}:${JSON.stringify(v)}`) || src.includes(`${k}: ${JSON.stringify(v)}`), `${k} → ${v} not found verbatim`);
});

test("every invoke channel maps to a unique bridge method", () => {
  const m = Object.values(INVOKE_METHOD_BY_CHANNEL);
  assert.equal(new Set(m).size, m.length);
});
