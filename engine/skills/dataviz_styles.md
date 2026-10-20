# Data-viz styles — animated stat / chart overlays (L3 generic taste)

Animated **stat** and **chart** primitives for explainer / "here's the number" /
before-vs-after shorts. This is the missing capability the OpenMontage comparison (P3)
surfaced: videoclaw could not render an animated chart. These are **overlays in the
existing `compose_render` pipeline** — no new tool, no new runtime.

- **Components:** [`remotion/src/dataviz.tsx`](../remotion/src/dataviz.tsx) —
  `StatCounter`, `BarChart`, `ComparisonBar` (+ dispatcher).
- **Contract:** the `dataviz` array in `schema.ts` (`DataVizSchema`).
- **How they render:** `compose_render` reads `dataviz` from the job's
  `style_directives.json` and passes it through to the renderer; `Captioned.tsx`
  time-anchors each in a `<Sequence>`.

## Authoring — add to `style_directives.json`
```json
"dataviz": [
  { "kind": "stat", "start": 6.0, "end": 10.5, "position": "center",
    "value": 2400000, "prefix": "$", "label": "raised in the first 48 hours",
    "theme": { "bg": "#FBF6EF", "color": "#2A2018", "accent": "#E8A33D", "text_color": "#6B5B4A" } },
  { "kind": "bar", "start": 12, "end": 17, "suffix": "%",
    "series": [ {"label": "Us", "value": 92}, {"label": "Competitor", "value": 61} ] },
  { "kind": "compare", "start": 20, "end": 24, "suffix": "s",
    "series": [ {"label": "Before", "value": 8.4}, {"label": "After", "value": 1.2} ] }
]
```

| kind | use for | key fields |
|---|---|---|
| `stat` | one hero number (revenue, count, %). Counts up. Auto-fits long numbers. | `value`, `prefix`, `suffix`, `label`, `decimals` |
| `bar` | ranking 2–5 categories. Staggered grow-in. | `series[{label,value,color?}]`, `suffix`, `decimals` |
| `compare` | before/after, us-vs-them (exactly 2). Second bar takes the accent. | `series` (2), `suffix` |

Common: `start`/`end` (seconds), `position` (`top`/`center`/`lower-third`/`bottom`),
`theme`. **Motion is built in** — every primitive animates on ([`static-motion`]).

## Theme (resolve from the tenant brand pack — L4)
`theme` fields: `font_family`, `color` (hero number ink), `accent` (bar fill /
highlight), `bg` (card background; `null` = transparent), `text_color` (labels),
`radius`. Omit `theme` → tasteful generic defaults (Inter, teal accent, white card).
**Pull these from `taste/packs/<tenant>/README.md`, don't invent per-video.**
- **JosephChinBuilds:** warm — `bg #FBF6EF`, `color #2A2018`, `accent #E8A33D`,
  `text_color #6B5B4A`. Matches the WARM grade + kraft-mat card.

## Anti-slop rules
- **One stat per beat.** A number the viewer can't read in 2s isn't a stat, it's noise.
- **Round for legibility** (`$2.4M` reads faster than `$2,437,914` — but the count-up to
  a precise number can be the point; choose deliberately).
- **No 3-D, no pie for >3 slices, no gratuitous gridlines/axes.** These are hero cards,
  not dashboards.
- **≤5 bars.** More than that, it's a table — cut it or split across beats.
- **Anchor to the spoken beat** — the number appears as the VO says it, not before.
- **Keep the card off the face** in a talking-head (`position: lower-third` or a
  b-roll beat), and let `check_layout` validate the anchor + caption-safe luma.

## Checks
`check_layout` validates the overlay anchor + luma before the render. Keep the chart's
text/font on the brand spec — an off-brand chart font is the common miss.
A `promise.json` may declare `"dataviz": ["stat"]` for a soft delivery check (future).

## Not yet built (Phase 2)
`LineChart` (trend draw-on), `ProgressRing` (%), `KPIGrid` (2–4 stats). Add to
`dataviz.tsx` + `DataVizSchema` following the same theme/motion contract.
