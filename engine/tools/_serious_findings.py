"""Which end-of-render findings are serious enough to tell the agent.

The full review (``review_output --mode full``) records everything it sees in
its report (the end-of-render review keeps its own copy in its invocation
folder). Almost all of it stays there. This module picks out the
few problems that make a draft unfit to present, and prefers being right over
being complete.

Trust rules:

- A deterministic local check may report only when that specific check
  completed and positively shows the problem.
- A model-derived finding needs a successful, house-billed model response for
  these exact bytes (``report["model_evidence"]["trusted"]``), plus whatever
  local confirmation its rule asks for.

Serious problems, one per kind (each tagged with its evidence: "local" and
the check behind it, or "model"):

- ``placeholder_text``: an unmistakable template token (a bracketed slot such
  as "[TITLE HERE]", a ``{{field}}``, or lorem ipsum) in the text the render
  actually drew (its typed overlays and captions, as logged at render time),
  or in a trusted model text finding. Ordinary copy never matches, and text
  shown on purpose (marked intentional by the review, or declared in the
  script's ``on_screen_text``) is never told.
- ``narration_missing``: the script has spoken lines and the render is silent
  or has no sound track (local signal); or, with a trusted model answer, no
  voice is heard although other audio is present, or a sustained unintended
  gap the review classed as severe.
- ``narration_unintelligible``: a sustained stretch the review classed as
  severe (trusted model answer).
- ``narration_cut_off``: the render's own last caption word ends after the
  video does; without it, a trusted model finding at the very end plus a
  voice track too long to fit. Never for a declared seamless loop.
- ``black_picture`` / ``frozen_picture``: a trusted model candidate the review
  confirmed in the original pixels (see review_output).
- ``caption_covers_face`` / ``overlay_covers_face`` / ``face_clipped``: at
  least three consecutive delivery-safety samples (about a second).
- ``captions_missing``: the promise requires captions and the render turned
  them off.
- ``wrong_aspect`` / ``wrong_length``: against a structured ``promise.json``.

Known limits (left out rather than risk false alarms): faces covered by
authored (TSX) overlays, captions missing from bespoke/episode renders,
sustained black inside a single source shot.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import log

RENDER_TOOLS = {"compose_render.py", "remotion_render.py"}

# The job files a review reads to know what was intended and when (script,
# promise, caption timing, beat plan, mix metadata, the render manifest, the
# run log). ``_render_completion`` copies them after the render has written
# its own completion metadata and before the review starts; the review child
# reads only that copy, so edits made while it runs cannot change what is
# judged.
INTENT_FILES = (
    "script.json", "promise.json", "style_directives.json", "transcript.json",
    "chunk_boundaries.json", "beat_spec.json", "company.json", "edl.json",
    "render-manifest.json", "audio/bed_meta.json", "run.log.jsonl",
)
# The run-log events a review reads: renders, the assembly, the music mix,
# the voice track, and the roles generation tools declared. The review's copy
# of the run log keeps only these tools' events.
INTENT_LOG_TOOLS = frozenset({
    "compose_render.py", "remotion_render.py", "assemble.py", "score_bed.py",
    "synth_voice.py", "mint_image.py", "mint_video.py", "cast_avatar.py",
    "perform_avatar.py", "gen_broll.py", "generate_image.py", "seedance.py",
})
INTENT_LOG_MARKERS = tuple(
    marker for tool in sorted(INTENT_LOG_TOOLS)
    for marker in (f'"tool": "{tool}"'.encode(), f'"tool":"{tool}"'.encode())
)
_intent: tuple[str, Path] | None = None


def pin_intent(job: Path, snapshot: Path) -> None:
    """Read this job's intent files from ``snapshot`` from now on."""
    global _intent
    _intent = (str(Path(job).resolve()), Path(snapshot))


def is_pinned(job: Path) -> bool:
    return _intent is not None and _intent[0] == str(Path(job).resolve())


def intent_path(job: Path, name: str) -> Path:
    """Where to read one of the job's intent files (the snapshot, if pinned)."""
    if name in INTENT_FILES and is_pinned(job):
        return _intent[1] / name
    return Path(job) / name


def read_events(job: Path) -> list[dict]:
    """The job's run log (the published snapshot of it, if pinned)."""
    if not is_pinned(job):
        return log.read_events(job)
    events = []
    try:
        lines = intent_path(job, "run.log.jsonl").read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return []
    for line in lines:
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    return events

