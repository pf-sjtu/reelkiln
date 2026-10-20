"""
HyperFrames compositor — assemble a HyperFrames composition from the SAME job
inputs the Remotion `compose_render` reads, via the SAME shared normalization
(issue #112).

This is the HyperFrames sibling of the Remotion compositor. It reads a job's
real inputs and writes a self-contained composition to
`jobs/<id>/hyperframes/index.html` (+ local assets), which
`tools/hyperframes_render.py` then renders to `final_hyperframes.mp4`. Remotion,
`compose_render`, `final.mp4` and every existing artifact are untouched.

SCOPE (Phase 1): this covers the short-form **Captioned `render`-equivalent**
input surface only — source video + audio bed + captions + typed overlays +
dataviz. It does NOT cover compose_render's retrofit / cover_bake / episode
modes, per-job `overlays.tsx` JSX, B-roll inserts, or video transforms
(Ken Burns / punch / focus / browser-frame).

Production inputs fail LOUDLY (never silently coerced to empty):
  <job>/final_raw.mp4          source video (REQUIRED; base layer, own audio)
  <job>/transcript.json        word-level timing → captions (REQUIRED in
                               standard mode; rejects a placeholder transcript)
  <job>/script.json            duration fallback + manual/auto overlay markers
                               (REQUIRED in standard mode)
  <job>/company.json           company URL fallback for auto overlays (optional,
                               validated when present)
  <job>/style_directives.json  caption_preset/style, overlays, dataviz[], music
                               (optional, validated when present)
  <job>/audio/bed.wav          music bed (mixed under source audio; optional)
  <job>/audio/bed_meta.json    validated only; the bed level comes from the voice (#321)
  <job>/caption_luminance.json preflight background luminance (optional, validated)
A malformed OPTIONAL file is an actionable error, not a silent disappearance.

Content modes (`--content-mode`, explicit intent — never inferred from a broken
or missing file):
  standard     short-form production-like render. Requires script + a real
               (non-placeholder) transcript; captions are ON and require a
               deliberate preset/style (parity with compose_render's forced
               caption choice). A standard job that would end up with NO caption
               is rejected — use no-captions on purpose instead.
  no-captions  explicitly caption-free (overlay-only / dataviz-only / silent
               video). Transcript optional; no phantom caption preflight; the
               summary records that captions were intentionally disabled.
  (post-only is classed UNEVALUATED for Phase 1.)

Layers + z-order (data-track-index → CSS z-index; higher paints on top). This
matches Captioned.tsx, where the caption layer carries an explicit zIndex:30
that lifts it ABOVE the auto-z overlay/dataviz/job-b-roll layers:
  0   source video (with its own audio)
  5   audio bed (data-volume from dB)
  15  typed overlays (hook / url / lower / image / label)  — below captions
  20  dataviz                                              — below captions
  30  captions                                             — ABOVE the above
  40  foreground chrome (opt-in, above captions; not emitted by default)
The compositor OWNS these tracks: caller-provided `track_index` in job data is
ignored, so no JSON input can lift dataviz/overlays above captions.

Runs the shared red-zone preflight (hyperframes_layout, which imports red_zones
+ preflight) PLUS an element-to-element collision check (geometry AND time), and
enforces `--layout-policy` (error = block on collision; warn = generate +
record). The red-zone pass measures the composition's REAL canvas and resolves
zones by aspect, so an aspect with no authored table is reported SKIPPED rather
than checked against portrait chrome (#241); the element-to-element pass is
canvas-relative and runs on every aspect. Fonts the frozen runtime cannot serve
fail generation unless `--allow-font-fallback` is passed. Never writes final.mp4.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
import uuid
from pathlib import Path

from job import resolve_job_dir, add_job_arg

import job_inputs as ji
import hyperframes_captions as hc
import hyperframes_overlays as ho
import hyperframes_dataviz as dv
import hyperframes_layout as hl
import hyperframes_style as hs

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_W, DEFAULT_H, DEFAULT_FPS = 1080, 1920, 30

JOB_COMPOSITION_SUBDIR = "hyperframes"

# Content modes — explicit intent, never inferred from missing/broken files.
CONTENT_MODES = ("standard", "no-captions")
DEFAULT_CONTENT_MODE = "standard"

# Named track constants expressing the SEMANTIC layer order (not arbitrary
# numbers). Higher = painted on top. Captions sit ABOVE the visual overlay
# layers, exactly as Captioned.tsx lifts the caption layer (zIndex:30) above the
# auto-z legacy-overlay / dataviz / job-b-roll layers.
TRACK_BASE_VIDEO = 0
TRACK_AUDIO_BED = 5
TRACK_JOB_VISUAL = 10   # full-frame job b-roll (reserved; below captions)
TRACK_OVERLAY = 15      # typed overlays (hook/url/lower/image/label) — below captions
TRACK_DATAVIZ = 20      # dataviz cards — below captions
TRACK_CAPTIONS = 30     # captions — ABOVE the visual overlay layers
TRACK_FOREGROUND = 40   # explicit above-caption chrome (opt-in; not default)

# Per-kind track for typed overlays, all below captions. Small offsets give a
# deterministic order among overlays that never overlap in practice.
_OVERLAY_KIND_TRACK = {
    "hook": TRACK_OVERLAY,
    "lower": TRACK_OVERLAY + 1,
    "url": TRACK_OVERLAY + 2,
    "cta": TRACK_OVERLAY + 2,
    "label": TRACK_OVERLAY + 3,
    "image": TRACK_OVERLAY + 4,
    "logo": TRACK_OVERLAY + 4,
}


class InputError(RuntimeError):
    """A required or present production input is missing or malformed. The
    message names the file, whether it is missing or malformed, the field/parse
    problem where possible, and the remediation — so a bad input fails at the
    door instead of silently becoming an empty dict / empty word list."""


class CompositionBuildError(RuntimeError):
    """The composition generated into the pending directory is structurally
    incomplete — raised before activation so a partial composition is never
    exposed as the active one."""


def _db_to_linear(db: float) -> float:
    return round(10 ** (db / 20.0), 4)


# ---------------------------------------------------------------------------
# Strict input loading (fail loudly — no silent empty-dict coercion)
# ---------------------------------------------------------------------------
def _read_json_strict(path: Path, *, what: str):
    """Parse a JSON file (md-fence-tolerant), raising InputError with an
    actionable message on a parse failure. Assumes the file exists."""
    try:
        return json.loads(ji.strip_md_fence(path.read_text()))
    except json.JSONDecodeError as e:
        raise InputError(
            f"{path} is malformed {what} (JSON parse error: {e}). "
            f"Fix the file so it is valid JSON and re-run — the HyperFrames "
            f"compositor will not silently treat a broken input as empty.")
    except OSError as e:
        raise InputError(f"{path} could not be read ({what}): {e}.")


def _is_number(v) -> bool:
    """Real JSON number (bool is NOT a number here)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_positive_dimension(v) -> bool:
    """A positive, FINITE numeric dimension — int/float or a numeric string (e.g.
    "1080", which the compositor already accepts via int()); rejects bool,
    non-numeric, zero, negative, and non-finite (NaN/±Infinity — the latter from
    a JSON `1e400` overflow, which would otherwise reach `int()` and raise a raw
    OverflowError, or leak `inf` into data-fps)."""
    if isinstance(v, bool):
        return False
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f) and f > 0


