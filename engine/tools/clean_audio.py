"""
clean_audio.py — the canonical recorded-audio cleaning primitive.

ONE tool, `--mode {denoise | trim}`; the mode picks the job. This file ABSORBS
two former backends (now deleted) and is fully self-contained — it does NOT
import any of them:

  - denoise ← measure-first gate → model-grade enhancement (gateway
              POST /v1/audio/enhance → Fal DeepFilterNet when keyed) → ffmpeg
              noise-gate + spectral subtraction as the offline/failure
              fallback. A legacy direct-provider path remains for unkeyed
              local development only. Backend choice is AUTOMATIC (chunk 24).
  - trim    ← clean_audio.py        (Scribe v2 transcribe + drops.json false-start /
                                      dead-air cut + actual_delivery.md + editor notes)
              + normalize_transcript.py (Scribe brand-name mishear fixer, folded in as
                                      a post-transcribe normalization pass)

Only the low-level shared helpers that survive are imported: _paths, _ffmpeg, job, log.
The QA logic that used to live in verify_cleaned_audio.py now lives in
`verify_output --mode false-start` (a separate checking-tier tool), NOT here.
This tool's job ends at a clean file; pacing / WPM is `densify`; TTS is `synth_voice`.

Architecture (LLM strengths × deterministic code, preserved from the trim backend):
  - TRANSCRIBE is deterministic + cached: ElevenLabs Scribe v2 → word-level
    timestamps. Written to <out>.transcript.json. Re-runs are skipped if the
    sidecar already exists (unless --refresh-transcript). Brand-name mishears
    (Seedance → "Cedance", Veo → "VO", …) are normalized in-place right after
    transcription so caption text downstream is correct.
  - SELECTION is a JUDGMENT call: a human (or the agent driving this session)
    reads the transcript + the reference script and writes a `drops.json`
    file describing which transcript index ranges to remove. (See the
    selection procedure in the audio-cleaning playbook.) A human-provided cut
    list (timestamps) may be passed via --cuts <csv> as a fallback when the
    transcript-anchored flow isn't available.
  - CUT is deterministic: this tool reads `drops.json` (or --cuts), builds
    keep-segments from word-level timestamps, concats via ffmpeg.

Drops JSON schema:
  {
    "dropped_segments": [
      {"start_idx": int, "end_idx_exclusive": int, "reason": "..."}
    ],
    "editor_notes": [
      {"start_idx": int, "end_idx_exclusive": int, "note": "..."}
    ],
    "paraphrases_kept": [
      {"transcript_idx_range": [int, int], "script_says": "...", "joseph_says": "..."}
    ],
    "restart_inventory": [
      {"phrase": "...", "attempts": int, "keeper_starts_idx": int}
    ],
    "rationale": "..."
  }

Usage:

  # denoise — suppress room hiss / mic hiss / AC hum from a recorded take.
  # SAFE TO RUN ALWAYS: it measures the take first and passes already-clean
  # audio through untouched (skip-on-clean gate; --force overrides). Output
  # preserves the source sample rate / bit depth.
  uv run python tools/clean_audio.py --mode denoise --job <id> \
      --input raw.wav [--output cleaned.wav] [--sensitivity medium] \
      [--force] [--clean-floor-db -50.0]

  # trim — Step 1: produce the transcript so the agent can read it
  uv run python tools/clean_audio.py --mode trim --job <id> \
      --input raw.mp3 --transcribe-only

  # trim — Step 2: agent reads transcript + script, writes drops.json
  # trim — Step 3: cut the audio
  uv run python tools/clean_audio.py --mode trim --job <id> \
      --input raw.mp3 --script script.txt --drops drops.json --output cleaned.mp3

  # trim — fallback: human-provided cut list (drop these time windows)
  uv run python tools/clean_audio.py --mode trim --job <id> \
      --input raw.mp3 --cuts cuts.csv --output cleaned.mp3

`--mode` is REQUIRED and logged as usage_role. `--job` is ALWAYS required
(feedback_always_pass_job). This tool never time-stretches — pacing is densify.
"""

from __future__ import annotations

import argparse
import csv
import importlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

# tools/ on sys.path so the sibling helper modules resolve.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from _paths import ENV_PATH  # noqa: E402
from _ffmpeg import ffprobe_duration, run_ffmpeg_atomic  # noqa: E402
from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import gateway, GatewayError, GatewayAcceptedError  # noqa: E402

load_dotenv(ENV_PATH)
load_dotenv()  # also honor a CWD-local .env, matching the old backends

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
SCRIBE_MODEL = "scribe_v2"  # preserved verbatim from clean_audio.py backend


# =============================================================================
# ElevenLabs SDK loader (preserved from clean_audio.py — avoids local-file
# name collision: a tool literally named clean_audio.py would shadow nothing
# here, but elevenlabs.client could collide with any local elevenlabs.py).
# =============================================================================
def _import_elevenlabs():
    """Import the SDK avoiding local-file name collisions."""
    saved = list(sys.path)
    here = str(_HERE)
    sys.path[:] = [p for p in sys.path if p != here and p != ""]
    try:
        return importlib.import_module("elevenlabs.client").ElevenLabs
    finally:
        sys.path[:] = saved


def transcribe(audio_path: Path, job: Path | None = None) -> dict:
    """Scribe v2 word-level transcription.

    DUAL MODE (mirrors analyze_reference.py): VIDEOCLAW_API_KEY set → the call
    routes through the gateway (one key, metered spend; gateway.upload turns the
    local file into a signed URL and the server returns ElevenLabs' STT JSON
    verbatim in res["output"]). Otherwise the raw ElevenLabs SDK path runs on
    ELEVENLABS_API_KEY. Same params either way: scribe_v2, eng, diarize=False.
    """
    print(f"[clean_audio] transcribing {audio_path.name} with {SCRIBE_MODEL}…")
    t0 = time.perf_counter()
    if gateway.enabled():
        print("[clean_audio] routing Scribe via gateway (VIDEOCLAW_API_KEY)")
        res = gateway.run(
            "synth_voice", mode="transcribe",
            references=[audio_path],       # local path → gateway.upload → signed URL
            params={"diarize": False},
            job=job, timeout_s=900,
        )
        data = res["output"]               # ElevenLabs STT JSON, passed through
    else:
        if not ELEVENLABS_API_KEY:
            raise SystemExit(
                "No gateway key (VIDEOCLAW_API_KEY) or ELEVENLABS_API_KEY set in env / .env"
            )
        ElevenLabs = _import_elevenlabs()
        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        with open(audio_path, "rb") as f:
            result = client.speech_to_text.convert(
                file=f, model_id=SCRIBE_MODEL,
                tag_audio_events=False, language_code="eng", diarize=False,
            )
        data = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    print(f"[clean_audio] transcribe done in {time.perf_counter() - t0:.1f}s")
    words = []
    for w in data.get("words", []):
        if w.get("type") == "spacing":
            continue
        text = w.get("text") or w.get("word") or ""
        words.append({
            "text": text,
            "start": float(w.get("start", 0) or 0),
            "end": float(w.get("end", 0) or 0),
        })
    return {
        "text": data.get("text", ""),
        "language": data.get("language_code") or data.get("language", "eng"),
        "words": words,
    }


