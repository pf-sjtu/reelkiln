# sfx_catalog — rights-cleared common sound effects

Use this authenticated, global read-only catalog before any web search or generation for a
common cue. Discovery and fetch are zero-cost operations.

```bash
uv run python tools/sfx_catalog.py --job <id> --mode search --query "soft click"
uv run python tools/sfx_catalog.py --job <id> --mode fetch --id ui.click.soft --version 1
```

Fetch writes the exact versioned WAV under `<job>/sfx/`, verifies its content hash, and appends
`<job>/sfx/catalog-provenance.json`. The run log retains only stable ID, version, hash, outcome
and job destination. It never retains the session Bearer capability or the short-lived signed
storage URL.

Design and mixing manifests should name the stable identity, for example
`catalog:ui.click.soft@1`; `score_bed` resolves that identity only after it has been fetched and
recorded in the job provenance manifest. It never substitutes another cue.

If search returns no fit, the catalog is unavailable, or an exact fetch fails: omit the cue or
ask the user. Do not silently scrape the web, use a public URL, or generate a replacement.
