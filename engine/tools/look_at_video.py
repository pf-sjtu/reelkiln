"""look_at_video — see a video in one call, or two stacked.

    uv run python tools/look_at_video.py --job <id> <video>
    uv run python tools/look_at_video.py --job <id> <reference> <ours>
        [--start SECONDS --end SECONDS] [--no-transcript] [--json]

One video: timeline strips at 5 fps over the audio timeline — filmstrip,
waveform, RMS energy with onset markers, transcript word chips, cut markers and
beat boundaries — one PNG per span. Two videos: the reference stacked over ours,
beat-aligned (the comparison format), at least 5 fps on both sides.

It prints the absolute PNG paths in time order, each followed by a one-line
summary of its span, so the agent can Read the images. `--json` prints the same
as one JSON object (schema `videoclaw.look-at-video/v1`).

Everything it needs is computed here and cached per file sha256 under
`<job>/strips/look/`, so a second look at the same bytes is instant:

  cuts        the shared ffmpeg scdet detector (render_timeline_strip.detect_cuts,
              the one breakdown_reference uses).
  beats       the shots between those cuts (render_timeline_strip.build_shots),
              tiled so they cover the whole video. In a single look the beat lines
              sit on the cut lines; in a stack they are the unit REF and OURS are
              aligned by (pair by index; extra beats on the longer side merge into
              the last pair so nothing goes unshown, with a warning).
  audio       the waveform plus render_timeline_strip.analyze_audio_evidence
              (global RMS energy + deterministic onset markers).
  transcript  first one already on hand — this tool's cache, a
              breakdown_reference decode of the same bytes, or the job's
              transcript.json when it captioned exactly these bytes (render
              manifest + render_completed event) — and otherwise ONE metered Scribe
              call through the existing synth_voice transcribe path (about $0.05
              per video, gateway only). The call is recorded before it is sent, so
              no later or concurrent look pays for the same file twice; a lost
              result is collected by the app's recovery mode.
              `--no-transcript` never makes that call; a transcript already on
              hand is still drawn.

Job boundary: `--job` is required, like every tool. It must name a job directly
under the jobs root. Strips, caches and temporary files (frame extracts,
decoded audio) are written only under `<job>/strips/look/` (symlinks refused,
containment re-checked before each write), never next to the input and never
inside an installed engine. Inputs may live anywhere readable: job-relative
(`final.mp4`, `reference/ref.mp4`), workspace-relative (`jobs/<id>/...`) or
absolute. URLs are refused: pull them into the job with pull_video first. An
input that changes while it is being looked at fails the look (exit 1) rather
than caching its evidence under the old hash.

It does not write the standalone `qa_gate --mark-stack` receipt; that legacy
CLI rail stays with `render_timeline_strip --stack`.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tools/ on path

from _paths import OUTPUT_ROOT, REPO_ROOT  # noqa: E402
from job import add_job_arg, resolve_job_input_path  # noqa: E402
from render_timeline_strip import (  # noqa: E402
    COL_GAP,
    FRAME_H,
    STACK_MAX_COLUMNS,
    analyze_audio_evidence,
    build_shots,
    detect_cuts,
    render_linear,
    render_stack,
    split_windows,
)

TOOL_NAME = "look_at_video.py"
OUTPUT_SCHEMA = "videoclaw.look-at-video/v1"
ANALYSIS_SCHEMA = "videoclaw.look-at-video.analysis/v1"
TRANSCRIPT_SCHEMA = "videoclaw.look-at-video.transcript/v1"
PENDING_SCHEMA = "videoclaw.look-at-video.transcript-pending/v1"
PENDING_NAME = "transcript.pending.json"
TERMINAL_FAILURES = frozenset({"failed", "canceled", "cancelled", "timeout"})
MANIFEST_SCHEMA = "videoclaw.look-at-video.strips/v1"
MANIFEST_NAME = "look.json"

FPS = 5.0
MAX_LOOK_SECONDS = 60.0
# A strip's frames should fit ~2100 px so each frame stays legible after the
# image reader downsizes it: a 9:16 video gets 10 frames (2 s) per strip, 16:9
# gets 5 frames (1 s). Never fewer than 5 frames, never more than the linear
# 2 s window or the stack's 12-column card.
STRIP_FRAMES_PX = 2100
MIN_FRAMES_PER_STRIP = 5
LINEAR_MAX_FRAMES = 10
TRANSCRIPT_LOCK_TIMEOUT_S = 960.0
WORDS_EXCERPT_CHARS = 60
MUSIC_NA = {"available": False, "present": []}
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
PLACEHOLDER_WORD = "PLACEHOLDER"


class LookError(Exception):
    """A usage or boundary refusal (exit 2)."""


class LookFailure(Exception):
    """The look could not be produced (exit 1)."""


# ---------------------------------------------------------------------------
# parser + billing manifest (cost.py plans this tool with its own parser)
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="look_at_video",
        description=("See a video (timeline strips at 5 fps) or two stacked "
                     "(reference over ours, beat-aligned) in one call."),
        # Exact flags only: the spend classifier matches `--no-transcript`
        # literally, so an abbreviation must not silently change the spend.
        allow_abbrev=False,
    )
    add_job_arg(parser)
    parser.add_argument(
        "videos", nargs="+", metavar="VIDEO",
        help="one video to look at, or <reference> <ours> to stack them")
    parser.add_argument(
        "--no-transcript", action="store_true",
        help=("never make the metered transcription call (about $0.05 per video); "
              "a transcript already on hand is still drawn"))
    parser.add_argument("--json", action="store_true",
                        help="print one JSON object instead of text")
    parser.add_argument("--start", type=float, default=0.0,
                        help="start time in seconds (default: 0)")
    parser.add_argument("--end", type=float,
                        help="end time in seconds (default: end of video; max 60 seconds per look)")
    return parser


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    """cost.py's tool-owned plan hook: role + count from the real parser.

    Whether a transcript is already cached is filesystem state, not argv, so the
    plan fails closed: every video may need one metered transcription unless
    `--no-transcript` is present. The price does not depend on the bytes, so no
    input is fingerprinted.
    """
    count = len(args.videos)
    if not 1 <= count <= 2:
        raise ValueError("look_at_video takes one video, or <reference> <ours>")
    if args.no_transcript:
        return {"role": "no_transcript", "count": 1, "inputs": []}
    return {"role": "transcribe", "count": count, "inputs": []}


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


_CODE_ID: str | None = None


def code_id() -> str:
    """Identity of the rendering code, so an engine update re-renders strips."""
    global _CODE_ID
    if _CODE_ID is None:
        here = Path(__file__).resolve().parent
        digest = hashlib.sha256()
        for name in ("look_at_video.py", "render_timeline_strip.py"):
            digest.update((here / name).read_bytes())
        _CODE_ID = digest.hexdigest()[:16]
    return _CODE_ID


def _assert_inside(path: Path, look_root: Path) -> None:
    """Re-check containment right before a write (a directory may have been swapped).

    Anchored at the job directory (`<job>/strips/look` → `<job>`): the job and
    every component from it down to `path` must be a real directory or file,
    never a symlink, so a redirected `strips/` or `look/` is refused too."""
    job = look_root.parent.parent
    if job.is_symlink():
        raise LookError(f"refusing a symlinked job directory: {job}")
    try:
        relative = path.relative_to(job)
    except ValueError:
        raise LookError(f"refusing to write outside {job}: {path}") from None
    current = job
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise LookError(f"refusing to write through a symlink: {current}")
    if not path.parent.resolve().is_relative_to(job.resolve()):
        raise LookError(f"refusing to write outside {job}: {path}")


def _atomic_write_json(path: Path, data: Any, root: Path) -> None:
    _assert_inside(path, root)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path) -> Any | None:
    """Read an owned JSON file; a symlink, a missing or a malformed file is None."""
    if path.is_symlink() or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _clean_text(value: str) -> str:
    """One printable line: transcript words are untrusted material."""
    kept = [" " if ch.isspace() else ch for ch in value
            if ch.isspace() or not unicodedata.category(ch).startswith("C")]
    return " ".join("".join(kept).split())


def _fmt_t(t: float) -> str:
    return f"{t:.2f}"


# ---------------------------------------------------------------------------
# job boundary
# ---------------------------------------------------------------------------

def resolve_job(raw: str) -> Path:
    """The job directory: a direct child of the jobs root, never a symlink,
    never inside an installed engine."""
    root = Path(OUTPUT_ROOT).expanduser()
    if not root.is_absolute():
        root = Path.cwd() / root
    root_resolved = root.resolve()
    engine = REPO_ROOT.resolve()
    if (engine / "ENGINE_VERSION.json").is_file() and root_resolved.is_relative_to(engine):
        raise LookError(
            "the jobs root is inside the installed engine; set VIDEOCLAW_WORKSPACE "
            "(or VIDEOCLAW_JOBS_DIR) so strips land in the workspace")
    root.mkdir(parents=True, exist_ok=True)
    if JOB_ID_RE.match(raw) and raw not in {".", ".."}:
        job = root / raw
    else:
        supplied = Path(raw).expanduser()
        if not supplied.is_absolute():
            supplied = Path.cwd() / supplied
        if supplied.is_symlink() or supplied.resolve().parent != root_resolved:
            raise LookError(
                f"--job must name a job directly under the jobs root {root_resolved} "
                f"(pass the bare job id); got {raw!r}")
        job = root / supplied.resolve().name
    if job.is_symlink():
        raise LookError(f"refusing a symlinked job directory: {job}")
    job.mkdir(exist_ok=True)
    if job.resolve().parent != root_resolved:
        raise LookError(f"job directory escapes the jobs root: {job}")
    return job


def owned_dir(job: Path, *parts: str) -> Path:
    """mkdir job/parts…, refusing a symlink at any level and any escape."""
    job_root = job.resolve()
    current = job
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise LookError(f"refusing a symlinked output directory: {current}")
        current.mkdir(exist_ok=True)
        if not current.is_dir():
            raise LookError(f"output path is not a directory: {current}")
    if not current.resolve().is_relative_to(job_root):
        raise LookError(f"output directory escapes the job: {current}")
    return current


def resolve_video(raw: str, job: Path) -> Path:
    if re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
        raise LookError(
            f"{raw!r} is a URL. Pull it into the job first "
            "(pull_video --mode pull), then look at the saved file.")
    path = resolve_job_input_path(raw, job)
    if not path.is_file():
        raise LookError(f"video not found: {raw!r} (looked at {path})")
    return path


@dataclass
class Source:
    """One input video, pinned to the bytes that were hashed.

    Every cache write re-checks the file identity, so a video replaced while it
    is being looked at can never leave its evidence under the old hash."""
    path: Path
    sha: str
    stamp: tuple[int, int, int, int]

    @staticmethod
    def _stamp(path: Path) -> tuple[int, int, int, int]:
        st = path.stat()
        return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)

    @classmethod
    def open(cls, path: Path) -> "Source":
        before = cls._stamp(path)
        sha = _sha256_file(path)
        if cls._stamp(path) != before:
            raise LookFailure(f"{path.name} changed while it was being read; look again")
        return cls(path, sha, before)

    def check(self) -> None:
        try:
            unchanged = self._stamp(self.path) == self.stamp
        except OSError:
            unchanged = False
        if not unchanged:
            raise LookFailure(f"{self.path.name} changed while it was being looked at; "
                              "its evidence was not reported — look again")


# ---------------------------------------------------------------------------
# media probe + analysis (cached per sha256)
# ---------------------------------------------------------------------------

def probe(video: Path) -> dict:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(video)],
        capture_output=True, text=True)
    try:
        data = json.loads(res.stdout or "{}")
    except json.JSONDecodeError:
        data = {}
    streams = data.get("streams") or []
    vstream = next((s for s in streams if s.get("codec_type") == "video"
                    and not (s.get("disposition") or {}).get("attached_pic")), None)
    if res.returncode != 0 or vstream is None:
        raise LookError(f"not a readable video (no video stream): {video}")
    duration = None
    for candidate in ((data.get("format") or {}).get("duration"), vstream.get("duration")):
        try:
            value = float(candidate)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            duration = value
            break
    if duration is None:
        raise LookError(f"could not read the duration of {video}")
    width, height = int(vstream.get("width") or 0), int(vstream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise LookError(f"could not read the frame size of {video}")
    rotation = 0
    for side in vstream.get("side_data_list") or []:
        if "rotation" in side:
            try:
                rotation = int(float(side["rotation"]))
            except (TypeError, ValueError):
                pass
    tag = (vstream.get("tags") or {}).get("rotate")
    if tag is not None:
        try:
            rotation = int(float(tag))
        except (TypeError, ValueError):
            pass
    if abs(rotation) % 180 == 90:  # ffmpeg auto-rotates: frames are display-oriented
        width, height = height, width
    return {
        "duration": round(duration, 3),
        "width": width,
        "height": height,
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def tile_beats(shots: list[dict], duration: float) -> list[dict]:
    """Shots → contiguous beats covering [0, duration] (slivers join the shot before)."""
    if not shots:
        return [{"id": "b1", "start": 0.0, "end": round(duration, 3)}]
    beats: list[dict] = []
    for i in range(len(shots)):
        start = 0.0 if i == 0 else beats[-1]["end"]
        end = round(duration, 3) if i == len(shots) - 1 else shots[i + 1]["start"]
        beats.append({"id": f"b{i + 1}", "start": round(start, 3), "end": round(end, 3)})
    return beats


def analyze(source: Source, meta: dict, media_dir: Path, look_root: Path) -> dict:
    """Cuts, beats and audio evidence — deterministic given the bytes and this code."""
    path = media_dir / "analysis.json"
    cached = _read_json(path)
    if (isinstance(cached, dict) and cached.get("schema") == ANALYSIS_SCHEMA
            and cached.get("code") == code_id() and cached.get("sha256") == source.sha):
        return cached
    duration = meta["duration"]
    cuts = [c for c in detect_cuts(source.path) if 0.0 < c["time"] < duration]
    beats = tile_beats(build_shots(cuts, duration), duration)
    audio = (analyze_audio_evidence(source.path, 0.0, duration) if meta["has_audio"]
             else {"available": False, "reason": "no audio stream",
                   "energy_windows": [], "onsets": []})
    analysis = {
        "schema": ANALYSIS_SCHEMA,
        "code": code_id(),
        "sha256": source.sha,
        **meta,
        "cuts": cuts,
        "beats": beats,
        "audio_evidence": audio,
    }
    source.check()
    _atomic_write_json(path, analysis, look_root)
    return analysis


# ---------------------------------------------------------------------------
# transcript: reuse what is on hand, else one metered Scribe call
# ---------------------------------------------------------------------------

@dataclass
class Transcript:
    words: list[dict] | None   # None = no transcript; [] = transcript with no speech
    # cached | new | recovered | job | breakdown | off | pending | unavailable | no-audio
    state: str
    label: str

    @property
    def sha(self) -> str | None:
        return None if self.words is None else _canonical_sha(self.words)


def clean_words(raw: Any, duration: float) -> list[dict] | None:
    """Normalize Scribe/analyze_reference word lists.

    None means unusable — not this video's, or malformed — never "no speech":
    only a well-formed list with no spoken words is a valid empty transcript.
    Spacing tokens (blank text) are skipped; a spoken word without valid
    numeric timings makes the whole list unusable."""
    words = raw.get("words") if isinstance(raw, dict) else raw
    if not isinstance(words, list):
        return None
    out: list[dict] = []
    for w in words:
        if not isinstance(w, dict):
            return None
        text = w.get("word", w.get("text"))
        start, end = w.get("start"), w.get("end")
        if not isinstance(text, str):
            return None
        if not text.strip():
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                   and math.isfinite(v) for v in (start, end)):
            return None
        if start < 0 or end < start:
            return None
        if start > duration + 0.5:
            return None  # words past the end: a transcript of something else
        if start >= duration:
            continue  # trailing timing slop past the last frame
        out.append({"word": text.strip(), "start": round(float(start), 3),
                    "end": round(float(min(end, duration)), 3)})
    if len(out) == 1 and out[0]["word"] == PLACEHOLDER_WORD:
        return None  # synth_voice's no-credential placeholder is not a transcript
    return sorted(out, key=lambda w: (w["start"], w["end"]))


def _cached_transcript(media_dir: Path, sha: str, duration: float) -> list[dict] | None:
    data = _read_json(media_dir / "transcript.json")
    if (isinstance(data, dict) and data.get("schema") == TRANSCRIPT_SCHEMA
            and data.get("video_sha256") == sha):
        return clean_words(data, duration)
    return None


def _breakdown_transcript(job: Path, sha: str, duration: float) -> list[dict] | None:
    """A breakdown_reference decode of these exact bytes that kept its transcript."""
    breakdown = job / "breakdown"
    if breakdown.is_symlink() or not breakdown.is_dir():
        return None
    for receipt_path in sorted(breakdown.glob("*/.decode-complete.json")):
        receipt = _read_json(receipt_path)
        if not isinstance(receipt, dict) or receipt.get("status") != "complete":
            continue
        material = receipt.get("fingerprint_material")
        if not isinstance(material, dict) or material.get("video_sha256") != sha:
            continue
        hashes = receipt.get("artifact_sha256")
        if ("transcript.json" not in (receipt.get("required_artifacts") or [])
                or not isinstance(hashes, dict)):
            continue
        transcript = receipt_path.parent / "transcript.json"
        if transcript.is_symlink() or not transcript.is_file():
            continue
        try:
            if _sha256_file(transcript) != hashes.get("transcript.json"):
                continue
        except OSError:
            continue
        words = clean_words(_read_json(transcript), duration)
        if words is not None:
            return words
    return None


def _job_final_transcript(job: Path, source: Source, duration: float) -> list[dict] | None:
    """The job's transcript.json, only when it provably captioned these exact bytes.

    compose_render's standard render draws its captions from `transcript.json`,
    writes `render-manifest.json` binding `final.mp4`'s sha256, and logs
    `render_completed` with that manifest's hash and whether captions were shown.
    The transcript is reused only when all of that holds for these bytes, the
    render kept the source timeline, and the transcript was written after the
    source video it was rendered over and not rewritten since the render.
    """
    from log import read_events  # noqa: PLC0415
    from taste_contract import RENDER_MANIFEST_SCHEMA, canonical_sha256  # noqa: PLC0415

    final = job / "final.mp4"
    transcript = job / "transcript.json"
    try:
        if (not final.is_file() or source.path.resolve() != final.resolve()
                or transcript.is_symlink() or not transcript.is_file()):
            return None
        manifest = _read_json(job / "render-manifest.json")
        if not isinstance(manifest, dict):
            return None
        unsigned = {k: v for k, v in manifest.items() if k != "manifestSha256"}
        manifest_sha = manifest.get("manifestSha256")
        output, rendered_from = manifest.get("output"), manifest.get("source")
        if (manifest.get("schema") != RENDER_MANIFEST_SCHEMA
                or manifest_sha != canonical_sha256(unsigned)
                or not isinstance(output, dict) or not isinstance(rendered_from, dict)
                or output.get("path") != "final.mp4"
                or output.get("sha256") != source.sha):
            return None
        durations = (rendered_from.get("durationSec"), output.get("durationSec"))
        stamps = (rendered_from.get("mtimeNs"), output.get("mtimeNs"))
        if (not all(isinstance(d, (int, float)) and not isinstance(d, bool) for d in durations)
                or abs(durations[0] - durations[1]) > 1 / 24
                or not all(isinstance(t, int) and not isinstance(t, bool) for t in stamps)
                or not stamps[0] <= transcript.stat().st_mtime_ns <= stamps[1]):
            return None
        completed = [e for e in read_events(job)
                     if e.get("tool") == "compose_render.py"
                     and e.get("event") == "render_completed"
                     and e.get("render_manifest_sha256") == manifest_sha]
        if not completed or completed[-1].get("show_captions") is not True:
            return None  # a --no-captions render never read the transcript
    except (OSError, TypeError, ValueError):
        return None
    words = clean_words(_read_json(transcript), duration)
    return words or None


def _transcription_available() -> bool:
    """Paid transcription runs only through the VideoClaw gateway."""
    import synth_voice  # noqa: F401,PLC0415  (loads the engine .env like the tool itself)
    from _gateway import gateway  # noqa: PLC0415
    return gateway.enabled()


def _scribe(audio: Path, job: Path) -> dict:
    """The existing synth_voice transcribe path: Scribe v2 through the gateway,
    metered to this job (gateway.run writes the cost event)."""
    from synth_voice import transcribe_elevenlabs  # noqa: PLC0415
    return transcribe_elevenlabs(audio, job=job)


def _recover_operation(job: Path, operation_id: str) -> dict:
    """Read an accepted operation's result; never submits a replacement."""
    from _gateway import gateway  # noqa: PLC0415
    return gateway.recover_operation(job, operation_id)


