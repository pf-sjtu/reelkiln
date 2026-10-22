// docs/38 M21: the ORIGINAL on-device dictation helper (app/native/VoiceDictation.swift, built with swiftc on the
// macOS runner) through the port's verbatim voiceDictationStatus(). Runs only when CI hands over a built helper
// (VIDEOCLAW_TEST_VOICE_HELPER) on darwin; the port itself does not build or ship the helper (docs/38 §3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceDictationStatus, VOICE_ERRORS } from "../src/main/platform/voice";

const HELPER = process.env.VIDEOCLAW_TEST_VOICE_HELPER;
test("mac voice helper: --check through voiceDictationStatus → available, or one of the original's error messages", { skip: (process.platform !== "darwin" || !HELPER) && "needs darwin + VIDEOCLAW_TEST_VOICE_HELPER" }, async () => {
  const s = await voiceDictationStatus({ helper: HELPER!, ffmpeg: "/usr/bin/true" });
  console.log(`# voice helper status: ${JSON.stringify(s)}`);
  assert.equal(s.attach, true);
  if (!s.available) assert.ok(Object.values(VOICE_ERRORS).includes(s.message), s.message);
});
