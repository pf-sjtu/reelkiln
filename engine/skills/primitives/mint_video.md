# mint_video — the canonical video primitive

One tool, `--mode {insert, keyframe, reenact, edit, genjutsu}`; **the mode picks the
engine** (Seedance / Kling / Gemini Omni / Higgsfield Genjutsu). It replaces the legacy
per-provider video tools. `--mode multishot` is unavailable (videoclaw#317): the gateway
refuses every request, so the tool exits before any spend.
Clip extension is not part of this CLI.

```
mint_video --job <job> --mode <mode> --name <name> [--prompt "..."] \
           [--reference <png>] [--first-frame <png> --last-frame <png>] \
           [--swap-image <png> --driver-video <mp4>] [--video <mp4>] [--duration <s>] \
           [--resolution {480p,720p,1080p}] [--quality {standard,draft}] [--audio]
```

`--mode` is **required** and logged as `usage_role`. Do not choose a provider:
**split by mode, not by engine** — the engine is chosen under the hood from mode + constraints.
Evidence: ~90 classified video runs from the archived generation-role analysis plus
the internal coverage pass.

## ⚖️ Engine-selection law (JC, 2026-07-03; amended 2026-07-18 chunk 31)
- **Seedance-first for straight generation.** `insert` and `keyframe` stay on
  Seedance; `--quality draft` (or legacy `--fast`) selects Seedance fast at
  720p. Standard accepts an explicit 720p or 1080p resolution; a draft request
  is downshifted to the fast tier's supported 720p before submission.
- **Edit-not-regenerate (chunk 31).** Footage that already has the right motion but
  the wrong LOOK (style, environment, an object that must change) is an `edit`, not a
  fresh generation — the Omni-backed video-to-video path preserves validated
  motion/timing and prices per second of output.
- **Kling `reenact` only makes a still perform (JC, 2026-08-22; narrowed 2026-09-29).**
  Not for person swaps; use `genjutsu`.
  `reenact` uses Kling v3 Pro motion control with Fal primary and the same Kling
  model on EachLabs as a pre-accept fallback. If Kling cannot complete, stop.
  Never silently substitute Gemini, and never add lip sync unless the user
  separately asks to replace the dialogue. The driver audio is preserved.
- **Genjutsu for every person swap (JC, 2026-09-27; widened 2026-09-29).** Any
  swap of the people in a real clip goes to `genjutsu` (Higgsfield Genjutsu
  motion transfer), whatever the count: one face on a short clip, two or more
  people, a clip with scene changes or camera-angle changes, dance and
  performance memes, outfit or scene/style swaps that must keep the choreography.
  JC rates it above Kling `reenact`; Kling produced only a 4.3s one-person draft
  of a two-person transfer. Its one fallback is Omni edit after a Higgsfield
  moderation refusal; it never substitutes Kling motion control, and the
  original audio is kept.
- **Omni for other image-referenced video (JC, 2026-07-23).**
  Any job expressible as **prompt + video** or **prompt + one image** goes Omni — it
  held a real face across full restyles (anime/LEGO/watercolor live test, likeness
  intact, no reference image needed) where older provider paths drifted.
  A still of a real person with no footage goes to Omni image-to-video through the
  app's `call_model` (`google-gemini-omni-flash-image-to-video`: one `image_url`,
  3–10 s, 16:9 or 9:16). If the face is already in the footage and only the
  setting/object/style changes, `edit` is the face-safe path.
- **💸 Audio controls are mode-specific.** Seedance `insert`/`keyframe` default
  silent and `--audio` requests native SFX; `--no-audio` strips a returned track
  after download, independent of the provider.
- **✍️ Freehand Seedance prompts bypass the `check_script` guide audit.** Before
  any Seedance-backed generation whose prompt you wrote by hand (insert b-roll,
  keyframe hero shots, ad beats), run the ~2-minute checklist in
  [`skills/seedance_prompt_compiler.md`](../seedance_prompt_compiler.md).

---

## `insert` — ~29 runs
- **purpose:** short under-dialogue visual insert from a reference still (1–6s).
- **use_when:** audio continues and the visual only needs to support a point — not the wow beat.
- **do_not_use_when:** it's the hero/lingering moment (→ `keyframe`); a proof receipt (→ `pull_video`).
- **inputs:** `--reference` still + prompt + `--duration` + optional `--audio` bed.
  Seedance's minimum is 4 s: a shorter `--duration` (e.g. `3`) is generated **and billed**
  as 4 s. Pick 4 s or more, and trim to the beat length in the edit.
