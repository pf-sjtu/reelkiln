"""Cross-platform stand-in for the ``fcntl.flock`` subset the engine uses.

PORT ADDITION (Reelkiln Windows port, see docs/09-engine-windows-compat.md).

On POSIX this module re-exports the real ``fcntl.flock`` and ``LOCK_*`` constants
unchanged, so ``import _compat_lock as fcntl`` is byte-for-byte the same behaviour
as ``import fcntl``.

On Windows (no ``fcntl``) it emulates whole-file advisory ``flock`` on the lock
file descriptor with ``msvcrt.locking`` on byte 0, length 1 — the same convention
the engine already uses for Windows in ``_media/library_lock.py`` and
``remotion_lock.py``. Differences (documented, unverified on a Windows machine):
  * ``LOCK_SH`` is treated as exclusive (msvcrt has no shared locks);
  * contention under ``LOCK_NB`` raises ``BlockingIOError(errno.EAGAIN)`` so every
    existing ``except BlockingIOError`` / ``errno in (EAGAIN, EACCES)`` caller works;
  * blocking ``LOCK_EX`` polls ``LK_NBLCK`` (``LK_LOCK`` gives up after ~10 s);
  * ``LOCK_UN`` on a region that is not locked is a no-op, like ``flock``;
  * the descriptor's file position is restored after (un)locking.
"""
from __future__ import annotations

import os

try:  # POSIX: the real thing, unchanged semantics.
    from fcntl import LOCK_EX, LOCK_NB, LOCK_SH, LOCK_UN, flock  # noqa: F401
except ImportError:  # pragma: no cover - Windows only
    import errno
    import msvcrt
    import time

    LOCK_SH = 1
    LOCK_EX = 2
    LOCK_NB = 4
    LOCK_UN = 8
    _POLL_SECONDS = 0.02

    def _at_byte_zero(fd: int, mode: int) -> None:
        position = os.lseek(fd, 0, os.SEEK_CUR)
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            msvcrt.locking(fd, mode, 1)
        finally:
            os.lseek(fd, position, os.SEEK_SET)

    def flock(fd, operation: int) -> None:
        if hasattr(fd, "fileno"):
            fd = fd.fileno()
        if operation & LOCK_UN:
            try:
                _at_byte_zero(fd, msvcrt.LK_UNLCK)
            except OSError:
                pass
            return
        while True:
            try:
                _at_byte_zero(fd, msvcrt.LK_NBLCK)
                return
            except OSError as exc:
                if exc.errno not in (errno.EACCES, getattr(errno, "EDEADLOCK", errno.EDEADLK), errno.EAGAIN):  # EDEADLOCK is absent on macOS
                    raise
                if operation & LOCK_NB:
                    raise BlockingIOError(errno.EAGAIN, "lock is held by another process") from None
                time.sleep(_POLL_SECONDS)
