# index_media — the premier footage/still retrieval method

**Reach for this FIRST.** Before you pull a URL (`pull_video`), fetch an external
still (`fetch_asset`), or *generate* anything (`mint_image`/`mint_video`), check whether the
tenant already has the real thing in their media library. Their own footage is free,
on-brand, and irreproducible — it should be the default source.

Indexes a tenant's real media into a per-tenant, semantically-searchable library, then
finds the right clip/frame by **describing it in words** (or with a reference image), and
materializes the hit into your job. Seeded from `ssrajadh/sentrysearch` (Apache-2.0).
Engine: [`tools/_media/`](../../tools/_media/). Full design: [`MEDIA_LIBRARY_PLAN.md`](../../MEDIA_LIBRARY_PLAN.md).

```
uv run python tools/index_media.py <index|search|img|reindex|stats|remove|remove-source|reset> ...
  --tenant <slug>            REQUIRED (no default scope). search/img take ONE OR MORE
                             slugs; index/sync/etc take exactly one. Omitted → exit 2
                             before any embedding call (only --collection shared skips it).

uv run python tools/index_media.py search "him typing at his desk" --tenant <slug> --job <id>
  --collection {mine|shared} mine=assets/<tenant>/ (default) · shared=assets/_shared/
  --backend {gemini|dummy|local}   gemini (default, needs GEMINI_API_KEY) · dummy (plumbing test) · local (deferred)
```

## Scope is explicit — always (do not violate)
- **`--tenant` is mandatory.** An omitted scope is a **hard error** (exit 2), never a
  silent search across every tenant's footage. Cross-tenant reach must be a positive,
  deliberate act — you can only ever *narrow* to the tenant(s) you name.
- **`search`/`img` accept one OR MORE tenants** (`--tenant a b c`). One tenant is the
  norm; multiple merges their libraries and ranks them as one comparable space (same
  embedding model → scores are directly comparable). Union is rare — name a single
  tenant unless the caller explicitly wants to reach across.
