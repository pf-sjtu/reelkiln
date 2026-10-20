"""
mint_video.py — the canonical video primitive. ONE tool, `--mode` picks the engine.

  uv run python tools/mint_video.py --job <id> --mode <mode> --name <name> [...]

This is the consolidation of five legacy backends — their logic is INLINED here
(they are deleted). The five modes map to the irreproducible generation
shapes evidenced by the archaeology pass (see skills/primitives/mint_video.md):

  --mode insert      short under-dialogue B-roll insert from a reference still.
                     (was gen_broll.py) — Seedance 2.0 by default; explicit
                     --quality premium selects Seedance 2.5 for 4–30s work.
  --mode keyframe    a hero/lingering beat, interpolated between two known frames.
                     (was gen_video.py first/last-frame) — Seedance 2.0 i2v keyframe.
  --mode multishot   UNAVAILABLE (videoclaw#317): the gateway refuses every
                     request, so the tool exits before any upload or spend.
  --mode reenact     make a still perform a driver clip's motion (the still stays
                     the shot). Not for person swaps: use genjutsu.
                     Kling v3 Pro through the gateway.
  --mode edit        PROMPT-DRIVEN video-to-video on an existing clip: restyle
                     (animation → real → lego), scene/object edits, targeted
                     changes ("replace the pomegranates with apples").
                     Gemini Omni Flash via the gateway (chunk 31).
  --mode genjutsu    RECAST a real 4–30s clip from 1–8 reference images
                     (characters, outfits, places): the source performance,
                     camera path and timing stay; the ORIGINAL audio is kept.
                     EVERY person swap goes here, whatever the count.
                     --prompt is required: who becomes whom (Image N), what
                     stays from the video and what comes from the references
                     (see the template in --help).
                     Higgsfield Genjutsu motion transfer via the gateway,
                     billed per whole input second at 720p (the default; 1080p
                     only when the user asks).

MODE ANTI-TRIGGERS (chunk 31): existing footage that needs a style/scene/object
change → `edit`, never re-generate from stills. An identity swap FROM A REFERENCE
IMAGE → `genjutsu` (the edit engine takes prompt + video ONLY — no image refs).
Every person swap → `genjutsu`, whatever the count: one face on a short clip,
several people, outfits or a new world from reference images (JC 2026-09-29).
`reenact` only makes a still perform a driver clip's motion.

The mode also picks where the output lands and which retry/recipe applies — every
working detail (exact model ids, Replicate upload patterns, ffmpeg recipes, flag
semantics, the closed-eye pre-flight) is preserved from the original backends so
this produces the SAME results.

────────────────────────────────────────────────────────────────────────────
REFERENCE-IMAGE CITATION CONVENTIONS (do not mix them up):
────────────────────────────────────────────────────────────────────────────
  Seedance (insert / keyframe): reference_images are cited in the prompt as
    [Image1], [Image2], … (1-indexed, in --reference upload order). An un-cited
    reference is weakly applied. reference_images and first/last-frame keyframe
    inputs are MUTUALLY EXCLUSIVE.

  Gemini multishot / Kling reenact: reference images are cited as
    <<<image_1>>>..<<<image_6>>> (1-indexed, upload order); a reference video as
    <<<video_1>>>. These are engine placeholders; the gateway translates them
    to Gemini's numbered references.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unicodedata
from pathlib import Path

import replicate
import requests
from dotenv import load_dotenv

from job import (
    add_job_arg,
    resolve_job_dir,
    resolve_job_input_path,
    resolve_job_output_path,
)
from log import log_event
from _batch_schema import (  # shared --batch schema (#74)
    GENJUTSU_MAX_PROMPT_CHARS,
    GENJUTSU_MAX_REFERENCES,
    QUALITY_BY_MODE,
    batch_item_error,
)
from _gateway import (  # dual mode: VIDEOCLAW_API_KEY set → gateway routes the call
    gateway, GatewayAcceptedError, GatewayDestinationClaimedError, GatewayNotSubmittedError,
    GatewayRepeatRefusedError, exit_on_repeat_refusal,
)
from prepare_production import MINT_VIDEO_UNAVAILABLE_MODES

load_dotenv()
os.environ["REPLICATE_API_TOKEN"] = os.environ.get("REPLICATE_API_TOKEN", "")

# ── Model ids (preserved verbatim from the absorbed backends) ────────────────
SEEDANCE_MODEL = "bytedance/seedance-2.0"
SEEDANCE_MODEL_FAST = "bytedance/seedance-2.0-fast"
SEEDANCE_MODEL_PREMIUM = "bytedance/seedance-2.5"
OMNI_EDIT_MODEL = "google/gemini-omni-flash/edit"   # fal-hosted (chunk 31)

# videoclaw-app kills every paid command at 600s (agentHost
# PAID_GENERATION_TIMEOUT_MS, also Claude's Bash maximum), and the gateway sizes
# every mint_video rail's hard limit under it (videoclaw-backend#316), so a slow
# run is cancelled or settled while this process is still polling. A longer
# wait here can never be reached in the app.
APP_PAID_GENERATION_CEIL_S = 600.0
# The app's clock starts with the command, before upload and any wait for the
# user's go-ahead, so end every result wait this long before its kill. A job
# still running or settling its bill then gets the "background recovery owns
# its result" handoff, not exit 143. The margin also covers uv and interpreter
# startup before this module loads.
APP_KILL_MARGIN_S = 30.0
COMMAND_DEADLINE = time.time() + APP_PAID_GENERATION_CEIL_S - APP_KILL_MARGIN_S
# An insert/keyframe batch never starts a queued clip with less time left than
# this (videoclaw#278 review): the fastest Seedance clip on engine 0.1.55 took
# ~113 s at the gateway. run_many raises it to the slowest clip of the batch.
GENERATION_SUBMIT_RESERVE_S = 120.0

# Omni mishandles sub-3s video inputs (accepted by the schema, garbled in
# processing — vendor-documented; live danni-juhl sweep 2026-07-18 padded
# every short gap to ≥3.3s). Enforced for edit sources + reenact drivers.
MIN_OMNI_INPUT_S = 3.05
# Genjutsu (Higgsfield motion transfer, gateway only). The API catalog admits
# 1–30s sources and the gateway enforces that; Higgsfield's model notes say a
# source "must be at least 4 seconds", so shorter clips are refused here unless
# --allow-short (a rejected request is not billed, but it wastes a turn). Over
# 30s is refused outright: the provider would trim it and the gateway will not
# price a trimmed input.
GENJUTSU_MIN_INPUT_S = 4.0
GENJUTSU_MAX_INPUT_S = 30.0
GENJUTSU_ROUTE = "genjutsu-motion-transfer-v1.0"
# videoclaw#316: sources the provider may not decode are sent as 8-bit BT.709.
GENJUTSU_HDR_TRANSFERS = frozenset({"arib-std-b67", "smpte2084"})
GENJUTSU_SDR_MAX_SIDE = 1920
QUALITY_CHOICES = ("standard", "draft", "premium")
INPUT_BINDING_SCHEMA = "videoclaw.input-binding.v1"
INPUT_BINDING_ENV = "VIDEOCLAW_INPUT_BINDING"
INPUT_BINDING_REQUIRED_ENV = "VIDEOCLAW_REQUIRE_INPUT_BINDING"


class ImmutableInputBinding:
    """Materialize quoted inputs into verified private snapshots.

    Provider upload/probe code receives the snapshot path, never the mutable
    workspace path that was hashed by cost.py. Atomic replacement after quote
    therefore either fails the digest check or happens after the already-opened
    bytes were copied and cannot affect the provider payload.
    """

    def __init__(self, manifest: dict, role: str):
        if (
            manifest.get("schema") != INPUT_BINDING_SCHEMA
            or manifest.get("tool") != "mint_video"
            or manifest.get("role") != role
            or not isinstance(manifest.get("inputs"), list)
        ):
            raise SystemExit("immutable input binding does not match this mint_video run")
        self._entries: dict[str, tuple[str, int]] = {}
        for raw in manifest["inputs"]:
            if not isinstance(raw, dict):
                raise SystemExit("immutable input binding contains an invalid entry")
            path = raw.get("path")
            digest = raw.get("sha256")
            size = raw.get("size")
            if (
                not isinstance(path, str)
                or not re.fullmatch(r"[0-9a-f]{64}", str(digest or ""))
                or not isinstance(size, int)
                or isinstance(size, bool)
                or size < 0
            ):
                raise SystemExit("immutable input binding contains an invalid entry")
            self._entries[path] = (digest, size)
        self._tmp = tempfile.TemporaryDirectory(prefix="videoclaw-bound-inputs-")
        self._cache: dict[str, Path] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_environment(cls, role: str) -> "ImmutableInputBinding | None":
        raw = os.environ.get(INPUT_BINDING_ENV, "")
        required = os.environ.get(INPUT_BINDING_REQUIRED_ENV) == "1"
        if not raw:
            if required:
                raise SystemExit("immutable input binding is required but missing")
            return None
        try:
            padded = raw + "=" * (-len(raw) % 4)
            manifest = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        except Exception as exc:
            raise SystemExit("immutable input binding is malformed") from exc
        if not isinstance(manifest, dict):
            raise SystemExit("immutable input binding is malformed")
        return cls(manifest, role)

    def snapshot(self, path: str | Path) -> Path:
        try:
            resolved = Path(path).expanduser().resolve(strict=True)
        except OSError as exc:
            raise SystemExit(f"bound input is missing: {path}") from exc
        key = str(resolved)
        expected = self._entries.get(key)
        if expected is None:
            raise SystemExit(f"input was not included in the bound plan: {resolved}")
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            target = Path(self._tmp.name) / f"{len(self._cache):04d}{resolved.suffix}"
            digest = hashlib.sha256()
            size = 0
            try:
                with resolved.open("rb") as source, target.open("xb") as output:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        output.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
            except OSError as exc:
                target.unlink(missing_ok=True)
                raise SystemExit(f"bound input could not be snapshotted: {resolved}") from exc
            if (digest.hexdigest(), size) != expected:
                target.unlink(missing_ok=True)
                raise SystemExit(f"input changed after plan binding: {resolved}")
            self._cache[key] = target
            return target

    def close(self) -> None:
        self._tmp.cleanup()


def _bound_input(args, path: str | Path) -> Path:
    binding: ImmutableInputBinding | None = getattr(args, "_input_binding", None)
    return binding.snapshot(path) if binding is not None else Path(path)
def _validate_quality(mode: str, quality: str) -> str:
    allowed = QUALITY_BY_MODE[mode]
    if quality not in allowed:
        raise SystemExit(
            f"--mode {mode} supports --quality "
            f"{'|'.join(allowed)}; got {quality}")
    return quality


def _effective_quality(args, mode: str) -> str:
    """Resolve the public quality contract while preserving legacy --fast.

    --fast pre-dates --quality and means the same thing as --quality draft.
    Reject a contradictory explicit choice instead of silently picking one.
    """
    fast = bool(getattr(args, "fast", False))
    quality = getattr(args, "quality", None)
    if fast and quality not in (None, "draft"):
        raise SystemExit("--fast is an alias for --quality draft; do not combine "
                         f"it with --quality {quality}")
    return _validate_quality(
        mode, "draft" if fast else (quality or "standard"))


def _route_label(mode: str, quality: str, *, via_gateway: bool) -> str:
    """Human-readable execution route matching the gateway's public contract."""
    if not via_gateway:
        if quality == "premium":
            raise ValueError("Seedance 2.5 premium requires the VideoClaw gateway")
        if mode == "genjutsu":
            raise ValueError("genjutsu requires the VideoClaw gateway")
        if mode in ("multishot", "reenact"):
            raise ValueError(
                f"{mode} requires the VideoClaw gateway (Gemini Omni)")
        if mode in ("insert", "keyframe"):
            return SEEDANCE_MODEL_FAST if quality == "draft" else SEEDANCE_MODEL
        return OMNI_EDIT_MODEL
    if mode == "multishot":
        return "gemini-omni-flash-preview"
    if mode == "reenact":
        return "kling-v3-pro-motion-control"
    if mode == "genjutsu":
        return GENJUTSU_ROUTE
    if mode in ("insert", "keyframe"):
        if quality == "premium":
            return SEEDANCE_MODEL_PREMIUM
        return SEEDANCE_MODEL_FAST if quality == "draft" else SEEDANCE_MODEL
    return OMNI_EDIT_MODEL


# ─────────────────────────────────────────────────────────────────────────────
# Shared Replicate helpers (the upload + result-normalize + download patterns
# every backend used). Kept self-contained — no import of the deleted tools.
# ─────────────────────────────────────────────────────────────────────────────

def _to_url_ref(ref: str) -> str:
    """A URL/data-URI passes through; a local path is uploaded to Replicate and the
    fetchable 'get' URL returned. (gen_broll.py `_to_ref`.)"""
    if ref.startswith(("http://", "https://", "data:")):
        return ref
    p = Path(ref).expanduser().resolve()
    if not p.exists():
        raise SystemExit(f"--reference path does not exist: {p}")
    with open(p, "rb") as f:
        return replicate.files.create(f).urls["get"]


def _resolve_refs_fileobj(paths: list[str]) -> list:
    """URLs pass through; local paths are opened as file objects so the SDK
    uploads them as multipart."""
    out: list = []
    for r in paths:
        if r.startswith("http://") or r.startswith("https://"):
            out.append(r)
        else:
            p = Path(r)
            if not p.exists():
                print(f"reference not found: {p}", file=sys.stderr)
                sys.exit(1)
            out.append(open(p, "rb"))
    return out


def _resolve_url_for_seedance(ref: str):
    """Seedance keyframe payload wants a single resolved image input — URL through,
    local path opened as a file object. (gen_video.py keyframe path.)"""
    if ref.startswith(("http://", "https://", "data:")):
        return ref
    p = Path(ref)
    if not p.exists():
        print(f"reference not found: {p}", file=sys.stderr)
        sys.exit(1)
    return open(p, "rb")


def _result_to_url(result):
    """Normalize a Replicate result (list / FileOutput / URL str) → a URL string,
    or None."""
    if isinstance(result, list):
        result = result[0] if result else None
    if result is None:
        return None
    if isinstance(result, str):
        return result
    return getattr(result, "url", None)


