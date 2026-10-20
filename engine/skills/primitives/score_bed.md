# score_bed — lay a background music bed and place approved SFX

One tool, two modes: `--mode bed` (default — user-supplied licensed music) and `--mode generate`
(opt-in, default OFF — Lyria via the gateway `music` tool since chunk 31; beds over one clip
length route to the full-song model automatically, and the raw-key fallback still speaks
ElevenLabs). Handles RMS windowing to pick the
best section of a long track, sets the bed level under the voice (by default one flat, quiet
level — see **Bed level** below), and muxes the result back onto the VO/avatar audio. SFX at named anchor times come
from user-licensed files or exact rights-cleared catalog IDs already cached in `<job_dir>/sfx/`.
The agent never auto-generates them. AI music generation is opt-in
default-off because the user distrusts it (gen_music.py: 3 calls, 1 session — e2c506f4; kept for
one-off operator use). Folds: `audio_bed.py` (7 calls, 2 sessions — ✅ in super_tools.md §4) and
`gen_music.py` (3 calls, 1 session — e2c506f4).

```
score_bed --job <job> --mode <bed|generate> \
          [--music <path-to-licensed-track>]          # required for --mode bed
          [--sfx-manifest <path-to-sfx-manifest.json>]  # optional; anchor times per file
          [--bed-under-voice-db <dB>] # default 12 (≈ -26 LUFS under a -14 LUFS voice)
          [--best-section-sec <n>]    # RMS window length to pick from long tracks (default 30)
          [--output <path>]           # default <job_dir>/audio/final_mix.wav
          # --mode generate / recover only:
          [--prompt "..."]            # music prompt if generate mode (instrumental enforced)
          [--duration-sec <n>]        # target generation length
          [--raw-only]                # standalone bed: no video input, no VO, no mux
          [--gateway-job-id <id>]     # recover: the already accepted music job
```

`--mode` is **required** and logged as `usage_role`.

### Bed level — one flat, quiet bed, never ducked

