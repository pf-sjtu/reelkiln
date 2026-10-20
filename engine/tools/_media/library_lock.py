"""Cross-process ownership for one collection's sources.json + JSONL truth.

`sync` reads sources.json once and then spends minutes appending truth records
for that snapshot. `remove-source --purge` rewrites both files. With no shared
gate the purge lands mid-sync and the sync's remaining appends put the purged
records straight back — removal reports success over a library that grew the
records again.

So every command that MUTATES a collection takes this lock. A removal WAITS for
an accepted index run to finish; it never cancels or abandons paid work. The OS
releases the advisory lock if a holder crashes.

Mirrors tools/remotion_lock.py (same primitives, same tempdir-keyed strategy):
assets/<tenant>/ is committed user data, so coordination state stays out of it.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from typing import Iterator, TextIO

# Long enough for a real sync to drain; override in tests / constrained hosts.
DEFAULT_TIMEOUT_SECONDS = 1800.0

# Re-entrant within one CALL STACK: add-source --index takes the lock and then
# calls cmd_sync, which takes it again, and flock is per-descriptor — a second
# open() would block on ourselves forever. Thread-local, so two concurrent
# library operations in one process still serialize against each other.
_LOCAL = threading.local()


def _depth() -> dict[str, int]:
    d = getattr(_LOCAL, "depth", None)
    if d is None:
        d = _LOCAL.depth = {}
    return d


def _try_lock(handle: TextIO) -> bool:
    if os.name == "nt":  # pragma: no cover - exercised on Windows CI/builds
        import msvcrt

        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    import fcntl

    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    return True


def _unlock(handle: TextIO) -> None:
    if os.name == "nt":  # pragma: no cover - exercised on Windows CI/builds
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _timeout() -> float:
    raw = os.environ.get("VIDEOCLAW_MEDIA_LOCK_TIMEOUT")
    try:
        return float(raw) if raw else DEFAULT_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


@contextmanager
def exclusive_library_mutation(adir: Path, *, holder: str) -> Iterator[None]:
    """Serialize source/truth mutations for one (tenant, collection)."""
    key = hashlib.sha256(str(Path(adir).resolve()).encode("utf-8")).hexdigest()[:24]
    depth = _depth()
    if depth.get(key):
        depth[key] += 1
        try:
            yield
        finally:
            depth[key] -= 1
        return

    lock_path = Path(tempfile.gettempdir()) / "videoclaw-media-locks" / f"{key}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+", encoding="utf-8")
    if lock_path.stat().st_size == 0:
        handle.write(" ")  # Windows byte-range locks require one lockable byte.
        handle.flush()

    started = time.monotonic()
    announced = False
    try:
        while not _try_lock(handle):
            elapsed = time.monotonic() - started
            if elapsed >= _timeout():
                raise TimeoutError(
                    f"another Library operation held {adir} for {elapsed:.1f}s "
                    f"while {holder!r} waited"
                )
            if not announced:
                # stderr: --json callers parse stdout.
                print("Another Library operation is running; waiting for it to "
                      f"finish before {holder}.", file=sys.stderr)
                announced = True
            time.sleep(0.1)

        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps({"pid": os.getpid(), "holder": holder,
                                 "acquired_at": time.time()}, sort_keys=True))
        handle.flush()
        depth[key] = 1
        yield
    finally:
        if depth.get(key):
            depth.pop(key, None)
            try:
                _unlock(handle)
            finally:
                handle.close()
        else:
            handle.close()
