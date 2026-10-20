"""
compose_render.py — THE canonical Remotion compositor + episode assembler.

  uv run python tools/compose_render.py --job <id> --mode <mode> [...]

ONE self-contained tool. `--mode` picks the assembly shape. This is the
consolidation of three legacy backends — their logic is INLINED here (they are
deleted, so this file imports NONE of them):

  --mode render      standard render from final_raw.mp4 +
                     transcript.json + script.json + overlays.tsx + B-roll.
                     (was remotion_render.py) — `npx remotion render`, Captioned.
  --mode retrofit    layer captions + overlays onto an EXISTING video without
                     re-generating footage. (--source_video → final_raw.mp4 path)
                     — same Remotion compositor, source video as the background.
  --mode cover_bake  bake a cover card into the head of a finished mp4
                     (--source_video + --cover_image + --cover_duration) —
                     ffmpeg concat that re-encodes only the prepended card.
  --mode episode     long-form multi-episode / authority-host assembly.
                     (was assemble_episode.py + make_episode.py) — continuous
                     ambience bed, seam cutaways, fade-to-black book-cover card.
  --mode bespoke    render a complete job-local Remotion composition without
                    copying authored source into the installed engine.

`--mode` is REQUIRED and logged as `usage_role` on every event.

`--resolution` defaults to `720p` per MEMORY (feedback_seedance_720p_default.md):
only escalate to 1080p when the user asks. Explicit style_directives width/height
set the exact final canvas and take precedence over resolution presets. Without
them render/retrofit follow the source's orientation: portrait → 1080×1920,
landscape → 1920×1080, square → 1080×1080 (a `video_transform` keeps 1080×1920);
finishing caps the short edge at the preset without upscaling or changing aspect
ratio.

`--loudnorm` runs EBU R128 (loudnorm) normalisation on the output audio.
`--pre_roll <seconds>` prepends an intro slate (episode mode) / black pad.

The 3-layer style discipline (preserved from remotion_render.py):
  (1) caption layer  — transcript-driven, word-timed (Captioned composition).
  (2) overlay layer  — <job_dir>/overlays.tsx, authored externally per
                       skills/overlay_authoring_guide.md when it serves the plan.
                       Captions-only/minimal work is also valid.
  (3) B-roll layer   — asset paths wired through style_directives.json.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from fractions import Fraction
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

from job import resolve_job_dir, add_job_arg, billing_input_path
from _billing_manifest import job_path as billing_job_path
from _ffmpeg import ffprobe_duration
from _gateway import gateway
from cost import PER_SECOND_ASSUMED_SECONDS
from log import log_event
from remotion_lock import exclusive_remotion_render
from _render_completion import publish_deliverable, staging_path
from _serious_findings import caption_facts
from taste_contract import contract_roots, ensure_locked_plan, file_sha256, write_render_manifest, _display_dimensions

load_dotenv()

# ── Shared Remotion project (anchored to this file, CWD-independent) ──────────
REMOTION_DIR = (Path(__file__).resolve().parent.parent / "remotion").resolve()
PUBLIC_DIR = REMOTION_DIR / "public"
JOBS_DIR_NAME = "_jobs"
ENTRY = "src/index.ts"
COMPOSITION_ID = "Captioned"

# Named caption presets — the only blessed caption looks. Shared source of truth
# with the Remotion render (remotion/src/caption_presets.ts reads the same JSON).
# An agent MUST pick one deliberately; there is no silent default. See skills/caption_presets.md.
CAPTION_PRESETS_PATH = REMOTION_DIR / "src" / "caption_presets.json"


def load_caption_presets() -> dict:
    """Load the named caption presets (name → caption_style dict)."""
    try:
        return json.loads(CAPTION_PRESETS_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[compose_render] WARN: could not load caption presets: {e}")
        return {}

# Per-job overlays.tsx is copied here so Captioned.tsx imports from a stable path.
JOB_OVERLAYS_SYMLINK = REMOTION_DIR / "src" / "_currentJobOverlays.tsx"
JOB_OVERLAYS_STUB_CONTENT = '''import type { JobOverlaysProps } from "./_jobOverlaysContract";
export const JobOverlays: React.FC<JobOverlaysProps> = () => null;
export default JobOverlays;
'''

# The canonical episode estimate covers at most this many seconds of the
# duration-priced lipsync rail. Refuse longer generated VO before lipsync so
# advisory metadata never describes a smaller execution shape.
EPISODE_MAX_VO_SECONDS = PER_SECOND_ASSUMED_SECONDS["lipsync_footage"]

# ── Authority-host episode constants (preserved verbatim from make_episode.py) ─
# In the standalone videoclaw repo, the authority-host job lives under jobs/.
HOST_JOB = "_authority_host"
HOST_VOICE = "UajvP7D1ag51ngLdGt3M"
INTERIOR_BROLL = ["mv_bookshelf", "mv_fire", "mv_rug", "mv_desk", "mv_painting"]
HOUSE_BROLL = "mv_house"
INTERIOR_CUTS = [14.0, 26.0, 44.0, 59.0]
CUT_LEN = 6.0
BED_VOL = 0.16
SFX_VOL = 0.5
CARD_STYLE = (
    "A vintage book-recommendation CARD filling the entire square frame edge to edge "
    "(the card IS the whole image). Style: dark deep-oxblood leather with a thin gold border, "
    "horizontal layout, the book cover from the reference image on the left with a drop shadow, "
    "gold-serif title '{title}' and author '{author}' on the right, and the line '{idea}' below "
    "in faded gold. A small Instagram-style save bookmark icon (outlined ribbon with a notched "
    "bottom) in the top-right. Premium and moody. Crisp, legible, correctly spelled text."
)


# ═════════════════════════════════════════════════════════════════════════════
# Shared ffprobe
# ═════════════════════════════════════════════════════════════════════════════

def probe_dur(p: Path) -> float:
    """Duration in seconds; 0.0 if missing/empty/unreadable (resume-guard safe)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)],
        capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


# ═════════════════════════════════════════════════════════════════════════════
# Remotion plumbing (preserved verbatim from remotion_render.py)
# ═════════════════════════════════════════════════════════════════════════════

def link_job_overlays(job_dir: Path) -> bool:
    """Copy <job_dir>/overlays.tsx → src/_currentJobOverlays.tsx.

    A copy, not a symlink: webpack resolves module lookups from the file's
    actual on-disk location, so a symlink into the job dir would search for
    node_modules under <job_dir> and fail. Idempotent.

    Returns True if a per-job overlays file is wired up, False if the stub is in
    place.
    """
    job_overlays = job_dir / "overlays.tsx"
    if JOB_OVERLAYS_SYMLINK.is_symlink() or JOB_OVERLAYS_SYMLINK.exists():
        JOB_OVERLAYS_SYMLINK.unlink()
    if job_overlays.exists():
        shutil.copy2(job_overlays, JOB_OVERLAYS_SYMLINK)
        return True
    JOB_OVERLAYS_SYMLINK.write_text(JOB_OVERLAYS_STUB_CONTENT)
    return False


def ensure_remotion_installed() -> None:
    if not (REMOTION_DIR / "node_modules").exists():
        raise RuntimeError(
            f"{REMOTION_DIR}/node_modules is missing. "
            f"Run `cd {REMOTION_DIR} && npm install` once on this machine."
        )


def link_job_into_public(job_dir: Path) -> str:
    """Symlink the job dir into remotion/public/_jobs/<job-id>/.

    Chromium blocks file:// fetches inside the render context, so the Remotion
    code resolves paths via staticFile("_jobs/<job-id>/<file>"). Returns the
    public-relative fragment. Idempotent / concurrency-safe (per-job subdir).
    """
    job_id = job_dir.name
    target = PUBLIC_DIR / JOBS_DIR_NAME / job_id
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.exists():
        if target.is_symlink() and target.resolve() == job_dir.resolve():
            pass
        else:
            target.unlink()
            target.symlink_to(job_dir.resolve())
    else:
        target.symlink_to(job_dir.resolve())
    return f"{JOBS_DIR_NAME}/{job_id}"


# ── Job-input normalization (shared, renderer-neutral) ───────────────────────
# These parsers are shared verbatim with the HyperFrames compositor via
# tools/job_inputs.py so both engines derive identical semantic inputs from a
# job. compose_render keeps its exact behavior — it now calls the shared code
# instead of a private copy (parity proven in tests/test_job_inputs.py).

import job_inputs
from job_inputs import (
    URL_RE,
    find_url as _find_url,
    parse_manual_overlays,
    auto_overlays,
    merge_overlays,
    strip_md_fence as _strip_md_fence,
    coerce_directives as _coerce_directives,
    overlays_from_directives,
    resolve_caption_preset_style,
    resolve_audio_bed_volume_db,
    read_caption_luminance,
)


def load_style_directives(job_dir: Path, override_path: Path | None = None) -> dict | None:
    """Load + coerce style_directives.json (shared logic; compose_render warn tag)."""
    return job_inputs.load_style_directives(
        job_dir, override_path, warn_prefix="compose_render")


