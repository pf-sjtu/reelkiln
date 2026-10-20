---
name: analysis_overlays
description: Layer 3 of deep_analyze_video. Annotate every visual element added in post — captions, kinetic typography, hook headers, lower-thirds, callout pills, B-roll, illustrative graphics, transitions. Receives story_arc + shot annotations as context.
returns: json
max_output_tokens: 16384
response_shape: |
  {
    "by_sentence": {
      "s0": [
        {
          "type": "captions | hook_header | lower_third | callout_pill | kinetic_typography | b_roll | graphic | transition_effect | other",
          "content": string,
          "style": string,
          "position": string,
          "animation": string,
          "within_sentence_range": [number, number]
        }
      ]
    }
  }
---

You are annotating every **post-production visual element** layered onto
this video — anything that wasn't captured in-camera. You receive the
video, the sentence anchor, and the story_arc + shot annotations from
prior layers.

## Hard rule on multi-event sentences

A sentence can have **0 to 5+ overlay events**. A hook header fades out
while auto-captions continue underneath; a callout pill appears for a
beat; a B-roll graphic shifts. **Capture every distinct overlay event,
including appearances AND disappearances.** Each event is its own row
with `within_sentence_range` sub-timestamps. Default to thoroughness.

## Overlay types

- **`captions`** — auto-generated word-by-word transcription captions
  (TikTok / Instagram-style). Note styling, position, animation.
- **`hook_header`** — the prominent text overlay used at the start to
  reinforce the hook. Often a colored pill, larger font, animated in/out.
- **`lower_third`** — citation-style overlay (name, title, source,
  attribution) usually at the bottom of the frame.
- **`callout_pill`** — a brief popup labeling something on screen
  (a number, a name, a button, a key term).
- **`kinetic_typography`** — text-driven graphics where the typography
  IS the visual — bold words, color-shifts, motion.
- **`b_roll`** — non-speaker visuals: screen captures, photos, archival,
  illustrative graphics, props in frame, demo cutaways.
- **`graphic`** — overlaid annotations on existing footage: arrows,
  circles, crosshairs, grids, highlights, masks.
- **`transition_effect`** — visual transitions: whip-pans, glitches,
  match-cuts annotated with effects, blur reveals.
- **`other`** — anything else with a brief description.

## Per-event fields

- **`content`** — what the overlay actually shows (verbatim text, or
  brief description for non-text). E.g. *"This is what overthinking a
  simple idea looks like"* (for hook_header), *"red crosshair grid
  dividing image into 4 quadrants"* (for graphic).
- **`style`** — font weight, approximate color, size relative to frame,
  any styling cues (pill, outline, glow). E.g. *"blue pill background,
  white sans-serif text, ~5% of frame height."*
- **`position`** — where on screen (top / center / bottom / lower-third
  band / left third / behind speaker / etc.).
- **`animation`** — how it appears and disappears: *"fades in over 0.3s,
  holds, fades out as next overlay appears"*, *"hard cut on/off"*,
  *"slides up from bottom"*. If you can't see the animation clearly,
  write *"animation not visible"*.
- **`within_sentence_range`** — required when a sentence has multiple
  events; absolute timestamps within the sentence's [start, end].

## What to ignore

- **Don't list the speaker's body / clothing / face** — those are the
  shot layer's job, not overlays.
- **Don't list ambient background elements** (a bookshelf in the scene,
  natural lighting) — those are baked-in production, not post overlays.

## Hard rules

1. Use sentence IDs from the anchor as keys.
2. Every sentence gets an entry. If genuinely no overlays exist at a
   sentence (rare in modern social video — auto-captions are usually
   always on), use an empty array `[]` for that sentence.
3. Within-sentence timestamps must be within that sentence's [start,
   end] range from the anchor.
4. Capture appearance AND disappearance events when they're meaningful
   (a hook header that fades out at sentence X is itself an event at
   sentence X).

Return a JSON object matching the shape declared in this template's
frontmatter.
