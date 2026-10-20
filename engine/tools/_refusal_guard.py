"""Refuse an unchanged re-submit of a request the model already declined (videoclaw#341).

When a paid generation comes back as a content-policy, NSFW or likeness refusal,
the video's folder keeps a fingerprint of that request in ``.refused_requests.json``:
the route (tool, model, engine, quality, safety settings), the mode, the
normalised text of the request (its prompt), and the sha256 of every input
media file. The prompt itself is never stored. A later paid submit in the same
video with the same fingerprint is refused before the gateway client makes any
call for it (no upload, operation lookup, approval or spend); a changed prompt,
reference or model is a new fingerprint and goes through.

When one named output has been declined for two different requests, each later
attempt at it prints a stop line asking the agent to check with the user. That
line is advice; it never blocks.

Only refusals are remembered. Every other failure, transient or not, keeps
today's behaviour, and a guard that cannot read or write its file never blocks
paid work.
"""
from __future__ import annotations

import hashlib
import json
import os
import _compat_dirfd as _dfd  # port: dir_fd/O_DIRECTORY emulation on Windows (POSIX: same os functions)
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable, Iterable

STORE_NAME = ".refused_requests.json"
SCHEMA = "videoclaw.refused-requests/v1"
# The engine's content generators. Other gateway tools are never guarded.
GUARDED_TOOLS = frozenset({"mint_video", "mint_image", "model_call"})
REPEAT_REFUSED_CODE = "REPEAT_OF_DECLINED_REQUEST"
# Exit status of a command whose paid request was refused here, before spend.
REPEAT_REFUSED_EXIT = 3
# Refused requests for one output before the stop line appears.
SHOT_STOP_AFTER = 2

_MAX_REQUESTS = 256
_MAX_PER_OUTPUT = 16
_MAX_STORE_BYTES = 1 << 20
_LOCK_TIMEOUT_S = 5.0
# Output-format strings that do not change what the model is asked to depict.
# Every other text value counts, so a changed caption, lyric or line of
# dialogue is a changed request even on models whose schema is unknown here.
_FORMAT_KEYS = frozenset({
    "aspect", "aspect_ratio", "resolution", "output_format", "format", "background",
    "size", "fps", "output_compression", "mime_type", "response_format",
})
# Settings that change how strictly the provider moderates count even when
# they are not text (e.g. enable_safety_checker: false).
_SAFETY_KEY = re.compile(r"moderation|safety|nsfw|person_generation", re.IGNORECASE)
# backend#339's typed refusal kinds that mean "the content was declined".
_POLICY_KINDS = frozenset({"content_policy", "nsfw", "likeness"})
# The gateway's own classification line for a policy refusal
# (videoclaw-backend jobs._friendly_error).
_GATEWAY_POLICY_LINE = re.compile(r"\bdeclined this\b.{0,80}\(content policy\)", re.IGNORECASE | re.DOTALL)
# Provider wording that only a content refusal uses. A bare "moderation" is not
# enough: a rejected `moderation` parameter is an input error, not a refusal.
_POLICY_TEXT = re.compile(
    r"content[ _-]?polic|policy (?:refusal|violation)|\bnsfw\b|"
    r"safety (?:filter|system|check|policy)|moderation (?:filter|system|policy|check)|"
    r"failed moderation|(?:flagged|blocked|rejected|refused) by (?:the )?(?:safety|moderation)",
    re.IGNORECASE)


class Guarded:
    """One paid request the guard is watching."""

    __slots__ = ("job", "fingerprint", "output")

    def __init__(self, job: Path, fingerprint: str, output: str | None):
        self.job = job
        self.fingerprint = fingerprint
        self.output = output


