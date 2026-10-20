#!/usr/bin/env python
"""
lipsync_footage.py — CANONICAL real-footage lipsync tool (the A-roll path).

Turns real recorded footage + a clean, densified audio track into tight,
lipsynced talking-head segments. **Only fal sync-3 (`fal-ai/sync-lipsync/v3`)** —
per Joseph's STANDING RULE, sync-3 is the only lip-sync model to ever use. The
retired `sync/lipsync-2-pro` / Replicate-sync path is GONE; if sync-3 is
unavailable, flag for a human re-attempt rather than falling back.

This file is SELF-CONTAINED. It absorbs and re-implements, in one place, the
logic that previously lived across five backends:
  - aroll.py            (fal sync-3 plan/gen on on-camera windows — the CANON)
  - lipsync_long.py     (split-at-silence → lipsync each chunk → concat; now sync-3)
  - composite_lipsync.py(composite a lipsynced crop back over the wider base)
  - motion_envelope.py  (motion-bbox 9:16 crop region via median-background diff)
  - face_envelope.py    (face-bbox 9:16 crop region via Haar cascade)

It depends ONLY on low-level shared helpers that survive (_paths, _ffmpeg, job,
log). It does NOT import any of the absorbed backends (they are deleted) and does
NOT depend on lipsync_run.py.

MODES (argparse subcommands)
  reels — on-camera-window lipsync (the canonical reel path):
    plan            compute on-camera windows from beats.json (no API, no cost)
    gen             lipsync ONLY those windows with fal sync-3
  episodes — long-form:
    long            lipsync a clip of ANY length by auto-splitting at silence
  crop-planning (pre-crop bbox for tight-face lipsync):
    face-envelope   face-detection-anchored 9:16 crop region (Haar cascade)
    motion-envelope motion-envelope 9:16 crop region (median-background diff)
  compositing:
    composite       composite a lipsynced crop back over the wider base video

JOB LAYOUT
  Every mode reads and writes inside the job directory (jobs/<job-id>/, i.e.
  $VIDEOCLAW_JOBS_DIR/<job-id>), never the installed engine. plan / gen use:
      <job>/edit/beats.json
      <job>/edit/audio_densified.mp3
      <job>/<base>
      <job>/edit/aroll/<window>.mp4
  face-envelope / motion-envelope / composite read/write `<job>/bbox_union.json`.
  (Before videoclaw#273 plan/gen used <engine>/projects/<job>/, which the app
  replaces on every engine update.)

PARALLEL PAID WORK
  gen submits every window at once and long submits every segment at once
  (bounded by --parallel, default 4), so a wave costs about one window's
  wall-clock. Each paid result is named by its request (window/segment bounds
  and source files), so a changed window never collides with an earlier paid
  result and an interrupted run resumes its own result instead of buying it
  again. `gen --force` always buys a new take.

A "beat spec" lives at <job>/edit/beats.json:
  { "fps": 24, "duration": 64.74, "base": "02_base_segment.mp4",
    "beats": [ {"name":"b3","start":10.0,"end":15.96,"mode":"split","on_camera":true}, ... ] }
  mode:  "split" (top B-roll + face in bottom band) or "full"
  on_camera: is the face on screen this beat?  (legacy alias "joseph" still read)
          - split beats are ALWAYS on_camera:true (the band shows the face)
          - full beats: true = full-frame, false = B-roll hijack (no face)
  Only on_camera:true beats become lip-sync windows.

EXAMPLES
  uv run python tools/lipsync_footage.py plan --job batch2_20_hook_a
  uv run --with fal-client python tools/lipsync_footage.py gen --job batch2_20_hook_a [--force] [--parallel 4]
  uv run --with fal-client python tools/lipsync_footage.py long \
      --job _authority_host --video bed.mp4 --audio vo.mp3 --output ep2_lipsync.mp4
  uv run python tools/lipsync_footage.py face-envelope --job <id> --video base.mp4
  uv run python tools/lipsync_footage.py motion-envelope --job <id> --video base.mp4
  uv run python tools/lipsync_footage.py composite --job <id> \
      --base base.mp4 --lipsync ls.mp4 --output final.mp4 --feather 30
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _paths import REPO_ROOT, ENV_PATH, OUTPUT_ROOT  # noqa: E402
from job import (  # noqa: E402
    add_job_arg, resolve_job_dir, resolve_job_input_path, resolve_job_output_path,
)
from log import log_event  # noqa: E402
from _gateway import (  # noqa: E402  dual mode: VIDEOCLAW_API_KEY set → gateway routes the call
    gateway, GatewayAcceptedError, GatewayAuthorizationError, GatewayDestinationClaimedError,
    GatewayNotSubmittedError,
)

TOOL = "lipsync_footage.py"

# ---------------------------------------------------------------------------
# Constants preserved verbatim from the absorbed backends.
# ---------------------------------------------------------------------------
SYNC3_MODEL = "fal-ai/sync-lipsync/v3"  # the ONLY lip-sync model (Joseph's standing rule)
PRICE_PER_MIN = 8.0  # fal sync-3 — $8.00/min of a-roll
# sync-3 comes out very slightly flat/dark vs the real source footage. This gentle
# lift matches it back to the REAL footage (measured: luma 135.4 / SATAVG 15.0).
# sync-3 badly WASHES OUT footage (lifts blacks → milky, kills contrast + saturation); the old
# subtle grade (sat 1.01/contrast 1.02) did almost nothing. This restores the real look —
# frame-matched against the ungraded base take (2026-07-01, JC flagged the wash-out).
GRADE = "eq=contrast=1.22:saturation=1.32:gamma=0.96"
# band crop (bottom 840 at y=380) for split beats
BAND_CROP = "crop=1080:840:0:380"


# ---------------------------------------------------------------------------
# Shared low-level helpers
# ---------------------------------------------------------------------------
def load_dotenv_fal() -> None:
    """Map FAL_API_KEY -> FAL_KEY (what fal_client reads). Reads .env if needed.

    Preserves the aroll.py behaviour exactly: load every KEY=VALUE from the repo
    `.env` (without clobbering already-set env), then alias FAL_API_KEY→FAL_KEY.
    """
    env = ENV_PATH
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("FAL_KEY") and os.environ.get("FAL_API_KEY"):
        os.environ["FAL_KEY"] = os.environ["FAL_API_KEY"]


DEFAULT_PARALLEL = 4


def project_dir(job: str) -> Path:
    """The a-roll layout root: the job directory itself (never the engine).

    Mirrors resolve_job_dir without creating anything: plan is free and may run
    before production, and must not invent a job as a side effect.
    """
    as_path = Path(job)
    return as_path if as_path.is_dir() else OUTPUT_ROOT / job


def _source_identity(path: Path) -> list:
    st = path.stat()
    return [str(path.resolve()), st.st_size, st.st_mtime_ns]


def raw_name(dst: Path, request: dict, *, fresh: bool = False) -> Path:
    """Where one paid sync-3 result lands, named by what was asked for.

    A fixed name like `w1_raw.mp4` made every retake of a changed window pay
    and then fail with FileExistsError (videoclaw#273; a 53.8 s window was
    paid twice). Naming the result by its request instead means a changed
    window or new audio is a new name, while an interrupted run of the SAME
    request finds its own paid result (resumed below, never bought again) or
    its still-unfinished operation (refused before payment by the journal).
    `fresh` (gen --force) always buys a new take.
    """
    tag = (uuid.uuid4().hex[:16] if fresh else
           hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16])
    return dst.with_name(f"{dst.stem}_raw-{tag}.mp4")


def _paid_result(raw: Path) -> bool:
    """A delivered result is published whole (link/rename), so any file is complete."""
    return raw.is_file() and raw.stat().st_size > 0


@contextmanager
def exclusive_output(lock_path: Path, what: str):
    """Own one lip-sync product for the whole paid run, or refuse before paying.

    Unique intermediates stop a paid result colliding with an OLD file, but two
    runs producing the same window at once would still both pay and then
    overwrite each other's product. flock releases itself when a process dies,
    so a crash never leaves a stale claim.
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = -1
    for _ in range(64):
        try:
            fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            break
        except FileNotFoundError:
            continue  # macOS can report ENOENT while a sibling creates the leaf (#273)
    if fd < 0:
        raise OSError(f"could not open the lip-sync lock for {what}")
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise GatewayNotSubmittedError(
                f"another lip-sync run is producing {what} right now; nothing was submitted "
                "or charged. Wait for it instead of starting the same window twice.") from exc
        yield
    finally:
        os.close(fd)


