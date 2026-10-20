#!/usr/bin/env python3
"""review_render — one look at the finished video before it is presented.

Run once after the final render (strongly recommended, never required):

    cd "$VIDEOCLAW_ENGINE" && uv run python tools/review_render.py --job <id or job path> \
        [--path <job-relative deliverable>]

What it looks at: the deliverable of the job's newest render-complete record
(``renders/<sha256>.json``); with ``--path``, the newest record for that
deliverable. The file at that path is hashed: if it still holds the recorded
bytes, the retained copy (``renders/<sha256>.<ext>``) is looked at;
otherwise the current file is, if it is a complete video. Without a record
it looks at the deliverable file itself (``final.mp4`` by default) if it is a
complete video.

What it prints: exactly one line on stdout, always the last line, and nothing
else:

    Before presenting this video, fix: <problem 1>; <problem 2>; <problem 3>. Then render again.
    Still present after a fix: <problem>. Tell the user about it briefly; don't try again.
    Nothing to fix before presenting.

It asks for at most three serious problems to be fixed. The job's fix cycle
is keyed on the bytes looked at: the same bytes get the same answer again
(no new look); a look at other bytes after an ask (the one fix happened)
names whatever serious problem is still there as still present, or says there
is nothing to fix, and closes the cycle; silence never implies that a fix
worked. If anything goes wrong (the look cannot be completed in time, the
service refuses it, a bad argument, or anything else) it prints ``Nothing to
fix before presenting.`` The exit status is always 0 (``--help`` prints the
usage). It logs how long it took to the job's run log
(``finishing_look_done``).

How it runs: this command is a thin parent. It parses the arguments, starts
ONE worker process in its own session that does everything else (finding the
target, the job's look lock, the look, settling the fix cycle), and waits for
it under a hard wall-clock budget (``VIDEOCLAW_RENDER_REVIEW_TIMEOUT_S``,
default 170 s, at most 180 s). The worker decides the answer, prints the
answer line and flushes it, then persists the fix cycle (best effort,
bounded), and only then does optional logging. The parent prints the worker's answer line if it produced
a valid one (even if it is stopped afterwards), otherwise ``Nothing to fix
before presenting.``; at the budget it stops the worker's whole process
group. Concurrent looks at one job are serialized by an exclusive job lock.

It is free to the user: the model part runs on the house-paid route
(``/v1/harness/review``). ``VIDEOCLAW_RENDER_REVIEW=off`` makes it print
``Nothing to fix before presenting.`` at once.
"""

from __future__ import annotations

import argparse
import contextlib
import heapq
import json
import os
import re
import selectors
import stat
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _paths import OUTPUT_ROOT  # noqa: E402
from _render_completion import (  # noqa: E402
    FACTS_DIR,
    MIN_REVIEW_S,
    NOTHING_TO_FIX,
    NOTICE_LEAD,
    NOTICE_TAIL,
    PARENT_PID_ENV,
    RECORD_SCHEMA,
    RECORDS_DIR,
    STILL_LEAD,
    STILL_TAIL,
    _hash_until,
    _kill_group,
    _log_quietly,
    job_look_lock,
    persist_cycle,
    review_bytes,
    review_enabled,
    review_timeout_s,
)

DEFAULT_DELIVERABLE = "final.mp4"
_SHA256 = re.compile(r"[0-9a-f]{64}")
PROBE_TIMEOUT_S = 15.0
# Bounded reading, like the project brief: the newest record files only, and
# none larger than a record can be (~300 bytes).
MAX_RECORDS = 64
MAX_RECORD_BYTES = 4096
# The worker must have printed its answer this long before the parent's hard
# stop; a cached answer needs well under a second.
WORKER_MARGIN_S = 2.0
LOCK_SPARE_S = 1.0
_VALID_ANSWER = re.compile(
    rf"^(?:{re.escape(NOTHING_TO_FIX)}"
    rf"|{re.escape(NOTICE_LEAD)} [^\n]+\. {re.escape(NOTICE_TAIL)}"
    rf"|{re.escape(STILL_LEAD)} [^\n]+\. {re.escape(STILL_TAIL)})$")
