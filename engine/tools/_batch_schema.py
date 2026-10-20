"""Shared `--batch` item schema for every mint_video batch mode.

ONE validator, imported by BOTH run_batch (mint_video.py) and the estimator
(cost.py), so the two cannot drift (#74 round-5). The estimator must never price
a fleet item as `probed` ("known") if run_batch would reject it or crash on it —
"known" means every ORIGINAL entry actually reaches runtime probing. Kept
dependency-free (stdlib only) so cost.py can import it while producing optional
advisory pricing metadata.

GENERAL per-item input schema (#74 round-10)
--------------------------------------------
Each mode declares, in ONE table (`_ITEM_SCHEMA`), the inputs an item REQUIRES:
the per-second BILLED media plus N required inputs, each satisfiable per-item OR
by a shared CLI flag. The validator then checks TYPE and USABILITY for every
required input — not just the billed field. A required input is validated the way
run_batch actually consumes it:

  * If a per-item value is PRESENT-AND-TRUTHY, run_batch USES it
    (`spec.get('prompt') or args.prompt`; `spec.get('swap_image')`), so it MUST
    be type-valid and usable — a shared fallback does NOT excuse a malformed
    per-item value (round-10 E-1: `prompt: 123` crashed at `prompt.lower()`
    despite a shared --prompt).
  * If a per-item value is ABSENT/FALSY, run_batch falls back to the shared flag,
    so the shared flag must be present (billed media has no shared fallback).

USABILITY is checked here for every NON-billed required media file (round-10 E-2:
a per-item `swap_image` naming a missing file priced `probed` then crashed at
upload). The BILLED media's usability is the estimator's own probe (that IS the
duration price, and it distinguishes URL/timeout/corrupt far more richly than a
bare is_file) — so the billed field is TYPE-checked here and left for the probe.

Add a future required field as ONE `_Req` row — never a new `has_shared_*` branch.

GENERATION modes (#273: insert, keyframe, multishot)
----------------------------------------------------
These modes generate from prompts and stills, bill by their DECLARED length and
have no billed media to probe, so the estimator keeps pricing their fleets as
unknown. Their rows add `optional` inputs (validated only when present) and a
closed field list (`_ITEM_FIELDS`): an unknown or misspelled key would silently
generate the wrong clip and still bill, so it fails that item before any spend.
Local paths are validated as given; run_batch resolves them job-relative first.
"""

from __future__ import annotations

import math
import os
import re
from pathlib import Path
from typing import Callable, NamedTuple

# Public quality contract per mint_video mode — single source of truth
# (mint_video._validate_quality imports this).
QUALITY_BY_MODE: dict[str, tuple[str, ...]] = {
    "insert": ("standard", "draft", "premium"),
    "keyframe": ("standard", "draft"),
    # Gemini has no distinct draft route for these modes. Exposing draft/--fast
    # here used to relabel the standard Gemini request without changing its
    # behavior, which made the public routing contract misleading.
    "multishot": ("standard",),
    "reenact": ("standard",),
    "edit": ("standard",),
    # Higgsfield has one route; resolution (480p/720p/1080p) is the price tier.
    "genjutsu": ("standard",),
}

# Genjutsu (Higgsfield motion transfer) accepts 1..8 ordered reference images.
GENJUTSU_MAX_REFERENCES = 8
GENJUTSU_MAX_PROMPT_CHARS = 10_000


class _Req(NamedTuple):
    """One required per-item input.

    field  — the per-item spec key.
    kind   — how to validate it:
               'billed_media' — the per-second billed clip: TYPE-checked here
                                (non-empty string); USABILITY is the estimator's
                                probe (`_probe_billed`) / run_batch's per-item
                                `_guard_short_input`, not an is_file here.
               'media_file'   — a required LOCAL file input (uploaded, not
                                probed for duration): TYPE + USABILITY (is_file)
                                checked here, since nothing downstream re-checks
                                it before the paid gateway call.
               'media_files'  — a required ordered LIST of 1..8 image inputs,
                                each a usable local file or an https URL
                                (genjutsu references): TYPE + COUNT + USABILITY.
               'text'         — a required non-empty text string.
               'output_target'— the per-item output PATH run_batch downloads to.
                                OPTIONAL (absent → run_batch computes a default
                                out_dir target), but a PRESENT value must be a
                                usable target: TYPE + USABILITY (writable parent,
                                not an existing directory) checked here, since
                                run_batch only touches it AFTER the paid gateway
                                call — an unusable target bills then crashes on
                                download (IsADirectoryError for a directory).
    shared — the name of the shared-flag toggle that satisfies this input when
             the per-item value is ABSENT (None for billed media, which has no
             shared fallback, and for output_target, which is optional). Keyed to
             the `has_shared_*` kwargs below.
    """

    field: str
    kind: str
    shared: str | None
    optional: bool = False