def build_props(
    job_dir: Path,
    public_relative: str,
    script: dict,
    company: dict | None,
    *,
    video_basename: str = "final_raw.mp4",
    style_override: Path | None = None,
    extra_directives: dict | None = None,
    caption_preset: str | None = None,
) -> dict:
    """Construct the input-props blob handed to the Remotion render.

    `video_basename` lets retrofit mode point the composition at a source video
    that was copied/symlinked into the job dir as final_raw.mp4.
    """
    # Source-duration precedence (shared with HyperFrames via job_inputs):
    # actual mp4 duration → script total → max chunk end → fail clearly. We
    # PREFER the real mp4 over script.json's pre-densify claim (densify clips
    # ~30%; the script value over-schedules → dead frames + miscued overlays at
    # the tail). Never guesses a fallback.
    duration = job_inputs.resolve_source_duration(
        job_dir, script, video_basename=video_basename)

    directives = load_style_directives(job_dir, override_path=style_override)
    if extra_directives:
        directives = {**(directives or {}), **extra_directives}
    width, height = (job_inputs.explicit_video_canvas(directives)
                     or job_inputs.default_video_canvas(
                         job_dir, directives, video_basename=video_basename))

    if directives:
        # Style directives provide CRAFT defaults (caption style, hook timing,
        # lower-third position) — those WIN. But the TEXT CONTENT of overlays
        # from directives describes the REFERENCE outlier, not our adapted
        # script. Manual annotations in post_production_notes win for TEXT.
        manual = parse_manual_overlays(script)
        manual_kinds = {o["kind"] for o in manual}
        directive_overlays = overlays_from_directives(directives)
        overlays = list(manual)
        for d in directive_overlays:
            if d["kind"] not in manual_kinds:
                overlays.append(d)
        if "hook" not in {o["kind"] for o in overlays} or "url" not in {o["kind"] for o in overlays}:
            existing = {o["kind"] for o in overlays}
            for a in auto_overlays(script, company):
                if a["kind"] not in existing:
                    overlays.append(a)
    else:
        overlays = merge_overlays(parse_manual_overlays(script), auto_overlays(script, company))

    props = {
        "videoPath": f"{public_relative}/{video_basename}",
        "captionsPath": f"{public_relative}/transcript.json",
        "jobPublicPath": public_relative,
        "durationSeconds": duration,
        "width": width,
        "height": height,
        "fps": 30,
        "overlays": overlays,
        "showCaptions": True,
    }
    # Caption style = chosen preset (by name) with any explicit caption_style
    # fields layered on top. Preset name comes from the CLI (--caption-preset) or
    # the style_directives "caption_preset" key. There is NO implicit default —
    # run_render enforces a deliberate choice (see skills/captions.md).
    preset_name = caption_preset or (directives or {}).get("caption_preset")
    explicit_style = (directives or {}).get("caption_style")
    caption_style = resolve_caption_preset_style(
        preset_name, explicit_style, load_caption_presets() if preset_name else {})
    if caption_style is not None:
        props["captionStyle"] = caption_style

    if directives:
        if "cut_points" in directives:
            props["cutPoints"] = directives["cut_points"]
        if "video_transform" in directives:
            props["videoTransform"] = directives["video_transform"]
        # Data-viz overlays (animated stat / chart primitives — see
        # remotion/src/dataviz.tsx + skills/dataviz_styles.md). Authored per-job
        # in style_directives.json; passed through verbatim to the renderer.
        if isinstance(directives.get("dataviz"), list) and directives["dataviz"]:
            props["dataviz"] = directives["dataviz"]

    # Inject preflight-sampled background luminance so the renderer can auto-flip
    # outline color when none was set explicitly.
    avg = read_caption_luminance(job_dir)
    if avg is not None:
        cs = props.get("captionStyle") or {}
        cs.setdefault("background_luminance", avg)
        props["captionStyle"] = cs

    # Audio bed (optional).
    bed_path = job_dir / "audio" / "bed.wav"
    if bed_path.exists():
        props["audioBedPath"] = f"{public_relative}/audio/bed.wav"
        props["audioBedVolumeDb"] = resolve_audio_bed_volume_db(
            job_dir, directives, voice_media=job_dir / video_basename)

    return props


def remotion_render(
    props: dict,
    output_path: Path,
    *,
    entry: str = ENTRY,
    composition_id: str = COMPOSITION_ID,
) -> None:
    """Invoke the installed Remotion CLI for one composition."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "npx", "--no-install", "remotion", "render",
        entry, composition_id, str(output_path.resolve()),
        f"--props={json.dumps(props)}",
        "--log=info", "--concurrency=2",
    ]
    print(f"  Running: {' '.join(cmd[:6])} ... {output_path}")
    if props.get("videoPath"):
        print(f"  Props (truncated): videoPath={props['videoPath']}, "
              f"duration={props.get('durationSeconds')}s, "
              f"overlays={len(props.get('overlays', []))}")
    result = subprocess.run(cmd, cwd=REMOTION_DIR)
    if result.returncode != 0:
        raise RuntimeError(f"remotion render exited with code {result.returncode}")


# ═════════════════════════════════════════════════════════════════════════════
# The compositor owns the picture; the source mix owns the audio
# ═════════════════════════════════════════════════════════════════════════════

def has_audio_stream(path: Path) -> bool:
    """Whether ffprobe can prove `path` carries a primary audio stream."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"audio probe failed for {path}: {result.stderr.strip()}")
    return bool(result.stdout.strip())


def restore_source_audio(rendered: Path, source: Path) -> None:
    """Carry the source's audio stream into the render unchanged.

    `<Video>` hands the source's encoded audio through Chromium's decoder and
    Remotion re-encodes the result into the render. That round-trip does not
    compensate the decoder's priming delay, so the rendered track lands a fixed
    2048 samples (42.667 ms at 48 kHz) LATE and is resampled on the way. The
    picture is frame-accurate and the programme material survives, so nothing
    sounds missing — but the delivered audio no longer lines up with either the
    picture or the mix `score_bed` approved, which is what QA's containment
    check binds the delivery to (`music_bed_not_contained_in_reviewed_final`).

    The compositor is the authority for pixels, not for the mix. Remux the
    source's audio packets in verbatim instead of shipping the round-trip.
    """
    tmp = rendered.with_name(rendered.name + ".audio.tmp.mp4")
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(rendered), "-i", str(source),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy", "-movflags", "+faststart", str(tmp),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"carrying the source audio into the render failed:\n{res.stderr[-800:]}"
        )
    if not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("carrying the source audio produced an empty file")
    tmp.replace(rendered)
    print(f"  Source audio carried through verbatim from {source.name}")


# ═════════════════════════════════════════════════════════════════════════════
# Post-render finishing: resolution downscale, loudnorm, pre_roll
# ═════════════════════════════════════════════════════════════════════════════

