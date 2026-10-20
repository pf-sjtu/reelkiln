#!/usr/bin/env bash
# PORT-NEW: reproducible Linux baseline (docs/11). Runs the PORTED main-process bootstrap
# steps through port-cli against a real engine, then doctor and a cloud-free end-to-end
# engine run (assemble.py EDL render + verify_output.py). Used locally and by CI.
#
#   tools/linux_baseline.sh [ROOT] [BOOTSTRAP_SRC]
#     ROOT           scratch dir (default /tmp/vc-linux-run); everything is created inside.
#     BOOTSTRAP_SRC  dir holding engine.manifest.json + engine tarball (e.g. the shipped
#                    0.0.40 bundle's Resources/bootstrap). Default: build a posix tarball
#                    from repo/engine with tools/make_windows_engine.py --target posix.
#   env: OUT=<dir> copy doctor.json etc. there; VIDEOCLAW_PORT_DIRFD_EMULATE=1 passes
#        through to the engine (forces the _compat_dirfd emulation path on POSIX).
# Requires on PATH: uv, ffmpeg, ffprobe, node, npm. Needs network for uv/npm downloads.
# Exit 0 iff every doctor check except `gateway` (needs credentials) is green and the
# end-to-end render + verify succeeded.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:-/tmp/vc-linux-run}"
SRC="${2:-}"
OUT="${OUT:-$ROOT/out}"
CLI="$REPO/port/dist/cli/port-cli.cjs"
[ -f "$CLI" ] || { echo "build port first: (cd port && npm ci && npm run build)" >&2; exit 2; }
rm -rf "$ROOT"; mkdir -p "$ROOT/bootstrap" "$ROOT/ud" "$OUT"
B="$ROOT/bootstrap"
if [ -z "$SRC" ]; then
  python3 "$REPO/tools/make_windows_engine.py" "$B" --target posix >/dev/null
else
  cp "$SRC/engine.manifest.json" "$B/"
  cp "$SRC/$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$SRC/engine.manifest.json")" "$B/"
fi
# Tool layout mirrors the shipped Resources/bootstrap (uv, ffmpeg, ffprobe, node/bin/node).
for t in uv ffmpeg ffprobe; do ln -s "$(command -v $t)" "$B/$t"; done
ln -s "$(cd "$(dirname "$(readlink -f "$(command -v node)")")/.." && pwd)" "$B/node"

step() { local r; r="$(node "$CLI" "$@")"; echo "$r" | tail -1 | tee -a "$OUT/port-cli.jsonl"; echo "$r" | tail -1 | grep -q '"ok":true'; }
ENG_LINE="$(node "$CLI" install-engine "$B" "$ROOT/ud" | tail -1)"; echo "$ENG_LINE" | tee -a "$OUT/port-cli.jsonl"
ENG="$(echo "$ENG_LINE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["path"])')"
step shims "$ENG"
step venv "$ENG" "$B"
step remotion "$ENG" "$B"
step hyperframes "$ENG" "$B"
step stage-workspace "$ENG" "$ROOT/ws"
node "$CLI" doctor "$ENG" "$ROOT/ws" "$B" | tee -a "$OUT/port-cli.jsonl"

export VIDEOCLAW_ENGINE="$ENG" VIDEOCLAW_WORKSPACE="$ROOT/ws" VIDEOCLAW_JOBS_DIR="$ROOT/ws/jobs" UV_PYTHON_PREFERENCE=only-managed
export PATH="$ENG/bin:$B/node/bin:$PATH"
uv run --project "$ENG" python "$ENG/tools/doctor.py" --json > "$OUT/doctor.json" || true
python3 - "$OUT/doctor.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
bad = {k: v["detail"] for k, v in d["checks"].items() if not v["ok"] and k != "gateway"}
for k, v in d["checks"].items(): print(f"doctor {'OK  ' if v['ok'] else 'FAIL'} {k}: {v['detail'][:90]}")
sys.exit(1 if bad else 0)
PY

JOB=linux-e2e-20261020-a1b2c3; J="$ROOT/ws/jobs/$JOB"; mkdir -p "$J/broll" "$J/images" "$J/audio"
ffmpeg -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$J/broll/clip_a.mp4"
ffmpeg -loglevel error -f lavfi -i smptebars=size=720x1280:rate=30:duration=2 -c:v libx264 -pix_fmt yuv420p "$J/broll/clip_b.mp4"
ffmpeg -loglevel error -f lavfi -i color=c=navy:size=540x960 -frames:v 1 "$J/images/card.png"
ffmpeg -loglevel error -f lavfi -i sine=frequency=220:duration=5.5 -c:a libmp3lame "$J/audio/vo.mp3"
cp "$REPO/artifacts/linux-run/e2e-assemble/edl.json" "$J/edl.json"
cd "$ROOT/ws"
uv run --project "$ENG" python "$ENG/tools/assemble.py" --job "$JOB" | tee "$OUT/assemble.stdout.txt"
uv run --project "$ENG" python "$ENG/tools/verify_output.py" --job "$JOB" --mode render --input final_raw.mp4 | tee "$OUT/verify_output.stdout.txt"
grep -q "STATUS: OK" "$OUT/verify_output.stdout.txt"
cp "$J/run.log.jsonl" "$J/chunk_boundaries.json" "$OUT/"
sha256sum "$J/final_raw.mp4" | tee "$OUT/final_raw.sha256"
echo "LINUX BASELINE OK"
