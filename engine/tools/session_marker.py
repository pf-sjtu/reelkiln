#!/usr/bin/env python3
"""
session_marker — write the per-session observability marker so a silent hook
failure is impossible to miss (LAUNCH_SPEC §1 hook observability).

Every injection must leave a verifiable trace. The SessionStart preflight calls
this AFTER it has injected context; it records what was injected. The app
(chunk 03) reads the marker right after session start and alarms if it's absent
(the hook never fired) or thin (a block is missing).

  MARKER PATH (stable — the app depends on it):
    $VIDEOCLAW_WORKSPACE/.videoclaw/session-markers/<session_id>.json

  (Workspace, not the engine dir — user-readable, per the World-1 split. Falls
  back to --workspace, then $CLAUDE_PROJECT_DIR, then cwd.)

Two roles on ONE file, so the app checks a single place:
  --preflight   write/replace the marker with the SessionStart trace + fields
  --stop        MERGE a Stop-hook trace into the marker (qa_gate calls this)

Fail-QUIET: a marker we can't write must never brick the session (exit 0).
stdlib-only (runs inside fast hooks).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

MARKER_SCHEMA = 1


def _workspace(arg: str | None) -> str:
    return (
        arg
        or os.environ.get("VIDEOCLAW_WORKSPACE")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.getcwd()
    )


def _marker_dir(ws: str) -> str:
    return os.path.join(ws, ".videoclaw", "session-markers")


def marker_path(ws: str, session_id: str) -> str:
    sid = (session_id or "no-session").strip() or "no-session"
    # keep it a safe single path segment
    sid = "".join(c if (c.isalnum() or c in "._-") else "_" for c in sid)[:120]
    return os.path.join(_marker_dir(ws), f"{sid}.json")


def _load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _bool(v: str | None) -> bool:
    return str(v).strip().lower() in ("y", "yes", "1", "true", "on")


def preflight(args) -> int:
    ws = _workspace(args.workspace)
    path = marker_path(ws, args.session)
    obj = _load(path)
    obj.update(
        {
            "schema": MARKER_SCHEMA,
            "session_id": args.session or "",
            "engine": os.environ.get("VIDEOCLAW_ENGINE", ""),
            "workspace": ws,
            "preflight": {
                "fired": True,
                "ts": _now(),
                "source": args.source or "",
                "laws_version": args.laws_version or "",
                "laws_injected": _bool(args.laws_injected),
                "tenant": (args.tenant or "").strip(),
                "brief_present": _bool(args.brief),
                "commitments_present": _bool(args.commitments),
            },
        }
    )
    _write(path, obj)
    return 0


def stop(args) -> int:
    ws = _workspace(args.workspace)
    path = marker_path(ws, args.session)
    obj = _load(path)
    obj.setdefault("schema", MARKER_SCHEMA)
    obj.setdefault("session_id", args.session or "")
    obj.setdefault("workspace", ws)
    obj["stop"] = {
        "fired": True,
        "ts": _now(),
        "blocked": _bool(args.blocked),
        "blocked_jobs": [j for j in (args.blocked_jobs or "").split(",") if j],
    }
    _write(path, obj)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Write the per-session hook marker.")
    ap.add_argument("--stop", action="store_true", help="merge a Stop-hook trace")
    ap.add_argument("--session", default="")
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--source", default="")
    ap.add_argument("--laws-version", dest="laws_version", default="")
    ap.add_argument("--laws-injected", dest="laws_injected", default="n")
    ap.add_argument("--tenant", default="")
    ap.add_argument("--brief", default="n")
    ap.add_argument("--commitments", default="n")
    ap.add_argument("--blocked", default="n")
    ap.add_argument("--blocked-jobs", dest="blocked_jobs", default="")
    args = ap.parse_args()
    try:
        return stop(args) if args.stop else preflight(args)
    except Exception as e:  # never brick a session
        print(f"session_marker: {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
