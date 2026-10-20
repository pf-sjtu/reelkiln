import { test } from "node:test";
import assert from "node:assert/strict";
import { trackIpcRequests } from "../src/main/ipc-tracking";
import { createFakeBackend } from "../src/main/fake-backend";
import { INVOKE_CHANNELS, SEND_CHANNELS, type InvokeChannel } from "../src/shared/ipc-contract";

test("every invoke/send channel registers once; fake backend answers or logs", async () => {
  const handlers = new Map<string, Function>();
  const ons = new Map<string, Function>();
  const mock = { handle: (c: string, f: Function) => { assert.ok(!handlers.has(c)); handlers.set(c, f); }, on: (c: string, f: Function) => ons.set(c, f) } as any;
  const pushes: unknown[][] = [];
  const logs: string[] = [];
  const backend = createFakeBackend((...a) => { pushes.push(a); return true; }, (m) => logs.push(m));
  const { ipc, pendingExcept } = trackIpcRequests(mock);
  for (const ch of INVOKE_CHANNELS) ipc.handle(ch, (_e: unknown, ...args: unknown[]) => backend.invoke(ch as InvokeChannel, args));
  for (const ch of SEND_CHANNELS) ipc.on(ch, () => {});
  assert.equal(handlers.size, 157);
  assert.equal(ons.size, 3);
  for (const c of backend.implemented()) assert.ok(handlers.has(c), `fake implements unknown channel ${c}`);
  assert.deepEqual(await handlers.get("client:list")!({}), [{ clientId: "personal", name: "Personal" }, { clientId: "humeo", name: "Humeo", tenant: "humeo" }]);
  const p = handlers.get("bootstrap:run")!({});
  assert.equal(pendingExcept("other"), true);
  await p;
  assert.equal(pendingExcept("other"), false);
  assert.equal(pushes.length, 16);
  assert.deepEqual(pushes[0], ["bootstrap:progress", { step: "layout", status: "running" }]);
  assert.equal(await handlers.get("session:list")!({}), undefined);
  assert.match(logs.at(-1)!, /NOT IMPLEMENTED session:list/);
});