def _finite(value, field: str, job_dir: Path) -> float:
    """The single finite-number conversion boundary for compositor dimensions/
    fps: delegates to the shared hs.finite_number check and re-raises as this
    module's InputError (NaN/±Infinity → actionable error, never a raw
    ValueError/OverflowError from a later int())."""
    try:
        return hs.finite_number(value, field=f"{job_dir / 'style_directives.json'}: '{field}'")
    except hs.StyleValueError as e:
        raise InputError(str(e))


def _as_pixels(value, field: str, job_dir: Path) -> int:
    """A width/height in whole, FINITE pixels. Accepts an int, an integer-valued
    float or numeric string ("1080", 1080.0); rejects a fractional value
    ("1080.5") and a non-finite one (NaN/inf, e.g. from a JSON 1e400 overflow)
    with an actionable InputError instead of letting `int()` truncate or raise a
    raw ValueError/OverflowError."""
    f = _finite(value, field, job_dir)
    if f != int(f):
        raise InputError(
            f"{job_dir / 'style_directives.json'}: '{field}' must be a whole "
            f"number of pixels, got {value!r} (fractional dimensions are not "
            "supported).")
    return int(f)


def _as_fps(value, job_dir: Path) -> int:
    """Frames per second as a whole, FINITE number.

    The HyperFrames renderer REJECTS decimal frame rates ("29.97" — it reports
    them ambiguous and wants an integer or an exact rational like 30000/1001),
    and this spike only plumbs a single numeric data-fps through — not a rational.
    So a fractional value is rejected here with an actionable InputError, rather
    than silently truncated to 29 (the original defect) or written as a decimal
    the renderer would refuse mid-render. NaN/inf are rejected by _finite first."""
    f = _finite(value, "fps", job_dir)
    if f != int(f):
        raise InputError(
            f"{job_dir / 'style_directives.json'}: 'fps' must be a whole number — "
            f"the HyperFrames renderer rejects decimal frame rates like {value!r} "
            "(it accepts an integer, or an exact rational such as 30000/1001 in a "
            "hand-authored composition). Use e.g. 30.")
    if f > 240:
        raise InputError(
            f"{job_dir / 'style_directives.json'}: 'fps' must be no greater "
            f"than 240, got {value!r}.")
    return int(f)


def _fps_attr(fps: float) -> str:
    """Render fps for the data-fps attribute: an integer rate as "30" (not
    "30.0"), a fractional rate as-is ("29.97")."""
    return str(int(fps)) if float(fps).is_integer() else f"{fps:g}"


def _load_object_json(path: Path, *, what: str) -> dict | None:
    """A present optional file must parse AND be a JSON object. Missing → None;
    present-but-not-an-object → InputError. Returns the parsed object."""
    if not path.exists():
        return None
    data = _read_json_strict(path, what=what)
    if not isinstance(data, dict):
        raise InputError(
            f"{path}: {what} must be a JSON object (got {type(data).__name__}).")
    return data


def _validate_optional_inputs(job_dir: Path) -> None:
    """Validate the present optional inputs strictly (object shape + field types)
    so a wrong-type value surfaces as an actionable InputError here rather than a
    raw AttributeError/TypeError deeper in the shared readers."""
    company = _load_object_json(job_dir / "company.json", what="company.json")
    if company is not None:
        for key in ("website", "url"):
            if key in company and not isinstance(company[key], str):
                raise InputError(
                    f"{job_dir / 'company.json'}: '{key}' must be a string.")

    # Read only to surface a malformed file; no field of it sets the bed level
    # any more (#321).
    _load_object_json(job_dir / "audio" / "bed_meta.json", what="audio/bed_meta.json")

    lum = _load_object_json(job_dir / "caption_luminance.json",
                            what="caption_luminance.json")
    if lum is not None and "luminance_avg" in lum \
            and not _is_number(lum["luminance_avg"]):
        raise InputError(
            f"{job_dir / 'caption_luminance.json'}: 'luminance_avg' must be "
            "numeric.")


