"""
doctor — engine + workspace health check (SHIPPING.md WS1).

Proves the full chain a session depends on, on THIS machine: binaries, the uv
venv, Remotion, the gateway key, the workspace layout, and the harness hooks.
Run by the app's bootstrap after setup (and cheaply on every launch); also
useful on a dev machine after a fresh clone.

  uv run python tools/doctor.py            # human checklist, exit 0 = all green
  uv run python tools/doctor.py --json     # machine-readable, for the app UI
  uv run python tools/doctor.py --deep     # + a real 1s Remotion smoke render
  uv run python tools/doctor.py --library  # LIBRARY LINT instead: canon counts,
                                           # orphan tools, cross-refs, doc-flag
                                           # drift, brand-leaks in [GENERIC] docs

Checks are independent; every failure carries a `fix` hint. No job required —
this is infra-level, so it deliberately does NOT use job.py/log.py.

The --library mode is the deterministic half of the librarian gatekeeper: it
keeps CANONICAL_TOOLS.md / CLAUDE.md / workflows/ / skills/molecules.md honest
against the actual tools/ surface. A line ending in `lint-ok: example` is
waived from the leak check (for clearly-labeled illustrative values).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import (  # noqa: E402
    REPO_ROOT, WORKSPACE_ROOT, OUTPUT_ROOT, TASTE_DIR, ASSETS_DIR,
    REMOTION_DIR, ENV_PATH,
)

# Import set that the tools actually rely on (kept small + honest: these are the
# ones whose absence breaks real jobs).
VENV_IMPORTS = (
    "PIL", "numpy", "scipy", "requests", "dotenv", "elevenlabs", "fontTools", "openai"
)


def _run(cmd: list[str], timeout: int = 20, cwd: Path | None = None) -> tuple[int, str]:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd,
        )
        return r.returncode, (r.stdout or r.stderr).strip()
    except FileNotFoundError:
        return 127, "not found"
    except subprocess.TimeoutExpired:
        return 124, "timed out"


def check_binary(name: str, version_arg: str = "-version") -> dict:
    path = shutil.which(name)
    if not path:
        return {"ok": False, "detail": "not on PATH",
                "fix": f"bundle/install {name} and prepend its dir to PATH"}
    rc, out = _run([name, version_arg])
    ver = out.splitlines()[0][:80] if out else "?"
    return {"ok": rc == 0, "detail": f"{path} · {ver}",
            **({} if rc == 0 else {"fix": f"{name} exists but won't run — re-install"})}


def check_venv() -> dict:
    code = ";".join(f"import {m}" for m in VENV_IMPORTS)
    rc, out = _run(["uv", "run", "--project", str(REPO_ROOT), "python", "-c", code],
                   timeout=120)
    if rc == 127:
        return {"ok": False, "detail": "uv not on PATH", "fix": "bundle the uv binary"}
    return {"ok": rc == 0,
            "detail": f"imports ok: {', '.join(VENV_IMPORTS)}" if rc == 0 else out[-300:],
            **({} if rc == 0 else {"fix": f"cd {REPO_ROOT} && uv sync --frozen"})}


def check_yt_dlp() -> dict:
    # yt-dlp may be a venv package (preferred, shipped) or a system binary (dev).
    rc, out = _run(["uv", "run", "--project", str(REPO_ROOT), "yt-dlp", "--version"],
                   timeout=60)
    if rc == 0:
        return {"ok": True, "detail": f"venv yt-dlp {out.splitlines()[0]}"}
    if shutil.which("yt-dlp"):
        rc2, out2 = _run(["yt-dlp", "--version"])
        return {"ok": rc2 == 0, "detail": f"system yt-dlp {out2.splitlines()[0] if out2 else '?'}"}
    return {"ok": False, "detail": "no yt-dlp (venv or PATH)",
            "fix": "add yt-dlp to pyproject.toml (rides the venv) — SHIPPING.md WS2"}


def check_remotion(deep: bool) -> dict:
    if not (REMOTION_DIR / "package.json").exists():
        return {"ok": False, "detail": f"{REMOTION_DIR} missing",
                "fix": "engine tarball incomplete — re-extract"}
    if not (REMOTION_DIR / "node_modules").exists():
        return {"ok": False, "detail": "node_modules missing",
                "fix": f"cd {REMOTION_DIR} && npm ci"}
    if not deep:
        return {"ok": True, "detail": "package.json + node_modules present (use --deep for a smoke render)"}
    # Resolve the release-pinned CLI directly. Running bare `npx` from the
    # engine root can miss remotion/node_modules and may attempt a network
    # install, turning this diagnostic into a false failure or mutation.
    cli = REMOTION_DIR / "node_modules" / ".bin" / "remotion"
    rc, out = _run([str(cli), "versions"], timeout=120, cwd=REMOTION_DIR)
    return {"ok": rc == 0, "detail": out[-200:] if out else "?",
            **({} if rc == 0 else {"fix": "npx remotion browser ensure; check node on PATH"})}


def check_gateway() -> dict:
    key = os.environ.get("VIDEOCLAW_API_KEY", "")
    if not key and ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith("VIDEOCLAW_API_KEY="):
                key = line.split("=", 1)[1].strip()
                break
    if not key:
        return {"ok": False, "detail": "no VIDEOCLAW_API_KEY (env or engine .env)",
                "fix": "enter the key in the app (AccountModal) — bootstrap writes .env"}
    from _gateway import gateway
    url = gateway.url
    try:
        import requests
        r = requests.get(f"{url}/healthz", timeout=10)
        if r.status_code == 404:  # older deploys
            r = requests.get(url, timeout=10)
        reachable = r.status_code < 500
        return {"ok": reachable, "detail": f"{url} → HTTP {r.status_code} (key present)",
                **({} if reachable else {"fix": "gateway unreachable — network? status page?"})}
    except Exception as e:
        return {"ok": False, "detail": f"{type(e).__name__}: {e}",
                "fix": "check network / gateway URL"}


def check_workspace() -> dict:
    problems = []
    for label, p in (("workspace", WORKSPACE_ROOT), ("jobs", OUTPUT_ROOT)):
        try:
            p.mkdir(parents=True, exist_ok=True)
            probe = p / f".doctor-{int(time.time())}"
            probe.write_text("ok"); probe.unlink()
        except Exception as e:
            problems.append(f"{label} ({p}): {e}")
    for label, p in (("taste packs", TASTE_DIR), ("assets", ASSETS_DIR)):
        if not p.exists():
            problems.append(f"{label} missing ({p})")
    if problems:
        return {"ok": False, "detail": "; ".join(problems),
                "fix": "bootstrap should create workspace dirs (SHIPPING.md WS2 step 1)"}
    split = "split" if WORKSPACE_ROOT != REPO_ROOT else "dev (workspace == engine)"
    return {"ok": True, "detail": f"{split} · jobs={OUTPUT_ROOT}"}


def check_hooks() -> dict:
    from prepare_production import portable_settings_errors  # noqa: E402

    missing = [str(p) for p in
               (REPO_ROOT / ".claude/hooks/preflight.sh",
                REPO_ROOT / ".claude/hooks/production_guard.py",
                REPO_ROOT / "tools/qa_gate.py")
               if not p.exists()]
    if missing:
        return {"ok": False, "detail": f"missing: {missing}",
                "fix": "engine tarball incomplete — re-extract"}
    engine_settings = REPO_ROOT / ".claude" / "settings.json"
    try:
        engine_settings_bytes = engine_settings.read_bytes()
    except OSError as exc:
        return {"ok": False, "detail": f"engine settings missing/unreadable: {exc}",
                "fix": "restore .claude/settings.json from the engine bundle"}
    engine_errors = portable_settings_errors(engine_settings)
    if engine_errors:
        return {"ok": False,
                "detail": "engine settings topology invalid: " + "; ".join(engine_errors),
                "fix": "restore the portable canonical engine hook settings"}
    # In split mode the WORKSPACE settings are an exact copy of the engine
    # contract. VIDEOCLAW_ENGINE resolves every hook back into the bundle.
    if WORKSPACE_ROOT != REPO_ROOT:
        ws_settings = WORKSPACE_ROOT / ".claude" / "settings.json"
        if not ws_settings.exists():
            return {"ok": False, "detail": f"workspace settings missing ({ws_settings})",
                    "fix": "bootstrap must copy engine .claude/settings.json (WS2 step 5)"}
        try:
            workspace_settings_bytes = ws_settings.read_bytes()
        except OSError as exc:
            return {"ok": False, "detail": f"workspace settings unreadable: {exc}",
                    "fix": "bootstrap must recopy engine .claude/settings.json"}
        if workspace_settings_bytes != engine_settings_bytes:
            return {"ok": False,
                    "detail": "workspace settings differ from canonical engine bytes",
                    "fix": "bootstrap must copy engine .claude/settings.json verbatim"}
    return {"ok": True, "detail": "all hook paths use portable engine root"
            + ("" if WORKSPACE_ROOT == REPO_ROOT else " · workspace bytes canonical")}


def check_taste_packs() -> dict:
    packs = sorted(p.parent.name for p in TASTE_DIR.glob("*/README.md")) if TASTE_DIR.exists() else []
    if not packs:
        return {"ok": False, "detail": f"no taste packs in {TASTE_DIR}",
                "fix": "bootstrap should seed taste/packs/_starter/ (WS1)"}
    return {"ok": True, "detail": f"{len(packs)} pack(s): {', '.join(packs[:6])}"}


# ---------------------------------------------------------------------------
# LIBRARY LINT (--library) — the deterministic half of the librarian gatekeeper.
# ---------------------------------------------------------------------------
import re  # noqa: E402

CANON_MD = REPO_ROOT / "CANONICAL_TOOLS.md"
CLAUDE_MD = REPO_ROOT / "CLAUDE.md"
WORKFLOWS_DIR = REPO_ROOT / "workflows"
MOLECULES_MD = REPO_ROOT / "skills" / "molecules.md"
PRIMITIVES_DIR = REPO_ROOT / "skills" / "primitives"

# Headings under which brand-specific values are ALLOWED to appear in workflows.
LEAK_ALLOWED_HEADINGS = ("worked example", "provenance", "brand", "asset map",
                         "defect ledger", "first run", "evidence", "journey",
                         "taste-capture", "todo")


def _tool_names() -> set[str]:
    return {p.stem for p in (REPO_ROOT / "tools").glob("*.py")
            if not p.stem.startswith("_")}


def _canon_text() -> str:
    return CANON_MD.read_text() if CANON_MD.exists() else ""


def check_canon_counts() -> dict:
    """Claimed counts in CANONICAL_TOOLS.md + CLAUDE.md match the entries/files."""
    canon = _canon_text()
    problems = []
    # Section claims: "## Generation (18)", "## Checking (6)", "rail (4)".
    for pat, label in ((r"## Generation \((\d+)\)", "Generation"),
                       (r"## Checking \((\d+)\)", "Checking"),
                       (r"## The QA / contract rail \((\d+)\)", "QA/contract rail")):
        m = re.search(pat, canon)
        if not m:
            problems.append(f"missing '{label} (N)' heading in CANONICAL_TOOLS.md")
            continue
        claimed = int(m.group(1))
        # Count line-start bold-backtick entries until the next '## ' heading.
        section = canon[m.end():]
        nxt = re.search(r"\n## ", section)
        section = section[: nxt.start()] if nxt else section
        actual = len(re.findall(r"^\*\*`[a-z_0-9]+[^`]*`", section, re.M))
        if actual != claimed:
            problems.append(f"{label}: claims {claimed}, lists {actual}")
    # CLAUDE.md headline: total canonical tools + workflow count.
    claude = CLAUDE_MD.read_text() if CLAUDE_MD.exists() else ""
    m_tools = re.search(r"\*\*(\d+) canonical tools\*\*", claude)
    m_wf = re.search(r"\*\*(\d+) forward workflows\*\*", claude)
    total_entries = len(re.findall(r"^\*\*`[a-z_0-9]+[^`]*`", canon, re.M))
    n_workflows = len([p for p in WORKFLOWS_DIR.glob("*.md") if p.name != "README.md"])
    if m_tools and int(m_tools.group(1)) != total_entries:
        problems.append(f"CLAUDE.md claims {m_tools.group(1)} canonical tools; "
                        f"CANONICAL_TOOLS.md lists {total_entries}")
    if m_wf and int(m_wf.group(1)) != n_workflows:
        problems.append(f"CLAUDE.md claims {m_wf.group(1)} workflows; "
                        f"workflows/ has {n_workflows}")
    if problems:
        return {"ok": False, "detail": "; ".join(problems),
                "fix": "update the stale count(s) — the canon must agree with reality"}
    return {"ok": True, "detail": f"{total_entries} canonical entries · {n_workflows} workflows"}


def check_orphan_tools() -> dict:
    """Every tools/*.py is named SOMEWHERE in CANONICAL_TOOLS.md (canon/substrate/backend)."""
    canon = _canon_text()
    orphans = sorted(t for t in _tool_names() if t not in canon)
    if orphans:
        return {"ok": False, "detail": f"tools not in CANONICAL_TOOLS.md: {', '.join(orphans)}",
                "fix": "canonize each (an entry) or demote it (substrate/backends list)"}
    return {"ok": True, "detail": f"all {len(_tool_names())} tools/*.py accounted for"}


def _md_files() -> list[Path]:
    files = [CLAUDE_MD, CANON_MD, MOLECULES_MD]
    files += sorted(WORKFLOWS_DIR.glob("*.md"))
    files += sorted(PRIMITIVES_DIR.glob("*.md"))
    files += sorted((REPO_ROOT / "taste").glob("*.md"))
    return [f for f in files if f.exists()]


def check_cross_refs() -> dict:
    """Every relative markdown link in the library docs resolves to a real file."""
    missing = []
    for f in _md_files():
        for m in re.finditer(r"\]\(([^)\s]+)\)", f.read_text()):
            path = m.group(1).split("#")[0]
            if (not path or path.startswith(("http", "mailto:"))
                    or "<" in path or path.startswith(("jobs/", "_"))):
                continue
            if not (f.parent / path).exists() and not (REPO_ROOT / path).exists():
                missing.append(f"{f.relative_to(REPO_ROOT)} → {path}")
    if missing:
        return {"ok": False, "detail": f"{len(missing)} broken link(s): "
                + "; ".join(missing[:8]) + ("…" if len(missing) > 8 else ""),
                "fix": "fix or remove each broken reference"}
    return {"ok": True, "detail": f"all relative links resolve across {len(_md_files())} docs"}


def _doc_flag_refs() -> list[tuple[Path, int, str, list[str]]]:
    """(file, lineno, tool, flags) for every `tools/<name>.py --flag…` doc line
    (including backslash continuations)."""
    out = []
    names = _tool_names()
    for f in _md_files():
        lines = f.read_text().splitlines()
        i = 0
        while i < len(lines):
            line, lineno = lines[i], i + 1
            m = re.search(r"tools/([a-z_0-9]+)\.py", line)
            if m and m.group(1) in names:
                blob = line[m.end():]
                while lines[i].rstrip().endswith("\\") and i + 1 < len(lines):
                    i += 1
                    blob += " " + lines[i]
                flags = re.findall(r"(?<![\w-])--[a-z][a-z0-9_-]*", blob)
                if flags:
                    out.append((f, lineno, m.group(1), flags))
            i += 1
    return out


def check_doc_flag_drift() -> dict:
    """Every --flag a doc shows on a tool invocation exists in that tool's source."""
    src_cache: dict[str, str] = {}
    bad = []
    for f, lineno, tool, flags in _doc_flag_refs():
        if tool not in src_cache:
            src_cache[tool] = (REPO_ROOT / "tools" / f"{tool}.py").read_text()
        for flag in flags:
            if flag not in src_cache[tool]:
                bad.append(f"{f.relative_to(REPO_ROOT)}:{lineno} {tool} {flag}")
    if bad:
        return {"ok": False, "detail": f"{len(bad)} doc flag(s) not in tool source: "
                + "; ".join(bad[:8]) + ("…" if len(bad) > 8 else ""),
                "fix": "the doc drifted from the tool (or the tool renamed a flag) — reconcile"}
    return {"ok": True, "detail": f"{len(_doc_flag_refs())} doc invocations checked"}


def check_generic_leaks() -> dict:
    """No hex colors / tenant names inside workflow bodies OUTSIDE brand/example/
    provenance sections. Waive a deliberate example with `lint-ok: example`."""
    tenants = sorted(p.name.lower() for p in (TASTE_DIR).glob("*/")
                     if p.is_dir() and not p.name.startswith("_"))
    tokens = tenants + ["joseph"]
    leaks = []
    for f in sorted(WORKFLOWS_DIR.glob("*.md")):
        if f.name == "README.md":
            continue
        heading = ""
        for lineno, line in enumerate(f.read_text().splitlines(), 1):
            if line.startswith("#"):
                heading = line.lower()
                continue
            if "lint-ok: example" in line or "[brand" in line.lower():
                continue
            if any(k in heading for k in LEAK_ALLOWED_HEADINGS):
                continue
            low = line.lower()
            hit = None
            if re.search(r"#[0-9a-fA-F]{6}\b", line):
                hit = "hex color"
            else:
                hit = next((t for t in tokens if re.search(rf"\b{re.escape(t)}\b", low)), None)
            if hit:
                leaks.append(f"{f.name}:{lineno} ({hit})")
    if leaks:
        return {"ok": False, "detail": f"{len(leaks)} brand leak(s) in [GENERIC] bodies: "
                + "; ".join(leaks[:10]) + ("…" if len(leaks) > 10 else ""),
                "fix": "move the value to a [BRAND] callout / worked-example / tenant pack, "
                       "or mark a deliberate illustration with `lint-ok: example`"}
    return {"ok": True, "detail": "no brand values in [GENERIC] workflow bodies"}


