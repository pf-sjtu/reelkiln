# check_layout — pre-render gate for layout correctness

One tool, `--role {collision|anchors|luma}` (or `--role all` to run every check in sequence).
Gates the visual plan before Remotion renders — catches face/caption collision, validates
`findWord`/`findRange` overlay anchors against the word-timed transcript, and finds
caption-safe luminance regions on B-roll so captions don't disappear into a bright sky.
Folds in: `preflight.py` (4 calls, 3 sessions — face/caption collision guard),
`check_overlay_anchors.py` (7 calls, 5 sessions — caught real `findWord` offset bugs in the
wild), `darkspace.py` (3 calls, 1 session — luminance-bbox finder, currently MISSING from repo,
session 91e277d3), and `sample_caption_luma.py` (4 calls, 1 session, `agent/josephchin/tools/`
— sibling luminance sampler). The question this tool answers: "will it render correctly?"

```
check_layout --job <job> --role <role> \
             [--transcript <word_timed.json>] \
             [--overlays <overlays.tsx>] \
             [--frame <png>]           \
             [--threshold <0-255>]
```

`--role` is **required** and logged as `usage_role`. `--job` is always required (MEMORY:
concurrent jobs clobber `.current_job`; every pipeline tool must pass `--job` explicitly).

---

## `collision` — face/caption guard (preflight)

Declared text cards are checked against caption timing as well. `chunk_boundaries.json` from `assemble --declare` or assembly must identify the card's final `start_sec`, `end_sec`, and `role: "card"`, `"title_card"`, or `"text_card"`. If a caption page derived from `transcript.json` crosses that beat, the checker reports `card_caption_overlap`; `--strict` returns nonzero. The check uses the shared caption page scheduler, including preset timing and pages held after a word ends. This is a timing warning, not OCR or a measured spatial collision. It cannot discover undeclared text baked into arbitrary footage.

For an opening card spanning 0–2 seconds, set `"caption_style": {"hide_ranges_ms": [[0, 2000]]}` in `style_directives.json`. Both renderers hide captions during this interval without moving the narration. Keep any existing hide ranges. The collision check accepts adjacent or overlapping ranges that cover the card, and captions can resume exactly when it ends. Check the same directives you intend to render; a render-only `--hide_ranges` override is not visible to this standalone checker.

- **purpose:** detect whether caption text will land on the speaker's face — the layout blocker
  that burns the most regens when caught after render.
- **use_when:** any time a caption or title overlay is placed near the face region — run before
  every `compose_render` call, especially on talking-head beats.
- **do_not_use_when:** pure B-roll beats with no face present (skip to `luma` instead).
- **inputs:** `--job` + `--frame <png>` (a representative frame, or omit to let the tool pull
  the first frame from the job's `04_final` video).
- **success_check:** tool reports no collision zone; caption safe-margin confirmed above the
  chin line.
- **backend:** `preflight.py` (face-detect + bounding-box vs caption rect). 4 calls, 3 sessions.
- **fallback:** if face-detect returns no face (pure B-roll, graphic card), pass — no collision
  possible; proceed.
- **evidence:** `preflight.py` ✅ keep — "top-level layout guard, no blockers" (super_tools.md §1).

---

## `anchors` — overlay anchor validity (findWord / findRange)

- **purpose:** validate every `findWord(...)` and `findRange(...)` call in `overlays.tsx` against
  the word-timed transcript — checks that the target word exists, that the resolved frame index
  is within clip bounds, and that offset math won't under/overshoot.
- **use_when:** whenever `overlays.tsx` contains `findWord`/`findRange` calls — run after every
  overlay edit, before `compose_render`.
- **do_not_use_when:** overlays use only hard-coded frame indices with no word-find calls.
- **inputs:** `--job` + `--transcript <word_timed.json>` + `--overlays <overlays.tsx>` (defaults
  to the job's canonical paths if omitted).
- **success_check:** every anchor resolves to a valid frame index; no "word not found" warnings;
  all offsets within clip duration.
- **backend:** `check_overlay_anchors.py`. 7 calls, 5 sessions. "Caught real findWord offset
  bugs" — super_tools.md §1.
- **fallback:** on a failed anchor, surface the bad word string + nearest transcript match so the
  author can correct the string or switch to a frame-index fallback.
- **evidence:** `check_overlay_anchors.py` ✅ useful — session-proven, zero false negatives on
  the offset bugs it caught.

---

## `luma` — caption-safe luminance region on B-roll

- **purpose:** scan a B-roll frame for a dark-enough region (below `--threshold`, default 80)
  where caption text will be legible without a scrim — returns a bbox + recommended caption
  `top` offset.
- **use_when:** placing captions on B-roll where the background brightness is unknown; call
  before committing caption `y` position in `style_directives.json`.
- **do_not_use_when:** the frame is a dark studio talking-head (assume safe) or a full-bleed
  graphic card (caption placement is part of the card design, not this tool's job).
- **inputs:** `--job` + `--frame <png>` (the specific B-roll frame to probe) + optional
  `--threshold <0-255>` (lower = stricter).
- **success_check:** tool returns a luminance-safe bbox and a concrete `top` value; if no region
  qualifies, it reports "no safe region — add scrim" so the author can add a gradient overlay
  in `compose_render`.
- **backend:** `darkspace.py` (luminance-bbox, MISSING from repo — recover from session
  91e277d3) + `sample_caption_luma.py` (`agent/josephchin/tools/`, 4 calls, in repo). Until
  `darkspace.py` is recovered, `sample_caption_luma.py` handles luma sampling.
- **fallback:** if neither backend is available, frame-extract the B-roll beat → Read the PNG →
  eyeball the dark region; record the chosen `top` value manually.
- **evidence:** `darkspace.py` P0 recover (super_tools.md §7); `sample_caption_luma.py` ✅ keep
  + reconcile (super_tools.md §7, session 91e277d3).

---

## NOT this tool

- **`check_script`** — gates word-budget, WPM, and pacing *before generation*. Layout hasn't
  been authored yet at that stage. `check_layout` runs *after* the overlay/caption plan exists,
  *before* `compose_render`.
- **`verify_output`** — post-render mechanical check (broken frames, black frames, audio
  present). `check_layout` is a *pre-render* prediction; `verify_output` is *post-render*
  confirmation. They are complementary, not alternatives.
- **`script_preflight.py`** — the old name for `check_script`'s backend; not this tool (despite
  sharing "preflight" in the name — `preflight.py` is the face-collision backend folded into
  `check_layout --role collision`).
- **`compose_render`** — the Remotion compositor that *executes* the render. `check_layout` must
  pass before `compose_render` is called, not after.