def _stream_download(url: str, out_path: Path) -> None:
    """Stream-download a large mp4 with retry — avoids the recurring ReadTimeout.
    Three attempts with five-second backoff."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    for dl in range(1, 4):
        try:
            with requests.get(url, timeout=900, stream=True) as resp:
                resp.raise_for_status()
                with open(out_path, "wb") as fo:
                    for chunk in resp.iter_content(chunk_size=1 << 20):
                        if chunk:
                            fo.write(chunk)
            return
        except Exception as e:
            print(f"  ! download attempt {dl} failed: {e}", file=sys.stderr)
            if dl == 3:
                raise
            time.sleep(5)


def _watch_link(output: Path) -> None:
    """Emit a clickable file:// link to the finished video so the user can open
    and WATCH it immediately (frames aren't clickable). Printed by every video
    mode; the agent must also relay this link in its reply (see CLAUDE.md)."""
    print(f"  ▶ WATCH → file://{output.resolve()}")


def _save_result(result, output: Path, t0: float, label: str = "mint_video") -> None:
    """Write a Replicate video result to disk. Handles read()/url/str(http)."""
    if isinstance(result, list):
        result = result[0]
    if hasattr(result, "read"):
        data = result.read()
    elif hasattr(result, "url"):
        data = requests.get(result.url, timeout=600).content
    elif isinstance(result, str) and result.startswith("http"):
        data = requests.get(result, timeout=600).content
    else:
        print(f"unexpected result type: {type(result)}", file=sys.stderr)
        sys.exit(2)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    print(f"[{label}] done in {time.perf_counter() - t0:.1f}s ({len(data) // 1024} KB) -> {output}")


def _run_with_retry(model: str, payload: dict, *, reopen=None, label: str = "mint_video"):
    """replicate.run with gen-retry (3 attempts, 15s backoff). Falls back to the
    no-`use_file_output` signature for older SDKs. `reopen` is called before each
    attempt to re-open any consumed file handles in the payload. Returns the
    raw result."""
    result = None
    for attempt in range(1, 4):
        try:
            if reopen:
                reopen(payload)
            try:
                result = replicate.run(model, input=payload, use_file_output=False)
            except TypeError:
                result = replicate.run(model, input=payload)
            return result
        except Exception as e:
            print(f"[{label}] gen attempt {attempt} failed: {e}", file=sys.stderr)
            if attempt == 3:
                raise
            time.sleep(15)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# GATEWAY MODE (VIDEOCLAW_API_KEY set) — phase-1 wrapper. The tool still builds
# the exact engine-shaped input dict + dialect prompt ([ImageN]/<<<image_N>>>);
# only the transport changes: local media → gateway.upload 'upload:<id>' strings
# (the server deep-resolves them anywhere in params), then one gateway.run call.
# ─────────────────────────────────────────────────────────────────────────────

def _gw_ref(ref: str) -> str:
    """Gateway-mode reference resolver: https/data URIs pass through as-is
    (incl. BytePlus URLs); a local path is uploaded via signed GCS PUT and
    becomes an 'upload:<id>' string the server resolves in-place."""
    if ref.startswith(("http://", "https://", "data:")):
        return ref
    p = Path(ref).expanduser().resolve()
    if not p.exists():
        raise SystemExit(f"reference path does not exist: {p}")
    return gateway.upload(p)


def _gateway_generate(mode: str, input_dict: dict, job: Path, out_path: Path,
                      quality: str = "standard") -> dict:
    """One gateway call for the engine-shaped generation seams.

    The fully-built engine input dict travels as `params` — the prompt stays
    INSIDE params["prompt"] (never gateway.run's top-level prompt=, which would
    trigger {ref:N} rewriting we don't want for engine-dialect prompts). The
    `seconds` is the canonical metering duration at the gateway envelope level.
    The provider-facing `duration` remains in params for backwards compatibility
    and adapter serialization; the backend rejects conflicts between the two.
    Passing job= makes the gateway client log the metered cost event to
    run.log.jsonl (mint_video logs no estimate_usd of its own, so there is no
    double count) and sets client_job to the job dir name.
    """
    route = _route_label(mode, quality, via_gateway=True)
    print(f"[mint_video:{mode}] gateway route: {route} (quality={quality})")
    seconds = input_dict.get("duration")
    res = gateway.run(
        "mint_video", mode=mode, params=input_dict,
        **({"seconds": seconds} if isinstance(seconds, (int, float)) else {}),
        quality=quality, job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
        deadline=COMMAND_DEADLINE, _delivery=[out_path])
    assets = res.get("assets") or []
    if not assets:
        raise SystemExit(f"[mint_video:{mode}] gateway returned no assets "
                         f"(status={res.get('status')})")
    gateway.download_asset(assets[0], out_path)
    return res


# ═════════════════════════════════════════════════════════════════════════════
# MODE: insert — short under-dialogue B-roll from a reference still (was gen_broll.py)
# Seedance 2.0 i2v. Resolution is an execution dimension independent of the
# standard quality route; Fal's draft/fast tier is the sole 720p-only case.
# generate_audio FALSE by default.
# ═════════════════════════════════════════════════════════════════════════════

def _insert_plan(args, job: Path, ref=None) -> dict:
    """Validate one insert and build its request; uploads only, never paid work.

    `ref` resolves a reference to a provider-visible form (defaults to the
    gateway upload in gateway mode, Replicate upload otherwise). A batch passes
    a memoised resolver so a still shared by many items uploads once.
    """
    name = args.name
    prompt = args.prompt
    quality = _effective_quality(args, "insert")
    if quality == "premium" and not gateway.enabled():
        raise SystemExit("Seedance 2.5 premium requires the VideoClaw gateway")
    if not name:
        sys.exit("--name is required for --mode insert (saved as clips/<name>.mp4)")
    if not prompt:
        sys.exit("--prompt is required for --mode insert")
    if quality == "premium" and args.resolution == "1080p":
        raise SystemExit("Seedance 2.5 premium supports --resolution 480p|720p")
    if quality != "premium" and args.resolution == "480p":
        raise SystemExit("--resolution 480p is available only with --quality premium")

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path = out_path.with_suffix(".json")
    else:
        clips_dir = job / "clips"
        clips_dir.mkdir(exist_ok=True)
        out_path = clips_dir / f"{name}.mp4"
        meta_path = clips_dir / f"{name}.json"

    # Seedance requires duration >= 4s. Generate at the clamped value and let the
    # overlay Sequence trim down to the exact insert length.
    api_duration = max(4, min(int(round(args.duration)), 30 if quality == "premium" else 15))
    resolution = "720p" if quality == "draft" else args.resolution
    if resolution != args.resolution:
        print(f"[mint_video:insert] {name}: draft uses Fal's 720p fast tier; "
              "downshifting the requested 1080p resolution.")

    # Gateway mode: local refs → 'upload:<id>' strings; raw mode: Replicate upload.
    _ref = ref or (_gw_ref if gateway.enabled() else _to_url_ref)
    reference_images = [_ref(r) for r in (args.reference or [])]
    print(f"Generating B-roll insert '{name}' ({api_duration}s, {args.aspect_ratio}, "
          f"audio={args.audio}, refs={len(reference_images)})...")
    print(f"  Prompt: {prompt[:160]}...")

    inp = {
        "prompt": prompt,
        "duration": api_duration,
        "resolution": resolution,
        "aspect_ratio": args.aspect_ratio,
        "generate_audio": args.audio,
        "reference_images": reference_images,
        "reference_videos": [],
        "reference_audios": [],
    }
    if args.seed is not None:
        inp["seed"] = args.seed
    return {"mode": "insert", "name": name, "prompt": prompt, "quality": quality,
            "input": inp, "out_path": out_path, "meta_path": meta_path,
            "model_id": _route_label("insert", quality, via_gateway=gateway.enabled()),
            "api_duration": api_duration, "resolution": resolution,
            "requested_duration": args.duration, "aspect_ratio": args.aspect_ratio,
            "seed": args.seed}


def _insert_finish(plan: dict, job: Path, elapsed: float) -> None:
    out_path = plan["out_path"]
    size_mb = out_path.stat().st_size // 1024 // 1024
    print(f"  ✓ Saved {out_path.relative_to(job) if out_path.is_relative_to(job) else out_path} "
          f"({size_mb}MB, {elapsed:.1f}s)")
    _watch_link(out_path)

    meta = {
        "name": plan["name"],
        "prompt": plan["prompt"],
        "model": plan["model_id"],
        "quality": plan["quality"],
        "resolution": plan["resolution"],
        "api_duration_sec": plan["api_duration"],
        "requested_duration_sec": plan["requested_duration"],
        "aspect_ratio": plan["aspect_ratio"],
        "seed": plan["seed"],
        "elapsed_sec": round(elapsed, 1),
        "size_bytes": out_path.stat().st_size,
    }
    plan["meta_path"].write_text(json.dumps(meta, indent=2))

    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=plan["prompt"],
        duration_seconds=elapsed,
        extra={"usage_role": "insert", "mode": "insert", "name": plan["name"],
               "duration": plan["api_duration"], "aspect_ratio": plan["aspect_ratio"],
               "model": plan["model_id"], "quality": plan["quality"],
               "resolution": plan["resolution"],
               "size_bytes": out_path.stat().st_size,
               "output": str(out_path),
               **({"batch": True} if plan.get("batch") else {})},
    )


def run_insert(args, job: Path) -> int:
    plan = _insert_plan(args, job)
    out_path = plan["out_path"]
    start = time.perf_counter()
    if gateway.enabled():
        _gateway_generate("insert", plan["input"], job, out_path, quality=plan["quality"])
    else:
        result = _run_with_retry(plan["model_id"], plan["input"], label="mint_video:insert")
        url = result if isinstance(result, str) else _result_to_url(result)
        if not url:
            # _save_result handles FileOutput/read() shapes too
            _save_result(result, out_path, start, label="mint_video:insert")
        else:
            _stream_download(url, out_path)
    _insert_finish(plan, job, time.perf_counter() - start)
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# MODE: keyframe — hero beat interpolated between first/last frame (was gen_video.py)
# Seedance 2.0 i2v keyframe mode. image (first) + last_frame_image (last).
# MUTUALLY EXCLUSIVE with reference_images.
# ═════════════════════════════════════════════════════════════════════════════

def _keyframe_plan(args, job: Path, ref=None) -> dict:
    """Validate one keyframe and build its request; uploads only, never paid work."""
    prompt = args.prompt
    quality = _effective_quality(args, "keyframe")
    resolution = "720p" if quality == "draft" else args.resolution
    if resolution != args.resolution:
        print("[mint_video:keyframe] draft uses Fal's 720p fast tier; "
              "downshifting the requested 1080p resolution.")
    if not prompt:
        sys.exit("--prompt is required for --mode keyframe")
    if not (args.first_frame or args.last_frame):
        sys.exit("--mode keyframe needs --first-frame (and usually --last-frame)")
    if args.reference:
        # Seedance: keyframe inputs cannot be combined with reference_images.
        raise SystemExit(
            "Seedance 2.0: --first-frame / --last-frame (keyframe mode) cannot be "
            "combined with --reference (reference_images mode). Pick one — use "
            "--mode insert for reference_images."
        )

    out_path = _keyframe_output_path(args, job)

    # Gateway mode: every local media input becomes an 'upload:<id>' string at
    # the exact field the engine expects; raw mode keeps the SDK file objects.
    if gateway.enabled():
        _res_one = ref or _gw_ref
        _res_list = lambda paths: [_res_one(r) for r in paths]  # noqa: E731
    else:
        _res_list = _resolve_refs_fileobj
        _res_one = _resolve_url_for_seedance

    payload = {
        "prompt": prompt,
        "duration": int(round(args.duration)),
        "resolution": resolution,
        "aspect_ratio": args.aspect_ratio,
        "generate_audio": args.audio,
        "reference_videos": _res_list(args.video or []),
        "reference_audios": _res_list(args.audio_ref or []),
        "seed": args.seed if args.seed is not None else 0,
    }
    if args.first_frame:
        payload["image"] = _res_one(args.first_frame)
    if args.last_frame:
        payload["last_frame_image"] = _res_one(args.last_frame)

    model_id = _route_label("keyframe", quality, via_gateway=gateway.enabled())
    print(f"[mint_video:keyframe] {model_id.split('/')[-1]} → {out_path.name} "
          f"({int(round(args.duration))}s @ {resolution} {args.aspect_ratio}, audio={args.audio})")
    return {"mode": "keyframe", "name": args.name or out_path.stem, "prompt": prompt,
            "quality": quality, "input": payload, "out_path": out_path, "model_id": model_id,
            "resolution": resolution, "aspect_ratio": args.aspect_ratio,
            "first_frame": args.first_frame, "last_frame": args.last_frame}


def _keyframe_finish(plan: dict, job: Path, elapsed: float) -> None:
    out_path = plan["out_path"]
    print(f"[mint_video:keyframe] done in {elapsed:.1f}s "
          f"({out_path.stat().st_size // 1024} KB) -> {out_path}")
    _watch_link(out_path)
    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=plan["prompt"],
        duration_seconds=elapsed,
        extra={"usage_role": "keyframe", "mode": "keyframe",
               "model": plan["model_id"], "aspect_ratio": plan["aspect_ratio"],
               "resolution": plan["resolution"], "quality": plan["quality"],
               "first_frame": plan["first_frame"], "last_frame": plan["last_frame"],
               "output": str(out_path),
               **({"batch": True} if plan.get("batch") else {})},
    )


def run_keyframe(args, job: Path) -> int:
    plan = _keyframe_plan(args, job)
    out_path = plan["out_path"]
    t0 = time.perf_counter()
    if gateway.enabled():
        _gateway_generate("keyframe", plan["input"], job, out_path, quality=plan["quality"])
        _keyframe_finish(plan, job, time.perf_counter() - t0)
        return 0
    result = replicate.run(plan["model_id"], input=plan["input"])
    _save_result(result, out_path, t0, label="mint_video:keyframe")
    _watch_link(out_path)
    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=plan["prompt"],
        duration_seconds=time.perf_counter() - t0,
        extra={"usage_role": "keyframe", "mode": "keyframe",
               "model": plan["model_id"], "aspect_ratio": plan["aspect_ratio"],
               "resolution": plan["resolution"], "quality": plan["quality"],
               "first_frame": plan["first_frame"], "last_frame": plan["last_frame"],
               "output": str(out_path)},
    )
    return 0


def _keyframe_output_path(args, job: Path) -> Path:
    """keyframe/multishot accept an explicit --output (edit-pipeline parity) OR a
    --name slot under the job dir. clips/<name>.mp4 by default."""
    if args.output:
        return Path(args.output)
    if not args.name:
        sys.exit("--mode keyframe needs --output PATH or --name <slot>")
    d = job / "clips"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{args.name}.mp4"


# ═════════════════════════════════════════════════════════════════════════════
# MODE: multishot — ordered multi-state sequence (was gen_video.py --multishot +
# the legacy multishot backend). Gemini Omni is the only supported route.
# Max 6 shots, ≥1s/shot, ≤6 refs. Total duration MUST equal the shot-duration sum.
# ═════════════════════════════════════════════════════════════════════════════

_IMAGE_CITATION_RE = re.compile(r"<<<image_(\d+)>>>")


def _validate_multishot_references(shots: list[dict], references: list[str],
                                   *, start_image: bool) -> None:
    """Reject missing, dangling, and silently-unused multishot references."""
    if not references:
        raise SystemExit("--mode multishot needs at least one --reference or "
                         "--start-image; every shot sequence is reference-led")
    if len(references) > 6:
        raise SystemExit(f"--mode multishot allows max 6 reference images; "
                         f"got {len(references)}")

    cited: set[int] = set()
    for i, shot in enumerate(shots):
        prompt = shot["prompt"]
        if not isinstance(prompt, str) or not prompt.strip():
            raise SystemExit(f"shot {i} prompt must be a non-empty string")
        for raw_idx in _IMAGE_CITATION_RE.findall(prompt):
            idx = int(raw_idx)
            if idx < 1 or idx > len(references):
                raise SystemExit(
                    f"shot {i} cites <<<image_{idx}>>> but only "
                    f"{len(references)} reference image(s) were supplied")
            cited.add(idx)

    # --start-image is an implicit opening-state anchor; every ordinary
    # --reference must be named explicitly.
    required = set(range(2 if start_image else 1, len(references) + 1))
    uncited = sorted(required - cited)
    if uncited:
        tokens = ", ".join(f"<<<image_{i}>>>" for i in uncited)
        raise SystemExit(
            "multishot reference(s) are never cited in a shot prompt: "
            f"{tokens}. Cite each --reference using its upload-order token.")


def _refuse_unavailable_mode(mode: str) -> None:
    if mode in MINT_VIDEO_UNAVAILABLE_MODES:
        raise SystemExit(f"ERROR: {MINT_VIDEO_UNAVAILABLE_MODES[mode]}")


def _multishot_plan(args, job: Path, ref=None) -> dict:
    """Validate one multishot and build its request; uploads only, never paid work."""
    _refuse_unavailable_mode("multishot")
    quality = _effective_quality(args, "multishot")
    if not gateway.enabled():
        raise SystemExit(
            "--mode multishot requires VIDEOCLAW_API_KEY (Gemini gateway route)")
    if args.seed is not None:
        # #276: the gateway's Gemini Omni adapter sends no seed (only model,
        # inputs and response_format), so passing one through would be
        # silently dropped. Refuse before any upload instead of pretending.
        raise SystemExit(
            "--seed is not supported for --mode multishot: the Gemini Omni route "
            "takes no seed, so it would be ignored. For one consistent voice across "
            "clips, generate with --no-audio and lay a single synth_voice track over them.")
    # Resolve the multi-shot JSON from --multishot-file (preferred) or inline --multishot.
    multi_prompt = args.multishot
    if args.multishot_file:
        multi_prompt = Path(args.multishot_file).read_text()
    if not multi_prompt:
        sys.exit("--mode multishot needs --multishot-file <json> (or inline --multishot '<json>')")

    try:
        shots = json.loads(multi_prompt)
    except json.JSONDecodeError as e:
        raise SystemExit(f"--multishot is not valid JSON: {e}")
    if not isinstance(shots, list) or not shots:
        raise SystemExit("--multishot must be a non-empty JSON array of {prompt,duration} shots")
    if len(shots) > 6:
        raise SystemExit(f"--mode multishot allows max 6 shots; got {len(shots)}")
    shot_total = 0
    for i, s in enumerate(shots):
        if not isinstance(s, dict) or "prompt" not in s or "duration" not in s:
            raise SystemExit(f"shot {i} must be an object with 'prompt' and 'duration'")
        if not isinstance(s["duration"], (int, float)):
            raise SystemExit(f"shot {i} duration must be a number")
        if s["duration"] < 1:
            raise SystemExit(f"shot {i} duration {s['duration']}s is below the 1s/shot minimum")
        shot_total += s["duration"]

    # Duration MUST equal the sum of shot durations. --duration default sentinel
    # (5) means "auto-compute from shots"; an explicit mismatch is corrected with a warning.
    if args.duration is None or args.duration == 5:
        duration = shot_total
    elif int(args.duration) != shot_total:
        print(f"[mint_video:multishot] WARN: --duration {args.duration} != sum of shot "
              f"durations {shot_total}; using the exact shot sum {shot_total}.",
              file=sys.stderr)
        duration = shot_total
    else:
        duration = int(args.duration)

    reference_images = list(args.reference or [])
    # Back-compat: --start-image maps onto the first reference.
    if args.start_image:
        reference_images = [args.start_image] + reference_images
    _validate_multishot_references(
        shots, reference_images, start_image=bool(args.start_image))

    base_prompt = args.prompt or (
        "the hand places cards on the mat one by one, stable camera, "
        "no table or camera movement"
    )

    out_path = _keyframe_output_path(args, job)  # clips/<name>.mp4 or --output

    _ref = ref or _gw_ref
    payload = {
        "prompt": base_prompt,
        "duration": duration,
        "aspect_ratio": args.aspect_ratio,
        "multi_prompt": multi_prompt,
        "generate_audio": not args.no_audio,
        "reference_images": [_ref(r) for r in reference_images],
    }

    route = _route_label("multishot", quality, via_gateway=gateway.enabled())
    print(f"[mint_video:multishot] {route} → {out_path.name} "
          f"({duration}s @ {args.aspect_ratio}, {len(shots)} shots, {len(reference_images)} refs)")
    for s in shots:
        print(f"   [{s['duration']}s] {s['prompt'][:80]}")
    return {"mode": "multishot", "name": args.name or out_path.stem, "prompt": base_prompt,
            "quality": quality, "input": payload, "out_path": out_path, "model_id": route,
            "no_audio": bool(args.no_audio), "aspect_ratio": args.aspect_ratio,
            "shots": len(shots), "duration": duration, "refs": len(reference_images)}


def _multishot_finish(plan: dict, job: Path, elapsed: float) -> None:
    out_path = plan["out_path"]
    if plan["no_audio"]:
        _remove_audio(out_path)
    print(f"[mint_video:multishot] done in {elapsed:.1f}s "
          f"-> {out_path} ({out_path.stat().st_size//1024} KB)")
    _watch_link(out_path)

    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=plan["prompt"],
        duration_seconds=elapsed,
        extra={"usage_role": "multishot", "mode": "multishot",
               "model": plan["model_id"], "quality": plan["quality"],
               "aspect_ratio": plan["aspect_ratio"],
               "shots": plan["shots"], "duration": plan["duration"],
               "refs": plan["refs"], "output": str(out_path),
               **({"batch": True} if plan.get("batch") else {})},
    )


def run_multishot(args, job: Path) -> int:
    _refuse_unavailable_mode("multishot")
    plan = _multishot_plan(args, job)
    t0 = time.perf_counter()
    _gateway_generate("multishot", plan["input"], job, plan["out_path"], quality=plan["quality"])
    _multishot_finish(plan, job, time.perf_counter() - t0)
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# MODE: reenact — identity motion transfer. Kling v3 Pro via the gateway.
# Includes the closed-eye first-frame pre-flight.
# ═════════════════════════════════════════════════════════════════════════════

REENACT_DEFAULT_PROMPT = (
    "The person in <<<image_1>>> performs the exact same head movements, facial "
    "expressions, eye movements, and hand gestures as the person in <<<video_1>>>, "
    "while keeping their own face, hair, skin tone, glasses, and appearance from "
    "<<<image_1>>>. Vertical selfie-style framing, plain background, one continuous shot."
)

# --- closed-eye first-frame pre-flight ---------------------------------------
# Reenactment copies the driver's opening pose; a closed-eye first frame can
# closed/half-closed eyes across the whole shot (session 3dc570c9 / rank03).
EYE_GEMINI_MODEL = "~google/gemini-pro-latest"
EYE_GEMINI_PROMPT = (
    "Look ONLY at the human subject's eyes in this single video frame. "
    "Are the eyes OPEN or CLOSED? Treat a blink or shut eyes as CLOSED. "
    "If no face or eyes are clearly visible, answer UNKNOWN. "
    "Reply with EXACTLY one word: OPEN, CLOSED, or UNKNOWN."
)


def _extract_first_frame(video: Path) -> Path:
    frame_path = Path(tempfile.mkdtemp(prefix="mint_video_preflight_")) / f"{video.stem}_firstframe.jpg"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(video),
         "-frames:v", "1", "-q:v", "2", str(frame_path)],
        check=True, timeout=60,
    )
    if not frame_path.exists():
        raise RuntimeError("ffmpeg produced no first-frame image")
    return frame_path


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    return inter / (aw * ah + bw * bh - inter) if inter else 0.0


def _dedupe(regions, thr: float = 0.3):
    kept = []
    for r in sorted(regions, key=lambda r: -r[2] * r[3]):
        if all(_iou(r, k) < thr for k in kept):
            kept.append(r)
    return kept


def _eye_check_opencv(frame_path: Path) -> tuple[str, str]:
    import cv2  # heavy import — defer until the check actually runs
    casc = cv2.data.haarcascades
    face_cc = cv2.CascadeClassifier(os.path.join(casc, "haarcascade_frontalface_default.xml"))
    eye_cc = cv2.CascadeClassifier(os.path.join(casc, "haarcascade_eye.xml"))
    glass_cc = cv2.CascadeClassifier(os.path.join(casc, "haarcascade_eye_tree_eyeglasses.xml"))
    if face_cc.empty() or eye_cc.empty():
        return "unknown", "OpenCV Haar cascades failed to load"
    img = cv2.imread(str(frame_path))
    if img is None:
        return "unknown", "could not read the extracted frame"
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    faces = face_cc.detectMultiScale(gray, 1.1, 5, minSize=(60, 60))
    if len(faces) == 0:
        return "unknown", "no face detected in the first frame"
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    roi = gray[y:y + int(h * 0.6), x:x + w]  # eyes live in the upper ~60% of the face
    min_eye = (int(w * 0.12), int(w * 0.12))
    eyes = list(eye_cc.detectMultiScale(roi, 1.1, 6, minSize=min_eye))
    glasses = list(glass_cc.detectMultiScale(roi, 1.1, 6, minSize=min_eye))
    open_regions = _dedupe(eyes + glasses)
    detail = (f"{len(open_regions)} distinct open-eye region(s) in face, need 2 "
              f"(eye={len(eyes)} glasses={len(glasses)})")
    return ("open" if len(open_regions) >= 2 else "closed"), detail


def _eye_check_gemini(frame_path: Path, job: Path) -> tuple[str, str]:
    if gateway.enabled():
        # Gateway mode: route the semantic look via qa_video/eye_check. The frame
        # travels as a reference upload; max_output_tokens stays generous because
        # gemini-pro spends hidden reasoning tokens before the visible answer.
        res = gateway.run("qa_video", role="eye_check",
                          params={"prompt": EYE_GEMINI_PROMPT, "_media": "image",
                                  "max_output_tokens": 2000},
                          references=[str(frame_path)], job=job)
        content = ((res.get("output") or {}).get("text") or "").strip().upper()
    else:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            return "unknown", "OPENROUTER_API_KEY not set — cannot run the gemini eye check"
        from openai import OpenAI
        b64 = base64.b64encode(frame_path.read_bytes()).decode()
        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        resp = client.chat.completions.create(
            model=EYE_GEMINI_MODEL,
            max_tokens=2000,  # gemini-pro spends hidden reasoning tokens before the visible answer
            timeout=60,
            messages=[{"role": "user", "content": [
                {"type": "text", "text": EYE_GEMINI_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]}],
        )
        content = (resp.choices[0].message.content or "").strip().upper() if resp.choices else ""
    if "CLOSED" in content:
        return "closed", "gemini verdict: CLOSED"
    if "OPEN" in content:
        return "open", "gemini verdict: OPEN"
    return "unknown", f"gemini gave no clear verdict (got {content!r})"


def preflight_eye_check(
    video: Path, method: str, strict: bool, job: Path
) -> None:
    """Inspect the driver's first frame; WARN (or, with --strict, exit 1) on closed eyes.
    Never raises into the caller: a flaky check degrades to an inconclusive NOTE."""
    try:
        frame_path = _extract_first_frame(video)
    except Exception as e:
        print(f"[mint_video:reenact] eye pre-flight skipped — couldn't extract first frame "
              f"({type(e).__name__}: {e})")
        return
    try:
        if method == "gemini":
            verdict, detail = _eye_check_gemini(frame_path, job)
        else:
            verdict, detail = _eye_check_opencv(frame_path)
    except Exception as e:
        print(f"[mint_video:reenact] eye pre-flight inconclusive — {method} check errored "
              f"({type(e).__name__}: {e})")
        print(f"                first frame saved at: {frame_path}")
        return

    if verdict == "open":
        print(f"[mint_video:reenact] eye pre-flight OK — eyes appear open ({method}: {detail})")
        return
    if verdict == "unknown":
        print(f"[mint_video:reenact] eye pre-flight inconclusive — {detail}")
        print(f"                inspect the first frame yourself: {frame_path}")
        return

    # verdict == "closed"
    print("=" * 72)
    print("WARNING: the driver's FIRST FRAME appears to have CLOSED eyes.")
    print(f"         frame:  {frame_path}")
    print(f"         detail: {method}: {detail}")
    print("         Reenactment copies the opening pose, so a closed-eye first frame can")
    print("         to reproduce as closed/half-closed eyes across the reenactment")
    print("         (the rank03 failure mode). Trim the driver to start on an")
    print("         open-eye frame, or pick a different clip.")
    if method != "gemini":
        print("         Heuristic check — re-run with --eye-check-method gemini to confirm.")
    print("=" * 72)
    if strict:
        sys.exit("[mint_video:reenact] --strict set and first-frame eyes look closed: refusing to run.")


def run_reenact(args, job: Path) -> int:
    quality = _effective_quality(args, "reenact")
    if not gateway.enabled():
        raise SystemExit(
            "--mode reenact requires VIDEOCLAW_API_KEY (Kling gateway route)")
    if not args.swap_image:
        sys.exit("--mode reenact needs --swap-image <png> (the face to swap in, <<<image_1>>>)")
    if not args.driver_video:
        sys.exit("--mode reenact needs --driver-video <mp4> (the motion source, <<<video_1>>>)")

    img = _bound_input(args, args.swap_image)
    vid = _bound_input(args, args.driver_video)
    for p in (img, vid):
        if not p.exists():
            sys.exit(f"not found: {p}")

    out_path = _reenact_output_path(args, job)

    # Pre-flight: a closed-eye first frame reproduces as closed eyes (3dc570c9 / rank03).
    if not args.skip_eye_check:
        preflight_eye_check(
            vid, method=args.eye_check_method, strict=args.strict, job=job
        )
    # Reenact output follows the driver's clock. Probe it once and use that
    # value for both provider serialization and the gateway's canonical
    # metering field; a stale/default CLI duration must never understate spend.
    driver_seconds = round(
        _guard_short_input(vid, "--driver-video", args.allow_short), 3)
    if args.duration is not None and abs(args.duration - driver_seconds) > 0.05:
        print(
            f"[mint_video:reenact] WARN: --duration {args.duration}s does not "
            f"match the {driver_seconds}s driver; using the driver duration.",
            file=sys.stderr,
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)

    prompt = args.prompt or REENACT_DEFAULT_PROMPT

    img_ref = gateway.upload(img)
    vid_ref = gateway.upload(vid)
    print(f"  gateway uploads: image={img_ref}  video={vid_ref}")

    payload = {
        "prompt": prompt,
        "reference_images": [img_ref],
        "reference_video": vid_ref,
        "character_orientation": "image",
        "keep_original_sound": True,
        "aspect_ratio": args.aspect_ratio,
        "duration": driver_seconds,
    }
    route = _route_label("reenact", quality, via_gateway=gateway.enabled())
    print(f"[mint_video:reenact] {route} -> {out_path.name} "
          f"({driver_seconds}s @ {args.aspect_ratio}, quality={quality})")
    print(f"  image: {img.name}  video: {vid.name}")
    t0 = time.perf_counter()
    _gateway_generate("reenact", payload, job, out_path, quality=quality)
    _restore_driver_audio(vid, out_path)
    print(f"[mint_video:reenact] done in {time.perf_counter() - t0:.1f}s "
          f"({out_path.stat().st_size // 1024} KB) -> {out_path}")

    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=prompt,
        duration_seconds=time.perf_counter() - t0,
        extra={"usage_role": "reenact", "mode": "reenact",
               "model": route, "quality": quality,
               "aspect_ratio": args.aspect_ratio,
               "swap_image": str(args.swap_image),
               "driver_video": str(args.driver_video),
               "output": str(out_path)},
    )
    return 0


def _has_audio(path: Path) -> bool:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True, timeout=60,
        )
        return bool(result.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


def _restore_driver_audio(driver: Path, generated: Path) -> None:
    """Use the user's driver audio exactly; never add an implicit lipsync step."""
    if not _has_audio(driver):
        return
    remuxed = generated.with_name(f".{generated.stem}.driver-audio.mp4")
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y",
             "-i", str(generated), "-i", str(driver),
             "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
             "-c:a", "aac", "-shortest", "-movflags", "+faststart",
             str(remuxed)],
            check=True, timeout=180,
        )
        remuxed.replace(generated)
        print("[mint_video:reenact] restored the original driver audio; no lipsync added")
    finally:
        if remuxed.exists():
            remuxed.unlink()


