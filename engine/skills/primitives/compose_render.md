# compose_render — the canonical Remotion compositor

THE assembly step: takes the transcript + `style_directives.json` + overlay/caption/B-roll layers
and renders the final video. This is the canonical way captions, overlays, cards, hijacks, and
B-roll get composited into a file. Folds in `remotion_render.py` (115 calls, 16 sessions) and
the underlying `remotion` CLI (291 calls across many sessions), plus the long-form episode
assemblers `assemble_episode.py` (20 calls) and `make_episode.py` (15 calls). Fixes the
persistent 1080p-only friction: every past render ended with a manual `ffmpeg` downscale because
`remotion_render.py` hardcodes 1080p — `--resolution` ends that. Also gates on overlays: draft-1
historically shipped captions-only despite overlays being documented as the default layer (the
overlays-gate flag).

```
compose_render --job <job> --mode <mode> \
               [--resolution {1080p|720p}] \
               [--loudnorm] \
               [--pre_roll <seconds>] \
               [--style_directives <json_path>] \
               [--overlays_tsx <path>] \
               [--caption_break {sentence|word|duration}] \
               [--caption_vertical_anchor <0.0-1.0>] \
               [--emphasis_style <style_name>] \
               [--hide_ranges "<start-end,...>"] \
               [--episode_manifest <json_path>]
```

`--mode` is **required** and logged as `usage_role`.
`--resolution` defaults to `720p` (MEMORY: `feedback_seedance_720p_default.md` — only escalate to
1080p when the user asks). `--loudnorm` runs EBU R128 normalisation on the output audio.

Set both `width` and `height` in `style_directives.json` for an exact final canvas.
These dimensions take precedence over the resolution preset, including its default.
Both must be positive even whole pixels for H.264; the local input ceiling is 8192
per edge and 33177600 total pixels to prevent unbounded render allocations. An
invalid/partial canvas fails before rendering; it is never silently resized.
Without an explicit canvas, standard render/retrofit follow the source video's
orientation: a portrait source renders on 1080x1920, a landscape one on 1920x1080,
a square one on 1080x1080. A job with a `video_transform` (browser-card frame,
focus punches, blurred fill, cover crop) keeps 1080x1920, because that framing is
authored for the vertical frame. To put a landscape source in a vertical frame
without a `video_transform`, set `"width":1080,"height":1920` explicitly.
Resolution presets then cap the short edge without upscaling
or changing the display ratio. Standard render/retrofit and legacy Remotion honor
the canvas; finishing and pre-roll preserve it. Cover baking follows the body's
display canvas unless given explicit dimensions, containing the body and cropping
the cover card. Bespoke keeps its authored composition. The authority-host episode
recipe's assemble/make paths keep their portrait default when no canvas is set. If dimensions are explicit,
it accepts only 1080x1920 and refuses other canvases before starting; use an appropriate
custom assembly for another shape until that separate recipe is updated. A manifest
with no explicit canvas preserves its spine's display size, normalizing rotation and
non-square pixels before inserting cutaways; it does not apply a resolution cap.

Author `overlays.tsx` from its `width`/`height` props, never a fixed 1080×1920:
[`overlay_authoring_guide.md`](../overlay_authoring_guide.md) §2 gives the portrait
and landscape bands.

For local/custom assembly, do not inspect this tool's source to discover the
invocation. Once `jobs/<id>/final_raw.mp4` exists, the canonical final pass is:

```bash
uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/compose_render.py" \
  --job <bare-id> --mode render --resolution 720p
```

`--mode retrofit` is only for an existing external/source video and requires
`--source_video`; it is not the local `final_raw.mp4` completion path.

For a complete bespoke composition, author every source file under
`<job_dir>/remotion/` and run:

```bash
uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/compose_render.py" \
  --job <bare-id> --mode bespoke --entry remotion/index.ts \
  --composition <composition-id> [--props remotion/props.json] --out final.mp4
```

The installed engine supplies dependencies and the render lock. Do not write
job source into its `remotion/src` tree or call `npx remotion render` directly.
`jobPublicPath` is reserved and injected by the renderer for job-local assets.

The 3-layer style discipline applies at all times: (1) caption layer — transcript-driven, word-timed;
(2) overlay layer — `overlays.tsx` authored externally per `overlay_authoring_guide.md`;
(3) B-roll layer — asset paths wired through `style_directives.json`. Authoring `overlays.tsx`
is a style/skill artifact, not a tool call — do not conflate it with rendering.

---

## `render` — standard short-form render (the default path)
- **purpose:** render a final 9:16 Reel / short-form video from transcript + overlays + B-roll.
- **use_when:** any job that ends with a finished mp4 — captions on, overlays applied, audio mixed.
- **do_not_use_when:** you need to add overlays to footage that already exists (→ `retrofit`); you
  need to bake a cover card into the head of an existing mp4 (→ `cover_bake`); the output is a
  multi-episode assembly (→ `episode`).
- **inputs:** job dir with `transcript.json` (word-timed) + `style_directives.json` +
  `_currentJobOverlays.tsx` (or equivalent `overlays.tsx`) + B-roll assets already on disk.
- **success_check:** overlays render on their declared beats; captions present and correctly
  timed; no black frames; audio present and at target loudness. Overlays must render, not just
  captions (the draft-1 overlays failure mode); `verify_output` frames show this when you
  suspect a problem.
