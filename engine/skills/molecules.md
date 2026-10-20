# Molecules — reusable multi-tool moves (layer L1.5)

A **molecule** is 2–5 chained calls **across MULTIPLE tools** that achieve ONE nameable
goal — bigger than a primitive, smaller than a workflow. Reach here when the job is
goal-shaped ("re-voice this edit", "restyle that clip") and no full workflow fits.
Every entry: **goal / chain / in→out / proven / gotcha** — five lines, nothing else.

**The boundary rule:** a chain that lives inside ONE tool is a *tool note*, not a
molecule — it belongs in `skills/primitives/<tool>.md` (e.g. densify's re-transcribe
pass, lipsync plan→gen live there). Molecules earn their place by owning the SEAMS
between tools — the ordering and gotchas no single tool doc can.

Workflows COMPOSE molecules; molecules COMPOSE tools ([`CANONICAL_TOOLS.md`](../CANONICAL_TOOLS.md)).
Add a molecule only with provenance (a job id) or put it under **Extensions** until it earns one.
The cost/promise contract is NOT listed here — it lives in the session preflight. How the
finished-render review works is documented (as reference, not a step) in
[`skills/video_qa.md`](video_qa.md).
The cross-cutting craft (voice/performer ladder, motion slot, sequencing/realness laws,
layering algebra) lives in [`skills/craft_laws.md`](craft_laws.md) — read it to fill
slots well; it is not repeated here.

---

## Intent index — find the move by goal

**Character / identity**
- build a reusable identity kit (sheet + face refs) → `build-character-sheet`
- any on-identity still, any scene/pose/shot → `image-from-character-sheet`
- same face, the right clothes, held across a video → `wardrobe-swap-identity`
- animate an on-identity still with example motion → `identity-image-to-video`

**Person — performer, identity, voice**
- one reusable face + voice + idle bed for a channel → `build-locked-narrator`
- fresh episode VO onto a prebuilt bed, no face regen → `revoice-locked-edit`
- N spokesperson/locale variants of one locked edit → `voice-variant-cut`
- verify a voice-change identity cheaply before full recast → `sample-then-recast`
- catch wrong words in ANY synthetic voice before video spend → `mispronunciation-diff`
- identity-locked talking-head when no usable take exists → `gen-talking-head-from-face`
- generated reader integrated onto b-roll, never a boxed tile → `dynamic-pip-cutout`
- hide long-lipsync stitch points with motion cutaways → `seam-masking-inserts`

**Footage — b-roll, motion, product**
- on-brand artistic b-roll in one pinned art style → `locked-style-broll`
- a cinematic "impossible" hero moment → `keyframe-hero`
- an app/UI beat that reads as real screen capture — ONLY when a real recording isn't
  capturable (realness law: real is 10× cooler and cheap) → `faux-screen-recording`
- a precise physical interaction i2v otherwise fumbles → `seed-anchored-action`
- N cards placed sequentially with zero drift → `card-multishot`
- recolor/restyle a REAL clip keeping its real motion → `motion-transfer-restyle`
- b-roll composited INTO an in-scene screen with occlusion → `frame-insert-scene`
- a full-screen brand still that reads as the brand → `brand-grounded-beat`

**Sourcing — find before you generate**
- the right clip/still from the cheapest real source → `retrieval-first-router`
- tenant fonts/palette/logo recovered from their live site → `brand-intake-url`
- a proven, concept-matched format locked before generation → `format-mining-loop`
- the best passage from a long source without scrubbing → `gemini-windowed-select`
- a hook span from a long talk, reframed 9:16, paced → `long-source-vertical-clip`
- strongest hook windows ranked with an optional human override → `hook-find-pass`

**Audio**
- a real ambience bed under a VO, vocals-free guaranteed → `bed-find-and-screen`

**Assembly**
- word-timed brand captions onto a pre-assembled edit → `retrofit-captions`
- fix one bad spoken line without a full re-render → `flub-splice-repair`

**Trend-duplication**
- duplicate a SPECIFIC reference already shipped end-to-end — or swap a performer INTO its
  original footage (soundtrack kept) — match it (creator/URL/description) against the trigger
  table, surface + confirm, then follow the recipe → the bespoke recipes in
  [`workflows/duplication/`](../workflows/duplication/README.md)
