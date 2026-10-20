# A-roll reel — real-person talking-head + B-roll short

A forward **generative recipe** for an on-camera reel: a real person at
their desk, lip-synced to a locked densified VO, punctuated by hand-drawn
note-cards and high-quality B-roll inserts, with brand captions and a persistent
handle. Lip-sync uses Sync v3 via `lipsync_footage`.
For new dialogue, this is the [talking-head default](README.md#talking-head-default):
use an approved reference voice when requested, or the person's clean recorded VO.
That shared section owns fallback and cost tradeoffs. A good existing recorded
performance needs no regeneration, and a user's explicit no-cloning preference wins.

> **⚠️ Read this as PRINCIPLES, not a script to copy.** The commands below are the proven
> sequence from two rebuilds of ONE tenant's reel — the beat names, card prompts, the
> kraft-mat card look, and the split-screen geometry are *instances*. The transferable
> skill is the decision behind each move: why a beat goes on-camera vs card, why lip-sync
> runs only the visible windows, why a card lands where its text is spoken. If you can't
> say why a step exists for YOUR tenant, you're copying, not directing.

This is written generically — the worked example below is the proven command
sequence that produced ship-quality output on two a-roll reel rebuilds (referred
to below as "one rebuild" / "the other"), but any tenant whose inputs match the
**Input** block can run the same spine. Brand choices (cards, mat, handle, fonts, caption style)
come from the tenant's stated style pack; smart defaults only when unstated.

The whole thing is one spine: **establish the person's style prefs → author
beats with a concrete on-camera% measure → lipsync_footage plan+gen → mint
high-quality B-roll → compose_render → eval.** Lip-sync runs only the on-camera
windows; B-roll and cards fill the rest.

Shared skills do the heavy lifting — read them, don't re-derive:
`skills/evaluation.md` (every eval call below), `skills/broll_styles.md` (the
B-roll method catalog + exact `mint_*` calls), `skills/art_styles.md` (the
`--reference` style lock), `skills/voice.md` (VO path, if you're synthesizing
rather than inheriting a locked track).

All tools run from `/Users/chin/projects/videoclaw` with
`uv run python tools/<tool>.py` and take an explicit `--job <id>` (concurrent
jobs clobber `.current_job`).

---

## Input — what you start from, and WHERE each input comes from

| Input | Source | Notes |
|---|---|---|
| `02_base_segment.mp4` | the person's raw desk talking-head take (their footage library / a fresh studio record) | Feed the **raw** base segment with real head motion — NEVER an already-lip-synced clip. |
| `audio_densified.mp3` | the locked densified VO (from a prior `densify` pass) | Already at target WPM (~205–215). It is the locked truth — do **not** re-densify. |
| `bed.mp3` | the music bed for this job | Mixed under VO at ~0.30 gain. |
| `caption_chunks.json` + `transcript.json` | the densify output (word-level Scribe v2 timestamps) | `transcript.json` is the caption source of truth; `caption_chunks.json` is the spoken-moment map you author beats against. |
| `step0_empty.png` | the brand's empty card mat (e.g. a kraft-grid cutting mat) | `[BRAND: <tenant>]` — the mat under every card beat. |
| **Style prefs** | the **tenant's stated style pack** (Step 1) | framing, how-much-B-roll, fonts, caption style, handle. |

**One job root** (load-bearing): `lipsync_footage` plan/gen read and write
`jobs/<job>/edit/` and `jobs/<job>/<base>`; `mint_image` / `mint_video` /
`compose_render` / `verify_output` / `review_output` read `jobs/<job>/`. Nothing
goes under the engine's `projects/` folder any more.

```bash
cd "$VIDEOCLAW_WORKSPACE"
JOB="replace-with-the-same-canonical-bare-id"
SRC="replace-with-source-take-and-densify-output-path"

# jobs/<job>/  — lipsync_footage, mint, compose and eval all share it
mkdir -p jobs/$JOB/edit/aroll jobs/$JOB/edit/cards jobs/$JOB/edit/broll \
         jobs/$JOB/images jobs/$JOB/broll jobs/$JOB/reference
cp "$SRC/02_base_segment.mp4"      jobs/$JOB/02_base_segment.mp4
cp "$SRC/edit/audio_densified.mp3" jobs/$JOB/edit/audio_densified.mp3
cp "$SRC/edit/bed.mp3"             jobs/$JOB/edit/bed.mp3
cp "$SRC/edit/caption_chunks.json" jobs/$JOB/edit/caption_chunks.json
cp "$SRC/05_densified.transcript.json" jobs/$JOB/edit/transcript.json
cp "$SRC/edit/step0_empty.png"     jobs/$JOB/edit/step0_empty.png
cp jobs/$JOB/edit/transcript.json jobs/$JOB/transcript.json
```

---

## Step 1 — Establish the person's style prefs `[BRAND: <tenant>]`

**(a) Generate:** a one-screen style contract for THIS person, captured as notes
you carry through every later step. Resolve, from the tenant's stated style pack:

- **Framing** — full-frame talking-head vs split-screen (card/insert in the TOP
  1080×1080, face lip-synced in the BAND 1080×840 — ONE proven layout, not the
  only one; the geometry is a tenant-pack choice). When the pack is silent:
  full-frame is the simplest safe default; reach for split only when card/insert
  beats need the face to stay visible.
- **How much B-roll** — the target **on-camera %** (the concrete measure Step 2
  enforces). On-camera reels typically sit ~40–60% on camera; the rest is cards + inserts.
- **Cards & mat** — the hand-drawn note-card look on the kraft-grid mat
  `[BRAND: <tenant>]`.
- **Fonts / caption style** — the brand caption pack (break unit, color,
  position) `[BRAND: <tenant>]`.
- **Handle** — the persistent on-screen handle, e.g. `<handle>`
  `[BRAND: <tenant>]`.

**(b) Command:** none — this is authored notes (and, if a fresh VO is needed,
`synth_voice` + `densify` per `skills/voice.md`; here the VO is inherited and
locked, so skip).

**(c) Input source:** the tenant's stated style pack. Smart defaults only when a
field is unstated.

**(d) Why:** every downstream choice — beat split, card aesthetic, caption
placement, handle position — derives from this contract. Locking it once stops
the format drifting mid-build.

**(e) EVAL:** no model call (no asset yet). Check that the notes resolve the
style inputs—especially the **on-camera % target**, which Step 2's beat spec
must hit. Surface them when useful, but do not wait for human confirmation.

---

## Step 2 — Author `beats.json` with a CONCRETE on-camera% measure `[GENERIC]`

**(a) Generate:** `jobs/$JOB/edit/beats.json` — every spoken moment (from
`caption_chunks.json`) mapped to a beat. `on_camera:true` = on-camera (becomes a
lip-sync window); `on_camera:false` = a card / full-screen insert beat. (Old beat
specs used a legacy `joseph` key; the tool still reads it, but author `on_camera`.) <!-- lint-ok: example --> `mode` is
`full` (full-frame) or `split` (top card + face band). Cards land where their
text is **spoken** (a "90 minutes a week" card at that phrase; a "5×" outlier
card at "five times their average views"; a feed insert at "I built a custom
feed").

```json
{"fps":24,"duration":61.26,"base":"02_base_segment.mp4","beats":[
 {"name":"b1","start":0.00,"end":8.70,"mode":"full","on_camera":true},
 {"name":"b2_90min","start":8.70,"end":11.90,"mode":"full","on_camera":false},
 {"name":"b3","start":11.90,"end":22.50,"mode":"split","on_camera":true},
 {"name":"b4_feed","start":22.50,"end":26.40,"mode":"full","on_camera":false},
 {"name":"b5_outlier","start":26.40,"end":30.30,"mode":"full","on_camera":false},
 {"name":"b6","start":30.30,"end":55.10,"mode":"split","on_camera":true},
 {"name":"b7","start":55.10,"end":61.26,"mode":"full","on_camera":true}
]}
```

**The concrete on-camera% measure:** `on_camera% = (Σ duration of on_camera:true
beats) / total_duration`. Compute it from the beats above and assert it lands
inside the Step-1 target band (e.g. 40–60%). If it's under, convert a card beat
back to on-camera; if over, add a card/insert. This number is the contract
between Step 1 and the spend in Step 3 (you only pay sync-3 for the
`on_camera:true` seconds).

**(b) Command:** authored JSON (no tool). Contiguous `on_camera:true` beats will be
merged into one lip-sync window by `lipsync_footage plan` in Step 4.

**(c) Input source:** `caption_chunks.json` (spoken moments) + the Step-1
on-camera% target.

**(d) Why:** beats are the whole timeline. The on-camera% measure is what keeps
the reel from collapsing into either a static talking head (0% B-roll) or a
faceless slideshow (no real person).

**(e) EVAL — `check_script` (the pre-generation gate, BEFORE spending fal $):**
per `skills/evaluation.md`, `check_script` is Seedance-shaped, so build a thin
`jobs/$JOB/script.json` (one chunk per on-camera window; `dialogue` = the spoken
sentences; `seedance_prompt` quotes each sentence + ends `[Image1]` to satisfy
the structural gate) and a sentence-grounded `jobs/$JOB/reference/analysis__self.json`
(each sentence: `id`,`start`,`end`, list-of-dict `story_arc`/`shot`/`overlays`/`audio`,
grouped mechanically from `transcript.json` on terminal punctuation).

```bash
uv run python tools/check_script.py --job $JOB --skip-llm
```
Pass criteria: **0 BLOCKING**, no `phonetic_respell_in_dialogue`, no
`missing_image1` / `dialogue_not_in_prompt`. Proper nouns must be spelled
correctly (the only ones here are real product names like "Instagram" /
"Claude"). The `chunk_wpm_drift` / `chunk_window_exceeds_seedance_ceiling`
SHOULD_FIX warnings are **Seedance-only and do not apply** to a real-footage
reel — there is no generation and the audio is locked at its densified WPM.

---

## Step 3 — `lipsync_footage plan` — compute on-camera windows `[GENERIC]`

**(a) Generate:** `jobs/$JOB/edit/aroll_windows.json` — the merged on-camera
windows + exact metered seconds for gateway pricing. No paid API call.

**(b) Command:**
```bash
uv run python tools/lipsync_footage.py plan --job $JOB
# e.g. → 3 windows (0–8.7, 11.9–22.5, 30.3–61.26) = 50.26 metered seconds
#   or  → 1 window if the on-camera beats are contiguous (one rebuild: 9.40–65.29).
```

**(c) Input source:** `beats.json` (`on_camera:true` beats) + `02_base_segment.mp4`.

**(d) Why:** lip-syncing only the windows where the face is actually visible
avoids charging for hidden footage, and each window is synced from its own clean
audio slice—no mid-take splices to hide. Confirm the metered seconds match the
Step-2 on-camera% and send them in the one grouped gateway-priced scope.

**(e) EVAL:** deterministic — read `aroll_windows.json` and confirm the window
seconds equal Σ(`on_camera:true` beats) from Step 2 (the on-camera% measure made
concrete in windows). No model call (no rendered pixels yet).

---

## Step 4 — `lipsync_footage gen` — fal sync-3 each window (the $ step) `[GENERIC]`

**(a) Generate:** per window, the lip-synced clip + its band crop:
`jobs/$JOB/edit/aroll/{w1,w2,…}.mp4` (full 1080×1920) and `*_band.mp4`
(1080×840), warm-graded to match the real footage. fal sync-3
(`fal-ai/sync-lipsync/v3`, `sync_mode:"cut_off"`).

**(b) Command:**
```bash
uv run --with fal-client python tools/lipsync_footage.py gen --job $JOB
# → jobs/$JOB/edit/aroll/w*.mp4 + w*_band.mp4, warm grade
#   eq=saturation=1.01:contrast=1.02:gamma=1.02 (sync-3 washes out)
```

**(c) Input source:** `aroll_windows.json` + `02_base_segment.mp4` +
`audio_densified.mp3`.

**(d) Why:** sync-3 is the highest-quality lip-sync and the current standard
(`skills/broll_styles.md` method 4). Per-window audio slices keep the lips in
sync across every later cut, because every window was driven by that same locked
track.

**(e) EVAL — eyes on a still per window (`skills/evaluation.md` §3 backstop):**
extract one mid-speech frame per window and `Read` it inline —
```bash
ffmpeg -y -ss <t> -i jobs/$JOB/edit/aroll/w1.mp4 -vframes 1 -q:v 2 /tmp/w1_check.png
```
Check: face intact, mouth mid-speech, identity stable, no corruption. A still
cannot reveal lip-sync drift. Regenerate a window only on a
mechanical defect (warped face, dropout, identity drift), never on taste.

---

## Step 5 — Mint HIGH-QUALITY B-roll `[BRAND: <tenant>]` cards / `[GENERIC]` inserts

For each `on_camera:false` beat, pick the **highest tier you can execute** from
`skills/broll_styles.md`'s content hierarchy (T1 full-bleed Gen-AI > T2
real-world receipts > T3 hand-drawn cards > T4 full talking-head). Clear the
high-quality bar in that file (foreground "wow"/real receipt; zero drift on
locked elements via `EXACT` PNG anchoring; rock-steady camera; legible text
never sent through a motion model; no dead split-screen; hands small at the
edge). Defaults: **720p**, Seedance **4s floor + trim**.

### 5a — Hand-drawn note-cards `[BRAND: <tenant>]` (method 6, T3)

**(a) Generate:** one card PNG per card beat, carrying ONE concept in the
brand's pen-on-mat look (the tenant's recognizable device).

