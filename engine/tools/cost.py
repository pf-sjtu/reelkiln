"""
cost.py — optional, side-effect-free cost discovery and paid-command metadata.

Cost discovery is side-effect free and independent from spending permission. This tool marries
OpenMontage's estimate->reconcile idea with videoclaw's live cost logging:
replicate_safe.safe_run already writes an `estimate_usd` onto every `replicate_call`
event (replicate_safe.py) — nothing ever rolled it up. This does.

The relevant subcommands are:

  estimate   Optional order-of-magnitude planning context for a proposed
             generation. NOT a quote or authorization — a table lookup.
               uv run python tools/cost.py estimate --tool mint_video --role keyframe --count 5
             EVERY paid mint_video rail, and lipsync_footage, is billed per
             SECOND. edit/reenact bill the MEDIA the tool probes, so hand the
             estimator that same file and it probes it too:
               … estimate --tool mint_video --role edit --media jobs/j1/pull/01.mp4
             insert/keyframe/multishot have no input media — they bill the
             duration the tool declares — so pass --seconds instead:
               … estimate --tool mint_video --role insert --seconds 15
             See PER_SECOND_BILLED_MEDIA and PER_SECOND_DECLARED_SECONDS for
             which length each rail bills.

  reconcile  Sum the estimate_usd already logged for a job's run and group it by
             tool/model. This is a historical local audit; the gateway ledger is
             authoritative for actual charges and reservations.
               uv run python tools/cost.py reconcile --job <id>

  quote      Ask the gateway for a side-effect-free price for one exact
             operation. A quote reports cost only; it never grants permission,
             reserves funds, or executes the operation.

  plan       Parse one canonical paid-tool command, price its actual argv, and
             bind every local input to an immutable fingerprint. The result is
             advisory metadata only; the host executes the original command
             through its own authorization boundary.

The PRICES table is deliberately ROUGH (order-of-magnitude, editable). It exists
for optional planning context, not billing or authorization. Backend model
prices drift; when one moves materially, update the unit here. Every entry hides
its backend behind the canonical tool + role/mode.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import math
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _ffmpeg import ffprobe_duration  # noqa: E402
from _batch_schema import QUALITY_BY_MODE, batch_item_media  # noqa: E402  (shared --batch schema, #74)
from job import add_job_arg, resolve_job_dir, resolve_job_input_path  # noqa: E402
from log import read_events  # noqa: E402

TOOL_NAME = "cost.py"

BILLING_PLAN_VERSION = 1
BILLING_CLI_CONTRACT_SCHEMA = "videoclaw.cost-cli-capabilities/v3"
BILLING_CLI_PLAN_CAPABILITY = "videoclaw.cost-cli.plan/v1"
# Advisory planning prices only. `estimate` never reserves, admits, or
# authorizes anything: exact quote/permit/admission remains `plan`'s and the
# gateway's job. Advertised so a host can rely on the estimator it already
# ships instead of guessing prices of its own.
BILLING_CLI_ESTIMATE_CAPABILITY = "videoclaw.cost-cli.estimate/v1"
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_SHELL_CONTROL = frozenset({";", "&&", "||", "|", "|&", "&", "<", ">", "(", ")"})
_COUNT_FLAGS = ("--count", "--variants", "--slides", "--num", "--n")
_ROLE_FLAGS = ("--role", "--mode", "--vision-mode", "--rail")
# File-bearing CLI arguments are parser-specific.  A global set is unsafe:
# pull_video's --bed is boolean and its --in is a timestamp, while
# verify_output resolves --input under the job directory instead of cwd.
_FILE_INPUTS_BY_TOOL: dict[str, frozenset[str]] = {
    "analyze_reference": frozenset({"--reference"}),
    "breakdown_reference": frozenset({"--video"}),
    "build_character_sheet": frozenset({"--from-photos"}),
    "build_carousel": frozenset({"--reference"}),
    "cast_avatar": frozenset({"--character-sheet"}),
    "check_script": frozenset({"--analysis"}),
    "clean_audio": frozenset({"--drops", "--input", "--queued-file", "--script"}),
    "compose_render": frozenset({
        "--ambience", "--card", "--cover", "--cover_image", "--episode_manifest",
        "--broll-inserts", "--lipsync", "--overlays-tsx", "--overlays_tsx",
        "--script", "--source_video",
    }),
    "densify": frozenset({"--input", "--transcript"}),
    "frame_insert": frozenset({"--base"}),
    "gemini_video": frozenset({"--url"}),
    "lipsync_footage": frozenset({"--audio", "--video"}),
    "mint_image": frozenset({
        "--audio-ref", "--base-frame", "--card", "--cover", "--cover-image",
        "--cover_image", "--first-frame", "--image", "--input", "--last-frame",
        "--batch", "--queued-file", "--ref", "--reference", "--start-image",
    }),
    "mint_video": frozenset({
        "--audio-ref", "--batch", "--driver-video", "--first-frame", "--image",
        "--last-frame", "--multishot-file", "--reference", "--source-video",
        "--source_video", "--start-image",
        "--swap-image", "--video",
    }),
    "pull_video": frozenset({"--batch", "--cookies", "--file"}),
    "review_output": frozenset({"--role-log", "--video"}),
    "sam3": frozenset({"--video"}),
    "score_bed": frozenset({"--input", "--music", "--sfx-manifest"}),
    "scrub_reference_vo": frozenset({"--audio"}),
    "script_preflight": frozenset({"--analysis"}),
    "stem_split": frozenset({"--input"}),
    "synth_voice": frozenset({"--audio", "--script", "--reference-audio"}),
    "verify_output": frozenset({"--beats", "--input", "--transcript"}),
}
_REPEATABLE_FILE_FLAGS = frozenset({
    "--audio-ref", "--reference", "--reference-audio", "--video",
})
_TOOL_OWNED_MANIFESTS = frozenset({
    "build_carousel", "cast_avatar", "compose_render", "look_at_video", "pull_video",
    "synth_voice",
})

# ---------------------------------------------------------------------------
# Rough per-UNIT USD, keyed by canonical tool → role/mode. A unit is one asset:
# one image, one ~5s clip, one voiced chunk, one lipsynced segment. `_default`
# applies when a role isn't listed. These are order-of-magnitude figures for the
# optional advisory estimates — NOT a billing or authorization source of truth.
# Update when a backend price moves materially. $0 = free path (local/user-supplied).
# ---------------------------------------------------------------------------
PRICES: dict[str, dict[str, float | None]] = {
    # CREATE — stills (Nano Banana 2 default, published 1K flat rate).
    # Explicit GPT A/B traffic is quoted by the gateway and its legacy local
    # fallback carries a model-specific estimator in mint_image.py.
    "mint_image": {
        "_default": 0.08, "card": 0.08, "seed_frame": 0.08, "overlay": 0.08,
        "cover": 0.08, "portrait": 0.08, "artistic_still": 0.08,
    },
    # CREATE — motion clips (~5s). Engine set by mode; hidden here.
    # EVERY mint_video rail is duration-priced at the backend — see PER_SECOND.
    # edit/reenact (chunk 31) bill the media they probe; insert/keyframe/
    # multishot (#78) bill the duration the tool DECLARES (see
    # PER_SECOND_DECLARED_SECONDS). These role rows remain the per-event
    # figures reconcile() imputes for produced assets, never a planning price.
    "mint_video": {
        "_default": 0.40, "insert": 0.35, "keyframe": 0.46, "multishot": 0.70,
        "reenact": 0.65, "edit": 1.05,
        # A 5s 720p Genjutsu transfer (5 × $0.681), rounded up to the cent.
        "genjutsu": 3.41,
    },
    # Character sheet — priced PER PANEL (a sheet is 3). nano-banana-2/edit
    # (default, through the gateway) is $0.08; the explicit gpt-image-2 A/B rail
    # uses the rectangular high-quality rate ($0.25).
    "build_character_sheet": {
        "_default": 0.08, "nano": 0.08, "gpt": 0.25,
    },
    "cast_avatar":    {"_default": 0.12},   # identity sheet (a few stills)
    # perform_avatar: one talking-head chunk. `script` is the full-script batch
    # shape (no --chunk selects EVERY chunk in script.json): a typical a-roll
    # is ~6 chunks, so the advisory total is 6 × the unit — order-of-magnitude
    # context instead of pricing one unit for an N-chunk run. The honest
    # media-accurate total requires probing the actual inputs.
    "perform_avatar": {"_default": 0.60, "script": 3.60},
    # synth_voice: one voiced chunk. `script` is the script-driven batch shape
    # (--script with no --chunk voices every chunk): ~10 chunks × $0.05.
    "synth_voice":    {"_default": 0.05, "transcribe": 0.05,
                       "reference_tts": 0.38,
                       "script": 0.50},
    # Reference decode: `timeline` is one Scribe pass ($0.05) plus exactly one
    # aggregate vision pass ($0.05). `vision` is the one aggregate visual
    # component and supports timeline-without-transcript accounting; the
    # unbounded paid per-shot CLI route is deliberately disabled.
    "breakdown_reference": {
        "_default": 0.10,
        "timeline": 0.10,
        "vision": 0.05,
        "timeline-no-transcript": 0.05,
    },
    "build_carousel": {"_default": 0.04},   # per generated slide illustration

    # TRANSFORM
    "lipsync_footage": {"_default": 0.30},  # one lipsynced segment
    "sam3":            {"_default": 0.12},  # one segmentation clip
    "frame_insert":    {"_default": 0.12},  # uses sam3 under the hood
    # One fixed-price gateway depth map per still (depth_map/estimate,
    # videoclaw#296 / backend#308: $0.02 per image). A re-run on the same still
    # reuses the saved map and costs nothing.
    "fx_parallax":     {"_default": 0.02},
    # The safe vendor-wrapper CLI (ALWAYS_PAID; logs its own estimate_usd per
    # call). This row is the advisory order-of-magnitude unit for one
    # clip-class call, so optional planning metadata is not blank — reconcile
    # still prefers the wrapper's logged real figures. Caught by the app's
    # check:money-drift invariant 4 (every declared spender has a row).
    "replicate_safe":  {"_default": 0.46},

    # ANALYZE / ACQUIRE / VERIFY — deny-by-default (app issue #156): every
    # gateway or direct-vendor spender carries a deterministic entry so the
    # engine's optional estimate is not null. Figures mirror the gateway
    # metering table (Scribe/qa_video $0.05, llm $0.02, stem_split $0.10,
    # media.pull $0.01, enumerate $0.05) — order-of-magnitude, not billing.
    # NOTE (#184 table, footnote 1): analyze_reference's vision spend is
    # metered under gemini_video/qa_video rows (job overlap 3/3). reconcile()
    # attributes those dollars to gemini_video and analyze_reference emits no
    # produced-asset events, so this advisory row never double-counts them.
    "analyze_reference": {"_default": 0.10},  # one Scribe pass + one vision pass
    # gemini_video: one metered call. `chunk_review_all` is the --chunk all
    # fan-out (one call PER chunk_*.mp4): the #184 table measured $1.78 for
    # that shape, so the batch role estimates the measured figure, not one unit.
    "gemini_video":      {"_default": 0.05, "chunk_review_all": 1.80},
    "check_script":      {"_default": 0.02},  # one metered language pass
    "review_output":     {"_default": 0.15,   # full sweep: video + audio + frame verifies
                          "full": 0.15,
                          "beat": 0.05},      # one windowed spot-check pass
    "verify_output":     {"_default": 0.05},  # transcribes the final cut (Scribe-class)
    # look_at_video (issue #271): the strips are local ffmpeg/PIL work; the only
    # spend is one Scribe pass per video with no transcript on hand, through the
    # same gateway rail as synth_voice[transcribe]. The unit is PER VIDEO (a
    # stack plans two); cache state is filesystem state, so the plan fails
    # closed at one pass per video. `--no-transcript` is argv-proven free.
    "look_at_video":     {"_default": 0.05, "transcribe": 0.05,
                          "no_transcript": 0.0},
    "script_preflight":  {"_default": 0.02},  # one metered language pass (direct key)
    "scrub_reference_vo": {"_default": 0.10}, # one stem-split separation
    "stem_split":        {"_default": 0.10},  # legacy standalone name for the same rail
    # decode_audio (issue #198) is local numpy/scipy + ffmpeg measurement in
    # every mode; its ONLY spend is resolve_ref handing a remote http(s)
    # reference to pull_video's own `_gateway_audio_rip` — POST /v1/media/pull
    # with audio_only, i.e. the exact rail `pull_video --mode pull
    # --audio-only` logs as usage_role "pull". It is deliberately NOT the `bed`
    # rail: bed is that acquisition PLUS a $0.10 stem separation (_build_bed →
    # _separate_stems) decode_audio never runs. `local` is the argv-proven
    # local/file:// form; `_default` fails closed at the acquisition unit
    # rather than $0 (the #156/#207 unpriced-latch hole). The unit is PER
    # REFERENCE, so `_pricing_request` counts the references execution will
    # resolve instead of quoting one unit per invocation.
    "decode_audio":    {"_default": 0.01, "reference_pull": 0.01, "local": 0.0},
    "pull_video":      {"_default": 0.06,     # conservative cap across modes
                        "pull": 0.01,         # metered acquisition (yt-dlp/gateway pull)
                        "select": 0.06,       # pull + video-QA window pick
                        "enumerate": 0.05,    # profile enumeration route
                        "meta_ads_quick": 1.00,
                        "meta_ads_standard": 3.00,
                        "meta_ads_deep": 8.00,
                        "bed": 0.11},         # --bed: acquisition + stem separation —
                                              # the #184 table measured this path running
                                              # a separation model with NO cost row at all
    "acquire_footage": {"_default": 0.06,     # deprecated alias of pull_video
                        "pull": 0.01,
                        "select": 0.06,
                        "enumerate": 0.05,
                        "bed": 0.11},
    "clean_audio":     {"_default": 0.05,     # transcription-backed trim/gate (one Scribe pass)
                        "trim": 0.05,
                        "denoise": 0.02,      # enhance model behind the gate (chunk 24), rounded up
                        "enhance": 0.016},    # raw per-run enhance figure; replicate_safe logs
                                              # the real estimate_usd per call.
    "densify":         {"_default": 0.15,     # ≈ 3 Scribe passes across an aroll tighten (#156)
                        "transcribe": 0.05},  # one Scribe pass
    "score_bed":       {"_default": 0.10,     # FAIL CLOSED: a score_bed kept PAID whose mode
                                              # can't be proven --mode bed (missing/duplicate/
                                              # ambiguous → role=None) prices the most-expensive
                                              # paid mode (split $0.10), NEVER $0 — a $0 here was
                                              # the #156/#207 unpriced-latch hole (score_bed in a
                                              # paid plan reported $0 → unknown-spend state latched).
                                              # bed stays FREE.
                        "bed": 0.0,           # user-supplied music + local ffmpeg: genuinely free
                        "recover": 0.0,       # retrieve an accepted result + local mixing; no generation
                        "generate": 0.05,     # Lyria clip ~$0.05 (full-song ~$0.08) — chunk 31
                        "split": 0.10},       # stem separation rail

    # index_media is command/backend-sensitive. Local/dummy embedding and
    # cache/metadata operations are free; Gemini embedding fan-out is
    # input-dependent and has no honest fixed per-command figure, so advisory
    # pricing reports UNKNOWN instead of the former false $0.
    "index_media":     {"_default": None, "free": 0.0, "gemini": None},
    # Direct image download plus local rasterization/background removal.
    "fetch_asset":     {"_default": 0.0},
    "sfx_catalog":    {"_default": 0.0, "search": 0.0, "fetch": 0.0},
    # compose_render: render/retrofit/cover_bake are local Remotion/ffmpeg.
    # --mode episode's make branch is a FIXED paid pipeline that spawns four
    # child spends; its price is the sum of its children's table prices. The
    # executor refuses VO longer than the same 60-second ceiling used here
    # before it starts the duration-priced lipsync child, so this figure is a
    # real maximum rather than an unbounded assumption:
    #   synth_voice[_default]            $0.05  (one episode VO call)
    #   lipsync_footage @ assumed 60s    $8.04  (0.134/s × ASSUMED_SECONDS)
    #   mint_image[card]                 $0.08  (one cover card)
    #   synth_voice[transcribe]          $0.05  (trigger-word Scribe pass)
    #   ------------------------------- $8.22
    # Episode VO length varies; the honest per-episode total requires probing
    # the actual inputs. _default carries the episode figure so an unknown
    # mode fails CLOSED to the most expensive shape, never to $0.
    "compose_render":  {"_default": 8.22, "episode": 8.22,
                        "episode_prebuilt_card": 8.14,
                        "episode_assemble": 0.0, "episode_manifest": 0.0,
                        "render": 0.0, "retrofit": 0.0, "cover_bake": 0.0,
                        "bespoke": 0.0},
}

# Published per-image GPT rollback rates: (square, rectangular). Keep the
# execution logger and immutable billing plan on this one table so a rollback
# cannot be planned at Nano's flat rate and logged at a different amount.
GPT_IMAGE_2_RATES: dict[str, tuple[float, float]] = {
    "low": (0.011, 0.016),
    "medium": (0.042, 0.063),
    "high": (0.167, 0.250),
}


def gpt_image_unit_price(quality: str, aspect: str) -> float:
    square, rectangular = GPT_IMAGE_2_RATES.get(
        quality, GPT_IMAGE_2_RATES["high"]
    )
    return square if aspect == "1:1" else rectangular

# DURATION-priced tools — billed per second of output video, NOT per call.
# Pass --media (the file listed in PER_SECOND_BILLED_MEDIA below) for the real
# length; a per-`count` estimate would be off by ~20x. Rate for lipsync_footage
# derived from aroll-reel.md's own worked example (~$6.70 / 50.26s).
PER_SECOND: dict[str, float] = {
    "lipsync_footage": 0.134,     # fal sync-3, per second of lipsynced video
    "mint_video:edit": 0.13,      # omni-flash v2v edit, per second of output (chunk 31)
    "mint_video:reenact": 0.13,   # omni-flash motion transfer, per output second
    "mint_video:multishot": 0.13, # omni-flash shot sequence, per output second
    # Seedance i2v (#78). The backend meters these PER SECOND and REFUSES a
    # non-positive duration, so the old flat per-call rows under-reserved by up
    # to ~50x on a long premium insert. The real rate is route-, resolution- AND
    # (on 2.5) aspect-dependent — see seedance_terminal_cost below. A generic
    # advisory estimate sees none of --quality/--resolution/--aspect-ratio, so
    # this row is deliberately the DEAREST reachable rate on the rail (standard
    # @1080p, dearer than every 2.5 geometry) — over-stating is the fail-closed
    # direction, and the exact figure comes from the argv-aware billing plan or
    # the gateway quote, both of which do see them.
    "mint_video:insert": 0.682,
    "mint_video:keyframe": 0.682,
    # Higgsfield Genjutsu bills whole INPUT seconds at a resolution-dependent
    # list rate (GENJUTSU_USD_PER_INPUT_SECOND). A generic advisory estimate
    # that names no --resolution prices mint_video's own default tier (720p),
    # which is what the tool runs unless the argv names another; the argv-aware
    # plan and the gateway quote price the exact tier, rounding each clip up to
    # whole seconds (review of #329: 1080p here asked for a $50 maximum on a
    # ~$3.49 one-face swap).
    "mint_video:genjutsu": 0.681,
}

# Higgsfield Genjutsu motion transfer, $/INPUT second by --resolution. An
# independent mirror of videoclaw-backend app/pricing.py
# GENJUTSU_USD_PER_INPUT_SECOND (list prices checked 2026-09-27; the launch
# discount to 2026-10-01 is deliberately not applied). The provider rounds the
# input duration UP to whole seconds; the gateway meters and settles exactly
# genjutsu_terminal_cost below.
GENJUTSU_KEY = "mint_video:genjutsu"
GENJUTSU_USD_PER_INPUT_SECOND: dict[str, float] = {
    "480p": 0.318, "720p": 0.681, "1080p": 1.632,
}
# mint_video's own --resolution default, which is what a plan must price when
# the argv names none.
GENJUTSU_DEFAULT_RESOLUTION = "720p"
# mint_video refuses a genjutsu source under 4s (GENJUTSU_MIN_INPUT_S) unless
# --allow-short, so a shorter clip only runs as a >=4s cut: that is what an
# estimate prices. With --allow-short the tool sends and bills the real length
# (floor PER_SECOND_MIN_SECONDS), and so does the estimate.
GENJUTSU_MIN_RUN_SECONDS = 4.0


def genjutsu_billed_seconds(seconds: float) -> int:
    """Whole input seconds billed: the duration rounded UP, exactly (5.0 stays
    5, 10.1 becomes 11, and any genuine fraction bills the next second).
    Mirrors the backend's pricing.genjutsu_billed_seconds exactly."""
    value = float(seconds)
    if not math.isfinite(value) or value <= 0:
        raise ValueError("genjutsu duration must be a positive number of seconds")
    return max(1, math.ceil(value))


