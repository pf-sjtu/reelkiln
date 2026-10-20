# article-to-shorts — an article / newsletter (TEXT) → vertical short(s)

Start from TEXT (a newsletter, LP letter, article or news item). For new presenter
dialogue, follow the [talking-head default](README.md#talking-head-default): an approved
voice plus real-footage lipsync, with the shared fallback and cost tradeoffs. The text
being new does not require a new synthetic identity. The historical generated-host
build below remains an optional explicit synthetic variant. Two presentation shapes:

| Variant | Look | Use when |
|---|---|---|
| **B1 · Corner-PIP avatar** | a cut-out avatar in a corner reads it, over b-roll + info cards | newsletter / news-recap; "less-AI" relaxed register; the avatar can look like ANYTHING |
| **B2 · Cinematic stylized explainer** | the avatar lives INSIDE a stylized scene; b-roll is composited into the scene | a stylized "channel" look — see the worked example below |

> **B2 is a GENERAL shape, not one gimmick.** The workflow is "build a stylized explainer
> *character + scene*, and composite the b-roll INTO that scene cinematically." The
> **TV-screen retro-broadcast** build (b-roll composited inside a vintage TV via `frame_insert`,
> fingers hanging over the black edge) is just **one worked EXAMPLE** of B2 — the same spine
> produces other stylized scenes (a desk monitor, a projector wall, a phone in-hand).

This is the generic L2 spine; it wears a tenant **brand pack** (L4). A newsletter sub-brand
and a stylized retro-broadcast "channel" are their **own tenants**, not part of the base pack.

> **STATUS (2026-07-01):** **VALIDATED on the B1 path** by `jobs/<article-example>/`
> (a long-form article source → 77s vertical short, `final.mp4`, receipt-stamped under the earlier process).
> **B2 (frame_insert / retro-broadcast scene) is still unproven** — that run never exercised it.
> Logged Replicate spend was ~$0.20 (SAM3 only); Seedance perform_avatar, 11× gpt-image-2,
> fal sync-3 long, and ElevenLabs TTS were uncosted in the log — headline cost not cleanly
> derivable from `run.log.jsonl`. Reuses [`avatar-speaker.md`](avatar-speaker.md) +
> [`broll-voiceover.md`](broll-voiceover.md) for the avatar+VO+b-roll mechanics — read those;
> this references, never repeats, them.

All tools run from repo root as `uv run python tools/<tool>.py` with `--job <id>` explicit.

---

## Input
| Input | Where it comes from |
|---|---|
| **The text** | the newsletter / article / LP letter / news item. The whole script derives from it. |
| **Presenter identity** | Reuse the approved person and a real take; cast only for an explicitly synthetic variant. B1 is a PIP reader; B2 places the presenter inside a scene. |
| **Voice** | Existing clean performance or approved `reference_tts` for new dialogue; preset/designed TTS for an explicitly synthetic narrator. See `skills/voice.md`. |
| **Brand pack** | the tenant's L4 pack (fonts, captions, cards, layout). |

## Output
`<job>/output/final.mp4` — a ~40–70s vertical short reading the text: the approved presenter
(corner-PIP or inside a stylized scene), b-roll, brand captions + title/info cards + an end CTA
("Comment X"), every QA beat's mechanical observations empty.

---

## Steps

For the default approved presenter, use the article/script and composition steps here
with [aroll-reel](aroll-reel.md) for the speaking track and lipsync. Skip the synthetic
casting/performance steps 2–3. The old host initialization commands are for the
explicit synthetic variant only; packaged apps use their installed Studio environment.

### Step 0 — Environment `[GENERIC]`
`cd remotion && npm install` + stub orphan caption JSONs (see [`avatar-speaker.md`](avatar-speaker.md) Step 0).

### Step 1 — Extract the brand voice + the substance, then write the script `[BRAND: voice]`
- **(a) Generate:** `<job>/script.json` — the text distilled to a punchy hook-led script in the
  tenant's voice (contractions throughout). Two understanding inputs first:
  - **Brand-voice extraction:** if the tenant has prior issues / a style bible, `analyze_reference`
    (Gemini) reads them for tone/register; otherwise the brand pack's voice section is the source.
  - **Newsletter → substance:** the agent reads the text and pulls the hooks/claims worth keeping;
    fact-check against the source (guard against drift). Surface the **plaintext script** when
    useful for creative feedback, but do not make human hook approval a production prerequisite.
- **(b) Command:** authored by the agent against the tenant voice + the source text.
  ```bash
  # Brand-voice extraction is an AGENT read today (no tool mode): read the prior issues /
  # style bible yourself and distill register + phrasing. For shipped-VIDEO brand DNA use
  # analyze_reference --mode video --reference <a prior reel>.
  uv run python tools/check_script.py --job $JOB --method seedance --skip-llm   # the pre-gen gate
  ```
- **(c) Source:** the article/newsletter text + the tenant voice.
- **(d) Why:** the script is the whole video; the source is raw material. The client: *"how do we get
  the brand voice? extract from the newsletter? write good scripts? — be clear on the tools."*
- **(e) EVAL — `check_script`:** 0 BLOCKING. Keep Seedance chunks short (5–7s) per the avatar guide.

### Step 2 — Cast / reuse the host `[BRAND: host look]`
- **(a) Generate:** `<job>/avatar/avatar_front.png` (+ character sheet). B1 = relaxed, "less-AI",
  flat older-iPhone lighting, minimal mic, **constant eye contact**; B2 = the stylized-scene character.
- **(b) Command:** `uv run python tools/cast_avatar.py --job $JOB --role reader` (or reuse a blueprint).
- **(c)/(d) Source/Why:** the brand host look. **Inspect the still inline before motion**
  (`Read` it; the sandbox burned credits when a regen silently changed the face). Surface it for
  optional creative feedback when useful, but do not wait for human approval. No legible-text props.

### Step 3 — Generate the talking layer `[BRAND: framing]`
- **B1 (corner-PIP) — improved: base clips + relip.** Generate a FEW short **~15s base avatar
  clips** (idle/talking loops), then **lip-sync the script onto cuts of them** — relip at the cut
  level rather than one long continuous generation (the client's improvement; cheaper + more varied,
  reuse-and-relip). Then SAM3-cut-out the avatar for the corner tile.
  ```bash
  uv run python tools/perform_avatar.py --job $JOB --role reader --resolution 720p   # base clips
  uv run python tools/lipsync_footage.py gen --job $JOB                              # fal sync-3, our voice, per cut
  uv run python tools/sam3.py segment --job $JOB --video clipN.mp4 --prompt "person" # cut-out → corner PIP
  ```
- **B2 (stylized scene):** Seedance native-audio (or perform_avatar) for the in-scene host;
  lip-sync only if you're driving a non-native voice (always fal sync-3 via `lipsync_footage`).
- **(e) EVAL:** `gemini_video --mode chunk_review --chunk all`; regen ONLY on mechanical defects.
  **Hands/fingers are the #1 tell** — tight crop / one hand away / cover with b-roll. **Cut** a
  voice-garble, never paper over it.

### Step 4 — Densify `[GENERIC]`
`densify --mode normal --speed <rate>`; read `densify_meta.json`, confirm WPM + no clipping.

### Step 5 — B-roll: choose the LOOK + source it `[BRAND: look menu]`
- **(a)/(b)** Select the strongest grounded LOOK from an explicit tenant choice or the
  tenant pack, source, and script intent. Surface the menu when useful for optional feedback;
  pause only if the user requested selection or a material style input is genuinely unresolved.
  Retrieve real first (`index_media`), then royalty-free stock (`pull_video` →
  Pexels/Unsplash/Pixabay/archive.org) — many of these clients want **real stock over AI**;
  use a brand's real wordmark when named. Ken-Burns stills by default; apply the selected look
  (FS-dither / reference-style identity) to b-roll only.
- **(c)/(d)/(e)** relevance is a chronic miss (*"listen to the script, then find the right videos"*);
  no reuse; `Read` each inline.

### Step 6 — Compose the variant layout `[BRAND: layout]`
- **B1 · Cut-out avatar (DYNAMIC — not a boxed corner tile):** SAM3 cut-out the avatar's
  FOREGROUND (drop his background entirely) and composite him ONTO the b-roll so he integrates —
  never a boxed webcam tile showing his own room (craft law, 2026-07-01). Then make him a **dynamic element**
  (`skills/broll_styles.md` cross-cutting "visual interest" rule): **move him around the frame during
  silences** to a natural explaining spot; **go FULLSCREEN on impactful lines**; take him **off-screen
  entirely** when the b-roll carries the beat. Plus stacked info cards + end CTA card.
  **B-roll under/around him cuts every 1–3s** (visual storytelling, not decoration).
- **B2 · Cinematic stylized explainer (`frame_insert`):** composite each b-roll clip INTO the
  scene's frame/screen — `frame_insert --screen-prompt "<the screen>"` (SAM3-detects the region) +
  `--occluder-prompt "fingers"` (keeps them in front). The inserted content renders as a
  vignette-to-black lit screen. Interleave archival full-screen cutaways (Ken-Burns). **Cadence:
  2–3s b-roll / 2.5–3s host each, ZERO reuse**, captions persist. Never put a screen inside the screen.
  ```bash
  uv run python tools/frame_insert.py --job $JOB --base host.mp4 --screen-prompt "the tv screen" \
      --insert "broll1.mp4,0,5.5" --insert "broll2.mp4,5.5,11" --occluder-prompt "fingers" --out scene.mp4
  ```
- **Command:** author `overlays.tsx` + `style_directives.json` (caption preset) → `check_layout`
  → `compose_render --mode retrofit`.
- **Craft:** `check_layout` clean before the render; captions never over the face, finger
  occlusion reads right, no double-screen.

### Step 7 — Finish
The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). Keep the article's wording,
captions and story coherent, and keep faces and text clear of the frame edges and
platform red zones.

