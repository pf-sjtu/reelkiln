# verify_output — post-render mechanical integrity check

Extracts frames from a rendered file and answers one question: **is it broken?** Checks that
captions and overlays actually composited (not just authored), that no frames are black or
corrupted, and that audio is present and clean. This is the most reliable checking tool in
the fleet — `verify_render.py` ran 78 times across 11 sessions with zero complaints, making it
the ground-truth visual layer for every overlay pass. Folds in: `verify_render.py` (frame-extract
+ visual check, 78 calls / 11 sessions), `verify_cleaned_audio.py` (audio integrity check,
14 calls / 1 session), `frame_sample.py` (beat-strip sampler, 1 call / 1 session). Distinct
from `review_output`, which judges editorial quality; `verify_output` is purely MECHANICAL.
On intermediate assets (audio, clips, first frames) a failure means fix the asset before
spending more on it. On a finished render it is an optional diagnostic: a finished render
is a complete draft (CLAUDE.md, "Finishing a render").

```
verify_output --job <job> --mode <mode> --input <mp4|wav> \
              [--beats <beats.json>] [--transcript <transcript.json>] \
              [--sample-count <n>] [--pre-gen]
```

`--mode` is **required** and logged as `usage_role`.

---

## `render` — 78 runs (the dominant mode)
- **purpose:** extract a frame sample from the rendered mp4, read each frame, and confirm overlays/captions composited correctly — no black frames, no missing layers, no layout regressions.
- **use_when:** you suspect a composite problem (a missing layer, a black frame, a caption or overlay placement bug) and want to see the frames — JSX overlays are invisible to `check_layout`, so this is the quickest way to look at them. Optional on a finished render.
- **do_not_use_when:** audio-only checks (→ `audio`); first-frame check before gen (→ `pre-gen`).
- **inputs:** `--input <final.mp4>`; `--sample-count` (default 8–12 frames, spread across the timeline); optionally `--beats beats.json` to pin samples at beat boundaries.
- **success_check:** every sampled frame is non-black; captions render at the expected position; overlay layers (cards, icons, hijack text) are visible and not clipped; no frame shows the raw TSX fallback or a white/blank compositor state.
- **backend:** ffmpeg frame-extract → Read (inline render in chat). MEMORY: `verify_render.py` gives the agent real visual ground-truth for overlay placement; surface frames for optional user feedback when useful, but do not create a confirmation gate.
- **fallback:** if a frame is black/broken, fix the TSX and render again once, per CLAUDE.md "Finishing a render".
- **evidence:** `verify_render.py` 78 calls / 11 sessions — zero complaints across the entire fleet. Sessions: `b186ab52` (frame-by-frame overlay QA), `3dc570c9` (`--pre-gen` first-frame gate), `91e277d3` (B-roll overlay pass).

---

## `audio` — 14 runs
- **purpose:** confirm cleaned or mixed audio is free of clipping, silence drop-outs, or denoise artifacts before it enters seedance or compose_render.
- **use_when:** after `clean_audio` returns; after `densify` (post-stretch pass); before `perform_avatar` if audio quality is in doubt.
- **do_not_use_when:** the file is a video render (→ `render`); the audio hasn't been through `clean_audio` yet (nothing to verify).
- **inputs:** `--input <cleaned.wav|densified.wav>`; optional `--transcript transcript.json` to spot-check word-timings.
- **success_check:** no clipping peaks; silence regions are intentional (between sentences, not inside words); WPM in the densified file is within the 170–200 target range (MEMORY: densify pipeline targets 170–200 WPM, PASS 2 re-transcribe).
- **backend:** ffprobe + ffmpeg loudness/waveform pass; optional ElevenLabs re-transcribe (PASS 2) for timing confirmation.
- **fallback:** on clipping, re-run `clean_audio` with adjusted denoising; on out-of-range WPM, re-run `densify` with tuned stretch factor.
- **evidence:** `verify_cleaned_audio.py` 14 calls / 1 session (`b186ab52` a-roll audio pipeline).

---

## `pre-gen` — gate mode (session `3dc570c9`)
- **purpose:** extract and inspect only the **first frame** of a seedance chunk before committing to a full generation run. Catches wrong avatar, wrong staging, wrong background early — before burning Seedance credits.
- **use_when:** before any `perform_avatar` batch run when the reference frame or prompt has changed; any time the avatar reference PNG was regenerated (`cast_avatar`).
- **do_not_use_when:** the chunk has already been generated (inspect with `render` mode instead); first-frame quality is not in doubt.
- **inputs:** `--input <first_frame.png|chunk_0.mp4>` + `--pre-gen` flag (or `--mode pre-gen`); `--transcript` optional for caption timing check.
- **success_check:** avatar face matches the locked character sheet; background is correct; no AI-tell anatomy; framing is as specified in the chunk prompt.
- **backend:** single-frame Read (same ffmpeg extract, count=1).
- **fallback:** if face/background wrong, regenerate the reference frame via `cast_avatar` before proceeding with `perform_avatar`.
- **evidence:** `3dc570c9` — `--pre-gen` first-frame gate before Seedance batch; cited in brief as commit `3dc570c9`.

---

## `false-start` — transcript-diff mode (session `b186ab52`)
- **purpose:** diff the post-densify transcript against the script to detect false starts, repeated phrases, or dropped lines that densify's silence-clip introduced — catches corrupted audio before it becomes locked VO.
- **use_when:** after `densify` completes; before `perform_avatar` or `compose_render` receives the densified audio.
- **do_not_use_when:** the audio hasn't been densified (no diff to run); the transcript is already confirmed.
- **inputs:** `--input <densified.wav>` + `--transcript <post-densify-transcript.json>` + `--mode false-start`.
- **success_check:** transcript word sequence matches the script with no repeated n-grams and no dropped lines beyond expected edit cuts.
- **backend:** ElevenLabs PASS 2 re-transcribe (already in the densify pipeline) → diff against script.json.
- **fallback:** on a detected false start, re-run `densify` with adjusted silence threshold or patch the specific segment manually.
- **evidence:** `b186ab52` — transcript-diff to catch false starts; cited in brief as commit `b186ab52`.

---

## NOT this tool

- **`review_output`** — editorial judgment ("is it good?", are the B-roll roles fulfilled, AI-tells, slop). `verify_output` is purely mechanical ("is it broken?"). These are different questions.
- **`check_layout`** — the *pre-render* check (face/caption collision, anchor validity, caption-safe luminance). `verify_output` reads the actual mp4 *post-render*.
- **`check_script`** — pre-generation WPM / pacing gate. No video file involved.
- **`gemini_video.py`** — Gemini returns mechanical observations only; its quality scores are unreliable and must never become taste or ship authority (MEMORY: Gemini is eyes, not taste). The calling agent maps observations to stated intent; the human retains final ship/no-ship authority. `verify_output --mode render` uses ffmpeg frame-extract + Read, not Gemini, for integrity checks.
