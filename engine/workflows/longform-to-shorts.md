# longform-to-shorts — one long video → many vertical hook shorts

A forward recipe for the **"source → shorts"** family where you START WITH FOOTAGE:
a long talk / interview / call, cut into one or more 30–60s vertical (9:16) shorts,
each opened by a hook, the speaker locked in frame, captions + a brand layer burned in.
This is the **generic L2 spine**; it wears a tenant **brand pack** (L4) — e.g. an
"outlier" reel = THIS workflow × [`taste/packs/<tenant>/`](../taste/packs/<tenant>/README.md).

> **STATUS (2026-07-04):** validated live by a first end-to-end run —
> **`jobs/<lecture-example>`** (2026-07-01, variant A2: a long-form lecture source,
> 1h47m YouTube → one 52.9s 9:16 hook short, reviewed and receipt-stamped under the earlier
> process; logged spend **$0.05** — SAM3 was the only paid Replicate call). Evidence + defect
> ledger below; Steps 5 (b-roll LOOK) and 6 (Remotion compose) were NOT exercised — still unproven.

All tools run from repo root `/Users/chin/projects/videoclaw` as
`uv run python tools/<tool>.py` with **`--job <id>` explicit**. Shared skills carry the load:
[`skills/evaluation.md`](../skills/evaluation.md) (the eval law),
[`skills/broll_styles.md`](../skills/broll_styles.md) (look treatments + the LOOK menu).
Every Replicate call routes through `replicate_safe` automatically (hang-proof + cost-logged).

---

## The three variants (pick by what the source is)
| Variant | Source | Distinctive mechanic |
|---|---|---|
| **A1 · Multi-angle interview cut** | 2+ synced cameras | cut to whoever is speaking (`--diarize` tells you who); each beat self-contained (video+audio from the SAME source file) so lip-sync can't drift |
| **A2 · Long talk → many hook shorts** | one long single-cam talk | extract N independent hook-driven clips; non-linear sentence re-order; brand scraped from the client's site (`website_style`) |
| **A3 · Talking-head reel from a call** | a long Zoom/desk take | one reel; full-color subject over a treated b-roll look; faceless full-screen variant as a cheap derivative |

The spine below is shared; variant-specific steps are marked.

---

## Input
| Input | Where it comes from |
|---|---|
| **Source video(s)** | the long take(s). A1 = 2+ synced angles; A2/A3 = one long file. `pull_video` pulls/normalizes a URL or local file. |
| **Brand pack** | the tenant's L4 pack — fonts, caption style/preset, masthead, b-roll LOOK menu, layout grammar. Unstated → smart defaults. (A2: `website_style --url <client-site>` to recover fonts+palette.) |
| **Hook stance** | Use the tenant's stated hook/angle when provided; otherwise choose the strongest grounded candidate. Surface the plaintext transcript and candidates when useful, without making a human hook-pick a render prerequisite. |

## Output
`<job>/output/<clip-N>.mp4` — one or more ~30–60s vertical reels: speaker locked in
frame, hook title up front, brand captions + masthead, a chosen b-roll LOOK on the
fill, every QA beat's mechanical observations empty.

---

## Steps

### Step 0 — One-time environment `[GENERIC]`
`cd remotion && npm install`, then stub orphan caption JSONs (see
[`workflows/avatar-speaker.md`](avatar-speaker.md) Step 0). EVAL: none.

### Step 1 — Ingest + transcribe + UNDERSTAND the source `[GENERIC]`
- **(a) Generate:** normalized `<job>/source/*.mp4` + a word-level **diarized** `transcript.json`
  (each word carries `start`/`end` + `speaker`; a `speakers` list), AND — for anything that
  rests on understanding the source — a structured Gemini read of what's actually in it.
- **(b) Command:**
  ```bash
  uv run python tools/pull_video.py --job $JOB --mode pull --url <url> --name source   # → footage/source.mp4 (a local file: --file <path> instead of --url)
  uv run python tools/synth_voice.py --job $JOB --mode transcribe --audio footage/source.mp4 --diarize
  # DEEPER understanding (optional paid analysis; host/gateway authorization applies): a Gemini pass over the
  # source to map topics / who-says-what / the strong moments, NOT just the transcript:
  uv run python tools/analyze_reference.py --job $JOB --mode video --reference jobs/$JOB/footage/source.mp4   # Gemini eyes on the whole take
  ```
  For A1, before anything: fix the iPhone-4K-portrait `rotation=-90` matrix (ffmpeg auto-rotates).