def _reenact_output_path(args, job: Path) -> Path:
    if args.output:
        return Path(args.output)
    if not args.name:
        sys.exit("--mode reenact needs --output PATH or --name <slot>")
    d = job / "reenact"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{args.name}.mp4"


# ═════════════════════════════════════════════════════════════════════════════
# MODE: edit — prompt-driven video-to-video on an existing clip (chunk 31).
# Gemini Omni Flash /edit via fal: restyle, scene/object edits. The engine's
# ENTIRE input schema is prompt + video_url — no image refs, no duration knob
# (output tracks the input clip). Billing is per second of output (~$0.13/s),
# so the probed input duration rides as `seconds` for honest metering.
# ═════════════════════════════════════════════════════════════════════════════

def _probe_duration(p: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=60,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        sys.exit(f"could not probe duration of {p} — is it a video file?")


def _guard_short_input(p: Path, what: str, allow: bool) -> float:
    """Refuse sub-3s omni inputs loudly (they process garbled) unless
    --allow-short. Returns the probed duration. The fix is to CUT LONGER —
    pad the cut window into adjacent footage and trim the output after."""
    dur = _probe_duration(p)
    if dur < MIN_OMNI_INPUT_S and not allow:
        sys.exit(
            f"{what} is {dur:.2f}s — the engine mishandles video inputs under "
            f"~3s (garbled output, still billed). Cut a longer window (pad "
            f"into adjacent footage; e.g. ffmpeg -ss <start-pad> -t 3.3) and "
            f"trim the result, or pass --allow-short to send it anyway.")
    return dur


def _conform_duration(p: Path, actual: float, target: float) -> None:
    """Retime a clip (video + any audio) from `actual` to `target` seconds."""
    has_audio = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=codec_type", "-of", "csv=p=0", str(p)],
        capture_output=True, text=True, timeout=60,
    ).stdout.strip() != ""
    tmp = p.with_name(f".{p.stem}_conform{p.suffix}")
    fc = f"[0:v]setpts=PTS*{target / actual:.6f}[v]"
    maps = ["-map", "[v]"]
    if has_audio:
        fc += f";[0:a]atempo={actual / target:.6f}[a]"
        maps += ["-map", "[a]"]
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(p),
         "-filter_complex", fc, *maps,
         "-c:v", "libx264", "-crf", "18", "-preset", "medium",
         *(["-c:a", "aac", "-b:a", "192k"] if has_audio else []),
         str(tmp)],
        check=True, timeout=600,
    )
    tmp.replace(p)


