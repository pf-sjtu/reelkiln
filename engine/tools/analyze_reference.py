"""
analyze_reference — understand what you are working from (canonical primitive).

ONE self-contained tool, parameterized by `--mode`, that answers the question
"what am I working from?" BEFORE any asset is generated. It folds three
previously separate operations into one interface:

  - mode=video       reference-video staging + format analysis
                     (absorbs deep_analyze_video.py: ffmpeg audio extract +
                      ElevenLabs Scribe v2 transcription + programmatic sentence
                      grouping + sequential layered Gemini passes, merged into a
                      single sentence-row JSON). Gemini is EYES, NOT TASTE: any
                      quality score / verdict is stripped before surfacing.

  - mode=still_set   carousel / PNG-set visual-grammar extraction (single Gemini
                     brand-DNA pass over a reference image set — mechanical
                     observations only).

  - mode=hook_bank   channel-wide recurring-hook extraction from the LOCAL DB
                     (absorbs search_outliers.py DB access). Surfaces ranked
                     hook patterns + verbatim examples + a hook-type taxonomy.

  - mode=outliers    transcript-grounded outlier research from the LOCAL DB
                     (absorbs search_outliers.py: random-sample DEFAULT +
                      opt-in semantic-search). The local DB is the PRIMARY and
                      ONLY transcript source — Sandcastles is never used here.

HARD CONTRACTS (memory-mandated):
  - The local DB (psql) is the primary outlier path. Sandcastles returns
    metadata only and must NOT be used for outlier/hook research
    (feedback_local_db_over_sandcastles.md).
  - Gemini is eyes, not taste: mechanical observations only; its quality
    scores / verdicts never override the human call (feedback_gemini_no_taste.md).
  - `--mode` is REQUIRED and logged as `usage_role`.
  - `--format-proposal` (video / still_set) emits a concise, nonblocking format
    summary for collaboration. It never authorizes or blocks production.

SELF-CONTAINED: this file does NOT import deep_analyze_video.py or
search_outliers.py (both are deleted). Their logic is inlined / re-implemented
here. It DOES import the surviving low-level helpers: job.py, log.py, and
gemini_video.py (the eyes primitive — still-callable, not absorbed).

Usage:
  uv run python tools/analyze_reference.py --job <job> --mode video      --reference <mp4|url> [--format-proposal]
  uv run python tools/analyze_reference.py --job <job> --mode still_set  --reference <dir|glob|pdf> [--format-proposal]
  uv run python tools/analyze_reference.py --job <job> --mode hook_bank  [--channel <handle>] [--top-n 20]
  uv run python tools/analyze_reference.py --job <job> --mode outliers   [--query "a; b; c"] [--channel <handle>] [--top-n 50]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# tools/ on sys.path so sibling helper modules resolve.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# --- Surviving low-level helpers (NOT absorbed tools) ---
from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import gateway  # noqa: E402  dual mode: VIDEOCLAW_API_KEY set → gateway routes Scribe + embeds

# gemini_video.py is the surviving "eyes" primitive. We reuse its low-level
# video-resolution, template loading, and analyse_video helpers exactly so the
# mechanical Gemini passes produce identical results to deep_analyze_video.py.
from gemini_video import (  # noqa: E402
    analyse_video,
    GEMINI_MODEL,
    load_template,
    reference_filename_from_url,
    save_reference_video,
)

# ---------------------------------------------------------------------------
# ElevenLabs Scribe v2 — inlined (deep_analyze_video.py absorbed verbatim).
#
# We import the installed `elevenlabs` package via the same shadow-avoidance
# dance the original used, because `elevenlabs.py` in this tools/ dir shadows
# the installed package once tools/ is on sys.path.
# ---------------------------------------------------------------------------

_self_path = str(Path(__file__).resolve().parent)
_saved_paths = [p for p in sys.path if p == _self_path]
_saved_modules = {
    k: sys.modules.pop(k)
    for k in list(sys.modules)
    if k == "elevenlabs" or k.startswith("elevenlabs.")
}
sys.path[:] = [p for p in sys.path if p != _self_path]
try:
    from elevenlabs.client import ElevenLabs as _ElevenLabs  # noqa: E402
except Exception:  # pragma: no cover - only needed for mode=video w/ a key
    _ElevenLabs = None
finally:
    sys.path[:0] = _saved_paths
    sys.modules.update(_saved_modules)

load_dotenv()

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
SCRIBE_MODEL = "scribe_v2"

# Canonical creator_niche values in the local DB (absorbed from search_outliers.py).
NICHES = [
    "b2b-consultants-and-agency-owners",
    "business-life-and-marriage-coaches",
    "doctors-medical-and-clinics",
    "ecommerce-and-founders",
    "fitness-parenting-and-financial-coaches",
    "professional-and-legal-services",
    "real-estate-and-property",
    "unknown",
]

EMBED_MODEL = "openai/text-embedding-3-small"

# Canonical layer order for the video deep-analysis pass.
LAYER_ORDER = [
    "analysis_story_arc",
    "analysis_shot",
    "analysis_overlays",
    "analysis_audio",
    "analysis_video_level",
]

TOOL_NAME = "analyze_reference.py"

# Keys that carry Gemini's taste/quality verdicts. Stripped before surfacing —
# Gemini is EYES, NOT TASTE (feedback_gemini_no_taste.md).
_TASTE_KEYS = {
    "score", "scores", "quality_score", "rating", "ratings", "verdict",
    "verdicts", "grade", "overall_score", "recommendation", "recommendations",
    "is_good", "good", "should_post", "viral_score", "virality_score",
    "quality", "quality_rating", "stars", "judgement", "judgment", "opinion",
}


# ===========================================================================
# Shared: ffprobe / ffmpeg helpers
# ===========================================================================

def probe_duration(video_path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return None


def extract_audio(video_path: Path) -> Path:
    """Extract audio (mp3, 128k) for transcription. Inlined from elevenlabs.py."""
    audio_path = video_path.with_suffix(".mp3")
    result = subprocess.run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "mp3", "-ab", "128k",
        str(audio_path),
    ], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr}")
    return audio_path


def _normalize_scribe(data: dict) -> dict:
    """Normalize a raw ElevenLabs Scribe STT response to this file's canonical
    {"text", "language", "words":[{"word","start","end"}, ...]} shape.

    EXACTLY the post-processing the raw SDK path applies to
    `result.model_dump()`: drop "spacing" tokens, map per-word "text" → "word",
    "language_code" → "language". The gateway passes ElevenLabs' STT JSON
    through UNMODIFIED (same schema the SDK dumps), so the same normalization
    applies to both branches (densify.py precedent — keep in lockstep).
    """
    words = []
    for w in data.get("words", []):
        if w.get("type") == "spacing":
            continue
        words.append({
            "word": w.get("text", w.get("word", "")),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
        })
    return {
        "text": data.get("text", ""),
        "words": words,
        "language": data.get("language_code", "eng"),
    }


def _atomic_write_scribe_raw(path: Path, data: Any) -> None:
    """Persist the exact provider payload before any lossy normalization."""
    if path.is_symlink() or path.parent.is_symlink():
        raise RuntimeError(f"refusing symlinked Scribe diagnostic path: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(
        f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp"
    )
    try:
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def transcribe_elevenlabs(
    audio_path: Path,
    job: Path | None = None,
    *,
    raw_response_path: Path | None = None,
) -> dict:
    """ElevenLabs Scribe v2 word-level transcription. Inlined from elevenlabs.py.

    Returns {"text": str, "language": str, "words": [{"word","start","end"}, ...]}.

    DUAL MODE: VIDEOCLAW_API_KEY set → the call routes through the gateway
    (gateway.upload turns the local audio file into a signed GCS URL; the
    server hands it to ElevenLabs and returns the STT JSON verbatim in
    res["output"]). Otherwise the raw-key SDK path below runs unchanged.
    No key of either kind → PLACEHOLDER transcript (mirrors the absorbed
    behaviour). Exact model/params preserved: model_id=scribe_v2,
    language_code="eng", diarize=False, tag_audio_events=False.
    """
    if gateway.enabled():
        print(f"  Sending to ElevenLabs Scribe via gateway ({SCRIBE_MODEL})...")
        res = gateway.run(
            "synth_voice", mode="transcribe",
            references=[audio_path],  # local path → gateway.upload → signed GCS URL
            params={"diarize": False},  # matches the raw SDK call below
            timeout_s=900,
            job=job,
        )
        # res["output"] is ElevenLabs' response passed through unmodified —
        # persist it atomically before normalization so malformed arrays/nulls
        # remain inspectable even when normalization itself raises.
        raw_output = res["output"]
        if raw_response_path is not None:
            _atomic_write_scribe_raw(raw_response_path, raw_output)
        return _normalize_scribe(raw_output)

    if not ELEVENLABS_API_KEY or _ElevenLabs is None:
        print("[SKIP] No ELEVENLABS_API_KEY — generating placeholder transcript")
        return {
            "words": [{"word": "PLACEHOLDER", "start": 0.0, "end": 1.0}],
            "text": "PLACEHOLDER TRANSCRIPT",
            "language": "unknown",
        }
    print(f"  Sending to ElevenLabs Scribe ({SCRIBE_MODEL})...")
    client = _ElevenLabs(api_key=ELEVENLABS_API_KEY)
    with open(audio_path, "rb") as f:
        result = client.speech_to_text.convert(
            file=f, model_id=SCRIBE_MODEL,
            tag_audio_events=False, language_code="eng", diarize=False,
        )
    data = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    if raw_response_path is not None:
        _atomic_write_scribe_raw(raw_response_path, data)
    return _normalize_scribe(data)


# ===========================================================================
# Shared: sentence grouping + JSON parsing (absorbed from deep_analyze_video.py)
# ===========================================================================

SENTENCE_END_PUNCT = re.compile(r"[.!?]$")


def words_to_sentences(
    words: list[dict],
    *,
    pause_threshold: float = 0.4,
    max_words: int = 25,
) -> list[dict]:
    """Group word-level transcript into sentence anchor chunks (verbatim logic)."""
    sentences: list[dict] = []
    current: list[dict] = []

    def _close():
        if not current:
            return
        sentences.append({
            "id": f"s{len(sentences)}",
            "start": round(current[0]["start"], 2),
            "end": round(current[-1]["end"], 2),
            "text": " ".join(c["word"] for c in current).strip(),
        })

    for w in words:
        if not w.get("word") or not w["word"].strip():
            continue
        if current:
            gap = w["start"] - current[-1]["end"]
            if gap > pause_threshold:
                _close()
                current = []
        current.append(w)
        if SENTENCE_END_PUNCT.search(w["word"].strip()):
            _close()
            current = []
            continue
        if len(current) >= max_words:
            _close()
            current = []

    _close()
    return sentences


def parse_json_response(text: str, layer_name: str) -> Any:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n", "", text)
    text = re.sub(r"\n```\s*$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(
            f"[{layer_name}] No JSON object found. First 300 chars of response:\n{text[:300]}"
        )
    blob = text[start:end + 1]
    try:
        return json.loads(blob)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"[{layer_name}] JSON parse failed: {e}\nFirst 500 chars of blob:\n{blob[:500]}"
        )


def strip_taste(obj: Any) -> Any:
    """Recursively drop Gemini taste/quality verdict keys.

    Gemini is EYES, NOT TASTE — mechanical observations only survive
    (feedback_gemini_no_taste.md). Applied to the merged analysis before it is
    surfaced / saved.
    """
    if isinstance(obj, dict):
        return {
            k: strip_taste(v)
            for k, v in obj.items()
            if k.lower() not in _TASTE_KEYS
        }
    if isinstance(obj, list):
        return [strip_taste(v) for v in obj]
    return obj


# ===========================================================================
# mode=video : layered deep analysis (absorbed from deep_analyze_video.py)
# ===========================================================================

def run_layer(
    layer_name: str,
    video_url_arg: str,
    sentence_anchor: list[dict],
    prior_layers: dict[str, Any],
    job: Path,
) -> Any:
    """Run a single layer's Gemini pass. Returns the parsed JSON. Verbatim logic."""
    template = load_template(layer_name)
    body = template.body

    anchor_block = (
        "## Sentence anchor (ELEVENLABS SCRIBE V2 GROUND TRUTH)\n\n"
        "These sentence IDs and timestamps come from real word-level "
        "transcription of the reference audio. Use them as the temporal "
        "scaffolding for your annotations. Do not invent sentence IDs. "
        "Do not annotate timestamps outside any sentence's [start, end] "
        "range. Every sentence in the anchor must appear in your output.\n\n"
        f"```json\n{json.dumps({'sentences': sentence_anchor}, indent=2)}\n```"
    )
    body = body.rstrip() + "\n\n" + anchor_block

    if prior_layers:
        prior_block = "\n\n## Prior layer outputs (use these for context)\n\n"
        for prior_name, prior_data in prior_layers.items():
            prior_block += (
                f"### {prior_name}\n```json\n"
                f"{json.dumps(prior_data, indent=2)}\n```\n\n"
            )
        body = body + prior_block

    print(f"\n[{layer_name}] running (prior layers: {list(prior_layers.keys()) or 'none'})...")
    t0 = time.perf_counter()
    response_text = analyse_video(
        url=video_url_arg,
        prompt=body,
        model=GEMINI_MODEL,
        job=job,
        mode_label=layer_name,
        max_output_tokens=template.max_output_tokens,
    )
    elapsed = time.perf_counter() - t0
    print(f"[{layer_name}] response received in {elapsed:.1f}s")

    return parse_json_response(response_text, layer_name)


