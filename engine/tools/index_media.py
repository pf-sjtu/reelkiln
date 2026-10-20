"""
index_media.py — videoclaw's premier footage/still retrieval tool.

Index a tenant's REAL media into a per-tenant, searchable library, then find the
right clip/still by describing it in words (or with a reference image). The hit is
trimmed/copied into your job. This is the FIRST source to reach for — ahead of
stock and generation (priority: mine → shared → web-capture → stock → generate).
See MEDIA_LIBRARY_PLAN.md.

Design law (enforced by the engine in tools/_media/):
  · FLAT JSONL is truth   assets/<tenant>/{video,image}.jsonl   [committed]
  · ChromaDB is a cache   assets/<tenant>/.index/               [gitignored, rebuildable]
  · NATIVE multimodal embeddings (text/image/video in one space)
  · pointers, not bytes — a clip is only materialized on a search hit

USAGE
  # index footage (or a single file) for a tenant
  uv run python tools/index_media.py index <path> --tenant josephchin [--type video|image]
        [--backend gemini|dummy] [--chunk-duration 30] [--overlap 5] [--no-skip-still]

  # search by text → trims the best hit into the job (or assets/<tenant>/.clips/)
  # SCOPE IS EXPLICIT: --tenant is REQUIRED and takes one OR MORE slugs. There is
  # no default-all; an omitted scope is a hard error (never a cross-tenant search).
  uv run python tools/index_media.py search "him typing at his desk" --tenant josephchin
        [--job <id>] [-n 5] [--save-top 3] [--dedupe 0.9] [--no-trim] [--json] [--threshold 0.41]
  # union across tenants (rare; ranked as one comparable space):
  uv run python tools/index_media.py search "coffee pour" --tenant josephchin personal

  # search by image (reference frame)
  uv run python tools/index_media.py img ref.png --tenant josephchin [--job <id>]

  # rebuild the vector cache from the JSONL truth (no embed calls)
  uv run python tools/index_media.py reindex --tenant josephchin [--type video]

  # inspect / manage
  uv run python tools/index_media.py stats  --tenant josephchin
  uv run python tools/index_media.py remove <substr> --tenant josephchin
  # deregister a registered folder by EXACT path (records retained unless --purge)
  uv run python tools/index_media.py remove-source --path <folder> --tenant josephchin [--purge] [--json]
  uv run python tools/index_media.py reset  --tenant josephchin   (wipes truth + cache)

BACKENDS
  gemini (default) — Gemini Embedding 2; needs GEMINI_API_KEY in .env.
  dummy            — deterministic hash vectors; TEST-ONLY plumbing check (no key, no cost).
  local            — Qwen3-VL offline; scaffolded, not wired yet (Phase 1).

--collection {mine|shared}  mine=assets/<tenant>/ (default); shared=assets/_shared/.
"""

from __future__ import annotations

import argparse
import functools
import os
import sys
from pathlib import Path

# tools/ is on sys.path[0] (script launch) → job/log resolve. Add tools/_media for the engine.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "_media"))

from dotenv import load_dotenv

import chunker  # type: ignore
import library_lock  # type: ignore
import paths  # type: ignore
import search as search_engine  # type: ignore
import trim as trimmer  # type: ignore
import truth  # type: ignore
from embedder import get_embedder  # type: ignore
from paths import assets_dir, index_dir  # type: ignore
from store import MediaStore, make_id  # type: ignore

from _paths import ENV_PATH  # type: ignore
from job import resolve_job_dir  # type: ignore

load_dotenv(ENV_PATH if ENV_PATH.exists() else None)

BACKENDS = ("gemini", "dummy", "local")
# gemini/dummy are single-model; only the local backend varies its model.
_model_for = lambda backend, model: (model if backend == "local" else None)  # noqa: E731


def _serialized(label: str):
    """THE shared source/index mutation boundary for a collection.

    Every command that rewrites sources.json or the JSONL truth runs inside one
    cross-process lock, so `remove-source --purge` waits for an index run that
    already accepted this source instead of deleting the records it is still
    appending. Accepted work is never cancelled — the mutation queues behind it.
    """
    def wrap(fn):
        @functools.wraps(fn)
        def inner(args):
            adir = assets_dir(args.tenant, args.collection)
            with library_lock.exclusive_library_mutation(adir, holder=label):
                return fn(args)
        return inner
    return wrap


def _display_path(path: Path) -> Path:
    """Return a legible path without assuming assets live in the engine tree."""
    resolved = path.resolve()
    for root in (paths.ASSETS_ROOT.parent, paths.REPO_ROOT):
        try:
            return resolved.relative_to(root.resolve())
        except ValueError:
            continue
    return resolved


# ── index ────────────────────────────────────────────────────────────────────

def cmd_index(args) -> int:
    """Index a file/folder. A folder that contains the home folder is refused
    first, like `add-source` (exit 2, `source-too-broad`), before the lock,
    the embedder or any scan."""
    refused = _refuse_too_broad("index", args.path)
    if refused is not None:
        return refused
    return _index_path(args)


