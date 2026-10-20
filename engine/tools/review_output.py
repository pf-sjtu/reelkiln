"""
review_output — post-render editorial review, role-aware (canonical primitive).

ONE self-contained tool, parameterized by `--mode`, that answers the question
"is the finished render GOOD (on-role, slop-free, brand-correct)?" — distinct
from `verify_output` which answers "is it BROKEN?". Editorial/style findings
remain advisory. Exact delivery defects (clipped/obscured subjects, required
captions missing or over faces, and platform red-zone collisions) are blocking.

  - mode=full   canonical final-QA surface. Reviews every beat in the finished
                render against its declared `usage_role` (logged by mint_image
                --role / mint_video --mode at generation time, read from the
                job's run.log.jsonl). Produces a per-beat verdict table
                (declared_role / observed / verdict / AI-tell flags), plus:
                  · a Gemini final_review pass on a same-framing, exact-final-
                    bound perceptual transport copy WITH audio,
                  · integrated technical audio evidence from that same pass,
                  · an on-screen-text audit against expected brand strings,
                  · a caption-vs-script word-fidelity check,
                  · exact hashed frame evidence for every brand-text flag.
                Writes a content-bound `qa_evidence` record. `qa_gate --mark`
                refuses to stamp a receipt unless this integrated pass completed
                for the current final.mp4 without transport/parse/audio/
                verification gaps.

  - mode=beat   single-beat spot check (by index or --ts-start/--ts-end). Fast
                re-check after a targeted regen; same backend on the beat window.

ABSORBS (these backend files are DELETED — their logic is inlined here, NOT
imported):
  - gemini_video.py  — the video "eyes" layer: yt-dlp download, base64 data-URL
                       encoding, OpenRouter/Gemini multimodal transport, prompt
                       template loading + frontmatter parsing, JSON fence
                       stripping, final_review mode. Model id preserved verbatim:
                       "~google/gemini-pro-latest".
  - score.py (input_audio block) — the Gemini perceptual-audio audit: ffmpeg
                       audio extract, base64 mp3, {"type":"input_audio"} message,
                       response_format=json_object. Model id preserved verbatim:
                       "google/gemini-2.5-pro".

HARD CONTRACTS (memory-mandated):
  - Gemini is EYES, NOT TASTE: mechanical observations only; any quality
    score / verdict Gemini emits is STRIPPED before surfacing and never drives
    a ship/no-ship call (feedback_gemini_no_taste.md). The role-judge (this
    tool's own logic, NOT Gemini's score) does the editorial mapping.
  - `--mode` is REQUIRED and logged as `usage_role`.
  - `--job` is REQUIRED (feedback_always_pass_job.md). No .current_job fallback.
  - The command exits 0 after recording a terminal QA outcome. `qa_gate --mark`
    is the blocker: it accepts only a current `PASS` record. Per-beat style and
    editorial labels remain advisory.

SELF-CONTAINED: this file does NOT import gemini_video.py or score.py (both
deleted). It imports only the surviving low-level helpers: _paths.py,
_ffmpeg.py, job.py, log.py.

Usage:
  uv run python tools/review_output.py --job <job> --mode full [--video <mp4>]
  uv run python tools/review_output.py --job <job> --mode beat --beat <n>
  uv run python tools/review_output.py --job <job> --mode beat --ts-start 12 --ts-end 16 --declared-role keyframe
  uv run python tools/review_output.py --job <job> --mode full --brand-strings "onpurpose.me,On Purpose"
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from array import array
from fractions import Fraction
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from openai import OpenAI

# tools/ on sys.path so sibling helper modules resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# --- Surviving low-level helpers (NOT absorbed tools) ---
from _paths import ENV_PATH  # noqa: E402
from _ffmpeg import ffprobe_duration  # noqa: E402
from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import (  # noqa: E402  # dual mode: VIDEOCLAW_API_KEY set → gateway routes the Gemini calls
    HARNESS_CONTEXT_DOCS,
    HARNESS_MAX_EDITS,
    HARNESS_REVIEW_MAX_OUTPUT_TOKENS,
    harness_context_doc_ok,
    harness_edit_ok,
    GatewayError,
    GatewayTransientError,
    gateway,
)
from taste_contract import (  # noqa: E402
    RENDER_MANIFEST_SCHEMA,
    TasteContractError,
    canonical_sha256,
    capture_production_observations,
    run_qa as run_taste_qa,
)
from _render_completion import SCRATCH_ENV, _clone, atomic_write_text  # noqa: E402
from _serious_findings import (  # noqa: E402
    declares_loop, intent_path, is_pinned, read_events, required_narration,
)
from delivery_safety import (  # noqa: E402
    CONTENT_FAIL as DELIVERY_CONTENT_FAIL,
    PASS as DELIVERY_PASS,
    QA_UNAVAILABLE as DELIVERY_QA_UNAVAILABLE,
    run as run_delivery_safety,
)
from synth_voice import selected_tts_chunks  # noqa: E402

# The end-of-render review child never discovers credentials from .env files
# (a parent directory's .env once supplied a key that billed a review); it
# uses only the environment the render handed it.
if os.environ.get("VIDEOCLAW_RENDER_REVIEW_CHILD") != "1":
    load_dotenv(ENV_PATH)
    load_dotenv()  # also pick up CWD .env for ad-hoc runs

TOOL_NAME = "review_output.py"
QA_EVIDENCE_SCHEMA = "videoclaw.final-qa/v5"
QA_MODEL_CACHE_SCHEMA = "videoclaw.qa-model-cache/v2"
PERCEPTUAL_TRANSPORT_SCHEMA = "videoclaw.perceptual-transport/v1"
PERCEPTUAL_PROXY_MAX_BYTES = 18 * 1024 * 1024
PERCEPTUAL_PROXY_MAX_VIDEO_BITRATE = 1_200_000
PERCEPTUAL_PROXY_MIN_VIDEO_BITRATE = 75_000
PERCEPTUAL_PROXY_AUDIO_BITRATE = 96_000

# ---------------------------------------------------------------------------
# Model ids — preserved VERBATIM from the absorbed backends so this tool
# produces identical results to gemini_video.py + score.py.
# ---------------------------------------------------------------------------
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# gemini_video.py:46 — the video "eyes" model (note the leading "~", OpenRouter
# model-routing prefix; do NOT strip it).
GEMINI_VIDEO_MODEL = "~google/gemini-pro-latest"

# score.py:105 — the perceptual-audio model.
GEMINI_AUDIO_MODEL = "google/gemini-2.5-pro"


def _client() -> OpenAI:
    """OpenRouter-backed OpenAI client (verbatim transport from both backends)."""
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )


# Keys carrying Gemini's taste/quality verdicts. Stripped before surfacing —
# Gemini is EYES, NOT TASTE (feedback_gemini_no_taste.md).
_TASTE_KEYS = {
    "score", "scores", "quality_score", "rating", "ratings", "verdict",
    "verdicts", "grade", "overall_score", "recommendation", "recommendations",
    "is_good", "good", "should_post", "viral_score", "virality_score",
    "quality", "quality_rating", "stars", "judgement", "judgment", "opinion",
    "ship", "publishability", "authority", "energy", "polish",
}


def strip_taste(obj):
    """Recursively drop Gemini taste/quality verdict keys."""
    if isinstance(obj, dict):
        return {k: strip_taste(v) for k, v in obj.items()
                if k.lower() not in _TASTE_KEYS and k.lower() != "source_verified"}
    if isinstance(obj, list):
        return [strip_taste(v) for v in obj]
    return obj


# ===========================================================================
# ABSORBED FROM gemini_video.py — video resolution + multimodal transport.
# Inlined verbatim (the backend file is deleted). Behaviour-identical.
# ===========================================================================

def video_to_data_url(path: Path) -> str:
    """Encode a local video file as a base64 data URL."""
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:video/mp4;base64,{b64}"


def download_video(url: str) -> Path:
    """Download a remote video via yt-dlp. Returns the downloaded path."""
    tmp_dir = Path(tempfile.mkdtemp())
    out_template = str(tmp_dir / "video.%(ext)s")
    print("  Downloading video with yt-dlp...")
    result = subprocess.run(
        [
            "uv", "run", "yt-dlp",
            "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
            "-o", out_template,
            "--no-playlist",
            "--merge-output-format", "mp4",
            url,
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed:\n{result.stderr}\n{result.stdout}")
    files = list(tmp_dir.glob("video.*"))
    if not files:
        raise RuntimeError(f"yt-dlp produced no output in {tmp_dir}")
    out_path = files[0]
    size_mb = out_path.stat().st_size // 1024 // 1024
    print(f"  Downloaded: {out_path.name} ({size_mb}MB)")
    return out_path


def resolve_video_url(url: str) -> tuple[str, Path | None]:
    """Given a URL or local path, return (video_url_for_API, local_path).

    - Local file / file:// → base64 data URL.
    - YouTube → pass the URL through (Gemini reads it directly).
    - Other remote (TikTok/IG) → download with yt-dlp, return base64 data URL.
    """
    if url.startswith("file://"):
        path = Path(url[7:])
        return video_to_data_url(path), path
    if Path(url).exists():
        return video_to_data_url(Path(url)), Path(url)
    if "youtube.com" in url or "youtu.be" in url:
        return url, None
    tmp_path = download_video(url)
    return video_to_data_url(tmp_path), tmp_path


# ---- Prompt template loader (absorbed from gemini_video.py) ----------------

PROMPT_DIR = (Path(__file__).resolve().parent.parent / "skills" / "gemini_prompts").resolve()


class PromptTemplate:
    def __init__(self, name: str, frontmatter: dict, body: str, path: Path):
        self.name = name
        self.frontmatter = frontmatter or {}
        self.body = body
        self.path = path

    @property
    def max_output_tokens(self) -> int:
        try:
            return int(self.frontmatter.get("max_output_tokens", 16384))
        except (TypeError, ValueError):
            return 16384


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Tiny YAML-ish frontmatter parser (verbatim from gemini_video.py)."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 5:]

    fm: dict = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if value == "|":
            block = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i] == ""):
                block.append(lines[i][2:] if lines[i].startswith("  ") else lines[i])
                i += 1
            fm[key] = "\n".join(block).rstrip()
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        fm[key] = value
        i += 1
    return fm, body


def load_template(name: str) -> PromptTemplate:
    """Load a prompt template by name from skills/gemini_prompts/ (verbatim logic:
    injects response_shape into the body when returns==json)."""
    path = PROMPT_DIR / f"{name}.md"
    if not path.exists():
        available = sorted(p.stem for p in PROMPT_DIR.glob("*.md") if p.stem != "README")
        raise FileNotFoundError(
            f"Prompt template not found: {path}\nAvailable: {', '.join(available)}"
        )
    text = path.read_text()
    frontmatter, body = _parse_frontmatter(text)
    body = body.strip()

    shape = str(frontmatter.get("response_shape", "")).strip()
    returns = str(frontmatter.get("returns", "text")).lower()
    if shape and returns == "json":
        injected = (
            "Return ONLY a JSON object matching this exact schema. "
            "Do NOT add or rename fields. Do NOT wrap in markdown fences.\n\n"
            f"```json\n{shape}\n```"
        )
        if "{{response_shape}}" in body:
            body = body.replace("{{response_shape}}", injected)
        else:
            body = body.rstrip() + "\n\n" + injected

    return PromptTemplate(name=name, frontmatter=frontmatter, body=body, path=path)


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*\n(.*?)\n```\s*$", re.DOTALL)


def _strip_json_fences(s: str) -> str:
    s = s.strip()
    m = _JSON_FENCE_RE.match(s)
    return m.group(1).strip() if m else s


def parse_json_lenient(text: str, label: str):
    """Best-effort JSON object parse. Tolerates markdown fences, leading/trailing
    prose, trailing commas, and brace over-capture by trying several extractions
    before giving up (Gemini's three common failure modes)."""
    text = _strip_json_fences(text)

    def _candidates(s: str):
        yield s                                   # whole (already fence-stripped)
        a, b = s.find("{"), s.rfind("}")
        if a != -1 and b > a:
            yield s[a:b + 1]                      # first '{' … last '}'
        for a in [i for i, c in enumerate(s) if c == "{"][:8]:   # brace-match from each '{'
            depth = 0
            in_str = esc = False
            for i in range(a, len(s)):
                c = s[i]
                if in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                elif c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        yield s[a:i + 1]
                        break

    for cand in _candidates(text):
        for variant in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):  # tolerate trailing commas
            try:
                return json.loads(variant, strict=False)   # strict=False: tolerate literal control chars in strings
            except json.JSONDecodeError:
                continue
    raise ValueError(f"[{label}] no parseable JSON in response: {text[:200]}")


def analyse_video(
    url: str,
    prompt: str,
    job: Path,
    mode_label: str,
    max_output_tokens: int = 16384,
) -> str:
    """Send a video to Gemini with a prompt. Returns the text response.

    Inlined verbatim from gemini_video.analyse_video — same OpenRouter transport,
    same multimodal message shape (text + video_url), same logging events.

    DUAL MODE: when VIDEOCLAW_API_KEY is set the call routes through the gateway
    `qa_video` endpoint (local files auto-upload to signed GCS URLs; no base64,
    no model name sent — the gateway routes qa_video itself). When absent, the
    raw OpenRouter path below runs unchanged.

    Inside the end-of-render review child the one video request is the
    house-paid harness request instead, and nothing else is ever sent.
    """
    if harness_child():
        return _harness_analyse_video(url, prompt, job, mode_label, max_output_tokens)
    start = time.perf_counter()

    if gateway.enabled():
        role = "review_full" if mode_label == "final_review" else f"review_{mode_label}"
        # Resolve to something the gateway accepts as a reference: a local path
        # (auto-uploaded) or a pass-through URL. YouTube passes through; other
        # remote URLs (TikTok/IG) are still yt-dlp'd locally first, as before.
        if url.startswith("file://"):
            ref = str(Path(url[7:]))
        elif Path(url).exists():
            ref = str(Path(url))
        elif "youtube.com" in url or "youtu.be" in url:
            ref = url
        else:
            ref = str(download_video(url))
        try:
            res = gateway.run(
                "qa_video", role=role, prompt=prompt,
                references=[ref],
                params={"max_output_tokens": max_output_tokens, "_media": "video"},
                job=job, timeout_s=1800,
            )
            content = res["output"]["text"]
        except Exception as e:
            log_event(
                job, tool=TOOL_NAME, event="gemini_video_call_failed",
                prompt=prompt, duration_seconds=time.perf_counter() - start,
                extra={"gateway": True, "mode": mode_label, "source_url": url,
                       "error": type(e).__name__, "error_message": str(e)[:300]},
            )
            raise
        if content is None:
            raise RuntimeError(f"Null gateway output text. Full: {json.dumps(res)[:500]}")
        log_event(
            job, tool=TOOL_NAME, event="gemini_video_call_completed",
            prompt=prompt, response=content,
            duration_seconds=time.perf_counter() - start,
            extra={"gateway": True, "mode": mode_label, "source_url": url,
                   "gateway_cost_usd": res.get("cost_usd"),
                   "response_chars": len(content)},
        )
        return content

    video_url, _local = resolve_video_url(url)

    client = _client()
    try:
        response = client.chat.completions.create(
            model=GEMINI_VIDEO_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "video_url", "video_url": {"url": video_url}},
                    ],
                }
            ],
            max_tokens=max_output_tokens,
        )
    except Exception as e:
        log_event(
            job, tool=TOOL_NAME, event="gemini_video_call_failed",
            prompt=prompt, duration_seconds=time.perf_counter() - start,
            extra={"model": GEMINI_VIDEO_MODEL, "mode": mode_label,
                   "source_url": url, "error": type(e).__name__,
                   "error_message": str(e)[:300]},
        )
        raise

    if not response.choices:
        raise RuntimeError(f"Empty choices. Full: {response.model_dump()}")
    content = response.choices[0].message.content
    if content is None:
        raise RuntimeError(
            f"Null content. finish_reason={response.choices[0].finish_reason}. "
            f"Full: {response.model_dump()}"
        )

    log_event(
        job, tool=TOOL_NAME, event="gemini_video_call_completed",
        prompt=prompt, response=content,
        duration_seconds=time.perf_counter() - start,
        extra={"model": GEMINI_VIDEO_MODEL, "mode": mode_label, "source_url": url,
               "finish_reason": response.choices[0].finish_reason,
               "response_chars": len(content)},
    )
    return content


def harness_review_context(job: Path) -> dict:
    """The job context the server-owned review template renders as data.

    ``script.json``, ``style_directives.json`` and ``promise.json`` go whole
    when they fit the server's limits and are left out otherwise (the server
    refuses, it never truncates), plus the declared edits.
    """
    context: dict = {}
    for name in HARNESS_CONTEXT_DOCS:
        path = intent_path(job, f"{name}.json")
        if not path.is_file():
            continue
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if harness_context_doc_ok(document):
            context[name] = document
    try:
        edits = [
            {"kind": edit["kind"], "start_sec": edit["start_sec"], "end_sec": edit["end_sec"],
             "reason": str(edit.get("reason") or edit["kind"])[:120]}
            for edit in declared_edits(job)
        ]
    except Exception:
        edits = []
    edits = [edit for edit in edits if harness_edit_ok(edit)][:HARNESS_MAX_EDITS]
    if edits:
        context["declared_edits"] = edits
    return context


def _harness_analyse_video(
    url: str, prompt: str, job: Path, mode_label: str, max_output_tokens: int,
) -> str:
    """The end-of-render review's model call: run and paid by VideoClaw, or not at all.

    The server owns the instruction (template ``final_review/v1``); the engine
    sends the job context as data, never ``prompt``. ``gateway.harness_review``
    sends nothing unless the gateway reports that it runs and pays for the
    review, sends exactly one request, and accepts only a house-billed result.
    Without the gateway the harness makes no model request (a developer's own
    OpenRouter key is never spent implicitly).
    """
    if mode_label != "final_review":
        raise RuntimeError("the end-of-render review makes only its full-video request")
    if not gateway.enabled():
        raise RuntimeError("the end-of-render review runs its model call only through the gateway")
    video = Path(url[7:]) if url.startswith("file://") else Path(url)
    if not video.is_file():
        raise RuntimeError("the end-of-render review reads only a local render")
    context = harness_review_context(job)
    summary = {"context": sorted(context), "declared_edits": len(context.get("declared_edits", []))}
    start = time.perf_counter()
    try:
        content = gateway.harness_review(
            context=context, video=video, job=job,
            max_output_tokens=min(int(max_output_tokens), HARNESS_REVIEW_MAX_OUTPUT_TOKENS),
        )
    except Exception as e:
        log_event(
            job, tool=TOOL_NAME, event="gemini_video_call_failed",
            duration_seconds=time.perf_counter() - start,
            extra={"gateway": True, "harness": True, "mode": mode_label, **summary,
                   "error": type(e).__name__, "error_message": str(e)[:300]},
        )
        raise
    log_event(
        job, tool=TOOL_NAME, event="gemini_video_call_completed",
        response=content, duration_seconds=time.perf_counter() - start,
        extra={"gateway": True, "harness": True, "mode": mode_label, **summary,
               "billing": "house", "response_chars": len(content)},
    )
    return content


# ===========================================================================
# ABSORBED FROM score.py — the Gemini input_audio perceptual audit block.
# Inlined verbatim (the score.py file is deleted). Behaviour-identical.
# ===========================================================================

_AUDIO_AUDIT_PROMPT = """\
You are an audio engineer doing a TECHNICAL review of the audio track of a
finished short-form talking-head video. The voice is the avatar speaking the
script; there may or may not be a music bed underneath.

OBSERVATION ONLY. Do NOT rate the audio. Do NOT say whether it is "good" or
whether you "like" it. Mechanical observations only.

Return JSON with this exact shape (no markdown fences, no extra prose):

{
  "voice_present": true | false,
  "music_bed_present": true | false,
  "vocals_in_bed_detected": true | false,
  "voice_band_collision_flags": ["string: any moment a bed instrument crowds the 250Hz-3kHz speech range, with timestamp", ...],
  "dead_air_flags": ["string: any silence > 1s mid-track, with timestamp range", ...],
  "clipping_or_dropout_flags": ["string: clipping/dropout with timestamp", ...],
  "bg_music_too_loud_flags": ["string: any moment the bed drowns the speech, with timestamp", ...],
  "engineer_flags": ["string: any other technical defect", ...]
}

If a field is empty, return [] or false.
"""


