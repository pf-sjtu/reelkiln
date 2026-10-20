"""
verify_output.py — canonical post-render MECHANICAL integrity check.

Answers exactly one question: **is it broken?** (Not "is it good?" — that's
review_output.) A mechanical problem found here is reported as something to fix:
on an intermediate asset, before building on it; on a finished render, once
before presenting (CLAUDE.md "Finishing a render"). It is not an approval gate.
The machine-readable `blocking` list in the result keeps its historical name.

This is the consolidation of three retired backends, re-implemented inline so
this file is fully self-contained (the backends are deleted):

  - verify_render.py       → --mode render    (frame-extract + inline visual QA)
  - frame_sample.py        → --mode render    (beat-strip / filmstrip sampler)
  - verify_cleaned_audio.py→ --mode false-start (PASS-2 re-transcribe + false-start scan)
  - (audio integrity QA)   → --mode audio     (ffprobe loudness/clipping/silence)
  - (first-frame gate)     → --mode pre-gen   (single-frame Read gate before gen)

Modes
-----
  render      Extract N frames from a rendered mp4 (default 8, beat-pinned if
              --beats given), confirm overlays/captions composited and no frame
              is black/corrupt. The agent then Reads each PNG inline. Optional
              --strip stacks frames into one filmstrip PNG.
  audio       ffprobe + ffmpeg loudness/peak pass over a cleaned/densified
              wav|mp3: clipping peaks, silence drop-outs, optional WPM check
              against a transcript. (Folds the old verify_cleaned_audio intent
              of "is the audio clean", mechanical layer.)
  pre-gen     Extract ONLY the first frame (count=1) of a seedance chunk /
              first_frame.png before committing a full gen run. Same ffmpeg
              extract; agent Reads it to gate avatar/background/framing.
  false-start Re-transcribe a densified/cleaned audio file (PASS 2, ElevenLabs
              Scribe v2) and scan for false starts: em-dash aborts, repeated
              phrase heads, 3-gram duplication. Writes recommended_drops_pass2.json.

Avatar tagging
--------------
Every run tags the job as `synthetic_avatar` vs `real_person_lipsync` (printed,
logged as `avatar_type`, and returned in the JSON summary). This gates how
downstream visual-anomaly review is trusted: on real-person lip-sync footage,
hard cuts between genuine recorded takes manufacture false "identity_drift /
wardrobe_change" flags, so the visual-anomaly category must be discounted.
Inference order: explicit --avatar-type flag → script.json:pipeline_mode /
source_type → artifact heuristic (aroll/ + lipsync artifacts ⇒ real_person_lipsync;
avatar/character_sheet.json + chunks/ ⇒ synthetic_avatar).

  uv run python tools/verify_output.py --job <id> --mode render
  uv run python tools/verify_output.py --job <id> --mode render --input final.mp4 --beats beats.json
  uv run python tools/verify_output.py --job <id> --mode render --at 5,12,30,43 --strip
  uv run python tools/verify_output.py --job <id> --mode audio --input cleaned.wav --transcript transcript.json
  uv run python tools/verify_output.py --job <id> --mode pre-gen --input chunks/chunk_00.mp4
  uv run python tools/verify_output.py --job <id> --mode false-start --input final_raw.mp4 --transcript transcript.json

`--mode` is REQUIRED and logged as `usage_role`.

Backend note: render/pre-gen use ffmpeg frame-extract + Read (NOT Gemini —
Gemini is eyes-not-taste and unreliable for integrity). audio uses
ffprobe/ffmpeg. false-start uses ElevenLabs Scribe v2 PASS-2 re-transcribe.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event  # noqa: E402

TOOL_NAME = "verify_output.py"

# ElevenLabs Scribe v2 — the PASS-2 re-transcribe model (false-start mode).
# Preserved verbatim from verify_cleaned_audio.py: raw REST endpoint + scribe_v2.
SCRIBE_URL = "https://api.elevenlabs.io/v1/speech-to-text"
SCRIBE_MODEL = "scribe_v2"


# ---------------------------------------------------------------------------
# Avatar tagging: synthetic_avatar vs real_person_lipsync
# ---------------------------------------------------------------------------

def infer_avatar_type(job: Path, explicit: str | None) -> tuple[str, str]:
    """Return (avatar_type, reason). Inference order:
    explicit flag → script.json pipeline_mode/source_type → artifact heuristic.
    """
    if explicit:
        return explicit, "explicit --avatar-type flag"

    script_path = job / "script.json"
    if script_path.exists():
        try:
            script = json.loads(script_path.read_text())
        except Exception:
            script = {}
        for key in ("pipeline_mode", "source_type", "avatar_type"):
            val = str(script.get(key, "") or "").strip().lower()
            if val in ("synthetic_avatar", "real_person_lipsync"):
                return val, f"script.json:{key}"
            if val in ("synthetic", "avatar", "ai_avatar", "seedance"):
                return "synthetic_avatar", f"script.json:{key}={val}"
            if val in ("real", "real_person", "lipsync", "aroll", "a-roll"):
                return "real_person_lipsync", f"script.json:{key}={val}"

    # Artifact heuristic: real-person lip-sync pipeline leaves aroll/ + lipsync
    # artifacts; synthetic-avatar pipeline leaves avatar/character_sheet.json +
    # chunks/. The josephchin a-roll flow is the canonical real_person path.
    aroll_signals = [
        (job / "aroll").is_dir(),
        (job / "edit" / "aroll_windows.json").exists(),
        any(job.glob("**/aroll_windows.json")),
        any(job.glob("*lipsync*.mp4")),
        any(job.glob("**/*_lipsync.mp4")),
    ]
    synth_signals = [
        (job / "avatar" / "character_sheet.json").exists(),
        (job / "chunks").is_dir(),
    ]
    if any(aroll_signals) and not (job / "avatar" / "character_sheet.json").exists():
        return "real_person_lipsync", "artifact heuristic (aroll/lipsync artifacts present)"
    if any(synth_signals):
        return "synthetic_avatar", "artifact heuristic (character_sheet.json / chunks present)"
    # Default conservative: assume synthetic so visual-anomaly review stays on.
    return "synthetic_avatar", "default (no markers found)"


# ---------------------------------------------------------------------------
# Input resolution
# ---------------------------------------------------------------------------

def resolve_input(job: Path, raw: str | None, mode: str) -> Path:
    """Resolve --input relative to the job dir, with sensible per-mode defaults.

    Preserves verify_render.py's final.mp4 → final_raw.mp4 fallback chain for
    the render mode.
    """
    if raw:
        p = Path(raw)
        if not p.is_absolute():
            p = job / raw
        if p.exists():
            return p
        sys.exit(f"ERROR: --input not found at {p}")

    # Defaults per mode (mirrors the old backends' defaults).
    if mode in ("render", "false-start"):
        final = job / "final.mp4"
        final_raw = job / "final_raw.mp4"
        if mode == "render" and final.exists():
            return final
        if final_raw.exists():
            return final_raw
        if final.exists():
            return final
        sys.exit(f"ERROR: no video found (looked for final.mp4 / final_raw.mp4 in {job})")
    if mode == "audio":
        for name in ("cleaned.wav", "cleaned.mp3", "final_raw.mp4"):
            cand = job / name
            if cand.exists():
                return cand
        sys.exit(f"ERROR: no audio found (looked for cleaned.wav / cleaned.mp3 in {job}); pass --input")
    if mode == "pre-gen":
        for name in ("first_frame.png", "chunks/chunk_00.mp4"):
            cand = job / name
            if cand.exists():
                return cand
        sys.exit(f"ERROR: no pre-gen input found (looked for first_frame.png / chunks/chunk_00.mp4); pass --input")
    sys.exit(f"ERROR: unknown mode {mode}")


# ---------------------------------------------------------------------------
# ffmpeg / ffprobe primitives (inlined from verify_render.py + frame_sample.py)
# ---------------------------------------------------------------------------

def ffprobe_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    out = p.stdout.strip()
    if not out:
        raise RuntimeError(f"ffprobe produced no duration for {path} (corrupt / 0-byte?).")
    return float(out)


def extract_frame(video_in: Path, t_sec: float, out_path: Path) -> None:
    """Single-frame extract. Preserves verify_render.py's exact ffmpeg recipe."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{t_sec:.3f}",
        "-i", str(video_in),
        "-vframes", "1",
        "-q:v", "2",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg frame extract failed at {t_sec}s: {res.stderr[-300:]}")


