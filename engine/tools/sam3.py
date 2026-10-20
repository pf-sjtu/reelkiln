"""
sam3 — text-prompted video segmentation: the SEPARATION primitive.

Wraps Replicate `lucataco/sam3-video` to produce a per-frame mask of any
text-prompted entity in a video ("person", "the phone screen", "the hand").
That mask is the enabling layer for a whole family of edits the kit otherwise
fakes with colorkey/depth-maps:
  - subject-locked vertical REFRAME (the keystone — `reframe` below)
  - cut-out / corner-PIP (mask the subject → composite elsewhere)
  - background-only treatment (blur/desaturate the bg, keep the human full-color)
  - occlusion (keep fingers in front of an inserted screen — see frame_insert.py)
  - highlight / outline / spotlight / reveal / parallax planes

Two entrypoints:
  segment   — run SAM3, save the mask (or overlay) video.            [the primitive]
  reframe   — SAM3-locate the subject → fixed subject-centered 9:16 crop.  [keystone recipe]

Every Replicate call goes through replicate_safe.safe_run (hard timeout +
auto-cancel/retry + cost logging). DUAL MODE: when VIDEOCLAW_API_KEY is set the
same call routes through the videoclaw gateway instead (see tools/_gateway.py);
without it, the raw Replicate path runs unchanged. Results are content-addressed by
(video_sha + prompt + window + kind) so identical requests reuse the prior file.
`--regen` buys a new take of the same mask: it replaces the file, and the old
mask moves to <job>/previous_takes/<UTC time>/masks/ (videoclaw#283).

Usage (CLI):
  uv run python tools/sam3.py segment --job <id> --video <path|url> --prompt "person" \
      --start 0 --end 5 --output-kind mask_only
  uv run python tools/sam3.py reframe --job <id> --video <path> --prompt "person" \
      --out <job>/cuts/clip1_vertical.mp4

Common failure modes
--------------------
- SLOW: ~5s of compute per 1s of input. ALWAYS clip with --start/--end to the
  beat you need; never send a whole long take.
- A remote URL can't be clipped locally — pass a local file to use --start/--end.
- reframe needs a subject the mask actually finds; if the mask is empty the crop
  falls back to a centered crop and logs a warning (don't silently mislead).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Literal, Optional

import requests
from dotenv import load_dotenv

from job import resolve_job_dir, add_job_arg
from log import log_event
from replicate_safe import safe_run
from _gateway import gateway, GatewayNotSubmittedError  # dual mode: VIDEOCLAW_API_KEY set → gateway routes the call
from _takes import PaidTake, write_atomic

load_dotenv()

SAM3_MODEL = "lucataco/sam3-video:408f82fc20c300aac5d61d2e34ddb34cd0181e810e9f609d250aed14d5f81269"
OutputKind = Literal["overlay", "mask_only", "zip"]


def _slug(s: str, n: int = 30) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", s.lower()).strip("-")[:n] or "x"


def _sha_of_file(path: Path, n: int = 12) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:n]


def _clip_video(src: Path, start: Optional[float], end: Optional[float]) -> Path:
    if start is None and end is None:
        return src
    s = float(start or 0.0)
    e = float(end) if end is not None else None
    out = src.parent / "_sam3_clips" / f"{src.stem}__clip_{s:.2f}_{e if e is not None else 'end'}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size > 1000:
        return out
    # ALWAYS re-encode — stream-copy ("-c copy") clips start mid-GOP and the
    # segmentation model can't decode them ("Could not load frames from video").
    # -ss before -i = fast seek; -t is a DURATION (input-seek resets timestamps).
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{s:.3f}", "-i", str(src)]
    if e is not None:
        cmd += ["-t", f"{e - s:.3f}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", str(out)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg clip failed: {res.stderr[-500:]}")
    return out


def segment_video(
    video: str | Path,
    prompt: str,
    *,
    start: Optional[float] = None,
    end: Optional[float] = None,
    output_kind: OutputKind = "mask_only",
    mask_color: str = "green",
    mask_opacity: float = 1.0,
    job: Optional[Path] = None,
    regen: bool = False,
) -> Path:
    """Run SAM3 on a (clipped) video and return the local path of the result."""
    if isinstance(video, str) and video.startswith(("http://", "https://")):
        api_video = video
        cache_video = video
        local_clip = None
    else:
        local = Path(video)
        if not local.exists():
            raise FileNotFoundError(f"video not found: {local}")
        local_clip = _clip_video(local, start, end)
        # Gateway mode uploads the clip lazily (only after a cache miss);
        # raw mode opens a handle for the Replicate SDK to stream.
        api_video = None if gateway.enabled() else open(local_clip, "rb")
        cache_video = _sha_of_file(local_clip)

    cache_key = hashlib.sha1("|".join([
        str(cache_video), _slug(prompt, 40), str(start), str(end),
        output_kind, mask_color, str(mask_opacity),
    ]).encode()).hexdigest()[:12]

    out_dir = (job / "masks") if job is not None else (
        Path(local_clip.parent if local_clip else ".") / "_sam3_out")
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = "zip" if output_kind == "zip" else "mp4"
    out_path = out_dir / f"sam3__{_slug(prompt, 30)}__{cache_key}.{ext}"

    if out_path.exists() and out_path.stat().st_size > 1000 and not regen:
        print(f"[sam3] cache hit → {out_path}")
        if hasattr(api_video, "close"):
            api_video.close()
        return out_path

    # The paid mask lands in a take owned by this request, then replaces
    # out_path and keeps the old mask (videoclaw#283). A re-run of the same
    # request publishes a take an interrupted run already paid for.
    take = PaidTake(job, [out_path], {"model": SAM3_MODEL, "cache_key": cache_key}, tool="sam3.py")
    try:
        with take.hold():
            reused = take.ready()
            if reused:
                print("[sam3] reusing the paid mask of an interrupted run (nothing charged now)")
            else:
                _buy_mask(take, api_video, local_clip, prompt, output_kind, mask_color,
                          mask_opacity, job)
            kept = take.publish() or []
    finally:
        if hasattr(api_video, "close"):
            api_video.close()

    if job is not None:
        rel = str(out_path.relative_to(job)) if out_path.is_relative_to(job) else str(out_path)
        assert out_path.is_relative_to(job), f"Wrote outside job dir: {out_path}"
        log_event(job, tool="sam3.py", event="segment_artifact_written",
                  extra={"prompt": prompt, "kind": output_kind, "start_sec": start,
                         "end_sec": end, "path": rel, "size_bytes": out_path.stat().st_size,
                         **({"reused_paid_take": True} if reused else {}),
                         **({"previous_take": [str(p.relative_to(take.root)) for p in kept]}
                            if kept else {})})
    print(f"[sam3] saved {out_path.name} ({out_path.stat().st_size // 1024}KB)")
    for path in kept:
        print(f"[sam3] previous take kept → {path}")
    return out_path


def _buy_mask(take: PaidTake, api_video, local_clip: Optional[Path], prompt: str,
              output_kind: OutputKind, mask_color: str, mask_opacity: float,
              job: Optional[Path]) -> None:
    """The one paid SAM3 call; saves its result as ``take``."""
    destination = take.paths[0]
    print(f"[sam3] segmenting prompt={prompt!r} kind={output_kind} ...")
    inp = {
        "video": api_video,
        "prompt": prompt,
        "mask_only": output_kind == "mask_only",
        "mask_color": mask_color,
        "return_zip": output_kind == "zip",
        "mask_opacity": mask_opacity,
    }
    if gateway.enabled():
        # DUAL MODE: VIDEOCLAW_API_KEY set → route via the gateway. Same engine
        # input dict as the raw path; the local clip becomes an "upload:<id>"
        # reference at the exact field, which the server deep-resolves.
        if local_clip is not None:
            inp["video"] = gateway.upload(local_clip)
        # job=job → the gateway client logs the single cost event (gateway_call
        # with the metered estimate_usd), mirroring safe_run's one-record raw path.
        try:
            res = gateway.run("sam3", mode="segment", params=inp, job=job,
                              timeout_s=900, _delivery=take.paths)
        except GatewayNotSubmittedError as exc:
            raise take.refusal(exc) from exc
        assets = res.get("assets") or []
        if assets:
            gateway.download_asset(assets[0], destination)
        else:
            # No asset — mirror the raw path's URL fallback on structured output.
            out = res.get("output")
            url = out[0] if isinstance(out, list) and out else out
            if not (isinstance(url, str) and url.startswith("http")):
                raise RuntimeError(
                    f"gateway sam3/segment returned no downloadable asset: {out!r}")
            gateway.download(url, destination)
        return
    output = safe_run(SAM3_MODEL, inp, job=job, tool="sam3.py", estimate_usd=0.05)
    url = output[0] if isinstance(output, list) else (
        output.url if hasattr(output, "url") else str(output))
    resp = requests.get(url, timeout=600)
    resp.raise_for_status()
    write_atomic(destination, resp.content)


def _probe_dur(path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def segment_long(
    video: str | Path,
    prompt: str,
    *,
    max_chunk: float = 30.0,
    output_kind: OutputKind = "mask_only",
    mask_color: str = "green",
    mask_opacity: float = 1.0,
    job: Optional[Path] = None,
    regen: bool = False,
) -> Path:
    """SAM3 on an ARBITRARILY-LONG clip — the split/segment/re-merge harness.

    The model fails past ~30–60s (`E8765` "Director: unexpected error" on a 77s clip;
    30s verified OK 2026-07-01). This splits a long clip into ≤`max_chunk` windows,
    segments each, and concatenates the per-window masks into ONE continuous mask
    matching the full timeline. A short clip (or a remote URL, which can't be clipped
    locally) falls through to a single `segment_video` call — so this is a safe drop-in
    replacement for `segment_video` everywhere.
    """
    import math
    if isinstance(video, str) and video.startswith(("http://", "https://")):
        return segment_video(video, prompt, output_kind=output_kind, mask_color=mask_color,
                             mask_opacity=mask_opacity, job=job, regen=regen)
    dur = _probe_dur(video)
    if dur <= max_chunk + 1.0:
        return segment_video(video, prompt, output_kind=output_kind, mask_color=mask_color,
                             mask_opacity=mask_opacity, job=job, regen=regen)

    n = math.ceil(dur / max_chunk)
    step = dur / n
    print(f"[sam3] long clip {dur:.1f}s > {max_chunk:.0f}s max → {n} chunks of ~{step:.1f}s")
    parts = []
    for i in range(n):
        s = round(i * step, 3)
        e = round(min(dur, (i + 1) * step), 3)
        parts.append(segment_video(video, prompt, start=s, end=e, output_kind=output_kind,
                                   mask_color=mask_color, mask_opacity=mask_opacity,
                                   job=job, regen=regen))

    out_dir = (job / "masks") if job is not None else Path(parts[0]).parent
    key = hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]
    ext = "zip" if output_kind == "zip" else "mp4"
    out = out_dir / f"sam3long__{_slug(prompt, 24)}__{key}.{ext}"
    if out.exists() and out.stat().st_size > 1000 and not regen:
        print(f"[sam3] long cache hit → {out}")
        return out
    if output_kind == "zip":
        raise ValueError("segment_long merges mp4 masks/overlays; zip output isn't concatenable")

    listf = out_dir / f"_concat_{key}.txt"
    listf.write_text("".join(f"file '{Path(p).resolve()}'\n" for p in parts))
    res = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                          "-i", str(listf), "-c:v", "libx264", "-crf", "18", "-pix_fmt",
                          "yuv420p", str(out)], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"mask concat failed: {res.stderr[-400:]}")
    if job is not None:
        log_event(job, tool="sam3.py", event="segment_long_merged",
                  extra={"prompt": prompt, "chunks": n, "duration_sec": round(dur, 1),
                         "path": str(out)})
    print(f"[sam3] merged {n} chunk-masks → {out.name}")
    return out


def _mask_centroids_x(mask_mp4: Path) -> list[float]:
    """Per-frame horizontal centroid (0..1) of the masked region. cv2 required."""
    import cv2  # opencv is already a repo dep (preflight uses it)
    import numpy as np
    cap = cv2.VideoCapture(str(mask_mp4))
    xs: list[float] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        g = frame.astype(int)
        # masked = pixels clearly above black (the mask is rendered bright/colored)
        lum = g.max(axis=2)
        ys, xcols = np.where(lum > 40)
        w = frame.shape[1]
        xs.append(float(xcols.mean()) / w if len(xcols) else float("nan"))
    cap.release()
    return xs


def reframe(
    video: str | Path,
    subject_prompt: str,
    out: str | Path,
    *,
    aspect: str = "9:16",
    job: Optional[Path] = None,
    start: Optional[float] = None,
    end: Optional[float] = None,
) -> Path:
    """SAM3-locate the subject, then crop to `aspect` centered on the subject.

    Fixed subject-centered crop (the median masked center over the clip) — locks
    the speaker in frame without per-frame jitter. For a moving subject that
    leaves a fixed crop, split the clip at the move and reframe each part, or
    extend this to a smoothed follow-crop (documented TODO).
    """
    import statistics
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    src = Path(video) if not str(video).startswith(("http://", "https://")) else None

    # The crop x is a MEDIAN over the clip; a ~static talking head barely moves, so
    # sample a short window (≤8s) for the centroid instead of segmenting the whole clip.
    if start is None and end is None:
        _d = _probe_dur(src or video)
        ss = max(0.0, _d / 2 - 4.0)
        ee = min(_d, ss + 8.0) if _d else None
    else:
        ss, ee = start, end
    mask = segment_video(video, subject_prompt, start=ss, end=ee,
                         output_kind="mask_only", job=job)
    xs = [x for x in _mask_centroids_x(mask) if x == x]  # drop NaN (empty-mask frames)

    # source dims
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0:s=x", str(src or video)],
        capture_output=True, text=True)
    try:
        W, H = (int(v) for v in probe.stdout.strip().split("x")[:2])
    except Exception:
        W, H = 1920, 1080

    aw, ah = (int(v) for v in aspect.split(":"))
    crop_w = min(W, int(round(H * aw / ah)))
    crop_h = min(H, int(round(crop_w * ah / aw)))

    if xs:
        cx = statistics.median(xs) * W
    else:
        cx = W / 2
        if job is not None:
            log_event(job, tool="sam3.py", event="reframe_empty_mask",
                      extra={"prompt": subject_prompt, "note": "no subject found; centered crop"})
        print("[sam3] WARNING: empty mask — falling back to centered crop")
    x0 = int(max(0, min(W - crop_w, round(cx - crop_w / 2))))
    y0 = int(max(0, (H - crop_h) // 2))

    vf = f"crop={crop_w}:{crop_h}:{x0}:{y0},scale={crop_w}:{crop_h}:flags=lanczos,setsar=1"
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", f"{float(start):.3f}"]
    cmd += ["-i", str(src or video)]
    if end is not None:
        cmd += ["-t", f"{float(end) - float(start or 0):.3f}"]
    cmd += ["-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", str(out)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg reframe failed: {res.stderr[-500:]}")

    if job is not None:
        log_event(job, tool="sam3.py", event="reframe_artifact_written",
                  extra={"prompt": subject_prompt, "crop": f"{crop_w}x{crop_h}+{x0}+{y0}",
                         "subject_center_x": round(cx / W, 3), "path": str(out)})
    print(f"[sam3] reframed → {out}  (crop {crop_w}x{crop_h} @ x={x0}, subject center {cx/W:.2f})")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(allow_abbrev=False, description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_seg = sub.add_parser("segment", allow_abbrev=False, help="Run SAM3 → mask/overlay video")
    p_seg.add_argument("--video", required=True, help="local path or remote URL")
    p_seg.add_argument("--prompt", required=True)
    p_seg.add_argument("--start", type=float)
    p_seg.add_argument("--end", type=float)
    p_seg.add_argument("--output-kind", choices=["overlay", "mask_only", "zip"], default="mask_only")
    p_seg.add_argument("--mask-color", default="green")
    p_seg.add_argument("--mask-opacity", type=float, default=1.0)
    p_seg.add_argument("--max-chunk", type=float, default=30.0,
                       help="whole-clip mode: max seconds per SAM3 call before split/merge "
                            "(model fails past ~30–60s; 30 verified). Ignored if --start/--end given.")
    p_seg.add_argument("--regen", action="store_true")
    add_job_arg(p_seg)

    p_rf = sub.add_parser("reframe", allow_abbrev=False, help="SAM3-locate subject → fixed centered vertical crop")
    p_rf.add_argument("--video", required=True)
    p_rf.add_argument("--prompt", required=True, help="the subject to lock, e.g. 'person'")
    p_rf.add_argument("--out", required=True)
    p_rf.add_argument("--aspect", default="9:16")
    p_rf.add_argument("--start", type=float)
    p_rf.add_argument("--end", type=float)
    add_job_arg(p_rf)

    args = parser.parse_args()
    job = None
    try:
        job = resolve_job_dir(args.job)
    except Exception:
        pass

    if args.cmd == "segment":
        if args.start is not None or args.end is not None:
            # explicit window → single call
            out = segment_video(args.video, args.prompt, start=args.start, end=args.end,
                                output_kind=args.output_kind, mask_color=args.mask_color,
                                mask_opacity=args.mask_opacity, job=job, regen=args.regen)
        else:
            # whole clip → auto-chunk long clips via the split/merge harness
            out = segment_long(args.video, args.prompt, max_chunk=args.max_chunk,
                               output_kind=args.output_kind, mask_color=args.mask_color,
                               mask_opacity=args.mask_opacity, job=job, regen=args.regen)
        print(out)
        print(f"\nNext: composite/treat the mask, or `sam3.py reframe` to crop to the subject.")
    elif args.cmd == "reframe":
        out = reframe(args.video, args.prompt, args.out, aspect=args.aspect,
                     job=job, start=args.start, end=args.end)
        print(out)


if __name__ == "__main__":
    main()
