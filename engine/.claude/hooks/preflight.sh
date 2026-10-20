#!/usr/bin/env bash
# SessionStart hook — inject the videoclaw production preflight into context at
# turn 1. stdout from a SessionStart hook is added to the model's context.
#
# CONSOLIDATION (LAUNCH_SPEC §1, chunk 16): this hook now carries only session
# CONTEXT — orientation pointers, media-first retrieval, the project brief, and
# the tenant COMMITMENTS injected VERBATIM (a pointer is not a commitment; a
# fresh agent must SEE them). The behavioral LAWS (producer voice + jargon ban,
# route-first, taste-capture, cost contract, one-sitting) live in a compact
# shipped file, $VIDEOCLAW_ENGINE/laws/producer_laws.md, which the app delivers
# as a system-prompt APPEND so it survives long sessions. When the app is NOT
# doing that append (dev / a bare `claude` in the repo, signalled by
# VIDEOCLAW_LAWS_VIA_APPEND being unset) we inject the laws file here as a
# fallback — so JC's dev behavior never regresses.
#
# Every injection leaves a verifiable trace: at the end we write a per-session
# marker the app checks, so a silent hook failure is impossible to miss.
set -euo pipefail

# ── Server-assembly mode (hosted sessions) ────────────────────────────────────
# The videoclaw-runner assembles the system prompt server-side (VOICE_GUARD +
# laws append + brief + verbatim COMMITMENTS from the client's context bundle),
# so it sets VIDEOCLAW_SERVER_ASSEMBLY=1 to tell this hook to stand down: any
# output here would DUPLICATE context the runner already injected. We exit 0 with
# NO output and — critically — do NOT write a session marker: server injection
# cannot silently fail (unlike a hook, whose miss the marker exists to catch), so
# the marker has no meaning in this mode. ONLY the runner ever sets this var;
# bare `claude` in the repo (JC's dev flow) never does, so that path is untouched.
if [ -n "${VIDEOCLAW_SERVER_ASSEMBLY:-}" ]; then
  exit 0
fi

# ── Source checkout: give the one launcher its engine root ────────────────────
# Every engine tool is taught as `uv run --project "$VIDEOCLAW_ENGINE" python
# "$VIDEOCLAW_ENGINE/tools/<tool>.py" ...`. The app always sets VIDEOCLAW_ENGINE;
# a native Claude Code session in a source checkout does not, and the launcher
# would expand to `--project ""`. Claude Code sources $CLAUDE_ENV_FILE (written
# by SessionStart hooks) before each Bash command, so persist this checkout's
# root there. A value that is already set is never overridden, and a resume or
# compaction does not append the line twice.
if [ -z "${VIDEOCLAW_ENGINE:-}" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  CHECKOUT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)" || CHECKOUT_ROOT=""
  if [ -n "$CHECKOUT_ROOT" ]; then
    ENGINE_EXPORT="$(printf 'export VIDEOCLAW_ENGINE=%q' "$CHECKOUT_ROOT")"
    if ! grep -qxF "$ENGINE_EXPORT" "$CLAUDE_ENV_FILE" 2>/dev/null; then
      printf '%s\n' "$ENGINE_EXPORT" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true
    fi
  fi
fi

# $ROOT is the WORKSPACE (user data: jobs/ assets/ taste/ .videoclaw/ markers).
# Anchor it env-first, exactly like tools/_paths.py and qa_gate's _stop_marker:
# a session's cwd (CLAUDE_PROJECT_DIR) is NOT necessarily the workspace — on a
# dev machine an app session can run with cwd=~/projects/videoclaw while
# VIDEOCLAW_WORKSPACE=~/Videoclaw, and the marker/taste/brief reads must all
# follow the env or the app checks the wrong dir (false "preflight missing").
ROOT="${VIDEOCLAW_WORKSPACE:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
# World-1 split (shipped app): code lives in the ENGINE dir, user data (jobs/
# assets/taste) in the workspace ($ROOT). Dev setup: ENGINE == ROOT → no-op.
ENGINE="${VIDEOCLAW_ENGINE:-$ROOT}"
TENANT="${VIDEOCLAW_TENANT:-}"