def extract_filmstrip(video_in: Path, at_secs: list[float], out_path: Path) -> None:
    """Stack N frames horizontally as one filmstrip PNG.
    Preserves frame_sample.py's exact filter-graph recipe (scale=480:-1, hstack).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if len(at_secs) == 1:
        extract_frame(video_in, at_secs[0], out_path)
        return
    inputs: list[str] = []
    selects: list[str] = []
    for i, sec in enumerate(at_secs):
        inputs.extend(["-ss", f"{sec:.3f}", "-i", str(video_in)])
        selects.append(f"[{i}:v]scale=480:-1[v{i}]")
    selects_str = ";".join(selects)
    refs = "".join(f"[v{i}]" for i in range(len(at_secs)))
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        *inputs,
        "-filter_complex",
        f"{selects_str};{refs}hstack=inputs={len(at_secs)}[out]",
        "-map", "[out]",
        "-frames:v", "1",
        "-q:v", "2",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg filmstrip failed: {res.stderr[-500:]}")


def frame_mean_luma(frame_path: Path) -> float | None:
    """Mean luminance (0-255) of a PNG via ffmpeg signalstats. Used to detect
    black/blank frames (a broken compositor state). Returns None if unavailable.
    """
    cmd = [
        "ffmpeg", "-i", str(frame_path),
        "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
        "-f", "null", "-",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r"YAVG=([0-9.]+)", res.stderr)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# render-mode sampling (verify_render.py default_sample_times, inlined)
# ---------------------------------------------------------------------------

def default_sample_times(transcript: dict, video_dur: float, n: int = 7) -> list[float]:
    """Pick ~n representative timestamps snapped to nearest word start so we
    never sample dead air. Verbatim from verify_render.py.
    """
    words = transcript.get("words", [])
    if not words or video_dur <= 0:
        return [video_dur / 2] if video_dur > 0 else []
    points: list[float] = []
    for i in range(n):
        t = video_dur * (i + 0.5) / n
        nearest = min(words, key=lambda w: abs(float(w.get("start", 0)) - t))
        points.append(round(float(nearest["start"]) + 0.15, 2))  # +150ms inside the word
    return sorted(set(points))


def beat_sample_times(beats: dict, video_dur: float) -> list[float]:
    """Pin sample times to beat boundaries when --beats is supplied.
    Accepts {"beats":[{start,..}]} or a bare list of beats with start/anchor.
    """
    raw = beats.get("beats", beats) if isinstance(beats, dict) else beats
    times: list[float] = []
    if isinstance(raw, list):
        for b in raw:
            if not isinstance(b, dict):
                continue
            for key in ("anchor", "start", "t", "time"):
                if key in b and b[key] is not None:
                    try:
                        times.append(round(float(b[key]) + 0.15, 2))
                    except (TypeError, ValueError):
                        pass
                    break
    times = sorted({t for t in times if 0 <= t <= video_dur})
    return times


# ---------------------------------------------------------------------------
# audio-mode integrity (ffprobe loudness/clipping/silence + optional WPM)
# ---------------------------------------------------------------------------

def audio_integrity(path: Path, transcript: dict | None) -> dict:
    """Mechanical audio QA: peak/clipping, silence drop-outs, optional WPM.
    Returns a dict of findings + a blocking flag.
    """
    findings: dict = {}
    blocking: list[str] = []

    dur = ffprobe_duration(path)
    findings["duration_sec"] = round(dur, 3)

    # Peak / clipping via ffmpeg volumedetect (max_volume near 0 dB == clipping).
    vd = subprocess.run(
        ["ffmpeg", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    max_vol = None
    mean_vol = None
    mmax = re.search(r"max_volume:\s*(-?[0-9.]+) dB", vd.stderr)
    mmean = re.search(r"mean_volume:\s*(-?[0-9.]+) dB", vd.stderr)
    if mmax:
        max_vol = float(mmax.group(1))
        findings["max_volume_db"] = max_vol
    if mmean:
        mean_vol = float(mmean.group(1))
        findings["mean_volume_db"] = mean_vol
    if max_vol is not None and max_vol >= -0.1:
        blocking.append(f"clipping: max_volume {max_vol} dB (>= -0.1 dB) — re-run clean_audio")

    # Silence drop-out detection: any silence window >= 1.5s mid-file is a
    # candidate drop-out (intentional inter-sentence gaps are shorter).
    sd = subprocess.run(
        ["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-40dB:d=1.5",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    silences = []
    for m in re.finditer(r"silence_start:\s*([0-9.]+)", sd.stderr):
        silences.append(float(m.group(1)))
    durs = [float(m.group(1)) for m in re.finditer(r"silence_duration:\s*([0-9.]+)", sd.stderr)]
    findings["long_silences"] = [
        {"start": s, "duration": d} for s, d in zip(silences, durs)
    ]
    # Mid-file long silences (not the very tail) are suspicious.
    mid_drops = [s for s, d in zip(silences, durs) if 0.5 < s < dur - 1.0]
    if mid_drops:
        findings["mid_silence_dropouts"] = mid_drops
        # Not auto-blocking (could be an intentional protected hook silence) —
        # surface for the operator to confirm.

    # WPM (optional, when a transcript is supplied). MEMORY: densify targets
    # 170-200 WPM; flag out-of-range as a SHOULD-confirm, not hard-block.
    if transcript:
        words = transcript.get("words", [])
        if words and dur > 0:
            wpm = round(len(words) / dur * 60, 1)
            findings["wpm"] = wpm
            findings["word_count"] = len(words)
            if wpm < 150 or wpm > 240:
                findings["wpm_out_of_range"] = True

    findings["blocking"] = blocking
    return findings


# ---------------------------------------------------------------------------
# false-start scan (verify_cleaned_audio.py, inlined verbatim)
# ---------------------------------------------------------------------------

def transcribe_scribe_rest(media: Path) -> dict:
    """PASS-2 re-transcribe via ElevenLabs Scribe v2 over raw REST.
    Preserved from verify_cleaned_audio.py (xi-api-key header, multipart upload).
    """
    import requests  # local import: only needed in false-start mode

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("ELEVENLABS_API_KEY missing", file=sys.stderr)
        sys.exit(1)
    # mimetype by suffix
    suffix = media.suffix.lower()
    mime = {
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
        ".mp4": "video/mp4",
    }.get(suffix, "application/octet-stream")
    with open(media, "rb") as fh:
        files = {"file": (media.name, fh, mime)}
        data = {"model_id": SCRIBE_MODEL}
        headers = {"xi-api-key": api_key}
        r = requests.post(SCRIBE_URL, headers=headers, files=files, data=data, timeout=300)
        r.raise_for_status()
        return r.json()


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _word_text(w: dict) -> str:
    """Scribe REST returns 'text'; the SDK path stores 'word'. Accept both."""
    return w.get("text", w.get("word", "")) or ""


def scan_signals(words: list[dict]) -> list[dict]:
    """Return flagged false-start signals. Verbatim logic from
    verify_cleaned_audio.py: (a) em-dash aborts, (b) repeated phrase head,
    (c) 3-gram duplication within 8s.
    """
    flagged: list[dict] = []
    n = len(words)

    # (a) Em-dash terminations
    for i, w in enumerate(words):
        if _word_text(w).rstrip().endswith("--"):
            start = 0
            for j in range(i - 1, -1, -1):
                t = _word_text(words[j]).rstrip()
                if t.endswith((".", "?", "!")):
                    start = j + 1
                    break
            flagged.append({
                "type": "em-dash abort",
                "anchor_idx": i,
                "time_start": words[start]["start"],
                "time_end": words[i]["end"],
                "drop_start_idx": start,
                "drop_end_idx_exclusive": i + 1,
                "phrase": " ".join(_word_text(w) for w in words[start:i + 1]),
            })

    # (b) Repeated phrase head — first-3 words match between two nearby sentences
    sentence_starts = [0]
    for i, w in enumerate(words[:-1]):
        if _word_text(w).rstrip().endswith((".", "?", "!")):
            sentence_starts.append(i + 1)
    for a_idx, a in enumerate(sentence_starts):
        if a + 2 >= n:
            continue
        a_head = tuple(_normalize(_word_text(words[a + k])) for k in range(3))
        for b in sentence_starts[a_idx + 1:]:
            if b + 2 >= n:
                continue
            if words[b]["start"] - words[a]["start"] > 15:
                break
            b_head = tuple(_normalize(_word_text(words[b + k])) for k in range(3))
            if a_head == b_head and all(x for x in a_head):
                flagged.append({
                    "type": "repeated phrase head",
                    "anchor_idx": b,
                    "time_start": words[a]["start"],
                    "time_end": words[b]["start"],
                    "drop_start_idx": a,
                    "drop_end_idx_exclusive": b,
                    "phrase": " ".join(_word_text(w) for w in words[a:b]),
                })
                break

    # (c) 3-gram duplication within 8 seconds
    seen_3grams: dict[tuple[str, str, str], int] = {}
    for i in range(n - 2):
        gram = (
            _normalize(_word_text(words[i])),
            _normalize(_word_text(words[i + 1])),
            _normalize(_word_text(words[i + 2])),
        )
        if not all(gram):
            continue
        if gram in seen_3grams:
            prev_i = seen_3grams[gram]
            if words[i]["start"] - words[prev_i]["start"] < 8:
                if not any(f["drop_start_idx"] <= prev_i and f["drop_end_idx_exclusive"] > prev_i for f in flagged):
                    flagged.append({
                        "type": "3-gram duplication",
                        "anchor_idx": i,
                        "time_start": words[prev_i]["start"],
                        "time_end": words[i]["start"],
                        "drop_start_idx": prev_i,
                        "drop_end_idx_exclusive": i,
                        "phrase": " ".join(_word_text(words[k]) for k in range(prev_i, i + 3)),
                    })
        seen_3grams[gram] = i

    return flagged


# ---------------------------------------------------------------------------
# Mode handlers
# ---------------------------------------------------------------------------

def run_render(job: Path, video: Path, args, single: bool = False) -> dict:
    """render (and pre-gen via single=True) frame-extract + black-frame check."""
    out_dir = job / ("verify_frames" if not single else "verify")
    out_dir.mkdir(parents=True, exist_ok=True)

    is_image = video.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")

    if single:
        # pre-gen: a single frame (or the image itself).
        if is_image:
            frames = [video]
            print(f"Pre-gen input is already a still: {video}")
        else:
            out_path = out_dir / "pregen_first_frame.png"
            extract_frame(video, 0.0, out_path)
            frames = [out_path]
        times = [0.0]
    else:
        video_dur = ffprobe_duration(video)
        if args.at:
            times = sorted({float(t.strip()) for t in args.at.split(",") if t.strip()})
        elif args.beats:
            beats = json.loads(Path(args.beats if Path(args.beats).is_absolute() else job / args.beats).read_text())
            times = beat_sample_times(beats, video_dur)
            if not times:
                print("[verify_output] --beats produced no in-range times; falling back to default sampling")
        else:
            times = []
        if not times:
            tpath = job / "transcript.json"
            if args.transcript:
                tpath = Path(args.transcript if Path(args.transcript).is_absolute() else job / args.transcript)
            transcript = json.loads(tpath.read_text()) if tpath.exists() else {"words": []}
            n = args.sample_count or 8
            times = default_sample_times(transcript, video_dur, n=n)

        times = [t for t in times if 0 <= t <= video_dur]
        print(f"Video:    {video} ({video_dur:.2f}s)")
        print(f"Sampling: {len(times)} frames at {times}")

        frames = []
        if args.strip and len(times) > 1:
            out_path = out_dir / "filmstrip.png"
            extract_filmstrip(video, times, out_path)
            frames = [out_path]
        else:
            for t in times:
                out_path = out_dir / f"frame_{t:06.2f}s.png"
                extract_frame(video, t, out_path)
                frames.append(out_path)

    # Black/blank-frame check on the individual extracted frames.
    black_frames = []
    luma_report = []
    for f in frames:
        luma = frame_mean_luma(f)
        luma_report.append({"frame": f.name, "yavg": luma})
        if luma is not None and luma < 8.0:
            black_frames.append(f.name)

    blocking = []
    if black_frames:
        blocking.append(
            f"black/blank frames detected: {black_frames} — compositor failure; "
            "fix it once and render again before presenting"
        )

    print()
    if frames:
        print(f"Wrote {len(frames)} frame(s). Read each one inline to inspect:")
        for f in frames:
            kb = f.stat().st_size // 1024
            print(f"  Read {f}  ({kb}KB)")
    if black_frames:
        print(f"\n⚠ PROBLEM TO FIX: black/blank frames: {black_frames}")

    return {
        "frames": [str(f) for f in frames],
        "times": times,
        "luma": luma_report,
        "black_frames": black_frames,
        "blocking": blocking,
    }


def run_audio(job: Path, media: Path, args) -> dict:
    transcript = None
    if args.transcript:
        tpath = Path(args.transcript if Path(args.transcript).is_absolute() else job / args.transcript)
        if tpath.exists():
            transcript = json.loads(tpath.read_text())
    findings = audio_integrity(media, transcript)
    print(f"Audio:    {media} ({findings['duration_sec']}s)")
    if "max_volume_db" in findings:
        print(f"  max_volume: {findings['max_volume_db']} dB   mean: {findings.get('mean_volume_db')} dB")
    if findings.get("wpm") is not None:
        print(f"  WPM: {findings['wpm']} ({findings['word_count']} words)"
              + ("  ⚠ OUT OF 150-240 RANGE" if findings.get("wpm_out_of_range") else ""))
    if findings.get("mid_silence_dropouts"):
        print(f"  ⚠ mid-file long silences at: {findings['mid_silence_dropouts']}")
    if findings["blocking"]:
        for b in findings["blocking"]:
            print(f"  ⚠ PROBLEM TO FIX: {b}")
    else:
        print("  ✓ no clipping / no audio defects found")
    return findings


def run_false_start(job: Path, media: Path, args) -> dict:
    """PASS-2 re-transcribe + false-start scan. Writes recommended_drops_pass2.json."""
    cached = job / "verify_pass2.transcript.json"
    if args.transcript:
        tpath = Path(args.transcript if Path(args.transcript).is_absolute() else job / args.transcript)
        if tpath.exists() and not args.refresh_transcript:
            print(f"[verify_output] using supplied transcript {tpath}")
            t = json.loads(tpath.read_text())
        else:
            print(f"[verify_output] re-transcribing {media} with Scribe v2 (PASS 2)...")
            t = transcribe_scribe_rest(media)
            cached.write_text(json.dumps(t, indent=2))
    elif cached.exists() and not args.refresh_transcript:
        print(f"[verify_output] reusing {cached}")
        t = json.loads(cached.read_text())
    else:
        print(f"[verify_output] re-transcribing {media} with Scribe v2 (PASS 2)...")
        t = transcribe_scribe_rest(media)
        cached.write_text(json.dumps(t, indent=2))

    words = t.get("words", [])
    print(f"[verify_output] {len(words)} words in audio")

    signals = scan_signals(words)
    if not signals:
        print("[verify_output] ✓ no false-start signals detected")
        return {"signals": [], "blocking": [], "recommended_drops": None}

    print(f"\n[verify_output] ⚠ flagged {len(signals)} signal(s):\n")
    for sig in signals:
        print(f"  [{sig['type']}] {sig['time_start']:.2f}-{sig['time_end']:.2f}s")
        print(f"    drop range (word idx): [{sig['drop_start_idx']}, {sig['drop_end_idx_exclusive']})")
        print(f"    phrase: {sig['phrase']!r}")
        print()

    rec = {
        "dropped_segments": [
            {
                "start_idx": s["drop_start_idx"],
                "end_idx_exclusive": s["drop_end_idx_exclusive"],
                "reason": f"PASS-2 verify catch [{s['type']}]: {s['phrase'][:80]!r}",
            }
            for s in signals
        ],
        "rationale": "Auto-flagged by verify_output.py (false-start mode) — review before applying. "
                     "Drops anchored to PASS-2 word indices over the re-transcribed audio.",
    }
    out = job / "recommended_drops_pass2.json"
    out.write_text(json.dumps(rec, indent=2))
    print(f"[verify_output] wrote {out}")

    return {
        "signals": signals,
        "blocking": [f"{len(signals)} false-start signal(s) detected"],
        "recommended_drops": str(out),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument(
        "--mode", required=True,
        choices=["render", "audio", "pre-gen", "false-start"],
        help="REQUIRED. Logged as usage_role. "
             "render=frame QA on mp4 | audio=clipping/silence/WPM on wav|mp3 | "
             "pre-gen=first-frame gate | false-start=PASS-2 transcript-diff.",
    )
    parser.add_argument(
        "--input",
        help="Media file (under <job_dir>/ or absolute). Per-mode default: "
             "render→final.mp4 (→final_raw.mp4), audio→cleaned.wav, "
             "pre-gen→first_frame.png/chunk_00.mp4, false-start→final_raw.mp4.",
    )
    parser.add_argument(
        "--beats",
        help="render mode: beats.json to pin frame samples at beat boundaries.",
    )
    parser.add_argument(
        "--transcript",
        help="audio/false-start: transcript.json for WPM / word-timing diff. "
             "render: override default-sampling transcript.",
    )
    parser.add_argument(
        "--at",
        help="render: comma-separated timestamps in seconds (e.g. '5,12,30'). "
             "Overrides --beats / default sampling.",
    )
    parser.add_argument(
        "--sample-count", type=int, default=None,
        help="render: number of frames to spread across the timeline (default 8).",
    )
    parser.add_argument(
        "--strip", action="store_true",
        help="render: stack the sampled frames into a single horizontal filmstrip PNG.",
    )
    parser.add_argument(
        "--pre-gen", action="store_true",
        help="Alias for --mode pre-gen (first-frame gate). Forces single-frame extract.",
    )
    parser.add_argument(
        "--avatar-type",
        choices=["synthetic_avatar", "real_person_lipsync"],
        default=None,
        help="Override the synthetic_avatar vs real_person_lipsync tag "
             "(otherwise inferred from script.json / artifacts).",
    )
    parser.add_argument(
        "--refresh-transcript", action="store_true",
        help="false-start: force a fresh PASS-2 re-transcribe (ignore cache).",
    )
    parser.add_argument(
        "--role",
        help="Optional usage role tag (logged as usage_role alongside --mode).",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    # --pre-gen flag is an alias for --mode pre-gen.
    mode = "pre-gen" if args.pre_gen else args.mode

    job = resolve_job_dir(args.job)
    avatar_type, avatar_reason = infer_avatar_type(job, args.avatar_type)

    media = resolve_input(job, args.input, mode)
    print(f"[verify_output] mode={mode}  avatar_type={avatar_type} ({avatar_reason})")
    print(f"[verify_output] input={media}\n")

    if mode == "render":
        result = run_render(job, media, args, single=False)
    elif mode == "pre-gen":
        result = run_render(job, media, args, single=True)
    elif mode == "audio":
        result = run_audio(job, media, args)
    elif mode == "false-start":
        result = run_false_start(job, media, args)
    else:
        sys.exit(f"ERROR: unknown mode {mode}")

    blocking = result.get("blocking", [])
    status = "BROKEN" if blocking else "OK"

    log_event(
        job, tool=TOOL_NAME, event="verify_complete",
        extra={
            "usage_role": args.role or mode,
            "mode": mode,
            "input": str(media.relative_to(job)) if media.is_relative_to(job) else str(media),
            "avatar_type": avatar_type,
            "avatar_type_reason": avatar_reason,
            "status": status,
            "blocking": blocking,
        },
    )

    print()
    print(f"[verify_output] STATUS: {status}"
          + (f" — {len(blocking)} problem(s) to fix (once, before presenting a finished render)"
             if blocking else " (mechanical checks passed)"))

    # A non-zero exit reports a mechanical problem to the caller; it is not an
    # approval gate on the draft.
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