@_serialized("indexing")
def _index_path(args) -> int:
    adir = assets_dir(args.tenant, args.collection)
    model = _model_for(args.backend, args.model)
    embedder = get_embedder(args.backend, model=model,
                           job=resolve_job_dir(args.job) if args.job else None)
    dims = embedder.dimensions()

    path = Path(args.path).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"path not found: {path}")

    if args.type == "image":
        files = ([str(path)] if path.is_file()
                 else chunker.scan_directory(str(path), images=True))
        return _index_images(args, adir, embedder, dims, model, files)

    files = ([str(path)] if path.is_file() else chunker.scan_directory(str(path)))
    if not files:
        print(f"no supported video files under {path}")
        return 0
    return _index_videos(args, adir, embedder, dims, model, files)


def _seen_sigs(adir, media_type, backend, model) -> dict:
    """Map content-signature → source_file for everything already indexed (for this
    backend/model), so a re-added duplicate (same bytes, different name) is skipped."""
    paths = {r["source_file"] for r in truth.iter_records(adir, media_type)
             if r.get("backend") == backend and r.get("model") == model}
    sigs: dict = {}
    for p in paths:
        if os.path.exists(p):
            try:
                sigs[chunker.file_signature(p)] = p
            except Exception:  # noqa: BLE001
                pass
    return sigs


def _index_videos(args, adir, embedder, dims, model, files) -> int:
    store = MediaStore(index_dir(adir), "video", args.backend, model)
    seen = truth.indexed_ids(adir, "video", args.backend, model)
    seen_sigs = _seen_sigs(adir, "video", args.backend, model)
    new_chunks = new_files = skipped_still = dup_files = failed_chunks = 0

    for fi, vpath in enumerate(files, 1):
        vpath = os.path.abspath(vpath)
        base = os.path.basename(vpath)
        sig = None
        try:
            sig = chunker.file_signature(vpath)
        except Exception:  # noqa: BLE001
            pass
        if sig and sig in seen_sigs and seen_sigs[sig] != vpath:
            print(f"  ~ {base}: duplicate of {os.path.basename(seen_sigs[sig])} — skip")
            dup_files += 1
            continue
        if sig:
            seen_sigs[sig] = vpath
        try:
            spans = chunker.expected_chunk_spans(
                chunker.get_video_duration(vpath), args.chunk_duration, args.overlap)
        except Exception as e:  # noqa: BLE001
            print(f"  ! skip {base}: {e}", file=sys.stderr)
            failed_chunks += 1
            continue
        if spans and all(make_id(vpath, s) in seen for s, _ in spans):
            print(f"  = {base}: already indexed ({len(spans)} chunks)")
            continue

        chunks = chunker.chunk_video(vpath, args.chunk_duration, args.overlap)
        tmp_dir = os.path.dirname(chunks[0]["chunk_path"]) if chunks else None
        file_new = 0
        for ci, ch in enumerate(chunks, 1):
            cid = make_id(vpath, ch["start_time"])
            if cid in seen:
                continue
            if not args.no_skip_still and chunker.is_still_frame_chunk(ch["chunk_path"]):
                print(f"  - {base} [{ci}/{len(chunks)}] still — skip")
                skipped_still += 1
                continue
            ep = ch["chunk_path"]
            if not args.no_preprocess:
                ep = chunker.preprocess_chunk(ep, args.target_resolution, args.target_fps)
            print(f"  + {base} [{ci}/{len(chunks)}] embedding…")
            try:
                emb = embedder.embed_video_chunk(ep, verbose=args.verbose)
            except Exception as e:  # noqa: BLE001 — skip a bad chunk; re-run resumes
                print(f"  ! {base} [{ci}/{len(chunks)}] embed FAILED, skipping: "
                      f"{type(e).__name__}: {str(e)[:160]}", file=sys.stderr)
                failed_chunks += 1
                continue
            rec = {"id": cid, "source_file": vpath, "in": ch["start_time"],
                   "out": ch["end_time"], "media_type": "video",
                   "backend": args.backend, "model": model, "dims": dims,
                   "embedding": emb, "sig": sig, "desc": None, "usage_role": None}
            truth.append_record(adir, "video", rec)
            store.add(cid, emb, {"source_file": vpath, "start_time": ch["start_time"],
                                 "end_time": ch["end_time"]})
            seen.add(cid)
            file_new += 1
        if tmp_dir:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        if file_new:
            new_files += 1
            new_chunks += file_new

    bits = []
    if skipped_still:
        bits.append(f"{skipped_still} still")
    if dup_files:
        bits.append(f"{dup_files} dup files")
    if failed_chunks:
        bits.append(f"{failed_chunks} failed")
    extra = f"  (skipped {', '.join(bits)})" if bits else ""
    print(f"\nindexed {new_chunks} new chunks from {new_files} files{extra}. "
          f"cache total: {store.count()}.")
    print(f"truth → {_display_path(paths.truth_path(adir, 'video'))}")
    return 1 if failed_chunks else 0


