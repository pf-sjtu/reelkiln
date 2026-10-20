"""
Structured per-job run log.

Every tool in tools/ should call log_event() at meaningful moments:
  - When it starts and finishes
  - For every external API call (model, prompt, response excerpt, latency)
  - For every artifact written (path, size)
  - For every retry, fallback, or downgrade
  - For every validation failure that's caught at the door

Two artifacts per job:
  <job_dir>/run.log.jsonl   — append-only, one JSON event per line. Authoritative.
  <job_dir>/run.md          — human-readable rebuild from the jsonl. Regenerated
                              after every event. Always reflects current state.

Why both: the jsonl is for tool/agent introspection (grep, jq, replay).
The .md is for the human reading the job dir to understand what happened.

Concurrency: jsonl appends are atomic on POSIX up to 4 KB. Events are kept under
that limit; long fields (prompts, responses) are truncated in the event with a
pointer to a sidecar file in <job_dir>/run/<event_id>.txt for the full text.
"""

from __future__ import annotations

import json
import _compat_lock as fcntl  # port: fcntl on POSIX, msvcrt on Windows
import os
import _compat_dirfd as _dfd  # port: dir_fd/O_DIRECTORY emulation on Windows (POSIX: same os functions)
import stat
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

LOG_NAME = "run.log.jsonl"
MD_NAME = "run.md"
SIDECAR_DIR = "run"
INLINE_TEXT_LIMIT = 600  # chars; longer payloads spill to sidecar files
JOB_LOCK_NAME = ".videoclaw-job.lock"

_LOCK_CONDITION = threading.Condition()
_LOCKS: dict[tuple[int, int], dict[str, int]] = {}
_LOCK_PID = os.getpid()


def _after_fork_child() -> None:
    """Reset process-local lock bookkeeping without touching inherited locks.

    A fork can happen while another parent thread owns ``_LOCK_CONDITION``.
    The child has only the forking thread, so acquiring that inherited condition
    would deadlock forever. This at-fork hook therefore replaces the condition
    and registry directly. Closing the child's duplicate registry descriptors
    does not unlock the parent's flock: the parent retains its descriptor and
    process state. Any child logger subsequently opens and locks the canonical
    lock leaf for itself.
    """
    global _LOCK_CONDITION, _LOCKS, _LOCK_PID
    inherited = _LOCKS
    _LOCK_CONDITION = threading.Condition()
    _LOCKS = {}
    _LOCK_PID = os.getpid()
    closed: set[int] = set()
    for state in inherited.values():
        inherited_fd = state.get("fd", -1)
        if inherited_fd >= 0 and inherited_fd not in closed:
            try:
                _dfd.close(inherited_fd)
            except OSError:
                pass
            closed.add(inherited_fd)


def _reset_inherited_locks() -> None:
    """Discard a fork child's copies without unlocking the parent's flock."""
    current_pid = os.getpid()
    if current_pid == _LOCK_PID:
        return
    # Fallback for an embedding that forked before this module registered its
    # hook. Normal POSIX forks have already run the hook before Python resumes.
    _after_fork_child()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_after_fork_child)


class JobLockTimeout(TimeoutError):
    """The job lock was not free within the caller's ``timeout``."""


_LOCK_OPEN_ATTEMPTS = 64


def _open_job_lock(job_fd: int) -> int:
    """Open the job's lock leaf, creating it exactly once.

    Several paid tools often start on a fresh job at the same moment. On macOS
    a plain ``openat(O_CREAT)`` racing another process's creation of the same
    name can fail with ENOENT (reproduced: about one in three of six racing
    first opens; videoclaw#273), which killed a tool before it did any work.
    Open an existing leaf first and create only exclusively; a lost creation
    race simply opens the winner's file on the next attempt.
    """
    flags = os.O_RDWR | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
    last: OSError | None = None
    for _ in range(_LOCK_OPEN_ATTEMPTS):
        try:
            return _dfd.open(JOB_LOCK_NAME, flags, dir_fd=job_fd)
        except FileNotFoundError as exc:
            last = exc
        try:
            return _dfd.open(
                JOB_LOCK_NAME, flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=job_fd
            )
        except (FileExistsError, FileNotFoundError) as exc:
            last = exc
    assert last is not None
    raise last


