# `coaching_gems_v1` — Carousel Illustration Style Pack

Locked aesthetic for the @josephchinbuilds (Coaching Gems) Instagram carousel format. Used by `agent/tools/render_carousel.py` and inherited by every per-slide illustration prompt.

## First Principle — Why Illustrated, Not Photoreal

**Low-fidelity illustration hides AI-gen tells.** Photoreal AI gets scrutinized on a swipe; sketchy ink-and-engraving gets forgiven and lets the *story* land instead of the pixels. This is the inverse of the video pipeline's photoreal-avatar doctrine — different surface, different scrutiny mode (swipe-and-skim vs sit-and-watch). Lean into mark-making, not realism.

## Brand Inheritance

Inherits hard constraints from the locked Coaching Gems wordmark stamp (`agent/output/_brand_coaching_gems/images/concept_b_wordmark_stamp.png`):

| Attribute | Value |
|---|---|
| Palette | Cream paper `#F2EBDC` + single burnt-orange ink `#C84A1E`. No other colors. |
| Texture | Subtle natural paper grain. Tiny press-deboss depth. |
| Type family | Bold compact serif, tightly letter-spaced uppercase (the COACHING / GEMS lockup). |
| Frame motif | Faceted gem-shaped octagonal border, thin precise art-deco. |
| Tagline | `ONE COACH · ONE IDEA · ONE MINUTE` |
| Handle | `@josephchinbuilds` |

