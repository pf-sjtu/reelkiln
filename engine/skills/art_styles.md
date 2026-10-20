# Art / Illustration Style Library

A catalog of locked visual styles for minting stills and illustrations via `tools/mint_image.py`. Each entry gives a **name**, the verbatim **CORE_STYLE_BLOCK** prompt, **when to use it**, the **typography pairing**, an **example**, and the exact **tool flags**. The carousel and b-roll workflows both reference this file to pick a style and pin it.

Distilled from `_research/art_style_library.md`.

---

## The one mechanism that matters — REFERENCE-IMAGE style lock

**Flagged requirement:** every generated illustration must match a *locked* style. Prose drifts; a reference PNG pins it. Any reference selects the default Nano Banana 2 edit endpoint.

### How `--reference` reaches the model (the wire path)

`mint_image` accepts `--reference` **repeatably** (URL, `data:` URI, or local path). The gateway uploads local files and maps the ordered list to the selected edit endpoint. Prompt-only requests use text-to-image; one or more references use image-edit.

```bash
mint_image ... --reference base_style.png      # → Nano Banana 2 edit, ordered refs
```

The shipped app always uses the metered gateway. A direct local GPT path exists only when explicitly selected for development; it is never a silent fallback.

### Two reference idioms (both proven in the sandbox)

**(A) EDIT — preserve composition, add a layer.** Pass the *content* image (a raw illustration or brand stamp) as `--reference` with a prompt that says "preserve this composition, only ADD/typeset on top, keep the locked palette." gpt-image-2 returns the same picture with a new layer baked in. This is the carousel layout pass (`layout_carousel.py`), where the locked-style prose is repeated verbatim in every prompt and exact text is typeset on top:

```bash
uv run python agent/tools/generate_image.py \
    --job <id> --name slide_06_layout_v1 \
    --model gpt-image-2 --aspect-ratio 2:3 --quality high \
    --reference <job_dir>/images/slide_06.png \
    --prompt "<LOCKED_STYLE> ... TYPESET THE FOLLOWING VERBATIM TEXT ..."
```

**(B) EXEMPLAR — match the look, draw new content.** Pass a curated **base style image** (a hand-made engraving, a graded neo-noir frame) as `--reference`, with a prompt whose SCENE describes *new* content. The prompt **MUST explicitly** instruct style-transfer, e.g.:

> *"Match the rendering technique, palette, grain, and mark-making of the reference image exactly; do not copy its subject — draw the SCENE described above."*

Without that instruction gpt-image-2 defaults to EDIT mode and redraws the reference's content. This is the art-library workhorse: ship ONE locked exemplar PNG per style so a drifting text prompt is backstopped by a pixel-true anchor.

### Why a reference beats prose alone (documented failures)

- **Palette drift:** gpt-image-2 creeps off-palette on text alone (peach/coral/salmon instead of the locked burnt-orange from a reference). A reference PNG pins the exact hue.
- **Font override:** gpt-image-2 ignores explicit Garamond requests and renders Bodoni/Didone. A reference shows it what you mean.
- **Lossy edit — the load-bearing caveat:** the EDIT idiom regenerates the image slightly (books reshape, faces shift). Fine for forgiving line/painterly/vintage styles; **test before trusting it on photoreal likeness or named-person faces.**

### Evaluation — run every reference-locked mint

1. **Mint with `--variants 2` or `3`** — image-edit/transfer is non-deterministic; generate a batch and pick.
2. **`Read` the PNG inline** (always-show-image rule — never just point at the path).
3. **Palette check** — eyeball against the locked hex; reject drift.
4. **Mark-making check** — are strokes visible (engraving) or smoothed to airbrush?
5. **Composition check** — for EDIT, did it preserve the base / keep empty typography margins?
6. **Text legibility** (only if text is baked) — every word crisp; else render text in Remotion. gpt-image-2 has the strongest typography of any current generator, which is why the carousel bakes text in via this tool.
7. **Re-roll, don't bash** — fix the style block or swap the reference; never pile on adjectives.

---

## The universal prompt recipe

Style words live ONLY in the CORE_STYLE_BLOCK. The SCENE describes *what*, never *how it looks*. This separation is what keeps styles consistent across slides (it is exactly what `mint_carousel_illustrations.py:mint_one()` does: `prompt = f"{core}\n\nSCENE: {scene}"`).

