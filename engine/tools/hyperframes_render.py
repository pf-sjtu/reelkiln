"""
HyperFrames render layer — a LOCAL, self-hosted HTML→MP4 render path that runs
ALONGSIDE Remotion (issue #112). Remotion stays the shipping
default; this renders a job-owned HyperFrames composition to a DISTINCT artifact
so both can be compared A/B without touching the Remotion pipeline.

  uv run python tools/hyperframes_render.py --job <id>

Reads:  <job_dir>/hyperframes/index.html   (the job-owned composition + assets)
Writes: <job_dir>/final_hyperframes.mp4    (NEVER final.mp4 — that stays Remotion's)

Sibling in responsibility to tools/remotion_render.py. It deliberately does NOT
share code with it: the two render layers are independent by design.

Architecture
------------
A HyperFrames composition is a self-contained project directory whose entry is
`index.html` (see docs/hyperframes.md for the authoring contract). The pinned
`hyperframes` CLI (root `hyperframes/` project, exact version in its
package.json) serves that directory to headless Chrome, seeks every frame, and
encodes with ffmpeg — the same fundamental mechanism as Remotion, so the
fidelity ceiling is the same and renders are deterministic on re-run.

The composition's local server is rooted at the composition directory, so the
GSAP runtime + fonts must live inside it. The engine owns that frozen runtime
(hyperframes/runtime/) and PROVISIONS a copy into the composition dir before
render — analogous to remotion_render.ensure_remotion_installed(). Authors
reference `runtime/gsap.min.js` / `runtime/fonts/fonts.css` and never manage it.

Local only. This tool never invokes `hyperframes cloud|lambda|cloudrun` and
never calls HeyGen-hosted rendering.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import tempfile
import uuid
from pathlib import Path

from dotenv import load_dotenv

from job import resolve_job_dir, add_job_arg
from log import log_event
from _paths import OUTPUT_ROOT, REMOTION_DIR
from _render_completion import publish_deliverable

load_dotenv()

# ── Anchored paths (CWD-independent) ─────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
HF_PROJECT_DIR = REPO_ROOT / "hyperframes"
HF_BIN = HF_PROJECT_DIR / "node_modules" / ".bin" / "hyperframes"
HF_RUNTIME_DIR = HF_PROJECT_DIR / "runtime"
HF_NETWORK_GUARD = HF_PROJECT_DIR / "offline-network-guard.mjs"
EXAMPLES_DIR = HF_PROJECT_DIR / "examples"
HYPERFRAMES_VERSION = "0.7.90"

# The job-owned composition contract (smallest valid unit: one dir + index.html).
JOB_COMPOSITION_SUBDIR = "hyperframes"
COMPOSITION_ENTRY = "index.html"
DEFAULT_OUTPUT_NAME = "final_hyperframes.mp4"

# The shipping Remotion artifact — this tool must NEVER write here by default.
REMOTION_DEFAULT_OUTPUT = "final.mp4"

# The two Remotion VIDEO artifacts. Everything else the pipeline owns (inputs,
# QA marker, logs, the composition source) is non-.mp4 and is already excluded by
# the "renders are MP4" rule in guard_output_path; these two are .mp4, so they
# need an explicit name block on top of that rule.
_PROTECTED_VIDEO_NAMES = frozenset({REMOTION_DEFAULT_OUTPUT, "final_raw.mp4"})

# HyperFrames 0.7.90's Puppeteer/Yargs transitive floor is Node 22.12.0. A
# major-only check incorrectly admitted 22.0–22.11 and then failed deep in npm.
MIN_NODE_VERSION = (22, 12, 0)
MIN_NODE_LABEL = ".".join(str(part) for part in MIN_NODE_VERSION)
MIN_RENDER_FPS = 1.0
MAX_RENDER_FPS = 240.0


def _hf_env(network_audit: Path | None = None) -> dict:
    """Environment for every hyperframes subprocess.

    Best-effort defense-in-depth: suppresses HyperFrames' OWN outbound calls —
    anonymous telemetry, update check, feedback prompts, the GitHub skills check
    and auto-install (all recognized HYPERFRAMES_* flags in v0.7.69). These are
    behavioral opt-outs, NOT a network sandbox or a security guarantee. The
    offline guarantee for the composition itself comes from
    find_network_violations() rejecting remote refs + the frozen local runtime.
    """
    env = {
        **os.environ,
        "HYPERFRAMES_NO_TELEMETRY": "1",
        "HYPERFRAMES_NO_UPDATE_CHECK": "1",
        "HYPERFRAMES_NO_FEEDBACK": "1",
        "HYPERFRAMES_NO_AUTO_INSTALL": "1",
        "HYPERFRAMES_SKIP_SKILLS": "1",
        # HyperFrames 0.7.90 probes the canonical skills revision with
        # `git ls-remote` even when skills installation is disabled. Reject
        # every non-local git transport before it can open a socket. The Node
        # guard below supplies the subsequent manifest request locally.
        "GIT_ALLOW_PROTOCOL": "file",
    }
    if network_audit is not None:
        if not HF_NETWORK_GUARD.is_file():
            raise PreflightError(
                f"Offline network guard missing at {HF_NETWORK_GUARD}. The "
                "HyperFrames project is incomplete."
            )
        # Node loads this before the CLI. It blocks and records any non-loopback
        # global fetch (including the compiler's Google Fonts resolver). Keep an
        # existing NODE_OPTIONS value; the import URL is percent-encoded so
        # installs under paths with spaces remain one option.
        guard_opt = f"--import={HF_NETWORK_GUARD.resolve().as_uri()}"
        existing = env.get("NODE_OPTIONS", "").strip()
        env["NODE_OPTIONS"] = f"{existing} {guard_opt}".strip()
        env["VIDEOCLAW_HF_NETWORK_AUDIT"] = str(network_audit)
        # HyperFrames 0.7.90 still performs its npm "latest" lookup even when
        # HYPERFRAMES_NO_UPDATE_CHECK=1. The imported guard satisfies only that
        # exact metadata request with this installed/pinned version, without
        # opening a socket. Keep the value sourced from the same constant used
        # by the install preflight so the two attestations cannot drift.
        env["VIDEOCLAW_HF_PINNED_VERSION"] = HYPERFRAMES_VERSION
    return env


class PreflightError(RuntimeError):
    """A precondition failed before any render was attempted."""


class CompositionError(RuntimeError):
    """The job-owned composition is missing or malformed."""


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
def check_node_version() -> str:
    """Fail loudly with a clear message when the Node runtime is unsupported,
    rather than letting the CLI die with an obscure error later."""
    node = shutil.which("node")
    if not node:
        raise PreflightError(
            "Node.js not found on PATH. HyperFrames requires Node.js "
            f"{MIN_NODE_LABEL}+. Install it and retry."
        )
    out = subprocess.run([node, "--version"], capture_output=True, text=True)
    raw = (out.stdout or out.stderr).strip()  # e.g. "v22.21.0"
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", raw)
    if not m:
        raise PreflightError(f"Could not parse Node version from {raw!r}.")
    version = tuple(int(m.group(i)) for i in range(1, 4))
    if version < MIN_NODE_VERSION:
        raise PreflightError(
            f"Node.js {raw} is too old — HyperFrames requires Node.js "
            f"{MIN_NODE_LABEL}+. Upgrade Node (e.g. `nvm install 22.12`) "
            "and retry. (This does not affect the Remotion pipeline.)"
        )
    return raw


def ensure_hyperframes_installed() -> None:
    if not HF_BIN.exists():
        raise PreflightError(
            f"{HF_BIN} is missing. Run the one-time setup:\n"
            f"    npm install --prefix {HF_PROJECT_DIR}\n"
            "(installs the pinned hyperframes CLI + its headless Chrome). "
            "See docs/hyperframes.md."
        )
    installed_package = HF_PROJECT_DIR / "node_modules" / "hyperframes" / "package.json"
    try:
        installed = json.loads(installed_package.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PreflightError(
            "The installed HyperFrames runtime cannot be verified. "
            f"Run `npm ci --prefix {HF_PROJECT_DIR}` and retry."
        ) from exc
    if installed.get("version") != HYPERFRAMES_VERSION:
        raise PreflightError(
            "The installed HyperFrames runtime is stale or unsupported: "
            f"expected {HYPERFRAMES_VERSION}, got {installed.get('version')!r}. "
            f"Run `npm ci --prefix {HF_PROJECT_DIR}` and retry."
        )


# ---------------------------------------------------------------------------
# Composition resolution + validation
# ---------------------------------------------------------------------------
def resolve_composition_dir(job_dir: Path, source_dir: str | None) -> Path:
    """The composition directory to render.

    Default: <job_dir>/hyperframes/  (the documented job-owned contract).
    --source-dir overrides it (used to render the shipped example ports for A/B).
    """
    if source_dir:
        d = Path(source_dir)
        if not d.is_absolute():
            d = (REPO_ROOT / d).resolve()
        return d
    return job_dir / JOB_COMPOSITION_SUBDIR


ROOT_RE = re.compile(r"<div\b[^>]*\bdata-composition-id\b[^>]*>", re.IGNORECASE | re.DOTALL)
ATTR_RE = lambda name: re.compile(  # noqa: E731
    rf'data-{name}\s*=\s*"([^"]*)"', re.IGNORECASE
)
# src/href targets — double-quoted, single-quoted, OR unquoted
# (`<script src=https://cdn/x.js>`), so an unquoted remote ref can't slip past
# the offline scan just by omitting the quotes.
REF_RE = re.compile(
    r"""(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))""",
    re.IGNORECASE)
TIMELINE_RE = re.compile(r"window\.__timelines\s*\[", re.IGNORECASE)

# Remote resource / render-time-network detectors (offline enforcement).
# A ref is remote if it starts with http:/https: or is protocol-relative (//host).
_REMOTE_REF_RE = re.compile(r'^\s*(?:https?:)?//|^\s*https?:', re.IGNORECASE)
CSS_REMOTE_URL_RE = re.compile(r"""url\(\s*['"]?\s*(?://|https?:)""", re.IGNORECASE)
NET_API_RES = (
    ("fetch()", re.compile(r"\bfetch\s*\(")),
    ("XMLHttpRequest", re.compile(r"\bXMLHttpRequest\b")),
    ("WebSocket", re.compile(r"\bnew\s+WebSocket\b")),
    ("EventSource", re.compile(r"\bnew\s+EventSource\b")),
)

# ES-module specifiers: `import … from '…'` / `export … from '…'` (default,
# named, namespace, side-effect, re-export) and dynamic `import('…')`. Quotes
# may be single or double.
_FROM_RE = re.compile(r"""\b(?:import|export)\b[^'"();]*?\bfrom\s*['"]([^'"]+)['"]""")
_BARE_IMPORT_RE = re.compile(r"""\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]""")
_CSS_URL_ANY_RE = re.compile(r"""url\(\s*['"]?([^'")]+)""", re.IGNORECASE)

# Local text files worth following (a referenced .js/.css can itself fetch).
_TEXT_REF_EXTS = (".html", ".htm", ".js", ".mjs", ".css")

# HTML comments never load a resource, so a `src=`/`href=` inside one is inert
# (e.g. a `<!-- <Video src={videoSrc}> -->` doc comment in the example ports).
# Strip them from HTML before extracting refs so the broadened unquoted-ref scan
# doesn't false-positive on commented-out markup.
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def _strip_html_comments(text: str) -> str:
    return _HTML_COMMENT_RE.sub("", text)


def _refs(text: str) -> list[str]:
    """All src/href reference targets (double-, single-, or un-quoted)."""
    return [m.group(1) or m.group(2) or m.group(3)
            for m in REF_RE.finditer(text)]


def _import_specs(text: str) -> list[str]:
    """All ES-module import/export specifiers (from-clauses, side-effect and
    dynamic imports), single- or double-quoted."""
    specs = [m.group(1) for m in _FROM_RE.finditer(text)]
    specs += [m.group(1) for m in _BARE_IMPORT_RE.finditer(text)]
    return specs


def _attr(root_tag: str, name: str) -> str | None:
    m = ATTR_RE(name).search(root_tag)
    return m.group(1) if m else None


def _is_remote_ref(ref: str) -> bool:
    """True for http:/https:/protocol-relative (//host) refs. data:/blob:/#/
    root-absolute (/x) and plain relative paths are local."""
    return bool(_REMOTE_REF_RE.match(ref))


def find_network_violations(html: str) -> list[str]:
    """Detect anything that would make a render reach the network.

    Compositions must render fully offline (all media local to the job). This
    flags remote src/href (single- or double-quoted), remote CSS url(...),
    remote import/export specifiers, and render-time network APIs
    (fetch/XHR/WebSocket/EventSource). data: URIs and local/relative/
    root-absolute paths are allowed.
    """
    violations: list[str] = []
    for ref in _refs(html):
        if _is_remote_ref(ref):
            violations.append(f"remote src/href → {ref}")
    for m in CSS_REMOTE_URL_RE.finditer(html):
        snippet = html[m.start():m.start() + 60].replace("\n", " ")
        violations.append(f"remote CSS url() → {snippet}…")
    for spec in _import_specs(html):
        if _is_remote_ref(spec):
            violations.append(f"remote import() → {spec}")
    for label, rex in NET_API_RES:
        if rex.search(html):
            violations.append(f"render-time network API → {label}")
    # dedup, keep order
    seen: set[str] = set()
    out: list[str] = []
    for v in violations:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _local_refs(text: str) -> list[tuple[str, bool]]:
    """Every LOCAL (non-remote) reference in `text`, as `(ref, is_text)` with the
    ref VERBATIM (query/fragment preserved for messages).

    Covers src/href (quoted or unquoted) and CSS url() — which may be
    plain-relative (`app.js`, `hero.png`) — plus ES-module specifiers, which are
    only followed when explicitly relative/absolute (`./x.js`, `/x.js`); a bare
    specifier like `gsap` is a package import resolved from node_modules, not a
    composition-local file. `is_text` is True for .html/.js/.mjs/.css (recursed
    into) and False for every other asset (image/video/audio/font — a leaf that
    still gets a containment + existence check, so it can't escape the comp dir).
    """
    out: list[tuple[str, bool]] = []

    def _consider(r: str, module_specifier: bool) -> None:
        if _is_remote_ref(r) or r.startswith(("data:", "blob:", "#")):
            return
        if module_specifier and not r.startswith((".", "/")):
            return  # bare package specifier — not a composition-local file
        clean = r.split("?", 1)[0].split("#", 1)[0]
        if not clean:
            return
        out.append((r, clean.lower().endswith(_TEXT_REF_EXTS)))

    for r in _refs(text):
        _consider(r, False)
    for m in _CSS_URL_ANY_RE.finditer(text):
        _consider(m.group(1), False)
    for r in _import_specs(text):
        _consider(r, True)
    return out


def _engine_runtime_relpaths() -> set[str]:
    """POSIX-relative paths of the engine-owned frozen runtime files — used to
    tell a genuine provisioned runtime file apart from a user-authored file
    masquerading under runtime/."""
    if not HF_RUNTIME_DIR.is_dir():
        return set()
    return {p.relative_to(HF_RUNTIME_DIR).as_posix()
            for p in HF_RUNTIME_DIR.rglob("*") if p.is_file()}


def _within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def scan_offline_violations(comp_dir: Path, entry_html: str,
                            entry_name: str = COMPOSITION_ENTRY
                            ) -> tuple[list[str], list[str]]:
    """Statically detect offline-contract violations across the entry HTML AND
    every local reference reachable from it — text files (js/mjs/css/html) are
    recursed into; non-text assets (images/video/audio/fonts) are leaf-checked.

    Returns (violations, missing):
      * violations — remote refs (quoted OR unquoted) / render-time network /
        path escapes, each labelled with the referring file. A reference that
        escapes the composition directory — via `..`, a resolved-path escape, a
        root-absolute path, or a symlink pointing outside — is a violation (NOT
        silently skipped) for text AND non-text assets alike; nothing outside the
        directory is served to the render.
      * missing — referenced local files (text or asset) that don't exist on
        disk, labelled with the referrer, so they surface as missing assets.

    Defense-in-depth static detection of common network usage, not a complete
    browser or operating-system network sandbox — a determined author can still
    hide a request behind dynamic strings, eval, or a non-text asset. Every
    reference is resolved relative to the file that contains it; root-absolute
    (/x) refs resolve against the composition root. Query strings/fragments are
    stripped before filesystem resolution (the original ref is kept in
    messages). Cycle-protected on canonical resolved paths. Genuine
    engine-provisioned runtime/ files are trusted; a user file masquerading
    under runtime/ is scanned like any other.
    """
    comp_root = comp_dir.resolve()
    entry_path = (comp_root / entry_name).resolve()
    runtime_ok = _engine_runtime_relpaths()
    violations: list[str] = []
    missing: list[str] = []

    def _rel(target: Path) -> str:
        try:
            return target.relative_to(comp_root).as_posix()
        except ValueError:
            return str(target)

    def _label(referrer: str, v: str) -> str:
        return v if referrer == entry_name else f"{referrer}: {v}"

    entry_scan = _strip_html_comments(entry_html)  # entry is always HTML
    for v in find_network_violations(entry_scan):
        violations.append(_label(entry_name, v))

    visited: set[Path] = {entry_path}
    # (dir the reference is resolved against, verbatim ref, is_text, referrer)
    stack: list[tuple[Path, str, bool, str]] = [
        (entry_path.parent, r, is_text, entry_name)
        for r, is_text in _local_refs(entry_scan)]

    while stack:
        base_dir, ref, is_text, referrer = stack.pop()
        clean = ref.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/"):
            target = (comp_root / clean.lstrip("/")).resolve()
        else:
            target = (base_dir / clean).resolve()

        # Containment applies to EVERY local reference — text and non-text alike.
        # `.resolve()` collapses `..` and follows symlinks, so a lexical `../x`,
        # a resolved-path escape and a symlink pointing outside are all caught.
        if not _within(target, comp_root):
            violations.append(_label(
                referrer, f"reference escapes the composition directory → {ref}"))
            continue

        rel = _rel(target)
        if rel.startswith("runtime/") and rel[len("runtime/"):] in runtime_ok:
            continue  # genuine engine-provisioned runtime file — trusted
        if target in visited:
            continue
        visited.add(target)
        if not target.is_file():
            missing.append(_label(referrer, f"{ref} (not found)"))
            continue
        if not is_text:
            continue  # asset leaf — contained + present, nothing to recurse into
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if target.suffix.lower() in (".html", ".htm"):
            text = _strip_html_comments(text)  # inert refs inside HTML comments
        for v in find_network_violations(text):
            violations.append(f"{rel}: {v}")
        for r, r_is_text in _local_refs(text):
            stack.append((target.parent, r, r_is_text, rel))

    def _dedup(items: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for x in items:
            if x not in seen:
                seen.add(x)
                out.append(x)
        return out

    return _dedup(violations), _dedup(missing)


FPS_FORM_GUIDANCE = (
    "data-fps must be a positive whole number (e.g. 30) or a positive exact "
    "rational (e.g. 30000/1001) — the HyperFrames renderer rejects decimal "
    "frame rates such as 29.97 as ambiguous."
)


def _comp_number(entry: Path, attr: str, val: str) -> float:
    """A hand-authored `data-<attr>` as a finite, positive float.

    The numeric boundary for the PUBLIC authoring path: rejects non-numeric,
    NaN/±Infinity (incl. a `1e400` overflow, which would otherwise reach `int()`
    as a raw OverflowError) and zero/negative values with an actionable
    CompositionError naming the attribute.
    """
    try:
        f = float(val)
    except (TypeError, ValueError):
        raise CompositionError(f"{entry}: data-{attr}={val!r} is not numeric.")
    if not math.isfinite(f):
        raise CompositionError(
            f"{entry}: data-{attr}={val!r} is not a finite number "
            "(NaN and ±Infinity are not valid composition metadata).")
    if f <= 0:
        raise CompositionError(
            f"{entry}: data-{attr}={val!r} must be greater than zero.")
    return f


def _comp_pixels(entry: Path, attr: str, val: str) -> int:
    """A `data-width`/`data-height` in whole, finite pixels. A fractional value
    ("1080.5") is rejected rather than silently truncated to 1080."""
    f = _comp_number(entry, attr, val)
    if f != int(f):
        raise CompositionError(
            f"{entry}: data-{attr}={val!r} must be a whole number of pixels "
            "(fractional dimensions are not supported).")
    return int(f)


def _comp_fps(entry: Path, val: str) -> float:
    """A `data-fps` in one of the forms the renderer actually supports — a
    positive whole number, or a positive exact rational like "30000/1001".

    Returned as its numeric value so the ffprobe comparison in
    validate_output() keeps working; the source HTML is never rewritten.
    """
    raw = val.strip()
    if "/" in raw:
        num_s, _, den_s = raw.partition("/")
        try:
            parts = (float(num_s.strip()), float(den_s.strip()))
        except (TypeError, ValueError):
            raise CompositionError(
                f"{entry}: data-fps={val!r} is not a valid rational. "
                + FPS_FORM_GUIDANCE)
        for part, label in zip(parts, ("numerator", "denominator")):
            if not math.isfinite(part) or part <= 0 or part != int(part):
                raise CompositionError(
                    f"{entry}: data-fps={val!r} has an invalid {label}. "
                    + FPS_FORM_GUIDANCE)
        fps = parts[0] / parts[1]
        if not (MIN_RENDER_FPS <= fps <= MAX_RENDER_FPS):
            raise CompositionError(
                f"{entry}: data-fps={val!r} must be between "
                f"{MIN_RENDER_FPS:g} and {MAX_RENDER_FPS:g}fps.")
        return fps

    f = _comp_number(entry, "fps", raw)
    if f != int(f):
        raise CompositionError(
            f"{entry}: data-fps={val!r} is a decimal frame rate. "
            + FPS_FORM_GUIDANCE)
    if f > MAX_RENDER_FPS:
        raise CompositionError(
            f"{entry}: data-fps={val!r} must be between "
            f"{MIN_RENDER_FPS:g} and {MAX_RENDER_FPS:g}fps.")
    return float(int(f))


def validate_composition(comp_dir: Path) -> dict:
    """Validate the job-owned composition and return its parsed metadata.

    Raises CompositionError with an actionable message on any structural
    problem, so a malformed composition fails at the door rather than producing
    a broken render.
    """
    if not comp_dir.is_dir():
        raise CompositionError(
            f"Composition directory not found: {comp_dir}\n"
            "Your workflow must write the HyperFrames composition to "
            f"<job_dir>/{JOB_COMPOSITION_SUBDIR}/{COMPOSITION_ENTRY}. "
            "See docs/hyperframes.md for the contract."
        )
    entry = comp_dir / COMPOSITION_ENTRY
    if not entry.exists():
        raise CompositionError(
            f"Composition entry not found: {entry}\n"
            f"Every HyperFrames composition needs an {COMPOSITION_ENTRY} at the "
            "root of its directory."
        )

    html = entry.read_text(encoding="utf-8", errors="replace")

    root_m = ROOT_RE.search(html)
    if not root_m:
        raise CompositionError(
            f"{entry} has no root element carrying data-composition-id. "
            "The composition root <div> must declare data-composition-id, "
            "data-width, data-height and data-duration. See docs/hyperframes.md."
        )
    root_tag = root_m.group(0)

    comp_id = _attr(root_tag, "composition-id")
    if not comp_id:
        raise CompositionError(f"{entry}: root element is missing data-composition-id.")

    meta: dict = {"composition_id": comp_id}
    for req in ("width", "height", "duration"):
        val = _attr(root_tag, req)
        if val is None:
            raise CompositionError(
                f"{entry}: root element is missing data-{req}. "
                "width/height/duration are required on the composition root."
            )
        meta[req] = (_comp_number(entry, req, val) if req == "duration"
                     else _comp_pixels(entry, req, val))

    # data-fps is optional — absent leaves it unset so effective_metadata()
    # keeps applying the HyperFrames 30fps default.
    fps_val = _attr(root_tag, "fps")
    if fps_val is not None:
        meta["fps"] = _comp_fps(entry, fps_val)

    if not TIMELINE_RE.search(html):
        raise CompositionError(
            f"{entry}: no `window.__timelines[...]` registration found. "
            "Every composition must register a paused GSAP timeline keyed by its "
            "composition id, e.g. window.__timelines[\"" + comp_id + "\"] = "
            "gsap.timeline({ paused: true }); — see docs/hyperframes.md."
        )

    # Offline + containment enforcement (defense-in-depth static detection of
    # common network usage, not a complete browser or operating-system network
    # sandbox): scan the entry HTML and the local text files it references
    # (js/mjs/css/html), recursively, resolving each ref relative to the file
    # that contains it.
    violations, nested_missing = scan_offline_violations(comp_dir, html)
    if violations:
        raise CompositionError(
            f"{entry} (or a file it references) breaks the offline/containment "
            "contract — compositions here must keep all media local to the job "
            "(no CDN, no remote fetch, no render-time network) and reference only "
            "files inside the composition directory. Statically-detected issues:\n"
            "  - " + "\n  - ".join(violations)
            + "\nInline/bundle the resource locally under the composition dir, or "
            "use the engine-provisioned runtime/ (gsap.min.js, fonts). "
            "See docs/hyperframes.md."
        )

    meta["expects_audio"] = composition_expects_audio(html)
    # Missing local references (text AND non-text assets) surfaced by the single
    # recursive scan, which now containment- and existence-checks every asset kind.
    meta["missing_assets"] = nested_missing
    return meta


AUDIO_TAG_RE = re.compile(r"<audio\b", re.IGNORECASE)
HAS_AUDIO_ATTR_RE = re.compile(r'data-has-audio\s*=\s*"(?:true|1)"', re.IGNORECASE)


def composition_expects_audio(html: str) -> bool:
    """True if the composition declares an audio track (an <audio> element or a
    video marked data-has-audio) — used to require an audio stream in the MP4."""
    return bool(AUDIO_TAG_RE.search(html) or HAS_AUDIO_ATTR_RE.search(html))


# ---------------------------------------------------------------------------
# Runtime provisioning (engine-owned, frozen, local — no render-time network)
# ---------------------------------------------------------------------------
def provision_runtime(comp_dir: Path) -> None:
    """Copy the frozen GSAP + fonts runtime into the composition dir.

    Idempotent AND content-safe: a runtime file is (re)copied unless the
    destination already matches the engine source BYTE-FOR-BYTE. A size-only
    check would leave a same-size corrupted/tampered runtime file in place — a
    uncached byte comparison repairs it even when size and timestamps match. The
    composition references `runtime/gsap.min.js` and `runtime/fonts/fonts.css`,
    so the render is fully local with no CDN dependency. Only files under
    `runtime/` are touched; user-authored composition files are left alone.
    """
    if not HF_RUNTIME_DIR.is_dir():
        raise PreflightError(
            f"Frozen runtime not found at {HF_RUNTIME_DIR}. The hyperframes/ "
            "project is incomplete — reinstall or restore runtime/."
        )
    runtime_root = comp_dir.resolve() / "runtime"
    if runtime_root.is_symlink():
        raise CompositionError(
            f"Refusing to provision through symlinked runtime directory: {runtime_root}")
    if runtime_root.exists() and not runtime_root.is_dir():
        raise CompositionError(f"Composition runtime path is not a directory: {runtime_root}")
    runtime_root.mkdir(parents=True, exist_ok=True)

    for src in HF_RUNTIME_DIR.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(HF_RUNTIME_DIR)
        parent = runtime_root
        for part in rel.parts[:-1]:
            parent = parent / part
            if parent.is_symlink():
                raise CompositionError(
                    f"Refusing to provision through symlinked runtime path: {parent}")
            if parent.exists() and not parent.is_dir():
                raise CompositionError(f"Runtime parent is not a directory: {parent}")
            parent.mkdir(exist_ok=True)
        dst = runtime_root / rel
        if dst.is_symlink():
            raise CompositionError(f"Refusing to overwrite symlinked runtime file: {dst}")
        if dst.exists() and not dst.is_file():
            raise CompositionError(f"Runtime destination is not a file: {dst}")
        if (dst.exists() and dst.stat().st_nlink == 1
                and src.read_bytes() == dst.read_bytes()):
            continue  # byte-identical to the engine source — leave it
        # Copy to a fresh inode and atomically replace the destination entry.
        # Writing directly through an existing hardlink would modify a file
        # outside the composition even though no symlink is present.
        pending = dst.with_name(f".{dst.name}.provision-{uuid.uuid4().hex}.tmp")
        try:
            shutil.copy2(src, pending)
            os.replace(pending, dst)
        finally:
            pending.unlink(missing_ok=True)


def _compiler_font_css() -> str:
    """The frozen local font faces, rewritten for an inline root-page style.

    HyperFrames' raw-HTML compiler does not follow a local linked stylesheet
    before deterministic-font canonicalization. Without this inline declaration
    it sees ``font-family: Inter`` but no face, then fetches Google Fonts even
    though ``runtime/fonts/fonts.css`` exists. The browser still receives the
    linked stylesheet; this copy exists specifically at the compiler boundary.
    """
    source = HF_RUNTIME_DIR / "fonts" / "fonts.css"
    if not source.is_file():
        raise PreflightError(f"Frozen font stylesheet missing at {source}.")
    css = source.read_text(encoding="utf-8")
    if find_network_violations(css):
        raise PreflightError("Frozen HyperFrames font stylesheet contains a remote reference.")
    return re.sub(
        r'''url\(\s*(["'])\./''',
        r"url(\1runtime/fonts/",
        css,
        flags=re.IGNORECASE,
    )


def compiler_ready_html(html: str) -> str:
    """Return render-only HTML with the frozen local font faces inline."""
    marker = "data-videoclaw-offline-fonts"
    if marker in html:
        return html
    style = f'<style {marker}="true">\n{_compiler_font_css()}\n</style>\n'
    head_close = re.search(r"</head\s*>", html, re.IGNORECASE)
    if head_close:
        return html[:head_close.start()] + style + html[head_close.start():]
    return style + html


@contextmanager
def compiler_ready_entry(comp_dir: Path):
    """Materialize a unique render-only entry beside ``index.html``.

    Keeping the entry in the composition root preserves every relative media
    URL without copying potentially-large assets. The authored file is never
    modified, and the temporary entry is removed on success or failure.
    """
    source = comp_dir / COMPOSITION_ENTRY
    entry_name = f".videoclaw-render-{uuid.uuid4().hex}.html"
    entry = comp_dir / entry_name
    entry.write_text(compiler_ready_html(source.read_text(encoding="utf-8")), encoding="utf-8")
    try:
        yield entry_name
    finally:
        entry.unlink(missing_ok=True)


@contextmanager
def compiler_ready_project(comp_dir: Path):
    """Create a short-lived gate project with local font faces inline.

    ``hyperframes lint/check`` only accept a directory, not an alternate entry
    file. A sibling hardlink copy keeps potentially-large local assets cheap,
    lets the compiler see the same render-only HTML used by ``render``, and
    guarantees the authored composition is never rewritten.
    """
    with tempfile.TemporaryDirectory(
            prefix=".videoclaw-gate-", dir=comp_dir.parent) as shadow_parent:
        shadow = Path(shadow_parent) / "composition"
        shutil.copytree(comp_dir, shadow, copy_function=os.link, symlinks=True)
        entry = shadow / COMPOSITION_ENTRY
        html = entry.read_text(encoding="utf-8")
        # Break the hardlink before writing so the source entry cannot change.
        entry.unlink()
        entry.write_text(compiler_ready_html(html), encoding="utf-8")
        yield shadow


def _network_attempts(audit_path: Path) -> list[str]:
    if not audit_path.is_file():
        return []
    return [line.strip() for line in audit_path.read_text(encoding="utf-8").splitlines()
            if line.strip()]


# ---------------------------------------------------------------------------
# Lint / check gate
# ---------------------------------------------------------------------------
def run_gate(comp_dir: Path, step: str, strict: bool) -> None:
    """Run `hyperframes <step>` on the composition. Fail loudly on errors.

    `step` is "lint" (fast static) or "check" (lint + runtime + layout in
    headless Chrome). Non-zero exit ⇒ raise. With --strict, warnings also fail
    (the CLI's own --strict flag).
    """
    print(f"  → hyperframes {step} {comp_dir.name}{' --strict' if strict else ''}")
    with compiler_ready_project(comp_dir) as gate_dir, \
            tempfile.TemporaryDirectory(prefix="videoclaw-hf-network-") as audit_dir:
        cmd = [str(HF_BIN), step, str(gate_dir)]
        if strict:
            cmd.append("--strict")
        audit_path = Path(audit_dir) / "attempts.log"
        result = subprocess.run(
            cmd, cwd=HF_PROJECT_DIR, env=_hf_env(network_audit=audit_path))
        attempts = _network_attempts(audit_path)
    if attempts:
        raise RuntimeError(
            f"hyperframes {step} attempted outbound network access during an "
            "offline gate: " + ", ".join(attempts[:5]))
    if result.returncode != 0:
        raise RuntimeError(
            f"hyperframes {step} failed (exit {result.returncode}) for {comp_dir}. "
            "Fix the reported findings before rendering. This tool never silently "
            "falls back to Remotion."
        )


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
def _fps_arg(fps: float) -> str:
    """Format an fps for the CLI: an integer rate as "30" (not "30.0"), a
    fractional rate as-is ("29.97")."""
    return str(int(fps)) if float(fps).is_integer() else f"{fps:g}"


def validate_fps_override(fps: float | None) -> None:
    """Reject CLI frame-rate overrides the renderer cannot honor safely."""
    if fps is None:
        return
    if (not math.isfinite(fps) or fps <= 0 or fps > MAX_RENDER_FPS
            or not float(fps).is_integer()):
        raise ValueError(
            f"--fps must be a positive whole number no greater than "
            f"{MAX_RENDER_FPS:g} — use an integer such as 30 (decimal, zero, "
            "negative, NaN and infinite values are unsupported)."
        )


def build_render_cmd(comp_dir: Path, output_path: Path, fps: float | None,
                     workers: str, quality: str,
                     composition_entry: str | None = None) -> list[str]:
    """Construct the local `hyperframes render` argv (no cloud subcommand)."""
    cmd = [
        str(HF_BIN), "render", str(comp_dir),
        "--output", str(output_path.resolve()),
        "--format", "mp4",
        "--workers", str(workers),
        "--quality", quality,
    ]
    if composition_entry is not None:
        cmd += ["--composition", composition_entry]
    if fps is not None:
        cmd += ["--fps", _fps_arg(fps)]
    return cmd


def effective_metadata(meta: dict, fps_override: float | None) -> dict:
    """Render metadata as it will ACTUALLY be produced.

    A --fps override changes the real output frame rate, so validation, logs and
    terminal output must use the override — not the value declared in
    index.html. Falls back to HyperFrames' 30fps default when neither is set.
    Never mutates `meta`.
    """
    eff = dict(meta)
    if fps_override is not None:
        eff["fps"] = float(fps_override)
    elif "fps" not in eff:
        eff["fps"] = 30.0
    return eff


def _is_within(path: Path, root: Path) -> bool:
    """True if `path` is `root` or lives under it (both already resolved)."""
    return path == root or root in path.parents


def _enclosing_job_root(out: Path, job_dir: Path, jobs_root: Path) -> Path | None:
    """The job-tree root `out` falls inside, or None. A path under the shared
    jobs/ root belongs to jobs/<id>; a path under the specific job being rendered
    (which may live outside jobs/, since resolve_job_dir accepts a direct path)
    belongs to that job_dir."""
    if _is_within(out, jobs_root):
        rel = out.relative_to(jobs_root)
        if rel.parts:
            return jobs_root / rel.parts[0]
    if _is_within(out, job_dir):
        return job_dir
    return None


def guard_output_path(output_path: Path, *, job_dir: Path, comp_dir: Path) -> None:
    """Enforce the HyperFrames output-ownership contract on the RESOLVED path, so
    a render can only ever land on a genuine HyperFrames output target — never on
    a file the pipeline, the job, or the composition owns.

    Resolution first (`.resolve()` collapses `.`/`..` and follows symlinks), so
    the rules below cannot be bypassed by a relative path, an absolute path, a
    normalization trick, case differences, or a symlink pointing at a protected
    location. There is NO override flag.

    The contract (a HyperFrames render is always an MP4):
      1. the output must end in `.mp4` — this alone excludes every non-video
         owned file: job inputs (*.json), the QA marker (.qa_ok), run logs
         (*.jsonl), audio (*.wav), the composition source (index.html), …;
      2. it must not be a Remotion VIDEO artifact by name (final.mp4 /
         final_raw.mp4) — those are .mp4, so rule 1 can't catch them;
      3. it must not sit inside the composition being rendered (comp_dir) — the
         composition's own assets (assets/source.mp4, bg.mp4) are off-limits;
      4. it must not sit inside the HyperFrames engine project or the Remotion
         project — the frozen runtime, example ports and the Remotion app;
      5. if it lands inside a job tree it must be a DIRECT CHILD of that job's
         root — never in a subtree (hyperframes/, audio/, footage/, versions/,
         …), which hold inputs, media, the composition source and prior versions.

    What stays allowed: the default `<job>/final_hyperframes.mp4`, another
    job-root .mp4 used as comparison/evidence (e.g. `<job>/hf_compare.mp4`), and
    any .mp4 written outside every protected tree (evidence to docs//tmp)."""
    out = output_path.resolve()
    comp_dir = comp_dir.resolve()
    job_dir = job_dir.resolve()
    jobs_root = OUTPUT_ROOT.resolve()

    def refuse(why: str) -> None:
        raise SystemExit(
            f"Refusing to write HyperFrames output to {out} — {why}. HyperFrames "
            f"output defaults to <job>/{DEFAULT_OUTPUT_NAME}; use that, another "
            "job-root .mp4, or an .mp4 path outside the job/composition trees.")

    if out.suffix.lower() != ".mp4":
        refuse("a HyperFrames render is always an .mp4, and this is not one "
               "(so it would overwrite a non-video job/composition file)")
    if out.name.lower() in _PROTECTED_VIDEO_NAMES:
        refuse(f"{out.name!r} is a Remotion video artifact the pipeline owns")
    if _is_within(out, comp_dir):
        refuse("it is inside the composition being rendered (its own source/assets)")
    for tree, label in ((HF_PROJECT_DIR.resolve(), "the HyperFrames engine project"),
                        (REMOTION_DIR.resolve(), "the Remotion project")):
        if _is_within(out, tree):
            refuse(f"it is inside {label}")
    root = _enclosing_job_root(out, job_dir, jobs_root)
    if root is not None and out.parent != root:
        refuse("it is inside a job subtree (inputs/media/composition/versions); "
               "job-owned renders live at the job root")


def _parse_fps(rate: str | None) -> float:
    """Parse an ffprobe frame-rate string ('30/1', '30000/1001') to float."""
    if not rate or rate in ("0/0", "0"):
        return 0.0
    if "/" in rate:
        num, den = rate.split("/", 1)
        try:
            den_f = float(den)
            return float(num) / den_f if den_f else 0.0
        except ValueError:
            return 0.0
    try:
        return float(rate)
    except ValueError:
        return 0.0


def probe_media(path: Path) -> dict:
    """Return ffprobe's JSON (format + streams) for a media file. Raises
    RuntimeError if ffprobe fails (unreadable / not a media container)."""
    ffprobe = shutil.which("ffprobe") or "ffprobe"
    res = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe could not read {path}: {res.stderr.strip()[:200]}")
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"ffprobe returned unparseable JSON for {path}: {e}")


def has_decodable_frame(path: Path) -> bool:
    """Decode the first video frame to confirm the stream is actually decodable
    (not just described in the header)."""
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    res = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-map", "0:v:0",
         "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return res.returncode == 0


# Output MP4 must match the declared composition within these tolerances.
DURATION_ABS_TOL_S = 0.5   # plus…
DURATION_REL_TOL = 0.03    # …3% of declared duration
FPS_MIN, FPS_MAX = MIN_RENDER_FPS, MAX_RENDER_FPS
FPS_ABS_TOL = 0.5


def verify_output(output_path: Path, meta: dict | None = None) -> dict:
    """ffprobe-validate the rendered MP4. Raises RuntimeError on any failure so
    `render_completed` is never logged for a broken artifact.

    Checks: file present + non-empty; a decodable video stream with positive
    width/height and ≥1 decodable frame; positive, sensible fps; positive
    duration; and — when `meta` is given — dimensions equal to the declared
    composition size, fps ≈ declared, duration ≈ declared (within tolerance),
    and an audio stream when the composition declares one.
    Returns a dict of probed facts.
    """
    if not output_path.exists():
        raise RuntimeError("hyperframes render finished but the MP4 is missing")
    if output_path.stat().st_size == 0:
        raise RuntimeError(f"hyperframes render produced an empty file: {output_path}")

    info = probe_media(output_path)
    streams = info.get("streams", [])
    vstreams = [s for s in streams if s.get("codec_type") == "video"]
    astreams = [s for s in streams if s.get("codec_type") == "audio"]
    if not vstreams:
        raise RuntimeError(f"{output_path} has no video stream")
    v = vstreams[0]

    width = int(v.get("width") or 0)
    height = int(v.get("height") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError(f"{output_path} has non-positive dimensions {width}x{height}")

    # ffprobe reports avg_frame_rate "0/0" for a variable-frame-rate stream; that
    # string is truthy, so `avg or r` would keep the unusable "0/0" and never try
    # r_frame_rate — failing a perfectly valid render. Parse each and take the
    # first that yields a usable rate.
    fps = _parse_fps(v.get("avg_frame_rate")) or _parse_fps(v.get("r_frame_rate"))
    if not (FPS_MIN <= fps <= FPS_MAX):
        raise RuntimeError(f"{output_path} has an implausible frame rate: {fps}")

    duration = 0.0
    try:
        duration = float(info.get("format", {}).get("duration") or v.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        raise RuntimeError(f"{output_path} has non-positive duration ({duration}s)")

    if not has_decodable_frame(output_path):
        raise RuntimeError(f"{output_path} has no decodable video frame")

    facts = {"width": width, "height": height, "fps": round(fps, 3),
             "duration": round(duration, 3), "has_audio": bool(astreams),
             "size_bytes": output_path.stat().st_size}

    if meta:
        if meta.get("width") and width != int(meta["width"]):
            raise RuntimeError(
                f"{output_path} width {width} ≠ declared {meta['width']}")
        if meta.get("height") and height != int(meta["height"]):
            raise RuntimeError(
                f"{output_path} height {height} ≠ declared {meta['height']}")
        declared_fps = float(meta.get("fps") or 0)
        if declared_fps and abs(fps - declared_fps) > FPS_ABS_TOL:
            raise RuntimeError(
                f"{output_path} fps {fps:.3f} ≠ declared {declared_fps}")
        declared_dur = float(meta.get("duration") or 0)
        if declared_dur:
            tol = max(DURATION_ABS_TOL_S, DURATION_REL_TOL * declared_dur)
            if abs(duration - declared_dur) > tol:
                raise RuntimeError(
                    f"{output_path} duration {duration:.3f}s differs from declared "
                    f"{declared_dur}s by more than {tol:.3f}s")
        if meta.get("expects_audio") and not astreams:
            raise RuntimeError(
                f"{output_path} is missing the expected audio stream "
                "(the composition declares an audio track)")

    return facts


def render(comp_dir: Path, output_path: Path, fps: int | None,
           workers: str, quality: str, display_path: Path | None = None) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shown = (display_path or output_path).name
    print(f"  → hyperframes render {comp_dir.name} → {shown} "
          f"(workers={workers}, quality={quality})")
    with compiler_ready_entry(comp_dir) as entry_name, \
            tempfile.TemporaryDirectory(prefix="videoclaw-hf-network-") as audit_dir:
        audit_path = Path(audit_dir) / "attempts.log"
        cmd = build_render_cmd(
            comp_dir, output_path, fps, workers, quality,
            composition_entry=entry_name,
        )
        result = subprocess.run(
            cmd, cwd=HF_PROJECT_DIR, env=_hf_env(network_audit=audit_path))
        attempts = _network_attempts(audit_path)
    if attempts:
        raise RuntimeError(
            "HyperFrames attempted outbound network access during an offline render: "
            + ", ".join(attempts[:5])
        )
    if result.returncode != 0:
        raise RuntimeError(f"hyperframes render exited with code {result.returncode}")


# ---------------------------------------------------------------------------
# Atomic publication
# ---------------------------------------------------------------------------
def _pending_path(output_path: Path) -> Path:
    """A per-attempt temp path in the SAME directory as the final artifact (so
    the final `os.replace` is atomic — same filesystem). A random suffix
    prevents temporary-path collisions; same-job concurrent renders are not
    evaluated or guaranteed by this Phase 1 spike (serialize per job)."""
    return output_path.parent / f".{output_path.name}.{uuid.uuid4().hex[:8]}.pending.mp4"


def _remove_quietly(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def render_validate_publish(comp_dir: Path, output_path: Path, *,
                            fps: int | None, workers: str, quality: str,
                            meta: dict, job_dir: Path, node_version: str,
                            fps_overridden: bool) -> dict:
    """Render → validate → publish, safely.

    Renders to a temp file in the destination directory, ffprobe-validates it,
    and only then publishes it through ``publish_deliverable`` like every
    other final deliverable: fsync + atomic ``os.replace`` onto the public
    artifact, a retained copy at ``renders/<sha256>.mp4`` and the
    render-complete record (videoclaw#265, videoclaw-app#904). A
    previously-valid `final_hyperframes.mp4` is never removed until a new render
    is proven valid, so a failed re-render leaves the last good output intact.
    `render_completed` is logged only AFTER the atomic replacement; any failure
    (render, validation, or publish) removes the temp file and logs
    `render_failed` with the stage. Returns the probed facts.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pending = _pending_path(output_path)
    _remove_quietly(pending)  # defensive: never reuse a stale temp of this name

    log_event(
        job_dir, tool="hyperframes_render.py", event="render_started",
        extra={
            "composition_id": meta.get("composition_id"),
            "composition_dir": str(comp_dir),
            "width": meta.get("width"),
            "height": meta.get("height"),
            "duration_seconds": meta.get("duration"),
            "fps": meta.get("fps"),
            "fps_overridden": fps_overridden,
            "output": str(output_path),
            "renderer": "hyperframes",
            "node_version": node_version,
        },
    )
    t0 = time.perf_counter()

    def _fail(exc: Exception, stage: str) -> None:
        _remove_quietly(pending)
        log_event(
            job_dir, tool="hyperframes_render.py", event="render_failed",
            duration_seconds=time.perf_counter() - t0,
            extra={"error": type(exc).__name__, "error_message": str(exc)[:300],
                   "renderer": "hyperframes", "stage": stage},
        )

    try:
        render(comp_dir, pending, fps, workers, quality, display_path=output_path)
    except Exception as e:
        _fail(e, "render")
        raise
    try:
        facts = verify_output(pending, meta)
    except Exception as e:
        _fail(e, "output_validation")
        raise
    try:
        # Atomic publish (same directory), retained bytes and record.
        publish_deliverable(job_dir, pending, output_path, tool="hyperframes_render",
                            facts={"mode": "hyperframes"})
    except Exception as e:
        _fail(e, "publish")
        raise

    try:
        shown = output_path.relative_to(job_dir)
    except ValueError:
        shown = output_path
    log_event(
        job_dir, tool="hyperframes_render.py", event="render_completed",
        duration_seconds=time.perf_counter() - t0,
        extra={"output_path": str(shown), "renderer": "hyperframes", **facts},
    )
    return facts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_job_arg(parser)
    parser.add_argument(
        "--source-dir", default=None,
        help="Render a composition dir other than <job_dir>/hyperframes "
             "(e.g. hyperframes/examples/textcard for the shipped ports). "
             "Requires --output.")
    parser.add_argument(
        "--output", default=None,
        help=f"Output MP4 path. Default: <job_dir>/{DEFAULT_OUTPUT_NAME}. Must be "
             "an .mp4 render target: a job-root .mp4 or an .mp4 outside the "
             "job/composition trees. Never a Remotion artifact, a job input/"
             "asset, or a file in a job subtree — rejected, no override.")
    parser.add_argument(
        "--init", choices=["textcard", "diagramreel"], default=None,
        help="Seed <job_dir>/hyperframes/ from a shipped example port, then "
             "render it. Lets you produce a job-owned MP4 without hand-authoring "
             "a composition first. Refuses to overwrite an existing composition.")
    parser.add_argument("--fps", type=float, default=None,
                        help="Override frame rate — a WHOLE number, e.g. 30 "
                             "(the HyperFrames renderer rejects decimal rates like "
                             "29.97; default: composition data-fps, else 30).")
    parser.add_argument("--workers", default="2",
                        help="Parallel render workers (number or 'auto'). Default: 2.")
    parser.add_argument("--quality", default="standard",
                        choices=["draft", "standard", "high"],
                        help="Render quality (default: standard).")
    parser.add_argument("--strict", action="store_true",
                        help="Fail the lint/check gate on warnings too.")
    parser.add_argument("--skip-check", action="store_true",
                        help="Skip the (slower) runtime `check` gate; still runs `lint`.")
    args = parser.parse_args()

    # Reject every override the renderer cannot honor before any preflight or
    # install work. In particular, zero used to be silently omitted from argv
    # while still becoming the effective validation metadata.
    try:
        validate_fps_override(args.fps)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    # ── Preflight (clear errors, no obscure downstream failures) ──
    node_version = check_node_version()
    ensure_hyperframes_installed()

    job_dir = resolve_job_dir(args.job)

    # Optional: seed the job-owned composition from a shipped example.
    if args.init:
        if args.source_dir:
            raise SystemExit("--init and --source-dir are mutually exclusive.")
        dest = job_dir / JOB_COMPOSITION_SUBDIR
        if (dest / COMPOSITION_ENTRY).exists():
            raise SystemExit(
                f"Refusing to overwrite existing composition at {dest}. "
                "Remove it first if you really want to re-seed from an example.")
        src_example = EXAMPLES_DIR / args.init
        if not (src_example / COMPOSITION_ENTRY).exists():
            raise SystemExit(f"Example not found: {src_example}")
        shutil.copytree(src_example, dest, dirs_exist_ok=True)
        print(f"Seeded {dest} from example '{args.init}'.")

    comp_dir = resolve_composition_dir(job_dir, args.source_dir)

    # ── Resolve + guard output path ──
    if args.output:
        output_path = Path(args.output)
        if not output_path.is_absolute():
            output_path = (REPO_ROOT / output_path).resolve()
    elif args.source_dir:
        raise SystemExit("--source-dir requires an explicit --output path.")
    else:
        output_path = job_dir / DEFAULT_OUTPUT_NAME

    guard_output_path(output_path, job_dir=job_dir, comp_dir=comp_dir)

    # ── Validate composition ──
    meta = validate_composition(comp_dir)

    # Effective render metadata: a --fps override changes what the CLI actually
    # renders, so validation + logs + terminal output must all reflect the
    # OVERRIDE, not the value declared in index.html. Never mutates `meta`.
    effective_meta = effective_metadata(meta, args.fps)

    print(f"Job:         {job_dir}")
    print(f"Composition: {comp_dir}/{COMPOSITION_ENTRY} "
          f"(id={meta['composition_id']}, {meta.get('width')}x{meta.get('height')}, "
          f"{meta.get('duration')}s @ {effective_meta['fps']}fps"
          f"{' [--fps override]' if args.fps is not None else ''})")
    print(f"Node:        {node_version}")
    if meta["missing_assets"]:
        raise CompositionError(
            f"{comp_dir}/{COMPOSITION_ENTRY} references local assets that do not "
            f"exist: {meta['missing_assets']}. Place them under the composition "
            "directory (all media should be local to the job — no render-time "
            "network). For the example ports, run hyperframes/examples/make_assets.sh.")

    # ── Provision the frozen local runtime (no render-time network) ──
    provision_runtime(comp_dir)

    # ── Lint / check gate ──
    run_gate(comp_dir, "lint", strict=args.strict)
    if not args.skip_check:
        run_gate(comp_dir, "check", strict=args.strict)

    # ── Render → validate → atomically publish ──
    #    Renders to a temp file in the destination dir, ffprobe-validates it, and
    #    only then atomically replaces final_hyperframes.mp4. A failed render
    #    leaves any previous valid output intact and publishes no partial file.
    #    render_completed is logged only after publication.
    facts = render_validate_publish(
        comp_dir, output_path,
        fps=args.fps, workers=args.workers, quality=args.quality,
        meta=effective_meta, job_dir=job_dir, node_version=node_version,
        fps_overridden=args.fps is not None,
    )

    print(f"\n✓ HyperFrames render: {output_path} "
          f"({facts['size_bytes'] // 1024 // 1024}MB · {facts['width']}x{facts['height']} · "
          f"{facts['duration']}s @ {facts['fps']}fps{' · +audio' if facts['has_audio'] else ''})")
    print(f"▶ WATCH → file://{output_path}")


if __name__ == "__main__":
    main()
