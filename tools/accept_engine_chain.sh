#!/usr/bin/env bash
# PORT-NEW (docs/20 §3.5): level-L0 of acceptance scenario S1 — the $0 engine chain WITHOUT the app
# or an agent: fixtures → job dir → (production_guard) → assemble.py → compose_render.py
# --mode render --no-captions --no-overlays → verify_output.py → tools/accept_check.py --engine-only.
#   tools/accept_engine_chain.sh ENGINE_DIR WORK_DIR
# ENGINE_DIR: an installed engine (bootstrap done: .venv, remotion npm ci + browser).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$(cd "$1" && pwd)"; W="$2"; rm -rf "$W"; mkdir -p "$W/ws/jobs"; W="$(cd "$W" && pwd)"
# docs/34 M17: the same chain under Git Bash on Windows (windows-latest CI): venv python lives in .venv/Scripts,
# the engine/workspace paths handed to Python are Windows paths, and the runner's own node/python/ffmpeg stay on PATH.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
if [ "$WIN" = 1 ]; then P() { cygpath -w "$1"; }; VPY="$ENG/.venv/Scripts/python.exe"; PY3=python; else P() { printf '%s' "$1"; }; VPY="$ENG/.venv/bin/python"; PY3=python3; fi
JOB=accept-s1-l0-000001; J="$W/ws/jobs/$JOB"
bash "$REPO/tools/accept_fixtures.sh" "$W/inputs" >/dev/null
mkdir -p "$J/footage" "$J/audio"
cp "$W/inputs/clip_a.mp4" "$W/inputs/clip_b.mp4" "$W/inputs/clip_c.mp4" "$J/footage/"; cp "$W/inputs/music.mp3" "$J/audio/"
cp "$REPO/artifacts/phase-a-probe/edl.json" "$J/edl.json"
export VIDEOCLAW_ENGINE="$(P "$ENG")" VIDEOCLAW_WORKSPACE="$(P "$W/ws")" VIDEOCLAW_JOBS_DIR="$(P "$W/ws/jobs")" UV_PYTHON_PREFERENCE=only-managed
# docs/38 M21: macOS keeps the runner's PATH too (node/uv/ffmpeg live in the toolcache / Homebrew, not /usr/bin)
if [ "$WIN" = 1 ]; then export PATH="$ENG/bin:$PATH" PYTHONUTF8=1
elif [ "$(uname -s)" = Darwin ]; then export PATH="$ENG/bin:$PATH"
else export PATH="$ENG/bin:${NODE_PREFIX:-/home/box/.n}/bin:/usr/bin:/bin"; fi
cd "$W/ws"
L='uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools'
i=0; for c in "$L/assemble.py\" --job $JOB" "$L/compose_render.py\" --job $JOB --mode render --resolution 720p --no-captions --no-overlays"; do
  # the PreToolUse guard the agent's Bash would pass through (auto-records a route receipt)
  "$PY3" -c 'import json,sys;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2],"session_id":"l0"}))' "$c" "$(P "$W/ws")" \
    | "$VPY" "$(P "$ENG/.claude/hooks/production_guard.py")"
  i=$((i+1)); bash -c "$c" > "$W/step$i.log" 2>&1 || { echo "FAILED: $c"; echo "--- tail of step$i.log ---"; tail -n 120 "$W/step$i.log"; exit 1; }
done
uv run --project "$VIDEOCLAW_ENGINE" python "$(P "$ENG/tools/verify_output.py")" --job "$JOB" --mode render --input final.mp4 | tee "$W/verify.log" | tail -1
grep -q "STATUS: OK" "$W/verify.log"
# compose_render links the job into the engine's remotion/public (a junction on Windows: rmdir, never rm -r through it)
if [ "$WIN" = 1 ] && [ -d "$ENG/remotion/public/_jobs/$JOB" ] && [ ! -L "$ENG/remotion/public/_jobs/$JOB" ]; then cmd //c rmdir "$(P "$ENG/remotion/public/_jobs/$JOB")" 2>/dev/null || true; else rm -f "$ENG/remotion/public/_jobs/$JOB"; fi
"$PY3" "$(P "$REPO/tools/accept_check.py")" "$(P "$J")" --inputs "$(P "$W/inputs")" --engine-only > "$W/accept.json"
"$PY3" -c 'import json,sys;d=json.load(open(sys.argv[1]));print("L0 ACCEPT", "PASS" if not d["failed"] else "FAIL "+str(d["failed"]));sys.exit(1 if d["failed"] else 0)' "$(P "$W/accept.json")"
