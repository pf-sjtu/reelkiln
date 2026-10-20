"""
check_layout — pre-render gate for layout correctness.

ONE self-contained tool, parameterized by `--role`. Absorbs the logic of four
former backends (all of which are being DELETED — do NOT import them):

  * preflight.py             → `--role collision`  (face/caption + red-zone guard)
  * check_overlay_anchors.py → `--role anchors`    (findWord/findRange validity)
  * darkspace.py             → `--role luma`        (luminance-bbox finder; was
                                                     MISSING from repo, session
                                                     91e277d3 — reconstructed here)
  * sample_caption_luma.py   → `--role luma`        (caption-band luma sampler)

Gates the visual plan before Remotion renders — catches face/caption collision,
validates findWord/findRange overlay anchors against the word-timed transcript,
and finds caption-safe luminance regions on B-roll so captions don't disappear
into a bright sky. The question this tool answers: "will it render correctly?"

Usage (CLI):
  uv run python tools/check_layout.py --job <id> --role collision [--frame <png>] [--platform tiktok]
  uv run python tools/check_layout.py --job <id> --role anchors   [--transcript <json>] [--overlays <tsx>]
  uv run python tools/check_layout.py --job <id> --role luma       --frame <png> [--threshold 80]
  uv run python tools/check_layout.py --job <id> --role all

`--role` is REQUIRED and logged as `usage_role` on every event. `--job` is always
required (MEMORY: concurrent jobs clobber `.current_job`; every pipeline tool
must pass `--job` explicitly).

This tool ONLY imports low-level shared helpers that survive the consolidation
(_paths, job, log, red_zones). It does NOT import preflight / check_overlay_anchors
/ darkspace / sample_caption_luma — their logic is inlined below verbatim so the
results are identical.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from job import resolve_job_dir, add_job_arg  # noqa: E402
from job_inputs import (  # noqa: E402
    VALID_CAPTION_TRANSFORMS, default_video_canvas, explicit_video_canvas,
    parse_manual_overlays,
)
from log import log_event  # noqa: E402
from red_zones import (  # noqa: E402
    REGISTRY, RedZone, ZoneResolution, collides_with_red_zones, iou, resolve_zones,
)


ROLES = ("collision", "anchors", "luma", "all")

# ---------------------------------------------------------------------------
# Canvas constants — the DEFAULT Remotion composition (1080x1920 @ 9:16), not a
# fixed one. A job may author any final canvas in style_directives, so resolve
# the real one with `resolve_canvas()` and pass it to the geometry helpers.
# With no authored canvas the renderer follows the source's orientation
# (job_inputs.default_video_canvas); these constants are its portrait default.
# ---------------------------------------------------------------------------

CANVAS_W = 1080
CANVAS_H = 1920


def resolve_canvas(job_dir: Path) -> tuple[int, int]:
    """The job's actual final canvas — the same value the renderer builds with."""
    directives = load_style_directives(job_dir)
    return explicit_video_canvas(directives) or default_video_canvas(job_dir, directives)


# ===========================================================================
# Shared overlay-gathering logic.
#
# Directive helpers are inlined from compose_render.py; manual overlay parsing
# comes from renderer-neutral job_inputs. No dependency on a render tool module.
# ===========================================================================


def _strip_md_fence(raw: str) -> str:
    raw = raw.strip()
    if not raw.startswith("```"):
        return raw
    body = raw.split("```", 2)
    if len(body) < 2:
        return raw
    stripped = body[1]
    if stripped.startswith("json\n"):
        stripped = stripped[5:]
    return stripped


