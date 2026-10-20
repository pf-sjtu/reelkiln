# broll-voiceover — faceless artistic B-roll under a narrator VO

A forward, **generative** recipe for a faceless vertical (9:16) reel: a narrator
voiceover laid over pure **artistic** B-roll. No on-camera face → **no lip-sync
step** (the sync model needs a face track; there is none). The B-roll clips ARE
the visual spine; captions burn in last.

> The whole trick: **VO leads, B-roll follows.** Write/source the passage →
> `synth_voice` the narrator → mint 4–8 artistic STILLS (≈1 per 6–10s of VO — a
> 45–60s reel lands in the 4–8 band, and each still's ≈10–15s animated clip covers
> its span with trim headroom; ep#21 shipped at 58.6s on this math) in ONE chosen, locked
> art style (the swap point) → `mint_video` to animate each still → lay a found
> or native audio bed under the VO → `compose_render` the spine + steady bed →
> burn captions. Every step ships with an **EVAL** from `skills/evaluation.md`;
> no step proceeds on its first output.

All tools run from repo root `/Users/chin/projects/videoclaw` as
`uv run python tools/<tool>.py` and take **`--job <id>` explicitly** (concurrent
jobs clobber `.current_job`). Lip-sync, where it ever applies on a faceless reel,
is **always** fal sync-3 via `lipsync_footage` — but this path needs none.

Shared skills do the heavy lifting; this recipe references them, never repeats
them:
- `skills/art_styles.md` — the locked still-style library + the `--reference`
  style-lock mechanism. **This is the swap point** — pick ONE pack and pin it.
- `skills/broll_styles.md` — ranked B-roll generation methods (keyframe
  interpolation, image-to-video, real-footage pull, audio-bed ethos).
- `skills/voice.md` — choose, generate and verify a voice with delivery direction
  and measured pacing.
- `skills/evaluation.md` — Gemini is EYES not TASTE; the per-asset eval rung for
  each step below.

> **⚠️ Read this as PRINCIPLES, not a script to copy.** The worked example threading this
> file is ONE tenant's fireside book-quote reel — the painterly-fireside art pack, the
> fireplace ambience, the slow RP narrator are *that channel's* register, not defaults of
> the workflow. YOUR register (art pack, bed, voice, pace) comes from the current tenant's
> pack; the transferable spine is only: VO leads → locked-style stills → animate →
> bed → compose → captions, with an eval at every step.

Worked example backing every command (the proven path, not the only one):
a "Letters to a Young Poet" ep#21 reel for an editorial book-quote channel —
a 59.7s fireside B-roll+VO reel that shipped after the eval loop closed. The
rebuild used the painterly-fireside register; write your own brand into the
`[BRAND]` steps. Smart defaults are marked.

---

## Input — what you start from + where each input comes from

| Input | Where it comes from |
|---|---|
| **The passage / source idea** | The book + the one line worth keeping (or any short prose). The human supplies the source; you draft/source the narration (Step 1). PER-REEL — this changes every time. |
| **Narrator voice** | A locked `voice_id` from a prior design, OR a preset. Reuse `<channel>/voice/voice.json` if the channel has one (`skills/voice.md`). Rebuild value: `<LOCKED_VOICE_ID>` (the channel's locked narrator voice, a deep RP baritone; real value in that tenant's pack COMMITMENTS). Design fresh via `synth_voice --mode design` (`skills/primitives/synth_voice.md#design`) only when an original designed voice is requested. |
| **Art style for the stills** | The tenant's stated visual register → ONE locked pack from `skills/art_styles.md`. **This is the choosing/swap point.** (The worked example's channel locked `fine_art_philosophical` — painterly chiaroscuro, fireside; YOURS comes from the tenant register.) Pin it with the pack's `_ref/exemplar.png` via `--reference`. |
| **Audio bed** (ambience / room tone) | Search the rights-cleared `sfx_catalog` first (for example `ambience.room_tone.neutral`), or retain native SFX baked into an approved Seedance clip. If neither fits, omit or ask for a licensed user file; do not browse or generate a replacement. PER-REEL. |
| **Brand caption / overlay look** | The tenant's locked caption style. Unstated → smart default: burned-in sentence-break captions, no hook/lower/url overlays (captions-only path). |

`PER-REEL inputs that change: the passage and the audio bed. The voice_id and
the art-style pack are locked channel assets — reuse them.`

Commands below use `$JOB` only as a documentation placeholder. Replace it with
the literal canonical bare id printed by `prepare_production` in every tool
call; shell variables do not persist between app calls. That first route call
already created the job directory. `job.py` is a library, not a CLI.

---

## Output

