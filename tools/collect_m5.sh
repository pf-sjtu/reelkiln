#!/usr/bin/env bash
# PORT-NEW (docs/23): copy the redacted evidence of one UI-e2e run (port/tools/ui-e2e.mjs) into
# artifacts/phase-b-m5/<name>-*. Never copies media (mp4) or databases; screenshots are PNG.
#   tools/collect_m5.sh RUN_DIR NAME
set -euo pipefail
RUN=$(realpath "$1"); NAME=$2; REPO=$(cd "$(dirname "$0")/.." && pwd); A=$REPO/artifacts/phase-b-m5; O=$RUN/out
mkdir -p "$A/$NAME-shots"
cp "$O"/shots/*.png "$A/$NAME-shots/"
cp "$O/ui-e2e-summary.json" "$A/$NAME-ui-e2e-summary.json"
cp "$O/cdp-log.jsonl" "$A/$NAME-cdp-log.jsonl"
cp "$O/events.jsonl" "$A/$NAME-events.jsonl"
cp "$O/export.ffprobe.json" "$A/$NAME-export.ffprobe.json" 2>/dev/null || true
grep -E '^\{' "$O/main.log" > "$A/$NAME-main-structured.log" || true
grep -E '^\[(ui-e2e|port|smoke)\] (mode|renderer|save dialog|showItemInFolder|AgentHost|llmRoute)' "$O/main.log" | cut -c1-600 > "$A/$NAME-main-markers.log" || true
J=$(python3 -c "import json;print(json.load(open('$O/ui-e2e-summary.json')).get('jobId') or '')")
SID=$(python3 -c "import json;print(json.load(open('$O/ui-e2e-summary.json')).get('sessionId') or '')")
UD=$RUN/.config/videoclaw-port
if [ -n "$J" ]; then
  JD=$RUN/Videoclaw/jobs/$J
  python3 "$REPO/tools/accept_check.py" "$JD" --inputs "$RUN/in" --userdata "$UD" --session "$SID" --export "$RUN/export/s1.mp4" --attachments > "$A/$NAME-accept.json" || true
  [ -f "$JD/edl.json" ] && cp "$JD/edl.json" "$A/$NAME-edl.json"
  (cd "$RUN" && sha256sum "Videoclaw/jobs/$J/final.mp4" "Videoclaw/jobs/$J/versions/v1.mp4" export/s1.mp4 Videoclaw/jobs/$J/incoming/* in/* 2>/dev/null) > "$A/$NAME-sha256.txt"
  python3 -c "import json;print(json.dumps(json.load(open('$UD/versions.json')),indent=1))" > "$A/$NAME-versions.json"
  python3 -c "import json;print(json.dumps(json.load(open('$UD/sessions.json')),indent=1))" > "$A/$NAME-sessions.json"
fi
sed -i -E "s#$RUN#<RUN>#g; s#/workspace/s1/h#<ENGINE_HOME>#g; s#/tmp/appimage_extracted_[0-9a-f]+#<APPIMAGE_ROOT>#g; s#$REPO#<REPO>#g" "$A/$NAME"-*.json "$A/$NAME"-*.jsonl "$A/$NAME"-*.log "$A/$NAME"-*.txt 2>/dev/null || true
if [ -n "${MINIMAX_API_KEY:-}" ]; then
  HITS=$( (grep -rlF -- "$MINIMAX_API_KEY" "$A" 2>/dev/null || true) | wc -l); echo "MINIMAX_API_KEY hits in $A: $HITS"
  [ "$HITS" = 0 ] || { echo "KEY LEAK — refusing" >&2; exit 3; }
fi
find "$A" \( -name '*.mp4' -o -name '*.sqlite*' -o -name '*.db' \) -print | grep . && { echo "media/db in evidence" >&2; exit 4; } || true
echo "collected $NAME"
