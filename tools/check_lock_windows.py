#!/usr/bin/env python3
"""Static check: can `uv sync --frozen` on Windows x64 + CPython 3.14 install every locked
package from a wheel? Reads engine/uv.lock (read-only). No network.

For each [[package]] with wheels, look for a wheel whose tags fit cp314 / win_amd64:
  py3-none-any, py2.py3-none-any, cp314-cp314-win_amd64, cp3X-abi3-win_amd64 (X<=14),
  py3-none-win_amd64.  Packages that only have an sdist need a local build (MSVC) -> flagged.
Packages whose dependency edges are all guarded by non-Windows markers are reported separately.
Usage: python3 tools/check_lock_windows.py [path/to/uv.lock]
"""
import re, sys, tomllib, json
from pathlib import Path

LOCK = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "engine" / "uv.lock")
data = tomllib.loads(LOCK.read_text())

def tags(fn):
    m = re.match(r"^(?P<n>.+?)-(?P<v>[^-]+)(-\d[^-]*)?-(?P<py>[^-]+)-(?P<abi>[^-]+)-(?P<plat>[^-]+)\.whl$", fn)
    if not m: return set()
    out = set()
    for py in m["py"].split("."):
        for abi in m["abi"].split("."):
            for plat in m["plat"].split("."):
                out.add((py, abi, plat))
    return out

def ok(t):
    py, abi, plat = t
    if plat not in ("any", "win_amd64"): return False
    if abi == "none" and py in ("py3", "py2", "py314", "cp314") : return True
    if abi == "cp314" and py == "cp314": return True
    m = re.match(r"cp3(\d+)$", py)
    if abi == "abi3" and m and int(m.group(1)) <= 14: return True
    return False

rows = {"wheel": [], "sdist_only": [], "no_artifact": [], "non_windows_only": []}
# markers on dependency edges: collect packages only ever required under darwin/linux markers
edge_markers = {}
for p in data["package"]:
    groups = [p.get("dependencies", []) or []]
    groups += list((p.get("optional-dependencies") or {}).values())
    groups += list((p.get("dev-dependencies") or {}).values())
    for g in groups:
        for d in g:
            edge_markers.setdefault(d["name"], []).append(d.get("marker", ""))
for p in data["package"]:
    name = p["name"]
    if p.get("source", {}).get("virtual") or p.get("source", {}).get("editable"):
        continue
    wheels = [w["url"].rsplit("/", 1)[-1] for w in p.get("wheels", [])]
    good = [w for w in wheels if any(ok(t) for t in tags(w))]
    ms = edge_markers.get(name, [])
    if ms and all(m and re.search(r"sys_platform\s*==\s*'(darwin|linux)'|platform_system\s*==\s*'(Darwin|Linux)'|sys_platform\s*!=\s*'win32'", m) for m in ms):
        rows["non_windows_only"].append(name); continue
    if good: rows["wheel"].append(name)
    elif p.get("sdist"): rows["sdist_only"].append(f"{name} {p.get('version')}")
    else: rows["no_artifact"].append(f"{name} {p.get('version')}")
print(json.dumps({k: (len(v) if k == "wheel" else v) for k, v in rows.items()}, indent=1))
sys.exit(1 if rows["sdist_only"] or rows["no_artifact"] else 0)