def _log_recovered_cost(job: Path, result: dict) -> None:
    """Book a recovered operation's charge in the job's run log, exactly once.

    gateway.recover_operation reads the result without logging it; this is the
    same idempotent per-operation path gateway.run uses (log_cost_once)."""
    from _gateway import gateway  # noqa: PLC0415
    gateway._log_cost(job, "synth_voice", "transcribe", result, 0.0)


def _submission_outcome(exc: Exception) -> tuple[str, str | None]:
    """How a failed transcription call ended, for the pending marker.

    `accepted`: the gateway accepted the paid request and its result did not
    come back (collect it; never resubmit). `finished`: the provider finished it
    and it failed. `not_submitted`: proven unpaid — gateway.run raises
    GatewayAcceptedError for every possibly-accepted outcome, so its other
    GatewayErrors, and a failed audio upload (requests), happen before any paid
    request. `unknown`: anything else, e.g. the paid response could not be
    read afterwards, so it may have been billed."""
    import requests  # noqa: PLC0415
    from _gateway import GatewayAcceptedError, GatewayError  # noqa: PLC0415
    if isinstance(exc, GatewayAcceptedError):
        result = getattr(exc, "result", None) or {}
        if result.get("status") in TERMINAL_FAILURES:
            return "finished", None
        operation_id = getattr(exc, "operation_id", None) or result.get("_operation_id")
        return "accepted", operation_id if isinstance(operation_id, str) and operation_id else None
    if isinstance(exc, (GatewayError, requests.RequestException)):
        return "not_submitted", None
    return "unknown", None


