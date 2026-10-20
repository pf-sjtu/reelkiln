# pull_video — pull, cut, crop, and rip external video

*(Renamed from `acquire_footage` 2026-07-16 — see docs/specs/25-one-pull-surface.md.
`tools/acquire_footage.py` remains a deprecated alias shim through the deprecation
window: same flags, same behavior, same exit codes.)*

Wraps yt-dlp (and local file I/O) to pull external footage and reference videos, cut
sections by timestamp, crop the frame, and rip audio tracks. Folds in: `pull_footage.py`
(23 calls, 2 sessions — the direct yt-dlp section-download wrapper), `download_top.py` (7
calls, 5309b781), `download_all.py` (2 calls, 5309b781), `download_videos.py` (2 calls,
599064e6 + fb6a1a11), `steal_audio.py` (4 calls, 1 session — rip audio from reference
video), and the raw `yt-dlp` CLI (40 calls, many sessions). Known frictions: section-download (`--download-sections`)
throws ERR on bad timestamp range; Instagram URLs hit auth-walls without cookies; long
downloads should be truncated to the needed window to avoid timeouts.

**Gateway-routed when keyed (chunk 25 — one pull surface):** with `VIDEOCLAW_API_KEY`
set, acquisition (`--mode pull`, `--audio-only`, `--mode enumerate`, and the download
half of `select` and `--bed`) POSTs the URL to the gateway's `POST /v1/media/pull`,
which classifies the platform server-side (yt-dlp vs Apify — route choice is
infrastructure, not agent knowledge) and returns the media via signed URL. A direct
`--mode pull` is available before production bootstrap, but the gateway may
select a metered Apify route. Treat acquisition as paid-risk and leave
authorization to the current host/gateway; profile enumeration and semantic
selection remain paid analysis.
Trim/crop/montage/frame-sampling stay
client-side ffmpeg, unchanged. Without a key (the dev path) the tool uses local yt-dlp /
your own `APIFY_TOKEN` exactly as before; a keyed engine talking to an older deployed
gateway without the route falls back to the local path with one log line. A 502/504 —
the SOURCE refused the gateway (e.g. YouTube bot-walls datacenter IPs) — also retries
from the local machine with **this tool's own yt-dlp**, and that is the ONLY second
rung (a failed gateway pull meters nothing, so nothing is bypassed).
Account disable, size, source and throttle failures still surface clearly.

**A refused pull is not permission to reach a vendor (app#840).** When the gateway
and the local retry both fail, acquisition has failed — say so once and ask for a
different link or an uploaded file. Specifically, never:

- call a scraping/downloader vendor's API yourself (`api.apify.com` actor runs and
  the like), with any credential, by any client, in any request shape — a `GET` on
  a run-sync endpoint bills exactly like a `POST`;
- feed a vendor's own output URL back into `--mode pull` or `--file`. A signed
  `api.apify.com` key-value-store record is the product of an actor run the meter
  never saw; pulling it looks like a $0 direct download and is refused by the host;
- describe a substitute route to the user as free, cheap, or costing any amount.
  Prices come from the host's own approval card and spend surfaces, never from you.

Acquisition happens on the metered gateway route, or it does not happen.

Direct pulls retry/resume automatically, then step down to a lighter format before failing.
Sign-in, private/unavailable-video and invalid-link failures stop immediately: ask for
a public downloadable link or an uploaded file; do not keep retrying the same input. `--batch`
(bulk yt-dlp of a picks list) stays local.

```
pull_video --job <job> --mode {pull | select} \
                --url <youtube/ig/url> | --file <local.mp4> \
                [--purpose {reference | footage}] \
                [--in <HH:MM:SS>] [--out <HH:MM:SS>] \
                [--crop <w:h:x:y>] \
                [--audio-only] \
                [--name <output_stem>]
```

**Say what a video pull is for (`--purpose`):**
- `--purpose reference` when the clip is only to watch, analyse, break down, or copy
  the style of. Cheapest (360p).
- `--purpose footage` when the pulled clip itself will appear in the video (720p).
- If unsure, `footage` (the default).

`--mode` is **required** and logged as `usage_role`. `--job` is always passed (MEMORY:
concurrent jobs clobber `.current_job`; every pipeline tool must include `--job` explicitly).

---

## `pull` — download + optional cut/crop

- **purpose:** fetch an external video (or audio) and optionally trim to an in/out window
  and/or crop the frame. The footage-acquisition step before any generation or lipsync work.
- **use_when:** you have a URL or local file and need a clean clip (reference, proof,
  B-roll sample, reaction driver). Also the path for bulk channel downloads (batch mode,
  no `--in`/`--out`).
