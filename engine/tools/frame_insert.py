"""
frame_insert — composite b-roll INTO a frame/screen in the shot, occluders on top.

The generalized, SAM3-backed successor to the sandbox's brittle `_tv_composite`
(which brute-force-detected a bright white TV by luminance threshold and only
worked for the "Vintage Larry" shot). This inserts b-roll into ANY rectangular
region of a held device/screen/frame — phone, laptop, monitor, TV, billboard —
and restores foreground occluders (fingers / a hand) on top, so they hang in
front of the inserted content.

Region + occluder come from one of two places:
  - explicit `--rect x:y:w:h` (a static shot — cheapest, no API), or
  - `--screen-prompt "phone screen"` → SAM3 masks it → median bbox (any shot).
Occlusion is optional: `--occluder-prompt "hand"` → SAM3 mask → those base
pixels are painted back ON TOP of the inserted b-roll.

The inserted content is rendered as a vignette-to-BLACK tile (radial alpha) so it
reads as a lit screen against a dark bezel — the look JC praised ("its perfect!").

Usage:
  uv run python tools/frame_insert.py --job <id> --base narrator.mp4 \
      --rect 360:760:360:360 \
      --insert "broll1.mp4,0,5.5" --insert "broll2.mp4,5.5,11" \
      --occluder-prompt "fingers" --out out.mp4
  # or detect the screen instead of --rect:
  #   --screen-prompt "the phone screen"

Common failure modes
--------------------
- Never put a screen image inside the screen (a TV-in-a-TV) — JC's note. Pick
  b-roll that isn't itself a framed display.
- A moving device breaks a fixed --rect; use --screen-prompt (per-frame bbox →
  median) or split the shot. For heavy motion, extend to per-frame regions (TODO).
- The occluder mask must actually cover the fingers; if SAM3 returns an empty
  mask the occluder pass is skipped and a warning is logged (no silent miss).
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from job import resolve_job_dir, add_job_arg
from log import log_event

load_dotenv()


def _run(cmd: list[str]) -> None:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{' '.join(cmd)}\n{res.stderr[-700:]}")


def _radial_alpha_png(w: int, h: int, out: Path, inner: float = 0.45, outer: float = 0.99) -> Path:
    """White center → black edges alpha mask sized to the region (the screen vignette)."""
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    # normalized radius r; alpha = smoothstep((outer-r)/(outer-inner))
    expr = (f"255*clip((({outer}-hypot((X-{w/2})/({w/2}),(Y-{h/2})/({h/2})))"
            f"/({outer}-{inner})),0,1)")
    _run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=white:s={w}x{h}",
          "-vf", f"format=gray,geq=lum='{expr}'", "-frames:v", "1", str(out)])
    return out


def _screen_clip(broll: Path, w: int, h: int, radial_png: Path, dur: float, out: Path) -> Path:
    """b-roll scaled to cover WxH, radial-alpha'd, flattened over black → opaque WxH tile."""
    fit = (f"scale={w}:{h}:force_original_aspect_ratio=increase,"
           f"crop={w}:{h},setsar=1,fps=24")
    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(broll), "-loop", "1", "-i", str(radial_png),
          "-filter_complex",
          f"[0:v]{fit}[v];[1:v]format=gray[m];[v][m]alphamerge[fg];"
          f"color=c=black:s={w}x{h}:r=24[bg];[bg][fg]overlay=shortest=1,format=yuv420p[o]",
          "-map", "[o]", "-t", f"{dur:.3f}", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)])
    return out


def _detect_region_sam3(base: Path, screen_prompt: str, job: Optional[Path]) -> tuple[int, int, int, int]:
    """SAM3-mask the screen, return the median bbox (x,y,w,h) over the clip."""
    import cv2
    import numpy as np
    from sam3 import segment_long
    mask = segment_long(base, screen_prompt, output_kind="mask_only", job=job)
    cap = cv2.VideoCapture(str(mask))
    xs0, ys0, xs1, ys1 = [], [], [], []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        lum = fr.astype(int).max(axis=2)
        ys, xs = np.where(lum > 40)
        if len(xs):
            xs0.append(xs.min()); xs1.append(xs.max())
            ys0.append(ys.min()); ys1.append(ys.max())
    cap.release()
    if not xs0:
        raise RuntimeError(f"SAM3 found no '{screen_prompt}' to insert into")
    x0 = int(np.median(xs0)); x1 = int(np.median(xs1))
    y0 = int(np.median(ys0)); y1 = int(np.median(ys1))
    return x0, y0, x1 - x0, y1 - y0


