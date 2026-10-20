# How the user likes post-production edits authored

**Read this BEFORE proposing post-render edit options, and apply.** Re-read after every post-production round — patterns evolve.

This file = **distilled rules**, agent-curated.

**Also mandatory before authoring or revising `<job_dir>/overlays.tsx`:** read all five canonical reference overlay files in [`_references/`](_references/README.md). They are the multishot anchor for "what good looks like on this pipeline" — same role `user_script_voice/PATTERNS.md` + raw EDIT_PAIRS play for scripts. Start with the README to pick the closest analog, then read the full TSX end-to-end of at least one reference before writing yours.

For the **raw verbatim before/after** of every edit round (what did the agent propose, what did the user pick, what reasoning), see [EDIT_PAIRS.md](EDIT_PAIRS.md) — auto-regenerated, no commentary, scrollable in one place.

This file accumulates patterns the user has revealed through their picks across my proposal menus. Each pattern is grounded in a real round (date + job ID). **NEVER invent a pattern** — only add what the user has actually demonstrated.

For provenance per video, see `agent/output/<job-id>/post_production_history/round_*.md` (raw snapshots).

---

## Hard rules (the user expects these every time)

### 1. ALWAYS end a render checkpoint with an edit-suggestions menu
*Identified: 2026-05-11, Awaken Coach Institute job, round 1.*

> User feedback verbatim: *"also at the end can u suggest that we always suggest edits to make it relaly good and again, similar to the script. we should take what you suggested, what I chose and any additionals and reasoning"*