def check_dead_script_paths() -> dict:
    """Path-like .py references in docs (agent/…, tools/…, remotion/…) must exist on disk.
    Catches stale invocation paths like agent/tools/aroll.py after a consolidation."""
    dead = []
    for f in _md_files():
        for lineno, line in enumerate(f.read_text().splitlines(), 1):
            for m in re.finditer(r"(?<![\w/])((?:agent|tools|remotion)/[\w/]+\.py)", line):
                if not (REPO_ROOT / m.group(1)).exists():
                    dead.append(f"{f.relative_to(REPO_ROOT)}:{lineno} {m.group(1)}")
    if dead:
        return {"ok": False, "detail": f"{len(dead)} dead script path(s): "
                + "; ".join(dead[:8]) + ("…" if len(dead) > 8 else ""),
                "fix": "the doc points at a script that no longer exists — update the path"}
    return {"ok": True, "detail": "all path-like .py references resolve"}


def check_primitive_docs() -> dict:
    """Every skills/primitives/<name>.md maps to a real tools/<name>.py (or a mode of one)."""
    names = _tool_names()
    known_modes = {"voice_change"}  # synth_voice --mode voice_change has its own doc
    stale = sorted(p.stem for p in PRIMITIVES_DIR.glob("*.md")
                   if p.stem != "README" and p.stem not in names and p.stem not in known_modes)
    if stale:
        return {"ok": False, "detail": f"primitive docs with no tool: {', '.join(stale)}",
                "fix": "the tool was renamed/removed — update or delete the doc"}
    return {"ok": True, "detail": "every primitive doc maps to a live tool"}


