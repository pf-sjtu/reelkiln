# B-Roll Styles — ranked catalog of generation methods

A concrete, reproducible catalog of every B-roll generation method used across Joseph Chin work, ranked by quality verdict. Each entry gives the EXACT tool call, the mechanic (from-nothing / start-frame / start+end-frame / composite), when to use it, an example asset, and the quality verdict (what got praised vs. what was low). Brand tags: `[BRAND: josephchin]` = signature to that brand; `[GENERIC]` = portable to any brand.

Distilled from `_research/josephchin_broll_archaeology.md`.

---

## Static-image motion (MANDATORY — no dead-still frames) `[GENERIC]`

**Rule:** EVERY static image on the timeline — generated (gpt-image-2) *or* retrieved (a still
from the media library, a screenshot, a card) — MUST carry a visual effect. A frozen still on a
fast-cut reel reads as dead/cheap. Tiered by effort:

**Brief boundary:** when the user asks for **simple / restrained / subtle / local
motion**, the effect is code-native motion in the compositor. Use pan, scale, opacity,
or a restrained Ken Burns treatment. Do **not** call `mint_video` or another paid
generated-motion provider unless the user explicitly asks for generated footage or the
scene genuinely requires new motion. The richer tiers below are options, not permission
to override the user's requested production level.

- **Simple (default, always at minimum): Ken Burns** — a slow push-in or pan. ffmpeg `zoompan`
  on a cover-cropped 1080×1920 (cover-scale up, `zoompan z='min(zoom+~0.0007,1.10)'`), ~3–5%
  over the beat. This is the floor; every still gets at least this.
- **Richer: parallax** — separate subject from background (`sam3 segment` / depth) and move the
  planes at different rates for a 2.5D push. Use for hero/held beats.
- **Richer: vox-style textures / treatments** — grain, halftone/dither, light-leak, chromatic
  drift, scanline (the FX-plate / texture treatments, Methods 14–18 below + `assets/_fx/`).

Pick by beat importance: throwaway → Ken Burns; hero/held → parallax or a texture treatment.
The assembler must never emit a static beat without one of these. (JosephChinBuilds brand
`## COMMITMENTS` `[static-motion]` makes this a hard rule.)

---

## The high-quality bar (state this up front)

A B-roll asset clears the bar only when ALL of these hold:

1. **Foreground "wow" or a real receipt** — the visual is either a full-bleed Gen-AI moment (T1) or a real-world artifact (real footage / platform mockup, T2). Synthesized logo cards lose to real footage when the script names a real product ("Receipts trump synthesis").
2. **Zero drift on locked elements** — mat texture, lighting, framing, and any already-placed cards do NOT move or change between states/frames. Achieved by PNG state-anchoring (the word `EXACT` repeated is the model-side lock trigger), never by prose alone.
3. **Camera holds rock-steady** — every motion prompt names `Camera holds rock-steady` / `stays perfectly still` + `Avoid jitter, avoid camera movement, avoid distortion`. Only the intended single delta moves.
4. **Legible text is never sent through a motion model** — text garbles mid-interpolation. Text-bearing UI is baked into static keyframes and crossfaded in Remotion, or composited pixel-exact in PIL — never gpt-image re-rendered, never morphed.
5. **No dead split-screen** — no split beat over 4s holds a single static visual; one visual change every 2-3s, and each mid-beat fill is NEW content (never a reuse of an earlier asset).
6. **Hands stay small at the frame edge, thumb-index pinch** — spread palms can trip motion-model moderation (E005). On a block, regenerate the keyframe with a smaller edge hand; never fall back to an ffmpeg slide-wipe (reads as a PowerPoint wipe, off-brand).