def _remove_audio(path: Path) -> None:
    """Make --no-audio provider-independent by stripping after generation."""
    tmp = path.with_name(f".{path.stem}_silent{path.suffix}")
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(path),
         "-map", "0:v:0", "-c:v", "copy", "-an", str(tmp)],
        check=True, timeout=600,
    )
    tmp.replace(path)


def run_edit(args, job: Path) -> int:
    quality = _effective_quality(args, "edit")
    if len(args.video) != 1:
        sys.exit("--mode edit needs exactly one --video <mp4|mov|webm> (the clip to edit)")
    if not args.prompt:
        sys.exit("--mode edit needs --prompt (a simple instruction — one change per call)")
    if args.reference:
        sys.exit("--mode edit takes NO --reference: the engine accepts prompt + video "
                 "only. An identity swap from a reference image is --mode genjutsu.")

    src = args.video[0]
    src_path = (
        None
        if src.startswith(("http://", "https://"))
        else _bound_input(args, src)
    )
    if src_path is not None and not src_path.exists():
        sys.exit(f"not found: {src_path}")

    if args.output:
        out_path = Path(args.output)
    elif args.name:
        d = job / "edits"
        d.mkdir(parents=True, exist_ok=True)
        out_path = d / f"{args.name}.mp4"
    else:
        sys.exit("--mode edit needs --output PATH or --name <slot> (saved as edits/<name>.mp4)")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # The engine edits best when told to leave the rest alone (vendor guidance);
    # add the guard unless the prompt already scopes what to keep.
    prompt = args.prompt.strip()
    if "keep" not in prompt.lower():
        prompt = f"{prompt} Keep everything else the same."

    # THE MEDIA IS THE INVOICE (#74). For a LOCAL source we probe the real clip
    # and bill that. For an http(s) source we cannot probe it here — and a
    # user-supplied --duration must NEVER become the billed length (that is how
    # `--video <url> --duration 0.01` metered a full edit at 0.01s). Send no
    # seconds at all for a URL source, so the server meters the actual uploaded
    # media rather than a typed claim. The app prices URL-source edits as
    # manual/unpriced for the same reason (videoclaw-app#207).
    seconds = (_guard_short_input(src_path, "--video", args.allow_short)
               if src_path is not None else None)

    route = _route_label("edit", quality, via_gateway=gateway.enabled())
    print(f"[mint_video:edit] {route} -> {out_path.name} "
          f"(~{seconds:.0f}s of output)" if seconds else
          f"[mint_video:edit] {route} -> {out_path.name}")
    print(f"  clip: {src}  prompt: {prompt!r}")
    t0 = time.perf_counter()

    if gateway.enabled():
        res = gateway.run(
            "mint_video", mode="edit",
            references=[str(src_path) if src_path is not None else src],
            params={"prompt": prompt},
            quality=quality,
            **({"seconds": seconds} if seconds else {}),
            job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
            deadline=COMMAND_DEADLINE, _delivery=[out_path],
        )
        assets = res.get("assets") or []
        if not assets:
            raise SystemExit(f"[mint_video:edit] gateway returned no assets "
                             f"(status={res.get('status')})")
        gateway.download_asset(assets[0], out_path)
    else:
        # Raw mode: fal directly (the lipsync_footage.py pattern; needs FAL_KEY
        # or FAL_API_KEY in .env).
        from lipsync_footage import load_dotenv_fal
        load_dotenv_fal()
        if not os.environ.get("FAL_KEY"):
            sys.exit("ERROR: --mode edit needs VIDEOCLAW_API_KEY (gateway) or "
                     "FAL_KEY/FAL_API_KEY in .env")
        import fal_client
        video_url = src if src_path is None else fal_client.upload_file(str(src_path))
        res = fal_client.subscribe(
            OMNI_EDIT_MODEL,
            arguments={"prompt": prompt, "video_url": video_url},
            with_logs=False,
        )
        import urllib.request
        urllib.request.urlretrieve(res["video"]["url"], str(out_path))

    # Conform to the source clock: Omni re-times slightly (live run 2026-07-18:
    # 8.170s back from an 8.067s clip, ~1.3% — enough to drift lips off a VO by
    # the end). The edit-not-regenerate law depends on outputs being drop-in
    # replacements on the source timeline, so retime video+audio to match.
    if seconds:
        out_dur = _probe_duration(out_path)
        if out_dur and abs(out_dur - seconds) / seconds > 0.005:
            _conform_duration(out_path, out_dur, seconds)
            print(f"[mint_video:edit] retimed {out_dur:.3f}s → {seconds:.3f}s "
                  f"(source clock)")

    print(f"[mint_video:edit] done in {time.perf_counter() - t0:.1f}s "
          f"({out_path.stat().st_size // 1024} KB) -> {out_path}")
    print(f"▶ WATCH → file://{out_path.resolve()}")

    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=prompt,
        duration_seconds=time.perf_counter() - t0,
        extra={"usage_role": "edit", "mode": "edit",
               "model": route, "quality": quality,
               "source_video": str(src), "output_seconds": seconds,
               "output": str(out_path)},
    )
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# MODE: genjutsu — recast a real clip from reference images (Higgsfield
# Genjutsu motion transfer, gateway only). The source clip's motion, camera
# path, timing and cuts carry over; 1–8 ordered reference images (cited in the
# prompt as "Image 1".."Image N") supply characters, outfits and places.
# Billing is per WHOLE second of the INPUT clip at --resolution (480p/720p/
# 1080p), so the probed source length rides as `seconds`; the gateway measures
# the uploaded bytes itself and bills that. The generated soundtrack is always
# discarded and the source clip's own audio is laid back on.
# ═════════════════════════════════════════════════════════════════════════════

def _probe_video_stream(p: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=duration,nb_frames,avg_frame_rate,pix_fmt,color_transfer,"
         "color_primaries,color_space", "-of", "json", str(p)],
        capture_output=True, text=True, timeout=60,
    )
    try:
        streams = json.loads(out.stdout).get("streams") or []
    except ValueError:
        streams = []
    if not streams:
        sys.exit(f"could not read a video stream from {p} — is it a video file?")
    return streams[0]


def _picture_seconds(stream: dict) -> float | None:
    try:
        return float(stream["duration"])
    except (KeyError, TypeError, ValueError):
        pass
    try:
        num, den = (float(x) for x in str(stream["avg_frame_rate"]).split("/"))
        return int(stream["nb_frames"]) / (num / den)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None


def _guard_genjutsu_input(p: Path, what: str, allow_short: bool) -> float:
    """Probe the billed source clip and refuse lengths the route cannot take.

    The container length is what bills; the 4s minimum applies to the picture,
    which a longer soundtrack can hide (videoclaw#316)."""
    dur = _probe_duration(p)
    if dur > GENJUTSU_MAX_INPUT_S:
        raise SystemExit(
            f"{what} is {dur:.2f}s — genjutsu takes source clips of at most "
            f"{GENJUTSU_MAX_INPUT_S:g}s (billed per input second). Trim it, or "
            "split it into ≤30s segments and send them as a --batch.")
    if allow_short:
        return dur
    picture = _picture_seconds(_probe_video_stream(p))
    if picture is None:
        raise SystemExit(
            f"{what}: could not measure the length of its picture, so the "
            f"{GENJUTSU_MIN_INPUT_S:g}s genjutsu minimum cannot be checked. "
            "Re-encode it as MP4/MOV, or pass --allow-short to send it anyway.")
    if picture < GENJUTSU_MIN_INPUT_S:
        longer = (f" (the file runs {dur:.3f}s only because its audio is longer)"
                  if dur - picture >= 0.0005 else "")
        raise SystemExit(
            f"{what} has {picture:.3f}s of picture{longer} — Higgsfield documents a "
            f"{GENJUTSU_MIN_INPUT_S:g}s minimum source for genjutsu. Cut a longer "
            "window (pad into adjacent footage) and trim the result, or pass "
            "--allow-short to send it anyway.")
    return dur


def _genjutsu_sdr_reason(stream: dict) -> str | None:
    transfer = stream.get("color_transfer")
    if transfer in GENJUTSU_HDR_TRANSFERS:
        return f"HDR ({transfer})"
    depth = re.search(r"(\d+)(?:le|be)$", stream.get("pix_fmt") or "")
    if depth and int(depth.group(1)) > 8:
        return f"{depth.group(1)}-bit ({stream['pix_fmt']})"
    return None


def _ffmpeg_has_filters(*names: str) -> bool:
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    available = {parts[1] for parts in map(str.split, out.splitlines()) if len(parts) > 2}
    return all(name in available for name in names)


def _genjutsu_sdr_filter(stream: dict) -> str:
    cap = GENJUTSU_SDR_MAX_SIDE
    scale = (f"scale=w='if(gte(iw,ih),min({cap},iw),-2)':"
             f"h='if(gte(iw,ih),-2,min({cap},ih))'")
    transfer = stream.get("color_transfer")
    if transfer not in GENJUTSU_HDR_TRANSFERS:
        return f"{scale},format=yuv420p"
    primaries = stream.get("color_primaries") or "bt2020"
    matrix = stream.get("color_space") or "bt2020nc"
    if primaries == "unknown":
        primaries = "bt2020"
    if matrix == "unknown":
        matrix = "bt2020nc"
    return (f"{scale},zscale=tin={transfer}:pin={primaries}:min={matrix}:"
            "t=linear:npl=100:p=bt709,format=gbrpf32le,tonemap=hable:desat=0,"
            "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


def _genjutsu_provider_source(src: Path, seconds: float, workdir: Path,
                              what: str) -> tuple[Path, float]:
    """The clip to upload and its billed length.

    An 8-bit SDR source is sent untouched. A 10-bit or HDR one is re-encoded to
    8-bit BT.709 H.264 with its audio copied, so the billed length cannot move.
    """
    stream = _probe_video_stream(src)
    reason = _genjutsu_sdr_reason(stream)
    if reason is None:
        return src, seconds
    if (stream.get("color_transfer") in GENJUTSU_HDR_TRANSFERS
            and not _ffmpeg_has_filters("zscale", "tonemap")):
        raise SystemExit(
            f"{what} is {reason}, which genjutsu's provider may not decode, and this "
            "ffmpeg has no zscale/tonemap filter to convert it. Convert it to 8-bit "
            "SDR (BT.709) first. Nothing was uploaded or charged.")
    out = workdir / f"{src.stem}.sdr{src.suffix}"
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src),
             "-map", "0:v:0", "-map", "0:a:0?", "-vf", _genjutsu_sdr_filter(stream),
             "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
             "-crf", "16", "-preset", "veryfast",
             "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
             "-c:a", "copy", "-movflags", "+faststart", str(out)],
            check=True, capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        detail = (getattr(exc, "stderr", "") or str(exc)).strip()[-300:]
        raise SystemExit(f"{what} is {reason} and could not be converted to 8-bit SDR "
                         f"for the provider: {detail}. Nothing was uploaded or charged.")
    from cost import genjutsu_billed_seconds
    converted = _probe_duration(out)
    if genjutsu_billed_seconds(converted) != genjutsu_billed_seconds(seconds):
        raise SystemExit(
            f"{what}: converting it to 8-bit SDR changed its billed length "
            f"({seconds:.3f}s → {converted:.3f}s). Convert it yourself first. "
            "Nothing was uploaded or charged.")
    print(f"[mint_video:genjutsu] {what} is {reason}; sending an 8-bit SDR "
          "(BT.709) copy the provider can decode")
    return out, converted


