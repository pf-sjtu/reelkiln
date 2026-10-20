"""Small shared primitives for tool-owned billing manifests."""

from pathlib import Path


def job_path(raw: str, cwd: Path) -> Path:
    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        return candidate
    direct = cwd / candidate
    if direct.is_dir():
        return direct
    return cwd / "jobs" / candidate
