"""
One-off: pull a balanced sample of top outlier transcripts for the viralizer
research pass. Writes JSONL so we never have to query again.

Run from repo root: uv run python agent/skills/viralizer_research/_pull_sample.py
"""

import json
import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]

OUT_DIR = Path(__file__).parent
PER_NICHE = 60          # top N per niche
PER_CREATOR_CAP = 2     # max 2 videos per handle
MIN_VIEWS = 50_000      # real virality
TOP_CHAMPIONS = 30      # extra cross-niche absolute-view champions

NICHES = [
    "business-life-and-marriage-coaches",
    "real-estate-and-property",
    "fitness-parenting-and-financial-coaches",
    "b2b-consultants-and-agency-owners",
    "professional-and-legal-services",
    "ecommerce-and-founders",
    "doctors-medical-and-clinics",
]

SELECT_COLS = """
    id, platform, url, creator_handle, creator_niche,
    creator_follower_count, creator_avg_views_at_capture,
    views_at_capture, likes_at_capture, comments_at_capture,
    outlier_score, engagement_rate, duration_seconds,
    published_at, hook_transcript, full_transcript, caption
"""


def cap_per_creator(rows, cap):
    seen = {}
    out = []
    for r in rows:
        h = r["creator_handle"]
        if seen.get(h, 0) >= cap:
            continue
        seen[h] = seen.get(h, 0) + 1
        out.append(r)
    return out


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    all_rows = []
    seen_ids = set()

    # Per-niche pull, ranked by capped_outlier × ln(views)
    for niche in NICHES:
        cur.execute(
            f"""
            SELECT {SELECT_COLS},
                   LEAST(outlier_score, 200) * LN(views_at_capture::float) AS rank_score
            FROM videos
            WHERE creator_niche = %s
              AND outlier_score >= 3
              AND views_at_capture >= %s
              AND full_transcript IS NOT NULL
              AND length(full_transcript) >= 80
            ORDER BY rank_score DESC
            LIMIT %s
            """,
            (niche, MIN_VIEWS, PER_NICHE * 4),  # pull extra for capping
        )
        rows = [dict(r) for r in cur.fetchall()]
        rows = cap_per_creator(rows, PER_CREATOR_CAP)[:PER_NICHE]
        for r in rows:
            seen_ids.add(str(r["id"]))
        all_rows.extend(rows)
        print(f"  {niche}: {len(rows)}")

    # Cross-niche absolute virality champions (highest views with non-trivial outlier)
    cur.execute(
        f"""
        SELECT {SELECT_COLS}, 0.0 AS rank_score
        FROM videos
        WHERE outlier_score >= 2
          AND full_transcript IS NOT NULL
          AND length(full_transcript) >= 80
          AND creator_niche != 'unknown'
        ORDER BY views_at_capture DESC
        LIMIT %s
        """,
        (TOP_CHAMPIONS * 4,),
    )
    champ_rows = [dict(r) for r in cur.fetchall()]
    champ_rows = cap_per_creator(champ_rows, PER_CREATOR_CAP)[:TOP_CHAMPIONS]
    added = 0
    for r in champ_rows:
        if str(r["id"]) in seen_ids:
            continue
        seen_ids.add(str(r["id"]))
        r["_champion"] = True
        all_rows.append(r)
        added += 1
    print(f"  champions added: {added}")

    cur.close()
    conn.close()

    # Stringify non-JSON-safe types
    for r in all_rows:
        r["id"] = str(r["id"])
        r["published_at"] = str(r["published_at"]) if r.get("published_at") else None

    out_path = OUT_DIR / "sample.jsonl"
    with out_path.open("w") as f:
        for r in all_rows:
            f.write(json.dumps(r, default=str) + "\n")

    summary = {
        "total": len(all_rows),
        "by_niche": {},
    }
    for r in all_rows:
        n = r["creator_niche"] or "unknown"
        summary["by_niche"][n] = summary["by_niche"].get(n, 0) + 1
    (OUT_DIR / "sample_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\nWrote {len(all_rows)} rows to {out_path}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