At meaningful render checkpoints (especially rule-20 #5 / final.mp4), the agent may surface a
"what can we add to make this more visually engaging" menu when useful or when the user requested
collaboration. It contains:
- **3–5 high-impact options** with one-line reasoning each
- **2–3 subtler options** for the agent's taste
- **A "what I'd NOT do and why" list** (anti-patterns specific to this brand)
- **A recommended bundle** as the agent's pick

Apply the recommended grounded bundle by default and continue. If the user explicitly requested
review, let them pick a subset or add their own. Snapshot the agent round to
`<job_dir>/post_production_history/round_NNN_agent.md`; write `round_NNN_user.md` only when real
user feedback exists—never fabricate a user choice to satisfy the corpus.

### 2. Preserve user-edited choices verbatim (mirrors script-voice rule #2)

When the user picks specific options or describes a custom edit, every word survives. Don't silently reinterpret "smaller and not all caps" as "tiny and lowercase" — match exactly. If sizing/styling needs clarification, ASK; don't decide.

---

## Caption / typography patterns

### 3. Captions must break at sentence boundaries, not mid-clause
*Identified: 2026-05-11, Awaken Coach Institute job, round 1.*

> User feedback verbatim: *"right now the captions end and start in weird places id like it to end natually on like fullstops etc"*

Default Remotion `createTikTokStyleCaptions` chunks by time-gaps and produces awkward mid-sentence breaks (e.g. *"of you that fit? THAT is"* split across pages). The user expects each caption page to be a complete clause, ending on `.` / `?` / `!` / `—`.

**Apply:** implemented in `agent/remotion/src/Captioned.tsx` as default-on `break_on_sentence` after `createTikTokStyleCaptions`. Splits any page mid-page at sentence-ending punctuation. Opt-out via `style_directives.json:caption_style.break_on_sentence: false`.

### 4. Word-pop emphasis pairs with italicized script asterisks
*Identified: 2026-05-11, Awaken Coach Institute job, round 1.*

The italicized words in script.json dialogue (`*that*`, `*impossible*`, etc., per script-voice PATTERNS #6/#14) should get a Layer-3 word-pop in overlays.tsx — a big-text element above captions that fires WHEN the word is spoken, scales in (snappy spring), holds 0.5–1.0s, fades out. Awaken brand-pink (`#F472B6`) for this brand.

**Apply:** anchor with `findWord`/`findPhrase` against `transcript.json`. Use ONCE per script max — saves the "one moving thing" budget per overlay_authoring_guide §4. If the script has 3 italicized beats, all 3 get word-pop (they're already curated emphasis points by the user — that's the whole point of the asterisks).

---

## Sticker / overlay patterns

### 5. TikTok-style stickers: sentence case, smaller than captions, dark pill
*Identified: 2026-05-11, Awaken Coach Institute job, round 1.*

> User feedback verbatim: *"can we do a tiktok style overlay (similar to now but smaller and not all caps) that says 'feeling lost in your career? watch till the end'"*

User's preferred sticker style:
- **Sentence case**, NOT all caps
- **Smaller** than the caption track (~44px when captions are ~60px / 0.055 ratio)
- **Dark translucent pill** (rounded corners, `rgba(0,0,0,0.72)`, backdrop blur)
- **Top of frame** (upper third — `top: Math.round(height * 280 / 1920)`, i.e. 280px on the 1920-tall portrait canvas and ≈158px on a 1080-tall landscape one; clear of face bbox and bottom captions)
- **Subtle ambient drift** (1-2px sine sway), not static
- **Persistent** through most of the video, **fades out before the brand drop** so the close lands without competition
- White text, Inter 600, slight letter-spacing

### 6. Brand drop = MCC card + URL pill, bundled
*Identified: 2026-05-11, Awaken Coach Institute job, round 1.*

When the brand-mention chunk fires (chunk 4 for talking-head pivots), the agent should propose AND default-implement:
- An **authority card** (signature element from vision.md) anchored to the brand-name word — small text card, bottom-right, brand-color outline
- A **URL pill** in the closing 1.5–2s — brand-color pill, lower area above captions, scales in via spring

Don't just drop the brand name verbally — anchor it with proof + a tap-target. Both bundled because the brand drop is the conversion moment.

---

### 7. Screen-hijack cards (§12.5) when avatar visuals are weak in specific chunks
*Identified: 2026-05-13, Sane Spaces job, post-prod round 1.*

When chunk_review or visual inspection reveals concentrated artifacts (hand morphing, lip-sync drift, identity wobble) in specific chunks, **upgrade those chunks from subtle word-pop overlays to FULL-FRAME textured screen-hijacks** using the §12.5 primitive. The card covers the bad visual entirely while the avatar audio plays underneath.

❌ My (agent) round-1 proposal: word-pop on italicized pillar names (subtle overlay on top of the talking-head visuals).
✅ User's pick: "I want to have screen hijack cards for all pillars with the gate weave bcs currently the visuals arent so good for those sections" → all 3 pillar chunks (Clear/Frame/Finish) became full-frame paper-texture takeovers with eyebrow + big italic pillar name + concrete-action sub-line.

**Apply:** When proposing the post-production menu, scan chunk_review JSON. If 2+ adjacent chunks have anatomy or lip-sync flags, default-propose screen-hijack cards for those chunks rather than additive overlays. The §12.5 primitive carries it cleanly: textured paper background, gate-weave jitter, vignette, content slot. Combine with caption-suppression (`hide_ranges_ms` in style_directives.json) so the card stands alone.

This is the inverse of "default to fewer overlays" — when visuals are good, fewer overlays; when visuals are weak in specific chunks, more aggressive takeover in those chunks specifically.

### 8. Typography palette decision (from typography_palette.md) before any caption styling
*Identified: 2026-05-13, Sane Spaces job, post-prod round 1.*

User feedback verbatim on the agent's generic "terracotta active word" suggestion: *"check out the fonts guide before we commit here bcs I think a better typography thought would be good."*

The agent must read `agent/skills/typography_palette.md` and propose **a specific palette letter (A–H)** derived from `vision.md`'s `position` + `energy_register`, NOT a generic color or font choice. Each palette is a coherent bundle: body sans + emphasis serif (or handwritten) + numeric display + casing rule + color story.

**Apply:** in the post-production menu, the caption-styling option must reference the palette letter (e.g. *"Palette D — Coaching Warm: Manrope body + Cormorant Italic emphasis + sentence-case + terracotta active word"*), not just one color. If you can't articulate why a palette fits the brand register in one sentence, you haven't done the work.

### 9. Caption font_size_ratio of 0.052 is too large for talking-head-with-setting
*Identified: 2026-05-13, Sane Spaces job, post-prod round 2.*

User feedback verbatim: *"the captions are too large... half the font size at least."*

When the avatar's setting is a load-bearing visual (curated room, props, bokeh background that contributes to credibility per avatar_prompting_guide §6), default caption ratio of 0.052 (~100px on 1920h) competes with the face and setting for attention. **Halve to ~0.026 by default for talking-head-with-setting; reserve 0.05+ ratios for kinetic-typography-driven formats where captions ARE the primary visual.**

Updated default for talking-head reels: `font_size_ratio: 0.026` unless vision.md format = "kinetic typography" or "B-roll montage."

### 11. NO eyebrows / NO timestamp glyphs / NO "designed-print-magazine" labels on video overlays
*Identified: 2026-05-15, Results By Design Coaching job, design-brief round 1.*

> User feedback verbatim on the proposed "Small sage glyph fades in top-left: 'FIELD NOTE No. 1 · Tuesday 4:47pm'": *"Dont do this wtf is this"* + on the field-note hijack eyebrow: *"remove this eyebrow - eyebrows are so weird and unecessary in videos"*

Print-magazine UI conventions — small-caps eyebrows above headlines, contextual labels like "FIELD NOTE No. 1", fake-precise timestamps like "Tuesday 4:47pm" sitting subtly in a corner — feel forced in short-form video. They read as the editor trying to be cute. Video is direct; the line itself does the work without a label introducing it.

**Apply:** When designing hijack cards, pull-quotes, or stat cards: lead with the LINE. No eyebrow text above it. No category label. No timestamp glyph in the corner. If the card needs context, the context is in the line itself. The exception is a *labeled* reveal where the label IS the punchline (e.g. "UNLOCK" stamp on Protocol School — the label is the diegetic event, not an editorial frame).

This generalises pattern #1 of "less is more" from Jeffrey Shaw and the iteration-minimal end-state of Awaken (pattern #3 ref): when in doubt, strip decorative editorial framing. Trust the line.

---

### 10. ffmpeg post-process for minor (~1.05–1.15×) speedups on rendered final.mp4
*Identified: 2026-05-13, Sane Spaces job, post-prod round 2.*

User feedback verbatim: *"I think we need to up the speed using densify and rerender or just multiply the speed of the final video by like 1.1."*

When a final-render speedup of ~1.05–1.15× is wanted on top of an already-densified video, **ffmpeg post-process is preferred over re-densifying upstream**:

- Densify at >1.30× starts visible lip-sync drift per CLAUDE.md rule 15.
- If we're already at 1.20× and want ~1.1× more pace, the cleaner move is `ffmpeg -filter_complex "[0:v]setpts=PTS/1.1[v];[0:a]atempo=1.1[a]"` on the rendered output.
- Snapshot `final_prespeed.mp4` before the ffmpeg pass for rollback.
- Overlays were already baked into the render, so they scale uniformly with the speedup — no overlay-anchor edits needed.

**Apply:** when the user asks for "a little faster" on an approved render, default to ffmpeg post-process. Only re-densify upstream if they want a structural pacing change (>1.15× or new densify settings entirely).

---

## Recommended bundle (the agent's default proposal for talking-head reels)

Until a brand-specific corpus accumulates, the default options menu after rule-20 #5 should include:

1. **Word-pop on italicized emphasis** (per pattern #4)
2. **First-frame kinetic-text hook overlay** (when the visual hook is a quiet moment that could carry typography reinforcement)
3. **MCC / authority credibility card during brand drop** (per pattern #6)
4. **Brand URL pill at the close** (per pattern #6)

Subtler:
5. **Loop-seal close** — final 0.5s matches opening frame for seamless TikTok auto-replay
6. **Brand-color accent on active caption word** (overrides default white via `style_directives.json:caption_style.active_word_color`)
7. **Soft SFX punch on reveal beat** (per `sfx_guide.md`)

NOT proposed by default:
- B-roll cutaways (breaks single-take depth-coach mood for mentor archetypes)
- Aggressive transitions/wipes
- Big-graphic stat reveals (too commercial for "depth" brands)

---

## How to update this file

After each round of post-production edits in any job, **if the user revealed a new pattern**:
1. Add a numbered section with the pattern + grounding example.
2. Add an entry to [INDEX.md](INDEX.md) pointing to the round.
3. If a pattern is confirmed across multiple jobs, promote it to "Hard rules" at the top.

If a previously-recorded pattern is contradicted by a later edit, EDIT the existing pattern with a "Updated [date]:" note rather than deleting — the contradiction is itself signal.
