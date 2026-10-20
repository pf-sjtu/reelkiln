"""
Step 7b: Render the final captioned video using the shared Remotion project.

  uv run python tools/remotion_render.py            # uses .current_job
  uv run python tools/remotion_render.py --job <id>

Reads:  <job_dir>/final_raw.mp4
        <job_dir>/transcript.json   (word-level timestamps from elevenlabs.py)
        <job_dir>/script.json       (chunks + post_production_notes)
Writes: <job_dir>/final.mp4

Architecture
------------
The Remotion project at `remotion/` is SHARED across all jobs. Nothing
job-specific lives inside it. Every render gets a fresh copy of the inputs
via `--props` JSON and writes to the job's own output dir. Asset generation can
run concurrently, while the final Remotion step is serialized because its
stable TypeScript import points at one mutable per-job overlay copy.

How job assets are reached from inside Remotion
-----------------------------------------------
Chromium blocks `file://` fetches inside the render context, so we don't pass
absolute paths. Instead, this tool symlinks the entire job dir into
`remotion/public/_jobs/<job-id>/`. The Remotion code then resolves
paths via `staticFile("_jobs/<job-id>/<file>")`, which works in both Studio
and CLI render. Symlinks are cheap, idempotent, and safe under concurrency
(each job has its own subdirectory).

Per-job overlays
----------------
Hook / URL / lower-third overlays come from two places:
  1. Manual annotations inside `chunks[*].post_production_notes` like
        HOOK: "TEXT GOES HERE"
        URL: maven.com/foo
        LOWER: "Bob Moesta — pioneer of JTBD"
  2. Sensible auto-defaults derived from the script (first-sentence hook on
     chunk 0, URL pill on the last 5s, Bob-Moesta-style citation when his
     name appears in dialogue).
Both sources are merged into the `overlays` prop.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

from job import resolve_job_dir, add_job_arg
from job_inputs import (
    VALID_CAPTION_TRANSFORMS,
    default_video_canvas,
    explicit_video_canvas,
    parse_manual_overlays,
    resolve_audio_bed_volume_db,
)
from log import log_event
from remotion_lock import exclusive_remotion_render
from _render_completion import publish_deliverable, staging_path
from _serious_findings import caption_facts

load_dotenv()

# Resolve the shared Remotion project relative to this file (so it works no
# matter where the user invokes the tool from).
REMOTION_DIR = (Path(__file__).resolve().parent.parent / "remotion").resolve()
PUBLIC_DIR = REMOTION_DIR / "public"
JOBS_DIR_NAME = "_jobs"
ENTRY = "src/index.ts"
COMPOSITION_ID = "Captioned"

# Where the per-job overlays.tsx is symlinked into the Remotion src tree so
# Captioned.tsx can import from a stable path. See skills/overlay_authoring_guide.md §0.
JOB_OVERLAYS_SYMLINK = REMOTION_DIR / "src" / "_currentJobOverlays.tsx"
JOB_OVERLAYS_STUB_CONTENT = '''import type { JobOverlaysProps } from "./_jobOverlaysContract";
export const JobOverlays: React.FC<JobOverlaysProps> = () => null;
export default JobOverlays;
'''


def link_job_overlays(job_dir: Path) -> bool:
    """Copy <job_dir>/overlays.tsx → src/_currentJobOverlays.tsx.

    NB: a symlink would seem more elegant, but webpack resolves module
    lookups from the file's actual on-disk location, so a symlink to a file
    in the job dir would search for node_modules under <job_dir> and fail.
    We copy the file into src/ instead. preview.py watches the source and
    re-copies on change for hot-reload.

    Returns True if a per-job overlays file is wired up, False if the job has
    none and the stub is in place. Idempotent — safe to call repeatedly.
    """
    job_overlays = job_dir / "overlays.tsx"

    # Always remove whatever's there so we start clean.
    if JOB_OVERLAYS_SYMLINK.is_symlink() or JOB_OVERLAYS_SYMLINK.exists():
        JOB_OVERLAYS_SYMLINK.unlink()

    if job_overlays.exists():
        import shutil
        shutil.copy2(job_overlays, JOB_OVERLAYS_SYMLINK)
        return True

    # No per-job overlays — restore the stub so the project still builds.
    JOB_OVERLAYS_SYMLINK.write_text(JOB_OVERLAYS_STUB_CONTENT)
    return False


def ensure_remotion_installed() -> None:
    if not (REMOTION_DIR / "node_modules").exists():
        raise RuntimeError(
            f"{REMOTION_DIR}/node_modules is missing. "
            f"Run `cd {REMOTION_DIR} && npm install` once on this machine."
        )


def link_job_into_public(job_dir: Path) -> str:
    """Symlink the job directory into remotion/public/_jobs/<job-id>/.

    Returns the path FRAGMENT to use inside Remotion (relative to public/),
    e.g. "_jobs/maven.com-20260429-y2j59e".
    """
    job_id = job_dir.name
    target = PUBLIC_DIR / JOBS_DIR_NAME / job_id
    target.parent.mkdir(parents=True, exist_ok=True)

    # Idempotent: replace stale symlinks, leave good ones alone.
    if target.is_symlink() or target.exists():
        if target.is_symlink() and target.resolve() == job_dir.resolve():
            pass  # already correct
        else:
            target.unlink()
            target.symlink_to(job_dir.resolve())
    else:
        target.symlink_to(job_dir.resolve())

    return f"{JOBS_DIR_NAME}/{job_id}"


# ---------------------------------------------------------------------------
# Overlay extraction from script.json
# ---------------------------------------------------------------------------

URL_RE = re.compile(r"https?://[^\s\"'<>]+|\b[\w-]+\.(?:com|io|app|co|me|ai|dev|so|xyz)[\w/?&=-]*")


def _find_url(s: str) -> str | None:
    m = URL_RE.search(s or "")
    return m.group(0) if m else None


def auto_overlays(script: dict, company: dict | None) -> list[dict]:
    """Sensible defaults so a script with no markers still gets nice overlays."""
    overlays = []
    chunks = script.get("chunks", [])
    if not chunks:
        return overlays

    # Hook on chunk 0 — first sentence (or 60 chars), ALL CAPS, brief
    first = chunks[0]
    first_dialogue = (first.get("dialogue") or "").strip()
    if first_dialogue:
        m = re.match(r"([^.!?]{8,80}[.!?])", first_dialogue)
        hook_text = (m.group(1) if m else first_dialogue[:60]).strip().upper()
        s = float(first["start_sec"])
        e = float(first["end_sec"])
        overlays.append({
            "kind": "hook",
            "text": hook_text,
            "start": s + 0.4,
            "end": min(e, s + 4.0),
        })

    # URL pill on last chunk
    last = chunks[-1]
    url = (
        _find_url(last.get("post_production_notes") or "")
        or _find_url(last.get("dialogue") or "")
        or _find_url((company or {}).get("website") or "")
        or _find_url((company or {}).get("url") or "")
    )
    if url:
        # Strip protocol for display
        url_display = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
        s = max(float(last["start_sec"]), float(last["end_sec"]) - 5.0)
        overlays.append({
            "kind": "url",
            "text": url_display,
            "start": s,
            "end": float(last["end_sec"]),
        })

    # Citation lower-third for known authority names
    for c in chunks:
        d = (c.get("dialogue") or "")
        if re.search(r"\bBob Moesta\b", d, flags=re.IGNORECASE):
            s = float(c["start_sec"]) + 0.5
            overlays.append({
                "kind": "lower",
                "text": "Bob Moesta — pioneer of Jobs-to-be-Done",
                "start": s,
                "end": min(float(c["end_sec"]), s + 3.0),
            })
            break

    return overlays


def merge_overlays(manual: list[dict], auto: list[dict]) -> list[dict]:
    """Manual overlays win over auto ones of the same kind in the same chunk."""
    if not manual:
        return auto
    out = list(manual)
    manual_kinds = {o["kind"] for o in manual}
    for o in auto:
        if o["kind"] in manual_kinds and o["kind"] in {"hook", "url"}:
            # auto hook/url are global per-script — skip if any manual one exists
            continue
        out.append(o)
    return out


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------


def _strip_md_fence(raw: str) -> str:
    raw = raw.strip()
    if not raw.startswith("```"):
        return raw
    body = raw.split("```", 2)
    if len(body) < 2:
        return raw
    stripped = body[1]
    if stripped.startswith("json\n"):
        stripped = stripped[5:]
    return stripped


def _coerce_directives(d: dict) -> dict:
    """Forgive variant field names Gemini sometimes invents.

    Maps the known divergent keys back to the schema in
    skills/gemini_prompts/replication_brief.md. Defensive — frontmatter
    + injected schema should make this rarely needed, but we don't want a
    single field name to break a render.
    """
    if not isinstance(d, dict):
        return d

    # caption_style — Gemini sometimes puts the keys at the top level, OR
    # under "captions" / "caption" instead of caption_style, OR uses different
    # names (font_weight vs weight, stroke vs outline_color, etc.)
    cs = d.get("caption_style") or d.get("captions") or d.get("caption")
    if cs is None:
        keys_at_top = {
            k for k in (
                "font", "font_family", "font_weight", "weight", "color", "stroke",
                "stroke_width_px", "outline_color", "outline_width_px",
                "highlight_color", "active_word_color", "background",
                "position", "position_y", "page_size_words", "switch_ms",
                "transform", "text_align",
            ) if k in d
        }
        if keys_at_top:
            cs = {k: d[k] for k in keys_at_top}
    if isinstance(cs, dict):
        cs = dict(cs)
        # Variant → canonical mappings
        if "font" in cs and "font_family" not in cs:
            cs["font_family"] = cs.pop("font")
        if "font_weight" in cs and "weight" not in cs:
            cs["weight"] = cs.pop("font_weight")
        if "stroke" in cs and "outline_color" not in cs:
            cs["outline_color"] = cs.pop("stroke")
        if "stroke_width_px" in cs and "outline_width_px" not in cs:
            cs["outline_width_px"] = cs.pop("stroke_width_px")
        if "highlight_color" in cs and "active_word_color" not in cs:
            cs["active_word_color"] = cs.pop("highlight_color")
        if "position_y" in cs and "position" not in cs:
            cs["position"] = cs.pop("position_y")
        if cs.get("position") in {"middle"}:
            cs["position"] = "center"
        if cs.get("position") in {"bottom-third", "lower_third"}:
            cs["position"] = "lower-third"
        if cs.get("transform") not in (None, *VALID_CAPTION_TRANSFORMS):
            cs["transform"] = "none"
        d = {**d, "caption_style": cs}

    # cut_points: detect ms (anything > video duration would be ms) and convert
    cuts = d.get("cut_points")
    if isinstance(cuts, list) and cuts and max(cuts) > 60:
        d = {**d, "cut_points": [round(c / 1000.0, 3) for c in cuts]}

    # overlays.hook (Gemini variant) → top-level hook
    overlays = d.get("overlays")
    if isinstance(overlays, dict):
        flat = {}
        if overlays.get("hook") and overlays["hook"].get("text"):
            h = overlays["hook"]
            flat["hook"] = {
                "text": h["text"],
                "start_sec": (h.get("start_ms", 0) or 0) / 1000.0,
                "end_sec": ((h.get("start_ms", 0) or 0) + (h.get("duration_ms", 0) or 0)) / 1000.0,
            }
        if overlays.get("url") or overlays.get("url_pill"):
            u = overlays.get("url") or overlays.get("url_pill")
            if u and u.get("text"):
                flat["url_pill"] = {
                    "text": u["text"],
                    "start_sec": float(u.get("start_sec", 0)),
                    "end_sec": float(u.get("end_sec", 0)),
                }
        d = {**d, **{k: v for k, v in flat.items() if k not in d}}

    # audio_instructions → music
    if "audio_instructions" in d and "music" not in d:
        ai = d["audio_instructions"] or {}
        d = {**d, "music": {
            "use_reference_bed": (ai.get("bgm_style") or "").lower() not in ("none", "", "no music"),
            "notes": ai.get("bgm_style", ""),
        }}

    return d


def load_style_directives(job_dir: Path) -> dict | None:
    """Load <job_dir>/style_directives.json if present (produced by gemini_video.py
    --mode replication_brief). Returns the parsed object or None.
    """
    path = job_dir / "style_directives.json"
    if not path.exists():
        return None
    raw = _strip_md_fence(path.read_text())
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[remotion_render] WARN: style_directives.json present but invalid JSON: {e}")
        return None
    return _coerce_directives(parsed)


def overlays_from_directives(directives: dict) -> list[dict]:
    """Translate the structured replication_brief overlays into renderer overlays."""
    out: list[dict] = []
    hook = directives.get("hook")
    if hook and hook.get("text"):
        out.append({
            "kind": "hook",
            "text": str(hook["text"]).upper(),
            "start": float(hook.get("start_sec", 0.5)),
            "end": float(hook.get("end_sec", 4.0)),
        })
    for lt in directives.get("lower_thirds") or []:
        if lt.get("text"):
            out.append({
                "kind": "lower",
                "text": str(lt["text"]),
                "start": float(lt.get("start_sec", 0)),
                "end": float(lt.get("end_sec", 0)),
            })
    pill = directives.get("url_pill")
    if pill and pill.get("text"):
        out.append({
            "kind": "url",
            "text": str(pill["text"]),
            "start": float(pill.get("start_sec", 0)),
            "end": float(pill.get("end_sec", 0)),
        })
    return out


def build_props(job_dir: Path, public_relative: str, script: dict, company: dict | None) -> dict:
    """Construct the input-props blob handed to the Remotion render."""
    # PREFER the actual final_raw.mp4 duration over script.json's claim.
    # script.json's total_duration_seconds is pre-densify; densify clips ~30%
    # of the runtime. Using the script value would over-schedule the
    # composition, leaving dead held frames + miscued overlays at the end.
    duration = 0.0
    final_raw = job_dir / "final_raw.mp4"
    if final_raw.exists():
        try:
            res = subprocess.run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(final_raw),
            ], capture_output=True, text=True, check=True)
            duration = float(res.stdout.strip())
        except (subprocess.CalledProcessError, ValueError):
            pass
    if duration <= 0:
        # Fall back to script.json (pre-densify)
        duration = float(script.get("total_duration_seconds") or 0)
    if duration <= 0:
        chunks = script.get("chunks") or []
        if chunks:
            duration = max(float(c.get("end_sec", 0)) for c in chunks)
    if duration <= 0:
        raise ValueError("Could not determine total duration from final_raw.mp4 or script.json")

    directives = load_style_directives(job_dir)
    width, height = explicit_video_canvas(directives) or default_video_canvas(job_dir, directives)

    if directives:
        # Style directives provide CRAFT defaults (caption style, hook timing
        # window, lower-third positioning) — those WIN. But the TEXT CONTENT
        # of overlays from directives describes the REFERENCE outlier, not
        # our adapted script. Manual annotations in post_production_notes
        # always win for hook/url/lower TEXT content.
        manual = parse_manual_overlays(script)
        manual_kinds = {o["kind"] for o in manual}
        directive_overlays = overlays_from_directives(directives)
        # Keep directive overlays only for kinds the manual notes didn't cover
        overlays = list(manual)
        for d in directive_overlays:
            if d["kind"] not in manual_kinds:
                overlays.append(d)
        # Auto-fill any missing hook/url from script defaults
        if "hook" not in {o["kind"] for o in overlays} or "url" not in {o["kind"] for o in overlays}:
            existing = {o["kind"] for o in overlays}
            for a in auto_overlays(script, company):
                if a["kind"] not in existing:
                    overlays.append(a)
    else:
        # No directives — fall back to manual + auto heuristics.
        overlays = merge_overlays(parse_manual_overlays(script), auto_overlays(script, company))

    props = {
        "videoPath": f"{public_relative}/final_raw.mp4",
        "captionsPath": f"{public_relative}/transcript.json",
        "jobPublicPath": public_relative,
        "durationSeconds": duration,
        "width": width,
        "height": height,
        "fps": 30,
        "overlays": overlays,
        "showCaptions": True,
    }
    if directives:
        if "caption_style" in directives:
            props["captionStyle"] = directives["caption_style"]
        if "cut_points" in directives:
            props["cutPoints"] = directives["cut_points"]
        if "video_transform" in directives:
            props["videoTransform"] = directives["video_transform"]

    # Inject preflight-sampled background luminance into captionStyle so the
    # renderer can auto-flip outline color when one wasn't explicitly set.
    # See preflight.measure_caption_luminance + CaptionPage.tsx.
    lum_path = job_dir / "caption_luminance.json"
    if lum_path.exists():
        try:
            lum = json.loads(lum_path.read_text())
            avg = lum.get("luminance_avg")
            if isinstance(avg, (int, float)):
                cs = props.get("captionStyle") or {}
                cs.setdefault("background_luminance", float(avg))
                props["captionStyle"] = cs
        except (json.JSONDecodeError, ValueError):
            pass

    # Audio bed (optional) — path relative to public/, like the video.
    bed_path = job_dir / "audio" / "bed.wav"
    if bed_path.exists():
        props["audioBedPath"] = f"{public_relative}/audio/bed.wav"
        # One steady level (videoclaw#321): an explicit per-job level, else
        # matched 12 dB under the voice, else -22 dB. Shared with compose_render.
        props["audioBedVolumeDb"] = resolve_audio_bed_volume_db(
            job_dir, directives, voice_media=job_dir / "final_raw.mp4")

    return props


def render(props: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "npx",
        "--no-install",
        "remotion",
        "render",
        ENTRY,
        COMPOSITION_ID,
        str(output_path.resolve()),
        f"--props={json.dumps(props)}",
        "--log=info",
        "--concurrency=2",
    ]
    print(f"  Running: {' '.join(cmd[:6])} ... {output_path}")
    print(f"  Props (truncated): videoPath={props['videoPath']}, "
          f"duration={props['durationSeconds']}s, overlays={len(props.get('overlays', []))}")
    result = subprocess.run(cmd, cwd=REMOTION_DIR)
    if result.returncode != 0:
        raise RuntimeError(f"remotion render exited with code {result.returncode}")


def _main_unlocked() -> None:
    parser = argparse.ArgumentParser()
    add_job_arg(parser)
    parser.add_argument("--no-captions", action="store_true",
                        help="Disable burned-in captions (overlays still apply).")
    parser.add_argument("--legacy-overlays", action="store_true",
                        help="Force-keep the legacy hook/url/lower-third auto-overlays even when "
                             "the job has overlays.tsx (default: skip them — overlays.tsx owns the layer).")
    parser.add_argument("--no-overlays", action="store_true",
                        help="Disable hook/URL/lower-third overlays (captions still apply).")
    parser.add_argument("--platform", default="all_platforms",
                        help="Red-zone platform for layout pre-flight (default: all_platforms)")
    parser.add_argument("--skip-preflight", action="store_true",
                        help="Skip layout pre-flight (red zones + face collision)")
    parser.add_argument("--strict-preflight", action="store_true",
                        help="Refuse to render if pre-flight finds any issue (default: warn-only)")
    parser.add_argument("--allow-stub-overlays", metavar="REASON", default=None,
                        help="Optionally document why this render intentionally omits "
                             "<job_dir>/overlays.tsx; the non-empty reason is logged to "
                             "<job_dir>/adaptation_notes.md.")
    args = parser.parse_args()

    ensure_remotion_installed()

    job_dir = resolve_job_dir(args.job)
    explicit_video_canvas(load_style_directives(job_dir))
    raw_video = job_dir / "final_raw.mp4"
    transcript = job_dir / "transcript.json"
    script_path = job_dir / "script.json"
    final_out = job_dir / "final.mp4"

    # Post-only mode: <job_dir>/post_only.json marker means this job skipped
    # the avatar+script pipeline. The user dropped a video at final_raw.mp4
    # and we just densify+caption+render. No script.json gate required.
    is_post_only = (job_dir / "post_only.json").exists()

    if not raw_video.exists():
        raise FileNotFoundError(f"{raw_video} not found. Run elevenlabs.py first (or drop a video at this path for post-only jobs).")
    if not transcript.exists():
        raise FileNotFoundError(f"{transcript} not found. Run elevenlabs.py first.")
    if not script_path.exists():
        if is_post_only:
            # Synthesize a minimal stub so build_props doesn't crash on missing fields
            script = {"chunks": [], "post_production_notes": "", "total_duration_seconds": 0}
        else:
            raise FileNotFoundError(f"{script_path} not found. Write script.json first.")
    else:
        script = json.loads(script_path.read_text())

    # Sanity check transcript isn't the placeholder
    tx = json.loads(transcript.read_text())
    words = tx.get("words", [])
    if not words or words[0].get("word") == "PLACEHOLDER":
        raise RuntimeError(
            "transcript.json is a placeholder. Set ELEVENLABS_API_KEY and "
            "rerun elevenlabs.py before rendering."
        )

    company = None
    company_path = job_dir / "company.json"
    if company_path.exists():
        company = json.loads(company_path.read_text())

    # Compute chunk_boundaries.json from script.json + transcript.json so per-
    # job overlays.tsx can anchor Sequences by chunk index instead of hardcoded
    # seconds. See tools/chunk_boundaries.py + overlay_authoring_guide.md
    # §11.5. Idempotent — always overwrites; downstream overlays pick up the
    # new file via staticFile() on the next render.
    try:
        from chunk_boundaries import compute_and_write as _compute_chunk_boundaries
        densify_meta_path = job_dir / "densify_meta.json"
        final_duration_sec: float | None = None
        if densify_meta_path.exists():
            final_duration_sec = json.loads(densify_meta_path.read_text()).get("final_duration_sec")
        _compute_chunk_boundaries(
            job_dir,
            final_duration_sec=final_duration_sec,
            quiet=False,
        )
    except Exception as e:
        # Non-fatal: chunk_boundaries.json is a nice-to-have for new overlays.
        # Existing per-job overlays.tsx files with hardcoded seconds still render.
        print(f"(chunk_boundaries skipped: {e})")

    public_relative = link_job_into_public(job_dir)
    has_job_overlays = link_job_overlays(job_dir)
    print(f"Job:    {job_dir}")
    print(f"Linked: {PUBLIC_DIR / public_relative} → {job_dir}")
    print(f"JobOverlays: {'<job_dir>/overlays.tsx' if has_job_overlays else 'stub (none authored)'}")

    # An authored overlay layer is advisory. The renderer permits minimal and
    # captions-only creative choices.
    if not has_job_overlays and not is_post_only and not args.allow_stub_overlays:
        print(
            "No <job_dir>/overlays.tsx authored; rendering the intentional "
            "captions-only/minimal path."
        )
    # If overlays are stubbed by escape hatch, demand a documented reason and log it.
    if args.allow_stub_overlays is not None:
        reason = args.allow_stub_overlays.strip()
        if not reason:
            raise SystemExit(
                "ERROR: --allow-stub-overlays requires a non-empty reason string. "
                "Pass --allow-stub-overlays 'intentional captions-only treatment' or similar."
            )
        adaptation_notes = job_dir / "adaptation_notes.md"
        from datetime import datetime as _dt
        stamp = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        log_line = f"- [{stamp}] `remotion_render.py --allow-stub-overlays` invoked: {reason}\n"
        if adaptation_notes.exists():
            adaptation_notes.write_text(adaptation_notes.read_text() + log_line)
        else:
            adaptation_notes.write_text(
                "# Adaptation notes\n\n"
                "Records explicit overlay-treatment choices on this job.\n\n" + log_line
            )
        print(f"Captions-only/minimal render choice: {reason}")
        print(f"   logged to {adaptation_notes}")

    props = build_props(job_dir, public_relative, script, company)
    if args.no_captions:
        props["showCaptions"] = False
    if args.no_overlays:
        props["overlays"] = []
    elif has_job_overlays and not args.legacy_overlays:
        # When the job ships its own overlays.tsx, the JOB OWNS the overlay
        # layer. Skip the legacy hook/url/lower-third auto-overlays so they
        # don't double-render alongside the per-job ones (the bug we hit on
        # chung-press where two hook pills appeared simultaneously).
        n_legacy = len(props.get("overlays", []))
        props["overlays"] = []
        if n_legacy > 0:
            print(f"Skipped {n_legacy} legacy overlay(s) — overlays.tsx owns the overlay layer. "
                  f"Pass --legacy-overlays to keep both.")

    # Layout pre-flight: red zones + face collision. Warn-only by default.
    if not args.skip_preflight and not args.no_overlays:
        from preflight import validate_layout
        issues = validate_layout(job_dir, platform=args.platform)
        if issues:
            print(f"\n⚠ Pre-flight found {len(issues)} layout issue(s) on platform={args.platform}:")
            for i in issues:
                print(f"  - {i.format()}")
            if args.strict_preflight:
                raise RuntimeError("strict-preflight: refusing to render with layout issues")
            print("  (continuing — pass --strict-preflight to block on these)\n")
        else:
            print(f"✓ Pre-flight clean for {args.platform}\n")

    log_event(
        job_dir, tool="remotion_render.py", event="render_started",
        extra={
            "composition_id": COMPOSITION_ID,
            "duration_seconds": props.get("durationSeconds"),
            "overlays": len(props.get("overlays", [])),
            "show_captions": props.get("showCaptions", True),
            "video_path": props.get("videoPath"),
            "rendered_overlays": [
                {"kind": str(o.get("kind", "")), "text": str(o.get("text", ""))[:160],
                 "start": o.get("start"), "end": o.get("end")}
                for o in (props.get("overlays") or [])[:50] if isinstance(o, dict)
            ],
            "job_overlays_tsx": bool(has_job_overlays and not args.no_overlays),
            **(caption_facts(words) if props.get("showCaptions", True) else {}),
        },
    )

    import time as _time
    _t0 = _time.perf_counter()
    staging = staging_path(final_out)
    try:
        render(props, staging)
        publish_deliverable(job_dir, staging, final_out, tool="remotion_render", facts={
            "mode": "render",
            "show_captions": bool(props.get("showCaptions", True)),
            "pre_roll": 0.0,
            "rendered_overlays": [
                {"kind": str(o.get("kind", "")), "text": str(o.get("text", ""))[:160],
                 "start": o.get("start"), "end": o.get("end")}
                for o in (props.get("overlays") or [])[:50] if isinstance(o, dict)
            ],
            "job_overlays_tsx": bool(has_job_overlays and not args.no_overlays),
            **(caption_facts(words) if props.get("showCaptions", True) else {}),
        })
    except Exception as e:
        log_event(
            job_dir, tool="remotion_render.py", event="render_failed",
            duration_seconds=_time.perf_counter() - _t0,
            extra={"error": type(e).__name__, "error_message": str(e)[:300]},
        )
        raise
    finally:
        staging.unlink(missing_ok=True)

    if final_out.exists():
        size_mb = final_out.stat().st_size // 1024 // 1024
        print(f"\n✓ Final video: {final_out} ({size_mb}MB)")
        log_event(
            job_dir, tool="remotion_render.py", event="render_completed",
            duration_seconds=_time.perf_counter() - _t0,
            extra={
                "output_path": str(final_out.relative_to(job_dir)),
                "size_bytes": final_out.stat().st_size,
            },
        )
    else:
        raise RuntimeError("Remotion render finished but final.mp4 is missing")


def main() -> None:
    """Render with exclusive ownership of the shared Remotion source tree."""
    # Parsing twice would make error output confusing, so resolve only the job
    # identifier needed for the ownership receipt without consuming argv.
    job_id = "unknown"
    for index, value in enumerate(sys.argv[:-1]):
        if value == "--job":
            job_id = Path(sys.argv[index + 1]).name
            break
    with exclusive_remotion_render(REMOTION_DIR, job_id=job_id):
        _main_unlocked()


if __name__ == "__main__":
    main()