`final.mp4` in the job root — a ~45–60s vertical (9:16) faceless reel: artistic
B-roll under a narrator VO, an audio bed held steady under it, captions burned in, every eval
beat's mechanical observations empty. Plus `final_raw.mp4` (pre-caption
composite), `tts/narration.mp3` or the Studio-returned WAV (the narrator track), `transcript.json` (Scribe-v2 word
timings), `images/*.png` (the locked-style stills), `footage/*.mp4` (the animated
B-roll clips), and a contact sheet.

---

## Steps

### Step 0 — One-time environment  `[GENERIC]`
- **(a) Generate:** an installed Remotion toolchain (only needed once per repo).
- **(b) Command:**
  ```bash
  cd /Users/chin/projects/videoclaw/remotion && npm install
  cd /Users/chin/projects/videoclaw
  ```
- **(c) Source:** the shared `remotion/src` caption compositor.
- **(d) Why:** `compose_render --mode render` burns captions through Remotion in
  the final step; the toolchain must be present.
- **(e) EVAL:** none — environment setup. (If the channel already has a locked
  `voice.json` and an art-style `_ref/exemplar.png`, those are the only other
  one-time assets; reuse them.)

---

### Step 1 — Source / write the narration passage  `[BRAND: <brand>]`
- **(a) Generate:** the spoken passage — the book's one keepable line, opened up
  into a ~45–60s narration (≈140–175 words at the slow VO band). Write it into
  the job's `script.json` (a `narration` field + a `broll` sequence naming each
  intended shot).
- **(b) Command:** authored, then gated by the **voiceover** method of
  `check_script` (this is the load-bearing pre-gen rung):
  ```bash
  uv run python tools/check_script.py --job $JOB --method voiceover --skip-llm
  ```
  `--method voiceover` is the B-roll-over-VO mode: it runs **no** Seedance prompt
  audit (there is no quoted dialogue / `[Image1]` to check) and instead gates on
  WPM + word-budget + proper-noun respelling.
- **(c) Input:** the source passage (Input table) and current delivery direction
  (`skills/voice.md`) to choose a target pace; measure the generated take.
- **(d) Why:** the passage IS the reel — perfect it before any pixel or second of
  audio renders. Use contractions in the spoken text (`won't` / `it's` /
  `you're`) — TTS reads literally; expanded forms sound stiff.
- **(e) EVAL** — *check_script* (`skills/evaluation.md` "cheap / pre-gen" rung):
  0 BLOCKING issues required. A blocked respelling or WPM/word-budget overflow is
  fixed in `script.json` and re-run — never overridden.

---

### Step 2 — Synthesize the narrator VO  `[BRAND: <brand>]`
- **(a) Generate:** the narrator voiceover from the locked voice_id, time-aware
  to the target pace.
- **(b) Command:**
  ```bash
  uv run python tools/synth_voice.py --job $JOB --mode tts \
    --beat-id narration --voice <LOCKED_VOICE_ID> \
    --text "<narration from script.json>" --no-stretch
  # → tts/narration.mp3 (use this job-relative path as the spine-leading VO)
  ```
  `--no-stretch` keeps the slow weighted delivery (≈149–155 WPM) that IS the
  authority-host register; for a punchier brand drop `--no-stretch` and pass
  `--wpm 215` (this legacy ElevenLabs example stretches by default). Reuse the channel
  voice_id; consult `skills/primitives/synth_voice.md` for current mode-specific pacing
  and design only when an original voice is requested.
- **(c) Input:** `script.json:narration` + the channel `voice_id`.
- **(d) Why:** **the VO sets the reel's final length** — every downstream timing
  (how many B-roll clips, the bed duration, the caption window) is measured
  against the actual VO file. Obtain the voice before the visuals so they fit it.
- **(e) EVAL** — *voice / audio* path (`skills/evaluation.md` §2, `skills/voice.md#4-verify-before-assembly`),
  two mechanical checks then the human:
  1. **Deterministic mispronunciation diff** — `synth_voice --mode transcribe`
     re-transcribes `tts/narration.mp3` with Scribe-v2; diff transcript words vs the script
     `--text`. Any divergence = a wrong-word/mispronunciation → fix the offending
     word phonetically in `--text` and re-synth.
  2. **Perceptual (optional, mechanical only)** —
     `verify_output --mode audio --input tts/narration.mp3`: flags timestamped
     dead air / dropouts / clipping / pace only.
  Compute WPM = words / duration × 60. The front-loaded creative decision covers
  the voice/register; do not interrupt production for another approval unless the
  output materially departs from it or the user explicitly requested a checkpoint.
  If the user records narration in Studio, the recorder returns a job-scoped
  **48 kHz WAV** path. Use that returned path verbatim as the EDL VO source; do
  not wait for WebM or transcode merely to match this TTS example.

