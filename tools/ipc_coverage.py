#!/usr/bin/env python3
"""PORT-NEW (docs/20): classify every original IPC channel by how the port serves it today.

Reads artifacts/manifests/ipc-channels.json (machine-extracted from the original bundle) and
greps the port sources for handler/push registrations. Categories:
  real      - served by a ported/PORT-NEW real implementation (real-backend / llm-runtime / agent-ipc / media-ipc)
  real-partial - real handler with the original's return shape, but only some original branches ported
                 (listed in PARTIAL below with the reason; docs/24)
  real-env  - real only when a PORT-NEW env var is set (bootstrap:run), fake fixture otherwise
  fixture   - fake-backend.ts returns a canned value copied from the original QA fixtures
  stub      - registered but returns undefined / only logs (NOT IMPLEMENTED)
  push-real - main->renderer push the port actually emits
  push-none - main->renderer push the port never emits
  local     - preload-local method (no IPC)
Usage: python3 tools/ipc_coverage.py [--json]
"""
import json, re, sys, collections
from pathlib import Path
R = Path(__file__).resolve().parent.parent
chans = json.loads((R / "artifacts/manifests/ipc-channels.json").read_text())
src = lambda p: (R / "port/src/main" / p).read_text()
key_re = re.compile(r'"([a-zA-Z]+:[a-zA-Z:]+)"\s*:')
assign_re = re.compile(r'(?:handlers|sendHandlers)\["([a-zA-Z]+:[a-zA-Z:]+)"\]\s*=')
real = set(key_re.findall(src("real-backend.ts"))) | set(key_re.findall(src("llm-runtime.ts"))) | set(key_re.findall(src("agent/agent-ipc.ts"))) | set(key_re.findall(src("media/media-ipc.ts"))) | set(assign_re.findall(src("real-backend.ts"))) | set(key_re.findall(src("local-channels.ts"))) | set(key_re.findall(src("quickstart/quickstart-ipc.ts"))) | set(key_re.findall(src("local-channels-26.ts"))) | set(key_re.findall(src("codex/codex-channels.ts"))) | set(key_re.findall(src("account/account-service.ts"))) | set(key_re.findall(src("gateway/gateway-channels.ts"))) | set(key_re.findall(src("remaining-channels.ts")))
real_env = {"bootstrap:run"}
# docs/24 → docs/25: session:history now replays the display transcript + SDK transcript (real).
# docs/25 real-partial: original handler shape, some original branches not ported (reason given).
PARTIAL = {
    "session:setPermissionMode": "docs/32: the spend-policy branch is ported (Bypass ⇒ unlimited_for_video, leaving Bypass ⇒ ask_each via spendPolicyForMaterialChange, capped-limit removal consent); still partial: codex containment is enforced in the codex runtime (docs/27) instead of the original applyPermissionMode codex branch",
    # docs/26 real-partial: the handler runs the original body, but the branch that does real work needs (b)/(c)
    "characters:voices:list": "(b) memoryBinding needs a verified Videoclaw account → the original's unavailable answer only",
    "characters:voice:approve": "(b) memoryBinding needs a verified Videoclaw account → the original's unavailable answer only",
    "characters:voice:remove": "(b) memoryBinding needs a verified Videoclaw account → the original's unavailable answer only",
    "media:discardVoice": "(c) voiceDictations only fill through transcribeVoice (macOS on-device helper)",
    "attachment:voiceNote": "(c) the background on-device transcript (macOS voice-dictation helper) is not available",
    "feedback:capture": "(b) no gateway key → blockedRoute: no screenshot, consentRequired (the original's key-less branch)",
    # docs/27: the Codex route runs on MiniMax (gate proxy, surface openai) — there is no ChatGPT login to drive
    "engine:codexConnectChatGpt": "PORT substitute (docs/27): no OpenAI device login — returns the MiniMax-backed codexStatus (authenticated, mode external)",
    "engine:codexConnectCancel": "PORT substitute (docs/27): nothing to cancel (no login flow) — original {ok:true} shape",
    "engine:codexDisconnectChatGpt": "PORT substitute (docs/27): retires live Codex runtimes, then ok:false — the MiniMax credential is MINIMAX_API_KEY (env), not an app login",
    "session:retry": "spend gate / Claude-terms recovery / restoreFailedTurn after an app restart not ported",
    # docs/28: managed sign-in (Google PKCE / Identity Platform email link / ID-token account plane) is not ported —
    # the auth pool is "unconfigured" (prod/staging, PORT) or verbatim (local → unconfigured, custom → untrusted);
    # these run the original bodies up to the original's own pool refusal (exactly the original on a self-hosted gateway)
    **{c: "(b) managed videoclaw.com sign-in not ported → the original's unconfigured/untrusted-pool refusal only (docs/28)" for c in (
        "account:signInGoogle", "account:signInEmail", "account:resendEmail", "account:cancelSignIn", "account:consent",
        "account:ensureAccess", "account:mintKey", "account:claimKey")},
    "account:signOut": "original body; no managed session can exist; host.stopAuthenticatedWork not ported (docs/28)",
    "gateway:topup": "self-hosted shim account has no hosted checkout → the original's 503 'Checkout is unavailable' branch; credit is added to the local ledger by the owner (docs/28)",
    "engine:claudeModels": "PORT substitute model source: MiniMax GET /v1/models (no Claude Code CLI) through the ORIGINAL partition + evidence ledger (docs/28)",
    **{c: "USER DIRECTIVE (docs/28): no real Claude subscription — no `claude auth status` probe / login child → the original's not-connected branches only" for c in (
        "engine:claudeCodeStatus", "engine:claudeCodeConnect", "engine:claudeCodeConnectCancel", "engine:claudeCodeSignOutImpact", "engine:claudeCodeSignOut")},
    # docs/29 (M12): the last category-(b) channels — original bodies; the branch that needs a hosted service ends in the
    # original's own refusal / unavailable answer
    # docs/30 (M13): studio MCP ported → sessionPlan:read / retry / input:respond are real (read + input:respond CDP-verified
    # on the original renderer: plan card, rights card; retry is node:test-only)
    "sessionPlan:choose": "Build it / Change it / dismiss are the original body (CDP-verified Build it); Show me a preview dispatches the original preview turn, but preview_session_shot (paid preview) is not ported",
    "outbox:authoritySnapshot": "outbox exists only against the self-hosted loopback gateway (never posts to the production gateway)",
    "telemetry:bindReplay": "durable session-index enqueue only with telemetry on; delivered to the shim's local sinks",
    "feedback:submit": "delivered through the outbox to the self-hosted shim (/v1/feedback + screenshot sink), not to Videoclaw support",
    "feedback:grantUsageSharing": "AlphaConsentCoordinator not ported → reconcileUsageSharing = local-studio consent",
    "library:sync": "real scoped gateway lease; the engine's multimodal embed is refused by the shim (MiniMax embo-01 is text-only 1536-d, docs/30 §2)",
    "library:search": "real scoped gateway lease; the engine's multimodal embed is refused by the shim (MiniMax embo-01 is text-only 1536-d, docs/30 §2)",
    "engine:creditHandoffOffer": "the Claude-allowance precondition needs a real Claude subscription (USER DIRECTIVE: none) — reachable only by UI-e2e injection; spend-authority equality reduced to isBlocked",
    "engine:continueOnCredits": "continuation is real (gateway route → shim → MiniMax, ledger-charged); materializeGatewaySpendPolicy not ported",
    "engine:saveAgentProviderKey": "stored in the vault only — the openai-api/openrouter Codex providers run on MiniMax (docs/27)",
    "workflowSubmit:start": "no Videoclaw account plane → accountApiRequest refuses → the original not-eligible branch",
    "app:update:preferences": "nightly entitlement needs a managed account → nightlyAllowed false",
    "app:update:channel": "createAppUpdater is darwin-only → canSwitchChannel false → the original 'wait for the current update' refusal",
    "characters:sheetPlan": "engine dry-run + gateway quote (shim local price table); needs the installed engine's build_character_sheet tool",
    "characters:sheetBuild": "real build path; the shim refuses mint_image (MiniMax image-01 cannot do multi-reference identity edits) → original failBuild",
    "media:transcribeVoice": "(c) VoiceDictation needs the macOS Speech helper → the original unavailable answer",
}
fixture = set(key_re.findall(src("fake-backend.ts")))
pushes = set()
for f in (R / "port/src/main").rglob("*.ts"):
    pushes |= set(re.findall(r'push\(\s*"([a-zA-Z]+:[a-zA-Z:]+)"', f.read_text()))
rows = []
for c in chans:
    ch, d = c["channel"], c["dir"]
    if d == "M→R": cat = "push-real" if ch in pushes else "push-none"
    elif d == "—": cat = "local"
    elif ch in real_env: cat = "real-env"
    elif ch in real and ch in PARTIAL: cat = "real-partial"
    elif ch in real: cat = "real"
    elif ch in fixture: cat = "fixture"
    else: cat = "stub"
    rows.append({"channel": ch, "dir": d, "category": cat, "bridge": [b[0] for b in c["bridge"]]})
if "--json" in sys.argv:
    print(json.dumps(rows, indent=1)); sys.exit()
tot = collections.Counter(r["category"] for r in rows)
print("TOTAL", len(rows), dict(tot))
g = collections.OrderedDict()
for r in rows: g.setdefault(r["channel"].split(":")[0], []).append(r)
for k, v in g.items():
    cnt = collections.Counter(r["category"] for r in v)
    print(f"{k}\t{len(v)}\t" + ", ".join(f"{a}={b}" for a, b in sorted(cnt.items())) + "\t" +
          " ".join(r["channel"].split(":", 1)[1] for r in v if r["category"] in ("real", "real-partial", "real-env", "fixture", "push-real")))