# The engine's pinned interpreter (.python-version, the same one every hook uses). Never
# fall back to a bare `python3`: on a Mac without the developer tools that is
# Apple's stub, which asks the user to install them (videoclaw-app#1038).
# Without the venv the Python-backed steps below fail quietly and the context
# says how to fix it, in the app's words (videoclaw-app PYTHON_REPAIR_MESSAGE):
# the chat's Repair card, whose one button opens Setup and starts the repair.
PY="$ENGINE/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "VideoClaw's own Python is missing or damaged, so it can't run commands safely. Click Repair VideoClaw in the chat to fix it."
fi

# The SessionStart hook JSON arrives on stdin (session_id, source, cwd, …).
# Consume it once; extract what we need with stdlib python (no jq dependency).
HOOK_JSON="$(cat 2>/dev/null || true)"
SESSION_ID=""
HOOK_SOURCE=""
if [ -n "$HOOK_JSON" ]; then
  SESSION_ID="$(printf '%s' "$HOOK_JSON" | "$PY" -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
print(d.get("session_id",""))' 2>/dev/null || true)"
  HOOK_SOURCE="$(printf '%s' "$HOOK_JSON" | "$PY" -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
print(d.get("source",""))' 2>/dev/null || true)"
fi

if [ "$ENGINE" != "$ROOT" ]; then
  cat <<ENGEOF