- **(c) Source:** the long take(s).
- **(d) Why:** the diarized transcript is the edit surface — every hook, cut, caption, and
  speaker-cut anchors to real word timings + speaker labels. The client's note: *"just transcribing
  is good, but we should understand this more deeply"* — the Gemini read is that depth, spent only
  when the cut decision needs it (it costs a call; skip for a simple A3 reel).
- **(e) EVAL:** transcript covers the full runtime, no empty result; for A1 confirm `speakers`
  has ≥2 labels and turns alternate sensibly.

### Step 2 — Find hooks + author the clip plan `[BRAND: hook stance]`
- **(a) Generate:** `<job>/clips.json` — per clip: in/out spans (may be **non-linear** —
  re-ordered sentences), the hook line, a headline/title-card, the on-screen layout, the
  b-roll-fill intent. **Find-hooks = a Gemini-ranked-candidates pass:** feed the diarized
  transcript (+ the Step-1 understanding) to `analyze_reference` / a `gemini_video` custom pass
  and ask it to rank the strongest hook windows (timestamp + why) — Gemini SURFACES candidates,
  and the agent selects the strongest grounded option by default. Surface the plaintext transcript
  and candidates for optional tenant feedback; explicit tenant choices override the default.
- **(b) Command:**
  There is NO tool mode for this yet (the thin `find_hooks` wrapper is unbuilt) — run the
  ranked-candidates pass yourself: feed the diarized transcript to Gemini
  (`gemini_video --mode custom --prompt "<transcript + 'rank the strongest hook windows,
  timestamp + why'>"`) and author `clips.json` from the strongest grounded candidates or any
  explicit tenant picks.
- **(c) Source:** `transcript.json` (+ Step-1 understanding) + the tenant's hook stance.
- **(d) Why:** the hook IS the short — rank and inspect it before render, but do not require a
  separate human creative approval to continue. Paid operations remain subject to host spend policy.
- **(e) EVAL — `check_script`:** run it over each clip's spoken text for WPM/word-budget. No
  generation $ is spent yet; this catches a bad caption source early.

### Step 3 — Cut + reframe vertical, speaker locked `[GENERIC]`
- **(a) Generate:** `<job>/cuts/<clip-N>_raw.mp4` — the spans cut and reframed to 9:16 with the
  **speaker locked in frame** via SAM3. A1 cuts to the speaking angle per `speaker` turn; each
  beat carries its own audio (no splice drift).
- **(b) Command:**
  ```bash
  # pull_video --file/--output and sam3 --video/--out resolve from the working
  # directory (the workspace root holding jobs/), not from the job folder
  uv run python tools/pull_video.py --job $JOB --mode pull --file jobs/$JOB/footage/source.mp4 \
      --in <s> --out <e> --output jobs/$JOB/cuts/clipN_span.mp4
  uv run python tools/sam3.py reframe --job $JOB --video jobs/$JOB/cuts/clipN_span.mp4 --prompt "person" \
      --out jobs/$JOB/cuts/clipN_raw.mp4          # SAM3 locates the subject → subject-centered 9:16 crop
  ```
  `sam3 reframe` uses a fixed subject-centered crop (locks the speaker, no follow-crop jitter);
  if the subject moves out of a fixed crop, split the span and reframe each part.
- **(c) Source:** `clips.json` spans + `source/*.mp4`.
- **(d) Why:** a vertical crop that loses the speaker is the #1 reframe defect (*"his face eats
  into the left on zoom — shift him right"*). SAM3 centers on the actual subject, not the frame middle.
- **(e) EVAL:** `verify_output --mode render --input cuts/clipN_raw.mp4 --strip` → `Read` the
  filmstrip; speaker in frame throughout, no off-canvas clip, correct rotation.

