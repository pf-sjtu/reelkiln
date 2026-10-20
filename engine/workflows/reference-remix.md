# Reference remix — "start from a video you love, make it YOURS"

Start from an inspo video (YouTube / Short / Reel / TikTok / local clip) and turn it
into **your own take**: keep what makes it work (hook mechanism, pacing, beat structure,
tone), swap in **your topic, your performer, your spin on the script**. This is the
reference-driven entry point — grounded in a real reference instead of a blank prompt.

**Clone the STRUCTURE, rebuild the VISUALS.** We keep the reusable, format-level stuff
(what any creator may learn from a reference) and re-shoot/re-generate the actual footage
as the tenant — real-footage-first, on-brand, and clean of anyone else's clips. Literally
reusing the reference's footage is a **flagged fair-use-only** sub-path (Step 5b), never
the default.

**Best for:** "here's a Short I love, make me something like it but about X, with me
presenting." Composes existing tools + the [`aroll-reel`](aroll-reel.md) spine — **no new
tools.** For a talking-head remix, the performer path IS aroll-reel; this workflow is the
front-end that grounds it in a reference and puts concept and sample checks first.

> **STATUS (2026-07-04):** exercised live by two runs, neither end-to-end clean.
> **`$VIDEOCLAW_JOBS_DIR/<ref-dup-example>`** (2026-06-27: IG reel → full rebuild, new gen presenter)
> shipped a `final.mp4` through an analyze → rebuild → review loop (the earlier process);
> **`$VIDEOCLAW_JOBS_DIR/<style-remix-example>`**
> (2026-07-01: a listicle reference reel, the tenant's real-voice path) proved the promise/sample
> front-end but is **paused at Step 5a** — no usable talking-head base in the library.
> Ledger below. Still unexercised: the Step-1 structured format-summary path and the
> Step-2 differentiated-concepts table (both runs were single-concept).

---

## Inputs
- A **reference video** — URL or local file.
- The **new topic / angle** (what it's about now).
- The **tenant** (`[BRAND: <tenant>]`) — read
  `$VIDEOCLAW_WORKSPACE/taste/packs/<tenant>/README.md` +
  honor its `## COMMITMENTS` first. A tenant's commitments look like: real footage primary,
  their real voice (never cloned), one outfit/varied shots, a locked grade, a named caption preset.

---

## Step 1 — Analyze the reference `[GENERIC]` (creative summary)
Extract the format, staging, hook, and pacing — mechanically, not by vibes. Use the
same canonical decode as every duplication workflow, and launch it exactly once:
```bash
: "${VIDEOCLAW_JOBS_DIR:?set by the Videoclaw app}"
mkdir -p "$VIDEOCLAW_JOBS_DIR/$JOB/reference"
# URL input:
uv run python tools/pull_video.py --job "$JOB" --mode pull --url "<url>" \
  --output "$VIDEOCLAW_JOBS_DIR/$JOB/reference/ref.mp4"
# Local-file alternative (run this instead of the URL command):
uv run python tools/pull_video.py --job "$JOB" --mode pull --file "<local.mp4>" \
  --output "$VIDEOCLAW_JOBS_DIR/$JOB/reference/ref.mp4"
```

Run this one `breakdown_reference` timeline pass. If the user asks what it will
cost, obtain a side-effect-free gateway quote for this exact operation first:
```bash
uv run python tools/breakdown_reference.py --job <job> \
  --video reference/ref.mp4 \
  --transcribe --transition-frames \
  --vision-mode timeline
```
Wait for the printed `breakdown/<stem>/breakdown.json` path. This one operation creates
frame-accurate cuts, a word-level transcript, deterministic ~2s cards at 5fps, global
RMS/onset evidence, transition montages, and one aggregate Gemini interpretation over the
whole timeline. The atomic decode claim prevents duplicate paid launches; an exact completed
rerun reuses its receipt. Do not launch a separate per-video vision pass, poll a guessed
output path, or expose file/waiter mechanics in user chat.

Read every `breakdown/<stem>/timeline/*.png` card, `timeline_analysis.json`, and
`transcript.json`, then pull out explicitly (to look at the reference or any later draft
again, call `look_at_video`; it reuses this decode's transcript and stacks two videos):
- **Hook mechanism** (first 1-3s): what makes you stay — a question, a bold claim, a visual.
- **Beat structure**: the ordered beats (setup → tension → turn → payoff) with rough timings.
- **Pacing**: cut cadence (b-roll every N s), WPM, energy curve.
- **Tone & treatment**: caption style, grade, b-roll type, on-screen text density.

The audio layer is mechanical evidence only: globally comparable RMS energy, onset novelty,
word timing, and alignment to cuts. Listen to the reference before naming music, drops,
impacts, or semantic sound events; the vision pass is not allowed to infer those from pixels.

Present that decoded format as a concise creative summary when useful, then
continue; it is never an engine approval gate. Pacing, caption animation, and persistent elements are
visible data in the cards; prose alone under-decodes them.

Optionally ground the hook in the tenant's niche (not just this one reference):
```bash
uv run python tools/analyze_reference.py --job $JOB --mode hook_bank --channel <handle>
```

**Gemini is EYES, not TASTE** — take the mechanical observations (structure, timings), you
decide the creative. Write the distilled format to
`$VIDEOCLAW_JOBS_DIR/$JOB/reference_format.json`.

## Step 2 — Develop and select a differentiated concept `[GENERIC]`
Not a carbon copy — **your take.** Generate 2-3 concepts and select the strongest
grounded option by default. When useful, surface this **keep / change** table for optional
feedback. Pause for the tenant to choose only when they explicitly requested selection:

| | Concept A | Concept B | Concept C |
|---|---|---|---|
| **Keeps** (from ref) | hook mechanism, pacing | beat structure, tone | hook + cut cadence |
| **Changes** | topic, all visuals, narration angle | " | " |
| **Angle** | e.g. contrarian | e.g. tutorial | e.g. story |
| **Performer** | tenant real a-roll | tenant real a-roll | tenant gen talking-head |

Draft the new script IN THE TENANT'S VOICE (the tenant's spin, their corpus) and validate it:
```bash
uv run python tools/check_script.py --job $JOB   # WPM / word-budget / voice-corpus
```

To audit fidelity to the chosen reference too, set `script.json`'s `reference_analysis` to that analysis file's job-relative path, or pass `--analysis` with its cwd-relative path. Select the reference used for this concept explicitly; unrelated test clips in the job are ignored.
Build `beats.json` from the selected concept, mirroring the reference's beat structure but
with the new content (Step 2 of [`aroll-reel`](aroll-reel.md#step-2)). Explicit tenant
direction always overrides the default selection.

## Step 3 — Record the scope + optional delivery promise `[GENERIC]`
Record the complete semantic scope for execution. Cost is advisory here and is quoted
only when requested; operation authorization remains with the host spend policy:
```bash
# Describe each generative beat. When cost information is requested, quote the
# exact mint_video and lipsync_footage operations through the gateway, including
# role, count, duration, quality, resolution, and input bytes where applicable.
```
Optionally write a **delivery promise** (mirror the tenant COMMITMENTS + this concept):
```bash
: "${VIDEOCLAW_WORKSPACE:?set by the Videoclaw app}"
cp "$VIDEOCLAW_WORKSPACE/taste/packs/$TENANT/promise.example.json" \
  "$VIDEOCLAW_JOBS_DIR/$JOB/promise.json"   # then edit
```
Set `duration_sec`, `captions.preset`, `footage_mix.real_min_ratio`,
`motion_on_every_static`, and an `editorial` note carrying the reference's arc
(e.g. "hold the payoff late, like the ref"). It records intent only; it never
authorizes production.

## Step 4 — Internal hero-beat check before full production `[GENERIC]`
Produce **one hero beat** (the hook, usually) end-to-end as an internal sample
before the remaining beats. Look at the composed sample with `look_at_video` (alone,
or stacked under the reference) against the short `beats.json` slice.
Continue when it
matches the selected concept; revise clear defects internally. Present it for a user
choice only if they explicitly requested a sample checkpoint or required creative
input is genuinely missing.

## Step 5 — Produce the full reel `[BRAND: <tenant>]`
Hand off to the [`aroll-reel`](aroll-reel.md) spine with the selected concept. The reference's
format drives WHERE each element goes; the tenant's pack drives WHAT it looks like.

**5a — Performer = the tenant (retrieval-first, real primary).**
- Talking-head: **search the tenant's own footage first**, matching the reference's on-camera beats:
  ```bash
  uv run python tools/index_media.py search "<describe the shot>" --tenant $TENANT --job $JOB
  ```
  For new dialogue use the [talking-head default](README.md#talking-head-default):
  approved voice plus real-footage lipsync, with its shared fallback and cost tradeoffs.
  Keep usable recorded dialogue; respect an explicit tenant preference against cloning.
- B-roll: **match the reference's cutaway beats with the tenant's OWN media first**
  (`index_media search`), then generate on-brand (`mint_video` / `mint_image`, `[static-motion]`
  = every still gets motion). Clone the *type* of cutaway the reference uses, not its pixels.
  **Remix an owned clip's LOOK (chunk 31):** when the tenant's own footage already has the right
  motion but the wrong style/set (the reference is animated, differently graded, different
  environment), `mint_video --mode edit --video <clip> --prompt "<one change>"` restyles it in
  place — cheaper and more on-brand than generating the cutaway from scratch.
- **Data beats:** if the reference lands numbers, use the data-viz overlays
  (`skills/dataviz_styles.md` → `stat`/`bar`/`compare` in `style_directives.json`, themed from
  the pack) instead of a static number card.

**5b — [FLAGGED, opt-in] literal clip reuse.** If a beat genuinely needs the reference's own
footage — a quoted reaction, a "look at this" proof clip — you MAY pull it
  (`pull_video --mode pull`, with its crop/cut controls; use `sam3 reframe` only
  for subject-locked crops). **Fair-use / quoted only, ASK first**; it's
never the default and it's off-brand for a tenant whose value is their own footage.

**5c — Assemble + brand pack.** `compose_render` with the tenant caption preset, grade, and
overlays (Step 6 of [`aroll-reel`](aroll-reel.md#step-6)).

## Step 6 — Finish and reference fidelity

The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)).
Use the reference to explain differences in the requested hook, pacing and beat
structure. Stacked beat-aligned frames can ground those observations; record intended
deviations. They are diagnostic evidence, not a second approval or repair loop.
The host/gateway ledger remains the source of paid-operation settlement.

---

## First runs — evidence + defect ledger

**`<ref-dup-example>`** (2026-06-27) — "pixel-perfect duplicate" of an IG reel with a new
gen presenter, pivoted mid-run to *"artistic rework… recreate why this content works"* (the honest
framing this workflow now codifies). Trail: `run.log.jsonl` (78 events, 12 tools),
`review_output.md`, `qa_pass{A,B,C}`.
- **The rebuild spine held:** `analyze_reference --mode video` (73s ref → 22-sentence Scribe
  anchor + Gemini story-arc/shot/overlay layers) → `cast_avatar` (Seedream sheet) →
  `perform_avatar` (Seedance chunks, several retries) + `mint_image` overlays → per-chunk Gemini
  review → `synth_voice` → `densify` → `compose_render` ×3 → `review_output --mode full` → `final.mp4`.
- **`analyze_reference` layers are flaky:** story-arc layer died once on a Gemini
  `JSONDecodeError` (the truncation gotcha — retry passed); overlays layer failed with a
  `ValueError`. And the log shows `format_proposal: false` — the structured Step-1 summary has never actually run.
- **QA earned its keep:** the first delivery skipped QA (the client: *"did you use the 3 layer qa
  step…?"*); the open-critic then surfaced real defects — flickering black cheek glitch, mask
  halos around hair, caption cutoffs, clipped audio on a cut, reversed title-card hierarchy.
  Verdicts 1 on-role / 1 slop / 1 ai-tell → two fix renders → *"much better !!!"*. This run is
  what birthed the stop-hook QA gate.
- **Style extraction was thin:** the "replication brief" reduced the reference's whole look to
  one `caption_style` block in `style_directives.json` — the feel defects above all live in
  what wasn't extracted. No concepts table, no cost contract, no promise (all postdate this run).

**`<style-remix-example>`** (2026-07-01) — a listicle reference reel ("top 5 secret codes")
remixed as the tenant's own "5 things I actually use" listicle, real-voice path. Trail:
`SCRIPT_teleprompter.md`, `promise.json` (`workflow: reference-remix`), `_check/` frames,
`real/top-5.mp3` (57s VO, recorded).
- **The delivery targets helped QA:** script drafted in the tenant's voice,
  `promise.json` recorded `real_min_ratio 0.8` and the masked-cutout / varied-zoom /
  comment-bait format, and the Step-4 sample was invoked for real (~8s lipsync
  sample ~$1 before the ~$6 full spend). Step 1 ran informally though — format
  pulled from the post by eyes, not via the tool.
- **Pricing validation caught a 20× under-quote:** the cost tool was flat-rating lipsync;
  corrected to $0.134/s (~$0.25 → ~$6.30) before execution. Fix folded into the tool;
  authorization remains a host/gateway decision.
- **Blocked at Step 5a (base retrieval), not the pipeline:** `index_media` "desk" match was an
  overhead b-roll (no face); the only true talking-head is a 9s super close-up — violates the tenant's
  own `[aroll-shots]` rule and is 48s shorter than the VO. Frame-verified before paying, so $0
  wasted — the checkpoint worked; the library didn't. Resume needs a mid-shot base take.

## Output
`$VIDEOCLAW_JOBS_DIR/$JOB/final.mp4` — the tenant's own reel, carrying the reference's winning structure,
built from the tenant's own footage/voice + on-brand generation.

## Swap points (works for any tenant)
- Tenant → the pack's locked look (fonts, grade, caption preset, performer path).
- Performer path → real a-roll (best) vs gen talking-head (fast, mediocre) vs avatar-speaker.
- The reference is the FORMAT source; the pack is the STYLE source. Never let the reference's
  style override the tenant's locked commitments.

## Taste-capture
If the reference reveals a beat pattern / hook mechanism the tenant loves, capture it to the
pack's "Example sequences" (`$VIDEOCLAW_WORKSPACE/taste/HOW_TASTE_WORKS.md`)
so the next remix starts ahead.

## Why this shape (vs a blank prompt)
A reference is a proven structure + an honest visual target. Grounding in it — then using
concept → sample checks before scaling the run — is faster and lands more reliably than
inventing from zero. What we DON'T do is copy: we keep the format, rebuild the craft as the
tenant. (Ref: the OpenMontage "start from a video you love" entry point —
`_archaeology/openmontage_comparison/`.)
