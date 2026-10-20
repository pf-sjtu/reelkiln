"""
HyperFrames caption layer — word-timed captions for the HyperFrames render path
(issue #112), reproducing the shipping Remotion caption system
(`remotion/src/Captioned.tsx` + `CaptionPage.tsx` + `caption_presets.json`)
without any `@remotion/*` dependency.

Why this exists
---------------
Captions are the highest-risk surface in a Remotion → HyperFrames migration: the
active-word highlight must land on the exact transcript timestamp, page
transitions must fire at the same time, and — because HyperFrames seeks a paused
timeline frame-by-frame — the whole thing must be **deterministic under a direct
seek**, not driven by wall-clock CSS animation.

This module ports the three load-bearing pieces:

1. **Paging** — a faithful Python port of `@remotion/captions`
   `createTikTokStyleCaptions` (see `remotion/node_modules/@remotion/captions/
   dist/create-tiktok-style-captions.js`) plus the sentence-split that
   `Captioned.tsx` layers on top. Reproducing it here *removes* the
   `@remotion/captions` dependency — one of the licensed packages #112 exists to
   escape.
2. **Active-word timing** — the exact `CaptionPage.tsx` predicate
   `token.fromMs <= t < token.toMs`, expressed as GSAP `.set()` calls at absolute
   transcript times so a seek to time T reproduces the same active word every
   render.
3. **Presets** — resolves the 7 named presets in `caption_presets.json` (+ inline
   overrides) to CSS, matching `CaptionPage.tsx` styling (colour vs box highlight,
   outline guardrails, vertical placement).

The functions are pure and unit-tested (`tests/test_hyperframes_captions.py`);
the HTML/JS generators are consumed by `tools/hyperframes_compose.py` and by the
caption example composition used for visual evidence.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import hyperframes_style as hs
from job_inputs import VALID_CAPTION_TRANSFORMS

REPO_ROOT = Path(__file__).resolve().parent.parent
CAPTION_PRESETS_PATH = REPO_ROOT / "remotion" / "src" / "caption_presets.json"

# Matches DEFAULT_SWITCH_CAPTIONS_EVERY_MS in Captioned.tsx.
DEFAULT_SWITCH_MS = 1100

# CaptionPage.tsx DEFAULTS (the values applied when a preset omits a field).
DEFAULTS = {
    "active_word_color": "#96cade",
    "color": "#FFFFFF",
    "outline_color": None,          # auto from text luma when unset
    "outline_width_px": 3,
    "weight": 800,
    "position": "lower-third",
    "vertical_anchor_ratio": 0.65,
    "transform": "uppercase",
    "font_size_ratio": 0.028,
    "highlight_mode": "color",
    "active_word_text_color": "#14141A",
    "letter_spacing": "-0.01em",
    "line_height": 1.18,
}

MIN_OUTLINE_WIDTH_PX_NO_PILL = 4
MIN_OUTLINE_WIDTH_PX_FONT_SIZE_RATIO = 0.055

# CaptionPage.tsx SENTENCE_END.
SENTENCE_END = re.compile(r"[.?!]\s*$|—\s*$")

# Font families the frozen local runtime can serve offline (hyperframes/runtime/
# fonts). Presets asking for anything else are reported, not silently swapped.
RUNTIME_FONTS = {"Inter", "JetBrains Mono"}

# The system fallback stack a browser drops to when a family is unavailable —
# named explicitly so a font-fallback evaluation run can record what actually
# rendered instead of claiming the requested family's fidelity.
SYSTEM_FALLBACK_FAMILY = "system-ui, sans-serif"

# Emphasis (italic-marked word) defaults — mirror CaptionPage.tsx exactly:
#   emphasis_size_multiplier default 1.18, emphasis_transform default "none",
#   fontWeight 700, letterSpacing 0.005em, and the DEFAULT emphasis family is the
#   Editorial-palette serif (Playfair Display Italic) — which is NOT in the frozen
#   runtime, so emphasis without an available emphasis_font_family is rejected by
#   the font-availability gate (never silently browser-fallback-rendered).
EMPHASIS_DEFAULT_FAMILY = "Playfair Display Italic"
EMPHASIS_DEFAULT_SIZE_MUL = 1.18
EMPHASIS_DEFAULT_TRANSFORM = "none"
EMPHASIS_TOLERANCE_MS = 2.0  # CaptionPage.tsx: |ms - token.fromMs| < 2


# ---------------------------------------------------------------------------
# Word / token ingestion
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Token:
    """One timed caption token. Times in milliseconds, absolute (transcript).

    Kept as float, not int: Captioned.tsx carries `t.start * 1000` unrounded, so
    a transcript time like 0.1234s stays 123.4ms here too. Rounding to int would
    introduce up to 0.5ms of drift the shipping Remotion path never has."""
    text: str
    from_ms: float
    to_ms: float


@dataclass
class Page:
    """One caption page: the words shown together, and its schedule."""
    tokens: list[Token]
    start_ms: float
    duration_ms: float  # may be float('inf') mid-build; finalized before scheduling

    @property
    def end_ms(self) -> float:
        return self.start_ms + self.duration_ms

    @property
    def text(self) -> str:
        return "".join(t.text for t in self.tokens).strip()


def normalize_words(words: list[dict]) -> list[dict]:
    """Accept the transcript.json `words[]` shape and tolerate `w.text` as an
    alias for `w.word` (the Remotion renderer does the same)."""
    out = []
    for w in words:
        word = w.get("word", w.get("text"))
        if word is None:
            continue
        # Transcript times are the single ingestion chokepoint — require finite so
        # a NaN/inf can't slip past the paging/schedule comparisons (all False for
        # NaN) and leak `nan`/`inf` into data-start/duration and the GSAP sets.
        out.append({"word": str(word),
                    "start": hs.finite_number(w["start"], field="transcript word.start"),
                    "end": hs.finite_number(w["end"], field="transcript word.end")})
    return out


def tokens_to_captions(words: list[dict]) -> list[dict]:
    """Port of `tokensToCaptions` in Captioned.tsx: each word becomes a caption
    whose text is space-prefixed except the first, with ms bounds."""
    caps = []
    for i, w in enumerate(words):
        text = ("" if i == 0 else " ") + w["word"]
        caps.append({
            "text": text,
            "startMs": w["start"] * 1000.0,
            "endMs": w["end"] * 1000.0,
        })
    return caps


# ---------------------------------------------------------------------------
# Paging — faithful port of @remotion/captions createTikTokStyleCaptions
# ---------------------------------------------------------------------------
def create_tiktok_style_captions(captions: list[dict],
                                 combine_within_ms: int) -> list[Page]:
    """Line-for-line port of `createTikTokStyleCaptions`
    (remotion/node_modules/@remotion/captions/dist/create-tiktok-style-captions.js).

    A page accumulates tokens until a space-prefixed token arrives AND the page
    already spans more than `combine_within_ms`; then the page flushes and the
    new token starts the next page. Page durationMs is back-filled from the next
    page's start (last page from its own final token).
    """
    pages: list[Page] = []
    current_text = ""
    current_tokens: list[Token] = []
    current_from = 0.0
    current_to = 0.0

    def add():
        pages.append(Page(tokens=list(current_tokens),
                          start_ms=current_from, duration_ms=float("inf")))
        if len(pages) > 1:
            pages[-2].duration_ms = current_from - pages[-2].start_ms

    n = len(captions)
    for index, item in enumerate(captions):
        text = item["text"]
        if text.startswith(" ") and current_to - current_from > combine_within_ms:
            if current_text != "":
                add()
            current_text = text.lstrip()
            current_tokens = [Token(current_text, item["startMs"], item["endMs"])] \
                if current_text != "" else []
            current_from = item["startMs"]
            current_to = item["endMs"]
        else:
            if current_text == "":
                current_from = item["startMs"]
            current_text += text
            current_text = current_text.lstrip()
            if text.strip() != "":
                tok_text = current_text.lstrip() if len(current_tokens) == 0 else text
                current_tokens.append(Token(tok_text, item["startMs"], item["endMs"]))
            current_to = item["endMs"]
        if index == n - 1 and current_text != "":
            add()
            pages[-1].duration_ms = current_to - pages[-1].start_ms
    return pages


def _split_page_on_sentences(page: Page) -> list[Page]:
    """Break a page into sub-pages at sentence-ending punctuation, mirroring the
    `break_on_sentence` re-split in Captioned.tsx. Each sub-page's start/duration
    are recomputed from its own tokens."""
    subs: list[list[Token]] = []
    cur: list[Token] = []
    for tok in page.tokens:
        cur.append(tok)
        if SENTENCE_END.search(tok.text):
            subs.append(cur)
            cur = []
    if cur:
        subs.append(cur)
    out = []
    for sub in subs:
        if not sub:
            continue
        start = sub[0].from_ms
        dur = sub[-1].to_ms - start
        out.append(Page(tokens=sub, start_ms=start, duration_ms=dur))
    return out


def _coalesce_simultaneous_pages(pages: list[Page]) -> list[Page]:
    """Merge consecutive pages that start at the same (or an earlier) ms so no
    page is left with a zero-length schedule window.

    Two transcript words with an identical `start` split — after the sentence
    re-split — into two pages at the SAME start_ms. `schedule` sets each page's
    end to the next page's start, so the earlier of two same-start pages gets a
    zero-length window and its words vanish from the render entirely (the bug in
    #112: `[("Hi.",1.0,1.5),("Yo.",1.0,1.4),…]` dropped "Hi."). Sequential pages
    at one instant are un-showable one-after-another, so the earlier page's tokens
    are carried onto the page it coincides with (append, order preserved, earliest
    start kept). This deterministically preserves every spoken word; it diverges
    from Remotion's silent `<Sequence durationInFrames={0}>` drop ON PURPOSE — the
    contract is "never lose spoken text", and parity holds for every well-formed
    (strictly increasing) transcript."""
    merged: list[Page] = []
    for p in pages:
        if merged and p.start_ms <= merged[-1].start_ms:
            prev = merged[-1]
            prev.tokens = prev.tokens + list(p.tokens)
            prev.start_ms = min(prev.start_ms, p.start_ms)
            prev.duration_ms = max(prev.end_ms, p.end_ms) - prev.start_ms
        else:
            merged.append(Page(tokens=list(p.tokens), start_ms=p.start_ms,
                               duration_ms=p.duration_ms))
    return merged


def build_pages(words: list[dict], *, switch_ms: int = DEFAULT_SWITCH_MS,
                break_on_sentence: bool = True) -> list[Page]:
    """Full paging pipeline: words → captions → tiktok pages → optional
    sentence-split → coalesce same-start pages. Returns pages in schedule order,
    with strictly increasing start_ms so no page is silently dropped."""
    words = normalize_words(words)
    if not words:
        return []
    caps = tokens_to_captions(words)
    pages = create_tiktok_style_captions(caps, switch_ms)
    if break_on_sentence:
        split: list[Page] = []
        for p in pages:
            split.extend(_split_page_on_sentences(p))
        pages = split
    return _coalesce_simultaneous_pages(pages)


def schedule(pages: list[Page], *, switch_ms: int = DEFAULT_SWITCH_MS) -> list[dict]:
    """Compute each page's on-screen window, matching Captioned.tsx:
      startFrame = page.startMs/1000*fps
      endFrame   = min(nextPageStart, startFrame + switch_ms)
    Returned in seconds so it maps to HyperFrames `data-start`/`data-duration`.
    Pages with a non-positive window are dropped (as the Remotion `<Sequence>` is).
    """
    out = []
    for i, p in enumerate(pages):
        start_ms = p.start_ms
        next_start = pages[i + 1].start_ms if i + 1 < len(pages) else float("inf")
        end_ms = min(next_start, start_ms + switch_ms)
        if end_ms - start_ms <= 0:
            continue
        out.append({
            "page": p,
            "start_s": start_ms / 1000.0,
            "duration_s": (end_ms - start_ms) / 1000.0,
            "end_s": end_ms / 1000.0,
        })
    return out


def active_token_index(page: Page, absolute_time_ms: float) -> int | None:
    """The active token at a given absolute time — the exact CaptionPage.tsx
    predicate `token.fromMs <= t < token.toMs`. Returns the token index, or None
    if no token is active (a gap/pause)."""
    for i, tok in enumerate(page.tokens):
        if tok.from_ms <= absolute_time_ms < tok.to_ms:
            return i
    return None


# ---------------------------------------------------------------------------
# Preset resolution
# ---------------------------------------------------------------------------
def load_presets(path: Path | None = None) -> dict:
    return json.loads((path or CAPTION_PRESETS_PATH).read_text())


def resolve_style(*, preset: str | None = None, overrides: dict | None = None,
                  presets_path: Path | None = None) -> dict:
    """Resolve a caption style: named preset (from caption_presets.json) merged
    with inline overrides, then DEFAULTS for anything still unset. Raises on an
    unknown preset name (compose_render hard-errors the same way — no silent
    default)."""
    style: dict = {}
    if preset is not None:
        presets = load_presets(presets_path)
        if preset not in presets:
            raise KeyError(
                f"Unknown caption preset {preset!r}. Known: {sorted(presets)}")
        style.update(presets[preset])
    if overrides:
        style.update({k: v for k, v in overrides.items() if v is not None})
    return style


def font_is_available(family: str) -> bool:
    """True if the frozen local runtime can serve this family offline."""
    return family in RUNTIME_FONTS


def preset_font_status(presets_path: Path | None = None) -> dict[str, dict]:
    """For each preset: its font family and whether the frozen local runtime can
    serve it offline. Used to report which presets render as-is vs need font
    provisioning (never silently omitted)."""
    presets = load_presets(presets_path)
    out = {}
    for name, style in presets.items():
        fam = style.get("font_family", "Inter")
        out[name] = {"font_family": fam, "runtime_available": font_is_available(fam)}
    return out


def fonts_in_style(style: dict) -> list[tuple[str, str]]:
    """The (role, family) fonts a resolved caption style will actually request:
    the caption body font, and — only when the style marks emphasis words
    (`italic_word_starts_ms`) — the emphasis font (explicit `emphasis_font_family`
    or the Editorial default). Roles: "caption" / "emphasis"."""
    out = [("caption", style.get("font_family", "Inter"))]
    if style.get("italic_word_starts_ms"):
        out.append(("emphasis",
                    style.get("emphasis_font_family") or EMPHASIS_DEFAULT_FAMILY))
    return out


def missing_runtime_fonts(style: dict) -> list[tuple[str, str]]:
    """The (role, family) fonts in a style that the frozen runtime CANNOT serve
    offline. Empty = every requested font is available. The compositor uses this
    to fail loudly (or, under an explicit fallback opt-in, warn) rather than let
    the browser silently substitute a system font and void preset fidelity."""
    return [(role, fam) for role, fam in fonts_in_style(style)
            if not font_is_available(fam)]


# ---------------------------------------------------------------------------
# HTML / GSAP generation
# ---------------------------------------------------------------------------
def _luma(hex_color: str) -> float:
    m = re.match(r"^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$", hex_color.strip(), re.I)
    if not m:
        return 200.0
    r, g, b = (int(m.group(i), 16) for i in (1, 2, 3))
    return 0.299 * r + 0.587 * g + 0.114 * b


@dataclass
class CaptionLayer:
    """Rendered fragments for the caption layer, ready to splice into a
    composition: CSS, the page/word DOM, and the GSAP timeline statements."""
    css: str
    body: str
    timeline_js: str
    dropped_pages: int = 0
    style: dict = field(default_factory=dict)


def _parse_hide_ranges_ms(raw) -> list[tuple[float, float]]:
    """Normalize a `hide_ranges_ms` value ([[startMs, endMs], ...]) into sorted,
    merged (start, end) pairs. Invalid/empty/non-positive pairs are dropped;
    overlapping or touching ranges are merged so the visibility toggle stays
    consistent under a direct seek."""
    if not raw:
        return []
    ranges: list[tuple[float, float]] = []
    for pair in raw:
        try:
            a, b = float(pair[0]), float(pair[1])
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        if b > a:
            ranges.append((a, b))
    ranges.sort()
    merged: list[tuple[float, float]] = []
    for a, b in ranges:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def build_caption_layer(words: list[dict], *, height: int, width: int,
                        style: dict | None = None,
                        preset: str | None = None, overrides: dict | None = None,
                        track_index: int = 30, id_prefix: str = "cap",
                        presets_path: Path | None = None) -> CaptionLayer:
    """Generate the caption layer (CSS + DOM + GSAP timeline JS) from words.

    Active-word state is expressed as GSAP `.set()` calls at absolute transcript
    times, so a direct seek to time T reproduces the same active word on every
    render (the property #112 flags as the caption risk). Box (highlighter) mode
    additionally eases the marker bubble in over 170ms with `back.out(1.3)` —
    the CaptionPage.tsx `Easing.out(Easing.back(1.3))` curve.

    `style` may be a pre-resolved caption-style dict (what the compositor passes,
    from job_inputs.resolve_caption_preset_style); when omitted it is resolved
    from `preset`/`overrides` for standalone/test use.

    Implements the full shipping caption-style contract (CaptionPage.tsx):
      * `hide_ranges_ms` — the whole caption is suppressed while
        `start <= t < end` (all pages wrapped in a container whose opacity is
        toggled by seek-deterministic GSAP sets at the absolute range bounds).
      * `italic_word_starts_ms` + emphasis — a token whose fromMs matches
        (exact / rounded / within ±2ms) renders in the emphasis font, italic,
        weight 700, `emphasis_size_multiplier`×, `emphasis_transform`, combining
        with active-word colour, highlighter box, inactive state and seeking.
    """
    if style is None:
        style = resolve_style(preset=preset, overrides=overrides,
                              presets_path=presets_path)
    # switch_ms reaches int() (and the page schedule) — a non-finite value would
    # raise a raw OverflowError there, so gate it through the shared finite check.
    switch_ms = int(hs.finite_number(
        style.get("switch_ms", DEFAULT_SWITCH_MS), field="caption_style.switch_ms"))
    pages = build_pages(
        words, switch_ms=switch_ms,
        break_on_sentence=style.get("break_on_sentence", True) is not False,
    )
    scheduled = schedule(pages, switch_ms=switch_ms)

    font_family = style.get("font_family", "Inter")
    weight = style.get("weight", DEFAULTS["weight"])
    inactive_color = style.get("color", DEFAULTS["color"])
    active_color = style.get("active_word_color") or DEFAULTS["active_word_color"]
    transform = style.get("transform", DEFAULTS["transform"])
    highlight_mode = style.get("highlight_mode", DEFAULTS["highlight_mode"])
    active_text_color = style.get("active_word_text_color", DEFAULTS["active_word_text_color"])
    background = style.get("background")
    letter_spacing = style.get("letter_spacing", DEFAULTS["letter_spacing"])
    line_height = style.get("line_height", DEFAULTS["line_height"])
    font_size_ratio = style.get("font_size_ratio", DEFAULTS["font_size_ratio"])
    font_size = round(height * font_size_ratio)
    anchor_ratio = style.get("vertical_anchor_ratio", DEFAULTS["vertical_anchor_ratio"])

    # Emphasis (italic-marked words) — CaptionPage.tsx parity.
    italic_set = {float(m) for m in (style.get("italic_word_starts_ms") or [])
                  if isinstance(m, (int, float))}
    emphasis_family = style.get("emphasis_font_family") or EMPHASIS_DEFAULT_FAMILY
    emphasis_size_mul = hs.finite_number(
        style.get("emphasis_size_multiplier", EMPHASIS_DEFAULT_SIZE_MUL),
        field="caption_style.emphasis_size_multiplier")
    emphasis_transform = style.get("emphasis_transform", EMPHASIS_DEFAULT_TRANSFORM)

    # ── Validate the style values interpolated into CSS (<style> + style attrs)
    #    and the GSAP timeline JS. caption_style comes from style_directives.json
    #    (untrusted); a colour/font/length carrying `"`/`<`/`{`/`}`/`;` would
    #    break out of a <style> block or a JS string literal (`tl.set(...,
    #    {color:"…"})`). Validate against the value's own grammar so one checked
    #    value is safe in every destination context; malformed → StyleValueError.
    font_family = hs.font_family(font_family, field="caption_style.font_family")
    emphasis_family = hs.font_family(emphasis_family, field="caption_style.emphasis_font_family")
    inactive_color = hs.css_color(inactive_color, field="caption_style.color")
    active_color = hs.css_color(active_color, field="caption_style.active_word_color")
    active_text_color = hs.css_color(active_text_color, field="caption_style.active_word_text_color")
    if background is not None:
        background = hs.css_color(background, field="caption_style.background")
    letter_spacing = hs.css_length(letter_spacing, field="caption_style.letter_spacing")
    line_height = hs.css_length(line_height, field="caption_style.line_height")
    weight = int(hs.finite_number(weight, field="caption_style.weight"))
    font_size = round(hs.finite_number(font_size_ratio, field="caption_style.font_size_ratio") * height)
    anchor_ratio = hs.finite_number(anchor_ratio, field="caption_style.vertical_anchor_ratio")
    if transform not in VALID_CAPTION_TRANSFORMS:
        raise hs.StyleValueError(
            f"caption_style.transform {transform!r} is not accepted "
            f"(use one of: {', '.join(sorted(VALID_CAPTION_TRANSFORMS))}).")
    if emphasis_transform not in VALID_CAPTION_TRANSFORMS:
        raise hs.StyleValueError(
            f"caption_style.emphasis_transform {emphasis_transform!r} is not "
            f"accepted (use one of: {', '.join(sorted(VALID_CAPTION_TRANSFORMS))}).")
    emphasis_font_size = round(font_size * emphasis_size_mul)

    def _is_italic(t_from_ms: float) -> bool:
        if not italic_set:
            return False
        if t_from_ms in italic_set or float(round(t_from_ms)) in italic_set:
            return True
        return any(abs(ms - t_from_ms) < EMPHASIS_TOLERANCE_MS for ms in italic_set)

    hide_ranges = _parse_hide_ranges_ms(style.get("hide_ranges_ms"))

    # Outline: explicit value wins; else auto from text luma. Guardrail minimum
    # unless a pill background or an explicit zero opts out.
    outline_color = style.get("outline_color")
    if not outline_color:
        outline_color = "#000000" if _luma(inactive_color) > 140 else "#FFFFFF"
    else:
        outline_color = hs.css_color(outline_color, field="caption_style.outline_color")
    requested_outline = int(hs.finite_number(
        style.get("outline_width_px", DEFAULTS["outline_width_px"]),
        field="caption_style.outline_width_px"))
    explicit_zero = style.get("outline_width_px") == 0
    if background or explicit_zero:
        outline_width = requested_outline if not explicit_zero else 0
    else:
        min_outline = max(MIN_OUTLINE_WIDTH_PX_NO_PILL,
                          round(font_size * MIN_OUTLINE_WIDTH_PX_FONT_SIZE_RATIO))
        outline_width = max(requested_outline, min_outline)
    no_stroke = outline_width == 0 and not background

    pad_top = round(height * anchor_ratio)
    shadow_strength = (max(12, round(font_size * 0.22)) if no_stroke
                       else max(8, round(font_size * 0.14)))
    if no_stroke:
        text_shadow = f"0 {round(font_size*0.04)}px {shadow_strength}px rgba(0,0,0,0.85)"
    else:
        text_shadow = f"0 {round(font_size*0.05)}px {shadow_strength}px rgba(0,0,0,0.55)"

    inner_extra = ""
    if background:
        inner_extra = (
            f"background-color:{background};"
            f"padding:{round(font_size*0.25)}px {round(font_size*0.35)}px;"
            f"border-radius:{round(font_size*0.18)}px;"
            f"-webkit-text-stroke:0 transparent;"
            f"text-shadow:0 {round(font_size*0.025)}px {round(font_size*0.08)}px rgba(0,0,0,0.4);"
        )

    p = id_prefix
    css = f""".{p}-page {{
  position:absolute; left:0; right:0; top:0; bottom:0;
  display:flex; flex-direction:column; align-items:center;
  justify-content:flex-start; padding:{pad_top}px 80px 0 80px;
  pointer-events:none;
}}
.{p}-inner {{
  font-family:"{font_family}", system-ui, sans-serif;
  font-weight:{weight}; font-size:{font_size}px; line-height:{line_height};
  text-align:center; text-transform:{transform}; letter-spacing:{letter_spacing};
  color:{inactive_color};
  text-shadow:{text_shadow};
  -webkit-text-stroke:{outline_width}px {outline_color};
  paint-order:stroke fill;
  white-space:normal; overflow-wrap:break-word; word-break:normal; max-width:100%;
  {inner_extra}
}}
.{p}-word {{ position:relative; }}
.{p}-box .{p}-word {{ display:inline-block; padding:{round(font_size*0.05)}px {round(font_size*0.12)}px; }}
.{p}-bubble {{
  position:absolute; inset:0; border-radius:{round(font_size*0.12)}px;
  background-color:{active_color}; transform:scale(0.9); opacity:0; z-index:0;
}}
.{p}-text {{ position:relative; z-index:1; }}
"""
    if italic_set:
        css += (
            f'.{p}-em {{ font-family:"{emphasis_family}", Georgia, serif; '
            f'font-style:italic; font-weight:700; font-size:{emphasis_font_size}px; '
            f'letter-spacing:0.005em; text-transform:{emphasis_transform}; '
            f'vertical-align:baseline; }}\n')
    if hide_ranges:
        css += f'.{p}-root {{ position:absolute; inset:0; pointer-events:none; }}\n'

    body_parts = []
    tl_parts = []
    box = highlight_mode == "box"
    inner_class = f"{p}-inner {p}-box" if box else f"{p}-inner"
    for pi, sc in enumerate(scheduled):
        page: Page = sc["page"]
        page_id = f"{p}_pg{pi}"
        spans = []
        for ti, tok in enumerate(page.tokens):
            wid = f"{page_id}_w{ti}"
            disp = html.escape(tok.text if not box else tok.text.strip())
            em_cls = f" {p}-em" if _is_italic(tok.from_ms) else ""
            if box:
                spans.append(
                    f'<span class="{p}-word" id="{wid}">'
                    f'<span class="{p}-bubble" id="{wid}_b"></span>'
                    f'<span class="{p}-text{em_cls}" id="{wid}_t">{disp}</span></span>')
            else:
                spans.append(f'<span class="{p}-word{em_cls}" id="{wid}">{disp}</span>')
            # Active-word timeline: exact CaptionPage predicate as GSAP sets at
            # absolute transcript time (seek-deterministic).
            t_on = tok.from_ms / 1000.0
            t_off = tok.to_ms / 1000.0
            if box:
                tl_parts.append(
                    f'tl.set("#{wid}_t", {{color:"{active_text_color}"}}, {t_on:.4f});')
                tl_parts.append(
                    f'tl.set("#{wid}_b", {{opacity:1}}, {t_on:.4f});')
                tl_parts.append(
                    f'tl.fromTo("#{wid}_b", {{scale:0.9}}, {{scale:1, duration:0.17, '
                    f'ease:"back.out(1.3)"}}, {t_on:.4f});')
                tl_parts.append(
                    f'tl.set("#{wid}_t", {{color:"{inactive_color}"}}, {t_off:.4f});')
                tl_parts.append(
                    f'tl.set("#{wid}_b", {{opacity:0}}, {t_off:.4f});')
            else:
                tl_parts.append(
                    f'tl.set("#{wid}", {{color:"{active_color}"}}, {t_on:.4f});')
                tl_parts.append(
                    f'tl.set("#{wid}", {{color:"{inactive_color}"}}, {t_off:.4f});')
        body_parts.append(
            f'<div class="clip {p}-page" id="{page_id}" '
            f'data-start="{sc["start_s"]:.4f}" data-duration="{sc["duration_s"]:.4f}" '
            f'data-track-index="{track_index}">'
            f'<div class="{inner_class}">{"".join(spans)}</div></div>')

    body = "\n".join(body_parts)
    # hide_ranges_ms: suppress the WHOLE caption while start <= t < end. All
    # pages sit inside a container whose opacity is toggled by seek-deterministic
    # GSAP sets at the absolute range bounds, so a direct seek into a hidden
    # range paints no caption and a seek past it restores the correct page +
    # active word (the active-word/page sets are unaffected). No-op when body is
    # empty (no scheduled pages).
    if hide_ranges and body:
        root_id = f"{p}_root"
        body = f'<div id="{root_id}" class="{p}-root">\n{body}\n</div>'
        for a_ms, b_ms in hide_ranges:
            tl_parts.append(
                f'tl.set("#{root_id}", {{opacity:0}}, {a_ms / 1000.0:.4f});')
            tl_parts.append(
                f'tl.set("#{root_id}", {{opacity:1}}, {b_ms / 1000.0:.4f});')

    return CaptionLayer(css=css, body=body,
                        timeline_js="\n".join(tl_parts),
                        dropped_pages=len(pages) - len(scheduled), style=style)


def build_caption_composition(words: list[dict], *, width: int, height: int,
                              duration_s: float, fps: int = 30,
                              preset: str | None = None, overrides: dict | None = None,
                              composition_id: str = "CaptionDemo",
                              bg_color: str = "#101014",
                              presets_path: Path | None = None) -> str:
    """A standalone caption-only composition (index.html) for visual evidence —
    captions over a solid background, no source video. Uses only the frozen local
    runtime (offline)."""
    layer = build_caption_layer(words, height=height, width=width, preset=preset,
                                overrides=overrides, presets_path=presets_path)
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
