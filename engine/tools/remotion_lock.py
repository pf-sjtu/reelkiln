"""Cross-process ownership for the shared Remotion source tree.

Captioned.tsx imports one mutable `_currentJobOverlays.tsx`. Asset generation may
run in parallel, but wiring that file and rendering must be one atomic section or
Video A can bake Video B's overlays. The OS releases this advisory lock if a
renderer crashes.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Iterator, TextIO


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


@contextmanager
def exclusive_remotion_render(
    remotion_dir: Path,
    *,
    job_id: str,
    timeout_seconds: float = 1800.0,
) -> Iterator[None]:
    """Serialize mutations and renders that use the shared Remotion project."""
    # The installed executor is immutable. Put coordination state in the host
    # temp area and key it by the exact shared source tree instead of writing a
    # lock file into the bundle.
    lock_key = hashlib.sha256(
        str(remotion_dir.resolve()).encode("utf-8")
    ).hexdigest()[:24]
    lock_path = (
        Path(tempfile.gettempdir()) / "videoclaw-remotion-locks" / f"{lock_key}.lock"
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+", encoding="utf-8")
    if lock_path.stat().st_size == 0:
        handle.write(" ")  # Windows byte-range locks require one lockable byte.
        handle.flush()

    started = time.monotonic()
    announced_wait = False
    try:
        while not _try_lock(handle):
            elapsed = time.monotonic() - started
            if elapsed >= timeout_seconds:
                raise TimeoutError(
                    f"shared Remotion renderer stayed busy for {elapsed:.1f}s "
                    f"while job {job_id!r} waited"
                )
            if not announced_wait:
                print(
                    "Another video is using the shared compositor; this render "
                    "will start as soon as that render finishes."
                )
                announced_wait = True
            time.sleep(0.1)

        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps({
            "pid": os.getpid(),
            "job_id": job_id,
            "acquired_at": time.time(),
        }, sort_keys=True))
        handle.flush()
        yield
    finally:
        try:
            _unlock(handle)
        finally:
            handle.close()
