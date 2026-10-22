#!/usr/bin/env bash
# PORT-NEW: docs/08 runbook S3–S9 automated for a Windows x64 host, run under Git Bash
# (GitHub Actions windows-latest, or a user machine). Mirrors tools/linux_baseline.sh step for
# step so Windows results can be diffed against the proven Linux reference (docs/11).
#
#   tools/windows_runbook.sh ROOT
#   env: OUT=<dir> for jsonl/doctor/e2e outputs (default ROOT/out)
# Requires on PATH: node (official zip layout: node.exe + node_modules/npm), python (only for
# tools/make_windows_engine.py), uv, ffmpeg, ffprobe. Network: uv (CPython 3.14.6 + wheels),
# npm (remotion/hyperframes, @openai/codex@0.160.1-win32-x64).
# Exit 0 iff every doctor check except `gateway` (needs credentials) is green, the e2e
# assemble + verify succeeded, and the codex app-server handshake returned ok.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cygpath -u "${1:?usage: windows_runbook.sh ROOT}")"
OUT="$(cygpath -u "${OUT:-$ROOT/out}")"
W() { cygpath -w "$1"; }
CLI="$(W "$REPO/port/dist/cli/port-cli.cjs")"
[ -f "$REPO/port/dist/cli/port-cli.cjs" ] || { echo "build port first" >&2; exit 2; }
rm -rf "$ROOT"; mkdir -p "$ROOT/bootstrap" "$ROOT/ud" "$OUT"
B="$ROOT/bootstrap"

# S3: Windows engine tarball (hooks python path rewritten to .venv/Scripts/python.exe).
python "$REPO/tools/make_windows_engine.py" "$(W "$B")" | tee "$OUT/make_windows_engine.json"
# Tool layout = docs/08 §1.2: uv.exe, ffmpeg.exe, ffprobe.exe, node\node.exe (+node_modules\npm).
for t in uv ffmpeg ffprobe; do cp "$(command -v $t.exe || command -v $t)" "$B/$t.exe"; done
cp -r "$(dirname "$(command -v node.exe || command -v node)")" "$B/node"
test -f "$B/node/node.exe" && test -f "$B/node/node_modules/npm/bin/npm-cli.js"
{ "$B/uv.exe" --version; "$B/ffmpeg.exe" -version | head -1; "$B/node/node.exe" -v; } | tee "$OUT/tool-versions.txt"

step() { local r; r="$(node "$CLI" "$@" | tail -1)"; echo "$r" | tee -a "$OUT/port-cli.jsonl"; echo "$r" | grep -q '"ok":true'; }
# S4
ENG_LINE="$(node "$CLI" install-engine "$(W "$B")" "$(W "$ROOT/ud")" | tail -1)"; echo "$ENG_LINE" | tee -a "$OUT/port-cli.jsonl"
ENGW="$(echo "$ENG_LINE" | python -c 'import json,sys;print(json.load(sys.stdin)["path"])')"
ENG="$(cygpath -u "$ENGW")"
printf '%s' "$ENG" > "$OUT/engine-path.txt"   # docs/34: the L0 chain step reuses this engine
ls "$ENG/bin" | tee "$OUT/engine-bin.txt"
# S5
step shims "$ENGW"
ls "$ENG/bin" | tee -a "$OUT/engine-bin.txt"
step venv "$ENGW" "$(W "$B")"
"$ENG/.venv/Scripts/python.exe" --version | tee -a "$OUT/tool-versions.txt"
"$ENG/bin/python.cmd" --version | tee -a "$OUT/tool-versions.txt"
"$ENG/bin/python" --version | tee -a "$OUT/tool-versions.txt"   # sh shim through Git Bash
# S6
step remotion "$ENGW" "$(W "$B")"
step hyperframes "$ENGW" "$(W "$B")"
# contracts (validateEngineSessionContext / production / money) against the installed engine
step engine-contracts "$ENGW"
# S8
step stage-workspace "$ENGW" "$(W "$ROOT/ws")"
node "$CLI" doctor "$ENGW" "$(W "$ROOT/ws")" "$(W "$B")" | tee -a "$OUT/port-cli.jsonl" || true

