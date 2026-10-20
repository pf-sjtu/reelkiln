#!/usr/bin/env python3
"""
qa_gate — standalone QA receipt tooling, plus a Stop hook that never blocks.

Four modes (stdlib-only so the Stop hook runs fast, no uv/venv needed):

  --mark --job <id>     Stamp jobs/<id>/.qa_ok with the sha256 of its final.mp4
                        and integrated review evidence. Requires a current,
                        complete `review_output --mode full` record, and a
                        final.mp4 that carries the modalities promised by the
                        job. Narrated/music-planned work must contain sustained
                        audio; an explicitly text-led no-dialogue/no-caption
                        video may intentionally be silent. Standalone CLI
                        development only; no agent is required to stamp it.

  --mark-audio --job <id> --input <job-relative wav>
                        Publish audio/master.wav atomically from a current
                        decode_audio ALL_PASS report bound to the exact input
                        hash, then write audio/master.receipt.json.

  --mark-stack --job <id> --open-rows N [--accepted "..."]
                        Record the Stage 2.5 (reference-fidelity) READ into
                        strips/stack_receipt.json. Required before --mark on any
                        job with a reference video. Refuses if the cards were
                        rendered from a different video or miss any ref beat.

  --hook                Stop-hook mode. Always allows the stop: exit 0 and no
                        decision on stdout, whatever the input. Quality review
                        is a silent harness step that never holds a turn open,
                        and a render without a receipt is still a complete
                        draft (INFR-Organisation/videoclaw#266). The hook only
                        leaves a best-effort observability trace in the session
                        marker. Its command string stays wired byte-for-byte in
                        .claude/settings.json and .codex/hooks.json because the
                        app attests those settings bytes.

A --mark receipt is bound to final.mp4's bytes, so a re-render makes it stale.
There is deliberately no file-based skip marker: anything the agent can write
is not proof that a human waived a check. The review/receipt files are
execution evidence at an honor boundary, not a cryptographic attestation: they
catch missing, incomplete, stale, and accidentally changed evidence, but a
workspace-writing agent can fabricate them. A non-forgeable approval requires an
app/gateway-owned receipt outside this repository.
"""
from __future__ import annotations

import sys, os, json, glob, time, hashlib, math, shutil, subprocess
from array import array
from pathlib import Path

from taste_contract import contract_roots, validate_plan_evidence, validate_qa_receipt

QA_EVIDENCE_SCHEMA = "videoclaw.final-qa/v5"
SUPPORTED_QA_EVIDENCE_SCHEMAS = frozenset({
    "videoclaw.final-qa/v4",
    QA_EVIDENCE_SCHEMA,
})

_SHA_CACHE: dict[tuple[str, float, int], str] = {}


def _sha256(path: str) -> str:
    """Memoized on (path, mtime, size) — the gate hashes the same final.mp4 from
    several checks in one run, and these are 10s of MB."""
    try:
        st = os.stat(path)
        key = (os.path.abspath(path), st.st_mtime, st.st_size)
    except OSError:
        key = None
    if key is not None and key in _SHA_CACHE:
        return _SHA_CACHE[key]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    digest = h.hexdigest()
    if key is not None:
        _SHA_CACHE[key] = digest
    return digest


def _is_reference_job(job_dir: str) -> bool:
    """Stage 2.5 applies to reference-grounded renders — duplications and remixes.
    The MECHANICAL signal is a reference video at jobs/<id>/reference/*.mp4, which is
    the path skills/video_qa.md Stage 2.5 already tells you to pass as `--ref`.

    Deliberately NARROW: a few pre-convention jobs stash their ref in breakdown/ or
    compare/ and go ungated. That is the accepted trade — widening this to sniff
    those dirs would start firing Stage 2.5 on non-duplication work, and a gate that
    cries wolf gets waived. New duplication jobs put the ref where the recipe says."""
    return bool(glob.glob(os.path.join(job_dir, "reference", "*.mp4")))