```
{CORE_STYLE_BLOCK}        # locked style prefix — verbatim, never paraphrased

SCENE: {subjects, composition, action — 1-3 sentences, NO style adjectives}
```

For the EXEMPLAR idiom, insert the style-transfer instruction between the block and the SCENE.

## Backend choice (from the `generate_image.py` decision matrix)

| Need | Backend | Why |
|---|---|---|
| General stills, designed graphics, photoreal frames, text, and style-reference edits | `nano-banana-2` (default) | fast text/edit endpoints, ordered references, native 9:16 and shared canonical ratios |
| EVIDENCED typography or compatibility exception | `gpt-image-2` (explicit only) | A/B/rollback rail; include it in any requested quote and never retry onto it silently |
| Photoreal **face that feeds Seedance video** | `generate_avatar.py` (NOT this tool) | trusted-URL flow bypasses face moderation |

Omit `--model` for the rollback-aware Nano default. Use `--model gpt-image-2`
only for a deliberate A/B or capability exception; include the override in the
exact gateway quote when cost information is requested.

## Cost & parallelism

- Nano Banana 2 1K is quoted authoritatively by the gateway and normally completes in seconds. For several stills use one `mint_image --batch` call (it bounds its own parallelism), in the foreground, with a ≥300s safety timeout for queues/cold starts.
- `--variants 2..3` for art-stills (max 10 logical variants; the tool chunks at four per request).

## Where style packs live (layering doctrine)

A style pack is **Layer 2 (per-job/per-brand) data, not Layer 1 global code**. Never branch on a style name in tool code. The pack SPEC is its entry in this file (the `### CORE_STYLE_BLOCK`); the locked exemplar PNG lives with whoever OWNS the style: a tenant-locked style → `taste/packs/<tenant>/style_sources/<pack>_exemplar.png` (the molecules Homes rule — tenant data never ships with the engine), a workflow-owned register → `workflows/<workflow>/_ref/` (e.g. `collage-explainer`). *(`brand_identities/` is retired — it mixed tenant assets into the engine build.)* Select per job via a `style_pack` field — exactly as `build_carousel` reads `carousel.json:style_pack` and resolves `skills/carousel_styles/<pack>.md`. Adding a style is data, never code.

---

# THE STYLE LIBRARY

---

## Style 1 — `intaglio_engraving` (Monochrome Intaglio / Engraving Print)

The shipped, proven style (`coaching_gems_v1`). Copy it verbatim as the template for every new pack.

