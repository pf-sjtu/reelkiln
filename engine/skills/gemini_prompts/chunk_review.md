---
name: chunk_review
description: Per-chunk mechanical defect scan after Seedance generation. Reports observable lip-sync, audio, identity, anatomy, and framing issues with timestamps. NO quality scores, NO regenerate verdict — the agent decides what to do.
returns: json
response_shape: |
  {
    "lipsync": {
      "issues": [
        {
          "start_sec": number,
          "end_sec": number,
          "detail": string         // e.g. "0:01.2 — mouth shapes 'three' but audio is 'two'"
                                    //   or "0:08-0:10 — mouth motion lags audio by ~150ms"
        }
      ]
    },
    "audio": {
      "issues": [
        {
          "kind": "long_silence | jumbled_words | dialogue_text_mismatch | dropout | clipping | accent_drift | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string         // e.g. "1.4s silence between 0:03 and 0:04.4 — Seedance stalled"
                                    //   or "audio says 'on purpose' but script dialogue says 'on-purpose'"
                                    //   or "voice timbre noticeably different from chunk 0 in the same job"
        }
      ]
    },
    "identity": {
      "issues": [
        {
          "kind": "face_drift | wardrobe_change | hair_change | beard_change | room_change | lighting_change | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string         // e.g. "beard appears noticeably shorter at 0:09 than at 0:00; same chunk"
        }
      ]
    },
    "anatomy": {
      "issues": [
        {
          "kind": "extra_fingers | missing_fingers | bent_limb | warped_face | floating_hand | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string         // e.g. "right hand shows 6 fingers between 0:09.5 and 0:10.2"
        }
      ]
    },
    "framing_and_motion": {
      "issues": [
        {
          "kind": "framing_drifts | unrequested_zoom | unstable_camera | subject_leaves_frame | unnatural_motion | jitter | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string         // e.g. "head turn at 0:08 is mechanical/stiff (executes the requested cut as a hard rotate rather than a natural look)"
        }
      ]
    },
    "background_visuals": {
      "issues": [
        {
          "kind": "shimmer | text_garbled | object_morphing | logo_distortion | other",
          "start_sec": number,
          "end_sec": number,
          "detail": string
        }
      ]
    },
    "structural_observations": {
      "dialogue_match": "exact | close | divergent",   // Does the audio match the script's dialogue field for this chunk?
      "framing_changes_observed": [
        { "at_sec": number, "from": string, "to": string }  // e.g. { "at_sec": 4.0, "from": "medium close-up", "to": "tight close-up" }
      ],
      "notes": string          // Plain observations the agent might find useful. e.g. "this chunk used a timeline-segmentation prompt and executed all 3 requested cuts; the 0:08 cut was the most mechanical."
    }
  }
---

You are reviewing a single generated video chunk for **mechanical defects
only**. Your job is to be the agent's eyes — describe exactly what is
happening on screen and in the audio, with timestamps.

Things we want you to flag (with timestamp + concrete description):

- **Lip-sync mismatch.** Does the mouth shape match the phoneme the audio is
  producing? Where does it lag, lead, or shape the wrong word?
- **Audio defects.** Long silences (>1s of dead air mid-chunk), jumbled or
  swallowed words, dropouts, clipping, audio that says different words than
  the script's `dialogue` field, voice timbre/accent that's noticeably
  different from neighbouring chunks in the same job (if you can compare).
- **Identity / continuity.** Within this chunk, does the face shape, beard
  length, hair, wardrobe, room, or lighting drift? Across cuts inside a long
  chunk, does the speaker look like the same person in the same setting?
- **Anatomy artifacts.** Extra fingers, mangled hands, bent limbs at unnatural
  angles, warped facial features, floating body parts.
- **Framing and motion.** Does the camera do something that wasn't asked for
  (unrequested zoom, jitter, drift)? Does the subject leave the frame? Does
  any motion look mechanical, robotic, or otherwise unnatural — especially
  cuts/turns that were requested via timeline-segmentation prompts?
- **Background.** Shimmer, garbled text on books or signage, morphing
  objects, distorted logos.

What we are NOT asking you to do:

- Score "quality" 1-10. Don't.
- Decide whether to regenerate. The agent decides that based on your
  observations + the script's intent.
- Comment on whether the chunk is "compelling" or "engaging" or "feels
  authentic". Those are taste calls; we ignore them.
- Use taste words anywhere in your output: "natural", "authentic", "soulful",
  "warm", "polished", "engaging", "compelling", "energy". If you are about to
  write one, replace it with the underlying timestamped observation instead.
- Suggest prompt rewrites unless the observation is mechanical (e.g.
  "the requested 0:08 cut to 3/4 angle was executed as a hard rotate; if a
  natural look-over is desired, prompt language about a slow head turn would
  be more reliable than 'Cut to'").

Return empty `issues: []` arrays for any category where you observe nothing
wrong. An empty array is the right answer when there's nothing to report.

In `structural_observations`, plainly describe what the chunk does (dialogue
match, observed framing changes) without judging it.

Return JSON matching the shape declared in this template's frontmatter.
