#!/usr/bin/env python3
"""
prepare_production — load routed production context.

The tool is deliberately stdlib-only because its validation code is also imported
by the Claude Code PreToolUse hook:

    uv run --project "$VIDEOCLAW_ENGINE" python "$VIDEOCLAW_ENGINE/tools/prepare_production.py" \
      --job "replace-with-safe-bare-id" \
      --workflow workflows/aroll-reel.md \
      --workflow workflows/reference-remix.md

Exactly two or three workflow documents are required. Each must be reachable by
following markdown links from workflows/README.md and must resolve inside the
engine's workflows/ directory. The call emits those documents and stamps a route
receipt that binds the routed documents and current engine identity. Agents may
plan in ordinary conversation or write optional production notes, but neither a
plan nor human creative approval is engine authorization state. Spending permission
remains a separate host/gateway concern. Production never waits on this call: when
a protected command reaches the guard before its job has a current route, the guard
records one itself (the job's previous selection, else DEFAULT_AUTO_ROUTE) for the
job the session owns, and the command proceeds.

Run ``python3 tools/prepare_production.py --selftest`` for the hermetic guard and
receipt tests. No network or provider calls are made.
"""
from __future__ import annotations

import argparse
import _compat_lock as fcntl  # port: fcntl on POSIX, msvcrt on Windows
import fnmatch
import ast
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, NamedTuple
from urllib.parse import unquote, urlsplit

RECEIPT_SCHEMA = "videoclaw.route-receipt/v8"
PREVIOUS_RECEIPT_SCHEMAS = frozenset(
    {
        "videoclaw.route-receipt/v5",
        "videoclaw.route-receipt/v6",
        "videoclaw.route-receipt/v7",
    }
)
SUPPORTED_RECEIPT_SCHEMAS = PREVIOUS_RECEIPT_SCHEMAS | {RECEIPT_SCHEMA}
LEGACY_RECEIPT_SCHEMA = "videoclaw.route-receipt/v5"
RECEIPT_HISTORY_SCHEMA = "videoclaw.route-receipt-history-entry/v1"
_PREJOURNAL_PLAN_KEYS_BY_SCHEMA = {
    # Historical compatibility only. These identifiers describe bytes emitted
    # by v5/v6; the migration bridge never interprets them as current spending
    # authority and current v7 receipts cannot contain them.
    "videoclaw.route-receipt/v5": frozenset({
        "path", "sha256", "decisionSource", "qaRequired", "budgetCents",
        "projectedSpend", "projectedSpendSha256", "appApproval",
        "approvalReceipt",
    }),
    "videoclaw.route-receipt/v6": frozenset({
        "path", "sha256", "decisionSource", "qaRequired", "budgetCents",
        "projectedSpend", "projectedSpendSha256", "appApproval",
        "approvalReceipt", "creativeConfirmation",
    }),
}
_JOURNAL_PLAN_KEYS_BY_SCHEMA = {
    "videoclaw.route-receipt/v6": _PREJOURNAL_PLAN_KEYS_BY_SCHEMA[
        "videoclaw.route-receipt/v6"
    ],
    "videoclaw.route-receipt/v7": frozenset(
        {
            "path",
            "sha256",
            "decisionSource",
            "creativeRundownSha256",
            "qaRequired",
        }
    ),
}
CONTEXT_SCHEMA = "videoclaw.production-context/v1"
PRODUCTION_VERDICT_SCHEMA = "videoclaw.production-verdict/v5"
PRODUCTION_ANALYZER = "prepare_production.shell-ir/v1"
AUTHORIZATION_REQUIRED_SCHEMA = "videoclaw.authorization-required/v1"
ROUTER_REL = "workflows/README.md"
RECEIPT_NAME = "route-receipt.json"
RECEIPT_HISTORY_NAME = "route-receipt-history.jsonl"
RECEIPT_LOCK_NAME = ".route-receipt.lock"
PLAN_NAME = "promise.json"
MIN_WORKFLOWS = 2
MAX_WORKFLOWS = 3
# Production never waits on setup (JC ruling 2026-09-27, videoclaw#274). When a
# protected action reaches the guard before its job has a current route, the
# guard records one itself: the job's previous selection when every document is
# still routable, else this pair. It is the router's first SOURCE row ("just an
# idea/topic") and the pair agents chose most often.
DEFAULT_AUTO_ROUTE = ("workflows/aroll-reel.md", "workflows/broll-voiceover.md")
# The desktop app and hosted runner name the one job the current session owns.
# Only that job may be routed automatically in a hosted session; a host that
# binds no job keeps today's refusal. A standalone CLI host (no context epoch)
# owns every job under its jobs directory.
BOUND_JOB_ENV = "VIDEOCLAW_BOUND_JOB"
MAX_PROVIDER_INLINE_SOURCE_CHARS = 8_192
MAX_PROVIDER_INLINE_BINDINGS = 256
SUPPORTED_BASH_TOOL_NAMES = frozenset({"Bash", "mcp__device__bash"})
PINNED_SESSION_ENV = frozenset(
    {
        "VIDEOCLAW_GATEWAY_URL",
        "VIDEOCLAW_GW_URL",
        "VIDEOCLAW_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
    }
)

# The exact files whose bytes define the production law/preflight/gate contract.
# A receipt is stale when any changes, even when a mutable ENGINE_VERSION stamp
# still claims the same build. The app/runner must hash the canonical law,
# preflight, and settings bytes it actually injects/installs and pass those
# digests through the matching environment variables.
ENFORCEMENT_FILES = {
    "laws": "laws/producer_laws.md",
    "capabilities": "laws/capability_digest.md",
    "preflight": ".claude/PRODUCTION_PREFLIGHT.md",
    "guard": ".claude/hooks/production_guard.py",
    "settings": ".claude/settings.json",
    "receipt_validator": "tools/prepare_production.py",
}
_V6_ENFORCEMENT_FILES = {
    **ENFORCEMENT_FILES,
    "taste_validator": "tools/taste_contract.py",
}
BUILD_DIGEST_ENV = "VIDEOCLAW_ENGINE_BUILD_SHA256"
CONTEXT_EPOCH_ENV = "VIDEOCLAW_CONTEXT_EPOCH"
EFFECTIVE_HASH_ENVS = {
    "laws": "VIDEOCLAW_EFFECTIVE_LAWS_SHA256",
    "preflight": "VIDEOCLAW_EFFECTIVE_PREFLIGHT_SHA256",
    "settings": "VIDEOCLAW_EFFECTIVE_SETTINGS_SHA256",
}
PORTABLE_ENGINE_ROOT = "${VIDEOCLAW_ENGINE:-$CLAUDE_PROJECT_DIR}"
# Python hooks run on the engine's own venv. A bare `python3` on a Mac without
# the developer tools is Apple's install-the-tools stub (videoclaw-app#1038).
# port: Windows venvs keep the interpreter in .venv/Scripts/python.exe (POSIX unchanged).
PORTABLE_ENGINE_PYTHON = (
    f"{PORTABLE_ENGINE_ROOT}/.venv/Scripts/python.exe" if os.name == "nt"
    else f"{PORTABLE_ENGINE_ROOT}/.venv/bin/python"
)
EXPECTED_HOOK_COMMANDS = {
    "SessionStart": (
        f'bash "{PORTABLE_ENGINE_ROOT}/.claude/hooks/preflight.sh"'
    ),
    "PreToolUse": (
        f'"{PORTABLE_ENGINE_PYTHON}" '
        f'"{PORTABLE_ENGINE_ROOT}/.claude/hooks/production_guard.py"'
    ),
    "Stop": (
        f'"{PORTABLE_ENGINE_PYTHON}" "{PORTABLE_ENGINE_ROOT}/tools/qa_gate.py" --hook'
    ),
}
EXPECTED_PRETOOL_MATCHER = "Bash|mcp__device__bash"
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_RECEIPT_CREATED_AT_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$"
)
IMAGE_CLI_MODEL_TO_RESOLVED = {
    "nano-banana-2": "fal-ai/nano-banana-2",
    "gpt-image-2": "fal-ai/gpt-image-2",
}
# mint_video modes the gateway refuses on every request. mint_video, cost.py
# plan and the production verdict all refuse these with the same message.
MINT_VIDEO_UNAVAILABLE_MODES = {
    "multishot": (
        "mint_video --mode multishot is unavailable: the gateway has no route "
        "that accepts reference images for it (videoclaw#317). Nothing was "
        "uploaded, quoted or charged. For a still of a real person, use the "
        "app's search_models + call_model with model_slug "
        "google-gemini-omni-flash-image-to-video (one image_url, 3-10 s, "
        "16:9 or 9:16). For existing footage use --mode edit; to swap the "
        "people in a clip use --mode genjutsu; to make a still perform a driver "
        "video's motion use --mode reenact; for non-photoreal stills use --mode "
        "insert or --mode keyframe."
    ),
}
_RUNDOWN_ACTION_RE = re.compile(
    r"^i(?:['’]ll| will)\s+"
    r"(?:get|record|capture|gather|collect|find|create|generate|animate|turn|"
    r"film|shoot|write|edit|check|assemble|combine|mix|finish|deliver|send|"
    r"add|use|cut|review)\b",
    re.IGNORECASE,
)
RUNDOWN_BANNED_TERMS = (
    "workflow",
    "routing",
    "job",
    "pipeline",
    "model",
    "provider",
    "prompt",
    "tool",
    "file",
    "files",
    "route",
    "manifest",
    "receipt",
    "lock",
    "budget",
    "cost",
    "costing",
    "price",
    "pricing",
    "spend",
    "spending",
    "money",
    "fee",
    "charge",
    "charged",
    "charging",
    "payment",
    "paid",
    "expense",
    "invoice",
    "billing",
    "billable",
    "quote",
    "estimate",
    "qa",
    "qa gate",
    "dollar",
    "anthropic",
    "claude",
    "gemini",
    "gpt-image",
    "kling",
    "openai",
    "replicate",
    "runway",
    "seedance",
    "sora",
    "sync-3",
    "veo",
    "fal",
    "elevenlabs",
)
_RUNDOWN_DOLLAR_RE = re.compile(
    r"\$\s*\d|\b\d+(?:\.\d{1,2})?\s*(?:dollars?|usd)\b",
    re.IGNORECASE,
)
_RUNDOWN_RECORDED_VOICE_RE = re.compile(
    r"\b(?:record|capture)\w*\b[^.?!]{0,80}\b(?:voice|voiceover|narration)\b"
    r"|\b(?:voice|voiceover|narration)\b[^.?!]{0,80}\b(?:record|capture)\w*\b",
    re.IGNORECASE,
)
_RUNDOWN_GENERATION_RE = re.compile(
    r"\b(?:create|generate|animate|turn)\w*\b", re.IGNORECASE
)
_RUNDOWN_HEDGED_REVIEW_RE = re.compile(
    r"\b(?:no|not|never|skip\w*|omit\w*|avoid\w*|without|refus\w*|declin\w*|"
    r"fail\w*|unable|cannot|can['’]?t|won['’]?t|don['’]?t|unless|if|maybe|may|"
    r"might|could|would)\b",
    re.IGNORECASE,
)
_RUNDOWN_SEND_FOR_REVIEW_RE = re.compile(
    r"\b(?:send|share|show|deliver|present)\w*\b[^.?!]{0,80}"
    r"\b(?:for\s+)?(?:your|user)\s+review\b",
    re.IGNORECASE,
)


def rundown_prose_errors(text: str) -> list[str]:
    """Reject backstage and financial language anywhere in assistant prose."""
    leaked = [
        term
        for term in RUNDOWN_BANNED_TERMS
        if re.search(rf"\b{re.escape(term)}s?\b", text, re.IGNORECASE)
    ]
    if leaked or _RUNDOWN_DOLLAR_RE.search(text):
        return ["rundown leaks backstage/spend language"]
    return []


def rundown_step_errors(steps: Any) -> list[str]:
    """Validate the canonical receipt/plan rundown prose contract.

    The trajectory evaluator imports this function so CI and the runtime trust
    boundary cannot silently disagree about action language, jargon, length,
    voice ordering, or the required review finish.
    """
    if not isinstance(steps, list) or not 3 <= len(steps) <= 5:
        return ["rundown needs 3-5 steps"]
    errors: list[str] = []
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, str) or not step or step != step.strip():
            errors.append(f"step {index} must be a normalized non-empty string")
            continue
        if not _RUNDOWN_ACTION_RE.match(step):
            errors.append(f"step {index} does not start with a concrete action")
        if len(step.split()) > 22 or re.search(r"[.!?]\s+\S", step):
            errors.append(f"step {index} is not one short sentence")
        if rundown_prose_errors(step):
            errors.append(f"step {index} leaks backstage/spend language")
    final_step = steps[-1] if isinstance(steps[-1], str) else ""
    if not (
        re.search(r"\b(?:check|edit)\w*\b", final_step, re.IGNORECASE)
        and _RUNDOWN_SEND_FOR_REVIEW_RE.search(final_step)
        and not _RUNDOWN_HEDGED_REVIEW_RE.search(final_step)
    ):
        errors.append("last step must check/edit and send the cut for user review")
    voice_index = next(
        (
            index
            for index, step in enumerate(steps)
            if isinstance(step, str) and _RUNDOWN_RECORDED_VOICE_RE.search(step)
        ),
        -1,
    )
    generation_index = next(
        (
            index
            for index, step in enumerate(steps)
            if isinstance(step, str) and _RUNDOWN_GENERATION_RE.search(step)
        ),
        -1,
    )
    if voice_index >= 0 and generation_index >= 0 and voice_index >= generation_index:
        errors.append("recorded voice must come before generated media")
    return errors

# Canonical actions that create or transform production media. Reference
# ingestion, analysis, and QA tools are intentionally absent. review_render
# (videoclaw#265) is listed here, and in ALWAYS_FREE_TOOLS, like
# remotion_render: the host must see it as a canonical action bound to its
# --job (so it can give it its long window and a scoped review credential),
# and it is free to the user (see ALWAYS_FREE_TOOLS).
PROTECTED_TOOLS = frozenset(
    {
        "assemble",
        "build_carousel",
        "build_character_sheet",
        "cast_avatar",
        "clean_audio",
        "compose_render",
        "densify",
        "frame_insert",
        "fx_parallax",
        "hyperframes_render",
        "lipsync_footage",
        "mint_image",
        "mint_video",
        "perform_avatar",
        "remotion_render",
        "replicate_safe",
        "review_render",
        "sam3",
        "score_bed",
        "scrub_reference_vo",
        "synth_voice",
    }
)

# Spend risk is intentionally separate from route protection. A protected
# production mutation can be local/free (ffmpeg, Remotion, assembly), while a
# read-only analysis can still call a paid provider. Unknown is the fail-closed
# result for mixed or input-dependent tools; the app must never treat it as
# zero-spend.
ALWAYS_PAID_TOOLS = frozenset(
    {
        "build_carousel",
        "build_character_sheet",
        "cast_avatar",
        "frame_insert",
        # One fixed-price gateway depth map per still (videoclaw#296).
        "fx_parallax",
        "mint_image",
        "mint_video",
        "perform_avatar",
        "replicate_safe",
        "sam3",
    }
)
# compose_render is deliberately ABSENT: its render/retrofit/cover_bake modes
# are local Remotion/ffmpeg, but --mode episode shells out to synth_voice,
# lipsync_footage, and mint_image as child processes (make_episode) — the mode
# split lives in _canonical_spend_risk. test_free_tool_sources_never_spawn_
# spenders pins that no tool on this list can grow such a child spawn silently.
# review_render's one model call is HOUSE-PAID by contract, never the user's:
# its supervised child sends a single request to the dedicated
# /v1/harness/review route, which the gateway bills to VideoClaw or refuses,
# and the answer is used only when it comes back house-billed. It never
# quotes, reserves or settles user spend. It must stay OFF KNOWN_FREE_TOOLS
# (no action would be emitted) and OFF ANALYSIS_SPEND_TOOLS (the app's paid
# list would then have to carry it).
ALWAYS_FREE_TOOLS = frozenset(
    {
        "assemble",
        "hyperframes_render",
        "remotion_render",
        "review_render",
    }
)

# Deny-by-default mirror of the desktop classifier (app issue #156). Tools
# outside PROTECTED_TOOLS that still spend through the gateway or a vendor API
# must SURFACE in the verdict: each invocation emits a read-only canonical
# action with a non-free spend risk, so the desktop's "read-only and free"
# early allow can never swallow paid work. Keys are the audited spenders;
# "paid" marks deterministic metered calls.
ANALYSIS_SPEND_TOOLS: dict[str, str] = {
    "acquire_footage": "paid",
    "analyze_reference": "paid",
    "breakdown_reference": "paid",
    "check_script": "paid",
    "decode_audio": "paid",
    "gemini_video": "paid",
    # Local strips plus at most one metered Scribe transcription per video
    # (issue #271). `--no-transcript` is the source-audited free form.
    "look_at_video": "paid",
    "pull_video": "paid",
    "review_output": "paid",
    "script_preflight": "paid",
    "verify_output": "paid",
}

# ─────────────────────────────────────────────────────────────────────────────
# decode_audio's reference grammar — THE one definition (issue #198, #199 review)
#
# decode_audio feeds every one of these flags through its own resolve_ref, the
# tool's ONLY acquisition seam. Two money layers read this argv — the spend-risk
# classifier below and cost.py's price table — and a second copy of the grammar
# drifts, so cost.py imports these names from here rather than restating them.
# It lives in THIS file because prepare_production is an ENFORCEMENT_FILES entry
# whose sha256 is recorded in the route receipt: a grammar in an unpinned
# sibling would decide money verdicts from outside that integrity surface.
#
# It reproduces what execution actually does — argparse's unambiguous-prefix
# abbreviation and urlparse's URL normalization — because a grammar NARROWER
# than execution turns a real acquisition into a free verdict.
# ─────────────────────────────────────────────────────────────────────────────

# Order mirrors decode_audio.main()'s resolve order, so a derived count lines up
# with the sequence execution performs.
DECODE_AUDIO_REF_FLAGS: tuple[str, ...] = (
    "--input",
    "--candidates",
    "--vocal-stems",
    "--vocal-stem",
)
# nargs="+": these two own every following non-flag token.
DECODE_AUDIO_MULTI_REF_FLAGS = frozenset({"--candidates", "--vocal-stems"})
# argv that returns before resolve_ref is ever reached.
DECODE_AUDIO_NO_RESOLVE_FLAGS = frozenset({"--selftest", "-h", "--help"})

# `urllib.parse.urlsplit`'s own normalization, reproduced rather than called so
# the app's string classifier can mirror it byte for byte: leading C0-or-space
# is stripped and tab/CR/LF are removed ANYWHERE before the scheme is read.
# `urlparse(" https://x").scheme` is "https" and so is `urlparse("https:/x")`;
# a `^https?://` regex called both of those local.
_C0_OR_SPACE = "".join(chr(code) for code in range(0x21))
_UNSAFE_URL_CHARS = ("\t", "\r", "\n")
_SCHEME_RE = re.compile(r"\A([A-Za-z][A-Za-z0-9+.\-]*):")
# resolve_ref returns `Path(ref)` for every other scheme, `file://` included.
_REMOTE_SCHEMES = frozenset({"http", "https"})

_AMBIGUOUS = object()


def ref_scheme(ref: str) -> str:
    """The scheme `urllib.parse.urlparse` reads off `ref`, lowercased."""
    normalized = ref.lstrip(_C0_OR_SPACE)
    for char in _UNSAFE_URL_CHARS:
        normalized = normalized.replace(char, "")
    match = _SCHEME_RE.match(normalized)
    return match.group(1).lower() if match else ""


def is_remote_ref(ref: str) -> bool:
    """True when `decode_audio.resolve_ref` would ACQUIRE this reference."""
    return ref_scheme(ref) in _REMOTE_SCHEMES


def _resolve_ref_flag(name: str):
    """Which reference flag argparse resolves `name` to, if any.

    argparse accepts any UNAMBIGUOUS prefix of a long option, so `--inp` IS
    `--input` and the last occurrence wins — the hole this replaces kept
    `local.wav` from `--input local.wav --inp <url>` and dropped the URL
    execution actually pulls. A prefix matching two reference flags is one
    argparse rejects outright; report it rather than guess.
    """
    if name in DECODE_AUDIO_REF_FLAGS:
        return name                       # an exact spelling always wins
    if not name.startswith("--") or name == "--":
        return None
    matches = [flag for flag in DECODE_AUDIO_REF_FLAGS if flag.startswith(name)]
    if len(matches) == 1:
        return matches[0]
    return _AMBIGUOUS if matches else None


def decode_audio_refs(args: list[str]) -> tuple[list[str], bool]:
    """Every value decode_audio.main() hands to resolve_ref, in resolve order.

    Returns `(refs, provable)`. `provable` is False when argparse's own reading
    of argv cannot be reproduced from the token list alone; the caller must then
    fail closed, never free.
    """
    values: dict[str, list[str]] = {}
    flag: str | None = None
    provable = True
    for token in args:
        if token == "--":
            # decode_audio declares no positionals, so argparse rejects this
            # shape outright. Refuse it rather than model the split.
            provable = False
            flag = None
            continue
        if token.startswith("-") and token != "-":
            name, sep, inline = token.partition("=")
            resolved = _resolve_ref_flag(name)
            flag = None
            if resolved is _AMBIGUOUS:
                provable = False
            elif resolved is not None:
                # Single-value flags keep the LAST occurrence, and a repeated
                # nargs="+" flag replaces the whole previous list.
                values[resolved] = [inline] if sep else []
                if not sep:
                    flag = resolved
            continue
        if flag is not None:
            values[flag].append(token)
            if flag not in DECODE_AUDIO_MULTI_REF_FLAGS:
                flag = None
    refs = [ref for name in DECODE_AUDIO_REF_FLAGS for ref in values.get(name, ())]
    return refs, provable


def decode_audio_acquisition(args: list[str]) -> tuple[bool, int]:
    """`(spends, acquisitions)` for one decode_audio argv.

    `spends` is False ONLY for argv that argparse and urlparse together prove
    resolves nothing remote. Two deliberate fail-closed edges: argv naming NO
    reference cannot be proven local, and cache state is filesystem state rather
    than argv, so a remote reference is paid whether or not this machine holds
    the cached rip.

    `acquisitions` is how many references execution hands to resolve_ref's
    remote branch — `--mode compare --candidates <2 urls> --vocal-stems <2 urls>`
    is four distinct acquisitions, not one. Repeats inside one invocation are
    NOT collapsed: a second identical URL is a cache hit without `--regen` and a
    real second fetch with it, so the advisory estimate rounds toward the spend.
    """
    if any(flag in args for flag in DECODE_AUDIO_NO_RESOLVE_FLAGS):
        return False, 0
    refs, provable = decode_audio_refs(args)
    remote = [ref for ref in refs if is_remote_ref(ref)]
    if remote:
        return True, len(remote)
    if not provable or not refs:
        return True, 1
    return False, 0



def _decode_audio_spend_risk(tokens: list[str]) -> str:
    """decode_audio's conditional acquisition (issue #198).

    Every mode is local numpy/scipy + ffmpeg measurement EXCEPT resolve_ref
    (`tools/decode_audio.py`), which hands a remote http(s) reference to
    pull_video's own `_gateway_audio_rip` — POST /v1/media/pull with
    audio_only, the same metered acquisition `pull_video --mode pull
    --audio-only` performs. A local path, a `file://` URL and `--selftest`
    never reach it.

    Free is granted only for argv the REAL parser proves local. `--inp <url>`
    is argparse's abbreviation of `--input` and wins over an earlier
    `--input local.wav`; `" https://..."` and `"https:/..."` are both remote to
    urlparse. Beyond that, three fail-closed edges: an invocation that names NO
    reference cannot be proven local; a prefix argparse would reject as
    ambiguous is refused rather than guessed; and whether a remote reference is
    already cached under `<job>/reference/` is filesystem state, not argv, so a
    remote reference is paid whether or not this machine holds the cached rip.
    """
    spends, _ = decode_audio_acquisition(tokens)
    return "paid" if spends else "free"


def look_at_video_is_free(args: list[str]) -> bool:
    """True only when look_at_video's parser provably makes no metered call.

    That is `--no-transcript`, or `-h`/`--help` (argparse exits first). Its
    parser disables abbreviations, so only the exact tokens count, and never
    after a `--`: every token after it is a video path, so a file named
    `--help` is still transcribed. Whether a transcript is already cached is
    filesystem state, not argv, so any other form is paid.
    """
    for token in args:
        if token == "--":
            return False
        if token in {"--no-transcript", "-h", "--help"}:
            return True
    return False


def _analysis_spend_risk(tool: str, tokens: list[str]) -> str:
    """Spend risk for the non-protected spenders above.

    Mode/flag downgrades mirror the desktop classifier and are trusted only
    for source-audited forms (#184 measured table): `--skip-llm` runs Phase-1
    deterministic checks only in both script tools, and verify_output's
    render/audio/pre-gen modes are local ffprobe/ffmpeg/frame work — only
    false-start re-transcribes via the vendor.
    """
    if tool == "look_at_video":
        # Before the generic help shortcut: a positional after `--` may be a
        # video literally named `--help`.
        return "free" if look_at_video_is_free(tokens) else "paid"
    if any(token in {"-h", "--help"} for token in tokens):
        return "free"
    if tool == "cost":
        command = _positional_mode(tokens)
        if command in {"estimate", "plan", "quote", "reconcile"}:
            return "free"
        return "unknown"
    if tool == "index_media":
        command = _positional_mode(tokens)
        backend = _arg_value(tokens, "--backend") or "gemini"
        embedding_command = command in {"index", "search", "img", "sync"} or (
            command == "add-source" and "--index" in tokens
        )
        if not embedding_command:
            return "free" if command in {
                "add-source", "remove-source", "reindex", "stats", "scan", "remove", "reset"
            } else "unknown"
        if backend == "gemini":
            return "paid"
        if backend in {"dummy", "local"}:
            return "free"
        return "unknown"
    if tool == "decode_audio":
        return _decode_audio_spend_risk(tokens)
    if tool in {"check_script", "script_preflight"} and "--skip-llm" in tokens:
        return "free"
    if tool == "verify_output":
        if "--pre-gen" in tokens:
            return "free"
        mode = _arg_value(tokens, "--mode")
        return "free" if mode in {"render", "audio", "pre-gen"} else "paid"
    return ANALYSIS_SPEND_TOOLS.get(tool, "unknown")


# Audited local-only tools outside PROTECTED_TOOLS: the explicit FREE
# allowlist. `cost` is mode-sensitive only so its retired `execute` spelling can
# fail closed explicitly; every supported cost subcommand is advisory/read-only.
# The six HyperFrames library/compositor helpers are pure local file transforms.
# delivery_safety (issue #198) is a no-CLI library imported by review_output —
# red_zones plus local cv2/ffprobe, no gateway or provider import — structurally
# the remotion_lock/red_zones shape already on this list.
# hyperframes_render is local/free too, but lives in PROTECTED_TOOLS and
# ALWAYS_FREE_TOOLS because it creates final_hyperframes.mp4. Keep
# authenticated gateway surfaces such as sfx_catalog off this list even when
# their current quote is $0: zero price is not the same contract as
# local/offline execution.
# A tools/<name>.py invocation on NEITHER list is an unknown spender and
# surfaces with spendRisk "unknown" — fail closed, never free.
KNOWN_FREE_TOOLS = frozenset(
    {
        "assemble_plate",
        "check_layout",
        "check_promise",
        "chunk_boundaries",
        "cost",
        "delivery_safety",
        "dense_sample",
        "doctor",
        "dense_sample",
        "fetch_asset",
        "hyperframes_captions",
        "hyperframes_compose",
        "hyperframes_dataviz",
        "hyperframes_layout",
        "hyperframes_overlays",
        "hyperframes_style",
        "job",
        "job_inputs",
        "log",
        "preflight",
        "prepare_production",
        "project_brief",
        "qa_gate",
        "red_zones",
        "reframe",
        "remotion_lock",
        "render_timeline_strip",
        "session_marker",
        "taste_contract",
        "website_style",
    }
)

# These modes inspect or validate existing material and do not create production
# media. They remain available before routing so the agent can understand intent.
READ_ONLY_MODES = {
    "synth_voice": frozenset({"transcribe", "list_voices"}),
    "densify": frozenset({"transcribe"}),
}

_MD_LINK_RE = re.compile(r"\]\(([^)\s]+)")
_TOOL_PATH_RE = re.compile(r"(?:^|/)tools/([a-z_][a-z0-9_]*)\.py$")
_JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_PROTECTED_NAME_RE = re.compile(
    r"(?:^|/)tools/(?:"
    + "|".join(sorted(re.escape(name) for name in PROTECTED_TOOLS))
    + r")\.py(?:\s|[;&|()]|$)"
)
# Any tools/<name>.py mention — the analysis/unknown analog of
# _PROTECTED_NAME_RE. Applied ONLY to opaque-launcher payloads (`bash -c '…'`,
# `eval …`), never to reader segments, so greps/echoes of tool paths stay
# silent while a payload naming an engine tool can never aggregate to free.
_TOOL_NAME_MENTION_RE = re.compile(
    r"(?:^|[\s/'\"=;&|(`])tools/([a-z_][a-z0-9_]*)\.py"
)
_MEDIA_OUTPUT_SUFFIXES = frozenset(
    {".gif", ".m4v", ".mkv", ".mov", ".mp4", ".png", ".webm"}
)
_KNOWN_READ_ONLY_SHELL_HEADS = frozenset(
    {
        "cat",
        "cd",
        "diff",
        "du",
        "echo",
        "ffprobe",
        "file",
        "find",
        "grep",
        "head",
        "jq",
        "ls",
        "printf",
        "pwd",
        "rg",
        "stat",
        "tail",
        "test",
        "true",
        "wc",
    }
)
_SED_PRINT_ONLY_PROGRAM_RE = re.compile(
    r"^(?:\s*(?:\d+|\$)(?:\s*,\s*(?:\d+|\$))?|\s*/(?:\\.|[^/])+/)\s*[pP]\s*$"
)
_KNOWN_PRODUCTION_LAUNCHER_HEADS = frozenset(
    {
        "bash",
        "bunx",
        "curl",
        "eval",
        "ffmpeg",
        "npm",
        "npx",
        "pnpm",
        "pnpx",
        "remotion",
        "sh",
        "uv",
        "yarn",
        "zsh",
    }
)
_KNOWN_LOCAL_WRITE_HEADS = frozenset(
    {"cp", "install", "mv", "tee", "touch", "truncate"}
)
# Ordinary workspace preparation is neither a read nor a production action.
# Keep it out of the opaque-wrapper net without granting provider capability.
_KNOWN_LOCAL_SETUP_HEADS = frozenset({"mkdir"})
_FFMPEG_INPUT_PATH_OPTIONS = frozenset(
    {"-attach", "-filter_complex_script", "-filter_script", "-i"}
)
_CANONICAL_OUTPUT_FLAGS = ("--out", "--out-dir", "--output", "--output-dir")


def _sed_is_provably_print_only(command: list[str]) -> bool:
    """Recognize only the bounded sed reader forms used for output inspection.

    ``sed`` is not globally read-only: ``-i`` mutates its input, ``e`` can
    execute a command, ``w`` writes a file, and ``-f`` loads uninspected code.
    The production classifier therefore admits only quiet, inline print
    selectors such as ``sed -n '1,60p' file`` and ``sed -n '/word/p' file``.
    Everything else remains opaque/fail-closed when tied to a job.
    """
    if not command or Path(command[0]).name.lower() != "sed":
        return False

    quiet = False
    programs: list[str] = []
    index = 1
    while index < len(command):
        token = command[index]
        if token == "--":
            index += 1
            break
        if token in {"-n", "--quiet", "--silent"}:
            quiet = True
            index += 1
            continue
        if token in {"-e", "--expression"}:
            if index + 1 >= len(command):
                return False
            programs.append(command[index + 1])
            index += 2
            continue
        if token.startswith("--expression="):
            programs.append(token.split("=", 1)[1])
            index += 1
            continue
        if token.startswith("-"):
            # Includes -i/--in-place, -f/--file and glued/combined variants.
            return False
        if not programs:
            programs.append(token)
            index += 1
            continue
        # Remaining ordinary tokens are input files. Keep scanning so a
        # reordered mutating option such as `sed -n '1p' -i file` cannot hide
        # after the inline program.
        index += 1

    return bool(
        quiet
        and programs
        and all(_SED_PRINT_ONLY_PROGRAM_RE.fullmatch(program) for program in programs)
    )


def _is_provably_read_only_shell_command(command: list[str]) -> bool:
    if not command:
        return False
    head = Path(command[0]).name.lower()
    return head in _KNOWN_READ_ONLY_SHELL_HEADS or _sed_is_provably_print_only(command)
# ── The provider net (app issue #204) ────────────────────────────────────────
# Every family below is a SORTED TUPLE OF ALTERNATION ATOMS, not a hand-written
# regex, and the desktop app carries a byte-identical copy in
# apps/desktop/src/main/productionAuthorization.ts. `npm run check:money-drift`
# dumps these tuples and asserts set equality with the app's arrays, so the two
# copies can never drift again (the drift class that made #204 possible).
#
# Before #204 the net was one HOST list AND one VERB list, so a paid call
# escaped whenever EITHER side missed: our own metered gateway and openrouter
# were absent from the host list; `requests.post` to a LISTED host missed the
# verb list; and the Gemini SDK names no host at all. All four probes are
# fixtures now (tests/test_production_verdict.py).

