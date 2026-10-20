# Carousel Pipeline — Instagram Editorial Carousels for @coachgems_

This is the canonical workflow for producing a 10-slide Instagram carousel about a coach we've already made a video for. **Read this in full before authoring any new carousel.**

The carousel is a PARALLEL content track to the video pipeline (`CLAUDE.md`) — same coach base, different distribution surface, different scrutiny mode. Where the video doctrine is photoreal-avatar + dense-script + sit-and-watch, the carousel doctrine is **low-fidelity-illustration + editorial-prose + swipe-and-skim**.

## First Principle — Low Fidelity Hides AI Tells

The carousel uses hand-engraved illustration + typeset prose (NOT photoreal AI imagery). The reason:

> **Low-fidelity illustration hides AI-gen tells. Photoreal AI gets scrutinized on a swipe; sketchy ink-and-engraving gets forgiven and lets the *story* land instead of the pixels.**

This is the inverse of the video pipeline's photoreal-avatar doctrine — different surface, different scrutiny mode. Lean into mark-making, not realism.

## When to Use This Pipeline

Trigger conditions (all must hold):
1. The coach has a shipped `<job_dir>/final.mp4` (the video work that earned the carousel)
2. The coach has a populated `<job_dir>/vision.md` (the log-line + IVP + mechanism + signature element)
3. The coach has a populated `<job_dir>/script.json` (the prose we'll riff off)
4. There's an active brand-identity style pack at `agent/skills/carousel_styles/<pack>.md` (currently only `coaching_gems_v1`)

If those four hold, the carousel takes ~6 minutes and ~$1.50 in image-gen spend per coach. Cheaper and faster than any other content surface in the pipeline.

## The 5-Step Workflow

```
1. Author <job_dir>/carousel.json    (Claude — see "Authoring the narrative")
2. Optionally surface the prose for early feedback
3. Mint raw illustrations            (uv run python agent/tools/mint_carousel_illustrations.py --job <id>)
4. gpt-image-2 layout pass           (uv run python agent/tools/layout_carousel.py --job <id>)
5. Surface all 10 slides for review  (Read each PNG inline — rule 23 equivalent menu after)
```

### Step 1 — Author the narrative

Read these inputs before writing a single word of narration:
- `<job_dir>/vision.md` — pull the `log_line`, `IVP`, `core_drive`, `mechanism`, `signature element`, `lore_positioning`
- `<job_dir>/script.json` — the 4-beat arc baked into the video; the carousel narrative riffs off the same arc in a different voice
- `<job_dir>/website_context.txt` — for the coach's brand URL + tagline

Then author `<job_dir>/carousel.json` following the schema in the next section. The narrative is **original prose** — third-person omniscient narrator voice, present-tense, propulsive, scene-driven. Do NOT directly reuse captions or dialogue from the video script. The carousel is a *parallel* story about the same subject matter, written in a different register.

**The 10-beat narrative arc (proven on the Alissa pilot):**

| # | Beat | Voice |
|---|---|---|
| 1 | Cover | Editorial issue header + featured name + tagline |
| 2 | Contradiction hook | "[Common belief] feels like X. It's actually the trap that does Y." |
| 3 | The IVP | "You know the type. [3 fragments naming the IVP's identity.]" |
| 4 | The seductive pitch | "Then [the antagonist mechanism] leans in: '[quoted seductive line]'. It feels like winning." |
| 5 | The illusion | "[Surface result of the trap]. The [trap mechanism] works." |
| 6 | The hidden mechanism | "But here's what's really happening: [the real trap]. [Specific consequences in fragments]." |
| 7 | The wall | "Then one day [trigger event]. The [trap mechanism] disappears." |
| 8 | The fallout | "[Antagonist response]. '[Damning quoted line.]'" |
| 9 | The diagnosis | "[Coach] calls it a [coined term]. [Lesson about visibility/agency]." |
| 10 | Closing | Big stat (HBR or equivalent) as visual hero + stamp + URL |

Voice rules (learned from the Alissa pilot — purge these AI-tells in every narration):
- **No em dashes.** Replace with periods or commas.
- **Avg ~14 words per slide.** Cap at 18. Trim mercilessly.
- **No narrative connectives like "But here's what's really happening:" or "Then one day,"** — these are AI tells. Lead with the substance.
- **Three-fragment parallels are powerful but use sparingly** — one or two slides max, not every slide.
- **Quoted dialogue beats summary every time.** When the narrative needs an antagonist line, render it as a verbatim quote, not "they said something to the effect of…"

**Emphasis markup:** the prose embeds `[[double-bracket phrases]]` to mark burnt-orange italic emphasis. Each slide has ONE emphasis phrase that becomes the visual pull-quote. Pick the phrase that carries the slide's beat — the sharpest, most concrete, most quotable line.

`build_carousel` removes these brackets from typeset copy and sends the marked phrases as separate styling instructions. This applies to cover, beat, and closing-slide text, including `stat_body`, in both layout modes. The authored `carousel.json` keeps its markup.

### Step 2 — Optional early prose review

Surface the full narrative as **one copy-paste-ready prose block** with `[[emphasis]]` markup intact and clear slide labels. Per the global verbatim-prose memory rule: when the user edits the prose and pastes it back, EVERY WORD survives verbatim in the next version. Only edit at explicit `[markers]` they flagged. Never silently rewrite for tightness, casing, or "better voice."

Continue to step 3 without a ceremonial approval. If the user edits the prose,
preserve every word verbatim in the next version. Spend authorization is handled
independently at paid operation boundaries.

### Step 3 — Mint raw illustrations

```bash
uv run python agent/tools/mint_carousel_illustrations.py --job <id>
```

This reads `carousel.json`, pulls the `CORE_STYLE_BLOCK` from the named style pack, composes `{CORE_STYLE_BLOCK}\n\nSCENE: {scene}` per slide, and dispatches `generate_image.py` in parallel. Outputs to `<job_dir>/images/slide_NN.png`.

Cover slide's illustration is NOT minted from carousel.json — it points at an external asset (e.g. the locked Coaching Gems brand-portrait). Closing slide has no illustration (typography-hero). Other 8 slides get fresh mints.

Cost: ~$0.05/slide × 8 = ~$0.45, ~3 min in parallel.

### Step 4 — gpt-image-2 layout pass

```bash
uv run python agent/tools/layout_carousel.py --job <id>
```

This is the PRODUCTION render path. For each slide it composes a layout-direction prompt (LOCKS the palette + serif + cream paper + verbatim text + per-slide layout pattern) and dispatches `generate_image.py --reference <raw illustration>`. gpt-image-2 typesets the prose around the illustration as a curated editorial spread.

Outputs to `<job_dir>/images/slide_NN_layout_v1.png` — the SHIPPABLE artifacts.

Cost: ~$0.10/slide × 10 = ~$1.00, ~3 min in parallel.

### Step 5 — Inspect and optionally surface for review

Read each of `<job_dir>/images/slide_NN_layout_v1.png` inline (per the always-show-image
memory) and inspect the full 10-slide carousel under thumb in one scroll. When useful,
surface an honest per-slide verdict + an optional edit-suggestions menu:

- **HIGH-IMPACT**: re-mint specific raw illustrations that didn't land
- **SUBTLE**: tweaks to layout directions and resubmit individual slides
- **WHAT I WOULDN'T DO**: anti-patterns for THIS brand (lock to the style pack)

Fix clear mechanical defects and apply the strongest grounded refinement bundle by default.
When the user explicitly requested review, iterate from their picks. Don't bulk-re-run.

## `carousel.json` Schema

```json
{
  "version": "v2",
  "style_pack": "coaching_gems_v1",
  "handle": "@coachgems_",
  "issue_number": <int>,
  "featured_name": "<COACH NAME IN CAPS>",
  "brand_url": "<their domain>",
  "brand_tagline": "ONE COACH · ONE IDEA · ONE MINUTE",
  "log_line": "<verbatim from vision.md log_line>",
  "stamp_asset_relpath": "_brand_coaching_gems/images/concept_b_wordmark_stamp.png",
  "slides": [
    {
      "index": 1,
      "kind": "cover",
      "layout": "cover_centered",
      "header_chip": "COACHING GEMS · ISSUE N",
      "headline": "COACH NAME",
      "tagline": "On <one-line subject>",
      "illustration_source_relpath": "<path to portrait>",
      "layout_direction": "<verbatim prompt for layout pass>"
    },
    {
      "index": 2,
      "kind": "beat",
      "layout": "pull_quote_top",
      "narration_plain": "<lead sentence ending with a space if it flows into the emphasis>",
      "narration_emphasis": "<the burnt-orange italic pull-quote phrase>",
      "narration_continuation": "<the closing sentence after the emphasis>",
      "illustration_source_relpath": "images/slide_02.png",
      "illustration_scene": "<scene description for mint pass>",
      "layout_direction": "<verbatim prompt for layout pass>"
    },
    {
      "index": 10,
      "kind": "closing",
      "layout": "typography_hero",
      "stat_display": "<big stat string, e.g. \"23%\">",
      "stat_body": "<body sentence containing the stat context, with one phrase to be set italic burnt-orange>",
      "closer_line": "<final 2-clause meditation>",
      "illustration_source_relpath": null,
      "stamp_source_relpath": "_brand_coaching_gems/images/concept_b_wordmark_stamp.png",
      "layout_direction": "<verbatim prompt for layout pass>"
    }
  ]
}
```

### `kind` field — three slide variants

- `cover` — `header_chip`, `headline`, `tagline`. Uses an external portrait as `illustration_source_relpath`.
- `beat` — `narration_plain`, `narration_emphasis`, `narration_continuation`. Mints its own illustration from `illustration_scene`.
- `closing` — `stat_display`, `stat_body`, `closer_line`. NO illustration; uses stamp as reference.

### `layout` field — proven variants

Pick the layout per slide so the swipe has visual rhythm. Don't use the same layout twice in a row.

| Layout | When | Pattern |
|---|---|---|
| `cover_centered` | Cover only | Portrait centered, headline below, tagline beneath, header chip top |
| `pull_quote_top` | Default beat | Three-tier: lead serif at top → orange italic pull-quote → italic coda |
| `side_caption_right` | When the illustration can shift left | Illustration left half, narration column right half |
| `magazine_spread` | When the illustration is narrow + vertical | Narration split LEFT and RIGHT of a centered illustration |
| `chapter_opener` | The diagnosis / coined-term beat | Pull-quote treated as oversized chapter title |
| `typography_hero` | Closing | No illustration, big stat as hero, stamp + URL below |

### `layout_direction` field — the key creative knob

Per-slide free-text prompt that gpt-image-2 reads literally. Be specific. Name where the pull-quote goes ("upper right", "across two lines"), what register ("Bodoni display", "italic editorial"), how tight ("ragged-right column", "centered hero"). The Alissa pilot's `layout_direction` strings are the reference for what good ones look like.

## Review opportunities

Three useful review points where user feedback is the source of truth, none of
which is a production-authorization gate:

| # | Artifact | Why inspect | Cost of missing a defect |
|---|---|---|---|
| 1 | `carousel.json` narrative | Prose is the load-bearing thing; verbatim-edit rule applies | $1.50 + 6 min of image-gen on prose the user wanted different |
| 2 | Raw illustrations (after step 3) | Catch a slide whose mint clearly missed the scene | One re-mint costs $0.05 |
| 3 | Final laid-out slides (after step 5) | Last call before posting | Free to re-run layout pass with adjusted `layout_direction` |

All three are optional; the agent may continue while keeping results visible and
responsive to user corrections.

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Soft pencil-sketch register instead of hard etching | Prompt didn't hit Dürer/Dover refs hard enough | Tighten with specific artist names + "every individual ink stroke must be visible as a discrete line" |
| Peach/coral drift instead of burnt-orange | gpt-image-2 has a strong color prior | Explicitly negative against peach/coral/salmon by name |
| Font drifts to Bodoni when you asked for Garamond | The model picks the more editorial register | Accept it — Bodoni reads MORE Penguin-era. Don't fight the drift. |
| Illustration regenerates slightly under image-edit | gpt-image-2 image-edit redraws portions | Acceptable for engraving register. If pixel fidelity matters, use Remotion fallback path. |
| Hallucinated text in the output | Layout prompt didn't quote the verbatim text precisely enough | List the text in numbered blocks with explicit role labels; "do not paraphrase, do not insert words" |
| Wrong handle (e.g. defaults to `@josephchinbuilds`) | Handle not explicitly named in layout prompt | Always pass the verbatim handle in the prompt footer directive |

## Bulk Running Across the Coach Roster

When running carousels for multiple coaches in sequence, batch by 3-5 to keep review overhead low. For each batch:

1. Read each coach's `vision.md` + `script.json` (parallel reads)
2. Author all batch narratives in one response, surfaced as parallel prose blocks
3. Incorporate any user edits received in that round
4. Run `mint_carousel_illustrations.py` + `layout_carousel.py` for each coach in turn, each as a foreground call (each tool already parallelizes its own slides; never start background or parallel processes)
5. Surface all batch outputs inline for review

Per-batch cost: 3-5 × $1.50 = $4.50-$7.50. Per-batch time: ~15 min from narrative draft to surface.

## References

- Style pack: [`coaching_gems_v1.md`](carousel_styles/coaching_gems_v1.md) — locked illustration aesthetic + anti-patterns
- Mint tool: `agent/tools/mint_carousel_illustrations.py`
- Layout tool: `agent/tools/layout_carousel.py`
- Fallback renderer: `agent/tools/render_carousel.py` + `agent/remotion/src/Carousel.tsx`
- Reference job (pilot): `agent/output/alissafinerman.com-20260515-uiw8um/carousel.json` — read this first to see a working schema in production