# ---------------------------------------------------------------------------
# Small readers
# ---------------------------------------------------------------------------


def _json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return None


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _clock(seconds: float | None) -> str:
    seconds = max(0.0, float(seconds or 0.0))
    whole = int(seconds)
    return f"{whole // 60}:{whole % 60:02d}"


def _span(start: float | None, end: float | None) -> str:
    if start is None:
        return ""
    if end is None or _clock(end) == _clock(start):
        return f" at {_clock(start)}"
    return f" from {_clock(start)} to {_clock(end)}"


def required_narration(job: Path) -> bool:
    """The job declared words that must be heard (script dialogue/narration)."""
    script = _dict(_json(intent_path(job, "script.json")))
    audio = _dict(_dict(_json(intent_path(job, "promise.json"))).get("audio"))
    if script.get("narration_required") is True or audio.get("narration_required") is True:
        return True
    chunks = script.get("chunks")
    records = [script, *(chunks if isinstance(chunks, list) else [])]
    return any(
        isinstance(record, dict) and (
            any(isinstance(record.get(key), str) and bool(record[key].strip())
                for key in ("dialogue", "narration"))
            or (record.get("kind") == "narration" and isinstance(record.get("text"), str)
                and bool(record["text"].strip()))
        )
        for record in records
    )


# ---------------------------------------------------------------------------
# The render the review looked at
# ---------------------------------------------------------------------------

# Facts fields a render logs on ``render_started`` (and hands to the review).
FACT_FIELDS = (
    "show_captions", "pre_roll", "rendered_overlays", "rendered_caption_style",
    "job_overlays_tsx", "video_transform", "last_spoken_word", "caption_text",
)

_pinned: tuple[str, dict] | None = None
MAX_CAPTION_TEXT = 4000


def caption_facts(words: Any) -> dict:
    """What a render's captions will draw, from the transcript words it uses.

    ``last_spoken_word`` is the last real word and when it ends (sound tags such
    as "[music]" and spacing tokens are not speech); ``caption_text`` is the
    drawn text, capped.
    """
    spoken: list[tuple[str, float | None]] = []
    for word in words if isinstance(words, list) else []:
        if not isinstance(word, dict):
            continue
        text = str(word.get("word") or word.get("text") or "").strip()
        if not text or word.get("type") in {"spacing", "audio_event"}:
            continue
        if re.fullmatch(r"[\[(].*[\])]", text) or not re.search(r"\w", text):
            continue
        spoken.append((text, _num(word.get("end"))))
    facts: dict = {}
    if spoken:
        facts["caption_text"] = " ".join(text for text, _end in spoken)[:MAX_CAPTION_TEXT]
        text, end = spoken[-1]
        if end is not None:
            facts["last_spoken_word"] = {"word": text, "end_sec": end}
    return facts


def pin_render_facts(job: Path, facts: dict) -> None:
    """Make ``render_facts(job)`` return the facts captured at publication.

    Used by the review child so a concurrent render of the same job cannot
    change which render is described.
    """
    global _pinned
    _pinned = (str(Path(job).resolve()), dict(facts))


def facts_pinned(job: Path) -> bool:
    return _pinned is not None and _pinned[0] == str(Path(job).resolve())


def render_facts(job: Path, events: list[dict] | None = None) -> dict:
    """Facts about the latest completed render of ``job``.

    Pinned facts win (see ``pin_render_facts``). Otherwise they come from the
    run log: ``compose_render`` and ``remotion_render`` log what they drew on
    ``render_started``. Older logs lack some fields; a missing field is
    unknown.
    """
    if _pinned is not None and events is None and _pinned[0] == str(Path(job).resolve()):
        return dict(_pinned[1])
    events = read_events(job) if events is None else events
    started: dict | None = None
    completed: tuple[dict, dict] | None = None
    for event in events:
        if event.get("tool") not in RENDER_TOOLS:
            continue
        if event.get("event") == "render_started":
            started = event
        elif event.get("event") == "render_completed" and started is not None:
            completed = (started, event)
            started = None
        elif event.get("event") == "render_failed":
            started = None
    if completed is None:
        return {}
    start, done = completed
    facts: dict = {
        "tool": str(start.get("tool", "")).removesuffix(".py") or None,
        "mode": start.get("usage_role") or ("render" if start.get("tool") == "remotion_render.py" else None),
        "overlays_count": start.get("overlays") if isinstance(start.get("overlays"), int) else None,
        "output_sha256": done.get("output_sha256"),
    }
    for field in FACT_FIELDS:
        if field in start:
            facts[field] = start[field]
    if not isinstance(facts.get("show_captions"), bool):
        facts["show_captions"] = None
    facts["pre_roll"] = _num(facts.get("pre_roll")) or 0.0
    return facts


