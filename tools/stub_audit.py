#!/usr/bin/env python3
"""PORT-NEW docs/25 M8 — categorised inventory of the IPC channels that were `stub` at the start of M8
(116 = the 93 still stub + the 23 made real in M8). Every channel carries the original handler line in
app/reconstructed/main/index.js (ipcMain registration) and, where it decides the category, the host /
module line. Categories:
  a  = local, no credential: implementable on Linux now (done-M8 = docs/25, done-M9 = docs/26)
  b  = needs Claude Code / Codex / Videoclaw gateway (account, credits, telemetry upload, paid generation)
  c  = macOS/Windows-only or N/A on Linux (original disables / uses a mac-only helper on linux)
Usage: python3 tools/stub_audit.py [--md] [--json]   (fails if a current stub is unclassified)"""
import json, subprocess, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
A, B, C = "a", "b", "c"
# channel: (category, original handler line, evidence / reason)
AUDIT = {
 # ---- a, implemented in M8 (port/src/main/local-channels.ts, agent-host.ts, session.ts, quickstart-ipc.ts)
 "session:rename": (A, 61731, "done-M8: host.renameSession L38915, registry flush"),
 "session:reorder": (A, 61698, "done-M8: host.reorderSessions L38482 (sidebarOrder)"),
 "session:setPermissionMode": (A, 61781, "done-M8 (real-partial): host.setPermissionMode L43987; spend/codex branches not ported"),
 "client:rename": (A, 61819, "done-M8: SessionRegistry renameClient L36367"),
 "client:remove": (A, 61820, "done-M8: removeClient L36384 + tombstones"),
 "client:reorder": (A, 61826, "done-M8: reorderClients L36332"),
 "file:openExternal": (A, 61979, "done-M8: shell.openExternal http(s) only"),
 "media:requestMic": (A, 61904, "done-M8: non-darwin returns true (darwin systemPreferences branch = c, N/A)"),
 "analytics:playbackCompleted": (A, 62003, "done-M8: local validation; beacon upload is gateway (outbox absent)"),
 "taste:list": (A, 61843, "done-M8: verbatim taste module L15178"),
 "taste:commit": (A, 61849, "done-M8: verbatim commitTaste"),
 "taste:decline": (A, 61850, "done-M8: verbatim declineProposal"),
 "stats:stageEtas": (A, 62297, "done-M8: verbatim computeStageEtas"),
 "bootstrap:revealSetupLog": (A, 61303, "done-M8: userData/setup.log (appendSetupLog L9850)"),
 "characters:create": (A, 61882, "done-M8: CharacterStore.create + exposeCharacter"),
 "characters:approve": (A, 61893, "done-M8: CharacterStore.approve"),
 "characters:discard": (A, 61900, "done-M8: CharacterStore.discard"),
 "characters:delete": (A, 61903, "done-M8: CharacterStore.delete"),
 "permission:shown": (A, 61803, "done-M8: send; local log only"),
 "quit:rendererState": (A, 61804, "done-M8: send; verbatim normalisation into quit coordinator state"),
 "quickstart:mark": (A, 61250, "done-M8: verbatim validation + latency ring"),
 "quickstart:impression": (A, 61254, "done-M8: validation; outbox?.enqueue no-op (gateway)"),
 "quickstart:previewed": (A, 61274, "done-M8: validation; outbox?.enqueue no-op (gateway)"),
 # ---- a, local but NOT yet implemented (next rounds)
 "quickstart:start": (A, 61294, "done-M9: quickstartCoordinator.start: copies starter media into a new video, first turn on the active route (MiniMax ok)"),
 "session:deletionPlan": (A, 61732, "done-M9: host.planProjectDeletion L39205 (ownedProjectData, deletionBlock)"),
 "session:delete": (A, 61739, "done-M9: host.deleteProject L39248 → moveProjectToTrash (local trash); session-index retire is gateway, optional"),
 "session:retry": (A, 61776, "done-M9 (real-partial): host.retryTurn L42565 (failedInputs replay; Claude terms-recovery branch is b)"),
 "session:startContinuation": (A, 61766, "done-M9: host.startContinuationChat (local continuation chat over a finalized video)"),
 "project:seedPack": (A, 61827, "done-M9: host.seedProjectPack L36444 → writeProjectPack (local files)"),
 "characters:voices:list": (B, 61873, "moved a→b (docs/26, real-partial): voiceResult → characterVoiceContext → memoryBinding L36456 needs a verified Videoclaw account; the port answers with the original's ProjectMemoryError branch"),
 "characters:voice:approve": (B, 61876, "moved a→b (docs/26, real-partial): voiceResult → characterVoiceContext → memoryBinding L36456 needs a verified Videoclaw account; the port answers with the original's ProjectMemoryError branch"),
 "characters:voice:remove": (B, 61879, "moved a→b (docs/26, real-partial): voiceResult → characterVoiceContext → memoryBinding L36456 needs a verified Videoclaw account; the port answers with the original's ProjectMemoryError branch"),
 "characters:sheetPlan": (B, 61885, "moved a→b (docs/26): plan() = engine dry-run THEN quoteGatewayBudget (L19290) — without agentGatewayProxy the original returns status:error \"couldn't confirm the price\"; mint_image feature-flag decision also gateway-fed"),
 "characters:sheetStates": (A, 61892, "done-M9: host.characterSheetStates (local state files)"),
 "characters:retry": (A, 61896, "done-M9: store retry + assertGenerationAllowed; the rebuild it queues is paid (b)"),
 "job:originalContext": (A, 61754, "done-M9: host.getOriginalContext (local job files)"),
 "job:adopt": (A, 61759, "done-M9: host.adoptJob (local registry/job fence)"),
 "spend:get": (A, 61755, "done-M9: host.getSpendSnapshot L45686 → spendBudgets.snapshot (local ledger; only paid work moves it)"),
 "spend:setCeiling": (A, 61756, "done-M9: host.setSpendCeiling (local spend-budget store)"),
 "input:respond": (A, 61830, "done-M9 (real-partial): host.respondInput L44689 (pendingInputs from studio MCP request tools, not ported yet)"),
 "media:discardVoice": (A, 61914, "done-M9 (real-partial): drops a pending dictation; trivial, pairs with transcribeVoice (b/c)"),
 "library:stats": (A, 62065, "done-M9: engine library CLI, local index"),
 "library:scan": (A, 62068, "done-M9: engine library CLI, local scan"),
 "library:addSource": (A, 62071, "done-M9: local source list + scan"),
 "library:removeSource": (A, 62085, "done-M9: local source list"),
 "library:preview": (A, 62122, "done-M9: local ffmpeg thumbnail"),
 "library:setTenant": (A, 62154, "done-M9: local tenant binding"),
 "bootstrap:revertEngine": (A, 61302, "done-M9: bootstrap.revertEngine (previous engine-current.json)"),
 "attachment:pasteImage": (A, 62272, "done-M9: clipboard nativeImage → intake file"),
 "attachment:voiceNote": (A, 62265, "done-M9 (real-partial): voiceNoteIntakeFile L10535 (ffmpeg, local)"),
 "attachment:captureMoment": (A, 62220, "done-M9: ffmpeg frame grab of a version"),
 "attachment:momentPreview": (A, 62249, "done-M9: ffmpeg preview"),
 "attachment:preview": (A, 62256, "done-M9: local thumbnail"),
 "materials:preview": (A, 62197, "done-M9: local materials ledger preview"),
 "feedback:capture": (A, 62341, "done-M9 (real-partial): local evidence capture (screenshot + logs); submit is b"),
 "hfPreview:start": (A, 62440, "done-M9: local HyperFrames preview worker"),
 "hfPreview:stop": (A, 62441, "done-M9: local HyperFrames preview worker"),
 "hfPreview:editApply": (A, 62444, "done-M9: local composition edit"),
 "account:localResetPrepare": (A, 61496, "done-M9: local data reset plan (no network)"),
 "account:localResetCommit": (A, 61497, "done-M9: local data reset commit (relaunch)"),
 # ---- b, needs Claude / Codex / gateway credentials
 "sessionPlan:read": (B, 61920, "host.readSessionPlan L37031 → memoryBinding L36456 requires verified account+gateway authority"),
 "sessionPlan:choose": (B, 61928, "memoryBinding (account authority) + plan budget"),
 "sessionPlan:retry": (B, 61944, "memoryBinding (account authority)"),
 "memory:read": (B, 61955, "readProjectMemory L36472 → memoryBinding: 'unavailable until this account and project are verified'"),
 "memory:update": (B, 61960, "memoryBinding (account authority)"),
 "memory:undo": (B, 61965, "memoryBinding (account authority)"),
 "memory:openSource": (B, 61970, "memoryBinding (account authority)"),
 "taste:titles": (B, 61854, "resolveHelperCreds → Claude/gateway helper LLM"),
 "characters:sheetBuild": (B, 61888, "assertGenerationAllowed + paid image generation via gateway"),
 "outbox:authoritySnapshot": (B, 61709, "telemetry outbox authority (gateway account)"),
 "telemetry:bindReplay": (B, 61710, "telemetry replay upload (gateway)"),
 "settings:saveGatewayKey": (B, 61393, "gateway API key"),
 "settings:switchGateway": (B, 61377, "gateway selection (dev/staging gateways)"),
 "gateway:verify": (B, 61376, "gateway reachability/auth"),
 "gateway:meter": (B, 61593, "gateway credit meter"),
 "gateway:topup": (B, 61596, "gateway billing"),
 "account:refresh": (B, 61407, "Videoclaw account (gateway)"),
 "account:signInGoogle": (B, 61408, "Videoclaw account OAuth"),
 "account:signInEmail": (B, 61431, "Videoclaw account email sign-in"),
 "account:resendEmail": (B, 61420, "Videoclaw account email sign-in"),
 "account:cancelSignIn": (B, 61428, "Videoclaw account sign-in flow"),
 "account:signOut": (B, 61445, "Videoclaw account"),
 "account:consent": (B, 61498, "account consent record (gateway)"),
 "account:ensureAccess": (B, 61508, "account access check (gateway)"),
 "account:mintKey": (B, 61557, "gateway key minting"),
 "account:claimKey": (B, 61574, "gateway key claim"),
 "engine:claudeCodeStatus": (B, 61603, "Claude Code login state"),
 "engine:claudeCodeConnect": (B, 61604, "Claude Code login"),
 "engine:claudeCodeConnectCancel": (B, 61605, "Claude Code login"),
 "engine:claudeCodeSignOutImpact": (B, 61606, "Claude Code login"),
 "engine:claudeCodeSignOut": (B, 61607, "Claude Code login"),
 "engine:codexStatus": (B, 61609, "done-M10 (docs/27): host.codexStatus L51256 on the MiniMax-backed codex app-server (account/read → external)"),
 "engine:codexConnectChatGpt": (B, 61610, "done-M10 (docs/27, real-partial PORT substitute): no OpenAI login; returns the MiniMax-backed status"),
 "engine:codexConnectCancel": (B, 61619, "done-M10 (docs/27, real-partial PORT substitute): no login flow to cancel"),
 "engine:codexDisconnectImpact": (B, 61620, "done-M10 (docs/27): codexDisconnectImpact L52416 (running Codex videos)"),
 "engine:codexDisconnectChatGpt": (B, 61621, "done-M10 (docs/27, real-partial PORT substitute): retires runtimes; credential is MINIMAX_API_KEY"),
 "engine:codexModels": (B, 61622, "done-M10 (docs/27): codexModels L51305 / discoverCodexModels L52291 ← MiniMax GET /v1/models through the gate"),
 "engine:claudeModels": (B, 61659, "Claude Code model catalog (Claude account)"),
 "engine:continueOnCodex": (B, 61661, "route handoff to Codex"),
 "engine:creditHandoffOffer": (B, 61655, "Videoclaw credits route"),
 "engine:continueOnCredits": (B, 61656, "Videoclaw credits route"),
 "engine:agentProviderKeyStatus": (B, 61664, "done-M10 (docs/27): key presence only (openaiApi/openrouter not configured; MiniMax key is env)"),
 "engine:saveAgentProviderKey": (B, 61665, "agent-provider key for Codex harness"),
 "session:setModel": (B, 61784, "done-M10 (docs/27): host.setSessionModel L40895, Codex branch (catalog = MiniMax models); Claude branch still needs claudeModels"),
 "session:setReasoningEffort": (B, 61787, "done-M10 (docs/27): host.setSessionReasoningEffort L51735, Codex branch (low/medium/high)"),
 "library:sync": (B, 62092, "guardedAppLibrary → acquireLibraryGatewayLease"),
 "library:search": (B, 62115, "guardedAppLibrary → gateway lease"),
 "feedback:submit": (B, 62346, "feedback upload (gateway outbox)"),
 "feedback:grantUsageSharing": (B, 62350, "usage-sharing grant (gateway account)"),
 "workflowSubmit:start": (B, 62399, "workflow submission to gateway"),
 "app:update:check": (B, 61372, "startUpdateCheck L62583: release feed via gateway (nightly needs account)"),
 "app:update:preferences": (B, 61330, "createUpdatePreferences L62572: needs account (nightly entitlement)"),
 "app:update:channel": (B, 61334, "update channel switch; canSwitch needs enabled updater (darwin) + account"),
 "media:transcribeVoice": (B, 61911, "host.transcribeVoice: 'sign in before transcribing' + voice-dictation helper (mac-only, L10465) → b and c"),
 # ---- c, macOS/Windows-only or N/A on Linux
 "app:update:download": (C, 61362, "createAppUpdater L2223: enabled only when platform === 'darwin' (Linux state = disabled)"),
 "app:update:install": (C, 61367, "createAppUpdater L2223: Squirrel/mac installer only"),
}