# Hosts, vendor SDK/CLI names, the Videoclaw gateway, and the gateway
# CREDENTIAL. The credential atoms are load-bearing: the canonical gateway call
# interpolates its host (`"$VIDEOCLAW_GATEWAY/v1/gen/image"`), so no host
# pattern can ever see it — the `VIDEOCLAW_API_KEY` / `VIDEOCLAW_GATEWAY_URL`
# reference and a literal `vc_` key are what identify a metered gateway call.
# The `videoclaw-gw-*.run.app` atom covers prod AND staging AND any future Cloud
# Run revision; a user-set custom `gatewayUrl` is matched dynamically instead,
# by _configured_gateway_hosts() below. Never hardcode only prod.
PROVIDER_SERVICE_PATTERNS: tuple[str, ...] = (
    r"VIDEOCLAW_(?:API_KEY|GATEWAY(?:_URL)?|GW_URL)",
    r"aiplatform\.googleapis\.com",
    r"anthropic",
    r"api\.anthropic\.com",
    r"api\.apify\.com",
    r"api\.elevenlabs\.io",
    r"api\.openai\.com",
    r"api\.replicate\.com",
    r"elevenlabs",
    r"fal\.(?:ai|run)",
    r"fal_client",
    r"generativelanguage\.googleapis\.com",
    r"google\.generativeai",
    r"kling",
    r"openai",
    r"openrouter\.ai",
    r"replicate(?:\.run)?",
    r"seedance",
    r"vc_[A-Za-z0-9]{16,}",
    r"videoclaw-gw-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.run\.app",
)

# The bare vendor NAMES within PROVIDER_SERVICE_PATTERNS — atoms that are not a
# host, credential, `vc_` key, or gateway. These identify a vendor SDK/CLI call
# by name, but must NOT alone make an arbitrary URL a provider (round 2 fd3).
PROVIDER_BARE_NAME_PATTERNS: tuple[str, ...] = (
    r"anthropic",
    r"elevenlabs",
    r"fal_client",
    r"google\.generativeai",
    r"kling",
    r"openai",
    r"replicate(?:\.run)?",
    r"seedance",
)

# app#840 — ACQUISITION origins. Every other atom in this net needs a MUTATION
# beside the provider signal, because a GET at an inference vendor is polling or
# downloading something already paid for. An acquisition vendor is different:
# Apify's `run-sync-get-dataset-items` STARTS and BILLS an actor run on GET, and
# its key-value-store record URL is the output of a run no meter saw. On these
# hosts the host itself is the spend signal, whatever the request shape.
# Set-identical with PROVIDER_ACQUISITION_HOST_PATTERNS in the app's
# productionAuthorization.ts (asserted by the app's check:money-drift).
PROVIDER_ACQUISITION_HOST_PATTERNS: tuple[str, ...] = (
    r"api\.apify\.com",
)

# The original verb list: a vendor SDK/CLI call shape.
PROVIDER_ACTION_PATTERNS: tuple[str, ...] = (
    r"\.(?:create|generate(?:_content)?|predict|run|submit)\s*\(",
    r"\b(?:create|generate(?:_content)?|predict|run|submit)\s*\(",
)

# Vendor SDK call shapes that NAME NO HOST — the Gemini escape in #204
# (`genai.Client().models.generate_content(...)`). A hit satisfies BOTH gates:
# you cannot write one of these without reaching a paid provider.
PROVIDER_SDK_PATTERNS: tuple[str, ...] = (
    r"\.audio\.(?:speech|transcriptions|translations)\.create\s*\(",
    r"\.chat\.completions\.create\s*\(",
    r"\.images\.(?:generate|edit|create_variation)\s*\(",
    r"\.messages\.(?:create|stream)\s*\(",
    r"\.models\.generate_(?:content|images)\s*\(",
    r"\.predictions\.create\s*\(",
    r"\.responses\.create\s*\(",
    r"\.text_to_speech\.(?:convert|stream)\s*\(",
    r"\bGenerativeModel\s*\(",
    r"\bfal_client\.(?:run|stream|submit|subscribe)\s*\(",
    r"genai\.Client\s*\(",
)

# The subset of PROVIDER_SDK_PATTERNS that is a bare CONSTRUCTOR — it names the
# client but makes no paid call. Round 3 (SDK-ctor false-deny): `genai.Client()`
# and `GenerativeModel('m')` with no generation call must be FREE. A constructor
# still IDENTIFIES the provider (step 2), but only a real generation call is a
# mutation.
PROVIDER_SDK_CTOR_PATTERNS: tuple[str, ...] = (
    r"\bGenerativeModel\s*\(",
    r"genai\.Client\s*\(",
)

# Generic HTTP clients. Against a LISTED host these count as mutating unless the
# text proves a read method (below) — the `requests.post` escape in #204.
PROVIDER_HTTP_CLIENT_PATTERNS: tuple[str, ...] = (
    r"\baiohttp\b",
    r"\baxios\b",
    r"\bfetch\s*\(",
    r"\bgot\s*\(",
    r"\bhttp\.client\b",
    r"\bhttps?\.request\s*\(",
    r"\bhttpx\b",
    r"\bnode-fetch\b",
    r"\brequests\b",
    r"\bsuperagent\b",
    r"\bundici\b",
    r"\burllib3?\b",
    r"\burlopen\s*\(",
    r"HTTPS?Connection\s*\(",
    r"XMLHttpRequest",
)

# Recognized READ call shapes. The generic-client exemption is PER-CALL: round 2
# (f3) made a bare `fetch(url)` / `urlopen(url)` default to a free GET, and round
# 3 (f #1) blanks each read call's window so a sibling GET to a provider cannot
# make an unrelated POST protected (`_blank_read_call_windows`).
# This tuple is retained for the drift ledger and documents the read shapes;
# every atom is CLIENT-QUALIFIED (round 1: a bare `\.get(` also matched
# `os.environ.get(`, so the escape must name the HTTP call, not any `.get(`).
PROVIDER_HTTP_READ_PATTERNS: tuple[str, ...] = (
    r"\b(?:axios|client|http|httpx|requests|session)\.(?:get|head|options)\s*\(",
    # Triple-quoted so the `["']` char classes are byte-identical to the app's
    # copy — the drift check compares atom STRINGS, and a double-quoted raw
    # `r"…[\"']…"` retains the backslash and reads as engine-only drift.
    r"""\b(?:requests|httpx)\.(?:request|stream)\s*\(\s*["'](?:GET|HEAD|OPTIONS)["']""",
    r"\bSession\s*\(\s*\)\.(?:get|head|options)\s*\(",
    r"""\bmethod\s*[:=]\s*["'](?:GET|HEAD|OPTIONS)["']""",
)

# An explicit mutating method. Case-SENSITIVE on both layers (argv HTTP methods
# are uppercase by convention) so English prose like "put the file" cannot flip
# a command protected. The lowercase atoms are client-qualified module paths and
# call shapes, which are lowercase by definition.
#
# Round 1: `\b(?:requests|httpx|…)\.(?:delete|patch|post|put)\b` needs no `(` —
# `p = requests.post; …; p(url)` is a mutation whose call site names no method.
# Round 2 f3: a LOWERCASE method arg/option (`requests.request('post', …)`,
# `fetch(url,{method:'post'})`) is a mutation too — the uppercase forms are
# already covered by the bare `\b(?:DELETE|PATCH|POST|PUT)\b` atom, so only the
# lowercase call shapes are added here. `urlopen`/`Request` with a `data=` body
# is a POST even though it names no method. The `["']` atoms are triple-quoted
# so the char classes stay byte-identical to the app copy (drift compares atoms).
PROVIDER_HTTP_MUTATING_PATTERNS: tuple[str, ...] = (
    r"\.(?:patch|post|put|send|stream|upload)\s*\(",
    r"\b(?:Request|urlopen)\s*\([^)]*\bdata\s*=",
    r"\b(?:aiohttp|axios|httpx|requests|urllib3)\.(?:delete|patch|post|put)\b",
    r"""\b(?:httpx|requests|session)\.(?:request|stream)\s*\(\s*["'](?:delete|patch|post|put)["']""",
    r"""\bmethod\s*[:=]\s*["'](?:delete|patch|post|put)["']""",
    r"--method[= ](?:DELETE|PATCH|POST|PUT)",
    r"--post-data",
    r"--post-file",
    r"--upload-file",
    r"\b(?:DELETE|PATCH|POST|PUT)\b",
)

# Evidence that a segment can actually SPEAK HTTP. Review round 1, finding 4:
# the bare uppercase-method atom above, applied alone to any non-reader head,
# made `git commit -m "POST to openai"`, `scp seedance-POST.json host:/tmp/` and
# `make POST-openai` hard denies — baffling refusals reading "requires --job".
# On the catch-all launcher branch the bare method must now CO-OCCUR with a
# literal URL or a known HTTP client binary. (Generic client symbols are handled
# separately by PROVIDER_HTTP_CLIENT_PATTERNS, so they are not repeated here.)
PROVIDER_TRANSPORT_PATTERNS: tuple[str, ...] = (
    r"\bcurl\b",
    r"\bcurlie\b",
    r"\bhttpie\b",
    r"\bhurl\b",
    r"\bwget\b",
    r"\bxh\b",
    r"https?://",
)

# Constructs that let an otherwise READ-ONLY head execute an arbitrary command.
# Review round 1, finding 2: `awk 'BEGIN{system("curl -X POST …")}'` and GNU
# `sed -e 'e curl -X POST …'` are real egress, and the reader exemption — which
# short-circuits before the provider is even identified — was preserving the
# whole #204 hole for them. Same carve-out precedent as `find -exec`.
#
# Over-matching here is CHEAP by construction: losing the reader exemption is
# not a verdict. The segment still has to identify a provider AND prove a
# mutation, so `grep -E 'a|"b"' f` merely takes the ordinary path and stays free.
READER_SHELL_OUT_PATTERNS: tuple[str, ...] = (
    r"(?:^|[\s;{}])e\s+\S",
    # Triple-quoted for byte-identical `["']` parity with the app copy.
    r"""["']\s*\|\s*&?\s*getline""",
    r"\bexecl?p?\s*\(",
    r"\bpopen\s*\(",
    r"\bs(.)(?:(?!\1).)*\1(?:(?!\1).)*\1[a-zA-Z0-9]*e(?![a-zA-Z0-9])",
    r"\bsystem\s*\(",
    r"""\|\s*&?\s*["']""",
)

# ── curl's own argv grammar ──────────────────────────────────────────────────
# Review round 1, finding 1 (BLOCKING): the old `_curl_mutates` was the ONLY
# mutation gate for the hosts #204 newly brought in scope, and it mis-parsed
# three valid spellings — a GLUED short option (`-d@b.json` never split, so it
# missed the flag set), a LONG option with `=` (`--request=POST`), and REPEATED
# `-X` (it returned on the first; curl uses the LAST). `curl <provider-url>
# -d@b.json` — the #204 positive control with one space deleted — was free.
#
# These tables are drift-checked alongside the pattern families, because
# `_curl_mutates` itself is what decides the fate of every curl in the net.
CURL_BODY_FLAGS: tuple[str, ...] = (
    "--data",
    "--data-ascii",
    "--data-binary",
    "--data-raw",
    "--data-urlencode",
    "--form",
    "--form-string",
    "--json",
    "--upload-file",
    "-F",
    "-T",
    "-d",
)
CURL_METHOD_FLAGS: tuple[str, ...] = ("--request", "-X")
CURL_FORCE_GET_FLAGS: tuple[str, ...] = ("--get", "-G")
CURL_FORCE_HEAD_FLAGS: tuple[str, ...] = ("--head", "-I")
# Short options whose VALUE may be glued (`-d@x`), separate (`-d @x`) or ride a
# bundle (`-sd@x`). Everything else in a `-abc` cluster is boolean. Getting this
# wrong in either direction mis-reads the argv, so the list is explicit.
CURL_VALUE_SHORT_OPTIONS: tuple[str, ...] = (
    "A", "C", "D", "E", "F", "H", "K", "P", "Q", "T", "U", "X", "Y",
    "b", "c", "d", "e", "m", "o", "r", "t", "u", "w", "x", "y", "z",
)
# Long options that consume the NEXT token. Only genuinely value-taking options
# belong here: a boolean listed by mistake would swallow the following flag.
CURL_LONG_WITH_VALUE: tuple[str, ...] = (
    "--aws-sigv4", "--cacert", "--capath", "--cert", "--config",
    "--connect-timeout", "--connect-to", "--continue-at", "--cookie",
    "--cookie-jar", "--data", "--data-ascii", "--data-binary", "--data-raw",
    "--data-urlencode", "--dump-header", "--form", "--form-string", "--header",
    "--interface", "--json", "--key", "--limit-rate", "--max-redirs",
    "--max-time", "--oauth2-bearer", "--output", "--proxy", "--proxy-user",
    "--range", "--referer", "--request", "--resolve", "--retry",
    "--time-cond", "--unix-socket", "--upload-file", "--url", "--user",
    "--user-agent", "--write-out",
)
# HTTP methods that cannot carry a generation request.
CURL_READ_METHODS: tuple[str, ...] = ("GET", "HEAD", "OPTIONS")

# Heads that only ever READ. They are exempt from the whole provider net, which
# is what keeps the 21/23 false-positive fix intact: a provider host, an SDK
# symbol, or the word POST appearing in a grep/cat/sed/rg argv is DATA, never
# egress. `find` is a reader only WITHOUT -exec/-ok (an -exec payload can carry
# a real curl), and `curl` is deliberately absent — it has its own flag parser.
PROVIDER_READ_ONLY_HEADS = frozenset(
    {
        "awk",
        "basename",
        "cat",
        "column",
        "comm",
        "cut",
        "diff",
        "dirname",
        "du",
        "echo",
        "false",
        "ffprobe",
        "file",
        "find",
        "grep",
        "head",
        "jq",
        "less",
        "ls",
        "more",
        "nl",
        "printf",
        "pwd",
        "realpath",
        "rg",
        "sed",
        "sort",
        "stat",
        "tail",
        "test",
        "tr",
        "true",
        "type",
        "uniq",
        "wc",
        "which",
        "xxd",
        "yq",
    }
)

_FIND_EXEC_FLAGS = frozenset({"-exec", "-execdir", "-ok", "-okdir"})
_GATEWAY_URL_ENV_VARS = ("VIDEOCLAW_GATEWAY_URL", "VIDEOCLAW_GW_URL")
_DEFAULT_PORTS = {"http": 80, "https": 443}
# `+` is excluded so a string concatenation (`os.environ['X']+'/v1'`) does not
# glue onto the host — the origin (host:port) is what we compare (round 4 f4).
_URL_IN_TEXT_RE = re.compile(r"https?://[^\s\"'<>|;,)\]}+]+", re.IGNORECASE)


def _alternation(patterns: tuple[str, ...], flags: int = re.IGNORECASE):
    return re.compile("(?:" + "|".join(patterns) + ")", flags)


_PROVIDER_SERVICE_RE = _alternation(PROVIDER_SERVICE_PATTERNS)
_PROVIDER_ACQUISITION_HOST_RE = re.compile(
    r"(?:^|\.)(?:%s)$" % "|".join(PROVIDER_ACQUISITION_HOST_PATTERNS), re.IGNORECASE
)
_SCHEMELESS_ACQUISITION_RE = re.compile(
    r'''(^|[\s"'(=])((?:[\w-]+\.)*(?:%s)\.?(?=[:/?#\s"'<>|;,)\]}+]|$))'''
    % '|'.join(PROVIDER_ACQUISITION_HOST_PATTERNS), re.IGNORECASE,
)


def _acquisition_origin_match(text: str) -> bool:
    """Does this text reach an acquisition vendor whose READS also spend?

    app#840. Label-anchored on the parsed hostname so a lookalike registration
    (`api.apify.com.evil.test`) cannot borrow the name.
    """
    text = re.sub(r'''["']\s*\+\s*["']''', '', text)
    text = _SCHEMELESS_ACQUISITION_RE.sub(r'\1https://\2', text)
    for candidate in _URL_IN_TEXT_RE.findall(text):
        try:
            hostname = (urlsplit(candidate).hostname or "").lower().rstrip(".")
        except ValueError:
            continue
        if hostname and _PROVIDER_ACQUISITION_HOST_RE.search(hostname):
            return True
    return False


_PROVIDER_STRONG_SERVICE_RE = _alternation(
    tuple(p for p in PROVIDER_SERVICE_PATTERNS if p not in PROVIDER_BARE_NAME_PATTERNS)
)
_PROVIDER_ACTION_RE = _alternation(PROVIDER_ACTION_PATTERNS)
_PROVIDER_SDK_RE = _alternation(PROVIDER_SDK_PATTERNS)
# A real paid SDK CALL (constructors excluded — round 3 SDK-ctor false-deny).
_PROVIDER_SDK_CALL_RE = _alternation(
    tuple(p for p in PROVIDER_SDK_PATTERNS if p not in PROVIDER_SDK_CTOR_PATTERNS)
)
_PROVIDER_HTTP_CLIENT_RE = _alternation(PROVIDER_HTTP_CLIENT_PATTERNS)
_PROVIDER_HTTP_MUTATING_RE = _alternation(PROVIDER_HTTP_MUTATING_PATTERNS, 0)
_PROVIDER_TRANSPORT_RE = _alternation(PROVIDER_TRANSPORT_PATTERNS)
_READER_SHELL_OUT_RE = _alternation(READER_SHELL_OUT_PATTERNS)
_CURL_BODY_FLAGS = frozenset(CURL_BODY_FLAGS)
_CURL_METHOD_FLAGS = frozenset(CURL_METHOD_FLAGS)
_CURL_FORCE_GET_FLAGS = frozenset(CURL_FORCE_GET_FLAGS)
_CURL_FORCE_HEAD_FLAGS = frozenset(CURL_FORCE_HEAD_FLAGS)
_CURL_VALUE_SHORT_OPTIONS = frozenset(CURL_VALUE_SHORT_OPTIONS)
_CURL_LONG_WITH_VALUE = frozenset(CURL_LONG_WITH_VALUE)
_CURL_READ_METHODS = frozenset(CURL_READ_METHODS)


def _url_origin(raw: str) -> str | None:
    """`scheme://host:port` collapsed to `host:port` with the default port made
    explicit. Review round 1, finding 6: the previous substring test on a bare
    hostname meant a localhost gateway turned EVERY local POST — vite, a dev
    server on another port — into a protected provider action."""
    parts = urlsplit(raw if "://" in raw else "https://" + raw)
    host = (parts.hostname or "").lower()
    if not host:
        return None
    try:
        port = parts.port
    except ValueError:
        return None
    return f"{host}:{port or _DEFAULT_PORTS.get(parts.scheme.lower(), 443)}"


def _configured_gateway_origins(environ: dict[str, str]) -> set[str]:
    """Origins of the CONFIGURED gateway (VIDEOCLAW_GATEWAY_URL, or the
    deprecated VIDEOCLAW_GW_URL alias — the same resolution order _gateway.py
    uses). Prod and staging are already covered by the videoclaw-gw-*.run.app
    atom; this is what covers a user-set custom `gatewayUrl` (localhost, a
    proxied domain) that no static pattern can predict."""
    origins: set[str] = set()
    for name in _GATEWAY_URL_ENV_VARS:
        raw = (environ.get(name) or "").strip()
        if not raw:
            continue
        origin = _url_origin(raw)
        if origin:
            origins.add(origin)
    return origins


def _configured_gateway_match(text: str, environ: dict[str, str]) -> bool:
    configured = _configured_gateway_origins(environ)
    if not configured:
        return False
    return any(
        _url_origin(url) in configured for url in _URL_IN_TEXT_RE.findall(text)
    )


def _provider_service_match(text: str, environ: dict[str, str]) -> bool:
    return bool(_PROVIDER_SERVICE_RE.search(text)) or _configured_gateway_match(
        text, environ
    )


def _strong_provider_match(text: str, environ: dict[str, str]) -> bool:
    """A STRONG provider signal — a host, credential, ``vc_`` key, or the
    configured gateway — as opposed to a bare vendor NAME. Round 2 (fd3):
    ``import openai; requests.post('https://example.com/webhook')`` was denied
    because the bare ``openai`` import "identified" a provider for a generic HTTP
    POST whose real target is an unrelated host. A generic HTTP client reaches a
    URL, so it must see a strong signal — a bare vendor name is not enough.
    Vendor NAME calls (``replicate.run(...)``) are still caught via the
    SDK/vendor-action paths, which do not require this."""
    return bool(_PROVIDER_STRONG_SERVICE_RE.search(text)) or _configured_gateway_match(
        text, environ
    )


def _matching_paren(text: str, open_paren: int) -> int:
    """Index of the ``)`` matching the ``(`` at ``open_paren``, skipping quotes."""
    depth = 0
    quote: str | None = None
    i = open_paren
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "\"'`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(text)


_CALL_HEAD_RE = re.compile(
    r"\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\("
)
_BINDING_RE = re.compile(
    r"(?:^|[;\n{}:]|(?:-c|-e)\s+)\s*(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=\s*"
    r"(?P<value>[^;\n]+)"
)
_HTTP_RECEIVERS = frozenset(
    {"aiohttp", "axios", "client", "got", "http", "httpx", "https",
     "requests", "session", "superagent", "undici", "urllib3"}
)
_CALLABLE_HTTP_CLIENTS = frozenset({"axios", "got"})
_HTTP_CONSTRUCTORS = frozenset(
    {
        "aiohttp.clientsession", "axios.create", "got.extend",
        "http.client.httpconnection", "http.client.httpsconnection",
        "httpx.asyncclient", "httpx.client", "requests.session",
        "undici.agent", "undici.client", "undici.pool", "xmlhttprequest",
    }
)
_HTTP_CONSTRUCTOR_HEAD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(value) for value in _HTTP_CONSTRUCTORS) + r")\s*\(",
    re.I,
)
_READ_METHODS = frozenset({"get", "head", "options"})
_WRITE_METHODS = frozenset({"delete", "patch", "post", "put", "send", "upload"})
_COMPUTED_PROVIDER_MEMBERS = _READ_METHODS | _WRITE_METHODS | frozenset(
    {"create", "generate", "generate_content", "predict", "request", "run", "stream", "submit"}
)
_SOURCE_STRING_RE = re.compile(
    r"(?P<prefix>[fFrR]*)(?P<quote>['\"`])(?:\\.|(?!\2).)*\2", re.DOTALL
)
_PROVIDER_MODULE_PATTERN = (
    r"aiohttp|anthropic|axios|fal_client|genai|got|http|https|httpx|openai|"
    r"replicate|requests|superagent|undici|urllib(?:3|\.request)?"
)
_LITERAL_MEMBER_RE = re.compile(
    r"(?P<base>\b[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)"
    r"\s*\[\s*(?P<quote>['\"])(?P<member>[A-Za-z_$][\w$]*)\2\s*\]"
)


def _argument_windows(text: str, start: int, end: int) -> list[tuple[int, int, str]]:
    """Split a call/object at top-level commas, respecting quotes and nesting."""
    out: list[tuple[int, int, str]] = []
    item_start = start
    depth = 0
    quote: str | None = None
    i = start
    while i < end:
        char = text[i]
        if quote:
            if char == "\\":
                i += 2
                continue
            if char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            out.append((item_start, i, text[item_start:i]))
            item_start = i + 1
        i += 1
    out.append((item_start, end, text[item_start:end]))
    return out


def _source_code(text: str) -> tuple[str, list[str]]:
    """Mask inert literals while retaining f-string/template expressions."""
    chars = list(text)
    expressions: list[str] = []
    for match in _SOURCE_STRING_RE.finditer(text):
        literal = match.group(0)
        if "f" in match.group("prefix").lower():
            expressions.extend(re.findall(r"\{(.*)\}", literal))
        if match.group("quote") == "`":
            expressions.extend(re.findall(r"\$\{(.*)\}", literal))
        for index in range(match.start(), match.end()):
            chars[index] = " "
    code = "".join(chars)
    code = re.sub(
        r"(?m)(?:#|//).*$|(?s:/\*.*?\*/)", lambda item: " " * len(item.group(0)), code
    )
    return code, expressions


def _source_bindings(text: str, code: str) -> list[tuple[str, str, int]]:
    bindings: list[tuple[str, str, int]] = []
    for match in _BINDING_RE.finditer(text):
        if not code[match.start():match.end()].strip():
            continue
        bindings.append((match.group(1), match.group("value").strip(), match.start()))
    import_patterns = (
        re.compile(
            rf"\bimport\s+({_PROVIDER_MODULE_PATTERN})\s+as\s+([A-Za-z_$][\w$]*)"
        ),
        re.compile(
            rf"\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+"
            rf"['\"]({_PROVIDER_MODULE_PATTERN})['\"]"
        ),
    )
    for pattern_index, pattern in enumerate(import_patterns):
        for match in pattern.finditer(text):
            if not code[match.start():match.end()].strip():
                continue
            module, alias = (
                (match.group(1), match.group(2))
                if pattern_index == 0
                else (match.group(2), match.group(1))
            )
            bindings.append((alias, module, match.start()))
    for match in re.finditer(
        rf"\bfrom\s+({_PROVIDER_MODULE_PATTERN})\s+import\s+"
        r"([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?",
        text,
    ):
        if code[match.start():match.end()].strip():
            bindings.append((match.group(3) or match.group(2), f"{match.group(1)}.{match.group(2)}", match.start()))
    for match in re.finditer(
        r"(?:^|[;\n{}]|(?:-c|-e)\s+)\s*(?:const\s+|let\s+|var\s+)?\{([^{}]+)\}\s*=\s*([^;\n]+)",
        text,
    ):
        if not code[match.start():match.end()].strip():
            continue
        base = match.group(2).strip()
        for item in match.group(1).split(","):
            member = re.fullmatch(
                r"\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*",
                item,
            )
            if member:
                bindings.append((member.group(2) or member.group(1), f"{base}.{member.group(1)}", match.start()))
    bindings.sort(key=lambda item: item[2])
    return bindings


def _normalize_literal_members(text: str) -> str:
    """Turn bounded string-literal member access into an equal-length dotted form."""
    code, _ = _source_code(text)
    chars = list(text)
    for match in _LITERAL_MEMBER_RE.finditer(text):
        if match.group("member").lower() not in _COMPUTED_PROVIDER_MEMBERS:
            continue
        if not code[match.start():match.start("quote")].strip():
            continue
        dotted = re.sub(r"\s*\.\s*", ".", match.group("base")) + "." + match.group("member")
        replacement = dotted + " " * (match.end() - match.start() - len(dotted))
        chars[match.start():match.end()] = replacement
    return "".join(chars)


def _constructor_chain_mutation(
    text: str, environ: dict[str, str]
) -> tuple[bool, bool]:
    """Classify one immediate method chained from a known inert constructor."""
    code, _ = _source_code(text)
    bindings = _source_bindings(text, code)
    for match in _HTTP_CONSTRUCTOR_HEAD_RE.finditer(text):
        if not code[match.start():match.end()].strip():
            continue
        open_paren = text.find("(", match.start(), match.end())
        close = _matching_paren(text, open_paren)
        chained = re.match(
            r"\s*\.\s*([A-Za-z_$][\w$]*)\s*\(", text[close + 1:]
        )
        if not chained:
            continue
        method = chained.group(1).lower()
        outer_open = text.find("(", close + 1, close + 1 + chained.end())
        outer_close = _matching_paren(text, outer_open)
        outer_args = _argument_windows(text, outer_open + 1, outer_close)
        resolved_args = [
            _resolve_local(arg, match.start(), bindings, environ)
            for _, _, arg in outer_args
        ]
        if method in {"request", "stream", "open"}:
            configured = next(
                (
                    configured
                    for arg in resolved_args
                    if (configured := _top_level_method(arg.removeprefix("**")))
                ),
                None,
            )
            candidate = (
                resolved_args[0].strip(" ()'\"").lower()
                if resolved_args
                else ""
            )
            method = configured or (candidate if candidate.isalpha() else "unknown")
        if method in _READ_METHODS:
            continue
        evidence = text[open_paren + 1:close] + " " + " ".join(resolved_args)
        return _strong_provider_match(evidence, environ), True
    return False, False


def _binding_before(
    name: str, at: int, bindings: list[tuple[str, str, int]]
) -> str | None:
    values = [(start, value) for bound, value, start in bindings if bound == name and start < at]
    return max(values, default=(0, None), key=lambda item: item[0])[1]


def _binding_entry_before(
    name: str, at: int, bindings: list[tuple[str, str, int]]
) -> tuple[str, int] | None:
    values = [(value, start) for bound, value, start in bindings if bound == name and start < at]
    return max(values, default=None, key=lambda item: item[1])


def _resolve_local(
    expression: str,
    at: int,
    bindings: list[tuple[str, str, int]],
    environ: dict[str, str],
) -> str:
    resolved = _expand_env_refs(_expand_provider_refs(expression, environ), environ)
    for _ in range(4):
        changed = resolved
        for name in set(re.findall(r"\b[A-Za-z_$][\w$]*\b", resolved)):
            value = _binding_before(name, at, bindings)
            if value is not None:
                resolved = re.sub(rf"\b{re.escape(name)}\b", value, resolved)
        if resolved == changed:
            break
    return resolved


def _top_level_method(expression: str) -> str | None:
    stripped = expression.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        stripped = stripped[1:-1]
    for _, _, item in _argument_windows(stripped, 0, len(stripped)):
        match = re.match(
            r"\s*['\"]?method['\"]?\s*[:=]\s*['\"]?([A-Za-z]+)", item, re.I
        )
        if match:
            return match.group(1).lower()
    return None


def _top_level_field(expression: str, names: frozenset[str]) -> str | None:
    stripped = expression.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        stripped = stripped[1:-1]
    for _, _, item in _argument_windows(stripped, 0, len(stripped)):
        match = re.match(r"\s*['\"]?([A-Za-z_][\w]*)['\"]?\s*[:=]\s*(.*)", item)
        if match and match.group(1).lower() in names:
            return match.group(2).strip()
    return None


def _http_call(
    head: str,
    args: list[tuple[int, int, str]],
    window: str,
    at: int,
    bindings: list[tuple[str, str, int]],
    environ: dict[str, str],
) -> tuple[str | None, str] | None:
    resolved_head = (
        _resolve_local(head, at, bindings, environ) if "." not in head else head
    ).strip()
    resolved_head = re.sub(r"\s*\.\s*", ".", resolved_head)
    if "." in resolved_head:
        root, suffix = resolved_head.split(".", 1)
        root_binding = _binding_before(root, at, bindings)
        if root_binding and re.fullmatch(_PROVIDER_MODULE_PATTERN, root_binding.strip()):
            resolved_head = f"{root_binding.strip()}.{suffix}"
    if resolved_head == "requests.Request":
        return "get", ""
    required = re.fullmatch(
        rf"require\s*\(\s*['\"]({_PROVIDER_MODULE_PATTERN})['\"]\s*\)",
        resolved_head,
    )
    if required:
        resolved_head = required.group(1)
    getattr_match = re.fullmatch(
        r"getattr\s*\(\s*([\w.]+)\s*,\s*['\"]([A-Za-z]+)['\"]\s*\)",
        resolved_head,
    )
    if getattr_match:
        resolved_head = f"{getattr_match.group(1)}.{getattr_match.group(2)}"
    parts = [part.strip().lower() for part in resolved_head.split(".")]
    direct = parts[-1] if parts else ""
    receiver = parts[-2] if len(parts) > 1 else ""
    normalized_head = ".".join(parts)
    known = (
        direct in {"fetch", "urlopen", "request"}
        or direct in _CALLABLE_HTTP_CLIENTS
        or receiver in _HTTP_RECEIVERS
    )
    if not known:
        return None

    resolved_args = [
        _resolve_local(arg, at, bindings, environ).strip().removeprefix("**").strip()
        for _, _, arg in args
    ]
    if normalized_head in _HTTP_CONSTRUCTORS:
        return "get", ""
    method = direct if direct in _READ_METHODS | _WRITE_METHODS else None
    if direct == "request" and receiver in {"http", "https"}:
        options_index = 0 if resolved_args and resolved_args[0].strip().startswith("{") else 1
        options = resolved_args[options_index] if len(resolved_args) > options_index else ""
        configured = _top_level_method(options)
        method = configured or ("get" if not options or options.strip().startswith("{") else None)
    elif direct in {"request", "stream", "open"} and resolved_args:
        configured = next(
            (method for arg in resolved_args if (method := _top_level_method(arg))),
            None,
        )
        candidate = resolved_args[0].strip(" ()'\"").lower()
        method = configured or (candidate if candidate.isalpha() else None)
    elif direct in {"fetch", "request"} and receiver in {"", "http", "https"}:
        options = resolved_args[1] if len(resolved_args) > 1 else ""
        configured = _top_level_method(options)
        method = configured or ("get" if not options or options.strip().startswith("{") else None)
    elif direct in _CALLABLE_HTTP_CLIENTS:
        options_index = 0 if resolved_args and resolved_args[0].strip().startswith("{") else 1
        options = resolved_args[options_index] if len(resolved_args) > options_index else ""
        configured = _top_level_method(options)
        method = configured or ("get" if not options or options.strip().startswith("{") else None)
    elif direct in {"urlopen", "request"} and receiver not in {"http", "https"}:
        method = "post" if re.search(r"\bdata\s*=", window) else "get"

    target_index = (
        1
        if direct in {"request", "stream", "open"}
        and receiver not in {"http", "https"}
        else 0
    )
    target = resolved_args[target_index] if target_index < len(resolved_args) else window
    for resolved in resolved_args:
        keyword = re.match(r"\s*(?:url|uri|endpoint|base_url)\s*=\s*(.*)", resolved, re.I)
        if keyword:
            target = keyword.group(1)
            break
    if (
        direct in _CALLABLE_HTTP_CLIENTS
        and resolved_args
        and resolved_args[0].strip().startswith("{")
    ):
        target = _top_level_field(
            resolved_args[0], frozenset({"url", "uri", "endpoint", "baseurl", "base_url"})
        ) or resolved_args[0]
    elif resolved_args and resolved_args[0].strip().startswith("{"):
        target = _top_level_field(
            resolved_args[0],
            frozenset({"url", "uri", "endpoint", "baseurl", "base_url"}),
        ) or target
    return method, target