### Step 8 (B-path productionization) — auto-spin-up `[GENERIC]`
The newsletter→video pipeline is meant to be **template-driven**: on receiving a newsletter,
auto-spin a project from the locked tenant template (host + voice + look + CTA). Save each proven
job as a named reusable template (e.g. a "retro-broadcast host").

---

## Cross-cutting rules
- **Seedance-native or designed-ElevenLabs voice — NOT MiniMax/Chatterbox/xtts (rejected).**
- **Inspect the avatar still before video.** Surface it for optional feedback without creating a
  human approval gate. Hands are the #1 tell; tight crop / hand away / cover. **Cut** garbled audio.
- **B1 = base clips + relip** (not one long gen); SAM3 cut-out for the corner tile.
- **B2 = the general stylized-explainer shape; the retro-broadcast scene is one example** (`frame_insert`).
- **Select a grounded LOOK and optionally surface the menu; real stock over AI for these
  clients; no reuse; Ken-Burns stills.**
- **B2 cadence 2–3s/2.5–3s, captions persist, screen content vignettes to black + finger occlusion.**
- **Surface plaintext script + cost/time (logged by `replicate_safe`) before render; clickable link after.**
- **Gemini is EYES, not TASTE.**

## Tools used (all real)
`analyze_reference` (voice/substance) · `check_script` · `cast_avatar` · `perform_avatar` ·
`synth_voice` (design/tts/transcribe) · `lipsync_footage` (fal sync-3) · `sam3` (cut-out B1 /
occlusion B2) · `frame_insert` (B2) · `densify` · `index_media` · `pull_video` · FS-dither /
reference-style looks · `check_layout` · `compose_render` · `verify_output`.
Replicate calls auto-route through `replicate_safe`.

