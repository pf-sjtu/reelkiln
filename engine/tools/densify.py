"""
densify — tighten pacing via silence-clipping, time-stretch, and PASS 2 re-transcribe.

ONE canonical tool with `--mode {normal|aroll|smart|transcribe}`. Consolidates three
former backends (densify.py + densify_aroll.py + smart_densify.py) into a single
self-contained file. It clips inter-word silences from stitched audio/video,
time-stretches at ~1.22× (MEMORY: replaces the old 1.10× math-rescale), and
re-transcribes the result as PASS 2 to produce a word-timed transcript, targeting
170–200 WPM.

Modes
-----
  normal      Post-stitch pacing tightener for the VO+avatar pipeline. Reads
              <job>/final_raw.mp4 + <job>/transcript.json (PASS 1 from synth_voice),
              silence-clips, time-stretches (--speed, default 1.22), re-transcribes
              (PASS 2), and writes densify_meta.json. Idempotent on the
              final_raw_predensify.mp4 + transcript_pass1.json snapshots.

  aroll       A-roll window variant (Joseph's real-footage path). Silence-clip ONLY
              (no time-stretch by default — the natural recording cadence is the
              ground truth and the face/motion envelope must be preserved). Operates
              on explicit --input / --output paths. Requires video footage;
              audio-only inputs (including MP3s with cover art) are rejected.

  smart       Final-file variant. Silence-clip the assembled composite, PASS-2
              transcribe to measure current WPM, then stretch toward --target-wpm
              capped at --max-stretch (1.22×), then PASS-3 transcribe the result.

  transcribe  Standalone word-timed transcription of any mp4/mp3 — no silence-clip,
              no stretch. Pure PASS 2 on the file as-is.

`--mode` is REQUIRED and logged as `usage_role`. `--job` is required for `normal`
(it resolves <job_dir>/ artifacts); the `aroll` / `smart` / `transcribe` modes take
explicit --input / --output paths (Joseph's pipeline does NOT use .current_job),
and `--job`, when supplied, is used only for event logging.

WPM is ALWAYS emitted into densify_meta.json (`final_wpm`) so pacing can be checked:
    WPM = (PASS-2/PASS-3 word count) / final_duration_sec * 60

Clip-surgery sub-ops (`clip-extract`, `speed-ramp`, `surgical-cut`,
`transcript-token-patch`) compose with whichever mode produced the transcript they
operate on, via `--sub-op`.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import gateway  # noqa: E402  dual mode: VIDEOCLAW_API_KEY set → gateway routes Scribe

try:
    from dotenv import load_dotenv  # noqa: E402

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is best-effort
    pass


# ---------------------------------------------------------------------------
# Constants (preserved verbatim from the absorbed backends)
# ---------------------------------------------------------------------------

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
SCRIBE_MODEL = "scribe_v2"  # elevenlabs.py / densify_aroll.py — Scribe v2 word-timed
DEFAULT_FILLERS = {"um", "uh", "er", "hmm", "ah", "mhm", "mm"}

# Punchy short-form default. MEMORY (feedback_densify_pipeline.md) + CLAUDE.md rule 15
# both name 1.22× as the punchy default that replaced the old 1.10× math-rescale.
DEFAULT_SPEED = 1.22
DEFAULT_MAX_STRETCH = 1.22  # hard ceiling — beyond this lipsync drifts visibly
DEFAULT_TARGET_WPM = 200.0

# Resolved job dir (or None), set once in main(). transcribe_elevenlabs() is a
# bare helper reached via re_transcribe() from every mode, so the gateway branch
# reads the job from here for client_job attribution + cost logging.
_GATEWAY_JOB: Path | None = None


# ---------------------------------------------------------------------------
# ffprobe / Scribe helpers (inlined so this file is self-contained)
# ---------------------------------------------------------------------------


def ffprobe_duration(path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {res.stderr.strip()}")
    out = res.stdout.strip()
    if not out:
        raise RuntimeError(f"ffprobe produced no duration for {path} (0-byte / corrupt?).")
    return float(out)


def _import_elevenlabs_sdk():
    """Import the official `elevenlabs` SDK without colliding with a sibling
    tool module also named elevenlabs.py. We scrub our own dir off sys.path for
    the duration of the import so `import elevenlabs.client` resolves to the
    installed package, not the local wrapper (densify_aroll.py did this)."""
    import importlib

    here = str(Path(__file__).resolve().parent)
    saved = list(sys.path)
    sys.path[:] = [p for p in sys.path if p != here and p != ""]
    try:
        return importlib.import_module("elevenlabs.client").ElevenLabs
    finally:
        sys.path[:] = saved


def extract_audio(video_path: Path) -> Path:
    """Extract audio from video to a sibling .mp3 for transcription.

    Matches elevenlabs.py extract_audio: mp3, 128k. (For .mp3/.wav inputs that are
    already audio we still re-encode to a temp mp3 to normalize the container.)"""
    audio_path = video_path.with_suffix(".densify_audio.mp3")
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path), "-vn",
         "-acodec", "mp3", "-ab", "128k", str(audio_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr[-800:]}")
    return audio_path


def _normalize_scribe(data: dict) -> dict:
    """Normalize a raw ElevenLabs Scribe STT response to densify's canonical
    {"text", "language", "words":[{"word","start","end"}, ...]} shape.

    Mirrors EXACTLY the post-processing the raw SDK path below applies to
    `result.model_dump()`: drop "spacing" tokens, map per-word "text" → "word",
    "language_code" → "language". The gateway passes ElevenLabs' STT JSON
    through UNMODIFIED (same schema the SDK dumps), so the same normalization
    applies to both. Keep the two in lockstep if either changes.
    """
    words = []
    for w in data.get("words", []):
        if w.get("type") == "spacing":
            continue
        words.append({
            "word": w.get("text", w.get("word", "")),
            "start": float(w.get("start", 0) or 0),
            "end": float(w.get("end", 0) or 0),
        })
    return {
        "text": data.get("text", ""),
        "words": words,
        "language": data.get("language_code", "eng"),
    }


def transcribe_elevenlabs(audio_path: Path) -> dict:
    """Send audio to ElevenLabs Scribe v2 for word-level transcription.

    Returns {"text", "language", "words":[{"word","start","end"}, ...]}.

    DUAL MODE: VIDEOCLAW_API_KEY set → the call routes through the gateway
    (gateway.upload turns the local audio file into a signed GCS URL; the server
    hands it to ElevenLabs as cloud_storage_url and returns the STT JSON
    verbatim in res["output"]). Otherwise the raw-key SDK path below runs
    unchanged. No key of either kind → emits the same PLACEHOLDER transcript
    shape as elevenlabs.py (remotion_render.py refuses to render that). Exact
    model/params preserved: model_id=scribe_v2, language_code="eng",
    diarize=False, tag_audio_events=False.
    """
    if gateway.enabled():
        print(f"Sending to ElevenLabs Scribe via gateway ({SCRIBE_MODEL})...")
        # Cost: densify's own log events carry no estimate_usd (Scribe cost was
        # never locally logged), so gateway.run's single gateway_call event is
        # the ONLY cost record — no double count (cf. mint_image, which passes
        # client_job= instead because it logs estimate_usd itself). job=None
        # (path-based modes without --job) skips client_job + cost log cleanly.
        res = gateway.run(
            "synth_voice", mode="transcribe",
            references=[audio_path],  # local path → gateway.upload → signed GCS URL
            params={"diarize": False},  # matches the raw SDK call below
            job=_GATEWAY_JOB,
            timeout_s=900,
        )
        # res["output"] is ElevenLabs' response passed through unmodified —
        # normalize it exactly like the SDK dump.
        return _normalize_scribe(res["output"])

    if not ELEVENLABS_API_KEY:
        print("[SKIP] No ELEVENLABS_API_KEY — generating placeholder transcript")
        return {
            "words": [{"word": "PLACEHOLDER", "start": 0.0, "end": 1.0}],
            "text": "PLACEHOLDER TRANSCRIPT",
            "language": "unknown",
        }

    ElevenLabs = _import_elevenlabs_sdk()
    print(f"Sending to ElevenLabs Scribe ({SCRIBE_MODEL})...")
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

    with open(audio_path, "rb") as f:
        result = client.speech_to_text.convert(
            file=f,
            model_id=SCRIBE_MODEL,
            tag_audio_events=False,
            language_code="eng",
            diarize=False,
        )

    data = result.model_dump() if hasattr(result, "model_dump") else dict(result)

    words = []
    for w in data.get("words", []):
        if w.get("type") == "spacing":
            continue
        words.append({
            "word": w.get("text", w.get("word", "")),
            "start": float(w.get("start", 0) or 0),
            "end": float(w.get("end", 0) or 0),
        })

    return {
        "text": data.get("text", ""),
        "words": words,
        "language": data.get("language_code", "eng"),
    }


def re_transcribe(media_path: Path) -> dict:
    """Extract audio + Scribe-transcribe, cleaning up the temp audio file."""
    audio_path = extract_audio(media_path)
    try:
        return transcribe_elevenlabs(audio_path)
    finally:
        audio_path.unlink(missing_ok=True)


def _word_text(w: dict) -> str:
    """Words come in two shapes across the absorbed backends: {"word":...}
    (densify.py / elevenlabs Scribe) and {"text":...} (densify_aroll.py). Read
    either."""
    return w.get("word", w.get("text", "")) or ""


# ---------------------------------------------------------------------------
# Filler stripping (from densify.py)
# ---------------------------------------------------------------------------


def filter_fillers(words: list[dict], fillers: set[str]) -> tuple[list[dict], list[dict]]:
    """Drop transcript words whose normalized form matches the filler set.
    Normalization: lowercase, strip surrounding punctuation. Returns (kept, dropped)."""
    if not fillers:
        return words, []
    kept: list[dict] = []
    dropped: list[dict] = []
    for w in words:
        norm = _word_text(w).strip().strip(".,!?;:\"'").lower()
        if norm in fillers:
            dropped.append(w)
        else:
            kept.append(w)
    return kept, dropped


# ---------------------------------------------------------------------------
# Keep-segment construction (from densify.py — the merge-and-pad variant)
# ---------------------------------------------------------------------------


def build_keep_segments(
    words: list[dict],
    head_pad: float,
    tail_pad: float,
    max_inter_gap: float,
    protected_windows: list[tuple[float, float]] | None = None,
) -> list[tuple[float, float]]:
    """Given transcript words, return [(start_sec, end_sec), ...] segments to keep.

    head_pad/tail_pad: seconds of buffer before/after each word.
    max_inter_gap: when the gap between words (in the ORIGINAL media) exceeds this,
        split into separate phrases (the silence between gets clipped out).
    protected_windows: (start,end) windows preserved entirely (visual-hook silences).
    """
    if not words:
        return list(protected_windows or [])

    segments: list[list[float]] = []
    prev_end: float | None = None

    for w in words:
        ws, we = float(w["start"]), float(w["end"])
        s = max(0.0, ws - head_pad)
        e = we + tail_pad

        if prev_end is None:
            segments.append([s, e])
        else:
            original_gap = ws - prev_end
            if original_gap <= max_inter_gap:
                segments[-1][1] = max(segments[-1][1], e)
            else:
                segments.append([s, e])
        prev_end = we

    for pw in (protected_windows or []):
        segments.append([float(pw[0]), float(pw[1])])

    segments.sort(key=lambda x: x[0])
    merged: list[list[float]] = []
    for s, e in segments:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])

    return [(round(s, 4), round(e, 4)) for s, e in merged]


# ---------------------------------------------------------------------------
# Silence-clip — two recipes, preserved from the two backends
# ---------------------------------------------------------------------------


def silence_clip_faded(
    video_in: Path,
    keep_segments: list[tuple[float, float]],
    video_out: Path,
    fade_ms: float = 30.0,
) -> None:
    """densify.py recipe: per-segment trim + 30ms afades at every cut → concat,
    one ffmpeg pass, libx264 crf18 / aac 192k.

    Why fades: every silence-clip cut is an audio splice; a 30ms fade kills the
    subliminal pop that audiences hear as "AI-edited" without being audible itself.
    """
    if not keep_segments:
        raise ValueError("No keep segments provided.")

    n = len(keep_segments)
    fade = fade_ms / 1000.0

    parts: list[str] = []
    parts.append(f"[0:v]split={n}" + "".join(f"[vin{i}]" for i in range(n)))
    parts.append(f"[0:a]asplit={n}" + "".join(f"[ain{i}]" for i in range(n)))

    for i, (s, e) in enumerate(keep_segments):
        seg_dur = e - s
        parts.append(f"[vin{i}]trim={s}:{e},setpts=PTS-STARTPTS[v{i}]")
        if seg_dur > 2 * fade:
            parts.append(
                f"[ain{i}]atrim={s}:{e},asetpts=PTS-STARTPTS,"
                f"afade=t=in:st=0:d={fade:.4f},"
                f"afade=t=out:st={seg_dur - fade:.4f}:d={fade:.4f}[a{i}]"
            )
        else:
            parts.append(f"[ain{i}]atrim={s}:{e},asetpts=PTS-STARTPTS[a{i}]")

    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(n))
    parts.append(f"{concat_inputs}concat=n={n}:v=1:a=1[v][a]")
    filter_complex = ";".join(parts)

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video_in),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        str(video_out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg silence-clip failed: {res.stderr[-1000:]}")


def silence_clip_select(
    video_in: Path,
    keep_segments: list[tuple[float, float]],
    video_out: Path,
) -> None:
    """densify_aroll.py recipe: select/aselect extract+concat, frame-precise,
    single pass, A/V sync preserved. libx264 crf18 preset fast, yuv420p, aac 192k.

    Used by the `aroll` mode — the select filter operates on the same timeline
    with matching boundaries, so the face/motion envelope stays clean for
    downstream lipsync without re-alignment."""
    if not keep_segments:
        raise ValueError("no segments to keep")
    video_out.parent.mkdir(parents=True, exist_ok=True)

    v_expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in keep_segments)
    a_expr = v_expr

    filter_complex = (
        f"[0:v]select='{v_expr}',setpts=N/FRAME_RATE/TB[v];"
        f"[0:a]aselect='{a_expr}',asetpts=N/SR/TB[a]"
    )

    cmd = [
        "ffmpeg", "-y", "-i", str(video_in),
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        str(video_out),
    ]
    print(f"[densify] running ffmpeg select on {len(keep_segments)} segments → {video_out.name}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-2000:], file=sys.stderr)
        raise RuntimeError(f"ffmpeg silence-clip (select) failed: {res.stderr[-1000:]}")


def time_stretch(video_in: Path, video_out: Path, speed: float) -> None:
    """ffmpeg time-stretch via setpts (video) and atempo (audio).

    densify.py recipe: setpts=PTS/speed + atempo=speed, libx264 crf18 preset medium.
    atempo supports 0.5–2.0 per filter; we expect 1.0–2.0 here."""
    if speed <= 0:
        raise ValueError(f"speed must be > 0, got {speed}")

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(video_in),
        "-filter:v", f"setpts=PTS/{speed:.4f}",
        "-filter:a", f"atempo={speed:.4f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        str(video_out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg time-stretch failed: {res.stderr[-1000:]}")


def time_stretch_filtercomplex(src: Path, dst: Path, factor: float) -> None:
    """smart_densify.py recipe: filter_complex setpts/atempo, libx264 crf19 preset
    fast. Kept distinct because smart mode shipped at crf19/fast."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(src),
        "-filter_complex",
        f"[0:v]setpts=PTS/{factor}[v];[0:a]atempo={factor}[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "19",
        "-c:a", "aac", "-b:a", "192k",
        str(dst),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg stretch failed: {res.stderr[-500:]}")