# ---------------------------------------------------------------------------
# Placeholder text
# ---------------------------------------------------------------------------

_PLACEHOLDER_NOUNS = (
    "title", "name", "headline", "subtitle", "subheading", "tagline", "text", "copy",
    "caption", "brand", "company", "product", "logo", "cta", "url", "link", "website",
    "handle", "username", "date", "price", "quote", "author", "image", "photo",
    "number", "email", "phone", "address", "location", "hook",
)
_NOUNS = "|".join(_PLACEHOLDER_NOUNS)
# Words that make "<word> <noun>" read as a fill-in: "[Your Name]",
# "[Company Name]", "[First Name]". Any other qualifier is copy: "[NEW
# PRODUCT]", "[FREE LINK]", "[Daily Quote]", "[My Website]".
_SLOT_QUALIFIERS = (
    "your", "company", "brand", "product", "business", "first", "last", "full",
    "user", "customer", "client",
)
_QUALIFIER = "|".join(_SLOT_QUALIFIERS)
# Bracket contents that read as a fill-in slot, and nothing else:
#   an instruction plus a slot noun: "[INSERT CTA]", "[insert logo here]";
#   a slot noun plus "here" / "goes here": "[title here]", "[Title goes here]";
#   a placeholder qualifier plus a slot noun: "[Your Name]", "[Company Name]";
#   "[placeholder]" or "[TK]".
# A bare noun ("[HOOK] → [STORY] → [CTA]") and call-to-action copy ("[Click
# here]", "Comment [here]", "[Sign up here]", "[Start Here]") do not.
_SLOT = re.compile(
    rf"^(?:insert|enter|add|put)\s+(?:(?:the|a|an)\s+)?(?:(?:{_QUALIFIER})\s+){{0,2}}"
    rf"(?:{_NOUNS})(?:\s+here)?$"
    rf"|^(?:(?:{_QUALIFIER})\s+){{0,2}}(?:{_NOUNS})\s+(?:goes\s+)?here$"
    rf"|^(?:{_QUALIFIER})\s+(?:(?:{_QUALIFIER})\s+)?(?:{_NOUNS})$"
    r"|^(?:placeholder|tk)$",
    re.IGNORECASE,
)
_BRACKETED = re.compile(r"\[([^\[\]\n]{1,40})\]")
_MUSTACHE = re.compile(r"\{\{\s*[^{}\n]{1,40}?\s*\}\}")
_LOREM = re.compile(r"\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b", re.IGNORECASE)


def placeholder_in(text: Any) -> str | None:
    """Return the template token in ``text``, or ``None``.

    Only unmistakable template tokens count: a bracketed fill-in slot
    ("[TITLE HERE]", "[Your Name]", "[INSERT CTA]"), a ``{{mustache}}``
    field, or lorem ipsum. Bracketed calls to action and labels ("[Click
    here]", "[FREE LINK]", "[HOOK]"), words such as TODO, TBD or XXX ("Build a
    TODO app"), and "Add your name here to join the waitlist" do not count.
    """
    if not isinstance(text, str) or not text.strip():
        return None
    for match in _BRACKETED.finditer(text):
        if _SLOT.search(" ".join(match.group(1).split())):
            return match.group(0)
    for pattern in (_MUSTACHE, _LOREM):
        match = pattern.search(text)
        if match:
            return match.group(0)
    return None


_OVERLAY_WHERE = {"hook": "opening title", "lower": "lower third", "url": "link banner"}


def _finding(kind: str, start: float | None, problem: str, evidence: str,
             check: str | None = None) -> dict:
    """``evidence`` is "local" (``check`` names the local check that must have
    completed) or "model" (needs a successful house-billed model answer)."""
    return {"kind": kind, "start_sec": start, "problem": problem,
            "evidence": evidence, "check": check}


