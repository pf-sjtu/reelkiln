---
name: final_review
description: Mechanical red-flag scan of the rendered final.mp4. Reports observable layout/legibility/audio defects with timestamps. NO taste judgment, NO scores, NO ship/no-ship verdict — those are the human's call.
returns: json
response_shape: |
  {
    "captions": {
      "issues": [
        {
          "kind": "unreadable_contrast | text_off_screen | text_clipped | text_overlap | mistimed_with_audio | wrong_word | missing_word | filler_word | caption_pace_slow | jitter | other",
          "start_sec": number,
          "end_sec": number,
          "text": string,         // The caption text affected (or "" if not applicable)
          "detail": string        // What you see, in concrete terms. e.g. "white caption on the off-white bookshelf BG between 0:14 and 0:16 — outline is too thin to separate"
        }
      ]
    },
    "overlays": {
      "issues": [
        {
          "kind": "covers_face | covers_subject | text_off_screen | text_clipped | red_zone_collision | unreadable_contrast | wrong_text | other",
          "overlay_kind": "hook | lower | url | other",
          "start_sec": number,
          "end_sec": number,
          "text": string,
          "detail": string        // e.g. "URL pill 'onpurpose.me' covers the speaker's chin from 0:23-0:27"
        }
      ]
    },
    "audio": {
      "voice_present": true | false,
      "music_bed_present": true | false,
      "vocals_in_bed_detected": true | false,
      "voice_band_collision_flags": ["string: any moment a bed instrument crowds the 250Hz-3kHz speech range, with timestamp", ...],
      "dead_air_flags": ["string: any silence > 1s mid-track, with timestamp range", ...],
      "clipping_or_dropout_flags": ["string: clipping/dropout with timestamp", ...],
      "bg_music_too_loud_flags": ["string: any moment the bed drowns the speech, with timestamp", ...],
      "engineer_flags": ["string: any other technical audio defect", ...],
      "issues": [
        {
          "kind": "missing_required_narration | unintelligible_required_narration | long_silence | jumbled_words | dialogue_audio_mismatch | dropout | clipping | bg_music_too_loud | beat_sync_mismatch | other",
          "intentional": boolean, // For the two required-narration kinds: false only when declared speech is genuinely missing/unintelligible, not a planned pause.
          "start_sec": number,
          "end_sec": number,
          "detail": string        // e.g. "2.1s of silence between 0:08 and 0:10.1 — feels like a stall"
                                   //   or "audio says 'three' but the script's chunk 1 dialogue says 'two'"
        }
      ]
    },
    "lipsync": {
      "issues": [
        {
          "start_sec": number,
          "end_sec": number,
          "detail": string        // e.g. "0:11 — mouth shapes 'framework' but audio is one syllable behind; ~120ms lag"
        }
      ]
    },
    "visual_anomalies": {
      "issues": [
        {
          "kind": "unexpected_black | unexpected_freeze | unwatchable_video | deformed_anatomy | extra_fingers | identity_drift | framing_collapse | framing_jump | unnecessary_camera_padding | off_center_card | subject_clipped | subject_off_center | face_obscured | wardrobe_change | lighting_shift | background_glitch | broll_context_mismatch | broll_era_mismatch | broll_emotion_mismatch | broll_subject_off_center | other",
          "intentional": boolean, // For black/frozen/unwatchable content: false only when it contradicts declared intent.
          "start_sec": number,
          "end_sec": number,
          "detail": string        // e.g. "right hand has 6 fingers visible from 0:09-0:10"
                                   //   or "speaker's beard length changes between chunk 0 (0:00-0:14) and chunk 1 (0:14-0:28)"
        }
      ]
    },
    "transition_anomalies": {
      "issues": [
        {
          "kind": "leftover_element | half_transition | seam_flash | continuity_break | body_crop | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string
        }
      ]
    },
    "style_consistency": {
      "issues": [
        {
          "kind": "font_mismatch | color_mismatch | placement_mismatch | overlay_system_mismatch | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string
        }
      ]
    },
    "story_coherence": {
      "issues": [
        {
          "kind": "missing_beat | unmotivated_action | causal_gap | payoff_too_early | absent_payoff | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string
        }
      ]
    },
    "structural_observations": {
      "hook_lands_at_sec": number | null,        // Timestamp where the verbal/visual hook actually lands. Null if you can't identify a hook.
      "cta_lands_at_sec": number | null,         // Timestamp where the CTA appears (verbal or visual). Null if absent.
      "cut_points_observed": [number, ...],      // Timestamps where you observed an actual cut/framing change (not requested cuts).
      "reference_match_notes": string            // Plain-language description of how the structure compares to the reference. NOT a score — just observations. e.g. "The reference's hook lands at 0:00.5 with a full-frame text card. Ours lands at 0:01 with a verbal hook + smaller text overlay. Different mechanics, similar structural function."
    }
  }
---

You are reviewing a rendered video for **mechanical, observable defects** —
the kind a human catches in a 5-second skim and that no one wants in a
shipped video. Examples of what we want you to catch:

This is a draft-first review. Report ordinary defects as observations; do not
invent blockers from taste, framing, caption pace, or a missing music bed.
Reserve `unexpected_black` and `unexpected_freeze` for sustained broken picture
that prevents understanding the video. Other apparent unusable picture may be
reported as `unwatchable_video`, but remains advisory without exact-source
verification; the compressed review copy cannot establish that defect. Reserve
`missing_required_narration` and `unintelligible_required_narration` for sustained
loss of speech explicitly required by the supplied script. Include the exact
start/end times and `intentional: false`. A sustained defect lasts at least
3 seconds, or at least a quarter of a shorter video with a minimum of 1 second.
Intentional stills, title cards, black transitions/endings, dramatic pauses,
music-only work, and intentional silence are not these defects. If intent is
unclear, use an ordinary observation instead of a severe kind.

You see a compressed, possibly low-frame-rate review copy. Compression blur,
sampled motion, and judder in that copy are not confirmed source defects. Do not
label them severe. Exact source checks separately verify visual candidates.

- Captions that are unreadable: low contrast against the background, font too
  small to read at thumb-scrolling speed, off the screen, clipped, overlapping
  another overlay, jittery animation, mistimed with the audio, missing spoken
  words, or retaining obvious ums/ahs that should have been removed. Treat a
  sustained caption pace below the current launch default of about 3.7 visible
  words per second (222 WPM) as an advisory `caption_pace_slow` observation,
  not a delivery blocker by itself.
- Text overlays (hook pill, URL pill, lower-third citation) that:
  cover the speaker's face or other important visual content, sit outside the
  safe area / red zone (you'll see typical platform UI bars at the very top
  and very bottom of vertical video), or display the wrong text.
- Audio defects: long silences (>1s of dead air mid-video), jumbled or
  swallowed words, dialogue that doesn't match what's in the script, clipping
  or dropout, background music that drowns the speech. When the job context
  declares supplied music/onsets, report obvious title, caption, or cut timing
  that misses those beats as `beat_sync_mismatch`. Also complete every technical
  audio field in the response shape. Those fields are the audio evidence for
  this same one-pass review; do not omit them when their value is false or empty.
- Lip-sync drift, with timestamp.
- Visible AI artifacts: deformed hands, extra fingers, identity changes
  between chunks (face shape, hair length, beard density, wardrobe shifting),
  background glitches, lighting that jumps between cuts.
- B-roll mistakes when the job context makes the intended beat clear: footage
  that contradicts the script subject, era, or emotion; the wrong segment of
  otherwise relevant footage; or the beat's protagonist visibly framed away
  from the center. Use the dedicated `broll_*` kinds. Do not invent a mismatch
  when the script/beat intent is absent.
- Framing defects throughout the entire frame, not only at cuts: any text,
  character, face, or primary subject touching/crossing a frame edge; a primary
  subject drifting outside the centered mobile-safe area; any face hidden by
  another object, crop, caption, or overlay. Decorative edge crops do not excuse
  clipping when the cropped item carries text, a face, a character, or the beat's
  subject.
- Camera-footage framing defects: an already-correct vertical talking head shrunk
  into a floating card; ordinary camera footage placed over blur/padding without an
  explicit full-frame need; a visible footage rectangle positioned off center; or
  the same continuous shot jumping in crop center, scale, or inset at an edit. Screen
  recordings are different: a stable, geometrically centered inset is valid when it
  protects readable interface content near edges or platform UI. Report double-padding
  or card geometry that changes during one continuous screen section.
- Platform red-zone violations on every beat and end card. Unless the job
  declares one destination, use the all-platform union. For a 1080×1920
  vertical frame the union is: top y=0–220; right action rail x=920–1080 from
  y=540–1720; and bottom y=1620–1920. Scale those bounds proportionally for
  other resolutions. Report
  any caption, readable text, face, or primary subject entering those zones as
  a concrete issue even when the placement looks intentional or attractive.
  Captions must never overlap a face, even when both elements remain technically
  inside the canvas.
- Transition defects at every visible cut: half-gone or leftover elements,
  seam flashes, continuity breaks, and overlays/body parts chopped at the cut.
- Internal style mismatches between captions, overlays, and cards (font
  character, weight, color, and placement), plus any concrete mismatch against
  the supplied style directives.
- When an intended script/beat arc is supplied, missing or unmotivated beats,
  causal gaps, a payoff released before the intended turn, or an absent payoff.
  Report observable timing/sequence evidence, not whether the story is engaging.

You are NOT being asked to:

- Rate "publishability", "authority", "energy", "polish", or any other quality
  dimension. Those are taste calls and we explicitly do not want them.
- Use taste words anywhere in your output: "natural", "authentic", "soulful",
  "warm", "polished", "publishable", "engaging", "compelling", "energy",
  "authority". If you are about to write one, replace it with the underlying
  timestamped observation instead.
- Suggest improvements, rewrites, or "what would make this better".
- Score anything 1-10. We don't use scores anymore.
- Issue a `ship | revise | rebuild` verdict. The human decides that.

Just report what you see, with timestamps and concrete language. If you
notice nothing wrong in a category, return an empty `issues` array — that
is a meaningful answer.

Do not infer a clean frame merely because the central subject is visible. Scan
all four edges and every face-bearing element before returning empty framing,
overlay, or transition issue lists.

Watch the entire video, including every cut boundary. The appended job context
is evidence about intended words, beat order, and style—not permission to invent
a defect. If context is absent, leave the relevant issue list empty.

For `structural_observations`, plainly describe how the rendered video
compares to the reference outlier in terms of mechanics (hook timestamp,
cut count, caption style, CTA placement). Again — observations, not
judgments. The agent reading your report will decide what to do.

Return JSON matching the shape declared in this template's frontmatter.