def _bind_genjutsu_references(args, refs: list, *,
                              job: Path | None = None) -> list[str | Path]:
    """Validate and bind the ordered references BEFORE any upload or spend.

    https URLs pass through; every local image is snapshotted through the
    immutable input binding, so a file changed after pricing fails here.
    """
    if not isinstance(refs, list) or not 1 <= len(refs) <= GENJUTSU_MAX_REFERENCES:
        count = len(refs) if isinstance(refs, list) else 0
        raise SystemExit(
            f"genjutsu needs 1 to {GENJUTSU_MAX_REFERENCES} --reference images "
            f"(characters, outfits, places, in citation order); got {count}")
    bound: list[str | Path] = []
    for ref in refs:
        if not isinstance(ref, str) or not ref.strip():
            raise SystemExit(f"genjutsu reference must be a path or https URL: {ref!r}")
        if ref.startswith("https://"):
            bound.append(ref)
            continue
        if ref.startswith(("http://", "data:")):
            raise SystemExit(
                f"genjutsu references must be local images or https URLs: {ref[:80]}")
        local = resolve_job_input_path(ref, job) if job is not None else Path(ref)
        snapshot = _bound_input(args, local)
        if not snapshot.exists():
            raise SystemExit(f"reference not found: {local}")
        bound.append(snapshot)
    return bound


def _upload_genjutsu_references(bound: list[str | Path],
                                cache: dict | None = None) -> list[str]:
    """Gateway refs in citation order; a shared image is uploaded once."""
    out: list[str] = []
    for ref in bound:
        if isinstance(ref, str):
            out.append(ref)
            continue
        key = str(Path(ref).resolve())
        if cache is not None and key in cache:
            out.append(cache[key])
            continue
        uploaded = gateway.upload(ref)
        if cache is not None:
            cache[key] = uploaded
        out.append(uploaded)
    return out


def _keep_source_audio(source: Path, generated: Path, source_seconds: float) -> None:
    """Make the delivered clip a drop-in replacement on the source timeline.

    The generated soundtrack is always stripped (never silently kept when the
    source is silent), the picture is conformed to the source clock when the
    provider re-timed it by more than 0.5%, and the source clip's own audio is
    laid back on untouched. No lipsync or synthesized audio is ever added.
    """
    # Decide first, fail closed: a probe error must never be read as "silent
    # source" after the generated track is already gone.
    keep_audio = _source_has_audio(source)
    _remove_audio(generated)
    out_dur = _probe_duration(generated)
    if source_seconds and out_dur and abs(out_dur - source_seconds) / source_seconds > 0.005:
        _conform_duration(generated, out_dur, source_seconds)
        print(f"[mint_video:genjutsu] retimed {out_dur:.3f}s → {source_seconds:.3f}s "
              "(source clock)")
    if not keep_audio:
        print("[mint_video:genjutsu] source clip has no audio; delivered silent")
        return
    remuxed = generated.with_name(f".{generated.stem}.source-audio.mp4")
    try:
        subprocess.run(
            # apad + -shortest: a source whose audio stops early is padded
            # with silence, so the picture always runs to its full length,
            # and audio that runs past the picture is cut at its end.
            ["ffmpeg", "-nostdin", "-v", "error", "-y",
             "-i", str(generated), "-i", str(source),
             "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
             "-af", "apad", "-c:a", "aac", "-shortest", "-movflags", "+faststart",
             str(remuxed)],
            check=True, timeout=180,
        )
        remuxed.replace(generated)
        print("[mint_video:genjutsu] kept the source clip's original audio")
    finally:
        if remuxed.exists():
            remuxed.unlink()


