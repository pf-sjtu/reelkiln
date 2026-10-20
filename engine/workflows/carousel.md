# Carousel — baked-typography slide post (image-only)

A multi-slide Instagram post whose body copy and typography are **baked into each image
by the selected image rail** — there is no Remotion caption layer in the production path, no audio, no
video. The single primitive is `build_carousel` (it absorbed the three old backends:
`mint_carousel_illustrations` / `layout_carousel` / `render_carousel`). The standard path is
`--mode two_pass`. The base STYLE images are passed as `--reference` and are **load-bearing**
— they pin the illustration look against prose drift (`skills/art_styles.md`, the
REFERENCE-IMAGE style lock).

Because this is an image-only post, the eval is the **image-asset recipe** from
`skills/evaluation.md` (Read each slide inline + on-screen-text correctness + brand-string
audit). There is **no** Gemini-video pass — `gemini_video` / `verify_output` / `review_output`
audit `script.json` chunks and a rendered `final.mp4`; none of those surfaces exist here.

> **⚠️ Read this as PRINCIPLES, not a script to copy.** Every concrete style value in this
> file — the intaglio engraving look, its palette, the serif pairing, the issue-chip wording —
> is from ONE tenant's shipped carousel and is *illustration, not law*. For YOUR post, the
> style pack + typography + handle come from the current tenant's pack and
> `skills/carousel_styles/`; the transferable part is only the pipeline (stage → proof →
> batch → re-mint → contact sheet) and its eval discipline.

This file is the forward recipe. The illustration **art style is a SWAP POINT** — see
`skills/art_styles.md` (a whole library of locked styles, not one). Don't repeat the shared
skills: `skills/evaluation.md` (the eval recipe), `skills/art_styles.md` (the style library +
`--reference` style-lock mechanism), `skills/typography_palette.md` (the type pairing per
style). The worked example below is the proven editorial carousel for an editorial book-quote
channel (`<tenant>_v1`, `intaglio_engraving`) that actually shipped — but every brand/style choice
is a swap point.

---

## Input

| input | where it comes from |
|---|---|
| `carousel.json` — the per-slide narrative (load-bearing): for each slide `kind` (cover/beat/closing), `header_chip` / `headline` / `tagline` / `illustration_scene` / `illustration_source_relpath`, plus top-level `style_pack`, `handle`, `issue_number`, `featured_name`, `brand_url`, `stamp_asset_relpath` | authored UPSTREAM by Claude (the editorial narrative step). Lives at `jobs/<job>/carousel.json`. |
| base **STYLE reference** PNG(s) | the look to match — for a rebuild, the original shipped finished slides; for a fresh post, a curated exemplar of the chosen `skills/art_styles.md` style (e.g. `taste/packs/<tenant>/style_sources/<style>_exemplar.png`). Copy into `jobs/<job>/style_refs/`. |
| cover portrait + brand stamp PNGs | the cover's `illustration_source_relpath` (a portrait) and the closing slide's `stamp_asset_relpath` (the wordmark stamp). The stamp resolves from `jobs/_brand_<brand>/images/...` (any `_brand_*` relpath resolves from `OUTPUT_ROOT`). |
| **style pack** | `skills/carousel_styles/<style_pack>.md` — the `### CORE_STYLE_BLOCK` heading `build_carousel` parses for stage-1 illustration prompts. `carousel.json:style_pack` selects it. Adding a style is DATA (a new `style_pack.md` + an `_ref/` exemplar), never tool code — see `skills/art_styles.md`. |

All commands run from `/Users/chin/projects/videoclaw` as `uv run python tools/<tool>.py`, always
with an explicit `--job <id>` (concurrent jobs clobber `.current_job`).

---

## Steps

### Step 1 — Stage the inputs `[GENERIC]`

**(a) What you generate:** the job directory with the narrative, the cover portrait, the brand
stamp, and the base STYLE reference images in place.

**(b) Command:**
```bash
JOB="replace-with-the-same-canonical-bare-id"
mkdir -p "jobs/$JOB/images" "jobs/$JOB/style_refs" "jobs/_brand_<brand>/images"

cp <narrative_src>/carousel.json        "jobs/$JOB/carousel.json"
cp <narrative_src>/portrait.png         "jobs/$JOB/images/portrait.png"      # cover ref
cp <brand_src>/<wordmark_stamp>.png     "jobs/_brand_<brand>/images/<wordmark_stamp>.png"  # closing ref
# base STYLE refs (the look to match) — 2-3 representative slides/exemplars:
cp <style_src>/<exemplar_a>.png         "jobs/$JOB/style_refs/01.png"
cp <style_src>/<exemplar_b>.png         "jobs/$JOB/style_refs/06.png"
```

