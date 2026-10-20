"""Reformat sample.jsonl into per-niche markdown bundles for systematic reading."""
import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
rows = [json.loads(l) for l in (ROOT / "sample.jsonl").open()]

by_niche = defaultdict(list)
for r in rows:
    by_niche[r["creator_niche"] or "unknown"].append(r)

# Sort each niche by rank: outlier × log(views)
import math
for niche, items in by_niche.items():
    items.sort(
        key=lambda r: min(r["outlier_score"] or 0, 200) * math.log((r["views_at_capture"] or 1) + 1),
        reverse=True,
    )

bundles_dir = ROOT / "bundles"
bundles_dir.mkdir(exist_ok=True)

for niche, items in by_niche.items():
    out = bundles_dir / f"{niche}.md"
    parts = [f"# {niche}\n\n{len(items)} videos.\n\n---\n\n"]
    for i, r in enumerate(items, 1):
        views = r["views_at_capture"] or 0
        outlier = r["outlier_score"] or 0
        followers = r["creator_follower_count"] or 0
        avg = r["creator_avg_views_at_capture"] or 0
        dur = r["duration_seconds"] or "?"
        hook = (r.get("hook_transcript") or "").strip()
        full = (r.get("full_transcript") or "").strip()
        parts.append(
            f"## {i}. @{r['creator_handle']} — {views:,} views, {outlier:.1f}x outlier, {dur}s\n"
            f"_followers={followers:,} | avg_views={avg:,.0f} | platform={r['platform']} | "
            f"published={r['published_at']}_\n"
            f"URL: {r['url']}\n\n"
            f"**Hook (first 60s):**\n{hook}\n\n"
            f"**Full transcript:**\n{full}\n\n---\n\n"
        )
    out.write_text("".join(parts))
    print(f"  {niche}: {out}")

print("done")