def merge_layers(
    sentence_anchor: list[dict],
    layer_outputs: dict[str, Any],
    video_meta: dict,
) -> dict:
    """Combine all layer outputs into the final sentence-row analysis JSON."""
    story_arc = (layer_outputs.get("analysis_story_arc") or {}).get("by_sentence", {})
    shot = (layer_outputs.get("analysis_shot") or {}).get("by_sentence", {})
    overlays = (layer_outputs.get("analysis_overlays") or {}).get("by_sentence", {})
    audio = (layer_outputs.get("analysis_audio") or {}).get("by_sentence", {})
    video_level = layer_outputs.get("analysis_video_level") or {}

    sentences = []
    for s in sentence_anchor:
        sid = s["id"]
        sentences.append({
            **s,
            "story_arc": story_arc.get(sid, []),
            "shot": shot.get(sid, []),
            "overlays": overlays.get(sid, []),
            "audio": audio.get(sid, []),
        })

    return {
        "video_meta": video_meta,
        "video_level": video_level,
        "sentences": sentences,
    }


def mode_video(args, job: Path) -> int:
    if not args.reference:
        print("ERROR: --mode video requires --reference <mp4|url>")
        return 1

    print(f"Job: {job.name}")
    print(f"Reference: {args.reference}")

    # --- Step 1: resolve / save the reference video ---
    print("\n[1/5] Resolving reference video...")
    ref_path = save_reference_video(args.reference, job)
    if ref_path is None or not ref_path.exists():
        raise RuntimeError(
            f"Could not resolve reference video for {args.reference}. "
            f"If a URL failed yt-dlp, download the file and pass a local path."
        )
    duration = probe_duration(ref_path)
    print(f"  Reference: {ref_path.relative_to(job)}"
          + (f" ({duration:.1f}s)" if duration else ""))

    # --- Step 2 + 3: extract audio + transcribe ---
    print("\n[2/5] Extracting audio + transcribing with ElevenLabs Scribe v2...")
    t0 = time.perf_counter()
    audio_path = extract_audio(ref_path)
    transcript = transcribe_elevenlabs(audio_path, job=job)
    print(f"  Transcribed {len(transcript['words'])} words in {time.perf_counter()-t0:.1f}s")

    # --- Step 4: group into sentence anchors ---
    print("\n[3/5] Grouping into sentence anchors...")
    sentences = words_to_sentences(
        transcript["words"],
        pause_threshold=args.pause_threshold,
        max_words=args.max_words_per_sentence,
    )
    print(f"  → {len(sentences)} sentence anchors")
    if sentences:
        print(f"  s0: [{sentences[0]['start']:.1f}-{sentences[0]['end']:.1f}s] {sentences[0]['text'][:80]}")
        print(f"  s{len(sentences)-1}: [{sentences[-1]['start']:.1f}-{sentences[-1]['end']:.1f}s] {sentences[-1]['text'][:80]}")

    log_event(
        job, tool=TOOL_NAME, event="anchor_built",
        extra={
            "usage_role": args.mode,
            "url": args.reference,
            "ref_path": str(ref_path.relative_to(job)),
            "duration_seconds": duration,
            "n_words": len(transcript["words"]),
            "n_sentences": len(sentences),
        },
    )

    # --- Step 5: sequential layered Gemini passes ---
    selected = {
        s.strip() if s.strip().startswith("analysis_") else f"analysis_{s.strip()}"
        for s in args.layers.split(",")
    }
    n_to_run = len([l for l in LAYER_ORDER if l in selected])
    print(f"\n[4/5] Running {n_to_run} layered Gemini passes (sequential)...")
    layer_outputs: dict[str, Any] = {}
    api_url = args.reference  # analyse_video re-resolves; save_reference_video is idempotent

    for layer in LAYER_ORDER:
        if layer not in selected:
            print(f"  [skip] {layer}")
            continue
        try:
            layer_outputs[layer] = run_layer(
                layer_name=layer,
                video_url_arg=api_url,
                sentence_anchor=sentences,
                prior_layers=layer_outputs.copy(),
                job=job,
            )
        except Exception as e:
            print(f"  [FAIL] {layer}: {type(e).__name__}: {e}")
            log_event(
                job, tool=TOOL_NAME, event="layer_failed",
                extra={"usage_role": args.mode, "layer": layer,
                       "error": type(e).__name__, "message": str(e)[:300]},
            )
            raise

    # --- Step 6: merge + strip taste ---
    print("\n[5/5] Merging layer outputs...")
    video_meta = {
        "url": args.reference,
        "ref_path": str(ref_path.relative_to(job)),
        "duration_seconds": duration,
        "n_words": len(transcript["words"]),
        "n_sentences": len(sentences),
        "language": transcript.get("language", "eng"),
    }
    merged = merge_layers(sentences, layer_outputs, video_meta)
    # Gemini is EYES, NOT TASTE — drop any quality score / verdict before surfacing.
    merged = strip_taste(merged)

    # --- Step 7: save canonical analysis JSON ---
    if args.output:
        out_path = Path(args.output)
    else:
        ref_name = reference_filename_from_url(args.reference)
        analysis_name = ref_name.replace("outlier__", "analysis__").replace(".mp4", ".json")
        out_path = job / "reference" / analysis_name
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged, indent=2))
    print(f"  Saved: {out_path.relative_to(job)}")

    log_event(
        job, tool=TOOL_NAME, event="analysis_complete",
        extra={
            "usage_role": args.mode,
            "url": args.reference,
            "output": str(out_path.relative_to(job)),
            "layers_run": list(layer_outputs.keys()),
            "n_sentences": len(sentences),
            "duration_seconds": duration,
        },
    )

    # --- Step 8: print full merged JSON (mandatory context ingestion) ---
    print("\n" + "=" * 70)
    print("FULL MERGED ANALYSIS — mechanical observations only (taste stripped).")
    print("Read this file in full before locking a production format.")
    print("=" * 70)
    print(json.dumps(merged, indent=2))

    if args.format_proposal:
        _emit_format_proposal(args.mode)
    return 0


