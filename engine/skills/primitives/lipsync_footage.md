# lipsync_footage — real-footage lipsync, on-camera windows only (the A-roll path)

Turns real recorded footage + a clean, densified audio track into tight, lipsynced talking-head
segments — but **only over the windows where the performer is actually on camera**. Never the full
reel. The **real-footage performer path** — not for synthetic avatars (→ `perform_avatar`).

**Canonical backend: fal sync-3 (`fal-ai/sync-lipsync/v3`) via `tools/lipsync_footage.py` (absorbed the old aroll.py backend).** Per
Joseph's STANDING RULE, sync-3 is the only lip-sync model to ever use. It is user-praised ("much
better than the previous lipsync"). Two subcommands: `plan` (compute on-camera windows) → `gen`
(lipsync each window with sync-3). Cost is metered only over the on-camera
seconds, not the full reel; the gateway supplies the authoritative price.

> **History note:** the authority-host / Coaching Gems episode pipeline historically ran fal
> `sync/lipsync-2-pro` (the old `lipsync_run.py` path). That model is **retired** — Joseph
> rejected it ("much better than the previous lipsync model" referring to sync-3). The canonical
> path going forward, for every job including long-form episodes, is **fal sync-3 via
> `aroll.py`**. Do not reach for lipsync-2-pro / Replicate sync as the primary; if sync-3 is
> unavailable, flag for a human re-attempt rather than falling back.

```
# 1. plan — merge contiguous on-camera beats into lip-sync windows and verify coverage
uv run python tools/lipsync_footage.py plan --job <job>

# 2. gen — lipsync ONLY those windows with fal sync-3, every window submitted at once
uv run --with fal-client python tools/lipsync_footage.py gen --job <job> [--force] [--parallel 4]
```