def genjutsu_terminal_cost(seconds: float, resolution: str) -> float | None:
    """Exact price of ONE Genjutsu call, or None for an unpublished tier."""
    rate = GENJUTSU_USD_PER_INPUT_SECOND.get(str(resolution))
    if rate is None:
        return None
    return round(rate * genjutsu_billed_seconds(seconds), 6)

# Published Seedance 2.0 $/output-second, mirroring the backend's own terminal
# pins (videoclaw-backend app/pricing.py seedance_terminal_cost) so a plan
# cannot be built at one rate and billed at another. --quality picks the route
# and --resolution picks the rate. A resolution absent from a route's row has NO
# proven terminal price — the backend refuses it, so the billing plan refuses it
# too rather than guessing a rate.
SEEDANCE_PER_SECOND: dict[str, dict[str, float]] = {
    "bytedance/seedance-2.0": {"720p": 0.3034, "1080p": 0.682},
    "bytedance/seedance-2.0-fast": {"720p": 0.2419},
}

# Seedance 2.5 is NOT flat per second. Fal bills its OUTPUT TOKENS, so the price
# is set by the frame geometry that --resolution and --aspect-ratio select, and
# the backend admits AND settles from exactly this table
# (videoclaw-backend app/pricing.py: SEEDANCE_25_DIMENSIONS,
# SEEDANCE_25_TOKEN_USD_PER_1000, seedance_25_terminal_cost). The published
# per-second 2.5 figures in that module are discovery metadata only; pricing a
# plan from them over-states every shape by 1.7–7.3% and, worse, would price an
# aspect the backend has no terminal price for at all.
SEEDANCE_25_ROUTE = "bytedance/seedance-2.5"
SEEDANCE_25_TOKEN_USD_PER_1000 = 0.0214
SEEDANCE_25_FPS = 24
SEEDANCE_25_DIMENSIONS: dict[str, dict[str, tuple[int, int]]] = {
    "480p": {
        "21:9": (992, 432), "16:9": (864, 496), "4:3": (752, 560),
        "1:1": (640, 640), "3:4": (560, 752), "9:16": (496, 864),
    },
    "720p": {
        "21:9": (1470, 630), "16:9": (1280, 720), "4:3": (1112, 834),
        "1:1": (960, 960), "3:4": (834, 1112), "9:16": (720, 1280),
    },
}

# The route each --quality selects, mirroring mint_video._route_label for the
# gateway-backed insert/keyframe rails.
SEEDANCE_QUALITY_ROUTE: dict[str, str] = {
    "standard": "bytedance/seedance-2.0",
    "draft": "bytedance/seedance-2.0-fast",
    "premium": SEEDANCE_25_ROUTE,
}


def seedance_terminal_cost(route: str, seconds: float, resolution: str,
                           aspect_ratio: str) -> float | None:
    """Exact price of ONE Seedance call, or None if the shape has no price.

    The single derivation every #78 path prices from, mirroring the backend's
    terminal pin arithmetic (including its 6-decimal rounding) so plan, quote
    and settlement cannot disagree. 2.0/2.0-fast are flat per second; 2.5 is
    output tokens — width × height × fps × seconds ÷ 1024, at
    $0.0214/1000 tokens — so its aspect ratio is a pricing dimension.
    """
    if route == SEEDANCE_25_ROUTE:
        dimensions = SEEDANCE_25_DIMENSIONS.get(str(resolution), {}).get(
            str(aspect_ratio))
        if dimensions is None:
            return None
        width, height = dimensions
        tokens = width * height * float(seconds) * SEEDANCE_25_FPS / 1024
        return round(tokens / 1000 * SEEDANCE_25_TOKEN_USD_PER_1000, 6)
    rate = SEEDANCE_PER_SECOND.get(route, {}).get(str(resolution))
    if rate is None:
        return None
    return round(rate * float(seconds), 6)

# Last-resort per-unit output seconds when the billed length can be neither
# probed (--media) nor declared (--seconds). A missing figure used to return
# est_usd=null — the host received no advisory figure and treated later cost as
# unresolved. Instead: assume a documented,
# conservative (high-end) length so every canonical argv carries a
# deterministic figure. Derivations: lipsync 60s ≈ a full a-roll (aroll-reel's
# worked example ran 50.26s); edit 30s ≈ a trend-duplication source reel;
# reenact 10s = the documented driver-video maximum (3-10s).
PER_SECOND_ASSUMED_SECONDS: dict[str, float] = {
    "lipsync_footage": 60.0,
    "mint_video:edit": 30.0,
    "mint_video:reenact": 10.0,
    # genjutsu 10s = a typical person-swap clip (a one-face swap is usually
    # 4-10s; the tool takes 4-30s). Used only when no clip is named yet: the
    # app's plan card re-prices this line at the plan's own seconds, and the
    # billing plan always probes the real clip before any spend. Never the 30s
    # maximum at 1080p, which priced a 5s one-face swap at $48.96 (#329 review).
    "mint_video:genjutsu": 10.0,
}

# ---------------------------------------------------------------------------
# DECLARED-LENGTH rails (#78). The inverse of PER_SECOND_BILLED_MEDIA: these
# modes generate a clip from stills, so there is no input media whose length
# could be probed. mint_video sends the duration it computes from --duration —
# `api_duration` for insert, `int(round(--duration))` for keyframe, the shot
# sum for multishot — and the backend meters that number per second. For these
# rails the FLAG IS THE INVOICE, so a typed length is a pricing source here
# (and only here). The value below is what the rail bills when no length is
# declared: the mode's own CLI default for insert/keyframe (an exact price,
# not an assumption — it is what the tool will send), and for multishot the
# documented conservative sequence, since that mode always bills the shot sum
# from a payload the generic estimator never sees (6 shots, the documented
# maximum, at ~5s each). `plan` and `quote` read the real payload instead.
# ---------------------------------------------------------------------------
PER_SECOND_DECLARED_SECONDS: dict[str, float] = {
    "mint_video:insert": 4.0,
    "mint_video:keyframe": 5.0,
    "mint_video:multishot": 30.0,
}

# ---------------------------------------------------------------------------
# WHAT ACTUALLY GETS BILLED on a duration-priced rail (issue #74).
#
# Every rail below is billed per second of MEDIA THE TOOL PROBES AT RUN TIME —
# never per second of a number on the command line:
#
#   mint_video --mode edit     seconds = _guard_short_input(src_path, "--video")
#                              for a local --video. An http(s) source is uploaded
#                              and metered by the SERVER; run_edit sends NO
#                              seconds for it (a typed --duration never bills it),
#                              so a URL edit here is UNKNOWN, not a typed length.
#   mint_video --mode reenact  driver_seconds = _guard_short_input(--driver-video)
#                              ALWAYS, and a conflicting --duration only earns a
#                              "using the driver duration" warning.
#   lipsync_footage            sync-3 runs sync_mode=cut_off, which trims the
#                              video to the VO, so fal_lipsync meters
#                              seconds=probe_dur(--audio).
#
# Pricing off the flag instead of the media is exactly #74: a 3s edit of a 40s
# source estimated $0.39 against a ~$5.20 charge (13× under), and --duration 0.01
# estimated $0.00. The estimator therefore probes the same file as execution.
# So the estimator probes the same file the tool will, and this table is both
# the documentation of which file that is and the contract the tests assert.
# ---------------------------------------------------------------------------
PER_SECOND_BILLED_MEDIA: dict[str, str] = {
    "lipsync_footage": "--audio",
    "mint_video:edit": "--video",
    "mint_video:reenact": "--driver-video",
    # run_genjutsu: seconds = _guard_genjutsu_input(--video); the gateway then
    # re-measures the uploaded bytes and bills whole seconds of THAT.
    "mint_video:genjutsu": "--video",
}

# Shortest run a rail will actually perform. mint_video REFUSES omni video
# inputs under MIN_OMNI_INPUT_S (3.05s) unless --allow-short, so anything
# shorter quotes a run the tool declines to make. Clamping here is also the
# arithmetic guard: no probed length can collapse a per-second estimate toward
# $0.00 and be misclassified as free. EVERY per-second key must appear here or
# a sub-second file prices at ~$0 — lipsync included (a fraction-of-a-second VO
# is not a real lipsync run; 1.0s is a conservative arithmetic floor, not a
# claimed minimum).
PER_SECOND_MIN_SECONDS: dict[str, float] = {
    "mint_video:edit": 3.05,
    "mint_video:reenact": 3.05,
    # genjutsu bills ceil(seconds) of whatever it sends, so it cannot collapse
    # toward $0; 1s is the gateway's admission floor. It is deliberately NOT
    # the executor's 4s refusal threshold: an --allow-short run bills its real
    # length, and a refused run bills nothing, so clamping up would only
    # overstate the one short clip that does run.
    "mint_video:genjutsu": 1.0,
    "lipsync_footage": 1.0,
    # run_insert clamps to `max(4, …)` before it bills, so 4s is the real
    # floor. keyframe/multishot have no executor floor; 1.0s is the arithmetic
    # guard (multishot also enforces 1s per shot).
    "mint_video:insert": 4.0,
    "mint_video:keyframe": 1.0,
    "mint_video:multishot": 1.0,
}

# --batch fans out one metered call PER ITEM; only the omni rails that probe
# each clip can price a fleet. A --batch on any other key (a missing or
# unrecognized role especially) must fail closed to UNKNOWN, never the flat
# single-unit price.
BATCH_CAPABLE_KEYS: frozenset[str] = frozenset({
    "mint_video:edit", "mint_video:reenact", "mint_video:genjutsu"})

# Hosts may need to price synchronously at an authorization boundary, so the
# probe is bounded. A timeout is UNKNOWN (never a known assumed price): the paid
# tool may probe far longer, so a file that times out here still has real length.
_PROBE_TIMEOUT_S = 2.0

INPUT_BINDING_SCHEMA = "videoclaw.input-binding.v1"


class QuoteInputSnapshot:
    """One immutable byte set shared by binding and every pricing probe."""

    def __init__(self, tool: str, role: str):
        # A host may supply its own parent for async quote children. If it must
        # kill a timed-out child, it can remove that whole parent after process
        # exit instead of relying on Python finalizers that never ran.
        snapshot_root = os.environ.get("VIDEOCLAW_QUOTE_SNAPSHOT_ROOT")
        if snapshot_root and not Path(snapshot_root).is_dir():
            raise OSError("quote snapshot root is unavailable")
        self._tmp = tempfile.TemporaryDirectory(
            prefix="videoclaw-quote-inputs-",
            dir=snapshot_root or None,
        )
        self.tool = tool
        self.role = role
        self.entries: dict[str, dict] = {}
        self.paths: dict[str, Path] = {}
        self.media: Path | None = None
        self.batch: Path | None = None
        self.shared_swap: Path | None = None
        # genjutsu: the invocation's --reference images (the batch default
        # cast), in citation order; https URLs are kept as-is.
        self.shared_references: list[str] | None = None

    def copy(self, path: str | Path) -> Path:
        resolved = Path(path).expanduser().resolve(strict=True)
        if not resolved.is_file():
            raise OSError(f"not a regular file: {resolved}")
        key = str(resolved)
        cached = self.paths.get(key)
        if cached is not None:
            return cached
        target = Path(self._tmp.name) / f"{len(self.paths):04d}{resolved.suffix}"
        digest = hashlib.sha256()
        size = 0
        with resolved.open("rb") as source, target.open("xb") as output:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        self.paths[key] = target
        self.entries[key] = {
            "path": key,
            "sha256": digest.hexdigest(),
            "size": size,
        }
        return target

    @property
    def manifest(self) -> dict:
        return {
            "schema": INPUT_BINDING_SCHEMA,
            "tool": self.tool,
            "role": self.role,
            "inputs": [self.entries[path] for path in sorted(self.entries)],
        }

    def close(self) -> None:
        self._tmp.cleanup()

    def __del__(self) -> None:
        # quote() has many deliberate fail-closed returns. Keep their cleanup
        # deterministic without duplicating a close call at every branch.
        try:
            self.close()
        except Exception:
            pass


def _snapshot_references(snapshot: "QuoteInputSnapshot", refs: object,
                         job: Path | None) -> list[str] | None:
    """Copy each local genjutsu reference image; https URLs pass through.

    Returns None for a shape execution would refuse (not a list, 0 or more
    than 8 images, a non-https URL), so the caller prices it as UNKNOWN.
    """
    if not isinstance(refs, list) or not 1 <= len(refs) <= 8:
        return None
    frozen: list[str] = []
    for ref in refs:
        if not isinstance(ref, str) or not ref.strip():
            return None
        if ref.startswith("https://"):
            frozen.append(ref)
            continue
        if re.match(r"^[a-z][a-z0-9+.-]*:", ref, re.I):
            return None
        path = resolve_job_input_path(ref, job) if job else ref
        frozen.append(str(snapshot.copy(path)))
    return frozen


def _quote_input_snapshot(
    tool: str,
    role: str | None,
    *,
    media: str | Path | None,
    batch: str | Path | None,
    shared_swap: str | Path | None,
    job: Path | None,
    shared_references: list | None = None,
) -> QuoteInputSnapshot | None:
    """Copy every local byte source before either hashing or probing it.

    The manifest is intentionally path-bound as well as content-bound. Execution
    must use the same canonical names and bytes. Pricing consumes only the private
    copies, so even a transient replace/probe/restore race cannot price different
    bytes from those named by the manifest.
    """
    if tool != "mint_video" or role not in {"edit", "reenact", "genjutsu"}:
        return None
    snapshot = QuoteInputSnapshot(tool, role)
    try:
        if role == "genjutsu" and shared_references:
            # Execution binds every local reference image too, so the quote
            # manifest must name them or a bound run refuses them.
            frozen_refs = _snapshot_references(snapshot, list(shared_references), job)
            if frozen_refs is None:
                return None
            snapshot.shared_references = frozen_refs
        if batch is not None:
            original_batch = snapshot.copy(batch)
            specs = json.loads(original_batch.read_text())
            if not isinstance(specs, list) or not specs:
                return None
            billed_field = "driver_video" if role == "reenact" else "video"
            frozen_specs: list[dict] = []
            for spec in specs:
                if not isinstance(spec, dict):
                    return None
                billed = spec.get(billed_field)
                if not isinstance(billed, str) or not billed.strip() or billed.startswith(
                    ("http://", "https://", "data:")
                ):
                    return None
                frozen = dict(spec)
                billed_path = resolve_job_input_path(billed, job) if job else billed
                frozen[billed_field] = str(snapshot.copy(billed_path))
                if role == "reenact" and spec.get("swap_image") is not None:
                    swap = spec.get("swap_image")
                    if not isinstance(swap, str) or not swap.strip() or swap.startswith(
                        ("http://", "https://", "data:")
                    ):
                        return None
                    swap_path = resolve_job_input_path(swap, job) if job else swap
                    frozen["swap_image"] = str(snapshot.copy(swap_path))
                # run_batch falls back to the shared cast for an absent OR empty
                # list, so only a non-empty per-item list is its own input.
                if role == "genjutsu" and spec.get("references"):
                    frozen_refs = _snapshot_references(
                        snapshot, spec.get("references"), job)
                    if frozen_refs is None:
                        return None
                    frozen["references"] = frozen_refs
                frozen_specs.append(frozen)
            snapshot.batch = Path(snapshot._tmp.name) / "frozen-batch.json"
            snapshot.batch.write_text(json.dumps(frozen_specs))
        elif media is not None:
            if str(media).startswith(("http://", "https://", "data:")):
                return None
            snapshot.media = snapshot.copy(media)
        else:
            return None
        if shared_swap is not None:
            if str(shared_swap).startswith(("http://", "https://", "data:")):
                return None
            snapshot.shared_swap = snapshot.copy(shared_swap)
        return snapshot
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _probe_billed(media: str | Path) -> tuple[float | None, str | None]:
    """(seconds, failure_reason) for one billed media file.

    reason is None on a real probe; otherwise the PROVENANCE of the failure:
      'timeout' — ffprobe exceeded the pricing-call budget (_PROBE_TIMEOUT_S ≈
                  2s). Execution probes far longer (mint_video's timeout is 60s),
                  so a file that times out HERE still bills its real length at
                  run time. Assuming a length here would be a KNOWN
                  known under-estimate (#74 round-3): a 600s file that times out the
                  2s probe would quote a 30s assumption ($3.90) against a ~$78
                  charge. The caller must surface UNKNOWN, never a figure.
      'unknown' — an http(s) source (uploaded to the provider, not probeable
                  here), a missing/not-a-regular-file path, a 0-duration/corrupt
                  file, or any other ffprobe error.
    Nothing but an existing regular file is handed to ffprobe — that keeps its
    protocol handlers (concat:, pipe:, remote URLs) out of a pricing call.
    """
    if isinstance(media, str) and media.startswith(("http://", "https://")):
        return None, "unknown"
    try:
        path = Path(media).expanduser()
        if not path.is_file():
            return None, "unknown"
        seconds = ffprobe_duration(path, timeout_sec=_PROBE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    except Exception:
        return None, "unknown"
    # Total validation: only a numeric, FINITE, strictly-positive duration is a
    # real probe. None (crash), NaN, inf, 0, or negative are UNKNOWN — never a
    # 'probed' figure (inf would otherwise price est_usd=Infinity, #74 round-4).
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool):
        return None, "unknown"
    if not math.isfinite(seconds) or seconds <= 0:
        return None, "unknown"
    return float(seconds), None


