#!/usr/bin/env python3
"""
project_brief — emit the COMPACT project brief the SessionStart preflight injects
so the agent starts already-briefed on the active project (LAUNCH_SPEC §3).

Given the project (tenant) slug the app sets in the session env, this prints a
one-screenful producer-facing brief:

  • the last few FINISHED videos (what they were)   ← completed draft; ★ = favourite
  • the locked look (caption preset, palette, fonts, grade)
  • b-roll looks in rotation
  • how big the media library is

stdlib-only (same constraint as qa_gate.py — it runs inside a fast hook, no uv /
venv). Best-effort and fail-QUIET: every block degrades to "nothing to show"
rather than erroring, because a broken brief must never brick a session.

  uv run python tools/project_brief.py --tenant <slug> --workspace <dir>
  python3 tools/project_brief.py --tenant <slug>          # workspace from env

Resolution: --workspace > $VIDEOCLAW_WORKSPACE > $CLAUDE_PROJECT_DIR > cwd. User
data (jobs/, assets/, taste/packs/) lives in the WORKSPACE (World-1 split); this
never reads the engine dir. Emits NOTHING (exit 0, no output) when no tenant is
given — that is JC's dev default and preserves today's behavior.

The text here is deliberately plain producer language; it becomes context the
model reads before its first reply. Internal terms (tenant/job/…) appear only in
THIS tool's flags and code, never in the emitted prose — that's the jargon ban.
"""
from __future__ import annotations

import argparse
import glob
import heapq
import json
import math
import os
import re
import stat
import sys
import time

MAX_RECENT = 3
RECENT_LIMIT = 200  # cap dirs scanned so a huge jobs/ never stalls the hook


def _workspace(arg: str | None) -> str:
    return (
        arg
        or os.environ.get("VIDEOCLAW_WORKSPACE")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.getcwd()
    )


def _safe_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _linecount(path: str) -> int:
    n = 0
    try:
        with open(path, "rb") as f:
            for _ in f:
                n += 1
    except OSError:
        return 0
    return n


# ── recent finished videos ────────────────────────────────────────────────────
def _finished_videos(ws: str, tenant: str) -> list[dict]:
    """Jobs owned by `tenant` (promise.json.tenant) with a FINISHED draft.
    Finished = completion evidence independent of any review (see
    `_completed_draft`): a finished render is a complete draft whether or not
    a quality review ran (#266), so review receipts are not consulted. A `★` /
    `.final` favourite marker is reported separately as `starred`. Newest
    first (by the draft file's mtime), capped at MAX_RECENT."""
    out: list[dict] = []
    promises = sorted(
        glob.glob(os.path.join(ws, "jobs", "*", "promise.json")),
        key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0,
        reverse=True,
    )[:RECENT_LIMIT]
    for pj in promises:
        job_dir = os.path.dirname(pj)
        data = _safe_json(pj) or {}
        if str(data.get("tenant", "")).strip() != tenant:
            continue
        try:
            draft_mtime = _completed_draft(job_dir)
        except Exception:  # one odd job must never take down the brief
            draft_mtime = None
        if draft_mtime is None:
            continue
        starred = os.path.exists(os.path.join(job_dir, ".final")) or os.path.exists(
            os.path.join(job_dir, "★")
        )
        out.append(
            {
                "name": os.path.basename(job_dir),
                "mtime": draft_mtime,
                "starred": starred,
                "gist": _job_gist(job_dir, data),
            }
        )
    out.sort(key=lambda j: j["mtime"], reverse=True)
    return out[:MAX_RECENT]


# Render-completion record contract (shared with the renderers, #265, and the
# app, videoclaw-app#904): jobs/<id>/renders/<sha256>.json, written atomically
# after the deliverable is published, exactly
#   {"schema": "videoclaw.render-complete/v1", "sha256": <hex>,
#    "path": <job-relative path, e.g. final.mp4 or audio/final_mix.mp4>,
#    "bytes": <size>, "tool": <renderer>, "completed_at": <unix seconds>}
#
# The brief is informational context for the model, not a gate. It binds a
# record to its deliverable by size + mtime only (no full-file SHA in a fast
# SessionStart hook), so a same-size replacement written within the skew
# window can be listed; that is an accepted limitation, not a correctness
# issue. Records are best-effort (a publication can succeed without one), so
# a missing or stale record falls back to the structural MP4 check instead of
# hiding a completed draft. Every file is read defensively so one bad file
# never breaks the brief.
RENDER_RECORD_SCHEMA = "videoclaw.render-complete/v1"
MAX_RENDER_RECORDS = 64        # newest record files (by mtime) read per job
MAX_RECORD_BYTES = 4096        # a record is ~300 bytes; anything larger is ignored
MAX_MP4_BOXES = 4096           # top-level boxes walked before giving up
CLOCK_SKEW_SEC = 2.0           # mtime vs completed_at, either direction
MAX_FUTURE_SEC = 24 * 3600     # completed_at may not sit further in the future


