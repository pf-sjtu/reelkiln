"""
score_bed.py — the canonical audio-bed primitive. ONE tool, `--mode` picks the source.

  uv run python tools/score_bed.py --job <id> --mode bed --music <track> [...]
  uv run python tools/score_bed.py --job <id> --mode generate --prompt "..." [...]

Two modes:

  --mode bed       (DEFAULT) Lay a USER-SUPPLIED, licensed/owned music track under
                   the VO+avatar audio. RMS-windows a long track to the best section,
                   trims/loops to video length, HP-filters at 60 Hz, sets the bed level
                   (--mix, below), places user-dropped or rights-cleared catalog SFX at
                   resolved anchor timestamps, and muxes back onto the video. This is the canonical,
                   100%-of-shipped-productions path. Requires a job-local
                   videoclaw.music-rights/v1 record bound to the exact track hash;
                   file presence alone never becomes a license assertion.

  --mode generate  (OPT-IN, default OFF) Generate an instrumental bed via the gateway
                   "music" tool (Lyria since chunk 31; raw-key fallback = ElevenLabs),
                   then run the SAME post pipeline as --mode bed. AI music is opt-in /
                   default-off because the operator distrusts it for shipped content —
                   never inferred, always an explicit decision. Add --raw-only for a
                   STANDALONE instrumental (WAV + MP3, no video input and no mux).

Bed level (#276, #321 — JC's rule: one steady, quiet bed; ducking is retired):

  One constant gain puts the bed --bed-under-voice-db (default 12) below the
  narration's integrated loudness — about -26 LUFS under a -14 LUFS voice, i.e.
  roughly 20% volume. No ducking, no swells, no loudness normalisation of the bed.
  `--mix duck`, `--mix loudnorm` and `--duck-db` are accepted so old prompts and
  cards keep working, and are ignored with a one-line notice: the bed is flat.
  A source with no narration to sit under (no audio stream, or silence) makes the
  bed the programme: normalised to -14 LUFS, still without any ducking.

HARD RULE — NEVER auto-generate SFX. `score_bed` places ONLY user-supplied files or
exact catalog IDs already fetched into `<job_dir>/sfx/` and named in `--sfx-manifest`.
It never calls sfx.py / sfx_gen.py.
No manifest = no SFX placed.

Self-contained consolidation of (now-deleted) backends:
  - audio_bed.py  — ffmpeg mix/loudnorm recipes, MVSep diagnostic path.
  - gen_music.py  — instrumental generation (now Lyria via the gateway "music"
                    tool, chunk 31; before that ElevenLabs Eleven Music; the old
                    Replicate path was retired 2026-07-06).

Reads:   <job_dir>/final_raw.mp4   (densified VO+avatar; override with --input)
         <job_dir>/transcript.json (PASS 2 word timings; for SFX anchors + the margin)
         <job_dir>/sfx/<file>      (user-dropped SFX named in the manifest)
Writes:  <job_dir>/audio/final_mix.wav  (the mixed bed; override with --output)
         <job_dir>/audio/final_mix.mp4  (video re-muxed with the mixed bed)
         <job_dir>/audio/bed_meta.json  (provenance + bed level +
                                        narration_bed_margin, #237 advisory)

`--mode` is REQUIRED and logged as usage_role.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

from _gateway import GatewayAcceptedError, gateway
from job import (
    add_job_arg,
    resolve_job_dir,
    resolve_job_input_path,
    resolve_job_output_path,
)
from log import log_event
from _render_completion import (
    made_from_final, publish, publish_deliverable, staging_path,
)
from sfx_catalog import CatalogError, resolve_exact
import _bed_level

load_dotenv()
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# ── Music generation (--mode generate) ───────────────────────────────────────
# Instrumental bed generator = the gateway "music" tool → Lyria since chunk 31
# (JC 2026-07-18; was ElevenLabs Eleven Music). Raw ELEVENLABS_API_KEY remains
# the no-gateway fallback and still speaks Eleven's API below.
# Retired the old Replicate path (minimax/music-2.6 → meta/musicgen) 2026-07-06.
ELEVEN_MUSIC_MODEL = "music_v2"          # model_id; also accepts "music_v1"
ELEVEN_MUSIC_URL = "https://api.elevenlabs.io/v1/music"
ELEVEN_MUSIC_CREDITS_PER_MIN = 900       # ~$0.066/min on JC's plan (metering fallback)
MUSIC_MIN_DURATION_SEC = 3.0             # provider-supported generation range
MUSIC_MAX_DURATION_SEC = 600.0

# Provider filters reject named music references. This is deliberately a small,
# conservative guard, not a claim to recognize every artist or brand in prose.
_MUSIC_REFERENCE_NAMES = (
    "Tycho", "Bonobo", "Nils Frahm", "Olafur Arnalds", "Khruangbin",
    "Cliff Martinez", "Max Richter", "Taylor Swift", "Hans Zimmer",
    "Daft Punk", "ElevenLabs", "Spotify", "Apple Music",
)
# Imitation wording alone is common in ordinary sound descriptions. Require
# a title-shaped name after it; explicit song/artist labels also accept a
# single capitalized or quoted title. The list above catches known names in
# other positions, including hyphenated "Daft Punk-style" wording.
_MUSIC_REFERENCE_RE = re.compile(
    r"\b(?i:in the style of|sounds? like|inspired by|similar to)\s+"
    r"(?:[A-Z][A-Za-z'-]*\s+){1,2}[A-Z][A-Za-z'-]*\b|"
    r"\b(?i:song|track|album|artist|band)\s+(?i:by|called|named)\s+"
    r"(?:[A-Z][A-Za-z'-]*|\"[^\"]+\"|'[^']+')",
)


def _check_music_prompt(prompt: str) -> str:
    """Reject named music references before either paid generation route."""
    clean = prompt.strip()
    if not clean:
        raise SystemExit("--prompt must describe genre, tempo, instruments and mood")
    if _MUSIC_REFERENCE_RE.search(clean) or any(
        re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", clean, re.IGNORECASE)
        for name in _MUSIC_REFERENCE_NAMES
    ):
        raise SystemExit(
            "--prompt must describe genre, tempo, instruments and mood without "
            "artist, song or brand names; reword it before generating music"
        )
    return clean

# ── Mix constants (preserved from audio_bed.py recipe) ────────────────────────
# A bed with no narration under it is the programme: this constant pre-gain,
# then normalised to TARGET_LUFS (the same graph as before #321).
PROGRAMME_PRE_GAIN_DB = -14.0
HP_FILTER_HZ = 60                # high-pass the bed to keep the low end clean
TARGET_LUFS = -14.0              # final integrated loudness (spec: -14 LUFS)
LOUDNORM_LRA = 7
LOUDNORM_TP = -1.0
DEFAULT_BEST_SECTION_SEC = 30    # RMS window length to pick from long tracks
SPEECH_PAD_SEC = 0.25            # pad each word's span into the speech windows

# Integrated loudness (TARGET_LUFS above) says nothing about whether narration
# stays audible OVER the bed — that is a relationship between two stems, not a
# property of the summed mix. #237 reporters described exactly that: a bed
# normalized to spec that still buries the voice. MIN_NARRATION_BED_MARGIN_DB
# is how far the narration's loudness must sit above the DELIVERED bed's
# during speech before it is worth an advisory finding.
#
# It is read off the bed as the mux delivers it, after `_automate_and_mix` has
# set its level, and in the loudness the mix levels by (BS.1770, K-weighted),
# so a correct default mix reads its FLAT_BED_UNDER_VOICE_DB gap. Unweighted
# RMS read that same mix as 7-8 dB on a low, percussive bed. 8 dB is not
# derived from any cited standard — it is a product/advisory threshold chosen for this check, picked
# conservatively so the voice reads as leading rather than competing, and it
# is expected to be tuned against real jobs as this check sees more of them.
MIN_NARRATION_BED_MARGIN_DB = 8.0

# Bed level (#276, #321). JC's rule: the music is a flat, quiet bed under the
# voice (~20% volume) — no ducking, no swells, no bed-alone loudnorm (the
# -14 LUFS normalisation is what made beds louder than the voice, #240). The
# mix measures the narration's and the bed's integrated loudness (the bed as
# the mux delivers it) and applies ONE constant gain so the bed sits
# FLAT_BED_UNDER_VOICE_DB below the voice: about -26 LUFS under a -14 LUFS
# voice. Ducking is retired (#321): "duck" and "loudnorm" (the old duck-and-
# normalise pipeline) are still accepted on the command line and laid flat.
MIX_FLAT = "flat"
RETIRED_MIXES = ("duck", "loudnorm")
MIX_CHOICES = (MIX_FLAT, *RETIRED_MIXES)
MIX_PROGRAMME = "programme"      # no narration: the bed is the programme
FLAT_BED_UNDER_VOICE_DB = 12.0
BED_PEAK_CEILING_DBFS = -1.0     # the flat gain never pushes bed samples past this
SILENT_LUFS = -69.5              # ebur128 reports -70 LUFS for gated-out silence

# Stem order returned by the gateway `stem_split` endpoint (MVSEP MDX23).
# The separation runs through the gateway via pull_video._separate_stems
# (see `--mode split` below and the stem-split-wired memory) — no raw Replicate id here.
STEM_NAMES = ("bass", "drums", "other", "vocals")


# ─────────────────────────────────────────────────────────────────────────────
# Shared low-level helpers (inlined; no import of the deleted backends).
# ─────────────────────────────────────────────────────────────────────────────

def _run(cmd: list[str], what: str) -> subprocess.CompletedProcess:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{what} failed (exit {res.returncode}):\n{res.stderr[-800:]}")
    return res


def _ffprobe_duration(path: Path) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0 or not res.stdout.strip():
        raise RuntimeError(f"ffprobe could not read duration of {path}: {res.stderr.strip()}")
    return float(res.stdout.strip())


def _has_audio_stream(path: Path) -> bool:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return bool(res.stdout.strip())


def _has_video_stream(path: Path) -> bool:
    res = subprocess.run(
        # `V` excludes attached pictures: cover art is not a picture to mux onto.
        ["ffprobe", "-v", "error", "-select_streams", "V", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return bool(res.stdout.strip())


# ─────────────────────────────────────────────────────────────────────────────
# RMS windowing — pick the loudest `best_section_sec` window of a long track.
# Implemented with ffmpeg `astats` over candidate windows (no librosa dep).
# ─────────────────────────────────────────────────────────────────────────────

def _window_rms_db(track: Path, start: float, length: float) -> float:
    """Mean RMS level (dBFS) of the [start, start+length] window. Higher = louder."""
    res = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats",
         "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(track),
         "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    # astats prints "RMS level dB: -XX.XX" lines (per-channel + Overall). Take the
    # most negative-floor-tolerant: parse the Overall RMS level if present, else
    # average the channel lines.
    overall = None
    chans: list[float] = []
    for line in res.stderr.splitlines():
        s = line.strip()
        if "RMS level dB:" in s:
            try:
                val = float(s.split("RMS level dB:")[1].strip())
            except ValueError:
                continue
            chans.append(val)
    if chans:
        overall = sum(chans) / len(chans)
    return overall if overall is not None else -120.0


def _best_section(track: Path, best_section_sec: float, video_dur: float) -> float:
    """Return the start offset of the highest-RMS window. Avoids quiet intros/outros.

    If the track is shorter than the requested window we just start at 0.
    """
    track_dur = _ffprobe_duration(track)
    window = min(best_section_sec, track_dur, max(video_dur, 1.0))
    if track_dur <= window + 0.5:
        return 0.0
    # Scan candidate starts on a coarse hop (window/3) to keep ffmpeg calls cheap.
    hop = max(window / 3.0, 2.0)
    best_start, best_rms = 0.0, -1e9
    t = 0.0
    while t + window <= track_dur + 1e-3:
        rms = _window_rms_db(track, t, window)
        if rms > best_rms:
            best_rms, best_start = rms, t
        t += hop
    return best_start


def _windowed_lufs(track: Path, windows: list[tuple[float, float]], track_dur: float) -> float | None:
    """Integrated loudness (LUFS) of `track` across `windows` only.

    ONE ffmpeg pass: `aselect` keeps only samples inside the clamped windows,
    `asetpts` restamps the survivors into a gapless stream, and ebur128 reads
    it all channels combined, the way `_flat_bed_gain` levels the bed.

    Returns None when the measurement is UNAVAILABLE: no window survives
    clamping, less than one 400 ms gating block survives (ebur128 would report
    silence), or ffmpeg failed or printed no reading. Gated-out silence is a
    real measurement and comes back as `-inf`; deciding what a margin against
    silence means is the caller's.
    """
    spans: list[tuple[float, float]] = []
    for start, end in windows:
        start = max(0.0, start)
        end = min(end, track_dur)
        if end - start <= 0.01:
            continue
        spans.append((start, end))
    if sum(e - s for s, e in spans) < 0.4:
        return None
    expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in spans)
    loudness, _ = _ebur128(
        [track], f"[0:a]aselect='{expr}',asetpts=N/SR/TB,ebur128=framelog=quiet")
    if loudness is None:
        return None
    return float("-inf") if loudness <= SILENT_LUFS else loudness


def _ebur128(inputs: list[Path], graph: str) -> tuple[float | None, float | None]:
    """(integrated LUFS, sample peak dBFS) of the one ebur128 at the end of `graph`.

    Integrated loudness is gated (BS.1770), so pauses between phrases do not
    drag a voice's reading down the way a plain RMS average would. Returns None
    for a value ffmpeg did not report; silence reads as -70 LUFS / -inf dBFS.
    """
    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    for path in inputs:
        cmd += ["-i", str(path)]
    res = subprocess.run(cmd + ["-filter_complex", graph, "-vn", "-f", "null", "-"],
                         capture_output=True, text=True)
    if res.returncode != 0:
        return None, None

    def _last(pattern: str) -> float | None:
        found = re.findall(pattern, res.stderr)
        if not found:
            return None
        return float("-inf") if found[-1] == "-inf" else float(found[-1])

    return (_last(r"I:\s+(-?[0-9.]+|-inf) LUFS"), _last(r"Peak:\s+(-?[0-9.]+|-inf) dBFS"))


def _flat_bed_gain(video: Path, bed: Path, *, under_voice_db: float) -> dict | None:
    """The one constant gain that sits `bed` `under_voice_db` below the narration.

    Narration = the source video's own audio (the mux leaves it untouched). The
    bed is measured as the mux delivers it — through the same amix, narration
    muted — so a stereo bed folded into a mono voice is judged at the level the
    viewer hears. The gain is capped so no bed sample passes
    BED_PEAK_CEILING_DBFS. Returns None when there is no narration to sit under
    (no audio stream, or silence): the caller then treats the bed as the
    programme. Raises when a measurement cannot be taken — refusing is better
    than an unbalanced mix.
    """
    if not _has_audio_stream(video):
        return None
    narration_lufs, _ = _ebur128([video], "[0:a]ebur128=framelog=quiet")
    if narration_lufs is None:
        raise RuntimeError("cannot measure the narration loudness; refusing an unbalanced mix")
    if narration_lufs <= SILENT_LUFS:
        return None
    bed_lufs, _ = _ebur128(
        [video, bed],
        "[0:a]volume=0[muted];[muted][1:a]amix=inputs=2:duration=first:normalize=0,"
        "ebur128=framelog=quiet")
    _, bed_peak = _ebur128([bed], "[0:a]ebur128=peak=sample:framelog=quiet")
    if bed_lufs is None or bed_peak is None:
        raise RuntimeError("cannot measure the music bed; refusing an unbalanced mix")
    target = narration_lufs - under_voice_db
    if bed_lufs <= SILENT_LUFS:
        gain = 0.0      # a silent bed stays silent; never amplify its noise floor
    else:
        gain = target - bed_lufs
    capped = math.isfinite(bed_peak) and bed_peak + gain > BED_PEAK_CEILING_DBFS
    if capped:
        gain = BED_PEAK_CEILING_DBFS - bed_peak
    return {"gain_db": round(gain, 2), "narration_lufs": narration_lufs,
            "bed_lufs_delivered": bed_lufs, "bed_target_lufs": round(target, 2),
            "bed_peak_dbfs": bed_peak, "peak_capped": capped}


# ─────────────────────────────────────────────────────────────────────────────
# Speech windows from the PASS 2 transcript → ffmpeg volume-automation expression.
# ─────────────────────────────────────────────────────────────────────────────

def _speech_windows(transcript: dict, pad: float = SPEECH_PAD_SEC) -> list[tuple[float, float]]:
    """Merge padded word spans into contiguous speech windows.

    Transcript words are {"word", "start", "end"} (PASS 2 from densify.py).
    """
    words = transcript.get("words", []) if transcript else []
    spans: list[list[float]] = []
    for w in words:
        try:
            s = max(0.0, float(w["start"]) - pad)
            e = float(w["end"]) + pad
        except (KeyError, TypeError, ValueError):
            continue
        if spans and s <= spans[-1][1]:
            spans[-1][1] = max(spans[-1][1], e)
        else:
            spans.append([s, e])
    return [(a, b) for a, b in spans]


def _db_to_gain(db: float) -> float:
    return 10.0 ** (db / 20.0)


# ─────────────────────────────────────────────────────────────────────────────
# SFX anchor resolution — user-supplied only, NEVER generated.
# ─────────────────────────────────────────────────────────────────────────────

def _word_index(transcript: dict) -> list[dict]:
    return transcript.get("words", []) if transcript else []


def _resolve_anchor_time(words: list[dict], anchor_word: str, occurrence: int) -> float | None:
    """Find the start time of the Nth (1-based) occurrence of `anchor_word`."""
    target = (anchor_word or "").strip().strip(".,!?;:\"'").lower()
    if not target:
        return None
    hit = 0
    for w in words:
        norm = str(w.get("word", "")).strip().strip(".,!?;:\"'").lower()
        if norm == target:
            hit += 1
            if hit >= max(1, occurrence):
                try:
                    return float(w["start"])
                except (KeyError, TypeError, ValueError):
                    return None
    return None


_CATALOG_REF_RE = re.compile(r"^catalog:([a-z0-9]+(?:[._][a-z0-9]+)+)@(\d+)$")


def _catalog_cached_asset(sfx_dir: Path, asset_id: str, version: int) -> tuple[Path, str]:
    manifest = sfx_dir / "catalog-provenance.json"
    if not manifest.is_file():
        raise SystemExit(
            f"catalog SFX {asset_id}@{version} is not cached for this job; "
            f"run sfx_catalog.py --mode fetch --id {asset_id} --version {version}"
        )
    try:
        provenance = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit("job SFX catalog provenance is unreadable") from exc
    if (provenance.get("schema") != "videoclaw.sfx-provenance/v1"
            or not isinstance(provenance.get("assets"), list)):
        raise SystemExit("job SFX catalog provenance has an unsupported schema")
    match = next((item for item in provenance["assets"]
                  if item.get("id") == asset_id and item.get("version") == version), None)
    if not match:
        raise SystemExit(f"catalog SFX {asset_id}@{version} is not present in job provenance")
    try:
        attested = resolve_exact(asset_id, version)["asset"]
    except CatalogError as exc:
        raise SystemExit(
            f"catalog SFX {asset_id}@{version} could not be re-attested; "
            "omit it or retry while connected"
        ) from exc
    rights = attested["rights"]
    expected_receipt = {
        "sha256": attested["sha256"],
        "byte_size": attested["byte_size"],
        "source_owner": rights["source_owner"],
        "license": rights["license"],
        "provenance": rights["provenance"],
        "ingest_date": rights["ingest_date"],
        "attribution_required": False,
        "usage_restrictions": [],
    }
    if any(match.get(key) != value for key, value in expected_receipt.items()):
        raise SystemExit(
            f"catalog SFX {asset_id}@{version} provenance does not match the gateway attestation"
        )
    candidate = (sfx_dir.parent / str(match.get("destination", ""))).resolve()
    sfx_root = sfx_dir.resolve()
    if not candidate.is_relative_to(sfx_root) or not candidate.is_file():
        raise SystemExit(f"catalog SFX {asset_id}@{version} cache file is missing or unsafe")
    digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
    if digest != match.get("sha256") or candidate.stat().st_size != match.get("byte_size"):
        raise SystemExit(f"catalog SFX {asset_id}@{version} cache hash does not match provenance")
    return candidate, digest


def _resolve_sfx_placements(
    *, sfx_manifest_path: Path | None, sfx_dir: Path, transcript: dict, job: Path | None,
) -> list[dict]:
    """Resolve user files or exact cached catalog IDs. NEVER generates audio.

    Manifest shape (matches design_brief.md SFX manifest):
      { "<filename>": {"anchor_word": "...", "occurrence": 1, "lead_in_sec": 0.0,
                        "gain_db": 0.0} , ... }
    or a list of {"file","anchor_word","occurrence","lead_in_sec","gain_db"} /
    {"file","at_sec"}. Catalog entries use ``catalog:<stable.id>@<version>``
    as the key/file or provide ``catalog_id`` + ``version``.
    """
    if not sfx_manifest_path:
        return []
    if not sfx_manifest_path.exists():
        raise SystemExit(f"--sfx-manifest not found: {sfx_manifest_path}")
    raw = json.loads(sfx_manifest_path.read_text())
    entries: list[tuple[str, dict]] = []
    if isinstance(raw, dict):
        entries = [(k, v if isinstance(v, dict) else {}) for k, v in raw.items()]
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                catalog_name = (f"catalog:{item['catalog_id']}@{item.get('version', 1)}"
                                if item.get("catalog_id") else "")
                entries.append((item.get("file") or item.get("filename") or catalog_name, item))
    words = _word_index(transcript)

    placements: list[dict] = []
    for fname, spec in entries:
        fname = (fname or spec.get("file") or "").strip()
        if not fname:
            continue
        catalog_match = _CATALOG_REF_RE.fullmatch(fname)
        catalog_id = None
        catalog_version = None
        catalog_sha = None
        if catalog_match:
            catalog_id = catalog_match.group(1)
            catalog_version = int(catalog_match.group(2))
            sfx_path, catalog_sha = _catalog_cached_asset(
                sfx_dir, catalog_id, catalog_version)
        else:
            # Resolve relative to the user's SFX drop dir; absolute paths pass through.
            p = Path(fname)
            sfx_path = p if p.is_absolute() else (sfx_dir / p.name)
            if not sfx_path.exists():
                print(f"  ! SFX file missing, skipping (user must drop it): {sfx_path}",
                      file=sys.stderr)
                continue
        lead_in = float(spec.get("lead_in_sec", 0.0) or 0.0)
        gain_db = float(spec.get("gain_db", 0.0) or 0.0)
        if "at_sec" in spec and spec["at_sec"] is not None:
            at = float(spec["at_sec"]) - lead_in
        else:
            at = _resolve_anchor_time(
                words, spec.get("anchor_word", ""), int(spec.get("occurrence", 1) or 1)
            )
            if at is None:
                print(f"  ! could not resolve anchor for {sfx_path.name} "
                      f"(word={spec.get('anchor_word')!r}); skipping", file=sys.stderr)
                continue
            at = max(0.0, at - lead_in)
        placements.append({"path": sfx_path, "at_sec": max(0.0, at), "gain_db": gain_db,
                           **({"catalog_id": catalog_id, "catalog_version": catalog_version,
                               "sha256": catalog_sha} if catalog_id else {})})

    if job is not None and placements:
        log_event(
            job, tool="score_bed.py", event="sfx_resolved",
            extra={"count": len(placements),
                   "placements": [{"file": str(p["path"].name),
                                   "at_sec": round(p["at_sec"], 3),
                                   "gain_db": p["gain_db"],
                                   **({"catalog_id": p["catalog_id"],
                                       "catalog_version": p["catalog_version"],
                                       "sha256": p["sha256"]}
                                      if p.get("catalog_id") else {})}
                                  for p in placements]},
        )
    return placements


# ─────────────────────────────────────────────────────────────────────────────
# The shared post pipeline used by BOTH modes:
#   raw bed wav → best-section trim/loop → HP-filter → one constant level
#   under the voice → mix user SFX → mux onto video.
# ─────────────────────────────────────────────────────────────────────────────

def _prepare_bed_to_length(raw_bed: Path, out_bed: Path, *,
                           video_dur: float, best_section_sec: float) -> Path:
    """RMS-window the raw bed to its best section, then trim OR seamlessly loop it
    to exactly `video_dur` seconds. HP-filters at 60 Hz."""
    out_bed.parent.mkdir(parents=True, exist_ok=True)
    start = _best_section(raw_bed, best_section_sec, video_dur)
    track_dur = _ffprobe_duration(raw_bed)
    available = track_dur - start

    af = f"highpass=f={HP_FILTER_HZ},apad,atrim=0:{video_dur:.3f},asetpts=N/SR/TB"
    if available >= video_dur:
        # Trim the best-section window to length.
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-ss", f"{start:.3f}", "-t", f"{video_dur:.3f}", "-i", str(raw_bed),
               "-af", af, "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le",
               str(out_bed)]
    else:
        # Track shorter than video → seamless loop from the best-section boundary.
        # -stream_loop -1 repeats the input; we then trim to length.
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-stream_loop", "-1", "-ss", f"{start:.3f}", "-i", str(raw_bed),
               "-af", af, "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le",
               str(out_bed)]
    _run(cmd, "ffmpeg bed trim/loop")
    return out_bed


def _automate_and_mix(
    *, bed: Path, sfx: list[dict], out_wav: Path, bed_gain_db: float | None,
) -> Path:
    """Set the bed's one constant level, and mix in user SFX at their timestamps.

    `bed_gain_db` is the flat gain under the voice; nothing else touches the
    bed, and each SFX plays at its own manifest gain_db. None means there is
    no voice: the bed is the programme, so the bed+SFX sum is normalised to
    TARGET_LUFS instead. Neither path ever ducks (#321)."""
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    programme = bed_gain_db is None
    if programme:
        bed_chain = f"volume={_db_to_gain(PROGRAMME_PRE_GAIN_DB):.5f}"
    else:
        bed_chain = f"volume={bed_gain_db:.3f}dB"

    inputs = ["-i", str(bed)]
    for s in sfx:
        inputs += ["-i", str(s["path"])]

    # filter_complex: level the bed, delay+gain each SFX, amix everything
    # (and loudnorm, for a programme bed only).
    fc_parts = [f"[0:a]{bed_chain}[bed]"]
    mix_labels = ["[bed]"]
    for i, s in enumerate(sfx, start=1):
        delay_ms = int(round(s["at_sec"] * 1000))
        gain = _db_to_gain(s["gain_db"])
        fc_parts.append(
            f"[{i}:a]adelay={delay_ms}|{delay_ms},volume={gain:.5f}[sfx{i}]"
        )
        mix_labels.append(f"[sfx{i}]")
    n = len(mix_labels)
    finish = (f"[mixed]loudnorm=I={TARGET_LUFS}:LRA={LOUDNORM_LRA}:tp={LOUDNORM_TP}[out]"
              if programme else "[mixed]anull[out]")
    fc_parts.append(
        "".join(mix_labels)
        + f"amix=inputs={n}:duration=first:normalize=0[mixed];"
        + finish
    )
    filter_complex = ";".join(fc_parts)

    cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs,
           "-filter_complex", filter_complex, "-map", "[out]",
           "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le", str(out_wav)]
    _run(cmd, "ffmpeg automate+mix")
    return out_wav


