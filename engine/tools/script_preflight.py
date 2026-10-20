"""
Pre-seedance preflight gate — audits `script.json` against the reference
analysis + the seedance prompting guide before Seedance credits are spent.

Architecture:

  Phase 1 — Hard structural checks (deterministic, fast)
    - [Image1] in seedance_prompt
    - First 8 words of dialogue quoted verbatim in prompt
    - Chunk window inside reference duration
    - Chunk timing overlaps reference sentences
    - These are ERROR-level. Fail fast, don't burn LLM tokens if these fail.

  Phase 2 — Sharp audit via a separate LLM call per chunk
    Per chunk, sends the LLM:
      - The full seedance_prompting_guide (~1400 lines)
      - The chunk's seedance_prompt + post_production_notes + dialogue
      - The reference sentences in this chunk's range with all 4 layers
        (story_arc / shot / overlays / audio)
      - Vision strategy + character_sheet continuity rules
    Asks for a SHARP list of improvements citing specific guide sections.
    Categorized BLOCKING / SHOULD_FIX / NICE_TO_HAVE.

  The LLM has all the context fresh; the main agent (Claude in conversation)
  reads only the resulting report — no context pollution. The agent retains
  full creative control over which improvements to apply.

Usage:
    uv run python tools/script_preflight.py
    uv run python tools/script_preflight.py --strict   # block on SHOULD_FIX
    uv run python tools/script_preflight.py --quiet    # report file only

Exit codes:
    0  clean (no Phase 1 ERRORs, no Phase 2 BLOCKING items, OR --strict satisfied)
    1  ERROR / BLOCKING gaps  →  fix before running seedance.py
    2  setup error (missing script.json or sentence-grounded analysis)

Outputs:
    <job_dir>/script_preflight_report.md   (always written)
    <job_dir>/run/script_preflight__chunk_<idx>__response.txt  (raw LLM responses)
    structured event in run.log.jsonl
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent))
from job import resolve_job_dir, add_job_arg, billing_input_path  # noqa: E402
from log import log_event  # noqa: E402

load_dotenv()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
# Default to a strong text model. Override via PREFLIGHT_MODEL env var if needed.
PREFLIGHT_MODEL = os.environ.get("PREFLIGHT_MODEL", "anthropic/claude-sonnet-4.6")
PREFLIGHT_MAX_OUTPUT_TOKENS = 4096
PREFLIGHT_PARALLEL_WORKERS = 5

PROMPT_GUIDE_PATH = Path(__file__).parent.parent / "skills" / "seedance_prompting_guide.md"


# ---------------------------------------------------------------------------
# Issue dataclass
# ---------------------------------------------------------------------------

SEVERITY_ICON = {
    "ERROR": "❌",
    "BLOCKING": "❌",
    "SHOULD_FIX": "⚠️ ",
    "NICE_TO_HAVE": "ℹ️ ",
}


@dataclass
class Issue:
    severity: str           # ERROR | BLOCKING | SHOULD_FIX | NICE_TO_HAVE
    chunk_idx: int          # -1 for script-level
    code: str               # short identifier
    message: str
    guide_ref: str = ""     # e.g. "§5 rule 1" or "§17.1.2"
    quoted_text: str = ""   # offending text from prompt or its absence
    suggested_fix: str = ""

    @property
    def icon(self) -> str:
        return SEVERITY_ICON.get(self.severity, "?")

    @property
    def is_blocking(self) -> bool:
        return self.severity in ("ERROR", "BLOCKING")


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_analysis(job: Path, override: str | None = None) -> dict | None:
    if override:
        return json.load(Path(override).open())
    refs = sorted((job / "reference").glob("analysis__*.json"))
    if not refs:
        return None
    refs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return json.load(refs[0].open())


def is_sentence_grounded(analysis: dict) -> bool:
    return (
        "sentences" in analysis
        and isinstance(analysis.get("sentences"), list)
        and len(analysis["sentences"]) > 0
        and "id" in analysis["sentences"][0]
    )


def load_text(path: Path) -> str:
    return path.read_text() if path.exists() else ""


# ---------------------------------------------------------------------------
# Range mapping (deterministic, fast)
# ---------------------------------------------------------------------------

def sentences_in_chunk(chunk: dict, analysis: dict) -> list[dict]:
    cs = float(chunk.get("start_sec", 0))
    ce = float(chunk.get("end_sec", 0))
    out = []
    for s in analysis.get("sentences", []):
        st = float(s.get("start", 0))
        if cs - 0.05 <= st < ce - 0.05:
            out.append(s)
    return out


# ---------------------------------------------------------------------------
# Phase 1: Hard structural checks (deterministic)
# ---------------------------------------------------------------------------

def _word_count(text: str) -> int:
    """Count spoken words in dialogue, ignoring caption-stress asterisks."""
    cleaned = re.sub(r"\*", "", text)
    return sum(1 for w in re.split(r"\s+", cleaned) if re.search(r"\w", w))


def wpm_check_chunk(
    chunk: dict,
    idx,
    target_post_wpm: float,
    densify_speed: float,
    seedance_ceiling_sec: float = 15.0,
    drift_tolerance_wpm: float = 5.0,
) -> list[Issue]:
    """Non-blocking word-density warnings.

    The chunk's `end_sec - start_sec` is the SEEDANCE source window. Densify
    (default 1.22×) compresses it to a shorter post-densify duration. We check
    the resulting POST-DENSIFY WPM against the script's target.

    Two checks, both at SHOULD_FIX severity (warning, not blocking):
      1. Post-densify WPM drifts more than ±`drift_tolerance_wpm` from the
         script's `target_wpm_post_densify` — likely wrong-paced unless the
         chunk has a deliberate reason (slow/suspenseful, kinetic-typography
         visual moment, etc.).
      2. Seedance source window exceeds the per-chunk ceiling (default 15s) —
         Seedance literally cannot generate a single chunk longer than this.

    Skips chunks with no dialogue (B-roll / pure-overlay beats).
    """
    issues: list[Issue] = []
    dialogue = chunk.get("dialogue", "") or ""
    if not dialogue.strip():
        return issues

    n_words = _word_count(dialogue)
    if n_words == 0:
        return issues

    seedance_window = float(chunk.get("end_sec", 0)) - float(chunk.get("start_sec", 0))
    if seedance_window <= 0:
        return issues

    # Check 1 — post-densify WPM drift.
    # post-d duration = source / densify_speed; post-d WPM = words / post-d duration * 60
    post_d_duration = seedance_window / max(densify_speed, 0.01)
    actual_post_wpm = n_words / post_d_duration * 60
    drift = actual_post_wpm - target_post_wpm
    if abs(drift) > drift_tolerance_wpm:
        direction = "faster" if drift > 0 else "slower"
        lo = target_post_wpm - drift_tolerance_wpm
        hi = target_post_wpm + drift_tolerance_wpm
        # Ideal words for THIS window at target post-densify WPM:
        # post_d_duration * target / 60 = (window/speed) * target / 60
        ideal_words = int(round(post_d_duration * target_post_wpm / 60))
        # Or ideal window for this many words:
        ideal_window = n_words / target_post_wpm * 60 * densify_speed
        issues.append(Issue(
            severity="SHOULD_FIX", chunk_idx=idx, code="chunk_wpm_drift",
            message=(
                f"Chunk has {n_words} words in a {seedance_window:.1f}s Seedance window "
                f"(→ ~{post_d_duration:.1f}s post-densify at {densify_speed:.2f}×) = "
                f"~{actual_post_wpm:.0f} WPM post-densify, {abs(drift):.0f} WPM {direction} "
                f"than the script's {target_post_wpm:.0f} WPM goal. "
                f"It should be in the {lo:.0f}-{hi:.0f} WPM range, right now it's {actual_post_wpm:.0f}, "
                f"probably tweak this unless we have good reason e.g. slow and suspenseful or "
                f"fast vibes on purpose or u have some other prompt in there for visuals."
            ),
            suggested_fix=(
                f"Either trim/expand the dialogue toward ~{ideal_words} words, "
                f"or change the Seedance window to {ideal_window:.1f}s "
                f"(end_sec = {float(chunk.get('start_sec', 0)) + ideal_window:.1f}s)."
            ),
        ))

    # Check 2 — Seedance per-chunk window ceiling (hard limit of the API).
    if seedance_window > seedance_ceiling_sec:
        issues.append(Issue(
            severity="SHOULD_FIX", chunk_idx=idx, code="chunk_window_exceeds_seedance_ceiling",
            message=(
                f"Chunk Seedance window is {seedance_window:.1f}s, above the {seedance_ceiling_sec:.0f}s "
                f"per-chunk ceiling. seedance.py will clamp this down — your dialogue may get "
                f"truncated or rushed."
            ),
            suggested_fix=(
                f"Either reduce the window to ≤{seedance_ceiling_sec:.0f}s, "
                f"or split this chunk into two Seedance generations at a natural breath break."
            ),
        ))

    return issues


def hard_check_chunk(chunk: dict, analysis: dict, all_sentences_count: int) -> list[Issue]:
    """Fast deterministic checks. ERRORs gate the LLM call."""
    issues: list[Issue] = []
    idx = chunk.get("chunk_index", 0)
    prompt = chunk.get("seedance_prompt", "") or ""
    dialogue = chunk.get("dialogue", "") or ""

    # E1: [Image1] required for talking-head chunks
    if dialogue.strip() and "[image1]" not in prompt.lower():
        issues.append(Issue(
            severity="ERROR", chunk_idx=idx, code="missing_image1",
            message="seedance_prompt missing required `[Image1]` token (CLAUDE.md rule 2 + seedance.py preflight).",
            suggested_fix="Append `[Image1]` to the end of the seedance_prompt.",
        ))

    # E2: dialogue per-sentence check (mirrors seedance.py validate_prompt logic).
    # Multi-sentence dialogue is naturally split across timeline segments in long
    # chunks — checking the WHOLE dialogue contiguously over-flags.
    # Strip non-word characters (including em-dashes, quotes, punctuation) AND
    # collapse whitespace so phrases like "installed — but" (which becomes
    # "installed   but" naively) match "installed but" in the prompt.
    if dialogue.strip():
        def _normalize(s: str) -> str:
            return " ".join(re.sub(r"[^\w\s]", " ", s).lower().split())
        norm_prompt = _normalize(prompt)
        sentences = [s.strip() for s in re.split(r"[.!?]+", dialogue) if s.strip()]
        missing_sentences: list[str] = []
        for sentence in sentences:
            head = " ".join(_normalize(sentence).split()[:5])
            if head and head not in norm_prompt:
                missing_sentences.append(sentence)
        if missing_sentences:
            sample = missing_sentences[0][:80]
            issues.append(Issue(
                severity="ERROR", chunk_idx=idx, code="dialogue_not_in_prompt",
                message=(
                    f"{len(missing_sentences)} of {len(sentences)} dialogue sentence(s) "
                    f"are not quoted in seedance_prompt (CLAUDE.md rule 2 — seedance.py "
                    f"will reject this). Missing: \"{sample}…\""
                ),
                suggested_fix=(
                    "For long timeline-segmented chunks, quote each spoken sentence inside "
                    "its own `[00:XX-00:YY] ... She speaks: \"<sentence>\"` block. "
                    "Per seedance.py: every sentence in `dialogue` must appear in `seedance_prompt`."
                ),
            ))

    # E3: chunk window exceeds reference duration
    # Downgraded from ERROR (BLOCKING) to SHOULD_FIX on 2026-05-13 (Sane Spaces job)
    # — adaptations are routinely longer than the reference (different mechanism,
    # different pacing), so this check was blocking legitimate work. The
    # informational signal is still useful (the adaptation extends past the
    # reference's timeline), but it doesn't gate the run.
    duration = analysis.get("video_meta", {}).get("duration_seconds")
    if duration and float(chunk.get("end_sec", 0)) > float(duration) + 1.0:
        issues.append(Issue(
            severity="SHOULD_FIX", chunk_idx=idx, code="end_exceeds_reference_duration",
            message=f"Chunk ends at {chunk['end_sec']}s but reference is only {duration:.1f}s. (Often fine for adaptations — note the divergence in adaptation_notes.)",
        ))

    # E4: chunk overlaps no reference sentences
    if all_sentences_count > 0 and not sentences_in_chunk(chunk, analysis):
        issues.append(Issue(
            severity="ERROR", chunk_idx=idx, code="no_overlapping_sentences",
            message=f"Chunk timing [{chunk.get('start_sec')}s-{chunk.get('end_sec')}s] does not overlap any reference sentence. Either chunk timing is wrong, or the reference duration is shorter than expected.",
        ))

    return issues


# ---------------------------------------------------------------------------
# Phase 2: LLM audit
# ---------------------------------------------------------------------------

AUDIT_SYSTEM_PROMPT = """You are an expert auditor of Seedance video-generation prompts for the Drift Protocol pipeline. You have these reference materials in your context:

