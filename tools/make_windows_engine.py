#!/usr/bin/env python3
"""PORT-ONLY packaging helper: build a Windows engine tarball + engine.manifest.json.

Why: the app verifies the tarball against engine.manifest.json `sha256` (no signature —
see docs/09 §4), and doctor's `hooks` check requires the workspace/engine
`.claude/settings.json` hook commands to equal prepare_production.EXPECTED_HOOK_COMMANDS,
which on Windows (os.name == "nt") point at `.venv/Scripts/python.exe`.

What it does (nothing else):
  1. copies <engine dir> (default: repo/engine, i.e. the compat-patched source);
  2. in .claude/settings.json replaces every `/.venv/bin/python` with
     `/.venv/Scripts/python.exe` (the only change; asserted to touch 2 commands);
  3. writes `engine/…` tar.gz with the original layout (top dir `engine/`, uid/gid 0,
     sorted, fixed mtime) and a manifest copied from bootstrap/engine.manifest.json with
     only `file` and `sha256` updated.
Usage: python3 tools/make_windows_engine.py OUT_DIR [--engine DIR] [--manifest FILE]
Then point VIDEOCLAW_ENGINE_DIST (original env var) at OUT_DIR on the Windows machine.
"""
import argparse, gzip, hashlib, io, json, os, shutil, sys, tarfile, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

def rewrite_settings(text: str) -> str:
    n = text.count("/.venv/bin/python")
    if n != 2:
        raise SystemExit(f"expected 2 hook commands using /.venv/bin/python, found {n}")
    return text.replace("/.venv/bin/python", "/.venv/Scripts/python.exe")

def materialize_symlink_placeholders(stage: Path) -> list[str]:
    """The engine has ONE symlink (remotion/public/sfx -> ../../sfx_library, git mode 120000).
    copytree(symlinks=False) already dereferences it on POSIX. On a Windows checkout with
    core.symlinks=false git writes a tiny text file holding the link target instead; replace
    such placeholders with a real copy of the target directory so the tarball never contains
    a symlink (bsdtar on Windows cannot create one without Developer Mode/admin)."""
    done = []
    for f in sorted(stage.rglob("*")):
        if not f.is_file() or f.is_symlink() or f.stat().st_size > 256:
            continue
        try:
            target = f.read_text(encoding="utf-8").strip()
        except (UnicodeDecodeError, OSError):
            continue
        if not target or "\n" in target or target.startswith("/"):
            continue
        resolved = (f.parent / target).resolve()
        if resolved.is_dir() and stage.resolve() in resolved.parents:
            f.unlink()
            shutil.copytree(resolved, f)
            done.append(str(f.relative_to(stage)))
    return done

def build(engine: Path, manifest_in: Path, out: Path) -> dict:
    manifest = json.loads(manifest_in.read_bytes().decode("utf-8"))
    mtime = 0
    with tempfile.TemporaryDirectory() as td:
        stage = Path(td) / "engine"
        shutil.copytree(engine, stage, ignore=shutil.ignore_patterns("__pycache__", ".venv", "node_modules", "bin"))
        materialize_symlink_placeholders(stage)
        s = stage / ".claude" / "settings.json"
        s.write_bytes(rewrite_settings(s.read_bytes().decode("utf-8")).encode("utf-8"))  # bytes: no CRLF/codepage translation on Windows
        name = f"engine-{manifest['version']}-win.tar.gz"
        out.mkdir(parents=True, exist_ok=True)
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
            paths = sorted([stage] + list(stage.rglob("*")))
            for p in paths:
                info = tar.gettarinfo(str(p), arcname=str(Path("engine") / p.relative_to(stage)) if p != stage else "engine")
                info.uid = info.gid = 0; info.uname = info.gname = ""; info.mtime = mtime
                if p.is_file():
                    with open(p, "rb") as fh: tar.addfile(info, fh)
                else:
                    tar.addfile(info)
        data = io.BytesIO()
        with gzip.GzipFile(fileobj=data, mode="wb", mtime=0) as gz: gz.write(raw.getvalue())
        (out / name).write_bytes(data.getvalue())
    # `variant` is left untouched (the app never reads it — grep "variant" in main/index.js).
    manifest.update({"file": name, "sha256": hashlib.sha256(data.getvalue()).hexdigest()})
    (out / "engine.manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    return manifest

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--engine", type=Path, default=REPO / "engine")
    ap.add_argument("--manifest", type=Path, default=REPO / "bootstrap" / "engine.manifest.json")
    a = ap.parse_args()
    print(json.dumps(build(a.engine, a.manifest, a.out), indent=2))