- **`--json`** on `search`/`img` emits a JSON array of hits (`tenant, source_file, in,
  out, score, desc`) for programmatic callers (the app's library browser).

## Design law (do not violate — see the plan)
- **`assets/<tenant>/{video,image}.jsonl` is the SOURCE OF TRUTH** (committed, diffable).
  The ChromaDB `.index/` is a **derived cache** (gitignored) — rebuild it with `reindex`,
  never hand-edit it.
- **Pointers, not bytes.** A record stores `{source_file, in, out}`; the clip is only cut on
  a hit. Footage stays wherever it lives.
- **Native multimodal embeddings** — a text query, an image query, and the indexed video
  chunks are all directly comparable in one vector space (no caption middleman).

## Sources, sync, dedup (the day-to-day loop)
- **Register a folder once:** `add-source --tenant <t> --path <folder> [--type all|video|image]`
  (default `all` = index both video AND stills in that folder). Multi-tenant: each tenant's
  sources live in `assets/<tenant>/sources.json`.
- **Add footage anytime:** drop files in the folder → `sync --tenant <t>`. Idempotent; only
  new files get embedded.
- **Deregister a folder:** `remove-source --tenant <t> --path <folder>` matches the EXACT
  registered path (never a substring — `/x/Footage` leaves `/x/Footage-old` alone) and takes it
  out of `sources.json`, so `sync` stops re-indexing it. Indexed records are RETAINED by
  default; `--purge` also drops that source's records and rebuilds the cache — but never a
  record another registered source still covers, so purging `/x/A` leaves the records of a
  separately registered `/x/A/Child` intact. Idempotent (an unregistered path exits 0 and
  reports nothing changed — `--purge` on an unregistered ancestor is ignored, never a prefix
  delete) and `--json` for app callers.
  `--json` reports `outcome`: `removed`, `not-registered`, `partial`, or `blocked` — `partial`
  means the registry and truth changed but the cache rebuild did not finish. Re-run the SAME
  command to finish it (`recoverable: true`); the tool journals the in-flight removal so the
  retry is safe. A collection holds ONE such journal, so while another source's removal is
  unfinished this reports `outcome: blocked` with `pendingPath` and a `warning` naming the
  command that finishes it, rather than overwriting the recovery state that removal needs —
  finish (or re-register) that source first. Like every other outcome it exits 0: read
  `outcome`, never the exit code.
- **Mutations are serialized:** `index`/`sync`/`add-source`/`remove`/`remove-source`/`reset`
  share one cross-process lock per collection, so a removal WAITS for an index run that already
  accepted a source instead of deleting records that run is still appending. Accepted work is
  never cancelled. `VIDEOCLAW_MEDIA_LOCK_TIMEOUT` bounds the wait (default 1800s).
- **Dedup is automatic:** a file whose content matches one already indexed (same bytes, any
  name) is skipped via a fast content signature — no wasted embeds, no duplicate hits.
- **Images are native:** HEIC/HEIF/WEBP/GIF are auto-converted to JPEG and downscaled before
  embedding (Vertex accepts PNG/JPEG only); `._*` macOS sidecars are ignored.

## `index` — add media to the library
- **purpose:** chunk + embed a tenant's footage (or stills) into their library.
- **use_when:** the tenant hands over raw footage / a stills folder; or you just produced
  reusable real media worth keeping. Run once per new media; re-runs skip what's indexed.
- **video:** fixed 30s/5s-overlap chunks (v1; semantic chunking is a deferred v2), still
  frames skipped by default (`--no-skip-still` to keep them), downscaled before embed
  (`--no-preprocess` to send raw).
- **image:** `--type image` — one embedding per still.
- **outputs:** appends to `<tenant>/{video,image}.jsonl` (with the embedding vector, so the
  cache rebuilds offline) and upserts the `.index/` cache.

## `search` / `img` — find and materialize a hit
- **purpose:** text (or reference-image) query → ranked hits → trims the best into your job.
- **use_when:** you need a real clip/still for a beat ("him at his desk", "the coffee
  pour", "terminal scrolling").
- **inputs:** the query; `--tenant <slug> [<slug> ...]` (required scope); `--job <id>` to
  deposit into the job's `footage/` (video) or `images/` (still) — otherwise lands in the
  winning hit's `assets/<tenant>/.clips/`; `-n`, `--save-top N`, `--dedupe 0.9`,
  `--threshold 0.41` (low-confidence warning), `--no-trim` to only list, `--json` for
  structured output.
- **success_check:** Read/inspect the trimmed clip — confirm the hit actually matches the
  description (embeddings surface *visually similar*, not guaranteed-correct; low score ⇒
  re-check or fall to the next source).

## Reading results (observed on JC's real library, 2026-06-29)
- **The absolute score is a "do I even have this?" signal.** When a query has a true match,
  the top score sits ~0.36–0.40. A query for content that ISN'T in the library
  (*"walking outside"* — JC has no walking footage) topped out at **0.34** and returned the
  nearest scene match (a head-to-toe *seated* cafe shot). That lower score was the system
  correctly saying "closest thing I have," not a confident hit. So: **low top score ⇒ verify
  the clip or fall to the next source** (stock/generate).
- **Trust relative ranking**; text→video cosine runs lower than text→text (~0.30–0.40).
- Plausible (but NOT yet verified on this library): these embeddings likely read scene/objects
  more reliably than fine action verbs — if an action is load-bearing, verify the clip. Don't
  treat this as established until we test it against footage that actually contains the action.

## `reindex` / `stats` / `remove` / `reset`
- `reindex` — rebuild the `.index/` cache from the JSONL truth, **no embed calls** (use
  after pulling fresh truth, switching machines, or a corrupt cache).
- `stats` — what's indexed. `remove <substr>` — drop RECORDS by path substring (rebuilds
  cache); it does not touch `sources.json` — use `remove-source` for that.
  `reset --yes` — wipe a collection's truth + cache.

## Priority vs the other sources
`mine → (shared ≈ web-capture) → (stock ≈ generate)`. Prefer the tenant's own library;
fall outward only when it has no fitting asset. For a hero/core beat, brand-fit can override
"free" — that's a creative call.

## NOT this tool
- `pull_video` — pulls an **external URL / local file** you already know. Use it when
  the asset is NOT in the library (a reference video, a specific YouTube clip).
- `fetch_asset` — fetches a **real external still by URL** (logo, headshot, cover).
- `mint_image` / `mint_video` — **generate** when nothing real fits. Last resort.
- The gen-reference bridge (style_sources/) conditions generation on the tenant's own look —
  opt-in, committed to the brand pack; see MEDIA_LIBRARY_PLAN.md §2.5.
</content>