export VIDEOCLAW_ENGINE="$ENGW" VIDEOCLAW_WORKSPACE="$(W "$ROOT/ws")" VIDEOCLAW_JOBS_DIR="$(W "$ROOT/ws/jobs")" UV_PYTHON_PREFERENCE=only-managed PYTHONUTF8=1
export PATH="$ENG/bin:$B:$B/node:$PATH"
"$B/uv.exe" run --project "$ENGW" python "$(W "$ENG/tools/doctor.py")" --json > "$OUT/doctor.json" || true
python - "$(W "$OUT/doctor.json")" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
bad = {k: v["detail"] for k, v in d["checks"].items() if not v["ok"] and k != "gateway"}
for k, v in d["checks"].items(): print(f"doctor {'OK  ' if v['ok'] else 'FAIL'} {k}: {v['detail'][:90]}")
sys.exit(1 if bad else 0)
PY

# e2e (same fixtures + EDL as linux_baseline.sh)
JOB=linux-e2e-20261020-a1b2c3; J="$ROOT/ws/jobs/$JOB"; mkdir -p "$J/broll" "$J/images" "$J/audio"
F="$B/ffmpeg.exe"
"$F" -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$(W "$J/broll/clip_a.mp4")"
"$F" -loglevel error -f lavfi -i smptebars=size=720x1280:rate=30:duration=2 -c:v libx264 -pix_fmt yuv420p "$(W "$J/broll/clip_b.mp4")"
"$F" -loglevel error -f lavfi -i color=c=navy:size=540x960 -frames:v 1 "$(W "$J/images/card.png")"
"$F" -loglevel error -f lavfi -i sine=frequency=220:duration=5.5 -c:a libmp3lame "$(W "$J/audio/vo.mp3")"
cp "$REPO/artifacts/linux-run/e2e-assemble/edl.json" "$J/edl.json"
cd "$ROOT/ws"
"$B/uv.exe" run --project "$ENGW" python "$(W "$ENG/tools/assemble.py")" --job "$JOB" | tee "$OUT/assemble.stdout.txt"
"$B/uv.exe" run --project "$ENGW" python "$(W "$ENG/tools/verify_output.py")" --job "$JOB" --mode render --input final_raw.mp4 | tee "$OUT/verify_output.stdout.txt"
grep -q "STATUS: OK" "$OUT/verify_output.stdout.txt"
cp "$J/run.log.jsonl" "$J/chunk_boundaries.json" "$OUT/" || true
sha256sum "$J/final_raw.mp4" | tee "$OUT/final_raw.sha256"
cd "$REPO"

# S9: codex 0.160.1 win32-x64 from npm (integrity pinned; docs/08 §1.2) + app-server handshake
EXPECT="sha512-yyqykHtHNhm0ZViofGozz9a4ffUyXDsiyRu9Q2hPNg/cu4uzSsovNr5kDmzBXPFWAilmlZuNkwpw1W7uae2nlg=="
GOT="$(npm view @openai/codex@0.160.1-win32-x64 dist.integrity)"
[ "$GOT" = "$EXPECT" ] || { echo "codex win32 integrity mismatch: $GOT" >&2; exit 1; }
mkdir -p "$ROOT/codexpkg" "$B/codex"
(cd "$ROOT/codexpkg" && npm pack @openai/codex@0.160.1-win32-x64 >/dev/null && tar -xzf openai-codex-0.160.1-win32-x64.tgz)
cp -r "$ROOT/codexpkg/package/vendor/x86_64-pc-windows-msvc/." "$B/codex/"
"$B/codex/bin/codex.exe" --version | tee -a "$OUT/tool-versions.txt"
# docs/35 M18: bounded, no pipe a leftover codex.exe could hold open (the first real-Windows run hung here)
rc=0; timeout -k 10 180 node "$CLI" codex-handshake "$(W "$B/codex/bin/codex.exe")" > "$ROOT/codex-handshake.out" 2> "$OUT/codex-handshake.stderr.txt" || rc=$?
echo "codex-handshake exit $rc"; r="$(tail -1 "$ROOT/codex-handshake.out")"; echo "$r" | tee -a "$OUT/port-cli.jsonl"; echo "$r" | grep -q '"ok":true'
sleep 2; (tasklist //FI "IMAGENAME eq codex.exe" || true) | tee "$OUT/codex-leftover-tasklist.txt"
# runBash through the ported Windows shell resolver (Git Bash expected)
node "$CLI" run-bash "echo hi && uname -s && command -v python3" | tail -1 | tee -a "$OUT/port-cli.jsonl"
echo "WINDOWS RUNBOOK OK"