def drawn_text(facts: dict) -> list[dict]:
    """The text the render logged as drawn: typed overlays and captions."""
    layers: list[dict] = []
    pre_roll = _num(facts.get("pre_roll")) or 0.0
    for overlay in facts.get("rendered_overlays") or []:
        if not isinstance(overlay, dict) or not isinstance(overlay.get("text"), str):
            continue
        start = _num(overlay.get("start"))
        layers.append({
            "text": overlay["text"],
            "where": _OVERLAY_WHERE.get(str(overlay.get("kind")), "on-screen text"),
            "start_sec": None if start is None else start + pre_roll,
        })
    if facts.get("show_captions") is True and isinstance(facts.get("caption_text"), str):
        layers.append({"text": facts["caption_text"], "where": "captions", "start_sec": None})
    return layers


def _quoted(detail: str) -> list[str]:
    return [a or b or c for a, b, c in re.findall(
        r"'([^'\n]{1,120})'|\"([^\"\n]{1,120})\"|[“‘]([^”’\n]{1,120})[”’]", detail)]


def _model_issues(report: dict, sections):
    review = _dict(report.get("final_review_observations"))
    if review.get("parse_error"):
        return
    for section in sections:
        issues = _dict(review.get(section)).get("issues")
        for issue in issues if isinstance(issues, list) else []:
            if isinstance(issue, dict):
                yield section, issue


def _issue_texts(issue: dict) -> list[str]:
    texts = [issue["text"]] if isinstance(issue.get("text"), str) else []
    texts.extend(_quoted(str(issue.get("detail") or "")))
    return texts


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


def _intended_texts(report: dict, job: Path) -> list[str]:
    """Text shown on purpose: text the model marked intentional (including
    observations a declared edit explains), and the on-screen text the job's
    script declares it shows (``script.json`` ``on_screen_text``)."""
    texts: list[str] = []
    for _section, issue in _model_issues(report, ("overlays", "captions", "visual_anomalies")):
        if issue.get("intentional") is True:
            texts.extend(_issue_texts(issue))
    declared = _dict(_json(intent_path(job, "script.json"))).get("on_screen_text")
    for item in declared if isinstance(declared, list) else []:
        text = item.get("text") if isinstance(item, dict) else item
        if isinstance(text, str):
            texts.append(text)
    return [_fold(text) for text in texts if text.strip()]


def _placeholder_findings(report: dict, job: Path, facts: dict, trusted: bool) -> list[dict]:
    intended = _intended_texts(report, job)

    def on_purpose(token: str) -> bool:
        token = _fold(token)
        return any(token in text for text in intended)

    hits: list[dict] = []
    for layer in drawn_text(facts):
        hit = placeholder_in(layer["text"])
        if hit and not on_purpose(hit):
            shown = " ".join(layer["text"].split())
            hits.append({"quote": shown if len(shown) <= 60 else hit, "where": layer["where"],
                         "start_sec": layer["start_sec"], "evidence": "local"})
    if trusted:
        for section, issue in _model_issues(report, ("overlays", "captions", "visual_anomalies")):
            if issue.get("intentional") is True:
                continue  # declared on purpose (e.g. a template shown as the subject)
            for text in _issue_texts(issue):
                hit = placeholder_in(text)
                if not hit or on_purpose(hit):
                    continue
                shown = " ".join(text.split())
                shown = shown if len(shown) <= 60 else hit
                start = _num(issue.get("start_sec"))
                same = next((h for h in hits if h["quote"].casefold() in shown.casefold()
                             or shown.casefold() in h["quote"].casefold()), None)
                if same is not None:
                    if same["start_sec"] is None:
                        same["start_sec"] = start
                else:
                    hits.append({"quote": shown, "start_sec": start, "evidence": "model",
                                 "where": "captions" if section == "captions" else "on-screen text"})
                break
    unique: list[dict] = []
    for hit in hits:
        if not any(hit["quote"].casefold() == other["quote"].casefold() for other in unique):
            unique.append(hit)
    if not unique:
        return []
    unique.sort(key=lambda h: (h["start_sec"] is None, h["start_sec"] or 0.0))
    first = unique[0]
    problem = (f"the {first['where']}{_span(first['start_sec'], None)} still shows "
               f"placeholder text \"{first['quote']}\"")
    others = [f"\"{h['quote']}\"{_span(h['start_sec'], None)}" for h in unique[1:3]]
    if others:
        problem += f" (also {', '.join(others)})"
    local = any(h["evidence"] == "local" for h in unique)
    return [_finding("placeholder_text", first["start_sec"], problem,
                     "local" if local else "model", "render_facts" if local else None)]


