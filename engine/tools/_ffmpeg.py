"""
ffmpeg helpers with atomic write semantics.

Why this exists: a failed ffmpeg run leaves a 0-byte file at the output
path. Subsequent tools then read that 0-byte file as if it were valid and
either crash with confusing errors or silently produce garbage. We hit
this exact bug — a failed concat in a previous job left
`final_raw.mp4` empty, forced a full re-densify (~3 min wasted).

The fix: every destructive ffmpeg invocation writes to `<output>.tmp`
and atomically renames on success. On failure, the original file (if
any) is untouched.

  from _ffmpeg import run_ffmpeg_atomic

  run_ffmpeg_atomic(
      output=Path("final_raw.mp4"),
      args=[
          "-i", str(input_path),
          "-filter:v", "...",
          "-c:v", "libx264", "-preset", "medium", "-crf", "18",
          "-c:a", "aac", "-b:a", "192k",
      ],
  )

Use for:
  - silence_clip / time_stretch in densify.py
  - patch_video in patch_audio.py
  - stitch in elevenlabs.py
  - any subprocess call that produces a video/audio file the rest of the
    pipeline reads
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def run_ffmpeg_atomic(
    *,
    output: Path,
    args: list[str],
    overwrite: bool = True,
    extra_input_args: list[str] | None = None,
    timeout_sec: int | None = None,
) -> subprocess.CompletedProcess:
    """Run ffmpeg with atomic-write semantics.

    Writes to `<output>.tmp`. On exit code 0 + non-zero file size, atomically
    renames to `output`. On any failure, removes `.tmp` and leaves `output`
    untouched.

    `args` should NOT include `-y`, the input/output flags, or `-i` for the
    final output. We add those. `args` is the FILTER + ENCODER section
    (e.g. `-i input.mp4 -filter:v ... -c:v libx264 ...`).

    Returns the CompletedProcess so caller can inspect stderr if needed.
    """
    # Keep the real extension on the tmp file so ffmpeg can infer the muxer
    # (`x.mp4.tmp` fails "Unable to choose an output format"; `x.tmp.mp4` works).
    tmp_path = output.with_name(output.stem + ".tmp" + output.suffix)
    cmd = [
        "ffmpeg",
        "-y" if overwrite else "-n",
        "-loglevel", "error",
        *args,
        str(tmp_path),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)

    if res.returncode != 0:
        # Cleanup the partial .tmp before bubbling the error
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"ffmpeg failed (exit {res.returncode}). Output untouched at {output}.\n"
            f"stderr (last 800 chars):\n{res.stderr[-800:]}"
        )

    # Belt-and-suspenders: verify the .tmp is non-zero before renaming
    if not tmp_path.exists() or tmp_path.stat().st_size == 0:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"ffmpeg returned 0 but produced an empty/missing file at {tmp_path}.\n"
            f"Output untouched at {output}.\n"
            f"stderr (last 800 chars):\n{res.stderr[-800:]}"
        )

    # Atomic rename — POSIX guarantees this is all-or-nothing
    tmp_path.replace(output)
    return res


def ffprobe_duration(path: Path, timeout_sec: float | None = None) -> float:
    """Return media duration in seconds. Raises if path missing or unreadable.

    `timeout_sec` bounds the probe (raises subprocess.TimeoutExpired). Callers
    producing synchronous advisory pricing pass one so a pathological file
    cannot stall the caller.
    """
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, timeout=timeout_sec,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {res.stderr.strip()}")
    out = res.stdout.strip()
    if not out:
        raise RuntimeError(f"ffprobe produced no duration for {path} (likely 0-byte / corrupt file).")
    return float(out)