def _coerce_directives(d: dict) -> dict:
    """Forgive variant field names Gemini sometimes invents (matches compose_render)."""
    if not isinstance(d, dict):
        return d
    cs = d.get("caption_style") or d.get("captions") or d.get("caption")
    if cs is None:
        keys_at_top = {
            k for k in (
                "font", "font_family", "font_weight", "weight", "color", "stroke",
                "stroke_width_px", "outline_color", "outline_width_px",
                "highlight_color", "active_word_color", "background",
                "position", "position_y", "page_size_words", "switch_ms",
                "transform", "text_align",
            ) if k in d
        }
        if keys_at_top:
            cs = {k: d[k] for k in keys_at_top}
    if isinstance(cs, dict):
        cs = dict(cs)
        if "font" in cs and "font_family" not in cs:
            cs["font_family"] = cs.pop("font")
        if "font_weight" in cs and "weight" not in cs:
            cs["weight"] = cs.pop("font_weight")
        if "stroke" in cs and "outline_color" not in cs:
            cs["outline_color"] = cs.pop("stroke")
        if "stroke_width_px" in cs and "outline_width_px" not in cs:
            cs["outline_width_px"] = cs.pop("stroke_width_px")
        if "highlight_color" in cs and "active_word_color" not in cs:
            cs["active_word_color"] = cs.pop("highlight_color")
        if "position_y" in cs and "position" not in cs:
            cs["position"] = cs.pop("position_y")
        if cs.get("position") in {"middle"}:
            cs["position"] = "center"
        if cs.get("position") in {"bottom-third", "lower_third"}:
            cs["position"] = "lower-third"
        if cs.get("transform") not in (None, *VALID_CAPTION_TRANSFORMS):
            cs["transform"] = "none"
        d = {**d, "caption_style": cs}

    cuts = d.get("cut_points")
    if isinstance(cuts, list) and cuts and max(cuts) > 60:
        d = {**d, "cut_points": [round(c / 1000.0, 3) for c in cuts]}

    overlays = d.get("overlays")
    if isinstance(overlays, dict):
        flat = {}
        if overlays.get("hook") and overlays["hook"].get("text"):
            h = overlays["hook"]
            flat["hook"] = {
                "text": h["text"],
                "start_sec": (h.get("start_ms", 0) or 0) / 1000.0,
                "end_sec": ((h.get("start_ms", 0) or 0) + (h.get("duration_ms", 0) or 0)) / 1000.0,
            }
        if overlays.get("url") or overlays.get("url_pill"):
            u = overlays.get("url") or overlays.get("url_pill")
            if u and u.get("text"):
                flat["url_pill"] = {
                    "text": u["text"],
                    "start_sec": float(u.get("start_sec", 0)),
                    "end_sec": float(u.get("end_sec", 0)),
                }
        d = {**d, **{k: v for k, v in flat.items() if k not in d}}

    if "audio_instructions" in d and "music" not in d:
        ai = d["audio_instructions"] or {}
        d = {**d, "music": {
            "use_reference_bed": (ai.get("bgm_style") or "").lower() not in ("none", "", "no music"),
            "notes": ai.get("bgm_style", ""),
        }}
    return d


def load_style_directives(job_dir: Path, override_path: Path | None = None) -> dict | None:
    path = override_path if override_path else (job_dir / "style_directives.json")
    if not path.exists():
        return None
    raw = _strip_md_fence(path.read_text())
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[check_layout] WARN: style_directives present but invalid JSON: {e}")
        return None
    return _coerce_directives(parsed)


def overlays_from_directives(directives: dict) -> list[dict]:
    """Translate structured replication_brief overlays into renderer overlays."""
    out: list[dict] = []
    hook = directives.get("hook")
    if hook and hook.get("text"):
        out.append({"kind": "hook", "text": str(hook["text"]).upper(),
                    "start": float(hook.get("start_sec", 0.5)),
                    "end": float(hook.get("end_sec", 4.0))})
    for lt in directives.get("lower_thirds") or []:
        if lt.get("text"):
            out.append({"kind": "lower", "text": str(lt["text"]),
                        "start": float(lt.get("start_sec", 0)),
                        "end": float(lt.get("end_sec", 0))})
    pill = directives.get("url_pill")
    if pill and pill.get("text"):
        out.append({"kind": "url", "text": str(pill["text"]),
                    "start": float(pill.get("start_sec", 0)),
                    "end": float(pill.get("end_sec", 0))})
    return out


# ===========================================================================
# Approximate overlay / caption-band bounding boxes — must match the Remotion
# CaptionPage / Overlays components.  (Inlined from preflight.py verbatim.)
# ===========================================================================


def caption_band_bbox(position: str, canvas_w: int = CANVAS_W,
                      canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
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


# ===========================================================================
# Frame extraction + face detection  (inlined from preflight.py verbatim).
# ===========================================================================


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
            "check_layout collision role needs opencv-python. Install with:\n"
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
                          canvas_w: int = CANVAS_W,
                          canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
    sx = canvas_w / src_w
    sy = canvas_h / src_h
    return (int(face.x * sx), int(face.y * sy),
            int(face.width * sx), int(face.height * sy))


# ===========================================================================
# Caption-band luminance sampler (inlined from preflight.py verbatim).
# ===========================================================================


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
                              usage_role: str | None = None,
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
        job_dir, tool="check_layout.py", event="caption_luminance_sampled",
        extra={**out, "usage_role": usage_role},
    )
    return avg


