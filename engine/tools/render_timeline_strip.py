"""render_timeline_strip — the comprehension strip: cross-modal evidence on ONE time axis.

The CORE artifact of the comprehension module (videoclaw-app#103, layer 2). One PNG
per span: a dense filmstrip (default 5 fps — dense enough to SEE caption animation),
a waveform ribbon, word CHIPS below it (rounded pills spanning each Scribe
word's exact start→end — spoken timing as readable data), silence
shading, PLUS the measured facts no reading should have to infer: cut markers,
a music-state band, and beat boundaries — all on the same x axis. The model READS
this instead of receiving precomputed prose; semantic understanding happens at
decision time by looking.

Two modes:

  linear — one video, one span (auto-splits long spans into multiple strips,
           snapping splits to beat edges when beats are provided):
    uv run python tools/render_timeline_strip.py --job <id> --video ref.mp4 \
        [--start 0 --end 12] [--fps 5] [--transcript t.json] [--cuts c.json] \
        [--music m.json] [--beats b.json] [--output-dir dir]

  stack  — REF over OURS, BEAT-ALIGNED (the duplication add-on's evidence format):
           columns pair beat-relative, never wall-clock — our beats legitimately
           run longer than the reference, so beat j column i of REF sits directly
           above the same proportional moment of OURS:
    uv run python tools/render_timeline_strip.py --job <id> --stack \
        --ref ref.mp4 --ours final.mp4 --ref-beats rb.json --ours-beats ob.json \
        [--ref-transcript ... --ours-transcript ... --ref-cuts ... --ours-cuts ...
         --ref-music ... --ours-music ...]

Deterministic given its inputs (no API calls, no clocks, no randomness — same
inputs, same pixels modulo font availability). Self-test (needs ffmpeg only):
    uv run python tools/render_timeline_strip.py --selftest

Filmstrip/waveform/word-label idea adapted from browser-use/video-use
`timeline_view.py` (MIT); the measured layers (cuts, music, beats) and the
beat-aligned stack mode are this repo's.

Input shapes (tolerant):
  transcript: {"words":[{"word"|"text","start","end"}, ...]}  (analyze_reference / Scribe)
  cuts:       [{"time": t, ...}] (breakdown_reference.detect_cuts) | [t, ...]
              | {"cuts":[t, ...]} (the #12 temporal block)
  music:      {"music_present": [[a,b], ...]} (#12) | [[a,b], ...]
  beats:      [{"id","start","end"}, ...] | [t0, t1, ..., tn] (edges)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
import wave as wave_mod
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))  # tools/ on path

from job import resolve_job_dir, add_job_arg  # noqa: E402

# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------

DEFAULT_FPS = 5.0
DEFAULT_MAX_WINDOW = 2.0  # seconds per strip — one image per ~2s of video
MAX_COLUMNS = 60          # hard backstop per strip regardless of fps
STACK_MAX_COLUMNS = 12    # per stacked strip (~2s-equiv at 5fps); splits on beats
STACK_COLS_PER_BEAT_MAX = 12
FRAME_H = 300             # filmstrip row height (px)
WAVE_H = 90               # waveform ribbon height
MUSIC_H = 10              # music-state band height
WORDS_H = 38              # word-chip band BELOW the waveform (rounded timestamp pills)
AUDIO_EVIDENCE_H = 26     # globally-normalized RMS energy + deterministic onset markers
RULER_H = 26
HEADER_H = 50   # fits the title line + a warning line beneath it
BEATBAND_H = 24           # stack mode: shared beat-id band between panels
MARGIN = 40
COL_GAP = 3
SILENCE_MIN_S = 0.4

BG = (18, 18, 22)
FG = (235, 235, 235)
DIM = (110, 110, 120)
CUT_COLOR = (255, 90, 60)        # measured cut — accent red-orange
BEAT_COLOR = (120, 200, 160)     # beat boundary — dashed green
WAVE_COLOR = (140, 180, 255)
SILENCE_FILL = (50, 80, 120, 110)
MUSIC_ON = (200, 160, 60)
MUSIC_OFF = (55, 55, 62)
MUSIC_NA = (40, 40, 46)
PANEL_BG = (28, 28, 34)

FONT_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


def load_font(size: int) -> ImageFont.ImageFont:
    for fp in FONT_CANDIDATES:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# tolerant input loaders
# ---------------------------------------------------------------------------

def load_words(path: Path | None) -> list[dict]:
    """→ [{"text","start","end"}] from analyze_reference/Scribe/video-use shapes."""
    if not path:
        return []
    data = json.loads(Path(path).read_text())
    words = data.get("words", data) if isinstance(data, dict) else data
    out = []
    for w in words or []:
        if not isinstance(w, dict):
            continue
        text = (w.get("word") or w.get("text") or "").strip()
        ws, we = w.get("start"), w.get("end")
        if text and ws is not None and we is not None:
            out.append({"text": text, "start": float(ws), "end": float(we)})
    return sorted(out, key=lambda w: w["start"])


def load_cuts(path: Path | None) -> list[float]:
    """→ [t, ...] from detect_cuts dicts, a bare list, or a #12 temporal block."""
    if not path:
        return []
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        data = data.get("cuts", [])
    out = []
    for c in data or []:
        if isinstance(c, dict) and "time" in c:
            out.append(float(c["time"]))
        elif isinstance(c, (int, float)):
            out.append(float(c))
    return sorted(out)


def load_music(path: Path | None) -> dict:
    """→ {"available": bool, "present": [[a,b], ...]}."""
    if not path:
        return {"available": False, "present": []}
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        if data.get("available") is False:
            return {"available": False, "present": []}
        present = data.get("music_present", data.get("present", []))
    else:
        present = data
    present = [[float(a), float(b)] for a, b in (present or [])]
    return {"available": True, "present": sorted(present)}


def load_beats(path: Path | None, span: tuple[float, float]) -> list[dict]:
    """→ [{"id","start","end"}] tiling within `span`; whole span if no file."""
    start, end = span
    if not path:
        return [{"id": "b1", "start": start, "end": end}]
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        data = data.get("events", data.get("beats", []))
    beats: list[dict] = []
    if data and all(isinstance(x, (int, float)) for x in data):     # edge list
        edges = sorted(float(x) for x in data)
        for i in range(len(edges) - 1):
            beats.append({"id": f"b{i + 1}", "start": edges[i], "end": edges[i + 1]})
    else:
        for i, b in enumerate(data or []):
            beats.append({"id": str(b.get("id", f"b{i + 1}")),
                          "start": float(b.get("start", b.get("start_seconds"))),
                          "end": float(b.get("end", b.get("end_seconds")))})
    beats = [{"id": b["id"], "start": max(start, b["start"]), "end": min(end, b["end"])}
             for b in beats if b["end"] > start and b["start"] < end]
    return beats or [{"id": "b1", "start": start, "end": end}]


