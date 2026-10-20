"""
dense_sample.py — mechanical MOTION detector for a motion-graphics reference.

This tool DETECTS animation windows; it does not render frames for reading and does not touch
audio. On a reference that is one continuous subject with a dense motion-graphics layer on top,
a shot-cut detector finds few/zero hard cuts ("1 shot") — so there are no beat markers to hang a
read on. This tool supplies exactly that missing layer:

  • MOTION WINDOWS  decode at 5fps → per-frame mean-abs-delta motion-energy curve → threshold
                   into contiguous "something is animating" windows vs "static hold" windows.
                   That is the animation-event list a cut-less HUD video otherwise lacks.

Frame-READING is NOT this tool's job — that is `render_timeline_strip.py` (linear mode), which
tiles a 5fps filmstrip PLUS waveform, Scribe word-chips and cut/beat markers on one axis. The
intended pipeline is:

    dense_sample motion --emit   →   animation_windows.json
    render_timeline_strip --beats animation_windows.json   →   read it

`--emit` writes animation_windows.json under jobs/<job>/dense/ in the shape render_timeline_strip
consumes as --beats.

Usage:
  uv run python tools/dense_sample.py motion --job <id> --video reference/ref.mp4 [--fps-cap 5] [--emit]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from job import resolve_job_dir


def _resolve(job: str, video: str) -> tuple[Path, Path]:
    jobdir = resolve_job_dir(job)
    vp = Path(video)
    if not vp.is_absolute():
        vp = jobdir / video
    if not vp.exists():
        sys.exit(f"no such video: {vp}")
    out = jobdir / "dense"
    out.mkdir(exist_ok=True)
    return vp, out


def _decode_gray(video: Path, fps_cap: float, w: int = 120, h: int = 213):
    """Sample the video at fps_cap (5fps default) to small grayscale frames + timestamps.
    5fps is enough to locate every animation window cheaply; render_timeline_strip re-reads the
    located windows at 5–12fps with its full waveform/word/cut overlay."""
    cmd = ["ffmpeg", "-i", str(video), "-vf", f"fps={fps_cap},scale={w}:{h}",
           "-pix_fmt", "gray", "-f", "rawvideo", "-"]
    p = subprocess.run(cmd, capture_output=True)
    buf = np.frombuffer(p.stdout, dtype=np.uint8)
    n = buf.size // (w * h)
    frames = buf[: n * w * h].reshape(n, h, w).astype(np.float32)
    times = np.arange(n) / fps_cap
    return frames, times


def cmd_motion(video: Path, out: Path, fps_cap: float, emit: bool) -> None:
    frames, times = _decode_gray(video, fps_cap)
    d = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    d = np.concatenate([[0.0], d])
    dn = d / (d.max() + 1e-6)
    print(f"decoded {len(frames)} frames @ {fps_cap}fps  ({times[-1]:.2f}s)\n")

    thr = max(dn.mean() + 0.5 * dn.std(), 0.08)
    active = dn > thr
    segs, i = [], 0
    while i < len(active):
        if active[i]:
            j = i
            while j < len(active) and active[j]:
                j += 1
            segs.append((times[i], times[min(j, len(times) - 1)], float(dn[i:j].max())))
            i = j
        else:
            i += 1
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < 0.3:
            merged[-1] = (merged[-1][0], s[1], max(merged[-1][2], s[2]))
        else:
            merged.append(list(s))
    print(f"MOTION SEGMENTS (thr={thr:.3f}) — windows where graphics animate:")
    for a, b, pk in merged:
        print(f"  [{a:6.2f} → {b:6.2f}]  dur {b-a:4.2f}s   peak {pk:.2f}")

    step = max(1, round(fps_cap * 0.5))
    sec_per_col = step / fps_cap
    bins = [dn[k:k + step].max() for k in range(0, len(dn), step)]
    print(f"\nMOTION CURVE (each col ≈ {sec_per_col:.1f}s, height = motion energy):")
    blocks = "▁▂▃▄▅▆▇█"
    print("  " + "".join(blocks[min(7, int(v * 7.999))] for v in bins))
    print("  " + "".join((f"{int(k*sec_per_col)%100:>2d}" if (k % 10 == 0) else "") for k in range(len(bins))))

    if emit:
        windows = [{"id": f"anim{k:02d}", "start": round(a, 2), "end": round(b, 2)}
                   for k, (a, b, _pk) in enumerate(merged)]
        (out / "animation_windows.json").write_text(json.dumps(windows, indent=2))
        print(f"\nemitted → {out/'animation_windows.json'} ({len(windows)} windows)")
        print("feed it: render_timeline_strip.py --beats <animation_windows.json>")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("motion")
    s.add_argument("--job", required=True)
    s.add_argument("--video", required=True)
    s.add_argument("--fps-cap", type=float, default=5)
    s.add_argument("--emit", action="store_true", help="write animation_windows.json")
    a = ap.parse_args()
    video, out = _resolve(a.job, a.video)
    cmd_motion(video, out, a.fps_cap, emit=a.emit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