def _index_images(args, adir, embedder, dims, model, files) -> int:
    if not files:
        print("no supported image files found.")
        return 0
    store = MediaStore(index_dir(adir), "image", args.backend, model)
    seen = truth.indexed_ids(adir, "image", args.backend, model)
    seen_sigs = _seen_sigs(adir, "image", args.backend, model)
    new = dup = failed = 0
    for ip in files:
        ip = os.path.abspath(ip)
        b = os.path.basename(ip)
        sig = None
        try:
            sig = chunker.file_signature(ip)
        except Exception:  # noqa: BLE001
            pass
        if sig and sig in seen_sigs and seen_sigs[sig] != ip:
            print(f"  ~ {b}: duplicate of {os.path.basename(seen_sigs[sig])} — skip")
            dup += 1
            continue
        iid = make_id(ip, None)
        if iid in seen:
            if sig:
                seen_sigs[sig] = ip
            continue
        # normalize (HEIC→JPEG, downscale) so Vertex accepts it
        try:
            jpg = chunker.preprocess_image(ip)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {b}: decode/convert failed, skip: {type(e).__name__}: {str(e)[:120]}",
                  file=sys.stderr)
            failed += 1
            continue
        print(f"  + {b} embedding…")
        try:
            emb = embedder.embed_image(jpg, verbose=args.verbose)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {b}: embed failed, skip: {type(e).__name__}: {str(e)[:140]}",
                  file=sys.stderr)
            failed += 1
            continue
        finally:
            try:
                os.unlink(jpg)
            except OSError:
                pass
        rec = {"id": iid, "source_file": ip, "in": None, "out": None,
               "media_type": "image", "backend": args.backend, "model": model,
               "dims": dims, "embedding": emb, "sig": sig, "desc": None, "usage_role": None}
        truth.append_record(adir, "image", rec)
        store.add(iid, emb, {"source_file": ip})
        seen.add(iid)
        if sig:
            seen_sigs[sig] = ip
        new += 1
    skipped = []
    if dup:
        skipped.append(f"{dup} dup")
    if failed:
        skipped.append(f"{failed} failed")
    extra = f"  (skipped {', '.join(skipped)})" if skipped else ""
    print(f"\nindexed {new} new stills{extra}. cache total: {store.count()}.")
    print(f"truth → {_display_path(paths.truth_path(adir, 'image'))}")
    return 1 if failed else 0


# ── search ───────────────────────────────────────────────────────────────────

def _out_dir(args, adir, media_type) -> Path:
    if args.job:
        jd = resolve_job_dir(args.job)
        return (jd / "footage") if media_type == "video" else (jd / "images")
    return adir / ".clips"


def _do_search(args, query_embedding, media_type) -> int:
    model = _model_for(args.backend, args.model)
    n = max(args.n, args.save_top or 0)

    # Resolve the EXPLICIT scope into concrete stores. Fail-closed is enforced in
    # main() — by here we always have a named scope. Each tenant's index is queried
    # on its own; because every record shares one embedding space (same model), a
    # global re-rank across tenants is valid. Single tenant = len==1 fast path,
    # behaviour-identical to per-tenant search. Multi = the blue-moon union.
    if args.collection == "shared":
        scopes = [("_shared", assets_dir(None, "shared"))]
    else:
        scopes = [(t, assets_dir(t, "mine")) for t in args.tenant]

    all_hits: list[dict] = []
    empties: list[str] = []
    for label, adir in scopes:
        store = MediaStore(index_dir(adir), media_type, args.backend, model)
        if store.count() == 0:
            empties.append(label)
            continue
        hits = search_engine.search(query_embedding, store, n_results=n,
                                    dedupe_threshold=args.dedupe)
        for h in hits:
            h["tenant"] = label
            h["_adir"] = adir  # per-hit materialization target (multi-tenant safe)
        all_hits.extend(hits)

    if not all_hits:
        joined = ", ".join(f"{l}/{args.collection}" for l, _ in scopes)
        print(f"no {media_type} indexed for {joined} (backend={args.backend}). "
              f"Run `index` first, or `reindex` to rebuild the cache from the JSONL truth.")
        return 1

    all_hits.sort(key=lambda h: h["score"], reverse=True)
    hits = all_hits[:n]
    multi = len(scopes) > 1

    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps([
            {"tenant": h["tenant"], "source_file": h["source_file"],
             "in": h["in"], "out": h["out"], "score": round(h["score"], 4),
             "desc": h.get("desc")}
            for h in hits]))
    else:
        for i, h in enumerate(hits, 1):
            loc = (f"@ {h['in']:.1f}-{h['out']:.1f}s" if h["in"] is not None else "(still)")
            tag = f"{{{h['tenant']}}} " if multi else ""
            print(f"  #{i} [{h['score']:.2f}] {tag}{os.path.basename(h['source_file'])} {loc}"
                  + (f"  — {h['desc']}" if h.get("desc") else ""))
        if empties:
            print(f"  (nothing indexed for: {', '.join(empties)})", file=sys.stderr)

    if hits[0]["score"] < args.threshold:
        print(f"\n  ! low confidence (best {hits[0]['score']:.2f} < {args.threshold}). "
              "The hit may not match; re-check the trimmed clip.", file=sys.stderr)

    if args.no_trim:
        return 0

    count = args.save_top or 1
    saved = []
    for h in hits[:count]:
        out_dir = _out_dir(args, h["_adir"], media_type)
        if media_type == "video" and h["in"] is not None:
            saved.append(trimmer.trim_video_hit(h["source_file"], h["in"], h["out"], out_dir,
                                                accurate=getattr(args, "accurate", False)))
        else:
            saved.append(trimmer.copy_image_hit(h["source_file"], out_dir))
    for p in saved:
        print(f"\nsaved → {p}")
    return 0