def check_route_gate() -> dict:
    """The real router is traversable and committed settings wire the Bash guard."""
    try:
        sys.path.insert(0, str(REPO_ROOT / "tools"))
        from prepare_production import (  # noqa: E402
            portable_settings_errors,
            router_reachable_workflows,
        )

        reachable = router_reachable_workflows(REPO_ROOT)
        top_level = {
            f"workflows/{p.name}"
            for p in WORKFLOWS_DIR.glob("*.md")
            if p.name != "README.md"
        }
        missing = sorted(top_level - set(reachable))
        if missing:
            return {"ok": False,
                    "detail": "top-level workflows not reachable from router: "
                    + ", ".join(missing),
                    "fix": "link every canonical recipe from workflows/README.md"}

        settings_errors = portable_settings_errors(
            REPO_ROOT / ".claude" / "settings.json"
        )
        if settings_errors:
            return {"ok": False,
                    "detail": "committed settings topology invalid: "
                    + "; ".join(settings_errors),
                    "fix": "restore all portable canonical hook entries"}
        return {"ok": True,
                "detail": f"{len(reachable)} router-reachable docs · portable hooks wired"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}",
                "fix": "repair the router or production guard settings"}


LIBRARY_CHECKS = [
    ("canon counts",   lambda a: check_canon_counts()),
    ("orphan tools",   lambda a: check_orphan_tools()),
    ("route gate",     lambda a: check_route_gate()),
    ("cross-refs",     lambda a: check_cross_refs()),
    ("doc-flag drift", lambda a: check_doc_flag_drift()),
    ("generic leaks",  lambda a: check_generic_leaks()),
    ("dead scripts",   lambda a: check_dead_script_paths()),
    ("primitive docs", lambda a: check_primitive_docs()),
]


