# ecommerce-ads — build a product's foundation once, then mass-produce ads

A forward recipe for **e-commerce product ads at volume**: establish a reusable **foundation**
for a product once (locked assets + a mined, proven format), then **"go ham"** producing many
ad variations cheaply off that foundation. Unlike `cinematic-ad` (one bespoke narrative spot),
this optimizes for **range** — dozens of A/B-able ads from one paid setup.

> **The whole trick (read first).** The expensive part — locking references + finding a format
> that works — is paid **once** and **amortized** across everything you produce after. So Phase A
> is deliberate and Phase B is a factory. And every ad must do **two jobs at once** (below); an ad
> that only hooks gets views, not sales.

L2 workflow on the canonical tools + Sandcastles (research). Behind the tools: GPT Image 2
via Fal (`mint_image`), Seedance / Gemini (`mint_video`), Apify + yt-dlp (`pull_video`), Gemini
(`analyze_reference`). Run from repo root; every tool takes **`--job <id>`** explicitly.

Shared skills/laws referenced (not repeated): `workflows/cinematic-ad.md` (asset-lock + Style
Prefix + test-many-lock-winner), `CANONICAL_TOOLS.md`.

---

## How to read this (abstraction — READ FIRST)
This is the **generalizable recipe**. The **novelty e-commerce product** build (§Worked example) is
*one instance*. Every concrete value there — the wand, the meme text, the pink, the magician format,
the prompts — is **illustrative, not law**. Derive each from *your* product. What's portable is: the **two axes**,
the **foundation-archetype framework**, **concept-match-scored mining**, and the **craft laws**.
If you can't say *why* a lock or beat exists for your product, you're copying, not directing.

## The two axes — every ad balances BOTH (the core law)
See [[hook-plus-product-understanding]].
1. **Hook + tension** — a reason to keep watching (a reveal, escalating reactions, a skepticism gap).
2. **Product understanding** — the viewer must *get* what the product is / how it works.

Hook-only ads go viral and sell nothing. For **functional** products the understanding beat is a
**mechanism reveal** (the part that does the thing). Weave it in *without* bleeding tension —
typically **after the hook, before the payoff**.

## The cycle: FOUNDATION once → GO HAM
```
Phase A (per product, paid once):  mine a matching format ─┐
                                    lock the asset bank ────┼─►  FOUNDATION
                                    lock style + format ────┘
Phase B (per ad, cheap):  pick concept → generate beats → assemble → present the draft   (repeat ad infinitum)
```

---

# PHASE A — FOUNDATION (deliberate; paid once)

## A1 · Mine a format that WORKS *and* MATCHES (not just "works")
Don't invent a format — find a proven one and adapt it. But rank on **two axes**, not one:
- **Performance** — does it work? (Sandcastles *outlier score* + views.)
- **Concept match** — does the format's *premise* map **natively** to your product? A monster-outlier
  format with a weak match forces a stretch that reads as off. **Prefer concept-match × performance.**

**The mining loop (all real tools):**
1. **Search** — Sandcastles `search_all_videos` / `top_formats` / `top_hooks`. Query by your product's
   **premise**, not just its niche — e.g. for a novelty payment device: *"paying with [absurd thing],"
   "cashier double-take," "novelty gift reaction," "tap-to-pay flex"* — so the surface, not just the
   mechanic, transfers. Rank hits by outlier score, then re-rank by how directly the premise matches.
2. **Pull** — `pull_video --mode pull --url <single>` (yt-dlp) or `--mode enumerate --url <profile>`
   (Apify scrapes a whole IG/TikTok profile → ranked-by-views manifest → download top-N; see
   [[social-scrape-apify]]). Apify because yt-dlp can't list a profile behind the auth-wall.
3. **Format proposal** — `analyze_reference --mode video --format-proposal` (Gemini) extracts the transferable
   structure, hook archetype, production recipe, and *what-not-to-replicate*. Gate on the mechanism, not
   the surface gag.
4. → a **concept bank**: ranked ad angles, each = *hook × format × core message*, tagged with its
   concept-match strength.

