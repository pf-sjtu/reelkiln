"""
HyperFrames layout preflight — safe-area / red-zone enforcement for the
HyperFrames render path (issue #112).

The platform red-zone registry is shared unchanged with the Remotion pipeline:

  * `tools/red_zones.py`  — the platform red-zone rectangles (mirror of
    `remotion/src/redZones.ts`), `resolve_zones()`, `iou()`,
    `collides_with_red_zones()`.
  * `tools/preflight.py`  — `CANVAS_W/H`, `caption_band_bbox()`, `overlay_bbox()`
    (mirror of `CaptionPage.tsx` / `Overlays.tsx` placement).

The zone rectangles are the SAME on both engines. The per-element FOOTPRINTS,
however, are renderer-specific: `caption_rect()` and `dataviz_rect()` are
HyperFrames approximations derived from its generated layout (not the Remotion
bounding boxes verbatim), validated against the shared zones. So the honest
claim is: "the platform red-zone registry is shared unchanged; HyperFrames uses
renderer-specific element footprints derived from its generated layout and
validated against the shared zones."

Canvas applicability (issue #241)
---------------------------------
Every rectangle here is measured on the job's REAL canvas, which HyperFrames
authors via `style_directives.width/height`. Zone selection goes through
`red_zones.resolve_zones(platform, w, h)` — the SAME aspect-aware resolver the
Remotion path uses (#239). There is deliberately no HyperFrames-local zone
accessor: the former `zones_for(platform)` took no canvas and handed back the
raw portrait table for any canvas, so a landscape or square composition was
checked against 1080x1920 UI chrome. An aspect with no authored table yields no
zones and `applicable=False`, reported as SKIPPED — never as a clean pass.

Only the platform-chrome checks are scoped that way. Element-to-element
collisions (`check_element_pairs`) are canvas-relative and keep running on
every aspect.

This module reports:
  1. element-vs-red-zone collisions (`check_elements`), and
  2. element-vs-element collisions (`check_element_pairs`) — a relevant overlap
     requires BOTH geometry AND time to overlap; only an explicit caller-supplied
     allow-rule can mark one intentional.
When asked to place a required element safely it returns a safe position or
**fails clearly** when no safe placement exists (no silent render inside a
prohibited band).
"""

from __future__ import annotations

from dataclasses import dataclass

from red_zones import ZoneResolution, collides_with_red_zones, iou, resolve_zones
from preflight import CANVAS_W, CANVAS_H, caption_band_bbox, overlay_bbox

Rect = tuple[int, int, int, int]  # (x, y, w, h)


class UnresolvableLayoutError(RuntimeError):
    """No safe placement exists for a required element on the given platform.

    Raised instead of silently rendering content inside a prohibited red zone."""


class ZonesNotApplicableError(RuntimeError):
    """A platform-zone answer was demanded on a canvas with no authored table.

    Distinct from UnresolvableLayoutError, which means "zones exist and nothing
    clears them". This means "there is nothing authored to clear" — the caller
    must treat the placement as unverified rather than as safe."""


class LayoutPolicyError(RuntimeError):
    """A composition has unresolved red-zone collisions under `--layout-policy
    error`. Raised BEFORE the composition is written, so a colliding layout can
    never be rendered under the strict (production-like) policy."""


# Layout policies for the compositor's `--layout-policy` flag.
#   "error" — any relevant unresolved collision blocks composition generation.
#   "warn"  — the composition is generated, but every collision is recorded.
LAYOUT_POLICIES = ("error", "warn")
DEFAULT_LAYOUT_POLICY = "error"

# Element types whose position the compositor may auto-move to a safe band via
# find_safe_y. Deliberately empty: captions/overlays/dataviz carry intentional
# placement, so we never silently relocate them — a collision is surfaced (warn)
# or blocks the render (error) instead. find_safe_y stays available for callers
# that opt a specific element in.
AUTO_MOVABLE_ELEMENTS: frozenset[str] = frozenset()


@dataclass
class Collision:
    element: str          # e.g. "caption", "overlay:hook", "dataviz"
    rect: Rect
    zones: list[str]      # labels of the red zones it overlaps
    iou_max: float


