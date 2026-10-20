"""Final deliverables: atomic publish, retained bytes, the render-complete
record, and the one bounded review an agent may ask for (``review_render``).

A final deliverable is what a render command produces for the user:
``compose_render`` (render, retrofit, bespoke, episode, cover_bake),
``remotion_render``, and a score-last music mix (``score_bed`` onto a finished
render writes ``audio/final_mix.mp4``).

1. Atomic publish (``publish_deliverable``). The writer renders and finishes
   into a staging file in the same directory. Before anything is published its
   sha256 and size are taken, and a retained copy is made at
   ``renders/<sha256>.<ext>`` (its own inode: a copy-on-write clone, or an
   fsynced copy; checked against the sha256). Then the staging file is fsynced and
   ``os.replace``d onto the final path. The final path never holds a partial
   file, and a later render replacing it cannot take these bytes away.

2. Render-complete record, written atomically right after the publish
   (videoclaw-app#904 mints versions from it)::

       jobs/<id>/renders/<sha256>.json
       {"schema": "videoclaw.render-complete/v1",
        "sha256": "<hex of the published bytes>",
        "path": "<job-relative path, e.g. final.mp4 or audio/final_mix.mp4>",
        "bytes": <size>,
        "tool": "<compose_render|remotion_render|score_bed>",
        "completed_at": <unix seconds, float>,
        "retained": "renders/<sha256>.<ext>"}      # omitted if it could not be made

   Only the publish itself can fail a render. A failed retained copy or record
   write is logged and the render still succeeds. What the render drew
   (overlays, caption words, pre-roll) is kept beside it in
   ``.render_facts/<sha256>.json`` for a later review of those bytes.

   Everything a render adds here (hashing, the retained copy, the record,
   the facts) fits in one budget, ``review_timeout_s()``. Every step that
   grows with file size works in chunks and stops at its deadline: a hash
   that cannot finish means no retained copy and no record (the render
   itself still succeeds and prints its normal output). A render never
   reviews anything and never prints anything about it.

3. One bounded, silent review of exactly those bytes, when the agent runs
   ``tools/review_render.py`` (``review_bytes``). The job's intent and timing
   files are copied into the invocation's folder, then a child process runs
   the full review and the serious-only classifier inside the command's one
   hard deadline, reading only that copy, and writes a success envelope
   bound to this invocation. Only a success envelope can name problems; a
   crash, timeout, nonzero exit, refusal or any other outcome reads as
   nothing to fix. Each problem kind is told at most once per job.

``VIDEOCLAW_RENDER_REVIEW=off`` turns step 3 into "nothing to fix"; the
offline unit suite defaults it off (``tests/__init__.py``).
"""

from __future__ import annotations

import errno
import fcntl
from contextlib import contextmanager
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

RECORD_SCHEMA = "videoclaw.render-complete/v1"
RECORDS_DIR = "renders"
# What each published render drew, by the sha256 of its bytes (not a record:
# the app reads renders/*.json).
FACTS_DIR = ".render_facts"
FINAL_RENDER_NAME = "final.mp4"

REVIEWS_DIR = ".render_reviews"
INPUT_SCHEMA = "videoclaw.render-review-input/v1"
RESULT_SCHEMA = "videoclaw.render-review-result/v1"
# The job's fix cycle: which bytes were asked to be fixed, and what was said.
TOLD_NAME = ".render_findings.json"
TOLD_LOCK_NAME = ".render_findings.lock"
CYCLE_SCHEMA = "videoclaw.render-fix-cycle/v1"

REVIEW_ENV = "VIDEOCLAW_RENDER_REVIEW"
TIMEOUT_ENV = "VIDEOCLAW_RENDER_REVIEW_TIMEOUT_S"
# Set in the review child only: it marks the child's model request as the
# house-paid harness review and carries its deadlines.
CHILD_ENV = "VIDEOCLAW_RENDER_REVIEW_CHILD"
DEADLINE_ENV = "VIDEOCLAW_RENDER_REVIEW_DEADLINE"
# The render's pid, given at spawn: the child ends itself when its parent
# changes (the render died), without racing to read it after it starts.
PARENT_PID_ENV = "VIDEOCLAW_RENDER_REVIEW_PARENT_PID"
# The child's scratch folder (inside its invocation folder): temporary files
# are staged there, and the render removes it when the child ends or is stopped.
SCRATCH_ENV = "VIDEOCLAW_RENDER_REVIEW_SCRATCH"
MODEL_DEADLINE_ENV = "VIDEOCLAW_RENDER_REVIEW_MODEL_DEADLINE"