- **do_not_use_when:** you want generated motion from a still (→ `mint_video --mode insert`);
  you need an external still/logo/headshot (→ `fetch_asset`); the clip is already on disk
  at the right range (just pass it directly to the next tool).
- **inputs:** `--url` or `--file`; `--purpose reference|footage` (above); `--in` / `--out`
  for a section (omit for full download); `--crop` as ffmpeg `w:h:x:y`; `--audio-only`
  to rip just the track.
  `--montage "start-end,start-end"` cuts several windows and joins them in order; each
  time is `HH:MM:SS(.ms)`, `MM:SS` or seconds (`"1:05-1:12,90-95.5"`). The old
  `"a:b"` form still works for bare seconds; a colon window that can't be split
  unambiguously is refused before anything is pulled.
- **paths:** `--file` and `--output` resolve from the working directory, not the job
  folder (e.g. `--file jobs/<job>/footage/source.mp4`); the default output is
  `<job>/footage/<name>.mp4`.
- **success_check:** output mp4 (or m4a) present; ffprobe confirms expected duration
  (±1 s of `out − in`); no black/corrupt frames (frame-extract → Read at least 3 frames).
- **backend:** yt-dlp for remote URLs → ffmpeg for cut/crop. Local files skip yt-dlp.
- **safe framing default:** with `--aspect` and the default `--frame-mode face`,
  the tool samples the whole selected shot and protects the complete detected
  group. It crops around that envelope only when everyone fits with padding. If
  a crop would remove a person, or face detection is uncertain, it keeps the
  full source over a restrained blurred fill. It never stretches footage. The
  exact decision is written beside the output as `<clip>.mp4.framing.json`.
- **runtime:** local acquisition uses the engine's locked Python packages, including
  YouTube challenge scripts, and the app's bundled Node. No personal pyenv or
  system downloader is required; `ACQUIRE_YTDLP_BIN` is only a developer override.
- **fallback:**
  Section-download ERR on bad range → widen `--in`/`--out` by 1 s each side then re-trim.
  IG auth-wall → pass `--cookies-from-browser chrome` or supply a cookies.txt.
- **evidence:** `pull_footage.py` 23 calls (agent/josephchin/tools/); `yt-dlp` 40 calls
  external CLI; section-download ERR documented in super_tools.md §10.

---

## `select` — Gemini timestamp-windowing to choose in/out

- **purpose:** when the right clip window is unknown, feed the full download to Gemini to
  identify the best in/out timestamps (the strongest 5–30 s passage), then cut to that
  window automatically.
- **use_when:** you have a long reference video and want the most relevant passage (proof
  moment, reaction peak, on-topic segment) without manual scrubbing.
- **do_not_use_when:** you already know the in/out (→ `pull --in --out`); the video is
  short enough to use in full; MEMORY: Gemini is eyes not taste — its timestamp picks are
  mechanical (most visually active / speech-dense), never a quality verdict.
- **inputs:** `--url` or `--file`; optionally a `--prompt` describing what to look for
  (e.g. "the moment she shows the transformation result"); `--name` for the output clip.
- **outputs:** one trimmed mp4 at `<job_dir>/footage/<name>.mp4`; a sidecar JSON
  `<name>_select.json` with `{in, out, rationale}` from Gemini.
- **success_check:** sidecar JSON present with numeric timestamps; trimmed clip duration
  matches `out − in`; spot-check the clip frames match the declared rationale.
- **backend:** yt-dlp download → Gemini video API timestamp query (session b186ab52
  established the Gemini timestamp-windowing pattern) → ffmpeg trim.
- **fallback:** if Gemini returns a window outside the video's duration (bad timestamp),
  clamp to `[0, video_duration]` and warn; re-run `pull` mode with corrected range.
- **evidence:** Gemini timestamp-windowing introduced in session b186ab52; Gemini
  mechanical-eyes MEMORY rule (never override human call on quality).

---

## NOT this tool

- `fetch_asset` — external **stills** (logo, headshot, cover art, product photo). If it's
  a static image, not video, use `fetch_asset`.
- `mint_video` — **generates** motion from a prompt or reference still. `pull_video`
  only pulls and cuts existing footage; it never calls a video-gen API.
- `analyze_reference` — reads a reference video for staging, format, and mechanism data
  (Gemini brand-DNA, transcript-grounded outlier analysis). Use `analyze_reference` when
  the goal is insight, not a clip on disk.
- `steal_audio` (legacy) — folded into `pull_video --audio-only`; do not call
  `steal_audio.py` directly.
