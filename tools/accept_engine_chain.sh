#!/usr/bin/env bash
# PORT-NEW (docs/20 §3.5): level-L0 of acceptance scenario S1 — the $0 engine chain WITHOUT the app
# or an agent: fixtures → job dir → (production_guard) → assemble.py → compose_render.py
# --mode render --no-captions --no-overlays → verify_output.py → tools/accept_check.py --engine-only.
#   tools/accept_engine_chain.sh ENGINE_DIR WORK_DIR
# ENGINE_DIR: an installed engine (bootstrap done: .venv, remotion npm ci + browser).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$(cd "$1" && pwd)"; W="$2"; rm -rf "$W"; mkdir -p "$W/ws/jobs"
JOB=accept-s1-l0-000001; J="$W/ws/jobs/$JOB"
bash "$REPO/tools/accept_fixtures.sh" "$W/inputs" >/dev/null
mkdir -p "$J/footage" "$J/audio"
cp "$W/inputs/clip_a.mp4" "$W/inputs/clip_b.mp4" "$W/inputs/clip_c.mp4" "$J/footage/"; cp "$W/inputs/music.mp3" "$J/audio/"
cp "$REPO/artifacts/phase-a-probe/edl.json" "$J/edl.json"
export VIDEOCLAW_ENGINE="$ENG" VIDEOCLAW_WORKSPACE="$W/ws" VIDEOCLAW_JOBS_DIR="$W/ws/jobs" UV_PYTHON_PREFERENCE=only-managed
export PATH="$ENG/bin:${NODE_PREFIX:-/home/box/.n}/bin:/usr/bin:/bin"
cd "$W/ws"
L='uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools'
i=0; for c in "$L/assemble.py\" --job $JOB" "$L/compose_render.py\" --job $JOB --mode render --resolution 720p --no-captions --no-overlays"; do
  # the PreToolUse guard the agent's Bash would pass through (auto-records a route receipt)
  python3 -c 'import json,sys;print(json.dumps({"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2],"session_id":"l0"}))' "$c" "$W/ws" \
    | "$ENG/.venv/bin/python" "$ENG/.claude/hooks/production_guard.py"
  i=$((i+1)); bash -c "$c" > "$W/step$i.log" 2>&1 || { echo "FAILED: $c"; exit 1; }
done
uv run --project "$ENG" python "$ENG/tools/verify_output.py" --job "$JOB" --mode render --input final.mp4 | tee "$W/verify.log" | tail -1
grep -q "STATUS: OK" "$W/verify.log"
rm -f "$ENG/remotion/public/_jobs/$JOB"   # compose_render links the job into the engine's remotion/public
python3 "$REPO/tools/accept_check.py" "$J" --inputs "$W/inputs" --engine-only > "$W/accept.json"
python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("L0 ACCEPT", "PASS" if not d["failed"] else "FAIL "+str(d["failed"]))' "$W/accept.json"
