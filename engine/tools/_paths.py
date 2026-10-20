"""
Centralized path resolution for the videoclaw toolkit.

Every tool lives flat in `<repo>/tools/`. This module computes the repo root
and the canonical sub-directories ONCE, anchored to this file's location, so no
tool depends on the process CWD or on a hardcoded absolute path.

Layout (standalone videoclaw repo):

    <repo_root>/
        tools/            ← all Python tools (this file lives here)
        skills/           ← Claude reference docs + prompt templates
        remotion/         ← shared Remotion (Node) project
        sfx_library/      ← shared SFX library
        jobs/             ← per-job output directories (gitignored)

Usage from a tool:

    from _paths import REPO_ROOT, OUTPUT_ROOT, SKILLS_DIR, REMOTION_DIR, TOOLS_DIR

Because `tools/` is added to sys.path by each tool (or the process runs from the
repo root), `from _paths import ...` resolves as a sibling module.
"""

from __future__ import annotations

import os
from pathlib import Path

# This file is <repo_root>/tools/_paths.py → parents[1] is the repo root.
# In the shipped app this is the ENGINE dir (code + skills + workflows).
REPO_ROOT = Path(__file__).resolve().parents[1]

TOOLS_DIR = REPO_ROOT / "tools"
SKILLS_DIR = REPO_ROOT / "skills"
REMOTION_DIR = REPO_ROOT / "remotion"
SFX_LIBRARY_DIR = REPO_ROOT / "sfx_library"

# ── Engine/workspace split (World 1, SHIPPING.md WS1) ────────────────────────
# USER DATA (jobs, tenant assets, taste packs) lives in the WORKSPACE so it
# survives engine updates. In JC's dev setup no env var is set and everything
# resolves to the repo root — behavior is unchanged. In the shipped app the
# bootstrap sets VIDEOCLAW_WORKSPACE=~/Videoclaw (and the engine lives in a
# hidden app-support dir).
WORKSPACE_ROOT = Path(os.environ.get("VIDEOCLAW_WORKSPACE", str(REPO_ROOT)))

# User-data dirs — anchor to the workspace.
TASTE_DIR = WORKSPACE_ROOT / "taste" / "packs"
ASSETS_DIR = WORKSPACE_ROOT / "assets"

# Per-job output directory. VIDEOCLAW_JOBS_DIR (historical override) wins, then
# the workspace, then the repo default.
OUTPUT_ROOT = Path(os.environ.get("VIDEOCLAW_JOBS_DIR", str(WORKSPACE_ROOT / "jobs")))

# Location of the .env file (engine root — holds ONLY the gateway key in the
# shipped app; vendor keys never leave JC's machines). Tools call
# load_dotenv(ENV_PATH).
ENV_PATH = REPO_ROOT / ".env"