# ===========================================================================
# ROLE: collision — face/caption + red-zone guard (was preflight.py).
# ===========================================================================


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
    out: list[dict] = []
    directives = load_style_directives(job_dir)
    if directives:
        out.extend(overlays_from_directives(directives))
    script_path = job_dir / "script.json"
    if script_path.exists():
        out.extend(parse_manual_overlays(json.loads(script_path.read_text())))
    return out


def _card_caption_collisions(job_dir: Path) -> list[Issue]:
    """Check declared cards against caption pages, including their held tails.

    This is a timing warning, not OCR or proof of a spatial intersection.
    """
    from hyperframes_captions import (
        DEFAULT_SWITCH_MS, _parse_hide_ranges_ms, build_pages, resolve_style, schedule)

    boundaries = job_dir / "chunk_boundaries.json"
    transcript = job_dir / "transcript.json"
    if not boundaries.exists() or not transcript.exists():
        return []
    words = json.loads(transcript.read_text()).get("words", []) or []
    if not words:
        return []
    chunks = json.loads(boundaries.read_text()).get("chunks", [])
    directives = load_style_directives(job_dir) or {}
    style = resolve_style(preset=directives.get("caption_preset"),
                          overrides=directives.get("caption_style"))
    switch_ms = int(style.get("switch_ms", DEFAULT_SWITCH_MS))
    pages = schedule(build_pages(words, switch_ms=switch_ms,
                                break_on_sentence=style.get("break_on_sentence", True)),
                     switch_ms=switch_ms)
    hidden = [(a / 1000, b / 1000) for a, b in _parse_hide_ranges_ms(style.get("hide_ranges_ms"))]
    issues = []
    for chunk in chunks:
        if chunk.get("role") not in {"card", "title_card", "text_card"}:
            continue
        start, end = float(chunk["start_sec"]), float(chunk["end_sec"])
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end):
            raise ValueError("declared card needs finite 0 <= start_sec < end_sec")
        for page in pages:
            cursor, stop = max(start, page["start_s"]), min(end, page["end_s"])
            if cursor >= stop:
                continue
            # Hide ranges arrive sorted and merged; skip past any that cover us.
            for hide_start, hide_end in hidden:
                if hide_start > cursor:
                    break
                cursor = max(cursor, hide_end)
            if cursor >= stop:
                continue
            issues.append(Issue(
                "card", chunk.get("name", ""), start, end, "card_caption_overlap",
                "Captions may cover this declared card's baked-in text. "
                f"Set caption_style.hide_ranges_ms to include [{start * 1000:g}, {end * 1000:g}] "
                "in style_directives.json, or move the captions clear of the card text after inspecting it.",
            ))
            break
    return issues


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
    frame_override: Path | None = None,
    usage_role: str | None = None,
    canvas: tuple[int, int] | None = None,
    iou_threshold_face: float = 0.10,
    iou_threshold_red: float = 0.05,
) -> LayoutReport:
    """Run every collision check on the job's real canvas and report what ran.

    `canvas` is the canvas the caller is actually rendering. Pass it whenever
    you have it: `resolve_canvas` only reads `<job_dir>/style_directives.json`,
    so a render driven by `--style_directives <other.json>` would otherwise be
    gated against a canvas it is not being built on.

    Logs results to the job's run.log.jsonl. Does NOT raise — caller decides
    whether issues are blocking.

    `frame_override` lets the caller supply a single representative PNG to run
    the face-detect against (collision role's `--frame`). When omitted, the tool
    pulls per-overlay frames from the job's `final_raw.mp4` at each overlay start.
    """
    overlays = _gather_overlays(job_dir)

    issues: list[Issue] = []
    try:
        issues.extend(_card_caption_collisions(job_dir))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
        issues.append(Issue("card", "", 0.0, 0.0, "card_caption_check_error", str(exc)[:200]))
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

    # If a representative frame PNG was supplied, detect faces in it once and
    # reuse that face set for every overlay (cheaper + matches the skill's
    # "pass a representative frame" contract).
    static_faces_canvas: list[tuple[int, int, int, int]] | None = None
    if frame_override is not None and frame_override.exists():
        try:
            import cv2
            faces = _detect_faces(frame_override)
            img = cv2.imread(str(frame_override))
            if img is not None:
                src_h, src_w = img.shape[:2]
                static_faces_canvas = [
                    _scale_face_to_canvas(f, src_w, src_h, canvas_w, canvas_h)
                    for f in faces
                ]
        except Exception as exc:
            issues.append(Issue(
                "frame", "", 0.0, 0.0, "face_check_error",
                f"{type(exc).__name__}: {str(exc)[:120]}",
            ))

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
        # mode (Awaken job round 2) is exactly this.
        cap_band = caption_band_bbox("lower-third", canvas_w, canvas_h)
        cap_iou = iou(rect, cap_band)
        if cap_iou > 0.05:  # >5% overlap
            issues.append(Issue(
                kind, text, s, e, "caption_band_collision",
                f"overlay overlaps caption band (IOU={cap_iou:.2f}). Move overlay clear of "
                f"y≈{cap_band[1]}-{cap_band[1] + cap_band[3]} or render captions outside this band.",
            ))

        # 2. Face collision.
        if static_faces_canvas is not None:
            for face_canvas in static_faces_canvas:
                face_iou = iou(rect, face_canvas)
                if face_iou > iou_threshold_face:
                    issues.append(Issue(
                        kind, text, s, e, "face_collision",
                        f"IOU={face_iou:.2f} with face at {face_canvas} (canvas px)",
                    ))
        elif have_video:
            try:
                frame = _extract_frame(video_path, s + 0.1)
                faces = _detect_faces(frame)
                import cv2
                img = cv2.imread(str(frame))
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
    if have_video:
        try:
            measure_caption_luminance(job_dir, position="lower-third",
                                      usage_role=usage_role,
                                      canvas=(canvas_w, canvas_h))
        except Exception as exc:
            issues.append(Issue(
                "caption_band", "", 0.0, 0.0, "luminance_sample_error",
                f"{type(exc).__name__}: {str(exc)[:120]}",
            ))

    report = LayoutReport(issues=issues, platform=platform,
                          canvas=(canvas_w, canvas_h), red_zones=zone_check)

    log_event(
        job_dir, tool="check_layout.py", event="layout_validated",
        extra={
            "usage_role": usage_role,
            "platform": platform,
            "canvas": [canvas_w, canvas_h],
            "red_zone_check": zone_check.receipt(),
            "skipped_checks": report.skipped_checks,
            "overlays_checked": len(overlays),
            "issues": len(issues),
            "issue_kinds": sorted({i.issue for i in issues}),
            "video_present": have_video,
            "frame_override": str(frame_override) if frame_override else None,
        },
    )

    return report


