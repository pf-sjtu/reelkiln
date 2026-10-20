# voice.md — Cast, lock, synthesize, and check a voice

Use `synth_voice` for every voice operation. Normal narration uses Gemini 3.1 Flash TTS.
ElevenLabs remains only for designed/custom voices, speech-to-speech `voice_change`, voice-library
search, and Scribe transcription. `reference_tts` is a separate consent-gated Seed Audio path.

This is the VO-only path. Seedance avatar video normally generates its own synchronized speech.
The signed-in app uses the metered gateway. Direct engine runs need `FAL_KEY` for Gemini; retained
ElevenLabs modes need `ELEVENLABS_API_KEY` with the matching voice/design/transcription scopes.

## Approved reference voice

For new words in a real person's voice, use `reference_tts` only for the user or a
person they are explicitly authorized to represent. Preserve usable original speech.
A tenant's explicit no-cloning preference wins; a library file is not permission.
Use the app's real rights interaction for the named person and use. When the app
provides approved saved Characters references, retrieve them through its host surface:
reuse unchanged approved sources without repeated consent, and do not use pending,
changed or deleted references. Do not manufacture a rights token or hand-edit approval
metadata. Standalone voice accepts audio-only; suggest a talking-video/lipsync route
only when it helps. Saving includes a short generated sample and user listening/approval
before setting the project default. Saved copies survive original video deletion until
separately removed. Saved voice retrieval depends on app #631; if unavailable, use the current
rights interaction for this job and do not claim the voice was saved for future use.

See [the primitive](primitives/synth_voice.md#reference_tts) for actual arguments and
reference limits. Audio-only work returns the speech file, exact-script check and
listening findings. Video work can hand off to [aroll-reel](../workflows/aroll-reel.md)
for real-footage lipsync; it does not require casting a synthetic avatar.

## 1. Cast once, then remember it

For a new project, audition a short line that contains the script's real register, names, and
punctuation. Pick one voice and keep it for every later job in that project or series.

Write the lock into the project's scoped Taste `COMMITMENTS`:

```text
- Narrator: Gemini 3.1 Flash TTS / Charon / English (US)
- Delivery: warm, grounded, quietly confident; conversational, never announcer-like
- Pace: natural generation pace; no post-stretch unless a measured edit requires it
```

For a one-off video, the job's `tts/*.json` provenance is enough. Promote the choice to tenant
Taste only when the user explicitly wants the same voice everywhere. Do not create another voice
registry: Taste plus the existing job metadata already provide memory.

The published Gemini voices accepted by the tool are:

```text
Achernar Achird Algenib Algieba Alnilam Aoede Autonoe Callirrhoe Charon Despina
Enceladus Erinome Fenrir Gacrux Iapetus Kore Laomedeia Leda Orus Pulcherrima Puck
Rasalgethi Sadachbia Sadaltager Schedar Sulafat Umbriel Vindemiatrix Zephyr Zubenelgenubi
```

Five useful casting anchors from the launch audition:

| Voice | Start here for |
|---|---|
| `Charon` | grounded documentary or product narration |
| `Kore` | clear, composed authority |
| `Aoede` | warm, elegant storytelling |
| `Puck` | playful, energetic explainers |
| `Zephyr` | bright, modern short-form delivery |

These are starting points, not global defaults. The script and delivery direction matter as much
as the voice name, so audition in context and lock the result.

## 2. Generate normal narration

```bash
uv run python tools/synth_voice.py --mode tts --job <id> \
  --beat-id narration --voice Charon \
  --delivery "Warm, grounded, quietly confident. Conversational, never announcer-like." \
  --text "The actual line to speak."
```

`--voice` is required. A published Gemini name selects Gemini. A legacy preset (`rachel`, `adam`,
`domi`, `antoni`, `bella`, `josh`, `arnold`) or any raw voice id selects the retained ElevenLabs
custom-voice path. Copy custom ids from `voice.json`; a typo is rejected by the provider.

Gemini generates at natural pace by default. `--wpm N` is a delivery instruction, not a forced
time stretch. Use `--stretch --wpm N` only when the edit has a measured duration requirement;
post-stretch is a rescue because it can reduce naturalness. `--temperature` accepts 0–2 and
defaults to 1. `--language-code` defaults to `English (US)`.

Outputs under `<job>/tts/` include natural audio, optional stretched audio, and JSON provenance
with voice, model, delivery, language, temperature, durations, WPM, and cost.

Use contractions in spoken copy. TTS reads expanded forms literally and they often sound stiff.

## 3. Designed voices and voice change

Use `--mode design` only when the project needs a durable character voice that Gemini's published
cast cannot supply. It creates ElevenLabs previews from a text casting brief; listen, select one,
then save it. Descriptions must be 20–1,000 characters and preview text 100–1,000 characters;
`--guidance` and `--loudness` are optional. `previews.json` contains temporary
`generated_voice_id` values; saving the chosen preview creates the durable `voice_id` used by
normal `--mode tts`.

Use `--mode voice_change` when a performance already has the right timing and emotion but needs a
different target identity. It is ElevenLabs speech-to-speech, preserves delivery and timing, and
therefore can recast a locked edit without rebuilding captions or cuts. It is never invoked
automatically. Only use audio the user owns or has permission to transform; impersonating a real
person requires explicit consent.

Gemini TTS is not speech-to-speech. A powerful optional chain is:

```text
script → Gemini performance → voice_change into a designed voice → existing timed edit
```

Keep the Gemini take when it is already the right voice. Add `voice_change` only when custom
identity has real project value.

## 4. Verify before assembly

1. Run `synth_voice --mode transcribe --audio <generated-audio>` and compare it with the script.
   Wrong words or names are actionable; rewrite pronunciation and regenerate that chunk.
2. Check duration, dead air, dropouts, clipping, clicks, truncated words, and gross pace mismatch.
3. Listen against the casting brief. Automated review may locate mechanical defects, but it does
   not decide whether a voice feels authentic or belongs to the brand.
4. Lock the selected voice and delivery in scoped Taste before rendering a promise-bearing final.

For avatar-native speech, judge the voice in the video with `chunk_review`; use external TTS plus
`lipsync_footage` only when the workflow deliberately needs a separately controlled voice.
