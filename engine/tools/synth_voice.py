"""
synth_voice.py — the canonical VO generation primitive.

ONE tool, `--mode {tts | reference_tts | design | transcribe | list_voices | voice_change}`;
the mode picks the job. This file
ABSORBS three former backends (now deleted) and is fully self-contained — it does
NOT import any of them:

  - tts        ← gen_tts.py     (Gemini 3.1 Flash TTS; optional atempo rescue)
  - design     ← voice_design.py (ElevenLabs Voice Design, eleven_multilingual_ttv_v2)
  - transcribe ← elevenlabs.py  (stitch chunks + trim silence + Scribe v2 transcription)

Only the low-level shared helpers that survive are imported: _paths, _ffmpeg, job, log.

  # tts — generate natural spoken audio; project Taste supplies the locked voice
  uv run python tools/synth_voice.py --mode tts --job <id> --text "..." --voice Charon
  uv run python tools/synth_voice.py --mode tts --job <id> --beat-id email_reveal \
      --text "..." --voice Aoede --delivery "Dry, quick, lightly amused."
  uv run python tools/synth_voice.py --mode tts --job <id> --script script.json --voice <voice_id>

  # reference_tts — Seed Audio with rights-cleared reference clips
  uv run python tools/synth_voice.py --mode reference_tts --job <id> \
      --text "Exact line to speak" --reference-audio real/ref.wav \
      --rights-confirmation rights_<receipt> --output voice/clone.mp3

  # design — create + save an ElevenLabs voice from a text description
  uv run python tools/synth_voice.py --mode design --job <id> --name host \
      --description "An elderly aristocratic British man..." \
      --text "Most men carry a book their whole life..."
  uv run python tools/synth_voice.py --mode design --job <id> --name host \
      --save-preview <generated_voice_id> --voice-name "The Host" \
      --description "An elderly aristocratic British man..."

  # transcribe — stitch chunks (or take --audio) → Scribe v2 word-level timings
  uv run python tools/synth_voice.py --mode transcribe --job <id>
  uv run python tools/synth_voice.py --mode transcribe --job <id> --audio densified.mp3
  uv run python tools/synth_voice.py --mode transcribe --job <id> --audio cam_b.mp4 \
      --output transcripts/cam_b.json   # own file; never overwrites transcript.json

MEMORY gate (feedback_contractions_in_scripts): always use contractions in spoken
dialogue (won't / doesn't / it's / you're / here's / that's). Audio is locked after
this runs; expanded forms sound robotic. This tool does NOT fix contractions.

Pacing the stitched audio is NOT this tool (-> densify).
`--job` is ALWAYS required (feedback_always_pass_job). `--mode` is logged as usage_role.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv

# tools/ on sys.path so the sibling helper modules resolve.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from _paths import ENV_PATH  # noqa: E402
from job import (resolve_job_dir, add_job_arg, billing_input_path,
                 billing_optional_input_path, billing_input_glob,
                 resolve_job_output_path)  # noqa: E402
from _billing_manifest import job_path as billing_job_path  # noqa: E402
from log import log_event  # noqa: E402
from _gateway import gateway  # noqa: E402  dual mode: gateway or direct provider key

load_dotenv(ENV_PATH)
load_dotenv()  # also honor a CWD-local .env, matching the old backends

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
FAL_KEY = os.environ.get("FAL_KEY", "")

# --- model ids (preserved verbatim from the absorbed backends) ----------------
TTS_MODEL = "gemini-3.1-flash-tts"
FAL_TTS_MODEL = "fal-ai/gemini-3.1-flash-tts"
ELEVENLABS_TTS_MODEL = "eleven_turbo_v2_5"
TTV_MODEL = "eleven_multilingual_ttv_v2"   # voice_design.py default
SCRIBE_MODEL = "scribe_v2"                 # elevenlabs.py
STS_MODEL = "eleven_multilingual_sts_v2"   # speech-to-speech (voice_change)

API = "https://api.elevenlabs.io/v1"       # voice_design.py REST base

# Curated default voices — preset name -> stable ElevenLabs voice_id (gen_tts.py).
VOICE_PRESETS: dict[str, str] = {
    "rachel":    "21m00Tcm4TlvDq8ikWAM",   # warm, clear, female, business-friendly
    "adam":      "pNInz6obpgDQGcFmaJgB",   # deep, authoritative, male
    "domi":      "AZnzlk1XvdvUeBnXmlld",   # confident, female
    "antoni":    "ErXwobaYiN019PkySvjV",   # well-rounded, male
    "bella":     "EXAVITQu4vr4xnSDxMaL",   # soft, female
    "josh":      "TxGEqnHWrfWFTfGW9XjX",   # young, male
    "arnold":    "VR6AewLTigWG4xSOukaG",   # crisp, male
}

GEMINI_VOICES = {
    voice.lower(): voice for voice in (
        "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede",
        "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome",
        "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus",
        "Pulcherrima", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager",
        "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr",
        "Zubenelgenubi",
    )
}
DEFAULT_GEMINI_DELIVERY = "Speak warmly and clearly."


# =============================================================================
# ElevenLabs SDK loader
#
# A sibling file used to be named elevenlabs.py and shadowed the installed
# `elevenlabs` package. That file is now deleted (folded into this one), but we
# keep the defensive path-dance so a future shadowing sibling can't break the
# import.
# =============================================================================
def _load_elevenlabs_client():
    here = str(_HERE)
    saved = list(sys.path)
    sys.path[:] = [p for p in sys.path if p != here and p != ""]
    try:
        client_mod = importlib.import_module("elevenlabs.client")
    finally:
        sys.path[:] = saved
    return client_mod.ElevenLabs


# =============================================================================
# Shared ffmpeg helpers (inlined; identical recipes to the absorbed backends)
# =============================================================================
def ffprobe_duration(path: Path) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True,
    )
    return float(res.stdout.strip())


def time_stretch_audio(in_path: Path, out_path: Path, speed: float) -> None:
    """atempo time-stretch (gen_tts.py recipe — libmp3lame 192k)."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(in_path),
        "-filter:a", f"atempo={speed:.4f}",
        "-c:a", "libmp3lame", "-b:a", "192k",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg atempo failed: {res.stderr[-500:]}")