# ===========================================================================
# mode=still_set : carousel / PNG-set visual-grammar extraction
# ===========================================================================

def _collect_images(reference: str) -> list[Path]:
    """Resolve --reference into an ordered list of image paths.

    Accepts a directory, a glob, a single image, or a single PDF (kept as-is).
    """
    p = Path(reference)
    if p.is_dir():
        imgs = sorted(
            x for x in p.iterdir()
            if x.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".pdf")
        )
        return imgs
    if any(ch in reference for ch in "*?[]"):
        from glob import glob
        return sorted(Path(x) for x in glob(reference))
    if p.exists():
        return [p]
    return []


_STILL_SET_PROMPT = (
    "You are a MECHANICAL visual-grammar extractor. Report ONLY observable "
    "attributes of these reference slides — do NOT judge quality, do NOT rate, "
    "do NOT recommend. Return a JSON object with this shape:\n"
    "{\n"
    '  "slide_count": <int>,\n'
    '  "per_slide": [ {"index": <int>, "grid_layout": "...", "column_count": <int>, '
    '"font_hierarchy": "...", "illustration_style": "...", "illustration_density": "...", '
    '"text_blocks": <int>, "dominant_colors": ["#..."]} ],\n'
    '  "palette": {"color_count": <int>, "colors": ["#..."]},\n'
    '  "typography": {"families_observed": ["..."], "scale_steps": <int>},\n'
    '  "info_density": "low|medium|high",\n'
    '  "notes": "any other purely-mechanical observation"\n'
    "}\n"
    "Mechanical observations only. No taste, no scores, no verdicts."
)