Named style references (from the stamp's locked prompt): Penguin Classics frontispiece, Field Notes back-cover stamp, 1950s book press hot-foil.

## Hard Anti-Patterns

Forbidden in every prompt. Inherited from the stamp's locked anti-list, extended for illustrations:

- watercolor, ink splashes, paint splatter (NOTE: the OpenAI reference carousel uses watercolor — that's *off-brand* for Coaching Gems)
- gradients, glossiness, drop shadows
- smoothed digital painting, colored-pencil tonality, soft airbrush
- generic Canva aesthetic, modern startup minimalism, sans-serif
- gold-foil cliché
- photorealism, color photography
- additional colors beyond burnt-orange and cream — explicitly NOT peach, coral, salmon, light-orange (gpt-image-2 drifts here)
- AI-influencer face, plastic skin, symmetric face

## Illustration Prompt Scaffold

Every per-slide illustration prompt is composed as:

```
{CORE_STYLE_BLOCK}

SCENE: {slide-specific scene description, 1-3 sentences naming subjects, composition, action}
```

The `CORE_STYLE_BLOCK` is the locked text below — do NOT paraphrase, do NOT trim. It survived 2 prompt rolls (v1 was too soft pencil-sketch, v2 locked the register). Future re-tuning should bump the version (`coaching_gems_v2`) and snapshot what changed.

### CORE_STYLE_BLOCK

> A vintage intaglio copperplate engraving illustration in the style of a 1950s Penguin Classics frontispiece.
>
> RENDERING TECHNIQUE — non-negotiable: Every tonal value is built from discrete visible ink strokes — dense parallel cross-hatching to define form and shadow, contour-following hatching to wrap volumes, and fine stippling in the lightest mid-tones. Each individual stroke must be visible as a discrete line, the way a steel-engraved book frontispiece reveals every cut. No smoothed digital shading, no airbrush blending, no soft colored-pencil tonality. The linework IS the rendering — there is no painted surface beneath it. Style references: Albrecht Dürer portrait engraving, 1950s Penguin Classics author frontispiece, Dover Publications scientific portrait plate, Field Notes back-cover etching, 19th-century medical textbook plate.
>
> COLOR — locked: Single ink color is a saturated DARK burnt-orange #C84A1E — the color of dried pumpkin skin, of old letterpress hot-foil, of a Penguin Classics spine. NOT peach. NOT coral. NOT salmon. NOT light orange. DARKER and MORE SATURATED — this is INK, with weight. Background is warm cream paper #F2EBDC with very subtle natural paper grain only.
>
> COMPOSITION — enforced: The illustration occupies only the CENTRAL 50% of the vertical frame. The TOP 25% and BOTTOM 25% of the frame are EMPTY CREAM PAPER — no illustration, no shading, no marks, no edge bleed — just clean cream paper grain for typography to be composited later by Remotion.
>
> No text, no logos, no lettering anywhere in the image.
>
> Avoid: watercolor, ink splashes, paint splatter, gradients, glossiness, drop shadows, smoothed digital painting, colored pencil tonality, soft airbrush, generic Canva aesthetic, sans-serif, modern startup minimalism, gold-foil cliché, photorealism, color photography, additional colors beyond burnt-orange and cream, peach, coral, salmon, light-orange, AI-influencer face, plastic skin, symmetric face.

## Tool Settings (raw-illustration mint pass)

- `--model gpt-image-2` (default) — handles the etching register acceptably. Seedream untested.
- `--aspect-ratio 2:3` — 1080×1620 source.
- `--quality high`
- Cost: ~$0.05/illustration. ~2 min per call. 9 in one batched call ≈ 3 min total.

## Production Render Path — gpt-image-2 Layout Pass (locked 2026-05-29)

**The Remotion `Carousel` composition is no longer the production path.** It was the v1 default; the v2 finding is that submitting each illustration + a verbatim-text + per-slide `layout_direction` instruction to gpt-image-2's image-edit endpoint produces **dramatically better editorial typesetting** than what we could hand-design in TSX.

The model wraps text around the illustration as a curated magazine spread — pull-quotes in burnt-orange italic, ragged columns, asymmetric negative space — that would take days to tune by hand. Cost: ~$0.10/slide layout pass, ~3 min in parallel.

**The new pipeline:**

```
1. Author <job_dir>/carousel.json (Claude — see carousel_pipeline.md)
2. uv run python agent/tools/mint_carousel_illustrations.py --job <id>
   → 9 raw illustrations in <job_dir>/images/slide_NN.png
3. uv run python agent/tools/layout_carousel.py --job <id>
   → 10 SHIPPABLE slides in <job_dir>/images/slide_NN_layout_v1.png
```

Total cost per coach carousel: **~$1.50, ~6 minutes**.

**Remotion `Carousel.tsx` is retained as a fallback/preview path** — useful when you need pixel-perfect text rendering, when image-gen quota is exhausted, or for live iteration on layout before committing to gpt-image-2 spend. Invoke via `agent/tools/render_carousel.py`. Treat it as the "draft" renderer; the gpt-image-2 layout pass is the "press".

## Production Findings (v2 → ship)

- **Font drift is correct.** gpt-image-2 ignores explicit Garamond requests and renders in Bodoni / Didone. This is the right call for the editorial register — high-contrast Bodoni reads MORE Penguin-Classics-era than Garamond would. Do not fight the drift.
- **Per-slide `layout_direction` is the key creative knob.** Vary the layout pattern slide-to-slide so the swipe has visual rhythm. Patterns proven in the Alissa pilot:
  - `cover_centered` — portrait + headline below + tagline (slide 1)
  - `pull_quote_top` — three-tier hierarchy: lead → orange pull-quote → coda (slides 2, 4, 7, 8)
  - `side_caption_right` — illustration shifted left, narrow column on right (slides 3, 5)
  - `magazine_spread` — narration split LEFT and RIGHT of a centered narrow illustration (slide 6)
  - `chapter_opener` — diagnosis line treated as oversized chapter title (slide 9)
  - `typography_hero` — no illustration, stat as visual centerpiece (slide 10)
- **Illustration regenerates slightly under image-edit.** gpt-image-2 redraws portions of the source — books reshape, faces shift. For our engraving register this is fine (high tolerance for line variation). For any future style pack where pixel fidelity matters (photoreal portraits, named-person likeness), test before committing.
- **Closing slide uses the stamp as the reference image**, not an illustration. The stamp gets composited into the layout and the stat is the visual hero.
- **Handle correctly preserved.** gpt-image-2 renders `@coachgems_` (trailing underscore intact) when explicitly named in the prompt. Don't trust it to invent — always pass the verbatim handle.

## Layout Contract (for `Carousel.tsx`)

| Region | Purpose | y-range (of 1350) |
|---|---|---|
| Top margin | Header chip / narration line 1 | 0–270 |
| Illustration band | Image (centered, scaled to width=1080) | ~270–1080 |
| Bottom margin | Narration body / handle footer | 1080–1350 |
| Footer | `@josephchinbuilds` in burnt-orange | 1305–1350 |

Cover and closing slides also place the Coaching Gems stamp (existing asset at `_brand_coaching_gems/images/concept_b_wordmark_stamp.png`).

## Emphasis Markup

Narration prose uses `[[double brackets]]` to mark burnt-orange emphasis phrases. The renderer parses and applies `color: #C84A1E` to those spans inline. Example:

```
Most high-performers think loyalty to one powerful boss is [[career insurance]].
```

## Open Questions (revisit after pilot)

- Should slides 3–9 carry an octagonal art-deco border around the illustration (echo of the stamp), or only cover + closing?
- Should the handle footer use the gem-frame motif as a separator above it?
- Seedream vs gpt-image-2 head-to-head for the engraving register.