def _drop(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError):
        path.unlink()


def _write_pending(media_dir: Path, look_root: Path, sha: str, state: str,
                   operation_id: str | None) -> None:
    _atomic_write_json(media_dir / PENDING_NAME, {
        "schema": PENDING_SCHEMA, "video_sha256": sha, "state": state,
        "operation_id": operation_id, "created_at": time.time(),
    }, look_root)


def _write_transcript(source: Source, media_dir: Path, look_root: Path,
                      words: list[dict], language: Any) -> None:
    # No source.check() here: the audio was extracted from, and checked against,
    # the hashed bytes before the paid call, so these words belong to that hash
    # even if the file has changed since (the look itself then fails later).
    _atomic_write_json(media_dir / "transcript.json", {
        "schema": TRANSCRIPT_SCHEMA,
        "video_sha256": source.sha,
        "source": "synth_voice.transcribe (Scribe v2)",
        "language": language if isinstance(language, str) else None,
        "words": words,
    }, look_root)


def _settle_pending(pending: dict, source: Source, job: Path, media_dir: Path,
                    look_root: Path, duration: float, notes: list[str]) -> Transcript:
    """A paid transcription of these bytes was started and never landed.

    It is never paid for twice by itself: an accepted operation is collected in
    the app's recovery mode; otherwise the marker stays until someone deletes it
    on purpose. An earlier operation that finished and failed clears the marker,
    so the next look may try once more."""
    name = source.path.name
    marker = media_dir / PENDING_NAME
    state = pending.get("state")
    operation_id = pending.get("operation_id")
    waiting = Transcript(None, "pending", "pending (an earlier paid call)")
    retry = f"delete {marker.resolve()} to pay for a new transcription"
    if state == "unusable":
        notes.append(f"{name}: an earlier paid transcription of this file returned no "
                     f"usable words; drawn without words ({retry})")
        return waiting
    if not (isinstance(operation_id, str) and operation_id):
        notes.append(f"{name}: an earlier transcription of this file was started but "
                     "never finished (it may have been billed); not paying again — drawn "
                     f"without words ({retry})")
        return waiting
    if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") != "1":
        notes.append(f"{name}: an earlier transcription of this file (operation "
                     f"{operation_id}) was accepted but its result was not retrieved; the "
                     "app collects it — not paying again here, drawn without words "
                     f"({retry})")
        return waiting
    try:
        result = _recover_operation(job, operation_id)
    except Exception as exc:  # noqa: BLE001 — still unresolved; never resubmit
        notes.append(f"{name}: an earlier transcription of this file was accepted but its "
                     f"result is not back yet ({type(exc).__name__}); not paying again — "
                     "drawn without words")
        return waiting
    status = result.get("status") if isinstance(result, dict) else None
    if status == "succeeded" or status in TERMINAL_FAILURES:
        try:
            _log_recovered_cost(job, result)
        except Exception as exc:  # noqa: BLE001 — keep the marker; the next look retries the booking
            notes.append(f"{name}: the earlier transcription finished but its charge could "
                         f"not be booked in the run log ({type(exc).__name__}); drawn without "
                         "words")
            return waiting
    if status == "succeeded":
        words = clean_words(result.get("output"), duration)
        if words is None:
            _write_pending(media_dir, look_root, source.sha, "unusable", operation_id)
            notes.append(f"{name}: the earlier paid transcription returned no usable "
                         f"words; drawn without words ({retry})")
            return Transcript(None, "unavailable", "unavailable")
        _write_transcript(source, media_dir, look_root, words, None)
        _drop(marker)  # only once the transcript is safely cached
        return Transcript(words, "recovered",
                          f"{len(words)} words (recovered earlier call)" if words
                          else "no speech (recovered earlier call)")
    if status in TERMINAL_FAILURES:
        _drop(marker)
        notes.append(f"{name}: the earlier transcription ended {status}; drawn without "
                     "words (the next look tries once more)")
        return Transcript(None, "unavailable", "unavailable")
    notes.append(f"{name}: an earlier transcription of this file is still {status}; "
                 "not paying again — drawn without words")
    return waiting


