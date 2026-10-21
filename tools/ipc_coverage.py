#!/usr/bin/env python3
"""PORT-NEW (docs/20): classify every original IPC channel by how the port serves it today.

Reads artifacts/manifests/ipc-channels.json (machine-extracted from the original bundle) and
greps the port sources for handler/push registrations. Categories:
  real      - served by a ported/PORT-NEW real implementation (real-backend / llm-runtime / agent-ipc / media-ipc)
  real-partial - real handler with the original's return shape, but only some original branches ported
                 (listed in PARTIAL below with the reason; docs/24)
  real-env  - real only when a PORT-NEW env var is set (bootstrap:run), fake fixture otherwise
  fixture   - fake-backend.ts returns a canned value copied from the original QA fixtures
  stub      - registered but returns undefined / only logs (NOT IMPLEMENTED)
  push-real - main->renderer push the port actually emits
  push-none - main->renderer push the port never emits
  local     - preload-local method (no IPC)
Usage: python3 tools/ipc_coverage.py [--json]
"""
import json, re, sys, collections
from pathlib import Path
R = Path(__file__).resolve().parent.parent
chans = json.loads((R / "artifacts/manifests/ipc-channels.json").read_text())
src = lambda p: (R / "port/src/main" / p).read_text()
key_re = re.compile(r'"([a-zA-Z]+:[a-zA-Z:]+)"\s*:')
assign_re = re.compile(r'(?:handlers|sendHandlers)\["([a-zA-Z]+:[a-zA-Z:]+)"\]\s*=')
real = set(key_re.findall(src("real-backend.ts"))) | set(key_re.findall(src("llm-runtime.ts"))) | set(key_re.findall(src("agent/agent-ipc.ts"))) | set(key_re.findall(src("media/media-ipc.ts"))) | set(assign_re.findall(src("real-backend.ts")))
real_env = {"bootstrap:run"}
# docs/24: session:history serves the original's no-SDK-transcript branch ([]); transcript replay is NOT PORTED
PARTIAL = {"session:history": "no display/SDK transcript replay (historyToEvents over [] only)"}
fixture = set(key_re.findall(src("fake-backend.ts")))
pushes = set()
for f in (R / "port/src/main").rglob("*.ts"):
    pushes |= set(re.findall(r'push\(\s*"([a-zA-Z]+:[a-zA-Z:]+)"', f.read_text()))
rows = []
for c in chans:
    ch, d = c["channel"], c["dir"]
    if d == "M→R": cat = "push-real" if ch in pushes else "push-none"
    elif d == "—": cat = "local"
    elif ch in real_env: cat = "real-env"
    elif ch in real and ch in PARTIAL: cat = "real-partial"
    elif ch in real: cat = "real"
    elif ch in fixture: cat = "fixture"
    else: cat = "stub"
    rows.append({"channel": ch, "dir": d, "category": cat, "bridge": [b[0] for b in c["bridge"]]})
if "--json" in sys.argv:
    print(json.dumps(rows, indent=1)); sys.exit()
tot = collections.Counter(r["category"] for r in rows)
print("TOTAL", len(rows), dict(tot))
g = collections.OrderedDict()
for r in rows: g.setdefault(r["channel"].split(":")[0], []).append(r)
for k, v in g.items():
    cnt = collections.Counter(r["category"] for r in v)
    print(f"{k}\t{len(v)}\t" + ", ".join(f"{a}={b}" for a, b in sorted(cnt.items())) + "\t" +
          " ".join(r["channel"].split(":", 1)[1] for r in v if r["category"] in ("real", "real-partial", "real-env", "fixture", "push-real")))
