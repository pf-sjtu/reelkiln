# Taste pack — _starter (rename me to your first TENANT's handle)

This is the seed TENANT pack for a fresh Videoclaw workspace — it exists so your first
session has a valid tenant layer to read and a place to persist brand choices. The agent
will propose renaming it to your tenant handle (e.g. `taste/packs/<yourname>/`) during
your first video.

**Two scopes, two homes — don't mix them:**
- Choices about THIS brand/channel (fonts, grade, handle, card look) → land HERE.
- How YOU work across every tenant (routing preferences, collaboration style, standing
  rules) → land in [`taste/GLOBAL.md`](../../GLOBAL.md), the USER scope.
When neither has an answer, the agent uses [`_default/`](../_default/README.md) and
NAMES the default it picked — say the word and it gets locked here or in GLOBAL.md.

## How this pack fills in (you don't have to write it by hand)
The agent follows the capture protocol ([`taste/HOW_TASTE_WORKS.md`](../../HOW_TASTE_WORKS.md)):
explicit standing choices are written immediately; single observations accrue silently in
`observations.jsonl` here; a signal seen twice becomes a one-tap promotion proposal when
the video is delivered. Confirmed, standing choices go into `## COMMITMENTS` below, which is
re-injected into every future session verbatim.

## Style
- **Fonts:** _(none locked yet — the agent will propose from your first renders)_
- **Captions:** _(no preset locked — captions are opt-in by named preset)_
- **Grade / palette:** _(unlocked)_
- **Voice:** _(recommend: your real recorded VO — synthetic voices never match)_

## Assets
Put real footage/stills in `assets/<tenant>/` and the agent will index them
(`index_media sync`) and reach for YOUR media before generating anything.

## COMMITMENTS
Cross-session promises the agent MUST honor for THIS tenant. A line lands here only when
YOU have confirmed it; date each one; remove/supersede when revoked.

- _(none yet — they'll accumulate as you make videos)_

## ANTI-COMMITMENTS (declined proposals — do not re-raise)
- _(none yet)_
