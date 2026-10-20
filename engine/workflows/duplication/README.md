# workflows/duplication/ — bespoke, shipped duplication recipes (one per reference)

This subdir is the home for **per-video duplication recipes that shipped end-to-end**.
Each file is a *results-first, bespoke instance* of the generic
[`trend-duplication`](../trend-duplication.md) method — pinned to ONE reference video and
ONE performer, encoding exactly how that specific duplicate was produced at quality. They
exist by the **provenance rule** (`README` in `workflows/`): a request shape that ships
end-to-end earns its own recipe.

**Why nested, not a top-level workflow:** these are *instances*, not generic spines. They
are deliberately brand-specific (a named performer, exact hex/font values, exact prompts),
so they live one level down — the same relationship `collage-explainer/_ref/` has to
`collage-explainer.md`. The doctor's workflow count (`tools/doctor.py --library`,
`check_canon_counts`) globs `workflows/*.md` non-recursively, so files here **do not
change CLAUDE.md's "N forward workflows" count** and are exempt from the top-level `[GENERIC]`
brand-leak / cross-ref / flag lints (they are brand instances by design). Adding another
bespoke recipe = drop a `<slug>.md` here + a row in the trigger table below. No doctor
change, no CLAUDE.md count change.

## Trigger routing — select the matching recipe without a confirmation ceremony

When a session names a creator/method, pastes an Instagram URL, or *describes* a reference
we have already shipped, the agent should recognize and use the matching recipe rather
than silently start a generic duplication. The **trigger
table below is that router index**: scan a request against every row's aliases + URL
shortcode + description. Ask a clarification only when the match is genuinely ambiguous;
recipe selection itself is not a human-approval gate.

This is the pattern **every future bespoke recipe follows**: each `<slug>.md` carries its
own `Triggers / aliases` block (name · aliases · URL shortcode · confirmation line), and its
row here mirrors it. Keep the brand tokens (creator names, shortcodes, descriptions) **in
this subdir only** — it is exempt from the generic-leaks lint; the top-level routing
surfaces (`workflows/README.md`, `skills/molecules.md`) point here generically, brand-free.

| Recipe | Aliases | IG shortcode | Optional clarification line |
|---|---|---|---|
| [kumar](kumar.md) | "Kumar", "the Kumar method", "Kumar debut", "Indian accountant guy", "deadpan accountant / message-to-my-enemies skit"; or a description: turtleneck talking-head, red display words behind the head, a friend vouches at the end | `DZN5Njzo-Yh` (any `instagram.com` `/p/` or `/reel/` form) | **recreate** (not swap): generate the user into the fixed 16-shot skeleton with their own script angle; red Didone words behind the head; ends on a "`<NAME>`'S DEBUT" hero poster |

## Two production modes — swap or recreate

Duplication recipes come in two shapes; each recipe declares which it is:

- **Recreate** — generate the performer *into* the format from scratch (a fixed cut-map
  skeleton filled with the user's own script, voice, and generated shots). Best when the
  reference is heavily stylized or you want the user as the star. The first shipped recipe,
  **[kumar.md](kumar.md)**, is a recreate; see also
  [`trend-duplication.md`](../trend-duplication.md)'s generated front. Recreate recipes
  document their own pipeline end-to-end (kumar.md is self-contained).
- **Swap** — re-skin the reference's *own* footage with the performer swapped in by one
  `mint_video --mode genjutsu` run (every person swap, whatever the count). Best when the
  reference has clean, swappable base footage. The swap track is documented below.

### Swap track — re-skin the reference's own footage

0. **Clone-first preamble (say it before anything else)** — a swap is only as good as the
   identity refs behind it. **Open by telling the user this works best with a character
   clone of them**, then check the tenant's character sheet at
   **`assets/<tenant>/character_sheet/`** (`sheet_*.png` + `face_refs/real_face_*.png` — the
   `skills/molecules.md` Homes convention). Missing → direct them to the app's **Characters
   panel** / `tools/build_character_sheet.py` **FIRST** and stop; only proceed once identity
   refs exist. (Rail-agnostic: the sheet builder is migrating to a faster generation rail —
   point at the panel/tool, never a specific model.)
1. **Acquire** — `pull_video`; on Instagram the pull is **video-only**, side-load the
   soundtrack `.mp3` and preload it as the audio bed.
2. **Breakdown** — `breakdown_reference --transition-frames` (shots + cuts + contact sheet).
3. **Swap plan** — name each person on screen by position or clothing and ask who becomes
   whom. One person or several, the process is the same; only the prompt's mapping changes.
   Don't split at cuts or by person; a source longer than 30 s goes as ≤30 s segments in one
   `--batch`. Artwork that must survive goes in the prompt's FROM THE VIDEO list.
4. **Seed frame** — the clip's first frame with the performer swapped in:
   `mint_image --role seed_frame --aspect <the clip's aspect> --reference <first frame>
   --reference <performer refs>` (recommended and usually required; never a block).
5. **Swap** — `mint_video --mode genjutsu --video <clip> --reference <seed frame>
   --reference <performer refs> --prompt "<the seed-frame template in mint_video.md>"` at
   the 720p default. It keeps the clip's own audio and clock, so nothing is muted, overlaid
   or stitched; join batch segments in order.
6. **Finish** — the swapped video is a complete draft; show it
   ([Finishing a render](../README.md#finishing-a-render)). Ground any
   residual-creator claim in exact frames.
7. **Reference comparison** — when checking fidelity, build and read the actual
   beat-aligned ref-vs-ours evidence:
   (a) `look_at_video --job <job> <ref> <ours>` → per-beat stacked cards in one call (it
   detects both sides' cuts and beats itself; `render_timeline_strip --stack --ref … --ours …
   --ref-beats … --ours-beats … --ref-cuts … --ours-cuts …` when you need your own beat
   files); **plus** (b) a synced side-by-side
   video — ffmpeg `hstack` of ref and ours, scaled to a common height and trimmed to the
   same window (`-shortest`), audio = the ref bed — so a human can eyeball pixel-closeness
   the whole way through. **Pass criteria (all four):** beat alignment (every OURS beat on
   the ref's cut), artwork fidelity (baked display text/captions pixel-faithful), caption
   pacing (≤ ~0.5s drift), and the **0-confirmed-leaks** bar. Report any miss with its
   window so a user-requested revision can target it. Record findings in
   `summary.json` + `run_notes.md`; no automatic repair loop. The
   strips + side-by-side are job media — **never committed**. Calibrate against the OWNED
   exemplar in [`_ref/good_stitch_reel2_contact.png`](_ref/good_stitch_reel2_contact.png)
   (see [`_ref/NOTE.md`](_ref/NOTE.md)): clean window boundaries, consistent restyle across
   cuts, phrase-synced captions.

Hard-won quirks that live in the recipe as instructions (not trivia): the optional
voice-twist's ElevenLabs STS runs ~10 LU quiet → gain-match then `amix …:normalize=0`;
`synth_voice --mode transcribe` writes `<job>/transcript.json` unless `--output` names
another `.json` inside the job (give each parallel transcript its own file); lipsync via `sync-lipsync/v2` with `rest.fal.ai` storage upload (data URIs
422; latentsync truncates >3.2s); pass absolute `~/Videoclaw/jobs` paths to `pull_video`.

## Assets policy (this subdir ships in the engine tarball)

**No reference or performer media ships from here.** Reference media is third-party (re-acquired at use time);
performer refs / minted stills / swap outputs are tenant identity assets that, by
`skills/art_styles.md` ("tenant data never ships with the engine"), never get committed.
Private side-loaded audio is labeled **PRIVATE-ONLY** in the job and never committed. The
recipes themselves are text + source URLs + re-acquire/re-mint steps.

**The one thing that DOES ship is `_ref/`** — small OWNED, fully-AI-generated exemplar
frames (the "what a good stitch looks like" contact sheet), which contain no third-party
footage and no tenant identity (generic AI-gen performers). Nothing else. Before any commit,
`git status` must show **no media under `workflows/duplication/` except `_ref/`**, and `_ref/`
must hold only OWNED AI-gen stills (see [`_ref/NOTE.md`](_ref/NOTE.md)) — never a frame from a
reference video or a swap output. Private experiments on referenced creators' formats —
**make, don't publish.**

## Index / trigger table

The authoritative recipe index is the **[trigger table](#trigger-routing--surface-the-recipe-then-confirm-before-acting)**
near the top (name · aliases · IG shortcode · one line). Add a new bespoke recipe by
dropping a `<slug>.md` here (with its own `Triggers / aliases` block) and adding a row
there — plus, if it earns one, an OWNED exemplar under `_ref/`.