def _completed_draft(job_dir: str) -> float | None:
    """mtime of the job's newest completed draft, or None.

    Preferred evidence is a render-complete record: it counts when the
    deliverable at its `path` (final.mp4, or a score-last mix such as
    audio/final_mix.mp4) is a regular file inside the job, still has the
    recorded size, and was not rewritten after `completed_at` (within
    CLOCK_SKEW_SEC). A matching record wins.

    Records are best-effort: the publisher still publishes when hashing runs
    out of time or the record write fails (#269), so a later successful
    publication can have no record of its own. When no record matches the
    current deliverable, the current files (final.mp4 plus any path a record
    names) fall back to the structural check: a contained, media-bearing,
    structurally complete MP4. A render that died mid-write fails both.
    """
    records = _render_records(job_dir)
    best: float | None = None
    for record in records:
        try:
            mtime = _record_matches(job_dir, record)
        except (OSError, ValueError, OverflowError, TypeError):
            mtime = None
        if mtime is not None and (best is None or mtime > best):
            best = mtime
    if best is not None:
        return best
    candidates = ["final.mp4"]
    for record in records:
        rel = record.get("path")
        if isinstance(rel, str) and rel not in candidates:
            candidates.append(rel)
    for rel in candidates:
        try:
            found = _contained_regular_file(job_dir, rel)
            if found is None:
                continue
            path, st = found
            if st.st_size <= 0 or not _mp4_structurally_complete(path):
                continue
        except (OSError, ValueError, OverflowError):
            continue
        if best is None or st.st_mtime > best:
            best = st.st_mtime
    return best


def _newest_record_files(job_dir: str) -> list[str]:
    """Up to MAX_RENDER_RECORDS newest `renders/*.json` files, by mtime."""
    candidates: list[tuple[float, str]] = []
    try:
        with os.scandir(os.path.join(job_dir, "renders")) as entries:
            for entry in entries:
                try:
                    if entry.name.endswith(".json") and entry.is_file(follow_symlinks=False):
                        candidates.append((entry.stat(follow_symlinks=False).st_mtime, entry.path))
                except OSError:
                    continue
    except OSError:
        return []
    return [path for _, path in heapq.nlargest(MAX_RENDER_RECORDS, candidates)]


def _render_records(job_dir: str) -> list[dict]:
    """Well-formed render-complete/v1 records for the job; anything else is skipped."""
    out: list[dict] = []
    now = time.time()
    for path in _newest_record_files(job_dir):
        try:
            with open(path, "rb") as handle:
                raw = handle.read(MAX_RECORD_BYTES + 1)
            if len(raw) > MAX_RECORD_BYTES:
                continue
            record = json.loads(raw.decode("utf-8"))
            if not isinstance(record, dict) or record.get("schema") != RENDER_RECORD_SCHEMA:
                continue
            completed_at = record.get("completed_at")
            size = record.get("bytes")
            rel = record.get("path")
            if isinstance(completed_at, bool) or not isinstance(completed_at, (int, float)):
                continue
            completed_at = float(completed_at)  # OverflowError for absurd ints
            if not math.isfinite(completed_at) or completed_at > now + MAX_FUTURE_SEC:
                continue
            if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
                continue
            if not isinstance(rel, str) or not rel or not isinstance(record.get("sha256"), str):
                continue
            out.append({**record, "completed_at": completed_at})
        except (OSError, ValueError, OverflowError, TypeError, UnicodeDecodeError):
            continue  # json.JSONDecodeError is a ValueError
    return out


def _contained_regular_file(job_dir: str, rel: str) -> tuple[str, os.stat_result] | None:
    """Resolve a job-relative path; None unless it is a regular file inside the
    job after following symlinks (no absolute paths, backslashes or NULs)."""
    if not rel or os.path.isabs(rel) or "\\" in rel or "\x00" in rel:
        return None
    root = os.path.realpath(job_dir)
    target = os.path.realpath(os.path.join(root, rel))
    if target == root or os.path.commonpath([root, target]) != root:
        return None
    st = os.stat(target)
    if not stat.S_ISREG(st.st_mode):
        return None
    return target, st


