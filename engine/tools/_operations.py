"""Durable request identity and destinations; recovery never submits a request."""
from __future__ import annotations

import hashlib
import json
import math
import os
import _compat_dirfd as _dfd  # port: dir_fd/O_DIRECTORY emulation on Windows (POSIX: same os functions)
import re
import shutil
import stat
import time
import unicodedata
import uuid
from contextlib import contextmanager, nullcontext
from pathlib import Path
from urllib.parse import urlsplit

from log import _read_events_at, _replace_at, _same_named_object, job_lock_at, log_event_at

SCHEMA = "videoclaw.local-operation/v1"
CONTEXT_SCHEMA = "videoclaw.operation-recovery/v1"
OWNER_FIELDS = ("account_id", "gateway_url", "environment", "project_id", "client_job")
_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z")
_TERMINAL = {"succeeded", "failed", "canceled", "cancelled", "timeout"}
# The engine opts in to these with X-VideoClaw-Pending-Settlement: v1
# (videoclaw-backend#311): the outcome is final, its bill has not settled.
_SETTLING = {"pending", "support_needed"}
_MODEL_EXTENSIONS = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
    "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/flac": ".flac",
}


def _model_outputs(result: dict | None) -> list[str]:
    """The native model call declares this confined output policy before POST."""
    if not result or result.get("status") != "succeeded":
        return []
    assets = result.get("assets", [])
    if len(assets) > 16:
        raise ValueError("the model did not return a supported set of media files")
    outputs = []
    for asset in assets:
        asset_id = asset.get("asset_id")
        mime = asset.get("content_type")
        extension = _MODEL_EXTENSIONS.get(mime) if isinstance(mime, str) else None
        if not isinstance(asset_id, str) or not re.fullmatch(r"[a-f0-9]{32}", asset_id) or not extension:
            raise ValueError("the model returned an unsupported media file")
        if not isinstance(asset.get("url"), str) or urlsplit(asset["url"]).path != f"/v1/assets/{asset_id}":
            raise ValueError("the model media URL belongs to a different asset")
        outputs.append(f"incoming/model-{asset_id}{extension}")
    if len(set(outputs)) != len(outputs):
        raise ValueError("the model returned duplicate media identities")
    return outputs


def owner(context: dict) -> dict:
    if (not isinstance(context, dict) or context.get("schema") != CONTEXT_SCHEMA
            or any(not isinstance(context.get(k), str) or not context[k] for k in OWNER_FIELDS)):
        raise ValueError("operation recovery has no verified account/project identity")
    return {k: context[k] for k in OWNER_FIELDS}


@contextmanager
def _journal(job: Path, *, lock: bool = True):
    """Share the existing job lock with foreground asset publication."""
    job = Path(os.path.abspath(job))
    flags = os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
    parent_fd = _dfd.open(job.parent, flags)
    job_fd = journal_fd = -1
    try:
        job_fd = _dfd.open(job.name, flags, dir_fd=parent_fd)
        with job_lock_at(job_fd) if lock else nullcontext():
            try:
                _dfd.mkdir("operations", mode=0o700, dir_fd=job_fd)
                _dfd.fsync(job_fd)
            except FileExistsError:
                pass
            journal_fd = _dfd.open("operations", flags, dir_fd=job_fd)

            def attached():
                for parent, name, descriptor in [(None, job.parent, parent_fd),
                        (parent_fd, job.name, job_fd), (job_fd, "operations", journal_fd)]:
                    if not _same_named_object(parent, name, _dfd.fstat(descriptor)):
                        raise OSError("operation journal directory changed")
            attached()
            yield job_fd, journal_fd, attached
            _dfd.fsync(journal_fd)
            attached()
    finally:
        for fd in (journal_fd, job_fd, parent_fd):
            if fd >= 0:
                _dfd.close(fd)


def _filename(operation_id: str) -> str:
    if not isinstance(operation_id, str) or not _ID.fullmatch(operation_id):
        raise ValueError("invalid local operation ID")
    return f"{operation_id}.json"