# ---------------------------------------------------------------------------
# Narration
# ---------------------------------------------------------------------------


def _media(report: dict, media: dict | None) -> dict:
    out = dict(media or {})
    source = _dict(_dict(report.get("perceptual_transport")).get("source"))
    canvas = _dict(_dict(report.get("delivery_safety")).get("canvas"))
    out.setdefault("duration_sec", _num(source.get("duration_sec")) or _num(report.get("duration_sec")))
    out.setdefault("width", _num(source.get("width")) or _num(canvas.get("width")))
    out.setdefault("height", _num(source.get("height")) or _num(canvas.get("height")))
    if "aspect" not in out:
        dar = _num(source.get("display_aspect_ratio"))
        if dar is None and out.get("width") and out.get("height"):
            dar = out["width"] / out["height"]
        out["aspect"] = dar
    return out


_CUT_WORDS = re.compile(
    r"cut(?:s|ting)? off|truncat|mid[- ]word|mid[- ]sentence|before (?:the|its) (?:last|final) word"
    r"|ends? (?:abruptly|mid)|last word (?:is )?(?:missing|cut|clipped)",
    re.IGNORECASE,
)


def _voice_track_seconds(job: Path) -> float | None:
    """Length of the job's latest engine-generated voice track, if any."""
    for event in reversed(read_events(job)):
        if event.get("tool") == "synth_voice.py" and event.get("event") == "tts_generated":
            evidence = _dict(_json(job / str(event.get("evidence_path") or "")))
            return _num(evidence.get("final_duration_sec"))
    return None


def _completed(report: dict, check: str) -> bool:
    """A sub-check the review explicitly recorded as completed."""
    return _dict(_dict(report.get("sub_checks")).get(check)).get("status") == "ok"


def _audio_evidence_complete(audio: dict) -> bool:
    fields = ("voice_band_collision_flags", "dead_air_flags", "clipping_or_dropout_flags",
              "bg_music_too_loud_flags", "engineer_flags")
    return (isinstance(audio.get("voice_present"), bool)
            and all(isinstance(audio.get(field), list) for field in fields))


def _narration_findings(report: dict, job: Path, facts: dict, media: dict,
                        trusted: bool) -> list[dict]:
    required = report.get("narration_required")
    if not isinstance(required, bool):
        required = required_narration(job)
    if not required:
        return []
    audio = _dict(report.get("audio_audit"))
    signal = _dict(audio.get("final_audio_signal"))
    if _completed(report, "audio_signal"):
        if signal.get("status") == "absent":
            return [_finding("narration_missing", None,
                             "the video has no sound track, but the script has spoken lines",
                             "local", "audio_signal")]
        if signal.get("status") == "silent":
            return [_finding("narration_missing", None,
                             "the video is silent, but the script has spoken lines",
                             "local", "audio_signal")]
    findings: list[dict] = []
    review_audio = _dict(_dict(report.get("final_review_observations")).get("audio"))
    if (trusted and signal.get("status") == "audible" and _audio_evidence_complete(review_audio)
            and review_audio.get("voice_present") is False):
        findings.append(_finding("narration_missing", None,
                                 "no voice can be heard, but the script has spoken lines", "model"))
    if trusted:
        # Sustained, unintended gaps the review already classed as severe.
        blocking = _dict(report.get("qa_evidence")).get("blocking_issues")
        for issue in blocking if isinstance(blocking, list) else []:
            if not isinstance(issue, dict) or issue.get("section") != "audio":
                continue
            start, end = _num(issue.get("start_sec")), _num(issue.get("end_sec"))
            if issue.get("kind") == "missing_required_narration":
                findings.append(_finding("narration_missing", start,
                                         f"the narration is missing{_span(start, end)}", "model"))
            elif issue.get("kind") == "unintelligible_required_narration":
                findings.append(_finding("narration_unintelligible", start,
                                         f"the narration cannot be understood{_span(start, end)}",
                                         "model"))

    duration = media.get("duration_sec")
    if duration is None or declares_loop(job):
        return findings  # a seamless loop runs its words across the seam on purpose
    pre_roll = _num(facts.get("pre_roll")) or 0.0
    last = _dict(facts.get("last_spoken_word"))
    word, end = last.get("word"), _num(last.get("end_sec"))
    if isinstance(word, str) and end is not None:
        # The render's own caption timings: deterministic.
        if end + pre_roll - duration > 0.15:
            findings.append(_finding(
                "narration_cut_off", duration,
                f"the narration is cut off at {_clock(duration)} before its last word "
                f"(\"{word.strip('.,!?;:')}\")", "local", "render_facts"))
        return findings
    if not trusted:
        return findings
    # No word timings: a trusted model finding at the very end, and only when
    # the job's own voice track is too long to fit the video.
    voice = _voice_track_seconds(job)
    if voice is None or voice + pre_roll - duration <= 0.15:
        return findings
    for _section, issue in _model_issues(report, ("audio",)):
        issue_end = _num(issue.get("end_sec"))
        text = f"{issue.get('kind', '')} {issue.get('detail', '')}"
        if (issue.get("intentional") is not True and issue_end is not None
                and issue_end >= duration - 1.0 and _CUT_WORDS.search(text)):
            findings.append(_finding("narration_cut_off", duration,
                                     f"the narration is cut off at {_clock(duration)} "
                                     "before its last word", "model"))
            break
    return findings