def _record_matches(job_dir: str, record: dict) -> float | None:
    """The recorded deliverable's mtime when it is still the recorded bytes."""
    found = _contained_regular_file(job_dir, record["path"])
    if found is None:
        return None
    _, st = found
    if st.st_size != record["bytes"]:
        return None
    if st.st_mtime > record["completed_at"] + CLOCK_SKEW_SEC:
        return None  # rewritten after the renderer recorded it
    return st.st_mtime


def _mp4_structurally_complete(path: str) -> bool:
    """True when the top-level ISO-BMFF boxes parse exactly to EOF and the
    layout carries media: `moov` (or `moof` fragments) plus a non-empty
    `mdat`. Reads only box headers (stdlib, fast hook)."""
    size = os.path.getsize(path)
    if size < 16:
        return False
    seen: set[bytes] = set()
    media_bytes = 0
    offset = 0
    with open(path, "rb") as handle:
        for _ in range(MAX_MP4_BOXES):
            if offset == size:
                return media_bytes > 0 and bool(seen & {b"moov", b"moof"})
            if size - offset < 8:
                return False
            handle.seek(offset)
            header = handle.read(8)
            box_size = int.from_bytes(header[:4], "big")
            box_type = header[4:8]
            if not all(32 <= b <= 126 for b in box_type):
                return False
            header_size = 8
            if box_size == 1:  # 64-bit largesize follows the header
                if size - offset < 16:
                    return False
                box_size = int.from_bytes(handle.read(8), "big")
                header_size = 16
                if box_size < 16:
                    return False
            elif box_size == 0:  # box runs to end of file
                box_size = size - offset
            elif box_size < 8:
                return False
            if offset + box_size > size:
                return False
            seen.add(box_type)
            if box_type == b"mdat":
                media_bytes += box_size - header_size
            offset += box_size
    return False


def _job_gist(job_dir: str, promise: dict) -> str:
    """A one-line 'what it was' — first editorial beat, else brand strings, else
    a humanized job name. Producer language only."""
    editorial = promise.get("editorial")
    if isinstance(editorial, list) and editorial:
        return _clip(str(editorial[0]))
    brands = promise.get("brand_strings")
    if isinstance(brands, list) and brands:
        return "featured " + ", ".join(str(b) for b in brands[:3])
    # fall back to a readable version of the job folder name
    name = os.path.basename(job_dir)
    name = re.sub(r"[-_]\d{6,}.*$", "", name)  # strip date/slug suffixes
    name = name.replace("-", " ").replace("_", " ").strip()
    return name or "a recent video"


def _clip(s: str, n: int = 90) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _display_name(ws: str, tenant: str) -> str:
    """The brand's real NAME for the user to hear — never the internal slug.
    Pull it from the pack README's H1 ('# Taste pack — Acme Reels …'); fall back
    to a humanized slug (acme_reels → 'Acme Reels')."""
    readme = os.path.join(ws, "taste", "packs", tenant, "README.md")
    try:
        with open(readme, encoding="utf-8") as f:
            for line in f:
                if line.startswith("# "):
                    m = re.search(r"—\s*(.+?)\s*(?:`|\[BRAND|·|$)", line)
                    if m and m.group(1).strip():
                        return m.group(1).strip()
                    break
    except OSError:
        pass
    return " ".join(w.capitalize() for w in re.split(r"[-_\s]+", tenant) if w) or tenant


# ── locked look, pulled from the project's pack ───────────────────────────────
_HEX = re.compile(r"#[0-9A-Fa-f]{6}")