def _failure_note(exc: BaseException) -> str:
    if isinstance(exc, GatewayDestinationClaimedError):
        # videoclaw#294: an earlier purchase owns this window's result name.
        if exc.blocked:
            return f"nothing was charged; do not re-run it unchanged: {exc}"
        return f"nothing was charged; an earlier paid request delivers it, do NOT re-run it: {exc}"
    if isinstance(exc, GatewayNotSubmittedError):
        return f"nothing was charged; safe to retry: {exc}"
    if isinstance(exc, GatewayAcceptedError):
        return ("accepted by the gateway and may be charged; do NOT re-run it, "
                f"recovery keeps the original result: {exc}")
    return f"{type(exc).__name__}: {exc}"


def run_paid_wave(work: list[tuple[str, Callable[[], None]]], parallel: int) -> None:
    """Submit every paid window at once (bounded) and report each failure.

    One failed window never stops its siblings. Any failure exits non-zero
    after all windows finished; an authorization refusal is re-raised so the
    CLI still prints its structured authorization_required payload.
    """
    if not work:
        return
    width = max(1, min(parallel, len(work)))

    def attempt(item: tuple[str, Callable[[], None]]) -> tuple[str, BaseException | None]:
        label, fn = item
        try:
            fn()
            return label, None
        except (Exception, SystemExit) as exc:
            return label, exc

    if width == 1:
        outcomes = [attempt(item) for item in work]
    else:
        print(f"[lipsync_footage] {len(work)} paid window(s), {width} at a time", flush=True)
        with ThreadPoolExecutor(max_workers=width) as pool:
            outcomes = list(pool.map(attempt, work))
    failures = [(label, exc) for label, exc in outcomes if exc is not None]
    if not failures:
        return
    for label, exc in failures:
        print(f"  ✗ {label}: {_failure_note(exc)}", file=sys.stderr, flush=True)
    for _, exc in failures:
        if isinstance(exc, GatewayAuthorizationError):
            raise exc
    sys.exit(f"[lipsync_footage] {len(failures)}/{len(work)} window(s) failed; "
             "the others are saved")