def validate_layout(
    job_dir: Path,
    platform: str = "all_platforms",
    *,
    frame_override: Path | None = None,
    usage_role: str | None = None,
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
        job_dir, platform, frame_override=frame_override, usage_role=usage_role,
        canvas=canvas, iou_threshold_face=iou_threshold_face,
        iou_threshold_red=iou_threshold_red,
    )
    for notice in report.notices():
        print(f"⚠ Pre-flight {notice}")
    return report.issues


def run_collision(job_dir: Path, *, platform: str, frame: Path | None,
                  usage_role: str, strict: bool) -> int:
    """`--role collision` entrypoint. Returns process exit code."""
    report = validate_layout_report(job_dir, platform=platform,
                                    frame_override=frame, usage_role=usage_role)
    issues = report.issues
    print(f"Canvas: {report.canvas[0]}x{report.canvas[1]}")
    for notice in report.notices():
        print(f"⚠ {notice}")
    if not issues:
        checked = ("no face/caption/red-zone collisions" if not report.skipped_checks
                   else f"no face/caption collisions; skipped {', '.join(report.skipped_checks)}")
        print(f"✓ Layout is clean for {platform} ({checked})")
        return 0
    print(f"✗ {len(issues)} layout issue(s) for {platform}:")
    for i in issues:
        print(f"  - {i.format()}")
    return 1 if strict else 0


# ===========================================================================
# ROLE: anchors — findWord / findRange validity (was check_overlay_anchors.py).
# ===========================================================================

# Regex for findWord(words, "needle", N) — handles single + double quotes
FIND_WORD_RE = re.compile(
    r'findWord\s*\(\s*[^,]+,\s*["\']([^"\']+)["\']\s*(?:,\s*(-?\d+))?\s*\)'
)
# Regex for findRange(words, "start", "end", N, M)
FIND_RANGE_RE = re.compile(
    r'findRange\s*\(\s*[^,]+,\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']+)["\']\s*'
    r'(?:,\s*(-?\d+)\s*,\s*(-?\d+))?\s*\)'
)


