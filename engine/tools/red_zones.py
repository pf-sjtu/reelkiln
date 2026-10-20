"""
Python mirror of remotion/src/redZones.ts.

Kept in sync by hand — both files describe the same rectangles. If you change
one, change the other. The Python copy is used by preflight.py to validate
overlay placements before rendering.

Coordinates are in pixels for a 1080x1920 (9:16) canvas. (x, y) is top-left.

These rectangles describe PORTRAIT platform chrome. They are only meaningful on
a 9:16 canvas, so ``resolve_zones`` refuses to reinterpret them for any other
aspect ratio and reports the check as not applicable instead — see
"Applicability" below.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class RedZone:
    x: int
    y: int
    width: int
    height: int
    label: str


TIKTOK: tuple[RedZone, ...] = (
    RedZone(0,   0,    1080, 220,  "top:header"),
    RedZone(920, 580,  160,  1100, "right:actions"),
    RedZone(0,   1620, 1080, 300,  "bottom:caption+share"),
)

INSTAGRAM_REELS: tuple[RedZone, ...] = (
    RedZone(0,   0,    1080, 200,  "top:status"),
    RedZone(920, 540,  160,  1140, "right:actions"),
    RedZone(0,   1620, 1080, 300,  "bottom:caption+navbar"),
)

YOUTUBE_SHORTS: tuple[RedZone, ...] = (
    RedZone(0,   0,    1080, 200,  "top:search+more"),
    RedZone(920, 600,  160,  1120, "right:like+comment+share"),
    RedZone(0,   1640, 1080, 280,  "bottom:title+channel"),
)

ALL_PLATFORMS: tuple[RedZone, ...] = (
    RedZone(0,   0,    1080, 220,  "top:union"),
    RedZone(920, 540,  160,  1180, "right:union"),
    RedZone(0,   1620, 1080, 300,  "bottom:union"),
)

REGISTRY: dict[str, tuple[RedZone, ...]] = {
    "tiktok": TIKTOK,
    "instagram_reels": INSTAGRAM_REELS,
    "youtube_shorts": YOUTUBE_SHORTS,
    "all_platforms": ALL_PLATFORMS,
}


# ---------------------------------------------------------------------------
# Applicability
#
# Every table above is authored against ONE canvas. A deliverable rendered on a
# different canvas is only covered when its aspect ratio matches the authored
# one — then the table scales uniformly and keeps its meaning. On any other
# aspect the honest answer is "not checked, no authored zones": stretching a
# portrait right-hand action rail across a landscape frame produces a rectangle
# that describes no real platform UI, so it can only manufacture a false pass or
# a false fail.
#
# Authoring landscape/square tables is a product decision, not a code change.
# When those rectangles exist, add them here keyed by aspect and every consumer
# picks them up.
#
# Non-9:16 source survey — 22 September 2026 (issue #241)
# ------------------------------------------------------
# Searched for first-party geometry sufficient to author exact UI-chrome
# rectangles for 16:9, 1:1 or 4:5. NONE FOUND. What was checked, and why each
# was insufficient:
#
#   TikTok Ads Manager in-feed specs — names 16:9 and 1:1, but ships safe zones
#     only as downloadable .zip overlay templates and states the zone varies
#     with ad caption length, so there is no single authorable rectangle.
#     https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads
#   Meta Ads Guide — publishes numbers for IG Reels and FB Stories ONLY, both
#     9:16. The Instagram Feed and Facebook Feed (4:5) video pages carry no
#     safe-zone geometry at all.
#     https://www.facebook.com/business/ads-guide/update/video/instagram-reels
#     https://www.facebook.com/business/ads-guide/update/video/facebook-feed
#   Google Ads video specs — hosts official overlay PNGs at 1920x1080 and
#     1080x1080, but publishes no numbers: coordinates would have to be measured
#     out of an image. They also describe Google video-AD-INVENTORY overlays,
#     not the app UI chrome these tables model. Declined on both counts.
#     https://support.google.com/google-ads/answer/13547298
#   YouTube (Shorts + landscape watch page) — no numeric safe area published for
#     any aspect; the Shorts editor shows its guides dynamically.
#   Pinterest — publishes real pixel insets, but only for 9:16 Idea ads; the 2:3
#     Showcase/Quiz numbers give no origin and no resolvable coordinate space.
#     https://help.pinterest.com/en/business/article/pinterest-product-specs
#   LinkedIn video ad specs — lists 16:9/1:1/4:5/9:16, publishes no safe zones.
#   Snapchat, X/Twitter, Amazon Ads — portrait-only, unreachable, or overscan.
#   EBU R 95 title-safe (3.5% action / 5% graphics on 16:9) — numerically
#     sufficient but a DIFFERENT CONCEPT: CRT overscan, not app UI chrome. It
#     does not belong in this registry.
#     https://tech.ebu.ch/publications/r095
#
# Third-party "safe zone" templates (Canva/agency/creator PNGs) are excluded by
# policy: they are screenshots measured by eye. Do not author from them.
# ---------------------------------------------------------------------------

AUTHORED_CANVAS_BY_ASPECT: dict[str, tuple[int, int]] = {"9:16": (1080, 1920)}
REGISTRY_BY_ASPECT: dict[str, dict[str, tuple[RedZone, ...]]] = {"9:16": REGISTRY}
# Same-aspect canvases differing by rounding (e.g. 608x1080) still resolve.
ASPECT_TOLERANCE = 0.01


def aspect_label(width: int, height: int) -> str:
    """``1920x1080`` -> ``"16:9"``. Reduced, so 1000x1400 reads as ``5:7``."""
    if width <= 0 or height <= 0:
        return "unknown"
    divisor = math.gcd(int(width), int(height))
    return f"{int(width) // divisor}:{int(height) // divisor}"


@dataclass(frozen=True)
class ZoneResolution:
    """Which zones apply to a canvas — and, when none do, why not.

    ``applicable is False`` means the red-zone check DID NOT RUN. It is not a
    pass: ``zones`` is empty precisely so no caller can accidentally report
    "no collisions" as evidence that the frame clears platform chrome.
    """

    platform: str
    canvas: tuple[int, int]
    aspect: str
    zones: tuple[RedZone, ...]
    applicable: bool
    authored_canvas: tuple[int, int] | None
    reason: str | None

    def receipt(self) -> dict:
        return {
            "platform": self.platform,
            "canvas": {"width": self.canvas[0], "height": self.canvas[1]},
            "aspect": self.aspect,
            "applicable": self.applicable,
            "status": "CHECKED" if self.applicable else "SKIPPED",
            "zoneCount": len(self.zones),
            "authoredCanvas": (
                {"width": self.authored_canvas[0], "height": self.authored_canvas[1]}
                if self.authored_canvas else None
            ),
            "reason": self.reason,
        }

    def notice(self) -> str:
        """One line a human cannot mistake for a pass."""
        return (
            f"red-zone check SKIPPED on platform={self.platform}: {self.reason}. "
            "Platform UI chrome was NOT checked on this canvas — a clean result "
            "covers the remaining checks only."
        )


def _authored_aspect_for(width: int, height: int) -> str | None:
    if width <= 0 or height <= 0:
        return None
    ratio = width / height
    for key, (authored_w, authored_h) in AUTHORED_CANVAS_BY_ASPECT.items():
        authored = authored_w / authored_h
        if abs(ratio - authored) <= ASPECT_TOLERANCE * authored:
            return key
    return None


def resolve_zones(platform: str, width: int, height: int) -> ZoneResolution:
    """Zones for ``platform`` on an actual ``width x height`` output canvas.

    Same aspect as the authored table -> the table scaled onto this canvas.
    Any other aspect -> no zones and ``applicable=False``; the caller must
    report the check as skipped rather than as a pass or a failure.
    """
    aspect = aspect_label(width, height)
    authored_key = _authored_aspect_for(width, height)
    if authored_key is None:
        known = ", ".join(sorted(AUTHORED_CANVAS_BY_ASPECT))
        return ZoneResolution(
            platform=platform, canvas=(width, height), aspect=aspect, zones=(),
            applicable=False, authored_canvas=None,
            reason=(f"no authored red zones for {aspect} ({width}x{height}); "
                    f"the zone tables cover {known} only"),
        )
    authored_w, authored_h = AUTHORED_CANVAS_BY_ASPECT[authored_key]
    table = REGISTRY_BY_ASPECT[authored_key]
    zones = table.get(platform) or table["all_platforms"]
    sx, sy = width / authored_w, height / authored_h
    return ZoneResolution(
        platform=platform, canvas=(width, height), aspect=aspect,
        zones=tuple(
            RedZone(round(z.x * sx), round(z.y * sy),
                    round(z.width * sx), round(z.height * sy), z.label)
            for z in zones
        ),
        applicable=True, authored_canvas=(authored_w, authored_h), reason=None,
    )


def _intersection_area(a: tuple[int, int, int, int],
                       b: tuple[int, int, int, int]) -> int:
    ax1, ay1 = a[0], a[1]
    ax2, ay2 = ax1 + a[2], ay1 + a[3]
    bx1, by1 = b[0], b[1]
    bx2, by2 = bx1 + b[2], by1 + b[3]
    iw = max(0, min(ax2, bx2) - max(ax1, bx1))
    ih = max(0, min(ay2, by2) - max(ay1, by1))
    return iw * ih


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection-over-union of two (x, y, w, h) rectangles."""
    inter = _intersection_area(a, b)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def coverage(rect: tuple[int, int, int, int],
             zone: tuple[int, int, int, int]) -> float:
    """Fraction of ``rect``'s own area that lies inside ``zone`` (0..1).

    This is the safety-relevant measure for "is this element intruding into a
    prohibited band": it does NOT normalise by the zone's size, so a small
    element sitting entirely inside a large red zone scores 1.0 — whereas IOU,
    which divides by the union, would score it near zero and wave it through."""
    area = rect[2] * rect[3]
    return _intersection_area(rect, zone) / area if area > 0 else 0.0


