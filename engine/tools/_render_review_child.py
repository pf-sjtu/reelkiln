"""The review child of ``review_render``: one published deliverable, one deadline.

Started by ``review_render`` (via ``_render_completion.review_bytes``) in its own
process group with an input file
naming the job, the exact bytes (sha256 and a retained path), the facts the
render captured when it published them, and a snapshot of the job's intent
files taken when the command started. It:

1. watches its parent and its deadline before importing anything heavy, and
   kills its whole group if the command that started it dies or the deadline
   passes;
2. pins those facts and that snapshot, so a concurrent render or edit of the
   same job cannot change what is judged;
3. runs the full review on the exact bytes (the review refuses any other
   bytes), with everything it logs kept in its own invocation folder, never
   the job's run log or run.md;
4. keeps only the findings the review can stand behind: model-derived ones
   need a successful house-billed model answer, local ones need their own
   check to have explicitly succeeded; and
5. writes a success envelope bound to this invocation, only when there is
   something supported to tell.

Any failure exits without an envelope, and the command then reports nothing to
fix.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Light (standard library only): safe to import before supervision starts.
from _render_completion import (  # noqa: E402
    DEADLINE_ENV,
    INPUT_SCHEMA,
    KEEP_REVIEWS,
    MAX_TIMEOUT_S,
    PARENT_PID_ENV,
    RESULT_SCHEMA,
    _atomic_json,
)


def _supervise(deadline: float, parent: int) -> None:
    """End this process group when the command that started it (``parent``,
    named at spawn) dies or the deadline passes."""

    def watch() -> None:
        while True:
            if os.getppid() != parent or time.time() >= deadline:
                try:
                    os.killpg(os.getpgrp(), signal.SIGKILL)
                finally:
                    os._exit(3)
            time.sleep(0.2)

    threading.Thread(target=watch, name="render-review-supervisor", daemon=True).start()


def prune_reviews(reviews: Path, own: Path) -> None:
    """Remove this job's older invocation folders, keeping the newest
    ``KEEP_REVIEWS`` (this one included) and any touched recently enough to
    still be running. Best effort; never raises."""
    try:
        folders = sorted((entry for entry in reviews.iterdir()
                          if entry.is_dir() and not entry.is_symlink() and entry != own),
                         key=lambda entry: entry.stat().st_mtime, reverse=True)
    except OSError:
        return
    recent = time.time() - (MAX_TIMEOUT_S + 30.0)
    for folder in folders[KEEP_REVIEWS - 1:]:
        try:
            if folder.stat().st_mtime < recent:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            continue


def start_pruning(reviews: Path, own: Path) -> threading.Thread:
    """Prune in a daemon thread: it runs alongside the review and ends with
    this process (``os._exit``, or the command's kill at the bound), so a slow
    or huge folder never delays the review, and the command never waits on it."""
    thread = threading.Thread(target=prune_reviews, args=(reviews, own),
                              name="render-review-prune", daemon=True)
    thread.start()
    return thread


def _log_to(folder: Path, job: Path) -> None:
    """Send every run-log line this process writes for ``job`` (review
    events, model call records, its cost line) to ``folder`` instead: the
    job's run.log.jsonl and run.md, which agents read, never hear about it.

    Installed before the review modules are imported, so their
    ``from log import log_event`` binds to this.
    """
    import log

    folder.mkdir(parents=True, exist_ok=True)
    job_identity = os.stat(job)
    write_event, write_event_at = log.log_event, log.log_event_at

    def is_job(identity: os.stat_result) -> bool:
        return (identity.st_dev, identity.st_ino) == (job_identity.st_dev, job_identity.st_ino)

    def log_event(job_dir, *args, **kwargs):
        try:
            redirect = is_job(os.stat(job_dir))
        except OSError:
            redirect = False
        if redirect:
            job_dir, kwargs["render_md"] = folder, False
        return write_event(job_dir, *args, **kwargs)

    def log_event_at(job_fd, job_name, *args, **kwargs):
        if not is_job(os.fstat(job_fd)):
            return write_event_at(job_fd, job_name, *args, **kwargs)
        kwargs["render_md"] = False
        fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            return write_event_at(fd, folder.name, *args, **kwargs)
        finally:
            os.close(fd)

    log.log_event, log.log_event_at = log_event, log_event_at


def run(input_path: Path) -> int:
    data = json.loads(input_path.read_text(encoding="utf-8"))
    if data.get("schema") != INPUT_SCHEMA:
        return 2
    job = Path(data["job"])
    sha256 = data["sha256"]
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    report_path = Path(data["report"])
    result_path = Path(data["result"])
    _log_to(report_path.parent / "log", job)
    start_pruning(report_path.parent.parent, report_path.parent)

    import _serious_findings

    # Every reader of "the latest render" and of the job's intent files
    # (delivery safety, declared edits, the classifier, the review itself)
    # sees what was true when this deliverable was published.
    _serious_findings.pin_render_facts(job, facts)
    _serious_findings.pin_intent(job, Path(data["intent"]))

    import review_output
    from types import SimpleNamespace

    args = SimpleNamespace(
        video=data["video"], mode="full", role_log=None, skip_audio=False,
        brand_strings=None, skip_frame_verify=False, require_model_cache_receipt=None,
        expect_sha256=sha256, report_path=str(report_path),
    )
    if review_output.mode_full(args, job) != 0:
        return 4
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("final_sha256") != sha256 or report.get("harness") is not True:
        return 5
    findings = _serious_findings.supported(
        report, facts, _serious_findings.classify(report, job, facts=facts))
    if not findings:
        return 0  # nothing the review can stand behind: no envelope, nothing printed
    _atomic_json(result_path, {
        "schema": RESULT_SCHEMA,
        "invocation_id": data["invocation_id"],
        "sha256": sha256,
        "status": "success",
        "findings": [{"kind": f["kind"], "problem": f["problem"], "evidence": f["evidence"]}
                     for f in findings],
        "completed_at": time.time(),
    })
    return 0


def main(argv: list[str]) -> int:
    try:
        deadline = float(os.environ[DEADLINE_ENV])
        parent = int(os.environ[PARENT_PID_ENV])
    except (KeyError, ValueError):
        return 2
    _supervise(deadline, parent)
    if len(argv) != 2:
        return 2
    try:
        return run(Path(argv[1]))
    except BaseException:  # the command only reads the envelope
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    status = main(sys.argv)
    sys.stdout.flush()
    sys.stderr.flush()
    # A model request abandoned at the deadline may still hold a daemon
    # thread; leave without waiting on it.
    os._exit(status)