def _static_executable_source(expression: str) -> str | None:
    """Decode one literal payload without evaluating it or interpolating data."""
    try:
        value = ast.literal_eval(expression)
    except (SyntaxError, ValueError):
        value = None
    if isinstance(value, str):
        return value
    if len(expression) < 2 or expression[0] != "`" or expression[-1] != "`":
        return None
    out: list[str] = []
    index = 1
    while index < len(expression) - 1:
        char = expression[index]
        if char == "$" and expression[index + 1:index + 2] == "{":
            return None
        if char != "\\":
            if char == "`":
                return None
            out.append(char)
            index += 1
            continue
        index += 1
        if index >= len(expression) - 1:
            return None
        escaped = expression[index]
        if escaped in {"x", "u"}:
            if escaped == "x":
                width = 2
                start = index + 1
                digits = expression[start:start + width]
                if len(digits) != width or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                    return None
                out.append(chr(int(digits, 16)))
                index = start + width
                continue
            braced = re.match(r"\{([0-9a-fA-F]{1,6})\}", expression[index + 1:])
            if braced:
                point = int(braced.group(1), 16)
                if point > 0x10FFFF:
                    return None
                out.append(chr(point))
                index += 1 + len(braced.group(0))
                continue
            digits = expression[index + 1:index + 5]
            if len(digits) != 4 or not re.fullmatch(r"[0-9a-fA-F]+", digits):
                return None
            out.append(chr(int(digits, 16)))
            index += 5
            continue
        simple = {
            "n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f",
            "v": "\v", "0": "\0", "\\": "\\", "'": "'", '"': '"',
            "`": "`", "$": "$",
        }
        out.append(simple.get(escaped, escaped))
        index += 1
    return "".join(out)


def _generic_http_mutation(
    text: str, environ: dict[str, str], dynamic_depth: int = 0
) -> tuple[bool, bool, list[tuple[int, int]]]:
    """Return provider mutation, any raw mutation, and recognized call spans."""
    text = _normalize_literal_members(text)
    if len(text) > MAX_PROVIDER_INLINE_SOURCE_CHARS:
        return True, True, []
    code, interpolations = _source_code(text)
    bindings = _source_bindings(text, code)
    if len(bindings) > MAX_PROVIDER_INLINE_BINDINGS:
        return True, True, []
    provider = raw = False
    chain_provider, chain_raw = _constructor_chain_mutation(text, environ)
    provider |= chain_provider
    raw |= chain_raw
    spans: list[tuple[int, int]] = []
    for match in _CALL_HEAD_RE.finditer(text):
        if not code[match.start():match.end()].strip():
            continue
        open_paren = text.find("(", match.start(), match.end())
        close = _matching_paren(text, open_paren)
        args = _argument_windows(text, open_paren + 1, close)
        call = _http_call(
            match.group(1), args, text[open_paren + 1:close], match.start(), bindings, environ
        )
        if call is None:
            continue
        spans.append((match.start(), close + 1))
        method, target = call
        provider |= _acquisition_origin_match(target)
        mutating = method is None or method not in _READ_METHODS
        raw |= mutating
        provider |= mutating and _strong_provider_match(target, environ)
    for expression in interpolations:
        nested_provider, nested_raw, _ = _generic_http_mutation(
            expression, environ, dynamic_depth
        )
        provider |= nested_provider
        raw |= nested_raw
    for match in re.finditer(r"\b(?:eval|exec)\s*\(", code):
        open_paren = text.find("(", match.start(), match.end())
        close = _matching_paren(text, open_paren)
        args = _argument_windows(text, open_paren + 1, close)
        resolved = (
            _resolve_local(args[0][2], match.start(), bindings, environ)
            if args
            else ""
        )
        payload = _static_executable_source(resolved)
        if payload is None:
            # The runtime will execute data the guard cannot inspect. Preserve
            # provider evidence when present and always fail the raw-network
            # lane closed; never evaluate the payload in the classifier.
            provider |= _strong_provider_match(f"{resolved} {text}", environ)
            raw = True
            continue
        if dynamic_depth >= 2:
            provider |= _strong_provider_match(payload, environ)
            raw = True
            continue
        nested_provider, nested_raw, _ = _generic_http_mutation(
            payload, environ, dynamic_depth + 1
        )
        provider |= nested_provider
        raw |= nested_raw
    return provider, raw, spans


def _generic_provider_mutation(text: str, environ: dict[str, str]) -> bool:
    return _generic_http_mutation(text, environ)[0]


_HTTP_ROOT_NAMES = frozenset(
    {
        "aiohttp", "axios", "got", "http", "https", "httpx", "requests",
        "superagent", "undici", "urllib", "urllib3",
    }
)
_VENDOR_ROOT_NAMES = frozenset(
    {"anthropic", "fal_client", "genai", "openai", "replicate"}
)
_INERT_PROVIDER_CONSTRUCTORS = frozenset(
    {"genai.client", "google.generativeai.generativemodel", "openai.openai"}
)


def _provider_expression_kind(
    expression: str, at: int, bindings: list[tuple[str, str, int]], depth: int = 0
) -> str | None:
    if depth >= 4:
        return "unknown"
    stripped = expression.strip().strip("()")
    required = re.fullmatch(
        rf"(?:require|__import__)\s*\(\s*['\"]({_PROVIDER_MODULE_PATTERN})['\"]\s*\)",
        expression.strip(),
    )
    if required:
        stripped = required.group(1)
    match = re.match(r"([A-Za-z_$][\w$]*)", stripped)
    if not match:
        return None
    name = match.group(1)
    entry = _binding_entry_before(name, at, bindings)
    if entry is not None:
        return _provider_expression_kind(entry[0], entry[1], bindings, depth + 1)
    if name.lower() in _HTTP_ROOT_NAMES:
        return "http"
    if name.lower() in _VENDOR_ROOT_NAMES:
        return "vendor"
    return None


def _getter_name(
    name: str, at: int, bindings: list[tuple[str, str, int]], depth: int = 0
) -> bool:
    if name == "getattr":
        return True
    if depth >= 4:
        return False
    entry = _binding_entry_before(name, at, bindings)
    return bool(entry and _getter_name(entry[0].strip(), entry[1], bindings, depth + 1))


def _provider_callable_kind(
    expression: str, at: int, bindings: list[tuple[str, str, int]], depth: int = 0
) -> str | None:
    if depth >= 4:
        return "unknown"
    stripped = expression.strip().strip("()")
    required = re.fullmatch(
        rf"require\s*\(\s*['\"]({_PROVIDER_MODULE_PATTERN})['\"]\s*\)",
        expression.strip(),
    )
    if required:
        stripped = required.group(1)
    plain = re.fullmatch(r"[A-Za-z_$][\w$]*", stripped)
    if plain:
        entry = _binding_entry_before(stripped, at, bindings)
        return _provider_callable_kind(entry[0], entry[1], bindings, depth + 1) if entry else None
    getter = re.match(
        r"([A-Za-z_$][\w$]*)\s*\(\s*"
        r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*,",
        stripped,
    )
    if getter and _getter_name(getter.group(1), at, bindings):
        return _provider_expression_kind(getter.group(2), at, bindings, depth + 1)
    dotted = re.fullmatch(r"([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*", stripped)
    if not dotted:
        return None
    parts = dotted.group(1).lower().split(".")
    if (
        ".".join(parts) in _HTTP_CONSTRUCTORS | _INERT_PROVIDER_CONSTRUCTORS
        or parts[-1] in _READ_METHODS
    ):
        return None
    return _provider_expression_kind(parts[0], at, bindings, depth + 1)


def _bounded_opaque_provider_mutation(
    text: str, environ: dict[str, str], provider_only: bool = False
) -> bool:
    text = _normalize_literal_members(text)
    if len(text) > MAX_PROVIDER_INLINE_SOURCE_CHARS:
        return True
    code, _ = _source_code(text)
    bindings = _source_bindings(text, code)
    if len(bindings) > MAX_PROVIDER_INLINE_BINDINGS:
        return True
    for match in _CALL_HEAD_RE.finditer(text):
        if not code[match.start():match.end()].strip():
            continue
        head = match.group(1).strip()
        open_paren = text.find("(", match.start(), match.end())
        close = _matching_paren(text, open_paren)
        args = _argument_windows(text, open_paren + 1, close)
        if _getter_name(head, match.start(), bindings):
            base = args[0][2] if args else ""
            member = (
                _resolve_local(args[1][2], match.start(), bindings, environ)
                .strip(" ()'\"")
                .lower()
                if len(args) > 1
                else ""
            )
            after = text[close + 1:].lstrip()
            kind = _provider_expression_kind(base, match.start(), bindings)
            tail = text[match.start():]
            boundary = re.search(r"[;\n]", tail)
            statement = tail[:boundary.start()] if boundary else tail
            if after.startswith("(") and kind and not (
                kind == "http" and member in _READ_METHODS
            ) and (
                not provider_only or kind == "vendor" or _strong_provider_match(statement, environ)
            ):
                return True
        kind = _provider_callable_kind(head, match.start(), bindings)
        if kind and (
            not provider_only or kind == "vendor" or any(
                _strong_provider_match(argument, environ) for _, _, argument in args
            )
        ):
            return True
        chained_method = "." in head or text[:match.start()].rstrip().endswith(".")
        if chained_method and head.rsplit(".", 1)[-1].lower() in _WRITE_METHODS:
            if any(_strong_provider_match(argument, environ) for _, _, argument in args):
                return True
        if not re.fullmatch(
            r"(?:print|puts|echo|console\.(?:log|error|info|warn|debug)"
            r"|sys\.(?:stdout|stderr)\.write)",
            head,
        ):
            call_window = " ".join(argument for _, _, argument in args)
            for _, _, argument in args:
                names = re.findall(
                    r"\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b",
                    argument,
                )
                for name in set(names):
                    kind = _provider_callable_kind(name, match.start(), bindings)
                    if kind and (
                        not provider_only
                        or kind == "vendor"
                        or _strong_provider_match(call_window, environ)
                    ):
                        return True
    for match in re.finditer(
        r"\bvars\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)"
        r"\s*\)\s*\[[^]]+\]\s*\(",
        text,
    ):
        kind = _provider_expression_kind(match.group(1), match.start(), bindings)
        if code[match.start():match.start() + 4].strip() and kind and (
            not provider_only or kind == "vendor" or _strong_provider_match(match.group(0), environ)
        ):
            return True
    return False


def _opaque_provider_mutation(text: str, environ: dict[str, str]) -> bool:
    """Fail closed on provider callables forwarded into unmodelled code.

    This is deliberately not callback execution analysis: recognized HTTP calls
    are removed, then any remaining provider callable plus a non-print call is
    an opaque raw-network mutation.
    """
    visible = _strip_inert_print_strings(text)
    _, _, spans = _generic_http_mutation(visible, environ)
    chars = list(visible)
    for start, end in spans:
        chars[start:end] = " " * (end - start)
    for match in _PRINT_CALL_RE.finditer(visible):
        close = _matching_paren(visible, visible.find("(", match.start()))
        chars[match.start():close + 1] = " " * (close + 1 - match.start())
    remainder = "".join(chars)
    code, expressions = _source_code(remainder)
    executable = code + " " + " ".join(expressions)
    return _bounded_opaque_provider_mutation(remainder, environ, True)


def _opaque_raw_mutation(text: str, environ: dict[str, str]) -> bool:
    visible = _strip_inert_print_strings(text)
    _, _, spans = _generic_http_mutation(visible, environ)
    chars = list(visible)
    for start, end in spans:
        chars[start:end] = " " * (end - start)
    remainder = "".join(chars)
    if re.search(r"\breplicate\.run\s*\(", _source_code(remainder)[0]):
        return False
    return _bounded_opaque_provider_mutation(remainder, environ)


def _python_gateway_semantic_mutation(command: list[str]) -> bool:
    """Detect raw calls to the engine gateway client, including import aliases.

    The gateway client is intentionally available to canonical engine tools, but
    arbitrary ``python -c`` must not turn it into a second semantic tool surface.
    Such calls bypass canonical argv validation and can submit paid work as soon
    as any project ceiling exists.
    """
    if not command or not _PYTHON_EXE_RE.fullmatch(Path(command[0]).name.lower()):
        return False
    try:
        code_index = command.index("-c")
    except ValueError:
        return False
    if code_index + 1 >= len(command):
        return False
    try:
        tree = ast.parse(command[code_index + 1])
    except (SyntaxError, ValueError):
        return False

    module_aliases: set[str] = set()
    gateway_aliases: set[str] = set()
    gateway_class_aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for imported in node.names:
                if imported.name.rsplit(".", 1)[-1] == "_gateway":
                    module_aliases.add(imported.asname or imported.name.split(".")[0])
        elif (
            isinstance(node, ast.ImportFrom)
            and (node.module or "").rsplit(".", 1)[-1] == "_gateway"
        ):
            for imported in node.names:
                if imported.name == "gateway":
                    gateway_aliases.add(imported.asname or imported.name)
                elif imported.name == "_Gateway":
                    gateway_class_aliases.add(imported.asname or imported.name)

    def imported_module_call(node: ast.AST) -> bool:
        return bool(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "__import__"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and node.args[0].value.rsplit(".", 1)[-1] == "_gateway"
        )

    def is_module(node: ast.AST) -> bool:
        return bool(
            (isinstance(node, ast.Name) and node.id in module_aliases)
            or imported_module_call(node)
        )

    def is_gateway(node: ast.AST) -> bool:
        if isinstance(node, ast.Name):
            return node.id in gateway_aliases
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "gateway"
            and is_module(node.value)
        ):
            return True
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in gateway_class_aliases:
                return True
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "_Gateway"
                and is_module(node.func.value)
            ):
                return True
            if (
                isinstance(node.func, ast.Name)
                and node.func.id == "getattr"
                and len(node.args) >= 2
                and is_module(node.args[0])
                and isinstance(node.args[1], ast.Constant)
                and node.args[1].value == "gateway"
            ):
                return True
        return False

    # Propagate simple aliases (`client = gateway`, `client = mod.gateway`).
    changed = True
    while changed:
        changed = False
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            value = node.value
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if value is not None and imported_module_call(value):
                for target in targets:
                    if isinstance(target, ast.Name) and target.id not in module_aliases:
                        module_aliases.add(target.id)
                        changed = True
            if value is not None and is_gateway(value):
                for target in targets:
                    if isinstance(target, ast.Name) and target.id not in gateway_aliases:
                        gateway_aliases.add(target.id)
                        changed = True

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and node.attr in {"run", "run_many"}
            and is_gateway(node.value)
        ):
            return True
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "getattr"
            and len(node.args) >= 2
            and is_gateway(node.args[0])
            and isinstance(node.args[1], ast.Constant)
            and node.args[1].value in {"run", "run_many"}
        ):
            return True
    return False


_PRINT_CALL_RE = re.compile(
    r"\b(?:print|puts|echo|console\.(?:log|error|info|warn|debug)"
    r"|sys\.(?:stdout|stderr)\.write)\s*\("
)


def _strip_inert_print_strings(text: str) -> str:
    """Blank the contents of string literals passed to a print/log call, so
    source text is inert while live sibling/interpolation arguments stay visible."""
    chars = list(text)
    for match in _PRINT_CALL_RE.finditer(text):
        open_paren = text.find("(", match.start())
        if open_paren == -1:
            continue
        close = _matching_paren(text, open_paren)
        for start, end, argument in _argument_windows(text, open_paren + 1, close):
            interpolated = "${" in argument or bool(
                re.search(r"\b[fF][rR]?['\"][^'\"]*\{", argument)
            )
            residual = _SOURCE_STRING_RE.sub("", argument)
            residual = re.sub(r"\b(?:sep|end)\s*=", "", residual)
            if interpolated or re.search(r"[A-Za-z_$]", residual):
                continue
            for index in range(start, end):
                chars[index] = " "
    return "".join(chars)


def _bare_method_mutation(text: str) -> bool:
    """A bare HTTP method only counts when the segment can actually speak HTTP
    (finding 4): a literal URL, or a known HTTP client binary."""
    return bool(
        _PROVIDER_HTTP_MUTATING_RE.search(text)
        and _PROVIDER_TRANSPORT_RE.search(text)
    )


_NESTED_CURL_RE = re.compile(r"\bcurl(?:ie)?\b")
_NESTED_CURL_TERMINATOR_RE = re.compile(r"[;|&)\n`]")


def _nested_curl_mutation(text: str, environ: dict[str, str]) -> bool:
    """Round 2 (f1): only a TOP-LEVEL curl reached ``_curl_mutates``. A curl
    nested in a wrapper or reader shell-out — ``find -exec curl … -d@b.json``,
    ``xargs curl --data-binary @b.json``, ``awk 'BEGIN{system("curl … -d @b.json")}'``,
    GNU ``sed -e 'e curl …'``, ``perl -e 'system("curl …")'`` — carried its
    body/mutating flags past the net. Re-extract every curl sub-invocation from
    the text (from each ``curl``/``curlie`` mention to the next shell terminator)
    and run the real curl grammar; a nested GET (``curl -sS …``) stays free."""
    for match in _NESTED_CURL_RE.finditer(text):
        rest = text[match.end() :]
        terminator = _NESTED_CURL_TERMINATOR_RE.search(rest)
        sub = rest[: terminator.start()] if terminator else rest
        if _curl_mutates(sub.split(), environ):
            return True
    return False


_HTTPIE_DATA_ITEM_RE = re.compile(r":=|@|(?<![=:])=(?!=)")


def _httpie_data_item(tokens: list[str]) -> bool:
    """An HTTPie request item that forces a body: ``k=v`` (data), ``k:=json``
    (raw JSON), ``@file`` (upload). ``k==v`` is a query param and ``k:v`` a
    header — neither forces a body, so those stay GET/free. Round 3: a URL token
    (contains ``://`` or a ``?query``) is NOT a data item — its ``=`` belongs to
    the query string."""
    for token in tokens:
        if token.startswith("-"):
            continue
        if "://" in token or "?" in token:
            continue
        if _HTTPIE_DATA_ITEM_RE.search(token):
            return True
    return False


_HTTPIE_RAW_RE = re.compile(r"(?:^|\s)--raw(?:[=\s]|$)")

# Shell syntax Bash may still rewrite in a lexed word (app#865). shlex removes
# quotes and backslash escapes but leaves expansions as written, so
# `$'--no-\151gnore-stdin'` arrives as `$--no-\151gnore-stdin`.
_HTTPIE_EXPANSION_HEAD_RE = re.compile(r"[$`{~*?\[\\]")
_HTTPIE_EXPANSION_RE = re.compile(r"[$`{}*?\[\]\\]")


def _httpie_word_may_be_flag(token: str) -> bool:
    """Whether Bash may turn this argv word into an option HTTPie/xh then parses.

    A word that STARTS with expansion syntax (`$X`, `${X:---no-ignore-stdin}`,
    `$'…'`, `$(…)`, backticks, `{a,b}`, `~`, a glob) can become any word,
    including a flag. A word that starts with `-` and still carries expansion
    syntax (`--no-ignore-stdin{,}`, `--no-ignore-std[i]n`) can become a
    different flag than it reads as. Either may be the `--no-` form of an
    exemption, so either voids it. A header or data item starts with its literal
    name, so `Authorization:Bearer $KEY` or `prompt=$P` cannot become a flag and
    keeps the exemption. Out of scope: an UNQUOTED mid-word expansion can still
    word-split into an extra word; the lexer has already dropped the quoting
    that would tell `"h:$V"` from `h:$V`.
    """
    if _HTTPIE_EXPANSION_HEAD_RE.match(token):
        return True
    return token.startswith("-") and bool(_HTTPIE_EXPANSION_RE.search(token))


def _httpie_exemption(tokens: list[str], flag: str) -> bool:
    """A free-making HTTPie flag counts only as literal argv (app#865). The lexer
    keeps comment words (commenters = ""), so a flag after the first ``#`` word
    may be comment text Bash never passes. Its ``--no-`` form voids it anywhere,
    and so does any word Bash may still expand into a flag (fail closed)."""
    comment = next(
        (index for index, token in enumerate(tokens) if token.startswith("#")),
        len(tokens),
    )
    negation = "--no-" + flag[2:]
    return flag in tokens[:comment] and not any(
        token == negation or _httpie_word_may_be_flag(token) for token in tokens
    )


def _httpie_offline(tokens: list[str]) -> bool:
    # HTTPie applies --no- options after parsing, regardless of argv order.
    return _httpie_exemption(tokens, "--offline")


def _httpie_ignores_stdin(tokens: list[str]) -> bool:
    # Any --no-ignore-stdin voids it, whatever the order: HTTPie 1.x applies it
    # before reading stdin and xh 0.26 lets the last flag win, so both send the
    # body (HTTPie 2.0-3.2.4 latch stdin first and do not). Fail closed (app#865).
    return _httpie_exemption(tokens, "--ignore-stdin")


def _httpie_mutates(tokens: list[str], piped_stdin: bool = False) -> bool:
    """Round 3: ``--offline`` makes no network call (free); ``--raw <body>`` and a
    body piped on stdin default HTTPie to POST; otherwise an explicit mutating
    method or a data item is the mutation. Round 5 (f4): ``--ignore-stdin`` means
    a redirected/piped stdin body is IGNORED — it does NOT imply POST — unless
    ``--no-ignore-stdin`` cancels it (app#865)."""
    if _httpie_offline(tokens):
        return False
    text = " ".join(tokens)
    if _HTTPIE_RAW_RE.search(text):
        return True
    if _PROVIDER_HTTP_MUTATING_RE.search(text):
        return True
    if _httpie_data_item(tokens):
        return True
    return piped_stdin and not _httpie_ignores_stdin(tokens)


def _is_provider_read_only_head(executable: str, command: list[str]) -> bool:
    """A reader head is exempt from the whole provider net — UNLESS its argv
    carries a construct that shells out. Losing the exemption is not a verdict:
    the segment still has to identify a provider and prove a mutation."""
    if executable not in PROVIDER_READ_ONLY_HEADS:
        return False
    if executable == "find" and any(
        token in _FIND_EXEC_FLAGS for token in command[1:]
    ):
        return False
    # Only awk and sed can execute text carried in their reader arguments.
    # Applying the shell-out grammar to grep/rg patterns made inert alternations
    # such as ``src|source|role`` look like a Perl ``s///e`` program. That
    # blocked ordinary source inspection and taught the agent to reshape the
    # same harmless command until the harness accepted it.
    if executable in {"awk", "sed"}:
        return not _READER_SHELL_OUT_RE.search(" ".join(command[1:]))
    return True


def _curl_flags(tokens: list[str]):
    """Yield (flag, value) pairs for curl's OWN argv grammar: `--long=value`,
    `--long value`, a glued short option (`-d@x`), a bundled cluster (`-sd@x`),
    and a separated short option (`-d @x`). Everything the old scanner missed."""
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token == "--":
            return
        if token.startswith("--"):
            name, separator, value = token.partition("=")
            if separator:
                yield name, value
            elif name in _CURL_LONG_WITH_VALUE and index < len(tokens):
                yield name, tokens[index]
                index += 1
            else:
                yield name, None
            continue
        if len(token) > 1 and token.startswith("-"):
            for position, letter in enumerate(token[1:], start=2):
                if letter not in _CURL_VALUE_SHORT_OPTIONS:
                    yield f"-{letter}", None
                    continue
                glued = token[position:]
                if glued:
                    yield f"-{letter}", glued
                elif index < len(tokens):
                    yield f"-{letter}", tokens[index]
                    index += 1
                else:
                    yield f"-{letter}", None
                break


def _curl_mutates_transfer(tokens: list[str]) -> bool:
    """One curl transfer's mutation semantics (per finding 1):

    * an explicit mutating `-X POST/PUT/PATCH/DELETE` WINS over `-G` (round 2 f2).
    * `-G`/`--get` otherwise moves the body into the query string — a GET.
    * a body flag (`-d`/`-F`/`-T`/`--json`/…) means bytes travel.
    * `-X`/`--request` is LAST-WINS; `-I`/`--head` with no body/`-X` is a HEAD.
    """
    method: str | None = None
    has_body = False
    force_get = False
    for flag, value in _curl_flags(tokens):
        if flag in _CURL_METHOD_FLAGS:
            if value:
                method = value.upper()
        elif flag in _CURL_FORCE_GET_FLAGS:
            force_get = True
        elif flag in _CURL_BODY_FLAGS:
            has_body = True
    if method is not None and method not in _CURL_READ_METHODS:
        return True
    if force_get:
        return False
    return has_body


def _curl_mutates(tokens: list[str], environ: dict[str, str]) -> bool:
    """`--next` (`-:`) starts a NEW transfer: method/body/-G/-I AND provider
    identity are transfer-local (round 4 f5). A call is paid only if SOME
    transfer both MUTATES and TARGETS a provider — so `curl -G <provider>
    --next -d@b.json <other-host>` is FREE."""
    transfers: list[list[str]] = [[]]
    for token in tokens:
        if token in {"--next", "-:"}:
            transfers.append([])
        else:
            transfers[-1].append(token)
    return any(
        _curl_mutates_transfer(transfer)
        and _provider_service_match(" ".join(transfer), environ)
        for transfer in transfers
    )


def _curl_any_mutation(tokens: list[str]) -> bool:
    """Whether any curl transfer writes/uploads, independent of destination."""
    transfers: list[list[str]] = [[]]
    for token in tokens:
        if token in {"--next", "-:"}:
            transfers.append([])
        else:
            transfers[-1].append(token)
    return any(_curl_mutates_transfer(transfer) for transfer in transfers)


_PROVIDER_CLI_NAMES = frozenset(
    {"elevenlabs", "fal", "fal-client", "openai", "replicate"}
)
_PROVIDER_CLI_ACTIONS = frozenset(
    {"create", "generate", "predict", "run", "submit"}
)
# curl-flag-compatible clients go through _curl_mutates; HTTPie clients have
# their own request-item grammar (round 2 f5a).
_CURL_HEADS = frozenset({"curl", "curlie"})
_HTTPIE_HEADS = frozenset({"http", "https", "httpie", "xh"})
# Heads that RUN their argv as a command (a nested curl after them is executed);
# find/awk/sed reach the catch-all only when they already shell out (r3).
_NESTED_CURL_LAUNCHERS = frozenset(
    {"exec", "find", "parallel", "setsid", "stdbuf", "timeout", "watch", "xargs"}
)
_DYNAMIC_EXEC_RE = re.compile(
    r"(?:execFile|execSync|spawn|subprocess|system)\b|\b(?:eval|exec)\s*\(|\.run\s*\(",
    re.IGNORECASE,
)
_SHELL_PATH_VAR_RE = re.compile(
    r"\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})"
)


class RouteReceiptError(ValueError):
    """A deterministic, user-correctable route receipt error."""


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def portable_settings_errors(path: Path) -> list[str]:
    """Return deterministic errors in the canonical split-install hook topology."""
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError) as exc:
        return [f"settings unreadable or invalid JSON: {exc}"]
    if not isinstance(settings, dict):
        return ["settings root must be an object"]

    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return ["settings hooks must be an object"]

    def command_hooks(entry: Any) -> list[dict[str, Any]]:
        if not isinstance(entry, dict):
            return []
        values = entry.get("hooks")
        if not isinstance(values, list):
            return []
        return [hook for hook in values if isinstance(hook, dict)]

    errors: list[str] = []
    for event, expected in EXPECTED_HOOK_COMMANDS.items():
        entries = hooks.get(event)
        if not isinstance(entries, list):
            errors.append(f"{event} hook list is missing")
            continue
        commands = [
            hook.get("command")
            for entry in entries
            for hook in command_hooks(entry)
        ]
        if expected not in commands:
            errors.append(f"{event} does not use the portable canonical command")

    pretool = hooks.get("PreToolUse")
    if not isinstance(pretool, list):
        pretool = []
    if not any(
        isinstance(entry, dict)
        and entry.get("matcher") == EXPECTED_PRETOOL_MATCHER
        and any(
            hook.get("command") == EXPECTED_HOOK_COMMANDS["PreToolUse"]
            for hook in command_hooks(entry)
        )
        for entry in pretool
    ):
        errors.append(
            "PreToolUse must match Bash|mcp__device__bash on the canonical guard"
        )
    return errors


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _relative_engine_path(path: Path, engine_root: Path) -> str:
    return path.relative_to(engine_root).as_posix()


def _workflow_link_target(source: Path, raw_target: str, workflows_root: Path) -> Path | None:
    target = unquote(raw_target.strip("<>").split("#", 1)[0])
    if not target or target.startswith(("http:", "https:", "mailto:", "#")):
        return None
    candidate = (source.parent / target).resolve()
    if candidate.suffix.lower() != ".md" or not candidate.is_file():
        return None
    if not _inside(candidate, workflows_root):
        return None
    return candidate


def router_reachable_workflows(engine_root: Path) -> dict[str, Path]:
    """Return every workflow markdown file reachable from the canonical router."""
    engine_root = engine_root.resolve()
    workflows_root = (engine_root / "workflows").resolve()
    router = (engine_root / ROUTER_REL).resolve()
    if not router.is_file() or not _inside(router, workflows_root):
        raise RouteReceiptError(f"canonical router missing: {router}")

    seen: set[Path] = {router}
    queue = [router]
    while queue:
        source = queue.pop(0)
        text = source.read_text(encoding="utf-8")
        for match in _MD_LINK_RE.finditer(text):
            candidate = _workflow_link_target(source, match.group(1), workflows_root)
            if candidate is not None and candidate not in seen:
                seen.add(candidate)
                queue.append(candidate)

    return {
        _relative_engine_path(path, engine_root): path
        for path in sorted(seen)
        if (
            path != router
            and path.name != "README.md"
            and not any(part.startswith("_") for part in path.relative_to(workflows_root).parts)
        )
    }


def resolve_workflow_selection(
    selections: Iterable[str], engine_root: Path
) -> list[tuple[str, Path]]:
    values = list(selections)
    if not MIN_WORKFLOWS <= len(values) <= MAX_WORKFLOWS:
        raise RouteReceiptError(
            f"select exactly {MIN_WORKFLOWS}-{MAX_WORKFLOWS} workflow documents; "
            f"received {len(values)}"
        )

    engine_root = engine_root.resolve()
    workflows_root = (engine_root / "workflows").resolve()
    reachable = router_reachable_workflows(engine_root)
    resolved: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for raw in values:
        supplied = Path(raw).expanduser()
        candidate = (
            supplied.resolve()
            if supplied.is_absolute()
            else (engine_root / supplied).resolve()
        )
        if not _inside(candidate, workflows_root):
            raise RouteReceiptError(
                f"workflow path escapes {workflows_root}: {raw}"
            )
        rel = _relative_engine_path(candidate, engine_root)
        if rel == ROUTER_REL:
            raise RouteReceiptError(
                f"{ROUTER_REL} is always loaded and does not count toward the 2-3 selections"
            )
        if rel not in reachable:
            raise RouteReceiptError(
                f"workflow is not reachable from {ROUTER_REL}: {rel}"
            )
        if rel in seen:
            raise RouteReceiptError(f"duplicate workflow selection: {rel}")
        seen.add(rel)
        resolved.append((rel, reachable[rel]))
    return resolved


def resolve_job_dir(job: str, output_root: Path, cwd: Path | None = None) -> tuple[str, Path]:
    """Resolve a top-level jobs/<id> path without allowing traversal."""
    if not job:
        raise RouteReceiptError("--job is required")
    output_root = output_root.expanduser().resolve()
    cwd = (cwd or Path.cwd()).resolve()
    raw = Path(job).expanduser()

    if raw.is_absolute():
        candidate = raw.resolve()
    elif "/" in job or os.sep in job:
        candidate = (cwd / raw).resolve()
    else:
        if not _JOB_ID_RE.fullmatch(job) or job in {".", ".."}:
            raise RouteReceiptError(f"invalid job id: {job!r}")
        candidate = (output_root / job).resolve()

    if not _inside(candidate, output_root) or candidate.parent != output_root:
        raise RouteReceiptError(
            f"job must resolve to one direct child of {output_root}: {job}"
        )
    return candidate.name, candidate


