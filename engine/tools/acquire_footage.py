#!/usr/bin/env python3
"""
acquire_footage.py — DEPRECATED alias for tools/pull_video.py (renamed
2026-07-16, docs/specs/25-one-pull-surface.md). Kept as a working shim
through the deprecation window; it will be removed afterwards.

Run form:    delegates the whole invocation to pull_video.py — identical
             flags, identical behavior, identical exit codes. The only
             difference is a one-line deprecation notice on stderr.
Import form: `import acquire_footage` / `from acquire_footage import X`
             resolves to the pull_video module (legacy imports keep working).

Update call sites to:  uv run python tools/pull_video.py [...]
"""
from __future__ import annotations

import importlib
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    sys.stderr.write(
        "[deprecation] tools/acquire_footage.py is now tools/pull_video.py — "
        "delegating; update your invocation.\n"
    )
    os.execv(sys.executable,
             [sys.executable, os.path.join(_HERE, "pull_video.py")] + sys.argv[1:])
else:
    if _HERE not in sys.path:
        sys.path.insert(0, _HERE)
    sys.modules[__name__] = importlib.import_module("pull_video")