# ---------------------------------------------------------------------------
# Picture: black / frozen, faces, captions
# ---------------------------------------------------------------------------


def _picture_findings(report: dict, trusted: bool) -> list[dict]:
    if not trusted or not _completed(report, "visual_confirmation"):
        return []
    findings: list[dict] = []
    blocking = _dict(report.get("qa_evidence")).get("blocking_issues")
    for issue in blocking if isinstance(blocking, list) else []:
        if not isinstance(issue, dict) or issue.get("section") != "visual_anomalies":
            continue
        start, end = _num(issue.get("start_sec")), _num(issue.get("end_sec"))
        if issue.get("intentional") is not False:
            continue
        if issue.get("kind") == "unexpected_black":
            findings.append(_finding("black_picture", start,
                                     f"the picture goes black{_span(start, end)}", "model"))
        elif issue.get("kind") == "unexpected_freeze":
            findings.append(_finding("frozen_picture", start,
                                     f"the picture freezes{_span(start, end)}", "model"))
    return findings


def _runs(stamps: list[float], interval: float) -> list[tuple[float, float, int]]:
    runs: list[tuple[float, float, int]] = []
    for stamp in sorted(set(stamps)):
        if runs and stamp - runs[-1][1] <= interval * 1.5:
            first, _last, count = runs[-1]
            runs[-1] = (first, stamp, count + 1)
        else:
            runs.append((stamp, stamp, 1))
    return runs


SUSTAINED_SAMPLES = 3  # three 0.5s samples in a row: at least a second on screen
EDGE = 0.015