def extract_audio_mp3(video_path: Path) -> Path:
    """Extract the audio track as mp3 for the input_audio Gemini call.
    Mirrors score.py's slice handling (mp3, read as bytes → base64)."""
    audio_path = video_path.with_suffix(".review_audio.mp3")
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-i", str(video_path), "-vn",
         "-acodec", "libmp3lame", "-b:a", "192k",
         str(audio_path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {res.stderr[-400:]}")
    return audio_path


def gemini_audio_audit(audio_path: Path, job: Path) -> dict:
    """Gemini perceptual-audio audit via {"type":"input_audio"}.

    Verbatim transport from score.py:gemini_describe_one — base64 mp3,
    input_audio message part, response_format=json_object, GEMINI_AUDIO_MODEL.

    DUAL MODE: when VIDEOCLAW_API_KEY is set the audio file routes through the
    gateway `qa_video` endpoint as a reference with params {"_media": "audio"}.
    SERVER-TODO: the gateway currently builds video_url/image_url content parts;
    it needs an input_audio branch (base64 mp3 → {"type": "input_audio"}) for
    _media=="audio" or this pass will fail server-side. The model override is
    passed because the raw path pins GEMINI_AUDIO_MODEL for input_audio support
    — only privileged gateway keys get model overrides honored.
    """
    t0 = time.time()
    gateway_cost = None
    try:
        if gateway.enabled():
            res = gateway.run(
                "qa_video", role="review_audio", prompt=_AUDIO_AUDIT_PROMPT,
                references=[str(audio_path)],
                params={"_media": "audio", "model": GEMINI_AUDIO_MODEL},
                job=job, timeout_s=1800,
            )
            raw = res["output"]["text"].strip()
            gateway_cost = res.get("cost_usd")
        else:
            b64 = base64.b64encode(audio_path.read_bytes()).decode("utf-8")
            client = _client()
            resp = client.chat.completions.create(
                model=GEMINI_AUDIO_MODEL,
                messages=[
                    {"role": "user", "content": [
                        {"type": "text", "text": _AUDIO_AUDIT_PROMPT},
                        {"type": "input_audio",
                         "input_audio": {"data": b64, "format": "mp3"}},
                    ]},
                ],
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
        result = json.loads(raw)
        log_event(
            job, tool=TOOL_NAME, event="gemini_audio_audit_done",
            duration_seconds=round(time.time() - t0, 1),
            extra={"model": GEMINI_AUDIO_MODEL,
                   "gateway": gateway.enabled(),
                   "gateway_cost_usd": gateway_cost,
                   "music_bed_present": result.get("music_bed_present"),
                   "vocals_in_bed_detected": result.get("vocals_in_bed_detected")},
        )
        return strip_taste(result)
    except Exception as e:
        log_event(job, tool=TOOL_NAME, event="gemini_audio_audit_error",
                  extra={"model": GEMINI_AUDIO_MODEL, "error": str(e)[:300]})
        return {"error": str(e)}


def _resolve_job_path(job: Path, value: object) -> Path | None:
    """Resolve a path recorded by a tool/config without guessing its existence."""
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value)
    if path.is_absolute():
        return path
    job_relative = job / path
    # Tool metadata sometimes records a repo-relative `jobs/<id>/...` path and
    # sometimes a job-relative `audio/...` path. Prefer the one that exists.
    return path if path.exists() and not job_relative.exists() else job_relative


def _resolve_legacy_bed_input(job: Path, value: object) -> Path | None:
    """Resolve an uncorrelated legacy baseline only inside the job namespace.

    Current score_bed terminals bind an explicit input path to their start id and
    remain authoritative, including intentionally external ``--input`` paths.
    Legacy bed metadata has no such correlation, so it may recover the supported
    custom-input case only when the recorded file resolves beneath the job. This
    also prevents stale or hostile metadata from making QA inspect an arbitrary
    out-of-job file.
    """
    candidate = _resolve_job_path(job, value)
    if candidate is None:
        return None
    try:
        resolved_job = job.resolve(strict=True)
        resolved_candidate = candidate.resolve(strict=True)
        resolved_candidate.relative_to(resolved_job)
    except (OSError, ValueError):
        return None
    return resolved_candidate if resolved_candidate.is_file() else None


def _load_json_dict(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _spectral_energy_check(path: Path) -> dict:
    """Cheap, deterministic band-energy check for a claimed music artifact.

    The 80 Hz–12 kHz band excludes subsonic/DC noise and covers the useful music
    spectrum. `astats` is intentionally local/cheap; Gemini is not allowed to
    establish whether the artifact exists.
    """
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
        "-af", "highpass=f=80,lowpass=f=12000,astats=metadata=1:reset=0",
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    except OSError as exc:
        return {"status": "unavailable", "reason": "ffmpeg_unavailable",
                "error": str(exc)}
    output = f"{result.stdout}\n{result.stderr}"
    levels: list[float] = []
    for match in re.finditer(r"RMS level dB:\s*(-?(?:inf|\d+(?:\.\d+)?))", output,
                             flags=re.IGNORECASE):
        raw = match.group(1).lower()
        levels.append(float("-inf") if raw in ("-inf", "inf") else float(raw))
    if result.returncode != 0:
        return {"status": "unavailable", "reason": "ffmpeg_failed",
                "error": result.stderr[-300:]}
    if not levels:
        return {"status": "unavailable", "reason": "no_band_energy_measurement"}
    rms_db = max(levels)
    # ffmpeg reports a truly silent carrier as ``-inf``. Python's default JSON
    # encoder writes that as ``-Infinity``, which is invalid JSON for the app.
    # Preserve the silent status while recording a finite measurement floor.
    if not math.isfinite(rms_db):
        rms_db = -120.0
    return {
        "status": "ok" if rms_db > -70.0 else "silent",
        "band_hz": [80, 12000],
        "rms_db": round(rms_db, 2),
    }


def _final_audio_signal(path: Path) -> dict:
    """Classify whether the finished file contains meaningful audio energy.

    The perceptual model cannot reliably distinguish a codec's silent carrier
    track from speech. This local result decides whether an intentionally
    visual-only job needs the perceptual audio call at all.
    """
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
    ]
    try:
        probe = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"status": "unavailable", "reason": "ffprobe_unavailable", "error": str(exc)}
    if probe.returncode != 0:
        return {"status": "unavailable", "reason": "ffprobe_failed", "error": probe.stderr[-300:]}
    if not probe.stdout.strip():
        return {"status": "absent"}
    spectral = _spectral_energy_check(path)
    if spectral.get("status") == "ok":
        return {**spectral, "status": "audible"}
    return spectral


def _is_intentional_visual_only_silence(fidelity: dict, signal: dict) -> bool:
    """Accept silence only when the job explicitly declares no spoken track.

    ``caption_fidelity`` emits ``visual_only`` for text-led scripts and
    ``no_dialogue`` for an empty-dialogue script with captions disabled. Both
    are explicit authoring decisions; treating only the former as intentional
    made equivalent silent videos take different QA paths.
    """
    return bool(
        isinstance(fidelity, dict)
        and fidelity.get("available") is False
        and fidelity.get("applicable") is False
        and fidelity.get("intent") in {"visual_only", "no_dialogue"}
        and signal.get("status") in {"absent", "silent"}
    )


def _visual_only_audio_audit(signal: dict) -> dict:
    """Complete deterministic modality evidence for an intentional silent cut."""
    return {
        "voice_present": False,
        "music_bed_present": False,
        "vocals_in_bed_detected": False,
        "voice_band_collision_flags": [],
        "dead_air_flags": [],
        "clipping_or_dropout_flags": [],
        "bg_music_too_loud_flags": [],
        "engineer_flags": [],
        "intentional_silence": True,
        "final_audio_signal": signal,
    }


