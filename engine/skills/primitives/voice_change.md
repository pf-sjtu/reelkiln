# voice_change — speech-to-speech recast (a `synth_voice` mode)

Transform a **real recorded VO** into **any target voice** while keeping the
original **delivery, emotion, and — critically — timing**. Backend: ElevenLabs
speech-to-speech (`eleven_multilingual_sts_v2`), hidden behind
`synth_voice --mode voice_change`.

> **Why it's load-bearing:** timing is preserved (output duration ≈ input to
> within ~0.03s in practice), so **a finished video's captions, focus_track, and
> cuts stay in sync**. You swap only the timbre — no re-edit. That unlocks range:

- **N variants of one locked edit** — spokesperson A/B, gender swap, an
  authority/older read, a warmer read — from a single render. (Proven: DocuAsk
  shipped v1 real / v2 female / v3 authoritative off one edit, `versions/`.)
- **Localization / dubbing** — record once, recast into other voices/languages.
- **Character recast (audio half)** — pair with a video face/character swap
  (`mint_video --mode genjutsu` / `lipsync_footage`) to change *who* is on screen
  AND how they sound. (The full recast is a future workflow; this is its voice leg.)
- **Rescue a great take in a wrong voice** — keep the performance, change the voice.

## Commands
```bash
# browse the voice library (needs the voices_read key scope)
uv run python tools/synth_voice.py --mode list_voices --job <id> [--query "female|british|authority|..."]

# recast a real VO into a target voice (preserves timing)
uv run python tools/synth_voice.py --mode voice_change --job <id> \
    --audio <source.mp3> --voice <voice_id|preset> --output <out.mp3> [--remove-noise]
```
Presets: `rachel adam domi antoni bella josh arnold` (or any raw `voice_id` from
`list_voices`). Long VOs take ~1–2 min; run it as one foreground call.

## Make video variants without re-editing
Because timing holds, reuse the SAME transcript.json + style_directives + overlays:
```bash
# swap the audio of the assembled base, re-render to a version file
ffmpeg -y -i final_raw_real.mp4 -i vo_<voice>.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest final_raw.mp4
uv run python tools/compose_render.py --mode render --job <id> --skip-preflight
cp <job>/final.mp4 <job>/versions/<voice>.mp4
# ...then restore final_raw to the canonical voice.
```

## QA gate (do this — you can't hear it, so verify)
Voice-change can occasionally add artifacts / robotic tells / identity drift.
Before changing a real person's voice, require their explicit authorization for the
transformation; cloning or impersonating an unconsenting third party is never an
autonomous creative choice.
**Sample → verify before batching** (mirrors the sample→batch cost law):
1. Recast a **short slice first** (`ffmpeg -t 5`), not the whole VO.
2. **Check the sample** with `verify_output --mode audio` for mechanical problems and
   provide playable audio for listening. Do not use video-only `review_output` or create a fake video for it. Check
   clarity, artifacts, and that the identity matches the intent (gender/tone).
   Gemini is EARS, not taste — it only surfaces observations. Once consent exists,
   select the strongest intent-matched, mechanically passing variant by default;
   surface options when the user explicitly requested casting or useful optional feedback.
3. Only then recast the full VO and build the variant.

## Key scope / gotchas
- The ElevenLabs **API key must have `speech_to_speech` + `voices_read`** scopes,
  or both modes 401 with a clear `missing_permissions` error.
- Feed a **clean** source (`clean_audio --mode denoise`, timing-preserving) — STS
  faithfully carries source noise/clicks through, or pass `--remove-noise`.
- **Honor a tenant's explicit no-cloning/no-regeneration preference.** Use only
  permitted source audio and target voices; do not infer permission from a library file.
