"""
Renderer-neutral job-input normalization (issue #112).

The canonical Remotion compositor and the additive HyperFrames compositor read
the SAME job contract. Historically each parsed that contract with its own copy of the
logic, which drifted (the HyperFrames side silently invented an 8s duration and
only looked at a subset of inputs). This module holds the shared, pure
normalization so both engines derive identical semantic inputs from a job.

Scope is deliberately narrow — only the renderer-neutral pieces that are safe to
share without touching how either engine actually paints frames:

  * `strip_md_fence` / `coerce_directives` / `load_style_directives`
      — parse + coerce `style_directives.json` (Gemini field-name forgiveness).
  * `resolve_source_duration`
      — the canonical source-duration precedence (ffprobe → script total →
        max chunk end → fail clearly). NEVER guesses a fallback duration.
  * `parse_manual_overlays` / `auto_overlays` / `merge_overlays`
      / `overlays_from_directives`
      — manual (`script.json` post_production_notes) + directive + auto overlay
        extraction and precedence.
  * `resolve_caption_preset_style`
      — preset (by name) + explicit `caption_style` merge.
  * `resolve_audio_bed_volume_db`
      — audio-bed level: one steady level matched 12 dB under the voice
        (videoclaw#321), or `music.bed_under_voice_db` when the user asks.
  * `load_transcript_words` / `read_caption_luminance` / `video_transform_of`.
  * `explicit_video_canvas` / `default_video_canvas`
      — the final canvas: authored width/height, else the source's orientation.

These functions do no rendering and import nothing engine-specific, so the
Remotion shipping path keeps its exact behavior — `compose_render` now imports
them instead of holding private copies (proven by the parity tests in
`tests/test_job_inputs.py`).
"""

from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path

URL_RE = re.compile(
    r"https?://[^\s\"'<>]+|\b[\w-]+\.(?:com|io|app|co|me|ai|dev|so|xyz)[\w/?&=-]*")


class SourceDurationError(ValueError):
    """Raised when a job's source duration cannot be established from either the
    source video (ffprobe) or `script.json`. Subclasses ValueError so existing
    callers that catch ValueError keep working."""


def explicit_video_canvas(directives: dict | None) -> tuple[int, int] | None:
    """An authored final canvas, or None when normal resolution defaults apply."""
    if directives is None:
        return None
    if not isinstance(directives, dict):
        raise ValueError("style_directives must be a JSON object")
    if not ({"width", "height"} & directives.keys()):
        return None
    values = []
    for field in ("width", "height"):
        value = directives.get(field)
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or (isinstance(value, float) and not math.isfinite(value))
                or value <= 0 or value % 2):
            raise ValueError(
                "style_directives width and height must both be positive even "
                "whole numbers of pixels for H.264 output")
        values.append(int(value))
    width, height = values
    # Local allocation ceiling, not a provider/Remotion capability claim.
    if max(width, height) > 8192 or width * height > 33_177_600:
        raise ValueError(
            "style_directives canvas exceeds the local render limit: "
            "8192 pixels per edge and 33177600 total pixels; choose a smaller canvas")
    return width, height


# ── default canvas (no authored width/height) ────────────────────────────────

PORTRAIT_CANVAS = (1080, 1920)
LANDSCAPE_CANVAS = (1920, 1080)
SQUARE_CANVAS = (1080, 1080)