def cmd_search(args) -> int:
    model = _model_for(args.backend, args.model)
    embedder = get_embedder(args.backend, model=model,
                           job=resolve_job_dir(args.job) if args.job else None)
    return _do_search(args, embedder.embed_query(args.query, verbose=args.verbose),
                      args.type)


def cmd_img(args) -> int:
    model = _model_for(args.backend, args.model)
    embedder = get_embedder(args.backend, model=model,
                           job=resolve_job_dir(args.job) if args.job else None)
    img = os.path.abspath(os.path.expanduser(args.image))
    if not os.path.isfile(img):
        raise SystemExit(f"image not found: {img}")
    # Prefer a RETRIEVAL_QUERY image embedding where the backend distinguishes it.
    if hasattr(embedder, "embed_image_query"):
        q = embedder.embed_image_query(img)
    else:
        q = embedder.embed_image(img, verbose=args.verbose)
    return _do_search(args, q, args.type)


# ── manage ───────────────────────────────────────────────────────────────────

def _sources_path(adir: Path) -> Path:
    return adir / "sources.json"


def _load_sources(adir: Path) -> list[dict]:
    sp = _sources_path(adir)
    if not sp.exists():
        return []
    import json as _json
    return _json.loads(sp.read_text()).get("sources", [])


# #324 — a folder that contains the home folder (the home itself, any folder
# above it such as /Users, or /) walks Desktop, Documents, Downloads, Music… and
# macOS asks the user about each one. Refused with a stable code the app keys its
# copy on. The exit is non-zero, so an app that predates the code still shows an
# ordinary failed add.
SOURCE_TOO_BROAD = "source-too-broad"
SOURCE_TOO_BROAD_MESSAGE = "Pick your footage folder, not your whole home folder."


def _too_broad_source(path: str) -> str | None:
    """The resolved path when it contains this user's home folder, else None.

    `~` and symlinks are resolved first. "Contains" is the home itself, any
    ancestor of it, or `/`; a folder inside home or beside it is fine.
    """
    real = os.path.realpath(os.path.expanduser(path))
    key = chunker.path_key(real)
    if key == chunker.path_key(os.path.realpath(os.sep)):
        return real
    inside = key.rstrip(os.sep) + os.sep
    for home in chunker.home_dirs():
        home_key = chunker.path_key(home)
        if home_key == key or home_key.startswith(inside):
            return real
    return None


def _refuse_too_broad(command: str, path: str) -> int | None:
    """Exit code 2 with the `source-too-broad` line when `path` contains home."""
    broad = _too_broad_source(path)
    if broad is None:
        return None
    print(f"{command} refused ({SOURCE_TOO_BROAD}): {SOURCE_TOO_BROAD_MESSAGE} "
          f"{broad} contains your whole home folder; scanning it makes macOS ask for "
          f"access to Desktop, Documents, Downloads, Music and Photos. Nothing changed.",
          file=sys.stderr)
    return 2


def cmd_add_source(args) -> int:
    """Register a footage folder for a tenant so `sync` re-indexes it. The simple,
    low-knowledge way to grow a library: add-source once, then drop files + `sync`.

    Refuses a folder that contains the home folder before taking the library
    lock or writing anything (exit 2, code `source-too-broad` on stderr)."""
    refused = _refuse_too_broad("add-source", args.path)
    if refused is not None:
        return refused
    return _register_source(args)


@_serialized("registering a source")
def _register_source(args) -> int:
    import json as _json
    adir = assets_dir(args.tenant, args.collection)
    path = os.path.abspath(os.path.expanduser(args.path))
    sources = _load_sources(adir)
    existing = next((s for s in sources if s["path"] == path), None)
    if existing and existing.get("type") == args.type:
        print(f"already registered: {path} ({args.type})")
    elif existing:
        existing["type"] = args.type
        _sources_path(adir).write_text(_json.dumps({"sources": sources}, indent=2))
        print(f"updated source type: {path} → {args.type}")
    else:
        sources.append({"path": path, "type": args.type})
        _sources_path(adir).write_text(_json.dumps({"sources": sources}, indent=2))
        print(f"registered source: {path} ({args.type})")
    if args.index:
        return cmd_sync(args)
    print(f"now run:  uv run python tools/index_media.py sync --tenant {args.tenant}")
    return 0


@_serialized("indexing")
def cmd_sync(args) -> int:
    """Re-index every registered source for a tenant (idempotent — skips what's already
    indexed, only embeds new files). This is the 'I added more footage' quick action."""
    adir = assets_dir(args.tenant, args.collection)
    sources = _load_sources(adir)
    if not sources:
        print(f"no sources registered for {args.tenant}/{args.collection}. Add one:\n"
              f"  uv run python tools/index_media.py add-source --tenant {args.tenant} "
              f"--path <folder>")
        return 1
    model = _model_for(args.backend, args.model)
    embedder = get_embedder(args.backend, model=model,
                           job=resolve_job_dir(args.job) if args.job else None)
    dims = embedder.dimensions()
    code = 0
    for src in sources:
        p = Path(src["path"]); mt = src.get("type", "video")
        if not p.exists():
            print(f"  ! source not found (drive unmounted?), skipping: {p}",
                  file=sys.stderr)
            code = 1
            continue
        if mt in ("video", "all"):
            vf = ([str(p)] if p.is_file() else chunker.scan_directory(str(p)))
            print(f"syncing video: {p}  ({len(vf)} files)")
            code = max(code, _index_videos(args, adir, embedder, dims, model, vf))
        if mt in ("image", "all"):
            imf = ([str(p)] if p.is_file() else chunker.scan_directory(str(p), images=True))
            print(f"syncing image: {p}  ({len(imf)} files)")
            code = max(code, _index_images(args, adir, embedder, dims, model, imf))
    return code


