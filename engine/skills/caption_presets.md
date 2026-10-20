# Caption presets — the blessed caption looks (opt-in, no default)

This is about the **visual style of burned-in captions** (font, color, casing, box,
position). For caption *copywriting* (the words / social post text) see
[`caption_craft/`](caption_craft/SKILL.md) — different concern.

## ⛔ There is NO default caption look — you must choose one ON PURPOSE

`compose_render` **hard-errors** if captions are on but no style was chosen. Every
render that shows captions has to name a preset deliberately. This is intentional:
the old silent all-caps karaoke default was the thing we were trying to kill.

Pick one of the six presets by either:

- `--caption-preset <name>` on the `compose_render` command, **or**
- `"caption_preset": "<name>"` in the job's `style_directives.json`, **or**
- a full explicit `"caption_style": {…}` in `style_directives.json` (escape hatch
  when none of the presets fit — but prefer a preset), **or**
- `--no-captions` if this render should have NO captions at all.

You can layer overrides on top of a preset: set `caption_preset` AND a partial
`caption_style` — the explicit fields win over the preset's.

## The presets

Source of truth: [`remotion/src/caption_presets.json`](../remotion/src/caption_presets.json)
(typed wrapper: [`caption_presets.ts`](../remotion/src/caption_presets.ts)).
Reference renders on real footage: [`examples/caption-presets/`](../examples/caption-presets/).

| Preset | Look | Reach for it when |
|---|---|---|
| `tiktok` | White sentence case on a soft black pill | Safe neutral default; any talking-head where you want zero fuss |
| `clean` | Thin white text, no box, tight tracking | Premium / minimal / calm; the footage carries the energy |
| `mono` | lowercase monospace on a dark chip | Tech, dev, build-in-public, product |
| `highlighter` | Active word in a sky-blue marker box; rest stay white | Punchy retention edits; want a karaoke read without all-caps shouting |
| `editorial` | Italic Playfair serif, no box | Luxury, thought-leader, brand film |
| `handwritten` | Caveat script, pale-yellow active word | Warm, personal, coaching / vlog |

Match the preset to the **tenant brand spec** (`taste/packs/<tenant>/README.md`) — the look
is a brand choice, not a default. `[GENERIC]` videos still must pick one consciously.

## How it renders (so overrides make sense)

- `transform`: `none` (sentence case) is the norm now; `uppercase`/`lowercase`/`capitalize` available.
- `highlight_mode`: `"color"` (active word changes text color) or `"box"` (active word
  gets a filled marker box — the `highlighter` preset). In box mode **every** word
  reserves the same padding so the line never reflows/jiggles when the highlight moves.
- `outline_width_px: 0` opts out of the auto-stroke guardrail (clean/editorial/handwritten
  lean on a heavier drop-shadow instead). Omit it and a min stroke is enforced for legibility.
- `font_family` must resolve in [`remotion/src/fonts.ts`](../remotion/src/fonts.ts).
  To add a font: shortlist via the Google Fonts catalog API (filter by `category`),
  register the `@remotion/google-fonts/<Family>` loader in `fonts.ts`, then audition it.

## A preset is a starting point

A preset sets the look; placement is still yours. Keep captions off faces and out of the
platform red zones, and make sure they read against the footage behind them.
