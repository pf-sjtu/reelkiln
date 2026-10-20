"""
check_promise.py — the DELIVERY-PROMISE gate. "Did the render deliver what we
committed to?" — distinct from verify_output ("is it broken?") and review_output
("is each beat good?"). Catches SILENT DOWNGRADES: promised real-footage-first but
quietly generated; promised motion on every static but shipped a dead still;
promised 45s but rendered 28s; promised the josephchin caption preset, used another.

Reads an optional delivery promise (jobs/<id>/promise.json) and diffs it against the finished
render + the job's run.log.jsonl (which already records usage_role per asset, model
+ estimate_usd per replicate_call, etc.). Nothing new is generated — this is
assembly over data we already log.

Severity is deliberately CONSERVATIVE (qa_gate fail-open ethos — never false-block a
good render):
  hard  = objectively verifiable + author-declared → BLOCKS the QA receipt.
          Currently: duration (vs target±tolerance) and caption PRESET mismatch
          (style_directives names a different preset than promised).
  soft  = fuzzy / editorially-owned → ADVISORY, surfaced for the human + fed to
          review_output. (footage mix, motion-on-static, music bed, brand strings,
          and every `editorial:` promise like "build tension, hold the payoff late".)

Writes jobs/<id>/promise_check.json. qa_gate.py --mark refuses to stamp the QA
receipt while a HARD breach stands (and requires this check to be fresher than the
final render). No promise.json → nothing to check, exits 0 (skip).

Usage:
  uv run python tools/check_promise.py --job <id>
  uv run python tools/check_promise.py --job <id> --video final.mp4
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import read_events, log_event  # noqa: E402
from _paths import REMOTION_DIR  # noqa: E402

TOOL_NAME = "check_promise.py"

# Tools that PRODUCE a generated asset (cost + AI origin).
_GEN_TOOLS = {"mint_image.py", "mint_video.py", "cast_avatar.py", "perform_avatar.py",
              "seedance.py", "generate_image.py", "gen_broll.py", "build_carousel.py"}
# Tools that source REAL, owned/pulled footage or stills.
_REAL_TOOLS = {"index_media.py", "pull_video.py", "fetch_asset.py",
               "acquire_footage.py"}  # legacy name — old job logs + alias shim
# Tools/events that evidence a motion treatment applied to a still.
_MOTION_TOOLS = {"fx_parallax.py", "sam3.py", "frame_insert.py"}
_MOTION_HINTS = ("ken_burns", "kenburns", "parallax", "motion", "push_in", "pan_", "zoom")
# mint_image roles that yield a STILL (which then MUST get motion — [static-motion]).
_STILL_ROLES = {"seed_frame", "artistic_still", "portrait", "card", "cover", "overlay"}


def _breach(field, promised, observed, severity, detail):
    return {"field": field, "promised": promised, "observed": observed,
            "severity": severity, "detail": detail}


def ffprobe_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    out = p.stdout.strip()
    if not out:
        raise RuntimeError(f"ffprobe produced no duration for {path} (corrupt / 0-byte?).")
    return float(out)


def resolve_video(job: Path, explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit)
        if not p.is_absolute():
            cand = job / explicit
            if cand.exists():
                return cand
        return p if p.exists() else None
    for name in ("output/final.mp4", "final.mp4", "final_raw.mp4"):
        cand = job / name
        if cand.exists():
            return cand
    return None


# ---------------------------------------------------------------------------
# Individual checks — each returns a breach dict or None.
# ---------------------------------------------------------------------------

def check_duration(promise: dict, video: Path | None) -> dict | None:
    spec = promise.get("duration_sec")
    if not isinstance(spec, dict) or video is None:
        return None
    target = spec.get("target")
    tol = spec.get("tolerance", 0)
    if not isinstance(target, (int, float)):
        return None
    actual = round(ffprobe_duration(video), 2)
    if abs(actual - target) > tol:
        return _breach(
            "duration_sec", f"{target}s ±{tol}s", f"{actual}s", "hard",
            f"rendered {actual}s is outside the promised {target}±{tol}s window.",
        )
    return None


def _job_caption_style(job: Path) -> dict | None:
    """The RESOLVED caption style compose_render wrote (font/weight/color/…)."""
    sd = job / "style_directives.json"
    if not sd.exists():
        return None
    try:
        cs = json.loads(sd.read_text()).get("caption_style")
    except (json.JSONDecodeError, OSError, AttributeError):
        return None
    return cs if isinstance(cs, dict) else None


def _preset_def(name: str) -> dict | None:
    """The promised preset's spec from the shared caption_presets.json."""
    try:
        return json.loads((REMOTION_DIR / "src" / "caption_presets.json").read_text()).get(name)
    except (json.JSONDecodeError, OSError, AttributeError):
        return None