- **backend:** Seedance 2.0; `--quality draft` uses Seedance fast.
- **success_check:** readable, on-beat, does **not** replace the proof or emotional beat; frame-extract → Read.
- **evidence:** `gen_broll … --reference broll4_window_v3.png --duration 6 --audio "Continue the photoreal scene…"`

## `keyframe` — 21 runs (the hero moment)
- **purpose:** a foregrounded moment the viewer lingers on, made by interpolating a `seed_frame` pair.
- **use_when:** the beat is the emotional / visual payoff.
- **do_not_use_when:** it's filler under dialogue (→ `insert`).
- **inputs:** `--first-frame` + `--last-frame` (from `mint_image --role seed_frame`) + prompt.
- **backend:** Seedance 2.0 i2v interpolation; `--quality draft` uses Seedance fast.
- **success_check:** smooth motion, no morph artifacts; the lingered detail reads clearly.
- **evidence:** `gen_video … --first-frame b3b_chest_first.png --last-frame b3b_chest_last.png` (21 direct runs, b186ab52). Confirmed core.

## `multishot` — unavailable (videoclaw#317)
- **status:** the gateway refuses every multishot request (`MODEL_CAPABILITY_UNAVAILABLE`),
  so `mint_video` exits before any upload or spend. Use `keyframe`/`insert` for
  non-photoreal state changes, `call_model` Omni image-to-video for a real person's still,
  `edit` for existing footage, `genjutsu` for a person swap, `reenact` to make a still perform a driver's motion. The notes below are historical.
- **purpose:** an ordered multi-state sequence across one beat (cards appearing, a hand sweeping, numbers ticking).
- **use_when:** the beat is a state change / progression.
- **do_not_use_when:** single continuous motion (→ `keyframe` / `insert`).
- **inputs:** `--multishot-file <json>` + one or more ordered `--reference`s.
  Cite every ordinary reference in a shot prompt as `<<<image_N>>>` in upload
  order; dangling, out-of-range, and silently unused references are rejected.
  A legacy `--start-image` is an implicit opening anchor.
- **backend:** Gemini Omni through the gateway (required).
- **no seed:** the Omni route takes no seed, so `--seed` is refused rather than silently
  ignored. For one consistent voice across several clips, generate with `--no-audio` and
  lay a single `synth_voice` track over them.
- **success_check:** the states land in order; transitions don't tear.
- **evidence:** ordered-reference multishot probes held shot order and identity.

## `reenact` — make a still perform a driver's motion (not for person swaps; use `genjutsu`)
- **purpose:** bring one still (a photo or generated image of a person or character) to life
  with the body motion of a separate driver clip. Kling builds the result from the still, so
  it keeps the still's own setting, framing and outfit; none of the driver's footage is kept.
- **use_when:** the still IS the shot and there is no source clip to keep, only a clip that
  lends its motion ("make this photo do that dance, in the photo's own setting"). Genjutsu
  cannot do this, because it always keeps the source clip's footage.
- **do_not_use_when:** not for person swaps; use `genjutsu` — putting someone into a real
  clip in place of the people there, keeping that clip's footage, is a person swap at any
  count (one face on a short clip included). If you can't tell which the user wants, it is
  a swap. Also not for fresh motion from a still (→ `insert` / `keyframe`), or when the real
  person is fine as-is (→ `pull_video`).
- **inputs:** `--swap-image <png>` + `--driver-video <mp4>` + `--duration`.
- **backend:** Kling v3 Pro motion control through the gateway. Fal is primary;
  EachLabs may run the identical Kling model only after a proved pre-accept Fal
  rejection. There is no Gemini fallback. Gateway mode is required.
- **rights:** a face/image the user uploads or selects for this operation is an
  authorized production input. Do not interrupt the workflow with a repeated
  rights-confirmation question.
- **audio:** retain the original driver audio. Do not automatically lip-sync or
  synthesize dialogue; those are separate explicit operations.
- **⏱ latency:** several minutes is normal; see **⏱ Latency** below.
- **success_check:** identity holds across motion; no melt/morph at fast movement; frame-extract → Read.
- **evidence:** exact Khailee regression fixture on 2026-08-22 materially held
  identity/motion better than Gemini; Fal output was 4.8s at 1184×1760 and the
  original driver audio was restored locally.

## `genjutsu` — Higgsfield Genjutsu motion transfer (every person swap)
- **purpose:** keep a real clip's performance — body motion, camera path, timing and cuts —
  while its people, outfits, props or world are recast from 1–8 reference images.