# ---------------------------------------------------------------------------
# --protect parsing
# ---------------------------------------------------------------------------


def parse_protect(specs: list[str] | None) -> list[tuple[float, float]]:
    """Parse repeatable --protect 'start,end' windows (seconds)."""
    out: list[tuple[float, float]] = []
    for spec in (specs or []):
        try:
            s, e = (float(x) for x in spec.split(","))
            out.append((s, e))
        except Exception:
            sys.exit(f"ERROR: --protect expects 'start,end' (got {spec!r})")
    return out


# ---------------------------------------------------------------------------
# MODE: normal — post-stitch VO+avatar pacing tightener
# ---------------------------------------------------------------------------


def run_normal(args, job) -> int:
    final_raw = job / "final_raw.mp4"
    transcript_path = job / "transcript.json"
    transcript_pass1 = job / "transcript_pass1.json"
    predensify = job / "final_raw_predensify.mp4"
    meta_path = job / "densify_meta.json"

    if not transcript_path.exists():
        sys.exit(f"ERROR: {transcript_path} not found. Run synth_voice first.")

    # Idempotency: snapshot final_raw.mp4 → predensify + transcript.json → PASS 1.
    if not predensify.exists():
        if not final_raw.exists():
            sys.exit(f"ERROR: {final_raw} not found. Run synth_voice first.")
        shutil.copy2(final_raw, predensify)
        print(f"Snapshotted {final_raw.name} → {predensify.name}")
    else:
        print(f"Reusing existing {predensify.name} as densify input.")

    if not transcript_pass1.exists():
        shutil.copy2(transcript_path, transcript_pass1)
        print(f"Snapshotted {transcript_path.name} → {transcript_pass1.name} (PASS 1 cache)")
        transcript = json.loads(transcript_path.read_text())
    else:
        print(f"Reusing existing {transcript_pass1.name} as PASS 1 transcript.")
        transcript = json.loads(transcript_pass1.read_text())

    words = transcript.get("words", [])
    if not words:
        sys.exit("ERROR: transcript has no words.")

    extra_strips = {w.strip().lower() for w in args.also_strip.split(",") if w.strip()}
    strip_fillers = args.strip_fillers or bool(extra_strips)
    fillers_used: set[str] = set()
    dropped_words: list[dict] = []
    if strip_fillers:
        fillers_used = DEFAULT_FILLERS | extra_strips
        words, dropped_words = filter_fillers(words, fillers_used)
        dropped_dur = sum(float(w["end"]) - float(w["start"]) for w in dropped_words)
        print(f"Stripped {len(dropped_words)} filler words ({dropped_dur:.2f}s of audio): "
              f"{', '.join(_word_text(w) for w in dropped_words[:12])}"
              f"{' …' if len(dropped_words) > 12 else ''}")

    in_dur = ffprobe_duration(predensify)
    print(f"Input duration: {in_dur:.2f}s, {len(words)} words")

    # Protected silence windows — CLI overrides script.json.
    protected_windows: list[tuple[float, float]] = []
    if args.protect:
        protected_windows = parse_protect(args.protect)
    else:
        script_path = job / "script.json"
        if script_path.exists():
            try:
                script = json.loads(script_path.read_text())
                for w in script.get("protected_silence_windows", []) or []:
                    protected_windows.append((float(w["start_sec"]), float(w["end_sec"])))
            except Exception as exc:
                print(f"WARN: couldn't read protected_silence_windows from script.json: {exc}")
    if protected_windows:
        print(f"Protected silence windows: {protected_windows}")

    keep_segments = build_keep_segments(
        words,
        head_pad=args.head_pad_ms / 1000,
        tail_pad=args.tail_pad_ms / 1000,
        max_inter_gap=args.max_gap_ms / 1000,
        protected_windows=protected_windows or None,
    )
    kept_seconds = sum(e - s for s, e in keep_segments)
    print(f"Keep-segments: {len(keep_segments)} phrases, "
          f"{kept_seconds:.2f}s of {in_dur:.2f}s ({100 * kept_seconds / in_dur:.0f}%)")

    clipped = job / "final_raw_clipped.mp4"
    t0 = time.perf_counter()
    silence_clip_faded(predensify, keep_segments, clipped)
    clipped_dur = ffprobe_duration(clipped)
    print(f"Silence-clipped: {clipped_dur:.2f}s ({in_dur - clipped_dur:.2f}s removed) "
          f"in {time.perf_counter() - t0:.1f}s")

    if args.no_restretch:
        shutil.move(str(clipped), str(final_raw))
        stretched_dur = clipped_dur
        print("Skipped time-stretch (--no-restretch).")
    else:
        t0 = time.perf_counter()
        stretched = job / "final_raw_stretched.mp4"
        time_stretch(clipped, stretched, args.speed)
        stretched_dur = ffprobe_duration(stretched)
        clipped.unlink(missing_ok=True)
        shutil.move(str(stretched), str(final_raw))
        print(f"Time-stretched {args.speed}×: {stretched_dur:.2f}s "
              f"in {time.perf_counter() - t0:.1f}s")

    final_words = words
    if args.no_retranscribe:
        print("Skipped re-transcribe (--no-retranscribe). transcript.json is now STALE.")
    else:
        t0 = time.perf_counter()
        new_transcript = re_transcribe(final_raw)
        transcript_path.write_text(json.dumps(new_transcript, indent=2))
        final_words = new_transcript.get("words", [])
        print(f"Re-transcribed: {len(final_words)} words, "
              f"{len(new_transcript.get('text', ''))} chars, "
              f"in {time.perf_counter() - t0:.1f}s")

    # WPM is always computed and written into densify_meta.json.
    final_wpm = (len(final_words) / max(stretched_dur, 0.001)) * 60

    target_wpm = None
    script_path = job / "script.json"
    if script_path.exists():
        try:
            target_wpm = json.loads(script_path.read_text()).get("target_wpm_post_densify")
        except Exception:
            pass

    meta = {
        "mode": "normal",
        "input_duration_sec": round(in_dur, 3),
        "words_in": len(words),
        "keep_segments": len(keep_segments),
        "kept_duration_sec": round(kept_seconds, 3),
        "clipped_duration_sec": round(clipped_dur, 3),
        "speed": args.speed,
        "final_duration_sec": round(stretched_dur, 3),
        "final_word_count": len(final_words),
        "final_wpm": round(final_wpm, 1),
        "target_wpm": target_wpm,
        "compression_ratio": round(in_dur / max(stretched_dur, 0.001), 3),
        "fillers_stripped": sorted(fillers_used) if strip_fillers else [],
        "filler_words_dropped": len(dropped_words),
        "settings": {
            "max_gap_ms": args.max_gap_ms,
            "head_pad_ms": args.head_pad_ms,
            "tail_pad_ms": args.tail_pad_ms,
            "speed": args.speed,
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    log_event(job, tool="densify.py", event="densify_completed",
              extra={**meta, "usage_role": "normal"})

    print()
    print(f"Densified: {in_dur:.1f}s → {stretched_dur:.1f}s "
          f"({100 * (1 - stretched_dur / in_dur):.0f}% shorter, "
          f"effective {meta['compression_ratio']:.2f}× faster delivery)")
    print(f"  final_wpm: {final_wpm:.0f} WPM")

    if target_wpm and final_wpm > target_wpm * 1.15:
        print(f"⚠  WPM overrun: post-densify {final_wpm:.0f} WPM vs target {target_wpm} WPM "
              f"({100 * (final_wpm / target_wpm - 1):.0f}% over).")
        print("   Consider re-running with --speed 1.05 or --max-gap-ms 250 for slower pacing.")

    print("  final_raw.mp4            (densified + sped output)")
    print("  final_raw_predensify.mp4 (preserved input)")
    print("  transcript.json          (PASS 2 — accurate timestamps for Remotion)")
    print("  densify_meta.json")
    return 0


# ---------------------------------------------------------------------------
# MODE: aroll — silence-clip a real-footage a-roll window (NO stretch)
# ---------------------------------------------------------------------------


def build_keep_segments_aroll(
    words: list[dict],
    head_pad_ms: int,
    tail_pad_ms: int,
    max_gap_ms: int,
    total_duration: float,
    protected: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """densify_aroll.py keep-segment logic (kept distinct: it walks word-pairs and
    clamps the final segment to total_duration, preserving the face/motion envelope)."""
    if not words:
        return [(0.0, total_duration)]

    head_pad = head_pad_ms / 1000.0
    tail_pad = tail_pad_ms / 1000.0
    max_gap = max_gap_ms / 1000.0

    segments: list[tuple[float, float]] = []
    seg_start = max(0.0, float(words[0]["start"]) - head_pad)
    last_end = float(words[0]["end"]) + tail_pad

    for i in range(1, len(words)):
        prev = words[i - 1]
        curr = words[i]
        gap = float(curr["start"]) - float(prev["end"])

        gap_overlaps_protected = any(
            (float(prev["end"]) <= ps <= float(curr["start"]))
            or (float(prev["end"]) <= pe <= float(curr["start"]))
            or (ps <= float(prev["end"]) and pe >= float(curr["start"]))
            for ps, pe in protected
        )

        if gap <= max_gap or gap_overlaps_protected:
            last_end = float(curr["end"]) + tail_pad
            continue
        else:
            segments.append((seg_start, last_end))
            seg_start = max(float(prev["end"]) + tail_pad, float(curr["start"]) - head_pad)
            last_end = float(curr["end"]) + tail_pad

    segments.append((seg_start, min(last_end, total_duration)))
    return segments


def run_aroll(args, job) -> int:
    video_path = Path(args.input)
    if not video_path.exists():
        sys.exit(f"ERROR: video not found: {video_path}")
    if not args.output:
        sys.exit("ERROR: --mode aroll requires --output.")
    out_path = Path(args.output)

    # Validate before transcription (which may be paid) or any output writes.
    # Uppercase V excludes attached pictures, such as an MP3's cover art.
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "V:0",
             "-show_entries", "stream=index", "-of", "csv=p=0", str(video_path)],
            capture_output=True, text=True,
        )
    except OSError as exc:
        sys.exit(f"ERROR: cannot inspect {video_path} with ffprobe: {exc}")
    if probe.returncode != 0:
        sys.exit(f"ERROR: cannot inspect {video_path} with ffprobe: {probe.stderr.strip()}")
    if not probe.stdout.strip():
        sys.exit(
            "ERROR: --mode aroll requires a video stream; "
            f"{video_path} has no video footage. Audio-only input is not supported. "
            "Use --mode transcribe if you only need a transcript."
        )

    # Transcript: provided, or transcribe the input first (PASS 1 of aroll).
    if args.transcript:
        transcript = json.loads(Path(args.transcript).read_text())
    elif args.transcribe:
        transcript = re_transcribe(video_path)
        side = video_path.with_suffix(".transcript.json")
        side.write_text(json.dumps(transcript, indent=2))
        print(f"[densify] wrote {side}")
    else:
        sys.exit("ERROR: --mode aroll needs --transcript <path> or --transcribe.")

    words = transcript.get("words", [])
    if not words:
        sys.exit("ERROR: transcript has no words; nothing to densify.")

    protected = parse_protect(args.protect)
    duration = ffprobe_duration(video_path)
    segments = build_keep_segments_aroll(
        words=words,
        head_pad_ms=args.head_pad_ms,
        tail_pad_ms=args.tail_pad_ms,
        max_gap_ms=args.max_gap_ms,
        total_duration=duration,
        protected=protected,
    )
    kept = sum(e - s for s, e in segments)
    print(f"[densify] {len(segments)} keep-segments, {kept:.2f}s kept of {duration:.2f}s raw "
          f"({100 * kept / max(duration, 0.001):.1f}%)")

    # aroll: silence-clip only (no stretch — natural cadence is ground truth) unless
    # the operator explicitly opts into a stretch via --speed.
    if args.no_restretch or args.speed in (None, 1.0):
        silence_clip_select(video_path, segments, out_path)
    else:
        tmp = out_path.with_name(out_path.stem + ".silenced.mp4")
        silence_clip_select(video_path, segments, tmp)
        time_stretch(tmp, out_path, args.speed)
        tmp.unlink(missing_ok=True)

    out_dur = ffprobe_duration(out_path)
    out_words = transcript.get("words", [])
    out_wpm = (len(out_words) / max(out_dur, 0.001)) * 60

    meta = {
        "mode": "aroll",
        "input_mp4": str(video_path),
        "output_mp4": str(out_path),
        "raw_duration_sec": round(duration, 3),
        "keep_segments": len(segments),
        "kept_duration_sec": round(kept, 3),
        "final_duration_sec": round(out_dur, 3),
        "final_word_count": len(out_words),
        "final_wpm": round(out_wpm, 1),
        "speed": args.speed if not args.no_restretch else 1.0,
        "settings": {
            "max_gap_ms": args.max_gap_ms,
            "head_pad_ms": args.head_pad_ms,
            "tail_pad_ms": args.tail_pad_ms,
        },
    }
    meta_path = out_path.with_name(f"{out_path.stem}.densify_meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))
    if job is not None:
        log_event(job, tool="densify.py", event="densify_completed",
                  extra={**meta, "usage_role": "aroll"})

    print(f"[densify] wrote {out_path} ({out_path.stat().st_size // 1024} KB, {out_dur:.2f}s, "
          f"{out_wpm:.0f} WPM)")
    print(f"[densify] meta → {meta_path.name}")
    return 0


# ---------------------------------------------------------------------------
# MODE: smart — silence-clip + WPM-aware stretch on the final composite
# ---------------------------------------------------------------------------


def run_smart(args, job) -> int:
    src = Path(args.input)
    if not src.exists():
        sys.exit(f"ERROR: missing input: {src}")
    if not args.output:
        sys.exit("ERROR: --mode smart requires --output.")
    dst = Path(args.output)
    dst.parent.mkdir(parents=True, exist_ok=True)

    target_wpm = args.target_wpm if args.target_wpm is not None else DEFAULT_TARGET_WPM
    max_stretch = args.max_stretch if args.max_stretch is not None else DEFAULT_MAX_STRETCH

    work_dir = Path(tempfile.mkdtemp(prefix="densify_smart_"))
    silenced = work_dir / "silenced.mp4"

    # Step 1 — silence-clip (transcribe PASS 1, then select/aselect, no stretch).
    print(f"[smart] silence-clip → {silenced.name}")
    pass1 = re_transcribe(src)
    words = pass1.get("words", [])
    if not words:
        sys.exit("ERROR: transcript has no words; nothing to densify.")
    duration = ffprobe_duration(src)
    segments = build_keep_segments_aroll(
        words=words,
        head_pad_ms=args.head_pad_ms,
        tail_pad_ms=args.tail_pad_ms,
        max_gap_ms=args.max_gap_ms,
        total_duration=duration,
        protected=parse_protect(args.protect),
    )
    silence_clip_select(src, segments, silenced)

    # Step 2 — PASS-2 transcribe the silenced output to measure current WPM.
    print("[smart] PASS-2 transcribe silenced output to compute current WPM")
    silenced_dur = ffprobe_duration(silenced)
    pass2 = re_transcribe(silenced)
    word_count = len(pass2.get("words", []))
    current_wpm = (word_count / silenced_dur) * 60.0 if silenced_dur > 0 else 0
    print(f"[smart] silenced: {silenced_dur:.2f}s, {word_count} words, {current_wpm:.1f} WPM")

    # Step 3 — decide stretch factor (capped at max_stretch).
    if current_wpm >= target_wpm:
        stretch = 1.0
        decision = (f"already at {current_wpm:.1f} WPM ≥ target {target_wpm:.0f} "
                    f"— no stretch needed")
    else:
        ideal = target_wpm / current_wpm if current_wpm > 0 else max_stretch
        stretch = min(ideal, max_stretch)
        if ideal > max_stretch:
            decision = (f"ideal stretch {ideal:.3f}× exceeds cap {max_stretch}× — applying cap, "
                        f"final WPM will be {current_wpm * stretch:.1f} (under target)")
        else:
            decision = f"applying stretch {stretch:.3f}× → final WPM {current_wpm * stretch:.1f}"
    print(f"[smart] decision: {decision}")

    # Step 4 — apply stretch (or copy if ~1.0).
    if abs(stretch - 1.0) < 0.005:
        shutil.copy2(silenced, dst)
        print(f"[smart] copied silenced → {dst.name}")
    else:
        time_stretch_filtercomplex(silenced, dst, stretch)
        print(f"[smart] stretched → {dst.name}")

    # Step 5 — PASS-3 transcribe the final.
    print("[smart] PASS-3 transcribe final")
    final = re_transcribe(dst)
    transcript_path = dst.with_name(f"{dst.stem}.transcript.json")
    transcript_path.write_text(json.dumps(final, indent=2))
    final_dur = ffprobe_duration(dst)
    final_words = len(final.get("words", []))
    final_wpm = (final_words / final_dur) * 60.0 if final_dur > 0 else 0

    meta = {
        "mode": "smart",
        "input_mp4": str(src),
        "output_mp4": str(dst),
        "transcript": str(transcript_path),
        "silenced_duration_sec": round(silenced_dur, 3),
        "silenced_word_count": word_count,
        "silenced_wpm": round(current_wpm, 1),
        "target_wpm": target_wpm,
        "max_stretch": max_stretch,
        "applied_stretch": round(stretch, 4),
        "final_duration_sec": round(final_dur, 3),
        "final_word_count": final_words,
        "final_wpm": round(final_wpm, 1),
        "decision": decision,
        "max_gap_ms": args.max_gap_ms,
    }
    meta_path = dst.with_name(f"{dst.stem}.densify_meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))
    if job is not None:
        log_event(job, tool="densify.py", event="densify_completed",
                  extra={**meta, "usage_role": "smart"})

    # best-effort temp cleanup
    try:
        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass

    print(f"[smart] DONE: {final_dur:.2f}s, {final_words} words, {final_wpm:.1f} WPM "
          f"(target {target_wpm:.0f})")
    print(f"[smart] transcript → {transcript_path.name}")
    print(f"[smart] meta → {meta_path.name}")
    return 0


# ---------------------------------------------------------------------------
# MODE: transcribe — standalone PASS 2 word-timed transcription (no edits)
# ---------------------------------------------------------------------------


def run_transcribe(args, job) -> int:
    src = Path(args.input)
    if not src.exists():
        sys.exit(f"ERROR: missing input: {src}")

    out_path = Path(args.output) if args.output else src.with_suffix(".transcript.json")
    print(f"[transcribe] PASS-2 transcribing {src.name} (no silence-clip, no stretch)")
    transcript = re_transcribe(src)
    out_path.write_text(json.dumps(transcript, indent=2))

    dur = ffprobe_duration(src)
    n_words = len(transcript.get("words", []))
    wpm = (n_words / dur) * 60.0 if dur > 0 else 0

    meta = {
        "mode": "transcribe",
        "input": str(src),
        "transcript": str(out_path),
        "final_duration_sec": round(dur, 3),
        "final_word_count": n_words,
        "final_wpm": round(wpm, 1),
    }
    meta_path = out_path.with_name(f"{out_path.stem}.densify_meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))
    if job is not None:
        log_event(job, tool="densify.py", event="transcribe_completed",
                  extra={**meta, "usage_role": "transcribe"})

    print(f"[transcribe] {n_words} words, {dur:.2f}s, {wpm:.0f} WPM → {out_path.name}")
    print(f"[transcribe] meta → {meta_path.name}")
    return 0


# ---------------------------------------------------------------------------
# Clip-surgery sub-ops — word-timed precision on densified/pre-densified media
# ---------------------------------------------------------------------------


def _load_surgery_media_and_transcript(args, job) -> tuple[Path, dict]:
    """Resolve the media file + word-timed transcript a sub-op operates on."""
    if args.input:
        media = Path(args.input)
    elif job is not None:
        media = job / "final_raw.mp4"
    else:
        sys.exit("ERROR: sub-op needs --input <media> (or --job to default to final_raw.mp4).")
    if not media.exists():
        sys.exit(f"ERROR: media not found: {media}")

    if args.transcript:
        transcript = json.loads(Path(args.transcript).read_text())
    elif job is not None and (job / "transcript.json").exists():
        transcript = json.loads((job / "transcript.json").read_text())
    else:
        transcript = {"words": []}
    return media, transcript


def _find_word_time(words: list[dict], token: str, which: str) -> float | None:
    """Find the start (which='start') or end (which='end') time of the first
    transcript word matching `token` (case-insensitive, punctuation-stripped)."""
    norm_target = token.strip().strip(".,!?;:\"'").lower()
    for w in words:
        if _word_text(w).strip().strip(".,!?;:\"'").lower() == norm_target:
            return float(w[which])
    return None


def run_sub_op(args, job) -> int:
    op = args.sub_op
    media, transcript = _load_surgery_media_and_transcript(args, job)
    words = transcript.get("words", [])

    def resolve_t(val: str | None, which: str) -> float | None:
        """A time may be a float (seconds) or a word token to look up."""
        if val is None:
            return None
        try:
            return float(val)
        except ValueError:
            t = _find_word_time(words, val, which)
            if t is None:
                sys.exit(f"ERROR: token {val!r} not found in transcript.")
            return t

    out_path = Path(args.output) if args.output else media.with_name(
        f"{media.stem}.{op}{media.suffix}")

    if op == "clip-extract":
        s = resolve_t(args.in_, "start")
        e = resolve_t(args.out, "end")
        if s is None or e is None:
            sys.exit("ERROR: clip-extract needs --in and --out.")
        silence_clip_select(media, [(s, e)], out_path)
        print(f"[clip-extract] {s:.3f}–{e:.3f}s → {out_path.name}")

    elif op == "speed-ramp":
        s = resolve_t(args.in_, "start")
        e = resolve_t(args.out, "end")
        factor = args.speed if args.speed not in (None, 1.0) else DEFAULT_SPEED
        if s is None or e is None:
            sys.exit("ERROR: speed-ramp needs --in and --out.")
        dur = ffprobe_duration(media)
        # head | ramped-window | tail, concatenated. atempo on the window only.
        fc = (
            f"[0:v]trim=0:{s},setpts=PTS-STARTPTS[vh];"
            f"[0:a]atrim=0:{s},asetpts=PTS-STARTPTS[ah];"
            f"[0:v]trim={s}:{e},setpts=(PTS-STARTPTS)/{factor}[vm];"
            f"[0:a]atrim={s}:{e},asetpts=PTS-STARTPTS,atempo={factor}[am];"
            f"[0:v]trim={e}:{dur},setpts=PTS-STARTPTS[vt];"
            f"[0:a]atrim={e}:{dur},asetpts=PTS-STARTPTS[at];"
            f"[vh][ah][vm][am][vt][at]concat=n=3:v=1:a=1[v][a]"
        )
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(media),
               "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
               "-c:v", "libx264", "-preset", "medium", "-crf", "18",
               "-c:a", "aac", "-b:a", "192k", str(out_path)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"speed-ramp ffmpeg failed: {res.stderr[-1000:]}")
        print(f"[speed-ramp] {s:.3f}–{e:.3f}s @ {factor}× → {out_path.name}")

    elif op == "surgical-cut":
        s = resolve_t(args.in_, "start")
        e = resolve_t(args.out, "end")
        if s is None or e is None:
            sys.exit("ERROR: surgical-cut needs --in and --out.")
        dur = ffprobe_duration(media)
        # Keep everything EXCEPT [s,e], close the gap.
        keep = [(0.0, s), (e, dur)]
        keep = [(a, b) for (a, b) in keep if b - a > 0.001]
        silence_clip_select(media, keep, out_path)
        print(f"[surgical-cut] removed {s:.3f}–{e:.3f}s → {out_path.name}")

    elif op == "transcript-token-patch":
        if not args.patch_token:
            sys.exit("ERROR: transcript-token-patch needs --patch-token <new-word>.")
        target = args.in_
        if target is None:
            sys.exit("ERROR: transcript-token-patch needs --in <word-or-index> to locate the token.")
        patched = 0
        # --in may be an integer word index, or a token to match.
        try:
            idx = int(target)
            if 0 <= idx < len(words):
                words[idx]["word" if "word" in words[idx] else "text"] = args.patch_token
                patched = 1
        except ValueError:
            norm = target.strip().strip(".,!?;:\"'").lower()
            for w in words:
                if _word_text(w).strip().strip(".,!?;:\"'").lower() == norm:
                    w["word" if "word" in w else "text"] = args.patch_token
                    patched += 1
        transcript["words"] = words
        tout = Path(args.output) if args.output else (
            (job / "transcript.json") if job is not None else media.with_suffix(".transcript.json"))
        Path(tout).write_text(json.dumps(transcript, indent=2))
        print(f"[transcript-token-patch] patched {patched} token(s) → {Path(tout).name} "
              f"(no re-transcribe)")
        out_path = Path(tout)

    else:
        sys.exit(f"ERROR: unknown sub-op {op!r}")

    if job is not None:
        log_event(job, tool="densify.py", event="sub_op_completed",
                  extra={"sub_op": op, "output": str(out_path),
                         "usage_role": f"sub_op:{op}"})
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    # --job is required for `normal`; optional (logging-only) for the path-based
    # modes (aroll/smart/transcribe — Joseph's pipeline does NOT use .current_job).
    add_job_arg(parser, required=False)

    parser.add_argument("--mode", required=True,
                        choices=["normal", "aroll", "smart", "transcribe"],
                        help="REQUIRED. Logged as usage_role. "
                             "normal=post-stitch VO pacing; aroll=real-footage window "
                             "(requires video footage; silence-clip only); "
                             "smart=WPM-aware stretch on the final "
                             "composite; transcribe=standalone PASS-2 transcript.")

    # I/O (path-based modes + sub-ops)
    parser.add_argument("--input", help="Input media. aroll/smart require video; "
                                        "transcribe accepts video or audio (mp4/mp3). "
                                        "Required for aroll/smart/transcribe; normal reads "
                                        "<job>/final_raw.mp4.")
    parser.add_argument("--output", help="Output path (aroll/smart/transcribe/sub-ops).")
    parser.add_argument("--transcript", help="Pre-existing word-timed transcript JSON.")
    parser.add_argument("--transcribe", action="store_true",
                        help="(aroll) Run Scribe v2 on --input first if no --transcript.")

    # Stretch / pacing
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED,
                        help=f"Time-stretch multiplier (default {DEFAULT_SPEED} — punchy "
                             "short-form, ~215-220 WPM; pass 1.10/1.15 for warm/neutral "
                             "registers). aroll defaults to no stretch unless --speed given.")
    parser.add_argument("--target-wpm", type=float, default=None,
                        help=f"(smart) Target post-stretch WPM (default {DEFAULT_TARGET_WPM:.0f}).")
    parser.add_argument("--max-stretch", type=float, default=None,
                        help=f"(smart) Cap on stretch factor (default {DEFAULT_MAX_STRETCH} — "
                             "beyond this lipsync drifts).")

    # Silence-clip params
    parser.add_argument("--max-gap-ms", type=int, default=200,
                        help="Inter-word gaps > this become break points (default 200ms; "
                             "≥400ms safe, 150-400ms usable, <150ms risky / mid-phoneme).")
    parser.add_argument("--head-pad-ms", type=int, default=100,
                        help="ms buffer before each kept word/phrase (default 100; bumped "
                             "50→100 on 2026-05-13 to preserve word onsets).")
    parser.add_argument("--tail-pad-ms", type=int, default=50,
                        help="ms buffer after each kept word/phrase (default 50).")

    parser.add_argument("--no-restretch", action="store_true",
                        help="Skip the time-stretch pass (silence-clip only).")
    parser.add_argument("--no-retranscribe", action="store_true",
                        help="(normal) Skip PASS 2 (leaves transcript.json STALE — only "
                             "when iterating on speed).")

    # Filler stripping (normal)
    parser.add_argument("--strip-fillers", action="store_true",
                        help=f"Drop filler words ({', '.join(sorted(DEFAULT_FILLERS))}) before "
                             "silence-clipping (their audio gets excised).")
    parser.add_argument("--also-strip", default="",
                        help="Comma-separated extra words to strip (implies --strip-fillers), "
                             "e.g. 'like,you know,i mean'.")

    parser.add_argument("--protect", action="append", default=None,
                        help="Window of intentional silence to preserve, 'start,end' (sec). "
                             "Repeatable. Overrides script.json protected_silence_windows.")

    # Clip-surgery sub-ops
    parser.add_argument("--sub-op",
                        choices=["clip-extract", "speed-ramp", "surgical-cut",
                                 "transcript-token-patch"],
                        help="Clip-surgery op (composes with any mode). Operates on word-timed "
                             "precision from the transcript.")
    parser.add_argument("--in", dest="in_",
                        help="(sub-op) In point — seconds (float) OR a word token to locate.")
    parser.add_argument("--out",
                        help="(sub-op) Out point — seconds (float) OR a word token to locate.")
    parser.add_argument("--patch-token",
                        help="(transcript-token-patch) Replacement word.")
    return parser


def main() -> int:
    global _GATEWAY_JOB
    parser = build_parser()
    args = parser.parse_args()

    # `--job` is required for normal (it resolves <job_dir> artifacts).
    job = None
    if args.job:
        job = resolve_job_dir(args.job)
    elif args.mode == "normal" and not args.sub_op:
        sys.exit("ERROR: --mode normal requires --job (it resolves <job_dir>/final_raw.mp4).")
    _GATEWAY_JOB = job  # gateway-mode Scribe calls attribute to this job (may be None)

    # Sub-ops compose with any mode — if --sub-op is set, run it and return.
    if args.sub_op:
        return run_sub_op(args, job)

    if args.mode == "normal":
        return run_normal(args, job)
    if args.mode == "aroll":
        return run_aroll(args, job)
    if args.mode == "smart":
        return run_smart(args, job)
    if args.mode == "transcribe":
        return run_transcribe(args, job)

    sys.exit(f"ERROR: unhandled mode {args.mode!r}")


if __name__ == "__main__":
    sys.exit(main())
