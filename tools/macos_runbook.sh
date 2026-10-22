#!/usr/bin/env bash
# PORT-NEW (docs/38 M21): docs/08 runbook S3–S9 on a macOS arm64 host (GitHub Actions macos-latest) — the original
# app's native platform. Mirrors tools/linux_baseline.sh + tools/windows_runbook.sh step for step:
# posix engine tarball → port-cli install-engine / shims / venv / remotion / hyperframes / engine-contracts /
# stage-workspace → doctor (gateway tolerated: needs credentials) → cloud-free e2e (assemble + verify_output) →
# codex 0.160.1 darwin-arm64 app-server handshake → runBash through the ported shell resolver.
#   tools/macos_runbook.sh ROOT        env: OUT=<dir> (default ROOT/out)
# Requires on PATH: node, npm, python3, uv, ffmpeg, ffprobe. Network: uv (CPython 3.14.6 + wheels), npm.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:?usage: macos_runbook.sh ROOT}"
OUT="${OUT:-$ROOT/out}"
CLI="$REPO/port/dist/cli/port-cli.cjs"
[ -f "$CLI" ] || { echo "build port first" >&2; exit 2; }
rm -rf "$ROOT"; mkdir -p "$ROOT/bootstrap" "$ROOT/ud" "$OUT"
ROOT="$(cd "$ROOT" && pwd -P)"; OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd -P)"   # /var → /private/var (docs/35)
B="$ROOT/bootstrap"
real() { python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1"; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# S3: posix engine tarball from repo/engine (the shipped mac bundle carries the same engine build)
python3 "$REPO/tools/make_windows_engine.py" "$B" --target posix | tee "$OUT/make_engine.json"
# tool layout = the shipped Resources/bootstrap: uv, ffmpeg, ffprobe, node/bin/node
for t in uv ffmpeg ffprobe; do ln -s "$(real "$(command -v $t)")" "$B/$t"; done
ln -s "$(dirname "$(dirname "$(real "$(command -v node)")")")" "$B/node"
test -x "$B/node/bin/node"
{ uname -sm; sw_vers 2>/dev/null || true; "$B/uv" --version; "$B/ffmpeg" -version | head -1; "$B/node/bin/node" -v; } | tee "$OUT/tool-versions.txt"

step() { local r; r="$(node "$CLI" "$@" | tail -1)"; echo "$r" | tee -a "$OUT/port-cli.jsonl"; echo "$r" | grep -q '"ok":true'; }
# S4
ENG_LINE="$(node "$CLI" install-engine "$B" "$ROOT/ud" | tail -1)"; echo "$ENG_LINE" | tee -a "$OUT/port-cli.jsonl"
ENG="$(echo "$ENG_LINE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["path"])')"
printf '%s' "$ENG" > "$OUT/engine-path.txt"   # reused by the L0 chain and the S1 UI job
# S5
step shims "$ENG"
ls -l "$ENG/bin" | tee "$OUT/engine-bin.txt"
step venv "$ENG" "$B"
"$ENG/.venv/bin/python" --version | tee -a "$OUT/tool-versions.txt"
"$ENG/bin/python3" --version | tee -a "$OUT/tool-versions.txt"
# S6
step remotion "$ENG" "$B"
step hyperframes "$ENG" "$B"
step engine-contracts "$ENG"
# S8
step stage-workspace "$ENG" "$ROOT/ws"
node "$CLI" doctor "$ENG" "$ROOT/ws" "$B" | tee -a "$OUT/port-cli.jsonl" || true

export VIDEOCLAW_ENGINE="$ENG" VIDEOCLAW_WORKSPACE="$ROOT/ws" VIDEOCLAW_JOBS_DIR="$ROOT/ws/jobs" UV_PYTHON_PREFERENCE=only-managed
export PATH="$ENG/bin:$B:$B/node/bin:$PATH"
"$B/uv" run --project "$ENG" python "$ENG/tools/doctor.py" --json > "$OUT/doctor.json" || true
python3 - "$OUT/doctor.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
bad = {k: v["detail"] for k, v in d["checks"].items() if not v["ok"] and k != "gateway"}
for k, v in d["checks"].items(): print(f"doctor {'OK  ' if v['ok'] else 'FAIL'} {k}: {v['detail'][:90]}")
sys.exit(1 if bad else 0)
PY