def _git_value(engine_root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(engine_root), *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _required_sha256_env(name: str, environ: dict[str, str]) -> str:
    value = environ.get(name, "").strip().lower()
    if not _SHA256_RE.fullmatch(value):
        raise RouteReceiptError(
            f"installed engine requires {name}=<64-char sha256> from the "
            "verified app/runner manifest"
        )
    return value


def engine_identity(
    engine_root: Path, environ: dict[str, str] | None = None
) -> dict[str, str]:
    """Return a verified package identity, or a content-bound source identity.

    ENGINE_VERSION.json is informative metadata, not a trust root. A runner may
    supply a verified artifact digest; a standalone host instead binds receipts
    to the installed bytes. Source sessions bind the git commit and exact
    tracked diff.
    """
    engine_root = engine_root.resolve()
    environ = dict(os.environ if environ is None else environ)
    stamp_path = engine_root / "ENGINE_VERSION.json"
    if stamp_path.is_file():
        try:
            stamp = json.loads(stamp_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise RouteReceiptError(f"invalid ENGINE_VERSION.json: {exc}") from exc
        supplied_digest = environ.get(BUILD_DIGEST_ENV, "").strip().lower()
        if supplied_digest:
            build_sha256 = _required_sha256_env(BUILD_DIGEST_ENV, environ)
            source = "verified-package"
        else:
            digest = hashlib.sha256()
            identity_paths = {
                stamp_path,
                engine_root / "pyproject.toml",
                *(engine_root / rel for rel in ENFORCEMENT_FILES.values()),
            }
            for path in sorted(path for path in identity_paths if path.is_file()):
                digest.update(path.relative_to(engine_root).as_posix().encode("utf-8"))
                digest.update(b"\0")
                digest.update(_sha256_file(path).encode("ascii"))
                digest.update(b"\0")
            build_sha256 = digest.hexdigest()
            source = "installed-package"
        return {
            "source": source,
            "buildSha256": build_sha256,
            "version": str(stamp.get("version", "unknown")),
            "gitSha": str(stamp.get("gitSha", "unknown")),
            "gitBranch": str(stamp.get("gitBranch", "unknown")),
            "gitDirty": str(stamp.get("gitDirty", "unknown")),
        }

    version = "unknown-dev"
    pyproject = engine_root / "pyproject.toml"
    if pyproject.is_file():
        match = re.search(
            r'(?m)^version\s*=\s*"([^"]+)"',
            pyproject.read_text(encoding="utf-8"),
        )
        if match:
            version = f"{match.group(1)}-dev"
    dirty = _git_value(engine_root, "status", "--porcelain", "--untracked-files=no")
    diff = _git_value(engine_root, "diff", "--no-ext-diff", "--binary", "HEAD")
    return {
        "source": "source-tree",
        "buildSha256": _sha256_text(
            f"{_git_value(engine_root, 'rev-parse', 'HEAD')}\0{diff}"
        ),
        "version": version,
        "gitSha": _git_value(engine_root, "rev-parse", "HEAD"),
        "gitBranch": _git_value(engine_root, "rev-parse", "--abbrev-ref", "HEAD"),
        "gitDirty": "dirty" if dirty else "clean",
    }


def production_context_identity(
    engine_root: Path, environ: dict[str, str] | None = None
) -> dict[str, Any]:
    """Hash the effective production instructions and current context epoch.

    A runner may attest the exact law/preflight/settings bytes it made effective
    and rotate an opaque context epoch. A standalone host has no runner
    manifest, so it binds the context to the installed bytes instead. Strict
    desktop verdicts separately require runner attestation before execution.
    """
    engine_root = engine_root.resolve()
    environ = dict(os.environ if environ is None else environ)
    settings_errors = portable_settings_errors(
        engine_root / ENFORCEMENT_FILES["settings"]
    )
    if settings_errors:
        raise RouteReceiptError(
            "invalid canonical .claude/settings.json: "
            + "; ".join(settings_errors)
        )
    files: dict[str, dict[str, str]] = {}
    for role, rel in ENFORCEMENT_FILES.items():
        path = engine_root / rel
        if not path.is_file():
            raise RouteReceiptError(f"production context file missing: {rel}")
        files[role] = {"path": rel, "sha256": _sha256_file(path)}

    installed = (engine_root / "ENGINE_VERSION.json").is_file()
    epoch = environ.get(CONTEXT_EPOCH_ENV, "").strip()
    if not epoch:
        epoch = (
            f"standalone-installed:{engine_identity(engine_root, environ)['buildSha256']}"
            if installed
            else "source-dev-unscoped"
        )

    for role, env_name in EFFECTIVE_HASH_ENVS.items():
        supplied = environ.get(env_name, "").strip().lower()
        if installed and supplied:
            supplied = _required_sha256_env(env_name, environ)
        if supplied and supplied != files[role]["sha256"]:
            raise RouteReceiptError(
                f"{env_name} does not match shipped {files[role]['path']}"
            )

    return {
        "schema": CONTEXT_SCHEMA,
        "epochSha256": _sha256_text(epoch),
        "files": files,
    }


def build_receipt(
    job_id: str,
    selections: list[tuple[str, Path]],
    engine_root: Path,
    receipt_version: int = 1,
    environ: dict[str, str] | None = None,
) -> dict[str, Any]:
    router = engine_root.resolve() / ROUTER_REL
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "receipt_version": receipt_version,
        "phase": "routed",
        "job_id": job_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "router": {
            "path": ROUTER_REL,
            "sha256": _sha256_file(router),
        },
        "selected": [
            {"path": rel, "sha256": _sha256_file(path)}
            for rel, path in selections
        ],
        "engine": engine_identity(engine_root, environ),
        "context": production_context_identity(engine_root, environ),
    }
    return receipt


def _canonical_json_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _history_entry(
    receipt: dict[str, Any],
    version: int,
    previous_entry_sha256: str | None,
    auto_route: dict[str, str] | None = None,
) -> dict[str, Any]:
    entry = {
        "schema": RECEIPT_HISTORY_SCHEMA,
        "version": version,
        "created_at": receipt.get("created_at"),
        "previous_entry_sha256": previous_entry_sha256,
        "receipt_sha256": _canonical_json_sha256(receipt),
        "receipt": receipt,
    }
    # Provenance for a route the guard recorded without the agent. It lives in
    # the hash-chained journal entry, not the receipt, so the v8 receipt shape
    # every host validates is unchanged and older readers ignore it.
    if auto_route is not None:
        entry["auto_route"] = dict(auto_route)
    return entry


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = ", ".join(sorted(expected - actual)) or "none"
        unknown = ", ".join(sorted(actual - expected)) or "none"
        raise RouteReceiptError(
            f"{label} has invalid keys (missing: {missing}; unknown: {unknown})"
        )


def _validate_prejournal_receipt(
    receipt: Any,
    expected_job_id: str,
    *,
    label: str,
) -> dict[str, Any]:
    """Validate an exact pre-journal v5/v6 receipt before preserving its bytes.

    The bridge is intentionally narrower than the current receipt parser. A
    legacy genesis has no version/phase keys, and every other byte must match a
    shape the v5 builder could have emitted. Historical identities need not be
    current, but their schemas, paths, digests, and internal hashes must be
    self-consistent.
    """
    if not isinstance(receipt, dict):
        raise RouteReceiptError(f"{label}: root must be an object")
    base_keys = {
        "schema",
        "job_id",
        "created_at",
        "router",
        "selected",
        "engine",
        "context",
    }
    expected_keys = base_keys | ({"plan"} if "plan" in receipt else set())
    _require_exact_keys(receipt, expected_keys, label)
    if "receipt_version" in receipt or "phase" in receipt:
        raise RouteReceiptError(f"{label}: snapshot is not a pre-journal receipt")
    schema = receipt.get("schema")
    if schema not in _PREJOURNAL_PLAN_KEYS_BY_SCHEMA:
        raise RouteReceiptError(f"{label}: unsupported receipt schema")
    if receipt.get("job_id") != expected_job_id:
        raise RouteReceiptError(
            f"{label}: receipt belongs to {receipt.get('job_id')!r}, "
            f"not {expected_job_id!r}"
        )
    created_at = receipt.get("created_at")
    if not isinstance(created_at, str) or not _RECEIPT_CREATED_AT_RE.fullmatch(
        created_at
    ):
        raise RouteReceiptError(f"{label}: created_at is invalid")
    try:
        parsed_created_at = datetime.fromisoformat(created_at)
    except (TypeError, ValueError) as exc:
        raise RouteReceiptError(f"{label}: created_at is invalid") from exc
    if (
        parsed_created_at.tzinfo is None
        or parsed_created_at.utcoffset() is None
        or parsed_created_at.utcoffset().total_seconds() != 0
    ):
        raise RouteReceiptError(f"{label}: created_at must use UTC")

    router = receipt.get("router")
    if not isinstance(router, dict):
        raise RouteReceiptError(f"{label}: router must be an object")
    _require_exact_keys(router, {"path", "sha256"}, f"{label}.router")
    if router.get("path") != ROUTER_REL or not _SHA256_RE.fullmatch(
        str(router.get("sha256", ""))
    ):
        raise RouteReceiptError(f"{label}: router identity is invalid")

    selected = receipt.get("selected")
    if (
        not isinstance(selected, list)
        or not MIN_WORKFLOWS <= len(selected) <= MAX_WORKFLOWS
    ):
        raise RouteReceiptError(f"{label}: selected workflows are invalid")
    selected_paths: list[str] = []
    for index, item in enumerate(selected):
        item_label = f"{label}.selected[{index}]"
        if not isinstance(item, dict):
            raise RouteReceiptError(f"{item_label} must be an object")
        _require_exact_keys(item, {"path", "sha256"}, item_label)
        path = item.get("path")
        if (
            not isinstance(path, str)
            or not path.startswith("workflows/")
            or path == ROUTER_REL
            or Path(path).is_absolute()
            or any(part in {"", ".", ".."} for part in Path(path).parts)
            or not _SHA256_RE.fullmatch(str(item.get("sha256", "")))
        ):
            raise RouteReceiptError(f"{item_label} identity is invalid")
        selected_paths.append(path)
    if len(set(selected_paths)) != len(selected_paths):
        raise RouteReceiptError(f"{label}: selected workflows are duplicated")

    engine = receipt.get("engine")
    engine_keys = {
        "source",
        "buildSha256",
        "version",
        "gitSha",
        "gitBranch",
        "gitDirty",
    }
    if not isinstance(engine, dict):
        raise RouteReceiptError(f"{label}: engine must be an object")
    _require_exact_keys(engine, engine_keys, f"{label}.engine")
    if (
        engine.get("source") not in {
            "verified-package",
            "installed-package",
            "source-tree",
        }
        or not _SHA256_RE.fullmatch(str(engine.get("buildSha256", "")))
        or any(
            not isinstance(engine.get(key), str) or not engine[key]
            for key in ("version", "gitSha", "gitBranch", "gitDirty")
        )
    ):
        raise RouteReceiptError(f"{label}: engine identity is invalid")

    context = receipt.get("context")
    if not isinstance(context, dict):
        raise RouteReceiptError(f"{label}: context must be an object")
    _require_exact_keys(
        context,
        {"schema", "epochSha256", "files"},
        f"{label}.context",
    )
    files = context.get("files")
    expected_enforcement_files = (
        ENFORCEMENT_FILES
        if schema == LEGACY_RECEIPT_SCHEMA
        else _V6_ENFORCEMENT_FILES
    )
    if (
        context.get("schema") != CONTEXT_SCHEMA
        or not _SHA256_RE.fullmatch(str(context.get("epochSha256", "")))
        or not isinstance(files, dict)
        or set(files) != set(expected_enforcement_files)
    ):
        raise RouteReceiptError(f"{label}: context identity is invalid")
    for role, expected_path in expected_enforcement_files.items():
        item = files[role]
        item_label = f"{label}.context.files.{role}"
        if not isinstance(item, dict):
            raise RouteReceiptError(f"{item_label} must be an object")
        _require_exact_keys(item, {"path", "sha256"}, item_label)
        if item.get("path") != expected_path or not _SHA256_RE.fullmatch(
            str(item.get("sha256", ""))
        ):
            raise RouteReceiptError(f"{item_label} identity is invalid")

    if "plan" not in receipt:
        return receipt
    plan = receipt["plan"]
    if not isinstance(plan, dict):
        raise RouteReceiptError(f"{label}: plan must be an object")
    # Validate the historical byte shape only. In particular, none of the
    # legacy financial-looking fields is consulted as permission to execute.
    expected_plan_keys = set(_PREJOURNAL_PLAN_KEYS_BY_SCHEMA[schema])
    _require_exact_keys(plan, expected_plan_keys, f"{label}.plan")
    if (
        plan.get("path") != PLAN_NAME
        or not _SHA256_RE.fullmatch(str(plan.get("sha256", "")))
        or not isinstance(plan.get("decisionSource"), str)
        or not plan["decisionSource"]
        or plan.get("qaRequired") is not True
        or not isinstance(plan.get("budgetCents"), int)
        or not isinstance(plan.get("projectedSpend"), dict)
        or not _SHA256_RE.fullmatch(str(plan.get("projectedSpendSha256", "")))
    ):
        raise RouteReceiptError(f"{label}: legacy plan identity is invalid")
    if _canonical_json_sha256(plan["projectedSpend"]) != plan["projectedSpendSha256"]:
        raise RouteReceiptError(f"{label}: legacy projected spend hash is inconsistent")
    return receipt


def _validate_journal_receipt(
    receipt: Any,
    expected_job_id: str,
    *,
    label: str,
) -> dict[str, Any]:
    """Validate exact v6/v7/v8 journal-aware receipt byte shapes.

    Historical plans are validated only as historical integrity data. Their
    approval-looking fields never authorize current execution.
    """
    if not isinstance(receipt, dict):
        raise RouteReceiptError(f"{label}: root must be an object")
    schema = receipt.get("schema")
    if schema not in {
        "videoclaw.route-receipt/v6",
        "videoclaw.route-receipt/v7",
        RECEIPT_SCHEMA,
    }:
        raise RouteReceiptError(f"{label}: unsupported journal receipt schema")
    has_plan = "plan" in receipt
    base_keys = {
        "schema",
        "receipt_version",
        "phase",
        "job_id",
        "created_at",
        "router",
        "selected",
        "engine",
        "context",
    }
    _require_exact_keys(receipt, base_keys | ({"plan"} if has_plan else set()), label)
    version = receipt.get("receipt_version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise RouteReceiptError(f"{label}: receipt_version is invalid")
    phase = receipt.get("phase")
    if schema == RECEIPT_SCHEMA:
        if phase != "routed" or has_plan:
            raise RouteReceiptError(
                f"{label}: v8 must be routed and contain no plan state"
            )
    elif phase not in {"routed", "locked"} or has_plan != (phase == "locked"):
        raise RouteReceiptError(
            f"{label}: historical phase and plan presence are inconsistent"
        )
    if receipt.get("job_id") != expected_job_id:
        raise RouteReceiptError(
            f"{label}: receipt belongs to {receipt.get('job_id')!r}, "
            f"not {expected_job_id!r}"
        )
    created_at = receipt.get("created_at")
    if not isinstance(created_at, str) or not _RECEIPT_CREATED_AT_RE.fullmatch(
        created_at
    ):
        raise RouteReceiptError(f"{label}: created_at is invalid")
    try:
        parsed_created_at = datetime.fromisoformat(created_at)
    except (TypeError, ValueError) as exc:
        raise RouteReceiptError(f"{label}: created_at is invalid") from exc
    if (
        parsed_created_at.tzinfo is None
        or parsed_created_at.utcoffset() is None
        or parsed_created_at.utcoffset().total_seconds() != 0
    ):
        raise RouteReceiptError(f"{label}: created_at must use UTC")

    router = receipt.get("router")
    if not isinstance(router, dict):
        raise RouteReceiptError(f"{label}: router must be an object")
    _require_exact_keys(router, {"path", "sha256"}, f"{label}.router")
    if router.get("path") != ROUTER_REL or not _SHA256_RE.fullmatch(
        str(router.get("sha256", ""))
    ):
        raise RouteReceiptError(f"{label}: router identity is invalid")

    selected = receipt.get("selected")
    if not isinstance(selected, list) or not MIN_WORKFLOWS <= len(selected) <= MAX_WORKFLOWS:
        raise RouteReceiptError(f"{label}: selected workflows are invalid")
    selected_paths: list[str] = []
    for index, item in enumerate(selected):
        item_label = f"{label}.selected[{index}]"
        if not isinstance(item, dict):
            raise RouteReceiptError(f"{item_label} must be an object")
        _require_exact_keys(item, {"path", "sha256"}, item_label)
        path = item.get("path")
        if (
            not isinstance(path, str)
            or not path.startswith("workflows/")
            or path == ROUTER_REL
            or Path(path).is_absolute()
            or any(part in {"", ".", ".."} for part in Path(path).parts)
            or not _SHA256_RE.fullmatch(str(item.get("sha256", "")))
        ):
            raise RouteReceiptError(f"{item_label} identity is invalid")
        selected_paths.append(path)
    if len(set(selected_paths)) != len(selected_paths):
        raise RouteReceiptError(f"{label}: selected workflows are duplicated")

    engine = receipt.get("engine")
    engine_keys = {
        "source",
        "buildSha256",
        "version",
        "gitSha",
        "gitBranch",
        "gitDirty",
    }
    if not isinstance(engine, dict):
        raise RouteReceiptError(f"{label}: engine must be an object")
    _require_exact_keys(engine, engine_keys, f"{label}.engine")
    if (
        engine.get("source") not in {
            "verified-package",
            "installed-package",
            "source-tree",
        }
        or not _SHA256_RE.fullmatch(str(engine.get("buildSha256", "")))
        or any(
            not isinstance(engine.get(key), str) or not engine[key]
            for key in ("version", "gitSha", "gitBranch", "gitDirty")
        )
    ):
        raise RouteReceiptError(f"{label}: engine identity is invalid")

    context = receipt.get("context")
    if not isinstance(context, dict):
        raise RouteReceiptError(f"{label}: context must be an object")
    _require_exact_keys(context, {"schema", "epochSha256", "files"}, f"{label}.context")
    expected_files = (
        ENFORCEMENT_FILES if schema == RECEIPT_SCHEMA else _V6_ENFORCEMENT_FILES
    )
    files = context.get("files")
    if (
        context.get("schema") != CONTEXT_SCHEMA
        or not _SHA256_RE.fullmatch(str(context.get("epochSha256", "")))
        or not isinstance(files, dict)
        or set(files) != set(expected_files)
    ):
        raise RouteReceiptError(f"{label}: context identity is invalid")
    for role, expected_path in expected_files.items():
        item = files[role]
        item_label = f"{label}.context.files.{role}"
        if not isinstance(item, dict):
            raise RouteReceiptError(f"{item_label} must be an object")
        _require_exact_keys(item, {"path", "sha256"}, item_label)
        if item.get("path") != expected_path or not _SHA256_RE.fullmatch(
            str(item.get("sha256", ""))
        ):
            raise RouteReceiptError(f"{item_label} identity is invalid")

    if not has_plan:
        return receipt
    plan = receipt["plan"]
    if not isinstance(plan, dict):
        raise RouteReceiptError(f"{label}.plan must be an object")
    expected_plan_keys = set(_JOURNAL_PLAN_KEYS_BY_SCHEMA[schema])
    _require_exact_keys(plan, expected_plan_keys, f"{label}.plan")
    if (
        plan.get("path") != PLAN_NAME
        or not _SHA256_RE.fullmatch(str(plan.get("sha256", "")))
        or not isinstance(plan.get("decisionSource"), str)
        or not plan["decisionSource"]
        or plan.get("qaRequired") is not True
    ):
        raise RouteReceiptError(f"{label}: historical plan identity is invalid")
    if schema == "videoclaw.route-receipt/v7":
        if not _SHA256_RE.fullmatch(str(plan.get("creativeRundownSha256", ""))):
            raise RouteReceiptError(f"{label}: v7 creative rundown identity is invalid")
        return receipt

    projected = plan.get("projectedSpend")
    if not isinstance(projected, dict):
        raise RouteReceiptError(f"{label}: v6 projected spend must be an object")
    _require_exact_keys(
        projected,
        {"schema", "budgetCents", "plannedCents", "reserveCents", "summary", "items"},
        f"{label}.plan.projectedSpend",
    )
    if (
        projected.get("schema") != "videoclaw.spend-plan/v2"
        or any(
            isinstance(projected.get(key), bool)
            or not isinstance(projected.get(key), int)
            or projected[key] < 0
            for key in ("budgetCents", "plannedCents", "reserveCents")
        )
        or projected["plannedCents"] + projected["reserveCents"]
        != projected["budgetCents"]
        or not isinstance(projected.get("summary"), str)
        or not projected["summary"].strip()
        or not isinstance(projected.get("items"), list)
        or plan.get("budgetCents") != projected["budgetCents"]
        or plan.get("projectedSpendSha256") != _canonical_json_sha256(projected)
    ):
        raise RouteReceiptError(f"{label}: v6 projected spend identity is invalid")
    for index, item in enumerate(projected["items"]):
        item_label = f"{label}.plan.projectedSpend.items[{index}]"
        if not isinstance(item, dict):
            raise RouteReceiptError(f"{item_label} must be an object")
        allowed_item_keys = {"kind", "label", "count", "subtotalCents", "prompts"}
        if "quote" in item:
            allowed_item_keys.add("quote")
        _require_exact_keys(item, allowed_item_keys, item_label)
        if (
            not isinstance(item.get("kind"), str)
            or not item["kind"]
            or not isinstance(item.get("label"), str)
            or not item["label"].strip()
            or isinstance(item.get("count"), bool)
            or not isinstance(item.get("count"), int)
            or item["count"] < 1
            or isinstance(item.get("subtotalCents"), bool)
            or not isinstance(item.get("subtotalCents"), int)
            or item["subtotalCents"] < 0
            or not isinstance(item.get("prompts"), list)
            or any(not isinstance(prompt, str) for prompt in item["prompts"])
        ):
            raise RouteReceiptError(f"{item_label} is invalid")
        quote = item.get("quote")
        if quote is not None:
            if not isinstance(quote, dict) or "tool" not in quote:
                raise RouteReceiptError(f"{item_label}.quote is invalid")
            quote_keys = {
                "tool",
                "role",
                "model",
                "resolvedModel",
                "quality",
                "resolution",
                "plannedMillis",
            }
            if not set(quote).issubset(quote_keys) or any(
                not isinstance(value, (str, int)) or isinstance(value, bool)
                for value in quote.values()
            ):
                raise RouteReceiptError(f"{item_label}.quote is invalid")
    app_approval = plan.get("appApproval")
    if app_approval is not None:
        if not isinstance(app_approval, dict):
            raise RouteReceiptError(f"{label}.plan.appApproval is invalid")
        _require_exact_keys(
            app_approval, {"id", "planSha256"}, f"{label}.plan.appApproval"
        )
        if (
            not isinstance(app_approval.get("id"), str)
            or not app_approval["id"]
            or not _SHA256_RE.fullmatch(str(app_approval.get("planSha256", "")))
        ):
            raise RouteReceiptError(f"{label}.plan.appApproval is invalid")
    approval_receipt = plan.get("approvalReceipt")
    if approval_receipt is not None:
        if not isinstance(approval_receipt, dict):
            raise RouteReceiptError(f"{label}.plan.approvalReceipt is invalid")
        _require_exact_keys(
            approval_receipt,
            {"schema", "file", "sha256"},
            f"{label}.plan.approvalReceipt",
        )
        if (
            not isinstance(approval_receipt.get("schema"), str)
            or not isinstance(approval_receipt.get("file"), str)
            or not _SHA256_RE.fullmatch(str(approval_receipt.get("sha256", "")))
        ):
            raise RouteReceiptError(f"{label}.plan.approvalReceipt is invalid")
    creative = plan.get("creativeConfirmation")
    if not isinstance(creative, dict):
        raise RouteReceiptError(f"{label}.plan.creativeConfirmation is invalid")
    _require_exact_keys(
        creative,
        {"rundownSha256", "receiptSha256"},
        f"{label}.plan.creativeConfirmation",
    )
    if any(
        not _SHA256_RE.fullmatch(str(creative.get(key, "")))
        for key in ("rundownSha256", "receiptSha256")
    ):
        raise RouteReceiptError(f"{label}.plan.creativeConfirmation is invalid")
    return receipt


def _is_incomplete_json_prefix(raw: bytes) -> bool:
    """Return true only when ``raw`` can be identified as a torn JSON prefix."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        return exc.end == len(raw)
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        # A crash can stop at EOF while a value/delimiter is pending, or in the
        # middle of a string. Syntax failures earlier in the record are not
        # distinguishable from corruption and therefore remain fail-closed.
        return exc.pos >= len(text.rstrip()) or exc.msg.startswith(
            "Unterminated string"
        )
    return False


def _truncate_torn_history_tail(path: Path, expected_size: int, keep_bytes: int) -> None:
    flags = os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != expected_size:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} changed while recovering its trailing record"
            )
        os.ftruncate(fd, keep_bytes)
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read_receipt_history(
    job_dir: Path,
    *,
    recover_torn_tail: bool = False,
    tolerate_torn_tail: bool = False,
) -> list[dict[str, Any]]:
    """Read and verify the append-only route receipt journal.

    The current receipt remains a small compatibility snapshot for the app and
    hook. This journal is the truthful chronology: every bootstrap re-emission
    gets its own immutable, monotonically numbered entry.

    ``tolerate_torn_tail`` verifies the complete records that
    ``recover_torn_tail`` would keep, without truncating anything.
    """
    path = job_dir / RECEIPT_HISTORY_NAME
    if not path.exists():
        return []
    if not stat.S_ISREG(path.lstat().st_mode):
        raise RouteReceiptError(f"{RECEIPT_HISTORY_NAME} must be a regular file")
    raw = path.read_bytes()
    if not raw:
        return []
    records = raw.split(b"\n")
    if raw.endswith(b"\n"):
        records.pop()
    elif raw:
        trailing = records[-1]
        if (recover_torn_tail or tolerate_torn_tail) and _is_incomplete_json_prefix(
            trailing
        ):
            if recover_torn_tail:
                keep_bytes = len(raw) - len(trailing)
                _truncate_torn_history_tail(path, len(raw), keep_bytes)
            records.pop()
        else:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} has an incomplete or unterminated trailing entry"
            )

    entries: list[dict[str, Any]] = []
    previous_sha256: str | None = None
    for line_number, raw_line in enumerate(records, start=1):
        if not raw_line.strip():
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} contains a blank entry at line {line_number}"
            )
        try:
            entry = json.loads(raw_line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} is invalid JSON"
            ) from exc
        if not isinstance(entry, dict):
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} must be an object"
            )
        version = len(entries) + 1
        receipt = entry.get("receipt")
        if (
            entry.get("schema") != RECEIPT_HISTORY_SCHEMA
            or entry.get("version") != version
            or entry.get("previous_entry_sha256") != previous_sha256
            or not isinstance(receipt, dict)
            or entry.get("created_at") != receipt.get("created_at")
            or entry.get("receipt_sha256") != _canonical_json_sha256(receipt)
        ):
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} is inconsistent"
            )
        if receipt.get("schema") not in SUPPORTED_RECEIPT_SCHEMAS:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} has an unsupported "
                "receipt schema"
            )
        if receipt.get("job_id") != job_dir.name:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} belongs to "
                f"{receipt.get('job_id')!r}, not {job_dir.name!r}"
            )
        prejournal_genesis = version == 1 and "receipt_version" not in receipt
        if receipt.get("schema") == LEGACY_RECEIPT_SCHEMA and not prejournal_genesis:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} uses the legacy "
                "schema outside the preserved genesis entry"
            )
        if prejournal_genesis:
            _validate_prejournal_receipt(
                receipt,
                job_dir.name,
                label=f"{RECEIPT_HISTORY_NAME} line {line_number} legacy receipt",
            )
            receipt_version = None
        else:
            _validate_journal_receipt(
                receipt,
                job_dir.name,
                label=f"{RECEIPT_HISTORY_NAME} line {line_number} receipt",
            )
            receipt_version = receipt.get("receipt_version")
        if receipt_version is None and version != 1:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} is missing its receipt version"
            )
        if version == 1 and "receipt_version" in receipt and receipt_version is None:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} has a null receipt version"
            )
        if receipt_version is not None and receipt_version != version:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} has the wrong receipt version"
            )
        if receipt_version is not None and receipt.get("phase") not in {
            "routed",
            "locked",
        }:
            raise RouteReceiptError(
                f"{RECEIPT_HISTORY_NAME} line {line_number} has an invalid phase"
            )
        entries.append(entry)
        previous_sha256 = _canonical_json_sha256(entry)
    return entries


@contextmanager
def _job_receipt_lock(job_dir: Path) -> Iterable[None]:
    """Serialize every receipt version choice, journal append, and snapshot swap."""
    job_dir.mkdir(parents=True, exist_ok=True)
    lock_path = job_dir / RECEIPT_LOCK_NAME
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(lock_path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RouteReceiptError(f"{RECEIPT_LOCK_NAME} must be a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def _append_history_line(path: Path, entry: dict[str, Any]) -> None:
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RouteReceiptError(f"{RECEIPT_HISTORY_NAME} must be a regular file")
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            fd = -1
            stream.write(
                json.dumps(
                    entry,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
                + "\n"
            )
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if fd >= 0:
            os.close(fd)
    # The first append may also create the journal name. Persist that directory
    # entry before a current snapshot can claim the version exists.
    _fsync_directory(path.parent)


def _append_history_entry(
    job_dir: Path,
    receipt: dict[str, Any],
    entries: list[dict[str, Any]] | None = None,
    auto_route: dict[str, str] | None = None,
) -> None:
    history_path = job_dir / RECEIPT_HISTORY_NAME
    if entries is None:
        entries = read_receipt_history(job_dir)
    current_path = job_dir / RECEIPT_NAME

    # One-time upgrade bridge: preserve the current-schema snapshot that predates
    # the journal as version 1 before adding the first journal-aware receipt.
    if not entries and current_path.is_file():
        try:
            legacy = json.loads(current_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RouteReceiptError(
                f"cannot preserve legacy {RECEIPT_NAME}: invalid JSON"
            ) from exc
        expected_job_id = receipt.get("job_id")
        if (
            receipt.get("schema") != RECEIPT_SCHEMA
            or expected_job_id != job_dir.name
        ):
            raise RouteReceiptError(
                f"cannot preserve legacy {RECEIPT_NAME}: destination receipt "
                "identity is inconsistent"
            )
        _validate_prejournal_receipt(
            legacy,
            expected_job_id,
            label=f"cannot preserve legacy {RECEIPT_NAME}",
        )
        legacy_entry = _history_entry(legacy, 1, None)
        _append_history_line(history_path, legacy_entry)
        entries = [legacy_entry]

    expected_version = len(entries) + 1
    if receipt.get("receipt_version") != expected_version:
        raise RouteReceiptError(
            f"route receipt version changed concurrently; expected {expected_version}"
        )
    previous_sha256 = _canonical_json_sha256(entries[-1]) if entries else None
    entry = _history_entry(receipt, expected_version, previous_sha256, auto_route)
    _append_history_line(history_path, entry)


def write_receipt_atomic(
    receipt: dict[str, Any],
    job_dir: Path,
    history: list[dict[str, Any]] | None = None,
    auto_route: dict[str, str] | None = None,
) -> Path:
    destination = job_dir / RECEIPT_NAME
    _append_history_entry(job_dir, receipt, history, auto_route)
    fd, temp_name = tempfile.mkstemp(prefix=f".{RECEIPT_NAME}.", dir=job_dir)
    temp_path = Path(temp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(receipt, f, indent=2, sort_keys=True)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, destination)
        _fsync_directory(job_dir)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            temp_path.unlink()
        except OSError:
            pass
        raise
    return destination


def emit_reading_set(
    engine_root: Path,
    selections: list[tuple[str, Path]],
    stream: Any = sys.stdout,
) -> None:
    documents = [(ROUTER_REL, engine_root.resolve() / ROUTER_REL), *selections]
    print(
        "VIDEOCLAW PRODUCTION ROUTE — the following canonical documents are "
        "the current production context.",
        file=stream,
    )
    for rel, path in documents:
        digest = _sha256_file(path)
        print(f"\n<videoclaw-route-document path=\"{rel}\" sha256=\"{digest}\">", file=stream)
        print(path.read_text(encoding="utf-8"), file=stream)
        print("</videoclaw-route-document>", file=stream)
    stream.flush()


def validate_receipt(
    job: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    environ: dict[str, str] | None = None,
) -> tuple[bool, str]:
    try:
        environ = dict(os.environ if environ is None else environ)
        job_id, job_dir = resolve_job_dir(job, output_root, cwd)
        receipt_path = job_dir / RECEIPT_NAME
        if not receipt_path.is_file():
            return False, (
                f"no {RECEIPT_NAME} for {job_id}; run prepare_production with "
                "the router-selected 2-3 workflow documents first"
            )
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        _validate_journal_receipt(
            receipt,
            job_id,
            label=f"{job_id}: current route receipt",
        )
        if receipt.get("schema") != RECEIPT_SCHEMA:
            return False, f"{job_id}: unsupported or missing receipt schema"
        if receipt.get("job_id") != job_id:
            return False, (
                f"{job_id}: receipt belongs to {receipt.get('job_id')!r}, not this job"
            )
        history = read_receipt_history(job_dir)
        if not history:
            return False, f"{job_id}: route receipt history is missing"
        if history[-1].get("receipt") != receipt:
            return False, f"{job_id}: current route receipt is not the latest history entry"
        if receipt.get("receipt_version") != history[-1].get("version"):
            return False, f"{job_id}: current route receipt version is inconsistent"
        if receipt.get("phase") != "routed":
            return False, f"{job_id}: current route receipt phase is inconsistent"

        selected = receipt.get("selected")
        if not isinstance(selected, list) or not MIN_WORKFLOWS <= len(selected) <= MAX_WORKFLOWS:
            return False, f"{job_id}: receipt must contain 2-3 selected workflows"
        paths = [item.get("path") for item in selected if isinstance(item, dict)]
        if len(paths) != len(selected) or len(set(paths)) != len(paths):
            return False, f"{job_id}: receipt selected workflows are malformed or duplicated"

        reachable = router_reachable_workflows(engine_root)
        router = receipt.get("router")
        if not isinstance(router, dict) or router.get("path") != ROUTER_REL:
            return False, f"{job_id}: receipt router metadata is malformed"
        current_router_hash = _sha256_file(engine_root.resolve() / ROUTER_REL)
        if router.get("sha256") != current_router_hash:
            return False, f"{job_id}: route receipt is stale; {ROUTER_REL} changed"

        for item in selected:
            rel = item["path"]
            if rel not in reachable:
                return False, (
                    f"{job_id}: selected workflow is no longer router-reachable: {rel}"
                )
            if item.get("sha256") != _sha256_file(reachable[rel]):
                return False, f"{job_id}: route receipt is stale; {rel} changed"

        current_context = production_context_identity(engine_root, environ)
        receipt_context = receipt.get("context")
        if (
            not isinstance(receipt_context, dict)
            or receipt_context.get("files") != current_context.get("files")
        ):
            return False, (
                f"{job_id}: route receipt is stale; effective production context changed"
            )

        # A route receipt records which advisory workflow documents the agent
        # read. It is not execution authority. Follow-up turns legitimately get
        # a new context epoch, and an app update can install a byte-identical set
        # of routed documents under a new engine identity. Requiring those
        # incidental identities to match made otherwise valid paid calls fail,
        # forcing the agent to fight the harness by rerunning
        # prepare_production. The selected/router hashes above are the facts that
        # matter for advisory provenance. The effective file hashes above still
        # make a real producer-law or settings change stale; only the opaque
        # epoch is ignored. Strict execution identity is freshly attested by
        # current_receipt_facts() and the desktop immediately before execution.
        # The app separately enforces compaction restoration, job ownership, its
        # host-owned spending boundary, tool restrictions, and QA.
        if "plan" in receipt:
            return False, f"{job_id}: current route receipt must not contain plan state"
        return True, f"{job_id}: current advisory {RECEIPT_SCHEMA} receipt"
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        return False, f"invalid route receipt: {exc}"


def current_receipt_facts(
    job: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    environ: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Return host-comparison facts from one currently valid route receipt.

    These values are deliberately not a spending-authorization decision. The
    engine proves only bootstrap route and execution-context integrity; the host
    and gateway independently decide whether paid work may proceed.
    """
    environ = dict(os.environ if environ is None else environ)
    job_id, job_dir = resolve_job_dir(job, output_root, cwd)
    valid, reason = validate_receipt(
        job_id,
        engine_root,
        output_root,
        cwd,
        environ,
    )
    if not valid:
        raise RouteReceiptError(reason)

    receipt_path = job_dir / RECEIPT_NAME
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    current_engine = engine_identity(engine_root, environ)
    current_context = production_context_identity(engine_root, environ)
    facts = {
        "jobId": job_id,
        "receiptIdentity": {
            "schema": receipt["schema"],
            "receiptSha256": _sha256_file(receipt_path),
            "engineBuildSha256": current_engine["buildSha256"],
            "engineIdentitySha256": _canonical_json_sha256(current_engine),
            "contextEpochSha256": current_context["epochSha256"],
            "contextIdentitySha256": _canonical_json_sha256(current_context),
        },
    }

    # Close the validator-to-facts race inside this process. The desktop still
    # invokes this immediately before execution, but it never receives a tuple
    # assembled from bytes that changed after validation.
    still_valid, still_reason = validate_receipt(
        job_id,
        engine_root,
        output_root,
        cwd,
        environ,
    )
    if (
        not still_valid
        or facts["receiptIdentity"]["receiptSha256"]
        != _sha256_file(receipt_path)
    ):
        raise RouteReceiptError(
            still_reason
            if not still_valid
            else f"{job_id}: route receipt changed while producing verdict"
        )
    return facts


def _auto_route_refusal(job_id: str, environ: dict[str, str]) -> str | None:
    """Return why the guard may not route ``job_id`` itself, or None.

    Containment is unchanged: a hosted session may auto-route only the job its
    host bound to it. A host that has bound no job yet (it exports a context
    epoch but no bound job) keeps the pre-existing refusal, and the host's own
    job-ownership check still applies to every call either way.
    """
    bound = environ.get(BOUND_JOB_ENV, "").strip()
    if bound:
        return None if bound == job_id else (
            f"{job_id} is not this session's job; this session owns {bound}, "
            f"so use --job {bound} (or its jobs/{bound}/ paths)"
        )
    if environ.get(CONTEXT_EPOCH_ENV, "").strip():
        return "the host has not bound a job to this session"
    return None


def _auto_route_selection(
    engine_root: Path,
    previous: dict[str, Any] | None,
) -> list[tuple[str, Path]]:
    """Choose the documents an automatic route records, deterministically."""
    reachable = router_reachable_workflows(engine_root)
    selected = previous.get("selected") if isinstance(previous, dict) else None
    if isinstance(selected, list):
        paths = [
            item.get("path")
            for item in selected
            if isinstance(item, dict) and isinstance(item.get("path"), str)
        ]
        if (
            len(paths) == len(selected)
            and MIN_WORKFLOWS <= len(paths) <= MAX_WORKFLOWS
            and len(set(paths)) == len(paths)
            and all(path in reachable for path in paths)
        ):
            return [(path, reachable[path]) for path in paths]
    if all(path in reachable for path in DEFAULT_AUTO_ROUTE):
        return [(path, reachable[path]) for path in DEFAULT_AUTO_ROUTE]
    fallback = sorted(reachable)[:MIN_WORKFLOWS]
    if len(fallback) < MIN_WORKFLOWS:
        raise RouteReceiptError(
            f"{ROUTER_REL} links fewer than {MIN_WORKFLOWS} workflow documents"
        )
    return [(path, reachable[path]) for path in fallback]


def record_automatic_route(
    job: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    environ: dict[str, str] | None = None,
    *,
    trigger: str,
) -> Path | None:
    """Record a current route for ``job`` exactly as prepare() would, silently.

    Returns the receipt path when a new version was written, or None when the
    route was already current (another guard or a prepare_production call won
    the job lock first). Uses the same lock, journal, recovery and atomic
    snapshot as prepare(); anything prepare() would refuse (a corrupt journal,
    a receipt copied from another job) still raises here. The journal entry
    records that the guard wrote it and which action triggered it.
    """
    environ = dict(os.environ if environ is None else environ)
    job_id, job_dir = resolve_job_dir(job, output_root, cwd)
    # Authorize the directory that will actually be written, not the name the
    # caller checked: a job folder swapped for a link to another job resolves
    # elsewhere and must not be routed on this session's behalf.
    if _JOB_ID_RE.fullmatch(job) and job_id != job:
        raise RouteReceiptError(f"jobs/{job} resolves to another job folder ({job_id})")
    refusal = _auto_route_refusal(job_id, environ)
    if refusal is not None:
        raise RouteReceiptError(refusal)
    # Fail on a broken router before creating the job folder or its lock.
    if len(router_reachable_workflows(engine_root)) < MIN_WORKFLOWS:
        raise RouteReceiptError(
            f"{ROUTER_REL} links fewer than {MIN_WORKFLOWS} workflow documents"
        )
    with _job_receipt_lock(job_dir):
        if resolve_job_dir(job_id, output_root, cwd) != (job_id, job_dir):
            raise RouteReceiptError(f"jobs/{job_id} changed while recording its route")
        valid, _ = validate_receipt(job_id, engine_root, output_root, cwd, environ)
        if valid:
            return None
        current_path = job_dir / RECEIPT_NAME
        had_receipt = current_path.is_file()
        history = read_receipt_history(job_dir, recover_torn_tail=True)
        next_version = len(history) + 1
        previous: Any = history[-1].get("receipt") if history else None
        if not history and had_receipt:
            # prepare()'s upgrade bridge: the pre-journal snapshot becomes
            # version 1 and must validate as such inside the write below.
            next_version = 2
            try:
                previous = json.loads(current_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                previous = None
        selections = _auto_route_selection(engine_root, previous)
        receipt = build_receipt(
            job_id,
            selections,
            engine_root,
            receipt_version=next_version,
            environ=environ,
        )
        return write_receipt_atomic(
            receipt,
            job_dir,
            history,
            auto_route={
                "trigger": trigger,
                "reason": "not_current" if had_receipt else "missing",
            },
        )


def ensure_current_route(
    job: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    environ: dict[str, str] | None = None,
    *,
    trigger: str,
) -> tuple[bool, str]:
    """Validate the job's route and record one automatically when it may.

    This replaces "run prepare_production, then retry" for the job this
    session owns. The route receipt stays advisory provenance; spending,
    containment and host job ownership are decided elsewhere and unchanged.
    """
    environ = dict(os.environ if environ is None else environ)
    current, reason, job_id = route_precheck(
        job, engine_root, output_root, cwd, environ
    )
    if current:
        return True, reason
    if job_id is None:
        return False, reason
    try:
        record_automatic_route(
            job_id,
            engine_root,
            output_root,
            cwd,
            environ,
            trigger=trigger,
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        return False, f"{reason}; the route could not be recorded automatically: {exc}"
    return validate_receipt(job_id, engine_root, output_root, cwd, environ)


def route_precheck(
    job: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None,
    environ: dict[str, str],
) -> tuple[bool, str, str | None]:
    """Decide, without writing, whether ``job`` has or may get a current route.

    Returns ``(current, reason, job_id)``: ``current`` when the route is
    already valid; otherwise ``job_id`` is the resolved job the guard may route
    itself, or None with ``reason`` explaining the refusal. Callers check
    every job in a command before routing any, so a refused call records none.
    """
    valid, reason = validate_receipt(job, engine_root, output_root, cwd, environ)
    if valid:
        return True, reason, None
    try:
        job_id, job_dir = resolve_job_dir(job, output_root, cwd)
    except (OSError, ValueError):
        return False, reason, None
    refusal = _auto_route_refusal(job_id, environ)
    if refusal is not None:
        # An unbound host session keeps the original advice: prepare_production
        # is how such a session names (and the app then binds) its job.
        return False, (
            reason if environ.get(BOUND_JOB_ENV, "").strip() == "" else refusal
        ), None
    blocked = _unrecoverable_route_state(job_id, job_dir)
    if blocked is not None:
        return False, (
            f"{reason}; the route could not be recorded automatically: {blocked}"
        ), None
    return False, reason, job_id


def _unrecoverable_route_state(job_id: str, job_dir: Path) -> str | None:
    """Why prepare()'s writer would refuse this job's journal, or None.

    A torn final record is recoverable (the writer truncates it under the job
    lock); any other journal damage, or a pre-journal snapshot the upgrade
    bridge cannot preserve, is not. Checked before any job is routed.
    """
    try:
        history = read_receipt_history(job_dir, tolerate_torn_tail=True)
    except (OSError, ValueError) as exc:
        return str(exc)
    current_path = job_dir / RECEIPT_NAME
    if not history and current_path.is_file():
        try:
            _validate_prejournal_receipt(
                json.loads(current_path.read_text(encoding="utf-8")),
                job_id,
                label=f"cannot preserve legacy {RECEIPT_NAME}",
            )
        except (OSError, UnicodeError, ValueError) as exc:
            return str(exc)
    return None


def _shell_segments(command: str) -> tuple[list[list[str]], list[str]]:
    segments, operators, _ = _shell_segments_with_gaps(command)
    return segments, operators


def _shell_segments_with_gaps(
    command: str,
) -> tuple[list[list[str]], list[str], list[list[str]]]:
    """Like ``_shell_segments`` but also returns ``gap_ops[i]`` — the operator
    token(s) between segment i and i+1 — so pipeline scope is known (round 2
    fd4: consent for a provider curl rides ``… | jq > jobs/<id>/out.json``)."""
    # shlex treats bare newlines as ordinary whitespace, while every supported
    # shell treats them as statement separators (unless the previous operator
    # explicitly continues the command). Without this normalization,
    # `cd ...\nuv run ... tools/mint_video.py` became one argv headed by `cd`,
    # hiding the canonical invocation and triggering the unresolved-launcher
    # guard. Preserve quoted newlines and pipeline/boolean continuations.
    normalized: list[str] = []
    quote: str | None = None
    i = 0
    while i < len(command):
        char = command[i]
        if quote is not None:
            normalized.append(char)
            if char == "\\" and quote == '"' and i + 1 < len(command):
                normalized.append(command[i + 1])
                i += 2
                continue
            if char == quote:
                quote = None
            i += 1
            continue
        if char in {"'", '"'}:
            quote = char
            normalized.append(char)
            i += 1
            continue
        if char == "\\" and i + 1 < len(command) and command[i + 1] in "\r\n":
            # Explicit shell line continuation: neither a token nor a command
            # boundary. Collapse CRLF as one continuation too.
            i += 2
            if i < len(command) and command[i - 1] == "\r" and command[i] == "\n":
                i += 1
            normalized.append(" ")
            continue
        if char in "\r\n":
            previous = "".join(normalized).rstrip()
            # A newline directly after |, || or && continues that compound
            # command; every other bare newline is a real statement boundary.
            if previous.endswith(("|", "||", "&&")):
                normalized.append(" ")
            else:
                normalized.append(" ; ")
            i += 1
            if char == "\r" and i < len(command) and command[i] == "\n":
                i += 1
            continue
        normalized.append(char)
        i += 1

    lexer = shlex.shlex(
        "".join(normalized), posix=True, punctuation_chars=";&|()<>"
    )
    lexer.whitespace_split = True
    lexer.commenters = ""
    segments: list[list[str]] = []
    operators: list[str] = []
    gap_ops: list[list[str]] = []
    pending: list[str] = []
    current: list[str] = []
    for token in lexer:
        if token and all(char in ";&|()<>" for char in token):
            if current:
                if segments:
                    gap_ops.append(pending)
                    pending = []
                segments.append(current)
                current = []
            operators.append(token)
            pending.append(token)
        else:
            current.append(token)
    if current:
        if segments:
            gap_ops.append(pending)
        segments.append(current)
    return segments, operators, gap_ops


_PIPELINE_BREAK_OPS = frozenset({";", "&", "&&", "||", "(", ")"})


def _gap_breaks_pipeline(ops: list[str]) -> bool:
    """A gap breaks the pipeline at a STATEMENT separator only. `&>`/`>&`
    (redirect both streams) and `|&` (pipe stdout+stderr) are single shlex tokens
    and are INTRA-pipeline, so a consented `curl … &> jobs/<id>/out.json` and
    `curl … |& jq > jobs/<id>/out.json` bind (round 3). Exact-token membership,
    matching the app's now-merged operator tokens."""
    return any(op in _PIPELINE_BREAK_OPS for op in ops)


def _gap_redirects(ops: list[str]) -> bool:
    return any(">" in op for op in ops)


# `>|` (clobber) is a redirect too, so the tail walk continues past it.
_REDIRECT_OP_RE = re.compile(r"[<>&]*[<>][<>&]*|>\|")


def _segment_stdin_and_tail(
    segments: list[list[str]],
    gap_ops: list[list[str]],
    index: int,
) -> tuple[bool, list[str]]:
    """Stdin and trailing argv of segment ``index`` as Bash runs it.

    A body on stdin makes HTTPie POST: piped from the PREVIOUS segment
    (`echo '{}' | http api…`, r3) or redirected by a FOLLOWING gap
    (`http api… < body.json`, round 4 f8). Bash applies every redirect after a
    command to that command, but each one ends a segment here, so
    `xh url > out.json < body.json --no-ignore-stdin` arrives as `[xh, url]`,
    `[out.json]`, `[body.json, --no-ignore-stdin]`. Walk that redirect chain for
    its stdin and for the argv words after each target (app#865).
    """
    stdin = (
        0 < index <= len(gap_ops)
        and any(op in {"|", "|&"} for op in gap_ops[index - 1])
    ) or (index < len(gap_ops) and any("<" in op for op in gap_ops[index]))
    tail: list[str] = []
    for position in range(index, min(len(gap_ops), len(segments) - 1)):
        ops = gap_ops[position]
        if not ops or not all(_REDIRECT_OP_RE.fullmatch(op) for op in ops):
            break
        stdin = stdin or any("<" in op for op in ops)
        tail.extend(segments[position + 1][1:])
    return stdin, tail


def _pipeline_redirect_jobs(
    segments: list[list[str]],
    gap_ops: list[list[str]],
    jobs_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> list[set[str]]:
    """Redirect-target jobs by segment index, scoped to each PIPELINE (round 2
    fd4). A `>`/`>>` gap makes the next segment a redirect target; its job is
    shared by every segment in the same pipeline, so a jobless provider curl
    piped into `jobs/<id>/…` binds to <id>. A statement separator ends the
    pipeline, so `curl provider … ; echo > jobs/x/y` never cross-binds."""
    by_segment: list[set[str]] = [set() for _ in segments]

    def flush(start: int, end: int) -> None:
        jobs: set[str] = set()
        for index in range(start + 1, end):
            if not _gap_redirects(gap_ops[index - 1]):
                continue
            target = segments[index][0] if segments[index] else None
            if not target:
                continue
            try:
                job = _job_from_output_path(target, jobs_root, cwd, environ)
            except RouteReceiptError:
                continue
            if job:
                jobs.add(job)
        for index in range(start, end):
            by_segment[index] |= jobs

    start = 0
    for index in range(1, len(segments)):
        if _gap_breaks_pipeline(gap_ops[index - 1]):
            flush(start, index)
            start = index
    flush(start, len(segments))
    return by_segment


def _redirects_into_jobs(
    segments: list[list[str]],
    gap_ops: list[list[str]],
    jobs_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> bool:
    """True when any redirect in the command may land inside the jobs folder.

    File-descriptor duplication (``2>&1``) is not a write. A target that names
    a variable or command substitution, or a relative target after a ``cd``
    this parser does not follow, cannot be placed and counts as inside.
    """
    changes_dir = any(
        (_strip_command_prefix(tokens) or [""])[0] == "cd" for tokens in segments
    )
    jobs_root = jobs_root.resolve()
    for index in range(1, len(segments)):
        ops = gap_ops[index - 1] if index - 1 < len(gap_ops) else []
        if not _gap_redirects(ops):
            continue
        target = segments[index][0] if segments[index] else ""
        if any(">&" in op for op in ops) and target.isdigit():
            continue
        # A variable can be reassigned earlier in the same command, so its
        # hook-time value proves nothing about where Bash will write.
        if "$" in target or "`" in target:
            return True
        path = Path(target).expanduser()
        if not path.is_absolute():
            if changes_dir:
                return True
            path = cwd / path
        if _inside(path.resolve(), jobs_root):
            return True
    return False


_PYTHON_EXE_RE = re.compile(r"^python(?:\d+(?:\.\d+)*)?$")
_PYTHON_OPTIONS_WITH_VALUE = frozenset({"-X", "-W", "-Q"})
_TIME_OPTIONS_WITH_VALUE = frozenset({"-f", "--format", "-o", "--output"})
_TIMEOUT_OPTIONS_WITH_VALUE = frozenset(
    {"-k", "--kill-after", "-s", "--signal"}
)
_UV_RUN_OPTIONS_WITH_VALUE = frozenset(
    {
        "--directory",
        "--env-file",
        "--index",
        "--index-url",
        "--project",
        "--python",
        "--python-platform",
        "--resolution",
        "--with",
        "--with-editable",
        "--with-requirements",
    }
)


def _strip_command_prefix(tokens: list[str]) -> list[str]:
    # Wrappers nest in ANY order (`nice env VAR=x python …`,
    # `nohup nice -n 5 env A=1 python …`), so a single fixed-order pass leaves
    # a wrapper head behind and the leftover extracts no tool — which used to
    # aggregate to a zero-action read_only/free verdict for a paid command.
    # Re-run the pass until it stops consuming tokens (each pass strictly
    # shortens the list, so this terminates).
    remaining = list(tokens)
    while True:
        before = list(remaining)
        remaining = _strip_command_prefix_once(remaining)
        if remaining == before:
            return remaining


def _strip_command_prefix_once(tokens: list[str]) -> list[str]:
    remaining = list(tokens)
    while remaining and remaining[0] in {"{", "}"}:
        remaining.pop(0)
    while remaining and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", remaining[0]):
        remaining.pop(0)
    if remaining and remaining[0] == "env":
        remaining.pop(0)
        while remaining:
            token = remaining[0]
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token):
                remaining.pop(0)
                continue
            if token in {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}:
                remaining = remaining[2:] if len(remaining) >= 2 else []
                continue
            if token.startswith("-"):
                remaining.pop(0)
                continue
            break
    if remaining and remaining[0] == "command":
        remaining.pop(0)
        while remaining and remaining[0].startswith("-"):
            remaining.pop(0)
    if remaining and Path(remaining[0]).name == "time":
        remaining.pop(0)
        while remaining and remaining[0].startswith("-"):
            option = remaining.pop(0)
            if option in _TIME_OPTIONS_WITH_VALUE and remaining:
                remaining.pop(0)
    if remaining and Path(remaining[0]).name in {"timeout", "gtimeout"}:
        remaining.pop(0)
        while remaining and remaining[0].startswith("-"):
            option = remaining.pop(0)
            name = option.split("=", 1)[0]
            if (
                name in _TIMEOUT_OPTIONS_WITH_VALUE
                and "=" not in option
                and remaining
            ):
                remaining.pop(0)
        if remaining:
            # GNU timeout's first positional is the duration; the rest is the
            # command. Validation remains on the resolved command beneath it.
            remaining.pop(0)
    if remaining and Path(remaining[0]).name == "nohup":
        remaining.pop(0)
    if remaining and Path(remaining[0]).name == "nice":
        remaining.pop(0)
        if remaining and remaining[0] in {"-n", "--adjustment"}:
            remaining = remaining[2:] if len(remaining) >= 2 else []
        elif remaining and re.fullmatch(r"-\d+", remaining[0]):
            remaining.pop(0)
    return remaining


def _python_tool(tokens: list[str]) -> tuple[str | None, list[str]]:
    """Classify a Python command without executing or guessing its code."""
    tail = list(tokens[1:])
    while tail:
        token = tail[0]
        if token == "--":
            tail.pop(0)
            break
        if token == "-m":
            if len(tail) < 2:
                return None, []
            module = tail[1]
            name = module.rsplit(".", 1)[-1]
            if re.fullmatch(r"[a-z_][a-z0-9_]*", name):
                return name, tail[2:]
            return None, []
        if token == "-c":
            return None, []
        if token in _PYTHON_OPTIONS_WITH_VALUE:
            tail = tail[2:] if len(tail) >= 2 else []
            continue
        if (
            token.startswith("-X")
            or token.startswith("-W")
            or token.startswith("-Q")
        ):
            tail.pop(0)
            continue
        if token.startswith("-"):
            tail.pop(0)
            continue
        break
    if not tail:
        return None, []
    match = _TOOL_PATH_RE.search(tail[0])
    return (match.group(1), tail[1:]) if match else (None, [])


def _skip_uv_run_options(tokens: list[str]) -> list[str]:
    remaining = list(tokens)
    while remaining:
        token = remaining[0]
        if token == "--":
            return remaining[1:]
        name = token.split("=", 1)[0]
        if name in _UV_RUN_OPTIONS_WITH_VALUE and "=" not in token:
            remaining = remaining[2:] if len(remaining) >= 2 else []
            continue
        if token.startswith("-"):
            remaining.pop(0)
            continue
        return remaining
    return []


def _script_invocation(tokens: list[str]) -> tuple[str | None, list[str]]:
    """Return canonical tool name and its argv for supported launch shapes."""
    tokens = _strip_command_prefix(tokens)
    if not tokens:
        return None, []

    executable = Path(tokens[0]).name
    if executable == "uv":
        try:
            run_index = tokens.index("run")
        except ValueError:
            return None, []
        tail = _skip_uv_run_options(tokens[run_index + 1 :])
        if not tail:
            return None, []
        if _PYTHON_EXE_RE.fullmatch(Path(tail[0]).name):
            return _python_tool(tail)
        match = _TOOL_PATH_RE.search(tail[0])
        return (match.group(1), tail[1:]) if match else (None, [])
    if _PYTHON_EXE_RE.fullmatch(executable):
        return _python_tool(tokens)
    match = _TOOL_PATH_RE.search(tokens[0])
    return (match.group(1), tokens[1:]) if match else (None, [])


def _script_tool(tokens: list[str]) -> str | None:
    """Compatibility helper retained for callers that only need the tool name."""
    return _script_invocation(tokens)[0]


def _arg_value(tokens: list[str], flag: str) -> str | None:
    value: str | None = None
    for index, token in enumerate(tokens):
        if token == flag and index + 1 < len(tokens):
            value = tokens[index + 1]
        elif token.startswith(f"{flag}="):
            value = token.split("=", 1)[1]
    # argparse follows the last repeated scalar flag; mirror it so a later
    # --job/--mode cannot execute against a value other than the one validated.
    return value


def _canonical_output_path_error(
    tool: str,
    tokens: list[str],
    job_id: str,
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> str | None:
    """Require explicit canonical outputs to stay in the action's job.

    Tool implementations differ on whether a relative `--output` is cwd-,
    workspace-, or job-relative. The job-integrity invariant does not: a
    production action for job A may never write job B or the installed engine.
    Bare relative paths are interpreted job-relative; `jobs/...` remains the
    explicit workspace spelling.
    """
    job_root = (output_root / job_id).resolve()
    for flag in _CANONICAL_OUTPUT_FLAGS:
        raw = _arg_value(tokens, flag)
        if not raw or raw == "-":
            continue
        expanded = _expand_shell_path(raw, environ)
        if expanded is None:
            return f"{tool}: {flag} contains an unresolved shell variable"
        path = Path(expanded).expanduser()
        if path.is_absolute():
            resolved = path.resolve()
        elif path.parts[:1] == (output_root.name,):
            resolved = (output_root.parent / path).resolve()
        else:
            resolved = (job_root / path).resolve()
        if not _inside(resolved, job_root):
            return (
                f"{tool}: {flag} must stay inside jobs/{job_id}; "
                f"got {raw!r}"
            )
    return None


def _positional_mode(tokens: list[str]) -> str | None:
    for token in tokens:
        if token == "--":
            continue
        if token.startswith("-"):
            continue
        return token
    return None


def _is_protected_invocation(tool: str, tokens: list[str]) -> bool:
    if tool not in PROTECTED_TOOLS:
        return False
    # argparse help exits before a tool can write media or call a provider.
    # Requiring a production job merely to inspect flags adds no safety.
    if any(token in {"-h", "--help"} for token in tokens):
        return False
    mode = _arg_value(tokens, "--mode")
    if tool == "lipsync_footage" and mode is None:
        mode = _positional_mode(tokens)
    if mode and mode in READ_ONLY_MODES.get(tool, frozenset()):
        return False
    if tool == "lipsync_footage" and mode in {
        "plan",
        "face-envelope",
        "motion-envelope",
    }:
        return False
    if tool == "build_character_sheet" and "--dry-run" in tokens:
        return False
    if tool == "clean_audio" and "--transcribe-only" in tokens:
        return False
    if tool == "assemble" and "--check" in tokens and "--declare" not in tokens:
        return False
    return True


_SHELL_VAR_RE = re.compile(
    r"^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$"
)


def _resolve_shell_value(value: str | None, environ: dict[str, str]) -> str | None:
    if value is None:
        return None
    match = _SHELL_VAR_RE.fullmatch(value)
    if not match:
        return value
    return environ.get(match.group(1) or match.group(2))


def _pinned_session_env_mutation(tokens: list[str]) -> str | None:
    """Return the pinned variable an agent attempts to assign or unset."""
    remaining = list(tokens)
    while remaining:
        while remaining and remaining[0] in {"{", "}"}:
            remaining.pop(0)
        for token in remaining:
            assignment = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=.*", token)
            if assignment and assignment.group(1) in PINNED_SESSION_ENV:
                return assignment.group(1)
            # Leading shell assignments end at the executable. Do not treat an
            # arbitrary later `NAME=value` data argument as shell mutation.
            if not assignment:
                break
        raw_executable = Path(remaining[0]).name.lower() if remaining else ""
        if raw_executable == "env":
            if any(
                token in {"-i", "--ignore-environment"}
                for token in remaining[1:]
            ):
                return "<entire environment>"
            for index, token in enumerate(remaining[1:], start=1):
                if token.startswith("--unset="):
                    name = token.split("=", 1)[1]
                    if name in PINNED_SESSION_ENV:
                        return name
                if token in {"-u", "--unset"} and index + 1 < len(remaining):
                    name = remaining[index + 1]
                    if name in PINNED_SESSION_ENV:
                        return name
                assignment = re.fullmatch(
                    r"([A-Za-z_][A-Za-z0-9_]*)=.*",
                    token,
                )
                if assignment and assignment.group(1) in PINNED_SESSION_ENV:
                    return assignment.group(1)
        peeled = _strip_command_prefix_once(remaining)
        if peeled == remaining:
            break
        remaining = peeled
    command = remaining
    if not command:
        return None
    executable = Path(command[0]).name.lower()
    if executable in {"unset", "unsetenv"}:
        for token in command[1:]:
            name = token.split("=", 1)[0]
            if name in PINNED_SESSION_ENV:
                return name
    if executable in {"export", "readonly", "typeset", "declare", "setenv"}:
        for token in command[1:]:
            if token.startswith("-"):
                continue
            name = token.split("=", 1)[0]
            if name in PINNED_SESSION_ENV:
                return name
    return None


def _resolved_shell_segments(
    segments: list[list[str]],
    environ: dict[str, str],
) -> list[tuple[list[str], dict[str, str]]]:
    """Resolve argv with the shell assignments visible in this one tool call.

    The verdict is the app's structured shell IR, so it must describe what Bash
    will execute rather than hand the app raw `$J` tokens to reinterpret. A
    standalone assignment (`J=job-a; ... --job "$J"`) persists to later
    segments in the same Bash call; an assignment prefix on an executable is
    command-local. We deliberately stop at ordinary variable substitution:
    command substitution, sourced scripts, and executable indirection remain
    unsupported and fail closed elsewhere.
    """
    persistent = dict(environ)
    resolved: list[tuple[list[str], dict[str, str]]] = []
    for tokens in segments:
        effective = list(tokens)
        segment_environ = dict(persistent)
        assignments: dict[str, str] = {}
        while effective and re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*=.*",
            effective[0],
        ):
            name, value = effective.pop(0).split("=", 1)
            expanded = _expand_shell_path(value, segment_environ)
            if expanded is not None:
                assignments[name] = expanded
                segment_environ[name] = expanded
        if not effective:
            persistent.update(assignments)
        effective = [
            _expand_shell_path(token, segment_environ) or token
            for token in effective
        ]
        resolved.append((effective, segment_environ))
    return resolved


_EMBEDDED_VAR_RE = re.compile(
    r"\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})"
)


def _expand_provider_refs(value: str, environ: dict[str, str]) -> str:
    """Expand EMBEDDED ``$VAR`` references (``"$G/v1/gen/image"``, ``"Bearer $K"``)
    but ONLY when the variable holds a provider/credential SIGNAL. Round 2 (f4):
    ``G=$VIDEOCLAW_GATEWAY; curl "$G/v1/…" -H "Authorization: Bearer $K"`` with
    ``K=$VIDEOCLAW_API_KEY`` used to escape — ``$G``/``$K`` were never expanded in
    a mid-token position, so no host or credential atom saw them. Non-provider
    variables (``$HOME``, an ffmpeg alias) are left untouched."""

    def replace(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2)
        resolved = environ.get(name)
        if resolved is not None and _PROVIDER_SERVICE_RE.search(resolved):
            return resolved
        return match.group(0)

    return _EMBEDDED_VAR_RE.sub(replace, value)


_ENV_REF_RE = re.compile(
    r"""(?:os\.environ\.get|os\.getenv)\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']"""
    r"""|os\.environ\s*\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]"""
    r"""|process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]"""
    r"""|process\.env\.([A-Za-z_][A-Za-z0-9_]*)"""
)


def _expand_env_refs(text: str, environ: dict[str, str]) -> str:
    """Round 3 (fd3 regression): a same-command assignment reached through a
    language env accessor — ``OPENAI_BASE_URL=https://api.openai.com python -c
    "… requests.post(os.environ['OPENAI_BASE_URL']+'/v1/…')"`` — was invisible.
    Substitute ``os.environ['…']`` / ``os.getenv(…)`` / ``process.env.…`` refs
    with the assigned value when it holds a provider SIGNAL (same rule as the f4
    ``$VAR`` expansion). Non-provider vars are left untouched."""

    def replace(match: re.Match[str]) -> str:
        name = next((g for g in match.groups() if g is not None), None)
        resolved = environ.get(name) if name else None
        # Round 4 (f4): a variable holding the CONFIGURED gateway origin (our own
        # money) is a provider signal too, not only the static service atoms.
        if resolved is not None and (
            _PROVIDER_SERVICE_RE.search(resolved)
            or _configured_gateway_match(resolved, environ)
        ):
            return resolved
        return match.group(0)

    return _ENV_REF_RE.sub(replace, text)


def _wrapper_env_assignments(tokens: list[str]) -> dict[str, str]:
    """Round 4 (f1): the ``env VAR=val cmd`` wrapper's assignments are consumed by
    ``_strip_command_prefix`` and were then lost. Collect leading bare ``VAR=val``
    AND ``env``-wrapper ``VAR=val`` so they feed env-ref resolution."""
    out: dict[str, str] = {}
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in {"{", "}"}:
            i += 1
            continue
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token):
            name, value = token.split("=", 1)
            out[name] = value
            i += 1
            continue
        if Path(token).name == "env":
            i += 1
            while i < len(tokens):
                arg = tokens[i]
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", arg):
                    name, value = arg.split("=", 1)
                    out[name] = value
                    i += 1
                    continue
                if arg in {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}:
                    i += 2
                    continue
                if arg.startswith("-"):
                    i += 1
                    continue
                break
            continue
        break
    return out


def _expand_shell_path(value: str, environ: dict[str, str]) -> str | None:
    unresolved = False

    def replace(match: re.Match[str]) -> str:
        nonlocal unresolved
        name = match.group(1) or match.group(2)
        replacement = environ.get(name)
        if replacement is None:
            unresolved = True
            return match.group(0)
        return replacement

    expanded = _SHELL_PATH_VAR_RE.sub(replace, value)
    return None if unresolved else expanded


def _job_from_output_path(
    token: str,
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> str | None:
    raw = token.split("=", 1)[1] if token.startswith("--output=") else token
    if (
        not raw
        or raw == "-"
        or raw.startswith(("http://", "https://", "pipe:", "data:"))
    ):
        return None
    expanded = _expand_shell_path(raw, environ)
    if expanded is None:
        if "jobs/" in raw or "/jobs/" in raw:
            raise RouteReceiptError(
                f"job output path contains an unresolved shell variable: {raw}"
            )
        return None
    path = Path(expanded).expanduser()
    candidates = [path.resolve()] if path.is_absolute() else [
        (cwd / path).resolve(),
        (output_root.parent / path).resolve(),
    ]
    for candidate in candidates:
        if not _inside(candidate, output_root):
            continue
        relative = candidate.relative_to(output_root)
        if not relative.parts:
            continue
        job_id = relative.parts[0]
        if _JOB_ID_RE.fullmatch(job_id) and job_id not in {".", ".."}:
            return job_id
    return None


def _mentioned_job_ids(text: str, environ: dict[str, str]) -> set[str]:
    expanded = _expand_shell_path(text, environ)
    if expanded is None:
        expanded = text
    return set(
        re.findall(
            r"(?<![A-Za-z0-9._-])jobs/"
            r"([A-Za-z0-9][A-Za-z0-9._-]*)(?:/|$)",
            expanded,
        )
    )


def _ffmpeg_output_jobs(
    tokens: list[str],
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> set[str]:
    command = _strip_command_prefix(tokens)
    if not command or Path(command[0]).name != "ffmpeg":
        return set()
    jobs: set[str] = set()
    skip_path = False
    for token in command[1:]:
        if skip_path:
            skip_path = False
            continue
        if token in _FFMPEG_INPUT_PATH_OPTIONS:
            skip_path = True
            continue
        job = _job_from_output_path(token, output_root, cwd, environ)
        if job:
            jobs.add(job)
    return jobs


def _remotion_output_jobs(
    tokens: list[str],
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
) -> set[str]:
    command = _strip_command_prefix(tokens)
    if not command or Path(command[0]).name not in {"npx", "bunx", "pnpm", "npm"}:
        return set()
    names = [Path(token).name for token in command]
    try:
        remotion_index = names.index("remotion")
    except ValueError:
        return set()
    mode_index = next(
        (
            index
            for index in range(remotion_index + 1, len(command))
            if command[index] in {"render", "still"}
        ),
        None,
    )
    if mode_index is None:
        return set()
    jobs: set[str] = set()
    for token in command[mode_index + 1 :]:
        raw = token.split("=", 1)[1] if token.startswith("--output=") else token
        if not token.startswith("--output=") and Path(raw).suffix.lower() not in (
            _MEDIA_OUTPUT_SUFFIXES
        ):
            continue
        job = _job_from_output_path(token, output_root, cwd, environ)
        if job:
            jobs.add(job)
    return jobs


def _is_mutating_provider_invocation(
    tokens: list[str],
    environ: dict[str, str] | None = None,
    piped_stdin: bool = False,
) -> bool:
    """Does this segment reach a paid provider in a way that can SPEND?

    Issue #204: the pre-fix gate was one host list AND one vendor-verb list, so a
    paid call escaped whenever either side missed. It now asks three questions in
    order: (1) is the head a pure reader — if so, stop, the provider text is data;
    (2) is a provider identified — by host, by gateway credential, by the
    configured gateway URL, or by a host-free vendor SDK call shape; (3) is the
    invocation mutating — per-client for curl and the vendor CLIs, and for
    everything else a vendor verb, a generic HTTP client, or a bare HTTP method.
    """
    environ = environ or {}
    command = _strip_command_prefix(tokens)
    if not command:
        return False
    if Path(command[0]).name == "uv":
        try:
            run_index = command.index("run")
        except ValueError:
            return False
        command = _skip_uv_run_options(command[run_index + 1 :])
        if not command:
            return False
    executable = Path(command[0]).name.lower()
    # (1) Readers stay free — never regress the 21/23 false-positive fix.
    if _is_provider_read_only_head(executable, command):
        return False
    if _python_gateway_semantic_mutation(command):
        return True
    # Fold wrapper assignments into a call-local resolver. Generic HTTP calls do
    # not borrow provider evidence or read semantics from sibling calls.
    local_environ = {**environ, **_wrapper_env_assignments(tokens)}
    text = _normalize_literal_members(_strip_inert_print_strings(" ".join(command)))
    if executable in _HTTPIE_HEADS and _httpie_offline(command):
        return False
    # (1b) An acquisition vendor bills on reads too (app#840), so the host alone
    # settles it — before the per-client mutation grammar below, which would let
    # a plain GET on `api.apify.com` start and bill an actor run for free.
    if _acquisition_origin_match(_expand_env_refs(_expand_provider_refs(text, local_environ), local_environ)):
        return True
    generic_mutation = _generic_provider_mutation(text, local_environ)
    if executable in _CURL_HEADS:
        return _curl_mutates(command[1:], local_environ)
    source, interpolations = _source_code(text)
    executable_text = source + " " + " ".join(interpolations)
    opaque_mutation = _opaque_provider_mutation(text, local_environ)
    identity_text = executable_text if (
        _PYTHON_EXE_RE.fullmatch(executable)
        or executable in {"bash", "bun", "deno", "node", "sh", "zsh"}
    ) else _expand_env_refs(text, local_environ)
    nested_text = _expand_env_refs(_expand_provider_refs(text, local_environ), local_environ)
    # (2) A vendor SDK call shape OR constructor identifies the provider by itself.
    sdk_id = bool(_PROVIDER_SDK_RE.search(executable_text))
    if (
        not sdk_id
        and not _provider_service_match(identity_text, local_environ)
        and not generic_mutation
        and not opaque_mutation
    ):
        return False
    # A bare constructor (`genai.Client()`) identifies but does not spend — only a
    # real paid SDK call is a mutation (round 3 SDK-ctor false-deny).
    sdk_call = bool(_PROVIDER_SDK_CALL_RE.search(executable_text))
    # (3) Mutating?
    if executable in _HTTPIE_HEADS:
        return (
            sdk_call
            or _httpie_mutates(command[1:], piped_stdin)
            or _nested_curl_mutation(nested_text, local_environ)
        )
    if executable in _PROVIDER_CLI_NAMES:
        return any(token.lower() in _PROVIDER_CLI_ACTIONS for token in command[1:])
    if _PYTHON_EXE_RE.fullmatch(executable) or executable in {
        "bash",
        "bun",
        "deno",
        "node",
        "sh",
        "zsh",
    }:
        # A bare HTTP method is deliberately NOT enough for an interpreter: a
        # printed string ("allows inert command-text inspection") must stay free.
        # But a curl shelled out via os.system/subprocess/backticks IS egress
        # (round 2 f1).
        return (
            sdk_call
            or bool(_PROVIDER_ACTION_RE.search(executable_text))
            or generic_mutation
            or opaque_mutation
            or (
                bool(_DYNAMIC_EXEC_RE.search(nested_text) or _READER_SHELL_OUT_RE.search(nested_text))
                and _nested_curl_mutation(nested_text, local_environ)
            )
        )
    # Any other launcher (wget, xargs curl, awk/sed/perl shelling out, an unknown
    # client): a bare uppercase HTTP method against an identified provider that
    # can speak HTTP (finding 4), or a curl nested in the wrapper (round 2 f1).
    # Round 3: nested-curl only when the head genuinely RUNS its argv (find -exec,
    # xargs, timeout, parallel) or the segment shells out — otherwise
    # `git commit -m 'curl -d@b.json …'` was wrongly denied.
    nested_curl_context = (
        executable in _NESTED_CURL_LAUNCHERS
        or bool(_DYNAMIC_EXEC_RE.search(nested_text))
        or bool(_READER_SHELL_OUT_RE.search(nested_text))
    )
    return (
        sdk_call
        or generic_mutation
        or _bare_method_mutation(identity_text)
        or (nested_curl_context and _nested_curl_mutation(nested_text, local_environ))
    )


def _nested_curl_any_mutation(text: str) -> bool:
    for match in _NESTED_CURL_RE.finditer(text):
        tail = text[match.end() :]
        terminator = _NESTED_CURL_TERMINATOR_RE.search(tail)
        sub = tail[: terminator.start()] if terminator else tail
        try:
            tokens = shlex.split(sub)
        except ValueError:
            return True
        if _curl_any_mutation(tokens):
            return True
    return False


def _raw_network_mutation(
    tokens: list[str],
    environ: dict[str, str],
    piped_stdin: bool = False,
) -> bool:
    """Reject non-canonical network writes, regardless of route receipt.

    Canonical engine tools are classified before this function is called. Raw
    clients cannot safely prove that they attach ``client_job``, pass through
    gateway authentication/metering, or avoid control-plane endpoints, so a
    mutation is never allowed merely by redirecting output into a routed job.
    """
    command = _strip_command_prefix(tokens)
    if not command:
        return False
    if Path(command[0]).name == "uv":
        try:
            run_index = command.index("run")
        except ValueError:
            return False
        command = _skip_uv_run_options(command[run_index + 1 :])
        if not command:
            return False
    executable = Path(command[0]).name.lower()
    if _is_provider_read_only_head(executable, command):
        return False
    if _python_gateway_semantic_mutation(command):
        return True
    local_environ = {**environ, **_wrapper_env_assignments(tokens)}
    text = _normalize_literal_members(_strip_inert_print_strings(" ".join(command)))
    expanded_text = _expand_env_refs(text, local_environ)
    if executable in _CURL_HEADS:
        return _curl_any_mutation(command[1:])
    if executable in _HTTPIE_HEADS:
        return _httpie_mutates(command[1:], piped_stdin)
    if executable in _PROVIDER_CLI_NAMES:
        return any(token.lower() in _PROVIDER_CLI_ACTIONS for token in command[1:])
    if _PYTHON_EXE_RE.fullmatch(executable) or executable in {
        "bash",
        "bun",
        "deno",
        "node",
        "sh",
        "zsh",
    }:
        source, interpolations = _source_code(text)
        executable_text = source + " " + " ".join(interpolations)
        return bool(
            _PROVIDER_SDK_CALL_RE.search(executable_text)
            or _generic_http_mutation(text, local_environ)[1]
            or _opaque_raw_mutation(text, local_environ)
            or (
                (_DYNAMIC_EXEC_RE.search(expanded_text) or _READER_SHELL_OUT_RE.search(expanded_text))
                and _nested_curl_any_mutation(expanded_text)
            )
        )
    nested_context = (
        executable in _NESTED_CURL_LAUNCHERS
        or bool(_DYNAMIC_EXEC_RE.search(expanded_text))
        or bool(_READER_SHELL_OUT_RE.search(expanded_text))
    )
    return bool(
        (_PROVIDER_HTTP_CLIENT_RE.search(expanded_text) and _PROVIDER_HTTP_MUTATING_RE.search(expanded_text))
        or (_PROVIDER_HTTP_MUTATING_RE.search(expanded_text) and _PROVIDER_TRANSPORT_RE.search(expanded_text))
        or (nested_context and _nested_curl_any_mutation(expanded_text))
    )


def _dynamic_media_action(tokens: list[str]) -> str | None:
    command = _strip_command_prefix(tokens)
    if not command:
        return None
    if Path(command[0]).name == "uv":
        try:
            run_index = command.index("run")
        except ValueError:
            return None
        command = _skip_uv_run_options(command[run_index + 1 :])
        if not command:
            return None
    executable = Path(command[0]).name.lower()
    if not (
        _PYTHON_EXE_RE.fullmatch(executable)
        or executable in {"bun", "deno", "node"}
    ):
        return None
    text = " ".join(command)
    if not _DYNAMIC_EXEC_RE.search(text):
        return None
    if re.search(r"\bffmpeg\b", text):
        return "ffmpeg"
    if re.search(r"\bremotion\s+(?:render|still)\b", text):
        return "remotion"
    return None


# ── Job-local rm/rmdir/ln (videoclaw#282) ───────────────────────────────────
# These heads used to become "opaque" whenever they named a job, so an ordinary
# `rm -f jobs/<id>/review/_gap.mp3` stopped the call. They cannot spend, so they
# join the local file-write family (cp/mv/touch) when every path they remove,
# create or point at provably stays inside the one job folder this session
# owns. Everything else keeps the opaque refusal: a path outside that job,
# another job, the job folder itself, an engine-owned route file, an unresolved
# variable, a glob that could reach past one directory of the job, an option
# this parser does not model, or a relative path after a possible directory
# change.
_JOB_LOCAL_FILE_OPTIONS: dict[str, tuple[frozenset[str], frozenset[str]]] = {
    "ln": (
        frozenset("fhinsv"),
        frozenset(
            {"--force", "--interactive", "--no-dereference", "--symbolic", "--verbose"}
        ),
    ),
    "rm": (
        frozenset("dfiIrRv"),
        frozenset({"--dir", "--force", "--recursive", "--verbose"}),
    ),
    # No -p/--parents: it removes ancestors, up to the job folder itself.
    "rmdir": (
        frozenset("v"),
        frozenset({"--ignore-fail-on-non-empty", "--verbose"}),
    ),
}
# Lower-cased: the default macOS filesystem ignores case.
_ENGINE_OWNED_JOB_FILES = frozenset(
    name.lower() for name in (RECEIPT_NAME, RECEIPT_HISTORY_NAME, RECEIPT_LOCK_NAME)
)
# Anything that can move the shell's working directory, even inside a quoted
# payload (`eval 'cd …'`) or a function body. Deliberately over-inclusive: it
# only stops relative job-local paths from being trusted.
_CWD_CHANGE_WORD_RE = re.compile(
    r"(?<![A-Za-z0-9_./-])(?:cd|chdir|popd|pushd|source)(?![A-Za-z0-9_./-])"
)
# Settings that change how Bash splits or globs an operand (`IFS=/` turns
# `$J` into several paths; `shopt -s nocaseglob` widens a glob).
_SHELL_EXPANSION_SETTING_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:IFS|GLOBIGNORE|emulate|setopt|shopt|unsetopt)(?![A-Za-z0-9_])"
)
# A shell function or alias can give `rm` any meaning at all.
_DEFINES_COMMAND_RE = re.compile(
    r"(?:^|[\s;&|(){}])(?:function\s+[^\s;&|(){}]+|[^\s;&|(){}<>]+\s*\(\s*\)|alias(?=\s))"
)
# A standalone number directly before `<`/`>` (`2>/dev/null`). Group 1/3 catch
# a quote and group 4 catches whitespace, which make the number an argument.
_REDIRECT_NUMBER_RE = re.compile(r"(?<![^\s;&|(])(['\"]?)(\d+)(['\"]?)(\s*)(?=[<>])")


class _JobLocalContext(NamedTuple):
    """Facts about the whole Bash call that job-local file checks rely on."""

    # The host's environment, never one a same-call assignment rewrote.
    owner_environ: dict[str, str]
    # True when anything in the call may change the working directory.
    cwd_may_change: bool
    # Numbers that only ever appear glued to a redirect (`2>`), so a trailing
    # one is a file descriptor, not a path operand.
    redirect_fds: frozenset[str]
    # True when the call may define a function or alias (unknown if unseen).
    defines_commands: bool = True
    # True when the call or host may change word splitting or globbing.
    expansion_changed: bool = True
    # The call's top-level words and operators, to judge its variables.
    segments: tuple[tuple[str, ...], ...] = ()
    gap_ops: tuple[tuple[str, ...], ...] = ()
    operators: tuple[str, ...] = ()


_ASSIGNMENT_WORD_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", re.DOTALL)


def _shell_variables_are_fixed(
    names: Iterable[str],
    context: _JobLocalContext,
    *,
    nested: bool,
    assignable: bool = True,
) -> bool:
    """Whether each variable has one value Bash and this classifier agree on.

    The classifier models only plain `NAME=value` statements, so a variable
    is trusted only when every appearance of its name in the call is either a
    plain `$NAME`/`${NAME}` reference or such a statement that certainly runs
    in this shell (no subshell, no condition before it) with a literal value.
    Anything else (`export`, `read`, `for NAME in`, `${NAME:=…}`, a
    command-local `NAME=value cmd`) may give Bash a different value.
    """
    subshell = any(op in {"(", ")"} for op in context.operators)
    words = [token for tokens in context.segments for token in tokens]
    for name in names:
        escaped = re.escape(name)
        mentions = sum(
            len(re.findall(rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])", word))
            for word in words
        )
        references = sum(
            len(re.findall(rf"\$(?:{escaped}(?![A-Za-z0-9_])|\{{{escaped}\}})", word))
            for word in words
        )
        assignments = 0
        for index, tokens in enumerate(context.segments):
            matches = [_ASSIGNMENT_WORD_RE.fullmatch(token) for token in tokens]
            if not tokens or not all(matches):
                continue
            for match in matches:
                if match is None or match.group(1) != name:
                    continue
                value = match.group(2)
                inner = [a or b for a, b in _SHELL_PATH_VAR_RE.findall(value)]
                if (
                    not assignable
                    or nested
                    or subshell
                    or any(
                        op != ";" and "<" not in op and ">" not in op
                        for gap in context.gap_ops[:index]
                        for op in gap
                    )
                    or any(char in _SHELL_PATH_VAR_RE.sub("", value) for char in "$`")
                    or not _shell_variables_are_fixed(
                        inner, context, nested=nested, assignable=False
                    )
                ):
                    return False
                assignments += 1
        if mentions != references + assignments:
            return False
        if not assignments and name not in context.owner_environ:
            return False
    return True


def _command_may_change_cwd(segments: list[list[str]]) -> bool:
    for tokens in segments:
        command = _strip_command_prefix(tokens)
        if command and command[0] == ".":
            return True
        if any(_CWD_CHANGE_WORD_RE.search(token) for token in tokens):
            return True
        # `env -C dir rm …` runs the command somewhere else.
        if any(
            token in {"-C", "--chdir"} or token.startswith("--chdir=")
            for token in tokens
        ):
            return True
    return False


def _redirect_fd_numbers(command: str) -> frozenset[str]:
    glued: set[str] = set()
    ambiguous: set[str] = set()
    for match in _REDIRECT_NUMBER_RE.finditer(command):
        if match.group(1) or match.group(3) or match.group(4):
            ambiguous.add(match.group(2))
        else:
            glued.add(match.group(2))
    return frozenset(glued - ambiguous)


def _job_local_context(
    segments: list[list[str]],
    environ: dict[str, str],
    command: str | None = None,
    gap_ops: list[list[str]] | None = None,
    operators: list[str] | None = None,
) -> _JobLocalContext:
    return _JobLocalContext(
        owner_environ=dict(environ),
        cwd_may_change=_command_may_change_cwd(segments),
        redirect_fds=_redirect_fd_numbers(command) if command is not None else frozenset(),
        defines_commands=command is None or bool(_DEFINES_COMMAND_RE.search(command)),
        expansion_changed=(
            command is None
            or bool(_SHELL_EXPANSION_SETTING_RE.search(command))
            or environ.get("IFS", " \t\n") != " \t\n"
        ),
        segments=tuple(tuple(tokens) for tokens in segments),
        gap_ops=tuple(tuple(gap) for gap in gap_ops or []),
        # Without the operator list, assume the worst about subshells.
        operators=tuple(operators) if operators is not None else ("(",),
    )


def _job_folder_of(path: Path, output_root: Path) -> tuple[str, bool] | None:
    """Return (job id, is the job folder itself) for a resolved path, or None."""
    if not _inside(path, output_root):
        return None
    parts = path.relative_to(output_root).parts
    if not parts or parts[0] in {".", ".."} or not _JOB_ID_RE.fullmatch(parts[0]):
        return None
    return parts[0], len(parts) == 1


def _job_local_operand(
    raw: str,
    environ: dict[str, str],
    context: _JobLocalContext,
    *,
    nested: bool,
) -> str | None:
    """Expand one operand exactly as Bash would, or None when that is unknown."""
    if any(char in _SHELL_PATH_VAR_RE.sub("", raw) for char in "{}`$"):
        # Brace expansion, command substitution and parameter operators can
        # produce any path.
        return None
    names = [a or b for a, b in _SHELL_PATH_VAR_RE.findall(raw)]
    if names and not _shell_variables_are_fixed(names, context, nested=nested):
        return None
    if any(
        char in environ.get(name, "") for name in names for char in " \t\n*?[]{}~$`"
    ):
        # Quoting is gone by now: a value Bash may split, glob or leave
        # literal cannot be placed.
        return None
    expanded = _expand_shell_path(raw, environ)
    if expanded is None:
        return None
    if expanded == "~" or expanded.startswith("~/"):
        home = environ.get("HOME", "")
        if not home or not Path(home).is_absolute():
            return None
        expanded = home + expanded[1:]
    elif expanded.startswith("~"):
        return None
    return expanded or None


def _job_local_file_job(
    command: list[str],
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
    context: _JobLocalContext,
    *,
    nested: bool,
) -> str | None:
    """Return the owned job an rm/rmdir/ln stays inside, or None to stay opaque.

    ``command`` is the unexpanded argv, so variables are judged as written.
    """
    head = Path(command[0]).name.lower()
    if (
        head not in _JOB_LOCAL_FILE_OPTIONS
        or context.defines_commands
        or context.expansion_changed
    ):
        return None
    short_options, long_options = _JOB_LOCAL_FILE_OPTIONS[head]
    operands: list[str] = []
    symbolic = False
    options_done = False
    for token in command[1:]:
        if options_done or token == "-" or not token.startswith("-"):
            operands.append(token)
            continue
        if operands:
            # BSD tools read a later "-x" as a file name, GNU as an option.
            return None
        if token == "--":
            options_done = True
        elif token.startswith("--"):
            if token not in long_options:
                return None
            symbolic = symbolic or token == "--symbolic"
        elif all(letter in short_options for letter in token[1:]):
            symbolic = symbolic or "s" in token
        else:
            return None
    if not operands:
        return None

    jobs: set[str] = set()

    def engine_file(path: Path) -> bool:
        """A route file the engine keeps directly in a job folder."""
        if path.name.lower() not in _ENGINE_OWNED_JOB_FILES:
            return False
        parent = _job_folder_of(path.parent.resolve(), output_root)
        return parent is None or parent[1]

    def strictly_inside(path: Path) -> bool:
        found = _job_folder_of(path, output_root)
        if found is None or found[1] or engine_file(path):
            return False
        jobs.add(found[0])
        return True

    expanded: list[str] = []
    for raw in operands:
        value = _job_local_operand(raw, environ, context, nested=nested)
        if value is None:
            return None
        expanded.append(value)

    def placed(value: str) -> Path | None:
        """The operand's lexical location, if the working directory is known."""
        path = Path(value)
        if path.is_absolute():
            return path
        return None if context.cwd_may_change else cwd / path

    if head == "ln":
        if len(expanded) < 2 or any(
            char in value for value in expanded for char in "*?["
        ):
            return None
        *sources, destination = expanded
        dest = placed(destination)
        if dest is None or engine_file(dest):
            return None
        dest_resolved = dest.resolve()
        if not strictly_inside(dest_resolved):
            return None
        into_directory = dest_resolved.is_dir()
        # A relative symlink is read from the directory that holds the link.
        link_dirs = {dest.parent.resolve()}
        if into_directory:
            link_dirs.add(dest_resolved)
        for source in sources:
            name = Path(source).name
            if into_directory and (
                name in {"", ".", ".."} or engine_file(dest_resolved / name)
            ):
                return None
            if symbolic and not Path(source).is_absolute():
                if not all(
                    strictly_inside((link_dir / source).resolve())
                    for link_dir in link_dirs
                ):
                    return None
                continue
            located = placed(source)
            if located is None or not strictly_inside(located.resolve()):
                return None
    else:
        for value in expanded:
            path = placed(value)
            if path is None:
                return None
            if any(char in value for char in "*?["):
                # One glob in the last component only, never a hidden or
                # bracketed one.
                pattern = path.name
                if (
                    value.endswith("/")
                    or "[" in value
                    or pattern.startswith(".")
                    or any(char in part for part in path.parent.parts for char in "*?")
                ):
                    return None
                # Matches are children of the parent, so it may be the job
                # folder itself; they can never be the job folder. There the
                # glob must not be able to match an engine route file.
                found = _job_folder_of(path.parent.resolve(), output_root)
                if found is None or (
                    found[1]
                    and any(
                        fnmatch.fnmatchcase(owned, pattern.lower())
                        for owned in _ENGINE_OWNED_JOB_FILES
                    )
                ):
                    return None
                jobs.add(found[0])
                continue
            if (
                path.name in {".", ".."}
                or engine_file(path)
                or not strictly_inside(path.resolve())
            ):
                return None

    if len(jobs) != 1:
        return None
    job = next(iter(jobs))
    # The same ownership rule as an automatic route: a hosted session touches
    # only its bound job, an unbound hosted session none, the CLI any.
    if _auto_route_refusal(job, context.owner_environ) is not None:
        return None
    return job


def _direct_production_actions(
    segments: list[list[str]],
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
    depth: int = 0,
    gap_ops: list[list[str]] | None = None,
    *,
    local_context: _JobLocalContext | None = None,
) -> list[tuple[str, str | None, list[str] | None]]:
    if depth > 2:
        raise RouteReceiptError("nested shell command is too deep to validate safely")
    if local_context is None:
        local_context = _job_local_context(segments, environ, gap_ops=gap_ops)
    # A `bash -c`/`eval` payload is not the call's own top level: variables
    # the call assigns may not reach it as written.
    nested_frame = tuple(tuple(tokens) for tokens in segments) != local_context.segments
    actions: list[tuple[str, str | None, list[str] | None]] = []
    local_environ = dict(environ)
    local_cwd = cwd.resolve()
    redirect_jobs = _pipeline_redirect_jobs(
        segments, gap_ops or [], output_root, cwd, local_environ
    )
    for segment_index, tokens in enumerate(segments):
        segment_action_start = len(actions)
        effective = list(tokens)
        while effective and re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*=.*",
            effective[0],
        ):
            name, value = effective.pop(0).split("=", 1)
            expanded = _expand_shell_path(value, local_environ)
            if expanded is not None:
                local_environ[name] = expanded
            # Round 2 (f4): a gateway/credential reference this classifier env
            # cannot resolve still carries the provider SIGNAL — keep the raw
            # reference so `$G`/`$K` used downstream identify the metered call.
            elif _PROVIDER_SERVICE_RE.search(value):
                local_environ[name] = value
        effective = [
            _expand_provider_refs(
                _resolve_shell_value(token, local_environ) or token,
                local_environ,
            )
            for token in effective
        ]
        if not effective:
            continue
        command = _strip_command_prefix(effective)
        if command and Path(command[0]).name == "cd" and len(command) >= 2:
            expanded = _expand_shell_path(command[1], local_environ)
            if expanded is not None:
                target = Path(expanded).expanduser()
                local_cwd = (
                    target.resolve()
                    if target.is_absolute()
                    else (local_cwd / target).resolve()
                )
            continue
        if command and Path(command[0]).name in {"bash", "sh", "zsh"}:
            if "-c" in command:
                index = command.index("-c")
                if index + 1 < len(command):
                    nested_segments, _, nested_gaps = _shell_segments_with_gaps(
                        command[index + 1]
                    )
                    actions.extend(
                        _direct_production_actions(
                            nested_segments,
                            output_root,
                            local_cwd,
                            local_environ,
                            depth + 1,
                            nested_gaps,
                            local_context=local_context,
                        )
                    )
        elif command and command[0] == "eval" and len(command) > 1:
            nested_segments, _, nested_gaps = _shell_segments_with_gaps(
                " ".join(command[1:])
            )
            actions.extend(
                _direct_production_actions(
                    nested_segments,
                    output_root,
                    local_cwd,
                    local_environ,
                    depth + 1,
                    nested_gaps,
                    local_context=local_context,
                )
            )
        for job in sorted(
            _ffmpeg_output_jobs(effective, output_root, local_cwd, local_environ)
        ):
            actions.append(("ffmpeg", job, effective))
        for job in sorted(
            _remotion_output_jobs(effective, output_root, local_cwd, local_environ)
        ):
            actions.append(("remotion", job, effective))
        dynamic_media = _dynamic_media_action(effective)
        if dynamic_media:
            jobs = _mentioned_job_ids(" ".join(effective), local_environ)
            actions.extend(
                (dynamic_media, job, effective) for job in sorted(jobs)
            )
            if not jobs:
                actions.append((dynamic_media, None, effective))
        piped_stdin, redirect_tail = _segment_stdin_and_tail(
            segments, gap_ops or [], segment_index
        )
        if _is_mutating_provider_invocation(
            effective + redirect_tail, local_environ, piped_stdin
        ):
            raw_job = _resolve_shell_value(
                _arg_value(effective, "--job"),
                local_environ,
            )
            jobs = {raw_job} if raw_job else _mentioned_job_ids(
                " ".join(effective), local_environ
            )
            # Round 2 (fd4): consent for a provider curl rides a pipeline redirect
            # (`… | jq > jobs/<id>/out.json`) — curl has no --job flag. When the
            # call names no job, bind it to the redirect target of its pipeline.
            if not jobs:
                jobs = set(redirect_jobs[segment_index])
            if jobs:
                actions.extend(("provider", job, effective) for job in sorted(jobs))
            else:
                actions.append(("provider", None, effective))

        # This is the engine-side home for a safeguard that previously existed
        # only in the desktop mirror. An unknown executable tied to jobs/<id>
        # may be a perfectly useful shell wrapper, but we cannot prove it is
        # read-only by inspecting its name. Keep wrappers possible by returning
        # a structured "opaque" action so the strict verdict can reject it
        # explicitly while unknown spend remains fail-closed.
        command = _strip_command_prefix(effective)
        if command:
            head = Path(command[0]).name.lower()
            canonical_tool = _script_tool(effective)
            opaque_job = _resolve_shell_value(
                _arg_value(command, "--job"),
                local_environ,
            )
            if not opaque_job:
                # Job-looking text printed for inspection is data, not an
                # opaque production action. Reuse the same inert-string rule as
                # provider detection so the structured IR and legacy hook
                # cannot disagree about `python -c "print('ffmpeg jobs/...')"`.
                executable_text = _strip_inert_print_strings(" ".join(command))
                opaque_job = next(
                    iter(sorted(_mentioned_job_ids(executable_text, local_environ))),
                    None,
                )
            opaque_shell_script = (
                head in {"bash", "sh", "zsh"}
                and "-c" not in command
                and any("jobs/" in token for token in command[1:])
            )
            opaque_program = (
                canonical_tool is None
                and opaque_job is not None
                and not _is_provably_read_only_shell_command(command)
                and head not in _KNOWN_PRODUCTION_LAUNCHER_HEADS
                and head not in _KNOWN_LOCAL_SETUP_HEADS
            )
            is_redirect_target = (
                segment_index > 0
                and segment_index - 1 < len(gap_ops or [])
                and _gap_redirects((gap_ops or [])[segment_index - 1])
            )
            if (
                not is_redirect_target
                and len(actions) == segment_action_start
                and (opaque_shell_script or opaque_program)
            ):
                family = "file-write" if head in _KNOWN_LOCAL_WRITE_HEADS else "opaque"
                job = opaque_job
                if family == "opaque" and head in _JOB_LOCAL_FILE_OPTIONS:
                    gaps = gap_ops or []
                    gap_after = gaps[segment_index] if segment_index < len(gaps) else []
                    # Judge the argv as written: `effective` has already
                    # substituted whole-word variables.
                    local_argv = _strip_command_prefix(tokens)
                    # `rm -f x 2>/dev/null`: the lexer leaves the 2 on this
                    # segment; it is a file descriptor, not a path to remove.
                    if (
                        gap_after
                        and any(char in gap_after[0] for char in "<>")
                        and len(local_argv) > 2
                        and local_argv[-1] in local_context.redirect_fds
                    ):
                        local_argv.pop()
                    # A word glued to `(` is an extglob pattern, not a path.
                    local_job = (
                        None
                        if gap_after[:1] == ["("]
                        else _job_local_file_job(
                            local_argv,
                            output_root,
                            local_cwd,
                            local_environ,
                            local_context,
                            nested=nested_frame,
                        )
                    )
                    if local_job is not None:
                        family, job = "file-write", local_job
                actions.append((family, job, effective))
    return actions


def _canonical_spend_risk(tool: str, tokens: list[str]) -> str:
    """Conservative spend semantics layered onto the existing action grammar."""
    if any(token in {"-h", "--help"} for token in tokens):
        return "free"
    if tool == "build_character_sheet" and "--dry-run" in tokens:
        return "free"
    if tool in ALWAYS_PAID_TOOLS:
        return "paid"
    if tool in ALWAYS_FREE_TOOLS:
        return "free"
    mode = _arg_value(tokens, "--mode")
    if tool == "compose_render":
        # --mode episode runs make_episode, which spawns synth_voice --mode
        # tts, lipsync_footage long, and a mint_image --role card path as
        # CHILD processes (tools/compose_render.py make_episode) — invisible
        # to any per-command hook, so the parent must carry the paid risk.
        # The other modes are local Remotion/ffmpeg assembly only. A missing
        # or unrecognized mode cannot run (argparse choices) and fails closed.
        if mode in {"render", "retrofit", "cover_bake", "bespoke"}:
            return "free"
        if mode == "episode":
            return "paid"
        return "unknown"
    if tool == "lipsync_footage":
        if mode is None:
            mode = _positional_mode(tokens)
        return (
            "free"
            if mode in {"plan", "face-envelope", "motion-envelope", "composite"}
            else "paid"
        )
    if tool == "synth_voice":
        return "free" if mode == "list_voices" else "paid"
    if tool == "score_bed":
        if mode in {"bed", "recover"}:
            return "free"
        if mode in {"generate", "split"}:
            return "paid"
        return "unknown"
    if tool == "scrub_reference_vo":
        return "paid"
    # clean_audio and densify include input/cache/backend-dependent paths. Do
    # not infer zero spend from an agent-authored mode or receipt.
    return "unknown"


def _action(
    family: str,
    name: str,
    job_id: str | None,
    spend_risk: str,
    argv: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "argv": argv,
        "family": family,
        "name": name,
        "jobId": job_id,
        "spendRisk": spend_risk,
    }


def _unsupported_shell_reason(
    segments: list[list[str]],
    invoked: list[tuple[str | None, list[str], list[str]]],
    direct: list[tuple[str, str | None, list[str] | None]],
    gap_ops: list[list[str]] | None = None,
    depth: int = 0,
) -> str | None:
    """Return strict-mode ambiguity without introducing another shell parser.

    This consumes the exact tokens and invocation results already produced by
    the production classifier. Legacy hook behavior intentionally ignores this
    extra strictness; the desktop verdict mode uses it to reject opaque child
    scripts and unsupported launchers instead of guessing.
    """
    direct_names = {name for name, _, _ in direct}
    gap_ops = gap_ops or []
    for segment_index, (tokens, (tool, _, _)) in enumerate(zip(segments, invoked)):
        # shlex represents a redirect target as its own segment. It is data,
        # not another executable. Without this exemption, ordinary reads such
        # as `sed ... 2>/dev/null` are rejected as attempts to execute
        # `/dev/null`, which encourages agents to fight a harmless guard.
        if (
            segment_index > 0
            and segment_index - 1 < len(gap_ops)
            and _gap_redirects(gap_ops[segment_index - 1])
        ):
            continue
        command = _strip_command_prefix(tokens)
        if not command:
            continue
        executable = Path(command[0]).name.lower()
        if executable in {"bash", "sh", "zsh"}:
            if "-c" not in command:
                return f"unsupported shell script launcher: {command[0]}"
            index = command.index("-c")
            if index + 1 < len(command):
                if depth >= 2:
                    return "nested shell command is too deep for a strict verdict"
                nested_segments, _, nested_gap_ops = _shell_segments_with_gaps(
                    command[index + 1]
                )
                nested_invoked = [
                    (*_script_invocation(nested), nested)
                    for nested in nested_segments
                ]
                nested_reason = _unsupported_shell_reason(
                    nested_segments,
                    nested_invoked,
                    direct,
                    nested_gap_ops,
                    depth + 1,
                )
                if nested_reason:
                    return nested_reason
            continue
        if executable == "eval" and len(command) > 1:
            if depth >= 2:
                return "nested eval command is too deep for a strict verdict"
            nested_segments, _, nested_gap_ops = _shell_segments_with_gaps(
                " ".join(command[1:])
            )
            nested_invoked = [
                (*_script_invocation(nested), nested)
                for nested in nested_segments
            ]
            nested_reason = _unsupported_shell_reason(
                nested_segments,
                nested_invoked,
                direct,
                nested_gap_ops,
                depth + 1,
            )
            if nested_reason:
                return nested_reason
            continue
        if executable in {"source", "."}:
            return f"unsupported sourced shell content: {command[0]}"
        if executable in {"alias", "function"}:
            return f"unsupported shell indirection: {command[0]}"
        if command[0].startswith("$") and not direct:
            return f"unresolved executable indirection: {command[0]}"
        if _PYTHON_EXE_RE.fullmatch(executable) and tool is None:
            if "-c" not in command:
                return "unsupported Python script launcher"
        if executable == "uv" and tool is None and "run" in command:
            return "unsupported uv run launcher"
        if executable in {"bun", "deno", "node"}:
            if not any(
                token in {"-e", "--eval", "-p", "--print"}
                or token.startswith(("-e=", "--eval=", "-p=", "--print="))
                for token in command[1:]
            ):
                return f"unsupported {executable} script launcher"
        if (
            tool is None
            and (
                "/" in command[0]
                or Path(command[0]).suffix.lower()
                in {".bash", ".js", ".mjs", ".py", ".sh", ".ts"}
            )
            and not _is_provably_read_only_shell_command(command)
            and executable not in _KNOWN_PRODUCTION_LAUNCHER_HEADS
        ):
            return f"opaque script cannot be statically analyzed: {command[0]}"
        if (
            "remotion" in [Path(token).name for token in command]
            and any(token in {"render", "still"} for token in command)
            and "remotion" not in direct_names
        ):
            return f"unsupported Remotion launcher: {command[0]}"
    return None


def _changed_cwd_reason(
    resolved_segments: list[tuple[list[str], dict[str, str]]],
    workspace_cwd: Path,
    direct: list[tuple[str, str | None, list[str] | None]],
    *,
    output_root: Path | None = None,
    gap_ops: list[list[str]] | None = None,
    operators: list[str] | None = None,
    local_context: _JobLocalContext | None = None,
    raw_segments: list[list[str]] | None = None,
) -> str | None:
    """Reject direct production whose relative media paths a `cd` rebases.

    Canonical engine tools receive job/workspace-normalized paths and are safe
    behind wrappers. Raw ffmpeg, redirects, cp, and provider clients obey the
    shell cwd itself; pretending their relative `jobs/...` still means the
    workspace is exactly how outputs landed under the installed engine.

    Raw wrappers remain first-class: changing into a directory inside the
    workspace is safe, as are absolute-path actions outside it. Only the
    combination of an external cwd and a cwd-sensitive media argv is ambiguous.

    A cd into one job folder is not ambiguous (videoclaw#282): when the cd
    certainly runs in this shell before the actions it rebases, and every
    relative media path then resolves inside that job, those paths bind to that
    job exactly as the action IR already binds them.
    """
    if not direct:
        return None
    path_flags = {
        "-i",
        "--audio",
        "--driver",
        "--first-frame",
        "--image",
        "--input",
        "--last-frame",
        "--out",
        "--out-dir",
        "--output",
        "--output-dir",
        "--reference",
        "--video",
    }
    media_suffixes = {
        ".aac",
        ".flac",
        ".gif",
        ".jpeg",
        ".jpg",
        ".json",
        ".m4a",
        ".mov",
        ".mp3",
        ".mp4",
        ".png",
        ".wav",
        ".webm",
        ".webp",
    }

    def relative_media_paths(argv: list[str]) -> Iterator[str]:
        # Lazy, so cwd_sensitive() stops at the first path exactly as before.
        expect_path = False
        for token in argv[1:]:
            if expect_path:
                expect_path = False
                path = Path(token).expanduser()
                if not path.is_absolute() and "://" not in token:
                    yield token
                continue
            flag = token.split("=", 1)[0]
            if flag in path_flags:
                if "=" in token:
                    value = token.split("=", 1)[1]
                    path = Path(value).expanduser()
                    if not path.is_absolute() and "://" not in value:
                        yield value
                else:
                    expect_path = True
                continue
            if token.startswith("-") or "://" in token:
                continue
            path = Path(token).expanduser()
            if path.is_absolute():
                continue
            if (
                token.startswith(("./", "../", "jobs/"))
                or path.suffix.lower() in media_suffixes
            ):
                yield token

    def cwd_sensitive(argv: list[str] | None) -> bool:
        if not argv:
            # Opaque actions cannot prove that an external cwd is harmless.
            return True
        return next(relative_media_paths(argv), None) is not None

    gaps = gap_ops or []

    def redirect(op: str) -> bool:
        return "<" in op or ">" in op

    def cwd_changes_are_modelled() -> bool:
        """Every directory change in the call is a plain `cd <target>`."""
        for tokens, _ in resolved_segments:
            command = _strip_command_prefix(tokens)
            if command and command[0] == ".":
                return False
            words = [token for token in tokens if _CWD_CHANGE_WORD_RE.search(token)]
            if words and not (
                words == ["cd"]
                and len(command) == 2
                and command[0] == "cd"
                and not command[1].startswith("-")
            ):
                return False
        return True

    def cd_is_certain(index: int, command: list[str], target: Path) -> bool:
        """This cd runs in this shell, and succeeds, before every later statement."""
        if len(command) != 2 or command[1].startswith("-"):
            return False
        if not target.is_absolute() and any(
            "CDPATH" in token or "CDPATH" in segment_environ
            for tokens, segment_environ in resolved_segments
            for token in tokens
        ):
            # CDPATH may send a relative cd somewhere else entirely.
            return False
        if any(op in {"(", ")"} for op in operators or []):
            # A subshell may scope the cd away from the actions it rebases.
            return False
        before = [op for gap in gaps[:index] for op in gap]
        if any(op not in {";", "&&"} and not redirect(op) for op in before):
            return False
        adjacent = gaps[index] if index < len(gaps) else []
        if any(op not in {";", "&&", "||"} and not redirect(op) for op in adjacent[:1]):
            # A pipe or `&` runs the cd in a child shell.
            return False
        after = [op for gap in gaps[index:] for op in gap]
        chained = all(op in {"&&", "|", "|&"} or redirect(op) for op in after)
        last_statement = max(
            (position for position, op in enumerate(before) if op == ";"),
            default=-1,
        )
        if "&&" in before[last_statement + 1 :] and not chained:
            # A conditional cd: whatever runs after a later `;`/`||` might
            # run in the old directory.
            return False
        if not active.is_dir() and not chained:
            # A cd that fails lets a later `;`/`||` statement run in the old
            # directory; only an `&&` chain stops with it (`mkdir -p x && cd x`).
            return False
        return True

    def paths_stay_in_job() -> bool:
        """Every relative media path resolves inside the job the cd entered."""
        if output_root is None:
            return False
        found = _job_folder_of(active, output_root)
        if found is None:
            return False
        job_dir = output_root / found[0]
        for _, _, argv in direct:
            if not argv:
                return False
            try:
                paths = list(relative_media_paths(argv))
            except (RuntimeError, ValueError):
                return False
            for raw in paths:
                if "$" in raw:
                    # `$J/footage/a.mp4`: trust the value only when Bash and
                    # this classifier agree on it everywhere in the call.
                    names = [a or b for a, b in _SHELL_PATH_VAR_RE.findall(raw)]
                    if local_context is None or not _shell_variables_are_fixed(
                        names, local_context, nested=has_payload
                    ):
                        return False
                    values = {
                        _expand_shell_path(raw, segment_environ)
                        for _, segment_environ in resolved_segments
                    }
                    if len(values) != 1 or None in values:
                        return False
                    raw = next(iter(values))
                if any(char in raw for char in "$`"):
                    return False
                path = Path(raw)
                if path.is_absolute():
                    # Nothing for the cd to rebase.
                    continue
                if not _inside((active / path).resolve(), job_dir):
                    return False
        return True

    def cd_target_is_fixed(index: int) -> bool:
        """The cd target as written names no variable Bash may read differently.

        `J=zero; J=paid true; cd "$J"`: the second assignment is local to
        `true`, so Bash enters zero while the action IR carries J=paid into
        the cd and binds the output to paid. Trust a variable in the target
        only under the same rule as a variable in a media path.
        """
        if raw_segments is None or index >= len(raw_segments):
            return False
        written = _strip_command_prefix(list(raw_segments[index]))
        if len(written) < 2 or Path(written[0]).name != "cd":
            return False
        names = [a or b for a, b in _SHELL_PATH_VAR_RE.findall(written[1])]
        if not names:
            return True
        nested = has_payload or (
            local_context is not None
            and tuple(tuple(tokens) for tokens in raw_segments) != local_context.segments
        )
        return local_context is not None and _shell_variables_are_fixed(
            names, local_context, nested=nested
        )

    modelled = cwd_changes_are_modelled()
    # Direct argv may come from a `bash -c`/`eval` payload, where the call's
    # own assignments need not apply as written.
    has_payload = any(
        command
        and (
            (Path(command[0]).name in {"bash", "sh", "zsh"} and "-c" in command)
            or command[0] == "eval"
        )
        for command in (
            _strip_command_prefix(tokens) for tokens, _ in resolved_segments
        )
    )
    active = workspace_cwd.resolve()
    # Whether `active` is certainly the shell's directory at this point.
    active_known = modelled
    for index, (tokens, segment_environ) in enumerate(resolved_segments):
        command = _strip_command_prefix(tokens)
        if not command or Path(command[0]).name != "cd" or len(command) < 2:
            continue
        expanded = _expand_shell_path(command[1], segment_environ)
        if expanded is None:
            return "direct production cannot follow an unresolved cd target"
        target = Path(expanded).expanduser()
        active = (
            target.resolve()
            if target.is_absolute()
            else (active / target).resolve()
        )
        active_known = (
            modelled
            and (target.is_absolute() or active_known)
            and cd_is_certain(index, command, target)
            and cd_target_is_fixed(index)
        )
        if not _inside(active, workspace_cwd.resolve()) and any(
            cwd_sensitive(argv) for _, _, argv in direct
        ):
            if active_known and paths_stay_in_job():
                continue
            return (
                "direct production cannot use relative media paths after "
                "leaving the Videoclaw workspace; use absolute paths or keep "
                "the workspace cwd"
            )
    return None


def _opaque_launcher_spend_actions(
    tokens: list[str],
    environ: dict[str, str],
    depth: int = 0,
) -> tuple[list[dict[str, Any]], str | None]:
    """Deny-by-default net for `bash -c '…'` / `eval …` payloads.

    _direct_production_actions descends into these payloads for ffmpeg/
    remotion/provider work, but the CANONICAL tool scan did not — so
    `bash -c 'python tools/check_script.py --job x'` produced zero actions
    and aggregated to read_only/free (the exact hole the free-parity CI net
    claims to pin). This mirror descends the same way and, for every engine
    tool named in a payload, fails closed:

      * a PROTECTED name → the same unsupported-launcher error the top level
        returns (the receipt path requires the direct canonical spelling);
      * any other name off the KNOWN_FREE allowlist → a read-only action with
        spendRisk "unknown" (payload argv downgrades like --skip-llm are NOT
        trusted through an opaque launcher).

    Returns (read_only_actions, error_reason)."""
    if depth > 2:
        # _direct_production_actions and the strict reason both fail closed on
        # this depth already; emit nothing extra.
        return [], None
    payloads: list[str] = []
    command = _strip_command_prefix(tokens)
    if not command:
        return [], None
    executable = Path(command[0]).name.lower()
    if executable in {"bash", "sh", "zsh"} and "-c" in command:
        index = command.index("-c")
        if index + 1 < len(command):
            payloads.append(command[index + 1])
    elif executable == "eval" and len(command) > 1:
        payloads.append(" ".join(command[1:]))
    if not payloads:
        return [], None

    actions: list[dict[str, Any]] = []
    for payload in payloads:
        try:
            nested_segments, _ = _shell_segments(payload)
        except ValueError:
            # Unparseable payloads already fail closed via the strict reason.
            continue
        for nested in nested_segments:
            nested_actions, reason = _opaque_launcher_spend_actions(
                nested, environ, depth + 1
            )
            if reason:
                return actions, reason
            actions.extend(nested_actions)
            tool, args = _script_invocation(nested)
            names = (
                [tool]
                if tool is not None
                else _TOOL_NAME_MENTION_RE.findall(" ".join(nested))
            )
            for name in names:
                if name == "cost" and tool is not None and (
                    _positional_mode(args) == "execute"
                ):
                    job = _resolve_shell_value(
                        _arg_value(args, "--job"), environ
                    )
                    actions.append(
                        _action(
                            "canonical",
                            name,
                            job,
                            "paid",
                            [f"tools/{name}.py", *args],
                        )
                    )
                    continue
                if name in KNOWN_FREE_TOOLS:
                    continue
                if name in PROTECTED_TOOLS:
                    return actions, (
                        "protected production path was named through an "
                        "unsupported or ambiguous launcher; use "
                        'uv run --project "$VIDEOCLAW_ENGINE" python '
                        '"$VIDEOCLAW_ENGINE/tools/<tool>.py" --job <id> ...'
                    )
                job = _resolve_shell_value(_arg_value(args, "--job"), environ)
                actions.append(
                    _action(
                        "canonical",
                        name,
                        job,
                        "unknown",
                        [f"tools/{name}.py"],
                    )
                )
    return actions, None


def _analyze_bash_command(
    command: str,
    output_root: Path,
    cwd: Path,
    environ: dict[str, str],
    depth: int = 0,
    *,
    local_context: _JobLocalContext | None = None,
) -> dict[str, Any]:
    """Parse one Bash command once for both the hook and strict JSON verdict."""
    try:
        segments, operators, gap_ops = _shell_segments_with_gaps(command)
    except ValueError as exc:
        legacy_error = (
            f"cannot safely parse protected production command: {exc}"
            if _PROTECTED_NAME_RE.search(command)
            else None
        )
        return {
            "protectedActions": [],
            "readOnlyActions": [],
            "legacyError": legacy_error,
            "strictError": f"cannot safely parse shell command: {exc}",
        }

    for segment in segments:
        pinned = _pinned_session_env_mutation(segment)
        if pinned:
            reason = (
                f"session routing credential {pinned} is pinned by the host and "
                "cannot be assigned or unset from Bash; restart the session to change it"
            )
            return {
                "protectedActions": [],
                "readOnlyActions": [],
                "legacyError": reason,
                "strictError": reason,
            }

    # Job-local file checks judge the whole call once, from the host's own
    # environment, and nested payloads inherit that judgement.
    if local_context is None:
        local_context = _job_local_context(
            segments, environ, command, gap_ops, operators
        )

    # Canonical actions are derived from resolved argv, not from a second app
    # parser. Keep the per-segment environment beside the IR so same-call shell
    # assignments bind exactly where Bash makes them visible.
    resolved_segments = _resolved_shell_segments(segments, environ)
    invoked = [
        (*_script_invocation(tokens), tokens, segment_environ)
        for tokens, segment_environ in resolved_segments
    ]
    raw_network_reason: str | None = None
    for index, (tool, _, original, segment_environ) in enumerate(invoked):
        if tool is not None:
            continue
        piped_stdin, redirect_tail = _segment_stdin_and_tail(
            segments, gap_ops, index
        )
        if _raw_network_mutation(
            original + redirect_tail, segment_environ, piped_stdin
        ):
            raw_network_reason = (
                "raw network/control-plane mutation is forbidden; use a canonical "
                "Videoclaw engine tool so client_job and the gateway ceiling are enforced"
            )
            break
    # prepare_production may be piped, or saved outside the jobs folder: its
    # reading set is advisory context and production no longer waits on it
    # (the guard records a route itself), so refusing a filtered call only
    # cost the agent a retry. Writing its output INTO a job folder (possibly
    # another video's receipt or journal) stays refused, as before.
    if any(tool == "prepare_production" for tool, _, _, _ in invoked) and (
        _redirects_into_jobs(segments, gap_ops, output_root, cwd, environ)
    ):
        reason = (
            "prepare_production output may be piped or saved outside the jobs "
            "folder, but not redirected into a job folder"
        )
        return {
            "protectedActions": [],
            "readOnlyActions": [],
            "legacyError": reason,
            "strictError": reason,
        }

    protected_actions: list[dict[str, Any]] = []
    read_only_actions: list[dict[str, Any]] = []
    for tool, args, original, segment_environ in invoked:
        if tool == "cost" and _positional_mode(args) == "execute":
            action = _action(
                "canonical",
                tool,
                _resolve_shell_value(
                    _arg_value(args, "--job"), segment_environ
                ),
                "unknown",
                [f"tools/{tool}.py", *args],
            )
            reason = (
                "cost.py execute was removed; hosts must authorize and run "
                "the original canonical command"
            )
            return {
                "protectedActions": protected_actions,
                "readOnlyActions": [*read_only_actions, action],
                "legacyError": reason,
                "strictError": reason,
            }
        if tool is not None and tool in PROTECTED_TOOLS:
            raw_job = _arg_value(args, "--job")
            job = _resolve_shell_value(raw_job, segment_environ)
            action = _action(
                "canonical",
                tool,
                job,
                _canonical_spend_risk(tool, args),
                [f"tools/{tool}.py", *args],
            )
            if _is_protected_invocation(tool, args):
                if not job:
                    if raw_job and _SHELL_VAR_RE.fullmatch(raw_job):
                        reason = (
                            f"{tool}: job variable {raw_job} is not set in the "
                            "hook environment"
                        )
                    else:
                        reason = (
                            f"{tool}: protected production action requires --job <id>"
                        )
                    return {
                        "protectedActions": [action],
                        "readOnlyActions": read_only_actions,
                        "legacyError": reason,
                        "strictError": reason,
                    }
                output_error = _canonical_output_path_error(
                    tool,
                    args,
                    job,
                    output_root,
                    cwd,
                    segment_environ,
                )
                if output_error:
                    return {
                        "protectedActions": [action],
                        "readOnlyActions": read_only_actions,
                        "legacyError": output_error,
                        "strictError": output_error,
                    }
                protected_actions.append(action)
            else:
                read_only_actions.append(action)
        elif tool is not None and tool not in KNOWN_FREE_TOOLS:
            # Deny-by-default (app issue #156 mirror): a non-protected engine
            # tool that spends — or that this build cannot prove free — must
            # surface as a read-only action whose spend risk is never "free"
            # for a spending form. The desktop pairs this with its own paid
            # classifier: the action keeps the free early-allow unreachable,
            # and cost.py can provide deterministic advisory metadata to the
            # host. Source-audited free forms (#184 table) demote
            # via _analysis_spend_risk, mirroring the desktop downgrades.
            job = _resolve_shell_value(
                _arg_value(args, "--job"),
                segment_environ,
            )
            read_only_actions.append(
                _action(
                    "canonical",
                    tool,
                    job,
                    _analysis_spend_risk(tool, args),
                    [f"tools/{tool}.py", *args],
                )
            )
        elif tool is None:
            launcher = _strip_command_prefix(original)
            payload: str | None = None
            if launcher:
                executable = Path(launcher[0]).name.lower()
                if executable in {"bash", "sh", "zsh"} and "-c" in launcher:
                    index = launcher.index("-c")
                    if index + 1 < len(launcher):
                        payload = launcher[index + 1]
                elif executable == "eval" and len(launcher) > 1:
                    payload = " ".join(launcher[1:])
            if payload is not None:
                if depth >= 2:
                    reason = "nested shell command is too deep to validate safely"
                    return {
                        "protectedActions": protected_actions,
                        "readOnlyActions": read_only_actions,
                        "legacyError": reason,
                        "strictError": reason,
                    }
                nested = _analyze_bash_command(
                    payload,
                    output_root,
                    cwd,
                    segment_environ,
                    depth + 1,
                    local_context=local_context,
                )
                protected_actions.extend(nested["protectedActions"])
                read_only_actions.extend(nested["readOnlyActions"])
                if nested["strictError"]:
                    return {
                        "protectedActions": protected_actions,
                        "readOnlyActions": read_only_actions,
                        "legacyError": nested["legacyError"],
                        "strictError": nested["strictError"],
                    }
                continue
            # A protected tool path can be DATA to a normal reader. Blocking
            # `grep ... "$VIDEOCLAW_ENGINE/tools/assemble.py"` teaches the
            # agent to fight the harness even though no production action is
            # possible. Keep shell-out readers and genuine launchers fail-
            # closed, but let the same audited read-only heads used by the
            # provider net inspect engine docs/source without special syntax.
            if (
                _PROTECTED_NAME_RE.search(" ".join(original))
                and not (
                    launcher
                    and _is_provider_read_only_head(
                        Path(launcher[0]).name.lower(),
                        launcher,
                    )
                )
            ):
                reason = (
                    "protected production path was named through an unresolved "
                    "launcher; use a directly inspectable shell wrapper"
                )
                return {
                    "protectedActions": protected_actions,
                    "readOnlyActions": read_only_actions,
                    "legacyError": reason,
                    "strictError": reason,
                }
            # bash -c / eval payloads: the canonical deny-by-default net must
            # descend exactly as far as _direct_production_actions does, or a
            # payload-wrapped spender aggregates to read_only/free.
            nested_actions, nested_reason = _opaque_launcher_spend_actions(
                original,
                segment_environ,
            )
            if nested_reason:
                return {
                    "protectedActions": protected_actions,
                    "readOnlyActions": read_only_actions,
                    "legacyError": nested_reason,
                    "strictError": nested_reason,
                }
            read_only_actions.extend(nested_actions)

    try:
        direct = _direct_production_actions(
            segments,
            output_root,
            cwd,
            environ,
            gap_ops=gap_ops,
            local_context=local_context,
        )
    except ValueError as exc:
        return {
            "protectedActions": protected_actions,
            "readOnlyActions": read_only_actions,
            "legacyError": str(exc),
            "strictError": str(exc),
        }
    for family, job, argv in direct:
        protected_actions.append(
            _action(
                family,
                family,
                job,
                (
                    "paid"
                    if family == "provider"
                    else "unknown"
                    if family == "opaque"
                    else "free"
                ),
                argv,
            )
        )
        if raw_network_reason is not None:
            continue
        if not job:
            reason = (
                f"{family}: direct production action requires --job <id> or an "
                "output path under jobs/<id>/"
            )
            return {
                "protectedActions": protected_actions,
                "readOnlyActions": read_only_actions,
                "legacyError": reason,
                "strictError": reason,
            }
        if family in {"provider", "opaque", "remotion"}:
            if family == "provider":
                reason = "raw provider mutation is forbidden"
            elif family == "remotion":
                reason = (
                    "direct Remotion rendering is forbidden; use "
                    "compose_render.py --mode bespoke"
                )
            else:
                reason = "opaque production wrapper cannot be statically analyzed"
            return {
                "protectedActions": protected_actions,
                "readOnlyActions": read_only_actions,
                "legacyError": reason,
                "strictError": reason,
            }

    if raw_network_reason is not None:
        return {
            "protectedActions": protected_actions,
            "readOnlyActions": read_only_actions,
            "legacyError": raw_network_reason,
            "strictError": raw_network_reason,
        }

    changed_cwd = _changed_cwd_reason(
        resolved_segments,
        cwd,
        direct,
        output_root=output_root,
        gap_ops=gap_ops,
        operators=operators,
        local_context=local_context,
        raw_segments=segments,
    )
    if changed_cwd:
        return {
            "protectedActions": protected_actions,
            "readOnlyActions": read_only_actions,
            "legacyError": changed_cwd,
            "strictError": changed_cwd,
        }

    # A route receipt proves bootstrap integrity, not permission to mutate that
    # proof. Keep the receipt immutable within a production shell invocation.
    if (
        protected_actions
        and "route-receipt.json" in command
        and re.search(
            r"\b(?:cp|install|mv|perl|python|sed|tee|truncate)\b|>>?",
            command,
        )
    ):
        reason = (
            "a production command may not mutate its route receipt "
            "in the same shell invocation"
        )
        return {
            "protectedActions": protected_actions,
            "readOnlyActions": read_only_actions,
            "legacyError": reason,
            "strictError": reason,
        }

    strict_invoked = [
        (tool, args, original)
        for tool, args, original, _ in invoked
    ]
    return {
        "protectedActions": protected_actions,
        "readOnlyActions": read_only_actions,
        "legacyError": None,
        "strictError": _unsupported_shell_reason(
            [tokens for tokens, _ in resolved_segments],
            strict_invoked,
            direct,
            gap_ops,
        ),
    }


def evaluate_bash_command(
    command: str,
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    environ: dict[str, str] | None = None,
) -> tuple[bool, str]:
    """Return whether a Bash tool call may proceed under the production guard.

    A missing or stale route is never the reason a call stops when the job may
    be routed automatically (see ``ensure_current_route``). The route step runs
    last, after every other refusal, so a refused call never records a route.
    """
    environ = dict(os.environ if environ is None else environ)
    cwd = (cwd or Path.cwd()).resolve()
    analysis = _analyze_bash_command(
        command,
        output_root.expanduser().resolve(),
        cwd,
        environ,
    )
    if analysis["legacyError"]:
        return False, analysis["legacyError"]
    protected = analysis["protectedActions"]
    actions = [*protected, *analysis["readOnlyActions"]]
    if not environ.get("VIDEOCLAW_API_KEY", "").strip():
        non_free = next(
            (
                action
                for action in actions
                if action.get("spendRisk") != "free"
            ),
            None,
        )
        if non_free is not None:
            return False, json.dumps(
                {
                    "schema": AUTHORIZATION_REQUIRED_SCHEMA,
                    "status": "authorization_required",
                    "operation": non_free["name"],
                    "reason": {
                        "code": "GATEWAY_AUTHORIZATION_MISSING",
                        "message": (
                            "non-free or unclassified production requires a "
                            "gateway credential"
                        ),
                    },
                    "alternatives": [
                        {
                            "action": "use_zero_cost_path",
                            "strategies": [
                                "reuse existing media",
                                "use local editing and rendering",
                            ],
                        },
                        {
                            "action": "supply_authorization",
                            "mechanism": "VIDEOCLAW_API_KEY",
                        },
                    ],
                },
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
    if not protected:
        return True, "no protected canonical production action"

    for action in protected:
        mismatch = (_explicit_image_model_mismatch(action, output_root, cwd)
                    or _unavailable_video_mode(action))
        if mismatch:
            return False, mismatch
    # Check every job first: a command that touches one routable job and one
    # refused job is refused as a whole and records no route at all.
    for action in protected:
        current, reason, routable = route_precheck(
            action["jobId"], engine_root, output_root, cwd, environ
        )
        if not current and routable is None:
            return False, f"{action['name']}: {reason}"
    for action in protected:
        valid, reason = ensure_current_route(
            action["jobId"],
            engine_root,
            output_root,
            cwd,
            environ,
            trigger=action["name"],
        )
        if not valid:
            return False, f"{action['name']}: {reason}"
    return True, "all protected production actions have current route receipts"


def _explicit_image_model_mismatch(
    action: dict[str, Any],
    output_root: Path,
    cwd: Path,
) -> str | None:
    """Fail closed on image rails the engine cannot price or execute exactly.

    Spending authority is deliberately absent here. The host prices the exact
    argv separately through ``cost.py plan`` and the gateway enforces permission
    at the paid-operation boundary.
    """
    if action.get("name") != "mint_image":
        return None
    argv = action.get("argv")
    if not isinstance(argv, list):
        return "mint_image: execution argv is unavailable for model validation"
    requested = _arg_value(argv[1:], "--model")
    if requested == "default":
        requested = None
    role = _arg_value(argv[1:], "--role")
    if not isinstance(role, str):
        return "mint_image: execution --role is required for model validation"
    if requested is not None and requested not in IMAGE_CLI_MODEL_TO_RESOLVED:
        return "mint_image: execution --model is not an allowed image rail"
    return None


def _unavailable_video_mode(action: dict[str, Any]) -> str | None:
    if action.get("name") != "mint_video" or not isinstance(action.get("argv"), list):
        return None
    return MINT_VIDEO_UNAVAILABLE_MODES.get(_arg_value(action["argv"][1:], "--mode"))


def _unique_sorted_actions(actions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    unique = {
        (
            action["family"],
            action["name"],
            action["jobId"],
            action["spendRisk"],
            tuple(action["argv"]) if action["argv"] is not None else None,
        ): action
        for action in actions
    }
    return [
        dict(unique[key])
        for key in sorted(
            unique,
            key=lambda value: tuple("" if item is None else str(item) for item in value),
        )
    ]


def _aggregate_action_family(actions: list[dict[str, Any]]) -> str:
    families = sorted({action["family"] for action in actions})
    if not families:
        return "none"
    return families[0] if len(families) == 1 else "mixed"


def _aggregate_spend_risk(actions: list[dict[str, Any]]) -> str:
    risks = {action["spendRisk"] for action in actions}
    if "unknown" in risks:
        return "unknown"
    if "paid" in risks:
        return "paid"
    return "free"


def _verdict_error(
    command: str,
    code: str,
    message: str,
    actions: list[dict[str, Any]] | None = None,
    job_ids: list[str] | None = None,
) -> dict[str, Any]:
    actions = _unique_sorted_actions(actions or [])
    return {
        "analyzer": PRODUCTION_ANALYZER,
        "commandSha256": hashlib.sha256(command.encode("utf-8")).hexdigest(),
        "schema": PRODUCTION_VERDICT_SCHEMA,
        "classification": "ambiguous",
        "routeCurrent": False,
        "jobIds": sorted(set(job_ids or [])),
        "actionFamily": _aggregate_action_family(actions),
        "spendRisk": "unknown",
        "actions": actions,
        "jobs": [],
        "error": {"code": code, "message": message},
    }


def bash_production_verdict(
    command: str,
    engine_root: Path,
    workspace_root: Path,
    output_root: Path,
    cwd: Path,
    environ: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Return the strict machine-readable route facts consumed by the app.

    This is not a spending-approval oracle. `routeCurrent=true` means only that
    the installed engine classified the raw command and found a current receipt.
    The exact ``actions`` metadata lets any host price and authorize paid work
    without coupling that decision to the engine's bootstrap receipt.
    """
    environ = dict(os.environ if environ is None else environ)
    supplied_paths = {
        "engine_root": engine_root,
        "workspace_root": workspace_root,
        "output_root": output_root,
        "cwd": cwd,
    }
    if any(not path.expanduser().is_absolute() for path in supplied_paths.values()):
        return _verdict_error(
            command,
            "strict_context_mismatch",
            "strict verdict path arguments must be absolute",
        )
    engine_root = engine_root.expanduser().resolve()
    workspace_root = workspace_root.expanduser().resolve()
    output_root = output_root.expanduser().resolve()
    cwd = cwd.expanduser().resolve()

    try:
        analysis = _analyze_bash_command(command, output_root, cwd, environ)
    except Exception as exc:
        return _verdict_error(
            command,
            "classifier_error",
            f"production classifier failed closed: {exc}",
        )
    raw_actions = [
        *analysis["protectedActions"],
        *analysis["readOnlyActions"],
    ]
    normalized_actions: list[dict[str, Any]] = []
    try:
        for action in raw_actions:
            normalized = dict(action)
            if isinstance(action.get("jobId"), str):
                normalized["jobId"] = resolve_job_dir(
                    action["jobId"],
                    output_root,
                    cwd,
                )[0]
            normalized_actions.append(normalized)
    except ValueError as exc:
        return _verdict_error(
            command,
            "invalid_job_identity",
            str(exc),
            raw_actions,
        )
    actions = _unique_sorted_actions(normalized_actions)
    job_ids = sorted(
        {
            action["jobId"]
            for action in actions
            if isinstance(action.get("jobId"), str)
        }
    )
    if analysis["strictError"]:
        return _verdict_error(
            command,
            "unsupported_or_ambiguous_shell",
            analysis["strictError"],
            actions,
            job_ids,
        )

    # Strict mode is an installed-product contract. A source checkout is useful
    # for the legacy hook and selftests, but it is not a trust root for the app.
    if not (engine_root / "ENGINE_VERSION.json").is_file():
        return _verdict_error(
            command,
            "strict_validator_not_installed",
            "strict verdicts require an installed engine with ENGINE_VERSION.json",
            actions,
            job_ids,
        )
    required_paths = {
        "VIDEOCLAW_ENGINE": engine_root,
        "VIDEOCLAW_WORKSPACE": workspace_root,
        "VIDEOCLAW_JOBS_DIR": output_root,
    }
    for name, expected in required_paths.items():
        raw = environ.get(name, "").strip()
        if not raw:
            return _verdict_error(
                command,
                "strict_context_missing",
                f"strict verdicts require trusted {name}",
                actions,
                job_ids,
            )
        supplied = Path(raw).expanduser()
        if not supplied.is_absolute() or supplied.resolve() != expected:
            return _verdict_error(
                command,
                "strict_context_mismatch",
                f"{name} does not match the trusted invocation context",
                actions,
                job_ids,
            )
    if cwd != workspace_root:
        return _verdict_error(
            command,
            "strict_context_mismatch",
            "Bash cwd does not match the trusted workspace root",
            actions,
            job_ids,
        )
    try:
        # Strict desktop execution is a stronger contract than standalone
        # receipt validation. Preserve runner attestation here without making
        # it a prerequisite for native CLI use of the installed engine.
        _required_sha256_env(BUILD_DIGEST_ENV, environ)
        if not environ.get(CONTEXT_EPOCH_ENV, "").strip():
            raise RouteReceiptError(
                f"strict verdicts require trusted {CONTEXT_EPOCH_ENV}"
            )
        for env_name in EFFECTIVE_HASH_ENVS.values():
            _required_sha256_env(env_name, environ)
        # These calls verify the installed artifact digest, effective
        # laws/preflight/settings bytes, validator bytes, and context epoch.
        engine_identity(engine_root, environ)
        production_context_identity(engine_root, environ)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        return _verdict_error(
            command,
            "strict_context_invalid",
            str(exc),
            actions,
            job_ids,
        )

    if len(job_ids) > 1:
        return _verdict_error(
            command,
            "multiple_job_ids",
            "one Bash call may not mutate production state for multiple jobs",
            actions,
            job_ids,
        )

    classification = (
        "protected" if analysis["protectedActions"] else "read_only"
    )
    jobs: list[dict[str, Any]] = []
    if classification == "protected":
        if len(job_ids) != 1:
            return _verdict_error(
                command,
                "job_identity_required",
                "a protected production action requires one unambiguous job id",
                actions,
                job_ids,
            )
        try:
            for action in actions:
                mismatch = _explicit_image_model_mismatch(
                    action,
                    output_root,
                    cwd,
                ) or _unavailable_video_mode(action)
                if mismatch:
                    raise RouteReceiptError(mismatch)
            # Last engine check before the facts: record the bound job's route
            # when it is missing or stale instead of refusing the call. A host
            # that binds no job, or a call for another job, keeps the refusal.
            routed, route_reason = ensure_current_route(
                job_ids[0],
                engine_root,
                output_root,
                cwd,
                environ,
                trigger=sorted(
                    {action["name"] for action in analysis["protectedActions"]}
                )[0],
            )
            if not routed:
                raise RouteReceiptError(route_reason)
            facts = current_receipt_facts(
                job_ids[0],
                engine_root,
                output_root,
                cwd,
                environ,
            )
            jobs.append(facts)
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            return {
                "analyzer": PRODUCTION_ANALYZER,
                "commandSha256": hashlib.sha256(command.encode("utf-8")).hexdigest(),
                "schema": PRODUCTION_VERDICT_SCHEMA,
                "classification": classification,
                "routeCurrent": False,
                "jobIds": job_ids,
                "actionFamily": _aggregate_action_family(actions),
                "spendRisk": _aggregate_spend_risk(actions),
                "actions": actions,
                "jobs": [],
                "error": {
                    "code": "receipt_not_current",
                    "message": str(exc),
                },
            }

    return {
        "analyzer": PRODUCTION_ANALYZER,
        "commandSha256": hashlib.sha256(command.encode("utf-8")).hexdigest(),
        "schema": PRODUCTION_VERDICT_SCHEMA,
        "classification": classification,
        "routeCurrent": True,
        "jobIds": job_ids,
        "actionFamily": _aggregate_action_family(actions),
        "spendRisk": _aggregate_spend_risk(actions),
        "actions": actions,
        "jobs": jobs,
        "error": None,
    }


def production_verdict_json(verdict: dict[str, Any]) -> str:
    """Canonical one-line wire encoding for the desktop subprocess boundary."""
    return json.dumps(
        verdict,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def prepare(
    job: str,
    workflow_args: list[str],
    engine_root: Path,
    output_root: Path,
    cwd: Path | None = None,
    stream: Any = sys.stdout,
) -> Path:
    if not _JOB_ID_RE.fullmatch(job) or job in {".", ".."}:
        raise RouteReceiptError(
            "--job must be one safe bare id (for example "
            "'china-history-20260724-a1b2c3'), never a jobs/ path"
        )
    job_id, job_dir = resolve_job_dir(job, output_root, cwd)
    selections = resolve_workflow_selection(workflow_args, engine_root)
    with _job_receipt_lock(job_dir):
        # Recovery is deliberately writer-only and lock-protected. Readers fail
        # closed on every malformed byte; the next prepare may remove only a
        # provably incomplete, non-newline-terminated final JSON prefix.
        history = read_receipt_history(job_dir, recover_torn_tail=True)
        next_version = len(history) + 1
        if not history and (job_dir / RECEIPT_NAME).is_file():
            next_version = 2
        receipt = build_receipt(
            job_id,
            selections,
            engine_root,
            receipt_version=next_version,
        )
        # Every call is a context handoff and returns the exact routed docs. There
        # is no second plan-lock phase or human-approval state transition.
        emit_reading_set(engine_root, selections, stream)
        # The receipt must describe the exact bytes just emitted. If a route file or
        # engine checkout changes during the read, leave no misleading receipt.
        if receipt["router"]["sha256"] != _sha256_file(engine_root.resolve() / ROUTER_REL):
            raise RouteReceiptError(f"{ROUTER_REL} changed while preparing; rerun")
        for item, (_, path) in zip(receipt["selected"], selections):
            if item["sha256"] != _sha256_file(path):
                raise RouteReceiptError(f"{item['path']} changed while preparing; rerun")
        if receipt["engine"] != engine_identity(engine_root):
            raise RouteReceiptError("engine identity changed while preparing; rerun")
        if receipt["context"] != production_context_identity(engine_root):
            raise RouteReceiptError("production context changed while preparing; rerun")
        receipt_path = write_receipt_atomic(receipt, job_dir, history)
    print(
        f"\nROUTE RECEIPT WRITTEN → {receipt_path} "
        f"({len(selections)} selected workflows; schema {RECEIPT_SCHEMA}; "
        f"version {receipt['receipt_version']}; "
        "bootstrap CURRENT)",
        file=stream,
    )
    print(
        f"CANONICAL JOB ID → {job_id} "
        "(use this exact bare value for every --job)",
        file=stream,
    )
    print(
        "NEXT → use the routed guidance and continue production. You may explain or "
        "revise your plan in ordinary conversation, but the engine does not require "
        "a plan record or creative approval. Request genuinely missing user inputs "
        "only before the step that needs them. Paid operations are independently "
        "authorized by the current host/gateway at their operation boundary.",
        file=stream,
    )
    return receipt_path


class _SelfTest:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def check(self, name: str, condition: bool) -> None:
        if condition:
            self.passed += 1
            print(f"  PASS {name}")
        else:
            self.failed += 1
            print(f"  FAIL {name}")

    def raises(self, name: str, fn: Any) -> None:
        try:
            fn()
        except RouteReceiptError:
            self.check(name, True)
        else:
            self.check(name, False)


def selftest() -> int:
    test = _SelfTest()
    repo_engine = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="videoclaw-route-selftest-") as temp:
        root = Path(temp)
        engine = root / "engine"
        workflows = engine / "workflows"
        nested = workflows / "duplication"
        output = root / "workspace" / "jobs"
        nested.mkdir(parents=True)
        output.mkdir(parents=True)
        (engine / "pyproject.toml").write_text(
            '[project]\nname = "fixture"\nversion = "9.9.9"\n',
            encoding="utf-8",
        )
        for rel in ENFORCEMENT_FILES.values():
            path = engine / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            if rel == ENFORCEMENT_FILES["settings"]:
                path.write_bytes((repo_engine / rel).read_bytes())
            else:
                path.write_text(f"fixture: {rel}\n", encoding="utf-8")
        (workflows / "README.md").write_text(
            "# Router\n[a](a.md) · [b](b.md) · [nested](duplication/README.md)\n",
            encoding="utf-8",
        )
        (workflows / "a.md").write_text("# A\n", encoding="utf-8")
        (workflows / "b.md").write_text("# B\n", encoding="utf-8")
        (nested / "README.md").write_text("[c](c.md)\n", encoding="utf-8")
        (nested / "c.md").write_text("# C\n", encoding="utf-8")
        (root / "outside.md").write_text("# Outside\n", encoding="utf-8")

        selected = ["workflows/a.md", "workflows/b.md"]
        test.raises(
            "rejects one selected workflow",
            lambda: resolve_workflow_selection(selected[:1], engine),
        )
        test.raises(
            "rejects four selected workflows",
            lambda: resolve_workflow_selection(selected * 2, engine),
        )
        test.raises(
            "rejects path traversal",
            lambda: resolve_workflow_selection(
                ["workflows/a.md", "../outside.md"], engine
            ),
        )
        nested_selection = resolve_workflow_selection(
            ["workflows/a.md", "workflows/duplication/c.md"], engine
        )
        test.check(
            "accepts nested router-reachable workflow",
            nested_selection[1][0] == "workflows/duplication/c.md",
        )
        test.raises(
            "rejects nested router index as a selected recipe",
            lambda: resolve_workflow_selection(
                ["workflows/a.md", "workflows/duplication/README.md"], engine
            ),
        )

        sink = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
        prepare("job-a", selected, engine, output, stream=sink)
        valid, reason = validate_receipt("job-a", engine, output)
        test.check(
            "current bootstrap route is sufficient for production",
            valid,
        )
        plan_path = output / "job-a" / PLAN_NAME
        plan = {"notes": "Optional agent-authored production plan."}
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        valid, reason = validate_receipt("job-a", engine, output)
        test.check(
            "optional promise does not participate in route authorization",
            valid,
        )
        changed_plan = json.loads(plan_path.read_text(encoding="utf-8"))
        changed_plan["notes"] += " Keep the payoff late."
        plan_path.write_text(json.dumps(changed_plan), encoding="utf-8")
        valid, reason = validate_receipt("job-a", engine, output)
        test.check(
            "optional promise edits do not stale the bootstrap route",
            valid,
        )

        law = engine / ENFORCEMENT_FILES["laws"]
        original_law = law.read_text(encoding="utf-8")
        law.write_text(f"{original_law}changed\n", encoding="utf-8")
        valid, reason = validate_receipt("job-a", engine, output)
        test.check(
            "rejects stale effective law hash",
            not valid and "production context changed" in reason,
        )
        law.write_text(original_law, encoding="utf-8")
        prepare("job-a", selected, engine, output, stream=sink)

        receipt_a = output / "job-a" / RECEIPT_NAME
        receipt_b_dir = output / "job-b"
        receipt_b_dir.mkdir()
        (receipt_b_dir / RECEIPT_NAME).write_bytes(receipt_a.read_bytes())
        valid, reason = validate_receipt("job-b", engine, output)
        test.check("rejects receipt for wrong job", not valid and "belongs to" in reason)

        (workflows / "a.md").write_text("# A changed\n", encoding="utf-8")
        valid, reason = validate_receipt("job-a", engine, output)
        test.check("rejects stale selected-document hash", not valid and "changed" in reason)
        (workflows / "a.md").write_text("# A\n", encoding="utf-8")

        prepare("job-a", selected, engine, output, stream=sink)
        (workflows / "README.md").write_text(
            "# Router changed\n[a](a.md) · [b](b.md)\n", encoding="utf-8"
        )
        valid, reason = validate_receipt("job-a", engine, output)
        test.check("rejects stale router hash", not valid and "README.md changed" in reason)
        (workflows / "README.md").write_text(
            "# Router\n[a](a.md) · [b](b.md) · [nested](duplication/README.md)\n",
            encoding="utf-8",
        )
        prepare("job-a", selected, engine, output, stream=sink)

        # Paid canonical tools remain usable from a standalone host when that
        # host supplies its own gateway credential. Keep the self-test value
        # synthetic: evaluation checks only presence and never contacts the
        # gateway.
        authorized_env = {
            **os.environ,
            "VIDEOCLAW_API_KEY": "vc_selftest_authorized",
        }
        # A standalone CLI host owns every job under its jobs dir, so the guard
        # routes a missing job itself. A host that exports a context epoch but
        # binds no job keeps the refusal; the classifier checks below run in
        # that mode so a missed launcher still shows up as an allowed call.
        standalone_env = {
            key: value
            for key, value in authorized_env.items()
            if key not in {BOUND_JOB_ENV, CONTEXT_EPOCH_ENV}
        }
        unbound_host_env = {
            **standalone_env,
            CONTEXT_EPOCH_ENV: "selftest-unbound-host",
        }

        allowed, _ = evaluate_bash_command(
            "uv run python tools/analyze_reference.py --job job-a --video ref.mp4",
            engine,
            output,
            environ=authorized_env,
        )
        test.check("allows reference analysis before production", allowed)
        allowed, _ = evaluate_bash_command(
            "uv run python tools/render_timeline_strip.py --job job-a --video ref.mp4",
            engine,
            output,
        )
        test.check("allows read-only QA/analysis", allowed)
        allowed, _ = evaluate_bash_command(
            "uv run python tools/synth_voice.py --mode transcribe --job job-missing",
            engine,
            output,
            environ=authorized_env,
        )
        test.check("allows mode-sensitive transcription", allowed)
        for command, name in (
            (
                "uv run python tools/lipsync_footage.py plan "
                "--job job-missing",
                "allows lipsync plan before production",
            ),
            (
                "uv run python tools/lipsync_footage.py face-envelope "
                "--job job-missing --video input.mp4",
                "allows face-envelope before production",
            ),
            (
                "uv run python tools/build_character_sheet.py --dry-run "
                "--from-photos refs --out sheet.png",
                "allows character-sheet dry run before production",
            ),
        ):
            allowed, _ = evaluate_bash_command(command, engine, output)
            test.check(name, allowed)
        transcript_command = (
            "uv run python tools/clean_audio.py --mode trim "
            "--transcribe-only --job job-missing --input input.wav"
        )
        allowed, _ = evaluate_bash_command(transcript_command, engine, output)
        test.check(
            "blocks unclassified transcript spend without gateway", not allowed
        )
        allowed, _ = evaluate_bash_command(
            transcript_command, engine, output, environ=authorized_env
        )
        test.check(
            "allows transcript-only audio inspection with gateway", allowed
        )
        allowed, _ = evaluate_bash_command(
            "uv run python tools/mint_video.py --job job-a --role keyframe --prompt x",
            engine,
            output,
            environ=authorized_env,
        )
        test.check("allows protected generation with current receipt", allowed)
        allowed, reason = evaluate_bash_command(
            "uv run python tools/compose_render.py --job job-missing --mode render",
            engine,
            output,
            environ=unbound_host_env,
        )
        test.check(
            "unbound host keeps the refusal for a protected render without receipt",
            not allowed
            and "no route-receipt.json" in reason
            and not (output / "job-missing" / RECEIPT_NAME).exists(),
        )
        allowed, reason = evaluate_bash_command(
            "uv run python tools/compose_render.py --job job-auto --mode render",
            engine,
            output,
            environ=standalone_env,
        )
        auto_history = read_receipt_history(output / "job-auto")
        test.check(
            "standalone first production call records its own route",
            allowed
            and validate_receipt("job-auto", engine, output, environ=standalone_env)[0]
            and auto_history[-1].get("auto_route")
            == {"trigger": "compose_render", "reason": "missing"},
        )
        for command, name in (
            (
                "ffmpeg -y -i /tmp/input.mp4 jobs/job-missing/final.mp4",
                "blocks raw ffmpeg job output without receipt",
            ),
            (
                "npx remotion render remotion/src/index.ts Captioned "
                "jobs/job-missing/final.mp4",
                "blocks direct Remotion job output without receipt",
            ),
            (
                "curl -sS -X POST https://api.replicate.com/v1/predictions "
                "-d '{}' -o jobs/job-missing/provider.json",
                "blocks mutating provider API job output without receipt",
            ),
            (
                "python -c \"import replicate; replicate.run('owner/model')\" "
                "--job job-missing",
                "blocks dynamic provider SDK execution without receipt",
            ),
            (
                "bash -c 'ffmpeg -y -i /tmp/input.mp4 "
                "jobs/job-missing/nested.mp4'",
                "blocks nested-shell ffmpeg job output without receipt",
            ),
            (
                "nice -n 5 ffmpeg -y -i /tmp/input.mp4 "
                "jobs/job-missing/nice.mp4",
                "blocks wrapped ffmpeg job output without receipt",
            ),
            (
                "uv run python -c \"import replicate; "
                "replicate.run('owner/model')\" --job job-missing",
                "blocks uv-wrapped dynamic provider execution without receipt",
            ),
            (
                "F=ffmpeg; $F -y -i /tmp/input.mp4 "
                "jobs/job-missing/aliased.mp4",
                "blocks shell-aliased ffmpeg job output without receipt",
            ),
            (
                "python -c \"import subprocess; "
                "subprocess.run(['ffmpeg','-i','/tmp/in.mp4',"
                "'jobs/job-missing/dynamic.mp4'])\"",
                "blocks dynamically launched ffmpeg job output without receipt",
            ),
            (
                "node -e \"require('child_process').execSync("
                "'npx remotion render Entry Comp jobs/job-missing/node.mp4')\"",
                "blocks dynamically launched Remotion job output without receipt",
            ),
        ):
            allowed, reason = evaluate_bash_command(
                command,
                engine,
                output,
                output.parent,
                environ=unbound_host_env,
            )
            raw_provider = "provider" in name
            raw_remotion = "Remotion" in name
            test.check(
                name,
                not allowed
                and (
                    "raw network/control-plane" in reason
                    or "raw provider mutation" in reason
                    if raw_provider
                    else "compose_render.py --mode bespoke" in reason
                    if raw_remotion
                    else "job-missing" in reason
                ),
            )

        for command, name in (
            (
                "ffmpeg -y -i /tmp/input.mp4 jobs/job-a/final.mp4",
                "allows raw ffmpeg job output with current receipt",
            ),
            (
                "npx remotion render remotion/src/index.ts Captioned "
                "jobs/job-a/final.mp4",
                "blocks direct Remotion job output despite current receipt",
            ),
            (
                "python -c \"import replicate; replicate.run('owner/model')\" "
                "--job job-a",
                "blocks dynamic provider SDK execution despite current receipt",
            ),
        ):
            allowed, _ = evaluate_bash_command(
                command,
                engine,
                output,
                output.parent,
            )
            test.check(
                name,
                not allowed if "blocks" in name else allowed,
            )

        for command, name in (
            (
                "ffprobe jobs/job-missing/final.mp4",
                "allows ffprobe inspection without receipt",
            ),
            (
                "ffmpeg -i jobs/job-missing/final.mp4 -f null -",
                "allows ffmpeg null inspection without receipt",
            ),
            (
                "ffmpeg -ss 1 -i jobs/job-missing/final.mp4 "
                "-frames:v 1 /tmp/inspection.png",
                "allows ffmpeg frame inspection outside jobs",
            ),
            (
                "npx remotion compositions jobs/job-missing/src/index.ts",
                "allows Remotion composition inspection without receipt",
            ),
            (
                "curl -sS https://api.replicate.com/v1/models",
                "allows provider HTTP GET inspection without receipt",
            ),
            (
                "python -c \"import replicate; print(replicate.__version__)\"",
                "allows provider SDK metadata inspection without receipt",
            ),
            (
                "python -c \"print('ffmpeg jobs/job-missing/example.mp4')\"",
                "allows inert command-text inspection without receipt",
            ),
            # Issue #204 reader negatives: the 21/23 false-positive fix. A
            # provider host, an SDK symbol, or the word POST inside a reader's
            # argv is DATA, and a provable GET is as free as `curl -sS`.
            (
                'grep -rn "openrouter.ai" tools/',
                "allows grepping a provider host without receipt",
            ),
            (
                "sed -n '/api.replicate.com/p' run.log",
                "allows sed -n p over provider text without receipt",
            ),
            (
                "find jobs -name '*.mp4' -exec ffprobe {} ;",
                "allows find -exec inspection without receipt",
            ),
            (
                'python -c "import requests; '
                "requests.get('https://api.replicate.com/v1/models')\"",
                "allows a generic-client provider GET without receipt",
            ),
        ):
            allowed, _ = evaluate_bash_command(
                command,
                engine,
                output,
                output.parent,
            )
            test.check(name, allowed)

        # Raw mutations are never an authorization lane, even for an arbitrary
        # host or when a current route receipt exists. These strings are
        # CLASSIFIER INPUT ONLY; nothing here opens a socket.
        for command, name in (
            (
                "curl -X POST https://example.com/webhook -d @b.json",
                "blocks a mutating POST to a non-provider host",
            ),
            (
                'curl -s -X POST "$VIDEOCLAW_GATEWAY/v1/gen/image" '
                '-H "Authorization: Bearer $VIDEOCLAW_API_KEY" -d @b.json',
                "blocks a metered call to our own gateway",
            ),
            (
                "curl -s -X POST https://openrouter.ai/api/v1/chat/completions "
                "-d @b.json",
                "blocks a direct-key openrouter call",
            ),
            (
                'python -c "import requests; '
                "requests.post('https://api.replicate.com/v1/predictions')\"",
                "blocks a generic HTTP client against a listed host",
            ),
            (
                'python -c "from google import genai; '
                "genai.Client().models.generate_content(model='m', contents='c')\"",
                "blocks a vendor SDK call that names no host",
            ),
            (
                "curl -X POST https://api.replicate.com/v1/predictions -d @b.json",
                "blocks the already-caught positive control",
            ),
            (
                "wget --post-data=@b.json "
                "https://openrouter.ai/api/v1/chat/completions",
                "blocks a non-curl client with a bare HTTP method",
            ),
        ):
            allowed, reason = evaluate_bash_command(
                command,
                engine,
                output,
                output.parent,
            )
            test.check(
                name,
                not allowed and "raw network/control-plane" in reason,
            )

        allowed, reason = evaluate_bash_command(
            "python -c \"import replicate; replicate.run('owner/model')\"",
            engine,
            output,
            output.parent,
        )
        test.check(
            "blocks mutating provider execution without job identity",
            not allowed
            and (
                "raw provider mutation" in reason
                or "requires --job" in reason
            ),
        )
        protected_launchers = (
            "uv run tools/mint_image.py --job job-missing --role card",
            "python3.12 tools/mint_image.py --job job-missing --role card",
            "python -X dev tools/mint_image.py --job job-missing --role card",
            "python -m mint_image --job job-missing --role card",
            "/usr/bin/time python tools/mint_image.py --job job-missing --role card",
            "{ uv run python tools/mint_image.py --job job-missing --role card; }",
        )
        for command in protected_launchers:
            allowed, reason = evaluate_bash_command(
                command, engine, output, environ=unbound_host_env
            )
            test.check(
                f"blocks bypass launcher: {command.split('--job', 1)[0].strip()}",
                not allowed and "job-missing" in reason,
            )
        allowed, _ = evaluate_bash_command(
            "uv run python tools/mint_video.py --job $JOB --role keyframe",
            engine,
            output,
            environ={**authorized_env, "JOB": "job-a"},
        )
        test.check("resolves job shell variable from hook environment", allowed)
        allowed, reason = evaluate_bash_command(
            "uv run python tools/mint_image.py --job job-a "
            "--job job-missing --role card --prompt x",
            engine,
            output,
            environ=unbound_host_env,
        )
        test.check(
            "validates argparse's last repeated job flag",
            not allowed and "job-missing" in reason,
        )
        allowed, _ = evaluate_bash_command(
            "uv run python tools/synth_voice.py --mode transcribe --mode tts "
            "--job job-missing",
            engine,
            output,
        )
        test.check("protects argparse's last repeated production mode", not allowed)
        allowed, _ = evaluate_bash_command(
            "uv run python tools/assemble.py --job job-missing --check",
            engine,
            output,
        )
        test.check("allows read-only assembly check", allowed)
        allowed, reason = evaluate_bash_command(
            "uv run python tools/prepare_production.py --job job-a "
            "--workflow workflows/a.md --workflow workflows/b.md | head",
            engine,
            output,
        )
        test.check("allows filtered prepare output", allowed)
        allowed, reason = evaluate_bash_command(
            "uv run tools/prepare_production.py --job job-a "
            "--workflow workflows/a.md --workflow workflows/b.md "
            "> /tmp/hidden",
            engine,
            output,
        )
        test.check("allows direct-uv prepare stdout redirection", allowed)

        (engine / "ENGINE_VERSION.json").write_text(
            json.dumps(
                {
                    "version": "9.9.9",
                    "gitSha": "fixture-sha",
                    "gitBranch": "fixture",
                    "gitDirty": "clean",
                }
            ),
            encoding="utf-8",
        )
        standalone_identity = engine_identity(engine, {})
        test.check(
            "installed identity supports a content-bound standalone host",
            standalone_identity.get("source") == "installed-package"
            and bool(
                _SHA256_RE.fullmatch(
                    str(standalone_identity.get("buildSha256", ""))
                )
            ),
        )
        installed_env = {
            BUILD_DIGEST_ENV: "a" * 64,
            CONTEXT_EPOCH_ENV: "context-epoch-a",
        }
        for role, env_name in EFFECTIVE_HASH_ENVS.items():
            installed_env[env_name] = _sha256_file(
                engine / ENFORCEMENT_FILES[role]
            )
        identity = engine_identity(engine, installed_env)
        test.check(
            "installed identity binds verified artifact digest",
            identity.get("buildSha256") == "a" * 64,
        )
        context_a = production_context_identity(engine, installed_env)
        installed_env[CONTEXT_EPOCH_ENV] = "context-epoch-b"
        context_b = production_context_identity(engine, installed_env)
        test.check(
            "context epoch rotation invalidates prior identity",
            context_a["epochSha256"] != context_b["epochSha256"],
        )

        settings_path = engine / ENFORCEMENT_FILES["settings"]
        canonical_settings = settings_path.read_text(encoding="utf-8")
        # Three hook scripts plus the venv interpreter of the two Python hooks.
        test.check(
            "canonical settings use portable engine paths for all hooks",
            not portable_settings_errors(settings_path)
            and canonical_settings.count(PORTABLE_ENGINE_ROOT) == 5,
        )
        nonportable_settings = json.loads(canonical_settings)
        nonportable_settings["hooks"]["SessionStart"][0]["hooks"][0]["command"] = (
            'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/preflight.sh"'
        )
        settings_path.write_text(
            json.dumps(nonportable_settings, indent=2) + "\n",
            encoding="utf-8",
        )
        for role, env_name in EFFECTIVE_HASH_ENVS.items():
            installed_env[env_name] = _sha256_file(
                engine / ENFORCEMENT_FILES[role]
            )
        test.raises(
            "context rejects non-portable canonical hook settings",
            lambda: production_context_identity(engine, installed_env),
        )
        settings_path.write_text(canonical_settings, encoding="utf-8")

        guard_run = subprocess.run(
            [
                sys.executable,
                str(repo_engine / ".claude/hooks/production_guard.py"),
            ],
            input=json.dumps(
                {
                    "tool_name": "mcp__device__bash",
                    "tool_input": {
                        "command": (
                            "uv run python tools/mint_image.py "
                            "--job hosted-missing --role card"
                        )
                    },
                    "cwd": str(repo_engine),
                }
            ),
            text=True,
            capture_output=True,
            env={
                **unbound_host_env,
                "VIDEOCLAW_ENGINE": str(repo_engine),
                "VIDEOCLAW_JOBS_DIR": str(output),
            },
            timeout=10,
            check=False,
        )
        test.check(
            "mcp__device__bash is guarded before hosted dispatch",
            guard_run.returncode == 2 and "blocked before execution" in guard_run.stderr,
        )

    total = test.passed + test.failed
    print(f"\nprepare_production selftest: {test.passed}/{total} passed")
    return 0 if test.failed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--job",
        help="safe bare job ID under VIDEOCLAW_JOBS_DIR; paths are rejected",
    )
    parser.add_argument(
        "--workflow",
        action="append",
        default=[],
        help="router-reachable workflow markdown path; repeat exactly 2-3 times",
    )
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="run hermetic receipt and guard tests (no network)",
    )
    args = parser.parse_args()
    if args.selftest:
        return selftest()
    if not args.job:
        parser.error("--job is required")

    engine_root = Path(__file__).resolve().parents[1]
    workspace = Path(os.environ.get("VIDEOCLAW_WORKSPACE", str(engine_root)))
    output_root = Path(
        os.environ.get("VIDEOCLAW_JOBS_DIR", str(workspace / "jobs"))
    )
    try:
        prepare(
            args.job,
            args.workflow,
            engine_root,
            output_root,
            cwd=Path.cwd(),
        )
        return 0
    except (RouteReceiptError, OSError, ValueError) as exc:
        print(f"prepare_production: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
