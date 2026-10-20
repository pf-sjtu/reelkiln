# VideoClaw

The canonical cross-repository product and platform direction is
[`SPEC.md`](SPEC.md). Cross-surface release testing and investigation follow
[`FLIGHT_TESTING.md`](FLIGHT_TESTING.md). The model and agent evaluation system is
defined in [`docs/VIDEOCLAW_BENCH.md`](docs/VIDEOCLAW_BENCH.md), and engineering
work across the engine, app, and backend follows
[`docs/WORK_TRACKING_CONTRACT.md`](docs/WORK_TRACKING_CONTRACT.md).

An agentic short-form video engine: **idea / footage / text → finished vertical short**, driven by
a small set of **canonical tools**, written **workflows**, loadable **taste**, and per-brand
**tenant packs**. Designed to be driven by an agent (Claude Code) — the operating rules live in
[`CLAUDE.md`](CLAUDE.md), auto-loaded each session.

---

## Quickstart

**Prerequisites** (install once):
- [`uv`](https://docs.astral.sh/uv/) — `curl -LsSf https://astral.sh/uv/install.sh | sh`. It installs the exact Python pinned in `.python-version`.
- **Node 18+** with npm — for the Remotion caption/overlay compositor
- **ffmpeg** — `brew install ffmpeg` (macOS) / `apt install ffmpeg` (Linux). Used everywhere for cut/crop/composite.

**Setup** (≈2 minutes):
```bash
git clone <this-repo> && cd videoclaw
uv sync                          # Python deps (yt-dlp, opencv, replicate, elevenlabs, fal, … — all pinned)
(cd remotion && npm install)     # Remotion toolchain (captions/overlays)
cp .env.example .env             # then fill in the 4 REQUIRED keys — see .env.example
```

**Smoke test** (no API spend — just proves the toolchain resolves):
```bash
uv run python tools/sam3.py --help
uv run python tools/review_output.py --help
```

That's it. Every tool runs from the repo root as `uv run python tools/<tool>.py --job <id>`
(`--job` is always required — concurrent jobs must not clobber each other).

**API keys:** only **4 are required** (`REPLICATE_API_TOKEN`, `ELEVENLABS_API_KEY`, `FAL_API_KEY`,
`OPENROUTER_API_KEY`) — the rest in `.env.example` are optional per-feature (media-library
embeddings, outlier DB, social posting). See [`.env.example`](.env.example).

**Gateway URL:** with `VIDEOCLAW_API_KEY` set, paid calls route through the videoclaw gateway
(prod by default). Override the target with `VIDEOCLAW_GATEWAY_URL` (the old `VIDEOCLAW_GW_URL`
is a deprecated alias). To run the whole engine against **staging**, point `VIDEOCLAW_GATEWAY_URL`
at the staging gateway plus a staging-minted key — see [`.env.example`](.env.example).

---

## What it makes

Two proven **"source → shorts"** families (each is a generic spine that wears a tenant brand):
- [`workflows/longform-to-shorts.md`](workflows/longform-to-shorts.md) — a long video/talk → vertical hook shorts (cut, SAM3-reframe, densify, caption).
- [`workflows/article-to-shorts.md`](workflows/article-to-shorts.md) — an article/newsletter → a short with a generated avatar (corner-PIP or a cinematic stylized explainer).

Plus talking-head reels, avatar speakers, faceless B-roll+VO, carousels — see [`workflows/`](workflows/).

---

## Architecture — four layers (resolve top-down; brand wins on conflict)

| dir | layer | what |
|---|---|---|
| [`tools/`](tools/) | **L1** | the canonical executable primitives, one per job-to-be-done — backends hidden. Index: [`CANONICAL_TOOLS.md`](CANONICAL_TOOLS.md) |
| [`workflows/`](workflows/) | **L2** | written work-plans that chain tools into a good-by-default video |
| [`skills/`](skills/) | **L3** | generic taste + method knowledge (b-roll styles, caption presets, the QA method) |
| [`taste/packs/`](taste/packs/) | **L4** | per-tenant LOCKED brand choices (fonts, captions, looks) — e.g. `josephchin`, `khailee_ng` |
| [`remotion/`](remotion/) | — | the shared React/Remotion compositor (captions + overlays → final mp4) |

**Finished renders are drafts, never gated.** A render is a complete draft the
moment it is written, and nothing holds a turn open. After the final render the
agent is strongly recommended to run `review_render` once: a free, silent look that
names at most three serious problems to fix once before presenting, or says there is
nothing to fix. It is never required. [`skills/video_qa.md`](skills/video_qa.md)
documents how the underlying review works ("Gemini is EYES, not TASTE").

## Claude Code hooks (travel with the repo)
[`.claude/settings.json`](.claude/settings.json) is committed, so whoever opens this repo in
Claude Code gets the same automation, using `$VIDEOCLAW_ENGINE` in the shipped
engine/workspace split and `$CLAUDE_PROJECT_DIR` in a source checkout:
- **SessionStart** → `.claude/hooks/preflight.sh` injects the layer/taste architecture.
- **PreToolUse (Bash)** → `.claude/hooks/production_guard.py` requires a current
  `prepare_production` route receipt before canonical production media actions.
- **Stop** → `tools/qa_gate.py --hook` always lets the turn end and only records
  the session-marker trace.

(They fire only inside Claude Code with the Python deps installed; they're inert for a plain `git`/CLI user.)

### Host-neutral authorization

The engine does not require Electron or an app button. Native Claude Code and
other terminal hosts can route, confirm, lock, and run zero-dollar production
without app state. Creative route receipts remain separate from host-owned
spending policy.

Paid canonical operations require `VIDEOCLAW_API_KEY` so the gateway remains the
final spending authority. If the credential has no sufficient server-side
ceiling, the operation fails with a machine-readable
`videoclaw.authorization-required/v1` result. Its alternatives distinguish work
still in flight, a lower-cost scope, and supplying authorization. Local editing,
rendering, retrieval, and other zero-dollar work are unaffected.

---

## Where to start
- **Pick a tool** → [`CANONICAL_TOOLS.md`](CANONICAL_TOOLS.md)
- **Make a video** → [`workflows/`](workflows/)
- **How it all fits** → [`taste/HOW_TASTE_WORKS.md`](taste/HOW_TASTE_WORKS.md) + [`CLAUDE.md`](CLAUDE.md)
