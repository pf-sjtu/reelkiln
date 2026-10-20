#!/usr/bin/env bash
# PORT-NEW: headless Electron smoke on Linux (docs/12). Boots the port's Electron main process
# under xvfb with the PORT-NEW smoke driver (VIDEOCLAW_PORT_SMOKE=1), which calls the REAL
# renderer→preload→ipcMain path:
#   run 1: media:voiceDictationStatus, session:list, bootstrap:run (real BootstrapCore against
#          BOOTSTRAP_DIR; accepts a doctor whose only red check is `gateway`)
#   run 2: editorRender:start → utilityProcess worker → uv → engine hyperframes_render.py →
#          headless Chrome → final_hyperframes.mp4, using a sessions.json fixture in the
#          original AgentHost registry format and the HyperFrames composition fixture.
#   tools/linux_shell_smoke.sh BOOTSTRAP_DIR [HOME_DIR] [LOG]
# BOOTSTRAP_DIR: engine.manifest.json + tarball + uv/ffmpeg/ffprobe/node (as built by
# tools/linux_baseline.sh in ROOT/bootstrap). Requires: xvfb-run, port built, Electron binary.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
B="$(cd "$1" && pwd)"; H="${2:-/tmp/vc-shell-home}"; LOG="${3:-$H/shell-smoke.log}"
ELECTRON="$REPO/port/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || node "$REPO/port/node_modules/electron/install.js"
rm -rf "$H"; mkdir -p "$H"
run() { (cd "$REPO/port" && env HOME="$H" XDG_CONFIG_HOME="$H/.config" VIDEOCLAW_ENGINE_DIST="$B" VIDEOCLAW_PORT_SMOKE=1 "$@" timeout 900 xvfb-run -a "$ELECTRON" --no-sandbox .) 2>&1 | grep -v "dbus\|Fontconfig" ; }
echo "# run 1: bootstrap" | tee "$LOG"
run VIDEOCLAW_PORT_REAL_BOOTSTRAP=1 VIDEOCLAW_PORT_ACCEPT_GATEWAY_RED=1 | tee -a "$LOG"
UD="$H/.config/videoclaw-port"  # Electron userData on Linux = $XDG_CONFIG_HOME/<name> (GitHub runners export XDG_CONFIG_HOME, so it is pinned above)
test -f "$UD/engine-current.json" || { echo "engine was not activated" >&2; exit 1; }
JOB=linux-hf-20261020-d4e5f6; SID=11111111-2222-4333-8444-555555555555
mkdir -p "$H/Videoclaw/jobs/$JOB"; cp -r "$REPO/artifacts/linux-run/fixtures/hyperframes-card" "$H/Videoclaw/jobs/$JOB/hyperframes"
python3 - "$UD/sessions.json" "$H/Videoclaw" "$JOB" "$SID" <<'PY'
import json, sys
f, ws, job, sid = sys.argv[1:]
# Field set mirrors AgentHost.createSession's meta (main/index.js L38800-38850) for a local
# claude-code video that has adopted a job. This is a FIXTURE: the port has no agent runtime.
json.dump({"clients": [{"clientId": "personal", "name": "Personal"}], "sessions": [{
  "sessionId": sid, "title": "Linux smoke", "cwd": ws, "status": "idle", "permissionMode": "auto",
  "totalCostUsd": 0, "createdAt": 1792500000000, "clientId": "personal",
  "agentHarness": "claude-code", "jobId": job}]}, open(f, "w"), indent=1)
PY
echo "# run 2: editorRender" | tee -a "$LOG"
run VIDEOCLAW_PORT_SMOKE_SESSION=$SID VIDEOCLAW_PORT_SMOKE_JOB=$JOB | tee -a "$LOG"
grep -q '^\[smoke\] {"name":"editorRender:event(terminal)","ok":true' "$LOG"
grep -q '^\[smoke\] {"name":"bootstrap:run","ok":true' "$LOG"
test -s "$H/Videoclaw/jobs/$JOB/final_hyperframes.mp4"
echo "SHELL SMOKE OK"