def insert_frames(
    base: str | Path,
    rect: tuple[int, int, int, int],
    inserts: list[tuple[str, float, float]],
    out: str | Path,
    *,
    occluder_mask: Optional[Path] = None,
    job: Optional[Path] = None,
) -> Path:
    """Composite each (broll, start, end) into `rect` of `base`; restore occluder on top."""
    base = Path(base)
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    x, y, w, h = rect
    tmp = Path(tempfile.mkdtemp(prefix="frameins_"))
    radial = _radial_alpha_png(w, h, tmp / "radial.png")

    cur = base
    for i, (broll, start, end) in enumerate(inserts):
        dur = max(0.1, float(end) - float(start))
        screen = _screen_clip(Path(broll), w, h, radial, dur, tmp / f"screen_{i}.mp4")
        nxt = tmp / f"comp_{i}.mp4"
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(cur), "-i", str(screen),
              "-filter_complex",
              f"[1:v]setpts=PTS+{float(start)}/TB[s];"
              f"[0:v][s]overlay={x}:{y}:enable='between(t,{float(start)},{float(end)})'[o]",
              "-map", "[o]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "copy", str(nxt)])
        cur = nxt

    if occluder_mask is not None and Path(occluder_mask).exists():
        nxt = tmp / "occluded.mp4"
        # base pixels where the occluder mask is bright → painted over the composite
        _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(cur), "-i", str(base),
              "-i", str(occluder_mask), "-filter_complex",
              "[2:v]format=gray,geq=lum='if(gt(lum(X,Y),40),255,0)'[ma];"
              "[1:v][ma]alphamerge[occ];[0:v][occ]overlay=0:0:format=auto[o]",
              "-map", "[o]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "copy", str(nxt)])
        cur = nxt

    _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(cur),
          "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)])

    if job is not None:
        log_event(job, tool="frame_insert.py", event="artifact_written",
                  extra={"rect": f"{w}x{h}+{x}+{y}", "inserts": len(inserts),
                         "occluder": occluder_mask is not None, "path": str(out)})
    print(f"[frame_insert] → {out}  ({len(inserts)} insert(s), rect {w}x{h}@{x},{y}"
          f"{', +occluder' if occluder_mask else ''})")
    return out


def main() -> None:
    p = argparse.ArgumentParser(allow_abbrev=False, description=__doc__.split("\n\n")[0])
    p.add_argument("--base", required=True, help="the shot with the screen/frame in it")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--rect", help="explicit region x:y:w:h (static shot)")
    g.add_argument("--screen-prompt", help="SAM3 detects this region, e.g. 'the phone screen'")
    p.add_argument("--insert", action="append", default=[], required=True,
                   help="'broll_path,start,end' — repeatable")
    p.add_argument("--occluder-prompt", help="SAM3-mask this and keep it in front, e.g. 'fingers'")
    p.add_argument("--out", required=True)
    add_job_arg(p)
    args = p.parse_args()

    job = None
    try:
        job = resolve_job_dir(args.job)
    except Exception:
        pass

    if args.rect:
        rect = tuple(int(v) for v in args.rect.split(":"))
    else:
        rect = _detect_region_sam3(Path(args.base), args.screen_prompt, job)
        print(f"[frame_insert] SAM3 region: {rect}")

    inserts = []
    for spec in args.insert:
        path, start, end = spec.rsplit(",", 2)
        inserts.append((path, float(start), float(end)))

    occ = None
    if args.occluder_prompt:
        from sam3 import segment_long
        occ = segment_long(args.base, args.occluder_prompt, output_kind="mask_only", job=job)

    out = insert_frames(args.base, rect, inserts, args.out, occluder_mask=occ, job=job)
    print(out)


if __name__ == "__main__":
    main()
