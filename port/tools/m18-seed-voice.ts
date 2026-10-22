// docs/35 M18 HARNESS (app down): prepare one saved-voice record through the VERBATIM CharacterVoiceStore exactly as the
// not-ported `character_voice` studio tool would after its rights interaction (prepare → attachSample), so the
// original renderer's "Saved voices" section has something to approve/remove. Not app code; never ships.
//   node m18-seed-voice.cjs <userDataDir> <cwd> <clientId> <gatewayUrl> <canonicalKeyId> <ref.wav> <sample.wav>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CharacterStore } from "../src/main/characters/character-store.generated";
import { CharacterVoiceStore } from "../src/main/characters/character-voice-store.generated";

const [userDataDir, cwd, clientId, gatewayUrl, canonicalKeyId, ref, sample] = process.argv.slice(2);
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const binding = { gatewayUrl, canonicalKeyId, clientId, userDataDir }; // = ProjectMemoryHost.memoryBinding (L36456)
const store: any = new (CharacterVoiceStore as any)(new (CharacterStore as any)());
const ok = () => {};
(async () => {
  const id = await store.prepare(binding, cwd, "Ada (M18 harness)", "Narration for this project only", [{ filePath: ref, sha256: sha(ref) }], undefined, [], false, ok);
  await store.attachSample(binding, id, { filePath: sample, sha256: sha(sample) }, ok);
  const snap = await store.list(binding, ok);
  console.log(JSON.stringify({ ok: true, id, file: store.file(binding), voices: snap.voices.map((v: any) => ({ id: v.id, state: v.state, name: v.name, characterSlug: v.characterSlug, isDefault: v.isDefault, sampleSha256: v.sampleSha256 })) }));
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e) })); process.exit(1); });