def _decoded_audio_sha256(path: Path) -> str | None:
    """Hash normalized decoded PCM so container/codec rewrites compare semantically."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100",
        "-acodec", "pcm_s16le", "-f", "s16le", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True)
    except OSError:
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    return hashlib.sha256(result.stdout).hexdigest()


def _decoded_audio_samples(path: Path, sample_rate: int = 8000) -> array | None:
    """Decode normalized mono PCM for local similarity/containment checks."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(sample_rate),
        "-acodec", "pcm_f32le", "-f", "f32le", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True)
    except OSError:
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    samples = array("f")
    samples.frombytes(result.stdout)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def _has_audio_stream(path: Path) -> bool | None:
    """Return whether ffprobe can prove that ``path`` has a primary audio stream."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return bool(result.stdout.strip())


def _cosine_similarity(left: array, right: array, n: int) -> float | None:
    dot = left_energy = right_energy = 0.0
    for index in range(n):
        lval = float(left[index])
        rval = float(right[index])
        dot += lval * rval
        left_energy += lval * lval
        right_energy += rval * rval
    if left_energy <= 0.0 or right_energy <= 0.0:
        return None
    return dot / math.sqrt(left_energy * right_energy)


def _lagged_cosine_similarity(
    left: array,
    right: array,
    *,
    sample_rate: int,
    max_lag_seconds: float = 0.25,
) -> tuple[float | None, float | None]:
    """Compare equivalent audio while tolerating small codec/container delays."""
    stride = max(1, sample_rate // 2000)
    left_ds = left[::stride]
    right_ds = right[::stride]
    normalized_rate = sample_rate / stride
    max_lag = max(1, int(round(max_lag_seconds * normalized_rate)))
    best_score: float | None = None
    best_lag = 0
    for lag in range(-max_lag, max_lag + 1):
        left_start = max(0, lag)
        right_start = max(0, -lag)
        n = min(len(left_ds) - left_start, len(right_ds) - right_start)
        if n < normalized_rate * 0.5:
            continue
        score = _cosine_similarity(
            left_ds[left_start:left_start + n],
            right_ds[right_start:right_start + n],
            n,
        )
        if score is not None and (
            best_score is None or abs(score) > abs(best_score)
        ):
            best_score = score
            best_lag = lag
    return (
        best_score,
        round(best_lag / normalized_rate, 6) if best_score is not None else None,
    )


def _audio_containment_check(
    reviewed: Path,
    baseline: Path,
    terminal_video: Path | None,
    mix_wav: Path,
) -> dict:
    """Prove the reviewed audio contains the terminal bed/SFX mix.

    Whole-file inequality only proves that *something* changed. This compares
    normalized decoded PCM and, critically, correlates `reviewed - baseline`
    with the terminal bed-only mix. A container/video rewrite with unchanged
    raw audio therefore cannot pass merely because an energetic mix sits nearby.
    """
    if not reviewed.is_file() or not baseline.is_file() or not mix_wav.is_file():
        return {"status": "unavailable", "reason": "containment_input_missing"}
    sample_rate = 2000
    reviewed_pcm = _decoded_audio_samples(reviewed, sample_rate)
    raw_pcm = _decoded_audio_samples(baseline, sample_rate)
    bed_pcm = _decoded_audio_samples(mix_wav, sample_rate)
    terminal_pcm = (
        _decoded_audio_samples(terminal_video, sample_rate)
        if terminal_video is not None and terminal_video.is_file()
        else None
    )
    if reviewed_pcm is None or bed_pcm is None:
        return {"status": "unavailable", "reason": "containment_decode_failed"}

    def compare_silent_baseline(reason: str) -> dict:
        """Bind a music-only final directly to the completed terminal mix."""
        comparison = terminal_pcm if terminal_pcm is not None else bed_pcm
        n = min(len(reviewed_pcm), len(comparison))
        if n < sample_rate * 0.5:
            return {"status": "unavailable", "reason": "containment_audio_too_short"}
        similarity, lag_seconds = _lagged_cosine_similarity(
            reviewed_pcm, comparison, sample_rate=sample_rate,
        )
        contained = similarity is not None and abs(similarity) >= 0.9
        return {
            "status": "ok" if contained else "not_contained",
            "method": "silent_baseline_terminal_mix",
            "sample_rate_hz": sample_rate,
            "samples_compared": n,
            "alignment_lag_seconds": lag_seconds,
            "baseline_audio": reason,
            "final_terminal_similarity": (
                round(similarity, 6) if similarity is not None else None
            ),
        }

    # A music-only video legitimately starts from either no audio stream or a
    # codec/container-created silent carrier. There is no useful raw waveform
    # to subtract in either case, so prove containment by comparing the reviewed
    # audio directly with the completed terminal mix. A failed decode of a
    # baseline that claims to contain audio remains unavailable/fail-closed.
    if raw_pcm is None:
        baseline_has_audio = _has_audio_stream(baseline)
        if baseline_has_audio is not False:
            return {"status": "unavailable", "reason": "containment_decode_failed"}
        return compare_silent_baseline("absent")

    raw_mean_square = (
        sum(float(sample) * float(sample) for sample in raw_pcm) / len(raw_pcm)
        if raw_pcm else 0.0
    )
    # Match the local spectral check's -70 dB silence floor. This tolerates the
    # tiny codec dither found in silent AAC carriers without treating audible
    # programme audio as an empty baseline.
    if raw_mean_square <= 1e-7:
        return compare_silent_baseline("silent_carrier")

    n = min(len(reviewed_pcm), len(raw_pcm), len(bed_pcm))
    if terminal_pcm is not None:
        n = min(n, len(terminal_pcm))
    if n < sample_rate * 0.5:
        return {"status": "unavailable", "reason": "containment_audio_too_short"}

    raw_energy = final_energy = final_raw_dot = 0.0
    for index in range(n):
        final_value = float(reviewed_pcm[index])
        raw_value = float(raw_pcm[index])
        final_energy += final_value * final_value
        raw_energy += raw_value * raw_value
        final_raw_dot += final_value * raw_value
    if raw_energy <= 0.0 or final_energy <= 0.0:
        return {"status": "unavailable", "reason": "containment_silent_track"}

    raw_scale = final_raw_dot / raw_energy
    residual_bed_dot = residual_energy = bed_energy = 0.0
    for index in range(n):
        residual = float(reviewed_pcm[index]) - raw_scale * float(raw_pcm[index])
        bed_value = float(bed_pcm[index])
        residual_bed_dot += residual * bed_value
        residual_energy += residual * residual
        bed_energy += bed_value * bed_value
    residual_correlation = (
        abs(residual_bed_dot) / math.sqrt(residual_energy * bed_energy)
        if residual_energy > 0.0 and bed_energy > 0.0 else 0.0
    )
    residual_ratio = math.sqrt(residual_energy / final_energy)
    final_raw_similarity = _cosine_similarity(reviewed_pcm, raw_pcm, n)
    final_terminal_similarity = (
        _cosine_similarity(reviewed_pcm, terminal_pcm, n)
        if terminal_pcm is not None else None
    )

    residual_contains_mix = (
        residual_correlation >= 0.35 and residual_ratio >= 0.002
    )
    terminal_matches = (
        final_terminal_similarity is None
        or (
            final_terminal_similarity >= 0.98
            and (
                final_raw_similarity is None
                or final_terminal_similarity > final_raw_similarity + 0.0002
            )
        )
    )
    contained = residual_contains_mix and terminal_matches
    return {
        "status": "ok" if contained else "not_contained",
        "sample_rate_hz": sample_rate,
        "samples_compared": n,
        "residual_mix_correlation": round(residual_correlation, 6),
        "residual_to_final_rms_ratio": round(residual_ratio, 6),
        "final_raw_similarity": (
            round(final_raw_similarity, 6)
            if final_raw_similarity is not None else None
        ),
        "final_terminal_similarity": (
            round(final_terminal_similarity, 6)
            if final_terminal_similarity is not None else None
        ),
    }


def _score_bed_run_state(events: list[dict], *, exclude_raw_only: bool = False) -> dict:
    """Describe the latest score_bed mix from append-only events.

    With `exclude_raw_only`, skip standalone (`--raw-only`) asset generations
    and describe the latest run that actually mixed onto this job's video.
    """
    starts = [
        (index, event) for index, event in enumerate(events)
        if (event.get("tool") == "score_bed.py" and event.get("event") == "start"
            and (event.get("mode") or event.get("usage_role")) in ("bed", "generate", "recover"))
    ]
    for start_index, start_event in reversed(starts):
        state = _score_bed_run_from_start(events, start_index, start_event)
        if exclude_raw_only and state["raw_only"]:
            continue
        return state
    return {"planned": False, "status": "not_run", "mode": None}


def _score_bed_run_from_start(events: list[dict], start_index: int,
                              start_event: dict) -> dict:
    """Resolve one score_bed invocation against the events that follow it."""
    mode = start_event.get("mode") or start_event.get("usage_role")
    start_event_id = start_event.get("id")
    correlated = start_event.get("terminal_contract") == 1
    status = "orphaned_start"
    terminal: dict = {}
    for event in events[start_index + 1:]:
        if event.get("tool") != "score_bed.py":
            continue
        name = event.get("event")
        if correlated:
            # New invocations bind their done/error event to the exact start.
            # Ignore legacy `bed_built` and terminals from overlapping runs.
            if name not in ("done", "error"):
                continue
            if event.get("start_event_id") != start_event_id:
                continue
        else:
            # Legacy logs have no correlation id. Stay conservative: a later
            # score_bed invocation ends the only window we can safely attribute.
            if name == "start":
                break
            event_mode = event.get("mode") or event.get("usage_role")
            if event_mode and event_mode != mode:
                continue
        if name == "error":
            status = "error"
        elif name in ("done", "bed_built"):
            # `bed_built` is the pre-terminal-event success marker retained for
            # compatibility with already-shipped jobs.
            status = "done"
        else:
            continue
        terminal = event
    return {
        "planned": True,
        "status": status,
        "mode": mode,
        # Standalone asset generation (score_bed --raw-only). Absent on events
        # written before the flag existed, which were all mixes.
        "raw_only": bool(start_event.get("raw_only") or terminal.get("raw_only")),
        "start_event_id": start_event_id,
        "terminal_event": terminal.get("event"),
        "input_video": (
            terminal.get("video")
            if correlated and status == "done"
            else None
        ),
        "input_snapshot": (
            terminal.get("input_snapshot")
            if correlated and status == "done"
            else None
        ),
        "input_sha256": (
            terminal.get("input_sha256")
            if correlated and status == "done"
            else None
        ),
        "music_track": terminal.get("music_track"),
        "output_wav": terminal.get("output_wav"),
        "output_video": terminal.get("output_video"),
    }


# One definition of "the script has words that must be heard", shared with
# the end-of-render classifier (tools/_serious_findings.py).
_required_narration = required_narration


def ground_audio_audit(job: Path, video: Path, perceptual: dict) -> tuple[dict, str]:
    """Ground music-bed presence in run events, mix inputs, and local evidence."""
    events = read_events(job)
    run_state = _score_bed_run_state(events)
    # A --raw-only run produced a standalone music asset, not a bed mixed onto
    # this video, so the video's mix is graded against the latest real mix run:
    # a standalone generation — succeeded or failed — neither supplies that
    # evidence nor invalidates a mix that already completed. The latest run
    # overall is kept for diagnostics. An explicit EDL/promise/bed_meta
    # requirement still stands on its own.
    mix_run_state = (_score_bed_run_state(events, exclude_raw_only=True)
                     if run_state.get("raw_only") else run_state)
    failures: list[str] = []
    source_candidates: list[Path] = []
    mix_candidates: list[Path] = []

    bed_meta_path = intent_path(job, "audio/bed_meta.json")
    bed_meta = _load_json_dict(bed_meta_path)
    music_track = _resolve_job_path(job, bed_meta.get("music_track"))
    if music_track:
        source_candidates.append(music_track)
    terminal_music = _resolve_job_path(job, mix_run_state.get("music_track"))
    if terminal_music:
        source_candidates.append(terminal_music)
    meta_output = _resolve_job_path(job, bed_meta.get("output_wav"))
    if meta_output:
        mix_candidates.append(meta_output)
    terminal_output = _resolve_job_path(job, mix_run_state.get("output_wav"))
    if terminal_output:
        mix_candidates.append(terminal_output)
    for candidate in (
        job / "audio" / "bed.wav",
        job / "audio" / "bed_prepared.wav",
        job / "audio" / "generated_bed.mp3",
    ):
        source_candidates.append(candidate)
    mix_candidates.append(job / "audio" / "final_mix.wav")
    meta_output_video = _resolve_job_path(job, bed_meta.get("output_video"))
    terminal_output_video = _resolve_job_path(job, mix_run_state.get("output_video"))
    mix_video = (
        terminal_output_video or meta_output_video
        or (job / "audio" / "final_mix.mp4")
    )

    edl = _load_json_dict(intent_path(job, "edl.json"))
    audio_cfg = edl.get("audio") if isinstance(edl.get("audio"), dict) else {}
    bed_cfg = audio_cfg.get("bed") if isinstance(audio_cfg.get("bed"), dict) else {}
    edl_bed = _resolve_job_path(job, bed_cfg.get("source"))
    if edl_bed:
        source_candidates.append(edl_bed)

    promise = _load_json_dict(intent_path(job, "promise.json"))
    promised_audio = promise.get("audio") if isinstance(promise.get("audio"), dict) else {}
    explicitly_no_bed = promised_audio.get("music_bed") is False
    planned = False if explicitly_no_bed else bool(
        mix_run_state["planned"] or bed_meta or bed_cfg
        or (job / "audio" / "bed.wav").exists()
        or promised_audio.get("music_bed") is True
    )

    def _check_candidates(candidates: list[Path]) -> list[dict]:
        checked: list[dict] = []
        seen: set[str] = set()
        for candidate in candidates:
            key = str(candidate.resolve())
            if key in seen or not candidate.is_file():
                continue
            seen.add(key)
            digest = hashlib.sha256()
            with candidate.open("rb") as handle:
                for block in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(block)
            checked.append({
                "path": str(candidate),
                "sha256": digest.hexdigest(),
                **_spectral_energy_check(candidate),
            })
        return checked

    source_spectral = _check_candidates(source_candidates)
    mix_spectral = _check_candidates(mix_candidates)
    required_mix = []
    if terminal_output:
        required_mix = [
            item for item in mix_spectral
            if Path(item["path"]).resolve() == terminal_output.resolve()
        ]
    else:
        required_mix = mix_spectral
    required_source = source_spectral
    if terminal_music:
        required_source = [
            item for item in source_spectral
            if Path(item["path"]).resolve() == terminal_music.resolve()
        ]
    elif mix_run_state.get("mode") == "bed" and music_track:
        required_source = [
            item for item in source_spectral
            if Path(item["path"]).resolve() == music_track.resolve()
        ]
    elif edl_bed:
        required_source = [
            item for item in source_spectral
            if Path(item["path"]).resolve() == edl_bed.resolve()
        ]

    # An invocation is unfinished regardless of a later plan change. Legitimate
    # abandonment must itself be represented by a terminal error/cancel event.
    if mix_run_state["status"] == "orphaned_start":
        failures.append("score_bed_orphaned_start")
    elif mix_run_state["status"] == "error":
        failures.append("score_bed_terminal_error")
    if planned and not required_mix:
        failures.append("music_bed_mix_artifact_missing")
    if (planned and required_mix
            and not any(item["status"] == "ok" for item in required_mix)):
        failures.append("music_bed_mix_spectral_check_failed")
    if planned and not required_source:
        failures.append("music_bed_source_artifact_missing")
    if (planned and required_source
            and not any(item["status"] == "ok" for item in required_source)):
        failures.append("music_bed_source_spectral_check_failed")

    # New score_bed terminals bind the exact source video to the correlated
    # invocation. A completed legacy bed_built run may recover an in-job custom
    # input from its metadata; otherwise preserve final_raw as the fallback.
    recorded_snapshot = _resolve_job_path(job, mix_run_state.get("input_snapshot"))
    recorded_input = _resolve_job_path(job, mix_run_state.get("input_video"))
    legacy_meta_input = (
        _resolve_legacy_bed_input(job, bed_meta.get("video"))
        if mix_run_state.get("status") == "done"
        and mix_run_state.get("terminal_event") == "bed_built"
        else None
    )
    containment_baseline = (
        recorded_snapshot or recorded_input or legacy_meta_input
        or (job / "final_raw.mp4")
    )
    expected_input_sha256 = mix_run_state.get("input_sha256")
    if recorded_snapshot is not None:
        if not recorded_snapshot.is_file():
            failures.append("pre_mix_source_snapshot_missing")
        elif not isinstance(expected_input_sha256, str):
            failures.append("pre_mix_source_snapshot_digest_missing")
        elif _sha256_file(recorded_snapshot) != expected_input_sha256:
            failures.append("pre_mix_source_snapshot_digest_mismatch")
    identical_to_raw = False
    audio_identical_to_raw = False
    if planned and video.is_file() and containment_baseline.is_file():
        try:
            def _digest(path: Path) -> bytes:
                digest = hashlib.sha256()
                with path.open("rb") as handle:
                    for block in iter(lambda: handle.read(1 << 20), b""):
                        digest.update(block)
                return digest.digest()

            identical_to_raw = (
                video.stat().st_size == containment_baseline.stat().st_size
                and _digest(video) == _digest(containment_baseline)
            )
        except OSError:
            pass
        if not identical_to_raw:
            final_audio_hash = _decoded_audio_sha256(video)
            raw_audio_hash = _decoded_audio_sha256(containment_baseline)
            audio_identical_to_raw = bool(
                final_audio_hash and raw_audio_hash
                and final_audio_hash == raw_audio_hash
            )
    if identical_to_raw:
        failures.append("planned_finishing_pass_identical_to_final_raw")
    elif audio_identical_to_raw:
        failures.append("planned_finishing_pass_audio_identical_to_final_raw")
    containment = (
        _audio_containment_check(video, containment_baseline, mix_video, terminal_output)
        if planned and terminal_output is not None
        else {"status": "not_required" if not planned else "unavailable",
              "reason": None if not planned else "terminal_mix_output_missing"}
    )
    if planned and containment.get("status") != "ok":
        failures.append("music_bed_not_contained_in_reviewed_final")

    # A promise that requires audio is a checkable delivery claim in its own
    # right, independent of any music bed: a "final" whose audio track is
    # digital silence has not kept it. This is deliberately separate from the
    # bed checks so a VO-only job with no bed is still covered, and so an
    # intentionally silent film (audio.required false / music_bed false) stays
    # valid without being forced to carry fake audio.
    audio_required = promised_audio.get("required") is True
    final_signal = perceptual.get("final_audio_signal") if isinstance(perceptual, dict) else None
    if not isinstance(final_signal, dict):
        final_signal = _final_audio_signal(video) if video.is_file() else {"status": "unavailable"}
    if audio_required and final_signal.get("status") in {"absent", "silent"}:
        failures.append("promised_audio_missing_from_final")

    result = dict(perceptual) if isinstance(perceptual, dict) else {}
    result.setdefault("final_audio_signal", final_signal)
    reported = result.get("music_bed_present")
    result["music_bed_present_reported"] = reported
    result["music_bed_present"] = bool(planned and not failures)
    result["bed_evidence"] = {
        "planned": planned,
        "explicitly_no_bed": explicitly_no_bed,
        "score_bed": run_state,
        # The run this video's mix was graded against — the latest run itself
        # unless that was a standalone asset generation.
        "score_bed_mix": mix_run_state,
        "configured_input": str(edl_bed) if edl_bed else None,
        "source_artifacts_checked": source_spectral,
        "mix_artifacts_checked": mix_spectral,
        "mix_video": str(mix_video) if mix_video else None,
        "containment_baseline": str(containment_baseline),
        "containment_baseline_sha256": (
            _sha256_file(containment_baseline)
            if containment_baseline.is_file() else None
        ),
        "containment": containment,
        # Backward-compatible report key: only produced mix evidence can prove
        # that a bed reached the mixing stage.
        "artifacts_checked": mix_spectral,
        "final_identical_to_final_raw": identical_to_raw,
        "final_audio_identical_to_final_raw": audio_identical_to_raw,
    }
    result["grounding_failures"] = failures
    if failures:
        engineer_flags = list(result.get("engineer_flags") or [])
        engineer_flags.extend(f"BED_GROUNDING: {reason}" for reason in failures)
        result["engineer_flags"] = engineer_flags

    # Narration-to-bed loudness margin (#237) — measured by score_bed.py at mix
    # time, on the two signals the mux actually sums (the delivered bed wav and
    # the source video's own narration), and carried in bed_meta.json.
    # Surfaced the same way score_bed's own mechanical grounding failures are:
    # a tagged engineer_flags entry, which already flows into
    # review_output.json as an ADVISORY warning_issues entry (see
    # draft_delivery_issues) rather than a blocking one — same treatment as
    # caption pacing (fix[226]). Never invents a defect: silent when no bed was
    # planned, no narration was detected, or the margin holds.
    result["narration_bed_margin"] = bed_meta.get("narration_bed_margin")
    margin = result["narration_bed_margin"]
    if isinstance(margin, dict) and margin.get("low") is True:
        engineer_flags = list(result.get("engineer_flags") or [])
        # A mix made before #321 recorded RMS; newer ones record loudness.
        if "narration_lufs" in margin:
            narration, bed, unit = (margin.get("narration_lufs"),
                                    margin.get("bed_lufs_delivered"), "LUFS")
        else:
            narration, bed, unit = (margin.get("narration_rms_dbfs"),
                                    margin.get("bed_rms_dbfs_delivered"), "dBFS")
        engineer_flags.append(
            "NARRATION_BED_MARGIN: narration leads the delivered bed by only "
            f"{margin.get('margin_db')} dB during speech (minimum "
            f"{margin.get('min_margin_db')} dB) — measured narration "
            f"{narration} {unit} vs delivered bed {bed} {unit} over "
            f"{margin.get('measured_sec')}s of SFX-free speech; the bed may "
            "mask the voice."
        )
        result["engineer_flags"] = engineer_flags

    status = "failed" if failures or result.get("error") else "ok"
    return result, status


def merge_audio_grounding(perceptual: dict, grounded_local: dict) -> tuple[dict, str]:
    """Combine model audio observations with local grounding done in parallel.

    ``grounded_local`` is ``ground_audio_audit`` run on the local signal alone
    (``{"final_audio_signal": ...}``) while the model call was in flight. The
    result equals ``ground_audio_audit(job, video, perceptual)``.
    """
    result = dict(perceptual) if isinstance(perceptual, dict) else {}
    result.setdefault("final_audio_signal", grounded_local.get("final_audio_signal"))
    result["music_bed_present_reported"] = result.get("music_bed_present")
    result["music_bed_present"] = grounded_local.get("music_bed_present")
    result["bed_evidence"] = grounded_local.get("bed_evidence")
    failures = list(grounded_local.get("grounding_failures") or [])
    result["grounding_failures"] = failures
    added = [flag for flag in grounded_local.get("engineer_flags") or []
             if isinstance(flag, str) and flag.startswith(("BED_GROUNDING:", "NARRATION_BED_MARGIN:"))]
    if added:
        result["engineer_flags"] = list(result.get("engineer_flags") or []) + added
    result["narration_bed_margin"] = grounded_local.get("narration_bed_margin")
    return result, "failed" if failures or result.get("error") else "ok"


def gemini_frame_check(frame_path: Path, expected_strings: list[str], job: Path) -> dict:
    """Single-frame mechanical check for brand-text. Used to FRAME-VERIFY every
    on-screen-text flag (a Gemini video-level flag is confirmed by extracting the
    frame and reading the exact rendered letterforms — image diffusion / Seedance
    garble brand strings, so the frame is the ground truth)."""
    t0 = time.time()
    expected_block = (
        "\nExpected on-screen brand strings (verify exact letterforms):\n"
        + "\n".join(f"  - {s!r}" for s in expected_strings)
    ) if expected_strings else ""
    prompt = (
        "You are reading a SINGLE frame of a finished video. Transcribe every "
        "piece of on-screen text EXACTLY as rendered (preserve casing, spelling, "
        "punctuation, and any garbling). Then, for each expected brand string, "
        "say whether it appears correctly, is garbled/misspelled, or is absent."
        + expected_block +
        "\n\nReturn JSON: {\"text_on_screen\": [\"...\"], "
        "\"brand_string_checks\": [{\"expected\": \"...\", "
        "\"status\": \"correct|garbled|absent\", \"observed\": \"...\"}]}"
    )
    gateway_cost = None
    try:
        if gateway.enabled():
            # DUAL MODE: frame goes to the gateway qa_video endpoint as an image
            # reference (the gateway builds image_url parts from _media=="image").
            res = gateway.run(
                "qa_video", role="review_frame", prompt=prompt,
                references=[str(frame_path)],
                params={"_media": "image"},
                job=job, timeout_s=1800,
            )
            raw = res["output"]["text"]
            gateway_cost = res.get("cost_usd")
        else:
            b64 = base64.b64encode(frame_path.read_bytes()).decode("utf-8")
            client = _client()
            resp = client.chat.completions.create(
                model=GEMINI_AUDIO_MODEL,  # same multimodal Gemini; image input
                messages=[
                    {"role": "user", "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    ]},
                ],
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content
        result = parse_json_lenient(raw, "frame_check")
        log_event(job, tool=TOOL_NAME, event="frame_verify_done",
                  duration_seconds=round(time.time() - t0, 1),
                  extra={"frame": frame_path.name,
                         "gateway": gateway.enabled(),
                         "gateway_cost_usd": gateway_cost,
                         "expected": expected_strings})
        return strip_taste(result)
    except Exception as e:
        log_event(job, tool=TOOL_NAME, event="frame_verify_error",
                  extra={"frame": frame_path.name, "error": str(e)[:300]})
        return {"error": str(e), "frame": frame_path.name}


def extract_frame(video_in: Path, t_sec: float, out_path: Path) -> None:
    """Single-frame extraction (mirrors verify_render.py)."""
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-ss", f"{t_sec:.3f}", "-i", str(video_in),
         "-vframes", "1", "-q:v", "2", str(out_path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extract failed at {t_sec}s: {res.stderr[-300:]}")


# ===========================================================================
# Role-log: read declared usage_role per generated asset/beat.
# ===========================================================================

# Generation tools that record a --role/--mode as usage_role at mint time.
_GEN_TOOLS = {"mint_image.py", "mint_video.py", "cast_avatar.py", "perform_avatar.py",
              "gen_broll.py", "generate_image.py", "seedance.py",
              # assemble.py logs one beat_assembled event per EDL beat with its declared
              # role + name — on assembled timelines THIS is the authoritative role source.
              "assemble.py"}

# Tools that produce the LIPSYNC SPINE (per-beat talking-head / avatar chunks
# that the beat boundaries enumerate). The positional-index fallback in
# declared_role_for_beat must only consider these — seam assets (broll/inserts
# from gen_broll/generate_image/mint_image) live in the same run.log.jsonl and
# would otherwise bleed their usage_role onto a spine beat by index.
_SPINE_TOOLS = {"mint_video.py", "cast_avatar.py", "perform_avatar.py", "seedance.py"}


def load_role_log(job: Path, role_log: Path | None) -> list[dict]:
    """Read the job's generation log (run.log.jsonl by default) and return the
    role records every mint_* call wrote. Degraded mode (empty list) when the
    log is missing — review still runs, just without role-matching."""
    path = role_log or intent_path(job, "run.log.jsonl")
    if not path.exists():
        return []
    records = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        role = e.get("usage_role") or e.get("role") or e.get("mode")
        if role is None:
            continue
        if e.get("tool") not in _GEN_TOOLS:
            continue
        # Use explicit None checks so a legitimate index of 0 isn't dropped.
        name = e.get("name")
        if name is None:
            name = e.get("beat")
        if name is None:
            name = e.get("chunk_index")
        records.append({
            "tool": e.get("tool"),
            "event": e.get("event"),
            "usage_role": role,
            "name": name,
            "ts": e.get("ts"),
        })
    return records


def declared_role_for_beat(beat_idx, beat_name, role_records: list[dict]) -> str | None:
    """Best-effort map a beat (index or name) to its declared usage_role."""
    if not role_records:
        return None
    key = beat_name if beat_name is not None else beat_idx
    # Assembly is authoritative for a timeline; a repair appends its replacement.
    for r in reversed(role_records):
        if r.get("tool") != "assemble.py" or r.get("event") != "beat_assembled":
            continue
        if r.get("name") is not None and str(r["name"]) == str(key):
            return r["usage_role"]
    for r in reversed(role_records):
        if r.get("name") is not None and str(r["name"]) == str(key):
            return r["usage_role"]
    # Fall back to positional match by index over generation order — but ONLY
    # over the lipsync-spine assets. Indexing the full record list lets a seam
    # asset (broll/insert) mis-tag a spine beat's role by sharing its position.
    spine = [r for r in role_records if r.get("tool") in _SPINE_TOOLS]
    if isinstance(beat_idx, int) and 0 <= beat_idx < len(spine):
        return spine[beat_idx]["usage_role"]
    return None


# ===========================================================================
# Beat boundaries + script/transcript loaders.
# ===========================================================================

def load_beats(job: Path) -> list[dict]:
    """Resolve beat boundaries. Prefers chunk_boundaries.json (start/end per
    chunk), then script.json chunks, else a single whole-video beat."""
    cb = intent_path(job, "chunk_boundaries.json")
    if cb.exists():
        try:
            data = json.loads(cb.read_text())
            chunks = data.get("chunks") if isinstance(data, dict) else data
            if chunks:
                return [
                    {"index": i,
                     "start_sec": c.get("start_sec", c.get("start", 0.0)),
                     "end_sec": c.get("end_sec", c.get("end", 0.0)),
                     "name": c.get("name") or c.get("chunk_index", i)}
                    for i, c in enumerate(chunks)
                ]
        except (json.JSONDecodeError, AttributeError):
            pass
    # beat_spec.json — the duplication / HUD-clone workflows' beat structure. Use the fine
    # `beats` (animation-window granularity, matching the strips), falling back to `sections`.
    # Lets review_output segment per-beat even without a lipsync-spine chunk log, instead of
    # judging the whole video as one blob.
    bs = intent_path(job, "beat_spec.json")
    if bs.exists():
        try:
            spec = json.loads(bs.read_text())
            rows = spec.get("beats") or spec.get("sections") or []
            out = [{"index": i, "start_sec": float(r["t"][0]), "end_sec": float(r["t"][1]),
                    "name": r.get("name", i)} for i, r in enumerate(rows) if r.get("t")]
            if out:
                return out
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            pass
    sj = intent_path(job, "script.json")
    if sj.exists():
        try:
            script = json.loads(sj.read_text())
            chunks = script.get("chunks", [])
            if chunks:
                return [
                    {"index": c.get("chunk_index", i),
                     "start_sec": c.get("start_sec", c.get("start", 0.0)),
                     "end_sec": c.get("end_sec", c.get("end", 0.0)),
                     "name": c.get("chunk_index", i)}
                    for i, c in enumerate(chunks)
                ]
        except json.JSONDecodeError:
            pass
    return []


def load_script(job: Path) -> dict:
    sj = intent_path(job, "script.json")
    if sj.exists():
        try:
            return json.loads(sj.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def load_transcript(job: Path) -> dict:
    tj = intent_path(job, "transcript.json")
    if tj.exists():
        try:
            return json.loads(tj.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


# ===========================================================================
# Caption-vs-script word-fidelity check (deterministic, no LLM).
# ===========================================================================

_WORD_RE = re.compile(r"[a-z0-9']+")


def _normalize_words(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower().replace("’", "'"))


def _job_file(job: Path, logical: object) -> Path:
    if not isinstance(logical, str) or not logical:
        raise ValueError("missing job-relative path")
    path = (job / logical).resolve()
    path.relative_to(job.resolve())
    if not path.is_file():
        raise ValueError("missing job file")
    return path


def _generated_tts_fidelity(
    job: Path,
    script_text: str,
    timeline: dict | None,
    prior_events: list[dict],
    render_completed: dict,
) -> dict:
    """Validate a content-bound TTS→assembly→render chain without paid STT."""
    unavailable = {"available": False, "applicable": True}
    try:
        manifest = json.loads(intent_path(job, "render-manifest.json").read_text())
        manifest_sha256 = manifest["manifestSha256"]
        unsigned = dict(manifest)
        unsigned.pop("manifestSha256", None)
        output = manifest["output"]
        source = manifest["source"]
        output_path = _job_file(job, output["path"])
        source_path = _job_file(job, source["path"])
        if (
            manifest.get("schema") != RENDER_MANIFEST_SCHEMA
            or canonical_sha256(unsigned) != manifest_sha256
            or output_path != (job / "final.mp4").resolve()
            or _sha256_file(output_path) != output.get("sha256")
            or _sha256_file(source_path) != source.get("sha256")
            or render_completed.get("render_manifest_sha256") != manifest_sha256
            or render_completed.get("output_sha256") != output.get("sha256")
            or render_completed.get("source_path") != source.get("path")
            or render_completed.get("source_sha256") != source.get("sha256")
        ):
            raise ValueError("render lineage changed")
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return {**unavailable, "reason": "generated TTS render lineage is missing or stale"}

    if (
        not isinstance(timeline, dict)
        or timeline.get("output") != source.get("path")
        or timeline.get("output_sha256") != source.get("sha256")
        or timeline.get("from_beats") is not False
        or not isinstance(timeline.get("generated_tts"), dict)
    ):
        return {**unavailable, "reason": "rendered timeline lacks generated TTS provenance"}
    voice = timeline["generated_tts"]
    try:
        audio = _job_file(job, voice["path"])
        evidence_path = _job_file(job, voice["evidence_path"])
        evidence_sha256 = _sha256_file(evidence_path)
        evidence = json.loads(evidence_path.read_text())
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return {**unavailable, "reason": "generated TTS source evidence is missing"}

    expected_hash = voice.get("audio_sha256")
    synth_events = [event for event in prior_events if (
        event.get("id") == voice.get("tts_event_id")
        and event.get("tool") == "synth_voice.py"
        and event.get("event") == "tts_generated"
    )]
    if (
        voice.get("kind") != "engine_generated_tts"
        or not isinstance(expected_hash, str)
        or not re.fullmatch(r"[0-9a-f]{64}", expected_hash)
        or expected_hash != _sha256_file(audio)
        or voice.get("evidence_sha256") != evidence_sha256
        or len(synth_events) != 1
        or any(synth_events[0].get(key) != voice.get(key) for key in (
            "audio_sha256", "evidence_path", "evidence_sha256"
        ))
        or synth_events[0].get("final_path") != voice.get("path")
    ):
        return {**unavailable, "reason": "generated TTS source changed after synthesis"}

    words = evidence.get("words")
    duration = evidence.get("final_duration_sec")
    if (
        evidence.get("evidence_kind") != "engine_generated_tts"
        or evidence.get("final_path") != voice.get("path")
        or evidence.get("audio_sha256") != expected_hash
        or not isinstance(duration, (int, float))
        or isinstance(duration, bool)
        or not math.isfinite(duration)
        or duration <= 0
        or abs(ffprobe_duration(audio) - duration) > 0.05
        or evidence.get("timing_kind") != "utterance_envelope"
        or not isinstance(words, list)
        or not words
        or any(
            not isinstance(word, dict)
            or not isinstance(word.get("word"), str)
            or not isinstance(word.get("start"), (int, float))
            or not isinstance(word.get("end"), (int, float))
            or isinstance(word["start"], bool)
            or isinstance(word["end"], bool)
            or word["start"] != 0
            or word["end"] != duration
            for word in words
        )
    ):
        return {**unavailable, "reason": "generated TTS evidence is invalid"}
    evidence_text = str(evidence.get("text") or "")
    if (
        synth_events[0].get("text") != evidence_text
        or _normalize_words(evidence_text)
        != _normalize_words(" ".join(word["word"] for word in words))
        or _normalize_words(script_text) != _normalize_words(evidence_text)
    ):
        return {**unavailable, "reason": "generated TTS evidence does not match the script"}
    word_count = len(_normalize_words(evidence_text))
    return {
        "available": True,
        "applicable": True,
        "evidence": "engine_generated_tts",
        "audio_path": voice["path"],
        "audio_sha256": expected_hash,
        "script_word_count": word_count,
        "caption_word_count": word_count,
        "word_overlap_ratio": 1.0,
        "in_script_missing_from_captions": [],
        "in_captions_not_in_script": [],
    }


def _render_disabled_captions(job: Path, video: Path) -> bool:
    events = [event for event in read_events(job) if (
        event.get("tool") == "compose_render.py"
        and event.get("event") in {"render_started", "render_completed", "render_failed"}
    )]
    if len(events) < 2:
        return False
    started, completed = events[-2:]
    return (
        started.get("event") == "render_started"
        and completed.get("event") == "render_completed"
        and started.get("show_captions") is False
        and completed.get("show_captions") is False
        and completed.get("retrofit") is False
        and completed.get("output_sha256") == _sha256_file(video)
    )


def _spoken_chunks(script: dict) -> list[tuple[dict, str]] | None:
    """The chunks synth_voice would speak, via its own selector; None if it cannot read them."""
    chunks = script.get("chunks") if isinstance(script.get("chunks"), list) else []
    try:
        return [(chunk, text) for _, chunk, text in selected_tts_chunks(chunks, None)]
    except (AttributeError, TypeError):
        return None


def _script_spoken_text(script: dict) -> str | None:
    spoken = _spoken_chunks(script)
    if spoken is None:
        return None
    script_text = " ".join(text for _, text in spoken)
    if not script_text:
        parts = [
            script[key].strip() for key in ("dialogue", "narration")
            if isinstance(script.get(key), str) and _normalize_words(script[key])
        ]
        if len(parts) == 2 and _normalize_words(parts[0]) == _normalize_words(parts[1]):
            parts.pop()
        script_text = " ".join(parts)
    return script_text


def caption_fidelity(job: Path) -> dict:
    """Compare the PASS-2 transcript (what the captions render) against the
    script's dialogue (what was intended). Surfaces missing / divergent words.
    Deterministic — no Gemini, no taste."""
    script_path = intent_path(job, "script.json")
    promise_path = intent_path(job, "promise.json")
    script = load_script(job)
    transcript = load_transcript(job)
    chunks = script.get("chunks") if isinstance(script.get("chunks"), list) else None
    script_text = _script_spoken_text(script)
    if script_text is None:
        return {"available": False, "applicable": True,
                "reason": "script.json chunk text/dialogue is not a string"}
    transcript_text = (transcript.get("text") or " ".join(
        (w.get("word") or w.get("text") or "") for w in transcript.get("words", [])
    )).strip()
    explicit_no_captions = False
    try:
        promise = json.loads(promise_path.read_text()) if promise_path.exists() else {}
        delivery = promise.get("delivery")
        contract = delivery if isinstance(delivery, dict) else promise
        explicit_no_captions = (contract.get("captions") or {}).get("required") is False
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    # The successful compositor invocation is stronger than the presence of a
    # hand-authored promise. If the latest completed render explicitly disabled
    # captions, QA must not demand caption data or invented narration.
    latest_timeline: tuple[int, dict] | None = None
    render_timeline: tuple[int, dict] | None = None
    latest_render_started: dict | None = None
    latest_render_completed: dict | None = None
    events = read_events(job)
    for index, event in enumerate(events):
        if event.get("tool") == "assemble.py" and event.get("event") == "timeline_assembled":
            latest_timeline = (index, event)
        if event.get("tool") != "compose_render.py":
            continue
        if event.get("event") == "render_started":
            latest_render_started = event
            latest_render_completed = None
            render_timeline = latest_timeline
        elif event.get("event") == "render_completed" and latest_render_started is not None:
            latest_render_completed = event
        elif event.get("event") == "render_failed" and latest_render_started is not None:
            latest_render_completed = None
    if latest_render_completed and latest_render_started is not None:
        explicit_no_captions = (
            explicit_no_captions
            or latest_render_started.get("show_captions") is False
        )
    visual_only_script = (
        isinstance(script.get("on_screen_text"), list)
        and bool(script.get("on_screen_text"))
        and not script_text.strip()
    )
    explicit_no_dialogue = not script_text.strip() and (
        not script_path.exists() or chunks is not None or visual_only_script
    )
    if explicit_no_dialogue and (explicit_no_captions or visual_only_script):
        return {
            "available": False,
            "applicable": False,
            "intent": "visual_only" if visual_only_script else "no_dialogue",
            "reason": (
                "text-only script with on_screen_text and no dialogue/narration"
                if visual_only_script
                else "explicit no-dialogue script and captions.required=false"
            ),
        }
    if not script_text:
        return {"available": False, "applicable": True,
                "reason": "missing trustworthy script dialogue/narration intent"}
    if not transcript_text:
        if (
            explicit_no_captions
            and latest_render_completed is not None
            and latest_render_started is not None
            and latest_render_started.get("show_captions") is False
            and latest_render_completed.get("show_captions") is False
            and latest_render_completed.get("source_audio_carried") is True
            and latest_render_completed.get("retrofit") is False
            and render_timeline is not None
        ):
            timeline_index, timeline = render_timeline
            return _generated_tts_fidelity(
                job, script_text, timeline, events[:timeline_index], latest_render_completed
            )
        return {"available": False, "applicable": True,
                "reason": "missing transcript.json text for caption/audio fidelity"}

    script_words = _normalize_words(script_text)
    cap_words = _normalize_words(transcript_text)
    if transcript_text.strip().upper().startswith("PLACEHOLDER"):
        return {"available": False, "applicable": True,
                "reason": "transcript is a PLACEHOLDER (no real transcription)"}

    script_set = set(script_words)
    cap_set = set(cap_words)
    in_script_not_caption = sorted(script_set - cap_set)
    in_caption_not_script = sorted(cap_set - script_set)
    overlap = len(script_set & cap_set)
    denom = max(len(script_set), 1)
    return {
        "available": True,
        "applicable": True,
        "script_word_count": len(script_words),
        "caption_word_count": len(cap_words),
        "word_overlap_ratio": round(overlap / denom, 3),
        "in_script_missing_from_captions": in_script_not_caption[:40],
        "in_captions_not_in_script": in_caption_not_script[:40],
    }


def ground_caption_fidelity_with_audio(
    fidelity: dict,
    audio_audit: dict,
    audio_audit_status: str,
) -> dict:
    """Resolve caption applicability when no authoring transcript exists.

    Supplied or legacy videos may legitimately have no ``script.json`` or
    ``promise.json``.  Missing authoring metadata alone cannot prove that
    captions are unnecessary, so ``caption_fidelity`` initially fails closed.
    Once the integrated full-video audio evidence positively finds no voice,
    however, there are no spoken words for captions to represent.  Record that
    evidence instead of demanding placeholder narration or caption files.

    A present voice, an incomplete audit, or any other fidelity failure remains
    applicable and blocking.
    """
    if not isinstance(fidelity, dict) or not isinstance(audio_audit, dict):
        return fidelity
    if not (
        fidelity.get("available") is False
        and fidelity.get("applicable") is True
        and fidelity.get("reason") == "missing trustworthy script dialogue/narration intent"
        and audio_audit_status == "ok"
        and audio_audit.get("voice_present") is False
    ):
        return fidelity
    return {
        "available": False,
        "applicable": False,
        "intent": "verified_no_voice",
        "reason": (
            "no declared dialogue/narration and the integrated full-video review "
            "found no spoken voice"
        ),
        "evidence": "integrated_full_video_audio",
    }


# ===========================================================================
# On-screen-text / brand-string audit (Gemini observation → exact local frames).
# ===========================================================================

def expected_brand_strings(job: Path, cli_strings: str | None) -> list[str]:
    """Collect the brand strings we EXPECT to see rendered on-screen. Sources:
    --brand-strings CLI, company.json (name + website), style_directives URL."""
    out: list[str] = []
    if cli_strings:
        out.extend([s.strip() for s in cli_strings.split(",") if s.strip()])
    cj = intent_path(job, "company.json")
    if cj.exists():
        try:
            company = json.loads(cj.read_text())
            for k in ("name", "company", "website", "url", "handle"):
                v = company.get(k)
                if isinstance(v, str) and v.strip():
                    out.append(v.strip())
        except json.JSONDecodeError:
            pass
    sd = intent_path(job, "style_directives.json")
    if sd.exists():
        try:
            data = json.loads(sd.read_text())
            url = (data.get("url_pill") or {}).get("text") if isinstance(data.get("url_pill"), dict) else None
            if isinstance(url, str) and url.strip():
                out.append(url.strip())
        except (json.JSONDecodeError, AttributeError):
            pass
    # De-dupe preserving order.
    seen = set()
    deduped = []
    for s in out:
        if s.lower() not in seen:
            seen.add(s.lower())
            deduped.append(s)
    return deduped


def onscreen_text_audit(final_review: dict, expected: list[str]) -> dict:
    """Pull on-screen-text / overlay issues out of the final_review observations
    and check them against the expected brand strings. Returns the flagged
    timestamps for exact local frame evidence."""
    flags: list[dict] = []

    def _collect(section: str):
        for issue in (final_review.get(section, {}) or {}).get("issues", []):
            kind = (issue.get("kind") or "")
            text = issue.get("text") or ""
            detail = issue.get("detail") or ""
            is_text_kind = any(
                tok in kind for tok in ("text", "wrong", "garbl", "unreadable", "clipped", "off_screen")
            )
            mentions_brand = any(b.lower() in (text + " " + detail).lower() for b in expected)
            if is_text_kind or mentions_brand:
                flags.append({
                    "section": section,
                    "kind": kind,
                    "start_sec": issue.get("start_sec"),
                    "end_sec": issue.get("end_sec"),
                    "text": text,
                    "detail": detail,
                })

    _collect("captions")
    _collect("overlays")
    return {"expected_brand_strings": expected, "flags": flags}


# ===========================================================================
# Role-judge — map Gemini's mechanical observations → per-beat verdict.
# This is THIS TOOL's editorial logic (NOT Gemini's score). The judge is what
# turns "eyes" into an editorial role-compliance call.
# ===========================================================================

_VALID_VERDICTS = ("on-role", "usable-but-wrong", "slop", "ai-tell")

# What each declared role expects the footage to BE. Used to phrase the
# recommended-action when a beat is off-role.
_ROLE_EXPECTATION = {
    "keyframe": "a deliberate hero beat — a held, composed key moment",
    "insert": "a short cutaway / B-roll insert under the voice",
    "talking_head": "the avatar delivering dialogue on-camera",
    "broll": "environment / object footage with no dialogue",
    "typography": "kinetic text — no avatar, no garbled rendered words",
    "front": "the locked avatar identity, on-camera",
}


def _is_advisory_claim(claim_checks: dict | None, section: str, index: int) -> bool:
    """A model claim that deterministic evidence contradicted or could not establish."""
    check = (claim_checks or {}).get((section, index)) or {}
    return check.get("verification") in {"contradicted", "unverified"}


def _overlapping_issues(final_review: dict, start: float, end: float, ignore_sections: frozenset[str]):
    for section in (
        "visual_anomalies",
        "transition_anomalies",
        "style_consistency",
        "story_coherence",
        "lipsync",
        "captions",
        "overlays",
        "audio",
    ):
        if section in ignore_sections:
            continue
        for index, issue in enumerate((final_review.get(section, {}) or {}).get("issues", [])):
            # Pacing is advisory; keep it in the raw report, not the mechanical judge.
            if section == "captions" and str(issue.get("kind", "")).strip().lower() == "caption_pace_slow":
                continue
            # A planned punch-in, padding or silence is not a beat defect.
            if isinstance(issue, dict) and issue.get("declared_edit"):
                continue
            s = issue.get("start_sec")
            e = issue.get("end_sec", s)
            if s is None:
                continue
            if e is None:
                e = s
            # overlap test
            if e >= start and s <= end:
                yield section, index, f"[{section}] {issue.get('detail') or issue.get('kind') or ''}"


def _beat_observations(
    final_review: dict,
    start: float,
    end: float,
    *,
    ignore_sections: frozenset[str] = frozenset(),
    claim_checks: dict | None = None,
) -> list[str]:
    """Defect-grade observations (from any section) overlapping this beat.
    Claims that deterministic evidence contradicted or could not establish
    are excluded; see ``_beat_advisory_observations``."""
    return [
        text for section, index, text in _overlapping_issues(final_review, start, end, ignore_sections)
        if not _is_advisory_claim(claim_checks, section, index)
    ]


def _beat_advisory_observations(
    final_review: dict,
    start: float,
    end: float,
    *,
    ignore_sections: frozenset[str] = frozenset(),
    claim_checks: dict | None = None,
) -> list[str]:
    return [
        f"{text} ({claim_checks[(section, index)]['verification']}: "
        f"{claim_checks[(section, index)]['evidence']})"
        for section, index, text in _overlapping_issues(final_review, start, end, ignore_sections)
        if _is_advisory_claim(claim_checks, section, index)
    ]


_AI_TELL_PATTERNS = (
    r"extra finger", r"six finger", r"deformed", r"warp", r"morph",
    r"identity drift", r"face drift", r"garbl", r"shimmer", r"floating",
    r"melt", r"plastic", r"uncanny", r"glitch", r"distort",
)


def judge_beat(
    declared_role: str | None,
    observations: list[str],
    advisory_observations: list[str] = (),
) -> dict:
    """Editorial role-compliance verdict for one beat. Pure rule logic over the
    mechanical observations — does NOT use any Gemini quality score.

    ``observations`` must be defect-grade (``_beat_observations``). Advisory
    claims are reported alongside and never change the verdict.

    Verdicts:
      on-role           observations are clean for the declared role
      usable-but-wrong  no hard defect, but the placement/role looks off
      slop              mechanical defect present (lipsync/audio/framing)
      ai-tell           a visible AI artifact (extra fingers, garble, morph…)
    """
    joined = " ".join(observations).lower()
    has_ai_tell = any(re.search(p, joined) for p in _AI_TELL_PATTERNS)
    has_defect = bool(observations)

    if has_ai_tell:
        verdict = "ai-tell"
    elif has_defect:
        verdict = "slop"
    else:
        verdict = "on-role"

    # Role-awareness: a clean beat whose declared role is a hero keyframe but
    # which Gemini never described as a held/composed moment is downgraded to
    # usable-but-wrong only when we have no positive on-role signal AND the role
    # demanded one. We keep this conservative (advisory) — never invent defects.
    recommended_action = ""
    if verdict in ("slop", "ai-tell"):
        if declared_role:
            recommended_action = (
                f"regen this beat as role={declared_role} "
                f"({_ROLE_EXPECTATION.get(declared_role, 'declared role')}); "
                f"the mechanical defect above makes it unshippable."
            )
        else:
            recommended_action = "regen this beat; mechanical defect present."

    return {
        "declared_role": declared_role or "(unknown — degraded role-match)",
        "verdict": verdict,
        "ai_tell": has_ai_tell,
        "observations": observations,
        "advisory_observations": list(advisory_observations),
        "recommended_action": recommended_action,
    }


# ===========================================================================
# mode=full
# ===========================================================================

def resolve_video(job: Path, explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        # A bare filename / job-relative path resolves against the JOB dir, not
        # the CWD (repo root). Only fall back to the literal path when the
        # job-relative candidate doesn't exist (e.g. an absolute path was given).
        if not p.is_absolute():
            job_rel = job / explicit
            if job_rel.exists():
                return job_rel
        if not p.exists():
            sys.exit(
                f"ERROR: --video {explicit} not found "
                f"(looked in job dir {job} and as a literal path)."
            )
        return p
    for name in ("output/final.mp4", "final.mp4", "final_raw.mp4"):
        cand = job / name
        if cand.exists():
            return cand
    sys.exit(f"ERROR: no final render found in {job} (looked for output/final.mp4, "
             f"final.mp4, final_raw.mp4). Pass --video explicitly.")


def _sha256_file(path: Path) -> str | None:
    try:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest()
    except OSError:
        return None


def _qa_snapshots_dir(job: Path) -> Path:
    """Return the real job-owned QA directory; never follow an agent-made link."""
    job_root = job.resolve(strict=True)
    snapshots = job / "qa_snapshots"
    if snapshots.exists() or snapshots.is_symlink():
        if snapshots.is_symlink() or not snapshots.is_dir():
            raise RuntimeError("qa_snapshots must be a real directory inside the job")
    else:
        snapshots.mkdir(mode=0o700)
    if snapshots.resolve(strict=True).parent != job_root:
        raise RuntimeError("qa_snapshots resolved outside the bound job")
    return snapshots


def _is_retained_render(video: Path, job: Path, sha256: str) -> bool:
    """``renders/<sha256>.<ext>``: the retained, never-rewritten published bytes."""
    try:
        return (not video.is_symlink() and video.is_file() and video.stem == sha256
                and video.parent.resolve() == (job / "renders").resolve())
    except OSError:
        return False


def _stage_dir(target_dir: Path) -> Path:
    """Where to write a file before ``os.replace`` moves it into ``target_dir``.

    The end-of-render review child stages in the scratch folder the render
    gave it (inside its invocation folder, on the job's filesystem); the
    render removes that folder when the child ends or is stopped, so nothing
    half-written is left behind by a kill.
    """
    scratch = os.environ.get(SCRATCH_ENV) if harness_child() else None
    if scratch:
        try:
            staged = Path(scratch)
            staged.mkdir(parents=True, exist_ok=True)
            if staged.stat().st_dev == Path(target_dir).stat().st_dev:
                return staged
        except OSError:
            pass
    return Path(target_dir)


def _prepare_review_snapshot(video: Path, job: Path, source_sha256: str | None) -> tuple[Path, str | None]:
    """Copy the render once so every long-running QA phase sees identical bytes."""
    if not source_sha256:
        return video, None
    if harness_child() and _is_retained_render(video, job, source_sha256):
        # The end-of-render review reads the retained copy of the published
        # bytes directly: it is never rewritten, so no second copy is needed.
        return video, source_sha256
    snapshots = _qa_snapshots_dir(job)
    snapshot = snapshots / f"final_{source_sha256}.mp4"
    if snapshot.is_symlink() or (snapshot.exists() and not snapshot.is_file()):
        raise RuntimeError("exact-final QA snapshot must be a real file")
    if _sha256_file(snapshot) != source_sha256:
        with tempfile.NamedTemporaryFile(
            prefix=f".{snapshot.name}.", suffix=".tmp",
            dir=_stage_dir(snapshots), delete=False,
        ) as opened:
            temporary = Path(opened.name)
        try:
            # A copy-on-write clone where the filesystem has one (no extra
            # space), else a full copy.
            temporary.unlink()
            if not _clone(video, temporary, 120):
                temporary.unlink(missing_ok=True)
                shutil.copyfile(video, temporary)
            os.replace(temporary, snapshot)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    try:
        snapshot.chmod(0o444)
    except OSError:
        pass
    return snapshot, _sha256_file(snapshot)


def _qa_model_cache_path(job: Path, source_sha256: str) -> Path:
    return _qa_snapshots_dir(job) / f"model_{source_sha256}.json"


def _load_qa_model_cache(
    job: Path,
    source_sha256: str | None,
    perceptual_transport: dict,
) -> dict:
    """Load successful paid observations for these exact final/proxy bytes.

    Local delivery, caption, frame, Taste, and receipt checks intentionally run
    every time. Only provider observations are reused, so completing missing
    local evidence never pays for the same immutable video twice.
    """
    if not source_sha256:
        return {}
    path = _qa_model_cache_path(job, source_sha256)
    try:
        if path.is_symlink() or not path.is_file():
            return {}
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(value, dict):
        return {}
    if (
        value.get("schema") != QA_MODEL_CACHE_SCHEMA
        or value.get("source_sha256") != source_sha256
        or value.get("proxy_sha256") != perceptual_transport.get("proxy_sha256")
        or value.get("recipe_sha256") != perceptual_transport.get("recipe_sha256")
    ):
        return {}
    return value


def _qa_model_cache_receipt(
    source_sha256: str | None,
    perceptual_transport: dict,
    *,
    final_review_ready: bool,
) -> str:
    payload = {
        "schema": QA_MODEL_CACHE_SCHEMA,
        "source_sha256": source_sha256,
        "proxy_sha256": perceptual_transport.get("proxy_sha256"),
        "recipe_sha256": perceptual_transport.get("recipe_sha256"),
        "final_review_ready": final_review_ready,
    }
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()


def mode_model_cache_status(args, job: Path) -> int:
    """Free preflight used by the app before asking to pay for required QA.

    A positive receipt binds exact source, proxy, recipe, and the single paid
    full-video observation. The full run requires that receipt again, so deleting or
    changing the cache between preflight and execution fails closed instead of
    starting an unapproved provider call.
    """
    source_video = resolve_video(job, args.video)
    input_sha256 = _sha256_file(source_video)
    video, snapshot_input_sha256 = _prepare_review_snapshot(
        source_video, job, input_sha256,
    )
    try:
        _review_video, perceptual_transport = _prepare_perceptual_transport(
            video, job, snapshot_input_sha256,
        )
    except Exception as exc:
        perceptual_transport = {
            "schema": PERCEPTUAL_TRANSPORT_SCHEMA,
            "status": "unavailable",
            "source_sha256": snapshot_input_sha256,
            "error": str(exc)[:500],
        }
    cache = _load_qa_model_cache(job, snapshot_input_sha256, perceptual_transport)
    final_review = cache.get("final_review")
    final_structured, _errors = _structured_review_status(final_review)
    final_ready = cache.get("final_review_status") == "ok" and final_structured
    paid_required = not final_ready
    receipt = _qa_model_cache_receipt(
        snapshot_input_sha256,
        perceptual_transport,
        final_review_ready=final_ready,
    )
    print(json.dumps({
        "schema": "videoclaw.qa-model-cache-status/v1",
        "source_sha256": snapshot_input_sha256,
        "paid_model_calls_required": paid_required,
        "final_review_ready": final_ready,
        "integrated_audio_ready": final_ready,
        "cache_receipt_sha256": receipt,
    }, sort_keys=True))
    return 0


def _write_qa_model_cache(
    job: Path,
    source_sha256: str | None,
    perceptual_transport: dict,
    *,
    final_review: dict | None,
    final_review_status: str,
    billing: str | None = None,
) -> None:
    if not source_sha256:
        return
    prior = _load_qa_model_cache(job, source_sha256, perceptual_transport)
    value: dict = {
        "schema": QA_MODEL_CACHE_SCHEMA,
        "source_sha256": source_sha256,
        "proxy_sha256": perceptual_transport.get("proxy_sha256"),
        "recipe_sha256": perceptual_transport.get("recipe_sha256"),
        "updated_at": time.time(),
    }
    if prior.get("final_review_status") == "ok" and isinstance(prior.get("final_review"), dict):
        value["final_review_status"] = "ok"
        value["final_review"] = prior["final_review"]
        if prior.get("final_review_billing"):
            value["final_review_billing"] = prior["final_review_billing"]
    if final_review_status == "ok" and isinstance(final_review, dict):
        structured, _errors = _structured_review_status(final_review)
        if structured:
            value["final_review_status"] = "ok"
            value["final_review"] = final_review
            # Who paid for these observations ("house" only for the harness).
            if billing:
                value["final_review_billing"] = billing
            else:
                value.pop("final_review_billing", None)
    if "final_review" not in value:
        return
    path = _qa_model_cache_path(job, source_sha256)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", prefix=f".{path.name}.", suffix=".tmp",
        dir=_stage_dir(path.parent), delete=False,
    ) as opened:
        temporary = Path(opened.name)
        json.dump(value, opened, indent=2, allow_nan=False)
        opened.flush()
        os.fsync(opened.fileno())
    try:
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)


def _probe_media(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_streams", "-show_format",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffprobe could not inspect the perceptual review input: "
            f"{result.stderr.strip()[:300]}"
        )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("ffprobe returned invalid media metadata") from exc
    streams = data.get("streams") or []
    video = next(
        (item for item in streams if item.get("codec_type") == "video"), None)
    if not isinstance(video, dict):
        raise RuntimeError("perceptual review input has no video stream")
    try:
        duration = float((data.get("format") or {}).get("duration"))
        width = int(video["width"])
        height = int(video["height"])
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise RuntimeError("perceptual review input has invalid media metadata") from exc
    if not math.isfinite(duration) or duration <= 0 or width <= 0 or height <= 0:
        raise RuntimeError("perceptual review input has invalid dimensions or duration")
    display_aspect_ratio = width / height
    raw_display_aspect = video.get("display_aspect_ratio")
    if isinstance(raw_display_aspect, str) and ":" in raw_display_aspect:
        try:
            candidate = float(Fraction(raw_display_aspect.replace(":", "/", 1)))
            if math.isfinite(candidate) and candidate > 0:
                display_aspect_ratio = candidate
        except (ValueError, ZeroDivisionError, OverflowError):
            pass
    return {
        "duration_sec": duration,
        "width": width,
        "height": height,
        "display_aspect_ratio": display_aspect_ratio,
        "has_audio": any(
            item.get("codec_type") == "audio" for item in streams
            if isinstance(item, dict)
        ),
        "audio_stream_count": sum(
            item.get("codec_type") == "audio" for item in streams
            if isinstance(item, dict)
        ),
    }


def _ffmpeg_identity() -> str:
    result = subprocess.run(
        ["ffmpeg", "-version"], capture_output=True, text=True, timeout=15,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError("ffmpeg identity is unavailable")
    return result.stdout.splitlines()[0].strip()[:300]


def _prepare_perceptual_transport(
    exact_snapshot: Path,
    job: Path,
    exact_sha256: str | None,
) -> tuple[Path, dict]:
    """Build a bounded visual-review copy, cryptographically tied to the final.

    Gemini sees this same-duration/same-framing copy. Exact-pixel face, caption,
    edge, centring, and platform red-zone checks continue to read the exact
    full-resolution final; the proxy cannot satisfy or waive those checks.
    """
    if not exact_sha256:
        raise RuntimeError("exact final SHA-256 is unavailable")
    source = _probe_media(exact_snapshot)
    ffmpeg_identity = _ffmpeg_identity()
    available_bits_per_second = int(
        (PERCEPTUAL_PROXY_MAX_BYTES * 8 * 0.90) / source["duration_sec"]
    )
    audio_bitrate = PERCEPTUAL_PROXY_AUDIO_BITRATE if source["has_audio"] else 0
    video_bitrate = min(
        PERCEPTUAL_PROXY_MAX_VIDEO_BITRATE,
        available_bits_per_second - audio_bitrate * source.get("audio_stream_count", 1),
    )
    if video_bitrate < PERCEPTUAL_PROXY_MIN_VIDEO_BITRATE:
        raise RuntimeError(
            "video is too long for the bounded full-video review profile; "
            "review unavailable rather than discarding audio or unreadably compressing it"
        )
    # Preserve spatial detail and audio for longer timelines. Below these
    # budgets, fewer frames are more useful than 24 badly compressed frames.
    # This is a sampled perceptual review, not frame-by-frame motion validation.
    frame_rate = 24 if video_bitrate >= 300_000 else 12 if video_bitrate >= 150_000 else 6
    retry_video_bitrate = max(PERCEPTUAL_PROXY_MIN_VIDEO_BITRATE, int(video_bitrate * 0.8))
    recipe = {
        "scale": (
            # Unspecified SAR means square pixels; set it before rounding the
            # scaled dimensions so ffmpeg can preserve the displayed framing.
            "setsar='if(eq(sar,0),1,sar)':max=65535,"
            "scale=w='min(720,iw)':h='min(1280,ih)':"
            "force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"fps={frame_rate}"
        ),
        "frame_rate": frame_rate,
        "retry_video_bitrate": retry_video_bitrate,
        "video_codec": "libx264",
        "video_bitrate": video_bitrate,
        "maxrate": video_bitrate,
        "bufsize": video_bitrate * 2,
        "pixel_format": "yuv420p",
        "audio_codec": "aac" if source["has_audio"] else None,
        "audio_bitrate": audio_bitrate if source["has_audio"] else None,
        "audio_channels": 2 if source["has_audio"] else None,
        "audio_hz": 48_000 if source["has_audio"] else None,
    }
    recipe_json = json.dumps(recipe, sort_keys=True, separators=(",", ":"))
    recipe_sha256 = hashlib.sha256(recipe_json.encode()).hexdigest()
    snapshots = _qa_snapshots_dir(job)
    proxy = snapshots / (
        f"final_{exact_sha256}.perceptual_{recipe_sha256[:12]}.mp4"
    )
    manifest_path = proxy.with_suffix(".json")

    reusable = False
    existing: dict = {}
    if proxy.is_symlink() or manifest_path.is_symlink():
        raise RuntimeError("perceptual QA artifacts must be real files")
    if (proxy.is_file() and not proxy.is_symlink()
            and manifest_path.is_file() and not manifest_path.is_symlink()):
        try:
            existing = json.loads(manifest_path.read_text())
        except (OSError, json.JSONDecodeError):
            existing = {}
        reusable = (
            existing.get("schema") == PERCEPTUAL_TRANSPORT_SCHEMA
            and existing.get("source_sha256") == exact_sha256
            and existing.get("recipe_sha256") == recipe_sha256
            and existing.get("encoded_video_bitrate") in (video_bitrate, retry_video_bitrate)
            and existing.get("proxy_sha256") == _sha256_file(proxy)
            and proxy.stat().st_size <= PERCEPTUAL_PROXY_MAX_BYTES
        )

    encoded_video_bitrate = existing.get("encoded_video_bitrate", video_bitrate)
    if not reusable:
        with tempfile.NamedTemporaryFile(
            prefix=f".{proxy.stem}.", suffix=".tmp.mp4",
            dir=_stage_dir(snapshots), delete=False,
        ) as opened:
            temporary = Path(opened.name)
        try:
            # A local encode retry is free; never retry an accepted paid review.
            for encoded_video_bitrate in dict.fromkeys((video_bitrate, retry_video_bitrate)):
                command = [
                    "ffmpeg", "-y", "-v", "error", "-i", str(exact_snapshot),
                    "-map", "0:v:0", "-map", "0:a?", "-vf", recipe["scale"],
                    "-c:v", "libx264", "-preset", "medium",
                    "-b:v", str(encoded_video_bitrate), "-maxrate", str(encoded_video_bitrate),
                    "-bufsize", str(encoded_video_bitrate * 2), "-pix_fmt", "yuv420p",
                ]
                if source["has_audio"]:
                    command.extend([
                        "-c:a", "aac", "-b:a", str(audio_bitrate),
                        "-ac", "2", "-ar", "48000",
                    ])
                else:
                    command.append("-an")
                command.extend(["-movflags", "+faststart", str(temporary)])
                result = subprocess.run(
                    command, capture_output=True, text=True,
                    timeout=max(120, int(source["duration_sec"] * 6)),
                )
                if result.returncode != 0:
                    raise RuntimeError(
                        f"ffmpeg could not build the perceptual review copy: "
                        f"{result.stderr.strip()[:300]}"
                    )
                if temporary.stat().st_size <= PERCEPTUAL_PROXY_MAX_BYTES:
                    os.replace(temporary, proxy)
                    break
            else:
                raise RuntimeError(
                    "perceptual review copy exceeds its 18 MiB transport limit "
                    "after bounded local encoding attempts"
                )
        finally:
            temporary.unlink(missing_ok=True)

    proxy_sha256 = _sha256_file(proxy)
    if not proxy_sha256:
        raise RuntimeError("could not hash perceptual review copy")
    proxy_media = _probe_media(proxy)
    duration_delta = abs(proxy_media["duration_sec"] - source["duration_sec"])
    aspect_delta = abs(
        proxy_media["display_aspect_ratio"] - source["display_aspect_ratio"]
    )
    if duration_delta > 0.15:
        raise RuntimeError("perceptual review copy changed the video duration")
    if aspect_delta > 0.002:
        raise RuntimeError("perceptual review copy changed the video framing")
    if proxy_media["has_audio"] != source["has_audio"]:
        raise RuntimeError("perceptual review copy changed audio-track presence")
    if proxy_media.get("audio_stream_count") != source.get("audio_stream_count"):
        raise RuntimeError("perceptual review copy changed audio-track count")
    manifest = {
        "schema": PERCEPTUAL_TRANSPORT_SCHEMA,
        "status": "ready",
        "source_sha256": exact_sha256,
        "proxy_sha256": proxy_sha256,
        "recipe": recipe,
        "recipe_sha256": recipe_sha256,
        "encoded_video_bitrate": encoded_video_bitrate,
        "ffmpeg": existing.get("ffmpeg", ffmpeg_identity) if reusable else ffmpeg_identity,
        "source": source,
        "proxy": {
            **proxy_media,
            "bytes": proxy.stat().st_size,
            "path": str(proxy.relative_to(job)),
        },
        "duration_delta_sec": round(duration_delta, 6),
        "aspect_delta": round(aspect_delta, 8),
    }
    if not reusable:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8",
            prefix=f".{manifest_path.name}.", suffix=".tmp",
            dir=_stage_dir(snapshots), delete=False,
        ) as opened:
            temporary_manifest = Path(opened.name)
            opened.write(json.dumps(manifest, indent=2))
            opened.flush()
            os.fsync(opened.fileno())
        try:
            os.replace(temporary_manifest, manifest_path)
        finally:
            temporary_manifest.unlink(missing_ok=True)
    try:
        proxy.chmod(0o444)
        manifest_path.chmod(0o444)
    except OSError:
        pass
    return proxy, manifest


# ---------------------------------------------------------------------------
# Declared edits: planned punch-ins, stills, padding and silence
# ---------------------------------------------------------------------------

_STILL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
# Which observation kinds each declared edit explains.
_EXPLAINED_BY = {
    "framing_jump": {"punch_in", "still"},
    "scale_jump": {"punch_in", "still"},
    "unnecessary_camera_padding": {"padding"},
    "long_silence": {"silence", "pre_roll"},
    "unexpected_black": {"pre_roll"},
    # A beat declared to have no words (or the silent pre-roll) is not
    # missing narration.
    "missing_required_narration": {"silence", "pre_roll"},
}
# Model timestamps are coarse: an observation may overrun a declared range by
# this much at either end and still lie inside it.
_EDGE_TOLERANCE_SEC = 0.5
# A looping piece's seam: its first and last this-many seconds.
_LOOP_SEAM_SEC = 0.5


def _finite(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def declared_edits(job: Path) -> list[dict]:
    """Edits the job planned on purpose, placed on the final timeline.

    Sources: the latest render's own log (pre-roll, punch zooms and focus
    tracks it applied), the assembler's chunk_boundaries.json (contained /
    padded shots, punch-ins, stills), timed script chunks with no spoken words,
    explicit ``intentional_silence`` ranges in script.json or promise.json, and
    a script that declares no dialogue at all.
    """
    from _serious_findings import render_facts

    edits: list[dict] = []

    def add(kind: str, start, end, reason: str, offset: float = 0.0) -> None:
        start, end = _finite(start), _finite(end)
        if start is None or end is None or end < start:
            return
        edits.append({"kind": kind, "start_sec": round(start + offset, 3),
                      "end_sec": round(end + offset, 3), "reason": reason})

    facts = render_facts(job)
    pre_roll = facts.get("pre_roll") or 0.0
    if pre_roll > 0:
        add("pre_roll", 0.0, pre_roll, "black and silent pre-roll added by the render")
    transform = facts.get("video_transform") if isinstance(facts.get("video_transform"), dict) else {}
    for zoom in transform.get("punch_zooms") or []:
        if isinstance(zoom, dict) and _finite(zoom.get("at_sec")) is not None:
            half = (_finite(zoom.get("duration_sec")) or 0.4) / 2
            add("punch_in", zoom["at_sec"] - half, zoom["at_sec"] + half, "planned punch zoom", pre_roll)
    focus = transform.get("focus_track")
    if isinstance(focus, list) and focus:
        # A focus track moves the frame at its keyframes, not in between: one
        # declared move per keyframe (keyframes closer than the matching
        # tolerance count once).
        stamps = sorted({stamp for stamp in (_finite(item.get("at_sec")) for item in focus
                                             if isinstance(item, dict)) if stamp is not None})
        previous = None
        for stamp in stamps:
            if previous is None or stamp - previous >= _EDGE_TOLERANCE_SEC:
                add("punch_in", stamp, stamp, "planned focus-track keyframe", pre_roll)
                previous = stamp

    boundaries = _load_json_dict(intent_path(job, "chunk_boundaries.json"))
    for chunk in boundaries.get("chunks") or []:
        if not isinstance(chunk, dict):
            continue
        start, end = chunk.get("start_sec"), chunk.get("end_sec")
        framing = chunk.get("framing") if isinstance(chunk.get("framing"), dict) else {}
        if framing.get("strategy") == "contain_blur" or framing.get("frameMode") == "contain":
            add("padding", start, end, "shot contained with padding on purpose", pre_roll)
        punch = _finite(framing.get("appliedPunch")) or _finite(framing.get("requestedPunch"))
        if punch is not None and punch > 1.0:
            # A static punch reads as a jump at the cuts into and out of it.
            add("punch_in", start, start, f"planned {punch:.2f}x punch-in starts", pre_roll)
            add("punch_in", end, end, f"planned {punch:.2f}x punch-in ends", pre_roll)
        source = chunk.get("beat_source")
        if isinstance(source, str) and Path(source).suffix.lower() in _STILL_SUFFIXES:
            add("still", start, end, "still image with planned motion", pre_roll)

    script = _load_json_dict(intent_path(job, "script.json"))
    for chunk in script.get("chunks") or []:
        if not isinstance(chunk, dict):
            continue
        spoken = any(isinstance(chunk.get(key), str) and chunk[key].strip()
                     for key in ("dialogue", "narration", "text"))
        if not spoken:
            add("silence", chunk.get("start_sec"), chunk.get("end_sec"),
                "timed script beat with no spoken words", pre_roll)
    promise = _load_json_dict(intent_path(job, "promise.json"))
    for holder in (script, promise, promise.get("audio") if isinstance(promise.get("audio"), dict) else {}):
        for item in holder.get("intentional_silence") or [] if isinstance(holder, dict) else []:
            if isinstance(item, dict):
                add("silence", item.get("start_sec"), item.get("end_sec"),
                    str(item.get("reason") or "declared intentional silence")[:120], pre_roll)
    return edits


def apply_declared_edits(final_review: dict, edits: list[dict], *, no_dialogue: bool = False) -> int:
    """Mark observations that a declared edit explains; returns how many.

    A marked issue keeps its place in the report but gains
    ``intentional: true`` and ``declared_edit`` so it is not treated as a
    delivery defect or a beat defect.
    """
    if not isinstance(final_review, dict):
        return 0
    marked = 0
    for section in ("visual_anomalies", "audio", "transition_anomalies"):
        value = final_review.get(section)
        issues = value.get("issues") if isinstance(value, dict) else None
        for issue in issues if isinstance(issues, list) else []:
            if not isinstance(issue, dict):
                continue
            kinds = _EXPLAINED_BY.get(str(issue.get("kind", "")).strip().lower())
            start, end = _finite(issue.get("start_sec")), _finite(issue.get("end_sec"))
            if not kinds or start is None:
                continue
            end = start if end is None or end < start else end
            if no_dialogue and "silence" in kinds:
                issue.update(intentional=True, declared_edit="no dialogue declared")
                marked += 1
                continue
            for edit in edits:
                if edit["kind"] not in kinds:
                    continue
                if edit["kind"] in {"punch_in", "still"}:
                    # A framing change at (or inside) the planned move.
                    hit = (edit["start_sec"] - _EDGE_TOLERANCE_SEC <= start <= edit["end_sec"] + _EDGE_TOLERANCE_SEC)
                else:
                    # Black, silence or missing words must lie inside the
                    # declared range (up to the timestamp tolerance at each
                    # end); a longer stretch is not explained by it.
                    hit = (start >= edit["start_sec"] - _EDGE_TOLERANCE_SEC
                           and end <= edit["end_sec"] + _EDGE_TOLERANCE_SEC)
                if hit:
                    issue.update(intentional=True, declared_edit=edit["reason"])
                    marked += 1
                    break
    return marked


def _declared_edits_context(edits: list[dict]) -> str:
    if not edits:
        return ""
    lines = [f"- {edit['start_sec']:.1f}s-{edit['end_sec']:.1f}s {edit['kind']}: {edit['reason']}"
             for edit in edits[:40]]
    return (
        "\n\nDECLARED EDITS (made on purpose; do not report them as framing jumps, "
        "padding or silence defects):\n" + "\n".join(lines)
    )


def _final_review_context(job: Path) -> str:
    """Bounded job intent appended to the integrated review prompt.

    The full-video pass can only check causal/story and declared style consistency
    when it sees the intended script/arc and style directives. These are evidence,
    not instructions from fetched media.
    """
    try:
        edits_context = _declared_edits_context(declared_edits(job))
    except Exception:
        edits_context = ""
    blocks: list[str] = []
    for name in ("script.json", "style_directives.json", "promise.json"):
        path = intent_path(job, name)
        if not path.exists():
            continue
        try:
            value = json.loads(path.read_text())
            rendered = json.dumps(value, ensure_ascii=False, indent=2)
        except (OSError, json.JSONDecodeError):
            continue
        blocks.append(f"\n## {name}\n{rendered[:12000]}")
    if not blocks:
        return edits_context
    return (
        "\n\nJOB CONTEXT (trusted local production intent; use only to compare "
        "the rendered result against declared words, beat order, and style):"
        + "".join(blocks)
    ) + edits_context


def run_final_review(video: Path, job: Path) -> tuple[dict, str]:
    """Gemini final_review pass on the video WITH audio. Mechanical observations
    only — taste stripped on the way out.

    This is deliberately one provider request. Any refusal, transport failure,
    or malformed response makes QA unavailable; a hidden retry would be a second
    paid pass (and, for the end-of-render review, a second send).
    """
    template = load_template("final_review")
    prompt = template.body + _final_review_context(job)
    print("\n[gemini] final_review pass (video + audio)...")
    raw = ""
    last_err: Exception | None = None
    try:
        raw = analyse_video(
            url=str(video), prompt=prompt, job=job,
            mode_label="final_review", max_output_tokens=template.max_output_tokens,
        )
        review = parse_json_lenient(raw, "final_review")
        return strip_taste(review), "ok"
    except Exception as e:
        last_err = e
        log_event(
            job, tool=TOOL_NAME, event="final_review_attempt_failed",
            response=str(e),
            extra={"provider_calls_started": 1,
                   "error": type(e).__name__, "error_message": str(e)[:300]},
        )
    print(f"  final_review failed after one provider request: "
          f"{type(last_err).__name__ if last_err else 'unknown'}")
    return strip_taste({
        "raw": raw,
        "parse_error": str(last_err)[:300] if last_err else None,
        "vendor_error": str(last_err) if last_err else None,
    }), "failed"


_FULL_REVIEW_SECTIONS = (
    "captions",
    "overlays",
    "audio",
    "lipsync",
    "visual_anomalies",
    "transition_anomalies",
    "style_consistency",
    "story_coherence",
    "structural_observations",
)

_ISSUE_REVIEW_SECTIONS = _FULL_REVIEW_SECTIONS[:-1]


def _structured_review_status(final_review: dict) -> tuple[bool, list[str]]:
    """Validate the actual response shape, not merely section-name presence."""
    def timestamp(value) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0

    errors: list[str] = []
    if not isinstance(final_review, dict):
        return False, ["full-video review is not an object"]
    if final_review.get("parse_error") or final_review.get("raw"):
        errors.append("full-video review did not return parseable structured evidence")
    for section in _ISSUE_REVIEW_SECTIONS:
        value = final_review.get(section)
        if not isinstance(value, dict) or not isinstance(value.get("issues"), list):
            errors.append(f"{section} must contain an issues list")
        elif any(not isinstance(issue, dict) for issue in value["issues"]):
            errors.append(f"{section}.issues contains a non-object entry")
        else:
            for index, issue in enumerate(value["issues"]):
                start, end = issue.get("start_sec"), issue.get("end_sec")
                if not timestamp(start) or not timestamp(end) or end < start:
                    errors.append(
                        f"{section}.issues[{index}] needs valid start_sec/end_sec timestamps"
                    )
                if not isinstance(issue.get("kind"), str) and section != "lipsync":
                    errors.append(f"{section}.issues[{index}].kind must be a string")
                if not isinstance(issue.get("detail"), str):
                    errors.append(f"{section}.issues[{index}].detail must be a string")
    structural = final_review.get("structural_observations")
    if not isinstance(structural, dict):
        errors.append("structural_observations must be an object")
    else:
        for field in ("hook_lands_at_sec", "cta_lands_at_sec"):
            value = structural.get(field)
            if value is not None and not timestamp(value):
                errors.append(f"structural_observations.{field} must be a timestamp or null")
        cuts = structural.get("cut_points_observed")
        if not isinstance(cuts, list) or any(not timestamp(value) for value in cuts):
            errors.append("structural_observations.cut_points_observed must be a timestamp list")
        if not isinstance(structural.get("reference_match_notes"), str):
            errors.append("structural_observations.reference_match_notes must be a string")
    if not _audio_audit_complete(_integrated_audio_audit(final_review)):
        errors.append("audio must contain complete integrated technical evidence")
    return not errors, errors


_HARD_DELIVERY_ISSUE_TERMS = (
    "caption missing", "missing caption", "uncaptioned", "caption gap",
    "clipped", "cropped out", "cut off", "off screen",
    "red zone", "red_zone", "safe zone", "safe_zone",
    "covers face", "covering face", "blocks face", "obscured face",
    "face obscured", "subject obscured", "subject out of frame",
    "framing jump", "unnecessary camera padding", "off center card",
    "floating card", "crop center", "scale jump",
    "bg music too loud", "background music too loud", "music too loud",
    "music competes", "music competing", "competes with the speaker",
    "competes with dialogue", "dialogue hard to understand",
)

_HARD_DELIVERY_KINDS = {
    "captions": {
        "unreadable_contrast", "text_off_screen", "text_clipped", "text_overlap",
        "mistimed_with_audio", "wrong_word", "missing_word", "filler_word",
    },
    "overlays": {
        "covers_face", "covers_subject", "text_off_screen", "text_clipped",
        "red_zone_collision", "unreadable_contrast", "wrong_text",
    },
    "audio": {
        "long_silence", "jumbled_words", "dialogue_audio_mismatch", "dropout",
        "clipping", "bg_music_too_loud", "beat_sync_mismatch",
    },
    "visual_anomalies": {
        "deformed_anatomy", "extra_fingers", "identity_drift", "framing_collapse",
        "framing_jump", "unnecessary_camera_padding", "off_center_card",
        "subject_clipped", "subject_off_center", "face_obscured", "background_glitch",
        "broll_context_mismatch", "broll_era_mismatch", "broll_emotion_mismatch",
        "broll_subject_off_center",
    },
    "transition_anomalies": {
        "leftover_element", "half_transition", "seam_flash", "body_crop",
    },
}


def hard_delivery_review_issues(
    final_review: dict,
    delivery_safety: dict | None = None,
    claim_checks: dict | None = None,
) -> list[dict]:
    """Return only non-waivable delivery defects seen by the full-video pass.

    Typography taste, pacing, and composition style remain advisory. This
    narrow classifier supplements deterministic geometry for defects that need
    semantic video understanding, such as an already-cropped person.
    """
    blockers: list[dict] = []
    caption_contract = (
        delivery_safety.get("captionContract")
        if isinstance(delivery_safety, dict) else None
    )
    captions_required = bool(
        isinstance(caption_contract, dict) and caption_contract.get("required") is True
    )
    for section in (
        "captions", "overlays", "audio", "visual_anomalies", "transition_anomalies",
    ):
        issues = (final_review.get(section) or {}).get("issues", [])
        for index, issue in enumerate(issues if isinstance(issues, list) else []):
            if not isinstance(issue, dict) or _is_advisory_claim(claim_checks, section, index):
                continue
            if issue.get("declared_edit"):
                continue
            if section == "captions" and not captions_required:
                continue
            kind = str(issue.get("kind", "")).strip().lower()
            structured_blocker = kind in _HARD_DELIVERY_KINDS.get(section, set())
            text = " ".join(str(issue.get(key, "")) for key in ("kind", "detail", "text"))
            text = text.lower().replace("_", "-").replace("-", " ")
            if structured_blocker or any(term in text for term in _HARD_DELIVERY_ISSUE_TERMS):
                blockers.append({"section": section, **issue})
    return blockers


def classify_qa_outcome(
    *, qa_complete: bool, delivery_safety: dict | None, final_review: dict,
    claim_checks: dict | None = None,
) -> tuple[str, list[dict]]:
    """Separate check execution from the final content result."""
    blockers = hard_delivery_review_issues(final_review, delivery_safety, claim_checks)
    delivery_status = (
        delivery_safety.get("status") if isinstance(delivery_safety, dict) else None
    )
    if not qa_complete or delivery_status in (None, DELIVERY_QA_UNAVAILABLE):
        return DELIVERY_QA_UNAVAILABLE, blockers
    if delivery_status == DELIVERY_CONTENT_FAIL or blockers:
        return DELIVERY_CONTENT_FAIL, blockers
    return DELIVERY_PASS, blockers


def _current_assembled_beats(job: Path, video: Path) -> list[dict]:
    """Read durable beat intent for the latest completed, content-bound assembly."""
    if load_script(job).get("on_screen_text"):
        return []
    events = [event for event in read_events(job) if event.get("tool") == "assemble.py"]
    if not events or events[-1].get("event") != "timeline_assembled":
        return []
    timeline = events[-1]
    count = timeline.get("beats")
    if not isinstance(count, int) or isinstance(count, bool) or count <= 0 or len(events) <= count:
        return []
    beats = events[-count - 1:-1]
    if any(beat.get("event") != "beat_assembled" for beat in beats):
        return []
    try:
        assembled = _job_file(job, timeline.get("output"))
        digest = timeline.get("output_sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or _sha256_file(assembled) != digest:
            return []
        final_digest = _sha256_file(video)
        if final_digest != digest:
            manifest = _load_json_dict(intent_path(job, "render-manifest.json"))
            unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
            durations = (manifest["source"]["durationSec"], manifest["output"]["durationSec"])
            # Pre-roll shifts cuts; later B-roll can replace the intended cut.
            # Unknown timing stays advisory rather than guessing an offset.
            if (manifest.get("postComposeBroll")
                    or not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                               and math.isfinite(value) and value > 0 for value in durations)
                    or abs(durations[0] - durations[1]) > 1 / 24):
                return []
            if (manifest.get("schema") != RENDER_MANIFEST_SCHEMA
                    or manifest.get("manifestSha256") != canonical_sha256(unsigned)
                    or manifest["source"]["sha256"] != digest
                    or _job_file(job, manifest["source"]["path"]) != assembled
                    or manifest["output"]["sha256"] != final_digest
                    or _sha256_file(_job_file(job, manifest["output"]["path"])) != final_digest):
                return []
    except (KeyError, TypeError, ValueError, OSError):
        return []
    return [{"start_sec": beat.get("start_sec"), "end_sec": beat.get("end_sec"),
             "role": beat.get("usage_role"), "beat_source": beat.get("source")} for beat in beats]


def _declared_footage_change(chunks: list[dict], start: float, end: float) -> float | None:
    """Unknown intent and still/title beats cannot prove an unintended visual stall."""
    cursor, previous_source, boundary = start, None, None
    for chunk in chunks:
        if not isinstance(chunk, dict):
            return None
        left, right = chunk.get("start_sec"), chunk.get("end_sec")
        if not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                   for t in (left, right)) or right <= left:
            return None
        if right <= start or left >= end:
            continue
        source = chunk.get("beat_source")
        if (left > cursor + 0.01 or chunk.get("role") not in {"face", "aroll", "broll", "talking_head"}
                or not isinstance(source, str) or Path(source).suffix.lower() not in {".mp4", ".mov", ".webm", ".mkv", ".m4v"}):
            return None
        if previous_source is not None and source != previous_source and boundary is None:
            boundary = left
        previous_source = source
        cursor = max(cursor, right)
    # Two different footage sources are a declared visual change. A single
    # shot could intentionally hold; missing coverage or intent stays advisory.
    return boundary if cursor >= end - 0.01 else None


_SPEAKING_ROLES = {"face", "aroll", "talking_head"}


def _declared_speaking_footage(chunks: list[dict], start: float, end: float) -> bool:
    """Is [start, end] entirely inside moving footage of a person speaking?

    Only there is a frozen picture never a creative hold: stills, text-led
    pieces and B-roll (a static screen recording, a held landscape) are left
    alone.
    """
    cursor = start
    for chunk in chunks:
        if not isinstance(chunk, dict):
            return False
        left, right = chunk.get("start_sec"), chunk.get("end_sec")
        if not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                   for t in (left, right)) or right <= left:
            return False
        if right <= start or left >= end:
            continue
        source = chunk.get("beat_source")
        if (left > cursor + 0.01 or chunk.get("role") not in _SPEAKING_ROLES
                or not isinstance(source, str)
                or Path(source).suffix.lower() not in {".mp4", ".mov", ".webm", ".mkv", ".m4v"}):
            return False
        cursor = max(cursor, right)
    return cursor >= end - 0.01


def visual_candidate_outcomes(
    video: Path, final_review: dict, duration_sec: float, job: Path,
    gaps: list[str] | None = None,
) -> dict[int, str]:
    """Ground sampled-model black/freeze claims in original pixels, without a paid retry.

    A black or frozen stretch is confirmed where it straddles a declared cut
    between two footage sources. A frozen stretch is also confirmed inside a
    single declared shot of a person speaking. In a declared seamless loop,
    the loop seam (the first and last ``_LOOP_SEAM_SEC``) is a planned hold:
    that part of a stretch is left out and the rest of it is judged.

    ``confirmed`` and ``not_confirmed`` are conclusive detector results;
    ``no_declared_change`` means no authored cut or speaking shot exists to
    test against. Candidates the bounded check skipped or could not run have
    no entry.
    """
    section = final_review.get("visual_anomalies")
    issues = section.get("issues", []) if isinstance(section, dict) else []
    checked = 0
    outcomes: dict[int, str] = {}
    loop = declares_loop(job)
    chunks = _current_assembled_beats(job, video)
    for index, issue in enumerate(issues if isinstance(issues, list) else []):
        if not isinstance(issue, dict):
            continue
        kind = issue.get("kind")
        if kind not in {"unexpected_black", "unexpected_freeze"} or issue.get("intentional") is not False:
            continue
        start, end = issue.get("start_sec"), issue.get("end_sec")
        if not all(isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                   for t in (start, end, duration_sec)) or not 0 <= start < end <= duration_sec + 0.15:
            continue
        if loop:
            # Only the seam portion is excused; the rest is verified.
            start, end = max(start, _LOOP_SEAM_SEC), min(end, duration_sec - _LOOP_SEAM_SEC)
        minimum = min(3.0, max(1.0, duration_sec * 0.25))
        if end - start < minimum:
            continue
        boundary = _declared_footage_change(chunks, start, end)
        if boundary is None and not (
            kind == "unexpected_freeze" and _declared_speaking_footage(chunks, start, end)
        ):
            outcomes[index] = "no_declared_change"
            continue
        if checked >= 8:
            continue
        checked += 1
        # ponytail: bounded local confirmation of eight candidates; additional
        # candidates remain visible warnings rather than extending the QA turn.
        if boundary is None:
            window_start = start
            span = min(end, duration_sec) - start
        else:
            window_start = max(start, boundary - 5.0)
            span = min(end, duration_sec, boundary + 5.0) - window_start
        filter_arg = (f"blackdetect=d={minimum - 0.15}:pix_th=0.02:pic_th=0.98"
                      if kind == "unexpected_black" else f"freezedetect=n=-50dB:d={minimum - 0.15}")
        try:
            result = subprocess.run(
                ["ffmpeg", "-nostdin", "-hide_banner", "-ss", str(window_start), "-i", str(video),
                 "-t", str(span), "-an", "-vf",
                 f"trim=duration={span},setpts=PTS-STARTPTS,{filter_arg}", "-f", "null", "-"],
                capture_output=True, text=True, timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            if gaps is not None:
                gaps.append(f"candidate {index}: {type(exc).__name__}")
            continue
        if result.returncode != 0:
            if gaps is not None:
                gaps.append(f"candidate {index}: ffmpeg exited {result.returncode}")
            continue
        # A static shot before a real cut is valid. The confirmed interval must
        # itself straddle the declared cut, not merely occur somewhere nearby.
        marker = "black" if kind == "unexpected_black" else "freeze"
        intervals, opened = [], None
        for event, value in re.findall(rf"\b{marker}_(start|end):\s*(-?\d+(?:\.\d+)?)", result.stderr):
            if event == "start":
                opened = float(value)
            elif opened is not None:
                intervals.append((opened, min(float(value), span)))
                opened = None
        if opened is not None:
            intervals.append((opened, span))
        if boundary is None:
            # Inside one speaking shot: the freeze itself must be sustained.
            confirmed = any(right - left >= minimum - 0.15 for left, right in intervals)
        else:
            cut = boundary - window_start
            confirmed = any(left < cut - 0.15 and right > cut + 0.15 and right - left >= minimum - 0.15
                            for left, right in intervals)
        outcomes[index] = "confirmed" if confirmed else "not_confirmed"
    return outcomes


def verify_severe_visual_candidates(
    video: Path, final_review: dict, duration_sec: float, job: Path,
    gaps: list[str] | None = None,
) -> set[int]:
    outcomes = visual_candidate_outcomes(video, final_review, duration_sec, job, gaps=gaps)
    return {index for index, outcome in outcomes.items() if outcome == "confirmed"}


_SOURCE_VERIFIED_VISUAL_KINDS = {"unexpected_black", "unexpected_freeze"}
_TRANSCRIPT_GROUNDED_KINDS = {("captions", "wrong_word"), ("audio", "dialogue_audio_mismatch")}
_QUOTED_PHRASE_RE = re.compile(r"(?<!\w)['\"‘“]([^'\"‘’“”\n]{1,80}?)['\"’”](?!\w)")
_TRANSCRIPT_WINDOW_SEC = 1.0


def _finite_time(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _phrase_count(words: list[str], phrase: list[str]) -> int:
    return sum(words[i:i + len(phrase)] == phrase for i in range(len(words) - len(phrase) + 1))


def _contains_phrase(words: list[str], phrase: list[str]) -> bool:
    return _phrase_count(words, phrase) > 0


def _captions_rendered_from_transcript(job: Path, video: Path) -> bool:
    """These exact bytes came from a canonical captioned render of the current transcript.json.

    Pre-roll shifts the finished timeline after captions are drawn, so its
    transcript times no longer match the reviewed video. A render without a
    recorded transcript digest cannot prove which transcript it captioned.
    """
    events = [event for event in read_events(job) if (
        event.get("tool") == "compose_render.py"
        and event.get("event") in {"render_started", "render_completed", "render_failed"}
    )]
    if len(events) < 2:
        return False
    started, completed = events[-2:]
    transcript_sha256 = started.get("transcript_sha256")
    return (
        started.get("event") == "render_started"
        and completed.get("event") == "render_completed"
        and started.get("usage_role") in {"render", "retrofit"}
        and started.get("show_captions") is True
        and completed.get("show_captions") is True
        and not started.get("pre_roll")
        and completed.get("output_sha256") == _sha256_file(video)
        and isinstance(transcript_sha256, str)
        and re.fullmatch(r"[0-9a-f]{64}", transcript_sha256) is not None
        and completed.get("transcript_sha256") == transcript_sha256
        and _sha256_file(job / "transcript.json") == transcript_sha256
    )


def _trusted_transcript_words(job: Path, video: Path) -> list[tuple[str, float, float]]:
    """Word-timed transcript.json that captioned these exact bytes on their timeline."""
    if not _captions_rendered_from_transcript(job, video):
        return []
    rows: list[tuple[str, float, float]] = []
    words = load_transcript(job).get("words")
    for word in words if isinstance(words, list) else []:
        start, end = (word.get("start"), word.get("end")) if isinstance(word, dict) else (None, None)
        text = word.get("word") or word.get("text")
        if not (_finite_time(start) and _finite_time(end)) or end < start or not isinstance(text, str):
            return []
        rows.extend((token, start, end) for token in _normalize_words(text))
    return [] if rows and rows[0][0] == "placeholder" else rows


def _script_words_near(script: dict, start: float, end: float) -> list[str]:
    """Words of the spoken script chunks overlapping the claim window.

    Without timing on every spoken chunk the whole script is used, which can
    only make a contradiction harder to reach.
    """
    spoken = _spoken_chunks(script) or []
    near: list[str] = []
    for chunk, text in spoken:
        left, right = chunk.get("start_sec", chunk.get("start")), chunk.get("end_sec", chunk.get("end"))
        if not (_finite_time(left) and _finite_time(right)) or right < left:
            return _normalize_words(_script_spoken_text(script) or "")
        if right >= start - _TRANSCRIPT_WINDOW_SEC and left <= end + _TRANSCRIPT_WINDOW_SEC:
            near.append(text)
    return _normalize_words(" ".join(near) if spoken else _script_spoken_text(script) or "")


def _ground_wording_claim(
    issue: dict, script: dict, transcript: list[tuple[str, float, float]],
) -> dict | None:
    """Check a quoted wrong-word claim against the job transcript at the claimed time.

    Quoted phrases found in the script around that time are the expected
    words; the rest are what the reviewer says was heard or shown instead.
    Both are compared with the transcript words in the same window; a claimed
    phrase spoken anywhere more often than scripted blocks a contradiction,
    since the reviewer's timestamp may have drifted onto a correct occurrence.
    Only a claim that names what was heard or shown instead can be contradicted.
    """
    start, end = issue.get("start_sec"), issue.get("end_sec")
    if not (_finite_time(start) and _finite_time(end)):
        return None
    script_words = _script_words_near(script, start, end)
    if not script_words:
        return None
    quoted = _QUOTED_PHRASE_RE.findall(str(issue.get("detail") or ""))
    phrases = [p for p in map(_normalize_words, [*quoted, str(issue.get("text") or "")]) if p]
    expected = [p for p in phrases if _contains_phrase(script_words, p)]
    claimed = [p for p in phrases if p not in expected]
    window = [token for token, left, right in transcript
              if right >= start - _TRANSCRIPT_WINDOW_SEC and left <= end + _TRANSCRIPT_WINDOW_SEC]
    near = f"near {start:g}–{end:g}s"
    heard = next((p for p in claimed if _contains_phrase(window, p)), None)
    if heard:
        return {"verification": "verified",
                "evidence": f"transcript.json also has '{' '.join(heard)}' {near}"}
    everywhere = [token for token, _, _ in transcript]
    whole_script = _normalize_words(_script_spoken_text(script) or "")
    if any(_phrase_count(everywhere, p) > _phrase_count(whole_script, p) for p in claimed):
        return None
    if claimed and expected and all(_contains_phrase(window, p) for p in expected):
        return {"verification": "contradicted",
                "evidence": f"transcript.json has the scripted '{' '.join(expected[0])}' {near}"
                            + (f", not '{' '.join(claimed[0])}'" if claimed else "")}
    return None


_VISUAL_CHECKS = {
    "confirmed": {"verification": "verified",
                  "evidence": "exact-source pixels stall across a declared footage change"},
    "not_confirmed": {"verification": "unverified",
                      "evidence": "exact-source pixels show no stall across the declared footage change"},
    "no_declared_change": {"verification": "unverified",
                           "evidence": "no declared footage change, so exact-source pixels cannot "
                                       "establish an unintended stall"},
}


def ground_review_claims(
    final_review: dict, job: Path, video: Path, visual_outcomes: dict[int, str],
) -> dict[tuple[str, int], dict]:
    """Attach deterministic verification to model claims that have a bounded check.

    Claims without an entry stay ordinary model observations. ``contradicted``
    and ``unverified`` claims remain visible but are not mechanical defects.
    """
    checks: dict[tuple[str, int], dict] = {}
    script = load_script(job)
    transcript = _trusted_transcript_words(job, video)
    for section in ("captions", "audio", "visual_anomalies"):
        value = final_review.get(section) if isinstance(final_review, dict) else None
        issues = value.get("issues", []) if isinstance(value, dict) else []
        for index, issue in enumerate(issues if isinstance(issues, list) else []):
            if not isinstance(issue, dict):
                continue
            kind = str(issue.get("kind", "")).strip().lower()
            if section == "visual_anomalies" and kind in _SOURCE_VERIFIED_VISUAL_KINDS:
                if visual_outcomes.get(index) in _VISUAL_CHECKS:
                    checks[(section, index)] = dict(_VISUAL_CHECKS[visual_outcomes[index]])
            elif (section, kind) in _TRANSCRIPT_GROUNDED_KINDS and transcript:
                result = _ground_wording_claim(issue, script, transcript)
                if result:
                    checks[(section, index)] = result
    return checks


def _draft_issue(section: str, issue: dict, check: dict | None = None) -> dict:
    """Copy only the public finding fields, never model-authored authority keys."""
    kind = str(issue.get("kind") or section).strip() or section
    result = {"section": section, "kind": kind,
              "detail": str(issue.get("detail") or "").strip() or kind.replace("_", " ")}
    if check:
        result.update(verification=check["verification"], verification_evidence=check["evidence"])
    for key in ("start_sec", "end_sec"):
        value = issue.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            result[key] = value
    if isinstance(issue.get("intentional"), bool):
        result["intentional"] = issue["intentional"]
    if isinstance(issue.get("text"), str) and issue["text"].strip():
        result["text"] = issue["text"].strip()[:500]
        if not str(issue.get("detail") or "").strip():
            result["detail"] += ": " + result["text"]
    return result


def draft_delivery_issues(
    final_review: dict, delivery_safety: dict | None, audio_audit: dict,
    fidelity: dict, text_audit: dict, *, duration_sec: float,
    narration_required: bool,
    verified_visual_candidates: set[int] | frozenset[int] = frozenset(),
    claim_checks: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """Keep observations visible; reserve repair for sustained unusable content."""
    blocking: list[dict] = []
    warnings: list[dict] = []
    caption_contract = (delivery_safety or {}).get("captionContract") or {}
    severe_kinds = {
        "visual_anomalies": {"unexpected_black", "unexpected_freeze"},
        "audio": {"missing_required_narration", "unintelligible_required_narration"},
    }
    for section in _ISSUE_REVIEW_SECTIONS:
        value = final_review.get(section)
        issues = value.get("issues", []) if isinstance(value, dict) else []
        for index, issue in enumerate(issues if isinstance(issues, list) else []):
            if not isinstance(issue, dict):
                continue
            if section == "captions" and caption_contract.get("required") is False and issue.get("kind") == "missing_word":
                continue
            start, end = issue.get("start_sec"), issue.get("end_sec")
            timed = all(
                isinstance(t, (int, float)) and not isinstance(t, bool) and math.isfinite(t)
                for t in (start, end)
            )
            severe = (
                issue.get("kind") in severe_kinds.get(section, set())
                and issue.get("intentional") is False
                and timed and math.isfinite(duration_sec) and duration_sec > 0
                and 0 <= start < end <= duration_sec + 0.15
                and end - start >= min(3.0, max(1.0, duration_sec * 0.25))
                and (section != "audio" or narration_required)
                and (section != "visual_anomalies" or index in verified_visual_candidates)
            )
            (blocking if severe else warnings).append(
                _draft_issue(section, issue, (claim_checks or {}).get((section, index))))

    for issue in (delivery_safety or {}).get("violations", []):
        if isinstance(issue, dict):
            finding = _draft_issue("delivery_safety", issue)
            timestamp = issue.get("timestampSec")
            if isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool) and math.isfinite(timestamp):
                finding.update(start_sec=timestamp, end_sec=timestamp)
            warnings.append(finding)
    for reason in audio_audit.get("grounding_failures", []):
        if isinstance(reason, str) and reason.strip():
            warnings.append({"section": "audio", "kind": "audio_grounding", "detail": reason})
    for field in ("voice_band_collision_flags", "dead_air_flags", "clipping_or_dropout_flags",
                  "bg_music_too_loud_flags", "engineer_flags"):
        for detail in audio_audit.get(field, []):
            if isinstance(detail, str) and detail.strip() and not detail.startswith("BED_GROUNDING:"):
                warnings.append({"section": "audio", "kind": field, "detail": detail})
    for field in ("in_script_missing_from_captions", "in_captions_not_in_script"):
        words = fidelity.get(field)
        if isinstance(words, list) and words:
            warnings.append({"section": "captions", "kind": field,
                             "detail": ", ".join(str(word) for word in words)})
    for flag in text_audit.get("flags", []):
        if isinstance(flag, dict):
            warnings.append(_draft_issue("on_screen_text", flag))
    return blocking, warnings


def _audio_audit_complete(audio_audit: dict) -> bool:
    list_fields = (
        "voice_band_collision_flags",
        "dead_air_flags",
        "clipping_or_dropout_flags",
        "bg_music_too_loud_flags",
        "engineer_flags",
    )
    return (
        isinstance(audio_audit, dict)
        and not audio_audit.get("error")
        and isinstance(audio_audit.get("voice_present"), bool)
        and isinstance(audio_audit.get("music_bed_present"), bool)
        and isinstance(audio_audit.get("vocals_in_bed_detected"), bool)
        and all(isinstance(audio_audit.get(field), list) for field in list_fields)
    )


def _integrated_audio_audit(final_review: dict) -> dict:
    """Project technical audio fields from the one paid full-video review."""
    audio = final_review.get("audio") if isinstance(final_review, dict) else None
    if not isinstance(audio, dict):
        return {"error": "full-video review has no audio evidence"}
    fields = (
        "voice_present",
        "music_bed_present",
        "vocals_in_bed_detected",
        "voice_band_collision_flags",
        "dead_air_flags",
        "clipping_or_dropout_flags",
        "bg_music_too_loud_flags",
        "engineer_flags",
    )
    result = {field: audio.get(field) for field in fields}
    if not _audio_audit_complete(result):
        return {"error": "full-video review returned incomplete technical audio evidence"}
    return result


def build_qa_evidence(
    *,
    input_sha256: str | None,
    final_sha256: str | None,
    snapshot_input_sha256: str | None,
    snapshot_final_sha256: str | None,
    final_review_status: str,
    audio_audit_status: str,
    final_review: dict,
    audio_audit: dict,
    fidelity: dict,
    text_audit: dict,
    frame_verifications: list[dict],
    skip_audio: bool,
    skip_frame_verify: bool,
    delivery_safety: dict | None = None,
    perceptual_transport: dict | None = None,
    duration_sec: float = 0,
    narration_required: bool = False,
    verified_visual_candidates: set[int] | frozenset[int] = frozenset(),
    claim_checks: dict | None = None,
    sub_checks: dict | None = None,
) -> dict:
    """Describe whether the integrated final-QA execution itself completed.

    This does not turn observations into a ship verdict. It records that the
    canonical checks ran on a stable render snapshot, and names any execution
    gap so qa_gate need not rely on an agent's prose claim. Because the record is
    workspace-writable, it is execution evidence at an honor boundary—not an
    unforgeable attestation.
    """
    reasons: list[str] = []
    review_structured, review_errors = _structured_review_status(final_review)
    reasons.extend(review_errors)
    review_ok = final_review_status == "ok" and review_structured
    if final_review_status != "ok":
        reasons.append(f"full-video review status is {final_review_status!r}")

    audio_ok = (
        not skip_audio
        and (audio_audit_status == "ok" or (
            audio_audit_status == "failed" and bool(audio_audit.get("grounding_failures"))
        ))
        and _audio_audit_complete(audio_audit)
    )
    if skip_audio:
        reasons.append("integrated audio audit was skipped")
    elif not audio_ok and audio_audit_status != "ok":
        reasons.append(f"integrated audio audit status is {audio_audit_status!r}")
    elif not audio_ok:
        reasons.append("integrated audio audit failed")

    fidelity_ok = isinstance(fidelity, dict) and (
        fidelity.get("available") is True
        or (
            fidelity.get("available") is False
            and fidelity.get("applicable") is False
            and isinstance(fidelity.get("reason"), str)
        )
    )
    if not fidelity_ok:
        reasons.append("caption/script fidelity check did not complete")

    audit_ok = (
        isinstance(text_audit, dict)
        and isinstance(text_audit.get("flags"), list)
        and all(isinstance(flag, dict) for flag in text_audit.get("flags", []))
    )
    if not audit_ok:
        reasons.append("on-screen text audit did not return a flags list")
    expected_verifications = [
        flag for flag in (text_audit.get("flags", []) if isinstance(text_audit, dict) else [])
        if isinstance(flag, dict) and flag.get("start_sec") is not None
    ]
    verification_ok = not skip_frame_verify and audit_ok
    if skip_frame_verify:
        reasons.append("local frame evidence was skipped")
    elif audit_ok and any(flag.get("start_sec") is None for flag in text_audit["flags"]):
        verification_ok = False
        reasons.append("one or more text candidates has no evidence timestamp")
    elif len(frame_verifications) != len(expected_verifications):
        verification_ok = False
        reasons.append("not every timestamped text candidate received frame evidence")
    elif any(
        item.get("error")
        or not isinstance(item.get("frame"), str)
        or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("frame_sha256", "")))
        or item.get("source_sha256") != snapshot_input_sha256
        for item in frame_verifications
    ):
        verification_ok = False
        reasons.append("one or more local frame evidence records failed schema validation")

    stable_input = (
        bool(input_sha256)
        and input_sha256 == final_sha256
        and input_sha256 == snapshot_input_sha256
        and snapshot_input_sha256 == snapshot_final_sha256
    )
    if not all((input_sha256, final_sha256, snapshot_input_sha256, snapshot_final_sha256)):
        reasons.append("could not hash source render and immutable QA snapshot")
    elif input_sha256 != final_sha256:
        reasons.append("source render changed while final QA was running")
    elif input_sha256 != snapshot_input_sha256:
        reasons.append("QA snapshot did not match the source render at start")
    elif snapshot_input_sha256 != snapshot_final_sha256:
        reasons.append("QA snapshot changed while final QA was running")

    # delivery_safety names the checks that did NOT execute on this render's
    # canvas in `checksSkipped` (today: the platform red-zone tables, authored
    # for 9:16 only). Its `status` deliberately excludes them, so a PASS there
    # is only a pass over the checks that ran — reading it alone would report a
    # 16:9 render whose platform-chrome check never executed as fully covered.
    # A receipt written before that field existed omits it, so only a non-empty
    # list counts as a skip; anything else keeps the pre-existing behaviour.
    raw_skipped = (
        delivery_safety.get("checksSkipped") if isinstance(delivery_safety, dict) else None
    )
    delivery_skipped = (
        [str(name) for name in raw_skipped] if isinstance(raw_skipped, list) else []
    )
    delivery_complete = (
        isinstance(delivery_safety, dict)
        and delivery_safety.get("status") in (DELIVERY_PASS, DELIVERY_CONTENT_FAIL)
        and delivery_safety.get("renderSha256") == final_sha256
        and not delivery_skipped
    )
    if not isinstance(delivery_safety, dict):
        reasons.append("delivery safety did not run")
    elif delivery_safety.get("renderSha256") != final_sha256:
        reasons.append("delivery safety inspected different render bytes")
    elif delivery_safety.get("status") == DELIVERY_QA_UNAVAILABLE:
        reasons.append(
            f"delivery safety status is {delivery_safety.get('status')!r}"
        )
    elif delivery_safety.get("status") not in (DELIVERY_PASS, DELIVERY_CONTENT_FAIL):
        reasons.append(f"delivery safety returned an unknown status {delivery_safety.get('status')!r}")
    if delivery_skipped:
        # Carry the tool's own wording so the evidence says which coverage is
        # missing and why, rather than leaving a bare flag for a reader to
        # interpret. This is an execution gap, not a content verdict: it lands
        # in `reasons`, which makes the outcome QA_UNAVAILABLE, never a
        # CONTENT_FAIL an unsupported aspect did nothing to earn.
        zone_check = delivery_safety.get("redZoneCheck")
        zone_reason = zone_check.get("reason") if isinstance(zone_check, dict) else None
        detail = f" ({zone_reason.strip()})" if isinstance(zone_reason, str) and zone_reason.strip() else ""
        reasons.append(
            "delivery safety could not check "
            f"{', '.join(delivery_skipped)} on this canvas{detail}"
        )

    try:
        duration_delta = float(
            perceptual_transport.get("duration_delta_sec", math.inf)
            if isinstance(perceptual_transport, dict) else math.inf
        )
        aspect_delta = float(
            perceptual_transport.get("aspect_delta", math.inf)
            if isinstance(perceptual_transport, dict) else math.inf
        )
    except (TypeError, ValueError):
        duration_delta = math.inf
        aspect_delta = math.inf
    transport_complete = (
        isinstance(perceptual_transport, dict)
        and perceptual_transport.get("schema") == PERCEPTUAL_TRANSPORT_SCHEMA
        and perceptual_transport.get("status") == "ready"
        and perceptual_transport.get("source_sha256") == snapshot_input_sha256
        and bool(perceptual_transport.get("proxy_sha256"))
        and perceptual_transport.get("proxy_sha256")
        == perceptual_transport.get("proxy_final_sha256")
        and bool(perceptual_transport.get("recipe_sha256"))
        and math.isfinite(duration_delta)
        and 0 <= duration_delta <= 0.15
        and math.isfinite(aspect_delta)
        and 0 <= aspect_delta <= 0.002
    )
    if not isinstance(perceptual_transport, dict):
        reasons.append("perceptual review transport did not run")
    elif perceptual_transport.get("status") != "ready":
        reasons.append(
            "perceptual review transport is unavailable: "
            f"{perceptual_transport.get('error', 'unknown error')}"
        )
    elif perceptual_transport.get("source_sha256") != snapshot_input_sha256:
        reasons.append("perceptual review copy is not bound to the exact QA snapshot")
    elif perceptual_transport.get("proxy_sha256") != perceptual_transport.get(
            "proxy_final_sha256"):
        reasons.append("perceptual review copy changed while final QA was running")
    elif not transport_complete:
        reasons.append("perceptual review transport failed integrity validation")

    # A step that was skipped is an execution gap even when its fallback left
    # plausible-looking data behind (an empty flag list, a partial overlay set).
    for name, state in sorted((sub_checks or {}).items()):
        if isinstance(state, dict) and state.get("status") == "skipped":
            reasons.append(f"{name} did not complete: {state.get('reason') or 'skipped'}")

    checks = {
        "stable_render_snapshot": stable_input,
        "full_video_mechanical": review_ok,
        "integrated_audio": audio_ok,
        "caption_script_fidelity": fidelity_ok,
        "candidate_frame_evidence": verification_ok,
        "delivery_safety": delivery_complete,
        "perceptual_transport": transport_complete,
    }
    evidence = {
        "schema": QA_EVIDENCE_SCHEMA,
        "mode": "full",
        "final_review_status": final_review_status,
        "audio_audit_status": audio_audit_status,
        "input_sha256": input_sha256,
        "final_sha256": final_sha256,
        "snapshot_input_sha256": snapshot_input_sha256,
        "snapshot_final_sha256": snapshot_final_sha256,
        "delivery_safety_status": (
            delivery_safety.get("status") if isinstance(delivery_safety, dict) else None
        ),
        # Additive alongside the status so a reader can see what that status
        # does not cover. QA_EVIDENCE_SCHEMA stays at v5: qa_gate pins the
        # string, and bumping it would invalidate receipts already on disk.
        "delivery_safety_checks_skipped": delivery_skipped,
        "perceptual_transport": perceptual_transport,
        "qa_complete": bool(final_sha256) and all(checks.values()) and not reasons,
        "checks": checks,
        "incomplete_reasons": reasons,
        "completed_at": time.time(),
    }
    outcome, blockers = classify_qa_outcome(
        qa_complete=evidence["qa_complete"],
        delivery_safety=delivery_safety,
        final_review=final_review,
        claim_checks=claim_checks,
    )
    evidence["qa_outcome"] = outcome
    evidence["hard_delivery_issues"] = blockers
    severe, warnings = draft_delivery_issues(
        final_review, delivery_safety, audio_audit, fidelity, text_audit,
        duration_sec=duration_sec, narration_required=narration_required,
        verified_visual_candidates=verified_visual_candidates, claim_checks=claim_checks,
    )
    evidence.update({
        "delivery_policy": "draft-first/v1",
        "blocking_issues": severe,
        "warning_issues": warnings,
    })
    # Preserve legacy advisory behavior; policy-aware apps separately consume
    # warning_issues without minting a clean receipt. Incomplete QA never passes.
    if evidence["qa_complete"] and severe:
        evidence["qa_outcome"] = DELIVERY_CONTENT_FAIL
    return evidence


def _sub_check(sub_checks: dict, name: str, job: Path, fn, fallback):
    """Run one sub-check; a crash marks it skipped instead of ending the review."""
    try:
        return fn()
    except Exception as exc:
        reason = f"{type(exc).__name__}: {str(exc)[:200]}"
        sub_checks[name] = {"status": "skipped", "reason": reason}
        log_event(job, tool=TOOL_NAME, event="sub_check_skipped",
                  extra={"check": name, "reason": reason})
        return fallback


def _mark(sub_checks: dict, name: str, status: str, reason: str | None = None) -> None:
    if name not in sub_checks:
        sub_checks[name] = {"status": status, **({"reason": reason} if reason else {})}


def _in_job(job: Path, path: Path) -> str:
    return str(path.relative_to(job)) if path.is_relative_to(job) else str(path)


def mode_full(args, job: Path) -> int:
    harness = harness_child()
    # The end-of-render review writes its report, markdown, frames and
    # delivery-safety receipt only into its own invocation folder (the folder
    # of ``report_path``); the job's shared review files belong to explicit
    # reviews. Every report file is replaced atomically, never left partial.
    report_path = getattr(args, "report_path", None)
    own_dir = Path(report_path).parent if report_path else None
    source_video = resolve_video(job, args.video)
    input_sha256 = _sha256_file(source_video)
    video, snapshot_input_sha256 = _prepare_review_snapshot(source_video, job, input_sha256)
    # The end-of-render review names the exact bytes it was asked about; if
    # the file no longer holds them, there is nothing to review.
    expected_sha256 = getattr(args, "expect_sha256", None)
    if expected_sha256 and not (input_sha256 == snapshot_input_sha256 == expected_sha256):
        print("ERROR: the render changed before it could be reviewed.", file=sys.stderr)
        return 3
    duration = ffprobe_duration(video)
    print(f"Job:    {job.name}")
    print(f"Video:  {source_video} ({duration:.1f}s)")
    print(f"QA snapshot: {video}")
    print(
        f"Mode:   full (usage_role={args.mode}) — style advisory; "
        "delivery safety blocks the QA stamp"
    )
    # Every sub-check reports ok / skipped here. A skipped one no longer voids
    # the others: the end-of-render classifier uses whatever did complete.
    sub_checks: dict[str, dict] = {}
    narration_required = _sub_check(
        sub_checks, "narration_intent", job, lambda: _required_narration(job), False)

    role_records = _sub_check(
        sub_checks, "role_log", job,
        lambda: load_role_log(job, Path(args.role_log) if args.role_log else None), [])
    if not role_records:
        print("NOTE: no usage_role records found in the generation log — running "
              "in DEGRADED mode (no role-matching). Review still proceeds.")

    # Resolve the declared dialogue/caption intent before audio QA. A silent
    # visual-only render receives local modality evidence instead of sending a
    # codec-created silent carrier track to a model that may hallucinate speech.
    fidelity = _sub_check(
        sub_checks, "caption_fidelity", job, lambda: caption_fidelity(job),
        {"available": False, "applicable": True,
         "reason": "caption/script fidelity step raised"},
    )

    # --- 1. Bounded exact-final transport, then one paid full-video review ---
    # Gemini does not need delivery bitrate/resolution to inspect the timeline.
    # It sees a same-framing/same-duration proxy, while every hard face/caption/
    # edge/red-zone check below continues to inspect the exact source bytes.
    layers_run: list[str] = ["perceptual_transport"]
    perceptual_transport: dict
    try:
        review_video, perceptual_transport = _prepare_perceptual_transport(
            video, job, snapshot_input_sha256,
        )
    except Exception as exc:
        review_video = video
        perceptual_transport = {
            "schema": PERCEPTUAL_TRANSPORT_SCHEMA,
            "status": "failed",
            "source_sha256": snapshot_input_sha256,
            "error": str(exc)[:500],
        }
        log_event(
            job, tool=TOOL_NAME, event="perceptual_transport_failed",
            extra={"error": type(exc).__name__, "error_message": str(exc)[:300]},
        )

    model_cache = _load_qa_model_cache(job, snapshot_input_sha256, perceptual_transport)
    final_review = strip_taste(model_cache.get("final_review"))
    final_review_status = (
        "ok" if isinstance(final_review, dict) and model_cache.get("final_review_status") == "ok"
        else "pending"
    )
    final_review_cache_hit = final_review_status == "ok"
    model_billing = model_cache.get("final_review_billing") if final_review_cache_hit else None

    # Resolve audio modality locally. Non-silent technical audio evidence comes
    # from the same full-video response, never a second provider request.
    audio_audit = {"skipped": True}
    audio_signal: dict | None = None
    if not args.skip_audio:
        audio_signal = _sub_check(
            sub_checks, "audio_signal", job, lambda: _final_audio_signal(video),
            {"status": "unavailable", "reason": "local audio signal step raised"})
        if isinstance(audio_signal, dict) and audio_signal.get("status") in {"absent", "silent", "audible"}:
            _mark(sub_checks, "audio_signal", "ok")
        else:
            # Not measured: nothing can be told from it. (The integrated audio
            # evidence, not this local signal, decides QA completeness.)
            _mark(sub_checks, "audio_signal", "unavailable",
                  str((audio_signal or {}).get("reason") or "audio signal unavailable")[:300])
        if _is_intentional_visual_only_silence(fidelity, audio_signal):
            print("\n[audio] intentional visual-only silence (local modality audit)...")
            audio_audit = _visual_only_audio_audit(audio_signal)

    # mode_full is also called by a small number of internal/test helpers that
    # predate the CLI-only cache receipt. Treat an omitted field exactly like
    # the argparse default (no receipt supplied) instead of crashing before QA.
    required_model_cache_receipt = getattr(args, "require_model_cache_receipt", None)
    if required_model_cache_receipt:
        final_ready, _errors = _structured_review_status(final_review)
        current_receipt = _qa_model_cache_receipt(
            snapshot_input_sha256,
            perceptual_transport,
            final_review_ready=(final_review_status == "ok" and final_ready),
        )
        if current_receipt != required_model_cache_receipt:
            print(
                "ERROR: the paid QA cache changed after authorization preflight; "
                "no provider call was started.",
                file=sys.stderr,
            )
            return 2

    # Missing required speech is severe and locally provable. Missing music or
    # an unfinished mix is a draft warning, so it must not prevent the review.
    narration_absent = bool(
        not args.skip_audio and narration_required and isinstance(audio_signal, dict)
        and audio_signal.get("status") in {"absent", "silent"}
    )
    if narration_absent and not harness:
        blocking = ["promised_audio_missing_from_final"]
        run_id = os.environ.get("VIDEOCLAW_QA_RUN_ID", "")
        if re.fullmatch(r"[a-f0-9-]{36}", run_id):
            print("VIDEOCLAW_LOCAL_QA " + json.dumps({
                "schema": "videoclaw.local-qa/v1", "run_id": run_id,
                "qa_outcome": "CONTENT_FAIL", "qa_complete": False,
                "provider_calls_started": 0,
                "input_sha256": input_sha256,
                "final_sha256": _sha256_file(source_video),
                "snapshot_input_sha256": snapshot_input_sha256,
                "snapshot_final_sha256": _sha256_file(video),
                "grounding_failures": blocking,
            }, separators=(",", ":")), flush=True)
        print(
            "ERROR: this candidate cannot be approved — "
            + ", ".join(blocking)
            + ".\n  No paid QA request was started. Rebuild the final so it carries the "
              "audio the promise requires, then review again.",
            file=sys.stderr,
        )
        log_event(
            job, tool=TOOL_NAME, event="audio_grounding_blocked_paid_qa",
            extra={
                "grounding_failures": blocking,
                "provider_calls_started": 0,
                "video": str(video),
            },
        )
        return 2

    # --- 2. The model call runs while the local checks run -----------------
    # Delivery safety, audio grounding and Taste read only local media, so they
    # no longer wait for the full-video model (p50 about 45s). Inside the
    # harness the wait for the model ends at the child's deadline; anything
    # late is dropped and the local results still stand.
    provider_calls_started = 0
    model_box: dict = {}
    model_thread: threading.Thread | None = None
    if narration_absent:
        # Harness: the missing narration is already the finding; the model call
        # would add nothing. Keep going so the local evidence is recorded.
        final_review = strip_taste({
            "raw": "", "parse_error": "not requested: required narration is missing",
            "vendor_error": None,
        })
        final_review_status = "skipped"
    elif final_review_status != "ok" and perceptual_transport.get("status") == "ready":
        print("\n[gemini] one-pass final review (video + technical audio)...")
        provider_calls_started = 1

        def call_model() -> None:
            try:
                model_box["value"] = run_final_review(review_video, job)
            except BaseException as exc:  # reported below; never kills the review
                model_box["error"] = exc

        model_thread = threading.Thread(target=call_model, name="full-video-model", daemon=True)
        model_thread.start()
    elif final_review_status != "ok":
        error = perceptual_transport.get("error", "perceptual transport unavailable")
        final_review = strip_taste({
            "raw": "", "parse_error": str(error)[:300], "vendor_error": str(error)[:500],
        })
        final_review_status = "failed"

    # Local work, in parallel with the model call.
    grounded_local = None
    if not args.skip_audio and isinstance(audio_signal, dict):
        grounded_local = _sub_check(
            sub_checks, "audio_grounding", job,
            lambda: ground_audio_audit(job, video, {"final_audio_signal": audio_signal}), None)

    # A failed review copy cannot become complete QA. Outside the harness, avoid
    # minutes of source scanning when no full-video observation can accompany
    # the results; the harness still wants the deterministic delivery findings.
    transport_ready = perceptual_transport.get("status") == "ready"
    unavailable_delivery = {
        "status": DELIVERY_QA_UNAVAILABLE,
        "renderSha256": input_sha256,
        "error": "Not run because the full-video review copy was unavailable.",
    }
    if transport_ready or harness:
        # The harness judges its immutable snapshot, never a path a concurrent
        # render could replace mid-review.
        delivery_video = video if harness else source_video
        delivery_output = own_dir / "delivery-safety.json" if own_dir else None
        delivery_safety = _sub_check(
            sub_checks, "delivery_safety", job,
            lambda: run_delivery_safety(delivery_video, job, output=delivery_output),
            {**unavailable_delivery, "error": "delivery safety step raised"})
    else:
        delivery_safety = unavailable_delivery
    if delivery_safety.get("status") in (DELIVERY_PASS, DELIVERY_CONTENT_FAIL):
        _mark(sub_checks, "delivery_safety", "ok")
    else:
        _mark(sub_checks, "delivery_safety", "skipped", str(delivery_safety.get("error"))[:300])
    print(
        f"\n[delivery] {delivery_safety.get('status')} "
        f"for {delivery_safety.get('platform', 'unknown platform')}"
    )

    # Deterministic scoped-Taste observations on the exact render. This is
    # deliberately part of the canonical full-QA path: agents do not
    # hand-author face/cadence/layout verdict inputs.  A failed extraction is
    # recorded honestly and leaves qa_gate fail-closed without taste-qa.json.
    taste_qa: dict | None = None
    promise_path = job / "promise.json"
    if promise_path.is_file() and harness:
        # Taste binds to the live canonical final.mp4 and job files; the
        # end-of-render review judges its published snapshot instead, and
        # nothing it tells the agent comes from Taste.
        _mark(sub_checks, "taste", "not_applicable", "Taste QA binds only to the live final.mp4")
    elif promise_path.is_file() and (transport_ready or harness):
        try:
            observations_path = job / "taste-observations.json"
            capture_production_observations(promise_path, source_video, observations_path)
            taste_qa = run_taste_qa(promise_path, observations_path, job / "taste-qa.json")
            print(f"\n[taste] deterministic QA: {taste_qa['status']}")
            _mark(sub_checks, "taste", "ok")
        except Exception as exc:
            taste_qa = {"error": str(exc)}
            _mark(sub_checks, "taste", "skipped", f"{type(exc).__name__}: {str(exc)[:200]}")
            print(f"\n[taste] deterministic QA incomplete: {exc}")

    if model_thread is not None:
        deadline = harness_deadline()
        model_thread.join(None if deadline is None else max(0.0, deadline - time.time()))
        if model_thread.is_alive():
            reason = "the full-video model did not answer before the deadline"
            log_event(job, tool=TOOL_NAME, event="final_review_deadline",
                      extra={"provider_calls_started": provider_calls_started})
            final_review = strip_taste({"raw": "", "parse_error": reason, "vendor_error": reason})
            final_review_status = "failed"
        elif "error" in model_box:
            exc = model_box["error"]
            final_review = strip_taste({
                "raw": "", "parse_error": str(exc)[:300], "vendor_error": str(exc)[:500],
            })
            final_review_status = "failed"
        else:
            final_review, final_review_status = model_box["value"]
            if harness and final_review_status == "ok":
                # gateway.harness_review returns only a house-billed result.
                model_billing = "house"
    review_usable, review_errors = _structured_review_status(final_review)
    model_evidence = {
        # Model-derived serious findings need a successful house-billed answer
        # about these exact bytes.
        "trusted": bool(harness and final_review_status == "ok" and review_usable
                        and model_billing == "house"),
        "billing": model_billing,
        "cache_hit": final_review_cache_hit,
    }
    if final_review_status == "ok" and review_usable:
        _mark(sub_checks, "full_video_model", "ok")
    else:
        detail = (final_review.get("parse_error") or final_review.get("vendor_error")
                  if isinstance(final_review, dict) else None) or "; ".join(review_errors[:3])
        _mark(sub_checks, "full_video_model", "skipped", str(detail or final_review_status)[:300])

    if not args.skip_audio and not _is_intentional_visual_only_silence(fidelity, audio_signal):
        audio_audit = _integrated_audio_audit(final_review)

    if isinstance(audio_signal, dict) and not args.skip_audio:
        audio_audit["final_audio_signal"] = audio_signal

    _write_qa_model_cache(
        job,
        snapshot_input_sha256,
        perceptual_transport,
        final_review=final_review if isinstance(final_review, dict) else None,
        final_review_status=final_review_status,
        billing=model_billing,
    )
    # Planned punch-ins, stills, padding and silence explain some observations;
    # mark them on a copy (the cache keeps the model's own words).
    edits = _sub_check(sub_checks, "declared_edits", job, lambda: declared_edits(job), [])
    _mark(sub_checks, "declared_edits", "ok")
    if isinstance(final_review, dict):
        final_review = json.loads(json.dumps(final_review))
    declared_marked = _sub_check(
        sub_checks, "declared_edits", job,
        lambda: apply_declared_edits(
            final_review, edits,
            # "No dialogue" excuses every silence only when the shared
            # narration-intent check agrees nothing must be heard (a script
            # of narration chunks with captions off reads as no-dialogue to
            # the caption check, but its words are still required).
            no_dialogue=not narration_required and isinstance(fidelity, dict)
            and fidelity.get("intent") in {"visual_only", "no_dialogue"}),
        0)
    layers_run.append("final_review")
    if final_review_cache_hit:
        layers_run.append("final_review_cache")
    log_event(
        job, tool=TOOL_NAME, event="qa_model_observations_ready",
        extra={
            "source_sha256": snapshot_input_sha256,
            "final_review_cache_hit": final_review_cache_hit,
            "provider_calls_started": provider_calls_started,
            "one_paid_pass": True,
        },
    )

    # Merge the model's audio observations with the local grounding.
    if not args.skip_audio:
        if grounded_local is None:
            audio_audit_status = "failed"
        else:
            audio_audit, audio_audit_status = merge_audio_grounding(audio_audit, grounded_local[0])
            _mark(sub_checks, "audio_grounding", "ok")
        fidelity = ground_caption_fidelity_with_audio(
            fidelity,
            audio_audit,
            audio_audit_status,
        )
        layers_run.append("audio_audit")
    else:
        audio_audit_status = "skipped"

    # --- 3. Caption-vs-script word-fidelity (deterministic) ---
    print("\n[fidelity] caption-vs-script word check...")
    layers_run.append("caption_fidelity")
    if fidelity.get("available") is False and fidelity.get("applicable") is True:
        # Complete or skip: without trustworthy script/transcript intent the
        # comparison is skipped and named, never left half-done.
        _mark(sub_checks, "caption_fidelity", "skipped", str(fidelity.get("reason"))[:300])
    else:
        _mark(sub_checks, "caption_fidelity", "ok")

    # --- 4. On-screen-text / brand-string audit + exact local frame evidence ---
    print("\n[brand] on-screen-text audit...")
    expected = _sub_check(sub_checks, "onscreen_text", job,
                          lambda: expected_brand_strings(job, args.brand_strings), [])
    text_audit = _sub_check(sub_checks, "onscreen_text", job,
                            lambda: onscreen_text_audit(final_review, expected),
                            {"expected_brand_strings": expected, "flags": []})
    _mark(sub_checks, "onscreen_text", "ok")
    layers_run.append("onscreen_text_audit")
    frame_verifications: list[dict] = []
    if not args.skip_frame_verify and text_audit["flags"]:
        frames_dir = (own_dir or job) / "review_frames"
        frames_dir.mkdir(exist_ok=True)
        print(f"  extracting {len(text_audit['flags'])} exact brand-text frame(s)...")
        for flag in text_audit["flags"]:
            t = flag.get("start_sec")
            if t is None:
                continue
            try:
                t = max(0.0, min(float(t), duration - 0.05))
            except (TypeError, ValueError):
                continue
            out_path = frames_dir / f"brandtext_{t:06.2f}s.png"
            try:
                extract_frame(video, t, out_path)
                evidence_item = {
                    "at_sec": round(t, 2),
                    "flag": flag,
                    "frame": _in_job(job, out_path),
                    "frame_sha256": _sha256_file(out_path),
                    "source_sha256": snapshot_input_sha256,
                }
            except Exception as e:
                evidence_item = {"at_sec": round(t, 2), "flag": flag, "error": str(e)}
            frame_verifications.append(evidence_item)
        if frame_verifications:
            layers_run.append("frame_evidence")

    # --- 5. Ground verifiable claims, then the per-beat role-aware judge ---
    visual_gaps: list[str] = []
    visual_outcomes = _sub_check(
        sub_checks, "visual_confirmation", job,
        lambda: visual_candidate_outcomes(video, final_review, duration, job, gaps=visual_gaps), {})
    if visual_gaps:
        # A pixel check that timed out or failed did not confirm anything.
        _mark(sub_checks, "visual_confirmation", "skipped", "; ".join(visual_gaps)[:300])
    _mark(sub_checks, "visual_confirmation", "ok")
    verified_visual_candidates = {i for i, outcome in visual_outcomes.items() if outcome == "confirmed"}
    claim_checks = _sub_check(
        sub_checks, "claim_grounding", job,
        lambda: ground_review_claims(final_review, job, video, visual_outcomes), {})
    _mark(sub_checks, "claim_grounding", "ok")
    print("\n[judge] per-beat role compliance...")

    def judge_beats() -> list[dict]:
        beats = load_beats(job)
        table: list[dict] = []
        ignored = set()
        if audio_audit.get("intentional_silence") is True:
            ignored.add("audio")
        if _render_disabled_captions(job, video):
            ignored.add("captions")
        scope = dict(ignore_sections=frozenset(ignored), claim_checks=claim_checks)
        if beats:
            for b in beats:
                declared = declared_role_for_beat(b["index"], b.get("name"), role_records)
                verdict = judge_beat(
                    declared,
                    _beat_observations(final_review, b["start_sec"], b["end_sec"], **scope),
                    _beat_advisory_observations(final_review, b["start_sec"], b["end_sec"], **scope),
                )
                table.append({"beat": b["index"], "start_sec": b["start_sec"],
                              "end_sec": b["end_sec"], **verdict})
        else:
            # No beat boundaries — judge the whole video as one beat.
            verdict = judge_beat(
                None,
                _beat_observations(final_review, 0.0, duration, **scope),
                _beat_advisory_observations(final_review, 0.0, duration, **scope),
            )
            table.append({"beat": 0, "start_sec": 0.0, "end_sec": round(duration, 2), **verdict})
        return table

    beat_table = _sub_check(sub_checks, "role_judge", job, judge_beats, [])
    _mark(sub_checks, "role_judge", "ok")
    layers_run.append("role_judge")

    # bind this review to the exact render it saw, so qa_gate can refuse a stamp on a stale review
    final_sha256 = _sha256_file(source_video)
    snapshot_final_sha256 = _sha256_file(video)
    if perceptual_transport.get("status") == "ready":
        perceptual_transport["proxy_final_sha256"] = _sha256_file(review_video)

    def evidence() -> dict:
        return build_qa_evidence(
            input_sha256=input_sha256,
            final_sha256=final_sha256,
            snapshot_input_sha256=snapshot_input_sha256,
            snapshot_final_sha256=snapshot_final_sha256,
            final_review_status=final_review_status,
            audio_audit_status=audio_audit_status,
            final_review=final_review,
            audio_audit=audio_audit,
            fidelity=fidelity,
            text_audit=text_audit,
            frame_verifications=frame_verifications,
            skip_audio=args.skip_audio,
            skip_frame_verify=args.skip_frame_verify,
            delivery_safety=delivery_safety,
            perceptual_transport=perceptual_transport,
            duration_sec=duration,
            narration_required=narration_required,
            verified_visual_candidates=verified_visual_candidates,
            claim_checks=claim_checks,
            sub_checks=sub_checks,
        )

    qa_evidence = _sub_check(sub_checks, "evidence", job, evidence, {
        "schema": QA_EVIDENCE_SCHEMA, "mode": "full", "qa_complete": False,
        "qa_outcome": DELIVERY_QA_UNAVAILABLE, "checks": {},
        "incomplete_reasons": ["evidence assembly failed"],
        "hard_delivery_issues": [], "blocking_issues": [], "warning_issues": [],
    })

    report = {
        "job": job.name,
        "video": str(source_video),
        "review_snapshot": str(video),
        "perceptual_review": str(review_video),
        "perceptual_transport": perceptual_transport,
        "qa_model_cache": {
            "schema": QA_MODEL_CACHE_SCHEMA,
            "source_sha256": snapshot_input_sha256,
            "final_review_hit": final_review_cache_hit,
            "provider_calls_started": provider_calls_started,
        },
        "final_sha256": final_sha256,
        "duration_sec": round(duration, 2),
        "usage_role": args.mode,
        "advisory": True,
        "harness": harness,
        "layers_run": layers_run,
        "sub_checks": sub_checks,
        "narration_required": narration_required,
        "model_evidence": model_evidence,
        "declared_edits": edits,
        "declared_edits_marked": declared_marked,
        "final_review": final_review_status,
        "audio_audit_status": audio_audit_status,
        "role_match_available": bool(role_records),
        "beat_verdicts": beat_table,
        "final_review_observations": final_review,
        "review_claim_checks": [
            {"section": section, "index": index, **check}
            for (section, index), check in sorted(claim_checks.items())
        ],
        "audio_audit": audio_audit,
        "caption_fidelity": fidelity,
        "onscreen_text_audit": text_audit,
        "frame_evidence": frame_verifications,
        "delivery_safety": delivery_safety,
        "taste_qa": taste_qa,
        "qa_evidence": qa_evidence,
        "qa_outcome": qa_evidence["qa_outcome"],
    }

    if report_path:
        json_path = Path(report_path)
        out_path = json_path.with_suffix(".md")
    else:
        json_path = job / "review_output.json"
        out_path = job / "review_output.md"
    atomic_write_text(json_path, json.dumps(report, indent=2, allow_nan=False))
    _sub_check(sub_checks, "markdown", job, lambda: _write_markdown(out_path, report), None)

    log_event(
        job, tool=TOOL_NAME, event="review_complete",
        extra={
            "usage_role": args.mode,
            "video": str(video.relative_to(job)) if video.is_relative_to(job) else str(video),
            "n_beats": len(beat_table),
            "verdict_counts": _verdict_counts(beat_table),
            "brand_flags": len(text_audit["flags"]),
            "frames_evidenced": len(frame_verifications),
            "role_match_available": bool(role_records),
            "layers_run": layers_run,
            "final_review": final_review_status,
            "audio_audit_status": audio_audit_status,
            "delivery_safety_status": delivery_safety.get("status"),
            "qa_complete": qa_evidence["qa_complete"],
            "qa_outcome": qa_evidence["qa_outcome"],
            "harness": harness,
            "sub_checks_skipped": sorted(
                name for name, value in sub_checks.items() if value.get("status") != "ok"),
            "output": _in_job(job, out_path),
        },
    )

    _print_summary(report)
    return 0


def mode_beat(args, job: Path) -> int:
    video = resolve_video(job, args.video)
    duration = ffprobe_duration(video)
    role_records = load_role_log(job, Path(args.role_log) if args.role_log else None)

    # Resolve the beat window.
    if args.beat is not None:
        beats = load_beats(job)
        match = next((b for b in beats if str(b["index"]) == str(args.beat)), None)
        if match is None:
            sys.exit(f"ERROR: beat {args.beat} not found in beat boundaries. "
                     f"Pass --ts-start/--ts-end instead.")
        start, end = match["start_sec"], match["end_sec"]
        beat_name = match.get("name")
        beat_idx = match["index"]
    elif args.ts_start is not None and args.ts_end is not None:
        start, end = args.ts_start, args.ts_end
        beat_name = None
        beat_idx = None
    else:
        sys.exit("ERROR: --mode beat requires --beat <n> OR --ts-start AND --ts-end.")

    declared = args.declared_role or declared_role_for_beat(beat_idx, beat_name, role_records)

    print(f"Job:   {job.name}")
    print(f"Beat:  {args.beat if args.beat is not None else f'{start}-{end}s'}  "
          f"(declared_role={declared or 'unknown'})")
    print(f"Mode:  beat (usage_role={args.mode})  —  ADVISORY")

    # Run final_review over the WHOLE video (Gemini reads timestamps) and slice
    # the observations to the beat window — same backend as `full`.
    final_review, final_review_status = run_final_review(video, job)
    claim_checks = ground_review_claims(
        final_review, job, video, visual_candidate_outcomes(video, final_review, duration, job),
    )
    verdict = judge_beat(
        declared,
        _beat_observations(final_review, start, end, claim_checks=claim_checks),
        _beat_advisory_observations(final_review, start, end, claim_checks=claim_checks),
    )

    # Prior verdict diff, if a prior review_output.json exists.
    prior_note = ""
    prior_path = job / "review_output.json"
    if prior_path.exists():
        try:
            prior = json.loads(prior_path.read_text())
            for pb in prior.get("beat_verdicts", []):
                if str(pb.get("beat")) == str(args.beat):
                    prior_note = (f"prior verdict was '{pb.get('verdict')}' → "
                                  f"now '{verdict['verdict']}'")
                    break
        except json.JSONDecodeError:
            pass

    result = {
        "job": job.name,
        "video": str(video),
        "usage_role": args.mode,
        "advisory": True,
        "beat": args.beat,
        "start_sec": start,
        "end_sec": end,
        "diff_note": prior_note,
        **verdict,
    }

    log_event(
        job, tool=TOOL_NAME, event="beat_review_complete",
        extra={"usage_role": args.mode, "beat": args.beat,
               "start_sec": start, "end_sec": end,
               "declared_role": declared, "verdict": verdict["verdict"]},
    )

    print("\n" + "=" * 70)
    print(f"BEAT VERDICT: {verdict['verdict'].upper()}  (declared_role={declared or 'unknown'})")
    if prior_note:
        print(f"  diff: {prior_note}")
    for o in verdict["observations"]:
        print(f"  · {o}")
    if verdict["recommended_action"]:
        print(f"  → {verdict['recommended_action']}")
    print("=" * 70)
    print("\nADVISORY ONLY — this tool surfaces; the human decides whether to regen.")
    return 0


# ===========================================================================
# Reporting helpers
# ===========================================================================

def _verdict_counts(beat_table: list[dict]) -> dict:
    counts = {v: 0 for v in _VALID_VERDICTS}
    for b in beat_table:
        counts[b["verdict"]] = counts.get(b["verdict"], 0) + 1
    return counts


def _write_markdown(out_path: Path, report: dict) -> None:
    lines = [f"# review_output — `{report['job']}`\n",
             "_Draft-first review: ordinary findings are warnings. Only confirmed "
             "severe defects require repair. Incomplete checks remain unavailable._\n",
             f"\n**Video:** `{report['video']}` ({report['duration_sec']}s)  ",
             f"\n**Role-match:** {'available' if report['role_match_available'] else 'DEGRADED (no usage_role log)'}  ",
             f"\n**Final review:** `{report['final_review']}`  ",
             f"\n**Layers run:** `{', '.join(report['layers_run'])}`  ",
             f"\n**QA evidence complete:** `{report['qa_evidence']['qa_complete']}`\n",
             f"\n**QA outcome:** `{report['qa_outcome']}`\n",
             f"\n**Severe findings:** {len(report['qa_evidence'].get('blocking_issues', []))}; "
             f"**Draft warnings:** {len(report['qa_evidence'].get('warning_issues', []))}\n",
             "\n## Per-beat verdicts\n",
             "| Beat | Window | Declared role | Verdict | AI-tell | Notes |",
             "|------|--------|---------------|---------|---------|-------|"]
    for b in report["beat_verdicts"]:
        notes = b["recommended_action"] or ("; ".join(b["observations"])[:80] if b["observations"] else "clean")
        if b.get("advisory_observations"):
            notes += f" ({len(b['advisory_observations'])} advisory claim(s) not confirmed)"
        lines.append(
            f"| {b['beat']} | {b['start_sec']}–{b['end_sec']}s | {b['declared_role']} | "
            f"**{b['verdict']}** | {'yes' if b['ai_tell'] else ''} | {notes} |"
        )
    counts = _verdict_counts(report["beat_verdicts"])
    lines.append(f"\n_Verdict counts: {counts}_\n")

    fid = report["caption_fidelity"]
    lines.append("\n## Caption ↔ script word fidelity\n")
    if fid.get("available"):
        lines.append(f"- overlap ratio: **{fid['word_overlap_ratio']}**")
        if fid["in_script_missing_from_captions"]:
            lines.append(f"- script words missing from captions: "
                         f"`{', '.join(fid['in_script_missing_from_captions'])}`")
    else:
        lines.append(f"- not available: {fid.get('reason')}")

    ta = report["onscreen_text_audit"]
    lines.append("\n## On-screen brand-text audit\n")
    lines.append(f"- expected strings: `{', '.join(ta['expected_brand_strings']) or '(none)'}`")
    lines.append(f"- flags: {len(ta['flags'])}")
    for fv in report["frame_evidence"]:
        if fv.get("error"):
            lines.append(f"  - {fv['at_sec']}s → frame extraction failed: {fv['error']}")
        else:
            lines.append(
                f"  - {fv['at_sec']}s → frame `{fv['frame']}` "
                f"sha256 `{fv['frame_sha256']}`"
            )

    atomic_write_text(out_path, "\n".join(lines) + "\n")


def _print_summary(report: dict) -> None:
    counts = _verdict_counts(report["beat_verdicts"])
    print("\n" + "=" * 70)
    print("REVIEW_OUTPUT — DRAFT WARNINGS; SEVERE DEFECTS REQUIRE REPAIR")
    print("=" * 70)
    print(f"Role-match: {'available' if report['role_match_available'] else 'DEGRADED'}")
    evidence = report["qa_evidence"]
    print(f"QA evidence complete: {evidence['qa_complete']}")
    print(f"QA outcome: {evidence['qa_outcome']}")
    for reason in evidence["incomplete_reasons"]:
        print(f"  INCOMPLETE: {reason}")
    print(f"Verdict counts: {counts}")
    for b in report["beat_verdicts"]:
        tag = b["verdict"].upper()
        marker = "  ⚠" if b["verdict"] in ("slop", "ai-tell") else "   "
        print(f"{marker} beat {b['beat']} [{b['start_sec']}–{b['end_sec']}s] "
              f"role={b['declared_role']} → {tag}")
        if b["recommended_action"]:
            print(f"       → {b['recommended_action']}")
    fid = report["caption_fidelity"]
    if fid.get("available"):
        print(f"\nCaption fidelity: overlap {fid['word_overlap_ratio']}; "
              f"{len(fid['in_script_missing_from_captions'])} script words missing from captions")
    aa = report["audio_audit"]
    if isinstance(aa, dict) and not aa.get("skipped") and not aa.get("error"):
        flags = (aa.get("voice_band_collision_flags", []) + aa.get("dead_air_flags", [])
                 + aa.get("bg_music_too_loud_flags", []) + aa.get("clipping_or_dropout_flags", []))
        print(f"Audio audit: {len(flags)} flag(s); music_bed={aa.get('music_bed_present')}")
    print(f"\nFull report: {report['job']}/review_output.md (+ .json)")
    print("ADVISORY ONLY — surfaces observations; the human (or you) decides regen.")


# ===========================================================================
# CLI
# ===========================================================================

MODES = ("full", "beat")

# Set by tools/_render_completion.py in the bounded end-of-render review child.
HARNESS_CHILD_ENV = "VIDEOCLAW_RENDER_REVIEW_CHILD"
# The moment the child stops waiting for the model, leaving time to finish.
HARNESS_MODEL_DEADLINE_ENV = "VIDEOCLAW_RENDER_REVIEW_MODEL_DEADLINE"


def harness_child() -> bool:
    """True inside the silent end-of-render review child process."""
    return os.environ.get(HARNESS_CHILD_ENV) == "1"


def harness_deadline() -> float | None:
    """Epoch second by which the child must stop waiting on the model."""
    if not harness_child():
        return None
    try:
        value = float(os.environ.get(HARNESS_MODEL_DEADLINE_ENV, ""))
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument(
        "--mode", required=True, choices=MODES,
        help="REQUIRED. Logged as usage_role. "
             "full=whole-video role-aware editorial sweep; "
             "beat=single-beat spot check after a targeted regen.",
    )
    parser.add_argument(
        "--video",
        help="Final rendered mp4. Defaults to <job>/output/final.mp4 → final.mp4 "
             "→ final_raw.mp4.",
    )
    parser.add_argument(
        "--role-log", dest="role_log",
        help="Generation log with per-asset usage_role records. "
             "Defaults to <job>/run.log.jsonl. Missing → degraded (no role-match).",
    )
    parser.add_argument(
        "--brand-strings",
        help="Comma-separated brand strings expected on-screen (e.g. "
             "'onpurpose.me,On Purpose'). Augments company.json + style_directives.",
    )
    # beat mode
    parser.add_argument("--beat", type=int, default=None,
                        help="[beat] Beat index from chunk_boundaries.json / script.json.")
    parser.add_argument("--ts-start", dest="ts_start", type=float, default=None,
                        help="[beat] Window start (sec) when reviewing by timestamp.")
    parser.add_argument("--ts-end", dest="ts_end", type=float, default=None,
                        help="[beat] Window end (sec) when reviewing by timestamp.")
    parser.add_argument("--declared-role", dest="declared_role", default=None,
                        help="[beat] Override the declared role for this beat "
                             "(else pulled from the role-log).")
    # toggles
    parser.add_argument("--skip-audio", action="store_true",
                        help="Skip integrated technical audio evidence (QA remains incomplete).")
    parser.add_argument("--skip-frame-verify", action="store_true",
                        help="Skip exact local frame evidence for brand-text flags.")
    parser.add_argument(
        "--model-cache-status", action="store_true",
        help="Free JSON preflight: report whether exact-byte paid model observations are cached.",
    )
    parser.add_argument(
        "--require-model-cache-receipt",
        help="Fail before provider work unless the exact cache preflight receipt still matches.",
    )

    args = parser.parse_args()
    job = resolve_job_dir(args.job)

    if args.model_cache_status:
        if args.mode != "full":
            parser.error("--model-cache-status requires --mode full")
        return mode_model_cache_status(args, job)

    log_event(
        job, tool=TOOL_NAME, event="invoked",
        extra={"usage_role": args.mode, "video": args.video,
               "beat": args.beat, "brand_strings": args.brand_strings},
        render_md=False,
    )

    if args.mode == "full":
        return mode_full(args, job)
    if args.mode == "beat":
        return mode_beat(args, job)
    print(f"Unknown mode: {args.mode}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
