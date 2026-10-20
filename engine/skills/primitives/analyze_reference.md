# analyze_reference — understand what you are working from

Single tool, `--mode {video | still_set | hook_bank | outliers}`; the question it answers is
**"what am I working from?"** before any asset is generated. Runs *before* scripting, avatar
casting, or any production step. Folds in three previously separate operations:
`deep_analyze_video.py` (42 calls, 13 sessions — staging/format/mechanism extraction from a
reference video), `search_outliers.py` (33 calls, 14 sessions — transcript-grounded outlier
research via local DB), and Gemini brand-DNA passes (`gemini_pass.py`, `brand_dna_pass.py`,
`gemini_video.py` in brand-audit mode — 85 + 4 + 2 calls). The local DB (psql / manifest) is
the **primary** outlier path; Sandcastles returns metadata only, no transcripts, and must NOT
be used for outlier research (MEMORY: `feedback_local_db_over_sandcastles.md`). Gemini is
**eyes, not taste** — it reports mechanical observations (shot type, pacing, text on screen,
colour) and its quality scores or verdicts must never override the human's call (MEMORY:
`feedback_gemini_no_taste.md`). `--mode` is **required** and logged as `usage_role`.

```
analyze_reference --job <job> --mode <mode> \
    [--reference <mp4|url>]          # video / still_set
    [--channel <handle>]             # hook_bank / outliers
    [--query "..."]                  # outliers: search term(s) for local DB
    [--top-n <int>]                  # hook_bank: how many hooks to surface (default 20)
    [--format-proposal]              # emit a concise nonblocking format summary
```

`--mode` is **required** and logged as `usage_role`. `--format-proposal` makes
the intended staging visible but never creates a human-approval checkpoint.

**To SEE a reference (or any video) yourself, use [`look_at_video`](look_at_video.md)**:
`look_at_video --job <job> reference/ref.mp4` returns 5 fps timeline strips with the
waveform, words, cuts and beats; `look_at_video --job <job> reference/ref.mp4 final.mp4`
stacks the reference over ours, beat-aligned. This tool is the semantic read on top.

---

## `video` — reference video staging + format analysis

- **purpose:** extract the staging, format, and repeating mechanism of ONE reference video so
  production can match or deliberately subvert it: walk-and-talk vs. static talking-head, handheld
  vs. locked, B-roll cadence, caption style, hook structure, pacing.
- **use_when:** you have a specific video to work from — a viral outlier, a sponsor's reference
  clip, a prior episode for consistency. **Always run before locking a production format** (MEMORY:
  `feedback_inspect_visuals_before_format.md`: "Don't silently default to static talking-head").
- **do_not_use_when:** you have no reference video (→ `outliers` mode); you want to audit *your
  own* finished output (→ `verify_output` / `review_output`).
- **inputs:** `--reference <mp4|url>` (local file or yt-dlp-downloadable URL); optional
  `--format-proposal` to emit a nonblocking summary of the proposed format.
- **success_check:** tool returns a structured format card (staging type, shot grammar, caption
  style, hook type, mechanism) + a human-readable format proposal. Production
  may continue without a separate approval. Gemini's quality scores are **discarded**; only
  mechanical observations are surfaced.
- **backend:** `deep_analyze_video.py` (42 calls, 13 sessions) for frame sampling + Gemini
  mechanical pass; yt-dlp to pull remote URLs before analysis.
- **fallback:** if `deep_analyze_video.py` returns a Gemini score/verdict, strip it before
  surfacing — mechanical observations only. If the URL fails yt-dlp, ask the user to download
  the file and pass a local path.
- **evidence:** `deep_analyze_video.py` — 42 calls across 13 sessions. Multiple sessions where
  the agent defaulted to a static talking-head format without inspecting the reference (the
  MEMORY rule was written to close this gap). First-call `--job` missing errors recur → always
  pass `--job`.

---

## `still_set` — carousel or PNG reference extraction

- **purpose:** extract the visual grammar of a carousel or set of PNG stills — slide count,
  colour palette, typography scale, illustration style, information density — so `build_carousel`
  can match the reference layout.
- **use_when:** the production is a carousel and you have reference slides (PNGs, screenshots,
  a competitor carousel).
- **do_not_use_when:** the reference is a video (→ `video` mode); you have no visual reference
  and want data-driven hooks (→ `hook_bank`).
- **inputs:** `--reference <dir|glob>` of PNGs or a single multi-page PDF; returns a style
  brief per slide.
