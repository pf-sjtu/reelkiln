"""
fetch_asset.py — the canonical "fetch a REAL external still" primitive.

⭐ CHECK THE LIBRARY FIRST. If the still might already exist in the tenant's own media,
search it before fetching an external URL:
    uv run python tools/index_media.py search "<describe it>" --tenant <t> --type image --job <id>
Priority: mine → shared → web-capture → stock → fetch_asset/URL → generate. Use this tool
for REAL external stills the tenant doesn't have (a brand logo, a real person's headshot,
a book cover). See skills/primitives/index_media.md.

ONE self-contained tool, parameterized by `--type`. Pulls a real external still
(brand logo, speaker headshot, book cover, or any other archival image) from a
URL/CDN, rasterizes SVG to PNG where needed, optionally strips the background to
clean RGBA, and deposits a render-ready asset under `<job_dir>/images/`.

This tool exists to KILL the ad-hoc `curl`-in-bash pattern seen across five
founding sessions (4a016c4a, 88ca2208, e00ee210, cee518a4, 371a0e39), where the
absence of a primitive forced inline curls (no --job scoping, no bg-strip, no
SVG fallback ladder, no usage_role log entry) — and in 371a0e39 forced
generate_image.py to HALLUCINATE real institution crests (Harvard / Stanford) on
a magenta field. The boundary is sharp:

  - fetch_asset  → fetch + prepare a REAL still that must not be faked.
  - mint_image   → GENERATE a still from a prompt (icons, cards, illustrations).
  - pull_video   → pull VIDEO (yt-dlp / local files).
  - cast_avatar  → build a SYNTHETIC speaker identity from scratch.

  uv run python tools/fetch_asset.py --job <job> --type {logo|headshot|cover|generic} \
      --name <name> --url <source_url_or_svg_url> \
      [--strip-bg | --no-strip-bg] \
      [--width <px>] \
      [--format png|webp]

`--type` is REQUIRED and logged as `usage_role`. `--job` is always passed
(MEMORY: concurrent jobs clobber `.current_job`; every pipeline tool must include
`--job` explicitly). `--strip-bg` is ON by default for `logo` and `cover`; OFF by
default for `headshot` and `generic` (headshots keep their background for
compositing context unless the caller opts in).

OUTPUTS
  <job_dir>/images/<name>.{png|webp}   — render-ready still (RGBA when stripped).
  <job_dir>/images/<name>.source.txt   — the source URL it was fetched from.
  <job_dir>/images/_index.json         — slot → file + provenance (shared with
                                         mint_image; merged, never clobbered).

SVG RASTERIZATION LADDER (folds in the 88ca2208 resolution path)
  When the source is an SVG (by extension or content-type) we rasterize to PNG:
    1. cairosvg (Python lib)        — preferred, honours --width.
    2. rsvg-convert (CLI)           — fallback if cairosvg is missing.
    3. Wikipedia Commons auto-PNG   — if BOTH rasterizers ERR (the exact
       88ca2208 outcome: "SVG-to-PNG conversion failed [ERR]; resolved by
       fetching Wikipedia PNG thumbnails"). We rewrite a Wikimedia
       `.../Foo.svg` URL into its auto-generated raster thumbnail
       `.../thumb/.../Foo.svg/<width>px-Foo.svg.png` and curl that instead.

BACKGROUND STRIP LADDER
  1. rembg (u2net)  — preferred ML cutout when the lib is installed.
  2. PIL flood/threshold strip — flat-background removal from the corner color
     with a tolerance, plus a near-white knockout. Always available (PIL is a
     hard dep). Used as the fallback when rembg is absent or errors.
  If a strip produces an all-transparent or empty result it is reverted and the
  un-stripped image is kept (a visible asset beats an invisible one).

CDN FALLBACK
  Direct download uses a browser-like User-Agent (many CDNs 403 the default
  python-requests UA — this is the cee518a4 "WebFetch errored → curl the CDN
  directly" resolution, generalised). If the primary URL 404s/403s the tool
  reports the failure with the documented per-type fallback ladder so the agent
  (or a WebSearch) can supply a working URL.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from dotenv import load_dotenv

from _paths import ENV_PATH
from job import resolve_job_dir, add_job_arg
from log import log_event

load_dotenv(ENV_PATH if ENV_PATH.exists() else None)

TYPES = ("logo", "headshot", "cover", "generic")

# strip-bg defaults per --type (skills/primitives/fetch_asset.md):
#   logo + cover  → ON (clean RGBA for overlay compositing / clean cover edges)
#   headshot + generic → OFF (keep the background unless the caller opts in)
STRIP_BG_DEFAULT = {
    "logo": True,
    "cover": False,   # spec: cover --strip-bg OFF by default (keep the full cover rectangle)
    "headshot": False,
    "generic": False,
}

VALID_FORMATS = ("png", "webp")

# A real browser UA. python-requests' default UA gets 403'd by Wikipedia,
# Amazon CDN, publisher CDNs, etc. (cee518a4: WebFetch errored, direct curl
# with a browser UA resolved it).
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Per-type fallback ladders, surfaced verbatim on a failed fetch so the agent
# knows the proven recovery path (all lifted from the founding sessions).
FALLBACK_HINTS = {
    "logo": (
        "CDN blocked the logo URL. Proven recovery (88ca2208): WebSearch "
        "'site:wikipedia.org <brand> logo' to hit the auto-generated PNG "
        "thumbnail, then pass that PNG URL (or the Wikimedia .svg URL — this "
        "tool auto-rewrites it to a ?width= raster thumbnail)."
    ),
    "headshot": (
        "Headshot 404/auth-wall. Proven recovery (cee518a4): WebSearch "
        "'\"<person name>\" headshot site:<publisher>.com' or the official "
        "press-kit URL, then curl that CDN URL directly."
    ),
    "cover": (
        "Cover CDN blocked. Fallback ladder: Google Books thumbnail "
        "(append ?fife=w400), or the universal Open Library cover API "
        "https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg."
    ),
    "generic": (
        "Generic still blocked. Same CDN-fallback ladder as logo: try a "
        "Wikipedia/Commons auto-PNG thumbnail or an alternate CDN mirror."
    ),
}


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


def _download(url: str, *, timeout: int = 60) -> tuple[bytes, str]:
    """Fetch `url` with a browser UA. Returns (bytes, content_type).

    Raises RuntimeError with the response status on a non-2xx so the caller can
    surface the per-type fallback ladder.
    """
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            if resp.status_code >= 400:
                raise RuntimeError(f"HTTP {resp.status_code} fetching {url}")
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            return resp.content, ctype
        except Exception as e:  # noqa: BLE001 — network transients are retried
            last_err = e
            print(f"  ! download attempt {attempt} failed: {e}", file=sys.stderr)
            if attempt < 3:
                time.sleep(4 * attempt)
    raise RuntimeError(str(last_err))


def _looks_like_svg(url: str, ctype: str, data: bytes) -> bool:
    if ctype in ("image/svg+xml", "text/xml", "application/xml"):
        return True
    if url.lower().split("?")[0].endswith(".svg"):
        return True
    head = data[:512].lstrip()
    return head[:5].lower() == b"<?xml" or head[:4].lower() == b"<svg"


# ---------------------------------------------------------------------------
# SVG rasterization ladder: cairosvg → rsvg-convert → Wikimedia auto-PNG
# ---------------------------------------------------------------------------


def _rasterize_cairosvg(svg_bytes: bytes, width: int | None) -> bytes | None:
    try:
        import cairosvg  # type: ignore
    except Exception:
        return None
    try:
        kwargs = {"bytestring": svg_bytes}
        if width:
            kwargs["output_width"] = width
        return cairosvg.svg2png(**kwargs)
    except Exception as e:  # noqa: BLE001
        print(f"  ! cairosvg rasterize ERR: {e}", file=sys.stderr)
        return None


def _rasterize_rsvg(svg_bytes: bytes, width: int | None) -> bytes | None:
    if not shutil.which("rsvg-convert"):
        return None
    cmd = ["rsvg-convert", "-f", "png"]
    if width:
        cmd += ["-w", str(width)]
    try:
        r = subprocess.run(cmd, input=svg_bytes, capture_output=True, timeout=60)
        if r.returncode == 0 and r.stdout:
            return r.stdout
        print(f"  ! rsvg-convert ERR: {r.stderr.decode('utf-8', 'replace')[-300:]}",
              file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"  ! rsvg-convert ERR: {e}", file=sys.stderr)
    return None


def _wikimedia_thumb_url(svg_url: str, width: int) -> str | None:
    """Rewrite a Wikimedia/Wikipedia `.../Foo.svg` URL into its auto-generated
    raster thumbnail URL — the exact 88ca2208 resolution path.

    upload.wikimedia.org/wikipedia/commons/a/ab/Foo.svg
      → upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.svg/<W>px-Foo.svg.png
    """
    p = urlparse(svg_url)
    if "wikimedia.org" not in p.netloc and "wikipedia.org" not in p.netloc:
        return None
    path = p.path
    if "/thumb/" in path:
        # already a thumb path → just retarget the width on the trailing segment
        m = re.search(r"/(\d+)px-([^/]+\.svg\.png)$", path)
        if m:
            path = path[: m.start()] + f"/{width}px-{m.group(2)}"
            return f"{p.scheme}://{p.netloc}{path}"
        return None
    m = re.search(r"^(.*/)([^/]+\.svg)$", path, re.IGNORECASE)
    if not m:
        return None
    prefix, fname = m.group(1), m.group(2)
    # commons/a/ab/Foo.svg → commons/thumb/a/ab/Foo.svg/<W>px-Foo.svg.png
    prefix = prefix.replace("/commons/", "/commons/thumb/", 1)
    prefix = prefix.replace("/en/", "/en/thumb/", 1)
    thumb_path = f"{prefix}{fname}/{width}px-{fname}.png"
    return f"{p.scheme}://{p.netloc}{thumb_path}"


def _rasterize_svg(svg_bytes: bytes, svg_url: str, width: int | None) -> tuple[bytes, str]:
    """Rasterize SVG → PNG bytes via the documented ladder.

    Returns (png_bytes, method). Raises RuntimeError if every rung fails.
    """
    png = _rasterize_cairosvg(svg_bytes, width)
    if png:
        return png, "cairosvg"

    png = _rasterize_rsvg(svg_bytes, width)
    if png:
        return png, "rsvg-convert"

    # Both local rasterizers ERR'd — the 88ca2208 outcome. Fall back to the
    # Wikimedia auto-generated PNG thumbnail at the target width.
    thumb_w = width or 512
    thumb_url = _wikimedia_thumb_url(svg_url, thumb_w)
    if thumb_url:
        print(f"  ↳ SVG rasterize ERR (no cairosvg/rsvg-convert); fetching "
              f"Wikimedia auto-PNG: {thumb_url}", file=sys.stderr)
        data, ctype = _download(thumb_url)
        if data and not _looks_like_svg(thumb_url, ctype, data):
            return data, "wikimedia_thumb"
        raise RuntimeError(
            f"Wikimedia auto-PNG fallback returned non-PNG ({ctype}) for {thumb_url}"
        )

    raise RuntimeError(
        "SVG rasterization failed: no cairosvg, no rsvg-convert, and the source "
        f"URL is not a Wikimedia .svg we can rewrite to a ?width= PNG thumbnail "
        f"({svg_url}). Pass a direct PNG/JPEG URL instead, or install cairosvg "
        "(`uv pip install cairosvg`) / rsvg-convert."
    )


# ---------------------------------------------------------------------------
# Background strip ladder: rembg → PIL flat/threshold knockout
# ---------------------------------------------------------------------------


def _strip_bg_rembg(png_path: Path) -> bool:
    """ML cutout via rembg (u2net). Returns True on success."""
    try:
        from rembg import remove  # type: ignore
    except Exception:
        return False
    try:
        from PIL import Image
        with Image.open(png_path) as im:
            cut = remove(im.convert("RGBA"))
        if _alpha_is_empty(cut):
            print("  ! rembg produced an all-transparent cutout; reverting.",
                  file=sys.stderr)
            return False
        cut.save(png_path)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  ! rembg strip ERR: {e}", file=sys.stderr)
        return False


def _alpha_is_empty(im) -> bool:
    """True if the RGBA image is fully (or nearly) transparent."""
    if im.mode != "RGBA":
        return False
    alpha = im.getchannel("A")
    extrema = alpha.getextrema()  # (min, max)
    return extrema[1] <= 8


def _strip_bg_pil(png_path: Path, tolerance: int = 32) -> bool:
    """Flat-background knockout with PIL — the always-available fallback.

    Samples the four corner pixels; if they agree on a dominant background
    color, floods every pixel within `tolerance` of it to transparent. Also
    knocks out near-white. Reverted (returns False) if the result is empty.
    """
    try:
        from PIL import Image
    except Exception as e:  # noqa: BLE001
        print(f"  ! PIL unavailable for bg-strip: {e}", file=sys.stderr)
        return False
    try:
        with Image.open(png_path) as src:
            im = src.convert("RGBA")
        px = im.load()
        w, h = im.size
        corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
        # Dominant corner color (mode); bail if corners disagree wildly.
        from collections import Counter
        bg = Counter((c[0], c[1], c[2]) for c in corners).most_common(1)[0][0]

        def close(c, ref):
            return (abs(c[0] - ref[0]) <= tolerance
                    and abs(c[1] - ref[1]) <= tolerance
                    and abs(c[2] - ref[2]) <= tolerance)

        white = (255, 255, 255)
        out = im.copy()
        opx = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                if close((r, g, b), bg) or close((r, g, b), white):
                    opx[x, y] = (r, g, b, 0)
        if _alpha_is_empty(out):
            print("  ! PIL flat-strip removed everything; reverting.", file=sys.stderr)
            return False
        out.save(png_path)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  ! PIL flat-strip ERR: {e}", file=sys.stderr)
        return False


def _strip_background(png_path: Path) -> str:
    """Run the strip ladder in place. Returns the method used ('rembg',
    'pil_flat', or 'none' if both failed and the original was kept)."""
    if _strip_bg_rembg(png_path):
        return "rembg"
    if _strip_bg_pil(png_path):
        return "pil_flat"
    return "none"


# ---------------------------------------------------------------------------
# Encoding / resize
# ---------------------------------------------------------------------------


def _encode(raw: bytes, *, out_path: Path, fmt: str, width: int | None,
            want_alpha: bool) -> None:
    """Decode `raw`, optionally resize to `width`, write as `fmt` to out_path.

    Uses PIL so we get a normalized RGBA/RGB PNG/WebP regardless of the source
    container (JPEG/PNG/WebP/etc.). Falls back to a raw byte-write if PIL can't
    decode (so a valid downloaded image is never lost to a decode quirk).
    """
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(raw))
        im = im.convert("RGBA") if want_alpha else im.convert("RGB")
        if width and im.width != width:
            ratio = width / im.width
            new_h = max(1, round(im.height * ratio))
            resample = getattr(Image, "LANCZOS", getattr(Image, "BICUBIC", 1))
            im = im.resize((width, new_h), resample)
        save_kwargs = {}
        if fmt == "webp":
            save_kwargs["quality"] = 92
            save_kwargs["lossless"] = want_alpha
        im.save(out_path, format="PNG" if fmt == "png" else "WEBP", **save_kwargs)
    except Exception as e:  # noqa: BLE001
        print(f"  ! PIL encode fell back to raw byte-write ({e})", file=sys.stderr)
        out_path.write_bytes(raw)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)

    parser.add_argument(
        "--type", required=True, choices=TYPES,
        help="Asset type. REQUIRED. Logged as usage_role. "
             "logo|headshot|cover|generic.",
    )
    parser.add_argument(
        "--name", required=True,
        help="Output stem (e.g. logo_humeo). Becomes <job_dir>/images/<name>.<ext> "
             "and the _index.json key.",
    )
    parser.add_argument(
        "--url", required=True,
        help="Source URL: official SVG/PNG/JPEG, CDN thumbnail, publisher image. "
             "Wikimedia .svg URLs auto-rewrite to a raster ?width= thumbnail when "
             "no local SVG rasterizer is available.",
    )

    parser.add_argument(
        "--strip-bg", dest="strip_bg", action="store_true", default=None,
        help="Strip the background to clean RGBA. Default ON for logo, OFF for "
             "headshot/cover/generic.",
    )
    parser.add_argument(
        "--no-strip-bg", dest="strip_bg", action="store_false",
        help="Keep the background (overrides the per-type default).",
    )
    parser.add_argument(
        "--width", type=int, default=None,
        help="Target width in px (height scales to preserve aspect). Also drives "
             "the SVG rasterization / Wikimedia thumbnail width.",
    )
    parser.add_argument(
        "--format", dest="fmt", default="png", choices=VALID_FORMATS,
        help="Output container. png keeps alpha (default); webp is smaller.",
    )

    args = parser.parse_args()

    # Per-type strip-bg default.
    if args.strip_bg is None:
        args.strip_bg = STRIP_BG_DEFAULT[args.type]

    # jpeg/non-alpha containers can't carry a stripped background — png/webp only,
    # and both of our --format choices support alpha, so strip is always safe.
    want_alpha = bool(args.strip_bg) or args.fmt in ("png", "webp")

    job = resolve_job_dir(args.job)
    images_dir = job / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    out_path = images_dir / f"{args.name}.{args.fmt}"
    source_path = images_dir / f"{args.name}.source.txt"

    print(f"fetch_asset  type={args.type}  name={args.name}")
    print(f"  url={args.url}")
    print(f"  strip_bg={'on' if args.strip_bg else 'off'}  width={args.width or 'native'}  fmt={args.fmt}")

    start = time.perf_counter()

    # 1. Download.
    try:
        raw, ctype = _download(args.url)
    except Exception as e:  # noqa: BLE001
        duration = time.perf_counter() - start
        hint = FALLBACK_HINTS[args.type]
        log_event(
            job, tool="fetch_asset.py", event="fetch_failed",
            duration_seconds=duration,
            extra={"usage_role": args.type, "name": args.name, "url": args.url,
                   "error": str(e)[:300], "fallback_hint": hint},
        )
        print(f"\nFETCH FAILED: {e}", file=sys.stderr)
        print(f"FALLBACK: {hint}", file=sys.stderr)
        return 1

    rasterize_method = None
    # 2. SVG rasterization ladder (only when the payload is actually SVG).
    if _looks_like_svg(args.url, ctype, raw):
        print("  source is SVG → rasterizing to PNG")
        try:
            raw, rasterize_method = _rasterize_svg(raw, args.url, args.width)
            print(f"  ↳ rasterized via {rasterize_method}")
        except Exception as e:  # noqa: BLE001
            duration = time.perf_counter() - start
            hint = FALLBACK_HINTS[args.type]
            log_event(
                job, tool="fetch_asset.py", event="rasterize_failed",
                duration_seconds=duration,
                extra={"usage_role": args.type, "name": args.name, "url": args.url,
                       "error": str(e)[:300], "fallback_hint": hint},
            )
            print(f"\nRASTERIZE FAILED: {e}", file=sys.stderr)
            print(f"FALLBACK: {hint}", file=sys.stderr)
            return 1

    # 3. Encode/resize → normalized PNG/WebP.
    _encode(raw, out_path=out_path, fmt=args.fmt, width=args.width, want_alpha=want_alpha)
    size_kb = out_path.stat().st_size // 1024
    print(f"  ✓ wrote {out_path.name} ({size_kb}KB)")

    # 4. Background strip (in place).
    strip_method = "none"
    if args.strip_bg:
        if out_path.suffix.lower() in (".png", ".webp"):
            strip_method = _strip_background(out_path)
            if strip_method != "none":
                print(f"  ↳ background stripped via {strip_method} "
                      f"({out_path.stat().st_size // 1024}KB)")
            else:
                print("  ! background strip failed on every rung; kept un-stripped image.",
                      file=sys.stderr)
        else:
            print(f"  ! --strip-bg needs a png/webp container (got {out_path.suffix}); "
                  "skipping.", file=sys.stderr)

    source_path.write_text(args.url + "\n")

    # 5. Merge into the shared images/_index.json (never clobber other slots).
    index_path = images_dir / "_index.json"
    index: dict = json.loads(index_path.read_text()) if index_path.exists() else {}
    index[args.name] = {
        "file": str(out_path.relative_to(job)),
        "source_url": args.url,
        "source_file": str(source_path.relative_to(job)),
        "usage_role": args.type,
        "fetched": True,
        "format": args.fmt,
        "width": args.width,
        "svg_rasterized": rasterize_method,
        "bg_strip_method": strip_method,
    }
    index_path.write_text(json.dumps(index, indent=2))

    duration = time.perf_counter() - start
    log_event(
        job, tool="fetch_asset.py", event="asset_fetched",
        duration_seconds=duration,
        extra={
            "usage_role": args.type,
            "name": args.name,
            "url": args.url,
            "content_type": ctype,
            "format": args.fmt,
            "width": args.width,
            "svg_rasterized": rasterize_method,
            "bg_strip_method": strip_method,
            "file": str(out_path.relative_to(job)),
            "size_bytes": out_path.stat().st_size,
        },
    )

    print(f"\nfetched → {out_path}  in {duration:.1f}s")
    print("  (Read the PNG inline to confirm: identity/edition correct, edges "
          "clean, legible at overlay size.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
