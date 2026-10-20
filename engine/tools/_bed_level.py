"""One steady music-bed level under the voice (videoclaw#321).

JC's rule: no ducking at all; the music sits at one constant level about
FLAT_BED_UNDER_VOICE_DB below the voice. `score_bed`'s default `--mix flat`
applies it to a finished mix; `assemble` and the compositors (`compose_render`,
`remotion_render`, `hyperframes_compose`) use this module to pick the same
level for a bed they lay under a voice themselves.

The level is one constant gain: the voice's and the bed's integrated loudness
(BS.1770, gated, so pauses do not drag the voice down) are measured, and the
bed is set `under_voice_db` below the voice. The bed is measured as the mix
delivers it — through an amix with the voice muted, `duration=first` — so a
stereo bed folded under a mono voice, or a bed longer than the voice, is judged
as the viewer hears it.
"""

from __future__ import annotations

import math
import re
import subprocess
from pathlib import Path

FLAT_BED_UNDER_VOICE_DB = 12.0
# An explicit bed gain may sit closer than the 12 dB default, but never closer
# than this under the voice (the same 8 dB as score_bed's #237 margin advisory).
MIN_BED_UNDER_VOICE_DB = 8.0
BED_PEAK_CEILING_DBFS = -1.0     # the gain never pushes a bed sample past this
SILENT_LUFS = -69.5              # ebur128 reports -70 LUFS for gated-out silence
MEASURE_TIMEOUT_S = 600          # a measurement that never ends is a failed one

# The finished voice+bed mix is brought to the engine's programme target
# (-14 LUFS, true peak <= -1 dBTP) without any dynamic loudnorm: the voice gets
# one gain and a true-peak limiter (a quiet voice with sharp peaks cannot reach
# -14 LUFS otherwise), the bed gets one linear gain that follows the voice's
# net change, so the gap between them is kept exactly and nothing pumps in the
# pauses. The voice limiter runs at the voice's own sample rate (resampling
# the voice before the mix would change how ffmpeg negotiates the mix's
# channel layout, and with it the bed's delivered level) with a sample-peak
# ceiling; a 4x-oversampled true-peak limiter on the sum catches the inter-
# sample and combined overs. Its ceiling sits 0.5 dB under the -1 dBTP target
# to leave room for the AAC encode.
PROGRAMME_TARGET_LUFS = -14.0
PROGRAMME_TRUE_PEAK_DBTP = -1.0
LIMITER_CEILING_DBTP = -1.5
VOICE_LIMIT_DBFS = -2.0


def ebur128(inputs: list[Path], graph: str) -> tuple[float | None, float | None]:
    """(integrated LUFS, sample peak dBFS) of the one ebur128 at the end of `graph`.

    Returns None for a value ffmpeg did not report; silence reads as
    -70 LUFS / -inf dBFS.
    """
    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    for path in inputs:
        cmd += ["-i", str(path)]
    try:
        res = subprocess.run(cmd + ["-filter_complex", graph, "-vn", "-f", "null", "-"],
                             capture_output=True, text=True, timeout=MEASURE_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return None, None
    if res.returncode != 0:
        return None, None

    def _last(pattern: str) -> float | None:
        found = re.findall(pattern, res.stderr)
        if not found:
            return None
        return float("-inf") if found[-1] == "-inf" else float(found[-1])

    return (_last(r"I:\s+(-?[0-9.]+|-inf) LUFS"), _last(r"Peak:\s+(-?[0-9.]+|-inf) dBFS"))


def integrated_lufs(input_args: list[str], graph: str) -> float | None:
    """Integrated loudness of `graph` (which must end in an unlabelled output).

    `input_args` are ffmpeg's own input arguments (`-i`, `-stream_loop` …), so
    the measurement reads exactly what the mix will read. Every chain fed by a
    looped input must end in the graph's own output (an `amix` with
    `duration=first`): older ffmpeg (6.x) keeps reading a looped input that
    feeds a sink of its own, and never exits.
    """
    try:
        res = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", *input_args,
             "-filter_complex", f"{graph},ebur128=framelog=quiet", "-vn", "-f", "null", "-"],
            capture_output=True, text=True, timeout=MEASURE_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    found = re.findall(r"I:\s+(-?[0-9.]+|-inf) LUFS", res.stderr)
    if not found:
        return None
    return float("-inf") if found[-1] == "-inf" else float(found[-1])


def true_peak_limiter(sample_rate: int = 48000) -> str:
    """A 4x-oversampled lookahead limiter: its ceiling is a true-peak ceiling.
    It delivers at `sample_rate`."""
    ceiling = 10 ** (LIMITER_CEILING_DBTP / 20)
    return (f"aresample={sample_rate * 4},"
            f"alimiter=limit={ceiling:.5f}:attack=1:release=100:level=0:latency=1,"
            f"aresample={sample_rate}")


def voice_limiter() -> str:
    """The voice's peak limiter, at its own sample rate (see VOICE_LIMIT_DBFS)."""
    ceiling = 10 ** (VOICE_LIMIT_DBFS / 20)
    return f"alimiter=limit={ceiling:.5f}:attack=1:release=100:level=0:latency=1"


def _lead_chain(lead: list[str]) -> str:
    if len(lead) == 1:
        return f"{lead[0]}anull"
    return f"{''.join(lead)}amix=inputs={len(lead)}:duration=first:normalize=0"


