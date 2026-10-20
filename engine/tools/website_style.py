"""
website_style — scrape a brand's fonts + colors from its website.

For client-branded shorts (the longform→shorts A2 path): when a video must use
"only fonts/colors present on the client's site" (e.g. berggruen.org), this pulls
the page + its stylesheets and extracts:
  - fonts        — Google Fonts families (highest signal — names them exactly) +
                   the most-declared `font-family` stacks
  - colors       — the most-frequent hex colors (brand palette candidates)
  - the raw counts so a human can pick the real brand picks from the noise

It is a HEURISTIC scrape (HTML + linked CSS regex), not a rendering engine — it
surfaces candidates, the human/agent confirms which are the brand's. Output is a
style-guide JSON the brand pack / overlays can draw on.

Usage:
  uv run python tools/website_style.py --job <id> --url https://berggruen.org
  uv run python tools/website_style.py --url https://example.com --max-css 8   # ad-hoc, no job

Common failure modes
--------------------
- JS-rendered sites hide most styling behind bundles → fewer hits; the Google-
  Fonts link + inline <style> usually still surface the headline font.
- Same-origin only for linked CSS by default (avoids pulling a CDN's whole theme);
  Google Fonts CSS is always followed because it names the families.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

UA = {"User-Agent": "Mozilla/5.0 (videoclaw website_style scrape)"}
_NAMED_SKIP = {"inherit", "initial", "unset", "transparent", "currentcolor", "none", "auto"}


def _fetch(url: str, timeout: int = 20) -> str:
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r.text


def _google_font_families(html: str) -> list[str]:
    fams: list[str] = []
    for m in re.finditer(r"fonts\.googleapis\.com/css2?\?([^\"'>]+)", html):
        for fam in re.findall(r"family=([^&:]+)", m.group(1)):
            fams.append(fam.replace("+", " ").strip())
    return fams


def _font_families(css: str) -> Counter:
    c: Counter = Counter()
    for m in re.finditer(r"font-family\s*:\s*([^;}{]+)", css, re.I):
        stack = m.group(1).strip().strip('"\'')
        first = re.split(r"\s*,\s*", stack)[0].strip().strip('"\'')
        if first and first.lower() not in _NAMED_SKIP and not first.startswith("var("):
            c[first] += 1
    return c


def _hex_colors(css: str) -> Counter:
    c: Counter = Counter()
    for m in re.finditer(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", css):
        h = m.group(1).lower()
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if h in ("000000", "ffffff"):  # keep, but they're rarely the *brand* accent
            pass
        c["#" + h] += 1
    return c


def scrape(url: str, *, max_css: int = 6, same_origin_only: bool = True) -> dict:
    html = _fetch(url)
    origin = urlparse(url).netloc

    css_blobs = [html]  # inline <style> + style="" attrs live in the HTML
    for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, re.I | re.S):
        css_blobs.append(m.group(1))

    # linked stylesheets
    hrefs = re.findall(r'<link[^>]+rel=["\']?stylesheet["\']?[^>]*>', html, re.I)
    css_urls = []
    for tag in hrefs:
        hm = re.search(r'href=["\']([^"\']+)["\']', tag)
        if not hm:
            continue
        css_url = urljoin(url, hm.group(1))
        is_gfonts = "fonts.googleapis.com" in css_url
        if same_origin_only and not is_gfonts and urlparse(css_url).netloc != origin:
            continue
        css_urls.append(css_url)
    for css_url in css_urls[:max_css]:
        try:
            css_blobs.append(_fetch(css_url))
        except Exception:
            continue

    all_css = "\n".join(css_blobs)
    gfonts = list(dict.fromkeys(_google_font_families(all_css)))  # de-dup, keep order
    fonts = _font_families(all_css)
    colors = _hex_colors(all_css)

    return {
        "url": url,
        "google_fonts": gfonts,                                  # exact named families
        "fonts": [{"family": f, "count": n} for f, n in fonts.most_common(8)],
        "colors": [{"hex": h, "count": n} for h, n in colors.most_common(12)],
        "stylesheets_scanned": len(css_urls[:max_css]) + 1,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--url", required=True)
    p.add_argument("--max-css", type=int, default=6, help="max linked stylesheets to fetch")
    p.add_argument("--all-origins", action="store_true",
                   help="also follow off-origin stylesheets (noisier)")
    # --job optional: write a style guide into the job dir when given
    p.add_argument("--job", default=None)
    args = p.parse_args()

    result = scrape(args.url, max_css=args.max_css, same_origin_only=not args.all_origins)

    out_path = None
    if args.job:
        from job import resolve_job_dir
        from log import log_event
        job = resolve_job_dir(args.job)
        out_path = job / "reference" / "website_style.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2))
        log_event(job, tool="website_style.py", event="artifact_written",
                  extra={"url": args.url, "google_fonts": result["google_fonts"],
                         "path": str(out_path.relative_to(job))})

    print(json.dumps(result, indent=2))
    if out_path:
        print(f"\nWrote {out_path}")
        print("Next: confirm the brand picks, then set them in the tenant pack / overlays.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
