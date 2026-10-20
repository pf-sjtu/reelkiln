# Design Brief — The Protocol School of Texas (Diane Gottsman)

> **Authored retroactively** (this job shipped before the design_brief checkpoint existed in CLAUDE.md rule 20). Reconstructed from the rendered `final.mp4`, `overlays.tsx`, and `style_directives.json` so future jobs have a worked example to look at.

## 0. Snapshot

- Final raw duration: **57.7s** (after 1.20× densify, target ~215 WPM)
- Effective WPM: **213**
- Word count: 205
- Reference outlier: https://www.tiktok.com/@elite.recruiter/video/7604862173264809230

## 1. Visual register

**Palette A — Editorial Italic** (from `agent/skills/typography_palette.md`).

Why: Diane's lore positioning is "America's go-to social and professional skills authority" — Fox/TODAY/Hallmark/CBS Sunday Morning TV-segment expert in the etiquette domain. Vision.md energy_register: "warm-confiding credible-witness, TV-segment peer polish softened by a knowing self-aware half-smile." Editorial Italic is the natural typographic register for an etiquette/luxury authority — it visually signals "publication-quality expertise" without the prim finishing-school cliché.

## 2. Typography palette

| Slot | Family | Weight | Style | Size | Casing |
|---|---|---|---|---|---|
| Caption body | Inter | 800 | normal | font_size_ratio: 0.024 | UPPERCASE |
| Caption emphasis | Playfair Display | 700 | italic | 1.18× body | Mixed Case |
| Overlay header (audit pill, brand card) | Inter | 800 | normal | width × 0.04 | UPPERCASE |
| Stat-card hero (85%, ISN'T WORK, IT'S YOU) | Inter | 900 | normal | width × 0.36 (85%) / 0.105-0.13 (lines) | UPPERCASE |
| Diane intro card body | Inter | 800 (name) / Cormorant italic-stand-in (title) | normal/italic | width × 0.058 / 0.033 | UPPERCASE / Mixed |
| Callback hold-frame | Cormorant Garamond Italic-equivalent (loaded as Playfair fallback in this video) | 600 | italic | width × 0.055 | Mixed |

Code paths:
- Caption emphasis font is set via `caption_style.emphasis_font_family` in `style_directives.json` (defaults to Playfair Italic from `fonts.ts:EMPHASIS_SERIF_FAMILY`).
- All other typography is hard-coded in `overlays.tsx` via the `FONT_TITLE` and `FONT_SERIF` constants.

## 3. Color palette

- **COLOR_NAVY** `#172447` — overlay headers, stat-card body, Diane card background
- **COLOR_CREAM** `#F5EFE3` — stat-card background, overlay text on dark
- **COLOR_RUST** `#C2552C` — stat-card accent ("ETIQUETTE", "ISN'T WORK"), card URL color
- **COLOR_RED** `#C92F2A` — audit-pill background, hook stamps
- **COLOR_GREEN** `#2E7D32` — HUGE UNLOCK stamp (removed in final pass per user direction), countdown timer "00" flash
- Caption body color: `#FFFFFF` (no color highlight — `active_word_color` = body color)

## 4. Caption directives → `style_directives.json:caption_style`

```json
{
  "vertical_anchor_ratio": 0.55,
  "font_size_ratio": 0.024,
  "active_word_color": "#FFFFFF",
  "color": "#FFFFFF",
  "italic_word_starts_ms": [
    9840, 21460, 31600, 43300, 46200, 47260, 50280, 57380
  ],
  "hide_ranges_ms": [[1240, 3560]]
}
```

Italic emphasis words: `taught` (9.84), `etiquette` (21.46), `junior` (31.60), `room` (43.30, rules-of-the-room reveal), `Skills` + `Etiquette` (46.20, 47.26, parallel contrast), `protocol` (50.28, CTA keyword), `read` (57.38, callback closer).

Hide range 1240-3560 ms = the ETIQUETTE ILLITERATE custom-stamp window. Captions suppressed so the big-text overlay reads alone.

## 5. Per-beat overlay manifest

