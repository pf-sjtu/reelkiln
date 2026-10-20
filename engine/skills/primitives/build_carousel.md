# build_carousel — generate and render a multi-slide carousel image post

One tool, two flavours: **tooled two-pass** (mint illustrations then lay out) and **one-shot
reference-matched** (single `mint_image --reference` call per slide). Folds in
`layout_carousel.py` (14 calls, 2 sessions, session `97b42d64`),
`mint_carousel_illustrations.py` (12 calls, 2 sessions), and `render_carousel.py` (1 call).
Also absorbs the one-off `layout_alissa_carousel.py` + `mint_alissa_carousel.py` (1 call
each — ❌ dropped as variants). Flow: optionally preview ONE proof slide →
batch remaining slides (`--workers 3`, rate-limited) → review
inline → regen 1–2 misses. Typography and body copy are **baked into the image** by
gpt-image-2; there is no Remotion layer. MEMORY friction to watch: unzip operations on
job assets must use absolute paths (call 1 sets cwd; subsequent calls drift — use
`--job`-derived absolute paths throughout, per MEMORY rule "always pass --job to
agent/tools/*").

```
build_carousel --job <job> --mode <mode> \
               --slides <n> --concept "..." \
               [--reference <png|url>] \
               [--style-proof] \
               [--workers 3] \
               [--regen <slide_indices>] \
               [--style <preset|style.json>]   # layout look; default coaching_gems
```

`--mode` is **required** and logged as `usage_role`. `--job` is always passed (only
`pick_company.py` is exempt). Evidence: 27 total carousel calls across 2 sessions;
`layout_carousel.py` is CANON for layout (`_archaeology/super_tools.md` §6).

---

## `two_pass` — generate illustrations then lay out (the standard path)

- **purpose:** produce a cohesive illustration set first, then flow each illustration into
  a branded page layout with baked typography — body copy, headlines, and slide numbers
  all rendered by gpt-image-2 in the layout pass.
- **use_when:** the carousel has distinct per-slide art (not a single reference image that
  tiles across slides); you want illustration style locked before layout begins.
- **do_not_use_when:** you have a reference image that defines the visual style and want
  all slides matched to it → use `reference_matched`; or the deliverable is a single card
  → `mint_image --role card`.
- **inputs:** `--job`, `--mode two_pass`, `--slides <n>`, `--concept "..."`. Optionally
  `--reference` for style anchoring during illustration gen.
- **flow:**
  1. `--style-proof` optionally generates slide 1 only for a cheap mechanical
     preview; it never creates a human-approval checkpoint.
  2. Batch generates remaining illustrations (`mint_carousel_illustrations.py` under the
     hood, `--workers 3` to stay within the gateway's sustainable concurrency).
  3. Layout pass (`layout_carousel.py`) composites illustration + baked type per slide.
  4. `render_carousel.py` assembles final slide PNGs.
- **success_check:** Read each slide PNG; verify: (a) text glyphs are legible — garbled
  type is the #1 gpt-image-2 failure mode; (b) illustration style is consistent across
  slides; (c) slide count matches `--slides`.
- **backend / fallback:** gpt-image-2 through the gateway/Fal. On garbled text: regen the
  offending slides with `--regen <indices>`; if text consistently garbles, move body copy
  to a post-render Remotion overlay layer instead of baking.
- **evidence:** `layout_carousel.py` 14 calls (session `97b42d64`);
  `mint_carousel_illustrations.py` 12 calls (2 sessions).

---

## `reference_matched` — one-shot style-matched slides

- **purpose:** generate each slide in a single `mint_image --reference` pass so every
  slide inherits the exact visual style, palette, and composition of a supplied reference
  image. No separate illustration step.
- **use_when:** a reference PNG (brand asset, competitor example, or approved proof)
  fully defines the target look and you want slides matched to it in one pass.
- **do_not_use_when:** slides need distinct, per-beat illustration art (→ `two_pass`);
  or the reference is a video frame → extract a still first with `verify_output` /
  `pull_video`.
- **inputs:** `--job`, `--mode reference_matched`, `--slides <n>`, `--concept "..."`,
  `--reference <png|url>` (required for this mode).
- **flow:**
  1. `--style-proof` optionally generates slide 1 conditioned on the reference
     for a cheap match-quality preview; production may continue without approval.
  2. Batch generates remaining slides (`--workers 3`).
  3. No separate layout pass — type is baked in the generation call.
- **success_check:** same as `two_pass`; additionally verify style fidelity matches the
  reference (palette, stroke weight, composition language).
- **backend / fallback:** gpt-image-2 `--reference` conditioning. On style drift: tighten
  the prompt's style descriptor or re-submit with a cropped reference that isolates the
  target element.
- **evidence:** `mint_carousel_illustrations.py` reference-mode invocations;
  `generate_image.py` `--reference` param established in `mint_image` contract.

---

## Layout style — whose brand the typeset pass prints

The typeset pass (both modes) writes the brand's look, footer handle and per-slide
wording into every image prompt. That text is a **layout style**:

- **Default preset `coaching_gems`** — the original cream/burnt-orange book-press look
  and `@coachgems_` handle. A carousel with no style set renders exactly as before.
- **Any other brand** — write a JSON style file in the job and pass
  `--style brand/acme.json`, or set `"layout_style": "brand/acme.json"` in
  `carousel.json` so every later `--regen` / `--slide` call keeps it without repeating
  the flag. `--style` wins over `carousel.json`. Paths are job-relative.
- **Handle:** `carousel.json` `"handle"` wins, then the style's `"handle"`.

A style file must supply **every** key below — there is no fallback to Coaching Gems
text, so nothing of another brand leaks in. It is checked before any image is minted
(unknown keys, missing keys, unknown `{placeholders}` or broken braces are refused).

| key | what it is | placeholders it may use |
|---|---|---|
| `style_block` | the locked palette / typography / aesthetic / anti-patterns text, used verbatim | — |
| `footer` | the footer line on every slide | `{handle}` |
| `beat` | prompt for ordinary slides | `{style_block}` `{footer}` `{handle}` `{narration_plain}` `{narration_emphasis}` `{narration_continuation}` `{layout_direction}` |
| `cover` | prompt for `kind: cover` | `{style_block}` `{footer}` `{handle}` `{header_chip}` `{headline}` `{tagline}` `{layout_direction}` |
| `closing` | prompt for `kind: closing` | `{style_block}` `{footer}` `{handle}` `{stat_display}` `{stat_body}` `{closer_line}` `{brand_url}` `{layout_direction}` |
| `name`, `handle` | optional label (logged) and default handle | — |

Templates are Python `str.format` strings: write a literal brace as `{{` / `}}`. Slide
text is inserted as-is. The `coaching_gems` templates in `tools/build_carousel.py`
(`COACHING_GEMS_*`) are the worked example to adapt. The illustration style for
`two_pass` stage 1 is separate: it still comes from `carousel.json` `"style_pack"`
(`skills/carousel_styles/<pack>.md`).

---

## NOT build_carousel

- **`mint_image --role card`** — a single self-contained card or mockup. If the
  deliverable is ONE slide (not a multi-slide post), call `mint_image --role card`, not
  `build_carousel`.
- **`compose_render`** — the Remotion compositor for video with captions/overlays. Build
  carousel renders static image PNGs; it does not produce video and does not touch
  Remotion.
- **`mint_image --role artistic_still`** — fine-art B-roll stills for video beats, not
  carousel slides.
