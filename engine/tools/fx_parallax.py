"""
fx_parallax — TRUE 2.5D parallax from a single still, driven by a DEPTH MAP.

Why depth-map (not 2 flat cutouts): a depth map gives CONTINUOUS planes —
foreground, midground, background each move at their own speed on a pan, and on a
push-in the NEAR plane zooms more than the far plane (so the foreground can scale
out of frame). That's what reads as real 3D; two flat layers don't.

Pipeline: fit still -> depth map from the VideoClaw gateway (`depth_map`, mode
`estimate`, params.image = the uploaded still: Depth Anything, ONE fixed-price
call per still, one PNG back) -> per-frame local
cv2.remap warp where displacement & extra-zoom scale with depth -> mp4.

The depth map is saved in the job (depth/<image digest>.png) and reused, so
re-running with other tunables on the same still costs nothing. No local ML
model or PyTorch is needed (videoclaw#296).

  uv run python tools/fx_parallax.py --job <id> --image <still.png> --out <clip.mp4>

Tunables: --pan (px of far↔near parallax on the pan), --znear (extra zoom on the
foreground → how aggressively it exits on the push), --zbase (global push),
--seconds, --fps.
"""
import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from _gateway import gateway
from job import add_job_arg, resolve_job_dir, resolve_job_input_path, resolve_job_output_path

DEPTH_TOOL = "depth_map"
DEPTH_MODE = "estimate"


def _depth_path(job: Path, image: Path) -> Path:
    """One depth map per distinct still, keyed by its bytes."""
    digest = hashlib.sha256(image.read_bytes()).hexdigest()[:16]
    return job / "depth" / f"{digest}.png"


def fetch_depth(job: Path, image: Path) -> Path:
    """Return the still's depth map PNG, buying it once through the gateway."""
    out = _depth_path(job, image)
    if out.is_file():
        print(f"[fx_parallax] reusing depth map {out.relative_to(job)} (no charge)")
        return out
    if not gateway.enabled():
        raise SystemExit("fx_parallax gets its depth map from the VideoClaw gateway; "
                         "VIDEOCLAW_API_KEY is not set")
    out.parent.mkdir(parents=True, exist_ok=True)
    # The route takes exactly one uploaded still in params.image (no references).
    res = gateway.run(DEPTH_TOOL, mode=DEPTH_MODE, params={"image": gateway.upload(image)},
                      job=job, timeout_s=600, _delivery=[out])
    assets = res.get("assets") or []
    if not assets:
        raise SystemExit(f"[fx_parallax] gateway returned no depth map (status={res.get('status')})")
    gateway.download_asset(assets[0], out)
    return out


def load_depth(path: Path, size: tuple[int, int], fitted: tuple[int, int, int, int]) -> np.ndarray:
    """Depth aligned with the fitted still: near = 1, far = 0.

    The PNG is read as brighter = nearer (Depth Anything's relative depth),
    whatever its bit depth. ``size`` is the scaled still before the crop and
    ``fitted`` the crop box (left, top, width, height).
    """
    with Image.open(path) as depth_image:
        if depth_image.mode not in ("I", "I;16", "F"):
            depth_image = depth_image.convert("L")
        depth = np.asarray(depth_image, dtype=np.float32)
    depth = cv2.resize(depth, size, interpolation=cv2.INTER_LINEAR)
    left, top, width, height = fitted
    depth = depth[top:top + height, left:left + width]
    depth = (depth - depth.min()) / (np.ptp(depth) + 1e-6)
    return cv2.GaussianBlur(depth, (0, 0), 6)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="2.5D parallax clip from one still. The depth map is one fixed-price "
                    "VideoClaw gateway call per still (reused on re-runs); the warp is local.")
    add_job_arg(ap)
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--w", type=int, default=1080)
    ap.add_argument("--h", type=int, default=1920)
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--pan", type=float, default=90.0, help="px of far↔near parallax shift on the pan")
    ap.add_argument("--zbase", type=float, default=0.10, help="global push-in over the clip")
    ap.add_argument("--znear", type=float, default=0.55, help="extra zoom on NEAR pixels (fg exits frame)")
    a = ap.parse_args()
    job = resolve_job_dir(a.job)
    image = resolve_job_input_path(a.image, job)
    if not image.is_file():
        raise SystemExit(f"--image not found: {image}")
    try:
        out = resolve_job_output_path(a.out, job)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    W, H = a.w, a.h
    tmp = out.with_suffix(""); frames = tmp.parent / (tmp.name + "_frames"); frames.mkdir(parents=True, exist_ok=True)

    # 1. fit
    img = Image.open(image).convert("RGB")
    s = max(W/img.width, H/img.height)
    scaled = (round(img.width*s), round(img.height*s))
    img = img.resize(scaled, Image.LANCZOS)
    l=(img.width-W)//2; t=(img.height-H)//2; img = img.crop((l, t, l+W, t+H))
    base = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR).astype(np.float32)

    # 2. depth (near=1) of the whole still, fitted exactly like the picture
    depth = load_depth(fetch_depth(job, image), scaled, (l, t, W, H))

    # 3. warp per frame
    N = int(a.seconds*a.fps); cx, cy = W/2, H/2
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    for f in range(N):
        tt = f/(N-1)
        dx = a.pan*np.sin(tt*np.pi)
        zmap = (1.0 + a.zbase*tt) * (1.0 + a.znear*depth*tt)
        sx = (xs-cx)/zmap + cx - dx*depth
        sy = (ys-cy)/zmap + cy
        frame = cv2.remap(base, sx.astype(np.float32), sy.astype(np.float32),
                          cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        cv2.imwrite(str(frames/f"f_{f:03d}.png"), frame)

    subprocess.run(["ffmpeg","-y","-loglevel","error","-framerate",str(a.fps),
                    "-i",str(frames/"f_%03d.png"),"-c:v","libx264","-pix_fmt","yuv420p", str(out)], check=True)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