### Step 4 — Densify (kill silences / pace) `[GENERIC]`
- **(a) Generate:** `<clip-N>_raw.mp4` re-paced + a PASS-2 `transcript.json`.
- **(b) Command:** `uv run python tools/densify.py --job $JOB --mode normal --speed 1.15`
  (per-clip rate). `densify` silence-clips inter-word gaps + time-stretches + re-transcribes —
  it operates on a stitched audio+video + transcript, which is exactly what a cut clip is, so it
  applies directly. (`--mode aroll` for a real-footage talking-head; `--mode smart` to hit a WPM target.)
- **(c) Source:** the cut clip + its transcript.
- **(d) Why:** silence-killing + a 10–20% speed-up is the near-universal finishing move.
- **(e) EVAL:** read `densify_meta.json`, confirm `final_wpm` in band; `verify_output --mode audio`
  → no clipping / dead air.

### Step 5 — Select + apply the b-roll LOOK, fill the b-roll `[BRAND: look menu]`
- **(a) Generate:** background/fill b-roll for the non-talking-head beats (A3) or cutaways (A1/A2),
  all in ONE chosen **LOOK** locked for the clip/series. **Humans stay full-color — the look hits
  the b-roll only** (mask the person with `sam3` if compositing a look behind them).
- **(b) Command — select the strongest grounded LOOK**, then source + treat. Prefer an
  explicit tenant choice; otherwise infer from the tenant pack, source, and clip intent.
  Surface the look menu when useful for optional feedback:
  ```bash
  # retrieval-first: the tenant's own media, THEN royalty-free stock, THEN generate.
  uv run python tools/index_media.py search "<describe the b-roll>" --tenant <t> --job $JOB
  uv run python tools/pull_video.py --job $JOB --mode pull --url <pexels/unsplash/pixabay/archive.org> --name brollN
  uv run python tools/mint_video.py --job $JOB --mode insert --resolution 720p --reference <look-exemplar.png> ...   # generate (last resort, reference-style)
  # apply the chosen LOOK — e.g. FS-dither (broll_styles.md #19):
  ffmpeg -y -i brollN.mp4 -vf "format=gray,eq=contrast=1.06,format=monob,format=yuv420p" \
      -sws_dither ed -c:v libx264 -crf 14 -pix_fmt yuv420p brollN_dither.mp4
  # stills get a default Ken Burns slow-zoom (broll_styles.md cross-cutting rules).
  ```
  Acquisition has **many sources** (license-free images + videos: Pexels/Unsplash/Pixabay,
  archive.org public-domain). Looks: FS-dither, a tenant reference-style identity, real-stock, or
  archival (`broll_styles.md`). **One look per clip/series; no b-roll reuse.**
- **(c) Source:** `clips.json` b-roll intent + the tenant's look menu.
- **(d) Why:** a single consistent look unifies varying b-roll quality; receipts/real footage beat
  synthesis when a real thing is named; the look menu makes style alternatives legible without
  creating a selection gate.
- **(e) EVAL:** `Read` each fill inline; on-look, legible, relevant to the spoken line, no reuse.
  Continue with the strongest grounded look by default. Pause only if the user explicitly
  requested selection or a material style input is genuinely unresolved.

### Step 6 — Compose: captions + masthead + brand layer `[BRAND: caption/overlay pack]`
- **(a) Generate:** `<job>/overlays.tsx` (persistent masthead/handle, hook title card, end CTA) +
  `style_directives.json` (the tenant **caption preset**), then the render.
- **(b) Command:**
  ```bash
  printf '{"caption_preset": "<tenant>"}' > jobs/$JOB/style_directives.json   # no implicit default
  uv run python tools/check_layout.py --job $JOB --role anchors
  uv run python tools/compose_render.py --job $JOB --mode retrofit \
      --source_video cuts/clipN_raw.mp4 --caption_break sentence
  ```
- **(c) Source:** the densified clip + PASS-2 transcript + the brand pack.
- **(d) Why:** captions + masthead are the brand layer; the layout check catches face/caption
  collisions before the render is spent.
- **(e) Craft:** `check_layout` clean before the render (it is **blind to JSX** overlays, so
  place those by hand) — caption never over the face, bottom-anchored centered pill, masthead
  clear of the head.

