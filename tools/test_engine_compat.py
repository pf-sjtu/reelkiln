#!/usr/bin/env python3
"""Box-side tests for the engine Windows-compat shims (engine/tools/_compat_*.py).
POSIX branch: real behaviour on Linux. Windows branch: exercised with a fake msvcrt
that models byte-range locks (logic check only — NOT a substitute for a Windows run).
Run: python3 tools/test_engine_compat.py
"""
import errno, importlib.util, os, signal, subprocess, sys, tempfile, time, types, unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent / "engine" / "tools"

def load(name, fresh_name=None, pre=None):
    saved = {}
    for k, v in (pre or {}).items():
        saved[k] = sys.modules.get(k, "__absent__"); sys.modules[k] = v
    try:
        spec = importlib.util.spec_from_file_location(fresh_name or name, TOOLS / f"{name}.py")
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod
    finally:
        for k, v in saved.items():
            if v == "__absent__": sys.modules.pop(k, None)
            else: sys.modules[k] = v

class FakeMsvcrt(types.ModuleType):
    LK_UNLCK, LK_LOCK, LK_NBLCK, LK_RLCK, LK_NBRLCK = 0, 1, 2, 3, 4
    def __init__(self):
        super().__init__("msvcrt"); self.held = {}  # (ino, offset) -> owner fd
    def locking(self, fd, mode, n):
        key = (os.fstat(fd).st_ino, os.lseek(fd, 0, os.SEEK_CUR))
        if mode == self.LK_UNLCK:
            if self.held.get(key) != fd: raise OSError(errno.EACCES, "not locked")
            del self.held[key]; return
        owner = self.held.get(key)
        if owner is not None and owner != fd: raise OSError(errno.EACCES, "Permission denied")
        self.held[key] = fd

@unittest.skipUnless(os.name == "posix", "POSIX branch")
class PosixLock(unittest.TestCase):
    def test_reexports_real_fcntl(self):
        import fcntl
        m = load("_compat_lock")
        self.assertIs(m.flock, fcntl.flock)
        self.assertEqual((m.LOCK_EX, m.LOCK_NB, m.LOCK_UN, m.LOCK_SH), (fcntl.LOCK_EX, fcntl.LOCK_NB, fcntl.LOCK_UN, fcntl.LOCK_SH))

    def test_cross_process_contention_raises_blockingioerror(self):
        m = load("_compat_lock")
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.lock")
            fd = os.open(p, os.O_CREAT | os.O_RDWR, 0o600)
            m.flock(fd, m.LOCK_EX | m.LOCK_NB)
            code = ("import sys; sys.path.insert(0, %r); import _compat_lock as f, os\n"
                    "fd=os.open(%r, os.O_RDWR)\ntry:\n f.flock(fd, f.LOCK_EX|f.LOCK_NB); print('got')\n"
                    "except BlockingIOError: print('busy')") % (str(TOOLS), p)
            out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True).stdout.strip()
            self.assertEqual(out, "busy")
            m.flock(fd, m.LOCK_UN); os.close(fd)

class WindowsLockLogic(unittest.TestCase):
    def setUp(self):
        self.ms = FakeMsvcrt()
        self.m = load("_compat_lock", "_compat_lock_win", pre={"fcntl": None, "msvcrt": self.ms})
        self.d = tempfile.TemporaryDirectory(); self.p = os.path.join(self.d.name, "x.lock")
    def tearDown(self): self.d.cleanup()

    def test_constants_and_contention(self):
        m = self.m
        self.assertNotIn("fcntl", getattr(m.flock, "__module__", ""))
        a = os.open(self.p, os.O_CREAT | os.O_RDWR); b = os.open(self.p, os.O_RDWR)
        m.flock(a, m.LOCK_EX | m.LOCK_NB)
        with self.assertRaises(BlockingIOError) as cm:
            m.flock(b, m.LOCK_EX | m.LOCK_NB)
        self.assertEqual(cm.exception.errno, errno.EAGAIN)  # satisfies `errno in (EAGAIN, EACCES)` callers
        m.flock(a, m.LOCK_UN); m.flock(a, m.LOCK_UN)  # second unlock is a no-op, like flock
        m.flock(b, m.LOCK_EX | m.LOCK_NB)
        os.close(a); os.close(b)

    def test_position_restored_and_file_object_accepted(self):
        m = self.m
        with open(self.p, "w+") as f:
            f.write("hello"); f.flush()
            pos = os.lseek(f.fileno(), 0, os.SEEK_CUR)
            m.flock(f, m.LOCK_EX); self.assertEqual(os.lseek(f.fileno(), 0, os.SEEK_CUR), pos)
            m.flock(f, m.LOCK_UN); self.assertEqual(os.lseek(f.fileno(), 0, os.SEEK_CUR), pos)

    def test_blocking_waits(self):
        m = self.m; m._POLL_SECONDS = 0.01
        a = os.open(self.p, os.O_CREAT | os.O_RDWR); b = os.open(self.p, os.O_RDWR)
        m.flock(a, m.LOCK_EX)
        import threading
        threading.Timer(0.1, lambda: m.flock(a, m.LOCK_UN)).start()
        t = time.monotonic(); m.flock(b, m.LOCK_EX)
        self.assertGreaterEqual(time.monotonic() - t, 0.05)
        os.close(a); os.close(b)

