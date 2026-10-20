"""
scrub_reference_vo — remove a reference clip's SPOKEN voice-over while KEEPING the
music and any sung/melodic hook. Uses the REAL separator: the gateway `stem_split`
endpoint (MVSEP MDX23) via pull_video._separate_stems — NOT a center-cancel hack.

Recipe (speech is in the `vocals` stem; so is any singing):
  bed = instrumental (bass+drums+other)                 → speech + singing both gone
      + vocals stem GATED to --keep-singing ranges       → singing added back, speech stays out
Those ranges are the reference's music/singing SECTIONS (from the breakdown's
audio-novelty analysis). Caveat: MDX23 can bleed faint garbled speech into the
instrumental on talking-head material — keep the bed one steady level well under the
new VO (no ducking; lower it further if the bleed is still audible), and know it's there.

Usage:
  uv run python tools/scrub_reference_vo.py --job <j> --audio <wav/mp3/mp4> \
      [--keep-singing 11.87-19.07,24.0-26.0] [--out <path>]
"""
from __future__ import annotations
import argparse, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dotenv import load_dotenv
from _paths import ENV_PATH
load_dotenv(ENV_PATH)
from job import resolve_job_dir, add_job_arg          # noqa: E402
from log import log_event                              # noqa: E402
from pull_video import _separate_stems, STEM_NAMES  # noqa: E402  the REAL stem splitter

TOOL = "scrub_reference_vo.py"


def dur(p): return float(subprocess.run(["ffprobe","-v","error","-show_entries",
    "format=duration","-of","default=nk=1:nw=1",str(p)],capture_output=True,text=True).stdout.strip())


def main() -> int:
    ap = argparse.ArgumentParser(allow_abbrev=False, description=__doc__.split("\n\n")[0])
    add_job_arg(ap)
    ap.add_argument("--audio", required=True, help="Reference audio or video file.")
    ap.add_argument("--keep-singing", default="", help="Comma-separated ranges (sec) where the "
                    "vocals stem is a SUNG hook to keep, e.g. '11.87-19.07'. From the breakdown sections.")
    ap.add_argument("--out", help="Output wav (default <job>/music/<stem>_scrubbed.wav).")
    args = ap.parse_args()
    job = resolve_job_dir(args.job)
    src = Path(args.audio)
    if not src.exists():
        print(f"ERROR: not found: {src}"); return 1

    tmp = Path(tempfile.mkdtemp())
    wav = tmp/"in.wav"
    subprocess.run(["ffmpeg","-y","-i",str(src),"-vn","-acodec","pcm_s16le","-ar","44100","-ac","2",str(wav)],
                   capture_output=True)
    total = dur(wav)

    print(f"[scrub] stem-splitting {src.name} ({total:.1f}s) via gateway stem_split (MVSEP)…")
    stems = _separate_stems(wav, job/"music"/"stems", job=job)   # {bass,drums,other,vocals}

    keep = []
    for r in args.keep_singing.split(","):
        r = r.strip()
        if "-" in r:
            a, b = r.split("-"); keep.append((float(a), float(b)))

    # instrumental = bass+drums+other
    inputs = ["-i",str(stems["bass"]),"-i",str(stems["drums"]),"-i",str(stems["other"])]
    fc = "[0:a][1:a][2:a]amix=inputs=3:normalize=0[instr];"
    mixparts = ["[instr]"]
    if keep:
        # vocals stem gated to the singing ranges (volume=0 outside, 1 inside, tiny fades)
        inputs += ["-i", str(stems["vocals"])]
        gate = "+".join(f"between(t\\,{a}\\,{b})" for a,b in keep)
        fc += f"[3:a]volume='{gate}':eval=frame[sing];"
        mixparts.append("[sing]")
    fc += "".join(mixparts) + f"amix=inputs={len(mixparts)}:normalize=0[out]"
    out = Path(args.out) if args.out else (job/"music"/f"{src.stem}_scrubbed.wav")
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg","-y",*inputs,"-filter_complex",fc,"-map","[out]",str(out)],capture_output=True)

    log_event(job, tool=TOOL, event="scrubbed",
              extra={"usage_role":"scrub","audio":str(src),"keep_singing":keep,"output":str(out)})
    print(f"[scrub] → {out}  ({dur(out):.1f}s)")
    print("[verify] re-transcribe: talking sections = no speech; kept ranges = the sung hook.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