**(b) Command:**
```bash
uv run python tools/mint_image.py --job $JOB --role card --name b2_90min_card \
  --aspect 2:3 --quality high \
  --prompt "<90-min handwritten note, ballpoint character, on the kraft-grid mat — EXACT BACKGROUND LOCK>"
uv run python tools/mint_image.py --job $JOB --role card --name b5_outlier_card \
  --aspect 2:3 --quality high \
  --prompt "<5× outlier-filter card with a small bell curve — EXACT BACKGROUND LOCK>"
```
Attach the brand mat/style anchor as `--reference` (the `--reference` style lock
is in `skills/art_styles.md`; the `EXACT`-language + PNG-anchor rule is in
`skills/broll_styles.md`).

**(c) Input source:** the spoken card phrase (from `beats.json`) + the brand mat
anchor.

**(d) Why:** cards are where a card beat lands visually — they carry the line
the VO is speaking at that moment.

**(e) EVAL — eyes on the still (`skills/evaluation.md` §1; a still has no
motion/audio → no Gemini):** `Read` each card PNG **inline** and verify the
**baked text is correct and legible** and the mat/lighting did not drift from the
anchor. Re-mint on garbled text or mat drift.

### 5b — High-quality motion insert `[GENERIC]` (method 2/3, T1/T2 — prefer over a card)