def _locked_look(ws: str, tenant: str) -> dict:
    """Best-effort scrape of the project's LOCKED look from its pack README:
    caption preset, palette hexes, a named font, grade word. Never fabricates —
    a field it can't find is simply omitted from the brief."""
    look: dict = {}
    readme = os.path.join(ws, "taste", "packs", tenant, "README.md")
    text = ""
    try:
        with open(readme, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        text = ""

    # caption preset — authoritative if a finished job used one, else the pack
    preset = _preset_from_jobs(ws, tenant) or _preset_from_text(text)
    if preset:
        look["captions"] = preset

    m = re.search(r"caption_preset[`\"'\s:]+([A-Za-z0-9_\-]+)", text)
    if "captions" not in look and m:
        look["captions"] = m.group(1)

    hexes = []
    for h in _HEX.findall(text):
        hu = h.upper()
        if hu not in hexes:
            hexes.append(hu)
    if hexes:
        look["palette"] = hexes[:4]

    # a named caption/brand font (…Font `Name`… or **DePixelKlein**)
    fm = re.search(r"[Ff]ont[`\"'*\s]+([A-Z][A-Za-z0-9]+)", text)
    if fm:
        look["font"] = fm.group(1)

    gm = re.search(r"\b(WARM|COOL|COLD|NEUTRAL|MOODY|HIGH-KEY)\b", text)
    if gm:
        look["grade"] = gm.group(1).lower()
    return look


def _preset_from_text(text: str) -> str | None:
    m = re.search(r'"?caption_preset"?\s*[:=]\s*["\']?([A-Za-z0-9_\-]+)', text)
    return m.group(1) if m else None


def _preset_from_jobs(ws: str, tenant: str) -> str | None:
    for sd in glob.glob(os.path.join(ws, "jobs", "*", "style_directives.json")):
        data = _safe_json(sd) or {}
        p = data.get("caption_preset")
        if p:
            # only trust it if this job belongs to the tenant
            pj = _safe_json(os.path.join(os.path.dirname(sd), "promise.json")) or {}
            if str(pj.get("tenant", "")).strip() == tenant:
                return str(p)
    return None


def _broll_looks(ws: str, tenant: str) -> list[str]:
    """B-roll looks in rotation — pull short cues from the pack's COMMITMENTS /
    B-roll section. Best-effort; omitted if nothing parses."""
    readme = os.path.join(ws, "taste", "packs", tenant, "README.md")
    try:
        with open(readme, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    cues: list[str] = []
    for kw, label in (
        (r"receipt", "real receipts (UI / product / terminal)"),
        (r"ken burns|static-motion|parallax", "motion on every still"),
        (r"hand-drawn|marker card|card on", "hand-drawn concept cards"),
        (r"screen[- ]?rec", "screen recordings"),
    ):
        if re.search(kw, text, re.IGNORECASE):
            cues.append(label)
    return cues[:3]


def _library_size(ws: str, tenant: str) -> tuple[int, int]:
    base = os.path.join(ws, "assets", tenant)
    vids = _linecount(os.path.join(base, "video.jsonl"))
    imgs = _linecount(os.path.join(base, "image.jsonl"))
    return vids, imgs


# ── render ────────────────────────────────────────────────────────────────────
def build_brief(ws: str, tenant: str) -> str:
    name = _display_name(ws, tenant)
    finished = _finished_videos(ws, tenant)
    look = _locked_look(ws, tenant)
    broll = _broll_looks(ws, tenant)
    vids, imgs = _library_size(ws, tenant)

    lines: list[str] = []
    lines.append(
        "═══════════════════════════════════════════════════════════════════════"
    )
    lines.append(
        f" PROJECT BRIEF — for {name}  (start already-briefed; prove it in line 1, "
        "producer voice)"
    )
    lines.append(
        "═══════════════════════════════════════════════════════════════════════"
    )
    lines.append(
        f"Call the brand \"{name}\" to the user — never the internal id."
    )

    if finished:
        lines.append("Last videos we made together:")
        for j in finished:
            star = "★ " if j["starred"] else ""
            lines.append(f"  • {star}{j['name']} — {j['gist']}")
    else:
        lines.append(
            "No finished videos on record yet — this may be an early one for "
            "the brand; lean on the locked look below."
        )

    locked_bits = []
    if look.get("captions"):
        locked_bits.append(f"captions: {look['captions']}")
    if look.get("font"):
        locked_bits.append(f"font: {look['font']}")
    if look.get("grade"):
        locked_bits.append(f"grade: {look['grade']}")
    if look.get("palette"):
        locked_bits.append("palette: " + " ".join(look["palette"]))
    if locked_bits:
        lines.append("Locked look: " + "; ".join(locked_bits) + ".")
    if broll:
        lines.append("B-roll in rotation: " + "; ".join(broll) + ".")
    if vids or imgs:
        lines.append(
            f"Media library: {vids} indexed clips + {imgs} stills — reach for "
            "the brand's own footage before generating."
        )

    lines.append(
        "Speak to the user as their producer — never name the machinery behind "
        "any of the above."
    )
    lines.append(
        "═══════════════════════════════════════════════════════════════════════"
    )
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Emit the compact project brief.")
    ap.add_argument("--tenant", default=os.environ.get("VIDEOCLAW_TENANT", ""))
    ap.add_argument("--workspace", default=None)
    args = ap.parse_args()

    tenant = (args.tenant or "").strip()
    if not tenant:
        return 0  # dev default: no project selected → no brief, no output
    ws = _workspace(args.workspace)
    try:
        brief = build_brief(ws, tenant)
    except Exception as e:  # never brick a session on a brief
        print(f"(project brief unavailable: {e})", file=sys.stderr)
        return 0
    print(brief)
    return 0


if __name__ == "__main__":
    sys.exit(main())