def _sfx_free_speech(
    speech: list[tuple[float, float]], sfx: list[dict], limit: float,
) -> list[tuple[float, float]]:
    """`speech` windows with every SFX one-shot's span cut out of them.

    The delivered bed is read back off the mixed wav, which also carries the
    SFX, so any span an SFX occupies would charge that transient to the bed.
    Spans are subtracted rather than whole windows dropped, because
    `_speech_windows` merges contiguous narration into a few long windows and
    one anchored whack would otherwise erase the entire measurement.
    """
    blocked: list[tuple[float, float]] = []
    for s in sfx:
        start = max(0.0, s["at_sec"])
        blocked.append((start, start + _ffprobe_duration(s["path"])))
    kept: list[tuple[float, float]] = []
    for start, end in speech:
        pieces = [(max(0.0, start), min(end, limit))]
        for b0, b1 in blocked:
            trimmed: list[tuple[float, float]] = []
            for a0, a1 in pieces:
                if b1 <= a0 or b0 >= a1:
                    trimmed.append((a0, a1))
                    continue
                if b0 > a0:
                    trimmed.append((a0, b0))
                if b1 < a1:
                    trimmed.append((b1, a1))
            pieces = trimmed
        kept.extend(piece for piece in pieces if piece[1] - piece[0] > 0.01)
    return kept


