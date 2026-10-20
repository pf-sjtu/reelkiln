"""
HyperFrames overlays — the typed legacy overlay layer + job-owned overlay path
for the HyperFrames render (issue #112).

Two overlay surfaces exist in the Remotion pipeline:

1. **Typed legacy overlays** — `Overlay{kind:"hook"|"url"|"lower", text, start, end}`
   (schema.ts), rendered by `Overlays.tsx` (Hook / UrlPill / LowerThird) with a
   `spring({damping:22, stiffness:180, mass:0.8})` entrance. This is a stable
   DATA contract and ports 1:1 — reproduced faithfully here as GSAP-timed clips.

2. **Job-owned overlays** — a per-job `overlays.tsx` (React/JSX code) symlinked to
   `_currentJobOverlays.tsx`, fetching its own data. This is arbitrary code, not
   data; it does NOT translate to a contract automatically. The HyperFrames
   equivalent is a job-owned HTML fragment authored the same way (see
   `render_overlays` + docs/hyperframes/overlays.md). The renderer-neutral
   overlay dict below is deliberately small (the real typed kinds + image/logo),
   not a broad renderer abstraction.

Entrances use GSAP `back.out(1.7)` over ~0.33s (10 frames @ 30fps), matching the
Remotion spring pop. Z-order is the `data-track-index` on each clip. Local image
assets resolve relative to the composition dir (no network).
"""

from __future__ import annotations

import html
import posixpath
from dataclasses import dataclass, field

import hyperframes_style as hs
from preflight import CANVAS_W, CANVAS_H, overlay_bbox

# The typed overlay kinds from Overlays.tsx, ported 1:1 (styling values verbatim).
# z-order is carried per-overlay as `track_index`; the compositor assigns the
# semantic tracks (see hyperframes_compose.TRACK_*). Overlays default BELOW the
# caption layer, matching Captioned.tsx (captions zIndex:30 sit above the
# auto-z overlay layers). A deliberate above-caption element opts in explicitly.
TYPED_KINDS = {"hook", "url", "lower"}

# Kinds that carry visible text (must have non-empty `text`) vs. asset kinds
# (must have a contained local `src`).
_TEXT_KINDS = {"hook", "url", "cta", "lower", "label"}
_ASSET_KINDS = {"image", "logo"}


class OverlayValidationError(ValueError):
    """An overlay dict failed schema validation. The message names the offending
    field and the fix, so a bad job overlay fails clearly at compose time rather
    than producing a silently-wrong or unsafe composition."""

# Spring entrance ≈ 10 frames @ 30fps → 0.33s; back.out(1.7) approximates the pop.
ENTER_DURATION_S = 0.33
ENTER_EASE = "back.out(1.7)"


@dataclass
class Overlay:
    kind: str                 # hook | url | lower | image | label
    start: float              # seconds
    end: float                # seconds
    text: str = ""
    src: str = ""             # local asset (image/logo), relative to comp dir
    track_index: int = 40     # z-order; higher = on top
    x_pct: float | None = None
    y_pct: float | None = None
    width_px: int | None = None


@dataclass
class OverlayLayer:
    css: str
    body: str
    timeline_js: str
    style: dict = field(default_factory=dict)


def _esc(s: str) -> str:
    return html.escape(s)


def _clip_open(el_id: str, o: Overlay, extra_class: str = "") -> str:
    dur = max(0.001, o.end - o.start)
    cls = f"clip ov {extra_class}".strip()
    return (f'<div class="{cls}" id="{el_id}" data-start="{o.start:.4f}" '
            f'data-duration="{dur:.4f}" data-track-index="{o.track_index}">')


# ---------------------------------------------------------------------------
# Per-kind renderers — styling ported verbatim from Overlays.tsx
# ---------------------------------------------------------------------------
def _hook(el_id: str, o: Overlay) -> tuple[str, str]:
    body = (
        f'{_clip_open(el_id, o, "ov-anchor-top")}'
        f'<div class="ov-box ov-hook" id="{el_id}_b">{_esc(o.text)}</div></div>')
    tl = (f'tl.from("#{el_id}_b", {{y:-30, opacity:0, duration:{ENTER_DURATION_S}, '
          f'ease:"{ENTER_EASE}"}}, {o.start:.4f});')
    return body, tl