**(a) Generate:** the "wow" insert for a beat the script can carry visually — a
real-UI screen-rec (scroll/counter/click, method 2) or a cinematic
first+last-frame interpolation (method 3). Mint a **face-free** seed frame first
(realistic face thumbnails trip Seedance moderation E005), then animate it.

**(b) Command:**
```bash
# Face-free seed frame (start frame) — the custom-feed mockup, NO human faces:
uv run python tools/mint_image.py --job $JOB --role seed_frame --name custom_feed_clean \
  --aspect 2:3 --quality high \
  --prompt "<My Custom Feed mockup, charts/notes/gradient cards only, no human faces — legible top feed>"

# Motion insert — a SLOW PUSH-IN (not a scroll: a scroll reveals new rows the
# model renders as garbled gibberish + reintroduces faces). For a single-delta
# cinematic shot instead, use --first-frame/--last-frame (method 3, mutually
# exclusive with --reference).
uv run python tools/mint_video.py --job $JOB --mode insert --name custom_feed_push \
  --duration 4 --resolution 720p --no-audio --reference jobs/$JOB/images/custom_feed_clean.png \
  --prompt "<very slow gentle push-in zoom, feed does NOT scroll, text stays legible, Camera holds rock-steady, avoid jitter, avoid distortion> [Image1]"
```