def _read_at(fd: int, operation_id: str) -> dict:
    source = _dfd.open(_filename(operation_id), os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC | _dfd.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(source, "rb") as stream:
        if not stat.S_ISREG(_dfd.fstat(stream.fileno()).st_mode):
            raise OSError("operation record must be a regular file")
        record = json.load(stream)
    if not isinstance(record, dict) or record.get("schema") != SCHEMA or record.get("id") != operation_id:
        raise ValueError("operation record identity changed")
    if (not isinstance(record.get("path"), str) or not isinstance(record.get("body"), str)
            or not isinstance(record.get("outputs"), list) or not all(isinstance(p, str) for p in record["outputs"])
            or not isinstance(record.get("delivered"), dict) or not isinstance(record.get("owner"), dict)
            or record.get("result") is not None and not isinstance(record["result"], dict)):
        raise ValueError("operation record is malformed")
    owner({"schema": CONTEXT_SCHEMA, **record["owner"]})
    if record.get("result") is not None:
        _check_result(record["result"])
    if any(not isinstance(receipt, dict) or receipt.get("state") not in {"publishing", "delivered"}
           or not isinstance(receipt.get("sha256"), str) or type(receipt.get("bytes")) is not int
           for receipt in record["delivered"].values()):
        raise ValueError("operation delivery receipt is malformed")
    if record.get("sha256") != request_digest(record["path"], record["body"].encode("utf8")):
        raise ValueError("saved operation request changed")
    return record


def settling(result: dict) -> bool:
    """A terminal outcome whose charge is still held at the reserved amount."""
    return result.get("status") in _TERMINAL and result.get("settlement_state") in _SETTLING


def final_view(result: dict) -> dict:
    """What tools report: a settling outcome is final, so the gateway's
    ``reconciliation_required`` ("still on its way") is dropped. Its
    ``settlement_state`` stays, and the journal keeps the open charge."""
    return {k: v for k, v in result.items() if k != "reconciliation_required"} if settling(result) else result


def _check_result(result: dict) -> None:
    if (not isinstance(result, dict) or not isinstance(result.get("job_id"), str)
            or not isinstance(result.get("assets", []), list)
            or any(not isinstance(a, dict) or not isinstance(a.get("asset_id"), str)
                   for a in result.get("assets", []))):
        raise ValueError("operation result is malformed")
    if result.get("status") not in _TERMINAL | {"queued", "running", "reconciling", "submission_unknown", "accepted_unknown"}:
        raise ValueError("operation returned an unsupported lifecycle status")
    if result["status"] in _TERMINAL and not settling(result) and (
            type(result.get("cost_usd")) not in {int, float}
            or not math.isfinite(result["cost_usd"]) or result["cost_usd"] < 0):
        raise ValueError("terminal operation has no authoritative cost")


def request_digest(path: str, body: bytes) -> str:
    return hashlib.sha256(b"videoclaw-spend-operation/v1\0POST\0" + path.encode("utf8") + b"\0" + body).hexdigest()


class DestinationOccupied(ValueError):
    """Paid work would land on a name that cannot receive it; nothing was sent."""


def _same_name(relative: str) -> str:
    """Destination identity as a case/normalization-insensitive filesystem sees it.

    macOS volumes treat `Hero.mp4` and `hero.mp4` as one file; comparing the
    folded form refuses both aliases, and on a case-sensitive volume the cost
    is only asking for a more distinct name.
    """
    return unicodedata.normalize("NFC", relative).casefold()


# videoclaw-app#1064: a record may also name the video's own copy of a source
# file that recovery needs (genjutsu re-lays the source clip's audio), so the
# collector never has to read the upload back. The app recomputes ``sha256``
# from the POST body it forwarded and compares it with ``--request-sha256``,
# so that digest stays exactly request_digest(path, body). The entry carries
# its own digest, chained to it. A record without the entry is unchanged, and
# one whose entry is malformed, changed or no longer matches the file is
# collected exactly as a record without it.
LOCAL_SOURCE_FIELDS = frozenset({"path", "sha256", "bytes", "digest"})


def local_source_path_ok(path: object) -> bool:
    """A plain relative path inside the video, outside the operation journal."""
    if not isinstance(path, str) or not 0 < len(path) <= 1024 or "\0" in path or path.startswith("/"):
        return False
    try:
        path.encode("utf8")
    except UnicodeEncodeError:
        return False
    parts = path.split("/")
    return parts[0] != "operations" and all(p not in {"", ".", ".."} for p in parts)


def local_source_digest(request_sha256: str, path: str, sha256: str, size: int) -> str:
    return hashlib.sha256(b"videoclaw-operation-local-source/v1\0" + request_sha256.encode("ascii") + b"\0"
                          + path.encode("utf8") + b"\0" + sha256.encode("ascii") + b"\0"
                          + str(size).encode("ascii")).hexdigest()


def _local_source_entry(request_sha256: str, source: dict) -> dict:
    if (not isinstance(source, dict) or set(source) != LOCAL_SOURCE_FIELDS - {"digest"}
            or not local_source_path_ok(source["path"])
            or not isinstance(source["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
            or type(source["bytes"]) is not int or source["bytes"] <= 0):
        raise ValueError("operation local source must be a nonempty file inside this video")
    return {**source, "digest": local_source_digest(request_sha256, source["path"], source["sha256"],
                                                    source["bytes"])}


def verified_local_source(record: dict) -> dict | None:
    """The record's own local source entry when it is intact, else None."""
    entry = record.get("local_source")
    if (not isinstance(entry, dict) or set(entry) != LOCAL_SOURCE_FIELDS
            or not isinstance(record.get("sha256"), str)):
        return None
    try:
        expected = _local_source_entry(record["sha256"], {k: entry[k] for k in ("path", "sha256", "bytes")})
    except ValueError:
        return None
    return expected if entry["digest"] == expected["digest"] else None


def copy_local_source(job: Path, record: dict, destination: Path, *, max_bytes: int) -> bool:
    """Copy the record's local source to the new file ``destination`` when it
    is still the exact file named at submit; otherwise False, with nothing left
    at ``destination``.

    Each path component is opened relative to the video directory without
    following symlinks, so a changed or tampered record can never read a file
    outside this video. The bytes are hashed as they are copied, so the copy is
    exactly the file that was recorded.
    """
    entry = verified_local_source(record)
    if entry is None or entry["bytes"] > max_bytes:
        return False
    directory_flags = os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
    opened: list[int] = []
    created = False
    try:
        opened.append(_dfd.open(os.path.abspath(job), directory_flags))
        parts = entry["path"].split("/")
        for part in parts[:-1]:
            opened.append(_dfd.open(part, directory_flags, dir_fd=opened[-1]))
        source_fd = _dfd.open(parts[-1], os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_NONBLOCK | _dfd.O_CLOEXEC,
                            dir_fd=opened[-1])
        with os.fdopen(source_fd, "rb") as source:
            info = _dfd.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != entry["bytes"]:
                return False
            with open(destination, "xb") as out:
                created = True
                digest = hashlib.sha256()
                copied = 0
                for chunk in iter(lambda: source.read(1 << 20), b""):
                    copied += len(chunk)
                    if copied > entry["bytes"]:
                        break
                    digest.update(chunk)
                    out.write(chunk)
        if copied == entry["bytes"] and digest.hexdigest() == entry["sha256"]:
            created = False  # Keep it: this is the recorded file.
            return True
        return False
    except OSError:
        return False
    finally:
        for fd in reversed(opened):
            _dfd.close(fd)
        if created:
            try:
                _dfd.unlink(destination)
            except FileNotFoundError:
                pass


class DestinationClaimed(ValueError):
    """An earlier accepted operation will still publish this destination (videoclaw#294)."""

    def __init__(self, destination: str, operation_id: str, status: str, *, blocked: bool = False):
        self.destination, self.operation_id, self.status = destination, operation_id, status
        self.blocked = blocked
        if blocked:
            # The earlier result will never arrive: a different file is in the
            # way and delivery never replaces it (overwrite is videoclaw#304).
            super().__init__(
                f"{destination} can't be delivered: an earlier paid result (operation {operation_id}) "
                "finished, but a different file already sits at that path, so it will never arrive "
                "there. Nothing was submitted or charged for this request. Regenerate it under a new "
                "name.")
            return
        super().__init__(
            f"{destination} is already on its way from an earlier paid request (operation {operation_id}, "
            f"{status}). The app will save it into this video; nothing was submitted or charged for this "
            "request. Do not re-run it; wait for the file. Only if the user wants an extra, different take, "
            "use a new name.")


def _claimed_destinations(record: dict) -> list[tuple[str, bool]]:
    """(destination, blocked) for each file an accepted operation has not delivered.

    ``blocked`` means delivery found a different file in the way: that result
    will never arrive, so the name is not "on its way" (videoclaw#304).
    """
    result = record.get("result") or {}
    status = result.get("status")
    if record.get("not_submitted") is True or status in _TERMINAL - {"succeeded"}:
        return []
    outputs = record["outputs"]
    if status == "succeeded":
        outputs = outputs[:len(result.get("assets") or [])]  # deliver() publishes only these
    receipts = record["delivered"]
    return [(p, bool((receipts.get(p) or {}).get("blocked"))) for p in outputs
            if (receipts.get(p) or {}).get("state") != "delivered"]


def _refuse_claimed(fd: int, ownership: dict, destinations: list[str], *, exclude: str | None = None) -> None:
    """Refuse before payment when an accepted operation of this video already owns a destination.

    Runs under the job lock, so a concurrent request sees the other's saved record.
    """
    wanted = {_same_name(destination) for destination in destinations}
    if not wanted:
        return
    for name in sorted(_dfd.listdir(fd)):
        operation_id = name.removesuffix(".json")
        if not name.endswith(".json") or operation_id == exclude or not _ID.fullmatch(operation_id):
            continue
        try:
            record = _read_at(fd, operation_id)
        except (OSError, ValueError):
            continue  # Unreadable records cannot be collected either.
        if record["owner"] != ownership:
            continue
        for destination, blocked in _claimed_destinations(record):
            if _same_name(destination) in wanted:  # videoclaw#273: case/Unicode aliases are one file
                raise DestinationClaimed(destination, operation_id,
                                         (record.get("result") or {}).get("status") or "submitted",
                                         blocked=blocked)


def _leaf_exists(job_fd: int, relative: str) -> bool:
    """Whether anything already sits at ``relative``, creating nothing.

    Walks parent folders without following symlinks, as delivery will. A
    missing folder means the name is free; a folder that is not a plain
    directory could never receive the delivery either.
    """
    parts = relative.split("/")
    current, opened = job_fd, []
    try:
        for part in parts[:-1]:
            try:
                child = _dfd.open(part, os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                                dir_fd=current)
            except FileNotFoundError:
                return False
            except OSError as exc:
                raise DestinationOccupied(
                    f"{relative} cannot be delivered: one of its folders is not a plain "
                    "directory. Nothing was submitted or charged.") from exc
            opened.append(child)
            current = child
        try:
            _dfd.stat(parts[-1], dir_fd=current, follow_symlinks=False)
        except FileNotFoundError:
            return False
        return True
    finally:
        for fd in opened:
            _dfd.close(fd)


def _refuse_occupied(job_fd: int, journal_fd: int, ownership: dict, destinations: list[str], *,
                     replaces_existing: bool, exclude: str | None = None) -> None:
    """Refuse, before any paid POST, a destination delivery could not fill.

    First the claim rule (videoclaw#294): a destination an accepted, undelivered
    operation of this video still owns is refused as ``DestinationClaimed``.
    Then the file rule (videoclaw#273/#304): delivery never overwrites (a later
    user edit belongs to the user), so an existing file would turn a paid
    result into a FileExistsError after the charge. Runs under the journal
    lock, so two racing submissions cannot both claim one name. Native
    publishers (``replaces_existing``) may replace a finished file, never an
    unfinished sibling's.
    """
    _refuse_claimed(journal_fd, ownership, destinations, exclude=exclude)
    if replaces_existing:
        return
    for relative in destinations:
        if _leaf_exists(job_fd, relative):
            raise DestinationOccupied(
                f"{relative} already exists in this video. Nothing was submitted or charged. "
                "Choose a new output name for a new take, or move the existing file first.")


def audio_output_probe(payload: dict, outputs: list[str]) -> dict:
    """Keep source fidelity reproducible after the original cleaner exits."""
    probe = payload.get("_audio_output")
    if (len(outputs) != 1 or Path(outputs[0]).suffix.lower() not in {".wav", ".mp3", ".m4a", ".aac"}
            or not isinstance(probe, dict)
            or type(probe.get("sample_rate")) is not int or not 8000 <= probe["sample_rate"] <= 384000
            or type(probe.get("bits_per_sample")) is not int or not 0 <= probe["bits_per_sample"] <= 64
            or not isinstance(probe.get("codec_name"), str)
            or not re.fullmatch(r"[a-z0-9_]{1,64}", probe["codec_name"])):
        raise ValueError("audio recovery requires one supported output and its source format")
    return probe


def prepare(job: Path, context: dict, path: str, body: bytes, outputs: list[Path | str], *,
            awaiting_approval: bool = False, replaces_existing: bool = False,
            local_source: dict | None = None) -> dict:
    """Save one paid request's identity and destinations before its POST.

    ``replaces_existing`` is for producers that publish natively through
    ``record_delivery`` (images, character sheets, music beds): they replace
    their own named output transactionally, so an existing file is a retake,
    not a conflict. Everything delivered by ``deliver`` refuses occupied names,
    and nobody may claim a name another unfinished operation still owns.
    """
    ownership = owner(context)
    job = Path(os.path.abspath(job))
    if ownership["client_job"] != job.name:
        raise ValueError("operation belongs to another video")
    if path not in {"/v1/audio/enhance", "/v1/media/pull"} and not re.fullmatch(r"/v1/[a-z][a-z0-9_.-]{0,63}", path):
        raise ValueError("unsupported operation route")
    payload = json.loads(body)
    if payload.get("client_job") != job.name:
        raise ValueError("operation request belongs to another video")
    destinations = []
    if path == "/v1/model_call" and outputs:
        raise ValueError("native model outputs use the app's incoming-media policy")
    for output in outputs:
        candidate = Path(output)
        relative = candidate.relative_to(job) if candidate.is_absolute() else candidate
        if not relative.parts or any(p in {"", ".", ".."} for p in relative.parts) or relative.parts[0] == "operations":
            raise ValueError("operation output must be a file inside this video")
        if relative.as_posix() in destinations:
            raise ValueError("operation output destinations must be distinct")
        destinations.append(relative.as_posix())
    if path == "/v1/audio/enhance":
        audio_output_probe(payload, destinations)
    if path == "/v1/media/pull":
        suffix = ".json" if payload.get("mode") in {"search", "enumerate"} else ".mp3" if payload.get("audio_only") else ".mp4"
        if len(destinations) != 1 or Path(destinations[0]).suffix != suffix:
            raise ValueError("media recovery requires one output matching its acquisition mode")
    record = {"schema": SCHEMA, "id": str(uuid.uuid4()), "owner": ownership,
              "method": "POST", "path": path, "body": body.decode("utf8"),
              "sha256": request_digest(path, body), "outputs": destinations,
              "created_at": time.time(), "result": None, "delivered": {}}
    if local_source is not None:
        record["local_source"] = _local_source_entry(record["sha256"], local_source)
    if awaiting_approval:
        record.update(awaiting_approval=True, not_submitted=True,
                      submission_error="Spending approval is pending; nothing was submitted.")
    if replaces_existing:
        # Kept so the check repeated when approval ends applies the same policy.
        record["replaces_existing"] = True
    with _journal(job) as (job_fd, fd, _):
        _refuse_occupied(job_fd, fd, ownership, destinations, replaces_existing=replaces_existing)
        _replace_at(fd, _filename(record["id"]), json.dumps(record, allow_nan=False).encode("utf8"))
    return record


def mark_submitting(job: Path, operation_id: str, context: dict) -> None:
    """Durably leave local approval before the single paid POST can start.

    Two requests for one name can both wait for approval; the first to leave
    approval claims it and the later one is refused here, before its POST.
    """
    with _journal(job) as (job_fd, fd, _):
        record = _read_at(fd, operation_id)
        if (record['owner'] != owner(context) or record.get('awaiting_approval') is not True
                or record['result'] is not None):
            raise ValueError('operation is not awaiting local approval')
        # Another request for the same file may have been approved first, or a
        # rival delivered to this name while this request waited for approval.
        _refuse_occupied(job_fd, fd, record['owner'], record['outputs'],
                         replaces_existing=record.get('replaces_existing') is True,
                         exclude=operation_id)
        for key in ('awaiting_approval', 'not_submitted', 'submission_error'):
            record.pop(key, None)
        _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode('utf8'))


def read(job: Path, operation_id: str, context: dict) -> dict:
    with _journal(job) as (_, fd, _):
        record = _read_at(fd, operation_id)
    if record["owner"] != owner(context) or record["owner"]["client_job"] != Path(job).name:
        raise ValueError("saved operation belongs to another account, gateway, project or video")
    return record


def record_refusal(job: Path, operation_id: str, context: dict, reason: str) -> None:
    """A received pre-forward/financial refusal closes this fresh local intent."""
    with _journal(job) as (_, fd, _):
        record = _read_at(fd, operation_id)
        if record["owner"] != owner(context) or record["result"] is not None:
            raise ValueError("refusal cannot replace an accepted operation")
        record.update(not_submitted=True, submission_error=reason[:1200])
        record.pop('awaiting_approval', None)
        _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))


