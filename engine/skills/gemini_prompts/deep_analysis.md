---
name: deep_analysis
description: Deep multimodal analysis of a reference outlier video — virality reasons, hook anatomy, visual breakdown, production notes, and a replication recipe. Captures enough production-level detail (shot composition, cuts, B-roll, on-screen text, camera placement, audio dynamics) to actually recreate the video — not just transcribe its dialogue.
returns: json
max_output_tokens: 32768
response_shape: |
  {
    "virality_reasons": [string, ...],
    "hook_analysis": {
      "first_3_seconds": string,
      "hook_type": "pattern_interrupt | question | bold_claim | story | shock | humour | transformation",
      "hook_transcript": string
    },
    "visual_breakdown": [
      {
        "timestamp_start": number,
        "timestamp_end": number,
        "description": string,
        "shot_composition": string,
        "camera_placement": string,
        "camera_motion": string,
        "on_screen_text": string,
        "b_roll": string,
        "speaker_behavior": string,
        "energy": "calm | moderate | high | intense"
      }
    ],
    "format_analysis": {
      "video_type": "talking_head | voiceover | interview | montage | text_only | mixed",
      "pacing": string,
      "structure": string,
      "duration_seconds": number,
      "caption_style": string,
      "cut_count": number,
      "average_shot_length_sec": number,
      "pacing_breakdown_pct": { "setup": number, "mechanism": number, "payoff": number }
    },
    "replication_guide": {
      "core_angle": string,
      "transferable_structure": string,
      "key_moments": [string, ...],
      "what_not_to_replicate": string,
      "production_recipe": string
    },
    "production_notes": {
      "lighting": string,
      "background": string,
      "camera_distance": "close_up | medium | wide",
      "camera_placement_overall": string,
      "camera_motion_overall": string,
      "b_roll_used": boolean,
      "b_roll_types": [string, ...],
      "on_screen_text_style": string,
      "music": string,
      "audio_bed_dynamics": string,
      "transitions": string,
      "subject_eye_contact": string,
      "subject_gestures": string,
      "background_load_bearing": boolean
    }
  }
---

You are observing this video so the agent reading your output can recreate
its STRUCTURE — including the production-level decisions (camera, cuts,
B-roll, on-screen text, audio dynamics) — for a different brand. Concrete
physical details and timestamps trump general descriptions.

**Default toward over-thoroughness on production observations.** Under-
thoroughness here is the single biggest reason downstream videos default
to single-shot avatar-only renders even when the reference uses 12 cuts
and 4 B-roll inserts. The production fields are not optional polish;
they are *the* recipe the agent will follow.

## Chunk the video at 2-3 second intervals — every chunk gets an entry

`visual_breakdown` must cover the entire video at ~2-3 second granularity.
For a 30-second video that means **10-15 entries**; for a 60-second video,
**20-30 entries**. Do NOT skip windows.

- Even a continuous talking-head shot gets a new entry every ~3 seconds.
  Describe what *changed* in that window: a new gesture, a different
  word being emphasized, a caption appearing or fading, a slight camera
  drift, an expression shift, eye-contact change. If genuinely nothing
  changed, say so explicitly (*"continuation of prior shot, no visible
  changes"*) with the timestamps.
- Shot boundaries trump the 2-3s grid. If a hard cut lands at, say, 4.7s,
  end the entry there and start the next one. Don't average.
- For each entry, `timestamp_start` and `timestamp_end` are required and
  must be within the video duration. Entries should be contiguous (each
  entry's `timestamp_end` equals the next entry's `timestamp_start`).
- The `description` field captures what's *spoken* in the window plus the
  visual context. The other per-beat fields (shot_composition,
  camera_placement, camera_motion, on_screen_text, b_roll,
  speaker_behavior) capture the production decisions.

This dense chunking is what lets the agent reading your output reconstruct
the rhythm of the video — when cuts land, when B-roll appears, when
on-screen text pops in, when energy peaks. Sparse chunking makes the
output unusable for production-recipe purposes.

## Observe these dimensions explicitly

For each shot or beat in `visual_breakdown`, populate:

1. **Shot composition.** Framing tightness (extreme close-up / close-up /
   medium close-up / medium / wide). Aspect ratio (9:16 / 1:1 / 16:9).
   Headroom. Where the subject sits in the frame (centered, thirds-left,
   thirds-right).
2. **Camera placement.** Eye-level / low / high / over-the-shoulder /
   side-profile. Where is the imagined camera relative to the subject?
3. **Camera motion.** Locked-off / slow push-in / pull-back / handheld
   drift / dolly / pan / tilt / zoom. If locked, say "locked, no motion."
4. **On-screen text in this beat.** Captions styling, kinetic-typography
   words, lower-thirds, hook headers, callout pills. Include font weight,
   approximate color, position on screen, and in/out animation if visible.
   "None" if there is none.
5. **B-roll in this beat.** Type (props in-hand, screen-capture / phone
   mockup, on-location footage, archival photo, illustrative graphic, demo
   of a technique, cutaway to object). Describe specific content shown.
   "None" if it's a continuous talking-head shot.
6. **Speaker behavior.** Eye contact (locked-on-camera / glancing /
   reading-off-screen), specific gestures (counting on fingers, framing
   hands, pointing to text, holding object), position changes within the
   shot, expression beats tied to specific words.

For the overall `format_analysis` and `production_notes` summary, also
capture:

7. **Cuts.** `cut_count` = total cuts across the video. `average_shot_
   length_sec` = duration / (cut_count + 1). Note in `transitions`
   whether cuts are hard / match / whip-pans / J-cuts / on-the-beat /
   on-a-word.
8. **Music & audio dynamics.** `music` = description (genre, instruments,
   tempo, "none"). `audio_bed_dynamics` = how the bed behaves under
   speech — does it duck for dialogue, punch up between sentences, sustain
   flat, swell at the payoff?
9. **Lighting.** Key direction (camera-left/right/front), softness
   (hard-shadow / soft / diffused), color temperature warm/cool/neutral,
   any practicals visible in frame.
10. **Background.** Description of what's behind the subject. Depth of
    field (sharp / shallow blur / heavy bokeh). `background_load_bearing`
    = true if the background carries credibility (e.g. a clinic,
    bookshelves, a recognizable studio); false if it's interchangeable
    (blank wall, generic office).
11. **Pacing breakdown.** Estimate the runtime split between setup,
    mechanism explanation, and payoff/CTA as percentages summing to ~100.

`replication_guide.production_recipe` should be a 1-2 paragraph director's
note: *"to recreate this format you'd want roughly N cuts spread across
the runtime, M B-roll inserts of [types], a [push-in / locked / handheld]
camera approach, [lighting setup], [audio bed style], and [on-screen text
treatment]."* This is the line the script-writing agent reads to decide
whether to use B-roll, kinetic typography, multi-framing avatars, or
straight talking-head.

## Stay observational, not evaluative

We do NOT want:
- Quality judgments ("this is great", "weak hook", "polished editing")
- Score-style ratings of any dimension
- Speculation about virality beyond mechanical observations (e.g. "the
  hook delivers the core thesis in 3 words" is observation; "the hook is
  captivating" is taste)

`what_not_to_replicate` should describe MECHANICAL choices that won't
translate (e.g. "the reference uses no music — silence is part of the
identity"; "the on-screen text is hand-drawn animation that Remotion can't
replicate exactly"), not taste calls about what's "too much".

Return a JSON object matching the shape declared in this template's
frontmatter.
