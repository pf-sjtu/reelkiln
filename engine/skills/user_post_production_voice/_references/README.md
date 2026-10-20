# Overlay multishot references — read BEFORE planning an edit

These are the canonical good `overlays.tsx` files from jobs the user has approved.
**Every agent that is about to author or revise `<job_dir>/overlays.tsx` MUST
read all six of these files before proposing a design brief or writing a single
line of TSX.** They are the multishot anchor for "what good looks like on this
pipeline." Same role `user_script_voice/PATTERNS.md` + raw EDIT_PAIRS play for
scripts — these play for the edit.

## Scope — what counts as "the edit"

The edit is more than `overlays.tsx`. The artifacts that travel together:

| File | Role |
|---|---|
| `<job_dir>/design_brief.md` | The **implementation contract** between creative intent and TSX. Surface it at rule 20 #6 when useful and accept optional feedback, but continue unless the user explicitly requested review. The 10-section spec covers register, typography palette, color tokens, per-beat overlay manifest anchored to transcript words, asset manifest, SFX manifest, and motion vocabulary. |
| `<job_dir>/overlays.tsx` | The **implementation** — what these five references are. Every row of the brief's per-beat manifest lands as a Sequence here. |
| `<job_dir>/script.json:post_production_notes` | The **director's intent per chunk** — drives some default overlays (hooks, lower-thirds, URL pills) the brief inherits. |
| `<job_dir>/style_directives.json` | Caption-level directives (italic emphasis, font ratio, outline). Auto-derived; tweak only when the brief calls for it. |
| `<job_dir>/inputProps.json` | Auto-built by `remotion_render.py` / `preview.py`. Not hand-edited. |

So "the edit" = design_brief.md (intent) + overlays.tsx (build) + the small
style_directives knobs. The references below pair the TSX with the design brief
where one exists.

## The six references

### `01_jeffreyshaw_overlays.tsx` — Florida-luxury mentor, restrained
*Job: jeffreyshaw.com-20260510-wlwxtc · 2026-05-10*

Three-overlay minimal stack — hook stacked-rectangle banner, lower-third name
pill on "Jeffrey", brand lockup card on "forty". Cream/gold-foil/warm-black
palette. **Read for:** the "less is more" baseline. Bold-block hook for virality
+ refined brand pills for the close. Word-anchored timing via transcript.json.

### `02_thejenmoff_overlays.tsx` — High-production, pull-quote + stat takeover
*Job: thejenmoff.com-20260511-v5vkmu · 2026-05-11*

Heaviest stack of the five: (1) custom kinetic word-by-word captions
replacing default Remotion captions, (2) pull-quote slam mid-video, (3)
full-card stat takeover (Tasha Eurich 95% / 10–15%) on paper-texture with
gate-weave jitter, (4) brand end-card with hold-extend. **Read for:** when the
video needs to FEEL produced, not just captioned. Stat-reveal cards, kinetic
typography on numbers, paper texture, custom caption replacement (renders with
`--no-captions`).

### `03_awakencoachinstitute_overlays.tsx` — Minimal after iteration
*Job: awakencoachinstitute.com-20260511-utghn0 · 2026-05-11 (round 3)*

The smallest of the five (267 LOC). Two overlays only: watch-till-end sticker
+ closing URL pill. **Read for:** what survives THREE rounds of user feedback —
this is the iteration end-state after the user removed a word-pop and an MCC
card that covered captions. Lesson: italic emphasis moved INTO the caption
track via `style_directives.json:italic_word_starts_ms`, not as a JobOverlays
layer. When in doubt, push styling DOWN into the caption layer rather than UP
into JobOverlays.

### `04_protocolschooloftexas_overlays.tsx` + `04_protocolschooloftexas_design_brief.md` — Audit countdown with SFX choreography
*Job: protocolschooloftexas.com-20260511-v3uqzu · 2026-05-11*

The most cinematic of the five and the only one paired with its design brief in
this folder. Big-text reveal (ETIQUETTE ILLITERATE), 30s countdown timer that
ticks down through 5 audit-question icons appearing with wiggle, HUGE UNLOCK
stamp, slide-in stat card, slide-in lower-third for Diane Gottsman, callback
italic-serif quote. Layered SFX: phone-tap, stamp-slam, 5 click-pops, 2
whooshes. **Read both files together** to see how design_brief.md §5 per-beat
manifest rows map to Sequence definitions in overlays.tsx. This is the
canonical "the brief is the contract" example.

### `05_sanespaces_overlays.tsx` — Screen-hijack cards when avatar visuals are weak
*Job: sanespaces.com-20260513-m8txtk · 2026-05-13*

Pattern #7 in PATTERNS.md made concrete: 3 full-frame screen-hijack cards
(Clear / Frame / Finish) on the §12.5 textured-paper primitive, REPLACING the
talking-head visuals during the pillar moments where seedance hand-morph
artifacts were visible. Avatar audio continues under the card. Palette D
(Coaching Warm) — Manrope body + Cormorant Garamond italic emphasis.
**Read for:** what to do when the avatar generation has cosmetic defects you
can't regen out — hijack the screen on those beats with a stronger visual
story.

