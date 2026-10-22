// docs/39 M22: the ORIGINAL VoiceDictation (L10599, generated verbatim) behind media:transcribeVoice and the
// voice-note background transcript (stageVoiceNote L44753). A fake `voice-dictation` helper (same CLI contract as
// app/native/VoiceDictation.swift) proves everything up to Apple's speech assets; on macOS CI the REAL helper
// (VIDEOCLAW_TEST_VOICE_HELPER) runs through the same path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { VoiceDictation, voiceErrors } from "../src/main/attachments/voice-note.generated";
import { VOICE_ERRORS, voiceDictationStatus } from "../src/main/platform/voice";
import { configureVoiceTools, voiceTools } from "../src/main/attachments/voice-tools";
import { AgentHost } from "../src/main/agent/agent-host";
import { attachmentIntakeHandlers } from "../src/main/attachments/attachment-ipc";
import { createLogger, setLoggerForTests } from "../src/main/llm/logger";

const which = (n: string) => (process.env.PATH ?? "").split(delimiter).map((d) => join(d, n)).find((p) => existsSync(p));
const FFMPEG = which("ffmpeg");
const skipFake = process.platform === "win32" ? "fake helper is a node shebang script" : !FFMPEG ? "no ffmpeg on PATH" : false;
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 15000) { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await tick(); } }

function webm(dir: string, seconds = 1): Uint8Array {
  const out = join(dir, "rec.webm");
  execFileSync(FFMPEG!, ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "libopus", "-f", "webm", out]);
  return new Uint8Array(readFileSync(out));
}
/** Same CLI contract as VoiceDictation.swift: `--check` → {available}|{error}; `<wav>` → {text}|{error}. Records what it got. */
function fakeHelper(dir: string, reply: string): string {
  const p = join(dir, "voice-dictation");
  writeFileSync(p, `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (a[0] === "--check") { process.stdout.write(JSON.stringify({ available: true })); process.exit(0); }
const h = fs.readFileSync(a[0]);
fs.writeFileSync(${JSON.stringify(join(dir, "helper-saw.json"))}, JSON.stringify({ riff: h.toString("ascii", 0, 4), wave: h.toString("ascii", 8, 12), channels: h.readUInt16LE(22), rate: h.readUInt32LE(24), bits: h.readUInt16LE(34) }));
process.stdout.write(${JSON.stringify(reply)});
`);
  chmodSync(p, 0o755);
  return p;
}

test("VOICE_ERRORS (platform/voice.ts) == the original errors table (L10452) — key unsupported_os, not os_version", () => {
  assert.deepEqual(VOICE_ERRORS, voiceErrors);
});

test("VoiceDictation.execute (verbatim): ffmpeg webm → 16 kHz mono s16 wav → helper <wav> → complete / error copy / failure / cancel", { skip: skipFake }, async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-vd-"));
  const audio = webm(d);
  const helper = fakeHelper(d, JSON.stringify({ text: "  make a vertical cut  " }));
  const op: any = new VoiceDictation(randomUUID(), { helper, ffmpeg: FFMPEG! });
  const p = op.run(audio);
  assert.equal(op.isRunning(), true);
  assert.deepEqual(await p, { status: "complete", text: "make a vertical cut" });
  assert.equal(op.isRunning(), false);
  assert.deepEqual(JSON.parse(readFileSync(join(d, "helper-saw.json"), "utf8")), { riff: "RIFF", wave: "WAVE", channels: 1, rate: 16000, bits: 16 });
  assert.deepEqual(await op.run(audio), { status: "complete", text: "make a vertical cut" }, "completed result is memoised");
  for (const [err, msg] of [["no_speech", voiceErrors.no_speech], ["model_download", voiceErrors.model_download], ["transcription_failed", "Transcription did not finish. Your note is kept; try again or discard it."]]) {
    fakeHelper(d, JSON.stringify({ error: err }));
    assert.deepEqual(await new (VoiceDictation as any)(randomUUID(), { helper, ffmpeg: FFMPEG! }).run(audio), { status: "failed", message: msg }, err);
  }
  assert.deepEqual(await new (VoiceDictation as any)(randomUUID(), { helper, ffmpeg: FFMPEG! }).run(new Uint8Array([1, 2, 3, 4])), { status: "failed", message: voiceErrors.invalid_audio });
  assert.deepEqual(await new (VoiceDictation as any)(randomUUID(), { helper: "", ffmpeg: FFMPEG! }).run(audio), { status: "failed", message: "Voice notes are unavailable in this build." });
  const c: any = new VoiceDictation(randomUUID(), { helper, ffmpeg: FFMPEG! }); const cp = c.run(audio); c.cancel();
  assert.deepEqual(await cp, { status: "cancelled", message: "Recording discarded." });
});

