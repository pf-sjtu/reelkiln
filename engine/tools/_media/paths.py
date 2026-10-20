"""Per-tenant asset layout — where the media library lives on disk.

  assets/<tenant>/          ← collection "mine"  (this tenant's real media)
  assets/_shared/           ← collection "shared" (curated, reusable across tenants)
    video.jsonl             ← FLAT truth for footage   [committed]
    image.jsonl             ← FLAT truth for stills     [committed]
    style_sources/          ← confirmed style refs      [committed]
    .index/                 ← ChromaDB cache, rebuilt from *.jsonl  [GITIGNORED]
"""

from __future__ import annotations

import os
from pathlib import Path

# tools/_media/paths.py → parents[2] == repo root (the ENGINE in the shipped app).
REPO_ROOT = Path(__file__).resolve().parents[2]

# Assets are USER DATA → they live in the workspace (VIDEOCLAW_WORKSPACE) so they
# survive engine updates. No env set (dev setup) → repo root, behavior unchanged.
# Kept in lockstep with tools/_paths.py ASSETS_DIR (same env var, same default).
ASSETS_ROOT = Path(os.environ.get("VIDEOCLAW_WORKSPACE", str(REPO_ROOT))) / "assets"

COLLECTIONS = ("mine", "shared")
MEDIA_TYPES = ("video", "image")


def assets_dir(tenant: str | None, collection: str = "mine") -> Path:
    """Resolve the assets directory for a (tenant, collection) pair.

    collection="mine"   → assets/<tenant>/   (tenant REQUIRED)
    collection="shared" → assets/_shared/    (tenant ignored)
    """
    if collection not in COLLECTIONS:
        raise ValueError(f"collection must be one of {COLLECTIONS}, got {collection!r}")
    if collection == "shared":
        d = ASSETS_ROOT / "_shared"
    else:
        if not tenant:
            raise ValueError("collection 'mine' requires --tenant")
        d = ASSETS_ROOT / tenant
    d.mkdir(parents=True, exist_ok=True)
    return d


def truth_path(adir: Path, media_type: str) -> Path:
    if media_type not in MEDIA_TYPES:
        raise ValueError(f"media_type must be one of {MEDIA_TYPES}, got {media_type!r}")
    return adir / f"{media_type}.jsonl"


def index_dir(adir: Path) -> Path:
    """The gitignored ChromaDB cache directory for this collection."""
    d = adir / ".index"
    d.mkdir(parents=True, exist_ok=True)
    return d


def style_sources_dir(adir: Path) -> Path:
    d = adir / "style_sources"
    d.mkdir(parents=True, exist_ok=True)
    return d