def probe_billed_seconds(media: str | Path) -> float | None:
    """Duration of a LOCAL media file, or None when it can't be probed.
    Thin wrapper over _probe_billed for callers that don't need the reason."""
    return _probe_billed(media)[0]


def _batch_media(
    key: str, batch: str | Path,
    has_shared_swap: bool = False, has_shared_prompt: bool = False,
    job: Path | None = None,
    has_shared_references: bool = False,
) -> list[str | None] | None:
    """Per-item billed media for a `mint_video --batch <specs.json>` fleet.

    --batch is a PATH to a JSON list; each item names its own clip, and the
    tool probes every one of them (run_batch → _guard_short_input per item).
    Returns ONE entry per ORIGINAL list element — the billed-media string, or
    None for an element run_batch would REJECT OR CRASH ON (validated by the
    SHARED batch_item_media: not a dict, a non-string/blank billed-media field,
    a non-string `output`, or a mode-incompatible `quality`). Preserving those
    Nones is what lets the caller report `batch_partial` when the fleet is only
    partly runnable — dropping them would make `probed` mean "every RUNNABLE
    item" instead of "every SPECIFIED item" and under-estimate the fleet. An item
    is only priced as known once it would actually reach runtime probing (#74
    round-5).

    Returns None (not a list) when the fleet cannot be enumerated at all: an
    unreadable/malformed specs file, or a top-level value that is not a list —
    the caller surfaces UNKNOWN.
    """
    mode = {"mint_video:edit": "edit",
            "mint_video:reenact": "reenact",
            "mint_video:genjutsu": "genjutsu"}.get(key)
    if mode is None:
        return None
    try:
        specs = json.loads(Path(batch).expanduser().read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(specs, list):
        return None
    resolve_path = ((lambda value: resolve_job_input_path(value, job))
                    if job is not None else None)
    items = [
        batch_item_media(mode, s, has_shared_swap=has_shared_swap,
                         has_shared_prompt=has_shared_prompt,
                         has_shared_references=has_shared_references,
                         resolve_path=resolve_path)
        for s in specs
    ]
    if job is not None:
        return [
            (
                item
                if item is None or item.startswith(("http://", "https://"))
                else str(resolve_job_input_path(item, job))
            )
            for item in items
        ]
    return items


def mint_video_declared_seconds(role: str | None, duration: float | None,
                                quality: str = "standard") -> float:
    """The exact seconds mint_video will DECLARE to the gateway for one call.

    One definition of the executor's own arithmetic, shared by the advisory
    estimate, the canonical billing plan and the gateway quote, so no caller
    can reserve a length the tool will not send (#78). run_insert clamps to
    `max(4, min(round(--duration), 30 if premium else 15))`; run_keyframe sends
    `int(round(--duration))`; multishot bills the shot sum, so the flag stands
    in only when no payload is available.
    """
    key = f"mint_video:{role}"
    seconds = (PER_SECOND_DECLARED_SECONDS[key] if duration is None
               else float(duration))
    if role == "insert":
        cap = 30 if quality == "premium" else 15
        return float(max(4, min(int(round(seconds)), cap)))
    if role == "keyframe":
        return float(int(round(seconds)))
    return float(seconds)


def resolve_billed_seconds(
    key: str,
    seconds: float | None,
    media: str | Path | None,
    batch: str | Path | None = None,
    has_shared_swap: bool = False,
    has_shared_prompt: bool = False,
    job: Path | None = None,
) -> tuple[float | None, str, int | None]:
    """(seconds_per_unit, source, batch_items) for one duration-priced rail.

    THE MEDIA IS THE INVOICE (#74). A price may only be POSITIVELY KNOWN — a
    real probe of the file(s) the tool bills — or, when NO file is named at all,
    the documented conservative ASSUMPTION (displayable as inexact advisory
    context). A caller's --seconds / --duration is a CLAIM
    and is NEVER a pricing source: every PER_SECOND key is billed off media the
    tool probes at run time.

    Host policy can distinguish exact from inexact metadata through this
    PROVENANCE (#74 round-3), so the source
    string is load-bearing:
      'probed'        — every billed file was probed. Positively known.
      'declared'      — a DECLARED-length rail (#78) priced off the duration the
                        tool will send. Positively known: the flag is the invoice.
      'default'       — a declared-length rail with no --duration; the tool's own
                        CLI default is what it will send. Positively known.
      'assumed'       — NO media/batch was named; the documented per-unit length.
      'timeout'       — a NAMED media file's probe exceeded the pricing budget.
      'batch_partial' — a --batch fleet with an item that could not be probed.
      'unknown'       — NAMED media that is unprobeable (URL/missing/corrupt), or
                        an unreadable/empty --batch specs list.
    Only 'probed' returns an exact media-derived figure; a NAMED-but-unprobeable
    file or a partial fleet returns None (UNKNOWN) — NEVER a known assumed price,
    which would silently under-estimate a real file (a 600s edit that times out
    the 2s probe bills ~$78, not the 30s/$3.90 assumption).
    """
    if key in PER_SECOND_DECLARED_SECONDS:
        # A declared-length rail has no input media to probe, so --media is not
        # consulted and --batch never reaches here (estimate() fails those
        # closed first). The typed duration IS what the tool sends, run through
        # the same arithmetic the mode applies before it bills.
        if seconds is None:
            return _clamp(key, PER_SECOND_DECLARED_SECONDS[key]), "default", None
        try:
            declared = float(seconds)
        except (TypeError, ValueError):
            return None, "unknown", None
        if not math.isfinite(declared) or declared <= 0:
            return None, "unknown", None
        # Advisory estimates have no quality selector: preserve the longest
        # supported insert rather than underestimating a premium 30s request.
        billed = mint_video_declared_seconds(key.split(":", 1)[1], declared, "premium")
        return _clamp(key, billed), "declared", None

    if batch is not None:
        items = _batch_media(
            key, batch, has_shared_swap, has_shared_prompt, job=job
        )
        if not items:
            # None (unreadable/malformed/not-a-list) or [] (empty fleet): we
            # cannot enumerate the fleet, so we cannot price it. UNKNOWN.
            return None, "unknown", None
        # `probed` must mean EVERY specified entry was priced. A structurally
        # incomplete entry (None from _batch_media) or an unprobeable clip makes
        # the fleet total unknown — pricing only the retained items would
            # under-estimate. Fail closed to batch_partial (count = ORIGINAL entries).
        seconds: list[float] = []
        complete = True
        for it in items:
            if it is None:
                complete = False
                continue
            val, _ = _probe_billed(it)
            if val is None:
                complete = False
            else:
                seconds.append(val)
        if not complete or not seconds:
            return None, "batch_partial", len(items)
        # Tag EACH item BEFORE averaging (videoclaw#74 round-8 E-2): if ANY clip
        # is below its floor (would be clamped up), the fleet total is inexact vs
        # the executor's bill (with --allow-short it bills that item's actual
        # shorter duration), so the WHOLE fleet is probed_clamped and explicitly
        # inexact. Averaging first would let a short item hide behind longer
        # siblings (a 1s+10s edit fleet averages to 5.5s > 3.05s → "probed").
        any_clamped = any(_clamp(key, s) != s for s in seconds)
        per_unit = _clamp(key, sum(seconds) / len(items))
        source = "probed_clamped" if any_clamped else "probed"
        return per_unit, source, len(items)

    if media is not None:
        val, reason = _probe_billed(media)
        if val is not None:
            per_unit, source = _clamp_probed(key, val)
            return per_unit, source, None
        # media was NAMED but could not be probed here. The tool WILL probe and
        # bill the real file at run time, so we must not substitute a known
        # assumed figure — that is a KNOWN under-estimate. Surface UNKNOWN
        # with the failure provenance ('timeout' | 'unknown').
        return None, reason or "unknown", None
    # No media/batch NAMED at all: the documented conservative assumption. A
    # typed --seconds is a claim, not an invoice, so it is NOT consulted.
    return _clamp(key, PER_SECOND_ASSUMED_SECONDS[key]), "assumed", None


def _clamp(key: str, seconds: float) -> float:
    return max(seconds, PER_SECOND_MIN_SECONDS.get(key, 0.0))


def _clamp_probed(key: str, seconds: float) -> tuple[float, str]:
    """(clamped_seconds, source) for a probed length. When the arithmetic floor
    RAISES the probed value (a sub-minimum clip), the clamped estimate no longer
    equals what the executor bills — with --allow-short the tool bills the actual
    shorter duration, and the vendor's short-clip billing is not something we can
    assume — so it is NOT a true 'probed' price. Label it 'probed_clamped' so the
    host can treat it as INEXACT advisory metadata rather than a provider-derived
    figure that could over- or under-estimate the real short call — videoclaw#74 round-7.
    """
    clamped = _clamp(key, seconds)
    return clamped, ("probed" if clamped == seconds else "probed_clamped")


def unit_price(tool: str, role: str | None) -> tuple[float | None, str]:
    """Return (unit_usd, note). unit_usd is None when the tool is unpriced
    (unknown) — the caller should surface that rather than imply $0."""
    tool = tool.removesuffix(".py")
    table = PRICES.get(tool)
    if table is None:
        return None, f"no price entry for tool '{tool}' — treat as UNKNOWN, not free"
    if role and role in table:
        return table[role], f"{tool}[{role}]"
    return table["_default"], f"{tool}[{role or '_default'}]"


def _swap_usable(shared_swap: str | Path | None) -> bool:
    """Whether a shared --swap-image is ACTUALLY usable (an existing local file),
    not merely present. A missing/URL swap will fail run_batch's upload, so items
    relying on it are non-runnable → the estimator must not label them probed on
    mere flag presence (videoclaw#74 round-9 E-2)."""
    if not isinstance(shared_swap, (str, Path)) or not str(shared_swap).strip():
        return False
    try:
        return Path(shared_swap).expanduser().is_file()
    except OSError:
        return False


def _references_usable(refs: object) -> bool:
    """Whether a shared genjutsu --reference list would run: 1..8 images, each
    an https URL or an existing local file (the executor refuses the rest)."""
    if not isinstance(refs, (list, tuple)) or not 1 <= len(refs) <= 8:
        return False
    for ref in refs:
        if not isinstance(ref, (str, Path)) or not str(ref).strip():
            return False
        if str(ref).startswith("https://"):
            continue
        try:
            if not Path(ref).expanduser().is_file():
                return False
        except OSError:
            return False
    return True


def _genjutsu_estimate(tool: str, role: str | None, count: int, *,
                       media: str | Path | None,
                       batch: str | Path | None,
                       resolution: str | None,
                       has_shared_references: bool,
                       has_shared_prompt: bool,
                       job: Path | None,
                       allow_short: bool = False) -> dict:
    """Whole-input-second pricing for mint_video genjutsu (Higgsfield).

    Each clip is billed on its own: its probed length rounded UP to whole
    seconds, times the rate for the resolution. A clip under 4s is priced as
    the 4s cut the tool will actually run, unless --allow-short sends it as it
    is (then its real length). With no resolution the estimate prices
    mint_video's own 720p default, exactly as the canonical plan does. With no
    clip named, the documented assumed length (PER_SECOND_ASSUMED_SECONDS).
    """
    key = GENJUTSU_KEY
    priced_resolution = resolution or GENJUTSU_DEFAULT_RESOLUTION
    floor = PER_SECOND_MIN_SECONDS[key] if allow_short else GENJUTSU_MIN_RUN_SECONDS

    def clamp(value: float) -> float:
        return max(value, floor)

    rate = GENJUTSU_USD_PER_INPUT_SECOND.get(str(priced_resolution))
    base = {"tool": tool, "role": role, "key": key, "count": count,
            "resolution": priced_resolution, "free": False}
    if rate is None:
        return {**base, "unit_usd": None, "est_usd": None, "unknown": True,
                "seconds": None, "seconds_source": "unknown",
                "label": f"{key} — resolution must be 480p, 720p or 1080p"}
    if batch is not None:
        items = _batch_media(key, batch, has_shared_prompt=has_shared_prompt,
                             job=job, has_shared_references=has_shared_references)
        if not items:
            return {**base, "unit_usd": rate, "est_usd": None, "unknown": True,
                    "seconds": None, "seconds_source": "unknown",
                    "label": f"{key} — the --batch specs could not be read"}
        probed: list[float] = []
        for item in items:
            value = _probe_billed(item)[0] if item is not None else None
            if value is None:
                return {**base, "unit_usd": rate, "est_usd": None, "unknown": True,
                        "seconds": None, "seconds_source": "batch_partial",
                        "batch_items": len(items),
                        "label": f"{key} — a --batch item could not be probed — "
                                 "fleet length unknown"}
            probed.append(value)
        clamped = [clamp(value) for value in probed]
        source = ("probed_clamped" if any(c != v for c, v in zip(clamped, probed))
                  else "probed")
        billed = sum(genjutsu_billed_seconds(value) for value in clamped)
        unit_total = round(sum(genjutsu_terminal_cost(value, priced_resolution)
                               for value in clamped), 6)
        est = round(unit_total * count, 4)
        return {**base, "seconds": round(sum(clamped) / len(items), 6),
                "billed_seconds": billed * count, "seconds_source": source,
                "unit_usd": rate, "est_usd": est, "unknown": False,
                "batch_items": len(items),
                "label": (f"{key} ×{count * len(items)} = {billed * count} billed "
                          f"input s @ ${rate}/s ({priced_resolution})")}
    if media is not None:
        value, reason = _probe_billed(media)
        if value is None:
            label = ("the billed media probe timed out — real length unknown"
                     if reason == "timeout"
                     else "the billed media could not be probed — length unknown")
            return {**base, "unit_usd": rate, "est_usd": None, "unknown": True,
                    "seconds": None, "seconds_source": reason or "unknown",
                    "label": f"{key} — {label}"}
        per_unit = clamp(value)
        source = "probed" if per_unit == value else "probed_clamped"
    else:
        per_unit, source = clamp(PER_SECOND_ASSUMED_SECONDS[key]), "assumed"
    billed = genjutsu_billed_seconds(per_unit)
    est = round(genjutsu_terminal_cost(per_unit, priced_resolution) * count, 4)
    result = {**base, "seconds": per_unit, "billed_seconds": billed * count,
              "seconds_source": source, "unit_usd": rate, "est_usd": est,
              "unknown": False,
              "label": (f"{key} ×{count} × {billed} billed input s @ ${rate}/s "
                        f"({priced_resolution})")}
    if source == "assumed":
        result["assumed_seconds"] = PER_SECOND_ASSUMED_SECONDS[key]
    return result


def estimate(tool: str, role: str | None, count: int,
             seconds: float | None = None,
             media: str | Path | None = None,
             batch: str | Path | None = None,
             shared_swap: str | Path | None = None,
             has_shared_prompt: bool = False,
             job: Path | None = None,
             resolution: str | None = None,
             shared_references: list | None = None,
             allow_short: bool = False) -> dict:
    """Optional advisory cost estimate for one invocation.

    `media` is the local file whose length the tool will actually bill (see
    PER_SECOND_BILLED_MEDIA) — pass it and duration-priced rails quote the real
    charge instead of a flag's claim. `batch` is a mint_video --batch specs
    path, priced across every item in the list.

    `seconds` is a pricing source ONLY on the declared-length rails
    (PER_SECOND_DECLARED_SECONDS, #78), where the tool sends the flag's value
    and there is no input media to probe. On every probed rail it stays a
    claim and is ignored.

    `free` in the result means PRICED AT ZERO — the table itself says this rail
    costs nothing (score_bed --mode bed, local/dummy index_media paths, local
    compose_render modes). It is deliberately NOT the same as "est_usd came out 0", which for
    a nonzero unit rate means the estimator failed to price the call and the
    caller must treat it as unpriced (issue #74: a derived zero had previously
    misclassified a real paid call as free).
    """
    key = tool.replace(".py", "")
    # Duration-priced tools: bill per second of video. Role-scoped rows
    # ("mint_video:edit") win over the whole-tool row ("lipsync_footage").
    if f"{key}:{role}" in PER_SECOND:
        key = f"{key}:{role}"

    # count is a positive-integer multiplier. Zero or negative values would
    # create false pricing metadata; both are #74's family. Fail closed.
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        return {"tool": tool, "role": role, "count": count, "unit_usd": None,
                "est_usd": None, "free": False, "unknown": True,
                "seconds_source": "unknown",
                "label": f"count must be a positive integer, got {count!r}"}

    # A --batch fleet fans out one metered call PER ITEM, and only the omni
    # rails that probe each clip can price it. A --batch on any other key — a
    # missing or unrecognized --role especially — must fail closed: quoting the
    # flat single-unit price while execution launches N metered calls is #74's
    # under-estimate at fleet scale.
    if batch is not None and key not in BATCH_CAPABLE_KEYS:
        return {"tool": tool, "role": role, "count": count, "unit_usd": None,
                "est_usd": None, "free": False, "unknown": True,
                "seconds_source": "unknown",
                "label": f"--batch needs an exact per-second role "
                         f"(edit|reenact|genjutsu) on mint_video, got {key!r}"}

    if key == GENJUTSU_KEY:
        # Whole-second, resolution-priced rail: its own arithmetic, below.
        return _genjutsu_estimate(
            tool, role, count, media=media, batch=batch, resolution=resolution,
            has_shared_references=_references_usable(shared_references),
            has_shared_prompt=has_shared_prompt, job=job, allow_short=allow_short)

    if key in PER_SECOND:
        per_sec = PER_SECOND[key]
        per_unit, source, items = resolve_billed_seconds(
            key, seconds, media, batch,
            has_shared_swap=_swap_usable(shared_swap),
            has_shared_prompt=has_shared_prompt,
            job=job)
        if per_unit is None:
            # UNKNOWN price — a named media file could not be probed (timeout /
            # URL / missing) or a --batch fleet was partial/unreadable. NEVER a
            # known assumed figure: surface UNKNOWN advisory pricing instead.
            # `seconds_source` carries the reason for host policy.
            reason = {
                "timeout": "the billed media probe timed out — real length unknown",
                "batch_partial": "a --batch item could not be probed — fleet length unknown",
            }.get(source, "the billed media could not be probed — length unknown")
            return {"tool": tool, "role": role, "seconds": None, "count": count,
                    "seconds_source": source, "unit_usd": per_sec,
                    "est_usd": None, "free": False,
                    "label": f"{key} — {reason}",
                    "unknown": True}
        units = count * (items or 1)
        est = round(per_sec * per_unit * units, 4)
        billed = {"tool": tool, "role": role, "key": key, "seconds": per_unit,
                  "seconds_source": source, "count": count,
                  "unit_usd": per_sec, "est_usd": est, "free": False,
                  "label": f"{key} ×{units} × {per_unit:g}s @ ${per_sec}/s",
                  "unknown": False}
        if items:
            billed["batch_items"] = items
        if source == "assumed":
            # The CLI's "pass the real length" nudge keys on this.
            billed["assumed_seconds"] = PER_SECOND_ASSUMED_SECONDS[key]
        return billed
    unit, label = unit_price(tool, role)
    if unit is None:
        return {"tool": tool, "role": role, "count": count, "unit_usd": None,
                "est_usd": None, "label": label, "free": False, "unknown": True,
                "seconds_source": "unknown"}
    # A fixed-price table row: the price is exact and positively known (no probe
    # needed). 'fixed' provenance tells hosts the amount is positively known.
    return {"tool": tool, "role": role, "count": count, "unit_usd": round(unit, 4),
            "est_usd": round(unit * count, 4), "label": label,
            "free": unit == 0.0, "unknown": False, "seconds_source": "fixed"}


# ---------------------------------------------------------------------------
# Canonical billing plan (#210/#212)
# ---------------------------------------------------------------------------

def _canonical_json(value: object) -> str:
    # JSON has only a number type, but Python preserves 1.0 while JavaScript's
    # JSON.stringify emits 1.  Normalize integral floats so both protocol
    # implementations hash exactly the same bytes.
    def normalize(item: object) -> object:
        if isinstance(item, float) and math.isfinite(item) and item.is_integer():
            return int(item)
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        return item

    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def _plan_sha256(plan: dict) -> str:
    unsigned = {k: v for k, v in plan.items() if k != "plan_sha256"}
    return hashlib.sha256(_canonical_json(unsigned).encode("utf-8")).hexdigest()


def _command_argv(command: str) -> list[str]:
    """Parse one literal command. Shell composition/expansion is deliberately
    outside fingerprint-bound plan metadata and remains the host's concern."""
    if not isinstance(command, str) or not command.strip() or "\n" in command:
        raise ValueError("billing plan needs one non-empty command")
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|<>()")
    lexer.whitespace_split = True
    lexer.commenters = ""
    argv = list(lexer)
    if not argv or any(token in _SHELL_CONTROL for token in argv):
        raise ValueError("shell composition is not canonical billing argv")
    if any("$" in token or "`" in token for token in argv):
        raise ValueError("shell expansion is not canonical billing argv")
    return argv


def _tool_target(argv: list[str], installed_engine: Path) -> tuple[int, str]:
    """Return the one installed-engine ``tools/<name>.py`` target.

    Source-tree commands use ``python tools/<name>.py``. Installed/native
    commands use the launcher documented in CLAUDE.md:

        uv run --project <engine> python <engine>/tools/<name>.py

    Preserve either argv verbatim in the plan, while binding every absolute
    launcher component back to this exact installed engine. Other uv options,
    another project root, and absolute tool paths outside this engine remain
    non-canonical.
    """
    i = 0
    project: str | None = None
    if argv[:2] == ["uv", "run"]:
        i = 2
        if i < len(argv) and argv[i] == "--project":
            if i + 1 >= len(argv):
                raise ValueError("uv run --project has no engine path")
            project = argv[i + 1]
            i += 2
        elif i < len(argv) and argv[i].startswith("--project="):
            project = argv[i].split("=", 1)[1]
            if not project:
                raise ValueError("uv run --project has no engine path")
            i += 1
        elif i < len(argv) and argv[i].startswith("-"):
            raise ValueError("uv run options are not canonical billing argv")
        if project is not None:
            project_path = Path(project).expanduser()
            if (
                not project_path.is_absolute()
                or project_path.resolve() != installed_engine
            ):
                raise ValueError(
                    "uv run --project must name the installed billing engine"
                )
    if i < len(argv) and re.fullmatch(r"python(?:3(?:\.\d+)?)?", argv[i]):
        i += 1
    if i >= len(argv):
        raise ValueError("missing paid tool target")
    target = Path(argv[i])
    if project is not None and not target.is_absolute():
        raise ValueError(
            "uv run --project requires an absolute installed-engine tool target"
        )
    if target.is_absolute():
        resolved_target = target.resolve()
        if resolved_target.parent != (installed_engine / "tools").resolve():
            raise ValueError(
                "absolute paid tool target must be inside the installed engine tools directory"
            )
        target = resolved_target
    elif (
        ".." in target.parts
        or len(target.parts) != 2
        or target.parts[0] != "tools"
    ):
        raise ValueError("paid tool target must be an in-tree tools/<name>.py path")
    if target.suffix != ".py":
        raise ValueError("paid tool target must end in .py")
    name = target.stem
    if name not in PRICES:
        raise ValueError(f"no canonical billing row for {name!r}")
    return i, name


def _flag_values(args: list[str], names: tuple[str, ...] | frozenset[str], *, repeat=False) -> list[tuple[int, str, str, bool]]:
    found: list[tuple[int, str, str, bool]] = []
    i = 0
    while i < len(args):
        token = args[i]
        equal_name = next((name for name in names if token.startswith(name + "=")), None)
        if equal_name:
            value = token[len(equal_name) + 1:]
            if not value:
                raise ValueError(f"{equal_name} has no value")
            found.append((i, equal_name, value, True))
        elif token in names:
            if i + 1 >= len(args) or args[i + 1].startswith("-"):
                raise ValueError(f"{token} has no value")
            found.append((i + 1, token, args[i + 1], False))
            i += 1
        i += 1
    if not repeat and len(found) > 1:
        raise ValueError(f"duplicate billing flag {found[0][1]}")
    return found


def _one_flag(args: list[str], names: tuple[str, ...]) -> str | None:
    found = _flag_values(args, names)
    return found[0][2] if found else None


def _tool_parser(tool: str) -> object:
    previous_dotenv = os.environ.get("PYTHON_DOTENV_DISABLED")
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    try:
        module = importlib.import_module(tool)
    finally:
        if previous_dotenv is None:
            os.environ.pop("PYTHON_DOTENV_DISABLED", None)
        else:
            os.environ["PYTHON_DOTENV_DISABLED"] = previous_dotenv
    return module.build_parser()


def _tool_owned_manifest(tool: str, args: list[str], cwd: Path) -> tuple[dict, object] | None:
    """Parse with the tool's actual parser and ask its runtime-owned hook.

    These hooks own branch precedence, aliases, implicit reads, and paid fan-out;
    cost.py only fingerprints and prices the returned semantic manifest.
    """
    if tool not in _TOOL_OWNED_MANIFESTS:
        return None
    parser = _tool_parser(tool)
    module = importlib.import_module(tool)
    try:
        parsed = parser.parse_args(args)
        manifest = module.billing_manifest(parsed, cwd)
    except SystemExit as exc:
        raise ValueError(f"{tool} rejected canonical argv") from exc
    if (not isinstance(manifest, dict)
            or not isinstance(manifest.get("inputs"), list)
            or not isinstance(manifest.get("count"), int)
            or manifest["count"] < 1):
        raise ValueError(f"{tool} emitted an invalid billing manifest")
    return manifest, parser


def _manifest_input_origin(parser: object, args: list[str], dest: str,
                           occurrence: int) -> tuple[int, str, str, bool]:
    action = next((item for item in parser._actions if item.dest == dest), None)
    if action is None or not action.option_strings:
        raise ValueError(f"billing manifest names unknown parser field {dest}")
    values = _flag_values(args, frozenset(action.option_strings), repeat=True)
    if occurrence >= len(values):
        raise ValueError(f"billing manifest has no argv source for {dest}")
    return values[occurrence]


def _positive_count(value: str | None) -> int:
    if value is None:
        return 1
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError("billing count must be a positive integer")
    count = int(value)
    if count < 1:
        raise ValueError("billing count must be a positive integer")
    return count


def _job_path(args: list[str], cwd: Path) -> Path:
    raw = _one_flag(args, ("--job",))
    if not raw:
        raise ValueError("canonical job input requires --job")
    # A guarded billing plan accepts an ID, never a caller-selected path.  The
    # ordinary tool resolver retains legacy path support for interactive use,
    # but letting an existing <cwd>/<id> win here would bind metadata to one
    # job root and execute into another. Bind to the configured jobs root.
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", raw)
            or raw in {".", ".."}):
        raise ValueError("canonical billing requires a bare job id")
    configured = os.environ.get("VIDEOCLAW_JOBS_DIR")
    jobs_root = (Path(configured).expanduser() if configured else cwd / "jobs")
    if not jobs_root.is_absolute():
        raise ValueError("canonical jobs root must be absolute")
    jobs_root = jobs_root.resolve()
    if jobs_root.exists() and not jobs_root.is_dir():
        raise ValueError("canonical jobs root is not a directory")
    candidate = jobs_root / raw
    if candidate.is_symlink():
        raise ValueError("canonical job path must not be symlinked")
    if candidate.exists() and (not candidate.is_dir() or candidate.resolve() != candidate):
        raise ValueError("canonical job path is not a canonical directory")
    return candidate


