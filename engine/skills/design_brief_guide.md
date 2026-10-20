# Design Brief Guide — `<job_dir>/design_brief.md`

**This is the contract between the script + final_raw and what gets rendered.** Without a design brief, draft 1 lands at "captions-only competent talking-head" — that's the failure mode this skill exists to prevent.

The brief is **agent-authored** and **binding on `<job_dir>/overlays.tsx`**. Anything specified here MUST appear in the rendered video; anything not specified gets a documented "deliberate skip" line. It is a production artifact, not a human-approval contract.

---

## When to author

**AFTER `final_raw.mp4` exists and passes its mechanical readiness checks** (and after
`score.py` if a music bed is in scope). The brief needs the **PASS 2 transcript
timestamps** + the **actual avatar performance** + the **verified final_raw duration**
to anchor beats correctly; human approval is not an authoring prerequisite.

**BEFORE `remotion_render.py`**. Surface the brief when useful, author
`overlays.tsx`, and continue rendering; do not stop for ceremonial approval.
The mechanical requirement is a concrete brief + `overlays.tsx`, not a human yes.

---

## Required reading before drafting

1. `agent/skills/typography_palette.md` — pick ONE palette letter for this job (Claude is the suggestor — pick the one you think fits and surface the rationale at checkpoint #6; the user can override)
2. `<job_dir>/vision.md` — register / IVP / lore positioning
3. `<job_dir>/character_sheet.json` — `avatar_vision` + wardrobe + setting tones
4. `<job_dir>/script.json` — `post_production_notes` per chunk. **Treat these as a FIRST-PASS SKETCH, not a binding spec.** They were written at script time without real transcript timestamps and without the avatar's lived performance. Re-evaluate every entry against the actual `final_raw.mp4` and PASS 2 transcript. Some notes will still be right; others will need re-anchoring (e.g. timestamps shifted by densify), refinement (e.g. cutout-icon idea → full-screen takeover when the beat carries more weight than the script anticipated), or deletion (e.g. an overlay you intended is now redundant with what Seedance baked into the chunk). Surface any meaningful divergence from the original notes in the brief's `## 11. Documented skips` so the rationale is auditable.
5. `<job_dir>/transcript.json` (PASS 2) — every word's start/end ms
6. `<job_dir>/selected_video.json` + the analysis JSON — reference outlier's structural beats (NOT its aesthetic — see CLAUDE.md rule 20 #6 framing)

---

## File structure (10 sections, all required)

```markdown
# Design Brief — <Company> (<Avatar / Lore Subject>)

## 0. Snapshot
- Final raw duration: <Xs>
- Target effective WPM: <Y>
- Word count: <N> (from transcript.json)
- Reference outlier: <URL>

## 1. Visual register
Claude picks ONE palette letter from `typography_palette.md` and surfaces the rationale to the user at checkpoint #6: [A / B / C / D / E / F / G / H]
Why this palette: <one sentence — tie to vision.md position + energy_register>
(The user may override the suggestion. If they do, document the override in `## 11. Documented skips`.)

## 2. Typography palette (cascades into style_directives.json + overlays.tsx)
| Slot | Family | Weight | Style | Size | Casing |
|---|---|---|---|---|---|
| Caption body | <e.g. Inter> | 800 | normal | font_size_ratio: <0.024> | UPPERCASE |
| Caption emphasis | <e.g. Playfair Display Italic> | 700 | italic | 1.18× body | Mixed Case |
| Overlay header | <e.g. Inter> | 800 | normal | width × 0.04 | UPPERCASE |
| Overlay body | <e.g. Inter> | 700 | normal | width × 0.03 | sentence |
| Numeric / stat display | <e.g. Inter> | 900 | normal | width × 0.36 | — |
| Handwritten accent (optional) | <e.g. Caveat> | 700 | normal | 1.25× | mixed |

## 3. Color palette (3-5 hex values max)
- Primary: <#hex> — used for <where>
- Secondary: <#hex> — used for <where>
- Accent: <#hex> — used for <where>
- Caption body color: <#hex>
- Caption emphasis color: <#hex> (or "same as body" if no highlight)
- Active-word color: <#hex> (or "same as inactive" for palettes A/F/H)

## 4. Caption directives (→ `style_directives.json:caption_style`)
```json
{
  "font_family": "<from §2>",
  "font_size_ratio": <0.022-0.028>,
  "vertical_anchor_ratio": <0.50-0.65>,
  "color": "<from §3>",
  "active_word_color": "<from §3>",
  "italic_word_starts_ms": [<list from §5 emphasis beats — see below>],
  "hide_ranges_ms": [[<start>, <end>], ...]
}
```

## 5. Per-beat overlay manifest
Anchored to transcript word starts. Format = one row per beat, ordered chronologically:

| t (s) | Beat | Treatment | Asset(s) | SFX | Notes |
|---|---|---|---|---|---|
| 0.0–<X> | Hook treatment | <In-camera diegetic action OR custom typography reveal> | <png list> | <sfx> | |
| <signature stat> | Signature-stat takeover | <Full-screen / floating callout / etc.> | <png list> | <sfx> | |
| <chunk N visualizer> | <Q1 icon / list item / etc.> | <design> | <png list> | <sfx> | |
| ... | ... | ... | ... | ... | ... |
| <lore beat> | Brand introduction card | <Slide-in lower-third with real headshot> | diane_headshot.jpeg | whoosh | |
| <callback> | Final hold-frame | <Italic serif top-of-frame quote> | — | — | |

Every cell must be concrete. Vague entries ("some kind of card") fail the brief.

## 6. Required-overlay checklist
Each of these MUST be in §5. If skipped, write a one-line reason in `## 9. Documented skips`.

- [ ] Hook treatment (in-camera diegetic OR custom typography — NOT just standard captions)
- [ ] Signature-stat moment (any moment where a number / framework name / proof point lands)
- [ ] Per-chunk visualizer for at least 50% of chunks (icons / cards / cutouts / mock-ups)
- [ ] Brand introduction card at the lore beat with **real brand assets** (not placeholder graphics — pull headshot/logo from company website)
- [ ] Closing callback hold-frame
- [ ] Audio SFX layer (minimum one cue per overlay entry; phone-tap / whoosh / click / impact / warning)

## 7. Asset manifest
Every image asset to generate BEFORE authoring overlays.tsx. Author with `generate_image.py`.

| Name | Model | Aspect | Prompt summary | Magenta bg? |
|---|---|---|---|---|
| `icon_phone_dinner` | gpt-image-2 | 1:1 | <one line> | yes |
| `stat_card_85_pct` | gpt-image-2 | 2:3 | <one line> | yes |
| ... | ... | ... | ... | ... |

Magenta-chroma-key bg = `#FF00FF`, set explicitly in the prompt; ffmpeg `colorkey` strips it post-gen.

Brand asset note: for the brand introduction card, **fetch the real headshot / logo / tagline from the company website** via WebFetch + curl. Do not generate fake headshots — the credibility of the credible-witness handoff depends on the real face.

## 8. SFX manifest
Every cue with timing + source.

| t (s) | Cue | Source | Volume |
|---|---|---|---|
| 1.0 | soft click | `catalog:ui.click.soft@1` | 0.7 |
| 1.96 | light impact | `catalog:impact.light@1` | 0.55 |
| ... | ... | ... | ... |

Search `sfx_catalog` first. If no exact cue fits, document silence or ask the user for a licensed
file; do not generate, scrape or silently substitute.

## 9. Motion vocabulary
- Spring physics: <damping / stiffness ranges>
- Transition style: <pop / fade / slide / scale / cross-dissolve>
- Per-overlay entry: <how does it arrive on screen — slam-in / build-word-by-word / soft-fade / pull-from-edge>
- Continuous effects: <gate weave / film grain / parallax / clean-locked — pick ONE OR none>
- Camera moves (only if scripted in seedance prompts): <pull-back / push-in / locked>

## 10. On-brand / off-brand contracts
Two columns. Concrete, not vague.

| ON-brand | OFF-brand |
|---|---|
| <e.g. cream pill with deep-navy keyline> | <e.g. saturated red with thick white outline> |
| <serif italic emphasis> | <bright blue color highlight> |
| <gate weave on stat card> | <smooth Hollywood zoom> |
| <real Diane headshot> | <AI-generated stand-in> |

## 11. Documented skips
For each unchecked box from §6: one-line "why skipped" justification.

E.g.: "Per-chunk visualizer skipped for chunk 1 (setup) because the chunk is 6s of pure verbal transition; an icon would be more clutter than signal."
```

---

## Writing the brief — process

1. **Read everything in `Required reading` above.** Don't skip.
2. **Pick the typography palette** (one letter from typography_palette.md). Default toward palettes the avatar's natural publication would print in.
3. **Map every beat to a transcript timestamp.** Open `transcript.json`, walk word-by-word, identify signature moments (stats, framework names, brand mentions, CTAs, callbacks).
4. **Fill §5 (per-beat manifest) FIRST** — the rest of the brief cascades from this.
5. **Then derive §4 (caption directives)** — italic_word_starts_ms is just the timestamps of words in §5 you want emphasized; hide_ranges_ms is the windows where overlays cover the captions.
6. **List EVERY asset** in §7 before claiming the brief is done. If you can't list it, you can't author it.
7. **SFX manifest §8** — use stable catalog IDs only where a cue earns its place. Silence is
   valid; if no catalog cue fits, ask rather than generate.
8. **Surface the brief inline as rule 20 #6 when useful.** Invite optional per-section
   feedback, then continue unless the user explicitly requested review before rendering.
9. **Then author `overlays.tsx`.** Implement every row of §5 + §7 + §8 + §9. The brief is binding.

---

## Anti-patterns

- **"We'll figure out the overlays during the render step."** No. The render step bakes everything; iteration is expensive. Spec it up front.
- **Single-palette overlays with no variance.** Every overlay using the same pill background reads as one-note. The palette provides 3-5 colors + 2 fonts — use the range.
- **Brand introduction card without the real headshot.** A generated face for "Diane Gottsman" undermines the credible-witness handoff completely. Pull the real photo.
- **Captions at platform default.** Inter-uppercase-with-blue-highlight is functional and forgettable. The brief should always pick a deliberate caption typography.
- **SFX skipped without catalog search.** Search stable IDs first. If nothing fits, document the
  intentional silence or ask for a licensed user file.
- **Reference outlier's aesthetic copied wholesale.** The reference is a STORY blueprint, not a STYLE blueprint. Brand-aligned visual treatments override reference fidelity unless the reference's aesthetic IS the load-bearing thing being copied.

---

## Examples

For a worked example, see `agent/output/protocolschooloftexas.com-20260511-v3uqzu/design_brief.md` (the reference job this skill was developed against, post-hoc).