def load_audio_evidence(path: Path | None) -> dict:
    """→ deterministic mechanical audio evidence, or an unavailable sentinel."""
    if not path:
        return {"available": False, "energy_windows": [], "onsets": []}
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict):
        raise ValueError("audio evidence must be a JSON object")
    return {
        "available": bool(data.get("available")),
        "energy_windows": list(data.get("energy_windows") or []),
        "onsets": list(data.get("onsets") or []),
        "window_seconds": data.get("window_seconds"),
    }


def find_silences(words: list[dict], start: float, end: float,
                  threshold: float = SILENCE_MIN_S) -> list[tuple[float, float]]:
    gaps: list[tuple[float, float]] = []
    prev = start
    for w in words:
        ws = max(start, w["start"])
        if ws - prev >= threshold:
            gaps.append((prev, ws))
        prev = max(prev, w["end"])
    if end - prev >= threshold:
        gaps.append((prev, end))
    return gaps


# ---------------------------------------------------------------------------
# media extraction (ffmpeg)
# ---------------------------------------------------------------------------

def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def probe_duration(video: Path) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(video)],
        capture_output=True, text=True)
    try:
        return float(res.stdout.strip())
    except ValueError:
        raise SystemExit(f"ffprobe could not read duration of {video}")


# scdet default threshold (0-100 score scale). 8 catches hard cuts; the montage
# staccato cuts in fast-edited reels score 12-31, well above this.
DEFAULT_CUT_THRESHOLD = 8.0


def detect_cuts(video: Path, threshold: float = DEFAULT_CUT_THRESHOLD) -> list[dict]:
    """Return [{"time": float, "score": float}] scene-cut boundaries via ffmpeg scdet.

    The one cut detector: breakdown_reference and look_at_video both import it
    from here. Local ffmpeg only — no provider, no network.
    """
    res = subprocess.run([
        "ffmpeg", "-i", str(video),
        "-vf", f"scdet=threshold={threshold}",
        "-an", "-f", "null", "-",
    ], capture_output=True, text=True)
    cuts: list[dict] = []
    for line in res.stderr.splitlines():
        if "lavfi.scd.score" in line and "lavfi.scd.time" in line:
            try:
                score = float(line.split("lavfi.scd.score:")[1].split(",")[0].strip())
                t = float(line.split("lavfi.scd.time:")[1].strip())
                cuts.append({"time": round(t, 3), "score": round(score, 2)})
            except (IndexError, ValueError):
                continue
    # dedupe near-identical timestamps (scdet can double-report a dissolve)
    deduped: list[dict] = []
    for c in cuts:
        if deduped and abs(c["time"] - deduped[-1]["time"]) < 0.2:
            if c["score"] > deduped[-1]["score"]:
                deduped[-1] = c
            continue
        deduped.append(c)
    return deduped


def build_shots(cuts: list[dict], duration: float) -> list[dict]:
    """Turn cut boundaries into [start, end] shot windows covering [0, duration]."""
    boundaries = [0.0] + [c["time"] for c in cuts] + [round(duration, 3)]
    shots: list[dict] = []
    for i in range(len(boundaries) - 1):
        start, end = boundaries[i], boundaries[i + 1]
        if end - start < 0.15:  # drop sub-frame slivers
            continue
        shots.append({
            "index": len(shots) + 1,
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
        })
    return shots


def extract_frame(video: Path, t: float, height: int, out: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{max(0.0, t):.3f}", "-i", str(video),
         "-frames:v", "1", "-q:v", "4", "-vf", f"scale=-2:{height}", str(out)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def extract_frames_fps(video: Path, start: float, end: float, fps: float,
                       height: int, dest: Path) -> list[tuple[float, Path]]:
    """Frames at `fps` across [start, end] in ONE ffmpeg call. → [(t, path)]."""
    dest.mkdir(parents=True, exist_ok=True)
    dur = max(1.0 / fps, end - start)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(video),
         "-vf", f"fps={fps},scale=-2:{height}", "-q:v", "4",
         str(dest / "f_%05d.jpg")],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    files = sorted(dest.glob("f_*.jpg"))
    return [(start + k / fps, p) for k, p in enumerate(files)]


