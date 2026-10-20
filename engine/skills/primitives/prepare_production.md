# prepare_production — route context + bootstrap receipt

## Purpose

Load the canonical router and exact 2–3 selected workflow documents into the
agent's current context, then write a content-bound bootstrap receipt. This is a
route/context integrity check, not a plan or creative-approval contract. Agents
may plan however the task benefits; production never requires a plan document,
human confirmation, or second lock phase.

## Use when

- Reference ingestion/analysis has made the request shape clear and you want the
  routed workflow documents in context before the first production action.
- Again whenever you want the current documents back in context.

Production never waits on this call. When a protected production command
reaches the guard before its job has a current route, the guard records one
itself — the job's previous selection when every document is still routable,
else `aroll-reel` + `broll-voiceover` — and the command proceeds. A route that
went stale (router, selected document, or engine files changed) is re-recorded
the same way. Context compaction and context-epoch rotation never invalidate a
route.

## Do not use when

- You still need to pull, inspect, break down, or understand the reference
  before selecting a route.
- You want to select one file as a shortcut or four files "to be safe." The
  bounded reading set is exactly 2–3 documents.
- A document is not linked from `workflows/README.md` or a nested workflow index
  reachable from it.

## Inputs

```bash
uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/prepare_production.py" \
  --job <bare-id> --workflow workflows/<primary>.md --workflow workflows/<support>.md
```

This uses the one engine launcher (CLAUDE.md); keep the id safe and bare. It
creates `jobs/<id>` as part of the receipt write. Do not inspect or invoke
`tools/job.py` or pre-create the job with `mkdir` or Write. Read the emitted
guidance and continue production. Explain or revise
the approach in ordinary conversation when useful; the engine does not require
a particular rundown shape or an approval response.

- `--job` — one top-level id under the configured jobs directory.
- `--workflow` — repeat exactly 2–3 times. Absolute paths are accepted only
  when they resolve inside this engine's `workflows/` directory.

There is deliberately no `--lock-plan` option. An optional `promise.json` may
record delivery targets, but it is not read by the production
guard, does not appear in the route receipt, and may change without re-arming
production authorization.

## Success check

1. Stdout contains `workflows/README.md` and every selected document in full,
   each labeled with its relative path and SHA-256.
2. The call reports `bootstrap CURRENT`.
3. `jobs/<id>/route-receipt.json` uses schema
   `videoclaw.route-receipt/v8`, phase `routed`, and a monotonically increasing
   `receipt_version`; it contains no plan or approval fields.
4. A subsequent protected production command for the same `--job` passes the
   route-integrity portion of the `PreToolUse` gate. Paid operations remain
   independently authorized by the host/gateway.

The current snapshot is written with `fsync` + atomic replace, while every
bootstrap version is first durably appended to
`jobs/<id>/route-receipt-history.jsonl`. Historical v5/v6/v7 entries remain
readable during migration; the latest/current receipt must be v8. A version the
guard recorded by itself carries `"auto_route": {"trigger": <action>, "reason":
"missing" | "not_current"}` on its journal entry; the receipt shape is the same.

## Fallback

If selection fails, return to `workflows/README.md` and choose only linked
documents. A missing or stale route is re-recorded automatically for the job
the session owns; never edit the receipt or its history by hand. If the guard
reports that a route "could not be recorded automatically" (for example a
corrupt history journal), stop and report it — rerunning this command meets the
same journal. No creative reapproval or plan re-lock is required, including
after a context compaction.

## Enforcement boundary

The hook mechanically covers every canonical production script plus direct
job-output `ffmpeg`, `npx remotion render`, and mutating provider SDK/API
launches. Harmless inspection such as `ffprobe`, `ffmpeg ... -f null -`, frame
extraction outside `jobs/`, and provider HTTP GET/HEAD remains available. Both
local `Bash` and hosted `mcp__device__bash` use the same classifier.

## Host/runner binding

Native CLI installed sessions bind their receipts to the installed enforcement
bytes and need none of the runner attestation variables below. Such a host owns
every job under its jobs directory, so the guard routes any of them
automatically. A strict hosted runner exports:

- `VIDEOCLAW_ENGINE_BUILD_SHA256` — SHA-256 from the verified engine artifact
  manifest; the mutable `ENGINE_VERSION.json` stamp is metadata only.
- `VIDEOCLAW_CONTEXT_EPOCH` — opaque nonce rotated for every new, resumed, or
  compacted/reassembled model context.
- `VIDEOCLAW_EFFECTIVE_LAWS_SHA256` — hash of the exact
  `laws/producer_laws.md` bytes appended to the prompt.
- `VIDEOCLAW_EFFECTIVE_PREFLIGHT_SHA256` — hash of the exact
  `.claude/PRODUCTION_PREFLIGHT.md` bytes injected into the model context.
- `VIDEOCLAW_EFFECTIVE_SETTINGS_SHA256` — hash of the exact
  workspace `.claude/settings.json` hook contract installed for the session.
- `VIDEOCLAW_BOUND_JOB` — the one job this session owns. Only that job is routed
  automatically. A host that exports a context epoch but no bound job keeps the
  "no route-receipt.json" refusal, and a call for any other job is refused as
  "not this session's job" without creating anything in that job.

The preflight markdown file is the single source for both local SessionStart and
hosted prompt assembly. Do not duplicate it as an app string. Likewise, copy
the engine `.claude/settings.json` bytes verbatim into the workspace: its
SessionStart, PreToolUse, and Stop commands all resolve through
`${VIDEOCLAW_ENGINE:-$CLAUDE_PROJECT_DIR}`. Hash the copied file itself, not a
generated equivalent. The context epoch is recorded for provenance only:
rotating it (a new, resumed, or compacted model context) never makes a route
stale, so production continues after compaction without re-running this call.