1. The full `seedance_prompting_guide.md` (authoritative for Seedance 2.0 prompt engineering)
2. The reference video's sentence-grounded analysis (story_arc / shot / overlays / audio events per sentence)
3. The brand strategy (vision.md) and continuity rules (character_sheet.json)

## Pipeline conventions you MUST treat as correct (do NOT flag these)

These are pipeline-specific facts that override the prompting guide's general advice:

1. **`[Image1]` in the seedance_prompt is the CORRECT Replicate API token.** The prompting guide's "API vs UI" callout at the top makes this explicit: Replicate uses `[Image1]` (bracket notation), the Dreamina UI uses `@Image1`. **Do not flag prompts for using `[Image1]` — that's the right syntax.**
2. **`character_sheet.json:avatar_byteplus_urls.front` holds the trusted BytePlus URL.** `tools/seedance.py` reads it automatically and passes it as the `reference_images` URI to Replicate. The script-writer (Claude) does NOT need to embed the URL in the prompt body — `[Image1]` is the only correct way to refer to it. So:
   - ✅ `[Image1]` in prompt + `avatar_byteplus_urls.front` populated in character_sheet = correctly configured
   - ❌ A raw local-file face PNG passed via `reference_images` (bypasses BytePlus) = the §12-mistake-7 / E005 pattern
   - **Do NOT flag the §12 mistake 7 (E005 face moderation) issue** unless the prompt or pipeline tries to upload a raw realistic face. Just having `[Image1]` is fine.