**(c) Input source:** the beat's intent (from `beats.json`) → the seed frame →
the insert.

**(d) Why:** a T1/T2 insert clears the high-quality bar (foreground "wow" / a
real receipt) where a synthesized card would only tie — "receipts trump
synthesis" when the script names a real product/UI.

**(e) EVAL — `skills/evaluation.md` §3 (motion matters → Gemini-class, with a
still backstop):** extract a frame mid-insert and `Read` it (legible UI, no
faces, no garble).
Regenerate only on a mechanical defect — garbled text, reintroduced faces, an
E005 moderation block (re-mint the seed frame with no faces / a smaller edge
hand; **never** fall back to an ffmpeg slide-wipe — off-brand).

---

## Step 6 — `compose_render` — assemble the timeline + bake captions/overlays `[GENERIC]` spine, `[BRAND: <tenant>]` caption/handle pack

`compose_render` renders the generic `Captioned` comp over ONE background video;
it does NOT stitch beats. For a FULL-FRAME beat timeline, `tools/assemble.py` is the
convenience path (author `edl.json` → `--check` → render). The SPLIT-SCREEN (top+band
vstack) layout below stays hand-ffmpeg'd — going your own way is fine (idea catalog:
[`skills/assembly_craft.md`](../skills/assembly_craft.md)). **Either way, DECLARE the
timeline** (`assemble.py --declare` — role-log + `chunk_boundaries.json`) so the planned
beats are on record ([`skills/primitives/assemble.md`](../skills/primitives/assemble.md)).
Then `compose_render --mode retrofit` burns captions + overlays over the result.

