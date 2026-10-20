"""Deterministic final-pixel delivery safety for vertical social video.

This is a hard QA input, not a taste score. It checks the exact final render for
face/subject clipping, unsafe centering, face/caption collisions, and platform
red-zone collisions. Unknown destination falls back to the union of supported
platforms. Detector/read failure is QA_UNAVAILABLE, never a fabricated pass.

Every geometric check runs on the render's ACTUAL canvas, whatever it is. The
platform red-zone table is authored for portrait only, so on any other aspect
the red-zone check is reported skipped (``redZoneCheck.applicable = false`` plus
``checksSkipped``) rather than stretched into a meaningless verdict.
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any

from red_zones import collides_with_red_zones, resolve_zones


SCHEMA = "videoclaw.delivery-safety/v1"
PASS = "PASS"
CONTENT_FAIL = "CONTENT_FAIL"
QA_UNAVAILABLE = "QA_UNAVAILABLE"
SAMPLE_INTERVAL_SECONDS = 0.5
FRAME_BATCH_SIZE = 900
PLATFORM_ALIASES = {
    "tiktok": "tiktok",
    "instagram": "instagram_reels",
    "instagram_reels": "instagram_reels",
    "reels": "instagram_reels",
    "youtube": "youtube_shorts",
    "youtube_shorts": "youtube_shorts",
    "shorts": "youtube_shorts",
    "all": "all_platforms",
    "all_platforms": "all_platforms",
    "everywhere": "all_platforms",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}


def delivery_intent_from_promise(promise: dict[str, Any]) -> dict[str, Any]:
    delivery = promise.get("delivery")
    if not isinstance(delivery, dict):
        delivery = {}
    requested = delivery.get("platform", promise.get("platform", "all_platforms"))
    normalized = PLATFORM_ALIASES.get(str(requested).strip().lower())
    if normalized is None:
        raise ValueError(
            f"unsupported delivery platform {requested!r}; choose "
            "tiktok, instagram_reels, youtube_shorts, or all_platforms"
        )
    exception = delivery.get("composition_exception")
    exceptions = delivery.get("composition_exceptions", [])
    face_source = delivery.get("face_source")
    if face_source is not None and (
        not isinstance(face_source, str)
        or Path(face_source).is_absolute()
        or ".." in Path(face_source).parts
    ):
        raise ValueError("delivery.face_source must be a safe job-relative path")
    warnings: list[str] = []
    if exception is not None and (
        not isinstance(exception, dict)
        or exception.get("kind") != "intentional_off_center"
        or not isinstance(exception.get("reason"), str)
        or not exception["reason"].strip()
    ):
        # Composition exceptions only relax the centering heuristic. A malformed
        # optional waiver must therefore be ignored (fail closed) rather than
        # taking the entire delivery-safety gate unavailable.
        warnings.append("ignored invalid delivery.composition_exception")
        exception = None
    if not isinstance(exceptions, list):
        warnings.append("ignored non-list delivery.composition_exceptions")
        exceptions = []
    normalized_exceptions: list[dict[str, Any]] = []
    for item in exceptions:
        if (
            not isinstance(item, dict)
            or item.get("kind") not in {"intentional_off_center", "multi_panel"}
            or not isinstance(item.get("reason"), str)
            or not item["reason"].strip()
        ):
            warnings.append("ignored composition exception without supported kind and reason")
            continue
        try:
            start_sec = float(item["start_sec"])
            end_sec = float(item["end_sec"])
        except (KeyError, TypeError, ValueError):
            warnings.append("ignored composition exception without start_sec and end_sec")
            continue
        if start_sec < 0 or end_sec <= start_sec:
            warnings.append("ignored composition exception with invalid time range")
            continue
        normalized_exceptions.append({
            "kind": item["kind"], "reason": item["reason"].strip(),
            "startSec": start_sec, "endSec": end_sec,
        })
    return {
        "platform": normalized,
        "requestedPlatform": requested,
        "compositionException": exception,
        "compositionExceptions": normalized_exceptions,
        "compositionWarnings": warnings,
        "faceSource": face_source,
    }


def delivery_intent(job: Path) -> dict[str, Any]:
    return delivery_intent_from_promise(_json(_intent(job, "promise.json")))


def _probe(video: Path) -> tuple[float, int, int]:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json", str(video),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[-300:]}")
    data = json.loads(result.stdout)
    stream = (data.get("streams") or [{}])[0]
    duration = float((data.get("format") or {}).get("duration"))
    width = int(stream.get("width"))
    height = int(stream.get("height"))
    if duration <= 0 or width <= 0 or height <= 0:
        raise RuntimeError("render has invalid duration or dimensions")
    return duration, width, height


def _timestamps(duration: float) -> list[float]:
    count = max(1, math.ceil(duration / SAMPLE_INTERVAL_SECONDS))
    width = duration / count
    return [round((index + 0.5) * width, 6) for index in range(count)]


def _intersection_area(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> int:
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    return max(0, min(ax2, bx2) - max(a[0], b[0])) * max(
        0, min(ay2, by2) - max(a[1], b[1])
    )


def _coverage(rect: tuple[int, int, int, int], other: tuple[int, int, int, int]) -> float:
    area = rect[2] * rect[3]
    return _intersection_area(rect, other) / area if area > 0 else 0.0


def _intent(job: Path, name: str) -> Path:
    """The job file, or its publication snapshot inside the review child."""
    try:
        from _serious_findings import intent_path

        return intent_path(job, name)
    except Exception:
        return job / name


def _pinned(job: Path) -> bool:
    """Inside the review child: the render's facts were fixed at publication."""
    try:
        from _serious_findings import facts_pinned

        return facts_pinned(job)
    except Exception:
        return False