═══════════════════════════════════════════════════════════════════════
 ENGINE/WORKSPACE SPLIT (shipped-app layout — read before running tools)
   ENGINE (code):   $ENGINE  ← tools/ skills/ workflows/ CANONICAL_TOOLS.md live HERE
   WORKSPACE (you): $ROOT  ← jobs/ assets/ taste/packs/ live HERE (user data)
 Run every tool with the one launcher (any cwd):
   uv run --project "\$VIDEOCLAW_ENGINE" python "\$VIDEOCLAW_ENGINE/tools/<tool>.py" --job <id>
 (jobs still land in the workspace via VIDEOCLAW_JOBS_DIR.) All doc pointers
 below (CANONICAL_TOOLS.md, skills/*, workflows/*) are ENGINE-relative.
═══════════════════════════════════════════════════════════════════════
ENGEOF
fi

# ── Behavioral LAWS ───────────────────────────────────────────────────────────
# The app delivers these via system-prompt append (durable across long
# sessions) and sets VIDEOCLAW_LAWS_VIA_APPEND=1 when it does. If that signal is
# absent (dev / bare `claude`), inject the shipped laws file here so behavior is
# preserved. LAWS_VERSION is stamped into the marker regardless, as proof of
# which laws shipped alongside this session.
LAWS_FILE="$ENGINE/laws/producer_laws.md"
LAWS_VERSION=""
LAWS_INJECTED="n"
if [ -f "$LAWS_FILE" ]; then
  LAWS_VERSION="$(sed -n 's/^<!-- laws-version:[[:space:]]*\(.*\)[[:space:]]*-->.*/\1/p' "$LAWS_FILE" | head -1 | tr -d '[:space:]')"
  if [ -z "${VIDEOCLAW_LAWS_VIA_APPEND:-}" ]; then
    echo ""
    cat "$LAWS_FILE"
    echo ""
    LAWS_INJECTED="y"
  fi
fi

# One canonical byte sequence feeds local SessionStart and hosted runner
# assembly. The app hashes this exact file into VIDEOCLAW_EFFECTIVE_PREFLIGHT_SHA256;
# duplicating the prose in app code would make route receipts fail closed.
cat "$ENGINE/.claude/PRODUCTION_PREFLIGHT.md"

# ── Project brief (LAUNCH_SPEC §3) ────────────────────────────────────────────
# When the app has selected a project it sets VIDEOCLAW_TENANT; emit that
# project's compact brief so the agent starts already-briefed. No tenant (JC's
# dev default) → no brief, no output → today's behavior is preserved.
BRIEF_PRESENT="n"
if [ -n "$TENANT" ]; then
  BRIEF_TEXT="$("$PY" "$ENGINE/tools/project_brief.py" --tenant "$TENANT" --workspace "$ROOT" 2>/dev/null || true)"
  if [ -n "$BRIEF_TEXT" ]; then
    echo ""
    printf '%s\n' "$BRIEF_TEXT"
    BRIEF_PRESENT="y"
  fi
fi

# ── Verbatim COMMITMENTS (session CONTEXT) ────────────────────────────────────
COMMIT_PRESENT="n"

# USER scope's COMMITMENTS (cross-tenant) — same force as a tenant pack's.
if [ -f "$ROOT/taste/GLOBAL.md" ]; then
  ucommit="$(awk '/^## COMMITMENTS/{f=1} f&&/^## /&&!/^## COMMITMENTS/{exit} f{print}' "$ROOT/taste/GLOBAL.md")"
  if [ -n "$ucommit" ]; then
    echo ""
    echo "▼ USER COMMITMENTS — cross-tenant, from taste/GLOBAL.md (honor unless revoked; tenant packs may override per-field):"
    echo "$ucommit"
    COMMIT_PRESENT="y"
  fi
  uanti="$(awk '/^## ANTI-COMMITMENTS/{f=1} f&&/^## /&&!/^## ANTI-COMMITMENTS/{exit} f{print}' "$ROOT/taste/GLOBAL.md")"
  if [ -n "$uanti" ]; then
    echo ""
    echo "▼ USER STANDING NOs — cross-tenant (declined before; NEVER offer or re-raise these):"
    echo "$uanti"
  fi
fi

# Surface available tenant taste packs and INJECT each pack's COMMITMENTS
# verbatim — cross-session promises a new agent MUST honor.
if compgen -G "$ROOT/taste/packs/*/README.md" > /dev/null 2>&1; then
  echo "Tenant taste packs available:"
  for f in "$ROOT"/taste/packs/*/README.md; do
    tenant="$(basename "$(dirname "$f")")"
    echo "  - taste/packs/$tenant/README.md"
  done
  for f in "$ROOT"/taste/packs/*/README.md; do
    tenant="$(basename "$(dirname "$f")")"
    commit="$(awk '/^## COMMITMENTS/{f=1} f&&/^## /&&!/^## COMMITMENTS/{exit} f{print}' "$f")"
    if [ -n "$commit" ]; then
      echo ""
      echo "▼ LOCKED COMMITMENTS — tenant '$tenant' (agreed in a prior session; honor unless the user revokes):"
      echo "$commit"
      COMMIT_PRESENT="y"
    fi
    # Standing NOs get the same verbatim force as commitments — a declined
    # nudge/proposal is never re-raised (laws §4/§7), and a fresh agent can
    # only honor that if it SEES the list.
    anti="$(awk '/^## ANTI-COMMITMENTS/{f=1} f&&/^## /&&!/^## ANTI-COMMITMENTS/{exit} f{print}' "$f")"
    if [ -n "$anti" ]; then
      echo ""
      echo "▼ STANDING NOs — tenant '$tenant' (declined before; NEVER offer or re-raise these):"
      echo "$anti"
    fi
  done
fi

# ── Observability marker (LAUNCH_SPEC §1 — silent hook failure is impossible) ──
# Record what this SessionStart injected, where the app can read it. Fail-quiet.
"$PY" "$ENGINE/tools/session_marker.py" \
  --session "$SESSION_ID" \
  --workspace "$ROOT" \
  --source "$HOOK_SOURCE" \
  --laws-version "$LAWS_VERSION" \
  --laws-injected "$LAWS_INJECTED" \
  --tenant "$TENANT" \
  --brief "$BRIEF_PRESENT" \
  --commitments "$COMMIT_PRESENT" >/dev/null 2>&1 || true