def _validate_directive_fields(directives: dict, path: Path) -> None:
    """Type-check coerced style_directives fields so a wrong-type value is an
    actionable InputError, not a downstream crash. dataviz[] shape is checked
    separately by _validate_dataviz."""
    def _bad(field, expected):
        raise InputError(f"{path}: '{field}' must be {expected}.")

    checks = {
        "caption_style": (lambda v: isinstance(v, dict), "a JSON object"),
        "caption_preset": (lambda v: isinstance(v, str), "a string"),
        "show_captions": (lambda v: isinstance(v, bool), "a boolean"),
        "hook": (lambda v: isinstance(v, dict), "a JSON object"),
        "url_pill": (lambda v: isinstance(v, dict), "a JSON object"),
        "music": (lambda v: isinstance(v, dict), "a JSON object"),
        "dataviz": (lambda v: isinstance(v, list), "a JSON array"),
    }
    for field, (ok, expected) in checks.items():
        if field in directives and directives[field] is not None and not ok(directives[field]):
            _bad(field, expected)

    if "lower_thirds" in directives and directives["lower_thirds"] is not None:
        lts = directives["lower_thirds"]
        if not isinstance(lts, list) or not all(isinstance(x, dict) for x in lts):
            _bad("lower_thirds", "an array of objects")

    for field in ("width", "height", "fps"):
        if field in directives and directives[field] is not None \
                and not _is_positive_dimension(directives[field]):
            _bad(field, "a positive number")

    music = directives.get("music")
    if isinstance(music, dict) and "bed_under_voice_db" in music and not (
            _is_number(music["bed_under_voice_db"]) and music["bed_under_voice_db"] >= 0):
        _bad("music.bed_under_voice_db", "a number of dB below the voice (0 or more)")

    # Directive overlay text/timing (hook / url_pill / each lower_thirds entry).
    entries = []
    for key in ("hook", "url_pill"):
        if isinstance(directives.get(key), dict):
            entries.append((key, directives[key]))
    if isinstance(directives.get("lower_thirds"), list):
        for i, lt in enumerate(directives["lower_thirds"]):
            if isinstance(lt, dict):
                entries.append((f"lower_thirds[{i}]", lt))
    for label, ov in entries:
        if "text" in ov and not isinstance(ov["text"], str):
            _bad(f"{label}.text", "a string")
        s, e = ov.get("start_sec"), ov.get("end_sec")
        if s is not None and not _is_number(s):
            _bad(f"{label}.start_sec", "numeric")
        if e is not None and not _is_number(e):
            _bad(f"{label}.end_sec", "numeric")
        if _is_number(s) and _is_number(e) and not e > s:
            raise InputError(
                f"{path}: '{label}.end_sec' ({e}) must be greater than "
                f"'start_sec' ({s}).")


def _load_script_strict(job_dir: Path, *, required: bool) -> dict:
    path = job_dir / "script.json"
    if not path.exists():
        if required:
            raise InputError(
                f"{path} not found — standard mode needs script.json (chunk "
                "timings + overlay markers + duration fallback). Write it, or "
                "run with --content-mode no-captions if this is a caption-free "
                "post-only render.")
        return {}
    data = _read_json_strict(path, what="script.json")
    if not isinstance(data, dict):
        raise InputError(
            f"{path}: script.json must be a JSON object (got "
            f"{type(data).__name__}).")
    return data


def _load_transcript_words_strict(job_dir: Path, *, required: bool,
                                  reject_placeholder: bool) -> list[dict]:
    """Word-level transcript, validated strictly for the HyperFrames path.

    A malformed transcript.json fails loudly (unlike the tolerant shared
    job_inputs.load_transcript_words, which stays tolerant so the Remotion path
    is unchanged). In standard mode with captions on, an absent/empty/placeholder
    transcript is rejected with an actionable message."""
    path = job_dir / "transcript.json"
    if not path.exists():
        if required:
            raise InputError(
                f"{path} not found — standard-mode captions need a word-level "
                "transcript. Run synth_voice (transcription) first, or use "
                "--content-mode no-captions for a caption-free render.")
        return []
    data = _read_json_strict(path, what="transcript.json")
    words = data.get("words") if isinstance(data, dict) else None
    if words is None or not isinstance(words, list):
        raise InputError(
            f"{path}: expected an object with a 'words' array of "
            "{{word,start,end}} entries.")
    if reject_placeholder and words:
        first = words[0] if isinstance(words[0], dict) else {}
        token = str(first.get("word", first.get("text", "")))
        if token == "PLACEHOLDER":
            raise InputError(
                f"{path} is a placeholder transcript (first word "
                "'PLACEHOLDER'). Set ELEVENLABS_API_KEY and re-run synth_voice to "
                "produce a real transcript before rendering captions.")
    if required and not words:
        raise InputError(
            f"{path}: 'words' is empty — no caption text to render. Provide a "
            "real transcript, or use --content-mode no-captions.")
    # Per-word shape: {word|text: str, start: num, end: num, end >= start}.
    for idx, w in enumerate(words):
        if not isinstance(w, dict):
            raise InputError(f"{path}: word #{idx} must be an object, got {w!r}.")
        token = w.get("word", w.get("text"))
        if not isinstance(token, str):
            raise InputError(
                f"{path}: word #{idx} needs a string 'word' (or 'text').")
        if not _is_number(w.get("start")) or not _is_number(w.get("end")):
            raise InputError(
                f"{path}: word #{idx} ({token!r}) needs numeric 'start' and "
                "'end'.")
        if w["end"] < w["start"]:
            raise InputError(
                f"{path}: word #{idx} ({token!r}) has end < start "
                f"({w['end']} < {w['start']}).")
    return words


