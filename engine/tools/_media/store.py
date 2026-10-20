"""ChromaDB vector cache — DERIVED from the JSONL truth, never the source.

Adapted from ssrajadh/sentrysearch (Apache-2.0).

One ChromaDB persistent store per collection dir (assets/<tenant>/.index/), with
a separate Chroma collection per (media_type, backend, model) so incompatible
vectors never mix:  e.g.  video__gemini__default,  image__gemini__default.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

import chromadb

_UNSAFE = re.compile(r"[^a-zA-Z0-9._-]+")


def _slug(s: str) -> str:
    s = _UNSAFE.sub("_", (s or "").strip())
    return re.sub(r"_+", "_", s).strip("_") or "default"


def collection_name(media_type: str, backend: str, model: str | None) -> str:
    return f"{media_type}__{backend}__{_slug(model or 'default')}"


def make_id(source_file: str, start_time: float | None) -> str:
    raw = f"{source_file}:{start_time if start_time is not None else 'still'}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class MediaStore:
    """Vector cache for one (collection-dir, media_type, backend, model)."""

    def __init__(self, index_dir: Path, media_type: str, backend: str,
                 model: str | None = None):
        self._client = chromadb.PersistentClient(path=str(index_dir))
        self._media_type = media_type
        self._backend = backend
        self._model = model
        meta = {"hnsw:space": "cosine", "media_type": media_type,
                "embedding_backend": backend}
        if model:
            meta["embedding_model"] = model
        self._col = self._client.get_or_create_collection(
            name=collection_name(media_type, backend, model), metadata=meta)

    # ── write ────────────────────────────────────────────────────────────────
    def add(self, id_: str, embedding: list[float], metadata: dict) -> None:
        meta = {"source_file": metadata["source_file"],
                "media_type": self._media_type,
                "indexed_at": datetime.now(timezone.utc).isoformat()}
        if metadata.get("start_time") is not None:
            meta["start_time"] = float(metadata["start_time"])
        if metadata.get("end_time") is not None:
            meta["end_time"] = float(metadata["end_time"])
        if metadata.get("desc"):
            meta["desc"] = str(metadata["desc"])
        self._col.upsert(ids=[id_], embeddings=[embedding], metadatas=[meta])

    def add_many(self, rows: list[dict]) -> None:
        """rows: {id, embedding, source_file, start_time?, end_time?, desc?}."""
        if not rows:
            return
        ids, embs, metas = [], [], []
        now = datetime.now(timezone.utc).isoformat()
        for r in rows:
            ids.append(r["id"])
            embs.append(r["embedding"])
            m = {"source_file": r["source_file"], "media_type": self._media_type,
                 "indexed_at": now}
            if r.get("start_time") is not None:
                m["start_time"] = float(r["start_time"])
            if r.get("end_time") is not None:
                m["end_time"] = float(r["end_time"])
            if r.get("desc"):
                m["desc"] = str(r["desc"])
            metas.append(m)
        self._col.upsert(ids=ids, embeddings=embs, metadatas=metas)

    # ── read ───────────────────────────────────────────────────────────────────
    def search(self, query_embedding: list[float], n_results: int = 5,
               include_embeddings: bool = False) -> list[dict]:
        count = self._col.count()
        if count == 0:
            return []
        include = ["metadatas", "distances"] + (["embeddings"] if include_embeddings else [])
        res = self._col.query(query_embeddings=[query_embedding],
                              n_results=min(n_results, count), include=include)
        hits = []
        for i in range(len(res["ids"][0])):
            m = res["metadatas"][0][i]
            hit = {"source_file": m["source_file"],
                   "start_time": m.get("start_time"),
                   "end_time": m.get("end_time"),
                   "desc": m.get("desc"),
                   "score": 1.0 - res["distances"][0][i],
                   "distance": res["distances"][0][i]}
            if include_embeddings:
                hit["embedding"] = res["embeddings"][0][i]
            hits.append(hit)
        return hits

    def has_id(self, id_: str) -> bool:
        return len(self._col.get(ids=[id_], limit=1)["ids"]) > 0

    def count(self) -> int:
        return self._col.count()

    def remove_source(self, source_file: str) -> int:
        got = self._col.get(where={"source_file": source_file})
        ids = got["ids"]
        if ids:
            self._col.delete(ids=ids)
        return len(ids)

    def clear(self) -> int:
        n = self._col.count()
        if n:
            self._client.delete_collection(self._col.name)
        return n

    def stats(self) -> dict:
        total = self._col.count()
        if total == 0:
            return {"total": 0, "sources": []}
        metas = self._col.get(include=["metadatas"])["metadatas"]
        return {"total": total, "sources": sorted({m["source_file"] for m in metas})}