CHECKS = [
    ("ffmpeg",      lambda a: check_binary("ffmpeg")),
    ("ffprobe",     lambda a: check_binary("ffprobe")),
    ("node",        lambda a: check_binary("node", "-v")),
    ("python venv", lambda a: check_venv()),
    ("yt-dlp",      lambda a: check_yt_dlp()),
    ("remotion",    lambda a: check_remotion(a.deep)),
    ("gateway",     lambda a: check_gateway()),
    ("workspace",   lambda a: check_workspace()),
    ("hooks",       lambda a: check_hooks()),
    ("taste packs", lambda a: check_taste_packs()),
]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--json", action="store_true", help="machine-readable output (app UI)")
    ap.add_argument("--deep", action="store_true", help="also run a Remotion smoke check")
    ap.add_argument("--library", action="store_true",
                    help="run the LIBRARY LINT (canon/docs/tools coherence) instead of infra checks")
    args = ap.parse_args()

    results = {}
    for name, fn in (LIBRARY_CHECKS if args.library else CHECKS):
        t0 = time.perf_counter()
        try:
            res = fn(args)
        except Exception as e:  # a check must never crash the doctor
            res = {"ok": False, "detail": f"{type(e).__name__}: {e}", "fix": "report this"}
        res["ms"] = int((time.perf_counter() - t0) * 1000)
        results[name] = res

    all_ok = all(r["ok"] for r in results.values())
    if args.json:
        print(json.dumps({"ok": all_ok, "engine": str(REPO_ROOT),
                          "workspace": str(WORKSPACE_ROOT), "checks": results}, indent=2))
    else:
        print(f"videoclaw doctor · engine={REPO_ROOT}\n"
              f"                   workspace={WORKSPACE_ROOT}\n")
        for name, r in results.items():
            mark = "✅" if r["ok"] else "❌"
            print(f"  {mark} {name:<12} {r['detail']}")
            if not r["ok"] and r.get("fix"):
                print(f"       ↳ fix: {r['fix']}")
        print(f"\n{'ALL GREEN' if all_ok else 'FAILURES — see fixes above'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
