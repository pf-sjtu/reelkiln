"""
Pre-flight validator for the post-production layout.

Runs BEFORE remotion_render.py spends compute on the final pass. Confirms
that every text overlay declared in the script/style_directives:
  1. Doesn't sit inside a social-platform UI red zone
  2. Doesn't cover the speaker's face at the overlay's start timestamp
     (cheap MediaPipe face-detection, ~50ms per frame)

Refuses to greenlight the render if any check fails. The agent then either
moves the overlay or shortens its duration.

Usage (CLI):
  uv run python tools/preflight.py             # uses .current_job
  uv run python tools/preflight.py --job <id>
  uv run python tools/preflight.py --platform tiktok    # default: all_platforms

Usage (as module — called from remotion_render.py):
  from agent.tools.preflight import validate_layout
  validate_layout(job_dir)   # raises on failure

What's checked
--------------
- Overlays declared in script.json (parse_manual_overlays heuristic)
- Overlays from style_directives.json (Gemini replication_brief output)
- Approximated bounding boxes derived from each overlay's `kind` (hook/url/lower)
  using the same vertical placements that Captioned.tsx uses

Canvas
------
Every rectangle below is computed on the job's REAL output canvas (the authored
`style_directives.width/height`, else the renderer's default: 1080x1920, or the
source's landscape/square orientation — see job_inputs.default_video_canvas). The platform
red-zone table is authored for portrait only, so on any other aspect the
red-zone check is reported SKIPPED rather than run against stretched rectangles
— see `LayoutReport.red_zones`.

What's NOT checked
------------------
- Caption pages — they're dynamic per-frame and live in lower-third by default,
  which is in the all_platforms red zone but is the standard choice for vertical
  video, so we deliberately allow it.
- Hand collisions — Replicate SAM3 could give us those but it's expensive and
  not worth it for default talking-head shots. Use sam3.py manually if needed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from job import resolve_job_dir, add_job_arg
from log import log_event
from red_zones import REGISTRY, RedZone, ZoneResolution, collides_with_red_zones, iou, resolve_zones


# ---------------------------------------------------------------------------
# Approximate overlay bounding boxes — must match Overlays.tsx layout.
#
# 1080x1920 is the DEFAULT canvas, not a fixed one: a job may author any canvas
# in style_directives. Resolve the job's real canvas with `resolve_canvas()` and
# pass it to the bbox helpers; these constants are only the no-directive default.
# ---------------------------------------------------------------------------

CANVAS_W = 1080
CANVAS_H = 1920


def resolve_canvas(job_dir: Path) -> tuple[int, int]:
    """The job's actual final canvas — the same value the renderer builds with."""
    from job_inputs import default_video_canvas, explicit_video_canvas
    from remotion_render import load_style_directives

    directives = load_style_directives(job_dir)
    return explicit_video_canvas(directives) or default_video_canvas(job_dir, directives)


