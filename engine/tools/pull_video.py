"""
pull_video.py — the canonical EXTERNAL-video pull primitive. ONE tool,
`--mode` picks the acquisition shape. (Renamed from acquire_footage 2026-07-16;
tools/acquire_footage.py remains as a deprecated alias shim through the
deprecation window — same flags, same behavior, same exit codes.)

⭐ CHECK THE LIBRARY FIRST. Before pulling an external URL, search the tenant's own
indexed footage — it's free, on-brand, and usually the right answer:
    uv run python tools/index_media.py search "<describe it>" --tenant <t> --job <id>
Priority: mine → shared → web-capture → stock → pull_video/URL → generate.
Only use this tool when the clip is NOT in the library (a specific reference video, a
YouTube/IG clip the tenant doesn't own). See skills/primitives/index_media.md.

  uv run python tools/pull_video.py --job <id> --mode <pull|select|enumerate> [...]

This is the consolidation of five legacy backends — their logic is INLINED here
(they are deleted). Do NOT import them. Every working detail (exact model ids,
yt-dlp format selectors, ffmpeg recipes, MVSep separation flow, flag semantics)
is preserved from the originals so this produces the SAME results.

ABSORBED BACKENDS
─────────────────
  pull_footage.py    yt-dlp section-download + ffmpeg cut + subject-aware crop
                     (center / face / manual) + frame sampling + montage concat.
  download_top.py    batch yt-dlp of a top-picks list (parallel, height<=720,
  download_all.py    skip-existing, absolute pyenv yt-dlp path).
  download_videos.py audio-only yt-dlp rip (--extract-audio mp3 path).
  steal_audio.py     download → stem separation → no-vocals instrumental bed
                     (gateway/Fal Demucs in the shipped app).

THE TWO MODES (per skills/primitives/pull_video.md)
────────────────────────────────────────────────────────
  --mode pull      Download an external video (or audio) and optionally trim to
                   an in/out window and/or crop the frame. yt-dlp → ffmpeg.
                   Local files (--file) skip yt-dlp. Sub-shapes:
                     · single clip (default)
                     · --audio-only           → rip the audio track (m4a/mp3)
                     · --audio-only --bed      → MVSep no-vocals instrumental bed
                     · --batch <list.json>     → bulk channel/top-picks download
                     · --montage "a-b,c-d"     → multi-window cut + concat
                     · --sample-every N        → also extract sample frames

  --mode select    When the right window is unknown, feed the full download to
                   Gemini to identify the strongest in/out timestamps, then cut
                   to that window automatically. Writes a <name>_select.json
                   sidecar with {in, out, rationale}. (Gemini is eyes, not
                   taste — the picks are mechanical, never a quality verdict.)

  --mode enumerate PULL A WHOLE IG/TikTok PROFILE'S VIDEO LIST via Apify, ranked
                   by views, then optionally download the top-N. yt-dlp/anonymous
                   access hits IG/TikTok auth-walls and can't list a profile — so
                   Apify (APIFY_TOKEN in .env) scrapes the profile → we get direct
                   videoUrls + metadata (caption, views, duration) → download those
                   (yt-dlp on the permalink is the fallback). The canonical
                   "grab a creator's / competitor's content" path; feed the
                   downloads to analyze_reference to mine format / hook / style.
                     --url <profile> --limit N [--download N]
                   → social_pull/<platform>_<handle>/manifest.json + NN_<code>.mp4

  --mode search    SEARCH ACTIVE META VIDEO ADS through the typed gateway
                   capability. The request exposes research intent and a hard
                   Quick/Standard/Deep budget tier, never an Actor id or raw
                   Actor input. Results keep public performance evidence
                   separate from unevaluated CreativeFit judgment.
                     --source meta_ads --query "founder content"
                     [--country US] [--limit 500]
                     [--research-tier quick|standard|deep]
                   → research/meta_ads/<run>/manifest.json (legacy: no run directory)

`--mode` is REQUIRED and logged as `usage_role`. `--job` is always passed
(concurrent jobs clobber shared state; every pipeline tool passes --job
explicitly) — except the legacy steal-audio standalone behaviour, which still
works without --job by falling back to a CWD scratch dir.

GATEWAY (chunk 25 — one pull surface)
──────────────────────────────────────
  With VIDEOCLAW_API_KEY set, ACQUISITION routes through the gateway's
  POST /v1/media/pull: URL classification (yt-dlp vs Apify) and execution are
  server-side, media returns via signed URL, and spend meters against the key.
  Trim/crop/montage/sampling stay client-side ffmpeg, unchanged. Fallbacks:
  no key → local paths (dev, unchanged); gateway 404s the route (endpoint not
  deployed yet) → local path with one log line; 402/403/413/422/429 → the
  friendly detail surfaces and the tool stops (never a local metering bypass).
  `--purpose reference|footage` (default footage) tells the gateway what a
  video pull is for: a YouTube reference pull is quoted and pulled at 360p,
  footage at the highest quality that fits (up to 720p).
  The local yt-dlp retry is the ONLY rung below the gateway (app#840): when it
  also fails, acquisition has failed. Reaching a scraping/downloader vendor by
  hand, or pulling a vendor's own signed output URL, is off-rail spend the
  ledger cannot see — the host refuses both.

CITATION / FALLBACKS worth carrying forward
────────────────────────────────────────────
  · Local pulls use this engine's Python environment and bundled Node runtime;
    ACQUIRE_YTDLP_BIN is an explicit developer override, never a required setup.
  · section-download (`--download-sections`) ERRs on a bad timestamp range —
    we trim with ffmpeg AFTER a full (or windowed) download instead, so a bad
    range just clamps.
  · Instagram URLs hit auth-walls — pass --cookies-from-browser <browser> or a
    --cookies <cookies.txt>.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from job import resolve_job_dir, add_job_arg, billing_input_path
from log import log_event
from _gateway import gateway, GatewayError, GatewayAcceptedError
from _safe_framing import (
    _blur_contain_filter,
    _contained_output_size,
    _crop_filter,
    _framing_plan_from_faces,
    _scale_to,
    _subject_framing_plan,
)


def _load_gateway_key() -> None:
    """Surface one pinned gateway key+URL pair from .env.

    This tool deliberately does NOT load .env at import time (see the lazy
    load inside the Apify path), so gateway configuration may live only there.
    Loading a key without its URL recreated the staging-key-to-production-host
    failure: `_gateway` correctly fell back to prod, which rejected the key as
    unknown. Load the pair atomically, never the key by itself. The desktop app
    normally injects both values once at session start; this lazy path exists
    only for standalone engine use.
    """
    if os.environ.get("VIDEOCLAW_API_KEY"):
        return
    try:
        from dotenv import dotenv_values
        from _paths import ENV_PATH
        sources = (dotenv_values(ENV_PATH) or {}, dotenv_values() or {})
        for values in sources:
            key = values.get("VIDEOCLAW_API_KEY")
            if not key:
                continue
            configured_url = (
                os.environ.get("VIDEOCLAW_GATEWAY_URL")
                or os.environ.get("VIDEOCLAW_GW_URL")
                or values.get("VIDEOCLAW_GATEWAY_URL")
                or values.get("VIDEOCLAW_GW_URL")
            )
            if not configured_url:
                raise SystemExit(
                    "VIDEOCLAW_API_KEY is present in .env but its gateway URL is "
                    "missing. Set VIDEOCLAW_GATEWAY_URL beside the key and restart "
                    "the app/session; refusing to guess a gateway host."
                )
            os.environ["VIDEOCLAW_GATEWAY_URL"] = str(configured_url).rstrip("/")
            os.environ["VIDEOCLAW_API_KEY"] = str(key)
            return
    except SystemExit:
        raise
    except Exception:
        pass

# ── lazy / optional third-party deps ─────────────────────────────────────────
# requests + replicate are only needed for the temporary unkeyed local bed
# fallback; import lazily so `--help` and plain pull/cut paths stay lightweight.


# ── Model id (preserved verbatim from steal_audio.py) ────────────────────────
MVSEP_MODEL = (
    "lucataco/mvsep-mdx23-music-separation:"
    "510b9b91aec1bfa7d634e6c06ee80c18492fb0fc06aa1474533fbda90dd3dba4"
)
STEM_NAMES = ("bass", "drums", "other", "vocals")

# ── yt-dlp format selectors (preserved verbatim from the backends) ───────────
# pull_footage.py: prefers best mp4 + audio, falls back, merges to mp4.
YTDLP_FORMAT_BEST = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best"
# download_top/all.py: capped at 720p for batch / reference corpora.
YTDLP_FORMAT_720 = (
    "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/"
    "best[ext=mp4][height<=720]/best"
)
YTDLP_FORMAT_480 = (
    "bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/"
    "best[ext=mp4][height<=480]/worst[ext=mp4]/worst"
)
# gemini_video.py select-download: 720p cap so the upload stays small.
YTDLP_FORMAT_SELECT = (
    "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/"
    "best[ext=mp4][height<=720]/best"
)
# steal_audio.py: video-or-anything, audio kept for extraction.
YTDLP_FORMAT_AUDIO_SOURCE = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"

GEMINI_MODEL = "~google/gemini-pro-latest"

TOOL = "pull_video.py"


# ═════════════════════════════════════════════════════════════════════════════
# Low-level shell helpers
# ═════════════════════════════════════════════════════════════════════════════

class DownloadError(SystemExit):
    """A local source failure: stop this pull, not a batch of unrelated links."""


def _ytdlp_command() -> list[str]:
    """Use the locked engine environment and the Node runtime shipped by the app."""
    override = os.environ.get("ACQUIRE_YTDLP_BIN")
    command = [override] if override else [sys.executable, "-m", "yt_dlp"]
    return command + ["--ignore-config", "--js-runtimes", "node"]


def _ytdlp_error_line(detail: str) -> str:
    lines = [line.strip() for line in detail.splitlines() if line.strip()]
    errors = [line for line in lines if line.startswith("ERROR:")]
    return (errors or lines or ["download did not finish"])[-1]


def _ytdlp_terminal_error(detail: str) -> str | None:
    detail = _ytdlp_error_line(detail)
    if re.search(r"sign[ -]?in|log[ -]?in|not a bot|age.?restrict|private video|"
                 r"video unavailable|video is unavailable|not available in your country",
                 detail, re.IGNORECASE):
        return ("This video is private, restricted, or requires sign-in. "
                "Upload the video file or provide a public downloadable link; "
                "retrying the same link will not resolve this.")
    if re.search(r"unsupported URL|invalid URL|not a valid URL|incomplete YouTube ID",
                 detail, re.IGNORECASE):
        return "This video link is not supported. Check the full URL or upload the video file."
    return None


def _run(cmd: list[str], *, capture: bool = False, timeout: int | None = None) -> str:
    if capture:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            print(res.stderr, file=sys.stderr)
            sys.exit(res.returncode)
        return res.stdout
    res = subprocess.run(cmd, timeout=timeout)
    if res.returncode != 0:
        sys.exit(res.returncode)
    return ""


def _probe(path: Path) -> dict:
    """ffprobe → {duration_s, width, height, fps}. (pull_footage._probe)."""
    out = _run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(path),
        ],
        capture=True,
    )
    info = json.loads(out)
    vstream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    duration = float(info["format"].get("duration", 0.0) or 0.0)
    return {
        "duration_s": duration,
        "width": int(vstream["width"]) if vstream else 0,
        "height": int(vstream["height"]) if vstream else 0,
        "fps": eval(vstream.get("r_frame_rate", "30/1")) if vstream else 30.0,
    }


def _slugify(value: str) -> str:
    """Stable short slug from a URL or arbitrary string (steal_audio._slugify)."""
    m = re.search(r"/(reel|video|p|shorts|watch)/([A-Za-z0-9_\-]+)", value)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-").lower()
    if cleaned and "://" not in value:
        return cleaned[:60]
    h = hashlib.sha1(value.encode()).hexdigest()[:10]
    return f"url_{h}"


def _sha_of_file(path: Path, chunk: int = 1 << 16) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()[:12]


# ═════════════════════════════════════════════════════════════════════════════
# yt-dlp download (absorbs pull_footage.cmd_pull + steal_audio._download)
# ═════════════════════════════════════════════════════════════════════════════

def _ytdlp_video(
    url: str,
    out_dir: Path,
    *,
    stem: str = "source",
    fmt: str = YTDLP_FORMAT_BEST,
    cookies_from_browser: str | None = None,
    cookies_file: str | None = None,
    force: bool = False,
    timeout: int | None = 300,
) -> Path:
    """Download a video URL → out_dir/<stem>.mp4 (cached unless force).

    Mirrors pull_footage.cmd_pull: merge to mp4, and if yt-dlp lands a non-mp4
    container, transcode to mp4 for consistent downstream handling.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    canonical = out_dir / f"{stem}.mp4"
    if canonical.exists() and canonical.stat().st_size > 1000 and not force:
        print(f"[pull_video] cache hit on download: {canonical.name}")
        return canonical

    def download_once(selected_fmt: str, selected_stem: str) -> subprocess.CompletedProcess:
        out_template = str(out_dir / f"{selected_stem}.%(ext)s")
        cmd = [
            *_ytdlp_command(),
            "-f", selected_fmt,
            "--no-playlist",
            "--continue",
            "--socket-timeout", "30",
            "--retries", "3",
            "--fragment-retries", "3",
            "--merge-output-format", "mp4",
            "--print", "after_move:filepath",
            "-o", out_template,
        ]
        if cookies_from_browser:
            cmd += ["--cookies-from-browser", cookies_from_browser]
        if cookies_file:
            cmd += ["--cookies", cookies_file]
        if force:
            cmd += ["--force-overwrites"]
        cmd.append(url)
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

    print(f"[pull_video] pulling {url}")
    last_error = "download did not finish"
    downloaded_stem = stem
    # Retry the exact selector first: yt-dlp's .part file resumes instead of
    # throwing away bytes. Only after that fails do we step down to a distinct
    # 480p output, avoiding an incompatible append onto the original partial.
    attempts = ((fmt, stem), (fmt, stem), (YTDLP_FORMAT_480, f"{stem}.__light"))
    for attempt, (selected_fmt, selected_stem) in enumerate(attempts, start=1):
        try:
            res = download_once(selected_fmt, selected_stem)
            if res.returncode == 0:
                downloaded_stem = selected_stem
                if attempt == 3:
                    print("[pull_video] source was slow; completed with the automatic 480p fallback")
                break
            last_error = _ytdlp_error_line(res.stderr)
            terminal = _ytdlp_terminal_error(last_error)
            if terminal:
                raise DownloadError(terminal)
        except subprocess.TimeoutExpired:
            last_error = "no completed download before the timeout"
        if attempt < len(attempts):
            print(f"[pull_video] pull attempt {attempt} did not finish; retrying automatically")
    else:
        raise DownloadError("Couldn't download this video after three attempts: "
                            f"{_strip_tool_jargon(last_error)[:240]}. "
                            "Check the source or upload the video file.")

    # Use the downloader's completed output, never a leftover partial/sidecar.
    selected = Path(res.stdout.strip())
    if not selected.is_file() or selected.stat().st_size == 0:
        raise DownloadError("The download did not produce a video. Upload the video file instead.")
    # Normalize non-mp4 → mp4 (pull_footage transcode step).
    if selected.suffix != ".mp4":
        normalized = out_dir / f"{stem}.__normalize.mp4"
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(selected),
              "-c:v", "libx264", "-c:a", "aac", str(normalized)])
        normalized.replace(canonical)
        selected.unlink(missing_ok=True)
        return canonical
    if downloaded_stem != stem and selected != canonical:
        canonical.parent.mkdir(parents=True, exist_ok=True)
        selected.replace(canonical)
        selected = canonical
    return selected


