"""
mint_image.py — the canonical image primitive (provider-neutral gateway rail).

ONE self-contained tool, parameterized by `--role`. Absorbs the logic of the two
former backends:
  - generate_image.py  (canon: --job/--name/_index.json, retry + reference flow)
  - gen_image.py       (josephchin fork: raw --output paths, no job manifest)

The Release 0.0.11 default is Nano Banana 2. Prompt-only requests use its
text-to-image endpoint; any reference selects its edit endpoint. GPT Image 2
remains an explicit `--model gpt-image-2` A/B/rollback rail. The gateway owns
the default so an operational rollback affects only new jobs. The direct
Replicate path is available only when GPT is explicitly selected for unkeyed
local development; the tool never silently crosses models.

⛔ TRANSPARENCY (live incident 2026-07-16): the prior deployment rejected
`background: transparent` — every such
prediction fails terminally AND still bills ("Transparent background is not
supported for this model"; 8 failed `--role overlay` predictions, $0.32).
The tool therefore NEVER sends that param. `--background transparent` still
delivers a transparent PNG: it auto-routes through the chroma-strip path
(generate on a flat #FF00FF background, colorkey to clean RGBA — the same
founding-session technique --strip-chroma already implements). Non-PNG output
can't carry the colorkeyed alpha, so `--background transparent` with
jpeg/webp fails FAST client-side, before any spend.

  uv run python tools/mint_image.py --job <job> --role <role> --name <name> \
      --prompt "..." \
      [--reference <png|url>]   # repeatable
      [--aspect 1:1|2:3|3:2]
      [--quality low|medium|high|auto]
      [--background auto|transparent|opaque]
      [--strip-chroma | --no-strip-chroma]

TIMING: Nano Banana 2 normally completes in seconds, while the explicit GPT
rail can take ~90–130s. Keep a ≥300s safety timeout for queue/cold-start
variance. For several stills, use --batch; 5–10 variants are split into
provider-supported chunks of at most four while remaining one logical item.

BATCH MODE (--batch <specs.json>): job-manifest mode only. The file is a JSON
list; each item {"name": ..., "prompt": ...} plus optional per-item overrides
"aspect", "quality", "background", "variants", "references": [...]. --role and
every other CLI flag apply to all items unless overridden. Per-item failures
don't kill the batch — survivors are written + indexed, losers are named and
the exit code is non-zero so the caller retries JUST those. Items named "not
written yet" or "already on its way" are paid (or being paid) work the app
delivers into images/ by itself: never re-run those.

  uv run python tools/mint_image.py --job <job> --role seed_frame \
      --batch stills.json

`--role` is REQUIRED and logged as `usage_role` (evidence: 261 classified image
runs, _archaeology/gen_roles.md). The six roles:

  card           designed card/mockup/receipt the viewer reads (text baked in).
  seed_frame     a still destined to become motion via mint_video keyframe mode.
  overlay        transparent-bg asset laid over footage (icons, tweet mockups).
                 --strip-chroma defaults ON: auto colorkey + alpha-normalize.
  cover          the Reel/post cover thumbnail (stylize a chosen base frame).
  portrait       reference-conditioned still of the (real/generated) speaker.
  artistic_still styled fine-art B-roll still (ukiyo-e, woodblock, painterly).

OUTPUTS
  Job mode (default):  <job_dir>/images/<name>.{png|jpeg|webp}
                       <job_dir>/images/<name>.prompt.txt
                       <job_dir>/images/_index.json   (slot → file + settings)
  Raw mode (--output): writes exactly to the given path (gen_image.py parity);
                       still requires --job for usage_role logging.

OVERLAY CHROMA STRIP (--strip-chroma, default ON for role=overlay)
  Four founding sessions (371a0e39, 86dc34db, 88ca2208, fa4fc83a) did this by
  hand: prompt the model for a flat pure-magenta #FF00FF background, then
  colorkey it out to clean RGBA. We fold that in. When --strip-chroma is on for
  an overlay and --background is left at its default, we (a) append a magenta
  chroma-key instruction to the prompt and (b) post-process the downloaded PNG
  with the proven ffmpeg recipe:  colorkey=0xFF00FF:0.30:0.10,format=rgba .
  `--background transparent` routes through this same path (see TRANSPARENCY
  above) — the deployment rejects native alpha, the colorkey is the way.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import _compat_dirfd as _dfd  # port: dir_fd/O_DIRECTORY emulation on Windows (POSIX: same os functions)
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import replicate
import requests
from dotenv import load_dotenv

from _paths import ENV_PATH
from job import (
    add_job_arg,
    resolve_job_dir,
    resolve_job_input_path,
    resolve_job_output_path,
)
from log import JOB_LOCK_NAME, job_lock_at, log_event, log_event_at
from replicate_safe import run_with_timeout  # hard timeout on silent hangs + cost log
from cost import (  # single source of truth for image pricing
    gpt_image_unit_price,
    unit_price,
)
from _gateway import gateway, GatewayAcceptedError, exit_on_repeat_refusal  # dual mode: VIDEOCLAW_API_KEY set → gateway routes the call
from _refusal_guard import REPEAT_REFUSED_CODE

load_dotenv(ENV_PATH if ENV_PATH.exists() else None)

os.environ["REPLICATE_API_TOKEN"] = os.environ.get("REPLICATE_API_TOKEN", "")

# Stable semantic model name. The gateway maps it to Fal's current endpoint.
GPT_IMAGE_2 = "openai/gpt-image-2"
GATEWAY_MODEL_IDS = {
    "nano-banana-2": "google/nano-banana-2",
    "gpt-image-2": GPT_IMAGE_2,
}
GATEWAY_MODEL_TO_RESOLVED = {
    "google/nano-banana-2": "fal-ai/nano-banana-2",
    GPT_IMAGE_2: "fal-ai/gpt-image-2",
}
DEFAULT_MODEL = "default"
NANO_MAX_IMAGES_PER_REQUEST = 4
NANO_MAX_REFERENCES = 14

ROLES = ("card", "seed_frame", "overlay", "cover", "portrait", "artistic_still")

_SLOT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def _safe_slot_name(value: object, label: str = "--name") -> str:
    """Return a filename-safe image slot or fail before provider contact."""
    if not isinstance(value, str) or value in {".", ".."} or not _SLOT_RE.fullmatch(value):
        raise SystemExit(
            f"{label} must be a simple filename slot using letters, numbers, '.', '_' or '-'"
        )
    return value


class _PinnedImagesDir:
    """Invocation-pinned, no-follow publisher for implicit image outputs.

    The jobs parent, selected job, and images descriptors are opened before
    provider contact and kept for the entire invocation. Every publication is
    staged and renamed relative to those descriptors, with attachment checks
    and rollback around files, index, and success metadata.

    The per-job lock is taken by ``begin`` (the publication transaction) and
    released by ``close``, never across the provider wait: holding it there
    made every other paid call on the same video queue behind this image
    (videoclaw#273). ``begin`` therefore snapshots rollback originals and the
    caller re-reads ``_index.json`` only once the lock is held.
    """

    def __init__(self, job: Path):
        requested_job = Path(job)
        self.path = requested_job / "images"
        job = Path(os.path.abspath(requested_job))
        self._job_path = job
        self._parent_path = job.parent
        self._job_name = job.name
        self._parent_fd = -1
        self._job_fd = -1
        self._images_fd = -1
        self._lock_context = None
        self._lock_fd = -1
        self._originals: dict[str, bytes | None] = {}
        self._precheck_originals: dict[str, bytes | None] = {}
        self._precheck_index: dict | None = None
        self._published: dict[str, tuple[int, int, int, str]] = {}
        self._success_event_ids: set[str] = set()
        self._success_log_fd = -1
        self._success_log_stat: os.stat_result | None = None
        self._success_run_fd = -1
        self._success_run_stat: os.stat_result | None = None
        self._success_sidecars: dict[str, tuple[int, int, int, str]] = {}
        flags = os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC
        try:
            self._parent_fd = _dfd.open(self._parent_path, flags)
            self._parent_stat = _dfd.fstat(self._parent_fd)
            self._job_fd = _dfd.open(self._job_name, flags, dir_fd=self._parent_fd)
            self._job_stat = _dfd.fstat(self._job_fd)
            try:
                _dfd.mkdir("images", mode=0o700, dir_fd=self._job_fd)
            except FileExistsError:
                pass
            self._images_fd = _dfd.open("images", flags, dir_fd=self._job_fd)
            self._images_stat = _dfd.fstat(self._images_fd)
            self._assert_attached()
        except OSError as exc:
            self.close()
            raise SystemExit(
                "job images directory must not be symlinked and must be a "
                f"real directory: {self.path}"
            ) from exc

    def close(self) -> None:
        try:
            if self._originals or self._success_event_ids:
                self.rollback()
        finally:
            self._close_success_metadata()
            if self._lock_context is not None:
                self._lock_context.__exit__(None, None, None)
                self._lock_context = None
                self._lock_fd = -1
            for attr in ("_images_fd", "_job_fd", "_parent_fd"):
                fd = getattr(self, attr, -1)
                if fd >= 0:
                    _dfd.close(fd)
                    setattr(self, attr, -1)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def _assert_attached(self) -> None:
        try:
            parent = _dfd.stat(self._parent_path, follow_symlinks=False)
            job = _dfd.stat(
                self._job_name,
                dir_fd=self._parent_fd,
                follow_symlinks=False,
            )
            current = _dfd.stat("images", dir_fd=self._job_fd, follow_symlinks=False)
            lock = held_lock = None
            if self._lock_fd >= 0:
                lock = _dfd.stat(
                    JOB_LOCK_NAME,
                    dir_fd=self._job_fd,
                    follow_symlinks=False,
                )
                held_lock = _dfd.fstat(self._lock_fd)
        except OSError as exc:
            raise SystemExit("job images directory changed after billing plan binding") from exc
        if (
                not stat.S_ISDIR(parent.st_mode)
                or (parent.st_dev, parent.st_ino) !=
                (self._parent_stat.st_dev, self._parent_stat.st_ino)
                or not stat.S_ISDIR(job.st_mode)
                or (job.st_dev, job.st_ino) !=
                (self._job_stat.st_dev, self._job_stat.st_ino)
                or not stat.S_ISDIR(current.st_mode)
                or (current.st_dev, current.st_ino) !=
                (self._images_stat.st_dev, self._images_stat.st_ino)
                or (lock is not None and (
                    not stat.S_ISREG(lock.st_mode)
                    or (lock.st_dev, lock.st_ino) !=
                    (held_lock.st_dev, held_lock.st_ino)))):
            raise SystemExit("job images directory changed after billing plan binding")

    def _acquire(self) -> None:
        """Enter the per-job publication lock (idempotent, released by close)."""
        if self._lock_context is not None:
            return
        lock_context = job_lock_at(self._job_fd)
        try:
            self._lock_fd = lock_context.__enter__()
        except OSError as exc:
            raise SystemExit(
                "job images directory must not be symlinked and must be a "
                f"real directory: {self.path}"
            ) from exc
        self._lock_context = lock_context

    @staticmethod
    def _replace_at(dir_fd: int, filename: str, data: bytes) -> None:
        temporary = f".videoclaw-{os.getpid()}-{os.urandom(8).hex()}.tmp"
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

    @staticmethod
    def _fingerprint_at(
        dir_fd: int, filename: str
    ) -> tuple[int, int, int, str]:
        fd = _dfd.open(
            filename,
            os.O_RDONLY | _dfd.O_NONBLOCK | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
            dir_fd=dir_fd,
        )
        try:
            identity = _dfd.fstat(fd)
            if not stat.S_ISREG(identity.st_mode):
                raise OSError(f"publication target must be regular: {filename}")
            digest = hashlib.sha256()
            while True:
                chunk = os.read(fd, 1 << 20)
                if not chunk:
                    break
                digest.update(chunk)
            return (
                identity.st_dev,
                identity.st_ino,
                identity.st_size,
                digest.hexdigest(),
            )
        finally:
            _dfd.close(fd)

    @staticmethod
    def _read_fd(fd: int) -> bytes:
        data = bytearray()
        offset = 0
        while True:
            chunk = _dfd.pread(fd, 1 << 20, offset)
            if not chunk:
                return bytes(data)
            data.extend(chunk)
            offset += len(chunk)

    @staticmethod
    def _same_named_fd(dir_fd: int, filename: str, fd: int) -> bool:
        expected = _dfd.fstat(fd)
        try:
            current = _dfd.stat(filename, dir_fd=dir_fd, follow_symlinks=False)
        except OSError:
            return False
        return (
            stat.S_IFMT(current.st_mode) == stat.S_IFMT(expected.st_mode)
            and (current.st_dev, current.st_ino)
            == (expected.st_dev, expected.st_ino)
        )

    def _validate_published(self) -> None:
        for filename, expected in self._published.items():
            try:
                current = self._fingerprint_at(self._images_fd, filename)
            except OSError as exc:
                raise SystemExit(
                    f"image publication target changed after write: {filename}"
                ) from exc
            if current != expected:
                raise SystemExit(
                    f"image publication target changed after write: {filename}"
                )

    def _close_success_metadata(self) -> None:
        for attr in ("_success_run_fd", "_success_log_fd"):
            fd = getattr(self, attr, -1)
            if fd >= 0:
                _dfd.close(fd)
                setattr(self, attr, -1)
        self._success_log_stat = None
        self._success_run_stat = None
        self._success_sidecars.clear()

    def _pin_success_event(self, event_id: str) -> None:
        if self._success_log_fd < 0:
            self._success_log_fd = _dfd.open(
                "run.log.jsonl",
                os.O_RDWR | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=self._job_fd,
            )
            self._success_log_stat = _dfd.fstat(self._success_log_fd)
            if not stat.S_ISREG(self._success_log_stat.st_mode):
                raise OSError("run.log.jsonl must be a regular file")
        if not self._same_named_fd(
            self._job_fd, "run.log.jsonl", self._success_log_fd
        ):
            raise OSError("run.log.jsonl changed during success logging")
        event: dict | None = None
        for line in self._read_fd(self._success_log_fd).splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and value.get("id") == event_id:
                event = value
                break
        if event is None:
            raise OSError("success event is missing from canonical run.log.jsonl")
        sidecars = [
            value
            for key, value in event.items()
            if key.endswith("_sidecar") and isinstance(value, str)
        ]
        if not sidecars:
            return
        if self._success_run_fd < 0:
            self._success_run_fd = _dfd.open(
                "run",
                os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=self._job_fd,
            )
            self._success_run_stat = _dfd.fstat(self._success_run_fd)
        if not self._same_named_fd(self._job_fd, "run", self._success_run_fd):
            raise OSError("run sidecar directory changed during success logging")
        for relative in sidecars:
            prefix = "run/"
            if not relative.startswith(prefix):
                raise OSError(f"invalid success sidecar path: {relative}")
            filename = relative[len(prefix):]
            self._success_sidecars[filename] = self._fingerprint_at(
                self._success_run_fd, filename
            )

    def _validate_success_metadata(self) -> None:
        if self._success_event_ids:
            if self._success_log_fd < 0 or not self._same_named_fd(
                self._job_fd, "run.log.jsonl", self._success_log_fd
            ):
                raise SystemExit("run.log.jsonl changed after success logging")
            present: set[str] = set()
            for line in self._read_fd(self._success_log_fd).splitlines():
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict) and value.get("id") in self._success_event_ids:
                    present.add(value["id"])
            if present != self._success_event_ids:
                raise SystemExit("success event changed after logging")
        if self._success_sidecars:
            if self._success_run_fd < 0 or not self._same_named_fd(
                self._job_fd, "run", self._success_run_fd
            ):
                raise SystemExit("run sidecar directory changed after success logging")
            for filename, expected in self._success_sidecars.items():
                try:
                    current = self._fingerprint_at(self._success_run_fd, filename)
                except OSError as exc:
                    raise SystemExit(
                        f"success sidecar changed after logging: {filename}"
                    ) from exc
                if current != expected:
                    raise SystemExit(
                        f"success sidecar changed after logging: {filename}"
                    )

    def _snapshot(self, filename: str) -> bytes | None:
        """Current regular-file bytes, None when absent; SystemExit otherwise."""
        try:
            current = _dfd.stat(
                filename,
                dir_fd=self._images_fd,
                follow_symlinks=False,
            )
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise SystemExit(
                f"image publication target must be a regular file: {filename}"
            ) from exc
        if not stat.S_ISREG(current.st_mode):
            raise SystemExit(
                f"image publication target must be a regular file: {filename}"
            )
        try:
            fd = _dfd.open(
                filename,
                os.O_RDONLY | _dfd.O_NONBLOCK | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=self._images_fd,
            )
        except OSError as exc:
            raise SystemExit(
                f"image publication target must be a regular file: {filename}"
            ) from exc
        try:
            if not stat.S_ISREG(_dfd.fstat(fd).st_mode):
                raise SystemExit(
                    f"image publication target must be a regular file: {filename}"
                )
            with os.fdopen(fd, "rb", closefd=False) as source:
                return source.read()
        finally:
            _dfd.close(fd)

    def precheck(self, filenames: set[str]) -> None:
        """Before provider contact, without the lock: refuse unusable targets.

        A publication name that is already a directory, symlink or device
        must stop the call before anything is paid for. The bytes seen here
        are the fallback rollback state if such an entry is planted while the
        provider works, which is exactly what the pre-#273 whole-invocation
        lock guaranteed.
        """
        self._assert_attached()
        for filename in filenames:
            self._precheck_originals[filename] = self._snapshot(filename)
        self._precheck_index = self._load_json("_index.json")
        self._assert_attached()

    def begin(self, filenames: set[str]) -> None:
        """Take the publication lock, then snapshot names for exact rollback.

        Snapshots are re-read under the lock so a sibling process's
        publication since ``precheck`` is preserved, not rolled back over.
        """
        self._acquire()
        self._assert_attached()
        for filename in filenames:
            try:
                self._originals[filename] = self._snapshot(filename)
            except SystemExit:
                if filename not in self._precheck_originals:
                    raise
                # Planted during the provider wait: publish over it, and on
                # rollback restore what precheck proved was there.
                self._originals[filename] = self._precheck_originals[filename]
        self._assert_attached()

    @staticmethod
    def _remove_events_at(
        job_fd: int,
        event_ids: set[str],
        log_fd: int = -1,
        run_fd: int = -1,
    ) -> None:
        if not event_ids:
            return
        owned_log_fd = log_fd < 0
        try:
            fd = log_fd if log_fd >= 0 else _dfd.open(
                "run.log.jsonl",
                os.O_RDWR | _dfd.O_NONBLOCK | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=job_fd,
            )
        except OSError:
            return
        if not stat.S_ISREG(_dfd.fstat(fd).st_mode):
            if owned_log_fd:
                _dfd.close(fd)
            return
        lines = _PinnedImagesDir._read_fd(fd).decode("utf-8").splitlines(True)
        kept: list[str] = []
        changed = False
        for line in lines:
            try:
                remove = json.loads(line).get("id") in event_ids
            except (json.JSONDecodeError, AttributeError):
                remove = False
            if remove:
                changed = True
            else:
                kept.append(line)
        if not changed:
            if owned_log_fd:
                _dfd.close(fd)
            return
        data = "".join(kept).encode()
        log_is_attached = _PinnedImagesDir._same_named_fd(
            job_fd, "run.log.jsonl", fd
        )
        if log_is_attached:
            _PinnedImagesDir._replace_at(job_fd, "run.log.jsonl", data)
        else:
            # The canonical name was replaced after success logging. Scrub the
            # pinned detached inode without touching the unrelated replacement.
            os.ftruncate(fd, 0)
            os.lseek(fd, 0, os.SEEK_SET)
            view = memoryview(data)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError("short rollback write to run.log.jsonl")
                view = view[written:]
            _dfd.fsync(fd)
        if owned_log_fd:
            _dfd.close(fd)
        if log_is_attached:
            try:
                _dfd.unlink("run.md", dir_fd=job_fd)
            except OSError:
                pass
        owned_run_fd = run_fd < 0
        try:
            active_run_fd = run_fd if run_fd >= 0 else _dfd.open(
                "run",
                os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC,
                dir_fd=job_fd,
            )
        except OSError:
            return
        try:
            for name in _dfd.listdir(active_run_fd):
                if any(name.startswith(f"{event_id}__") for event_id in event_ids):
                    try:
                        _dfd.unlink(name, dir_fd=active_run_fd)
                    except OSError:
                        pass
        finally:
            if owned_run_fd:
                _dfd.close(active_run_fd)

    def _remove_success_events(self) -> None:
        self._remove_events_at(
            self._job_fd,
            self._success_event_ids,
            self._success_log_fd,
            self._success_run_fd,
        )

    def rollback(self) -> None:
        """Remove this invocation's success metadata and restore prior outputs."""
        self._remove_success_events()
        for filename, original in self._originals.items():
            if original is None:
                try:
                    _dfd.unlink(filename, dir_fd=self._images_fd)
                except OSError:
                    pass
            else:
                self._replace_at(self._images_fd, filename, original)
        self._originals.clear()
        self._published.clear()
        self._success_event_ids.clear()
        self._close_success_metadata()

    def commit(self) -> None:
        try:
            self._assert_attached()
            self._validate_published()
            self._validate_success_metadata()
        except BaseException:
            self.rollback()
            raise
        self._originals.clear()
        self._published.clear()
        self._success_event_ids.clear()
        self._close_success_metadata()

    def verify(self) -> None:
        try:
            self._assert_attached()
            self._validate_published()
        except BaseException:
            self.rollback()
            raise

    def _require_publication(self) -> None:
        if self._lock_context is None:
            raise RuntimeError("image publication must start with begin()")

    def log_success(self, **kwargs) -> str:
        self._require_publication()
        try:
            self._assert_attached()
            event_id = log_event_at(self._job_fd, self._job_name, **kwargs)
            self._success_event_ids.add(event_id)
            self._pin_success_event(event_id)
            self._assert_attached()
            return event_id
        except BaseException:
            self.rollback()
            raise

    def _load_json(self, filename: str) -> dict:
        self._assert_attached()
        try:
            fd = _dfd.open(
                filename,
                os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC | _dfd.O_NONBLOCK,
                dir_fd=self._images_fd,
            )
        except FileNotFoundError:
            self._assert_attached()
            return {}
        except OSError as exc:
            raise SystemExit(f"image metadata must not be symlinked: {filename}") from exc
        if not stat.S_ISREG(_dfd.fstat(fd).st_mode):
            _dfd.close(fd)  # a FIFO/device would block the publication lock forever
            raise SystemExit(f"image metadata must be a regular file: {filename}")
        with os.fdopen(fd, "r", encoding="utf-8") as source:
            value = json.load(source)
        self._assert_attached()
        return value if isinstance(value, dict) else {}

    def read_json(self, filename: str) -> dict:
        """Read metadata under the publication lock (fresh sibling entries).

        Falls back to the precheck copy when the name was replaced by a
        non-regular entry during the provider wait; publication then replaces
        that entry without following it.
        """
        self._require_publication()
        try:
            return self._load_json(filename)
        except SystemExit:
            # Only a planted symlink/non-regular entry reaches here; whatever it
            # replaced is already gone, so publish over it from the precheck
            # copy (the pre-#273 behaviour). A regular file that no longer
            # parses raises instead: never clobber an index we cannot read.
            if filename != "_index.json" or self._precheck_index is None:
                raise
            return dict(self._precheck_index)

    def write_bytes(self, filename: str, data: bytes) -> None:
        self._require_publication()
        try:
            self._assert_attached()
            self._replace_at(self._images_fd, filename, data)
            try:
                current = self._fingerprint_at(self._images_fd, filename)
            except OSError as exc:
                raise SystemExit(
                    f"image publication target changed after write: {filename}"
                ) from exc
            if current[2] != len(data) or current[3] != hashlib.sha256(data).hexdigest():
                raise SystemExit(
                    f"image publication target changed after write: {filename}"
                )
            self._published[filename] = current
            self._assert_attached()
        except BaseException:
            self.rollback()
            raise

    def write_text(self, filename: str, value: str) -> None:
        self.write_bytes(filename, value.encode("utf-8"))

# gpt-image-2 semantic aspect ratios. The model expanded its `aspect_ratio`
# enum (2026-07) beyond the original 1:1/3:2/2:3 to include landscape/portrait
# 4:3·3:4, wide 16:9, and — the one that closes the vertical-video gap — native
# 9:16, plus `auto`. This unblocks minting true 1080x1920 stills for reels
# instead of extending from 2:3. (Explicit pixel sizes like 1152x2048 are also
# accepted by the model's `aspect_ratio` input, but the ratio strings cover our
# canonical needs.) The same smaller cross-rail contract is intentionally used
# for Nano so explicit rollback retains stable framing. NOTE: the deployed
# gateway must also allow each value — redeploy if a new ratio 400s.
VALID_ASPECTS = ("1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "auto")
VALID_QUALITY = ("low", "medium", "high", "auto")
VALID_BACKGROUND = ("auto", "transparent", "opaque")
VALID_FORMATS = ("png", "jpeg", "webp")
MAX_VARIANTS = 10

# Per-role default aspect ratio (from skills/primitives/mint_image.md).
ROLE_DEFAULT_ASPECT = {
    "card": "2:3",
    "seed_frame": "2:3",
    "overlay": "1:1",
    "cover": "2:3",
    "portrait": "2:3",
    "artistic_still": "2:3",
}

# Magenta chroma-key sentinel + the proven extraction recipe. Both lifted
# verbatim from the four founding overlay sessions (371a0e39 et al.).
CHROMA_HEX = "#FF00FF"
CHROMA_PROMPT_SUFFIX = (
    " Set the subject on a perfectly flat solid pure chroma-key magenta "
    "background, hex color exactly #FF00FF, the entire background filling the "
    "frame edge-to-edge in that single saturated magenta with no gradient, no "
    "shading, no noise. Only the subject floats on this flat magenta field."
)
CHROMA_COLORKEY = "colorkey=0xFF00FF:0.30:0.10,format=rgba"


# ── transparent-background vendor guard ──────────────────────────────────────
def _guard_background(background: str, output_format: str,
                      label: str = "") -> tuple[str, bool]:
    """Never forward a model-specific native transparency assumption.

    This deployment rejects the param — the prediction fails terminally AND
    still bills (live incident 2026-07-16: 8 failed `--role overlay`
    predictions, $0.32, "Transparent background is not supported for this
    model"). Returns (safe_background, rerouted): a transparency request
    becomes background=opaque + rerouted=True, and the caller MUST run the
    chroma-strip path so the written PNG still ends up transparent. Non-PNG
    output can't carry the colorkeyed alpha → fail FAST client-side, before
    any spend, with the working alternative spelled out.
    """
    if background != "transparent":
        return background, False
    if output_format != "png":
        raise SystemExit(
            f"--background transparent{label}: the image-rail contract does "
            "not include a native transparency parameter (the legacy rail "
            "can fail at the vendor AND still bill). mint_image delivers "
            "transparency anyway via its chroma-strip route (generate on a "
            "flat #FF00FF background, then colorkey to clean RGBA — see "
            "skills/primitives/mint_image.md, role=overlay), but that needs "
            "an alpha-capable PNG: re-run with --output-format png.")
    return "opaque", True


def _reroute_note(label: str = "") -> str:
    """The log line the agent reads when a transparency request is rerouted."""
    return (f"  [guard]{label} native background=transparent is not in the "
            "image-rail contract — auto-routing: generating on a flat "
            "#FF00FF chroma background and colorkeying to clean RGBA "
            "(the --strip-chroma overlay route). The written PNG is still "
            "transparent.")


def _resolve_reference(ref: str):
    """URL/data-uri passes through; a local path is opened so the SDK uploads it.

    Merges generate_image.py's `_resolve_reference` (raises on missing) with
    gen_image.py's `_resolve_refs` (which did the same per-item).
    """
    if ref.startswith(("http://", "https://", "data:")):
        return ref
    p = Path(ref).expanduser().resolve()
    if not p.exists():
        raise SystemExit(f"--reference path does not exist: {p}")
    return open(p, "rb")


def _build_payload(args, references: list, prompt: str) -> dict:
    """Legacy local gpt-image-2 payload.

    Gateway mode sends the semantic fields directly and the backend translates
    them to Fal. This shape is retained only for the temporary unkeyed local
    fallback; `input_images` must remain plural there.
    """
    payload = {
        "prompt": prompt,
        "aspect_ratio": args.aspect,
        "quality": args.quality,
        "background": args.background,
        "output_format": args.output_format,
        "output_compression": args.output_compression,
        "number_of_images": args.variants,
        "moderation": args.moderation,
        "input_images": references,
    }
    # Temporary unkeyed-local fallback only: forward the operator's OpenAI key
    # rather than depending on a provider-shared quota.
    if os.environ.get("OPENAI_API_KEY"):
        payload["openai_api_key"] = os.environ["OPENAI_API_KEY"]
    return payload


def _local_estimator(role, quality: str, aspect: str):
    """GPT price per DELIVERED image for the explicit local fallback, as a
    callable run_with_timeout applies to the model output — so the
    `replicate_call` row is the ONE cost carrier on this path (#63), priced by
    what actually came back (one call may return several variants).

    The public PRICES table describes the Nano default. This legacy path is
    explicitly GPT, so it must not silently borrow the default model's rate.
    Unknown/auto quality is conservatively priced as high; auto aspect is
    conservatively rectangular.
    """
    del role  # Role does not affect GPT's image-size price.
    unit = gpt_image_unit_price(quality, aspect)
    return lambda output: unit * (len(output) if isinstance(output, list) else 1)


def _replicate_generate(build_payload, job, est_usd=None):
    """Temporary local (non-gateway) fallback with transient retry.
    `build_payload()` returns a FRESH payload (reference file handles are
    exhausted after a failed attempt, so each retry rebuilds). `est_usd`
    (float or callable(output)→float, from _local_estimator) rides on the
    `replicate_call` event — the canonical cost record for this path; the
    images_generated event carries asset metadata only (#63)."""
    for attempt in range(1, 4):  # ReadTimeouts on the Replicate POST are transient
        try:
            return run_with_timeout(GPT_IMAGE_2, build_payload(), job=job,
                                    tool="mint_image.py", estimate_usd=est_usd)
        except Exception as e:
            print(f"  ! replicate.run attempt {attempt} failed: {e}", file=sys.stderr)
            if attempt == 3:
                raise
            time.sleep(10)
    raise RuntimeError("unreachable")


def _read_bytes(item) -> bytes:
    """Normalize a Replicate output item to bytes. Handles FileOutput
    (.read()), objects with .url, and raw URL strings — the union of both
    backends' download paths, with generate_image.py's 3× retry."""
    for dl in range(1, 4):
        try:
            if hasattr(item, "read"):
                return item.read()
            if hasattr(item, "url"):
                return requests.get(item.url, timeout=300).content
            if isinstance(item, str):
                # Gateway assets can be absolute in staging/prod or root-relative
                # in local development. Resolve both through the same pinned
                # gateway-origin contract used by gateway.download(). Absolute
                # vendor URLs remain unchanged.
                return requests.get(gateway.resolve_asset_url(item), timeout=300).content
            raise RuntimeError(f"unexpected result type: {type(item)}")
        except Exception as e:
            print(f"  ! download attempt {dl} failed: {e}", file=sys.stderr)
            if dl == 3:
                raise
            time.sleep(5)
    raise RuntimeError("unreachable")


def _strip_chroma(png_path: Path) -> bool:
    """Apply the proven magenta colorkey → clean RGBA, in place.

    ffmpeg recipe from the four founding overlay sessions:
        colorkey=0xFF00FF:0.30:0.10,format=rgba
    Writes to a sibling .tmp and atomically replaces on success so a failed
    pass never leaves a 0-byte overlay behind.
    """
    tmp = png_path.with_name(png_path.name + ".chroma.tmp.png")
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(png_path),
         "-vf", CHROMA_COLORKEY, "-frames:v", "1", str(tmp)],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        print(f"  ! chroma-strip failed for {png_path.name} "
              f"(keeping un-keyed PNG): {r.stderr[-300:]}", file=sys.stderr)
        return False
    tmp.replace(png_path)
    return True


def _strip_chroma_bytes(data: bytes) -> tuple[bytes, bool]:
    """Transform bytes off-directory, then publish once through the pinned fd."""
    with tempfile.TemporaryDirectory(prefix="videoclaw-chroma-") as td:
        image = Path(td) / "image.png"
        image.write_bytes(data)
        keyed = _strip_chroma(image)
        return image.read_bytes(), keyed


# ── batch mode ───────────────────────────────────────────────────────────────
def _load_batch_specs(path: str) -> list[dict]:
    p = Path(path).expanduser()
    if not p.exists():
        raise SystemExit(f"--batch file does not exist: {p}")
    try:
        specs = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise SystemExit(f"--batch file is not valid JSON: {e}")
    if not isinstance(specs, list) or not specs:
        raise SystemExit("--batch file must be a non-empty JSON LIST of specs")
    for i, s in enumerate(specs, start=1):
        if not isinstance(s, dict) or not s.get("name") or not s.get("prompt"):
            raise SystemExit(f"--batch item {i} needs at least \"name\" and \"prompt\"")
        s["name"] = _safe_slot_name(s["name"], f"--batch item {i} name")
        if s.get("aspect") and s["aspect"] not in VALID_ASPECTS:
            raise SystemExit(f"--batch item {i}: aspect {s['aspect']} invalid "
                             f"(supported: {', '.join(VALID_ASPECTS)})")
        if s.get("quality") and s["quality"] not in VALID_QUALITY:
            raise SystemExit(f"--batch item {i}: quality {s['quality']} invalid")
        if s.get("background") and s["background"] not in VALID_BACKGROUND:
            raise SystemExit(f"--batch item {i}: background {s['background']} invalid")
        v = int(s.get("variants", 1))
        if v < 1 or v > MAX_VARIANTS:
            raise SystemExit(f"--batch item {i}: variants must be 1..{MAX_VARIANTS}")
    return specs


def _effective(args, spec: dict, do_chroma: bool) -> dict:
    """Merge one batch spec over the CLI-wide settings → the flat dict both
    submit paths consume. Applies the transparent-background guard per item
    (a spec-level "background": "transparent" must never reach the vendor —
    it fails AND bills); a rerouted item forces the chroma-strip so the
    written PNG is still transparent. Pure aside from the guard's stdout
    note — unit-tested offline."""
    background = spec.get("background") or args.background
    background, rerouted = _guard_background(
        background, args.output_format, label=f" (item {spec['name']})")
    if rerouted:
        print(_reroute_note(f" {spec['name']}:"))
    chroma = do_chroma or rerouted
    prompt = str(spec["prompt"])
    if chroma:
        prompt = prompt + CHROMA_PROMPT_SUFFIX
    references = list(spec.get("references") or args.reference)
    if len(references) > NANO_MAX_REFERENCES:
        raise SystemExit(
            f"--batch item {spec['name']}: at most {NANO_MAX_REFERENCES} "
            "reference images are supported")
    return {
        "name": str(spec["name"]),
        "prompt": prompt,
        "raw_prompt": str(spec["prompt"]),
        "aspect": spec.get("aspect") or args.aspect,
        "quality": spec.get("quality") or args.quality,
        "background": background,
        "chroma": chroma,
        "variants": int(spec.get("variants", 1)),
        "references": references,
        "moderation": args.moderation,
        "output_format": args.output_format,
        "output_compression": args.output_compression,
    }


def _gateway_model(model: str) -> str | None:
    """Return an allowlisted semantic override; None lets the gateway's
    rollback-aware default choose the rail for a new request."""
    if model == DEFAULT_MODEL:
        return None
    return GATEWAY_MODEL_IDS[model]


def _effective_resolved_model(
    model: str,
    default_override: str | None = None,
) -> str | None:
    """Resolved ledger identity for an explicit gateway request.

    A provider-neutral ``default`` call intentionally remains unknown here: the
    gateway owns deployment routing and its non-privileged response hides
    provider details. Explicit rails are fully reconstructible.
    """
    gateway_model = (
        default_override
        if model == DEFAULT_MODEL
        else _gateway_model(model)
    )
    return GATEWAY_MODEL_TO_RESOLVED.get(gateway_model)


def _gateway_params(effective: dict, model: str, variants: int) -> dict:
    """Build only the fields supported by the selected image contract.

    The default is intentionally Nano-shaped. A deployment rollback to GPT can
    still render with GPT defaults, but GPT-only quality/background/moderation
    controls are sent only when the caller explicitly selects the GPT rail.
    """
    params = {
        "aspect_ratio": effective["aspect"],
        "output_format": effective["output_format"],
        "number_of_images": variants,
    }
    if model == "gpt-image-2":
        params.update({
            "quality": effective["quality"],
            "background": effective["background"],
            "output_compression": effective["output_compression"],
            "moderation": effective["moderation"],
        })
    return params


def _variant_chunks(variants: int) -> list[tuple[int, int]]:
    """Return (zero-based output offset, count) chunks accepted by Nano."""
    return [
        (offset, min(NANO_MAX_IMAGES_PER_REQUEST, variants - offset))
        for offset in range(0, variants, NANO_MAX_IMAGES_PER_REQUEST)
    ]


def _gateway_items(
    effs: list[dict],
    role: str,
    model: str,
    default_override: str | None = None,
) -> tuple[list[dict], list[tuple[int, int]]]:
    """Expand logical items into provider-sized requests plus owner/offset map."""
    items: list[dict] = []
    ownership: list[tuple[int, int]] = []
    override = default_override if model == DEFAULT_MODEL else _gateway_model(model)
    ledger_model = _effective_resolved_model(model, default_override)
    payload_model = (
        "gpt-image-2"
        if model == DEFAULT_MODEL and override == GPT_IMAGE_2
        else model
    )
    for owner, effective in enumerate(effs):
        for offset, count in _variant_chunks(effective["variants"]):
            item = {
                "mode": role,
                "prompt": effective["prompt"],
                "quality": effective["quality"],
                "references": effective["references"],
                "params": _gateway_params(effective, payload_model, count),
            }
            if override is not None:
                item["model"] = override
            if ledger_model is not None:
                # Engine-private provenance. _Gateway.run_many never forwards
                # underscored fields; it copies this only to the local cost row.
                item["_ledger_model"] = ledger_model
            if "_delivery" in effective:
                item["_delivery"] = effective["_delivery"][offset:offset + count]
                # Images publish through note_output: a same-slot retake
                # replaces its still transactionally (_PinnedImagesDir).
                item["_replaces_existing"] = True
            items.append(item)
            ownership.append((owner, offset))
    return items, ownership


def _collapse_gateway_results(
    effs: list[dict],
    ownership: list[tuple[int, int]],
    chunk_results: list[dict],
) -> list[dict]:
    """Reassemble provider chunks without hiding partial failures.

    Successful assets retain their logical variant number even when an earlier
    chunk failed, so retries cannot overwrite or mislabel survivors.
    """
    grouped: list[dict] = [
        {"status": "succeeded", "assets": [], "_elapsed_s": 0.0,
         "_failures": [], "reconciliation_required": False}
        for _ in effs
    ]
    for result_index, (owner, offset) in enumerate(ownership):
        result = (
            chunk_results[result_index]
            if result_index < len(chunk_results)
            else {"status": "failed", "error": "gateway omitted a chunk result"}
        )
        target = grouped[owner]
        elapsed = result.get("_elapsed_s")
        if isinstance(elapsed, (int, float)):
            target["_elapsed_s"] = max(target["_elapsed_s"], float(elapsed))
        if result.get("status") == "succeeded":
            assets = list(result.get("assets") or [])
            expected = min(
                NANO_MAX_IMAGES_PER_REQUEST,
                effs[owner]["variants"] - offset,
            )
            for index, asset in enumerate(assets[:expected], start=1):
                target["assets"].append({
                    **asset,
                    "_variant_index": offset + index,
                })
            if len(assets) == expected:
                continue
            result = {
                "status": "failed",
                "error": (
                    "gateway returned "
                    f"{len(assets)} of {expected} requested images for a chunk"
                ),
            }
        target["status"] = result.get("status") or "failed"
        if result.get("rename_required"):
            target["rename_required"] = True  # an earlier result blocks this name
        if result.get("code") == REPEAT_REFUSED_CODE:
            target["declined"] = True  # not sent: the model already declined this exact request
        target["reconciliation_required"] = bool(
            target["reconciliation_required"]
            or result.get("reconciliation_required")
            or result.get("status") in {
                "running", "reconciling", "submission_unknown",
            }
        )
        detail = str(result.get("error") or "no detail")
        if result.get("agent_detail"):
            detail += f" — {result['agent_detail']}"
        target["_failures"].append(detail)
    for target in grouped:
        if target["_failures"]:
            target["error"] = "; ".join(target["_failures"])
        target.pop("_failures", None)
    return grouped


def _batch_progress(effs: list[dict], ownership: list[tuple[int, int]],
                    total: int):
    """run_many callback: print each request's outcome as soon as it ends
    (videoclaw-app#969), so a refusal is visible while the rest still run.
    Files are still written together when the batch ends."""
    finished = [0]

    def report(index: int, result: dict) -> None:
        owner, offset = ownership[index]
        effective = effs[owner]
        label = effective["name"]
        if effective["variants"] > NANO_MAX_IMAGES_PER_REQUEST:
            count = min(NANO_MAX_IMAGES_PER_REQUEST, effective["variants"] - offset)
            label += f" (variants {offset + 1}-{offset + count})"
        finished[0] += 1
        status = result.get("status")
        if status == "succeeded":
            line = f"✓ {label}: generated; saved when the batch ends"
        else:
            detail = str(result.get("error") or "no detail")
            if result.get("agent_detail"):
                detail += f" — {result['agent_detail']}"
            line = f"✗ {label}: {status}: {detail}"
        # flush: the host reads a pipe, where print() is block-buffered.
        print(f"  [{finished[0]}/{total} finished] {line}", flush=True)

    return report


def run_batch(args, job: Path, do_chroma: bool) -> int:
    """SUBMIT the whole batch, POLL it together (gateway mode) — nine stills
    cost roughly one still's wall clock instead of nine serial cliffs (live
    incident 2026-07-17: 9 seed_frames launched as 9 processes serialized and
    5 died on their step timeouts). Without a gateway key, only an explicitly
    selected GPT batch can use the sequential local development path. Per-item
    failures never kill the batch."""
    specs = _load_batch_specs(args.batch)
    effs = [_effective(args, s, do_chroma) for s in specs]
    for effective in effs:
        effective["references"] = [
            (
                reference
                if reference.startswith(("http://", "https://", "data:"))
                else str(resolve_job_input_path(reference, job))
            )
            for reference in effective["references"]
        ]

    outputs = _PinnedImagesDir(job)
    images_dir = outputs.path
    publication_names = {"_index.json"}
    for effective in effs:
        effective["_delivery"] = []
        for variant in range(1, effective["variants"] + 1):
            suffix = f"_v{variant}" if effective["variants"] > 1 else ""
            slot = f"{effective['name']}{suffix}"
            publication_names.add(f"{slot}.prompt.txt")
            publication_names.add(f"{slot}.{effective['output_format']}")
            effective["_delivery"].append(images_dir / f"{slot}.{effective['output_format']}")
    outputs.precheck(publication_names)

    n_imgs = sum(e["variants"] for e in effs)
    print(f"Generating {n_imgs} image(s) with {args.model}  role={args.role}  "
          f"(batch of {len(effs)})")
    print(f"  ⏱ batched: submitted together, polled together — expect ~2–4min "
          f"total, not {len(effs)}×. Run with a generous timeout (≥600s).",
          flush=True)

    started = time.perf_counter()
    effective_resolved_model: str | None = None
    if gateway.enabled():
        default_override = None
        items, ownership = _gateway_items(
            effs, args.role, args.model, default_override)
        effective_resolved_model = _effective_resolved_model(
            args.model, default_override)
        chunk_results = gateway.run_many(
            "mint_image", items, job=job, client_job=job.name,
            on_result=_batch_progress(effs, ownership, len(items)))
        results = _collapse_gateway_results(effs, ownership, chunk_results)
    else:
        if args.model != "gpt-image-2":
            raise SystemExit(
                "Nano Banana 2 requires the metered VideoClaw gateway. "
                "Configure VIDEOCLAW_API_KEY, or explicitly select "
                "--model gpt-image-2 for the legacy local-development rail.")
        results = []
        for e in effs:
            ns = argparse.Namespace(**{**vars(args), **{
                k: e[k] for k in ("aspect", "quality", "background",
                                  "variants", "moderation")}})
            t_item = time.perf_counter()
            try:
                out = _replicate_generate(
                    lambda: _build_payload(
                        ns, [_resolve_reference(r) for r in e["references"]],
                        e["prompt"]),
                    job, est_usd=_local_estimator(
                        args.role, e["quality"], e["aspect"]))
                results.append({"status": "succeeded", "_local_output": out,
                                "_elapsed_s": round(
                                    time.perf_counter() - t_item, 3)})
            except Exception as exc:
                results.append({"status": "failed", "error": str(exc)})

    outputs.verify()
    failed: list[str] = []
    success_logs: list[dict] = []
    delivered: list[tuple[dict, Path]] = []
    reconciling: list[str] = []
    on_its_way: list[str] = []
    rename: list[str] = []
    declined: list[str] = []
    # Fetch, transform and durably stage every paid image BEFORE taking the
    # per-job publication lock: downloads are network waits too (#273).
    fetched: list[tuple[dict, dict, list[tuple[object, str, Path, bytes, bool]]]] = []
    for e, res in zip(effs, results):
        if res.get("status") != "succeeded":
            unresolved = bool(res.get("reconciliation_required")) or res.get("status") in {
                "accepted_unknown", "running", "reconciling",
                "submission_unknown",
            }
            (on_its_way if res.get("status") == "pending_delivery"
             else rename if res.get("rename_required")
             else declined if res.get("declined")
             else reconciling if unresolved else failed).append(e["name"])
            msg = str(res.get("error", "no detail"))
            if res.get("agent_detail"):
                # the gateway's sanitized actionable core — what the vendor
                # actually rejected, so the agent can fix the params instead
                # of retrying the same mistake
                msg += f"\n      ↳ {res['agent_detail']}"
            print(f"  ✗ {e['name']}: {msg}", file=sys.stderr)
            if not res.get("assets"):
                continue
        output = res.get("_local_output")
        if output is None:
            output = list(res.get("assets", []))
        if not isinstance(output, list):
            output = [output]
        staged: list[tuple[object, str, Path, bytes, bool]] = []
        for i, item in enumerate(output, start=1):
            variant_index = (
                int(item.get("_variant_index", i))
                if isinstance(item, dict) else i
            )
            suffix = f"_v{variant_index}" if e["variants"] > 1 else ""
            slot = f"{e['name']}{suffix}"
            out_path = images_dir / f"{slot}.{e['output_format']}"
            source = item.get("url") if isinstance(item, dict) else item
            data = _read_bytes(source)
            keyed = False
            if e["chroma"] and out_path.suffix.lower() == ".png":
                data, keyed = _strip_chroma_bytes(data)
            if isinstance(item, dict):
                gateway.note_output(item, out_path, pending_bytes=data)
            staged.append((item, slot, out_path, data, keyed))
        fetched.append((e, res, staged))

    outputs.begin(publication_names)
    index: dict = outputs.read_json("_index.json")
    for e, res, staged in fetched:
        written: list[Path] = []
        for item, slot, out_path, data, keyed in staged:
            outputs.write_text(f"{slot}.prompt.txt", e["raw_prompt"])
            outputs.write_bytes(out_path.name, data)
            print(f"  ✓ {out_path.name} ({len(data) // 1024}KB)")
            index[slot] = {
                "file": str(out_path.relative_to(job)),
                "prompt_file": str((images_dir / f"{slot}.prompt.txt").relative_to(job)),
                "model": args.model,
                **({"resolved_model": effective_resolved_model}
                   if effective_resolved_model else {}),
                "role": args.role,
                "aspect": e["aspect"],
                "output_format": e["output_format"],
                "quality": e["quality"],
                "background": e["background"],
                "chroma_keyed": keyed,
                "references": [r if isinstance(r, str) else getattr(r, "name", "<file>")
                               for r in e["references"]],
            }
            written.append(out_path)
            if isinstance(item, dict):
                delivered.append((item, out_path))

        # images_generated is ASSET METADATA ONLY (#63): this item's cost is
        # booked exactly once, on its call row — gateway_call (gateway path)
        # or replicate_call (local path) — never here. duration_seconds is
        # this ITEM's own submit→terminal elapsed (from the batch client /
        # the local per-item timer), not the shared batch elapsed.
        success_logs.append({
            "tool": "mint_image.py", "event": "images_generated",
            "prompt": e["raw_prompt"],
            "duration_seconds": res.get("_elapsed_s"),
            "extra": {
                "usage_role": args.role,
                "model": args.model,
                **({"resolved_model": effective_resolved_model}
                   if effective_resolved_model else {}),
                "name": e["name"],
                # Reconciliation prices produced assets, not requested ones.
                # A failed provider chunk can leave stable-numbered survivors.
                "variants": len(written),
                "requested_variants": e["variants"],
                "aspect": e["aspect"],
                "output_format": e["output_format"],
                "quality": e["quality"],
                "background": e["background"],
                "chroma_keyed": e["chroma"],
                "batch": True,
                "files": [str(p.relative_to(job)) for p in written],
            },
        })

    outputs.write_text("_index.json", json.dumps(index, indent=2))
    for success_log in success_logs:
        outputs.log_success(**success_log)
    outputs.commit()
    try:
        for asset, destination in delivered:
            gateway.note_output(asset, destination)
    except GatewayAcceptedError as exc:
        print(f"Images were published, but their recovery record needs repair: {exc}", file=sys.stderr)
        return 1
    finally:
        outputs.close()
    duration = time.perf_counter() - started
    # Only items whose files were written count (videoclaw#294): unsettled or
    # already-claimed items are not written, and are not failures either.
    ok = len(effs) - len(failed) - len(reconciling) - len(on_its_way) - len(rename) - len(declined)
    print(f"\n{ok}/{len(effs)} batch item(s) written to {images_dir}/ in {duration:.1f}s")
    if failed:
        print(f"  ! failed: {', '.join(failed)} — re-run --batch with just "
              f"those items to retry", file=sys.stderr)
    if reconciling:
        print(
            f"  ! not written yet: {', '.join(reconciling)} — these were "
            "accepted and may already be finished and paid; the app will "
            f"deliver them to {images_dir.name}/ without another purchase. "
            "Do not re-run them; do not retry.",
            file=sys.stderr,
        )
    if on_its_way:
        print(
            f"  ! already on its way: {', '.join(on_its_way)} — an earlier "
            "paid request will deliver these; nothing was charged for them "
            "now. Do not re-run them; wait for the files.",
            file=sys.stderr,
        )
    if rename:
        print(
            f"  ! needs a new name: {', '.join(rename)} — an earlier paid "
            "result can't be delivered over the different file already at "
            "that name; nothing was charged now. Regenerate them under new "
            "names.",
            file=sys.stderr,
        )
    if declined:
        print(
            f"  ! not sent: {', '.join(declined)} — the model already declined "
            "these exact requests. Change the shot, prompt or reference, or "
            "pick a different model; don't re-run them unchanged.",
            file=sys.stderr,
        )
    if failed or reconciling or on_its_way or rename or declined:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)

    parser.add_argument("--role", required=True, choices=ROLES,
                        help="Image role. REQUIRED. Logged as usage_role.")
    parser.add_argument("--prompt", help="Text prompt for the image. Required "
                                         "unless --batch is given.")
    parser.add_argument("--batch",
                        help="JSON file: a LIST of {name, prompt, aspect?, "
                             "quality?, background?, variants?, references?} — "
                             "submit them together, poll them together (one "
                             "still's wall clock for the lot). Job-manifest "
                             "mode only; per-item failures don't kill the "
                             "batch. Mutually exclusive with "
                             "--prompt/--name/--output.")

    # Output target: job-manifest mode (--name) OR raw-path mode (--output).
    parser.add_argument("--name",
                        help="Slot name (e.g. hook_card). Becomes the filename under "
                             "<job_dir>/images/ and the _index.json key. Suffixed "
                             "_v1.._vN when --variants>1. Required unless --output is given.")
    parser.add_argument("--output",
                        help="Raw output path (gen_image.py parity). Writes exactly here "
                             "instead of <job_dir>/images/<name>.<ext>. Mutually exclusive "
                             "with --name. With --variants>1 the stem is suffixed _v1.._vN.")

    parser.add_argument("--reference", action="append", default=[],
                        help="URL or local path image input. Repeatable. Local files are "
                             "auto-uploaded by the SDK; any reference selects the edit endpoint.")
    parser.add_argument("--base-frame",
                        help="[role=cover] Chosen base frame to stylize. Alias for "
                             "--reference (the cover flow conditions on one frame).")

    parser.add_argument("--aspect", "--aspect-ratio", dest="aspect", default=None,
                        choices=VALID_ASPECTS,
                        help="Cross-rail aspect ratio: 1:1/3:2/2:3/4:3/3:4/16:9/9:16/auto. "
                             "Use 9:16 for native vertical (reel) stills. Default is the "
                             "per-role default (overlay→1:1, all others→2:3).")
    parser.add_argument("--variants", type=int, default=1,
                        help=f"Images in one call (1..{MAX_VARIANTS}). Suffixed _v1.._vN if >1.")
    parser.add_argument(
        "--model", default=DEFAULT_MODEL,
        choices=(DEFAULT_MODEL, "nano-banana-2", "gpt-image-2"),
        help=("Image rail. default uses the gateway rollback switch (Nano "
              "Banana 2 in Release 0.0.11); GPT remains an explicit A/B and "
              "local-development fallback."),
    )
    parser.add_argument("--quality", default="high", choices=VALID_QUALITY,
                        help="Generation quality (default high).")
    parser.add_argument("--background", default=None, choices=VALID_BACKGROUND,
                        help="'transparent' NEVER reaches the vendor as a model-specific "
                             "parameter: it auto-routes via "
                             "the chroma-strip (flat #FF00FF bg → colorkey to clean RGBA; "
                             "requires png). Default 'auto' (or 'opaque' for cover).")
    parser.add_argument("--output-format", default="png", choices=VALID_FORMATS,
                        help="png keeps transparency; webp is smallest; jpeg flattens alpha.")
    parser.add_argument("--output-compression", type=int, default=90,
                        help="0-100, only meaningful for webp/jpeg.")
    parser.add_argument("--moderation", default="auto", choices=("auto", "low"),
                        help="OpenAI content-moderation level.")

    # Overlay chroma-strip toggle (default ON for role=overlay, OFF otherwise).
    parser.add_argument("--strip-chroma", dest="strip_chroma", action="store_true", default=None,
                        help="Prompt for a flat #FF00FF magenta bg, then colorkey it to clean "
                             "RGBA. Default ON for role=overlay; ignored if --background "
                             "transparent (native alpha is used instead).")
    parser.add_argument("--no-strip-chroma", dest="strip_chroma", action="store_false",
                        help="Disable the magenta colorkey for an overlay.")

    args = parser.parse_args()

    # --base-frame is the cover-role alias for a single reference image.
    if args.base_frame:
        args.reference = [args.base_frame] + list(args.reference)

    # Output-target validation.
    if args.batch:
        if args.name or args.output or args.prompt:
            raise SystemExit("--batch is mutually exclusive with --prompt/--name/--output "
                             "(each batch item carries its own name + prompt).")
    else:
        if not args.prompt:
            raise SystemExit("--prompt is required (or use --batch for several images).")
        if bool(args.name) == bool(args.output):
            raise SystemExit("Provide exactly one of --name (job manifest mode) or --output (raw path mode).")
        if args.name:
            args.name = _safe_slot_name(args.name)

    # Per-role aspect default.
    if args.aspect is None:
        args.aspect = ROLE_DEFAULT_ASPECT[args.role]

    # Per-role background default: cover is opaque (it's a thumbnail), else auto.
    if args.background is None:
        args.background = "opaque" if args.role == "cover" else "auto"

    # strip_chroma default: ON for overlay, OFF for every other role.
    if args.strip_chroma is None:
        args.strip_chroma = (args.role == "overlay")
    if args.strip_chroma and args.role != "overlay":
        print(f"  [note] --strip-chroma requested for role={args.role}; the magenta "
              f"colorkey is an overlay technique but will still run.")

    # Validation parity with the absorbed backends.
    if args.variants < 1 or args.variants > MAX_VARIANTS:
        raise SystemExit(f"--variants must be 1..{MAX_VARIANTS}")
    if args.aspect not in VALID_ASPECTS:
        raise SystemExit(
            f"--aspect {args.aspect} invalid. Supported: {', '.join(VALID_ASPECTS)}")

    # ⛔ Never send a model-specific background=transparent assumption. The
    # legacy deployment rejects it and a failed prediction may still bill. A request
    # auto-routes through the chroma-strip (flat #FF00FF bg → colorkey to
    # RGBA), so the written PNG is still transparent; non-PNG output fails
    # FAST here, before any spend. Batch specs get the same guard per item
    # inside _effective().
    args.background, rerouted = _guard_background(args.background,
                                                  args.output_format)
    if rerouted:
        print(_reroute_note())
    do_chroma = args.strip_chroma or rerouted

    job = resolve_job_dir(args.job)
    args.reference = [
        (
            reference
            if reference.startswith(("http://", "https://", "data:"))
            else str(resolve_job_input_path(reference, job))
        )
        for reference in args.reference
    ]
    if args.batch:
        args.batch = str(resolve_job_input_path(args.batch, job))
    if args.output:
        try:
            args.output = str(resolve_job_output_path(args.output, job))
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc

    if args.batch:
        return run_batch(args, job, do_chroma)

    # Build the effective prompt (append the magenta instruction when keying).
    prompt = args.prompt
    if do_chroma:
        prompt = prompt + CHROMA_PROMPT_SUFFIX

    # Resolve the output directory / index (job mode only).
    if args.name:
        outputs = _PinnedImagesDir(job)
        images_dir = outputs.path
        publication_names = {"_index.json"}
        for variant in range(1, args.variants + 1):
            suffix = f"_v{variant}" if args.variants > 1 else ""
            slot = f"{args.name}{suffix}"
            publication_names.add(f"{slot}.prompt.txt")
            publication_names.add(f"{slot}.{args.output_format}")
        outputs.precheck(publication_names)
    else:
        out_path_base = Path(args.output).expanduser()
        out_path_base.parent.mkdir(parents=True, exist_ok=True)
        # In raw mode the requested suffix wins for output_format inference,
        # but we honour --output-format for what we actually write.
    index: dict = {}

    if len(args.reference) > NANO_MAX_REFERENCES:
        raise SystemExit(
            f"at most {NANO_MAX_REFERENCES} reference images are supported")
    # Gateway uploads paths itself. Do not open local references eagerly: that
    # leaked one file descriptor per reference on the normal app path. The
    # explicit local GPT fallback resolves handles only inside its branch.
    references: list = list(args.reference)

    print(f"Generating {args.variants} image(s) with {args.model}  role={args.role}")
    print(f"  aspect={args.aspect}  fmt={args.output_format}  quality={args.quality}  bg={args.background}", end="")
    print(f"  strip_chroma={'on' if do_chroma else 'off'}")
    timing = (
        "explicit GPT rail is typically ~90–130s"
        if args.model == "gpt-image-2" else
        "Nano default is normally seconds"
    )
    print(f"  ⏱ {timing}; keep a ≥300s safety timeout; several stills → --batch",
          flush=True)
    if references:
        print(f"  references: {len(references)}")

    start = time.perf_counter()
    output = None
    partial_error: str | None = None
    effective_resolved_model: str | None = None
    if gateway.enabled():
        # job= makes gateway.run write the canonical gateway_call cost row —
        # the ONE carrier for this path (#63; it also sets client_job from the
        # job dir). Review round 1 BLOCKING-1: without it, run() logs nothing
        # and this PR's removal of estimate_usd from images_generated would
        # have left single-mode mints with NO cost record at all.
        output_base = images_dir / f"{args.name}.{args.output_format}" if args.name else out_path_base
        effective = {
            "prompt": prompt,
            "references": list(args.reference),
            "aspect": args.aspect,
            "quality": args.quality,
            "background": args.background,
            "output_format": args.output_format,
            "output_compression": args.output_compression,
            "moderation": args.moderation,
            "variants": args.variants,
            "_delivery": [
                output_base.with_name(output_base.stem +
                    (f"_v{i}" if args.variants > 1 else "") + output_base.suffix)
                for i in range(1, args.variants + 1)
            ],
        }
        if args.variants <= NANO_MAX_IMAGES_PER_REQUEST:
            override = _gateway_model(args.model)
            payload_model = (
                "gpt-image-2"
                if args.model == DEFAULT_MODEL and override == GPT_IMAGE_2
                else args.model
            )
            effective_resolved_model = _effective_resolved_model(
                args.model, override)
            res = gateway.run(
                "mint_image", mode=args.role, prompt=prompt,
                quality=args.quality,
                references=list(args.reference),
                job=job,
                params=_gateway_params(effective, payload_model, args.variants),
                _ledger_model=effective_resolved_model,
                _delivery=effective["_delivery"],
                _replaces_existing=True,
                **({"model": override} if override is not None else {}),
            )
        else:
            default_override = None
            items, ownership = _gateway_items(
                [effective], args.role, args.model, default_override)
            effective_resolved_model = _effective_resolved_model(
                args.model, default_override)
            chunks = gateway.run_many("mint_image", items, job=job)
            res = _collapse_gateway_results(
                [effective], ownership, chunks)[0]
            if res.get("status") != "succeeded":
                unresolved = (res.get("reconciliation_required")
                              or res.get("status") == "pending_delivery")
                suffix = (
                    " The unfinished chunks are paid or already on their way; "
                    "the app delivers them. Do not retry."
                    if unresolved else
                    " Successful variants were preserved; retry only after "
                    "reviewing the named outputs."
                )
                partial_error = (
                    f"chunked mint_image was partial: {res.get('error')}."
                    f"{suffix}")
                print(f"  ! {partial_error}", file=sys.stderr)
        output = list(res.get("assets", []))
    else:
        if args.model != "gpt-image-2":
            raise SystemExit(
                "Nano Banana 2 requires the metered VideoClaw gateway. "
                "Configure VIDEOCLAW_API_KEY, or explicitly select "
                "--model gpt-image-2 for the legacy local-development rail.")
        references = [_resolve_reference(r) for r in args.reference]
        payload = _build_payload(args, references, prompt)
        first = [payload]   # first attempt reuses the payload built above

        def _fresh_payload():
            if first:
                return first.pop()
            # re-resolve references (file handles exhausted after a failed attempt)
            return _build_payload(args,
                                  [_resolve_reference(r) for r in args.reference],
                                  prompt)
        output = _replicate_generate(
            _fresh_payload,
            job,
            est_usd=_local_estimator(args.role, args.quality, args.aspect),
        )
    duration = time.perf_counter() - start

    if args.name:
        outputs.verify()

    if not isinstance(output, list):
        output = [output]

    # Fetch, transform and durably stage the paid bytes BEFORE the per-job
    # publication lock: the download is a network wait too (#273).
    staged: list[tuple[object, str, Path, Path, bytes, bool]] = []
    for i, item in enumerate(output, start=1):
        variant_index = (
            int(item.get("_variant_index", i))
            if isinstance(item, dict) else i
        )
        suffix = f"_v{variant_index}" if args.variants > 1 else ""
        if args.name:
            slot = f"{args.name}{suffix}"
            out_path = images_dir / f"{slot}.{args.output_format}"
            prompt_path = images_dir / f"{slot}.prompt.txt"
        else:
            # Raw mode: insert the variant suffix before the extension.
            slot = out_path_base.stem + suffix
            out_path = out_path_base.with_name(slot + out_path_base.suffix)
            prompt_path = out_path.with_suffix(out_path.suffix + ".prompt.txt")

        source = item.get("url") if isinstance(item, dict) else item
        data = _read_bytes(source)

        # Overlay chroma-strip post-process (PNG only — needs an alpha channel).
        keyed = False
        if do_chroma:
            if out_path.suffix.lower() == ".png":
                data, keyed = _strip_chroma_bytes(data)
                if keyed:
                    print(f"    ↳ chroma-keyed {CHROMA_HEX} → clean RGBA ({len(data) // 1024}KB)")
            else:
                print(f"    ! --strip-chroma needs a PNG (got {out_path.suffix}); skipping colorkey",
                      file=sys.stderr)

        if isinstance(item, dict):
            gateway.note_output(item, out_path, pending_bytes=data)
        staged.append((item, slot, out_path, prompt_path, data, keyed))

    if args.name:
        outputs.begin(publication_names)
        index = outputs.read_json("_index.json")
    written: list[Path] = []
    delivered: list[tuple[dict, Path]] = []
    for item, slot, out_path, prompt_path, data, keyed in staged:
        if args.name:
            outputs.write_text(prompt_path.name, args.prompt)
            outputs.write_bytes(out_path.name, data)
        else:
            prompt_path.write_text(args.prompt)
            out_path.write_bytes(data)
        print(f"  ✓ {out_path.name} ({len(data) // 1024}KB)")

        if args.name:
            index[slot] = {
                "file": str(out_path.relative_to(job)),
                "prompt_file": str(prompt_path.relative_to(job)),
                "model": args.model,
                **({"resolved_model": effective_resolved_model}
                   if effective_resolved_model else {}),
                "role": args.role,
                "aspect": args.aspect,
                "output_format": args.output_format,
                "quality": args.quality,
                "background": args.background,
                "chroma_keyed": keyed,
                "references": [r if isinstance(r, str) else getattr(r, "name", "<file>")
                               for r in references],
            }
        written.append(out_path)
        if isinstance(item, dict):
            delivered.append((item, out_path))

    if args.name:
        outputs.write_text("_index.json", json.dumps(index, indent=2))

    # images_generated is ASSET METADATA ONLY (#63): the cost of this call is
    # booked exactly once, on its call row — gateway_call (gateway mode, the
    # metered figure) or replicate_call (local mode, table-priced per
    # delivered image via _local_estimator) — never here.
    success_log = {
        "tool": "mint_image.py", "event": "images_generated",
        "prompt": args.prompt,
        "duration_seconds": duration,
        "extra": {
            "usage_role": args.role,
            "model": args.model,
            **({"resolved_model": effective_resolved_model}
               if effective_resolved_model else {}),
            "name": args.name,
            "variants": len(written),
            "requested_variants": args.variants,
            "aspect": args.aspect,
            "output_format": args.output_format,
            "quality": args.quality,
            "background": args.background,
            "chroma_keyed": do_chroma,
            "files": [str(p) if args.output else str(p.relative_to(job)) for p in written],
        },
    }
    if args.name:
        outputs.log_success(**success_log)
        outputs.commit()
    else:
        log_event(job, **success_log)
    try:
        for asset, destination in delivered:
            gateway.note_output(asset, destination)
    except GatewayAcceptedError as exc:
        print(f"Images were published, but their recovery record needs repair: {exc}", file=sys.stderr)
        return 1
    finally:
        if args.name:
            outputs.close()

    where = images_dir if args.name else out_path_base.parent
    print(f"\n{len(written)} image(s) written to {where}/ in {duration:.1f}s")
    return 1 if partial_error else 0


if __name__ == "__main__":
    raise SystemExit(exit_on_repeat_refusal(main))