def _project_dir() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def _promise_status(job_dir: str, final: str) -> tuple[bool, str, object]:
    """Gate the receipt on the delivery promise (check_promise.py).

    Returns (ok_to_stamp, message, promise_kept_flag). Rules, applied ONLY when a
    optional promise.json exists:
      - no promise_check.json                  → block ("run check_promise first")
      - promise_check.json older than final.mp4 → block ("stale — re-run for this render")
      - any HARD breach standing               → block (list them)
    No promise.json → no delivery-promise check; skip, promise_kept = None.
    The promise only records delivery targets; it carries no QA opt-in flag
    (the old decision.qa_required=true requirement is gone).
    """
    if not os.path.isfile(os.path.join(job_dir, "promise.json")):
        return True, "", None
    try:
        with open(os.path.join(job_dir, "promise.json"), encoding="utf-8") as f:
            promise = json.load(f)
    except Exception as e:
        return False, f"promise.json is unreadable or invalid: {e}", None
    if not isinstance(promise, dict):
        return False, "promise.json must be a JSON object.", None
    pc = os.path.join(job_dir, "promise_check.json")
    if not os.path.isfile(pc):
        return False, ("promise.json exists but no promise_check.json — run "
                       "`uv run python tools/check_promise.py --job <id>` first."), None
    try:
        if os.path.getmtime(pc) < os.path.getmtime(final):
            return False, ("promise_check.json is older than this render — re-run "
                           "check_promise so the promise is verified against the CURRENT final.mp4."), None
        with open(pc, encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return False, f"promise_check.json is unreadable or invalid: {e}", None
    hard = [b for b in data.get("breaches", []) if b.get("severity") == "hard"]
    if hard:
        lines = "; ".join(f"{b['field']}: promised {b['promised']} → got {b['observed']}" for b in hard)
        return False, (
            "delivery promise BROKEN (hard) — fix the render before stamping QA:\n"
            f"    {lines}"
        ), False
    return True, "", data.get("promise_kept", True)


def _review_status(job_dir: str, final: str) -> tuple[bool, str]:
    """Require complete integrated QA evidence bound to the current render."""
    rj = os.path.join(job_dir, "review_output.json")
    if not os.path.isfile(rj):
        return False, (
            "no review_output.json — run the canonical full final-review command "
            "documented in skills/video_qa.md on the CURRENT render."
        )
    try:
        with open(rj, encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as e:
        return False, f"review_output.json is unreadable or invalid: {e}"
    final_review = data.get("final_review")
    if final_review != "ok":
        detail = (data.get("final_review_observations") or {}).get("vendor_error")
        suffix = f" Vendor error: {detail}" if detail else ""
        return False, (
            f"review_output final_review is {final_review!r} — the whole-video "
            "review did not complete successfully, so per-beat results cannot "
            "stamp QA." + suffix
        )
    audio_status = data.get("audio_audit_status")
    if audio_status != "ok":
        failures = (data.get("audio_audit") or {}).get("grounding_failures") or []
        return False, (
            f"review_output audio audit is {audio_status!r}"
            + (f" ({', '.join(failures)})" if failures else "")
            + " — fix the mix evidence and re-run `review_output --mode full`."
        )
    rec = data.get("final_sha256")
    if not rec:
        return False, (
            "review_output.json has no render hash — re-run `review_output --mode full` "
            "on the CURRENT final.mp4."
        )
    if rec != _sha256(final):
        return False, ("review_output.json was produced for a DIFFERENT render (hash "
                       "mismatch) — re-run `review_output --mode full` on the CURRENT final.mp4.")
    evidence = data.get("qa_evidence")
    evidence_schema = evidence.get("schema") if isinstance(evidence, dict) else None
    if not isinstance(evidence, dict) or evidence_schema not in SUPPORTED_QA_EVIDENCE_SCHEMAS:
        return False, (
            "review_output.json has no canonical final-QA evidence — re-run "
            "`review_output --mode full` with the current engine."
        )
    if evidence.get("mode") != "full":
        return False, "review evidence is not a full final-QA pass."
    if evidence.get("final_review_status") != final_review:
        return False, "review evidence final-review status is missing or does not match the report."
    if evidence.get("audio_audit_status") != audio_status:
        return False, "review evidence audio-audit status is missing or does not match the report."
    if evidence.get("final_sha256") != rec:
        return False, "review evidence hash does not match review_output.json."
    if evidence.get("input_sha256") != rec:
        return False, "reviewed render changed during QA or input hash is missing."
    if (
        evidence.get("snapshot_input_sha256") != rec
        or evidence.get("snapshot_final_sha256") != rec
    ):
        return False, "immutable QA snapshot hash is missing, changed, or does not match the render."
    shared_checks = {
        "stable_render_snapshot",
        "full_video_mechanical",
        "caption_script_fidelity",
        "delivery_safety",
        "perceptual_transport",
    }
    required_checks = shared_checks | (
        {"integrated_audio", "candidate_frame_evidence"}
        if evidence_schema == QA_EVIDENCE_SCHEMA
        else {"independent_audio", "candidate_frame_verification"}
    )
    checks = evidence.get("checks")
    missing = [
        name for name in sorted(required_checks)
        if not isinstance(checks, dict) or checks.get(name) is not True
    ]
    if missing:
        # Name the gap. A check can be incomplete because it could not run on
        # this render at all (e.g. delivery safety skipping the platform
        # red-zone tables on a canvas they were never authored for), and the
        # operator cannot act on "one or more" — the recorded reasons say which
        # coverage is missing and why it could not be obtained.
        detail = "; ".join(
            str(reason) for reason in (evidence.get("incomplete_reasons") or [])
        )
        return False, (
            "review evidence is missing one or more required completed checks: "
            + ", ".join(missing) + (f" — {detail}" if detail else "")
        )
    if evidence_schema == QA_EVIDENCE_SCHEMA:
        frame_evidence = data.get("frame_evidence")
        if not isinstance(frame_evidence, list):
            return False, "v5 review has no exact local frame-evidence list."
        text_flags = (data.get("onscreen_text_audit") or {}).get("flags")
        if not isinstance(text_flags, list):
            return False, "v5 review has no on-screen-text flags list."
        expected_frames = [
            flag for flag in text_flags
            if isinstance(flag, dict) and flag.get("start_sec") is not None
        ]
        if len(frame_evidence) != len(expected_frames):
            return False, "v5 review is missing exact frame evidence for a text candidate."
        for index, item in enumerate(frame_evidence):
            if not isinstance(item, dict) or item.get("source_sha256") != rec:
                return False, f"frame evidence {index} is not bound to the reviewed render."
            try:
                frame = _job_local_file(job_dir, item.get("frame", ""), label="frame evidence")
            except (OSError, ValueError) as exc:
                return False, f"frame evidence {index} is invalid: {exc}"
            if item.get("frame_sha256") != _sha256(frame):
                return False, f"frame evidence {index} hash does not match its exact bytes."
    if evidence.get("incomplete_reasons") != []:
        return False, "review evidence retains incomplete reasons."
    if not isinstance(evidence.get("completed_at"), (int, float)):
        return False, "review evidence has no completion timestamp."
    if evidence.get("qa_complete") is not True:
        reasons = evidence.get("incomplete_reasons") or ["unknown incomplete check"]
        return False, "integrated final QA is INCOMPLETE: " + "; ".join(map(str, reasons))
    if data.get("qa_outcome") != "PASS" or evidence.get("qa_outcome") != "PASS":
        blockers = evidence.get("hard_delivery_issues") or []
        detail = f" ({len(blockers)} semantic delivery issue(s))" if blockers else ""
        return False, f"integrated final QA outcome is {evidence.get('qa_outcome')!r}{detail}."
    return True, ""


def _taste_status(job_dir: str) -> tuple[bool, str, dict | None]:
    """Require current scoped Taste evidence and its bound QA receipt.

    Pre-plan legacy jobs without promise.json remain outside this contract.  A
    locked production decision, however, cannot omit Taste or claim that a
    subjective rule passed mechanically.
    """
    promise_path = Path(job_dir) / "promise.json"
    if not promise_path.is_file():
        return True, "", None
    try:
        promise = json.loads(promise_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"promise.json is unreadable or invalid: {exc}", None
    evidence = promise.get("taste") if isinstance(promise, dict) else None
    engine_root, workspace_root = contract_roots()
    plan_ok, plan_reason = validate_plan_evidence(
        evidence, engine_root, workspace_root
    )
    if not plan_ok:
        return False, f"scoped Taste plan is stale or missing: {plan_reason}", None
    qa_ok, qa_reason, receipt = validate_qa_receipt(Path(job_dir))
    if not qa_ok:
        return False, qa_reason, None
    final = Path(job_dir) / "final.mp4"
    render = receipt.get("render") if isinstance(receipt, dict) else None
    if (
        not isinstance(render, dict)
        or render.get("path") != "final.mp4"
        or not final.is_file()
        or render.get("sha256") != _sha256(str(final))
    ):
        return False, "Taste QA is not bound to the current canonical final.mp4", None
    return True, qa_reason, receipt


_STACK_HOWTO = (
    "    uv run python tools/render_timeline_strip.py --job <id> --stack [--wallclock] \\\n"
    "        --ref reference/ref.mp4 --ours final.mp4 \\\n"
    "        --ref-beats <rb.json> --ours-beats <ob.json>\n"
    "    # read EVERY card COLUMN BY COLUMN (layout · animation phase · color · opacity ·\n"
    "    # type · presence), tabulate one row per disparity, fix, re-render, re-read\n"
    "    uv run python tools/qa_gate.py --mark-stack --job <id> --open-rows 0"
)


# A render ships with SOUND. Silence is never a deliverable (CLAUDE.md 🔊) — not a
# stand-in for a bed chosen later, not "the platform sound gets attached in the
# composer". The two ways this breaks are different and both are caught here: an
# ffmpeg map that dropped the audio stream entirely, and a stream that is present
# but digitally silent (a muxed-in bed that never actually got laid, a VO written
# to the wrong path). The second is the dangerous one — ffprobe reports a healthy
# AAC track and every downstream check passes while the file plays nothing.
SILENCE_DBFS = -70.0   # true digital silence probes at -91 dB; real audio clears this easily
MIN_RMS_DBFS = -55.0
MIN_ACTIVE_FRACTION = 0.05
ACTIVE_SAMPLE_DBFS = -60.0
MIN_AUDIO_COVERAGE = 0.90


def _audio_status(final: str) -> tuple[bool, dict | str]:
    """Does final.mp4 carry sustained audible audio for the whole render?"""
    try:
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=index", "-of", "csv=p=0", final],
            capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"cannot verify audio (ffprobe unavailable: {e})."
    if p.returncode != 0:
        return False, f"cannot verify audio (ffprobe failed: {p.stderr.strip()[:200]})."
    if not p.stdout.strip():
        return False, ("final.mp4 has NO AUDIO STREAM even though the integrated review "
                       "classifies this job as audio-bearing. Restore the promised bed/VO, "
                       "then re-render and re-run QA.")
    try:
        duration_probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", final],
            capture_output=True, text=True, timeout=60)
        container_duration = float(duration_probe.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return False, f"cannot verify media duration before audio QA: {e}."
    try:
        decoded = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", final, "-map", "0:a:0", "-vn",
             "-ac", "1", "-ar", "1000", "-f", "f32le", "-"],
            capture_output=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"cannot verify audio level (ffmpeg unavailable: {e})."
    if decoded.returncode != 0 or not decoded.stdout:
        detail = decoded.stderr.decode("utf-8", "replace")[:200]
        return False, f"cannot decode final.mp4 audio for QA: {detail}."
    samples = array("f")
    samples.frombytes(decoded.stdout[: len(decoded.stdout) - len(decoded.stdout) % 4])
    if sys.byteorder != "little":  # ffmpeg emits f32le
        samples.byteswap()
    if not samples:
        return False, "final.mp4's audio stream decoded to zero samples."
    peak_linear = max(abs(sample) for sample in samples)
    rms_linear = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
    peak = 20.0 * math.log10(max(peak_linear, 1e-12))
    rms = 20.0 * math.log10(max(rms_linear, 1e-12))
    active_floor = 10.0 ** (ACTIVE_SAMPLE_DBFS / 20.0)
    active_fraction = sum(abs(sample) >= active_floor for sample in samples) / len(samples)
    audio_duration = len(samples) / 1000.0
    coverage = audio_duration / container_duration if container_duration > 0 else 0.0
    if peak <= SILENCE_DBFS:
        return False, (f"final.mp4's audio track is SILENT (peak {peak:.1f} dBFS). An audio "
                       "stream exists but carries no signal even though the integrated review "
                       "classifies this job as audio-bearing; fix the promised mix and re-render.")
    if rms <= MIN_RMS_DBFS or active_fraction < MIN_ACTIVE_FRACTION:
        return False, (
            "final.mp4 has only a transient or near-silent audio track "
            f"(RMS {rms:.1f} dBFS, audible for {active_fraction:.1%} of samples). "
            "A peak alone is not a bed or voice track; fix the mix and re-render."
        )
    if coverage < MIN_AUDIO_COVERAGE:
        return False, (
            f"final.mp4 audio covers only {coverage:.1%} of the render "
            f"({audio_duration:.2f}s of {container_duration:.2f}s). "
            "Extend the mix across the complete deliverable."
        )
    return True, {
        "audio_peak_dbfs": round(peak, 2),
        "audio_rms_dbfs": round(rms, 2),
        "audio_active_fraction": round(active_fraction, 4),
        "audio_coverage_fraction": round(coverage, 4),
    }


def _audio_required_by_review(job_dir: str) -> tuple[bool, dict]:
    """Return whether the final must carry sustained audio.

    Silence is allowed only when the already-validated integrated review says
    caption fidelity is explicitly inapplicable, heard neither voice nor music,
    and found no concrete full-video audio defect. Missing/legacy fields keep
    the historical fail-closed audio requirement.
    """
    review_path = os.path.join(job_dir, "review_output.json")
    try:
        with open(review_path, encoding="utf-8") as handle:
            review = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return True, {"audio_required": True, "audio_policy": "review_unavailable"}

    fidelity = review.get("caption_fidelity")
    audio_audit = review.get("audio_audit")
    intentional_silence = (
        isinstance(fidelity, dict)
        and fidelity.get("available") is False
        and fidelity.get("applicable") is False
        and fidelity.get("intent") in {"visual_only", "no_dialogue"}
        and isinstance(audio_audit, dict)
        and audio_audit.get("intentional_silence") is True
        and audio_audit.get("voice_present") is False
        and audio_audit.get("music_bed_present") is False
    )
    if intentional_silence:
        return False, {
            "audio_required": False,
            # Preserve the receipt value consumed by existing clients. The
            # policy now covers both explicit visual-only and no-dialogue
            # authoring declarations.
            "audio_policy": "reviewed_visual_only",
            "audio_fidelity_reason": fidelity.get("reason"),
        }
    return True, {"audio_required": True, "audio_policy": "sustained_audio"}


def _missing_cards(receipt_path: str, rec: dict) -> list[str]:
    """Card files the receipt claims, that are not on disk. Paths are resolved relative
    to the receipt so a moved strips/ dir travels with it. Without this, coverage counts
    evidence that may have been deleted after the receipt was written — the gate would
    assert the cards exist when only the claim does."""
    base = os.path.dirname(receipt_path)
    return [c["file"] for c in rec.get("cards", [])
            if c.get("file") and not os.path.isfile(os.path.join(base, c["file"]))]


def _inputs_status(job_dir: str, final: str, rec: dict) -> tuple[bool, str]:
    """Both comparison inputs must still be the ones the cards were built from.

    Hashing OURS alone left a hole: swap in a re-cut reference/ref.mp4 and an OLD set of
    cards still passes, which is the same stale-evidence defect this gate exists to catch,
    just on the other side of the comparison. We check the recorded ref hash against the
    reference video(s) the job has NOW — matching by content rather than by path, so a
    moved or renamed ref doesn't produce a spurious block.
    """
    if rec.get("ours_sha256") != _sha256(final):
        return False, ("the stacked cards were rendered from a DIFFERENT video than the "
                       f"shipped final.mp4 (receipt OURS = {rec.get('ours')}). The Stage 2.5 "
                       "read never saw this render — re-stack and re-read:\n" + _STACK_HOWTO)
    ref_sha = rec.get("ref_sha256")
    if not ref_sha:
        return False, ("this stack_receipt.json predates reference-hash binding "
                       f"(schema {rec.get('schema', '?')}) — it cannot prove the cards were "
                       "built from the CURRENT reference. Re-stack:\n" + _STACK_HOWTO)
    have = {_sha256(p) for p in glob.glob(os.path.join(job_dir, "reference", "*.mp4"))}
    if ref_sha not in have:
        return False, ("the REFERENCE changed since these cards were rendered (receipt REF = "
                       f"{rec.get('ref')}, {ref_sha[:12]}… — no video in reference/ matches). "
                       "The comparison is against a reference this job no longer has — "
                       "re-stack against the current one:\n" + _STACK_HOWTO)
    return True, ""


def _stack_status(job_dir: str, final: str) -> tuple[bool, str]:
    """Gate the receipt on Stage 2.5 (skills/video_qa.md) — REFERENCE FIDELITY.

    Applies ONLY to reference-grounded jobs (see _is_reference_job); everything else
    fails open. What this can prove mechanically:
      - the cards were rendered from the CURRENT final.mp4 AND the CURRENT reference
        (same stale-render defect _review_status catches, applied to BOTH inputs)
      - every card the receipt claims is still ON DISK
      - EVERY ref beat landed on a card (no "read 3 of 47 and declared it done")
      - a read was recorded, and no disparity row is left open unaccepted
    What it CANNOT prove is that the read was honest — same contract as
    review_output.json. The gate makes skipping the stage loud, not impossible.
    """
    if not _is_reference_job(job_dir):
        return True, ""
    rp = os.path.join(job_dir, "strips", "stack_receipt.json")
    if not os.path.isfile(rp):
        return False, ("this job has a reference video, so video_qa.md Stage 2.5 "
                       "(REFERENCE FIDELITY) is REQUIRED and no strips/stack_receipt.json "
                       "exists. Render the beat-aligned stacked cards and read them:\n"
                       + _STACK_HOWTO)
    try:
        rec = json.load(open(rp))
    except Exception as e:
        return False, f"strips/stack_receipt.json is unreadable ({e}) — re-render the stacked cards."
    iok, imsg = _inputs_status(job_dir, final, rec)
    if not iok:
        return False, imsg
    missing = _missing_cards(rp, rec)
    if missing:
        return False, (f"{len(missing)} card(s) the receipt claims are GONE from disk "
                       f"({', '.join(missing[:6])}). Coverage counts evidence that no longer "
                       "exists — re-render the stack:\n" + _STACK_HOWTO)
    total, covered = rec.get("beats_total", 0), rec.get("beats_covered", 0)
    if total and covered < total:
        miss = ", ".join(str(b) for b in rec.get("uncovered_beats", [])[:12])
        return False, (f"Stage 2.5 coverage is INCOMPLETE — {covered}/{total} reference beats "
                       f"landed on a card (missing: {miss}). Every beat gets compared, or the "
                       "disparity you didn't render is the one that ships.")
    read = rec.get("read")
    if not read:
        return False, ("the stacked cards were rendered but the READ was never recorded. "
                       "Read every card column by column, tabulate the disparities, then:\n"
                       "    uv run python tools/qa_gate.py --mark-stack --job <id> --open-rows N")
    if read.get("final_sha256") != _sha256(final):
        return False, ("the Stage 2.5 read was recorded for a DIFFERENT render — re-read the "
                       "cards for the CURRENT final.mp4 and re-run --mark-stack.")
    open_rows = int(read.get("open_rows") or 0)
    if open_rows > 0 and not read.get("accepted"):
        return False, (f"Stage 2.5 has {open_rows} UNACCEPTED disparity row(s) against the "
                       "reference. Fix them and re-stack, or — only if they are the tenant's "
                       "deliberate spin — re-run --mark-stack with --accepted \"<why>\". "
                       "A duplication render with unaccepted rows is NOT done.")
    return True, ""


def mark_stack(job: str, open_rows: int, accepted: str) -> int:
    """Record the Stage 2.5 read into strips/stack_receipt.json (the judgment half;
    render_timeline_strip --stack writes the mechanical half)."""
    root = _project_dir()
    job_dir = job if os.path.isdir(job) else os.path.join(root, "jobs", job)
    final = os.path.join(job_dir, "final.mp4")
    rp = os.path.join(job_dir, "strips", "stack_receipt.json")
    if not os.path.isfile(final):
        print(f"qa_gate: no final.mp4 at {final}", file=sys.stderr)
        return 1
    if not os.path.isfile(rp):
        print("qa_gate: no strips/stack_receipt.json — render the stacked cards first:\n"
              + _STACK_HOWTO, file=sys.stderr)
        return 1
    try:
        rec = json.load(open(rp))
    except Exception as e:
        print(f"qa_gate: strips/stack_receipt.json unreadable ({e})", file=sys.stderr)
        return 1
    # Refuse to record a read of cards that don't correspond to the current comparison
    # inputs, that are missing from disk, or that never covered the whole reference — a
    # read of the wrong evidence is worse than no read, because it stamps confidence
    # onto it. Same checks --mark applies, so a read can never be recorded that --mark
    # would then reject.
    iok, imsg = _inputs_status(job_dir, final, rec)
    if not iok:
        print(f"qa_gate: {imsg}", file=sys.stderr)
        return 1
    missing = _missing_cards(rp, rec)
    if missing:
        print(f"qa_gate: {len(missing)} card(s) the receipt claims are missing from disk "
              f"({', '.join(missing[:6])}) — re-render the stack before recording a read.",
              file=sys.stderr)
        return 1
    total, covered = rec.get("beats_total", 0), rec.get("beats_covered", 0)
    if total and covered < total:
        print(f"qa_gate: cards cover only {covered}/{total} reference beats "
              f"(missing: {', '.join(str(b) for b in rec.get('uncovered_beats', [])[:12])}) — "
              "re-render the full stack before recording a read.", file=sys.stderr)
        return 1
    if open_rows > 0 and not accepted:
        print(f"qa_gate: {open_rows} open disparity row(s) — fix them, or pass "
              "--accepted \"<why they are the tenant's deliberate spin>\".", file=sys.stderr)
        return 1
    rec["read"] = {"open_rows": open_rows,
                   "accepted": accepted or None,
                   "final_sha256": _sha256(final),
                   "read_at": time.time()}
    with open(rp, "w") as f:
        json.dump(rec, f, indent=2)
    note = f", {open_rows} row(s) ACCEPTED: {accepted}" if open_rows else ""
    print(f"qa_gate: Stage 2.5 read recorded for {os.path.basename(job_dir.rstrip('/'))} "
          f"({covered}/{total} ref beats on a card{note})")
    return 0


def mark(job: str) -> int:
    root = _project_dir()
    job_dir = job if os.path.isdir(job) else os.path.join(root, "jobs", job)
    final = os.path.join(job_dir, "final.mp4")
    if not os.path.isfile(final):
        print(f"qa_gate: no final.mp4 at {final}", file=sys.stderr)
        return 1
    ok, msg, promise_kept = _promise_status(job_dir, final)
    if not ok:
        print(f"qa_gate: {msg}", file=sys.stderr)
        return 1
    rok, rmsg = _review_status(job_dir, final)
    if not rok:
        print(f"qa_gate: {rmsg}", file=sys.stderr)
        return 1
    sok, smsg = _stack_status(job_dir, final)
    if not sok:
        print(f"qa_gate: {smsg}", file=sys.stderr)
        return 1
    tok, tmsg, taste_receipt = _taste_status(job_dir)
    if not tok:
        print(f"qa_gate: {tmsg}", file=sys.stderr)
        return 1
    audio_required, audio_policy = _audio_required_by_review(job_dir)
    if audio_required:
        aok, audio_evidence = _audio_status(final)
        if not aok:
            print(f"qa_gate: {audio_evidence}", file=sys.stderr)
            return 1
        audio_evidence = {**audio_policy, **audio_evidence}
    else:
        audio_evidence = audio_policy
    review_path = os.path.join(job_dir, "review_output.json")
    receipt = {"final_sha256": _sha256(final), "marked_at": time.time(),
               "promise_kept": promise_kept,
                **audio_evidence,
               "review_sha256": _sha256(review_path),
               "review_schema": QA_EVIDENCE_SCHEMA}
    if taste_receipt is not None:
        taste_path = os.path.join(job_dir, "taste-qa.json")
        receipt.update({
            "taste_evidence_sha256": taste_receipt["tasteEvidenceSha256"],
            "taste_review_sha256": _sha256(taste_path),
            "taste_review_schema": taste_receipt["schema"],
            "taste_review_status": taste_receipt["status"],
        })
    with open(os.path.join(job_dir, ".qa_ok"), "w") as f:
        json.dump(receipt, f)
    kept_note = "" if promise_kept is None else f", promise_kept={promise_kept}"
    print(f"qa_gate: receipt written for {os.path.basename(job_dir.rstrip('/'))} "
          f"({receipt['final_sha256'][:12]}…{kept_note})")
    return 0


def _job_local_file(job_dir: str, supplied: str, *, label: str) -> str:
    """Resolve an existing, non-symlinked file below a job directory."""
    root = os.path.realpath(job_dir)
    candidate = supplied if os.path.isabs(supplied) else os.path.join(root, supplied)
    lexical = os.path.abspath(candidate)
    if os.path.commonpath([root, lexical]) != root:
        raise ValueError(f"{label} must stay inside the job directory")
    current = root
    for part in os.path.relpath(lexical, root).split(os.sep):
        current = os.path.join(current, part)
        if os.path.islink(current):
            raise ValueError(f"{label} may not use symlinks")
    resolved = os.path.realpath(lexical)
    if os.path.commonpath([root, resolved]) != root:
        raise ValueError(f"{label} must stay inside the job directory")
    if not os.path.isfile(resolved):
        raise ValueError(f"{label} not found: {resolved}")
    return resolved


def mark_audio(job: str, source: str) -> int:
    """Publish the verified music-recreation output and bind its QA evidence."""
    root = _project_dir()
    job_dir = job if os.path.isdir(job) else os.path.join(root, "jobs", job)
    try:
        source_path = _job_local_file(job_dir, source, label="--input")
        verify_path = _job_local_file(job_dir, "audio/verify.json", label="verify evidence")
        with open(verify_path, encoding="utf-8") as f:
            verification = json.load(f)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"qa_gate: cannot publish audio master: {e}", file=sys.stderr)
        return 1
    source_hash = _sha256(source_path)
    if verification.get("ALL_PASS") is not True:
        print("qa_gate: audio/verify.json does not have ALL_PASS=true", file=sys.stderr)
        return 1
    if verification.get("input_sha256") != source_hash:
        print(
            "qa_gate: audio/verify.json is stale or not bound to --input; "
            "rerun decode_audio --mode verify on this exact file",
            file=sys.stderr,
        )
        return 1
    audio_dir = os.path.join(os.path.realpath(job_dir), "audio")
    os.makedirs(audio_dir, exist_ok=True)
    master = os.path.join(audio_dir, "master.wav")
    if os.path.realpath(source_path) != os.path.realpath(master):
        pending = os.path.join(audio_dir, f".master.pending-{os.getpid()}")
        try:
            shutil.copyfile(source_path, pending)
            os.replace(pending, master)
        finally:
            if os.path.exists(pending):
                os.unlink(pending)
    master_hash = _sha256(master)
    if master_hash != source_hash:
        print("qa_gate: published audio/master.wav hash mismatch", file=sys.stderr)
        return 1
    receipt = {
        "schema": "videoclaw.audio-qa/v1",
        "master": "audio/master.wav",
        "master_sha256": master_hash,
        "source": os.path.relpath(source_path, os.path.realpath(job_dir)),
        "source_sha256": source_hash,
        "verify_sha256": _sha256(verify_path),
        "marked_at": time.time(),
    }
    receipt_path = os.path.join(audio_dir, "master.receipt.json")
    with open(receipt_path, "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2)
        f.write("\n")
    print(f"qa_gate: published audio/master.wav ({master_hash[:12]}…)")
    return 0


def _stop_marker(root: str, session_id: str) -> None:
    """Leave the Stop hook's observability trace next to the preflight marker
    (LAUNCH_SPEC §1). Best-effort, fail-quiet — a marker must never brick a
    session. Delegates to session_marker.py so the path/schema stays in one
    place; if that helper is missing (old engine), silently skip. The hook
    never blocks, so the trace always records ``blocked: false``."""
    try:
        marker = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "session_marker.py")
        if not os.path.isfile(marker):
            return
        subprocess.run(
            [sys.executable, marker, "--stop",
             "--session", session_id or "",
             "--workspace", root,
             "--blocked", "n",
             "--blocked-jobs", ""],
            timeout=10, check=False,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def hook() -> int:
    """Stop-hook mode: always allow the stop.

    Nothing may hold a turn open for quality review, and an unreviewed render
    is still a complete draft (INFR-Organisation/videoclaw#266). So this prints
    no decision and returns 0 for every input, including malformed hook JSON;
    the only effect is the best-effort session-marker trace. Every step,
    including resolving where the marker goes (workspace env first, then the
    hook's cwd, then the project dir / process cwd, which can be gone), stays
    inside the fail-open boundary.
    """
    try:
        data: dict = {}
        try:
            parsed = json.loads(sys.stdin.read() or "{}")
            if isinstance(parsed, dict):
                data = parsed
        except Exception:
            pass
        root = (os.environ.get("VIDEOCLAW_WORKSPACE")
                or data.get("cwd")
                or _project_dir())
        _stop_marker(str(root), str(data.get("session_id") or ""))
    except Exception:
        pass
    return 0


def _opt(args: list[str], flag: str, default: str = "") -> str:
    try:
        return args[args.index(flag) + 1]
    except (ValueError, IndexError):
        return default


def main() -> int:
    args = sys.argv[1:]
    if "--mark-audio" in args:
        job = _opt(args, "--job")
        source = _opt(args, "--input")
        if not job or not source:
            print(
                "qa_gate: --mark-audio requires --job <id> --input <job-relative wav>",
                file=sys.stderr,
            )
            return 1
        return mark_audio(job, source)
    if "--mark-stack" in args:
        job = _opt(args, "--job")
        if not job:
            print("qa_gate: --mark-stack requires --job <id>", file=sys.stderr)
            return 1
        if "--open-rows" not in args:
            print("qa_gate: --mark-stack requires --open-rows N (how many disparity rows "
                  "against the reference are still open; 0 = table empty)", file=sys.stderr)
            return 1
        try:
            open_rows = int(_opt(args, "--open-rows", "0"))
        except ValueError:
            print("qa_gate: --open-rows must be an integer", file=sys.stderr)
            return 1
        return mark_stack(job, open_rows, _opt(args, "--accepted"))
    if "--mark" in args:
        job = _opt(args, "--job")
        if not job:
            print("qa_gate: --mark requires --job <id>", file=sys.stderr)
            return 1
        return mark(job)
    if "--hook" in args:
        return hook()
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