# =============================================================================
# Brand-name normalization (ABSORBED from normalize_transcript.py)
# -----------------------------------------------------------------------------
# Scribe v2 reliably mishears modern AI product names (Seedance → "Cedance",
# Veo → "VO", …). Folded in as a post-transcribe pass so the cached transcript —
# and any downstream caption text built from it — carries canonical spellings.
# =============================================================================
# (canonical, [mishears...]). Mishears are case-insensitive, word-boundary
# matched, sorted longest-first within each entry to avoid partial overwrites.
BRAND_NAMES: list[tuple[str, list[str]]] = [
    ("Seedance", ["Cedants", "Cedance", "Cedans", "Sea Dance", "Sedans", "Sedan", "Cidance", "Cidants"]),
    ("Veo", ["Vio", "VO", "Vo"]),
    ("Kling", []),  # usually correct, listed for future mishears
    ("Omni", []),
    ("Gemini", ["Gemeni", "Geminai"]),
    ("ChatGPT", ["Chat GPT", "ChatGBT", "Chat GBT"]),
    ("Hailuo", ["Hi Lou", "Hayloo", "Hi Low", "Highloo"]),
    ("Bytedance", ["Byte Dance", "Bite Dance", "Byte-dance"]),
    ("Kuaishou", ["Kwaishou", "Kwai Show", "Quy Show"]),
    ("Replicate", []),
    ("Anthropic", []),
    ("Claude", []),
    ("Sonnet", ["Sonet"]),
    ("Opus", []),
    ("Hedra", ["Hetra", "Hedrah"]),
    ("Runway", []),
    ("MovieGen", ["Movie Gen", "Moviegen"]),
    ("Sora", []),
]


def _build_pattern(entry: tuple[str, list[str]]) -> list[tuple[re.Pattern, str]]:
    """Compile per-mishear regex patterns. Word-boundary anchored,
    case-insensitive. Longest mishear first."""
    canonical, mishears = entry
    sorted_mishears = sorted(mishears, key=len, reverse=True)
    patterns: list[tuple[re.Pattern, str]] = []
    for m in sorted_mishears:
        escaped = re.escape(m)
        # \b doesn't play well with internal whitespace mishears like "Sea Dance"
        # so we use a manual lookahead/lookbehind for non-word chars.
        pat = re.compile(rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])", re.IGNORECASE)
        patterns.append((pat, canonical))
    return patterns


def _normalize_text(text: str, patterns: list[tuple[re.Pattern, str]]) -> tuple[str, list[tuple[str, str]]]:
    """Apply all replacement patterns to text. Return new_text +
    list of (before, after) substring pairs for logging."""
    changes: list[tuple[str, str]] = []
    out = text
    for pat, canonical in patterns:
        m = pat.search(out)
        while m:
            before = m.group(0)
            out = out[: m.start()] + canonical + out[m.end():]
            changes.append((before, canonical))
            m = pat.search(out)
    return out, changes


def normalize_brand_names(transcript: dict) -> int:
    """Fix Scribe brand-name mishears in-place across word texts + the full
    `text` field. Returns the number of replacements made."""
    all_patterns: list[tuple[re.Pattern, str]] = []
    for entry in BRAND_NAMES:
        all_patterns.extend(_build_pattern(entry))

    total = 0
    for i, w in enumerate(transcript.get("words", [])):
        original = w["text"]
        new_text, changes = _normalize_text(original, all_patterns)
        if changes:
            for before, after in changes:
                print(f"  [normalize] word #{i:3} [{w['start']:6.2f}s]  {before!r:30s} → {after!r}")
                total += 1
            w["text"] = new_text

    if isinstance(transcript.get("text"), str):
        new_full, full_changes = _normalize_text(transcript["text"], all_patterns)
        if full_changes:
            transcript["text"] = new_full

    if total:
        print(f"[clean_audio] normalized {total} brand-name mishear(s)")
    return total


# =============================================================================
# Keep-segment building + concat (ABSORBED from clean_audio.py trim path)
# =============================================================================
def build_keep_segments(
    transcript_words: list[dict],
    kept_indices: list[int],
    head_pad_ms: int = 50,
    tail_pad_ms: int = 50,
    join_gap_ms: int = 80,
) -> list[tuple[float, float]]:
    if not kept_indices:
        return []
    runs: list[list[int]] = []
    current = [kept_indices[0]]
    for idx in kept_indices[1:]:
        if idx == current[-1] + 1:
            current.append(idx)
        else:
            runs.append(current)
            current = [idx]
    runs.append(current)

    segments: list[tuple[float, float]] = []
    head_pad = head_pad_ms / 1000.0
    tail_pad = tail_pad_ms / 1000.0
    join_gap = join_gap_ms / 1000.0

    for run in runs:
        first = transcript_words[run[0]]
        last = transcript_words[run[-1]]
        start = max(0.0, first["start"] - head_pad)
        end = last["end"] + tail_pad
        if segments and start - segments[-1][1] < join_gap:
            segments[-1] = (segments[-1][0], end)
        else:
            segments.append((start, end))
    return segments


def concat_audio_segments(
    audio_in: Path,
    segments: list[tuple[float, float]],
    audio_out: Path,
    crossfade_ms: int = 30,
    trim_trailing_silence: bool = True,
    silence_threshold_db: float = -40.0,
    silence_min_dur_sec: float = 0.30,
) -> None:
    """Concat the kept audio segments with crossfades. Optionally strips trailing
    silence from the END of the output using the areverse / silenceremove trick.

    The areverse trick is safer than `silenceremove=stop_periods=-1` because
    it only operates on what was originally the END of the file. Internal
    silence (intentional pauses inside speech) is preserved.
    """
    if not segments:
        raise SystemExit("no segments to keep")
    inputs = []
    for i, (s, e) in enumerate(segments):
        dur = e - s
        inputs.append(
            f"[0:a]atrim={s:.3f}:{e:.3f},asetpts=PTS-STARTPTS"
            f",afade=t=in:st=0:d={crossfade_ms/1000:.3f}"
            f",afade=t=out:st={max(0, dur - crossfade_ms/1000):.3f}:d={crossfade_ms/1000:.3f}"
            f"[a{i}]"
        )
    concat_inputs = "".join(f"[a{i}]" for i in range(len(segments)))
    chain = ";".join(inputs) + f";{concat_inputs}concat=n={len(segments)}:v=0:a=1"

    if trim_trailing_silence:
        # Reverse → silenceremove (now operates on the original-end) → reverse back
        chain += (
            f",areverse,silenceremove=start_periods=1"
            f":start_silence={silence_min_dur_sec:.3f}"
            f":start_threshold={silence_threshold_db}dB"
            f",areverse"
        )
    chain += "[out]"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(audio_in),
        "-filter_complex", chain,
        "-map", "[out]",
        "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
        str(audio_out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-2000:], file=sys.stderr)
        raise SystemExit(res.returncode)