def _url(el_id: str, o: Overlay) -> tuple[str, str]:
    body = (
        f'{_clip_open(el_id, o, "ov-anchor-bottom")}'
        f'<div class="ov-box ov-url" id="{el_id}_b">{_esc(o.text)}</div></div>')
    tl = (f'tl.from("#{el_id}_b", {{y:50, opacity:0, duration:{ENTER_DURATION_S}, '
          f'ease:"{ENTER_EASE}"}}, {o.start:.4f});')
    return body, tl


def _lower(el_id: str, o: Overlay) -> tuple[str, str]:
    body = (
        f'{_clip_open(el_id, o, "ov-anchor-lower")}'
        f'<div class="ov-box ov-lower" id="{el_id}_b">{_esc(o.text)}</div></div>')
    # LowerThird is opacity-only in the source (no translate).
    tl = (f'tl.from("#{el_id}_b", {{opacity:0, duration:{ENTER_DURATION_S}, '
          f'ease:"power1.out"}}, {o.start:.4f});')
    return body, tl


def _image(el_id: str, o: Overlay) -> tuple[str, str]:
    w = o.width_px or 240
    x = o.x_pct if o.x_pct is not None else 0.5
    y = o.y_pct if o.y_pct is not None else 0.12
    style = (f"position:absolute;left:{x*100:.2f}%;top:{y*100:.2f}%;"
             f"transform:translate(-50%,-50%);width:{w}px;height:auto;")
    body = (
        f'{_clip_open(el_id, o)}'
        f'<img class="ov-img" id="{el_id}_b" src="{_esc(o.src)}" style="{style}" '
        f'alt="{_esc(o.text)}" /></div>')
    tl = (f'tl.from("#{el_id}_b", {{scale:0.8, opacity:0, duration:{ENTER_DURATION_S}, '
          f'ease:"{ENTER_EASE}", transformOrigin:"center"}}, {o.start:.4f});')
    return body, tl


def _label(el_id: str, o: Overlay) -> tuple[str, str]:
    x = o.x_pct if o.x_pct is not None else 0.5
    y = o.y_pct if o.y_pct is not None else 0.5
    style = (f"position:absolute;left:{x*100:.2f}%;top:{y*100:.2f}%;"
             f"transform:translate(-50%,-50%);")
    body = (
        f'{_clip_open(el_id, o)}'
        f'<div class="ov-box ov-label" id="{el_id}_b" style="{style}">{_esc(o.text)}</div></div>')
    tl = (f'tl.from("#{el_id}_b", {{opacity:0, y:12, duration:{ENTER_DURATION_S}, '
          f'ease:"power2.out"}}, {o.start:.4f});')
    return body, tl


_RENDERERS = {"hook": _hook, "url": _url, "cta": _url, "lower": _lower,
              "image": _image, "logo": _image, "label": _label}


def contain_local_asset(src: str) -> str:
    """Validate that `src` is a job-local relative asset path and return it
    normalized. Rejects anything that could escape the composition dir or fetch
    over the network — the composition must be fully offline and self-contained.

    Rejects: URLs / protocol-relative (`//`) / `data:` / `file:`; absolute paths
    (leading `/` or a Windows drive); and any `..` traversal component.
    """
    if not src or not str(src).strip():
        raise OverlayValidationError(
            "image/logo overlay requires a non-empty local 'src'.")
    s = str(src).strip().replace("\\", "/")
    lowered = s.lower()
    if "://" in s or lowered.startswith(("http:", "https:", "data:", "file:")) \
            or s.startswith("//"):
        raise OverlayValidationError(
            f"overlay src {src!r} must be a job-local relative path, not a URL "
            "(the composition renders offline).")
    if s.startswith("/") or (len(s) > 1 and s[1] == ":"):
        raise OverlayValidationError(
            f"overlay src {src!r} must be relative to the composition dir, not "
            "an absolute path.")
    norm = posixpath.normpath(s)
    if norm == ".." or norm.startswith("../") or "/../" in norm:
        raise OverlayValidationError(
            f"overlay src {src!r} escapes the composition dir (contains '..').")
    return norm


def _require_number(d: dict, key: str, alias: str | None = None) -> float:
    """A required FINITE number. Non-finite (NaN/±Infinity) is rejected here so a
    bad start/end can't slip past the `< 0` / `<= start` comparisons (which are
    all False for NaN) and leak `nan`/`inf` into the clip's data-start/duration."""
    val = d.get(key, d.get(alias) if alias else None)
    try:
        return hs.finite_number(val, field=f"overlay {d.get('kind', '?')!r}: {key}")
    except hs.StyleValueError as e:
        raise OverlayValidationError(str(e))