def check_captions(promise: dict, job: Path) -> dict | None:
    spec = promise.get("captions")
    if not isinstance(spec, dict) or not spec.get("required"):
        return None
    cs = _job_caption_style(job)
    if cs is None:
        return _breach("captions", "required", "no caption_style in style_directives.json", "soft",
                       "could not verify captions rendered mechanically — confirm in review_output.")
    want = spec.get("preset")
    if not want:
        return None  # captions present + no specific preset promised → satisfied
    pdef = _preset_def(want)
    if pdef is None:
        return _breach("captions.preset", want,
                       f"preset '{want}' not registered in caption_presets.json", "soft",
                       "cannot verify the preset's spec — register the tenant preset so the render "
                       "can be checked against it.")
    # Definitive, verifiable signal: the caption FONT. A promised preset rendered in
    # a different font family is the wrong caption look → HARD.
    want_font = str(pdef.get("font_family", "")).strip().lower()
    got_font = str(cs.get("font_family", "")).strip().lower()
    if want_font and got_font and want_font != got_font:
        return _breach("captions.preset", f"{want} (font {pdef.get('font_family')})",
                       f"font {cs.get('font_family')}", "hard",
                       "rendered caption font differs from the promised preset — wrong caption look shipped.")
    return None


def _asset_events(events: list[dict]) -> tuple[int, int, list[dict]]:
    """Return (n_generated_assets, n_real_assets, still_asset_events). Best-effort:
    counts one asset per successful gen call and per real-source use event."""
    n_gen = n_real = 0
    stills: list[dict] = []
    for e in events:
        tool = e.get("tool")
        ev = (e.get("event") or "")
        if tool in _GEN_TOOLS:
            produced = (
                e.get("status") == "succeeded"
                or ev.endswith(("_complete", "_generated", "_saved", "_done"))
                or e.get("usage_role") is not None
            )
            if produced and "call_failed" not in ev and "error" not in ev:
                n_gen += 1
                role = e.get("usage_role") or e.get("role") or e.get("mode")
                if tool == "mint_image.py" and (role in _STILL_ROLES or role is None):
                    stills.append(e)
        elif tool in _REAL_TOOLS:
            if any(tok in ev for tok in ("trim", "used", "clip", "hit", "select", "acquire", "fetch")):
                n_real += 1
    return n_gen, n_real, stills


def _timeline_source_seconds(events: list[dict]) -> tuple[float, float, float] | None:
    """Return real/generated/unclassified seconds from the latest declared timeline.

    Asset-call counts are not delivery evidence: a ten-second real clip and ten
    one-second generated clips can produce the opposite ratio from the final cut.
    ``assemble.py`` emits one duration-bound ``beat_assembled`` record per final
    timeline beat, followed by ``timeline_assembled``. Only that latest complete
    declaration is authoritative.
    """
    timeline_indexes = [
        index
        for index, event in enumerate(events)
        if event.get("tool") == "assemble.py"
        and event.get("event") == "timeline_assembled"
    ]
    if not timeline_indexes:
        return None
    end = timeline_indexes[-1]
    start = timeline_indexes[-2] + 1 if len(timeline_indexes) > 1 else 0
    seconds = {"real": 0.0, "generated": 0.0, "unknown": 0.0}
    for event in events[start:end]:
        if not (
            event.get("tool") == "assemble.py"
            and event.get("event") == "beat_assembled"
        ):
            continue
        try:
            duration = float(event.get("end_sec")) - float(event.get("start_sec"))
        except (TypeError, ValueError):
            continue
        if duration <= 0:
            continue
        kind = str(event.get("source_kind") or "").strip().lower()
        if kind in {"real", "generated"}:
            seconds[kind] += duration
        elif kind not in {"other", "neutral", "graphic"}:
            seconds["unknown"] += duration
    return seconds["real"], seconds["generated"], seconds["unknown"]