def _load_directives_strict(job_dir: Path) -> dict:
    """style_directives.json, coerced through the shared layer. Missing → {};
    present-but-malformed → InputError (the shared loader would only WARN + drop
    it, which is the silent-disappearance this path must not do)."""
    path = job_dir / "style_directives.json"
    if not path.exists():
        return {}
    parsed = _read_json_strict(path, what="style_directives.json")
    if not isinstance(parsed, dict):
        raise InputError(
            f"{path}: style_directives.json must be a JSON object (got "
            f"{type(parsed).__name__}).")
    return ji.coerce_directives(parsed)


# ---------------------------------------------------------------------------
# Overlays (z-order OWNED by the compositor — caller track_index ignored)
# ---------------------------------------------------------------------------
def build_overlays(job_dir: Path, directives: dict | None) -> list[dict]:
    """Merged overlay list using the SAME precedence as compose_render.build_props:
    manual markers (script.json post_production_notes) win for text; directive
    overlays fill kinds the markers didn't set; auto overlays fill any remaining
    hook/url gap.

    The compositor OWNS z-order: each overlay's track_index is force-assigned
    from its kind (all below captions). Any caller-provided track_index in job
    data is discarded, so no JSON input can lift an overlay above the caption
    layer.
    """
    script = _load_optional_script(job_dir)
    company = _load_optional_company(job_dir)

    manual = ji.parse_manual_overlays(script)
    manual_kinds = {o["kind"] for o in manual}
    overlays = list(manual)
    if directives:
        for d in ji.overlays_from_directives(directives):
            if d["kind"] not in manual_kinds:
                overlays.append(d)
    present = {o["kind"] for o in overlays}
    if "hook" not in present or "url" not in present:
        for a in ji.auto_overlays(script, company):
            if a["kind"] not in present:
                overlays.append(a)

    for o in overlays:
        # OWN the track: overwrite (not setdefault) so caller data can't pick it.
        o["track_index"] = _OVERLAY_KIND_TRACK.get(o["kind"], TRACK_OVERLAY)
    return overlays


def _load_optional_script(job_dir: Path) -> dict:
    """script.json for overlay extraction only — tolerant of absence (used by
    build_overlays, which is also called directly by parity tests). Malformed
    still fails loudly via the strict reader."""
    path = job_dir / "script.json"
    if not path.exists():
        return {}
    data = _read_json_strict(path, what="script.json")
    return data if isinstance(data, dict) else {}


def _load_optional_company(job_dir: Path) -> dict | None:
    path = job_dir / "company.json"
    if not path.exists():
        return None
    data = _read_json_strict(path, what="company.json")
    return data if isinstance(data, dict) else None


_DATAVIZ_KINDS = ("stat", "bar", "compare")


def _validate_dataviz(items, job_dir: Path) -> list[dict]:
    """Validate the dataviz[] shape so a malformed entry fails as an actionable
    InputError instead of crashing with a raw KeyError/ValueError inside the
    renderer. Checks: list of objects; known kind; numeric start<end; and the
    per-kind required fields (stat→value; bar/compare→series[].label/value)."""
    path = job_dir / "style_directives.json"
    if not isinstance(items, list):
        raise InputError(
            f"{path}: 'dataviz' must be a JSON array of objects "
            "({kind,start,end,...}).")

    def _num(item, key):
        try:
            n = float(item[key])
        except (KeyError, TypeError, ValueError):
            raise InputError(
                f"{path}: dataviz item {item!r} needs a numeric {key!r}.")
        # json.loads admits the JS literals NaN/Infinity (and 1e400 overflows to
        # inf). A non-finite value reaches the timeline as `v:nan`/`v:inf`, which
        # throws in GSAP and takes the whole render down — reject it at the door.
        if not math.isfinite(n):
            raise InputError(
                f"{path}: dataviz item {item!r} has a non-finite {key!r} "
                f"({item[key]!r}); values must be finite numbers.")
        return n

    for it in items:
        if not isinstance(it, dict):
            raise InputError(
                f"{path}: dataviz entries must be objects, got {it!r}.")
        kind = it.get("kind")
        if kind not in _DATAVIZ_KINDS:
            raise InputError(
                f"{path}: dataviz item has unknown kind {kind!r} "
                f"(known: {', '.join(_DATAVIZ_KINDS)}).")
        pos = it.get("position")
        if pos is not None and pos not in dv.DATAVIZ_POSITIONS:
            raise InputError(
                f"{path}: dataviz item has unsupported position {pos!r} "
                f"(supported: {', '.join(dv.DATAVIZ_POSITIONS)}; omit for "
                f"'{dv.DEFAULT_POSITION}').")
        if _num(it, "end") <= _num(it, "start"):
            raise InputError(
                f"{path}: dataviz {kind!r} end must be greater than start.")
        # decimals is interpolated into a format spec and reaches int() in the
        # generator — a non-finite/negative/fractional value would raise a raw
        # OverflowError/ValueError there, so gate it here.
        if "decimals" in it:
            dec = _num(it, "decimals")  # finite (reuses the finiteness check)
            if dec < 0 or dec != int(dec):
                raise InputError(
                    f"{path}: dataviz {kind!r} 'decimals' must be a non-negative "
                    f"integer, got {it['decimals']!r}.")
        if kind == "stat":
            _num(it, "value")
        else:  # bar / compare
            series = it.get("series")
            if not isinstance(series, list) or not series:
                raise InputError(
                    f"{path}: dataviz {kind!r} needs a non-empty 'series' array.")
            for d in series:
                if not isinstance(d, dict) or "label" not in d:
                    raise InputError(
                        f"{path}: dataviz {kind!r} series entry {d!r} needs a "
                        "'label'.")
                _num(d, "value")
    return items