**(a) Generate — the assembled `final_raw.mp4` (ffmpeg compositor).** The two
load-bearing crop rules (they prevent the only two assembly bugs):
- **TOP track (1080×1080):** on-camera beat = `crop=1080:1080:0:0` of the full
  lipsync window; card beat = card centered on the `step0_empty.png` mat; a
  full-screen insert/hook = the UPPER 1080 of a 1080×1920 cover-fit (so it's ONE
  continuous visual across the seam, not a duplicate cover-crop).
- **BAND track (1080×840):** on-camera beat = `crop=1080:840:0:1080` (the LOWER
  840 of the **same** window — so top+band = one seamless face, **no double
  face**); card/insert beat = a face-centered band crop (≈`crop=1080:840:0:280`)
  so the person stays visible UNDER the card.
- **vstack** top over band → 1080×1920; **mux** `audio_densified.mp3` @1.0 +
  `bed.mp3` @0.30 (amix) → `jobs/$JOB/final_raw.mp4`.
  (Exact ffmpeg lives in each rebuild's `assemble.sh`.)

**(b) Generate — captions + overlays.** Author `jobs/$JOB/overlays.tsx`: a light
persistent handle (e.g. `<handle>`) pinned top-left, clear of the face
(y≈400–1100) and the caption seam (y≈1040–1180) `[BRAND: <tenant>]`.
**Rule-21 gate:** `Captioned.tsx` imports `JobOverlays` as a **default** import —
the file MUST end with `export default JobOverlays;` or the render dies with
React #130 (undefined component) at frame 0. One-time Remotion env setup: stub
any orphan `*.tsx` static caption-JSON imports (the bundler compiles ALL src
files; one missing import fails EVERY render):
```bash
grep -rhoE 'from "\.\./public/[^"]+\.json"' remotion/src/ \
 | sed -E 's/from "\.\.\///; s/"$//' | sort -u \
 | while read rel; do f="remotion/$rel"; mkdir -p "$(dirname "$f")"; \
     [ -f "$f" ] || printf '{"chunks": []}' > "$f"; done
```

**(c) Command:**
```bash
# [BRAND: <tenant>] LOCK THE CAPTION LOOK FIRST — pick the tenant's caption preset
# (there is no implicit default and no CLI flag; it is read from style_directives.json).
# e.g. a per-tenant preset (a pixel display font at the seam), registered in
# remotion/src/caption_presets.json and named in taste/packs/<tenant>/README.md §3.
# Without this the render falls back to the generic default and the captions come out WRONG.
printf '{"caption_preset": "<tenant>"}' > jobs/$JOB/style_directives.json

uv run python tools/compose_render.py --job $JOB --mode retrofit \
  --source_video jobs/$JOB/final_raw.mp4 --resolution 1080p \
  --caption_break sentence \
  --hide_ranges <card-beat ranges, ONLY if a card's baked text fights the caption>
# retrofit stages final_raw as the background, burns word-timed captions from
# transcript.json at the band seam (in the preset's font), applies overlays.tsx.
# → jobs/$JOB/final.mp4
```
Use `--hide_ranges` only when a full-screen card's baked text collides with the
caption (one rebuild hid captions over its full-screen cards). When cards sit in
the TOP 1080 and captions render at the band seam (y≈1040–1180) they don't
collide — omit `--hide_ranges` (the other kept captions throughout).

**(c) Input source:** `final_raw.mp4` (assembled timeline) + `transcript.json`
(caption words) + `overlays.tsx` (handle).

**(d) Why:** retrofit gives word-timed captions baked into pixels over the
already-assembled beats, plus the persistent brand handle, in one render.

**(e) Placement craft (`skills/evaluation.md` §4a):** place the handle, captions and
cards clear of the face and the caption seam while authoring `overlays.tsx`.
`preflight.py` cannot see JSX overlays, so frames from `verify_output --mode render`
are the quickest way to spot a handle/face/caption-seam collision; fix what you find
once, per [Finishing a render](README.md#finishing-a-render).

---

## Step 7 — Finish

The composited `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). The craft to build in: the
speaking windows stay in lip sync, captions match the audio, no dropouts, no double
faces, and no clipped card seams. Optional `verify_output --mode render
--avatar-type real_person_lipsync` frames help locate a defect you suspect.

---

## Output

A ~50–65s vertical (9:16) talking-head reel: the real person at their desk,
lip-synced to the locked densified VO, punctuated by hand-drawn note-cards on
the brand mat and one or more high-quality B-roll inserts, with word-timed brand
captions and a persistent on-screen handle. → `jobs/$JOB/final.mp4`.

## Swap points (this spine works for anyone)
- The person-specific inputs are **only** the base footage, the densified VO/bed,
  and the transcripts. Swap those and the spine is identical.
- The **style pack** (Step 1) — framing, on-camera% target, card aesthetic,
  fonts, caption style, handle — is the brand layer. The tenant's hand-drawn cards + mat
  are `[BRAND: <tenant>]`; the spine is `[GENERIC]`.

## Inherited-vs-introduced (what the eval loop must NOT chase)
Defects present **verbatim in the source take / densified audio** (duplicate
takes, natural pauses, a reel that ends mid-phrase, a frozen hand in the base
footage) are INHERITED — the audio is locked, so do not regen for them. Only
defects the assembly/mint **introduced** (double face, garbled insert rows,
React #130, an E005 block, a card-seam collision) are in-scope for this loop.

---

## Generated A-roll variant — talking-head from the character sheet `[GENERIC]`

> **These steps are molecules — reuse, don't re-derive:** `build-character-sheet` →
> `image-from-character-sheet` → `wardrobe-swap-identity` → `identity-image-to-video`
> (the talking-head composition is `gen-talking-head-from-face`). See
> [`skills/molecules.md`](../skills/molecules.md) §Character / identity.

When you want the speaker on camera in **varied shots/looks** beyond the one real desk take
(or there's no usable base take), offer this variant with its cost/quality tradeoffs
and the VO+B-roll alternative. Generate it only after the user chooses it.
Inspect intermediate assets for visible defects.

```
character sheet  →  gpt-image-2 HQ still  →  Omni image-to-video  →  lipsync
   (identity)        (mint_image portrait)   (app call_model)      (lipsync_footage long)
```

1. **Sheet → still** — `mint_image --role portrait` with **MULTIPLE `--reference`** = the
   tenant's real face CUs (e.g. `assets/<tenant>/character_sheet/face_refs/real_face_*.png`).
   **Shot rules:** ONE outfit per video (match the sheet's fit); vary the FRAMING/ANGLE across
   shots (close / far / unique angle) and **favour further-ish MID shots — avoid the super
   close-up, it reads bad**.
   **Check the still:** `Read` it inline; reject if the likeness drifts from the real CUs.
2. **Still → video** — the app's `search_models` then `call_model` with model_slug
   `google-gemini-omni-flash-image-to-video` and input
   `{"prompt":"the person in the image makes subtle natural talking-head motion…","image_url":"<still>","duration":N,"aspect_ratio":"9:16"}`
   (N = 3–10 s; Seedance E005-blocks real faces; `mint_video --mode multishot` is unavailable, videoclaw#317).
   **Check the motion:** extract a frame; reject on warping / identity drift in motion.
3. **Generated base → lipsync** — `lipsync_footage long --video <generated base> --audio <window slice>
   --output <synced>`.
   **Lipsync asset inspection:** inspect intermediate frames for warping or identity
   drift; a still cannot show motion or audio sync. Step 7 finishes the composited
   `final.mp4` after captions. Synthetic bases have shown sync drift in prior runs; if
   you see it, offer a cutaway or real-footage replacement for the next user-requested
   edit. Do not silently replace the agreed shot.

**Honest caveat:** generated talking-head quality is still mediocre and lipsync drift is the
recurring failure → **prefer REAL footage for the actual talking; use gen talking-heads
sparingly / as cutaways.** (Generate identity-locked scenes from the face refs; see the
tenant's brand `## COMMITMENTS`.)

**STATIC-IMAGE MOTION (applies to ALL beats):** every static image — generated *or* retrieved —
gets a visual effect, never a dead-still frame: min **Ken Burns** push-in/pan; richer = **vox
textures / parallax** (`skills/broll_styles.md` §Static-image motion).

## TODO — open improvements
*Surfaced 2026-06-27 from the review blind-tests (two a-roll reel rebuilds). The error-detectors
in [`skills/video_qa.md`](../skills/video_qa.md) now catch mechanical/structural/brand/timing
defects; below are the confirmed brand FIXES + the craft frontier.*

**Confirmed brand FIXES (recurring real defects — do these):**
1. **Captions off-brand — blue/cyan highlight must become the brand ACCENT color**, white body,
   single consistent anchor (no jumping). Spec: `taste/packs/<tenant>/README.md`.
   The QA style-pass must ground against that spec and assert the violation, not hedge.
2. **A-roll grade runs cold/blue → make it WARM** to match a warm brand theme. The current
   warm `eq=` isn't enough; add a grade check to the `lipsync_footage` step.
3. **Cards collide with the @handle pill + get chopped by the frame edge** (verified
   ~22/45/53s on one rebuild). Reserve the handle zone in card layout, or shrink/reposition
   cards — and decide whether the persistent handle is even wanted (the tenant flagged it covers frame).
4. **A graphic's content format should match what it depicts** (one rebuild, 46s: a code example
   rendered as a squashed handwritten note → should be a code/markdown block).

**Craft frontier (the "deep digression" — research, then encode as spec + a check):**
5. **Typography system.** No standard exists. Research short-form typography best-practices
   (sources online), define the tenant's type system (caption + card), encode in the brand pack + a check.
6. **B-roll on-screen *types*.** Beyond the method catalog: a visual spec of what good b-roll
   should LOOK like on screen per beat-purpose. Feed into `broll_styles.md` + a check.
7. **Transition types & placement.** We ship hard cuts only — and "leftover overlay / wrong
   transition timing" (one rebuild at 1:02; the other) is the cost. Catalog transition types and WHERE
   each belongs (beat→beat, card-in/out, b-roll-in), encode as rules + a timing check.
8. **A positive STYLE / QUALITY judge — "is this actually good?"** Everything we built finds
   ERRORS; nothing judges GOODNESS (strong hook? good visual rhythm? on-brand-tasteful?). This
   sits on the "Gemini is EYES not TASTE" boundary — keep it ADVISORY (no 1-10 score), ground
   it in the tenant's "good" exemplars + concrete checkable proxies, and **measure its false-positive
   rate before trusting it** (the same generate→verify discipline we proved on the error-detectors).
