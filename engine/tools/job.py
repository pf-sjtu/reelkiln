"""
Job-scoped output directory helper.

Every video generation run is a "job" with its own output directory:
    jobs/<job-id>/
        company.json
        candidates.json
        website_context.txt
        avatar/
            character_sheet.json
            avatar_front.png
            ...
        analysis_*.json
        selected_video.json
        script.json
        chunks/
            chunk_00.mp4
            ...
        chunk_review_*.json
        final_raw.mp4
        transcript.json
        final.mp4

Job ID format: <domain-slug>-<YYYYMMDD>-<6char-rand>
Example:       repti-sitter.com-20260429-a3f9b2

Usage from a tool:
    from job import resolve_job_dir, add_job_arg

    parser = argparse.ArgumentParser()
    add_job_arg(parser)
    args = parser.parse_args()
    job_dir = resolve_job_dir(args.job)   # Path("jobs/<job-id>")

    company = json.loads((job_dir / "company.json").read_text())
    (job_dir / "candidates.json").write_text(...)

`--job` is REQUIRED on every tool invocation. The legacy
`jobs/.current_job` global-state fallback was removed because it
got silently clobbered when multiple jobs ran concurrently — an artifact
written by tool A on job X would land in job Y's directory because tool
B for job Y had just rewritten `.current_job` between calls. Always pass
the job ID explicitly.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import string
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import OUTPUT_ROOT  # noqa: E402  (workspace/env-anchored jobs dir)


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_job_input_path(value: str, job: Path) -> Path:
    """Resolve a media input without coupling data paths to the engine cwd.

    Installed tools live outside the user's workspace. Historically the app
    taught `cd "$VIDEOCLAW_ENGINE"`, so `jobs/<id>/...` and `images/...` were
    accidentally looked up inside the installed engine. The stable contract is:

    * `images/x.png` is job-relative;
    * `jobs/<id>/images/x.png` is workspace-relative;
    * absolute paths remain explicit (for supplied uploads/assets).

    A cwd-relative candidate is retained last for source-tree tooling, but it
    can never override an existing job/workspace path.
    """
    raw = Path(value).expanduser()
    if raw.is_absolute():
        candidates = [raw.resolve()]
    else:
        workspace = OUTPUT_ROOT.parent.resolve()
        job_root = job.resolve()
        workspace_spelling = raw.parts[:1] == (OUTPUT_ROOT.name,)
        candidates = (
            [(workspace / raw).resolve(), (job_root / raw).resolve()]
            if workspace_spelling
            else [(job_root / raw).resolve(), (workspace / raw).resolve()]
        )
        candidates.append((Path.cwd() / raw).resolve())
    for candidate in candidates:
        if candidate.exists():
            return candidate
    # Return the contract-preferred path so the eventual error names the place
    # the caller should populate, never the incidental installed-engine cwd.
    return candidates[0]


def resolve_job_output_path(value: str, job: Path) -> Path:
    """Resolve an explicit output and require it to remain in this job.

    This is the last line of defence against a successful provider call writing
    into an installed engine, another job, or an arbitrary cwd after a wrapper
    changes directories.
    """
    raw = Path(value).expanduser()
    workspace = OUTPUT_ROOT.parent.resolve()
    job_root = job.resolve()
    if raw.is_absolute():
        resolved = raw.resolve()
    elif raw.parts[:1] == (OUTPUT_ROOT.name,):
        resolved = (workspace / raw).resolve()
    else:
        resolved = (job_root / raw).resolve()
    if not _inside(resolved, job_root):
        raise ValueError(
            f"output path must stay inside {job_root}: {value!r}"
        )
    return resolved


def slugify_domain(value: str) -> str:
    """Turn a URL or company name into a filesystem-safe slug."""
    if not value:
        return "untitled"
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = parsed.netloc or parsed.path or value
    # Strip leading www. and trailing slashes
    host = re.sub(r"^www\.", "", host.strip("/")).lower()
    # Replace anything not alphanumeric, dot, or dash with dash
    host = re.sub(r"[^a-z0-9.\-]+", "-", host).strip("-")
    return host or "untitled"


def new_job_id(domain_or_url: str) -> str:
    """Mint a new job ID. Date in local time keeps it human-scannable."""
    slug = slugify_domain(domain_or_url)
    date = datetime.now().strftime("%Y%m%d")
    rand = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"{slug}-{date}-{rand}"


def job_dir(job_id: str) -> Path:
    """Return the absolute path for a given job ID, creating it if missing."""
    path = OUTPUT_ROOT / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_job_dir(job: str | None) -> Path:
    """
    Resolve to an existing job directory. `job` is REQUIRED.

    - If `job` is a job ID, return jobs/<job>/.
    - If `job` is a path that exists, use it directly.
    - If `job` is None or empty, raise — no global-state fallback.
    """
    if job:
        # Direct path
        as_path = Path(job)
        if as_path.is_dir():
            return as_path
        # Job ID
        candidate = OUTPUT_ROOT / job
        if candidate.is_dir():
            return candidate
        # Allow tools to create the dir if it doesn't exist yet
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate

    raise ValueError(
        "--job is required. Pass --job <job-id> explicitly. "
        "(The legacy .current_job global-state fallback was removed because "
        "concurrent jobs clobbered each other silently.)"
    )


def billing_input_path(path: Path) -> Path:
    """Return cost.py's immutable snapshot for an implicit input, if any."""
    raw = os.environ.get("VIDEOCLAW_BILLING_INPUT_MAP")
    if not raw:
        return path
    try:
        mapping = json.loads(raw)
    except json.JSONDecodeError:
        return path
    replacement = mapping.get(str(path.expanduser().absolute())) if isinstance(mapping, dict) else None
    return Path(replacement) if isinstance(replacement, str) else path


def billing_optional_input_path(path: Path) -> Path | None:
    """Resolve an optional input against an immutable execution snapshot.

    Outside snapshot-bound execution this preserves the ordinary live
    existence check. Once an immutable input map is present, an unmapped path
    was absent when the plan was fingerprinted and must stay absent.
    """
    candidate = path.expanduser().absolute()
    raw = os.environ.get("VIDEOCLAW_BILLING_INPUT_MAP")
    if not raw:
        return candidate if candidate.exists() else None
    try:
        mapping = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(mapping, dict):
        return None
    replacement = mapping.get(str(candidate))
    return Path(replacement) if isinstance(replacement, str) else None


def billing_input_glob(directory: Path, pattern: str) -> list[Path]:
    """Enumerate a fingerprint-bound fleet without consulting live directory state."""
    raw = os.environ.get("VIDEOCLAW_BILLING_INPUT_MAP")
    if raw:
        try:
            mapping = json.loads(raw)
        except json.JSONDecodeError:
            mapping = None
        if isinstance(mapping, dict):
            parent = directory.expanduser().absolute()
            bound = [Path(snapshot) for original, snapshot in mapping.items()
                     if isinstance(original, str) and isinstance(snapshot, str)
                     and Path(original).parent == parent
                     and Path(original).match(pattern)]
            return sorted(bound)
    return sorted(directory.glob(pattern))


def add_job_arg(parser: argparse.ArgumentParser, required: bool = True) -> None:
    """Standard --job flag for every tool in the pipeline. REQUIRED by default
    to prevent the concurrent-job clobbering that the .current_job fallback
    used to cause. pick_company.py is the only tool that legitimately mints a
    new ID and should pass required=False (it doesn't take --job).
    """
    parser.add_argument(
        "--job",
        default=None,
        required=required,
        help="Job ID or job directory (under jobs/). REQUIRED.",
    )