def ff(args: list[str]) -> None:
    """ffmpeg shorthand (quiet, -y). Matches aroll.py's helper exactly."""
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def probe_dur(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def fal_lipsync(video_path: Path, audio_path: Path, out_raw: Path,
                job_dir: Path | None = None) -> None:
    """Upload video+audio to fal, run sync-3 (sync_mode cut_off), download result.

    This is the single canonical sync-3 call shared by every mode. Inlines the
    upload→subscribe→download pattern from aroll.py.gen (and replaces
    lipsync_run.py's retired Replicate path for the long-form mode).

    DUAL MODE: with VIDEOCLAW_API_KEY set the call routes through the
    videoclaw-backend gateway (references[0]→video_url, references[1]→audio_url
    server-side); otherwise the raw fal_client path below runs unchanged.
    `job_dir` (gateway mode only) makes gateway.run log the metered cost event —
    this tool logs no estimate_usd of its own, so there is no double count.
    """
    if gateway.enabled():
        res = gateway.run(
            "lipsync", mode="window",
            references=[video_path, audio_path],  # signed-GCS upload; server maps [0]→video_url, [1]→audio_url
            params={"sync_mode": "cut_off"},
            seconds=probe_dur(audio_path),  # cut_off trims video to the audio → audio dur drives $-metering
            job=job_dir,
            timeout_s=3600,
            _delivery=[out_raw],
        )
        gateway.download_asset(res["assets"][0], out_raw)
        return
    import fal_client
    video_url = fal_client.upload_file(str(video_path))
    audio_url = fal_client.upload_file(str(audio_path))
    res = fal_client.subscribe(
        SYNC3_MODEL,
        arguments={"video_url": video_url, "audio_url": audio_url, "sync_mode": "cut_off"},
        with_logs=False,
    )
    # Publish whole: a resumed run treats any file at out_raw as a paid result.
    partial = out_raw.with_name(f".{out_raw.name}.{os.getpid()}.part")
    try:
        urllib.request.urlretrieve(res["video"]["url"], str(partial))
        partial.replace(out_raw)
    finally:
        partial.unlink(missing_ok=True)


# ===========================================================================
# MODE: plan  (reels)  — absorbed from aroll.py.cmd_plan / compute_windows
# ===========================================================================
def read_spec(job: str) -> dict:
    p = project_dir(job) / "edit" / "beats.json"
    if not p.exists():
        legacy = REPO_ROOT / "projects" / job / "edit" / "beats.json"
        hint = (f" A beat spec from the old engine-folder layout exists at {legacy}; "
                f"copy that job's edit/ files and base take into {project_dir(job)}."
                if legacy.exists() else "")
        sys.exit(f"[lipsync_footage] no beat spec at {p} — author it first "
                 f"(see module docstring).{hint}")
    return json.loads(p.read_text())


def _on_camera(b: dict) -> bool:
    """Canonical key is "on_camera"; "joseph" is the legacy alias (pre-2026-07 beat specs)."""
    return bool(b.get("on_camera", b.get("joseph")))


def compute_windows(spec: dict):
    """Merge contiguous on-camera beats into lip-sync windows. Returns (windows, report)."""
    beats = sorted(spec["beats"], key=lambda b: b["start"])
    on = [b for b in beats if _on_camera(b)]
    windows: list[dict] = []
    cur = None
    for b in beats:
        is_on = _on_camera(b)
        if is_on:
            if cur and abs(b["start"] - cur["end"]) < 1e-6:
                cur["end"] = b["end"]
                cur["beats"].append(b["name"])
            else:
                if cur:
                    windows.append(cur)
                cur = {"id": f"w{len(windows)+1}", "start": b["start"], "end": b["end"],
                       "beats": [b["name"]]}
    if cur:
        windows.append(cur)
    # completeness: every on-camera beat lands in exactly one window
    covered = {n for w in windows for n in w["beats"]}
    missing = [b["name"] for b in on if b["name"] not in covered]
    for w in windows:
        w["dur"] = round(w["end"] - w["start"], 3)
    total = round(sum(w["dur"] for w in windows), 2)
    report = {
        "windows": len(windows), "aroll_seconds": total,
        "reel_seconds": spec.get("duration"),
        "on_camera_pct": round(100 * total / spec["duration"], 1) if spec.get("duration") else None,
        "cost_usd": round(total / 60 * PRICE_PER_MIN, 2),
        "on_camera_beats": [b["name"] for b in on],
        "missing": missing,
    }
    return windows, report


def _beats_of(spec, w):
    names = set(w["beats"])
    return [b for b in spec["beats"] if b["name"] in names]


def _full(spec, w):
    return all(b["mode"] == "full" for b in _beats_of(spec, w))


def _mixed(spec, w):
    modes = {b["mode"] for b in _beats_of(spec, w)}
    return len(modes) > 1


def cmd_plan(job: str):
    spec = read_spec(job)
    windows, report = compute_windows(spec)
    print(f"[plan] {job}")
    for w in windows:
        framing = "band+full" if _mixed(spec, w) else ("full" if _full(spec, w) else "band")
        print(f"  {w['id']}: {w['start']:>6.2f}–{w['end']:>6.2f}s  ({w['dur']:>5.2f}s)  "
              f"beats={','.join(w['beats'])}  framing={framing}")
    print(f"  → {report['aroll_seconds']}s a-roll over {len(windows)} windows "
          f"({report['on_camera_pct']}% on camera) ≈ ${report['cost_usd']}")
    if report["missing"]:
        print(f"  ⚠ NOT COVERED: {report['missing']}")
    else:
        print(f"  ✓ all {len(report['on_camera_beats'])} on-camera beats covered")
    jd = project_dir(job)
    out = jd / "edit" / "aroll_windows.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"job": job, "base": spec.get("base", "02_base_segment.mp4"),
                               "windows": windows, "report": report}, indent=2))
    print(f"  wrote {out}")
    try:
        log_event(jd, TOOL, "plan", extra={
            "usage_role": "reels", "windows": report["windows"],
            "aroll_seconds": report["aroll_seconds"], "on_camera_pct": report["on_camera_pct"],
            "cost_usd": report["cost_usd"], "missing": report["missing"],
        })
    except Exception:
        pass
    return windows, report


