# clean_audio — denoise recorded audio and remove false starts / dead air

Takes raw recorded audio (real performer or booth take) and returns a cleaned track: noise-reduced,
false-start-trimmed, and dead-air removed. Folds in `clean_audio.py` (53 calls, 2 sessions —
51 of those in `b186ab52` alone, making it the heaviest audio tool by call count) and
`verify_cleaned_audio.py` (14 calls, 1 session), whose QA logic now lives in
`verify_output --mode false-start`. This tool's job ends at a clean file; pacing / WPM
adjustment is `densify`; TTS generation is `synth_voice`.

```
clean_audio --job <job> --mode <mode> --input <raw_audio> \
            [--output <cleaned_audio>] [--sensitivity <low|medium|high>] [--force]
```

`--mode` is **required** and logged as `usage_role`.

---

## `denoise` — suppress background noise and room tone

- **purpose:** remove constant-noise profile (room hiss, AC hum, mic hiss) from a recorded take without touching speech.
- **use_when:** any recorded take. **Safe to run always: it measures the take first and passes already-clean audio through untouched** (skip-on-clean gate — inter-speech noise floor below −50 dBFS ⇒ no DSP, bit-exact pass-through; the decision + measured floor is logged to `run.log.jsonl` and stdout). You don't need to pre-judge whether the room was noisy.
- **do_not_use_when:** the problem is pacing, not noise (→ `densify`). (TTS output from `synth_voice` is fine to pass through it — the gate skips it — but it's a no-op, so don't bother.)
- **inputs:** `--input` raw audio file (wav/mp3/m4a); `--sensitivity` tunes the noise-reduction aggressiveness (default `medium`); `--force` runs the DSP even on a take that measures clean; `--clean-floor-db` retunes the gate threshold (default −50 dBFS).
- **outputs:** cleaned audio file at `--output` (defaults to `<job_dir>/03_clean_audio/<name>_clean.wav`).
- **fidelity contract:** output preserves the source sample rate and bit depth (48 kHz/24-bit in → 48 kHz/24-bit out — no silent downgrade to 44.1/s16), and on a clean take the 2–8 kHz presence/consonant band is untouched. Guarded by `tests/test_clean_audio_fidelity.py`.
- **success_check:** `verify_output --mode false-start` — checks noise floor, confirms no clipped speech. **A manual listen-back is REQUIRED** (see friction note below); `verify_output` is a mechanical pass-fail, not a false-start guarantee.
- **backend:** measure-first gate (ffmpeg silencedetect + astats) → ffmpeg noise-gate + spectral subtraction when the take is actually noisy (today `clean_audio.py`).
- **fallback:** raise `--sensitivity`; if still noisy, request a re-record rather than stacking filters.
- **evidence:** `b186ab52` — 51 clean_audio.py calls in a single session (the a-roll lipsync batch); `verify_cleaned_audio.py` 14 calls in the same project line. The gate exists because the always-on chain gutted the presence band of an already-clean studio take (`joseph-ai-taste-20260715`, "super muddy" VO).

## `trim` — remove false starts and dead air

- **purpose:** cut out false starts (aborted words, stumbles, restarts), long pauses, and pre/post dead air — without re-pacing the surviving speech.
- **use_when:** the raw take has flubbed openings, mid-sentence restarts, or multi-second silences that need to be excised before lipsync or densify.
- **do_not_use_when:** the goal is tightening the overall WPM (→ `densify`); the silence is intentional (scored pause). Do not use on TTS output — `synth_voice` does not produce false starts.
- **inputs:** `--input` raw audio; optionally a VTT/SRT transcript to guide cut-points.
- **outputs:** trimmed audio at `--output`; a diff log of cut regions (for review).
- **success_check:** `verify_output --mode false-start`. **A manual listen-back is REQUIRED** — false starts slip past the mechanical check every batch; PASS-2 (the mechanical check) mitigates but does not close this gap. This is a known, persistent friction.
- **backend:** ffmpeg silencedetect + manual cut-point list (today `clean_audio.py` trim path).
- **fallback:** if the auto-trim cuts real speech, fall back to a human-provided cut list (timestamps) passed via `--cuts <csv>`.
- **evidence:** `b186ab52` (51 calls); the retained post-stitch densify rule says
  densify runs **after** clean_audio, not instead of it.

---

## NOT this tool

- **`densify`** — pacing/WPM tightening (silence-clip + 1.22× stretch + PASS-2 re-transcribe). Runs after `clean_audio`, not in place of it. MEMORY rule: `densify.py` targets 170–200 WPM; `clean_audio` does not time-stretch.
- **`synth_voice`** — TTS generation from script text. TTS output is already clean; never run `clean_audio` on it.
- **`verify_output --mode false-start`** — the mechanical check that follows `clean_audio`. Not a generation tool; lives in the checking tier.
- **`score_bed`** — mixes music bed and SFX under VO. Requires a clean audio input that `clean_audio` produces; does not clean.