MAX_ANSWER_CHARS = 4000


def _job_dir(job: str) -> Path | None:
    """The existing job directory (never creates one)."""
    as_path = Path(job)
    if as_path.is_dir():
        return as_path.resolve()
    candidate = OUTPUT_ROOT / job
    return candidate.resolve() if candidate.is_dir() else None


def _inside(job: Path, relative: str) -> Path | None:
    """``job / relative`` when it is a real file inside the job, else None."""
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        return None
    candidate = job / relative
    try:
        resolved = candidate.resolve(strict=True)
    except OSError:
        return None
    if not resolved.is_relative_to(job) or candidate.is_symlink() or not resolved.is_file():
        return None
    return candidate


def _normalized(relative: str) -> str:
    """``./final.mp4`` and ``final.mp4`` name the same deliverable."""
    return Path(os.path.normpath(relative)).as_posix()


def _record_files(job: Path, deadline: float) -> list[str]:
    """The newest ``MAX_RECORDS`` small record files, newest first: one pass
    over the folder with a bounded heap, stopping at the deadline."""
    newest: list[tuple[float, str]] = []
    try:
        with os.scandir(job / RECORDS_DIR) as entries:
            for index, entry in enumerate(entries):
                if index % 256 == 0 and time.monotonic() > deadline:
                    break
                if not entry.name.endswith(".json"):
                    continue
                try:
                    info = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_RECORD_BYTES:
                    continue
                item = (info.st_mtime, entry.path)
                if len(newest) < MAX_RECORDS:
                    heapq.heappush(newest, item)
                else:
                    heapq.heappushpop(newest, item)
    except OSError:
        return []
    return [path for _mtime, path in sorted(newest, reverse=True)]


def _records(job: Path, deadline: float | None = None) -> list[dict]:
    """Valid render-complete records among the newest ``MAX_RECORDS`` record
    files, newest first."""
    deadline = time.monotonic() + 60 if deadline is None else deadline
    records = []
    for name in _record_files(job, deadline):
        path = Path(name)
        if time.monotonic() > deadline:
            break
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not (
            isinstance(record, dict)
            and record.get("schema") == RECORD_SCHEMA
            and isinstance(record.get("sha256"), str) and _SHA256.fullmatch(record["sha256"])
            and record["sha256"] == path.stem
            and isinstance(record.get("path"), str) and record["path"]
            and isinstance(record.get("bytes"), int) and not isinstance(record["bytes"], bool)
            and record["bytes"] > 0
            and isinstance(record.get("completed_at"), (int, float))
            and not isinstance(record["completed_at"], bool)
        ):
            continue
        records.append(record)
    return sorted(records, key=lambda record: record["completed_at"], reverse=True)


def _retained(job: Path, record: dict) -> str | None:
    """The record's retained copy, if it is still there with its size."""
    relative = record.get("retained")
    found = _inside(job, relative) if isinstance(relative, str) else None
    if found is not None and found.stat().st_size == record["bytes"]:
        return relative
    return None


def _complete_video(path: Path, deadline: float) -> bool:
    """A video file a player can open to the end (it has a duration)."""
    timeout = min(PROBE_TIMEOUT_S, deadline - time.monotonic())
    if timeout <= 0:
        return False
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=codec_type:format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
        )
        probe = json.loads(result.stdout or "{}")
        duration = float((probe.get("format") or {}).get("duration") or 0)
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return False
    return (result.returncode == 0 and duration > 0
            and any(s.get("codec_type") == "video" for s in probe.get("streams") or []))