def record_result(job: Path, operation_id: str, context: dict, result: dict) -> dict:
    _check_result(result)
    ownership = owner(context)
    if (result.get("operation_id") != operation_id or result.get("project_id") != ownership["project_id"]
            or result.get("client_job") != ownership["client_job"] or not isinstance(result.get("job_id"), str)):
        raise ValueError("recovered result belongs to another operation")
    with _journal(job) as (_, fd, _):
        record = _read_at(fd, operation_id)
        if record["owner"] != ownership or ownership["client_job"] != Path(job).name:
            raise ValueError("saved operation belongs to another account, gateway, project or video")
        previous = record["result"]
        if previous == result:
            return record
        if previous and (previous["job_id"] != result["job_id"] or
                         previous.get("status") in _TERMINAL and previous.get("status") != result.get("status")
                         or previous.get("status") in _TERMINAL and not settling(previous) and settling(result)):
            # A stale worker cannot downgrade a completed operation or replace
            # it with another purchase. Fresh URLs for the same result are OK.
            return record
        if previous and previous.get("status") == "succeeded" and (
                [a.get("asset_id") for a in previous.get("assets", [])] !=
                [a.get("asset_id") for a in result.get("assets", [])]):
            raise ValueError("the recovered operation changed its original assets")
        if previous and previous.get("status") == "succeeded" and record["path"] == "/v1/model_call" and (
                [a.get("content_type") for a in previous.get("assets", [])] !=
                [a.get("content_type") for a in result.get("assets", [])]):
            if (record["outputs"] or record["delivered"]
                    or any(previous.get(k) != result.get(k) for k in ("cost_usd", "cost_source"))
                    or any(old.get("content_type") not in (None, "")
                           and old.get("content_type") != new.get("content_type")
                           for old, new in zip(previous["assets"], result["assets"]))):
                raise ValueError("the recovered operation changed its original media types")
            # Older paid results can lack MIME metadata and fail before import.
            # Accept only a supported correction for the same undelivered assets.
            _model_outputs(result)
        if result.get("tool") is not None and result["tool"] != record["path"].removeprefix("/v1/").replace("/", "."):
            raise ValueError("recovered result belongs to another tool")
        record["result"] = result
        if record["path"] == "/v1/model_call":
            try:
                record["outputs"] = _model_outputs(result)
            except ValueError:
                # Preserve the paid result/cost even when its media format
                # cannot be imported. Delivery will report the exact problem.
                record["outputs"] = []
        _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
    return record


