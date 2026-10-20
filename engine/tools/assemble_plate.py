"""
assemble_plate.py — build the SUBJECT PLATE (final_raw.mp4): the moving base the graphics
layer sits on top of, for a continuous single-subject clone (a morph / before-after / talking
bust). It chains registered stills + minted clips with skin-only crossfades (no size jump,
because reframe.py already put them at one canonical size), then bakes a GLOBAL ZOOM ENVELOPE
(push-ins on the analysis beats) about the frame centre. The same keyframes are written to
zoom_kf.json so the overlay layer can track on-subject graphics (boxes/dots/arrows) to them.

This is for the SINGLE-subject base only. Multi-element beats (two-up comparisons, an abstract
graphic, graphics-only, the CTA) are NOT built here — they are composited in the overlay layer
over this plate (or over the flat bg where the plate holds nothing).

Driven entirely by jobs/<job>/plate.json — nothing is hardcoded. Schema:
{
  "canvas": [1080, 1920],
  "fps": 30,
  "aligned_dir": "images/aligned",          // where reframe.py wrote the registered stills
  "out": "final_raw.mp4",
  "segments": [                              // played in order, crossfaded by `xf` seconds
    {"label": "hook",   "kind": "still", "src": "state_heavy.png",    "dur": 6.01, "xf": 0.25},
    {"label": "reset",  "kind": "reset", "from": "state_heavy.png",
                                          "to": "state_baseline.png",  "dur": 0.59, "xf": 0.05},
    {"label": "clip_a", "kind": "clip",  "src": "clips/aligned/morph_a.mp4", "xf": 0.20}
  ],
  "zoom_kf": [[0.0,1.05],[0.6,1.05],[6.0,1.16],[6.46,1.16],[7.05,1.05]]   // [t_sec, zoom]
}
- kind "still": loop a registered still for `dur` seconds.
- kind "reset": a `from`→`to` skin crossfade over `dur` (same size, no ghost).
- kind "clip":  use a minted/registered clip verbatim (its own duration; `dur` optional/ignored).

Usage: uv run python tools/assemble_plate.py --job <id>
"""
from __future__ import annotations
import argparse, subprocess, sys, json
from pathlib import Path

from job import resolve_job_dir


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FFMPEG ERR:\n", r.stderr[-1500:]); sys.exit(1)
    return r


def _dur(path: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout.strip())


def still_seg(src, dur, out, W, H, FPS):
    run(["ffmpeg", "-y", "-framerate", str(FPS), "-loop", "1", "-t", f"{dur}", "-i", str(src),
         "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p",
         "-r", str(FPS), "-an", str(out)])


def reset_seg(a_img, b_img, dur, out, W, H, FPS, tmp):
    av, bv = tmp / "_reset_a.mp4", tmp / "_reset_b.mp4"
    still_seg(a_img, dur + 0.05, av, W, H, FPS)
    still_seg(b_img, dur + 0.05, bv, W, H, FPS)
    run(["ffmpeg", "-y", "-i", str(av), "-i", str(bv), "-filter_complex",
         f"[0:v][1:v]xfade=transition=fade:duration={dur}:offset=0[o]", "-map", "[o]",
         "-r", str(FPS), "-an", str(out)])


def clip_seg(src, out, W, H, FPS):
    run(["ffmpeg", "-y", "-i", str(src),
         "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p",
         "-r", str(FPS), "-an", str(out)])


def zoom_expr(kf, FPS) -> str:
    segs = []
    for (t0, z0), (t1, z1) in zip(kf, kf[1:]):
        f0, f1 = t0 * FPS, t1 * FPS
        segs.append((f0, f1, f"({z0}+({z1 - z0})*(on-{f0})/{f1 - f0})"))
    expr = str(kf[-1][1])
    for f0, f1, lerp in reversed(segs):
        expr = f"if(between(on,{f0},{f1}),{lerp},{expr})"
    return expr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    a = ap.parse_args()
    jobdir = resolve_job_dir(a.job)
    spec_p = jobdir / "plate.json"
    if not spec_p.exists():
        sys.exit(f"no plate.json: {spec_p}  (author it — schema in the tool docstring)")
    spec = json.loads(spec_p.read_text())
    W, H = spec.get("canvas", [1080, 1920])
    FPS = spec.get("fps", 30)
    adir = jobdir / spec.get("aligned_dir", "images/aligned")
    tmp = jobdir / "_plate"; tmp.mkdir(exist_ok=True)
    segments = spec["segments"]

    built = []
    for i, seg in enumerate(segments):
        out = tmp / f"seg_{i:02d}_{seg['label']}.mp4"
        if seg["kind"] == "still":
            still_seg(adir / seg["src"], seg["dur"], out, W, H, FPS)
            dur = seg["dur"]
        elif seg["kind"] == "reset":
            reset_seg(adir / seg["from"], adir / seg["to"], seg["dur"], out, W, H, FPS, tmp)
            dur = seg["dur"]
        elif seg["kind"] == "clip":
            clip_seg(jobdir / seg["src"], out, W, H, FPS)
            dur = _dur(out)
        else:
            sys.exit(f"unknown segment kind: {seg['kind']}")
        built.append((out, dur))

    inputs = []
    for out, _ in built:
        inputs += ["-i", str(out)]
    filt = []; prev = "0:v"; cum = built[0][1]
    for i in range(1, len(built)):
        xf = segments[i].get("xf", 0.1); offset = cum - xf
        filt.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={xf:.3f}:offset={offset:.3f}[x{i}]")
        print(f"  seg {i} {segments[i]['label']:16s} morph@{offset:.2f}")
        prev = f"x{i}"; cum = cum + built[i][1] - xf
    flat = tmp / "_flat_plate.mp4"
    run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filt) if filt else "[0:v]copy[x0]",
         "-map", f"[{prev}]" if filt else "[x0]",
         "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(flat)])

    out_path = jobdir / spec.get("out", "final_raw.mp4")
    kf = spec.get("zoom_kf")
    if kf:
        z = zoom_expr(kf, FPS)
        vf = (f"scale={int(W*1.4)}:{int(H*1.4)},"
              f"zoompan=z='{z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},format=yuv420p")
        run(["ffmpeg", "-y", "-i", str(flat), "-vf", vf, "-r", str(FPS),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out_path)])
        (jobdir / "zoom_kf.json").write_text(json.dumps({"center": [W // 2, H // 2], "kf": kf}))
    else:
        run(["ffmpeg", "-y", "-i", str(flat), "-c", "copy", str(out_path)])
    print(f"→ {out_path}  ({_dur(out_path):.2f}s)" + ("  · zoom_kf.json written" if kf else ""))


if __name__ == "__main__":
    main()
