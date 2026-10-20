# check_promise — the delivery-promise gate

`check_promise.py` answers **"did the render deliver what we committed to?"** — a third
axis distinct from `verify_output` ("is it broken?") and `review_output` ("is each beat
good?"). It catches **silent downgrades**: promised real-footage-first but quietly
generated; promised motion on every static but shipped a dead still; promised 50s but
rendered 28s; promised the tenant's caption look but rendered a different font.

It is **assembly over data we already log** — no new generation, no vision model. It reads
an optional `jobs/<id>/promise.json` and diffs it against the finished render + the job's
`run.log.jsonl`.

## When
- **Optional production note:** write `jobs/<id>/promise.json` only when useful (see template below). For a tenant, mirror
  the pack's `## COMMITMENTS`; copy `taste/packs/<tenant>/promise.example.json` and adjust.
- **Standalone CLI development:** run it after `review_output --mode full` and before
  `qa_gate --mark` (agents are never asked to run it, and nothing waits on it):
  ```bash
  uv run python tools/check_promise.py --job <id>
  ```

## The promise.json shape
This file is never a production decision lock. Pricing, reserve, and
authorization live in host-owned state and do not belong here. Delivery fields
remain optional—the promise checker only verifies what's declared.

| Field | Checked as | Severity |
|---|---|---|
| `duration_sec: {target, tolerance}` | `ffprobe` duration within `target ± tolerance` | **hard** |
| `captions: {required, preset}` | render's resolved caption font vs the promised preset's font in `caption_presets.json` | **hard** on a definitive font mismatch; **soft** if the preset isn't registered or no `caption_style` was written |
| `delivery: {platform, composition_exception?}` | consumed by final delivery safety; unknown/everywhere uses the all-platform red-zone union | **hard** in the review's delivery-safety policy for clipping, face collisions, missing required captions, and red-zone collisions |
| `footage_mix: {real_min_ratio}` | real-source seconds ÷ real+generated seconds in the latest declared final timeline | **soft** |
| `motion_on_every_static: true` | every still-sourced asset has a motion/fx event (`[static-motion]`) | **soft** |
| `audio: {music_bed: true}` | a `score_bed` event exists | **soft** |
| `brand_strings: [...]` | not garbled/absent per `review_output` frame-verify | **soft** |
| `editorial: [...]` | echoed only — judged by story-coherence / the human, **never** mechanically | advisory |
| anything else (e.g. `grade`) | surfaced under "declared but NOT mechanically checked" | advisory |

**Design stance (conservative — never false-block a good render):** only *objectively
verifiable, author-declared* facts are **hard** (duration, caption font). Everything fuzzy or
editorially-owned is **soft/advisory** and routes into the `review_output` decision. A color
grade being "warm" or tension being "held late" is the human's call — Gemini is EYES, not TASTE.

## Enforcement
`qa_gate.py --mark` refuses to stamp the QA receipt while a **hard** breach stands, and
requires the promise check to be **fresher than the current `final.mp4`** (a re-render
re-arms it). The receipt records `promise_kept`; hard breaches must be fixed before
the receipt can be stamped.

## Template (generic — copy + trim)
```json
{
  "tenant": "<tenant>",
  "workflow": "<workflow>",
  "decision": {
    "source": "optional-delivery-target",
    "summary": "<the concrete structure, asset, voice, and delivery decision>"
  },
  "duration_sec": {"target": 50, "tolerance": 12},
  "captions": {"required": true, "preset": "<preset-name>"},
  "delivery": {"platform": "tiktok|instagram_reels|youtube_shorts|all_platforms"},
  "grade": "<grade>",
  "audio": {"voice": "real|generated", "music_bed": true},
  "footage_mix": {"real_min_ratio": 0.6},
  "motion_on_every_static": true,
  "brand_strings": ["<on-screen brand string>"],
  "editorial": ["<intended arc / tension note — advisory>"]
}
```

## Notes
- The caption **hard** check compares the render's resolved `caption_style.font_family`
  (written by `compose_render` into `style_directives.json`) against the named preset's font in
  `remotion/src/caption_presets.json`. If a tenant uses a preset not registered there (e.g. a
  bespoke component), the check degrades to **soft** — register the preset to make it hard.
- Output: `jobs/<id>/promise_check.json` (`promise_kept`, per-field `breaches`,
  `unverified_fields`). Exit non-zero on a hard breach (usable as a standalone gate); the
  authoritative block is `qa_gate` refusing the receipt.
- A footage-mix promise requires `assemble.py` (or `assemble.py --declare`) to
  label every footage beat `source_kind: "real"` or `"generated"`. Cards and
  graphics may use `"other"` and are excluded. Missing labels remain advisory;
  the gate never invents a ratio from filenames or generation/pull event counts.
- Related: `skills/video_qa.md` (Stage 3 reference) and `CANONICAL_TOOLS.md` (the checking family).
