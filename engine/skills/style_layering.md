# Style Layering — what's global, what's per-job

This pipeline has three layers of visual AND audio style. Each layer answers
a different question. Putting a knob in the wrong layer is the most common
"my fix bled into the next job" bug.

## The three layers

### Layer 1 — GLOBAL DEFAULTS
*Where:* `agent/remotion/src/CaptionPage.tsx` defaults, `agent/remotion/src/_motion.tsx` (HOCs), `agent/remotion/src/_styleTokens.ts`.
*What goes here:* anything that's true for EVERY video the pipeline produces, regardless of brand or niche.

| Knob | Value | Why global |
|---|---|---|
| Caption font size ratio | `0.028` (~54px on 1920h) | The right size for talking-head content where the face is the focus. Was 0.055 — too big. |
| Caption position (`vertical_anchor_ratio`) | `0.65` | Out of the avatar's face zone, above the platform UI band. Universal. |
| Caption wrap behavior | `whiteSpace: "normal"`, `lineHeight: 1.18`, `overflowWrap: "break-word"` | Long lines should wrap. Universal. |
| Outline minimum width | `4px` (no pill) / scales with font size | Caption legibility on busy backgrounds. Universal. |
| Auto outline-color flip | luma-based | Captions need contrast against video luminance. Universal. |
| **Card breathing wobble** | 2-3px sine, 4s period | Static cards feel dead. Subtle motion = production polish. Universal. |
| **Caption micro-drift** | 1px sine, 6s period | Same reason — kills the "static graphic glued to video" feel. Universal. |
| Standard spring/easing tokens | `SMOOTH`, `SNAPPY`, `BOUNCY` | Motion language consistency. Universal. |
| Standard durations | `ENTER_FRAMES=8`, `EXIT_FRAMES=5` | Visual cadence consistency. Universal. |
| **Bed pre-attenuation** | `-16 dB` | Score starts below voice on every video. Universal. |
| **Bed EQ scoop** | `-4 dB @ 1.2 kHz, Q=1.0` | Voice-band carve so speech sits in cleanly. Universal. |
| **Bed high-pass** | `60 Hz` | Kills sub-rumble on phone speakers. Universal. |
| **Bed level** | one steady level, `~ -12 dB rel voice` — no side-chain duck, no swell in pauses | JC's rule (#321): music a few dB under the voice, never pumping (`score_bed`'s default flat mix). Universal. |
| **Master loudness** | `-14 LUFS integrated, -1.5 dBTP, 11 LU` | TikTok/Reels target. Universal. |
| **Score fade-in / fade-out** | `0.4s / 0.8s` | Soft edges so the bed doesn't slam. Universal. |

### Layer 2 — PER-JOB STYLE (`<job_dir>/style_directives.json`)
*Where:* read by `CaptionPage.tsx` (caption_style sub-object), `Captioned.tsx` (caption + bg directives), and `<job_dir>/overlays.tsx` (free-form access).
*What goes here:* anything that differs per BRAND, NICHE, or REFERENCE OUTLIER.

| Knob | Why per-job |
|---|---|
| Brand colors (active-word color, overlay backgrounds) | Each brand has its own palette |
| Custom font family | Brand may have a typeface |
| Caption background pill (on/off) | Some brands prefer pill, some prefer outline-only |
| Hook text + timing | Each script has a different hook |
| Lower-third firm name + URL | Each job has a different brand |
| Logo asset path | Per-firm logo |
| `vertical_anchor_ratio` override | Rare — when the avatar's face position is unusual |
| **`audio.no_music`** | Opt out of score entirely — for vulnerable monologue / calm-vulnerability brands where silence IS the brand. Score.py exits early when true. |
| **`audio.mood`** | One-line mood hint that feeds into all 3 anchor prompts (e.g. *"warm conspiratorial mentor"*) |
| **`audio.anchor_preference`** | Bias the surface order — `tycho` / `frahm` / `khruangbin`. Doesn't gate, just orders. |
| **Bed level** (`score_bed --bed-under-voice-db`, `assemble` `under_voice_db`, `style_directives` `music.bed_under_voice_db`) | Override Layer 1's 12 dB — 15 for skits and recreations, a sung track, or when the user wants quieter music. The bed never ducks and is never cut under a line (#321) |

