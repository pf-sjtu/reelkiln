"""
HyperFrames dataviz — animated stat / bar / compare primitives for the
HyperFrames render (issue #112), porting `remotion/src/dataviz.tsx`.

Contract is unchanged: the same `DataVizItem{kind:"stat"|"bar"|"compare", start,
end, value/label/series, theme, position}` (schema.ts DataVizSchema) that
`compose_render` emits and `Captioned.tsx` renders. This produces the equivalent
HyperFrames layer.

Motion is mandatory (the [static-motion] design law): every primitive animates
on. The Remotion springs become GSAP eases:
  * count-up (Remotion spring damping:200,stiffness:60 → heavily damped, no
    overshoot) → `power2.out` proxy tween whose onUpdate writes the formatted
    number (seek-safe: GSAP interpolates the proxy on every seeked frame).
  * bar grow-in (spring damping:20,stiffness:140, mild overshoot, staggered 4
    frames) → `power3.out` width tween, staggered by index.
  * card pop (useEnter spring) → `back.out(1.4)` scale.
Number formatting uses the browser's `toLocaleString`, matching dataviz.tsx `fmt`.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field

import hyperframes_style as hs

# DEFAULT_THEME from dataviz.tsx.
DEFAULT_THEME = {
    "font_family": "Inter",
    "color": "#14141A",
    "accent": "#2DD4BF",
    "bg": "#FFFFFF",
    "text_color": "#4A4A55",
    "radius": 28,
}

# Compare default bar colors (dataviz.tsx ComparisonBar).
COMPARE_COLORS = ["#94A3B8", None]  # second falls back to theme accent

# Stagger + durations (approximating the Remotion springs).
BAR_STAGGER_S = 4 / 30.0      # 4 frames @ 30fps
GROW_DURATION_S = 0.6
COUNT_DURATION_S = 0.9
POP_DURATION_S = 0.4

# Browser-side number formatter — mirrors dataviz.tsx `fmt` (toLocaleString).
FMT_JS = """
function hfFmt(n, decimals, prefix, suffix) {
  return (prefix||"") + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals||0, maximumFractionDigits: decimals||0
  }) + (suffix||"");
}
""".strip()


@dataclass
class DataVizLayer:
    css: str
    body: str
    timeline_js: str
    needs_fmt_js: bool = True
    theme: dict = field(default_factory=dict)


# Theme keys interpolated into CSS colour positions — validated against the CSS
# colour grammar so a job-supplied value can't break out of a style attribute,
# a <style> block or the GSAP JS. `bg` may be explicit null (transparent card).
_THEME_COLOR_KEYS = ("color", "accent", "bg", "text_color")


def resolve_theme(theme: dict | None) -> dict:
    out = dict(DEFAULT_THEME)
    if theme:
        for k, v in theme.items():
            if k == "bg":
                out["bg"] = v  # explicit null allowed (transparent)
            elif v is not None:
                out[k] = v
    # Validate the interpolated style values (colours land in inline style attrs,
    # <style> and JS; font-family is quoted in the card CSS). Malformed → reject.
    for k in _THEME_COLOR_KEYS:
        if out.get(k) is not None:
            out[k] = hs.css_color(out[k], field=f"dataviz theme.{k}")
    out["font_family"] = hs.font_family(out["font_family"], field="dataviz theme.font_family")
    out["radius"] = hs.finite_number(out["radius"], field="dataviz theme.radius")
    return out


def _fmt(n: float, decimals: int = 0, prefix: str = "", suffix: str = "") -> str:
    return f"{prefix}{n:,.{decimals}f}{suffix}"


def _autofit_font(final_str: str) -> int:
    # dataviz.tsx: min(176, floor(780 / (max(3,len)*0.62)))
    return min(176, int(780 / (max(3, len(final_str)) * 0.62)))


# ── Shared dataviz position model ────────────────────────────────────────────
# Single source of truth for WHERE a dataviz card sits, used by BOTH the render
# CSS (_POS_PAD below) and the layout preflight footprint (hyperframes_layout.
# dataviz_rect derives its rectangle from card_footprint). Keeping the CSS and
# the collision rect off the same numbers means the two cannot drift.
#
# The card is a fixed-ratio box; each position pins one edge with an absolute px
# offset on the portrait canvas:
#   top          → card top   pad_top px from the top
#   center       → vertically centered
#   lower-third  → card bottom pad_bottom px from the bottom
#   bottom       → card bottom pad_bottom px from the bottom
CARD_W_RATIO = 0.74
CARD_H_RATIO = 0.26
POSITION_OFFSETS: dict[str, dict[str, int]] = {
    "top": {"pad_top": 220},
    "center": {},
    "lower-third": {"pad_bottom": 520},
    "bottom": {"pad_bottom": 140},
}
DATAVIZ_POSITIONS = tuple(POSITION_OFFSETS)
DEFAULT_POSITION = "center"


def resolve_position(position: str | None) -> str:
    """Missing position defaults to center. Unknown values are the caller's to
    reject (the compositor raises InputError); here they resolve to center as a
    last-resort so the renderer never crashes on an unvalidated string."""
    return position if position in POSITION_OFFSETS else DEFAULT_POSITION


def card_footprint(position: str | None, canvas_w: int, canvas_h: int
                   ) -> tuple[int, int, int, int]:
    """The (x, y, w, h) footprint of a dataviz card at `position` — the exact box
    the render CSS paints, so preflight checks the real placement."""
    card_w = int(canvas_w * CARD_W_RATIO)
    card_h = int(canvas_h * CARD_H_RATIO)
    x = (canvas_w - card_w) // 2
    off = POSITION_OFFSETS[resolve_position(position)]
    if "pad_top" in off:
        y = off["pad_top"]
    elif "pad_bottom" in off:
        y = canvas_h - off["pad_bottom"] - card_h
    else:
        y = (canvas_h - card_h) // 2
    return (x, y, card_w, card_h)


def _pos_css(position: str) -> str:
    off = POSITION_OFFSETS[position]
    if "pad_top" in off:
        return f"justify-content:flex-start;padding-top:{off['pad_top']}px;"
    if "pad_bottom" in off:
        return f"justify-content:flex-end;padding-bottom:{off['pad_bottom']}px;"
    return "justify-content:center;"


# Derived from POSITION_OFFSETS so the CSS shares the preflight numbers.
_POS_PAD = {p: _pos_css(p) for p in POSITION_OFFSETS}


def _wrap_open(el_id: str, start: float, end: float, position: str,
               track_index: int) -> str:
    dur = max(0.001, end - start)
    pos = _POS_PAD.get(position or "center", _POS_PAD["center"])
    return (f'<div class="clip dv" id="{el_id}" data-start="{start:.4f}" '
            f'data-duration="{dur:.4f}" data-track-index="{track_index}">'
            f'<div class="dv-wrap" style="align-items:center;padding-left:70px;'
            f'padding-right:70px;{pos}">')


def _card_style(th: dict) -> str:
    if th["bg"]:
        return (f"font-family:'{th['font_family']}';background:{th['bg']};"
                f"border-radius:{th['radius']}px;padding:48px 56px;"
                f"box-shadow:0 18px 60px rgba(0,0,0,0.28);display:flex;"
                f"flex-direction:column;align-items:center;max-width:900px;")
    return (f"font-family:'{th['font_family']}';background:transparent;"
            f"padding:0;display:flex;flex-direction:column;align-items:center;"
            f"max-width:900px;")


def _stat(el_id: str, item: dict, th: dict) -> tuple[str, str]:
    value = hs.finite_number(item.get("value", 0), field="dataviz stat.value")
    decimals = int(item.get("decimals", 0))
    prefix = item.get("prefix", "")
    suffix = item.get("suffix", "")
    label = item.get("label")
    start = float(item["start"])
    final_str = _fmt(value, decimals, prefix, suffix)
    fs = _autofit_font(final_str)
    num_style = (f"font-weight:900;font-size:{fs}px;line-height:1;"
                 f"letter-spacing:-0.03em;color:{th['color']};"
                 f"font-variant-numeric:tabular-nums;")
    label_html = (f'<div style="margin-top:18px;font-weight:600;font-size:42px;'
                  f'color:{th["text_color"]};text-align:center;">{html.escape(label)}</div>'
                  if label else "")
    body = (
        f'{_wrap_open(el_id, start, float(item["end"]), item.get("position", "center"), item.get("track_index", 35))}'
        f'<div class="dv-card" id="{el_id}_card" style="{_card_style(th)}">'
        f'<div id="{el_id}_num" style="{num_style}">{html.escape(_fmt(0, decimals, prefix, suffix))}</div>'
        f'{label_html}</div></div></div>')
    args = hs.js_embed([decimals, prefix, suffix])
    tl = (
        f'tl.from("#{el_id}_card", {{scale:0.9, duration:{POP_DURATION_S}, '
        f'ease:"back.out(1.4)", transformOrigin:"center"}}, {start:.4f});\n'
        f'var {el_id}_p = {{v:0}};\n'
        f'tl.to({el_id}_p, {{v:{value}, duration:{COUNT_DURATION_S}, ease:"power2.out", '
        f'onUpdate:function(){{var a={args};document.getElementById("{el_id}_num").textContent='
        f'hfFmt({el_id}_p.v,a[0],a[1],a[2]);}}}}, {start:.4f});')
    return body, tl


def _bars(el_id: str, item: dict, th: dict, *, compare: bool) -> tuple[str, str]:
    series = list(item.get("series", []))
    if compare:
        series = series[:2]
        for i, d in enumerate(series):
            if not d.get("color"):
                d = dict(d)
                d["color"] = COMPARE_COLORS[0] if i == 0 else th["accent"]
                series[i] = d
    # Validate any explicit series colour (lands in an inline style attr).
    for d in series:
        if d.get("color"):
            hs.css_color(d["color"], field="dataviz series.color")
    decimals = int(item.get("decimals", 0))
    suffix = item.get("suffix", "")
    start = float(item["start"])
    for d in series:
        hs.finite_number(d.get("value"), field="dataviz series.value")
    max_value = max([float(d["value"]) for d in series] + [1.0])

    rows, tl_parts = [], []
    tl_parts.append(
        f'tl.from("#{el_id}_card", {{scale:0.94, duration:{POP_DURATION_S}, '
        f'ease:"back.out(1.4)", transformOrigin:"center"}}, {start:.4f});')
    for i, d in enumerate(series):
        pct = (float(d["value"]) / max_value) * 100.0
        color = d.get("color") or th["accent"]
        rows.append(
            f'<div style="width:100%;margin-bottom:26px;">'
            f'<div style="display:flex;justify-content:space-between;font-size:38px;'
            f'font-weight:700;color:{th["text_color"]};margin-bottom:10px;">'
            f'<span>{html.escape(str(d["label"]))}</span>'
            f'<span id="{el_id}_v{i}" style="color:{th["color"]};font-variant-numeric:tabular-nums;">'
            f'{html.escape(_fmt(0, decimals, "", suffix))}</span></div>'
            f'<div style="height:46px;border-radius:999px;background:rgba(0,0,0,0.08);">'
            f'<div id="{el_id}_f{i}" style="width:0%;height:100%;border-radius:999px;'
            f'background:{color};"></div></div></div>')
        at = start + i * BAR_STAGGER_S
        args = hs.js_embed([decimals, "", suffix])
        tl_parts.append(
            f'tl.to("#{el_id}_f{i}", {{width:"{pct:.3f}%", duration:{GROW_DURATION_S}, '
            f'ease:"power3.out"}}, {at:.4f});')
        tl_parts.append(
            f'var {el_id}_p{i} = {{v:0}};\n'
            f'tl.to({el_id}_p{i}, {{v:{float(d["value"])}, duration:{GROW_DURATION_S}, '
            f'ease:"power3.out", onUpdate:function(){{var a={args};'
            f'document.getElementById("{el_id}_v{i}").textContent='
            f'hfFmt({el_id}_p{i}.v,a[0],a[1],a[2]);}}}}, {at:.4f});')
    body = (
        f'{_wrap_open(el_id, start, float(item["end"]), item.get("position", "center"), item.get("track_index", 35))}'
        f'<div class="dv-card" id="{el_id}_card" style="{_card_style(th)}width:900px;">'
        f'{"".join(rows)}</div></div></div>')
    return body, "\n".join(tl_parts)


def render_dataviz(items: list[dict], *, id_prefix: str = "dv",
                   track_index: int = 35) -> DataVizLayer:
    """Render a dataviz item list to (css, body, timeline_js). Item kinds:
    stat / bar / compare — the exact DataVizSchema contract.

    `track_index` is the default z-order track for items that don't set their
    own (the compositor places dataviz BELOW captions; see
    hyperframes_compose.TRACK_DATAVIZ)."""
    body_parts, tl_parts = [], []
    for i, item in enumerate(items):
        item = {**item, "track_index": item.get("track_index", track_index)}
        kind = item.get("kind")
        th = resolve_theme(item.get("theme"))
        el_id = f"{id_prefix}{i}"
        if kind == "stat":
            b, tl = _stat(el_id, item, th)
        elif kind == "bar":
            b, tl = _bars(el_id, item, th, compare=False)
        elif kind == "compare":
            b, tl = _bars(el_id, item, th, compare=True)
        else:
            raise ValueError(
                f"Unknown dataviz kind {kind!r}. Known: stat, bar, compare.")
        body_parts.append(b)
        tl_parts.append(tl)
    return DataVizLayer(css=DATAVIZ_CSS, body="\n".join(body_parts),
                        timeline_js="\n".join(tl_parts))


DATAVIZ_CSS = """.dv { position:absolute; inset:0; pointer-events:none; }
.dv-wrap { position:absolute; inset:0; display:flex; }
"""


def build_dataviz_composition(items: list[dict], *, width: int, height: int,
                              duration_s: float, fps: int = 30,
                              composition_id: str = "DataVizDemo",
                              bg_color: str = "#0B0E17") -> str:
    """Standalone dataviz composition (index.html) for visual evidence."""
    layer = render_dataviz(items)
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
{FMT_JS}
window.__timelines = window.__timelines || {{}};
var tl = gsap.timeline({{ paused: true }});
{layer.timeline_js}
window.__timelines["{composition_id}"] = tl;
</script>
</body>
</html>
"""
