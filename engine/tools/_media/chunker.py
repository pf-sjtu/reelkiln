"""Video chunking + ffmpeg helpers.

Adapted from ssrajadh/sentrysearch (Apache-2.0). v1 = fixed overlapping windows.
Semantic/shot-detection chunking is a deferred v2 swap-in (see MEDIA_LIBRARY_PLAN.md
§2.2): everything downstream is chunk-shape-agnostic, so only `chunk_video` changes.
"""

from __future__ import annotations

import functools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

SUPPORTED_VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
SUPPORTED_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif")


def is_supported_video_file(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_VIDEO_EXTENSIONS


def is_supported_image_file(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


@functools.lru_cache(maxsize=1)
def ffmpeg_bin() -> str:
    """A usable ffmpeg: system ffmpeg, else imageio-ffmpeg's bundled binary."""
    sys_ff = shutil.which("ffmpeg")
    if sys_ff:
        return sys_ff
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "ffmpeg not found on PATH and imageio-ffmpeg is unavailable. "
            "Install ffmpeg (brew install ffmpeg) or `uv add imageio-ffmpeg`."
        ) from exc


def get_video_duration(video_path: str) -> float:
    """Duration in seconds (ffprobe preferred, ffmpeg-stderr fallback)."""
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        r = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", video_path],
            capture_output=True, text=True, check=True,
        )
        return float(json.loads(r.stdout)["format"]["duration"])
    r = subprocess.run([ffmpeg_bin(), "-i", video_path], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    if not m:
        raise RuntimeError("Could not determine video duration.")
    h, mn, s = m.groups()
    return int(h) * 3600 + int(mn) * 60 + float(s)


def expected_chunk_spans(duration: float, chunk_duration: int = 30,
                         overlap: int = 5) -> list[tuple[float, float]]:
    """The (start, end) spans chunk_video would produce — without splitting.

    Used to compute deterministic chunk IDs for resume/skip logic.
    """
    if overlap >= chunk_duration:
        raise ValueError(f"overlap ({overlap}s) must be < chunk_duration ({chunk_duration}s).")
    if duration <= chunk_duration:
        return [(0.0, float(duration))]
    step = chunk_duration - overlap
    spans: list[tuple[float, float]] = []
    start = 0.0
    while start < duration:
        spans.append((start, min(start + chunk_duration, duration)))
        start += step
        if start + overlap >= duration:
            break
    return spans


def chunk_video(video_path: str, chunk_duration: int = 30, overlap: int = 5) -> list[dict]:
    """Split a video into overlapping chunks (stream-copy, fast).

    Returns dicts: {chunk_path, source_file, start_time, end_time}. Caller cleans up
    chunk_path / the temp dir.
    """
    video_path = str(Path(video_path).resolve())
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    ff = ffmpeg_bin()
    spans = expected_chunk_spans(get_video_duration(video_path), chunk_duration, overlap)
    tmp_dir = tempfile.mkdtemp(prefix="vc_media_")
    chunks = []
    for idx, (start, end) in enumerate(spans):
        chunk_path = os.path.join(tmp_dir, f"chunk_{idx:03d}.mp4")
        subprocess.run(
            [ff, "-y", "-ss", str(start), "-i", video_path, "-t", str(end - start),
             "-c", "copy", chunk_path],
            capture_output=True, check=True,
        )
        chunks.append({"chunk_path": chunk_path, "source_file": video_path,
                       "start_time": start, "end_time": end})
    return chunks


def is_still_frame_chunk(chunk_path: str, threshold: float = 0.98) -> bool:
    """Heuristic: 3 evenly-spaced frames with near-identical JPEG sizes ⇒ static."""
    try:
        ff = ffmpeg_bin()
        r = subprocess.run([ff, "-i", chunk_path, "-map", "0:v:0", "-c", "copy",
                            "-f", "null", "-"], capture_output=True, text=True)
        m = re.search(r"frame=\s*(\d+)", r.stderr)
        if m:
            total = int(m.group(1))
        else:
            fpsm = re.search(r"(\d+(?:\.\d+)?)\s+fps", r.stderr)
            durm = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
            if not fpsm or not durm:
                return False
            h, mn, s = durm.groups()
            total = int((int(h) * 3600 + int(mn) * 60 + float(s)) * float(fpsm.group(1)))
        if total < 3:
            return False
        f1, f2 = total // 3, 2 * total // 3
        td = tempfile.mkdtemp(prefix="vc_still_")
        subprocess.run([ff, "-y", "-i", chunk_path,
                        "-vf", f"select=eq(n\\,0)+eq(n\\,{f1})+eq(n\\,{f2})",
                        "-vsync", "vfr", os.path.join(td, "f_%03d.jpg")],
                       capture_output=True, check=True)
        sizes = [os.path.getsize(os.path.join(td, f)) for f in os.listdir(td) if f.endswith(".jpg")]
        shutil.rmtree(td, ignore_errors=True)
        if len(sizes) < 2 or max(sizes) == 0:
            return False
        return min(sizes) / max(sizes) >= threshold
    except Exception:
        return False


def preprocess_chunk(chunk_path: str, target_resolution: int = 480,
                     target_fps: int = 5) -> str:
    """Downscale + drop fps before embedding (smaller upload, faster). Best-effort."""
    try:
        ff = ffmpeg_bin()
        base, ext = os.path.splitext(chunk_path)
        out = f"{base}_pp{ext}"
        # quality is irrelevant (this feeds the embedder, which samples ~1fps) —
        # so prioritize encode SPEED: ultrafast preset, no audio.
        subprocess.run([ff, "-y", "-i", chunk_path,
                        "-vf", f"scale=-2:{target_resolution},fps={target_fps}",
                        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
                        "-an", out],
                       capture_output=True, check=True)
        return out
    except Exception:
        return chunk_path


def file_signature(path: str, head: int = 1 << 20) -> str:
    """Fast content signature for dedup: sha1 of (size + first 1MB + last 1MB).

    Catches the same file content re-added under a different name without hashing
    multi-GB videos in full. Path-insensitive, so copies dedup."""
    import hashlib
    sz = os.path.getsize(path)
    h = hashlib.sha1(str(sz).encode())
    with open(path, "rb") as f:
        h.update(f.read(head))
        if sz > head * 2:
            f.seek(-head, os.SEEK_END)
            h.update(f.read(head))
    return h.hexdigest()[:16]


def preprocess_image(path: str, max_dim: int = 1024) -> str:
    """Normalize a still for the embedder: decode (incl. HEIC), flatten to RGB,
    downscale to <=max_dim, write a temp JPEG. Returns the temp path (caller cleans up).

    Vertex gemini-embedding-2 only accepts PNG/JPEG, so HEIC/HEIF/WEBP/GIF must be
    converted; downscaling keeps the upload small + cheap (semantics survive)."""
    from PIL import Image
    try:
        import pillow_heif  # type: ignore
        pillow_heif.register_heif_opener()
    except Exception:
        pass
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if max(w, h) > max_dim:
        r = max_dim / max(w, h)
        im = im.resize((max(1, int(w * r)), max(1, int(h * r))), Image.LANCZOS)
    fd, out = tempfile.mkstemp(suffix=".jpg", prefix="vc_img_")
    os.close(fd)
    im.save(out, "JPEG", quality=85)
    return out


# #324 — folders macOS guards with a privacy prompt (Apple Music, TV, Photos,
# other apps' data), plus app/plug-in packages that never hold footage. The walk
# prunes them, so no listing or stat ever reaches them and no prompt is shown.
APPLE_PACKAGE_SUFFIXES = (".photoslibrary", ".musiclibrary", ".tvlibrary", ".app", ".bundle")
HOME_PRIVATE_DIRS = ("Library", os.path.join("Music", "Music"),
                     os.path.join("Music", "iTunes"), os.path.join("Movies", "TV"))
_skip_logged: set[str] = set()


def path_key(path: str) -> str:
    """Comparison key for paths on macOS's case-insensitive default volume."""
    return unicodedata.normalize("NFC", os.path.normpath(path)).casefold()


def home_dirs() -> list[str]:
    """This user's home, resolved: $HOME and the account record (they can differ)."""
    homes = [os.path.expanduser("~")]
    try:
        import pwd  # POSIX only; Windows builds have no account database here
        homes.append(pwd.getpwuid(os.getuid()).pw_dir)
    except (ImportError, AttributeError, KeyError, OSError):
        pass
    return list(dict.fromkeys(os.path.realpath(h) for h in homes if h))


def _private_dirs_under(top: str) -> set[str]:
    """The home-relative private folders that sit inside `top`, as walk-path keys.

    Only the folder the caller asked to scan is resolved; the private folders
    themselves are named from the resolved home, never stat'ed. os.walk does not
    follow symlinked subfolders, so every folder it yields below `top` is the
    resolved top plus a plain relative path.
    """
    real_top = path_key(os.path.realpath(top)).rstrip(os.sep)  # "/" → ""
    out: set[str] = set()
    for home in home_dirs():
        for rel in HOME_PRIVATE_DIRS:
            p = path_key(os.path.join(home, rel))
            if p.startswith(real_top + os.sep):
                out.add(path_key(os.path.join(top, p[len(real_top) + 1:])))
    return out


def _log_skip(path: str) -> None:
    if path not in _skip_logged:
        _skip_logged.add(path)
        print(f"  - skip {path}: Apple library or app package, not scanned",
              file=sys.stderr)


def scan_directory(directory_path: str, *, images: bool = False) -> list[str]:
    """Recursively find supported media files. Sorted absolute paths.

    Apple app libraries, app packages and the home folder's private folders are
    pruned from the walk (see APPLE_PACKAGE_SUFFIXES / HOME_PRIVATE_DIRS). The
    folder passed in is always scanned: pruning applies to what is found below it.
    """
    exts = SUPPORTED_IMAGE_EXTENSIONS if images else SUPPORTED_VIDEO_EXTENSIONS
    out = []
    private = _private_dirs_under(directory_path)
    for root, dirs, files in os.walk(directory_path):
        kept = []
        for d in dirs:
            child = os.path.join(root, d)
            if d.casefold().endswith(APPLE_PACKAGE_SUFFIXES) or path_key(child) in private:
                _log_skip(child)
            else:
                kept.append(d)
        dirs[:] = kept  # in place: os.walk never lists or stats a pruned folder
        for f in files:
            if f.startswith("."):  # skip dotfiles + macOS AppleDouble (._*) sidecars
                continue
            if Path(f).suffix.lower() in exts:
                out.append(os.path.join(root, f))
    out.sort()
    return out
