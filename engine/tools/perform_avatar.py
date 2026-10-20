"""
perform_avatar — render the avatar speaking (Seedance 2.0 via the gateway).

Canonical, self-contained consolidation of the legacy `seedance.py` backend.
Feeds the cast stills (BytePlus avatar URLs) + per-chunk motion prompts to
Seedance 2.0 and produces talking-head / B-roll `chunk_<NN>.mp4` files. This is
the EXECUTION engine of the idea-to-avatar pipeline: it does NOT design the
character (→ cast_avatar) or write the script (→ check_script); it renders it.

    # All chunks IN PARALLEL (default — avatar URL anchors identity):
    uv run python tools/perform_avatar.py --job <id>

    # Regenerate ONE chunk by index (replaces chunk_NN.mp4; the old take
    # moves to previous_takes/<UTC time>/chunks/):
    uv run python tools/perform_avatar.py --job <id> --chunk 2

    # Opt-in sequential mode (prev chunk fed as [Video1] continuity reference):
    uv run python tools/perform_avatar.py --job <id> --sequential

    # Escalate to 1080p (default is 720p — cheaper + faster):
    uv run python tools/perform_avatar.py --job <id> --resolution 1080p

Reads:  <job_dir>/script.json
        <job_dir>/avatar/character_sheet.json
Writes: <job_dir>/chunks/chunk_<NN>.mp4

Seedance 2.0 semantic inputs:
  prompt           — text prompt. Use the pipeline's canonical [Image1] /
                     [Video1] tokens; the gateway translates them to Fal's
                     @Image1 / @Video1 syntax at the provider boundary.
                     PROMPTS MUST INCLUDE THE EXACT DIALOGUE LINE — Seedance does
                     NOT see script.json["chunks"][i]["dialogue"]. If the line
                     of dialogue isn't quoted inside `seedance_prompt`, the model
                     improvises mouth shapes / random words and the video is
                     unusable. This file enforces that with a startup check.
  duration         — seconds (4-15). clamp(round(end_sec-start_sec), 4, 15).
  resolution       — "720p" | "1080p"   (720p is the repo default — MEMORY).
  aspect_ratio     — "9:16"             (hard-coded).
  generate_audio   — True               (hard-coded — audio comes from Seedance.
                     ElevenLabs is for TRANSCRIPTION ONLY, never disabled here).
  reference_images — list of image URLs. Avatar anchor (BytePlus URL).
  reference_videos — list of video URLs. Prev chunk for continuity (--sequential).
  reference_audios — list of audio files (unused).
  seed             — chunk_index * 42 except qualified recovery-enabled gateway calls
                     with an avatar reference, which omit it for qualified face fallback.

Avatar reference flow (CRITICAL):
  Photorealistic faces uploaded as a local PNG can trigger face-detection
  moderation. Use the BytePlus URL returned by Seedream 5 Lite with
  `return_byteplus_urls=True` (minted by cast_avatar). Those URLs are trusted
  Seedance inputs.

  This tool reads `avatar_byteplus_urls.<image_ref>` from character_sheet.json
  and uses that URL directly. If the URL is missing or expired (~24h TTL), it
  raises. Regenerate with cast_avatar.py to mint fresh URLs. **image_ref key
  consistency is load-bearing**: it must be identical across all chunks or
  Seedance drifts to a different face on each render.

  Seedance's own moderation can still refuse a photoreal generated face as a
  possible likeness of a real person (content_policy_violation). That is the
  provider's policy, not VideoClaw's, and rewording does not help. The tool
  waits for the gateway's final result without narrating internal face fallback.
  Qualification is in workflows/avatar-speaker.md#if-seedance-refuses-the-face.
  After terminal failure, it prints the Gemini Omni image-to-video next step
  (the app's `call_model` with google-gemini-omni-flash-image-to-video; see
  workflows/avatar-speaker.md). Every failed chunk reports its own cause, so a
  spending-settings stop is never shown as a content refusal.

Parallel vs sequential:
  Default = PARALLEL. The avatar BytePlus URL anchors visual identity across
  every chunk, so prev-chunk video continuity is usually unnecessary and the
  speedup is large (4 chunks finish in ~1 chunk worth of wall time). Use
  --sequential only when you actually want the previous chunk's motion / framing
  to inform the next (rare for talking-head shorts).

Self-contained: this tool does NOT import the legacy seedance.py backend (it is
being deleted). All of its logic is inlined here. It DOES import the surviving
shared helpers (job.py, log.py) and the surviving script_preflight.py gate.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import replicate
import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from job import (resolve_job_dir, add_job_arg, billing_input_path,
                 billing_optional_input_path)  # noqa: E402
from log import log_event  # noqa: E402
from replicate_safe import run_with_timeout  # noqa: E402 — hard timeout on silent hangs + cost log
from _gateway import (gateway, GatewayAuthorizationError, GatewayError,  # noqa: E402  dual mode: VIDEOCLAW_API_KEY set → gateway routes Seedance
                      GatewayNotSubmittedError)
from _takes import PaidTake, file_sha256, write_atomic  # noqa: E402

load_dotenv()

os.environ["REPLICATE_API_TOKEN"] = os.environ.get("REPLICATE_API_TOKEN", "")

TOOL_NAME = "perform_avatar.py"
SEEDANCE_MODEL = "bytedance/seedance-2.0"
BYTEPLUS_URL_TTL_HOURS = 24


# ---------------------------------------------------------------------------
# Avatar BytePlus URL resolution (+ 24h TTL freshness check).
# ---------------------------------------------------------------------------
def _check_url_freshness(generated_at: str | None, ttl: int) -> None:
    if not generated_at:
        return
    gen_dt = datetime.fromisoformat(generated_at)
    age = datetime.now(timezone.utc) - gen_dt
    if age >= timedelta(hours=ttl):
        raise RuntimeError(
            f"BytePlus URL is {age} old (>{ttl}h TTL). It has expired. "
            f"Re-run cast_avatar.py --regen-front to mint fresh trusted URLs."
        )


def get_avatar_url(avatar_dir: Path, image_ref: str | None) -> str | None:
    """Resolve the per-chunk avatar BytePlus URL.

    `image_ref` is the chunk-level pointer into character_sheet.json's
    avatar_byteplus_urls map. If not specified, falls back to "front".
    Returns None when the chunk explicitly opts out of any avatar reference
    (image_ref == "" or False, or no character sheet exists).
    """
    if image_ref is False or image_ref == "":
        return None  # Explicit opt-out: B-roll, typography, etc.

    original_sheet = avatar_dir / "character_sheet.json"
    sheet_path = billing_optional_input_path(original_sheet)
    if sheet_path is None:
        if image_ref:
            raise FileNotFoundError(
                f"{original_sheet} not found but chunk requested image_ref={image_ref!r}.")
        return None

    sheet = json.loads(sheet_path.read_text())
    urls = sheet.get("avatar_byteplus_urls") or {}
    name = image_ref or "front"
    url = urls.get(name)
    if not url:
        raise RuntimeError(
            f"character_sheet.json has no avatar_byteplus_urls.{name!r}. "
            f"Available: {sorted(urls.keys())}. Mint it with:\n"
            f"  cast_avatar.py --add-shot {name} --prompt '<seedream prompt>'"
        )

    _check_url_freshness(
        sheet.get("byteplus_urls_generated_at_utc"),
        sheet.get("byteplus_urls_ttl_hours", BYTEPLUS_URL_TTL_HOURS),
    )
    return url


# Backwards compat — older code/scripts may still call get_avatar_byteplus_url.
def get_avatar_byteplus_url(avatar_dir: Path) -> str:
    url = get_avatar_url(avatar_dir, image_ref="front")
    if url is None:
        raise RuntimeError("No front avatar URL available. Run cast_avatar.py.")
    return url


# ---------------------------------------------------------------------------
# Prompt validation — fail fast before spending Seedance credits.
# ---------------------------------------------------------------------------
def validate_prompt(chunk: dict, chunk_index: int) -> None:
    """Soft-check the chunk's prompt before spending Seedance credits.

    Philosophy: Claude is an intelligent agent and writes prompts directly.
    The validator is a thin guardrail for a single, narrow class of failure
    that wastes credits — a chunk that DECLARES dialogue but doesn't quote it
    in the Seedance prompt. (Seedance only sees `seedance_prompt`; the
    `dialogue` field is for our reference.) Beyond that, trust the agent.

    We do NOT validate:
      • chunk type (no enum — broll/talking_head/typography is metadata)
      • presence of [Image1] (B-roll, typographic, environment shots may
        legitimately have no avatar reference at all)
      • prompt length, lighting language, anchor presence — read the prompting
        guide before writing prompts; don't lean on the validator.
    """
    prompt = chunk.get("seedance_prompt", "")
    dialogue = (chunk.get("dialogue") or "").strip()
    if not prompt:
        raise ValueError(f"Chunk {chunk_index}: seedance_prompt is empty")
    if not dialogue:
        return

    def normalise(s: str) -> str:
        # Strip non-word/non-space chars to spaces, then collapse whitespace.
        # Preserves substring matching when em-dashes/quotes leave gaps:
        # "installed — but" → "installed but" (not "installed   but").
        return " ".join(re.sub(r"[^\w\s]", " ", s).lower().split())

    norm_prompt = normalise(prompt)

    # Split dialogue into sentences and confirm each is referenced in the prompt.
    # This works for both patterns:
    #   • Short single-shot chunks (one sentence appears once, quoted)
    #   • Long timeline-segmented chunks (each sentence appears in its own
    #     [00:00-00:04] He speaks: "..." block)
    # Per sentence: the first 5 normalised words must appear in the prompt.
    sentences = [s.strip() for s in re.split(r"[.!?]+", dialogue) if s.strip()]
    missing: list[str] = []
    for sentence in sentences:
        norm = normalise(sentence)
        head = " ".join(norm.split()[:5])
        if head and head not in norm_prompt:
            missing.append(sentence)

    if missing:
        sample = missing[0][:80]
        raise ValueError(
            f"Chunk {chunk_index}: seedance_prompt is missing dialogue line(s). "
            f"Seedance only sees the prompt — every spoken sentence must appear "
            f"in the prompt (quoted, ideally inside a 'He speaks: \"...\"' "
            f"block for long timeline-segmented chunks).\n\n"
            f"  Missing line: \"{sample}...\"\n"
            f"  ({len(missing)} of {len(sentences)} sentence(s) not found)\n\n"
            f"Read skills/seedance_prompting_guide.md §0 (long-chunk "
            f"pattern) and §17.1.2. If this chunk is intentionally pure "
            f"voiceover-over-broll, remove the `dialogue` field."
        )


# ---------------------------------------------------------------------------
# Failure causes — every failed chunk is reported for what actually stopped it.
# ---------------------------------------------------------------------------
# Seedance's moderation refuses many photoreal generated faces as "may contain
# likenesses of real people". Only the provider's own signals count, never
# ordinary words like "moderation": through the gateway, a failed job whose
# error or agent_detail carries the `content_policy_violation` code; on the
# direct Replicate route, E005 ("flagged as sensitive").
_GATEWAY_REFUSAL = re.compile(r"\bcontent_policy_violation\b")
_DIRECT_REFUSAL = re.compile(r"\bE005\b|flagged as sensitive")
# The app's spending settings or the gateway's authorization stopped the
# request (AUTHORIZATION_REQUIRED, 409 SPEND_POLICY_CHANGED); Seedance never
# judged it.
_SPEND_CODE = re.compile(r"\b(?:SPEND_[A-Z_]+|AUTHORIZATION_REQUIRED|ACCOUNT_DEBT)\b")
# Gemini Omni image-to-video makes 3–10s per call from one still.
OMNI_I2V_MODEL = "google-gemini-omni-flash-image-to-video"
OMNI_MIN_SECONDS, OMNI_MAX_SECONDS = 3, 10
OMNI_TALKING_SHOT = (
    "The person in the image speaks to the camera, keeping the framing of the "
    "image: natural mouth and jaw movement as if talking, small head and "
    "shoulder motion, the same face, hair, clothing and background, locked "
    "camera, no hands in frame."
)


def _spend_code(exc: BaseException) -> str | None:
    if isinstance(exc, GatewayAuthorizationError):
        reason = exc.result.get("reason") if isinstance(exc.result, dict) else None
        return (reason or {}).get("code") or "AUTHORIZATION_REQUIRED"
    detail = getattr(exc, "detail", None)
    code = detail.get("code") if isinstance(detail, dict) else None
    if isinstance(code, str) and _SPEND_CODE.fullmatch(code):
        return code
    match = _SPEND_CODE.search(str(exc))
    return match.group(0) if match else None


def _failed_result(exc: BaseException) -> dict:
    result = getattr(exc, "result", None)
    return result if isinstance(result, dict) else {}


def _is_seedance_refusal(exc: BaseException) -> bool:
    if isinstance(exc, GatewayError):
        result = _failed_result(exc)
        text = " ".join(str(result.get(k) or "") for k in ("error", "agent_detail"))
        return result.get("status") == "failed" and bool(_GATEWAY_REFUSAL.search(text))
    return bool(_DIRECT_REFUSAL.search(str(exc)))


def failure_cause(exc: BaseException) -> str:
    """'spend', 'seedance_refusal' or 'error' for one failed chunk."""
    if _spend_code(exc):
        return "spend"
    return "seedance_refusal" if _is_seedance_refusal(exc) else "error"


def describe_failure(exc: BaseException) -> str:
    cause = failure_cause(exc)
    if cause == "spend":
        return (f"stopped by the app's spending settings ({_spend_code(exc)}). "
                "Seedance did not refuse it.")
    if cause == "seedance_refusal":
        result = _failed_result(exc)
        charged = " Nothing was charged for it." if result.get("cost_usd") == 0 else ""
        said = " ".join(str(result.get("agent_detail") or "").split())[:240]
        return ("Seedance's moderation refused the face as a possible likeness of a "
                f"real person (content policy).{charged}"
                + (f" Provider detail: {said}" if said else ""))
    return str(exc)


def omni_calls(chunk: dict) -> list[dict]:
    """The app's `call_model` input for one chunk's Gemini Omni motion step.

    A chunk longer than one Omni call becomes equal parts to join before lipsync.
    """
    ref = chunk.get("image_ref", "front")
    if ref is False or ref == "":
        return []
    seconds = float(chunk["end_sec"]) - float(chunk["start_sec"])
    parts = max(1, math.ceil(seconds / OMNI_MAX_SECONDS))
    part_seconds = max(OMNI_MIN_SECONDS, min(math.ceil(seconds / parts), OMNI_MAX_SECONDS))
    step = {"model_slug": OMNI_I2V_MODEL,
            "input": {"prompt": OMNI_TALKING_SHOT,
                      "image_url": f"avatar/avatar_{ref or 'front'}.png",
                      "duration": part_seconds, "aspect_ratio": "9:16"}}
    return [step] * parts


def report_failures(chunks: list[dict], failures: dict[int, BaseException]) -> None:
    """Name each failed chunk's own cause, then the next step for each kind."""
    print(f"\n✗ {len(failures)} chunk(s) failed:")
    for i in sorted(failures):
        print(f"  chunk {i}: {describe_failure(failures[i])}")
        if isinstance(failures[i], GatewayAuthorizationError):
            # Keep the machine-readable refusal the CLI boundary would print.
            sys.stderr.write(f"{failures[i]}\n")

    causes = {i: failure_cause(e) for i, e in failures.items()}
    refused = [i for i in sorted(causes) if causes[i] == "seedance_refusal"]
    stopped = [i for i in sorted(causes) if causes[i] == "spend"]
    if refused:
        print(
            f"\nSeedance refused chunk(s) {', '.join(map(str, refused))}. That is "
            "Seedance's own moderation, which blocks many photoreal generated faces; "
            "it is not a VideoClaw or studio rule, so say so when you tell the user. "
            "Rewording the prompt will not help, and re-running it unchanged will be "
            "refused again.\n"
            "Recommended next step (offer it first): make these chunks with Gemini "
            "Omni image-to-video from the same still, through the app's call_model "
            f"tool. Run search_models for {OMNI_I2V_MODEL}, then call_model with "
            "that model_slug, the model_contract search_models returns, and each "
            "input below. Each call makes a talking motion base of "
            f"{OMNI_MIN_SECONDS}-{OMNI_MAX_SECONDS}s; then voice and lipsync it "
            "into chunks/chunk_NN.mp4, with one voice for every chunk, as "
            "workflows/avatar-speaker.md shows (\"If Seedance refuses the face\"). "
            "Do not substitute another model or mint_video mode.")
        for i in refused:
            calls = omni_calls(chunks[i])
            if not calls:
                print(f"  chunk {i}: no avatar still (image_ref is empty); Omni needs one.")
            elif len(calls) > 1:
                print(f"  chunk {i} is longer than one Omni call: make these "
                      f"{len(calls)} parts and join them in order before lipsync.")
            for call in calls:
                print(f"  call_model {json.dumps(call)}")
        print("Other options: a stylized (illustrated) presenter, or faceless "
              "voiceover + B-roll.")
    if stopped:
        print(
            f"\nChunk(s) {', '.join(map(str, stopped))} did not run: the app's "
            "spending settings stopped them. They are not content refusals; report "
            "them separately. Once the spending settings allow it, "
            + ("make any that use the refused face with Omni as above, and re-run the "
               "rest with --chunk N." if refused
               else "run the same command again; chunks already on disk are skipped."))