def _finishing_media(src: Path) -> dict:
    """Probe display geometry, retaining rotation and pixel-aspect semantics."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(src)],
        capture_output=True, text=True, check=True)
    try:
        streams = json.loads(result.stdout)["streams"]
        video = next(s for s in streams if s.get("codec_type") == "video")
        raw_sar = video.get("sample_aspect_ratio")
        sar = Fraction(str(raw_sar).replace(":", "/")) if raw_sar not in (None, "N/A", "0:1") else Fraction(1)
        if sar <= 0:
            raise ValueError("invalid pixel aspect ratio")
        # Normalize to square pixels before applying the shared rotation check.
        display = {**video, "width": round(int(video["width"]) * sar)}
        width, height = _display_dimensions(display, src)
    except (KeyError, StopIteration, TypeError, ValueError, ZeroDivisionError) as exc:
        raise ValueError(f"Cannot read display dimensions for {src.name}") from exc
    return {"width": width, "height": height, "sar": sar,
            "stored_size": (int(video["width"]), int(video["height"])),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams)}


def _finishing_canvas(media: dict, resolution: str,
                      canvas: tuple[int, int] | None) -> tuple[int, int]:
    if canvas is None:
        # Presets cap the short edge without upscaling or changing orientation.
        width, height = media["width"], media["height"]
        factor = min(1.0, (720 if resolution == "720p" else 1080) / min(width, height))
        canvas = (max(2, round(width * factor / 2) * 2),
                  max(2, round(height * factor / 2) * 2))
        try:
            return job_inputs.explicit_video_canvas({"width": canvas[0], "height": canvas[1]})
        except ValueError as exc:
            raise ValueError(
                f"Source display geometry {width}x{height} exceeds the local finishing "
                "limit; choose explicit style_directives width/height within "
                "8192 pixels per edge and 33177600 total pixels") from exc
    return job_inputs.explicit_video_canvas({"width": canvas[0], "height": canvas[1]})


def _fit_canvas_filter(media: dict, canvas: tuple[int, int], *, cover: bool = False) -> str:
    """Scale uniformly in display space; contain the body or crop a cover card."""
    width, height = canvas
    factor = (max if cover else min)(width / media["width"], height / media["height"])
    fitted_w = max(2, round(media["width"] * factor / 2) * 2)
    fitted_h = max(2, round(media["height"] * factor / 2) * 2)
    fit = (f"crop={width}:{height}" if cover
           else f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2")
    return f"scale={fitted_w}:{fitted_h}:flags=lanczos,setsar=1,{fit}"


def finish_output(
    src: Path,
    *,
    resolution: str,
    loudnorm: bool,
    pre_roll: float,
    canvas: tuple[int, int] | None = None,
) -> None:
    """Apply the post-render finishing passes in one ffmpeg call, in place.

    Explicit dimensions are authoritative. Otherwise presets cap the short edge
    without upscaling. Rotation/pixel aspect are normalized without stretching;
    any differently shaped picture is contained inside an explicit canvas.
    """
    media = _finishing_media(src)
    loudnorm = loudnorm and media["has_audio"]
    target_w, target_h = _finishing_canvas(media, resolution, canvas)
    # Normalize quarter-turn metadata before B-roll reads physical dimensions.
    need_scale = ((target_w, target_h) != (media["width"], media["height"])
                  or (target_w, target_h) != media["stored_size"]
                  or media["sar"] != 1)
    need_pre = pre_roll and pre_roll > 0
    if not (need_scale or loudnorm or need_pre):
        return

    tmp = src.with_name(src.name + ".finish.tmp.mp4")
    vf = []
    af = []
    if need_scale or need_pre:
        vf.append(_fit_canvas_filter(media, (target_w, target_h)))
    if loudnorm:
        # EBU R128 single-pass loudnorm (broadcast-safe target).
        af.append("loudnorm=I=-14:TP=-1.5:LRA=11")

    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if need_pre:
        # Prepend `pre_roll` seconds of black + silence, then the main clip.
        cmd += ["-i", str(src)]
        filt = (
            f"[0:v]{','.join(vf)},setpts=PTS-STARTPTS[mv];"
            f"color=c=black:s={target_w}x{target_h}:r=30:d={pre_roll:.3f}[pv];"
            f"[pv][mv]concat=n=2:v=1:a=0[vout]"
        )
        if media["has_audio"]:
            filt += (
                f";[0:a]{','.join(af) if af else 'anull'},asetpts=PTS-STARTPTS[ma];"
                f"anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:{pre_roll:.3f}[pa];"
                "[pa][ma]concat=n=2:v=0:a=1[aout]")
        cmd += ["-filter_complex", filt, "-map", "[vout]"]
        if media["has_audio"]:
            cmd += ["-map", "[aout]"]
    else:
        cmd += ["-i", str(src)]
        if vf:
            cmd += ["-vf", ",".join(vf)]
        if af:
            cmd += ["-af", ",".join(af)]
    cmd += [
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-metadata:s:v:0", "rotate=0", str(tmp),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"finishing pass failed:\n{res.stderr[-800:]}")
    if not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("finishing pass produced empty file")
    tmp.replace(src)
    passes = []
    if need_scale:
        passes.append(f"scale→{target_w}×{target_h}")
    if loudnorm:
        passes.append("loudnorm")
    if need_pre:
        passes.append(f"pre_roll {pre_roll}s")
    print(f"  Finishing pass applied: {', '.join(passes)}")


# ═════════════════════════════════════════════════════════════════════════════
# Seam B-roll inserts: overlay minted cutaways over lipsync-stitch seams
# ═════════════════════════════════════════════════════════════════════════════

def _load_broll_inserts(
    spec: str | None,
    job_dir: Path,
    *,
    from_manifest: bool = False,
) -> list[dict]:
    """Resolve seam-B-roll insert entries into a normalised, sorted list.

    Each returned entry is {"start": float, "end": float, "clip": Path}.

    `spec` is either:
      * an inline JSON array string, or
      * a path to a .json file containing such an array (or an object with a
        top-level "inserts"/"seams"/"broll_inserts" key), or
      * (when from_manifest) a path to an episode/seam manifest whose "seams"
        (or "inserts") key lists the cutaways.

    Entry keys are forgiving: start | start_sec | t, end | end_sec, and
    clip | path | video | file. Clip paths are resolved relative to the job dir
    when not absolute. Out-of-spec / missing-file entries raise so a typo can't
    silently drop a cutaway.
    """
    if not spec:
        return []
    raw = spec.strip()
    data = None
    candidate = Path(spec)
    if raw.startswith("[") or raw.startswith("{"):
        data = json.loads(raw)
    elif billing_input_path(candidate).exists():
        data = json.loads(_strip_md_fence(billing_input_path(candidate).read_text()))
    else:
        raise SystemExit(
            f"ERROR: --broll-inserts is neither inline JSON nor an existing file: {spec!r}"
        )

    if isinstance(data, dict):
        for key in ("inserts", "broll_inserts", "seams", "seam_inserts", "cutaways"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise SystemExit(
                "ERROR: B-roll insert object has no inserts/seams/cutaways array."
            )
    if not isinstance(data, list):
        raise SystemExit("ERROR: B-roll inserts must be a JSON array of {start,end,clip}.")

    out: list[dict] = []
    for i, e in enumerate(data):
        if not isinstance(e, dict):
            raise SystemExit(f"ERROR: B-roll insert #{i} is not an object: {e!r}")
        start = e.get("start", e.get("start_sec", e.get("t")))
        end = e.get("end", e.get("end_sec"))
        clip = e.get("clip", e.get("path", e.get("video", e.get("file"))))
        if start is None or end is None or not clip:
            raise SystemExit(
                f"ERROR: B-roll insert #{i} needs start, end, clip (got {e!r})."
            )
        start = float(start)
        end = float(end)
        if end <= start:
            raise SystemExit(
                f"ERROR: B-roll insert #{i}: end ({end}) must be > start ({start})."
            )
        clip_path = Path(clip)
        if not clip_path.is_absolute():
            clip_path = (job_dir / clip_path)
        clip_path = billing_input_path(clip_path.resolve())
        if not clip_path.exists():
            raise FileNotFoundError(f"B-roll insert #{i} clip not found: {clip_path}")
        out.append({"start": start, "end": end, "clip": clip_path})
    out.sort(key=lambda d: d["start"])
    return out


def overlay_broll_inserts(src: Path, inserts: list[dict]) -> None:
    """Composite seam-B-roll clips over `src` (in place) at their timestamps.

    Each insert covers the spine for [start, end): the clip is time-shifted to
    start at `start`, scaled+cropped to the spine's exact frame, and overlaid
    only while enabled. The spine audio is preserved untouched (cutaways are
    silent visual cover for lipsync-stitch seams). No-op if `inserts` is empty.

    Stills (png/jpg) and clips (mp4/mov) both work: a still loops to fill its
    window via the `tpad=clone` tail, a short clip likewise holds its last
    frame rather than revealing the seam underneath.
    """
    if not inserts:
        return

    w, h, fps = 1080, 1920, 30
    dims = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(src)],
        capture_output=True, text=True).stdout.strip()
    if "x" in dims:
        try:
            w, h = (int(x) for x in dims.split("x")[:2])
        except ValueError:
            pass
    spine_dur = probe_dur(src)

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src)]
    for ins in inserts:
        clip = ins["clip"]
        is_still = clip.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        win = ins["end"] - ins["start"]
        if is_still:
            cmd += ["-loop", "1", "-t", f"{win:.3f}", "-i", str(clip)]
        else:
            cmd += ["-i", str(clip)]

    fc = []
    prev = "[0:v]"
    for i, ins in enumerate(inserts):
        idx = i + 1
        s, e = ins["start"], ins["end"]
        # Scale+crop the cutaway to the spine frame, clone its last frame to
        # fill the whole window (short clip/still won't reveal the seam), trim
        # to the window length, then shift it to its window start.
        win = e - s
        fc.append(
            f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h},setsar=1,fps={fps},"
            f"tpad=stop_mode=clone:stop_duration={win + 1.0:.3f},"
            f"trim=0:{win:.3f},"
            f"setpts=PTS-STARTPTS+{s:.3f}/TB[bv{i}]"
        )
        fc.append(
            f"{prev}[bv{i}]overlay=0:0:enable='between(t,{s:.3f},{e:.3f})'[ov{i}]"
        )
        prev = f"[ov{i}]"

    tmp = src.with_name(src.name + ".broll.tmp.mp4")
    cmd += [
        "-filter_complex", ";".join(fc),
        "-map", prev, "-map", "0:a?",
        # Base spine governs length; an insert whose window runs past the spine
        # must not extend the video.
        "-t", f"{spine_dur:.3f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        str(tmp),
    ]
    print(f"  Overlaying {len(inserts)} seam B-roll insert(s): "
          + ", ".join(f"{i['start']:.1f}–{i['end']:.1f}s→{i['clip'].name}" for i in inserts))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"seam B-roll overlay failed:\n{r.stderr[-800:]}")
    if not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("seam B-roll overlay produced empty file")
    tmp.replace(src)


# ═════════════════════════════════════════════════════════════════════════════
# Audio grounding: a later render must never silently drop an approved mix
# ═════════════════════════════════════════════════════════════════════════════

def _job_relative_path(job_dir: Path, value: object) -> Path | None:
    """Resolve a bed_meta path recorded from a possibly different CWD."""
    if not isinstance(value, str) or not value:
        return None
    candidate = Path(value)
    return candidate if candidate.is_absolute() else (job_dir / candidate)


def completed_audio_mix(job_dir: Path) -> dict | None:
    """The terminal ``score_bed`` mix for this job, when one was produced.

    ``audio/bed_meta.json`` is written only by a completed mix and records the
    exact muxed output plus the digest of the picture it was built from.
    """
    meta_path = job_dir / "audio" / "bed_meta.json"
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(meta, dict):
        return None
    output_video = _job_relative_path(job_dir, meta.get("output_video"))
    if output_video is None or not output_video.is_file():
        return None
    return {"meta": meta, "output_video": output_video, "meta_path": meta_path}


def assert_audio_grounding_preserved(job_dir: Path, source_video: Path) -> None:
    """Refuse a render that would replace an approved mix with a silent final.

    ``score_bed`` binds its mix to the exact bytes of the picture it scored and
    writes the muxed result to its own artifact; it never writes ``final.mp4``.
    A render whose source is anything other than that muxed artifact therefore
    produces a candidate that CANNOT contain the mix. QA already catches this
    (``BED_GROUNDING``), but only after a paid review of a candidate that could
    never be approved. Fail closed here instead, with the two orders that work.
    """
    mix = completed_audio_mix(job_dir)
    if mix is None:
        return
    try:
        carried = source_video.resolve() == mix["output_video"].resolve()
    except OSError:
        carried = False
    if carried:
        return
    output_video = mix["output_video"]
    try:
        relative = output_video.relative_to(job_dir)
    except ValueError:
        relative = output_video
    raise SystemExit(
        "ERROR: this render would drop the audio this job already produced.\n\n"
        f"  score_bed wrote   {output_video}\n"
        f"  grounded in       {mix['meta'].get('input_sha256', 'unknown')}\n"
        f"  this render reads {source_video}\n\n"
        "score_bed muxes its mix into its own artifact, never into final.mp4, so a\n"
        "render from any other source writes a final that cannot contain it.\n\n"
        "Two orders work — pick one:\n"
        f"  1. Carry the mix forward:\n"
        f"       --mode retrofit --source_video {relative}\n"
        "  2. Re-score after the picture is final: remove the stale mix\n"
        f"       ({mix['meta_path']} and its outputs), render the picture,\n"
        "       then run score_bed against the resulting final.mp4."
    )


# ═════════════════════════════════════════════════════════════════════════════
# MODE: render / retrofit  (the Remotion compositor path)
# ═════════════════════════════════════════════════════════════════════════════

def _run_render_unlocked(args, job_dir: Path, *, retrofit: bool) -> Path:
    """Standard render (or retrofit onto an existing source video).

    Faithfully reproduces remotion_render.py: symlink job into public/, copy
    overlays.tsx when present, compute chunk_boundaries, build props,
    layout pre-flight, render Captioned → final.mp4, then post-finish.
    """
    style_override = Path(args.style_directives).resolve() if getattr(args, "style_directives", None) else None
    canvas = job_inputs.explicit_video_canvas(load_style_directives(job_dir, style_override))
    ensure_remotion_installed()

    transcript = job_dir / "transcript.json"
    script_path = job_dir / "script.json"
    final_out = job_dir / "final.mp4"

    is_post_only = (job_dir / "post_only.json").exists()

    # In retrofit mode, the caller supplies --source_video. We stage it as
    # final_raw.mp4 (without re-generating footage) so the composition's
    # background input + duration logic is identical to a normal render.
    if retrofit:
        if not args.source_video:
            raise SystemExit("ERROR: --mode retrofit requires --source_video <mp4>.")
        src = Path(args.source_video).resolve()
        if not src.exists():
            raise FileNotFoundError(f"--source_video not found: {src}")
        # Guard BEFORE staging: a refused render must not have already
        # overwritten final_raw.mp4 with the rejected source.
        assert_audio_grounding_preserved(job_dir, src)
        staged = job_dir / "final_raw.mp4"
        if src != staged.resolve():
            shutil.copy2(src, staged)
            print(f"Staged source video → {staged}")
        raw_video = staged
    else:
        raw_video = job_dir / "final_raw.mp4"

    if not raw_video.exists():
        raise FileNotFoundError(
            f"{raw_video} not found. Run synth_voice/densify first "
            f"(or drop a video here for post-only jobs)."
        )
    # A render that would invalidate an approved audio mix fails closed here,
    # before it can write a silent "final" that only paid QA would catch.
    if not retrofit:
        assert_audio_grounding_preserved(job_dir, raw_video)

    # Scoped Taste is locked into a promise-bearing production HERE, before the
    # render, so the render manifest and QA bind to evidence that exists rather
    # than to whatever an agent remembered to run. A legacy job with no
    # promise.json is untouched.
    locked_taste = ensure_locked_plan(job_dir, *contract_roots())
    if locked_taste is not None:
        print(
            f"Taste locked: {len(locked_taste['commitments'])} commitment(s), "
            f"{locked_taste['evidenceSha256'][:12]}\u2026"
        )
    # A silent or typography-only video has no spoken source to transcribe.
    # `--no-captions` is the explicit creative declaration; do not force the
    # agent to fabricate transcript or placeholder narration files merely to
    # satisfy a compositor input shape.
    if not args.no_captions and not transcript.exists():
        raise FileNotFoundError(f"{transcript} not found. Run synth_voice (transcription) first.")

    if not script_path.exists():
        if is_post_only or retrofit or args.no_captions:
            script = {"chunks": [], "post_production_notes": "", "total_duration_seconds": 0}
        else:
            raise FileNotFoundError(f"{script_path} not found. Write script.json first.")
    else:
        script = json.loads(script_path.read_text())

    # Reject the placeholder transcript.
    if not args.no_captions:
        tx = json.loads(transcript.read_text())
        words = tx.get("words", [])
        if not words or words[0].get("word") == "PLACEHOLDER":
            raise RuntimeError(
                "transcript.json is a placeholder. Set ELEVENLABS_API_KEY and "
                "rerun synth_voice before rendering."
            )

    company = None
    company_path = job_dir / "company.json"
    if company_path.exists():
        company = json.loads(company_path.read_text())

    # chunk_boundaries.json: lets overlays.tsx anchor Sequences by chunk index.
    # Non-fatal if it fails (existing hardcoded-seconds overlays still render).
    try:
        from chunk_boundaries import compute_and_write as _compute_chunk_boundaries
        densify_meta_path = job_dir / "densify_meta.json"
        final_duration_sec = None
        if densify_meta_path.exists():
            final_duration_sec = json.loads(densify_meta_path.read_text()).get("final_duration_sec")
        _compute_chunk_boundaries(job_dir, final_duration_sec=final_duration_sec, quiet=False)
    except Exception as e:
        print(f"(chunk_boundaries skipped: {e})")

    public_relative = link_job_into_public(job_dir)
    has_job_overlays = link_job_overlays(job_dir)
    print(f"Job:    {job_dir}")
    print(f"Linked: {PUBLIC_DIR / public_relative} → {job_dir}")
    print(f"JobOverlays: {'<job_dir>/overlays.tsx' if has_job_overlays else 'stub (none authored)'}")

    # An authored overlay layer can improve a job, but it is a creative choice.
    # Captions-only and deliberately minimal renders remain valid production
    # paths; this tool does not enforce a composition recipe.
    if not has_job_overlays and not is_post_only and not args.allow_stub_overlays:
        print(
            "No <job_dir>/overlays.tsx authored; rendering the intentional "
            "captions-only/minimal path."
        )
    if args.allow_stub_overlays is not None:
        reason = args.allow_stub_overlays.strip()
        if not reason:
            raise SystemExit(
                "ERROR: --allow-stub-overlays requires a non-empty reason string. "
                "Pass --allow-stub-overlays 'intentional captions-only treatment' or similar."
            )
        adaptation_notes = job_dir / "adaptation_notes.md"
        stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        log_line = f"- [{stamp}] `compose_render.py --allow-stub-overlays` invoked: {reason}\n"
        if adaptation_notes.exists():
            adaptation_notes.write_text(adaptation_notes.read_text() + log_line)
        else:
            adaptation_notes.write_text(
                "# Adaptation notes\n\n"
                "Records explicit overlay-treatment choices on this job.\n\n" + log_line
            )
        print(f"Captions-only/minimal render choice: {reason}")
        print(f"   logged to {adaptation_notes}")

    props = build_props(
        job_dir, public_relative, script, company,
        video_basename="final_raw.mp4", style_override=style_override,
        caption_preset=getattr(args, "caption_preset", None),
    )
    if canvas is None:
        print(f"Canvas: {props['width']}x{props['height']}, following the source's "
              "orientation (a video_transform keeps 1080x1920). Set width and height "
              "in style_directives.json for another shape.")

    # Forced-choice gate: captions must NOT fall back to a silent default. Every
    # render that shows captions has to name a preset on purpose (or pass an
    # explicit caption_style, or turn captions off). See skills/captions.md.
    captions_on = props.get("showCaptions", True) and not args.no_captions
    if captions_on and not props.get("captionStyle"):
        presets = ", ".join(load_caption_presets()) or "(none loaded)"
        raise SystemExit(
            "ERROR: captions are ON but no caption style was chosen.\n"
            "Caption presets are OPT-IN ON PURPOSE — there is no default look.\n\n"
            f"Pick one of: {presets}\n\n"
            "Choose by either:\n"
            "  --caption-preset <name>\n"
            "  or set \"caption_preset\": \"<name>\" in style_directives.json\n"
            "  or provide an explicit \"caption_style\": {…} in style_directives.json\n"
            "  or pass --no-captions if this render should have NO captions.\n\n"
            "See skills/caption_presets.md for the gallery + when-to-use each preset."
        )

    # CLI overrides for caption layout (translate the spec's caption flags).
    apply_caption_cli_overrides(props, args)
    if args.hide_ranges:
        _ranges = parse_hide_ranges(args.hide_ranges)
        props["hideRanges"] = _ranges  # legacy top-level (not read by CaptionPage)
        # CaptionPage suppresses captions via style.hide_ranges_ms (in MS), so
        # route the ranges into the caption style where the component reads them.
        _cs = props.get("captionStyle") or {}
        _cs["hide_ranges_ms"] = [[a * 1000.0, b * 1000.0] for a, b in _ranges]
        props["captionStyle"] = _cs

    if args.no_captions:
        props["showCaptions"] = False
    if args.no_overlays:
        props["overlays"] = []
    elif has_job_overlays and not args.legacy_overlays:
        # When the job ships overlays.tsx, the JOB OWNS the overlay layer. Skip
        # the legacy auto-overlays so they don't double-render (the chung-press
        # double-hook-pill bug).
        n_legacy = len(props.get("overlays", []))
        props["overlays"] = []
        if n_legacy > 0:
            print(f"Skipped {n_legacy} legacy overlay(s) — overlays.tsx owns the overlay layer. "
                  f"Pass --legacy-overlays to keep both.")

    # Layout pre-flight: red zones + face collision. Warn-only by default.
    if not args.skip_preflight and not args.no_overlays:
        try:
            from preflight import validate_layout
            # The canvas Remotion is about to build on, not whatever
            # style_directives.json happens to hold: --style_directives points
            # the render elsewhere, and the gate must measure what ships.
            issues = validate_layout(
                job_dir, platform=args.platform,
                canvas=(props["width"], props["height"]))
            if issues:
                print(f"\n⚠ Pre-flight found {len(issues)} layout issue(s) on platform={args.platform}:")
                for i in issues:
                    print(f"  - {i.format()}")
                if args.strict_preflight:
                    raise RuntimeError("strict-preflight: refusing to render with layout issues")
                print("  (continuing — pass --strict-preflight to block on these)\n")
            else:
                print(f"✓ Pre-flight clean for {args.platform}\n")
        except ImportError:
            print("(preflight unavailable — skipping layout pre-flight)")

    render_layers = rendered_layers(
        props, owns_overlays=has_job_overlays and not args.no_overlays,
        transcript_words=(json.loads(transcript.read_text()).get("words")
                          if props.get("showCaptions", True) and transcript.exists() else None),
    )
    # QA grounds reviewer wording claims only in the exact transcript that captioned the render.
    captions_transcript = transcript if props.get("showCaptions", True) else None
    log_event(
        job_dir, tool="compose_render.py", event="render_started",
        extra={
            "usage_role": args.mode,
            "composition_id": COMPOSITION_ID,
            "duration_seconds": props.get("durationSeconds"),
            "overlays": len(props.get("overlays", [])),
            "show_captions": props.get("showCaptions", True),
            "transcript_sha256": file_sha256(captions_transcript) if captions_transcript else None,
            "video_path": props.get("videoPath"),
            "resolution": args.resolution,
            "loudnorm": args.loudnorm,
            "pre_roll": args.pre_roll,
            "retrofit": retrofit,
            # What this render actually draws, so the end-of-render review
            # judges the real overlay/caption layers, not stale directives.
            **render_layers,
        },
    )

    # Seam B-roll inserts (authority-host method): minted cutaways that cover
    # the lipsync-stitch seams. Resolved before render so a bad spec fails fast.
    broll_inserts = _load_broll_inserts(args.broll_inserts, job_dir)

    # The composition only synthesises audio of its own when it was handed a
    # separate bed to mix (`audioBedPath` → <Audio>). Without one, every sample
    # in the render came from the source video, and Remotion's decode/re-encode
    # round-trip can only misalign it — so carry the source track through
    # verbatim instead. See restore_source_audio.
    carry_source_audio = (
        not props.get("audioBedPath") and has_audio_stream(raw_video)
    )

    _t0 = time.perf_counter()
    # Render and finish into a same-directory staging file; final.mp4 only ever
    # receives complete bytes, in one atomic replace after the last pass.
    staging = staging_path(final_out)
    try:
        remotion_render(props, staging)
        if carry_source_audio:
            restore_source_audio(staging, raw_video)
        finish_output(staging, resolution=args.resolution,
                      loudnorm=args.loudnorm, pre_roll=args.pre_roll or 0.0,
                      canvas=(props["width"], props["height"]) if canvas else None)
        # Overlay AFTER finishing so cutaways land on the final-resolution frame
        # (the finisher preserves an explicit canvas or proportionally scales).
        overlay_broll_inserts(staging, broll_inserts)
        publish_deliverable(job_dir, staging, final_out, tool="compose_render", facts={
            "mode": "retrofit" if retrofit else "render",
            "show_captions": bool(props.get("showCaptions", True)),
            "pre_roll": float(args.pre_roll or 0.0),
            **render_layers,
        })
    except Exception as e:
        log_event(
            job_dir, tool="compose_render.py", event="render_failed",
            duration_seconds=time.perf_counter() - _t0,
            extra={"usage_role": args.mode, "error": type(e).__name__,
                   "error_message": str(e)[:300]},
        )
        raise
    finally:
        staging.unlink(missing_ok=True)

    if not final_out.exists():
        raise RuntimeError("Remotion render finished but final.mp4 is missing")
    render_manifest = write_render_manifest(
        job_dir,
        final_out,
        raw_video,
        props,
        post_compose_broll=broll_inserts,
    )
    size_mb = final_out.stat().st_size // 1024 // 1024
    print(f"\n✓ Final video: {final_out} ({size_mb}MB)")
    print(f"  ▶ WATCH → file://{final_out.resolve()}")
    log_event(
        job_dir, tool="compose_render.py", event="render_completed",
        duration_seconds=time.perf_counter() - _t0,
        extra={
            "usage_role": args.mode,
            "output_path": str(final_out.relative_to(job_dir)),
            "size_bytes": final_out.stat().st_size,
            "resolution": args.resolution,
            "broll_inserts": len(broll_inserts),
            "source_audio_carried": carry_source_audio,
            "show_captions": props.get("showCaptions", True),
            "retrofit": retrofit,
            "transcript_sha256": file_sha256(captions_transcript) if captions_transcript else None,
            "render_manifest_sha256": render_manifest["manifestSha256"],
            "output_sha256": render_manifest["output"]["sha256"],
            "source_path": render_manifest["source"]["path"],
            "source_sha256": render_manifest["source"]["sha256"],
        },
    )
    return final_out


_RENDERED_CAPTION_KEYS = (
    "vertical_anchor_ratio", "font_size_ratio", "page_size_words", "background",
    "hide_ranges_ms",
)


def rendered_layers(props: dict, *, owns_overlays: bool, transcript_words=None) -> dict:
    """What a render draws, for its run-log ``render_started`` and its review:
    the typed overlays, the caption style, and the caption words (the last
    spoken word and when it ends, and the caption text)."""
    overlays = [
        {"kind": str(item.get("kind", "")), "text": str(item.get("text", ""))[:160],
         "start": item.get("start"), "end": item.get("end")}
        for item in (props.get("overlays") or [])[:50] if isinstance(item, dict)
    ]
    layers: dict = {"rendered_overlays": overlays, "job_overlays_tsx": bool(owns_overlays)}
    transform = props.get("videoTransform")
    if isinstance(transform, dict):
        # Planned camera moves, so the review does not report them as jumps.
        layers["video_transform"] = {
            "ken_burns": bool(transform.get("ken_burns")),
            "punch_zooms": [
                {"at_sec": zoom.get("at_sec"), "duration_sec": zoom.get("duration_sec")}
                for zoom in (transform.get("punch_zooms") or [])[:50] if isinstance(zoom, dict)
            ],
            "focus_track": [
                {"at_sec": key.get("at_sec")}
                for key in (transform.get("focus_track") or [])[:50] if isinstance(key, dict)
            ] if isinstance(transform.get("focus_track"), list) else [],
        }
    style = props.get("captionStyle")
    if props.get("showCaptions", True) and isinstance(style, dict):
        layers["rendered_caption_style"] = {
            key: style[key] for key in _RENDERED_CAPTION_KEYS if key in style
        }
    if props.get("showCaptions", True) and transcript_words is not None:
        layers.update(caption_facts(transcript_words))
    return layers


def run_render(args, job_dir: Path, *, retrofit: bool) -> Path:
    """Render with exclusive ownership of the shared Remotion source tree."""
    with exclusive_remotion_render(REMOTION_DIR, job_id=job_dir.name):
        return _run_render_unlocked(args, job_dir, retrofit=retrofit)


def _job_local_path(job_dir: Path, raw: str, *, must_exist: bool) -> Path:
    path = Path(raw).expanduser()
    resolved = (path if path.is_absolute() else job_dir / path).resolve()
    try:
        resolved.relative_to(job_dir.resolve())
    except ValueError as exc:
        raise ValueError(f"bespoke Remotion paths must stay inside {job_dir}") from exc
    if must_exist and not resolved.is_file():
        raise FileNotFoundError(resolved)
    return resolved


def run_bespoke(args, job_dir: Path) -> Path:
    """Render one complete job-local composition through the shared lock."""
    if not args.entry or not args.composition:
        raise SystemExit("ERROR: --mode bespoke requires --entry and --composition.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", args.composition):
        raise ValueError("bespoke Remotion composition ID is invalid")
    ensure_remotion_installed()
    entry = _job_local_path(job_dir, args.entry, must_exist=True)
    if entry.suffix.lower() not in {".js", ".jsx", ".ts", ".tsx"}:
        raise ValueError("bespoke Remotion entry must be JavaScript or TypeScript")
    output = _job_local_path(job_dir, args.out or "final.mp4", must_exist=False)
    if output.suffix.lower() != ".mp4":
        raise ValueError("bespoke Remotion output must be an MP4")
    props: dict = {}
    props_path: Path | None = None
    if args.props:
        props_path = _job_local_path(job_dir, args.props, must_exist=True)
        props = json.loads(props_path.read_text())
        if not isinstance(props, dict):
            raise ValueError("bespoke Remotion props must be a JSON object")

    ensure_locked_plan(job_dir, *contract_roots())
    if completed_audio_mix(job_dir) is not None:
        raise SystemExit(
            "ERROR: bespoke rendering cannot prove it carries this job's completed "
            "audio mix. Remove the stale mix and re-score after rendering."
        )

    public_target = PUBLIC_DIR / JOBS_DIR_NAME / job_dir.name
    render_output = staging_path(output)
    started = time.perf_counter()
    log_event(job_dir, tool="compose_render.py", event="render_started", extra={
        "usage_role": "bespoke",
        "composition_id": args.composition,
        "entry": str(entry.relative_to(job_dir.resolve())),
        **({"props": str(props_path.relative_to(job_dir.resolve()))} if args.props else {}),
    })
    try:
        with exclusive_remotion_render(REMOTION_DIR, job_id=job_dir.name):
            props["jobPublicPath"] = link_job_into_public(job_dir)
            try:
                remotion_render(
                    props,
                    render_output,
                    entry=str(entry),
                    composition_id=args.composition,
                )
                if not render_output.is_file() or render_output.stat().st_size == 0:
                    raise RuntimeError("bespoke Remotion render produced no new output")
                publish_deliverable(job_dir, render_output, output, tool="compose_render",
                                    facts={"mode": "bespoke"})
            finally:
                render_output.unlink(missing_ok=True)
                if public_target.is_symlink() and public_target.resolve() == job_dir.resolve():
                    public_target.unlink()
    except Exception as exc:
        log_event(
            job_dir,
            tool="compose_render.py",
            event="render_failed",
            duration_seconds=time.perf_counter() - started,
            extra={"usage_role": "bespoke", "error": type(exc).__name__},
        )
        raise
    log_event(
        job_dir,
        tool="compose_render.py",
        event="render_completed",
        duration_seconds=time.perf_counter() - started,
        extra={
            "usage_role": "bespoke",
            "output_path": str(output.relative_to(job_dir.resolve())),
        },
    )
    return output


def apply_caption_cli_overrides(props: dict, args: argparse.Namespace) -> None:
    """Apply caption flags to the exact renderer-facing style object."""
    cs = props.get("captionStyle") or {}
    if args.caption_break:
        cs["page_break"] = args.caption_break
    if args.caption_vertical_anchor is not None:
        # CaptionPage reads vertical_anchor_ratio. The old key was silently
        # ignored, so agents could move captions in the CLI while the rendered
        # video left them over a face or platform UI.
        cs["vertical_anchor_ratio"] = float(args.caption_vertical_anchor)
    if args.emphasis_style:
        cs["emphasis_style"] = args.emphasis_style
    if cs:
        props["captionStyle"] = cs


def parse_hide_ranges(spec: str) -> list[list[float]]:
    """Parse "0.0-2.5,10-12" → [[0.0,2.5],[10.0,12.0]] (caption suppression)."""
    out = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" not in part:
            continue
        a, b = part.split("-", 1)
        out.append([float(a), float(b)])
    return out


# ═════════════════════════════════════════════════════════════════════════════
# MODE: cover_bake  (prepend a cover card into the head of a finished mp4)
# ═════════════════════════════════════════════════════════════════════════════

def run_cover_bake(args, job_dir: Path) -> Path:
    """Bake a cover card into the first N frames of an existing mp4.

    Holds the cover image for `--cover_duration` frames (at 30fps), then cuts to
    the main footage. Audio starts with the main footage (silent under the
    cover), per the spec success_check. ffmpeg concat to avoid re-encoding the
    body unnecessarily, falling back per the skill brief.
    """
    if not args.source_video:
        raise SystemExit("ERROR: --mode cover_bake requires --source_video <mp4>.")
    if not args.cover_image:
        raise SystemExit("ERROR: --mode cover_bake requires --cover_image <png>.")
    src = Path(args.source_video).resolve()
    cover = Path(args.cover_image).resolve()
    if not src.exists():
        raise FileNotFoundError(f"--source_video not found: {src}")
    if not cover.exists():
        raise FileNotFoundError(f"--cover_image not found: {cover}")

    cover_frames = int(args.cover_duration)
    fps = 30
    cover_sec = cover_frames / fps

    style_override = Path(args.style_directives).resolve() if getattr(args, "style_directives", None) else None
    canvas = job_inputs.explicit_video_canvas(load_style_directives(job_dir, style_override))
    media = _finishing_media(src)
    target = _finishing_canvas(media, args.resolution, canvas)
    out = job_dir / "final_covered.mp4"
    work = staging_path(out)

    # v0 = cover still (filled to frame, held cover_sec, silent)
    # v1 = body video
    # concat → seamless cut; body audio starts at the cut (cover plays silent).
    fc = (
        f"[0:v]{_fit_canvas_filter(_finishing_media(cover), target, cover=True)},"
        f"fps={fps},trim=0:{cover_sec:.3f},"
        f"setpts=PTS-STARTPTS[cv];"
        f"[1:v]{_fit_canvas_filter(media, target)},"
        f"fps={fps},setpts=PTS-STARTPTS[bv];"
        f"[cv][bv]concat=n=2:v=1:a=0[v]"
    )
    if media["has_audio"]:
        fc += (
        # silent pad for the cover, then the real body audio
        f";anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:{cover_sec:.3f},"
        f"asetpts=PTS-STARTPTS[ca];"
        f"[1:a]asetpts=PTS-STARTPTS[ba];"
        f"[ca][ba]concat=n=2:v=0:a=1[a]"
        )
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-loop", "1", "-t", f"{cover_sec:.3f}", "-i", str(cover),
        "-i", str(src),
        "-filter_complex", fc,
        "-map", "[v]", *(["-map", "[a]"] if media["has_audio"] else []),
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-metadata:s:v:0", "rotate=0",
        str(work),
    ]
    print(f"[cover_bake] {cover.name} ({cover_frames}f / {cover_sec:.2f}s) + {src.name} → {out.name}")
    log_event(job_dir, tool="compose_render.py", event="cover_bake_started",
              extra={"usage_role": args.mode, "cover": str(cover), "source": str(src),
                     "cover_frames": cover_frames, "resolution": args.resolution})
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log_event(job_dir, tool="compose_render.py", event="cover_bake_failed",
                      extra={"usage_role": args.mode, "error_message": r.stderr[-300:]})
            raise RuntimeError(f"cover_bake ffmpeg failed:\n{r.stderr[-800:]}")
        if args.loudnorm:
            finish_output(work, resolution=args.resolution, loudnorm=True, pre_roll=0.0,
                          canvas=target)
        publish_deliverable(job_dir, work, out, tool="compose_render",
                            facts={"mode": "cover_bake"})
    finally:
        work.unlink(missing_ok=True)
    print(f"✓ Covered video: {out} ({out.stat().st_size // 1024 // 1024}MB)")
    log_event(job_dir, tool="compose_render.py", event="cover_bake_completed",
              extra={"usage_role": args.mode, "output_path": str(out.relative_to(job_dir)),
                     "size_bytes": out.stat().st_size})
    return out


# ═════════════════════════════════════════════════════════════════════════════
# MODE: episode  (long-form authority-host assembly)
# ═════════════════════════════════════════════════════════════════════════════

def assemble_episode(
    *,
    lipsync: Path,
    ambience: Path,
    cover: Path,
    out: Path,
    endcard_sec: float = 4.0,
    bed_vol: float = 0.16,
    fade: float = 0.4,
    pre_roll: float = 0.0,
) -> Path:
    """Finish an authority-host episode (preserved from assemble_episode.py).

    Continuous ambience bed (e.g. fireplace) under the whole thing (voice + end card); voice over
    the talking-head portion; fade-to-black into the book-cover end card (cover
    filled to 9:16, slow push-in). `pre_roll` optionally pads black/silence at
    the head (intro slate).
    """
    L = probe_dur(lipsync)
    total = L + endcard_sec
    fo = max(0.0, L - fade)  # fade-out start for main video

    fc = (
        f"[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920,setsar=1,fade=t=out:st={fo:.2f}:d={fade}[v0];"
        f"[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
        f"fps=30,setsar=1,fade=t=in:st=0:d=0.5[v1];"
        f"[v0][v1]concat=n=2:v=1:a=0[v];"
        f"[0:a]afade=t=out:st={fo:.2f}:d={fade}[vo];"
        f"[2:a]aloop=loop=-1:size=2e9,atrim=0:{total:.2f},volume={bed_vol},"
        f"afade=t=in:st=0:d=0.6,afade=t=out:st={total-0.6:.2f}:d=0.6[bed];"
        f"[vo][bed]amix=inputs=2:duration=longest:normalize=0[a]"
    )
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(lipsync),
        "-loop", "1", "-t", f"{endcard_sec}", "-i", str(cover),
        "-i", str(ambience),
        "-filter_complex", fc,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        str(out),
    ]
    print(f"[episode/assemble] {lipsync.name} ({L:.1f}s) + {endcard_sec}s end card "
          f"(total {total:.1f}s)")
    r = subprocess.run(cmd)
    if r.returncode != 0:
        raise RuntimeError("episode assemble ffmpeg failed")
    if pre_roll and pre_roll > 0:
        finish_output(out, resolution="1080p", loudnorm=False, pre_roll=pre_roll)
    print("[episode/assemble] built")
    return out


# ── Full make_episode orchestration (book-video path) ────────────────────────

def _episode_paths(job_dir: Path):
    """Resolve the authority-host directory tree from the job dir."""
    repo = REMOTION_DIR.parent
    host = job_dir
    fire = billing_input_path(repo / "fireplace.mp3")
    bed = billing_input_path(host / "host_bed_v3.mp4")
    broll = host / "broll"
    return repo, host, fire, bed, broll


def _ol_cover_url(title: str, author: str) -> str | None:
    """Find a real cover via Open Library (preserved from make_episode.py)."""
    try:
        import requests
        r = requests.get("https://openlibrary.org/search.json",
                         params={"title": title, "author": author, "limit": 3}, timeout=30)
        for d in r.json().get("docs", []):
            cid = d.get("cover_i")
            if cid:
                url = f"https://covers.openlibrary.org/b/id/{cid}-L.jpg"
                h = requests.get(url, timeout=30)
                if h.ok and len(h.content) > 5000:
                    return url
    except Exception as e:
        print(f"[episode] OL lookup failed: {e}", file=sys.stderr)
    return None


def _trigger_time(vo_mp3: Path, phrase: str, total: float, job: Path) -> float:
    """Transcribe VO, return start time of `phrase` in the last third.

    Preserved from make_episode.py — drops the tools dir from sys.path so the
    genuine `elevenlabs` package imports rather than any local shadow.
    """
    started = time.perf_counter()
    if gateway.enabled():
        result = gateway.run(
            "synth_voice", mode="transcribe", references=[vo_mp3],
            params={"diarize": False}, job=job, timeout_s=900,
        )
        d = result["output"]
    else:
        _here = os.path.dirname(os.path.abspath(__file__))
        _saved = list(sys.path)
        sys.path = [p for p in sys.path if os.path.abspath(p or ".") != _here]
        try:
            from elevenlabs.client import ElevenLabs
        finally:
            sys.path = _saved
        c = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
        with open(vo_mp3, "rb") as f:
            r = c.speech_to_text.convert(file=f, model_id="scribe_v2")
        d = r.model_dump() if hasattr(r, "model_dump") else dict(r)
    log_event(
        job, tool="compose_render.py", event="episode_trigger_transcribed",
        duration_seconds=time.perf_counter() - started,
        extra={"usage_role": "episode_transcribe", "model": "scribe_v2",
               "words": len(d.get("words", [])),
               **({} if gateway.enabled() else {"estimate_usd": 0.05})},
    )
    ws = [(((w.get("text") or w.get("word") or "").strip()), w.get("start"))
          for w in d.get("words", []) if (w.get("text") or w.get("word") or "").strip()]
    want = [t.lower().strip(".,'\"") for t in phrase.split()]
    cutoff = total * 0.6
    found = None
    toks = [(t.lower().strip(".,'\""), s) for t, s in ws]
    for i in range(len(toks) - len(want) + 1):
        if [toks[i + j][0] for j in range(len(want))] == want and toks[i][1] and toks[i][1] >= cutoff:
            found = toks[i][1]
    if found is None:
        found = max(0.0, total - 4.5)
    return max(0.0, found - 0.25)


def _sh(cmd: list[str], repo: Path, **kw):
    r = subprocess.run(cmd, cwd=repo, **kw)
    if r.returncode != 0:
        sys.exit(f"step failed: {' '.join(cmd[:4])}...")
    return r


def _enforce_episode_vo_duration(duration_seconds: float, job: Path) -> None:
    """Stop before lipsync when generated VO exceeds the bounded plan maximum."""
    if duration_seconds <= EPISODE_MAX_VO_SECONDS:
        return
    log_event(
        job, tool="compose_render.py", event="episode_vo_too_long",
        extra={"usage_role": "episode", "duration_seconds": duration_seconds,
               "max_duration_seconds": EPISODE_MAX_VO_SECONDS},
    )
    raise RuntimeError(
        f"episode VO is {duration_seconds:.1f}s; the bounded episode plan allows at most "
        f"{EPISODE_MAX_VO_SECONDS:.0f}s before lipsync"
    )


def _episode_stream_types(path: Path) -> set[str]:
    """Return declared media stream types or fail on an unreadable container."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
         "-of", "json", str(path)],
        capture_output=True, text=True, timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError(f"episode prerequisite is unreadable: {path}: {result.stderr.strip()}")
    try:
        return {str(stream["codec_type"])
                for stream in json.loads(result.stdout).get("streams", [])}
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"episode prerequisite has invalid probe output: {path}") from exc