# The one place a mode's required inputs are declared. A new required field is a
# new row here (plus, only if it needs a shared fallback, one entry in
# `shared_present` below) — never a new mode-specific validation branch.
_ITEM_SCHEMA: dict[str, tuple[_Req, ...]] = {
    "edit": (
        _Req("video", "billed_media", None),
        _Req("prompt", "text", "prompt"),
        _Req("output", "output_target", None),
    ),
    "reenact": (
        _Req("driver_video", "billed_media", None),
        _Req("swap_image", "media_file", "swap_image"),
        _Req("output", "output_target", None),
    ),
    "insert": (
        _Req("name", "slot", None, optional=True),
        _Req("prompt", "text", "prompt"),
        _Req("reference", "media_refs", None, optional=True),
        _Req("duration", "seconds", None, optional=True),
        _Req("output", "output_target", None),
    ),
    "keyframe": (
        _Req("name", "slot", None, optional=True),
        _Req("prompt", "text", "prompt"),
        _Req("first_frame", "media_ref", "first_frame"),
        _Req("last_frame", "media_ref", None, optional=True),
        _Req("duration", "seconds", None, optional=True),
        _Req("output", "output_target", None),
    ),
    "multishot": (
        _Req("name", "slot", None, optional=True),
        _Req("shots", "shots", None),
        _Req("prompt", "text", None, optional=True),
        _Req("reference", "media_refs", None, optional=True),
        _Req("start_image", "media_ref", None, optional=True),
        _Req("output", "output_target", None),
    ),
    "genjutsu": (
        _Req("video", "billed_media", None),
        _Req("references", "media_files", "references"),
        _Req("output", "output_target", None),
    ),
}

# Closed per-item field lists for the generation modes (#273). Per-item values
# override the CLI flag of the same name; anything else fails that item.
_ITEM_FIELDS: dict[str, frozenset[str]] = {
    "insert": frozenset({"name", "output", "prompt", "reference", "duration", "quality",
                         "resolution", "aspect_ratio", "audio", "seed"}),
    "keyframe": frozenset({"name", "output", "prompt", "first_frame", "last_frame", "duration",
                           "quality", "resolution", "aspect_ratio", "audio", "seed"}),
    "multishot": frozenset({"name", "output", "shots", "prompt", "reference", "start_image",
                            "quality", "aspect_ratio", "no_audio"}),
}
_RESOLUTIONS = ("480p", "720p", "1080p")
_SLOT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
_REMOTE = ("http://", "https://", "data:")


def _billed_field(mode: str) -> str | None:
    schema = _ITEM_SCHEMA.get(mode)
    if schema is None:
        return None
    for req in schema:
        if req.kind == "billed_media":
            return req.field
    return None


def _usable_file(value: str) -> bool:
    """Whether `value` is an existing local file, resolved EXACTLY the way
    run_batch resolves a per-item path — a raw `Path(value)`, no expanduser: a
    JSON spec string is never shell/tilde-expanded, so a `~/x.png` item value
    that run_batch's `Path(...).upload` would reject must be rejected here too.
    That keeps the estimator's usability verdict identical to the executor's."""
    try:
        return Path(value).is_file()
    except OSError:
        return False


def _usable_output_target(value: str) -> bool:
    """Whether `value` is a WRITABLE output target, resolved EXACTLY the way
    run_batch consumes it: `out_path = Path(value)`, then
    `out_path.parent.mkdir(parents=True, exist_ok=True)`, then
    `gateway.download(url, out_path)`. So the target must NOT already be a
    directory (download would raise IsADirectoryError AFTER the paid gateway
    call), and its parent must exist-or-be-creatable AND writable (else the
    mkdir/write crashes post-spend). Raw `Path(value)` semantics, no expanduser
    — a JSON spec string is never shell/tilde-expanded, matching run_batch — so
    the estimator's verdict stays identical to the executor's."""
    try:
        p = Path(value)
        if p.is_dir():
            return False  # download() would raise IsADirectoryError
        parent = p.parent
        # run_batch does parent.mkdir(parents=True): the nearest EXISTING
        # ancestor must be a writable directory for that create to succeed.
        anc = parent
        while not anc.exists():
            if anc.parent == anc:      # walked past the filesystem root
                return False
            anc = anc.parent
        if not anc.is_dir() or not os.access(anc, os.W_OK):
            return False
        # If the immediate parent already exists, the file write lands there, so
        # it too must be a writable directory (e.g. a parent that is a FILE, or a
        # read-only dir, would crash the download).
        if parent.exists() and (not parent.is_dir()
                                or not os.access(parent, os.W_OK)):
            return False
        return True
    except OSError:
        return False


