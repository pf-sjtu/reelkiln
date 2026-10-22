// docs/39 M22: staging Flight profile (L6159-6238 verbatim) + startup application (L60305-60318) + window flags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applicationChannel, resolveStagingFlightProfile, workspaceLeafForChannel } from "../src/main/platform/staging-flight.generated";
import { applyStagingFlightStartup, flightWindowFlags } from "../src/main/staging-flight";

export function flightRoot(id = "flight-1") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vc-flight-")));
  mkdirSync(join(root, "user-data")); mkdirSync(join(root, "workspace"));
  writeFileSync(join(root, ".videoclaw-flight-root.json"), JSON.stringify({ schema: "videoclaw.flight-root/v2", root, campaignInstanceId: id }));
  return { root, env: { VIDEOCLAW_FLIGHT_ROOT: root, VIDEOCLAW_FLIGHT_INSTANCE_ID: id, VIDEOCLAW_USERDATA_DIR: join(root, "user-data"), VIDEOCLAW_WORKSPACE_DIR: join(root, "workspace") } as Record<string, string> };
}
function fakeApp(packaged = false, switches: string[] = []) {
  const calls: string[] = [];
  const sw = new Set(switches);
  return { calls, app: { isPackaged: packaged, setActivationPolicy: (p: string) => calls.push(`policy:${p}`), setPath: (n: string, p: string) => calls.push(`setPath:${n}=${p}`), commandLine: { hasSwitch: (n: string) => sw.has(n), appendSwitch: (n: string, v?: string) => calls.push(`switch:${n}=${v}`) } } as any };
}

test("applicationChannel() is hard-wired to \"prod\" in the shipped build (L9172) → no Flight profile, whatever the env", () => {
  assert.equal(applicationChannel(), "prod");
  assert.equal(workspaceLeafForChannel("prod"), "Videoclaw");
  const { env } = flightRoot();
  assert.equal(resolveStagingFlightProfile(applicationChannel(), { ...env, VIDEOCLAW_FLIGHT_HIDDEN: "1" }), undefined);
});

test("resolveStagingFlightProfile(\"staging\"): complete env + marker → profile (hidden only for VIDEOCLAW_FLIGHT_HIDDEN=1); incomplete / mismatched → throws", () => {
  const { root, env } = flightRoot("abc");
  assert.equal(resolveStagingFlightProfile("staging", {}), undefined);
  assert.deepEqual(resolveStagingFlightProfile("staging", env), { root, instanceId: "abc", userDataDir: join(root, "user-data"), workspaceDir: join(root, "workspace") });
  assert.equal((resolveStagingFlightProfile("staging", { ...env, VIDEOCLAW_FLIGHT_HIDDEN: " 1 " }) as any).hidden, true);
  assert.throws(() => resolveStagingFlightProfile("staging", { VIDEOCLAW_FLIGHT_ROOT: root }), /incomplete/);
  assert.throws(() => resolveStagingFlightProfile("staging", { ...env, VIDEOCLAW_FLIGHT_INSTANCE_ID: "other" }), /does not match this launch/);
});

test("applyStagingFlightStartup (L60306-60318): hidden + darwin → setActivationPolicy(\"accessory\"); userData + loopback CDP switches; dev VIDEOCLAW_USERDATA_DIR branch", () => {
  const { env } = flightRoot();
  const hidden: any = resolveStagingFlightProfile("staging", { ...env, VIDEOCLAW_FLIGHT_HIDDEN: "1" });
  const shown: any = resolveStagingFlightProfile("staging", env);
  let f = fakeApp();
  applyStagingFlightStartup(f.app, hidden, {}, "darwin");
  assert.deepEqual(f.calls, ["policy:accessory", `setPath:userData=${hidden.userDataDir}`, "switch:remote-debugging-address=127.0.0.1", "switch:remote-debugging-port=0"]);
  f = fakeApp(); applyStagingFlightStartup(f.app, hidden, {}, "win32");
  assert.ok(!f.calls.some((c) => c.startsWith("policy:")), "only on darwin");
  f = fakeApp(false, ["remote-debugging-port"]); applyStagingFlightStartup(f.app, shown, {}, "darwin");
  assert.deepEqual(f.calls, [`setPath:userData=${shown.userDataDir}`, "switch:remote-debugging-address=127.0.0.1"], "not hidden → no accessory; an explicit port switch is kept");
  f = fakeApp(false); applyStagingFlightStartup(f.app, undefined, { VIDEOCLAW_USERDATA_DIR: "/tmp/ud" }, "darwin");
  assert.deepEqual(f.calls, ["setPath:userData=/tmp/ud"]);
  f = fakeApp(true); applyStagingFlightStartup(f.app, undefined, { VIDEOCLAW_USERDATA_DIR: "/tmp/ud" }, "darwin");
  assert.deepEqual(f.calls, [], "packaged + prod → nothing");
  assert.deepEqual(flightWindowFlags(hidden), { show: false, backgroundThrottling: false });
  assert.deepEqual(flightWindowFlags(undefined), { show: true, backgroundThrottling: true });
});