## A2 · Get the assets — retrieval-first
Priority (from the preflight): **the brand's own media → scrape → stock → GENERATE (last).**
- **Real product images** — scrape the store CDN (Shopify `/cdn/shop/files/…`), the product page.
- **Palette + fonts** — `website_style <url>`.
- **The brand's own videos** — `pull_video --mode enumerate` their IG/TikTok → `index_media` them;
  reuse real clips as primary, generate only gap-fills. (The worked example's real product-assembly
  clip came this way.)
- **Generate** to fill gaps — `mint_image` (hero, angles, colorways, mechanism detail, seed frames),
  `mint_video` (motion); to **restyle a real clip**, `--mode edit` or `--mode genjutsu` (ask the
  user which; see A3 / [[motion-transfer-restyle]]).

## A3 · Lock the asset bank — "WHAT do you lock?" (the archetype framework)
**You only lock what RECURS across the brand's ads.** Pick the archetype from (product type × ad
format × what recurs); lock only that; **test-many-lock-winner** (a bad lock poisons every ad that
cites it — cinematic-ad §Stage 1).

| Archetype | Lock | Get assets via | Best when | Consideration |
|---|---|---|---|---|
| **Product-only** | hero + angles + colorways + **mechanism detail** | scrape CDN → `mint_image` → `edit` for prompt-only restyles | POV / reaction / novelty UGC | faces are disposable → **don't lock a cast** |
| **Product + persona** | approved recurring person and references | supplied face refs + real footage; generated shots use the approved refs via `mint_image --role portrait` ([E005 guidance](aroll-reel.md#generated-a-roll-variant--talking-head-from-the-character-sheet-generic)) | founder-led, testimonial series, recurring creator | new dialogue follows the [talking-head default](README.md#talking-head-default); preserve product evidence, with no invented testimonial or silent identity substitution |
| **Product + world** | + locations + model sheets + Style Prefix | full `cinematic-ad` Stage-1 bank | premium / beauty / fashion / narrative | continuity across a *story*, not a montage |
| **Real-footage-primary** | index the brand's **own** library | `pull_video --mode enumerate` → `index_media` | brands already posting content | real UGC > generated; generate only gap-fills |
| **Mechanism / demo** | rich **how-it-works** refs | `mint_image` detail/cutaway + real macro | gadgets, tools, transformation products | the *sell* IS how it works |

**Mechanism-detail refs (functional products — don't skip):** the understanding axis fails without
them. Lock crisp references of **the part that does the thing** — the slot/hinge/open state, an
insert/assembly shot, a cutaway "it lives here," closed-vs-open. Generate these (`mint_image`) or shoot
macro. *(Lesson from the worked example: we had the unscrew motion but no clean "card slides into the
slot" ref — the beat leaned on assembly alone. Add the insert detail.)*

## A4 · Lock the Style Prefix + the format
One **Style Prefix** glued to every generation prompt (look/grade/energy/aspect) — change it once,
the whole line moves (cinematic-ad §Stage 2). Lock the chosen format's beat structure from A1 as the
reusable template. Write both into the tenant pack / `jobs/<id>/foundation/`.

---

# PHASE B — GO HAM (per ad, cheap; reuses the foundation)

1. **Pick a concept** from the bank → a short beat list off the locked Style Prefix + locked assets
   (continuity is free — everything cites the same locks).
2. **Generate the beats:**
   - **Reactions / POV** → `mint_video --mode insert` (Seedance, **product-only reference** — POV
     needs no cast). **Generate many, keep the WINNER reactions** — the genuine excited onlooker is
     what sells; batch candidates and cut the best.
   - **Product-understanding beat** → real footage. To restyle it (a new colorway, material
     or look), offer both and ask the user which: `--mode edit` (Omni edit: faster, one
     prompt-only change) or `--mode genjutsu` (more powerful: the clip plus the target look
     as a reference image, e.g. the pink colorway still).
   - **Cinematic / narrative beats** (if that archetype) → one composed seed still animated
     with Omni image-to-video (the app's `call_model`, `google-gemini-omni-flash-image-to-video`).
3. **Assemble** (`compose_render` or ffmpeg for meme montages): **hook → product-understanding →
   payoff**; static meme/caption text; grain + slight speed for low-fi UGC energy. **Diegetic reaction
   audio kept; the music beat-drop is added in POST** (user-supplied track via `score_bed`).
4. **Voice variants (optional, free-ish)** — `synth_voice --mode voice_change` preserves timing, so you
   can spin spokesperson/gender/locale variants of a *finished* cut without re-editing.
5. **Finish** — the rendered video is a complete draft; return it to the user
   ([Finishing a render](README.md#finishing-a-render)).
6. **Repeat** — same foundation, new concept/color/format → the range compounds.

---

## Craft laws (the *why*)
- **Balance the two axes** — hook AND understanding, every time. [[hook-plus-product-understanding]]
- **Mine for concept-match, not just outlier** — a native premise beats a high-performing stretch.
- **Lock only what recurs** — POV ⇒ no cast; product-only is often enough (don't over-build).
- **Reactions = generate-many-keep-winner** — the excited onlooker is the product.
- **Seedance for product-only; Omni image-to-video (`call_model`) for a referenced face with no
  footage; `genjutsu` to swap a referenced person into a real clip** — Seedance rejects photoreal face refs.
- **Motion-transfer > recolor** to restyle real footage (no flicker; keep the real mechanism).
- **Retrieval-first** — the brand's real media beats anything generated; generate to fill gaps.
- **Build tension, hold the payoff** — [[build-tension-hold-payoff]]; release late.
- **Every static gets motion** — [[visual-interest-paramount]].

## Tools used (+ what this workflow added)
`analyze_reference` (video/format proposal) · `pull_video` (**`enumerate`** = Apify profile scrape,
NEW; `pull`; `select`) · `website_style` · `index_media` · `mint_image` · `mint_video` (insert /
keyframe / **`edit`** or **`genjutsu`** = restyle a real clip) · `synth_voice` (voice_change) ·
`score_bed` · `compose_render`. Research: **Sandcastles** MCP.

---

## Worked example — a novelty e-commerce product ad (honest, warts included)
A glossy star wand that holds a tap-to-pay card; sold via meme/reaction UGC.
**Archetype: product-only + mechanism** (POV ⇒ no cast).

- **Foundation:** scraped 9 real product images; `website_style`; locked a pink hero (`mint_image`,
  test-2-pick-1) + holographic colorways; `pull_video --mode enumerate` pulled the brand's own
  reels; the real product-assembly clip became the product-understanding beat.
- **Mined format:** Sandcastles surfaced a magician "prove-it's-fake → it's real → jaw-drop reaction"
  format (**13,843× outlier**); Apify/yt-dlp pulled it; Gemini summarized it. **Lesson:** we
  optimized *outlier* over *concept match* — rubber-band-trick → payment-wand transferred as a mechanic
  but was a loose *surface* match. Next time, search premise-first and rank concept-match × outlier.
- **Two ads produced:** (1) a fast POV tap-to-pay reaction montage; (2) the mined "it's just a toy…
  watch it actually pay" magic-reveal, **with the unscrew product-understanding beat**.
- **Wins/lessons:** Seedance product-only gave believable reactions with no face-lock; reactions were
  generate-many-keep-winner; the color problem was solved by **motion-transfer** (blue real unscrew →
  consistent pink) not recolor. **Gap:** needs crisp **card-into-slot** mechanism refs (flagged above).
- **Cost shape:** foundation + 2 ads ≈ **$3.75** (footage/scrape ~free; only gen costs, ~$0.35/clip).

## Backlog
- **Concept-match scoring** — formalize the premise-query + concept-match rank in the mining step.
- **Mechanism-ref pass** — generate the card-into-slot / cutaway refs for the product.
- **Music sourcing** — the beat-drop is POST/user-supplied; no licensed-track path yet.
- **`reenact` → `replicate_safe`** — motion-transfer bypasses the retry/cost-safe entrypoint (flagged).
- **Promote** `jobs/<id>/foundation/` → `taste/packs/<tenant>/` so future ads inherit the locks.