def mode_still_set(args, job: Path) -> int:
    if not args.reference:
        print("ERROR: --mode still_set requires --reference <dir|glob|pdf>")
        return 1

    print(f"Job: {job.name}")
    images = _collect_images(args.reference)
    if not images:
        print(f"ERROR: no images resolved from --reference {args.reference!r}")
        return 1
    print(f"Reference set: {len(images)} file(s)")
    for im in images:
        print(f"  - {im}")

    # Single brand-DNA / visual-grammar Gemini pass over the set. We reuse the
    # gemini_video.analyse_video transport (multimodal); for image sets we pass
    # the directory/first PDF as the reference and let Gemini read the frames.
    # The pass is mechanical-only; any taste keys are stripped on the way out.
    from gemini_video import client as _gem_client  # surviving low-level client

    # Build a multimodal message: prompt + each image as an image_url data URL.
    import base64
    content: list[dict] = [{"type": "text", "text": _STILL_SET_PROMPT}]
    for im in images:
        if im.suffix.lower() == ".pdf":
            # PDFs are passed by data URL; Gemini reads pages natively.
            b64 = base64.b64encode(im.read_bytes()).decode("utf-8")
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:application/pdf;base64,{b64}"}})
        else:
            mime = "image/png" if im.suffix.lower() == ".png" else "image/jpeg"
            b64 = base64.b64encode(im.read_bytes()).decode("utf-8")
            content.append({"type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"}})

    print("\nSending still-set to Gemini (mechanical brand-DNA pass)...")
    t0 = time.perf_counter()
    if gateway.enabled():
        # messages passthrough — same multimodal content, metered via gateway
        res = gateway.run(
            "qa_video", role="still_set",
            params={"messages": [{"role": "user", "content": content}],
                    "max_output_tokens": 16384},
            job=job, timeout_s=900)
        raw = res["output"]["text"]
        if raw is None:
            raise RuntimeError("Empty Gemini response via gateway")
    else:
        response = _gem_client.chat.completions.create(
            model=GEMINI_MODEL,
            messages=[{"role": "user", "content": content}],
            max_tokens=16384,
        )
        if not response.choices or response.choices[0].message.content is None:
            raise RuntimeError(f"Empty Gemini response: {response.model_dump()}")
        raw = response.choices[0].message.content
    elapsed = time.perf_counter() - t0

    try:
        brief = parse_json_response(raw, "still_set")
    except ValueError:
        brief = {"raw": raw}
    brief = strip_taste(brief)

    out_path = Path(args.output) if args.output else (job / "reference" / "still_set_brief.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(brief, indent=2))

    log_event(
        job, tool=TOOL_NAME, event="still_set_brief_saved",
        prompt=_STILL_SET_PROMPT,
        response=raw,
        duration_seconds=elapsed,
        extra={
            "usage_role": args.mode,
            "n_images": len(images),
            "output": str(out_path.relative_to(job)),
        },
    )

    print(f"\nSaved: {out_path.relative_to(job)}")
    print("\n" + "=" * 70)
    print("STILL-SET STYLE BRIEF — mechanical observations only.")
    print("=" * 70)
    print(json.dumps(brief, indent=2))

    if args.format_proposal:
        _emit_format_proposal(args.mode)
    return 0


# ===========================================================================
# Local-DB access (absorbed from search_outliers.py) — outliers + hook_bank
# ===========================================================================

def _db_imports():
    """Lazy import of DB deps so --help / non-DB modes don't require them."""
    import psycopg2
    import psycopg2.extras
    return psycopg2, psycopg2.extras


def _embed(text: str, job: Path | None = None) -> list[float]:
    """Embed a query via OpenRouter (absorbed from search_outliers.py).

    DUAL MODE: VIDEOCLAW_API_KEY set → the gateway's "embed" tool,
    mode="db_text". CRITICAL: mode MUST be "db_text" — it routes to
    openai/text-embedding-3-small, the SAME vector space as the pgvector HNSW
    index this query is compared against. The other embed modes
    (text/image/video → Gemini) are a DIFFERENT space and would silently
    break semantic search (cosine distances become meaningless, not errors).

    Cost: this tool logs no estimate_usd of its own, so gateway.run's single
    gateway_call event is the only cost record (densify.py precedent);
    job= also sends client_job in the body for server-side attribution.
    """
    if gateway.enabled():
        res = gateway.run(
            "embed", mode="db_text",
            params={"input": [text]},
            job=job,
            timeout_s=120,
        )
        return res["output"]["embeddings"][0]

    from openai import OpenAI
    api_key = os.environ["OPENROUTER_API_KEY"]
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
    response = client.embeddings.create(model=EMBED_MODEL, input=[text])
    return response.data[0].embedding


def random_sample(min_outlier, limit, niche=None, platform=None,
                  days_recent=None, channel=None, exclude_ids=None):
    """Pull N random videos above an outlier threshold (verbatim DB logic).

    `channel` (creator_handle) is an added scope filter for hook_bank/outliers.
    """
    psycopg2, extras = _db_imports()
    database_url = os.environ["DATABASE_URL"]

    conditions = ["outlier_score >= %s"]
    params: list[Any] = [min_outlier]
    if niche:
        conditions.append("creator_niche = %s")
        params.append(niche)
    if platform:
        conditions.append("platform = %s")
        params.append(platform)
    if channel:
        conditions.append("creator_handle = %s")
        params.append(channel)
    if days_recent is not None:
        conditions.append("published_at >= NOW() - (%s || ' days')::interval")
        params.append(str(int(days_recent)))
    if exclude_ids:
        conditions.append("id <> ALL(%s::uuid[])")
        params.append(list(exclude_ids))

    where = "WHERE " + " AND ".join(conditions)
    sql = f"""
        SELECT
            id AS video_id,
            url,
            platform,
            published_at,
            duration_seconds,
            caption,
            thumbnail_url,
            views_at_capture,
            likes_at_capture,
            comments_at_capture,
            creator_handle,
            creator_follower_count,
            creator_avg_views_at_capture,
            creator_niche,
            outlier_score,
            engagement_rate,
            hook_transcript,
            full_transcript
        FROM videos
        {where}
        ORDER BY random()
        LIMIT %s
    """
    params.append(limit)

    conn = psycopg2.connect(database_url)
    cur = conn.cursor(cursor_factory=extras.RealDictCursor)
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()

    for r in rows:
        r["video_id"] = str(r["video_id"])
        r["id"] = r["video_id"]
        r["published_at"] = str(r["published_at"]) if r["published_at"] else None
        r["similarity"] = None
        r["combined_score"] = r["outlier_score"]
        r["matching_chunk"] = (r.get("hook_transcript") or "")[:300]
    return rows


def semantic_search(query, min_outlier_score, limit, channel=None, exclude_ids=None,
                    job=None):
    """Chunk-level HNSW semantic search (verbatim DB logic + optional channel scope).

    `job` only attributes the query-embed's gateway cost event; the local
    Postgres access below is untouched by gateway mode."""
    psycopg2, extras = _db_imports()
    database_url = os.environ["DATABASE_URL"]

    embedding = _embed(query, job=job)
    vector_str = "[" + ",".join(str(x) for x in embedding) + "]"

    extra_clauses = ""
    extra_params: list[Any] = []
    if channel:
        extra_clauses += " AND creator_handle = %s"
        extra_params.append(channel)
    if exclude_ids:
        extra_clauses += " AND video_id <> ALL(%s::uuid[])"
        extra_params.append(list(exclude_ids))

    conn = psycopg2.connect(database_url)
    cur = conn.cursor(cursor_factory=extras.RealDictCursor)
    cur.execute(f"""
        SELECT DISTINCT ON (video_id)
            video_id,
            creator_handle,
            creator_niche,
            platform,
            published_at,
            outlier_score,
            views_at_capture,
            creator_follower_count,
            content,
            is_hook,
            1 - (embedding <=> %s::vector) AS similarity
        FROM transcript_chunks
        WHERE outlier_score >= %s {extra_clauses}
        ORDER BY video_id, embedding <=> %s::vector
        LIMIT %s
    """, (vector_str, min_outlier_score, *extra_params, vector_str, limit * 3))
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()

    for r in rows:
        r["combined_score"] = (r["outlier_score"] or 0) * (r["similarity"] or 0)
        r["published_at"] = str(r["published_at"])
    rows.sort(key=lambda x: x["combined_score"], reverse=True)
    return rows[:limit]


def get_video_details(video_ids):
    """Hydrate video rows by id (verbatim DB logic)."""
    psycopg2, extras = _db_imports()
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(database_url)
    cur = conn.cursor(cursor_factory=extras.RealDictCursor)
    cur.execute("""
        SELECT id, url, platform, published_at, duration_seconds,
               caption, thumbnail_url, views_at_capture, likes_at_capture,
               comments_at_capture, creator_handle, creator_follower_count,
               creator_avg_views_at_capture, creator_niche,
               outlier_score, engagement_rate, hook_transcript, full_transcript
        FROM videos
        WHERE id = ANY(%s::uuid[])
    """, (video_ids,))
    rows = {str(r["id"]): dict(r) for r in cur.fetchall()}
    cur.close()
    conn.close()
    for r in rows.values():
        r["id"] = str(r["id"])
        r["published_at"] = str(r["published_at"])
    return rows


def _run_db_search(args, job: Path, *, default_limit: int):
    """Shared local-DB search used by both outliers and hook_bank modes.

    Returns (candidates, mode, claude_queries, run_meta_basis).
    """
    history_path = job / "candidates.json"  # not used; kept for parity reference
    history_path = job / "candidates_history.json"

    history = []
    if history_path.exists():
        try:
            history = json.loads(history_path.read_text())
        except json.JSONDecodeError:
            print(f"WARNING: {history_path} was malformed; starting fresh history.")
            history = []

    prior_run_ids = {h.get("run_id", 0) for h in history if isinstance(h, dict)}
    run_id = (max(prior_run_ids) + 1) if prior_run_ids else 1

    limit = args.top_n if args.top_n is not None else default_limit

    # Parse opt-in queries (semantic mode). hook_bank ignores --query and runs
    # a random sample scoped to the channel.
    claude_queries: list[str] = []
    if getattr(args, "query", None):
        claude_queries = [q.strip() for q in args.query.split(";") if q.strip()]

    if claude_queries:
        print(f"Semantic-search mode: {len(claude_queries)} query angle(s), "
              f"min outlier {args.min_outlier}, limit {limit}"
              + (f", channel=@{args.channel}" if args.channel else ""))
        seen: dict[str, dict] = {}
        for q in claude_queries:
            print(f"  Query: {q[:80]}")
            results = semantic_search(q, min_outlier_score=args.min_outlier, limit=10,
                                      channel=args.channel, job=job)
            log_event(
                job, tool=TOOL_NAME, event="query_run",
                prompt=q,
                extra={"usage_role": args.mode,
                       "min_outlier_score": args.min_outlier,
                       "channel": args.channel,
                       "result_count": len(results)},
                render_md=False,
            )
            for r in results:
                vid_id = str(r["video_id"])
                if vid_id not in seen or r["combined_score"] > seen[vid_id]["combined_score"]:
                    seen[vid_id] = r

        details = get_video_details(list(seen.keys()))
        candidates = []
        for vid_id, chunk_data in seen.items():
            detail = details.get(vid_id, {})
            candidates.append({
                **detail,
                "similarity": chunk_data.get("similarity"),
                "combined_score": chunk_data.get("combined_score"),
                "matching_chunk": chunk_data.get("content", "")[:300],
            })
        candidates.sort(key=lambda x: x.get("combined_score", 0), reverse=True)
        candidates = candidates[:limit]
        mode = "semantic"
    else:
        filters = []
        if args.channel:
            filters.append(f"channel=@{args.channel}")
        filter_str = (", " + ", ".join(filters)) if filters else ""
        print(f"Random-sample mode: outlier >= {args.min_outlier}x, limit {limit}{filter_str}")
        candidates = random_sample(
            min_outlier=args.min_outlier,
            limit=limit,
            channel=args.channel,
        )
        mode = "random_sample"

    # Persist candidates.json + append to flat history (parity with absorbed tool).
    out_candidates = job / "candidates.json"
    out_candidates.write_text(json.dumps(candidates, indent=2))

    run_meta = {
        "run_id": run_id,
        "sampled_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "usage_role": args.mode,
        "min_outlier": args.min_outlier,
        "limit": limit,
        "channel": args.channel,
        "queries": claude_queries or None,
    }
    for c in candidates:
        history.append({**run_meta, **c})
    history_path.write_text(json.dumps(history, indent=2))

    log_event(
        job, tool=TOOL_NAME, event="candidates_saved",
        extra={
            "usage_role": args.mode,
            "run_id": run_id,
            "mode": mode,
            "min_outlier": args.min_outlier,
            "limit": limit,
            "channel": args.channel,
            "candidates": len(candidates),
            "queries_run": len(claude_queries),
            "history_total": len(history),
            "top_url": candidates[0].get("url") if candidates else "",
            "top_outlier": candidates[0].get("outlier_score") if candidates else None,
            "output": str(out_candidates.relative_to(job)),
        },
    )

    return candidates, mode, run_id, history


def mode_outliers(args, job: Path) -> int:
    print(f"Job: {job.name}  (mode=outliers — LOCAL DB is the only transcript source)")
    candidates, mode, run_id, history = _run_db_search(args, job, default_limit=50)

    if not candidates:
        print("\nLocal DB returned ZERO results. Widen the --query term and retry; "
              "if still empty, seed the DB. Do NOT fall back to Sandcastles "
              "(feedback_local_db_over_sandcastles.md).")

    print(f"\nRun #{run_id} — {len(candidates)} candidates → {job / 'candidates.json'}")
    print(f"History: {len(history)} total candidates across all runs")
    print("\nTop 5 (verbatim hook lines surfaced, not summaries):")
    for c in candidates[:5]:
        out = c.get("outlier_score") or 0
        sim = c.get("similarity")
        sim_str = f" | sim: {sim:.3f}" if sim is not None else ""
        print(f"  [{c.get('platform')}] @{c.get('creator_handle')} | outlier: {out:.1f}x{sim_str}")
        print(f"  {c.get('url')}")
        print(f"  Hook: {(c.get('hook_transcript') or c.get('matching_chunk') or '')[:160]}")
        print()
    return 0


# ---------------------------------------------------------------------------
# hook_bank : derive a ranked hook-pattern taxonomy from local-DB candidates.
# ---------------------------------------------------------------------------

_HOOK_TAXONOMY = {
    "curiosity_gap": [
        r"\bwhat (if|nobody|they don'?t)\b", r"\bhere'?s (why|what|how)\b",
        r"\bthe (real )?reason\b", r"\byou(?:'| a)?re doing .* wrong\b",
        r"\bsecret\b", r"\bnobody (tells|talks)\b",
    ],
    "counter_intuitive": [
        r"\bstop\b", r"\bactually\b", r"\bdon'?t\b", r"\bnever\b",
        r"\bwrong\b", r"\bmyth\b", r"\bopposite\b",
    ],
    "promise": [
        r"\bhow to\b", r"\bin \d+ (seconds|minutes|days|steps)\b",
        r"\bwill (make|help|get) you\b", r"\bguarantee\b", r"\bquickest\b",
    ],
    "identity_attack": [
        r"\bif you(?:'| a)?re\b", r"\bpeople who\b", r"\byou keep\b",
        r"\bstop being\b", r"\byour (biggest )?(mistake|problem)\b",
    ],
}


def _classify_hook(text: str) -> str:
    t = (text or "").lower()
    for label, patterns in _HOOK_TAXONOMY.items():
        for pat in patterns:
            if re.search(pat, t):
                return label
    return "other"


def mode_hook_bank(args, job: Path) -> int:
    print(f"Job: {job.name}  (mode=hook_bank — LOCAL DB)")
    if not args.channel:
        print("NOTE: no --channel passed; surfacing channel-agnostic hook patterns "
              "across the outlier corpus.")

    candidates, mode, run_id, history = _run_db_search(args, job, default_limit=50)

    # Low-confidence flag: < 10 indexed videos for this channel.
    if args.channel and len(candidates) < 10:
        print(f"\n⚠ LOW CONFIDENCE: only {len(candidates)} indexed videos for "
              f"@{args.channel} (< 10). Supplement with a targeted "
              f"`--mode outliers --query ...` run.")

    # Build the hook bank: classify each hook line, count frequencies, keep verbatim.
    buckets: dict[str, list[dict]] = {k: [] for k in list(_HOOK_TAXONOMY) + ["other"]}
    for c in candidates:
        hook = (c.get("hook_transcript") or c.get("matching_chunk") or "").strip()
        if not hook:
            continue
        label = _classify_hook(hook)
        buckets[label].append({
            "hook": hook[:280],
            "creator_handle": c.get("creator_handle"),
            "outlier_score": c.get("outlier_score"),
            "url": c.get("url"),
        })

    top_n = args.top_n if args.top_n is not None else 20
    ranked = sorted(
        ((label, examples) for label, examples in buckets.items() if examples),
        key=lambda kv: len(kv[1]), reverse=True,
    )
    hook_bank = {
        "channel": args.channel,
        "n_videos": len(candidates),
        "low_confidence": bool(args.channel and len(candidates) < 10),
        "taxonomy": [
            {
                "hook_type": label,
                "frequency": len(examples),
                "examples": [e["hook"] for e in examples[:top_n]],
                "detail": examples[:top_n],
            }
            for label, examples in ranked
        ],
    }

    out_path = job / "reference" / "hook_bank.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(hook_bank, indent=2))

    log_event(
        job, tool=TOOL_NAME, event="hook_bank_saved",
        extra={
            "usage_role": args.mode,
            "channel": args.channel,
            "n_videos": len(candidates),
            "top_n": top_n,
            "types": [t["hook_type"] for t in hook_bank["taxonomy"]],
            "output": str(out_path.relative_to(job)),
        },
    )

    print(f"\nSaved: {out_path.relative_to(job)}")
    print("\n" + "=" * 70)
    print("HOOK BANK — ranked patterns + verbatim examples (no quality verdicts).")
    print("=" * 70)
    for t in hook_bank["taxonomy"]:
        print(f"\n[{t['hook_type']}]  x{t['frequency']}")
        for ex in t["examples"][:5]:
            print(f"  • {ex[:120]}")
    return 0


# ===========================================================================
# optional format proposal
# ===========================================================================

def _emit_format_proposal(mode: str) -> None:
    print("\n" + "#" * 70)
    print("# FORMAT PROPOSAL (NONBLOCKING)")
    print("#")
    print("# A format proposal has been derived from the reference above.")
    print("# Surface the proposed staging / shot grammar / caption style / hook")
    print("# type when useful, then continue. Do not silently default to a static")
    print("# talking-head, and do not turn this summary into an approval gate.")
    print("#" * 70)


# ===========================================================================
# CLI
# ===========================================================================

MODES = ("video", "still_set", "hook_bank", "outliers")


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument(
        "--mode", required=True, choices=MODES,
        help="REQUIRED. Logged as usage_role. "
             "video=reference staging+format; still_set=carousel/PNG grammar; "
             "hook_bank=channel hook patterns (local DB); "
             "outliers=transcript-grounded outlier research (local DB).",
    )

    # video / still_set
    parser.add_argument(
        "--reference",
        help="[video] local mp4 or yt-dlp-able URL. "
             "[still_set] dir / glob / single PDF of reference slides.",
    )
    parser.add_argument(
        "--format-proposal", dest="format_proposal", action="store_true",
        help="[video/still_set] Emit a concise nonblocking format proposal.",
    )
    parser.add_argument(
        "--format-lock", dest="format_proposal", action="store_true",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--output",
        help="Override output path. Defaults are mode-specific under the job dir.",
    )

    # hook_bank / outliers (local DB)
    parser.add_argument(
        "--channel",
        help="[hook_bank/outliers] Scope to one creator_handle in the local DB.",
    )
    parser.add_argument(
        "--query",
        help="[outliers] Opt-in semantic-search; semicolon-separated angle queries. "
             "Omit for the cheap, bias-free random-sample default.",
    )
    parser.add_argument(
        "--top-n", dest="top_n", type=int, default=None,
        help="[hook_bank] hooks to surface (default 20). "
             "[outliers] candidate limit (default 50).",
    )
    parser.add_argument(
        "--min-outlier", type=float, default=5.0,
        help="[hook_bank/outliers] Minimum outlier_score. Default 5.0.",
    )

    # video deep-analysis tuning (absorbed from deep_analyze_video.py)
    parser.add_argument(
        "--layers", default=",".join(LAYER_ORDER),
        help="[video] Comma-separated subset of layers. Default all. "
             "Layers always execute in canonical order.",
    )
    parser.add_argument(
        "--pause-threshold", type=float, default=0.4,
        help="[video] Word-gap threshold (sec) that ends a sentence in grouping. Default 0.4.",
    )
    parser.add_argument(
        "--max-words-per-sentence", type=int, default=25,
        help="[video] Hard cap on words in a sentence anchor. Default 25.",
    )

    args = parser.parse_args()
    job = resolve_job_dir(args.job)

    log_event(
        job, tool=TOOL_NAME, event="invoked",
        extra={"usage_role": args.mode, "reference": args.reference,
               "channel": args.channel, "format_proposal": bool(args.format_proposal)},
        render_md=False,
    )

    if args.mode == "video":
        return mode_video(args, job)
    if args.mode == "still_set":
        return mode_still_set(args, job)
    if args.mode == "hook_bank":
        return mode_hook_bank(args, job)
    if args.mode == "outliers":
        return mode_outliers(args, job)

    print(f"Unknown mode: {args.mode}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