def _delivered_bed(video: Path, mixed: Path, out_wav: Path) -> Path:
    """`mixed` as `_mux_onto_video` actually delivers it, narration silenced.

    Built from that function's own amix graph rather than by modelling it.
    amix negotiates its output layout from the FIRST input — the source
    video's audio — and that conversion is not level-preserving: a stereo bed
    whose channels differ folds into a mono VO up to 3 LU quieter than `mixed`
    measures on its own, and mono narration is ordinary here (ElevenLabs returns mono, and
    user-supplied footage frequently is). Muting narration inside the real
    graph keeps the bed side in the delivered domain for any source layout.
    """
    _run(["ffmpeg", "-y", "-loglevel", "error",
          "-i", str(video), "-i", str(mixed),
          "-filter_complex",
          "[0:a]volume=0[muted];"
          "[muted][1:a]amix=inputs=2:duration=first:normalize=0[a]",
          "-map", "[a]", "-ar", "44100", "-acodec", "pcm_s16le", str(out_wav)],
         "ffmpeg delivered-bed probe")
    return out_wav


def _narration_bed_margin(
    *, video: Path, mixed: Path, speech: list[tuple[float, float]],
    sfx: list[dict], video_dur: float,
) -> dict | None:
    """How far narration leads the DELIVERED bed during speech, in LU (#237).

    Both sides are integrated loudness over the SFX-free speech windows: the
    measure `_flat_bed_gain` levels the bed by, so the margin reports the gap
    the mix set rather than an unweighted RMS that reads low bass-heavy beds
    several dB hotter than they sound (#321).

    Measured on the two signals `_mux_onto_video` actually sums. Narration's
    contribution is exactly the source video's own audio — amix leaves the
    first input untouched. The bed's is `mixed` AFTER the mux's own channel
    negotiation, which is why it goes through `_delivered_bed` rather than
    being read off `mixed` directly.

    Reading `mixed` rather than `bed_prepared.wav` is the whole point. The bed
    is loudnormed to TARGET_LUFS by `_automate_and_mix` with narration ABSENT
    from that stage, so the gain loudnorm applies is what sets the delivered
    bed level, and it is large: a prepared bed 12 dB quieter than another ends
    up at the same delivered level. Any margin derived from the prepared bed
    therefore tracks a quantity the pipeline discards.

    Returns None when there is no narration to compare against, when SFX cover
    every speech window, when the measurement itself cannot be taken, or when
    either side measures as digital silence — this is advisory, so it never
    costs the caller its render, and an absent number is honest where a
    fabricated one is not.
    """
    if not speech or not _has_audio_stream(video):
        return None
    windows = _sfx_free_speech(speech, sfx, video_dur)
    if not windows:
        return None
    narration_db = _windowed_lufs(video, windows, video_dur)
    with tempfile.TemporaryDirectory() as probe_dir:
        bed_db = _windowed_lufs(
            _delivered_bed(video, mixed, Path(probe_dir) / "delivered_bed.wav"),
            windows, video_dur)
    # None = the probe could not be taken; -inf = one side is digital silence,
    # and a dB margin against silence is not a number (nor JSON-safe). Both
    # mean "no verdict" rather than a verdict the reader could act on.
    if (narration_db is None or bed_db is None
            or not math.isfinite(narration_db) or not math.isfinite(bed_db)):
        return None
    margin_db = round(narration_db - bed_db, 2)
    speech_sec = sum(max(0.0, min(e, video_dur) - max(0.0, s)) for s, e in speech)
    return {
        "narration_lufs": round(narration_db, 2),
        "bed_lufs_delivered": round(bed_db, 2),
        "margin_db": margin_db,
        "min_margin_db": MIN_NARRATION_BED_MARGIN_DB,
        "low": margin_db < MIN_NARRATION_BED_MARGIN_DB,
        "measured_sec": round(sum(e - s for s, e in windows), 3),
        "speech_sec": round(speech_sec, 3),
    }


