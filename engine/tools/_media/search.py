"""Query → ranked hits, with optional near-duplicate dedupe.

Adapted from ssrajadh/sentrysearch (Apache-2.0). Dedupe inlined (greedy: drop any
hit whose cosine similarity to an already-kept higher-ranked hit exceeds the
threshold) so we don't pull in the highlights/anomaly module.
"""

from __future__ import annotations

import math

from store import MediaStore  # type: ignore


def _cos(a, b) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def search(query_embedding: list[float], store: MediaStore, n_results: int = 5,
           dedupe_threshold: float | None = None) -> list[dict]:
    include_emb = dedupe_threshold is not None
    hits = store.search(query_embedding, n_results=n_results, include_embeddings=include_emb)
    hits.sort(key=lambda h: h["score"], reverse=True)

    if dedupe_threshold is None or len(hits) <= 1:
        return [_clean(h) for h in hits]

    kept: list[dict] = []
    for h in hits:
        if all(_cos(h["embedding"], k["embedding"]) <= dedupe_threshold for k in kept):
            kept.append(h)
    return [_clean(h) for h in kept]


def _clean(h: dict) -> dict:
    return {"source_file": h["source_file"], "in": h["start_time"], "out": h["end_time"],
            "desc": h.get("desc"), "score": h["score"]}