@contextmanager
def job_lock_at(job_fd: int, timeout: float | None = None):
    """Take the process-reentrant, interprocess lock for one pinned job.

    Gateway cost logging re-enters from the same thread while mint_image owns
    its publication transaction. Other threads and processes serialize on the
    same descriptor-relative lock file.

    ``timeout`` (seconds) bounds the wait for another holder; past it,
    ``JobLockTimeout`` is raised and nothing is held. ``None`` waits as long
    as it takes.
    """
    deadline = None if timeout is None else time.monotonic() + max(0.0, timeout)
    identity = _dfd.fstat(job_fd)
    if not stat.S_ISDIR(identity.st_mode):
        raise OSError("job lock descriptor must reference a directory")
    key = (identity.st_dev, identity.st_ino)
    owner = threading.get_ident()
    lock_fd = -1
    with _LOCK_CONDITION:
        _reset_inherited_locks()
        while key in _LOCKS and _LOCKS[key]["owner"] != owner:
            if deadline is None:
                _LOCK_CONDITION.wait()
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise JobLockTimeout("job lock busy")
            _LOCK_CONDITION.wait(remaining)
        state = _LOCKS.get(key)
        if state is not None:
            state["count"] += 1
        else:
            _LOCKS[key] = {"owner": owner, "count": 1, "fd": -1}
            state = None
    if state is None:
        try:
            lock_fd = _open_job_lock(job_fd)
            if not stat.S_ISREG(_dfd.fstat(lock_fd).st_mode):
                raise OSError(f"{JOB_LOCK_NAME} must be a regular file")
            if deadline is None:
                fcntl.flock(lock_fd, fcntl.LOCK_EX)
            else:
                while True:
                    try:
                        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise JobLockTimeout("job lock busy") from None
                        time.sleep(min(0.02, remaining))
            with _LOCK_CONDITION:
                _LOCKS[key]["fd"] = lock_fd
        except BaseException:
            if lock_fd >= 0:
                _dfd.close(lock_fd)
            with _LOCK_CONDITION:
                _LOCKS.pop(key, None)
                _LOCK_CONDITION.notify_all()
            raise
    with _LOCK_CONDITION:
        active_fd = _LOCKS[key]["fd"]
    try:
        expected = _dfd.fstat(active_fd)
        try:
            current = _dfd.stat(
                JOB_LOCK_NAME, dir_fd=job_fd, follow_symlinks=False
            )
        except OSError as exc:
            raise OSError("job lock changed during acquisition") from exc
        if (
            not stat.S_ISREG(current.st_mode)
            or (current.st_dev, current.st_ino)
            != (expected.st_dev, expected.st_ino)
        ):
            raise OSError("job lock changed during acquisition")
        yield active_fd
    finally:
        with _LOCK_CONDITION:
            current = _LOCKS[key]
            current["count"] -= 1
            if current["count"] == 0:
                held_fd = current["fd"]
                if held_fd >= 0:
                    fcntl.flock(held_fd, fcntl.LOCK_UN)
                    _dfd.close(held_fd)
                del _LOCKS[key]
                _LOCK_CONDITION.notify_all()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _truncate(text: str | None, label: str, job_dir: Path, event_id: str) -> dict[str, Any]:
    """Return either the inline text (if short enough) or a pointer to a sidecar file."""
    if text is None:
        return {label: None}
    if len(text) <= INLINE_TEXT_LIMIT:
        return {label: text}
    sidecar = job_dir / SIDECAR_DIR / f"{event_id}__{label}.txt"
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(text)
    return {
        label: text[:INLINE_TEXT_LIMIT] + f"... [+{len(text) - INLINE_TEXT_LIMIT} chars]",
        f"{label}_sidecar": str(sidecar.relative_to(job_dir)),
    }