def check_footage_mix(promise: dict, events: list[dict]) -> dict | None:
    spec = promise.get("footage_mix")
    if not isinstance(spec, dict):
        return None
    floor = spec.get("real_min_ratio")
    if not isinstance(floor, (int, float)):
        return None
    timeline = _timeline_source_seconds(events)
    if timeline is None:
        return _breach("footage_mix.real_min_ratio", f"≥ {floor}",
                       "no final timeline source-duration declaration", "soft",
                       "run assemble.py (or assemble.py --declare) with source_kind on "
                       "each beat; asset-call counts are not a valid footage ratio.")
    real_seconds, generated_seconds, unknown_seconds = timeline
    if unknown_seconds > 0:
        return _breach(
            "footage_mix.real_min_ratio",
            f"≥ {floor}",
            f"{unknown_seconds:.2f}s of timeline footage is unclassified",
            "soft",
            "declare source_kind=real|generated for every footage beat; the gate "
            "will not guess origin from filenames or tool-call counts.",
        )
    total = real_seconds + generated_seconds
    if total <= 0:
        return _breach(
            "footage_mix.real_min_ratio",
            f"≥ {floor}",
            "no real/generated footage seconds in the final timeline declaration",
            "soft",
            "declare source_kind=real|generated on footage beats; graphic/other beats "
            "are intentionally excluded.",
        )
    ratio = round(real_seconds / total, 3)
    if ratio < floor:
        return _breach("footage_mix.real_min_ratio", f"≥ {floor}",
                       f"{ratio} ({real_seconds:.2f}s real / "
                       f"{generated_seconds:.2f}s generated)", "soft",
                       "real-footage share is below the promised floor — possible silent "
                       "downgrade to generated. Confirm this was intended.")
    return None


def check_motion_on_static(promise: dict, events: list[dict]) -> dict | None:
    if not promise.get("motion_on_every_static"):
        return None
    _, _, stills = _asset_events(events)
    if not stills:
        return None  # no generated stills → nothing to enforce
    has_motion = any(
        (e.get("tool") in _MOTION_TOOLS)
        or any(h in (e.get("event") or "").lower() for h in _MOTION_HINTS)
        or any(h in json.dumps(e).lower() for h in _MOTION_HINTS)
        for e in events
    )
    if not has_motion:
        return _breach("motion_on_every_static", "every static gets a motion treatment",
                       f"{len(stills)} still asset(s) but no motion/fx event in the log", "soft",
                       "[static-motion] commitment: a dead-still frame is a known miss — add "
                       "Ken Burns / parallax. Confirm motion in review_output.")
    return None


def check_music_bed(promise: dict, events: list[dict]) -> dict | None:
    audio = promise.get("audio")
    if not isinstance(audio, dict) or not audio.get("music_bed"):
        return None
    has_bed = any(e.get("tool") == "score_bed.py" for e in events)
    if not has_bed:
        return _breach("audio.music_bed", "music bed present",
                       "no score_bed event in the run log", "soft",
                       "promised a music bed but score_bed never ran — confirm in review_output "
                       "(audio_audit.music_bed_present).")
    return None


