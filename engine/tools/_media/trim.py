"""Materialize a search hit into an actual file (the only time bytes are copied).

Video hit → ffmpeg trim [in,out] from the source. Still hit → copy the image.
The library stores pointers; this is where a hit becomes a usable clip/still.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from chunker import ffmpeg_bin  # type: ignore


def _fmt(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m:02d}m{s:02d}s"


def trim_video_hit(source_file: str, in_s: float, out_s: float, out_dir: Path,
                   *, stem: str | None = None, accurate: bool = False) -> Path:
    """Cut [in_s, out_s] from source_file into out_dir.

    Default (accurate=False): input-seek + stream COPY — near-instant, no re-encode.
    Cuts at the nearest keyframe ≤ in_s (may start up to a GOP early), which is fine for
    previewing/selecting b-roll and avoids the multi-minute re-encode on 4K sources.
    accurate=True: frame-accurate re-encode (slow on 4K) — use when the exact in/out matters.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    src = Path(source_file)
    name = stem or f"match_{src.stem}_{_fmt(in_s)}-{_fmt(out_s)}"
    out = out_dir / f"{name}.mp4"
    dur = max(0.1, out_s - in_s)
    if accurate:
        cmd = [ffmpeg_bin(), "-y", "-loglevel", "error",
               "-ss", f"{in_s:.3f}", "-to", f"{out_s:.3f}", "-i", source_file,
               "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
               "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)]
    else:
        cmd = [ffmpeg_bin(), "-y", "-loglevel", "error",
               "-ss", f"{in_s:.3f}", "-i", source_file, "-t", f"{dur:.3f}",
               "-c", "copy", "-avoid_negative_ts", "make_zero", str(out)]
    subprocess.run(cmd, check=True)
    return out


def copy_image_hit(source_file: str, out_dir: Path, *, stem: str | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    src = Path(source_file)
    out = out_dir / f"{stem or 'match_' + src.stem}{src.suffix}"
    shutil.copy2(src, out)
    return out
