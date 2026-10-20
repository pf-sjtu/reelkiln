"""
HyperFrames style-value validation — the boundary that keeps job-supplied
style/theme values safe wherever the composition generators interpolate them
(issue #112).

A HyperFrames composition is generated HTML: style/theme values from
`style_directives.json` (untrusted per CLAUDE.md — job JSON is material, not
code) land in three distinct destination contexts, each with a different escape
grammar:

  * inline `style="…"` attributes            (dataviz cards, overlay positions)
  * `<style>` stylesheet blocks              (caption CSS, bubble background)
  * `<script>` JS string / literal contexts  (GSAP `.set({color:"…"})`, count-up
                                              prefix/suffix in `hfFmt` args)

`html.escape()` is correct for HTML *text* (the caption words, the stat label —
those stay escaped where they are) but WRONG for CSS and JS: an entity like
`&quot;` is HTML-decoded back to `"` before the CSS/JS parser ever sees it, so it
does not neutralise a `</style>`/`</script>` break-out or a `"`-closed JS string.

The robust move for the *constrained* fields (colors, font families, CSS
lengths) is to validate them against the grammar they are supposed to be. A
value that matches a strict colour/font grammar contains none of
`< > " ' { } ; \\` — so ONE validated value is simultaneously safe in an
attribute, a stylesheet and a JS string literal. Malformed input is rejected
with an actionable `StyleValueError` rather than silently sanitised into
something that renders wrong.

Genuinely free-text fields (a stat's `prefix`/`suffix`, e.g. "$", "%") can't be
grammar-constrained, so they are context-*encoded* for JS instead: `js_embed`
JSON-encodes and additionally escapes `< > &` so the payload can never terminate
the surrounding `<script>` element.

Used by hyperframes_captions / hyperframes_dataviz. Leaf module (stdlib only).
"""

from __future__ import annotations

import json
import math
import re

__all__ = [
    "StyleValueError", "css_color", "font_family", "css_length",
    "finite_number", "js_embed",
]


class StyleValueError(ValueError):
    """A job-supplied style/theme value is unsafe or malformed for the context it
    would be interpolated into. The message names the field and the accepted
    contract so a bad style_directives value fails clearly at compose time rather
    than producing a broken or context-breaking composition."""


# ── Colour ───────────────────────────────────────────────────────────────────
# These colours are interpolated into inline style attrs, <style> blocks AND
# JS string literals (`tl.set(..., {color:"…"})`), so the grammars must exclude
# EVERY character that could break any of those contexts — not only quotes /
# angle-brackets / braces / semicolons, but also line terminators (\n \r,
# U+2028, U+2029) and other whitespace/control chars that are legal-ish in CSS
# but terminate a JS string. Each rule is therefore an explicit ALLOWLIST.
#
# #rgb / #rgba / #rrggbb / #rrggbbaa
_HEX_RE = re.compile(r"#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\Z")
# rgb()/rgba()/hsl()/hsla() — interior restricted to the characters that legally
# appear in that notation (digits, unit/keyword letters, `.` `,` `%` `/` and a
# LITERAL space). No newline/tab/other whitespace, so the value is JS-safe.
_FUNC_RE = re.compile(r"(?:rgba?|hsla?)\([0-9a-zA-Z.,%/ ]*\)\Z", re.IGNORECASE)
# A named colour / keyword (transparent, currentColor, white, …). Letters only —
# an unknown name renders inert, never breaks out.
_NAMED_RE = re.compile(r"[A-Za-z]+\Z")


def css_color(value, *, field: str) -> str:
    """Validate a CSS colour and return it unchanged. Accepts hex (3/4/6/8),
    rgb/rgba/hsl/hsla(), and keyword/named colours.

    The value is reused verbatim across CSS *and* generated JavaScript, so the
    accepted grammar excludes every character that could break either: quotes,
    angle brackets, braces, semicolons, and all line terminators / control chars
    (a `\\n`/`\\r`/U+2028 inside e.g. `rgba(…)` would terminate the JS string it
    lands in). A validated colour is therefore safe in ALL contexts with no
    further escaping. Malformed → StyleValueError."""
    if not isinstance(value, str):
        raise StyleValueError(
            f"{field} colour must be a string, got {type(value).__name__} "
            f"({value!r}).")
    v = value.strip()
    if _HEX_RE.match(v) or _FUNC_RE.match(v) or _NAMED_RE.match(v):
        return v
    raise StyleValueError(
        f"{field} colour {value!r} is not an accepted CSS colour. Use a hex "
        "(#RGB/#RGBA/#RRGGBB/#RRGGBBAA), rgb()/rgba()/hsl()/hsla(), or a colour "
        "keyword. Quotes, angle brackets, braces, semicolons and line "
        "terminators are rejected.")


# ── Font family ──────────────────────────────────────────────────────────────
# A single family token: letters, digits, spaces, hyphens (e.g. "JetBrains Mono",
# "Playfair Display Italic", "DePixelKlein"). The generators add the fallback
# stack themselves, so a comma-list is neither needed nor accepted.
_FONT_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _-]*\Z")


def font_family(value, *, field: str) -> str:
    """Validate a single font-family name (no quotes, no fallback list) and
    return it unchanged. The caller wraps it in quotes + a fallback stack, so a
    name carrying a `'`/`"`/`<`/`;` would break out of the CSS `font-family`
    string; those are rejected."""
    if not isinstance(value, str):
        raise StyleValueError(
            f"{field} font family must be a string, got "
            f"{type(value).__name__} ({value!r}).")
    v = value.strip()
    if _FONT_RE.match(v):
        return v
    raise StyleValueError(
        f"{field} font family {value!r} is not accepted. Use a single family "
        "name of letters, digits, spaces and hyphens (the renderer adds the "
        "fallback stack); quotes and punctuation are rejected.")


# ── CSS length ───────────────────────────────────────────────────────────────
_LENGTH_RE = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|ex|ch|%|vw|vh)?\Z")


def css_length(value, *, field: str) -> str:
    """Validate a CSS length used verbatim in a stylesheet (e.g. letter_spacing
    "-0.005em", "1.5px", "0"). Accepts a signed number with an optional length
    unit, or the keyword "normal". Returns a canonical string."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise StyleValueError(f"{field} must be a finite length, got {value!r}.")
        return str(value)
    if isinstance(value, str):
        v = value.strip()
        if v == "normal" or _LENGTH_RE.match(v):
            return v
    raise StyleValueError(
        f"{field} {value!r} is not a valid CSS length. Use a number with an "
        "optional unit (px/em/rem/%/…) or 'normal'.")


def finite_number(value, *, field: str) -> float:
    """A finite real number (rejects bool, NaN, ±Infinity, non-numeric). Used
    for values interpolated raw into CSS/JS (weights, ratios, line-height) so a
    NaN/Infinity can never reach the generated stylesheet or timeline."""
    if isinstance(value, bool):
        raise StyleValueError(f"{field} must be a number, got a boolean.")
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise StyleValueError(f"{field} must be a number, got {value!r}.")
    if not math.isfinite(n):
        raise StyleValueError(f"{field} must be finite, got {value!r}.")
    return n


# ── JS embedding (free-text values) ──────────────────────────────────────────
def js_embed(obj) -> str:
    """JSON-encode `obj` for embedding inside a `<script>` element, additionally
    escaping `< > &` as unicode escapes so the payload can never terminate the
    script element (`</script>`) or open a comment (`<!--`). Use for free-text
    values (a stat's prefix/suffix) that can't be grammar-constrained."""
    return (json.dumps(obj)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026"))
