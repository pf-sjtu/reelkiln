---
name: analysis_video_level
description: Layer 5 (final) of deep_analyze_video. Whole-video summary — virality reasons, hook archetype, format, lighting, background, pacing breakdown, replication recipe. Receives all four prior layers' outputs as context.
returns: json
max_output_tokens: 8192
response_shape: |
  {
    "virality_reasons": [string, ...],
    "hook_summary": {
      "first_3_seconds": string,
      "hook_archetype": "skit | insider_confession | diagnostic_listicle | counter_establishment | transformation | story_as_confession | bold_claim | other",
      "hook_transcript": string
    },
    "format": {
      "video_type": "talking_head | voiceover | interview | montage | text_only | mixed",
      "duration_seconds": number,
      "cut_count": number,
      "average_shot_length_sec": number,
      "pacing_breakdown_pct": { "setup": number, "mechanism": number, "payoff": number }
    },
    "production_overall": {
      "lighting": string,
      "background": string,
      "background_load_bearing": boolean,
      "camera_distance_default": "close_up | medium | wide",
      "camera_motion_overall": string,
      "music_overall": string,
      "audio_bed_dynamics_overall": string
    },
    "replication": {
      "core_angle": string,
      "transferable_structure": string,
      "key_moments": [string, ...],
      "what_not_to_replicate": string,
      "production_recipe": string
    }
  }
---

You are writing the **whole-video summary** for this analysis. You
receive the video, the sentence anchor, and **all four prior layers'
annotations** (story_arc, shot, overlays, audio). Use them — this is
where everything gets synthesized.

## Field guidance

### `virality_reasons`
List 3-6 mechanical observations that explain *why this video earned
its watch-time*. Refer to specific sentence IDs and prior-layer
annotations. Examples:
- *"Hook (s0-s1) pairs a bold claim with an immediate sub-claim that
  creates an open loop ('it worked really well — but the reason is not
  seen to the untrained eye'). The loop_widener at s2 explicitly defers
  the reveal."*
- *"On-screen graphic overlays at s5-s9 (red crosshair grid + labeled
  arrows) provide visual proof that the framework being named is
  precise — the viewer sees the rules being applied."*

Stay observational. No taste calls (*"captivating hook"* / *"polished
edit"*). Anchor every reason to specific moments in the timeline.

### `hook_summary`
- `first_3_seconds`: brief description of what happens in the first 3
  seconds (visual + spoken).
- `hook_archetype`: pick from the enum.
- `hook_transcript`: the exact words spoken in the hook beat (s0-s1
  typically).

### `format`
- `video_type`: pick from enum.
- `duration_seconds`: actual video duration.
- `cut_count`: count cuts across the whole video using the shot layer's
  annotations as your source. A "cut" is a discontinuity (hard cut or
  match cut), not a smooth camera move.
- `average_shot_length_sec`: `duration_seconds / (cut_count + 1)`. Round
  to one decimal.
- `pacing_breakdown_pct`: estimate the % of runtime split between setup,
  mechanism, and payoff using the story_arc annotations. Should sum to
  ~100.

### `production_overall`
- `lighting`: key direction, softness, color temperature, any visible
  practicals.
- `background`: description of the set behind the speaker (or the
  primary backdrop for non-talking-head formats).
- `background_load_bearing`: is the background carrying credibility (a
  recognizable studio, a clinic, bookshelves with relevant titles)? Or
  is it interchangeable (blank wall, generic office)?
- `camera_distance_default`: the dominant framing across the video.
- `camera_motion_overall`: e.g. *"locked across the entire video, all
  variation comes from overlays"*, or *"slow continuous push-in"*.
- `music_overall`: high-level music presence summary.
- `audio_bed_dynamics_overall`: how the audio behaves under speech
  across the video.

### `replication`
This is the most-read section by the script-writing agent — make it
useful.

- `core_angle`: one sentence on the *idea* being executed (not the
  topic — the *idea*). E.g. *"Expert breakdown of an everyday artifact
  ('this works but you can't see why') with named-mechanism mid-video
  reveal."*
- `transferable_structure`: 2-3 sentences on the structural shape that
  could carry to a different topic. E.g. *"Open with the bold claim
  that something common is actually doing hidden professional work,
  loop-widen, name the framework, demonstrate it visually with overlay
  graphics, close on a 'and you thought it was just X' coda."*
- `key_moments`: 3-6 short bullets pointing to specific sentence IDs
  the agent should pay attention to. *"s2 — loop_widener anchors the
  whole video"*, *"s5-s9 — overlay graphics demonstrate the framework"*.
- `what_not_to_replicate`: MECHANICAL things that won't transfer (e.g.
  *"the reference uses a recognizable brand (Rhode) as its example —
  pick a brand-relevant equivalent for our IVP"*; *"the on-screen text
  uses a custom blue pill — Remotion's default works fine"*). NOT taste
  calls.
- `production_recipe`: 1-2 paragraph director's note. *"To recreate
  this format you'd want roughly N cuts, M B-roll inserts of [type], a
  [push-in / locked / handheld] camera approach, [lighting], [audio],
  [on-screen text treatment]."* This is the line the script-writer
  reads to decide whether to use B-roll, kinetic typography, multi-
  framing avatars, or straight talking-head.

## Hard rules

1. Anchor observations to sentence IDs whenever possible — don't write
   summaries that float free of the timeline.
2. Stay observational, not evaluative. No quality judgments.
3. The shape is a strict contract — don't add or rename fields.

Return a JSON object matching the shape declared in this template's
frontmatter.