@unittest.skipUnless(os.name == "posix", "POSIX branch")
class PosixProc(unittest.TestCase):
    def test_new_session_kwargs(self):
        self.assertEqual(load("_compat_proc").new_session_kwargs(), {"start_new_session": True})

    def test_kill_process_group_kills_descendants(self):
        m = load("_compat_proc")
        p = subprocess.Popen(["/bin/sh", "-c", "sleep 30 & echo $!; wait"], stdout=subprocess.PIPE, text=True, **m.new_session_kwargs())
        grandchild = int(p.stdout.readline())
        m.kill_process_group(p.pid)
        p.wait(timeout=5)
        self.assertEqual(p.returncode, -signal.SIGKILL)
        for _ in range(50):
            try: os.kill(grandchild, 0)
            except ProcessLookupError: break
            time.sleep(0.05)
        else: self.fail("grandchild survived")

CHILD_TREE = r"""
import subprocess, sys, time
g = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
print(g.pid, flush=True)
time.sleep(60)
"""

@unittest.skipUnless(os.name == "nt", "real Windows (CI windows-latest)")
class WindowsReal(unittest.TestCase):
    """The Windows branches on a REAL Windows host (GitHub Actions windows-latest)."""
    def test_real_msvcrt_cross_process_contention(self):
        m = load("_compat_lock")
        self.assertEqual(m.flock.__module__, m.__name__)  # our shim, not fcntl
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "x.lock")
            fd = os.open(p, os.O_CREAT | os.O_RDWR | getattr(os, "O_BINARY", 0), 0o600)
            m.flock(fd, m.LOCK_EX | m.LOCK_NB)
            code = ("import sys; sys.path.insert(0, %r); import _compat_lock as f, os\n"
                    "fd=os.open(%r, os.O_RDWR)\ntry:\n f.flock(fd, f.LOCK_EX|f.LOCK_NB); print('got')\n"
                    "except BlockingIOError: print('busy')") % (str(TOOLS), p)
            out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
            self.assertEqual(out.stdout.strip(), "busy", out.stderr)
            m.flock(fd, m.LOCK_UN)
            out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
            self.assertEqual(out.stdout.strip(), "got", out.stderr)
            os.close(fd)

    def test_new_session_kwargs_is_new_process_group(self):
        self.assertEqual(load("_compat_proc").new_session_kwargs(), {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP})

    def test_kill_process_group_kills_descendants(self):
        m = load("_compat_proc")
        p = subprocess.Popen([sys.executable, "-c", CHILD_TREE], stdout=subprocess.PIPE, text=True, **m.new_session_kwargs())
        grandchild = int(p.stdout.readline())
        m.kill_process_group(p.pid)
        p.wait(timeout=10)
        for _ in range(100):
            alive = subprocess.run(["tasklist", "/FI", f"PID eq {grandchild}", "/NH"], capture_output=True, text=True).stdout
            if str(grandchild) not in alive: break
            time.sleep(0.1)
        else: self.fail("grandchild survived taskkill /T")

class VenvPython(unittest.TestCase):
    def test_portable_engine_python_posix_unchanged(self):
        src = (TOOLS / "prepare_production.py").read_text()
        self.assertIn('else f"{PORTABLE_ENGINE_ROOT}/.venv/bin/python"', src)
        self.assertIn('f"{PORTABLE_ENGINE_ROOT}/.venv/Scripts/python.exe" if os.name == "nt"', src)


LOG_SCRIPT = r"""
import json, os, sys
sys.path.insert(0, sys.argv[1])
import log, _compat_dirfd
job = sys.argv[2]
ids = [log.log_event(job, "t.py", "start", extra={"n": 1}),
       log.log_event(job, "t.py", "api", prompt="p" * 900, response="r" * 700, duration_seconds=1.23456),
       log.log_event(job, "t.py", "done")]
log.render_markdown(job)
with log.job_lock_at(_compat_dirfd.open(job, os.O_RDONLY | _compat_dirfd.O_DIRECTORY), timeout=1):
    pass
print(json.dumps({"emulate": _compat_dirfd.EMULATE, "ids": ids}))
"""