def _extract_audio(video: Path, dest: Path) -> None:
    """Same encoding as synth_voice.extract_audio, but written inside the job —
    never next to the input video."""
    res = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video), "-vn", "-acodec", "mp3", "-ab", "128k",
         str(dest)],
        capture_output=True, text=True)
    if res.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
        raise LookFailure(f"audio extraction failed for {video.name}: "
                          f"{(res.stderr or '').strip()[-300:]}")


@contextlib.contextmanager
def _media_lock(media_dir: Path, timeout_s: float) -> Iterator[bool]:
    """One transcription per file at a time, so two looks never pay twice."""
    from remotion_lock import _try_lock, _unlock  # noqa: PLC0415  (shared advisory lock)

    lock_path = media_dir / ".lock"
    if lock_path.is_symlink():
        raise LookError(f"refusing a symlinked lock file: {lock_path}")
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        if lock_path.stat().st_size == 0:
            handle.write(" ")  # Windows byte-range locks need one byte
            handle.flush()
        deadline = time.monotonic() + timeout_s
        acquired = _try_lock(handle)
        announced = False
        while not acquired and time.monotonic() < deadline:
            if not announced:
                print(f"waiting for another look at {media_dir.name} to finish "
                      "its transcript…", file=sys.stderr)
                announced = True
            time.sleep(0.5)
            acquired = _try_lock(handle)
        try:
            yield acquired
        finally:
            if acquired:
                _unlock(handle)
    finally:
        handle.close()