def cmd_reindex(args) -> int:
    adir = assets_dir(args.tenant, args.collection)
    model = _model_for(args.backend, args.model)
    types = [args.type] if args.type else ["video", "image"]
    for mt in types:
        n = truth.rebuild_cache(adir, mt, args.backend, model)
        print(f"rebuilt {mt} cache: {n} vectors (backend={args.backend}).")
    return 0


def _distinct_files(adir: Path, media_type: str) -> set[str]:
    """Absolute source_file paths already present in truth (any backend)."""
    tp = paths.truth_path(adir, media_type)
    if not tp.exists():
        return set()
    return {r["source_file"] for r in truth.iter_records(adir, media_type)}


def cmd_stats(args) -> int:
    adir = assets_dir(args.tenant, args.collection)
    counts = {}
    for mt in ("video", "image"):
        tp = paths.truth_path(adir, mt)
        counts[mt] = {
            "records": sum(1 for _ in truth.iter_records(adir, mt)) if tp.exists() else 0,
            "files": len(_distinct_files(adir, mt)),
        }
    sources = [{"path": s["path"], "type": s.get("type", "video"),
                "exists": os.path.exists(s["path"])}
               for s in _load_sources(adir)]

    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps({"tenant": args.tenant, "collection": args.collection,
                           "video": counts["video"], "image": counts["image"],
                           "sources": sources}))
        return 0

    print(f"tenant={args.tenant}  collection={args.collection}  dir={_display_path(adir)}")
    for mt in ("video", "image"):
        print(f"  {mt}: {counts[mt]['records']} records "
              f"({counts[mt]['files']} distinct files) in truth")
    for s in sources:
        print(f"  source: {s['path']} ({s['type']}){'' if s['exists'] else '  ! MISSING'}")
    return 0


def cmd_scan(args) -> int:
    """Pre-flight for `sync`: estimate how many NEW files would be indexed, WITHOUT
    embedding. Local candidates get the same content-signature dedup check sync uses
    (first+last 1MB read — cheap on disk), so Finder copies ("IMG_1 2.MOV") don't
    show as forever-new. Cloud-mount candidates stay path-based (readdir only —
    reading bytes would hydrate the file); those may over-count a byte-identical
    rename, which is the safe direction for a spend gate."""
    adir = assets_dir(args.tenant, args.collection)
    sources = _load_sources(adir)
    known = {"video": _distinct_files(adir, "video"),
             "image": _distinct_files(adir, "image")}
    cloud_root = os.path.join(os.path.expanduser("~"), "Library", "CloudStorage")

    def _known_sigs(media_type: str) -> set:
        """Signatures of everything indexed: stored sig when present, else computed
        from the (local, reachable) original."""
        sigs = set()
        for r in truth.iter_records(adir, media_type):
            if r.get("sig"):
                sigs.add(r["sig"])
            else:
                sf = r["source_file"]
                if not sf.startswith(cloud_root) and os.path.exists(sf):
                    try:
                        sigs.add(chunker.file_signature(sf))
                    except Exception:  # noqa: BLE001
                        pass
        return sigs

    sig_cache: dict = {}

    def _is_new(f: str, media_type: str) -> bool:
        if os.path.abspath(f) in known[media_type]:
            return False
        if f.startswith(cloud_root):
            return True  # never read cloud bytes in a pre-flight
        if media_type not in sig_cache:
            sig_cache[media_type] = _known_sigs(media_type)
        try:
            return chunker.file_signature(f) not in sig_cache[media_type]
        except Exception:  # noqa: BLE001
            return True
    per_source, unreachable = [], []
    new = {"video": 0, "image": 0}
    total = {"video": 0, "image": 0}
    for src in sources:
        p = src["path"]; st = src.get("type", "video")
        if not os.path.exists(p):
            unreachable.append(p)
            per_source.append({"path": p, "type": st, "exists": False,
                               "files": 0, "new": 0})
            continue
        mts = ("video", "image") if st == "all" else (st,)
        s_files = s_new = 0
        for mt in mts:
            found = ([p] if os.path.isfile(p)
                     else chunker.scan_directory(p, images=(mt == "image")))
            n_new = sum(1 for f in found if _is_new(f, mt))
            total[mt] += len(found); new[mt] += n_new
            s_files += len(found); s_new += n_new
        per_source.append({"path": p, "type": st, "exists": True,
                           "files": s_files, "new": s_new})

    result = {"tenant": args.tenant, "new": new, "total": total,
              "newTotal": new["video"] + new["image"],
              "filesTotal": total["video"] + total["image"],
              "unreachable": unreachable, "sources": per_source}
    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps(result))
    else:
        print(f"scan {args.tenant}: {result['newTotal']} new / {result['filesTotal']} files "
              f"across {len(sources)} source(s).")
        for u in unreachable:
            print(f"  ! unreachable (drive unmounted?): {u}")
    return 0