- **success_check:** style brief covers: grid layout, column count, font hierarchy, colour
  count, illustration density. Gemini observations only — no taste calls.
- **backend:** Gemini frame/brand-DNA pass (`gemini` CLI, 32 calls across 5 sessions in
  style-audit use).
- **fallback:** if reference images are low-res, note degraded confidence; still return all
  observable attributes.
- **evidence:** 5309b781 brand-DNA sessions (style audits of top reels via `extract_brand_frames.py`
  + `brand_dna_pass.py`, 4 calls each).

---

## `hook_bank` — channel-wide thumbnail hook extraction

- **purpose:** surface the recurring hook patterns across a creator's channel — thumbnail
  text, first-line hooks, open-loop structures — so the current script can borrow from proven
  formats rather than invent.
- **use_when:** you want to know what hook structures work for a specific creator / brand before
  scripting, not just one reference video.
- **do_not_use_when:** you want transcript-grounded outlier context (→ `outliers`); you have
  one specific video to dissect (→ `video`).
- **inputs:** `--channel <handle>` + optional `--top-n` (default 20). Uses the local DB for
  transcript data; may supplement with Sandcastles for thumbnail metadata ONLY (not for hook
  quality assessment).
- **success_check:** returns a ranked hook-pattern list with frequency counts, verbatim
  examples, and a hook-type taxonomy (curiosity gap / counter-intuitive / promise /
  identity-attack). No quality verdicts from Gemini or Sandcastles.
- **backend:** `search_outliers.py` against local DB (33 calls, 14 sessions); Sandcastles MCP
  for thumbnail metadata only, never for research quality decisions.
- **fallback:** if channel has < 10 indexed videos in local DB, flag low-confidence and
  supplement with a targeted `outliers` query.
- **evidence:** `search_outliers.py` — 33 calls, 14 sessions. Sandcastles rejected for outlier
  research in session 5309b781 ("not returning shit we need", caused poor script quality).

---

## `outliers` — transcript-grounded outlier research

- **purpose:** find real outlier videos in the local DB that are thematically or structurally
  relevant to the current script concept, with full transcript access — so the hook, mechanism,
  and angle can be grounded in what already works, not invented.
- **use_when:** early pre-production (before scripting) and any time you need "what do viral
  videos in this space actually say?". **This is the MEMORY-mandated path** over Sandcastles
  (MEMORY: `feedback_local_db_over_sandcastles.md`).
- **do_not_use_when:** you need a specific video's staging dissected (→ `video`); you want
  channel-wide hook patterns (→ `hook_bank`); Sandcastles is not a substitute here under any
  circumstances.
- **inputs:** `--query "<search terms>"` (topic / keyword / angle); optional `--channel` to
  scope to one creator; optional `--top-n`.
- **success_check:** returns matched video titles + transcript excerpts + view counts.
  Agent surfaces verbatim hook lines and mechanism beats, not summaries. Local DB is the ONLY
  transcript source — Sandcastles results, if returned, are silently discarded.
- **backend:** `search_outliers.py` (33 calls, 14 sessions) via psql / manifest; direct psql
  queries accepted as a fallback for complex joins.
- **fallback:** if local DB returns zero results, widen the query term and retry once; if still
  empty, surface the gap and ask the user to seed the DB rather than falling back to Sandcastles.
- **evidence:** `search_outliers.py` — 14 sessions. Sandcastles-for-outliers was the EXPLICIT
  anti-pattern that produced "ass" script quality in 5309b781 (session note verbatim).

---

## NOT this tool

- **`review_output`** — editorial judgement on a *finished* video ("is it good?"). `analyze_reference`
  is pre-production; `review_output` is post-render.
- **`verify_output`** — mechanical post-render check ("is it broken?"). Not a reference step.
- **Sandcastles MCP directly** — returns metadata only (no transcripts); using it for outlier
  research instead of `analyze_reference --mode outliers` is the documented failure mode
  (5309b781). `analyze_reference` is the correct wrapper.
- **`gemini_video.py` directly** — still callable for ad-hoc frame inspection, but any
  quality/taste verdict from it must be ignored. `analyze_reference` enforces the "eyes, not
  taste" contract automatically.
- **`pull_video`** — downloads and cuts external footage as a production asset. If the
  reference URL needs to be downloaded first, `analyze_reference` handles that internally via
  yt-dlp; do not call `pull_video` just to feed a reference into this tool.