def _ytdlp_audio_only(
    url: str,
    out_path: Path,
    *,
    cookies_from_browser: str | None = None,
    cookies_file: str | None = None,
) -> Path:
    """Rip audio only (download_videos.download_audio): --extract-audio mp3 @ q5."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists() and out_path.stat().st_size > 1000:
        print(f"[pull_video] cache hit on audio rip: {out_path.name}")
        return out_path
    cmd = [
        *_ytdlp_command(),
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",   # ~128kbps — fine for transcription
        "--no-playlist",
        "-o", str(out_path),
    ]
    if cookies_from_browser:
        cmd += ["--cookies-from-browser", cookies_from_browser]
    if cookies_file:
        cmd += ["--cookies", cookies_file]
    cmd.append(url)
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise DownloadError("The audio download timed out. Check your connection or upload the file.") from None
    if res.returncode != 0:
        raise DownloadError(_ytdlp_terminal_error(res.stderr) or
                            "Couldn't download this audio: "
                            f"{_strip_tool_jargon(_ytdlp_error_line(res.stderr))[:240]}. "
                            "Check the source or upload the file.")
    return out_path


# ═════════════════════════════════════════════════════════════════════════════
# Gateway ONE-PULL surface (chunk 25 — POST /v1/media/pull)
# ═════════════════════════════════════════════════════════════════════════════
# DUAL MODE: with VIDEOCLAW_API_KEY set, ACQUISITION routes through the gateway.
# The gateway classifies the URL against its own route table (yt-dlp for
# YouTube/TikTok/X/direct, Apify for login-walled platforms) and returns the
# media via signed URL — route choice is infrastructure, not agent knowledge.
# Trim/crop/montage/frame-sampling stay CLIENT-side: the existing ffmpeg logic
# below runs unchanged on the downloaded file.
#
# Fallback ladder:
#   · no key / gateway disabled → the local yt-dlp/Apify paths (dev path,
#     byte-for-byte unchanged).
#   · gateway 404s the ROUTE (an old deployed gateway without /v1/media/pull)
#     → local path, silently, with one log line — the engine must not break
#     while the endpoint is not deployed yet.
#   · gateway 502/504 — the SOURCE refused or timed out server-side (e.g.
#     YouTube bot-walls datacenter IPs) → fall back to the LOCAL path with one
#     log line. A failed gateway pull meters nothing, so nothing is bypassed —
#     and this machine's residential IP often succeeds where Cloud Run can't.
#   · gateway 402/403/413/422/429 (spend cap / disabled key / size cap /
#     unresolvable link / vendor throttle) → surface the friendly `detail` and
#     STOP. Never fall back to local for these — that would bypass metering.

GW_MEDIA_PULL_TIMEOUT_S = 1800.0

# Statuses that mean "the SOURCE refused the gateway", not "policy says no".
_GW_VENDOR_REFUSAL = {502, 504}


def _strip_tool_jargon(detail: str) -> str:
    """One human line from a gateway `detail` — never flag soup. Vendor errors
    arrive as 'human half (ERROR: [youtube] … Use --cookies-from-browser …)';
    keep the human half, drop the tool talk."""
    human = re.split(r"\s*\((?:ERROR|WARNING)\b", detail, maxsplit=1)[0]
    human = re.sub(r"^(?:ERROR|WARNING):\s*(?:\[[^]]+\]\s*)?", "", human)
    human = re.sub(r"\S*yt-dlp\S*", "", human)
    human = re.sub(r"--[A-Za-z][A-Za-z-]*", "", human)
    human = re.sub(r"\s{2,}", " ", human).strip(" -—:;,")
    return human or "the source refused the download"


def _gateway_media_pull(payload: dict, *,
                        job_dir: Path | None = None, output: Path | None = None,
                        timeout_s: float = GW_MEDIA_PULL_TIMEOUT_S) -> dict | None:
    """POST /v1/media/pull on the gateway. Returns the result dict, or None
    when the caller should use the LOCAL path instead: 404 (deployed gateway
    doesn't have the route yet) or 502/504 (the source refused the gateway —
    this machine's own connection often gets through). Policy refusals
    (402/403/413/422/429) carry a stable friendly {"detail": ...} per
    LAUNCH_SPEC §11.2 — surface it and stop, never bypass to local."""
    if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1":
        if job_dir is None or output is None:
            raise GatewayError("media recovery requires its original video and output")
        try:
            result = gateway.run("media/pull", job=job_dir, _delivery=[output],
                                 timeout_s=timeout_s, **{k: v for k, v in payload.items() if k != "client_job"})
        except GatewayAcceptedError as exc:
            refused = getattr(exc, "result", {})
            if (refused.get("status") == "failed" and refused.get("cost_usd") == 0
                    and (refused.get("failure") or {}).get("code") == "FREE_PULL_SOURCE_REFUSED"):
                return None  # The gateway proved this original request was free.
            raise
        from _billing_manifest import job_path
        saved = gateway.collect_operation(job_path(str(job_dir), Path.cwd()), result["_operation_id"])
        if not all(saved["delivered"].get(path, {}).get("state") == "delivered" for path in saved["outputs"]):
            raise GatewayAcceptedError("the original acquisition still needs file recovery")
        return {**(result.get("output") or {}), "_operation_id": result["_operation_id"]}
    import requests  # lazy (matches the tool's other network paths)
    r = requests.post(
        f"{gateway.url}/v1/media/pull", json=payload,
        headers=gateway.request_headers(),
        timeout=timeout_s,
    )
    if r.status_code == 404:
        # Old deployed gateway without the endpoint — one line, local takes over.
        print("[pull_video] gateway has no /v1/media/pull route yet — using the local path")
        return None
    if r.status_code >= 400:
        try:
            detail = (r.json() or {}).get("detail") or r.text[:300]
        except Exception:
            detail = r.text[:300]
        if r.status_code in _GW_VENDOR_REFUSAL:
            print("[pull_video] the source refused the gateway pull "
                  f"({_strip_tool_jargon(detail)}) — retrying from this machine")
            return None
        raise SystemExit(
            f"[pull_video] gateway refused the pull ({r.status_code}): "
            f"{_strip_tool_jargon(detail)}")
    return r.json()


def collect_pulled_media(client, url: str, record: dict) -> bytes:
    """Keep native container conversion reproducible in the existing collector."""
    payload = json.loads(record["body"])
    asset = record["result"]["assets"][0]
    suffix = Path(asset.get("name") or "media.mp4").suffix.lower()
    if suffix not in {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus"}:
        raise GatewayAcceptedError("the original acquisition has an unsupported media container")
    with tempfile.TemporaryDirectory(prefix="videoclaw-pull-") as tmp:
        source = Path(tmp) / ("source" + suffix)
        with source.open("wb") as stream:
            client._download_to(url, stream, max_bytes=256 * 1024 * 1024)
        output = Path(tmp) / Path(record["outputs"][0]).name
        if payload.get("audio_only") and suffix != ".mp3":
            _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
                  "-vn", "-c:a", "libmp3lame", "-q:a", "5", str(output)], timeout=300)
        elif not payload.get("audio_only") and suffix != ".mp4":
            _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
                  "-c:v", "libx264", "-c:a", "aac", str(output)], timeout=300)
        else:
            output = source
        # ponytail: one file up to 256 MiB in memory; stream to the journal if this cap grows.
        if output.stat().st_size > 256 * 1024 * 1024:
            raise GatewayAcceptedError("the converted acquisition exceeds the recovery size cap")
        return output.read_bytes()


def _gw_spend(res: dict) -> dict:
    """Pull result → the cost-row extras every gateway vendor call logs
    (estimate_usd lands on the tool's own event — mint_image precedent — so
    cost.py reconcile and the app's jobWatcher pick it up)."""
    spend = {} if res.get("_operation_id") else res.get("spend") or {}
    extras: dict = {"gateway": True}
    if spend.get("cost_usd") is not None:
        try:
            extras["estimate_usd"] = round(float(spend["cost_usd"]), 4)
        except (TypeError, ValueError):
            pass
    if spend.get("cost_source"):
        extras["cost_source"] = spend["cost_source"]
    return extras


def _gateway_download_media(res: dict, out_dir: Path, stem: str) -> Path:
    """Download the pull result's signed_url → out_dir/<stem>.<ext>. Video in a
    non-mp4 container is normalized to mp4 exactly like _ytdlp_video does, so
    downstream ffmpeg handling sees the same file the local path would make."""
    asset = res.get("asset") or {}
    ext = Path(asset.get("name") or "media.mp4").suffix or ".mp4"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / f"{stem}{ext}"
    gateway.download(res["signed_url"], raw)
    ctype = asset.get("content_type") or ""
    if ext != ".mp4" and (ctype.startswith("video/") or ext in (".mkv", ".webm", ".mov")):
        conv = out_dir / f"{stem}.mp4"
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
              "-c:v", "libx264", "-c:a", "aac", str(conv)])
        raw.unlink(missing_ok=True)
        return conv
    return raw