DEFAULT_TIMEOUT_S = 170.0
MIN_TIMEOUT_S = 30.0
MAX_TIMEOUT_S = 180.0
# The whole review, from spawning the child to printing, fits in the bound:
# the child must be done PARENT_MARGIN_S before it, stops waiting for the
# model CHILD_FINISH_MARGIN_S before its own deadline, and a kill waits at most
# KILL_GRACE_S.
PARENT_MARGIN_S = 2.0
CHILD_FINISH_MARGIN_S = 20.0
# Shares of the one budget for the retained copy and the intent copy; the
# review gets the rest and does not start with less than MIN_REVIEW_S left.
RETAIN_SHARE_S = 15.0
INTENT_SHARE_S = 20.0
MIN_REVIEW_S = 20.0
KILL_GRACE_S = 0.5
CLAIM_LOCK_WAIT_S = 1.0
# Persisting the fix cycle is best effort and happens after the answer is
# printed; it is waited for at most this long.
PERSIST_WAIT_S = 2.0
# Bookkeeping log lines are optional: each waits at most this long for the
# job lock (held by another operation on the same job), else it is dropped.
LOG_LOCK_WAIT_S = 0.2
MAX_NOTICE_ITEMS = 3
# Invocation folders kept per job. The review child removes older ones in the
# background while it runs (never the render process); one touched within the
# last MAX_TIMEOUT_S + 30 s may still be running and is kept.
KEEP_REVIEWS = 5
_OFF_VALUES = {"0", "off", "false", "no", "disabled", "disable"}