def _render_facts(job: Path) -> dict[str, Any]:
    """What the latest completed render actually drew (empty when unknown)."""
    try:
        from _serious_findings import render_facts

        return render_facts(job)
    except Exception:
        return {}


def _caption_contract(job: Path, width: int, height: int) -> dict[str, Any]:
    promise = _json(_intent(job, "promise.json"))
    # Current promises keep render commitments under ``delivery``.  Accept the
    # historical flat shape as a fallback so old jobs remain reviewable.
    delivery = promise.get("delivery")
    contract = delivery if isinstance(delivery, dict) else promise
    caption_promise = contract.get("captions")
    required = bool(isinstance(caption_promise, dict) and caption_promise.get("required") is True)
    transcript = _json(_intent(job, "transcript.json"))
    words = transcript.get("words")
    words = words if isinstance(words, list) else []
    directives = _json(_intent(job, "style_directives.json"))
    style = directives.get("caption_style")
    if not isinstance(style, dict):
        style = directives.get("captionStyle")
    # The render's own caption layer wins over the directives file: a preset
    # chosen on the command line never reaches style_directives.json, and a
    # render with captions turned off drew none.
    facts = _render_facts(job)
    if isinstance(facts.get("rendered_caption_style"), dict):
        style = facts["rendered_caption_style"] or {"preset": True}
    if not isinstance(style, dict):
        style = {}
    enabled = bool(words and style) and facts.get("show_captions") is not False
    anchor = float(style.get("vertical_anchor_ratio", 0.65))
    font_ratio = float(style.get("font_size_ratio", 0.028))
    line_height = max(1, round(height * font_ratio * 1.18))
    page_words = max(1, int(style.get("page_size_words", 5)))
    estimated_lines = 2 if page_words >= 4 else 1
    pill = round(height * font_ratio * 0.5) if style.get("background") else 0
    box_height = line_height * estimated_lines + pill
    rect = (round(width * (100 / 1080)), round(height * anchor),
            round(width * (800 / 1080)), box_height)
    hide_ranges = style.get("hide_ranges_ms")
    if not isinstance(hide_ranges, list):
        hide_ranges = []
    first = min((float(word.get("start", 0)) for word in words if isinstance(word, dict)), default=0.0)
    last = max((float(word.get("end", 0)) for word in words if isinstance(word, dict)), default=0.0)
    return {
        "required": required,
        "enabled": enabled,
        "rect": rect,
        "firstSec": first,
        "lastSec": last,
        "hideRangesMs": hide_ranges,
    }


def _rendered_overlay_items(job: Path) -> list[dict[str, Any]] | None:
    """The typed overlays the latest render drew, or ``None`` when unknown."""
    facts = _render_facts(job)
    if not facts:
        # Inside the review child an unknown overlay set stays unknown: the
        # live job files may already describe a different render.
        return [] if _pinned(job) else None
    if isinstance(facts.get("rendered_overlays"), list):
        return facts["rendered_overlays"]
    # Only the Captioned composition (render / retrofit) draws typed overlays.
    if facts.get("mode") not in (None, "render", "retrofit") or facts.get("overlays_count") == 0:
        return []
    return None


