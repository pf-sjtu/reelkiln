// Drives every member of the generated preload bridge and checks the resulting
// ipcRenderer call (fn, channel, argument order) against the ORIGINAL preload source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "./electron-mock"; // same module instance as the aliased "electron"
import { bridge } from "../src/preload/bridge.generated";
import { IPC } from "../src/shared/ipc-contract";

const src = readFileSync(join(process.cwd(), "../app/reconstructed/preload/index.mjs"), "utf8");
const body = src.slice(src.indexOf("const bridge = {"), src.indexOf("contextBridge.exposeInMainWorld"));
// member: (params) => ipcRenderer.fn(IPC.key, a, b)  | subscribe(IPC.key, cb) — may span lines
const re = /^  (\w+): \(([^)]*)\) =>\s*(?:ipcRenderer\.(invoke|send)|(subscribe)|(webUtils\.getPathForFile))\(([^)]*)\)/gms;
const expected = new Map<string, { fn: string; key?: string; params: string[]; passed: string[] }>();
for (const m of body.matchAll(re)) {
  const [, name, params, ipcFn, sub, wu, inner] = m;
  const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
  const fn = ipcFn ?? (sub ? "on" : "local");
  const key = wu ? undefined : parts[0].replace(/^IPC\./, "");
  expected.set(name, { fn, key, params: params.split(",").map((s) => s.trim()).filter(Boolean), passed: wu ? parts : parts.slice(1) });
}

test("original preload parsed completely", () => assert.equal(expected.size, 184));

test("every generated bridge member reproduces the original ipcRenderer call", () => {
  assert.deepEqual(Object.keys(bridge), [...expected.keys()], "member order");
  for (const [name, exp] of expected) {
    if (exp.fn === "local") continue;
    calls.length = 0;
    const args = exp.params.map((p) => `<${p}>`);
    const ret = (bridge as any)[name](...(exp.fn === "on" ? [() => {}] : args));
    const c = calls[0];
    assert.ok(c, `${name}: no ipc call`);
    assert.equal(c.fn, exp.fn, `${name}: fn`);
    assert.equal(c.channel, (IPC as any)[exp.key!], `${name}: channel`);
    if (exp.fn !== "on") assert.deepEqual(c.args, exp.passed.map((p) => `<${p}>`), `${name}: args`);
    else { assert.equal(typeof ret, "function"); ret(); assert.equal(calls[1].fn, "removeListener"); }
  }
});

test("pathForFile stays local (webUtils)", () => {
  assert.equal(bridge.pathForFile({} as File), "/mock/path");
});