# ===========================================================================
# MODE: gen  (reels)  — absorbed from aroll.py.cmd_gen
# ===========================================================================
def cmd_gen(job: str, force: bool, parallel: int = DEFAULT_PARALLEL):
    load_dotenv_fal()
    if not gateway.enabled() and not os.environ.get("FAL_KEY"):
        sys.exit("[lipsync_footage] FAL_KEY/FAL_API_KEY not set — add FAL_API_KEY to .env "
                 "(or set VIDEOCLAW_API_KEY to route via the gateway)")

    spec = read_spec(job)
    windows, report = compute_windows(spec)
    jd = project_dir(job)
    base = jd / spec.get("base", "02_base_segment.mp4")
    audio = jd / "edit" / "audio_densified.mp3"
    aroll = jd / "edit" / "aroll"
    aroll.mkdir(parents=True, exist_ok=True)
    tmp = aroll / "_tmp"
    tmp.mkdir(exist_ok=True)
    print(f"[gen] {job}: {len(windows)} windows, {report['aroll_seconds']}s ≈ ${report['cost_usd']}")

    def produce_window(w, full_out, band_out):
        dur = w["dur"]
        raw = window_raw(tmp, w, base, audio, fresh=force)
        t0 = time.perf_counter()
        if _paid_result(raw):
            print(f"  {w['id']}: reusing its paid sync-3 result {raw.name}", flush=True)
        else:
            a_wav = tmp / f"{w['id']}.wav"
            b_mp4 = tmp / f"{w['id']}_base.mp4"
            ff(["-ss", str(w["start"]), "-i", str(audio), "-t", str(dur), "-c:a", "pcm_s16le", str(a_wav)])
            # base face footage of the same length (framing is constant across the take)
            ff(["-ss", str(w["start"]), "-i", str(base), "-t", str(dur), "-an",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", str(b_mp4)])
            print(f"  {w['id']}: uploading ({w['dur']}s) → sync-3…", flush=True)
            fal_lipsync(b_mp4, a_wav, raw, job_dir=jd)
        # warm grade to match the original look (sync-3 washes out)
        ff(["-i", str(raw), "-vf", GRADE, "-an",
            "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", str(full_out)])
        # band crop (bottom 840 at y=380), from the graded full
        ff(["-i", str(full_out), "-vf", BAND_CROP, "-an",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", str(band_out)])
        # The raw stays: it is the paid original, and an interrupted run resumes from it.
        print(f"  {w['id']}: ✓ {full_out.name} + {band_out.name}", flush=True)
        try:
            log_event(jd, TOOL, "gen_window", duration_seconds=time.perf_counter() - t0, extra={
                "usage_role": "reels", "model": SYNC3_MODEL, "window": w["id"], "window_sec": w["dur"],
            })
        except Exception:
            pass

    work: list[tuple[str, Callable[[], None]]] = []
    for w in windows:
        full_out = aroll / f"{w['id']}.mp4"
        band_out = aroll / f"{w['id']}_band.mp4"
        if full_out.exists() and band_out.exists() and not force:
            print(f"  {w['id']}: exists, skip (use --force)")
            continue

        def window(w=w, full_out=full_out, band_out=band_out):
            with exclusive_output(tmp / f".{w['id']}.lock", f"window {w['id']}"):
                if full_out.exists() and band_out.exists() and not force:
                    print(f"  {w['id']}: finished by another run, skip", flush=True)
                    return
                produce_window(w, full_out, band_out)

        work.append((w["id"], window))
    run_paid_wave(work, parallel)
    print("[gen] done")


def window_raw(tmp: Path, w: dict, base: Path, audio: Path, *, fresh: bool = False) -> Path:
    """The paid result name for one reel window (see raw_name)."""
    return raw_name(tmp / f"{w['id']}.mp4", {
        "model": SYNC3_MODEL, "sync_mode": "cut_off", "base": _source_identity(base),
        "audio": _source_identity(audio), "start": w["start"], "end": w["end"]}, fresh=fresh)


# ===========================================================================
# MODE: long  (episodes)  — absorbed from lipsync_long.py, sync-3 only
# ===========================================================================
def silence_centers(audio: Path) -> list[float]:
    """Return the centers of detected silence intervals (sorted)."""
    out = subprocess.run(
        ["ffmpeg", "-i", str(audio), "-af", "silencedetect=noise=-30dB:d=0.18", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", out)]
    centers = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else s + 0.2
        centers.append((s + e) / 2.0)
    return sorted(centers)


def pick_splits(total: float, max_seg: float, centers: list[float]) -> list[float]:
    n = max(1, math.ceil(total / max_seg))
    if n == 1:
        return []
    splits = []
    for i in range(1, n):
        target = total * i / n
        # nearest silence center within ±8s of target, else hard cut at target
        cand = [c for c in centers if abs(c - target) <= 8.0]
        splits.append(min(cand, key=lambda c: abs(c - target)) if cand else target)
    # de-dup / ensure increasing
    out = []
    for s in splits:
        if not out or s - out[-1] > 1.0:
            out.append(round(s, 2))
    return out


def cmd_long(job: str, video: Path, audio: Path, out: Path, max_seg: float,
             parallel: int = DEFAULT_PARALLEL):
    """Lipsync a clip of ANY length by auto-splitting at silence, sync-3 per
    segment (all segments submitted at once), then concat. Replaces
    lipsync_long.py — but each segment goes through fal sync-3 (NOT the retired
    sync/lipsync-2-pro Replicate path).
    """
    load_dotenv_fal()
    if not gateway.enabled() and not os.environ.get("FAL_KEY"):
        sys.exit("[lipsync_footage] FAL_KEY/FAL_API_KEY not set — add FAL_API_KEY to .env "
                 "(or set VIDEOCLAW_API_KEY to route via the gateway)")

    jd = resolve_job_dir(job)
    # Media paths are job-relative (absolute paths stay explicit) and the
    # output must land inside this job, whatever directory the tool runs from.
    video = resolve_job_input_path(str(video), jd)
    audio = resolve_job_input_path(str(audio), jd)
    try:
        out = resolve_job_output_path(str(out), jd)
    except ValueError as exc:
        sys.exit(f"[lipsync_footage] {exc}")
    if not video.exists():
        sys.exit(f"[lipsync_footage] video not found: {video}")
    if not audio.exists():
        sys.exit(f"[lipsync_footage] audio not found: {audio}")

    total = probe_dur(audio)
    work = out.parent / f"_lipsync_segs_{out.stem}"
    work.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with exclusive_output(work / ".lock", out.name):
            _long_locked(jd, video, audio, out, max_seg, parallel, total, work)
    except GatewayNotSubmittedError as exc:
        sys.exit(f"[lipsync_footage] {exc}")


def _long_locked(jd: Path, video: Path, audio: Path, out: Path, max_seg: float,
                 parallel: int, total: float, work: Path) -> None:

    sources = {"model": SYNC3_MODEL, "sync_mode": "cut_off",
               "video": _source_identity(video), "audio": _source_identity(audio)}

    def _one(v: Path, a: Path, dst: Path, start: float, end: float):
        raw = raw_name(dst, {**sources, "start": start, "end": end})
        if _paid_result(raw):
            print(f"[long] reusing the paid sync-3 result {raw.name}", flush=True)
        else:
            fal_lipsync(v, a, raw, job_dir=jd)
        if not raw.exists() or raw.stat().st_size == 0:
            sys.exit(f"[lipsync_footage] sync-3 produced no output for {dst.name}")
        # mux: keep sync-3 video+audio as-is (re-encode for concat safety). The
        # raw stays as the paid original an interrupted run resumes from.
        ff(["-i", str(raw), "-c:v", "libx264", "-crf", "18", "-preset", "medium",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(dst)])

    t0 = time.perf_counter()
    if total <= max_seg:
        print(f"[long] {total:.1f}s <= {max_seg}s — single segment")
        run_paid_wave([(out.name, lambda: _one(video, audio, out, 0.0, round(total, 3)))], 1)
        print(f"[long] done → {out}")
        try:
            log_event(jd, TOOL, "long", duration_seconds=time.perf_counter() - t0, extra={
                "usage_role": "episodes", "model": SYNC3_MODEL, "segments": 1,
                "total_sec": round(total, 2), "output": str(out),
            })
        except Exception:
            pass
        return

    splits = pick_splits(total, max_seg, silence_centers(audio))
    bounds = [0.0] + splits + [total]
    print(f"[long] {total:.1f}s → {len(bounds)-1} segments at {splits}")

    seg_outs = []
    segments: list[tuple[str, Callable[[], None]]] = []
    for i in range(len(bounds) - 1):
        s, e = bounds[i], bounds[i + 1]
        a_seg = work / f"seg_{i}_audio.wav"
        v_seg = work / f"seg_{i}_video.mp4"
        ls_seg = work / f"seg_{i}_lipsync.mp4"
        # audio segment as pcm wav (sync-3 prefers wav, matches reel gen path)
        ff(["-ss", f"{s}", "-to", f"{e}", "-i", str(audio), "-c:a", "pcm_s16le", str(a_seg)])
        # silent video bed of the same window
        ff(["-ss", f"{s}", "-to", f"{e}", "-i", str(video), "-c:v", "libx264", "-crf", "18",
            "-preset", "medium", "-pix_fmt", "yuv420p", "-an", str(v_seg)])
        print(f"[long] segment {i+1}/{len(bounds)-1}  [{s:.1f}-{e:.1f}s] sync-3…", flush=True)
        segments.append((f"segment {i + 1}",
                         lambda v=v_seg, a=a_seg, d=ls_seg, s=s, e=e: _one(v, a, d, s, e)))
        seg_outs.append(ls_seg)
    run_paid_wave(segments, parallel)

    lst = work / "_concat.txt"
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in seg_outs))
    ff(["-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-crf", "18",
        "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(out)])
    print(f"[long] done → {out} ({probe_dur(out):.1f}s)")
    try:
        log_event(jd, TOOL, "long", duration_seconds=time.perf_counter() - t0, extra={
            "usage_role": "episodes", "model": SYNC3_MODEL, "segments": len(bounds) - 1,
            "total_sec": round(total, 2), "splits": splits, "output": str(out),
        })
    except Exception:
        pass


# ===========================================================================
# Crop-planning shared geometry (absorbed from motion_envelope / face_envelope)
# ===========================================================================
def expand_to_aspect(bbox, target_aspect, source_w, source_h, padding_frac=0.05):
    """Centered expansion of a bbox to a target aspect with padding (clamped)."""
    x, y, w, h = bbox
    cx = x + w / 2
    cy = y + h / 2

    pad_w = w * padding_frac
    pad_h = h * padding_frac
    w_padded = w + 2 * pad_w
    h_padded = h + 2 * pad_h

    target_ratio = target_aspect[0] / target_aspect[1]
    current_ratio = w_padded / h_padded

    if current_ratio < target_ratio:
        new_w = h_padded * target_ratio
        new_h = h_padded
    else:
        new_w = w_padded
        new_h = w_padded / target_ratio

    new_x = cx - new_w / 2
    new_y = cy - new_h / 2

    if new_x < 0:
        new_x = 0
    if new_y < 0:
        new_y = 0
    if new_x + new_w > source_w:
        new_x = source_w - new_w
    if new_y + new_h > source_h:
        new_y = source_h - new_h

    if new_w > source_w:
        scale = source_w / new_w
        new_w = source_w
        new_h *= scale
        new_x = 0
    if new_h > source_h:
        scale = source_h / new_h
        new_h = source_h
        new_w *= scale
        new_y = 0

    return (int(round(new_x)), int(round(new_y)), int(round(new_w)), int(round(new_h)))


# ===========================================================================
# MODE: motion-envelope  — absorbed from motion_envelope.py
# ===========================================================================
def union_bbox_from_mask(mask):
    """Bbox of the LARGEST connected component in a binary mask."""
    import cv2
    import numpy as np
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if num_labels <= 1:
        return None
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, _ = stats[biggest]
    return (int(x), int(y), int(w), int(h))


def cmd_motion_envelope(args):
    import cv2
    import numpy as np

    job = resolve_job_dir(args.job)
    video_path = Path(args.video)
    if not video_path.exists():
        print(f"video not found: {video_path}", file=sys.stderr)
        sys.exit(1)

    aspect_parts = args.aspect_ratio.split(":")
    target_aspect = (int(aspect_parts[0]), int(aspect_parts[1]))

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"cannot open video: {video_path}", file=sys.stderr)
        sys.exit(1)

    src_fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = frame_count / src_fps if src_fps > 0 else 0

    sample_every = max(1, int(src_fps / args.sample_fps))
    expected_samples = frame_count // sample_every
    print(f"[motion_envelope] video: {frame_count} frames, {src_fps:.1f} fps, {src_w}×{src_h}, {duration:.1f}s")
    print(f"[motion_envelope] sampling every {sample_every} frames → ~{expected_samples} samples at {args.sample_fps} fps")

    downscale = 4  # work at 1/16 area for speed
    work_w = src_w // downscale
    work_h = src_h // downscale

    frames = []
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % sample_every == 0:
            small = cv2.resize(frame, (work_w, work_h), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            frames.append(gray)
        idx += 1

    cap.release()
    print(f"[motion_envelope] collected {len(frames)} sample frames at {work_w}×{work_h}")

    if len(frames) < 3:
        print("not enough sample frames", file=sys.stderr)
        sys.exit(2)

    stack = np.stack(frames, axis=0)
    bg = np.median(stack, axis=0).astype(np.uint8)

    union = np.zeros_like(bg, dtype=np.uint8)
    for f in frames:
        diff = cv2.absdiff(f, bg)
        _, mask = cv2.threshold(diff, args.diff_threshold, 255, cv2.THRESH_BINARY)
        union = cv2.bitwise_or(union, mask)

    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    cleaned = cv2.morphologyEx(union, cv2.MORPH_OPEN, k_open)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, k_close)

    bbox_small = union_bbox_from_mask(cleaned)
    if bbox_small is None:
        print("no motion detected", file=sys.stderr)
        sys.exit(3)
    print(f"[motion_envelope] bbox in work coords ({work_w}×{work_h}): {bbox_small}")

    raw_union = (
        bbox_small[0] * downscale,
        bbox_small[1] * downscale,
        bbox_small[2] * downscale,
        bbox_small[3] * downscale,
    )
    print(f"[motion_envelope] bbox in source coords ({src_w}×{src_h}): {raw_union}")

    expanded = expand_to_aspect(raw_union, target_aspect, src_w, src_h, args.padding)
    print(f"[motion_envelope] expanded to {args.aspect_ratio} with {args.padding*100:.0f}% pad: {expanded}")

    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_count // 2)
    ret, sample_frame = cap.read()
    cap.release()
    if not ret:
        print("could not read sample frame", file=sys.stderr)
        sys.exit(4)

    overlay = sample_frame.copy()
    rx, ry, rw, rh = raw_union
    cv2.rectangle(overlay, (rx, ry), (rx + rw, ry + rh), (255, 255, 255), 4)
    ex, ey, ew, eh = expanded
    cv2.rectangle(overlay, (ex, ey), (ex + ew, ey + eh), (61, 122, 255), 8)

    debug_mask = cv2.resize(cleaned, (src_w, src_h), interpolation=cv2.INTER_NEAREST)
    debug_mask_bgr = cv2.cvtColor(debug_mask, cv2.COLOR_GRAY2BGR)

    overlay_path = job / "bbox_union_overlay.png"
    debug_path = job / "motion_envelope_debug.png"
    cv2.imwrite(str(overlay_path), overlay)
    cv2.imwrite(str(debug_path), debug_mask_bgr)

    result = {
        "raw_union": {"x": raw_union[0], "y": raw_union[1], "w": raw_union[2], "h": raw_union[3]},
        "expanded_9_16": {
            "x": expanded[0], "y": expanded[1], "w": expanded[2], "h": expanded[3],
            "x_frac": expanded[0] / src_w,
            "y_frac": expanded[1] / src_h,
            "w_frac": expanded[2] / src_w,
            "h_frac": expanded[3] / src_h,
        },
        "source_dimensions": {"w": src_w, "h": src_h},
        "target_aspect": args.aspect_ratio,
        "padding_frac": args.padding,
        "samples": len(frames),
        "method": "motion_envelope_via_median_background",
    }

    bbox_path = job / "bbox_union.json"
    bbox_path.write_text(json.dumps(result, indent=2))

    print(f"[motion_envelope] wrote {bbox_path}")
    print(f"[motion_envelope] wrote {overlay_path}")
    print(f"[motion_envelope] wrote {debug_path}")
    print(f"[motion_envelope] crop command: ffmpeg -i SRC -vf \"crop={expanded[2]}:{expanded[3]}:{expanded[0]}:{expanded[1]}\" OUT")
    try:
        log_event(job, TOOL, "motion_envelope", extra={
            "usage_role": "motion-envelope", "bbox": result["expanded_9_16"],
            "samples": len(frames), "aspect": args.aspect_ratio,
        })
    except Exception:
        pass


# ===========================================================================
# MODE: face-envelope  — absorbed from face_envelope.py
# ===========================================================================
def cmd_face_envelope(args):
    import cv2
    import numpy as np

    job = resolve_job_dir(args.job)
    video_path = Path(args.video)
    if not video_path.exists():
        print(f"video not found: {video_path}", file=sys.stderr)
        sys.exit(1)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"cannot open video: {video_path}", file=sys.stderr)
        sys.exit(1)

    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[face_envelope] video: {frame_count} frames, {src_w}×{src_h}")

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        print(f"could not load face cascade at {cascade_path}", file=sys.stderr)
        sys.exit(1)

    sample_indices = np.linspace(0, max(0, frame_count - 1), args.samples, dtype=int)
    face_boxes = []

    for sample_n, idx in enumerate(sample_indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ret, frame = cap.read()
        if not ret or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(120, 120),
        )
        if len(faces) > 0:
            largest = max(faces, key=lambda f: f[2] * f[3])
            face_boxes.append(tuple(int(v) for v in largest))

    cap.release()

    if len(face_boxes) < 5:
        print(f"only {len(face_boxes)} faces detected — face detection unreliable for this video", file=sys.stderr)
        sys.exit(2)

    print(f"[face_envelope] detected faces in {len(face_boxes)}/{len(sample_indices)} samples")

    xs = np.array([b[0] + b[2] / 2 for b in face_boxes])
    ys = np.array([b[1] + b[3] / 2 for b in face_boxes])
    ws = np.array([b[2] for b in face_boxes])
    hs = np.array([b[3] for b in face_boxes])

    face_cx = int(np.median(xs))
    face_cy = int(np.median(ys))
    face_w = int(np.median(ws))
    face_h = int(np.median(hs))
    print(f"[face_envelope] median face: center=({face_cx}, {face_cy}), size=({face_w}×{face_h})")

    min_x = int(min(b[0] for b in face_boxes))
    max_x = int(max(b[0] + b[2] for b in face_boxes))
    min_y = int(min(b[1] for b in face_boxes))
    max_y = int(max(b[1] + b[3] for b in face_boxes))
    face_union = (min_x, min_y, max_x - min_x, max_y - min_y)
    print(f"[face_envelope] face union envelope: {face_union}")

    aspect_parts = args.aspect_ratio.split(":")
    aspect_w_ratio, aspect_h_ratio = int(aspect_parts[0]), int(aspect_parts[1])

    crop_w = int(face_w * args.head_multiplier)
    crop_h = int(crop_w * aspect_h_ratio / aspect_w_ratio)

    vertical_face_range = max_y - min_y
    needed_h_min = vertical_face_range + int(face_h * 2.5)
    if crop_h < needed_h_min:
        crop_h = needed_h_min
        crop_w = int(crop_h * aspect_w_ratio / aspect_h_ratio)
        print(f"[face_envelope] grew crop to cover face vertical range: now {crop_w}×{crop_h}")

    crop_x = face_cx - crop_w // 2
    crop_y = int(face_cy - crop_h * args.face_y_frac)

    if crop_x < 0:
        crop_x = 0
    if crop_y < 0:
        crop_y = 0
    if crop_x + crop_w > src_w:
        crop_x = src_w - crop_w
    if crop_y + crop_h > src_h:
        crop_y = src_h - crop_h
    if crop_w > src_w:
        scale = src_w / crop_w
        crop_w = src_w
        crop_h = int(crop_h * scale)
        crop_x = 0
    if crop_h > src_h:
        scale = src_h / crop_h
        crop_h = src_h
        crop_w = int(crop_w * scale)
        crop_y = 0

    expanded = (crop_x, crop_y, crop_w, crop_h)
    print(f"[face_envelope] final crop: x={crop_x}, y={crop_y}, w={crop_w}, h={crop_h}")

    cap = cv2.VideoCapture(str(video_path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_count // 2)
    ret, sample_frame = cap.read()
    cap.release()
    if not ret:
        print("could not read sample frame", file=sys.stderr)
        sys.exit(3)

    overlay = sample_frame.copy()
    for fb in face_boxes:
        cv2.rectangle(overlay, (fb[0], fb[1]), (fb[0] + fb[2], fb[1] + fb[3]), (180, 180, 180), 1)
    cv2.rectangle(
        overlay,
        (face_cx - face_w // 2, face_cy - face_h // 2),
        (face_cx + face_w // 2, face_cy + face_h // 2),
        (255, 255, 255), 3,
    )
    cv2.rectangle(overlay, (crop_x, crop_y), (crop_x + crop_w, crop_y + crop_h), (61, 122, 255), 8)

    overlay_path = job / "bbox_union_overlay.png"
    cv2.imwrite(str(overlay_path), overlay)

    result = {
        "raw_union": {"x": face_union[0], "y": face_union[1], "w": face_union[2], "h": face_union[3]},
        "expanded_9_16": {
            "x": expanded[0], "y": expanded[1], "w": expanded[2], "h": expanded[3],
            "x_frac": expanded[0] / src_w,
            "y_frac": expanded[1] / src_h,
            "w_frac": expanded[2] / src_w,
            "h_frac": expanded[3] / src_h,
        },
        "source_dimensions": {"w": src_w, "h": src_h},
        "face_median": {"cx": face_cx, "cy": face_cy, "w": face_w, "h": face_h},
        "samples_total": int(len(sample_indices)),
        "samples_with_face": len(face_boxes),
        "target_aspect": args.aspect_ratio,
        "head_multiplier": args.head_multiplier,
        "face_y_frac": args.face_y_frac,
        "method": "face_envelope_via_haar_cascade",
    }

    bbox_path = job / "bbox_union.json"
    bbox_path.write_text(json.dumps(result, indent=2))
    print(f"[face_envelope] wrote {bbox_path}")
    print(f"[face_envelope] wrote {overlay_path}")
    print(f'[face_envelope] crop command: ffmpeg -i SRC -vf "crop={crop_w}:{crop_h}:{crop_x}:{crop_y}" OUT')
    try:
        log_event(job, TOOL, "face_envelope", extra={
            "usage_role": "face-envelope", "bbox": result["expanded_9_16"],
            "samples_with_face": len(face_boxes), "aspect": args.aspect_ratio,
        })
    except Exception:
        pass


# ===========================================================================
# MODE: composite  — absorbed from composite_lipsync.py
# ===========================================================================
def cmd_composite(args):
    job = resolve_job_dir(args.job)

    if args.x is not None and args.y is not None and args.w is not None and args.h is not None:
        x, y, w, h = args.x, args.y, args.w, args.h
    else:
        bbox_path = Path(args.bbox) if args.bbox else (job / "bbox_union.json")
        if not bbox_path.exists():
            print(f"bbox file not found: {bbox_path}. Run face-envelope or motion-envelope first, or pass --x/--y/--w/--h.", file=sys.stderr)
            sys.exit(1)
        data = json.loads(bbox_path.read_text())
        b = data["expanded_9_16"]
        x, y, w, h = b["x"], b["y"], b["w"], b["h"]
        print(f"[composite] bbox from {bbox_path}: ({x}, {y}, {w}×{h})")

    base_path = Path(args.base)
    lipsync_path = Path(args.lipsync)
    out_path = Path(args.output)
    if not base_path.exists():
        print(f"base not found: {base_path}", file=sys.stderr)
        sys.exit(1)
    if not lipsync_path.exists():
        print(f"lipsync not found: {lipsync_path}", file=sys.stderr)
        sys.exit(1)

    if args.feather > 0:
        f = args.feather
        alpha_expr = (
            f"if(lt(X,{f}), 255*X/{f}, "
            f"if(gt(X,W-{f}), 255*(W-X)/{f}, "
            f"if(lt(Y,{f}), 255*Y/{f}, "
            f"if(gt(Y,H-{f}), 255*(H-Y)/{f}, "
            f"255))))"
        )
        filter_complex = (
            f"[1:v]scale={w}:{h},format=yuva420p,"
            f"geq=lum='p(X,Y)':a='{alpha_expr}'[ls];"
            f"[0:v][ls]overlay={x}:{y}:format=auto[v]"
        )
    else:
        filter_complex = (
            f"[1:v]scale={w}:{h}[ls];"
            f"[0:v][ls]overlay={x}:{y}[v]"
        )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(base_path),
        "-i", str(lipsync_path),
        "-filter_complex", filter_complex,
        "-map", "[v]",
    ]

    if args.audio_from == "lipsync":
        cmd += ["-map", "1:a?"]
    elif args.audio_from == "base":
        cmd += ["-map", "0:a?"]
    # if "none", we omit the audio map entirely

    cmd += [
        "-c:v", "libx264", "-crf", str(args.crf), "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(out_path),
    ]

    print(f"[composite] running: {' '.join(cmd[:6])} ... -> {out_path.name}")
    print(f"[composite] feather={args.feather}px, audio-from={args.audio_from}")

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"ffmpeg failed:\n{res.stderr[-2000:]}", file=sys.stderr)
        sys.exit(2)

    print(f"[composite] wrote {out_path} ({out_path.stat().st_size // 1024} KB)")
    try:
        log_event(job, TOOL, "composite", extra={
            "usage_role": "composite", "bbox": {"x": x, "y": y, "w": w, "h": h},
            "feather": args.feather, "audio_from": args.audio_from, "output": str(out_path),
        })
    except Exception:
        pass


# ===========================================================================
# CLI
# ===========================================================================
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="lipsync_footage.py",
        description="Canonical real-footage lipsync (fal sync-3 only). Plan/gen on-camera "
                    "windows (reels), long-form (episodes), crop-envelopes, and composite.",
        # See mint_video: reject flag abbreviations so `--au x` errors instead of
        # resolving to --audio and diverging from the app's price (#74 round-7).
        allow_abbrev=False,
    )
    sub = ap.add_subparsers(dest="mode", required=True)

    # reels: plan
    p = sub.add_parser("plan", help="[reels] compute on-camera windows from beats.json (no API)")
    p.add_argument("--job", required=True, help="Job id; reads <job>/edit/beats.json. REQUIRED.")

    # reels: gen
    g = sub.add_parser("gen", allow_abbrev=False, help="[reels] lipsync each on-camera window with fal sync-3")
    g.add_argument("--job", required=True, help="Job id; reads <job>/edit/beats.json. REQUIRED.")
    g.add_argument("--force", action="store_true", help="re-render windows whose output exists")
    g.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL,
                   help=f"windows submitted at once (default {DEFAULT_PARALLEL})")

    # episodes: long
    lg = sub.add_parser("long", allow_abbrev=False, help="[episodes] lipsync any-length clip by splitting at silence (sync-3)")
    lg.add_argument("--job", required=True, help="Job (for run-log). REQUIRED.")
    lg.add_argument("--video", required=True,
                    help="Input video bed (silent or to be replaced); job-relative or absolute")
    lg.add_argument("--audio", required=True,
                    help="Input VO audio (mp3/wav/m4a); job-relative or absolute")
    lg.add_argument("--output", required=True,
                    help="Output mp4 path inside the job (job-relative or absolute)")
    lg.add_argument("--max-seg", type=float, default=50.0,
                    help="Max seconds per lipsync segment (default 50; sync models fail past ~60s)")
    lg.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL,
                    help=f"segments submitted at once (default {DEFAULT_PARALLEL})")

    # crop-planning: face-envelope
    fe = sub.add_parser("face-envelope", help="[crop] face-anchored 9:16 crop region (Haar)")
    fe.add_argument("--video", required=True)
    fe.add_argument("--aspect-ratio", default="9:16")
    fe.add_argument("--samples", type=int, default=80)
    fe.add_argument("--head-multiplier", type=float, default=3.5,
                    help="Crop width as multiple of face width (default 3.5)")
    fe.add_argument("--face-y-frac", type=float, default=0.28,
                    help="Vertical position of face center within crop (default 0.28)")
    add_job_arg(fe)

    # crop-planning: motion-envelope
    me = sub.add_parser("motion-envelope", help="[crop] motion-anchored 9:16 crop region (median bg)")
    me.add_argument("--video", required=True)
    me.add_argument("--aspect-ratio", default="9:16")
    me.add_argument("--padding", type=float, default=0.10, help="Padding fraction (default 0.10)")
    me.add_argument("--sample-fps", type=float, default=5.0, help="Frames/sec to sample (default 5)")
    me.add_argument("--diff-threshold", type=int, default=25, help="Per-pixel diff threshold (0-255)")
    add_job_arg(me)

    # composite
    co = sub.add_parser("composite", help="[composite] overlay a lipsynced crop back onto the wider base")
    co.add_argument("--base", required=True, help="The wider original video (e.g. 1080×1920)")
    co.add_argument("--lipsync", required=True, help="The lip-synced crop output")
    co.add_argument("--output", required=True, help="Composited output mp4 path")
    co.add_argument("--bbox", help="Path to bbox_union.json. Default: <job_dir>/bbox_union.json")
    co.add_argument("--x", type=int, help="Override bbox x (skip --bbox)")
    co.add_argument("--y", type=int, help="Override bbox y")
    co.add_argument("--w", type=int, help="Override bbox w")
    co.add_argument("--h", type=int, help="Override bbox h")
    co.add_argument("--feather", type=int, default=30,
                    help="Alpha-feather radius in px at overlay edges (default 30; 0 = hard cut)")
    co.add_argument("--audio-from", choices=["lipsync", "base", "none"], default="lipsync",
                    help="Where final audio comes from (default lipsync)")
    co.add_argument("--crf", type=int, default=18, help="x264 CRF for output (default 18)")
    add_job_arg(co)

    return ap


def main() -> None:
    ap = build_parser()
    a = ap.parse_args()

    if a.mode == "plan":
        cmd_plan(a.job)
    elif a.mode == "gen":
        cmd_gen(a.job, a.force, a.parallel)
    elif a.mode == "long":
        cmd_long(a.job, Path(a.video), Path(a.audio), Path(a.output), a.max_seg, a.parallel)
    elif a.mode == "face-envelope":
        cmd_face_envelope(a)
    elif a.mode == "motion-envelope":
        cmd_motion_envelope(a)
    elif a.mode == "composite":
        cmd_composite(a)
    else:  # pragma: no cover
        ap.error(f"unknown mode {a.mode!r}")


if __name__ == "__main__":
    main()