def _mux_onto_video(video: Path, bed_wav: Path, out_video: Path, *,
                    job: Path | None = None, source_sha256: str | None = None,
                    master: dict | None = None) -> Path:
    """Mux the mixed bed UNDER the existing VO/avatar audio of the video.

    If the source video has an audio stream, the bed is mixed with it (VO stays on
    top); otherwise the bed becomes the only audio track. `master` (from
    `_bed_level.master_voice_and_bed`), when given, brings the finished mix to
    -14 LUFS / -1 dBTP: the voice takes one gain + a true-peak limiter, the bed
    one linear gain that follows it, so the bed keeps its gap (#321).

    A mix onto a finished render of ``job`` (score-last) is itself a final
    deliverable: it is published with its render-complete record in the same
    step. Any other mix (score-first, onto final_raw) is only published.
    """
    out_video.parent.mkdir(parents=True, exist_ok=True)
    # Mux into a same-directory staging file and publish it in one atomic
    # replace: the mix path never holds a partial video.
    staging = staging_path(out_video)
    if _has_audio_stream(video):
        # VO is already at full level; the bed wav is already levelled under it.
        if master is not None:
            fc = _bed_level.voice_bed_graph([], ["[0:a]"], "[1:a]", master["voice_gain_db"],
                                            master["bed_gain_db"], tail="[a]")
        else:
            fc = "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]"
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-i", str(video), "-i", str(bed_wav),
               "-filter_complex", fc, "-map", "0:v", "-map", "[a]",
               "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
               "-shortest", str(staging)]
    else:
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-i", str(video), "-i", str(bed_wav),
               "-map", "0:v", "-map", "1:a",
               "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
               "-shortest", str(staging)]
    try:
        _run(cmd, "ffmpeg mux")
        _require_material_output(staging, "mixed video")
        if job is not None and made_from_final(job, video, source_sha256):
            from _serious_findings import render_facts

            # The mix keeps its source render's picture, captions and overlays.
            facts = render_facts(job)
            if facts.get("output_sha256") != source_sha256:
                facts = {}
            publish_deliverable(job, staging, out_video, tool="score_bed", facts=facts)
        else:
            publish(staging, out_video)
    finally:
        staging.unlink(missing_ok=True)
    return out_video