`style_directives.json` overrides global defaults but ONLY for the keys it
specifies. Anything missing falls through to Layer 1.

### Layer 3 — PER-JOB OVERLAYS (`<job_dir>/overlays.tsx`)
*Where:* author the React component directly. See `overlay_authoring_guide.md`.
*What goes here:* anything BESPOKE to this video. Custom cards, brand
lockups, citation pills, story beats, motion-anchored animations.

The overlays.tsx component owns the entire overlay layer when it exists —
the legacy hook/url/lower-third auto-overlays get skipped automatically
(see the `--legacy-overlays` flag in `remotion_render.py` if you want to
keep both).

---

## The decision tree

When you're about to add a style knob, ask in order:

1. **"Will this be true for every future video the pipeline produces?"** →
   Layer 1 (global default). Examples: caption wrap, breathing wobble,
   outline minimum width.

2. **"Does this differ per brand / niche / reference but use the same
   shape?"** → Layer 2 (style_directives.json). Examples: brand colors,
   font family, caption background pill on/off.

3. **"Is this a one-off visual element bespoke to this script?"** →
   Layer 3 (overlays.tsx). Examples: a §522(f) citation card, a stamp
   slap, a lower-third for a specific firm.

If you find yourself wanting to change a Layer 1 default for a single
job, ask: should this be in Layer 2 instead? (Probably yes.) The Layer 1
default-bumping pattern is what causes "the next job inherited my taste
choice" bleed.

---

## Caption motion specifically — the layer-aware rule

The caption track is the most-touched element on screen and the single
biggest temptation to "add dynamism" per-job. Resist. The rule:

1. **Layer 1 — the caption track itself stays a global default.** Layout,
   sizing, luma-flip outline, and the 1px ambient drift in
   `CaptionPage.tsx` are *correctness + identity* concerns — every video
   needs legible captions, and the caption track is the most consistent
   visual signature the system has. Don't modify per-job.
2. **Layer 2 — brand color/font swap only.** Active-word color, base
   color, font family, pill on/off go through `style_directives.json:
   caption_style`. Same shape on every video; only the palette changes.
3. **Layer 3 — bespoke kinetic emphasis is ADDITIVE in overlays.tsx.**
   When the reference outlier or `vision.md:mood` genuinely calls for a
   kinetic moment (a phase-up impact word, a beat-anchored stat reveal,
   a pivot card), author it as a *separate* element layered on top of
   the caption track in overlays.tsx — don't reach into `CaptionPage.tsx`
   or try to override caption motion via props. The caption track keeps
   running underneath, unmodified. Use the "one moving thing at a time"
   rule (`overlay_authoring_guide.md` §4) — when the kinetic beat is on
   screen, it owns the motion attention; when it exits, the captions
   resume being the only subtle motion in frame.

Default: no kinetic emphasis at all. Add only when the reference's
caption pack actually has it, or when a specific beat genuinely needs
visual punctuation the audio can't give. Each kinetic moment earns its
place — once or twice per video max, never every beat.

---

## The "visual interest" baseline (Layer 1 motion)

Static cards and captions read as "AI-generated" because real video has
ambient motion (handheld breathing, lighting flicker, micro-camera drift).
We add that back via subtle motion HOCs that EVERY overlay can wrap:

```tsx
import { Wobble, Breathe } from "../../../agent/remotion/src/_motion";

// Wobble = small sinusoidal X/Y drift
<Wobble amplitudePx={2} periodSec={4}>
  <BrandLockup ... />
</Wobble>

// Breathe = subtle scale pulse
<Breathe scaleAmplitude={0.012} periodSec={5}>
  <CitationCard ... />
</Breathe>
```

**Defaults:**
- `Wobble`: 2-3px amplitude, 4-6s period. Slower than the eye notices, but
  the brain registers as "alive."
- `Breathe`: ±1.2% scale, 5-7s period. Even more subtle.

Use ONE per overlay (don't stack — looks intentional → looks animated).
Skip on text-heavy beats where the wobble would interfere with reading
(captions specifically; the caption track has its own micro-drift baked
into CaptionPage.tsx).

The HOCs are in `agent/remotion/src/_motion.tsx`. Same Wobble + Breathe
behavior is also baked into the global caption track — the global Layer 1
gives every video this baseline polish without per-job authoring.