def extract_audio(video_path: Path) -> Path:
    """Extract audio from video for transcription (elevenlabs.py recipe)."""
    audio_path = video_path.with_suffix(".mp3")
    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn", "-acodec", "mp3", "-ab", "128k",
        str(audio_path),
    ], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr}")
    return audio_path


# =============================================================================
# MODE: tts  (absorbed from gen_tts.py)
# =============================================================================
def _resolve_tts_voice(voice: str) -> tuple[str, str]:
    """Return (provider voice, semantic model), preserving custom Eleven voices."""
    gemini_voice = GEMINI_VOICES.get(voice.lower())
    if gemini_voice:
        return gemini_voice, TTS_MODEL
    return VOICE_PRESETS.get(voice.lower(), voice), ELEVENLABS_TTS_MODEL


def synthesize_tts(text: str, voice: str, out_path: Path, *, model: str,
                   delivery: str = DEFAULT_GEMINI_DELIVERY,
                   language_code: str = "English (US)", temperature: float = 1,
                   job: Path | None = None) -> float | None:
    """Generate TTS through Gemini, retaining ElevenLabs custom-voice support.

    DUAL MODE: VIDEOCLAW_API_KEY set → the gateway `synth_voice` tts endpoint
    synthesizes and returns the audio as an asset we download to out_path.
    Returns the metered cost for provenance; the shared gateway_call event is
    the single cost carrier, including recovery. Raw-key SDK path
    below runs unchanged and returns None. The downstream WPM atempo
    stretch/stitch ffmpeg stays local in both modes.
    """
    if gateway.enabled():
        print(f"  Generating TTS ({len(text.split())} words) with voice={voice} via gateway...")
        params = (
            {"text": text, "voice": voice,
             "style_instructions": delivery,
             "language_code": language_code, "temperature": temperature,
             "output_format": "mp3"}
            if model == TTS_MODEL else
            {"text": text, "voice_id": voice,
             "output_format": "mp3_44100_192"}
        )
        res = gateway.run(
            "synth_voice", mode="tts",
            params=params, model=model, _ledger_model=model,
            timeout_s=600,
            _delivery=[out_path],
            job=job,
        )
        gateway.download_asset(res["assets"][0], out_path)
        return res.get("cost_usd")

    if model == TTS_MODEL:
        if not FAL_KEY:
            sys.exit("ERROR: FAL_KEY not set in .env")
        print(f"  Generating TTS ({len(text.split())} words) with voice={voice}, model={FAL_TTS_MODEL}...")
        response = requests.post(
            f"https://fal.run/{FAL_TTS_MODEL}",
            headers={"Authorization": f"Key {FAL_KEY}"},
            json={"prompt": text, "voice": voice,
                  "style_instructions": delivery,
                  "language_code": language_code, "temperature": temperature,
                  "output_format": "mp3"},
            timeout=600,
        )
        if response.status_code != 200:
            sys.exit(
                f"Gemini TTS failed [{response.status_code}]: "
                f"{response.text[:400]}")
        audio_url = (response.json().get("audio") or {}).get("url")
        if not audio_url:
            raise RuntimeError("Fal Gemini TTS returned no audio URL")
        audio = requests.get(audio_url, timeout=600)
        audio.raise_for_status()
        out_path.write_bytes(audio.content)
        return None

    if not ELEVENLABS_API_KEY:
        sys.exit("ERROR: ELEVENLABS_API_KEY not set in .env")

    ElevenLabs = _load_elevenlabs_client()
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

    print(f"  Generating TTS ({len(text.split())} words) with voice={voice}, model={model}...")
    audio = client.text_to_speech.convert(
        text=text,
        voice_id=voice,
        model_id=model,
        output_format="mp3_44100_192",
    )
    # SDK returns a generator of byte chunks.
    with open(out_path, "wb") as f:
        for chunk in audio:
            if chunk:
                f.write(chunk)
    return None


