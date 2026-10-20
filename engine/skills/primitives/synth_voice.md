# synth_voice — generate, design, transform and transcribe speech

`--job` and `--mode` are required. The current modes are `tts`, `reference_tts`,
`design`, `transcribe`, `list_voices` and `voice_change`. The app uses its metered
gateway, which authorizes each paid operation. See [voice guidance](../voice.md) for selecting a
voice and [the talking-head route](../../workflows/README.md#talking-head-default)
for video; this tool itself produces audio/transcripts, not a talking-head video.

## tts

Generate new narration using a published Gemini voice name or a retained ElevenLabs
preset/custom voice id. `--voice` is required; use `--text` for one beat, or the
job's `script.json` (`chunks`/`script`, text/dialogue and chunk_id/id) for many.
`--chunk N` selects one script chunk by index rather than rerunning the whole script.

```bash
uv run python tools/synth_voice.py --job <id> --mode tts \
  --voice Charon --beat-id narration --text "The exact line to speak."
```

Outputs are `<job>/tts/<beat-id>.mp3` and matching `.json` provenance. Gemini uses
natural pace by default; `--wpm` guides delivery, and `--stretch` explicitly requests
post-stretch. Legacy ElevenLabs TTS retains its WPM stretch unless `--no-stretch` is
set. A stretched take adds `<beat-id>.stretched.mp3`. Do not combine `--stretch` and
`--no-stretch`. `--delivery`, `--language-code` and `--temperature` (0–2) apply to the
Gemini path. Preserve a good take rather than regenerating it for a metadata change.

The JSON's `timing_kind: utterance_envelope` is **not word alignment**: every word
covers the utterance. For speech captions or exact-script checking, transcribe the
actual audio. TTS does not stitch chunks or create a word-timed transcript by itself.
Use contractions when appropriate for the user's spoken style; do not alter exact
requested wording silently.

## reference_tts

Generate new words conditioned on 1–3 clean clips from the **same approved person**.
The [host permission boundary](../voice.md#approved-reference-voice) supports the
user and explicitly authorized people; a filename or model-written receipt does
not prove approval. Use the returned real host receipt with the selected references.

```bash
uv run python tools/synth_voice.py --job <id> --mode reference_tts \
  --reference-audio voice/reference.wav --rights-confirmation <host-receipt> \
  --text "The exact new line to speak." --output voice/narration.mp3
```

This mode requires the gateway and uses Seed Audio reference conditioning. It asks
for exactly the text, one speaker and no music/ambience/extra words. The complete
prompt, including its instructions, must fit 2,048 characters. Use the provider's
0.5–2 range for `--speed` (the CLI does not validate the range); `--multilingual`
opts into multilingual generation. Repeat `--reference-audio` for multiple clips.
Use the actual app-returned rights receipt unchanged; a model-invented token proves
no approval even if it matches the tool's `rights_[A-Za-z0-9_-]{8,128}` shape.
Relative output stays under the job; each run defaults to a fresh
`voice/reference_tts-<random hex>.mp3` at 48 kHz, so a new take never lands on an
earlier one. An occupied output path, default or explicit, exits before the paid
generation: pass a new `--output` for another take, and recover an already
accepted operation rather than generating it again.

The [current provider input schema](https://fal.ai/models/bytedance/seed-audio-1.0/api)
allows at most three references, each at most 30 seconds/10 MB, in wav/mp3/pcm/ogg_opus.
Prepare clean excerpts from a longer talking recording; do not send the whole video
as an audio reference. Avoid overlapping speakers, music, clipping and heavy reverb.
Source quality helps conditioning but does not guarantee identity or naturalness.
Check exact words and listen before using the speech in a video. For audio-only
requests, return the playable speech and findings; no fake `final.mp4` or video receipt.

## design

Create an original designed voice from a text description, not from sample audio.
`--name` is required. Preview creation uses `--description` (20–1,000 characters)
and `--text` (100–1,000 characters), with optional `--guidance`/`--loudness`.
It writes `<job>/voice/<name>_preview_N.mp3` and `previews.json` (or `--out-dir`).
Listen and choose a preview before saving it with `--save-preview <generated_voice_id>`
and optional `--voice-name`. Saving writes `voice.json` and the existing job-level
`voice_registry.json`; its durable `voice_id` is usable as `tts --voice <id>`.
This is the retained ElevenLabs design path; it is not reference-voice cloning.

## transcribe

```bash
uv run python tools/synth_voice.py --job <id> --mode transcribe \
  --audio voice/narration.mp3
```

An explicit `--audio` transcribes an existing audio file, or extracts audio from a
supported video, into `<job>/transcript.json` through Scribe. Use `--diarize` for
speaker labels. Without `--audio`, this mode instead stitches `chunks/chunk_*.mp4`
into `final_raw.mp4` first (including trailing-silence trimming). `--skip-stitch`
reuses an existing `final_raw.mp4`; `--no-trim-silence` disables that trim.
Use the explicit audio path when only a transcript is wanted: do not accidentally
rebuild a video. Re-transcribe when an edit changes spoken timing.

`--output <file.json>` writes the transcript somewhere else inside the job instead of
`<job>/transcript.json` (relative paths resolve under the job; a path outside the job or
not ending in `.json` is refused before any paid call). Give every file its own output
when transcribing several in parallel (two cameras, several takes), or they overwrite
each other's `transcript.json` — e.g. `--audio cam_a.mp4 --output transcripts/cam_a.json`
and `--audio cam_b.mp4 --output transcripts/cam_b.json`.
Tools that read the job transcript (densify, score_bed, captions) still read
`<job>/transcript.json`; copy the one you choose there when it should drive them.

Without transcription credentials, the tool's development fallback may write a
`PLACEHOLDER` transcript. That is not evidence of spoken words: report unavailable
transcription rather than using it for captions, QA intent or word-fidelity claims.

## list_voices and voice_change

`--mode list_voices [--query <text>]` searches the account's ElevenLabs voice library
and writes `<job>/voices.json`. It does not list the separate Gemini voice cast.

`--mode voice_change --audio <recording> --voice <id-or-preset> --output <path>`
recasts an existing performance into a target voice via ElevenLabs speech-to-speech;
`--remove-noise` requests background removal. It aims to preserve delivery/timing,
but check actual output sync before reusing caption timings. It does not generate
new script wording or create a reusable clone. See [voice_change](voice_change.md).

## Adjacent steps

Use `densify` for a measured pacing edit, `lipsync_footage` for an approved voice on
real footage, and `score_bed` for a cleared music bed. `perform_avatar` is the separate
explicit synthetic-video route; it does not automatically consume this tool's VO.
