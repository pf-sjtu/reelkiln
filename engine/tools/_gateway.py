"""Gateway client — routes paid vendor calls through videoclaw-backend.

DUAL MODE: if VIDEOCLAW_API_KEY is set, tools call the gateway (one key, spend
metered server-side); if absent, tools use their raw vendor keys exactly as
before. Each tool's vendor-I/O function branches on `gateway.enabled()`.

    from _gateway import gateway
    if gateway.enabled():
        result = gateway.run("mint_video", mode="insert",
                             prompt="a hand places the card on {ref:1}",
                             references=[gateway.upload(mat_png)],
                             params={"duration": 5, "aspect_ratio": "9:16"},
                             job=job_dir)   # cost events land in run.log.jsonl
        gateway.download(result["assets"][0]["url"], out_path)

References: pass local Paths (auto-uploaded via signed GCS URLs — bytes never
transit the gateway) or https URLs. Prompts cite references as {ref:1}, {ref:2}…
— the gateway rewrites to whatever engine it routes to.
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import signal
import sys
import time
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit, parse_qs

import requests

import _refusal_guard

DEFAULT_URL = "https://videoclaw-gw-650303209435.us-central1.run.app"
CANONICAL_URL_VAR = "VIDEOCLAW_GATEWAY_URL"
DEPRECATED_URL_VAR = "VIDEOCLAW_GW_URL"

_alias_warned = False


def resolve_url() -> str:
    """Gateway base URL: canonical VIDEOCLAW_GATEWAY_URL wins; the old
    VIDEOCLAW_GW_URL is a deprecated alias (honored, with one stderr notice per
    process); else the prod DEFAULT_URL. doctor.py imports this so its health
    check can never target a different gateway than the real tools do."""
    global _alias_warned
    canonical = os.environ.get(CANONICAL_URL_VAR)
    if canonical:
        return canonical.rstrip("/")
    alias = os.environ.get(DEPRECATED_URL_VAR)
    if alias:
        if not _alias_warned:
            _alias_warned = True
            sys.stderr.write(
                f"[deprecation] {DEPRECATED_URL_VAR} is renamed "
                f"{CANONICAL_URL_VAR} — rename it in your .env; the old name "
                "will stop working.\n"
            )
        return alias.rstrip("/")
    return DEFAULT_URL.rstrip("/")
POLL_SECONDS = 5.0
IN_PROGRESS_STATUSES = frozenset({"queued", "running"})


def _operation_unfinished(result: dict) -> bool:
    """Durable-operation wait only (videoclaw#268): the provider finished and the
    gateway is settling its bill; the client waits up to timeout_s for the same
    operation's terminal result. ``support_needed`` and any
    other reconciling state return unresolved. Legacy job polling keeps
    IN_PROGRESS_STATUSES; there ``reconciling`` is an unconfirmed cancellation."""
    return result.get("status") in IN_PROGRESS_STATUSES or (
        result.get("status") == "reconciling"
        and result.get("result_reconciliation_state") == "pending")


def _settling_note(res: dict) -> str:
    if res.get("settlement_state") == "support_needed":
        return ("billing: the provider has not reported this bill; the reserved amount stays held "
                "until support settles it. Do not re-run it to fix billing.")
    return ("billing: pending; it settles to the provider's actual bill, at most the amount "
            "already reserved. The app records the final charge.")


class _StaleOperationRead(ValueError):
    """A read issued before another collector saved this operation's terminal result."""
# Durable operations accept a finished outcome whose bill is still settling
# (videoclaw-backend#311). Only they can log the final charge later, so the
# legacy job path never sends this.
PENDING_SETTLEMENT = {"X-VideoClaw-Pending-Settlement": "v1"}
# Client-side bound on batch submissions in flight at once (run_many). The
# gateway's own per-vendor cap is the pacing safety net; this just keeps one
# engine process from queueing an unbounded pile server-side.
MAX_INFLIGHT = int(os.environ.get("VIDEOCLAW_GW_MAX_INFLIGHT", "6"))
# Bounded in-place retry for a POST the gateway proves it never submitted and
# declares retryable — transient admission backpressure under concurrency
# (videoclaw#230). The deadline stays bounded: this holds one tool call open, and
# exhaustion is a temporary-busy refusal rather than a failed generation. It is
# long enough to honour a normal 56-60s provider cooldown (`retry_after_s`,
# videoclaw#261) and still leave room for the replayed attempt itself.
ADMISSION_RETRY_SECONDS = 120.0
ADMISSION_RETRY_BACKOFF_SECONDS = 0.5
ADMISSION_RETRY_BACKOFF_MAX_SECONDS = 4.0
# Shortest retry attempt worth issuing. A busy admission refusal comes back in
# milliseconds, so this is generous; its job is to never issue an attempt so
# clipped that a normally-served response would be cut off and downgraded to
# accepted-unknown just to honour the deadline.
ADMISSION_RETRY_MIN_ATTEMPT_SECONDS = 1.0
# Ceiling for a single gateway request, long enough for a synchronous paid
# generation. Admission retries run under the remaining window instead.
REQUEST_TIMEOUT_SECONDS = 900

# The end-of-render review (videoclaw#265) is paid by VideoClaw's house
# account, never the user's credits (videoclaw-backend#287, PR #289). The
# gateway recognises it only as this exact plain request: see harness_review().
HARNESS_PURPOSE_HEADER = "X-VideoClaw-Purpose"
HARNESS_REVIEW_PURPOSE = "harness-review"
HARNESS_REVIEW_ROLE = "review_full"
HARNESS_REVIEW_SKIPPED = "HARNESS_REVIEW_SKIPPED"
HARNESS_REVIEW_TEMPLATE = "final_review/v1"
# Its own route, so no backend revision that predates it can bill it to the user.
HARNESS_REVIEW_PATH = "/v1/harness/review"
HARNESS_REVIEW_MAX_VIDEO_BYTES = 24 * 1024 * 1024
HARNESS_REVIEW_VIDEO_SUFFIXES = frozenset({".mp4", ".mov"})
HARNESS_REVIEW_MAX_OUTPUT_TOKENS = 16384
# Context limits of the server-owned review (videoclaw-backend#289).
HARNESS_CONTEXT_DOCS = ("script", "style_directives", "promise")
HARNESS_CONTEXT_DOC_BYTES = 12_000
HARNESS_CONTEXT_STRING_BYTES = 4_000
HARNESS_CONTEXT_KEY_CHARS = 80
HARNESS_CONTEXT_DEPTH = 8
HARNESS_CONTEXT_ITEMS = 400
HARNESS_EDIT_KINDS = frozenset({"pre_roll", "punch_in", "padding", "still", "silence"})
HARNESS_MAX_EDITS = 40
HARNESS_EDIT_REASON_CHARS = 120


def _context_value_ok(value: Any, depth: int) -> bool:
    if depth > HARNESS_CONTEXT_DEPTH:
        return False
    if isinstance(value, bool) or value is None:
        return True
    if isinstance(value, (int, float)):
        return isinstance(value, int) or value == value and value not in (float("inf"), float("-inf"))
    if isinstance(value, str):
        return len(value.encode("utf-8")) <= HARNESS_CONTEXT_STRING_BYTES
    if isinstance(value, list):
        return len(value) <= HARNESS_CONTEXT_ITEMS and all(
            _context_value_ok(item, depth + 1) for item in value)
    if isinstance(value, dict):
        return len(value) <= HARNESS_CONTEXT_ITEMS and all(
            isinstance(key, str) and len(key) <= HARNESS_CONTEXT_KEY_CHARS
            and _context_value_ok(item, depth + 1) for key, item in value.items())
    return False


def harness_context_doc_ok(document: Any) -> bool:
    """A context document the server accepts whole (it refuses, never truncates)."""
    if not isinstance(document, dict) or not _context_value_ok(document, 1):
        return False
    try:
        compact = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        return False
    return len(compact.encode("utf-8")) <= HARNESS_CONTEXT_DOC_BYTES


def harness_edit_ok(edit: Any) -> bool:
    if not isinstance(edit, dict) or set(edit) != {"kind", "start_sec", "end_sec", "reason"}:
        return False
    numbers = [edit["start_sec"], edit["end_sec"]]
    return (
        edit["kind"] in HARNESS_EDIT_KINDS
        and all(isinstance(n, (int, float)) and not isinstance(n, bool)
                and n == n and n not in (float("inf"), float("-inf")) for n in numbers)
        and isinstance(edit["reason"], str) and len(edit["reason"]) <= HARNESS_EDIT_REASON_CHARS
    )


def harness_context_ok(context: Any) -> bool:
    if not isinstance(context, dict) or not set(context) <= {*HARNESS_CONTEXT_DOCS, "declared_edits"}:
        return False
    if not all(harness_context_doc_ok(context[name]) for name in HARNESS_CONTEXT_DOCS if name in context):
        return False
    edits = context.get("declared_edits", [])
    return (isinstance(edits, list) and len(edits) <= HARNESS_MAX_EDITS
            and all(harness_edit_ok(edit) for edit in edits))


class GatewayError(RuntimeError):
    # Trusted, gateway-authored refusal fields (never a raw upstream body).
    detail: dict[str, Any] = {}


# ``refusal`` is the gateway's typed content refusal (videoclaw-backend#339).
_REFUSAL_FIELDS = ("code", "retryable", "not_submitted", "retry_after_s", "stage", "refusal")


def _typed(exc: GatewayError, status: int, structured: dict | None) -> GatewayError:
    """Keep the refusal's machine-readable recovery facts on the exception."""
    exc.detail = {"status": status, **{field: structured[field] for field in _REFUSAL_FIELDS
                                       if structured and field in structured}}
    return exc


class GatewayTransientError(GatewayError):
    """A transport/temporary HTTP failure that is safe to retry in place."""


class GatewayNotSubmittedError(GatewayError):
    """A trusted party proves this fresh request reserved and purchased nothing.

    Two sources qualify: the local proxy's own receipt that it never forwarded
    the request, and the gateway's explicit ``not_submitted`` declaration on a
    refusal it made before any reservation or provider submission. An
    unexplained 5xx or timeout is neither and stays an accepted-unknown.
    """


class _GatewayAdmissionBusy(GatewayNotSubmittedError):
    """Proven-not-submitted refusal the gateway declares retryable.

    Private to `_req`, which retries the identical request within a bounded
    deadline. It subclasses `GatewayNotSubmittedError` so that an unexpected
    escape still means the same thing to callers: nothing was submitted.
    """


class GatewaySubmitWindowClosedError(GatewayNotSubmittedError):
    """Approved too late: the command's time left can no longer cover this item,
    so the approval is retired and nothing is submitted (videoclaw#278 review)."""


class GatewayAcceptedError(GatewayError):
    """The gateway accepted this paid request; callers must never resubmit it."""


class GatewayRepeatRefusedError(GatewayNotSubmittedError):
    """Refused here, before any gateway call: the model already declined this
    exact request in this video (videoclaw#341). Nothing was sent or charged."""


def _repeat_refused(message: str) -> GatewayRepeatRefusedError:
    error = GatewayRepeatRefusedError(message)
    error.detail = {"code": _refusal_guard.REPEAT_REFUSED_CODE, "retryable": False,
                    "not_submitted": True}
    return error


def exit_on_repeat_refusal(main: Callable[[], Any]) -> Any:
    """Run a command's main(); an unchanged re-submit of a declined request
    prints its message and returns the repeat exit status instead of a traceback."""
    try:
        return main()
    except GatewayRepeatRefusedError as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return _refusal_guard.REPEAT_REFUSED_EXIT


class GatewayDestinationClaimedError(GatewayNotSubmittedError):
    """Refused before payment: an earlier accepted request owns this file.

    ``blocked`` is False while that result is on its way, True when it can never
    arrive (a different file is in the way) and the agent must use a new name.
    """

    operation_id: str | None = None
    blocked: bool = False


AUTHORIZATION_REQUIRED_SCHEMA = "videoclaw.authorization-required/v1"


def _bounded_agent_text(value: Any, limit: int = 1200) -> str | None:
    """Return one bounded, printable line from a trusted structured error.

    Raw response bodies stay hidden. Only gateway-authored fields explicitly
    intended for the agent cross this boundary.
    """
    if not isinstance(value, str):
        return None
    printable: list[str] = []
    for char in value:
        if char.isspace():
            printable.append(" ")
        elif not unicodedata.category(char).startswith("C"):
            # Drop C0/C1 controls, DEL, bidi/zero-width format controls,
            # surrogates, private-use, and unassigned code points. In
            # particular, ESC/OSC sequences must never reach a terminal or an
            # agent transcript as active control data.
            printable.append(char)
    text = " ".join("".join(printable).split())
    if not text:
        return None
    return text[:limit]


def _structured_gateway_error(
    status_code: int,
    detail: dict[str, Any],
    *,
    non_retryable: bool = False,
) -> str:
    code = _bounded_agent_text(detail.get("code"), 120) or "GATEWAY_ERROR"
    message = _bounded_agent_text(detail.get("message")) or "request failed"
    prefix = "NON-RETRYABLE " if non_retryable else ""
    lines = [f"{prefix}gateway {status_code} {code}: {message}"]

    diagnostic = _bounded_agent_text(detail.get("diagnostic"))
    if diagnostic:
        lines.append(f"  diagnostic: {diagnostic}")

    recovery = detail.get("recovery")
    if isinstance(recovery, dict):
        action = _bounded_agent_text(recovery.get("action"), 120)
        instruction = _bounded_agent_text(recovery.get("instruction"))
        if instruction:
            label = f" ({action})" if action else ""
            lines.append(f"  recovery{label}: {instruction}")
    return "\n".join(lines)


class GatewayAuthorizationError(GatewayError):
    """A paid operation lacks sufficient server-side authorization.

    ``result`` is provider- and UI-neutral so terminal, desktop, and automation
    hosts can render or act on the same refusal without parsing prose.
    """

    def __init__(self, result: dict[str, Any], *, not_submitted: bool = False):
        self.result = result
        # Financial refusal alone does not prove an earlier paid POST was not
        # admitted. Preserve this separately from the host-facing UI payload.
        self.not_submitted = not_submitted
        super().__init__(
            json.dumps(
                result,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
        )


_PREVIOUS_EXCEPTHOOK = sys.excepthook


def _gateway_cli_exception_boundary(
    exc_type: type[BaseException],
    exc_value: BaseException,
    traceback: Any,
) -> None:
    """Serialize an uncaught authorization refusal without a traceback.

    Gateway clients are shared by many small command-line tools. Keeping this
    narrow exception boundary here gives every single-operation CLI the same
    machine-readable failure contract without changing library callers that
    deliberately catch :class:`GatewayAuthorizationError`.
    """
    if isinstance(exc_value, GatewayAuthorizationError):
        sys.stderr.write(f"{exc_value}\n")
        return
    _PREVIOUS_EXCEPTHOOK(exc_type, exc_value, traceback)


sys.excepthook = _gateway_cli_exception_boundary


_KNOWN_RESPONSE_STATUSES = {
    "succeeded", "failed", "canceled", "cancelled", "timeout",
    "queued", "running", "reconciling", "submission_unknown",
    "accepted_unknown",
}


def _normalise_paid_response(
    res: dict,
    *,
    accepted_job_id: str | None = None,
) -> dict:
    """Fail closed when a successful paid response has no usable receipt.

    This applies to both the submission POST and every later poll/cancel read.
    Once ``accepted_job_id`` is known, a response may omit it but may never
    switch identities. A syntactically valid object with a missing/unknown
    status (or an initial queued/running status without its durable job id) is
    unresolved, never an ordinary retryable failure and never a complete $0
    reconciliation.
    """
    status = res.get("status")
    response_job_id = res.get("job_id")
    has_response_job_id = (
        isinstance(response_job_id, str) and bool(response_job_id)
    )
    valid_job_identity = (
        accepted_job_id is None
        or not has_response_job_id
        or response_job_id == accepted_job_id
    )
    valid_in_progress = (
        status not in IN_PROGRESS_STATUSES
        or has_response_job_id
        or accepted_job_id is not None
    )
    if (
        status in _KNOWN_RESPONSE_STATUSES
        and valid_in_progress
        and valid_job_identity
    ):
        return res
    detail = (
        "gateway response changed its durable job id"
        if not valid_job_identity
        else (
            "running response omitted a durable job id"
            if status == "running"
            else f"unexpected gateway response status: {status!r}"
        )
    )
    durable_job_id = accepted_job_id or (
        response_job_id if has_response_job_id else None
    )
    return {
        "status": "accepted_unknown",
        **({"_operation_id": res["_operation_id"]} if res.get("_operation_id") else {}),
        "reconciliation_required": True,
        "error": detail,
        **(
            {"job_id": durable_job_id}
            if durable_job_id is not None
            else {}
        ),
    }


def _raise_term(signum, frame):  # pragma: no cover - trivial
    raise SystemExit(143)


@contextmanager
def _term_raises():
    """While active, SIGTERM raises SystemExit(143) instead of killing the
    process outright. Legacy cleanup cancels its jobs; durable operations keep
    their accepted work for the independent collector. No-op off the main thread."""
    try:
        prev = signal.signal(signal.SIGTERM, _raise_term)
    except ValueError:          # not the main thread — leave signals alone
        yield
        return
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, prev)


class _Gateway:
    # Set once the gateway answered the review route with 404/405: this
    # process then sends (and uploads) nothing more for the review.
    _harness_route_missing: bool = False

    def _media_digests(self) -> dict[str, str]:
        return self.__dict__.setdefault("_known_media", {})

    def media_digest(self, ref: str) -> str | None:
        """sha256 of the bytes behind an 'upload:<id>' (or its read URL) from this process."""
        return self._media_digests().get(ref)

    def remember_media_digest(self, ref: str, sha256: str) -> None:
        self._media_digests()[ref] = sha256

    def screen_declined(self, tool: str, job, *, mode: str | None = None,
                        params: dict | None = None, prompt: str | None = None,
                        references: list | None = None, route: dict | None = None,
                        delivery: list | None = None,
                        local_digests: dict[str, str] | None = None):
        """Refuse an unchanged re-submit of a request the model declined (videoclaw#341).

        Runs before any gateway call. Returns the watch handle for ``note``,
        or None when the guard does not apply."""
        if job is None or tool not in _refusal_guard.GUARDED_TOOLS:
            return None
        from _billing_manifest import job_path
        local = local_digests or {}
        guarded = _refusal_guard.prepare(
            tool, job_path(str(job), Path.cwd()), mode=mode, params=params, prompt=prompt,
            references=references, route=route, delivery=delivery,
            digest=lambda ref: local.get(ref) or self.media_digest(ref))
        message = _refusal_guard.repeat_message(guarded)
        if message:
            raise _repeat_refused(message)
        return guarded

    @property
    def url(self) -> str:
        return resolve_url()

    @property
    def key(self) -> str:
        return os.environ.get("VIDEOCLAW_API_KEY", "")

    def enabled(self) -> bool:
        return bool(self.key)

    def request_headers(self) -> dict[str, str]:
        """Authenticated headers shared by every engine-owned gateway path."""
        return {"Authorization": f"Bearer {self.key}"}

    def search_sfx_catalog(self, *, query: str = "", category: str | None = None,
                           tags: list[str] | None = None, limit: int = 20) -> dict:
        """Authenticated metadata-only SFX discovery (never a paid job)."""
        params: dict[str, Any] = {"q": query, "limit": limit}
        if category:
            params["category"] = category
        if tags:
            params["tags"] = ",".join(tags)
        return self._req("GET", "/v1/sfx/catalog", params=params)

    def resolve_sfx_catalog(self, asset_id: str, version: int = 1) -> dict:
        """Resolve one exact stable identity to a short-lived storage URL."""
        from urllib.parse import quote
        encoded = quote(asset_id, safe="")
        return self._req(
            "GET", f"/v1/sfx/catalog/{encoded}/resolve", params={"version": version}
        )

    def resolve_asset_url(self, asset_url: str, *, origin: str | None = None) -> str:
        """Resolve gateway-owned relative asset locators against this session's
        pinned gateway origin.

        Production normally returns absolute URLs because SERVICE_URL is set on
        Cloud Run. Local/dev gateways may legitimately return ``/v1/assets/...``;
        treating that as an unknown result after the paid job succeeded discards
        usable output. Protocol-relative and non-HTTP locators stay rejected so
        a response cannot silently switch hosts or schemes.
        """
        if not isinstance(asset_url, str) or not asset_url:
            raise GatewayError("gateway asset URL is missing or not a string")
        if asset_url.startswith(("http://", "https://")):
            return asset_url
        if asset_url.startswith("//") or ":" in asset_url.split("/", 1)[0]:
            raise GatewayError(f"unsupported gateway asset URL: {asset_url[:80]}")
        return f"{(origin or self.url).rstrip('/')}/{asset_url.lstrip('/')}"

    # -- core ---------------------------------------------------------------
    def quote(self, tool: str, *, mode: str | None = None,
              params: dict | None = None, quality: str | None = None,
              seconds: float | None = None, count: int = 1,
              model: str | None = None) -> dict:
        """Resolve a server-side price without submitting vendor work."""
        body: dict[str, Any] = {"params": params or {}, "count": count}
        if mode is not None:
            body["mode"] = mode
            # Registry mode parameters are semantic (`role` for mint_image,
            # `slot` for cast_avatar). Sending the generic mode as well keeps
            # the quote surface small while matching submit's fallback.
            if tool == "mint_image":
                body["role"] = mode
            elif tool == "cast_avatar":
                body["slot"] = mode
        if quality is not None:
            body["quality"] = quality
        if seconds is not None:
            body["seconds"] = seconds
        if model is not None:
            body["model"] = model
        return self._req("POST", f"/v1/quotes/{tool}", json=body)

    def run(self, tool: str, *, mode: str | None = None,
            params: dict | None = None, prompt: str | None = None,
            references: list | None = None, quality: str | None = None,
            engine: str | None = None, seconds: float | None = None,
            job: Path | str | None = None, timeout_s: float = 1800.0,
            deadline: float | None = None,
            _ledger_model: str | None = None,
            _delivery: list[Path | str] | None = None,
            _replaces_existing: bool = False,
            _local_source: dict | None = None,
            **extra_body: Any) -> dict:
        """Submit + block until terminal. Logs a cost event to the job's
        run.log.jsonl (same shape as before, so cost.py reconcile still works).

        With durable recovery, a `_delivery` name that already exists (or that
        another unfinished operation is producing) is refused before the paid
        POST. `_replaces_existing=True` is only for producers that publish
        their own output through `note_output(..., pending_bytes=...)`.

        ``_local_source`` names this video's own copy of a file recovery needs
        (see _operations.copy_local_source). It is saved in the local
        operation record only; the request sent to the gateway is unchanged.

        ``deadline`` (a ``time.time()`` instant) also ends the result wait,
        however long upload and local admission took. A host that kills the
        whole command at a fixed time then gets the accepted-work handoff
        instead of a SIGTERM (videoclaw-backend#316)."""
        guarded = self.screen_declined(
            tool, job, mode=mode, params=params, prompt=prompt, references=references,
            route={"model": extra_body.get("model"), "model_contract": extra_body.get("model_contract"),
                   "engine": engine, "quality": quality},
            delivery=_delivery)
        context = self._operation_context(job, tool, _delivery, mode)
        if context is not None:
            from _billing_manifest import job_path
            job = job_path(str(job), Path.cwd())
        body: dict[str, Any] = {} if tool == "media/pull" and params is None else {"params": params or {}}
        if mode is not None:
            body["mode"] = mode
        if prompt is not None:
            body["prompt"] = prompt
        if references:
            body["references"] = [self._ref(r) for r in references]
        for k, v in (("quality", quality), ("engine", engine),
                     ("seconds", seconds)):
            if v is not None:
                body[k] = v
        if job is not None:
            body["client_job"] = Path(job).name
        body.update(extra_body)

        t0 = time.time()
        operation_id = None
        try:
            res, operation_id = self._submit_request(tool, body, job, context, _delivery,
                                                     replaces_existing=_replaces_existing,
                                                     local_source=_local_source)
        except GatewayTransientError as e:
            # Without a server-supported stable idempotency key, a timeout/5xx
            # can mean the server accepted and charged the request but its
            # response was lost. Record one unresolved exposure and fail closed;
            # callers must never replay this POST.
            if job is not None:
                self._log_cost(
                    job,
                    tool,
                    mode,
                    {
                        "status": "accepted_unknown",
                        "error": str(e),
                    },
                    time.time() - t0,
                    quality=body.get("quality", "standard"),
                )
            raise GatewayAcceptedError(
                f"{tool}/{mode or '-'} submission response was unavailable; "
                "the request may already have been accepted"
            ) from e
        except GatewayError as e:
            _refusal_guard.note(guarded, e)
            raise
        res = _normalise_paid_response(res)
        accepted_job_id = res.get("job_id")
        if "job_id" in res and (_operation_unfinished(res) if operation_id
                                else res.get("status") in IN_PROGRESS_STATUSES):
            job_id = res["job_id"]
            with _term_raises():
                try:
                    # Human approval precedes execution. Start the result wait
                    # after admission, not before that unbounded local wait.
                    poll_started = time.time() if context and context.get('local_admission') else t0
                    origin = poll_started if operation_id else t0
                    wait_s = (timeout_s if deadline is None
                              else max(0.0, min(timeout_s, deadline - origin)))
                    res = (self._poll_operation(Path(job), operation_id, context, poll_started, wait_s)
                           if operation_id else self._poll(job_id, t0, wait_s))
                except (KeyboardInterrupt, SystemExit):
                    if not operation_id:
                        self._cancel_quietly(job_id)
                    raise
                except Exception as e:
                    # POST already returned a job id. Preserve that acceptance
                    # boundary so an outer tool can never mistake a poll failure
                    # for a safe reason to submit a second paid generation.
                    if job is not None:
                        self._log_cost(
                            job,
                            tool,
                            mode,
                            {
                                "status": "accepted_unknown",
                                "job_id": job_id,
                                **({"_operation_id": operation_id} if operation_id else {}),
                                "error": str(e),
                            },
                            time.time() - t0,
                            quality=body.get("quality", "standard"),
                        )
                    error = GatewayAcceptedError(
                        f"{tool}/{mode or '-'} accepted as {job_id}, but "
                        f"completion could not be retrieved: {e}"
                    )
                    error.operation_id = operation_id
                    raise error from e
        res = _normalise_paid_response(
            res,
            accepted_job_id=accepted_job_id,
        )
        if job is not None:
            self._log_cost(job, tool, mode, res, time.time() - t0,
                           quality=body.get("quality", "standard"),
                           model=_ledger_model)
        if res.get("status") != "succeeded":
            msg = (f"{tool}/{mode or '-'} {res.get('status')}: "
                   f"{res.get('error', 'no detail')}")
            if res.get("settlement_state"):
                msg += f"\n  {_settling_note(res)}"
            elif res.get("cost_usd") == 0 and res.get("cost_source") == "waived":
                msg += "\n  billing: $0.00 (terminal failure was waived)"
            elif res.get("reconciliation_required") or res.get("status") in {
                "queued", "running", "reconciling", "submission_unknown"
            }:
                msg += ("\n  billing: unresolved; this work remains in flight/reserved. "
                        "Read the authoritative host/gateway financial state before retrying or reporting spend.")
            if res.get("agent_detail"):
                # the gateway's sanitized actionable core of the vendor error
                # (param, code, message — branding stripped). Surfacing it in
                # the exception text puts it in the tool's stderr, so the
                # AGENT reads what it did wrong and self-corrects instead of
                # repeating the same bad parameter.
                msg += f"\n  ↳ {res['agent_detail']}"
            failure = res.get("failure")
            if isinstance(failure, dict):
                code = _bounded_agent_text(failure.get("code"), 120)
                action = _bounded_agent_text(failure.get("agent_action"), 160)
                if code:
                    msg += f"\n  failure class: {code}"
                if action == "do_not_repeat_unchanged_request":
                    msg += (
                        "\n  action: do not repeat this unchanged request; "
                        "the gateway owns any safe provider retry"
                    )
            # Any response body from POST or a polled job is an accepted
            # gateway request. A terminal refusal/failure must not be replayed.
            accepted = f" (accepted job {accepted_job_id})" if accepted_job_id else ""
            error = GatewayAcceptedError(msg + accepted)
            error.result = res
            _refusal_guard.note(guarded, error)
            raise error
        if res.get("settlement_state"):
            print(f"  {tool}/{mode or '-'} {_settling_note(res)}", file=sys.stderr)
        return {**res, "_operation_id": operation_id} if operation_id else res

    def harness_review(self, *, context: dict, video: Path | str, job: Path | str,
                       max_output_tokens: int = HARNESS_REVIEW_MAX_OUTPUT_TOKENS) -> str:
        """The end-of-render review's one model request, run and paid by VideoClaw.

        Contract (videoclaw-backend#289), exactly::

            POST /v1/harness/review
            X-VideoClaw-Purpose: harness-review            (once)
            {"role": "review_full",
             "template": "final_review/v1",                (the server owns the
                                                             instruction; no prompt)
             "context": {"script": {...}, "style_directives": {...},
                         "promise": {...}, "declared_edits": [...]},
             "retry": false,                               (always: one attempt)
             "references": ["upload:<id>"],                (this caller's own
                                                             upload of one local,
                                                             unfragmented MP4/MOV
                                                             <= 24 MiB)
             "params": {"_media": "video", "max_output_tokens": 16384},
             "client_job": <job directory name>}

        The review has its own route, never ``/v1/qa_video``: a backend that
        does not have the route answers 404/405 and nothing is billed to the
        user. After such an answer this process sends no further review
        requests and uploads nothing for them. No other body or params field,
        and none of the operation-id, project-id, spend-permit or
        settlement-policy headers, so it never goes through ``run()``'s
        durable-operation or local-admission path. A request that would break
        these rules (including a context over the server's limits) is refused
        here.

        The POST is exactly one HTTP attempt: no admission retry and never the
        server's optional ``retry: true`` re-ask. Any non-2xx answer, a network
        error, ``failed`` (including ``review_output_unusable``),
        ``submission_unknown``, a result not billed to the house, or any other
        outcome raises. Callers stay silent and never resend without the
        marker.
        """
        if self._harness_route_missing:
            raise GatewayError("this gateway has no end-of-render review route; nothing was sent")
        if not harness_context_ok(context):
            raise GatewayError("harness review context is outside the contract; nothing was sent")
        if isinstance(video, str) and video.startswith(("http:", "https:", "upload:")):
            raise GatewayError("harness review needs a local render to upload; nothing was sent")
        video = Path(video)
        if (not video.is_file() or video.suffix.lower() not in HARNESS_REVIEW_VIDEO_SUFFIXES
                or video.stat().st_size > HARNESS_REVIEW_MAX_VIDEO_BYTES):
            raise GatewayError("harness review needs one local MP4/MOV of at most 24 MiB; "
                               "nothing was sent")
        if not self.enabled():
            raise GatewayError("no gateway key; nothing was sent")
        body = {
            "role": HARNESS_REVIEW_ROLE,
            "template": HARNESS_REVIEW_TEMPLATE,
            "context": context,
            "retry": False,
            "references": [self.upload(video)],
            "params": {"_media": "video", "max_output_tokens": int(max_output_tokens)},
            "client_job": Path(job).name,
        }
        started = time.time()
        try:
            # One attempt means one POST: a redirect is never followed (it
            # would resend the request) and any 3xx is a refusal.
            res = self._request_once(
                "POST", HARNESS_REVIEW_PATH,
                {HARNESS_PURPOSE_HEADER: HARNESS_REVIEW_PURPOSE, **self.request_headers()},
                REQUEST_TIMEOUT_SECONDS, json=body, allow_redirects=False,
            )
        except GatewayError as exc:
            status = getattr(exc, "detail", {}).get("status") if isinstance(
                getattr(exc, "detail", None), dict) else None
            if status in (404, 405):
                self._harness_route_missing = True
            raise
        self._log_cost(job, "harness_review", HARNESS_REVIEW_ROLE, res, time.time() - started)
        output = res.get("output") if isinstance(res.get("output"), dict) else {}
        text = output.get("text")
        if res.get("status") != "succeeded" or not isinstance(text, str):
            failure = res.get("failure") if isinstance(res.get("failure"), dict) else {}
            raise GatewayError(
                f"harness/review {res.get('status')!r} {failure.get('code') or ''}: "
                "the house-run review returned no result"
            )
        if res.get("billing") != "house" or res.get("cost_source") != "house":
            raise GatewayError("the review was not paid by the house account; its result is not used")
        return text

    def _submit_request(self, tool, body, job, context, delivery, *, replaces_existing=False,
                        local_source=None, submit_by=None):
        if context is None:
            return self._req("POST", f"/v1/{tool}", json=body), None
        from _operations import (DestinationClaimed, DestinationOccupied, prepare, record_refusal,
                                 record_result, mark_submitting)
        local_admission = context.get('local_admission') == 'videoclaw.local-admission/v1'

        def claimed(exc: DestinationClaimed) -> GatewayDestinationClaimedError:
            error = GatewayDestinationClaimedError(str(exc))
            error.operation_id, error.blocked = exc.operation_id, exc.blocked
            return error
        try:
            operation = prepare(Path(job), context, f"/v1/{tool}",
                json.dumps(body, allow_nan=False).encode("utf8"), delivery or [],
                awaiting_approval=local_admission, replaces_existing=replaces_existing,
                local_source=local_source)
        except DestinationClaimed as exc:
            raise claimed(exc) from exc
        except DestinationOccupied as exc:
            raise GatewayNotSubmittedError(str(exc)) from exc
        operation_id = operation["id"]
        headers = {"Content-Type": "application/json", "X-VideoClaw-Operation-Id": operation_id}
        if local_admission:
            # This endpoint cannot submit. Even a lost reply here proves that
            # this engine has not crossed the paid-submission boundary.
            # The app proxy owns any wait for a temporary quote/permit refusal
            # (it holds the approval); a refusal reaching here is final and typed.
            try:
                self._wait_local_admission(operation, headers)
                if submit_by is not None and time.time() >= submit_by():
                    self._retire_local_admission(operation)
                    raise GatewaySubmitWindowClosedError(
                        "this command's time ran out while the spending approval was pending")
            except GatewayError as exc:
                try:
                    record_refusal(Path(job), operation_id, context, str(exc))
                except (OSError, ValueError):
                    pass  # The initial intent is already known unsubmitted.
                if isinstance(exc, (GatewayAuthorizationError, GatewayNotSubmittedError)):
                    raise
                wrapped = GatewayNotSubmittedError(
                    f"Spending approval did not complete; nothing was submitted: {exc}")
                wrapped.detail = exc.detail
                raise wrapped from exc
            try:
                mark_submitting(Path(job), operation_id, context)
            except DestinationClaimed as exc:
                try:
                    record_refusal(Path(job), operation_id, context, str(exc))
                except (OSError, ValueError):
                    pass  # The record still says awaiting approval: not submitted.
                raise claimed(exc) from exc
            except DestinationOccupied as exc:
                try:
                    record_refusal(Path(job), operation_id, context, str(exc))
                except (OSError, ValueError):
                    pass  # The intent is already known unsubmitted.
                raise GatewayNotSubmittedError(str(exc)) from exc
            except (OSError, ValueError) as exc:
                raise GatewayNotSubmittedError(f"Could not save the approved operation; nothing was submitted: {exc}") from exc
            headers['X-VideoClaw-Local-Admission'] = 'submit'
        try:
            response = self._req("POST", operation["path"], data=operation["body"].encode("utf8"),
                headers={**headers, **PENDING_SETTLEMENT})
        except (GatewayNotSubmittedError, GatewayAuthorizationError) as exc:
            if isinstance(exc, GatewayNotSubmittedError) or exc.not_submitted:
                try:
                    record_refusal(Path(job), operation_id, context, str(exc))
                except (OSError, ValueError):
                    pass  # Preserve the received refusal; a later GET remains safe.
                raise
            # An unexplained 402 can follow admission. Recover by GET below;
            # neither record a non-submission nor repeat this paid POST.
        except GatewayError:
            # Only GET can recover this operation, including a lost response
            # before we learned the gateway's job ID. Never repeat this POST.
            pass
        else:
            try:
                saved = record_result(Path(job), operation_id, context, response)
                return self._operation_response(job, operation_id, context, saved), operation_id
            except (OSError, ValueError):
                pass  # A malformed/lost local snapshot can only fall back to GET.
        result = self.recover_operation(Path(job), operation_id, context=context)
        return result, operation_id

    def _local_admission_exchange(self, method, request_path, **kwargs):
        return self._request_once(method, request_path,
            {**self.request_headers(), **kwargs.pop('headers', {})}, 15, **kwargs)

    def _retire_local_admission(self, operation: dict) -> None:
        try:
            self._local_admission_exchange('DELETE', f"/v1/local-admissions/{operation['id']}")
        except GatewayError:
            pass  # Proxy lease/Stop also retires an abandoned approval.

    def _wait_local_admission(self, operation: dict, headers: dict) -> None:
        # Negotiated only by the app's authenticated loopback proxy. Never
        # send a preflight-shaped POST to a backend that could execute it.
        if urlsplit(self.url).hostname != '127.0.0.1' or not self.key.startswith('vcs_'):
            raise GatewayError('local spending approval requires the app proxy')
        path = f"/v1/local-admissions/{operation['id']}"
        exchange = self._local_admission_exchange
        try:
            result = exchange('POST', operation['path'], data=operation['body'].encode('utf8'),
                headers={**headers, 'X-VideoClaw-Local-Admission': 'prepare'})
            while True:
                if (not isinstance(result, dict) or result.get('schema') != 'videoclaw.local-admission/v1'
                        or result.get('operation_id') != operation['id']
                        or result.get('status') not in {'pending', 'approved'}):
                    raise GatewayError('invalid local spending approval')
                if result['status'] == 'approved':
                    return
                try:
                    result = exchange('GET', path)
                except GatewayTransientError:
                    # Only read-only polls may retry a lost exchange. Two
                    # bounded reads still fit within the app's 60-second lease.
                    result = exchange('GET', path)
                if isinstance(result, dict) and result.get('status') == 'pending':
                    time.sleep(1)
        except BaseException:
            self._retire_local_admission(operation)
            raise

    def _operation_context(self, job, tool: str, delivery, mode: str | None = None) -> dict | None:
        if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") != "1":
            return None
        if job is None:
            raise GatewayError("durable paid work requires a video directory")
        implicit_outputs = tool in {"llm", "embed", "qa_video", "enumerate_profile", "model_call"} or (
            tool == "synth_voice" and mode in {"transcribe", "design", "list_voices"})
        if not delivery and not implicit_outputs:
            raise GatewayError(f"{tool} has no durable output destinations; paid work was not started")
        context = self._req("GET", "/v1/operation-context")
        from _operations import owner
        try:
            ownership = owner(context)
        except ValueError as exc:
            raise GatewayError(str(exc)) from exc
        if (ownership["client_job"] != Path(job).name or context.get("accepting") is not True
                or not isinstance(context.get("tools"), list) or tool.replace("/", ".") not in context["tools"]):
            raise GatewayError("durable recovery is unavailable for this video/tool; paid work was not started")
        return context

    def recover_operation(self, job: Path, operation_id: str, *, context: dict | None = None) -> dict:
        """Retrieve one saved operation; never route or submit a replacement."""
        from _operations import _TERMINAL, read, record_result
        try:
            context = context if context is not None else self._req("GET", "/v1/operation-context")
            record = read(job, operation_id, context)
            if record.get("not_submitted") is True:
                raise GatewayNotSubmittedError(record.get("submission_error", "this request was not submitted"))
            result = self._req("GET", f"/v1/operations/{operation_id}?" +
                               urlencode({"client_job": record["owner"]["client_job"]}),
                               headers=PENDING_SETTLEMENT)
            saved = record_result(job, operation_id, context, result)
            if (saved["result"]["job_id"] != result["job_id"] or
                    saved["result"]["status"] != result["status"]):
                stale = (saved["result"]["job_id"] == result["job_id"]
                         and result["status"] not in _TERMINAL)
                raise (_StaleOperationRead if stale else ValueError)(
                    "saved terminal result disagrees with the current gateway; retain it for recovery")
        except GatewayNotSubmittedError:
            raise
        except (GatewayError, OSError, ValueError) as exc:
            error = GatewayAcceptedError(
                f"Operation {operation_id} needs result recovery: {exc}. "
                "Keep this operation; do not submit a replacement generation.")
            error.operation_id = operation_id
            raise error from exc
        return self._operation_response(job, operation_id, context, saved)

    def _operation_response(self, job, operation_id: str, context: dict, saved: dict) -> dict:
        from _operations import final_view
        result = final_view(_normalise_paid_response(
            {**saved["result"], "tool": saved["path"].removeprefix("/v1/").replace("/", ".")}))
        if result.get("assets"):
            result = {**result, "assets": [{**asset, "_operation": {
                "id": operation_id, "job": str(job), "context": context, "index": index}}
                for index, asset in enumerate(result["assets"])]}
        return {**result, "_operation_id": operation_id}

    def _poll_operation(self, job: Path, operation_id: str, context: dict,
                        t0: float, timeout_s: float) -> dict:
        while True:
            try:
                result = self.recover_operation(job, operation_id, context=context)
            except GatewayAcceptedError as exc:
                # A stale read must not end the wait: the next read of the
                # same operation agrees with the terminal result already saved.
                if (not isinstance(exc.__cause__, (GatewayTransientError, _StaleOperationRead))
                        or time.time() - t0 > timeout_s):
                    raise
                time.sleep(POLL_SECONDS)
                continue
            if not _operation_unfinished(result):
                return result
            if time.time() - t0 > timeout_s:
                error = GatewayAcceptedError(
                    f"Operation {operation_id} is still {result.get('status')}; background recovery owns its result. "
                    "This timeout did not cancel or repeat the generation.")
                error.operation_id = operation_id
                raise error
            time.sleep(POLL_SECONDS)

    def collect_operation(self, job: Path, operation_id: str, *, cancel: bool = False,
                          publish: bool = True, publish_settling: bool = True) -> dict:
        """Recover and import original outputs without making a paid request.

        ``publish_settling=False`` leaves a settling outcome unpublished, for a
        caller that can only announce media on its settled pass."""
        from _operations import deliver, read, record_result, settling
        context = self._req("GET", "/v1/operation-context")
        if cancel:
            record = read(job, operation_id, context)
            result = self._req("POST", f"/v1/operations/{operation_id}/cancel?" +
                               urlencode({"client_job": record["owner"]["client_job"]}),
                               headers=PENDING_SETTLEMENT)
            record_result(job, operation_id, context, result)
        result = self.recover_operation(job, operation_id, context=context)
        self._log_cost(job, result.get("tool"), result.get("mode"), result, 0)
        if not publish or not publish_settling and settling(result):
            return read(job, operation_id, context)
        if result.get("tool") == "audio.enhance" and result.get("status") == "succeeded":
            from clean_audio import collect_enhanced_audio
            saved = read(job, operation_id, context)
            if len(saved["outputs"]) != 1 or len(result.get("assets", [])) != 1:
                raise GatewayAcceptedError("the original enhanced audio has an unsupported output count")
            destination = saved["outputs"][0]
            if destination not in saved["delivered"]:
                asset = result["assets"][0]
                url = self.resolve_asset_url(asset["url"], origin=context["gateway_url"])
                self.note_output(asset, Path(job) / destination,
                    pending_bytes=collect_enhanced_audio(self, url, saved))
        if result.get("tool") == "media.pull" and result.get("status") == "succeeded":
            from pull_video import collect_pulled_media
            saved = read(job, operation_id, context)
            if len(saved["outputs"]) != 1 or len(result.get("assets", [])) != 1:
                raise GatewayAcceptedError("the original acquisition has an unsupported output count")
            destination = saved["outputs"][0]
            if destination not in saved["delivered"] and json.loads(saved["body"]).get("mode", "pull") == "pull":
                asset = result["assets"][0]
                url = self.resolve_asset_url(asset["url"], origin=context["gateway_url"])
                self.note_output(asset, Path(job) / destination,
                    pending_bytes=collect_pulled_media(self, url, saved))
        if result.get("tool") == "mint_video" and result.get("status") == "succeeded":
            saved = read(job, operation_id, context)
            if json.loads(saved["body"]).get("mode") == "genjutsu":
                # Never publish the raw provider clip: restore the source audio
                # exactly as the finished run does, then stage those bytes.
                from mint_video import collect_genjutsu_output
                if len(saved["outputs"]) != 1 or len(result.get("assets", [])) != 1:
                    raise GatewayAcceptedError("the original genjutsu result has an unsupported output count")
                destination = saved["outputs"][0]
                if destination not in saved["delivered"]:
                    asset = result["assets"][0]
                    url = self.resolve_asset_url(asset["url"], origin=context["gateway_url"])
                    self.note_output(asset, Path(job) / destination,
                        pending_bytes=collect_genjutsu_output(self, url, saved, job=Path(job)))
        def download(url, stream):
            resolved = self.resolve_asset_url(url, origin=context["gateway_url"])
            limits = {}
            if result.get("tool") == "model_call":
                supplied, active = urlsplit(resolved), urlsplit(context["gateway_url"])
                cloud_run = r"videoclaw-gw-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app"
                same_origin = (supplied.scheme, supplied.hostname, supplied.port or (443 if supplied.scheme == "https" else 80)) == (
                    active.scheme, active.hostname, active.port or (443 if active.scheme == "https" else 80))
                signed_alias = supplied.scheme == active.scheme == "https" and all(
                    re.fullmatch(cloud_run, host or "") for host in (supplied.hostname, active.hostname))
                asset = next((a for a in result.get("assets", [])
                              if supplied.path == f"/v1/assets/{a['asset_id']}"), None)
                query = parse_qs(supplied.query)
                if (not (same_origin or signed_alias) or not asset
                        or not query.get("e") or not query.get("sig")):
                    raise GatewayError("model media is not a signed asset on the active gateway")
                # As in the app importer, route Cloud Run aliases through the
                # configured gateway and never attach a bearer to media GETs.
                resolved = f"{active.scheme}://{active.netloc}{supplied.path}?{supplied.query}"
                limits = {"max_bytes": 256 * 1024 * 1024, "content_type": asset["content_type"]}
            self._download_to(resolved, stream, **limits)
        return deliver(job, operation_id, context, download)

    def retrieve(self, job_id: str, *, tool: str, mode: str | None = None) -> dict:
        """Read one accepted result without submitting, canceling or logging spend."""
        if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id):
            raise ValueError("invalid accepted gateway job ID")
        try:
            res = self._req("GET", f"/v1/jobs/{job_id}")
        except GatewayAuthorizationError:
            raise  # Preserve the host's structured authorization contract.
        except GatewayError as exc:
            raise GatewayAcceptedError(
                f"Accepted job {job_id} could not be retrieved: {exc}. "
                "Retry retrieval of this job; do not submit another generation.") from exc
        res = _normalise_paid_response(res, accepted_job_id=job_id)
        if res.get("status") != "succeeded":
            detail = _bounded_agent_text(res.get("error")) or "result is not available"
            raise GatewayAcceptedError(
                f"Accepted job {job_id} is {res.get('status')}: {detail}. "
                "Do not submit a replacement generation automatically.")
        if res.get("tool") != tool or (mode is not None and res.get("mode") != mode):
            raise GatewayAcceptedError(
                f"Accepted job {job_id} did not return the expected {tool}/{mode or '-'} result")
        return {**res, "job_id": job_id}

    def run_many(self, tool: str, items: list[dict], *,
                 job: Path | str | None = None, timeout_s: float = 1800.0,
                 max_inflight: int | None = None,
                 on_result: Callable[[int, dict], None] | None = None,
                 deadline: float | None = None,
                 submit_reserve_s: float = 0.0,
                 **extra_body: Any) -> list[dict]:
        """Batched `run`: submit up to `max_inflight` jobs, poll them TOGETHER,
        keep submitting as slots free. Returns a list aligned with `items`;
        each entry is the terminal result dict ({"status": "succeeded", ...}
        or {"status": ..., "error": ...}) — a single item's failure never
        raises, so the caller can persist the survivors and name the losers.

        Each item takes the same keyword surface as run() (mode, params,
        prompt, references, quality, engine, seconds); `extra_body` (e.g.
        client_job) is merged into every submission. Before each submission
        wave the client asks the gateway how many paid execution slots this
        key actually has available. Excess items remain local, so waiting does
        not consume either the gateway queue clock or provider execution time.
        Transactional gateway admission remains authoritative when two clients
        race for the final advertised slot.

        Killed mid-flight (SIGTERM/Ctrl-C), legacy jobs are cancelled best-effort.
        Durable operations remain available to the independent collector. A
        durable item keeps being polled while its bill settles (``reconciling``
        + ``pending``), exactly as run() does. An item whose destination an
        earlier accepted operation will still deliver returns
        ``pending_delivery`` without being submitted.

        ``deadline`` (a ``time.time()`` instant) is ONE end for the whole
        batch, as a host that kills the command at a fixed time needs: every
        wait also ends there (durable items are handed to background recovery),
        and a queued item is never submitted once the time left is shorter
        than ``submit_reserve_s`` or than the longest item seen in this batch.
        Such items return ``not_started`` with ``not_submitted``: nothing was
        sent or charged for them.

        Results that reached a terminal poll carry `_elapsed_s` (the item's
        submit→terminal wall clock). Results synthesized WITHOUT a round trip
        — a submit-time GatewayError or the trailing "not submitted" filler —
        do not; don't rely on the field for failed items."""
        bound = max(1, max_inflight if max_inflight is not None else MAX_INFLIGHT)
        if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1" and job is not None:
            from _billing_manifest import job_path
            job = job_path(str(job), Path.cwd())
        results: list[dict | None] = [None] * len(items)
        queue = list(enumerate(items))      # (idx, item) still to submit
        inflight: dict[int, tuple[str, float, str | None, dict | None]] = {}
        server_queued: set[int] = set()
        guards: dict[int, Any] = {}
        longest = [0.0]  # the slowest item this batch has finished so far

        def _expired(started: float) -> bool:
            now = time.time()
            return now - started > timeout_s or (deadline is not None and now >= deadline)

        def _out_of_time() -> bool:
            """No queued item may start once its wait could not end before the
            deadline (videoclaw#278 review): it is not sent, so not charged."""
            if deadline is None or not queue:
                return False
            if deadline - time.time() >= max(submit_reserve_s, longest[0]):
                return False
            for index, _ in queue:
                results[index] = {
                    "status": "not_started", "not_submitted": True,
                    "error": "this command's time ran out before it could be submitted",
                }
            queue.clear()
            return True

        def _available_capacity(wanted: int) -> int:
            if wanted <= 0 or len(items) <= 1:
                return wanted
            try:
                snapshot = self.paid_capacity()
            except GatewayError:
                # Rolling-upgrade compatibility: an older gateway has no
                # capacity endpoint. Its transactional admission still keeps
                # spending safe, so retain the existing local bound.
                return wanted
            available = snapshot.get("available")
            if isinstance(available, bool) or not isinstance(available, int):
                raise GatewayError("gateway capacity returned invalid available")
            return min(wanted, max(0, available))

        def _submit_next() -> None:
            if _out_of_time() or server_queued:
                return
            wanted = min(len(queue), bound - len(inflight))
            allowance = _available_capacity(wanted)
            while queue and len(inflight) < bound and allowance > 0:
                if _out_of_time():
                    return
                idx, item = queue.pop(0)
                # Before this item's uploads or any other gateway call (#341).
                sent = {**item, **extra_body}
                try:
                    guards[idx] = self.screen_declined(
                        tool, job, mode=sent.get("mode"), params=sent.get("params"),
                        prompt=sent.get("prompt"), references=sent.get("references"),
                        route={key: sent.get(key) for key in ("model", "model_contract", "engine", "quality")},
                        delivery=item.get("_delivery"))
                except GatewayRepeatRefusedError as e:
                    results[idx] = {"status": "failed", "error": str(e), "not_submitted": True,
                                    "code": _refusal_guard.REPEAT_REFUSED_CODE}
                    continue
                body: dict[str, Any] = {"params": item.get("params") or {}}
                for k in ("mode", "prompt", "quality", "engine", "model",
                          "seconds"):
                    if item.get(k) is not None:
                        body[k] = item[k]
                if item.get("references"):
                    body["references"] = [self._ref(r)
                                          for r in item["references"]]
                if job is not None:
                    body["client_job"] = Path(job).name
                body.update(extra_body)
                t0 = time.time()
                try:
                    context = self._operation_context(job, tool, item.get("_delivery"), item.get("mode"))
                except GatewayError as e:
                    results[idx] = {"status": "failed", "error": str(e), "not_submitted": True}
                    continue
                try:
                    res, operation_id = self._submit_request(
                        tool, body, job, context, item.get("_delivery"),
                        replaces_existing=bool(item.get("_replaces_existing")),
                        submit_by=None if deadline is None
                        else lambda: deadline - max(submit_reserve_s, longest[0]))
                except GatewaySubmitWindowClosedError as e:
                    results[idx] = {"status": "not_started", "not_submitted": True, "error": str(e)}
                    continue
                except GatewayAcceptedError as e:
                    results[idx] = {"status": "accepted_unknown", "error": str(e)}
                    continue
                except GatewayTransientError as e:
                    # The batch boundary has the same ambiguity as run(): a
                    # timeout/5xx may have lost the response after acceptance.
                    # Preserve one unresolved exposure and return a status the
                    # caller explicitly treats as DO-NOT-RETRY.
                    res = {
                        "status": "accepted_unknown",
                        "error": str(e),
                    }
                    if job is not None:
                        self._log_cost(
                            job,
                            tool,
                            item.get("mode"),
                            res,
                            time.time() - t0,
                            quality=item.get("quality", "standard"),
                        )
                    results[idx] = res
                    continue
                except GatewayAuthorizationError as e:
                    results[idx] = {
                        "status": "authorization_required",
                        "error": str(e),
                        "authorization": e.result,
                        **({"not_submitted": True} if e.not_submitted else {}),
                    }
                    continue
                except GatewayDestinationClaimedError as e:
                    # Never a failure to retry under this name: an earlier
                    # purchase delivers it, or (blocked) can never deliver it.
                    results[idx] = {"status": "failed" if e.blocked else "pending_delivery",
                                    "error": str(e), "not_submitted": True, "claimed_by": e.operation_id,
                                    **({"rename_required": True} if e.blocked else {})}
                    continue
                except GatewayNotSubmittedError as e:
                    results[idx] = {"status": "failed", "error": str(e), "not_submitted": True}
                    continue
                except GatewayError as e:
                    results[idx] = {"status": "failed", "error": str(e)}
                    continue
                finally:
                    if context and context.get('local_admission'):
                        # This serial admission blocks collection of existing
                        # siblings too. Their result waits cannot age while a
                        # later item's approval prevents us from polling them.
                        blocked = time.time() - t0
                        for index, (accepted, started, op, owner) in inflight.items():
                            inflight[index] = (accepted, started + blocked, op, owner)
                res = _normalise_paid_response(res)
                # Like run(): a durable operation that finished while its bill
                # settles is still in flight, never a result (videoclaw#294).
                if "job_id" in res and (_operation_unfinished(res) if operation_id
                                        else res.get("status") in IN_PROGRESS_STATUSES):
                    poll_started = time.time() if context and context.get('local_admission') else t0
                    inflight[idx] = (res["job_id"], poll_started, operation_id, context)
                    allowance -= 1
                    if res.get("status") == "queued":
                        # The capacity snapshot raced, or a provider-specific
                        # cap is tighter. Allow at most one gateway-queued item;
                        # keep every remaining batch item local.
                        server_queued.add(idx)
                        break
                else:                        # sync tool / immediate terminal
                    self._finish(job, tool, item, idx, results, res, t0)

        # on_result(index, result) is called once per item as soon as that
        # item ends, so a caller can show each result or refusal while the
        # rest of the batch is still running (videoclaw-app#969).
        reported: set[int] = set()

        def _report() -> None:
            if on_result is None:
                return
            for index, result in enumerate(results):
                if result is not None and index not in reported:
                    reported.add(index)
                    try:
                        on_result(index, result)
                    except Exception:
                        pass  # Progress output must never change the batch outcome.

        with _term_raises():
            try:
                _submit_next()
                _report()
                while inflight or queue:
                    time.sleep(POLL_SECONDS)
                    for idx in list(inflight):
                        job_id, t0, operation_id, context = inflight[idx]
                        if operation_id:
                            try:
                                res = self.recover_operation(Path(job), operation_id, context=context)
                            except GatewayAcceptedError as exc:
                                if (isinstance(exc.__cause__, (GatewayTransientError, _StaleOperationRead))
                                        and not _expired(t0)):
                                    continue
                                res = {"status": "accepted_unknown", "job_id": job_id, "error": str(exc)}
                            if _operation_unfinished(res):
                                if not _expired(t0):
                                    if res.get("status") != "queued":
                                        server_queued.discard(idx)
                                    continue
                                finished = res.get("status") == "reconciling"
                                res = {**res, "status": "reconciling", "reconciliation_required": True,
                                    "error": ("finished and paid; its bill is still settling. " if finished
                                              else "still generating; ") +
                                    "The app keeps this operation and will deliver the file. Do not re-run it."}
                            res = {**res, "_operation_id": operation_id}
                        elif _expired(t0):
                            try:
                                res = self._req("POST", f"/v1/jobs/{job_id}/cancel")
                                res = _normalise_paid_response(
                                    res,
                                    accepted_job_id=job_id,
                                )
                            except GatewayError:
                                res = {
                                    "job_id": job_id,
                                    "status": "reconciling",
                                    "reconciliation_required": True,
                                    "error": f"client timeout after {int(timeout_s)}s; "
                                             "cancellation outcome is not yet known",
                                }
                            if res.get("status") in IN_PROGRESS_STATUSES:
                                res = dict(res)
                                res["status"] = "reconciling"
                                res["reconciliation_required"] = True
                                res.setdefault(
                                    "error",
                                    "provider work is still reconciling; spend remains reserved",
                                )
                        else:
                            try:
                                res = self._req("GET", f"/v1/jobs/{job_id}")
                            except GatewayError:
                                continue     # transient — next tick retries
                            res = _normalise_paid_response(
                                res,
                                accepted_job_id=job_id,
                            )
                            if res.get("status") in IN_PROGRESS_STATUSES:
                                if res.get("status") == "queued":
                                    server_queued.add(idx)
                                else:
                                    server_queued.discard(idx)
                                continue
                        server_queued.discard(idx)
                        del inflight[idx]
                        longest[0] = max(longest[0], time.time() - t0)
                        self._finish(
                            job,
                            tool,
                            items[idx],
                            idx,
                            results,
                            res,
                            t0,
                            accepted_job_id=job_id,
                        )
                    _submit_next()
                    _report()
            except (KeyboardInterrupt, SystemExit):
                for job_id, _, operation_id, _ in inflight.values():
                    if not operation_id:
                        self._cancel_quietly(job_id)
                raise
        for idx, guarded in guards.items():
            _refusal_guard.note(guarded, results[idx])
        return [r if r is not None
                else {"status": "failed", "error": "not submitted"}
                for r in results]

    def paid_capacity(self) -> dict:
        """Return this key's current paid execution-capacity snapshot."""
        result = self._req("GET", "/v1/capacity")
        if result.get("schema") != "videoclaw.paid-capacity/v1":
            raise GatewayError("gateway capacity returned an unknown schema")
        for key in ("limit", "active", "available", "queued", "reconciling"):
            value = result.get(key)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise GatewayError(f"gateway capacity returned invalid {key}")
        if result["active"] + result["available"] > result["limit"]:
            raise GatewayError("gateway capacity totals exceed its limit")
        return result

    def _finish(
        self,
        job,
        tool,
        item,
        idx,
        results,
        res,
        t0,
        *,
        accepted_job_id: str | None = None,
    ) -> None:
        res = _normalise_paid_response(
            res,
            accepted_job_id=accepted_job_id,
        )
        dur = time.time() - t0
        if isinstance(res, dict):
            # Per-ITEM wall clock (submit → terminal), for callers that stamp
            # asset events. Issue #63: batch callers used to stamp every asset
            # with the shared batch elapsed — 15 events × ~380s of phantom
            # time. Plain assignment, not setdefault: the field is
            # engine-internal, and a server-echoed key must never override the
            # client's own measurement.
            res["_elapsed_s"] = round(dur, 3)
        if job is not None:
            try:
                self._log_cost(job, tool, item.get("mode"), res, dur,
                               quality=item.get("quality", "standard"),
                               model=item.get("_ledger_model"))
            except GatewayAcceptedError as exc:
                # Keep siblings and this operation's identity when local
                # accounting needs repair; never turn it into a new purchase.
                res = {**res, "status": "accepted_unknown", "error": str(exc)}
        results[idx] = res

    def _cancel_quietly(self, job_id: str) -> None:
        try:
            self._req("POST", f"/v1/jobs/{job_id}/cancel")
        except Exception:
            pass

    def upload(self, path: Path | str) -> str:
        """Local file → uploads bucket via signed PUT → 'upload:<id>' reference."""
        path = Path(path)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        # The ticket binds these exact bytes (backend#292): storage refuses a
        # PUT whose length or MD5 differs, so a file that changes after this
        # hash fails the upload instead of landing.
        md5, sha256, size = hashlib.md5(), hashlib.sha256(), 0
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                md5.update(chunk)
                sha256.update(chunk)
                size += len(chunk)
        t = self._req("POST", "/v1/uploads",
                      json={"filename": path.name, "content_type": ctype, "size_bytes": size,
                            "md5_base64": base64.b64encode(md5.digest()).decode()})
        with path.open("rb") as fh:
            r = requests.put(t["put_url"], data=fh, headers=t["headers"],
                             timeout=1800)
        r.raise_for_status()
        ref = f"upload:{t['upload_id']}"
        # The refused-request guard knows this reference by its bytes (#341).
        self.remember_media_digest(ref, sha256.hexdigest())
        return ref

    def download(self, asset_url: str, dest: Path | str) -> Path:
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        resolved_url = self.resolve_asset_url(asset_url)
        # Never stream into the final cache/output name. A dropped connection
        # used to leave a plausible-looking partial file behind; SAM3 and other
        # callers could then accept it as a cache hit on the next turn.
        temporary = dest.with_name(
            f".{dest.name}.{os.getpid()}.{time.time_ns()}.part"
        )
        for attempt in range(3):
            try:
                temporary.unlink(missing_ok=True)
                with temporary.open("xb") as fh:
                    self._download_to(resolved_url, fh)
                    fh.flush()
                    os.fsync(fh.fileno())
                temporary.replace(dest)
                return dest
            except requests.RequestException:
                temporary.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                time.sleep(5)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        return dest

    def download_asset(self, asset: dict, dest: Path | str) -> Path:
        """Use the saved delivery intent when this is a recoverable result."""
        operation = asset.get("_operation")
        if not operation:
            return self.download(asset["url"], dest)
        from _operations import deliver, read
        job = Path(operation["job"])
        try:
            record = read(job, operation["id"], operation["context"])
            index = operation["index"]
            if type(index) is not int or not 0 <= index < len(record["outputs"]):
                raise ValueError("asset has no declared destination in this operation")
            expected = job / record["outputs"][index]
            if Path(os.path.abspath(dest)) != Path(os.path.abspath(expected)):
                raise ValueError("download destination differs from the saved operation")
            deliver(job, operation["id"], operation["context"],
                    lambda url, stream: self._download_to(
                        self.resolve_asset_url(url, origin=operation["context"]["gateway_url"]), stream))
        except (GatewayError, OSError, ValueError, KeyError, requests.RequestException) as exc:
            raise GatewayAcceptedError(
                f"Operation {operation['id']} needs file recovery: {exc}. "
                "The original paid result is retained; do not submit a replacement.") from exc
        return Path(dest)

    def note_output(self, asset: dict, dest: Path | str, *, pending_bytes: bytes | None = None) -> None:
        """Stage postprocessed bytes, then acknowledge native publication."""
        operation = asset.get("_operation")
        if operation:
            from _operations import record_delivery
            try:
                record_delivery(Path(operation["job"]), operation["id"], operation["context"],
                                operation["index"], Path(dest), pending_bytes=pending_bytes)
            except (GatewayError, OSError, ValueError, KeyError) as exc:
                raise GatewayAcceptedError(
                    f"Operation {operation['id']} needs publication recovery: {exc}. "
                    "Do not submit a replacement generation.") from exc

    def _download_to(self, resolved_url: str, destination, *, max_bytes: int | None = None,
                     content_type: str | None = None) -> None:
        """One streamed GET, checking empty/truncated responses on both paths."""
        written = 0
        with requests.get(resolved_url, stream=True, timeout=120,
                          headers={"Accept-Encoding": "identity"}) as response:
            response.raise_for_status()
            mime = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if content_type and mime not in {content_type, "application/octet-stream"}:
                raise requests.RequestException("model media returned an unexpected content type")
            declared = response.headers.get("Content-Length")
            try:
                expected = int(declared) if declared is not None else None
            except (TypeError, ValueError) as exc:
                raise requests.RequestException("asset response had an invalid Content-Length") from exc
            if expected is not None and expected < 0:
                raise requests.RequestException("asset response had a negative Content-Length")
            if max_bytes is not None and expected is not None and expected > max_bytes:
                raise requests.RequestException("model media exceeds the import size limit")
            for chunk in response.iter_content(1 << 20):
                if chunk:
                    written += len(chunk)
                    if max_bytes is not None and written > max_bytes:
                        raise requests.RequestException("model media exceeds the import size limit")
                    destination.write(chunk)
        if written <= 0:
            raise requests.RequestException("asset response was empty")
        if expected is not None and written != expected:
            raise requests.RequestException(
                f"asset response was truncated: expected {expected} bytes, received {written}")

    # -- internals ------------------------------------------------------------
    def _ref(self, r) -> str:
        if isinstance(r, (str,)) and r.startswith(("http", "upload:")):
            return r
        return self.upload(r)

    def _poll(self, job_id: str, t0: float, timeout_s: float) -> dict:
        while True:
            if time.time() - t0 > timeout_s:
                try:
                    canceled = self._req("POST", f"/v1/jobs/{job_id}/cancel")
                    canceled = _normalise_paid_response(
                        canceled,
                        accepted_job_id=job_id,
                    )
                except GatewayError:
                    return {
                        "job_id": job_id,
                        "status": "reconciling",
                        "reconciliation_required": True,
                        "error": f"client timeout after {int(timeout_s)}s; "
                                 "cancellation outcome is not yet known",
                    }
                if canceled.get("status") in IN_PROGRESS_STATUSES:
                    canceled = dict(canceled)
                    canceled["status"] = "reconciling"
                    canceled.setdefault(
                        "error",
                        "provider work is still reconciling; spend remains reserved",
                    )
                return canceled
            try:
                res = self._req("GET", f"/v1/jobs/{job_id}")
            except GatewayTransientError:
                # The paid job already exists. Retry retrieval of THIS job id;
                # never bubble a transient poll failure to a caller that might
                # interpret it as permission to POST a replacement generation.
                time.sleep(POLL_SECONDS)
                continue
            res = _normalise_paid_response(
                res,
                accepted_job_id=job_id,
            )
            if res.get("status") not in IN_PROGRESS_STATUSES:
                return res
            time.sleep(POLL_SECONDS)

    def _req(self, method: str, path: str, **kw) -> dict:
        # Headers resolve once: every admission retry below replays the exact
        # same request, operation id included.
        headers = {**kw.pop("headers", {}), **self.request_headers()}
        # The admission window opens on the first proven-busy refusal, so an
        # ordinary request keeps the full request ceiling. Once it is open the
        # window is a real wall-clock bound: it is measured on the monotonic
        # clock, and every retry attempt is itself bounded by what is left of
        # it, so a slow retry cannot silently outlive the advertised deadline.
        opened = None
        delay = ADMISSION_RETRY_BACKOFF_SECONDS
        attempts = 0
        while True:
            attempts += 1
            timeout = (REQUEST_TIMEOUT_SECONDS if opened is None
                       else opened + ADMISSION_RETRY_SECONDS - time.monotonic())
            try:
                return self._request_once(method, path, headers, timeout, **kw)
            except _GatewayAdmissionBusy as busy:
                if opened is None:
                    opened = time.monotonic()
                elapsed = time.monotonic() - opened
                # Never retry earlier than the gateway's own delay.
                wait = max(delay, float(busy.detail.get("retry_after_s") or 0))
                remaining = ADMISSION_RETRY_SECONDS - elapsed - wait
                if remaining < ADMISSION_RETRY_MIN_ATTEMPT_SECONDS:
                    raise _typed(GatewayNotSubmittedError(
                        f"{busy}\n  admission: the gateway refused admission on "
                        f"{attempts} attempts over {elapsed:.1f}s. "
                        "Nothing was submitted, reserved or charged and no output "
                        "was generated; retry this same operation later."
                    ), busy.detail.get("status", 503), busy.detail) from None
                time.sleep(wait)
                delay = min(delay * 2, ADMISSION_RETRY_BACKOFF_MAX_SECONDS)

    def _request_once(self, method: str, path: str, headers: dict,
                      timeout: float = REQUEST_TIMEOUT_SECONDS, **kw) -> dict:
        try:
            r = requests.request(method, f"{self.url}{path}",
                                 headers=headers,
                                 timeout=timeout, **kw)
        except requests.RequestException as e:
            raise GatewayTransientError(f"gateway transport error: {e}") from e
        detail = structured_detail = None
        not_forwarded = False
        if 300 <= r.status_code < 400:
            # Only reachable with allow_redirects=False (requests follows them
            # otherwise): an unfollowed redirect is not an answer.
            raise _typed(GatewayError(f"gateway {r.status_code}: redirect not followed"),
                         r.status_code, None)
        if r.status_code >= 400:
            try:
                body = r.json()
                detail = body.get("detail")
            except (ValueError, AttributeError):
                body = None
            if isinstance(detail, dict):
                structured_detail = detail
            elif isinstance(body, dict) and isinstance(body.get("code"), str):
                # Local proxy errors put flags/code beside a string detail;
                # FastAPI gateway errors nest the same contract under detail.
                structured_detail = {**body, "message": detail if isinstance(detail, str)
                                     else body.get("message")}
            not_forwarded = (
                getattr(r, "headers", {}).get("x-videoclaw-not-forwarded") == "1"
                or (structured_detail is not None
                    and structured_detail.get("not_submitted") is True))
            # A local approval lookup can never forward paid work, so its
            # refusal is as much a proof of non-submission as a refused POST.
            not_forwarded = not_forwarded and (
                method.upper() == "POST" or path.startswith("/v1/local-admissions/"))
            # Root-form 5xx were ambiguous before normalization. Extracting a
            # code must not turn them into failed work or stop recovery reads.
            if (r.status_code >= 500 and not not_forwarded
                    and structured_detail is not None and not isinstance(detail, dict)):
                raise GatewayTransientError(_structured_gateway_error(r.status_code, structured_detail))
        if r.status_code == 402:
            if structured_detail is not None:
                detail = structured_detail
                code = detail.get("code", "SPEND_LIMIT")
                message = detail.get("message") or "approved budget has no room"
                spent = detail.get("spent_usd")
                reserved = detail.get("reserved_usd")
                remaining = detail.get("remaining_usd")
                state = detail.get("state")
                required = detail.get("required_usd", detail.get("estimated_usd"))
                ceiling = detail.get("ceiling_usd", detail.get("budget_usd"))
                alternatives = []
                if float(reserved or 0) > 0:
                    alternatives.append(
                        {
                            "action": "wait_for_in_flight",
                            "reason": "existing work is still reserved",
                        }
                    )
                alternatives.extend(
                    [
                        {
                            "action": "reduce_scope",
                            "strategies": [
                                "reuse existing media",
                                "reduce generated output count or duration",
                                "choose a lower-cost quality setting",
                            ],
                        },
                        {
                            "action": "supply_authorization",
                            "reason": (
                                "ask for a higher ceiling only when the lower-cost "
                                "plan would materially reduce quality"
                            ),
                        },
                    ]
                )
                result = {
                    "schema": AUTHORIZATION_REQUIRED_SCHEMA,
                    "status": "authorization_required",
                    "operation": path,
                    "reason": {"code": _bounded_agent_text(str(code), 120) or "SPEND_LIMIT",
                               "message": _bounded_agent_text(str(message)) or "approved budget has no room"},
                    "financial": {
                        "state": state,
                        "spentUsd": float(spent or 0),
                        "reservedUsd": float(reserved or 0),
                        "availableUsd": float(remaining or 0),
                        **(
                            {"requiredUsd": float(required)}
                            if isinstance(required, (int, float))
                            else {}
                        ),
                        **(
                            {"ceilingUsd": float(ceiling)}
                            if isinstance(ceiling, (int, float))
                            else {}
                        ),
                    },
                    "alternatives": alternatives,
                }
                raise GatewayAuthorizationError(result, not_submitted=not_forwarded)
            raise GatewayAuthorizationError(
                {
                    "schema": AUTHORIZATION_REQUIRED_SCHEMA,
                    "status": "authorization_required",
                    "operation": path,
                    "reason": {
                        "code": "AUTHORIZATION_REQUIRED",
                        "message": _bounded_agent_text(detail) or "financial authorization is unavailable",
                    },
                    "financial": {"state": None},
                    "alternatives": [],
                }, not_submitted=not_forwarded
            )
        if r.status_code >= 400:
            # The proxy receipt covers requests that never left this machine;
            # the gateway's own `not_submitted` covers refusals it made before
            # reservation and provider submission (videoclaw-backend#221). Both
            # are authored by a trusted party about THIS POST, so the operation
            # is closed instead of being recovered as possibly-accepted work.
            if not_forwarded:
                message = (
                    _structured_gateway_error(r.status_code, structured_detail) if structured_detail
                    else f"gateway {r.status_code}: {_bounded_agent_text(r.text, 300)}")
                # Proven-not-submitted AND declared retryable is transient
                # admission backpressure (ACCOUNTING_BUSY at concurrency): the
                # gateway reserved and purchased nothing, so replaying this
                # identical POST cannot duplicate a provider submission. Every
                # other proven refusal keeps its immediate, terminal meaning.
                if structured_detail is not None and structured_detail.get("retryable") is True:
                    raise _typed(_GatewayAdmissionBusy(message), r.status_code, structured_detail)
                raise _typed(GatewayNotSubmittedError(message), r.status_code, structured_detail)

        # A gateway response that explicitly declares retryable=false is a
        # deterministic refusal, even when its HTTP status is 5xx. Surface
        # only the structured, gateway-sanitized fields. Unstructured and
        # retryable 5xx responses remain transient because the paid POST may
        # already have been accepted and must never be submitted again.
        if (structured_detail is not None
                and structured_detail.get("retryable") is False):
            raise _typed(GatewayError(
                _structured_gateway_error(
                    r.status_code,
                    structured_detail,
                    non_retryable=True,
                )
            ), r.status_code, structured_detail)
        if r.status_code in (408, 425, 429) or r.status_code >= 500:
            raise GatewayTransientError(
                f"gateway {r.status_code}: {r.text[:300]}"
            )
        if r.status_code >= 400:
            if structured_detail is not None:
                raise _typed(GatewayError(
                    _structured_gateway_error(r.status_code, structured_detail)
                ), r.status_code, structured_detail)
            raise _typed(GatewayError(f"gateway {r.status_code}: {r.text[:300]}"), r.status_code, None)
        try:
            payload = r.json()
        except ValueError as e:
            # A 2xx only proves the server wrote response headers. Its paid
            # work may already be accepted even when the JSON body is
            # truncated in transit. `run()` therefore records initial POST
            # failures as accepted_unknown, while `_poll()` safely retries the
            # same existing job id.
            raise GatewayTransientError(
                f"gateway {r.status_code}: malformed JSON response"
            ) from e
        if not isinstance(payload, dict):
            raise GatewayTransientError(
                f"gateway {r.status_code}: expected a JSON object response, "
                f"got {type(payload).__name__}"
            )
        return payload

    def _log_cost(self, job, tool, mode, res: dict, dur: float, *,
                  quality: str = "standard",
                  model: str | None = None) -> None:
        try:
            from log import log_event  # videoclaw's job logger
            status = res.get("status")
            # Cost fidelity (videoclaw#63 + the engine half of backend#35): a
            # gateway_call row carries a cost value ONLY when the vendor work
            # succeeded. Non-succeeded rows log estimate_usd=None — mirroring
            # replicate_safe's failure/timeout convention — so a failed or
            # timed-out call can never book spend in run.log.jsonl (local
            # ledger before this fix: 37 failed calls carrying $16.07).
            # cost.py reconcile treats None as no-cost and lists the row in
            # its failed-calls section instead.
            reported = res.get("cost_usd")
            billed_failure = (
                status != "succeeded"
                and isinstance(reported, (int, float))
                and reported > 0
            )
            cost = reported if status == "succeeded" or billed_failure else None
            failure = res.get("failure")
            failure_code = (
                failure.get("code") if isinstance(failure, dict) else None
            )
            extra = {"mode": mode, "quality": quality,
                             "status": status,
                             **({"model": model} if model else {}),
                             "estimate_usd": cost,
                             "cost_source": res.get("cost_source"),
                             "billed_on_failure": billed_failure,
                             **({"failure_code": failure_code}
                                if isinstance(failure_code, str) else {}),
                             "gateway": True}
            if res.get("_operation_id"):
                from _operations import log_cost_once
                log_cost_once(Path(job), res["_operation_id"], extra, dur)
            else:
                log_event(Path(job) if Path(str(job)).is_absolute() else Path("jobs") / str(job),
                          tool, "gateway_call", duration_seconds=dur, extra=extra)
        except Exception as exc:
            if res.get("_operation_id"):
                error = GatewayAcceptedError(
                    f"Operation {res['_operation_id']} needs cost-log recovery: {exc}. "
                    "Do not submit a replacement generation.")
                # Keep the identity on the error, like every other accepted
                # outcome, so a caller can collect this operation instead of
                # buying it again.
                error.operation_id = res["_operation_id"]
                raise error from exc
            pass  # logging must never break a render


gateway = _Gateway()