def _gateway_video(url: str, out_dir: Path, *, stem: str, job_dir: Path,
                   fmt: str | None = None, purpose: str = "footage",
                   force: bool = False) -> tuple[Path, dict] | None:
    """Acquire ONE video via the gateway → (local mp4 path, cost-row extras).
    None ⇒ route not deployed yet; the caller uses the local path. Mirrors
    _ytdlp_video's cache contract (out_dir/<stem>.mp4, reused unless force).

    `fmt` is forwarded ONLY when the caller explicitly overrode --format: the
    engine's defaults are ffmpeg MERGE selectors (bv*+ba…), and the gateway
    runtime has no ffmpeg — it picks its own single-file default.

    `purpose` tells the gateway what the clip is for: "reference" (only
    watched or analysed — a YouTube pull is quoted and pulled at 360p) or
    "footage" (it goes into the video — the highest quality that fits)."""
    canonical = out_dir / f"{stem}.mp4"
    if canonical.exists() and canonical.stat().st_size > 1000 and not force:
        print(f"[pull_video] cache hit on download: {canonical.name}")
        return canonical, {}
    if canonical.exists() and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1":
        canonical = canonical.with_stem(f"{canonical.stem}-{uuid.uuid4().hex[:12]}")
    payload: dict = {"url": url, "mode": "pull", "purpose": purpose,
                     "client_job": job_dir.name}
    if fmt:
        payload["format"] = fmt
    print(f"[pull_video] gateway pull {url}")
    res = _gateway_media_pull(payload, job_dir=job_dir, output=canonical)
    if res is None:
        return None
    if res.get("_operation_id"):
        return canonical, _gw_spend(res)
    return _gateway_download_media(res, out_dir, stem), _gw_spend(res)


def _acquire_video(url: str, out_dir: Path, *, stem: str, fmt: str,
                   job_dir: Path, cookies_from_browser: str | None = None,
                   cookies_file: str | None = None, force: bool = False,
                   gw_fmt: str | None = None,
                   purpose: str = "footage") -> tuple[Path, dict]:
    """THE single-video acquisition seam: gateway when keyed (404 route-miss
    falls back to local), local yt-dlp otherwise. Returns (path, cost extras).
    `purpose` only reaches the gateway; the local path ignores it."""
    _load_gateway_key()
    if gateway.enabled():
        got = _gateway_video(url, out_dir, stem=stem, job_dir=job_dir,
                             fmt=gw_fmt, purpose=purpose, force=force)
        if got is not None:
            return got
    path = _ytdlp_video(url, out_dir, stem=stem, fmt=fmt,
                        cookies_from_browser=cookies_from_browser,
                        cookies_file=cookies_file, force=force)
    return path, {}


def _gateway_audio_rip(url: str, out_mp3: Path, *, job_dir: Path,
                       force: bool = False) -> dict | None:
    """--audio-only via the gateway (endpoint audio_only=true) → out_mp3.
    The gateway returns the source's native audio container (usually m4a);
    we transcode to mp3 locally so the artifact matches the local rip's.
    Returns cost-row extras, or None ⇒ caller uses the local yt-dlp rip."""
    if out_mp3.exists() and out_mp3.stat().st_size > 1000 and not force:
        print(f"[pull_video] cache hit on audio rip: {out_mp3.name}")
        return {}
    if out_mp3.exists() and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1":
        out_mp3 = out_mp3.with_stem(f"{out_mp3.stem}-{uuid.uuid4().hex[:12]}")
    payload = {"url": url, "mode": "pull", "audio_only": True,
               "client_job": job_dir.name}
    print(f"[pull_video] gateway pull (audio) {url}")
    res = _gateway_media_pull(payload, job_dir=job_dir, output=out_mp3)
    if res is None:
        return None
    if res.get("_operation_id"):
        return {**_gw_spend(res), "_output_path": str(out_mp3)}
    tmp_dir = out_mp3.parent / f".__gwaudio_{out_mp3.stem}"
    raw = _gateway_download_media(res, tmp_dir, out_mp3.stem)
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    if raw.suffix == ".mp3":
        shutil.move(str(raw), str(out_mp3))
    else:
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
              "-vn", "-c:a", "libmp3lame", "-q:a", "5", str(out_mp3)])
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return _gw_spend(res)


# ═════════════════════════════════════════════════════════════════════════════
# ffmpeg cut + subject-aware crop (absorbs pull_footage cut/crop/montage)
# ═════════════════════════════════════════════════════════════════════════════


def _aspect_matches(src_w: int, src_h: int, aspect: str) -> bool:
    aw, ah = (int(value) for value in aspect.split(":"))
    target_ratio = aw / ah
    return abs((src_w / src_h) - target_ratio) / target_ratio <= 0.01

