# densify — tighten pacing via silence-clipping, time-stretch, and PASS 2 re-transcribe

One tool, `--mode {normal|aroll|smart|transcribe}`. Clips silences from stitched audio/video,
time-stretches at ~1.22× (MEMORY: replaces the old 1.10× math-rescale), re-transcribes the
result as PASS 2 to produce a word-timed transcript, targeting 170–200 WPM. Folds in:
`densify.py` (60 calls, 14 sessions — the core post-stitch path), `densify_aroll.py` (15 calls,
2 sessions — a-roll window variant, `agent/josephchin/tools/`), and `smart_densify.py` (15 calls,
2 sessions — silence-clip + stretch + re-transcribe on `04_final`, `agent/josephchin/tools/`).
The `transcribe` mode is a standalone word-timed transcription of any mp4/mp3 (no stretch, no
silence-clip — just PASS 2 on the file as-is). Clip-surgery sub-ops (`clip-extract`,
`speed-ramp`, `surgical-cut`, `transcript-token-patch`) are also homed here: they operate on
densified or pre-densified media with word-timed precision. Evidence: densify.py verdict ✅,
`super_tools.md` §1 + §3; consolidation verdict from §3 TOP-PRIORITY item 4.

```
densify --job <job> --mode <mode> --input <audio_or_video> \
        [--transcript <word_timed_json>] [--target-wpm 185] [--stretch 1.22] \
        [--sub-op {clip-extract|speed-ramp|surgical-cut|transcript-token-patch} \
           --in <t> --out <t> --patch-token <word>]
```

`--mode` is **required** and logged as `usage_role`. `--job` is always required (MEMORY:
concurrent jobs clobber `.current_job`; every tool must carry `--job` explicitly).

