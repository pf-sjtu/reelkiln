#!/usr/bin/env python3
"""
assemble — EDL → timeline. The canonical beat assembler (deterministic, $0, no API).

TWO things live here, with different force:
  THE CONTRACT (mandatory for EVERY assembled timeline, however it was built):
    declare what you assembled — `chunk_boundaries.json` + per-beat role-log events —
    so `review_output`'s role-judge can judge it. Hand-rolled a bespoke ffmpeg/PIL
    timeline? Great — that's often the right call (see skills/assembly_craft.md for
    proven ideas). Then run `--declare` with a loose EDL (name/role/start/end per beat).
  THE EXECUTOR (a convenience, never a mandate): for the common full-frame case, this
    tool also EXECUTES an EDL — normalizes every beat to one codec/fps/size, concats,
    lays the VO + bed — so you don't re-derive the boring 80% per job. The agent
    still AUTHORS the EDL; that's the creative work.

  uv run python tools/assemble.py --job <id> [--edl edl.json] [--check] [--output final_raw.mp4]

`--check` validates the EDL (sources exist, times sane, VO-vs-timeline delta) and prints
the beat table WITHOUT rendering. Always run it first; it is free.

The EDL (default `jobs/<id>/edl.json`):

  {
    "fps": 30, "width": 1080, "height": 1920,
    "beats": [
      {"name": "b1_hook", "source": "aroll/base_lipsynced.mp4", "in": 0.0, "out": 8.7,
       "role": "face", "source_kind": "real", "grade": "warm_face"},
      {"name": "b2_card", "source": "images/card.png", "duration": 3.2,
       "role": "card", "source_kind": "other", "motion": "kenburns_in"},
      {"name": "b3_broll", "source": "broll/clip.mp4", "in": 0, "out": 4.0,
       "role": "broll", "source_kind": "real", "grade": "warm_light", "keep_audio": true,
       "framing": "subject", "punch": 1.08}
    ],
    "audio": {
      "from_beats": false,                                   // keep diegetic beat audio?
      "vo":  {"source": "edit/audio_densified.mp3", "gain": 1.0},
      "bed": {"source": "audio/bed.mp3"}   // one steady level 12 dB under the VO
    },
    "output": "final_raw.mp4"
  }

Rules the tool enforces (they encode the craft laws):
  - Every STILL gets motion by default — the visual-interest law — and the default is
    `motion: "auto"`: it ROTATES the Ken Burns variety pack (in/out/pan_right/pan_left/
    down) per still beat, because identical KB on every still reads mechanical (wolfram
    build lesson). Pin one preset per beat if you want it; `"none"` only when deliberate.
  - Video beats trim by `in`/`out` (or `in` + `duration`). Stills need `duration`.
  - When `promise.json` declares `footage_mix.real_min_ratio`, every timeline beat
    declares `source_kind: "real"` or `"generated"`. The promise gate measures final
    timeline seconds, never generation/pull call counts. Non-footage cards may use
    `source_kind: "other"` and are excluded from that ratio.
  - `grade` presets: `warm_face` (counteracts sync-3's cold wash — proven values),
    `warm_light` (b-roll), `none` (default). Escape hatch: a raw `"vf": "..."` string.
  - Video beats default to `framing: "subject"`: keep natural camera footage full-bleed
    and center the dominant subject. Already-correct aspect ratios pass through unchanged.
    Use `"contain"` deliberately for readable screens/documents or an explicitly required
    complete frame; it is not an automatic fallback for ordinary footage. Use `"center"`
    or `"manual"` + `frame_x`/`frame_y` deliberately; final delivery QA still decides
    whether the resulting pixels are safe.
    `punch` may add a 1.0–1.5x center push after safe framing. It is suppressed
    when the complete group needed containment, because zooming that safety
    treatment back up could crop the people it was chosen to protect.
  - VO length vs timeline length is checked; a delta > 0.5s is a loud warning (a spine
    that outruns its VO is the #1 silent assembly bug).
  - The bed sits at ONE steady level under the voice and never ducks (videoclaw#321):
    with no "gain" it is matched `under_voice_db` (default 12) below the VO — or below
    the beats' own audio with `from_beats` — measured by integrated loudness. An
    explicit "gain" is used as written, but never closer than 8 dB under the voice
    (clamped, with a log line). A leftover `"duck": true` is accepted and ignored,
    and a gain written beside it (chosen for a ducked bed) is ignored too: the bed is
    levelled 12 dB under.
  - Audio NEVER clips the timeline: the mix is apad'ed to the video length (the kumar
    poster-tail lesson — no -shortest), and mastered to -14 LUFS (the social loudness
    standard; opt out with "audio": {"loudnorm": false}). A bed under a voice is
    mastered with one measured linear gain + a true-peak limiter (≤ -1 dBTP), so the
    bed keeps its gap; other mixes keep the single-pass loudnorm I=-14:TP=-1.5.
  - Sources resolve job-relative first, then repo-relative.

What this v1 does NOT do (by design — author those with the workflow's own recipe):
  captions/overlays (that's `compose_render --mode retrofit`, run AFTER this), the
  aroll split-screen top/band layout (still the aroll-reel ffmpeg recipe), per-beat
  transitions beyond hard cuts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _ffmpeg import run_ffmpeg_atomic, ffprobe_duration  # noqa: E402
import _bed_level  # noqa: E402
from job import resolve_job_dir, add_job_arg  # noqa: E402
from log import log_event, read_events  # noqa: E402
from _safe_framing import (  # noqa: E402
    _blur_contain_filter,
    _crop_filter,
    _framing_plan_from_faces,
    _probe as probe_video,
    _subject_framing_plan,
)

REPO_ROOT = Path(__file__).resolve().parents[1]

STILL_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

# Proven grade values (trend-dup build: lipsync washes cold → push warm, kill blue).
GRADES = {
    "warm_face": ("colorbalance=rs=0.04:gs=0.01:bs=-0.06:rm=0.03:bm=-0.04,"
                  "eq=saturation=1.07:contrast=1.05:gamma=1.02"),
    "warm_light": "eq=saturation=1.03:contrast=1.02:gamma=1.01",
    "none": "",
}
FRAMING_MODES = {"subject", "center", "contain", "manual"}


def die(msg: str) -> None:
    raise SystemExit(f"[assemble] ERROR: {msg}")


def resolve_source(job_dir: Path, rel: str) -> Path:
    for base in (job_dir, REPO_ROOT):
        p = base / rel
        if p.exists():
            return p
    die(f"source not found (tried job-relative and repo-relative): {rel}")


def beat_duration(b: dict, src: Path) -> float:
    is_still = src.suffix.lower() in STILL_EXTS
    if is_still:
        d = b.get("duration")
        if not d or d <= 0:
            die(f"beat '{b.get('name')}': a still needs a positive \"duration\"")
        return float(d)
    t_in = float(b.get("in", 0.0))
    if "out" in b:
        t_out = float(b["out"])
    elif "duration" in b:
        t_out = t_in + float(b["duration"])
    else:
        t_out = ffprobe_duration(src)  # to end of source
    if t_out <= t_in:
        die(f"beat '{b.get('name')}': out ({t_out}) must be > in ({t_in})")
    src_dur = ffprobe_duration(src)
    if t_out > src_dur + 0.05 and not b.get("loop"):
        die(f"beat '{b.get('name')}': out ({t_out:.2f}s) past source end ({src_dur:.2f}s) of "
            f"{src.name} — a short clip can fill a longer beat with \"loop\": true")
    b["_in"], b["_out"] = t_in, t_out
    return round(t_out - t_in, 3)


def has_audio(src: Path) -> bool:
    res = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a",
                          "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(src)],
                         capture_output=True, text=True)
    return bool(res.stdout.strip())


def grade_filter(b: dict) -> str:
    if b.get("vf"):
        return b["vf"]
    name = b.get("grade", "none")
    if name not in GRADES:
        die(f"beat '{b.get('name')}': unknown grade '{name}' (have: {', '.join(GRADES)}, or raw \"vf\")")
    return GRADES[name]


def video_framing_plan(b: dict, src: Path, width: int, height: int) -> tuple[dict, str | None]:
    """Return the shot-wide framing decision and optional ffmpeg crop filter."""
    aspect = f"{width}:{height}"
    info = probe_video(src)
    mode = str(b.get("framing", "subject"))
    if b.get("vf"):
        return {
            "strategy": "custom_filter",
            "reason": "caller supplied a raw video filter",
            "center": [0.5, 0.5],
            "frameMode": mode,
        }, None
    target_ratio = width / height
    source_ratio = info["width"] / info["height"]
    if mode == "subject" and abs(source_ratio - target_ratio) / target_ratio <= 0.01:
        return {
            "strategy": "same_aspect",
            "reason": "source already matches the delivery canvas; preserve its full frame",
            "center": [0.5, 0.5],
            "faceCount": 0,
            "frameMode": mode,
        }, None
    if mode == "subject":
        plan = _subject_framing_plan(
            src,
            aspect,
            start_sec=float(b.get("_in", 0.0)),
            end_sec=float(b["_out"]) if "_out" in b else None,
        )
    elif mode == "contain":
        plan = _framing_plan_from_faces(
            info["width"], info["height"], aspect, [], allow_contain=True,
        )
        plan["reason"] = "caller requested complete-source containment"
    elif mode == "manual":
        try:
            cx, cy = float(b["frame_x"]), float(b.get("frame_y", 0.5))
        except (KeyError, TypeError, ValueError) as exc:
            die("manual framing needs numeric frame_x and optional frame_y")
            raise AssertionError from exc
        if not 0.0 <= cx <= 1.0 or not 0.0 <= cy <= 1.0:
            die("manual framing frame_x/frame_y must be between 0 and 1")
        plan = {
            "strategy": "manual_crop",
            "reason": "caller supplied a deliberate crop center",
            "center": [cx, cy],
            "faceCount": 0,
        }
    else:
        plan = {
            "strategy": "center_crop",
            "reason": "caller deliberately requested geometric center crop",
            "center": [0.5, 0.5],
            "faceCount": 0,
        }
    plan["frameMode"] = mode
    if plan["strategy"] == "contain_blur":
        return plan, None
    cx, cy = plan["center"]
    crop, _, _ = _crop_filter(info["width"], info["height"], aspect, cx, cy)
    return plan, crop


def punch_filter(b: dict, width: int, height: int, *, safe_to_apply: bool) -> tuple[str, float]:
    try:
        requested = float(b.get("punch", 1.0))
    except (TypeError, ValueError):
        die("punch must be a number between 1.0 and 1.5")
        raise AssertionError
    if not 1.0 <= requested <= 1.5:
        die("punch must be between 1.0 and 1.5")
    if requested <= 1.0001 or not safe_to_apply:
        return "", 1.0
    punched_w = max(width, round(width * requested / 2) * 2)
    punched_h = max(height, round(height * requested / 2) * 2)
    return f",scale={punched_w}:{punched_h}:flags=lanczos,crop={width}:{height}", requested


# The variety pack (proven in the wolfram dynamic-PIP build): identical Ken Burns on
# every still reads mechanical — "auto" rotates presets per still beat.
KB_PRESETS = ["kenburns_in", "kenburns_out", "pan_right", "pan_left", "kenburns_down"]


def kenburns_expr(motion: str, nframes: int) -> str:
    if motion == "kenburns_in":
        return "z='min(1.001+0.0007*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if motion == "kenburns_out":
        return "z='if(eq(on,0),1.15,max(1.0,zoom-0.0016))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    if motion == "pan_right":
        return f"z=1.08:x='(iw-iw/zoom)*(on/{nframes})':y='ih/2-(ih/zoom/2)'"
    if motion == "pan_left":
        return f"z=1.08:x='(iw-iw/zoom)*(1-on/{nframes})':y='ih/2-(ih/zoom/2)'"
    if motion == "kenburns_down":
        return f"z=1.06:x='iw/2-(iw/zoom/2)':y='min(0.10*ih*on/{nframes}, ih-ih/zoom)'"
    die(f"unknown motion '{motion}' (auto | {' | '.join(KB_PRESETS)} | none)")


def load_edl(job_dir: Path, edl_arg: str | None) -> dict:
    path = Path(edl_arg) if edl_arg else (job_dir / "edl.json")
    if not path.is_absolute() and not path.exists():
        path = job_dir / path
    if not path.exists():
        die(f"no EDL at {path} — author it first (schema in this tool's docstring)")
    try:
        edl = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        die(f"EDL is not valid JSON: {e}")
    if not edl.get("beats"):
        die("EDL has no beats")
    return edl


def declare_rows(edl: dict) -> list[dict]:
    """Loose form for HAND-ASSEMBLED timelines: beats carry explicit timeline
    start/end (+ name/role); no sources needed, nothing probed."""
    rows = []
    for i, b in enumerate(edl["beats"]):
        if "start" not in b or "end" not in b:
            die(f"--declare beat {i}: needs explicit \"start\"/\"end\" timeline seconds "
                "(hand assemblies declare WHERE each beat landed, not how it was built)")
        rows.append({"name": b.get("name") or f"beat_{i:02d}",
                     "role": b.get("role", "unspecified"),
                     "beat": b, "dur": round(float(b["end"]) - float(b["start"]), 3),
                     "start": float(b["start"]), "end": float(b["end"])})
    return rows


def declaration_mode(edl: dict) -> str:
    """Resolve an intuitive ``--declare`` call without making the agent guess.

    A hand-built timeline has explicit start/end coordinates and is declaration-only.
    A normal executor EDL describes sources and durations; assemble renders it and writes
    the same declaration automatically. Mixing the two shapes is ambiguous and fails with
    one actionable correction instead of silently choosing the wrong timeline.
    """
    explicit = ["start" in beat and "end" in beat for beat in edl["beats"]]
    partial = [("start" in beat) != ("end" in beat) for beat in edl["beats"]]
    if any(partial) or (any(explicit) and not all(explicit)):
        die("--declare EDL mixes hand-timeline and executor beats; use explicit start/end "
            "on every beat for declaration-only mode, or remove start/end and keep "
            "source + in/out|duration for normal render + automatic declaration")
    return "declare-only" if all(explicit) else "render-and-declare"


def _sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def generated_tts_source(job_dir: Path, source: Path) -> dict | None:
    """Return tool-produced TTS identity for the exact VO source, if present."""
    try:
        source_path = source.resolve().relative_to(job_dir.resolve()).as_posix()
        audio_sha256 = _sha256(source)
    except (OSError, ValueError):
        return None
    events = (item for item in reversed(read_events(job_dir)) if (
        item.get("tool") == "synth_voice.py"
        and item.get("event") == "tts_generated"
        and item.get("final_path") == source_path
        and item.get("audio_sha256") == audio_sha256
    ))
    for event in events:
        try:
            sidecar_path = event["evidence_path"]
            sidecar = (job_dir / sidecar_path).resolve()
            sidecar.relative_to(job_dir.resolve())
            evidence_sha256 = _sha256(sidecar)
            evidence = json.loads(sidecar.read_text())
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
        if (
            isinstance(event.get("id"), str)
            and event.get("evidence_sha256") == evidence_sha256
            and evidence.get("evidence_kind") == "engine_generated_tts"
            and evidence.get("final_path") == source_path
            and evidence.get("audio_sha256") == audio_sha256
        ):
            return {
                "kind": "engine_generated_tts",
                "tts_event_id": event["id"],
                "path": source_path,
                "audio_sha256": audio_sha256,
                "evidence_path": sidecar_path,
                "evidence_sha256": evidence_sha256,
            }
    return None


def write_declaration(job_dir: Path, rows: list[dict], total: float,
                      output: str | None, duration_seconds: float | None = None,
                      output_sha256: str | None = None,
                      generated_tts: dict | None = None,
                      from_beats: bool | None = None) -> None:
    """The QA contract: chunk_boundaries.json + per-beat role-log events.
    review_output's role-judge reads BOTH — this is what makes an assembled
    timeline judgeable, whether assemble rendered it or a hand script did."""
    (job_dir / "chunk_boundaries.json").write_text(json.dumps({
        "source": "assemble.py", "chunks": [
            {"name": r["name"], "start_sec": r["start"], "end_sec": r["end"],
             "role": r["role"], "beat_source": r["beat"].get("source", ""),
             "source_kind": r["beat"].get("source_kind"),
             **({"framing": r["framing"]} if r.get("framing") else {})} for r in rows
        ]}, indent=2))
    for r in rows:
        log_event(job_dir, "assemble.py", "beat_assembled", render_md=False, extra={
            "usage_role": r["role"], "name": r["name"],
            "start_sec": r["start"], "end_sec": r["end"],
            "source": r["beat"].get("source", ""),
            "source_kind": r["beat"].get("source_kind")})
    summary = {"beats": len(rows), "total_sec": total,
               "output": output or "", "estimate_usd": 0.0}
    if output_sha256:
        summary["output_sha256"] = output_sha256
    if from_beats is not None:
        summary["from_beats"] = from_beats
    if generated_tts:
        summary["generated_tts"] = generated_tts
    log_event(job_dir, "assemble.py", "timeline_assembled",
              duration_seconds=duration_seconds, extra=summary)


def validate(job_dir: Path, edl: dict) -> list[dict]:
    """Resolve + probe everything; returns beat rows [{name, role, src, dur, start, end}]."""
    rows, t = [], 0.0
    names = set()
    still_idx = 0
    for i, b in enumerate(edl["beats"]):
        name = b.get("name") or f"beat_{i:02d}"
        if name in names:
            die(f"duplicate beat name '{name}' — names key the role-log, keep them unique")
        names.add(name)
        src = resolve_source(job_dir, b["source"]) if b.get("source") else die(f"beat '{name}': no source")
        dur = beat_duration(b, src)
        grade_filter(b)  # validates grade names early
        if src.suffix.lower() in STILL_EXTS:
            m = b.get("motion", "auto")
            if m not in ("auto", "none", *KB_PRESETS):
                kenburns_expr(m, 1)  # dies with the right message
        else:
            framing = str(b.get("framing", "subject"))
            if framing not in FRAMING_MODES:
                die(
                    f"beat '{name}': unknown framing '{framing}' "
                    f"(have: {', '.join(sorted(FRAMING_MODES))})"
                )
            if framing == "manual":
                try:
                    frame_x = float(b["frame_x"])
                    frame_y = float(b.get("frame_y", 0.5))
                except (KeyError, TypeError, ValueError):
                    die(f"beat '{name}': manual framing needs numeric frame_x/frame_y")
                if not 0 <= frame_x <= 1 or not 0 <= frame_y <= 1:
                    die(f"beat '{name}': frame_x/frame_y must be between 0 and 1")
            try:
                punch = float(b.get("punch", 1.0))
            except (TypeError, ValueError):
                die(f"beat '{name}': punch must be a number between 1.0 and 1.5")
            if not 1.0 <= punch <= 1.5:
                die(f"beat '{name}': punch must be between 1.0 and 1.5")
        row = {"name": name, "role": b.get("role", "unspecified"), "src": src,
               "beat": b, "dur": dur, "start": round(t, 3), "end": round(t + dur, 3)}
        if src.suffix.lower() in STILL_EXTS:
            row["still_idx"] = still_idx
            still_idx += 1
        rows.append(row)
        t += dur
    return rows


# The bed gain before videoclaw#321. It stays the level of a bed with no voice
# to sit under (the master loudnorm then sets the level).
LEGACY_BED_GAIN = 0.3


def audio_source(job_dir: Path, edl: dict, key: str) -> tuple[Path, float | None] | None:
    """(path, gain) for the EDL's `vo` or `bed`.

    A bed's gain is None when the EDL gives none: bed_level_gain then matches
    it under the voice. A bed never ducks (#321); a leftover `"duck": true` is
    accepted and ignored with one log line.
    """
    spec = (edl.get("audio") or {}).get(key)
    if not spec or not spec.get("source"):
        return None
    if key == "bed":
        gain = spec.get("gain")
        if spec.get("duck"):
            if gain is not None:
                # That gain was chosen for a bed the sidechain would pull down
                # under speech; played flat it can bury the voice (RC3).
                print(f'[assemble] note: "duck" is retired (#321); gain {gain} was set for a '
                      "ducked bed, so it is ignored and the bed is levelled "
                      f"{_bed_level.FLAT_BED_UNDER_VOICE_DB:g} dB under the voice.")
                gain = None
            else:
                print('[assemble] note: "duck" is retired (#321) and ignored; '
                      "the bed stays one steady level under the voice.")
        return (resolve_source(job_dir, spec["source"]), None if gain is None else float(gain))
    return (resolve_source(job_dir, spec["source"]), float(spec.get("gain", 1.0)))


def bed_level_gain(timeline: Path, vo, bed, from_beats: bool, under_voice_db: float) -> float:
    """The one constant gain the bed plays at (videoclaw#321).

    With no "gain" in the EDL: one steady level `under_voice_db` below the
    voice — the VO (at its own gain), else the beats' own audio when
    `from_beats`. With an explicit "gain": that gain, unless it would put the
    bed closer than MIN_BED_UNDER_VOICE_DB (8 dB) under the voice, where it is
    clamped. A bed with nothing to sit under keeps its gain (or
    LEGACY_BED_GAIN).
    """
    explicit = bed[1]
    fallback = LEGACY_BED_GAIN if explicit is None else explicit
    if vo is not None and vo[1] > 0:
        lead, lead_gain_db = vo[0], 20 * math.log10(vo[1])
    elif vo is None and from_beats:
        lead, lead_gain_db = timeline, 0.0
    else:
        return fallback
    under = under_voice_db if explicit is None else _bed_level.MIN_BED_UNDER_VOICE_DB
    try:
        level = _bed_level.flat_bed_gain(
            lead, bed[0], under_voice_db=under, voice_gain_db=lead_gain_db)
    except RuntimeError as exc:
        print(f"[assemble] WARNING: {exc}; the bed keeps gain {fallback}")
        return fallback
    if level is None:
        return fallback
    if explicit is not None:
        if explicit <= 0 or 20 * math.log10(explicit) <= level["gain_db"]:
            return explicit
        clamped = round(10 ** (level["gain_db"] / 20), 5)
        print(f"[assemble] bed: gain {explicit} would sit closer than "
              f"{_bed_level.MIN_BED_UNDER_VOICE_DB:g} dB under the voice; clamped to "
              f"{clamped} ({_bed_level.MIN_BED_UNDER_VOICE_DB:g} dB under).")
        return clamped
    capped = " (held lower so no bed sample passes -1 dBFS)" if level["peak_capped"] else ""
    print(f"[assemble] bed: one steady level {under_voice_db:g} dB under the voice, "
          f"gain {level['gain_db']:+.1f} dB{capped}")
    return round(10 ** (level["gain_db"] / 20), 5)


def print_table(rows: list[dict], vo: tuple | None) -> float:
    total = rows[-1]["end"] if rows else 0.0
    print(f"{'beat':<16}{'role':<12}{'start':>8}{'end':>8}{'dur':>7}  source")
    for r in rows:
        print(f"{r['name']:<16}{r['role']:<12}{r['start']:>8.2f}{r['end']:>8.2f}{r['dur']:>7.2f}  {r['beat']['source']}")
    print(f"{'':16}{'TOTAL':<12}{'':8}{total:>8.2f}")
    if vo:
        vo_dur = ffprobe_duration(vo[0])
        delta = total - vo_dur
        marker = "OK" if abs(delta) <= 0.5 else "⚠ LOUD WARNING"
        print(f"VO {vo[0].name}: {vo_dur:.2f}s · timeline {total:.2f}s · delta {delta:+.2f}s [{marker}]")
        if abs(delta) > 0.5:
            print("  ↳ a spine that outruns/undershoots its VO is the #1 silent assembly bug —"
                  " fix the beat trims or the VO before rendering captions on top.")
    return total


def encode_segment(r: dict, seg_path: Path, edl: dict, with_audio: bool) -> None:
    W, H, FPS = edl.get("width", 1080), edl.get("height", 1920), edl.get("fps", 30)
    b, src = r["beat"], r["src"]
    g = grade_filter(b)
    g_suffix = f",{g}" if g else ""
    a_enc = ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"]
    v_enc = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
             "-video_track_timescale", "90000"]  # uniform timescale → clean -c copy concat
    if src.suffix.lower() in STILL_EXTS:
        motion = b.get("motion", "auto")
        if motion == "auto":
            # rotate the variety pack per still beat — identical KB reads mechanical
            motion = KB_PRESETS[r.get("still_idx", 0) % len(KB_PRESETS)]
        nframes = max(1, round(r["dur"] * FPS))
        if motion == "none":
            vf = (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                  f"crop={W}:{H},setsar=1,fps={FPS}{g_suffix}")
        else:
            # 2x pre-scale so zoompan steps are sub-pixel-smooth (kills the classic
            # jitter — the documented fix across the projects/ assemblers); trim after
            # because zoompan's frame-count math can overshoot.
            up_w, up_h = W * 2, H * 2
            vf = (f"scale={up_w}:{up_h}:force_original_aspect_ratio=increase,"
                  f"crop={up_w}:{up_h},"
                  f"zoompan={kenburns_expr(motion, nframes)}:d={nframes}:s={W}x{H}:fps={FPS},"
                  f"trim=duration={r['dur']},setsar=1{g_suffix}")
        args = ["-loop", "1", "-i", str(src), "-t", f"{r['dur']:.3f}", "-vf", vf, *v_enc]
        if with_audio:  # stills carry silence so the concat audio stream stays continuous
            args = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", *args,
                    "-map", "1:v", "-map", "0:a", "-shortest", *a_enc]
        else:
            args += ["-an"]
    else:
        framing, crop = video_framing_plan(b, src, W, H)
        punch_suffix, applied_punch = punch_filter(
            b,
            W,
            H,
            safe_to_apply=framing["strategy"] not in {"contain_blur", "custom_filter"},
        )
        loop_args = ["-stream_loop", "-1"] if b.get("loop") else []
        source_audio = with_audio and b.get("keep_audio", True) and has_audio(src)
        silence_audio = with_audio and not source_audio
        if silence_audio:
            # Silence is input 0 and source video is input 1.
            args = [
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                *loop_args, "-ss", f"{b['_in']:.3f}", "-i", str(src),
                "-t", f"{r['dur']:.3f}",
            ]
            source_index = 1
        else:
            args = [
                *loop_args, "-ss", f"{b['_in']:.3f}", "-i", str(src),
                "-t", f"{r['dur']:.3f}",
            ]
            source_index = 0

        if framing["strategy"] == "contain_blur":
            graph = _blur_contain_filter(
                W,
                H,
                framing.get("foregroundBox"),
                input_label=f"{source_index}:v",
                output_label="delivery_framed",
            )
            graph += (
                f";[delivery_framed]setsar=1,fps={FPS},"
                f"setpts=PTS-STARTPTS{punch_suffix}{g_suffix}[delivery_video]"
            )
            args += ["-filter_complex", graph, "-map", "[delivery_video]"]
        else:
            if framing["strategy"] == "custom_filter":
                vf = (
                    f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},"
                    f"setsar=1,fps={FPS},setpts=PTS-STARTPTS{g_suffix}"
                )
            elif framing["strategy"] == "same_aspect":
                vf = (
                    f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                    f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS},"
                    f"setpts=PTS-STARTPTS{punch_suffix}{g_suffix}"
                )
            else:
                vf = (
                    f"{crop},scale={W}:{H}:flags=lanczos,setsar=1,fps={FPS},"
                    f"setpts=PTS-STARTPTS{punch_suffix}{g_suffix}"
                )
            args += ["-vf", vf, "-map", f"{source_index}:v"]

        args += v_enc
        if source_audio:
            args += [
                "-map", f"{source_index}:a", "-af", "aresample=44100,asetpts=PTS-STARTPTS",
                *a_enc,
            ]
        elif silence_audio:
            args += ["-map", "0:a", "-shortest", *a_enc]
        else:
            args += ["-an"]
    run_ffmpeg_atomic(output=seg_path, args=args)
    if src.suffix.lower() not in STILL_EXTS:
        receipt = {
            "schema": "videoclaw.footage-framing/v1",
            "source": str(src),
            "sourceWindow": [b["_in"], b["_out"]],
            "output": str(seg_path),
            "outputSize": [W, H],
            "requestedPunch": float(b.get("punch", 1.0)),
            "appliedPunch": applied_punch,
            **framing,
        }
        r["framing"] = {
            key: receipt[key]
            for key in (
                "strategy", "reason", "frameMode", "faceCount",
                "sampledFaceDetections", "requestedPunch", "appliedPunch",
            )
            if key in receipt
        }
        seg_path.with_suffix(seg_path.suffix + ".framing.json").write_text(
            json.dumps(receipt, indent=2) + "\n",
            encoding="utf-8",
        )


def concat_manifest(rows: list[dict]) -> str:
    """Pin each segment's planned span in the ffconcat timeline.

    MP4 reports the timestamp of its final frame as the stream duration. That is
    one frame shorter than the requested cut, so a plain concat silently loses
    one frame at every seam. Declared durations make the next segment start at
    the EDL boundary; only the final segment remains subject to normal one-frame
    output quantization.
    """
    return "".join(
        f"file '{r['seg']}'\nduration {r['dur']:.9f}\n"
        for r in rows
    )


def mux_audio(timeline: Path, out: Path, vo, bed, from_beats: bool,
              loudnorm: bool = True) -> None:
    """Lay VO + a flat bed over the timeline. Any of vo/bed may be None.
    Audio is apad'ed to the VIDEO length (audio must never clip the timeline — the
    kumar poster-tail lesson) and loudness-normalized to the social standard.

    A bed under a voice (the VO, or the beats' own audio) is mastered with one
    linear gain to -14 LUFS plus a true-peak limiter, measured first, so the
    bed keeps its gap under the voice and pauses are not pumped up. Any other
    mix keeps the single-pass loudnorm it always had."""
    inputs, flt = ["-i", str(timeline)], []
    mix, idx = [], 1
    if from_beats:
        flt.append("[0:a]anull[beats]")
        mix.append("[beats]")
    if vo:
        inputs += ["-i", str(vo[0])]
        flt.append(f"[{idx}:a]volume={vo[1]}[vomix]")
        mix.append("[vomix]")
        idx += 1
    if bed:
        gain = LEGACY_BED_GAIN if bed[1] is None else bed[1]
        inputs += ["-stream_loop", "-1", "-i", str(bed[0])]
        flt.append(f"[{idx}:a]volume={gain}[bedv]")
        mix.append("[bedv]")
        idx += 1
    if not mix:
        die("mux_audio called with nothing to lay")
    master = "loudnorm=I=-14:TP=-1.5:LRA=11," if loudnorm else ""
    if loudnorm and bed and len(mix) > 1:
        # A bed under a voice: measured, then the voice takes one gain + a
        # true-peak limiter and the bed one linear gain that follows it (#321).
        lead, bed_label = mix[:-1], mix[-1]
        levels = _bed_level.master_voice_and_bed(inputs, flt, lead, bed_label)
        if levels is None:
            print("[assemble] WARNING: the voice+bed mix could not be measured; "
                  "it is left at its own level.")
            flt.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0,"
                       "apad[aout]")
        else:
            print(f"[assemble] final mix: {levels['measured_lufs']:.1f} LUFS → "
                  f"{levels['final_lufs']:.1f} LUFS (voice {levels['voice_gain_db']:+.1f} dB, "
                  f"true-peak limited; bed {levels['bed_gain_db']:+.1f} dB), "
                  "the bed's gap under the voice kept.")
            flt = [_bed_level.voice_bed_graph(flt, lead, bed_label, levels["voice_gain_db"],
                                              levels["bed_gain_db"], tail=",apad[aout]")]
    elif len(mix) == 1:
        flt.append(f"{mix[0]}{master}apad[aout]")
    else:
        flt.append(f"{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0,"
                   f"{master}apad[aout]")
    vid_dur = ffprobe_duration(timeline)
    run_ffmpeg_atomic(output=out, args=[
        *inputs, "-filter_complex", ";".join(flt),
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{vid_dur:.3f}",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description="EDL → timeline: the canonical beat assembler.")
    add_job_arg(ap)
    ap.add_argument("--edl", help="EDL json path (default jobs/<id>/edl.json)")
    ap.add_argument("--check", action="store_true", help="validate + print the beat table, no render")
    ap.add_argument("--declare", action="store_true",
                    help="declare the timeline for QA. With explicit start/end beats, write ONLY "
                         "the declaration for a hand-built timeline. With a normal source EDL, "
                         "render normally and auto-declare (the flag is accepted but unnecessary)")
    ap.add_argument("--output", help="output mp4 (default: the EDL's \"output\", else final_raw.mp4)")
    args = ap.parse_args()

    job_dir = resolve_job_dir(args.job)
    edl = load_edl(job_dir, args.edl)

    declare_mode = declaration_mode(edl) if args.declare else None
    if declare_mode == "declare-only":
        rows = declare_rows(edl)
        total = rows[-1]["end"] if rows else 0.0
        write_declaration(job_dir, rows, total, args.output or edl.get("output"))
        print(f"[assemble] --declare: {len(rows)} beats declared ({total:.2f}s) → "
              f"chunk_boundaries.json + role-log. Nothing rendered — your timeline, your rules.")
        return 0
    if declare_mode == "render-and-declare":
        print("[assemble] --declare is already automatic for source EDLs; "
              "rendering normally and writing the QA declaration once.")

    rows = validate(job_dir, edl)
    vo = audio_source(job_dir, edl, "vo")
    bed = audio_source(job_dir, edl, "bed")
    from_beats = bool((edl.get("audio") or {}).get("from_beats"))
    total = print_table(rows, vo)

    if args.check:
        print("[assemble] --check only: EDL valid, nothing rendered.")
        return 0

    t0 = time.perf_counter()
    seg_dir = job_dir / "assemble_segs"
    if seg_dir.exists():
        shutil.rmtree(seg_dir)
    seg_dir.mkdir(parents=True)
    with_audio = from_beats
    for i, r in enumerate(rows):
        seg = seg_dir / f"seg_{i:02d}.mp4"
        encode_segment(r, seg, edl, with_audio)
        r["seg"] = seg
        print(f"  seg {i:02d} {r['name']:<16} {r['dur']:.2f}s ✓")

    concat_txt = seg_dir / "concat.txt"
    concat_txt.write_text(concat_manifest(rows))
    timeline = seg_dir / "timeline.mp4"
    try:
        run_ffmpeg_atomic(output=timeline,
                          args=["-f", "concat", "-safe", "0", "-i", str(concat_txt), "-c", "copy"])
    except RuntimeError:
        # identical encode params can still diverge on timebase (tbn) — the house
        # fallback is a uniform re-encode at concat (projects/ assemblers' default)
        print("  concat -c copy failed → re-encoding (uniform tbn)")
        run_ffmpeg_atomic(output=timeline, args=[
            "-f", "concat", "-safe", "0", "-i", str(concat_txt),
            "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k"])

    out_name = args.output or edl.get("output") or "final_raw.mp4"
    out = job_dir / out_name
    if vo or bed:
        loudnorm = bool((edl.get("audio") or {}).get("loudnorm", True))
        if bed:
            under = ((edl.get("audio") or {}).get("bed") or {}).get(
                "under_voice_db", _bed_level.FLAT_BED_UNDER_VOICE_DB)
            if isinstance(under, bool) or not isinstance(under, (int, float)):
                die(f"audio.bed.under_voice_db must be a number of dB, got {under!r}")
            bed = (bed[0], bed_level_gain(timeline, vo, bed, from_beats, float(under)))
        mux_audio(timeline, out, vo, bed, from_beats, loudnorm=loudnorm)
    elif from_beats:
        shutil.copy2(timeline, out)
    else:
        # video-only timeline (audio comes later, e.g. compose_render retrofit mux)
        shutil.copy2(timeline, out)

    # ── the load-bearing side effects: beat boundaries + role log ──────────
    write_declaration(
        job_dir, rows, total, str(out.relative_to(job_dir)),
        duration_seconds=time.perf_counter() - t0,
        output_sha256=_sha256(out),
        generated_tts=generated_tts_source(job_dir, vo[0]) if vo and not from_beats else None,
        from_beats=from_beats,
    )

    final_dur = ffprobe_duration(out)
    print(f"\n[assemble] {len(rows)} beats → {out} ({final_dur:.2f}s)")
    print(f"▶ WATCH → file://{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