def normalize_overlay(d: dict) -> Overlay:
    """Validate + accept the typed Overlay{kind,text,start,end} contract
    (schema.ts) plus the small extended fields. Tolerates start_sec/end_sec
    aliases used in style_directives.json. Raises OverlayValidationError with an
    actionable message on any bad field."""
    if "kind" not in d:
        raise OverlayValidationError("overlay is missing required field 'kind'.")
    kind = d["kind"]
    if kind not in _RENDERERS:
        raise OverlayValidationError(
            f"unknown overlay kind {kind!r}. Known: {sorted(_RENDERERS)}.")

    start = _require_number(d, "start", "start_sec")
    end = _require_number(d, "end", "end_sec")
    if start < 0 or end < 0:
        raise OverlayValidationError(
            f"overlay {kind!r}: start/end must be >= 0 (got {start}, {end}).")
    if end <= start:
        raise OverlayValidationError(
            f"overlay {kind!r}: end ({end}) must be greater than start ({start}).")

    text = d.get("text", "")
    src = d.get("src", "")
    if kind in _ASSET_KINDS:
        src = contain_local_asset(src)
    elif kind in _TEXT_KINDS and not str(text).strip():
        raise OverlayValidationError(
            f"overlay {kind!r}: requires non-empty 'text'.")

    try:
        track_index = int(d.get("track_index", 40))
    except (TypeError, ValueError):
        raise OverlayValidationError(
            f"overlay {kind!r}: track_index must be an integer, "
            f"got {d.get('track_index')!r}.")

    for pct_key in ("x_pct", "y_pct"):
        v = d.get(pct_key)
        if v is not None and not (0.0 <= float(v) <= 1.0):
            raise OverlayValidationError(
                f"overlay {kind!r}: {pct_key} must be in [0,1], got {v!r}.")
    width_px = d.get("width_px")
    if width_px is not None:
        try:
            wpx = hs.finite_number(width_px, field=f"overlay {kind!r}: width_px")
        except hs.StyleValueError as e:
            raise OverlayValidationError(str(e))
        if wpx != int(wpx) or wpx <= 0:
            raise OverlayValidationError(
                f"overlay {kind!r}: width_px must be a positive whole number, "
                f"got {width_px!r}.")

    return Overlay(
        kind=kind, start=start, end=end,
        text=text, src=src, track_index=track_index,
        x_pct=d.get("x_pct"), y_pct=d.get("y_pct"), width_px=width_px,
    )


# .ov-label font-size in OVERLAY_CSS — kept beside the footprint estimate below.
_LABEL_FONT_PX = 40
_IMAGE_DEFAULT_W = 240  # _image default width_px


def overlay_footprint(o: dict | Overlay, *, canvas_w: int = CANVAS_W,
                      canvas_h: int = CANVAS_H) -> tuple[int, int, int, int]:
    """Collision footprint (x, y, w, h) for an overlay, from its REAL render
    inputs — so every accepted overlay kind is checked against the red zones.

    Typed kinds (hook / url / cta / lower) use the SHARED overlay_bbox placement
    (the same rectangles the Remotion preflight uses; cta is a bottom pill like
    url). Positioned kinds (image / logo / label) derive their box from
    x_pct/y_pct + width_px/text, centred via the CSS `translate(-50%,-50%)`.
    There is NO 1x1 fallback: an image/logo/label previously collapsed to a 1x1
    point at centre and slipped past every red zone. An unhandled accepted kind
    raises rather than rendering un-checked."""
    o = o if isinstance(o, Overlay) else normalize_overlay(o)
    if o.kind == "hook":
        return overlay_bbox("hook", canvas_w, canvas_h)
    if o.kind == "lower":
        return overlay_bbox("lower", canvas_w, canvas_h)
    if o.kind in ("url", "cta"):
        return overlay_bbox("url", canvas_w, canvas_h)
    if o.kind in ("image", "logo"):
        w = int(o.width_px or _IMAGE_DEFAULT_W)
        h = w  # height:auto — real aspect unknown; a square is a defensible box
        cx = (o.x_pct if o.x_pct is not None else 0.5) * canvas_w
        cy = (o.y_pct if o.y_pct is not None else 0.12) * canvas_h
        return (round(cx - w / 2), round(cy - h / 2), w, h)
    if o.kind == "label":
        text = (o.text or "").strip()
        w = max(1, len(text)) * round(_LABEL_FONT_PX * 0.6) + 40  # glyphs + padding
        h = round(_LABEL_FONT_PX * 1.4) + 20
        cx = (o.x_pct if o.x_pct is not None else 0.5) * canvas_w
        cy = (o.y_pct if o.y_pct is not None else 0.5) * canvas_h
        return (round(cx - w / 2), round(cy - h / 2), w, h)
    raise OverlayValidationError(
        f"no layout footprint defined for overlay kind {o.kind!r}; add one to "
        "overlay_footprint so an accepted overlay cannot bypass the red-zone "
        "preflight.")