def write_actual_delivery_md(
    out_path: Path,
    script_text: str,
    transcript_words: list[dict],
    drops: dict,
    kept_indices: list[int],
    segments: list[tuple[float, float]],
) -> None:
    kept_text = " ".join(transcript_words[i]["text"] for i in kept_indices)
    raw_text = " ".join(w["text"] for w in transcript_words)

    lines: list[str] = []
    lines.append(f"# Actual delivery — {out_path.stem}")
    lines.append("")
    lines.append(f"_Generated by clean_audio.py on {time.strftime('%Y-%m-%d %H:%M:%S')}_")
    lines.append("")
    lines.append("## Reference script (written)")
    lines.append("```")
    lines.append(script_text.strip())
    lines.append("```")
    lines.append("")
    lines.append("## What was actually delivered (cleaned)")
    lines.append("```")
    lines.append(kept_text)
    lines.append("```")
    lines.append("")
    if drops.get("rationale"):
        lines.append("## Rationale")
        lines.append(f"> {drops['rationale']}")
        lines.append("")
    if drops.get("restart_inventory"):
        lines.append("## Restart inventory")
        for r in drops["restart_inventory"]:
            lines.append(
                f"- _{r.get('phrase', '')}_ × {r.get('attempts', '?')} attempts, "
                f"keeper starts at idx {r.get('keeper_starts_idx', '?')}"
            )
        lines.append("")
    if drops.get("paraphrases_kept"):
        lines.append("## Paraphrases preserved (intentional rewordings)")
        for p in drops["paraphrases_kept"]:
            r = p.get("transcript_idx_range", [None, None])
            lines.append(f"- **script:** _{p.get('script_says', '')}_")
            lines.append(f"  **delivered:** _{p.get('joseph_says', '')}_  (idx {r[0]}–{r[1]})")
        lines.append("")
    if drops.get("dropped_segments"):
        lines.append("## Dropped segments")
        for d in drops["dropped_segments"]:
            s = d.get("start_idx")
            e = d.get("end_idx_exclusive")
            reason = d.get("reason", "")
            if s is not None and e is not None and 0 <= s < len(transcript_words):
                snippet = " ".join(w["text"] for w in transcript_words[s:e])
                lines.append(f"- idx {s}–{e}: _{snippet[:120]}_  ({reason})")
        lines.append("")
    lines.append("## Stats")
    raw_dur = transcript_words[-1]["end"] if transcript_words else 0
    kept_dur = sum(e - s for s, e in segments)
    lines.append(f"- Raw transcript tokens: {len(transcript_words)}")
    lines.append(f"- Kept tokens: {len(kept_indices)}")
    lines.append(f"- Dropped tokens: {len(transcript_words) - len(kept_indices)}")
    lines.append(f"- Keep-segments (contiguous): {len(segments)}")
    lines.append(f"- Kept duration: {kept_dur:.2f}s of {raw_dur:.2f}s raw "
                 f"({100 * kept_dur / max(raw_dur, 0.001):.1f}%)")
    lines.append("")
    lines.append("## Raw transcript (verbatim, with all restarts)")
    lines.append("```")
    lines.append(raw_text)
    lines.append("```")
    out_path.write_text("\n".join(lines))


def append_editor_notes_to_queued_file(
    queued_path: Path, transcript_words: list[dict], editor_notes: list[dict],
) -> None:
    """Append captured editor notes inline into the queued/shipped file's
    'Editor notes (recording)' section.

    Strategy: locate the section header. Replace the `_none yet_` placeholder
    if present; otherwise append below the last existing bullet. Each note
    includes the raw-audio timestamp window, the note text, and the dialogue
    moment it refers to (the few words BEFORE the note in raw audio).
    """
    text = queued_path.read_text()
    header = "## Editor notes (recording)"
    if header not in text:
        addition = "\n\n" + header + "\n\n"
        text_before = text.rstrip() + "\n"
        body = ""
    else:
        text_before, _, after = text.partition(header)
        next_idx = after.find("\n## ")
        if next_idx == -1:
            section_body = after
            after_section = ""
        else:
            section_body = after[:next_idx]
            after_section = after[next_idx:]
        body = section_body
        addition = ""

    lines: list[str] = []
    for note in editor_notes:
        s = int(note.get("start_idx", 0))
        e = int(note.get("end_idx_exclusive", 0))
        if e <= s or s < 0 or e > len(transcript_words):
            continue
        t_start = transcript_words[s].get("start", 0.0)
        t_end = transcript_words[e - 1].get("end", 0.0)
        note_text = note.get("note") or " ".join(
            w["text"] for w in transcript_words[s:e]
        )
        anchor_start = max(0, s - 6)
        anchor_text = " ".join(w["text"] for w in transcript_words[anchor_start:s]).strip()
        anchor_text = anchor_text[-100:]  # truncate
        lines.append(
            f"- **[{t_start:.2f}–{t_end:.2f}s]** {note_text.strip()}\n"
            f"  - _after:_ \"…{anchor_text}\""
        )

    new_entries = "\n".join(lines) + "\n"

    if header in text:
        if "_none yet_" in body:
            new_body = body.replace("- _none yet_", new_entries.rstrip())
        else:
            new_body = body.rstrip() + "\n" + new_entries
        queued_path.write_text(text_before + header + new_body + after_section)
    else:
        queued_path.write_text(text_before + addition + new_entries)


# =============================================================================
# --cuts CSV fallback (per spec: human-provided cut list of timestamps to DROP)
# =============================================================================
def cuts_to_drops(cuts_path: Path, transcript_words: list[dict]) -> dict:
    """Convert a human cut list of time windows to DROP into a drops.json-shaped
    dict by mapping each [start_sec, end_sec] window to overlapping word indices.

    CSV format (header optional, case-insensitive):
        start,end,reason
        3.20,5.80,flubbed opening
        41.0,43.5,dead air
    Lines may also be `start,end` (reason defaults to "manual cut").
    A '#'-prefixed line is treated as a comment.
    """
    windows: list[tuple[float, float, str]] = []
    with open(cuts_path, newline="") as fh:
        reader = csv.reader(fh)
        for row in reader:
            if not row:
                continue
            first = row[0].strip()
            if not first or first.startswith("#"):
                continue
            if first.lower() in ("start", "start_sec", "from"):
                continue  # header row
            try:
                s = float(first)
                e = float(row[1])
            except (ValueError, IndexError):
                print(f"[clean_audio] WARN: skipping malformed cut row: {row}", file=sys.stderr)
                continue
            reason = row[2].strip() if len(row) > 2 and row[2].strip() else "manual cut"
            windows.append((s, e, reason))

    dropped_segments = []
    for s, e, reason in windows:
        idxs = [i for i, w in enumerate(transcript_words)
                if w["end"] > s and w["start"] < e]
        if not idxs:
            print(f"[clean_audio] WARN: cut window {s}-{e}s matched no words", file=sys.stderr)
            continue
        dropped_segments.append({
            "start_idx": idxs[0],
            "end_idx_exclusive": idxs[-1] + 1,
            "reason": f"--cuts: {reason} ({s:.2f}-{e:.2f}s)",
        })
    return {
        "dropped_segments": dropped_segments,
        "rationale": f"Generated from human cut list {cuts_path.name}",
    }