def resolve_transcript(source: Source, meta: dict, job: Path, media_dir: Path,
                       look_root: Path, allow_paid: bool,
                       notes: list[str]) -> Transcript:
    duration = meta["duration"]
    video, sha = source.path, source.sha

    def found(words: list[dict], state: str, origin: str) -> Transcript:
        label = (f"{len(words)} words ({origin})" if words
                 else f"no speech ({origin})")
        return Transcript(words, state, label)

    words = _cached_transcript(media_dir, sha, duration)
    if words is not None:
        return found(words, "cached", "cached")
    words = _breakdown_transcript(job, sha, duration)
    if words is not None:
        return found(words, "breakdown", "breakdown_reference")
    words = _job_final_transcript(job, source, duration)
    if words is not None:
        return found(words, "job", "job transcript.json")
    if not allow_paid:
        return Transcript(None, "off", "off (--no-transcript)")
    if not meta["has_audio"]:
        return Transcript(None, "no-audio", "none (no audio track)")

    with _media_lock(media_dir, TRANSCRIPT_LOCK_TIMEOUT_S) as locked:
        if not locked:
            notes.append(f"{video.name}: another look held the transcript lock too "
                         "long; drawn without words")
            return Transcript(None, "unavailable", "unavailable")
        words = _cached_transcript(media_dir, sha, duration)  # a concurrent look?
        if words is not None:
            return found(words, "cached", "cached")
        pending = _read_json(media_dir / PENDING_NAME)
        if (isinstance(pending, dict) and pending.get("schema") == PENDING_SCHEMA
                and pending.get("video_sha256") == sha):
            return _settle_pending(pending, source, job, media_dir, look_root,
                                   duration, notes)
        try:
            available = _transcription_available()
        except Exception as exc:  # noqa: BLE001 — a broken import must not block the look
            notes.append(f"{video.name}: transcript unavailable ({type(exc).__name__}); "
                         "drawn without words")
            return Transcript(None, "unavailable", "unavailable")
        if not available:
            notes.append(f"{video.name}: transcript unavailable — no VideoClaw gateway "
                         "key, and paid transcription runs only through the gateway. "
                         "Add --no-transcript to skip it.")
            return Transcript(None, "unavailable", "unavailable (no gateway)")
        tmp = Path(tempfile.mkdtemp(prefix=".audio-", dir=media_dir))
        try:
            audio = tmp / "audio.mp3"
            try:
                _extract_audio(video, audio)
            except LookFailure as exc:
                notes.append(f"{video.name}: transcript unavailable ({exc}); "
                             "drawn without words")
                return Transcript(None, "unavailable", "unavailable")
            source.check()  # never pay to transcribe bytes that are not the ones hashed
            # Recorded BEFORE the paid call and cleared only once its outcome is
            # known, so an interruption (SIGTERM, Ctrl-C) mid-call can never lead
            # a later look to pay for this file again.
            _write_pending(media_dir, look_root, sha, "submitting", None)
            try:
                result = _scribe(audio, job)
            except Exception as exc:  # noqa: BLE001 — the look still succeeds without words
                detail = _clean_text(str(exc).splitlines()[0] if str(exc) else "")[:200]
                note = f"{video.name}: transcript unavailable ({type(exc).__name__}"
                note += f": {detail})" if detail else ")"
                outcome, operation_id = _submission_outcome(exc)
                marker = media_dir / PENDING_NAME
                if outcome == "accepted":
                    _write_pending(media_dir, look_root, sha, "accepted", operation_id)
                    note += (" — the gateway accepted it but the result did not come "
                             "back; a later look collects it instead of paying again")
                elif outcome == "unknown":
                    _write_pending(media_dir, look_root, sha, "unusable", None)
                    note += (" — it may already have been billed, so no later look pays "
                             f"for this file again (delete {marker.resolve()} to retry)")
                else:
                    _drop(marker)  # proven unpaid, or finished and failed
                notes.append(note + "; drawn without words")
                return Transcript(None, "pending" if outcome == "accepted" else "unavailable",
                                  "pending (this call)" if outcome == "accepted"
                                  else "unavailable")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        words = clean_words(result, duration)
        if words is None:
            _write_pending(media_dir, look_root, sha, "unusable", None)
            notes.append(f"{video.name}: the transcription returned no usable words; "
                         "drawn without words")
            return Transcript(None, "unavailable", "unavailable")
        _write_transcript(source, media_dir, look_root, words,
                          result.get("language") if isinstance(result, dict) else None)
        _drop(media_dir / PENDING_NAME)  # only once the transcript is safely cached
        return Transcript(words, "new", f"{len(words)} words (new: one metered call)"
                          if words else "no speech (new: one metered call)")


# ---------------------------------------------------------------------------
# rendering (cached per render key)
# ---------------------------------------------------------------------------

def column_width(width: int, height: int) -> int:
    """Filmstrip frame width at FRAME_H (ffmpeg scale=-2 rounds to even)."""
    return max(2, int(round(FRAME_H * width / height / 2)) * 2)