**The vo-densify move (formerly a molecule — it lives here now, it's ONE tool):** any
⟨VO: real recording | tts | voice_change⟩ → `densify --mode normal` → the PASS-2
re-transcribe happens inside the tool, so the output is punchy-paced VO + a drift-free
word-timed transcript (170–200 WPM). Proven 60+ runs; an editorial-channel rebuild hit
212 WPM; a-roll reels densify the tenant's REAL voice memos. Gotcha: the 1.22× default
over-runs intimate registers — warm-confiding passes `--speed 1.10`.

---

## `normal` — 60 core runs (dominant mode)

- **purpose:** post-stitch pacing tightener for the VO+avatar pipeline — silence-clip the
  stitched audio, stretch at ~1.22×, re-transcribe as PASS 2.
- **use_when:** immediately after `synth_voice` stitches the full VO (post-ElevenLabs, pre-seedance
  or pre-compose). Targets 170–200 WPM. MEMORY: this step is mandatory — it replaced the old
  1.10× math-rescale in the post-stitch densify pipeline.
- **do_not_use_when:** input is a-roll footage with a real speaker (→ `aroll`); the media is
  already densified and you only need a fresh transcript (→ `transcribe`).
- **inputs:** stitched VO audio or video + optional existing transcript JSON.
- **outputs:** densified audio/video + new word-timed PASS 2 transcript JSON.
- **success_check:** WPM lands 170–200 on re-transcribe; no audible splice artifacts; PASS 2
  transcript word-count matches densified clip length.
- **backend:** ffmpeg silence-detect + atempo filter (1.22×) + ElevenLabs Scribe re-transcribe.
- **fallback:** if WPM overshoots (>200), reduce stretch toward 1.15×; if undershoots, re-run
  silence-clip with tighter floor.
- **evidence:** `densify.py` 60 calls / 14 sessions; `super_tools.md` §1 verdict ✅; MEMORY rule
  `feedback_densify_pipeline.md` ("1.22× replaces 1.10×; targets 170–200 WPM").

---

## `aroll` — 15 runs (a-roll window variant)

- **purpose:** densify real-footage a-roll windows — same silence-clip + stretch logic but applied
  to a lipsync-ready a-roll segment, preserving the face/motion envelope for downstream sync.
- **use_when:** working on the real-footage performer path (`lipsync_footage`) and the raw a-roll
  clip is too slow or padded with dead air before lipsync.
- **do_not_use_when:** input is synthetic VO (→ `normal`); you're densifying the final composite
  after lipsync (too late — lipsync is already baked).
- **inputs:** a-roll video clip (mp4) + optional beats JSON; does NOT require a pre-existing transcript. Audio-only input, including an MP3 with cover art, is rejected before transcription or output creation. Use `--mode transcribe` if only a transcript is needed.
- **outputs:** densified a-roll mp4 + updated beats JSON.
- **success_check:** face tracks remain clean after stretch; no jitter artifact on cut points;
  downstream `lipsync_footage` can ingest without re-alignment.
- **backend:** ffmpeg silence-detect + atempo; no re-transcribe pass (face timing is ground truth).
- **fallback:** if motion tears at splice points, widen silence floor before cut.
- **evidence:** `densify_aroll.py` 15 calls / 2 sessions; `super_tools.md` §3 verdict ✅(merge);
  consolidation verdict TOP-PRIORITY §4.

---

## `smart` — 15 runs (final-file variant)

- **purpose:** densify the assembled `04_final` output — silence-clip + stretch + PASS 2
  re-transcribe on the finished composite, not the raw VO.
- **use_when:** the composed video is slightly underweight on WPM after `compose_render` (e.g.
  a cut was too loose); you want to tighten the whole file without re-rendering from scratch.
- **do_not_use_when:** there are upstream script or audio issues (fix them at source — stretching
  a broken file compounds the problem); input is raw VO pre-compose (→ `normal`).
- **inputs:** `04_final.mp4` or equivalent composed output.
- **outputs:** densified final mp4 + PASS 2 transcript.
- **success_check:** WPM 170–200; caption sync still holds (verify with `check_layout` post-run
  if captions are baked); no black-frame or audio-drop artifacts.
- **backend:** ffmpeg atempo + ElevenLabs Scribe PASS 2.
- **fallback:** if captions drift after stretch, re-run `compose_render` with the densified audio
  as source rather than stretching the composite.
- **evidence:** `smart_densify.py` 15 calls / 2 sessions; `super_tools.md` §3 verdict ✅(merge);
  consolidation verdict TOP-PRIORITY §4.

---

## `transcribe` — standalone PASS 2

- **purpose:** word-timed transcript of any mp4 or mp3 — no silence-clip, no stretch. Pure
  re-transcription pass.
- **use_when:** you have a finished or pre-densified file and need a fresh word-timed JSON (e.g.
  to update caption anchors, to feed `check_layout`, or after a manual audio edit).
- **do_not_use_when:** the file needs pacing work (→ `normal` / `smart`); you need a script-level
  transcript before audio exists (→ `check_script`).
- **inputs:** any mp4 or mp3.
- **outputs:** word-timed transcript JSON (PASS 2 format).
- **success_check:** every spoken word appears with a start/end timestamp; total word count matches
  expected script word budget ±5%.
- **backend:** ElevenLabs Scribe.
- **fallback:** if Scribe misses words, re-run with a higher prompt-bias or trim silent head/tail
  first.
- **evidence:** `transcribe_p2.py` / `transcribe_p3.py` (2 calls each, b186ab52 — ad-hoc PASS 2
  scripts folded into this mode per `super_tools.md` §4 verdict ❌ fold).

---

## Clip-surgery sub-ops

Invoked by adding `--sub-op <op>` to any `densify --job` call. All ops work on word-timed
precision from the PASS 2 transcript.

| sub-op | what it does |
|---|---|
| `clip-extract` | extract a sub-clip by word-aligned in/out times |
| `speed-ramp` | apply a localized atempo ramp to a word-range (not the whole file) |
| `surgical-cut` | remove a word-range from the timeline and close the gap |
| `transcript-token-patch` | rewrite a token in the word-timed JSON without re-transcribing |

These do not need a separate `--mode` flag — they compose with whichever mode produced the
transcript they operate on.

---

## NOT this tool

- `synth_voice` — TTS generation (ElevenLabs). Densify runs **after** synth_voice; it does not
  produce speech, it tightens existing audio.
- `lipsync_footage` — the real-footage lipsync + grade pipeline. `densify --mode aroll` prepares
  the a-roll clip as an input, but lipsync itself is a separate tool.
- `compose_render` — the Remotion compositor. Densify outputs feed into compose_render; they are
  not the same step.
- `clean_audio` — denoises / removes false starts from raw recorded audio. Densify assumes
  already-clean audio; it tightens pacing, not signal quality.