# =============================================================================
# DENOISE backend — measure-first gate, then model-grade enhancement (chunk 24)
# -----------------------------------------------------------------------------
# Removes a constant noise profile (room hiss, AC hum, mic hiss) from a recorded
# take without touching speech. The backend is selected AUTOMATICALLY by the
# measure-first gate — no new agent-facing option, no new decision to remember:
#
#   floor < CLEAN_FLOOR_DBFS  → bit-exact pass-through (no DSP, no vendor spend)
#   noisy, sensitivity low/med → Fal DeepFilterNet via the GATEWAY when
#                                keyed (POST /v1/audio/enhance — metered,
#                                kill-switchable; a 404 = route not deployed
#                                yet → local chain); unkeyed development may
#                                use the temporary legacy provider path
#   model unavailable / fails  → the softened ffmpeg chain below (one log line)
#   gateway POLICY refusal     → friendly detail + STOP (402/403/413/422/429 —
#                                never a silent local bypass of metering)
#   --sensitivity high         → the heavy ffmpeg chain, explicitly (no model)
#
# FIDELITY CONTRACT (the muddy-VO fix):
#   1. MEASURE FIRST. Before any processing, the inter-speech noise floor is
#      measured (silencedetect finds the quietest stretches, astats reads their
#      RMS). If the floor is already below CLEAN_FLOOR_DBFS the take is clean —
#      spectral subtraction has nothing legitimate to remove and instead guts
#      the 2–8 kHz presence/consonant band (measured ~10 dB presence loss on a
#      real studio take). Clean takes PASS THROUGH untouched — no DSP AND no
#      model call (zero vendor spend for nothing). --force overrides.
#   2. FORMAT-PRESERVING. Output matches the source sample rate and bit depth
#      (48 kHz/24-bit in → 48 kHz/24-bit out). No silent downgrade to 44.1/s16.
#      DeepFilterNet returns 48 kHz wav (the legacy local model returns
#      44.1 kHz); either output is re-encoded to the source format.
#   3. When the ffmpeg DSP runs, the chain is conservative: medium is nr=7 dB
#      and the gate leaves 60% residual (was nr=12 / 15% residual — the old
#      values caused audible pumping and dulled consonants on borderline takes).
# =============================================================================
CLEAN_FLOOR_DBFS = -50.0  # inter-speech RMS below this → take is already clean

# Temporary unkeyed-local fallback. Keyed app installs never use this model;
# POST /v1/audio/enhance routes to Fal DeepFilterNet in the gateway.
ENHANCE_MODEL = ("resemble-ai/resemble-enhance:"
                 "93266a7e7f5805fb79bcf213b1a4e0ef2e45aff3c06eefd96c59e850c87fd6a2")
ENHANCE_UNIT_USD = 0.016  # ~$0.016/run, input-dependent — priced in cost.py clean_audio[enhance]

SENSITIVITY_PROFILES: dict[str, dict[str, float]] = {
    # nr  = afftdn noise-reduction strength (dB); nf = noise floor (dB);
    # gate_threshold (linear 0-1); gate_range (linear residual after gate).
    # low/medium: the model path handles the cleaning when the gate says noisy —
    # these gentle profiles only run as the DSP FALLBACK (fidelity contract
    # above). high is the explicit heavy LOCAL tool for genuinely bad rooms —
    # deterministic, aggressive, expect audible processing; it never calls the
    # model (an operator reaching for `high` wants the known heavy chain).
    "low":    {"nr": 4.0,  "nf": -25.0, "gate_threshold": 0.012, "gate_range": 0.70},
    "medium": {"nr": 7.0,  "nf": -25.0, "gate_threshold": 0.020, "gate_range": 0.60},
    "high":   {"nr": 20.0, "nf": -20.0, "gate_threshold": 0.030, "gate_range": 0.06},
}


def _probe_audio(path: Path) -> dict:
    """ffprobe the first audio stream → codec_name, sample_rate, channels,
    bits_per_sample (0 for lossy codecs)."""
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample",
         "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {res.stderr.strip()}")
    streams = json.loads(res.stdout or "{}").get("streams") or [{}]
    st = streams[0]
    return {
        "codec_name": st.get("codec_name", ""),
        "sample_rate": int(st.get("sample_rate") or 44100),
        "channels": int(st.get("channels") or 1),
        "bits_per_sample": int(st.get("bits_per_sample") or 0),
    }


def _encoder_args(out_suffix: str, probe: dict) -> list[str]:
    """Encoder args that PRESERVE the source format (fidelity contract #2):
    same sample rate, same bit depth for PCM outputs. Lossy outputs keep 192k
    but no longer force a 44.1 kHz resample."""
    rate = probe["sample_rate"]
    if out_suffix == ".mp3":
        return ["-c:a", "libmp3lame", "-b:a", "192k", "-ar", str(min(rate, 48000))]
    if out_suffix in (".m4a", ".aac"):
        return ["-c:a", "aac", "-b:a", "192k", "-ar", str(min(rate, 96000))]
    # wav (default per skill): keep the source PCM codec if it was PCM,
    # otherwise pick a depth that doesn't lose the decoded signal.
    codec = probe["codec_name"]
    if not codec.startswith("pcm_"):
        codec = "pcm_s24le" if probe["bits_per_sample"] >= 24 else "pcm_s16le"
    return ["-c:a", codec, "-ar", str(rate)]


def _parse_silence_windows(stderr: str, total_dur: float) -> list[tuple[float, float]]:
    """Parse silencedetect stderr into (start, end) windows."""
    windows: list[tuple[float, float]] = []
    start: float | None = None
    for m in re.finditer(r"silence_(start|end): ([0-9.]+)", stderr):
        kind, t = m.group(1), float(m.group(2))
        if kind == "start":
            start = t
        elif kind == "end" and start is not None:
            windows.append((start, t))
            start = None
    if start is not None:  # file ends inside silence
        windows.append((start, total_dur))
    return windows