def probe_display_size(path: Path) -> tuple[int, int] | None:
    """Display width/height of the first video stream, with pixel aspect and
    quarter-turn rotation applied, or None when ffprobe cannot read one."""
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_streams", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if res.returncode != 0:
        return None
    try:
        stream = json.loads(res.stdout)["streams"][0]
        width, height = int(stream["width"]), int(stream["height"])
    except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError):
        return None
    sar = str(stream.get("sample_aspect_ratio") or "")
    match = re.fullmatch(r"(\d+):(\d+)", sar)
    if match and int(match.group(1)) > 0 and int(match.group(2)) > 0:
        width = round(width * int(match.group(1)) / int(match.group(2)))
    side_data = stream.get("side_data_list")
    tags = stream.get("tags")
    rotation = next(
        (row.get("rotation") for row in (side_data if isinstance(side_data, list) else [])
         if isinstance(row, dict) and row.get("rotation") is not None),
        tags.get("rotate") if isinstance(tags, dict) else None,
    )
    try:
        quarter_turns = round(float(rotation) / 90.0) if rotation is not None else 0
    except (TypeError, ValueError, OverflowError):
        return None
    if quarter_turns % 2:
        width, height = height, width
    if width <= 0 or height <= 0:
        return None
    return width, height


# Where a job's source video waits before the first render or retrofit stages
# it as final_raw.mp4: an app attachment (incoming/) or a pulled clip (footage/).
STAGED_SOURCE_DIRS = ("incoming", "footage")
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".m4v", ".webm", ".mkv"})


def single_staged_source(job_dir: Path) -> Path | None:
    """The job's one staged source video, or None when there is none or more
    than one (then no single clip says what the render will be built from)."""
    found: list[Path] = []
    for name in STAGED_SOURCE_DIRS:
        folder = job_dir / name
        try:
            entries = sorted(folder.iterdir()) if folder.is_dir() else []
        except OSError:
            return None
        for entry in entries:
            if entry.suffix.lower() in VIDEO_SUFFIXES and not entry.name.startswith(".") \
                    and entry.is_file():
                found.append(entry)
                if len(found) > 1:
                    return None
    return found[0] if found else None


def default_video_canvas(job_dir: Path, directives: dict | None, *,
                         video_basename: str = "final_raw.mp4") -> tuple[int, int]:
    """The final canvas when style_directives sets no width/height.

    Authored width/height always win; callers try `explicit_video_canvas` first.
    Otherwise the canvas follows the source video's display orientation:
    portrait → 1080x1920, landscape → 1920x1080, square → 1080x1080. The source
    is `video_basename` (final_raw.mp4); before a render or retrofit has staged
    it, a standalone layout check reads the job's single staged source
    (`single_staged_source`), the clip that render will stage. A job with a
    `video_transform` (browser-card frame, focus punches, Ken Burns, cover crop,
    blurred fill) authored that framing against the vertical frame, so it keeps
    1080x1920, as does a job whose source is missing, ambiguous or unreadable.
    """
    if video_transform_of(directives):
        return PORTRAIT_CANVAS
    source = job_dir / video_basename
    size = probe_display_size(source)
    if size is None and not source.exists():
        staged = single_staged_source(job_dir)
        size = probe_display_size(staged) if staged is not None else None
    if size is None:
        return PORTRAIT_CANVAS
    width, height = size
    if width > height:
        return LANDSCAPE_CANVAS
    if width == height:
        return SQUARE_CANVAS
    return PORTRAIT_CANVAS


# ── source duration ──────────────────────────────────────────────────────────

def ffprobe_duration(path: Path) -> float:
    """Container duration in seconds via ffprobe, or 0.0 if it cannot be read.

    A non-zero exit, missing file, or unparseable output all yield 0.0 — the
    caller decides what a missing duration means (see `resolve_source_duration`,
    which treats 0.0 as "probe failed" and falls through to script metadata
    rather than inventing a duration).
    """
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True)
        value = float(res.stdout.strip())
        return value if math.isfinite(value) and value > 0 else 0.0
    except (subprocess.CalledProcessError, ValueError, OSError):
        return 0.0


