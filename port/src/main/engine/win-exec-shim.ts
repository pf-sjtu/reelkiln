// PORT-NEW (docs/35 §1, found on real Windows CI run 39712365635): the engine's Python tools start npm's
// launchers by BARE name, e.g. compose_render.py `subprocess.run(["npx", "--no-install", "remotion", "render", …])`.
// That is fine on macOS (the original's only platform). On Windows CreateProcess appends only ".exe", and npm/npx
// are `npx.cmd`/`npm.cmd`, so the render dies with `FileNotFoundError: [WinError 2]`. Running the .cmd would need
// cmd.exe re-parsing of the JSON `--props=` argument (unsafe: & | % ^ in user text). So, exactly like the port's
// own npmInvocation (platform/npm.ts), the engine venv gets a startup hook (.pth) that maps a bare "npx"/"npm"
// argv[0] onto `node.exe <dir of node.exe>/node_modules/npm/bin/<tool>-cli.js` — no shell involved. Engine
// source is untouched. Second fix in the same hook: os.fsync of a read-only handle (see the module text).
// Nothing changes on macOS/Linux (the hook is only written on win32 and is a no-op elsewhere).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const WIN_EXEC_MODULE = "_videoclaw_port_winexec";
export const WIN_EXEC_PTH = "videoclaw_port_winexec.pth";
export const WIN_EXEC_PY = `# PORT-NEW (docs/35): Windows only. Bare "npx"/"npm" argv[0] -> node.exe + npm's own *-cli.js (no cmd.exe).
import os, sys
if sys.platform == "win32":
    import shutil, subprocess

    def _videoclaw_port_resolve(tool):
        found = shutil.which(tool)
        if found and found.lower().endswith(".exe"):
            return None  # a real executable exists: leave it alone
        node = shutil.which("node")
        if not node:
            return None
        cli = os.path.join(os.path.dirname(node), "node_modules", "npm", "bin", tool + "-cli.js")
        return [node, cli] if os.path.isfile(cli) else None

    _videoclaw_port_init = subprocess.Popen.__init__

    def _videoclaw_port_popen_init(self, args, *a, **kw):
        if (not kw.get("shell") and kw.get("executable") is None and not a
                and isinstance(args, (list, tuple)) and args
                and isinstance(args[0], str) and args[0].lower() in ("npx", "npm")):
            mapped = _videoclaw_port_resolve(args[0].lower())
            if mapped:
                args = mapped + list(args[1:])
        _videoclaw_port_init(self, args, *a, **kw)

    subprocess.Popen.__init__ = _videoclaw_port_popen_init

if sys.platform == "win32":
    # PORT-NEW (docs/35, real Windows CI run 39713813148): engine _render_completion.publish() fsyncs a handle it
    # opened READ-ONLY ("rb"). POSIX allows that; Windows' _commit/FlushFileBuffers needs write access -> EBADF,
    # so every final render failed after Remotion finished. On EBADF, flush the same file through a write handle
    # (path from GetFinalPathNameByHandleW): the durability the original asks for is kept, nothing is skipped.
    import ctypes, errno, msvcrt
    from ctypes import wintypes
    _videoclaw_port_k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _videoclaw_port_k32.GetFinalPathNameByHandleW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    _videoclaw_port_k32.GetFinalPathNameByHandleW.restype = wintypes.DWORD
    _videoclaw_port_fsync = os.fsync

    def _videoclaw_port_fsync_rw(fd):
        try:
            return _videoclaw_port_fsync(fd)
        except OSError as e:
            if e.errno != errno.EBADF:
                raise
            n = fd if isinstance(fd, int) else fd.fileno()
            buf = ctypes.create_unicode_buffer(32768)
            got = _videoclaw_port_k32.GetFinalPathNameByHandleW(msvcrt.get_osfhandle(n), buf, 32768, 0)
            if not (0 < got < 32768) or not os.path.isfile(buf.value):
                raise
            with open(buf.value, "r+b") as w:
                _videoclaw_port_fsync(w.fileno())

    os.fsync = _videoclaw_port_fsync_rw
`;

/** Write the hook into `<engine>/.venv/Lib/site-packages` (Windows venv layout). Idempotent. Returns the dir. */
export function writeWindowsExecShim(enginePath: string): string {
  const site = join(enginePath, ".venv", "Lib", "site-packages");
  mkdirSync(site, { recursive: true });
  const py = join(site, `${WIN_EXEC_MODULE}.py`);
  if (!existsSync(py) || readFileSync(py, "utf8") !== WIN_EXEC_PY) writeFileSync(py, WIN_EXEC_PY);
  const pth = join(site, WIN_EXEC_PTH);
  const line = `import ${WIN_EXEC_MODULE}\n`;
  if (!existsSync(pth) || readFileSync(pth, "utf8") !== line) writeFileSync(pth, line);
  return site;
}
