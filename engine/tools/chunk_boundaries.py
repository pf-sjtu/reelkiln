"""
Step 8.5 (auto, runs inside remotion_render.py): Compute per-chunk timestamp
boundaries from script.json + transcript.json (PASS 2). Writes
<job_dir>/chunk_boundaries.json so per-job overlays.tsx files can anchor
Sequences to chunk indices instead of hardcoded seconds — making overlays
robust to re-densify / dialogue edits.

CLI form (for debugging / forced regeneration):

  uv run python tools/chunk_boundaries.py --job <id>
  uv run python tools/chunk_boundaries.py --job <id> --dry-run

Reads:  <job_dir>/script.json       (chunks[].dialogue, else chunks[].text)
        <job_dir>/transcript.json   (words[].{word|text, start, end})
Writes: <job_dir>/chunk_boundaries.json

The algorithm:
  for each chunk in script.json:
    1. Normalize the first N words of chunk.dialogue
    2. Slide a window over transcript.words (after the previous chunk's end)
       and find the best 3-of-N alignment
    3. start_sec = matched first-word's `start`
    4. Symmetric search from the right for end_sec
    5. If no plausible match (TTS dropped quiet onset, e.g. "First,"):
       - start_sec = previous chunk's end + tiny gap
       - flag anchor_method = "fallback_previous_end" with a reason
    6. Last chunk's end falls back to transcript's final word.end + 0.05s

The output (chunk_boundaries.json) is what per-job overlays.tsx fetches via
staticFile() to drive Sequence timing. See overlay_authoring_guide.md §11 for
the useChunkBoundaries helper that consumes it.

Why this exists: overlay anchor times hardcoded in overlays.tsx drift every
time we re-densify, re-render with different settings, or edit dialogue. The
chunk_boundaries.json indirection means upstream timing changes flow through
to overlays automatically — re-render Just Works.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from job import resolve_job_dir, add_job_arg


# ─── Word normalization ─────────────────────────────────────────────────────

# Drop trailing punctuation; lowercase; collapse apostrophes ("we've" → "weve").
# Match the same normalize() rules the overlay_authoring_guide §8.5.1 calls
# out so chunk-boundary matching and findWord() agree on what "the same word"
# is.
_WORD_NORMALIZE_RE = re.compile(r"[^a-z0-9]")


def normalize(word: str) -> str:
    return _WORD_NORMALIZE_RE.sub("", (word or "").lower())


def split_dialogue_words(dialogue: str) -> list[str]:
    """Split a dialogue string into normalized tokens.

    Markdown-style asterisks (`*Clear*`) are stripped before normalization
    so script-italic emphasis doesn't break the match.
    """
    cleaned = re.sub(r"\*", "", dialogue or "")
    return [normalize(t) for t in cleaned.split() if normalize(t)]


def transcript_word_text(w: dict) -> str:
    """Both elevenlabs.py and the Remotion contract accept `word` or `text`."""
    return (w.get("word") or w.get("text") or "").strip()


def transcript_word_start(w: dict) -> float:
    return float(w.get("start", w.get("start_sec", 0.0)))


def transcript_word_end(w: dict) -> float:
    return float(w.get("end", w.get("end_sec", 0.0)))


# ─── Fuzzy boundary match ───────────────────────────────────────────────────

def find_chunk_boundary(
    chunk_words: list[str],
    transcript_words: list[dict],
    *,
    search_from_idx: int = 0,
    search_back_grace: int = 3,
    window_size: int = 4,
    min_matches: int = 2,
    side: str = "start",  # "start" or "end"
) -> tuple[int, int] | None:
    """Find where `chunk_words` aligns inside `transcript_words`.

    For each candidate transcript position i, tries multiple alignments of
    the chunk's first/last `window_size` words — including DROP-FIRST-WORD
    and DROP-LAST-WORD alignments — so the matcher survives the routine TTS
    failure where a quiet onset/coda word ("First,", "And", "Um") gets
    swallowed by Scribe.

    side='start' → match the first `window_size` chunk words
    side='end'   → match the last  `window_size` chunk words

    Returns (transcript_index_of_first_match, score) of the BEST scoring
    alignment, or None if best score < min_matches.

    search_back_grace: extend the search backwards by N words from
    `search_from_idx` so chunk boundaries that overlap slightly with the
    previous chunk (real Seedance phenomenon) still match.

    Why fuzziness: TTS routinely drops a quiet onset word and Scribe
    routinely mispronounces a brand name. 2-of-4 with shift tolerance is
    empirically tolerant enough without false-positives in practice.
    """
    if not chunk_words or search_from_idx >= len(transcript_words):
        return None

    if side == "start":
        target = chunk_words[:window_size]
    else:
        target = chunk_words[-window_size:]
    if not target:
        return None

    # Alignment shifts to try. For "start": shift=0 (target as-is), shift=1
    # (skip the first chunk word — handles TTS dropping the onset). For "end":
    # shift=0 + shift=-1 (skip the last chunk word — handles TTS swallowing
    # the trailing punctuation/period word).
    if side == "start":
        shifts = [0, 1, 2]
    else:
        shifts = [0, -1, -2]

    search_start = max(0, search_from_idx - search_back_grace)

    best_start_idx = -1
    best_end_idx = -1
    best_score = 0.0

    for i in range(search_start, len(transcript_words) - 1):
        for shift in shifts:
            if side == "start":
                aligned = target[shift:] if shift >= 0 else target
            else:
                aligned = target[: len(target) + shift] if shift < 0 else target
            if not aligned:
                continue

            score = 0.0
            last_consumed_idx = i - 1
            for offset, want in enumerate(aligned):
                pos = i + offset
                if pos >= len(transcript_words):
                    break
                got = normalize(transcript_word_text(transcript_words[pos]))
                # Anchor-word bonus: matching the FIRST aligned word at this
                # position is strong evidence that `i` is the actual start
                # of the chunk audio (not just a position where later words
                # coincidentally line up). Without this bonus, ties happen
                # between (a) the correct anchor and (b) positions where
                # offsets 1..N happen to match.
                anchor_weight = 2.0 if offset == 0 else 1.0
                if got == want:
                    score += anchor_weight
                    last_consumed_idx = pos
                elif got and want and (got in want or want in got):
                    score += anchor_weight * 0.5
                    last_consumed_idx = pos
            if score > best_score:
                best_score = score
                best_start_idx = i
                best_end_idx = last_consumed_idx

    if best_score >= min_matches and best_start_idx >= 0:
        return best_start_idx, best_end_idx, best_score
    return None


# ─── Main compute ───────────────────────────────────────────────────────────

def compute(
    script: dict,
    transcript: dict,
    *,
    final_duration_sec: float | None = None,
) -> list[dict]:
    """Compute per-chunk boundaries. Returns a list of chunk-boundary dicts."""
    chunks = script.get("chunks", [])
    words = transcript.get("words", [])
    if not chunks or not words:
        return []

    transcript_end = transcript_word_end(words[-1]) if words else 0.0
    last_end_anchor = 0.0
    boundaries: list[dict] = []

    for chunk in chunks:
        idx = chunk.get("chunk_index", len(boundaries))
        # Supplied-speech scripts carry the spoken line as `text`, timed by `start`/`end`.
        chunk_words = split_dialogue_words(chunk.get("dialogue") or chunk.get("text") or "")
        if not chunk_words:
            # No dialogue (B-roll / typography chunk) — fall back to script
            # timestamps scaled by densify ratio if available, else leave
            # the script values raw.
            script_start = chunk.get("start_sec", chunk.get("start", last_end_anchor))
            script_end = chunk.get("end_sec", chunk.get("end", last_end_anchor))
            boundaries.append({
                "index": idx,
                "start_sec": float(script_start),
                "end_sec": float(script_end),
                "dialogue_first_word": None,
                "dialogue_last_word": None,
                "anchor_method": "no_dialogue",
                "fallback_reason": "chunk has no dialogue (B-roll / typography)",
            })
            last_end_anchor = float(script_end)
            continue

        # Find the transcript index of the start
        start_match = find_chunk_boundary(
            chunk_words, words,
            search_from_idx=_words_at_or_after(words, last_end_anchor),
            side="start",
        )
        if start_match is not None:
            start_idx, _start_last_consumed, start_score = start_match
            start_sec = transcript_word_start(words[start_idx])
            start_word = transcript_word_text(words[start_idx])
            start_method = "exact_match" if start_score >= 4 else "fuzzy_match"
            start_reason = None
        else:
            # Fall back to previous chunk's end + tiny gap. This happens when
            # the chunk's opening word was dropped by TTS (e.g. "First,"
            # swallowed on a chunk-stitch boundary).
            start_sec = last_end_anchor + 0.02
            start_idx = _words_at_or_after(words, start_sec)
            start_word = chunk_words[0]
            start_method = "fallback_previous_end"
            start_reason = (
                f"first words ({chunk_words[:3]}) not found in transcript — "
                "likely TTS dropped or mispronounced the chunk onset"
            )

        # Find the transcript index of the end. Search from start_idx so the
        # end window can't precede the chunk's own start.
        end_match = find_chunk_boundary(
            chunk_words, words,
            search_from_idx=start_idx,
            side="end",
        )
        if end_match is not None:
            _end_start, end_last_consumed_idx, end_score = end_match
            # Use the END of the last transcript word we actually consumed —
            # avoids the bug where shift-based alignment overshoots into the
            # next chunk's territory.
            end_sec = transcript_word_end(words[end_last_consumed_idx])
            end_word = transcript_word_text(words[end_last_consumed_idx])
            end_method = "exact_match" if end_score >= 4 else "fuzzy_match"
            end_reason = None
        else:
            # Fall back to script's claimed end OR transcript end (whichever
            # is closer to the start_sec while still being plausible)
            end_sec = max(start_sec + 1.0, last_end_anchor + 0.5)
            end_word = chunk_words[-1]
            end_method = "fallback_no_match"
            end_reason = (
                f"last words ({chunk_words[-3:]}) not found in transcript — "
                "using start_sec + 1s minimum"
            )

        # Sanity: end can never precede start; clamp to transcript bounds.
        end_sec = max(end_sec, start_sec + 0.1)
        if final_duration_sec is not None:
            end_sec = min(end_sec, final_duration_sec)

        boundaries.append({
            "index": idx,
            "start_sec": round(start_sec, 3),
            "end_sec": round(end_sec, 3),
            "dialogue_first_word": start_word,
            "dialogue_last_word": end_word,
            "anchor_method": (
                start_method if start_method == end_method
                else f"start:{start_method}|end:{end_method}"
            ),
            **({"fallback_reason": start_reason} if start_reason else {}),
            **({"fallback_reason_end": end_reason} if end_reason else {}),
        })
        last_end_anchor = end_sec

    # Last-chunk end: if we fell back, extend to transcript_end so overlays
    # at the close (like a brand end-card) can hold to the very end.
    if boundaries and boundaries[-1]["anchor_method"].endswith("fallback_no_match"):
        boundaries[-1]["end_sec"] = round(transcript_end + 0.05, 3)

    return boundaries


def _words_at_or_after(words: list[dict], sec: float) -> int:
    """Find the first word index whose start >= sec. Returns 0 if no words match."""
    for i, w in enumerate(words):
        if transcript_word_start(w) >= sec:
            return i
    return len(words)


def compute_and_write(
    job_dir: Path,
    *,
    final_duration_sec: float | None = None,
    quiet: bool = False,
) -> Path | None:
    """Compute boundaries for a job and write chunk_boundaries.json.

    Idempotent — always overwrites. Returns the output path on success, or
    None if there's no script.json / transcript.json yet.
    """
    script_path = job_dir / "script.json"
    transcript_path = job_dir / "transcript.json"
    if not script_path.exists() or not transcript_path.exists():
        return None

    script = json.loads(script_path.read_text())
    transcript = json.loads(transcript_path.read_text())
    boundaries = compute(script, transcript, final_duration_sec=final_duration_sec)

    payload = {
        "computed_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": {"script": "script.json", "transcript": "transcript.json (PASS 2)"},
        "final_duration_sec": final_duration_sec,
        "chunks": boundaries,
    }

    out_path = job_dir / "chunk_boundaries.json"
    out_path.write_text(json.dumps(payload, indent=2))

    if not quiet:
        n_fallbacks = sum(
            1 for b in boundaries
            if "fallback" in b.get("anchor_method", "") or "fallback_reason" in b
        )
        msg = f"Wrote {out_path.relative_to(job_dir)} ({len(boundaries)} chunks"
        if n_fallbacks:
            msg += f", {n_fallbacks} via fallback"
        msg += ")"
        print(msg)

    return out_path


# ─── CLI ────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    add_job_arg(parser)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Compute and print to stdout but don't write chunk_boundaries.json",
    )
    parser.add_argument(
        "--final-duration-sec", type=float, default=None,
        help="Clamp the last chunk's end_sec to this value (typically the "
             "actual final_raw.mp4 duration; remotion_render.py passes this "
             "automatically when invoked from there).",
    )
    args = parser.parse_args()

    job_dir = resolve_job_dir(args.job)

    if args.dry_run:
        script = json.loads((job_dir / "script.json").read_text())
        transcript = json.loads((job_dir / "transcript.json").read_text())
        boundaries = compute(
            script, transcript,
            final_duration_sec=args.final_duration_sec,
        )
        print(json.dumps({
            "computed_at_utc": datetime.now(timezone.utc).isoformat(),
            "chunks": boundaries,
        }, indent=2))
        return 0

    result = compute_and_write(
        job_dir,
        final_duration_sec=args.final_duration_sec,
    )
    if result is None:
        print("ERROR: script.json or transcript.json missing — nothing to compute.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