def _source_has_audio(path: Path) -> bool:
    """Whether the source clip has an audio stream; raises if ffprobe cannot
    tell (unlike _has_audio, which reads any probe failure as silence)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"could not read the source clip's audio: {exc}") from exc
    return bool(result.stdout.strip())


def _deliver_genjutsu(res: dict, out_path: Path, source: Path, seconds: float) -> None:
    """Publish the finished clip with the source audio, never the raw result.

    The provider file is downloaded beside the destination, post-processed,
    staged in the operation journal (so recovery can never substitute the raw
    generated soundtrack), then renamed into place and acknowledged.
    """
    assets = res.get("assets") or []
    if not assets or not isinstance(assets[0], dict) or not assets[0].get("url"):
        raise SystemExit(f"[mint_video:genjutsu] gateway returned no assets "
                         f"(status={res.get('status')})")
    asset = assets[0]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix=".genjutsu-", dir=out_path.parent) as temp:
            candidate = Path(temp) / out_path.name
            gateway.download(asset["url"], candidate)
            _keep_source_audio(source, candidate, seconds)
            gateway.note_output(asset, out_path, pending_bytes=candidate.read_bytes())
            candidate.replace(out_path)
    except GatewayAcceptedError:
        raise
    except Exception as exc:
        raise GatewayAcceptedError(
            f"Accepted genjutsu job {res.get('job_id')} could not be delivered: {exc}. "
            "The paid result is retained; recover it instead of generating again.") from exc
    gateway.note_output(asset, out_path)


GENJUTSU_RECOVERY_MAX_BYTES = 512 * 1024 * 1024


def _genjutsu_local_source(job: Path, source: Path, audio: Path) -> dict | None:
    """The operation record's note of this video's own source clip.

    videoclaw-app#1064: delivery re-lays the audio of ``audio`` (the bound
    snapshot of ``source``, or ``source`` itself). Recording where ``source``
    sits in this video and the sha256 of those exact bytes lets background
    recovery do the same without reading the upload back, a read the app's
    recovery-only credential is refused. None when the clip is not inside
    this video or cannot be read: recovery then reads the upload, as before.
    """
    from _operations import local_source_path_ok
    try:
        relative = Path(os.path.realpath(source)).relative_to(os.path.realpath(job)).as_posix()
        digest = hashlib.sha256()
        size = 0
        with open(audio, "rb") as stream:
            for chunk in iter(lambda: stream.read(1 << 20), b""):
                digest.update(chunk)
                size += len(chunk)
    except (OSError, ValueError):
        return None
    if not local_source_path_ok(relative) or size <= 0:
        return None
    return {"path": relative, "sha256": digest.hexdigest(), "bytes": size}


def collect_genjutsu_output(client, url: str, record: dict, job: Path | None = None) -> bytes:
    """Restarted collection of a genjutsu result: the same transformation a
    finished run applies (_keep_source_audio), from the exact source clip the
    provider was given, never the raw result.

    The clip is this video's own copy when the record names one that still has
    the recorded sha256 (videoclaw-app#1064); otherwise it is the operation's
    pinned upload, read back exactly as before.
    """
    body = json.loads(record["body"])
    params = body.get("params") if isinstance(body, dict) else None
    source = params.get("reference_video") if isinstance(params, dict) else None
    seconds = body.get("seconds") if isinstance(body, dict) else None
    if (not isinstance(source, str) or not source.startswith("upload:")
            or isinstance(seconds, bool) or not isinstance(seconds, (int, float))):
        raise GatewayAcceptedError(
            "the genjutsu result cannot be recovered without its source clip")
    from _operations import copy_local_source
    with tempfile.TemporaryDirectory(prefix="vc-genjutsu-recovery-") as directory:
        generated = Path(directory) / "generated.mp4"
        source_clip = Path(directory) / "source.mp4"
        local = job is not None and copy_local_source(
            job, record, source_clip, max_bytes=GENJUTSU_RECOVERY_MAX_BYTES)
        if not local:
            from urllib.parse import quote
            read_url = client._req("GET", f"/v1/uploads/{quote(source[len('upload:'):], safe='')}")
            if not isinstance(read_url, dict) or not isinstance(read_url.get("read_url"), str):
                raise GatewayAcceptedError("the genjutsu source clip is no longer readable")
        with generated.open("wb") as out:
            client._download_to(url, out, max_bytes=GENJUTSU_RECOVERY_MAX_BYTES)
        if not local:
            with source_clip.open("wb") as out:
                client._download_to(read_url["read_url"], out,
                                    max_bytes=GENJUTSU_RECOVERY_MAX_BYTES)
        # The app reads the collector's stdout as exactly one JSON object;
        # the re-lay's progress lines go to stderr instead.
        with contextlib.redirect_stdout(sys.stderr):
            _keep_source_audio(source_clip, generated, float(seconds))
        return generated.read_bytes()


def _same_file(a: Path, b: Path) -> bool:
    try:
        return a.resolve() == b.resolve()
    except OSError:
        return False


# videoclaw#295 (JC): every genjutsu prompt says where each element comes from.
# The video supplies motion, choreography, camera, cuts and background; the
# reference images supply only the new characters' identity and appearance.
# JC 2026-09-29: the prompt states both lists explicitly (FROM THE VIDEO and
# FROM THE REFERENCES), and every person swap uses this recipe. A seed frame
# (the video's first frame with the characters already replaced) is
# recommended and usually required, so its template leads; the no-seed variant
# below is for a user who goes without one (recommend it, never block).
GENJUTSU_SEED_PROMPT_TEMPLATE = (
    "Image 1 is the video's first frame with the characters already replaced; match it. "
    "Replace the characters in the video with the characters in the reference images. "
    "The character on the left in the red jacket becomes the person in Image 2; the right "
    "character becomes the kiwi in Image 3. From the video, keep exactly the same: all "
    "motion, timing, camera path, cuts, background, setting and lighting. From the "
    "reference images, take only each character's identity: face, hair, outfit and body. "
    "Don't blend features between the characters (no cross-contamination).")
GENJUTSU_PROMPT_TEMPLATE = (
    "Replace the characters in the video with the characters in the reference images. "
    "The character on the left in the red jacket becomes the person in Image 1; the right "
    "character becomes the kiwi in Image 2. From the video, keep exactly the same: all "
    "motion, timing, camera path, cuts, background, setting and lighting. From the "
    "reference images, take only each character's identity: face, hair, outfit and body. "
    "Don't blend features between the characters (no cross-contamination).")
GENJUTSU_TEMPLATES_TEXT = (
    "With a seed frame (recommended and usually required; skip it only when an image "
    "already fits very well, and if the user insists on going without, recommend it and "
    "never block): make it with mint_image --role seed_frame --aspect <the clip's aspect> "
    "and pass it as the first --reference. Template: "
    f"\"{GENJUTSU_SEED_PROMPT_TEMPLATE}\" Without a seed frame: \"{GENJUTSU_PROMPT_TEMPLATE}\"")
# "Image 2", "Image #2", "Images 1 and 2", "Images 1, 2 & 3", "Images 1-3".
_GENJUTSU_IMAGE_CITATION = re.compile(
    r"\bimages?\s*#?\s*(\d+(?:\s*(?:,|and|&|or|to|-|\u2013)\s*#?\s*\d+)*)", re.IGNORECASE)
# What the prompt keeps from the video: a keep phrase and a video element in the
# same sentence ("Keep all motion the same", "The motion stays the same",
# "Same timing", "Maintain the choreography", "Don't change the background").
_GENJUTSU_KEEP = re.compile(
    r"\b(?:keep|keeps|keeping|kept|preserv\w*|retain\w*|maintain\w*|unchanged|unaltered|"
    r"intact|same|identical|(?:do\s+not|don['\u2019]t|does\s+not|doesn['\u2019]t|never|without)\s+"
    r"(?:change|changing|alter|altering))\b",
    re.IGNORECASE)
_GENJUTSU_FROM_VIDEO = re.compile(
    r"\b(?:motion|movements?|moves|choreography|timing|camera|performance|actions?|"
    r"background|setting|scene|backdrop|environment)\b",
    re.IGNORECASE)
# What the prompt takes from the references (JC 2026-09-29). A sentence counts
# when it names a person's identity element (face, hair, outfit, body) and is
# not just keeping that element from the video, or when it points at the
# references ("Image 2", "the reference images", "their photos") and names what
# they supply, which for a world or prop recast may be the setting or object.
# "Becomes the person in Image 1" names no element, so it does not count.
_GENJUTSU_IDENTITY = re.compile(
    r"\b(?:identity|identities|likeness|appearance|faces?|facial|hair\w*|outfits?|"
    r"clothes|clothing|costumes?|wardrobe|body|bodies|build|physique|skin)\b",
    re.IGNORECASE)
_GENJUTSU_WORLD = re.compile(
    r"\b(?:looks?|design|colou?rs?|props?|objects?|products?|background|setting|"
    r"scenery|environment|world|location)\b",
    re.IGNORECASE)
_GENJUTSU_REFERENCE_WORD = re.compile(
    r"\b(?:images?|references?|refs?|photos?|pictures?)\b", re.IGNORECASE)
_GENJUTSU_SWAP_VERB = re.compile(
    r"\b(?:replac\w*|swap\w*|becom\w*|takes?|taken|taking|use[sd]?|using|gives?|"
    r"giving|match\w*|appl(?:y|ies|ied)|comes?|suppl(?:y|ies|ied))\b",
    re.IGNORECASE)


def _genjutsu_cited_images(prompt: str) -> set[int]:
    cited: set[int] = set()
    for group in _GENJUTSU_IMAGE_CITATION.findall(prompt):
        for first, _, last in re.findall(
                r"(\d+)(\s*(?:to|-|\u2013)\s*#?\s*(\d+))?", group):
            start = int(first)
            end = int(last) if last else start
            cited.update(range(start, end + 1) if 0 < end - start < 16 else (start, end))
    return cited


def _genjutsu_keeps_video(prompt: str) -> bool:
    return any(_GENJUTSU_KEEP.search(sentence) and _GENJUTSU_FROM_VIDEO.search(sentence)
               for sentence in re.split(r"[.;!?\n]+", prompt))


def _genjutsu_takes_from_references(prompt: str) -> bool:
    for sentence in re.split(r"[.;!?\n]+", prompt):
        points = _GENJUTSU_REFERENCE_WORD.search(sentence)
        if _GENJUTSU_IDENTITY.search(sentence):
            if (points or _GENJUTSU_SWAP_VERB.search(sentence)
                    or not _GENJUTSU_KEEP.search(sentence)):
                return True
        elif points and _GENJUTSU_WORLD.search(sentence):
            return True
    return False


def _genjutsu_prompt_error(prompt: object, reference_count: int) -> str | None:
    """Why this prompt does not say who becomes whom, what to keep from the video
    and what to take from the references, else None."""
    if not isinstance(prompt, str) or not prompt.strip():
        problem = "there is no prompt"
    else:
        cited = _genjutsu_cited_images(prompt)
        missing = [f"Image {n}" for n in range(1, reference_count + 1) if n not in cited]
        extra = [f"Image {n}" for n in sorted(cited) if not 1 <= n <= reference_count]
        if missing:
            problem = f"it never names {', '.join(missing)}"
        elif extra:
            problem = (f"it names {', '.join(extra)}, but only {reference_count} "
                       "reference image(s) were given")
        elif not _genjutsu_keeps_video(prompt):
            problem = ("it doesn't say what to keep from the video (its motion, timing "
                       "and camera; usually its background too)")
        elif not _genjutsu_takes_from_references(prompt):
            problem = ("it doesn't say what to take from the reference images (each "
                       "character's face, hair, outfit and body; or the setting or object "
                       "an image supplies)")
        else:
            return None
    return (f"genjutsu --prompt must say who becomes whom, what to keep from the video and "
            f"what to take from the reference images; {problem}. Map every replaced "
            "character, named by screen position, clothing or role (not 'the man' when that "
            "is ambiguous), to its Image N (Image 1 is the first --reference); say that the "
            "video's motion, timing, camera path, cuts, background, setting and lighting "
            "stay the same; and say that the references supply only each character's "
            f"identity: face, hair, outfit and body. {GENJUTSU_TEMPLATES_TEXT}")


# The gateway reports a Higgsfield moderation refusal as a failed job whose
# error names the content policy (videoclaw-backend jobs._friendly_error).
_GENJUTSU_MODERATION = re.compile(
    r"content polic|moderation|policy refusal|\bnsfw\b", re.IGNORECASE)


def _genjutsu_refusal(exc: GatewayAcceptedError) -> str | None:
    """A plain explanation of a moderation refusal, else None (any other failure)."""
    result = getattr(exc, "result", None)
    if not isinstance(result, dict) or result.get("status") != "failed":
        return None
    detail = " ".join(str(result.get(k) or "") for k in ("error", "agent_detail"))
    if not _GENJUTSU_MODERATION.search(detail):
        return None
    charged = " Nothing was charged for it." if result.get("cost_usd") == 0 else ""
    job_id = result.get("job_id")
    # JC 2026-09-29: the fallback is Omni edit, never Kling; this is rare. Omni
    # edit takes a clip and a text instruction only (workflows#61).
    return ("Higgsfield's content moderation refused this swap"
            f"{f' (job {job_id})' if job_id else ''}.{charged} Rewording or re-running it "
            "will be refused again. Fall back once to Omni edit (mint_video --mode edit "
            "--video <the clip> --name <slot> --prompt \"...\"), describing each person "
            "in words, one person per call, chained: the first call edits the source "
            "clip and each later call takes the previous call's edits/<slot>.mp4 as "
            "--video under a new --name. It takes no photos. Tell the user the result will "
            "resemble the description, not their photo. If Omni edit also refuses or "
            "fails, stop and offer a fictional or stylised reference, changing only the "
            "outfit or setting, or a different clip. Never Kling.")


def _genjutsu_params(video_ref: str, reference_refs: list[str], resolution: str,
                     prompt: str | None) -> dict:
    if prompt is not None and len(prompt) > GENJUTSU_MAX_PROMPT_CHARS:
        raise SystemExit(
            f"genjutsu --prompt must be at most {GENJUTSU_MAX_PROMPT_CHARS} characters")
    params = {"reference_video": video_ref, "reference_images": reference_refs,
              "resolution": resolution}
    if prompt:
        params["prompt"] = prompt
    return params


def run_genjutsu(args, job: Path) -> int:
    quality = _effective_quality(args, "genjutsu")
    if not gateway.enabled():
        raise SystemExit(
            "--mode genjutsu requires VIDEOCLAW_API_KEY (Higgsfield gateway route)")
    if len(args.video) != 1:
        sys.exit("--mode genjutsu needs exactly one --video <mp4|mov> (the clip to recast)")
    src = args.video[0]
    if src.startswith(("http://", "https://", "data:")):
        sys.exit("--mode genjutsu bills every second of the source clip, so it must be a "
                 "local file the gateway can measure. Download it first (pull_video).")
    if args.prompt and len(args.prompt) > GENJUTSU_MAX_PROMPT_CHARS:
        sys.exit(f"genjutsu --prompt must be at most {GENJUTSU_MAX_PROMPT_CHARS} characters")
    bound_refs = _bind_genjutsu_references(args, list(args.reference or []))
    prompt_error = _genjutsu_prompt_error(args.prompt, len(bound_refs))
    if prompt_error:
        sys.exit(prompt_error)
    src_path = _bound_input(args, src)
    if not src_path.exists():
        sys.exit(f"not found: {src_path}")

    if args.output:
        out_path = Path(args.output)
    elif args.name:
        d = job / "genjutsu"
        d.mkdir(parents=True, exist_ok=True)
        out_path = d / f"{args.name}.mp4"
    else:
        sys.exit("--mode genjutsu needs --output PATH or --name <slot> "
                 "(saved as genjutsu/<name>.mp4)")
    if _same_file(out_path, Path(src)) or any(
            isinstance(ref, str) and not ref.startswith("https://")
            and _same_file(out_path, Path(ref)) for ref in args.reference or []):
        # Downloading over the source would destroy the audio this mode keeps.
        sys.exit("--mode genjutsu --output must not overwrite the source --video "
                 "or a --reference image")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # The source clip is the invoice: probe it once and send that length as
    # the canonical metering field; a typed --duration never prices this rail.
    seconds = _guard_genjutsu_input(src_path, "--video", args.allow_short)
    if args.duration is not None and abs(args.duration - seconds) > 0.05:
        print(f"[mint_video:genjutsu] WARN: --duration {args.duration}s is ignored; "
              f"the output follows the {seconds:.3f}s source clip.", file=sys.stderr)
    with tempfile.TemporaryDirectory(prefix="vc-genjutsu-source-") as scratch:
        upload_path, seconds = _genjutsu_provider_source(
            src_path, seconds, Path(scratch), "--video")
        refs = _upload_genjutsu_references(bound_refs)
        params = _genjutsu_params(gateway.upload(upload_path), refs, args.resolution,
                                  args.prompt)
    local_source = _genjutsu_local_source(job, Path(src), src_path)

    route = _route_label("genjutsu", quality, via_gateway=True)
    print(f"[mint_video:genjutsu] {route} -> {out_path.name} "
          f"({seconds:.2f}s source @ {args.resolution}, {len(refs)} reference(s))")
    t0 = time.perf_counter()
    try:
        res = gateway.run(
            "mint_video", mode="genjutsu", params=params, seconds=seconds,
            quality=quality, job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
            deadline=COMMAND_DEADLINE, _delivery=[out_path], _local_source=local_source)
    except GatewayAcceptedError as exc:
        refusal = _genjutsu_refusal(exc)
        if refusal is None:
            raise
        sys.exit(f"[mint_video:genjutsu] {refusal}")
    _deliver_genjutsu(res, out_path, src_path, seconds)
    print(f"[mint_video:genjutsu] done in {time.perf_counter() - t0:.1f}s "
          f"({out_path.stat().st_size // 1024} KB) -> {out_path}")
    _watch_link(out_path)

    log_event(
        job, tool="mint_video.py", event="video_generated",
        prompt=args.prompt or "",
        duration_seconds=time.perf_counter() - t0,
        extra={"usage_role": "genjutsu", "mode": "genjutsu",
               "model": route, "quality": quality,
               "resolution": args.resolution,
               "source_video": str(src), "source_seconds": seconds,
               "references": len(refs), "output": str(out_path)},
    )
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# BATCH — many generations of one mode in one process.
#
# edit/reenact (chunk 31) and genjutsu block at submit and return terminal, so
# their parallelism is client-side threads — the exact shape of the live
# danni-juhl fleet (17 clips, 4-way, ~4.5 min wall instead of ~15 serial).
# insert/keyframe (Seedance) submit fast and poll, so they use gateway.run_many:
# every item is submitted as paid capacity allows and all are polled together
# (#273: 7 clips fired as separate foreground calls ran back to back, ~17.5 min
# instead of ~3). multishot keeps its batch plan, but the mode is unavailable
# (videoclaw#317): main() refuses it before any batch work.
# ═════════════════════════════════════════════════════════════════════════════

BATCH_MODES = tuple(mode for mode in ("insert", "keyframe", "multishot", "edit", "reenact",
                                      "genjutsu")
                    if mode not in MINT_VIDEO_UNAVAILABLE_MODES)
GENERATION_BATCH_MODES = ("insert", "keyframe", "multishot")
_REMOTE_REF = ("http://", "https://", "data:")
_UNRESOLVED = {"accepted_unknown", "queued", "running", "reconciling", "submission_unknown"}


def _batch_error_note(exc: BaseException) -> str:
    """One failed item, saying whether a retry could buy it twice."""
    if isinstance(exc, GatewayDestinationClaimedError):
        # videoclaw#294: an earlier purchase owns this name. Re-running the
        # same name is refused again; only a new name is a new take.
        if exc.blocked:
            return f"nothing was charged; regenerate it under a new name: {exc}"
        return f"nothing was charged; an earlier paid request delivers it, do NOT re-run it: {exc}"
    if isinstance(exc, GatewayNotSubmittedError):
        return f"nothing was charged; safe to retry: {exc}"
    if isinstance(exc, GatewayAcceptedError):
        return ("accepted by the gateway and may be charged; do NOT retry it, recovery "
                f"keeps the original result: {exc}")
    return f"{type(exc).__name__}: {exc}"


def _batch_result_note(res: dict) -> str:
    detail = str(res.get("error") or "no detail")
    if res.get("agent_detail"):
        detail += f" ↳ {res['agent_detail']}"
    status = res.get("status")
    if status == "not_started":  # run_many's deadline: never sent
        return f"not started, nothing charged: {detail}; safe to retry"
    if status == "pending_delivery":  # videoclaw#294: an earlier purchase delivers it
        return f"nothing was charged; an earlier paid request delivers it, do NOT re-run it: {detail}"
    if res.get("rename_required"):
        return f"nothing was charged; regenerate it under a new name: {detail}"
    if res.get("not_submitted"):
        return f"nothing was charged; safe to retry: {detail}"
    if status in _UNRESOLVED or res.get("reconciliation_required"):
        return ("accepted and may be charged; do NOT retry it, recovery keeps the "
                f"original result: {detail}")
    if status == "authorization_required":
        return ("spending authorization is required and the gateway did not prove this "
                f"item was unsubmitted; check the spend before retrying: {detail}")
    return f"{status}: {detail}"


def _generation_item(args, spec: dict, job: Path):
    """Per-item namespace: the CLI flags are defaults, item fields override them."""
    spec = {key: value for key, value in spec.items() if value is not None}  # null = absent
    item = argparse.Namespace(**vars(args))
    item.batch = None
    item.name = spec.get("name")
    item.output = spec.get("output")
    for field in ("prompt", "duration", "resolution", "aspect_ratio", "seed",
                  "first_frame", "last_frame", "start_image", "audio", "no_audio"):
        if field in spec:
            setattr(item, field, spec[field])
    if "quality" in spec:
        item.quality, item.fast = spec["quality"], False
    if "reference" in spec:
        refs = spec["reference"]
        item.reference = [refs] if isinstance(refs, str) else list(refs)
    if args.mode == "multishot":
        item.multishot, item.multishot_file = json.dumps(spec["shots"]), None
    if not item.name:
        item.name = Path(item.output).stem
    return item


def _job_resolved_item(spec: object, job: Path) -> tuple[object, str | None]:
    """Resolve item media job-relative and outputs inside the job, like the CLI."""
    if not isinstance(spec, dict):
        return spec, None
    resolved = dict(spec)

    def local(value):
        if isinstance(value, str) and value and not value.startswith(_REMOTE_REF):
            return str(resolve_job_input_path(value, job))
        return value

    for field in ("first_frame", "last_frame", "start_image"):
        if field in resolved:
            resolved[field] = local(resolved[field])
    if isinstance(resolved.get("reference"), list):
        resolved["reference"] = [local(r) for r in resolved["reference"]]
    elif "reference" in resolved:
        resolved["reference"] = local(resolved["reference"])
    if isinstance(resolved.get("output"), str) and resolved["output"]:
        try:
            resolved["output"] = str(resolve_job_output_path(resolved["output"], job))
        except ValueError as exc:
            return resolved, str(exc)
    return resolved, None


def _run_generation_batch(args, job: Path, specs: list) -> int:
    """insert/keyframe/multishot fleets: validate all, then run them together."""
    mode = args.mode
    labels: list[str] = []
    outcomes: dict[int, str | None] = {}
    runnable: list[tuple[int, object]] = []
    planned_outputs: dict[str, str] = {}
    for index, raw in enumerate(specs):
        name = raw.get("name") if isinstance(raw, dict) else None
        labels.append(name if isinstance(name, str) and name else f"item {index + 1}")
        try:
            spec, path_err = _job_resolved_item(raw, job)
            err = path_err or batch_item_error(
                mode, spec, has_shared_prompt=bool(args.prompt),
                has_shared_first_frame=bool(args.first_frame))
            if err is None:
                item = _generation_item(args, spec, job)
        except Exception as exc:  # e.g. an embedded NUL in a path
            err = f"invalid item: {type(exc).__name__}: {exc}"
        if err is not None:
            outcomes[index] = err
            continue
        planned = Path(item.output) if item.output else job / "clips" / f"{item.name}.mp4"
        # macOS volumes treat Hero.mp4 and hero.mp4 as one file.
        key = unicodedata.normalize("NFC", str(planned)).casefold()
        if key in planned_outputs:
            outcomes[index] = (f"duplicate output {planned.name} (also {planned_outputs[key]}); "
                               "every item needs its own name")
            continue
        planned_outputs[key] = labels[index]
        runnable.append((index, item))

    # Upload each distinct local still once, however many items share it.
    uploads: dict[str, str] = {}

    def shared_ref(ref: str) -> str:
        if ref.startswith(_REMOTE_REF):
            return ref
        key = str(Path(ref).expanduser().resolve())
        if key not in uploads:
            uploads[key] = _gw_ref(ref)
        return uploads[key]

    plan_for = {"insert": _insert_plan, "keyframe": _keyframe_plan, "multishot": _multishot_plan}[mode]
    finish_for = {"insert": _insert_finish, "keyframe": _keyframe_finish,
                  "multishot": _multishot_finish}[mode]
    plans: list[tuple[int, dict]] = []
    for index, item in runnable:
        try:
            plan = plan_for(item, job, ref=shared_ref)
        except SystemExit as exc:
            outcomes[index] = str(exc)
            continue
        except Exception as exc:
            outcomes[index] = _batch_error_note(exc)
            continue
        plan["batch"] = True
        plans.append((index, plan))

    print(f"[mint_video:batch] {len(specs)} × {mode}: {len(plans)} to run together"
          + (f", {len(specs) - len(plans)} refused before any spend" if len(plans) < len(specs) else ""),
          flush=True)

    def deliver(index: int, plan: dict, elapsed: float) -> None:
        try:
            finish_for(plan, job, elapsed)
            outcomes[index] = None
        except Exception as exc:
            outcomes[index] = _batch_error_note(exc)

    if mode == "multishot":
        def one(entry: tuple[int, dict]) -> None:
            index, plan = entry
            t0 = time.perf_counter()
            try:
                _gateway_generate(mode, plan["input"], job, plan["out_path"], quality=plan["quality"])
            except SystemExit as exc:
                outcomes[index] = str(exc)
                return
            except Exception as exc:
                outcomes[index] = _batch_error_note(exc)
                return
            deliver(index, plan, time.perf_counter() - t0)

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=max(1, args.batch_parallel)) as ex:
            list(ex.map(one, plans))
    elif plans:
        route = _route_label(mode, plans[0][1]["quality"], via_gateway=True)
        print(f"[mint_video:batch] gateway route: {route}; submitting as paid capacity allows",
              flush=True)
        items = [{"mode": mode, "params": plan["input"], "quality": plan["quality"],
                  "seconds": plan["input"]["duration"], "_delivery": [plan["out_path"]]}
                 for _, plan in plans]

        def progress(position: int, res: dict) -> None:
            # videoclaw-app#969: say how each item ended as soon as it does.
            label = labels[plans[position][0]]
            line = ("✓ generated; saved when the batch ends" if res.get("status") == "succeeded"
                    else f"✗ {_batch_result_note(res)}")
            print(f"[mint_video:batch] {label}: {line}", flush=True)

        # ONE deadline for the whole command, before the app's kill
        # (videoclaw-backend#316, #278 review): a queued clip the time left
        # cannot cover is never POSTed (not started, nothing charged), and a
        # clip still running at the deadline is handed to background recovery.
        results = gateway.run_many(
            "mint_video", items, job=job, on_result=progress,
            timeout_s=APP_PAID_GENERATION_CEIL_S, deadline=COMMAND_DEADLINE,
            submit_reserve_s=GENERATION_SUBMIT_RESERVE_S)
        for (index, plan), res in zip(plans, results):
            assets = res.get("assets") or []
            if res.get("status") != "succeeded" or not assets:
                outcomes[index] = _batch_result_note(res)
                continue
            try:
                gateway.download_asset(assets[0], plan["out_path"])
            except Exception as exc:
                outcomes[index] = _batch_error_note(exc)
                continue
            deliver(index, plan, float(res.get("_elapsed_s") or 0.0))

    losers = [(labels[i], outcomes.get(i, "not run")) for i in range(len(specs))
              if outcomes.get(i, "not run") is not None]
    for i, label in enumerate(labels):
        err = outcomes.get(i, "not run")
        print(f"  {'✗' if err else '✓'} {label}" + (f": {err}" if err else ""))
    if losers:
        print(f"[mint_video:batch] {len(losers)}/{len(specs)} FAILED — survivors are on disk; "
              "retry only the items marked safe to retry", file=sys.stderr)
        return 1
    print(f"[mint_video:batch] all {len(specs)} done → {job / 'clips'}/")
    return 0


def run_batch(args, job: Path) -> int:
    default_quality = _effective_quality(args, args.mode)
    if args.mode not in BATCH_MODES:
        sys.exit(f"--batch supports --mode {', '.join(BATCH_MODES)}")
    if not gateway.enabled():
        sys.exit("--batch needs VIDEOCLAW_API_KEY (gateway mode)")
    try:
        specs = json.loads(_bound_input(args, args.batch).read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"--batch: cannot read specs: {e}")
    if not isinstance(specs, list) or not specs:
        sys.exit("--batch must be a non-empty JSON list")
    if args.mode in GENERATION_BATCH_MODES:
        return _run_generation_batch(args, job, specs)

    out_dir = job / {"edit": "edits", "reenact": "reenact",
                     "genjutsu": "genjutsu"}[args.mode]
    out_dir.mkdir(parents=True, exist_ok=True)

    # A shared --swap-image lets reenact items omit their own swap_image, and a
    # shared --prompt lets edit items omit their own prompt. Their PRESENCE gates
    # the schema; a swap-less/prompt-less item with neither fails PER-ITEM below,
    # never a fleet-wide sys.exit (videoclaw#74 round-8 E-3 / round-9 E-1).
    has_shared_swap = bool(args.swap_image)
    has_shared_prompt = bool(args.prompt)
    # genjutsu: shared --reference images are the default cast for items that
    # name no `references` of their own.
    has_shared_references = args.mode == "genjutsu" and bool(args.reference)
    if (args.mode == "genjutsu" and args.prompt
            and len(args.prompt) > GENJUTSU_MAX_PROMPT_CHARS):
        sys.exit(f"genjutsu --prompt must be at most {GENJUTSU_MAX_PROMPT_CHARS} characters")

    # Materialize the COMPLETE fingerprint-bound input set before any worker can upload
    # or submit provider work. Binding one item lazily inside `_one` lets an
    # earlier item spend successfully before a changed later item is detected;
    # it also lets one output overwrite another item's not-yet-snapshotted
    # input. Prepared specs contain private immutable paths only, so workspace
    # changes after this boundary cannot alter this invocation.
    shared_swap_path = (
        _bound_input(args, args.swap_image) if has_shared_swap else None
    )
    # A broken shared cast fails only the items that rely on it (unbound CLI
    # runs); under an immutable binding any refused input stops the fleet.
    bound_run = getattr(args, "_input_binding", None) is not None
    shared_references = None
    shared_references_error: str | None = None
    if has_shared_references:
        try:
            shared_references = _bind_genjutsu_references(args, list(args.reference))
        except SystemExit as exc:
            if bound_run:
                raise
            shared_references_error = str(exc)
    prepared_specs: list[tuple[object, str | None]] = []
    for spec in specs:
        schema_err = batch_item_error(
            args.mode, spec, has_shared_swap=has_shared_swap,
            has_shared_prompt=has_shared_prompt,
            has_shared_references=has_shared_references,
            resolve_path=lambda value: resolve_job_input_path(value, job))
        if schema_err is not None:
            if args.mode == "genjutsu" and bound_run:
                # A bound genjutsu fleet was priced as fully runnable, so an
                # item that no longer validates means an input changed after
                # the plan: stop before any item spends.
                raise SystemExit(f"batch input changed after plan binding: {schema_err}")
            # Preserve the established per-item schema failure semantics. A
            # plan-grade batch cannot reach execution with this shape, but a
            # direct CLI run should still report the bad row beside survivors.
            prepared_specs.append((spec, schema_err))
            continue
        prepared = dict(spec)
        if args.mode == "edit":
            prepared["_bound_video"] = _bound_input(
                args, resolve_job_input_path(spec["video"], job)
            )
        elif args.mode == "genjutsu":
            try:
                prepared["_source_video"] = resolve_job_input_path(spec["video"], job)
                prepared["_bound_video"] = _bound_input(args, prepared["_source_video"])
                if spec.get("references"):
                    prepared["_bound_references"] = _bind_genjutsu_references(
                        args, spec["references"], job=job)
                elif shared_references_error is not None:
                    raise SystemExit(shared_references_error)
                else:
                    prepared["_bound_references"] = shared_references
                prompt_error = _genjutsu_prompt_error(
                    spec.get("prompt") or args.prompt, len(prepared["_bound_references"]))
                if prompt_error:
                    raise SystemExit(f"[{spec.get('name') or '?'}] {prompt_error}")
            except SystemExit as exc:
                if bound_run:
                    raise
                prepared_specs.append((spec, str(exc)))
                continue
        else:
            prepared["_bound_driver_video"] = _bound_input(
                args, resolve_job_input_path(spec["driver_video"], job)
            )
            if spec.get("swap_image"):
                prepared["_bound_swap_image"] = _bound_input(
                    args, resolve_job_input_path(spec["swap_image"], job)
                )
        prepared_specs.append((prepared, None))

    # Upload the shared swap LAZILY (once) — inside the per-item boundary, so a
    # MISSING shared --swap-image raises only for the items that actually need it
    # (its upload happens under _one's try), not an uncaught FileNotFoundError at
    # fleet setup that killed independently-swapped siblings too (round-9 E-2).
    _shared_swap_cache: dict = {}
    # Every genjutsu input in the fleet (clips and local images). No item may
    # write its output onto one of them: with --batch-parallel 1 an earlier
    # item would otherwise overwrite a later item's source before it uploads.
    # Collected from EVERY item, including ones that failed validation: a
    # failed item's source is still the user's footage.
    protected_inputs: set[Path] = set()
    if args.mode == "genjutsu":
        def _protect(value: object) -> None:
            if isinstance(value, str) and value.strip() and "://" not in value:
                try:
                    protected_inputs.add(resolve_job_input_path(value, job).resolve())
                except (OSError, ValueError):
                    pass
        for spec in specs:
            if isinstance(spec, dict):
                _protect(spec.get("video"))
                refs = spec.get("references")
                for ref in refs if isinstance(refs, list) else []:
                    _protect(ref)
        for ref in args.reference or []:
            _protect(ref)

    # One upload per distinct local reference image across the whole fleet.
    _reference_upload_cache: dict = {}
    _reference_upload_lock = threading.Lock()

    def _reference_refs(bound: list) -> list[str]:
        with _reference_upload_lock:
            return _upload_genjutsu_references(bound, _reference_upload_cache)

    def _shared_swap_ref():
        if "ref" not in _shared_swap_cache:
            # The path was verified before worker/provider startup above.
            _shared_swap_cache["ref"] = gateway.upload(shared_swap_path)
        return _shared_swap_cache["ref"]

    in_flight: set[str] = set()
    terminal_accepted: set[str] = set()
    declined: set[str] = set()  # refused before sending: the model declined this exact request
    # videoclaw#294: names an earlier paid request still owns. Nothing was
    # charged for them now, but re-running the same name is refused again.
    on_its_way: set[str] = set()
    rename: set[str] = set()

    def _one(prepared: tuple[object, str | None]) -> tuple[str, str | None]:
        spec, schema_err = prepared
        # Validate the item's SCHEMA before touching any field (shared with the
        # estimator, #74 round-5/8/9). A non-dict item, a non-string `output`, a
        # reenact item with no swap identity, or an edit item with no prompt
        # would otherwise crash `Path(...)`/abort the fleet; each is a PER-ITEM
        # failure here, exactly the shape cost.py prices as batch_partial.
        if schema_err is not None:
            nm = (spec.get("name") if isinstance(spec, dict) else None) or "?"
            return nm, schema_err
        assert isinstance(spec, dict)  # narrowed by batch_item_error above
        name = spec.get("name") or Path(spec.get("video")
                                        or spec.get("driver_video") or "?").stem
        if time.time() >= COMMAND_DEADLINE:
            # A paid submit now would be handed straight to background
            # recovery, or killed with the command. Nothing was sent: rerunnable.
            return name, "not started: this command's time was nearly up"
        try:
            out_path = (
                resolve_job_output_path(spec["output"], job)
                if spec.get("output")
                else out_dir / f"{name}.mp4"
            )
            quality = spec.get("quality", default_quality)
            try:
                _validate_quality(args.mode, quality)
            except SystemExit as e:
                raise ValueError(str(e)) from e
            if args.mode == "edit":
                src = spec["_bound_video"]
                dur = _guard_short_input(src, f"[{name}] video",
                                         args.allow_short)
                prompt = spec.get("prompt") or args.prompt
                if not prompt:
                    raise ValueError("no prompt (item or --prompt)")
                if "keep" not in prompt.lower():
                    prompt = f"{prompt} Keep everything else the same."
                res = gateway.run("mint_video", mode="edit",
                                  references=[str(src)],
                                  params={"prompt": prompt},
                                  quality=quality, seconds=dur,
                                  job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
                                  deadline=COMMAND_DEADLINE, _delivery=[out_path])
            elif args.mode == "genjutsu":
                src = spec["_bound_video"]
                if out_path.resolve() in protected_inputs:
                    raise ValueError("output must not overwrite a source clip or "
                                     "reference image of this batch")
                dur = _guard_genjutsu_input(src, f"[{name}] video",
                                            args.allow_short)
                prompt = spec.get("prompt") or args.prompt
                with tempfile.TemporaryDirectory(prefix="vc-genjutsu-source-") as scratch:
                    upload_path, dur = _genjutsu_provider_source(
                        src, dur, Path(scratch), f"[{name}] video")
                    params = _genjutsu_params(
                        gateway.upload(upload_path),
                        _reference_refs(spec["_bound_references"]),
                        args.resolution, prompt)
                local_source = _genjutsu_local_source(job, spec["_source_video"], src)
                try:
                    res = gateway.run("mint_video", mode="genjutsu", params=params,
                                      quality=quality, seconds=dur,
                                      job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
                                      deadline=COMMAND_DEADLINE, _delivery=[out_path],
                                      _local_source=local_source)
                except GatewayAcceptedError as exc:
                    refusal = _genjutsu_refusal(exc)
                    if refusal is None:
                        raise
                    return name, refusal
            else:
                drv = spec["_bound_driver_video"]
                dur = _guard_short_input(drv, f"[{name}] driver_video",
                                         args.allow_short)
                swap = (gateway.upload(spec["_bound_swap_image"])
                        if spec.get("swap_image") else _shared_swap_ref())
                prompt = spec.get("prompt") or args.prompt or REENACT_DEFAULT_PROMPT
                res = gateway.run(
                    "mint_video", mode="reenact",
                    params={"prompt": prompt,
                            "reference_images": [swap],
                            "reference_video": gateway.upload(drv),
                            "aspect_ratio": args.aspect_ratio,
                            "duration": dur},
                    quality=quality, seconds=dur,
                    job=job, timeout_s=APP_PAID_GENERATION_CEIL_S,
                    deadline=COMMAND_DEADLINE, _delivery=[out_path])
            assets = res.get("assets") or []
            if not assets:
                raise RuntimeError(f"no assets (status={res.get('status')})")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            if args.mode == "genjutsu":
                # Strip generated audio, conform to the source clock, keep
                # the source clip's own audio; stage before publishing.
                _deliver_genjutsu(res, out_path, spec["_bound_video"], dur)
            else:
                gateway.download_asset(assets[0], out_path)
                out_dur = _probe_duration(out_path)
                if dur and abs(out_dur - dur) / dur > 0.005:
                    _conform_duration(out_path, out_dur, dur)
            log_event(job, tool="mint_video.py", event="video_generated",
                      prompt=prompt or "", duration_seconds=0,
                      extra={"usage_role": args.mode, "mode": args.mode,
                             "batch": True, "quality": quality,
                             **({"resolution": args.resolution,
                                 "source_seconds": dur}
                                if args.mode == "genjutsu" else {}),
                             "model": _route_label(
                                 args.mode, quality, via_gateway=True),
                             "output": str(out_path)})
            return name, None
        except GatewayAcceptedError as e:
            # Accepted paid work is never a blind retry. Keep unresolved work
            # separate from terminal accepted failures: only the former belongs
            # to background recovery.
            result = getattr(e, "result", None)
            status = result.get("status") if isinstance(result, dict) else None
            if status in {"failed", "canceled", "cancelled", "timeout"}:
                terminal_accepted.add(name)
            else:
                in_flight.add(name)
            return name, str(e)
        except GatewayRepeatRefusedError as e:
            declined.add(name)
            return name, str(e)
        except GatewayDestinationClaimedError as e:
            (rename if e.blocked else on_its_way).add(name)
            return name, _batch_error_note(e)
        except SystemExit as e:          # _guard_short_input inside a thread
            return name, str(e)
        except Exception as e:
            return name, _batch_error_note(e)

    from concurrent.futures import ThreadPoolExecutor, as_completed
    print(f"[mint_video:batch] {len(specs)} × {args.mode}, "
          f"{args.batch_parallel}-way parallel, default quality={default_quality}",
          flush=True)
    with ThreadPoolExecutor(max_workers=max(1, args.batch_parallel)) as ex:
        futures = [ex.submit(_one, prepared) for prepared in prepared_specs]
        # Say how each item ended as soon as it does (videoclaw-app#969): a
        # refusal after 75s must not stay hidden until the slowest clip ends.
        # flush: the host reads a pipe, where print() is block-buffered.
        for finished, future in enumerate(as_completed(futures), start=1):
            n, err = future.result()
            print(f"[mint_video:batch] {finished}/{len(specs)} finished: "
                  f"{'✗' if err else '✓'} {n}" + (f": {err}" if err else ""), flush=True)
        outcomes = [future.result() for future in futures]
    losers = [(n, err) for n, err in outcomes if err]
    print("[mint_video:batch] summary:")
    for n, err in outcomes:
        print(f"  {'✗' if err else '✓'} {n}" + (f": {err}" if err else ""))
    if losers:
        owned = on_its_way | rename
        failed = [n for n, _ in losers
                  if n not in in_flight and n not in terminal_accepted
                  and n not in owned and n not in declined]
        if failed:
            print(f"[mint_video:batch] {len(failed)}/{len(specs)} FAILED — retry "
                  f"just those (survivors are on disk)")
        if terminal_accepted:
            print(f"[mint_video:batch] {len(terminal_accepted)}/{len(specs)} terminal "
                  f"accepted failure(s) — do NOT retry unchanged "
                  f"({', '.join(sorted(terminal_accepted))})")
        if in_flight:
            print(f"[mint_video:batch] {len(in_flight)}/{len(specs)} still in "
                  f"progress — background recovery owns them; do NOT retry "
                  f"({', '.join(sorted(in_flight))})")
        if declined:
            print(f"[mint_video:batch] {len(declined)}/{len(specs)} not sent — the model "
                  f"already declined these exact requests; change the shot, prompt or "
                  f"reference, or pick a different model ({', '.join(sorted(declined))})")
        if on_its_way:
            print(f"[mint_video:batch] {len(on_its_way)}/{len(specs)} already on their "
                  f"way from an earlier paid request — nothing was charged now; do NOT "
                  f"re-run them, wait for the files ({', '.join(sorted(on_its_way))})")
        if rename:
            print(f"[mint_video:batch] {len(rename)}/{len(specs)} need a new name — an "
                  f"earlier paid result can't be saved over the file already there; "
                  f"nothing was charged now; do NOT re-run them unchanged "
                  f"({', '.join(sorted(rename))})")
        return 1
    print(f"[mint_video:batch] all {len(specs)} done → {out_dir}/")
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════════

GENJUTSU_PROMPT_HELP = f"""\
genjutsu --prompt (required; every person swap, one person or several, uses
genjutsu the same way): ask the user who becomes whom first. Map every
replaced character, by screen position, clothing or role, to its Image N
(Image 1 = the first --reference). Then state both lists: FROM THE VIDEO keep
motion, timing, camera path, cuts, background, setting and lighting; FROM THE
REFERENCES take only each character's identity: face, hair, outfit and body.
Source clip: 4-30 s (a shorter one needs a longer cut, or --allow-short).
Resolution: the 720p default; 1080p only when the user asks.

{textwrap.fill(GENJUTSU_TEMPLATES_TEXT, 79, break_on_hyphens=False, break_long_words=False)}
"""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="mint_video — canonical video primitive. --mode picks the engine.",
        epilog=GENJUTSU_PROMPT_HELP,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        # allow_abbrev=False so an abbreviation like `--mo edit` / `--vid x`
        # ERRORS here instead of silently resolving to --mode/--video — that
        # divergence let the app price one thing and the executor bill another
        # (videoclaw#74 round-7 finding 1). The canonical CLI uses full flags.
        allow_abbrev=False,
    )
    add_job_arg(p)
    p.add_argument("--mode", required=True,
                   choices=["insert", "keyframe", "multishot", "reenact", "edit",
                            "genjutsu"],
                   help="The generation shape. Picks the engine + recipe. Logged as usage_role. "
                        "multishot is unavailable (videoclaw#317) and exits before any spend.")
    p.add_argument("--name", help="Output slot name → mode-specific subdir under the job "
                                  "(generated video→clips/, reenact→reenact/, edit→edits/, "
                                  "genjutsu→genjutsu/). "
                                  "Advanced calls may use --output instead.")
    p.add_argument("--output", help="Explicit output mp4 path (advanced use). "
                                    "Overrides --name slotting.")
    p.add_argument("--prompt", help="Generation prompt. Required for insert/keyframe/edit "
                                    "(edit: ONE simple instruction per call) and genjutsu "
                                    "(≤10,000 chars): map each replaced character, named by "
                                    "position or clothing, to its Image N, say what to "
                                    "keep from the video and what to take from the "
                                    "references (template below). "
                                    "Optional for multishot/reenact (sensible defaults).")

    # Reference inputs (Seedance / Gemini Omni reference images).
    p.add_argument("--reference", action="append", default=[],
                   help="Conditioning image (local path or URL). Repeatable. "
                        "insert→Seedance reference_images ([Image1]..). "
                        "multishot→ordered references (<<<image_1>>>.., max 6, upload order). "
                        "genjutsu→1-8 ordered images (Image 1..N: characters, outfits, "
                        "places; on --batch, the default cast for items without "
                        "their own `references`). "
                        "Local files auto-uploaded.")

    # Keyframe inputs (Seedance keyframe mode).
    p.add_argument("--first-frame", help="keyframe: first frame (Seedance `image`). "
                                         "Mutually exclusive with --reference.")
    p.add_argument("--last-frame", help="keyframe: last frame (Seedance `last_frame_image`). "
                                        "Interpolated from --first-frame.")
    p.add_argument("--video", action="append", default=[],
                   help="keyframe: extra reference video path/URL (Seedance reference_videos). "
                        "Repeatable. edit: THE clip to edit (exactly one). "
                        "genjutsu: THE local 4-30s clip to recast (exactly one; billed "
                        "per whole second of it).")
    p.add_argument("--audio-ref", action="append", default=[],
                   help="keyframe: reference audio path/URL (Seedance reference_audios). Repeatable.")

    # Multishot inputs (Gemini Omni gateway).
    p.add_argument("--multishot-file", help="multishot: path to the shots JSON "
                                            "([{prompt,duration}, ...], cite refs <<<image_N>>>).")
    p.add_argument("--multishot", help="multishot: inline shots JSON string "
                                       "(alternative to --multishot-file).")
    p.add_argument("--start-image", help="multishot: keyframe used as the first reference image "
                                         "(prepended to --reference).")

    # Reenact inputs (Kling motion control: a still performs a driver's motion).
    p.add_argument("--swap-image", help="reenact: the still that performs (<<<image_1>>>). "
                                        "Not for person swaps: use --mode genjutsu.")
    p.add_argument("--driver-video", help="reenact: the driver motion video, 3-10s (<<<video_1>>>).")
    p.add_argument("--eye-check-method", default="opencv", choices=["opencv", "gemini"],
                   help="reenact: first-frame eye-open detector. opencv=offline Haar (default, no API); "
                        "gemini=semantic image call (needs OPENROUTER_API_KEY, higher precision).")
    p.add_argument("--strict", action="store_true",
                   help="reenact: exit 1 if the driver's first frame has closed eyes (default: warn).")
    p.add_argument("--skip-eye-check", action="store_true",
                   help="reenact: skip the first-frame eye-open pre-flight entirely.")

    # Shared generation params.
    p.add_argument("--duration", type=float, default=None,
                   help="Target seconds. insert default 4 (standard/draft max 15; "
                        "premium max 30). keyframe default 5. "
                        "reenact default 4 (~=driver length). multishot: auto-computed from shot sum "
                        "(an explicit value must equal the sum).")
    p.add_argument("--aspect-ratio", default="9:16",
                   help="9:16 (default), 16:9, 1:1, etc.")
    p.add_argument("--resolution", choices=["480p", "720p", "1080p"], default="720p",
                   help="insert/keyframe Seedance output resolution (default 720p). "
                        "Standard supports 720p or 1080p; draft/fast is always 720p; "
                        "insert premium supports 480p or 720p; "
                        "genjutsu: always the 720p default (1080p only when the user "
                        "asks), the price tier; "
                        "multishot/reenact are provider-controlled.")
    p.add_argument("--seed", type=int, default=None,
                   help="Reproducibility. insert→random if unset; keyframe→0 if unset.")
    p.add_argument("--audio", action="store_true",
                   help="insert/keyframe: generate_audio=True (Seedance native SFX). "
                        "Default FALSE so B-roll plays under avatar audio. "
                        "multishot: accepted for compatibility; native audio is already requested.")
    p.add_argument("--no-audio", action="store_true",
                   help="multishot: strip any generated audio from the downloaded clip.")
    p.add_argument("--quality", choices=QUALITY_CHOICES, default=None,
                   help="Gateway routing tier: standard (default), draft, or premium. "
                        "insert: standard|draft|premium (premium→Seedance 2.5); "
                        "keyframe: standard|draft (draft→Seedance fast); "
                        "multishot/reenact/edit/genjutsu: standard only.")
    p.add_argument("--fast", action="store_true",
                   help="Legacy alias for --quality draft (kept for compatibility).")

    # Batch: one process runs a whole fleet of one mode together.
    p.add_argument("--batch", help="JSON list of items, all run together in one call. "
                                   "insert: {name, prompt?, reference?, duration?}; keyframe: "
                                   "{name, prompt?, first_frame?, last_frame?, duration?}; "
                                   "edit: {name, video, prompt?}; reenact: {name, driver_video, "
                                   "swap_image?, prompt?}; genjutsu: {name, video, "
                                   "references?, prompt} (prompt, or a shared --prompt, is "
                                   "required; one --resolution for the whole batch). Optional "
                                   "per-item 'output' and 'quality' (insert/keyframe also "
                                   "'resolution', 'aspect_ratio', 'audio', 'seed'). CLI flags "
                                   "are the defaults. Per-item failures don't kill the batch.")
    p.add_argument("--batch-parallel", type=int, default=4,
                   help="edit/reenact/genjutsu batch: concurrent generations (default 4). "
                        "insert/keyframe batches follow the gateway's paid capacity.")
    p.add_argument("--allow-short", action="store_true",
                   help="edit/reenact: send a sub-3s video input anyway (the engine "
                        "usually garbles them — prefer cutting a padded window). "
                        "genjutsu: send a sub-4s source anyway (Higgsfield documents "
                        "a 4s minimum).")
    return p


def _normalize_job_paths(args, job: Path) -> None:
    """Bind every local media argv to the job/workspace before provider work.

    Tool code may be launched through `uv --project`, an absolute interpreter,
    or an arbitrary shell wrapper. None of those implementation details may
    change where a user-data path resolves.
    """
    def local_input(value: str | None) -> str | None:
        if not value or value.startswith(("http://", "https://", "data:")):
            return value
        return str(resolve_job_input_path(value, job))

    for attr in ("reference", "video", "audio_ref"):
        values = getattr(args, attr, None)
        if values:
            setattr(args, attr, [local_input(value) for value in values])
    for attr in (
        "first_frame",
        "last_frame",
        "start_image",
        "swap_image",
        "driver_video",
        "multishot_file",
        "batch",
    ):
        value = getattr(args, attr, None)
        if value:
            setattr(args, attr, local_input(value))
    if args.output:
        try:
            args.output = str(resolve_job_output_path(args.output, job))
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc


def main() -> int:
    args = build_parser().parse_args()
    _refuse_unavailable_mode(args.mode)

    if not gateway.enabled() and args.mode in ("multishot", "reenact", "genjutsu"):
        sys.exit(
            f"ERROR: --mode {args.mode} requires VIDEOCLAW_API_KEY "
            "(gateway route)")

    # Raw Seedance compatibility remains for insert/keyframe only.
    if (not gateway.enabled() and args.mode != "edit"
            and not os.environ.get("REPLICATE_API_TOKEN")):
        sys.exit("ERROR: REPLICATE_API_TOKEN not set in .env")

    job = resolve_job_dir(args.job)
    _normalize_job_paths(args, job)
    binding = ImmutableInputBinding.from_environment(args.mode)
    args._input_binding = binding

    # Per-mode duration defaults (argparse default is None so we can branch per
    # mode). edit has none: output length tracks the input clip (probed).
    if args.duration is None and args.mode not in ("edit", "reenact", "genjutsu"):
        args.duration = {"insert": 4.0, "keyframe": 5.0, "multishot": 5.0}[args.mode]

    try:
        if args.batch:
            return run_batch(args, job)
        if args.mode == "insert":
            return run_insert(args, job)
        if args.mode == "keyframe":
            return run_keyframe(args, job)
        if args.mode == "multishot":
            return run_multishot(args, job)
        if args.mode == "reenact":
            return run_reenact(args, job)
        if args.mode == "edit":
            return run_edit(args, job)
        if args.mode == "genjutsu":
            return run_genjutsu(args, job)
        sys.exit(f"unknown mode: {args.mode}")
    finally:
        if binding is not None:
            binding.close()


if __name__ == "__main__":
    sys.exit(exit_on_repeat_refusal(main))