def _as_positive_float(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


def resolve_source_duration(job_dir: Path, script: dict | None = None, *,
                            video_basename: str = "final_raw.mp4") -> float:
    """Canonical source-duration precedence, shared by both compositors.

    1. Valid ffprobe duration from the source video (`final_raw.mp4`).
    2. `script.json` `total_duration_seconds`.
    3. Maximum `end_sec` across `script.json` chunks.
    4. Otherwise raise `SourceDurationError` — NEVER guess a fallback.

    A failed probe must never silently produce a fixed-length composition; the
    error names the source path, that probing failed, and that no valid script
    duration was available.
    """
    script = script or {}
    source = job_dir / video_basename

    if source.exists():
        probed = ffprobe_duration(source)
        if math.isfinite(probed) and probed > 0:
            return probed

    total = _as_positive_float(script.get("total_duration_seconds"))
    if total is not None:
        return total

    ends = [
        e for e in (_as_positive_float(c.get("end_sec"))
                    for c in (script.get("chunks") or []))
        if e is not None
    ]
    if ends:
        return max(ends)

    probe_state = (
        "ffprobe found no valid duration" if source.exists()
        else "the source video is missing"
    )
    raise SourceDurationError(
        f"Could not determine source duration for job {job_dir.name!r}: "
        f"source video {source} — {probe_state}; and no valid duration was "
        f"available from script.json (neither a positive "
        f"total_duration_seconds nor a positive chunks[].end_sec). "
        f"Refusing to guess a duration.")


# ── overlays (manual / auto / directive) ─────────────────────────────────────

def find_url(s: str) -> str | None:
    m = URL_RE.search(s or "")
    return m.group(0) if m else None


def parse_manual_overlays(script: dict) -> list[dict]:
    """Pull timed HOOK / URL / LOWER markers; narration alone needs no timing."""
    overlays = []
    for index, chunk in enumerate(script.get("chunks", [])):
        notes = chunk.get("post_production_notes") or ""
        if not re.search(r"(?:HOOK|URL|LOWER):", notes):
            continue
        try:
            s = float(chunk["start_sec"])
            e = float(chunk["end_sec"])
            if (isinstance(chunk["start_sec"], bool) or isinstance(chunk["end_sec"], bool)
                    or not math.isfinite(s) or not math.isfinite(e) or not 0 <= s < e):
                raise ValueError("invalid range")
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError(
                f"Overlay chunk {index} requires finite start_sec/end_sec with 0 <= start_sec < end_sec"
            ) from exc
        for m in re.finditer(r'HOOK:\s*"([^"]+)"', notes):
            overlays.append({"kind": "hook", "text": m.group(1).upper(),
                             "start": s + 0.6, "end": min(e, s + 4.0)})
        for m in re.finditer(r"URL:\s*([^\s\"]+)", notes):
            overlays.append({"kind": "url", "text": m.group(1),
                             "start": max(s, e - 5.0), "end": e})
        for m in re.finditer(r'LOWER:\s*"([^"]+)"', notes):
            overlays.append({"kind": "lower", "text": m.group(1),
                             "start": s + 0.5, "end": min(e, s + 3.5)})
    return overlays


def auto_overlays(script: dict, company: dict | None) -> list[dict]:
    """Sensible defaults so a marker-less script still gets nice overlays."""
    overlays = []
    chunks = script.get("chunks", [])
    if not chunks:
        return overlays
    first = chunks[0]
    first_dialogue = (first.get("dialogue") or "").strip()
    if first_dialogue:
        m = re.match(r"([^.!?]{8,80}[.!?])", first_dialogue)
        hook_text = (m.group(1) if m else first_dialogue[:60]).strip().upper()
        s = float(first["start_sec"])
        e = float(first["end_sec"])
        overlays.append({"kind": "hook", "text": hook_text,
                         "start": s + 0.4, "end": min(e, s + 4.0)})
    last = chunks[-1]
    url = (
        find_url(last.get("post_production_notes") or "")
        or find_url(last.get("dialogue") or "")
        or find_url((company or {}).get("website") or "")
        or find_url((company or {}).get("url") or "")
    )
    if url:
        url_display = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
        s = max(float(last["start_sec"]), float(last["end_sec"]) - 5.0)
        overlays.append({"kind": "url", "text": url_display,
                         "start": s, "end": float(last["end_sec"])})
    for c in chunks:
        d = (c.get("dialogue") or "")
        if re.search(r"\bBob Moesta\b", d, flags=re.IGNORECASE):
            s = float(c["start_sec"]) + 0.5
            overlays.append({"kind": "lower",
                             "text": "Bob Moesta — pioneer of Jobs-to-be-Done",
                             "start": s, "end": min(float(c["end_sec"]), s + 3.0)})
            break
    return overlays


def merge_overlays(manual: list[dict], auto: list[dict]) -> list[dict]:
    """Manual overlays win over auto ones of the same kind."""
    if not manual:
        return auto
    out = list(manual)
    manual_kinds = {o["kind"] for o in manual}
    for o in auto:
        if o["kind"] in manual_kinds and o["kind"] in {"hook", "url"}:
            continue
        out.append(o)
    return out


# ── style_directives.json loading + Gemini field-name forgiveness ────────────

def strip_md_fence(raw: str) -> str:
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


# The caption `transform` values the pipeline supports, verbatim as CSS
# `text-transform`. Single source of truth: coerce_directives (below),
# check_layout.py and remotion_render.py all coerce against THIS set, and the
# HyperFrames caption generator validates against it — so every consumer of a
# `transform` directive interprets it identically (an unsupported value → "none").
VALID_CAPTION_TRANSFORMS = ("uppercase", "none", "lowercase", "capitalize")


def coerce_directives(d: dict) -> dict:
    """Forgive variant field names Gemini sometimes invents.

    Maps divergent keys back to the replication_brief schema. Defensive — we
    don't want a single field name to break a render.
    """
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
    # Guard against non-numeric members (a malformed cut_points must not crash
    # coerce with a TypeError — it is coerced only when all values are numeric).
    if (isinstance(cuts, list) and cuts
            and all(isinstance(c, (int, float)) for c in cuts) and max(cuts) > 60):
        d = {**d, "cut_points": [round(c / 1000.0, 3) for c in cuts]}

    overlays = d.get("overlays")
    if isinstance(overlays, dict):
        flat = {}
        if isinstance(overlays.get("hook"), dict) and overlays["hook"].get("text"):
            h = overlays["hook"]
            flat["hook"] = {
                "text": h["text"],
                "start_sec": (h.get("start_ms", 0) or 0) / 1000.0,
                "end_sec": ((h.get("start_ms", 0) or 0) + (h.get("duration_ms", 0) or 0)) / 1000.0,
            }
        if overlays.get("url") or overlays.get("url_pill"):
            u = overlays.get("url") or overlays.get("url_pill")
            if isinstance(u, dict) and u.get("text"):
                flat["url_pill"] = {
                    "text": u["text"],
                    "start_sec": float(u.get("start_sec", 0)),
                    "end_sec": float(u.get("end_sec", 0)),
                }
        d = {**d, **{k: v for k, v in flat.items() if k not in d}}

    if "audio_instructions" in d and "music" not in d:
        ai = d["audio_instructions"] if isinstance(d.get("audio_instructions"), dict) else {}
        # No level here: a brief without one gets the bed matched under the
        # voice (videoclaw#321), not a pinned -22 dB.
        d = {**d, "music": {
            "use_reference_bed": (ai.get("bgm_style") or "").lower() not in ("none", "", "no music"),
            "notes": ai.get("bgm_style", ""),
        }}
    return d


def load_style_directives(job_dir: Path, override_path: Path | None = None, *,
                          warn_prefix: str = "job_inputs") -> dict | None:
    """Load style_directives.json (default <job_dir>/style_directives.json, or
    an explicit override path). Returns the coerced object or None.
    """
    path = override_path if override_path else (job_dir / "style_directives.json")
    if not path.exists():
        return None
    raw = strip_md_fence(path.read_text())
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[{warn_prefix}] WARN: style_directives present but invalid JSON: {e}")
        return None
    return coerce_directives(parsed)


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


# ── caption preset / style, audio bed, transcript, luminance ─────────────────

def resolve_caption_preset_style(preset_name: str | None,
                                 explicit_style: dict | None,
                                 presets: dict) -> dict | None:
    """Merge a named caption preset with any explicit caption_style overrides.

    Preset provides the base; explicit `caption_style` fields layer on top. This
    is the exact precedence `compose_render.build_props` uses. Raises SystemExit
    on an unknown preset name (a deliberate hard error, as in the shipping path).
    Returns None when neither a preset nor explicit style is given.
    """
    preset_style: dict | None = None
    if preset_name:
        if preset_name not in presets:
            raise SystemExit(
                f"ERROR: unknown caption_preset '{preset_name}'. "
                f"Choose one of: {', '.join(presets) or '(none loaded)'}.")
        preset_style = presets[preset_name]
    if preset_style or explicit_style:
        return {**(preset_style or {}), **(explicit_style or {})}
    return None


def bed_under_voice_db(directives: dict | None) -> float | None:
    """The user's own `music.bed_under_voice_db` (dB below the voice), if set."""
    music = (directives or {}).get("music")
    value = music.get("bed_under_voice_db") if isinstance(music, dict) else None
    if isinstance(value, (int, float)) and not isinstance(value, bool) \
            and math.isfinite(value) and value >= 0:
        return float(value)
    return None


def resolve_audio_bed_volume_db(job_dir: Path, directives: dict | None,
                                *, default_db: float = -22.0,
                                voice_media: Path | None = None) -> float:
    """The constant gain (dB) for `audio/bed.wav`, shared by the compositors.

    The bed is laid flat — one level for the whole video, never ducked. It sits
    FLAT_BED_UNDER_VOICE_DB under `voice_media`'s audio, or the user's own
    `music.bed_under_voice_db` (videoclaw#321), never above unity: a player
    volume stops at 1.0. `default_db` is for a bed with no voice to measure.

    A `duck_under_speech_db` in style_directives (the old replication brief's
    suggested level) or in audio/bed_meta.json is ignored: only a level the
    user asked for moves the bed.
    """
    bed = job_dir / "audio" / "bed.wav"
    if voice_media is not None and bed.is_file():
        import _bed_level  # tools/ is on sys.path wherever job_inputs is imported
        under = bed_under_voice_db(directives)
        try:
            level = _bed_level.flat_bed_gain(
                Path(voice_media), bed, max_gain_db=0.0,
                under_voice_db=_bed_level.FLAT_BED_UNDER_VOICE_DB if under is None else under)
        except RuntimeError as exc:
            print(f"[job_inputs] WARNING: {exc}; the bed keeps {default_db:g} dB")
            level = None
        if level is not None:
            return float(level["gain_db"])
    return default_db


def load_transcript_words(job_dir: Path) -> list[dict]:
    """Word-level transcript entries from <job>/transcript.json ("words"), or []."""
    path = job_dir / "transcript.json"
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text()).get("words", []) or []
    except (json.JSONDecodeError, OSError):
        return []


def read_caption_luminance(job_dir: Path) -> float | None:
    """Preflight-sampled background luminance from caption_luminance.json, or None."""
    path = job_dir / "caption_luminance.json"
    if not path.exists():
        return None
    try:
        avg = json.loads(path.read_text()).get("luminance_avg")
    except (json.JSONDecodeError, OSError):
        return None
    return float(avg) if isinstance(avg, (int, float)) else None


def video_transform_of(directives: dict | None) -> dict | None:
    """The `video_transform` directive block (Ken Burns / punch / focus / frame),
    or None. Renderer-neutral pass-through — engines decide what they support."""
    if directives and isinstance(directives.get("video_transform"), dict):
        return directives["video_transform"]
    return None
