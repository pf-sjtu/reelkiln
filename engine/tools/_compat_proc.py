"""Cross-platform process-group helpers.

PORT ADDITION (videoclaw-reverse Windows port, see docs/09-engine-windows-compat.md).

POSIX behaviour is unchanged: callers keep using ``start_new_session=True`` and
``os.killpg(pgid, signal.SIGKILL)`` through these helpers.

Windows (unverified on a Windows machine): a "session" is a new process group
(``CREATE_NEW_PROCESS_GROUP``) and killing the group is ``taskkill /PID <pid> /T /F``,
which terminates the whole descendant tree.
"""
from __future__ import annotations

import os
import signal
import subprocess

IS_WINDOWS = os.name == "nt"

#: ``signal.SIGKILL`` where it exists; Windows has no SIGKILL (taskkill /F is used).
SIGKILL = getattr(signal, "SIGKILL", signal.SIGTERM)


def new_session_kwargs() -> dict:
    """Popen kwargs that put the child in its own session/process group."""
    if IS_WINDOWS:  # pragma: no cover - Windows only
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def kill_process_group(pid: int) -> None:
    """SIGKILL the process group led by ``pid`` (POSIX: ``os.killpg(pid, SIGKILL)``)."""
    if IS_WINDOWS:  # pragma: no cover - Windows only
        _taskkill_tree(pid)
        return
    os.killpg(pid, signal.SIGKILL)


def kill_own_process_group() -> None:
    """SIGKILL the caller's own process group (POSIX: ``os.killpg(os.getpgrp(), SIGKILL)``)."""
    if IS_WINDOWS:  # pragma: no cover - Windows only
        _taskkill_tree(os.getpid())
        os._exit(137)
    os.killpg(os.getpgrp(), signal.SIGKILL)


def _taskkill_tree(pid: int) -> None:  # pragma: no cover - Windows only
    result = subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode not in (0, 128):  # 128: process already gone
        raise ProcessLookupError(pid)