def _facts(job: Path, sha256: str) -> dict:
    """What the render that published these bytes drew, if it said."""
    try:
        facts = json.loads((job / FACTS_DIR / f"{sha256}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return facts if isinstance(facts, dict) and facts.get("output_sha256") == sha256 else {}


def select_target(job: Path, path: str | None, deadline: float) -> tuple[str, str, dict] | None:
    """``(job-relative file, sha256, facts)`` to look at, or None.

    The newest record for the path (by default the newest record) names the
    deliverable. Its current file is hashed: only if it still holds the
    recorded bytes is the retained copy trusted; otherwise (a later
    publication whose record could not be written, or any other change) the
    current bytes are looked at, if they are a complete video.
    """
    wanted = _normalized(path) if path else None
    hash_by = deadline - MIN_REVIEW_S  # leave the look its time
    for record in _records(job, deadline):
        if wanted is not None and _normalized(record["path"]) != wanted:
            continue
        current = _inside(job, record["path"])
        if current is None:
            # The deliverable is gone; its retained bytes are what was made.
            retained = _retained(job, record)
            if retained is not None:
                return retained, record["sha256"], _facts(job, record["sha256"])
            continue
        sha256 = _hash_until(current, hash_by)
        if sha256 is None:
            return None
        if sha256 == record["sha256"]:
            return (_retained(job, record) or record["path"]), sha256, _facts(job, sha256)
        return _current_file(job, record["path"], deadline, sha256)
    # No record: the deliverable itself, if it is a complete video.
    relative = wanted or DEFAULT_DELIVERABLE
    current = _inside(job, relative)
    if current is None:
        return None
    sha256 = _hash_until(current, hash_by)
    return None if sha256 is None else _current_file(job, relative, deadline, sha256)


def _current_file(job: Path, relative: str, deadline: float,
                  sha256: str) -> tuple[str, str, dict] | None:
    """The deliverable file as it is now (its hash already taken), if it is a
    complete video."""
    found = _inside(job, relative)
    if found is None or found.stat().st_size <= 0 or not _complete_video(found, deadline):
        return None
    return relative, sha256, _facts(job, sha256)


def look(job_arg: str, path: str | None, deadline: float,
         emit=None) -> tuple[str | None, Path | None, str | None]:
    """``(line, job, sha256)``: the answer line (None for nothing to fix) and
    what it was about.

    The whole lookup, look, answer and settlement runs under the job's
    exclusive look lock; if the lock cannot be had in time there is nothing
    to fix. ``emit(line)`` is called with the answer as soon as it is
    decided, BEFORE the fix cycle is persisted (best effort, bounded), so a
    stalled write can never hold a found problem back.
    """
    emit = emit or (lambda _line: None)
    job = _job_dir(job_arg) if review_enabled() else None
    if job is None:
        emit(None)
        return None, None, None
    with job_look_lock(job, until=deadline - LOCK_SPARE_S) as held:
        if not held:
            emit(None)
            return None, job, None
        target = select_target(job, path, deadline)
        if target is None:
            emit(None)
            return None, job, None
        video, sha256, facts = target
        line, record = review_bytes(job, video=video, sha256=sha256, facts=facts,
                                    deadline=deadline)
        emit(line)
        persist_cycle(job, record, until=deadline)
        return line, job, sha256


def run_worker(job_arg: str, path: str | None, deadline: float, out) -> None:
    """The worker: decide the answer, print it and flush, then persist the
    fix cycle (best effort, bounded), and only then log how long it took."""
    started = time.monotonic()
    line, job, sha256 = None, None, None
    printed = False

    def emit(answer: str | None) -> None:
        nonlocal printed
        if not printed:
            out.write((answer or NOTHING_TO_FIX) + "\n")
            out.flush()
            printed = True

    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), \
            contextlib.redirect_stderr(sink):
        try:
            line, job, sha256 = look(job_arg, path, deadline, emit)
        except Exception:  # noqa: BLE001 — a failed look reads as nothing to fix
            line = None
        emit(line)  # no-op if already printed
        if job is not None and sha256 is not None:
            # Optional: how long the finishing step took (time-to-assistant-
            # completion adds it to the render), in neutral words.
            _log_quietly(job, "review_render", "finishing_look_done", deadline=deadline,
                         sha256=sha256, duration_seconds=round(time.monotonic() - started, 3),
                         asked_to_fix=bool(line and line.startswith(NOTICE_LEAD)),
                         still_present=bool(line and line.startswith(STILL_LEAD)))


class _BadArguments(Exception):
    """A missing or invalid argument (it reads as nothing to fix)."""


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # noqa: D102 — no usage text, no exit 2
        raise _BadArguments(message)


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(
        description="One look at the finished video before it is presented.")
    parser.add_argument("--job", required=True,
                        help="Job ID or job directory (under jobs/). REQUIRED.")
    parser.add_argument("--path", default=None,
                        help="Job-relative deliverable to look at (default: the newest "
                             "rendered deliverable, else final.mp4).")
    # Internal: the worker process this command starts (wall-clock deadline).
    parser.add_argument("--worker-deadline", type=float, default=None, help=argparse.SUPPRESS)
    return parser


def valid_answer(line: str) -> bool:
    return len(line) <= MAX_ANSWER_CHARS and bool(_VALID_ANSWER.match(line))


def _worker_command(args, deadline_epoch: float) -> list[str]:
    command = [sys.executable, str(Path(__file__).resolve()), "--job", args.job,
               "--worker-deadline", f"{deadline_epoch:.3f}"]
    return command + (["--path", args.path] if args.path else [])


def _run_worker(args, budget: float) -> str | None:
    """Start the worker in its own session and wait for it, at most
    ``budget`` seconds; at the budget its whole process group is stopped.
    Returns the last valid answer line it printed, or None."""
    started = time.monotonic()
    deadline = started + budget
    env = {**os.environ, "PYTHON_DOTENV_DISABLED": "1", PARENT_PID_ENV: str(os.getpid())}
    proc = subprocess.Popen(
        _worker_command(args, time.time() + budget - WORKER_MARGIN_S),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=env, start_new_session=True,
    )
    answer: str | None = None
    buffered = b""
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while True:
                left = deadline - time.monotonic()
                if left <= 0 or not selector.select(timeout=left):
                    break  # out of time
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break  # the worker is done
                buffered = (buffered + chunk)[-(4 * MAX_ANSWER_CHARS):]
                *lines, buffered = buffered.split(b"\n")
                for raw in lines:
                    line = raw.decode("utf-8", "replace").strip()
                    if valid_answer(line):
                        answer = line  # taken as soon as it appears
        left = deadline - time.monotonic()
        if left > 0:
            try:
                proc.wait(timeout=left)
            except subprocess.TimeoutExpired:
                pass
    finally:
        _kill_group(proc)  # whatever it started goes with it
        proc.stdout.close()
    return answer


def main(argv: list[str] | None = None) -> int:
    out = sys.stdout
    try:
        args = build_parser().parse_args(argv)  # --help prints and exits 0
    except _BadArguments:
        args = None  # a bad or missing argument reads as nothing to fix
    if args is not None and args.worker_deadline is not None:
        from _render_review_child import _supervise

        try:
            # The worker ends itself (and everything in its group) if the
            # command that started it dies or its hard stop passes.
            _supervise(args.worker_deadline + WORKER_MARGIN_S, int(os.environ[PARENT_PID_ENV]))
        except (KeyError, ValueError):
            return 0
        deadline = time.monotonic() + max(0.0, args.worker_deadline - time.time())
        run_worker(args.job, args.path, deadline, out)
        return 0
    line = None
    if args is not None and review_enabled():
        try:
            with open(os.devnull, "w") as sink, contextlib.redirect_stderr(sink):
                line = _run_worker(args, review_timeout_s())
        except Exception:  # noqa: BLE001 — the agent never learns a look failed
            line = None
    out.write((line or NOTHING_TO_FIX) + "\n")
    out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