def _trim_truth(adir: Path, backend: str, model: str | None, matches) -> dict[str, int]:
    """Drop every truth record whose source_file `matches`, then rebuild the cache
    from the trimmed truth (no embed calls). Returns per-media-type removal counts."""
    import json as _json
    removed_by_type = {"video": 0, "image": 0}
    for mt in ("video", "image"):
        tp = paths.truth_path(adir, mt)
        if not tp.exists():
            continue
        kept, removed = [], 0
        for r in truth.iter_records(adir, mt):
            if matches(r["source_file"]):
                removed += 1
            else:
                kept.append(r)
        if removed:
            with open(tp, "w") as fh:
                for r in kept:
                    fh.write(_json.dumps(r) + "\n")
            # rebuild the cache from the trimmed truth (simplest correct path)
            truth.rebuild_cache(adir, mt, backend, model)
        removed_by_type[mt] = removed
    return removed_by_type


@_serialized("removing records")
def cmd_remove(args) -> int:
    adir = assets_dir(args.tenant, args.collection)
    model = _model_for(args.backend, args.model)
    removed_by_type = _trim_truth(
        adir, args.backend, model,
        lambda f: any(pat in f for pat in args.patterns))
    for mt, removed in removed_by_type.items():
        if removed:
            print(f"  {mt}: removed {removed} records matching {args.patterns}")
    print(f"removed {sum(removed_by_type.values())} records total.")
    return 0


def _pending_removal_path(adir: Path) -> Path:
    """Journal for a removal that started but did not finish. Lives in the
    gitignored cache dir — it is recovery state, not committed truth."""
    return index_dir(adir) / "pending-removal.json"


def _read_pending_removal(adir: Path) -> dict | None:
    p = _pending_removal_path(adir)
    if not p.exists():
        return None
    import json as _json
    try:
        return _json.loads(p.read_text())
    except ValueError:
        return None


def _covers(root: str, source_file: str) -> bool:
    """True when `root` is the indexed file itself or one of its ancestors."""
    return source_file == root or source_file.startswith(root.rstrip(os.sep) + os.sep)


@_serialized("removing a source")
def cmd_remove_source(args) -> int:
    """Deregister a footage folder from sources.json by EXACT path so `sync` stops
    re-indexing it. Already-indexed records are RETAINED unless --purge is passed.

    A purge only ever touches the source actually being removed, and never a
    record that another still-registered source (a nested root included) also
    covers. An unregistered path is #200's no-op — never a prefix wildcard that
    takes records out of sources that are still registered. The one exception is
    resuming this tool's own journalled, half-finished removal (re-running the
    same command is the safe retry). The collection keeps ONE journal, so while
    a different source's removal is still pending this refuses rather than
    overwriting the recovery state that removal needs. Runs inside the shared
    mutation lock, so an accepted index run has finished before anything here is
    written.
    """
    import json as _json
    adir = assets_dir(args.tenant, args.collection)
    path = os.path.abspath(os.path.expanduser(args.path))
    sources = _load_sources(adir)
    kept = [s for s in sources if s["path"] != path]
    registered = len(kept) != len(sources)
    pending = _read_pending_removal(adir)
    if pending and any(s["path"] == pending.get("path") for s in sources):
        # Re-registered: that removal was undone, so its purge intent describes
        # nothing and must not reach a later gesture for the same path.
        _pending_removal_path(adir).unlink(missing_ok=True)
        pending = None
    resuming = bool(pending) and pending.get("path") == path

    def _emit(result: dict, lines: list[str]) -> int:
        if getattr(args, "json", False):
            print(_json.dumps(result))
        else:
            for line in lines:
                print(line)
        if result["outcome"] == "partial":
            print(f"PARTIAL: {result['warning']}", file=sys.stderr)
        return 0

    def _remaining(srcs: list[dict]) -> list[dict]:
        return [{"path": s["path"], "type": s.get("type", "video"),
                 "exists": os.path.exists(s["path"])} for s in srcs]

    if pending and not resuming:
        # Structured refusal on the same rail as `partial`: the caller reads
        # `outcome`, not the exit code, so the recovery command reaches them.
        other = pending["path"]
        finish = (f"index_media.py remove-source --path {other}"
                  f"{' --purge' if pending.get('purge') else ''} "
                  f"--tenant {args.tenant}")
        warning = (f"another removal is still unfinished ({other}); finish it "
                   f"first with: {finish}")
        return _emit(
            {"tenant": args.tenant, "collection": args.collection, "path": path,
             "outcome": "blocked", "registered": registered, "purged": False,
             "purgedRecords": {"video": 0, "image": 0}, "purgedTotal": 0,
             "changed": False, "recoverable": False, "pendingPath": other,
             "warning": warning, "sources": _remaining(sources)},
            [f"nothing changed: {path}", f"  {warning}"])

    if not registered and not resuming:
        # Not this tenant's source and no interrupted removal to finish: refuse
        # the purge outright rather than deleting by prefix. /x is not a source
        # root just because /x/Footage is one.
        return _emit(
            {"tenant": args.tenant, "collection": args.collection, "path": path,
             "outcome": "not-registered", "registered": False, "purged": False,
             "purgedRecords": {"video": 0, "image": 0}, "purgedTotal": 0,
             "changed": False, "recoverable": False, "warning": None,
             "sources": _remaining(sources)},
            [f"not registered, nothing changed: {path}",
             *(["  --purge ignored: this path is not a registered source, so its "
                "records belong to sources that still are."] if args.purge else []),
             f"  {len(sources)} source(s) still registered."])

    # A resumed removal finishes the purge it was journalled with, so an
    # interrupted `--purge` cannot silently degrade into a retain on retry.
    purge = bool(args.purge) or (resuming and bool(pending.get("purge")))
    _pending_removal_path(adir).write_text(
        _json.dumps({"path": path, "purge": purge}))

    if registered:
        _sources_path(adir).write_text(_json.dumps({"sources": kept}, indent=2))

    purged = {"video": 0, "image": 0}
    outcome, warning = "removed", None
    if purge:
        # A file under this root that a source we are KEEPING also covers stays:
        # /x/A/Child is its own registered source, and dropping its records would
        # both break search and make the next paid sync re-embed them.
        kept_roots = [s["path"] for s in kept]
        model = _model_for(args.backend, args.model)
        try:
            purged = _trim_truth(
                adir, args.backend, model,
                lambda f: _covers(path, f)
                and not any(_covers(root, f) for root in kept_roots))
            if resuming:
                # The interrupted run may already have trimmed the truth, in
                # which case this pass drops nothing and would skip the rebuild
                # that is exactly the part that failed. Rebuild unconditionally.
                for mt in ("video", "image"):
                    truth.rebuild_cache(adir, mt, args.backend, model)
        except Exception as exc:  # noqa: BLE001 — any rebuild failure is recoverable
            outcome = "partial"
            warning = (f"the folder was deregistered, but discarding its indexed "
                       f"records did not finish ({exc}). The library list is "
                       f"correct; search may still return this folder until you "
                       f"finish it with: index_media.py remove-source --path "
                       f"{path} --purge --tenant {args.tenant}")
    if outcome == "removed":
        _pending_removal_path(adir).unlink(missing_ok=True)

    purged_total = purged["video"] + purged["image"]
    result = {"tenant": args.tenant, "collection": args.collection, "path": path,
              "outcome": outcome, "registered": registered, "purged": purge,
              "purgedRecords": purged, "purgedTotal": purged_total,
              "changed": True, "recoverable": outcome == "partial",
              "warning": warning, "sources": _remaining(kept)}

    lines = [f"deregistered source: {path}" if registered
             else f"resumed an interrupted removal: {path}"]
    if purge:
        lines.append(f"  purged {purged_total} records "
                     f"(video {purged['video']}, image {purged['image']}).")
    else:
        lines.append("  indexed records retained — pass --purge to drop them too.")
    lines.append(f"  {len(kept)} source(s) still registered.")
    return _emit(result, lines)