def _snapshot_pre_mix_source(video: Path, audio_dir: Path) -> tuple[Path, str]:
    """Preserve and bind the exact video bytes entering the music mix."""
    digest = hashlib.sha256()
    with video.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    input_sha256 = digest.hexdigest()
    input_snapshot = audio_dir / f"pre_mix_{input_sha256}.mp4"
    if input_snapshot.is_symlink() or (
        input_snapshot.exists() and not input_snapshot.is_file()
    ):
        raise RuntimeError("pre-mix source snapshot must be a real file")
    if not input_snapshot.exists():
        audio_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=f".{input_snapshot.name}.", suffix=".tmp",
            dir=audio_dir, delete=False,
        ) as opened:
            temporary = Path(opened.name)
        try:
            shutil.copyfile(video, temporary)
            os.replace(temporary, input_snapshot)
        finally:
            temporary.unlink(missing_ok=True)
    copied_digest = hashlib.sha256()
    with input_snapshot.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            copied_digest.update(block)
    if copied_digest.hexdigest() != input_sha256:
        raise RuntimeError("pre-mix source snapshot digest mismatch")
    input_snapshot.chmod(0o444)
    return input_snapshot, input_sha256


def _run_post_pipeline(
    *, raw_bed: Path, video: Path, transcript: dict, sfx: list[dict],
    best_section_sec: float, out_wav: Path, job: Path | None,
    source: str, source_meta: dict, mix: str = MIX_FLAT,
    bed_under_voice_db: float = FLAT_BED_UNDER_VOICE_DB,
) -> dict:
    """Shared post pipeline. Returns a result dict (paths + meta).

    The bed is always laid flat (#321); `mix` is only the value the caller
    asked for, recorded in the meta (a retired "duck"/"loudnorm" included)."""
    video_dur = _ffprobe_duration(video)
    audio_dir = out_wav.parent

    # The authoring pipeline may rewrite names such as ``final_raw.mp4`` after
    # this step (for example while rebuilding a repaired timeline).  QA must
    # compare the reviewed final with the exact bytes that entered this mix,
    # not whatever happens to occupy that mutable path later.  Preserve a
    # content-addressed, read-only copy before any provider or ffmpeg work.
    input_snapshot, input_sha256 = _snapshot_pre_mix_source(video, audio_dir)

    prepared = audio_dir / "bed_prepared.wav"
    _prepare_bed_to_length(raw_bed, prepared,
                           video_dur=video_dur, best_section_sec=best_section_sec)

    speech = _speech_windows(transcript)
    level = _flat_bed_gain(video, prepared, under_voice_db=bed_under_voice_db)
    # No narration to sit under: the bed is the programme, normalised to -14 LUFS.
    mix_applied = MIX_FLAT if level else MIX_PROGRAMME
    _automate_and_mix(bed=prepared, sfx=sfx, out_wav=out_wav,
                      bed_gain_db=level["gain_db"] if level else None)

    # Narration-to-bed margin (#237) — advisory. Read off `out_wav`, the bed as
    # `_mux_onto_video` will sum it, not off `prepared`: the gain
    # `_automate_and_mix` applies is what sets the delivered bed level.
    # Advisory: it reports on the mix, it does not gate it. A probe that cannot
    # be taken drops the number rather than losing the caller a finished mix.
    try:
        narration_bed_margin = _narration_bed_margin(
            video=video, mixed=out_wav, speech=speech, sfx=sfx, video_dur=video_dur)
    except Exception as exc:
        print(f"  narration/bed margin: unavailable ({type(exc).__name__})")
        narration_bed_margin = None

    # The finished voice+bed mix goes to the programme target (-14 LUFS, ≤ -1
    # dBTP) with ONE linear gain, measured on the sum the mux delivers (#321).
    # A bed with no voice under it is the programme and was normalised above.
    final_mix = None
    if level is not None:
        final_mix = _bed_level.master_voice_and_bed(
            ["-i", str(video), "-i", str(out_wav)], [], ["[0:a]"], "[1:a]")
        if final_mix is None:
            print("  ! the voice+bed mix could not be measured; it is left at its own level",
                  file=sys.stderr)

    out_video = out_wav.with_suffix(".mp4")
    _mux_onto_video(video, out_wav, out_video, job=job, source_sha256=input_sha256,
                    master=final_mix)

    _require_material_output(out_wav, "mixed WAV")
    _require_material_output(out_video, "mixed video")

    meta = {
        "source": source,
        "mode": source_meta.get("mode"),
        # Persist a canonical path so a later QA process can recover the exact
        # pre-mix baseline even when score_bed was invoked from another CWD.
        "video": str(video.resolve()),
        "input_snapshot": str(input_snapshot.resolve()),
        "input_sha256": input_sha256,
        "video_duration_sec": round(video_dur, 3),
        "mix": mix,
        "mix_applied": mix_applied,
        "bed_under_voice_db": bed_under_voice_db if level else None,
        "bed_level": level,
        "final_mix": final_mix,
        "target_lufs": TARGET_LUFS if mix_applied == MIX_PROGRAMME else None,
        "hp_filter_hz": HP_FILTER_HZ,
        "best_section_sec": best_section_sec,
        "speech_windows": len(speech),
        "narration_bed_margin": narration_bed_margin,
        "sfx_placed": [{"file": s["path"].name, "at_sec": round(s["at_sec"], 3),
                        "gain_db": s["gain_db"]} for s in sfx],
        "output_wav": str(out_wav),
        "output_video": str(out_video),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        **source_meta,
    }
    (audio_dir / "bed_meta.json").write_text(json.dumps(meta, indent=2))

    if job is not None:
        log_event(
            job, tool="score_bed.py", event="bed_built",
            extra={"usage_role": source_meta.get("mode"),
                   "source": source,
                   "input_snapshot": str(input_snapshot.resolve()),
                   "input_sha256": input_sha256,
                   "output_wav": str(out_wav),
                   "output_video": str(out_video),
                   "sfx_count": len(sfx),
                   "mix": mix,
                   "mix_applied": mix_applied,
                   "bed_gain_db": level["gain_db"] if level else None,
                   "target_lufs": meta["target_lufs"],
                   "narration_bed_margin": narration_bed_margin},
        )

    print(f"\n✓ final_mix.wav: {out_wav}")
    print(f"✓ final_mix.mp4: {out_video}")
    if level is None:
        print(f"  source={source}  no narration to sit under: the bed is the programme, "
              f"normalised to {TARGET_LUFS} LUFS, no ducking")
    else:
        cap = " (peak-capped)" if level["peak_capped"] else ""
        print(f"  source={source}  flat bed {level['gain_db']:+.1f} dB{cap} → "
              f"{bed_under_voice_db:g} dB under the voice "
              f"({level['narration_lufs']:g} LUFS), no ducking")
        if final_mix:
            print(f"  final mix: {final_mix['measured_lufs']:.1f} LUFS → "
                  f"{final_mix['final_lufs']:.1f} LUFS (voice {final_mix['voice_gain_db']:+.1f} dB, "
                  f"true-peak limited; bed {final_mix['bed_gain_db']:+.1f} dB)")
    print(f"  SFX placed: {len(sfx)}")
    if narration_bed_margin is not None:
        flag = "  ⚠ LOW MARGIN" if narration_bed_margin["low"] else ""
        print(f"  narration/bed margin: {narration_bed_margin['margin_db']} dB"
              f" (min {MIN_NARRATION_BED_MARGIN_DB} dB){flag}")
    return meta


# ─────────────────────────────────────────────────────────────────────────────
# MODE: generate — Replicate instrumental generation (opt-in, default OFF).
# ─────────────────────────────────────────────────────────────────────────────

def _download_gateway_music(res: dict, out_path: Path) -> dict:
    items = res.get("assets") or []
    if (not isinstance(items, list) or not items or not isinstance(items[0], dict)
            or not isinstance(items[0].get("url"), str) or not items[0]["url"]):
        raise GatewayAcceptedError(f"Accepted music job {res.get('job_id')} returned no audio asset")
    # Validate before replacing a previously usable bed, including when a
    # successful HTTP response actually contains an HTML/error payload.
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".music-", dir=out_path.parent) as temp:
            candidate = Path(temp) / out_path.name
            gateway.download(items[0]["url"], candidate)
            if not _has_audio_stream(candidate) or not _ffprobe_duration(candidate) > 0:
                raise RuntimeError("the downloaded file is not usable audio")
            gateway.note_output(items[0], out_path, pending_bytes=candidate.read_bytes())
            candidate.replace(out_path)
    except Exception as exc:
        raise GatewayAcceptedError(
            f"Accepted music job {res.get('job_id')} could not be downloaded: {exc}. "
            "Use --mode recover --gateway-job-id with this ID; do not generate again.") from exc
    gateway.note_output(items[0], out_path)
    return {
        "transport": "gateway",
        "gateway_route": "music:compose",
        "gateway_job_id": res.get("job_id"),
        # The job API names the semantic route, not the underlying model.
        "provider_model": "gateway-resolved",
    }


