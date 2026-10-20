# mint_image — the canonical image primitive

One provider-neutral gateway contract, parameterized by `--role`. Nano Banana 2
is the Release 0.0.11 default (text endpoint without references, edit endpoint
with references); `--model gpt-image-2` is the explicit A/B/rollback rail. Keeps
`generate_image.py`'s `--job --name` convention (it already encodes role); folds in
`gen_image.py` (josephchin fork, raw output paths) and `mint_carousel_illustrations.py`
(a `card` variant).

```
mint_image --job <job> --role <role> --name <name> --prompt "..." \
           [--reference <png|url>] [--aspect 1:1|2:3|9:16] [--quality high] [--background auto|transparent|opaque]
```

**⛔ Transparency (live incident 2026-07-16):** native background parameters are not
part of the provider-neutral contract; the legacy GPT deployment rejects
`background: transparent` and can still bill a failed prediction. The tool never sends it: `--background
transparent` **auto-routes through the chroma-strip** (generate on a flat #FF00FF
background, colorkey to clean RGBA — the founding-session overlay technique), so you
still get a transparent PNG. Non-PNG output can't carry the colorkeyed alpha →
`--background transparent` with jpeg/webp fails fast client-side, before any spend.

`--role` is **required** and logged as `usage_role`. Evidence: 261 classified image runs
from the archived generation-role analysis.

**Aspect ratios (expanded 2026-07):** `1:1 · 3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · auto`.
Use **`--aspect 9:16`** to mint **native 1080×1920 vertical** stills for reels — no more
extending from 2:3. (Gateway mode: the deployed videoclaw-backend must also allow the value;
if a ratio 400s, update the gateway's `aspect_ratio` allow-list and redeploy.)

**Timing + batching:** Nano normally completes in seconds; the explicit GPT rail can take
~90–130s. Keep a ≥300s safety timeout so a client never abandons paid queued work. Several stills → **one `--batch` call, never
one process per still** (parallel processes serialize and each races its own timeout):

```
mint_image --job <job> --role seed_frame --batch stills.json
# stills.json: [{"name":"b1","prompt":"..."},{"name":"b2","prompt":"...","aspect":"2:3"}, ...]
```

The batch is submitted together and polled together (≈ one still's wall clock for the lot;
the gateway paces submissions at the vendor's sustainable rate). A logical 5–10 variant item
is split into provider-supported chunks of at most four. Per-item failures don't kill
the batch — survivors land in `images/` + `_index.json`, the summary names the losers, exit
code is non-zero; retry with a specs file of just the failed items.

---

## `card` — 117 runs (the dominant image role)
- **purpose:** a self-contained card / mockup / receipt the viewer reads — mat cards, platform mockups, book-recommendation cards.
- **use_when:** the beat needs a designed object carrying text/graphics, often composited onto a surface (the cutting-mat) or floated on a transparent background.
- **do_not_use_when:** it's a small icon/screenshot (→ `overlay`); it will become motion (→ `seed_frame`); it's the speaker's face (→ `portrait`).
- **inputs:** prompt; usually `--reference step0_empty.png` (the empty mat) for placement; `--aspect 1:1` or `2:3`.
- **outputs:** one PNG (often transparent-bg for compositing).
- **success_check:** frame-extract → Read; **glyphs legible** — cards carry text and garbled text is the #1 failure mode; edges clean.
- **backend / fallback:** Nano Banana 2 by default; use explicit GPT only for an evidenced capability exception/A-B, never as a silent retry. On garbled text, regenerate or set text in Remotion.
- **evidence:** `[b186ab52] …/edit/cards/b2_hire_or_diy.png`

## `seed_frame` — 55 runs
- **purpose:** a still **destined to become motion** via `mint_video --mode keyframe` (the first or last frame).
- **use_when:** you want a hero/lingering moment — generate the matched `_first` and `_last` frames, then interpolate.
- **do_not_use_when:** the still is itself the final asset (→ `card` / `overlay` / `artistic_still`).
- **inputs:** prompt; a continuous `_first`/`_last` pair; `--aspect 2:3` typically.
  A genjutsu seed frame (a swap clip's first frame with the characters replaced) takes the
  source clip's aspect instead: `mint_image --role seed_frame --aspect 9:16 --reference
  <first frame> --reference <character image>…` for a vertical clip (see `mint_video.md`).
- **success_check:** the pair is visually continuous (same subject, lighting, framing) so interpolation doesn't morph.
- **evidence:** `[b186ab52] …/broll_keyframes/b4_generalist_last.png`

## `overlay` — 35 runs
- **purpose:** a transparent-bg asset laid over footage — icons, line-art, app screenshots, tweet/post mockups.
- **use_when:** you need a small graphic element on top of video.
- **do_not_use_when:** it's a full designed card (→ `card`); it carries the main beat (→ a `mint_video` mode).
- **inputs:** prompt; `--aspect 1:1`; `--strip-chroma` (default **ON** — auto colorkey + alpha-normalize to clean RGBA; 4 sessions did this by hand: 371a0e39, 86dc34db, 88ca2208, fa4fc83a). Transparency comes from the chroma-strip, never from `background: transparent` (the deployment rejects it — see the guard above); `--background transparent` is accepted but auto-routes to the same chroma path.
- **success_check:** clean alpha edges; legible at small size.
- **evidence:** `--name icon_accept_palm … "minimalist hand-drawn line-art icon"`; dark-mode tweet mockups.

## `cover` — 18 runs (two-phase, paired with `make_cover`)
- **purpose:** the Reel / post cover thumbnail.
- **use_when:** end of pipeline, packaging a finished video.
- **flow:** `make_cover suggest --video <mp4>` (pick a strong frame) → `mint_image --role cover --base-frame <frame>` (stylize it).
- **do_not_use_when:** any mid-pipeline visual (use the matching role).
- **success_check:** legible at thumbnail size; on-brand; real host features preserved (never hallucinate the face).
- **evidence:** `make_cover.py suggest / generate … cover_07`

## `portrait` — 20 runs
- **purpose:** a reference-conditioned still of the (real or generated) speaker — anchor / identity frames.
- **use_when:** you need a consistent face/identity still, conditioned on `--reference`.
- **do_not_use_when:** it's the avatar **character-sheet** for idea-to-avatar → that's `generate_avatar.py` (orchestrator), not this.
- **success_check:** identity matches the reference; no AI-tell artifacts (hands, text, props).
- **evidence:** `…/reference_frames/…cream_pullover … "Polished studio portrait"`

## `artistic_still` — 16 runs
- **purpose:** a styled still for artistic / essayistic B-roll — the "fine-art" look (ukiyo-e, woodblock, painterly).
- **use_when:** voiceover-over-art beats; mood / essay content.
- **do_not_use_when:** you need photoreal, or a designed card.
- **inputs:** prompt heavy on art-style markers; often a `--reference` for cross-shot consistency.
- **note:** this is the **in-context-style path — prefer it over a trained LoRA** unless the default edit rail repeatedly loses the style.
- **evidence:** ukiyo-e / Hiroshige-Hokusai woodblock matrices.

---

## NOT mint_image
- `generate_avatar.py` — the idea-to-avatar **casting step** (job-driven, BytePlus-hosted refs), not a free image call.
- `make_cover suggest` — a frame-picker that reads a finished video; only the `generate` half is a `mint_image --role cover` call.

## Open edge
~47 image runs are `UNCLASSIFIED` — lead candidate for a 7th role, `background / scene`
(full-frame photoreal environments). Pressure-test before freezing the role set.