# A red-zone collision fires when EITHER measure trips: IOU catches a graze of
# comparable-size rectangles; coverage catches an element substantially or wholly
# inside a much larger zone (which IOU misses). See the two thresholds below.
DEFAULT_IOU_THRESHOLD = 0.05
DEFAULT_COVERAGE_THRESHOLD = 0.5  # ≥ half the element inside the band = intrusion


def collides_with_red_zones(
    rect: tuple[int, int, int, int],
    zones: Iterable[RedZone],
    threshold: float = DEFAULT_IOU_THRESHOLD,
    *,
    coverage_threshold: float = DEFAULT_COVERAGE_THRESHOLD,
) -> list[RedZone]:
    """Return the zones ``rect`` meaningfully intrudes into.

    A zone is a hit when the IOU exceeds ``threshold`` (a graze between
    comparable rectangles) OR when ``coverage_threshold`` or more of the element
    lies inside the zone (an element buried in a much larger band — the case
    IOU-alone misses because the union is dominated by the big zone). Using both
    keeps the existing graze detection while closing the "small element wholly
    inside a big zone passes" gap."""
    out = []
    for z in zones:
        zr = (z.x, z.y, z.width, z.height)
        if iou(rect, zr) > threshold or coverage(rect, zr) >= coverage_threshold:
            out.append(z)
    return out
