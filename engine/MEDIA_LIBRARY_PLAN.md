# MEDIA_LIBRARY_PLAN.md — the asset/footage retrieval system

**Status:** design, not yet built. Approved decisions are marked ✅; open forks are marked ❓.
**Owner:** Joseph Chin. **Seed:** [`ssrajadh/sentrysearch`](https://github.com/ssrajadh/sentrysearch).

This is the plan for videoclaw's **premier footage-retrieval method** — the thing that
stores a tenant's *real* footage and stills and lets an agent find the right clip/frame by
describing it. It is the source we expect to use **most often**, ahead of generation.

---

## 1. Why this exists

Today `pull_video` and `fetch_asset` each take exactly **one source: a URL you already
know** (see [`CANONICAL_TOOLS.md`](CANONICAL_TOOLS.md)). They are dumb on *discovery* — they
never *find* an asset. There is no index of the tenant's own media, no semantic search, no
"use a real clip as a generation reference."

This system turns "get me an asset matching X" into a **search-then-acquire** router over
several sources, in priority order, falling back to generation only when nothing real fits.

### The 4 sources + priority ✅
1. **My library** — the tenant's own indexed footage/stills. *Always preferred* (free,
   on-brand, already theirs).
2. **Shared library** — a curated "good options" collection, reusable across tenants.
   *(Doesn't exist yet — starts empty, populated over time. Same machinery as #1.)*
3. **Web capture** — screenshot / screen-record from the live web. *Tied with shared;
   situational.* ✅ **Must be standalone (Playwright/headless), NOT Chrome MCP** — it has to
   run inside JC's future Mac app independent of Claude Code.
4. **Stock + generation** — license-free stock APIs, and `mint_image`/`mint_video`. *Tied;
   situational — a throwaway B-roll beat can be stock, a hero/core beat must be on-brand
   (decided by QA).*

Priority order ✅: **mine → (shared ≈ web-capture) → (stock ≈ generate)**. Quality/brand-fit
can override "free" for core beats — that judgement is the QA's, not the router's.

**Key consolidation:** #1 and #2 are the *same machine* — one indexed-media-library
primitive scoped by collection (`mine` vs `shared`). #2 being empty today is fine; the
moment #1 is built, #2 is just another (initially empty) collection. Eventually `shared`
becomes a remote endpoint (so a future Mac-app download stays small) while `mine` stays
local — the interface does not change.

---

## 2. Architecture decisions

### 2.1 Embedding: native multimodal ✅ (with a prove-it gate)
We embed **raw video/image pixels natively** into the shared text/image/video vector space
(Gemini Embedding 2 or local Qwen3-VL) — **no caption-then-embed-text middleman.**

- A **text** query, an **image** query, and the indexed **video chunks** are all directly
  comparable vectors in one space (cosine similarity). This is confirmed in the
  sentrysearch design and is why image-as-query works.
- **Provider:** the Google GenAI SDK `gemini-embedding-2` (3072-dim, truncated to 768 via
  `output_dimensionality`), routed through JC's **Vertex AI / GCP project**
  (`GOOGLE_GENAI_USE_VERTEXAI=true` + project + service-account ADC). **OpenRouter is ruled
  out** — its `/embeddings` route is text-only (empirically proven: all multimodal payload
  shapes 400 with "expected string"; passing base64 as a string returns a vector but it
  embeds the base64 *text* — two different videos scored 0.984). OpenRouter video multimodal
  exists only on `/chat/completions` (→ text), never on `/embeddings`.
- **Why native over caption→embed:** caption-then-embed makes the whole index hostage to
  the description prompt — any change to how we describe footage forces a full, expensive
  re-index. Native embedding is robust to that and cheaper. JC's call, and the right one.
- **Trade-off we accept:** native embeddings are opaque (you can't read *why* something
  matched). We mitigate per §2.5 (an *optional, lazy* description only where a human needs
  to read or where the gen-reference bridge needs prompt text — never on the hot path).
- ❓ **Prove-it gate (Phase 1):** before building anything around it, index ~20 min of JC's
  real footage, run ~10 real queries, eyeball recall against the 0.41 confidence threshold.
  If native recall is good enough on *real* footage → lock it. If weak → revisit. We do not
  guess "good enough"; we measure it once.

### 2.2 Chunking: fixed-window first, semantic later ✅
- **v1:** fixed overlapping windows (sentrysearch default ≈ 30s chunk / 5s overlap). Proven,
  and good enough for long static shots (desk talking-head). Still-frame skipping on.
- **v2 (deferred):** shot/scene-boundary ("semantic") chunking — mature tooling
  (PySceneDetect / ffmpeg `select='gt(scene,N)'`; `opencv` is already a dep). Earns its keep
  on multi-scene footage (montages, screen-recordings, b-roll reels), less so on static
  talking-heads. **Build it only after Phase 1 shows where fixed windows actually fail.**
  The chunker is a swap-in; everything downstream is chunk-shape-agnostic.

### 2.3 Storage: flat JSONL is truth, vector DB is a rebuildable cache ✅
- **`*.jsonl` = committed source of truth.** One line per chunk/still — human-readable,
  diffable, travels with the tenant, honored in perpetuity. Holds the pointer + metadata
  (+ embedding vector so the cache can rebuild offline without re-calling the embedder).
- **ChromaDB = derived cache, gitignored, rebuildable** from the JSONL via a `reindex`
  command. Disposable; never the source of truth. (Chroma's binary HNSW index is a bad git
  citizen — keep it out of version control.)
- **Pointers, not bytes** ✅ — the index stores `{source_file, in, out, ...}`; the actual
  clip is only trimmed out of the original on a search hit. Footage lives wherever it lives;
  the source-of-truth for *where* is undecided and **does not block this** (the index points
  at a path; local-folder vs bucket is a later concern).

### 2.4 Layout — `assets/<tenant>/` (separate from taste) ✅
Taste = *how to make it* (rules/style). Assets = *what we have to make it with* (inventory).
Both per-tenant, kept as siblings:

```
assets/
  <tenant>/                  ← "mine": this client's real footage/stills (premier source)
    video.jsonl              ← FLAT truth: {id, source_file, in, out, embedding, desc?, usage_role?}   [committed]
    image.jsonl              ← FLAT truth for stills                                                    [committed]
    style_sources/           ← confirmed style-reference images + style.md description                 [committed]
    .index/                  ← ChromaDB vector cache, rebuilt from *.jsonl                              [GITIGNORED]
  _shared/                   ← "shared" curated library (later: remote-backed)                          [committed]
taste/packs/<tenant>/        ← UNCHANGED brand brain + a new COMMITMENTS block referencing assets/<tenant>/
```

`.gitignore` adds `assets/*/.index/`. The taste pack *references* the asset index; it never
duplicates it.

### 2.5 The gen-reference bridge + commitment (the load-bearing part) ❗
Goal: without LoRA/fine-tuning, condition generation on the tenant's own visual style, and
**commit to it across all future sessions** — but only with the user's explicit opt-in, and
transparently (no silent "everything is now clay stop-motion").

Flow:
1. User selects/generates a set of images they like.
2. We **ASK**: "Is this representative of your style? If yes I'll use it as a style source
   for future generations." — opt-in, like the caption-preset rule (no silent default).
3. On **yes** → write the refs to `assets/<tenant>/style_sources/` + a short `style.md`
   (Gemini-derived style description), and add a `style_source` line to the tenant pack's
   COMMITMENTS block.
4. Forever after: the SessionStart hook injects the COMMITMENTS (see §3), so every new
   agent honors it; `mint_image`/`mint_video` pass the refs as `--reference` (those tools
   already accept reference stills); the QA style-consistency pass grounds against them.

---

## 3. The commitment-hook fix (diagnosed bug)

**Symptom:** a new session "didn't pick up" a tenant commitment.
**Cause:** `/.claude/hooks/preflight.sh` injects only a *pointer* — it prints the static
4-layer block then lists `- taste/packs/<tenant>/README.md`. A fresh agent sees *"a pack
exists,"* not its contents, and won't read it unless it's already producing. And there is no
commitments section in the pack to read anyway. **A pointer is not a commitment.**

**Fix:**
1. Add a machine-readable **`## COMMITMENTS`** block to `taste/packs/<tenant>/README.md`
   (style sources, locked retrieval prefs, any "always do X" the user has confirmed).
2. Make `preflight.sh` **cat that block into context** at session start (not just the path)
   — so it is genuinely unskippable, the way the QA Stop-hook is unskippable.
3. Capture-to-commit: any confirmed commitment (style source, locked choice) is written to
   the block in the same turn the user confirms it (taste-capture protocol, but *enforced*).

This is what makes "any new agent will definitely honor it" true instead of hoped-for.

---

## 4. Tool surface

- **`index_media`** (new) — `--mode {video|image}`, `--collection {mine|shared}`,
  `--tenant <t>`. Chunk → embed → append to `*.jsonl` → upsert into `.index/`. Plus
  `reindex` (rebuild cache from JSONL) and `stats`/`remove`.
- **`search_media`** (new, or a `--search` mode on the acquire tools) — text/image query →
  ranked hits `{source, file, in, out, score, why}` → trims the clip/crops the still into
  the job. Honors the §1 priority order across collections + fallbacks.
- **`pull_video` / `fetch_asset`** — gain a "search the library first" path; generation
  becomes the documented *last* resort. Update both primitive docs + `CANONICAL_TOOLS.md` so
  this is the documented premier retrieval path.

What we vendor from sentrysearch: `chunker.py`, `store.py` (ChromaDB), the embedder
abstraction (`base_embedder` + `gemini_embedder`/`local_embedder`), `search.py`. We adapt:
`db_path` → `assets/<tenant>/.index/`; add the JSONL truth layer; add collections; rename
the dashcam-specific bits.

---

## 5. Phased build (each phase has a gate)

| Phase | What | Gate |
|---|---|---|
| **1. Prove the embedder** | ✅ DONE (2026-06-29): indexed 6 real clips via Vertex `gemini-embedding-2`; live queries rank correctly (b-roll query → b-roll clip #1; talking-head query → talking-heads; absent "dog on beach" → all ~0.26, flagged). | ✅ PASS. Finding: text→video cosine runs ~0.33–0.38 for good matches; default threshold recalibrated 0.41→0.30; trust relative ranking. |
| **2. Truth + cache** | `*.jsonl` committed truth; `.index/` gitignored; `reindex` rebuilds from JSONL. | JSONL round-trips; cache rebuilds with no re-embed. |
| **3. Wire into toolset** | `index_media` + `search_media`; library-first path in acquire/fetch; docs + `CANONICAL_TOOLS.md`. | An agent can find a real clip by description, job-scoped. |
| **4. Commitment + style bridge** | COMMITMENTS block; `preflight.sh` injects it; opt-in style-source capture → `--reference` into mint tools. | A new session provably honors a committed style source. |
| **5. (deferred) Semantic chunking** | Shot-detection chunker as a swap-in. | Only built if Phase 1 shows fixed windows failing. |

---

## 6. Open questions ❓
- Native-embed "good enough?" → answered empirically in Phase 1.
- Library source-of-truth for the *bytes* (local folder vs bucket) — deferred; index stores
  a pointer either way.
- Shared collection: local copy vs remote endpoint — deferred to the Mac-app stage; same
  interface.
- Web-capture quality (Chrome MCP resolution/fidelity) — to be judged from a live demo
  before we count it as a real source vs a fallback.

---

## 6b. Cloud config (don't get lost in GCP land)
- **GCP project:** `<your-gcp-project>` · **location:** `global` · model `gemini-embedding-2`.
- **Auth:** gcloud Application Default Credentials (`gcloud auth application-default login`) —
  no service-account key file in use. Env lives in `.env` (`GOOGLE_GENAI_USE_VERTEXAI=true`,
  `GOOGLE_CLOUD_PROJECT=<your-gcp-project>`, `GOOGLE_CLOUD_LOCATION=global`).
- If a fresh machine/CI lacks ADC: re-run `gcloud auth application-default login`, or add a
  service-account key + `GOOGLE_APPLICATION_CREDENTIALS`. If the model 404s on plain Vertex,
  set `GOOGLE_GENAI_ENTERPRISE=true`.

## 7. Related
- Seed repo: [`ssrajadh/sentrysearch`](https://github.com/ssrajadh/sentrysearch) (ChromaDB +
  native video embeddings + auto-trim; fixed-window chunking; mine/shared = collections).
- Taste hierarchy + capture protocol: [`taste/HOW_TASTE_WORKS.md`](taste/HOW_TASTE_WORKS.md).
- Hooks: [`.claude/hooks/preflight.sh`](.claude/hooks/preflight.sh) (SessionStart),
  `tools/qa_gate.py` (Stop).
- Tools this extends: [`CANONICAL_TOOLS.md`](CANONICAL_TOOLS.md) (`pull_video`,
  `fetch_asset`, `mint_image`, `mint_video`).
</content>
</invoke>