Defaults: `mint_video insert` and keyframe use **720p** unless the approved
quote explicitly names **1080p**. `standard` supports either resolution; pass
the quoted resolution unchanged when executing.
Seedance 2.0 minimum duration is **4s** — generate at the floor and trim in edit.
`mint_video --mode multishot` is unavailable (videoclaw#317). Gemini can generate or inspect
media, but remains
**eyes, not taste** when used to inspect clips.

---

## Content hierarchy (pick the highest tier you can execute)

1. **T1 — Full-bleed Gen-AI sequence** (Seedance keyframe / insert). The "wow." BEST.
2. **T2 — Real-world receipts** — real footage reframed, or platform-mockup stacks. Highest credibility per dollar.
3. **T3 — Hand-drawn paper cards on the mat** — the brand signature, now LAST-RESORT (use only when T1/T2 unreachable).
4. **T4 — Full-screen talking head** — 1-2 emphasis moments per reel; never filler.

---

# The catalog — ranked by quality verdict

## 1. Multi-shot card-on-mat placement — HIGH ⭐ CANONICAL `[BRAND: josephchin]`

**Mechanic:** one `mint_video --mode keyframe` per card, first frame = state k, last frame =
state k+1, stitched in order. The HIGH verdict below was earned by a ONE-call ordered-reference
`--mode multishot` version, which is unavailable (videoclaw#317); the per-card keyframe path is
not yet proven at that verdict.

**Load-bearing insight — sequential single-card subtraction:** do NOT ask the model to reason about where cards go. Derive PIXEL-ALIGNED mat states by removing one card at a time from a master, then hand those states to the model as before/after anchors. Position is locked by the state pixels, not by prose.

**Pipeline (3 stages):**
1. **Master frame** — one `mint_image --role card` call with ALL N cards in final positions, every style anchor stacked as `--reference`, "EXACT BACKGROUND LOCK" language.
2. **Sequential subtraction** — from the master, remove the bottom-most card ONE AT A TIME; each reference-conditioned `mint_image --role card` call operates on the PREVIOUS reduced image (never the master). Removal prompt: *"EXACT IMAGE LOCK: use this EXACT image as the source. Keep the mat, lighting, framing, and ALL remaining cards in their EXACT positions… The ONLY change: REMOVE the single bottom-most card… Fill its area with mat texture."* → N+1 states (empty → master).
3. **One keyframe call per card** — first frame = state k, last frame = state k+1, so the model only animates the incoming card + hand; describe the same hand in every prompt.

**Canonical call shape (card k):**
```bash
uv run python tools/mint_video.py --job "$JOB" --mode keyframe \
  --name card_1 --first-frame STATE_1 --last-frame STATE_2 \
  --prompt "Same locked overhead camera. A hand (East Asian male, late 20s, slender fingers, no jewelry) enters from top-right pinching the CLAUDE card, places it UPPER-MIDDLE. Camera fixed. Avoid jitter, finger morphing, placed cards moving."
```

**Capacity:** refs = (N+1 states) + 1 hand <= 6 → **N <= 4** with the empty establish state; omitting that state fits N=5. N>=6 must split the beat.

**When to use:** the brand card-reveal beat — placing multiple labeled paper cards on the mat in sequence. Replaced the old 4-separate-clip recipe (Method 12) on 2026-05-29.

**Example:** the historical `a6_multishot` asset (9.0s, 5.3MB, ~$1, ~3.3min).

**Verdict — HIGH.** *"Sequential single-card subtraction insight (user's own) — zero position drift in output."* Frame-extracted at 0.5/2.5/4.5/6.5/8.7s; all 4 cards readable at correct positions. ~half the spend of the old 4-clip path, native audio, one render. Alternate hand entry edge per shot (right / top-right) for rhythm without breaking identity.

---

## 2. Image-to-video on a real-UI mockup — HIGH ⭐ (specifically praised) `[GENERIC]`

**Mechanic:** reference-led image-to-video. `mint_video --mode insert --reference <ui still>`
animates a generated UI still so it reads as a real screen recording — scrolling
a feed, a counter ticking, a click-through.

**Pipeline:** `mint_image --role card` mints the UI still (e.g. NomadList page,
doomscroll feed, income counter), then `mint_video --mode insert` animates
the scroll/count/click motion.

**When to use:** the script references an app or web UI and you want it to feel like genuine screen capture (scroll, count-up, click-through) without recording a real screen.

**Examples (session 4bc0b6a6):** reel 13 `b1_doomscroll` + `b5_sweep`; reel 20 NomadList click-through + income counter; reel 21 graveyard sweep + dash counter.

**Verdict — HIGH, explicitly praised.** On the NomadList scroll: *"the scrolling in nomadlist we should remember how you achieved that… its really good."* The generated clips were approved. Reel 20 overall: *"amazing."*

---

## 3. Seedance 2.0 first-frame + last-frame keyframe interpolation — HIGH ⭐ LOCKED `[GENERIC]`

**Mechanic:** **start+end-frame.** gpt-image-2 generates a precise first frame AND last frame; Seedance 2.0 (the FULL model, NOT `--fast`) interpolates the motion between them. The `--first-frame`/`--last-frame` mode is MUTUALLY EXCLUSIVE with `--reference` (the tool raises SystemExit if both passed).

**Exact call:**
```bash
uv run python tools/mint_video.py --job "$JOB" --mode keyframe \
  --first-frame .../broll_keyframes/b3b_chest_first.png \
  --last-frame  .../broll_keyframes/b3b_chest_last.png \
  --output .../b3b_chest.mp4 --duration 5 --resolution 720p --aspect-ratio 9:16 \
  --prompt "Anatomical chest cavity cross-section. Camera holds rock-steady. The heart beats ONCE — diastole at start, smoothly contracting to systole at end… Smooth biological motion. Cinematic side-lighting unchanged. Avoid jitter…"
```

**Prompt grammar that works:** describe the SINGLE delta between the two keyframes + `Camera holds rock-steady` + `stays perfectly still throughout` (for mat/paper) + a verb tied to the change + `Avoid jitter, avoid camera movement, avoid distortion`. No text-morph (see Method 11).

**When to use:** cinematic T1 "impossible shots," and animating a single change on an otherwise-static mat card. The locked upgrade over `--fast`.

**Examples:**
- Cinematic (script 2): `b3b_chest`, `b3c_membrane`, `b4_hummingbird` (10s), `b5a_orbit`, `b5b_geology`, `b5c_eye` (push through pupil into retina).
- Surreal brand moment (script 3): `b6_microwave` (brain on a microwave turntable glowing red, 10s).
- On-mat single-change (script 4): `b1_orgtree` (six boxes crossed out one-by-one), `b3_flip` (brass scale tilts), `b4_dev` (tool icons appear in a halo), `b5_prompt`, `b6a_chart`, `b7_jack`.

**Verdict — HIGH, the locked upgrade over `--fast`.** Script 2 ADDED this precisely because cinematic shots needed motion fidelity `--fast` couldn't deliver — *"when a creative goal exposes a capability gap, build the capability, don't lower the ambition."*

**Notes:** Seedance 2.0 minimum 4s (E006 below); valid 4-15s. Generate at the floor and trim. 720p default.

---

## 4. fal sync-3 a-roll (speaker layer) — HIGH (current standard) `[GENERIC]`

**Mechanic:** video+audio lip-sync. Not B-roll itself, but the on-camera Joseph layer that B-roll cuts away from. Lip-syncs densified audio onto base footage with `fal-ai/sync-lipsync/v3`, generating ONLY the windows where he's on camera (~40-60% of the reel). Replaced `lipsync-2-pro` mid-session 4bc0b6a6.

**Tool:** `aroll.py` (beats.json-driven). `plan` merges contiguous on-camera beats into windows + prints cost ($8/min); `gen` slices audio+base per window → sync-3 → warm grade → band crop.

**Locked params:**
- `fal_client.subscribe("fal-ai/sync-lipsync/v3", arguments={"video_url":…, "audio_url":…, "sync_mode":"cut_off"})`
- Warm grade (sync-3 washes out): `eq=saturation=1.01:contrast=1.02:gamma=1.02` — tuned against the REAL `media/base_videos/studio_3min.mp4`, NOT `02_base`.
- Band crop for split beats: `crop=1080:840:0:380`.

**Verdict — HIGH.** First test: *"its perfect."* Preferred over the prior model: *"much better than the previous lipsync model."* CAVEAT — wash-out needed 2 grading rounds, and the wrong reference footage was matched twice (*"no you've matched it with the wrong footage… take a look at my footage in media/base_videos"*). Verify the source footage match.

---

## 5. Platform-mockup "slap-down receipts" stack — HIGH (locked params) `[GENERIC]`

**Mechanic:** PIL pixel-level composite (NOT a motion model, NOT gpt-image re-render). N platform mockups (Reddit/X/HN posts) composited onto the mat in a chaotic overlapping stack with rotation + drop shadow, played as a hard-cut montage with click SFX. The T2 receipts generalization of the card workflow.

**Pipeline:**
1. `gen_image.py --model gpt-image-2` mints each full-bleed 2:3 mockup (verbatim post text, brand-orange `#FF7A3D` pill on the key phrase, realistic engagement numbers + a top comment, "No browser chrome"). Attach the matching anchor (`reddit_dark_post.png` / `x_dark_post.png` / `hn_cream_post.png`).
2. `compose_mockup_stack.py` — PIL pixel-level composite (re-rendering through gpt-image would garble the legible text) → N+1 state PNGs + an optional cycle mp4.

**Locked defaults (Joseph approved on A5):**
```bash
uv run python agent/josephchin/tools/compose_mockup_stack.py \
  --mat .../step0_empty.png --mockup .../post1.png … --mockup .../post5.png \
  --out-dir .../edit/ --prefix a5_stack --cycle-mp4 .../a5_stack_cycle.mp4
# --scale 0.85 (NOT 0.5 — "weak/not big enough"), --rotation-range 7 (NOT 15+ — "cartoonish"),
# --position-jitter 70 (NOT 150+ — breaks the stack read), drop shadow 22px blur / 14,20 offset / alpha 140, --seed 3
```
Cycle timing: 0.3s empty → 0.4s per card → 0.9s final hold (~2.8s for 5). Ships silent; overlay click SFX per landing.

**When to use:** the script cites social proof — Reddit/X/HN posts, reviews, receipts you want to slap down fast.

**Example:** `aroll_outputs/batch1_script1/edit/a5_stack_*.png` + `a5_stack_cycle.mp4` (5 posts).

**Verdict — HIGH at locked params; LOW at first-pass params.** 0.5-scale first pass read "weak / not big enough"; ±15°+ rotation read "cartoonish." Locked to 0.85 / ±7° / ±70px. ~$0.25 + ~3min, no Seedance.

---

## 6. gpt-image-2 paper cards on the mat — HIGH look / NOW LAST-RESORT tier `[BRAND: josephchin]`

**Mechanic:** from-nothing still generation with PNG style anchors. Small hand-cut paper cards, each carrying ONE concept, photographed on the Fiskars mat. THE recognizable Joseph Chin device. T3 (use only when T1/T2 unreachable).

**Exact call:** `gen_image.py --model gpt-image-2 --aspect 2:3`, attach `style_anchors/mat_and_pen_style.png` as `--reference` (always), plus `claude_logo.png` / `monospace_card.png` / `orange_emphasis_card.png` as relevant. Lead the prompt with the **"EXACT BACKGROUND LOCK"** block (the repeated word EXACT is the model-side trigger). Pen-drawn cards use authentic ballpoint character (uneven line weight, missing-ink spots); printed cards use clean monospace; real brand logos render as clean printed marks, NOT in ballpoint style.

**Examples:** `card_a6_{repo,claude,bash,files}.png`, `card_a1_{agentmd,architecture}.png`, `a2_build_vs_ship.png`, `a3_docuask_hero.png`, `a4_{cursor,finder,github,terminal}.png` in `batch1_script1/edit/`.

**⚠ SAFE ZONE — text bleeds off the edges otherwise (`[GENERIC]`, all text-bearing gen).** gpt-image-2
will happily run a word off both sides of the frame (the "RESILIENCE" card was clipped L+R, 2026-07-01).
**Every text prompt must demand padding:** *"Keep ALL text fully INSIDE the frame with generous safe
margins — at least ~15% padding on the left and right; the text must NOT touch or bleed off any edge;
center it. Stack long phrases onto multiple lines rather than shrinking to fit edge-to-edge."* For a
multi-word phrase, instruct a 2–3 line stack. Verify on the inline `Read` (item (e)) and re-mint if any
glyph touches an edge — never ship edge-clipped text.

**Verdict — HIGH for the look, two hard-won caveats:**
- `card_a6_files.png` v1 (authentic ballpoint) LOCKED the pen-drawn style (2026-05-28).
- **CRITICAL BUG (LOW until fixed):** `gen_image.py` v1 used `image_input` for gpt-image-2, but Replicate's gpt-image-2 expects `input_images` (plural). The wrong key SILENTLY dropped every reference — every "EXACT BACKGROUND LOCK" attempt before the 2026-05-28 fix was prose-only, and mat texture/lighting drifted across 20+ regens (*"never fully consistent"*). If backgrounds drift despite correct refs, verify the payload key FIRST.
- Density steer: *"We don't need to be so on the nose… Visual storytelling works by showing, not more clutter."* And: *"Can you make the grid lines orange please."*

---

## 7. Real footage pull + reframe — HIGH (real receipts) `[GENERIC]`

**Mechanic:** real-footage reframe. Download actual launch/demo/social video, sample frames to find the "wow" window, cut + reframe to 1:1 or 9:16 with subject-aware centering. T2 receipts for scripts that name real products.

**Tool:** `pull_footage.py` (subcommands `pull` / `cut` / `montage`).
```bash
pull_footage.py pull --url "https://youtube.com/watch?v=…" --name seedance_launch --sample-every 4
pull_footage.py cut  --name seedance_launch --start 12.0 --end 17.5 --aspect 1:1 --frame-mode face --out .../clip.mp4
pull_footage.py montage --name kling_launch --cuts "3.0:5.5,12.0:15.0,28.0:31.5" --aspect 1:1 --frame-mode center --out .../mtg.mp4
```
`--frame-mode face` = OpenCV Haar-cascade median-face centering (best for talking-head launches); `center`/`manual` also available. Caches `source.mp4` + `frames/` + `meta.json` per slug under `external_footage/<slug>/` (reusable across scripts).

**Ritual:** after `pull`, Read N sample frames inline, identify PURE demo segments vs UI/commentary, note start times. Receipts trump synthesis — prefer this over a synthesized logo card when the script names a real product.

**Examples / cached pulls:** `external_footage/{seedance_launch, kling3_launch, gemini_omni_launch, mac_mini_m4_reveal, doom_scroll_iphone, cafe_morning_broll, freeform_walkthrough_iPad, freeform_underrated_tutorial}/`; real Pieter Levels footage reframed to 9:16 for reel 20.

**Verdict — HIGH (locked as script-5 evolution: "Receipts trump synthesis").** CAVEAT: yt-dlp on Instagram URLs hits an auth wall — fall back to user-supplied downloads. One YouTube section download errored and needed a retry with an adjusted cut.

---

## 8. Tutorial UI hijack: gpt-image keyframes + Remotion crossfade — HIGH (locked) `[GENERIC]`

**Mechanic:** two static start/end frames crossfaded IN REMOTION (no motion model). For step-by-step tutorial narration (e.g. spin up a GCP project → OAuth client → add test users), generate one gpt-image-2 PNG per UI state (two per step: before-click + after-click), full-screen hijack the 1080×1920 frame (`objectFit: contain` + dark pillarbox), crossfade before→after at the click moment (~60% through the window, 0.25s ease-linear) + the fetched `catalog:ui.mouse.tight@1` click SFX. Captions OFF during the hijack (the screenshot self-labels).

**When to use:** a tutorial walkthrough of a real UI where each step is a discrete click. Cheaper, faster, cleaner than morphing text-bearing keyframes through a motion model.

**Verdict — HIGH for the static-crossfade; the motion-morph alternative is LOW (see Method 11).** *"gpt-image-2 renders GCP-grade UI text at near-pixel-perfect fidelity at Reel compression"* — locked on script 07 v2.

---

## 9. Tier-list keyframe compositor (PIL reveal states) — HIGH after iteration `[GENERIC]`

**Mechanic:** PIL composite of full-color logos onto a blank tier grid, emitted as reversed-reveal keyframes. `compose_tier_keyframes.py`.

**Pipeline:** `generate_image.py` mints `tier_grid_blank.png`; logos sourced from LobeHub color CDN (`npmmirror.com/@lobehub/icons-static-png/latest/files/light/`); the tool trims each logo to its alpha bbox, normalizes to a shared row height, composites per `REVEAL` step (build bottom→top so the punchline logo, e.g. Claude, lands last) → `tier_kf0..5.png`.

**When to use:** a tier-list / ranking reveal beat with real brand logos.

**Verdict — HIGH after 2 fix rounds; LOW first pass.** First pass fetched dark/plain (not color) logos and they weren't aligned. *"I think they should be full color brand logos, and they should also be aligned."* Converged to `tier_kf5.png` with aligned full-color logos. (Also surfaced a toolchain-clarity miss — confusion over whether Remotion or gpt-image made the tier image.)

---

## 10. Miniature tactile figurine cinematic (anchor-chained keyframes) — HIGH in-lab `[GENERIC]`

**Mechanic:** start+end-frame, anchor-chained. A separate R&D pipeline pioneered
the anchor-chaining pattern. Port the pattern to canonical `mint_video keyframe`;
the historical provider-specific scripts are not supported.

**Tools:**
- `gen_keyframes.py` — two-tier anchor system: **scene_anchor** + object anchors first,
  then **shot keyframes** that reference anchors as style seeds; dependency-chained
  (end frames ref their start, downstream shots ref upstream ends). Evaluate 3
  candidates per slot and select the strongest grounded passing anchor by default.
  Surface options for explicit or optional collaboration. Continuity via `--ref` =
  selected anchor image.
- `mint_video --mode keyframe` — first/last-frame video with a motion prompt.
- `darkspace.py` — per-clip luminance map → largest stable low-contrast bbox for caption placement.

**When to use:** cinematic miniature/tabletop B-roll needing continuity across multiple shots of the same scene.

**Verdict — HIGH in-lab.** Continuity insight: *"003 is best for all — same scene but different directions, different zooms… really cements this feeling of being in the same place."* Zoom/angle variation across shots is load-bearing for the cinematic feel. CAVEATs: `darkspace.py` needed 2 debug iterations; GPT-Image-2 was the stated preference but the tool was built against Replicate nano-banana (unresolved); cinematic walk-and-talk reference clashed with the static miniature format (unresolved). Props are all shape-credibility, NO legible text (figurine, brass scales, velvet box, paper door).

---

## 11. Seedance draft insert (from-nothing) — LOW / SUPERSEDED for hero shots `[GENERIC]`

**Mechanic:** from-nothing. `mint_video --mode insert --quality draft`
(`--fast` is the compatibility alias) selects Seedance fast without keyframes;
`--reference` remains optional.

**Exact call (script 2 v1):**
```bash
uv run python tools/mint_video.py --job "$JOB" --mode insert --name stomach \
  --prompt "Hyperrealistic medical endoscopic 9:16 video of the inside of a human stomach… Slow gentle camera drift. No text overlays." \
  --duration 4 --aspect-ratio 9:16 --quality draft
```

**Verdict — LOW for hero/impossible shots; OK ONLY for rapid-cut filler.** Script 2's cinematic shots were FIRST generated with `--fast` then RE-DONE with first+last-frame keyframe interpolation (Method 3) because `--fast` couldn't hold motion fidelity. Reserve for throwaway inserts; never for a lingered "wow" moment.

---

## 12. 4-separate-Seedance-clips card placement + ffmpeg xfade — LOW / SUPERSEDED `[BRAND: josephchin]`

**Mechanic:** N independent Seedance first/last-frame clips (one hand-placement each) concatenated with ffmpeg `xfade`. The hand identity was baked into the keyframe pixels. The ORIGINAL card-on-mat path.

**Example:** `batch1_script1/edit/clip{1-4}_place_*.mp4` → `a6_full_sequence_xfade.mp4`.

**Verdict — LOW, superseded by Method 1.** *"Original 4-clip Seedance approach required manual prompt engineering per card and still drifted"* — mat and cards drifted between clips, no state continuity, ~2× the spend. Kept only as an emergency fallback if multishot is unavailable. Related LOW finding: when Seedance moderation (E005) blocks a hand keyframe, do NOT fall back to ffmpeg `xfade=slideleft`/`dissolve` — *"reads as a Powerpoint slide-wipe and is OFF-BRAND."* Regenerate the keyframe with a smaller edge hand instead.

---

## 13. Mat gate-weave loop — UTILITY (background, not a "shot") `[BRAND: josephchin]`

**Mechanic:** `mint_video --mode insert --reference white_mat.png` with a
"SUBTLE STOP-MOTION gate-weave… NO other motion, camera holds fixed" prompt.
Animates the static mat PNG with a subtle 2-3px stop-motion gate-weave so the
mat "breathes" under cards. Output: `backgrounds/white_mat_wiggle.mp4` (5s loop).

**When to use:** a beat needs the mat alone with life under it.

**Verdict — works; it's plumbing for the signature look, not a hero B-roll method.**

---

# Motion & reveal TREATMENTS (Methods 14–18) — pick by INTENT

These are post/edit treatments (not asset generators). They turn stills + clips into
*motion* and *transitions*. Choose by what the BEAT needs to do:

| The beat needs to… | Use | Method |
|---|---|---|
| make a flat still feel like filmed **archival** footage | archival depth treatment | 14 |
| **join two shots with energy**, or **transform A→B** (building→blueprint, before→after) | cut-on-motion-peak | 15 |
| give a single **still real depth/motion** (no footage available) | 2.5D depth parallax | 16 |
| **reveal** an element from nothing (logo, title, subject emerging) | luma-matte reveal | 17 |
| **land on a detail** / "snap into focus" on a camera move | focus-hunting | 18 |

Every entry states **USE WHEN / WHY IT WORKS / AVOID** so a new agent picks unambiguously.

---

## 14. Archival-still depth treatment ("Vox-style") — TREATMENT, verified 2026-06-29 `[GENERIC]`

**USE WHEN:** a beat rests on a flat archival/old PHOTO and you want it to read as filmed
(documentary, historical, "show the receipt" with a real photo).
**WHY IT WORKS:** fringe blur + film dust + vignette + slow zoom are the exact cues the eye
reads as "a physical print being filmed" → instant depth + age + authenticity.
**AVOID:** modern/clean subjects; when the still has real depth and **2.5D parallax (16)**
sells "alive" better; pushing dust past subtle (reads as snow).

**Mechanic:** post-treatment, NOT a generation model. Takes a flat STATIC still (a real
archival photo, or a `mint_image --role artistic_still`) and fakes "a physical photo
being filmed" by stacking four cheap, deterministic layers. Use this whenever a beat
rests on a flat photograph — especially a REAL archival photo, where a motion model
(Method 3/11) would warp faces and hallucinate detail. ffmpeg is deterministic here, so
the photo stays honest.

The four layers (apply in this order):
1. **Fringe blur** — keep the subject sharp, blur only the OUTER edge of the frame.
   Mimics a shallow-DoF lens on a print. (Ref settings: a Compound/edge blur ramped to
   ~max 25 on a 1080-wide frame; subject crisp via a center mask.)
2. **Film dust** — overlay a film-print dust/grunge texture (e.g. a TextureLabs "Grunge"
   plate) in **Screen / Lighten** blend so only the white specks + scratches show →
   reads as an old film scan. Keep it SUBTLE.
3. **Vignette** — darken the edges to spotlight the subject and guide the eye.
4. **Slow zoom** — a very subtle Ken-Burns scale ramp (≈1.00 → 1.06–1.10 over the beat)
   so it feels hand-filmed. Tiny; if the zoom is noticeable it's too much.

**Tool tie-in (videoclaw has ffmpeg, not After Effects):** source still =
`index_media.py search` (real archival photo, retrieval-first) or `mint_image --role
artistic_still`; treatment = the ffmpeg recipe below; OR, for real parallax instead of a
flat zoom, a `mint_video --mode insert` slow push-in on the *treated* still.

**One-time FX assets** (`assets/_fx/`, synthetic — no copyrighted texture pack needed):
```bash
mkdir -p assets/_fx
# radial mask: white center (subject sharp) → black edges (fringe blurred)
ffmpeg -y -f lavfi -i color=black:s=1080x1920 \
  -vf "format=gray,geq=lum='255*exp(-((X-540)*(X-540)+(Y-960)*(Y-960))/(2*560*560))'" \
  -frames:v 1 assets/_fx/radial_mask.png
# film dust — ORGANIC: 3 layers combined with lighten so it doesn't read as procedural:
#   (a) thick sparse blobs (low-res 120x213, big upscale + gblur 2.2)
#   (b) fine specks       (320x568, tiny gblur)
#   (c) flickering vertical SCRATCH lines (1px-tall source → full-height lines; shown 1
#       frame in 5 via mod(N,5) so they flash in and out like real film scratches)
# Single-pixel specks vanish under h264+scale, so every layer is built low-res then
# upscaled NEAREST. Tune density via the geq thresholds (higher = sparser).
ffmpeg -y \
  -f lavfi -i "color=c=black:s=140x249:d=5:r=24" \
  -f lavfi -i "color=c=black:s=360x640:d=5:r=24" \
  -f lavfi -i "color=c=black:s=360x1:d=5:r=24" \
  -filter_complex "
   [0:v]format=gray,geq=lum='if(gt(random(0)\,0.9995)\,255\,0)',scale=1080:1920:flags=neighbor,gblur=sigma=1.4[big];
   [1:v]format=gray,geq=lum='if(gt(random(0)\,0.99988)\,210\,0)',scale=1080:1920:flags=neighbor,gblur=sigma=0.5[fine];
   [2:v]format=gray,geq=lum='if(gt(random(0)\,0.995)\,175\,0)',scale=1080:1920:flags=neighbor[scr0];
   [scr0]geq=lum='if(lt(mod(N\,7)\,1)\,lum(X\,Y)\,0)',gblur=sigma=0.4[scratch];
   [big][fine]blend=all_mode=lighten[d1];
   [d1][scratch]blend=all_mode=lighten[out]" \
  -map "[out]" -t 5 -r 24 -c:v libx264 -pix_fmt yuv420p assets/_fx/film_dust.mp4
# Defaults above are tuned to a real Vox-style reference frame: FINE sparse specks + thin
# faint scratches flashing 1-in-7 frames. Restrained on purpose — bump the scratch 175→235
# and mod(N,7)→mod(N,5) if you want film damage more aggressive.

# --- OPTIONAL: animate a REAL grunge plate (JC supplied assets/_fx/grunge_353.jpg, a
#     TextureLabs Grunge plate). A still plate looks fake if frozen, so JUMP the crop
#     window every 3 frames → the grain reshuffles like real film. Moderate contrast keeps
#     the authentic grime; don't over-crush (this plate is low-contrast grime, not specks).
ffmpeg -y -loop 1 -r 24 -i assets/_fx/grunge_353.jpg -vf \
 "scale=-1:2200,crop=1080:1920:x='mod(floor(n/3)*137\,iw-1080)':y='mod(floor(n/3)*251\,ih-1920)',format=gray,eq=contrast=1.9:brightness=0.02,format=yuv420p" \
 -frames:v 120 -c:v libx264 -pix_fmt yuv420p assets/_fx/grunge_dust.mp4
```

**LOCKED recipe — two passes (verified 2026-06-29 on an archival B&W still).** A one-shot
chain is tempting but breaks: `zoompan` must act on a single still, not the multi-frame
stream mid-chain — so do the zoom FIRST, then the treatments.
```bash
S=still.jpg; OUT=still_treated.mp4
# PASS 1 — Ken Burns slow zoom (still → 5s 1080×1920). 0.0006/frame ≈ 1.00→1.07 over 5s.
ffmpeg -y -loop 1 -i "$S" -vf \
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,\
zoompan=z='min(zoom+0.0006,1.10)':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24" \
  -frames:v 120 -c:v libx264 -pix_fmt yuv420p _zoomed.mp4
# PASS 2 — fringe blur (mask) + film dust (screen) + vignette.
#   NOTE: screen-blend the dust in RGB (gbrp), NOT yuv — screening neutral chroma (128)
#   pushes it and tints the whole frame magenta. gbrp keeps a B&W source neutral.
ffmpeg -y -i _zoomed.mp4 -stream_loop -1 -t 5 -i assets/_fx/film_dust.mp4 \
  -loop 1 -i assets/_fx/radial_mask.png -filter_complex "
   [0:v]split[sharp][b0];
   [b0]gblur=sigma=24[blur];
   [2:v]scale=1080:1920,format=gray[mask];
   [sharp][mask]alphamerge[sharpc];
   [blur][sharpc]overlay=format=auto,format=gbrp[fringe];          # 1 fringe blur
   [1:v]scale=1080:1920,format=gbrp[dust];
   [fringe][dust]blend=all_mode=screen:all_opacity=0.5,format=yuv420p[dusted];  # 2 film dust (RGB!)
   [dusted]vignette=angle=PI/6[out]" \
  -map "[out]" -t 5 -r 24 -c:v libx264 -pix_fmt yuv420p "$OUT"
```

**Film dust — TWO sources, pick by the look you want** (the recipe's `[1:v]` dust input is
swappable; all three verified 2026-06-29):
- **A · Synthetic specks** (`assets/_fx/film_dust.mp4`) — discrete white specks + flashing
  scratches. **Use when** you want VISIBLE film dust, the still is clean, or you have no
  real plate. Punchier, closer to the reference's distinct specks.
- **B · Real grunge plate, held over** (`assets/_fx/grunge_dust.mp4` from JC's
  `grunge_353.jpg`) — subtle authentic "old-print" grime/scuff, animated by the crop-jump.
  **Use when** you want restrained, cohesive authenticity (cinematic/already-textured
  stills, a quieter documentary tone). This particular plate is grime, NOT specks — on its
  own the discrete dust barely reads, which is the point: it ages the image rather than
  speckling it.
- **Combined (A+B)** — most reference-faithful: grime base + visible specks. Screen the
  grunge first (`all_opacity 0.9`) then the specks (`all_opacity ~0.55`). **Use for** the
  full "Vox" effect on a flat/clean archival photo.
  Swap in the recipe: replace the single `-i assets/_fx/film_dust.mp4` dust input with
  `-i assets/_fx/grunge_dust.mp4` (B), or add both inputs and chain two screen blends (A+B).

**When to use (the treatment overall):** documentary/archival beats; any flat photo you'd
otherwise leave static or (wrongly) feed to a motion model. Pairs with
`[BRAND: josephchin]` "receipt" beats when the receipt is a real photo rather than a UI.

**Tuning knobs (defaults verified, adjust to taste):** `gblur sigma 24` (fringe softness),
dust `all_opacity 0.5` (0.5 subtle ↔ 0.7 heavy — past 0.7 it reads as snow), `vignette
angle PI/6` (PI/5 = stronger), zoom rate `0.0006`/frame (barely perceptible — bigger tips
to "cheap slideshow"). The mask's `560` sigma sets how much of the center stays sharp.
**Dust-plate knobs (in the generator):** the geq `random()` thresholds set speck density
(higher = sparser); `mod(N,5)` sets scratch frequency (1 frame in 5 — raise the 5 for rarer
scratches); the scratch source `235` brightness + its threshold set how strong/many the
lines are. Built for organic look — sparse varied specks + flickering scratches, not a grid.

**Verdict — VERIFIED + LOCKED (2026-06-29).** Built end-to-end on a generated archival
still; all four layers read. Two bugs were caught and fixed in the recipe above: (1) the
dust screen-blend tinted the whole frame magenta until moved to RGB/`gbrp`; (2) single-
pixel synthetic dust was invisible after h264 — fixed by generating it at low res and
upscaling nearest. Keep dust subtle and the zoom barely perceptible.

---

## 15. Cut-on-motion-peak (zoom-punch / transform cut) — TREATMENT, verified 2026-06-30 `[GENERIC]`

**USE WHEN:** joining two shots with energy, OR **transforming A→B** that share framing
(building→blueprint, before→after, product→exploded-view, photo→data). 
**WHY IT WORKS:** at peak velocity the eye can't resolve detail, so a hard cut there is
"invisible" — the motion masks the edit; matched framing makes B read as a *continuation /
transformation* of A, not a new shot.
**AVOID:** calm/somber beats (it's punchy); A/B with no shared anchor (cut feels random);
slow drifts (you need the velocity spike at the cut).

```bash
FIT="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
# A: holds, then zoom-PUNCHES out (accelerate last 5 of 16f to ~1.5x)
ffmpeg -y -loop 1 -i A.png -vf "$FIT,zoompan=z='1+0.5*pow(clip((on-11)/5\,0\,1)\,1.6)':d=16:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24" -frames:v 16 -c:v libx264 -pix_fmt yuv420p A.mp4
# B: ENTERS at ~1.5x (carries the momentum) and settles over first 5f
ffmpeg -y -loop 1 -i B.png -vf "$FIT,zoompan=z='1.5-0.5*pow(clip(on/5\,0\,1)\,0.7)':d=20:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=24" -frames:v 20 -c:v libx264 -pix_fmt yuv420p B.mp4
# HARD cut at the peak — concat FILTER, NEVER `-c copy` (that broke the timebase → wrong-seek)
ffmpeg -y -i A.mp4 -i B.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[o]" -map "[o]" -r 24 -c:v libx264 -pix_fmt yuv420p out.mp4
```
For real CLIPS instead of stills, apply the punch to A's tail and B's head. **Verdict —
VERIFIED** (building→blueprint sample). Speed = clip lengths (16f/20f ≈ 1.5s is snappy).

---

## 16. 2.5D parallax (still → 3D move) — TREATMENT, verified 2026-06-30 `[GENERIC]`

**USE WHEN:** a flat image needs real depth/motion AND the scene has SEPARABLE planes
(landscape, exterior, anything with foreground framing + a distant background). Best when
you can GENERATE the scene as layers.
**WHY IT WORKS:** moving foreground / midground / background at DIFFERENT speeds on a pan
(and the foreground scaling out on a push) is exactly how a real camera reveals depth. The
make-or-break is clean PLANE SEPARATION with gaps the background shows through.
**AVOID:** a single dense subject with no plane gaps (a person filling a room) — there's
nothing to separate and it just smears; moves bigger than the plane's horizontal slack.

**PRIMARY — LAYERED PLANES (best; design the scene in 3 parts):**
1. BG opaque (e.g. night sky). MID + FG each generated on FLAT MAGENTA so they can be keyed
   (gpt-image-2 has NO transparent output): `mint_image --role seed_frame` … "the rest FLAT
   SOLID PURE MAGENTA #FF00FF, uniform, no gradient".
2. Key each + pan at its own speed (sky slowest → fg fastest); the amplitude spread IS the depth:
```bash
ffmpeg -y -loop 1 -t 4 -i bg.png -loop 1 -t 4 -i mid.png -loop 1 -t 4 -i fg.png -filter_complex \
 "color=c=black:s=1080x1920:d=4:r=24[cv];
  [0:v]scale=-2:1920,fps=24[bg];
  [1:v]colorkey=0xFF00FF:0.30:0.08,scale=-2:1920,fps=24[mid];
  [2:v]colorkey=0xFF00FF:0.30:0.08,scale=-2:1920,fps=24[fg];
  [cv][bg]overlay=x='(W-w)/2 + 12*sin(t*1.2)':y=0[c0];
  [c0][mid]overlay=x='(W-w)/2 + 45*sin(t*1.2)':y=0[c1];
  [c1][fg]overlay=x='(W-w)/2 + 100*sin(t*1.2)':y=0,format=yuv420p[o]" \
 -map "[o]" -t 4 -r 24 -c:v libx264 -pix_fmt yuv420p out.mp4
```
Pan amplitudes (12/45/100) = the depth; widen the spread for more. For a PUSH that sends the
foreground out of frame, add a per-plane zoom (fg scales most).

**FALLBACK — DEPTH-MAP WARP (only for a single EXISTING photo you can't re-layer):**
`tools/fx_parallax.py` (a gateway Depth-Anything depth map, one small paid call per still,
+ local cv2.remap). Continuous, but softer and it SMEARS on
dense scenes with no plane gaps — prefer the layered build whenever you can generate the scene.

**Verdict — VERIFIED** (layered night scene: trees/lamppost → house → moonlit sky, clean gaps).

---

## 17. Luma-matte reveal — TREATMENT, verified 2026-06-30 `[GENERIC]`

**USE WHEN:** introducing/exposing an element from nothing — a logo forming, a title
appearing, a subject emerging — especially with an ORGANIC matte (ink-bleed, brush, shape).
**WHY IT WORKS:** a shaped, animated boundary is more characterful than a fade or cut and
pulls the eye straight to the emerging element.
**AVOID:** rapid-fire cut sequences (a reveal needs a beat to read); when a hard cut is
punchier; mattes with soft/ambiguous edges on a busy bg (reveal gets muddy).

```bash
FIT="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
# matte = growing soft disc. REVEAL SPEED = the /0.35 (smaller = faster). Swap this clip for
# an ink-bleed / brush B/W video for an organic reveal — that's the whole look.
ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=24:d=0.9 -vf "format=gray,geq=lum='255*clip(((min(T/0.35\,1)*1300)-hypot(X-540\,Y-960))/70+0.5\,0\,1)'" -frames:v 22 matte.mp4
ffmpeg -y -loop 1 -t 0.9 -i base.png -i matte.mp4 -filter_complex "[0:v]$FIT,fps=24[b];[1:v]format=gray[m];[b][m]alphamerge[fg];color=c=black:s=1080x1920:r=24:d=0.9[bg];[bg][fg]overlay=shortest=1,format=yuv420p[o]" -map "[o]" -frames:v 22 -c:v libx264 -pix_fmt yuv420p out.mp4
```
**Verdict — VERIFIED.** (Keep the iris fast — ~0.35s; slower reads as sluggish.)

---

## 18. Focus-hunting (rack-focus on a camera move) — TREATMENT, verified 2026-06-30 `[GENERIC]`

**USE WHEN:** landing on a detail/subject (push to a face/object) or signaling a "snap into
focus" / topic shift. **MUST ride a camera move** (zoom or dolly) — that's what sells it.
**WHY IT WORKS:** a real lens hunts focus on a move; sharp→blur→sharp (the hunt) resolving
to a locked-sharp subject creates anticipation + a satisfying "click." On a static frame it
just looks like a glitch.
**AVOID:** static shots; overuse (gimmicky); ending on an upscaled/zoomed frame (soft payoff
— see the trick below).

```bash
FIT="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
# FAST, HARD push to the SUBJECT (aim y at the face ~0.30*ih). The fast zoom is what
# justifies the blur — a slow push reads as a glitch. 1.0→2.6 over 22f (~0.9s).
ZP="zoompan=z='min(1.0+1.6*(on/21)\,2.6)':d=22:x='iw/2-(iw/zoom/2)':y='ih*0.30-(ih/zoom/2)':s=1080x1920:fps=24"
ffmpeg -y -loop 1 -t 0.95 -i img.png -vf "$FIT,$ZP,format=yuv420p" -frames:v 22 -c:v libx264 -pix_fmt yuv420p sharp.mp4
ffmpeg -y -i sharp.mp4 -vf "gblur=sigma=24,format=yuv420p" -c:v libx264 -pix_fmt yuv420p blur.mp4
# blur DIP at the MIDDLE (frame 11) via a triangle weight → starts/ends TACK-SHARP. Blend into
# a genuine SHARP copy; do NOT rely on sendcmd gblur→0 (leaves residual softness). NOTE the
# comma before `format` is UNescaped (filter separator); commas inside the expr stay as-is.
ffmpeg -y -i sharp.mp4 -i blur.mp4 -filter_complex "[0:v][1:v]blend=all_expr='A*(1-(clip(1-abs(N-11)/8\,0\,1)))+B*(clip(1-abs(N-11)/8\,0\,1))',format=yuv420p[o]" -map "[o]" -r 24 -c:v libx264 -pix_fmt yuv420p out.mp4
```
**Verdict — VERIFIED.** Hunt = blur dip mid-move; payoff = native sharp subject. For a
reveal-INTO-focus instead of a dip, weight `max(0,1-N/8)` (blur→sharp, no dip).

---

## 19. FS-dither B&W LOOK — TREATMENT, verified 2026-07-01 `[GENERIC]` ⭐ menu default for mixed b-roll

**USE WHEN:** a reel's b-roll comes from many sources (AI-gen + stock + screen-rec) at
**varying quality** and you want it to read as ONE deliberate style. The signature "look"
JC praised (*"v15 is the best"; "fs dither as one of the b-roll 'looks'"*).
**WHY IT WORKS:** Floyd–Steinberg **error-diffusion dithering** collapses every clip to pure
black & white and scatters the quantization error into neighboring pixels → a fine film-grain
stipple. Two payoffs: (1) **unifier** — mismatched-quality b-roll all becomes the same grain,
so the pile looks intentional; (2) **AI-tell hider** — 1-bit grain buries generation artifacts
(same principle as the painterly art styles).
**AVOID:** the **human subject** — JC's rule is *humans stay full-color, treatment on b-roll
ONLY*. When the look must sit behind a person, mask the person with `sam3` and dither only the
background plate. Also avoid **coarse dots** (Ben-Day) — JC rejected them (*"dots too big /
cartoonish"*); FS-dither is fine-grained on purpose. This is **one entry in the b-roll LOOK
menu** (offer the menu every job) — the recommended DEFAULT only when b-roll quality is mixed;
a clean single-source reel may not need it.

**Mechanic:** deterministic ffmpeg, NOT a model. `monob` (1-bit) conversion with swscale
error-diffusion (`-sws_dither ed`) is the clean route — it yields true pure black/white (0/255),
where `paletteuse` picks mid-grays. (Verified on lossless frames: monob → exactly 2 levels.)

**LOCKED recipe (verified 2026-07-01 — fine stipple survived h264 at crf 14):**
```bash
# b-roll clip -> 1-bit FS-dither B&W. contrast 1.06 adds tonal punch; raise to ~1.15 to crush.
ffmpeg -y -i broll.mp4 \
  -vf "format=gray,eq=contrast=1.06,format=monob,format=yuv420p" -sws_dither ed \
  -c:v libx264 -crf 14 -pix_fmt yuv420p broll_dither.mp4
# Keep crf LOW (≤16): a 1-bit stipple is high-freq noise h264 destroys at high crf
# (the single-pixel-survival problem from Method 14). For CHUNKIER grain that survives
# heavier compression, dither at lower res then upscale NEAREST:
#   -vf "scale=iw*0.6:ih*0.6,format=gray,format=monob,scale=iw/0.6:ih/0.6:flags=neighbor,format=yuv420p"
```

**Tuning knobs:** `eq=contrast` (1.00 soft ↔ 1.15 crushed) sets pure-black/white vs. mid-grey
stipple; the optional low-res+nearest pre-scale sets grain coarseness (fine = native res;
chunkier = 0.6×). Apply to b-roll BEFORE the compose step; the human layer (`sam3` cut-out) is
composited on top in full color.

**Verdict — VERIFIED + LOCKED (2026-07-01).** Native-res crop shows clean error-diffusion
stipple (dense in shadows, sparse in highlights); monob gives true 1-bit, h264@crf14 preserves
the grain. The look is taste (a menu option); this recipe is the mechanism it references.

---

## 20. Halftone-collage assemble-from-empty (empty field → completed collage) — IMPORTED, unproven in-repo `[GENERIC]`

**Mechanic:** a WHOLE-REEL faceless register, not a one-off shot — the spine is
`workflows/collage-explainer.md`. Per spoken line: mint the completed collage still
(`skills/art_styles.md` Style 7, reference-locked) as the **LAST** frame; build the **FIRST**
frame as a plain-ffmpeg solid plate at the still's exact background hex; `mint_video --mode
keyframe` interpolates the ASSEMBLY — paper groups slide in, snap into place, stop-motion
timing — ending on the approved still. Elements enter in the `assembly_order` designed in the
workflow's metaphor spec, so the motion is authored at concept time, before any generation.

**Exact calls (per shot):**
```bash
# FIRST frame: empty flat field matching the approved still's bg hex — deterministic
ffmpeg -y -f lavfi -i color=c=0x<HEX>:s=720x1280 -frames:v 1 <job>/frames/<shot>_first.png

# interpolate the assembly (Seedance 2.0 keyframe — the locked first/last engine, Method 3)
uv run python tools/mint_video.py --job $JOB --mode keyframe \
  --first-frame <job>/frames/<shot>_first.png \
  --last-frame  <job>/images/<shot>.png \
  --output <job>/footage/<shot>.mp4 --duration 5 --resolution 720p --aspect-ratio 9:16 \
  --prompt "Paper-collage stop-motion assembly, using Image 1 as the exact empty first frame and Image 2 as the exact completed last frame. One continuous locked-off vertical shot: open on the empty flat <color> paper field, then assemble the scene piece by piece with crisp physical stop-motion timing — <ordered 3–6 elements: how each slides in, snaps into place, connects, completes the action>. End by holding the supplied completed composition. Preserve the exact framing, <hex> color field, cardstock accents, paper grain, halftone dots, cream keylines, cut edges and soft shadows. Restrained tactile 2D paper craft only. No scene cuts, no camera movement, no zoom, no morphing, no new objects, no text, no letters, no numbers, no logos."
```

**Prompt grammar that works (imported):** name Image 1 as *the exact empty first frame* and
Image 2 as *the exact completed last frame*; describe each element's entry in `assembly_order`
(structure → subject → connector → action → result); close with *"End by holding the supplied
completed composition"* — that line is what stops the model freelancing the final frame. All of
Method 3's grammar (locked camera, avoid-jitter tail) still applies.

**When to use:** abstract opinion/concept lines with nothing real to show — the legitimate
bottom of the content hierarchy (no real asset exists for "experience gets consumed every
time"). Anti-triggers: product ads (real product beats paper), real people, anything needing
editable layers mid-clip.

**QA (mechanical, per clip — beyond the standard chunk eval):**
1. **Frame-0 emptiness** — extract frame 0, assert near-solid at the expected hex
   (ffmpeg/PIL, deterministic, no Gemini). A slight paper-edge peeking at a border is
   acceptable; a half-assembled first frame means the plate hex didn't match the still.
2. **End-frame vs selected still** — side-by-side the clip's last frame against the
   mechanically passing selected still; minor pose/detail drift passes if the metaphor
   reads, composition drift fails.
3. Contact sheet `fps=1` — mid-clip must show pieces ENTERING, not a crossfade/fade-in.

**Failure routing (imported):** weak assembly feel → fewer elements + explicit per-piece
slide-in/snap order in the prompt; end-frame drift → strengthen both "exact … last frame"
anchors; fake text appears → fix the STILL and re-roll (never patch text via the video prompt).

**Verdict — IMPORTED, unproven in-repo.** Pattern from
[pyang5166/gbro-collage-broll](https://github.com/pyang5166/gbro-collage-broll) (MIT, public
demos are convincing; exemplar frames vendored to `workflows/collage-explainer/_ref/`).
The engine half is Method 3 (21 in-repo runs); the empty-plate + assembly-prompt half has NOT
run here. Earns a real verdict on the first shipped job.

**Notes:** Seedance min 4s, gen at floor + trim; cap 3–6 paper groups (more = weak read AND
unstable interpolation); the source repo drives Gemini Omni first/last via a direct
Interactions API adapter — relevant only to the chunk-31 known-gap item (direct Gemini
adapter), Seedance-first stands.

---

# Quick-reference table

| # | Method | Tool / model | Mechanic | Verdict | Tier | Tag |
|---|---|---|---|---|---|---|
| 1 | Card-on-mat placement | `mint_image` states → `mint_video keyframe` per card | first/last frame = adjacent states | HIGH ⭐ canonical | T3 exec | josephchin |
| 2 | Real-UI screen-rec (scroll/counter/click) | `mint_image`→`mint_video insert` | reference-led image-to-video | HIGH (praised) | T2 | generic |
| 3 | Cinematic impossible shot / on-mat change | `mint_video keyframe` (Seedance 2.0 FULL) | start+end-frame | HIGH ⭐ locked | T1 | generic |
| 4 | sync-3 a-roll (speaker layer) | `aroll.py` → `fal-ai/sync-lipsync/v3` | video+audio | HIGH (standard) | T4 | generic |
| 5 | Mockup slap-down stack | `gen_image.py`+`compose_mockup_stack.py` | PIL composite | HIGH (locked params) | T2 | generic |
| 6 | Pen/printed paper cards | `gen_image.py` gpt-image-2 | from-nothing + `--reference` | HIGH look / last-resort | T3 | josephchin |
| 7 | Real footage pull + reframe | `pull_footage.py` (yt-dlp+ffmpeg) | real-footage reframe | HIGH (receipts) | T2 | generic |
| 8 | Tutorial UI keyframes + crossfade | `gen_image.py` + Remotion | static start/end crossfade | HIGH (locked) | T1/T2 | generic |
| 9 | Tier-list reveal states | `compose_tier_keyframes.py` | PIL composite | HIGH after iter | T3 | generic |
| 10 | Miniature figurine cinematic (lab) | `mint_video keyframe` | anchor-chained start+end | HIGH in-lab | n/a | generic |
| 11 | Seedance draft | `mint_video insert --quality draft` | from-nothing (text-to-video) | LOW for hero / filler-only | — | generic |
| 12 | 4-clip Seedance + xfade | `mint_video keyframe` ×N + ffmpeg | start+end per clip + xfade | LOW / superseded | — | josephchin |
| 13 | Mat gate-weave loop | `mint_video insert` Seedance | `--reference` | utility | bg | josephchin |
| 14 | Archival-still depth treatment (Vox-style) | ffmpeg (gblur+mask, screen-blend dust, vignette, zoompan) | post-treatment on a static still | VERIFIED | treatment | generic |
| 15 | Cut-on-motion-peak (zoom-punch / transform cut) | ffmpeg zoompan + concat filter | hard cut at peak velocity; join/transform A→B | VERIFIED | treatment | generic |
| 16 | 2.5D parallax (still → 3D move) | layered planes: colorkey + overlay pan (depth-map `tools/fx_parallax.py` = fallback) | multi-plane pan at different speeds | VERIFIED | treatment | generic |
| 17 | Luma-matte reveal | ffmpeg alphamerge + matte clip | matte drives a reveal | VERIFIED | treatment | generic |
| 18 | Focus-hunting (rack-focus on a move) | ffmpeg zoompan + blend(sharp,blur) | blur dip on a push; lock sharp | VERIFIED | treatment | generic |
| 19 | FS-dither B&W look | ffmpeg `format=monob` + `-sws_dither ed` | 1-bit error-diffusion; unifies mixed b-roll | VERIFIED ⭐ | look/treatment | generic |
| 20 | Halftone-collage assemble-from-empty (`workflows/collage-explainer.md`) | `mint_image artistic_still` + ffmpeg lavfi plate + `mint_video keyframe` | empty-field first frame → completed-collage last frame | IMPORTED — unproven in-repo | T1 (whole-reel register) | generic |

---

# Cross-cutting rules (carry into any reuse)

- **VISUAL INTEREST IS PARAMOUNT — every second must earn the picture** (2026-07-01, JC's #1
  craft law: *"videos are about visual interest — why would anyone watch instead of listen if the
  visuals aren't doing anything?"*). The medium's whole edge over audio is the picture; if it isn't
  advancing the story, you've wasted it. Two concrete rules follow:
  - **B-roll cut cadence: a cut every 1–3s (3s is the MAX hold).** Cut to TELL THE STORY (visual
    storytelling), not just to decorate. A single b-roll clip lingering >3s bleeds attention.
  - **Dynamic on-camera presence (PIP / avatar / talking head):** don't nail the person to one spot.
    (a) **Cut out the FOREGROUND** (mask the person, drop their background) so they integrate with the
    b-roll — never a boxed tile showing their own room. (b) **Move them around** the frame during
    silences, repositioning to a natural spot to "explain the thing" — reads as human. (c) **Go
    FULLSCREEN on impactful lines**, and take them **off-screen entirely** when the b-roll carries the
    beat. The person is a dynamic element, not a fixed webcam corner. (See `workflows/article-to-shorts.md` B1.)
- **Ken Burns is the DEFAULT motion for any static still** (2026-07-01, JC: *"the b-roll in the
  background should ken burns so it feels like a movie"*). A still that just sits there reads as a
  cheap slideshow; give every photo/card/archival still a very subtle slow zoom (`zoompan`
  z≈1.00→1.06–1.08 over the beat, barely perceptible — bigger tips to "cheap slideshow"). Stills
  ship with Ken Burns unless a motion model (Method 3) or a treatment (14/16) is animating them instead.
- **Style-by-REFERENCE is the default styling mechanism (NOT LoRAs)** (2026-07-01, JC: *"replace
  the LoRAs with generation using a style identity as references by default — better and faster"*).
  Lock a brand/look by passing exemplar PNGs as `--reference` into `mint_image` (see
  `skills/art_styles.md`); curate a per-look exemplar set once and reuse it. No LoRA training.
- **EXACT-language + PNG reference > prose** for any mat/card gen. Style lives in `style_anchors/*.png`, attached as `--reference`, never described in prose alone.
- **gpt-image-2 ref key = `input_images` (plural), not `image_input`** (that's seedream's). Wrong key silently drops refs — the single most expensive past bug.
- **Sequential single-card subtraction** (not parallel-from-master) gives zero drift — minimal-diff edit per step.
- **Seedance keyframe (first+last) for fidelity; never `--fast` for a hero shot.** Seedance min 4s; generate at floor + trim.
- **Motion-model moderation: hands SMALL at frame edge, thumb-index pinch.** Spread palms can trip E005. Never fall back to a slide-wipe; regenerate the keyframe.
- **No text-morph through a motion model.** Bake text into static keyframes + Remotion crossfade, or composite pixel-exact in PIL.
- **Mockup stacks: PIL composite, never gpt-image re-render.** 0.85 scale / ±7° / ±70px jitter.
- **Receipts trump synthesis** — prefer real pulled footage (Method 7) over a synthesized logo card when the script names a real product.
- **Dead-split-screen trap** — every split beat >4s needs a visual change every 2-3s, and mid-beat fills must be NEW assets.
- **Resolution follows the quote:** standard insert/keyframe support 720p or
  1080p; both default to 720p, and execution repeats the approved resolution.
  to 720p; reenact output is provider-controlled.
- **Gemini is eyes, not taste** in QA — observations need verification and the
  human makes the aesthetic decision.
