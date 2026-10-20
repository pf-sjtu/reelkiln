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

class VenvPython(unittest.TestCase):
    def test_portable_engine_python_posix_unchanged(self):
        src = (TOOLS / "prepare_production.py").read_text()
        self.assertIn('else f"{PORTABLE_ENGINE_ROOT}/.venv/bin/python"', src)
        self.assertIn('f"{PORTABLE_ENGINE_ROOT}/.venv/Scripts/python.exe" if os.name == "nt"', src)

if __name__ == "__main__":
    unittest.main(verbosity=1)