def _overlay_source(job: Path) -> str:
    if _pinned(job) and not _render_facts(job):
        return "unknown"
    return "directives" if _rendered_overlay_items(job) is None else "render"


def _gathered_overlay_items(job: Path, warnings: list[str]) -> list[dict[str, Any]]:
    """Typed overlays from style directives and script markers, one at a time.

    A marker that cannot be placed on the timeline (no valid start/end) is
    skipped with a warning; it no longer takes the whole delivery check down.
    """
    from job_inputs import parse_manual_overlays
    from remotion_render import load_style_directives, overlays_from_directives  # type: ignore

    items: list[dict[str, Any]] = []
    try:
        directives = load_style_directives(job)
        if directives:
            items.extend(overlays_from_directives(directives))
    except Exception as exc:
        warnings.append(f"skipped style_directives overlays: {exc}")
    script = _json(_intent(job, "script.json"))
    chunks = script.get("chunks")
    for index, chunk in enumerate(chunks if isinstance(chunks, list) else []):
        try:
            items.extend(parse_manual_overlays({"chunks": [chunk]}))
        except Exception as exc:
            warnings.append(f"skipped overlay chunk {index}: {exc}")
    return items


def _overlay_contract(
    job: Path, width: int, height: int, warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Resolve standard overlays into the same canvas rectangles as preflight.

    Authored TSX remains visually inspected by the full-video reviewer; typed
    overlays have deterministic geometry and can therefore be blocked here.
    The overlays are the ones the latest render actually drew when its run log
    says so; otherwise they are gathered from the job's directives. An overlay
    that cannot be placed is skipped (and named in ``warnings``) instead of
    making the whole delivery check unavailable.
    """
    from preflight import overlay_bbox  # type: ignore

    warnings = [] if warnings is None else warnings
    items = _rendered_overlay_items(job)
    if items is None:
        items = _gathered_overlay_items(job, warnings)
    overlays: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        try:
            kind = str(item.get("kind", "lower"))
            start = float(item.get("start", 0))
            end = float(item.get("end", 0))
            if not (math.isfinite(start) and math.isfinite(end)):
                raise ValueError("non-finite start/end")
            # Overlays.tsx anchors these components in absolute pixels off the
            # frame edges, so the boxes are re-derived on the real canvas rather
            # than scaled from the portrait ones.
            x, y, w, h = overlay_bbox(kind, width, height)
        except Exception as exc:
            warnings.append(f"skipped overlay {index}: {exc}")
            continue
        overlays.append({
            "kind": kind,
            "text": str(item.get("text", ""))[:160],
            "startSec": start,
            "endSec": end,
            "rect": [x, y, w, h],
        })
    return overlays


def _caption_active(contract: dict[str, Any], timestamp: float) -> bool:
    if not contract["enabled"] or timestamp < contract["firstSec"] or timestamp > contract["lastSec"]:
        return False
    now = timestamp * 1000
    for item in contract["hideRangesMs"]:
        if (
            isinstance(item, list) and len(item) == 2
            and float(item[0]) <= now < float(item[1])
        ):
            return False
    return True


def _assembly_contained_ranges(job: Path) -> list[dict[str, Any]]:
    """Read canonical assembler evidence for safely contained subject envelopes.

    This relaxes only the *individual face centering* heuristic. Exact final
    pixels still fail for clipping, red-zone overlap, or caption/overlay cover.
    """
    data = _json(_intent(job, "chunk_boundaries.json"))
    chunks = data.get("chunks")
    ranges: list[dict[str, Any]] = []
    for chunk in chunks if isinstance(chunks, list) else []:
        if not isinstance(chunk, dict):
            continue
        framing = chunk.get("framing")
        if not isinstance(framing, dict):
            continue
        if framing.get("strategy") != "contain_blur":
            continue
        try:
            face_count = int(framing.get("faceCount", 0))
            start_sec = float(chunk["start_sec"])
            end_sec = float(chunk["end_sec"])
        except (KeyError, TypeError, ValueError):
            continue
        if face_count < 1 or start_sec < 0 or end_sec <= start_sec:
            continue
        ranges.append({
            "kind": "contained_shot",
            "reason": "canonical assembler preserved and safely positioned the detected subject envelope",
            "startSec": start_sec,
            "endSec": end_sec,
            "faceCount": face_count,
            "chunk": str(chunk.get("name", "")),
        })
    return ranges


def _allows_off_center(
    intent: dict[str, Any],
    timestamp: float,
    assembly_contained_ranges: list[dict[str, Any]] | None = None,
) -> bool:
    if intent["compositionException"] is not None:
        return True
    return any(
        item["startSec"] <= timestamp <= item["endSec"]
        for item in intent["compositionExceptions"]
    ) or any(
        item["startSec"] <= timestamp <= item["endSec"]
        for item in (assembly_contained_ranges or [])
    )


def _box_iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    intersection = _intersection_area(a, b)
    union = a[2] * a[3] + b[2] * b[3] - intersection
    return intersection / union if union > 0 else 0.0


def _dedupe_faces(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    kept: list[tuple[int, int, int, int]] = []
    for box in sorted(boxes, key=lambda item: item[2] * item[3], reverse=True):
        if all(_box_iou(box, existing) < 0.35 for existing in kept):
            kept.append(box)
    return kept


def _skin_fraction(frame: Any, box: tuple[int, int, int, int]) -> float:
    import cv2  # type: ignore

    x, y, width, height = box
    roi = frame[max(0, y): y + height, max(0, x): x + width]
    if roi.size == 0:
        return 0.0
    ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
    luminance, red_chroma, blue_chroma = cv2.split(ycrcb)
    skin = (
        (luminance > 40)
        & (red_chroma >= 133) & (red_chroma <= 180)
        & (blue_chroma >= 70) & (blue_chroma <= 135)
    )
    return float(skin.mean())


def _has_eye_structure(
    frame: Any, box: tuple[int, int, int, int], eye_cascade: Any,
) -> bool:
    import cv2  # type: ignore

    x, y, width, height = box
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    roi = gray[max(0, y): y + height, max(0, x): x + width]
    if roi.size == 0:
        return False
    min_eye = max(8, width // 12)
    return len(eye_cascade.detectMultiScale(
        roi, scaleFactor=1.08, minNeighbors=3, minSize=(min_eye, min_eye),
    )) > 0


def _face_samples(video: Path, timestamps: list[float]) -> tuple[list[dict[str, Any]], bool]:
    try:
        import cv2  # type: ignore

        capture = cv2.VideoCapture(str(video))
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        profile = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_profileface.xml"
        )
        eyes = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml"
        )
        if not capture.isOpened() or cascade.empty() or profile.empty() or eyes.empty():
            raise RuntimeError("OpenCV could not open the render or face detector")
        samples: list[dict[str, Any]] = []
        complete = True
        try:
            for timestamp in timestamps:
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
                ok, frame = capture.read()
                if not ok or frame is None:
                    complete = False
                    samples.append({"timestampSec": timestamp, "faces": []})
                    continue
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                min_side = max(24, round(min(gray.shape[:2]) * 0.035))
                faces = list(cascade.detectMultiScale(
                    gray, scaleFactor=1.08, minNeighbors=5, minSize=(min_side, min_side)
                ))
                faces.extend(profile.detectMultiScale(
                    gray, scaleFactor=1.08, minNeighbors=4, minSize=(min_side, min_side)
                ))
                flipped = profile.detectMultiScale(
                    cv2.flip(gray, 1), scaleFactor=1.08, minNeighbors=4,
                    minSize=(min_side, min_side),
                )
                faces.extend(
                    (gray.shape[1] - x - w, y, w, h) for x, y, w, h in flipped
                )
                boxes = _dedupe_faces([
                    (int(x), int(y), int(w), int(h)) for x, y, w, h in faces
                ])
                # Caption glyphs can trigger the legacy cascade. Require a tiny
                # amount of skin-colour evidence before treating a rectangle as
                # a human face; the semantic full-video review remains the
                # fallback for people the local detector cannot resolve.
                boxes = [
                    box for box in boxes
                    if _skin_fraction(frame, box) >= 0.02
                    and _has_eye_structure(frame, box, eyes)
                ]
                samples.append({
                    "timestampSec": timestamp,
                    "faces": [
                        {"x": int(x), "y": int(y), "width": int(w), "height": int(h)}
                        for x, y, w, h in boxes
                    ],
                })
        finally:
            capture.release()
        return samples, complete
    except Exception:
        return ([{"timestampSec": timestamp, "faces": []} for timestamp in timestamps], False)


def evaluate(video: Path, job: Path) -> dict[str, Any]:
    render_sha = _sha256(video) if video.is_file() else None
    try:
        intent = delivery_intent(job)
        duration, width, height = _probe(video)
        face_video = video
        face_source_receipt = {
            "path": video.name,
            "sha256": render_sha,
            "sameAsFinal": True,
        }
        if intent["faceSource"] is not None:
            candidate = job / intent["faceSource"]
            if candidate.is_symlink() or not candidate.is_file():
                raise RuntimeError("delivery face source is missing or is a symlink")
            resolved_job = job.resolve()
            resolved_candidate = candidate.resolve()
            if resolved_candidate != resolved_job and resolved_job not in resolved_candidate.parents:
                raise RuntimeError("delivery face source escapes the job")
            face_duration, face_width, face_height = _probe(resolved_candidate)
            if (
                face_width != width or face_height != height
                or abs(face_duration - duration) > SAMPLE_INTERVAL_SECONDS
            ):
                raise RuntimeError("delivery face source does not match final geometry")
            face_video = resolved_candidate
            face_source_receipt = {
                "path": intent["faceSource"],
                "sha256": _sha256(resolved_candidate),
                "sameAsFinal": False,
            }
        timestamps = _timestamps(duration)
        # No zones and applicable=False where the canvas has no authored zone
        # table — reported as a skipped check below, never as a pass.
        zone_check = resolve_zones(intent["platform"], width, height)
        zones = zone_check.zones
        captions = _caption_contract(job, width, height)
        overlay_warnings: list[str] = []
        overlays = _overlay_contract(job, width, height, overlay_warnings)
        overlay_source = _overlay_source(job)
        assembly_contained_ranges = _assembly_contained_ranges(job)
        # Keep the same coverage for long renders, resetting detector resources
        # between bounded batches instead of refusing everything after 450s.
        samples = []
        complete = True
        for start in range(0, len(timestamps), FRAME_BATCH_SIZE):
            batch, batch_complete = _face_samples(
                face_video, timestamps[start:start + FRAME_BATCH_SIZE],
            )
            samples.extend(batch)
            if not batch_complete:
                complete = False
                break
    except Exception as exc:
        return {
            "schema": SCHEMA,
            "status": QA_UNAVAILABLE,
            "renderSha256": render_sha,
            "error": f"{type(exc).__name__}: {exc}",
        }

    violations: list[dict[str, Any]] = []
    if not complete:
        return {
            "schema": SCHEMA,
            "status": QA_UNAVAILABLE,
            "renderSha256": render_sha,
            "platform": intent["platform"],
            "canvas": {"width": width, "height": height, "aspect": zone_check.aspect},
            "redZoneCheck": zone_check.receipt(),
            "sampleIntervalSec": SAMPLE_INTERVAL_SECONDS,
            "sampleCount": len(samples),
            "error": "face detector or final-frame decode did not complete",
        }
    if captions["required"] and not captions["enabled"]:
        violations.append({"kind": "missing_required_captions"})
    # Red-zone checks only run where the canvas has an authored zone table.
    # Elsewhere they are reported skipped (see the receipt) — never inferred.
    if zone_check.applicable and captions["enabled"]:
        caption_hits = collides_with_red_zones(captions["rect"], zones)
        if caption_hits:
            violations.append({
                "kind": "caption_red_zone_collision",
                "zones": [zone.label for zone in caption_hits],
                "rect": list(captions["rect"]),
            })
    if zone_check.applicable:
        for overlay in overlays:
            rect = tuple(overlay["rect"])
            hits = collides_with_red_zones(rect, zones)
            if hits:
                violations.append({
                    "kind": "overlay_red_zone_collision",
                    "overlayKind": overlay["kind"],
                    "startSec": overlay["startSec"],
                    "endSec": overlay["endSec"],
                    "rect": list(rect),
                    "zones": [zone.label for zone in hits],
                })

    for sample in samples:
        timestamp = float(sample["timestampSec"])
        allow_off_center = _allows_off_center(intent, timestamp, assembly_contained_ranges)
        boxes = [
            (face["x"], face["y"], face["width"], face["height"])
            for face in sample["faces"]
        ]
        # Platform chrome and edge clipping are delivery failures for a primary
        # subject. Tiny detections in a wide/group shot are not a reliable
        # primary-subject oracle and otherwise turn hands, logos, or distant
        # background people into false hard failures.
        primary_boxes = [
            box for box in boxes
            if (box[2] * box[3]) / (width * height) >= 0.01
        ]
        for box in boxes:
            clipped = (
                box[0] <= width * 0.015 or box[1] <= height * 0.015
                or box[0] + box[2] >= width * 0.985
                or box[1] + box[3] >= height * 0.985
            )
            if clipped and box in primary_boxes:
                violations.append({
                    "kind": "face_clipped", "timestampSec": timestamp, "box": list(box),
                })
            if zone_check.applicable:
                hits = collides_with_red_zones(box, zones, coverage_threshold=0.08)
                if hits and box in primary_boxes:
                    violations.append({
                        "kind": "face_red_zone_collision", "timestampSec": timestamp,
                        "box": list(box), "zones": [zone.label for zone in hits],
                    })
            if _caption_active(captions, timestamp) and _coverage(box, captions["rect"]) > 0.04:
                violations.append({
                    "kind": "caption_face_collision", "timestampSec": timestamp,
                    "faceBox": list(box), "captionRect": list(captions["rect"]),
                })
            for overlay in overlays:
                if overlay["startSec"] <= timestamp <= overlay["endSec"]:
                    rect = tuple(overlay["rect"])
                    if _coverage(box, rect) > 0.08:
                        violations.append({
                            "kind": "overlay_face_collision",
                            "timestampSec": timestamp,
                            "overlayKind": overlay["kind"],
                            "faceBox": list(box),
                            "overlayRect": list(rect),
                        })
        # A tiny face from a wide group shot is not enough evidence to declare
        # the *group* off-centre: profile/occlusion can hide the other people.
        # Apply the deterministic centring block only to face boxes large enough
        # to be the primary subject; the full-video reviewer handles group
        # composition semantically.
        significant = primary_boxes
        if significant and not allow_off_center:
            left = min(box[0] for box in significant)
            right = max(box[0] + box[2] for box in significant)
            group_center = (left + right) / (2 * width)
            if group_center < 0.35 or group_center > 0.65:
                violations.append({
                    "kind": "subject_off_center", "timestampSec": timestamp,
                    "centerX": round(group_center, 4),
                    "faceCount": len(significant),
                })

    return {
        "schema": SCHEMA,
        "status": CONTENT_FAIL if violations else PASS,
        "renderSha256": render_sha,
        "platform": intent["platform"],
        "requestedPlatform": intent["requestedPlatform"],
        "canvas": {"width": width, "height": height, "aspect": zone_check.aspect},
        "redZoneCheck": zone_check.receipt(),
        # A skipped check is never folded into ``status``: read this list before
        # treating a PASS as full delivery-safety coverage.
        "checksSkipped": ([] if zone_check.applicable else ["platform_red_zones"])
        + (["overlay_geometry"] if overlay_warnings else []),
        "compositionException": intent["compositionException"],
        "compositionExceptions": intent["compositionExceptions"],
        "compositionWarnings": intent["compositionWarnings"],
        "assemblyContainedRanges": assembly_contained_ranges,
        "sampleIntervalSec": SAMPLE_INTERVAL_SECONDS,
        "sampleCount": len(samples),
        "captionContract": captions,
        "faceSource": face_source_receipt,
        "overlayContract": overlays,
        # "render": the overlays the render drew; "directives": gathered from
        # job files because the render's log did not say.
        "overlaySource": overlay_source,
        "overlayWarnings": overlay_warnings,
        "faceSamples": samples,
        "violations": violations,
    }


def run(video: Path, job: Path, output: Path | None = None) -> dict[str, Any]:
    from _render_completion import atomic_write_text

    receipt = evaluate(video, job)
    destination = output or (job / "delivery-safety.json")
    # Replaced atomically: a reader never sees a partial receipt, even if the
    # review writing it is stopped mid-write.
    atomic_write_text(destination, json.dumps(receipt, indent=2) + "\n")
    return receipt