# e2e (same fixtures + EDL as linux_baseline.sh)
JOB=linux-e2e-20261020-a1b2c3; J="$ROOT/ws/jobs/$JOB"; mkdir -p "$J/broll" "$J/images" "$J/audio"
F="$B/ffmpeg"
"$F" -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$J/broll/clip_a.mp4"
"$F" -loglevel error -f lavfi -i smptebars=size=720x1280:rate=30:duration=2 -c:v libx264 -pix_fmt yuv420p "$J/broll/clip_b.mp4"
"$F" -loglevel error -f lavfi -i color=c=navy:size=540x960 -frames:v 1 "$J/images/card.png"
"$F" -loglevel error -f lavfi -i sine=frequency=220:duration=5.5 -c:a libmp3lame "$J/audio/vo.mp3"
cp "$REPO/artifacts/linux-run/e2e-assemble/edl.json" "$J/edl.json"
cd "$ROOT/ws"
"$B/uv" run --project "$ENG" python "$ENG/tools/assemble.py" --job "$JOB" | tee "$OUT/assemble.stdout.txt"
"$B/uv" run --project "$ENG" python "$ENG/tools/verify_output.py" --job "$JOB" --mode render --input final_raw.mp4 | tee "$OUT/verify_output.stdout.txt"
grep -q "STATUS: OK" "$OUT/verify_output.stdout.txt"
cp "$J/run.log.jsonl" "$J/chunk_boundaries.json" "$OUT/" || true
sha "$J/final_raw.mp4" | tee "$OUT/final_raw.sha256"
cd "$REPO"

# S9: codex 0.160.1 darwin-arm64 from npm (integrity pinned) + app-server handshake
EXPECT="sha512-6Znu97O7+Ie/cnUpsWLx6NlcPc7DNuj6sAs58xpt0/tKRgx4+xgE9zca1YrwqQUBjUQO1HexudyimmhpZjdWlA=="
GOT="$(npm view @openai/codex@0.160.1-darwin-arm64 dist.integrity)"
[ "$GOT" = "$EXPECT" ] || { echo "codex darwin-arm64 integrity mismatch: $GOT" >&2; exit 1; }
mkdir -p "$ROOT/codexpkg" "$B/codex"
(cd "$ROOT/codexpkg" && npm pack @openai/codex@0.160.1-darwin-arm64 >/dev/null && tar -xzf openai-codex-0.160.1-darwin-arm64.tgz)
cp -R "$ROOT/codexpkg/package/vendor/aarch64-apple-darwin/." "$B/codex/"
"$B/codex/bin/codex" --version | tee -a "$OUT/tool-versions.txt"
rc=0; node "$CLI" codex-handshake "$B/codex/bin/codex" > "$ROOT/codex-handshake.out" 2> "$OUT/codex-handshake.stderr.txt" & HP=$!
for i in $(seq 1 180); do kill -0 "$HP" 2>/dev/null || break; sleep 1; done
if kill -0 "$HP" 2>/dev/null; then kill -9 "$HP"; echo "codex-handshake timed out" >&2; exit 1; fi
wait "$HP" || rc=$?
echo "codex-handshake exit $rc"; r="$(tail -1 "$ROOT/codex-handshake.out")"; echo "$r" | tee -a "$OUT/port-cli.jsonl"; echo "$r" | grep -q '"ok":true'
sleep 2; (pgrep -fl "codex/bin/codex" || true) | tee "$OUT/codex-leftover-ps.txt"
node "$CLI" run-bash "echo hi && uname -sm && command -v python3" | tail -1 | tee -a "$OUT/port-cli.jsonl"
echo "MACOS RUNBOOK OK"