def _tts_one(text: str, voice: str, voice_label: str, beat_id: str,
             wpm: float, no_stretch: bool, out_dir: Path, job: Path, *, model: str,
             delivery: str, language_code: str, temperature: float) -> dict:
    """Synthesize one beat and optionally apply the legacy WPM stretch."""
    out_dir.mkdir(parents=True, exist_ok=True)
    natural_path = out_dir / f"{beat_id}.mp3"
    stretched_path = out_dir / f"{beat_id}.stretched.mp3"
    meta_path = out_dir / f"{beat_id}.json"

    t0 = time.perf_counter()
    gw_cost = synthesize_tts(
        text, voice, natural_path, model=model, delivery=delivery,
        language_code=language_code, temperature=temperature, job=job)
    nat_dur = ffprobe_duration(natural_path)
    word_count = len(text.split())
    natural_wpm = word_count / nat_dur * 60
    print(f"  Natural TTS: {nat_dur:.2f}s, {natural_wpm:.0f} WPM ({word_count} words)")

    if no_stretch:
        final_path = natural_path
        final_dur = nat_dur
        final_wpm = natural_wpm
        speed = 1.0
    else:
        # speed = target_wpm / natural_wpm, clamped to atempo's safe range.
        speed = wpm / natural_wpm
        speed = max(0.5, min(2.0, speed))
        time_stretch_audio(natural_path, stretched_path, speed)
        final_path = stretched_path
        final_dur = ffprobe_duration(final_path)
        final_wpm = word_count / final_dur * 60
        print(f"  Stretched {speed:.3f}×: {final_dur:.2f}s, {final_wpm:.0f} WPM")

    with final_path.open("rb") as audio:
        audio_sha256 = hashlib.file_digest(audio, "sha256").hexdigest()
    meta = {
        "evidence_kind": "engine_generated_tts",
        "beat_id": beat_id,
        "text": text,
        "voice_preset": voice_label,
        "voice": voice,
        # Preserve the historical field for consumers; Gemini names are its
        # stable provider-side voice identifiers too.
        "voice_id": voice,
        "model": model,
        "provider_model": FAL_TTS_MODEL if model == TTS_MODEL else model,
        "delivery": delivery if model == TTS_MODEL else None,
        "language_code": language_code if model == TTS_MODEL else None,
        "temperature": temperature if model == TTS_MODEL else None,
        "natural_duration_sec": round(nat_dur, 3),
        "natural_wpm": round(natural_wpm, 1),
        "speed": round(speed, 4),
        "final_duration_sec": round(final_dur, 3),
        "final_wpm": round(final_wpm, 1),
        "word_count": word_count,
        "audio_sha256": audio_sha256,
        "timing_kind": "utterance_envelope",
        "words": [
            {
                "word": word,
                "start": 0.0,
                "end": round(final_dur, 3),
            }
            for word in text.split()
        ],
        "natural_path": str(natural_path.relative_to(job)),
        "final_path": str(final_path.relative_to(job)),
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    with meta_path.open("rb") as evidence_file:
        evidence_sha256 = hashlib.file_digest(evidence_file, "sha256").hexdigest()

    log_event(
        job, tool="synth_voice.py", event="tts_generated",
        duration_seconds=time.perf_counter() - t0,
        # gateway_call already owns the cost; this event describes the asset.
        extra={"usage_role": "tts",
               **({"gateway_cost_usd": round(gw_cost, 4), "gateway": True}
                  if gw_cost is not None else {}),
               **{key: value for key, value in meta.items() if key != "words"},
               "evidence_path": str(meta_path.relative_to(job)),
               "evidence_sha256": evidence_sha256},
    )
    print(f"  Wrote: {final_path.relative_to(job)}")
    print(f"  Meta:  {meta_path.relative_to(job)}")
    return meta


def selected_tts_chunks(chunks: list, requested: int | None) -> list[tuple[int, dict, str]]:
    """Runtime-authoritative paid TTS fan-out, shared with billing."""
    selected = []
    for index, chunk in enumerate(chunks):
        if requested is not None and index != requested:
            continue
        if not isinstance(chunk, dict):
            continue
        text = (chunk.get("text") or chunk.get("dialogue") or "").strip()
        if text:
            selected.append((index, chunk, text))
    return selected


def billing_manifest(args: argparse.Namespace, cwd: Path) -> dict:
    job = billing_job_path(args.job, cwd)
    inputs = []
    count = 1
    if args.mode == "tts" and args.text is None:
        script = job / (args.script or "script.json")
        payload = json.loads(billing_input_path(script).read_text())
        chunks = payload.get("chunks") or payload.get("script") or []
        count = len(selected_tts_chunks(chunks, args.chunk))
        inputs.append({"path": str(script), "kind": "voice_script",
                       **({"dest": "script"} if args.script else {})})
    elif args.mode == "reference_tts":
        for raw in args.reference_audio or []:
            audio = Path(raw).expanduser()
            if not audio.is_absolute() and not (cwd / audio).exists():
                audio = job / audio
            elif not audio.is_absolute():
                audio = cwd / audio
            inputs.append({"path": str(audio), "dest": "reference_audio"})
    elif args.mode in {"transcribe", "voice_change"} and args.audio:
        audio = Path(args.audio).expanduser()
        if not audio.is_absolute() and not (cwd / audio).exists():
            audio = job / audio
        elif not audio.is_absolute():
            audio = cwd / audio
        inputs.append({"path": str(audio), "dest": "audio"})
    elif args.mode == "transcribe":
        approved_final = billing_optional_input_path(job / "final_raw.mp4")
        if args.skip_stitch and approved_final is not None:
            inputs.append({"path": str(job / "final_raw.mp4"),
                           "kind": "voice_final_raw"})
        else:
            inputs.extend({"path": str(path), "kind": "voice_chunk"}
                          for path in billing_input_glob(job / "chunks", "chunk_*.mp4"))
    return {"role": None if args.mode == "tts" else args.mode,
            "count": count, "inputs": inputs}


def run_tts(args: argparse.Namespace, job: Path) -> int:
    out_dir = job / "tts"

    # Gemini names are the normal path; old presets/raw ids retain designed voices.
    if not args.voice:
        sys.exit("--voice is required for --mode tts")
    voice, model = _resolve_tts_voice(args.voice)
    if args.stretch and args.no_stretch:
        sys.exit("--stretch and --no-stretch cannot be combined")
    if not 0 <= args.temperature <= 2:
        sys.exit("--temperature must be between 0 and 2")
    if args.wpm is not None and args.wpm <= 0:
        sys.exit("--wpm must be positive")
    no_stretch = (
        not args.stretch if model == TTS_MODEL else args.no_stretch
    )
    target_wpm = args.wpm or 185
    delivery = args.delivery or DEFAULT_GEMINI_DELIVERY
    if model == TTS_MODEL and args.wpm is not None:
        delivery = f"{delivery} Aim for about {args.wpm:g} words per minute."

    # --- Path A: single-beat synth (gen_tts.py primary path) ------------------
    if args.text is not None:
        _tts_one(
            text=args.text, voice=voice, voice_label=args.voice,
            beat_id=args.beat_id, wpm=target_wpm, no_stretch=no_stretch,
            out_dir=out_dir, job=job, model=model, delivery=delivery,
            language_code=args.language_code, temperature=args.temperature,
        )
        return 0

    # --- Path B: script-driven multi-chunk synth ------------------------------
    # Reads <script> chunks (each with `text`/`dialogue` + `chunk_id`), renders
    # one beat per chunk. `--chunk N` re-runs a single chunk only.
    script_path = billing_input_path(job / (args.script or "script.json"))
    if not script_path.exists():
        sys.exit(f"--mode tts needs --text, OR a script at {script_path}. Neither was found.")
    script = json.loads(script_path.read_text())
    chunks = script.get("chunks") or script.get("script") or []
    if not chunks:
        sys.exit(f"No chunks found in {script_path} (looked for 'chunks' / 'script').")

    metas = []
    for idx, ch, text in selected_tts_chunks(chunks, args.chunk):
        beat_id = str(ch.get("chunk_id", ch.get("id", f"chunk_{idx:02d}")))
        print(f"[chunk {idx}] {beat_id}")
        metas.append(_tts_one(
            text=text, voice=voice, voice_label=args.voice,
            beat_id=beat_id, wpm=target_wpm, no_stretch=no_stretch,
            out_dir=out_dir, job=job, model=model, delivery=delivery,
            language_code=args.language_code, temperature=args.temperature,
        ))

    print(f"Rendered {len(metas)} TTS chunk(s) → {out_dir.relative_to(job)}/")
    return 0


def run_reference_tts(args: argparse.Namespace, job: Path) -> int:
    """Generate rights-cleared reference-voice speech through Seed Audio 1.0."""
    if not gateway.enabled():
        sys.exit("--mode reference_tts requires VIDEOCLAW_API_KEY gateway mode")
    text = (args.text or "").strip()
    if not text:
        sys.exit("--mode reference_tts requires --text")
    if not re.fullmatch(r"rights_[A-Za-z0-9_-]{8,128}", args.rights_confirmation or ""):
        sys.exit("--mode reference_tts requires the app's --rights-confirmation receipt")
    refs = []
    for raw in args.reference_audio or []:
        path = Path(raw).expanduser()
        if not path.is_absolute() and not path.exists():
            path = job / path
        path = billing_input_path(path)
        if not path.exists():
            sys.exit(f"reference audio not found: {path}")
        refs.append(path)
    if not 1 <= len(refs) <= 3:
        sys.exit("--mode reference_tts requires 1..3 --reference-audio clips")
    reference_tokens = ", ".join(f"@Audio{i + 1}" for i in range(len(refs)))
    prompt = (
        "Text-to-speech only. No music, ambience, sound effects, commentary, "
        "or extra words. Treat the supplied clips as complementary examples of "
        f"the same rights-cleared speaker ({reference_tokens}). Match that speaker "
        "and speak exactly this text:\n"
        f"{text}"
    )
    if len(prompt) > 2048:
        sys.exit("reference_tts text is too long for Seed Audio's 2048-character prompt limit")
    out = Path(args.output or f"voice/reference_tts-{uuid.uuid4().hex}.mp3")
    if not out.is_absolute():
        out = job / out
    try:
        out.resolve().relative_to(job.resolve())
    except ValueError:
        sys.exit("reference_tts output path must stay inside the job")
    if out.exists() or out.is_symlink():
        sys.exit("reference_tts output already exists; choose a new --output for a new take. "
                 "Recover an accepted operation instead of generating it again.")
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    result = gateway.run(
        "seed_voice",
        mode="reference_tts",
        references=refs,
        params={
            "prompt": prompt,
            "output_format": "mp3",
            "sample_rate": 48000,
            "speed": args.speed,
            "volume": 1.0,
            "pitch": 0,
            "multilingual": bool(args.multilingual),
        },
        job=job,
        timeout_s=900,
        _delivery=[out],
    )
    gateway.download_asset(result["assets"][0], out)
    log_event(
        job,
        tool="synth_voice.py",
        event="reference_tts_generated",
        duration_seconds=time.perf_counter() - t0,
        extra={
            "usage_role": "reference_tts",
            "model": "bytedance/seed-audio-1.0",
            "reference_count": len(refs),
            "rights_confirmation": args.rights_confirmation,
            "output": str(out.relative_to(job) if out.is_relative_to(job) else out),
            "gateway": True,
            **({"gateway_cost_usd": round(float(result["cost_usd"]), 6)}
               if result.get("cost_usd") is not None else {}),
        },
        render_md=False,
    )
    print(f"  ✓ {out}")
    return 0


# =============================================================================
# MODE: design  (absorbed from voice_design.py)
# =============================================================================
def _design_headers() -> dict:
    if not ELEVENLABS_API_KEY:
        sys.exit("ELEVENLABS_API_KEY not set in env / .env")
    return {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}


def _design_check(resp: requests.Response) -> dict:
    if resp.status_code == 401:
        sys.exit(
            "401 Unauthorized — the ELEVENLABS_API_KEY lacks the required scope.\n"
            "Enable 'Voice Generation' (Text to Voice) + 'Voices: Read & Write' on the key "
            "in the ElevenLabs dashboard, then retry."
        )
    if not resp.ok:
        sys.exit(f"ElevenLabs API error {resp.status_code}: {resp.text[:600]}")
    return resp.json()


def _design_create_previews(args: argparse.Namespace, out: Path) -> None:
    """Phase 1: text-to-voice create-previews (voice_design.py design())."""
    if not (20 <= len(args.description or "") <= 1000):
        sys.exit(f"--description must be 20-1000 chars (got {len(args.description or '')})")
    if not (100 <= len(args.text or "") <= 1000):
        sys.exit(f"--text must be 100-1000 chars (got {len(args.text or '')}) — the line the previews speak")
    out.mkdir(parents=True, exist_ok=True)

    payload = {
        "voice_description": args.description,
        "text": args.text,
        "auto_generate_text": False,
    }
    if args.loudness is not None:
        payload["loudness"] = args.loudness
    if args.guidance is not None:
        payload["guidance_scale"] = args.guidance

    print(f"[design] requesting previews ({args.model}) ...")
    body = {**payload, "model_id": args.model}
    if gateway.enabled():
        # DUAL MODE: same JSON body the raw POST sends, wrapped as
        # params={"action": "previews", ...}. res["output"] is ElevenLabs'
        # create-previews JSON verbatim (base64 audio previews inline — fine
        # through JSON). Cost: design logs no estimate_usd of its own
        # (cost-blind), so job= lets gateway.run write the single
        # gateway_call cost event.
        res = gateway.run(
            "synth_voice", mode="design",
            params={"action": "previews", **body},
            job=args.job_dir, timeout_s=600,
        )
        data = res["output"]
    else:
        resp = requests.post(
            f"{API}/text-to-voice/create-previews",
            headers=_design_headers(),
            json=body,
            timeout=180,
        )
        data = _design_check(resp)
    previews = data.get("previews", [])
    if not previews:
        sys.exit(f"No previews returned. Raw: {json.dumps(data)[:500]}")

    prefix = args.name
    manifest = []
    for i, pv in enumerate(previews):
        gvid = pv.get("generated_voice_id")
        b64 = pv.get("audio_base_64") or pv.get("audio_base64")
        mp3 = out / f"{prefix}_preview_{i+1}.mp3"
        if b64:
            mp3.write_bytes(base64.b64decode(b64))
        manifest.append({
            "index": i + 1,
            "file": str(mp3),
            "generated_voice_id": gvid,
            "duration_secs": pv.get("duration_secs"),
        })
        print(f"  ✓ preview {i+1}: {mp3}  (generated_voice_id={gvid})")

    (out / "previews.json").write_text(json.dumps({
        "description": args.description,
        "text": args.text,
        "model": args.model,
        "previews": manifest,
    }, indent=2))
    print(f"\nSaved previews.json → {out/'previews.json'}")
    print("Listen, then promote your pick:")
    print(f"  uv run python tools/synth_voice.py --mode design --job {args.job} --name {args.name} \\")
    print(f"      --save-preview <generated_voice_id> --voice-name \"The Host\" --description \"...\"")


def _design_save_preview(args: argparse.Namespace, out: Path) -> None:
    """Phase 2: create-voice-from-preview (voice_design.py save())."""
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        "voice_name": args.voice_name or args.name,
        "voice_description": args.description,
        "generated_voice_id": args.save_preview,
    }
    print(f"[design] promoting {args.save_preview} → '{payload['voice_name']}' ...")
    if gateway.enabled():
        # DUAL MODE: same JSON body as the raw POST, action="save".
        # res["output"] is ElevenLabs' create-voice-from-preview JSON verbatim.
        # Cost: cost-blind locally → job= so the gateway logs the single
        # gateway_call cost event.
        res = gateway.run(
            "synth_voice", mode="design",
            params={"action": "save", **payload},
            job=args.job_dir, timeout_s=300,
        )
        data = res["output"]
    else:
        resp = requests.post(
            f"{API}/text-to-voice/create-voice-from-preview",
            headers=_design_headers(),
            json=payload,
            timeout=120,
        )
        data = _design_check(resp)
    voice_id = data.get("voice_id") or data.get("voiceId")
    rec = {"voice_id": voice_id, "name": payload["voice_name"], "description": args.description}

    # Save next to the previews AND into the job-level voice registry so
    # `--mode tts --voice <id>` can reference it (synth_voice.md `design` contract).
    (out / "voice.json").write_text(json.dumps(rec, indent=2))
    registry_path = args.job_dir / "voice_registry.json"
    registry = {}
    if registry_path.exists():
        try:
            registry = json.loads(registry_path.read_text())
        except json.JSONDecodeError:
            registry = {}
    registry[args.name] = rec
    registry_path.write_text(json.dumps(registry, indent=2))

    log_event(
        args.job_dir, tool="synth_voice.py", event="voice_designed",
        extra={"usage_role": "design", "name": args.name, **rec},
    )
    print(f"  ✓ voice_id = {voice_id}")
    print(f"Saved → {out/'voice.json'} and registered '{args.name}' in {registry_path.name}.")
    print(f"Use it with:  --mode tts --voice {voice_id}")


