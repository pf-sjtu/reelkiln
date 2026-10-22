// docs/23 M5: UI-e2e mode wiring (original renderer, dialog presets, no smoke page) and the pure parts of
// the CDP driver (tools/ui-e2e.mjs): CDP client framing, real-input helpers' wire format, play-button
// geometry, playback verdict, evidence redaction. The live run (real MiniMax, real engine, original UI
// clicked over CDP) is evidence in artifacts/phase-b-m5, not a unit test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { resolveRendererEntry } from "../src/main/renderer-entry";
import { smokeDialog } from "../src/main/media/media-ipc";
import { Cdp, mouseClick, dropFiles, pressKey, typeText } from "../tools/ui-e2e/cdp.mjs";
import { answerDeclined, center, nativePlayButton, playbackVerdict, redactEvidence, S1_UI_STEPS } from "../tools/ui-e2e/plan.mjs";

const base = { packaged: false, appPath: "/repo/port", resourcesPath: "/res", mainDir: "/repo/port/dist/main", exists: () => true };

test("UI-e2e mode always loads the ORIGINAL renderer, even with VIDEOCLAW_PORT_SMOKE=1", () => {
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_UI_E2E: "1" } }).kind, "original");
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE: "1" } }).kind, "original");
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_SMOKE: "1" } }).kind, "port", "legacy smoke unchanged");
  assert.equal(resolveRendererEntry({ ...base, env: { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_RENDERER: "port" } }).kind, "port", "explicit override still wins");
});

test("UI-e2e mode answers the native dialogs from the env presets; otherwise the real dialog is used", async () => {
  const calls: string[] = [];
  const real = { showSaveDialog: async () => { calls.push("save"); return { canceled: true }; }, showOpenDialog: async () => { calls.push("open"); return { canceled: true, filePaths: [] }; } };
  const d = smokeDialog(real, { VIDEOCLAW_PORT_UI_E2E: "1", VIDEOCLAW_PORT_SMOKE_SAVE_AS: "/x/s1.mp4", VIDEOCLAW_PORT_SMOKE_PICK_FILES: "/a.mp4\n/b.mp3\n" });
  assert.deepEqual(await d.showSaveDialog({ defaultPath: "/d/v1.mp4" }), { canceled: false, filePath: "/x/s1.mp4" });
  assert.deepEqual(await d.showOpenDialog({ title: "t", buttonLabel: "b", properties: [] }), { canceled: false, filePaths: ["/a.mp4", "/b.mp3"] });
  const plain = smokeDialog(real, {});
  assert.equal(plain, real);
  const noPreset = smokeDialog(real, { VIDEOCLAW_PORT_UI_E2E: "1" });
  await noPreset.showSaveDialog({ defaultPath: "/d" }); await noPreset.showOpenDialog({ title: "t", buttonLabel: "b", properties: [] });
  assert.deepEqual(calls, ["save", "open"]);
});

function fakeSocket() {
  const sent: any[] = [];
  const ws: any = { sent, send: (s: string) => sent.push(JSON.parse(s)), close: () => ws.onclose?.() };
  ws.reply = (id: number, result: unknown) => ws.onmessage({ data: JSON.stringify({ id, result }) });
  ws.fail = (id: number, message: string) => ws.onmessage({ data: JSON.stringify({ id, error: { message } }) });
  ws.event = (method: string, params: unknown) => ws.onmessage({ data: JSON.stringify({ method, params }) });
  return ws;
}

test("CDP client: id correlation, errors, events, eval by value, socket close rejects pending", async () => {
  const ws = fakeSocket(); const logged: any[] = [];
  const c = Cdp.fromSocket(ws, (o: any) => logged.push(o));
  const p1 = c.send("Page.enable"); const p2 = c.send("DOM.getDocument", { depth: 1 });
  ws.reply(2, { root: 1 }); ws.reply(1, {});
  assert.deepEqual(await p2, { root: 1 }); assert.deepEqual(await p1, {});
  const p3 = c.send("Bad.method"); ws.fail(3, "nope");
  await assert.rejects(p3, /Bad\.method: nope/);
  let ev: any = null; const off = c.on("Runtime.consoleAPICalled", (p: any) => { ev = p; });
  ws.event("Runtime.consoleAPICalled", { type: "error" }); assert.deepEqual(ev, { type: "error" }); off();
  const pe = c.eval("1+1"); assert.equal(ws.sent[3].method, "Runtime.evaluate"); assert.equal(ws.sent[3].params.returnByValue, true);
  ws.reply(4, { result: { value: 2 } }); assert.equal(await pe, 2);
  const px = c.eval("throw 1"); ws.reply(5, { result: {}, exceptionDetails: { text: "Uncaught", exception: { description: "Error: boom" } } });
  await assert.rejects(px, /boom/);
  assert.ok(logged.some((l) => l.cdp === "Page.enable"), "input/protocol calls are logged");
  assert.ok(!logged.some((l) => l.cdp === "Runtime.evaluate"), "read-only evaluations are not logged as actions");
  const pending = c.send("Page.reload"); ws.close();
  await assert.rejects(pending, /closed/);
});