def frames_per_strip(col_w: int, cap: int) -> int:
    return max(MIN_FRAMES_PER_STRIP, min(cap, STRIP_FRAMES_PX // (col_w + COL_GAP)))


def strip_words(words: list[dict] | None) -> list[dict]:
    """render_timeline_strip's word-chip shape ({"text","start","end"})."""
    return [{"text": _clean_text(w["word"]), "start": w["start"], "end": w["end"]}
            for w in words or []]


def _load_manifest(strips_dir: Path, key: str) -> dict | None:
    if strips_dir.is_symlink() or not strips_dir.is_dir():
        return None
    manifest = _read_json(strips_dir / MANIFEST_NAME)
    if (not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA
            or manifest.get("key") != key or not isinstance(manifest.get("strips"), list)
            or not manifest["strips"]):
        return None
    for row in manifest["strips"]:
        name = row.get("file") if isinstance(row, dict) else None
        if not isinstance(name, str) or "/" in name or "\\" in name or name.startswith("."):
            return None
        png = strips_dir / name
        if png.is_symlink() or not png.is_file() or png.stat().st_size == 0:
            return None
    return manifest


def _publish(tmp: Path, strips_dir: Path, key: str, look_root: Path) -> dict:
    """Atomically move a finished render into place (a concurrent winner is kept)."""
    _assert_inside(strips_dir, look_root)
    for _attempt in range(2):
        try:
            os.rename(tmp, strips_dir)
            break
        except OSError:
            existing = _load_manifest(strips_dir, key)
            if existing is not None:
                shutil.rmtree(tmp, ignore_errors=True)
                return existing
            if strips_dir.is_symlink():
                raise LookError(f"refusing a symlinked strips directory: {strips_dir}")
            shutil.rmtree(strips_dir, ignore_errors=True)  # stale or partial: ours to replace
    else:
        raise LookFailure(f"could not publish strips into {strips_dir}")
    manifest = _load_manifest(strips_dir, key)
    if manifest is None:
        raise LookFailure(f"published strips are incomplete: {strips_dir}")
    return manifest


def _words_excerpt(words: list[dict] | None, start: float, end: float) -> str:
    if words is None:
        return "no transcript"
    picked = [w["word"] for w in words if start <= w["start"] < end]
    if not picked:
        return "no speech"
    text = _clean_text(" ".join(picked))
    if len(text) > WORDS_EXCERPT_CHARS:
        text = text[: WORDS_EXCERPT_CHARS - 1].rstrip() + "…"
    return f'"{text}"'


def _beats_in(beats: list[dict], start: float, end: float) -> list[str]:
    return [b["id"] for b in beats
            if min(b["end"], end) - max(b["start"], start) > 1e-6]


def _ids_label(ids: list[str]) -> str:
    if not ids:
        return "beat —"
    return f"beat {ids[0]}" if len(ids) == 1 else f"beats {ids[0]}–{ids[-1]}"


def _cuts_label(cuts: list[float]) -> str:
    if not cuts:
        return "no cut"
    shown = ", ".join(f"{_fmt_t(c)}s" for c in cuts[:4])
    more = f" +{len(cuts) - 4}" if len(cuts) > 4 else ""
    return f"cut {shown}" if len(cuts) == 1 else f"cuts {shown}{more}"


def render_single(source: Source, analysis: dict, transcript: Transcript,
                  media_dir: Path, look_root: Path,
                  span: tuple[float, float]) -> tuple[dict, bool, Path]:
    video = source.path
    frames = frames_per_strip(column_width(analysis["width"], analysis["height"]),
                              LINEAR_MAX_FRAMES)
    key = _canonical_sha({
        "schema": MANIFEST_SCHEMA, "code": code_id(), "mode": "single",
        "fps": FPS, "frames": frames, "video": analysis["sha256"], "span": span,
        "words": transcript.sha,
    })
    strips_dir = media_dir / key[:16]
    manifest = _load_manifest(strips_dir, key)
    if manifest is not None:
        return manifest, True, strips_dir

    beats = analysis["beats"]
    cut_times = [c["time"] for c in analysis["cuts"]]
    words = strip_words(transcript.words)
    windows = split_windows(*span, FPS,
                            [{"id": "selected", "start": span[0], "end": span[1]}],
                            frames / FPS)
    tmp = media_dir / f".tmp-{uuid.uuid4().hex}"
    tmp.mkdir()
    rows: list[dict] = []
    try:
        for a, b in windows:
            outs = render_linear(
                video, a, b, FPS, words, cut_times, MUSIC_NA, beats, tmp,
                "strip", frames / FPS, analysis.get("audio_evidence"),
                windows=[(a, b)])
            if not outs:
                continue  # no decodable frame in this window (end of stream)
            name = f"strip_{len(rows) + 1:03d}_{_fmt_t(a)}-{_fmt_t(b)}s.png"
            os.replace(outs[0], tmp / name)
            span_cuts = [c for c in cut_times if a <= c < b]
            ids = _beats_in(beats, a, b)
            rows.append({
                "file": name, "start": round(a, 3), "end": round(b, 3),
                "beats": ids, "cuts": span_cuts,
                "summary": (f"{_fmt_t(a)}–{_fmt_t(b)}s · {_ids_label(ids)} · "
                            f"{_cuts_label(span_cuts)} · "
                            f"{_words_excerpt(transcript.words, a, b)}"),
            })
        if not rows:
            raise LookFailure(f"no frames could be decoded from {video}")
        _atomic_write_json(tmp / MANIFEST_NAME, {
            "schema": MANIFEST_SCHEMA, "key": key, "mode": "single",
            "fps": FPS, "frames_per_strip": frames, "strips": rows,
        }, look_root)
        source.check()
        manifest = _publish(tmp, strips_dir, key, look_root)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return manifest, False, strips_dir


def pair_beats_covering(ref_beats: list[dict],
                        ours_beats: list[dict]) -> tuple[list[tuple[dict, dict]], str]:
    """Pair by index; on a count mismatch the extra beats merge into the last
    pair, so both whole timelines stay on the cards."""
    n_ref, n_ours = len(ref_beats), len(ours_beats)
    if n_ref == n_ours:
        return list(zip(ref_beats, ours_beats)), ""
    n = min(n_ref, n_ours)
    pairs = list(zip(ref_beats[: n - 1], ours_beats[: n - 1]))
    tail_ref, tail_ours = ref_beats[n - 1:], ours_beats[n - 1:]
    tail_id = (tail_ref[0]["id"] if len(tail_ref) == 1
               else f"{tail_ref[0]['id']}…{tail_ref[-1]['id']}")
    pairs.append((
        {"id": tail_id, "start": tail_ref[0]["start"], "end": tail_ref[-1]["end"]},
        {"id": tail_id, "start": tail_ours[0]["start"], "end": tail_ours[-1]["end"]},
    ))
    if n == 1:
        how = "the whole timelines are aligned proportionally as one pair"
    else:
        how = (f"beats 1–{n - 1} pair by index; the remaining beats of each side "
               "merge into one final pair")
    return pairs, f"BEAT COUNT MISMATCH: ref={n_ref} ours={n_ours} — {how}"


def subdivide_pairs(pairs: list[tuple[dict, dict]], fps: float,
                    max_columns: int) -> list[tuple[dict, dict]]:
    """Split each pair into equal proportional parts no longer than
    max_columns / fps on either side, so every part fits one card at ≥ fps."""
    max_span = max_columns / fps
    out: list[tuple[dict, dict]] = []
    for ref_b, ours_b in pairs:
        r0, r1, o0, o1 = ref_b["start"], ref_b["end"], ours_b["start"], ours_b["end"]
        n = max(1, math.ceil(max(r1 - r0, o1 - o0) / max_span - 1e-9))
        for i in range(n):
            part = ref_b["id"] if n == 1 else f"{ref_b['id']} {i + 1}/{n}"
            out.append((
                {"id": part, "start": r0 + (r1 - r0) * i / n, "end": r0 + (r1 - r0) * (i + 1) / n},
                {"id": part, "start": o0 + (o1 - o0) * i / n, "end": o0 + (o1 - o0) * (i + 1) / n},
            ))
    return out


def _beats_in_span(beats: list[dict], span: tuple[float, float]) -> list[dict]:
    return [{**beat, "start": max(beat["start"], span[0]),
             "end": min(beat["end"], span[1])}
            for beat in beats if min(beat["end"], span[1]) > max(beat["start"], span[0])]


def render_stacked(ref_src: Source, ref: dict, ref_t: Transcript,
                   ours_src: Source, ours: dict, ours_t: Transcript,
                   stack_dir: Path, look_root: Path,
                   spans: list[tuple[float, float]]) -> tuple[dict, bool, Path]:
    col_w = max(column_width(ref["width"], ref["height"]),
                column_width(ours["width"], ours["height"]))
    max_cols = frames_per_strip(col_w, STACK_MAX_COLUMNS)
    key = _canonical_sha({
        "schema": MANIFEST_SCHEMA, "code": code_id(), "mode": "stack",
        "fps": FPS, "columns": max_cols,
        "videos": [ref["sha256"], ours["sha256"]], "spans": spans,
        "words": [ref_t.sha, ours_t.sha],
    })
    strips_dir = stack_dir / key[:16]
    manifest = _load_manifest(strips_dir, key)
    if manifest is not None:
        return manifest, True, strips_dir

    pairs, warn = pair_beats_covering(
        _beats_in_span(ref["beats"], spans[0]),
        _beats_in_span(ours["beats"], spans[1]))
    parts = subdivide_pairs(pairs, FPS, max_cols)

    def side(video: Path, analysis: dict, transcript: Transcript) -> dict:
        return {
            "video": video, "words": strip_words(transcript.words),
            "cuts": [c["time"] for c in analysis["cuts"]], "music": MUSIC_NA,
            "beats": analysis["beats"], "span": (0.0, analysis["duration"]),
            "audio_evidence": analysis.get("audio_evidence"),
        }

    tmp = stack_dir / f".tmp-{uuid.uuid4().hex}"
    tmp.mkdir()
    try:
        outs, cards = render_stack(
            side(ref_src.path, ref, ref_t), side(ours_src.path, ours, ours_t), FPS, tmp,
            pairs=parts, warn=warn, k_basis="longer", max_columns=max_cols)
        rows: list[dict] = []
        ref_cuts = [c["time"] for c in ref["cuts"]]
        ours_cuts = [c["time"] for c in ours["cuts"]]
        for i, (out, card) in enumerate(zip(outs, cards), 1):
            ra, rb = card["ref_span"]
            oa, ob = card["ours_span"]
            name = f"stack_{i:03d}_ref_{_fmt_t(ra)}-{_fmt_t(rb)}s.png"
            os.replace(out, tmp / name)
            rc = [c for c in ref_cuts if ra <= c < rb]
            oc = [c for c in ours_cuts if oa <= c < ob]
            r_ids = _beats_in(ref["beats"], ra, rb)
            o_ids = _beats_in(ours["beats"], oa, ob)
            rows.append({
                "file": name,
                "ref_span": [round(ra, 3), round(rb, 3)],
                "ours_span": [round(oa, 3), round(ob, 3)],
                "ref_beats": r_ids, "ours_beats": o_ids,
                "ref_cuts": rc, "ours_cuts": oc,
                "summary": (
                    f"REF {_fmt_t(ra)}–{_fmt_t(rb)}s ({_ids_label(r_ids)}, "
                    f"{_cuts_label(rc)}) ↔ OURS {_fmt_t(oa)}–{_fmt_t(ob)}s "
                    f"({_ids_label(o_ids)}, {_cuts_label(oc)}) · "
                    f"REF {_words_excerpt(ref_t.words, ra, rb)} · "
                    f"OURS {_words_excerpt(ours_t.words, oa, ob)}"),
            })
        if not rows:
            raise LookFailure("the stacked comparison produced no cards")
        _atomic_write_json(tmp / MANIFEST_NAME, {
            "schema": MANIFEST_SCHEMA, "key": key, "mode": "stack",
            "fps": FPS, "columns_per_card": max_cols, "warning": warn or None,
            "strips": rows,
        }, look_root)
        ref_src.check()
        ours_src.check()
        manifest = _publish(tmp, strips_dir, key, look_root)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return manifest, False, strips_dir


# ---------------------------------------------------------------------------
# the look
# ---------------------------------------------------------------------------

@dataclass
class Seen:
    role: str
    source: Source
    analysis: dict
    transcript: Transcript

    @property
    def path(self) -> Path:
        return self.source.path


@dataclass
class Result:
    mode: str
    cache: str
    videos: list[Seen]
    strips: list[dict]
    strips_dir: Path
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _see(role: str, source: Source, meta: dict, job: Path, look_root: Path, allow_paid: bool,
         notes: list[str]) -> Seen:
    media_dir = owned_dir(job, "strips", "look", source.sha[:16])
    analysis = analyze(source, meta, media_dir, look_root)
    transcript = resolve_transcript(source, meta, job, media_dir, look_root,
                                    allow_paid, notes)
    return Seen(role, source, analysis, transcript)


def _selected_span(duration: float, start: float, end: float | None,
                   name: str) -> tuple[float, float]:
    stop = duration if end is None else end
    if (not math.isfinite(start) or not math.isfinite(stop) or start < 0
            or stop <= start or stop > duration + 0.01):
        raise LookError(f"choose a valid --start and --end within {name}'s {_fmt_t(duration)}s duration")
    if stop - start < 1 / FPS - 0.001:
        raise LookError(f"choose at least {1 / FPS:g}s between --start and --end for {name}")
    if stop - start > MAX_LOOK_SECONDS + 0.01:
        raise LookError(f"a look covers at most {MAX_LOOK_SECONDS:g}s; choose a window with --start and --end")
    return start, min(stop, duration)


@contextlib.contextmanager
def _job_tempdir(job: Path) -> Iterator[Path]:
    """Point every temporary file of this look (frame extracts, decoded audio,
    the upload copy) at `<job>/strips/look/.tmp/`, never the system temp dir."""
    tmp = owned_dir(job, "strips", "look", ".tmp")
    previous = tempfile.tempdir
    tempfile.tempdir = str(tmp)
    try:
        yield tmp
    finally:
        tempfile.tempdir = previous


def look(args: argparse.Namespace) -> Result:
    if len(args.videos) not in (1, 2):
        raise LookError("give one video, or <reference> <ours> to stack them")
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise LookFailure(f"{binary} is required on PATH")
    job = resolve_job(args.job)
    look_root = owned_dir(job, "strips", "look")
    notes: list[str] = []
    allow_paid = not args.no_transcript
    with _job_tempdir(job):
        sources = [Source.open(resolve_video(raw, job)) for raw in args.videos]
        metas = [probe(source.path) for source in sources]
        spans = [_selected_span(meta["duration"], args.start, args.end, source.path.name)
                 for source, meta in zip(sources, metas)]
        for source, meta, span in zip(sources, metas, spans):
            if span != (0.0, meta["duration"]):
                notes.append(f"showing {_fmt_t(span[0])}–{_fmt_t(span[1])}s of {source.path.name}")
        if len(args.videos) == 1:
            seen = _see("video", sources[0], metas[0], job, look_root, allow_paid, notes)
            media_dir = owned_dir(job, "strips", "look", seen.source.sha[:16])
            manifest, hit, strips_dir = render_single(
                seen.source, seen.analysis, seen.transcript, media_dir, look_root, spans[0])
            videos = [seen]
        else:
            ref = _see("ref", sources[0], metas[0], job, look_root, allow_paid, notes)
            ours = _see("ours", sources[1], metas[1], job, look_root, allow_paid, notes)
            stack_dir = owned_dir(
                job, "strips", "look",
                f"stack-{ref.source.sha[:16]}-{ours.source.sha[:16]}")
            manifest, hit, strips_dir = render_stacked(
                ref.source, ref.analysis, ref.transcript,
                ours.source, ours.analysis, ours.transcript, stack_dir, look_root, spans)
            videos = [ref, ours]
    for seen in videos:  # cache hits included: never report evidence for replaced bytes
        seen.source.check()
    warnings = [manifest["warning"]] if manifest.get("warning") else []
    return Result("single" if len(videos) == 1 else "stack",
                  "hit" if hit else "miss", videos, manifest["strips"],
                  strips_dir, warnings, notes)


# ---------------------------------------------------------------------------
# output
# ---------------------------------------------------------------------------

def _n(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def _video_line(seen: Seen) -> str:
    a = seen.analysis
    return (f"{seen.path.name} ({_fmt_t(a['duration'])}s, {a['width']}x{a['height']}, "
            f"{_n(len(a['cuts']), 'cut')}, {_n(len(a['beats']), 'beat')}, "
            f"transcript: {seen.transcript.label})")


def as_text(result: Result) -> str:
    lines: list[str] = []
    fps = f"{FPS:g}"
    if result.mode == "single":
        seen = result.videos[0]
        a = seen.analysis
        lines.append(
            f"LOOK {seen.path.name} · {_fmt_t(a['duration'])}s {a['width']}x{a['height']} · "
            f"{_n(len(result.strips), 'strip')} @{fps}fps · {_n(len(a['cuts']), 'cut')} · "
            f"{_n(len(a['beats']), 'beat')} · transcript: {seen.transcript.label} · "
            f"cache: {result.cache}")
    else:
        ref, ours = result.videos
        lines.append(
            f"LOOK REF {_video_line(ref)} over OURS {_video_line(ours)} · "
            f"{_n(len(result.strips), 'card')}, beat-aligned, ≥{fps}fps · "
            f"cache: {result.cache}")
    lines += [f"warning: {w}" for w in result.warnings]
    lines += [f"note: {n}" for n in result.notes]
    for row in result.strips:
        lines.append(str((result.strips_dir / row["file"]).resolve()))
        lines.append(f"  {row['summary']}")
    return "\n".join(lines)


def as_json(result: Result) -> dict:
    videos = []
    for seen in result.videos:
        a = seen.analysis
        videos.append({
            "role": seen.role,
            "path": str(seen.path.resolve()),
            "sha256": a["sha256"],
            "duration": a["duration"],
            "width": a["width"],
            "height": a["height"],
            "has_audio": a["has_audio"],
            "cuts": [c["time"] for c in a["cuts"]],
            "beats": a["beats"],
            "transcript": {
                "state": seen.transcript.state,
                "words": None if seen.transcript.words is None else len(seen.transcript.words),
            },
        })
    strips = []
    for row in result.strips:
        item = {"png": str((result.strips_dir / row["file"]).resolve())}
        item.update({k: v for k, v in row.items() if k != "file"})
        strips.append(item)
    return {
        "schema": OUTPUT_SCHEMA,
        "mode": result.mode,
        "cache": result.cache,
        "fps": FPS,
        "videos": videos,
        "strips": strips,
        "warnings": result.warnings,
        "notes": result.notes,
    }


def _log(job_raw: str, result: Result) -> None:
    try:
        from log import log_event  # noqa: PLC0415
        job = resolve_job(job_raw)
        log_event(job, tool=TOOL_NAME, event="look_complete", extra={
            "usage_role": "look",
            "mode": result.mode,
            "cache": result.cache,
            "strips": len(result.strips),
            "videos": [{"name": s.path.name, "sha256": s.analysis["sha256"],
                        "transcript": s.transcript.state} for s in result.videos],
        })
    except Exception as exc:  # noqa: BLE001 — observability must never fail the look
        print(f"look_at_video: run log not written ({type(exc).__name__})", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if len(args.videos) > 2:
        parser.error("give one video, or <reference> <ours> to stack them")
    try:
        # Tool chatter (strip renders, the gateway) goes to stderr; stdout carries
        # only the result.
        with contextlib.redirect_stdout(sys.stderr):
            result = look(args)
            _log(args.job, result)
    except LookError as exc:
        print(f"look_at_video: {exc}", file=sys.stderr)
        return 2
    except LookFailure as exc:
        print(f"look_at_video: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(as_json(result), indent=2, ensure_ascii=False))
    else:
        print(as_text(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