@_serialized("resetting the collection")
def cmd_reset(args) -> int:
    adir = assets_dir(args.tenant, args.collection)
    if not args.yes:
        print("refusing to wipe without --yes (this deletes the JSONL truth + cache).")
        return 1
    import shutil
    for mt in ("video", "image"):
        paths.truth_path(adir, mt).unlink(missing_ok=True)
    shutil.rmtree(index_dir(adir), ignore_errors=True)
    print(f"reset {args.tenant}/{args.collection}: truth + cache wiped.")
    return 0


# ── CLI ──────────────────────────────────────────────────────────────────────

def _add_index_opts(p):
    p.add_argument("--job", help="video job for paid embedding recovery and spend tracking.")
    p.add_argument("--chunk-duration", type=int, default=30)
    p.add_argument("--overlap", type=int, default=5)
    p.add_argument("--no-preprocess", action="store_true")
    p.add_argument("--target-resolution", type=int, default=480)
    p.add_argument("--target-fps", type=int, default=5)
    p.add_argument("--no-skip-still", action="store_true")


def _common(p, *, need_backend=True, tenant_multi=False):
    if tenant_multi:
        # Read ops take ONE OR MORE tenants — the search scope is always explicit.
        # There is no "all tenants" default: an omitted scope is a hard error
        # (see main()), never a silent search across everyone's footage.
        p.add_argument("--tenant", nargs="+", metavar="SLUG",
                       help="REQUIRED unless --collection shared: one or more tenant "
                            "slugs to search across (no default scope; omitting it exits 2). "
                            "Multiple = merge, ranked as one.")
    else:
        p.add_argument("--tenant", help="tenant slug (required for --collection mine).")
    p.add_argument("--collection", choices=paths.COLLECTIONS, default="mine")
    if need_backend:
        p.add_argument("--backend", choices=BACKENDS, default="gemini")
        p.add_argument("--model", default=None, help="local-backend model (qwen8b/qwen2b).")
    p.add_argument("--verbose", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("index", allow_abbrev=False, help="index a file/folder into the library")
    pi.add_argument("path", help="video/image file or directory")
    pi.add_argument("--type", choices=paths.MEDIA_TYPES, default="video")
    _add_index_opts(pi)
    _common(pi)
    pi.set_defaults(func=cmd_index)

    pad = sub.add_parser("add-source", allow_abbrev=False, help="register a footage folder for a tenant (then sync)")
    pad.add_argument("--path", required=True, help="footage folder/file to register")
    pad.add_argument("--type", choices=(*paths.MEDIA_TYPES, "all"), default="all",
                     help="all = index both video AND images in the folder (default).")
    pad.add_argument("--index", action="store_true", help="index immediately after registering")
    _add_index_opts(pad)
    _common(pad)
    pad.set_defaults(func=cmd_add_source)

    prsc = sub.add_parser("remove-source", allow_abbrev=False,
                          help="deregister a footage folder by EXACT path (sync stops re-indexing it)")
    prsc.add_argument("--path", required=True,
                      help="exact registered path to deregister (no substring/prefix match).")
    prsc.add_argument("--purge", action="store_true",
                      help="also drop this source's indexed records from truth and rebuild the "
                           "cache. DEFAULT: records are RETAINED and only the registration goes.")
    prsc.add_argument("--json", action="store_true",
                      help="emit the deregister result as JSON (app-facing).")
    _common(prsc)
    prsc.set_defaults(func=cmd_remove_source)

    psy = sub.add_parser("sync", allow_abbrev=False, help="re-index all registered sources (idempotent — 'I added footage')")
    _add_index_opts(psy)
    _common(psy)
    psy.set_defaults(func=cmd_sync)

    ps = sub.add_parser("search", allow_abbrev=False, help="text query → trim the best hit",
                        description="Text query → trim the best hit. --tenant <slug> is "
                                    "REQUIRED (or --collection shared).")
    ps.add_argument("query")
    ps.add_argument("--type", choices=paths.MEDIA_TYPES, default="video")
    ps.add_argument("--job", help="video job for paid embedding recovery and deposited footage/images.")
    ps.add_argument("-n", type=int, default=5)
    ps.add_argument("--save-top", type=int, default=None)
    ps.add_argument("--dedupe", type=float, default=None)
    ps.add_argument("--threshold", type=float, default=0.30,
                    help="low-confidence cutoff. text→video cosine runs lower than "
                         "text→text; ~0.30 is calibrated. Trust RELATIVE ranking too.")
    ps.add_argument("--no-trim", action="store_true")
    ps.add_argument("--json", action="store_true",
                    help="emit hits as a JSON array (app-facing; implies list-only unless --save-top).")
    ps.add_argument("--accurate", action="store_true",
                    help="frame-accurate trim (re-encode; slow on 4K). Default = fast stream-copy.")
    _common(ps, tenant_multi=True)
    ps.set_defaults(func=cmd_search)

    pm = sub.add_parser("img", allow_abbrev=False, help="image query → trim the best hit",
                        description="Image query → trim the best hit. --tenant <slug> is "
                                    "REQUIRED (or --collection shared).")
    pm.add_argument("image")
    pm.add_argument("--type", choices=paths.MEDIA_TYPES, default="video")
    pm.add_argument("--job")
    pm.add_argument("-n", type=int, default=5)
    pm.add_argument("--save-top", type=int, default=None)
    pm.add_argument("--dedupe", type=float, default=None)
    pm.add_argument("--threshold", type=float, default=0.30)
    pm.add_argument("--no-trim", action="store_true")
    pm.add_argument("--json", action="store_true",
                    help="emit hits as a JSON array (app-facing; implies list-only unless --save-top).")
    pm.add_argument("--accurate", action="store_true",
                    help="frame-accurate trim (re-encode; slow on 4K). Default = fast stream-copy.")
    _common(pm, tenant_multi=True)
    pm.set_defaults(func=cmd_img)

    pr = sub.add_parser("reindex", allow_abbrev=False, help="rebuild the vector cache from JSONL truth")
    pr.add_argument("--type", choices=paths.MEDIA_TYPES, default=None)
    _common(pr)
    pr.set_defaults(func=cmd_reindex)

    pt = sub.add_parser("stats", allow_abbrev=False, help="show what's indexed")
    pt.add_argument("--json", action="store_true", help="emit stats + sources as JSON.")
    _common(pt, need_backend=False)
    pt.set_defaults(func=cmd_stats)

    psc = sub.add_parser("scan", allow_abbrev=False, help="pre-flight: estimate NEW files sync would index (no embed)")
    psc.add_argument("--json", action="store_true", help="emit the scan result as JSON.")
    _common(psc, need_backend=False)
    psc.set_defaults(func=cmd_scan)

    prm = sub.add_parser("remove", allow_abbrev=False, help="remove sources by path substring")
    prm.add_argument("patterns", nargs="+")
    _common(prm)
    prm.set_defaults(func=cmd_remove)

    prs = sub.add_parser("reset", allow_abbrev=False, help="wipe a collection's truth + cache")
    prs.add_argument("--yes", action="store_true")
    _common(prs, need_backend=False)
    prs.set_defaults(func=cmd_reset)
    return p


def main() -> int:
    args = build_parser().parse_args()
    # Fail closed: every "mine" operation must name its tenant(s) explicitly. A
    # missing scope is a hard error, NEVER a silent default across all tenants —
    # cross-tenant isolation must be an explicit, positive act, not an omission.
    if getattr(args, "collection", "mine") == "mine" and not getattr(args, "tenant", None):
        print(f"index_media {args.cmd}: --tenant is required — name the library to use, "
              "e.g. --tenant <slug> (search/img accept several: --tenant <a> <b>), or pass "
              "--collection shared for the shared library. Refusing to run without a scope.",
              file=sys.stderr)
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
