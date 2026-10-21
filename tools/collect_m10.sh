#!/usr/bin/env bash
# PORT-NEW (docs/27): copy the redacted evidence of one port/tools/ui-e2e-m10.mjs phase run into
# artifacts/phase-b-m10/<NAME>-*. Never copies media (mp4) or databases; screenshots are PNG.
#   tools/collect_m10.sh RUN_DIR PHASE NAME
set -euo pipefail
RUN=$(realpath "$1"); PHASE=$2; NAME=$3; REPO=$(cd "$(dirname "$0")/.." && pwd); A=$REPO/artifacts/phase-b-m10; O=$RUN/out-m10-$PHASE
UD=$RUN/.config/videoclaw-port
mkdir -p "$A/$NAME-shots"
cp "$O"/shots/*.png "$A/$NAME-shots/"
cp "$O/m10-summary.json" "$A/$NAME-summary.json"
cp "$O/cdp-log.jsonl" "$A/$NAME-cdp-log.jsonl"
cp "$O/events.jsonl" "$A/$NAME-events.jsonl" 2>/dev/null || true
cp "$O/ipc.jsonl" "$A/$NAME-ipc.jsonl"
grep -E '^\{' "$O/main.log" > "$A/$NAME-main-structured.log" || true
python3 -c "import json;print(json.dumps(json.load(open('$UD/sessions.json')),indent=1,ensure_ascii=False))" > "$A/$NAME-sessions.json"
sed -i -E "s#$RUN#<RUN>#g; s#/workspace/m8/A1#<SOURCE_RUN>#g; s#$REPO#<REPO>#g; s#vcgp_[A-Za-z0-9_-]+#vcgp_<REDACTED>#g; s#/workspace/vc-linux/home#<ENGINE_HOME>#g; s#/workspace/s1/h#<ENGINE_HOME>#g; s#/workspace/m10/[A-Za-z0-9]*#<RUN>#g; s#(Bearer )[A-Za-z0-9._-]{12,}#\\1<REDACTED>#g" "$A/$NAME"-*.json "$A/$NAME"-*.jsonl "$A/$NAME"-*.log 2>/dev/null || true
if [ -n "${MINIMAX_API_KEY:-}" ]; then
  HITS=$( (grep -rlF -- "$MINIMAX_API_KEY" "$A" 2>/dev/null || true) | wc -l); echo "MINIMAX_API_KEY hits in $A: $HITS"
  [ "$HITS" = 0 ] || { echo "KEY LEAK — refusing" >&2; exit 3; }
fi
find "$A" \( -name '*.mp4' -o -name '*.sqlite*' -o -name '*.db' \) -print | grep . && { echo "media/db in evidence" >&2; exit 4; } || true
echo "collected $NAME"