- **When to use:** editorial carousels; book-feel quote cards; any surface that gets *skimmed on a swipe*. First principle (carousel doctrine): **low-fidelity illustration hides AI-gen tells** — sketchy ink/engraving gets forgiven where photoreal gets scrutinized.
- **Typography pairing:** Palette **A. Editorial Italic** (or the carousel's own Bodoni/Didone book-serif). Cream + ink-black + burnt-orange.
- **CORE_STYLE_BLOCK (verbatim, locked):**

  > A vintage intaglio copperplate engraving illustration in the style of a 1950s Penguin Classics frontispiece.
  >
  > RENDERING TECHNIQUE — non-negotiable: Every tonal value is built from discrete visible ink strokes — dense parallel cross-hatching to define form and shadow, contour-following hatching to wrap volumes, and fine stippling in the lightest mid-tones. Each individual stroke must be visible as a discrete line, the way a steel-engraved book frontispiece reveals every cut. No smoothed digital shading, no airbrush blending, no soft colored-pencil tonality. The linework IS the rendering. Style references: Albrecht Dürer portrait engraving, 1950s Penguin Classics author frontispiece, Dover Publications scientific portrait plate, Field Notes back-cover etching, 19th-century medical textbook plate.
  >
  > COLOR — locked: Single ink color is a saturated DARK burnt-orange #C84A1E — the color of dried pumpkin skin, of old letterpress hot-foil, of a Penguin Classics spine. NOT peach. NOT coral. NOT salmon. NOT light orange. Background is warm cream paper #F2EBDC with very subtle natural paper grain only.
  >
  > COMPOSITION — enforced: The illustration occupies only the CENTRAL 50% of the vertical frame. The TOP 25% and BOTTOM 25% are EMPTY CREAM PAPER for typography to be composited later.
  >
  > No text, no logos, no lettering anywhere in the image.
  >
  > Avoid: watercolor, ink splashes, paint splatter, gradients, glossiness, drop shadows, smoothed digital painting, colored pencil tonality, soft airbrush, generic Canva aesthetic, sans-serif, modern startup minimalism, gold-foil cliché, photorealism, color photography, additional colors beyond burnt-orange and cream, peach, coral, salmon, light-orange, AI-influencer face, plastic skin, symmetric face.

- **Example mint call:**
  ```bash
  uv run python agent/tools/generate_image.py --job <id> --name slide_04 \
      --model gpt-image-2 --aspect-ratio 2:3 --quality high \
      --prompt "$(extract CORE_STYLE_BLOCK)

      SCENE: A lone executive at a vast empty boardroom table, one chair, dramatic single-source light, viewed slightly from above."
  ```
  Optional style-anchor backstop: add `--reference` with a curated engraving exemplar (tenant `style_sources/`) plus the prompt line *"Match the engraving technique and exact burnt-orange ink hue of the reference image; draw new content."*
- **Tool settings:** `--model gpt-image-2 --aspect-ratio 2:3 --quality high`. ~$0.05, ~2 min/illustration; 9 in one `mint_image --batch` call ≈ 3 min. Seedream untested for this register.

---

## Style 2 — `iphone_warm` (Warm Simple Photoreal "iPhone Picture")

Deliberately unspectacular, warm, true-to-life — a good snapshot, not a production still. Reads as *real and unstaged*, which is its credibility.

- **When to use:** authenticity-first stills; "a real moment" b-roll; product/place shots that must NOT look art-directed; founder-diary register. The anti-glossy counterpart to the cinematic styles.
- **Typography pairing:** Palette **F. High-Touch Personal** (Caveat/Manrope) or **D. Coaching Warm**.
- **CORE_STYLE_BLOCK:**

  > A warm, natural smartphone photograph — the look of a recent iPhone snapshot, not a studio shot. Soft available daylight (golden-hour or window light), gentle natural skin tones, slightly warm white balance. Shallow but imperfect depth of field, mild handheld imperfection, true-to-life color science — NOT graded, NOT cinematic, NOT HDR. The frame feels casually composed, a real moment caught. Fine, believable photographic detail and natural grain.
  >
  > Avoid: HDR sheen, over-saturation, dramatic cinematic grading, studio lighting, lens flares, bokeh balls, glossy advertising look, AI-influencer perfection, plastic skin, symmetric staging, stock-photo composition.

  *(Built from the avatar guide's anti-uncanny doctrine — the documentary camera-spec `Documentary photography, 35mm lens, available light`, pushed warmer and more casual.)*
- **Example SCENE:** `SCENE: A worn ceramic coffee mug on a kitchen windowsill, morning light, a houseplant slightly out of focus behind it.`
- **How mint_image achieves it:** use the default rail with `--aspect-ratio 9:16` for full-bleed photoreal. Reference idiom: pass a real warm-snapshot exemplar with `--reference` and say "match this light and color science."

---

## Style 3 — `fine_art_philosophical` (High-End Philosophical Fine-Art)

Gallery-grade, contemplative, museum-wall painterly. The "this means something" register — used sparingly for the emotional or thematic centerpiece.

- **When to use:** the thematic hero still of a piece; a meditative pause beat; cover art for a heavier topic. NOT for fast-skim content (too slow to read).
- **Typography pairing:** Palette **A. Editorial Italic** or **G. Magazine** (Bodoni Moda) — high-contrast, restrained.
- **CORE_STYLE_BLOCK:**

  > A high-end fine-art painting with a contemplative, philosophical mood — the register of a contemporary gallery piece. Oil-on-canvas materiality with visible brushwork and subtle impasto, restrained desaturated palette, chiaroscuro lighting with deep shadow and one soft light source. Composition uses generous negative space and a single contemplative subject. References: Andrew Wyeth, Vilhelm Hammershoi interiors, Edward Hopper stillness, Caravaggio light. Museum-grade, unhurried, emotionally weighted.
  >
  > Avoid: digital-painting smoothness, concept-art rendering, fantasy illustration, vivid saturation, busy composition, cartoon, anime, Canva minimalism, stock-photo literalism, drop shadows, gradients-as-shortcut.

- **Example SCENE:** `SCENE: A single empty chair by a tall window in a bare room, late afternoon light falling across the floorboards, no figure present.`
- **How mint_image achieves it:** `--model gpt-image-2 --aspect-ratio 2:3 --quality high` (handles painterly registers and respects style references well). **Reference idiom strongly recommended** — fine-art "mood" drifts badly on prose alone; pin it with a curated exemplar painting as `--reference` plus *"match the brushwork, palette, and light of the reference; new subject."*

---

## Style 4 — `duotone_neo_noir` (Duotone Neo-Noir)

Two-tone, high-contrast, cinematic-crime mood. A graded look built from exactly two hues + their blend — graphic, modern, instantly "premium."

- **When to use:** tension/stakes beats; thriller or investigation framing; bold feed-stopping covers; tech/crime/finance-with-edge content.
- **Typography pairing:** Palette **H. Clean Brutalist** (naked Inter), or **C. Hype Display** when energy is high. Single hero accent color = one of the duotone hues.
- **CORE_STYLE_BLOCK** (parameterize the two hues per job):

  > A duotone neo-noir image rendered in exactly TWO colors and their gradient blend: deep midnight-teal #0B1E2D in the shadows and a single electric accent #FF3B30 in the highlights — no other hues. High-contrast cinematic lighting, hard shadows, wet-street film-noir atmosphere, anamorphic framing. Grain and a faint halation glow on the brightest accents. The look of a graded thriller poster. Strong silhouette-driven composition.
  >
  > Avoid: full-color rendering, third and fourth colors, muddy mid-tones, soft pastel grading, watercolor, gradients used as decoration, glossy 3D render, cartoon, busy backgrounds.

  *(Grounds in the seedance §16.8 anchor pattern — name a specific tradition ("graded thriller poster", "film-noir"), not vague adjectives. Lock the two hex values exactly the way `coaching_gems_v1` locks its ink.)*
- **Example SCENE:** `SCENE: A lone figure in a long coat crossing a rain-slick intersection at night, seen from across the street, headlights raking the frame.`
- **How mint_image achieves it:** use the default rail with `--aspect-ratio 2:3` for graphic duotone or `--aspect-ratio 9:16` for full-bleed graded photoreal frames. **Reference idiom essential here** — pass a true two-tone graded exemplar so the model holds to exactly two hues. Verifying "exactly two hues survived" is the #1 drift check for this style.

---

## Style 5 — `vintage_print` (Vintage / Retro Print)

Aged paper, halftone dots, faded mid-century or 70s print stock. Nostalgic, tactile, "found in a drawer." Distinct from intaglio (that's fine line-engraving; this is mass print: halftone, registration offset, sun-faded color).

- **When to use:** nostalgia beats; throwback hooks; products/ideas pitched as timeless or heritage; zine/poster covers.
- **Typography pairing:** Palette **G. Magazine** (Bodoni) for fashion-vintage, or a retro slab/condensed for poster-vintage. Warm, low-saturation color story.
- **CORE_STYLE_BLOCK:**

  > A vintage offset-print illustration with authentic mid-century printing characteristics: visible halftone dot screens, slight CMYK mis-registration, sun-faded low-saturation color, aged paper texture with foxing and edge yellowing. The look of a 1960s-70s magazine page, pulp paperback cover, or travel poster. Limited flat-color palette, bold simple shapes, screen-printed feel.
  >
  > Avoid: clean digital vectors, modern gradients, glossiness, HDR, photorealism, crisp anti-aliased edges, neon saturation, drop shadows, Canva minimalism.

- **Example SCENE:** `SCENE: A stylized sunburst over a midcentury suburban house, bold flat shapes, a single car in the driveway.`
- **How mint_image achieves it:** `--model gpt-image-2 --aspect-ratio 2:3 --quality high`. Halftone/print texture is a designed-graphic register gpt-image-2 reproduces well. Reference idiom optional but helps lock the faded palette and dot screen — pass a real scanned vintage print as `--reference`.

---

## Style 6 — `editorial_line` (Single-Weight Editorial Line Drawing)

Minimal one-weight ink line illustration, New-Yorker-spot-drawing register. The cheapest, fastest, most forgiving style — pure contour line, no shading.

- **When to use:** quick conceptual spots; many-slide carousels where speed > richness; diagrammatic or witty single-idea illustrations.
- **Typography pairing:** Palette **A. Editorial Italic** or **H. Clean Brutalist**.
- **CORE_STYLE_BLOCK:**

  > A single-weight editorial line drawing — the spot-illustration register of a New Yorker or a fine-liner ink sketch. One consistent black line weight, no shading, no fill, generous white space, confident economical contours. Witty, conceptual, minimal.
  >
  > Avoid: cross-hatching density, color fills, gradients, drop shadows, photoreal detail, 3D, painterly texture, busy backgrounds.

- **Example SCENE:** `SCENE: A figure standing at a fork in a path, one branch tidy, the other a tangle, deciding.`
- **How mint_image achieves it:** `--model gpt-image-2 --aspect-ratio 2:3 --quality high`. Most forgiving style for prose-only (no fine texture to drift); reference optional.

---

## Style 7 — `halftone_collage` (Editorial Halftone Paper-Collage) — ANIMATION-NATIVE

Flat bold single-color paper field + black-and-white halftone photographic cut-outs +
selective colored-cardstock accents; crisp cut edges, cream keylines, soft paper
shadows. The only pack DESIGNED to be animated: every still is the completed LAST
frame of an assemble-from-empty clip (`skills/broll_styles.md` Method 20), so a whole
faceless reel can run in this one register. This style is workflow-owned — the full
spec (CORE_STYLE_BLOCK, color-semantics table, metaphor spec, provenance) lives in
[`workflows/collage-explainer.md`](../workflows/collage-explainer.md).

- **When to use:** abstract opinion/concept lines with nothing real to show — faceless
  explainer reels, essay/POV channels, "how to think about X" beats. NOT for product
  ads, real-person content, or anything needing editable layers.
- **Typography pairing:** Palette **H. Clean Brutalist** or **A. Editorial Italic**;
  captions burn in Remotion after animation, never in the still.
- **CORE_STYLE_BLOCK:** lives in the workflow file (it parameterizes background hex +
  accents per shot — the batch varies the FIELD semantically while the paper
  materiality holds the design language; that per-shot color variation is this pack's
  signature and the workflow's semantics table governs it).
- **Example SCENE:** `SCENE: A halftone cut-out editor leans over a giant film-strip
  clock, scissors mid-cut; one short strip of film comes free. Burnt-orange field
  #C4501B, cream + cyan accents.`
- **How mint_image achieves it:** `--model gpt-image-2 --aspect-ratio 2:3 --quality
  high` + `--reference workflows/collage-explainer/_ref/exemplar.png`.
  **Reference idiom essential** — flat fields and halftone dots drift badly on prose
  alone. Drift checks: field flat/uniform, dots visible, cream keylines, ≤6 paper
  groups, zero legible text.

---

# Worked example — adding a new style end to end

Goal: ship the `duotone_neo_noir` pack.

1. Author the pack as a Style entry in THIS file with its `### CORE_STYLE_BLOCK` (the block in Style 4). Lock the two hex hues.
2. Curate ONE exemplar frame; save it with the style's owner — `taste/packs/<tenant>/style_sources/duotone_neo_noir_exemplar.png` (or `workflows/<workflow>/_ref/` if a workflow owns the register).
3. Mint:
   ```bash
   uv run python agent/tools/generate_image.py --job <id> --name hero_noir \
       --model gpt-image-2 --aspect-ratio 2:3 --quality high --variants 3 \
       --reference taste/packs/<tenant>/style_sources/duotone_neo_noir_exemplar.png \
       --prompt "$(extract CORE_STYLE_BLOCK)

       Match the two-color grading, grain, and halation of the reference image exactly; do not copy its subject.

       SCENE: A lone figure crossing a rain-slick night intersection, headlights raking the frame."
   ```
4. `Read` the 3 variants inline. Pick. Verify exactly two hues survived (the #1 drift risk for duotone). Re-roll if a third color crept in.
5. Pair with Palette **H** typography in the design brief / Remotion overlay.

No code changes are needed to add a style — only a `style_pack.md` block and an `_ref/` exemplar PNG.
