"""Replace a fixed-name paid output with a new take: paid once, old take kept.

videoclaw#283. Durable delivery links a paid result into place and never
overwrites a file, so a tool that regenerates into a FIXED name
(``avatar/avatar_front.png``, ``chunks/chunk_02.mp4``, ``masks/sam3__….mp4``,
``…/stems/bass.wav``) could not replace its previous take: before #273 the
provider was paid and delivery then failed; since #273 the request is refused
before payment.

Instead the paid result is delivered to a name that no earlier file can hold,
owned by the request that pays for it::

    <job>/.takes/<request key>/<output path>

and is then published locally, which costs nothing: the current file moves to

    <job>/previous_takes/<UTC time>/<output path>

and the take is linked into place. Nothing is moved before the new bytes are
saved, and publishing again is harmless. With durable operation recovery
enabled, a retry finishes the already-paid output before buying another take,
even if resolved inputs (such as a temporary reference URL) have changed:

=============================  =============================================
the run stopped                what running the same command again does
=============================  =============================================
before the paid request        pays once; nothing had been moved
paid, result not saved yet     refused before payment while the operation
                               journal says the take is on its way; once
                               the app has saved it, publishes it unpaid
take saved, not published      publishes it without paying again
while publishing               finishes publishing
=============================  =============================================

Two runs regenerating one file at once, with the same or other inputs: the
second is refused before payment by a per-file lock held for the whole paid
run (``hold``). Across a crash, the journal's claim on the take's name refuses
a second purchase of the same request, and ``hold`` refuses a request with
other inputs while a take of the same file is still on its way (the #294
guard, which matches exact names only). Once that take is saved, the next run
publishes it unpaid and says when it used earlier inputs. Run again after that
to deliberately buy a replacement with the new inputs. Unusable saved takes
(expired avatar URLs or stems from another audio) are kept unpublished under
``previous_takes/`` before the caller buys the usable replacement.

Takes and previous takes sit outside the folders tools glob
(``chunks/chunk_*.mp4``).
"""
from __future__ import annotations

import _compat_lock as fcntl  # port: fcntl on POSIX, msvcrt on Windows
import hashlib
import json
import os
import _compat_dirfd as _dfd  # port: dir_fd/O_DIRECTORY emulation on Windows (POSIX: same os functions)
import stat
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from log import job_lock_at, log_event

TAKES_DIR = ".takes"
PREVIOUS_DIR = "previous_takes"
_LOCKS_DIR = ".locks"
# port: _compat_dirfd flags = os flags on POSIX; private bits honoured by _compat_dirfd on Windows.
_DIR_FLAGS = os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC


def request_key(request: dict) -> str:
    """Stable identity of what a paid call asks for (never its upload ids)."""
    canonical = json.dumps(request, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf8")).hexdigest()[:16]


def file_sha256(path: Path) -> str:
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_atomic(path: Path, data: bytes) -> None:
    """Save a take whole; a crash never leaves part of one under its name."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.partial")
    try:
        with open(partial, "wb") as stream:
            stream.write(data)
            stream.flush()
            _dfd.fsync(stream.fileno())
        _dfd.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return os.lstat(path)
    except FileNotFoundError:
        return None


def _is_take(st: os.stat_result | None) -> bool:
    return st is not None and stat.S_ISREG(st.st_mode) and st.st_size > 0


def _same_inode(a: os.stat_result | None, b: os.stat_result | None) -> bool:
    return a is not None and b is not None and (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)


def _open_dir(root_fd: int, parts: tuple[str, ...], *, create: bool) -> int | None:
    """A no-follow descriptor for ``root/parts``; None when missing and not creating."""
    current = _dfd.dup(root_fd)
    try:
        for part in parts:
            if create:
                try:
                    _dfd.mkdir(part, 0o755, dir_fd=current)
                except FileExistsError:
                    pass
            try:
                child = _dfd.open(part, _DIR_FLAGS, dir_fd=current)
            except FileNotFoundError:
                if create:
                    raise
                _dfd.close(current)
                return None
            _dfd.close(current)
            current = child
        return current
    except BaseException:
        _dfd.close(current)
        raise


def _stat_at(dir_fd: int | None, name: str) -> os.stat_result | None:
    if dir_fd is None:
        return None
    try:
        return _dfd.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


def _digest_at(dir_fd: int, name: str) -> str:
    fd = _dfd.open(name, os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_NONBLOCK | _dfd.O_CLOEXEC, dir_fd=dir_fd)
    with os.fdopen(fd, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class TakeIncomplete(RuntimeError):
    """Only part of a multi-file take is saved; the rest is still on its way."""


class PaidTake:
    """The paid result of one request, on its way to replace fixed outputs.

    ``paths`` are where the paid call must save its result (pass them as the
    gateway's ``_delivery``); ``publish`` then replaces ``outputs``.
    """

    def __init__(self, job: Path | None, outputs: list[Path], request: dict, *, tool: str):
        self.outputs = [Path(os.path.abspath(output)) for output in outputs]
        root = Path(os.path.abspath(job)) if job is not None else None
        if root is None or not all(output.is_relative_to(root) for output in self.outputs):
            root = Path(os.path.commonpath([output.parent for output in self.outputs]))
        self.root, self.tool, self.key = root, tool, request_key(request)
        self._request_key = self.key
        self._log_job = Path(os.path.abspath(job)) if job is not None else None
        self.relative = [PurePosixPath(output.relative_to(root).as_posix()) for output in self.outputs]
        self.paths = [root / TAKES_DIR / self.key / rel for rel in self.relative]
        self._context: dict | None = None
        self._pending: list[tuple[str, str, str]] = []
        self.adopted_from: str | None = None

    @property
    def names(self) -> str:
        return ", ".join(str(rel) for rel in self.relative)

    @contextmanager
    def hold(self):
        """Own these outputs for the whole paid run, or refuse before paying.

        Two regenerations of one fixed name at once (even with different
        inputs) would each buy a take; the second is refused instead, as
        #273 does for lip-sync windows. The folders publication will use are
        checked first, so a symlinked or non-folder path fails before any
        spend rather than after. flock frees itself if the process dies, so
        a paid take of these outputs still on its way from a killed run is
        checked in the journal once the lock is held.
        """
        from _gateway import GatewayNotSubmittedError
        root_fd = _dfd.open(self.root, _DIR_FLAGS)
        lock_fd = -1
        try:
            try:
                for parts in ([TAKES_DIR], [PREVIOUS_DIR],
                              *(list(rel.parts[:-1]) for rel in self.relative)):
                    for depth in range(1, len(parts) + 1):
                        folder = _open_dir(root_fd, tuple(parts[:depth]), create=False)
                        if folder is None:
                            break
                        _dfd.close(folder)
                locks = _open_dir(root_fd, (TAKES_DIR, _LOCKS_DIR), create=True)
            except OSError as exc:
                raise GatewayNotSubmittedError(
                    f"{self.names} cannot be replaced: one of its folders (or {TAKES_DIR}/, "
                    f"{PREVIOUS_DIR}/) is not a plain folder. Nothing was submitted or charged.") from exc
            try:
                name = request_key({"outputs": [str(rel) for rel in self.relative]}) + ".lock"
                for _ in range(64):  # macOS can report ENOENT while a sibling creates the leaf (#273)
                    try:
                        lock_fd = _dfd.open(name, os.O_RDWR | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC, dir_fd=locks)
                        break
                    except FileNotFoundError:
                        pass
                    try:
                        lock_fd = _dfd.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | _dfd.O_NOFOLLOW
                                          | _dfd.O_CLOEXEC, 0o600, dir_fd=locks)
                        break
                    except (FileExistsError, FileNotFoundError):
                        pass
            except OSError as exc:
                raise GatewayNotSubmittedError(
                    f"{self.names}: the regeneration lock cannot be opened safely. "
                    "Nothing was submitted or charged.") from exc
            finally:
                _dfd.close(locks)
            if lock_fd < 0:
                raise OSError(f"could not open the regeneration lock for {self.names}")
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise GatewayNotSubmittedError(
                    f"{self.names}: another run is regenerating this right now. Nothing was "
                    "submitted or charged now; wait for it (its take replaces the file and keeps "
                    "the old one), then decide whether you still need another take.") from exc
            self._refuse_other_pending_take()
            try:
                self._resume_saved_take()
            except OSError as exc:
                raise GatewayNotSubmittedError(
                    f"{self.names}: the saved take cannot be read safely. "
                    "Nothing was submitted or charged.") from exc
            yield self
        finally:
            if lock_fd >= 0:
                _dfd.close(lock_fd)
            _dfd.close(root_fd)

    def _refuse_other_pending_take(self) -> None:
        """Refuse before payment while another request's paid take of these outputs is on its way.

        The journal refuses a name an earlier paid operation still owes
        (#294), but each request's take has a name of its own, so a retry
        with other inputs (a tweaked prompt) would pay again, and the earlier
        take would then arrive under ``.takes/`` where nothing shows it. The
        same request's own claim is left to the journal (see ``refusal``).
        """
        from _gateway import GatewayDestinationClaimedError, GatewayError, GatewayNotSubmittedError, gateway
        from _operations import _same_name, undelivered_claims
        if (self._log_job is None or self.root != self._log_job
                or not (self._log_job / "operations").is_dir()
                or not gateway.enabled() or os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") != "1"):
            return
        try:
            self._context = gateway._req("GET", "/v1/operation-context")
            self._pending = undelivered_claims(self._log_job, self._context)
        except (GatewayError, ValueError) as exc:
            raise GatewayNotSubmittedError(
                f"{self.names}: paid-take recovery identity could not be verified. "
                "Nothing was submitted or charged; retry when the app can verify this video.") from exc
        wanted = {_same_name(rel.as_posix()) for rel in self.relative}
        for destination, operation_id, status in self._pending:
            parts = PurePosixPath(destination).parts
            plain_output = _same_name(destination) in wanted
            other_take = (len(parts) >= 3 and parts[0] == TAKES_DIR and parts[1] != self.key
                          and _same_name(PurePosixPath(*parts[2:]).as_posix()) in wanted)
            if not plain_output and not other_take:
                continue
            text = (
                f"{self.names}: a take an earlier run paid for with other inputs (operation "
                f"{operation_id}, {status}) is still on its way to {destination}. Nothing was "
                "submitted or charged now; do not start another take yet. Once the app has saved "
                "it, run this same command again to put the saved take in place without paying. "
                "Run again after saved takes are published if you still want to buy a different take.")
            if plain_output:
                text = (f"{self.names}: earlier operation {operation_id} ({status}) still owes "
                        f"{destination}. Nothing was submitted or charged now. Let the app recover "
                        "or cancel that earlier operation before regenerating; repeated retries "
                        "cannot create a new take while that original output is still owed.")
            error = GatewayDestinationClaimedError(text)
            error.operation_id = operation_id
            raise error

    def ready(self) -> bool:
        """A paid take for this request is saved and waits to replace the outputs.

        Also true when publication stopped half-way (some takes already linked
        into place): publishing again finishes it.
        """
        if self._still_owed():
            return False  # The collector must commit delivery before publication unlinks its file.
        takes = [_lstat(path) for path in self.paths]
        if all(_is_take(st) for st in takes):
            return True
        present = [(st, output) for st, output in zip(takes, self.outputs) if st is not None]
        return bool(present) and all(_same_inode(st, _lstat(output)) for st, output in present)

    def publish(self) -> list[Path] | None:
        """Replace each output with its take; return where previous takes were kept.

        Nothing is deleted: an output that differs from its take moves to
        ``previous_takes/<UTC time>/<output path>`` before the take is linked
        into place, and a take is unlinked only once every output points at
        it. Runs under the job lock and can simply be repeated, so an
        interrupted publication is finished by publishing again. Returns None
        when no take was left to publish (another run of the same request
        published it).
        """
        kept: list[Path] = []
        root_fd = _dfd.open(self.root, _DIR_FLAGS)
        opened: list[int] = []
        try:
            with job_lock_at(root_fd):
                entries = []
                for rel in self.relative:
                    take_fd = _open_dir(root_fd, (TAKES_DIR, self.key, *rel.parts[:-1]), create=False)
                    if take_fd is not None:
                        opened.append(take_fd)
                    take_st = _stat_at(take_fd, rel.name)
                    if take_st is not None and not _is_take(take_st):
                        raise OSError(f"{TAKES_DIR}/{self.key}/{rel} is not a saved take")
                    out_fd = _open_dir(root_fd, rel.parts[:-1], create=True)
                    opened.append(out_fd)
                    entries.append((rel, take_fd, take_st, out_fd, _stat_at(out_fd, rel.name)))
                present = [entry for entry in entries if entry[2] is not None]
                if not present:
                    return None
                if len(present) != len(entries) and not all(
                        _same_inode(take_st, out_st) for _, _, take_st, _, out_st in present):
                    raise TakeIncomplete(
                        f"{self.names}: only part of the paid take is saved so far. Nothing was "
                        "submitted or charged now; wait for the app to save the rest, then run "
                        "this same command again.")
                moving = {index for index, entry in enumerate(present)
                          if entry[4] is not None and not _same_inode(entry[2], entry[4])
                          and not self._same_bytes(entry)}
                stamp = (self._free_stamp(root_fd, [present[index][0] for index in sorted(moving)])
                         if moving else None)
                for index, (rel, take_fd, take_st, out_fd, out_st) in enumerate(present):
                    if out_st is not None and _same_inode(take_st, out_st):
                        continue  # linked before an interruption
                    if index in moving:
                        previous_fd = _open_dir(root_fd, (PREVIOUS_DIR, stamp, *rel.parts[:-1]), create=True)
                        opened.append(previous_fd)
                        _dfd.rename(rel.name, rel.name, src_dir_fd=out_fd, dst_dir_fd=previous_fd)
                        _dfd.fsync(previous_fd)
                        kept.append(self.root / PREVIOUS_DIR / stamp / rel)
                    elif out_st is not None:
                        continue  # these bytes are already in place
                    _dfd.link(rel.name, rel.name, src_dir_fd=take_fd, dst_dir_fd=out_fd,
                            follow_symlinks=False)
                    _dfd.fsync(out_fd)
                for rel, take_fd, *_ in present:
                    _dfd.unlink(rel.name, dir_fd=take_fd)
                    _dfd.fsync(take_fd)
                self._prune()
        finally:
            for fd in opened:
                _dfd.close(fd)
            _dfd.close(root_fd)
        if kept and self._log_job is not None:
            log_event(self._log_job, tool=self.tool, event="previous_take_kept", render_md=False,
                      extra={"outputs": [str(rel) for rel in self.relative],
                             "previous": [str(path.relative_to(self.root)) for path in kept],
                             "take": self.key})
        return kept

    def set_aside(self) -> list[Path]:
        """Keep a saved take that cannot be used under ``previous_takes/``, unpublished."""
        kept: list[Path] = []
        root_fd = _dfd.open(self.root, _DIR_FLAGS)
        opened: list[int] = []
        try:
            with job_lock_at(root_fd):
                present = []
                for rel in self.relative:
                    take_fd = _open_dir(root_fd, (TAKES_DIR, self.key, *rel.parts[:-1]), create=False)
                    if take_fd is not None:
                        opened.append(take_fd)
                        if _stat_at(take_fd, rel.name) is not None:
                            present.append((rel, take_fd))
                stamp = self._free_stamp(root_fd, [rel for rel, _ in present]) if present else None
                for rel, take_fd in present:
                    previous_fd = _open_dir(root_fd, (PREVIOUS_DIR, stamp, *rel.parts[:-1]), create=True)
                    opened.append(previous_fd)
                    _dfd.rename(rel.name, rel.name, src_dir_fd=take_fd, dst_dir_fd=previous_fd)
                    _dfd.fsync(previous_fd)
                    kept.append(self.root / PREVIOUS_DIR / stamp / rel)
                self._prune()
        finally:
            for fd in opened:
                _dfd.close(fd)
            _dfd.close(root_fd)
        if kept and self._log_job is not None:
            log_event(self._log_job, tool=self.tool, event="unused_take_kept", render_md=False,
                      extra={"previous": [str(path.relative_to(self.root)) for path in kept],
                             "take": self.key})
        self.key = self._request_key
        self.paths = [self.root / TAKES_DIR / self.key / rel for rel in self.relative]
        self.adopted_from = None
        return kept

    def saved_record(self) -> dict | None:
        """The journal record that delivered this (single-file) take, if any.

        A take saved by the app after an interrupted run carries its provider
        fields (e.g. cast_avatar's BytePlus URL) only in the operation journal.
        """
        return self._record_of(self.paths[0]) if len(self.paths) == 1 else None

    def published_record(self) -> dict | None:
        """The journal record of this request's take whose bytes are now the (single) output.

        A run can stop after publishing its take but before recording it
        anywhere else (cast_avatar's character sheet): the output then holds
        bytes this exact request paid for, and only the journal still says so.
        """
        return self._record_of(self.outputs[0]) if len(self.outputs) == 1 else None

    def _record_of(self, path: Path) -> dict | None:
        """The record that delivered this request's take with the bytes now at ``path``."""
        from _operations import delivered_record
        if (self._log_job is None or self._context is None or not self.paths[0].is_relative_to(self._log_job)
                or not _is_take(_lstat(path))):
            return None
        relative = self.paths[0].relative_to(self._log_job).as_posix()
        return delivered_record(self._log_job, relative, file_sha256(path), self._context)

    def refusal(self, exc: Exception) -> Exception:
        """Say what to do when this take's paid request is refused before payment."""
        from _gateway import GatewayDestinationClaimedError, GatewayNotSubmittedError
        if isinstance(exc, GatewayDestinationClaimedError):
            if exc.blocked:
                text = (f"{self.names}: an earlier paid take for this exact request (operation "
                        f"{exc.operation_id}) cannot be saved because a different file is in the way "
                        f"under {TAKES_DIR}/{self.key}/. Nothing was submitted or charged now. Move that "
                        "file away; once the app has saved the take, run this same command again.")
            else:
                text = (f"{self.names}: this exact take is already paid for by another run (operation "
                        f"{exc.operation_id}). Nothing was submitted or charged now; do not start "
                        "another take. If that run is still going, it replaces "
                        f"{self.names} itself. If it was interrupted, run this same command again "
                        f"once the app has saved the take: it then replaces {self.names} without "
                        "paying again.")
            error = GatewayDestinationClaimedError(text)
            error.operation_id, error.blocked = exc.operation_id, exc.blocked
            error.detail = exc.detail
            return error
        if isinstance(exc, GatewayNotSubmittedError) and self.ready():
            return GatewayNotSubmittedError(
                f"{self.names}: another run has just saved the paid take for this exact request. "
                "Nothing was submitted or charged now; run this same command again to use it.")
        return exc

    def _same_bytes(self, entry) -> bool:
        rel, take_fd, take_st, out_fd, out_st = entry
        if not stat.S_ISREG(out_st.st_mode) or out_st.st_size != take_st.st_size:
            return False
        return _digest_at(take_fd, rel.name) == _digest_at(out_fd, rel.name)

    def _free_stamp(self, root_fd: int, relatives: list[PurePosixPath]) -> str:
        """A ``previous_takes/<UTC time>`` folder where none of these names exist yet."""
        base = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        for attempt in range(1, 1000):
            stamp = base if attempt == 1 else f"{base}-{attempt}"
            taken = False
            for rel in relatives:
                folder = _open_dir(root_fd, (PREVIOUS_DIR, stamp, *rel.parts[:-1]), create=False)
                if folder is not None:
                    try:
                        taken = _stat_at(folder, rel.name) is not None
                    finally:
                        _dfd.close(folder)
                if taken:
                    break
            if not taken:
                return stamp
        raise OSError("no free previous_takes folder")

    def _still_owed(self) -> bool:
        names = {path.relative_to(self.root).as_posix() for path in self.paths}
        return any(destination in names for destination, _, _ in self._pending)

    def _resume_saved_take(self) -> None:
        """Publish an owned, completed take of these outputs before buying another."""
        if self._context is None or self.ready() or self._still_owed():
            return
        from _operations import delivered_record
        root_fd = _dfd.open(self.root, _DIR_FLAGS)
        takes_fd = None
        try:
            takes_fd = _open_dir(root_fd, (TAKES_DIR,), create=False)
            if takes_fd is None:
                return
            for key in sorted(_dfd.listdir(takes_fd)):
                if key == self.key or len(key) != 16 or any(c not in "0123456789abcdef" for c in key):
                    continue
                for rel in self.relative:
                    folder = _open_dir(takes_fd, (key, *rel.parts[:-1]), create=False)
                    if folder is None:
                        break
                    try:
                        if (not _is_take(_stat_at(folder, rel.name)) or not delivered_record(
                                self.root, f"{TAKES_DIR}/{key}/{rel}", _digest_at(folder, rel.name), self._context)):
                            break
                    finally:
                        _dfd.close(folder)
                else:
                    self.adopted_from = key
                    self.key = key
                    self.paths = [self.root / TAKES_DIR / key / rel for rel in self.relative]
                    print(f"Found a saved paid take of {self.names} from earlier inputs. "
                          "Unusable takes are kept aside; re-run after "
                          "saved takes are published to buy a new take.")
                    return
        finally:
            if takes_fd is not None:
                _dfd.close(takes_fd)
            _dfd.close(root_fd)

    def _prune(self) -> None:
        """Remove this request's now-empty take folders."""
        base = self.root / TAKES_DIR / self.key
        folders = {base}
        for rel in self.relative:
            for depth in range(1, len(rel.parts)):
                folders.add(base.joinpath(*rel.parts[:depth]))
        for folder in sorted(folders, key=lambda path: len(path.parts), reverse=True):
            try:
                os.rmdir(folder)
            except OSError:
                pass