def _preflight_episode_inputs(args, fire: Path, bed: Path, broll: Path) -> None:
    """Decode-check every immutable late prerequisite before the first paid child."""
    media: list[tuple[Path, set[str], str]] = [
        (billing_input_path(fire), {"audio"}, "fireplace audio"),
        (billing_input_path(bed), {"video"}, "host bed"),
    ]
    media.extend(
        (billing_input_path(broll / f"{name}.mp4"), {"video", "audio"},
         f"episode B-roll {name}")
        for name in [*INTERIOR_BROLL, HOUSE_BROLL]
    )
    for path, required_streams, label in media:
        try:
            duration = ffprobe_duration(path, timeout_sec=15)
        except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError) as exc:
            raise RuntimeError(f"{label} failed preflight: {path}") from exc
        if not duration > 0:
            raise RuntimeError(f"{label} has no positive duration: {path}")
        missing = required_streams - _episode_stream_types(path)
        if missing:
            raise RuntimeError(
                f"{label} is missing required {', '.join(sorted(missing))} stream: {path}"
            )

    if args.card:
        card = billing_input_path(Path(args.card))
        try:
            with Image.open(card) as image:
                image.verify()
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"prebuilt episode card failed preflight: {card}") from exc


def episode_output_path(job_dir: Path, raw: str) -> Path:
    """Resolve ``--out`` for an episode inside the job, or refuse it.

    Accepts a job-relative path (``ep_final.mp4``), a path relative to the
    working directory that lands in the job (``jobs/<id>/ep_final.mp4``), or an
    absolute path inside the job. Anything else is refused before any work.
    """
    root = job_dir.resolve()
    path = Path(raw).expanduser()
    candidates = [path] if path.is_absolute() else [Path.cwd() / path, job_dir / path]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved != root and root in resolved.parents:
            if resolved.suffix.lower() not in {".mp4", ".mov"}:
                break
            return resolved
    raise SystemExit(
        f"ERROR: --out {raw} must be an .mp4/.mov inside the job folder {job_dir}; "
        "no episode was started.")