- strip a reference's spoken VO but keep its sung hook → `reference-audio-scrub`
- a word flashes BEHIND the subject's head, synced → `kinetic-word-behind-mask`
- a word-by-word accumulating caption, in front → `accumulate-caption`
- bed hits land on the cutaways, drop on the payoff → `beat-synced-impact-bed`
- lipsync the CORRECT face in a multi-person shot → `face-crop-lipsync`

**Script-to-film**
- a script → numbered 15s cinematic prompt beats → `directors-shotlist`
- N independently-generated clips look like ONE film → `style-prefix-lock`
- characters carry state across generated scenes → `continuity-carry`

**Extensions (components proven, chain not yet run)**
- same performance, new voice AND face/scene → `alter-ego`
- kill gesticulation through VO pauses, stay on-face → `pause-stilling`
- one take, two camera angles, twice the realness → `multi-angle-sync`
- a-roll hands off to a hand-drawn-looking diagram → `ipad-reveal`
- an emphasis beat without the face → `fullscreen-typography-hijack`
- a base that ACTS an emotive/paused line, then synced → `performance-matched-base`
- a new face on YOUR real base take, real motion kept → `face-swap-real-base`
- keep a gen clip's ambience, delete its hallucinated speech → `i2v-speech-rescue`
- an abstract line assembles itself from an empty color field → `collage-assemble-from-empty`

---

## Slots — molecules take inputs, not fixed sources

A chain link written as `⟨VO⟩` is a SLOT: any qualifying source fills it, and **which
source you pick dominates output quality**. The molecule is the move; the slot choice
is the craft — and the craft is codified in [`skills/craft_laws.md`](craft_laws.md)
(the voice/performer ladder for ⟨VO⟩/performer slots, the motion slot law, the
sequencing/realness laws, the layering algebra). Fill no slot without it.

## Homes — durable outputs outlive the job

A molecule that mints a REUSABLE identity/asset must file it, not leave it job-scoped:
character faces/sheets + voice ids + host beds → `assets/<tenant>/` + the tenant pack's
COMMITMENTS; style exemplars → `taste/packs/<tenant>/` (`style_sources/`); brand intake
(logo/hero/fonts) → the tenant pack. Job dirs are for job-scoped work product only.

---

## Character / identity — build a sheet ONCE, reuse it in any image or video

**The identity pipeline.** Build a character sheet once, then reuse it to make any
on-identity image, put that person in the right outfit, and animate it — for ANY tenant,
a real person or a wholly-synthetic character. Four chained moves:
**build-character-sheet → image-from-character-sheet → wardrobe-swap-identity →
identity-image-to-video.** The named *compositions* of this chain live elsewhere and CITE
these primitives — do NOT re-derive them: talking-head = `gen-talking-head-from-face`
(Person, below); a new face on your OWN real base = `face-swap-real-base` / `alter-ego`
(Extensions); restyle a REAL clip's look = `motion-transfer-restyle` (Footage). Sheets +
face refs are durable assets → `assets/<tenant>/character_sheet/`, never job-scoped.

### The footage-transform router — pick by WHAT'S REAL

Use `edit` when the subject already in the footage should remain; use `genjutsu`
for every person swap (reference images supply the new people; the clip's footage
stays); use `reenact` only to make a still perform a driver's motion (the still stays the shot):

| Real motion? | Real identity? | You want | Move |
|---|---|---|---|
| ✓ (a real clip) | ✓ (keep it) | a new LOOK/grade on the same clip | `mint_video edit` |
| ✓ (your base take) | ✗ (new face) | a new person delivering your real take | `face-swap-real-base` (§Extensions) |
| ✗ (an example clip drives) | generated still | your generated character doing that motion | `identity-image-to-video` (below) |
| ✓ (your take + your VO) | ✗ (whole new persona) | the same performance by someone else | `alter-ego` (§Extensions) |