def _pricing_request(tool: str, args: list[str]) -> dict:
    count_value = _one_flag(args, _COUNT_FLAGS)
    role = _one_flag(args, _ROLE_FLAGS)
    count = _positive_count(count_value)
    batch = _one_flag(args, ("--batch",))
    request: dict = {"tool": tool, "role": role, "count": count}

    if tool == "build_character_sheet":
        if count_value is not None:
            raise ValueError("build_character_sheet has a fixed three-panel count")
        request["count"] = 3
    elif tool == "compose_render":
        request["count"] = 1
    elif tool == "synth_voice":
        script = _one_flag(args, ("--script",))
        chunk = _one_flag(args, ("--chunk",))
        if script is not None and chunk is None:
            request["role"] = None
        if _one_flag(args, ("--mode",)) == "tts" and _one_flag(args, ("--text",)) is None:
            request["role"] = None
    elif tool == "perform_avatar":
        # The immutable script snapshot supplies the exact chunk count.
        request["role"] = None
    elif tool == "gemini_video" and _one_flag(args, ("--chunk",)) == "all":
        # Price the exact immutable chunk-file fan-out at the per-call row.
        request["role"] = None
    elif (tool in {"pull_video", "acquire_footage"}
          and role != "enumerate" and "--bed" in args):
        request["role"] = "bed"
    elif tool == "pull_video" and role == "search":
        tier = _one_flag(args, ("--research-tier",)) or "standard"
        if tier not in {"quick", "standard", "deep"}:
            raise ValueError("--research-tier must be quick, standard, or deep")
        request["role"] = f"meta_ads_{tier}"
    elif tool == "breakdown_reference":
        if role != "timeline" or args.count("--transcribe") != 1:
            raise ValueError("breakdown_reference needs the canonical timeline+transcribe shape")
        request["role"] = "timeline"
    elif tool == "decode_audio":
        # Every mode resolves the same references, so the price keys off the
        # reference SCHEME, not --mode: only a remote http(s) reference reaches
        # the acquisition seam. The grammar is `_money_argv`'s, the same one
        # prepare_production classifies with — one definition, not two.
        #
        # The COUNT is the number of references execution actually resolves
        # remotely (videoclaw#199 review): `--candidates <2 urls> --vocal-stems
        # <2 urls>` is four uncached acquisitions, so it must quote four units,
        # not one. An argv that names no reference (or a shape argparse would
        # reject) is unprovable, so it prices the acquisition unit rather than
        # $0 — the classifier calls the same form paid.
        from prepare_production import (  # noqa: PLC0415
            decode_audio_acquisition,
        )
        spends, acquisitions = decode_audio_acquisition(args)
        request["role"] = "reference_pull" if spends else "local"
        request["count"] = acquisitions if spends else 1
    elif tool == "index_media":
        command = next((token for token in args if not token.startswith("-")), None)
        backend = _one_flag(args, ("--backend",)) or "gemini"
        embedding_command = command in {"index", "search", "img", "sync"} or (
            command == "add-source" and "--index" in args
        )
        if embedding_command:
            request["role"] = (
                "gemini" if backend == "gemini"
                else "free" if backend in {"dummy", "local"}
                else None
            )
        else:
            request["role"] = "free" if command in {
                "add-source", "remove-source", "reindex", "stats", "scan", "remove", "reset"
            } else None

    key = f"{tool}:{request.get('role')}"
    billed_flag = PER_SECOND_BILLED_MEDIA.get(key) or PER_SECOND_BILLED_MEDIA.get(tool)
    if batch is not None:
        request["batch"] = batch
    elif billed_flag:
        media = _one_flag(args, (billed_flag,))
        if media is not None:
            request["media"] = media
    if batch is not None and tool == "mint_video":
        swap = _one_flag(args, ("--swap-image",))
        if swap is not None:
            request["shared_swap"] = swap
        request["has_shared_prompt"] = _one_flag(args, ("--prompt",)) is not None
    if tool == "mint_video" and request.get("role") == "genjutsu":
        # The resolution is the price tier; omission is mint_video's own 720p
        # default, which is exactly what execution will send.
        resolution = _one_flag(args, ("--resolution",)) or GENJUTSU_DEFAULT_RESOLUTION
        if resolution not in GENJUTSU_USD_PER_INPUT_SECOND:
            raise ValueError("mint_video genjutsu --resolution must be 480p, 720p or 1080p")
        request["resolution"] = resolution
        # --allow-short sends a sub-4s clip as it is and bills its real length.
        request["allow_short"] = "--allow-short" in args
        if batch is not None:
            # The shared --reference cast lets items omit their own; billing_plan
            # swaps these raw values for the verified snapshots.
            request["shared_references"] = [
                raw for _, _, raw, _ in _flag_values(args, ("--reference",), repeat=True)]
    return request


def _absolute_input(raw: str, cwd: Path) -> Path:
    if re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
        raise ValueError("remote input cannot be fingerprint-bound locally")
    path = Path(raw).expanduser()
    return path if path.is_absolute() else cwd / path


def _secure_file_bytes(path: Path) -> tuple[bytes, os.stat_result]:
    """Read one regular file without following symlinks and detect write races."""
    absolute = path.absolute()
    # Reject the user-selected leaf symlink. System path aliases such as macOS
    # /var -> /private/var are outside the caller-controlled input boundary and
    # must not make every tempfile fail closed.
    if stat.S_ISLNK(os.lstat(absolute).st_mode):
        raise ValueError(f"billing input is symlinked: {absolute}")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)  # port: binary mode on Windows
    fd = os.open(absolute, flags)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"billing input is not a regular file: {absolute}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
        ):
            raise ValueError(f"billing input changed while hashing: {absolute}")
        return b"".join(chunks), after
    finally:
        os.close(fd)


def _fingerprint(path: Path, *, argv_index: int | None = None,
                 flag: str | None = None, equals_form: bool = False,
                 batch_member: bool = False) -> dict:
    raw, st = _secure_file_bytes(path)
    item = {
        "path": str(path.absolute()),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size": st.st_size,
        "mtime_ns": str(st.st_mtime_ns),
        "device": str(st.st_dev),
        "inode": str(st.st_ino),
        "batch_member": batch_member,
    }
    if argv_index is not None:
        item.update({"argv_index": argv_index, "flag": flag, "equals_form": equals_form})
    return item


def _directory_fingerprint(path: Path, *, argv_index: int | None = None,
                           flag: str | None = None,
                           equals_form: bool = False) -> tuple[dict, list[dict]]:
    """Fingerprint a directory input as one manifest plus every regular file.
    Symlinks anywhere below the selected root fail closed."""
    root = path.absolute()
    root_stat = os.lstat(root)
    if stat.S_ISLNK(root_stat.st_mode):
        raise ValueError(f"billing input is symlinked: {root}")
    if not stat.S_ISDIR(root_stat.st_mode):
        raise ValueError(f"billing input is not a directory: {root}")
    members: list[dict] = []
    for current, dirs, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in sorted(dirs):
            child = current_path / name
            mode = os.lstat(child).st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
                raise ValueError(f"billing directory contains an unsafe entry: {child}")
        for name in sorted(files):
            child = current_path / name
            mode = os.lstat(child).st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
                raise ValueError(f"billing directory contains an unsafe entry: {child}")
            relative_path = str(child.relative_to(root))
            member = _fingerprint(child, batch_member=True)
            member.update({"directory_root": str(root), "relative_path": relative_path})
            members.append(member)
    members.sort(key=lambda item: item["relative_path"])
    manifest = [{
        "relative_path": item["relative_path"],
        "sha256": item["sha256"],
        "size": item["size"],
        "mtime_ns": item["mtime_ns"],
        "device": item["device"],
        "inode": item["inode"],
    } for item in members]
    direct = {
        "path": str(root),
        "sha256": hashlib.sha256(_canonical_json(manifest).encode("utf-8")).hexdigest(),
        "size": sum(item["size"] for item in members),
        "mtime_ns": str(root_stat.st_mtime_ns),
        "device": str(root_stat.st_dev),
        "inode": str(root_stat.st_ino),
        "batch_member": False,
        "directory": True,
        "argv_index": argv_index,
        "flag": flag,
        "equals_form": equals_form,
    }
    return direct, members


def _snapshot_inputs(inputs: list[dict], root: Path) -> tuple[dict[str, str], list[tuple[dict, bytes]]]:
    snapshots: dict[str, str] = {}
    batch_items: list[tuple[dict, bytes]] = []
    for index, item in enumerate(inputs):
        if item.get("directory") is not True:
            continue
        current, _ = _directory_fingerprint(Path(item.get("path", "")))
        expected = (item.get("device"), item.get("inode"), item.get("size"),
                    item.get("mtime_ns"), item.get("sha256"))
        actual = (current["device"], current["inode"], current["size"],
                  current["mtime_ns"], current["sha256"])
        if expected != actual:
            raise ValueError(f"billing input fingerprint changed: {item.get('path', '')}")
        destination = root / f"input-{index:04d}-directory"
        destination.mkdir(parents=True)
        snapshots[str(item["path"])] = str(destination)
    for index, item in enumerate(inputs):
        if item.get("directory") is True:
            continue
        directory_root = item.get("directory_root")
        relative_path = item.get("relative_path")
        if isinstance(directory_root, str) and isinstance(relative_path, str):
            destination = Path(snapshots[directory_root]) / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
        elif isinstance(item.get("implicit_kind"), str):
            destination = root / "implicit" / item["implicit_kind"] / Path(str(item["path"])).name
            destination.parent.mkdir(parents=True, exist_ok=True)
        else:
            destination = root / f"input-{index:04d}{Path(str(item.get('path', ''))).suffix}"
            destination.parent.mkdir(parents=True, exist_ok=True)
        raw = _copy_verified_input(item, destination)
        snapshots[str(item["path"])] = str(destination)
        if item.get("flag") == "--batch" or item.get("structured_kind"):
            batch_items.append((item, raw))
    return snapshots, batch_items