- **use_when:** every person swap, at any count: one face on a short clip, two or more
  people, a clip with scene changes or camera-angle changes, dance/performance memes,
  "same choreography, our characters", a scene or style swap that must keep the motion.
  One person or several, the process is the same (seed frame, one reference per
  character, the recipe prompt); only the prompt's who-becomes-whom mapping changes.
- **do_not_use_when:** only the look/style of existing footage must change (→ `edit`); there
  is no source clip (→ `insert` / `keyframe`). Swaps of any count go here, never to `reenact`.
- **inputs:** the source video + a seed frame (usually required, below) + one reference
  image per character + a prompt: `--video <local mp4|mov>` (exactly one, 4–30 s; see
  **input length**) + `--reference <img>` (repeatable, 1–8, citation order =
  "Image 1".."Image N"; the seed frame first) + **required** `--prompt` (≤10,000 chars).
  Resolution is always the 720p default: no lower-resolution drafts, and `--resolution
  1080p` only when the user asks. Output lands in `genjutsu/<name>.mp4` (or `--output`).
- **input length (4–30 s):** the tool measures the clip before any upload or spend.
  - **Under 4 s** (say a 3 s clip): refused, because Higgsfield documents a 4 s minimum. Cut
    a window of at least 4 s from the footage around the moment and trim the result back to
    the beat (billing is per whole input second, so a 4 s window bills 4 s). With no more
    footage to cut, pass `--allow-short` to send it anyway: the gateway takes down to 1 s,
    but the result may be refused (not charged) or weak.
  - **Over 30 s:** refused. Split it into ≤30 s segments and send them as one `--batch`.
- **ask who becomes whom first (plan step):** before the paid run, name each person in the
  clip by screen position or clothing ("the left dancer in the red jacket") and ask the user
  which reference each one becomes, unless they already said. Put that mapping in the prompt.