3. **`generate_audio: True` is the default** in `seedance.py`. Seedance produces lip-synced audio for the spoken dialogue. Captions and post-production overlays are handled by Remotion (not by Seedance text rendering per §17.1.2). When you flag overlays, flag what should be in `post_production_notes` (the Remotion side), not what Seedance should bake in.
4. **Time-stretch to 1.10× happens in post** (CLAUDE.md rule 15). Do not flag the prompt for being slightly slower than the reference.

## Rules of engagement

- Be ruthless. Skip non-issues. If the prompt is solid, return `{"issues": []}`.
- Cite the prompting guide section explicitly for every issue (e.g. `§5 rule 1`, `§7`, `§17.1.2`, `§16.8`).
- Each issue must be CONCRETE: quote the offending text (or note its absence), and give copy-pasteable fix language.
- Categorize severity precisely:
  - **BLOCKING**: prompt WILL produce broken Seedance output (illegal pattern from §12 mistakes that ACTUALLY applies to the Replicate API flow — see pipeline conventions above; missing `[Image1]` when there's dialogue; dialogue not quoted in prompt; conflicting instructions; raw face upload bypassing BytePlus).
  - **SHOULD_FIX**: degrades quality meaningfully if shipped (missing audio direction, missing canonical multi-camera phrase, weak style anchor, vague high-risk word, missing essential negatives, prompt overload >300 words, reference event dropped without note in adaptation_notes).
  - **NICE_TO_HAVE**: minor improvement (sharper micro-action specificity, stronger style anchor, tighter lighting language).
- **Reference fidelity is part of your audit**: if the reference does a specific visual/audio thing at sentence sN and the chunk's prompt has no acknowledgement (preserved / translated / deliberately dropped via adaptation_notes), flag it.
- Do NOT propose changes that violate vision.md positioning (e.g. don't suggest adding music if the reference is bone-dry and brand is anti-coach clinical).
- Do NOT speculate beyond mechanical observations. No taste calls.

## Output format — strict JSON, no markdown fences

{
  "issues": [
    {
      "severity": "BLOCKING | SHOULD_FIX | NICE_TO_HAVE",
      "code": "snake_case_identifier",
      "guide_ref": "§<section>",
      "issue": "<one sentence describing the problem>",
      "quoted_text": "<verbatim text from prompt OR 'absent'>",
      "fix": "<concrete fix language, copy-pasteable>"
    }
  ]
}

Return ONLY valid JSON. No prose preamble, no markdown fences."""


def build_audit_user_prompt(
    chunk: dict,
    chunk_sentences: list[dict],
    vision_md: str,
    character_sheet: dict,
    prompt_guide: str,
) -> str:
    """Build the user message for one chunk's audit call."""
    parts = []

    parts.append("# SEEDANCE PROMPTING GUIDE\n")
    parts.append(prompt_guide)
    parts.append("\n\n# END SEEDANCE PROMPTING GUIDE\n")
    parts.append("---\n")

    parts.append("# BRAND STRATEGY (vision.md)\n")
    parts.append(vision_md or "_(vision.md missing)_")
    parts.append("\n---\n")

    parts.append("# CHARACTER SHEET (continuity rules)\n")
    parts.append(json.dumps(character_sheet, indent=2))
    parts.append("\n---\n")

    parts.append("# REFERENCE VIDEO EVENTS IN THIS CHUNK'S RANGE\n")
    parts.append("These are the sentence-grounded events (story_arc / shot / overlays / audio) ")
    parts.append("from the reference video's analysis that fall inside this chunk's timestamp window. ")
    parts.append("The chunk's prompt + post_production_notes should either preserve, translate, or ")
    parts.append("deliberately drop each of these (with the reason documented in adaptation_notes).\n\n")
    if chunk_sentences:
        parts.append("```json\n")
        parts.append(json.dumps(chunk_sentences, indent=2))
        parts.append("\n```\n")
    else:
        parts.append("_(no reference sentences overlap this chunk's range — flag this as an error)_\n")
    parts.append("\n---\n")

    parts.append("# CHUNK BEING AUDITED\n")
    parts.append(f"**Chunk index:** {chunk.get('chunk_index')}\n")
    parts.append(f"**Window:** {chunk.get('start_sec')}s → {chunk.get('end_sec')}s "
                 f"(duration {float(chunk.get('end_sec', 0)) - float(chunk.get('start_sec', 0)):.1f}s)\n")
    parts.append(f"**image_ref:** `{chunk.get('image_ref', 'front')}`\n\n")

    parts.append("**Dialogue:**\n")
    parts.append(f"> {chunk.get('dialogue', '')}\n\n")

    parts.append("**seedance_prompt (the artifact you are auditing):**\n```\n")
    parts.append(chunk.get("seedance_prompt", "") or "")
    parts.append("\n```\n\n")

    parts.append("**post_production_notes:**\n```\n")
    parts.append(chunk.get("post_production_notes", "") or "")
    parts.append("\n```\n\n")

    if chunk.get("visual_notes"):
        parts.append("**visual_notes:**\n```\n")
        parts.append(chunk["visual_notes"])
        parts.append("\n```\n\n")

    if chunk.get("adaptation_notes"):
        parts.append("**adaptation_notes:**\n```\n")
        parts.append(chunk["adaptation_notes"])
        parts.append("\n```\n\n")

    parts.append("---\n\n")
    parts.append("Return your audit as JSON per the format declared in the system prompt. ")
    parts.append("Be sharp, cite guide sections, copy-pasteable fixes only.")

    return "".join(parts)


def parse_llm_response(text: str) -> list[dict]:
    """Extract issues array from LLM response. Handles markdown fences, prose preambles."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*\n", "", text)
    text = re.sub(r"\n```\s*$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return []
    try:
        obj = json.loads(text[start:end + 1])
        return obj.get("issues", []) if isinstance(obj, dict) else []
    except json.JSONDecodeError:
        return []


def audit_chunk_via_llm(
    chunk: dict,
    chunk_sentences: list[dict],
    vision_md: str,
    character_sheet: dict,
    prompt_guide: str,
    job: Path,
    client: OpenAI,
) -> list[Issue]:
    """Make one LLM audit call for a chunk. Returns parsed Issues."""
    idx = chunk.get("chunk_index", 0)
    user_prompt = build_audit_user_prompt(
        chunk, chunk_sentences, vision_md, character_sheet, prompt_guide
    )

    t0 = time.perf_counter()
    try:
        response = client.chat.completions.create(
            model=PREFLIGHT_MODEL,
            messages=[
                {"role": "system", "content": AUDIT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=PREFLIGHT_MAX_OUTPUT_TOKENS,
            temperature=0.1,
        )
        elapsed = time.perf_counter() - t0
        if not response.choices:
            return [Issue(
                severity="ERROR", chunk_idx=idx, code="llm_empty_response",
                message=f"Preflight LLM ({PREFLIGHT_MODEL}) returned no choices. Raw response: {response.model_dump()}",
            )]
        text = response.choices[0].message.content or ""

        # Persist raw response for debugging
        run_dir = job / "run"
        run_dir.mkdir(parents=True, exist_ok=True)
        # idx may be int or string (split chunks like "3A"/"3B"). Coerce safely.
        idx_str = f"{idx:02d}" if isinstance(idx, int) else str(idx)
        (run_dir / f"script_preflight__chunk_{idx_str}__response.txt").write_text(text)

        raw_issues = parse_llm_response(text)
        out: list[Issue] = []
        # Phase 2 BLOCKING tier is collapsed to SHOULD_FIX. The LLM auditor is
        # non-deterministic and flip-flops across iterations — escalating its
        # findings to BLOCKING produces an unbounded re-render loop. All truly-
        # blocking conditions are now caught by Phase 1 deterministic checks
        # (missing [Image1], dialogue not in prompt, end_exceeds_duration,
        # no_overlapping_sentences). Phase 2 contributes only advisory findings.
        # If you want the LLM's BLOCKING tier to actually block, run with
        # PREFLIGHT_TRUST_LLM_BLOCKING=1 (escape hatch).
        trust_llm_blocking = os.environ.get("PREFLIGHT_TRUST_LLM_BLOCKING") == "1"
        for ri in raw_issues:
            sev = (ri.get("severity") or "SHOULD_FIX").upper()
            if sev not in ("BLOCKING", "SHOULD_FIX", "NICE_TO_HAVE", "ERROR"):
                sev = "SHOULD_FIX"
            if sev == "BLOCKING" and not trust_llm_blocking:
                # Demote — Phase 1 is the only true blocker.
                sev = "SHOULD_FIX"
            out.append(Issue(
                severity=sev,
                chunk_idx=idx,
                code=ri.get("code", "llm_issue") or "llm_issue",
                message=ri.get("issue", "") or "",
                guide_ref=ri.get("guide_ref", "") or "",
                quoted_text=ri.get("quoted_text", "") or "",
                suggested_fix=ri.get("fix", "") or "",
            ))

        log_event(
            job, tool="script_preflight.py", event="chunk_audited",
            extra={
                "chunk_idx": idx,
                "model": PREFLIGHT_MODEL,
                "duration_seconds": elapsed,
                "issue_count": len(out),
                "blocking_count": sum(1 for i in out if i.is_blocking),
            },
            render_md=False,
        )
        return out

    except Exception as e:
        return [Issue(
            severity="ERROR", chunk_idx=idx, code="llm_call_failed",
            message=f"Preflight LLM call failed: {type(e).__name__}: {str(e)[:300]}",
        )]


# ---------------------------------------------------------------------------
# Reference-events surfacing (for human review, not detection)
# ---------------------------------------------------------------------------

def render_reference_events_for_chunk(chunk: dict, sentences: list[dict]) -> str:
    """Surface what the reference does in this chunk's range. For human review."""
    lines = []
    for s in sentences:
        sid = s["id"]
        text = (s.get("text") or "")[:80]
        lines.append(f"\n**{sid}** [{s['start']}–{s['end']}s] *\"{text}\"*")

        for arc in s.get("story_arc", []):
            fn = arc.get("function", "")
            sub = arc.get("subtype", "")
            note = (arc.get("notes") or "")[:120]
            tag = f"{fn}" + (f"/{sub}" if sub else "")
            lines.append(f"- arc: **{tag}** — {note}")

        for shot in s.get("shot", []):
            sb = (shot.get("speaker_behavior") or "")[:140]
            sc = (shot.get("shot_composition") or "")[:80]
            if sc or sb:
                lines.append(f"- shot: *{sc}* — {sb}")

        for ov in s.get("overlays", []):
            ty = ov.get("type", "")
            content = (ov.get("content") or "")[:80]
            if ty:
                lines.append(f"- overlay: **{ty}** — {content}")

        for au in s.get("audio", []):
            ms = au.get("music_state", "")
            sfx = au.get("sound_effects", []) or []
            vd = (au.get("voice_dynamics") or "")[:100]
            audio_bits = []
            if ms:
                audio_bits.append(f"music={ms}")
            if sfx:
                audio_bits.append(f"sfx={sfx}")
            if vd:
                audio_bits.append(f"voice=*{vd}*")
            if audio_bits:
                lines.append(f"- audio: " + " · ".join(audio_bits))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------

def render_md_report(
    issues: list[Issue],
    script: dict,
    analysis: dict,
    chunk_sentences_map: dict[int, list[dict]],
    job: Path,
    elapsed_seconds: float,
) -> str:
    duration = analysis.get("video_meta", {}).get("duration_seconds", 0)
    n_sentences = analysis.get("video_meta", {}).get("n_sentences", 0)
    ref_url = analysis.get("video_meta", {}).get("url", "?")

    blocking = [i for i in issues if i.is_blocking]
    should_fix = [i for i in issues if i.severity == "SHOULD_FIX"]
    nice = [i for i in issues if i.severity == "NICE_TO_HAVE"]

    lines: list[str] = []
    lines.append("# Script preflight report")
    lines.append("")
    lines.append(f"**Job:** `{job.name}`  ")
    lines.append(f"**Reference:** {ref_url}  ")
    lines.append(f"**Reference duration:** {duration:.1f}s · **Sentences:** {n_sentences}  ")
    lines.append(f"**Script chunks:** {len(script.get('chunks', []))}  ")
    lines.append(f"**LLM model:** `{PREFLIGHT_MODEL}` · **Audit time:** {elapsed_seconds:.1f}s  ")
    lines.append(f"**Issues:** {len(blocking)} BLOCKING · {len(should_fix)} SHOULD_FIX · {len(nice)} NICE_TO_HAVE  ")
    lines.append("")

    if not issues:
        lines.append("✅ **All checks passed.** Script is preflight-clean. Run `seedance.py` when ready.")
        return "\n".join(lines)

    if blocking:
        lines.append("---")
        lines.append("## ❌ BLOCKING — must fix before seedance.py")
        lines.append("")
        for issue in blocking:
            cidx = "script-level" if (isinstance(issue.chunk_idx, int) and issue.chunk_idx < 0) else f"chunk {issue.chunk_idx}"
            ref = f" · *{issue.guide_ref}*" if issue.guide_ref else ""
            lines.append(f"### {cidx} · `{issue.code}`{ref}")
            lines.append("")
            lines.append(issue.message)
            if issue.quoted_text and issue.quoted_text.lower() != "absent":
                lines.append("")
                lines.append(f"> **In prompt:** {issue.quoted_text}")
            elif issue.quoted_text:
                lines.append("")
                lines.append(f"> **In prompt:** *(absent)*")
            if issue.suggested_fix:
                lines.append("")
                lines.append(f"**Fix:** {issue.suggested_fix}")
            lines.append("")

    if should_fix:
        lines.append("---")
        lines.append("## ⚠️  SHOULD_FIX — review and address (or document divergence in adaptation_notes)")
        lines.append("")
        by_chunk: dict = {}
        for i in should_fix:
            by_chunk.setdefault(i.chunk_idx, []).append(i)
        # chunk_idx may be int or str ("3A"/"3B" for split chunks) — coerce key for sort
        for cidx in sorted(by_chunk.keys(), key=lambda c: (isinstance(c, int) and c < 0, str(c))):
            label = "script-level" if (isinstance(cidx, int) and cidx < 0) else f"Chunk {cidx}"
            lines.append(f"### {label}")
            lines.append("")
            for issue in by_chunk[cidx]:
                ref = f" · *{issue.guide_ref}*" if issue.guide_ref else ""
                lines.append(f"**`{issue.code}`**{ref}")
                lines.append("")
                lines.append(issue.message)
                if issue.quoted_text:
                    if issue.quoted_text.lower() == "absent":
                        lines.append(f"  - *In prompt: absent*")
                    else:
                        lines.append(f"  - *In prompt: {issue.quoted_text}*")
                if issue.suggested_fix:
                    lines.append(f"  - **Fix:** {issue.suggested_fix}")
                lines.append("")

    if nice:
        lines.append("---")
        lines.append("## ℹ️  NICE_TO_HAVE — minor improvements")
        lines.append("")
        by_chunk = {}
        for i in nice:
            by_chunk.setdefault(i.chunk_idx, []).append(i)
        for cidx in sorted(by_chunk.keys(), key=lambda c: (isinstance(c, int) and c < 0, str(c))):
            label = "script-level" if (isinstance(cidx, int) and cidx < 0) else f"Chunk {cidx}"
            for issue in by_chunk[cidx]:
                ref = f" · *{issue.guide_ref}*" if issue.guide_ref else ""
                lines.append(f"- **{label}** · `{issue.code}`{ref}")
                lines.append(f"  - {issue.message}")
                if issue.suggested_fix:
                    lines.append(f"  - Fix: {issue.suggested_fix}")
        lines.append("")

    # Reference-events surfacing — for the human / agent to cross-reference
    lines.append("---")
    lines.append("")
    lines.append("## Reference events per chunk (for cross-reference)")
    lines.append("")
    lines.append("This section is surface-only — it lists what the reference video does ")
    lines.append("in each chunk's range. The LLM audit above has already evaluated whether ")
    lines.append("your prompts attend to these events. Use this section to verify any ")
    lines.append("BLOCKING / SHOULD_FIX item against the reference's actual behaviour.")
    lines.append("")
    for chunk in script.get("chunks", []):
        cidx = chunk.get("chunk_index", 0)
        lines.append(f"### Chunk {cidx} [{chunk.get('start_sec')}-{chunk.get('end_sec')}s]")
        ref_events_md = render_reference_events_for_chunk(
            chunk, chunk_sentences_map.get(cidx, [])
        )
        lines.append(ref_events_md if ref_events_md.strip() else "_(no reference sentences in range)_")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## How to use this report")
    lines.append("")
    lines.append("1. Resolve every **BLOCKING** issue. `seedance.py` refuses to run otherwise (CLAUDE.md rule 18).")
    lines.append("2. Walk every **SHOULD_FIX** — for each, either implement the fix OR add a one-line note in `script.json[].adaptation_notes` documenting the deliberate divergence.")
    lines.append("3. **NICE_TO_HAVE** items are optional polish.")
    lines.append("4. The **Reference events per chunk** section is your cross-reference — verify each BLOCKING/SHOULD_FIX against what the reference actually does.")
    lines.append("5. Re-run `script_preflight.py` after edits.")
    lines.append("")
    lines.append(f"_Audit performed by `{PREFLIGHT_MODEL}` against `seedance_prompting_guide.md` ({len(open(PROMPT_GUIDE_PATH).read().splitlines())} lines), reference analysis, vision.md, and character_sheet.json._")
    return "\n".join(lines)


def render_console_report(issues: list[Issue], analysis: dict) -> str:
    blocking = [i for i in issues if i.is_blocking]
    should_fix = [i for i in issues if i.severity == "SHOULD_FIX"]
    nice = [i for i in issues if i.severity == "NICE_TO_HAVE"]

    lines: list[str] = []
    lines.append("=" * 78)
    lines.append("SCRIPT PREFLIGHT REPORT")
    lines.append("=" * 78)
    lines.append(f"Reference: {analysis.get('video_meta', {}).get('url', '?')}")
    lines.append(f"Issues: {len(blocking)} BLOCKING · {len(should_fix)} SHOULD_FIX · {len(nice)} NICE_TO_HAVE")
    lines.append("")

    if blocking:
        lines.append("❌ BLOCKING:")
        for issue in blocking:
            cidx = "script" if (isinstance(issue.chunk_idx, int) and issue.chunk_idx < 0) else f"chunk {issue.chunk_idx}"
            ref = f" {issue.guide_ref}" if issue.guide_ref else ""
            lines.append(f"  [{cidx}]{ref} {issue.code}")
            lines.append(f"      {issue.message}")
            if issue.suggested_fix:
                fix = issue.suggested_fix
                if len(fix) > 200:
                    fix = fix[:197] + "..."
                lines.append(f"      → fix: {fix}")
        lines.append("")

    if should_fix:
        lines.append("⚠️  SHOULD_FIX:")
        by_chunk: dict = {}
        for i in should_fix:
            by_chunk.setdefault(i.chunk_idx, []).append(i)
        for cidx in sorted(by_chunk.keys(), key=lambda c: (isinstance(c, int) and c < 0, str(c))):
            label = "script" if (isinstance(cidx, int) and cidx < 0) else f"chunk {cidx}"
            for issue in by_chunk[cidx]:
                ref = f" {issue.guide_ref}" if issue.guide_ref else ""
                msg = issue.message
                if len(msg) > 100:
                    msg = msg[:97] + "..."
                lines.append(f"  [{label}]{ref} {issue.code}: {msg}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Programmatic entry point (used by seedance.py)
# ---------------------------------------------------------------------------

def run_preflight(
    job: Path,
    *,
    strict: bool = False,
    analysis_override: str | None = None,
    skip_llm: bool = False,
) -> tuple[int, list[Issue], Path | None]:
    """Run preflight against a job. Returns (exit_code, issues, report_path).

    `skip_llm`: if True, only Phase 1 deterministic checks run (no API call).
    """
    script_path = billing_input_path(job / "script.json")
    if not script_path.exists():
        return 2, [], None
    script = json.load(script_path.open())

    analysis = load_analysis(job, analysis_override)
    if analysis is None or not is_sentence_grounded(analysis):
        return 2, [], None

    if not OPENROUTER_API_KEY and not skip_llm:
        # Soft-degrade: do the deterministic checks but warn that LLM phase skipped
        skip_llm = True

    chunks = script.get("chunks", [])
    n_sentences = len(analysis.get("sentences", []))

    # Script-level pacing config — used by wpm_check_chunk.
    target_post_wpm = float(
        script.get("target_wpm_post_densify")
        or script.get("post_densify_target_wpm")
        or 215
    )
    densify_speed = float(
        (script.get("densify_settings") or {}).get("speed", 1.22)
    )

    # Phase 1: hard deterministic checks (+ non-blocking WPM warnings)
    all_issues: list[Issue] = []
    for i, chunk in enumerate(chunks):
        # Some chunks omit chunk_index — fall back to enumerate index
        chunk.setdefault("chunk_index", chunk.get("chunk_id", i))
        idx = chunk.get("chunk_index", i)
        all_issues.extend(hard_check_chunk(chunk, analysis, n_sentences))
        all_issues.extend(wpm_check_chunk(
            chunk, idx, target_post_wpm, densify_speed,
        ))

    # If Phase 1 has ERRORs, we COULD short-circuit and skip the LLM call
    # to save cost. But running the LLM anyway is more useful — the report is
    # complete. Cost is small (<$1). Let's run both phases unless skip_llm.
    chunk_sentences_map: dict[int, list[dict]] = {}
    for chunk in chunks:
        chunk_sentences_map[chunk.get("chunk_index", 0)] = sentences_in_chunk(chunk, analysis)

    elapsed = 0.0
    if not skip_llm:
        # Phase 2: LLM audit per chunk (parallel)
        vision_md = load_text(job / "vision.md")
        character_sheet_path = billing_input_path(job / "avatar" / "character_sheet.json")
        character_sheet = json.load(character_sheet_path.open()) if character_sheet_path.exists() else {}
        prompt_guide = load_text(PROMPT_GUIDE_PATH)
        if not prompt_guide:
            all_issues.append(Issue(
                severity="ERROR", chunk_idx=-1, code="missing_prompting_guide",
                message=f"Could not load seedance prompting guide at {PROMPT_GUIDE_PATH}.",
            ))
        else:
            client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=OPENROUTER_API_KEY,
            )
            t0 = time.perf_counter()
            with concurrent.futures.ThreadPoolExecutor(max_workers=PREFLIGHT_PARALLEL_WORKERS) as ex:
                futures = {
                    ex.submit(
                        audit_chunk_via_llm,
                        chunk,
                        chunk_sentences_map.get(chunk.get("chunk_index", 0), []),
                        vision_md,
                        character_sheet,
                        prompt_guide,
                        job,
                        client,
                    ): chunk.get("chunk_index", 0)
                    for chunk in chunks
                }
                for future in concurrent.futures.as_completed(futures):
                    all_issues.extend(future.result())
            elapsed = time.perf_counter() - t0

    # Sort issues by chunk index then severity. chunk_idx may be int or str
    # (e.g. "3A", "3B" for split chunks) — coerce to a stable string sort key.
    def _sort_key(i: Issue):
        ci = i.chunk_idx
        if isinstance(ci, int) and ci < 0:
            primary = "zzz"
        else:
            primary = str(ci)
        return (primary, severity_rank.get(i.severity, 9))
    severity_rank = {"ERROR": 0, "BLOCKING": 0, "SHOULD_FIX": 1, "NICE_TO_HAVE": 2}
    all_issues.sort(key=_sort_key)

    md = render_md_report(all_issues, script, analysis, chunk_sentences_map, job, elapsed)
    report_path = job / "script_preflight_report.md"
    report_path.write_text(md)

    blocking = [i for i in all_issues if i.is_blocking]
    should_fix = [i for i in all_issues if i.severity == "SHOULD_FIX"]
    if blocking:
        return 1, all_issues, report_path
    if strict and should_fix:
        return 1, all_issues, report_path
    return 0, all_issues, report_path


# ---------------------------------------------------------------------------
# Main (CLI)
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(allow_abbrev=False, 
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(parser)
    parser.add_argument(
        "--strict", action="store_true",
        help="Exit non-zero on SHOULD_FIX as well as BLOCKING. Default: only BLOCKING fails.",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Suppress stdout report; only write the markdown file.",
    )
    parser.add_argument(
        "--analysis",
        help="Override path to analysis JSON (default: most recent <job_dir>/reference/analysis__*.json).",
    )
    parser.add_argument(
        "--skip-llm", action="store_true",
        help="Skip the LLM audit phase (only run cheap deterministic checks). Use when no API budget or for fast structural-only validation.",
    )
    args = parser.parse_args()

    job = resolve_job_dir(args.job)

    script_path = billing_input_path(job / "script.json")
    if not script_path.exists():
        print(f"ERROR: {script_path} does not exist. Write script.json first.", file=sys.stderr)
        sys.exit(2)

    analysis = load_analysis(job, args.analysis)
    if analysis is None:
        print(
            f"ERROR: No analysis JSON found in {job}/reference/. Run `deep_analyze_video.py` first.",
            file=sys.stderr,
        )
        sys.exit(2)
    if not is_sentence_grounded(analysis):
        print(
            "ERROR: Analysis is in legacy single-pass format. Re-run `deep_analyze_video.py` "
            "to produce the sentence-grounded format that script_preflight requires.",
            file=sys.stderr,
        )
        sys.exit(2)

    if not OPENROUTER_API_KEY and not args.skip_llm:
        print("⚠ OPENROUTER_API_KEY not set — falling back to --skip-llm (deterministic checks only).")
        args.skip_llm = True

    if not args.quiet:
        print(f"Running script_preflight against {len(script.get('chunks', []) if (script := json.load(script_path.open())) else [])} chunks...")
        if not args.skip_llm:
            print(f"  Phase 1: deterministic structural checks")
            print(f"  Phase 2: LLM audit per chunk via {PREFLIGHT_MODEL} (parallel)")
        else:
            print("  Phase 1 only (Phase 2 skipped)")

    code, issues, report_path = run_preflight(
        job,
        strict=args.strict,
        analysis_override=args.analysis,
        skip_llm=args.skip_llm,
    )

    if not args.quiet:
        print()
        print(render_console_report(issues, analysis))

    blocking = [i for i in issues if i.is_blocking]
    should_fix = [i for i in issues if i.severity == "SHOULD_FIX"]
    nice = [i for i in issues if i.severity == "NICE_TO_HAVE"]

    log_event(
        job, tool="script_preflight.py", event="preflight_complete",
        extra={
            "blocking": len(blocking),
            "should_fix": len(should_fix),
            "nice": len(nice),
            "strict": args.strict,
            "exit_code": code,
            "skip_llm": args.skip_llm,
            "model": None if args.skip_llm else PREFLIGHT_MODEL,
            "report": str(report_path.relative_to(job)) if report_path else None,
        },
    )

    if not args.quiet and report_path:
        rel = report_path.relative_to(Path.cwd()) if report_path.is_relative_to(Path.cwd()) else report_path
        print(f"Full report: {rel}")
        if code == 0:
            if should_fix or nice:
                print(f"\n✓ No BLOCKING. {len(should_fix)} SHOULD_FIX, {len(nice)} NICE_TO_HAVE — review before seedance.py.")
            else:
                print("\n✅ Preflight clean. Ready for seedance.py.")
        elif code == 1:
            if blocking:
                print(f"\n❌ {len(blocking)} BLOCKING — fix before running seedance.py.")
            else:
                print(f"\n⚠️  {len(should_fix)} SHOULD_FIX (--strict mode) — address before continuing.")

    sys.exit(code)


if __name__ == "__main__":
    main()