def _strip_track_index(items: list[dict]) -> list[dict]:
    """Job dataviz items may not select their own z-track: the canonical
    DataViz schema does not expose track_index, and honoring one would let a JSON
    input paint dataviz above captions. Drop it; the compositor assigns
    TRACK_DATAVIZ."""
    return [{k: v for k, v in it.items() if k != "track_index"} for it in items]


# ---------------------------------------------------------------------------
# Layout elements (for element-to-element collision checking)
# ---------------------------------------------------------------------------
def _layout_elements(caption_style: dict | None, overlays: list[dict],
                     dataviz_items: list[dict], duration: float,
                     canvas_w: int, canvas_h: int,
                     ) -> list[hl.LayoutElement]:
    """Timed layout elements for the element-to-element collision pass. Each
    carries its renderer-specific footprint + on-screen window + semantic kind.
    Captions span the whole composition (they page throughout).

    Footprints are measured on the composition's real canvas — this pass is
    canvas-relative and runs on every aspect, including those with no authored
    platform zones."""
    els: list[hl.LayoutElement] = []
    if caption_style is not None:
        els.append(hl.LayoutElement(
            label="caption",
            rect=hl.caption_rect(caption_style, canvas_w=canvas_w,
                                 canvas_h=canvas_h),
            start=0.0, end=duration, kind="caption"))
    for i, o in enumerate(overlays):
        kind = o["kind"]
        els.append(hl.LayoutElement(
            label=f"overlay:{kind}#{i}",
            rect=ho.overlay_footprint(o, canvas_w=canvas_w, canvas_h=canvas_h),
            start=float(o["start"]), end=float(o["end"]), kind="overlay"))
    for i, item in enumerate(dataviz_items):
        try:
            start = float(item["start"])
            end = float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        els.append(hl.LayoutElement(
            label=f"dataviz#{i}",
            rect=hl.dataviz_rect(item.get("position"), canvas_w=canvas_w,
                                 canvas_h=canvas_h),
            start=start, end=end, kind="dataviz"))
    return els


# ---------------------------------------------------------------------------
# Atomic activation (build in a pending sibling, swap in, never leave partial)
# ---------------------------------------------------------------------------
def _pending_dir(job_dir: Path) -> Path:
    return job_dir / f".{JOB_COMPOSITION_SUBDIR}.{uuid.uuid4().hex[:12]}.pending"


def _backup_dir(job_dir: Path) -> Path:
    return job_dir / f".{JOB_COMPOSITION_SUBDIR}.{uuid.uuid4().hex[:12]}.backup"


def _stash_active(active: Path, backup: Path) -> None:
    os.rename(str(active), str(backup))


def _promote_pending(pending: Path, active: Path) -> None:
    os.rename(str(pending), str(active))


def _activate(pending: Path, active: Path, backup: Path) -> None:
    """Atomically make `pending` the active composition.

    Rename the existing active dir aside to `backup`, promote pending → active,
    then drop the backup. If promotion fails, the previous active is restored
    from backup. Same-directory renames are atomic on one filesystem. Unique
    pending and backup names prevent temporary-path collisions. Same-job
    concurrent composition is not evaluated or guaranteed by this Phase 1 spike;
    callers should serialize composition attempts for a job. Raises on failure
    with the previous composition left intact."""
    had_active = active.exists()
    if had_active:
        _stash_active(active, backup)
    try:
        _promote_pending(pending, active)
    except Exception:
        if had_active and not active.exists() and backup.exists():
            os.rename(str(backup), str(active))  # restore previous valid comp
        raise
    if had_active and backup.exists():
        shutil.rmtree(backup, ignore_errors=True)


def _assert_composition_complete(comp_dir: Path, expected_assets: list[str]
                                 ) -> None:
    """Structural completeness of a generated composition (before activation)."""
    entry = comp_dir / "index.html"
    if not entry.exists() or entry.stat().st_size == 0:
        raise CompositionBuildError(
            f"generated composition is incomplete: {entry} missing or empty.")
    html_text = entry.read_text()
    for needle in ('data-composition-id', 'window.__timelines'):
        if needle not in html_text:
            raise CompositionBuildError(
                f"generated composition is malformed: {entry} has no "
                f"{needle!r}.")
    for rel in expected_assets:
        if not (comp_dir / rel).exists():
            raise CompositionBuildError(
                f"generated composition is incomplete: expected asset "
                f"{rel!r} missing under {comp_dir}.")