def compute_envelope(video: Path, start: float, end: float, samples: int) -> np.ndarray:
    """Windowed-RMS envelope of the span's audio, normalized to [0,1]; zeros if silent/none."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = Path(f.name)
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(video),
             "-t", f"{(end - start):.3f}", "-vn", "-ac", "1", "-ar", "16000",
             "-c:a", "pcm_s16le", str(wav)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode != 0 or not wav.exists() or wav.stat().st_size == 0:
            return np.zeros(samples)
        with wave_mod.open(str(wav), "rb") as w:
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        pcm = pcm.astype(np.float32) / 32768.0
        if pcm.size == 0:
            return np.zeros(samples)
        window = max(1, pcm.size // samples)
        usable = (pcm.size // window) * window
        env = np.sqrt(np.mean(pcm[:usable].reshape(-1, window) ** 2, axis=1))
        if env.size < samples:
            env = np.pad(env, (0, samples - env.size))
        env = env[:samples]
        return env / env.max() if env.max() > 0 else env
    finally:
        wav.unlink(missing_ok=True)


def analyze_audio_evidence(
    video: Path,
    start: float,
    end: float,
    *,
    window_seconds: float = 0.10,
) -> dict:
    """Measure globally comparable RMS energy and transient onsets.

    This deliberately does not label music, drops, impacts, or semantic sound
    classes: the renderer and vision model cannot hear those facts. The output
    is deterministic mechanical evidence only.
    """
    sample_rate = 16000
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = Path(f.name)
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(video),
             "-t", f"{max(0.0, end - start):.3f}", "-vn", "-ac", "1",
             "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(wav)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if r.returncode != 0 or not wav.exists() or wav.stat().st_size <= 44:
            return {
                "available": False,
                "reason": "no readable audio stream",
                "window_seconds": window_seconds,
                "energy_windows": [],
                "onsets": [],
            }
        with wave_mod.open(str(wav), "rb") as w:
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if pcm.size == 0:
            return {
                "available": False,
                "reason": "empty audio stream",
                "window_seconds": window_seconds,
                "energy_windows": [],
                "onsets": [],
            }
        samples_per_window = max(1, int(round(sample_rate * window_seconds)))
        n_windows = math.ceil(pcm.size / samples_per_window)
        padded = np.pad(
            pcm.astype(np.float32) / 32768.0,
            (0, n_windows * samples_per_window - pcm.size),
        )
        rms = np.sqrt(np.mean(
            padded.reshape(n_windows, samples_per_window) ** 2,
            axis=1,
        ))
        peak = float(rms.max()) if rms.size else 0.0
        normalized = rms / peak if peak > 0 else rms
        energy_windows = []
        for i, value in enumerate(rms):
            a = start + i * window_seconds
            b = min(end, a + window_seconds)
            energy_windows.append({
                "start": round(a, 3),
                "end": round(b, 3),
                "rms": round(float(value), 6),
                "normalized_rms": round(float(normalized[i]), 4),
            })

        # Positive RMS novelty, robust-thresholded and locally maximized.
        novelty = np.maximum(0.0, np.diff(normalized, prepend=normalized[0]))
        positive = novelty[novelty > 0]
        threshold = (
            float(np.median(positive) + 2.5 * np.median(
                np.abs(positive - np.median(positive))
            ))
            if positive.size else 1.0
        )
        threshold = max(0.08, threshold)
        candidates: list[tuple[int, float]] = []
        for i, value in enumerate(novelty):
            prev = novelty[i - 1] if i else -1.0
            nxt = novelty[i + 1] if i + 1 < novelty.size else -1.0
            if value >= threshold and value >= prev and value >= nxt:
                candidates.append((i, float(value)))
        onsets = []
        min_gap_windows = max(1, int(round(0.18 / window_seconds)))
        for i, strength in sorted(candidates, key=lambda item: (-item[1], item[0])):
            if any(abs(i - int(round((o["time"] - start) / window_seconds)))
                   < min_gap_windows for o in onsets):
                continue
            onsets.append({
                "time": round(start + i * window_seconds, 3),
                "strength": round(strength, 4),
            })
        onsets.sort(key=lambda item: item["time"])
        return {
            "available": True,
            "method": "global_rms_positive_novelty_v1",
            "window_seconds": window_seconds,
            "peak_rms": round(peak, 6),
            "energy_windows": energy_windows,
            "onsets": onsets,
        }
    finally:
        wav.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# time → x mapping (piecewise linear through column centers)
# ---------------------------------------------------------------------------

@dataclass
class TimeMap:
    """Monotonic piecewise-linear map from time to canvas x, anchored at the
    filmstrip's column centers — so overlays (cuts, words, music, beats) land
    exactly where their evidence frame sits, in linear AND beat-warped strips."""
    times: list[float]
    xs: list[float]

    def __call__(self, t: float) -> int:
        ts, xs = self.times, self.xs
        if t <= ts[0]:
            return int(xs[0])
        if t >= ts[-1]:
            return int(xs[-1])
        for i in range(len(ts) - 1):
            if ts[i] <= t <= ts[i + 1]:
                if ts[i + 1] == ts[i]:
                    return int(xs[i])
                frac = (t - ts[i]) / (ts[i + 1] - ts[i])
                return int(xs[i] + frac * (xs[i + 1] - xs[i]))
        return int(xs[-1])


# ---------------------------------------------------------------------------
# panel rendering
# ---------------------------------------------------------------------------

@dataclass
class Panel:
    video: Path
    label: str
    columns: list[tuple[float, Image.Image]]   # (source time, frame)
    words: list[dict]
    cuts: list[float]
    music: dict
    beats: list[dict]
    span: tuple[float, float]
    audio_evidence: dict | None = None


PANEL_H = FRAME_H + 4 + WAVE_H + AUDIO_EVIDENCE_H + WORDS_H + MUSIC_H + RULER_H
CHIP_FILL = (52, 52, 64)
CHIP_OUTLINE = (86, 86, 102)


def _paste_columns(canvas: Image.Image, panel: Panel, y_frames: int,
                   cell_w: int | None) -> TimeMap:
    """Paste the filmstrip; return the TimeMap through the pasted centers."""
    x = MARGIN
    times, centers = [], []
    for t, img in panel.columns:
        w = cell_w if cell_w else img.width
        pad = max(0, (w - img.width) // 2)
        canvas.paste(img, (x + pad, y_frames))
        times.append(t)
        centers.append(x + w / 2)
        x += w + COL_GAP
    return TimeMap(times, centers)


def _draw_panel(canvas: Image.Image, draw: ImageDraw.ImageDraw, panel: Panel,
                y0: int, cell_w: int | None, fonts: dict) -> tuple[TimeMap, int]:
    """Render one panel (words band, filmstrip, waveform, music band, ruler)
    starting at y0. Returns (tmap, y_after)."""
    start, end = panel.span
    y_frames = y0
    y_wave = y_frames + FRAME_H + 4
    y_audio = y_wave + WAVE_H
    y_words = y_audio + AUDIO_EVIDENCE_H
    y_music = y_words + WORDS_H
    y_ruler = y_music + MUSIC_H + 2

    tmap = _paste_columns(canvas, panel, y_frames, cell_w)
    x0, x1 = int(tmap.xs[0]), int(tmap.xs[-1])

    # waveform background + silence shading
    draw.rectangle((x0, y_wave, x1, y_wave + WAVE_H), fill=PANEL_BG)
    for a, b in find_silences(panel.words, start, end):
        draw.rectangle((tmap(a), y_wave, tmap(b), y_wave + WAVE_H), fill=SILENCE_FILL)

    # waveform envelope, drawn through the (possibly beat-warped) tmap
    n_samples = max(200, x1 - x0)
    env = compute_envelope(panel.video, start, end, n_samples)
    mid = y_wave + WAVE_H // 2
    amp = WAVE_H // 2 - 6
    top, bot = [], []
    for i, v in enumerate(env):
        t = start + (end - start) * i / max(1, len(env) - 1)
        xi = tmap(t)
        a = int(v * amp)
        top.append((xi, mid - a))
        bot.append((xi, mid + a))
    if top:
        draw.line(top, fill=WAVE_COLOR, width=1)
        draw.line(bot, fill=WAVE_COLOR, width=1)
        draw.polygon(top + list(reversed(bot)), fill=(*WAVE_COLOR, 55))

    # Globally normalized mechanical energy band + deterministic onsets.
    audio = panel.audio_evidence or {
        "available": False, "energy_windows": [], "onsets": [],
    }
    draw.rectangle((x0, y_audio, x1, y_audio + AUDIO_EVIDENCE_H),
                   fill=(32, 32, 38))
    if audio.get("available"):
        for row in audio.get("energy_windows", []):
            a = float(row.get("start", 0.0))
            b = float(row.get("end", a))
            if b <= start or a >= end:
                continue
            level = max(0.0, min(1.0, float(row.get("normalized_rms", 0.0))))
            color = (45 + int(100 * level), 70 + int(100 * level),
                     105 + int(110 * level))
            draw.rectangle(
                (tmap(max(a, start)), y_audio,
                 tmap(min(b, end)), y_audio + AUDIO_EVIDENCE_H),
                fill=color,
            )
        for onset in audio.get("onsets", []):
            t = float(onset.get("time", -1.0))
            if start <= t <= end:
                xo = tmap(t)
                draw.line((xo, y_wave, xo, y_audio + AUDIO_EVIDENCE_H),
                          fill=(255, 190, 70), width=2)
                draw.text((xo + 2, y_audio + 5), "ON", fill=(255, 225, 150),
                          font=fonts["tiny"])
        draw.text((x0 + 4, y_audio + 5), "global RMS + onset novelty",
                  fill=FG, font=fonts["tiny"])
    else:
        draw.text((x0 + 4, y_audio + 5), "audio evidence: n/a",
                  fill=DIM, font=fonts["tiny"])

    # word chips BELOW the waveform: one rounded pill per transcript word,
    # spanning exactly its start→end timestamps — spoken timing as data
    chip_y0, chip_y1 = y_words + 5, y_words + WORDS_H - 7
    for w in panel.words:
        if w["end"] <= start or w["start"] >= end:
            continue
        wx0 = tmap(max(w["start"], start))
        wx1 = max(tmap(min(w["end"], end)), wx0 + 6)
        draw.rounded_rectangle((wx0, chip_y0, wx1, chip_y1), radius=6,
                               fill=CHIP_FILL, outline=CHIP_OUTLINE, width=1)
        text = w["text"]
        for font_key in ("words", "tiny"):
            tw = draw.textlength(text, font=fonts[font_key])
            if tw <= (wx1 - wx0) - 6:
                th = fonts[font_key].size if hasattr(fonts[font_key], "size") else 10
                draw.text(((wx0 + wx1) / 2 - tw / 2,
                           (chip_y0 + chip_y1) / 2 - th / 2 - 1),
                          text, fill=FG, font=fonts[font_key])
                break

    # music band
    if panel.music["available"]:
        draw.rectangle((x0, y_music, x1, y_music + MUSIC_H), fill=MUSIC_OFF)
        for a, b in panel.music["present"]:
            if b <= start or a >= end:
                continue
            draw.rectangle((tmap(max(a, start)), y_music, tmap(min(b, end)),
                            y_music + MUSIC_H), fill=MUSIC_ON)
    else:
        draw.rectangle((x0, y_music, x1, y_music + MUSIC_H), fill=MUSIC_NA)
        draw.text((x0 + 4, y_music - 1), "music: n/a", fill=DIM, font=fonts["tiny"])

    # measured cuts — full-height accent through filmstrip + waveform
    for c in panel.cuts:
        if start <= c <= end:
            xc = tmap(c)
            draw.line((xc, y_frames, xc, y_music + MUSIC_H), fill=CUT_COLOR, width=2)
            draw.polygon([(xc - 4, y_frames - 6), (xc + 4, y_frames - 6),
                          (xc, y_frames)], fill=CUT_COLOR)

    # beat boundaries — dashed
    for b in panel.beats:
        for edge in (b["start"], b["end"]):
            if start < edge < end:
                xb = tmap(edge)
                for yy in range(y_frames, y_music + MUSIC_H, 8):
                    draw.line((xb, yy, xb, min(yy + 4, y_music + MUSIC_H)),
                              fill=BEAT_COLOR, width=1)

    # ruler — a tick per column (sparse labels)
    label_every = max(1, len(panel.columns) // 16)
    for i, (t, _img) in enumerate(panel.columns):
        xi = tmap(t)
        draw.line((xi, y_ruler, xi, y_ruler + 5), fill=DIM, width=1)
        if i % label_every == 0:
            draw.text((xi - 14, y_ruler + 7), f"{t:.2f}", fill=DIM, font=fonts["tiny"])

    return tmap, y_ruler + RULER_H


def _load_column_images(video: Path, times: list[float], tmp: Path) -> list[tuple[float, Image.Image]]:
    cols = []
    for i, t in enumerate(times):
        p = tmp / f"c_{i:05d}.jpg"
        extract_frame(video, t, FRAME_H, p)
        cols.append((t, Image.open(p).convert("RGB")))
    return cols


# ---------------------------------------------------------------------------
# linear mode
# ---------------------------------------------------------------------------

def split_windows(start: float, end: float, fps: float, beats: list[dict],
                  max_window: float = DEFAULT_MAX_WINDOW) -> list[tuple[float, float]]:
    """Split [start,end] into readable windows of ≤ max_window seconds (and never more than
    MAX_COLUMNS frames). EVERY beat edge — its START and its END — that falls inside the span is
    a HARD boundary, so a beat/animation-window becomes its own strip with its exact start/end and
    no strip ever straddles a beat edge. The spans BETWEEN beats (and any single beat longer than
    max_window) are then subdivided evenly into ≤ max_window pieces for readability."""
    max_span = min(max_window, MAX_COLUMNS / fps)
    # hard boundaries: the span ends + every beat edge (start AND end) strictly inside the span
    bounds = {round(start, 6), round(end, 6)}
    for b in beats:
        for edge in (b["start"], b["end"]):
            if start < edge < end:
                bounds.add(round(float(edge), 6))
    ordered = sorted(bounds)
    final: list[tuple[float, float]] = []
    for a, c in zip(ordered, ordered[1:]):
        n = max(1, math.ceil((c - a) / max_span - 1e-9))   # subdivide a long gap / long beat
        for i in range(n):
            final.append((a + i * (c - a) / n, a + (i + 1) * (c - a) / n))
    return final


def render_linear(video: Path, start: float, end: float, fps: float,
                  words: list[dict], cuts: list[float], music: dict,
                  beats: list[dict], out_dir: Path, stem: str,
                  max_window: float = DEFAULT_MAX_WINDOW,
                  audio_evidence: dict | None = None,
                  windows: list[tuple[float, float]] | None = None) -> list[Path]:
    """Render one strip per window. By default the windows come from
    `split_windows` (every beat edge is a hard strip boundary); a caller may pass
    its own `windows` instead, and `beats` is then only drawn and counted."""
    fonts = {"header": load_font(22), "small": load_font(14),
             "words": load_font(15), "tiny": load_font(12)}
    outputs = []
    if windows is None:
        windows = split_windows(start, end, fps, beats, max_window)
    for wi, (a, b) in enumerate(windows):
        with tempfile.TemporaryDirectory() as tmp:
            frames = extract_frames_fps(video, a, b, fps, FRAME_H, Path(tmp))
            frames = [(t, Image.open(p).convert("RGB")) for t, p in frames]
            if not frames:
                continue
            total_w = sum(img.width for _t, img in frames) + COL_GAP * (len(frames) - 1)
            W = total_w + 2 * MARGIN
            H = HEADER_H + PANEL_H + MARGIN // 2
            canvas = Image.new("RGB", (W, H), BG)
            draw = ImageDraw.Draw(canvas, "RGBA")
            n_beats = len([bt for bt in beats if bt["start"] < b and bt["end"] > a])
            draw.text((MARGIN, 12),
                      f"{video.name}   {a:.2f}s → {b:.2f}s   {fps:g}fps · "
                      f"{len(frames)} frames · {n_beats} beat(s) · "
                      f"{len([c for c in cuts if a <= c <= b])} cut(s)",
                      fill=FG, font=fonts["header"])
            panel = Panel(
                video, video.stem, frames, words, cuts, music, beats, (a, b),
                audio_evidence,
            )
            _draw_panel(canvas, draw, panel, HEADER_H, None, fonts)
            suffix = f"_p{wi + 1:02d}" if len(windows) > 1 else ""
            out = out_dir / f"{stem}_{a:.2f}-{b:.2f}@{fps:g}fps{suffix}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(out, "PNG", optimize=True)
            outputs.append(out)
            print(f"STRIP → {out.relative_to(out_dir.parents[1]) if out.is_relative_to(out_dir.parents[1]) else out}")
    return outputs


# ---------------------------------------------------------------------------
# stack mode (beat-aligned REF over OURS)
# ---------------------------------------------------------------------------

def pair_beats(ref_beats: list[dict], ours_beats: list[dict]) -> tuple[list[tuple[dict, dict]], str]:
    """Pair beats by index. A count mismatch is a FINDING, not a crash — pair
    the overlap and return a warning to burn into the strip."""
    n_ref, n_ours = len(ref_beats), len(ours_beats)
    warn = ""
    if n_ref != n_ours:
        warn = f"BEAT COUNT MISMATCH: ref={n_ref} ours={n_ours} (pairing first {min(n_ref, n_ours)})"
    return list(zip(ref_beats, ours_beats)), warn


def beat_column_times(beat: dict, k: int) -> list[float]:
    """K sample times at proportional midpoints inside the beat."""
    dur = beat["end"] - beat["start"]
    return [beat["start"] + dur * (i + 0.5) / k for i in range(k)]


def chunk_beat_pairs(pairs: list[tuple[dict, dict]], fps: float, *,
                     k_basis: str = "ref",
                     max_columns: int = STACK_MAX_COLUMNS) -> list[list[tuple[dict, dict, int]]]:
    """Assign K per pair and chunk pairs into strips of ≤ `max_columns` columns.

    `k_basis="ref"` (the default) sizes K from the REF beat duration. `"longer"`
    sizes it from the LONGER side and rounds up, so both panels get at least
    `fps` columns per second whenever every pair fits in `max_columns / fps`
    seconds (look_at_video subdivides its pairs to guarantee that)."""
    if k_basis not in {"ref", "longer"}:
        raise ValueError(f"unknown k_basis {k_basis!r}")
    chunks: list[list[tuple[dict, dict, int]]] = [[]]
    cols = 0
    for ref_b, ours_b in pairs:
        if k_basis == "longer":
            span = max(ref_b["end"] - ref_b["start"], ours_b["end"] - ours_b["start"])
            k = max(1, min(STACK_COLS_PER_BEAT_MAX, max_columns,
                           math.ceil(span * fps - 1e-9)))
        else:
            k = max(1, min(STACK_COLS_PER_BEAT_MAX,
                           round((ref_b["end"] - ref_b["start"]) * fps)))
        if cols + k > max_columns and chunks[-1]:
            chunks.append([])
            cols = 0
        chunks[-1].append((ref_b, ours_b, k))
        cols += k
    return [c for c in chunks if c]


def render_stack(ref: dict, ours: dict, fps: float,
                 out_dir: Path, *,
                 pairs: list[tuple[dict, dict]] | None = None,
                 warn: str = "",
                 k_basis: str = "ref",
                 max_columns: int = STACK_MAX_COLUMNS) -> tuple[list[Path], list[dict]]:
    """ref/ours: {"video","words","cuts","music","beats","span"[,"audio_evidence"]}.

    Returns (paths, cards) — `cards` records, per emitted PNG, which REF beats it
    actually shows. That is what makes Stage 2.5 coverage checkable: a card that
    was never rendered cannot have been read.

    By default REF and OURS beats pair by index (`pair_beats`). A caller may pass
    its own `pairs` (and the `warn` line to burn in) instead — the panels still
    draw `ref["beats"]` / `ours["beats"]` as the beat boundaries. `k_basis` and
    `max_columns` pass through to `chunk_beat_pairs`."""
    fonts = {"header": load_font(22), "small": load_font(14),
             "words": load_font(15), "tiny": load_font(12)}
    if pairs is None:
        pairs, warn = pair_beats(ref["beats"], ours["beats"])
    if not pairs:
        raise SystemExit("stack mode: no beats overlap the requested spans")
    outputs: list[Path] = []
    cards: list[dict] = []
    chunks = chunk_beat_pairs(pairs, fps, k_basis=k_basis, max_columns=max_columns)
    for ci, chunk in enumerate(chunks):
        ref_times, ours_times, k_per_beat = [], [], []
        for ref_b, ours_b, k in chunk:
            ref_times += beat_column_times(ref_b, k)
            ours_times += beat_column_times(ours_b, k)
            k_per_beat.append(k)
        with tempfile.TemporaryDirectory() as tmp_r, tempfile.TemporaryDirectory() as tmp_o:
            ref_cols = _load_column_images(ref["video"], ref_times, Path(tmp_r))
            ours_cols = _load_column_images(ours["video"], ours_times, Path(tmp_o))
        cell_w = max(img.width for _t, img in ref_cols + ours_cols)
        total_w = (cell_w + COL_GAP) * len(ref_cols) - COL_GAP
        W = total_w + 2 * MARGIN
        H = HEADER_H + PANEL_H + BEATBAND_H + PANEL_H + MARGIN // 2
        canvas = Image.new("RGB", (W, H), BG)
        draw = ImageDraw.Draw(canvas, "RGBA")

        ref_span = (chunk[0][0]["start"], chunk[-1][0]["end"])
        ours_span = (chunk[0][1]["start"], chunk[-1][1]["end"])
        header = (f"REF {Path(ref['video']).name} {ref_span[0]:.2f}–{ref_span[1]:.2f}s"
                  f"  vs  OURS {Path(ours['video']).name} {ours_span[0]:.2f}–{ours_span[1]:.2f}s"
                  f"   beat-aligned · {fps:g}fps-equiv · beats {chunk[0][0]['id']}–{chunk[-1][0]['id']}")
        draw.text((MARGIN, 6), header, fill=FG, font=fonts["header"])
        if warn:
            draw.text((MARGIN, 32), warn, fill=CUT_COLOR, font=fonts["small"])

        y = HEADER_H
        ref_panel = Panel(ref["video"], "REF", ref_cols, ref["words"], ref["cuts"],
                          ref["music"], ref["beats"], ref_span,
                          ref.get("audio_evidence"))
        _tm, y = _draw_panel(canvas, draw, ref_panel, y, cell_w, fonts)

        # shared beat band: id + REF dur vs OURS dur (the stretch is visible data)
        x = MARGIN
        for ref_b, ours_b, k in chunk:
            w = (cell_w + COL_GAP) * k - COL_GAP
            draw.rectangle((x, y, x + w, y + BEATBAND_H - 4), fill=PANEL_BG)
            rd, od = ref_b["end"] - ref_b["start"], ours_b["end"] - ours_b["start"]
            draw.text((x + 4, y + 4),
                      f"{ref_b['id']}  {rd:.2f}s → {od:.2f}s", fill=BEAT_COLOR,
                      font=fonts["small"])
            x += w + COL_GAP
        y += BEATBAND_H

        ours_panel = Panel(ours["video"], "OURS", ours_cols, ours["words"],
                           ours["cuts"], ours["music"], ours["beats"], ours_span,
                           ours.get("audio_evidence"))
        _draw_panel(canvas, draw, ours_panel, y, cell_w, fonts)

        suffix = f"_p{ci + 1:02d}" if len(chunks) > 1 else ""
        out = out_dir / (f"stack_{Path(ref['video']).stem}_vs_"
                         f"{Path(ours['video']).stem}{suffix}.png")
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out, "PNG", optimize=True)
        outputs.append(out)
        cards.append({"file": out.name, "ref_span": [ref_span[0], ref_span[1]],
                      "ours_span": [ours_span[0], ours_span[1]],
                      "beats": [b[0]["id"] for b in chunk]})
        print(f"STRIP → {out}")
    return outputs, cards


def render_stack_wallclock(ref: dict, ours: dict, fps: float, out_dir: Path,
                           max_window: float = DEFAULT_MAX_WINDOW) -> tuple[list[Path], list[dict]]:
    """Wall-clock stacked cards: REF (top) over OURS (bottom) sampled at the SAME timestamps,
    segmented IDENTICALLY to linear mode (`split_windows` → one card per window, so coverage of
    the full duration matches the ref-only strips exactly). For a faithful clone whose OURS
    tracks the REF timeline. `render_stack` stays the beat-relative mode for remixes whose beats
    legitimately run longer than the reference."""
    fonts = {"header": load_font(22), "small": load_font(14),
             "words": load_font(15), "tiny": load_font(12)}
    r_start, r_end = ref["span"]
    windows = split_windows(r_start, r_end, fps, ref["beats"], max_window)
    total = len(windows)
    outputs: list[Path] = []
    cards: list[dict] = []
    for wi, (a, b) in enumerate(windows):
        with tempfile.TemporaryDirectory() as tr, tempfile.TemporaryDirectory() as to:
            rf = extract_frames_fps(ref["video"], a, b, fps, FRAME_H, Path(tr))
            of = extract_frames_fps(ours["video"], a, b, fps, FRAME_H, Path(to))
            ref_cols = [(t, Image.open(p).convert("RGB")) for t, p in rf]
            ours_cols = [(t, Image.open(p).convert("RGB")) for t, p in of]
        if not ref_cols:
            continue
        n = len(ref_cols)
        # OURS sampled at the SAME times; if OURS ran short of b, pad with a marked blank so the
        # missing tail is itself visible as a disparity (never silently dropped).
        blank = Image.new("RGB", (ref_cols[0][1].size), (46, 24, 24))
        while len(ours_cols) < n:
            ours_cols.append((ref_cols[len(ours_cols)][0], blank))
        ours_cols = ours_cols[:n]

        cell_w = max(img.width for _t, img in ref_cols + ours_cols)
        total_w = (cell_w + COL_GAP) * n - COL_GAP
        W = total_w + 2 * MARGIN
        H = HEADER_H + PANEL_H + 8 + PANEL_H + MARGIN // 2
        canvas = Image.new("RGB", (W, H), BG)
        draw = ImageDraw.Draw(canvas, "RGBA")

        wid = next((bt["id"] for bt in ref["beats"]
                    if abs(bt["start"] - a) < 1e-2 and abs(bt["end"] - b) < 1e-2), None)
        tag = f"{wid} (animation window)" if wid else "hold / gap"
        draw.text((MARGIN, 10),
                  f"REF {Path(ref['video']).name} (top)  vs  OURS {Path(ours['video']).name} (bot)"
                  f"   {a:.2f}s → {b:.2f}s   {fps:g}fps · {n} frame(s)   card {wi + 1}/{total} · {tag}"
                  f"   — compare EACH column top-vs-bottom",
                  fill=FG, font=fonts["header"])

        y = HEADER_H
        ref_panel = Panel(ref["video"], "REF", ref_cols, ref["words"], ref["cuts"],
                          ref["music"], ref["beats"], (a, b))
        _tm, y = _draw_panel(canvas, draw, ref_panel, y, cell_w, fonts)
        y += 8
        ours_panel = Panel(ours["video"], "OURS", ours_cols, ours["words"], ours["cuts"],
                           ours["music"], ours["beats"], (a, b))
        _draw_panel(canvas, draw, ours_panel, y, cell_w, fonts)

        out = out_dir / (f"stack_{Path(ref['video']).stem}_vs_"
                         f"{Path(ours['video']).stem}_p{wi + 1:02d}.png")
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out, "PNG", optimize=True)
        outputs.append(out)
        cards.append({"file": out.name, "ref_span": [a, b], "ours_span": [a, b],
                      "beats": [bt["id"] for bt in ref["beats"]
                                if bt["end"] > a + 1e-6 and bt["start"] < b - 1e-6]})
        print(f"STRIP → {out}")
    return outputs, cards


# ---------------------------------------------------------------------------
# Stage 2.5 receipt (skills/video_qa.md) — the MECHANICAL half of ref-fidelity QA
# ---------------------------------------------------------------------------

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_stack_receipt(out_dir: Path, ref_video: Path, ours_video: Path, mode: str,
                        fps: float, ref_beats: list[dict], cards: list[dict]) -> Path:
    """Record what was ACTUALLY rendered, so `qa_gate` can check Stage 2.5 the same
    mechanical way it checks the Stage 1–2 review: against THIS render, with FULL
    beat coverage.

    BOTH comparison inputs are hashed. A comparison is only bound to its evidence if
    both sides are pinned — hashing OURS alone lets a re-cut reference slip past an
    old set of cards, which is the same stale-evidence defect the gate exists to catch.

    Deterministic — no clock, no randomness (the tool's contract). The reading half
    (the disparity table's outcome) is written later by `qa_gate --mark-stack`; the
    gate refuses the receipt until both halves are present and current.
    """
    covered = {bid for c in cards for bid in c["beats"]}
    all_ids = [b["id"] for b in ref_beats]
    receipt = {
        "schema": "stack_receipt/2",
        "mode": mode,
        "fps": fps,
        "ref": str(ref_video),
        "ref_sha256": _sha256(ref_video),
        "ours": str(ours_video),
        "ours_sha256": _sha256(ours_video),
        "beats_total": len(all_ids),
        "beats_covered": len([i for i in all_ids if i in covered]),
        "uncovered_beats": [i for i in all_ids if i not in covered],
        "cards": cards,
        "read": None,   # ← filled by `qa_gate --mark-stack`
    }
    path = out_dir / "stack_receipt.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, indent=2))
    print(f"STACK RECEIPT → {path}  "
          f"({receipt['beats_covered']}/{receipt['beats_total']} ref beats on a card, "
          f"ref {receipt['ref_sha256'][:8]}… vs ours {receipt['ours_sha256'][:8]}…)")
    return path


def resolve_job_input(path: Path | None, job_dir: Path) -> Path | None:
    """Resolve a CLI input relative to the selected job when appropriate.

    Existing callers also pass repo-relative paths such as jobs/<id>/final.mp4,
    so preserve a path that already exists from the process CWD. When both forms
    exist, the job-local path wins because --job explicitly selected that scope.
    """
    if path is None or path.is_absolute():
        return path
    candidate = job_dir / path
    if candidate.exists() or not path.exists():
        return candidate
    return path


# ---------------------------------------------------------------------------
# selftest (deterministic; needs ffmpeg only — no API, no job state)
# ---------------------------------------------------------------------------

def _make_synth_video(path: Path, seconds: float, freq: int = 440) -> None:
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"testsrc2=size=320x568:rate=30:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
         "-pix_fmt", "yuv420p", str(path)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def selftest() -> int:
    if not ffmpeg_available():
        print("SELFTEST FAIL: ffmpeg not on PATH (required)")
        return 1
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = ""):
        print(f"  {'ok' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail and not ok else ""))
        if not ok:
            failures.append(name)

    # -- unit: loaders are shape-tolerant
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        (tdp / "c1.json").write_text(json.dumps([{"time": 1.5, "score": 0.9}, {"time": 3.0}]))
        (tdp / "c2.json").write_text(json.dumps([1.5, 3.0]))
        (tdp / "c3.json").write_text(json.dumps({"cuts": [1.5, 3.0], "music": {}}))
        check("cuts: three shapes agree",
              load_cuts(tdp / "c1.json") == load_cuts(tdp / "c2.json") == load_cuts(tdp / "c3.json") == [1.5, 3.0])
        (tdp / "w1.json").write_text(json.dumps({"words": [{"word": "hey", "start": 0.1, "end": 0.4}]}))
        (tdp / "w2.json").write_text(json.dumps({"words": [{"text": "hey", "start": 0.1, "end": 0.4}]}))
        check("transcript: word/text keys agree",
              load_words(tdp / "w1.json") == load_words(tdp / "w2.json"))
        (tdp / "m1.json").write_text(json.dumps({"available": True, "music_present": [[1, 2]]}))
        (tdp / "m2.json").write_text(json.dumps([[1, 2]]))
        check("music: #12 block and bare list agree",
              load_music(tdp / "m1.json")["present"] == load_music(tdp / "m2.json")["present"] == [[1.0, 2.0]])
        (tdp / "b1.json").write_text(json.dumps([0, 2, 4, 6]))
        beats = load_beats(tdp / "b1.json", (0, 6))
        check("beats: edge list → 3 tiling beats",
              len(beats) == 3 and beats[0]["start"] == 0 and beats[-1]["end"] == 6)

    # -- unit: TimeMap monotonic + clamped
    tm = TimeMap([0.0, 1.0, 3.0], [100.0, 200.0, 300.0])
    check("TimeMap: interpolation", tm(0.5) == 150 and tm(2.0) == 250)
    check("TimeMap: clamps outside", tm(-5) == 100 and tm(99) == 300)

    # -- unit: silences
    ws = [{"text": "a", "start": 1.0, "end": 1.2}, {"text": "b", "start": 3.0, "end": 3.2}]
    sil = find_silences(ws, 0.0, 4.0)
    check("silence gaps found", sil == [(0.0, 1.0), (1.2, 3.0), (3.2, 4.0)])

    # -- unit: stack chunking respects the column cap
    mk = lambda i, a, b: {"id": f"b{i}", "start": a, "end": b}
    long_pairs = [(mk(i, i * 4.0, (i + 1) * 4.0), mk(i, i * 5.0, (i + 1) * 5.0)) for i in range(6)]
    chunks = chunk_beat_pairs(long_pairs, 5.0)   # K=12 each → 4 per chunk max
    check("stack chunking caps columns",
          all(sum(k for *_bs, k in c) <= STACK_MAX_COLUMNS for c in chunks)
          and sum(len(c) for c in chunks) == 6)

    # -- integration: render both modes on synthetic videos
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        va, vb = tdp / "ref.mp4", tdp / "ours.mp4"
        _make_synth_video(va, 6.0, 440)
        _make_synth_video(vb, 8.0, 330)
        audio_evidence = analyze_audio_evidence(va, 0.0, 6.0)
        check(
            "audio: global RMS evidence is available",
            audio_evidence["available"]
            and len(audio_evidence["energy_windows"]) > 10,
        )
        words = [{"text": f"w{i}", "start": i * 0.8, "end": i * 0.8 + 0.3} for i in range(7)]
        ref_beats = [mk(1, 0.0, 2.0), mk(2, 2.0, 4.0), mk(3, 4.0, 6.0)]
        ours_beats = [mk(1, 0.0, 3.0), mk(2, 3.0, 5.5), mk(3, 5.5, 8.0)]

        outs = render_linear(va, 0.0, 6.0, 5.0, words, [1.5, 3.0],
                             {"available": True, "present": [[2.0, 5.0]]},
                             ref_beats, tdp / "strips", "ref",
                             audio_evidence=audio_evidence)
        check("linear: 6s span splits into 3 readable 2s cards (beat edges)",
              len(outs) == 3 and all(o.exists() for o in outs))
        if outs:
            img = Image.open(outs[0])
            check("linear: canvas sized to layout",
                  img.height == HEADER_H + PANEL_H + MARGIN // 2 and img.width > 500,
                  f"got {img.size}")

        outs2 = render_linear(va, 0.0, 6.0, 5.0, [], [], {"available": False, "present": []},
                              load_beats(None, (0.0, 6.0)), tdp / "strips2", "ref")
        check("linear: works with no transcript/cuts/music (hard-splits ≤2s)",
              len(outs2) == 3)

        wins = split_windows(0.0, 30.0, 5.0, [mk(i, i * 3.0, (i + 1) * 3.0) for i in range(10)])
        check("linear: long span splits within the readable window",
              len(wins) > 1 and all((b - a) <= DEFAULT_MAX_WINDOW + 1e-6 for a, b in wins)
              and wins[0][0] == 0.0 and wins[-1][1] == 30.0)

        souts, scards = render_stack(
            {"video": va, "words": words, "cuts": [1.5], "music": {"available": True, "present": [[2.0, 5.0]]},
             "beats": ref_beats, "span": (0.0, 6.0)},
            {"video": vb, "words": [], "cuts": [2.2], "music": {"available": False, "present": []},
             "beats": ours_beats, "span": (0.0, 8.0)},
            5.0, tdp / "stacks")
        check("stack: 3 beats → 3 readable beat-aligned cards",
              len(souts) == 3 and all(o.exists() for o in souts))
        if souts:
            img = Image.open(souts[0])
            expect_h = HEADER_H + PANEL_H + BEATBAND_H + PANEL_H + MARGIN // 2
            check("stack: canvas holds both panels", img.height == expect_h, f"got {img.size}")

        # mismatch pairing is a finding, not a crash
        _pairs, warn = pair_beats(ref_beats, ours_beats[:2])
        check("stack: beat-count mismatch warns", "MISMATCH" in warn)

        # -- Stage 2.5 receipt: full coverage, hashed to the render it was built from
        rp = write_stack_receipt(tdp / "stacks", va, vb, "beat", 5.0, ref_beats, scards)
        rec = json.loads(rp.read_text())
        check("receipt: every ref beat lands on a card",
              rec["beats_covered"] == rec["beats_total"] == 3 and rec["uncovered_beats"] == [],
              f"got {rec['beats_covered']}/{rec['beats_total']} uncovered={rec['uncovered_beats']}")
        check("receipt: hashes BOTH comparison inputs (ref AND ours)",
              rec["ours_sha256"] == _sha256(vb) and rec["ref_sha256"] == _sha256(va)
              and rec["ref_sha256"] != rec["ours_sha256"])
        check("receipt: every card it claims is on disk",
              all((tdp / "stacks" / c["file"]).is_file() for c in rec["cards"]) and rec["cards"])
        # a partial render (cards for 2 of 3 beats) must SHOW as uncovered, not pass silently
        rp2 = write_stack_receipt(tdp / "stacks2", va, vb, "beat", 5.0, ref_beats, scards[:2])
        rec2 = json.loads(rp2.read_text())
        check("receipt: partial coverage is visible",
              rec2["beats_covered"] == 2 and rec2["uncovered_beats"] == ["b3"],
              f"got {rec2['beats_covered']} uncovered={rec2['uncovered_beats']}")

        # wallclock mode also tiles every beat onto a card
        wouts, wcards = render_stack_wallclock(
            {"video": va, "words": words, "cuts": [], "music": {"available": False, "present": []},
             "beats": ref_beats, "span": (0.0, 6.0)},
            {"video": vb, "words": [], "cuts": [], "music": {"available": False, "present": []},
             "beats": ours_beats, "span": (0.0, 8.0)},
            5.0, tdp / "wstacks")
        wrec = json.loads(write_stack_receipt(
            tdp / "wstacks", va, vb, "wallclock", 5.0, ref_beats, wcards).read_text())
        check("receipt: wallclock mode covers the full ref timeline",
              len(wouts) > 0 and wrec["beats_covered"] == 3 and wrec["uncovered_beats"] == [],
              f"got {wrec['beats_covered']}/3 uncovered={wrec['uncovered_beats']}")

    n_total = 20
    print(f"\nselftest: {n_total - len(failures)}/{n_total} passed")
    return 1 if failures else 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Comprehension strip: filmstrip + waveform + words + cuts + music + beats on one time axis")
    add_job_arg(ap, required=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--fps", type=float, default=DEFAULT_FPS)
    ap.add_argument("--max-window", type=float, default=DEFAULT_MAX_WINDOW,
                    help="max seconds per strip (default 2.0 — one image per ~2s of video)")
    ap.add_argument("--output-dir", type=Path, default=None,
                    help="default: <job>/strips/")
    # linear mode
    ap.add_argument("--video", type=Path)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--transcript", type=Path)
    ap.add_argument("--cuts", type=Path)
    ap.add_argument("--music", type=Path)
    ap.add_argument("--beats", type=Path)
    ap.add_argument("--audio-evidence", type=Path,
                    help="mechanical RMS/onset JSON from analyze_audio_evidence")
    # stack mode
    ap.add_argument("--stack", action="store_true", help="beat-aligned REF over OURS")
    ap.add_argument("--wallclock", action="store_true",
                    help="stack: REF-over-OURS at the SAME timestamps, segmented like linear "
                         "(full-duration coverage; for faithful clones whose OURS tracks the ref)")
    ap.add_argument("--ref", type=Path)
    ap.add_argument("--ours", type=Path)
    ap.add_argument("--ref-beats", type=Path)
    ap.add_argument("--ours-beats", type=Path)
    ap.add_argument("--ref-transcript", type=Path)
    ap.add_argument("--ours-transcript", type=Path)
    ap.add_argument("--ref-cuts", type=Path)
    ap.add_argument("--ours-cuts", type=Path)
    ap.add_argument("--ref-music", type=Path)
    ap.add_argument("--ours-music", type=Path)
    args = ap.parse_args()

    if args.selftest:
        sys.exit(selftest())
    if not ffmpeg_available():
        raise SystemExit("ffmpeg is required on PATH")

    job_dir = resolve_job_dir(args.job)
    out_dir = args.output_dir or (job_dir / "strips")
    for name in (
        "video", "transcript", "cuts", "music", "beats", "audio_evidence",
        "ref", "ours", "ref_beats", "ours_beats",
        "ref_transcript", "ours_transcript", "ref_cuts", "ours_cuts",
        "ref_music", "ours_music",
    ):
        setattr(args, name, resolve_job_input(getattr(args, name), job_dir))

    if args.stack:
        if not (args.ref and args.ours):
            raise SystemExit("--stack needs --ref and --ours")
        ref_end = probe_duration(args.ref)
        ours_end = probe_duration(args.ours)
        ref = {"video": args.ref, "words": load_words(args.ref_transcript),
               "cuts": load_cuts(args.ref_cuts), "music": load_music(args.ref_music),
               "beats": load_beats(args.ref_beats, (0.0, ref_end)), "span": (0.0, ref_end)}
        ours = {"video": args.ours, "words": load_words(args.ours_transcript),
                "cuts": load_cuts(args.ours_cuts), "music": load_music(args.ours_music),
                "beats": load_beats(args.ours_beats, (0.0, ours_end)), "span": (0.0, ours_end)}
        outs, cards = (render_stack_wallclock(ref, ours, args.fps, out_dir, args.max_window)
                       if args.wallclock else render_stack(ref, ours, args.fps, out_dir))
        receipt = write_stack_receipt(
            out_dir, args.ref, args.ours,
            "wallclock" if args.wallclock else "beat",
            args.fps, ref["beats"], cards)
    else:
        receipt = None
        if not args.video:
            raise SystemExit("linear mode needs --video (or use --stack)")
        end = args.end if args.end is not None else probe_duration(args.video)
        outs = render_linear(
            args.video, args.start, end, args.fps,
            load_words(args.transcript), load_cuts(args.cuts),
            load_music(args.music), load_beats(args.beats, (args.start, end)),
            out_dir, args.video.stem, args.max_window,
            load_audio_evidence(args.audio_evidence))
    out = {"mode": "stack" if args.stack else "linear",
           "strips": [str(o) for o in outs]}
    if receipt:
        out["stack_receipt"] = str(receipt)
        out["next"] = ("read EVERY card column by column and list each difference "
                       "from the reference, with its beat and frame pair")
    print(json.dumps(out))


if __name__ == "__main__":
    main()