| t (s) | Beat | Treatment | Asset(s) | SFX |
|---|---|---|---|---|
| 0.0–0.42 | Phone red-flash mask | sam3 mask of the phone region tinted red, pulse-flashing via `mix-blend-mode: screen`, overlaid on the avatar's diegetic phone-gag | `phone_red_flash.mp4` (built from `masks/sam3__smartphone__*.mp4` via ffmpeg `lut=r=val:g=0:b=0`) | `warning_pulse` (custom-gen via sfx.py) |
| 0.95–1.45 | Phone-tap (off-frame) | Audio only — the avatar sets phone down off-frame; SFX sells the gesture | — | `phone_tap_wood` (custom-gen via sfx.py, library: `ui/`) |
| 1.96–3.56 | ETIQUETTE ILLITERATE big-text reveal | Drop-shadow only (no outline), Inter 900 condensed, scale-in spring + slight rotation, positioned ~22% from top so it doesn't collide with the 55% captions | — | `stamp_slam` (library: `impacts/`) |
| 13.5–20.0 | 85% stat card (full-frame screen takeover) | Cream radial-gradient background, 1.12× base scale to bleed past edges, continuous gate-weave (sin oscillation on x/y/rotation/scale). Three logos pop in (Harvard 13.72, Stanford 14.18, Carnegie 14.88), then 85% hero text + "OF JOB SUCCESS" appear at 16.66, then "ISN'T WORK." + "IT'S YOU." reveal at 18.66 / 19.46 | `logo_harvard_alpha.png`, `logo_stanford_alpha.png`, `logo_carnegie_alpha.png` | 3× `click_tight` (one per logo entry, library: `ui/`) + `thud_chest` on 85% reveal |
| 20.0–39.5 | "⏱ 30-SECOND ETIQUETTE AUDIT" header pill (top-center) + countdown timer (upper-right circle ticking 30→00) | Red rounded-pill header with clock emoji, navy circular timer badge. Timer ticks proportionally; flashes green when audit ends | — | — (silent ticking implied) |
| 23.7–25.0 | Audit Q1 — phone at dinner | Cutout icon (phone face-down on napkin) over torso, pop-in spring + continuous gentle wiggle (sin rotation ±3° + bob ±4px) | `icon_phone_dinner_alpha.png` | `click_popup_bright` |
| 25.1–27.3 | Audit Q2 — handwritten note | Cutout icon (cream notecard + fountain pen) | `icon_thankyou_note_alpha.png` | `click_popup_bright` |
| 27.4–29.0 | Audit Q3 — 10s self-intro | Cutout icon (analog watch) — note: chunk transcript drifted from intent ("Who did you last introduce to someone?") so this icon maps loosely to the diagnostic frame, not literally to "10 seconds" | `icon_10sec_watch_alpha.png` | `click_popup_bright` |
| 29.1–33.8 | Audit Q4 — most-junior-first | Cutout icon (meeting room with newcomer entering) | `icon_meeting_room_alpha.png` | `click_popup_bright` |
| 33.9–35.9 | Audit Q5 — leaving a room | Cutout icon (open doorway) | `icon_open_doorway_alpha.png` | `click_popup_bright` |
| 46.2–48.7 | Skills→Etiquette stat card (slide-in from right) | Pre-rendered editorial card image; slides in on a spring, holds, fades on chunk close | `stat_card_skills_etiquette_alpha.png` | `whoosh_short_stove_dry` (library: `transitions/`) |
| 52.1–57.4 | Diane introduction card | Real Diane headshot from `protocolschooloftexas.com`, slides in lower-third from left. Card: navy background + cream keyline, circular photo + DIANE GOTTSMAN bold + "Founder, The Protocol School of Texas" italic + rust URL | `diane_headshot.jpeg` (fetched via WebFetch + curl from the live website) | `whoosh_light_lifted_1` (library: `transitions/`) |
| 55.0–57.4 | Callback hold-frame | Italic serif quote at top of frame, fades in over 0.5s, holds: *"You can't win a room you were never taught to read."* | — | — |

## 6. Required-overlay checklist

- [x] Hook treatment — **in-camera diegetic phone-gag** (avatar caught scrolling, looks up, sets phone down off-frame) + ETIQUETTE ILLITERATE big-text reveal at 1.96s
- [x] Signature-stat moment — **full-frame 85% stat card with gate weave** (13.5–20.0s)
- [x] Per-chunk visualizer — 5 audit-question icons (one per Q in C3 + C4) covering 5 of 7 chunks
- [x] Brand introduction card with real assets — Diane headshot fetched live from her website
- [x] Closing callback hold-frame — italic serif quote
- [x] Audio SFX layer — 5 click-pops + 1 stamp + 1 thud + 1 warning + 1 phone-tap + 2 whooshes

## 7. Asset manifest

