#!/usr/bin/env node
// PORT-NEW (docs/43 M26): token-plan quota floor for a live ui-e2e run. Polls a "remains" probe; once the general
// window is below --floor it writes --halt-file and SIGTERMs the harness. The harness then stops the running turn
// with the original composer Stop, starts NO further turn (taste card / follow-ups) and quits through the original
// QuitCoordinator. If the harness is still alive after --grace-ms it is SIGKILLed.
//   node tools/quota-watchdog.mjs --harness-pid PID --halt-file F --remains-cmd "node remains.mjs out.json" [--floor 30] [--every-ms 30000] [--grace-ms 180000]
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { quotaHalt } from "./ui-e2e/plan.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PID = Number(opt("--harness-pid")); const HALT_FILE = opt("--halt-file"); const CMD = opt("--remains-cmd");
const FLOOR = Number(opt("--floor", "30")); const EVERY = Number(opt("--every-ms", "30000")); const GRACE = Number(opt("--grace-ms", "180000"));
if (!PID || !HALT_FILE || !CMD) { console.error("usage: quota-watchdog.mjs --harness-pid PID --halt-file F --remains-cmd CMD [--floor 30]"); process.exit(2); }
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`${new Date().toISOString()} ${m}`);

while (alive(PID)) {
  const r = spawnSync(CMD, { shell: true, encoding: "utf8", timeout: 60_000 });
  const v = quotaHalt(r.stdout, FLOOR);
  say(`general=${v.general} floor=${FLOOR}${r.status ? ` (probe rc ${r.status})` : ""}`);
  if (v.halt) {
    writeFileSync(HALT_FILE, JSON.stringify({ reason: "quota-floor", general: v.general, floor: FLOOR, at: new Date().toISOString() }) + "\n");
    say(`below floor → halt file written, SIGTERM harness ${PID}`);
    try { process.kill(PID, "SIGTERM"); } catch {}
    const t0 = Date.now(); while (alive(PID) && Date.now() - t0 < GRACE) await sleep(1000);
    if (alive(PID)) { say(`harness still alive after ${GRACE} ms → SIGKILL`); try { process.kill(PID, "SIGKILL"); } catch {} }
    else say(`harness exited after ${Date.now() - t0} ms`);
    process.exit(3);
  }
  await sleep(EVERY);
}
say("harness gone; watchdog done");
