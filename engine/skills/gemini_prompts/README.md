# Gemini prompt library

Markdown templates for every Gemini multimodal call in the pipeline.

**Why this exists.** The old code had prompt strings hardcoded as Python constants
(`DEEP_ANALYSIS_PROMPT`, `CHUNK_REVIEW_PROMPT`). Two problems:
1. **Brittle.** Touching the prompt meant editing Python code, no diff-friendly review.
2. **Inflexible.** No room for the agent to author a richer prompt at call time when
   it has more context than any pre-baked template can encode.

This library fixes both:
- Templates live as markdown files with YAML frontmatter declaring the response shape.
- Tools load templates by name. Adding a new mode = drop a new markdown file, no code change.
- For modes where context-richness justifies it (the `final_review` is the canonical
  example), the agent can override or *compose* the prompt body at call time using the
  template's response-shape contract as the binding promise.

## How `gemini_video.py` uses these

```bash
# Use a template by name:
uv run python agent/tools/gemini_video.py --mode analysis           # → deep_analysis.md
uv run python agent/tools/gemini_video.py --mode chunk_review --chunk 0  # → chunk_review.md
uv run python agent/tools/gemini_video.py --mode final_review       # → final_review.md
uv run python agent/tools/gemini_video.py --mode replication_brief  # → replication_brief.md

# Override the prompt body inline (the response-shape contract from the template
# still applies — useful when you've authored a stronger body for THIS job):
uv run python agent/tools/gemini_video.py --mode analysis \
  --prompt-prefix "Pay particular attention to the use of on-screen drawings."

# Or pass an entirely custom prompt:
uv run python agent/tools/gemini_video.py --mode custom --prompt "..."
```

## Template anatomy

Each `.md` file looks like:

```markdown
---
name: deep_analysis
description: One-line description used in --help and the README.
returns: json                # "json" | "text"
response_shape: |
  Inline JSON skeleton showing the exact keys the response must contain.
  This is what the tool surfaces to the calling code as the contract.
---

# {{ template_name }}

The prompt body. May reference {{ context_block }} placeholders that the tool
fills in at call time.
```

## Templates

| Name | Used by | Purpose |
|---|---|---|
| `deep_analysis.md` | `gemini_video.py --mode analysis` | Reference-video deep dive: virality reasons, hook anatomy, visual breakdown, format, replication guide, production notes. Run on the chosen outlier candidate before writing the script. |
| `replication_brief.md` | `gemini_video.py --mode replication_brief` | Given a deep analysis JSON, return STRUCTURED directives the post-production layer can consume verbatim: caption_style, key_moments with timestamps, hook timing, lower-thirds, cut points. |
| `chunk_review.md` | `gemini_video.py --mode chunk_review` | Per-chunk QA after Seedance generation. Quality + continuity scores 1-10, regeneration verdict, post-production suggestions. |
| `final_review.md` | `gemini_video.py --mode final_review` | Critical comparative review of `final.mp4` against the reference outlier. Verdict: ship / revise / rebuild. |

## When to compose dynamically vs. use the template as-is

**Use as-is** when the call is routine: deep analysis of an unfamiliar candidate,
chunk review of a freshly generated chunk, replication brief from a fresh analysis.

**Compose dynamically** when the agent has rich job context that should inform the
question being asked. The clearest case is `final_review`: by then we have the script,
the chunk reviews, the analysis, the run log, the audience profile from `company.json`.
A pre-baked prompt cannot reference those. The agent should:

1. Load `final_review.md` to get the response shape contract
2. Author a custom body that frames the comparison around the *specific* dimensions
   most likely to fail for this job
3. Pass the custom body via `--prompt` (or `analyse_video()` from code) while keeping
   the response shape from the template

## Adding a new mode

1. Drop `<mode_name>.md` in this directory with frontmatter + body.
2. Add the mode to `gemini_video.py`'s `--mode` choices.
3. Update this README's template table.
4. (Optional) Document when to use it in `agent/CLAUDE.md`.

## Editing a template

Templates are versioned with the repo. Edit freely; the response-shape contract
should be considered *additive* — adding new keys is fine, removing keys breaks
downstream parsers (`replication_brief` consumes `deep_analysis`, etc.).