def measure_noise_floor(audio_in: Path) -> tuple[float | None, dict]:
    """Measure the inter-speech noise floor (RMS dBFS of the quietest stretches).

    Sweeps silencedetect thresholds from quiet to loud until it finds real
    inter-speech gaps, then reads their combined RMS via astats. Returns
    (floor_db, details); floor_db is None when no usable gap exists (wall-to-
    wall speech) — in that case the caller should denoise, not skip.
    """
    total_dur = ffprobe_duration(audio_in)
    for thresh_db in (-45, -40, -35, -30, -25):
        res = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", str(audio_in),
             "-af", f"silencedetect=noise={thresh_db}dB:d=0.25", "-f", "null", "-"],
            capture_output=True, text=True,
        )
        windows = _parse_silence_windows(res.stderr, total_dur)
        # Shrink each window to dodge speech tails bleeding across the boundary.
        trimmed = []
        for s, e in windows:
            s, e = s + 0.075, e - 0.075
            if e - s >= 0.15:
                trimmed.append((s, e))
        trimmed = trimmed[:8]  # cap the measurement cost
        if sum(e - s for s, e in trimmed) < 0.3:
            continue
        expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in trimmed)
        res = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", str(audio_in),
             "-af", f"aselect='{expr}',asetpts=N/SR/TB,astats=measure_perchannel=none",
             "-f", "null", "-"],
            capture_output=True, text=True,
        )
        m = re.search(r"RMS level dB: (-?[0-9.]+|-inf)", res.stderr)
        if not m:
            continue
        floor = float("-inf") if m.group(1) == "-inf" else float(m.group(1))
        return floor, {
            "detect_threshold_db": thresh_db,
            "windows": [(round(s, 3), round(e, 3)) for s, e in trimmed],
            "measured_sec": round(sum(e - s for s, e in trimmed), 2),
        }
    return None, {"reason": "no inter-speech gap >=0.25s found up to -25 dB"}


def passthrough_audio(audio_in: Path, audio_out: Path, probe: dict) -> None:
    """Copy the take through UNTOUCHED (fidelity contract #1). Stream-copies
    when the container matches; otherwise re-encodes format-preservingly.

    No highpass here on purpose: a floor below CLEAN_FLOOR_DBFS already bounds
    any sub-80 Hz rumble to inaudible, and skipping the filter lets same-format
    outputs be bit-exact copies.
    """
    if audio_out.suffix.lower() == audio_in.suffix.lower():
        enc = ["-c:a", "copy"]
    else:
        enc = _encoder_args(audio_out.suffix.lower(), probe)
    run_ffmpeg_atomic(output=audio_out, args=["-i", str(audio_in), *enc])


def denoise_audio(audio_in: Path, audio_out: Path, sensitivity: str, probe: dict) -> None:
    """Spectral-subtraction denoise + residual noise gate. Preserves speech;
    strips constant noise floor. Output container inferred from audio_out suffix
    (wav default per the skill spec); sample rate / bit depth follow the source."""
    prof = SENSITIVITY_PROFILES[sensitivity]
    # afftdn: FFT-domain denoiser (spectral subtraction). nr = reduction in dB,
    #   nf = noise floor in dB. afftdn keeps speech transients intact.
    # agate: gate the residual between words so the floor doesn't pump.
    chain = (
        f"afftdn=nr={prof['nr']}:nf={prof['nf']}:nt=w,"
        f"agate=threshold={prof['gate_threshold']}:range={prof['gate_range']}"
        f":attack=10:release=120,"
        f"highpass=f=80"  # roll off sub-bass rumble (HVAC, handling thump)
    )
    enc = _encoder_args(audio_out.suffix.lower(), probe)
    run_ffmpeg_atomic(
        output=audio_out,
        args=["-i", str(audio_in), "-af", chain, *enc],
    )


def _enhance_via_replicate(audio_in: Path, raw_out: Path, clip_dur: float,
                           job_dir: Path | None) -> dict:
    """VENDOR SEAM (tests mock exactly this): run resemble-enhance through
    replicate_safe (hang-proof + cost-logged) and save the model's raw output
    to raw_out. Returns call details for the tool's event log.

    Timeout policy: JC's unconfirmed observation is runtime (incl. cold start)
    ≈ clip length — so the per-call hard timeout is max(120s, 3× clip duration)
    and the ACTUAL wall-clock seconds are logged (both here and on safe_run's
    replicate_call event) so real signal accumulates to confirm/refute it.
    """
    from replicate_safe import safe_run, download

    timeout_s = int(max(120, 3 * clip_dur))
    t0 = time.perf_counter()
    with open(audio_in, "rb") as fh:
        output = safe_run(
            ENHANCE_MODEL,
            input={
                "input_audio": fh,
                "solver": "Midpoint",
                "number_function_evaluations": 64,
                "prior_temperature": 0.5,
                # We only reach the model when the gate measured real noise —
                # weight the denoiser strongly (lambd=0.9 inside the model).
                "denoise_flag": True,
            },
            job=job_dir, tool="clean_audio.py",
            estimate_usd=ENHANCE_UNIT_USD,
            expected_seconds=int(max(30, clip_dur)),
            max_wait_seconds=timeout_s,
        )
    # Output shape: [denoised.wav, enhanced.wav] — take the enhanced one.
    # Defensive on shape drift: dict → prefer an "enhanced" key; str → itself.
    if isinstance(output, dict):
        output = (output.get("enhanced_audio") or output.get("enhanced")
                  or next(iter(output.values())))
    elif isinstance(output, (list, tuple)):
        output = output[-1]
    download(output, str(raw_out))
    return {"seconds": round(time.perf_counter() - t0, 2),
            "timeout_s": timeout_s, "estimate_usd": ENHANCE_UNIT_USD}


# Statuses that mean "the model refused the run SERVER-side", not "policy
# says no" — same split as pull_video's _GW_VENDOR_REFUSAL.
_GW_ENHANCE_VENDOR_REFUSAL = {502, 504}


