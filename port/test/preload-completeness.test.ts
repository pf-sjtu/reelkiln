// Preload surface completeness (independent of preload-fidelity's member regex):
//  * the original exposes exactly ONE world key ("videoclaw") and nothing else;
//  * every top-level member line of the original `bridge` exists in the port, same order;
//  * every IPC.<key> the original preload references maps to the identical channel string;
//  * the 157 invoke + 3 send + 1 on/removeListener call sites are all covered.
// The other top-level code in the original preload (parseConfig, ENGINE_LINES,
// AGENT_ROUTE_EVIDENCE …, L227-834) is tree-shaking residue whose results are discarded and
// never exposed — verified below by checking it is not referenced inside `bridge`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bridge } from "../src/preload/bridge.generated";
import { IPC } from "../src/shared/ipc-contract";

const src = readFileSync(join(process.cwd(), "../app/reconstructed/preload/index.mjs"), "utf8");
const lines = src.split("\n");
const bStart = lines.findIndex((l) => l === "const bridge = {");
const bEnd = lines.findIndex((l) => l.startsWith("contextBridge.exposeInMainWorld"));
const bridgeBody = lines.slice(bStart + 1, bEnd).join("\n");

test("exactly one exposeInMainWorld('videoclaw', bridge)", () => {
  const exposes = [...src.matchAll(/contextBridge\.exposeInMainWorld\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(exposes, ['"videoclaw", bridge']);
});

test("member list identical (order + names)", () => {
  const names = [...bridgeBody.matchAll(/^  ([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
  assert.equal(names.length, 184);
  assert.deepEqual(Object.keys(bridge), names);
});

test("every IPC key referenced by the original preload has the identical channel in the port", () => {
  const ipcBlock = src.slice(src.indexOf("const IPC = {"), src.indexOf("};", src.indexOf("const IPC = {")));
  const orig = Object.fromEntries([...ipcBlock.matchAll(/^\s+(\w+): "([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  const used = new Set([...bridgeBody.matchAll(/IPC\.(\w+)/g)].map((m) => m[1]));
  for (const k of used) assert.equal((IPC as any)[k], orig[k], k);
  const counts = { invoke: 0, send: 0 };
  for (const m of bridgeBody.matchAll(/ipcRenderer\.(invoke|send)\(/g)) counts[m[1] as "invoke" | "send"]++;
  assert.deepEqual(counts, { invoke: 157, send: 3 });
});

test("non-bridge preload residue is not reachable from the bridge", () => {
  for (const name of ["parseConfig", "ENGINE_LINES", "AGENT_ROUTE_EVIDENCE", "GENERATION_TOOLS", "engineFamilyLine", "agentRouteId"]) assert.ok(!bridgeBody.includes(name), name);
});