class DirFdCompat(unittest.TestCase):
    """log.py through _compat_dirfd: native dir_fd mode vs path-emulation mode (the Windows
    code path, forced on Linux with VIDEOCLAW_PORT_DIRFD_EMULATE=1) must produce the same
    job directory (modulo random ids/timestamps)."""
    def run_mode(self, emulate):
        job = Path(tempfile.mkdtemp()) / "job1"
        env = {**os.environ, **({"VIDEOCLAW_PORT_DIRFD_EMULATE": "1"} if emulate else {})}
        env.pop("VIDEOCLAW_PORT_DIRFD_EMULATE", None) if not emulate else None
        out = subprocess.run([sys.executable, "-c", LOG_SCRIPT, str(TOOLS), str(job)], env=env, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        meta = __import__("json").loads(out.stdout)
        self.assertEqual(meta["emulate"], emulate or os.name == "nt")  # Windows always emulates
        files = sorted(p.relative_to(job).as_posix() for p in job.rglob("*"))
        events = [__import__("json").loads(l) for l in (job / "run.log.jsonl").read_text().splitlines()]
        norm = lambda s: s.replace(meta["ids"][1], "ID1")
        return {
            "files": [norm(f) for f in files],
            "events": [{k: (norm(v) if isinstance(v, str) else v) for k, v in e.items() if k not in ("id", "ts")} for e in events],
            "sidecar": (job / "run" / f"{meta['ids'][1]}__prompt.txt").read_text(),
        }
    def test_emulated_matches_native(self):
        native, emulated = self.run_mode(False), self.run_mode(True)
        self.assertEqual(native, emulated)
        self.assertIn("run.md", native["files"])
        self.assertIn("run/ID1__response.txt", native["files"])
        self.assertEqual(native["events"][1]["prompt_sidecar"], "run/ID1__prompt.txt")
    def test_posix_functions_are_os_functions(self):
        m = load("_compat_dirfd", "_compat_dirfd_native")
        if not m.EMULATE:
            self.assertIs(m.open, os.open); self.assertIs(m.stat, os.stat); self.assertIs(m.replace, os.replace)
            self.assertEqual(m.O_DIRECTORY, os.O_DIRECTORY)

class DirFdEmulationUnit(unittest.TestCase):
    def setUp(self):
        os.environ["VIDEOCLAW_PORT_DIRFD_EMULATE"] = "1"
        try:
            self.d = load("_compat_dirfd", "_compat_dirfd_emul")
        finally:
            del os.environ["VIDEOCLAW_PORT_DIRFD_EMULATE"]
        self.root = Path(tempfile.mkdtemp())
    def test_at_calls_resolve_by_path(self):
        d = self.d
        self.assertTrue(d.EMULATE)
        r = d.open(self.root, os.O_RDONLY | d.O_DIRECTORY)
        self.assertGreaterEqual(r, 1 << 30)
        d.mkdir("sub", 0o700, dir_fd=r)
        s = d.open("sub", os.O_RDONLY | d.O_DIRECTORY | d.O_NOFOLLOW, dir_fd=r)
        f = d.open("a.txt", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=s)
        os.write(f, b"hello\n"); d.fsync(f); d.close(f)
        self.assertEqual(sorted(d.listdir(s)), ["a.txt"])
        self.assertTrue(__import__("stat").S_ISDIR(d.fstat(s).st_mode))
        d.link("a.txt", "b.txt", src_dir_fd=s, dst_dir_fd=s, follow_symlinks=False)
        d.rename("b.txt", "c.txt", src_dir_fd=s, dst_dir_fd=r)
        d.replace("c.txt", "d.txt", src_dir_fd=r, dst_dir_fd=r)
        g = d.open("d.txt", os.O_RDONLY, dir_fd=r)
        os.lseek(g, 1, os.SEEK_SET)
        self.assertEqual(d.pread(g, 3, 2), b"llo")
        self.assertEqual(os.lseek(g, 0, os.SEEK_CUR), 1)
        d.close(g)
        s2 = d.dup(s); d.close(s)
        self.assertEqual(d.stat("a.txt", dir_fd=s2, follow_symlinks=False).st_size, 6)
        d.unlink("a.txt", dir_fd=s2); d.fsync(s2); d.close(s2)
        os.symlink(self.root / "d.txt", self.root / "ln")
        with self.assertRaises(OSError) as cm:
            d.open("ln", os.O_RDONLY | d.O_NOFOLLOW, dir_fd=r)
        self.assertEqual(cm.exception.errno, errno.ELOOP)
        with self.assertRaises(NotADirectoryError):
            d.open("d.txt", os.O_RDONLY | d.O_DIRECTORY, dir_fd=r)
        d.close(r)

if __name__ == "__main__":
    unittest.main(verbosity=1)