def _media_ref_error(field: str, value: object) -> str | None:
    """A generation input: a remote URL or a usable local file."""
    if not isinstance(value, str) or not value.strip():
        return f"item {field!r} must be a non-empty string"
    if value.startswith(_REMOTE) or _usable_file(value):
        return None
    return f"item {field!r} is not a usable file: {value!r}"


def _is_number(value: object) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def _usable_reference(value: object,
                      resolve_path: Callable[[str], Path] | None = None) -> bool:
    """A genjutsu reference run_batch can hand the gateway: an https URL is
    passed through as-is; anything else must be an existing local file,
    resolved the way run_batch resolves it (job-relative when a resolver is
    given, otherwise the raw path)."""
    if not isinstance(value, str) or not value.strip():
        return False
    if value.startswith("https://"):
        return True
    if "://" in value or value.startswith("data:"):
        return False
    if resolve_path is None:
        return _usable_file(value)
    try:
        return resolve_path(value).is_file()
    except (OSError, ValueError):
        return False


def _required_input_error(req: _Req, value: object,
                          resolve_path: Callable[[str], Path] | None = None) -> str | None:
    """Reason a PRESENT per-item value is not a usable input, else None."""
    if req.kind == "media_files":
        if (not isinstance(value, list)
                or not 1 <= len(value) <= GENJUTSU_MAX_REFERENCES):
            return (f"item {req.field!r} must be a list of 1 to "
                    f"{GENJUTSU_MAX_REFERENCES} images")
        for ref in value:
            if not _usable_reference(ref, resolve_path):
                return f"item {req.field!r} has an unusable image: {ref!r}"
        return None
    if req.kind == "media_ref":
        return _media_ref_error(req.field, value)
    if req.kind == "media_refs":
        values = [value] if isinstance(value, str) else value
        if not isinstance(values, list) or not values:
            return f"item {req.field!r} must be a path/URL or a non-empty list of them"
        for entry in values:
            err = _media_ref_error(req.field, entry)
            if err is not None:
                return err
        return None
    if req.kind == "seconds":
        if not _is_number(value) or value <= 0:
            return f"item {req.field!r} must be a positive number of seconds"
        return None
    if req.kind == "shots":
        if not isinstance(value, list) or not 1 <= len(value) <= 6:
            return f"item {req.field!r} must be a list of 1-6 {{prompt, duration}} shots"
        for index, shot in enumerate(value):
            if (not isinstance(shot, dict) or not isinstance(shot.get("prompt"), str)
                    or not shot["prompt"].strip() or not _is_number(shot.get("duration"))
                    or shot["duration"] < 1):
                return (f"item {req.field!r} shot {index} needs a non-empty prompt and a "
                        "duration of at least 1 second")
        return None
    if not isinstance(value, str) or not value.strip():
        return f"item {req.field!r} must be a non-empty string"
    if req.kind == "slot" and (value in {".", ".."} or not _SLOT_RE.fullmatch(value)):
        return (f"item {req.field!r} must be a simple slot name using letters, numbers, "
                f"'.', '_' or '-': {value!r}")
    if req.kind == "media_file" and not _usable_file(value):
        return f"item {req.field!r} is not a usable file: {value!r}"
    if req.kind == "output_target" and not _usable_output_target(value):
        return f"item {req.field!r} is not a usable output target: {value!r}"
    return None


def _generation_field_error(mode: str, spec: dict) -> str | None:
    """Closed-field and plain-option checks for the generation modes."""
    fields = _ITEM_FIELDS.get(mode)
    if fields is None:
        return None
    unknown = sorted(str(key) for key in spec if key not in fields)
    if unknown:
        return (f"item has unsupported field(s) {', '.join(unknown)} for --mode {mode} "
                f"(allowed: {', '.join(sorted(fields))})")
    if not spec.get("name") and not spec.get("output"):
        return f"{mode} item needs 'name' (saved as clips/<name>.mp4) or 'output'"
    resolution = spec.get("resolution")
    if resolution is not None and resolution not in _RESOLUTIONS:
        return f"item 'resolution' must be one of {'|'.join(_RESOLUTIONS)}"
    aspect = spec.get("aspect_ratio")
    if aspect is not None and (not isinstance(aspect, str) or not aspect.strip()):
        return "item 'aspect_ratio' must be a non-empty string such as '9:16'"
    seed = spec.get("seed")
    if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
        return "item 'seed' must be an integer"
    for flag in ("audio", "no_audio"):
        if flag in spec and not isinstance(spec[flag], bool):
            return f"item {flag!r} must be true or false"
    return None