# ---------------------------------------------------------------------------
# Single-chunk Seedance generation (with retry / backoff).
# ---------------------------------------------------------------------------
def _fallback_shape(resolution: str, previous_chunk: Path | None, reference_images: list[str]) -> bool:
    # The backend fallback needs a reference image, so other chunks keep their seed.
    return resolution == "720p" and previous_chunk is None and bool(reference_images)


def _chunk_seed(chunk_index: int, resolution: str, previous_chunk: Path | None,
                reference_images: list[str]) -> int | None:
    if (_fallback_shape(resolution, previous_chunk, reference_images) and gateway.enabled()
            and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1"):
        return None
    return chunk_index * 42


def generate_chunk(
    chunk: dict,
    avatar_url: str | None,
    chunks_dir: Path,
    chunk_index: int,
    prev_chunk_path: Path | None = None,
    job: Path | None = None,
    resolution: str = "720p",
    usage_role: str | None = None,
) -> Path:
    out_path = chunks_dir / f"chunk_{chunk_index:02d}.mp4"

    prompt = chunk["seedance_prompt"]
    # Use math.ceil-ish rounding so a 2.5s chunk becomes 3s (Seedance min is 4s,
    # but we still cap at 15 — read the chunk timing from the script as-is).
    raw_duration = float(chunk["end_sec"]) - float(chunk["start_sec"])
    duration = max(4, min(int(round(raw_duration)), 15))

    print(f"\n[Chunk {chunk_index}] {chunk['start_sec']}s–{chunk['end_sec']}s | "
          f"type: {chunk.get('type', 'unspecified')} | "
          f"image_ref: {chunk.get('image_ref', 'front (default)')}")
    print(f"  Prompt: {prompt[:120]}...")

    reference_images = [avatar_url] if avatar_url else []
    previous_chunk = prev_chunk_path if prev_chunk_path and prev_chunk_path.exists() else None

    # The paid chunk lands in a take owned by this exact request, then
    # replaces chunk_NN.mp4 and keeps the old one (videoclaw#283). A re-run of
    # the same request publishes a take an interrupted run already paid for.
    request = {
        "model": SEEDANCE_MODEL, "prompt": prompt, "duration": duration, "resolution": resolution,
        "aspect_ratio": "9:16", "generate_audio": True, "reference_images": reference_images,
        "previous_chunk": file_sha256(previous_chunk) if previous_chunk else None,
        "seed": _chunk_seed(chunk_index, resolution, previous_chunk, reference_images)}
    take = PaidTake(job, [out_path], request, tool=TOOL_NAME)
    with take.hold():
        if take.ready():
            return _publish_chunk(take, chunk, chunk_index, prompt, duration, avatar_url, previous_chunk,
                                  job, usage_role, time.perf_counter(), attempts=0, reused=True)
        if _fallback_shape(resolution, previous_chunk, reference_images):
            # A run with the other recovery setting paid under the other seed's key.
            other = PaidTake(job, [out_path], {
                **request, "seed": chunk_index * 42 if request["seed"] is None else None}, tool=TOOL_NAME)
            other._pending = take._pending
            if other.ready():
                return _publish_chunk(other, chunk, chunk_index, prompt, duration, avatar_url,
                                      previous_chunk, job, usage_role, time.perf_counter(),
                                      attempts=0, reused=True)
        return _buy_chunk(take, chunk, avatar_url, chunk_index, previous_chunk, prompt, duration,
                          resolution, reference_images, job, usage_role)


def _buy_chunk(take: PaidTake, chunk: dict, avatar_url: str | None, chunk_index: int,
               previous_chunk: Path | None, prompt: str, duration: int, resolution: str,
               reference_images: list[str], job: Path | None, usage_role: str | None) -> Path:
    """The one paid Seedance call for this chunk; saves it as ``take`` and publishes it."""
    reference_videos = []
    if previous_chunk:
        print(f"  [Chunk {chunk_index}] Uploading prev chunk for continuity...")
        if gateway.enabled():
            # Local file → signed-GCS upload → "upload:<id>" ref placed at the
            # exact input field; the server deep-resolves it inside params.
            reference_videos.append(gateway.upload(previous_chunk))
        else:
            with open(previous_chunk, "rb") as f:
                prev_uri = replicate.files.create(f).urls["get"]
            reference_videos.append(prev_uri)

    inp = {
        "prompt": prompt,
        "duration": duration,
        "resolution": resolution,
        "aspect_ratio": "9:16",
        "generate_audio": True,
        "reference_images": reference_images,
        "reference_videos": reference_videos,
        "reference_audios": [],
    }
    seed = _chunk_seed(chunk_index, resolution, previous_chunk, reference_images)
    if seed is not None:
        inp["seed"] = seed

    attempts_made = [0]

    # Permanent errors — never retry (will fail every time).
    PERMANENT_ERROR_MARKERS = ("E005", "moderation", "Invalid input", "sensitive")

    def run_with_retry(inp, attempt=0):
        attempts_made[0] = attempt + 1
        try:
            if gateway.enabled():
                # DUAL MODE: the same Seedance input dict rides as `params` —
                # duration/resolution MUST stay inside it (the server meters
                # seedance by variant × resolution × seconds). Avatar BytePlus
                # URLs pass through as https strings untouched. GatewayError
                # carries the vendor error text verbatim, so the permanent /
                # retryable classification below applies unchanged (E005 /
                # "Invalid input" still short-circuit retries).
                try:
                    return gateway.run("perform_avatar", mode="chunk", params=inp,
                                       timeout_s=1800, job=job, _delivery=take.paths)
                except GatewayNotSubmittedError as exc:
                    raise take.refusal(exc) from exc
            return run_with_timeout(SEEDANCE_MODEL, inp, job=job, tool="perform_avatar.py")
        except Exception as e:
            if gateway.enabled():
                # An ambiguous response may already have billed. The gateway
                # owns retries; this caller must not mint a new operation.
                raise
            err = str(e)
            is_permanent = any(m in err for m in PERMANENT_ERROR_MARKERS)
            # Provider queue/rate errors and transient network errors
            # (read timeout, connection reset, 502/503/504) all warrant retry.
            retryable = (
                not is_permanent
                and attempt < 3
                and (
                    "E004" in err
                    or "timed out" in err.lower()
                    or "timeout" in err.lower()
                    or "Connection" in err
                    or "ConnectionError" in err
                    or "502" in err or "503" in err or "504" in err
                    or "RemoteDisconnected" in err
                )
            )
            if retryable:
                # E004 uses a longer baseline (queue cooldown); network errors
                # back off shorter and faster.
                wait = (30 * (attempt + 1)) if "E004" in err else (8 * (2 ** attempt))
                reason = "E004" if "E004" in err else "network"
                print(f"  [Chunk {chunk_index}] ⚠ {reason} — retry in {wait}s ({attempt+1}/3): {err[:120]}")
                if job is not None:
                    log_event(
                        job, tool=TOOL_NAME, event="chunk_retry",
                        extra={"chunk_index": chunk_index, "reason": reason,
                               "attempt": attempt + 1, "wait_seconds": wait,
                               "error_snippet": err[:200],
                               "usage_role": usage_role},
                        render_md=False,
                    )
                time.sleep(wait)
                return run_with_retry(inp, attempt + 1)
            raise

    start = time.perf_counter()
    try:
        output = run_with_retry(inp)
    except Exception as e:
        if job is not None:
            log_event(
                job, tool=TOOL_NAME, event="chunk_failed",
                prompt=prompt,
                duration_seconds=time.perf_counter() - start,
                extra={
                    "chunk_index": chunk_index, "model": SEEDANCE_MODEL,
                    "duration": duration,
                    "attempts": attempts_made[0],
                    "error": type(e).__name__, "error_message": str(e)[:300],
                    "cause": failure_cause(e),
                    "usage_role": usage_role,
                },
            )
        raise

    if gateway.enabled():
        # Gateway result dict: chunk mp4 is under assets (cost metered server-side).
        assets = output.get("assets") or []
        if not assets:
            raise RuntimeError(
                f"gateway returned no assets for chunk {chunk_index} "
                f"(status={output.get('status')})")
        gateway.download_asset(assets[0], take.paths[0])
    else:
        video_url = output.url if hasattr(output, "url") else str(output)
        resp = requests.get(video_url, timeout=300)
        resp.raise_for_status()
        write_atomic(take.paths[0], resp.content)
    return _publish_chunk(take, chunk, chunk_index, prompt, duration, avatar_url, previous_chunk,
                          job, usage_role, start, attempts=attempts_made[0], reused=False)


def _publish_chunk(take: PaidTake, chunk: dict, chunk_index: int, prompt: str, duration: int,
                   avatar_url: str | None, previous_chunk: Path | None, job: Path | None,
                   usage_role: str | None, start: float, *, attempts: int, reused: bool) -> Path:
    """Replace chunk_NN.mp4 with its paid take, keeping the previous chunk."""
    out_path = take.outputs[0]
    kept = take.publish() or []
    size_bytes = out_path.stat().st_size
    size_mb = size_bytes // 1024 // 1024
    how = "reused the paid take of an interrupted run, nothing charged now; " if reused else ""
    print(f"  [Chunk {chunk_index}] ✓ Saved {out_path.name} ({how}{size_mb}MB)")
    for path in kept:
        print(f"  [Chunk {chunk_index}] previous take kept → {path}")

    if job is not None:
        log_event(
            job, tool=TOOL_NAME, event="chunk_generated",
            prompt=prompt,
            duration_seconds=time.perf_counter() - start,
            extra={
                "chunk_index": chunk_index, "model": SEEDANCE_MODEL,
                "duration": duration, "attempts": attempts,
                "size_bytes": size_bytes,
                "output_path": str(out_path.relative_to(job)),
                "avatar_url": (avatar_url or "")[:120],
                "image_ref": chunk.get("image_ref", "front"),
                "had_prev_chunk_ref": previous_chunk is not None,
                "usage_role": usage_role,
                **({"reused_paid_take": True} if reused else {}),
                **({"reused_from_other_inputs": True, "adopted_take_key": take.adopted_from}
                   if take.adopted_from else {}),
                **({"previous_take": [str(path.relative_to(take.root)) for path in kept]} if kept else {}),
                # The shared gateway_call row owns cost, including recovery.
                **({"gateway": True} if gateway.enabled() else {}),
            },
        )

    return out_path


# ---------------------------------------------------------------------------
# script_preflight.py gate (CLAUDE.md rule 18).
# ---------------------------------------------------------------------------
def run_preflight_gate(job: Path) -> None:
    """Auto-run the deterministic audit of script.json against the
    sentence-grounded reference analysis. ERROR-level gaps refuse to run
    (sys.exit(1)); otherwise the report is logged and we proceed.
    """
    try:
        from script_preflight import run_preflight, render_console_report
    except ImportError:
        print("⚠ script_preflight.py not importable — skipping preflight gate (consider fixing).")
        return

    print("Running script_preflight.py …")
    code, issues, report_path = run_preflight(job, strict=False)
    if code == 2:
        print(
            "⚠ script_preflight: setup error (missing script.json or sentence-grounded analysis). "
            "Skipping preflight — consider running deep_analyze_video.py first."
        )
    elif code == 1:
        # Gate FAILS — print the report and refuse to run.
        from script_preflight import load_analysis
        analysis = load_analysis(job)
        if analysis is not None:
            print(render_console_report(issues, analysis))
        if report_path is not None:
            rel = report_path.relative_to(Path.cwd()) if report_path.is_relative_to(Path.cwd()) else report_path
            print(f"\n❌ script_preflight failed — see {rel}")
        print(
            "Refusing to run perform_avatar until ERROR-level gaps are resolved.\n"
            "Either fix the issues OR pass --skip-preflight (and document why in adaptation_notes)."
        )
        sys.exit(1)
    else:
        n_warn = sum(1 for i in issues if i.severity == "WARN")
        n_info = sum(1 for i in issues if i.severity == "INFO")
        print(f"✓ script_preflight passed ({n_warn} WARN, {n_info} INFO — see script_preflight_report.md)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description="Render the avatar speaking — Seedance 2.0 talking-head / B-roll chunks.",
    )
    add_job_arg(parser)
    parser.add_argument(
        "--role",
        default=None,
        help="Casting role for this performance (e.g. 'spokesperson', 'endorser'). "
             "Logged as usage_role on every event.",
    )
    parser.add_argument("--chunk", type=int, help="Regenerate a single chunk by index")
    parser.add_argument(
        "--motion-prompt",
        default=None,
        help="Override the per-chunk seedance_prompt baked into script.json. Only "
             "valid with --chunk (single-chunk regen) — applies to that one chunk.",
    )
    parser.add_argument(
        "--sequential",
        action="store_true",
        help="Run chunks one-at-a-time, using prev chunk as [Video1] continuity reference. "
             "Default is parallel (faster, identity anchored by avatar BytePlus URL).",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Max parallel chunks when in default (parallel) mode (default: 4)",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip script_preflight.py gate (CLAUDE.md rule 18). Only use if you've "
             "explicitly documented in adaptation_notes why we're bypassing the audit.",
    )
    parser.add_argument(
        "--resolution",
        choices=["720p", "1080p"],
        default=None,
        help="Seedance generation resolution. Defaults to script.json:seedance_resolution "
             "if set, otherwise 720p. 720p is the repo default (cheaper + faster); only "
             "escalate to 1080p when the deliverable explicitly needs it.",
    )
    args = parser.parse_args()

    job = resolve_job_dir(args.job)
    usage_role = args.role
    avatar_dir = job / "avatar"
    chunks_dir = job / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    script_path = billing_input_path(job / "script.json")

    if args.motion_prompt is not None and args.chunk is None:
        parser.error("--motion-prompt requires --chunk N (it overrides one chunk's prompt).")

    # ----- script_preflight.py gate (CLAUDE.md rule 18) -----
    if not args.skip_preflight:
        run_preflight_gate(job)

    script = json.loads(script_path.read_text())
    chunks = script["chunks"]

    # Resolve generation resolution — CLI flag wins, then script.json field, else 720p (repo default).
    resolution = args.resolution or script.get("seedance_resolution", "720p")
    if resolution not in ("720p", "1080p"):
        raise ValueError(f"Invalid resolution '{resolution}'. Must be '720p' or '1080p'.")

    # Apply --motion-prompt override (single-chunk only — guarded above).
    if args.motion_prompt is not None:
        chunks[args.chunk]["seedance_prompt"] = args.motion_prompt
        print(f"↻ --motion-prompt override applied to chunk {args.chunk}")

    # Resolve per-chunk avatar URLs ahead of generation. A chunk can declare
    # image_ref = "<shot name>" to pick a non-front variant, or image_ref = ""
    # (or False) to opt out of any avatar reference (B-roll, typography, etc.).
    chunk_avatar_urls: list[str | None] = []
    for chunk in chunks:
        ref = chunk.get("image_ref", "front")
        chunk_avatar_urls.append(get_avatar_url(avatar_dir, ref))

    refs_summary = sorted({(c.get("image_ref", "front") or "<no avatar>") for c in chunks})
    print(f"Job:    {job}")
    if usage_role:
        print(f"Role:   {usage_role}")
    print(f"Avatars used: {refs_summary}")
    print(f"Mode:   {'sequential (prev-chunk continuity)' if args.sequential else f'parallel x{args.max_workers}'}")
    print(f"Resolution: {resolution}")
    print(f"Chunks: {len(chunks)} | total: {script.get('total_duration_seconds')}s")

    # Validate ALL prompts up front — fail fast before spending credits.
    for i, chunk in enumerate(chunks):
        validate_prompt(chunk, i)
    print("✓ All prompts validated")
    log_event(
        job, tool=TOOL_NAME, event="run_started",
        extra={
            "chunks": len(chunks),
            "total_duration_seconds": script.get("total_duration_seconds"),
            "mode": "sequential" if args.sequential else "parallel",
            "max_workers": args.max_workers,
            "image_refs": refs_summary,
            "resolution": resolution,
            "usage_role": usage_role,
        },
        render_md=False,
    )

    # Single chunk regen
    if args.chunk is not None:
        chunk = chunks[args.chunk]
        url = chunk_avatar_urls[args.chunk]
        prev = (billing_optional_input_path(
            chunks_dir / f"chunk_{args.chunk - 1:02d}.mp4")
                if (args.sequential and args.chunk > 0) else None)
        try:
            generate_chunk(chunk, url, chunks_dir, args.chunk, prev, job=job,
                           resolution=resolution, usage_role=usage_role)
        except Exception as e:
            report_failures(chunks, {args.chunk: e})
            sys.exit(1)
        return

    todo: list[tuple[int, dict, str | None]] = []
    for i, chunk in enumerate(chunks):
        out_path = chunks_dir / f"chunk_{i:02d}.mp4"
        if out_path.exists() and out_path.stat().st_size > 10000:
            print(f"  chunk_{i:02d}.mp4 exists — skipping (delete to regenerate)")
            continue
        todo.append((i, chunk, chunk_avatar_urls[i]))

    if not todo:
        print("Nothing to do — all chunks already exist.")
        return

    failures: dict[int, Exception] = {}
    if args.sequential:
        for i, chunk, url in todo:
            # Cache-disable regenerates the prior chunk earlier in this same
            # guarded invocation; it is a trusted output, not a live input.
            prev_path = chunks_dir / f"chunk_{i-1:02d}.mp4" if i > 0 else None
            try:
                generate_chunk(chunk, url, chunks_dir, i, prev_path, job=job,
                               resolution=resolution, usage_role=usage_role)
            except Exception as e:
                failures[i] = e
                break  # the next chunk continues from this one
            time.sleep(1)
    else:
        # Parallel — no prev-chunk dependency.
        print(f"Launching {len(todo)} chunks in parallel...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as pool:
            futures = {
                pool.submit(generate_chunk, chunk, url, chunks_dir, i, None, job,
                            resolution, usage_role): i
                for i, chunk, url in todo
            }
            for fut in concurrent.futures.as_completed(futures):
                i = futures[fut]
                try:
                    fut.result()
                except Exception as e:
                    failures[i] = e

    log_event(
        job, tool=TOOL_NAME, event="run_completed",
        extra={"chunks_attempted": len(todo), "usage_role": usage_role,
               **({"failed_chunks": {str(i): failure_cause(e) for i, e in failures.items()}}
                  if failures else {})},
    )
    if failures:
        report_failures(chunks, failures)
        sys.exit(1)
    print(f"\nAll chunks in {chunks_dir}")
    print("Next: review with gemini_video.py --mode chunk_review, then run elevenlabs.py")


if __name__ == "__main__":
    main()