def _generate_raw_bed(*, prompt: str, duration_sec: float, out_path: Path,
                      job: Path | None) -> tuple[Path, dict]:
    """Generate an INSTRUMENTAL bed.

    DUAL MODE: when VIDEOCLAW_API_KEY is set the call routes through the gateway
    `music` tool — Lyria since chunk 31 (JC 2026-07-18): clip model for beds one
    clip or shorter, full-song model via quality=long for longer targets; the
    post pipeline's seamless loop covers any remainder. Without the gateway it
    falls back to ElevenLabs' /v1/music directly with the raw ELEVENLABS_API_KEY.
    Instrumental intent is spelled out in the prompt on both paths. The gateway
    request deliberately omits Eleven Music's ``force_instrumental`` field:
    Lyria 3 has no corresponding negative-prompt input.
    """
    instrumental_prompt = (
        f"{_check_music_prompt(prompt)}. Instrumental only, no lyrics, no vocals, no singing."
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Eleven Music accepts 3s–600s; clamp the requested length into range.
    length_ms = int(round(
        max(MUSIC_MIN_DURATION_SEC, min(MUSIC_MAX_DURATION_SEC, duration_sec)) * 1000))

    t0 = time.perf_counter()

    if gateway.enabled():
        res = gateway.run(
            "music", mode="compose", prompt=instrumental_prompt,
            params={"music_length_ms": length_ms,
                    "output_format": "mp3_44100_128"},
            # one clip (30s) covers most beds via the seamless loop; a longer
            # target routes to the full-song model for real variation
            **({"quality": "long"} if duration_sec > 30 else {}),
            timeout_s=600,
            job=job, _delivery=[out_path],
            _replaces_existing=True,   # the bed is published via note_output (#273)
        )
        provenance = _download_gateway_music(res, out_path)
    else:
        if not ELEVENLABS_API_KEY:
            raise SystemExit("ERROR: neither VIDEOCLAW_API_KEY nor ELEVENLABS_API_KEY "
                             "set in .env (needed for --mode generate)")
        r = requests.post(
            ELEVEN_MUSIC_URL,
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            params={"output_format": "mp3_44100_128"},
            json={"prompt": instrumental_prompt,
                  "music_length_ms": length_ms,
                  "model_id": ELEVEN_MUSIC_MODEL,
                  "force_instrumental": True},
            timeout=600,
        )
        if r.status_code != 200:
            raise RuntimeError(
                f"Eleven Music failed ({r.status_code}): {r.text[:300]}")
        out_path.write_bytes(r.content)
        provenance = {
            "transport": "direct",
            "gateway_route": None,
            "gateway_job_id": None,
            "provider_model": f"elevenlabs/{ELEVEN_MUSIC_MODEL}",
        }

    dur = time.perf_counter() - t0
    via = ("music:compose via gateway" if gateway.enabled()
           else f"ElevenLabs Eleven Music ({ELEVEN_MUSIC_MODEL})")
    print(f"[score_bed] generated bed in {dur:.1f}s via {via}")

    if job is not None:
        log_event(job, tool="score_bed.py", event="bed_generated",
                  duration_seconds=dur, prompt=instrumental_prompt,
                  extra={"usage_role": "generate",
                         **provenance,
                         "duration_sec": duration_sec,
                         "music_length_ms": length_ms,
                         "output_path": str(out_path)})
    return out_path, provenance


# ─────────────────────────────────────────────────────────────────────────────
# Input resolution.
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_input_video(job: Path, explicit: str | None) -> Path:
    """Resolve the picture the bed will be muxed onto — and prove it IS a picture.

    The mix maps `0:v`, so an audio-only file (an .mp3, or a .mp4-named audio
    take) fails in ffmpeg AFTER the paid generation call. Probe here instead,
    before any spend.
    """
    if explicit:
        p = resolve_job_input_path(explicit, job)
        if not p.exists():
            raise SystemExit(f"--input not found: {p}")
    else:
        p = job / "final_raw.mp4"
        if not p.exists():
            raise SystemExit(
                f"No final_raw.mp4 in {job}. Run densify.py first, or pass --input PATH."
            )
    if not _has_video_stream(p):
        raise SystemExit(
            f"{p} has no video stream; the music mix needs a picture to mux onto. "
            "For a standalone bed with no video, use --mode generate --raw-only "
            "--duration-sec N."
        )
    return p


def _load_transcript(job: Path) -> dict:
    p = job / "transcript.json"
    if not p.exists():
        print(f"  ! transcript.json missing in {job} — SFX anchors cannot resolve "
              f"and the narration/bed margin is skipped.", file=sys.stderr)
        return {}
    try:
        value = json.loads(p.read_text())
    except Exception as e:
        print(f"  ! transcript.json unreadable ({e}); proceeding without speech keying",
              file=sys.stderr)
        return {}
    if not isinstance(value, dict):
        print("  ! transcript.json must contain an object; proceeding without speech keying",
              file=sys.stderr)
        return {}
    return value


def _resolve_output(job: Path, supplied: str | None, default: str) -> Path:
    """Resolve every score_bed output against the immutable job boundary.

    Agents normally run installed tools from the engine directory. A relative
    ``--output audio/x.wav`` must therefore mean ``<job>/audio/x.wav`` rather
    than mutating the installed engine.
    """
    try:
        return resolve_job_output_path(supplied or default, job)
    except ValueError as e:
        raise SystemExit(str(e)) from e


def _require_material_output(path: Path, label: str) -> None:
    """Refuse to print or log success for a missing/empty artifact."""
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"{label} was not written: {path}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _job_evidence_path(job: Path, supplied: str) -> Path:
    root = job.resolve()
    candidate = Path(supplied)
    if not candidate.is_absolute():
        candidate = root / candidate
    if ".." in candidate.parts:
        raise SystemExit("--rights-evidence must stay inside the job directory")
    try:
        relative = candidate.relative_to(root)
    except ValueError as e:
        raise SystemExit("--rights-evidence must stay inside the job directory") from e
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise SystemExit("--rights-evidence may not use symlinks")
    resolved = candidate.resolve(strict=False)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise SystemExit(f"--rights-evidence not found in job: {supplied}")
    return resolved


def _load_rights_evidence(job: Path, music: Path, supplied: str | None) -> dict:
    """Validate a human-supplied, asset-bound ownership/license assertion."""
    if not supplied:
        raise SystemExit(
            "--mode bed requires --rights-evidence <job-relative json>. "
            "A local file is not evidence that the track is owned or licensed."
        )
    path = _job_evidence_path(job, supplied)
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"--rights-evidence is unreadable or invalid JSON: {e}") from e
    if not isinstance(evidence, dict) or evidence.get("schema") != "videoclaw.music-rights/v1":
        raise SystemExit("--rights-evidence schema must be videoclaw.music-rights/v1")
    for field in ("evidence_id", "basis"):
        if not isinstance(evidence.get(field), str) or not evidence[field].strip():
            raise SystemExit(f"--rights-evidence requires non-empty {field}")
    if evidence["basis"] not in {"owned", "licensed"}:
        raise SystemExit("--rights-evidence basis must be 'owned' or 'licensed'")
    surfaces = evidence.get("publish_surfaces")
    if not isinstance(surfaces, list) or not surfaces or any(
        not isinstance(surface, str) or not surface.strip() for surface in surfaces
    ):
        raise SystemExit("--rights-evidence requires non-empty publish_surfaces")
    music_hash = _sha256(music)
    if evidence.get("asset_sha256") != music_hash:
        raise SystemExit(
            "--rights-evidence asset_sha256 does not match --music; "
            "record evidence for this exact track"
        )
    return {
        "schema": evidence["schema"],
        "evidence_id": evidence["evidence_id"],
        "basis": evidence["basis"],
        "publish_surfaces": surfaces,
        "asset_sha256": music_hash,
        "evidence_path": str(path.relative_to(job.resolve())),
        "evidence_sha256": _sha256(path),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Mode handlers.
# ─────────────────────────────────────────────────────────────────────────────

def _mode_bed(args, job: Path) -> dict:
    if not args.music:
        raise SystemExit(
            "--mode bed requires --music <path-to-licensed-track>.\n"
            "If you have no track and have NOT opted into AI music, surface the "
            "named-SFX-list prompt and wait for the user to drop a track — do not "
            "silently switch to --mode generate."
        )
    music = Path(args.music)
    if not music.is_absolute():
        # Allow paths relative to the job dir (e.g. sfx/track.wav).
        cand = job / args.music
        music = cand if cand.exists() else music
    if not music.exists():
        raise SystemExit(f"--music track not found: {music}")
    rights = _load_rights_evidence(job, music, args.rights_evidence)

    video = _resolve_input_video(job, args.input)
    transcript = _load_transcript(job)
    sfx = _resolve_sfx_placements(
        sfx_manifest_path=Path(args.sfx_manifest) if args.sfx_manifest else None,
        sfx_dir=job / "sfx", transcript=transcript, job=job,
    )
    out_wav = _resolve_output(job, args.output, "audio/final_mix.wav")

    return _run_post_pipeline(
        raw_bed=music, video=video, transcript=transcript, sfx=sfx,
        best_section_sec=args.best_section_sec,
        mix=args.mix, bed_under_voice_db=args.bed_under_voice_db,
        out_wav=out_wav, job=job, source="user_supplied_track",
        source_meta={"mode": "bed", "music_track": str(music),
                     "rights_evidence": rights},
    )


def _prepare_music_exact(raw: Path, out_wav: Path, *, duration_sec: float) -> Path:
    """Trim/loop a generated track to EXACTLY duration_sec and normalize it as a
    STANDALONE master (--raw-only). Deliberately NOT `_prepare_bed_to_length`:

      - no 60 Hz high-pass — that is a bed-ism to keep a track out of a voice's
        way; on a standalone ambient master it thins the sub-bass swells that
        carry the whole build;
      - no `_best_section` RMS windowing — it picks the FLATTEST window, which is
        exactly wrong when the point of the piece is that it builds;
      - no bed level under a voice and no video mux, because there is no voice and
        no video.

    Normalizes to the same platform target as the bed path (TARGET_LUFS/TP).
    """
    out_wav.parent.mkdir(parents=True, exist_ok=True)

    # Decode to PCM before any looping. `-stream_loop` on a compressed source
    # restarts at a frame boundary and drops one frame (26ms on mp3) at every
    # seam, which put the looped branch 25ms under target.
    pcm = out_wav.with_name(out_wav.stem + "_decoded.wav")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
          "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le", str(pcm)],
         "ffmpeg decode to pcm")

    # Normalize and length-fit in SEPARATE passes. Chaining them let loudnorm's
    # timestamp handling defeat the pad: loudnorm drops its trailing partial
    # buffer (a 56.74s generation emerged at 55.13s) and neither bare `apad` nor
    # `apad=whole_dur=` backfilled it inside the same chain.
    norm = out_wav.with_name(out_wav.stem + "_norm.wav")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(pcm),
          "-af", f"loudnorm=I={TARGET_LUFS}:LRA={LOUDNORM_LRA}:tp={LOUDNORM_TP}",
          "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le", str(norm)],
         "ffmpeg loudnorm")

    norm_dur = _ffprobe_duration(norm)
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if norm_dur + 0.005 < duration_sec:
        # Short of target. Loop only if it is MUSICALLY short; a sub-second
        # shortfall is a codec/filter tail and wants silence, not a loop seam.
        if duration_sec - norm_dur > 1.0:
            cmd += ["-stream_loop", "-1"]
    cmd += ["-i", str(norm), "-af",
            f"apad=whole_dur={duration_sec:.4f},"
            f"atrim=0:{duration_sec:.4f},asetpts=N/SR/TB",
            "-ac", "2", "-ar", "44100", "-acodec", "pcm_s16le", str(out_wav)]
    _run(cmd, "ffmpeg music length-fit")

    pcm.unlink(missing_ok=True)
    norm.unlink(missing_ok=True)

    got = _ffprobe_duration(out_wav)
    if abs(got - duration_sec) > 0.05:
        print(f"  ! length {got:.3f}s is >50ms off the {duration_sec:.3f}s target",
              file=sys.stderr)
    return out_wav


