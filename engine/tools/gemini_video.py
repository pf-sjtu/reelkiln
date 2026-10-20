"""
Gemini video analysis tool — your eyes for understanding video content.
Sends a video URL to Gemini (via OpenRouter) with a prompt and returns the analysis.

Usage (CLI):
  uv run python tools/gemini_video.py --mode analysis           # uses .current_job
  uv run python tools/gemini_video.py --mode chunk_review --chunk 0
  uv run python tools/gemini_video.py --mode replication_brief
  uv run python tools/gemini_video.py --mode final_review
  uv run python tools/gemini_video.py --url "https://..." --mode analysis
  uv run python tools/gemini_video.py --mode custom --prompt "..."

Modes are loaded from `skills/gemini_prompts/<mode>.md`. Each template
declares its own response-shape contract. To add a new mode, drop a markdown
file there and add the name to --mode choices.

Usage (as module):
  from agent.tools.gemini_video import analyse_video, load_template
  prompt = load_template("deep_analysis").body
  result = analyse_video(url, prompt, job=job, mode_label="analysis")

See skills/gemini_prompts/README.md for the prompt library structure.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from openai import OpenAI

from _gateway import gateway  # dual mode: VIDEOCLAW_API_KEY set → gateway routes the call
from log import log_event

load_dotenv()

# Direct mode keeps the original fail-fast KeyError; gateway mode must not
# require the raw vendor key to be present at all.
OPENROUTER_API_KEY = (
    os.environ.get("OPENROUTER_API_KEY", "")
    if gateway.enabled()
    else os.environ["OPENROUTER_API_KEY"]
)
GEMINI_MODEL = "~google/gemini-pro-latest"

# In gateway mode the raw OpenRouter key may be absent — the gateway path never
# uses this client, but the SDK still refuses to construct with an empty key.
# A harmless placeholder keeps import working; a real direct-mode call would 401
# only if it were actually reached (it isn't when the gateway is enabled).
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY or "gateway-mode-unused",
)

def video_to_data_url(path: Path) -> str:
    """Encode a local video file as a base64 data URL."""
    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:video/mp4;base64,{b64}"

def download_video(url: str) -> Path:
    """Download TikTok/IG video via yt-dlp. Returns path to downloaded file."""
    tmp_dir = Path(tempfile.mkdtemp())
    out_template = str(tmp_dir / "video.%(ext)s")
    print(f"  Downloading video with yt-dlp...")
    result = subprocess.run(
        [
            "uv", "run", "yt-dlp",
            "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
            "-o", out_template,
            "--no-playlist",
            "--merge-output-format", "mp4",
            url,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed:\n{result.stderr}\n{result.stdout}")
    # Find the downloaded file
    files = list(tmp_dir.glob("video.*"))
    if not files:
        raise RuntimeError(f"yt-dlp produced no output in {tmp_dir}\nstdout: {result.stdout}\nstderr: {result.stderr}")
    out_path = files[0]
    size_mb = out_path.stat().st_size // 1024 // 1024
    print(f"  Downloaded: {out_path.name} ({size_mb}MB)")
    return out_path

def reference_filename_from_url(url: str) -> str:
    """Stable, human-readable filename for a remote outlier video.

    Format: outlier__<creator>__<videoid>.mp4   (slugified, safe for filesystems)
    Falls back to a content-hash if we can't parse handle/id from the URL.
    """
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    creator = ""
    video_id = ""
    for i, p in enumerate(parts):
        if p.startswith("@"):
            creator = p[1:]
        if p == "video" and i + 1 < len(parts):
            video_id = parts[i + 1]
        if p in ("p", "reel") and i + 1 < len(parts):
            video_id = parts[i + 1]
    if not video_id:
        video_id = hashlib.sha1(url.encode()).hexdigest()[:10]
    if not creator:
        creator = parsed.netloc.replace("www.", "").split(".")[0] or "src"
    creator = re.sub(r"[^a-zA-Z0-9_-]", "", creator)[:40] or "src"
    video_id = re.sub(r"[^a-zA-Z0-9_-]", "", video_id)[:40]
    return f"outlier__{creator}__{video_id}.mp4"


def save_reference_video(url: str, job: Path | None) -> Path | None:
    """Download (or copy) the outlier video into <job_dir>/reference/.

    Returns the saved path. Idempotent: if a file with the same name already
    exists, returns it without re-downloading.
    Returns None if `job` is not set (caller wants tmp behaviour).
    """
    if job is None:
        return None
    ref_dir = job / "reference"
    ref_dir.mkdir(parents=True, exist_ok=True)
    out_path = ref_dir / reference_filename_from_url(url)
    if out_path.exists() and out_path.stat().st_size > 1000:
        return out_path
    # Local file: copy in
    if Path(url).exists():
        out_path.write_bytes(Path(url).read_bytes())
        return out_path
    if url.startswith("file://"):
        out_path.write_bytes(Path(url[7:]).read_bytes())
        return out_path
    # Remote: download with yt-dlp directly to ref_dir
    print(f"  Downloading outlier reference to {out_path.name}...")
    result = subprocess.run(
        [
            "uv", "run", "yt-dlp",
            "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best",
            "-o", str(out_path),
            "--no-playlist",
            "--merge-output-format", "mp4",
            url,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not out_path.exists():
        # yt-dlp may have written to a slightly different filename due to ext-handling
        candidates = list(ref_dir.glob(out_path.stem + ".*"))
        if candidates:
            candidates[0].rename(out_path)
        else:
            raise RuntimeError(f"yt-dlp failed:\n{result.stderr or result.stdout}")
    return out_path


def resolve_video_url(url: str, job: Path | None = None) -> tuple[str, Path | None]:
    """
    Given a URL or local path, return (video_url_for_API, local_reference_path).

    - YouTube: passes URL through; no download needed for the API call.
      If `job` is set, still downloads a copy to <job_dir>/reference/ so the
      outlier is preserved alongside its analysis.
    - TikTok/IG/other URLs: downloads to <job_dir>/reference/ (or temp if no job),
      returns base64 data URL.
    - Local paths: returns base64 data URL; reference path is the local path.
    """
    # Local file
    if url.startswith("file://"):
        path = Path(url[7:])
        return video_to_data_url(path), path
    if Path(url).exists():
        return video_to_data_url(Path(url)), Path(url)

    # YouTube — API can take URL directly
    if "youtube.com" in url or "youtu.be" in url:
        ref_path = save_reference_video(url, job) if job else None
        return url, ref_path

    # TikTok, IG, etc.
    if job is not None:
        ref_path = save_reference_video(url, job)
        return video_to_data_url(ref_path), ref_path

    tmp_path = download_video(url)
    return video_to_data_url(tmp_path), tmp_path


def resolve_video_reference(url: str, job: Path | None = None) -> tuple[str | Path, Path | None]:
    """Gateway-mode twin of resolve_video_url — NEVER base64-encodes.

    Returns (reference_for_gateway, local_reference_path). The reference is
    either a YouTube URL (passed through — Gemini-via-OpenRouter fetches it
    directly) or a LOCAL FILE path (gateway.upload turns it into a signed GCS
    https URL server-side). Base64 data-URIs are deliberately avoided: they are
    huge and would bloat the gateway JSON body.

    Same download/side-effect behaviour as resolve_video_url (job reference
    copies, tmp download when no job) — only the encoding differs.
    """
    # Local file
    if url.startswith("file://"):
        path = Path(url[7:])
        return path, path
    if Path(url).exists():
        return Path(url), Path(url)

    # YouTube — pass the URL through (still archive a copy when job is set)
    if "youtube.com" in url or "youtu.be" in url:
        ref_path = save_reference_video(url, job) if job else None
        return url, ref_path

    # TikTok, IG, etc. — download, then hand the LOCAL PATH to the gateway
    if job is not None:
        ref_path = save_reference_video(url, job)
        return ref_path, ref_path

    tmp_path = download_video(url)
    return tmp_path, tmp_path

# ---------------------------------------------------------------------------
# Prompt template loader
# ---------------------------------------------------------------------------

PROMPT_DIR = (Path(__file__).resolve().parent.parent / "skills" / "gemini_prompts").resolve()


class PromptTemplate:
    """A loaded prompt template: frontmatter metadata + body text."""

    def __init__(self, name: str, frontmatter: dict, body: str, path: Path):
        self.name = name
        self.frontmatter = frontmatter or {}
        self.body = body
        self.path = path

    @property
    def description(self) -> str:
        return str(self.frontmatter.get("description", ""))

    @property
    def returns(self) -> str:
        return str(self.frontmatter.get("returns", "text"))

    @property
    def response_shape(self) -> str:
        return str(self.frontmatter.get("response_shape", "")).strip()

    @property
    def max_output_tokens(self) -> int:
        """Max output tokens for this mode. Default 16384 (covers most modes).
        Override in frontmatter when a mode needs more — e.g. deep_analysis on
        long videos with dense per-beat chunking can need 32k+."""
        try:
            return int(self.frontmatter.get("max_output_tokens", 16384))
        except (TypeError, ValueError):
            return 16384


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Tiny YAML-ish frontmatter parser. Supports flat keys, `key: |` block scalars."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 5:]

    fm: dict = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if value == "|":
            # Block scalar: collect indented continuation lines.
            block = []
            i += 1
            while i < len(lines) and (lines[i].startswith("  ") or lines[i] == ""):
                block.append(lines[i][2:] if lines[i].startswith("  ") else lines[i])
                i += 1
            fm[key] = "\n".join(block).rstrip()
            continue
        # Strip surrounding quotes if any.
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        fm[key] = value
        i += 1
    return fm, body


def load_template(name: str) -> PromptTemplate:
    """Load a prompt template by name from skills/gemini_prompts/.

    If the template declares a response_shape and `returns: json`, the shape is
    automatically appended to the body so the model actually sees the contract
    (frontmatter is invisible to the model). The body author can suppress this
    by including the literal placeholder `{{response_shape}}` somewhere in the
    body, in which case the shape is inserted there instead.
    """
    path = PROMPT_DIR / f"{name}.md"
    if not path.exists():
        available = sorted(p.stem for p in PROMPT_DIR.glob("*.md") if p.stem != "README")
        raise FileNotFoundError(
            f"Prompt template not found: {path}\n"
            f"Available templates: {', '.join(available)}\n"
            f"See {PROMPT_DIR / 'README.md'}"
        )
    text = path.read_text()
    frontmatter, body = _parse_frontmatter(text)
    body = body.strip()

    shape = str(frontmatter.get("response_shape", "")).strip()
    returns = str(frontmatter.get("returns", "text")).lower()
    if shape and returns == "json":
        injected = (
            "Return ONLY a JSON object matching this exact schema. "
            "Do NOT add or rename fields. Do NOT wrap in markdown fences.\n\n"
            f"```json\n{shape}\n```"
        )
        if "{{response_shape}}" in body:
            body = body.replace("{{response_shape}}", injected)
        else:
            body = body.rstrip() + "\n\n" + injected

    return PromptTemplate(name=name, frontmatter=frontmatter, body=body, path=path)


def list_templates() -> list[str]:
    return sorted(p.stem for p in PROMPT_DIR.glob("*.md") if p.stem != "README")

def analyse_video(
    url: str,
    prompt: str,
    model: str = GEMINI_MODEL,
    job: Path | None = None,
    mode_label: str = "custom",
    max_output_tokens: int = 16384,
) -> str:
    """Send a video to Gemini with a prompt. Returns the text response.

    If `job` is set, saves a copy of the reference outlier under
    <job_dir>/reference/ and emits structured log events.

    `max_output_tokens` defaults to 16384 (covers most modes); deep_analysis
    on long videos with dense per-beat chunking declares 32768 in its
    frontmatter. Gemini 2.5 Pro supports up to 65k output tokens.
    """
    start = time.perf_counter()
    if gateway.enabled():
        # Gateway mode: branch BEFORE base64 encoding — local files go up as
        # paths (signed-GCS-URL upload), YouTube URLs pass through.
        video_ref, ref_path = resolve_video_reference(url, job=job)
    else:
        video_url, ref_path = resolve_video_url(url, job=job)

    if job is not None and ref_path is not None and ref_path.is_relative_to(job):
        log_event(
            job, tool="gemini_video.py", event="reference_saved",
            extra={
                "source_url": url,
                "local_path": str(ref_path.relative_to(job)),
                "size_bytes": ref_path.stat().st_size,
            },
            render_md=False,
        )

    gateway_cost = None
    try:
        if gateway.enabled():
            res = gateway.run(
                "qa_video", role=mode_label, prompt=prompt,
                references=[video_ref],
                params={"max_output_tokens": max_output_tokens, "_media": "video"},
                timeout_s=1800.0,
                job=job,
            )
            gateway_cost = res.get("cost_usd")
        else:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "video_url", "video_url": {"url": video_url}},
                        ],
                    }
                ],
                max_tokens=max_output_tokens,
            )
    except Exception as e:
        if job is not None:
            log_event(
                job, tool="gemini_video.py", event="gemini_call_failed",
                prompt=prompt,
                duration_seconds=time.perf_counter() - start,
                extra={
                    "model": model, "mode": mode_label, "source_url": url,
                    "error": type(e).__name__, "error_message": str(e)[:300],
                    "gateway": gateway.enabled(),
                },
            )
        raise

    if gateway.enabled():
        content = (res.get("output") or {}).get("text")
        if content is None:
            raise RuntimeError(f"Gateway qa_video returned no text. Full response: {res}")
        finish_reason = "gateway"
    else:
        if not response.choices:
            raise RuntimeError(f"Empty choices in response. Full response: {response.model_dump()}")
        content = response.choices[0].message.content
        if content is None:
            raise RuntimeError(f"Null content. finish_reason={response.choices[0].finish_reason}. Full: {response.model_dump()}")
        finish_reason = response.choices[0].finish_reason

    if job is not None:
        extra = {
            "model": model, "mode": mode_label, "source_url": url,
            "finish_reason": finish_reason,
            "response_chars": len(content),
        }
        if gateway_cost is not None:
            extra["gateway_cost_usd"] = round(gateway_cost, 4)
            extra["gateway"] = True
        log_event(
            job, tool="gemini_video.py", event="gemini_call_completed",
            prompt=prompt,
            response=content,
            duration_seconds=time.perf_counter() - start,
            extra=extra,
        )

    return content

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*\n(.*?)\n```\s*$", re.DOTALL)


def _strip_json_fences(s: str) -> str:
    """Strip a leading/trailing ```json...``` (or plain ```...```) code fence.

    Gemini's chunk_review template asks for raw JSON, but the model
    sometimes wraps it in a markdown code fence anyway. Strip on write so
    downstream `json.load(open(path))` doesn't choke.
    """
    s = s.strip()
    m = _JSON_FENCE_RE.match(s)
    return m.group(1).strip() if m else s


def _run_chunk_review_all(job, args) -> None:
    """Fan out chunk_review across every chunk_*.mp4 in <job>/chunks/.

    Runs in a ThreadPoolExecutor (Gemini calls are I/O-bound). Each chunk
    gets its own prompt, gemini call, and JSON file. Fence-stripping is
    applied before writing.
    """
    from concurrent.futures import ThreadPoolExecutor

    template = load_template("chunk_review")
    base_prompt = args.prompt if args.prompt else template.body
    if args.prompt_prefix:
        base_prompt = args.prompt_prefix.strip() + "\n\n" + base_prompt
    max_output_tokens = template.max_output_tokens

    chunks_dir = job / "chunks"
    from job import billing_input_glob
    chunk_files = [path for path in billing_input_glob(chunks_dir, "chunk_*.mp4")
                   if path.name != "trimmed"]
    if not chunk_files:
        print(f"No chunk_*.mp4 found in {chunks_dir}")
        sys.exit(1)

    print(f"Running chunk_review on {len(chunk_files)} chunks in parallel...")

    def _one(chunk_path):
        # chunk_NN.mp4 → idx NN
        idx = int(chunk_path.stem.split("_")[1])
        prompt = f"This is chunk {idx} of a multi-part video.\n\n" + base_prompt
        url = str(chunk_path)
        try:
            result = analyse_video(
                url, prompt, job=job, mode_label="chunk_review",
                max_output_tokens=max_output_tokens,
            )
        except Exception as e:
            return idx, None, e
        out_path = job / f"chunk_review_{idx}.json"
        out_path.write_text(_strip_json_fences(result))
        return idx, out_path, None

    with ThreadPoolExecutor(max_workers=min(len(chunk_files), 8)) as ex:
        results = list(ex.map(_one, chunk_files))

    failures = [(i, e) for (i, p, e) in results if e is not None]
    for idx, out_path, err in sorted(results, key=lambda r: r[0]):
        if err is not None:
            print(f"  chunk {idx}: FAILED — {err}")
        else:
            print(f"  chunk {idx}: ✓ {out_path.relative_to(job)}")

    if failures:
        print(f"\n{len(failures)} chunk(s) failed.")
        sys.exit(1)


def main():
    # Lazy-import job helper so non-job custom calls still work standalone
    from job import resolve_job_dir, add_job_arg, billing_input_path

    available = list_templates()  # discovered from skills/gemini_prompts/

    parser = argparse.ArgumentParser(allow_abbrev=False, )
    parser.add_argument("--url", help="Video URL or local path. Auto-derived for chunk_review when --job + --chunk are set.")
    parser.add_argument(
        "--mode",
        choices=available + ["custom"],
        default="analysis",
        help=f"Prompt template name (loaded from skills/gemini_prompts/<name>.md). "
             f"Available: {', '.join(available)}. Use 'custom' with --prompt to bypass.",
    )
    parser.add_argument("--prompt", help="Full prompt body. Required for --mode custom; optional override otherwise.")
    parser.add_argument("--prompt-prefix", help="Prepend extra context to the loaded template body (e.g. job-specific framing).")
    parser.add_argument(
        "--chunk",
        help="Chunk index for chunk_review mode. Pass an integer for one chunk, "
             "or 'all' to run every chunk_*.mp4 in <job_dir>/chunks/ in parallel "
             "(threaded; each chunk gets its own Gemini call + JSON output).",
    )
    parser.add_argument("--output", help="Save output to file. Auto-derived when --job is set.")
    add_job_arg(parser)
    args = parser.parse_args()

    job = None
    try:
        job = resolve_job_dir(args.job)
    except Exception:
        # Allow standalone calls without a job (e.g. ad-hoc analysis from URL)
        pass

    # --chunk all: fan out to every chunk_*.mp4 in <job>/chunks/ in parallel.
    # Each chunk gets its own gemini call + JSON output. Output is fence-stripped
    # before writing so downstream JSON loaders don't choke on ```json wrappers.
    if args.mode == "chunk_review" and args.chunk == "all":
        if job is None:
            print("--chunk all requires --job")
            sys.exit(1)
        return _run_chunk_review_all(job, args)

    # Normalize args.chunk to int for the single-chunk path
    if args.chunk is not None:
        try:
            args.chunk = int(args.chunk)
        except ValueError:
            print(f"--chunk must be an integer or 'all', got: {args.chunk!r}")
            sys.exit(1)

    # Build the prompt: agent override > template + optional prefix
    if args.mode == "custom":
        if not args.prompt:
            print("--prompt is required for --mode custom")
            sys.exit(1)
        prompt = args.prompt
        template = None
    else:
        template = load_template(args.mode)
        prompt = args.prompt if args.prompt else template.body
        if args.prompt_prefix:
            prompt = args.prompt_prefix.strip() + "\n\n" + prompt
        if args.mode == "chunk_review" and args.chunk is not None:
            prompt = f"This is chunk {args.chunk} of a multi-part video.\n\n" + prompt

        # Auto-resolve URL + output from job for known modes
        if job is not None:
            if args.mode == "chunk_review":
                if args.url is None and args.chunk is not None:
                    args.url = str(job / "chunks" / f"chunk_{args.chunk:02d}.mp4")
                if args.output is None and args.chunk is not None:
                    args.output = str(job / f"chunk_review_{args.chunk}.json")
            elif args.mode == "final_review":
                if args.url is None:
                    args.url = str(job / "final.mp4")
                if args.output is None:
                    args.output = str(job / "final_review.json")
            elif args.mode == "replication_brief":
                # Source URL for replication_brief is the saved reference outlier.
                if args.url is None:
                    refs = sorted((job / "reference").glob("outlier__*.mp4"))
                    if refs:
                        args.url = str(refs[0])
                if args.output is None:
                    args.output = str(job / "style_directives.json")

    if not args.url:
        print("--url is required (or --job for modes that auto-resolve it)")
        sys.exit(1)
    if not re.match(r"^[a-z][a-z0-9+.-]*://", args.url, re.I):
        args.url = str(billing_input_path(Path(args.url)))

    # If we're in analysis mode and have a job, default the output path to a
    # canonical reference-aligned filename so subsequent steps can find it.
    if args.mode in ("analysis", "deep_analysis") and job is not None and args.output is None:
        ref_name = reference_filename_from_url(args.url).replace("outlier__", "analysis__").replace(".mp4", ".json")
        args.output = str(job / "reference" / ref_name)

    max_output_tokens = template.max_output_tokens if template is not None else 16384
    print(f"Sending to Gemini: {args.url[:80]}... [mode={args.mode}, max_output_tokens={max_output_tokens}]")
    result = analyse_video(args.url, prompt, job=job, mode_label=args.mode, max_output_tokens=max_output_tokens)

    print("\n" + "="*60)
    print(result)
    print("="*60)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(_strip_json_fences(result) if args.mode == "chunk_review" else result)
        print(f"\nSaved to {out_path}")
        if job is not None:
            log_event(
                job, tool="gemini_video.py", event="analysis_saved",
                extra={
                    "mode": args.mode,
                    "source_url": args.url,
                    "output_path": str(out_path.relative_to(job)) if out_path.is_relative_to(job) else str(out_path),
                    "chars": len(result),
                },
            )

if __name__ == "__main__":
    main()