def file_sha256(path: Path | str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normal_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _media_id(value: str, digest: Callable[[str], str | None], *, local: bool) -> str | None:
    """A stable identity for one media string, or None when it is not media."""
    known = digest(value)
    if known:
        return f"sha256:{known}"
    if value.startswith(("http://", "https://")):
        return f"url:{value}"
    if value.startswith("data:"):
        return "sha256:" + hashlib.sha256(value.encode("utf8")).hexdigest()
    if value.startswith("upload:"):
        return value
    if local:
        # A local reference the gateway client will upload for this request.
        return f"sha256:{file_sha256(value)}"
    return None


def _walk(value: Any, path: str, digest: Callable[[str], str | None],
          texts: dict, media: dict) -> None:
    if isinstance(value, dict):
        for key in sorted(value, key=str):
            item = value[key]
            name = str(key)
            child = f"{path}.{name}"
            if _SAFETY_KEY.search(name) and isinstance(item, (str, int, float, bool)):
                texts[child] = item
            elif name in _FORMAT_KEYS and isinstance(item, str):
                continue
            else:
                _walk(item, child, digest, texts, media)
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _walk(item, f"{path}[{index}]", digest, texts, media)
    elif isinstance(value, str):
        identity = _media_id(value, digest, local=False)
        if identity is not None:
            media[path] = identity
        else:
            texts[path] = _normal_text(value)


def fingerprint(tool: str, *, mode: str | None, route: dict, params: dict | None,
                prompt: str | None, references: Iterable | None,
                digest: Callable[[str], str | None]) -> str:
    """The request's identity for this guard: route, mode, text and media bytes.

    Numbers and booleans (duration, seed, image count) and output-format
    strings are left out, so re-running the declined content with another seed
    or length is still the same request.
    """
    texts: dict = {}
    media: dict = {}
    if isinstance(prompt, str):
        texts["prompt"] = _normal_text(prompt)
    _walk(params or {}, "params", digest, texts, media)
    for index, reference in enumerate(references or []):
        media[f"references[{index}]"] = _media_id(str(reference), digest, local=True)
    document = {
        "v": 1, "tool": tool, "mode": mode or "",
        "route": {key: str(value) for key, value in sorted(route.items()) if value not in (None, "")},
        "text": texts, "media": media,
    }
    encoded = json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf8")).hexdigest()


def _output_key(job: Path, delivery: list | None) -> str | None:
    """The named output a request fills (``clips/<name>``), when it has one."""
    if not delivery:
        return None
    first = Path(delivery[0])
    if first.is_absolute():
        try:
            first = first.resolve().relative_to(job.resolve())
        except ValueError:
            first = Path(first.name)
    return first.with_suffix("").as_posix()


def prepare(tool: str, job: Path | str | None, *, mode: str | None = None,
            params: dict | None = None, prompt: str | None = None,
            references: Iterable | None = None, route: dict | None = None,
            delivery: list | None = None,
            digest: Callable[[str], str | None] = lambda _: None) -> Guarded | None:
    """Fingerprint one paid request; None when the guard does not apply or cannot."""
    if tool not in GUARDED_TOOLS or job is None:
        return None
    try:
        job_dir = Path(job)
        if not job_dir.is_dir():
            return None
        return Guarded(job_dir, fingerprint(tool, mode=mode, route=route or {}, params=params,
                                            prompt=prompt, references=references, digest=digest),
                       _output_key(job_dir, delivery))
    except Exception:  # the guard fails open, never blocking paid work
        return None


# -- the store ---------------------------------------------------------------

def _empty() -> dict:
    return {"schema": SCHEMA, "requests": {}, "outputs": {}}


def _load_at(job_fd: int) -> dict:
    try:
        fd = _dfd.open(STORE_NAME, os.O_RDONLY | _dfd.O_NOFOLLOW | _dfd.O_CLOEXEC, dir_fd=job_fd)
    except FileNotFoundError:
        return _empty()
    with os.fdopen(fd, "rb") as handle:
        raw = handle.read(_MAX_STORE_BYTES + 1)
    try:
        state = json.loads(raw) if len(raw) <= _MAX_STORE_BYTES else None
    except ValueError:
        state = None
    if (not isinstance(state, dict) or state.get("schema") != SCHEMA
            or not isinstance(state.get("requests"), dict) or not isinstance(state.get("outputs"), dict)):
        return _empty()
    return state


def _open_job(job: Path) -> int:
    return _dfd.open(job, os.O_RDONLY | _dfd.O_DIRECTORY | _dfd.O_CLOEXEC)


def _load(job: Path) -> dict:
    fd = _open_job(job)
    try:
        return _load_at(fd)
    finally:
        _dfd.close(fd)


def _update(job: Path, change: Callable[[dict], None]) -> dict:
    """Read, change and atomically replace the store under the job lock."""
    from log import _replace_at, job_lock_at
    fd = _open_job(job)
    try:
        with job_lock_at(fd, timeout=_LOCK_TIMEOUT_S):
            state = _load_at(fd)
            change(state)
            requests = state["requests"]
            if len(requests) > _MAX_REQUESTS:
                oldest = sorted(requests, key=lambda key: str((requests[key] or {}).get("at", "")))
                for key in oldest[:len(requests) - _MAX_REQUESTS]:
                    del requests[key]
            _replace_at(fd, STORE_NAME, (json.dumps(state, indent=1, sort_keys=True) + "\n").encode("utf8"))
            return state
    finally:
        _dfd.close(fd)


def _refused_count(state: dict, output: str | None) -> int:
    seen = state["outputs"].get(output) if output else None
    return len(seen) if isinstance(seen, list) else 0


def stop_line(output: str, count: int) -> str:
    return (f"STOP: the model has declined {output} for {count} different requests on content "
            "grounds. Don't try this shot again on your own: tell the user what was declined and "
            "ask the user how they want to proceed (a different shot, prompt, reference or model).")


def blocked_message(reason: str | None) -> str:
    detail = f" ({reason})" if reason else ""
    return (f"This exact request was already declined by the model's content policy{detail}. "
            "Change the shot, prompt or reference, or pick a different model; "
            "don't re-run it unchanged.")


def repeat_message(guarded: Guarded | None) -> str | None:
    """The refusal for an unchanged re-submit, else None (printing any stop line)."""
    if guarded is None:
        return None
    try:
        state = _load(guarded.job)
        entry = state["requests"].get(guarded.fingerprint)
        if entry is not None:
            reason = entry.get("reason") if isinstance(entry, dict) else None
            return blocked_message(reason if isinstance(reason, str) else None)
        count = _refused_count(state, guarded.output)
    except Exception:  # an unreadable store never blocks paid work
        return None
    if count >= SHOT_STOP_AFTER:
        print(stop_line(guarded.output, count), file=sys.stderr, flush=True)
    return None


# -- what counts as a refusal -------------------------------------------------

def _clean(text: Any, limit: int = 240) -> str:
    if not isinstance(text, str):
        return ""
    printable = "".join(char if not unicodedata.category(char).startswith("C") else " " for char in text)
    return " ".join(printable.split())[:limit].rstrip(" .")


def _typed_reason(refusal: dict) -> str | None:
    kind = refusal.get("kind")
    if kind not in _POLICY_KINDS:
        return None
    reason = _clean(refusal.get("reason"))
    if kind == "content_policy":
        return reason
    return f"{kind}: {reason}" if reason else kind


def refusal_reason(outcome: Any) -> str | None:
    """The reason (possibly "") a paid outcome was a content refusal, else None.

    Prefers backend#339's typed ``refusal``; without it, the gateway's existing
    policy line or unmistakable refusal wording in its sanitized detail.
    """
    if isinstance(outcome, dict):
        result, detail = outcome, {}
    else:
        result = getattr(outcome, "result", None)
        detail = getattr(outcome, "detail", None)
        detail = detail if isinstance(detail, dict) else {}
    if not isinstance(result, dict):
        result = {}
    if result.get("not_submitted") is True or detail.get("not_submitted") is True:
        return None  # Never reached the model.
    typed = result.get("refusal", detail.get("refusal"))
    if isinstance(typed, dict) and isinstance(typed.get("kind"), str):
        return _typed_reason(typed)
    if result.get("status") != "failed":
        return None
    failure = result.get("failure")
    if isinstance(failure, dict) and failure.get("transient") is True:
        return None
    error, agent = result.get("error"), result.get("agent_detail")
    texts = [text for text in (error, agent) if isinstance(text, str)]
    if not any(_GATEWAY_POLICY_LINE.search(text) or _POLICY_TEXT.search(text) for text in texts):
        return None
    return _clean(agent) if isinstance(agent, str) and _POLICY_TEXT.search(agent) else ""


def note(guarded: Guarded | None, outcome: Any) -> None:
    """Remember a refused request; any other outcome changes nothing.

    Never raises: callers re-raise the original failure right after."""
    if guarded is None:
        return
    try:
        reason = refusal_reason(outcome)
    except Exception:
        return
    if reason is None:
        return

    def remember(state: dict) -> None:
        entry = state["requests"].get(guarded.fingerprint)
        entry = entry if isinstance(entry, dict) else {}
        state["requests"][guarded.fingerprint] = {
            "reason": reason or entry.get("reason") or "",
            "output": guarded.output,
            "refusals": int(entry.get("refusals") or 0) + 1,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if guarded.output:
            seen = state["outputs"].get(guarded.output)
            seen = [item for item in seen if isinstance(item, str)] if isinstance(seen, list) else []
            if guarded.fingerprint not in seen:
                seen.append(guarded.fingerprint)
            state["outputs"][guarded.output] = seen[-_MAX_PER_OUTPUT:]

    try:
        state = _update(guarded.job, remember)
        count = _refused_count(state, guarded.output)
    except Exception:  # best effort: a lost record allows one more refused attempt
        return
    if count >= SHOT_STOP_AFTER:
        print(stop_line(guarded.output, count), file=sys.stderr, flush=True)