def stubs_now():
    out = subprocess.run([sys.executable, os.path.join(HERE, "ipc_coverage.py"), "--json"], capture_output=True, text=True, check=True).stdout
    return [r["channel"] for r in json.loads(out) if r["category"] == "stub"]

def main():
    now = set(stubs_now())
    missing = sorted(now - set(AUDIT))
    stale = sorted(c for c, (cat, _, why) in AUDIT.items() if c in now and why.startswith(("done-M8", "done-M9", "done-M10")))
    done_not_real = stale
    counts = {"a": 0, "a_done": 0, "a_todo": 0, "b": 0, "b_done": 0, "b_stub": 0, "c": 0}
    for c, (cat, _, why) in AUDIT.items():
        counts[cat] += 1
        if cat == A: counts["a_done" if why.startswith(("done-M8", "done-M9", "done-M10")) else "a_todo"] += 1
        if cat == B: counts["b_done" if why.startswith("done-M10") else ("b_stub" if c in now else "b_partial_other")] = counts.get("b_done" if why.startswith("done-M10") else ("b_stub" if c in now else "b_partial_other"), 0) + 1
    if "--json" in sys.argv:
        print(json.dumps({"total": len(AUDIT), "counts": counts, "stubNow": len(now), "unclassified": missing, "doneButStillStub": done_not_real,
                          "channels": [{"channel": c, "category": v[0], "line": v[1], "evidence": v[2]} for c, v in AUDIT.items()]}, ensure_ascii=False, indent=1))
    elif "--md" in sys.argv:
        print("| # | channel | 类 | 原始 handler 行 | 依据 |\n|---|---|---|---|---|")
        for i, (c, (cat, ln, why)) in enumerate(AUDIT.items(), 1):
            print(f"| {i} | `{c}` | {cat}{' ✅' if why.startswith(('done-M8', 'done-M9')) else ''} | L{ln} | {why} |")
    else:
        print(f"audited {len(AUDIT)} (stub now {len(now)}): {counts}")
    if missing or done_not_real:
        print(f"UNCLASSIFIED {missing}  DONE-BUT-STILL-STUB {done_not_real}", file=sys.stderr); sys.exit(1)

main()
