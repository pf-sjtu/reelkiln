"""Private native model-call entry point; shares the engine's recovery journal."""
import argparse
import json
import os
import re
import sys
from pathlib import Path

from _gateway import (gateway, GatewayAcceptedError, GatewayError,
                      GatewayAuthorizationError)
from _operations import delivered_paths, final_view
from _refusal_guard import file_sha256

# Top-level media inputs only. Other strings are never treated as files.
_MEDIA_FIELD = re.compile(r"[a-z0-9_]*_urls?")


def _local_reference(value: str, job: Path) -> Path | None:
    """The file inside this video that a reference names; None for a hosted URL."""
    if value.startswith(("https://", "http://")):
        return None
    root = job.resolve()
    # Relative to this video, to the workspace (jobs/<id>/...), or absolute;
    # the real path (after symlinks) must still be a file inside this video.
    workspace = Path(os.environ.get("VIDEOCLAW_WORKSPACE") or Path.cwd())
    path = next((candidate for candidate in ((job / value).resolve(), (workspace / value).resolve())
                 if candidate.is_relative_to(root) and candidate.is_file()), None)
    if path is None:
        raise ValueError(f"reference {value!r} must be an https URL or a file inside this video "
                         "(relative to the video or the workspace, or absolute)")
    return path


def _hosted(value: str, job: Path) -> str:
    """Upload one file owned by this video; hosted URLs pass unchanged."""
    path = _local_reference(value, job)
    if path is None:
        return value
    upload = gateway.upload(path)
    read_url = gateway._req("GET", f"/v1/uploads/{upload.removeprefix('upload:')}")["read_url"]
    digest = gateway.media_digest(upload)
    if digest:
        # The refused-request guard knows the read URL by the file's bytes (#341).
        gateway.remember_media_digest(read_url, digest)
    return read_url


def _local_digests(params: dict, job: Path) -> dict[str, str]:
    """sha256 of each local reference, read before anything is uploaded."""
    digests = {}
    for field, value in params.items():
        values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
        if not _MEDIA_FIELD.fullmatch(field) or not all(isinstance(item, str) for item in values):
            continue
        for item in values:
            path = _local_reference(item, job)
            if path is not None:
                digests[item] = file_sha256(path)
    return digests


def _prepare_references(params: dict, job: Path) -> dict:
    prepared = dict(params)
    for field, value in params.items():
        if not _MEDIA_FIELD.fullmatch(field):
            continue
        if isinstance(value, str):
            prepared[field] = _hosted(value, job)
        elif isinstance(value, list) and all(isinstance(item, str) for item in value):
            prepared[field] = [_hosted(item, job) for item in value]
    return prepared


def _refusal(exc: GatewayError) -> dict:
    """One next action per outcome; never a license to buy the work twice."""
    detail = getattr(exc, "detail", {}) or {}
    terminal = (getattr(exc, "result", None) or {})
    if isinstance(exc, GatewayAcceptedError) and terminal.get("status") in ("failed", "canceled", "timeout"):
        # The provider finished this one operation; its bill is already recorded.
        # A terminal status alone does not establish an input fault.
        return {**terminal, "ok": False, "retryable": False, "next_action": "report_failure",
                "reason": f"{str(exc)[:900]} This terminal status does not prove invalid input. "
                          "If the reported details do not identify a cause, the cause is unknown. "
                          "Do not retry automatically; tell the user. A new attempt is a new paid "
                          "generation for the user to decide."}
    if isinstance(exc, GatewayAcceptedError):
        # Accepted or possibly accepted: only the original operation may resolve it.
        operation_id = getattr(exc, "operation_id", None) or terminal.get("_operation_id")
        return {"ok": False, "status": "pending", "retryable": False, "next_action": "resume_original",
                **({"operation_id": operation_id} if operation_id else {}),
                "reason": f"{str(exc)[:900]} The app keeps collecting this original operation; "
                          "do not call the model again for it."}
    result = {"ok": False, "reason": str(exc)[:1200],
              **{field: detail[field] for field in ("code", "retry_after_s", "stage") if field in detail}}
    if detail.get("retryable") is True and detail.get("not_submitted") is True:
        return {**result, "retryable": True, "not_submitted": True, "next_action": "retry_presubmit"}
    return {**result, "retryable": False,
            **({"not_submitted": True} if detail.get("not_submitted") is True else {}),
            "next_action": "auth" if detail.get("status") in (401, 403) else "change_input"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    try:
        if os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") != "1":
            raise ValueError("native model recovery is unavailable; paid work was not started")
        request = json.load(sys.stdin)
        if (not isinstance(request, dict) or not isinstance(request.get("model_slug"), str)
                or not isinstance(request.get("input"), dict)):
            raise ValueError("native model request is malformed")
        # An unchanged re-submit of a declined request stops here, before any
        # upload or other gateway call (#341); run() checks again after upload.
        gateway.screen_declined(
            "model_call", args.job, params=request["input"],
            route={"model": request["model_slug"], "model_contract": request.get("model_contract")},
            local_digests=_local_digests(request["input"], args.job))
        params = _prepare_references(request["input"], args.job)
        result = gateway.run("model_call", job=args.job, model=request["model_slug"],
            params=params, **({"model_contract": request["model_contract"]}
                              if request.get("model_contract") else {}))
        try:
            record = gateway.collect_operation(args.job, result["_operation_id"])
            result = {**final_view(record["result"]), "ok": True, "imported": True,
                      "saved": delivered_paths(args.job, record)}
        except (GatewayError, OSError, ValueError) as exc:
            result = {**result, "ok": True, "imported": False, "saved": [],
                      "operation_id": result["_operation_id"], "next_action": "resume_original",
                      "reason": "Generation succeeded; the app is collecting its original media. "
                                "Do not generate it again.",
                      "import_errors": [str(exc)[:1200]]}
        result["retryable"] = False
    except GatewayAuthorizationError as exc:
        result = {**exc.result, "ok": False, "retryable": False, "next_action": "user_budget"}
    except GatewayError as exc:
        result = _refusal(exc)
    except (OSError, ValueError) as exc:
        result = {"ok": False, "retryable": False, "next_action": "change_input",
                  "reason": str(exc)[:1200]}
    result = {key: value for key, value in result.items() if not key.startswith("_")}
    if isinstance(result.get("assets"), list):
        result["assets"] = [{key: value for key, value in asset.items() if not key.startswith("_")}
                            for asset in result["assets"]]
    print(json.dumps(result))


if __name__ == "__main__":
    main()