JC's rule (#276, #321): music sits as **one constant, quiet level under the voice** — no
ducking, no swells, no loudness normalisation of the bed (normalising the bed alone to
-14 LUFS is what made beds louder than the voice, #240). One constant gain puts the bed's
integrated loudness `--bed-under-voice-db` (12) below the narration's — about -26 LUFS
under a -14 LUFS voice, roughly 20% volume — for every voiced video, live on-camera speech
included. It is never cut or muted under a spoken line. **Skits and recreations**
(duplications, remixes, dialogue sketches) get the same one steady bed, a little softer:
`--bed-under-voice-db 15`. Use 15 too for a sung track or when the user wants quieter music.

Ducking is retired: `--mix duck`, `--mix loudnorm` and `--duck-db` are still accepted, so
old prompts and cards keep working, and are ignored with a one-line notice.

The narration is the input video's own audio; the bed is measured as the mux delivers it.
The flat gain never pushes a bed sample past -1 dBFS (`bed_level.peak_capped` says when that
held it lower). A source with **no narration** (no audio stream, or silence) has nothing to sit
under, so the bed is the programme: normalised to -14 LUFS (`mix_applied: programme`).
Under a voice the SFX are not normalised on their own: each plays at its manifest `gain_db`
beside the bed (the final master moves both together), so give a hot SFX a negative gain. A narration or bed that cannot be measured stops the mix with an error rather
than guessing. `bed_meta.json` records `mix`, `mix_applied` and `bed_level`
(`gain_db`, `narration_lufs`, `bed_lufs_delivered`, `bed_target_lufs`, `peak_capped`).

Every invocation also emits exactly one terminal run-log event after `start`:
`done` with its music source and output paths, or `error` with the exception
details. The terminal carries the exact start-event id so concurrent or later
`score_bed` runs cannot complete the wrong invocation. Downstream
audio QA treats a bed/generate `start` without either a terminal event or the
legacy `bed_built` success marker as an orphaned, failed mix.
Both events carry `raw_only`, so a standalone asset generation is never read as
a promise to mix that music into the job's video.

---

## `bed` — user-supplied music (the default, and the canonical path)

- **purpose:** layer a licensed or user-owned background music track under the VO + SFX at anchor times.
- **use_when:** the user has dropped a licensed track into `<job_dir>/sfx/` or delivered it explicitly; this covers 100% of shipped productions.
- **do_not_use_when:** the user has not supplied a track AND has not explicitly opted into AI generation (→ surface the named-SFX-list prompt instead, wait for delivery).
- **inputs:**
  - `--music <path>` — the licensed track; path relative to job dir or absolute.
  - `--sfx-manifest <json>` — optional; keys are user filenames or exact
    `catalog:<stable.id>@<version>` identities, with `{ "anchor_word": "...", "occurrence": N,
    "lead_in_sec": 0 }`. Catalog IDs must already be fetched and hash-attested in job provenance.
  - `final_raw.mp4` (or explicit `--input`) — the densified VO+avatar audio.
- **pipeline:** (1) RMS-window the music track to find the `--best-section-sec`-second window with highest RMS energy (avoids intros/outros). (2) Trim/loop to match video duration. (3) HP-filter at 60 Hz. (4) Set the bed's one constant level, 12 dB under the voice (never ducked). (5) Mix SFX files at resolved anchor timestamps. (6) No narration only: normalize the bed (the programme) to -14 LUFS. (7) Mux back onto the video; with a voice, the finished voice+bed mix is mastered to -14 LUFS, true peak ≤ -1 dBTP (measured first; the voice takes one gain + a peak limiter, the bed one linear gain that follows it, then a true-peak safety limiter; no dynamic loudnorm, so the gap holds and nothing pumps). `bed_meta.json` `final_mix` records the gains.
- **success_check:** `final_mix.wav` present; the bed sits about `--bed-under-voice-db` under the voice (`bed_meta.json` `bed_level`); with no narration, loudness within -13 to -15 LUFS; speech intelligibility preserved (speaker audible over bed); no clipping; SFX placed within ±0.1s of anchor. `bed_meta.json`'s `narration_bed_margin` (#237) additionally measures, when speech windows exist, the narration's loudness (LUFS, the measure the mix levels by, so a default mix reads about 12) against the DELIVERED bed's — read off the mix wav that step (7) sums with the VO, through step (7)'s own amix so the bed carries the channel fold the mux applies, not off the pre-mix bed, because step (4)'s gain is what sets the delivered bed level — over speech windows no SFX overlaps; `low: true` (margin under 8 dB) surfaces as an ADVISORY `NARRATION_BED_MARGIN` finding in QA — it never blocks delivery.
- **backend:** ffmpeg (volume automation + mux); librosa (RMS windowing); pyloudnorm (LUFS gate).
- **fallback:** if the track is shorter than the video, loop it seamlessly at the picked best-section boundary before applying automation.
- **evidence:** `audio_bed.py` invoked 7 times across 2 sessions (super_tools.md §4 ✅); design_brief.md SFX manifest pattern is the canonical handoff from the design_brief checkpoint (CLAUDE.md rule 20 #6); user-drop flow established in MEMORY rule "user owns SFX sourcing."

---

## `generate` — AI-generated music bed (opt-in, default OFF)

- **purpose:** generate an instrumental background track via the gateway's Lyria `music` route when no user-supplied track exists AND the user has explicitly opted in. A raw ElevenLabs key is the direct fallback.
- **use_when:** user has said "generate music" or equivalent — never inferred; always requires explicit operator decision. Document the choice in `adaptation_notes`.
- **do_not_use_when:** (a) user has not opted in — default is `--mode bed`; (b) there IS a user-supplied track (use `--mode bed`); (c) the user has expressed distrust of AI music for this job. AI music is opt-in default-off because quality variance is high and the user distrusts it for shipped content (gen_music.py: 3 calls, 1 session — e2c506f4; score.py de-prioritized in CLAUDE.md rule 24).
- **inputs:** `--prompt "..."` describing genre, tempo, instruments and mood without named music references (see `skills/score_prompt_guide.md`); `--duration-sec` matched to video duration (3–600s). `--input` (or the default `final_raw.mp4`) must carry a real video stream: an audio-only file is rejected before the paid generation call, not after it. Recognizable names and name-shaped imitation wording are refused before submission; format descriptions such as "TikTok-ready" are allowed.
- **`--raw-only`:** the music IS the deliverable — a standalone instrumental WAV + MP3 at `<job_dir>/audio/music.wav`. No video input, no transcript, no ducking, no SFX, no mux. Requires `--prompt` and a `--duration-sec` inside the supported 3–600s range (out of range is refused rather than silently clamped). Still a paid, explicitly opted-in generation.
- **recovering a standalone job:** `--mode recover --raw-only --gateway-job-id <id> --duration-sec <n>` retrieves an ALREADY ACCEPTED music job and runs the same exact-duration preparation over it. It submits nothing — use it instead of generating again when an accepted standalone job failed during polling or download. `--prompt` is refused there, because the prompt is already spent.
- **pipeline:** calls the gateway `music` tool (Lyria, with instrumental intent in the prompt) when `VIDEOCLAW_API_KEY` is set; otherwise calls ElevenLabs `/v1/music` (`model_id music_v2`, `force_instrumental=true`) with the raw key. The returned MP3 enters the same RMS-window → flat bed level → mux pipeline as `--mode bed`.
- **success_check:** no vocals detected (flag if `vocals_detected: true` in Gemini perceptual check); `closest_reference` is not "generic library music"; audible but clearly under the voice at the `flat` level.
- **backend:** Lyria through the metered gateway, or ElevenLabs Eleven Music through the direct raw-key fallback; ffmpeg for post-processing.
- **fallback:** both routes receive an instrumental-only instruction, and the direct ElevenLabs route also sets `force_instrumental=true`. If a candidate still has vocals, reword its musical attributes before another authorized generation; do not ship a vocals-flagged candidate without explicit user override.
- **evidence:** `gen_music.py` 3 calls, session e2c506f4 (super_tools.md §4 ✅); CLAUDE.md rule 24 explicitly de-prioritizes AI bed in the canonical pipeline.

---

## NOT this tool

- **SFX auto-generation** (`sfx.py`, `sfx_gen.py`) — retired. `score_bed` places only
  user-licensed files or exact catalog assets; it never generates them.
- **`audio_bed.py` (legacy diagnostic)** — extracts a bed from the reference outlier via MVSep stem separation. NOT licensed for shipping. Use for mood/BPM reference only; the production bed always comes from `score_bed --mode bed` (user-supplied) or `--mode generate` (opt-in). Folds into `score_bed` as a separate diagnostic invocation path, not a production mode.
- **`clean_audio`** — denoises recorded A-roll audio before any mix step. Runs earlier in the pipeline; its output is the VO input to `score_bed`, not a replacement.
- **`densify`** — pacing/stretch step that precedes `score_bed`; `score_bed` consumes the output of densify (`final_raw.mp4`), it does not replace it.
- **`compose_render`** — the Remotion compositor. It reads a **bed-only** artifact at
  `<job>/audio/bed.wav` and lays it UNDER the source audio at one constant level (matched
  12 dB under that audio, or the user's own `style_directives` `music.bed_under_voice_db`;
  a `duck_under_speech_db` left by an old replication brief is ignored); that is a
  different signal from `score_bed`'s output. `score_bed` writes a finished MASTER
  (`audio/final_mix.wav`, already levelled under the voice and SFX-mixed) plus the muxed
  `audio/final_mix.mp4`. Never point `audioBedPath` at the master — it would double the
  source audio. The two orders that work:
  1. **Score last (canonical).** `compose_render` renders the picture and captions →
     `score_bed --input final.mp4` → `audio/final_mix.mp4` is the deliverable.
  2. **Carry the mix forward.** `compose_render --mode retrofit --source_video audio/final_mix.mp4`.

  A `compose_render` that would write a `final.mp4` unable to contain an existing completed
  mix now **fails closed** and names both options. That exact silent overwrite shipped an
  audio-less candidate in Flight run `flight_workflow-script-to-film_1788465024875`.