test("real-input helpers emit Input.* events (mouse press/release, insertText, Enter with \\r, OS drag with files)", async () => {
  const ws = fakeSocket(); const c = Cdp.fromSocket(ws, () => {});
  const auto = setInterval(() => { for (const m of ws.sent) if (!m.done) { m.done = true; ws.reply(m.id, {}); } }, 1);
  try {
    await mouseClick(c, 10, 20);
    await typeText(c, "你好");
    await pressKey(c, "Enter");
    await dropFiles(c, 5, 6, ["/a.mp4", "/b.mp3"]);
  } finally { clearInterval(auto); }
  const m = ws.sent.map((x: any) => `${x.method}:${x.params.type ?? ""}`);
  assert.deepEqual(m, ["Input.dispatchMouseEvent:mouseMoved", "Input.dispatchMouseEvent:mousePressed", "Input.dispatchMouseEvent:mouseReleased", "Input.insertText:", "Input.dispatchKeyEvent:keyDown", "Input.dispatchKeyEvent:keyUp", "Input.dispatchDragEvent:dragEnter", "Input.dispatchDragEvent:dragOver", "Input.dispatchDragEvent:drop"]);
  assert.equal(ws.sent[1].params.clickCount, 1); assert.equal(ws.sent[1].params.x, 10);
  assert.equal(ws.sent[4].params.text, "\r"); assert.equal(ws.sent[4].params.windowsVirtualKeyCode, 13);
  assert.deepEqual(ws.sent[8].params.data.files, ["/a.mp4", "/b.mp3"]);
});

test("driver geometry + verdict helpers", () => {
  assert.deepEqual(center({ x: 10, y: 20, width: 100, height: 40 }), { x: 60, y: 40 });
  assert.deepEqual(nativePlayButton({ x: 905, y: 140, width: 359, height: 227.36 }), { x: 929, y: 317 });
  assert.deepEqual(nativePlayButton({ x: 713, y: 140, width: 279, height: 144 }), { x: 737, y: 236 }); // Windows S1 (docs/36)
  const s = (t: number, o: any = {}) => ({ currentTime: t, paused: false, ended: false, readyState: 4, error: null, ...o });
  assert.equal(playbackVerdict([s(0.1), s(0.6), s(1.4)]).ok, true);
  assert.equal(playbackVerdict([s(0.1), s(0.2)]).ok, false, "clock must advance > 0.5 s");
  assert.equal(playbackVerdict([s(0.1, { paused: true }), s(2)]).ok, false, "must not be paused");
  assert.equal(playbackVerdict([s(0.1, { readyState: 2 }), s(2, { readyState: 3 })]).ok, false, "must reach HAVE_ENOUGH_DATA");
  assert.equal(playbackVerdict([]).ok, false);
  assert.equal(S1_UI_STEPS.length, 9);
});

test("evidence redaction scrubs secrets and run paths", () => {
  const secret = "mm-" + "x".repeat(30);
  const out = redactEvidence(`key=${secret} path=/workspace/m5/runA/Videoclaw/jobs/j token sk-abcdefghijklmnopqrstu`, { paths: { "/workspace/m5/runA": "<RUN>" }, secrets: [secret] });
  assert.equal(out, "key=<REDACTED> path=<RUN>/Videoclaw/jobs/j token <REDACTED>");
});

test("ui-e2e driver parses (node --check)", () => {
  const r = spawnSync(process.execPath, ["--check", resolve(__dirname, "..", "tools", "ui-e2e.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("answerDeclined: the deny phrasing (devD2) counts, quoted 'declined proposals' file content (qcardQ1) does not", () => {
  assert.equal(answerDeclined(["The user declined the question. Hmm. The AskUserQuestion was declined — \"declined this step\" means they dismissed the question."]), true);
  assert.equal(answerDeclined(["Denied by user"]), true);
  assert.equal(answerDeclined(["用户拒绝了这个问题"]), true);
  // multiSelect: options left unticked are "declined" by an ACCEPTED answer (qcardQ1 thinking)
  assert.equal(answerDeclined(["Here the user declined \"No captions or overlays\", \"No paid tools\" as *locked rules*"]), false);
  assert.equal(answerDeclined(["User kept only:\n1. Music-only audio\n## ANTI-COMMITMENTS (declined proposals — do not re-raise)\n- _(none yet)_"]), false);
  assert.equal(answerDeclined(["你选了竖屏 9:16。", "Locked: **music-only audio** and **center-crop to fill 9:16**."]), false);
});
