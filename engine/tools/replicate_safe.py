"""
replicate_safe — the hang-proof + cost-logged entrypoint for every Replicate call.

WHY THIS EXISTS
===============
Two problems, one wrapper:

1. **Hangs.** `replicate.run()` blocks indefinitely. When a Replicate worker
   stalls (observed silently ~1–3% of the time), the whole tool hangs forever —
   a call that normally takes ~10s has been seen hanging 5+ minutes with no
   output and no error. `safe_run()` polls the prediction over the HTTP API,
   knows each model's expected vs. hard-timeout duration, and CANCELS + RETRIES
   with exponential backoff instead of hanging.

2. **Cost/visibility.** tool_authoring_rules.md rule 9 says every external API
   call should go through a wrapper that logs cost — but `log.log_api_call`
   was never built. `safe_run()` is that wrapper: when given `job=`, it emits a
   `replicate_call` event (model, attempts, wall-clock seconds, and an optional
   `estimate_usd`) to the per-job run log. One layer, both jobs.

It ALSO solves the load_dotenv-after-import-replicate footgun: this module reads
REPLICATE_API_TOKEN at CALL time, not import time.

USAGE
=====
    from dotenv import load_dotenv; load_dotenv()
    from replicate_safe import safe_run

    out = safe_run(
        "lucataco/sam3-video:408f82fc...",
        input={"video": fh, "prompt": "person"},
        job=job_dir,                     # logs a replicate_call event
        estimate_usd=0.05,               # optional; float or callable(output)->float
        tool="sam3.py",
    )
    # out is whatever the model outputs (URL string / list / FileOutput / dict).

Drop-in replacement for `replicate.run(model, input=...)`: same return shape.
File-like values in `input` are uploaded to Replicate /files first (the
predictions API needs URLs, not handles).

COMMON FAILURE MODES
====================
- "REPLICATE_API_TOKEN not set" → call `load_dotenv()` before `safe_run()`.
- A brand-new model hanging past its DEFAULT_HARD timeout → add it to EXPECTED
  with (typical_s, hard_s ≈ 3–4× typical) so the soft-warn and hard-timeout fire
  at the right time instead of the conservative default.
- `RuntimeError: safe_run failed after N attempts` → the model genuinely failed
  (bad input / moderation / outage), not a hang. Read the `last_err` in the message.
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable, Optional, Union

import requests

try:  # log is a sibling tool; import is best-effort so this module stays usable standalone
    from log import log_event
except Exception:  # pragma: no cover
    log_event = None  # type: ignore


# (typical_seconds, hard_timeout_seconds) per model. Strip ":version" before lookup.
# typical_s = observed in smoke tests; hard_s ≈ 3–4× typical (exceed it → it's hung).
EXPECTED: dict[str, tuple[int, int]] = {
    # Image
    "openai/gpt-image-2":                (60, 180),
    "black-forest-labs/flux-dev":        (15, 90),
    "black-forest-labs/flux-1.1-pro":    (20, 120),
    # Video (image-to-video / avatar)
    "bytedance/seedance-2.0":            (90, 360),
    "kwaivgi/kling-v3-omni-video":       (200, 600),
    "wan-video/wan-2.5-i2v-fast":        (60, 240),
    "wan-video/wan-2.2-i2v-fast":        (60, 240),
    # Segmentation
    "lucataco/sam3-video":               (120, 420),   # ~5s compute per 1s input
    # Audio
    "minimax/speech-02-hd":              (30, 120),
    # Speech enhancement — runtime (incl. cold start) ≈ clip length (UNCONFIRMED,
    # JC 2026-07-16); clean_audio passes per-call expected/max derived from the
    # actual clip duration (max(120s, 3× clip)), so these defaults rarely apply.
    "resemble-ai/resemble-enhance":      (60, 300),
}

DEFAULT_TYPICAL = 60
DEFAULT_HARD = 240


def _model_key(model_ref: str) -> str:
    """Strip ':version_hash' from 'owner/model:hash'."""
    return model_ref.split(":", 1)[0]


def _serialize_input(inp: dict, token: str) -> dict:
    """Replace any file-like value with an uploaded Replicate /files URL.

    The predictions HTTP API takes URLs, not open handles — so we upload first.
    """
    out: dict = {}
    headers = {"Authorization": f"Token {token}"}
    for k, v in inp.items():
        if hasattr(v, "read"):
            data = v.read()
            r = requests.post(
                "https://api.replicate.com/v1/files",
                headers=headers,
                files={"content": (getattr(v, "name", "upload.bin"), data)},
                timeout=120,
            )
            r.raise_for_status()
            out[k] = r.json()["urls"]["get"]
        else:
            out[k] = v
    return out


def safe_run(
    model_ref: str,
    input: dict,
    *,
    job: Optional[Any] = None,
    estimate_usd: Optional[Union[float, Callable[[Any], float]]] = None,
    tool: Optional[str] = None,
    expected_seconds: Optional[int] = None,
    max_wait_seconds: Optional[int] = None,
    max_attempts: int = 2,
    poll_every: float = 2.0,
    api_token: Optional[str] = None,
    verbose: bool = True,
) -> Any:
    """Run a Replicate prediction with a hard timeout, auto-cancel + retry, and
    (when `job` is given) a cost/duration event in the per-job run log.

    Returns the prediction's `output` (model-dependent shape). Raises RuntimeError
    on permanent failure after `max_attempts`.

    `model_ref` should be "owner/model:version_hash" (recommended — pins the
    version) or "owner/model" (latest). `estimate_usd` is logged, not enforced:
    pass a float, or a callable that maps the output to a USD estimate.
    """
    token = api_token or os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN not set (load_dotenv() first?)")

    key = _model_key(model_ref)
    typ, hard = EXPECTED.get(key, (DEFAULT_TYPICAL, DEFAULT_HARD))
    expected_seconds = expected_seconds if expected_seconds is not None else typ
    max_wait_seconds = max_wait_seconds if max_wait_seconds is not None else hard

    H = {"Authorization": f"Token {token}", "Content-Type": "application/json"}
    payload_input = _serialize_input(input, token)

    t_start = time.time()
    last_err = None
    for attempt in range(1, max_attempts + 1):
        if verbose:
            print(
                f"[safe_run] attempt {attempt}/{max_attempts} → {key} "
                f"(expect ~{expected_seconds}s, timeout {max_wait_seconds}s)",
                flush=True,
            )

        if ":" in model_ref:
            _, rest = model_ref.split("/", 1)
            _, version = rest.split(":", 1)
            url = "https://api.replicate.com/v1/predictions"
            body = {"version": version, "input": payload_input}
        else:
            url = f"https://api.replicate.com/v1/models/{model_ref}/predictions"
            body = {"input": payload_input}

        try:
            r = requests.post(url, json=body, headers=H, timeout=30)
            r.raise_for_status()
        except Exception as e:
            detail = ""
            try:
                detail = " | " + r.text[:300]  # type: ignore
            except Exception:
                pass
            last_err = f"create failed: {e}{detail}"
            if verbose:
                print(f"  ! {last_err}", flush=True)
            time.sleep(2 ** attempt)
            continue

        pred = r.json()
        pid = pred["id"]
        status_url = pred["urls"]["get"]
        cancel_url = pred["urls"].get("cancel")

        t0 = time.time()
        last_status = None
        warned_slow = False
        output = None
        while True:
            elapsed = time.time() - t0

            if elapsed > max_wait_seconds:
                if verbose:
                    print(f"  ! TIMEOUT after {elapsed:.0f}s in status={last_status} "
                          f"(pid={pid}) — cancelling", flush=True)
                if cancel_url:
                    try:
                        requests.post(cancel_url, headers=H, timeout=10)
                    except Exception:
                        pass
                last_err = f"hard timeout in status={last_status} after {elapsed:.0f}s"
                break

            if not warned_slow and elapsed > expected_seconds * 2:
                if verbose:
                    print(f"  ⚠ slow: {elapsed:.0f}s elapsed (typical {expected_seconds}s), "
                          f"status={last_status} — still polling", flush=True)
                warned_slow = True

            try:
                s = requests.get(status_url, headers=H, timeout=15).json()
            except Exception:
                time.sleep(poll_every)
                continue

            if s["status"] != last_status:
                last_status = s["status"]
                if verbose:
                    print(f"  · {last_status} (t+{elapsed:.0f}s, pid={pid})", flush=True)

            if s["status"] == "succeeded":
                if verbose:
                    print(f"  ✓ done in {elapsed:.0f}s", flush=True)
                output = s["output"]
                _log(job, tool, model_ref=key, event="replicate_call",
                     attempt=attempt, seconds=time.time() - t_start,
                     estimate_usd=estimate_usd, output=output, status="succeeded")
                return output

            if s["status"] in ("failed", "canceled"):
                last_err = s.get("error") or f'status={s["status"]}'
                if verbose:
                    print(f"  ! {last_err}", flush=True)
                break

            time.sleep(poll_every)

        if attempt < max_attempts:
            wait = 2 ** attempt
            if verbose:
                print(f"  retrying in {wait}s …", flush=True)
            time.sleep(wait)

    _log(job, tool, model_ref=key, event="replicate_call_failed",
         attempt=max_attempts, seconds=time.time() - t_start,
         estimate_usd=None, output=None, status="failed", error=last_err)
    raise RuntimeError(f"safe_run failed after {max_attempts} attempts: {last_err}")


def _log(job, tool, *, model_ref, event, attempt, seconds, estimate_usd, output,
         status, error=None) -> None:
    """Best-effort cost/duration event to the per-job run log. Never raises."""
    if job is None or log_event is None:
        return
    usd = None
    try:
        usd = estimate_usd(output) if callable(estimate_usd) else estimate_usd
    except Exception:
        usd = None
    extra = {
        "provider": "replicate",
        "model": model_ref,
        "attempt": attempt,
        "status": status,
    }
    if usd is not None:
        extra["estimate_usd"] = round(float(usd), 4)
    if error:
        extra["error_message"] = str(error)[:300]
    try:
        log_event(job, tool=tool or "replicate_safe.py", event=event,
                  duration_seconds=seconds, extra=extra)
    except Exception:
        pass


def run_with_timeout(
    model_ref: str,
    input: dict,
    *,
    job: Optional[Any] = None,
    tool: Optional[str] = None,
    estimate_usd: Optional[Union[float, Callable[[Any], float]]] = None,
    timeout: Optional[int] = None,
) -> Any:
    """TRUE drop-in for `replicate.run(model, input=...)` — same return object
    (FileOutput / list), but with a HARD timeout that kills a SILENT hang, plus a
    `replicate_call` cost/duration log.

    Why not `safe_run`? `safe_run` polls the HTTP API and returns raw output URLs,
    which changes the return type; downstream code that expects FileOutputs
    (`.url` / `.read()`) breaks. This wraps `replicate.run` itself in a DAEMON
    thread and abandons it on timeout (the SDK gives no cancel handle), so a hung
    worker raises TimeoutError — which the caller's existing retry loop catches —
    instead of blocking forever. The daemon thread never blocks process exit.
    """
    import threading
    import replicate  # lazy — token read at call time via the SDK

    key = _model_key(model_ref)
    typ, hard = EXPECTED.get(key, (DEFAULT_TYPICAL, DEFAULT_HARD))
    timeout = timeout if timeout is not None else hard

    box: dict[str, Any] = {}

    def _target() -> None:
        try:
            box["out"] = replicate.run(model_ref, input=input)
        except Exception as e:  # capture to re-raise on the caller thread
            box["err"] = e

    t0 = time.time()
    th = threading.Thread(target=_target, daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        _log(job, tool, model_ref=key, event="replicate_call_timeout", attempt=1,
             seconds=time.time() - t0, estimate_usd=None, output=None, status="timeout")
        raise TimeoutError(
            f"replicate.run({key}) exceeded {timeout}s hard timeout — silent worker hang "
            f"(abandoned; caller should retry)")
    if "err" in box:
        raise box["err"]
    _log(job, tool, model_ref=key, event="replicate_call", attempt=1,
         seconds=time.time() - t0, estimate_usd=estimate_usd, output=box.get("out"),
         status="succeeded")
    return box.get("out")


def download(url_or_obj: Any, out_path: str, *, timeout: int = 600) -> int:
    """Resolve a Replicate output (str URL / list / FileOutput / dict) → save to disk.
    Returns bytes written."""
    if isinstance(url_or_obj, list):
        url_or_obj = url_or_obj[0]
    if isinstance(url_or_obj, str):
        url = url_or_obj
    else:
        url = getattr(url_or_obj, "url", None) or str(url_or_obj)
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        f.write(r.content)
    return len(r.content)


if __name__ == "__main__":
    import sys
    print("replicate_safe — import and call safe_run(model, input, job=...). "
          "EXPECTED models:", file=sys.stderr)
    for k, (t, h) in EXPECTED.items():
        print(f"  {k}: typical {t}s / hard {h}s", file=sys.stderr)