test("AgentHost: media:transcribeVoice → VoiceDictation; hasActiveVoiceTranscription; discardVoice; stageVoiceNote background transcript (L44767)", { skip: skipFake }, async () => {
  setLoggerForTests(createLogger({ level: "silent" }));
  const root = mkdtempSync(join(tmpdir(), "vc-vdh-"));
  const ws = join(root, "Videoclaw"); mkdirSync(join(ws, "jobs"), { recursive: true });
  const ud = join(root, "userData"); mkdirSync(ud, { recursive: true });
  const tools = join(root, "bootstrap"); mkdirSync(tools);
  fakeHelper(tools, JSON.stringify({ text: "three clips and a song" }));
  symlinkSync(FFMPEG!, join(tools, "ffmpeg"));
  configureVoiceTools(() => [tools]); // resolveBootstrapToolRoots() → <root>/voice-dictation, <root>/ffmpeg (L10465)
  const host: any = new AgentHost({
    emit: { sessionEvent: () => {}, sessionsChanged: () => {} } as any,
    service: { newSessionLlmRoute: () => "minimax", llmRouteReadiness: async () => ({ ready: true }) } as any,
    loadSdk: async () => { throw new Error("no"); }, sessionsRoot: join(root, "agent-sessions"), persist: () => {}, stateDir: ud,
    engine: { workspaceRoot: () => ws, currentEngine: () => ({ path: join(root, "engine"), version: "0.1.57-test" }), engineSessionEnv: () => ({}), assertProductionContract: () => {}, isPackaged: false, projectBrief: () => "" } as any,
  });
  try {
    const { sessionId } = host.createSession({});
    const audio = webm(root);
    const rid = randomUUID();
    const p = host.transcribeVoice(sessionId, rid, audio, voiceTools());
    assert.equal(host.hasActiveVoiceTranscription(), true);
    assert.deepEqual(await p, { status: "complete", text: "three clips and a song" });
    assert.equal(host.hasActiveVoiceTranscription(), false);
    const rid2 = randomUUID(); const p2 = host.transcribeVoice(sessionId, rid2, audio, voiceTools()); host.discardVoice(sessionId, rid2);
    assert.deepEqual(await p2, { status: "cancelled", message: "Recording discarded." });
    // voice note: attachment:voiceNote (L62262) → voiceNoteIntakeFile (48 kHz wav chip) → stageVoiceNote → --check → run → transcript
    const a = attachmentIntakeHandlers({ host, intakeDir: join(ud, "composer-voice"), media: {}, image: (() => ({})) as any, onChanged: () => {} } as any);
    const staged: any = await a.voiceNote(sessionId, randomUUID(), audio);
    assert.equal(staged.length, 1); assert.match(staged[0].name, /^Voice note \d+:\d\d\.wav$/);
    await until(() => !!host.attachmentStore.records.get(staged[0].id)?.voiceNote?.transcript);
    assert.equal(host.attachmentStore.records.get(staged[0].id).voiceNote.transcript, "three clips and a song");
  } finally { configureVoiceTools(() => []); await host.dispose(); }
});

const REAL = process.env.VIDEOCLAW_TEST_VOICE_HELPER;
test("macOS: the REAL voice-dictation helper (built from app/native/VoiceDictation.swift) through VoiceDictation.execute", { skip: !(process.platform === "darwin" && REAL && FFMPEG) && "set VIDEOCLAW_TEST_VOICE_HELPER on macOS" }, async () => {
  const d = mkdtempSync(join(tmpdir(), "vc-vdr-"));
  const audio = process.env.VIDEOCLAW_TEST_VOICE_WEBM ? new Uint8Array(readFileSync(process.env.VIDEOCLAW_TEST_VOICE_WEBM)) : webm(d, 2);
  const status = await voiceDictationStatus({ helper: REAL!, ffmpeg: FFMPEG! });
  const r: any = await new (VoiceDictation as any)(randomUUID(), { helper: REAL, ffmpeg: FFMPEG }).run(audio);
  console.log("# real helper status:", JSON.stringify(status), "transcribe:", JSON.stringify(r));
  assert.equal(status.attach, true);
  if (r.status === "complete") assert.ok(r.text.length > 0);
  else { assert.equal(r.status, "failed"); assert.ok(Object.values(voiceErrors).includes(r.message) || /Transcription did not finish/.test(r.message), r.message); }
  if (!status.available) assert.equal(r.status, "failed", "helper says unavailable → transcription cannot complete");
});
