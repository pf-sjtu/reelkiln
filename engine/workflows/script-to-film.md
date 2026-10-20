# Workflow — Script → Film (director's shotlist → 15s cinematic beats)

Turn a script / scene breakdown / treatment into a **numbered director's shotlist** of
15-second prompt blocks, then generate each block as one clip and assemble. This is
**cinema, not a clip** — the job is blocking, lighting, and pacing a film, not chopping
a script into beats.

_Imported 2026-07-09 from an external shotlist-director skill (scrubbed vendor-neutral);
the prompt grammar targets the cinematic i2v engine behind `mint_video --mode keyframe`
(15s max per generation — which is exactly why beats are 15s). Single-clip prompt law
lives in [`skills/seedance_prompting_guide.md`](../skills/seedance_prompting_guide.md);
this workflow is the MULTI-SCENE production system on top of it._

## The spine

1. **Read the script as a director, not a transcriber.** Find the dramatic shape —
   where the scene turns, lands, breathes.
2. **Identify continuity anchors** — who's in it, what they look like, what state they
   carry scene to scene.
3. **Block scenes** — number them; one beat or location per scene.
4. **Split each scene into 15-second prompts** (`3a, 3b, 3c` under one scene number).
   Pacing law: a 12s moment still gets a full 15s prompt (fill with the breath, the look,
   the held silence); a 40s confession = 3 prompts. **Pack dramatically, not efficiently.**
5. **Write each prompt** in the strict structure below.
6. **Generate**: one `mint_video --mode keyframe --duration 15` call per prompt
   (sample the riskiest beat first, then batch; quote only when cost information is requested).
7. **Assemble** on the scene order (`compose_render` / ffmpeg concat) → grade. Cut against
   the script: every beat reads in order and every payoff has its setup on screen.

## Prompt structure (the law — every prompt, top to bottom)

```
[STYLE PREFIX — the global block, verbatim]

Characters:
[Anchors — short, specific, vivid. Only who's in THIS prompt. Carry state forward:
 wet hair from scene 3's rain, blood on knuckles from scene 5, same scar, same wardrobe.]

Scene:
[1–2 sentences. What/where/when + GEO-SPATIAL blocking — where each character is
 relative to the location and each other. "Anna at the kitchen window, back to the room.
 Marco enters from the hallway, stops six feet behind her."]

CUT 1 — [shot type, lens feel, movement]:
[The beat: acting, gesture, eye-line, breath, micro-pause. What the camera does.
 What the light does. Diegetic sound if relevant.]
CUT 2 — [...]:
CUT 3 — [...]:
```

- **15 seconds is the target, not a ceiling to dodge under** — the engine renders a
  fixed-length clip; dead air at the end is wasted spend. 1–3 cuts per prompt usually;
  a held single shot is valid if the moment carries it.
- **English prompts only**, whatever language the script arrived in.

## The Style Prefix (cross-clip look-lock)

ONE global style block, written once, **prepended verbatim to every prompt** — this is
what keeps 20 independently-generated clips looking like one film. If the tenant has a
custom prefix, use it verbatim; otherwise the imported default (photoreal/IMAX,
natural-light contre-jour, 60:30:10 color, physical-lens motion blur, pore-level skin,
Hollywood micro-pause acting, physics respected, characters never static, environmental
SFX only) lives at the top of
[`skills/_references/shotlist_director_reference.md`](../skills/_references/shotlist_director_reference.md).

## Directing craft laws (what goes INSIDE the container)

- **Mise-en-scène:** block bodies in space. "She sits across from him at the diner
  booth, knees touching under the table" ≫ "they sit and talk." Geo-spatial detail is
  what makes the engine render coherent space.
- **Pacing:** confession scenes get air (split, long holds, silence between lines);
  action compresses (short cuts); a reveal lands on ONE sustained close-up — don't
  undercut it. A heavy line gets its own prompt.
- **Acting — specifics, never labels:** not "she looks sad" → "eyes drop to the table,
  jaw tightens, she swallows once before answering." Restraint by default; a whispered
  line beats a screamed one 90% of the time.
- **Camera — motivated, precise:** lens + height + movement + reason. "Low-angle 35mm
  dolly-in, slow push waist→chest as she realizes." The camera is a character.
- **Lighting:** the prefix locks the global look; each prompt still says where the
  window/sun/haze is — that's how the engine knows where the rim light goes.
- **Continuity is tracked in your head, never as a visible block** — it surfaces as
  concrete language in the Characters and CUT lines (state, wardrobe, emotional carry,
  location/time/weather).

## The shotlist artifact (the collaboration surface)

Deliver the shotlist as a **single self-contained editable HTML** (inline CSS/JS):
title bar, collapsible Style Prefix, numbered scenes each with a checkbox
(localStorage-persisted, keyed by scene number), per-prompt copy-ready code blocks
(prefix + characters + scene + cuts = one paste-able unit). One checkbox per scene even
when split into 3a/3b/3c. On revisions, **re-render the same file with stable scene
numbers** (checkbox state survives), never describe changes in chat. Save under the
job (`jobs/<id>/shotlist.html`). Full HTML skeleton:
[`skills/_references/shotlist_director_reference.md`](../skills/_references/shotlist_director_reference.md).

## Molecules used
`directors-shotlist` · `style-prefix-lock` · `continuity-carry` (skills/molecules.md)
+ the finishing craft and cost contract from CLAUDE.md as always.
