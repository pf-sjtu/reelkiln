# Caption Craft — Skill Entry Point

This skill is for drafting captions for **@coachroster** Instagram + TikTok posts. Each post is a 60s video surfacing one counterintuitive insight from a real coach and pointing viewers to that coach's website.

The skill is built on empirical analysis of 322 high-outlier captions across 6 niches and 3 outlier bands (5-10x, 10-25x, 25x+) from our outlier video DB.

---

## Read order

When you sit down to draft a caption for a new post:

1. **[PATTERNS.md](PATTERNS.md)** — the rules + the 10 reusable templates. Single source of truth for what makes a Coach Roster caption work. Read first, every time.
2. **[EXAMPLES.md](EXAMPLES.md)** — verbatim inspiration bank from the corpus, organized by template archetype. Once you've picked a template (T1, T2, T7, etc.), scroll this file's matching section to crib structure / voice / opening move.
3. **[INDEX.md](INDEX.md)** — log of every caption we've shipped on @coachroster, with notes on what worked / what got edited. Skim before drafting to see what we've already used.

## When to use this skill

- **Always**, before publishing any @coachroster post (IG or TikTok).
- When the user asks you to "draft a caption" / "write the caption" / "post-prep this video" for any job in `agent/output/<job-id>/`.
- When updating older posts whose captions were written before this skill existed.

## How to use the tool

The companion tool is at `agent/tools/draft_caption.py`. It gathers the per-job context you need (log line, coach name + URL, signature insight, IVP) and writes a draft scaffold to `<job_dir>/captions/draft.md` with the recommended template variables already filled where it can.

```bash
uv run python agent/tools/draft_caption.py --job <job-id>
```

You (Claude) then read the scaffold, write the actual caption inside it, and surface to the user. The tool does data plumbing; you do the writing — per CLAUDE.md rule 3.

## When to update this skill

- **PATTERNS.md** — when a new caption pattern emerges from real shipped @coachroster posts (e.g., "the user prefers asterisk-emphasis on the brand-drop word"). Add a numbered section with a grounded example + date.
- **EXAMPLES.md** — when you stumble on a verbatim high-outlier caption in the corpus that exemplifies an archetype better than what's already there. Replace, don't accumulate — keep each archetype's bank at ≤8 examples.
- **INDEX.md** — after every shipped @coachroster post, add a row (date, job ID, template used, what got edited from the draft).

## The reference outlier's caption is a same-video data point

Every job has a reference outlier (the high-performing video being adapted). Its own caption — the one the original creator shipped — is the closest analog we have for what caption shape pairs with this video shape. `draft_caption.py` auto-surfaces it in the brief (§3.5), pulled from `candidates.json` by URL-match.

It's a structural read, NOT a copy template — Coach Roster writes in third-person endorser voice, the original is almost always first-person by the coach themselves. See PATTERNS.md §0.5.

## Hard rules (the four that matter most)

These are derived from the empirical findings in PATTERNS.md but worth stating up-front so you don't need to re-read:

1. **Opener is a 4-7 word declarative claim. No preamble.** *"Never apologize for cost."* not *"Let me tell you about..."*
2. **Visible structure beats word count.** Line breaks every 6-12 words. Don't paste a wall of text.
3. **Hashtags: 0-5, footer-stacked. No inline.** Don't exceed 5.
4. **The CTA sends people OUT to the coach's website.** Never *"Comment WORD for the DM."* Always *"Go find [Coach] → [website]."*

If a draft you're producing breaks any of these, stop and re-read the relevant section of PATTERNS.md.