def _truncate_at(
    text: str | None,
    label: str,
    job_fd: int,
    event_id: str,
    run_fd: int,
    published: list[str],
) -> dict[str, Any]:
    """Descriptor-relative counterpart to _truncate for a pinned job dir."""
    if text is None:
        return {label: None}
    if len(text) <= INLINE_TEXT_LIMIT:
        return {label: text}
    filename = f"{event_id}__{label}.txt"
    try:
        _dfd.stat(filename, dir_fd=run_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        raise FileExistsError(f"sidecar already exists: {filename}")
    _replace_at(run_fd, filename, text.encode("utf-8"))
    current = _dfd.stat(filename, dir_fd=run_fd, follow_symlinks=False)
    if not stat.S_ISREG(current.st_mode):
        raise OSError(f"sidecar must be a regular file: {filename}")
    _dfd.fsync(run_fd)
    published.append(filename)
    return {
        label: text[:INLINE_TEXT_LIMIT] + f"... [+{len(text) - INLINE_TEXT_LIMIT} chars]",
        f"{label}_sidecar": f"{SIDECAR_DIR}/{filename}",
    }


def log_event(
    job_dir: Path | str,
    tool: str,
    event: str,
    *,
    prompt: str | None = None,
    response: str | None = None,
    duration_seconds: float | None = None,
    extra: dict[str, Any] | None = None,
    render_md: bool = True,
    lock_timeout: float | None = None,
) -> str:
    """Append one event to <job_dir>/run.log.jsonl. Returns the event_id.

    Use named kwargs only — positional args invite mistakes when adding fields.
    `prompt` and `response` are special-cased: long values spill to sidecar
    files so the jsonl stays grep-able. ``lock_timeout`` bounds the wait for
    the job lock (``JobLockTimeout``, nothing written); ``None`` waits.
    """
    job_dir = Path(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)

    flags = os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_CLOEXEC
    job_fd = _dfd.open(job_dir, flags)
    try:
        return log_event_at(
            job_fd,
            job_dir.name,
            tool,
            event,
            prompt=prompt,
            response=response,
            duration_seconds=duration_seconds,
            extra=extra,
            render_md=render_md,
            lock_timeout=lock_timeout,
        )
    finally:
        _dfd.close(job_fd)


def log_event_at(
    job_fd: int,
    job_name: str,
    tool: str,
    event: str,
    *,
    prompt: str | None = None,
    response: str | None = None,
    duration_seconds: float | None = None,
    extra: dict[str, Any] | None = None,
    render_md: bool = True,
    lock_timeout: float | None = None,
) -> str:
    """Append an event relative to an already-open, identity-pinned job dir."""
    if not stat.S_ISDIR(_dfd.fstat(job_fd).st_mode):
        raise OSError("pinned job descriptor must reference a directory")
    with job_lock_at(job_fd, timeout=lock_timeout):
        return _log_event_at_locked(
            job_fd,
            job_name,
            tool,
            event,
            prompt=prompt,
            response=response,
            duration_seconds=duration_seconds,
            extra=extra,
            render_md=render_md,
        )


def _same_named_object(dir_fd: int, name: str, expected: os.stat_result) -> bool:
    try:
        current = _dfd.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except OSError:
        return False
    return (
        stat.S_IFMT(current.st_mode) == stat.S_IFMT(expected.st_mode)
        and (current.st_dev, current.st_ino) == (expected.st_dev, expected.st_ino)
    )


def _log_event_at_locked(
    job_fd: int,
    job_name: str,
    tool: str,
    event: str,
    *,
    prompt: str | None,
    response: str | None,
    duration_seconds: float | None,
    extra: dict[str, Any] | None,
    render_md: bool,
) -> str:
    event_id = uuid.uuid4().hex[:10]
    record: dict[str, Any] = {
        "id": event_id,
        "ts": _now(),
        "tool": tool,
        "event": event,
    }
    if duration_seconds is not None:
        record["duration_seconds"] = round(duration_seconds, 3)

    run_fd = -1
    run_stat: os.stat_result | None = None
    published: list[str] = []
    log_fd = -1
    original_size = 0
    appended = False
    needs_sidecars = any(
        value is not None and len(value) > INLINE_TEXT_LIMIT
        for value in (prompt, response)
    )
    try:
        if needs_sidecars:
            try:
                _dfd.mkdir(SIDECAR_DIR, mode=0o700, dir_fd=job_fd)
            except FileExistsError:
                pass
            run_fd = _dfd.open(
                SIDECAR_DIR,
                os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=job_fd,
            )
            run_stat = _dfd.fstat(run_fd)
            if not _same_named_object(job_fd, SIDECAR_DIR, run_stat):
                raise OSError("run sidecar directory changed during logging")
        record.update(
            _truncate_at(prompt, "prompt", job_fd, event_id, run_fd, published)
        )
        record.update(
            _truncate_at(response, "response", job_fd, event_id, run_fd, published)
        )
        if run_stat is not None and not _same_named_object(
            job_fd, SIDECAR_DIR, run_stat
        ):
            raise OSError("run sidecar directory changed during logging")
        if extra:
            for key, value in extra.items():
                if key not in record:
                    record[key] = value

        flags = os.O_RDWR | os.O_APPEND | os.O_CREAT | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
        log_fd = _dfd.open(LOG_NAME, flags, 0o644, dir_fd=job_fd)
        log_stat = _dfd.fstat(log_fd)
        if not stat.S_ISREG(log_stat.st_mode):
            raise OSError(f"{LOG_NAME} must be a regular file")
        original_size = log_stat.st_size
        payload = (json.dumps(record, default=str) + "\n").encode("utf-8")
        written = os.write(log_fd, payload)
        appended = written > 0
        if written != len(payload):
            raise OSError(f"short append to {LOG_NAME}")
        _dfd.fsync(log_fd)
        if not _same_named_object(job_fd, LOG_NAME, log_stat):
            raise OSError(f"{LOG_NAME} changed during append")
        if run_stat is not None and not _same_named_object(
            job_fd, SIDECAR_DIR, run_stat
        ):
            raise OSError("run sidecar directory changed during logging")

        if render_md:
            try:
                markdown = _render_markdown_text(_read_events_at(job_fd), job_name)
                _replace_at(job_fd, MD_NAME, markdown.encode())
            except Exception as exc:
                print(f"[log.py] render_markdown failed: {exc}", file=sys.stderr)
        return event_id
    except BaseException:
        if appended and log_fd >= 0:
            try:
                os.ftruncate(log_fd, original_size)
                _dfd.fsync(log_fd)
            except OSError:
                pass
        if run_fd >= 0:
            for filename in published:
                try:
                    _dfd.unlink(filename, dir_fd=run_fd)
                except OSError:
                    pass
            try:
                _dfd.fsync(run_fd)
            except OSError:
                pass
        raise
    finally:
        if log_fd >= 0:
            _dfd.close(log_fd)
        if run_fd >= 0:
            _dfd.close(run_fd)


def _read_events_at(job_fd: int) -> list[dict[str, Any]]:
    flags = os.O_RDONLY | _dfd.O_NONBLOCK | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
    try:
        fd = _dfd.open(LOG_NAME, flags, dir_fd=job_fd)
    except FileNotFoundError:
        return []
    try:
        if not stat.S_ISREG(_dfd.fstat(fd).st_mode):
            raise OSError(f"{LOG_NAME} must be a regular file")
        with os.fdopen(fd, "r", encoding="utf-8", closefd=False) as source:
            lines = source.readlines()
    finally:
        _dfd.close(fd)
    events: list[dict[str, Any]] = []
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            events.append(value)
    return events


def _replace_at(dir_fd: int, filename: str, data: bytes) -> None:
    temporary = f".videoclaw-log-{os.getpid()}-{os.urandom(8).hex()}.tmp"
    fd = -1
    try:
        fd = _dfd.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
            0o600,
            dir_fd=dir_fd,
        )
        with os.fdopen(fd, "wb", closefd=True) as destination:
            fd = -1
            destination.write(data)
            destination.flush()
            _dfd.fsync(destination.fileno())
        _dfd.replace(temporary, filename, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    finally:
        if fd >= 0:
            _dfd.close(fd)
        try:
            _dfd.unlink(temporary, dir_fd=dir_fd)
        except FileNotFoundError:
            pass


@contextmanager
def timed_event(job_dir: Path | str, tool: str, event: str, **kwargs):
    """Context manager that auto-times an event.

    Usage:
        with timed_event(job, "seedance.py", "chunk_generation", extra={"chunk_index": 0}):
            output = replicate.run(...)
    """
    start = time.perf_counter()
    record_id = None
    try:
        yield {}  # caller can mutate this dict to add fields after the fact
        elapsed = time.perf_counter() - start
        log_event(job_dir, tool, event, duration_seconds=elapsed, **kwargs)
    except Exception as e:
        elapsed = time.perf_counter() - start
        extra = dict(kwargs.pop("extra", {}) or {})
        extra["error"] = type(e).__name__
        extra["error_message"] = str(e)[:300]
        log_event(job_dir, tool, f"{event}_failed", duration_seconds=elapsed, extra=extra, **kwargs)
        raise


def read_events(job_dir: Path | str) -> list[dict[str, Any]]:
    job_dir = Path(job_dir)
    log_path = job_dir / LOG_NAME
    if not log_path.exists():
        return []
    out = []
    for line in log_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def _fmt_dt(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%H:%M:%S")
    except Exception:
        return iso


def _summarise_company(events: list[dict]) -> str:
    for e in events:
        if e["tool"] == "pick_company.py" and e["event"] == "job_created":
            return e.get("company_name") or e.get("name") or ""
    return ""


def _render_markdown_text(events: list[dict], job_id: str) -> str:
    """Render run.md contents without choosing a path or descriptor."""
    # Group by tool, in order of first occurrence
    tools_in_order: list[str] = []
    seen: set[str] = set()
    for e in events:
        t = e.get("tool", "?")
        if t not in seen:
            tools_in_order.append(t)
            seen.add(t)

    parts: list[str] = []
    parts.append(f"# Run log — `{job_id}`\n")
    parts.append(f"_Auto-generated from `{LOG_NAME}`. Do not edit by hand._\n")
    parts.append(f"\n_{len(events)} events across {len(tools_in_order)} tools._\n")

    company = _summarise_company(events)
    if company:
        parts.append(f"\n**Company:** {company}\n")

    # Top-level chronological summary table
    parts.append("\n## Timeline\n")
    parts.append("| Time | Tool | Event | Duration | Notes |")
    parts.append("|------|------|-------|----------|-------|")
    for e in events:
        time_str = _fmt_dt(e.get("ts", ""))
        tool = e.get("tool", "?")
        event = e.get("event", "?")
        duration = (
            f"{e['duration_seconds']:.1f}s" if e.get("duration_seconds") is not None else ""
        )
        # Build a brief note from a few well-known fields
        notes_parts = []
        for k in ("model", "url", "chunk_index", "attempt", "size_bytes",
                  "candidates", "words", "overlays", "byteplus_url",
                  "error", "error_message"):
            if k in e:
                v = e[k]
                if isinstance(v, str) and len(v) > 50:
                    v = v[:50] + "…"
                notes_parts.append(f"`{k}`={v}")
        notes = " · ".join(notes_parts)
        parts.append(f"| {time_str} | {tool} | {event} | {duration} | {notes} |")

    # Per-tool detail sections
    parts.append("\n## Detail by tool\n")
    for tool in tools_in_order:
        parts.append(f"\n### `{tool}`\n")
        for e in events:
            if e.get("tool") != tool:
                continue
            parts.append(f"\n**[{_fmt_dt(e['ts'])}] {e['event']}** "
                         f"(`{e['id']}`)")
            for k in sorted(e.keys()):
                if k in ("id", "ts", "tool", "event"):
                    continue
                v = e[k]
                if k == "prompt" or k == "response":
                    parts.append(f"\n<details><summary>{k}</summary>\n\n```\n{v}\n```\n</details>\n")
                elif isinstance(v, (dict, list)):
                    parts.append(f"- `{k}`: ```json\n{json.dumps(v, indent=2)[:600]}\n```")
                else:
                    s = str(v)
                    if len(s) > 200:
                        s = s[:200] + "…"
                    parts.append(f"- `{k}`: {s}")
            parts.append("")

    return "\n".join(parts) + "\n"


def render_markdown(job_dir: Path | str) -> Path:
    """Regenerate <job_dir>/run.md from the jsonl. Always overwrites."""
    job_dir = Path(job_dir)
    md_path = job_dir / MD_NAME
    job_fd = _dfd.open(job_dir, os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_CLOEXEC)
    try:
        with job_lock_at(job_fd):
            markdown = _render_markdown_text(
                _read_events_at(job_fd),
                job_dir.name,
            )
            _replace_at(job_fd, MD_NAME, markdown.encode())
    finally:
        _dfd.close(job_fd)
    return md_path


# ---------------------------------------------------------------------------
# CLI: tools/log.py render --job <id>
# ---------------------------------------------------------------------------


def _cli() -> None:
    import argparse
    from job import resolve_job_dir, add_job_arg

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_render = sub.add_parser("render", help="Regenerate run.md from run.log.jsonl")
    add_job_arg(p_render)

    p_show = sub.add_parser("show", help="Print run.md to stdout")
    add_job_arg(p_show)

    p_events = sub.add_parser("events", help="List events as compact JSON lines")
    add_job_arg(p_events)
    p_events.add_argument("--tool", help="Filter to one tool name")

    args = parser.parse_args()
    job = resolve_job_dir(args.job)

    if args.cmd == "render":
        path = render_markdown(job)
        print(f"Wrote {path}")
    elif args.cmd == "show":
        md = job / MD_NAME
        if md.exists():
            print(md.read_text())
        else:
            render_markdown(job)
            print((job / MD_NAME).read_text())
    elif args.cmd == "events":
        events = read_events(job)
        if args.tool:
            events = [e for e in events if e.get("tool") == args.tool]
        for e in events:
            print(json.dumps(e, default=str))


if __name__ == "__main__":
    _cli()