**(c) Input source:** `carousel.json` from the upstream narrative step; portrait + stamp from the
brand's assets; STYLE refs per the chosen `skills/art_styles.md` style.

**(d) Why:** `build_carousel` resolves per-slide references by `kind` — cover → portrait, closing
→ stamp, beat → the stage-1 illustration. The CLI `--reference` images anchor stage-1
illustration STYLE only (cover/closing refs are fixed by kind). Staging it wrong silently mints
off-brand slides.

**(e) EVAL:** deterministic pre-check — `uv run python -c` from the engine: load `carousel.json`, assert `style_pack`
resolves to an existing `skills/carousel_styles/<style_pack>.md` with a `### CORE_STYLE_BLOCK`
heading, that every slide has its required copy fields for its `kind`, and that the cover
portrait + the `_brand_*` stamp paths exist on disk. A missing field or unresolved ref aborts
before any spend. (This is the "cheap deterministic check" rung from `skills/evaluation.md`.)

### Step 2 — Optional de-risk preview: render the cover (slide 1 only) `[GENERIC]`

**(a) What you generate:** ONLY slide 1 (the cover), exercising style-pack extraction, reference
resolution, and the default image-rail typeset pass.

**(b) Command:**
```bash
uv run python tools/build_carousel.py \
  --job "$JOB" --mode two_pass --style-proof \
  --reference "jobs/$JOB/style_refs/01.png" \
  --reference "jobs/$JOB/style_refs/06.png"
```

**(c) Input source:** Step 1's staged job dir.

**(d) Why:** one cheap end-to-end call before the full ~$1 batch. If the style pack, a reference
path, or the typeset pass throws, you find out for $0.04, not after 18 mints. This is the
cheapest rung catching the whole-pipeline bug class first (`skills/evaluation.md`).

**(e) EVAL — image-asset recipe (`skills/evaluation.md`, "Avatar IMAGE" / image-still rung):**
`Read jobs/$JOB/images/slide_01_layout_v1.png` **inline** (always-show-image — never just point
at the path). Eyeball: style-match to the reference, on-screen text legible + correct, the
proper noun (`featured_name`) spelled right. **No Gemini** — a still has no motion or audio.
Fix clear defects before batching; this preview is not a human-approval gate.

### Step 3 — Full build: all slides, two_pass `[GENERIC]`

**(a) What you generate:** all N slides — stage 1 mints the raw beat illustrations (scene only,
no text) from each slide's `illustration_scene` + the style pack's `CORE_STYLE_BLOCK`, anchored
by the `--reference` STYLE images; stage 2 typesets each slide's verbatim copy over its
illustration. Output: `images/slide_NN_layout_v1.png` (the shippable slides).

**(b) Command:**
```bash
uv run python tools/build_carousel.py \
  --job "$JOB" --mode two_pass --workers 3 \
  --reference "jobs/$JOB/style_refs/02.png" \
  --reference "jobs/$JOB/style_refs/06.png"
```

**(c) Input source:** the staged job dir; each image is minted by `mint_image --role card`
(`--aspect 2:3`) under the hood. Nano Banana 2 is the default; an evidenced typography
exception may explicitly select GPT, but never as an automatic retry.

**(d) Why:** `two_pass` is the standard path — generating the art clean and typesetting text as a
second reference-conditioned pass yields a designed editorial page a flat overlay can't match.
`--workers 3` stays under Replicate's burst limit on low-credit accounts. Existing outputs are
skipped unless `--force`. Cost ~$0.70–$1.00, a few minutes parallel.

> **Alternative path:** for a brand whose look is defined entirely by ONE exemplar (no separate
> illustration stage wanted), use `--mode reference_matched` — every slide is a single
> reference-conditioned image-edit pass and `--reference` is REQUIRED + load-bearing. `two_pass`
> is the default and what the proven sequence used.

**(e) EVAL — the image-asset recipe (`skills/evaluation.md`); run by Reading every slide inline:**
1. **Read each `slide_NN_layout_v1.png` inline** (all N) — mandatory always-show-image.
2. **Style-match** — the locked palette/technique of the chosen style holds across all slides.
   **Ground this check in the CHOSEN pack, never a remembered palette:** open
   `skills/carousel_styles/<style_pack>.md` — its `### CORE_STYLE_BLOCK` names the exact
   hexes/technique to assert (and what drift looks like). The #1 drift check per style is in
   `skills/art_styles.md`.
3. **On-screen-text correctness** — every word renders crisply (no garbled/hallucinated letters)
   AND the baked copy matches `carousel.json` **verbatim** (`header_chip`, `headline`, `tagline`,
   and any `narration_*` / `stat_*` / `closer_line` fields per slide).
