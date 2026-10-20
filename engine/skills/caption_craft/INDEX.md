# Caption shipping index

One row per @coachroster caption shipped. Drives [PATTERNS.md](PATTERNS.md) — when an edit reveals a new pattern, add a numbered section there citing this row.

| Date | Job ID | Coach | Template | Platform | Caption file | What got edited from draft |
|---|---|---|---|---|---|---|
| _(empty — first shipped caption goes here)_ | | | | | | |

## How to read this

- **Date** — the day the post went live on @coachroster
- **Job ID** — `agent/output/<job-id>/`
- **Coach** — short handle (e.g., "Jenny Evans")
- **Template** — which of T1-T10 from [PATTERNS.md](PATTERNS.md) §8 was used. If a hybrid, write e.g. `T1+T7`.
- **Platform** — `tiktok` / `instagram` / `both` (when different captions per platform)
- **Caption file** — link to `<job_dir>/captions/v<N>.md` (the final shipped version)
- **What got edited from draft** — concise diff between agent draft and what the user shipped. This is the column that feeds future patterns in PATTERNS.md.

## When you update this file

After every shipped post:
1. Add a row above. Keep newest-first chronologically.
2. If the **What got edited** column reveals a recurring user preference (e.g., "user always replaces 'Go find' with 'Find them via' → noticed 3x now"), add or update a numbered section in [PATTERNS.md](PATTERNS.md).
3. If the corpus would benefit from a new EXAMPLES.md entry under that template archetype, add it.

## Cross-references

- Per-job caption history: `agent/output/<job-id>/captions/` — `draft.md` (agent's first pass) → `v1.md`, `v2.md`, ... (each iteration)
- Companion patterns: `agent/skills/user_script_voice/INDEX.md` (the spoken-script equivalent of this file)
