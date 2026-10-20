# SFX Guide — catalog first, silence second

Common sound effects come from the authenticated, global VideoClaw catalog. Catalog discovery
and retrieval are zero-cost and retain exact rights/provenance receipts.
The old model-generated shared library is retired; do not search the web, scrape a public CDN,
or generate a replacement when the catalog has no fit.

## Workflow

1. Search by semantic purpose:

   ```bash
   uv run python tools/sfx_catalog.py --job <id> --mode search --query "short whoosh"
   ```

2. Fetch one exact stable identity and version:

   ```bash
   uv run python tools/sfx_catalog.py --job <id> --mode fetch \
     --id transition.whoosh.short --version 1
   ```

3. Reference `catalog:transition.whoosh.short@1` in the design/mixing manifest. The fetched
   WAV lives under `<job>/sfx/`; `catalog-provenance.json` binds the stable ID/version to its
   hash, rights metadata and local destination. `score_bed` validates that receipt before mix.

If discovery is unavailable or returns no suitable cue, default to silence or ask the user to
supply a licensed effect. Never silently choose a different ID, generate, or browse the web.

## Starter semantic palette

The deliberately small initial set covers the common Release 11 paths:

- `ui.click.soft`
- `ui.mouse.tight`
- `office.typing.fast`
- `transition.whoosh.short`
- `impact.light`
- `camera.shutter`
- `ambience.room_tone.neutral`

Search remains authoritative; do not assume an ID exists merely because a brief suggests it.

## Mixing discipline

- 30-second short: usually 1–3 cues.
- 60-second video: usually 2–5 cues.
- Keep dialogue dominant. Use light cues on visual events, not as filler.
- Silence is preferred for hooks, continuous avatar speech and authoritative end cards unless a
  specific visual beat benefits from a cue.
- A room-tone cue is an effect, not licensed music. Music sourcing remains a separate contract.

## Security and reconstruction

The gateway receives the session-scoped Bearer capability. Storage receives only the signed
short-lived asset URL request. Neither value may enter a prompt, exception, manifest or durable
run log. Durable records retain the stable ID, version, content hash, outcome and job-local path,
which is enough to reconstruct the choice without credentials.
