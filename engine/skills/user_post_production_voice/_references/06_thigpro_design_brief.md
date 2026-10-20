# Design Brief — ThigPro · "L.E.A.D.E.R, not labeller"

Compact brief — full intent lives in vision.md + script.json:post_production_notes. This wraps the locked-in production decisions before authoring `overlays.tsx`.

## 0. Aesthetic register (user-directed)

- **Hand-drawn vibe** — Caveat handwriting + EB Garamond serif. Sepia-on-cream palette. No sans-serif graphic-design polish.
- **Crumpled cream paper** as base texture for all overlay backgrounds (`images/crumpled_paper_base.png`).
- **Gate weave** — subtle film-projector jitter (~0.5px amplitude on x/y, ~0.05° rotation, ~2-3Hz) applied to the overlay layer as a whole. Makes the "drawings" feel like real footage of a hand-held notebook, not graphic design.
- **Minimalist** — single sepia ink color, no decorative flourishes, no shadowing.
- **Icons wiggle** — 2-frame "boil" animation on L.E.A.D.E.R icons (±1.5° rotation, ±1.5% scale, ~6Hz natural rhythm).

## 1. Palette + Type

| Token | Value |
|---|---|
| `paper_cream` | `#F5EDD8` |
| `sepia_ink` | `#5C3A21` |
| `terracotta` | `#C97B5C` |
| `forest_deep` | `#2C4A3E` |
| `sage_rule` | `#B5C5A5` |
| Body serif | EB Garamond / Crimson Text |
| Handwriting | Caveat |

## 2. Per-beat overlay manifest

| # | Time | Beat | Implementation |
|---|---|---|---|
| H | 0:00 → ~0:06 (word "5am") | Hook | `hook_journal_page.png` full-frame + TikTok pill drops in at ~0:02 with "INSTANT PEACE BUT YOU'LL HAVE TO STOP DOING ONE THING" |
| C1 | chunk 1 mid → end | Credibility chip | Lower-third cream pill: *"Former LCSW · Hundreds of founders coached"* — fades in on word "founders" |
| N1 | chunks 2 → 3B (~0:14 → ~0:46) | Notebook Page 1 | Crumpled paper fullscreen. Handwritten reveals: `Moment →` arrow → stick `you feel off` → arrow → `you LABEL it` → 3 quoted labels (in time with character voice): `I'M INCONSISTENT.` · `I'M NOT ENOUGH.` · `I'M OVERWHELMED.` → arrow → big circled `IDENTITY`. Then doom-loop stair-step: `LABEL → REHEARSE → BELIEVE → BECOME` with terracotta circle around `REPEAT` on AHA. |
| C2 | chunk 4 (~0:46 → ~0:51) | ACT citation | Lower-third cream chip: *"Acceptance & Commitment Therapy · Dr. Steven C. Hayes · 1999"* — anchored to word "fusion" |
| N2 | chunk 5 → mid-chunk 6 (~0:59 → ~1:14) | Notebook Page 2 — L.E.A.D.E.R | Crumpled paper fullscreen. Vertical acronym, each row revealing as spoken: **L**ocate / **E**xhale / **A**ccept / **D**etach / **E**dge / **R**epeat. Wiggling sepia line-art icon per row. |
| K | mid-chunk 6 (~1:17 on word "leader") | LEADER kinetic reveal | Notebook clears. Full-screen "LEADER" in massive serif terracotta-on-cream, scale-up + soft impact frame, holds ~0.8s, dissolves back to avatar |
| CC | chunk 7 (~1:25 on "this coach") | Coach card | Cream card with terracotta border slides in from below: `ThigPro` (serif) + `Balance & Relationship Advisory` (small) + `thigpro.com` (URL chip). Brand-only treatment (no founder headshot supplied). |

## 3. Asset manifest

- ✅ `images/hook_journal_page.png` — locked
- ✅ `images/crumpled_paper_base.png` — paper texture
- ✅ `images/icon_locate_compass.png` — Locate
- ✅ `images/icon_exhale_breath.png` — Exhale
- ✅ `images/icon_accept_palm.png` — Accept
- ✅ `images/icon_detach_knot.png` — Detach (untied rope ends)
- ✅ `images/icon_edge_footstep.png` — Edge
- ✅ `images/icon_repeat_arrow.png` — Repeat (circular)

All icons rendered on white background — Remotion uses `mix-blend-mode: multiply` to drop white at composite time (sepia ink stays visible over cream paper).

## 4. SFX (user owns sourcing — TBD)

Not blocking the render. Default to dry voice. If SFX desired in a later pass:
- `pen_scratch_underline` × ~8 (on each label, each acronym letter, each circled word)
- `paper_page_turn` × 2 (between flowchart and L.E.A.D.E.R page)
- `soft_impact_pop` × 1 (LEADER kinetic reveal)
- `subtle_chime_card` × 1 (coach card slide-in)
- `tiktok_pill_click` × 1 (hook pill drop)

No music bed (vision.md dry-audio register).

## 5. What we explicitly skip

- No second avatar variant (front works for all 8 chunks)
- No music bed
- No B-roll inserts
- No on-screen captions during full-frame notebook overlays (the overlay IS the visual layer)
- No founder headshot (not supplied)
