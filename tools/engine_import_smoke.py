#!/usr/bin/env python3
"""Static import smoke test for engine/tools on this (Linux) box.

Imports every engine/tools/*.py module (NOT executing __main__) in a throw-away copy
of the engine, one subprocess per module, in two modes:
  posix  - normal interpreter;
  winsim - POSIX-only stdlib modules (fcntl, pwd, grp, termios, resource, tty, pty)
           are made unimportable, POSIX-only os/signal attributes are deleted and a
           fake ``msvcrt`` is provided — an APPROXIMATION of CPython on Windows.
Third-party packages (not installed on the box: no network) are replaced by
permissive stub modules, so only stdlib/engine-level import errors are reported.
Usage: python3 tools/engine_import_smoke.py [posix|winsim|both] [--json out.json]
"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENGINE = Path(os.environ.get("ENGINE_DIR", REPO / "engine"))

PRELUDE = r'''
import sys, os, signal, types, importlib.abc, importlib.machinery
MODE = sys.argv[1]
class _Any(types.ModuleType):
    __path__ = []
    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return _Thing()
class _Thing:
    def __init__(self, *a, **k): pass
    def __call__(self, *a, **k): return _Thing()
    def __getattr__(self, name):
        if name.startswith("__") and name.endswith("__"): raise AttributeError(name)
        return _Thing()
    def __mro_entries__(self, bases): return (object,)
    def __iter__(self): return iter(())
    def __getitem__(self, k): return _Thing()
    def __or__(self, o): return self
    __ror__ = __add__ = __radd__ = __truediv__ = __rtruediv__ = __mul__ = __rmul__ = __sub__ = __rsub__ = __or__
class _StubFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        top = name.split(".")[0]
        if top in sys.stdlib_module_names: return None
        here = os.getcwd()
        if os.path.exists(os.path.join(here, top + ".py")) or os.path.isdir(os.path.join(here, top)):
            return None  # engine-local module: import for real
        # every third-party package is stubbed (box-installed ones too) so results
        # do not depend on what happens to be installed here
        return importlib.machinery.ModuleSpec(name, self, is_package=True)
    def create_module(self, spec): return _Any(spec.name)
    def exec_module(self, m): pass
sys.meta_path.insert(0, _StubFinder())
if MODE == "winsim":
    for m in ("fcntl", "pwd", "grp", "termios", "resource", "tty", "pty"):
        sys.modules[m] = None
    for a in ("O_NOFOLLOW", "O_DIRECTORY", "O_CLOEXEC", "O_NONBLOCK", "killpg", "getpgrp", "getpgid",
              "setsid", "setpgid", "getuid", "geteuid", "getgid", "fchmod", "fchown", "chown", "fork",
              "uname", "getloadavg", "sync", "mkfifo", "statvfs"):
        if hasattr(os, a): delattr(os, a)
    for a in ("SIGKILL", "SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2", "SIGALRM", "SIGCHLD", "SIGPIPE"):
        if hasattr(signal, a): delattr(signal, a)
    # stdlib modules that probe msvcrt to detect Windows must be imported first
    import subprocess, tempfile, getpass, uuid, selectors, shutil, platform, asyncio, multiprocessing, concurrent.futures  # noqa
    msv = types.ModuleType("msvcrt")
    msv.LK_UNLCK, msv.LK_LOCK, msv.LK_NBLCK, msv.LK_RLCK, msv.LK_NBRLCK = 0, 1, 2, 3, 4
    msv.locking = lambda fd, mode, n: None
    sys.modules["msvcrt"] = msv
sys.path.insert(0, os.getcwd())
import importlib
importlib.import_module(sys.argv[2])
'''

def run(mode, workdir):
    tools = workdir / "tools"
    out = {}
    for py in sorted(tools.glob("*.py")):
        r = subprocess.run([sys.executable, "-c", PRELUDE, mode, py.stem], cwd=tools,
                           capture_output=True, text=True, timeout=60,
                           env={"PATH": os.environ.get("PATH", ""), "HOME": str(workdir), "PYTHON_DOTENV_DISABLED": "1",
                                # read at import time by 3 tools (os.environ[...]); dummy value
                                "OPENROUTER_API_KEY": "smoke-test-dummy"})
        if r.returncode == 0:
            out[py.name] = "ok"
        else:
            lines = [l for l in r.stderr.strip().splitlines() if l.strip()]
            loc = next((l.strip() for l in reversed(lines) if l.strip().startswith('File "')), "")
            out[py.name] = (lines[-1] if lines else f"exit {r.returncode}") + (f"  @ {loc}" if loc else "")
    return out

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "both"
    modes = ["posix", "winsim"] if mode == "both" else [mode]
    with tempfile.TemporaryDirectory() as td:
        work = Path(td) / "engine"
        shutil.copytree(ENGINE, work, ignore=shutil.ignore_patterns("node_modules", ".venv", "__pycache__"))
        res = {m: run(m, work) for m in modes}
    for m, r in res.items():
        bad = {k: v for k, v in r.items() if v != "ok"}
        print(f"[{m}] {len(r) - len(bad)}/{len(r)} modules import OK")
        for k, v in bad.items():
            print(f"  {k}: {v}")
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(res, indent=1, sort_keys=True) + "\n")

if __name__ == "__main__":
    main()