- **prompt recipe (adapt it; the tool refuses a prompt without the mapping or either list):**
  1. With a seed frame, open with "Image 1 is the video's first frame with the characters
     already replaced; match it."
  2. "Replace the characters in the video with the characters in the reference images."
  3. **Who becomes whom:** map every replaced character, named by screen position and
     clothing ("the dancer on the left in the red jacket"), to its "Image N". Name every
     reference; never "the man" when that is ambiguous.
  4. **FROM THE VIDEO**, keep exactly the same: motion, timing, camera path, cuts,
     background, setting and lighting.
  5. **FROM THE REFERENCES**, take only each character's identity: face, hair, outfit and
     body.
  6. Close with "Don't blend features between the characters (no cross-contamination)."

  With a seed frame (the usual case), two people:
  `Image 1 is the video's first frame with the characters already replaced; match it.
  Replace the characters in the video with the characters in the reference images. The
  person on the left in the blue shirt becomes the woman in Image 2; the person on the
  right in the black dress becomes the man in Image 3. From the video, keep exactly the
  same: all motion, timing, camera path, cuts, background, setting and lighting. From the
  reference images, take only each character's identity: face, hair, outfit and body.
  Don't blend features between the characters (no cross-contamination).`
  For one person, map just that person ("The woman in the grey coat becomes the person in
  Image 2."); everything else stays the same.

  Without a seed frame (only when the user goes without one):
  `Replace the characters in the video with the characters in the reference images. The
  character on the left in the red jacket becomes the person in Image 1; the right
  character becomes the kiwi in Image 2. From the video, keep exactly the same: all
  motion, timing, camera path, cuts, background, setting and lighting. From the reference
  images, take only each character's identity: face, hair, outfit and body. Don't blend
  features between the characters (no cross-contamination).`

  The tool refuses a prompt that leaves out an Image N, names one that wasn't given, doesn't
  say what stays from the video (its motion, timing or camera), or doesn't say what the
  references supply (face, hair, outfit, body; or the setting or object an image supplies).
- **seed frame (recommended and usually required):** the best results come from a first-
  frame reference close to the video's own first frame. Skip it only when you already have
  a very well-fitting image of the new cast in the clip's first-frame pose and framing. If
  the user insists on going without one, that's their call: recommend it once, then run
  the no-seed variant; never block. To make the seed frame, take
  the video's first frame and swap the characters in it with the image tools, at the
  source clip's aspect (mint_image's seed_frame default is 2:3, which won't match the
  clip): `mint_image --role seed_frame --aspect <the source clip's aspect: 9:16, 16:9,
  1:1, 4:3 or 3:4> --reference <first frame> --reference <character image>…`.
  Pass it as Image 1 and say what it is ("Image 1 is the video's first frame with the
  characters already replaced; match it"), then the character references as Image 2..N.
  For a vertical 9:16 clip with two people:
  `mint_image --job <job> --role seed_frame --name swap_seed --aspect 9:16 --reference
  first_frame.png --reference person_a.png --reference person_b.png --prompt "Replace the
  two people in the first image with the people in the second and third images; keep the
  pose, framing, background and lighting of the first image."`, then
  `mint_video --job <job> --mode genjutsu --name swap --video clip.mp4 --reference
  jobs/<job>/images/swap_seed.png --reference person_a.png --reference person_b.png
  --prompt "<the seed-frame prompt above>"`.
- **cuts are fine:** a source with cuts works as long as the prompt and references are clear.
  Do not split the video at its cuts; split only a source longer than 30s.
- **rules:** one identity per character reference image (the seed frame is the exception: it
  shows every replaced character in place), well lit, covering the angles the clip shows
  (add a profile reference for turns); fewer relevant references beat many; change one
  variable per run.
- **known failures:** faces drift on turns (add side references); hands/props deform
  (shorten the clip); outfits or backgrounds flicker (remove conflicting references);
  extra people appear.
- **moderation refusals (rare):** Higgsfield practically never refuses a real face; when it
  does refuse, the tool says so and nothing is charged. Rewording won't help. The agent
  falls back once to Omni edit, the newest Gemini Omni model: `mint_video --mode edit
  --video <the clip> --name <slot> --prompt "<one person, described in words>"`, describing
  each person in words, one person per call, chained: the first call edits the source clip
  and each later call takes the previous call's `edits/<slot>.mp4` as `--video` under a new
  `--name`, so the last output has everyone swapped. Omni edit keeps the clip's motion but takes only
  the clip and a text instruction, no photos, so tell the user the result will resemble
  the description, not their photo. If Omni edit also refuses or fails, stop and offer a
  fictional or stylised reference, changing only the outfit or setting, or a different
  clip. Never Kling.
- **gateway refusals (nothing charged):** the gateway measures the uploaded clip itself and
  refuses one whose container and picture lengths disagree by more than 0.1s or straddle a
  whole second (an edit-list trim, a damaged header, audio much longer than the picture) —
  re-encode or trim it exactly as the error says, then run again.
- **backend:** Higgsfield `higgsfield/genjutsu/motion-transfer/v1.0` through the gateway
  (required). Its only fallback is Omni edit after a moderation refusal (above); it never
  substitutes Kling motion control or Seedance.
- **⏱ latency:** several minutes is normal; see **⏱ Latency** below.
- **audio:** the generated soundtrack is always stripped; the source clip's own audio is laid
  back on (a silent source stays silent). The picture is conformed to the source clock if
  the provider re-times it, so the result drops onto the source timeline.
- **cost:** billed per WHOLE second of the INPUT clip (10.1s bills 11s) at the resolution
  tier: the 720p default, or 1080p only when the user asks (about 2.4× 720p). The gateway
  measures the uploaded clip itself and prices exactly that; `--duration` is ignored. Do not
  calculate or quote dollars locally — the host shows the exact maximum at the operation
  boundary.
- **BATCH (`--batch specs.json`)**: items `{name, video, references?, prompt}` plus optional
  `output`/`quality`; shared `--reference` images are the default cast for items without
  their own `references` (uploaded once for the fleet); shared `--prompt` likewise. Every
  item needs a prompt (its own or the shared one) that maps its cast as above. One
  `--resolution` applies to the whole batch (a per-item `resolution` is refused, since it
  is the price tier). Split a long source into ≤30s segments and send them as one batch.
  Name batch files workspace-relative (`jobs/<id>/…`) or absolute so the host can price
  them; an item may not write its output onto any clip or image the batch reads.
- **success_check:** the choreography, timing and camera carry over; identities and outfits
  hold across turns; no extra people; `chunk_review` the output like any generative step.

## `edit` — chunk 31 (prompt-driven video-to-video)
- **purpose:** transform an EXISTING clip by instruction: restyle (animation → real → lego),
  change the scene/environment, add/replace/remove objects — while the motion and timing
  carry over.
- **use_when:** you (or the tenant) already have footage whose motion is right and only the
  look must change; a reference-duplication beat where your clip needs the reference's style.
- **do_not_use_when:** the swap is an IDENTITY from a reference image (→ `genjutsu` — the edit
  engine takes prompt + video only, no image refs); there is no source clip yet (→ `insert` /
  `keyframe`); voice/audio must change (unsupported — edit the audio separately).
- **inputs:** `--video <mp4|mov|webm>` (exactly one) + `--prompt` (ONE simple instruction per
  call; the tool appends "Keep everything else the same." unless you scope it yourself).
  Iterate change-by-change rather than stacking instructions.
- **backend:** Gemini Omni Flash video edit (gateway-routed; raw mode needs FAL_KEY).
  Output comes back 720p and slightly re-timed (~1.3% observed) — the tool conforms
  it back onto the source clock automatically so it drops onto the timeline in sync.
- **⏱ latency:** several minutes is normal; see **⏱ Latency** below.
- **⏱ short inputs:** the engine garbles video inputs under ~3s (and still bills) —
  the tool refuses them with the pad recipe (cut a ≥3.3s window into adjacent
  footage, trim the output); `--allow-short` overrides.
- **BATCH (`--batch specs.json`)**: many edits/reenacts in one process, client-side
  parallel (default 4-way — the interactions engine blocks ~40-60s per submit, so
  the shared-poll rail doesn't apply). edit items `{name, video, prompt?}`; reenact
  items `{name, driver_video, swap_image?, prompt?}` with the swap image uploaded
  ONCE for the whole batch. Per-item failures don't kill the batch; losers are named
  for targeted retry. Live-shaped on the 17-clip danni-juhl fleet (~4.5 min wall
  vs ~15 serial). The same flag batches **insert** and **keyframe** (#273) — see
  "Batching generation" below.
- **cost:** metered per second of OUTPUT. The output tracks the SOURCE clip, and
  `--duration` is ignored for a local `--video` (reenact likewise follows the
  driver), so any optional quote must carry the source-derived output duration.
  Do not calculate or quote dollars locally; the gateway prices the exact
  operation, and the current host decides authorization at its boundary. The
  engine adds no separate financial prerequisite.
- **success_check:** the instructed change landed AND everything else genuinely held (grade,
  framing, motion, identity); `chunk_review` the output like any generative step.

## ⏱ Latency (edit, reenact, genjutsu)
- These three modes can take **several minutes** per clip. The gateway gives each run up to
  about 9 minutes, inside the app's 10-minute limit for a paid command, so a slow run ends on
  the gateway while the tool is still waiting.
- **Tell the user up front** that the clip may take a few minutes, before you start it.
- A run that passes the gateway's limit exits with a `timeout` (cancelled or settled on the
  gateway) plus a billing line.
- A clip still running or settling its bill 30s before the app's limit: the tool stops
  waiting and says **background recovery owns its result**. Nothing was cancelled or
  repeated, and the clip may still arrive.
- Report either plainly. Never resubmit automatically; a replacement is a new paid run the
  user decides on.

---

## Batching generation (`--mode insert|keyframe --batch specs.json`)

A wave of clips is ONE call. Several foreground `mint_video` calls in one message
run one after another (seven Seedance clips took ~17.5 min instead of ~3), so put
the wave in a JSON list instead:

```json
[{"name": "s1_hook", "prompt": "…[Image1]…", "reference": ["images/s1.png"], "duration": 5},
 {"name": "s2_turn", "prompt": "…[Image1]…", "reference": ["images/s2.png"], "duration": 7}]
```

- **Items** — insert `{name, prompt?, reference?, duration?}`; keyframe `{name, prompt?,
  first_frame?, last_frame?, duration?}`. Both also take `output`, `quality`,
  `resolution`, `aspect_ratio`, `audio`, `seed`. The CLI flags (`--prompt`,
  `--first-frame`, `--reference`, `--duration`, …) are the defaults; item values
  override them. Paths are job-relative, as on the CLI.
- **Validated before any spend** — an unknown field, a bad name, a duplicate name
  in the batch, or a name that already exists in the job fails only that item.
- **Runs together** — items are submitted as the account's paid capacity allows
  and polled together. A still shared by many items uploads once.
- **Failures** — each ✗ line says whether that item was charged. Retry only the
  items marked "safe to retry"; an accepted item is kept by recovery, and an item
  whose name an earlier paid request still delivers must not be re-run.
- **Prove one shot first**, then batch the rest.

---

## NOT mint_video
- `seedance.py` → **`perform_avatar`**: the avatar-chunk engine of idea-to-avatar (job-driven, renders talking-head chunks from job config). Not a general video primitive.
- **Using real external footage** as a proof/receipt is **`pull_video`** (pull + cut + crop), then placed by `compose_render` — not a generate mode. (This is why there is no `reframe` mode.)
- **Subject-locked reframing** is `sam3 reframe`, not a generation mode.
- **Clip extension** has no canonical `mint_video` mode.