---

### Step 3 — Mint the artistic stills in ONE locked art style  `[BRAND: <brand>]`  ← **the swap point**
- **(a) Generate:** one full-frame artistic STILL per B-roll shot named in
  `script.json:broll` (the rebuild used 4: bookshelf, book-in-hand, hearth,
  fire), all in a SINGLE locked pack from `skills/art_styles.md`. **Swapping the
  pack here is the only change that re-skins the whole reel** — the style block is
  verbatim, the SCENE describes only *what*, never *how it looks*.
- **(b) Command** (per still; for several shots use one `mint_image --batch` call, never
  background or parallel processes):
  ```bash
  uv run python tools/mint_image.py --job $JOB --role artistic_still \
    --name broll1_bookshelf --aspect 2:3 --quality high --variants 2 \
    --reference taste/packs/<tenant>/style_sources/<pack>_exemplar.png \
    --prompt "$(extract CORE_STYLE_BLOCK from skills/art_styles.md <pack>)

    Match the rendering technique, palette, grain, and mark-making of the reference image exactly; do not copy its subject — draw the SCENE described below.

    SCENE: <subjects, composition, action — 1–3 sentences, NO style adjectives>"
  ```
  The `--reference <pack>/_ref/exemplar.png` is THE style lock (it lands in
  the default edit endpoint and pins palette/mark-making that prose alone
  drifts off — `art_styles.md` §"the one mechanism"). The canonical rail supports
  native **9:16**. Any cross-model exception must be explicit and included in
  any requested quote; never silently retry paid work on another model.
  *The worked example's locked pack:* `fine_art_philosophical` (painterly chiaroscuro
  fireside). *Other registers:* `intaglio_engraving` (book-feel etching),
  `duotone_neo_noir` (tension), `vintage_print` (nostalgia), or `editorial_line`
  (witty/minimal) per the tenant's stated register.
- **(c) Input:** `script.json:broll` scene descriptions + the chosen pack's
  `CORE_STYLE_BLOCK` and `_ref/exemplar.png`.
- **(d) Why:** low-fidelity / painterly illustration **hides AI-gen tells** where
  photoreal gets scrutinized (`art_styles.md` first principle). A locked reference
  PNG holds the style identical across all stills; minting fresh per-shot prose
  alone drifts the palette.
- **(e) EVAL** — *avatar/still IMAGE* path (`skills/evaluation.md` §1; a still has
  no motion/audio → **no Gemini**): `Read` every PNG inline (mandatory
  always-show-image rule — never just point at a path); eyeball against the pack's
  locked hex palette (reject drift), confirm mark-making survived (strokes
  visible, not airbrushed), and — per the avatar doctrine — **no legible-text
  props** (books/diplomas/labels render garbled = instant AI-tell; use
  shape-credibility props). Re-roll by fixing the style block or swapping the
  reference; never pile on adjectives. Select the mechanically strongest variant.
  The selected style direction owns the choice; do not ask the user to pick again
  mid-run unless the generated set materially misses it.

---

### Step 4 — Animate each still into a B-roll clip  `[GENERIC]`
- **(a) Generate:** one short (≈10–15s) animated clip per still — the SINGLE
  intended motion delta (lateral dolly, slow push-in, ember rise, macro flames),
  camera otherwise locked. Optionally bake the native fire/room SFX here.
- **(b) Command** (per clip):
  ```bash
  uv run python tools/mint_video.py --job $JOB --mode insert \
    --name m1_bookshelf --reference images/broll1_bookshelf.png \
    --resolution 720p --aspect-ratio 9:16 --duration 15 --audio \
    --prompt "Slow lateral dolly across the bookshelf; warm firelight flickers; camera holds rock-steady, stays perfectly still otherwise. Avoid jitter, avoid camera movement, avoid distortion. No text, no people entering."
  ```
  Image-to-video (start-frame) is `skills/broll_styles.md` Method 2 (HIGH,
  praised); for a cinematic "impossible" single-change beat use Method 3
  (`--mode keyframe` first+last-frame, the locked fidelity upgrade over `--fast`).
  The quoted `--resolution` is explicit: standard supports 720p or 1080p and
  must execute at the exact approved value. `--audio` bakes native room/fire SFX —
  that native track can serve as the bed in
  Step 5 instead of a found one. Prompt grammar: name the ONE delta + `Camera
  holds rock-steady` + `Avoid jitter, avoid camera movement, avoid distortion`.