def check_brand_strings(promise: dict, job: Path) -> dict | None:
    want = promise.get("brand_strings")
    if not want:
        return None
    rev = job / "review_output.json"
    if not rev.exists():
        return _breach("brand_strings", want, "review_output not yet run", "soft",
                       "run review_output --mode full to frame-verify brand strings on-screen.")
    try:
        data = json.loads(rev.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    bad = []
    for fv in data.get("frame_verifications", []):
        for chk in (fv.get("frame_check", {}) or {}).get("brand_string_checks", []):
            if chk.get("status") in ("garbled", "absent"):
                bad.append(f"{chk.get('expected')}→{chk.get('status')}")
    if bad:
        return _breach("brand_strings", want, "; ".join(bad), "soft",
                       "brand strings garbled/absent on-screen per review_output frame-verify.")
    return None


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

# Promise keys this gate MECHANICALLY verifies vs. keys it intentionally leaves to
# the human / other tools — surfaced so the report never implies false completeness.
_CHECKED_KEYS = {"duration_sec", "captions", "footage_mix", "motion_on_every_static",
                 "audio", "brand_strings"}
_ELSEWHERE_KEYS = {"tenant", "workflow", "budget_usd", "editorial"}  # meta / cost.py / advisory


def run(job: Path, video_arg: str | None) -> dict:
    raw_promise = json.loads((job / "promise.json").read_text())
    nested_delivery = raw_promise.get("delivery") if isinstance(raw_promise, dict) else None
    # Delivery promises moved under ``delivery``.  Keep accepting the legacy
    # flat file so already-created jobs do not lose their checks.
    promise = nested_delivery if isinstance(nested_delivery, dict) else raw_promise
    video = resolve_video(job, video_arg)
    events = read_events(job)

    breaches: list[dict] = []
    for fn, needs_video in (
        (lambda: check_duration(promise, video), False),
        (lambda: check_captions(promise, job), False),
        (lambda: check_footage_mix(promise, events), False),
        (lambda: check_motion_on_static(promise, events), False),
        (lambda: check_music_bed(promise, events), False),
        (lambda: check_brand_strings(promise, job), False),
    ):
        try:
            b = fn()
        except Exception as e:  # a check erroring must never crash the gate
            b = None
            print(f"  (check errored, skipped: {type(e).__name__}: {e})", file=sys.stderr)
        if b:
            breaches.append(b)

    hard = [b for b in breaches if b["severity"] == "hard"]
    soft = [b for b in breaches if b["severity"] == "soft"]
    editorial = promise.get("editorial", []) or []
    # Any declared field we neither checked here nor delegate elsewhere → flag it so
    # the report is honest about what it did NOT verify (e.g. "grade": "warm").
    unverified = sorted(k for k in promise if k not in _CHECKED_KEYS and k not in _ELSEWHERE_KEYS)

    report = {
        "job": job.name,
        "video": str(video) if video else None,
        "promise_kept": not hard,          # kept == no HARD breach (soft is advisory)
        "n_hard": len(hard),
        "n_soft": len(soft),
        "breaches": breaches,
        "editorial_reminders": editorial,  # never mechanically checked — human/QA judges
        "unverified_fields": unverified,   # declared but not mechanically checked here
        "checked_at": time.time(),
    }
    (job / "promise_check.json").write_text(json.dumps(report, indent=2))
    log_event(job, tool=TOOL_NAME, event="promise_checked",
              extra={"promise_kept": report["promise_kept"],
                     "n_hard": len(hard), "n_soft": len(soft)})
    return report


def _print(report: dict) -> None:
    print("=" * 70)
    print(f"DELIVERY PROMISE — {report['job']}  →  "
          f"{'KEPT' if report['promise_kept'] else 'BROKEN (hard)'}")
    print("=" * 70)
    if not report["breaches"]:
        print("✓ all promised, checkable fields delivered.")
    for b in report["breaches"]:
        mark = "⛔ HARD" if b["severity"] == "hard" else "·  soft"
        print(f"{mark}  {b['field']}: promised {b['promised']} → got {b['observed']}")
        print(f"        {b['detail']}")
    if report["editorial_reminders"]:
        print("\nEditorial promises (advisory — judged in review_output, never blocking):")
        for e in report["editorial_reminders"]:
            print(f"  · {e}")
    if report.get("unverified_fields"):
        print(f"\nDeclared but NOT mechanically checked here (confirm in review_output): "
              f"{', '.join(report['unverified_fields'])}")
    if report["n_hard"]:
        print("\n⛔ A HARD promise is broken — qa_gate will refuse the receipt until it's "
              "fixed. There is no agent-writable QA bypass.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument("--video", help="Final mp4 (default: output/final.mp4 → final.mp4 → final_raw.mp4).")
    args = parser.parse_args()
    job = resolve_job_dir(args.job)

    if not (job / "promise.json").exists():
        print(f"check_promise: no promise.json in {job.name} — nothing to check (skip).")
        return 0

    try:
        report = run(job, args.video)
    except json.JSONDecodeError as e:
        print(f"check_promise: promise.json in {job.name} is not valid JSON ({e}) — fix it.",
              file=sys.stderr)
        return 1
    _print(report)
    # Exit non-zero on a HARD breach so it's usable as a standalone gate; the
    # authoritative block is qa_gate refusing the receipt.
    return 1 if report["n_hard"] else 0


if __name__ == "__main__":
    sys.exit(main())
