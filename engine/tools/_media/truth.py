"""Flat JSONL = the SOURCE OF TRUTH for the media library.

One JSON object per line in assets/<tenant>/{video,image}.jsonl. Committed,
diffable, portable. The ChromaDB cache (.index/) is rebuilt FROM this — never the
other way around. Each record carries its embedding vector so the cache can be
rebuilt offline with zero embed calls.

Record schema:
  {
    "id": "<16-hex>",            # make_id(source_file, start_time)
    "source_file": "/abs/path",  # POINTER — bytes stay where they live
    "in": 12.0,  "out": 42.0,    # window (null/absent for a still image)
    "media_type": "video"|"image",
    "backend": "gemini", "model": null, "dims": 768,
    "embedding": [..dims floats..],
    "desc": null,                # optional human-readable note / Gemini description
    "usage_role": null,          # optional ("broll","receipt",...)
    "indexed_at": "<iso8601>"
  }
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from paths import truth_path, index_dir  # type: ignore
from store import MediaStore, make_id  # type: ignore


def append_record(adir: Path, media_type: str, record: dict) -> None:
    record.setdefault("indexed_at", datetime.now(timezone.utc).isoformat())
    with open(truth_path(adir, media_type), "a") as fh:
        fh.write(json.dumps(record) + "\n")


def iter_records(adir: Path, media_type: str):
    p = truth_path(adir, media_type)
    if not p.exists():
        return
    with open(p) as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def indexed_ids(adir: Path, media_type: str, backend: str, model: str | None) -> set[str]:
    """IDs already present in the truth for this backend/model (resume/skip)."""
    out = set()
    for r in iter_records(adir, media_type):
        if r.get("backend") == backend and r.get("model") == model:
            out.add(r["id"])
    return out


def rebuild_cache(adir: Path, media_type: str, backend: str,
                  model: str | None) -> int:
    """Rebuild the ChromaDB cache for one (media_type, backend, model) from the
    JSONL truth. No embed calls. Returns the number of vectors loaded."""
    store = MediaStore(index_dir(adir), media_type, backend, model)
    store.clear()
    store = MediaStore(index_dir(adir), media_type, backend, model)
    rows = []
    for r in iter_records(adir, media_type):
        if r.get("backend") != backend or r.get("model") != model:
            continue
        if not r.get("embedding"):
            continue
        rows.append({"id": r["id"], "embedding": r["embedding"],
                     "source_file": r["source_file"],
                     "start_time": r.get("in"), "end_time": r.get("out"),
                     "desc": r.get("desc")})
    store.add_many(rows)
    return len(rows)