def _enhance_via_gateway(audio_in: Path, raw_out: Path, clip_dur: float,
                         job_dir: Path | None) -> dict | None:
    """GATEWAY SEAM (tests mock exactly this): POST /v1/audio/enhance with the
    take as an upload reference; download the enhanced track to raw_out.

    Returns the call-details dict — spend fields included, which run_denoise
    hoists onto the denoise_done event (pull_video's _gw_spend precedent) —
    or None when the DEPLOYED gateway has no /v1/audio/enhance route yet
    (404): the caller then runs the local compatibility chain. 502/504 — the model
    refused the run server-side — raises RuntimeError, which run_denoise turns
    into the ffmpeg fallback with one log line. 402/403/413/422/429 policy
    refusals (spend cap / killed key / size or duration cap / bad input /
    throttle exhausted) surface the friendly `detail` and STOP (SystemExit) —
    never a silent local bypass of metering.
    """
    import requests  # lazy, matching _gateway's own network path

    timeout_s = int(max(120, 3 * clip_dur))  # same policy as the local seam
    t0 = time.perf_counter()
    print("[clean_audio] routing enhancement via gateway (VIDEOCLAW_API_KEY)")
    payload: dict = {"audio": gateway.upload(audio_in),
                     "duration_s": round(clip_dur, 2)}
    if job_dir is not None:
        payload["client_job"] = Path(job_dir).name
    r = requests.post(f"{gateway.url}/v1/audio/enhance", json=payload,
                      headers=gateway.request_headers(),
                      timeout=timeout_s + 120)
    if r.status_code == 404:
        # Old deployed gateway without the endpoint — one line, local chain.
        print("[clean_audio] gateway has no /v1/audio/enhance route yet — "
              "using the local path")
        return None
    if r.status_code >= 400:
        try:
            detail = (r.json() or {}).get("detail") or r.text[:300]
        except Exception:
            detail = r.text[:300]
        if r.status_code in _GW_ENHANCE_VENDOR_REFUSAL:
            raise RuntimeError(f"gateway enhancement failed ({detail})")
        raise SystemExit(f"[clean_audio] gateway refused the enhancement "
                         f"({r.status_code}): {detail}")
    res = r.json()
    gateway.download(res["signed_url"], raw_out)
    details: dict = {"seconds": round(time.perf_counter() - t0, 2),
                     "timeout_s": timeout_s, "gateway": True}
    spend = res.get("spend") or {}
    if spend.get("cost_usd") is not None:
        try:
            details["estimate_usd"] = round(float(spend["cost_usd"]), 4)
        except (TypeError, ValueError):
            pass
    if spend.get("cost_source"):
        details["cost_source"] = spend["cost_source"]
    return details


def collect_enhanced_audio(client, url: str, record: dict) -> bytes:
    """Normal completion and restarted collection share the same re-encoding."""
    from _operations import audio_output_probe
    probe = audio_output_probe(json.loads(record["body"]), record["outputs"])
    with tempfile.TemporaryDirectory(prefix="vc-enhanced-audio-") as directory:
        raw = Path(directory) / "original.wav"
        output = Path(directory) / ("enhanced" + Path(record["outputs"][0]).suffix.lower())
        with raw.open("wb") as source:
            client._download_to(url, source, max_bytes=256 * 1024 * 1024)
        run_ffmpeg_atomic(output=output, args=["-i", str(raw), *_encoder_args(output.suffix, probe)],
                          timeout_sec=300)
        # ponytail: stage at most 256 MiB in memory; stream into the journal if larger imports become necessary.
        if output.stat().st_size > 256 * 1024 * 1024:
            raise GatewayAcceptedError("the enhanced audio exceeds the recovery import limit")
        return output.read_bytes()


def enhance_audio(audio_in: Path, audio_out: Path, probe: dict,
                  job_dir: Path | None) -> dict:
    """Model-grade enhancement (the denoise backend behind the gate).

    Runs the model via a vendor seam — Fal through the GATEWAY when keyed (metered,
    kill-switchable, chunk 24; a 404 means the deployed gateway predates the
    route → local chain), temporary legacy local provider otherwise.
    With durable recovery enabled, an incompatible gateway or refused spend
    stops before generation; accepted work belongs to its original collector.
    Both paths re-encode the model's output back to the SOURCE sample rate / bit
    depth (fidelity contract #2 — provider output may be 44.1 or 48 kHz; a
    48 kHz/24-bit source stays 48 kHz/24-bit). Raises on any vendor failure —
    the caller falls back to the ffmpeg chain. Gateway POLICY refusals
    (402/403/413/422/429) SystemExit out of the tool instead (the seam's
    fallback-ladder contract): a friendly stop, never a metering bypass.
    """
    clip_dur = ffprobe_duration(audio_in)
    if gateway.enabled() and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1":
        t0 = time.perf_counter()
        timeout_s = int(max(120, 3 * clip_dur))
        result = gateway.run("audio/enhance", job=job_dir, timeout_s=timeout_s,
            audio=gateway.upload(audio_in), duration_s=round(clip_dur, 2),
            _audio_output={k: probe[k] for k in ("sample_rate", "codec_name", "bits_per_sample")},
            _delivery=[audio_out])
        try:
            from _billing_manifest import job_path
            collected = gateway.collect_operation(job_path(str(job_dir), Path.cwd()), result["_operation_id"])
            if not all(collected["delivered"].get(p, {}).get("state") == "delivered" for p in collected["outputs"]):
                raise ValueError("the original enhanced audio is awaiting delivery")
        except Exception as exc:
            raise GatewayAcceptedError(
                f"Audio operation {result['_operation_id']} needs recovery; do not repeat it: {exc}") from exc
        return {"seconds": round(time.perf_counter() - t0, 2), "timeout_s": timeout_s,
                "gateway": True, "input_duration_sec": round(clip_dur, 2)}
    raw_out = audio_out.with_name(audio_out.stem + ".model_raw.wav")
    try:
        details = None
        if gateway.enabled():
            details = _enhance_via_gateway(audio_in, raw_out, clip_dur, job_dir)
        if details is None:  # no key, or the route isn't deployed yet
            details = _enhance_via_replicate(audio_in, raw_out, clip_dur, job_dir)
        enc = _encoder_args(audio_out.suffix.lower(), probe)
        run_ffmpeg_atomic(output=audio_out, args=["-i", str(raw_out), *enc])
    finally:
        raw_out.unlink(missing_ok=True)
    details["input_duration_sec"] = round(clip_dur, 2)
    return details


