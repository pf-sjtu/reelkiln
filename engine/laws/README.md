# Delivery contract for the app (chunk 03)

Chunk 16 owns the injected CONTENT and the observability markers; the app
(videoclaw-app chunk 03) owns DELIVERY and the silent-failure alarm. This file
is the stable interface between them. Paths are relative to the engine root
(`$VIDEOCLAW_ENGINE`) and the workspace (`$VIDEOCLAW_WORKSPACE`).

## 1. Behavioral laws — deliver via system-prompt APPEND

- **File:** `$VIDEOCLAW_ENGINE/laws/producer_laws.md` (shipped in the engine
  tarball; `scripts/build_engine.sh` includes `laws/`).
- **How:** read the file and pass its contents to the SDK's system-prompt
  append (alongside the existing `VOICE_GUARD`), so the laws survive long
  sessions instead of falling out of context.
- **Signal back to the engine:** when the app performs this append, set env
  `VIDEOCLAW_LAWS_VIA_APPEND=1` on the session. The SessionStart preflight then
  SKIPS its own copy of the laws (no duplication). If the app does NOT append
  (or hasn't shipped chunk 03 yet), leave it unset — the preflight injects the
  laws as a fallback, so behavior never regresses.
- **Version:** the first line is `<!-- laws-version: X.Y.Z -->`. The preflight
  parses it and stamps it into the marker (see §3), so the app/telemetry can
  prove which laws shipped for a given session.

## 2. Project brief — set the tenant env var

- Opening/creating a Video under a Project must set `VIDEOCLAW_TENANT=<slug>`
  in the session env (the same slug used for `--tenant` on media-library
  calls). The SessionStart preflight then emits that project's compact brief
  (recent finished videos, locked look, b-roll looks, library size) and injects
  the project's COMMITMENTS verbatim.
- No `VIDEOCLAW_TENANT` → no brief (JC's dev default; today's behavior).
- Brief content/authoring is owned here in chunk 16 (`tools/project_brief.py`).

## 3. Observability marker — check after session start

- **Path (stable):**
  `$VIDEOCLAW_WORKSPACE/.videoclaw/session-markers/<session_id>.json`
  (`session_id` is the SDK session id; unsafe chars are replaced, capped 120).
- Written by the SessionStart preflight (`tools/session_marker.py`). The app
  reads it right after session start; **absent ⇒ the hook never fired** →
  surface it (dev: warning banner; product: telemetry alert).
- **Schema (v1):**

  ```json
  {
    "schema": 1,
    "session_id": "…",
    "engine": "/abs/path/to/engine",
    "workspace": "/abs/path/to/workspace",
    "preflight": {
      "fired": true,
      "ts": "2026-07-14T20:25:55Z",
      "source": "startup|resume|clear|compact",
      "laws_version": "1.2.0",
      "laws_injected": true,          // laws came via the hook fallback (app append off)
      "tenant": "acme_reels",
      "brief_present": true,
      "commitments_present": true
    },
    "stop": {                          // added when the Stop hook (qa_gate) fires
      "fired": true,
      "ts": "…",
      "blocked": false,                // always false: the hook never holds a turn
      "blocked_jobs": []               // always empty; kept for schema stability
    }
  }
  ```

  `preflight` present with `fired:true` is the proof the injection ran. `stop`
  appears once the agent finishes a turn. The Stop hook always lets the turn
  end, whether or not a render has been reviewed, so `blocked` is always
  `false`; older engines could write `true` there.

## 4. Server assembly — the third delivery mode (hosted sessions)

Modes §1–§3 assume the loop runs on the device with this SessionStart hook.
Hosted sessions run the loop in a separate service (`videoclaw-runner`) that
assembles the system prompt itself, so the hook must stand down.

- **Who sets it:** ONLY the runner sets `VIDEOCLAW_SERVER_ASSEMBLY=1` on the
  engine session it hosts. The app client, and bare `claude` in the repo (JC's
  dev flow), NEVER set it — those paths keep using modes §1–§3 unchanged.
- **What the hook does:** with the var set, `preflight.sh` exits 0 immediately
  with NO output. Any injection here would DUPLICATE context the runner already
  put in the system prompt.
- **What the runner injects instead:** the same content, assembled server-side at
  session-create from the client's context bundle — `VOICE_GUARD` + the laws
  append (`producer_laws.md`, exactly as §1) + the project brief + the tenant/user
  COMMITMENTS verbatim. The laws still travel as a system-prompt append, so
  behavior does not regress.
- **The marker does not exist in this mode.** No `session_marker` is written (§3's
  path is absent for these sessions). The marker exists to catch a SILENT hook
  failure; server injection is synchronous in session-create and cannot silently
  fail, so the marker has no meaning here. The runner's own observability ledger
  is the equivalent trace.
- **Spec:** the full design lives in the hosted-loop spec in the videoclaw-app
  repo (docs/specs/, decision D7).

## 5. Production route gate — workspace hook wiring

The app bootstrap must copy the engine's `.claude/settings.json` into the
workspace **verbatim**. Its bytes are an attested part of the current context,
and all three hook commands resolve through
`${VIDEOCLAW_ENGINE:-$CLAUDE_PROJECT_DIR}` so the same file works in split
installs and source development:

- **SessionStart:** `.claude/hooks/preflight.sh`
- **PreToolUse / matcher:** `.claude/hooks/production_guard.py` /
  `Bash|mcp__device__bash`
- **Stop:** `tools/qa_gate.py --hook` (always allows the stop; it only writes
  the §3 marker trace)
- **Behavior:** exit `2` before canonical generation, transformation, render,
  assembly, direct job-output ffmpeg/Remotion, or mutating provider execution
  unless that command's job has a current `route-receipt.json`.

The receipt is created only by `$VIDEOCLAW_ENGINE/tools/prepare_production.py`,
which emits the current router plus its selected 2–3 workflow documents. The
v8 routed receipt binds route and engine/context identity. It never carries a
creative plan, promise, Taste decision, ceiling,
quote, reservation, projected spend, financial approval, or authorization hash;
spending authority belongs exclusively to the current host and gateway. Each
bootstrap receipt has a monotonic `receipt_version`; before replacing
the current snapshot, the tool durably appends the full receipt to
`route-receipt-history.jsonl`, preserving the original creation time and every
prior route proof.
Rewriting, reformatting, or regenerating workspace settings changes its hash;
the app must hash the actual copied workspace file when it exports
`VIDEOCLAW_EFFECTIVE_SETTINGS_SHA256`.

The hook and hosted runner share `.claude/PRODUCTION_PREFLIGHT.md` as their
single canonical preflight text. Installed sessions must also set the verified
build, effective law/preflight/settings hashes, and rotating context epoch
documented in `skills/primitives/prepare_production.md`; an old receipt cannot
survive a resume/compaction into a newly assembled model context. The host must
rotate that epoch before the first post-compaction authorization decision (the
shared app guard seam is tracked in app issue #155). The stale receipt blocks
protected work until one bootstrap call has re-emitted the selected documents
into the new context. No plan reapproval or second lock phase exists.

## 6. Behavioral acceptance

Run `evals/preflight_eval.py` (see its header). Tier A is credential-free and
mechanical; Tier B needs an Anthropic-protocol credential and drives a real
headless session. Chunk 03's own acceptance (missing-marker alarm, project
switch) sits on top of this contract.

## 7. Conductor knowledge — shipped, read by the app observer (chunk 20)

Two more shipped files, versioned like the laws, that the app's conductor
(`apps/desktop/src/main/conductor.ts`) reads from `$VIDEOCLAW_ENGINE/laws/`.
Both are copied by `scripts/build_engine.sh`'s `laws/` allowlist entry (nothing
new to wire in the build). The sauce stays server-controllable — bumping either
file reships without an app release.