def _mode_generate_raw_only(args, job: Path) -> dict:
    """`--raw-only`: a STANDALONE instrumental, no video, no VO.

    The bed post-pipeline assumes a voice to sit under and a picture to mux
    onto. When the music IS the deliverable, none of that applies.

    `--mode recover --raw-only` retrieves an ALREADY ACCEPTED generation and
    runs the same exact-duration preparation over it. It submits nothing: an
    accepted standalone job that failed during polling or download is otherwise
    stranded, and the only remaining route to the paid result is to pay again.
    """
    recovering = args.mode == "recover"
    if recovering:
        if not args.gateway_job_id:
            raise SystemExit("--mode recover requires --gateway-job-id from the accepted request")
        if not gateway.enabled():
            raise SystemExit("Recovering an accepted job requires its gateway connection")
        if args.prompt:
            raise SystemExit("--mode recover retrieves the original music; omit --prompt")
    elif not (args.prompt or "").strip():
        raise SystemExit('--raw-only requires --prompt "mood/tempo/instrumentation".')
    if args.duration_sec is None:
        raise SystemExit("--raw-only requires --duration-sec (there is no video "
                         "to derive the length from).")

    target = float(args.duration_sec)
    if not math.isfinite(target) or not (
        MUSIC_MIN_DURATION_SEC <= target <= MUSIC_MAX_DURATION_SEC
    ):
        raise SystemExit(
            f"--duration-sec must be between {MUSIC_MIN_DURATION_SEC:g} and "
            f"{MUSIC_MAX_DURATION_SEC:g} seconds; got {args.duration_sec}. "
            "The generator silently clamps out-of-range lengths, so a standalone "
            "deliverable would not be the length you asked for.")

    out_wav = _resolve_output(job, args.output, "audio/music.wav")
    if out_wav.suffix.lower() != ".wav":
        raise SystemExit(f"--output must name a .wav file for --raw-only: {out_wav}")
    raw = out_wav.with_name(out_wav.stem + "_raw.mp3")

    if recovering:
        res = gateway.retrieve(args.gateway_job_id, tool="music", mode="compose")
        provenance = _download_gateway_music(res, raw)
        log_event(job, tool="score_bed.py", event="bed_recovered", extra={
            "usage_role": "recover", "raw_only": True, **provenance,
            "estimate_usd": res.get("cost_usd"), "output_path": str(raw)})
    else:
        _, provenance = _generate_raw_bed(
            prompt=args.prompt, duration_sec=target, out_path=raw, job=job
        )
    _prepare_music_exact(raw, out_wav, duration_sec=target)

    out_mp3 = out_wav.with_suffix(".mp3")
    _wav_to_mp3_music(out_wav, out_mp3)
    _require_material_output(out_wav, "generated music WAV")
    _require_material_output(out_mp3, "generated music MP3")

    meta = {
        "source": "ai_generated",
        "mode": args.mode,
        "raw_only": True,
        **({"prompt": args.prompt} if not recovering else {}),
        **provenance,
        "target_duration_sec": target,
        "actual_duration_sec": round(_ffprobe_duration(out_wav), 4),
        "target_lufs": TARGET_LUFS,
        "true_peak_dbtp": LOUDNORM_TP,
        "high_pass_applied": False,
        "best_section_windowing_applied": False,
        "license_status": "ai_generated_opt_in",
        "raw_generation": str(raw),
        "output_wav": str(out_wav),
        "output_mp3": str(out_mp3),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (out_wav.parent / f"{out_wav.stem}_meta.json").write_text(
        json.dumps(meta, indent=2))

    log_event(job, tool="score_bed.py", event="music_built",
              extra={"usage_role": args.mode, "raw_only": True,
                     **provenance,
                     "output_wav": str(out_wav), "output_mp3": str(out_mp3),
                     "target_lufs": TARGET_LUFS})

    print(f"\n✓ music: {out_wav}")
    print(f"✓ mp3:   {out_mp3}")
    print(f"  route={provenance.get('gateway_route') or 'direct'} "
          f"model={provenance['provider_model']}  {meta['actual_duration_sec']}s "
          f"@ {TARGET_LUFS} LUFS")
    print(f"▶ WATCH → file://{out_mp3.resolve()}")
    return meta


def _wav_to_mp3_music(wav: Path, mp3: Path) -> Path:
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
          "-codec:a", "libmp3lame", "-b:a", "320k", str(mp3)],
         "ffmpeg wav→mp3")
    return mp3


def _mode_generate(args, job: Path) -> dict:
    recovering = args.mode == "recover"
    if recovering:
        if not args.gateway_job_id:
            raise SystemExit("--mode recover requires --gateway-job-id from the accepted request")
        if not gateway.enabled():
            raise SystemExit("Recovering an accepted job requires its gateway connection")
        if args.prompt:
            raise SystemExit("--mode recover retrieves the original music; omit --prompt")
    elif not args.prompt:
        raise SystemExit('--mode generate requires --prompt "mood/tempo/instrumentation".')

    video = _resolve_input_video(job, args.input)
    transcript = _load_transcript(job)
    video_dur = _ffprobe_duration(video)
    target_len = args.duration_sec if args.duration_sec else video_dur

    raw_bed = job / "audio" / "generated_bed.mp3"
    if recovering:
        res = gateway.retrieve(args.gateway_job_id, tool="music", mode="compose")
        provenance = _download_gateway_music(res, raw_bed)
        log_event(job, tool="score_bed.py", event="bed_recovered", extra={
            "usage_role": "recover", **provenance,
            "estimate_usd": res.get("cost_usd"), "output_path": str(raw_bed)})
    else:
        _, provenance = _generate_raw_bed(
            prompt=args.prompt, duration_sec=target_len, out_path=raw_bed, job=job)

    sfx = _resolve_sfx_placements(
        sfx_manifest_path=Path(args.sfx_manifest) if args.sfx_manifest else None,
        sfx_dir=job / "sfx", transcript=transcript, job=job,
    )
    out_wav = _resolve_output(job, args.output, "audio/final_mix.wav")

    return _run_post_pipeline(
        raw_bed=raw_bed, video=video, transcript=transcript, sfx=sfx,
        best_section_sec=args.best_section_sec,
        mix=args.mix, bed_under_voice_db=args.bed_under_voice_db,
        out_wav=out_wav, job=job, source="ai_generated",
        source_meta={"mode": args.mode,
                     **({"prompt": args.prompt} if not recovering else {}),
                     **provenance,
                     "license_status": "ai_generated_opt_in"},
    )