def caption_rect(style: dict, *, canvas_w: int = CANVAS_W,
                 canvas_h: int = CANVAS_H) -> Rect:
    """Collision footprint of the caption text for a resolved caption style.

    This is the *centered text column* a caption actually paints into — NOT the
    generous full-width 22%-tall luminance band (`caption_band_bbox`, used for
    background sampling). Captions are centered and a few lines tall, so the
    real footprint clears the side action rail and only enters the top/bottom
    UI bands when the caption is genuinely anchored into them. Using the
    luminance band here would false-positive every normally-placed caption
    against the right rail and block strict-policy renders.
    """
    text_w = int(canvas_w * 0.70)     # centered caption column (clears side rail)
    x = (canvas_w - text_w) // 2
    text_h = int(canvas_h * 0.13)     # a few lines of caption text + padding
    anchor = style.get("vertical_anchor_ratio")
    if isinstance(anchor, (int, float)):
        y = int(canvas_h * anchor)
    else:
        bx, by, bw, bh = caption_band_bbox(
            style.get("position", "lower-third"), canvas_w, canvas_h)
        y = by + max(0, (bh - text_h) // 2)
    return (x, y, text_w, text_h)


def dataviz_rect(position: str | None = "center", *,
                 canvas_w: int = CANVAS_W, canvas_h: int = CANVAS_H) -> Rect:
    """Footprint of a dataviz card at `position` (top / center / lower-third /
    bottom). Derived from the SHARED position model in hyperframes_dataviz
    (`card_footprint`), which also drives the render CSS — so the preflight
    rectangle and the painted card cannot drift. Missing/unknown position
    resolves to center (the compositor validates+rejects unknown values first)."""
    import hyperframes_dataviz as dv
    return dv.card_footprint(position, canvas_w, canvas_h)


@dataclass
class ZoneCheck:
    """The element-vs-red-zone pass on one canvas — collisions AND whether the
    check actually ran.

    `collisions` alone cannot say that, so a caller reading only an empty list
    would report an unchecked canvas as platform-safe. `zones.applicable` is
    what keeps a SKIP and a PASS apart; the shape mirrors
    `preflight.LayoutReport` so both engines report a skip the same way.
    """

    platform: str
    canvas: tuple[int, int]
    zones: ZoneResolution
    collisions: list[Collision]

    @property
    def applicable(self) -> bool:
        return self.zones.applicable

    @property
    def skipped_checks(self) -> list[str]:
        return [] if self.zones.applicable else ["platform_red_zones"]

    def notices(self) -> list[str]:
        return [] if self.zones.applicable else [self.zones.notice()]

    def receipt(self) -> dict:
        return {
            "canvas": {"width": self.canvas[0], "height": self.canvas[1]},
            "redZoneCheck": self.zones.receipt(),
            "checksSkipped": self.skipped_checks,
            "collisionCount": len(self.collisions),
        }


def _iou_max(rect: Rect, zones) -> float:
    return max((iou(rect, (z.x, z.y, z.width, z.height)) for z in zones), default=0.0)


def check_elements(elements: dict[str, Rect], platform: str, *,
                   canvas_w: int = CANVAS_W, canvas_h: int = CANVAS_H,
                   threshold: float = 0.05) -> ZoneCheck:
    """Report every element that meaningfully overlaps a red zone on this canvas.

    `elements` maps a label → (x, y, w, h). The result carries a Collision per
    hit, most-overlapping first — the caller decides whether to warn or block,
    exactly as preflight.validate_layout leaves that to compose_render.

    On an aspect with no authored table the zones are inapplicable: no zones are
    invented, no collisions are produced, and `ZoneCheck.skipped_checks` records
    that the platform-chrome check did not run.
    """
    resolution = resolve_zones(platform, canvas_w, canvas_h)
    out: list[Collision] = []
    for label, rect in elements.items():
        hits = collides_with_red_zones(rect, resolution.zones, threshold=threshold)
        if hits:
            out.append(Collision(element=label, rect=rect,
                                 zones=[h.label for h in hits],
                                 iou_max=_iou_max(rect, resolution.zones)))
    out.sort(key=lambda c: c.iou_max, reverse=True)
    return ZoneCheck(platform=platform, canvas=(canvas_w, canvas_h),
                     zones=resolution, collisions=out)


def find_safe_y(rect: Rect, platform: str, *, threshold: float = 0.05,
                canvas_w: int = CANVAS_W, canvas_h: int = CANVAS_H,
                step: int = 20) -> int:
    """Return a y for `rect` that clears every red zone, searching from the
    element's current y outward (down then up). Raises UnresolvableLayoutError
    when the element is too tall to fit between the zones on this platform.

    This is the "fail clearly when a safe layout cannot be produced" path — a
    caption/overlay taller than the safe corridor cannot be placed, and that is
    surfaced rather than rendered inside a prohibited band.

    Placement is defined entirely by the platform table, so on an aspect with no
    authored zones this raises ZonesNotApplicableError rather than returning the
    element's current y as if it had been cleared.
    """
    x, y0, w, h = rect
    resolution = resolve_zones(platform, canvas_w, canvas_h)
    if not resolution.applicable:
        raise ZonesNotApplicableError(
            f"Cannot place a {w}x{h} element clear of platform chrome on "
            f"{canvas_w}x{canvas_h}: {resolution.reason}. The placement is "
            f"unverified, not safe.")
    zones = resolution.zones
    candidates = list(range(y0, canvas_h - h + 1, step)) + \
        list(range(y0 - step, -1, -step))
    for y in candidates:
        if 0 <= y <= canvas_h - h and not collides_with_red_zones((x, y, w, h), zones, threshold):
            return y
    raise UnresolvableLayoutError(
        f"No safe vertical placement for a {w}x{h} element on {platform!r}: it "
        f"cannot fit between the platform red zones. Reduce its height or choose "
        f"a different platform profile.")


def preflight_caption_and_overlays(caption_style: dict | None,
                                   overlay_kinds: list[str],
                                   platform: str = "all_platforms", *,
                                   dataviz_rects: dict[str, Rect] | None = None,
                                   overlay_rects: dict[str, Rect] | None = None,
                                   canvas_w: int = CANVAS_W,
                                   canvas_h: int = CANVAS_H,
                                   threshold: float = 0.05) -> ZoneCheck:
    """Whole-composition layout preflight for HyperFrames: caption band (only
    when captions will actually be rendered) + overlays + any dataviz rects,
    against one platform's zones.

    `caption_style` is optional: pass ``None`` for a composition that renders NO
    captions (no transcript words, captions disabled, overlay-only or dataviz-only
    job). When ``None`` the caption element is NOT added to the collision set, so
    a no-caption job never fails on a phantom caption rectangle that is never
    rendered. Pass the resolved caption style only when captions are on.

    Overlays are supplied EITHER as `overlay_kinds` (typed hook/url/lower, boxed
    via the shared overlay_bbox — the legacy convenience path) OR as pre-computed
    `overlay_rects` (label → footprint). The compositor passes `overlay_rects`
    built from every overlay's real render inputs (hyperframes_overlays.
    overlay_footprint), so image/logo/label overlays are checked too and can't
    slip past the red zones through a 1x1 fallback.

    `canvas_w`/`canvas_h` are the composition's REAL canvas. Every footprint is
    measured on it, and the zones are resolved for its aspect — so a landscape
    or square composition is never checked against portrait UI chrome. Read
    `ZoneCheck.skipped_checks` before reporting a clean result: an empty
    collision list on an unsupported aspect means "not checked", not "safe".
    """
    elements: dict[str, Rect] = {}
    if caption_style is not None:
        elements["caption"] = caption_rect(
            caption_style, canvas_w=canvas_w, canvas_h=canvas_h)
    for kind in overlay_kinds:
        elements[f"overlay:{kind}"] = overlay_bbox(kind, canvas_w, canvas_h)
    if overlay_rects:
        elements.update(overlay_rects)
    if dataviz_rects:
        elements.update(dataviz_rects)
    return check_elements(elements, platform, canvas_w=canvas_w,
                          canvas_h=canvas_h, threshold=threshold)


def enforce_policy(check: ZoneCheck, policy: str, *,
                   platform: str) -> list[Collision]:
    """Apply a layout policy to a `check_elements` / preflight result.

    * `error` (default): raise LayoutPolicyError if ANY collision exists, so the
      composition is never written with content inside a prohibited band.
    * `warn`: return the collisions unchanged for the caller to record.

    A skipped check produces no collisions and therefore never blocks — which is
    correct, and exactly why the caller must report `check.skipped_checks`
    alongside its verdict instead of treating this as a clean pass.

    Nothing is silently relocated — a real collision either blocks the render
    (error) or is reported (warn). Returns the collision list on success.
    """
    if policy not in LAYOUT_POLICIES:
        raise ValueError(
            f"Unknown layout policy {policy!r}. Choose one of: "
            f"{', '.join(LAYOUT_POLICIES)}.")
    collisions = check.collisions
    if collisions and policy == "error":
        detail = "; ".join(
            f"{c.element} → {c.zones} (IOU {c.iou_max:.3f})" for c in collisions)
        raise LayoutPolicyError(
            f"Layout policy 'error' on platform {platform!r}: "
            f"{len(collisions)} unresolved red-zone collision(s) — {detail}. "
            f"Move the element(s) out of the safe-area band, or re-run with "
            f"--layout-policy warn to generate anyway and record the collisions.")
    return collisions


# ---------------------------------------------------------------------------
# Element-to-element collision detection (geometry AND time)
# ---------------------------------------------------------------------------
@dataclass
class LayoutElement:
    """A timed layout element for element-to-element collision checking.

    `rect` is its footprint (x, y, w, h); `start`/`end` its on-screen window in
    seconds (half-open [start, end)); `kind` its semantic type
    ("caption" | "overlay" | "dataviz"); `label` a unique display name.
    """
    label: str
    rect: Rect
    start: float
    end: float
    kind: str


@dataclass
class ElementCollision:
    """A relevant overlap between two layout elements: BOTH their footprints and
    their on-screen time windows overlap. `allowed` is True when the overlap is
    intentional under an explicit caller-supplied allow-rule, so the policy can
    distinguish it from an unresolved collision."""
    a: str
    b: str
    kind_a: str
    kind_b: str
    time_overlap: tuple[float, float]  # [start, end) of the overlap
    iou: float
    allowed: bool


def rects_intersect(a: Rect, b: Rect) -> bool:
    """True if two (x, y, w, h) rectangles share positive area (edge-touch is
    not an intersection)."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def time_ranges_overlap(s1: float, e1: float, s2: float, e2: float) -> bool:
    """True if two half-open [start, end) intervals overlap (touching ends do
    not overlap — matches the `start <= t < end` visibility predicate)."""
    return s1 < e2 and s2 < e1


def _time_overlap_window(s1: float, e1: float, s2: float, e2: float
                         ) -> tuple[float, float]:
    return (max(s1, s2), min(e1, e2))


def check_element_pairs(elements: list[LayoutElement], *,
                        allow=None,
                        min_iou: float = 0.0) -> list[ElementCollision]:
    """Report every pair of elements whose footprints AND time windows overlap.

    A geometric overlap alone is NOT a collision — the two elements must also be
    on screen at the same time. `allow(a, b)` may explicitly mark a pair as
    intentional. The default allows nothing: painting captions above another
    text surface merely occludes that surface and is still unreadable.
    `min_iou` optionally ignores tiny geometric grazes. Results are sorted
    most-overlapping first."""
    out: list[ElementCollision] = []
    for i in range(len(elements)):
        for j in range(i + 1, len(elements)):
            a, b = elements[i], elements[j]
            if not rects_intersect(a.rect, b.rect):
                continue
            if not time_ranges_overlap(a.start, a.end, b.start, b.end):
                continue
            overlap_iou = iou(a.rect, b.rect)
            if overlap_iou < min_iou:
                continue
            out.append(ElementCollision(
                a=a.label, b=b.label, kind_a=a.kind, kind_b=b.kind,
                time_overlap=_time_overlap_window(a.start, a.end, b.start, b.end),
                iou=overlap_iou,
                allowed=bool(allow(a, b)) if callable(allow) else False))
    out.sort(key=lambda c: c.iou, reverse=True)
    return out


def enforce_element_policy(collisions: list[ElementCollision], policy: str
                          ) -> list[ElementCollision]:
    """Apply the layout policy to element-to-element collisions.

    Only NOT-allowed collisions matter: under `error` any unresolved (non-allowed)
    element-to-element collision raises LayoutPolicyError; under `warn` they are
    returned for the caller to record. Intentional (allowed) overlaps never
    block. Returns the full collision list on success (allowed + unresolved)."""
    if policy not in LAYOUT_POLICIES:
        raise ValueError(
            f"Unknown layout policy {policy!r}. Choose one of: "
            f"{', '.join(LAYOUT_POLICIES)}.")
    unresolved = [c for c in collisions if not c.allowed]
    if unresolved and policy == "error":
        detail = "; ".join(
            f"{c.a} ⨯ {c.b} (overlap {c.time_overlap[0]:.2f}–{c.time_overlap[1]:.2f}s, "
            f"IOU {c.iou:.3f})" for c in unresolved)
        raise LayoutPolicyError(
            f"Layout policy 'error': {len(unresolved)} unresolved element-to-element "
            f"collision(s) — {detail}. Two elements share screen space at the same "
            f"time and neither is allowed to occlude the other. Retime or reposition "
            f"one, add an explicit allow-rule, or re-run with --layout-policy warn.")
    return collisions
