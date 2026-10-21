// PORT-NEW glue (docs/26): voiceTools() (original L10465-10471) — the bundled `voice-dictation` helper and
// ffmpeg found under resolveBootstrapToolRoots(). The tool roots are bound by real-backend.ts.
import { existsSync } from "node:fs";
import { join } from "node:path";
let roots: () => string[] = () => [];
export function configureVoiceTools(r: () => string[]): void { roots = r; }
export function voiceTools(): { helper: string; ffmpeg: string } {
  const rs = roots();
  return {
    helper: rs.map((root) => join(root, "voice-dictation")).find(existsSync) ?? "",
    ffmpeg: rs.map((root) => join(root, "ffmpeg")).find(existsSync) ?? "",
  };
}