def render_overlays(overlays: list[dict | Overlay], *, id_prefix: str = "ov"
                    ) -> OverlayLayer:
    """Render an overlay list to (css, body, timeline_js). Overlays are emitted
    in ascending track_index so DOM order also reflects z-order (with explicit
    data-track-index as the authority the renderer uses)."""
    items = [o if isinstance(o, Overlay) else normalize_overlay(o) for o in overlays]
    items = sorted(enumerate(items), key=lambda p: (p[1].track_index, p[0]))
    body_parts, tl_parts = [], []
    for i, o in items:
        if o.kind not in _RENDERERS:
            raise ValueError(
                f"Unknown overlay kind {o.kind!r}. Known: {sorted(_RENDERERS)}")
        el_id = f"{id_prefix}{i}"
        b, tl = _RENDERERS[o.kind](el_id, o)
        body_parts.append(b)
        tl_parts.append(tl)
    return OverlayLayer(css=OVERLAY_CSS, body="\n".join(body_parts),
                        timeline_js="\n".join(tl_parts))


# Styling ported verbatim from Overlays.tsx (Hook/UrlPill/LowerThird).
OVERLAY_CSS = """.ov { position:absolute; inset:0; pointer-events:none;
  display:flex; align-items:center; justify-content:center; }
.ov-anchor-top { align-items:flex-start; justify-content:center; padding:200px 60px 0 60px; }
.ov-anchor-bottom { align-items:flex-end; justify-content:center; padding:0 0 80px 0; }
.ov-anchor-lower { align-items:flex-end; justify-content:center; padding:0 0 460px 0; }
.ov-box { font-family:"Inter", system-ui, sans-serif; }
.ov-hook { font-weight:900; font-size:72px; line-height:1.05; text-align:center;
  text-transform:uppercase; letter-spacing:-0.01em; color:#FFFFFF;
  background-color:rgba(0,0,0,0.86); padding:26px 32px; border-radius:18px;
  max-width:940px; box-shadow:0 12px 40px rgba(0,0,0,0.4); }
.ov-url { font-weight:800; font-size:60px; color:#000000; background-color:#FFD400;
  padding:20px 40px; border-radius:999px; letter-spacing:0.02em;
  box-shadow:0 8px 28px rgba(0,0,0,0.35); }
.ov-lower { font-weight:700; font-size:36px; color:#FFFFFF;
  background-color:rgba(0,0,0,0.7); padding:12px 22px; border-radius:8px;
  letter-spacing:0.01em; }
.ov-label { font-weight:700; font-size:40px; color:#0B0E17; background:#EEF2FF;
  padding:10px 20px; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,0.25); }
"""


def build_overlay_composition(overlays: list[dict | Overlay], *, width: int,
                              height: int, duration_s: float, fps: int = 30,
                              composition_id: str = "OverlayDemo",
                              bg_color: str = "#0B0E17") -> str:
    """Standalone overlay composition (index.html) for visual evidence — overlays
    over a solid background, offline runtime only."""
    layer = render_overlays(overlays)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={width}, height={height}" />
<script src="runtime/gsap.min.js"></script>
<link rel="stylesheet" href="runtime/fonts/fonts.css" />
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:{width}px; height:{height}px; overflow:hidden; background:{bg_color}; }}
{layer.css}
</style>
</head>
<body>
<div id="root" data-composition-id="{composition_id}" data-start="0"
     data-duration="{duration_s}" data-fps="{fps}"
     data-width="{width}" data-height="{height}">
{layer.body}
</div>
<script>
window.__timelines = window.__timelines || {{}};
var tl = gsap.timeline({{ paused: true }});
{layer.timeline_js}
window.__timelines["{composition_id}"] = tl;
</script>
</body>
</html>
"""