4. **Brand-string audit** — the `handle` is the channel's own handle (NOT the operator's personal
   handle), the `brand_url` is correct, the issue chip reads `<BRAND> · ISSUE <n>`, and `featured_name`
   (proper noun) is spelled correctly on the cover.

   **No Gemini-video** — image-only post, no audio/motion surface; `gemini_video` /
   `verify_output` / `review_output` do not apply (they audit script chunks + final.mp4).
   **Never accept the first output** — re-mint any failing slide (Step 4).

### Step 4 — Re-mint flagged slides `[GENERIC]`

**(a) What you generate:** only the slide indices the Step-3 eval rejected.

**(b) Command:**
```bash
uv run python tools/build_carousel.py \
  --job "$JOB" --mode two_pass --regen 7 \
  --reference "jobs/$JOB/style_refs/02.png" \
  --reference "jobs/$JOB/style_refs/06.png"
```

**(c) Input source:** the same staged job dir; `--regen <idx,...>` implies `--force` on those
slides only.

**(d) Why:** image generation is non-deterministic — a garbled word or a third color creeping in on one
slide is a re-roll, not a pipeline failure. Re-roll, don't bash adjectives onto the prompt
(`skills/art_styles.md`); if it keeps drifting, swap the `--reference` or fix the `CORE_STYLE_BLOCK`
in the style pack.

**(e) EVAL:** repeat Step 3's image-asset eval on the re-minted slide(s) — Read inline,
style-match, text-correctness, brand-string audit. Loop until every slide passes.

### Step 5 — Contact sheet + human ship decision `[GENERIC]`

**(a) What you generate:** a single tiled contact sheet of all N final slides for one-glance
review.

**(b) Command:**
```bash
ffmpeg -y -i jobs/$JOB/images/slide_01_layout_v1.png ... -filter_complex "...tile=2x5..." \
  jobs/$JOB/contact_sheet.png
```

**(c) Input source:** the N `slide_NN_layout_v1.png` outputs.

**(d) Why:** a tiled sheet surfaces cross-slide consistency (does the whole set read as one
designed series?) that per-slide Reads miss.

**(e) EVAL:** `Read jobs/$JOB/contact_sheet.png` inline; final cross-slide consistency pass, then
**the human decides ship / revise** (Gemini never does — and there is no Gemini surface here
anyway). This is the closing rung of `skills/evaluation.md`: cheap check → agent's eyes → human
decides.

---

## Output

`jobs/$JOB/images/slide_01_layout_v1.png … slide_NN_layout_v1.png` — the N shippable carousel
slides with baked typography, plus `jobs/$JOB/contact_sheet.png` for review. Ready for the
publishing step (carousels post to the channel's own handle — e.g. an `_authority_host` book
carousel posts to that channel's handle, not the operator's personal handle).

---

## Brand vs generic

- `[GENERIC]` — every step above is brand-agnostic; the pipeline is the same for any tenant.
- `[BRAND: <tenant>]` choices that appear as the worked example (an editorial book-quote channel;
  swap per tenant's stated style; smart defaults only if unstated): `style_pack = <tenant>_v1` →
  `intaglio_engraving` art style (`skills/art_styles.md` Style 1); palette cream `#F2EBDC` +
  burnt-orange `#C84A1E` + ink-black Bodoni/Didone serif (`skills/typography_palette.md`);
  `handle = <the channel's own handle>`; issue-chip format `<BRAND NAME> · ISSUE <n>`. A different
  tenant swaps the style pack, the art style, the typography pairing, the handle, and the chip
  wording — none of that is code. (The real locked handle + chip wording live in that tenant's
  pack COMMITMENTS.)

## Notes / gotchas

- The `--reference` STYLE images are **load-bearing** in `two_pass` (they anchor stage-1
  illustration style) and **required** in `reference_matched`. Prose alone drifts off-palette
  and off-font; the reference PNG is what pins it (`skills/art_styles.md`).
- Carousel cards are `2:3`, which `--role card` sets; the canonical cross-rail contract also supports native 9:16.
- The illustration art style is a **swap point**: pick from `skills/art_styles.md` (intaglio,
  iphone-warm, fine-art, duotone neo-noir, vintage print, editorial line, …) and pin it with a
  matching `style_pack.md` + `_ref/` exemplar. Don't hard-code a style name in tool code.
- This is image-only: **no `synth_voice`, no `lipsync_footage`, no `compose_render`, no Gemini
  video review.** If a future variant adds a narrated video walk-through of the slides, that is a
  different workflow (`broll-voiceover`) — and lip-sync, if ever a face is added, is ALWAYS fal
  sync-3 via `lipsync_footage`.