def _hms_to_seconds(value: str | float | None) -> float | None:
    """Accept HH:MM:SS(.ms), MM:SS, or a bare float-seconds string/number."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = value.strip()
    if not s:
        return None
    if ":" in s:
        parts = [float(p) for p in s.split(":")]
        total = 0.0
        for p in parts:
            total = total * 60 + p
        return total
    return float(s)


def _parse_montage(spec: str) -> list[tuple[float, float]]:
    """Parse --montage windows: comma-separated `start-end` or legacy `start:end`.

    Each side takes the same forms as --in/--out (HH:MM:SS(.ms), MM:SS or
    seconds). `:` is also the timestamp separator, so the legacy `a:b` form is
    only unambiguous for bare seconds ("5:12") or two full HH:MM:SS stamps
    ("00:01:05:00:01:12"); anything else must use `-` ("1:05-1:12").
    Validated before any download, so a typo never costs an acquisition.
    """
    cuts: list[tuple[float, float]] = []
    for raw in spec.split(","):
        chunk = raw.strip()
        if not chunk:
            raise SystemExit(f"--montage has an empty window in {spec!r}")
        if "-" in chunk:
            sides = chunk.split("-")
            if len(sides) != 2:
                raise SystemExit(f"--montage window {chunk!r} must be 'start-end'")
            start_raw, end_raw = sides
        else:
            fields = chunk.split(":")
            if len(fields) == 2:
                start_raw, end_raw = fields
            elif len(fields) == 6:
                start_raw, end_raw = ":".join(fields[:3]), ":".join(fields[3:])
            else:
                raise SystemExit(
                    f"--montage window {chunk!r} is ambiguous: use 'start-end' "
                    f"with HH:MM:SS / MM:SS / seconds, e.g. '1:05-1:12'")
        try:
            start, end = _hms_to_seconds(start_raw), _hms_to_seconds(end_raw)
        except ValueError:
            raise SystemExit(f"--montage window {chunk!r} has an unreadable time") from None
        if start is None or end is None or start < 0 or end <= start:
            raise SystemExit(f"--montage window {chunk!r} must end after it starts")
        cuts.append((start, end))
    return cuts


def _cut_and_reframe(
    src: Path,
    out_path: Path,
    *,
    start: float | None,
    end: float | None,
    crop_spec: str | None,      # raw ffmpeg "w:h:x:y" (--crop) — explicit override
    aspect: str | None,         # subject-aware reframe target e.g. "1:1"
    frame_mode: str,            # center | face | manual
    frame_x: float,
    frame_y: float,
    target_w: int | None,
    target_h: int | None,
    keep_audio: bool,
) -> tuple[Path, int, int]:
    """Trim [start,end] then crop/reframe. Returns (out_path, out_w, out_h).

    Two crop paths (mutually consistent with pull_footage):
      · --crop "w:h:x:y" → applied verbatim (raw ffmpeg crop, no centering).
      · --aspect "1:1"   → subject-aware reframe (center/face/manual center).
    """
    info = _probe(src)
    src_w, src_h = info["width"], info["height"]
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 1: trim raw window (ffmpeg -ss/-to AFTER download avoids section-download ERR).
    tmp_trim = out_path.parent / f".__trim_{out_path.stem}.mp4"
    trim_cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if start is not None:
        trim_cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        trim_cmd += ["-to", f"{end:.3f}"]
    trim_cmd += [
        "-i", str(src), "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-pix_fmt", "yuv420p",
    ]
    trim_cmd += (["-c:a", "aac"] if keep_audio else ["-an"])
    trim_cmd += [str(tmp_trim)]
    _run(trim_cmd)

    # 2: build the crop filter. Already-correct camera footage is immutable:
    # supplying --aspect 9:16 for a 9:16 talking head must not shrink it into a
    # floating card. Natural footage stays full-bleed; complete-source
    # containment is an explicit caller choice used for screens/documents.
    framing = {"strategy": "unchanged", "reason": "no aspect transform"}
    if crop_spec:
        crop = f"crop={crop_spec}"
        try:
            cw, ch = (int(x) for x in crop_spec.split(":")[:2])
            out_w, out_h = cw, ch
        except Exception:
            out_w, out_h = src_w, src_h
        framing = {"strategy": "explicit_crop", "reason": "caller supplied --crop"}
    elif aspect:
        if _aspect_matches(src_w, src_h, aspect):
            framing = {
                "strategy": "same_aspect",
                "reason": "source already matches the delivery canvas; preserve its full frame",
                "center": [0.5, 0.5],
                "faceCount": 0,
            }
            crop = None
            out_w, out_h = src_w, src_h
        elif frame_mode == "face":
            framing = _subject_framing_plan(tmp_trim, aspect)
            cx, cy = framing["center"]
            print(
                f"[pull_video] framing: {framing['strategy']} "
                f"({framing['reason']}; center={cx:.2f},{cy:.2f})"
            )
        elif frame_mode == "contain":
            framing = _framing_plan_from_faces(
                src_w, src_h, aspect, [], allow_contain=True,
            )
        elif frame_mode == "manual":
            cx, cy = frame_x, frame_y
            framing = {"strategy": "manual_crop", "reason": "caller supplied center"}
        else:
            cx, cy = 0.5, 0.5
            framing = {"strategy": "center_crop", "reason": "caller requested center"}
        if framing["strategy"] == "contain_blur":
            crop = None
            out_w, out_h = _contained_output_size(src_w, src_h, aspect)
        elif framing["strategy"] == "same_aspect":
            crop = None
            out_w, out_h = src_w, src_h
        else:
            crop, out_w, out_h = _crop_filter(src_w, src_h, aspect, cx, cy)
    else:
        crop, out_w, out_h = None, src_w, src_h

    # 3: assemble filters + encode (re-encode only if we have a video filter).
    filters: list[str] = []
    if crop:
        filters.append(crop)
    if target_w and target_h:
        filters.append(_scale_to(target_w, target_h))

    enc_cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp_trim)]
    if framing["strategy"] == "contain_blur":
        delivery_w = target_w or out_w
        delivery_h = target_h or out_h
        enc_cmd += [
            "-filter_complex", _blur_contain_filter(
                delivery_w, delivery_h, framing.get("foregroundBox")
            ),
            "-map", "[delivery_video]", "-map", "0:a?",
        ]
        out_w, out_h = delivery_w, delivery_h
    elif filters:
        enc_cmd += ["-vf", ",".join(filters)]
    enc_cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p"]
    enc_cmd += (["-c:a", "aac"] if keep_audio else ["-an"])
    enc_cmd += [str(out_path)]
    _run(enc_cmd)
    tmp_trim.unlink(missing_ok=True)
    framing_receipt = {
        "schema": "videoclaw.footage-framing/v1",
        "source": str(src),
        "output": str(out_path),
        "aspect": aspect,
        "frameMode": frame_mode,
        "outputSize": [out_w, out_h],
        **framing,
    }
    out_path.with_suffix(out_path.suffix + ".framing.json").write_text(
        json.dumps(framing_receipt, indent=2) + "\n", encoding="utf-8",
    )
    return out_path, out_w, out_h


def _sample_frames(src: Path, frames_dir: Path, every: float, duration_s: float) -> int:
    """Extract 1 frame every `every` seconds (pull_footage frame sampling)."""
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    n = max(1, int(duration_s // every))
    for i in range(n):
        t = i * every
        _run([
            "ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", str(src),
            "-vframes", "1", "-q:v", "2",
            str(frames_dir / f"sample_t{int(t):04d}.png"),
        ])
    return n


# ═════════════════════════════════════════════════════════════════════════════
# No-vocals bed (gateway/Fal Demucs; legacy local fallback retained temporarily)
# ═════════════════════════════════════════════════════════════════════════════

def _extract_audio_wav(video_path: Path, out: Path) -> Path:
    """Stereo 44.1kHz PCM wav for stem separation."""
    out.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video_path),
         "-vn", "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le", str(out)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg extract failed: {res.stderr[-500:]}")
    return out


def _trim_wav(src: Path, dst: Path, start: float | None, end: float | None) -> Path:
    if start is None and end is None:
        return src
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src)]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-c:a", "pcm_s16le", str(dst)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg trim failed: {res.stderr[-500:]}")
    return dst


def _separate_stems(
    audio_path: Path,
    stems_dir: Path,
    *,
    job: Path | None = None,
) -> dict[str, Path]:
    """Gateway stem separation; cached by audio SHA.

    The four paid stems land together in a take owned by this audio, then
    replace ``<stems_dir>/<name>.wav``; stems already there (another audio's,
    or ones left without the cache marker) move to
    ``<job>/previous_takes/<UTC time>/…`` (videoclaw#283). A re-run for the
    same audio publishes a take an interrupted run already paid for.
    """
    from _takes import PaidTake

    stems_dir.mkdir(parents=True, exist_ok=True)
    sha = _sha_of_file(audio_path)
    cache_marker = stems_dir / f".sha-{sha}"
    paths = {n: stems_dir / f"{n}.wav" for n in STEM_NAMES}
    if cache_marker.exists() and all(p.exists() for p in paths.values()):
        print("[pull_video] cache hit on stems")
        return paths

    take = PaidTake(job, list(paths.values()), {"route": "stem_split/split", "audio_sha1": sha,
                                                "audio_bytes": audio_path.stat().st_size},
                    tool="pull_video.py")
    with take.hold():
        if take.adopted_from:
            for path in take.set_aside():
                print(f"  Earlier audio's paid stems kept unused → {path}")
        if take.ready():
            print("[pull_video] reusing the paid stems of an interrupted run (nothing charged now)")
        else:
            _buy_stems(audio_path, take, job)
        for path in take.publish() or []:
            print(f"  previous take kept → {path}")
        # The stems now belong to this audio: an older audio's marker would lie.
        for marker in stems_dir.glob(".sha-*"):
            if marker != cache_marker:
                marker.unlink(missing_ok=True)
        cache_marker.write_text(datetime.now(timezone.utc).isoformat())
    return paths


def _buy_stems(audio_path: Path, take, job: Path | None) -> None:
    """The one paid stem split; saves the four stems as ``take``."""
    import requests  # type: ignore
    import replicate  # type: ignore
    from _takes import write_atomic

    print(f"[pull_video] stem separation on {audio_path.name} "
          f"({audio_path.stat().st_size // 1024}KB) ...")
    t0 = time.perf_counter()
    _load_gateway_key()
    from _gateway import gateway, GatewayNotSubmittedError
    if gateway.enabled():
        duration = _probe(audio_path)["duration_s"]
        try:
            res = gateway.run("stem_split", mode="split",
                              params={"audio": gateway.upload(audio_path)},
                              seconds=duration if duration > 0 else None,
                              job=job,
                              timeout_s=900, _delivery=take.paths)
        except GatewayNotSubmittedError as exc:
            raise take.refusal(exc) from exc
        # The gateway normalizes Fal's named outputs into this stable order.
        assets = res.get("assets") or []
        if len(assets) < 4:
            raise RuntimeError(f"stem_split returned {len(assets)} assets, need 4")
        for name, a, target in zip(STEM_NAMES, assets[:4], take.paths):
            gateway.download_asset(a, target)
            print(f"  ✓ {name}.wav ({target.stat().st_size // 1024}KB)")
        print(f"[pull_video] stem split done in {time.perf_counter() - t0:.1f}s")
        return
    with open(audio_path, "rb") as fh:
        output = replicate.run(MVSEP_MODEL, input={"audio": fh})
    print(f"[pull_video] stem split done in {time.perf_counter() - t0:.1f}s")

    if not isinstance(output, (list, tuple)) or len(output) < 4:
        raise RuntimeError(f"MVSep returned unexpected output shape: {output!r}")

    for name, item, target in zip(STEM_NAMES, output[:4], take.paths):
        url = item.url if hasattr(item, "url") else str(item)
        resp = requests.get(url, timeout=600)
        resp.raise_for_status()
        write_atomic(target, resp.content)
        print(f"  ✓ {name}.wav ({len(resp.content) // 1024}KB)")


def _mix_bed(stems: dict[str, Path], bed_wav: Path) -> Path:
    """amix bass+drums+other → -23 LUFS bed (steal_audio._mix_bed)."""
    bed_wav.parent.mkdir(parents=True, exist_ok=True)
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-i", str(stems["bass"]), "-i", str(stems["drums"]), "-i", str(stems["other"]),
         "-filter_complex",
         "[0:a][1:a][2:a]amix=inputs=3:duration=longest:normalize=0[mixed];"
         "[mixed]loudnorm=I=-23:LRA=7:tp=-1[out]",
         "-map", "[out]", "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le",
         str(bed_wav)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg mix failed: {res.stderr[-500:]}")
    return bed_wav


def _wav_to_mp3(wav: Path, mp3: Path) -> Path:
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
         "-c:a", "libmp3lame", "-q:a", "2", str(mp3)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg mp3 encode failed: {res.stderr[-500:]}")
    return mp3


def _build_bed(
    src_video: Path,
    work_dir: Path,
    out_mp3: Path,
    *,
    bed_name: str,
    trim_start: float | None,
    trim_end: float | None,
    keep_stems: bool,
    provenance_url: str | None,
    job: Path | None = None,
) -> dict:
    """Full bed flow: extract → (trim) → stem split → mix → mp3 → meta."""
    src_audio = work_dir / "source.wav"
    if not src_audio.exists():
        _extract_audio_wav(src_video, src_audio)
        print(f"[pull_video] extracted → {src_audio.name}")

    use_audio = src_audio
    if trim_start is not None or trim_end is not None:
        trimmed = work_dir / "trimmed.wav"
        use_audio = _trim_wav(src_audio, trimmed, trim_start, trim_end)
        print(f"[pull_video] trimmed → {use_audio.name}")

    stems_dir = work_dir / "stems"
    stems = _separate_stems(use_audio, stems_dir, job=job)

    bed_wav = work_dir / f"{bed_name}_full.wav"
    _mix_bed(stems, bed_wav)
    _wav_to_mp3(bed_wav, out_mp3)
    print(f"[pull_video] bed mp3 → {out_mp3}")

    meta = {
        "url": provenance_url,
        "model": "stem_split",
        "trim_start_sec": trim_start,
        "trim_end_sec": trim_end,
        "stems_used": ["bass", "drums", "other"],
        "stems_excluded": ["vocals"],
        "bed_mp3_path": str(out_mp3),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (work_dir / f"{bed_name}_meta.json").write_text(json.dumps(meta, indent=2))

    if not keep_stems:
        for n in STEM_NAMES:
            p = stems_dir / f"{n}.wav"
            p.unlink(missing_ok=True)
        for marker in stems_dir.glob(".sha-*"):
            marker.unlink(missing_ok=True)
        try:
            stems_dir.rmdir()
        except OSError:
            pass
        bed_wav.unlink(missing_ok=True)
    return meta


# ═════════════════════════════════════════════════════════════════════════════
# Gemini timestamp-windowing (select mode)
# ═════════════════════════════════════════════════════════════════════════════

def _gemini_pick_window(
    video_path: Path,
    duration_s: float,
    look_for: str | None,
    *,
    job_dir: Path,
) -> dict:
    """Ask Gemini for the strongest in/out window. Returns {in, out, rationale}.

    Gemini is EYES, NOT TASTE — the window is a mechanical pick (most
    speech-dense / visually-active on-topic passage), never a quality verdict.
    Reuses the gemini_video.py OpenRouter video call shape (base64 data-URL).
    """
    _load_gateway_key()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    gateway_enabled = gateway.enabled()
    if not api_key and not gateway_enabled:
        raise SystemExit("select mode needs OPENROUTER_API_KEY for the Gemini call "
                         "(or VIDEOCLAW_API_KEY for the gateway).")

    target = look_for or (
        "the single strongest, most relevant 5-30 second passage "
        "(the clearest on-topic / highest-energy / most speech-dense moment)"
    )
    prompt = (
        f"This video is {duration_s:.1f} seconds long. Identify {target}. "
        "Report ONLY mechanical observations (where speech is densest / motion is "
        "highest / the requested moment occurs) — do NOT judge quality. "
        "Return ONLY a JSON object, no markdown fences, with this exact schema:\n"
        '{"in": <seconds float>, "out": <seconds float>, "rationale": "<one sentence '
        'describing what happens in that window>"}'
    )

    start = time.perf_counter()
    gateway_cost: float | None = None
    if gateway_enabled:
        res = gateway.run(
            "qa_video",
            role="footage_selection",
            prompt=prompt,
            params={
                "_media": "video",
                "max_output_tokens": 2048,
            },
            references=[str(video_path)],
            job=job_dir,
            timeout_s=1800,
        )
        gateway_cost = res.get("cost_usd")
        content = res["output"]["text"]
        if not content:
            raise RuntimeError(
                f"Gemini (gateway qa_video/footage_selection) returned empty content: {res}"
            )
    else:
        import base64

        data = video_path.read_bytes()
        data_url = f"data:video/mp4;base64,{base64.b64encode(data).decode('utf-8')}"
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "video_url", "video_url": {"url": data_url}},
            ],
        }]
        from openai import OpenAI  # type: ignore
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        resp = client.chat.completions.create(
            model=GEMINI_MODEL,
            messages=messages,
            max_tokens=2048,
        )
        content = resp.choices[0].message.content if resp.choices else None
        if not content:
            raise RuntimeError(f"Gemini returned empty content: {resp.model_dump()}")

    # Strip an optional ```json fence.
    m = re.match(r"^```(?:json)?\s*\n(.*?)\n```\s*$", content.strip(), re.DOTALL)
    payload = m.group(1) if m else content.strip()
    window = json.loads(payload)

    win_in = float(window["in"])
    win_out = float(window["out"])
    # Clamp to [0, duration] (fallback: Gemini can hallucinate out-of-range stamps).
    clamped = False
    if win_in < 0:
        win_in, clamped = 0.0, True
    if win_out > duration_s:
        win_out, clamped = duration_s, True
    if win_out <= win_in:
        win_out = min(duration_s, win_in + 10.0)
        clamped = True
    if clamped:
        print(f"[pull_video] WARN clamped Gemini window → [{win_in:.2f}, {win_out:.2f}]")

    result = {
        "in": win_in,
        "out": win_out,
        "rationale": str(window.get("rationale", "")),
        "clamped": clamped,
        "look_for": look_for,
    }
    # The shared gateway_call row owns this request's cost, including recovery.
    extra = {"in": win_in, "out": win_out, "clamped": clamped}
    if gateway_enabled:
        extra["gateway"] = True
        extra["gateway_tool"] = "qa_video"
        if gateway_cost is not None:
            extra["gateway_cost_usd"] = round(gateway_cost, 4)
    else:
        extra["model"] = GEMINI_MODEL
    log_event(
        job_dir, tool=TOOL, event="gemini_window_picked",
        prompt=prompt, response=content,
        duration_seconds=time.perf_counter() - start,
        extra=extra,
    )
    return result


# ═════════════════════════════════════════════════════════════════════════════
# Batch download (absorbs download_top / download_all)
# ═════════════════════════════════════════════════════════════════════════════

def _batch_download(
    rows: list[dict],
    videos_dir: Path,
    *,
    max_workers: int,
    fmt: str,
    timeout: int,
) -> list[tuple[str, str, object]]:
    """Parallel yt-dlp of a list of {url, shortCode|id} rows → videos_dir/<key>.mp4.
    Skip-existing, height<=720 by default (download_top/all behaviour)."""
    videos_dir.mkdir(parents=True, exist_ok=True)

    def _key(r: dict) -> str:
        return str(r.get("shortCode") or r.get("id") or _slugify(r["url"]))

    def _one(r: dict) -> tuple[str, str, object]:
        key = _key(r)
        out = videos_dir / f"{key}.mp4"
        if out.exists() and out.stat().st_size > 1000:
            return key, "skip", out.stat().st_size
        proc = subprocess.run(
            [*_ytdlp_command(), "-f", fmt, "-o", str(out), "--no-playlist",
             "--merge-output-format", "mp4", "--quiet", r["url"]],
            capture_output=True, text=True, timeout=timeout,
        )
        if proc.returncode != 0 or not out.exists():
            return key, "FAIL", (_ytdlp_terminal_error(proc.stderr) or
                                 _strip_tool_jargon(_ytdlp_error_line(proc.stderr))[:240])
        return key, "ok", out.stat().st_size

    results: list[tuple[str, str, object]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_one, r): r for r in rows}
        for i, f in enumerate(as_completed(futs), 1):
            key, status, info = f.result()
            print(f"[{i:>2}/{len(rows)}] {key:>15}  {status:>4}  {info}", flush=True)
            results.append((key, status, info))
    return results


# ═════════════════════════════════════════════════════════════════════════════
# Mode dispatch
# ═════════════════════════════════════════════════════════════════════════════

def _footage_dir(job_dir: Path) -> Path:
    d = job_dir / "footage"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _default_name(args) -> str:
    """Output stem: explicit --name, else a slug of the URL / local filename."""
    if args.name:
        return args.name
    if args.url:
        return _slugify(args.url)
    if args.file:
        return Path(args.file).stem
    raise SystemExit("pass --url <remote> or --file <local.mp4> (or --batch).")


def _resolve_source(args, job_dir: Path) -> tuple[Path, str | None, dict]:
    """Resolve the input video to a local mp4 path. Returns
    (path, source_url, gateway_cost_extras).

    --file → local path (skips acquisition). --url → download into the footage
    cache: via the gateway when keyed (chunk 25), local yt-dlp otherwise.
    """
    if args.file:
        p = Path(args.file).expanduser().resolve()
        if not p.exists():
            raise SystemExit(f"--file does not exist: {p}")
        return p, None, {}
    if not args.url:
        raise SystemExit("pass --url <remote> or --file <local.mp4>.")
    slug = _slugify(args.url)
    work_dir = _footage_dir(job_dir) / "_sources" / slug
    purpose = getattr(args, "purpose", "footage")
    stem = "source"
    footage_cache = work_dir / "source.mp4"
    if purpose == "reference" and not (
            footage_cache.exists() and footage_cache.stat().st_size > 1000):
        # A cheaper reference copy is cached apart, so a later footage pull of
        # the same URL never reuses it. Footage already on disk serves both.
        stem = "reference"
    src, gw_extra = _acquire_video(
        args.url, work_dir, stem=stem, fmt=args.format,
        gw_fmt=(args.format if args.format != YTDLP_FORMAT_BEST else None),
        job_dir=job_dir,
        cookies_from_browser=args.cookies_from_browser,
        cookies_file=args.cookies, force=args.force, purpose=purpose,
    )
    return src, args.url, gw_extra


# ─────────────────────────────────────────────────────────────────────────────
# MODE: enumerate  —  pull a whole IG/TikTok profile's video list via Apify, then
# download (Apify lists the URLs + hands back direct videoUrls; we download those,
# yt-dlp is the fallback). The canonical "get a creator's / competitor's content"
# path — feed the downloads to analyze_reference to mine format/hook/style.
# ─────────────────────────────────────────────────────────────────────────────
APIFY_ACTORS = {
    "instagram": "apify~instagram-scraper",
    "tiktok": "clockworks~tiktok-scraper",
}


def _detect_platform(url: str) -> str | None:
    if "instagram.com" in url:
        return "instagram"
    if "tiktok.com" in url:
        return "tiktok"
    return None


def _apify_actor_input(platform: str, profile_url: str, limit: int) -> dict:
    """The exact actor input dict — identical whether we call Apify directly
    or route through the gateway (which forwards it to the same actor)."""
    if platform == "instagram":
        return {"directUrls": [profile_url], "resultsType": "posts",
                "resultsLimit": limit, "addParentData": False}
    # tiktok
    return {"profiles": [profile_url.rstrip("/").split("/")[-1].lstrip("@")],
            "resultsPerPage": limit, "shouldDownloadVideos": False}


def _apify_enumerate(
    profile_url: str, limit: int, *, job_dir: Path | None = None, manifest: Path | None = None,
) -> tuple[str, list[dict], float | None]:
    """Run the platform's profile scrape → normalized video records.

    DUAL MODE (chunk 25 — one pull surface): with VIDEOCLAW_API_KEY set the
    scrape routes through the gateway's `POST /v1/media/pull` with
    mode=enumerate — URL classification and actor choice are server-side, and
    the items come back ALREADY in this manifest shape (the backend ports
    _normalize_items field-for-field; do NOT re-normalize). If the DEPLOYED
    gateway doesn't have that route yet (404), the pre-25 keyed route
    (`enumerate_profile`) runs instead so spend still meters against the key —
    the direct-Apify path would bypass metering while keyed. Without a key the
    original direct-Apify path (APIFY_TOKEN) runs unchanged.

    Returns (platform, records, gateway_cost_usd_or_None).
    """
    gateway_cost: float | None = None
    _load_gateway_key()
    if gateway.enabled():
        payload: dict = {"url": profile_url, "mode": "enumerate", "limit": limit}
        if job_dir is not None:
            payload["client_job"] = job_dir.name
        print(f"[pull_video] gateway /v1/media/pull enumerate → {profile_url} (limit {limit})…")
        handle = _slugify(profile_url.rstrip("/").split("/")[-1] or profile_url)
        res = _gateway_media_pull(payload, timeout_s=900, job_dir=job_dir,
            output=manifest or (job_dir / "social_pull" / handle / uuid.uuid4().hex[:12] / "manifest.json" if job_dir else None))
        if res is not None:
            meta = res.get("metadata") or {}
            platform = meta.get("platform") or _detect_platform(profile_url) or "web"
            spend = {} if res.get("_operation_id") else res.get("spend") or {}
            return platform, list(res.get("items") or []), spend.get("cost_usd")
        # 404 → old deployed gateway: keep the pre-chunk-25 KEYED route.
        platform = _detect_platform(profile_url)
        if not platform:
            raise SystemExit(f"unsupported platform for {profile_url} (need instagram/tiktok).")
        payload = _apify_actor_input(platform, profile_url, limit)
        print(f"[apify] gateway enumerate_profile platform={platform} → {profile_url} (limit {limit})…")
        kw: dict = {"platform": platform, "params": payload, "timeout_s": 900}
        if job_dir is not None:
            kw["job"] = job_dir
        res = gateway.run("enumerate_profile", **kw)
        items = res["output"]["items"]
        # With a job, the generic fallback logs gateway_call; bespoke media/pull
        # above still reports its cost to the existing native event.
        gateway_cost = None if job_dir is not None else res.get("cost_usd")
    else:
        import requests  # lazy (matches the MVSep path)
        try:  # this tool doesn't load .env at import time; do it here for the token
            from dotenv import load_dotenv
            from _paths import ENV_PATH
            load_dotenv(ENV_PATH); load_dotenv()
        except Exception:
            pass
        token = os.environ.get("APIFY_TOKEN")
        if not token:
            raise SystemExit("APIFY_TOKEN not set (.env) — required for --mode enumerate.")
        platform = _detect_platform(profile_url)
        actor = APIFY_ACTORS.get(platform or "")
        if not actor:
            raise SystemExit(f"unsupported platform for {profile_url} (need instagram/tiktok).")
        payload = _apify_actor_input(platform, profile_url, limit)
        print(f"[apify] {actor} → {profile_url} (limit {limit})…")
        resp = requests.post(
            f"https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token={token}",
            json=payload, timeout=900,
        )
        resp.raise_for_status()
        items = resp.json() if isinstance(resp.json(), list) else []
    out: list[dict] = []
    for it in items:
        vurl = it.get("videoUrl") or (it.get("mediaUrls") or [None])[0]
        if not vurl and it.get("type") not in ("Video", "video"):
            continue  # skip images/sidecars with no video
        out.append({
            "url": it.get("url") or it.get("webVideoUrl"),
            "video_url": vurl,
            "caption": (it.get("caption") or it.get("text") or "").strip(),
            "views": it.get("videoPlayCount") or it.get("playCount"),
            "likes": it.get("likesCount") or it.get("diggCount"),
            "duration": it.get("videoDuration") or (it.get("videoMeta") or {}).get("duration"),
            "thumbnail": it.get("displayUrl") or (it.get("videoMeta") or {}).get("coverUrl"),
            "shortcode": it.get("shortCode") or it.get("id"),
            "timestamp": it.get("timestamp") or it.get("createTimeISO"),
        })
    return platform, out, gateway_cost


def _download_direct(url: str, dst: Path) -> bool:
    """Download a direct CDN video url with curl. Returns success."""
    try:
        _run(["curl", "-sL", "-A", "Mozilla/5.0", "--max-time", "180", "-o", str(dst), url])
        return dst.exists() and dst.stat().st_size > 10_000
    except Exception:
        return False


def cmd_enumerate(args, job_dir: Path) -> int:
    if not args.url:
        raise SystemExit("--mode enumerate requires --url <profile url>.")
    limit = args.limit if args.limit is not None else 30
    _load_gateway_key()
    recovery = gateway.enabled() and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1"
    handle = _slugify(args.url.rstrip("/").split("/")[-1] or args.url)
    recovered_dir = job_dir / "social_pull" / handle / uuid.uuid4().hex[:12]
    platform, items, gw_cost = _apify_enumerate(args.url, limit, job_dir=job_dir,
        **({"manifest": recovered_dir / "manifest.json"} if recovery else {}))
    outdir = recovered_dir if recovery else job_dir / "social_pull" / f"{platform}_{handle}"
    outdir.mkdir(parents=True, exist_ok=True)
    # rank by views (nulls last) so "download top N" = top performers
    items.sort(key=lambda x: (x.get("views") or 0), reverse=True)
    if not recovery:
        (outdir / "manifest.json").write_text(json.dumps(items, indent=2))
    print(f"[enumerate] {len(items)} video(s) → {outdir / 'manifest.json'}")
    for it in items[:8]:
        print(f"  {str(it.get('views') or '?'):>8} views · {it.get('url')} · {(it.get('caption') or '')[:48]}")
    # Single cost record for the enumerate call (mint_image precedent): the
    # gateway's metered figure lands here as estimate_usd (no job= passed to
    # gateway.run, so no duplicate gateway_call row).
    enum_extra = {"usage_role": "enumerate", "platform": platform,
                  "profile": args.url, "count": len(items)}
    if gw_cost is not None:
        enum_extra["estimate_usd"] = round(gw_cost, 4)
        enum_extra["gateway"] = True
    log_event(job_dir, tool="pull_video.py", event="enumerate",
              extra=enum_extra, render_md=False)

    n = args.download
    if n and n > 0:
        got = 0
        dl_cost = 0.0
        for i, it in enumerate(items[:n]):
            dst = outdir / f"{i+1:02d}_{it.get('shortcode') or i}.mp4"
            ok = it.get("video_url") and _download_direct(it["video_url"], dst)
            if not ok and it.get("url"):
                # Fallback: pull the permalink through the acquisition seam
                # (gateway pull mode when keyed — the endpoint's design — local
                # yt-dlp otherwise). A gateway REFUSAL (SystemExit) propagates:
                # a spend cap must stop the batch, not bypass to local.
                try:
                    _, extra = _acquire_video(
                        it["url"], outdir, stem=dst.stem, fmt=args.format,
                        job_dir=job_dir,
                        cookies_from_browser=args.cookies_from_browser,
                        cookies_file=args.cookies, force=True)
                    dl_cost += float(extra.get("estimate_usd") or 0.0)
                    ok = True
                except (Exception, DownloadError):
                    ok = False
            print(f"  {'✓' if ok else '✗'} {dst.name}")
            got += 1 if ok else 0
        if dl_cost > 0:
            log_event(job_dir, tool=TOOL, event="enumerate_downloads",
                      extra={"usage_role": "enumerate", "count": got,
                             "estimate_usd": round(dl_cost, 4), "gateway": True},
                      render_md=False)
        print(f"[enumerate] downloaded {got}/{n} → {outdir}")
    else:
        print("  (enumerate-only; pass --download N to fetch the top-N by views)")
    return 0


def cmd_search(args, job_dir: Path) -> int:
    """Search the typed Meta Ads capability; never execute an Actor locally."""
    if args.source != "meta_ads":
        raise SystemExit("--mode search requires --source meta_ads.")
    if not args.query or not args.query.strip():
        raise SystemExit("--mode search requires --query <search terms>.")
    _load_gateway_key()
    if not gateway.enabled():
        raise SystemExit(
            "Meta Ads search requires a connected VideoClaw gateway; "
            "direct Actor execution is intentionally unavailable."
        )
    limit = args.limit if args.limit is not None else {
        "quick": 100,
        "standard": 500,
        "deep": 1000,
    }[args.research_tier]
    payload = {
        "mode": "search",
        "source": "meta_ads",
        "query": args.query.strip(),
        "country": args.country.upper(),
        "active_status": "active",
        "media_type": "video",
        "limit": limit,
        "research_tier": args.research_tier,
        "min_active_days": args.min_active_days,
        "sort": args.sort,
        "client_job": job_dir.name,
    }
    print(
        "[pull_video] gateway Meta Ads search "
        f"{payload['query']!r} ({payload['country']}, {payload['research_tier']}, "
        f"limit {payload['limit']})…"
    )
    outdir = job_dir / "research" / "meta_ads"
    if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1":
        outdir /= uuid.uuid4().hex[:12]
    result = _gateway_media_pull(payload, timeout_s=900, job_dir=job_dir, output=outdir / "manifest.json")
    if result is None:
        raise SystemExit(
            "The connected gateway does not support Meta Ads search yet. "
            "Update the gateway; refusing an unmetered local Actor fallback."
        )
    outdir.mkdir(parents=True, exist_ok=True)
    manifest = outdir / "manifest.json"
    if not result.get("_operation_id"):
        manifest.write_text(json.dumps(result, indent=2), encoding="utf-8")
    count = len(result.get("items") or [])
    extra = {
        "usage_role": "search",
        "source": "meta_ads",
        "query": payload["query"],
        "country": payload["country"],
        "research_tier": payload["research_tier"],
        "min_active_days": payload["min_active_days"],
        "count": count,
        "output_path": str(manifest.relative_to(job_dir)),
        **_gw_spend(result),
    }
    log_event(
        job_dir,
        tool="pull_video.py",
        event="meta_ads_search_completed",
        extra=extra,
        render_md=False,
    )
    print(f"[search] {count} Meta video ad(s) → {manifest}")
    return 0


def cmd_pull(args, job_dir: Path) -> int:
    fdir = _footage_dir(job_dir)
    name = args.name or _slugify(args.url or args.file or "batch")

    # ── batch download path (download_top / download_all) ────────────────────
    if args.batch:
        list_path = billing_input_path(Path(args.batch).expanduser().resolve())
        if not list_path.exists():
            raise SystemExit(f"--batch list not found: {list_path}")
        raw = json.loads(list_path.read_text())
        rows = raw if isinstance(raw, list) else raw.get("videos", raw.get("picks", []))
        rows = [r for r in rows if isinstance(r, dict) and r.get("url")
                and r.get("type", "Video") == "Video"]
        videos_dir = fdir / (name if args.name else "batch")
        results = _batch_download(
            rows, videos_dir, max_workers=args.max_workers,
            fmt=args.format if args.format != YTDLP_FORMAT_BEST else YTDLP_FORMAT_720,
            timeout=args.batch_timeout,
        )
        ok = sum(1 for _, s, _ in results if s in ("ok", "skip"))
        log_event(job_dir, tool=TOOL, event="batch_downloaded",
                  extra={"usage_role": "pull", "mode": "pull", "count": len(results),
                         "ok": ok, "dir": str(videos_dir.relative_to(job_dir))})
        print(f"[pull_video] batch: {ok}/{len(results)} present → {videos_dir}")
        return 0

    # ── audio-only path (rip track, or MVSep bed) ────────────────────────────
    if args.audio_only:
        in_sec = _hms_to_seconds(args.in_ts)
        out_sec = _hms_to_seconds(args.out_ts)
        if args.bed:
            # No-vocals instrumental bed.
            slug = _slugify(args.url or args.file)
            work_dir = fdir / "borrowed_audio" / slug
            work_dir.mkdir(parents=True, exist_ok=True)
            gw_extra: dict = {}
            if args.file:
                src_video = Path(args.file).expanduser().resolve()
                if not src_video.exists():
                    raise SystemExit(f"--file does not exist: {src_video}")
            else:
                # Chunk 25: only the ACQUISITION half moves to the gateway —
                # the stem flow below keeps its own semantic gateway route.
                src_video, gw_extra = _acquire_video(
                    args.url, work_dir, stem="source",
                    fmt=YTDLP_FORMAT_AUDIO_SOURCE, job_dir=job_dir,
                    cookies_from_browser=args.cookies_from_browser,
                    cookies_file=args.cookies, force=args.force,
                )
            out_mp3 = Path(args.output) if args.output else (fdir / f"{name}.mp3")
            meta = _build_bed(
                src_video, work_dir, out_mp3, bed_name=name,
                trim_start=in_sec, trim_end=out_sec,
                keep_stems=args.keep_stems, provenance_url=args.url,
                job=job_dir,
            )
            log_event(job_dir, tool=TOOL, event="bed_built",
                      extra={"usage_role": "pull", "mode": "pull", "audio_only": True,
                             "bed": True, "out": str(out_mp3),
                             "model": meta["model"], **gw_extra})
            print(f"[pull_video] bed ready → {out_mp3}")
            return 0

        # Plain audio rip.
        out_audio = Path(args.output) if args.output else (fdir / f"{name}.mp3")
        gw_extra = {}
        if args.file:
            # Extract/transcode the track from a local file.
            src = Path(args.file).expanduser().resolve()
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src)]
            if in_sec is not None:
                cmd += ["-ss", f"{in_sec:.3f}"]
            if out_sec is not None:
                cmd += ["-to", f"{out_sec:.3f}"]
            cmd += ["-vn", "-c:a", "libmp3lame", "-q:a", "5", str(out_audio)]
            _run(cmd)
        else:
            # Chunk 25: --audio-only maps to the endpoint's audio_only when
            # keyed; a 404 route-miss (endpoint not deployed yet) falls back
            # to the local yt-dlp rip below.
            _load_gateway_key()
            got = (_gateway_audio_rip(args.url, out_audio, job_dir=job_dir,
                                      force=args.force)
                   if gateway.enabled() else None)
            if got is not None:
                gw_extra = got
                out_audio = Path(gw_extra.pop("_output_path", out_audio))
            else:
                _ytdlp_audio_only(
                    args.url, out_audio,
                    cookies_from_browser=args.cookies_from_browser,
                    cookies_file=args.cookies,
                )
            if in_sec is not None or out_sec is not None:
                # Trim the ripped track in place.
                tmp = out_audio.with_name(out_audio.stem + ".__trim.mp3")
                cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(out_audio)]
                if in_sec is not None:
                    cmd += ["-ss", f"{in_sec:.3f}"]
                if out_sec is not None:
                    cmd += ["-to", f"{out_sec:.3f}"]
                cmd += ["-c:a", "libmp3lame", "-q:a", "5", str(tmp)]
                _run(cmd)
                tmp.replace(out_audio)
        log_event(job_dir, tool=TOOL, event="audio_ripped",
                  extra={"usage_role": "pull", "mode": "pull", "audio_only": True,
                         "out": str(out_audio), **gw_extra})
        print(f"[pull_video] audio → {out_audio}")
        return 0

    # ── video path: download (or local) → optional cut/crop / montage ────────
    montage_cuts = _parse_montage(args.montage) if args.montage else None
    src, source_url, gw_extra = _resolve_source(args, job_dir)
    info = _probe(src)

    # Optional frame sampling for agent inspection.
    if args.sample_every:
        frames_dir = fdir / f"{name}_frames"
        n = _sample_frames(src, frames_dir, args.sample_every, info["duration_s"])
        print(f"[pull_video] sampled {n} frames every {args.sample_every}s → {frames_dir}")

    # Montage: multiple windows cut + concat (pull_footage.cmd_montage).
    if montage_cuts:
        cuts = montage_cuts
        out_path = Path(args.output) if args.output else (fdir / f"{name}.mp4")
        tmp_dir = fdir / f".__mtg_{name}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        clip_paths: list[Path] = []
        for i, (s, e) in enumerate(cuts):
            clip_out = tmp_dir / f"clip_{i:02d}.mp4"
            _cut_and_reframe(
                src, clip_out, start=s, end=e,
                crop_spec=args.crop, aspect=args.aspect,
                frame_mode=args.frame_mode, frame_x=args.frame_x, frame_y=args.frame_y,
                target_w=args.target_w, target_h=args.target_h,
                keep_audio=not args.no_audio,
            )
            clip_paths.append(clip_out)
        concat_list = tmp_dir / "concat.txt"
        concat_list.write_text("\n".join(f"file '{p}'" for p in clip_paths))
        _run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
              "-i", str(concat_list), "-c", "copy", str(out_path)])
        shutil.rmtree(tmp_dir, ignore_errors=True)
        log_event(job_dir, tool=TOOL, event="montage_built",
                  extra={"usage_role": "pull", "mode": "pull", "clips": len(cuts),
                         "out": str(out_path), **gw_extra})
        print(f"[pull_video] montage → {out_path} ({len(cuts)} clips)")
        return 0

    in_sec = _hms_to_seconds(args.in_ts)
    out_sec = _hms_to_seconds(args.out_ts)
    out_path = Path(args.output) if args.output else (fdir / f"{name}.mp4")

    if in_sec is None and out_sec is None and not args.crop and not args.aspect \
            and not args.target_w and not args.target_h and not args.no_audio:
        # Pure full download with no transform — just place it.
        if src.resolve() != out_path.resolve():
            shutil.copy2(src, out_path)
        out_w, out_h = info["width"], info["height"]
    else:
        out_path, out_w, out_h = _cut_and_reframe(
            src, out_path, start=in_sec, end=out_sec,
            crop_spec=args.crop, aspect=args.aspect,
            frame_mode=args.frame_mode, frame_x=args.frame_x, frame_y=args.frame_y,
            target_w=args.target_w, target_h=args.target_h,
            keep_audio=not args.no_audio,
        )

    log_event(job_dir, tool=TOOL, event="footage_pulled",
              extra={"usage_role": "pull", "mode": "pull", "name": name,
                     "source_url": source_url, "out": str(out_path),
                     "out_w": out_w, "out_h": out_h,
                     "in": in_sec, "out_sec": out_sec, **gw_extra})
    dur = _probe(out_path)["duration_s"] if out_path.exists() else 0.0
    print(f"[pull_video] {name}: {out_w}x{out_h}, {dur:.2f}s → {out_path}")
    return 0


def cmd_select(args, job_dir: Path) -> int:
    fdir = _footage_dir(job_dir)
    name = _default_name(args)

    src, source_url, gw_extra = _resolve_source(args, job_dir)
    info = _probe(src)

    window = _gemini_pick_window(
        src, info["duration_s"], args.prompt, job_dir=job_dir,
    )

    out_path = Path(args.output) if args.output else (fdir / f"{name}.mp4")
    out_path, out_w, out_h = _cut_and_reframe(
        src, out_path, start=window["in"], end=window["out"],
        crop_spec=args.crop, aspect=args.aspect,
        frame_mode=args.frame_mode, frame_x=args.frame_x, frame_y=args.frame_y,
        target_w=args.target_w, target_h=args.target_h,
        keep_audio=not args.no_audio,
    )

    sidecar = out_path.with_name(f"{name}_select.json")
    sidecar.write_text(json.dumps({
        "source_url": source_url,
        "in": window["in"],
        "out": window["out"],
        "rationale": window["rationale"],
        "clamped": window["clamped"],
        "look_for": window["look_for"],
        "clip": str(out_path),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }, indent=2))

    log_event(job_dir, tool=TOOL, event="footage_selected",
              extra={"usage_role": "select", "mode": "select", "name": name,
                     "source_url": source_url, "in": window["in"],
                     "out_sec": window["out"], "out": str(out_path), **gw_extra})
    print(f"[pull_video] select → {out_path} "
          f"[{window['in']:.2f}-{window['out']:.2f}s]  ({out_w}x{out_h})")
    print(f"[pull_video] rationale: {window['rationale']}")
    print(f"[pull_video] sidecar → {sidecar}")
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════════

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, 
        description="pull_video — pull, cut, crop, and rip external video. "
                    "--mode picks the acquisition shape.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(p)
    p.add_argument("--limit", type=int,
                   help="maximum records (enumerate: 30; search: tier default).")
    p.add_argument("--download", type=int, default=0,
                   help="enumerate: also download the top-N (by views). 0 = list only.")
    p.add_argument("--mode", required=True,
                   choices=["pull", "select", "enumerate", "search"],
                   help="Acquisition shape. Logged as usage_role. "
                        "pull = download+cut/crop/rip; select = Gemini timestamp-windowing.")

    # Source
    p.add_argument("--url", help="Remote video URL (YouTube / IG / TikTok / X).")
    p.add_argument("--source", choices=["meta_ads"],
                   help="search: typed research source (currently meta_ads).")
    p.add_argument("--query", help="search: public ad-library search terms.")
    p.add_argument("--country", default="US",
                   help="search: two-letter audience country (default: US).")
    p.add_argument("--research-tier", default="standard",
                   choices=["quick", "standard", "deep"],
                   help="search: hard gateway budget tier ($1 / $3 / $8).")
    p.add_argument("--min-active-days", type=int, default=0,
                   help="search: retain ads active for at least this many days.")
    p.add_argument("--sort", default="longest_running",
                   choices=["longest_running", "meta_relevance"],
                   help="search: evidence ordering (default: longest_running).")
    p.add_argument("--file", help="Local video file (skips yt-dlp).")
    p.add_argument("--name", help="Output stem (→ footage/<name>.mp4). "
                                  "Defaults to a slug of the URL / local filename.")
    p.add_argument("--output", help="Explicit output path (overrides footage/<name>.*).")
    p.add_argument("--purpose", choices=["reference", "footage"], default="footage",
                   help="What the pulled video is for. reference = only to watch, "
                        "analyse or copy the style of (cheapest: YouTube at 360p); "
                        "footage = it appears in the video (up to 720p). "
                        "Default: footage. Gateway video pulls only.")

    # Window + crop
    p.add_argument("--in", dest="in_ts",
                   help="In point HH:MM:SS(.ms) / MM:SS / seconds (pull window start).")
    p.add_argument("--out", dest="out_ts",
                   help="Out point HH:MM:SS(.ms) / MM:SS / seconds (pull window end).")
    p.add_argument("--crop",
                   help="Raw ffmpeg crop 'w:h:x:y' (verbatim, no subject centering).")
    p.add_argument("--aspect",
                   help="Subject-aware reframe target e.g. 1:1 / 9:16 / 16:9. "
                        "Uses --frame-mode to pick the crop center.")
    p.add_argument("--frame-mode", default="face", choices=["center", "face", "contain", "manual"],
                   help="Framing for --aspect: natural face crop / center crop / explicit full-source contain / manual x,y.")
    p.add_argument("--frame-x", type=float, default=0.5, help="manual frame center x (0-1).")
    p.add_argument("--frame-y", type=float, default=0.5, help="manual frame center y (0-1).")
    p.add_argument("--target-w", type=int, help="Optional final scale width.")
    p.add_argument("--target-h", type=int, help="Optional final scale height.")
    p.add_argument("--no-audio", action="store_true",
                   help="Drop the audio track from the cut/cropped clip.")

    # Audio-only / bed
    p.add_argument("--audio-only", action="store_true",
                   help="Rip the audio track instead of producing a video clip.")
    p.add_argument("--bed", action="store_true",
                   help="With --audio-only: MVSep stem-separate and mix a no-vocals "
                        "instrumental bed (drops the vocals stem).")
    p.add_argument("--keep-stems", action="store_true",
                   help="bed: keep the stems/ dir for inspection (default: discard).")

    # Frame sampling + montage
    p.add_argument("--sample-every", type=float,
                   help="Also extract 1 sample frame every N seconds for inspection.")
    p.add_argument("--montage",
                   help="Cut multiple windows and concat: 'start-end,start-end' where each "
                        "time is HH:MM:SS(.ms) / MM:SS / seconds (e.g. '1:05-1:12,90-95.5'). "
                        "Legacy 'a:b' still works for bare seconds.")

    # Batch download
    p.add_argument("--batch",
                   help="JSON list of {url, shortCode|id} rows → bulk yt-dlp download "
                        "(parallel, height<=720, skip-existing).")
    p.add_argument("--max-workers", type=int, default=4, help="batch parallel workers.")
    p.add_argument("--batch-timeout", type=int, default=240, help="batch per-clip timeout (s).")

    # Download knobs
    p.add_argument("--format", default=YTDLP_FORMAT_BEST,
                   help="yt-dlp -f format selector (default: best mp4+audio).")
    p.add_argument("--cookies-from-browser",
                   help="yt-dlp --cookies-from-browser <browser> (IG/auth-walls).")
    p.add_argument("--cookies", help="yt-dlp --cookies <cookies.txt>.")
    p.add_argument("--force", action="store_true", help="Re-download even if cached.")

    # select mode
    p.add_argument("--prompt",
                   help="select: what Gemini should look for "
                        "(e.g. 'the moment she shows the transformation result').")
    return p


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    """Runtime-authoritative acquisition fan-out and mode semantics."""
    role = (f"meta_ads_{args.research_tier}"
            if args.mode == "search" else args.mode)
    count = 1
    components = None
    if args.mode == "enumerate":
        count = 1 + args.download
        components = [{"role": "enumerate", "count": 1},
                      {"role": "pull", "count": args.download}]
    elif args.mode == "pull" and args.audio_only and args.bed:
        role = "bed"
    inputs = []
    for dest in ("file", "batch", "cookies"):
        value = getattr(args, dest)
        if value:
            path = Path(value).expanduser()
            if not path.is_absolute():
                path = cwd / path
            inputs.append({"path": str(path.absolute()), "dest": dest})
    if args.mode == "pull" and args.batch:
        batch_path = Path(args.batch).expanduser()
        if not batch_path.is_absolute():
            batch_path = cwd / batch_path
        payload = json.loads(billing_input_path(batch_path.absolute()).read_text())
        rows = payload if isinstance(payload, list) else payload.get("videos", payload.get("picks", []))
        executable = [row for row in rows if isinstance(row, dict) and row.get("url")
                      and row.get("type", "Video") == "Video"]
        if not executable:
            raise ValueError("pull batch has no executable videos")
        count = len(executable)
    return {"role": role, "count": count, "inputs": inputs,
            **({"price_components": components} if components is not None else {})}


def main() -> int:
    args = build_parser().parse_args()
    job_dir = resolve_job_dir(args.job)
    if args.mode == "pull":
        return cmd_pull(args, job_dir)
    if args.mode == "select":
        return cmd_select(args, job_dir)
    if args.mode == "enumerate":
        return cmd_enumerate(args, job_dir)
    if args.mode == "search":
        return cmd_search(args, job_dir)
    raise SystemExit(f"unknown mode: {args.mode}")


if __name__ == "__main__":
    sys.exit(main())