# =============================================================================
# Mode handlers
# =============================================================================
def run_denoise(args, job_dir: Path) -> int:
    if not args.input:
        print("--input required for --mode denoise", file=sys.stderr); return 1
    audio_in = Path(args.input)
    if not audio_in.exists():
        print(f"input not found: {audio_in}", file=sys.stderr); return 1
    if args.sensitivity not in SENSITIVITY_PROFILES:
        print(f"--sensitivity must be one of {list(SENSITIVITY_PROFILES)}", file=sys.stderr); return 1

    if args.output:
        audio_out = Path(args.output)
    else:
        out_dir = job_dir / "03_clean_audio"
        out_dir.mkdir(parents=True, exist_ok=True)
        audio_out = out_dir / f"{audio_in.stem}_clean.wav"
    audio_out.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    probe = _probe_audio(audio_in)

    # ---- skip-on-clean gate (fidelity contract #1) --------------------------
    floor_db: float | None = None
    floor_details: dict = {}
    if args.force:
        gate = "forced"
        print("[clean_audio] --force set → skipping the clean-take gate, denoising unconditionally")
    else:
        floor_db, floor_details = measure_noise_floor(audio_in)
        if floor_db is not None and floor_db < args.clean_floor_db:
            gate = "skipped_clean"
        elif floor_db is None:
            gate = "denoised_unmeasurable"
        else:
            gate = "denoised"

    backend = "passthrough"
    enhance_details: dict = {}
    if gate == "skipped_clean":
        print(f"[clean_audio] noise floor {floor_db:.1f} dBFS < {args.clean_floor_db:.1f} dBFS "
              f"threshold → take is already clean; passing through UNTOUCHED "
              f"(no denoise DSP; use --force to override)")
        passthrough_audio(audio_in, audio_out, probe)
    else:
        if gate == "denoised":
            print(f"[clean_audio] noise floor {floor_db:.1f} dBFS ≥ {args.clean_floor_db:.1f} dBFS "
                  f"threshold → denoising (sensitivity={args.sensitivity})")
        elif gate == "denoised_unmeasurable":
            print(f"[clean_audio] could not measure a noise floor "
                  f"({floor_details.get('reason', 'unknown')}) → denoising "
                  f"(sensitivity={args.sensitivity})")
        print(f"[clean_audio] denoise {audio_in.name} (sensitivity={args.sensitivity}) → {audio_out}")
        # Backend selection is automatic (see the DENOISE header): low/medium →
        # model-grade enhancement; any model failure → the local DSP chain
        # (one log line); high → the explicit heavy local chain, never the model.
        if args.sensitivity == "high":
            backend = "ffmpeg_chain"
            denoise_audio(audio_in, audio_out, args.sensitivity, probe)
        else:
            try:
                enhance_details = enhance_audio(audio_in, audio_out, probe, job_dir)
                backend = "enhance_model"
                print(f"[clean_audio] model-grade enhancement done in "
                      f"{enhance_details['seconds']:.1f}s "
                      f"(input {enhance_details['input_duration_sec']:.1f}s, "
                      f"timeout {enhance_details['timeout_s']}s)")
            except Exception as e:
                if isinstance(e, GatewayAcceptedError) or (
                        isinstance(e, GatewayError) and os.environ.get("VIDEOCLAW_OPERATION_RECOVERY") == "1"):
                    raise  # Accepted work and durable policy refusals cannot fall through.
                backend = "ffmpeg_chain_fallback"
                print(f"[clean_audio] enhancement backend unavailable "
                      f"({type(e).__name__}: {str(e)[:200]}) → falling back to the "
                      f"local DSP chain (sensitivity={args.sensitivity})")
                denoise_audio(audio_in, audio_out, args.sensitivity, probe)
    elapsed = time.perf_counter() - t0

    try:
        dur = ffprobe_duration(audio_out)
    except Exception:
        dur = None
    size_kb = audio_out.stat().st_size // 1024
    print(f"[clean_audio] wrote {audio_out} ({size_kb} KB)")

    # Legacy gateway spend lives on this event. Durable calls already recorded
    # one gateway_call by operation ID and omit these spend fields.
    gw_spend = {k: enhance_details.pop(k)
                for k in ("estimate_usd", "cost_source", "gateway")
                if k in enhance_details}

    log_event(
        job_dir, "clean_audio.py", "denoise_done",
        duration_seconds=elapsed,
        extra={
            "usage_role": "denoise",
            "input": str(audio_in),
            "output": str(audio_out),
            "sensitivity": args.sensitivity,
            "gate": gate,
            "backend": backend,
            # Model-path call details (empty unless backend == enhance_model):
            # seconds = ACTUAL wall-clock (accumulates signal on the unconfirmed
            # runtime≈clip-length observation); the DIRECT path's estimate_usd
            # stays NESTED here — safe_run already logged it top-level on the
            # replicate_call event, and cost.py reconcile must not double-count
            # it. (The gateway path's spend is hoisted above instead.)
            "enhance": enhance_details,
            **gw_spend,
            "noise_floor_db": floor_db,
            "clean_floor_threshold_db": args.clean_floor_db,
            "noise_floor_details": floor_details,
            "source_format": probe,
            "output_duration_sec": dur,
            "size_bytes": audio_out.stat().st_size,
        },
    )
    return 0