- **(c) Input:** the locked stills from Step 3.
- **(d) Why:** Seedance re-frames the 2:3 still to true 9:16 and animates the
  single delta; sending legible text through a motion model garbles it, so the
  stills carry no text (`broll_styles.md` cross-cutting rules).
- **(e) EVAL** — *video clip* path (`skills/evaluation.md` §3): per clip
  `gemini_video.py --mode chunk_review --chunk <n>` (or
  `verify_output --mode render --input clips/m1_bookshelf.mp4 --strip` for a
  filmstrip → `Read` it). Confirm camera steady, no morphing/garbled text, the
  intended single delta moved and nothing else, no background shimmer. Regenerate
  ONLY on a mechanical defect, never on "feels flat" (taste leak → fix the
  prompt, not the asset).

---

### Step 5 — Acquire + screen the audio bed  `[GENERIC]`
- **(a) Source:** the under-VO ambience bed — exact rights-cleared catalog ID or native
  Seedance SFX promoted from Step 4. Include the sourcing choice in the
  front-loaded plan; do not auto-generate music.
- **(b) Command** (found-online path):
  ```bash
  uv run python tools/pull_video.py --job $JOB --mode pull --audio-only --bed \
    --url "<ambience url matching the tenant register>" --name bed
  # → footage/bed.mp3
  ```
  *Native-SFX path:* skip this command and extract the audio from a Step-4 clip
  (`--audio` already baked it in) as the bed.
- **(c) Input:** a found ambience URL, OR a Step-4 clip's native track.
- **(d) Why:** real/native beds beat synthesized music for credibility
  (`broll_styles.md` Method 7 ethos); the bed sits at one steady level under the VO
  (no ducking) for warmth without masking words.
- **(e) EVAL** — *audio bed* (`skills/evaluation.md` §2):
  `verify_output --mode audio --input footage/bed.mp3` measures clipping and
  dropouts only — it cannot hear vocals, voice-band (250 Hz–3 kHz) collisions or
  a loop seam. Before building on the bed, do an explicit listening check for any
  words (a bed must carry no words under the narrator), a voice-band collision
  and the loop seam; any of them → re-source. When you cannot listen yourself,
  give the user the playable bed and say what to listen for (as in the
  `bed-find-and-screen` molecule); it is a check on the asset, not an approval
  step. The front-loaded plan owns the bed mood.

---

### Step 6 — Compose the spine: B-roll + VO lead + steady bed → `final_raw.mp4`  `[GENERIC]`
- **(a) Generate:** the pre-caption composite — concat the B-roll clips into the
  visual spine, lay the actual VO file as the lead audio, mix the bed under it at one
  steady level (≈ −22 dB, no ducking), trim to VO length + a short tail, fade in/out.
- **(b) Command:** author `edl.json` in the job root, then validate and assemble:
  ```json
  {
    "beats": [
      {"name":"bookshelf","source":"clips/m1_bookshelf.mp4","in":0,"out":15,"source_kind":"generated"},
      {"name":"book","source":"footage/m2_book.mp4","in":0,"out":15,"source_kind":"generated"},
      {"name":"hearth","source":"footage/m3_hearth.mp4","in":0,"out":15,"source_kind":"generated"},
      {"name":"fire","source":"footage/m4_fire.mp4","in":0,"out":15,"source_kind":"generated"}
    ],
    "audio": {
      "from_beats": false,
      "vo": {"source":"tts/narration.mp3","gain":1.0},
      "bed": {"source":"footage/bed.mp3","gain":0.08}
    },
    "output":"final_raw.mp4"
  }
  ```
  ```bash
  uv run python tools/assemble.py --job $JOB --edl edl.json --check
  uv run python tools/assemble.py --job $JOB --edl edl.json --output final_raw.mp4
  ```
  `assemble` is the canonical deterministic timeline + VO/bed mixer. Declare
  `source_kind` on every footage beat so the promise gate can measure the final
  timeline's real/generated seconds. Adjust the final beat's duration to the VO.
- **(c) Input:** `footage/*.mp4` (spine), the actual VO path returned by TTS or
  Studio, and `footage/bed.mp3` (bed).
- **(d) Why:** VO drives the length and sits on top; the bed is decorative and
  must never mask words. No dead split-screen — a visual change every ~2–3s.
- **(e) EVAL** — inspect intermediate frames with
  `verify_output --mode render --input final_raw.mp4 --sample-count 6` and `Read`
  for garbled text, morphing or framing collapse. Do not add a paid mid-run review
  or approval gate.

---