def log_cost_once(job: Path, operation_id: str, extra: dict, duration: float) -> None:
    with _journal(job) as (job_fd, fd, attached):
        record = _read_at(fd, operation_id)
        result = record.get("result") or {}
        if result.get("status") not in _TERMINAL or settling(result):
            return  # Unresolved work is in the journal, never a guessed bill.
        # ponytail: scan the existing per-video log; add an index only if very
        # large operation histories make this measured path slow.
        if any(row.get("event") == "gateway_call" and row.get("operation_id") == operation_id
               for row in _read_events_at(job_fd)):
            return
        attached()
        log_event_at(job_fd, Path(job).name, record["path"].removeprefix("/v1/").replace("/", "."),
                     "gateway_call", duration_seconds=duration,
                     extra={**extra, "estimate_usd": record["result"]["cost_usd"],
                            "operation_id": operation_id}, render_md=False)


def record_delivery(job: Path, operation_id: str, context: dict, index: int, destination: Path,
                    *, pending_bytes: bytes | None = None) -> None:
    """Stage native bytes before publication, or acknowledge the finished file."""
    with _journal(job) as (job_fd, fd, journal_attached):
        record = _read_at(fd, operation_id)
        if record["owner"] != owner(context) or record["owner"]["client_job"] != Path(job).name:
            raise ValueError("saved operation belongs to another account, gateway, project or video")
        if (isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(record["outputs"])
                or (record.get("result") or {}).get("status") != "succeeded"):
            raise ValueError("operation output is not available")
        relative = record["outputs"][index]
        assets = record["result"].get("assets") or []
        if index >= len(assets) or not isinstance(assets[index].get("asset_id"), str):
            raise ValueError("recovered asset count or identity does not match the saved outputs")
        if Path(os.path.abspath(destination)) != Path(os.path.abspath(job)) / relative:
            raise ValueError("published output differs from the saved destination")
        staged = f"{operation_id}-{index}.asset"
        if pending_bytes is not None:
            if not isinstance(pending_bytes, bytes) or not pending_bytes:
                raise ValueError("native operation output must be nonempty bytes")
            digest = {"sha256": hashlib.sha256(pending_bytes).hexdigest(), "bytes": len(pending_bytes)}
            previous = record["delivered"].get(relative)
            if previous and {k: previous[k] for k in ("sha256", "bytes")} != digest:
                raise ValueError("native operation output changed after publication began")
            if previous and previous["state"] == "delivered":
                return
            # A process may die before its own rename. Keep these transformed
            # bytes so collection never substitutes the raw provider image.
            _replace_at(fd, staged, pending_bytes)
            _dfd.fsync(fd)
            record["delivered"][relative] = {**digest, "asset_id": assets[index]["asset_id"],
                "state": "publishing", "local_output": True}
            _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
            return
        with _output_parent(job_fd, relative) as (out_fd, leaf, output_attached):
            digest = _file_digest_at(out_fd, leaf)
            previous = record["delivered"].get(relative)
            if previous and previous.get("local_output") and {k: previous[k] for k in ("sha256", "bytes")} != digest:
                raise ValueError("published native output differs from its staged bytes")
            _dfd.fsync(out_fd)
            journal_attached()
            output_attached()
            record["delivered"][relative] = {**digest,
                "asset_id": assets[index]["asset_id"], "state": "delivered"}
            _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
            _dfd.fsync(fd)
            try:
                _dfd.unlink(staged, dir_fd=fd)
            except FileNotFoundError:
                pass