**build-character-sheet** — a reusable identity kit for any tenant; REAL photos beat generation.
`collect 8–12 varied photos (front/¾/up-down · mixed light · neutral+talking · incl. full-body) → build_character_sheet (default rail: nano-banana-2/edit via gateway) → 3 panels [face CU · headless body FRONT · headless body BACK] on light-grey → crop the face CU → face_refs/`
A person's photos (or a brief for a new character) → `assets/<tenant>/character_sheet/{sheet_*.png, face_refs/real_face_*.png}`.
Proven: a tenant's owner-supplied real-grade sheet; self-generated sheets were rejected as low-quality → shoot/collect REAL, generate the sheet only for a fully-synthetic character.
Rail (eval 2026-07-22): the DEFAULT is **nano-banana-2/edit** — reference-conditioned, holds the exact face + real outfit, does a true back view, obeys headless framing (a ~7.5% PIL top-crop finishes the chin sliver nano leaves at the jaw); the FRONT result is fed to the BACK call for outfit consistency. `--rail gpt` keeps the older gpt-image-2 portrait rail for A/B. Panels are 2:3 (both rails).
Gotcha: the FACE CU is the GOLD identity ref, the headless bodies carry wardrobe+proportions — keep them SEPARATE; erase any second face on a body panel (one face for i2v to lock onto); sheets assemble 3 panels side-by-side (landscape).
```
Sheet prompt (a NEW / synthetic character; for a REAL person, SHOOT these three instead):
  Character reference sheet, seamless light-grey studio backdrop, even soft diffused light,
  no harsh shadows. THREE panels, SAME person + SAME outfit + SAME proportions across all:
  LEFT — tight face close-up (head & shoulders, neutral expression, sharp focus);
  CENTRE — HEADLESS full-body FRONT (crop above the collar, NO head; full outfit + shoes,
           relaxed stance, hands in pockets);
  RIGHT — HEADLESS full-body BACK (same pose). Photoreal, 3:2, high resolution.
  Outfit: <describe the one outfit>.
```

