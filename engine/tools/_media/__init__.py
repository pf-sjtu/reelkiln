"""videoclaw media-library engine (per-tenant footage/still retrieval).

Vendored + adapted from ssrajadh/sentrysearch (Apache-2.0). The premier
footage-retrieval method: index a tenant's REAL media, search it by description,
trim/crop the hit into a job. See MEDIA_LIBRARY_PLAN.md.

Design law (do not violate without updating the plan):
  · FLAT JSONL is the source of truth  (assets/<tenant>/{video,image}.jsonl) — committed.
  · ChromaDB (.index/) is a DERIVED, rebuildable cache — gitignored.
  · Embeddings are NATIVE multimodal (text/image/video share one vector space).
  · We store POINTERS ({source_file, in, out}), never copied bytes.
"""
