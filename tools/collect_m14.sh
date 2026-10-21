#!/usr/bin/env bash
# PORT-NEW (docs/31): copy the redacted evidence of one port/tools/ui-e2e-m14*.mjs run into artifacts/phase-b-m14/<NAME>-*.
# Never copies media (mp3/mp4/jpg) or databases; screenshots are PNG.
#   tools/collect_m14.sh RUN_DIR OUT_GLOB SUMMARY_FILE NAME
set -euo pipefail
RUN=$(realpath "$1"); O=$(ls -d "$RUN"/$2 | tail -1); SUM=$3; NAME=$4; REPO=$(cd "$(dirname "$0")/.." && pwd); A=$REPO/artifacts/phase-b-m14
UD=$RUN/.config/videoclaw-port
mkdir -p "$A/$NAME-shots"
cp "$O"/shots/*.png "$A/$NAME-shots/"
cp "$O/$SUM" "$A/$NAME-summary.json"
cp "$O/cdp-log.jsonl" "$A/$NAME-cdp-log.jsonl"
cp "$O/events.jsonl" "$A/$NAME-events.jsonl" 2>/dev/null || true
cp "$O/ipc.jsonl" "$A/$NAME-ipc.jsonl"
grep -E '^\{|\[local-gateway\]' "$O/main.log" > "$A/$NAME-main-structured.log" || true
for f in sessions.json spend-budgets.json local-gateway/ledger.json; do
  [ -f "$UD/$f" ] && python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1])),indent=1,ensure_ascii=False))" "$UD/$f" > "$A/$NAME-$(basename "$f")"
done
# job incoming listing (names + sizes + sha256 only; the media itself is never copied)
( cd "$RUN/Videoclaw/jobs" 2>/dev/null && find . -path '*/incoming/*' -type f -printf '%p %s\n' | while read -r p s; do echo "$p $s $(sha256sum "$p" | cut -c1-64)"; done ) > "$A/$NAME-incoming.txt" || true
sed -i -E "s#$RUN#<RUN>#g; s#$REPO#<REPO>#g; s#vcgp_[A-Za-z0-9_-]+#vcgp_<REDACTED>#g; s#vcs_[A-Za-z0-9_.-]+#vcs_<REDACTED>#g; s#vck_[A-Za-z0-9_-]+#vck_<REDACTED>#g; s#/workspace/vc-linux/home#<ENGINE_HOME>#g; s#(Bearer )[A-Za-z0-9._-]{12,}#\\1<REDACTED>#g; s#(sig=)[A-Za-z0-9_-]+#\\1<REDACTED>#g" "$A/$NAME"-*.json "$A/$NAME"-*.jsonl "$A/$NAME"-*.log "$A/$NAME"-*.txt 2>/dev/null || true
if [ -n "${MINIMAX_API_KEY:-}" ]; then
  HITS=$( (grep -rlF -- "$MINIMAX_API_KEY" "$A" 2>/dev/null || true) | wc -l); echo "MINIMAX_API_KEY hits in $A: $HITS"
  [ "$HITS" = 0 ] || { echo "KEY LEAK — refusing" >&2; exit 3; }
fi
find "$A" \( -name '*.mp4' -o -name '*.mp3' -o -name '*.jpg' -o -name '*.sqlite*' -o -name '*.db' \) -print | grep . && { echo "media/db in evidence" >&2; exit 4; } || true
echo "collected $NAME"