**image-from-character-sheet** — any on-identity still: same person, any scene / pose / shot.
`mint_image --role portrait --reference <face CU(s)> [+ a body panel for wardrobe/proportions] --prompt "same man, same face, <scene · pose · shot type>"`
Sheet refs + a scene brief → an on-identity still for any beat (b-roll, hero, thumbnail).
Proven: identity-locked b-roll of the person; the still half of `gen-talking-head-from-face`.
Gotcha: multi-`--reference` the FACE CUs (gold); favour mid/far framing — the super close-up reads bad; Seedance `insert` E005-rejects photoreal faces → gpt-image-2 for stills, Omni image-to-video (the app's `call_model`) or Kling-backed `reenact` for motion (`seedance-flags-human-refs`).

**wardrobe-swap-identity** — same face, the RIGHT clothes for a scene, held across a whole video.
`image-from-character-sheet with a wardrobe-delta prompt on the LOCKED sheet → (optional) render that outfit as its OWN 3-panel sheet → cite it as the wardrobe ref for every shot in that video`
Identity refs + an outfit brief → the character in the target outfit, consistent across the video's shots.
Proven: state sheets (wet/dry) in the cinematic-ad build; a per-video outfit sheet (aroll `[aroll-shots]`).
Gotcha: ONE outfit per video; a mid-scene STATE change (dry→sweaty) = a SECOND sheet, not a mid-shot word tweak; outfits ride on the locked sheet so the FACE carries; each edit softens skin → composite the edited outfit back onto the hi-detail hero for close-ups.

**identity-image-to-video** — animate an on-identity still using EXAMPLE motion.
`on-identity still (= swap-image) + a reference-motion clip (= driver-video) → mint_video reenact` — or de-novo: Omni image-to-video via the app's `call_model` (`google-gemini-omni-flash-image-to-video`, `image_url` = the still)
A generated on-identity image + a motion example → an on-identity clip with that motion, identity held.
This is reenact's remaining use: the still is the shot and the example clip only lends its motion.
To put the character INTO the example clip instead (its footage kept), that is a person swap → `genjutsu`.
Proven: the same reenact primitive as `motion-transfer-restyle`; the motion half of `gen-talking-head-from-face` (proven on multishot, now unavailable, videoclaw#317).
Gotcha: Kling through the gateway is the only reenact route;
`mint_video multishot` is unavailable (videoclaw#317). Reenact never silently falls back across model families;
Seedance `insert` E005-rejects photoreal face refs. Compress the driver first
(big drivers time out); QA identity-hold on the first ~3s before batch; for
motion with NO example, use Omni image-to-video / `keyframe-hero`, not reenact.

## Person — performer, identity, voice

**build-locked-narrator** — one reusable face + voice + idle bed for a recurring channel.
`cast_avatar → synth_voice design→save → mint_image → mint_video keyframe → loop-concat`
Host brief → host_bed.mp4 + voice.json, reused every episode.
Home: `assets/<tenant>/` + voice id & bed path in the pack's COMMITMENTS — this IS the channel.
Proven: an authority-host channel rebuild (<host_bed>, <LOCKED_VOICE_ID> — the real
values live in that tenant's pack COMMITMENTS).
Gotcha: preview generated_voice_id ≠ final — only `save` mints the reusable id.

**revoice-locked-edit** — fresh episode VO onto a prebuilt bed, no face regen.
`⟨VO: real read | synth_voice tts | voice_change⟩ → lipsync_footage long (--max-seg 50)`
Any VO + host bed → lip-synced spine, length = VO. (Ladder: real read wins.)
Proven: an authority-host channel rebuild.
Gotcha: word budget ≤ bed length; sync fails past ~60s segments.

**voice-variant-cut** — N spokesperson/gender/locale variants of one locked edit, zero re-edit.
`synth_voice voice_change → ffmpeg audio-swap → compose_render --mode render`
final_raw + real VO + target voice_id → versions/<voice>.mp4. (Localize-dub = same move.)
Proven: a SaaS screen-demo build shipped v1/v2/v3 off one edit.
Gotcha: key needs speech_to_speech + voices_read scopes; timing holds ~0.03s.

**sample-then-recast** — verify a voice-change identity cheaply before the full recast.
`ffmpeg -t 5 slice → voice_change → verify_output --mode audio + listen → full voice_change`
Source VO + target voice → verified full recast.
Proven: pattern only (mirrors the sample→batch cost law).
Gotcha: STS carries source noise through — clean_audio denoise first (safe to run
always: it measures the take and passes clean audio through untouched).

**mispronunciation-diff** — catch wrong words in ANY synthetic voice before video spend.
`⟨synthetic VO: tts | voice_change | Seedance-native dialogue⟩ → synth_voice transcribe → diff vs script → respell → re-gen`
Dialogue text → verified-clean take. For Seedance, run on the CHUNK audio — a flub
caught post-chunk is one chunk regen; caught at final render it's a full re-render.
Proven: an authority-host + editorial-channel b-roll eval.
Gotcha: phonetic respell goes in pronunciation_notes, NEVER in spoken dialogue.

**gen-talking-head-from-face** — identity-locked on-camera shots when no usable take exists (composes `image-from-character-sheet` + `identity-image-to-video` + lipsync).
`mint_image portrait (multi --reference face CUs) → Omni image-to-video (call_model) → lipsync_footage long`
Real face refs + VO slice → synced generated talking-head window.
Home: face refs + character sheets live in `assets/<tenant>/character_sheet/`, never job-scoped.
Proven: a working-habits a-roll reel.
Gotcha: sync DRIFTS on synthetic bases — prefer real footage; Seedance E005-rejects
photoreal faces. If a real base take EXISTS, use face-swap-real-base instead (motion law).

**dynamic-pip-cutout** — generated reader integrated onto b-roll, never a boxed webcam tile.
`perform_avatar → lipsync_footage gen (per cut) → sam3 segment → composite`
Avatar identity + script → foreground cut-out that MOVES and goes fullscreen on hard lines.
Proven: a long-form-article short (20 corner / 14 fullscreen beats).
Gotcha: decouple avatar moves from Ken-Burns direction changes; no avatar-less scenes.

**seam-masking-inserts** — hide long-lipsync stitch points with fresh motion cutaways.
`lipsync_footage long → mint_image + mint_video seam clips → compose_render --broll-inserts`
Seam timestamps → cutaways composited exactly over the stitches.
Proven: an authority-host channel rebuild.
Gotcha: a still over a 4s+ window goes dead — each seam gets NEW motion.

## Footage — b-roll, motion, product

**locked-style-broll** — on-brand artistic b-roll in one pinned art style.
`mint_image artistic_still (--reference pack exemplar) → mint_video (single-delta prompt)`
Scene description + style exemplar PNG → styled clip, optional native SFX.
Proven: an editorial-channel b-roll episode.
Gotcha: never style-by-prose — the reference PNG is the lock; no legible-text props.

**keyframe-hero** — a cinematic "impossible" moment with locked motion fidelity.
`mint_image seed_frame ×2 (first+last) → mint_video keyframe`
Two precise keyframes + single-delta prompt → interpolated hero clip.
Proven: 21 runs (b3b_chest, b6_microwave…).
Gotcha: first/last frames mutually exclusive with --reference; engine min 4s.

**faux-screen-recording** — an app/UI beat that reads as real screen capture.
`mint_image (UI still) → mint_video insert (slow push-in)`
UI mockup prompt → scrolling/counting/click clip.
Proven: a directory-site scroll insert (a-roll reel, tenant-approved).
Gotcha: push-in only — a scroll reveals new rows the model garbles.

**seed-anchored-action** — precise physical interaction i2v otherwise fumbles.
`mint_image (mid-action state seed) → Omni image-to-video (call_model, image_url = the seed)`
Composed correct-state frame → motion that can only continue the placement.
Proven: a product-ad handoff beat (after 3 failed prompt-only attempts).
Gotcha: object transfer between two people still unreliable in one take — add an insert.

**card-multishot** — N cards placed sequentially with zero position drift.
`mint_image master → single-card subtraction edits → mint_video keyframe per card (state k → k+1)`
Card list + mat/hand anchors → one placement clip per card, stitched in order.
Proven: a card-multishot render (the one-call multishot version, now unavailable, videoclaw#317).
Gotcha: hands small at edge or E005.

**motion-transfer-restyle** — apply a reference-conditioned new LOOK (a product or object restyle) to a REAL clip while keeping its real motion (full router: §The footage-transform router).
Offer both and ask the user which: `mint_video edit` (Omni edit: faster, one prompt-only change) or
`mint_image (target look still) → mint_video genjutsu (the clip + that still as a reference)` (more powerful: the look comes from the image).
Real clip + a target look → consistent restyled clip, no per-frame flicker.
A new PERSON in the clip is a person swap, never reenact: `mint_image --role seed_frame --aspect
<the clip's aspect>` (first frame with the person replaced) → `mint_video genjutsu` (the clip + seed frame as Image 1 + character refs).
Proven: a novelty e-commerce product (blue→pink unscrew restyle, then run on Kling reenact).
Gotcha: genjutsu takes 4–30 s of the clip; Omni edit garbles inputs under ~3 s.

**frame-insert-scene** — b-roll composited INTO an in-scene screen with occlusion.
`perform_avatar host scene → frame_insert --screen-prompt --occluder-prompt`
Host scene + b-roll clips → composited scene, fingers restored in front.
Proven: pattern only (a stylized-scene example; B1 got picked in the real run).
Gotcha: never put a screen inside the screen; content vignettes to black.

**brand-grounded-beat** — a full-screen brand still that reads as the brand, not generic AI.
`mint_image artistic_still (multi --reference: hero+logo+screenshot) → Ken-Burns in overlays.tsx`
Brand refs + loose concept → animated hook/bridge/close beat (~$0.17).
Proven: a SaaS screen-demo build (4 stills, $0.68 total job).
Gotcha: place full-screen via overlays, NOT inside the card-framed base video.

## Sourcing — find before you generate

**retrieval-first-router** — the right clip/still from the cheapest real source.
`index_media search → pull_video (stock/URL) → mint_* (last resort)`
Beat description → materialized real clip, or generation only on miss.
Proven: search validated on the tenant's library.
Gotcha: low top score (~0.30) = "closest I have", not a hit — verify or fall through.

**brand-intake-url** — tenant fonts/palette/logo/refs recovered from their live site.
`website_style → curl logo/hero/screenshots → jobs/<id>/brand/`
Product URL → --reference-ready brand asset set.
Home: promote to `taste/packs/<tenant>/` on first reuse — brand assets outlive the job.
Proven: a SaaS screen-demo + a novelty e-commerce product foundation.
Gotcha: website_style is fonts+colors ONLY today — logo/hero pulls are manual.

**format-mining-loop** — a proven, concept-matched format locked before any generation.
`Sandcastles search → pull_video enumerate/pull → analyze_reference --format-proposal`
Product premise → concept bank (hook × format × message, match-scored).
Proven: a novelty e-commerce product (13,843× outlier magician format).
Gotcha: rank concept-match × outlier, not outlier alone.

**gemini-windowed-select** — cut the best passage from a long source without scrubbing.
`pull_video pull → Gemini timestamp query (--mode select) → ffmpeg trim`
Long URL + "what to look for" → trimmed clip + {in,out,rationale} sidecar.
Proven: a long-form lecture windowed pull.
Gotcha: clamp timestamps to duration; picks are mechanical, never quality.

**long-source-vertical-clip** — a hook span from a long talk, reframed 9:16, paced.
`pull_video (windowed) → synth_voice transcribe --diarize → sam3 reframe → densify aroll`
Long URL + span → 9:16 subject-centered densified clip.
Proven: a long-form lecture short ($0.05, QA-stamped).
Gotcha: split the span if the subject leaves a fixed crop.

**hook-find-pass** — strongest hook windows ranked with optional human override.
`synth_voice transcribe → analyze_reference hooks (rank) → strongest grounded default → clips.json`
Diarized transcript → ranked hook windows with timestamps + why.
Proven: a long-form lecture source (shape proven; wrapper unbuilt).
Gotcha: surface the plaintext transcript and candidates when useful, but do not wait for a
human pick unless the user explicitly requested selection.

## Audio

**bed-find-and-screen** — real ambience bed under a VO, screened for vocals before use.
`pull_video --bed (--audio-only) → verify_output --mode audio → listening check → use the bed`
Ambience URL → a clean bed ready to sit under the VO, vocals/loop-seam screened.
Proven: an editorial-channel b-roll + authority-host rebuild.
Gotcha: `verify_output --mode audio` only measures clipping and dropouts — it cannot hear
vocals or a loop seam. Before building on the bed, do an explicit listening check for any
words and for the loop seam (either one → re-source). When you cannot listen yourself, give
the user the playable bed (like `voice_change`'s sample check) and say what to listen for;
it is a check on the asset, not an approval step. Also check voice-band collision
(250Hz–3kHz).

## Assembly

*(Bespoke one-of-one assembly — split-screens, PIP composites, kinetic text, beat-stabbed
beds — is a supported path, not a failure: the proven ffmpeg/PIL idea catalog is
[`skills/assembly_craft.md`](assembly_craft.md). Whatever path you take, DECLARE the
timeline: `assemble.py --declare`.)*

**retrofit-captions** — word-timed brand captions burned onto a pre-assembled edit.
`ffmpeg assemble → style_directives.json (named preset) → compose_render --mode retrofit`
final_raw.mp4 + transcript.json → final.mp4 with preset captions + overlays.
Proven: two a-roll reel rebuilds.
Gotcha: NO implicit caption preset — omit style_directives and captions render WRONG.

**flub-splice-repair** — fix one bad spoken line without a full re-render.
`isolate flub span → re-gen ONLY that segment with a NEW camera angle → hard cut at the flub → splice`
Chunked video + one mispronounced line → repaired cut; the angle change legitimizes the edit.
Proven: tenant-attested practice (cheaper than full re-render).
Gotcha: only viable in cut-heavy styles — a single continuous take can't hide the splice.

## Trend-duplication molecules (2026-07-09 — from the reference-remix build)

**reference-audio-scrub** — strip a reference clip's spoken VO but KEEP its sung hook.
`scrub_reference_vo.py (→ gateway stem_split) → instrumental everywhere + vocals stem gated to --keep-singing ranges`
Reference audio + singing-section ranges (from breakdown sections) → clean bed, speaker's VO gone, hook intact.
Proven: 2026-07-09. Do NOT center-cancel or pip-install demucs ([[stem-split-wired]], [[capability-discovery-rule]]).
Gotcha: MDX23 bleeds faint garbled speech into the instrumental on talking-head audio — keep the bed one steady level well under the new VO (no ducking; lower it further if the bleed is still audible).

**kinetic-word-behind-mask** — a word flashes BEHIND the subject's head, one word at a time, synced.
`sam3 segment --output-kind mask_only → timed Remotion/SVG text layer (fit ~92% width) → composite text UNDER the subject matte`
Talking clip + VO word-times + word list → clip with power-words passing behind the head.
Font pixel-matched from reference (e.g. a Didone → Playfair Black wght-900
static). Typography remains code-native and editable; never emit one PNG asset
per word or use generated imagery for text.
Gotcha: it's ONE-WORD-AT-A-TIME (replace), not one static word; sample dense frames of the reference or you'll miss the animation; the words must stay readable AROUND the head positions — `check_layout` the safe zones before batching; on LONG beats (>8s) the mask can lag fast head movement and QA flags covers_face — keep masked-word windows short or re-QA the beat.

**accumulate-caption** — word-by-word caption that builds up, in front, lower-center.
`Scribe word-times → one Remotion/ASS text system (wrap+center, stroke) → timed cumulative reveals`
Clip + VO word-times → clip with a TikTok-style accumulating caption (sans; colour per brand).
Distinct from kinetic-word-behind-mask — different z-order; verify which the
reference uses. Store word timing as data, not duplicated raster states.
Gotcha: thin black stroke for legibility over busy backgrounds (shadow-only presets go faint on bright surfaces). **When:** ONLY for pixel-matching a reference's caption animation the preset system can't express — otherwise captions are ALWAYS a named `compose_render` preset (`retrofit-captions`); never fork the caption stack casually.

**beat-synced-impact-bed** — build a bed whose hits land on the cutaways and whose drop lands on the payoff line.
`clean instrumental (stem/scrub) → impact stabs adelay'd onto each cutaway (escalating) + drop adelay'd to the montage start → one steady level ~15 dB under the VO, the same through speech and montage (never ducked, cut or muted under a line)`
Clean bed + cutaway timestamps + drop timestamp → a bed that pops on the aura beats.
Proven: 2026-07-09 (build_bed_synced.py). Reapply section-aligned (remix beats run longer than the reference), not 1:1.
Gotcha: verify the mix by TRANSCRIBING it — a buried VO reads as "[outro jingle]".

**face-crop-lipsync** — lipsync the CORRECT face in a multi-person shot (sync-3 grabs the biggest/frontal one).
`ffmpeg crop the target face → lipsync_footage long on the crop → lipsync_footage composite --x/--y/--w/--h back onto the base`
Two-person clip + which face + that person's VO → the intended person mouths the line, the other stays idle.
Proven: 2026-07-09. Generated secondary faces need no identity lock.
Gotcha: pick the crop from the clean (pre-lipsync) base; the composite feathers the seam.

## Script-to-film molecules (2026-07-09 — imported from the shotlist-director skill)

**directors-shotlist** — turn a script/treatment into numbered 15s cinematic prompt beats.
`read as a director (find the dramatic shape) → block scenes → split each into 15s prompts (3a/3b/3c) → strict prompt structure (prefix/characters/geo-spatial scene/CUTs) → one mint_video --mode keyframe --duration 15 per prompt`
Script → shotlist of copy-ready prompts → clips → assemble.
Imported from an in-use external skill; recipe: [`workflows/script-to-film.md`](../workflows/script-to-film.md). Not yet exercised end-to-end in-repo.
Gotcha: pack dramatically, not efficiently — a heavy line gets its own prompt; a reveal lands on ONE sustained close-up; fill all 15s (the engine renders fixed length — dead air is wasted spend).

**style-prefix-lock** — keep N independently-generated clips looking like ONE film.
`write one global style block (look/light/color/lens/acting/physics laws) → prepend VERBATIM to every prompt in the set`
Style block + per-beat prompts → cross-clip visual continuity without LoRAs or reference chains.
Imported 2026-07-09; default prefix text in [`skills/_references/shotlist_director_reference.md`](_references/shotlist_director_reference.md).
Gotcha: verbatim means verbatim — paraphrasing the prefix per prompt reintroduces drift; each copy-block must be standalone (prefix + prompt) so one paste works.

**continuity-carry** — characters carry STATE across generated scenes.
`track per character: physical state (wet/bleeding/exhausted), appearance (hair/wardrobe/props), emotional carry, location/time/weather → surface as concrete language inside Characters + CUT lines of every later prompt`
Scene-N events → scene-N+1 prompts that remember them (wet hair from the rain, blood on the knuckles).
Imported 2026-07-09; the anti-identity-drift complement to face-ref identity pipelines (see the character/identity molecules above).
Gotcha: never emit a visible "continuity" block — it lives in your head and lands as descriptive prompt language, or the engine renders the tracker text.

---

## Extensions — components proven, chain not yet run

**alter-ego** — you, as someone else: same performance, new voice AND face/scene.
`synth_voice voice_change (real VO, timing preserved) → frame grab → mint_image (restyle
face/background IN-POSITION = the seed frame, --aspect <the clip's aspect>) → mint_video genjutsu
(your clip + seed frame as Image 1 + character refs; a person swap)`
Your take + a character brief → the same performance by a different person.
Proven: each link proven separately (a SaaS-demo STS, a product-ad reenact); chain never run.
Gotcha: identity-hold on faces is the risk — QA the first 3s before batch.

**pause-stilling** — kill gesticulation through VO pauses without leaving the face.
`map VO pauses → speed-curve/freeze the base at those stamps (BEFORE sync) → lipsync the windows`
Generic base + pause-heavy colloquial VO → a base that goes STILL while thinking, then talks.
Proven: defect observed for real (a colloquial-VO reel — gesticulating through "um…" pauses);
speed-curve fix specified (craft law), mouth-safety untested.
Gotcha: warp the base pre-sync or mirror the warp on the audio; never warp after sync.

**multi-angle-sync** — one canonical take, two camera angles, twice the realness.
`film same take from 2 angles (same outfit/location) → lipsync_footage plan+gen per angle → cut between`
Script + 2-angle base takes → a-roll that feels like a real filmed event, not a webcam.
Proven: the tenant is filming these now; sync-per-window proven, the 2-angle cut is the new part.
Gotcha: sync only the WINDOWS each angle is on-screen for — syncing both full takes doubles cost.

**ipad-reveal** — "I drew this for you": a-roll hands off to a hand-made-looking diagram.
`a-roll take ending hand-down-to-visible-iPad → mint_image (iPad-drawn style: clean strokes,
consistent coloring) → cut on the hand-down → Ken Burns the drawing`
Script beat + the iPad-ending take → a reveal that reads as a diagram he drew for this exact video.
Proven: takes recorded (2026-07-03); gen-side pattern only. The iPad style is cleanly generatable.
Gotcha: the drawing must match what the VO just said — a generic diagram breaks the illusion.

**fullscreen-typography-hijack** — emphasis without the face: take the line off-screen.
`block-color OR masked-image background (e.g. plants + dark mask) → kinetic typography of the
emphasized words → hard cut in/out`
An emphasis line + 2-4 key words → a beat of pure typographic punch.
Proven: hijacks exist in compose_render vocabulary; this named treatment is pattern-only.
Gotcha: use when the a-roll moment ISN'T good — face beats this when the face is good. For
in-scene text BEHIND the speaker, use `kinetic-word-behind-mask` (proven) instead.

**performance-matched-base** — an emotive/paused line delivered by a base that ACTS it.
`isolate the base section for that line → mint_video reenact (real section as
reference, prompt the wanted delivery: pauses, emphasis, stillness) → lipsync THAT window`
Generic base + emotive VO line → a base whose body language matches the read, then synced.
Proven: pattern only (specified 2026-07-04); links proven separately.
Gotcha: identity-hold on your own face is the risk — human gate applies; use for the
few main-stage lines, not wholesale.

**face-swap-real-base** — a new face on YOUR real base take: real motion, generated identity.
`frame grab from real base → mint_image (edit face in-position = the seed frame, --aspect <the
base's aspect>) → mint_video genjutsu (real base + seed frame as Image 1 + face refs; a person
swap) → lipsync the windows on top`
Real talking-head base + face brief → new-identity talking-head with REAL motion.
Proven: each link proven (base takes, in-position edits, a product-ad reenact); chain unrun.
Gotcha: this is the motion law applied — transfer real motion instead of generating it;
check identity-hold on the first seconds before batch; human gate on the close-ups.

**i2v-speech-rescue** — keep a generated clip's good ambience, delete its hallucinated speech.
`stem_split (gateway) → drop vocals stem → ffmpeg remux bass+drums+other`
Generated clip with bad spoken line → same clip, ambient/SFX only.
Proven: stem_split live-verified 2026-07-04 (stems ordered bass/drums/other/vocals); remux pattern from an emotional-brand-film need.
Gotcha: verify by ear (`verify_output --mode audio` + listen) — vocals bleed into `other` on dense mixes.

**collage-assemble-from-empty** — an abstract line lands as a paper-collage metaphor
assembling from nothing (whole-reel spine: `workflows/collage-explainer.md`;
mechanics: `broll_styles.md` Method 20).
`mint_image artistic_still (halftone_collage register, = LAST frame) → ffmpeg lavfi
solid plate at the still's bg hex (= FIRST frame) → mint_video keyframe (stop-motion
assembly prompt from the metaphor spec's assembly_order)`
Metaphor spec (3–6 objects + field hex + assembly order) → a 4–6s assemble-from-empty clip.
Proven: engine link proven (keyframe mode, 21 runs — `keyframe-hero`); the empty-plate +
assembly-prompt chain is imported (gbro-collage-broll, MIT) and has not run in-repo.
Gotcha: the plate hex must match the still's field EXACTLY or the clip fades in instead of
assembling; QA frame-0 near-solid + end-frame vs the approved still (Method 20 §QA).
