#!/usr/bin/env bash
# PORT-NEW (docs/22): one real S1 run through the port app (original renderer, real IPC, real
# MiniMax agent, real engine) at level L1 (inputs pre-placed + path line) or L2 (inputs attached
# through intake:pickFiles → attachment:stage, brief WITHOUT a path line), followed by the M3 tail
# (job:snapshot v1 → vcmedia playback → version:approve → file:saveItemAs) and accept_check.py.
#
#   tools/accept_s1_app.sh RUN_DIR SOURCE_HOME [L1|L2]
#
# RUN_DIR becomes a fresh HOME. SOURCE_HOME is a HOME whose port userData already has an installed
# engine (engine-current.json; the engine dir is used in place) — the bootstrap step is not re-run.
# Needs MINIMAX_API_KEY in the environment (never printed/logged). Concurrency 1: one run at a time.
set -euo pipefail
RUN=$(realpath -m "$1"); SRC=$(realpath "$2"); LEVEL=${3:-L2}
REPO=$(cd "$(dirname "$0")/.." && pwd)
[ -n "${MINIMAX_API_KEY:-}" ] || { echo "MINIMAX_API_KEY not set" >&2; exit 2; }
[ -e "$RUN" ] && { echo "$RUN exists; use a fresh dir" >&2; exit 2; }
UD_SRC="$SRC/.config/videoclaw-port"; UD="$RUN/.config/videoclaw-port"
mkdir -p "$UD" "$RUN/out" "$RUN/export"
cp "$UD_SRC/engine-current.json" "$UD/"
for d in .cache .local .npm; do [ -e "$SRC/$d" ] && cp -al "$SRC/$d" "$RUN/"; done
IN="$RUN/in"
if [ "$LEVEL" = L1 ]; then IN="$RUN/Videoclaw/incoming/s1"; fi
bash "$REPO/tools/accept_fixtures.sh" "$IN" >/dev/null
BRIEF="$RUN/brief.txt"
echo '我有三段短素材和一段配乐。帮我做一个 6.5 秒的竖屏 9:16 快剪：按 a→b→c 顺序，a 取 0.5–3.0 s，b 取 0–2.0 s，c 取 0.5–2.5 s；只用 music.mp3 做音轨（不要素材原声）；不要字幕、不要叠加、不要任何付费工具。渲染成片。' > "$BRIEF"
EXTRA=()
if [ "$LEVEL" = L1 ]; then
  echo '素材在工作区 incoming/s1/ 下：clip_a.mp4、clip_b.mp4、clip_c.mp4、music.mp3。' >> "$BRIEF"
else
  EXTRA=(VIDEOCLAW_PORT_SMOKE_PICK_FILES="$(printf '%s\n' "$IN/clip_a.mp4" "$IN/clip_b.mp4" "$IN/clip_c.mp4" "$IN/music.mp3")")
fi
T0=$(date +%s)
( cd "$REPO/port" && env -u VIDEOCLAW_CLAUDE_AGENT_SDK HOME="$RUN" VIDEOCLAW_PORT_SMOKE=1 VIDEOCLAW_PORT_SMOKE_S1="$BRIEF" \
    VIDEOCLAW_PORT_SMOKE_LLM_ROUTE=minimax VIDEOCLAW_PORT_SMOKE_M3=1 VIDEOCLAW_PORT_SMOKE_SAVE_AS="$RUN/export/s1.mp4" \
    VIDEOCLAW_PORT_EVENT_LOG="$RUN/out/events.jsonl" VIDEOCLAW_PORT_SMOKE_S1_OUT="$RUN/out/s1-driver.json" \
    VIDEOCLAW_PORT_TURN_TIMEOUT_MS=${VIDEOCLAW_PORT_TURN_TIMEOUT_MS:-1500000} VIDEOCLAW_PORT_SMOKE_S1_TIMEOUT_MS=1560000 \
    "${EXTRA[@]}" timeout 1800 xvfb-run -a npx electron --no-sandbox . ) > "$RUN/out/main.log" 2>&1 || echo "electron exit $?" >> "$RUN/out/main.log"
T1=$(date +%s)
SID=$(python3 -c "import json,sys;print(json.load(open('$RUN/out/s1-driver.json'))['sessionId'])" 2>/dev/null || true)
JOB=$(python3 -c "import json,sys;print(json.load(open('$RUN/out/s1-driver.json'))['session']['jobId'] or '')" 2>/dev/null || true)
ARGS=(--inputs "$IN" --userdata "$UD" --session "$SID" --export "$RUN/export/s1.mp4")
[ "$LEVEL" = L2 ] && ARGS+=(--attachments)
if [ -n "$JOB" ] && [ -d "$RUN/Videoclaw/jobs/$JOB" ]; then
  python3 "$REPO/tools/accept_check.py" "$RUN/Videoclaw/jobs/$JOB" "${ARGS[@]}" > "$RUN/out/accept.json" && RC=0 || RC=$?
else RC=9; echo '{"failed":["no job"]}' > "$RUN/out/accept.json"; fi
python3 - "$RUN" "$LEVEL" "$((T1-T0))" "$RC" <<'PY'
import json, sys
run, level, wall, rc = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
d = json.load(open(f"{run}/out/s1-driver.json")) if __import__("os").path.exists(f"{run}/out/s1-driver.json") else {}
a = json.load(open(f"{run}/out/accept.json"))
ev = [e.get("event") or {} for e in d.get("events", [])]
fin = d.get("final") or {}
summary = {"level": level, "acceptRc": rc, "pass": rc == 0, "failed": a.get("failed"), "pending": a.get("pending"), "wallS": wall,
  "turnMs": d.get("turnMs"), "numTurns": fin.get("numTurns"), "durationMs": fin.get("durationMs"), "isError": fin.get("isError"),
  "toolCalls": sum(1 for e in ev if e.get("kind") == "tool_start"), "permissionCards": sum(1 for e in d.get("events", []) if "permissionRequest" in e),
  "errors": [e.get("message") for e in ev if e.get("kind") == "error"][:3], "jobId": (d.get("session") or {}).get("jobId"),
  "m3": {k: (d.get("m3") or {}).get(k) for k in ("finalizedAtMs", "tasteCaptureTurnStarted", "tasteCaptureStopped", "exported")},
  "playback": ((d.get("m3") or {}).get("playback") or {}).get("video"), "attachment": [(x["name"], x["status"]) for x in ((d.get("attachment") or {}).get("settled") or [])]}
json.dump(summary, open(f"{run}/out/summary.json", "w"), indent=1)
print(json.dumps(summary, ensure_ascii=False))
PY
