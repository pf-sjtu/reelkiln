# Workflow — Trend Duplication ("steal like an artist")

Reproduce a viral format in the tenant's own identity. Proven end-to-end on a
**viral reference format** → the tenant's remix
(`$VIDEOCLAW_JOBS_DIR/<trend-dup-example>/`, 2026-07-09):
fully-generated, zero filming.

> The north star is [[perceived-effort-north-star]] + [[reference-remix]] as a CORE
> capability. Understand HOW the reference achieves its feel, then re-skin it.

## Bespoke shipped instances → [`duplication/`](duplication/README.md)
This file is the GENERIC method. Once a specific reference has been duplicated end-to-end,
its exact recipe (that reference, that performer, the working prompts and windows) is
captured as a bespoke instance under [`duplication/`](duplication/README.md) — the
provenance rule. Those instances also carry the **character-swap family** variant: instead
of regenerating identity assets from stills, swap the performer INTO the original footage
with one `mint_video --mode genjutsu` run (a seed frame + the performer's references),
keeping the original soundtrack. If your request is "duplicate THIS
reference as this performer," read the matching `duplication/<slug>.md` first, then this
file for the decode front. See [`duplication/README.md`](duplication/README.md) for the
shared swap-family method and the index.

## 0. Pick the trend, get the real video — WITH AUDIO
- **Download into the job with the canonical puller (includes audio).**
  ```bash
  : "${VIDEOCLAW_JOBS_DIR:?set by the Videoclaw app}"
  mkdir -p "$VIDEOCLAW_JOBS_DIR/<id>/reference"
  uv run python tools/pull_video.py --job <id> --mode pull --url "<url>" \
    --output "$VIDEOCLAW_JOBS_DIR/<id>/reference/ref.mp4"
  ```
  For a local reference, replace `--url` with `--file "<local.mp4>"`.
- **Instagram is the exception** — anon yt-dlp AND Apify both give VIDEO-ONLY (Apify's
  `videoUrl` is a video-only DASH rep; browser-cookie auto-extract is unreliable on
  macOS Chrome). IG WITH audio needs a real `cookies.txt`: `yt-dlp --cookies cookies.txt`.
  Fallback: `pull_video --mode enumerate` (Apify) for the video + a logged-in
  browser export for the audio (drop the mp4 in the repo-root inbox).
- Verify you actually have audio: `ffprobe -show_streams` must list an `audio` stream.
- Do not launch a separate transcript or generic vision pass here. The canonical breakdown
  in Step 1 owns cuts, word timings, 5fps evidence, and the one aggregate interpretation.
- Sandcastles `analyze_video` = fast structural read only; not a substitute for the breakdown.

## 1. Breakdown — SECTION-FIRST, motion- and audio-aware (the load-bearing step)
The decode is where taste gets spent; a shallow breakdown = correcting it across 10 build
rounds. Produce a COMPLETE spec (visual + caption-animation + audio choreography) and
emit one nonblocking format proposal before generating. Use the canonical command exactly
once:

Run one `breakdown_reference` timeline pass. If the user asks what it will cost,
use a side-effect-free gateway quote for this exact operation; quoting neither
sets a budget nor authorizes execution:
```bash
uv run python tools/breakdown_reference.py --job <id> \
  --video reference/ref.mp4 \
  --transcribe --transition-frames \
  --vision-mode timeline
```

It owns the entire reference decode: frame-accurate cuts, Scribe word timings, one card per
~2s at 5fps with filmstrip + waveform + word chips + cut markers + globally normalized RMS
and onset novelty, explicit transition montages, and then **one** aggregate Gemini
interpretation over bounded evidence pages representing every chronological card. An atomic
claim prevents duplicate paid launches and exact completed reruns reuse the prior receipt.
Wait for the printed `breakdown/<stem>/breakdown.json` path; do not invent another waiter.

1. **Read every `breakdown/<stem>/timeline/*.png` card.** 5fps reveals caption animation
   (`WORD-A → WORD-B → WORD-C`), persistent elements, motion changes, and each overlay's
   offset from the spoken word.
2. **Read `timeline_analysis.json` and `transcript.json`.** Use the mechanical section,
   caption, and RMS/onset/word/cut choreography as evidence; do not ask Gemini to re-read
   the video. Listen before naming music, drops, impacts, or semantic sound events.
3. **Express the reference as a MOLECULE SEQUENCE** (see `skills/molecules.md`) + flag new
   molecules you'll need. Duplication then = composition, not invention.

## 2. Format-lock + EDL
Present the full decoded spec to the human, correct in ONE pass. Then write an **EDL**
(`edl.json`) locking every shot → clip + text (with animation type) + VO on the cut map.

## 3. Generate identity assets (fully-generated variant)
- Stills: `mint_image --role portrait --aspect 9:16` (native vertical — the 9:16 gap is
  CLOSED, see [[capability-backlog-seeds]]) + the tenant's face refs (`real_face_{1,2,3}.png`).
  **Bake a proportion clause** ("head ~1/7 of height, do NOT enlarge") — ref-gen inflates heads.
- Motion: Omni image-to-video through the app's `call_model` (`google-gemini-omni-flash-image-to-video`, one still, 3–10 s).
  **NOT keyframe** — Seedance E005-rejects
  photoreal faces ([[seedance-flags-human-refs]]). Keep desk/talking beats near-still for lipsync.
- **Restyle a shot you already have (chunk 31):** when the reference's look differs from your
  footage only in STYLE or set dressing (animation ↔ real, palette, environment, props), reach
  for `mint_video --mode edit --video <clip> --prompt "<one change>"` instead of regenerating
  the shot from stills — it preserves the motion/timing you already validated. Identity swaps
  from a reference image go to `--mode genjutsu` (every person swap; recipe in mint_video.md).
- Lipsync: `lipsync_footage long --video --audio --output` (fal sync-3). Base must be ≥ VO
  length ([[lipsync-doubled-base-long-vo]]) — regen a longer base if VO overruns.
- Real VO only, never cloned. STS a friend voice: `synth_voice --mode voice_change
  --voice <preset>`, then ffmpeg pitch-shift (`asetrate/atempo`) for a distinct guy.

## 4. Text-behind-subject 
- `sam3 segment --output-kind mask_only` on each behind-head clip → person matte.
- Composite (ffmpeg): `split` base → draw word(s) → `alphamerge` person over the mask →
  `overlay` → word passes BEHIND the head. Render the timed word as a live
  Remotion/SVG layer and place it below the person matte; do not create a PNG per
  word or expose typography intermediates as still assets.
- **Kinetic captions ≠ one static word.** Power-words flash ONE WORD AT A TIME behind the
  head, synced to VO word timings, each **fit to ~92% screen width** + letter-spacing.
  Intro/friend captions ACCUMULATE word-by-word, sans, in front. (Two different systems —
  verify against the reference frames, both were wrong on first pass.)
- Font: pixel-match from the reference frames. The reference's display face = **Playfair Display Black**
  (`#ff0000` — that reference's value; pixel-match YOUR reference); load the <!-- lint-ok: example -->
  wght=900 instance before measuring/rendering the live Remotion/SVG/ASS layer.
  Get VO word timings from Scribe for sync.

## 5. Assemble → music → finish
- Assemble on the reference cut map — `tools/assemble.py` covers the common case (one
  beat per cut, `keep_audio` on talking beats / silence elsewhere, `--check` first); a
  bespoke script is fine when the cut demands it ([`skills/assembly_craft.md`](../skills/assembly_craft.md)).
  **Either way declare the timeline** (`--declare`) so the planned beats are on record
  ([`skills/primitives/assemble.md`](../skills/primitives/assemble.md)). Talking beats run longer than the ref
  (more words) → the total stretches; that's fine.
- **Music — separate with the REAL stem splitter, do NOT center-cancel or pip-install
  demucs** ([[stem-split-wired]]). `tools/scrub_reference_vo.py --audio <ref> --keep-singing
  <ranges>` runs MVSEP via the gateway `stem_split` endpoint: instrumental (bass+drums+other)
  everywhere + the `vocals` stem added back only in the singing sections (from step-1
  sections), so the reference speaker's VO is removed but a sung hook survives. Caveat: MDX23
  bleeds faint garbled speech into the instrumental — keep the bed one steady level well
  under the new VO to hide it (no ducking; lower it further if the bleed is still audible).
- **Reapply section-aligned, not 1:1.** The remix's beats run longer than the reference, so
  map the reference's audio SECTIONS onto the remix's equivalent sections (drop → the remix's
  montage start, hits → the remix's cutaways). Build the bed with impacts stabbed on the
  cutaways (escalating) + the drop pinned to the payoff line — the music's own events, not a
  level change around the speech.
- **Keep the bed one steady level well under the VO** — a recreation gets about 15 dB under
  (`score_bed --bed-under-voice-db 15`, `assemble` `"under_voice_db": 15`); never ducked,
  cut or muted under a line — the #1 mix bug was the bed burying the VO.
- **Finish** — the rendered video is a complete draft; return it to the user
  ([Finishing a render](README.md#finishing-a-render)). The historical run's dialogue
  dropout was real (buried VO), while its face morphing/text collision were accepted
  stylistic effects.
- **Compare fidelity with the reference** (method: `video_qa.md` §Stage 2.5): render
  the beat-aligned stacked cards, REF over OURS, with one call
  (`look_at_video --job <id> reference/ref.mp4 final.mp4`, which reuses the breakdown's
  transcript; `render_timeline_strip --stack` only with your own beat files), read every
  card, tabulate the
  disparity table for the user. A user-requested edit can address a row or record an
  accepted named deviation. The open-critic does not catch a missing signature graphic, a
  counter that doesn't count, or a 9s hold against a 2s cut rhythm — the stacked cards do
  (all three shipped in this workflow's own worked example before this stage existed).

## Gotchas log
- Apify IG = video-only (no audio). 9:16 native works (no gateway redeploy).
- `mint_image` output paths resolve UNDER the job dir (pass job-relative `--output`).
- Scribe word times drift from the audio — slice VO on **silencedetect** boundaries + buffer.
- Verify the mix by TRANSCRIBING it — a buried VO reads as "[outro jingle]".