def _face_findings(report: dict, facts: dict) -> list[dict]:
    safety = _dict(report.get("delivery_safety"))
    if safety.get("status") not in ("PASS", "CONTENT_FAIL") or not _completed(report, "delivery_safety"):
        return []
    violations = safety.get("violations")
    if not isinstance(violations, list):
        return []
    interval = _num(safety.get("sampleIntervalSec")) or 0.5
    canvas = _dict(safety.get("canvas"))
    width = _num(canvas.get("width"))
    captions_drawn = (
        _dict(safety.get("captionContract")).get("enabled") is True
        and facts.get("show_captions") is True
    )
    # Typed-overlay geometry only proves a collision for overlays the render drew.
    overlays_drawn = safety.get("overlaySource") == "render"
    groups: dict[tuple[str, str], list[float]] = {}
    for item in violations:
        if not isinstance(item, dict):
            continue
        stamp = _num(item.get("timestampSec"))
        if stamp is None:
            continue
        kind = item.get("kind")
        if kind == "caption_face_collision" and captions_drawn:
            groups.setdefault(("caption", "captions"), []).append(stamp)
        elif kind == "overlay_face_collision" and overlays_drawn:
            where = _OVERLAY_WHERE.get(str(item.get("overlayKind")), "overlay")
            groups.setdefault(("overlay", where), []).append(stamp)
        elif kind == "face_clipped" and width:
            box = item.get("box")
            if not (isinstance(box, list) and len(box) == 4 and all(_num(v) is not None for v in box)):
                continue
            x, _y, w, _h = (float(v) for v in box)
            left, right = x <= width * EDGE, x + w >= width * (1 - EDGE)
            # Only a side edge counts, and only one: a face touching both sides
            # fills the frame (an extreme close-up), and a forehead or chin
            # cropped by the top or bottom edge is ordinary close-up framing.
            if left != right:
                groups.setdefault(("clipped", "left" if left else "right"), []).append(stamp)
    findings: list[dict] = []
    for (kind, where), stamps in sorted(groups.items()):
        for first, last, count in _runs(stamps, interval):
            if count < SUSTAINED_SAMPLES:
                continue
            start, end = max(0.0, first - interval / 2), last + interval / 2
            if kind == "caption":
                findings.append(_finding("caption_covers_face", start,
                                         f"the captions cover a face{_span(start, end)}",
                                         "local", "delivery_safety"))
            elif kind == "overlay":
                findings.append(_finding("overlay_covers_face", start,
                                         f"the {where} covers a face{_span(start, end)}",
                                         "local", "delivery_safety"))
            else:
                findings.append(_finding("face_clipped", start,
                                         f"a face is cut off by the {where} edge of the frame"
                                         f"{_span(start, end)}", "local", "delivery_safety"))
    return findings


def _promise(job: Path) -> dict:
    return _dict(_json(intent_path(job, "promise.json")))


def declares_loop(job: Path) -> bool:
    """The job declared a seamless loop (``promise.json`` ``"loop": true``)."""
    return _promise(job).get("loop") is True


def _caption_findings(job: Path, facts: dict) -> list[dict]:
    promise = _promise(job)
    captions = _dict(_dict(promise.get("delivery")).get("captions")) or _dict(promise.get("captions"))
    if captions.get("required") is not True:
        return []
    if facts.get("mode") in ("render", "retrofit") and facts.get("show_captions") is False:
        return [_finding("captions_missing", None,
                         "the video has no captions, but captions were planned",
                         "local", "render_facts")]
    return []


# ---------------------------------------------------------------------------
# Promise: aspect and length
# ---------------------------------------------------------------------------

_RATIO = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)\s*$")


def _ratio(value: Any) -> float | None:
    if isinstance(value, str):
        match = _RATIO.match(value)
        if match and float(match.group(2)) > 0:
            return float(match.group(1)) / float(match.group(2))
    if isinstance(value, dict):
        width, height = _num(value.get("width")), _num(value.get("height"))
        if width and height:
            return width / height
        return _ratio(value.get("aspect_ratio") or value.get("aspect"))
    return None


def _ratio_label(ratio: float) -> str:
    for label, value in (("9:16", 9 / 16), ("16:9", 16 / 9), ("1:1", 1.0), ("4:5", 0.8),
                         ("5:4", 1.25), ("4:3", 4 / 3), ("3:4", 0.75), ("21:9", 21 / 9)):
        if abs(ratio - value) / value <= 0.02:
            return label
    return f"{ratio:.2f}:1"


def declared_aspect(promise: dict) -> float | None:
    delivery = _dict(promise.get("delivery"))
    candidates = [
        delivery.get("aspect_ratio"), delivery.get("aspect"), delivery.get("canvas"),
        promise.get("aspect_ratio"), promise.get("aspect"), promise.get("canvas"),
    ]
    if isinstance(promise.get("format"), dict):
        candidates.append(promise["format"])
    ratios = [ratio for ratio in (_ratio(item) for item in candidates) if ratio]
    if not ratios or any(abs(ratio - ratios[0]) / ratios[0] > 0.02 for ratio in ratios):
        return None  # nothing declared, or the declarations disagree
    return ratios[0]