### Step 7 — Transcribe for caption timing  `[GENERIC]`
- **(a) Generate:** word-level caption timings from the composed VO.
- **(b) Command:**
  ```bash
  uv run python tools/synth_voice.py --job $JOB --mode transcribe \
    --audio final_raw.mp4
  # → transcript.json in the job root (Scribe v2 word timestamps)
  ```
- **(c) Input:** `final_raw.mp4` (the composed VO track).
- **(d) Why:** captions are anchored to the real spoken-word timings, not the
  draft script — Scribe v2 is the drift-free source of truth (`evaluation.md` §2).
- **(e) EVAL** — *deterministic* (`evaluation.md` §4a): no overlay anchors to
  check on a captions-only reel, so the gate is just a clean `transcript.json`
  (word timings cover the full VO, no empty result). Pass an explicit
  captions-only reason to the render command rather than constructing a marker
  with shell IO.

---

### Step 8 — Burn captions → `final.mp4`  `[GENERIC]`
- **(a) Generate:** the deliverable — captions burned over the spine via Remotion.
- **(b) Command:**
  ```bash
  uv run python tools/compose_render.py --job $JOB --mode render \
    --resolution 720p --caption-preset editorial --caption_break sentence \
    --allow-stub-overlays "faceless B-roll+VO; captions-only by design"
  # consumes final_raw.mp4 automatically → final.mp4 in the job root
  ```
  `--caption_break sentence` suits the slow narrator register (whole-line reveals,
  not word-pop). `preflight.py` auto-runs in render (red-zone / caption-band /
  face-collision for declared overlays — none here, so it's a no-op warn).
- **(c) Input:** `final_raw.mp4` + `transcript.json`.
- **(d) Why:** captions are baked last, over the locked composite, so a caption
  retiming never forces a re-mint of any media.
- **(e) Finish** — the rendered `final.mp4` is a complete draft; show it
  ([Finishing a render](README.md#finishing-a-render)). The craft to build in:
  caption wording, timing and contrast, and a bed that never masks the VO; lip sync
  is not applicable to this faceless route.

---

## The proven command spine (the worked example, condensed)

From the worked example (ep#21, 59.7s, shipped). The rebuild predates
some consolidated-tool flags and ran the compose by hand; the steps above are the
portable form. The ordered backbone:

```
script.json (narration + broll seq)  →  check_script --method voiceover
  →  synth_voice --mode tts (voice_id, --no-stretch) → tts/narration.mp3  [the length-setter]
  →  mint_image --role artistic_still ×N  (ONE locked pack, --reference exemplar)   ← swap point
  →  mint_video --mode insert ×N  (--audio native SFX, explicit quoted resolution, single-delta prompt)
  →  pull_video --mode pull --audio-only --bed (or promote native SFX) → verify_output --mode audio
  →  assemble --edl edl.json  (spine + VO lead + steady bed)  → final_raw.mp4
  →  synth_voice --mode transcribe --audio <locked-VO> (Scribe v2) → transcript.json
  →  compose_render --mode render --caption_break sentence  → final.mp4
  →  show the draft video
```

## Sibling workflow — collage-explainer (stylized whole-reel register)

[`collage-explainer.md`](collage-explainer.md) runs THIS spine with the swap point
pinned to the halftone paper-collage register and the animate step swapped to
assemble-from-empty keyframes (`skills/broll_styles.md` Method 20). Route there when
every line should land as a designed visual METAPHOR (abstract/opinion explainer
content); stay here for the general locked-art-style + single-delta-motion path.

## Cross-cutting rules (carry into any reuse)

- **No lip-sync, ever, on this path** — there is no face. If a future variant
  adds an on-camera narrator, lip-sync is **always** fal sync-3 via
  `lipsync_footage`; it never applies to pure B-roll.
- **VO is the length-setter** — obtain the voice first; every visual/bed/caption
  timing is measured against its actual returned job-relative path.
- **ONE locked art-style pack is the swap point** — `--reference <pack>/_ref/exemplar.png`
  pins it; re-skin the whole reel by swapping the pack, never by editing per-shot
  prose. Low-fidelity/painterly hides AI-tells; **no legible-text props**.
- **The bed must carry no words** — `vocals_detected` on the bed is a ship-blocker;
  held at one steady ≈ −22 dB (no ducking) so it never masks the narrator.
- **No text through a motion model** — stills carry no text; captions bake last in
  Remotion.
- **No dead split-screen** — a visual change every ~2–3s.
- **720p default**; 1080p only on request.
- **Every intermediate asset gets a mechanical check before you build on it.**
  **Gemini is EYES, not TASTE** — it surfaces mechanical observations. Do not turn
  each check into another human approval; spending permission is handled independently by the
  current host at paid-operation boundaries.
