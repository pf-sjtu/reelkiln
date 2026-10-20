"""
decode_audio.py — the canonical MECHANICAL audio-measurement primitive. ONE tool,
`--mode` picks the stage of [`workflows/music-recreation.md`](../workflows/music-recreation.md).

  uv run python tools/decode_audio.py --job <id> --mode grid    --input <ref>  [--spec spec.json]
      # --input takes a local path, a file:// URL, or a reference URL (audio-only rip, cached)
  uv run python tools/decode_audio.py --job <id> --mode compare --spec spec.json --candidates a.mp3 b.mp3
  uv run python tools/decode_audio.py --job <id> --mode correct --spec spec.json --input cand.mp3 --output c.wav
  uv run python tools/decode_audio.py --job <id> --mode arrange --spec spec.json --input c.wav --output a.wav
  uv run python tools/decode_audio.py --job <id> --mode finish  --spec spec.json --input c.wav   --output bed.wav
  uv run python tools/decode_audio.py --job <id> --mode verify  --spec spec.json --input bed.wav
  uv run python tools/decode_audio.py --selftest        # synthetic checks, no job, no I/O, no spend

Six modes, one artifact threading them: `spec.json`. `grid` writes it; `compare`,
`correct`, `finish` and `verify` all READ it, and `verify` asserts the finished file
against the SAME object `grid` wrote. That closure is the point — both worked examples'
real failures ("key came out a semitone off") surfaced as observations rather than failed
assertions because the spec lived only in the model's head.

  --mode grid     Decode a reference into spec.json: tempo (phase-optimized grid scan +
                  an inter-onset-interval adjudication), downbeat phase, loop period,
                  sub-band impacts with their lift above baseline, kick pattern, HF
                  density per bar, energy arc, band balance, and TWO key fingerprints
                  (per-bar bass-root histogram + a grid-free 1200-bin cent profile).
  --mode compare  Score N candidates against spec.json and apply the gates. Writes
                  scorecard.json ranked; prints keep/correct/re-roll per candidate.
  --mode correct  Bounded, deterministic key/tempo/phase correction. REFUSES the
                  shift+retime combination that destroyed a finished bed once (see
                  "Common failure modes" #1).
  --mode arrange  (runs AFTER finish — its timestamps are on the output timeline) Stamp the spec's STRUCTURE onto a flat bed — breakdown duck, per-drop
                  lift that decays back to unity, tail fade. The half of the job a text
                  prompt provably cannot do.
  --mode finish   Bar-aligned cut to the spec's duration + downbeat, edge fades,
                  highpass, two-pass loudnorm to -14 LUFS / -1.0 dBTP. Optional
                  --match-tail reproduces the reference's ring-out arc.
  --mode verify   Re-measure the OUTPUT and assert every field against spec.json.
                  Writes verify.json with ALL_PASS. Verifying intent is not verifying
                  output — a verified-correct transposition once shipped at the wrong
                  tempo because one ffmpeg chain silently changed both.

SPEND. Every mode is pure measurement + ffmpeg, and there is no vendor API surface in
this file — but `resolve_ref` is a CONDITIONAL acquisition seam: a remote `http(s)`
reference passed to `--input` / `--candidates` / `--vocal-stem(s)` is ripped through
`pull_video`'s own `_gateway_audio_rip` (POST /v1/media/pull, audio_only), the same
metered rail `pull_video --mode pull --audio-only` uses. A local path, a `file://` URL,
a cached rip without `--regen`, and `--selftest` spend nothing. The tool is therefore
declared in `prepare_production.ANALYSIS_SPEND_TOOLS` and priced in `cost.PRICES` at the
acquisition rail (NOT `pull_video`'s `bed` rail, which adds a stem separation this tool
never runs). The paid halves of the recipe (the listening pass, the generation) stay in
`gemini_video.py` and `score_bed.py` respectively.

DEPENDENCIES — numpy + scipy only, deliberately. librosa (ISC) / beat_this (MIT) /
signalsmith-stretch (MIT) are all permissive and would be faster and more accurate on
sparse material, but none is installed and each is an install decision the operator
hasn't made. Key detection in particular has NO good permissive library (libKeyFinder is
GPL-3.0, essentia AGPL-3.0), so the hand-rolled cent profile below is the correct answer
for a shipped product, not a workaround. Everything here is vectorized (strided STFT,
phase-scan as one gather per BPM) — the pure-Python loops in the original runs took
30-60s per scan; this is ~1-2s.

Common failure modes
--------------------
1. **Pitch shift and retime in the same pass destroys the audio.** Resampling down 2.7
   semitones plus a 17% phase-vocoder stretch to claw the tempo back produced "slowed-tape
   character on the drums, underwater smearing on the pad, blunted transients", and the
   finished beds were binned. `--mode correct` therefore refuses to do both unless
   `--allow-retime` is passed, and prints the implied retime percentage first.
   THE COUPLING IS UNAVOIDABLE: `asetrate` changes pitch AND tempo by the same ratio, so
   preserving tempo REQUIRES a phase vocoder. The way out is BPM precompensation:
   ask the generator for `target_bpm / 2**(shift/12)` up front, then a PURE resample lands
   both the key and the tempo with no stretch at all. See `--mode compare`'s printout.
2. **`aresample` must run BEFORE `asetrate`.** `asetrate` reinterprets the *current*
   stream rate, so a 44.1k source fed `asetrate=48000*r` shifts by `48000*r/44100` —
   silently wrong. That under-applied a 3-semitone drop to 1.2 semitones and turned
   89 BPM into 97. The chain here always resamples first.
3. **Never name a key from 12-TET pitch-class bins on dense material.** Reference tracks
   sit tens of cents off concert pitch, so binning smears each note into its neighbours;
   one take read "same key" as its reference AFTER a verified downshift. Use
   `interval_semitones` (grid-free, both sides measured identically so bias cancels) for
   comparisons and the bass-root histogram for absolute naming. Absolute key NAMES from
   this tool are advisory; intervals are load-bearing.
4. **A tempo that doesn't divide the clip is wrong.** `grid` hard-fails the scan when
   whole bars don't fit the clip length, because that check is what caught a confident
   "172 BPM" on a 134 BPM track (and "120" on an 89.2 one).
5. **Drop lift must be measured at 1s resolution, not 0.1s.** At 100ms a drop can look
   present when it never clears its own baseline; that resolution error wrongly refuted a
   valid "anti-climactic" critique. `spec.json` carries both series.
6. **Band balance is advisory, never a gate.** A different synth palette *should* have a
   different spectral signature. Chasing parity past ~4-6 points per band is a mistake
   (one run overshot sub from 29% to 9.8% doing exactly that).

Reads:   any audio or video file via ffmpeg (--input / --candidates)
Writes:  <job_dir>/audio/spec.json        (--mode grid)
         <job_dir>/audio/scorecard.json   (--mode compare)
         <job_dir>/audio/<out>.wav        (--mode correct / finish)
         <job_dir>/audio/verify.json      (--mode verify)

`--mode` is REQUIRED and logged as usage_role.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import numpy as np
from scipy.signal import butter, sosfilt

sys.path.insert(0, str(Path(__file__).resolve().parent))

from job import add_job_arg, resolve_job_dir  # noqa: E402
from log import log_event  # noqa: E402

TOOL = "decode_audio"

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

SR_GRID = 22050          # rhythm work: cheap, and nothing above 11 kHz matters for onsets
SR_TONAL = 44100         # tonal work: needs the full band for HF density + bass resolution
BANDS = ((20, 80, "sub"), (80, 250, "bass"), (250, 800, "lomid"),
         (800, 2500, "mid"), (2500, 6000, "hi"), (6000, 16000, "air"))

# Gate thresholds (workflows/music-recreation.md Stage 5). Named so a caller can see
# exactly what it is being judged against rather than reading them out of prose.
GATE_TEMPO_MEAN_DEV = 0.12      # mean |deviation| from the 16th grid, in 16ths
GATE_TEMPO_RATIO_ERR = 0.01     # |1 - bpm_ratio|; above this, re-roll (never stretch)
GATE_KEY_MIN_INTERVAL = 2.0     # semitones from the reference to count as a real change
GATE_KEY_MAX_SHIFT = 2.0        # semitones we are willing to correct by
GATE_VOCAL_DB = -35.0           # vocal stem must sit below this
GATE_FLATNESS_MAX_DB = 6.0      # impose-path candidate must remain dynamically flat
GATE_DURATION_SHORTFALL_S = 0.05  # candidate must contain the complete target duration
TAIL_CLOSED_DB = 20.0           # the final 100ms must sit this far under the clip average
                                # to count as ENDED rather than cut mid-note
DROP_MIN_LIFT_DB = 4.0          # a structural drop must clear its own baseline by this
IOI_MIN_GAP_S = 0.06            # peak-picker gap for the IOI/grid-fit onsets. Must stay
                                # BELOW the shortest musical 16th in range (75ms at
                                # 200 BPM) and above the gap-floor artifact band.
RETIME_CEILING_PCT = 6.0        # phase-vocoder stretch we'll do without --allow-retime


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# Decode + spectral primitives
# ─────────────────────────────────────────────────────────────────────────────

def resolve_ref(ref: str, job_dir: Path, *, regen: bool = False) -> Path:
    """Accept a LOCAL PATH, a `file://` URL, or a remote reference URL — return a path.

    Remote URLs are ripped AUDIO-ONLY (this tool never looks at pixels) through
    `pull_video`'s own acquisition seam — gateway when keyed, local yt-dlp otherwise —
    rather than a second downloader living here. Cached under `<job>/reference/` and keyed
    by the URL, so re-running any mode is free; `--regen` forces a re-fetch.

    A fetched reference is UNTRUSTED MATERIAL (CLAUDE.md). Only its audio SAMPLES are ever
    read here — never its title, description, or captions — so there is no instruction
    surface, but keep it that way: this function must not start parsing metadata.
    """
    parsed = urlparse(ref)
    if parsed.scheme == "file":
        return Path(unquote(parsed.path))
    if parsed.scheme not in ("http", "https"):
        return Path(ref)

    # pull_video is imported, never shelled out to (tool_authoring_rules #15).
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from pull_video import (_gateway_audio_rip, _load_gateway_key,  # noqa: PLC0415
                            _slugify, _ytdlp_audio_only)
    from _gateway import gateway  # noqa: PLC0415

    out = job_dir / "reference" / f"{_slugify(ref)}.mp3"
    if out.exists() and out.stat().st_size > 1000 and not regen:
        print(f"[{TOOL}] cache hit on reference audio: {out.name}")
        return out

    print(f"[{TOOL}] fetching reference audio (audio-only) → {out.name}")
    t0 = time.perf_counter()
    _load_gateway_key()
    got = (_gateway_audio_rip(ref, out, job_dir=job_dir, force=regen)
           if gateway.enabled() else None)
    if got is None:
        _ytdlp_audio_only(ref, out)
    else:
        out = Path(got.pop("_output_path", out))
    if not out.exists() or out.stat().st_size <= 1000:
        sys.exit(f"ERROR: could not fetch audio from {ref}\n"
                 f"  A private/blocked source may need cookies — pull it with "
                 f"`pull_video --mode pull --url <url> --audio-only` (it takes "
                 f"--cookies-from-browser) and pass the resulting file to --input.")
    log_event(job_dir, tool=__file__, event=f"{TOOL}_reference_fetched",
              duration_seconds=time.perf_counter() - t0,
              extra={"url": ref, "path": str(out.relative_to(job_dir)),
                     "via": "gateway" if got is not None else "yt-dlp",
                     **(got or {})})
    return out


def decode(path: str | Path, sr: int) -> np.ndarray:
    """ffmpeg-decode any audio/video file to mono float32 at `sr`. No temp files."""
    path = Path(path)
    if not path.exists():
        sys.exit(f"ERROR: {path} not found.")
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
         "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0 or not proc.stdout:
        sys.exit(f"ERROR: ffmpeg could not decode audio from {path}\n"
                 f"{proc.stderr.decode('utf-8', 'replace')[:400]}")
    x = np.frombuffer(proc.stdout, dtype=np.float32).astype(np.float64)
    if not np.any(x):
        sys.exit(f"ERROR: {path} decoded to digital silence — wrong stream?")
    return x


def stft_mag(x: np.ndarray, n: int = 2048, hop: int = 256) -> tuple[np.ndarray, float]:
    """Magnitude STFT as (frames, bins) plus frames-per-second. Strided, not looped."""
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    return np.abs(np.fft.rfft(frames * np.hanning(n), axis=1)), 1.0


def onset_envelope(x: np.ndarray, sr: int, n: int = 1024,
                   hop: int = 128) -> tuple[np.ndarray, float, float]:
    """Spectral-flux onset envelope — (env, fps, t0) where env[i] is at t0 + i/fps.

    The window length IS the timing accuracy: a 2048-sample window at 22.05k put a known
    0.250s downbeat at 0.162s (88ms early), because the flux peaks as the transient ENTERS
    the window, not when it reaches the centre. 1024/128 keeps that error near one hop.
    `t0` attributes each diff to the later frame's centre, which is where the rise lands.
    """
    S, _ = stft_mag(x, n, hop)
    flux = np.diff(np.log1p(S * 100.0), axis=0)
    env = np.maximum(flux, 0.0).sum(axis=1)
    return env, sr / hop, (n / 2 + hop) / sr


def band_envelope(x: np.ndarray, sr: int, lo: float, hi: float,
                  win_s: float = 0.01) -> tuple[np.ndarray, float]:
    """RMS envelope of one band. `hi >= sr/2` degrades to a highpass."""
    nyq = sr / 2.0
    if hi >= nyq * 0.99:
        sos = butter(4, lo, btype="high", fs=sr, output="sos")
    else:
        sos = butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    y = sosfilt(sos, x)
    w = max(1, int(win_s * sr))
    n = (len(y) // w) * w
    if n == 0:
        return np.zeros(1), 1.0 / win_s
    return np.sqrt((y[:n].reshape(-1, w) ** 2).mean(axis=1)), sr / w


def rms_db_series(x: np.ndarray, sr: int, win_s: float) -> np.ndarray:
    """Per-window RMS in dBFS. Used at BOTH 0.1s and 1s — see failure mode #5."""
    w = max(1, int(win_s * sr))
    n = (len(x) // w) * w
    if n == 0:
        return np.array([-120.0])
    r = np.sqrt((x[:n].reshape(-1, w) ** 2).mean(axis=1))
    return 20.0 * np.log10(np.maximum(r, 1e-12))


def refine_phase(x: np.ndarray, sr: int, bpm: float, step_s: float = 0.002) -> float:
    """Beat phase to ~2ms, by SCORING the beat grid on a fine-window flux envelope.

    Scored, not peak-picked. Peak-picking a broadband envelope on real music fires on
    every sustained-note fluctuation — it found 97 "onsets" in a 10.6s clip whose grid fit
    was indistinguishable from random, and put the downbeat 0.41s out. Scoring asks the
    only question that matters (where does energy repeatedly land?) and is immune to
    individual false peaks.
    """
    env, fps, t0 = onset_envelope(x, sr, 512, 64)
    period = 60.0 / bpm
    nb = int((len(x) / sr - 0.02) / period)
    if nb < 2 or len(env) < 4:
        return 0.0
    ks = np.arange(nb)
    phases = np.arange(0.0, period, step_s)
    idx = np.rint((phases[:, None] + ks[None, :] * period - t0) * fps).astype(int)
    np.clip(idx, 0, len(env) - 1, out=idx)
    return float(phases[int(np.argmax(env[idx].mean(axis=1)))])


def refine_downbeat(x: np.ndarray, sr: int, bpm: float, beat_phase: float,
                    drops: list[float] | None = None) -> tuple[float, str]:
    """Which of the 4 beats is the DOWNBEAT — returns (phase, how_it_was_decided).

    `beat_phase` is modulo one beat, so it cannot distinguish beat 1 from beat 3. Only the
    OFFSET is decided here; the phase itself always comes from the onset-grid fit, which is
    the measurement that actually reproduces (60% of beats carry an onset within 30ms at
    the chosen phase, against 13% at a hand-derived alternative).
    Structural drops, when present, choose the offset better than energy does — they are
    accurate to about half a second, which is well inside a bar.
    """
    beat = 60.0 / bpm
    env, fps = band_envelope(x, sr, 45, 130, win_s=0.005)
    d = np.maximum(np.diff(env), 0.0)
    t0 = 0.005
    dur = len(x) / sr
    # Take the MAX over a ±10ms neighbourhood of each bar line, not a single sample. A
    # 5ms-window envelope quantizes the rise to its own grid, so a single-index probe can
    # sit two windows before the transient and miss it entirely — which picked beat 3 over
    # beat 1 on a click track whose beat 1 is 2.8× louder.
    bar = 4 * beat
    if drops and len(drops) >= 2:
        best_j, best_cost = 0, None
        for j in range(4):
            ph = (beat_phase + j * beat) % bar
            cost = sum(min(abs((d - ph) % bar), bar - abs((d - ph) % bar))
                       for d in drops)
            if best_cost is None or cost < best_cost:
                best_j, best_cost = j, cost
        return round((beat_phase + best_j * beat) % bar, 4), "drop-aligned bar offset"

    span = max(1, int(round(0.010 * fps)))
    offsets = np.arange(-span, span + 1)
    best, best_s = beat_phase, -1.0
    for j in range(4):
        ph = beat_phase + j * beat
        nb = int((dur - ph - 0.02) / (4 * beat))
        if nb < 1:
            continue
        base = np.rint((ph + np.arange(nb) * 4 * beat - t0) * fps).astype(int)
        idx = np.clip(base[:, None] + offsets[None, :], 0, len(d) - 1)
        s = float(d[idx].max(axis=1).mean())
        if s > best_s:
            best, best_s = ph, s
    return round(best % bar, 4), "kick-energy vote"


def pick_peaks(env: np.ndarray, fps: float, min_gap_s: float = 0.05,
               pct: float = 92.0, t0: float = 0.0) -> np.ndarray:
    """Onset times (seconds): local maxima above a percentile floor, then GREEDY selection
    by descending amplitude with a minimum gap.

    Two corrections over the obvious version, both found on real material:
    * greedy-by-amplitude, not first-past-the-post. Keeping the FIRST peak in each gap
      window keeps a small precursor and discards the real hit.
    * a percentile floor, not median + k·spread. On a dense limited mix the latter
      admitted ~9 onsets/second on a track that has ~2, and the resulting grid fit was
      indistinguishable from random (mean dev 0.24 vs 0.25).
    `t0` is the envelope's time origin — pass it, or every timestamp inherits the
    frame-offset error described in `onset_envelope`.
    """
    if len(env) < 3:
        return np.array([])
    thr = np.percentile(env, pct)
    cand = np.where((env[1:-1] >= env[:-2]) & (env[1:-1] > env[2:])
                    & (env[1:-1] > thr))[0] + 1
    if not len(cand):
        return np.array([])
    gap = min_gap_s * fps
    keep: list[int] = []
    for i in cand[np.argsort(-env[cand])]:
        if all(abs(i - j) >= gap for j in keep):
            keep.append(int(i))
    return np.sort(np.asarray(keep, dtype=float)) / fps + t0


# ─────────────────────────────────────────────────────────────────────────────
# Tempo / grid
# ─────────────────────────────────────────────────────────────────────────────

def grid_scan(env: np.ndarray, fps: float, dur: float, lo: float = 70.0,
              hi: float = 200.0, coarse: float = 0.1,
              nphase: int = 96, t0: float = 0.0) -> dict:
    """Score candidate BPMs by how much onset energy lands on their beat grid.

    Deliberately NOT autocorrelation: autocorrelation rewards any periodicity, including
    the half/double-time ambiguity that produced a confident wrong answer twice. Scoring
    a phase-optimized grid directly gives a number that is comparable across candidates
    (a 2.25 vs 0.94 separation settled "89.2 vs 120"), and hands back the phase for free.
    """
    f = env / (env.mean() + 1e-12)

    def score_bpm(bpm: float, nph: int) -> tuple[float, float]:
        period = 60.0 / bpm
        nb = int((dur - 0.02) / period)
        if nb < 4:
            return 0.0, 0.0
        ks = np.arange(nb)
        phases = np.linspace(0.0, period, nph, endpoint=False)
        idx = np.rint((phases[:, None] + ks[None, :] * period - t0) * fps).astype(int)
        np.clip(idx, 0, len(f) - 1, out=idx)
        s = f[idx].mean(axis=1)
        j = int(np.argmax(s))
        return float(s[j]), float(phases[j])

    grid = np.arange(lo, hi + 1e-9, coarse)
    scores = np.empty(len(grid))
    phases = np.empty(len(grid))
    for i, bpm in enumerate(grid):
        scores[i], phases[i] = score_bpm(float(bpm), nphase)
    best = int(np.argmax(scores))
    bpm0 = float(grid[best])

    # Refine: ±0.4 BPM at 0.01, with a finer phase sweep.
    fine = np.arange(max(lo, bpm0 - 0.4), min(hi, bpm0 + 0.4) + 1e-9, 0.01)
    fs_, fp_ = np.empty(len(fine)), np.empty(len(fine))
    for i, bpm in enumerate(fine):
        fs_[i], fp_[i] = score_bpm(float(bpm), 256)
    b = int(np.argmax(fs_))

    bpm = float(fine[b])
    period = 60.0 / bpm
    nbeats = int((dur - 0.02) / period)
    return {
        "bpm": round(bpm, 2),
        "phase_s": round(float(fp_[b]), 4),
        "grid_score": round(float(fs_[b]), 3),
        "beats_fitted": nbeats,
        # Runner-up at a genuinely different tempo — the separation IS the evidence.
        "runner_up_bpm": round(float(grid[int(np.argmax(np.where(
            np.abs(grid - bpm0) > 3.0, scores, -1)))]), 2),
        "runner_up_score": round(float(np.max(np.where(
            np.abs(grid - bpm0) > 3.0, scores, -1))), 3),
    }


def ioi_adjudicate(onsets: np.ndarray, bpm: float,
                   min_gap_s: float = 0.06) -> dict:
    """Inter-onset-interval histogram vs the candidate's 16th.

    This is the check that killed a "172 BPM, high confidence" claim: the IOI mode was
    110ms, which is the 134 BPM sixteenth (111.9ms), not the 172 one (87.2ms).
    """
    if len(onsets) < 4:
        return {"ioi_mode_ms": None, "sixteenth_ms": round(60000.0 / bpm / 4, 1),
                "agrees": None, "note": "too few onsets to adjudicate"}
    # Intervals AT the peak-picker's gap floor are an artifact of that floor, not
    # music: a 50ms min-gap on dense material produced a 52.5ms "mode" every time.
    d = np.diff(onsets)
    d = d[(d > min_gap_s * 1.3) & (d < 1.5)]
    if not len(d):
        return {"ioi_mode_ms": None, "sixteenth_ms": round(60000.0 / bpm / 4, 1),
                "agrees": None, "note": "no intervals in range"}
    hist, edges = np.histogram(d, bins=np.arange(min_gap_s * 1.3, 1.5, 0.005))
    mode_s = float(edges[int(np.argmax(hist))] + 0.0025)
    sixteenth = 60.0 / bpm / 4.0
    # The mode must be an integer multiple of the 32nd — the finest subdivision real
    # material actually plays. Requiring a 16th multiple failed a correct 89.2 BPM read
    # on a clip with 32nd-note foley (mode 90.5ms vs a 168.2ms 16th); a 32nd test passes
    # it AND still rejects the classic impostor (110.5ms against 172 BPM gives 2.53).
    ratio = mode_s / (sixteenth / 2.0)
    agrees = bool(abs(ratio - round(ratio)) < 0.12 and round(ratio) >= 1)
    return {"ioi_mode_ms": round(mode_s * 1000, 1),
            "sixteenth_ms": round(sixteenth * 1000, 1),
            "mode_in_32nds": round(ratio, 3), "agrees": agrees}


def grid_fit(onsets: np.ndarray, bpm: float, phase: float) -> dict:
    """How well do detected transients sit on the 16th grid?

    `mean_dev` is the mean |deviation| expressed in 16ths, so 0.25 is what random
    material scores and ~0.05 is a locked grid. `on_grid_pct` uses a 0.15 window.
    """
    if not len(onsets):
        return {"on_grid_pct": 0.0, "mean_dev": 0.25, "n_onsets": 0}
    sixteenth = 60.0 / bpm / 4.0
    dev = np.abs(((onsets - phase) / sixteenth + 0.5) % 1.0 - 0.5)
    return {"on_grid_pct": round(100.0 * float((dev < 0.15).mean()), 1),
            "mean_dev": round(float(dev.mean()), 3), "n_onsets": int(len(onsets))}


# ─────────────────────────────────────────────────────────────────────────────
# Tonal: bass-root histogram (absolute) + cent profile (relative)
# ─────────────────────────────────────────────────────────────────────────────

def bass_root_histogram(x: np.ndarray, sr: int, bpm: float, phase: float,
                        nfft: int = 1 << 19) -> dict:
    """Per-bar bass root via a zero-padded FFT of a 35-300 Hz band.

    The robust absolute-key measurement. Chroma binning fails on this material
    (failure mode #3); a per-bar peak-frequency vote does not.
    """
    bar = 4.0 * 60.0 / bpm
    sos = butter(6, [35, 300], btype="band", fs=sr, output="sos")
    y = sosfilt(sos, x)
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    sel = (freqs >= 35) & (freqs <= 300)
    votes: dict[str, int] = {}
    roots = []
    t = phase
    while t + bar <= len(y) / sr:
        seg = y[int(t * sr):int((t + bar) * sr)]
        if len(seg) < 64:
            break
        mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=nfft))
        f0 = float(freqs[sel][int(np.argmax(mag[sel]))])
        pc = int(round(69 + 12 * np.log2(f0 / 440.0))) % 12
        name = PITCH_NAMES[pc]
        votes[name] = votes.get(name, 0) + 1
        roots.append({"t": round(t, 3), "hz": round(f0, 2), "pc": name})
        t += bar
    if not votes:
        return {"tonal_center": None, "histogram": {}, "per_bar": []}
    ordered = dict(sorted(votes.items(), key=lambda kv: -kv[1]))
    counts = list(ordered.values())
    win = counts[0]
    runner = counts[1] if len(counts) > 1 else 0
    total = sum(counts)
    # DECISIVE means this vote is trustworthy enough to gate on. Validated both ways: a
    # 19-bar reference voting F:8 F#:4 A:3 (42%, 2.0x the runner-up) is decisive and its
    # name matched an independent manual read; a 3-bar clip voting F#:2 F:1 is NOT, and
    # that same clip was independently judged "genuinely ambiguous" between two keys.
    decisive = bool(total >= 4 and win >= 1.5 * max(runner, 1) and win / total >= 0.30)
    return {"tonal_center": next(iter(ordered)), "histogram": ordered,
            "decisive": decisive, "vote_share": round(win / max(total, 1), 2),
            "bars_voted": total, "per_bar": roots}