def normalize(s: str) -> str:
    """Match the norm() function used in the overlay codebase."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def find_occurrences(words: list[dict], needle: str) -> list[dict]:
    """Return every word that matches `needle` after normalization."""
    target = normalize(needle)
    return [w for w in words if normalize(w.get("word", "")) == target]


def check_anchors(job_dir: Path, *, overlays_path: Path | None = None,
                  transcript_path: Path | None = None,
                  usage_role: str | None = None) -> int:
    """`--role anchors` entrypoint. Returns 1 if blocking issues, else 0."""
    overlays_path = overlays_path or (job_dir / "overlays.tsx")
    transcript_path = transcript_path or (job_dir / "transcript.json")

    if not overlays_path.exists():
        print(f"No overlays.tsx at {overlays_path} — nothing to check.")
        log_event(job_dir, tool="check_layout.py", event="anchors_checked",
                  extra={"usage_role": usage_role, "skipped": "no_overlays",
                         "issues": 0})
        return 0
    if not transcript_path.exists():
        print(f"ERROR: {transcript_path} missing. Run elevenlabs.py first.", file=sys.stderr)
        return 1

    src = overlays_path.read_text()
    transcript = json.loads(transcript_path.read_text())
    words = transcript.get("words", [])

    issues: list[str] = []
    findings: list[str] = []

    # findWord calls
    for m in FIND_WORD_RE.finditer(src):
        needle = m.group(1)
        occ = int(m.group(2)) if m.group(2) else 1
        matches = find_occurrences(words, needle)
        if not matches:
            issues.append(f"❌ findWord(\"{needle}\", {occ}) — word not in transcript at all")
            continue
        if occ > len(matches) or (occ < 0 and abs(occ) > len(matches)):
            issues.append(
                f"❌ findWord(\"{needle}\", {occ}) — only {len(matches)} occurrence(s) in transcript"
            )
            continue
        # Resolve which occurrence we matched
        idx = (occ - 1) if occ > 0 else (len(matches) + occ)
        chosen = matches[idx]
        # Show context: 3 words before + 3 words after
        word_idx = words.index(chosen)
        ctx_start = max(0, word_idx - 3)
        ctx_end = min(len(words), word_idx + 4)
        ctx = " ".join(
            (f"**{w['word']}**" if i + ctx_start == word_idx else w["word"])
            for i, w in enumerate(words[ctx_start:ctx_end])
        )
        if len(matches) > 1 and abs(occ) == 1:
            findings.append(
                f"⚠️  findWord(\"{needle}\", {occ}) — {len(matches)} matches, picked first → "
                f"~{chosen['start']:.2f}s: \"{ctx}\". "
                f"If you wanted a different one, pass occurrence #2..#{len(matches)} or -1 (last)."
            )
        else:
            findings.append(
                f"✓ findWord(\"{needle}\", {occ}) → ~{chosen['start']:.2f}s: \"{ctx}\""
            )

    # findRange calls
    for m in FIND_RANGE_RE.finditer(src):
        start_word = m.group(1)
        end_word = m.group(2)
        s_occ = int(m.group(3)) if m.group(3) else 1
        e_occ = int(m.group(4)) if m.group(4) else 1
        s_matches = find_occurrences(words, start_word)
        e_matches = find_occurrences(words, end_word)
        if not s_matches:
            issues.append(f"❌ findRange(start=\"{start_word}\") — word not in transcript")
        if not e_matches:
            issues.append(f"❌ findRange(end=\"{end_word}\") — word not in transcript")
        if s_matches and e_matches:
            # Resolve which start + end occurrences we matched
            s_idx = (s_occ - 1) if s_occ > 0 else (len(s_matches) + s_occ)
            e_idx = (e_occ - 1) if e_occ > 0 else (len(e_matches) + e_occ)
            if 0 <= s_idx < len(s_matches) and 0 <= e_idx < len(e_matches):
                s_chosen = s_matches[s_idx]
                e_chosen = e_matches[e_idx]
                if len(s_matches) > 1 and abs(s_occ) == 1:
                    findings.append(
                        f"⚠️  findRange(\"{start_word}\"#{s_occ}…\"{end_word}\"#{e_occ}) — "
                        f"start word has {len(s_matches)} matches, picked first → "
                        f"~{s_chosen['start']:.2f}s. Consider explicit occurrence."
                    )
                else:
                    findings.append(
                        f"✓ findRange(\"{start_word}\"#{s_occ}…\"{end_word}\"#{e_occ}) → "
                        f"~{s_chosen['start']:.2f}s–{e_chosen['end']:.2f}s"
                    )

    # Render report
    print(f"# Anchor sanity check — {job_dir.name}\n")
    if issues:
        print("## ❌ ISSUES (will silently break the render)\n")
        for i in issues:
            print(f"  {i}")
        print()
    if findings:
        print("## Resolved anchors\n")
        for f in findings:
            print(f"  {f}")
        print()
    if not issues and not findings:
        print("(no findWord / findRange calls in overlays.tsx)")

    log_event(
        job_dir, tool="check_layout.py", event="anchors_checked",
        extra={
            "usage_role": usage_role,
            "overlays": str(overlays_path),
            "transcript": str(transcript_path),
            "issues": len(issues),
            "findings": len(findings),
        },
    )
    return 1 if issues else 0


# ===========================================================================
# ROLE: luma — caption-safe luminance region on B-roll.
#
# Folds two backends:
#   * darkspace.py            — luminance-bbox finder (MISSING from repo;
#                               reconstructed from the skill spec, session
#                               91e277d3): scan a B-roll frame for a dark-enough
#                               band (below --threshold, default 80), return a
#                               bbox + recommended caption `top`.
#   * sample_caption_luma.py  — caption-band luma sampler that tags each chunk
#                               with needs_pill (PILL_THRESHOLD = 150, locked v22).
#                               Triggered when --chunks is supplied.
# ===========================================================================

# sample_caption_luma.py constants (locked v22).
SAMPLE_Y_START = 220
SAMPLE_Y_END = 238
PILL_THRESHOLD = 150  # locked v22 — raised from 100

# darkspace defaults — caption band is scanned in horizontal strips; a strip
# qualifies "caption-safe" when its mean luminance is below the threshold.
DARKSPACE_DEFAULT_THRESHOLD = 80
DARKSPACE_STRIP_COUNT = 24  # number of horizontal strips to scan top→bottom


def _frame_to_gray(frame_png: Path):
    """Load a frame PNG → (gray ndarray HxW, height, width). Prefers cv2,
    falls back to PIL. Returns None if neither is available / load failed."""
    try:
        import cv2
        import numpy as np  # noqa: F401
        img = cv2.imread(str(frame_png))
        if img is None:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        return gray, h, w
    except ImportError:
        pass
    try:
        from PIL import Image
        import numpy as np
        with Image.open(frame_png) as im:
            g = im.convert("L")
            arr = np.asarray(g)
        h, w = arr.shape[:2]
        return arr, h, w
    except Exception:
        return None


def find_dark_region(frame_png: Path, threshold: int = DARKSPACE_DEFAULT_THRESHOLD,
                     *, strip_count: int = DARKSPACE_STRIP_COUNT,
                     canvas_w: int = CANVAS_W,
                     canvas_h: int = CANVAS_H) -> dict | None:
    """darkspace.py logic — scan a frame top→bottom for the tallest contiguous
    run of horizontal strips whose mean luminance is below `threshold`, and
    return a caption-safe bbox + recommended caption `top` (canvas coords).

    Returns None if the frame can't be loaded (caller falls back to manual eyeball).
    Returns {"safe": False, ...} if no qualifying region exists ("add scrim").
    """
    import numpy as np
    loaded = _frame_to_gray(frame_png)
    if loaded is None:
        return None
    gray, h, w = loaded

    strip_h = max(1, h // strip_count)
    strip_means: list[float] = []
    for i in range(strip_count):
        y0 = i * strip_h
        y1 = h if i == strip_count - 1 else (i + 1) * strip_h
        strip = gray[y0:y1, :]
        strip_means.append(float(np.mean(strip)) if strip.size else 255.0)

    # Find the longest contiguous run of strips under threshold.
    best_start = best_len = 0
    cur_start = cur_len = 0
    for i, m in enumerate(strip_means):
        if m < threshold:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
        else:
            cur_len = 0

    if best_len == 0:
        return {
            "safe": False,
            "reason": "no safe region — add scrim",
            "threshold": threshold,
            "min_strip_luma": round(min(strip_means), 1),
            "strip_means": [round(m, 1) for m in strip_means],
        }

    # Convert the winning strip-run back to source pixels, then to canvas coords.
    y0_src = best_start * strip_h
    y1_src = (best_start + best_len) * strip_h
    y1_src = min(y1_src, h)
    region_h_src = y1_src - y0_src

    sy = canvas_h / h
    bbox_canvas = (0, int(y0_src * sy), canvas_w, int(region_h_src * sy))
    # Recommend the caption top a touch inside the top of the safe region.
    recommended_top = int(y0_src * sy) + int(0.04 * canvas_h)
    region_means = strip_means[best_start:best_start + best_len]
    return {
        "safe": True,
        "threshold": threshold,
        "bbox_canvas": list(bbox_canvas),
        "recommended_top": recommended_top,
        "region_mean_luma": round(sum(region_means) / len(region_means), 1),
        "source_dimensions": [w, h],
        "strip_means": [round(m, 1) for m in strip_means],
    }


def sample_chunk_pills(video: Path, chunks_path: Path, threshold: float = PILL_THRESHOLD) -> dict:
    """sample_caption_luma.py logic — sample per-chunk luminance under the
    caption y-band of a baseline rendered mp4 and tag each chunk `needs_pill`.
    Mutates `chunks_path` in place (matches the original contract)."""
    from PIL import Image
    data = json.loads(chunks_path.read_text())
    chunks = data["chunks"]
    print(f"[luma] sampling {len(chunks)} chunks @ threshold={threshold}")

    tmp_dir = Path("/tmp/caption_luma_frames")
    tmp_dir.mkdir(exist_ok=True)

    for i, c in enumerate(chunks):
        mid_t = (c["start"] + c["end"]) / 2
        out_png = tmp_dir / f"{i:03d}.png"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(mid_t), "-i", str(video),
             "-frames:v", "1", "-vf", "scale=216:384", str(out_png)],
            capture_output=True,
        )
        with Image.open(out_png) as im:
            im_g = im.convert("L")
            band = im_g.crop((0, SAMPLE_Y_START, 216, SAMPLE_Y_END))
            px = list(band.getdata())
            mean_luma = sum(px) / max(len(px), 1)
        c["needs_pill"] = bool(mean_luma > threshold)
        c["mean_luma"] = round(mean_luma, 1)

    n_pill = sum(1 for c in chunks if c["needs_pill"])
    print(f"[luma] → {n_pill}/{len(chunks)} chunks need a pill")
    chunks_path.write_text(json.dumps({"chunks": chunks}, indent=2))
    print(f"[luma] → enriched {chunks_path}")
    return {"chunks_total": len(chunks), "needs_pill": n_pill, "threshold": threshold}


def run_luma(job_dir: Path, *, frame: Path | None, threshold: int,
             chunks: Path | None, video: Path | None,
             usage_role: str) -> int:
    """`--role luma` entrypoint.

    Two modes:
      * `--chunks <json>` [+ `--video <mp4>`] → per-chunk needs_pill tagging
        (sample_caption_luma.py path).
      * `--frame <png>` → caption-safe dark-region finder (darkspace.py path).
    """
    # Per-chunk pill sampler path (sample_caption_luma.py).
    if chunks is not None:
        vid = video or (job_dir / "final_raw.mp4")
        if not vid.exists():
            print(f"ERROR: video {vid} missing for chunk pill sampling.", file=sys.stderr)
            return 1
        meta = sample_chunk_pills(vid, chunks, threshold=float(threshold)
                                  if threshold != DARKSPACE_DEFAULT_THRESHOLD else PILL_THRESHOLD)
        log_event(job_dir, tool="check_layout.py", event="caption_pills_sampled",
                  extra={"usage_role": usage_role, "chunks": str(chunks),
                         "video": str(vid), **meta})
        return 0

    # Dark-region finder path (darkspace.py).
    if frame is None or not frame.exists():
        print("ERROR: luma role needs --frame <png> (the B-roll frame to probe), "
              "or --chunks <json> for per-chunk pill sampling.", file=sys.stderr)
        return 1

    canvas_w, canvas_h = resolve_canvas(job_dir)
    result = find_dark_region(frame, threshold=threshold,
                              canvas_w=canvas_w, canvas_h=canvas_h)
    if result is None:
        print(f"⚠ Could not load frame {frame} (cv2/PIL unavailable or bad PNG). "
              f"Fallback: Read the PNG and eyeball the dark region; set caption top manually.")
        log_event(job_dir, tool="check_layout.py", event="luma_region_probed",
                  extra={"usage_role": usage_role, "frame": str(frame),
                         "threshold": threshold, "result": "load_failed"})
        return 1

    if not result.get("safe"):
        print(f"✗ No caption-safe region below luminance {threshold} on {frame.name} — "
              f"add a scrim/gradient overlay in compose_render.")
        print(f"  min strip luma = {result.get('min_strip_luma')}")
    else:
        bbox = result["bbox_canvas"]
        print(f"✓ Caption-safe region found on {frame.name} (threshold {threshold}):")
        print(f"  bbox (canvas px) = {bbox}")
        print(f"  recommended caption top = {result['recommended_top']}px")
        print(f"  region mean luma = {result['region_mean_luma']}")

    log_event(job_dir, tool="check_layout.py", event="luma_region_probed",
              extra={"usage_role": usage_role, "frame": str(frame),
                     "threshold": threshold, **result})
    return 0 if result.get("safe") else 1


# ===========================================================================
# CLI
# ===========================================================================


def main() -> int:
    parser = argparse.ArgumentParser(
        description="check_layout — pre-render gate for layout correctness "
                    "(face/caption collision + overlay-anchor validity + "
                    "caption-safe luminance regions).")
    add_job_arg(parser)
    parser.add_argument("--role", required=True, choices=ROLES,
                        help="Which check to run. REQUIRED. Logged as usage_role. "
                             "'all' runs collision → anchors → luma in sequence.")
    parser.add_argument("--transcript", default=None,
                        help="anchors role: word-timed transcript.json "
                             "(default <job>/transcript.json).")
    parser.add_argument("--overlays", default=None,
                        help="anchors role: overlays.tsx to scan "
                             "(default <job>/overlays.tsx).")
    parser.add_argument("--frame", default=None,
                        help="collision/luma role: a representative PNG frame "
                             "(collision: face-detect against it; luma: probe for "
                             "a caption-safe dark region).")
    parser.add_argument("--threshold", type=int, default=DARKSPACE_DEFAULT_THRESHOLD,
                        help="luma role: max mean luminance (0-255) for a region "
                             "to count as caption-safe (default 80; lower = stricter).")
    parser.add_argument("--chunks", default=None,
                        help="luma role: caption_chunks.json to tag with needs_pill "
                             "(sample_caption_luma path).")
    parser.add_argument("--video", default=None,
                        help="luma role: baseline mp4 for --chunks sampling "
                             "(default <job>/final_raw.mp4).")
    parser.add_argument("--platform", default="all_platforms",
                        choices=list(REGISTRY.keys()),
                        help="collision role: which platform's red zones to enforce "
                             "(default all_platforms).")
    parser.add_argument("--strict", action="store_true",
                        help="collision role: exit non-zero if any issue is found.")
    args = parser.parse_args()

    job_dir = resolve_job_dir(args.job)
    usage_role = args.role

    frame = Path(args.frame) if args.frame else None
    transcript = Path(args.transcript) if args.transcript else None
    overlays = Path(args.overlays) if args.overlays else None
    chunks = Path(args.chunks) if args.chunks else None
    video = Path(args.video) if args.video else None

    print(f"Job:  {job_dir.name}")
    print(f"Role: {usage_role}")

    if usage_role == "collision":
        return run_collision(job_dir, platform=args.platform, frame=frame,
                             usage_role=usage_role, strict=args.strict)

    if usage_role == "anchors":
        return check_anchors(job_dir, overlays_path=overlays,
                             transcript_path=transcript, usage_role=usage_role)

    if usage_role == "luma":
        return run_luma(job_dir, frame=frame, threshold=args.threshold,
                        chunks=chunks, video=video, usage_role=usage_role)

    if usage_role == "all":
        rc = 0
        print("\n=== collision ===")
        rc |= run_collision(job_dir, platform=args.platform, frame=frame,
                            usage_role="all:collision", strict=args.strict)
        print("\n=== anchors ===")
        rc |= check_anchors(job_dir, overlays_path=overlays,
                            transcript_path=transcript, usage_role="all:anchors")
        print("\n=== luma ===")
        if frame is not None or chunks is not None:
            rc |= run_luma(job_dir, frame=frame, threshold=args.threshold,
                           chunks=chunks, video=video, usage_role="all:luma")
        else:
            print("(skipped — luma needs --frame or --chunks; "
                  "talking-head beats are assumed caption-safe)")
        return rc

    return 2


if __name__ == "__main__":
    sys.exit(main())