# The environment this process started with, before any tool module ran
# load_dotenv(). Credentials and gateway settings reach the review child only
# as they were at launch: a key that a .env file supplied later never does.
_LAUNCH_ENV = dict(os.environ)
_SECRET_NAME = re.compile(
    r"(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIALS?)$|GATEWAY|_URL$", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Durable files
# ---------------------------------------------------------------------------


def _fsync_dir(directory: Path) -> None:
    try:
        fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def atomic_write_text(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` with temp + fsync + replace + directory fsync.

    Readers see the old file or the new one, never a partial one, even if
    the writer is killed mid-write.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent,
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    ) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    _fsync_dir(path.parent)


def _atomic_json(path: Path, value: Any) -> None:
    """Write JSON to ``path`` atomically (``atomic_write_text``)."""
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")


def _log_quietly(job_dir: Path, tool: str, event: str, *, deadline: float,
                 **extra: Any) -> None:
    """Append an optional bookkeeping line to the job's run log, or skip it.

    Never blocks the render: nothing is logged once ``deadline`` (a
    ``time.monotonic()`` value, the end of the time budget) has passed, and
    the job lock is waited for at most ``LOG_LOCK_WAIT_S``; a busy lock or any
    error drops the line.
    """
    wait = min(LOG_LOCK_WAIT_S, deadline - time.monotonic())
    if wait <= 0:
        return
    try:
        from log import log_event

        log_event(job_dir, tool=f"{tool}.py", event=event, extra=extra, render_md=False,
                  lock_timeout=wait)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Publication and the render-complete record
# ---------------------------------------------------------------------------


def is_final_render(job_dir: Path, output: Path) -> bool:
    """The job's canonical ``final.mp4``."""
    try:
        return Path(output).resolve() == (Path(job_dir).resolve() / FINAL_RENDER_NAME)
    except OSError:
        return False


def is_recorded(job_dir: Path, sha256: object) -> bool:
    return (
        isinstance(sha256, str) and len(sha256) == 64
        and (Path(job_dir) / RECORDS_DIR / f"{sha256}.json").is_file()
    )


def made_from_final(job_dir: Path, source: object, source_sha256: object) -> bool:
    """Was a new video built on top of a finished deliverable of this job?"""
    if is_recorded(job_dir, source_sha256):
        return True
    if not isinstance(source, (str, Path)) or not str(source):
        return False
    return is_final_render(Path(job_dir), Path(source))


def staging_path(final: Path) -> Path:
    """A same-directory staging name for ``final`` that keeps its extension."""
    final = Path(final)
    return final.with_name(f".{final.stem}.{os.getpid()}.{time.time_ns()}.partial{final.suffix}")


def publish(staging: Path, final: Path) -> None:
    """Move fully finished bytes onto ``final`` in one atomic step.

    The staging file must be complete (every finishing pass applied). It is
    fsynced, renamed over ``final`` (same directory, so ``os.replace`` is
    atomic), and the directory entry is fsynced. A failure before this call
    leaves the previous final intact.
    """
    staging, final = Path(staging), Path(final)
    if not staging.is_file() or staging.stat().st_size <= 0:
        raise RuntimeError(f"nothing finished to publish at {staging}")
    with staging.open("rb") as handle:
        os.fsync(handle.fileno())
    os.replace(staging, final)
    _fsync_dir(final.parent)


def _job_relative(job_dir: Path, path: Path) -> str | None:
    try:
        return Path(path).resolve().relative_to(Path(job_dir).resolve()).as_posix()
    except (OSError, ValueError):
        return None


def _clone(source: Path, target: Path, timeout: float) -> bool:
    """Copy-on-write clone (independent inode, no extra space) where available."""
    if sys.platform == "darwin":
        command = ["cp", "-c", str(source), str(target)]
    elif sys.platform.startswith("linux"):
        command = ["cp", "--reflink=always", str(source), str(target)]
    else:
        return False
    try:
        result = subprocess.run(command, capture_output=True, timeout=max(0.05, timeout))
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and target.is_file()


def _hash_until(path: Path, deadline: float) -> str | None:
    """sha256 of ``path``, or ``None`` if it cannot finish by ``deadline``."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            if time.monotonic() > deadline:
                return None
            digest.update(block)
    return digest.hexdigest()


def _copy_until(source: Path, target: Path, deadline: float, *, sync: bool = True) -> str | None:
    """Copy ``source`` to ``target`` and return the copied bytes' sha256, or
    ``None`` if the copy cannot finish by ``deadline``."""
    digest = hashlib.sha256()
    with Path(source).open("rb") as reader, Path(target).open("wb") as writer:
        for block in iter(lambda: reader.read(1 << 20), b""):
            if time.monotonic() > deadline:
                return None
            digest.update(block)
            writer.write(block)
        writer.flush()
        if sync:
            os.fsync(writer.fileno())
    return digest.hexdigest()


def snapshot_intent(job_dir: Path, target: Path, deadline: float) -> bool:
    """Copy the job's intent and timing files into ``target``.

    Each file is copied in chunks against ``deadline``; ``False`` (and no
    review) if the copy cannot finish in time or fails.
    """
    from _serious_findings import INTENT_FILES

    job_dir, target = Path(job_dir), Path(target)
    try:
        for name in INTENT_FILES:
            if time.monotonic() > deadline:
                return False
            source = job_dir / name
            if not source.is_file() or source.is_symlink():
                continue
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            copied = (_copy_run_log_until(source, destination, deadline) if name == "run.log.jsonl"
                      else _copy_until(source, destination, deadline, sync=False))
            if copied is None:
                return False
    except OSError:
        return False
    return True


def _copy_run_log_until(source: Path, target: Path, deadline: float) -> bool | None:
    """Copy only the run-log events a review reads (``INTENT_LOG_TOOLS``)."""
    from _serious_findings import INTENT_LOG_MARKERS

    with Path(source).open("rb") as reader, Path(target).open("wb") as writer:
        for index, line in enumerate(reader):
            if index % 2000 == 0 and time.monotonic() > deadline:
                return None
            if any(marker in line for marker in INTENT_LOG_MARKERS):
                writer.write(line if line.endswith(b"\n") else line + b"\n")
    return True


def retain(job_dir: Path, source: Path, sha256: str, size: int,
           deadline: float | None = None) -> str | None:
    """Keep these bytes at ``renders/<sha256><ext>``; returns that job path.

    The retained file is its own inode (a copy-on-write clone, or a regular
    copy when cloning is not available), so neither a later render replacing
    the final path nor a tool rewriting it in place can change it. It appears
    only complete (temp + ``os.replace``) and only after its sha256 matches.
    An existing retained file with the same sha256 is kept. Anything that
    cannot finish by ``deadline`` is abandoned (``None``): retaining never
    holds up a finished render beyond its share of the budget.
    """
    deadline = time.monotonic() + 120 if deadline is None else deadline
    if time.monotonic() >= deadline:
        return None
    renders = Path(job_dir) / RECORDS_DIR
    renders.mkdir(parents=True, exist_ok=True)
    name = f"{sha256}{Path(source).suffix.lower() or '.mp4'}"
    target = renders / name
    relative = f"{RECORDS_DIR}/{name}"
    if (target.is_file() and not target.is_symlink() and target.stat().st_size == size
            and _hash_until(target, deadline) == sha256):
        return relative
    temporary = renders / f".{name}.{os.getpid()}.{time.time_ns()}.tmp"
    try:
        temporary.unlink(missing_ok=True)
        if _clone(source, temporary, deadline - time.monotonic()):
            copied = _hash_until(temporary, deadline)
        else:
            temporary.unlink(missing_ok=True)
            copied = _copy_until(source, temporary, deadline)
        if copied != sha256:
            return None
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    _fsync_dir(renders)
    return relative


def publish_deliverable(job_dir: Path, staging: Path, final: Path, *, tool: str,
                        facts: dict | None = None) -> dict:
    """Publish ``staging`` onto ``final``, retain it, and record it.

    Only the publish itself can raise. Hashing, the retained copy and the
    record share the one budget with the review (``review_timeout_s()``):
    the hash stops at the budget's end (then there is no retained copy, no
    record and no review), the retained copy gets a small share and is
    skipped if it cannot finish in it, and the record is written only while
    the budget lasts. Bookkeeping log lines are written only after the
    publish, only while the budget lasts, and never wait on a busy job lock.
    Returns ``{"record": <the record or None>, "facts": <what the render
    drew, bound to the published sha256>}``.
    """
    started = time.monotonic()
    budget = review_timeout_s()
    deadline = started + budget
    job_dir, staging, final = Path(job_dir), Path(staging), Path(final)
    tool = tool.removesuffix(".py")
    relative = _job_relative(job_dir, final)
    sha256 = size = retained = None
    notes: list[tuple[str, dict]] = []  # logged after publishing, budget permitting
    if relative is not None:
        try:
            size = staging.stat().st_size
            sha256 = _hash_until(staging, deadline)
        except OSError as exc:
            notes.append(("render_record_failed", {"error": str(exc)[:200]}))
            sha256 = None
    if sha256:
        try:
            now = time.monotonic()
            retained = retain(job_dir, staging, sha256, size,
                              deadline=min(deadline, now + min(RETAIN_SHARE_S, budget * 0.25)))
        except Exception as exc:
            notes.append(("render_retain_failed", {"error": str(exc)[:200]}))
        if retained is None:
            notes.append(("render_retain_skipped", {}))
    publish(staging, final)
    record = None
    # A hash that did not finish, or a budget spent before the record, leaves
    # no record, no review and no log line: nothing is added once it is gone.
    if sha256 and time.monotonic() < deadline:
        record = {
            "schema": RECORD_SCHEMA,
            "sha256": sha256,
            "path": relative,
            "bytes": size,
            "tool": tool,
            "completed_at": time.time(),
            **({"retained": retained} if retained else {}),
        }
        try:
            _atomic_json(job_dir / RECORDS_DIR / f"{sha256}.json", record)
            # When the draft became visible (time-to-visible-draft).
            notes.append(("deliverable_published", {
                "sha256": sha256, "bytes": size, "published_at": record["completed_at"],
                "publish_seconds": round(time.monotonic() - started, 3)}))
        except Exception as exc:
            record = None
            notes.append(("render_record_failed", {"error": str(exc)[:200]}))
    drawn = {**(facts or {}), "tool": tool, "output_sha256": sha256}
    if record is not None and time.monotonic() < deadline:
        try:
            _atomic_json(job_dir / FACTS_DIR / f"{sha256}.json", drawn)
        except Exception as exc:
            notes.append(("render_facts_failed", {"error": str(exc)[:200]}))
    for event, extra in notes:
        _log_quietly(job_dir, tool, event, deadline=deadline, path=relative, **extra)
    return {"record": record, "facts": drawn}


# ---------------------------------------------------------------------------
# The bounded review child
# ---------------------------------------------------------------------------


def review_enabled() -> bool:
    return os.environ.get(REVIEW_ENV, "on").strip().lower() not in _OFF_VALUES


def review_timeout_s() -> float:
    try:
        value = float(os.environ.get(TIMEOUT_ENV, DEFAULT_TIMEOUT_S))
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_S
    if value != value:  # NaN
        return DEFAULT_TIMEOUT_S
    return min(MAX_TIMEOUT_S, max(MIN_TIMEOUT_S, value))


def _kill_group(proc: subprocess.Popen) -> None:
    """Stop everything in the child's process group, then reap the child.

    Runs on every exit path: a child that exits normally can still leave
    descendants (an ffmpeg, an abandoned request) in its group.
    """
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass
    if proc.poll() is None:
        try:
            proc.wait(timeout=KILL_GRACE_S)
        except (subprocess.TimeoutExpired, OSError):
            pass


def _review_command(input_path: Path) -> list[str]:
    return [sys.executable, str(TOOLS_DIR / "_render_review_child.py"), str(input_path)]


def child_env(child_deadline: float, scratch: Path) -> dict[str, str]:
    """The review child's environment.

    Everything the render has, except that a credential or gateway setting
    reaches the child only unchanged since this process started: one that a
    ``.env`` file supplied afterwards (the render tools call ``load_dotenv()``
    at import), or that was changed or blanked in-process, is left out. The
    child itself never reads a ``.env`` file.
    """
    env = {name: value for name, value in os.environ.items()
           if not _SECRET_NAME.search(name) or _LAUNCH_ENV.get(name) == value}
    env.update({
        CHILD_ENV: "1",
        DEADLINE_ENV: f"{child_deadline:.3f}",
        MODEL_DEADLINE_ENV: f"{child_deadline - CHILD_FINISH_MARGIN_S:.3f}",
        PARENT_PID_ENV: str(os.getpid()),
        SCRATCH_ENV: str(scratch),
        "TMPDIR": str(scratch),
        "PYTHON_DOTENV_DISABLED": "1",
    })
    return env


def _run_review_child(job_dir: Path, input_path: Path, log_path: Path,
                      timeout_s: float) -> int | None:
    """Run the child under one deadline; ``None`` when it was stopped.

    Its scratch folder (next to ``log_path``) is removed on every exit path.
    """
    now = time.time()
    child_deadline = now + timeout_s - PARENT_MARGIN_S
    scratch = Path(log_path).parent / "tmp"
    scratch.mkdir(parents=True, exist_ok=True)
    env = child_env(child_deadline, scratch)
    with Path(log_path).open("wb") as log:
        proc = subprocess.Popen(
            _review_command(input_path), cwd=str(REPO_ROOT), env=env,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        previous: dict[int, Any] = {}

        def _stop(signum, frame):
            # The host is ending this command: take the review with it, then
            # let the signal do exactly what it would have done.
            _kill_group(proc)
            shutil.rmtree(scratch, ignore_errors=True)
            handler = previous.get(signum, signal.SIG_DFL)
            signal.signal(signum, handler)
            if callable(handler):
                handler(signum, frame)
            else:
                os.kill(os.getpid(), signum)

        for signum in (signal.SIGTERM, getattr(signal, "SIGHUP", None)):
            if signum is None:
                continue
            try:
                previous[signum] = signal.signal(signum, _stop)
            except (ValueError, OSError):  # not the main thread
                pass
        try:
            return proc.wait(timeout=max(0.1, timeout_s - PARENT_MARGIN_S + 0.5))
        except subprocess.TimeoutExpired:
            return None
        finally:
            _kill_group(proc)
            # Whatever a stopped child left half-written goes with its scratch.
            shutil.rmtree(scratch, ignore_errors=True)
            for signum, handler in previous.items():
                try:
                    signal.signal(signum, handler)
                except (ValueError, OSError):
                    pass


def _load_envelope(path: Path, invocation_id: str, sha256: str) -> list[dict] | None:
    """Findings from this invocation's success envelope, or ``None``."""
    try:
        envelope = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not (
        isinstance(envelope, dict)
        and envelope.get("schema") == RESULT_SCHEMA
        and envelope.get("invocation_id") == invocation_id
        and envelope.get("sha256") == sha256
        and envelope.get("status") == "success"
        and isinstance(envelope.get("findings"), list)
    ):
        return None
    findings = []
    for item in envelope["findings"]:
        if (isinstance(item, dict) and isinstance(item.get("kind"), str)
                and isinstance(item.get("problem"), str) and item["problem"].strip()):
            findings.append({"kind": item["kind"], "problem": item["problem"].strip()})
    return findings


# ---------------------------------------------------------------------------
# What the agent is told
# ---------------------------------------------------------------------------

NOTICE_LEAD = "Before presenting this video, fix:"
NOTICE_TAIL = "Then render again."
STILL_LEAD = "Still present after a fix:"
STILL_TAIL = "Tell the user about it briefly; don't try again."


def _problems(findings) -> list[str]:
    items = [" ".join(str(f["problem"]).split()).rstrip(".;") for f in findings or ()
             if isinstance(f, dict) and str(f.get("problem") or "").strip()]
    return items[:MAX_NOTICE_ITEMS]


def format_notice(findings: list[dict]) -> str | None:
    """The ask, one line of plain words, or ``None`` when there is nothing::

        Before presenting this video, fix: <problem 1>; <problem 2>; <problem 3>. Then render again.

    Always a single line, printed as the only (so the last) line of
    ``review_render``'s stdout. At most ``MAX_NOTICE_ITEMS`` problems.
    """
    items = _problems(findings)
    return f"{NOTICE_LEAD} {'; '.join(items)}. {NOTICE_TAIL}" if items else None


def format_still(findings: list[dict]) -> str | None:
    """After the one fix, what is still wrong, or ``None``::

        Still present after a fix: <problem 1>; <problem 2>. Tell the user about it briefly; don't try again.
    """
    items = _problems(findings)
    return f"{STILL_LEAD} {'; '.join(items)}. {STILL_TAIL}" if items else None


# ---------------------------------------------------------------------------
# The job's fix cycle
#
#   bytes B, no open ask, problems P   -> ask to fix P; the ask is open on B
#   bytes B, no open ask, no problems  -> nothing to fix
#   the same bytes B, ask open on B    -> the same ask again (no new look)
#   other bytes C, ask open on B       -> what is still wrong on C (any kind),
#     (the one fix happened)              or nothing to fix; the cycle closes
#   the same bytes C after it closed   -> the same answer again (no new look)
#   other bytes after it closed        -> a fresh cycle
#
# A whole look (target, cached answer, look, settlement) runs under one
# exclusive per-job lock (``job_look_lock``), so concurrent looks never look
# twice at the same bytes or reopen a closed cycle. Bookkeeping never hides a
# problem the look found: the answer is printed before the cycle is
# written (best effort, bounded); if it cannot be read, the problems are
# asked for as a first ask.
# ---------------------------------------------------------------------------


@contextmanager
def job_look_lock(job_dir: Path, until: float):
    """Hold the job's look lock, waiting for it until ``until`` (a
    ``time.monotonic()`` value); yields False (and holds nothing) if it
    could not be had in time."""
    try:
        fd = os.open(Path(job_dir) / TOLD_LOCK_NAME, os.O_CREAT | os.O_RDWR, 0o600)
    except OSError:
        yield False
        return
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if exc.errno not in (errno.EAGAIN, errno.EACCES) or time.monotonic() >= until:
                    yield False
                    return
                time.sleep(0.05)
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _read_cycle(job_dir: Path) -> dict | None:
    try:
        cycle = json.loads((Path(job_dir) / TOLD_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not (isinstance(cycle, dict) and cycle.get("schema") == CYCLE_SCHEMA
            and cycle.get("state") in ("open", "closed")
            and isinstance(cycle.get("bytes"), str)
            and (cycle.get("line") is None or isinstance(cycle.get("line"), str))):
        return None
    if cycle["state"] == "open" and not cycle.get("line"):
        return None
    return cycle


def answer_for(job_dir: Path, sha256: str) -> tuple[bool, str | None]:
    """``(True, line)`` when these exact bytes already have an answer in the
    job's fix cycle (an open ask on them, or the answer that closed it);
    ``(False, None)`` when a look is needed."""
    cycle = _read_cycle(job_dir)
    if cycle is not None and cycle["bytes"] == sha256:
        return True, cycle.get("line")
    return False, None


def decide(job_dir: Path, sha256: str,
           findings: list[dict] | None) -> tuple[str | None, dict | None]:
    """The answer after a look at these bytes, and the fix-cycle state to
    persist next (``None`` if nothing changes). ``findings`` is ``None`` when
    the look did not complete (then nothing is named, and an open ask on other
    bytes still closes). Reads the cycle only; an unreadable cycle reads as no
    open ask, so a found problem is always named (as a first ask).
    """
    ask = format_notice(findings or [])
    cycle = _read_cycle(Path(job_dir))
    now = time.time()
    if cycle is not None and cycle["state"] == "open" and cycle["bytes"] == sha256:
        return cycle["line"], None  # these bytes were already asked about
    if cycle is not None and cycle["state"] == "open":
        # Other bytes after an ask: the one fix happened.
        line = format_still(findings or [])
        return line, {"schema": CYCLE_SCHEMA, "state": "closed", "bytes": sha256,
                      "line": line, "asked_bytes": cycle["bytes"], "at": now}
    if ask:
        return ask, {"schema": CYCLE_SCHEMA, "state": "open", "bytes": sha256, "line": ask,
                     "kinds": [f["kind"] for f in findings or [] if isinstance(f, dict)
                               and isinstance(f.get("kind"), str)][:MAX_NOTICE_ITEMS],
                     "at": now}
    return None, None


def persist_cycle(job_dir: Path, record: dict | None, until: float) -> bool:
    """Write the fix-cycle state, best effort: waited for at most
    ``PERSIST_WAIT_S`` and never past ``until`` (a ``time.monotonic()``
    value). A write that fails or stalls is abandoned; the worst case is that
    the next look at the same bytes starts a fresh cycle (a repeated ask)."""
    if record is None:
        return True
    written = threading.Event()

    def write() -> None:
        try:
            _atomic_json(Path(job_dir) / TOLD_NAME, record)
        except Exception:
            return
        written.set()

    thread = threading.Thread(target=write, name="fix-cycle-persist", daemon=True)
    thread.start()
    thread.join(max(0.0, min(PERSIST_WAIT_S, until - time.monotonic())))
    return written.is_set()


def settle(job_dir: Path, sha256: str, findings: list[dict] | None) -> str | None:
    """``decide`` then ``persist_cycle``, for callers that print afterwards
    anyway. The worker prints the answer between the two."""
    line, record = decide(job_dir, sha256, findings)
    persist_cycle(job_dir, record, until=time.monotonic() + PERSIST_WAIT_S)
    return line


NOTHING_TO_FIX = "Nothing to fix before presenting."


def review_bytes(job_dir: Path, *, video: str, sha256: str, facts: dict,
                 deadline: float) -> tuple[str | None, dict | None]:
    """Review exactly these bytes once, inside ``deadline`` (a
    ``time.monotonic()`` value), within the job's fix cycle (see ``settle``).
    The caller holds the job's look lock. Returns ``(line, cycle state)``:
    the line to print (``None``: nothing to fix, or the review did not
    succeed) and the fix-cycle state the caller persists AFTER printing it
    (``persist_cycle``), so a stalled write can never hold the answer back.

    ``video`` is the job-relative file holding the bytes (the retained copy
    when there is one); ``facts`` is what the render drew, bound to
    ``sha256``.
    """
    started = time.monotonic()
    job_dir = Path(job_dir)
    known, line = answer_for(job_dir, sha256)
    if known:
        return line, None  # these exact bytes were already answered in this cycle
    left = deadline - started
    if left < MIN_REVIEW_S:
        return decide(job_dir, sha256, None)
    invocation_id = uuid.uuid4().hex
    folder = job_dir / REVIEWS_DIR / invocation_id
    # Intent and timing are fixed now, before the review starts; the child
    # reads only this copy, so edits made while it runs change nothing.
    share = min(INTENT_SHARE_S, left * 0.25, left - MIN_REVIEW_S)
    if not snapshot_intent(job_dir, folder / "intent", deadline=started + share):
        shutil.rmtree(folder, ignore_errors=True)
        return decide(job_dir, sha256, None)
    input_path = folder / "input.json"
    result_path = folder / "result.json"
    _atomic_json(input_path, {
        "schema": INPUT_SCHEMA,
        "invocation_id": invocation_id,
        "job": str(job_dir),
        "video": video,
        "sha256": sha256,
        "facts": facts,
        "intent": str(folder / "intent"),
        "report": str(folder / "report.json"),
        "result": str(result_path),
    })
    # Leave room to decide and print the answer before the deadline.
    remaining = deadline - time.monotonic() - CLAIM_LOCK_WAIT_S
    if remaining < MIN_REVIEW_S:
        return decide(job_dir, sha256, None)
    status = _run_review_child(job_dir, input_path, folder / "child.log", remaining)
    if status != 0:
        return decide(job_dir, sha256, None)
    # A completed look with nothing supported to tell writes no envelope.
    findings = _load_envelope(result_path, invocation_id, sha256)
    return decide(job_dir, sha256, findings or [])
