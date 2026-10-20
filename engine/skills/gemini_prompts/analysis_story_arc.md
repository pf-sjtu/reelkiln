---
name: analysis_story_arc
description: Layer 1 of deep_analyze_video. Annotate the narrative function of each sentence — hook / setup / mechanism / loop-widener / pivot / reveal / payoff / lore-beat / CTA. Grounds every supporting layer (shot, overlays, audio) in the same temporal grid. THE most important layer pass — get this right and the rest line up; get this wrong and the supporting layers lose their reference frame.
returns: json
max_output_tokens: 16384
response_shape: |
  {
    "by_sentence": {
      "s0": [
        {
          "function": "hook | hook_close | setup | mechanism | loop_widener | direction_change | proof | reveal | payoff | lore_beat | call_back | transition | cta | continuation",
          "subtype": string,
          "notes": string,
          "within_sentence_range": [number, number]
        }
      ],
      "s1": [ ... ]
    }
  }
---

You are annotating the **narrative function** of each sentence in this
video. This is the foundational layer — every later layer (shots,
overlays, audio) will be told what the story arc is doing at each moment
and will annotate against it. **Get this layer right.**

You receive the video itself plus a sentence anchor — a sentence-by-
sentence timeline derived from real word-level transcription (ElevenLabs
Scribe v2). The sentence IDs and timestamps are GROUND TRUTH. Use them as
your temporal scaffolding. Do not invent sentences. Do not annotate
timestamps outside the anchor range.

## Your task

For every sentence ID in the anchor, return an array of one or more
**story-arc events**. Each event is one of the following functions.
A single sentence can host multiple functions (e.g. a hook that pivots
into a loop-widener mid-sentence). When that happens, return multiple
events with `within_sentence_range` sub-timestamps.

## Function taxonomy (use exactly these names)

- **`hook`** — the opening beat that earns the viewer's attention. Pair
  with a `subtype`: one of `skit`, `insider_confession`,
  `diagnostic_listicle`, `counter_establishment`, `transformation`,
  `story_as_confession`, `bold_claim`, `pattern_interrupt`, `question`,
  `humour`, `shock`. Multiple sub-archetypes are allowed if the hook
  blends them.
- **`hook_close`** — the closing beat of the hook before the next pivot.
  Often where the viewer commits to staying.
- **`setup`** — establishes topic, names the IVP, anchors stakes,
  introduces a metaphor, or names a mechanism by name.
- **`mechanism`** — the how / why / explanation — the substantive
  middle of the video. Lectures, diagrams, walk-throughs, evidence.
- **`loop_widener`** — explicit *hold-the-reveal* moves: *"…let me
  explain"*, *"…here's where it gets wild"*, *"…stick with me, this is
  the whole thing"*, trailing-ellipsis-with-pause, *"and the answer
  surprised me too"*. Subtype = the specific phrase form.
- **`direction_change`** — pivot beats that re-orient the viewer:
  claim→confession, mechanism→application, tactic→meta, story→principle,
  principle→story. Subtype = the specific pivot form.
- **`proof`** — specific evidence: numbers, quoted dialogue, named
  characters/institutions/research, dollar receipts, sensory details.
  This is what makes the reveal land.
- **`reveal`** — the answer the viewer was waiting for. The AHA.
- **`payoff`** — emotional landing OR actionable takeaway. Often
  immediately follows the reveal.
- **`lore_beat`** — brand-positioning carry: weighted descriptors of what
  a company / system / person *does* or *stands for*, designed to make
  the viewer wonder *"who are these guys?"* (e.g. *"meticulously
  installs one pattern at a time"*, *"two weeks just mapping your
  current OS"*). Often where a brand name drops.
- **`call_back`** — explicit return to an earlier setup or loop opened
  earlier in the video.
- **`transition`** — short connector beats. Glue between sections.
- **`cta`** — call to action: *"comment X"*, *"save this"*, *"link in
  bio"*, *"send this to..."*, etc.
- **`continuation`** — fallback. Use ONLY when a sentence is genuinely
  just a continuation of the prior beat with no distinct narrative
  function of its own. Do not over-use.

## What to capture in `notes`

One or two sentences explaining *why* this sentence does what it does.
Quote a phrase if it's load-bearing. Examples:
- *"Bold claim ('this is what overthinking a simple idea looks like')
  paired with a sub-claim ('and it worked really well') that creates
  curiosity about how."*
- *"'But the reason why is not seen to the untrained eye' — classic
  loop-widener. Promises a reveal AND tells the viewer they don't
  currently have the framework, building anticipation."*
- *"Pivot from theory ('this skill set is called Art Direction') to
  named mechanism — moves the video from setup to mechanism."*

Concrete and observable. Avoid taste calls (*"great hook"*, *"stunning
reveal"*).

## Multiple events in one sentence

If a sentence does two distinct things, return two events with
`within_sentence_range`:

```json
"s4": [
  {"function": "mechanism", "notes": "names the framework", "within_sentence_range": [11.9, 13.4]},
  {"function": "direction_change", "subtype": "theory_to_application",
   "notes": "pivots from naming the skill to demonstrating it",
   "within_sentence_range": [13.4, 14.5]}
]
```

For sentences with only one event, omit `within_sentence_range`.

## Hard rules

1. **Use the sentence IDs from the anchor as keys.** Do not invent IDs.
   Do not skip sentences. Every sentence ID gets an entry, even if it's
   `continuation`.
2. **Timestamps must be within sentence boundaries.** A sentence with
   `start: 4.8, end: 9.4` cannot have an event at 11.0.
3. **Use the function names exactly as listed.** Don't invent new
   function names. If you need to express a concept that doesn't fit,
   use the closest function and explain in `notes`.

Return a JSON object matching the shape declared in this template's
frontmatter.