def voice_bed_graph(pre: list[str], lead: list[str], bed: str, voice_gain_db: float,
                    bed_gain_db: float, tail: str = "") -> str:
    """The mastered voice+bed graph: the voice (the `lead` labels, mixed) takes
    one gain and a peak limiter, the bed one linear gain, then the sum passes a
    true-peak safety limiter and is delivered at 48 kHz. `tail` closes the last chain (for
    example `,apad[aout]` or `[a]`); empty leaves it open for a measurement."""
    return ";".join([
        *pre,
        f"{_lead_chain(lead)},volume={voice_gain_db:.2f}dB,{voice_limiter()}[mlead]",
        f"{bed}volume={bed_gain_db:.2f}dB[mbed]",
        f"[mlead][mbed]amix=inputs=2:duration=first:normalize=0,{true_peak_limiter()}{tail}",
    ])


def master_voice_and_bed(input_args: list[str], pre: list[str], lead: list[str],
                         bed: str, *, rounds: int = 4) -> dict | None:
    """Measure, then pick the voice and bed gains that put the finished mix on
    the programme target with the voice/bed gap unchanged (#321).

    `pre` are the graph statements that produce the `lead` labels (the voice:
    a VO, the beats' own audio) and the `bed` label, at the levels the mix
    already chose. Returns None when the voice cannot be measured or is silent.
    """
    def voice_only(chain: str) -> str:
        # The voice as the mix delivers it: through the same amix, the bed
        # muted. (A bed looped with -stream_loop never ends on its own, so it
        # must stop with the voice, not in a sink that keeps reading it.)
        return ";".join([*pre, f"{chain}[l0]", f"{bed}volume=0[b0]",
                         "[l0][b0]amix=inputs=2:duration=first:normalize=0"])

    voice = integrated_lufs(input_args, voice_only(_lead_chain(lead)))
    summed = integrated_lufs(input_args, ";".join(
        [*pre, f"{_lead_chain(lead)}[l0]", f"[l0]{bed}amix=inputs=2:duration=first:normalize=0"]))
    if (voice is None or summed is None or not math.isfinite(voice)
            or voice <= SILENT_LUFS or summed <= SILENT_LUFS):
        return None
    voice_gain = PROGRAMME_TARGET_LUFS - summed
    bed_gain = voice_gain
    final = limited = None
    for _ in range(rounds):
        limited = integrated_lufs(input_args, voice_only(
            f"{_lead_chain(lead)},volume={voice_gain:.2f}dB,{voice_limiter()}"))
        if limited is None:
            return None
        # The bed follows the voice's NET change (gain minus what the limiter
        # took off its peaks), so the gap between them stays as mixed.
        bed_gain = limited - voice
        final = integrated_lufs(input_args, voice_bed_graph(pre, lead, bed, voice_gain, bed_gain))
        if final is None:
            return None
        error = PROGRAMME_TARGET_LUFS - final
        if abs(error) <= 0.25:
            break
        voice_gain += error
    return {"measured_lufs": round(summed, 2), "voice_lufs": round(voice, 2),
            "voice_gain_db": round(voice_gain, 2), "bed_gain_db": round(bed_gain, 2),
            "voice_limited_lufs": round(limited, 2), "final_lufs": round(final, 2),
            "target_lufs": PROGRAMME_TARGET_LUFS,
            "true_peak_ceiling_dbtp": PROGRAMME_TRUE_PEAK_DBTP}


def has_audio_stream(path: Path) -> bool:
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=index", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True)
    except OSError:
        return False
    return res.returncode == 0 and bool(res.stdout.strip())


def flat_bed_gain(
    voice: Path,
    bed: Path,
    *,
    under_voice_db: float = FLAT_BED_UNDER_VOICE_DB,
    voice_gain_db: float = 0.0,
    max_gain_db: float | None = None,
) -> dict | None:
    """The one constant gain (dB) that sits `bed` `under_voice_db` below `voice`.

    `voice_gain_db` is a constant gain the mix applies to the voice (an EDL's
    `vo.gain`). `max_gain_db` caps the result for a player that cannot amplify
    (an HTML `<audio>` volume stops at 1.0). The gain is also capped so no bed
    sample passes BED_PEAK_CEILING_DBFS.

    Returns None when there is no voice to sit under (no audio stream, or
    silence): the caller keeps its own level for a bed that is the programme.
    Raises RuntimeError when a measurement cannot be taken.
    """
    if not has_audio_stream(voice):
        return None
    voice_lufs, _ = ebur128([voice], "[0:a]ebur128=framelog=quiet")
    if voice_lufs is None:
        raise RuntimeError(f"cannot measure the voice loudness of {voice.name}")
    if voice_lufs <= SILENT_LUFS:
        return None
    voice_lufs += voice_gain_db
    bed_lufs, _ = ebur128(
        [voice, bed],
        "[0:a]volume=0[muted];[muted][1:a]amix=inputs=2:duration=first:normalize=0,"
        "ebur128=framelog=quiet")
    _, bed_peak = ebur128([bed], "[0:a]ebur128=peak=sample:framelog=quiet")
    if bed_lufs is None or bed_peak is None:
        raise RuntimeError(f"cannot measure the music bed {bed.name}")
    target = voice_lufs - under_voice_db
    gain = 0.0 if bed_lufs <= SILENT_LUFS else target - bed_lufs
    peak_capped = math.isfinite(bed_peak) and bed_peak + gain > BED_PEAK_CEILING_DBFS
    if peak_capped:
        gain = BED_PEAK_CEILING_DBFS - bed_peak
    clamped = max_gain_db is not None and gain > max_gain_db
    if clamped:
        gain = max_gain_db
    return {
        "gain_db": round(gain, 2),
        "voice_lufs": round(voice_lufs, 2),
        "bed_lufs_delivered": bed_lufs,
        "bed_target_lufs": round(target, 2),
        "peak_capped": peak_capped,
        "gain_clamped": clamped,
    }
