// Voice dictation. Original (main/index.js L10452-10500): Swift helper
// `<bootstrap>/voice-dictation` (`--check` → JSON {available, error}; `<wav>` → {text}),
// macOS 26 SpeechAnalyzer. No Windows binary exists. The port reuses the ORIGINAL
// status logic verbatim, so with no helper present it reports exactly what the original
// reports on a Mac lacking the helper: {available:false, attach:true, message: errors.unavailable}.
// TODO(win): Windows helper with the same CLI contract (e.g. Windows.Media.SpeechRecognition
// or a whisper.cpp build) shipped as `voice-dictation.exe`.
import { execFile } from "node:child_process";

/** Verbatim error table (const errors, L10452-10464). */
export const VOICE_ERRORS: Record<string, string> = {
  os_version:
    "Transcription needs macOS 26 or later. You can still use your Mac’s Dictation shortcut in the message box.",
  unsupported_language:
    "Your Mac’s current language is not supported for transcription. You can still type your message.",
  unavailable: "On-device transcription is unavailable on this Mac. You can still type your message.",
  model_download:
    "The speech model could not be prepared. Connect to the internet for first use, then try again.",
  invalid_audio: "This recording could not be read. Record a new short note.",
  no_speech: "No speech was found. Record again or discard this note.",
};

export interface VoiceStatus { available: boolean; attach: boolean; message: string }

export async function voiceDictationStatus(tools: { helper: string; ffmpeg: string }): Promise<VoiceStatus> {
  if (!tools.ffmpeg) return { available: false, attach: false, message: "Voice notes are unavailable in this build." };
  if (!tools.helper) return { available: false, attach: true, message: VOICE_ERRORS.unavailable };
  return new Promise((resolve) => {
    execFile(tools.helper, ["--check"], { timeout: 15e3, killSignal: "SIGKILL", maxBuffer: 65536 }, (error, stdout) => {
      try {
        const reply = JSON.parse(String(stdout));
        if (!error && reply.available === true) return resolve({ available: true, attach: true, message: "" });
        resolve({ available: false, attach: true, message: VOICE_ERRORS[reply.error] ?? VOICE_ERRORS.unavailable });
      } catch {
        resolve({ available: false, attach: true, message: VOICE_ERRORS.unavailable });
      }
    });
  });
}