@contextmanager
def _output_parent(job_fd: int, relative: str):
    parts = relative.split("/")
    if not parts or any(p in {"", ".", ".."} or "\0" in p for p in parts) or parts[0] == "operations":
        raise ValueError("invalid saved output destination")
    opened = []
    current = job_fd
    try:
        for part in parts[:-1]:
            try:
                _dfd.mkdir(part, mode=0o700, dir_fd=current)
                _dfd.fsync(current)
            except FileExistsError:
                pass
            child = _dfd.open(part, os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC, dir_fd=current)
            opened.append((current, part, child))
            current = child

        def attached():
            for parent, name, fd in opened:
                if not _same_named_object(parent, name, _dfd.fstat(fd)):
                    raise OSError("operation output directory changed")
        attached()
        yield current, parts[-1], attached
    finally:
        for _, _, fd in reversed(opened):
            _dfd.close(fd)


def _file_digest_at(fd: int, name: str) -> dict:
    source = _dfd.open(name, os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC | _dfd.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(source, "rb") as stream:
        before = _dfd.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise OSError("operation output must be a regular file")
        _dfd.fsync(stream.fileno())
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = _dfd.fstat(stream.fileno())
        named = _dfd.stat(name, dir_fd=fd, follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or (
                named.st_dev, named.st_ino) != (before.st_dev, before.st_ino):
            raise OSError("operation output changed during collection")
        return {"sha256": digest, "bytes": before.st_size}


def deliver(job: Path, operation_id: str, context: dict, download) -> dict:
    """Publish original assets once, without holding the video lock during HTTP.

    Each worker stages independently, then rechecks the receipt under the same
    lock as native publication. The publishing fingerprint bridges process loss
    after linking a complete file but before the final receipt.
    """
    record = read(job, operation_id, context)
    result = record["result"] or {}
    if result.get("status") != "succeeded":
        return record

    if record["path"] == "/v1/model_call" and record["outputs"] != _model_outputs(result):
        raise ValueError("saved model media destinations changed")
    assets = result.get("assets") or []
    with _journal(job, lock=False) as (job_fd, fd, journal_attached):
        for index, relative in enumerate(record["outputs"][:len(assets)]):
            asset = assets[index]
            if not isinstance(asset.get("asset_id"), str) or not asset["asset_id"]:
                raise ValueError("recovered asset has no durable identity")
            with _output_parent(job_fd, relative) as (out_fd, leaf, output_attached):
                prefix = f".videoclaw-operation-{operation_id}-{index}-"
                temporary = prefix + uuid.uuid4().hex + ".part"

                def current():
                    latest = _read_at(fd, operation_id)
                    if (latest["owner"] != record["owner"] or latest["outputs"] != record["outputs"]
                            or latest["result"]["job_id"] != result["job_id"]
                            or latest["result"].get("status") != "succeeded"
                            or [a.get("asset_id") for a in latest["result"].get("assets", [])] !=
                               [a.get("asset_id") for a in assets]):
                        raise ValueError("operation changed while downloading its result")
                    journal_attached()
                    output_attached()
                    return latest

                def clean_parts():
                    # Terminal receipt: incomplete files left by killed workers
                    # can be removed. An active worker rechecks this receipt.
                    for name in _dfd.listdir(out_fd):
                        if name.startswith(prefix) and name.endswith(".part"):
                            try:
                                _dfd.unlink(name, dir_fd=out_fd)
                            except FileNotFoundError:
                                pass
                    try:
                        _dfd.unlink(f"{operation_id}-{index}.asset", dir_fd=fd)
                    except FileNotFoundError:
                        pass

                with job_lock_at(job_fd):
                    record = current()
                    asset = record["result"]["assets"][index]
                    previous = record["delivered"].get(relative)
                    if previous and previous.get("state") == "delivered":
                        clean_parts()
                        continue  # Later user edits/deletions belong to the user.
                    if previous and previous.get("asset_id") != asset["asset_id"]:
                        raise ValueError("the recovered operation changed its original asset")
                    if previous and previous.get("state") == "publishing":
                        try:
                            existing = _file_digest_at(out_fd, leaf)
                        except FileNotFoundError:
                            existing = None
                        if existing == {k: previous[k] for k in ("sha256", "bytes")}:
                            record["delivered"][relative] = {**previous, "state": "delivered"}
                            _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
                            _dfd.fsync(fd)
                            clean_parts()
                            continue
                    if not (previous and previous.get("local_output")) and (
                            not isinstance(asset.get("url"), str) or not asset["url"]):
                        raise ValueError("recovered asset has no download URL")
                try:
                    stream_fd = _dfd.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                                        0o600, dir_fd=out_fd)
                    with os.fdopen(stream_fd, "w+b") as stream:
                        if previous and previous.get("local_output"):
                            with job_lock_at(job_fd):
                                record = current()
                                if record["delivered"].get(relative, {}).get("state") == "delivered":
                                    continue
                                source_fd = _dfd.open(f"{operation_id}-{index}.asset",
                                    os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_NONBLOCK | _dfd.O_CLOEXEC, dir_fd=fd)
                                with os.fdopen(source_fd, "rb") as source:
                                    if not stat.S_ISREG(_dfd.fstat(source.fileno()).st_mode):
                                        raise OSError("native operation output must be a regular file")
                                    shutil.copyfileobj(source, stream)
                        else:
                            download(asset["url"], stream)
                        stream.flush()
                        _dfd.fsync(stream.fileno())
                    with job_lock_at(job_fd):
                        record = current()
                        previous = record["delivered"].get(relative)
                        if previous and previous.get("state") == "delivered":
                            continue  # Another worker/native publisher completed it.
                        digest = _file_digest_at(out_fd, temporary)
                        if digest["bytes"] <= 0:
                            raise ValueError("recovered asset was empty")
                        if previous and {k: previous[k] for k in ("sha256", "bytes")} != digest:
                            raise ValueError("the original recovered asset bytes changed")
                        receipt = {**digest, "asset_id": asset["asset_id"], "state": "publishing"}
                        if previous and previous.get("local_output"):
                            receipt["local_output"] = True
                        record["delivered"][relative] = receipt
                        _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
                        _dfd.fsync(fd)
                        journal_attached()
                        output_attached()
                        try:
                            _dfd.link(temporary, leaf, src_dir_fd=out_fd, dst_dir_fd=out_fd, follow_symlinks=False)
                        except FileExistsError:
                            if _file_digest_at(out_fd, leaf) != digest:
                                # Never replace it. Record that this result can't
                                # arrive, so the name stops reading "on its way".
                                record["delivered"][relative] = {**receipt, "blocked": "destination_exists"}
                                _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
                                _dfd.fsync(fd)
                                raise FileExistsError(f"{relative} already contains different bytes; original result retained for recovery")
                        _dfd.fsync(out_fd)
                        journal_attached()
                        output_attached()
                        record["delivered"][relative] = {**receipt, "state": "delivered"}
                        _replace_at(fd, _filename(operation_id), json.dumps(record, allow_nan=False).encode("utf8"))
                        _dfd.fsync(fd)
                        clean_parts()
                finally:
                    # Never remove the complete published file after a receipt
                    # write/flush exception; recovery can adopt it after restart.
                    try:
                        _dfd.unlink(temporary, dir_fd=out_fd)
                    except FileNotFoundError:
                        pass
        if len(record["outputs"]) != len(assets):
            raise ValueError("available assets were preserved; the returned asset count differs from the saved destinations")
        return record


def delivered_paths(job: Path, record: dict) -> list[str]:
    """Absolute paths of this succeeded operation's own published files.

    Only the saved destinations count, each re-checked against its delivery
    receipt; nothing is discovered from a directory listing.
    """
    result = record.get("result") or {}
    assets = result.get("assets") or []
    if result.get("status") != "succeeded" or len(record["outputs"]) != len(assets):
        raise ValueError("operation outputs are not complete")
    if record["path"] == "/v1/model_call" and record["outputs"] != _model_outputs(result):
        raise ValueError("saved model media destinations changed")
    paths = []
    with _journal(job) as (job_fd, _, _):
        for relative, asset in zip(record["outputs"], assets):
            receipt = record["delivered"].get(relative) or {}
            if receipt.get("state") != "delivered" or receipt.get("asset_id") != asset.get("asset_id"):
                raise ValueError(f"{relative} has not been delivered")
            with _output_parent(job_fd, relative) as (out_fd, leaf, _):
                if _file_digest_at(out_fd, leaf) != {k: receipt[k] for k in ("sha256", "bytes")}:
                    raise ValueError(f"{relative} no longer matches its delivered bytes")
            paths.append(os.path.join(os.path.abspath(job), relative))
    return paths


def delivered_record(job: Path, relative: str, sha256: str, context: dict) -> dict | None:
    """The succeeded record of this video whose delivery of ``relative`` has these bytes.

    Read-only. A tool finishing an interrupted regeneration (videoclaw#283)
    reuses a result the app already saved; provider fields such as a
    cast_avatar BytePlus URL exist only in the saved result.
    """
    job = Path(os.path.abspath(job))
    if not (job / "operations").is_dir():
        return None
    ownership = owner(context)
    with _journal(job) as (_, fd, _):
        for name in sorted(_dfd.listdir(fd)):
            operation_id = name.removesuffix(".json")
            if not name.endswith(".json") or not _ID.fullmatch(operation_id):
                continue
            try:
                record = _read_at(fd, operation_id)
            except (OSError, ValueError):
                continue
            receipt = record["delivered"].get(relative) or {}
            if (record["owner"] == ownership and ownership["client_job"] == job.name and relative in record["outputs"]
                    and (record.get("result") or {}).get("status") == "succeeded"
                    and receipt.get("state") == "delivered" and receipt.get("sha256") == sha256):
                return record
    return None


def undelivered_claims(job: Path, context: dict) -> list[tuple[str, str, str]]:
    """(destination, operation id, status) for each file this video's paid operations still owe.

    Read-only: the claims ``_refuse_claimed`` matches by exact name (#294),
    minus results that can never arrive. A regeneration that saves each
    request's take under its own name (videoclaw#283) checks the takes of
    other requests for the same output with it.
    """
    job = Path(os.path.abspath(job))
    if not (job / "operations").is_dir():
        return []
    claims = []
    ownership = owner(context)
    with _journal(job) as (_, fd, _):
        for name in sorted(_dfd.listdir(fd)):
            operation_id = name.removesuffix(".json")
            if not name.endswith(".json") or not _ID.fullmatch(operation_id):
                continue
            try:
                record = _read_at(fd, operation_id)
            except (OSError, ValueError):
                continue
            if record["owner"] != ownership or ownership["client_job"] != job.name:
                continue
            status = (record.get("result") or {}).get("status") or "submitted"
            claims.extend((destination, operation_id, status)
                          for destination, blocked in _claimed_destinations(record) if not blocked)
    return claims


def collect_command(argv=None) -> int:
    """One app-owned operation per process; recovery or explicit cancellation."""
    import argparse
    from _gateway import gateway, GatewayError
    parser = argparse.ArgumentParser(description=collect_command.__doc__)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--owner-json", required=True)
    parser.add_argument("--request-sha256", required=True)
    parser.add_argument("--cancel", action="store_true")
    parser.add_argument("--defer-publication", action="store_true")
    args = parser.parse_args(argv)
    try:
        # Main remembers the authorized request, independently of this
        # agent-writable journal. Neither a scan nor a new POST is permitted.
        context = {"schema": CONTEXT_SCHEMA, **json.loads(args.owner_json)}
        saved = read(args.job, args.operation_id, context)
        if saved["sha256"] != args.request_sha256:
            raise ValueError("saved request differs from the app's accepted operation")
        # videoclaw#322: an app that sets this announces a delivery on the pass
        # that reports it, so a settling outcome may be published now. Without
        # it the app announces only on a complete pass, so publication waits
        # for the settled read, as before pending settlement existed.
        delivery_v1 = os.environ.get("VIDEOCLAW_COLLECTOR_DELIVERY") == "v1"
        record = gateway.collect_operation(args.job, args.operation_id, cancel=args.cancel,
                                           publish=not args.defer_publication, publish_settling=delivery_v1)
        result = record.get("result") or {}
        status = result.get("status", "accepted_unknown")
        support_needed = (result.get("settlement_state") == "support_needed" and not delivery_v1
                          if status in _TERMINAL else result.get("result_reconciliation_state") == "support_needed")
        if status in {"accepted_unknown", "submission_unknown"} or support_needed:
            reason = "support_needed" if support_needed else status
            raise ValueError(f"the original generation needs support recovery ({reason}); do not generate a replacement")
        delivered = status in _TERMINAL - {"succeeded"} or (
            status == "succeeded" and len(record["outputs"]) == len(result.get("assets", []))
            and all(record["delivered"].get(p, {}).get("state") == "delivered" for p in record["outputs"]))
        # A settling outcome stays with the app until its charge is logged.
        complete = delivered and not settling(result)
        output = {"operation_id": args.operation_id, "status": status, "complete": complete,
                  **({"delivered": delivered} if delivery_v1 else {}),
                  **({"settlement_state": result["settlement_state"]} if delivery_v1 and settling(result) else {})}
        if (complete or delivery_v1 and delivered) and record["path"] == "/v1/model_call":
            # The app hands this to the conversation; it must describe exactly
            # the request it authorized (videoclaw#268 / app#911).
            if record["sha256"] != args.request_sha256 or record["owner"] != saved["owner"]:
                raise ValueError("saved request differs from the app's accepted operation")
            try:
                files = delivered_paths(args.job, record) if status == "succeeded" else []
            except (OSError, ValueError):
                files = None  # Changed after delivery (e.g. a user's edit): report the result without files.
            output["completion"] = {"operation_id": args.operation_id,
                "model": json.loads(record["body"]).get("model"), "status": status, "saved": files or [],
                **({"cost_usd": result["cost_usd"], "cost_source": result.get("cost_source")} if complete else {}),
                **({"output_state": "unavailable"} if files is None else {})}
        print(json.dumps(output))
        return 0
    except (GatewayError, OSError, ValueError, TypeError) as exc:
        print(json.dumps({"operation_id": args.operation_id, "status": "recovery_required",
                          "complete": False, "error": str(exc)[:1200]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(collect_command())
