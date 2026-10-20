"""Pure, local-only subject-safe framing helpers.

This module may be imported by tools that are certified free. It performs only
local media inspection and returns ffmpeg filter plans; it has no gateway,
provider, download, billing, or mutation surface.
"""
from __future__ import annotations

import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path


def _probe(path: Path) -> dict:
    """Return duration, dimensions, and frame rate from local ffprobe output."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(result.stdout)
    video = next((stream for stream in info["streams"] if stream["codec_type"] == "video"), None)
    duration = float(info["format"].get("duration", 0.0) or 0.0)
    rate = video.get("r_frame_rate", "30/1") if video else "30/1"
    try:
        fps = float(Fraction(rate))
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    return {
        "duration_s": duration,
        "width": int(video["width"]) if video else 0,
        "height": int(video["height"]) if video else 0,
        "fps": fps,
    }


def _framing_plan_from_faces(
    src_w: int,
    src_h: int,
    target_aspect: str,
    faces: list[tuple[float, float, float, float]],
    *,
    allow_contain: bool = False,
) -> dict:
    """Choose a stable crop for camera footage.

    Containment is deliberately opt-in.  A detector miss or an unusually wide
    face envelope must not turn ordinary camera footage into a floating card;
    screen recordings and explicitly full-frame material call this helper with
    ``allow_contain=True`` instead.
    """
    if not faces:
        return {
            "strategy": "contain_blur" if allow_contain else "center_crop",
            "reason": (
                "caller requested complete-source containment"
                if allow_contain else "no stable subject was detected; keep natural footage full-bleed"
            ),
            "center": [0.5, 0.5],
            "faceCount": 0,
            "foregroundBox": [0.0, 0.0, 1.0, 1.0],
        }
    aw, ah = (int(value) for value in target_aspect.split(":"))
    target_ratio = aw / ah
    src_ratio = src_w / src_h
    left = min(face[0] for face in faces)
    top = min(face[1] for face in faces)
    right = max(face[0] + face[2] for face in faces)
    bottom = max(face[1] + face[3] for face in faces)
    # Leave at least 6% of the source around the detected group. This prevents
    # a technically-inside face from touching the crop edge after motion.
    pad_x = max(0.06, max(face[2] for face in faces) * 0.30)
    pad_y = max(0.04, max(face[3] for face in faces) * 0.18)
    safe_left = max(0.0, left - pad_x)
    safe_right = min(1.0, right + pad_x)
    safe_top = max(0.0, top - pad_y)
    safe_bottom = min(1.0, bottom + pad_y)
    desired_cx = (safe_left + safe_right) / 2
    desired_cy = (safe_top + safe_bottom) / 2
    group_cx, group_cy = desired_cx, desired_cy

    # The crop must fit the group inside the *platform-safe* canvas, not merely
    # inside the encoded frame. The right-side actions and top/bottom chrome are
    # deliberately asymmetric, so aim at the centre of the usable region.
    delivery_safe = (0.08, 0.12, 0.84, 0.82)
    target_cx = (delivery_safe[0] + delivery_safe[2]) / 2
    target_cy = (delivery_safe[1] + delivery_safe[3]) / 2
    if src_ratio > target_ratio:
        crop_fraction = target_ratio / src_ratio
        crop_left = max(0.0, min(1.0 - crop_fraction, group_cx - target_cx * crop_fraction))
        crop_cx = crop_left + crop_fraction / 2
        crop_cy = group_cy
        mapped = (
            (safe_left - crop_left) / crop_fraction,
            safe_top,
            (safe_right - crop_left) / crop_fraction,
            safe_bottom,
        )
    else:
        crop_fraction = src_ratio / target_ratio
        crop_top = max(0.0, min(1.0 - crop_fraction, group_cy - target_cy * crop_fraction))
        crop_cy = crop_top + crop_fraction / 2
        crop_cx = group_cx
        mapped = (
            safe_left,
            (safe_top - crop_top) / crop_fraction,
            safe_right,
            (safe_bottom - crop_top) / crop_fraction,
        )
    fits = (
        mapped[0] >= delivery_safe[0]
        and mapped[1] >= delivery_safe[1]
        and mapped[2] <= delivery_safe[2]
        and mapped[3] <= delivery_safe[3]
    )

    # If a crop cannot satisfy that contract, show the complete source over a
    # restrained blur and size/position the foreground so the detected group is
    # centred inside the usable canvas. This also handles already-vertical shots
    # whose source pixels put a face under platform chrome.
    full_w = 1.0 if src_ratio > target_ratio else src_ratio / target_ratio
    full_h = target_ratio / src_ratio if src_ratio > target_ratio else 1.0
    constraints = [1.0]
    for numerator, denominator in (
        (target_cx - delivery_safe[0], (group_cx - safe_left) * full_w),
        (delivery_safe[2] - target_cx, (safe_right - group_cx) * full_w),
        (target_cy - delivery_safe[1], (group_cy - safe_top) * full_h),
        (delivery_safe[3] - target_cy, (safe_bottom - group_cy) * full_h),
        (target_cx, group_cx * full_w),
        (1.0 - target_cx, (1.0 - group_cx) * full_w),
        (target_cy, group_cy * full_h),
        (1.0 - target_cy, (1.0 - group_cy) * full_h),
    ):
        if denominator > 0:
            constraints.append(numerator / denominator)
    foreground_scale = max(0.1, min(constraints))
    foreground_w = full_w * foreground_scale
    foreground_h = full_h * foreground_scale
    foreground_x = target_cx - group_cx * foreground_w
    foreground_y = target_cy - group_cy * foreground_h

    strategy = "subject_crop" if fits or not allow_contain else "contain_blur"
    return {
        "strategy": strategy,
        "reason": (
            "all detected people fit with edge padding"
            if fits else (
                "a crop would remove part of the detected group"
                if allow_contain else
                "natural footage stays full-bleed; use an explicit layout if the complete group is required"
            )
        ),
        "center": [
            round(crop_cx if fits else group_cx, 6),
            round(crop_cy if fits else group_cy, 6),
        ],
        "faceCount": len(faces),
        "faceEnvelope": [
            round(safe_left, 6), round(safe_top, 6),
            round(safe_right, 6), round(safe_bottom, 6),
        ],
        "deliverySafeRect": list(delivery_safe),
        "foregroundBox": [
            round(foreground_x, 6), round(foreground_y, 6),
            round(foreground_w, 6), round(foreground_h, 6),
        ],
        "requiresLayout": bool(not fits and not allow_contain),
    }


def _subject_framing_plan(
    clip: Path,
    target_aspect: str,
    sample_n: int = 16,
    *,
    start_sec: float | None = None,
    end_sec: float | None = None,
) -> dict:
    """Inspect the complete selected shot and protect the full detected group.

    ``clip`` may be a long source. ``start_sec``/``end_sec`` constrain sampling
    to the selected edit window so an assembler does not learn framing from a
    different scene elsewhere in the source.
    """
    try:
        import cv2  # type: ignore
    except ImportError:
        print("[safe_framing] cv2 not available — stable center-crop fallback", file=sys.stderr)
        return {
            "strategy": "center_crop", "reason": "face detector unavailable; keep natural footage full-bleed",
            "center": [0.5, 0.5], "faceCount": 0,
        }

    info = _probe(clip)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    profile = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_profileface.xml"
    )
    eyes = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml"
    )
    boxes: list[tuple[float, float, float, float]] = []
    max_faces_per_sample = 0
    cap = cv2.VideoCapture(str(clip))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if (
        not cap.isOpened() or cascade.empty() or profile.empty() or eyes.empty()
        or total <= 0
    ):
        cap.release()
        return {
            "strategy": "center_crop", "reason": "face detector could not read the shot; keep natural footage full-bleed",
            "center": [0.5, 0.5], "faceCount": 0,
        }
    fps = float(cap.get(cv2.CAP_PROP_FPS) or info.get("fps") or 30.0)
    first_frame = max(0, round(float(start_sec or 0.0) * fps))
    last_frame = min(
        total,
        round(float(end_sec) * fps) if end_sec is not None else total,
    )
    if last_frame <= first_frame:
        cap.release()
        return {
            "strategy": "center_crop", "reason": "selected shot range is empty; keep natural footage full-bleed",
            "center": [0.5, 0.5], "faceCount": 0,
        }
    selected_frames = last_frame - first_frame
    frame_numbers = sorted({
        min(last_frame - 1, first_frame + round((index + 0.5) * selected_frames / sample_n))
        for index in range(sample_n)
    })
    for f in frame_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        min_side = max(24, round(min(gray.shape[:2]) * 0.035))
        faces = list(cascade.detectMultiScale(
            gray, 1.12, 5, minSize=(min_side, min_side)
        ))
        faces.extend(profile.detectMultiScale(
            gray, 1.12, 4, minSize=(min_side, min_side)
        ))
        flipped = profile.detectMultiScale(
            cv2.flip(gray, 1), 1.12, 4, minSize=(min_side, min_side)
        )
        faces.extend((gray.shape[1] - x - w, y, w, h) for x, y, w, h in flipped)
        if len(faces) == 0:
            continue
        # Frontal/profile/mirrored cascades can all report the same person.
        # Collapse heavily overlapping boxes before calling this a group.
        unique: list[tuple[int, int, int, int]] = []
        for candidate in sorted(faces, key=lambda box: int(box[2]) * int(box[3]), reverse=True):
            x, y, w, h = (int(value) for value in candidate)
            area = max(1, w * h)
            duplicate = False
            for ox, oy, ow, oh in unique:
                intersection = (
                    max(0, min(x + w, ox + ow) - max(x, ox))
                    * max(0, min(y + h, oy + oh) - max(y, oy))
                )
                union = area + ow * oh - intersection
                if union > 0 and intersection / union >= 0.35:
                    duplicate = True
                    break
            if not duplicate:
                unique.append((x, y, w, h))
        verified: list[tuple[int, int, int, int]] = []
        for x, y, w, h in unique:
            roi = frame[max(0, y): y + h, max(0, x): x + w]
            if roi.size == 0:
                continue
            ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
            luminance, red_chroma, blue_chroma = cv2.split(ycrcb)
            skin = (
                (luminance > 40)
                & (red_chroma >= 133) & (red_chroma <= 180)
                & (blue_chroma >= 70) & (blue_chroma <= 135)
            )
            eye_min = max(8, w // 12)
            face_gray = gray[max(0, y): y + h, max(0, x): x + w]
            has_eyes = len(eyes.detectMultiScale(
                face_gray,
                scaleFactor=1.08,
                minNeighbors=3,
                minSize=(eye_min, eye_min),
            )) > 0
            if float(skin.mean()) >= 0.02 and has_eyes:
                verified.append((x, y, w, h))
        # Haar cascades can emit dozens of skin/eye-shaped false positives in
        # gyms, shelves, and textured rooms.  A single talking head previously
        # became a fictional 60-person "group" and triggered a floating card.
        # Track the dominant face for natural-footage centering; true multi-
        # subject preservation needs an explicit authored layout, not a noisy
        # union of every detector hit.
        verified.sort(key=lambda box: int(box[2]) * int(box[3]), reverse=True)
        dominant = verified[:1]
        max_faces_per_sample = max(max_faces_per_sample, len(dominant))
        for x, y, w, h in dominant:
            boxes.append((
                x / info["width"], y / info["height"],
                w / info["width"], h / info["height"],
            ))
    cap.release()
    plan = _framing_plan_from_faces(
        info["width"], info["height"], target_aspect, boxes,
    )
    plan["sampledFaceDetections"] = len(boxes)
    plan["faceCount"] = max_faces_per_sample
    return plan


def _crop_filter(src_w: int, src_h: int, target_aspect: str, cx: float, cy: float):
    """ffmpeg crop filter reframing source → target_aspect, subject-centered.
    Returns (filter_string, out_w, out_h). (pull_footage._crop_filter)."""
    aw, ah = (int(x) for x in target_aspect.split(":"))
    target_ratio = aw / ah
    src_ratio = src_w / src_h
    if src_ratio > target_ratio:
        out_h = src_h
        out_w = int(round(out_h * target_ratio))
        max_x = src_w - out_w
        x = int(round(cx * src_w - out_w / 2))
        x = max(0, min(max_x, x))
        return f"crop={out_w}:{out_h}:{x}:0", out_w, out_h
    else:
        out_w = src_w
        out_h = int(round(out_w / target_ratio))
        max_y = src_h - out_h
        y = int(round(cy * src_h - out_h / 2))
        y = max(0, min(max_y, y))
        return f"crop={out_w}:{out_h}:0:{y}", out_w, out_h


def _scale_to(target_w: int, target_h: int) -> str:
    return f"scale={target_w}:{target_h}:flags=lanczos"


def _contained_output_size(src_w: int, src_h: int, aspect: str) -> tuple[int, int]:
    aw, ah = (int(value) for value in aspect.split(":"))
    target_ratio = aw / ah
    if src_w / src_h > target_ratio:
        return max(2, round(src_h * target_ratio / 2) * 2), src_h
    return src_w, max(2, round((src_w / target_ratio) / 2) * 2)


def _blur_contain_filter(
    target_w: int,
    target_h: int,
    foreground_box: list[float] | None = None,
    *,
    input_label: str = "0:v",
    output_label: str = "delivery_video",
) -> str:
    box = foreground_box or [0.0, 0.0, 1.0, 1.0]
    x = max(0, round(target_w * box[0]))
    y = max(0, round(target_h * box[1]))
    width = max(2, min(target_w - x, round(target_w * box[2]) // 2 * 2))
    height = max(2, min(target_h - y, round(target_h * box[3]) // 2 * 2))
    return (
        f"[{input_label}]split=2[delivery_bg][delivery_fg];"
        f"[delivery_bg]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},boxblur=60:5,"
        "eq=brightness=-0.18:saturation=0.30[delivery_blur];"
        f"[delivery_fg]scale={width}:{height}:force_original_aspect_ratio=decrease"
        "[delivery_front];"
        f"[delivery_blur][delivery_front]overlay={x}+({width}-w)/2:"
        f"{y}+({height}-h)/2[{output_label}]"
    )