# ---------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------
def build_composition(job_dir: Path, *, platform: str = "all_platforms",
                      composition_id: str = "JobComposite",
                      layout_policy: str = hl.DEFAULT_LAYOUT_POLICY,
                      content_mode: str = DEFAULT_CONTENT_MODE,
                      allow_font_fallback: bool = False) -> dict:
    """Assemble the composition for a job, atomically.

    Order: (1) parse+validate all inputs; (2) resolve caption style + font gate;
    (3) strict layout validation (red-zone + element-to-element); (4) build all
    assets + index.html into a unique pending sibling dir; (5) verify it is
    structurally complete; (6) atomically activate; cleaning up the pending dir
    on every failure path and never leaving the active hyperframes/ partially
    updated.

    Raises InputError (bad inputs), CompositionBuildError (incomplete build),
    hl.LayoutPolicyError (collision under policy=error), FileNotFoundError
    (missing source video), and SystemExit (forced caption choice / font gate) —
    all BEFORE the active composition is touched.
    """
    if content_mode not in CONTENT_MODES:
        raise ValueError(
            f"Unknown content mode {content_mode!r}. Choose one of: "
            f"{', '.join(CONTENT_MODES)}.")

    active = job_dir / JOB_COMPOSITION_SUBDIR

    source = job_dir / "final_raw.mp4"
    if not source.exists():
        raise FileNotFoundError(
            f"{source} not found — a job composition needs a source video "
            "(same input as compose_render).")

    standard = content_mode == "standard"
    script = _load_script_strict(job_dir, required=standard)

    # Duration: shared canonical precedence (ffprobe → script total → chunk end
    # → fail). Never a hardcoded fallback.
    duration = round(ji.resolve_source_duration(job_dir, script), 3)

    directives = _load_directives_strict(job_dir)
    # Validate directive field types + the present optional inputs up front, so a
    # wrong-type value is an actionable InputError (not a downstream crash).
    _validate_directive_fields(directives, job_dir / "style_directives.json")
    _validate_optional_inputs(job_dir)

    # width/height are whole pixels; fps may be fractional (29.97 NTSC). Both are
    # already validated positive-numeric by _validate_directive_fields, but the
    # conversion is where the contract bites: int('1080.5') would raise a bare
    # ValueError, and int(29.97) would silently truncate to 29 — neither is
    # acceptable (comment on compose.py). Convert deliberately.
    W = _as_pixels(directives.get("width", DEFAULT_W), "width", job_dir)
    H = _as_pixels(directives.get("height", DEFAULT_H), "height", job_dir)
    fps = _as_fps(directives.get("fps", DEFAULT_FPS), job_dir)

    # ── Caption enablement + style (parity with compose_render forced choice) ──
    captions_disabled_directive = directives.get("show_captions", True) is False
    caption_style: dict | None = None
    if standard:
        if captions_disabled_directive:
            raise InputError(
                "standard mode has captions turned OFF via "
                "style_directives show_captions:false. Captions-off is a "
                "deliberate composition — re-run with --content-mode no-captions "
                "so the intent is explicit and recorded, rather than silently "
                "producing a caption-free standard render.")
        words = _load_transcript_words_strict(
            job_dir, required=True, reject_placeholder=True)
        presets = hc.load_presets()
        caption_style = ji.resolve_caption_preset_style(
            directives.get("caption_preset"), directives.get("caption_style"),
            presets)
        if caption_style is None:
            names = ", ".join(presets) or "(none loaded)"
            raise SystemExit(
                "ERROR: captions are ON but no caption style was chosen.\n"
                "Caption presets are OPT-IN ON PURPOSE — there is no default "
                "look (parity with compose_render).\n\n"
                f"Pick one of: {names}\n\n"
                "Set \"caption_preset\": \"<name>\" or an explicit "
                "\"caption_style\": {…} in style_directives.json, or run with "
                "--content-mode no-captions for a caption-free render.")
    else:  # no-captions
        words = _load_transcript_words_strict(
            job_dir, required=False, reject_placeholder=False)

    # ── Font-availability gate (no silent browser fallback) ──
    font_fallback_used: list[dict] = []
    if caption_style is not None:
        missing = hc.missing_runtime_fonts(caption_style)
        if missing:
            names = "; ".join(f"{role} font '{fam}'" for role, fam in missing)
            if not allow_font_fallback:
                preset_name = directives.get("caption_preset") or "(explicit style)"
                raise SystemExit(
                    f"ERROR: caption preset {preset_name!r} needs {names}, which "
                    "the frozen HyperFrames runtime cannot serve offline "
                    f"(available: {', '.join(sorted(hc.RUNTIME_FONTS))}).\n"
                    "The browser would silently fall back to a system font, "
                    "voiding preset fidelity. Provision the font under "
                    "hyperframes/runtime/fonts/ (add its @font-face to "
                    "fonts.css), choose a runtime-available preset (tiktok / mono "
                    "/ highlighter), or — for EVALUATION ONLY — pass "
                    "--allow-font-fallback to accept the "
                    f"'{hc.SYSTEM_FALLBACK_FAMILY}' fallback (the result is NOT "
                    "fidelity-proven).")
            font_fallback_used = [
                {"role": role, "requested": fam,
                 "actual_fallback": hc.SYSTEM_FALLBACK_FAMILY}
                for role, fam in missing]
            print(f"⚠  --allow-font-fallback: {names} unavailable; the browser "
                  f"will render '{hc.SYSTEM_FALLBACK_FAMILY}'. This render is "
                  "NOT fidelity-proven for the requested font(s).", file=sys.stderr)

    overlay_list = build_overlays(job_dir, directives)
    dataviz_items = _strip_track_index(
        _validate_dataviz(directives.get("dataviz") or [], job_dir))

    # ── Layout validation BEFORE writing anything ──
    # (1) element-vs-red-zone (shared registry). Caption footprint only when
    #     captions will actually render (no phantom caption for a no-caption job).
    # Every overlay — typed AND positioned (image/logo/label) — gets a real
    # footprint from its render inputs, so no accepted kind bypasses the red-zone
    # check via a 1x1 fallback.
    overlay_rects = {f"overlay:{o['kind']}#{i}":
                     ho.overlay_footprint(o, canvas_w=W, canvas_h=H)
                     for i, o in enumerate(overlay_list)} or None
    # Each dataviz item gets its OWN red-zone footprint from its real position
    # (a bottom-placed card must be checked against the bottom zone, not the
    # center) under a unique label so simultaneous cards are distinguishable.
    dataviz_rects = {f"dataviz#{i}": hl.dataviz_rect(
                         item.get("position"), canvas_w=W, canvas_h=H)
                     for i, item in enumerate(dataviz_items)} or None
    # Zones are resolved for THIS canvas's aspect (#241). An aspect with no
    # authored table yields no zones and a SKIPPED receipt rather than portrait
    # rectangles stretched over a landscape or square frame.
    zone_check = hl.preflight_caption_and_overlays(
        caption_style, [], platform, overlay_rects=overlay_rects,
        dataviz_rects=dataviz_rects, canvas_w=W, canvas_h=H)
    zone_collisions = zone_check.collisions
    hl.enforce_policy(zone_check, layout_policy, platform=platform)
    # (2) element-vs-element (geometry AND time). Z-order is not readability:
    #     a caption painted above a lower-third/dataviz occludes its text. No
    #     blanket caption overlap is allowed; every simultaneous text collision
    #     is unresolved unless a future caller supplies a narrow explicit rule.
    element_collisions = hl.check_element_pairs(
        _layout_elements(caption_style, overlay_list, dataviz_items, duration,
                         W, H))
    hl.enforce_element_policy(element_collisions, layout_policy)

    # ── Build the composition into a UNIQUE PENDING sibling directory ──
    pending = _pending_dir(job_dir)
    backup = _backup_dir(job_dir)
    try:
        pending_assets = pending / "assets"
        pending_assets.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, pending_assets / "source.mp4")

        css_parts, body_parts, tl_parts, layers = [], [], [], []

        # Under --allow-font-fallback, declare each unavailable family via a
        # local()-only @font-face so the render passes the CLI's font-face lint
        # AND the browser resolves through the caption font stack's system
        # fallback (the composition is recorded NOT fidelity-proven).
        for fb in font_fallback_used:
            css_parts.append(
                f'@font-face {{ font-family:"{fb["requested"]}"; '
                f'src: local("{fb["requested"]}"); font-display: swap; }}\n')

        body_parts.append(
            f'<video id="base" class="clip" data-start="0" data-duration="{duration}" '
            f'data-track-index="{TRACK_BASE_VIDEO}" data-has-audio="true" data-volume="1" '
            f'src="assets/source.mp4" '
            f'style="position:absolute;inset:0;width:{W}px;height:{H}px;object-fit:cover;"></video>')
        layers.append("source_video")

        bed = job_dir / "audio" / "bed.wav"
        if bed.exists():
            shutil.copy2(bed, pending_assets / "bed.wav")
            db = ji.resolve_audio_bed_volume_db(job_dir, directives, voice_media=source)
            body_parts.append(
                f'<audio id="bed" class="clip" data-start="0" data-duration="{duration}" '
                f'data-track-index="{TRACK_AUDIO_BED}" data-volume="{_db_to_linear(db)}" '
                f'src="assets/bed.wav"></audio>')
            layers.append("audio_bed")

        if overlay_list:
            olayer = ho.render_overlays(overlay_list)
            css_parts.append(olayer.css)
            body_parts.append(olayer.body)
            tl_parts.append(olayer.timeline_js)
            layers.append("overlays")

        if dataviz_items:
            dlayer = dv.render_dataviz(dataviz_items, track_index=TRACK_DATAVIZ)
            css_parts.append(dlayer.css)
            body_parts.append(dlayer.body)
            tl_parts.append(dlayer.timeline_js)
            layers.append("dataviz")

        # Captions (ABOVE the visual overlay layers — Captioned.tsx zIndex:30).
        # Pass the pre-resolved style so HyperFrames and Remotion receive the
        # semantically-equivalent caption style (job_inputs.resolve_caption_preset_style).
        if caption_style is not None:
            clayer = hc.build_caption_layer(
                words, height=H, width=W, style=caption_style,
                track_index=TRACK_CAPTIONS)
            css_parts.append(clayer.css)
            body_parts.append(clayer.body)
            tl_parts.append(clayer.timeline_js)
            layers.append("captions")

        # A timeline that must advance under seek (HyperFrames `check` rejects a
        # fully static timeline); guard the rare all-static case with a base fade.
        if not tl_parts:
            tl_parts.append('tl.from("#base", {opacity:0.999, duration:0.1}, 0);')

        html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={W}, height={H}" />
