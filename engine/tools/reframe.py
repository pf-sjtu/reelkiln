"""
reframe.py — register subject assets (stills and/or minted clips) to ONE canonical size +
position, matched to the reference framing. Use this ONLY for beats where the reference holds
the subject at a FIXED size/position (a continuous single-subject morph or a talking bust):
registration guarantees the state transitions change ONLY the subject's condition (skin, age,
before/after) with no size/position jump → no ghosting, and it gives the graphics headroom.

DO NOT force-register beats where the subject moves, is off-center, appears at multiple sizes,
sits in a two-up comparison, or is absent (an abstract graphic / graphics-only beat). Those are
placed per-beat in the overlay/composite layer, not here. (See the workflow's Stage 3.)

Geometry is per-reference — measure it off the ref frames and pass it in:
  --face-w   target Haar face-box width in px (≈ REF face-% × canvas width)
  --face-cx/cy  where the face-box CENTER should land on the canvas
  --bg       matte/fill color "R,G,B"          --canvas  "WxH"

Inputs default to every top-level PNG in jobs/<job>/images/ → images/aligned/. Pass explicit
--stills / --clips to scope it. Clips get a fixed transform from one probed frame.

Usage:
  uv run python tools/reframe.py --job <id> --stills state_baseline.png state_heavy.png \
    --face-w 605 --face-cx 540 --face-cy 990 --bg 165,182,194 --canvas 1080x1920
"""
from __future__ import annotations
import argparse, subprocess
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageFilter

from job import resolve_job_dir

_fc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def detect_face(img_bgr):
    g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    faces = _fc.detectMultiScale(g, 1.1, 5, minSize=(120, 120))
    if len(faces) == 0:
        return None
    x, y, w, h = sorted(faces, key=lambda f: -f[2] * f[3])[0]
    return x + w / 2, y + h / 2, w


def subject_alpha(rgb: np.ndarray, bg, thr=42.0, feather=1.5) -> Image.Image:
    """Matte the subject: keep the LARGEST connected non-bg component with its interior
    holes filled, everything else → bg. Keeps dull/aged interior skin (no bg bleed-through)
    and drops stray near-bg islands a plain border flood-fill would leave."""
    d = np.sqrt(((rgb.astype(np.float32) - np.array(bg, np.float32)) ** 2).sum(2))
    subj = (d >= thr).astype(np.uint8)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(subj, 8)
    if n <= 1:
        return Image.fromarray(np.zeros(d.shape, np.uint8))
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    person = (lbl == largest).astype(np.uint8)
    ff = person.copy()
    cv2.floodFill(ff, np.zeros((person.shape[0] + 2, person.shape[1] + 2), np.uint8), (0, 0), 2)
    filled = ((person == 1) | (ff == 0)).astype(np.uint8) * 255
    return Image.fromarray(filled).filter(ImageFilter.GaussianBlur(feather))


def _compose(rgb, scale, ox, oy, W, H, bg) -> Image.Image:
    pil = Image.fromarray(rgb).convert("RGB")
    pil.putalpha(subject_alpha(rgb, bg))
    pil = pil.resize((int(round(pil.width * scale)), int(round(pil.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), bg)
    canvas.paste(pil, (ox, oy), pil)
    return canvas


def reframe_still(src: Path, dst: Path, geo):
    W, H, bg, FACE_W, FACE_CX, FACE_CY = geo
    img = cv2.imread(str(src))
    if img is None:
        print("  !! unreadable", src.name); return
    d = detect_face(img)
    if not d:
        print("  !! no face in", src.name); return
    cx, cy, fw = d
    scale = FACE_W / fw
    rgb = np.asarray(Image.open(src).convert("RGB"))
    ox = int(round(FACE_CX - cx * scale)); oy = int(round(FACE_CY - cy * scale))
    dst.parent.mkdir(parents=True, exist_ok=True)
    _compose(rgb, scale, ox, oy, W, H, bg).save(dst)
    print(f"  {src.name:28s} scale={scale:.3f} off=({ox},{oy}) → {dst.name}")


def reframe_video(src: Path, dst: Path, geo, probe_t: float = 2.5):
    W, H, bg, FACE_W, FACE_CX, FACE_CY = geo
    cap = cv2.VideoCapture(str(src))
    cap.set(cv2.CAP_PROP_POS_MSEC, probe_t * 1000)
    ok, fr = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_MSEC, 500); ok, fr = cap.read()
    d = detect_face(fr) if ok else None
    if not d:
        print("  !! no face in", src.name); cap.release(); return
    cx, cy, fw = d
    scale = FACE_W / fw
    ox = int(round(FACE_CX - cx * scale)); oy = int(round(FACE_CY - cy * scale))
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", "30", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(dst)],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    n = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
        proc.stdin.write(np.asarray(_compose(rgb, scale, ox, oy, W, H, bg)).tobytes())
        n += 1
    cap.release(); proc.stdin.close(); proc.wait()
    print(f"  {src.name:30s} scale={scale:.3f} off=({ox},{oy}) {n}f → {dst.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--stills", nargs="*", default=None, help="PNG basenames under images/ (default: all)")
    ap.add_argument("--clips", nargs="*", default=None, help="clip paths (job-relative)")
    ap.add_argument("--face-w", type=float, default=605)
    ap.add_argument("--face-cx", type=float, default=540)
    ap.add_argument("--face-cy", type=float, default=990)
    ap.add_argument("--bg", default="165,182,194")
    ap.add_argument("--canvas", default="1080x1920")
    a = ap.parse_args()
    jobdir = resolve_job_dir(a.job)
    W, H = (int(x) for x in a.canvas.lower().split("x"))
    bg = tuple(int(x) for x in a.bg.split(","))
    geo = (W, H, bg, a.face_w, a.face_cx, a.face_cy)

    stills = a.stills
    if stills is None and a.clips is None:
        stills = [p.name for p in sorted((jobdir / "images").glob("*.png"))]
    if stills:
        print("stills →")
        for s in stills:
            reframe_still(jobdir / "images" / s, jobdir / "images/aligned" / s, geo)
    if a.clips:
        print("clips →")
        for c in a.clips:
            src = jobdir / c
            reframe_video(src, jobdir / "clips/aligned" / src.name, geo)


if __name__ == "__main__":
    main()
