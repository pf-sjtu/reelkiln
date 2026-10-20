---
name: analysis_shot
description: Layer 2 of deep_analyze_video. Annotate shot composition / camera placement / camera motion / speaker behavior at each sentence. Receives the story_arc layer's output as context.
returns: json
max_output_tokens: 16384
response_shape: |
  {
    "by_sentence": {
      "s0": [
        {
          "shot_composition": string,
          "camera_placement": string,
          "camera_motion": string,
          "speaker_behavior": string,
          "within_sentence_range": [number, number]
        }
      ]
    }
  }
---

You are annotating the **camera and physical-performance** layer of this
video. You receive the video, the sentence anchor, and the story_arc
annotations from the prior layer. Use the story arc to interpret what
the camera is doing at each moment (a slight push-in on a `loop_widener`
sentence is doing different work than a slight push-in on a `payoff`
sentence — the *kind* of push-in differs).

## Hard rule on multi-event sentences

A sentence can host **1 to 4 (or more) distinct shot events**. The
camera might cut, push in, then settle, all within one ~6-second
sentence. Each event is its own row with `within_sentence_range`
sub-timestamps. **Default to capturing every distinct camera event you
see — not "1 event per sentence."** If three things happen in 5 seconds,
that's three events. Don't average.

## Per-event fields

- **`shot_composition`** — framing tightness (extreme close-up /
  close-up / medium close-up / medium / wide), aspect ratio, headroom,
  where the subject sits in frame (centered, thirds-left, thirds-right).
  Note insets, picture-in-picture, cut-outs over B-roll.
- **`camera_placement`** — eye-level / low / high / over-the-shoulder /
  side-profile / 3/4 angle. Where is the imagined camera relative to
  the subject?
- **`camera_motion`** — locked-off / slow push-in / pull-back / handheld
  drift / dolly / pan / tilt / zoom. If locked, say *"locked, no
  motion."* Note speed and direction.
- **`speaker_behavior`** — eye contact (locked-on-camera / glancing /
  reading-off-screen), specific gestures (counting on fingers, framing
  hands, pointing to text, holding object), position changes within the
  shot, expression beats tied to specific words.
- **`within_sentence_range`** — required when a sentence has multiple
  events; absolute timestamps within the sentence's [start, end]. Omit
  when the sentence has a single event spanning its full duration.

## What to write

Concrete physical observation. Quote spoken words if a behavior is tied
to a specific word: *"on 'untrained eye' the eyebrows lift slightly."*

Use the story_arc layer to explain the *intent* of the camera in
`speaker_behavior` notes when relevant — e.g. *"on the loop_widener
('let me explain') the speaker raises a hand in a 'stop' gesture, then
brings it down precisely on the named mechanism."*

## Anti-patterns

- Don't invent camera moves. If you don't see a push-in, don't say
  there's a push-in. Mark `locked, no motion` rather than guess.
- Don't repeat the same row for every sentence. If the camera is genuinely
  unchanged across 4 sentences, say so concisely (*"continuation, locked
  MCU as in s3"*).
- Don't gloss multi-event sentences as a single average. Capture every
  distinct event.

## Hard rules

1. Use the sentence IDs from the anchor as keys.
2. Every sentence gets an entry (even if it's continuation).
3. Within-sentence timestamps must be within that sentence's [start, end]
   range from the anchor — no exceptions.

Return a JSON object matching the shape declared in this template's
frontmatter.