def _mode_split(args, job: Path) -> dict:
    """Stem-separate an audio/video via the gateway `stem_split` endpoint (MVSEP MDX23).
    Writes bass/drums/other/vocals + an instrumental (no-vocals) convenience mix.
    The canonical, discoverable entry point for stem separation. For 'remove reference
    VO but keep a sung hook', use tools/scrub_reference_vo.py (built on this)."""
    from pull_video import _separate_stems  # gateway stem_split seam (shared)

    src = Path(args.input or args.music or "")
    if not src.exists():
        raise SystemExit("--mode split requires --input <audio|video> (or --music).")

    stems_dir = _resolve_output(job, args.output, "stems")
    # normalize to wav (strips video if a movie was passed)
    audio = job / "audio" / f"{src.stem}_forsplit.wav"
    audio.parent.mkdir(parents=True, exist_ok=True)
    _run(["ffmpeg", "-y", "-i", str(src), "-vn", "-acodec", "pcm_s16le",
          "-ar", "44100", "-ac", "2", str(audio)], "extract audio")

    print(f"[score_bed:split] stem_split (MVSEP) on {src.name} …")
    stems = _separate_stems(audio, stems_dir, job=job)   # {bass,drums,other,vocals}

    instrumental = stems_dir / "instrumental.wav"
    _run(["ffmpeg", "-y", "-i", str(stems["bass"]), "-i", str(stems["drums"]),
          "-i", str(stems["other"]),
          "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:normalize=0[o]",
          "-map", "[o]", str(instrumental)], "instrumental mix")

    log_event(job, tool="score_bed.py", event="stems_split",
              extra={"usage_role": "split", "input": str(src),
                     "stems": {k: str(v) for k, v in stems.items()},
                     "instrumental": str(instrumental)})
    print("[score_bed:split] stems →")
    for n in STEM_NAMES:
        print(f"    {n:9} {stems[n]}")
    print(f"    instrumental (bass+drums+other) {instrumental}")
    print("[note] speech AND singing land in `vocals`. To keep a sung hook but drop speech, "
          "gate the vocals stem to the singing sections (scrub_reference_vo.py --keep-singing).")
    return {"stems": {k: str(v) for k, v in stems.items()}, "instrumental": str(instrumental)}


# ─────────────────────────────────────────────────────────────────────────────
# CLI.
# ─────────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, 
        description="score_bed — canonical audio-bed primitive. --mode picks the source.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(p)
    p.add_argument("--mode", choices=["bed", "generate", "recover", "split"], default="bed",
                   help="bed = user-supplied licensed track (DEFAULT). "
                        "generate = opt-in gateway Lyria music or direct ElevenLabs fallback. "
                        "recover = fetch an already accepted music job and mix it locally. "
                        "Logged as usage_role.")
    p.add_argument("--gateway-job-id", help="recover: ID of the original accepted music job")
    p.add_argument("--music",
                   help="Path to the licensed/user-owned track. REQUIRED for --mode bed. "
                        "Absolute, or relative to the job dir.")
    p.add_argument("--rights-evidence",
                   help="bed: job-relative videoclaw.music-rights/v1 JSON bound to the "
                        "exact --music sha256 and its approved publish surfaces. REQUIRED; "
                        "a local file alone is not a rights claim.")
    p.add_argument("--input",
                   help="Source video (VO+avatar). Default <job_dir>/final_raw.mp4.")
    p.add_argument("--sfx-manifest",
                   help="Optional JSON of USER-SUPPLIED SFX with anchor words/times. "
                        "Files must already exist under <job_dir>/sfx/. "
                        "NEVER auto-generated. No manifest = no SFX.")
    p.add_argument("--mix", choices=MIX_CHOICES, default=MIX_FLAT,
                   help="The bed is always one constant level --bed-under-voice-db below "
                        "the narration (~-26 LUFS under a -14 LUFS voice, ~20%% volume): "
                        "no ducking, no normalisation (#276, #321). duck and loudnorm are "
                        "retired: accepted for old prompts, and laid flat.")
    p.add_argument("--bed-under-voice-db", type=float, default=FLAT_BED_UNDER_VOICE_DB,
                   help="How far the bed's integrated loudness sits below the narration's "
                        f"(default {FLAT_BED_UNDER_VOICE_DB:g}; 15 for a sung track or "
                        "quieter music).")
    p.add_argument("--duck-db", type=float, default=None,
                   help="Retired (#321): accepted and ignored; the bed never ducks. Set "
                        "how loud it sits with --bed-under-voice-db.")
    p.add_argument("--best-section-sec", type=float, default=DEFAULT_BEST_SECTION_SEC,
                   help=f"RMS window length to pick the best section of a long track "
                        f"(default {DEFAULT_BEST_SECTION_SEC}).")
    p.add_argument("--output",
                   help="Output mixed WAV path. Default <job_dir>/audio/final_mix.wav "
                        "(a sibling .mp4 is also written).")
    # --mode generate only:
    p.add_argument("--prompt",
                   help="generate: Describe genre, tempo, instruments and mood without "
                        "artist, song or brand names.")
    p.add_argument("--duration-sec", type=float, default=None,
                   help="generate: target generation length. Default = video duration. "
                        f"With --raw-only, REQUIRED and must be "
                        f"{MUSIC_MIN_DURATION_SEC:g}–{MUSIC_MAX_DURATION_SEC:g}s.")
    p.add_argument("--raw-only", action="store_true",
                   help="generate/recover: produce a STANDALONE instrumental (WAV + "
                        "MP3) and stop. No video, no VO, no ducking, no SFX, no mux — "
                        "so no --input is needed. Requires --duration-sec, plus "
                        "--prompt on generate or --gateway-job-id on recover.")
    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if getattr(args, "gateway_job_id", None) and args.mode != "recover":
        parser.error("--gateway-job-id requires --mode recover; no new generation was submitted")
    if getattr(args, "raw_only", False) and args.mode not in ("generate", "recover"):
        parser.error("--raw-only requires --mode generate or --mode recover")
    under_voice = getattr(args, "bed_under_voice_db", FLAT_BED_UNDER_VOICE_DB)
    if not (math.isfinite(under_voice) and under_voice >= 0):
        parser.error("--bed-under-voice-db is how far BELOW the voice the bed sits; "
                     "pass a positive number such as 12")
    retired = [flag for flag, used in (
        (f"--mix {getattr(args, 'mix', MIX_FLAT)}", getattr(args, "mix", MIX_FLAT) != MIX_FLAT),
        ("--duck-db", getattr(args, "duck_db", None) is not None),
    ) if used]
    if retired:
        print(f"  note: ducking is retired (#321); {' and '.join(retired)} ignored — the "
              f"bed is laid flat, {under_voice:g} dB under the voice.", file=sys.stderr)
    job = resolve_job_dir(args.job)

    raw_only = bool(getattr(args, "raw_only", False))
    start_event_id = log_event(
        job, tool="score_bed.py", event="start",
        extra={"usage_role": args.mode, "mode": args.mode,
               "raw_only": raw_only, "terminal_contract": 1},
    )

    try:
        if args.mode == "bed":
            result = _mode_bed(args, job)
        elif args.mode in ("generate", "recover") and getattr(args, "raw_only", False):
            result = _mode_generate_raw_only(args, job)
        elif args.mode in ("generate", "recover"):
            result = _mode_generate(args, job)
        elif args.mode == "split":
            result = _mode_split(args, job)
        else:  # pragma: no cover — argparse choices guard this
            raise SystemExit(f"unknown --mode {args.mode!r}")
    except BaseException as exc:
        # A start without a terminal event is ambiguous to downstream QA. Log
        # SystemExit and interrupts too: neither produced a usable bed.
        log_event(
            job, tool="score_bed.py", event="error",
            extra={"usage_role": args.mode, "mode": args.mode,
                   "start_event_id": start_event_id,
                   "error": type(exc).__name__, "error_message": str(exc)},
        )
        raise
    else:
        terminal = {
            "usage_role": args.mode,
            "mode": args.mode,
            # A standalone asset is not a mix onto this job's video; downstream
            # audits must not infer a music-bed requirement from it.
            "raw_only": raw_only,
            "start_event_id": start_event_id,
        }
        if isinstance(result, dict):
            for key in (
                "source", "video", "music_track", "output_wav", "output_video",
                "instrumental", "input_snapshot", "input_sha256",
            ):
                if result.get(key) is not None:
                    terminal[key] = result[key]
        log_event(job, tool="score_bed.py", event="done", extra=terminal)


if __name__ == "__main__":
    main()