<script src="runtime/gsap.min.js"></script>
<link rel="stylesheet" href="runtime/fonts/fonts.css" />
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:{W}px; height:{H}px; overflow:hidden; background:#000; }}
{"".join(css_parts)}
</style>
</head>
<body>
<div id="root" data-composition-id="{composition_id}" data-start="0"
     data-duration="{duration}" data-fps="{_fps_attr(fps)}"
     data-width="{W}" data-height="{H}">
{chr(10).join(body_parts)}
</div>
<script>
{dv.FMT_JS}
window.__timelines = window.__timelines || {{}};
var tl = gsap.timeline({{ paused: true }});
{chr(10).join(tl_parts)}
window.__timelines["{composition_id}"] = tl;
</script>
</body>
</html>
"""
        (pending / "index.html").write_text(html)

        expected_assets = ["assets/source.mp4"]
        if bed.exists():
            expected_assets.append("assets/bed.wav")
        _assert_composition_complete(pending, expected_assets)

        # ── Atomically activate (previous valid composition preserved until now) ──
        _activate(pending, active, backup)
    except BaseException:
        shutil.rmtree(pending, ignore_errors=True)
        # _activate restores the previous active on promotion failure; only clear
        # a stray backup when the active dir is safely in place.
        if backup.exists() and active.exists():
            shutil.rmtree(backup, ignore_errors=True)
        raise

    return {
        "job": job_dir.name,
        "composition": str(active / "index.html"),
        "activated": True,
        "content_mode": content_mode,
        "captions": caption_style is not None,
        "duration": duration,
        "dimensions": f"{W}x{H}",
        "fps": fps,
        "layers": layers,
        "track_order": {
            "source_video": TRACK_BASE_VIDEO, "audio_bed": TRACK_AUDIO_BED,
            "overlays": TRACK_OVERLAY, "dataviz": TRACK_DATAVIZ,
            "captions": TRACK_CAPTIONS,
        },
        "preflight_platform": platform,
        "layout_policy": layout_policy,
        # A clean `preflight_collisions` is only platform-safe when the check
        # actually ran; `checks_skipped` is what keeps a SKIP from reading as a
        # PASS on an aspect with no authored zone table.
        "red_zone_check": zone_check.zones.receipt(),
        "checks_skipped": zone_check.skipped_checks,
        "font_fallback": font_fallback_used,
        "fidelity_proven": not font_fallback_used,
        "preflight_collisions": [
            {"element": c.element, "zones": c.zones, "iou_max": round(c.iou_max, 3)}
            for c in zone_collisions],
        "element_collisions": [
            {"a": c.a, "b": c.b, "allowed": c.allowed,
             "overlap_s": [round(c.time_overlap[0], 3), round(c.time_overlap[1], 3)],
             "iou": round(c.iou, 3)}
            for c in element_collisions],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_job_arg(parser)
    parser.add_argument("--platform", default="all_platforms",
                        help="Red-zone platform profile for preflight.")
    parser.add_argument("--composition-id", default="JobComposite")
    parser.add_argument("--content-mode", default=DEFAULT_CONTENT_MODE,
                        choices=list(CONTENT_MODES),
                        help="standard (default): production-like short-form, "
                             "captions required. no-captions: explicitly "
                             "caption-free (overlay/dataviz/video only).")
    parser.add_argument("--layout-policy", default=hl.DEFAULT_LAYOUT_POLICY,
                        choices=list(hl.LAYOUT_POLICIES),
                        help="error (default): unresolved red-zone OR "
                             "element-to-element collisions block composition "
                             "generation. warn: generate anyway and record them.")
    parser.add_argument("--allow-font-fallback", action="store_true",
                        help="EVALUATION ONLY: allow a caption/emphasis font the "
                             "frozen runtime cannot serve to fall back to a "
                             "system font (warns; records the fallback in the "
                             "summary; result is NOT fidelity-proven).")
    args = parser.parse_args()

    job_dir = resolve_job_dir(args.job)
    try:
        summary = build_composition(
            job_dir, platform=args.platform, composition_id=args.composition_id,
            layout_policy=args.layout_policy, content_mode=args.content_mode,
            allow_font_fallback=args.allow_font_fallback)
    except hl.LayoutPolicyError as e:
        print(f"✗ Layout policy blocked composition:\n  {e}", file=sys.stderr)
        raise SystemExit(2)
    except (InputError, hs.StyleValueError) as e:
        print(f"✗ Input error:\n  {e}", file=sys.stderr)
        raise SystemExit(2)
    print(json.dumps(summary, indent=2))
    if summary["checks_skipped"]:
        print(f"\n⚠  {summary['red_zone_check']['reason']}\n"
              "   Platform UI chrome was NOT checked on this canvas — a clean "
              "layout result covers the remaining checks only.")
    if summary["preflight_collisions"]:
        print("\n⚠ Red-zone preflight collisions (policy=warn — recorded, "
              "review before shipping):")
        for c in summary["preflight_collisions"]:
            print(f"  - {c['element']} → {c['zones']} (IOU {c['iou_max']})")
    unresolved = [c for c in summary["element_collisions"] if not c["allowed"]]
    if unresolved:
        print("\n⚠ Element-to-element collisions (policy=warn — recorded):")
        for c in unresolved:
            print(f"  - {c['a']} ⨯ {c['b']} "
                  f"(overlap {c['overlap_s'][0]}–{c['overlap_s'][1]}s, IOU {c['iou']})")
    print(f"\nComposition written{' (font-fallback: NOT fidelity-proven)' if summary['font_fallback'] else ''}. "
          f"Render with:\n"
          f"  uv run python tools/hyperframes_render.py --job {job_dir.name}")


if __name__ == "__main__":
    main()