**The windowed-lipsync move (formerly a molecule — it lives here now, it's ONE tool):**
`beats.json → plan → gen` gives you duration-checked, per-window sync: plan is
free and prints the metered seconds—confirm they match the intended on-camera%
before generation. If cost information is requested, those exact seconds belong
in the optional gateway quote. The current host decides authorization at the
paid-operation boundary; the engine adds no separate financial prerequisite.
Proven on two a-roll reel rebuilds. Gotcha: feed RAW base footage, never an
already-synced clip.

`--job` is always required on both subcommands (MEMORY: concurrent jobs clobber `.current_job` —
`feedback_always_pass_job.md`). `--force` re-renders windows whose output already exists.
Everything lives in the job directory (`jobs/<job>/`), never the engine folder.

**Prerequisite — the beat spec.** `plan`/`gen` read `jobs/<job>/edit/beats.json`:

```json
{ "fps": 24, "duration": 64.74, "base": "02_base_segment.mp4",
  "beats": [ {"name":"b3","start":10.0,"end":15.96,"mode":"split","on_camera":true} ] }
```

- `mode`: `"split"` (top B-roll + your face in the bottom band) or `"full"` (full-frame you, or a
  B-roll hijack with no face).
- `on_camera`: is the performer's face on screen this beat? `split` beats are ALWAYS `on_camera:true`.
  `full` beats: `true` = full-frame you, `false` = B-roll hijack (no face). Only `on_camera:true`
  beats become lip-sync windows.

It also expects the densified audio at `jobs/<job>/edit/audio_densified.mp3` (MEMORY:
`feedback_densify_pipeline.md` — densify runs upstream of this tool) and the base take at
`jobs/<job>/<base>`.

---

## `plan` — compute on-camera windows (always run this first)

- **purpose:** merge contiguous `on_camera:true` beats into lip-sync windows, print the window list
  with per-window timecodes / framing (`band` / `full` / `band+full`), total a-roll seconds,
  on-camera %, and the metered duration for gateway pricing. Verifies every on-camera beat lands in exactly one
  window. Writes `jobs/<job>/edit/aroll_windows.json`.
- **use_when:** before any `gen` run, and any time `beats.json` changes — `gen` recomputes windows
  from the spec, so `plan` is your dry-run + coverage check.
- **do_not_use_when:** there is no `beats.json` yet (author the beat spec first); the segment is a
  synthetic avatar (→ `perform_avatar`).
- **inputs:** `--job <job>` → reads `edit/beats.json`.
- **outputs:** `jobs/<job>/edit/aroll_windows.json` (job, base, windows, report). Stdout shows
  each window `wN: start–end (dur) beats=… framing=…`, the totals line, and a coverage check
  (`✓ all N on-camera beats covered` or `⚠ NOT COVERED: [...]`).
- **success_check:** coverage line reads `✓` (no missing beats); on-camera % is in the target
  ~40–60% band; metered seconds match the intended creative scope.
- **backend:** none — pure planning over `beats.json` (no API call, no cost).

---

## `gen` — lipsync each window with fal sync-3

- **purpose:** for every on-camera window: slice `audio_densified.mp3[start:end]` (→ pcm_s16le wav)
  + the matching `base[start:end]` (silent x264), upload both to fal, call
  `fal-ai/sync-lipsync/v3` with `sync_mode: "cut_off"`, download the result, apply the warm
  matching grade, and crop the face band. One sync-3 call per window — incl. each hook. Never the
  full reel. All windows are submitted together (`--parallel`, default 4), so a wave takes about
  one window's wall-clock; one failed window never stops the others.
- **use_when:** `plan` shows `✓` coverage and you're ready to render the on-camera footage.
- **do_not_use_when:** `FAL_KEY`/`FAL_API_KEY` is unset; coverage is incomplete (fix `beats.json`
  and re-`plan` first); synthetic avatar (→ `perform_avatar`).
- **inputs:** `--job <job>` · optional `--force` (re-render existing window outputs) · optional
  `--parallel N` (windows in flight, default 4). Reads
  `edit/beats.json`, `edit/audio_densified.mp3`, and `<base>`. Requires `FAL_API_KEY` in `.env`
  (mapped to `FAL_KEY` automatically) and the `fal-client` package (run via
  `uv run --with fal-client`).
- **outputs:** per window into `jobs/<job>/edit/aroll/`:
  - `wN.mp4` — full-frame, graded, lipsynced window clip.
  - `wN_band.mp4` — bottom-band crop `crop=1080:840:0:380` (the split-mode band geometry) for split
    beats. Existing outputs are skipped unless `--force`.
- **success_check:** frame-extract → Read; mouth motion tracks audio on every window; no seam flash
  at window boundaries; grade matches the real source footage (sync-3 reads slightly flat/dark, so
  the built-in `eq=saturation=1.01:contrast=1.02:gamma=1.02` lift corrects it).
- **backend:** **fal sync-3 — `fal-ai/sync-lipsync/v3`, `sync_mode: "cut_off"`** — via
  `tools/lipsync_footage.py`. The gateway meters and prices the on-camera seconds.
- **fallback:** if the sync-3 API is unavailable or a window fails, read its ✗ line: "nothing was
  charged" is safe to retry (`--force`); "accepted by the gateway" must NOT be re-run — recovery
  keeps that paid result. Do **not** fall back to `sync/lipsync-2-pro` / Replicate
  sync — that model is retired per Joseph's standing rule.

---

## NOT this tool

- **`perform_avatar`** — renders a **synthetic** avatar speaking (Seedance + cast stills + VO).
  `lipsync_footage` only handles **real recorded footage**. If the performer is an AI-generated
  character, use `perform_avatar`.
- **`pull_video`** — pulls + cuts + crops external reference videos (yt-dlp). That step
  produces the raw mp4 that becomes the `<base>` take here; it does not lipsync.
- **`densify`** — silence-clip + 1.22× stretch + PASS 2 re-transcribe (MEMORY:
  `feedback_densify_pipeline.md`). Densify runs **before** this tool and produces the
  `audio_densified.mp3` that `gen` consumes. It is not part of the lipsync step.
- **`clean_audio`** — denoises the raw recording. `lipsync_footage` expects a **clean**, densified
  track; run `clean_audio` (then `densify`) upstream.
