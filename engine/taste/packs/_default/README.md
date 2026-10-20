# Taste pack — _default (the library's smart defaults)

The pack consulted LAST. Resolution is always **tenant pack > user taste
(`taste/GLOBAL.md`) > THIS pack** — same schema as a tenant pack, so it's one code path,
not a special case. Nothing here is a commitment; it's the opinionated pick for when
nobody chose.

**The naming rule (load-bearing):** every default you use gets NAMED in the deliverable
summary — *"no caption preference on file → used `tiktok` (sentence-case); say the word
and I'll lock yours."* A default used silently is a bug; a default named is the top of
the taste-capture funnel.

## The variation policy (anti-predictability)

"Default" must never mean "identical output every time." Where this pack gives a
ROTATION SET, pick deterministically by job — e.g. `hash(job_id) % len(set)` — stable
within a job, varied across jobs. Never just take the first item every time; that is the
"defaults too predictably" failure this pack exists to kill.

## Captions

Captions stay **opt-in by named preset** (the no-silent-preset law survives). When the
user asks for captions and no user/tenant preference exists, pick by register — this
table IS the default, and say which you picked:

| Register | Preset (`remotion/src/caption_presets.json`) |
|---|---|
| punchy short-form (default when unstated) | `tiktok` — sentence-case, never ALL-CAPS |
| clean / B2B / SaaS | `clean` (dark ink on light brand bg — saas-demo craft) |
| technical / dev | `mono` |
| editorial / literary | `editorial` |
| emphasis-forward / listicle | `highlighter` |

Break unit: `sentence` for slow registers, word-pop only when the register is punchy
AND the tenant look supports it. Legibility: thin dark outline over busy/bright
backgrounds (the shadow-only look goes faint — proven defect class).

## Art style (faceless / artistic b-roll, no register stated)

Rotation set by mood — pin ONE per video with its `_ref/` exemplar (`skills/art_styles.md`):
- contemplative / philosophical → rotate `{fine_art_philosophical, vintage_print, editorial_line}`
- tension / noir → `duotone_neo_noir`
- casual / photoreal → `iphone_warm`
- bookish / literary → `intaglio_engraving`

## Framing, grade, motion

- **Framing:** classify content before choosing geometry. Natural camera footage
  ordinarily fills the destination frame; keep the primary subject steadily centered,
  preserve already-correct footage unchanged, and do not add a floating card, blur,
  or decorative padding merely to preserve background. A deliberate punch stays
  centered on the same locked subject. Screen recordings preserve readable interface
  content regardless of their source aspect: if controls, labels, cursors, or the
  demonstrated region approach frame edges or platform red zones, uniformly inset the
  screen inside a geometrically centered card with restrained gradient, solid, or
  brand-derived padding. Do not double-pad a screen that already has breathing room,
  and keep card geometry stable through a continuous screen section. Never stretch
  footage, clip or obscure a required person, or place captions over a face.
  Name any deliberate off-center composition in the delivery note so it reads as
  intent, not a missed crop. Reach for split-screen only when a
  card/insert beat benefits from keeping the face visible (the split geometry is a
  tenant choice, never assumed).
- **Grade:** none on untouched real footage; `warm_face` immediately after any lipsync
  (sync-3 washes cold); `warm_light` on generated b-roll (already warm — don't double).
- **Motion on stills:** `assemble.py` `motion: "auto"` (the rotating Ken-Burns variety
  pack). A dead-still frame only as deliberate ~1s punctuation (freeze-hold idiom).
- **Cuts:** hard cuts are the house grammar; b-roll changes every 1–3s; jitter beat
  durations (never uniform).

## Audio

- **VO:** real recording whenever one exists (`skills/craft_laws.md` ladder). Synthetic →
  the register table in `skills/voice.md`; densify to the register's WPM band.
- **Music/bed:** OPT-IN, user-supplied or found (never auto-generate SFX). During
  speech, the bed supports the voice and never competes with it: one steady level about
  12 dB under the voice (skits and recreations about 15 dB), no ducking, swells, or
  cutting it under the lines, so every word is effortless to understand on ordinary
  phone and laptop speakers. A numeric
  level, LUFS target, or claimed dB gap never overrides what a listener hears. If music
  competes with dialogue, lower or remove the bed. Loudnorm −14 LUFS master.
- **Duration:** 30–60s unless the shape dictates otherwise (workflow docs carry per-shape
  bands).

## Hooks & structure

- Hook patterns — rotation set: {open question, bold claim, visual cold-open}. Never the
  same pattern twice in a row for the same tenant (check their recent jobs).
- Build tension, hold the payoff late; when unsure whether to release, HOLD
  (`skills/craft_laws.md` / workflow story sections).
- End: no endcard unless a CTA was requested; if one lands, anchor it after
  `lastWord.end + 0.25` with a frozen-tail pad (never over speech).