def episode_output(args, job_dir: Path) -> Path:
    """Where make_episode publishes: finals/ep<NN>_<slug>.mp4."""
    return _episode_paths(job_dir)[1] / "finals" / f"ep{args.num:02d}_{args.slug}.mp4"


def make_episode(args, job_dir: Path, out: Path | None = None) -> Path:
    """One-command authority-host book episode (preserved from make_episode.py).

    VO (locked voice) → lipsync (footage long) onto host_bed_v3 → real-cover book
    card → overlay the card on the title-mention word near the end + fireplace bed →
    finals/ep<NN>_<slug>.mp4. Shells out to the canonical consolidated tools
    (synth_voice --mode tts, lipsync_footage long, mint_image --role card).
    """
    repo, host, FIRE, BED, BROLL = _episode_paths(job_dir)
    JOB = host.name
    _preflight_episode_inputs(args, FIRE, BED, BROLL)

    finals = host / "finals"
    finals.mkdir(parents=True, exist_ok=True)
    work = host / "_work" / args.slug
    work.mkdir(parents=True, exist_ok=True)

    # 1) VO (reuse if generated)
    text = Path(args.script).read_text().strip()
    if not text:
        raise RuntimeError("episode script is empty; refusing paid voice synthesis")
    vo = host / "tts" / f"ep_{args.slug}.mp3"
    if vo.exists() and probe_dur(vo) > 1:
        print(f"[episode] {args.slug}: VO exists, reusing")
    else:
        print(f"[episode] {args.slug}: VO ...")
        _sh(["uv", "run", "python", "tools/synth_voice.py", "--mode", "tts", "--job", JOB,
             "--beat-id", f"ep_{args.slug}", "--voice", HOST_VOICE, "--no-stretch",
             "--text", text], repo)
    dur = probe_dur(vo)
    print(f"[episode] VO {dur:.1f}s")
    _enforce_episode_vo_duration(dur, host)

    # 2) trim bed to VO + headroom, lipsync (reuse if done)
    lip = work / "lipsync.mp4"
    if lip.exists() and probe_dur(lip) > 1:
        print("[episode] lipsync exists, reusing")
    else:
        bed_trim = work / "bed.mp4"
        _sh(["ffmpeg", "-y", "-loglevel", "error", "-i", str(BED), "-t", f"{dur + 1.5:.2f}",
             "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
             "-an", str(bed_trim)], repo)
        print("[episode] lipsync ...")
        _sh(["uv", "run", "python", "tools/lipsync_footage.py", "long", "--job", JOB,
             "--max-seg", "58", "--video", str(bed_trim), "--audio", str(vo),
             "--output", str(lip)], repo)

    # 3) card (real cover → v4 style), unless prebuilt provided
    if args.card:
        card = Path(args.card)
    elif (host / "images" / f"{args.slug}_card.png").exists():
        card = host / "images" / f"{args.slug}_card.png"
        print(f"[episode] card exists, reusing {card.name}")
    else:
        card = host / "images" / f"{args.slug}_card.png"
        ref = _ol_cover_url(args.title, args.author)
        prompt = CARD_STYLE.format(title=args.title, author=args.author, idea=args.idea)
        cmd = ["uv", "run", "python", "tools/mint_image.py", "--job", JOB,
               "--role", "card", "--name", f"{args.slug}_card", "--aspect-ratio", "1:1",
               "--quality", "high", "--prompt", prompt]
        if ref:
            cmd += ["--reference", ref]
            print(f"[episode] card from real cover: {ref}")
        else:
            print("[episode] WARN: no real cover found; generating styled card without reference")
        _sh(cmd, repo)

    # 4) seam cutaways + house/card ending + fireplace bed
    dur_lip = probe_dur(lip)
    T = _trigger_time(vo, args.trigger, dur, host)
    ending_start = max(0.0, T - 0.25)
    print(f"[episode] ending (house+card) at {T:.2f}s")

    rng = random.Random(args.num)
    pool = INTERIOR_BROLL[:]
    rng.shuffle(pool)
    windows = []
    ci = 0
    for cs in INTERIOR_CUTS:
        ce = cs + CUT_LEN
        if ce > ending_start - 0.5:
            continue
        windows.append((cs, ce, billing_input_path(BROLL / f"{pool[ci % len(pool)]}.mp4")))
        ci += 1
    windows.append((ending_start, dur_lip,
                    billing_input_path(BROLL / f"{HOUSE_BROLL}.mp4")))
    print(f"[episode] {len(windows)-1} interior cutaways + house ending "
          f"@ {', '.join(f'{w[0]:.0f}s' for w in windows)}")

    inputs = ["-i", str(lip), "-i", str(FIRE),
              "-loop", "1", "-t", f"{dur_lip:.2f}", "-i", str(card)]
    for _, _, clip in windows:
        inputs += ["-i", str(clip)]

    fc = []
    prev = "[0:v]"
    for i, (ws, we, _) in enumerate(windows):
        idx = 3 + i
        fc.append(f"[{idx}:v]setpts=PTS-STARTPTS+{ws:.2f}/TB,"
                  f"tpad=stop_mode=clone:stop_duration=8[bv{i}]")
        fc.append(f"{prev}[bv{i}]overlay=0:0:enable='between(t,{ws:.2f},{we:.2f})'[ov{i}]")
        prev = f"[ov{i}]"
    fc.append(f"[2:v]scale=680:680,format=rgba,fade=t=in:st={T:.2f}:d=0.35:alpha=1[card]")
    fc.append(f"{prev}[card]overlay=200:720:enable='gte(t,{T:.2f})'[vout]")

    win_expr = "+".join(f"between(t,{ws:.2f},{we:.2f})" for ws, we, _ in windows)
    fc.append("[0:a]volume=1.0[av]")
    fc.append(f"[1:a]atrim=0:{dur_lip:.2f},volume='if({win_expr},0,{BED_VOL})':eval=frame[bed]")
    sfx = []
    for i, (ws, we, _) in enumerate(windows):
        idx = 3 + i
        ms = int(ws * 1000)
        fc.append(f"[{idx}:a]adelay={ms}|{ms},volume={SFX_VOL}[sa{i}]")
        sfx.append(f"[sa{i}]")
    fc.append("[av][bed]" + "".join(sfx) +
              f"amix=inputs={2+len(windows)}:duration=first:normalize=0[aout]")

    out = out or episode_output(args, job_dir)
    _sh(["ffmpeg", "-y", "-loglevel", "error", *inputs,
         "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
         "-t", f"{dur_lip:.2f}",
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", str(out)], repo)
    print(f"[episode] built ({probe_dur(out):.1f}s)")
    return out


def run_episode(args, job_dir: Path) -> Path:
    """Episode mode dispatcher.

    Two sub-paths, both preserved verbatim from the absorbed backends:
      * assemble  — finish an already-lipsynced episode (assemble_episode.py).
                    Triggered by --lipsync + --ambience + --cover.
      * make      — full one-command book episode (make_episode.py).
                    Triggered by --num + --slug + --script + --title + ...
    """
    style_override = Path(args.style_directives).resolve() if args.style_directives else None
    canvas = job_inputs.explicit_video_canvas(load_style_directives(job_dir, style_override))
    if canvas is not None and canvas != (1080, 1920):
        raise SystemExit(
            "ERROR: --mode episode supports only the 1080x1920 portrait canvas. "
            "Use --mode render or bespoke for another canvas; no episode was started.")
    # The episode is a deliverable of this job: it is written inside the job
    # (and so recorded and reviewed), never somewhere else.
    episode_out = (episode_output_path(job_dir, args.out) if args.out
                   else job_dir / "ep_final.mp4")
    log_event(job_dir, tool="compose_render.py", event="episode_started",
              extra={"usage_role": args.mode})

    # manifest path: a seam manifest names the spine + the seam-B-roll cutaways
    # to drop over the lipsync-stitch seams. Minimal: composite inserts onto the
    # spine and (optionally) hand the result to assemble for ambience/end-card.
    if args.episode_manifest:
        mpath = billing_input_path(Path(args.episode_manifest))
        if not mpath.exists():
            raise SystemExit(f"ERROR: --episode_manifest not found: {mpath}")
        manifest = json.loads(_strip_md_fence(mpath.read_text()))
        spine = manifest.get("spine") or manifest.get("lipsync") or args.lipsync
        if not spine:
            raise SystemExit(
                "ERROR: episode manifest needs a \"spine\" (lipsync mp4) key "
                "(or pass --lipsync)."
            )
        spine_path = Path(spine)
        if not spine_path.is_absolute():
            spine_path = (job_dir / spine_path).resolve()
        spine_path = billing_input_path(spine_path)
        if not spine_path.exists():
            raise FileNotFoundError(f"manifest spine not found: {spine_path}")
        if canvas is None:
            # A manifest inherits its spine's display size, not a resolution preset.
            media = _finishing_media(spine_path)
            canvas = (max(2, round(media["width"] / 2) * 2),
                      max(2, round(media["height"] / 2) * 2))
            try:
                canvas = _finishing_canvas(media, "1080p", canvas)
            except ValueError as exc:
                raise ValueError(
                    f"Episode spine display geometry {media['width']}x{media['height']} "
                    "exceeds local finishing limits; choose a supported explicit canvas") from exc
        # The manifest itself carries the inserts list; reuse the same loader.
        inserts = _load_broll_inserts(str(mpath), job_dir, from_manifest=True)
        out = episode_out
        work = staging_path(out)

        def build() -> None:
            shutil.copy2(spine_path, work)
            # Match cutaways to displayed pixels, not a rotated spine's stored size.
            finish_output(work, resolution="1080p", loudnorm=False, pre_roll=0.0,
                          canvas=canvas)
            overlay_broll_inserts(work, inserts)
            print(f"[episode/manifest] {spine_path.name} + {len(inserts)} seam insert(s)")
    # assemble path (explicit lipsync/ambience/cover supplied)
    elif args.lipsync or args.ambience or args.cover:
        missing = [f for f, v in (("--lipsync", args.lipsync),
                                  ("--ambience", args.ambience),
                                  ("--cover", args.cover)) if not v]
        if missing:
            raise SystemExit(f"ERROR: episode assemble path requires {', '.join(missing)}.")
        out = episode_out
        work = staging_path(out)

        def build() -> None:
            assemble_episode(
                lipsync=Path(args.lipsync), ambience=Path(args.ambience),
                cover=Path(args.cover), out=work,
                endcard_sec=args.endcard_sec, bed_vol=args.bed_vol, fade=args.fade,
                pre_roll=args.pre_roll or 0.0,
            )
    # full make path (book metadata supplied)
    elif args.num is not None and args.slug and args.script:
        for f, v in (("--num", args.num), ("--slug", args.slug), ("--script", args.script),
                     ("--title", args.title), ("--author", args.author),
                     ("--idea", args.idea), ("--trigger", args.trigger)):
            if v in (None, ""):
                raise SystemExit(f"ERROR: episode make path requires {f}.")
        out = episode_output(args, job_dir)
        work = staging_path(out)

        def build() -> None:
            make_episode(args, job_dir, out=work)
    else:
        raise SystemExit(
            "ERROR: --mode episode needs ONE of:\n"
            "  assemble: --lipsync <mp4> --ambience <mp3> --cover <png> [--out <mp4>]\n"
            "  make:     --num N --slug S --script <txt> --title T --author A "
            "--idea I --trigger PHRASE [--card <png>]\n"
            "  manifest: --episode_manifest <json> with a \"spine\" mp4 + "
            "\"seams\"/\"inserts\" [{start,end,clip}] to overlay [--out <mp4>]"
        )

    # Every episode path builds and finishes into a staging file; the output
    # path only ever receives the complete bytes.
    try:
        build()
        if args.loudnorm or canvas:
            finish_output(work, resolution="1080p", loudnorm=args.loudnorm, pre_roll=0.0,
                          canvas=canvas)
        publish_deliverable(job_dir, work, out, tool="compose_render", facts={"mode": "episode"})
    finally:
        work.unlink(missing_ok=True)
    print(f"✓ Episode: {out}")
    print(f"  ▶ WATCH → file://{out.resolve()}")
    log_event(job_dir, tool="compose_render.py", event="episode_completed",
              extra={"usage_role": args.mode, "output_path": str(out)})
    return out


# ═════════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════════

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, 
        prog="compose_render.py",
        description="Canonical Remotion compositor + episode assembler. "
                    "ONE tool; --mode picks the assembly shape.",
    )
    add_job_arg(p)
    p.add_argument("--mode", required=True,
                   choices=["render", "retrofit", "cover_bake", "episode", "bespoke"],
                   help="Assembly shape. REQUIRED. Logged as usage_role.")

    # Spec-level finishing flags (apply across modes).
    p.add_argument("--resolution", default="720p", choices=["1080p", "720p"],
                   help="Final output resolution. Default 720p (MEMORY: only escalate to "
                        "1080p when the user asks). Caps the short edge without upscaling; "
                        "explicit style_directives width/height take precedence.")
    p.add_argument("--loudnorm", action="store_true",
                   help="Run EBU R128 (loudnorm) normalisation on the output audio.")
    p.add_argument("--pre_roll", type=float, default=None,
                   help="Prepend N seconds of black + silence (intro slate / pad).")

    # render / retrofit caption + overlay controls.
    p.add_argument("--caption-preset", dest="caption_preset", metavar="NAME", default=None,
                   help="Caption look — one of: tiktok, clean, mono, highlighter, editorial, "
                        "handwritten (see skills/caption_presets.md). REQUIRED when captions are on, "
                        "UNLESS style_directives sets caption_preset/caption_style or you pass "
                        "--no-captions. There is no silent default.")
    p.add_argument("--style_directives", metavar="JSON",
                   help="Path to a style_directives.json (default: <job_dir>/style_directives.json).")
    p.add_argument("--overlays_tsx", metavar="PATH",
                   help="Path to overlays.tsx to use (default: <job_dir>/overlays.tsx). "
                        "Copied into the Remotion src tree before render.")
    p.add_argument("--caption_break", choices=["sentence", "word", "duration"],
                   help="Caption chunk size (sentence is the Coaching Gems default).")
    p.add_argument("--caption_vertical_anchor", type=float, default=None,
                   help="Vertical position of the caption block, 0.0 (top) – 1.0 (bottom).")
    p.add_argument("--emphasis_style",
                   help="How emphasised words render (e.g. pop, glow, underline).")
    p.add_argument("--hide_ranges", metavar="START-END,...",
                   help="Suppress captions over these time ranges (e.g. during a card beat).")
    p.add_argument("--no-captions", action="store_true",
                   help="Disable burned-in captions (overlays still apply).")
    p.add_argument("--legacy-overlays", action="store_true",
                   help="Force-keep legacy auto-overlays even when overlays.tsx exists.")
    p.add_argument("--no-overlays", action="store_true",
                   help="Disable hook/URL/lower-third overlays (captions still apply).")
    p.add_argument("--broll-inserts", metavar="JSON",
                   help="Seam B-roll cutaways to composite over the spine (render/retrofit). "
                        "Inline JSON array or a path to a .json file: "
                        '[{"start":29.8,"end":34.0,"clip":"broll/seam_journal_clip.mp4"}]. '
                        "Each entry covers [start,end) with the minted still/clip "
                        "(authority-host method, hiding lipsync-stitch seams). Clip paths "
                        "are resolved relative to the job dir. Spine audio is preserved.")
    p.add_argument("--platform", default="all_platforms",
                   help="Red-zone platform for layout pre-flight (default: all_platforms).")
    p.add_argument("--skip-preflight", action="store_true",
                   help="Skip layout pre-flight (red zones + face collision).")
    p.add_argument("--strict-preflight", action="store_true",
                   help="Refuse to render if pre-flight finds ANY issue (default: warn-only).")
    p.add_argument("--allow-stub-overlays", metavar="REASON", default=None,
                   help="Optionally document why this render intentionally omits "
                        "<job_dir>/overlays.tsx; the reason is logged to adaptation_notes.md.")

    # retrofit / cover_bake source inputs.
    p.add_argument("--source_video", metavar="MP4",
                   help="Existing video for retrofit / cover_bake.")
    p.add_argument("--cover_image", metavar="PNG",
                   help="Cover card PNG for cover_bake.")
    p.add_argument("--cover_duration", type=int, default=60,
                   help="Cover hold length in FRAMES (30fps) for cover_bake. Default 60 (2s).")

    # episode mode — manifest + both absorbed-backend interfaces.
    p.add_argument("--episode_manifest", metavar="JSON",
                   help="Episode manifest describing ordered segments (long-form assembly).")
    # episode/assemble (assemble_episode.py)
    p.add_argument("--lipsync", help="[episode/assemble] lipsynced talking-head mp4.")
    p.add_argument("--ambience", "--fireplace", dest="ambience",
                   help="[episode/assemble] ambience/music bed under the whole episode "
                        "(any register — fireplace, rain, room tone). "
                        "--fireplace is the deprecated alias.")
    p.add_argument("--cover", help="[episode/assemble] book-cover end-card png.")
    p.add_argument("--out", help="[episode/assemble or bespoke] job-local output mp4 path.")
    p.add_argument("--entry", help="[bespoke] job-local Remotion entry file.")
    p.add_argument("--composition", help="[bespoke] composition ID.")
    p.add_argument("--props", help="[bespoke] optional job-local JSON props file.")
    p.add_argument("--endcard-sec", type=float, default=4.0, help="[episode/assemble] end-card seconds.")
    p.add_argument("--bed-vol", type=float, default=0.16, help="[episode/assemble] ambience bed volume.")
    p.add_argument("--fade", type=float, default=0.4, help="[episode/assemble] fade-out seconds.")
    # episode/make (make_episode.py)
    p.add_argument("--num", type=int, default=None, help="[episode/make] episode number (ep## prefix).")
    p.add_argument("--slug", help="[episode/make] episode slug.")
    p.add_argument("--script", help="[episode/make] path to the spoken-text .txt.")
    p.add_argument("--title", help="[episode/make] book title.")
    p.add_argument("--author", help="[episode/make] book author.")
    p.add_argument("--idea", help="[episode/make] one-line takeaway shown on the card.")
    p.add_argument("--trigger", help="[episode/make] phrase to land the card on (usually the title).")
    p.add_argument("--card", help="[episode/make] path to a prebuilt card png (skip generation).")
    return p


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    """Tool-owned manifest using the same parser/path readers as execution.

    Local-only render inputs are outside #210's spend-binding boundary: they
    cannot change a provider payload or paid fan-out.  Episode-make inputs are
    bound, and guarded execution disables its paid-output caches so every child
    provider call matches the fingerprinted shape.
    """
    job = billing_job_path(args.job, cwd)
    inputs: list[dict] = []
    direct: dict[str, str | None]
    role = args.mode
    if args.mode in {"render", "retrofit"}:
        direct = {"style_directives": args.style_directives,
                  "overlays_tsx": args.overlays_tsx,
                  **({"source_video": args.source_video}
                     if args.mode == "retrofit" else {})}
    elif args.mode == "bespoke":
        direct = {"entry": args.entry, "props": args.props}
    elif args.mode == "cover_bake":
        direct = {"source_video": args.source_video, "cover_image": args.cover_image}
    elif args.episode_manifest:
        role = "episode_manifest"
        direct = {"episode_manifest": args.episode_manifest,
                  **({"lipsync": args.lipsync} if args.lipsync else {})}
    elif args.lipsync or args.ambience or args.cover:
        role = "episode_assemble"
        direct = {"lipsync": args.lipsync, "ambience": args.ambience,
                  "cover": args.cover}
    else:
        if args.mode == "episode" and args.card:
            role = "episode_prebuilt_card"
        direct = {"script": args.script, "card": args.card}
    for dest, value in direct.items():
        if value:
            path = Path(value).expanduser()
            if not path.is_absolute():
                path = (job if args.mode == "bespoke" else cwd) / path
            inputs.append({"path": str(path), "dest": dest})
    if args.episode_manifest:
        manifest_path = Path(args.episode_manifest).expanduser()
        if not manifest_path.is_absolute():
            manifest_path = cwd / manifest_path
        manifest = json.loads(_strip_md_fence(
            billing_input_path(manifest_path).read_text()))
        spine = manifest.get("spine") or manifest.get("lipsync") or args.lipsync
        if spine:
            spine_path = Path(spine).expanduser()
            if not spine_path.is_absolute():
                spine_path = job / spine_path
            inputs.append({"path": str(spine_path), "kind": "compose_media"})
        for insert in _load_broll_inserts(str(manifest_path), job, from_manifest=True):
            inputs.append({"path": str(insert["clip"]), "kind": "compose_media"})
    if args.broll_inserts and args.mode in {"render", "retrofit"}:
        spec = args.broll_inserts.strip()
        candidate = Path(spec)
        inline = spec.startswith(("[", "{"))
        if not inline and candidate.exists():
            inputs.append({"path": str(candidate.absolute()), "dest": "broll_inserts",
                           "structured_kind": "compose_manifest"})
        for insert in _load_broll_inserts(args.broll_inserts, job):
            inputs.append({"path": str(insert["clip"]), "kind": "compose_media",
                           **({"inline_dest": "broll_inserts"} if inline else {})})
    if role in {"episode", "episode_prebuilt_card"} and args.num is not None:
        repo, host, fire, bed, broll = _episode_paths(job)
        inputs.extend([{"path": str(fire), "kind": "episode_static"},
                       {"path": str(bed), "kind": "episode_host_bed"}])
        inputs.extend({"path": str(broll / f"{name}.mp4"), "kind": "episode_broll"}
                      for name in [*INTERIOR_BROLL, HOUSE_BROLL])
    return {"role": role, "count": 1, "inputs": inputs}


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    job_dir = resolve_job_dir(args.job)

    # --overlays_tsx override: stage the chosen file as <job_dir>/overlays.tsx so
    # the standard link_job_overlays path picks it up.
    if args.overlays_tsx and args.mode in {"render", "retrofit"}:
        src = Path(args.overlays_tsx).resolve()
        if not src.exists():
            raise FileNotFoundError(f"--overlays_tsx not found: {src}")
        dst = job_dir / "overlays.tsx"
        if src != dst.resolve():
            shutil.copy2(src, dst)
            print(f"Staged overlays.tsx ← {src}")

    print(f"Mode:   {args.mode}  (usage_role)")
    if args.mode == "render":
        run_render(args, job_dir, retrofit=False)
    elif args.mode == "retrofit":
        run_render(args, job_dir, retrofit=True)
    elif args.mode == "cover_bake":
        run_cover_bake(args, job_dir)
    elif args.mode == "episode":
        run_episode(args, job_dir)
    elif args.mode == "bespoke":
        output = run_bespoke(args, job_dir)
        print(f"\n✓ Bespoke final: {output}")
        print(f"  ▶ WATCH → file://{output.resolve()}")
    else:  # pragma: no cover — argparse choices guard this
        raise SystemExit(f"unknown mode: {args.mode}")


if __name__ == "__main__":
    main()