def declared_length(promise: dict) -> tuple[float, float] | None:
    """(minimum, maximum) seconds from the structured ``duration_sec`` target.

    Only the check_promise contract counts: ``duration_sec`` as
    ``{"target", "tolerance"}`` or ``{"min", "max"}`` (top level or under
    ``delivery``). Loose numbers such as ``duration_seconds: 1.2`` on a looping
    piece are too ambiguous to call a render the wrong length.
    """
    for container in (promise, _dict(promise.get("delivery"))):
        value = container.get("duration_sec")
        if not isinstance(value, dict):
            continue
        low, high = _num(value.get("min")), _num(value.get("max"))
        if low is not None and high is not None and 0 < low <= high:
            return low, high
        target, tolerance = _num(value.get("target")), _num(value.get("tolerance"))
        if target and target > 0:
            if tolerance is None or tolerance < 0:
                tolerance = max(3.0, target * 0.25)
            return max(0.0, target - tolerance), target + tolerance
    return None


def _length_label(low: float, high: float) -> str:
    if low <= 0:
        return f"at most {high:.0f}s"
    if high - low < 1:
        return f"{(low + high) / 2:.0f}s"
    return f"{low:.0f}–{high:.0f}s"


def _promise_findings(job: Path, media: dict) -> list[dict]:
    promise = _promise(job)
    findings: list[dict] = []
    aspect, planned = media.get("aspect"), declared_aspect(promise)
    if aspect and planned and abs(aspect - planned) / planned > 0.03:
        findings.append(_finding("wrong_aspect", None,
                                 f"the video is {_ratio_label(aspect)}, but "
                                 f"{_ratio_label(planned)} was planned", "local", "media"))
    duration, window = media.get("duration_sec"), declared_length(promise)
    if duration and window and not window[0] - 0.05 <= duration <= window[1] + 0.05:
        findings.append(_finding("wrong_length", None,
                                 f"the video runs {duration:.0f}s, but "
                                 f"{_length_label(*window)} was planned", "local", "media"))
    return findings


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def model_trusted(report: dict) -> bool:
    """A successful, house-billed model response for these exact bytes."""
    return _dict(report.get("model_evidence")).get("trusted") is True


def check_succeeded(report: dict, facts: dict, check: str | None) -> bool:
    """Did the local check behind a finding explicitly succeed?"""
    if check == "render_facts":
        # Captured by the render that produced exactly the reviewed bytes.
        sha256 = facts.get("output_sha256")
        return isinstance(sha256, str) and bool(sha256) and sha256 == report.get("final_sha256")
    if check == "media":
        # A completed probe of the reviewed bytes.
        source = _dict(_dict(report.get("perceptual_transport")).get("source"))
        return _num(source.get("duration_sec")) is not None or _completed(report, "delivery_safety")
    return isinstance(check, str) and _completed(report, check)


def supported(report: dict, facts: dict, findings: list[dict]) -> list[dict]:
    """The findings a successful review can stand behind: model-derived ones
    only with a trusted (house-billed) model answer, local ones only when
    their own check explicitly succeeded."""
    trusted = model_trusted(report)
    return [
        finding for finding in findings
        if (finding.get("evidence") == "model" and trusted)
        or (finding.get("evidence") == "local" and check_succeeded(report, facts, finding.get("check")))
    ]


def classify(
    report: dict,
    job: Path,
    *,
    facts: dict | None = None,
    media: dict | None = None,
    trust_model: bool | None = None,
) -> list[dict]:
    """Serious problems in one review report: one per kind, in timeline order.

    Each finding is ``{"kind", "start_sec", "problem"}`` where ``problem`` is
    a plain-words clause for the agent. ``trust_model`` overrides the report's
    own ``model_evidence`` (the offline evaluation uses it on old reports).
    Anything that fails here is simply not reported.
    """
    job = Path(job)
    facts = render_facts(job) if facts is None else facts
    media = _media(report, media)
    trusted = model_trusted(report) if trust_model is None else trust_model
    findings: list[dict] = []
    for produce in (
        lambda: _placeholder_findings(report, job, facts, trusted),
        lambda: _narration_findings(report, job, facts, media, trusted),
        lambda: _picture_findings(report, trusted),
        lambda: _face_findings(report, facts),
        lambda: _caption_findings(job, facts),
        lambda: _promise_findings(job, media),
    ):
        try:
            findings.extend(produce())
        except Exception:
            continue
    findings.sort(key=lambda f: (f.get("start_sec") is None, f.get("start_sec") or 0.0))
    one_per_kind: list[dict] = []
    for finding in findings:
        if all(finding["kind"] != kept["kind"] for kept in one_per_kind):
            one_per_kind.append(finding)
    return one_per_kind
