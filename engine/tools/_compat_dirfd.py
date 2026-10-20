"""Port (Windows) compat: descriptor-relative ("*at") filesystem calls.

The engine pins job directories with ``os.open(dir, O_DIRECTORY)`` and then uses
``dir_fd=`` / ``src_dir_fd=`` everywhere (openat/fstatat/mkdirat/unlinkat/renameat).
Windows has neither O_DIRECTORY nor ``dir_fd`` support (``os.supports_dir_fd`` is empty),
so every such call raises there (docs/09 blocker B1).

POSIX: every function below IS the ``os`` function (same object) and every flag IS the
``os`` flag, so behaviour is byte-for-byte unchanged.

Windows (or ``VIDEOCLAW_PORT_DIRFD_EMULATE=1`` — PORT-NEW test hook, used to exercise this
path on Linux): directory "descriptors" are opaque ints >= 2**30 mapped to absolute paths;
``dir_fd`` arguments are resolved by joining. Guarantees that are WEAKER than POSIX (and
unverified on Windows):
  * identity pinning: a directory renamed/replaced after it was "opened" is not detected —
    the path is re-resolved on every call (TOCTOU window the POSIX code closes);
  * O_NOFOLLOW is emulated with an ``os.path.islink`` check before open (racy);
  * fsync on a directory is a no-op (Windows cannot fsync directories);
  * O_BINARY is added to every real ``open`` so writes are never CRLF-translated.
"""
from __future__ import annotations

import errno
import os

EMULATE = os.name == "nt" or os.environ.get("VIDEOCLAW_PORT_DIRFD_EMULATE") == "1"

# Private flag bits for flags Windows lacks; only this module ever sees them.
O_DIRECTORY = getattr(os, "O_DIRECTORY", 0x20000000)
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0x40000000)
O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)  # Windows: os.open fds are non-inheritable by default
O_NONBLOCK = getattr(os, "O_NONBLOCK", 0)
_O_BINARY = getattr(os, "O_BINARY", 0)

if not EMULATE:
    open = os.open  # noqa: A001
    close = os.close
    fstat = os.fstat
    fsync = os.fsync
    stat = os.stat
    mkdir = os.mkdir
    unlink = os.unlink
    replace = os.replace
    listdir = os.listdir
    link = os.link
    rename = os.rename
    dup = os.dup
    pread = os.pread
else:
    _FAKE_BASE = 1 << 30
    _dirs: dict[int, str] = {}
    _next = [_FAKE_BASE]

    def _is_fake(fd: int) -> bool:
        return fd in _dirs

    def _resolve(name, dir_fd):
        name = os.fspath(name)
        if dir_fd is None:
            return name
        if dir_fd not in _dirs:
            raise OSError(errno.EBADF, "not a compat directory descriptor", name)
        return os.path.join(_dirs[dir_fd], name)

    def open(path, flags, mode=0o777, *, dir_fd=None):  # noqa: A001
        p = _resolve(path, dir_fd)
        if flags & O_NOFOLLOW and os.path.islink(p):
            raise OSError(errno.ELOOP, "Too many levels of symbolic links", p)
        if flags & O_DIRECTORY or (not flags & os.O_CREAT and os.path.isdir(p)):
            if not os.path.isdir(p):
                raise NotADirectoryError(errno.ENOTDIR, "Not a directory", p)
            fd = _next[0]
            _next[0] += 1
            _dirs[fd] = os.path.abspath(p)
            return fd
        real = flags & ~(O_DIRECTORY | O_NOFOLLOW)
        if os.name == "nt":
            real &= ~(O_CLOEXEC | O_NONBLOCK)
        return os.open(p, real | _O_BINARY, mode)

    def close(fd):
        if _is_fake(fd):
            del _dirs[fd]
            return
        os.close(fd)

    def fstat(fd):
        return os.stat(_dirs[fd]) if _is_fake(fd) else os.fstat(fd)

    def fsync(fd):
        if _is_fake(fd):
            return None
        return os.fsync(fd)

    def stat(path, *, dir_fd=None, follow_symlinks=True):
        if isinstance(path, int):
            return fstat(path)
        return os.stat(_resolve(path, dir_fd), follow_symlinks=follow_symlinks)

    def mkdir(path, mode=0o777, *, dir_fd=None):
        return os.mkdir(_resolve(path, dir_fd), mode)

    def unlink(path, *, dir_fd=None):
        return os.unlink(_resolve(path, dir_fd))

    def replace(src, dst, *, src_dir_fd=None, dst_dir_fd=None):
        return os.replace(_resolve(src, src_dir_fd), _resolve(dst, dst_dir_fd))

    def listdir(path="."):
        if isinstance(path, int):
            return os.listdir(_dirs[path]) if _is_fake(path) else os.listdir(path)
        return os.listdir(path)

    def link(src, dst, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True):
        # Windows os.link supports neither dir fds nor follow_symlinks=False (NotImplementedError);
        # the engine only links regular temporaries it just created, so dropping it is safe.
        return os.link(_resolve(src, src_dir_fd), _resolve(dst, dst_dir_fd))

    def rename(src, dst, *, src_dir_fd=None, dst_dir_fd=None):
        return os.rename(_resolve(src, src_dir_fd), _resolve(dst, dst_dir_fd))

    def dup(fd):
        if _is_fake(fd):
            new = _next[0]
            _next[0] += 1
            _dirs[new] = _dirs[fd]
            return new
        return os.dup(fd)

    def pread(fd, n, offset):
        # os.pread is POSIX-only. Emulate without moving the file offset (as pread does).
        # Not atomic w.r.t. other threads sharing this fd (unverified on Windows).
        if hasattr(os, "pread"):
            return os.pread(fd, n, offset)
        here = os.lseek(fd, 0, os.SEEK_CUR)
        try:
            os.lseek(fd, offset, os.SEEK_SET)
            return os.read(fd, n)
        finally:
            os.lseek(fd, here, os.SEEK_SET)