def run_design(args: argparse.Namespace, job: Path) -> int:
    if not args.name:
        sys.exit("--name <slug> is required for --mode design")
    args.job_dir = job
    out = Path(args.out_dir) if args.out_dir else (job / "voice")
    if args.save_preview:
        _design_save_preview(args, out)
    else:
        _design_create_previews(args, out)
    return 0


# =============================================================================
# MODE: transcribe  (absorbed from elevenlabs.py)
# =============================================================================
def _detect_trailing_silence(chunk: Path, silence_db: float = -32.0,
                             min_silence_sec: float = 0.25) -> float | None:
    """ffmpeg silencedetect → cut timestamp for trailing silence (elevenlabs.py)."""
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "info",
        "-i", str(chunk),
        "-af", f"silencedetect=noise={silence_db}dB:d={min_silence_sec}",
        "-f", "null", "-",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    starts: list[float] = []
    for line in res.stderr.splitlines():
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m:
            starts.append(float(m.group(1)))
    if not starts:
        return None

    p = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(chunk),
    ], capture_output=True, text=True)
    try:
        duration = float(p.stdout.strip())
    except ValueError:
        return None

    last_silence_start = starts[-1]
    if duration - last_silence_start > 1.0:
        return None
    keep_padding_sec = 0.18
    cut_at = max(0.0, last_silence_start + keep_padding_sec)
    if cut_at >= duration:
        return None
    return cut_at