### Step 7 — Finish
The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). Preserve the source's meaning,
hook/payoff and all required people in frame.

### Step 8 (optional) — Faceless full-screen variant `[GENERIC]` (A3)
Re-compose the same cut with NO faces: full-screen b-roll + big uppercase captions (tenant's
faceless font, e.g. Anton) over the original audio. A cheap derivative deliverable.

---

## First run — evidence + defect ledger (`<lecture-example>`, 2026-07-01)
Unattended overnight run: 1h47m long-form lecture source → one 52.9s A2 short, QA-passed. Trail:
`jobs/<lecture-example>/run.log.jsonl` + `review_output.md`.

- **The spine held end-to-end:** yt-dlp *windowed* pull (85s around the pick, not the full talk)
  → Scribe transcribe → SAM3 subject-lock → `densify --mode aroll` (64.4s → 52.9s @ 1.1×,
  222 WPM) → captions + hook-card compose → generate→verify QA. Logged spend: **$0.05** total.
- **SAM3 reframe: proven, with a caught bug** — first call failed (`Could not load frames from
  video`, a real `_clip_video` bug, fixed mid-run); then a 6s **mask-only sample** located the
  subject (centroid x=0.556) and a fixed ffmpeg 9:16 crop locked him. Mechanic validated; mind
  the upscale cost (720p source → 405px-wide crop → 1080×1920).
- **Find-hooks: still manual, but the shape is proven** — an agent-run ranked-candidates pass
  over the YouTube caption transcript surfaced 6 windows; human delegated the pick ("go with
  what u think") → the #1-ranked window. The thin `find_hooks` wrapper remains unbuilt.
- **QA earned its keep: 2 real defects found + fixed** — white captions blending into the
  speaker's white shirt (thin outline → heavy outline+shadow) and the blue hook pill covering
  his mouth/chin 0–3s (→ moved lower, shortened to <2.5s). Both frame-verified, re-rendered,
  stamped. The per-beat `slop` verdict label was skewed exactly as predicted — gate on
  observations, not the label.
- **NOT exercised (gaps still open):** Step 5 b-roll LOOK (no b-roll in this clip — the
  look-menu UX is unproven), Step 6 `compose_render`/Remotion (the historical
  unattended run used a legacy ffmpeg text fallback; new typography uses the
  Remotion/SVG/ASS rail), `--diarize` (single speaker), and
  the Step-1 deep Gemini read (hooks came from YouTube captions).
- **Human verdict:** greenlit next morning ("it's cool") — the substantive feedback all landed
  on the Family-B (article→PIP) run, none against this short.

---

## Cross-cutting rules
- **Speaker locked in frame** via `sam3 reframe`; split the span if the subject leaves a fixed crop.
- **A1 beats are self-contained** (video+audio same source) → lip-sync can't drift; `--diarize` drives the speaker-cut.
- **Densify per clip.**
- **Select one grounded b-roll LOOK per job** and surface the menu when useful for optional
  feedback; one look per clip/series; **no b-roll reuse**;
  **humans full-color**, treatment on b-roll only; **stills get Ken Burns by default.**
- **Acquire from many royalty-free sources** before generating; **style-by-reference, not LoRAs.**
- **Surface the plaintext transcript and hook candidates when useful**; accept optional
  creative feedback without waiting for it. Provide cost/time as advisory context when requested,
  while the host owns authorization.
- **Every intermediate step gets a real EVAL. Gemini is EYES, not TASTE.**
- **Brand swap:** the only tenant-specific parts are the brand pack (fonts, caption preset,
  masthead, look menu, layout grammar). Swap the pack → the spine is identical.

## Tools used (all real)
`pull_video` · `synth_voice --mode transcribe --diarize` · `analyze_reference` (understand +
find-hooks) · `check_script` · `sam3 reframe` · `densify` · `index_media` · `mint_video`/`mint_image`
(reference-style) · FS-dither recipe (`broll_styles.md` #19) · `website_style` (A2) · `check_layout`
· `compose_render` · `verify_output`. Replicate calls auto-route through `replicate_safe`.