### `06_thigpro_overlays.tsx` + `06_thigpro_design_brief.md` — Hand-drawn notebook narrative with dual-weave + wiggling chromakey'd icons
*Job: thigpro.com-20260515-yqo1rj · 2026-05-15*

The fullest "drawings on paper" register in the pack and the second one paired
with its brief. Crumpled cream-paper backdrop, sepia ink palette, two
multi-beat handwritten notebook pages: (1) a flowchart trap that builds beat
by beat (Moment → feel off → you LABEL it → 3 struck-through quoted labels →
big terracotta IDENTITY), (2) a vertical L.E.A.D.E.R acronym list where each
row reveals as its verb is spoken and each row carries a hand-drawn line-art
icon (compass, breath wave, open palm, untied knot, footstep, recursive
arrow). Plus: a screen-filling kinetic LEADER reveal at the payoff word, and
a TikTok-pill hook open (black pill, Inter Black 900, all caps) over a
pre-rendered handwritten gpt-image-2 journal page asset.

**Read for SPECIFICALLY:**

1. **Dual-weave pattern** — `NotebookPageBase` applies one gate-weave transform
   to the paper layer and an INDEPENDENT gate-weave (different frequencies +
   phase seed) to the text layer above it. Reads as two distinct physical
   pieces drifting against each other instead of one flat composite. Mandatory
   when you want overlays to feel like "writing on paper" rather than "graphic
   design on a paper photo."
2. **Wiggling chromakey'd icons** — gpt-image-2 line-art icons rendered on
   white background, ffmpeg `colorkey=0xFFFFFF:0.30:0.05` post-processed to
   `*_alpha.png` for true transparency, then composited with a slow ~1.8Hz
   sine wiggle (±1.2° rotation, ±1.2% scale). Hand-drawn animation register
   without the "ad-tech motion graphics" smell.
3. **Word-anchored multi-beat narrative pages** — both notebook pages have
   ~6-8 reveals each, every reveal anchored to a specific transcript word
   via `findInRange("inconsistent", c2.start_sec, c2.end_sec)` etc. The
   page builds AS the avatar speaks; densify/transcript shifts flow through
   automatically. Each anchor passed as a prop into the page component so
   the page is a pure function of word-positions. No hardcoded ms.
4. **Brand-card slides in on the brand's own marketing phrase** — the
   ThigPro card anchors to the word `intentionally` (mid-CTA, ~4s before
   "go find this coach") instead of waiting for the spoken "ThigPro" word
   (which doesn't exist — the dialogue says "this coach on screen right
   now"). Pulls the brand's signature phrase ("intentionally selfish")
   into the visual moment of brand arrival. Extends PATTERN #9: when the
   brand name might mispronounce or doesn't appear in dialogue, anchor
   the visual brand reveal to a related lexical cue that DOES appear.
5. **TikTok-pill hook open** — black `#000000` rounded rectangle, Inter
   Black 900, all-caps, tight letter-spacing (-1.2). Recognizable
   platform-native register. Layer over a pre-rendered gpt-image-2
   journal-page asset (handwritten labels baked in, struck-through) so
   the visual hook does double duty: pattern-break + IVP self-recognition.
6. **The aesthetic-directive vocabulary** — design brief §0 captures it
   in 5 named directives (hand-drawn vibe / crumpled paper / gate weave /
   minimalist / icons wiggle). All five became concrete implementations.
   This is the cleanest example of how a 5-line aesthetic spec lands in
   actual TSX without spec-bloat.

Paired brief at `06_thigpro_design_brief.md` — read both files together
when authoring a "hand-drawn notebook" register video. The brief is
compact (~50 lines) and is the closest example to the "wraps the locked-in
production decisions before authoring overlays.tsx" workflow.

## How to use these references

1. **Skim all six top-of-file comment blocks first** — they encode the intent
   in 10–25 lines each.
2. **Pick the closest analog to the job at hand** — restrained brand (Jeffrey
   Shaw), high-production stat reveal (Jen Moff), iteration-minimal (Awaken),
   choreographed countdown (Protocol School), screen-hijack salvage
   (Sanespaces), hand-drawn notebook narrative (ThigPro).
3. **Read its full TSX end-to-end** before writing yours. Reuse its helpers
   (`useJobJson`, `findWord`, the textured-paper primitive) rather than
   re-deriving what's already been validated. Every reference was authored on
   the 1080 × 1920 portrait canvas: scale positions and sizes to the job's
   canvas as a fraction of `height`/`width` from `JobOverlaysProps` (see
   `overlay_authoring_guide.md` §2), never as fixed pixels.
4. **Read the Protocol School design_brief.md alongside** even if your job
   isn't a countdown — it's the cleanest example of a brief→TSX correspondence.

Don't paraphrase these. Read the source. Whole files. They're short.