def _explicit_input_path(tool: str, flag: str, raw: str,
                         args: list[str], cwd: Path) -> Path:
    if tool == "synth_voice" and flag == "--script":
        path = Path(raw).expanduser()
        return path if path.is_absolute() else _job_path(args, cwd) / path
    if tool == "score_bed" and flag in {"--music", "--input", "--sfx-manifest"}:
        path = Path(raw).expanduser()
        if path.is_absolute():
            return path
        job_relative = _job_path(args, cwd) / path
        return job_relative if job_relative.exists() else cwd / path
    if tool == "verify_output" and flag in {"--input", "--beats", "--transcript"}:
        path = Path(raw).expanduser()
        return path if path.is_absolute() else _job_path(args, cwd) / path
    if tool == "review_output" and flag == "--video":
        path = Path(raw).expanduser()
        if path.is_absolute():
            return path
        job_relative = _job_path(args, cwd) / path
        return job_relative if job_relative.exists() else cwd / path
    return _absolute_input(raw, cwd)


def _batch_input_fields(tool: str, role: str | None) -> set[str]:
    """The schema-declared INPUT fields of one --batch item (never prompts or
    output targets). mint_image and genjutsu `references` are lists."""
    if tool == "mint_image":
        return {"references"}
    return {"edit": {"video"},
            "reenact": {"driver_video", "swap_image"},
            "genjutsu": {"video", "references"}}.get(role or "", set())


def _batch_member_paths(value: object, cwd: Path, tool: str,
                        role: str | None) -> set[Path]:
    """Only return schema-declared *inputs*.  Prompts and output targets are
    deliberately excluded: rewriting an output into the read-only snapshot
    tree lets execution succeed and then makes the download fail."""
    fields = _batch_input_fields(tool, role)
    paths: set[Path] = set()
    if not isinstance(value, list):
        return paths
    for row in value:
        if not isinstance(row, dict):
            continue
        for field in fields:
            values = row.get(field)
            if not isinstance(values, list):
                values = [values]
            for raw in values:
                if (isinstance(raw, str) and raw.strip()
                        and not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I)):
                    candidate = _absolute_input(raw, cwd)
                    if candidate.is_file():
                        paths.add(candidate.absolute())
    return paths


_COMPOSE_MEDIA_KEYS = frozenset({"spine", "lipsync", "clip", "path", "video", "file"})


def _compose_member_paths(value: object, job: Path) -> set[Path]:
    paths: set[Path] = set()
    if isinstance(value, list):
        for item in value:
            paths.update(_compose_member_paths(item, job))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in _COMPOSE_MEDIA_KEYS and isinstance(item, str):
                path = Path(item).expanduser()
                candidate = path if path.is_absolute() else job / path
                if candidate.is_file():
                    paths.add(candidate.absolute())
            else:
                paths.update(_compose_member_paths(item, job))
    return paths


def _rewrite_compose_paths(value: object, job: Path,
                           snapshots: dict[str, str]) -> object:
    if isinstance(value, list):
        return [_rewrite_compose_paths(item, job, snapshots) for item in value]
    if isinstance(value, dict):
        rewritten = {}
        for key, item in value.items():
            if key in _COMPOSE_MEDIA_KEYS and isinstance(item, str):
                path = Path(item).expanduser()
                absolute = str((path if path.is_absolute() else job / path).absolute())
                rewritten[key] = snapshots.get(absolute, item)
            else:
                rewritten[key] = _rewrite_compose_paths(item, job, snapshots)
        return rewritten
    return value


def _implicit_input_paths(tool: str, args: list[str], cwd: Path) -> list[tuple[Path, str]]:
    if tool == "build_carousel":
        job = _job_path(args, cwd)
        carousel_path = job / "carousel.json"
        paths = [(carousel_path, "carousel")]
        if carousel_path.is_file():
            carousel = json.loads(carousel_path.read_text(encoding="utf-8"))
            slides = carousel.get("slides") if isinstance(carousel, dict) else None
            if isinstance(slides, list):
                for slide in _selected_carousel_slides(slides, args):
                    if not isinstance(slide, dict):
                        continue
                    generated_here = (_one_flag(args, ("--mode",)) == "two_pass"
                                      and "--no-illustrations" not in args
                                      and slide.get("kind") != "closing"
                                      and slide.get("illustration_scene")
                                      and str(slide.get("illustration_source_relpath", "")).startswith("images/"))
                    if generated_here:
                        continue
                    field = ("stamp_source_relpath" if slide.get("kind") == "closing"
                             else "illustration_source_relpath")
                    raw = slide.get(field)
                    if isinstance(raw, str) and raw:
                        source = ((cwd / "jobs" / raw) if raw.startswith("_brand_")
                                  else (job / raw))
                        paths.append((source, "carousel_reference"))
        return paths
    if tool == "perform_avatar":
        job = _job_path(args, cwd)
        paths = [(job / "script.json", "avatar_script")]
        sheet = job / "avatar" / "character_sheet.json"
        if sheet.exists():
            paths.append((sheet, "avatar_sheet"))
        chunk = _one_flag(args, ("--chunk",))
        if "--sequential" in args and chunk is not None and int(chunk) > 0:
            previous = job / "chunks" / f"chunk_{int(chunk) - 1:02d}.mp4"
            if previous.exists():
                paths.append((previous, "avatar_previous_chunk"))
        return paths
    if tool == "cast_avatar" and _one_flag(args, ("--character-sheet",)) is None:
        return [(_job_path(args, cwd) / "avatar" / "character_sheet.json", "cast_sheet")]
    if tool == "synth_voice" and _one_flag(args, ("--mode",)) == "tts" \
            and _one_flag(args, ("--text",)) is None \
            and _one_flag(args, ("--script",)) is None:
        return [(_job_path(args, cwd) / "script.json", "voice_script")]
    if tool == "gemini_video" and _one_flag(args, ("--url",)) is None:
        job = _job_path(args, cwd)
        mode = _one_flag(args, ("--mode",))
        chunk = _one_flag(args, ("--chunk",))
        if mode == "chunk_review" and chunk == "all":
            return [(path, "gemini_chunk") for path in sorted(
                (job / "chunks").glob("chunk_*.mp4"))]
        if mode == "chunk_review" and chunk is not None:
            return [(job / "chunks" / f"chunk_{int(chunk):02d}.mp4", "gemini_media")]
        if mode == "final_review":
            return [(job / "final.mp4", "gemini_media")]
        if mode == "replication_brief":
            refs = sorted((job / "reference").glob("outlier__*.mp4"))
            return [(refs[0], "gemini_media")] if refs else []
    if tool == "compose_render" and _one_flag(args, ("--mode",)) == "episode" \
            and _one_flag(args, ("--num",)) is not None:
        job = _job_path(args, cwd)
        paths = [(Path(__file__).resolve().parent.parent / "fireplace.mp3", "episode_static"),
                 (job / "host_bed_v3.mp4", "episode_host_bed")]
        paths.extend((job / "broll" / f"{name}.mp4", "episode_broll") for name in (
            "mv_bookshelf", "mv_fire", "mv_rug", "mv_desk", "mv_painting",
            "mv_house"))
        return paths
    return []


def _selected_carousel_slides(slides: list, args: list[str]) -> list:
    slide = _one_flag(args, ("--slide",))
    if slide is not None:
        wanted = int(slide)
        return [row for row in slides if isinstance(row, dict) and row.get("index") == wanted]
    if "--style-proof" in args:
        preferred = [row for row in slides if isinstance(row, dict) and row.get("index") == 1]
        return preferred or slides[:1]
    regen = _one_flag(args, ("--regen",))
    if regen is not None:
        wanted = {int(value.strip()) for value in regen.split(",") if value.strip()}
        return [row for row in slides if isinstance(row, dict) and row.get("index") in wanted]
    return slides


def _implicit_count(tool: str, args: list[str], snapshots: dict[str, str],
                    inputs: list[dict], default: int) -> int:
    if tool == "build_carousel":
        item = next(entry for entry in inputs if entry.get("implicit_kind") == "carousel")
        carousel = json.loads(Path(snapshots[item["path"]]).read_text(encoding="utf-8"))
        slides = carousel.get("slides")
        if not isinstance(slides, list):
            raise ValueError("carousel.json has no slides array")
        selected = _selected_carousel_slides(slides, args)
        layout_count = len(selected)
        if _one_flag(args, ("--mode",)) != "two_pass" or "--no-illustrations" in args:
            return layout_count
        illustration_rows = [row for row in selected if isinstance(row, dict)
                             and row.get("illustration_scene")
                             and isinstance(row.get("illustration_source_relpath"), str)
                             and row["illustration_source_relpath"].startswith("images/")]
        return layout_count + len(illustration_rows)
    if tool == "perform_avatar":
        item = next(entry for entry in inputs if entry.get("implicit_kind") == "avatar_script")
        script = json.loads(Path(snapshots[item["path"]]).read_text(encoding="utf-8"))
        chunks = script.get("chunks")
        if not isinstance(chunks, list) or not chunks:
            raise ValueError("script.json has no chunks")
        return 1 if _one_flag(args, ("--chunk",)) is not None else len(chunks)
    if tool == "cast_avatar":
        if "--add-shot" in args:
            return 1
        return 2 if "--with-profile" in args or (
            "--regen-front" in args and "--regen-profile" in args) else 1
    if tool == "gemini_video" and _one_flag(args, ("--chunk",)) == "all":
        count = sum(entry.get("implicit_kind") == "gemini_chunk" for entry in inputs)
        if count < 1:
            raise ValueError("gemini chunk review has no chunk files")
        return count
    if tool == "pull_video" and _one_flag(args, ("--mode",)) == "enumerate":
        # --download is an additional paid acquisition fan-out, not a boolean.
        raw = _one_flag(args, ("--download",))
        if raw is None:
            return default
        if not re.fullmatch(r"[0-9]+", raw):
            raise ValueError("--download must be a nonnegative integer")
        return default + int(raw)
    if tool == "mint_image":
        batch = next((entry for entry in inputs if entry.get("flag") == "--batch"), None)
        if batch is not None:
            rows = json.loads(Path(snapshots[batch["path"]]).read_text(encoding="utf-8"))
            if not isinstance(rows, list) or not rows:
                raise ValueError("mint_image batch has no items")
            return sum(_positive_count(str(row.get("variants", 1)))
                       for row in rows if isinstance(row, dict))
    if tool == "synth_voice" and _one_flag(args, ("--mode",)) == "tts" \
            and _one_flag(args, ("--text",)) is None:
        script_entry = next((entry for entry in inputs if entry.get("flag") == "--script"
                             or entry.get("implicit_kind") == "voice_script"), None)
        if script_entry is not None:
            script = json.loads(Path(snapshots[script_entry["path"]]).read_text())
            chunks = script.get("chunks") or script.get("script")
            if not isinstance(chunks, list) or not chunks:
                raise ValueError("voice script has no chunks")
            selected = []
            requested = _one_flag(args, ("--chunk",))
            for index, chunk in enumerate(chunks):
                if requested is not None and index != int(requested):
                    continue
                if not isinstance(chunk, dict):
                    continue
                text = chunk.get("text") or chunk.get("dialogue") or ""
                if isinstance(text, str) and text.strip():
                    selected.append(chunk)
            if not selected:
                raise ValueError("voice script has no executable chunks")
            return len(selected)
    return default


