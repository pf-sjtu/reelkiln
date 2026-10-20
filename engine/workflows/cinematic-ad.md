# cinematic-ad — a multi-scene cinematic product/brand commercial from i2v

A forward, **generative** recipe for a cinematic ad: a short narrative spot (a product, a
brand, an idea) told across a few locked locations and characters, built by generating a
**bank of locked still assets**, writing a **director's shotlist** off one shared style
prefix, animating each beat with **image-to-video** (`mint_video`), then cutting the keeper
seconds to a **music track**. The look is cinema, not a clip.

> **The whole trick (read this first).** *Iteration is the skill.* The finished ad is the
> best few seconds out of many tries, cut together. So you don't brute-force scenes — you
> **lock cheap stills first** (characters, locations, props, product), then spend the
> expensive video credits only on assets you've already proven. One **style prefix** glued
> to every prompt → change the look once, it changes everywhere. And **the story has to
> track**: an ad is not a montage — every beat must follow causally from the last, or the
> payoff doesn't land (§"Story first").

This is an L2 workflow on the canonical tools — no new tools. Behind `mint_video` the
defaults are **Seedance 2.0** (i2v inserts); human scenes use **Gemini Omni
image-to-video** through the app's `call_model`
(`mint_video --mode multishot` is unavailable, videoclaw#317); reenact requires the gateway and has no provider fallback. Behind
`mint_image` defaults to **Nano Banana 2 via the gateway**; GPT Image 2 remains an explicit A/B/rollback rail.

All tools run from repo root `/Users/chin/projects/videoclaw` as
`uv run python tools/<tool>.py` and take **`--job <id>` explicitly**.

Shared skills referenced (never repeated here):
`skills/seedance_prompting_guide.md` (per-engine prompt mechanics) ·
`skills/evaluation.md` (per-asset eval, including the story-coherence lens) ·
`CANONICAL_TOOLS.md` (`mint_image` roles, `mint_video` modes, `score_bed`).

---

## ⚠️ Read this as PRINCIPLES, not a script to copy

Everything below is illustrated with the commands, prompts, and story from **one** spot — a
comedic product-demo spot for a pair of over-ear headphones. **Do not transplant them.** The
headphones, the curly-haired hero, the gray background, the "World Off" narrative are *instances*;
the transferable skill is the
**decision behind each move** — *why* a product gets a multi-angle sheet, *why* locations are
shot 3/4, *why* human scenes route to Omni image-to-video, *why* a payoff needs a setup beat, *why* the
click is grounded in the bedroom. For YOUR video, re-derive every choice from YOUR subject and
YOUR story; keep the reasoning, discard the specifics. **Litmus test:** if you can't state
*why* a step exists, you're copying, not directing — and it will show. The example is a
worked proof that the method holds, not a template to fill in.

> **Validated twice, to opposite effect** — proof these are stages, not a script: the same
> five stages produced (1) a *comedic product-demo spot* (a pair of over-ear headphones,
> "World Off" — bright, jokey, a transformation gag) and (2) an *emotional neon-noir brand
> film* (a phone, "Still Alive" — neon-noir, a lone traveler's anxious night). Different
> subject, tone, arc, palette, pacing; identical method. If your video looks like either of
> these, you copied the instance instead of running the method.

---

## How to run it: autonomous by default, collaborative on request

Do not ask the user to choose a mode before Stage 1:

- **Autonomous (default).** Generate candidates where useful, then select the strongest
  mechanically and creatively grounded keeper per beat by inspecting each against its
  shotlist intent. Apply the same rule to ambiguous asset locks (hero face, hero location),
  and surface the finished cut. Pause only when a material input genuinely cannot be
  resolved from the brief, reference, or tenant pack.
- **Collaborative (explicit opt-in).** When the user asks to co-direct or select options,
  show **1–3 candidate clips** at the requested beats and wait for their keeper choice.

Either way, finish as in Stage 5 and flag any compressed scope. Explicit user
choices override the autonomous default.

---

## Input — what you start from
- **The subject** — a product image (one is enough; the sheet step multiplies the angles)
  OR a concept/brand. `[GENERIC]`
- **The brand pack** — `taste/packs/<tenant>/README.md`; ground every look + the QA's brand
  checks against it. `[BRAND]`
- **A music track** — the spot is cut to it; the **through-line music is added in POST**
  (see Audio model below). Retrieval-first: check the tenant's own media before sourcing
  (`tools/index_media.py search "<describe it>" --tenant <tenant>` — `--tenant` is required). `[GENERIC]`
- **The script + the beat-by-beat arc** — one clear idea, and an explicit ordered list of
  beats with the causal links spelled out. This arc is what the story-coherence QA checks
  against, so write it down before you generate anything.

### Audio model (this matters — two layers, two homes)
- **Diegetic / ambient SFX → baked into the clip.** Footsteps, a coffee pour gurgling,
  street crowd, a stadium's air — local to the shot, no cross-clip continuity needed. So
  **generate clips with native audio ON** (`mint_video --audio`). Keep it.
- **The through-line music track → POST only.** The song that runs the whole ad cannot be
  baked per-clip (no clip knows the global state, and per-clip music would clash on the cut).
  The user adds it in post; you lay it in Stage 4. **Never ship silent, and never
  naively concat clips expecting their audio to form a track — keep the diegetic SFX, add the
  music over the top.**
- **DIALOGUE / VO → POST only; never let generated speech ship.** Generated clip audio can
  *hallucinates words* — gibberish vocals, or worse, **coherent-but-wrong dialogue** that
  changes the story (on the neon-noir brand film, a call clip generated *"He's coming, I have to
  leave now,"* which the story pass correctly read as injecting a stalker threat into a battery
  ad). Intended lines
  go in as VO in post — and can be **lip-synced** onto the talking clip via `lipsync_footage`
  (fal sync-3) so the mouth matches. Removing the bad audio, best → blunt:
  1. **Stem-split (surgical, preferred).** A lot of the generated *ambient* SFX is good — keep
     it. Split the clip audio into a **speech stem** and an **ambient/SFX stem** with a
     vocal/speech separator (the MDX23 stem model is pinned in `score_bed.py`, not yet
     CLI-wired — wire it), keep the ambient, drop only the 1–2 bad speech bits.
  2. **Mute the clip** if you can isolate which beats have speech.
  3. **Strip the whole cut** as the fallback when you can't audition.
- **Keep BOTH the with-audio and stripped versions** as edit sources (e.g. `final_v3` with
  audio + `final_v4` muted) — don't strip-and-discard; the editor picks ambient per beat.

---

## Story first — the arc must track

An ad fails when it's mechanically clean but the story doesn't make sense. **The generalisable
shape of a "problem → product solves it" spot:** *establish the ordinary world → show the
problem concretely → the product solves it in one decisive action → live in the solution →
a conflict → a turn that proves the product's power → the payoff.* Write your arc as an
explicit causal chain (each beat *causes* the next) and protect it through every stage.

The validated arc for the worked example (the comedic "World Off" headphones spot) — a worked
instance of that shape, NOT a template — ran 10 beats. The annotation in *italics* is the transferable function:

0. **Wake** — he wakes in bed, morning. *Ordinary world / before-state.*
1. **The problem, shown** — a neighbour mowing a loud lawn. *Show the pain, don't narrate it.*
2. **The product solves it** — tight FRONT close-up of the noise-cancel **CLICK** → silence,
   **shot in the bedroom** (same space as the problem). *The promise, as one decisive action.*
3. **Kitchen groove** ──click──▶ 4. **Stadium run** ──click──▶ 5. **Street dance.** *Life in
   the solution; the CLICK recurs as the match-cut between vignettes.*
6. **Office confrontation** — furious boss, he's oblivious. *Conflict; the world pushes back.*
7. **The handoff (THE PIVOT)** — he takes his **own** headphones off and puts them **on the
   boss**; face: shock → bliss. *The turn that proves the product's power; motivates the payoff.*
8. **Bridge** — the boss walks out to the street. *Connective tissue so beat 9 isn't a teleport.*
9. **Payoff** — the transformed boss dances by the air-dancer. *Lands only because 7 set it up.*

Three lessons this arc cost us (each generalises):

- **Never drop the causal beat that motivates the payoff.** The first build skipped 2 and 7
  and jumped 6→9 — the QA story pass called it a "narrative black hole" (boss dancing with no
  cause). The PIVOT is the heart; if your payoff shows a *result*, an earlier beat must show
  its *cause*.
- **Establish the premise before you pay it off, and ground it in-scene.** Opening
  mid-premise feels abrupt. Show the before-state and the problem *concretely*, then solve it
  with one action **in the same physical space as the problem** (the click in the bedroom, not
  on a neutral studio void) — the story pass flags the immersion break otherwise.
- **A signature action reused as a match-cut becomes a motif.** Shoot one tight, repeatable
  beat (the front CLICK) and reuse a ~0.7s slice at scene boundaries: it paces the montage AND
  keeps the product present. Match-cutting on the same action (tap, click, a turning head) is
  also how you make separate beats feel like one continuous story instead of a slideshow.
- **Build tension — and withhold the payoff. (The biggest lever, and our most common miss.)**
  Tension is what *forces* the watch: a viewer stays to the end only to see a question
  answered. So **keep raising the stakes** (escalating, concrete signs of the problem — the
  9% → the dimming → the urgent call, each worse than the last) and **hold the release as LATE
  as you can.** The payoff (the relief, the transformation, the reveal) lands once, at the
  end. Both validated spots **under-built this and released too early** — the boss's
  transformation and the traveler's relief both arrived with runway to spare, bleeding the
  pressure out before the finish. **Rule of thumb: if you're unsure whether to release the
  tension now or hold it, HOLD it.** When you trim, cut the slack *before* the climax, never
  the build. Early release is the most common story miss, so build the hold in.

---

## Stage 1 — Build & LOCK the asset bank  (`mint_image`)

Make every recurring thing a locked still before you animate anything. Generate cheap, test,
lock the winner, reuse it as a `--reference` everywhere downstream.

> **The character moves here are molecules — reuse, don't re-derive:** `build-character-sheet`,
> `image-from-character-sheet`, `wardrobe-swap-identity` (the state-sheets / outfit-swap trick),
> `identity-image-to-video`. See [`skills/molecules.md`](../skills/molecules.md) §Character / identity.

**Worked instance** (illustration of the moves — generalise the *roles* and *reasoning*, not
these prompts):
```bash
J="replace-with-the-same-canonical-bare-id"

# product: one base shot → a multi-angle sheet (referencing the base)
mint_image --job $J --role card --name product_base --aspect 3:2 \
  --prompt "premium matte-black over-ear headphones, seamless white studio bg, soft commercial light, no text"
mint_image --job $J --role card --name product_sheet --aspect 3:2 --reference images/product_base.png \
  --prompt "product sheet: front + 3/4 views of the headphones on white"

# hero: TWO candidates, gray bg, closeup + full-body panels
mint_image --job $J --role portrait --name hero_sheet --aspect 3:2 --variants 2 \
  --prompt "young man ~28, expressive face, short dark curly hair, athletic build, GRAY studio bg,
            TWO panels: left head-and-shoulders CLOSEUP, right FULL BODY, plain black tee+pants, even soft light"

# side cast + locations (3/4 angle) + props — one clean sheet each
mint_image --job $J --role portrait    --name boss_sheet  --aspect 3:2 --prompt "furious office boss, 50s, pot belly, suit, two panels gray bg"
mint_image --job $J --role seed_frame  --name loc_kitchen --aspect 3:2 --prompt "modern apartment kitchen, 3/4 angle, bright clean daylight, gas stove left, door right, no people"
mint_image --job $J --role card        --name prop_skydancer --aspect 3:2 --prompt "tall red+yellow inflatable wacky-waving tube man, white bg"

# outfits ride on the LOCKED hero sheet so the FACE carries
mint_image --job $J --role portrait --name hero_casual   --aspect 3:2 --reference images/hero_sheet_v1.png \
  --prompt "same man, same face, salmon-pink open shirt over white tee, blue jeans, white sneakers, gray bg, closeup + full body"
```

**Insights baked in (transcript + this run, all validated):**
- **Gray background = higher win-rate** (zero clutter competing with the subject).
- **3/4-angle locations beat head-on** — depth for the camera to hold when it moves.
- **Test multiple, lock one.** A face great as a still can fall apart in motion; keep 2
  hero/location candidates, decide with footage, lock the strongest passing winner, and reuse
  only that. *(In explicitly requested collaborative mode, this is a user pick.)*
- **Erase the second face** on the full-body panel (re-`mint_image` with `--reference`): one
  face for i2v to lock onto → less identity drift.
- **Face carries via `--reference`** to the locked sheet — verified: pink-shirt and
  blue-athletic versions stayed the same man.
- **State sheets (wet/dry).** A mid-scene state change (dry → sweaty post-run) = a SECOND
  reference, not words. Images are cheap; regenerated video isn't.
- **Quality-preserve mask trick.** Each edit softens skin toward plastic; for hero
  close-ups, composite the edited outfit back onto the original high-detail shot.
- **Aspect reality:** use the canonical cross-rail ratios; sheets remain **3:2**, while native 16:9 and 9:16 are available when the composition needs them.

**EVAL:** eyeball every locked still against the brand pack before it becomes a reference — a
bad lock poisons every scene that cites it.

---

## Stage 2 — The shotlist: one style prefix, named CUT prompts (the director)

Never write scene prompts ad hoc. Produce **one connected document** (`jobs/<id>/shotlist.md`):
a global **Style Prefix** + a numbered prompt per beat citing the locked assets. Change the
prefix once → the whole film's look moves; name each prompt so you can revise one in
isolation.

**Prompt LAW — write every prompt in this exact order:**
```
[STYLE PREFIX — verbatim, every prompt]
Characters: <only those in THIS shot; anchor them + carry forward state — wet hair,
            wardrobe, the headphones still on>
Scene:      <1–2 sentences, GEO-SPATIAL: where each character sits vs the location and each
            other — "hero enters frame-left; the air-dancer stands 6ft to his right">
CUT 1 — <shot type, lens feel, camera movement>: <acting beat, gesture, eye-line, what the
            light does, diegetic sound>
CUT 2 — …
```
- **Style Prefix** locks the global look so each prompt works standalone. Example used here:
  *"Cinematic high-end commercial, bright soft even daylight, clean polished grade, gentle
  moving camera, shallow DoF, 16:9; hero wears matte-black over-ear headphones throughout and
  moves with relaxed musical energy, unbothered by the world."*
- **Continuity lives in the language, not a visible block** — carry state forward as concrete
  words inside Characters/CUT lines.
- **Acting is show-don't-tell.** Not "he dances" — *"two head nods, a shoulder roll one at a
  time, a knee dip, a finger snap, landing on a smirk."* **Choreograph move-by-move**, or i2v
  gives generic flailing. (The single most-repeated lesson.)
- **Camera is motivated** — specify lens/height/movement and *why*.
- **Match-cut on action.** End a scene and open the next on the *same* gesture/pose (the ear
  tap), same hand, so the stitch is invisible. (This is also how you make the confront →
  handoff → payoff run read as one continuous story instead of three clips.)
- **Reference citation:** Seedance insert cites `[Image1]…` — upload order = citation order. The client validates that
  every ordinary reference is cited before spend.

---

## Stage 3 — Generate the scenes  (`mint_video`)

Run each prompt, judge it, fix it, pull the keeper seconds. The first try usually misses —
that's the format. Self-select against the shotlist by default. When the user explicitly requested
collaboration, generate 1–3 candidates at the requested beats and let them choose.

**Engine choice — the load-bearing gotcha (this cost the most time):**
- **Human scenes → Omni image-to-video from ONE seed frame.** Seedance i2v (`--mode insert`,
  `reference_images`) **E005-rejects photoreal human face references** — every hero/boss
  insert fails "flagged as sensitive," deterministically (location/product-only inserts pass
  fine). `mint_video --mode multishot` is unavailable (videoclaw#317). Compose the human(s),
  location and props INTO a single seed-frame via `mint_image`, then animate it with the app's
  `search_models` + `call_model` (model_slug `google-gemini-omni-flash-image-to-video`, one
  `image_url`, 3–10 s, 16:9 or 9:16). See memory `seedance-flags-human-refs`.
  ```json
  {"prompt": "... the man dances through the office door — two head nods, a shoulder roll, a finger snap; behind him the furious boss scowls, arms crossed; camera follows him in; bright office daylight ...", "image_url": "images/scene4_seed.png", "duration": 5, "aspect_ratio": "16:9"}
  ```
  (Whether Seedance `insert` tolerates a composed-human first frame is **untested** — use Omni.)
- **No-human beats** (a product push-in, an empty room) → `--mode insert` (Seedance), cheap.
- **Keep shot prompts tight.** Front-load the action; trim adjectives before
  you trim blocking or continuity anchors.

Iteration tactics (transcript):
- **Change one variable at a time** — same prompt, swap only the hero OR only the location.
- **Layout-map / schematic trick.** When the model loses geography (a prop drifts in size and
  position take-to-take), `mint_image` a top-down **schematic** marking where things sit and
  how big, and cite it as a reference. Pins location far better than 20 brute-force gens.
- **Anchor a drifting character** to a fixed object in the prompt ("under the tree,
  frame-left").
- **Hard single-object actions → compose a seed-frame, don't prompt it.** Handing ONE
  object between two people, or removing-and-transferring it, makes i2v **duplicate** the
  object (it keeps the headphones on the hero's head AND spawns a second pair on the boss —
  this happened on 3 separate prompt attempts). Fix that worked: `mint_image` a **seed-frame
  locking the correct mid-action state** (headphones in his hands, his own head bare,
  extended toward the boss), then animate FROM it (Omni image-to-video via `call_model`,
  `image_url` = the seed). The motion can only *continue* the placement, so it reads as one
  pair. This is the go-to for any precise physical interaction.
- **Location jumps need a bridge beat.** Cutting interior→exterior (office → street) reads as
  the character *teleporting* — QA layer D flags it every time. Add a 2–3s "character exits A
  / arrives B" shot (boss pushes out the glass door onto the street). It fully resolved the
  jump here.
- **Show the causal micro-action on screen.** If a beat hinges on a small action (the ear
  tap, *taking the headphones off his own head*), SHOW it — don't cut around it. If you cut
  from "wearing them" to "placing them," the story pass (and a sharp viewer) assumes he kept
  his and conjured a second pair. The fix is an insert of the action itself.
- **Pull keeper seconds, not whole clips.**
- **Diegetic audio is mode-specific.** Seedance uses `--audio`; `--no-audio` strips a
  returned track after download.

**EVAL:** inspect each scene against its shotlist intent before using it.

---

## Stage 4 — Editorial cut + audio  (`score_bed` / `compose_render` / ffmpeg)

- **Keep the clips' diegetic SFX.** Concat keeper seconds in story order. Convenience
  path: author `edl.json` (one beat per keeper span, `"audio": {"from_beats": true}`)
  → `tools/assemble.py --check` → render — it normalizes codecs (no DTS warnings) and
  declares the timeline (planned cuts on record). Hand ffmpeg is equally fine — **just declare what you
  built afterwards** (`assemble.py --declare`,
  [`skills/primitives/assemble.md`](../skills/primitives/assemble.md)):
  ```bash
  printf "file '%s'\n" clips/scene1.mp4 clips/scene2.mp4 ... > list.txt
  ffmpeg -f concat -safe 0 -i list.txt -c copy final_visual.mp4
  ```
- **Lay the through-line music in post** (user-supplied track), **shaped to the headphones
  state** — full when the phones go on (his bubble), pulled back / muffled when they're off
  (world rushes in). This story-driven level change is the whole sonic concept; it follows
  the headphones, never a voice, and it's post, not per-clip. Keep diegetic SFX under the
  music.
- **Pace with the edit, not just the generator.** Trim each beat to its *working* length (a
  5s clip often has only 3 good seconds — cut to those), and reuse a short ~0.7s slice of the
  motif (the click) as the match-cut between scenes. Pre-cut each segment re-encoded to
  identical params (`1280x720 / 24fps / yuv420p / aac 44100`), then concat — clean joins, no
  DTS warnings. This trimming is where a "use-case montage" becomes a paced spot.
- Optional packshot/endcard if the brand wants one. Output: `jobs/<id>/final.mp4`.

---

## Stage 5 — Finish

The rendered `final.mp4` is a complete draft: show it and return to the user
([Finishing a render](README.md#finishing-a-render)). Story coherence is an
editorial matter: every payoff needs its setup on screen, and a missing one deserves
an explanation, not an invented mechanical gate.

---

## Worked example — the journey, so you skip the detours
The comedic product-demo spot — `final.mp4` is a **44s "World Off" spot** (v6, after a
collaborative iteration loop). What went right first try: the asset bank locked cleanly, faces
carried across outfits, and the multishot rail held two humans in one shot. The detours we paid for — each is a
lesson already folded into the stages above:
- **Seedance `insert` E005-rejected the human references** → pivoted to Gemini `multishot` (now unavailable, videoclaw#317; use Omni image-to-video).
- **The first story cut skipped the premise + the handoff** → "narrative black hole" (boss
  dancing with no cause) → fixed via §"Story first" + QA layer D.
- **The handoff kept *duplicating* the headphones** (his pair stayed on, a second appeared)
  until animated from a `mint_image` seed-frame of them already in his hands.
- **Office→street teleported** until a bridge beat (boss exits) was added.
- **The opening click sat on a gray studio void** → broke immersion → re-grounded in the
  bedroom (composed off a frame of the wake-up room for continuity).
- **Audio:** v1 wrongly shipped silent; settled on the two-layer model (diegetic baked,
  music in post).
- **`review_output --mode full` hung** on the no-role-log path; QA ran via open-critic +
  frame-verify + the story pass.

## Known limits / TODO
- **Single-object transfer between two people is a hard i2v action** even with a seed-frame:
  the seeded *placement* reads cleanly, but a fully continuous remove-then-transfer in ONE
  take is unreliable. Best result = seed-anchored placement + (optionally) a short insert of
  the removal. Don't expect one prompt to nail the whole gesture.
- **No automated 100-try iteration** — agentic single pass does 2–3 variants per beat
  (cap: 3, matching the `--variants 3` pick rung in `skills/art_styles.md`) and flags where
  it compressed. Auto-rank-N-keep-best is the next build.
- **`review_output` degraded-path hang** — wants a fix so the structured audit runs without a
  role-log.
- **Music generation** — bed is user-supplied (repo owns no music); generate-to-beat + the
  headphones-state level automation would close the loop end-to-end.
