#!/usr/bin/env bash
# PORT-NEW (docs/26): copy the redacted evidence of one port/tools/ui-e2e-m9.mjs phase run into
# artifacts/phase-b-m9/<NAME>-*. Never copies media (mp4) or databases; screenshots are PNG.
#   tools/collect_m9.sh RUN_DIR PHASE NAME [--sdk-transcript]
#   --sdk-transcript: also writes <NAME>-sdk-transcript.jsonl — ONLY the user/assistant rows of the video's
#   SDK transcript (type, uuid, sessionId, timestamp, text tail); request blobs / system prompts are dropped.
set -euo pipefail
RUN=$(realpath "$1"); PHASE=$2; NAME=$3; REPO=$(cd "$(dirname "$0")/.." && pwd); A=$REPO/artifacts/phase-b-m9; O=$RUN/out-m9-$PHASE
UD=$RUN/.config/videoclaw-port
mkdir -p "$A/$NAME-shots"
cp "$O"/shots/*.png "$A/$NAME-shots/"
cp "$O/m9-summary.json" "$A/$NAME-summary.json"
cp "$O/cdp-log.jsonl" "$A/$NAME-cdp-log.jsonl"
cp "$O/events.jsonl" "$A/$NAME-events.jsonl" 2>/dev/null || true
cp "$O/ipc.jsonl" "$A/$NAME-ipc.jsonl"
grep -E '^\{' "$O/main.log" > "$A/$NAME-main-structured.log" || true
python3 -c "import json;print(json.dumps(json.load(open('$UD/sessions.json')),indent=1,ensure_ascii=False))" > "$A/$NAME-sessions.json"
if [ "${4:-}" = "--sdk-transcript" ]; then
  python3 - "$UD" "$A/$NAME-sdk-transcript.jsonl" <<'PY'
import json, os, sys
ud, out = sys.argv[1], sys.argv[2]
sess = json.load(open(os.path.join(ud, "sessions.json")))["sessions"]
ids = {s.get("sdkSessionId") for s in sess if s.get("sdkSessionId")}
root = os.path.join(ud, "engine-profile", "projects"); rows = []
for d in sorted(os.listdir(root)):
    for f in sorted(os.listdir(os.path.join(root, d))):
        if not f.endswith(".jsonl") or f[:-6] not in ids or d.startswith("-workspace-m8-"): continue
        for l in open(os.path.join(root, d, f)):
            r = json.loads(l)
            if r.get("type") not in ("user", "assistant"): continue
            c = (r.get("message") or {}).get("content"); t = c if isinstance(c, str) else " ".join(b.get("text", "") if b.get("type") == "text" else f"<{b.get('type')}>" for b in c or [] if isinstance(b, dict))
            rows.append({"file": f, "type": r["type"], "uuid": r.get("uuid"), "sessionId": r.get("sessionId"), "timestamp": r.get("timestamp"), "textTail": t[-160:]})
open(out, "w").write("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows))
PY
fi
sed -i -E "s#$RUN#<RUN>#g; s#/workspace/m8/A1#<SOURCE_RUN>#g; s#$REPO#<REPO>#g; s#vcgp_[A-Za-z0-9_-]+#vcgp_<REDACTED>#g; s#/workspace/s1/h#<ENGINE_HOME>#g; s#/workspace/m9b/[A-Za-z0-9]*#<RUN>#g" "$A/$NAME"-*.json "$A/$NAME"-*.jsonl "$A/$NAME"-*.log 2>/dev/null || true
if [ -n "${MINIMAX_API_KEY:-}" ]; then
  HITS=$( (grep -rlF -- "$MINIMAX_API_KEY" "$A" 2>/dev/null || true) | wc -l); echo "MINIMAX_API_KEY hits in $A: $HITS"
  [ "$HITS" = 0 ] || { echo "KEY LEAK — refusing" >&2; exit 3; }
fi
find "$A" \( -name '*.mp4' -o -name '*.sqlite*' -o -name '*.db' \) -print | grep . && { echo "media/db in evidence" >&2; exit 4; } || true
echo "collected $NAME"