def run_trim(args, job_dir: Path) -> int:
    if not args.input:
        print("--input required for --mode trim", file=sys.stderr); return 1
    audio_path = Path(args.input)
    if not audio_path.exists():
        print(f"input not found: {audio_path}", file=sys.stderr); return 1

    # Transcript sidecar — co-located with the audio file.
    if audio_path.name == "raw.mp3":
        transcript_path = audio_path.parent / "transcript.json"
    elif audio_path.name == "cleaned.mp3":
        transcript_path = audio_path.parent / "cleaned.transcript.json"
    else:
        transcript_path = audio_path.with_suffix(".transcript.json")

    # 1. Transcribe (cache aware) + brand-name normalize.
    if transcript_path.exists() and not args.refresh_transcript:
        transcript = json.loads(transcript_path.read_text())
        print(f"[clean_audio] reusing cached transcript: {transcript_path}")
    else:
        transcript = transcribe(audio_path, job=job_dir)
        n_fixed = normalize_brand_names(transcript)
        transcript_path.write_text(json.dumps(transcript, indent=2))
        print(f"[clean_audio] wrote {transcript_path}")
        log_event(
            job_dir, "clean_audio.py", "transcribe_done",
            extra={
                "usage_role": "trim",
                "input": str(audio_path),
                "transcript": str(transcript_path),
                "words": len(transcript.get("words", [])),
                "brand_fixes": n_fixed,
                "model": SCRIBE_MODEL,
            },
        )
    print(f"[clean_audio] transcript: {len(transcript['words'])} words")

    if args.transcribe_only:
        return 0

    # 2. Resolve the drops source: explicit --drops OR --cuts fallback.
    if not args.output:
        print("--output required for the cut step (or use --transcribe-only)", file=sys.stderr); return 1
    out_path = Path(args.output)

    if args.cuts:
        cuts_path = Path(args.cuts)
        if not cuts_path.exists():
            print(f"cuts not found: {cuts_path}", file=sys.stderr); return 1
        drops = cuts_to_drops(cuts_path, transcript["words"])
        script_text = ""
        if args.script and Path(args.script).exists():
            script_text = Path(args.script).read_text()
        print(f"[clean_audio] --cuts → {len(drops['dropped_segments'])} drop segment(s)")
    else:
        missing = [n for n, v in [("--script", args.script), ("--drops", args.drops)] if not v]
        if missing:
            print(f"missing required args (or use --cuts / --transcribe-only): {', '.join(missing)}",
                  file=sys.stderr)
            return 1
        script_path = Path(args.script)
        drops_path = Path(args.drops)
        if not script_path.exists():
            print(f"script not found: {script_path}", file=sys.stderr); return 1
        if not drops_path.exists():
            print(f"drops not found: {drops_path}", file=sys.stderr); return 1
        script_text = script_path.read_text()
        drops = json.loads(drops_path.read_text())

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 3. Compute kept_indices from drops + editor_notes (both cut from audio).
    n_words = len(transcript["words"])
    dropped = set()
    for seg in drops.get("dropped_segments", []):
        s = int(seg.get("start_idx", 0))
        e = int(seg.get("end_idx_exclusive", 0))
        if e <= s or s < 0 or e > n_words:
            print(f"[clean_audio] WARN: invalid drop range {s}..{e} (transcript has {n_words} words)",
                  file=sys.stderr)
            continue
        for i in range(s, e):
            dropped.add(i)
    # Editor notes are word-ranges of spoken instructions, not script. Cut from
    # audio (so lipsync doesn't include them) + captured to the queued file below.
    editor_notes = drops.get("editor_notes", [])
    for note in editor_notes:
        s = int(note.get("start_idx", 0))
        e = int(note.get("end_idx_exclusive", 0))
        if e <= s or s < 0 or e > n_words:
            print(f"[clean_audio] WARN: invalid editor_note range {s}..{e}", file=sys.stderr)
            continue
        for i in range(s, e):
            dropped.add(i)
    kept_indices = [i for i in range(n_words) if i not in dropped]
    if not kept_indices:
        print("dropped everything — abort", file=sys.stderr); return 2
    print(f"[clean_audio] drops: {len(dropped)} indices, keeping {len(kept_indices)}/{n_words}")

    # 4. Build segments + concat.
    segments = build_keep_segments(
        transcript["words"], kept_indices,
        head_pad_ms=args.head_pad_ms,
        tail_pad_ms=args.tail_pad_ms,
        join_gap_ms=args.join_gap_ms,
    )
    print(f"[clean_audio] {len(segments)} keep-segments:")
    for s, e in segments:
        print(f"    {s:7.3f} → {e:7.3f}  ({e - s:.2f}s)")

    concat_audio_segments(
        audio_path, segments, out_path,
        crossfade_ms=args.crossfade_ms,
        trim_trailing_silence=not args.no_trim_trailing,
        silence_threshold_db=args.trim_silence_db,
        silence_min_dur_sec=args.trim_silence_dur,
    )
    print(f"[clean_audio] wrote {out_path} ({out_path.stat().st_size // 1024} KB"
          f"{'; trimmed trailing silence' if not args.no_trim_trailing else ''})")

    # 5. Sidecars (diff log of cut regions, per the skill spec).
    if out_path.name == "cleaned.mp3":
        actual_md_path = out_path.parent / "actual_delivery.md"
    else:
        actual_md_path = out_path.with_suffix("").with_suffix(".actual_delivery.md")
    write_actual_delivery_md(actual_md_path, script_text, transcript["words"], drops, kept_indices, segments)
    print(f"[clean_audio] wrote {actual_md_path}")

    # 6. Editor notes → queued/shipped file's "Editor notes (recording)" section.
    if args.queued_file and editor_notes:
        qf = Path(args.queued_file)
        if not qf.exists():
            print(f"[clean_audio] WARN: --queued-file not found: {qf}", file=sys.stderr)
        else:
            append_editor_notes_to_queued_file(qf, transcript["words"], editor_notes)
            print(f"[clean_audio] appended {len(editor_notes)} editor note(s) → {qf}")

    kept_dur = sum(e - s for s, e in segments)
    raw_dur = transcript["words"][-1]["end"] if transcript["words"] else 0
    log_event(
        job_dir, "clean_audio.py", "trim_done",
        extra={
            "usage_role": "trim",
            "input": str(audio_path),
            "output": str(out_path),
            "source": "cuts" if args.cuts else "drops",
            "words_in": n_words,
            "words_kept": len(kept_indices),
            "keep_segments": len(segments),
            "kept_duration_sec": round(kept_dur, 2),
            "raw_duration_sec": round(raw_dur, 2),
            "size_bytes": out_path.stat().st_size,
        },
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, description=__doc__.split("\n\n")[0])
    add_job_arg(p)
    p.add_argument("--mode", required=True, choices=["denoise", "trim"],
                   help="Which job to run. Logged as usage_role. REQUIRED.")
    p.add_argument("--input", help="Raw recorded audio (mp3/wav/m4a).")
    p.add_argument("--output", help="Cleaned audio output path.")

    # denoise
    p.add_argument("--sensitivity", default="medium", choices=["low", "medium", "high"],
                   help="[denoise] Noise-reduction aggressiveness (default medium). "
                        "low/medium: a noisy take gets the model-grade enhancement "
                        "backend (the profile only shapes the local DSP fallback); "
                        "high: the explicit heavy LOCAL chain for genuinely bad "
                        "rooms — deterministic, audible processing, no model.")
    p.add_argument("--force", action="store_true",
                   help="[denoise] Run the denoise DSP even if the take measures clean "
                        "(overrides the skip-on-clean gate).")
    p.add_argument("--clean-floor-db", type=float, default=CLEAN_FLOOR_DBFS,
                   help="[denoise] Inter-speech noise-floor threshold in dBFS; a take "
                        f"measuring below this passes through untouched (default {CLEAN_FLOOR_DBFS}).")

    # trim
    p.add_argument("--script", help="[trim] Reference script .txt.")
    p.add_argument("--drops", help="[trim] drops.json decision file.")
    p.add_argument("--cuts", help="[trim] Fallback CSV of time windows (start,end[,reason]) "
                                  "to DROP, in lieu of a transcript-anchored drops.json.")
    p.add_argument("--transcribe-only", action="store_true",
                   help="[trim] Run Scribe v2 + normalize, save transcript.json, then exit.")
    p.add_argument("--refresh-transcript", action="store_true",
                   help="[trim] Re-transcribe even if a cached sidecar exists.")
    p.add_argument("--head-pad-ms", type=int, default=50)
    p.add_argument("--tail-pad-ms", type=int, default=50)
    p.add_argument("--join-gap-ms", type=int, default=80)
    p.add_argument("--crossfade-ms", type=int, default=30)
    p.add_argument("--no-trim-trailing", action="store_true",
                   help="[trim] Disable trailing-silence trim (default: trim > 0.3s at < -40dB).")
    p.add_argument("--trim-silence-db", type=float, default=-40.0)
    p.add_argument("--trim-silence-dur", type=float, default=0.30)
    p.add_argument("--queued-file",
                   help="[trim] Markdown file whose 'Editor notes (recording)' section "
                        "receives drops.json editor_notes[] (also cut from audio).")
    return p


def main() -> int:
    args = build_parser().parse_args()
    job_dir = resolve_job_dir(args.job)

    log_event(
        job_dir, "clean_audio.py", "invoked",
        extra={"usage_role": args.mode, "input": args.input, "output": args.output},
        render_md=False,
    )

    if args.mode == "denoise":
        return run_denoise(args, job_dir)
    return run_trim(args, job_dir)


if __name__ == "__main__":
    sys.exit(main())