def _missing_input_error(mode: str, req: _Req) -> str:
    if req.kind == "billed_media":
        return f"item {req.field!r} must be a non-empty string"
    if req.shared:
        # The CLI spells the shared reference list as a repeatable --reference.
        flag = {"references": "reference"}.get(req.shared, req.shared).replace("_", "-")
        return f"{mode} item needs {req.field!r} (or a shared --{flag})"
    return f"{mode} item needs {req.field!r}"


def batch_item_error(
    mode: str, spec: object, *,
    has_shared_swap: bool = False,
    has_shared_prompt: bool = False,
    has_shared_first_frame: bool = False,
    has_shared_references: bool = False,
    resolve_path: Callable[[str], Path] | None = None,
) -> str | None:
    """Reason a `--batch` item would NOT reach runtime probing — else None.

    ``resolve_path`` (genjutsu references only) resolves a local path exactly
    as run_batch will, e.g. ``lambda v: resolve_job_input_path(v, job)``.

    Mirrors exactly what run_batch requires before it probes an item's clip:
    the item is an object, a present `quality` is valid for the mode, and every
    required input in `_ITEM_SCHEMA[mode]` is satisfied — per-item (type-valid +
    usable) or, when absent, by its shared flag (or, for the optional
    `output_target`, by run_batch's computed default out_dir). cost.py treats any
    erroring item as incomplete (→ batch_partial); run_batch fails just that item.
    """
    schema = _ITEM_SCHEMA.get(mode)
    if schema is None:
        return f"--batch is unsupported for mode {mode!r}"
    if not isinstance(spec, dict):
        return "item is not a JSON object"

    # Generic per-item structural field that run_batch touches unconditionally
    # and is not tied to a required input: a mode-incompatible `quality` is
    # rejected. (The `output` path is a required input — an `output_target` row
    # in `_ITEM_SCHEMA` — so its type + usability are validated in the loop.)
    quality = spec.get("quality")
    if quality is not None and quality not in QUALITY_BY_MODE.get(mode, ()):
        return (f"item 'quality' {quality!r} unsupported for --mode {mode} "
                f"(allowed: {'|'.join(QUALITY_BY_MODE.get(mode, ()))})")

    if mode == "genjutsu":
        # Resolution is the price tier, so one batch has one: a per-item value
        # would be silently ignored by run_batch and priced at the wrong rate.
        if "resolution" in spec:
            return ("item 'resolution' is not supported; set --resolution for "
                    "the whole genjutsu batch")
        prompt = spec.get("prompt")
        if prompt is not None and (
                not isinstance(prompt, str)
                or len(prompt) > GENJUTSU_MAX_PROMPT_CHARS):
            return (f"item 'prompt' must be text of at most "
                    f"{GENJUTSU_MAX_PROMPT_CHARS} characters")

    field_err = _generation_field_error(mode, spec)
    if field_err is not None:
        return field_err

    # Shared CLI flags that can satisfy an ABSENT per-item value, keyed by the
    # _Req.shared name. Adding a shared-backed field means adding its flag here.
    shared_present = {"swap_image": has_shared_swap, "prompt": has_shared_prompt,
                      "first_frame": has_shared_first_frame,
                      "references": has_shared_references}

    for req in schema:
        value = spec.get(req.field)
        if value or (req.optional and req.field in spec and value is not None):
            # run_batch WOULD use this per-item value → it must be valid
            # and usable, whether or not a shared fallback also exists.
            err = _required_input_error(req, value, resolve_path)
            if err is not None:
                return err
        elif req.optional:
            continue
        elif req.kind == "output_target":
            # Optional: an absent/falsy output makes run_batch compute a default
            # out_dir target — nothing to validate. Only a PRESENT value (above)
            # is usability-checked.
            continue
        elif req.kind == "billed_media" or not shared_present.get(req.shared, False):
            # Billed media is mandatory per-item; a non-billed input with an
            # absent value needs its shared flag present.
            return _missing_input_error(mode, req)
    return None


def batch_item_media(
    mode: str, spec: object, *,
    has_shared_swap: bool = False,
    has_shared_prompt: bool = False,
    has_shared_references: bool = False,
    resolve_path: Callable[[str], Path] | None = None,
) -> str | None:
    """The billed-media string for a schema-valid item, else None (incomplete)."""
    field = _billed_field(mode)
    if field is None:
        return None  # generation modes bill a declared length, not probed media
    if batch_item_error(mode, spec, has_shared_swap=has_shared_swap,
                        has_shared_prompt=has_shared_prompt,
                        has_shared_references=has_shared_references,
                        resolve_path=resolve_path) is not None:
        return None
    assert isinstance(spec, dict)  # guaranteed by batch_item_error
    return spec[field]