def _mint_image_plan_price(args: list[str], count: int,
                           batch: str | Path | None) -> dict:
    """Price the exact immutable mint-image execution shape.

    ``estimate()`` intentionally exposes only the public Nano role table.  The
    canonical tool also supports the explicit GPT rollback rail, whose price
    varies by quality and aspect, and batch mode, whose fan-out lives inside
    the JSON input. Pricing either through the generic fixed row would reject
    the batch or under-estimate GPT as Nano. This helper consumes the already
    snapshotted batch bytes used by ``billing_plan`` so plan price, count, and
    execution all describe the same immutable input.
    """
    model = _one_flag(args, ("--model",)) or "default"
    if model not in {"default", "nano-banana-2", "gpt-image-2"}:
        raise ValueError("mint_image model is not an allowed billing rail")
    quality = _one_flag(args, ("--quality",)) or "high"
    aspect = _one_flag(args, ("--aspect", "--aspect-ratio"))
    role = _one_flag(args, ("--role",))
    if aspect is None:
        aspect = "1:1" if role == "overlay" else "2:3"
    valid_qualities = {"low", "medium", "high", "auto"}
    valid_aspects = {"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "auto"}
    if quality not in valid_qualities or aspect not in valid_aspects:
        raise ValueError("mint_image quality/aspect is not an allowed billing shape")

    shapes: list[tuple[str, str, int]] = []
    if batch is None:
        shapes.append((quality, aspect, count))
    else:
        try:
            rows = json.loads(Path(batch).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("mint_image batch is not valid JSON") from exc
        if not isinstance(rows, list) or not rows:
            raise ValueError("mint_image batch has no items")
        for index, row in enumerate(rows, start=1):
            if (not isinstance(row, dict) or not isinstance(row.get("name"), str)
                    or not row["name"] or not isinstance(row.get("prompt"), str)
                    or not row["prompt"]):
                raise ValueError(
                    f"mint_image batch item {index} needs a name and prompt"
                )
            item_quality = row.get("quality") or quality
            item_aspect = row.get("aspect") or aspect
            variants = row.get("variants", 1)
            if (item_quality not in valid_qualities
                    or item_aspect not in valid_aspects
                    or isinstance(variants, bool)
                    or not isinstance(variants, int)
                    or not 1 <= variants <= 10):
                raise ValueError(
                    f"mint_image batch item {index} has an invalid billing shape"
                )
            shapes.append((item_quality, item_aspect, variants))

    priced_count = sum(variants for _, _, variants in shapes)
    if priced_count != count:
        raise ValueError("mint_image billing fan-out changed while snapshotting")
    if model == "gpt-image-2":
        total = sum(
            gpt_image_unit_price(item_quality, item_aspect) * variants
            for item_quality, item_aspect, variants in shapes
        )
    else:
        unit, _ = unit_price("mint_image", role)
        if unit is None:
            raise ValueError("mint_image default rail has no billing price")
        total = unit * priced_count
    total = round(total, 4)
    return {
        "tool": "mint_image",
        "role": role,
        "count": priced_count,
        "unit_usd": round(total / priced_count, 4),
        "est_usd": total,
        "free": False,
        "unknown": False,
        "seconds_source": "fixed",
        "model": model,
        "label": f"mint_image[{role or '_default'}] {model} exact execution shape",
    }


# --quality values each mint_video i2v mode accepts, mirroring
# mint_video.QUALITY_BY_MODE. A shape the tool would reject must never be
# priced as if it would run.
_MINT_VIDEO_DECLARED_ROLES = frozenset({"insert", "keyframe", "multishot"})



def _mint_video_quality(args: list[str]) -> str:
    """The effective --quality, resolving the legacy --fast alias exactly as
    mint_video._effective_quality does."""
    quality = _one_flag(args, ("--quality",))
    if "--fast" in args:
        if quality not in (None, "draft"):
            raise ValueError("mint_video --fast contradicts an explicit --quality")
        return "draft"
    return quality or "standard"


def _mint_video_plan_price(args: list[str], count: int, role: str,
                           multishot_file: str | Path | None) -> dict:
    """Price the exact immutable Seedance/Omni i2v execution shape (#78).

    These rails are metered PER SECOND of declared output, at a price set by the
    route --quality selects, the --resolution it bills at and — on Seedance 2.5,
    which is billed by output tokens — the --aspect-ratio that fixes the frame
    geometry. The generic per-second row (deliberately the dearest reachable
    rate) would over-reserve every default 720p call. The canonical plan sees
    the whole argv, so it prices the shape that will actually run — and refuses,
    rather than guesses, a shape with no published terminal price.
    """
    quality = _mint_video_quality(args)
    if quality not in QUALITY_BY_MODE[role]:
        raise ValueError(
            f"mint_video --mode {role} does not support --quality {quality}")
    if _one_flag(args, ("--batch",)) is not None:
        # A generation batch launches one metered call PER ITEM, each with its
        # own duration/quality/resolution overrides (#273). Pricing the CLI
        # shape once would be a known-looking under-estimate (#74's family);
        # the gateway prices every item exactly at its admission instead.
        raise ValueError(
            f"mint_video --mode {role} --batch has no single exact price; "
            "each item is priced when it is submitted")

    if role == "multishot":
        invoice = _multishot_invoice(_one_flag(args, ("--multishot",)),
                                     multishot_file)
        if invoice is None:
            raise ValueError("mint_video multishot payload has no billed duration")
        # The shot sum IS the duration run_multishot sends; a contradicting
        # --duration only earns a warning from the tool and is never billed.
        seconds, _shots = invoice
        seconds = _clamp("mint_video:multishot", seconds)
        source = "payload"
        route = "gemini-omni-flash-preview"
        rate = PER_SECOND["mint_video:multishot"]
        unit_cost = round(rate * seconds, 6)
    else:
        raw = _one_flag(args, ("--duration",))
        duration: float | None = None
        if raw is not None:
            try:
                duration = float(raw)
            except ValueError as exc:
                raise ValueError("mint_video --duration must be a number") from exc
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("mint_video --duration must be positive")
        seconds = _clamp(f"mint_video:{role}",
                         mint_video_declared_seconds(role, duration, quality))
        source = "default" if duration is None else "declared"
        resolution = ("720p" if quality == "draft"
                      else (_one_flag(args, ("--resolution",)) or "720p"))
        # mint_video's own --aspect-ratio default. It is a pricing dimension on
        # Seedance 2.5, which the backend refuses to admit without one.
        aspect_ratio = _one_flag(args, ("--aspect-ratio",)) or "9:16"
        route = SEEDANCE_QUALITY_ROUTE[quality]
        unit_cost = seedance_terminal_cost(route, seconds, resolution,
                                           aspect_ratio)
        if unit_cost is None:
            raise ValueError(
                f"mint_video {route} has no published terminal price at "
                f"{resolution}/{aspect_ratio}")
        rate = round(unit_cost / seconds, 6)

    total = round(unit_cost * count, 4)
    return {
        "tool": "mint_video",
        "role": role,
        "count": count,
        "seconds": seconds,
        "seconds_source": source,
        "unit_usd": rate,
        "est_usd": total,
        "free": False,
        "unknown": False,
        "model": route,
        "label": f"mint_video[{role}] {route} ×{count} × {seconds:g}s @ ${rate}/s",
    }


def billing_plan(command: str, cwd: str | Path,
                 engine_root: str | Path | None = None) -> dict:
    run_cwd = Path(cwd).expanduser().resolve()
    installed_engine = Path(__file__).resolve().parent.parent
    plan_engine = (Path(engine_root).expanduser().resolve()
                   if engine_root is not None else installed_engine)
    if plan_engine != installed_engine:
        raise ValueError("billing engine root is not the installed engine")
    argv = _command_argv(command)
    target_index, tool = _tool_target(argv, plan_engine)
    args = argv[target_index + 1:]
    owned_result = _tool_owned_manifest(tool, args, run_cwd)
    owned_manifest = owned_result[0] if owned_result else None
    owned_parser = owned_result[1] if owned_result else None
    request = ({"tool": tool, "role": owned_manifest.get("role"),
                "count": owned_manifest["count"]}
               if owned_manifest is not None else _pricing_request(tool, args))
    if tool == "mint_video":
        from prepare_production import MINT_VIDEO_UNAVAILABLE_MODES  # noqa: PLC0415
        if request.get("role") in MINT_VIDEO_UNAVAILABLE_MODES:
            raise ValueError(MINT_VIDEO_UNAVAILABLE_MODES[request["role"]])
    inputs: list[dict] = []
    seen: set[Path] = set()
    if owned_manifest is not None:
        if owned_manifest.get("price_components") is not None:
            request["price_components"] = owned_manifest["price_components"]
        occurrences: dict[str, int] = {}
        for declared in owned_manifest["inputs"]:
            if not isinstance(declared, dict) or not isinstance(declared.get("path"), str):
                raise ValueError(f"{tool} emitted a malformed billing input")
            path = Path(declared["path"]).expanduser().absolute()
            if not path.exists():
                raise ValueError(f"billing input does not exist: {path}")
            origin = None
            dest = declared.get("dest")
            if isinstance(dest, str):
                occurrence = occurrences.get(dest, 0)
                rel_index, flag, _raw, equals_form = _manifest_input_origin(
                    owned_parser, args, dest, occurrence)
                occurrences[dest] = occurrence + 1
                origin = (target_index + 1 + rel_index, flag, equals_form)
            if path.is_dir():
                direct, members = _directory_fingerprint(
                    path, argv_index=origin[0] if origin else None,
                    flag=origin[1] if origin else None,
                    equals_form=origin[2] if origin else False)
                inputs.append(direct)
                inputs.extend(member for member in members if Path(member["path"]) not in seen)
                item = direct
            else:
                item = _fingerprint(path, argv_index=origin[0] if origin else None,
                                    flag=origin[1] if origin else None,
                                    equals_form=origin[2] if origin else False,
                                    batch_member=origin is None)
                inputs.append(item)
            if isinstance(declared.get("kind"), str):
                item["implicit_kind"] = declared["kind"]
            if isinstance(declared.get("structured_kind"), str):
                item["structured_kind"] = declared["structured_kind"]
            if declared.get("map_only") is True:
                item["map_only"] = True
            if isinstance(declared.get("inline_dest"), str):
                item["inline_dest"] = declared["inline_dest"]
            seen.add(path)
            if dest == "batch":
                batch_raw, _ = _secure_file_bytes(path)
                batch_json = json.loads(batch_raw)
                for member in sorted(_batch_member_paths(
                        batch_json, run_cwd, tool, request.get("role")), key=str):
                    if member not in seen:
                        inputs.append(_fingerprint(member, batch_member=True))
                        seen.add(member)

    file_flags = (frozenset() if owned_manifest is not None
                  else _FILE_INPUTS_BY_TOOL.get(tool, frozenset()))
    for rel_index, flag, raw, equals_form in _flag_values(args, file_flags, repeat=True):
        # Repeated references/videos are legitimate; duplicate singleton billing
        # flags were already rejected by _pricing_request.
        if flag not in _REPEATABLE_FILE_FLAGS and sum(1 for _, f, _, _ in _flag_values(args, frozenset({flag}), repeat=True) if f == flag) > 1:
            raise ValueError(f"duplicate file input flag {flag}")
        if re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I):
            continue  # remote resources are immutable argv, not local files
        if tool == "compose_render" and flag == "--broll-inserts" and raw.lstrip().startswith("["):
            continue
        path = _explicit_input_path(tool, flag, raw, args, run_cwd)
        if not path.exists():
            raise ValueError(f"billing input does not exist: {path}")
        absolute_index = target_index + 1 + rel_index
        if path.is_dir():
            direct, members = _directory_fingerprint(
                path, argv_index=absolute_index, flag=flag,
                equals_form=equals_form)
            inputs.append(direct)
            inputs.extend(member for member in members if Path(member["path"]) not in seen)
        else:
            inputs.append(_fingerprint(path, argv_index=absolute_index, flag=flag,
                                       equals_form=equals_form))
        if tool == "cast_avatar" and flag == "--character-sheet":
            inputs[-1]["map_only"] = True
        seen.add(path.absolute())
        if flag == "--batch":
            batch_raw, _ = _secure_file_bytes(path)
            try:
                batch_json = json.loads(batch_raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("batch input is not valid JSON") from exc
            for member in sorted(_batch_member_paths(batch_json, run_cwd, tool,
                                                     request.get("role")), key=str):
                if member not in seen:
                    inputs.append(_fingerprint(member, batch_member=True))
                    seen.add(member)
        if tool == "compose_render" and flag in {"--episode_manifest", "--broll-inserts"}:
            structured_raw, _ = _secure_file_bytes(path)
            try:
                structured = json.loads(structured_raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("compose manifest is not valid JSON") from exc
            inputs[-1]["structured_kind"] = "compose_manifest"
            for member in sorted(_compose_member_paths(
                    structured, _job_path(args, run_cwd)), key=str):
                if member not in seen:
                    inputs.append(_fingerprint(member, batch_member=True))
                    seen.add(member)

    if tool == "frame_insert":
        for rel_index, flag, raw, equals_form in _flag_values(
                args, ("--insert",), repeat=True):
            try:
                media_raw, start, end = raw.rsplit(",", 2)
                float(start)
                float(end)
            except ValueError as exc:
                raise ValueError("--insert must be path,start,end") from exc
            path = _absolute_input(media_raw, run_cwd)
            item = _fingerprint(path, argv_index=target_index + 1 + rel_index,
                                flag=flag, equals_form=equals_form)
            item["compound_suffix"] = f",{start},{end}"
            inputs.append(item)

    for path, kind in ([] if owned_manifest is not None
                       else _implicit_input_paths(tool, args, run_cwd)):
        absolute = path.absolute()
        if not absolute.is_file():
            raise ValueError(f"implicit billing input does not exist: {absolute}")
        if absolute not in seen:
            item = _fingerprint(absolute, batch_member=True)
            item["implicit_kind"] = kind
            inputs.append(item)
            seen.add(absolute)

    # The quote must be derived from the exact bytes that were fingerprinted.
    # Copy-and-revalidate first, then point every duration/batch pricing input at
    # the immutable copy.  A swap between ffprobe and hashing can no longer buy
    # a long execution with a short-file quote.
    with tempfile.TemporaryDirectory(prefix="videoclaw-price-") as temp:
        snapshots, batch_items = _snapshot_inputs(inputs, Path(temp))
        if owned_manifest is not None:
            previous_map = os.environ.get("VIDEOCLAW_BILLING_INPUT_MAP")
            os.environ["VIDEOCLAW_BILLING_INPUT_MAP"] = _canonical_json(snapshots)
            try:
                verified_result = _tool_owned_manifest(tool, args, run_cwd)
            finally:
                if previous_map is None:
                    os.environ.pop("VIDEOCLAW_BILLING_INPUT_MAP", None)
                else:
                    os.environ["VIDEOCLAW_BILLING_INPUT_MAP"] = previous_map
            verified = verified_result[0]
            reverse = {str(Path(snapshot).absolute()): original
                       for original, snapshot in snapshots.items()}
            def declared_paths(manifest: dict) -> list[str]:
                result = []
                for entry in manifest["inputs"]:
                    absolute = str(Path(entry["path"]).expanduser().absolute())
                    result.append(reverse.get(absolute, absolute))
                return sorted(result)
            if (verified.get("role") != owned_manifest.get("role")
                    or verified.get("count") != owned_manifest.get("count")
                    or declared_paths(verified) != declared_paths(owned_manifest)):
                raise ValueError(f"{tool} billing manifest changed while snapshotting")
        for item, raw in batch_items:
            try:
                parsed = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("snapshotted batch input is malformed") from exc
            rewritten = (_rewrite_compose_paths(parsed, _job_path(args, run_cwd), snapshots)
                         if item.get("structured_kind") == "compose_manifest"
                         else _rewrite_batch_paths(parsed, run_cwd, snapshots, tool,
                                                   request.get("role")))
            path = Path(snapshots[str(item["path"])])
            path.chmod(0o600)
            path.write_text(_canonical_json(rewritten), encoding="utf-8")
            path.chmod(0o400)
        if owned_manifest is None:
            request["count"] = _implicit_count(tool, args, snapshots, inputs,
                                                request["count"])
        if request["count"] < 1:
            raise ValueError("billing fan-out has no executable items")
        for key, flag in (("media", PER_SECOND_BILLED_MEDIA.get(
                f"{tool}:{request.get('role')}") or PER_SECOND_BILLED_MEDIA.get(tool)),
                          ("batch", "--batch"), ("shared_swap", "--swap-image")):
            if key not in request or not flag:
                continue
            match = next((item for item in inputs if item.get("flag") == flag), None)
            if match is not None:
                request[key] = snapshots[match["path"]]
        if "shared_references" in request:
            # Local references were fingerprinted above (a missing one already
            # refused the plan); price from those verified snapshots, in argv
            # order. Remote values stay literal for the usability check.
            local = iter(sorted((item for item in inputs if item.get("flag") == "--reference"),
                                key=lambda item: item.get("argv_index", -1)))
            request["shared_references"] = [
                raw if re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.I)
                else snapshots[next(local)["path"]]
                for raw in request["shared_references"]]
        download_raw = (_one_flag(args, ("--download",))
                        if tool == "pull_video" and request.get("role") == "enumerate"
                        else None)
        if download_raw is not None:
            downloads = int(download_raw)
            enumeration = estimate(tool="pull_video", role="enumerate", count=1)
            pulls = (estimate(tool="pull_video", role="pull", count=downloads)
                     if downloads else {"est_usd": 0})
            quote = dict(enumeration)
            quote.update({
                "count": 1 + downloads,
                "unit_usd": None,
                "est_usd": round(float(enumeration["est_usd"]) +
                                 float(pulls["est_usd"]), 4),
                "label": "profile enumeration plus requested downloads",
                "seconds_source": "fixed",
            })
        elif tool == "mint_image":
            quote = _mint_image_plan_price(
                args,
                request["count"],
                request.get("batch"),
            )
        elif tool == "mint_video" and request.get("role") in _MINT_VIDEO_DECLARED_ROLES:
            shots = next((item for item in inputs
                          if item.get("flag") == "--multishot-file"), None)
            quote = _mint_video_plan_price(
                args,
                request["count"],
                str(request["role"]),
                snapshots[shots["path"]] if shots is not None else None,
            )
        else:
            quote = estimate(**request)
    if quote.get("unknown") or not isinstance(quote.get("est_usd"), (int, float)):
        raise ValueError(str(quote.get("label") or "billing price is unknown"))
    if quote["est_usd"] == 0 and quote.get("free") is not True:
        raise ValueError("zero estimate has no positive free proof")

    job_arg = _one_flag(args, ("--job",))
    plan = {
        "version": BILLING_PLAN_VERSION,
        "argv": argv,
        "cwd": str(run_cwd),
        # Bind the resolver's plan-time choice. A late <cwd>/<job-id>/ directory
        # must never steal precedence from the planned <cwd>/jobs/<job-id>/.
        "job_path": (str(_job_path(args, run_cwd))
                     if job_arg is not None else None),
        "engine_root": str(plan_engine),
        "tool": tool,
        "role": request.get("role"),
        "count": request["count"],
        "inputs": sorted(inputs, key=lambda item: (item["path"], item.get("argv_index", -1))),
        "price": quote,
    }
    plan["plan_sha256"] = _plan_sha256(plan)
    return plan


def _copy_verified_input(item: dict, destination: Path) -> bytes:
    path = Path(item.get("path", ""))
    raw, st = _secure_file_bytes(path)
    digest = hashlib.sha256(raw).hexdigest()
    expected = (item.get("device"), item.get("inode"), item.get("size"), item.get("mtime_ns"), item.get("sha256"))
    actual = (str(st.st_dev), str(st.st_ino), st.st_size, str(st.st_mtime_ns), digest)
    if expected != actual:
        raise ValueError(f"billing input fingerprint changed: {path}")
    destination.write_bytes(raw)
    destination.chmod(0o400)
    return raw


def _rewrite_batch_paths(value: object, cwd: Path, snapshots: dict[str, str],
                         tool: str, role: str | None) -> object:
    fields = _batch_input_fields(tool, role)
    if not isinstance(value, list):
        return value
    rewritten: list[object] = []
    for row in value:
        if not isinstance(row, dict):
            rewritten.append(row)
            continue
        copy = dict(row)
        for field in fields:
            raw = copy.get(field)
            values = raw if isinstance(raw, list) else [raw]
            replaced = []
            for value_item in values:
                if isinstance(value_item, str) and not re.match(r"^[a-z][a-z0-9+.-]*://", value_item, re.I):
                    absolute = str(_absolute_input(value_item, cwd).absolute())
                    value_item = snapshots.get(absolute, value_item)
                replaced.append(value_item)
            copy[field] = replaced if isinstance(raw, list) else replaced[0]
        rewritten.append(copy)
    return rewritten


# ---------------------------------------------------------------------------
# reconcile — sum estimate_usd already logged for a job: ONE dollar per call.
#
# Canonical-carrier rule (#63 + the engine half of backend#35):
#   1. FAILURES NEVER SPEND. A row whose `status` is a failure (failed /
#      canceled / timeout / error) never adds to the total — failed calls are
#      tallied in their own section, with whatever dollars pre-fix ledgers
#      wrongly booked on them shown as excluded.
#   2. LEGACY DUPLICATES ARE MATCHED, NEVER BLANKET-DEDUPED. A paid vendor
#      call's cost lives on its call row — `gateway_call` (gateway mode) or
#      `replicate_call` (local mode). Pre-#63 mint_image ALSO copied the same
#      figure onto its produced-asset row, strictly 1:1 and always call-row-
#      first (the batch client finishes every call before the tool emits its
#      asset events). So a produced-asset row's estimate_usd is suppressed
#      ONLY when it correlates with such a duplicate: an EARLIER, SUCCEEDED,
#      cost-carrying call row of the same tool with the same dollars that no
#      other produced row has already claimed (1:1 consumption), and the
#      produced row does not mark itself `gateway: true` (that flag is the
#      deliberate single-carrier pattern — synth_voice tts_generated etc.).
#      Everything unmatched counts as logged. Review round 1 BLOCKING-2: the
#      first cut deduped per-TOOL, which destroyed sole carriers in mixed-era
#      ledgers (metered single-mode mints, tts rows) and let failed or $0.00
#      call rows arm the dedupe sideways.
#   3. SINGLE-CARRIER TOOLS ARE UNTOUCHED. Tools that meter on their own tool
#      events by design (synth_voice tts, pull_video, score_bed, gemini_video,
#      … — they pass client_job=, not job=, so no call row exists for that
#      spend) keep counting exactly as before.
#   4. ACCEPTED-UNKNOWN IS NOT FAILURE OR ZERO. A gateway POST/poll response can
#      be lost after vendor acceptance. Those rows carry no invented dollars and
#      are surfaced separately by count, tool, and warning so the numeric total
#      cannot be mistaken for complete actual spend.
# ---------------------------------------------------------------------------

# A generation tool signals a produced asset with one of these events. We price
# each such event from the table (role-accurate) — this is how reconcile covers
# tools that log no estimate_usd at all: the table tops up whatever the logged
# rows don't cover (never double: the top-up is max(0, expected - logged)).
_PRODUCED_EVENTS = {"images_generated", "video_generated", "bed_generated",
                    "avatar_generated", "clip_generated", "voice_generated"}
_PRODUCED_SUFFIXES = ("_generated", "_rendered", "_synthesized")

# The two call-row emitters (rule 2). Everything else that carries estimate_usd
# is a tool-owned single carrier (rule 3).
_CALL_COST_EVENTS = {"gateway_call", "replicate_call"}

# Failure statuses across both emitters (rule 1): _gateway logs the backend's
# terminal status (failed/canceled), replicate_safe logs failed/timeout.
_FAILURE_STATUSES = {"failed", "canceled", "cancelled", "timeout", "error"}
# A paid gateway POST whose response or accepted-job poll was lost. Its actual
# vendor dollars are UNKNOWN: it is neither a confirmed failure nor $0 spend.
_UNRESOLVED_ACCEPTED_STATUSES = {
    "accepted_unknown",
    "running",
    "reconciling",
    "submission_unknown",
}


def _is_produced(e: dict) -> bool:
    ev = e.get("event") or ""
    if unit_price(e.get("tool", ""), None)[0] is None:
        return False  # not a priced (generative) tool
    return ev in _PRODUCED_EVENTS or ev.endswith(_PRODUCED_SUFFIXES)


def _tool_key(e: dict) -> str:
    """One ledger key per tool. gateway_call rows log the bare tool name
    ('mint_image') while tool-owned rows log the script name ('mint_image.py');
    without normalization the same tool splits into two buckets — the dedupe
    (rule 2) never fires against real ledgers, and the table imputation tops
    up the .py bucket on top of fully-logged gateway spend (a fresh 3-image
    job read $0.87 instead of $0.75)."""
    return (e.get("tool") or "?").removesuffix(".py")


# Dollar tolerance for matching a legacy duplicate to its call row: the copy
# was round()ed to 4dp of the same float the call row logged raw, so they can
# differ by sub-cent dust but never by a real amount.
_MATCH_TOLERANCE_USD = 0.005


def _consume_match(amounts: list[float] | None, usd: float) -> bool:
    """Pop (consume) one amount within tolerance of `usd` from `amounts`.
    Each earlier call row can absorb AT MOST one produced row — the verified
    legacy shape is strictly 1:1."""
    if not amounts:
        return False
    for i, a in enumerate(amounts):
        if abs(a - usd) <= _MATCH_TOLERANCE_USD:
            amounts.pop(i)
            return True
    return False


def _row_usd(e: dict) -> float | None:
    """The row's estimate_usd as a float, or None when absent/None/garbage
    (failed calls log estimate_usd=None — that is 'no cost', never $0.00-and-
    counted)."""
    v = e.get("estimate_usd")
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _is_failed(e: dict) -> bool:
    return str(e.get("status") or "").lower() in _FAILURE_STATUSES


def _is_unresolved_accepted(e: dict) -> bool:
    return str(e.get("status") or "").lower() in _UNRESOLVED_ACCEPTED_STATUSES


def _asset_count(e: dict) -> int:
    for k in ("count", "n_images", "variants", "num", "n"):
        v = e.get(k)
        # An explicit zero is meaningful for a produced-event row whose paid
        # provider chunks all failed. Missing/legacy counts still fall back to
        # one, but zero survivors must never be repriced as one delivered asset.
        if isinstance(v, int) and v >= 0:
            return v
    return 1


def _produced_unit(e: dict, tool: str, role: str | None) -> float | None:
    """Model-aware fallback price for produced assets with no call dollars.

    Reconciliation spans old GPT ledgers and new Nano ledgers. Repricing an
    old GPT asset with today's Nano default corrupts the historical total, so
    retain the former role table when legacy rows lack quality/aspect. New GPT
    rows carry both dimensions and can use the exact published size rate.
    """
    if tool != "mint_image":
        return unit_price(tool, role)[0]
    # `model=default` is the user's semantic selection. A route receipt can pin
    # that selection to GPT during a rollback, so prefer the persisted effective
    # rail when reconstructing a ledger whose gateway-call dollars are absent.
    model = str(e.get("resolved_model") or e.get("model") or "").lower()
    if "gpt-image-2" not in model:
        return unit_price(tool, role)[0]
    quality = e.get("quality")
    aspect = e.get("aspect") or e.get("aspect_ratio")
    if quality is not None and aspect is not None:
        rates = {
            "low": (0.011, 0.016),
            "medium": (0.042, 0.063),
            "high": (0.167, 0.250),
        }
        square, rectangular = rates.get(str(quality).lower(), rates["high"])
        return square if aspect == "1:1" else rectangular
    return 0.17 if role in {"portrait", "artistic_still"} else 0.04


def reconcile(job: Path) -> dict:
    """Sum a job's logged spend for the after-the-fact cost summary.

    This is a display/reconciliation figure, never an authority that gates or
    unlocks work. The current host and gateway own authorization, reservations,
    and authoritative settlement state.

    `imputed_usd`/`spent_est_usd` top up a produced asset from the FIXED
    per-event table row (unit_price) when a call logged no cost carrier — e.g. a
    raw-FAL edit with no gateway_call row imputes mint_video:edit's $1.05 role
    figure, which UNDERSTATES the ~$5.20 the duration rail actually bills. That
    is acceptable here precisely because this total is non-authoritative: it can
    only mislead a human reading the summary, never lower an apparent cost for
    host policy. (If reconcile is ever wired into gating, the imputed
    portion must be marked non-authoritative first.)
    """
    events = read_events(job)
    logged_by_tool: dict[str, float] = {}      # $ tools ACTUALLY logged (estimate_usd)
    by_model: dict[str, float] = {}
    expected_by_tool: dict[str, float] = {}     # $ the table says the produced assets cost
    assets_by_tool: dict[str, int] = {}
    logged_calls = 0
    failed_calls = 0
    failed_by_tool: dict[str, int] = {}
    unresolved_accepted_calls = 0
    unresolved_accepted_by_tool: dict[str, int] = {}
    excluded_failed_usd = 0.0                   # $ pre-fix ledgers booked on failures
    deduped_rows = 0
    deduped_usd = 0.0                           # $ ignored as legacy double-logging

    # Rule 2 state: per-tool dollar amounts of EARLIER succeeded cost-carrying
    # call rows not yet claimed by a produced-asset row. Failed rows never
    # enter (rule 1 continues before this), so an excluded failure can never
    # arm the dedupe sideways.
    open_call_usd: dict[str, list[float]] = {}
    observed_music_jobs: set[str] = set()

    for e in events:
        usd = _row_usd(e)
        t = _tool_key(e)
        # Ambiguous accepted gateway calls have unknown dollars. Keep them out
        # of the numeric total WITHOUT calling them failed or silently treating
        # them as $0; the summary exposes a separate warning/count/by-tool lane.
        if _is_unresolved_accepted(e):
            unresolved_accepted_calls += 1
            unresolved_accepted_by_tool[t] = (
                unresolved_accepted_by_tool.get(t, 0) + 1
            )
            continue
        # Rule 1: failed/canceled/timed-out rows never spend — tally instead.
        # Failed work is normally unbilled. A gateway may explicitly report an
        # actual/vendor-priced charge even on failure; that authoritative row
        # carries billed_on_failure and must reconcile into the same total the
        # account ledger uses.
        if _is_failed(e):
            failed_calls += 1
            failed_by_tool[t] = failed_by_tool.get(t, 0) + 1
            if e.get("billed_on_failure"):
                pass
            elif usd is not None:
                excluded_failed_usd = round(excluded_failed_usd + usd, 4)
                continue
            else:
                continue
        # Generated and recovered music share one accepted job. Repeat reads
        # across restarts observe its charge; they are not new paid calls.
        # ponytail: terminal charges are immutable; reconcile revisions here if that contract changes.
        music_job = e.get("gateway_job_id")
        if (t == "score_bed" and e.get("event") in {"bed_generated", "bed_recovered"}
                and usd is not None and isinstance(music_job, str) and music_job):
            if music_job in observed_music_jobs:
                deduped_rows += 1
                deduped_usd = round(deduped_usd + usd, 4)
                continue
            observed_music_jobs.add(music_job)
        # (1) real logged estimates, one carrier per call (rules 2 + 3)
        if usd is not None:
            is_call = e.get("event") in _CALL_COST_EVENTS
            if is_call:
                open_call_usd.setdefault(t, []).append(usd)
            if (not is_call and _is_produced(e) and not e.get("gateway")
                    and _consume_match(open_call_usd.get(t), usd)):
                # Rule 2: correlated legacy duplicate — an earlier succeeded
                # call row of this tool already booked these exact dollars.
                deduped_rows += 1
                deduped_usd = round(deduped_usd + usd, 4)
            else:
                logged_calls += 1
                logged_by_tool[t] = round(logged_by_tool.get(t, 0.0) + usd, 4)
                m = e.get("resolved_model") or e.get("model")
                if m:
                    by_model[m] = round(by_model.get(m, 0.0) + usd, 4)
        # (2) produced-asset events → table-priced expectation (role-accurate)
        if _is_produced(e):
            role = e.get("usage_role") or e.get("role") or e.get("mode")
            unit = _produced_unit(e, t, role)
            if unit is not None:
                n = _asset_count(e)
                expected_by_tool[t] = round(expected_by_tool.get(t, 0.0) + unit * n, 4)
                assets_by_tool[t] = assets_by_tool.get(t, 0) + n

    # Per tool: total = logged, topped up by whatever the table expected beyond what
    # was logged (so a tool that logs nothing is imputed in full; one that logs
    # everything is imputed 0 — never double-counted).
    by_tool_total: dict[str, float] = {}
    imputed_usd = 0.0
    cost_blind: list[str] = []           # priced tools that produced assets but logged $0
    for t in set(logged_by_tool) | set(expected_by_tool):
        logged = logged_by_tool.get(t, 0.0)
        expected = expected_by_tool.get(t, 0.0)
        imp = max(0.0, round(expected - logged, 4))
        imputed_usd += imp
        by_tool_total[t] = round(logged + imp, 4)
        if expected > 0 and logged == 0.0:
            cost_blind.append(t)

    total = round(sum(by_tool_total.values()), 4)
    logged_usd = round(sum(logged_by_tool.values()), 4)
    reconciliation_warnings: list[str] = []
    if unresolved_accepted_calls:
        reconciliation_warnings.append(
            f"{unresolved_accepted_calls} accepted gateway call(s) have "
            "unresolved actual spend and are not included in spent_est_usd; "
            "verify the gateway ledger before treating this total as complete."
        )

    result = {
        "job": job.name,
        "spent_est_usd": total,
        "logged_usd": logged_usd,
        "imputed_usd": round(imputed_usd, 4),
        "logged_calls": logged_calls,
        "assets_by_tool": dict(sorted(assets_by_tool.items(), key=lambda kv: -kv[1])),
        "by_tool": dict(sorted(by_tool_total.items(), key=lambda kv: -kv[1])),
        "by_model": dict(sorted(by_model.items(), key=lambda kv: -kv[1])),
        "cost_blind_tools": sorted(cost_blind),
        # Failure section (rule 1): visible, never summed into spent_est_usd.
        "failed_calls": failed_calls,
        "failed_by_tool": dict(sorted(failed_by_tool.items(), key=lambda kv: -kv[1])),
        "excluded_failed_usd": round(excluded_failed_usd, 4),
        # Accepted-but-unresolved calls: dollar amount intentionally unknown.
        "unresolved_accepted_calls": unresolved_accepted_calls,
        "unresolved_accepted_by_tool": dict(sorted(
            unresolved_accepted_by_tool.items(), key=lambda kv: -kv[1]
        )),
        "spend_estimate_complete": unresolved_accepted_calls == 0,
        "reconciliation_warnings": reconciliation_warnings,
        # Legacy double-log dedupe (rule 2): what pre-#63 rows would have added.
        "deduped_rows": deduped_rows,
        "deduped_usd": round(deduped_usd, 4),
    }

    return result


_DIRECT_GATEWAY_QUOTE_TOOLS = {
    "mint_image",
    "mint_video",
}


def _image_batch_calls(
    batch: str | Path, default_quality: str
) -> list[tuple[str, int]] | None:
    """Return one quote shape per gateway call made by mint_image.run_batch."""
    try:
        specs = json.loads(Path(batch).expanduser().read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(specs, list) or not specs:
        return None
    calls: list[tuple[str, int]] = []
    for spec in specs:
        if not isinstance(spec, dict) or not spec.get("name") or not spec.get("prompt"):
            return None
        item_quality = spec.get("quality") or default_quality
        if item_quality not in {"low", "medium", "high", "auto"}:
            return None
        try:
            variants = int(spec.get("variants", 1))
        except (TypeError, ValueError):
            return None
        if variants < 1 or variants > 10:
            return None
        for offset in range(0, variants, 4):
            calls.append((item_quality, min(4, variants - offset)))
    return calls


def _quote_model(model: str | None) -> str | None:
    """Map CLI-facing image rails to the gateway's allowlisted semantic IDs."""
    if model in (None, "default"):
        return None
    return {
        "nano-banana-2": "google/nano-banana-2",
        "google/nano-banana-2": "google/nano-banana-2",
        "gpt-image-2": "openai/gpt-image-2",
        "openai/gpt-image-2": "openai/gpt-image-2",
    }.get(model, "")


def _video_batch_calls(
    key: str,
    batch: str | Path,
    default_quality: str,
    *,
    has_shared_swap: bool,
    has_shared_prompt: bool,
    job: Path | None,
) -> tuple[list[tuple[float, str]], str] | None:
    """Return one duration/quality pair per gateway call in mint_video batch."""
    try:
        specs = json.loads(Path(batch).expanduser().read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(specs, list) or not specs:
        return None
    media = _batch_media(
        key,
        batch,
        has_shared_swap=has_shared_swap,
        has_shared_prompt=has_shared_prompt,
        job=job,
    )
    if media is None or len(media) != len(specs):
        return None
    calls: list[tuple[float, str]] = []
    source = "probed"
    for spec, item in zip(specs, media):
        if not isinstance(spec, dict) or item is None:
            return None
        seconds, _reason = _probe_billed(item)
        if seconds is None:
            return None
        if _clamp(key, seconds) != seconds:
            source = "probed_clamped"
        quality = spec.get("quality") or default_quality
        if not isinstance(quality, str):
            return None
        calls.append((float(seconds), quality))
    return calls, source


def _multishot_invoice(
    inline: str | None, file_path: str | Path | None
) -> tuple[float, object] | None:
    try:
        raw = Path(file_path).read_text() if file_path is not None else inline
        shots = json.loads(raw) if isinstance(raw, str) else raw
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(shots, list) or not shots or len(shots) > 6:
        return None
    total = 0.0
    for shot in shots:
        if (
            not isinstance(shot, dict)
            or "prompt" not in shot
            or "duration" not in shot
            or not isinstance(shot["duration"], (int, float))
            or isinstance(shot["duration"], bool)
            or not math.isfinite(float(shot["duration"]))
            or float(shot["duration"]) < 1
        ):
            return None
        total += float(shot["duration"])
    return total, shots


def quote(tool: str, role: str | None, count: int, *,
          planned_seconds: float | None = None,
          quality: str | None = None,
          resolution: str | None = None,
          aspect_ratio: str | None = None,
          media: str | Path | None = None,
          batch: str | Path | None = None,
          shared_swap: str | Path | None = None,
          has_shared_prompt: bool = False,
          job: str | None = None,
          multishot_file: str | Path | None = None,
          multishot: str | None = None,
          eye_check_method: str | None = None,
          skip_eye_check: bool = False,
          model: str | None = None,
          references: list | None = None) -> dict:
    """Gateway-first pre-submit quote in cost.py's stable JSON shape.

    Direct semantic generation tools must be priced by the gateway route; an
    unavailable quote is UNKNOWN, never silently replaced by the rough local
    table. Composite engine tools still use the existing conservative local
    estimate until the gateway exposes a composite semantic route for them.
    """
    canonical = tool.removesuffix(".py")
    quote_model = _quote_model(model) if canonical == "mint_image" else None
    if canonical == "mint_image" and quote_model == "":
        return {
            "tool": canonical, "role": role, "count": count,
            "unit_usd": None, "est_usd": None, "free": False,
            "unknown": True, "seconds_source": "unknown",
            "quote_source": "model-unpriced",
            "label": "mint_image model is not an allowlisted quote rail",
        }
    job_dir: Path | None = None
    if job:
        try:
            job_dir = resolve_job_dir(job)
            if media is not None and not str(media).startswith(("http://", "https://")):
                media = resolve_job_input_path(str(media), job_dir)
            if batch is not None:
                batch = resolve_job_input_path(str(batch), job_dir)
            if shared_swap is not None and not str(shared_swap).startswith(
                ("http://", "https://")
            ):
                shared_swap = resolve_job_input_path(str(shared_swap), job_dir)
            if multishot_file is not None:
                multishot_file = resolve_job_input_path(
                    str(multishot_file), job_dir
                )
        except (OSError, ValueError) as exc:
            return {
                "tool": canonical, "role": role, "count": count,
                "unit_usd": None, "est_usd": None, "free": False,
                "unknown": True, "seconds_source": "unknown",
                "quote_source": "job-input-unpriced",
                "label": f"job input could not be resolved: {str(exc)[:160]}",
            }
    if canonical not in _DIRECT_GATEWAY_QUOTE_TOOLS:
        local = estimate(
            canonical,
            role,
            count,
            media=media,
            batch=batch,
            shared_swap=shared_swap,
            has_shared_prompt=has_shared_prompt,
            job=job_dir,
        )
        local["quote_source"] = "engine-table"
        return local

    from _gateway import GatewayError, gateway

    if not gateway.enabled():
        # Direct generation prices are route-, duration-, quality- and
        # resolution-dependent. A local table is deliberately only a rough
        # planning estimate; presenting it as a quote caused 5–20× production
        # under-estimates. No gateway pricing authority means no quote.
        return {
            "tool": canonical, "role": role, "count": count,
            "unit_usd": None, "est_usd": None, "free": False,
            "unknown": True, "seconds_source": "unknown",
            "quote_source": "gateway-disabled",
            "label": "authoritative gateway quote unavailable",
        }

    input_snapshot = _quote_input_snapshot(
        canonical,
        role,
        media=media,
        batch=batch,
        shared_swap=shared_swap,
        job=job_dir,
        shared_references=references,
    )
    input_binding = input_snapshot.manifest if input_snapshot is not None else None
    priced_media = (
        input_snapshot.media
        if input_snapshot is not None and input_snapshot.media is not None
        else media
    )
    priced_batch = (
        input_snapshot.batch
        if input_snapshot is not None and input_snapshot.batch is not None
        else batch
    )
    priced_shared_swap = (
        input_snapshot.shared_swap
        if input_snapshot is not None and input_snapshot.shared_swap is not None
        else shared_swap
    )

    params: dict = {}
    image_batch_calls: list[tuple[str, int]] | None = None
    video_batch_calls: list[tuple[float, str]] | None = None
    genjutsu_resolution: str | None = None
    seconds_source = "gateway"
    quote_seconds = planned_seconds
    gateway_count = count
    if canonical == "mint_image":
        if batch is not None:
            image_batch_calls = _image_batch_calls(
                batch, quality or "high"
            )
            if image_batch_calls is None:
                return {
                    "tool": canonical, "role": role, "count": count,
                    "unit_usd": None, "est_usd": None, "free": False,
                    "unknown": True, "seconds_source": "unknown",
                    "quote_source": "gateway-input-unpriced",
                    "label": "mint_image batch could not be priced exactly",
                }
        elif count > 4:
            image_batch_calls = [
                (quality or "high", min(4, count - offset))
                for offset in range(0, count, 4)
            ]
        params = {
            "quality": quality or "high",
            "number_of_images": count,
        }
    elif canonical == "mint_video" and role == "genjutsu":
        # One gateway call per clip, each billed on whole seconds of ITS input
        # at the resolution execution sends (mint_video defaults to 720p).
        genjutsu_resolution = resolution or GENJUTSU_DEFAULT_RESOLUTION
        unpriced = {
            "tool": canonical, "role": role, "count": count,
            "unit_usd": None, "est_usd": None, "free": False,
            "unknown": True, "quote_source": "gateway-input-unpriced",
        }
        if genjutsu_resolution not in GENJUTSU_USD_PER_INPUT_SECOND:
            return {**unpriced, "seconds_source": "unknown",
                    "label": "genjutsu resolution must be 480p, 720p or 1080p"}
        if input_snapshot is None and (media is not None or batch is not None):
            return {**unpriced, "seconds_source": "unknown",
                    "label": "genjutsu inputs could not be bound for an exact quote"}
        if priced_batch is not None:
            items = _batch_media(
                GENJUTSU_KEY, priced_batch,
                has_shared_prompt=has_shared_prompt,
                has_shared_references=bool(
                    input_snapshot is not None and input_snapshot.shared_references),
                # Snapshot batch entries are absolute private paths.
                job=None,
            )
            probed = [(_probe_billed(item)[0] if item is not None else None)
                      for item in (items or [])]
            if not probed or any(value is None for value in probed):
                return {**unpriced, "seconds_source": "batch_partial",
                        "label": "mint_video genjutsu batch could not be priced exactly"}
            video_batch_calls = [(float(value), quality or "standard") for value in probed]
            seconds_source = ("probed_clamped" if any(
                _clamp(GENJUTSU_KEY, value) != value for value in probed) else "probed")
            quote_seconds = sum(value for value, _ in video_batch_calls)
        else:
            if priced_media is None:
                return {**unpriced, "seconds_source": "unknown",
                        "label": "genjutsu needs the local --video clip to quote"}
            if input_snapshot.shared_references is None:
                # A single run always sends 1..8 references and binds every
                # local one; a quote that never saw them cannot bind the run.
                return {**unpriced, "seconds_source": "unknown",
                        "label": "genjutsu needs its --reference images to quote"}
            value, reason = _probe_billed(priced_media)
            if value is None:
                return {**unpriced, "seconds_source": reason or "unknown",
                        "label": "the genjutsu source clip could not be probed"}
            # The exact probe execution sends, never a clamped stand-in: the
            # gateway re-measures the upload and bills whole seconds of it.
            quote_seconds = value
            seconds_source = ("probed_clamped" if _clamp(GENJUTSU_KEY, value) != value
                              else "probed")
        gateway_count = 1
        params["resolution"] = genjutsu_resolution
    elif canonical == "mint_video":
        if role in {"edit", "reenact"}:
            # These rails bill the media the executor probes, not a typed
            # duration. A batch launches one gateway call per item, so retain
            # each duration for per-request cent rounding.
            if priced_batch is not None:
                batch_result = _video_batch_calls(
                    f"{canonical}:{role}",
                    priced_batch,
                    quality or "standard",
                    has_shared_swap=priced_shared_swap is not None,
                    has_shared_prompt=has_shared_prompt,
                    # Snapshot batch entries are absolute private paths.
                    job=None,
                )
                if batch_result is None:
                    return {
                        "tool": canonical, "role": role, "count": count,
                        "unit_usd": None, "est_usd": None, "free": False,
                        "unknown": True, "seconds_source": "batch_partial",
                        "quote_source": "gateway-input-unpriced",
                        "label": "mint_video batch could not be priced exactly",
                    }
                video_batch_calls, seconds_source = batch_result
                quote_seconds = sum(seconds for seconds, _ in video_batch_calls)
            else:
                billed = estimate(
                    canonical, role, count, media=priced_media,
                    shared_swap=priced_shared_swap,
                    has_shared_prompt=has_shared_prompt, job=None,
                )
                if billed.get("unknown") or not isinstance(
                    billed.get("seconds"), (int, float)
                ):
                    billed["quote_source"] = "gateway-input-unpriced"
                    return billed
                seconds_source = str(billed.get("seconds_source") or "unknown")
                quote_seconds = float(billed["seconds"])
            # quote_seconds is already the aggregate invoice for this whole
            # invocation; never multiply it again if routing changes to a
            # model whose quote function also honors count.
            gateway_count = 1
        elif priced_batch is not None:
            # insert/keyframe/multishot batches (#273) fan out per item with
            # per-item overrides; never quote the CLI shape as the fleet price.
            return {
                "tool": canonical, "role": role, "count": count,
                "unit_usd": None, "est_usd": None, "free": False,
                "unknown": True, "seconds_source": "batch_partial",
                "quote_source": "gateway-input-unpriced",
                "label": f"mint_video {role} batch is priced per item at submission",
            }
        elif role == "multishot":
            invoice = _multishot_invoice(multishot, multishot_file)
            if invoice is None:
                return {
                    "tool": canonical, "role": role, "count": count,
                    "unit_usd": None, "est_usd": None, "free": False,
                    "unknown": True, "seconds_source": "unknown",
                    "quote_source": "gateway-input-unpriced",
                    "label": "multishot payload could not be priced exactly",
                }
            quote_seconds, shots = invoice
            seconds_source = "payload"
            gateway_count = 1
            params["multi_prompt"] = shots
        elif role in ("insert", "keyframe"):
            # These rails declare their length instead of probing one, and the
            # backend meters every second of it. Send exactly what the executor
            # will send: a planned duration through the mode's own clamps, and
            # the mode's CLI default when none was planned (#78). Quoting the
            # raw request would reserve a length the tool never submits.
            if quote_seconds is not None and (
                isinstance(quote_seconds, bool)
                or not isinstance(quote_seconds, (int, float))
                or not math.isfinite(float(quote_seconds))
                or float(quote_seconds) <= 0
            ):
                return {
                    "tool": canonical, "role": role, "count": count,
                    "unit_usd": None, "est_usd": None, "free": False,
                    "unknown": True, "seconds_source": "unknown",
                    "quote_source": "gateway-input-unpriced",
                    "label": "planned seconds must be a positive duration",
                }
            seconds_source = "default" if quote_seconds is None else "declared"
            quote_seconds = _clamp(
                f"{canonical}:{role}",
                mint_video_declared_seconds(
                    role, quote_seconds, quality or "standard"
                ),
            )
        if quote_seconds is not None:
            params["duration"] = quote_seconds
        if role in ("insert", "keyframe"):
            params["resolution"] = (
                "720p" if quality == "draft" else (resolution or "720p")
            )
            # Seedance 2.5 is billed by output tokens, so the frame geometry is
            # a pricing dimension: the gateway refuses to quote a premium call
            # without an explicit aspect ratio. Send mint_video's own default
            # when the caller planned none, exactly as the executor would.
            params["aspect_ratio"] = aspect_ratio or "9:16"

    try:
        if image_batch_calls is not None:
            amount = 0.0
            sources: set[str] = set()
            buffered = False
            for item_quality, image_count in image_batch_calls:
                item_response = gateway.quote(
                    canonical,
                    mode=role,
                    params={
                        "quality": item_quality,
                        "number_of_images": image_count,
                    },
                    quality=item_quality,
                    count=image_count,
                    model=quote_model,
                )
                item_amount = item_response.get("estimate_usd")
                if (
                    not isinstance(item_amount, (int, float))
                    or not math.isfinite(item_amount)
                    or item_amount < 0
                ):
                    raise GatewayError("gateway returned an invalid batch quote")
                amount += float(item_amount)
                sources.add(str(item_response.get("source") or "gateway"))
                buffered = buffered or bool(item_response.get("buffered"))
            response = {
                "source": (
                    next(iter(sources)) if len(sources) == 1 else "gateway-batch"
                ),
                "buffered": buffered,
            }
        elif video_batch_calls is not None:
            amount = 0.0
            sources = set()
            buffered = False
            for item_seconds, item_quality in video_batch_calls:
                item_response = gateway.quote(
                    canonical,
                    mode=role,
                    params=({"resolution": genjutsu_resolution}
                            if genjutsu_resolution is not None
                            else {"duration": item_seconds}),
                    quality=item_quality,
                    seconds=item_seconds,
                    count=1,
                )
                item_amount = item_response.get("estimate_usd")
                if (
                    not isinstance(item_amount, (int, float))
                    or not math.isfinite(item_amount)
                    or item_amount < 0
                ):
                    raise GatewayError("gateway returned an invalid batch quote")
                amount += float(item_amount)
                sources.add(str(item_response.get("source") or "gateway"))
                buffered = buffered or bool(item_response.get("buffered"))
            response = {
                "source": (
                    next(iter(sources)) if len(sources) == 1 else "gateway-batch"
                ),
                "buffered": buffered,
            }
        else:
            response = gateway.quote(
                canonical,
                mode=role,
                params=params,
                quality=quality,
                seconds=quote_seconds,
                count=gateway_count,
                model=quote_model,
            )
            amount = response.get("estimate_usd")
            if not isinstance(amount, (int, float)) or not math.isfinite(amount) or amount < 0:
                raise GatewayError("gateway returned an invalid quote")
        if genjutsu_resolution is not None:
            # One gateway call (or fleet of calls) per planned invocation; the
            # gateway priced one, so a planned count repeats it.
            amount = float(amount) * count
        if (
            canonical == "mint_video"
            and role == "reenact"
            and batch is None
            and eye_check_method == "gemini"
            and not skip_eye_check
        ):
            preflight = gateway.quote(
                "qa_video",
                mode="eye_check",
                params={},
                count=1,
            )
            preflight_amount = preflight.get("estimate_usd")
            if (
                not isinstance(preflight_amount, (int, float))
                or not math.isfinite(preflight_amount)
                or preflight_amount < 0
            ):
                raise GatewayError("gateway returned an invalid eye-check quote")
            amount += float(preflight_amount)
            response["source"] = "gateway-composite"
            response["buffered"] = (
                bool(response.get("buffered"))
                or bool(preflight.get("buffered"))
            )
    except Exception as exc:
        return {
            "tool": canonical,
            "role": role,
            "count": count,
            "unit_usd": None,
            "est_usd": None,
            "free": False,
            "unknown": True,
            "seconds_source": "unknown",
            "quote_source": "gateway-error",
            "label": f"gateway quote unavailable: {str(exc)[:160]}",
        }

    amount = round(float(amount), 2)
    return {
        "tool": canonical,
        "role": role,
        "count": count,
        "unit_usd": round(amount / count, 4),
        "est_usd": amount,
        "free": amount == 0,
        "unknown": False,
        "seconds_source": seconds_source,
        "quote_source": str(response.get("source") or "gateway"),
        "buffered": bool(response.get("buffered")),
        **({"input_binding": input_binding} if input_binding is not None else {}),
        **({"model": model or "default"} if canonical == "mint_image" else {}),
        **({"seconds": quote_seconds} if quote_seconds is not None else {}),
        **({"resolution": genjutsu_resolution} if genjutsu_resolution is not None else {}),
        "label": f"{canonical}[{role or '_default'}] gateway quote",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def billing_cli_contract() -> dict[str, object]:
    """Return the versioned paid-command metadata surface consumed by hosts.

    These values are deliberately explicit rather than inferred from argparse:
    an incompatible change to a command's accepted input or behavior must
    publish a new capability version before a host can rely on it.
    """
    return {
        "schema": BILLING_CLI_CONTRACT_SCHEMA,
        "commands": {
            "estimate": BILLING_CLI_ESTIMATE_CAPABILITY,
            "plan": BILLING_CLI_PLAN_CAPABILITY,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_est = sub.add_parser(
        "estimate",
        help="Optional rough cost estimate for planning; never authorization.",
    )
    p_est.add_argument("--tool", required=True,
                       help="Canonical tool (mint_image, mint_video, perform_avatar, ...).")
    p_est.add_argument("--role", default=None,
                       help="The --role/--mode you'll pass (keyframe, insert, portrait, ...).")
    p_est.add_argument("--count", type=int, default=1, help="How many units (default 1).")
    p_est.add_argument("--media", default=None,
                       help="The LOCAL file whose length the tool will bill "
                            "(mint_video edit → --video, reenact → --driver-video, "
                            "lipsync_footage → --audio). Probed with ffprobe, exactly "
                            "like the tool does — the media is the invoice, and the ONLY "
                            "way to quote the real length. A URL, a probe timeout, or an "
                            "otherwise unprobeable named path is UNKNOWN advisory "
                            "pricing, never a known assumed price.")
    p_est.add_argument("--batch", default=None,
                       help="mint_video --batch specs path: price every item in the "
                            "JSON list (each item's own clip is probed), not one unit.")
    p_est.add_argument("--shared-swap", default=None,
                       help="For a reenact --batch: the shared --swap-image PATH. Items "
                            "without a per-item swap_image are runnable only if this file "
                            "is USABLE (exists); a missing/URL swap → those items are "
                            "non-runnable → batch_partial (not priced on mere presence).")
    p_est.add_argument("--has-shared-prompt", action="store_true",
                       help="For an edit --batch: a shared --prompt is present, so items "
                            "without a per-item prompt are still runnable. Without it, "
                            "such items are non-runnable → batch_partial.")
    p_est.add_argument("--resolution", default=None,
                       help="mint_video genjutsu price tier (480p|720p|1080p). Without "
                            "it mint_video's own default (720p) is priced.")
    p_est.add_argument("--allow-short", action="store_true",
                       help="mint_video genjutsu: the run passes --allow-short, so a "
                            "sub-4s clip bills its real length (otherwise it is priced "
                            "as the 4s cut the tool will run).")
    p_est.add_argument("--reference", action="append", default=None,
                       help="For a genjutsu --batch: the shared --reference images "
                            "(repeatable). Items without their own `references` run "
                            "only if these are usable.")
    p_est.add_argument("--seconds", type=float, default=None,
                       help="The declared output length, for the rails that BILL one "
                            "(mint_video insert|keyframe|multishot, #78): those generate "
                            "from stills, so the flag is the invoice and is clamped here "
                            "exactly as the tool clamps it. IGNORED on probed rails "
                            "(mint_video edit|reenact, lipsync_footage) where the media is "
                            "the invoice (#74) — pass --media/--batch for those.")
    p_est.add_argument("--json", action="store_true", help="Emit JSON instead of a line.")

    p_quote = sub.add_parser(
        "quote",
        help="Gateway-authoritative pre-submit quote (no vendor work).",
    )
    p_quote.add_argument("--tool", required=True)
    p_quote.add_argument("--role", default=None)
    p_quote.add_argument("--count", type=int, default=1)
    p_quote.add_argument("--planned-seconds", type=float, default=None)
    p_quote.add_argument("--quality", default=None)
    p_quote.add_argument(
        "--model",
        choices=("default", "nano-banana-2", "gpt-image-2"),
        default="default",
        help="mint_image rail to bind into the authoritative quote",
    )
    p_quote.add_argument("--resolution", default=None)
    p_quote.add_argument("--aspect-ratio", default=None,
                         help="mint_video insert/keyframe frame geometry. A "
                              "pricing dimension on Seedance 2.5 (--quality "
                              "premium), which is billed by output tokens; "
                              "mint_video's own 9:16 default is sent when "
                              "omitted.")
    p_quote.add_argument(
        "--job",
        default=None,
        help="Job id/path used to resolve media and batch inputs exactly as execution does.",
    )
    p_quote.add_argument("--media", default=None)
    p_quote.add_argument("--multishot-file", default=None)
    p_quote.add_argument("--multishot", default=None)
    p_quote.add_argument("--eye-check-method", default=None)
    p_quote.add_argument("--skip-eye-check", action="store_true")
    p_quote.add_argument("--batch", default=None)
    p_quote.add_argument("--shared-swap", default=None)
    p_quote.add_argument("--has-shared-prompt", action="store_true")
    p_quote.add_argument("--reference", action="append", default=None,
                         help="genjutsu: the invocation's --reference images "
                              "(repeatable), bound into the quote's input manifest.")
    p_quote.add_argument("--json", action="store_true")

    p_rec = sub.add_parser("reconcile", help="Sum a job's logged estimate_usd.")
    add_job_arg(p_rec)
    p_rec.add_argument("--json", action="store_true", help="Emit JSON instead of a table.")

    p_contract = sub.add_parser(
        "contract",
        help="Describe the versioned paid-command capabilities of this engine.",
    )
    p_contract.add_argument(
        "--json",
        action="store_true",
        help="Emit the machine-readable capability contract.",
    )

    p_plan = sub.add_parser("plan", help="Emit one canonical fingerprint-bound billing plan.")
    p_plan.add_argument("--command", required=True, help="One literal paid-tool command.")
    p_plan.add_argument("--engine-root", default=None,
                        help="Trusted installed engine root, distinct from workspace cwd.")
    p_plan.add_argument("--json", action="store_true", help="Emit the structured JSON plan.")

    args = parser.parse_args()

    if args.cmd == "contract":
        contract = billing_cli_contract()
        if args.json:
            print(json.dumps(contract, sort_keys=True, separators=(",", ":")))
        else:
            commands = contract["commands"]
            assert isinstance(commands, dict)
            print(f"schema: {contract['schema']}")
            for command in sorted(commands):
                print(f"{command}: {commands[command]}")
        return 0

    if args.cmd == "plan":
        try:
            result = billing_plan(args.command, Path.cwd(), args.engine_root)
        except (OSError, ValueError) as exc:
            print(f"billing plan refused: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(result, indent=2 if args.json else None))
        return 0

    if args.cmd in {"estimate", "quote"}:
        # count is a positive-integer multiplier (mirrors estimate()'s own
        # fail-closed guard). Reject at the CLI too so a bad value never emits a
        # priced line. Exit 1 (a value error), NOT argparse's exit 2, so a
        # capability-probing caller can't mistake it for an unknown flag.
        if args.count < 1:
            print(f"--count must be a positive integer, got {args.count}", file=sys.stderr)
            return 1
        if args.cmd == "quote":
            r = quote(
                args.tool,
                args.role,
                args.count,
                planned_seconds=args.planned_seconds,
                quality=args.quality,
                resolution=args.resolution,
                aspect_ratio=args.aspect_ratio,
                media=args.media,
                batch=args.batch,
                shared_swap=args.shared_swap,
                has_shared_prompt=args.has_shared_prompt,
                job=args.job,
                multishot_file=args.multishot_file,
                multishot=args.multishot,
                eye_check_method=args.eye_check_method,
                skip_eye_check=args.skip_eye_check,
                model=args.model,
                references=args.reference,
            )
        else:
            r = estimate(args.tool, args.role, args.count, args.seconds,
                         media=args.media, batch=args.batch,
                         shared_swap=args.shared_swap,
                         has_shared_prompt=args.has_shared_prompt,
                         resolution=args.resolution,
                         shared_references=args.reference,
                         allow_short=args.allow_short)
        if args.json:
            print(json.dumps(r, indent=2))
        elif r["unknown"]:
            print(f"{args.tool} ×{r['count']} ≈ UNKNOWN — {r['label']} "
                  "(no fixed advisory figure is available for this execution shape).")
        elif r.get("assumed_seconds") is not None:
            print(f"{r['label']} ≈ ${r['est_usd']:.2f}  "
                  f"(assumes {r['assumed_seconds']:g}s/unit — pass --media "
                  f"{PER_SECOND_BILLED_MEDIA.get(r.get('key') or '', '<the billed file>')} "
                  "for the real length)")
        elif r.get("seconds") is not None:
            print(f"{r['label']} ≈ ${r['est_usd']:.2f}  ({r['seconds_source']} length)")
        else:
            print(f"{r['label']} ×{r['count']} ≈ ${r['est_usd']:.2f}  (unit ~${r['unit_usd']:.2f})")
        return 0

    if args.cmd == "reconcile":
        job = resolve_job_dir(args.job)
        r = reconcile(job)
        if args.json:
            print(json.dumps(r, indent=2))
            return 0
        print(f"Job:   {r['job']}")
        print(f"Spent (est): ${r['spent_est_usd']:.2f}   "
              f"(${r['logged_usd']:.2f} logged + ${r['imputed_usd']:.2f} imputed from the price table)")
        if r["by_tool"]:
            print("By tool:")
            for t, v in r["by_tool"].items():
                n = r["assets_by_tool"].get(t)
                blind = "  ⚠ cost-blind (logs no estimate — priced from table)" if t in r["cost_blind_tools"] else ""
                print(f"  {t:<20} ${v:.2f}" + (f"  ({n} asset(s))" if n else "") + blind)
        if r["failed_calls"]:
            extra = (f" — pre-fix ledgers had booked ${r['excluded_failed_usd']:.2f} on them"
                     if r["excluded_failed_usd"] else "")
            print(f"Failed calls (EXCLUDED from spend): {r['failed_calls']}{extra}")
            for t, n in r["failed_by_tool"].items():
                print(f"  {t:<20} ×{n}")
        if r["unresolved_accepted_calls"]:
            print(
                "WARNING: Accepted gateway calls with unresolved spend "
                f"(NOT INCLUDED in estimate): {r['unresolved_accepted_calls']}"
            )
            for t, n in r["unresolved_accepted_by_tool"].items():
                print(f"  {t:<20} ×{n}")
            for warning in r["reconciliation_warnings"]:
                print(f"  ⚠ {warning}")
        if r["deduped_rows"]:
            print(f"NOTE: ignored ${r['deduped_usd']:.2f} on {r['deduped_rows']} "
                  "produced-asset row(s), each matched 1:1 to an earlier "
                  "successful call row booking the same dollars (pre-#63 "
                  "double-logging).")
        if r["cost_blind_tools"]:
            print(f"NOTE: {', '.join(r['cost_blind_tools'])} produced assets but logged no "
                  "estimate_usd — their $ is imputed from cost.py's table (approximate). Route "
                  "them through replicate_safe with estimate_usd for exact figures.")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