- **`conductor_signatures.json`** — the free regex fast-path: the signature
  families (capability-denial, meta-narration) as `{id, pattern, flags,
  contextGuard, hint, maxFiresPerSession}`. The app runs each `pattern` over an assistant turn's
  user-facing prose; a match whose `contextGuard` holds injects `hint` as an
  invisible preamble so the agent self-corrects. Absent (older engine) ⇒
  fast-path off; the conductor degrades to judge-only, then to no-op.
  contextGuards the app understands: `""`/`"none"`, `"url-in-last-user-msg"`,
  `"imperative-ask-in-last-user-msg"` (unknown ⇒ fail closed). Hints are
  agent-facing (never rendered) so they may name real tools.
- **`capability_digest.md`** — the ≤60-line capability brief: what the toolchain can
  actually do, by producer purpose, plus the §8 pull-first + recast framings.
  The producer reads it in every session as its available capabilities, and the
  app's Haiku-class judge (the rare path the fast-path doesn't cover) reads it
  under the judge framing its own system prompt supplies, so the digest is
  addressed to neither. Absent ⇒ judge off.

Acceptance: `evals/conductor_eval.py` (mechanical, no creds) validates both
files against the shared fixtures (`evals/fixtures/conductor/turns.jsonl`) —
schema, jargon-ban cleanliness, the fast-path + pre-filter contracts the app
mirrors, and that both files ship. The app half is gated by
`npm run check:conductor` in videoclaw-app.
