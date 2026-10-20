---
name: analysis_audio
description: Layer 4 of deep_analyze_video. Annotate the audio bed — music presence, energy, ducking, swells, sound effects, voice dynamics — at each sentence. Receives story_arc + shot + overlays annotations as context.
returns: json
max_output_tokens: 16384
response_shape: |
  {
    "by_sentence": {
      "s0": [
        {
          "music_state": "none | low_bed | mid_bed | high_energy | swell | duck | drop | hit",
          "music_description": string,
          "voice_dynamics": string,
          "sound_effects": [string],
          "within_sentence_range": [number, number]
        }
      ]
    }
  }
---

You are annotating the **audio layer** — music bed, voice dynamics, and
sound effects — at each sentence. You receive the video, the sentence
anchor, and the story_arc + shot + overlays annotations from prior
layers.

## Hard rule on multi-event sentences

A sentence can have **1 to 4+ distinct audio events**. The music ducks
when speech starts, holds, then swells at the end of a sentence into the
next; a sound effect punches a transition mid-sentence. **Capture every
distinct audio event.** Each gets a row with `within_sentence_range`
sub-timestamps. Default to thoroughness.

## Per-event fields

- **`music_state`** — one of:
  - `none` — no music; voice only.
  - `low_bed` — quiet underbed, well below speaking voice.
  - `mid_bed` — present but not foreground.
  - `high_energy` — driving, foregrounded.
  - `swell` — building / rising in this window.
  - `duck` — actively pulled down for dialogue.
  - `drop` — silenced or near-silenced for emphasis.
  - `hit` — short stab/accent at this moment.
- **`music_description`** — brief description of the music itself if
  present: genre, instrumentation, tempo, mood. E.g. *"warm minimal
  piano, ~80 BPM, contemplative"* or *"trap hi-hat with sub-bass kick,
  ~140 BPM, energetic"*. Empty string if `music_state` is `none`.
- **`voice_dynamics`** — how the speaker is delivering: *"measured,
  deliberate"*, *"rapid-fire, excited"*, *"hushed, conspiratorial"*,
  *"emphasis-on-numbers, slight up-pitch on '66 days'"*, *"voice rises
  toward question intonation"*. Tied to specific words when relevant.
- **`sound_effects`** — array of any non-music SFX in this window:
  whoosh, ding, click, riser, impact, glitch, etc. Empty array if none.
- **`within_sentence_range`** — required when a sentence has multiple
  events.

## What to write

Tie audio observations to story_arc when relevant. *"On the
loop_widener ('let me explain') the music ducks slightly and the voice
slows — both signaling 'hold'."* That cross-layer reasoning is exactly
why story_arc was annotated first.

## Hard rules

1. Use sentence IDs from the anchor as keys.
2. Every sentence gets an entry.
3. Within-sentence timestamps must be within sentence boundaries from
   the anchor.
4. If the entire video has no music, every sentence's `music_state` is
   `none` and `music_description` is empty — that's the right answer.
   Don't invent music that isn't there.

Return a JSON object matching the shape declared in this template's
frontmatter.
