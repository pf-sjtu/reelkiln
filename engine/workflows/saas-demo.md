# saas-demo — a screen recording → punchy vertical product demo

A forward recipe for the **"I have a SaaS, make me a short demo"** job: turn a raw
desktop **screen recording** (16:9) into a vertical (9:16) demo that reads as a
*designed* video — the app framed in a browser card, a cinematic **focus-zoom**
that snaps onto whatever's being acted on, brand captions + logo, and a few
**brand-style generated beats** (hook / bridge / close) so it isn't 50s of the
same UI. Real footage + real VO ⇒ the whole job is near-free; only the generated
stills cost anything.

This is an L2 workflow on the canonical tools — no new tools. It relies on two
compositor primitives built for it (both in `remotion/src/`, driven from
`style_directives.json → video_transform`):

- **`frame`** — the browser-card treatment: the source floats in a rounded,
  shadowed card with a chrome bar (traffic-light dots) on a brand background,
  so a dense desktop app reads as a shot instead of a screenshot.
- **`focus_track`** — keyframed zoom toward an arbitrary focal point
  `{at_sec, scale, x, y, ease}` (cubic ease). The screen-demo mechanic:
  **establish → punch** onto the button / answer / citation, hold, ease out.
- **`<BrandBeat>`** (`remotion/src/BrandBeat.tsx`) — a shared overlay component:
  a full-screen still (generated brand b-roll) with Ken-Burns push + edge fades,
  for the hook / bridge / close beats. Import it in a per-job `overlays.tsx`.

> **STATUS (2026-07-02):** proven end-to-end on **a SaaS screen-demo build**
> (the worked example below). That build is *a* path, not the only one.

Shared skills carry the load — read them, don't re-derive:
`skills/evaluation.md` (per-asset eval), `skills/broll_styles.md`
(static-image motion / Ken Burns). All tools run from repo root as
`uv run python tools/<tool>.py` with **`--job <id>` explicit**.

---

## How to read this recipe (abstraction — READ FIRST)
This file is the **generalizable recipe**. The SaaS screen-demo build is **one worked
example** of it, not the spec. Every *concrete* value you see below — beat names
and timings, hex colors (`#eaeef3`), fonts (Space Grotesk), the `focus_track` <!-- lint-ok: example -->
numbers, gen prompts, the exact beat list — is **illustrative, from that example**.
Derive each from the *current* tenant's brand + footage. Do NOT hardcode that example's
choices into a new job. What's actually load-bearing and portable is only:
the **spine** (steps 0–6), the two **primitives** (`frame`, `focus_track`), and
the **craft laws** in step 2 / QA. Everything else is a knob.

## When to use
The source is a **screen/UI recording** (SaaS feature, dashboard, tool). For a
talking-head creator reel use [`aroll-reel.md`](aroll-reel.md); for a narrative
product spot use [`cinematic-ad.md`](cinematic-ad.md).

## Inputs
- One or more **screen recordings** (client-supplied mp4 — *Path A*, the reliable
  default). *Path B* — we drive the app via Chrome/computer-use and capture it
  ourselves (gives an exact cursor/coord track for free) — is a premium upgrade,
  not yet proven; keep it deferred.
- The **product URL** (for brand intake) and the **one feature** to hero.
- **VO**: real recording is ideal (superior + cheap). Synth is the fallback —
  note `synth_voice` today has only `tts|design|transcribe` (no voice browsing /
  speech-to-speech voice-change yet; those are a future extension).

---

## The spine

**0 · Brand intake → refs.** Scrape the site and pull the real assets — they make
everything on-brand and style-lock the generation:
- `uv run python tools/website_style.py --url <site>` → Google-Fonts families + hex palette.
- `curl` the **logo** (transparent PNG), **hero/lander illustration**, and a few
  product screenshots into `jobs/<id>/brand/`. These become `--reference` inputs.
- Ask the human for product facts + the ONE feature to demo.

**0.5 · Concept & story gate (run it by the human FIRST).** Draft the arc as a
short shot-plan that doubles as the **record list** — so the client knows exactly
what to record and the script isn't spray-and-pray. Canonical arc:
**hook (the pain) → turn (drop it in) → ask → payoff (the one feature, held late)
→ range → CTA.** Apply build-tension / hold-payoff. Nothing gets recorded until
this is approved.

**1 · Ingest + cut beats.** Trim each recording to the beat windows (keep them
full-frame 16:9 — the `frame` treatment does the framing later), normalise fps,
`concat`, then **mux the VO** as the audio track.
- Real VO: `clean_audio --mode denoise` (spectral, **timing-preserving** — so the
  focus_track stays in sync; do NOT `--mode trim`, it re-times). Safe to run
  always: it measures the take and passes clean audio through untouched.
- **Voice variants (optional, free-ish):** because `synth_voice --mode voice_change`
  preserves timing, you can spin N spokesperson variants of the *finished* edit
  (gender / authority / localized) by swapping only the VO — no re-edit. See
  [`skills/primitives/voice_change.md`](../skills/primitives/voice_change.md).
- `synth_voice --mode transcribe --audio <vo>` → `transcript.json` (drives captions).
- ⚠ **Privacy:** screen-rec file-pickers leak personal filenames — use the app's
  own "Uploading / Processing…" state for the upload beat, never the OS picker.