def caption_band_bbox(position: str, canvas_w: int = CANVAS_W, canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
    """Approximate the rectangle where caption pages are drawn, given a position.

    Mirrors verticalPlacement() in CaptionPage.tsx so the luminance sample
    covers the actual caption band (not the whole frame). Each band is ~22%
    of canvas height — generous enough to cover wrap variability.
    """
    band_h = int(canvas_h * 0.22)
    if position == "top":
        y = int(canvas_h * 0.12)
    elif position == "center":
        y = (canvas_h - band_h) // 2
    elif position == "bottom":
        y = canvas_h - int(canvas_h * 0.06) - band_h
    else:  # lower-third (default)
        y = canvas_h - int(canvas_h * 0.18) - band_h
    return (60, y, canvas_w - 120, band_h)


def overlay_bbox(kind: str, canvas_w: int = CANVAS_W,
                 canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
    """Approximate (x, y, w, h) of an overlay component on the given canvas.

    These have to track Overlays.tsx — when you change a component's padding/
    sizing there, update this table. The boxes are intentionally generous
    (~10% padding around the visible text) so we catch near-collisions.

    Overlays.tsx anchors every component in ABSOLUTE pixels (centred
    horizontally, offset from the top or bottom edge), so a non-default canvas
    re-anchors the same pixel sizes — it does not rescale them.
    """
    if kind == "hook":
        # Big bold pill near top of frame. maxWidth 940 inside 60px side padding.
        width = max(1, min(940, canvas_w - 120))
        return ((canvas_w - width) // 2, 200, width, 220)
    if kind == "url":
        # Bottom URL pill, animated in from below. ~600px wide, 110px tall.
        width = max(1, min(600, canvas_w))
        return ((canvas_w - width) // 2, max(0, canvas_h - 80 - 110), width, 110)
    if kind == "lower":
        # Small lower-third citation. ~700px wide, 80px tall, paddingBottom 460.
        width = max(1, min(700, canvas_w))
        return ((canvas_w - width) // 2, max(0, canvas_h - 460 - 80), width, 80)
    # Unknown kind — be defensive, return a tiny rect at center
    return (canvas_w // 2, canvas_h // 2, 1, 1)


# ---------------------------------------------------------------------------
# Frame extraction + face detection
# ---------------------------------------------------------------------------


@dataclass
class FaceBox:
    x: int
    y: int
    width: int
    height: int


def _extract_frame(video_path: Path, t_seconds: float) -> Path:
    out = Path(tempfile.mkstemp(suffix=".jpg")[1])
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{max(0.0, t_seconds):.3f}",
        "-i", str(video_path),
        "-frames:v", "1",
        "-q:v", "3",
        str(out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not out.exists():
        raise RuntimeError(f"ffmpeg frame extract failed at t={t_seconds}: {res.stderr[-300:]}")
    return out


def _detect_faces(image_path: Path) -> list[FaceBox]:
    """Face detection. Returns boxes in image-pixel coordinates.

    Uses OpenCV's bundled Haar cascade — fast (<50ms), no model download, good
    enough for bbox-level overlay collision checks. We don't need landmarks
    here, just "where's the face." For pixel-accurate masks, use sam3.py.

    Imported lazily so a missing opencv install doesn't break unrelated code.
    """
    try:
        import cv2
    except ImportError as e:
        raise RuntimeError(
            "preflight needs opencv-python. Install with:\n"
            "  uv add opencv-python"
        ) from e

    img = cv2.imread(str(image_path))
    if img is None:
        return []
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        return []
    detections = cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5,
        minSize=(80, 80),  # the speaker is medium-close → faces are large
    )
    return [FaceBox(int(x), int(y), int(w), int(h)) for (x, y, w, h) in detections]


def _scale_face_to_canvas(face: FaceBox, src_w: int, src_h: int,
                          canvas_w: int = CANVAS_W, canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
    sx = canvas_w / src_w
    sy = canvas_h / src_h
    return (int(face.x * sx), int(face.y * sy),
            int(face.width * sx), int(face.height * sy))


def _sample_band_luminance(video_path: Path, band_canvas_rect: tuple[int, int, int, int],
                           sample_seconds: list[float],
                           canvas_w: int = CANVAS_W,
                           canvas_h: int = CANVAS_H) -> float | None:
    """Sample mean luminance (0-255) inside the caption band across N timestamps.

    Returns the average across all sampled frames so a single dark cut doesn't
    flip the outline color. If sampling fails entirely, returns None and the
    renderer falls back to its static default (black outline).
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None

    sums: list[float] = []
    bx, by, bw, bh = band_canvas_rect
    for t in sample_seconds:
        try:
            frame = _extract_frame(video_path, t)
            img = cv2.imread(str(frame))
            frame.unlink(missing_ok=True)
            if img is None:
                continue
            sh, sw = img.shape[:2]
            # Scale band rect (defined on the job's canvas) into source pixels.
            sx = sw / canvas_w
            sy = sh / canvas_h
            x0 = max(0, int(bx * sx))
            y0 = max(0, int(by * sy))
            x1 = min(sw, int((bx + bw) * sx))
            y1 = min(sh, int((by + bh) * sy))
            if x1 <= x0 or y1 <= y0:
                continue
            crop = img[y0:y1, x0:x1]
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            sums.append(float(np.mean(gray)))
        except Exception:
            continue
    if not sums:
        return None
    return sum(sums) / len(sums)


def measure_caption_luminance(job_dir: Path, *, position: str = "lower-third",
                              n_samples: int = 6,
                              canvas: tuple[int, int] | None = None) -> float | None:
    """Sample mean luminance (0-255) under the caption band over the stitched
    video, write `<job_dir>/caption_luminance.json`, and return the value.

    The renderer reads this file before bundling and forwards it to
    CaptionPage.tsx as `captionStyle.background_luminance`, which auto-flips
    the outline color (light video → black outline, dark video → white).
    """
    video_path = job_dir / "final_raw.mp4"
    if not video_path.exists():
        return None
    # Sample N evenly-spaced timestamps. Use ffprobe for duration if available,
    # fall back to a fixed sweep.
    duration = 30.0
    try:
        import subprocess
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
            capture_output=True, text=True, timeout=15,
        )
        if res.returncode == 0 and res.stdout.strip():
            duration = float(res.stdout.strip())
    except Exception:
        pass
    canvas_w, canvas_h = canvas or resolve_canvas(job_dir)
    samples = [duration * (i + 0.5) / n_samples for i in range(n_samples)]
    band = caption_band_bbox(position, canvas_w, canvas_h)
    avg = _sample_band_luminance(video_path, band, samples, canvas_w, canvas_h)
    if avg is None:
        return None
    out = {
        "position": position,
        "canvas": [canvas_w, canvas_h],
        "samples": samples,
        "band_canvas_rect": list(band),
        "luminance_avg": round(avg, 2),
        "video_duration": duration,
    }
    (job_dir / "caption_luminance.json").write_text(json.dumps(out, indent=2))
    log_event(
        job_dir, tool="preflight.py", event="caption_luminance_sampled",
        extra=out,
    )
    return avg


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@dataclass
class Issue:
    overlay_kind: str
    overlay_text: str
    start_sec: float
    end_sec: float
    issue: str
    detail: str = ""

    def format(self) -> str:
        return (f"[{self.overlay_kind} @ {self.start_sec:.1f}-{self.end_sec:.1f}s] "
                f"{self.issue}: {self.detail} "
                f"(text: {self.overlay_text!r})")


def _gather_overlays(job_dir: Path) -> list[dict]:
    """Pull overlays from style_directives.json + script.json post_production_notes."""
    # Lazy import so preflight.py is independent of remotion_render.py at top
    from remotion_render import (
        load_style_directives, overlays_from_directives, parse_manual_overlays,
    )
    out: list[dict] = []
    directives = load_style_directives(job_dir)
    if directives:
        out.extend(overlays_from_directives(directives))
    script_path = job_dir / "script.json"
    if script_path.exists():
        out.extend(parse_manual_overlays(json.loads(script_path.read_text())))
    return out


@dataclass
class LayoutReport:
    """Issues plus what was actually checked.

    `issues` alone cannot say whether a check ran, so a caller that only reads
    it would report a skipped red-zone check as a clean pass. `red_zones` and
    `skipped_checks` are the record that keeps those two apart.
    """

    issues: list[Issue]
    platform: str
    canvas: tuple[int, int]
    red_zones: ZoneResolution | None

    @property
    def skipped_checks(self) -> list[str]:
        if self.red_zones is not None and not self.red_zones.applicable:
            return ["platform_red_zones"]
        return []

    def notices(self) -> list[str]:
        if self.red_zones is not None and not self.red_zones.applicable:
            return [self.red_zones.notice()]
        return []


def validate_layout_report(
    job_dir: Path,
    platform: str = "all_platforms",
    *,
    canvas: tuple[int, int] | None = None,
    iou_threshold_face: float = 0.10,
    iou_threshold_red: float = 0.05,
) -> LayoutReport:
    """Run every check on the job's real canvas and report what ran.

    `canvas` is the canvas the caller is actually rendering. Pass it whenever
    you have it: `resolve_canvas` only reads `<job_dir>/style_directives.json`,
    so a render driven by `--style_directives <other.json>` would otherwise be
    gated against a canvas it is not being built on.

    Logs results to the job's run.log.jsonl. Does NOT raise — caller decides
    whether issues are blocking.
    """
    overlays = _gather_overlays(job_dir)

    issues: list[Issue] = []
    try:
        canvas_w, canvas_h = canvas or resolve_canvas(job_dir)
    except ValueError as exc:
        # The renderer refuses this canvas too; say so instead of silently
        # measuring against the portrait default.
        return LayoutReport(
            issues=[Issue("canvas", "", 0.0, 0.0, "canvas_unresolved", str(exc)[:200])],
            platform=platform, canvas=(CANVAS_W, CANVAS_H), red_zones=None,
        )
    zone_check = resolve_zones(platform, canvas_w, canvas_h)
    zones = zone_check.zones

    video_path = job_dir / "final_raw.mp4"
    have_video = video_path.exists()

    for o in overlays:
        kind = o.get("kind", "lower")
        text = o.get("text", "")
        s = float(o.get("start", 0))
        e = float(o.get("end", 0))
        rect = overlay_bbox(kind, canvas_w, canvas_h)

        # 1. Red-zone collision — only where this canvas has authored zones.
        # Everywhere else the check is reported skipped, never inferred clean.
        hits = (collides_with_red_zones(rect, zones, threshold=iou_threshold_red)
                if zone_check.applicable else [])
        if hits:
            issues.append(Issue(
                kind, text, s, e, "red_zone_collision",
                f"intersects {[h.label for h in hits]} on {platform}",
            ))

        # 1b. Caption-band collision — flag overlays that overlap the caption
        # band (lower-third by default). The MCC-card-covers-captions failure
        # mode (Awaken job round 2) is exactly this. Mid-overlay bands like
        # `lower` are designed to sit JUST above captions; if your custom
        # overlay's bbox overlaps the caption band, captions are obscured.
        cap_band = caption_band_bbox("lower-third", canvas_w, canvas_h)
        cap_iou = iou(rect, cap_band)
        if cap_iou > 0.05:  # >5% overlap
            issues.append(Issue(
                kind, text, s, e, "caption_band_collision",
                f"overlay overlaps caption band (IOU={cap_iou:.2f}). Move overlay clear of "
                f"y≈{cap_band[1]}-{cap_band[1] + cap_band[3]} or render captions outside this band.",
            ))

        # 2. Face collision (only if we have the underlying video)
        if have_video:
            try:
                frame = _extract_frame(video_path, s + 0.1)
                faces = _detect_faces(frame)
                src_img = frame
                # Read source dimensions for scaling
                import cv2
                img = cv2.imread(str(src_img))
                if img is not None:
                    src_h, src_w = img.shape[:2]
                    for face in faces:
                        face_canvas = _scale_face_to_canvas(face, src_w, src_h,
                                                            canvas_w, canvas_h)
                        face_iou = iou(rect, face_canvas)
                        if face_iou > iou_threshold_face:
                            issues.append(Issue(
                                kind, text, s, e, "face_collision",
                                f"IOU={face_iou:.2f} with face at "
                                f"{face_canvas} (canvas px)",
                            ))
                frame.unlink(missing_ok=True)
            except Exception as exc:
                # Don't let face detection break the build — log and continue.
                issues.append(Issue(
                    kind, text, s, e, "face_check_error",
                    f"{type(exc).__name__}: {str(exc)[:120]}",
                ))

    # Caption luminance: sample under the caption band and persist a hint that
    # the renderer reads to auto-flip outline color. Cheap (~6 frames). Best-
    # effort — never blocks the render.
    caption_position = "lower-third"
    if have_video:
        try:
            measure_caption_luminance(job_dir, position=caption_position,
                                      canvas=(canvas_w, canvas_h))
        except Exception as exc:
            issues.append(Issue(
                "caption_band", "", 0.0, 0.0, "luminance_sample_error",
                f"{type(exc).__name__}: {str(exc)[:120]}",
            ))

    report = LayoutReport(issues=issues, platform=platform,
                          canvas=(canvas_w, canvas_h), red_zones=zone_check)

    log_event(
        job_dir, tool="preflight.py", event="layout_validated",
        extra={
            "platform": platform,
            "canvas": [canvas_w, canvas_h],
            "red_zone_check": zone_check.receipt(),
            "skipped_checks": report.skipped_checks,
            "overlays_checked": len(overlays),
            "issues": len(issues),
            "issue_kinds": sorted({i.issue for i in issues}),
            "video_present": have_video,
        },
    )

    return report


def validate_layout(
    job_dir: Path,
    platform: str = "all_platforms",
    *,
    canvas: tuple[int, int] | None = None,
    iou_threshold_face: float = 0.10,
    iou_threshold_red: float = 0.05,
) -> list[Issue]:
    """Blocking issues only — the historical contract callers gate renders on.

    A skipped check is NOT an issue (it must never block a legitimate render),
    so it is announced on stdout here and recorded in the run log. Callers that
    want it structured should use `validate_layout_report`.
    """
    report = validate_layout_report(
        job_dir, platform, canvas=canvas,
        iou_threshold_face=iou_threshold_face,
        iou_threshold_red=iou_threshold_red,
    )
    for notice in report.notices():
        print(f"⚠ Pre-flight {notice}")
    return report.issues


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_job_arg(parser)
    parser.add_argument("--platform", default="all_platforms",
                        choices=list(REGISTRY.keys()),
                        help="Which platform's red zones to enforce (default: all_platforms)")
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero if any issue is found")
    args = parser.parse_args()

    job = resolve_job_dir(args.job)
    report = validate_layout_report(job, platform=args.platform)
    issues = report.issues
    print(f"Canvas: {report.canvas[0]}x{report.canvas[1]}")
    for notice in report.notices():
        print(f"⚠ {notice}")

    if not issues:
        checked = "all checks" if not report.skipped_checks else (
            f"all checks except {', '.join(report.skipped_checks)}")
        print(f"✓ Layout is clean for {args.platform} ({checked})")
        return

    print(f"✗ {len(issues)} layout issue(s) for {args.platform}:")
    for i in issues:
        print(f"  - {i.format()}")

    if args.strict:
        sys.exit(1)


if __name__ == "__main__":
    main()