def cent_profile(x: np.ndarray, sr: int, f_lo: float = 55.0,
                 octaves: int = 6, nbins: int = 1200) -> np.ndarray:
    """Grid-free cyclic pitch profile: one bin per CENT, folded modulo the octave.

    No note grid is assumed anywhere — which is the whole point. Reference material and
    generated takes both sit tens of cents off concert pitch, so any 12-bin chroma smears
    energy into neighbouring pitch classes and produces self-contradictory answers (a take
    reading "same key" after a verified downshift). Comparing two of these by circular
    cross-correlation measures the INTERVAL, with measurement bias cancelling because both
    sides go through the identical transform.

    TWO steps that are not optional, both found by this returning 0.00 semitones for a
    pair of tracks a bass-root vote put 5 semitones apart:

    * INTERPOLATE onto a uniform cent axis; do not histogram raw FFT bins into it. At
      4096/44.1k one bin spans ~4.6 cents at 4 kHz but ~300 cents at 55 Hz, so
      accumulation weights the top of the spectrum ~65x and the fold ends up describing
      bin density rather than pitch — every track then correlates best at rotation 0.
    * WHITEN across log-frequency before folding. Otherwise the spectral tilt (which every
      mix shares) dominates the profile and swamps the partials that carry the key.
    """
    S, _ = stft_mag(x, 4096, 1024)
    spec = S.mean(axis=0)
    freqs = np.fft.rfftfreq(4096, 1.0 / sr)
    cents = np.arange(octaves * nbins)
    target = f_lo * 2.0 ** (cents / nbins)
    target = target[target < min(freqs[-1], sr / 2 * 0.98)]
    mag = np.interp(target, freqs, spec)
    # Whiten: subtract a ±100-cent moving average, keep only what stands above it.
    k = np.ones(201) / 201.0
    mag = np.maximum(mag - np.convolve(mag, k, mode="same"), 0.0)
    usable = (len(mag) // nbins) * nbins
    if usable < nbins:
        return np.zeros(nbins)
    prof = mag[:usable].reshape(-1, nbins).sum(axis=0)
    # Circular smooth (±20 cents) so a slightly detuned partial still lands together.
    g = np.exp(-0.5 * (np.arange(-60, 61) / 20.0) ** 2)
    prof = np.real(np.fft.ifft(np.fft.fft(prof) * np.fft.fft(g / g.sum(), nbins)))
    prof -= prof.mean()
    n = np.linalg.norm(prof)
    return prof / n if n > 0 else prof


def cyclic_interval(prof_a: np.ndarray, prof_b: np.ndarray) -> dict:
    """Interval from A to B in semitones, by circular cross-correlation of cent profiles.

    Positive = B sits ABOVE A. Wrapped to (-6, +6] because an octave is not a key change.
    """
    cc = np.real(np.fft.ifft(np.fft.fft(prof_b) * np.conj(np.fft.fft(prof_a))))
    lag = int(np.argmax(cc))
    cents = lag if lag <= 600 else lag - 1200
    same = float(cc[0])
    return {"interval_semitones": round(cents / 100.0, 2),
            "corr": round(float(cc[lag]), 3),
            "same_key_corr": round(same, 3)}


# ─────────────────────────────────────────────────────────────────────────────
# Structure, density, balance
# ─────────────────────────────────────────────────────────────────────────────

def band_pcts(x: np.ndarray, sr: int) -> dict:
    """Percentage of total power in each of six bands. ADVISORY ONLY (failure mode #6)."""
    S, _ = stft_mag(x, 4096, 2048)
    power = (S ** 2).mean(axis=0)
    freqs = np.fft.rfftfreq(4096, 1.0 / sr)
    total = power.sum() + 1e-30
    out = {}
    for lo, hi, name in BANDS:
        m = (freqs >= lo) & (freqs < hi)
        out[name] = round(100.0 * float(power[m].sum() / total), 2)
    centroid = float((freqs * power).sum() / total)
    return {"bands_pct": out, "centroid_hz": round(centroid, 1)}


def hf_per_bar(x: np.ndarray, sr: int, bpm: float, dur: float) -> float:
    """7-15 kHz transients per bar — 'sparse negative space' vs 'a running hat'.

    A real, checkable palette property: the one confirmed defect across both runs was a
    running hat at 8.1-10.2 per bar against a reference's 2.8.
    """
    if sr / 2 <= 7000:
        return float("nan")
    env, fps = band_envelope(x, sr, 7000, min(15000, sr / 2 * 0.98), win_s=0.005)
    d = np.maximum(np.diff(env), 0)
    # Threshold RELATIVE TO THIS CLIP'S OWN loudest HF transient, not to a percentile of
    # frames: a percentile floor admits a fixed fraction of frames by construction, so it
    # reported ~13 hats/bar on a track whose top end is deliberate negative space.
    thr = 0.25 * float(np.percentile(d, 99.9))
    idx = np.where((d[1:-1] >= d[:-2]) & (d[1:-1] > d[2:]) & (d[1:-1] > thr))[0] + 1
    keep, gap = [], 0.03 * fps
    for i in idx[np.argsort(-d[idx])] if len(idx) else []:
        if all(abs(i - j) >= gap for j in keep):
            keep.append(int(i))
    onsets = np.asarray(keep, dtype=float)
    bars = max(1e-9, dur / (4.0 * 60.0 / bpm))
    return round(len(onsets) / bars, 1)


def sub_impacts(x: np.ndarray, sr: int) -> dict:
    """Structural drops: sub-band peaks, with lift measured at 1s resolution.

    The 1s window is load-bearing — at 0.1s a drop can look present when it never clears
    its own baseline, which is exactly how a valid "anti-climactic" critique got wrongly
    refuted once.
    """
    # TWO STAGES, because one alone gets it wrong. A 50ms RMS envelope peaks well AFTER
    # the transient (three verified impacts came back 0.45-0.82s late), and peak-picking
    # the derivative just finds the loudest ordinary kicks (spacing 6.3/8.3s against a
    # verified uniform 7.16s). So: LOCATE the structure on the 1-second series where
    # structure actually lives, then REFINE each event to the sub-band rise nearest it.
    coarse = rms_db_series(sosfilt(butter(4, 90, btype="low", fs=sr, output="sos"), x),
                           sr, 1.0)
    baseline = float(np.median(coarse))
    fine, fps = band_envelope(x, sr, 20, 90, win_s=0.02)
    rise = np.maximum(np.diff(fine), 0.0)
    t0_fine = 0.02

    lift = coarse - baseline
    cand = [i for i in range(1, len(coarse) - 1)
            if lift[i] >= DROP_MIN_LIFT_DB
            and coarse[i] >= coarse[i - 1] and coarse[i] >= coarse[i + 1]]
    keep: list[int] = []
    for i in sorted(cand, key=lambda j: -lift[j]):
        if all(abs(i - j) >= 3 for j in keep):        # >= 3s apart: structural, not a bar
            keep.append(i)

    drops = []
    for i in sorted(keep):
        lo = max(0, int((i - 1.0 - t0_fine) * fps))
        hi = min(len(rise), int((i + 1.0 - t0_fine) * fps))
        if hi <= lo:
            continue
        t = (lo + int(np.argmax(rise[lo:hi]))) / fps + t0_fine
        drops.append({"t": round(float(t), 3), "lift_db": round(float(lift[i]), 1)})
    return {"drops": drops, "sub_baseline_db": round(baseline, 1),
            "sub_db_per_1s": [round(v, 1) for v in coarse.tolist()],
            "sub_peak_db": round(float(np.max(coarse)), 1)}


def kick_pattern(x: np.ndarray, sr: int, bpm: float, phase: float) -> list[int]:
    """Which 16th slots of the bar carry kick energy (45-130 Hz), as a vote across bars."""
    env, fps = band_envelope(x, sr, 45, 130, win_s=0.005)
    onsets = pick_peaks(np.maximum(np.diff(env), 0), fps, min_gap_s=0.08, pct=95.0,
                        t0=0.005)
    if not len(onsets):
        return []
    sixteenth = 60.0 / bpm / 4.0
    slots = np.rint(((onsets - phase) / sixteenth) % 16).astype(int) % 16
    counts = np.bincount(slots, minlength=16)
    thr = max(1, counts.max() // 2)
    return [int(s) for s in np.where(counts >= thr)[0]]


def tail_arc(x: np.ndarray, sr: int, tail_s: float = 1.5) -> dict:
    """The ring-out signature: how the clip ENDS, and whether it ends at all.

    `fade_start_s` is the last moment the clip was still at working level (within 3 dB of
    its own average); everything after it is the natural decay. `ends_abruptly` is the one
    that matters downstream — a bed still at full level in its final 100ms has been CUT,
    not ended, and no amount of correct tempo makes that shippable.
    """
    per100 = rms_db_series(x, sr, 0.1)
    whole = float(np.mean(per100))
    n = max(1, int(tail_s / 0.1))
    above = np.where(per100 >= whole - 3.0)[0]
    fade_start = round(float(above[-1] + 1) * 0.1, 3) if len(above) else None
    dur = len(x) / sr
    if fade_start is not None and fade_start >= dur - 0.05:
        fade_start = None                     # never decays: there is no arc to mirror
    last = float(per100[-1])
    return {"tail_db_under_avg": round(float(np.mean(per100[-n:]) - whole), 1),
            "fade_start_s": fade_start,
            "natural_decay_s": None if fade_start is None else round(dur - fade_start, 3),
            "tail_last_100ms_db": round(last, 1),
            "tail_last_100ms_under_avg": round(last - whole, 1),
            "ends_abruptly": bool(last > whole - TAIL_CLOSED_DB),
            "rms_db_per_100ms": [round(v, 1) for v in per100.tolist()]}


def loop_period(x: np.ndarray, sr: int, bpm: float, max_bars: int = 16) -> dict:
    """Loop length by autocorrelating the bass envelope at bar-multiple lags."""
    env, fps = band_envelope(x, sr, 40, 250, win_s=0.02)
    env = env - env.mean()
    if len(env) < 8 or not np.any(env):
        return {"loop_bars": None, "loop_period_s": None, "corr": None}
    bar = 4.0 * 60.0 / bpm
    best = (None, -2.0)
    for bars in range(1, max_bars + 1):
        lag = int(round(bars * bar * fps))
        if lag >= len(env) - 4:
            break
        a, b = env[:-lag], env[lag:]
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        c = float(np.dot(a, b) / denom) if denom > 0 else 0.0
        if c > best[1]:
            best = (bars, c)
    if best[0] is None:
        return {"loop_bars": None, "loop_period_s": None, "corr": None}
    return {"loop_bars": best[0], "loop_period_s": round(best[0] * bar, 3),
            "corr": round(best[1], 3)}


# ─────────────────────────────────────────────────────────────────────────────
# MODE: grid — decode a reference into spec.json
# ─────────────────────────────────────────────────────────────────────────────

def measure(path: str | Path, *, bpm_lo: float = 70.0, bpm_hi: float = 200.0,
            full: bool = True) -> dict:
    """Every measurement, on one file. The shared core of grid / compare / verify."""
    xg = decode(path, SR_GRID)
    xt = decode(path, SR_TONAL)
    dur = len(xt) / SR_TONAL

    env, fps, t0 = onset_envelope(xg, SR_GRID)
    g = grid_scan(env, fps, dur, bpm_lo, bpm_hi, t0=t0)
    bpm = g["bpm"]
    # Tempo from the coarse flux (smooth, and tempo is phase-free); PHASE by scoring a
    # fine-window flux; the DOWNBEAT then chosen among the 4 beats by kick energy.
    beat_phase = refine_phase(xt, SR_TONAL, bpm)
    bar_s = 4.0 * 60.0 / bpm
    imp = sub_impacts(xt, SR_TONAL)
    phase, phase_src = refine_downbeat(xt, SR_TONAL, bpm, beat_phase,
                                       [d["t"] for d in imp["drops"]])
    f_env, f_fps, f_t0 = onset_envelope(xt, SR_TONAL, 512, 64)
    onsets = pick_peaks(f_env, f_fps, min_gap_s=IOI_MIN_GAP_S, pct=95.0, t0=f_t0)
    out: dict = {
        "path": str(path),
        "duration_s": round(dur, 4),
        "bpm": bpm,
        "downbeat_phase_s": phase,
        "sixteenth_s": round(60.0 / bpm / 4.0, 6),
        "bar_s": round(4.0 * 60.0 / bpm, 6),
        "grid": g,
        "ioi": ioi_adjudicate(onsets, bpm, IOI_MIN_GAP_S),
        "grid_fit": grid_fit(onsets, bpm, phase),
    }
    # Failure mode #4: whole bars must fit the clip, or the tempo is wrong.
    bars = dur / out["bar_s"]
    out["bars_in_clip"] = round(bars, 2)
    out["bars_fit"] = bool(abs(bars - round(bars)) < 0.35)

    if not full:
        return out

    out["downbeat_source"] = phase_src
    out["beat_phase_s"] = round(beat_phase, 4)
    out.update(band_pcts(xt, SR_TONAL))
    out["hf_per_bar"] = hf_per_bar(xt, SR_TONAL, bpm, dur)
    out["kick_slots"] = kick_pattern(xt, SR_TONAL, bpm, phase)
    out.update(loop_period(xt, SR_TONAL, bpm))
    # Snap each drop to the nearest bar line. A saturated sub pedal has no clean
    # transient to find (a direct probe of one reference put its "biggest sub rise" at
    # 18.475 / 25.770 / 32.565s for impacts the grid says are 7.16s apart), so a
    # sample-accurate claim here would be false precision. The bar line is both the
    # honest resolution AND where Stage 7 stamps the impact anyway.
    out["drops_s"] = [round(phase + round((d["t"] - phase) / out["bar_s"]) * out["bar_s"], 3)
                      for d in imp["drops"]]
    out["drops_measured_s"] = [d["t"] for d in imp["drops"]]
    out["drops_resolution"] = "snapped to the bar grid (raw sub-band estimate is +-0.5s)"
    out["drop_lift_db"] = [d["lift_db"] for d in imp["drops"]]
    # Structural impacts usually recur on the loop. Where a spacing is NOT a multiple of
    # the loop period, say so: on a saturated-sub reference one of three impacts landed a
    # bar late, and a silently uniform list would have hidden which timestamp to eyeball.
    lp = out.get("loop_period_s")
    out["drops_off_pattern"] = []
    if lp and len(out["drops_s"]) > 1:
        for a, b in zip(out["drops_s"], out["drops_s"][1:]):
            n = (b - a) / lp
            if abs(n - round(n)) > 0.2 or round(n) < 1:
                out["drops_off_pattern"].append(round(b, 3))
    out["sub_baseline_db"] = imp["sub_baseline_db"]
    out["sub_db_per_1s"] = imp["sub_db_per_1s"]
    bass = bass_root_histogram(xt, SR_TONAL, bpm, phase)
    out["tonal_center"] = bass["tonal_center"]
    out["bass_root_histogram"] = bass["histogram"]
    out["bass_root_decisive"] = bass["decisive"]
    out["bass_root_vote_share"] = bass["vote_share"]
    out["bars_voted"] = bass["bars_voted"]
    out["key_profile_cents"] = [round(v, 6) for v in cent_profile(xt, SR_TONAL).tolist()]
    out.update(tail_arc(xt, SR_TONAL))
    sub = sosfilt(butter(4, 90, btype="low", fs=SR_TONAL, output="sos"), xt)
    out["sub_rms_ratio"] = round(float(np.sqrt((sub ** 2).mean())
                                      / max(1e-12, np.sqrt((xt ** 2).mean()))), 3)
    return out


def mode_grid(args, job_dir: Path) -> dict:
    spec = measure(args.input, bpm_lo=args.bpm_lo, bpm_hi=args.bpm_hi)
    spec["target_tonal_center"] = args.target_root
    spec["band_targets_pct"] = spec["bands_pct"]

    print(f"[{TOOL}] {Path(args.input).name}")
    print(f"  tempo      {spec['bpm']} BPM   (grid score {spec['grid']['grid_score']} vs "
          f"{spec['grid']['runner_up_score']} for the best other tempo "
          f"{spec['grid']['runner_up_bpm']})")
    print(f"  downbeat   {spec['downbeat_phase_s']}s ({spec['downbeat_source']})   "
          f"bar {spec['bar_s']}s   "
          f"{spec['bars_in_clip']} bars in {spec['duration_s']}s "
          f"{'✅' if spec['bars_fit'] else '⚠️  WHOLE BARS DO NOT FIT — tempo suspect'}")
    io = spec["ioi"]
    print(f"  IOI check  mode {io['ioi_mode_ms']}ms vs 16th {io['sixteenth_ms']}ms "
          f"→ {'agrees' if io['agrees'] else 'DISAGREES — check half/double time'}")
    gf = spec["grid_fit"]
    print(f"  grid fit   {gf['on_grid_pct']}% on-grid, mean dev {gf['mean_dev']} "
          f"(0.25 = random) over {gf['n_onsets']} onsets")
    print(f"  loop       {spec.get('loop_bars')} bars = {spec.get('loop_period_s')}s "
          f"(corr {spec.get('corr')})")
    print(f"  tonal      {spec['tonal_center']}  {spec['bass_root_histogram']}")
    print(f"  drops      {spec['drops_s']}  lift {spec['drop_lift_db']} dB "
          f"over a {spec['sub_baseline_db']} dB baseline")
    if spec.get("drops_off_pattern"):
        print(f"             ⚠️  off the loop pattern, eyeball these: "
              f"{spec['drops_off_pattern']}  (raw estimates "
              f"{spec['drops_measured_s']}; resolution ±0.5s snapped to bars)")
    print(f"  HF/bar     {spec['hf_per_bar']}  ({'sparse' if (spec['hf_per_bar'] or 9) < 4 else 'running hat'})")
    print(f"  bands      {spec['bands_pct']}  centroid {spec['centroid_hz']} Hz")
    print(f"             (POWER-weighted, so low bands dominate any real mix — these are "
          f"for like-for-like comparison only, never a gate)")
    print(f"  tail       {spec['tail_db_under_avg']} dB under the clip average")

    out = _write_json(job_dir, args.spec or "spec.json", spec)
    print(f"\n[{TOOL}] ⚠️  Absolute key names are ADVISORY (see failure mode #3). "
          f"Comparisons use the cent profile, which is in the spec.")
    print(f"\nDone. Next: write the keep/change table, then "
          f"score_bed --mode generate (announce spend), then "
          f"decode_audio --mode compare --spec {out.name}")
    return spec


# ─────────────────────────────────────────────────────────────────────────────
# MODE: compare — score candidates against the spec, apply the gates
# ─────────────────────────────────────────────────────────────────────────────

def key_interval(spec: dict, m: dict) -> tuple[float, str, str]:
    """The signed key interval from reference to candidate, by whichever measurement is
    actually decisive on this material — see `bass_root_histogram` for the criterion.

    Shared so `compare` and `verify` cannot disagree. They did: verify read the raw
    cent-profile rotation and called a bed that compare had (correctly) measured +6
    semitones away "same key", which would have failed a bed that met the brief.
    """
    iv = cyclic_interval(np.asarray(spec["key_profile_cents"], dtype=float),
                         np.asarray(m["key_profile_cents"], dtype=float))
    a, b = spec.get("tonal_center"), m.get("tonal_center")
    if spec.get("bass_root_decisive") and m.get("bass_root_decisive") and a and b:
        d = (PITCH_NAMES.index(b) - PITCH_NAMES.index(a)) % 12
        return float(d if d <= 6 else d - 12), "bass-root vote", "high"
    return iv["interval_semitones"], "cent-profile rotation", "low"


def _semitone_gap(detected: str | None, target: str | None) -> int | None:
    if not detected or not target:
        return None
    distance = (PITCH_NAMES.index(target) - PITCH_NAMES.index(detected)) % 12
    return distance if distance <= 6 else distance - 12


def _key_verdict(
    detected: str | None, target: str | None, interval_from_reference: float
) -> tuple[str, int | None]:
    """Require both the requested target and a material change from reference."""
    shift = _semitone_gap(detected, target)
    if target is None or shift is None:
        return "REROLL", shift
    if shift == 0 and abs(interval_from_reference) >= GATE_KEY_MIN_INTERVAL:
        return "KEEP", shift
    if shift != 0 and abs(shift) <= GATE_KEY_MAX_SHIFT:
        return "CORRECT", shift
    return "REROLL", shift


def _precompensated_bpm(target_bpm: float, shift_semitones: float) -> float:
    """Tempo to request before a pure pitch+tempo resample by the same ratio."""
    return target_bpm / (2.0 ** (shift_semitones / 12.0))


def _candidate_verdict(
    *,
    tempo_pass: bool,
    duration_pass: bool,
    flatness_ok: bool,
    key_verdict: str,
    vocal_gate: str,
) -> str:
    if (
        not tempo_pass
        or not duration_pass
        or not flatness_ok
        or key_verdict == "REROLL"
        or vocal_gate != "PASS"
    ):
        return "REROLL"
    return "CORRECT" if key_verdict == "CORRECT" else "KEEP"


def score_candidate(path: str | Path, spec: dict, *,
                    vocal_stem: str | None = None) -> dict:
    m = measure(path, full=True)
    ref_prof = np.asarray(spec["key_profile_cents"], dtype=float)
    cand_prof = np.asarray(m["key_profile_cents"], dtype=float)
    iv = cyclic_interval(ref_prof, cand_prof)

    # WHICH measurement gates depends on the material, and the choice is evidence-based.
    # On a track with a decisive sustained bass root the root vote wins outright: it named
    # two real beds A# and B, matching two independent manual reads, while the cent-profile
    # interval put them 0.09 semitones apart when their roots differ by 1. On material with
    # no decisive root (a 3-bar loop, an ambiguous key) only the cent profile is available,
    # and it is then flagged low-confidence rather than silently trusted.
    interval_signed, key_source, key_conf = key_interval(spec, m)

    target = spec.get("target_tonal_center")
    ratio_err = abs(1.0 - m["bpm"] / spec["bpm"])
    tempo_pass = (m["grid_fit"]["mean_dev"] < GATE_TEMPO_MEAN_DEV
                  and ratio_err < GATE_TEMPO_RATIO_ERR)

    # A different key is not automatically the requested key. Require both a material
    # interval from the reference and the explicit target; otherwise a candidate can be
    # confidently wrong and still appear to KEEP.
    interval = abs(interval_signed)
    key_verdict, shift = _key_verdict(
        m["tonal_center"], target, interval_signed
    )

    vocal_db, vocal_gate = None, "UNCHECKED"
    if vocal_stem:
        v = decode(vocal_stem, SR_TONAL)
        vocal_db = round(float(20 * np.log10(max(1e-12, np.sqrt((v ** 2).mean())))), 1)
        vocal_gate = "PASS" if vocal_db < GATE_VOCAL_DB else "REJECT"

    band_l1 = round(sum(abs(m["bands_pct"][k] - spec["band_targets_pct"].get(k, 0.0))
                        for k in m["bands_pct"]), 1)
    duration_pass = m["duration_s"] >= (
        spec["duration_s"] - GATE_DURATION_SHORTFALL_S
    )
    flatness_db = round(
        float(max(m["sub_db_per_1s"]) - min(m["sub_db_per_1s"])), 1
    )
    flatness_ok = flatness_db <= GATE_FLATNESS_MAX_DB

    verdict = _candidate_verdict(
        tempo_pass=tempo_pass,
        duration_pass=duration_pass,
        flatness_ok=flatness_ok,
        key_verdict=key_verdict,
        vocal_gate=vocal_gate,
    )

    return {
        "id": Path(path).stem,
        "path": str(path),
        "duration_s": m["duration_s"],
        "duration_pass": duration_pass,
        "tempo": {"bpm": m["bpm"], "ratio_err": round(ratio_err, 5),
                  "on_grid_pct": m["grid_fit"]["on_grid_pct"],
                  "mean_dev": m["grid_fit"]["mean_dev"], "pass": tempo_pass},
        "key": {"detected": m["tonal_center"],
                "root_histogram": m["bass_root_histogram"],
                "interval_from_ref_semitones": round(interval_signed, 2),
                "measured_by": key_source, "confidence": key_conf,
                "cent_profile_interval": iv["interval_semitones"],
                "corr": iv["corr"], "same_key_corr": iv["same_key_corr"],
                "target": target, "shift_to_target": shift, "verdict": key_verdict},
        "bands_pct": m["bands_pct"], "band_l1_error": band_l1,
        "centroid_hz": m["centroid_hz"], "hf_per_bar": m["hf_per_bar"],
        "sub_rms_ratio": m["sub_rms_ratio"],
        "vocal_stem_db": vocal_db, "vocal_gate": vocal_gate,
        # On the impose path a FLAT candidate is what we want — Stage 7 supplies dynamics.
        "flatness_db": flatness_db, "flatness_ok": flatness_ok,
        "verdict": verdict,
    }


def mode_compare(args, job_dir: Path) -> dict:
    spec = _read_spec(job_dir, args.spec)
    if not args.candidates:
        sys.exit("ERROR: --mode compare needs --candidates <file> [<file> ...]")
    stems = args.vocal_stems or []
    cards = [score_candidate(c, spec,
                             vocal_stem=stems[i] if i < len(stems) else None)
             for i, c in enumerate(args.candidates)]
    # Rank: keepers first, then correctable, then by band distance as a tiebreak.
    order = {"KEEP": 0, "CORRECT": 1, "REROLL": 2}
    cards.sort(key=lambda c: (order[c["verdict"]], c["band_l1_error"]))
    for i, c in enumerate(cards):
        c["rank"] = i + 1

    print(f"[{TOOL}] {len(cards)} candidate(s) vs spec "
          f"({spec['bpm']} BPM, {spec['tonal_center']} → "
          f"{spec.get('target_tonal_center')})\n")
    for c in cards:
        t, k = c["tempo"], c["key"]
        print(f"  #{c['rank']} {c['id']:22s} {c['verdict']}")
        print(f"      tempo {t['bpm']:>7} BPM  on-grid {t['on_grid_pct']:>5}%  "
              f"dev {t['mean_dev']:.3f}  ratio_err {t['ratio_err']:.5f}  "
              f"{'✅' if t['pass'] else '❌ re-roll (never stretch)'}")
        print(f"      key   {str(k['detected']):>3}  {k['interval_from_ref_semitones']:+.2f} "
              f"semitones from ref  via {k['measured_by']} ({k['confidence']} confidence)"
              f"  → {k['verdict']}")
        if k["confidence"] == "low":
            print(f"            no decisive bass root on one side; cent-profile corr "
                  f"{k['corr']} vs {k['same_key_corr']} same-key — eyeball this one")
        print(f"      duration {c['duration_s']}s  "
              f"{'✅' if c['duration_pass'] else '❌ shorter than target'}")
        print(f"      vocals {str(c['vocal_stem_db']):>6} dB {c['vocal_gate']}   "
              f"band L1 {c['band_l1_error']} (advisory)   flatness "
              f"{c['flatness_db']} dB {'✅' if c['flatness_ok'] else '❌'}")
        if k["verdict"] == "CORRECT" and k["shift_to_target"]:
            s = k["shift_to_target"]
            pre = _precompensated_bpm(spec["bpm"], s)
            print(f"      ↳ correct with: --mode correct --shift-semitones {s}")
            print(f"        NOTE: a pure resample also retimes by {abs(1 - 2 ** (s / 12)) * 100:.1f}%. "
                  f"To avoid ANY stretch next round, ask the generator for "
                  f"{pre:.1f} BPM and shift {s:+d} — both land on spec.")
    keepers = [c for c in cards if c["verdict"] != "REROLL"]
    print(f"\n  {len(keepers)}/{len(cards)} usable."
          + ("" if keepers else "  All re-rolls — regenerate, do not repair."))
    if any(c["vocal_gate"] == "UNCHECKED" for c in cards):
        print(f"\n[{TOOL}] ❌ Vocal evidence is REQUIRED. A prompt claiming instrumental "
              f"is not proof. Run `score_bed --mode split` and pass one --vocal-stems "
              f"entry per candidate; unchecked candidates cannot be usable.")

    out = _write_json(job_dir, "scorecard.json", {"spec_bpm": spec["bpm"],
                                                  "candidates": cards})
    print(f"\nDone. Next: decode_audio --mode correct (if CORRECT) or "
          f"--mode finish --input <winner>   [{out.name}]")
    return {"candidates": cards}


# ─────────────────────────────────────────────────────────────────────────────
# MODE: correct — bounded key / tempo / phase correction
# ─────────────────────────────────────────────────────────────────────────────

def mode_correct(args, job_dir: Path) -> dict:
    spec = _read_spec(job_dir, args.spec)
    if not args.output:
        sys.exit("ERROR: --mode correct needs --output.")
    shift = args.shift_semitones or 0.0
    m = measure(args.input, full=False)
    target_bpm = args.target_bpm or spec["bpm"]

    # A pure resample by r changes BOTH pitch and tempo by r. Preserving tempo requires
    # atempo (a phase vocoder) — the exact combination that smeared a finished bed.
    r = 2.0 ** (shift / 12.0)
    bpm_after_resample = m["bpm"] * r
    need_retime = abs(1.0 - bpm_after_resample / target_bpm)

    print(f"[{TOOL}] correct  {Path(args.input).name}")
    print(f"  measured {m['bpm']} BPM → target {target_bpm} BPM;  shift {shift:+.2f} semitones")
    if shift:
        print(f"  a pure resample of {r:.5f}× lands the tempo at "
              f"{bpm_after_resample:.2f} BPM")
    print(f"  retime still required: {need_retime * 100:.2f}%")

    if need_retime * 100 > RETIME_CEILING_PCT and not args.allow_retime:
        sys.exit(
            f"\nREFUSED: this correction needs a {need_retime * 100:.1f}% phase-vocoder "
            f"retime, over the {RETIME_CEILING_PCT}% ceiling.\n"
            f"A 17% stretch produced 'slowed-tape drums, underwater smearing on the pad, "
            f"blunted transients' and the beds were binned (failure mode #1).\n"
            f"  → RE-ROLL this candidate, or\n"
            f"  → regenerate asking for {_precompensated_bpm(target_bpm, shift):.1f} BPM, "
            f"then shift {shift:+.2f} "
            f"here: a pure resample then lands BOTH key and tempo with no stretch, or\n"
            f"  → pass --allow-retime if you accept the artifact and will QC for it."
        )

    sr = SR_TONAL
    chain = []
    # Failure mode #2: aresample FIRST, always — asetrate reads the CURRENT stream rate.
    if shift:
        chain += [f"aresample={sr}", f"asetrate={sr}*{r:.8f}", f"aresample={sr}"]
    if need_retime > 1e-5:
        # atempo=R multiplies playback speed, so the RESULT is current_bpm * R. The ratio
        # is therefore target/current, not current/target — inverted, a +1-semitone
        # correction came out at 150 BPM / 31.4s instead of 134 BPM / 35.2s.
        current = bpm_after_resample if shift else m["bpm"]
        chain += [f"atempo={target_bpm / current:.8f}"]
    if not chain:
        chain = [f"aresample={sr}"]

    out = _job_path(job_dir, args.output)
    _ffmpeg(["-i", str(args.input), "-af", ",".join(chain),
             "-ar", str(sr), "-ac", "2", str(out)])
    after = measure(out, full=False)
    print(f"  → {out.name}: {after['bpm']} BPM, {after['duration_s']}s")

    log = {"input": str(args.input), "output": str(out),
           "pitch_shift_semitones": shift, "resample_ratio": round(r, 6),
           "retime_pct": round(need_retime * 100, 3),
           "allow_retime": bool(args.allow_retime),
           "filter_chain": ",".join(chain),
           "bpm_before": m["bpm"], "bpm_after": after["bpm"],
           "target_bpm": target_bpm}
    _write_json(job_dir, "correction.json", log)
    print(f"\nDone. Next: decode_audio --mode verify --input {out.name}")
    return log


# ─────────────────────────────────────────────────────────────────────────────
# MODE: finish — bar-aligned cut, fades, highpass, -14 LUFS
# ─────────────────────────────────────────────────────────────────────────────

def cut_start_for_alignment(x: np.ndarray, sr: int, bpm: float, spec_phase: float,
                            need_s: float) -> tuple[float, str]:
    """Where to cut so the source's own downbeat lands at the spec's downbeat time.

    Uses the SAME estimator `verify` uses (onset-grid phase + bar-offset choice), because
    two different estimators cannot be made to agree: scoring kick energy here while
    verify scored the onset grid put a finished bed's downbeat 0.65s from where finish
    believed it had placed it, and the closure the spec exists to provide was lost.
    """
    src_beat = refine_phase(x, sr, bpm)
    src_phase, _ = refine_downbeat(x, sr, bpm, src_beat)
    bar = 4.0 * 60.0 / bpm
    dur = len(x) / sr
    k = 0
    while True:
        start = src_phase + k * bar - spec_phase
        if start < 0:
            k += 1
            continue
        if start + need_s > dur:
            # No bar line leaves room. Clamping the start keeps the DURATION exact and
            # sacrifices a few ms of alignment; the reverse (keeping alignment, shipping a
            # short file) silently broke the duration assertion by 0.64s.
            if dur + 1e-6 < need_s:
                sys.exit(f"ERROR: source is {dur:.3f}s but {need_s:.3f}s is needed. Loop "
                         f"it first (score_bed's seamless loop) — this tool will not "
                         f"invent audio.")
            clamped = max(0.0, dur - need_s)
            return clamped, (
                f"NO HEADROOM: source is {dur:.2f}s for a {need_s:.2f}s target, so there "
                f"is nothing to trim and the downbeat cannot be moved (alignment off by "
                f"{abs(clamped - start) * 1000:.0f}ms). Duration was kept exact instead. "
                f"Feed the RAW take, not a pre-trimmed mix — alignment needs up to one "
                f"bar ({bar:.2f}s) of slack")
        return start, f"source downbeat {src_phase:.3f}s + {k} bar(s)"


def mode_finish(args, job_dir: Path) -> dict:
    spec = _read_spec(job_dir, args.spec)
    if not args.output:
        sys.exit("ERROR: --mode finish needs --output.")
    total = args.duration_sec or spec["duration_s"]
    phase = spec["downbeat_phase_s"]
    x = decode(args.input, SR_TONAL)
    dur = len(x) / SR_TONAL
    if dur < total:
        print(f"[{TOOL}] ⚠️  source is {dur:.2f}s but the spec wants {total:.2f}s — "
              f"the seamless-loop path in score_bed should fill it, not this tool.")

    start, how = cut_start_for_alignment(x, SR_TONAL, spec["bpm"], phase, total)
    out = _job_path(job_dir, args.output)

    # 8 ms de-click IN (the cut lands on a downbeat, so nothing else is needed there);
    # a real release OUT. Length: mirror the reference's own natural decay when it has one,
    # else --fade-out. A straight 350ms line on a sustained pad still reads as a cut, so
    # the shape is curved (--fade-curve, qsin by default).
    fade_out = args.fade_out
    fade_note = f"{fade_out}s"
    if args.fade_out_from_spec and spec.get("natural_decay_s"):
        fade_out = min(float(spec["natural_decay_s"]), total * 0.5)
        fade_note = f"{fade_out:.2f}s (mirroring the reference's own decay)"
    af = [f"afade=t=in:st=0:d={args.fade_in}",
          f"afade=t=out:st={max(0.0, total - fade_out):.6f}:d={fade_out:.6f}"
          f":curve={args.fade_curve}",
          "highpass=f=28"]
    if args.match_tail and spec.get("tail_db_under_avg") is not None:
        # Reproduce the reference's ring-out: ramp down over the last `tail` seconds to
        # the measured deficit. A duck, not a mute — see the recipe's caveat.
        tail = args.tail_s
        g = 10 ** (spec["tail_db_under_avg"] / 20.0)
        t0 = max(0.0, total - tail)
        af.insert(0, f"volume='if(lt(t,{t0:.4f}),1,max({g:.4f},"
                     f"1-(t-{t0:.4f})/{tail:.4f}*(1-{g:.4f})))':eval=frame")

    stage1 = out.with_name(out.stem + "_prenorm.wav")
    _ffmpeg(["-ss", f"{start:.6f}", "-t", f"{total:.6f}", "-i", str(args.input),
             "-af", ",".join(af), "-ar", str(SR_TONAL), "-ac", "2", str(stage1)])

    # Two-pass loudnorm — single-pass drifts on short material.
    meas = _loudnorm_measure(stage1)
    _ffmpeg(["-i", str(stage1), "-af",
             ("loudnorm=I=-14:LRA=7:TP=-1.0:linear=true:"
              f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}"),
             "-ar", str(SR_TONAL), "-ac", "2", str(out)])

    print(f"[{TOOL}] finish  cut at {start:.3f}s via {how} → downbeat lands at {phase}s, "
          f"{total:.3f}s, fade in {args.fade_in}s / out {fade_note} "
          f"curve={args.fade_curve}"
          + (", tail arc matched" if args.match_tail else ""))
    print(f"  → {out}")
    nxt = ("arrange" if (_read_spec(job_dir, args.spec).get("drops_s")
                         or _read_spec(job_dir, args.spec).get("breakdown_s"))
           else "verify")
    print(f"\nDone. Next: decode_audio --mode {nxt} --input {out.name} "
          f"--spec {Path(args.spec or 'spec.json').name}")
    return {"output": str(out), "cut_start_s": round(start, 4), "duration_s": total}


# ─────────────────────────────────────────────────────────────────────────────
# MODE: arrange — stamp the reference's STRUCTURE onto a flat bed
# ─────────────────────────────────────────────────────────────────────────────

def mode_arrange(args, job_dir: Path) -> dict:
    """Impose the spec's arrangement on a uniform bed: breakdown duck, drop lifts, fade.

    This is the half of the job a text prompt provably cannot do. Measured on one live
    generation: tempo survived the prose translation at 95.9% on-grid and duration landed
    exact, while every time-indexed instruction died — the sub sat flat between -17 and
    -21 dB for all 35 seconds, with no breakdown and no drop. So the recipe asks the
    generator for a FLAT bed on purpose and puts the dynamics here, where a timestamp is
    an argument rather than a hope.
    """
    spec = _read_spec(job_dir, args.spec)
    if not args.output:
        sys.exit("ERROR: --mode arrange needs --output.")
    drops = spec.get("drops_s") or []
    lifts = spec.get("drop_lift_db") or []
    brk = spec.get("breakdown_s") or []
    if not drops and not brk:
        sys.exit("ERROR: this spec has no drops and no breakdown — nothing to arrange. "
                 "A flat reference wants --mode finish, not this.")

    dur = spec["duration_s"]
    # Full-band gain automation: a dip through the breakdown, a lift at each drop that
    # DECAYS back to unity, so the drop clears the surrounding material the way the
    # reference's does (+9 dB measured; a lift that never decays is just a louder bed).
    terms = []
    if len(brk) >= 2:
        b0, b1 = float(brk[0]), float(brk[1])
        g = 10 ** (args.breakdown_db / 20.0)
        terms.append(f"if(between(t,{b0:.4f},{b1:.4f}),{g:.5f},1)")
    else:
        terms.append("1")
    for t, lift in zip(drops, lifts or [args.default_lift_db] * len(drops)):
        amp = 10 ** (min(float(lift), args.max_lift_db) / 20.0) - 1.0
        terms.append(f"(1+{amp:.5f}*exp(-max(0,t-{float(t):.4f})/{args.lift_decay_s:.3f})"
                     f"*gte(t,{float(t):.4f}))")
    expr = "*".join(terms)

    af = [f"volume='{expr}':eval=frame"]
    if len(brk) >= 2 and args.breakdown_hp_hz > 0:
        # Filtering only inside the breakdown needs a real crossfade, not a switch: a
        # high-pass snapped 0.85 -> 0 in one sample was a suspected click source once.
        af.append(f"highpass=f={args.breakdown_hp_hz}:enable='between(t,"
                  f"{float(brk[0]):.4f},{float(brk[1]):.4f})'")
    # ALWAYS close the bed. Mirror the reference's decay when it has one, otherwise use
    # --fade-out; never leave the end to chance, and never make it conditional on an
    # optional spec field (that is precisely how arranged beds ended abruptly).
    fs = spec.get("fade_start_s")
    if fs and float(fs) < dur - 0.05:
        st, d = float(fs), max(0.05, dur - float(fs))
        src = "reference decay"
    else:
        d = min(args.fade_out, dur * 0.5)
        st, src = max(0.0, dur - d), "--fade-out"
    af.append(f"afade=t=out:st={st:.4f}:d={d:.4f}:curve={args.fade_curve}")

    out = _job_path(job_dir, args.output)
    stage1 = out.with_name(out.stem + "_prenorm.wav")
    _ffmpeg(["-i", str(args.input), "-af", ",".join(af),
             "-ar", str(SR_TONAL), "-ac", "2", str(stage1)])
    # Re-normalize: imposing an arrangement changes the loudness by design, so -14 LUFS
    # has to be set after it, not before. (Which also fixes the stage ORDER: arrangement
    # timestamps are defined on the OUTPUT timeline, so arrange runs after finish, not
    # before it — running it first put every stamped drop 0.6-15s from its mark.)
    meas = _loudnorm_measure(stage1)
    _ffmpeg(["-i", str(stage1), "-af",
             ("loudnorm=I=-14:LRA=7:TP=-1.0:linear=true:"
              f"measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:"
              f"measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}"),
             "-ar", str(SR_TONAL), "-ac", "2", str(out)])

    after = sub_impacts(decode(out, SR_TONAL), SR_TONAL)
    print(f"[{TOOL}] arrange  breakdown {brk or '—'} at {args.breakdown_db} dB"
          f"{f' + HP {args.breakdown_hp_hz} Hz' if len(brk) >= 2 else ''}")
    print(f"  drops stamped at {[round(float(t), 3) for t in drops]} "
          f"lift {lifts or args.default_lift_db} dB (decay {args.lift_decay_s}s)")
    print(f"  measured back: {[d['t'] for d in after['drops']]} "
          f"lift {[d['lift_db'] for d in after['drops']]} dB")
    print(f"  tail       fade out {d:.2f}s from {st:.2f}s via {src}, "
          f"curve={args.fade_curve}")
    print(f"  → {out}")
    log = {"input": str(args.input), "output": str(out), "expr": expr,
           "fade": {"start_s": round(st, 4), "dur_s": round(d, 4),
                    "curve": args.fade_curve, "from": src},
           "drops_s": drops, "lift_db": lifts, "breakdown_s": brk,
           "measured_drops_s": [d["t"] for d in after["drops"]]}
    _write_json(job_dir, "arrangement.json", log)
    print(f"\nDone. Next: decode_audio --mode verify --input {out.name}")
    return log


# ─────────────────────────────────────────────────────────────────────────────
# MODE: verify — assert the OUTPUT against the spec
# ─────────────────────────────────────────────────────────────────────────────

def mode_verify(args, job_dir: Path) -> dict:
    spec = _read_spec(job_dir, args.spec)
    m = measure(args.input, full=True)
    interval_signed, key_src, key_conf = key_interval(spec, m)

    def chk(name, got, want, tol, unit=""):
        ok = want is None or abs(got - want) <= tol
        return {"field": name, "got": got, "want": want, "tol": tol,
                "unit": unit, "pass": bool(ok)}

    rows = [
        chk("duration_s", m["duration_s"], spec["duration_s"], args.tol_duration, "s"),
        chk("bpm", m["bpm"], spec["bpm"], args.tol_bpm, "BPM"),
        chk("downbeat_phase_s", m["downbeat_phase_s"], spec["downbeat_phase_s"],
            args.tol_downbeat, "s"),
    ]
    target = spec.get("target_tonal_center")
    target_gap = _semitone_gap(m.get("tonal_center"), target)
    rows.append({
        "field": f"target_key ({key_src}, {key_conf} conf)",
        "got": m.get("tonal_center"),
        "want": target or "explicit target required",
        "tol": None,
        "unit": "",
        "pass": bool(
            target is not None
            and target_gap == 0
            and abs(interval_signed) >= GATE_KEY_MIN_INTERVAL
        ),
    })
    rows.append({
        "field": "key_interval_from_reference",
        "got": round(interval_signed, 2),
        "want": f">={GATE_KEY_MIN_INTERVAL}",
        "tol": None,
        "unit": "semitones",
        "pass": bool(abs(interval_signed) >= GATE_KEY_MIN_INTERVAL),
    })
    if args.vocal_stem:
        vocals = decode(args.vocal_stem, SR_TONAL)
        vocal_db = round(
            float(20 * np.log10(max(1e-12, np.sqrt((vocals ** 2).mean())))),
            1,
        )
    else:
        vocal_db = None
    rows.append({
        "field": "vocal_stem_db",
        "got": vocal_db if vocal_db is not None else "UNCHECKED",
        "want": f"<{GATE_VOCAL_DB}",
        "tol": None,
        "unit": "dB",
        "pass": bool(vocal_db is not None and vocal_db < GATE_VOCAL_DB),
    })
    # Drops: nearest measured impact to each spec drop.
    if spec.get("drops_s"):
        errs = []
        for t in spec["drops_s"]:
            if m["drops_s"]:
                errs.append(round(min(m["drops_s"], key=lambda u: abs(u - t)) - t, 3))
            else:
                errs.append(None)
        rows.append({"field": "drops_s_error", "got": errs, "want": 0,
                     "tol": args.tol_drop, "unit": "s",
                     "pass": all(e is not None and abs(e) <= args.tol_drop
                                 for e in errs)})
    rows.append({"field": "tail_closes (final 100ms under avg)",
                 "got": m["tail_last_100ms_under_avg"],
                 "want": f"<=-{TAIL_CLOSED_DB}", "tol": None, "unit": "dB",
                 "pass": bool(args.loopable or not m["ends_abruptly"])})
    lufs = _loudnorm_measure(Path(args.input))
    rows.append(chk("lufs", float(lufs["input_i"]), -14.0, 0.6, "LUFS"))
    rows.append(chk("true_peak_db", float(lufs["input_tp"]), -1.0, 0.6, "dBTP"))

    all_pass = all(r["pass"] for r in rows)
    print(f"[{TOOL}] verify  {Path(args.input).name} vs spec\n")
    for r in rows:
        tol = "" if r["tol"] is None else f" ±{r['tol']}"
        print(f"  {'✅' if r['pass'] else '❌'} {r['field']:24s} got {r['got']} "
              f"want {r['want']}{tol} {r['unit']}")
    print(f"\n  ALL_PASS = {all_pass}")
    if not all_pass:
        print(f"  Failures are on the OUTPUT, not the intent — fix or re-roll, "
              f"do not report this bed as done.")
    if m["ends_abruptly"] and not args.loopable:
        print(f"  ↳ this bed is still {abs(m['tail_last_100ms_under_avg'])} dB inside its "
              f"own average in the final 100ms — it was CUT, not ended. Re-run --mode "
              f"finish (or arrange) so the release lands, or pass --loopable if this bed "
              f"is meant to sit under a longer edit.")
    if spec.get("drops_s") and not m.get("drops_s"):
        print(f"  ↳ the spec has {len(spec['drops_s'])} structural drop(s) and this bed "
              f"has none. That is what --mode arrange is for; a text prompt cannot put an "
              f"event on a timestamp.")
    if vocal_db is None:
        print("  ↳ vocal evidence is missing. Split the finished bed and rerun verify "
              "with --vocal-stem; prompt text is not evidence of an instrumental output.")

    report = {"input": str(args.input), "input_sha256": _sha256(args.input),
              "checks": rows, "ALL_PASS": all_pass,
              "hf_per_bar": {"got": m["hf_per_bar"], "ref": spec.get("hf_per_bar")},
              "bands_pct": m["bands_pct"], "band_targets_pct": spec["band_targets_pct"],
              "note": "band balance is ADVISORY — a new palette should differ"}
    _write_json(job_dir, "verify.json", report)
    print(f"\nDone. Next: mux onto picture, then the blind listening pass — and route "
          f"every claim it makes to a measurement before reporting it (video_qa.md).")
    return report


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ffmpeg(args_: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-y", "-v", "error", *args_], capture_output=True)
    if proc.returncode != 0:
        sys.exit(f"ERROR: ffmpeg failed\n{proc.stderr.decode('utf-8', 'replace')[:600]}")


def _loudnorm_measure(path: Path) -> dict:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-af", "loudnorm=I=-14:LRA=7:TP=-1.0:print_format=json", "-f", "null", "-"],
        capture_output=True)
    txt = proc.stderr.decode("utf-8", "replace")
    i, j = txt.rfind("{"), txt.rfind("}")
    if i < 0 or j < 0:
        sys.exit(f"ERROR: could not read loudnorm stats from {path}")
    return json.loads(txt[i:j + 1])


def _job_path(job_dir: Path, name: str) -> Path:
    p = Path(name)
    out = p if p.is_absolute() or len(p.parts) > 1 else (job_dir / "audio" / p)
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def _write_json(job_dir: Path, name: str, payload: dict) -> Path:
    out = _job_path(job_dir, name)
    out.write_text(json.dumps(payload, indent=2))
    # Rule 4: assert we wrote where --job said, and log the real path.
    assert out.resolve().is_relative_to(job_dir.resolve()), \
        f"Wrote outside job dir: {out}"
    log_event(job_dir, tool=__file__, event=f"{TOOL}_artifact_written",
              extra={"path": str(out.resolve().relative_to(job_dir.resolve()))})
    return out


def _read_spec(job_dir: Path, name: str | None) -> dict:
    p = _job_path(job_dir, name or "spec.json")
    if not p.exists():
        sys.exit(f"ERROR: {p} not found. Run --mode grid first.")
    spec = json.loads(p.read_text())
    for k in ("bpm", "downbeat_phase_s", "duration_s", "key_profile_cents"):
        if k not in spec:
            sys.exit(f"ERROR: {p} is missing '{k}' — regenerate it with --mode grid.")
    return spec


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — synthetic signals with known ground truth. No job, no I/O, no spend.
# ─────────────────────────────────────────────────────────────────────────────

def selftest() -> int:
    ok, fail = 0, 0

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok, fail
        if cond:
            ok += 1
            print(f"  ✅ {name}  {detail}")
        else:
            fail += 1
            print(f"  ❌ {name}  {detail}")

    sr = SR_TONAL
    rng = np.random.default_rng(7)

    def click_track(bpm: float, phase: float, bars: int, sr: int = sr,
                    tail_s: float = 0.06) -> np.ndarray:
        """A pickup + `bars` whole bars + just enough tail for the last hit to decay —
        the shape a real 4-bar reference has (one measured 3.93 bars in 10.58s)."""
        beat = 60.0 / bpm
        n = int((phase + bars * 4 * beat + tail_s) * sr)
        x = np.zeros(n)
        for k in range(bars * 4):
            t = phase + k * beat
            i = int(t * sr)
            env = np.exp(-np.arange(int(0.05 * sr)) / (0.006 * sr))
            tone = np.sin(2 * np.pi * 60 * np.arange(len(env)) / sr)
            x[i:i + len(env)] += tone * env * (1.0 if k % 4 == 0 else 0.6)
        return x + rng.normal(0, 1e-4, n)

    print("decode_audio --selftest\n")

    # 1-4: tempo, then phase and downbeat through the real refinement path.
    x = click_track(120.0, 0.25, 8)
    env, fps, t0 = onset_envelope(decode_array_resample(x, sr, SR_GRID), SR_GRID)
    g = grid_scan(env, fps, len(x) / sr, t0=t0)
    check("grid_scan recovers BPM", abs(g["bpm"] - 120.0) < 0.3,
          f"got {g['bpm']} want 120")
    ph = refine_phase(x, sr, g["bpm"])
    check("refine_phase recovers beat phase to <15ms", abs(ph - 0.25) < 0.015,
          f"got {ph:.4f} want 0.25 (flux-only gave {g['phase_s']:.4f})")
    db, how = refine_downbeat(x, sr, g["bpm"], ph)
    check("refine_downbeat lands on the accented beat", abs(db - 0.25) < 0.015,
          f"got {db:.4f} want 0.25 (via {how})")
    check("grid score separates the truth", g["grid_score"] > g["runner_up_score"],
          f"{g['grid_score']} vs {g['runner_up_score']} @ {g['runner_up_bpm']}")

    # 5: bars-fit ACCEPTS the true tempo. It is necessary, not sufficient: a 3:2-related
    # impostor can also land on whole bars (172 BPM fits this very clip in exactly 12.00
    # bars), which is why the IOI adjudication below is the primary defense.
    bars_true = (len(x) / sr) / (4 * 60.0 / 120.0)
    check("bars-fit accepts the true tempo", abs(bars_true - round(bars_true)) < 0.35,
          f"120 BPM gives {bars_true:.2f} bars")

    # 5-7: cent-profile intervals, including the sign convention.
    def tonal(root_hz: float, dur: float = 4.0) -> np.ndarray:
        t = np.arange(int(dur * sr)) / sr
        y = np.zeros_like(t)
        for k, g_ in ((1, 1.0), (2, 0.5), (3, 0.33), (4, 0.22), (5, 0.15)):
            y += g_ * np.sin(2 * np.pi * root_hz * k * t)
        # a minor triad on top so it reads as music, not a single tone
        for iv, g_ in ((3, 0.4), (7, 0.4)):
            y += g_ * np.sin(2 * np.pi * root_hz * 2 * 2 ** (iv / 12) * t)
        return y * 0.2

    a = cent_profile(tonal(110.0), sr)                      # A2
    b = cent_profile(tonal(110.0 * 2 ** (3 / 12)), sr)      # +3 semitones
    iv = cyclic_interval(a, b)
    check("cyclic_interval magnitude", abs(abs(iv["interval_semitones"]) - 3.0) < 0.25,
          f"got {iv['interval_semitones']:+} want +3")
    check("cyclic_interval sign (B above A is positive)",
          iv["interval_semitones"] > 0, f"got {iv['interval_semitones']:+}")
    same = cyclic_interval(a, cent_profile(tonal(110.0), sr))
    check("cyclic_interval says 0 for the same key",
          abs(same["interval_semitones"]) < 0.15, f"got {same['interval_semitones']:+}")

    # 8: absolute root naming via the bass histogram.
    bass = bass_root_histogram(tonal(61.735, 8.0), sr, 120.0, 0.0)   # B1
    check("bass_root_histogram names the root", bass["tonal_center"] == "B",
          f"got {bass['tonal_center']} want B  {bass['histogram']}")

    # 9: band percentages sum to ~100 and place energy correctly.
    bp = band_pcts(tonal(110.0), sr)
    check("band_pcts sums to 100", abs(sum(bp["bands_pct"].values()) - 100.0) < 1.0,
          f"sum {sum(bp['bands_pct'].values()):.1f}")

    # 10: grid_fit separates a locked grid from noise.
    onsets_locked = 0.25 + np.arange(32) * (60.0 / 120.0 / 4)
    gf_locked = grid_fit(onsets_locked, 120.0, 0.25)
    gf_rand = grid_fit(np.sort(rng.uniform(0, 16, 200)), 120.0, 0.25)
    check("grid_fit separates locked vs random",
          gf_locked["mean_dev"] < 0.02 < gf_rand["mean_dev"],
          f"locked {gf_locked['mean_dev']} vs random {gf_rand['mean_dev']}")

    # 11: the IOI adjudicator agrees with the true tempo and rejects the impostor.
    io_true = ioi_adjudicate(onsets_locked, 120.0)
    io_false = ioi_adjudicate(onsets_locked, 172.0)
    check("IOI adjudicates for the true tempo",
          bool(io_true["agrees"]) and not io_false["agrees"],
          f"120 agrees={io_true['agrees']} / 172 agrees={io_false['agrees']}")

    # 12: the retime refusal arithmetic — a 3-semitone shift implies ~19%, over ceiling.
    r = 2 ** (3 / 12)
    check("retime ceiling would refuse a 3-semitone shift",
          abs(1 - r) * 100 > RETIME_CEILING_PCT,
          f"{abs(1 - r) * 100:.1f}% > {RETIME_CEILING_PCT}%")

    # Target-key closure: being far from the reference is insufficient when the
    # candidate misses the requested destination.
    verdict, shift = _key_verdict("C", "D", 5.0)
    check("different-but-wrong key cannot KEEP",
          verdict == "CORRECT" and shift == 2,
          f"got verdict={verdict} shift={shift}")
    verdict, shift = _key_verdict("D", "D", 3.0)
    check("requested changed key can KEEP",
          verdict == "KEEP" and shift == 0,
          f"got verdict={verdict} shift={shift}")

    # If the correction raises pitch+tempo by r, the generator must start at
    # target/r. Multiplication is the inverse and guarantees a tempo miss.
    pre = _precompensated_bpm(120.0, 3.0)
    check("BPM precompensation divides by pitch ratio",
          abs(pre * r - 120.0) < 1e-9,
          f"request {pre:.3f} then ×{r:.5f} → {pre * r:.3f}")

    print(f"\n  {ok} passed, {fail} failed")
    return 1 if fail else 0


def decode_array_resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """Cheap linear resample — selftest only, so the synthetic signals can go through
    the same SR_GRID path the real decode uses."""
    n = int(len(x) * sr_out / sr_in)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Mechanical audio measurement for music recreation "
                    "(workflows/music-recreation.md). No spend.")
    p.add_argument("--selftest", action="store_true",
                   help="run the synthetic ground-truth checks and exit (no --job needed)")
    add_job_arg(p, required=False)   # required in practice; checked in main() so
                                     # --selftest can run without a job
    p.add_argument("--mode", choices=["grid", "compare", "correct", "arrange",
                                      "finish", "verify"],
                   help="which stage of the recipe to run (REQUIRED, logged as usage_role)")
    p.add_argument("--input",
                   help="reference or bed to measure / process. Accepts a LOCAL PATH, a "
                        "file:// URL, or a remote URL (YouTube / IG / TikTok / X) — a URL "
                        "is ripped audio-only into <job>/reference/ and cached.")
    p.add_argument("--regen", action="store_true",
                   help="re-fetch a URL reference even if it is already cached")
    p.add_argument("--candidates", nargs="+",
                   help="--mode compare: candidate files or URLs")
    p.add_argument("--vocal-stems", nargs="+",
                   help="--mode compare: vocal stems from `score_bed --mode split`, "
                        "positionally matched to --candidates (enables the vocal gate)")
    p.add_argument("--vocal-stem",
                   help="--mode verify: vocal stem split from the finished bed; required "
                        "for ALL_PASS because prompt text is not vocal evidence")
    p.add_argument("--spec", default="spec.json",
                   help="spec.json path (default <job>/audio/spec.json)")
    p.add_argument("--output", help="output wav (--mode correct / finish)")
    p.add_argument("--target-root", default=None,
                   help="--mode grid: the key you intend to move TO (e.g. B)")
    p.add_argument("--bpm-lo", type=float, default=70.0)
    p.add_argument("--bpm-hi", type=float, default=200.0)
    p.add_argument("--shift-semitones", type=float, default=None,
                   help="--mode correct: transposition to apply")
    p.add_argument("--target-bpm", type=float, default=None,
                   help="--mode correct: defaults to the spec's BPM")
    p.add_argument("--allow-retime", action="store_true",
                   help="--mode correct: permit a phase-vocoder stretch over the "
                        f"{RETIME_CEILING_PCT}%% ceiling (see failure mode #1)")
    p.add_argument("--duration-sec", type=float, default=None,
                   help="--mode finish: defaults to the spec's duration")
    p.add_argument("--fade-in", type=float, default=0.008,
                   help="de-click at the head; the cut lands on a downbeat so 8ms is plenty")
    p.add_argument("--fade-out", type=float, default=0.8,
                   help="release at the tail. 0.8s reads as an ending; the old 0.35s "
                        "default still read as a cut on sustained material.")
    p.add_argument("--fade-curve", default="qsin",
                   choices=["qsin", "hsin", "esin", "tri", "log", "exp", "cub", "par"],
                   help="afade shape. qsin (quarter-sine) is the smooth musical default; "
                        "tri is the straight line that sounds abrupt.")
    p.add_argument("--fade-out-from-spec", action="store_true", default=True,
                   help="--mode finish: mirror the reference's measured decay length "
                        "instead of --fade-out when the spec recorded one")
    p.add_argument("--loopable", action="store_true",
                   help="this bed must LOOP or sit under a longer edit, so it should end "
                        "at full level: skips the tail-closure assertion in --mode verify")
    p.add_argument("--breakdown-db", type=float, default=-24.0,
                   help="--mode arrange: gain through the breakdown span")
    p.add_argument("--breakdown-hp-hz", type=float, default=340.0,
                   help="--mode arrange: high-pass inside the breakdown (0 = off)")
    p.add_argument("--default-lift-db", type=float, default=9.0,
                   help="--mode arrange: lift when the spec recorded none")
    p.add_argument("--max-lift-db", type=float, default=9.0,
                   help="--mode arrange: ceiling on any single drop lift")
    p.add_argument("--lift-decay-s", type=float, default=1.2,
                   help="--mode arrange: how fast a drop lift decays back to unity")
    p.add_argument("--match-tail", action="store_true",
                   help="--mode finish: reproduce the reference's ring-out arc")
    p.add_argument("--tail-s", type=float, default=1.5)
    p.add_argument("--tol-bpm", type=float, default=0.3)
    p.add_argument("--tol-downbeat", type=float, default=0.015)
    p.add_argument("--tol-duration", type=float, default=0.05)
    p.add_argument("--tol-drop", type=float, default=0.6,
                   help="drop-time tolerance. Deliberately loose: the sub-band locator is "
                        "documented at +-0.5s on saturated material, so asserting 50ms "
                        "against it would be false precision, not rigour.")
    p.add_argument("--quiet", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.selftest:
        return selftest()
    if not args.job:
        sys.exit("ERROR: --job is REQUIRED (concurrent jobs clobber shared state).")
    if not args.mode:
        sys.exit("ERROR: --mode is REQUIRED "
                 "(grid | compare | correct | finish | verify).")
    if args.mode != "compare" and not args.input:
        sys.exit(f"ERROR: --mode {args.mode} needs --input.")

    job_dir = resolve_job_dir(args.job)
    # URL-or-file, resolved once, before any mode runs.
    if args.input:
        args.input = str(resolve_ref(args.input, job_dir, regen=args.regen))
    if args.candidates:
        args.candidates = [str(resolve_ref(c, job_dir, regen=args.regen))
                           for c in args.candidates]
    if args.vocal_stems:
        args.vocal_stems = [str(resolve_ref(v, job_dir, regen=args.regen))
                            for v in args.vocal_stems]
    if args.vocal_stem:
        args.vocal_stem = str(resolve_ref(args.vocal_stem, job_dir, regen=args.regen))
    t0 = time.perf_counter()
    log_event(job_dir, tool=__file__, event=f"{TOOL}_started",
              extra={"usage_role": args.mode, "input": args.input,
                     "candidates": args.candidates})
    try:
        result = {"grid": mode_grid, "compare": mode_compare, "correct": mode_correct,
                  "arrange": mode_arrange, "finish": mode_finish,
                  "verify": mode_verify}[args.mode](args, job_dir)
    except SystemExit:
        raise
    except Exception as exc:                                    # noqa: BLE001
        log_event(job_dir, tool=__file__, event=f"{TOOL}_failed",
                  extra={"usage_role": args.mode, "error": str(exc)[-1000:]})
        raise
    log_event(job_dir, tool=__file__, event=f"{TOOL}_completed",
              duration_seconds=time.perf_counter() - t0,
              extra={"usage_role": args.mode})
    if args.mode == "verify" and not result["ALL_PASS"]:
        return 1
    if args.mode == "compare" and not any(
        card["verdict"] != "REROLL" for card in result["candidates"]
    ):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