## Provenance — first run evidence + defect ledger
From `jobs/<article-example>/` (2026-07-01) + the build transcript. The client picked **B1**
outright (*"pip is better, use the strategy we discussed"*); B2 was not built.
- **WORKED:** the B1 spine end-to-end — ElevenLabs `eleven_turbo_v2_5` VO (no MiniMax/xtts, voice
  rule holds), Seedance base loop → fal sync-3 relip, 7 gpt-image-2 Ken-Burns b-roll stills, a
  34-beat `beat_plan.json`, `compose_render`, QA gate stamped. Final human verdict: *"It looks great."*
- **CONFIRMED the B1 corner-PIP anti-pattern:** the client rejected the boxed tile —
  *"prefer the avatar's background wasn't shown… mask his foreground instead."* The fix (SAM3
  foreground cut-out composited onto b-roll, avatar **moves in silences**, **goes fullscreen on
  hard-hitting beats** like *"chemically you are not special"*) is what shipped: 20 corner / 14
  fullscreen beats. Step 6's B1 spec is now the validated recipe, not a warning.
- **NEW defect — mechanical coupling:** the client flagged that changing Ken-Burns direction *on the same
  beat* the avatar moves *"feels super mechanical — these should be separate."* **Decouple avatar
  motion from b-roll zoom-direction changes.** Also the client's rule: **no scenes without the PIP avatar.**
- **Step 1 (script) is the weak link, as predicted:** *"scripts are bad… need real improvement."*
  Voice/substance extraction still under-delivers; inspect and strengthen the hook
  before expensive downstream work, without creating a human-approval gate.
- **QA surfaced real, reproducible overlay defects** (not tropes): hook card *summarizes* rather
  than transcribing the VO verbatim; the `SOURCE: <author>` credit sits in the red-zone and at ~23s
  renders over the avatar's chest; 2 dead-air gaps (0:17, 0:49); room reverb on the vocal;
  **CTA absent** (the Output spec's end-CTA never landed — chronic gap, still open).
- **Reliability:** `perform_avatar` took 1 network retry; `sam3` video failed once then succeeded on
  retry — `replicate_safe` absorbed both. B-roll relevance was acceptable here (concrete nouns:
  atoms/cell/DNA/gears) but the chronic-miss risk is unretired on abstract copy.

---