**2 · Author the focus_track (the craft).** In `style_directives.json`:
```json
"video_transform": {
  "background_color": "#eaeef3",   // illustrative — derive from the tenant brand. lint-ok: example
  "frame": { "inset_pct": 4, "top_pct": 20, "radius_px": 30, "chrome": "bar", "source_aspect": 1.7333 },
  "focus_track": [ { "at_sec": 26.8, "scale": 2.8, "x": 0.30, "y": 0.33 }, ... ]
}
```
Land punches **on the VO words** (read `transcript.json` timings — e.g. the
citation punch on *"linked to the exact page"*). Framing law learned the hard way:
- A dense 16:9 app **cannot be portrait-cropped** — it mangles. Frame it + punch.
- Keep origin **y ≈ 0.33–0.37** (content upper-mid, captions clear below). Low y
  (0.5+) pins the zoom near the card bottom and leaves a dead grey band.
- On a phone you're **zoomed most of the time**; full-app-visible is a brief
  establish, not the default. (At scale 2.6 on a 92%-wide card you still see ~42%
  of the width — don't mistake that for "not zoomed.")

**3 · Brand-style generated beats (the anti-boring layer).** 3-ish full-screen
stills at the dead spots (long hook, mid-section, proof/close), **grounded in the
real assets** so they read as the brand, not generic AI:
- `mint_image --role artistic_still --aspect 2:3 --reference <hero> --reference <logo> --reference <screenshot> --prompt "<concept>. Matching very well with this brand's visual style and palette."`
  (keep the prompt loose; let the model generalise off the refs). ~$0.17 each.
- Prefer **light / on-palette** over moody-dark for a clean B2B brand.
- Place them **full-screen via `overlays.tsx`** (a per-job `JobOverlays`), NOT in
  the base video (the base is card-framed; brand art must be full-bleed). Animate
  with free **Ken Burns** (per the static-motion rule). The caption layer is
  z-indexed **above** JobOverlays, so captions stay legible on top of these beats.
- The generated proof/close card can *be* the ending (drop a separate CTA slate).

**4 · Captions + logo.**
- Captions are opt-in (name a preset or set `caption_style`). On the **light**
  brand bg use **dark ink** (white text vanishes) — e.g. Space Grotesk 700,
  `#20242a`, small (`font_size_ratio` ~0.034), sentence-case, subtle white outline <!-- lint-ok: example -->.
- Logo via `overlays.tsx`: a small persistent mark during the product stretch, and
  the real logo built into the brand cards. Drop redundant brand text (e.g. the
  chrome-bar label) once the logo carries it.

**5 · Render.** `compose_render --mode render --job <id> --skip-preflight`
(a `post_only.json` marker lets it run without a `script.json`; `overlays.tsx`
is auto-linked). style_directives supplies `frame` + `focus_track` +
`caption_style`.

**6 · Finish.** The rendered `final.mp4` is a complete draft: show it and return
to the user ([Finishing a render](README.md#finishing-a-render)). The craft to build
in: readable UI, truthful product states, clean captions and source framing.

---

## Worked example — a SaaS screen-demo build
53.5s, **$0.68 total** (4 generated stills; footage + VO were free). Beats:
light "drowning in documents" hook (gen) → framed product demo with focus-punches
(ask → pinpoint answer with citations popping → source) → "Compare everything"
brand card (gen) → live multi-doc compare → **200,000+** proof card (gen, carries
the close). Real VO (denoised), Space Grotesk captions, real logo throughout.
Every framing/craft choice above came from that build's QA loop.

---

## Backlog — what would make this workflow stronger
Ordered by value. The v1 (the worked-example build) shipped without these; each is
a real gap surfaced during that build, not speculation.

**Still open — high value (scale + client-readiness):**
1. **focus_track inference** — auto-generate the `focus_track` from a supplied
   recording (Gemini reads keyframes → "where's the action" → smoothed keyframes).
   Today it's **hand-authored** — this is the bottleneck that stops the workflow
   from being one-shot. THE scaling unlock.
2. **Brand-intake automation** — `website_style` today is fonts+colors ONLY. Extend
   to auto-pull **logo + hero/lander images + product screenshots + copywriting
   voice** → a `taste/packs/<tenant>/` (done by hand via `curl` in the example).
   Reused by every client job (UGC ad, local-biz too).

**Still open — medium (polish + the moat):**
3. **Path B — driven capture** — drive the app via Chrome/computer-use, record a
   clean session, emit an **exact cursor/coord focus_track for free**. The
   differentiator. Hard part = clean *video* capture of the driven session.
4. **Fake cursor + click-ripple overlay** — replace the real cursor (demo polish).
5. **Two-slot `JobOverlays`** (bg vs fg) — cleaner than the current caption
   z-index lift (which works, but is a shared-composition tweak).

**✅ Built (2026-07-02):**
- **`synth_voice --mode {list_voices, voice_change}`** — voice browsing + speech-to-
  speech (keeps VO timing, so captions/focus_track stay synced). ⚠ **Needs the API
  key to have the `speech_to_speech` + `voices_read` scopes** — code is done and
  validated (clean permission error), fires once the scope is enabled.
- **`<BrandBeat>`** shared Ken-Burns brand-beat component (`remotion/src/`).
- **`mint_image` cost logging** — now writes its own role-priced `estimate_usd`
  (no longer "cost-blind"; reconcile sums a real figure).
- **`taste/packs/<tenant>/`** tenant pack (logo, hero, palette, copy voice, COMMITMENTS).