- **backend:** `remotion_render.py` → `remotion` CLI → `npx remotion render`. Font-bundling errors
  (Fraunces / Space Grotesk path) recur — fix by confirming font paths in `fonts.ts` before render.
- **fallback:** on font-bundling errors, verify `agent/remotion/src/fonts.ts` exports; clear
  `.remotion/` cache and re-run. On overlay-not-rendered, confirm `overlays.tsx` exports the
  correct composition name expected by `Root.tsx`.
- **evidence:** `remotion_render.py` 115 calls / 16 sessions; `remotion` CLI 291 calls.

---

## `retrofit` — add overlays to an existing video
- **purpose:** layer captions + overlays onto a video that has already been rendered or acquired
  (no re-generation of underlying footage).
- **use_when:** the base mp4 is final but needs caption burn-in, overlay cards, or hijack text
  added in post. The "add overlays to an existing video" path.
- **do_not_use_when:** you're rendering from scratch (→ `render`); the underlying footage still
  needs to be generated.
- **inputs:** `--source_video <mp4>` + job transcript (re-used for caption timing) +
  `style_directives.json` (overlay/caption spec only).
- **success_check:** source footage untouched under the overlay layer; captions match original
  audio timing; no encoding artefacts on the composite.
- **backend:** Remotion with source video as the background composition input.
- **fallback:** if word-timing is stale (source was densified after transcript was written),
  re-run `densify --mode normal` to regenerate the PASS-2 transcript before retrofitting.
- **evidence:** mode specified in canonical tool brief; retrofit path was the desired behaviour in
  several overlay-iteration sessions where re-rendering the full avatar would be wasteful.

---

## `cover_bake` — bake a cover card into the head of an existing mp4
- **purpose:** prepend or composite a cover frame / title card into the first N frames of a
  finished video (the "cover bake" path).
- **use_when:** the video is fully rendered and a cover card (from `mint_image --role cover`) needs
  to be burned into the file, not just overlaid as metadata.
- **do_not_use_when:** cover is an Instagram/Publer thumbnail only (→ `make_cover`, a delivery
  tool, not `compose_render`); you need a full re-render (→ `render`).
- **inputs:** `--source_video <mp4>` + `--cover_image <png>` + `--cover_duration <frames>`.
- **success_check:** first N frames show the cover card; seamless cut to main footage; audio
  starts with the main footage, not during the cover.
- **backend:** Remotion image-sequence composition or ffmpeg concat (whichever avoids re-encoding
  the body).
- **fallback:** if Remotion concat degrades quality, drop to `ffmpeg -i cover.mp4 -i body.mp4
  -filter_complex concat=n=2:v=1:a=1 out.mp4`.
- **evidence:** mode specified in canonical tool brief; `make_cover.py` 27 calls / 4 sessions
  (the suggest+stylize step — `cover_bake` is the bake-in step that follows).

---

## `episode` — long-form multi-episode assembly
- **purpose:** assemble a sequence of chapters / episodes into one long-form mp4 (the book-video
  / Coaching Gems episode path).
- **use_when:** the job has an `episode_manifest.json` defining ordered segments with per-segment
  captions, title cards, and music.
- **do_not_use_when:** single short-form Reel (→ `render`).
- **inputs:** `--episode_manifest <json>` + per-episode assets already on disk + optional
  `--pre_roll <seconds>` for an intro slate.
- **success_check:** episode count matches manifest; chapter title cards render; continuous audio
  across segment boundaries; total duration within expected range.
- **backend:** `assemble_episode.py` (20 calls) + `make_episode.py` (15 calls), both routed
  through the Remotion compositor.
- **fallback:** if a segment fails to render, isolate it by running `compose_render --mode render`
  on the single-episode job dir, then concat with `ffmpeg`.
- **evidence:** `assemble_episode.py` 20 calls (d0cbec5a); `make_episode.py` 15 calls (d0cbec5a).

---

## Style directive reference

These params translate directly into `style_directives.json` fields and are validated at render
time (set them before calling `check_layout`):

| param | values | effect |
|---|---|---|
| `--caption_break` | `sentence` / `word` / `duration` | caption chunk size; `sentence` is the Coaching Gems default |
| `--caption_vertical_anchor` | `0.0`–`1.0` | vertical position of caption block (0 = top, 1 = bottom); writes `caption_style.vertical_anchor_ratio`, the exact property the renderer reads |
| `--emphasis_style` | style name (e.g. `pop`, `glow`, `underline`) | how emphasised words render |
| `--hide_ranges` | `"<start>-<end>,..."` | suppress captions over these time ranges (e.g. during a card beat) |

---

## NOT this tool

- **`overlays.tsx` / `_currentJobOverlays.tsx` authoring** — a style/skill artifact produced by
  the agent following `overlay_authoring_guide.md`. Writing TSX is not a `compose_render` call.
- **`ffmpeg` standalone** — `compose_render --resolution 720p` replaces the manual post-render
  ffmpeg downscale. Direct `ffmpeg` calls are a fallback path only, not a peer tool.
- **`make_cover.py`** — the suggest + stylize step that produces the cover PNG. The bake-in step
  is `compose_render --mode cover_bake`.
- **`check_layout`** — the pre-render gate (face/caption collision, anchor validation, luminance).
  Run it before `compose_render`, not instead of it.
- **`verify_output`** — the post-render mechanical frame/audio check. It reads
  `compose_render`'s output; it is not part of the render itself.