| Name | Model | Aspect | Generated | Notes |
|---|---|---|---|---|
| `icon_phone_dinner` | gpt-image-2 | 1:1 | yes | magenta bg, ffmpeg-keyed to alpha |
| `icon_thankyou_note` | gpt-image-2 | 1:1 | yes | magenta bg → alpha |
| `icon_10sec_watch` | gpt-image-2 | 1:1 | yes | magenta bg → alpha |
| `icon_meeting_room` | gpt-image-2 | 1:1 | yes | magenta bg → alpha |
| `icon_open_doorway` | gpt-image-2 | 1:1 | yes | magenta bg → alpha |
| `stat_card_skills_etiquette` | gpt-image-2 | 2:3 | yes | magenta bg → alpha |
| `logo_harvard` | gpt-image-2 | 1:1 | yes | crest, magenta bg → alpha |
| `logo_stanford` | gpt-image-2 | 1:1 | yes | wordmark, magenta bg → alpha |
| `logo_carnegie` | gpt-image-2 | 1:1 | yes | wordmark, magenta bg → alpha |
| `diane_headshot.jpeg` | — | — | fetched | direct download from `protocolschooloftexas.com/wp-content/uploads/...` |
| `phone_red_flash.mp4` | sam3 → ffmpeg | — | built | mask × red color → mix-blend overlay |

**gpt-image-2 transparent-bg note:** the model rejects `--background transparent` via Replicate currently. Workaround: solid magenta (`#FF00FF`) declared in the prompt + ffmpeg `colorkey=0xFF00FF:0.30:0.10,format=rgba` post-pass.

## 8. SFX manifest

| t (s) | Cue | Source | Volume |
|---|---|---|---|
| 0.0 | warning pulse | `<job>/sfx/warning_pulse.mp3` (custom-gen) | 0.55 |
| 0.95 | phone tap on wood | `<job>/sfx/phone_tap_wood.mp3` (custom-gen) | 0.7 |
| 1.96 | stamp slam | `sfx/impacts/stamp_slam.mp3` (library) | 0.55 |
| 13.72 / 14.18 / 14.88 | click tight (3×, one per logo) | `sfx/ui/click_tight.mp3` (library) | 0.65 |
| 16.66 | thud chest (85% reveal) | `sfx/impacts/thud_chest.mp3` (library) | 0.55 |
| 23.7 / 25.1 / 27.4 / 29.1 / 33.9 | click popup bright (5×, one per audit-icon entry) | `sfx/ui/click_popup_bright.mp3` (library) | 0.6 |
| 46.2 | whoosh (stat card slide-in) | `sfx/transitions/whoosh_short_stove_dry.mp3` (library) | 0.4 |
| 52.1 | whoosh light (Diane card slide-in) | `sfx/transitions/whoosh_light_lifted_1.mp3` (library) | 0.45 |

## 9. Motion vocabulary

- **Spring physics:** damping 9-14, stiffness 130-220, mass 0.5-0.6 (per-component tuned)
- **Per-overlay entry style:** pop-in springs for icons (scale 0.3 → 1.0), slide-in springs for cards (translate X → 0), scale-in springs for stamps (scale 0.7 → 1.0 + slight rotation)
- **Continuous effects:**
  - **Gate weave** on the 85% stat card — film-projector wobble via `Math.sin()` oscillation on x/y translate + rotate + scale, base scale 1.12× so the bleed never reveals the avatar underneath
  - **Continuous wiggle** on audit-icons — slow rotation oscillation ±3° + vertical bob ±4px
  - **Pulse flash** on phone red-flash — `0.4 + 0.55 * |sin(frame × 12)|`
- **Camera moves (in seedance prompts, not Remotion):** chunk 0 has a hard cut from tight CU phone → MCU at ~1s when the avatar catches the camera. All other chunks are locked MCU.

## 10. On-brand / off-brand

| ON-brand | OFF-brand |
|---|---|
| Cream radial-gradient cards with deep-navy keylines | Saturated red full-bleed with thick white outlines |
| Playfair Italic mixed-case emphasis | Bright blue keyword highlight |
| Gate weave on the signature stat card | Smooth Hollywood zoom or kinetic-typography snap |
| Real Diane Gottsman headshot pulled from her site | Generated AI stand-in face |
| In-camera diegetic phone-gag for the hook | Layered post-production overlay treatment |
| Drop-shadow ETIQUETTE ILLITERATE | Text-stroke outlined ETIQUETTE ILLITERATE |
| Captions at 55% from top | Captions at 65% colliding with audit-icons |

## 11. Documented skips

- **HUGE UNLOCK stamp:** drafted then removed at user request (felt over-saturated alongside the 85% reveal + audit countdown). Relief beat now carried by the caption "this is gonna be a *huge unlock* for you" at low-key emphasis.
- **CTA pill ("COMMENT: PROTOCOL ↓"):** intentionally skipped — Seedance baked a large "PROTOCOL" text directly into chunk 6 (interpreting the quoted `'PROTOCOL'` in the dialogue prompt as a render instruction), so the visual CTA is already burned into the avatar video. Adding a Remotion pill would double up.
