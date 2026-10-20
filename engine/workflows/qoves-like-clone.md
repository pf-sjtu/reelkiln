# Workflow — QOVES-like Clone (dense motion-graphics over a minted portrait base)

Reproduce a reference short in the **QOVES-Studio format family** — a clinical/explainer look
([@qovesstudio](https://www.tiktok.com/@qovesstudio) and everything cut like it) — as a
**pixel-faithful duplicate in the tenant's own identity**. The family's craft lives in **two
stacked layers**:
1. a **dense, detailed motion-graphics layer** — counters, bars, callouts, magnifier swatches,
   converging arrows, split-screens, citation cards, animated labels, typewriter CTAs; over
2. a **generated bust/portrait `mint_video` base** — a head-and-shoulders subject that is
   animated / morphed / compared / abstracted.

**Use this recipe when BOTH are true: a heavy motion-graphics layer AND a minted bust/portrait
base.** It owns the base **plate** build, the conditional subject **registration**, the
**graphics-element rebuild**, and the mechanism that makes it land:

> **The load-bearing mechanism — the reference comparison: full-coverage REF-over-OURS
> stacked cards via `render_timeline_strip --stack --wallclock` (method:
> [`skills/video_qa.md`](../skills/video_qa.md) Stage 2.5). While you build each stage, it
> compares OURS against the REFERENCE frames directly and tells you the next fix. On the
> finished render, fix what it shows once, then present the remaining differences.**

### The base layer is not always one centered bust
Decode which shape each beat is — the base varies across the family, and the graphics layer
absorbs the difference:
- **single continuous subject** — one bust held at a fixed size, morphing/aging/before-after (a
  "what X does to your face" read). *This* is the only shape that gets registered (Stage 3).
- **two-up comparison** — two subjects side by side, e.g. a generated bust next to a **real/pulled
  talking-head clip** with a name+credential label. Neither is centered; both are placed in the
  overlay layer.
- **abstract / graphics-only beat** — no bust at all (a stylized animated eye, a chart, a bare
  citation card + search bar over the flat bg). No subject to register.
- **CTA** — the subject clears; a search-bar / handle typewriter is the sole element.
A single video usually mixes these; a two-up / abstract / graphics-only beat simply has no single
registered subject.

### The QOVES house look (pixel-match per your reference, but expect this family)
- **Background:** sample the reference's exact flat, muted blue-grey; no texture — the channel
  signature. Do not hard-code one source video's palette into another tenant's render.
- **VO subtitle:** italic serif (EB Garamond-ish), warm off-white, ONE phrase at a time, bottom.
- **Data labels / counters / HUD:** thin grotesque sans (Inter 300–400), cool near-white,
  letter-spaced.
- **Mono chips / labels** (names, credentials, `SKIN HEALTH BAR`, `SOBER`): JetBrains-Mono-ish,
  UPPERCASE, tracked.
- **Citation card:** translucent grey rounded box, top, small paragraph + a tiny source glyph.
- **Search-bar CTA:** rounded pill + magnifier icon ("Find related content" / a typed `@handle`).

This is a **standalone** recipe — it inherits from no other workflow. Route away up front if the
shape is different:
- **real-footage tenant reel that borrows a reference's structure** → [`reference-remix`](reference-remix.md).
- **cut-based montage / talking-head trend with an audio drop, no minted portrait + heavy HUD** →
  [`trend-duplication`](trend-duplication.md).
- Full three-way routing: [`workflows/README.md`](README.md) disambiguator №1.

---

> ## ⚠️ PRINCIPLES (transferable) vs the QOVES-FAMILY EXEMPLARS (illustration)
> Everything tagged `[GENERIC]` is the method — carry it to any clone of this shape (a
> dermatology before/after, a "what X does to your Y" explainer, a stat-HUD teardown, a
> data-callout portrait read, a two-up expert comparison). Tagged `[EX]` lines are illustrative
> instances from the family (a skin-morph drinking-face read; a two-up "generated bust vs. Dr.
> Carruthers clip"; an abstract animated-eye beat) — **re-derive every specific (face %, zoom
> keyframes, beat windows, fonts, colors) from YOUR reference; never copy the illustration's
> numbers.**

---

## Inputs
- A **reference video** — URL or local file, in this family (bust/portrait subject(s) + a dense
  motion-graphics layer).
- The **tenant** (`[BRAND: <tenant>]`) — read `taste/packs/<tenant>/README.md` and honor its
  `## COMMITMENTS` first. For a portrait clone you also need the tenant's **face refs**
  (`real_face_{1,2,3}.png`), 2–3 clean front-on shots.

The three support tools this recipe drives — `tools/dense_sample.py`, `tools/reframe.py`,
`tools/assemble_plate.py` — are workflow helpers (they take `--job` like every tool; they are not
in the 31-canonical JTBD index). Reference comparison uses the stacked-card method in
[`skills/video_qa.md`](../skills/video_qa.md) Stage 2.5, not a bespoke tool.

---

## Stage 0 — Preflight `[GENERIC]`  (before any spend)
Environment stalls are setup failures, not creative work. Clear them first:
```bash
export JOB=<your-job-id>
command -v yt-dlp ffmpeg || echo "MISSING downloader/ffmpeg"
uv run python -c "import cv2, numpy, PIL, rembg, scipy" 2>&1 | grep -i error && echo "MISSING py dep"
```
Get the reference **with audio** (the decode and the fidelity QA both need REF word/beat timings):
```bash
yt-dlp -S "res,vcodec:h264" --merge-output-format mp4 -o "jobs/$JOB/reference/ref.mp4" <url>
ffprobe -show_streams jobs/$JOB/reference/ref.mp4 | grep -q 'codec_type=audio' || echo "NO AUDIO — refetch"
```
- **Instagram is video-only anon** — needs a real `cookies.txt`: `yt-dlp --cookies cookies.txt …`.
  Fallback: `pull_video --mode enumerate` for video + a logged-in browser export for audio (drop
  the mp4 in the repo-root `inbox/`).
- **Verify the ref URL matches the brief** before adopting the job (memory `verify-ref-url-before-adopting-job`).
- **Cap generated filenames** — never build an output name from a full prompt string.

## Stage 1 — Decode the reference, DENSELY (5fps) `[GENERIC]`  (load-bearing read)
A bust/abstract clone often has few/zero hard cuts, so a shot-cut detector sees "1 shot" and
misses how bars fill, counters tick, and callouts draw. **A shallow decode = correcting it across
10 build rounds.** **⛔ Do NOT run `breakdown_reference` anywhere in this workflow** — it is
useless on this cut-less family and is banned here (build AND QA). Decode the mechanical motion
layer with two tools — **detect, then read**:
```bash
uv run python tools/synth_voice.py --job $JOB --mode transcribe --audio reference/ref_audio.*
mv jobs/$JOB/transcript.json jobs/$JOB/reference/ref_transcript.json   # ⚠ transcribe ignores --output

# 1. DETECT — where graphics animate (the layer a shot-cut detector misses on a cut-less HUD
#    video). Motion only — no audio analysis. --emit writes animation_windows.json for the reader:
uv run python tools/dense_sample.py motion --job $JOB --video reference/ref.mp4 --emit

# 2. READ — the comprehension strips: 5fps filmstrip + waveform + word-chips + the detected
#    animation windows as beats, all on one axis (richer than a bare contact sheet):
uv run python tools/render_timeline_strip.py --job $JOB --video jobs/$JOB/reference/ref.mp4 \
  --transcript jobs/$JOB/reference/ref_transcript.json \
  --beats jobs/$JOB/dense/animation_windows.json
# for a tight easing read of one window (bar 0%→40%→80%→100%): add --start 6.4 --end 7.1 --fps 12
```
`dense_sample motion` is the DETECTOR (it finds the animation windows a cut-less video hides);
`render_timeline_strip` is the READER (the rich frame view — its waveform comes from the video's
own audio, so you still see the audio track without any onset analysis). **Read EVERY strip.** Per
beat, name: the base **shape** (single-subject / two-up / abstract / graphics-only), every
**graphics element** (type, position, font, per-word timing, easing, SFX), and the **subject-zoom
%** (or 0 if no single subject).

## Stage 2 — Write `beat_spec.json` FRESH `[GENERIC]`
The decoded **BUILD spec** drives the graphics rebuild (Stage 5) and the plate
(Stage 4). It is an agent-authored implementation artifact, not a human sign-off
or spending prerequisite. **It is NOT the comparison target** — Stage 7 compares OURS
against the REFERENCE directly, never against this file.
**Author it fresh** in `jobs/$JOB/beat_spec.json` from your decode. **Two tiers:** `sections`
(the coarse movements — rich context + notes) and `beats` (the fine timeline the build reads).

**⭐ ENFORCED — `beats` must tile the FULL duration continuously (no gaps, no overlaps), at
animation-window granularity:** every window in `dense/animation_windows.json` becomes its own
`role:"anim"` beat, and `role:"hold"` beats fill the static spans between them — so
`beats[i].t[1] == beats[i+1].t[0]`, the first starts at `0`, and the last ends at `duration`.
A coarse section like a 10s "checklist hold" is NOT one beat; it splits into hold → anim(tick) →
hold → anim(tick) → hold so the overlay timing lands on the actual animation events. Schema +
example:
```json
{
  "_doc": "Decoded BUILD spec — drives overlays (Stage 5) + plate (Stage 4) + format proposal. NOT a QA artifact. `beats` tile the duration continuously at animation-window granularity.",
  "duration": 46.2,
  "transitions": [[0.35, 0.6], [6.46, 7.05], [36.35, 37.05]],
  "sections": [
    { "name": "hook",   "t": [0.0, 6.4],  "note": "single subject held; top-right thumbnail cycles while the main subject holds" },
    { "name": "two_up", "t": [6.4, 14.9], "note": "real photo beside a generated wireframe head; both placed in the overlay layer" }
  ],
  "beats": [
    { "name": "hook__hold0",  "section": "hook", "t": [0.0, 1.8], "role": "hold",
      "graphics": ["card:citation", "subtitle:italic-serif"], "graphics_absent": ["swatch", "bar"] },
    { "name": "hook__anim00", "section": "hook", "t": [1.8, 2.2], "role": "anim", "window": "anim00",
      "graphics": ["card:citation", "subtitle:italic-serif", "counter:scramble->3000+"], "graphics_absent": ["swatch", "bar"] },
    { "name": "hook__hold1",  "section": "hook", "t": [2.2, 6.4], "role": "hold",
      "graphics": ["card:citation", "subtitle:italic-serif"], "graphics_absent": ["swatch", "bar"] }
  ]
}
```
- `sections` — the coarse decode, one row per movement of the reference (hook / two-up / callout
  / abstract / cta …), carrying the rich `note`. **Context only; the build reads `beats`.**
- `beats` — the continuous fine timeline (the ENFORCED rule above). Each beat: `section` (parent),
  `role` (`anim`|`hold`), `window` (the `animation_windows` id, on anim beats), `t`, `graphics`,
  `graphics_absent`.
- `graphics` — elements present this beat, tagged by type (`counter`, `bar`, `box`, `swatch`,
  `center_label`, `dots`, `arrows`, `divider`/`split`, `pills`, `card`, `label`, `subtitle`,
  `searchbar`, `graphic`, `wipe`, `typewriter`). **Holds** carry the persistent elements; **anim**
  beats add the one element that fires in that window.
- `graphics_absent` — elements that must **NOT** appear this beat. A build reminder; grow it as you
  discover per-beat vocabulary mistakes (e.g. a callout highlighting the whole eye, not the eye-bag).
- `transitions` — every window where the subject morphs or the frame hard-cuts.

Present the decoded spec when useful and incorporate any feedback without
stopping for ceremonial approval. An optional delivery promise may record the
intended targets:
```bash
cp taste/packs/$TENANT/promise.example.json jobs/$JOB/promise.json   # then edit
```
If the user asks what the portrait and motion work will cost, use the app's normal
pricing boundary. In-app agents never call `cost.py quote` or `cost.py estimate`;
the host/gateway prices and authorizes the intended operation. A quote alone grants
no spending authority.

---

## Reference fidelity after building

Use Stage 7's exact-frame comparison to explain reference differences after building.
Only a new user edit request starts another build/review turn; do not wrap stages 3–6
in an autonomous fidelity loop. Never claim a reference match without actual evidence.

## Stage 3 — Mint the subject asset(s), then register ONLY where it applies `[GENERIC]`
Generate the portrait state(s) / subject stills:
```bash
uv run python tools/mint_image.py --job $JOB --role portrait --aspect 9:16 \
  --name state_baseline --reference real_face_1.png --prompt "<clinical front-on bust, state clause>"
```
Bake the framing clause into the FIRST prompt (it's knowable from the decode): subject
dead-center, **headroom above for the graphics (~top 18% empty)**, shoulders **beyond the frame
edges**, one identical scale across states, sample-one-then-batch.

**Registration is CONDITIONAL — it applies ONLY to a continuous single subject** held at a fixed
size/position across a run of beats (a morph / before-after / talking bust). Register those so the
transition changes only the subject's condition, never its size or place:
```bash
uv run python tools/reframe.py --job $JOB --stills state_baseline.png state_heavy.png \
  --face-w 605 --face-cx 540 --face-cy 990 --bg 165,182,194 --canvas 1080x1920   # tune to YOUR ref
```
**Do NOT register** two-up beats, abstract/graphics-only beats, or any beat where the subject
moves, is off-center, appears at multiple sizes, or is absent. Those elements —
including a **real/pulled clip** in a two-up — are placed per-beat in the overlay/composite layer
(Stage 5), not force-fit to one canonical box.
> **[EX]** SCAR (single-subject): stills first came out too tight → re-minted with the
> headroom/wide-shoulders clause; even then the two states weren't the same size so the morph
> jumped. `reframe.py` (face ~56% width, ~38% headroom) is what fixed it — *for that shape*.

## Stage 4 — Animate the base to `mint_video` clip(s) + build the plate `[GENERIC]`
Turn the registered still(s) into the moving base. The move depends on the reference:
- **state morph / before-after** → `mint_video --mode keyframe` (first state → last state) with a
  **true motion-intent prompt** describing the transformation. Seedance may refuse a photoreal
  face; then animate the first state with Omni image-to-video (below) and let the plate's
  `reset` crossfade carry the change.
- **talking / idle bust** → Omni image-to-video from one still through the app's `search_models` +
  `call_model` (`google-gemini-omni-flash-image-to-video`, `image_url` = the still, 3–10 s, 9:16),
  near-still for later lipsync. `mint_video --mode multishot` is unavailable (videoclaw#317).
```bash
uv run python tools/mint_video.py --job $JOB --mode keyframe --name state_morph \
  --first-frame images/aligned/state_baseline.png --last-frame images/aligned/state_heavy.png \
  --prompt "<the subject's condition gradually changes from A to B; head fixed, no camera move>"
```
- **Mask** when compositing over the flat bg so there's no seam/color-burn: `sam3 segment
  --output-kind mask_only` (needs `rembg`+`scipy`). `reframe.py` also mattes on one uniform bg.
- Build the **single-subject plate** (chained clips/stills + a global zoom envelope for the
  callout push-ins) by authoring `jobs/$JOB/plate.json` (schema in the tool docstring) and running:
```bash
uv run python tools/assemble_plate.py --job $JOB     # → final_raw.mp4 + zoom_kf.json
```
`plate.json` (compact): `segments` played in order & crossfaded (`kind`: `still` | `reset`
from→to skin-crossfade | `clip`), plus `zoom_kf` `[t,zoom]` keyframes. It writes `zoom_kf.json`
so the overlay tracks on-subject graphics to the push-ins. **Two-up / abstract / graphics-only
beats are NOT built here** — the plate holds the single subject (or the flat bg); everything else
is composited in Stage 5.
> **[EX]** SCARS — morph clips once minted with a **stray boilerplate prompt** (worked only by
> luck of first/last-frame interp); a transition showed a blue color-burn seam → fixed by matting.

## Stage 5 — Build the motion-graphics layer `[GENERIC]`  (the bulk of the labor)
Rebuild every element from `beat_spec` in a Remotion overlay (`overlays.tsx`), word/beat-synced to
the VO, tracking `zoom_kf.json` for on-subject graphics. Overlays own ALL text (render
`--no-captions`). This layer also composites the **non-plate** base shapes:
- **two-up:** place the generated bust on one side and the **real/pulled clip on the other**, with
  the mono name+credential label — positioned per the decode, not registered.
- **abstract beat:** the animated graphic (eye/chart) over the flat bg + its citation card.
- Match the **QOVES house look** (bg, italic-serif subtitle, mono labels, translucent citation
  card, search-bar CTA) from the section above.
Craft laws:
- **Coupled elements move together** (a bar and the counter that drives it; a value and its color).
- **Callout swatches are REAL crops of the subject itself**, targeted to the EXACT region named
  (under-eye ≠ whole eye) — never generated stand-ins.
- **Legibility floor** on the hook and any small text: contrast against the baked bg, readable at
  scroll speed. The hook is the most important 3 seconds — not the least legible moment.
- Remotion `OffthreadVideo` clips need a `Sequence from={beatStart}` anchor or they run on the
  comp clock and freeze (memory `remotion-clips-need-sequence-anchor`).
```bash
uv run python tools/remotion_render.py --job "$JOB" --no-captions
```
> **[EX]** SCARS — callout boxes once showed **generated images of the wrong area** instead of a
> real crop; a split-screen **reset to one face at the very end** (a hold bug); per-beat graphic
> vocabulary was wrong. All three are exactly what the Stage 2.5 stacked cards catch when you read
> OURS against the REF, beat by beat.

## Stage 6 — Assemble + audio `[GENERIC]`
- The plate + graphics is the render above. If your reference is cut-based instead, use
  `tools/assemble.py --declare` (declare the timeline so planned cuts and holds are on record).
- **Audio — ripping the bed is allowed.** You MAY reuse the reference's music/hook bed. If the
  reference's own spoken VO must go but a music/hook bed stays, scrub the VO with the stem splitter
  (`tools/scrub_reference_vo.py` / `stem_split`) and keep it **one steady level well under** your
  new VO — about 15 dB under for a recreation, never ducked, cut or muted under a line; lower
  it further if the scrub's speech bleed is audible. Shipping
  silent and adding sound in the composer is equally fine — **state which on the job** so the
  silence is on record as intentional.

## Stage 7 — Reference comparison and finish

The rendered video is a complete draft ([Finishing a render](README.md#finishing-a-render)).
The comparison below explains how it differs from the requested reference; it is not
an approval step or automatic repair loop. Compare actual frames, not an invented score.

**This family is cut-less**, so follow video_qa.md Stage 2.5's **cut-less branch**: the
stacked-cards beats come from the animation windows you already detected in Stage 1
(`dense/animation_windows.json`), not from any shot-cut detector (`breakdown_reference` returns
"1 shot" here — never reach for it).

1. **Stage 2.5 stacked cards — WALL-CLOCK, full coverage.** Reuses the **same
   `render_timeline_strip` reader as Stage 1**, in `--stack --wallclock` mode: it segments the
   ref-vs-ours cards **IDENTICALLY to the Stage-1 ref strips** (one card per window — the WHOLE
   duration, holds AND animation windows, not just the windows), REF on top / OURS on bottom
   sampled at the **same timestamps**:
   ```bash
   uv run python tools/render_timeline_strip.py --job $JOB --stack --wallclock \
     --ref jobs/$JOB/reference/ref.mp4 --ours jobs/$JOB/final.mp4 \
     --ref-beats jobs/$JOB/dense/animation_windows.json \
     --ours-beats jobs/$JOB/dense/animation_windows.json \
     --ref-transcript jobs/$JOB/reference/ref_transcript.json --ours-transcript jobs/$JOB/transcript.json
   ```
   `--wallclock` (not the default beat-relative stack) because a faithful clone tracks the ref's
   timing; the card count then matches the ref strips 1:1. **Omit it and the stack only samples
   the animation windows — the holds go unchecked.**

   **⭐ ENFORCED — compare EVERY column, not the card as a whole.** Each card is N vertically
   aligned column-pairs at identical timestamps. Go **column by column** and check the REF frame
   (top) against the OURS frame (bottom) for equivalence on:
   - **layout / position** — every element in the same place (subject, cards, chips, labels,
     split halves, swatch, search-bar);
   - **inferred animation phase** — the element is at the SAME point in its motion (a bar at the
     same fill %, a counter on the same number, a checklist with the same rows ticked, a thumbnail
     on the same cycle photo, a wipe at the same coverage);
   - **color / grade**, **opacity**, **type** (font, size, italic-serif vs sans), and **presence**
     (nothing extra on OURS, nothing missing vs REF).
   Every column where top ≠ bottom is a disparity row — cite `card pNN`, the timestamp, and what
   differs. Reading a card "holistically" is NOT enough; the per-column pass is what catches a
   graphic that's present but a beat early/late, half-opacity, or the wrong cycle frame.
   - Record each discrepancy and any intended deviation for the user. If they request a
     revision, the row identifies the affected stage; preserve the other successful assets.
2. Hand the human a **clickable link** to `jobs/$JOB/final.mp4` and the grounded
   reference comparison. A new explicit edit request starts a new user turn.

---

## Durable laws (the rules that stop the grind repeating)
1. **Ground the ref-diff** — stacked cards explain real disparities and inform a
   user-requested next edit; they do not create another stopping hook or QA loop.
2. **Never certify blind** — no "matches the reference" without the stacked cards proving it.
3. **Decode before build** — dense 5fps decode → `beat_spec.json` (the build spec)
   → optional nonblocking format summary. (`breakdown_reference` is never used here.)
4. **Register only the single continuous subject** — one scale, one frame, headroom; two-up /
   abstract / graphics-only beats are placed in the overlay layer, never force-registered.
5. **Real crops only** — callout swatches are screenshots of the actual subject region.
6. **Preflight the machine** — deps, dirs, filename caps checked first.

## Support tools (this recipe drives these — all take `--job`)
| Tool | Does |
|---|---|
| `tools/dense_sample.py` | DETECTOR: 5fps motion-energy → animation-window detection (motion only, no audio); `--emit` feeds the windows to `render_timeline_strip` (the frame READER — not duplicated here) |
| `tools/reframe.py` | registers a single continuous subject's stills/clips to one canonical size+position+bg (geometry via args) |
| `tools/assemble_plate.py` | builds the single-subject base plate from `plate.json`: clips/stills + zoom envelope → `final_raw.mp4` + `zoom_kf.json` |

Reference comparison is not a tool here — it is the stacked-card method in
[`skills/video_qa.md`](../skills/video_qa.md) Stage 2.5, which
renders the full-coverage stacked cards with `tools/render_timeline_strip.py --stack --wallclock`
(5fps, one card per window — same segmentation as the ref strips), and you compare EVERY column
top-vs-bottom (layout / animation phase / color / opacity / presence), tabulating disparities
REF-vs-OURS off the cards directly (not against `beat_spec`).
**Do NOT run `breakdown_reference`** — feed the stack's beats from Stage 1's
`dense/animation_windows.json`.

## Known failure modes this workflow front-loads (from a shipped run in the family)
- **Self-check trust failure (the headline):** the ref-diff came late; self-checks certified
  divergent renders and the human diffed by hand. → the stacked cards in Stage 7 ground the
  differences for the user; they are not an automatic loop.
- **Framing re-mint** — portraits too tight; redone for headroom/shoulders (Stage 3).
- **Morph size mismatch + boilerplate motion prompt + blue seam** (Stages 3–4).
- **Fake callout crops, end-state reset bug, wrong per-beat vocabulary** (Stage 5).
- **Low-contrast hook + tiny citation** (Stage 5 legibility floor).
- **~14 environment stalls** (deps, dirs, filename-too-long) — all Stage-0 preflight.

## Output
`jobs/$JOB/final.mp4` — a pixel-faithful duplicate in the tenant's identity, verified
beat-by-beat against the reference and QA-passed.

## Taste-capture
If the reference reveals a graphics pattern / animation mechanism the tenant loves, capture it to
the pack's "Example sequences" ([`taste/HOW_TASTE_WORKS.md`](../taste/HOW_TASTE_WORKS.md)) so
the next clone in this family starts ahead. The compare-ref-first rule is a cross-job commitment
(memory `qoves-ref-comparison-qa`).