def _trim_to(chunk: Path, cut_at: float, out: Path) -> Path:
    """Re-encode a chunk truncated at cut_at seconds (elevenlabs.py)."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", str(chunk),
        "-to", f"{cut_at:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        str(out),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg trim failed: {res.stderr[-500:]}")
    return out


def trim_silence_per_chunk(chunks_dir: Path, job: Path | None = None,
                           silence_db: float = -32.0) -> list[Path]:
    """Per-chunk trailing-silence trim, cached/idempotent (elevenlabs.py)."""
    src_files = billing_input_glob(chunks_dir, "chunk_*.mp4")
    src_files = [f for f in src_files if f.stat().st_size > 100]
    if not src_files:
        return []

    out_dir = chunks_dir / "trimmed"
    out_dir.mkdir(parents=True, exist_ok=True)

    out_paths: list[Path] = []
    total_saved = 0.0
    for src in src_files:
        cached = out_dir / src.name
        cached_marker = out_dir / f".source__{src.name}__{src.stat().st_size}__{int(src.stat().st_mtime)}"
        if cached.exists() and cached_marker.exists():
            out_paths.append(cached)
            continue

        cut_at = _detect_trailing_silence(src, silence_db=silence_db)
        if cut_at is None:
            out_paths.append(src)
            cached_marker.write_text("no_trim")
            continue
        p = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(src),
        ], capture_output=True, text=True)
        try:
            orig_dur = float(p.stdout.strip())
        except ValueError:
            orig_dur = 0.0
        saved = max(0.0, orig_dur - cut_at)
        total_saved += saved

        _trim_to(src, cut_at, cached)
        cached_marker.write_text(f"trimmed_at={cut_at:.3f}")
        out_paths.append(cached)
        print(f"  trimmed {src.name}: {orig_dur:.2f}s → {cut_at:.2f}s (-{saved:.2f}s)")

    if job is not None and total_saved > 0:
        log_event(
            job, tool="synth_voice.py", event="silence_trimmed",
            extra={"usage_role": "transcribe", "total_saved_seconds": round(total_saved, 2),
                   "chunks_processed": len(src_files)},
            render_md=False,
        )
    elif total_saved > 0:
        print(f"  total saved: {total_saved:.2f}s across {len(src_files)} chunks")

    return out_paths


def stitch_chunks(chunks_dir: Path, raw_out: Path, *, trim_silence: bool = True,
                  job: Path | None = None) -> Path:
    """Stitch all chunk mp4s in order (elevenlabs.py — concat filter / stream-copy)."""
    if trim_silence:
        chunk_files = trim_silence_per_chunk(chunks_dir, job=job)
    else:
        chunk_files = billing_input_glob(chunks_dir, "chunk_*.mp4")
        chunk_files = [f for f in chunk_files if f.stat().st_size > 100]

    if not chunk_files:
        raise FileNotFoundError(f"No valid chunk files found in {chunks_dir}")

    print(f"Stitching {len(chunk_files)} chunks{' (trimmed)' if trim_silence else ''}...")
    raw_out.parent.mkdir(parents=True, exist_ok=True)

    if trim_silence:
        # Concat FILTER (re-encode) — handles disparate codecs/timestamps.
        inputs: list[str] = []
        for f in chunk_files:
            inputs.extend(["-i", str(f.resolve())])
        n = len(chunk_files)
        filter_complex = (
            "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n))
            + f"concat=n={n}:v=1:a=1[outv][outa]"
        )
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-c:a", "aac", "-b:a", "192k",
            str(raw_out),
        ]
    else:
        # Stream-copy fast path when not trimming.
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            for chunk in chunk_files:
                f.write(f"file '{chunk.resolve()}'\n")
            list_path = f.name
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "concat", "-safe", "0",
            "-i", list_path,
            "-c", "copy",
            str(raw_out),
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg stitch failed: {result.stderr[-500:]}")

    print(f"Stitched video saved to {raw_out} ({raw_out.stat().st_size // 1024 // 1024}MB)")
    return raw_out


def transcribe_elevenlabs(audio_path: Path, *, diarize: bool = False,
                          job: Path | None = None) -> dict:
    """Scribe v2 word-level transcription (elevenlabs.py — verbatim params).

    `diarize=True` asks Scribe for per-word speaker labels — the longform→shorts
    path (multi-angle interview / 2-person cut) needs to know who is speaking to
    cut to the right angle. Each word then carries `speaker` (e.g. "speaker_0");
    the result also gets a `speakers` list of the distinct labels seen.

    DUAL MODE: VIDEOCLAW_API_KEY set → the call routes through the gateway
    (gateway.upload turns the local audio file into a signed GCS URL; the server
    returns ElevenLabs' STT JSON verbatim in res["output"], the same schema the
    SDK dumps, so the shared normalization below applies to both — spacing-token
    drop, per-word "text"→"word", "language_code"→"language", diarize speakers).
    No key of either kind → the same PLACEHOLDER transcript as before.
    """
    if gateway.enabled():
        print(f"Sending to ElevenLabs Scribe via gateway ({SCRIBE_MODEL}{', diarized' if diarize else ''})...")
        # Cost: the transcript_completed event carries no estimate_usd
        # (cost-blind locally), so job= lets gateway.run write the single
        # gateway_call cost event — no double count (densify.py precedent).
        res = gateway.run(
            "synth_voice", mode="transcribe",
            references=[audio_path],  # local path → gateway.upload → signed GCS URL
            params={"diarize": diarize},
            job=job,
            timeout_s=900,
        )
        data = res["output"]  # ElevenLabs' response, unmodified — normalized below
    elif not ELEVENLABS_API_KEY:
        print("[SKIP] No ELEVENLABS_API_KEY — generating placeholder transcript")
        return {
            "words": [{"word": "PLACEHOLDER", "start": 0.0, "end": 1.0}],
            "text": "PLACEHOLDER TRANSCRIPT",
            "language": "unknown",
        }
    else:
        print(f"Sending to ElevenLabs Scribe ({SCRIBE_MODEL}{', diarized' if diarize else ''})...")
        ElevenLabs = _load_elevenlabs_client()
        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

        with open(audio_path, "rb") as f:
            result = client.speech_to_text.convert(
                file=f,
                model_id=SCRIBE_MODEL,
                tag_audio_events=False,
                language_code="eng",
                diarize=diarize,
            )

        data = result.model_dump() if hasattr(result, "model_dump") else dict(result)

    words = []
    speakers: set[str] = set()
    for w in data.get("words", []):
        if w.get("type") == "spacing":
            continue
        word = {
            "word": w.get("text", w.get("word", "")),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
        }
        if diarize:
            spk = w.get("speaker_id") or w.get("speaker")
            if spk is not None:
                word["speaker"] = spk
                speakers.add(str(spk))
        words.append(word)

    out = {
        "text": data.get("text", ""),
        "words": words,
        "language": data.get("language_code", "eng"),
    }
    if diarize:
        out["speakers"] = sorted(speakers)
    return out


def transcript_output_path(args: argparse.Namespace, job: Path) -> Path:
    """Where --mode transcribe writes its JSON: <job>/transcript.json by default.

    `--output` (job-relative, or `jobs/<id>/...`) lets parallel transcripts of
    different files each keep their own result instead of all racing for the
    one shared transcript.json. Checked before any audio work or paid call.
    """
    if not args.output:
        return job / "transcript.json"
    try:
        out = resolve_job_output_path(args.output, job)
    except ValueError as exc:
        sys.exit(f"--mode transcribe --output: {exc}")
    if out.suffix.lower() != ".json":
        sys.exit(f"--mode transcribe --output must name a .json file: {args.output!r}")
    if out.is_dir():
        sys.exit(f"--mode transcribe --output is a directory: {out}")
    return out


def run_transcribe(args: argparse.Namespace, job: Path) -> int:
    transcript_out = transcript_output_path(args, job)

    # --- Source A: explicit --audio (e.g. densified.mp3, external audio) ------
    if args.audio:
        audio_in = Path(args.audio)
        if not audio_in.is_absolute() and not audio_in.exists():
            audio_in = job / args.audio
        audio_in = billing_input_path(audio_in)
        if not audio_in.exists():
            sys.exit(f"--audio not found: {audio_in}")
        # If it's a video, pull the audio track first.
        if audio_in.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}:
            audio_path = extract_audio(audio_in)
            cleanup = True
        else:
            audio_path = audio_in
            cleanup = False
    else:
        # --- Source B: stitch chunks → final_raw.mp4 → extract audio ----------
        chunks_dir = job / "chunks"
        raw_out = job / "final_raw.mp4"
        approved_raw = billing_optional_input_path(raw_out)
        if args.skip_stitch and approved_raw is not None:
            raw_out = approved_raw
            print(f"Using existing {raw_out}")
        else:
            stitched = stitch_chunks(
                chunks_dir, raw_out,
                trim_silence=not args.no_trim_silence, job=job,
            )
            log_event(
                job, tool="synth_voice.py", event="chunks_stitched",
                extra={
                    "usage_role": "transcribe",
                    "output_path": str(stitched.relative_to(job)),
                    "size_bytes": stitched.stat().st_size,
                    "trim_silence": not args.no_trim_silence,
                },
            )
        audio_path = extract_audio(raw_out)
        cleanup = True

    print(f"Audio for transcription: {audio_path}")

    _t0 = time.perf_counter()
    transcript = transcribe_elevenlabs(audio_path, diarize=getattr(args, "diarize", False), job=job)
    log_event(
        job, tool="synth_voice.py", event="transcript_completed",
        duration_seconds=time.perf_counter() - _t0,
        extra={
            "usage_role": "transcribe",
            "model": SCRIBE_MODEL,
            "words": len(transcript.get("words", [])),
            "language": transcript.get("language", "unknown"),
            "text_chars": len(transcript.get("text", "")),
            "placeholder": (transcript.get("words") or [{}])[0].get("word") == "PLACEHOLDER",
            "output": str(transcript_out.resolve().relative_to(job.resolve())),
        },
    )

    transcript_out.parent.mkdir(parents=True, exist_ok=True)
    transcript_out.write_text(json.dumps(transcript, indent=2))
    print(f"Transcript saved to {transcript_out}")
    print(f"  {len(transcript['words'])} words, language: {transcript.get('language', 'unknown')}")
    print(f"  Preview: {transcript['text'][:200]}")

    if cleanup:
        Path(audio_path).unlink(missing_ok=True)
    return 0


# =============================================================================
# MODE: list_voices  —  browse/search the account's ElevenLabs voice library
# =============================================================================
def run_list_voices(args, job) -> int:
    """GET /v1/voices → print voice_id + name + gender/accent/description so a
    voice can be picked for --mode tts (--voice) or --mode voice_change (--voice).
    Optional --query filters by substring across name + labels."""
    if gateway.enabled():
        # DUAL MODE: res["output"] is ElevenLabs' GET /v1/voices JSON verbatim.
        # Cost: no local cost event → job= so the gateway logs the (likely $0)
        # gateway_call event.
        res = gateway.run("synth_voice", mode="list_voices", params={},
                          job=job, timeout_s=120)
        voices = res["output"].get("voices", [])
    else:
        if not ELEVENLABS_API_KEY:
            sys.exit("ELEVENLABS_API_KEY is not set.")
        resp = requests.get(f"{API}/voices", headers={"xi-api-key": ELEVENLABS_API_KEY}, timeout=60)
        resp.raise_for_status()
        voices = resp.json().get("voices", [])
    q = (args.query or "").lower().strip()
    rows = []
    for v in voices:
        labels = v.get("labels") or {}
        hay = " ".join([v.get("name", ""), *[str(x) for x in labels.values()],
                        v.get("description") or ""]).lower()
        if q and q not in hay:
            continue
        rows.append({
            "voice_id": v.get("voice_id", ""),
            "name": v.get("name", ""),
            "gender": labels.get("gender", ""),
            "accent": labels.get("accent", ""),
            "age": labels.get("age", ""),
            "use_case": labels.get("use_case", labels.get("use case", "")),
            "description": (v.get("description") or labels.get("description", ""))[:60],
        })
    print(f"{len(rows)} voice(s){' matching '+repr(q) if q else ''}:\n")
    for r in rows:
        print(f"  {r['voice_id']}  {r['name']:<20}  {r['gender']:<7} {r['age']:<12} "
              f"{r['accent']:<12} {r['use_case']:<14} {r['description']}")
    # persist for downstream selection
    out = Path(job) / "voices.json"
    out.write_text(json.dumps(rows, indent=2))
    print(f"\n→ {out}")
    return 0


# =============================================================================
# MODE: voice_change  —  speech-to-speech: keep the delivery/timing, swap timbre
# =============================================================================
def run_voice_change(args, job) -> int:
    """POST /v1/speech-to-speech/{voice_id} — transform a REAL recorded VO into a
    target voice while preserving timing/emotion/delivery. Because timing is
    preserved, the existing transcript.json / caption timing / focus_track stay in
    sync — you only swap the voice. Inputs: --audio (source) + --voice (target id
    or preset). Output: --output <path>."""
    if not gateway.enabled() and not ELEVENLABS_API_KEY:
        sys.exit("ELEVENLABS_API_KEY is not set (and no VIDEOCLAW_API_KEY for gateway mode).")
    if not args.audio:
        sys.exit("--mode voice_change requires --audio <source recording>.")
    if not args.voice:
        sys.exit("--mode voice_change requires --voice <voice_id or preset>.")
    if not args.output:
        sys.exit("--mode voice_change requires --output <path>.")
    src = Path(args.audio)
    if not src.is_absolute() and not src.exists():
        src = Path(job) / args.audio
    src = billing_input_path(src)
    if not src.exists():
        sys.exit(f"source audio not found: {src}")
    voice_id = VOICE_PRESETS.get(args.voice.lower(), args.voice)
    out = Path(args.output)
    if not out.is_absolute():
        out = Path(job) / args.output
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"  voice_change: {src.name} → voice={voice_id} (model={STS_MODEL})")
    if gateway.enabled():
        # DUAL MODE: source audio uploads via signed GCS URL; the transformed
        # audio comes back as an asset we download to --output. Cost: the
        # voice_change event carries no estimate_usd (cost-blind locally), so
        # job= lets gateway.run write the single gateway_call cost event.
        res = gateway.run(
            "synth_voice", mode="voice_change",
            references=[src],  # local path → gateway.upload → signed GCS URL
            params={"voice_id": voice_id,
                    "remove_background_noise": bool(args.remove_noise)},
            job=job, timeout_s=600,
            _delivery=[out],
        )
        gateway.download_asset(res["assets"][0], out)
    else:
        with open(src, "rb") as fh:
            resp = requests.post(
                f"{API}/speech-to-speech/{voice_id}",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                params={"output_format": "mp3_44100_192"},
                data={"model_id": STS_MODEL,
                      "remove_background_noise": "true" if args.remove_noise else "false"},
                files={"audio": (src.name, fh, "audio/mpeg")},
                timeout=600,
            )
        if resp.status_code != 200:
            sys.exit(f"speech-to-speech failed [{resp.status_code}]: {resp.text[:400]}")
        out.write_bytes(resp.content)
    log_event(job, tool="synth_voice.py", event="voice_change",
              extra={"voice_id": voice_id, "source": src.name, "output": str(out)},
              render_md=False)
    print(f"  ✓ {out} ({out.stat().st_size // 1024} KB)")
    print(f"  Timing preserved → re-mux over final_raw.mp4 and re-render; captions/focus_track stay in sync.")
    return 0


# =============================================================================
# CLI
# =============================================================================
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False, 
        prog="synth_voice.py",
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    add_job_arg(p)  # --job REQUIRED
    p.add_argument("--mode", required=True,
                   choices=["tts", "reference_tts", "design", "transcribe", "list_voices", "voice_change"],
                   help="Which job to run. Logged as usage_role. REQUIRED.")

    # --- tts ---
    g_tts = p.add_argument_group("tts mode")
    g_tts.add_argument("--voice", default=None,
                       help="tts: Gemini voice name, legacy ElevenLabs preset, or raw voice_id. "
                            "Required; project Taste should supply the locked choice.")
    g_tts.add_argument("--text", default=None,
                       help="tts: text to synthesize (single-beat path). "
                            "design: the 100-1000 char line the previews speak.")
    g_tts.add_argument("--beat-id", default="tts",
                       help="tts single-beat: file saved as tts/<beat-id>.{mp3,stretched.mp3,json}")
    g_tts.add_argument("--wpm", type=float, default=None,
                       help="tts: optional generation pace; legacy/rescue stretch defaults to 185")
    g_tts.add_argument("--no-stretch", action="store_true",
                       help="tts: skip WPM time-stretch (Gemini already does by default)")
    g_tts.add_argument("--stretch", action="store_true",
                       help="tts: explicitly post-stretch Gemini audio to --wpm")
    g_tts.add_argument("--delivery", default=None,
                       help="tts: Gemini delivery direction; lock with the project voice")
    g_tts.add_argument("--language-code", default="English (US)",
                       help="tts: Gemini language (default English (US))")
    g_tts.add_argument("--temperature", type=float, default=1,
                       help="tts: Gemini delivery variation, 0..2 (default 1)")
    g_tts.add_argument("--script", default=None,
                       help="tts: script.json with chunks (default <job>/script.json) — multi-chunk path")
    g_tts.add_argument("--chunk", type=int, default=None,
                       help="tts script path: re-run ONE chunk index only")
    g_tts.add_argument("--reference-audio", action="append", default=[],
                       help="reference_tts: rights-cleared audio clip; repeat 1..3 times")
    g_tts.add_argument("--rights-confirmation", default=None,
                       help="reference_tts: receipt returned by the app rights confirmation")
    g_tts.add_argument("--multilingual", action="store_true",
                       help="reference_tts: enable Seed Audio's multilingual model")
    g_tts.add_argument("--speed", type=float, default=1.0,
                       help="reference_tts: provider speech speed, 0.5..2.0")

    # --- design ---
    g_des = p.add_argument_group("design mode")
    g_des.add_argument("--name", default=None,
                       help="design: slug to save the voice under (in voice_registry.json)")
    g_des.add_argument("--description", default=None,
                       help="design: voice description, 20-1000 chars")
    g_des.add_argument("--model", default=TTV_MODEL,
                       help=f"design: text-to-voice model id (default {TTV_MODEL})")
    g_des.add_argument("--out-dir", default=None,
                       help="design: where to write previews/voice.json (default <job>/voice)")
    g_des.add_argument("--prefix", default=None, help="(unused alias; --name is the slug)")
    g_des.add_argument("--loudness", type=float, default=None, help="design: -1..1 (optional)")
    g_des.add_argument("--guidance", type=float, default=None,
                       help="design: guidance_scale 0..100 (optional; higher=closer to description)")
    g_des.add_argument("--save-preview", default=None,
                       help="design phase 2: generated_voice_id from previews.json to promote to a real voice")
    g_des.add_argument("--voice-name", default=None,
                       help="design phase 2: human-readable voice name (defaults to --name)")

    # --- transcribe ---
    g_tr = p.add_argument_group("transcribe mode")
    g_tr.add_argument("--audio", default=None,
                      help="transcribe: re-transcribe an existing audio/video file (densified or external)")
    g_tr.add_argument("--skip-stitch", action="store_true",
                      help="transcribe: reuse existing final_raw.mp4 instead of re-stitching chunks")
    g_tr.add_argument("--no-trim-silence", action="store_true",
                      help="transcribe: disable per-chunk trailing-silence trim before stitch")
    g_tr.add_argument("--diarize", action="store_true",
                      help="transcribe: ask Scribe for per-word speaker labels (longform→shorts "
                           "multi-angle/interview cut — each word gets `speaker`, + a `speakers` list)")

    # --- list_voices / voice_change ---
    g_v = p.add_argument_group("list_voices / voice_change modes")
    g_v.add_argument("--query", default=None,
                     help="list_voices: filter voices by substring (name/gender/accent/use_case)")
    g_v.add_argument("--output", default=None,
                     help="voice_change: output audio path (relative paths resolve under <job>/). "
                          "transcribe: transcript JSON path inside the job (default "
                          "<job>/transcript.json) — give each parallel transcript its own file.")
    g_v.add_argument("--remove-noise", dest="remove_noise", action="store_true",
                     help="voice_change: isolate voice / remove background noise from the source")
    return p


def main() -> int:
    args = build_parser().parse_args()
    job = resolve_job_dir(args.job)

    log_event(
        job, tool="synth_voice.py", event="invoked",
        extra={"usage_role": args.mode}, render_md=False,
    )

    if args.mode == "tts":
        return run_tts(args, job)
    if args.mode == "reference_tts":
        return run_reference_tts(args, job)
    if args.mode == "design":
        return run_design(args, job)
    if args.mode == "transcribe":
        return run_transcribe(args, job)
    if args.mode == "list_voices":
        return run_list_voices(args, job)
    if args.mode == "voice_change":
        return run_voice_change(args, job)
    return 1


if __name__ == "__main__":
    sys.exit(main())
