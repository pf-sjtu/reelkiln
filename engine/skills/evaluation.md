# Evaluation — evaluate at every step

> **The finished-render review is documented in [`skills/video_qa.md`](video_qa.md)** — the
> validated *generate → verify* method. It is reference material, not an agent step: a
> finished render is a complete draft without it (see [`CLAUDE.md`](../CLAUDE.md)).
> The per-asset-type eval law below is still authoritative, BUT some command examples
> reference **pre-consolidation tool names** (`score.py`, `verify_render.py`,
> `check_overlay_anchors.py`, `seedance.py`, `frame_sample.py`, `agent/tools/…`). Map them
> to the **canonical tools** ([`CANONICAL_TOOLS.md`](../CANONICAL_TOOLS.md)): `score.py`
> → `review_output`(audio)/`verify_output`; `verify_render.py`/`frame_sample.py` →
> `verify_output --mode render --strip`; `check_overlay_anchors.py`/`preflight.py` →
> `check_layout`; `seedance.py` → `perform_avatar`/`mint_video`; `agent/tools/` → `tools/`.
> **TODO: reconcile this doc's commands to the canonical tools.**

How an agent that cannot watch or hear judges its own video outputs. Every
generative step gets a real eval against the right tool BEFORE you proceed.

All tools run from the sandbox repo root with `uv run python agent/tools/<tool>.py`
and take `--job <id>`. Always pass `--job` explicitly — concurrent jobs clobber
`.current_job`.

---

## The governing law: Gemini is EYES, not TASTE

The agent cannot natively see video or hear audio. Gemini (via `gemini_video.py`
for video, `score.py`'s `input_audio` block for raw audio) is the agent's eyes
and ears. **Gemini SURFACES mechanical observations. The agent applies them to
the stated intent and proceeds by default; the human retains consent boundaries,
explicit collaboration, and final ship/no-ship authority.**

- TRUSTWORTHY (pixel/waveform-grounded, MECHANICAL): lip-sync drift with a
  timestamp, dialogue/audio mismatch, dead air, dropouts, clipping, accent/timbre
  drift across chunks, mispronunciation of a specific named word, caption errors
  (off-screen, clipped, overlapping, mistimed, wrong word), overlay collisions
  (covers face, red-zone, off-canvas), deformed anatomy (extra fingers), identity
  drift across chunks, framing collapse, background glitches, music-too-loud-over
  -speech, pace/WPM observations.
- NOT TRUSTWORTHY (TASTE — never a Gemini call; derive from the stated intent and
  direct evidence, with optional human override): "natural", "authentic", "soulful",
  "warm", "polished", "publishable", "engaging", "authority", "energy",
  "compelling", whether the accent "sounds right", whether a hook is "compelling"
  or a payoff "satisfying", any 1-10 quality score, any ship/revise/rebuild
  verdict.

Hard-won evidence (CLAUDE.md rule 6): a render the human shipped scored "3/10
REBUILD"; a worse earlier render scored "9/10 SHIP" from the same prompt. Scores
are noise. **If a Gemini reply contains a score or a taste-word, the PROMPT is
leaking taste — fix the prompt template, not the asset.**

What a leak looks like: ❌ *"rate the overall quality and note anything
unprofessional"* (invites a verdict) → ✅ *"list every observable defect with a
timestamp; if none in a category, say none"* (forces observations). Delete the
inviting clause at the source; don't post-filter the reply.

### Four hard rules (non-negotiable)
1. **Never accept the first output.** Every generative step gets a real eval, and
   you regenerate on any mechanical defect.
2. **Never judge from a 0.3fps screenshot with no audio.** A still cannot reveal
   lip-sync, dropouts, dead air, accent drift, or motion. Where motion or audio
   matter, you MUST send the real media to Gemini.
3. **Every generative step gets a real eval before proceeding** — cheapest rung
   that catches the bug class first, Gemini last.
4. **The regen ladder is bounded.** Mechanical defect → regen same prompt ≤2×;
   still failing → 1 revised-prompt attempt; still failing → STOP and surface the
   asset, the defect list, and the spend so far. Never exceed 3 paid attempts on
   one asset without announcing — rule 1 has a floor AND a ceiling.

---

## The recipe, per asset type

The pattern for every asset: **cheap deterministic check → eyes on a still →
eyes+ears (Gemini) only where motion/audio matter → grounded selection.** The
agent selects by default; human choice is reserved for explicit collaboration,
real-person consent, or a genuinely unresolved material input. Gemini is the last
and most expensive rung.

### 1. Avatar IMAGE (`avatar/avatar_front.png`)

A still has no motion or audio → **no Gemini call is needed or appropriate.**
The eval is the agent's eyes against the casting brief and mechanical checks.

1. After `generate_avatar.py` mints `front`, **`Read` the local PNG inline**
   (mandatory — evaluate the actual pixels, never just a path).
2. Surface alongside it: the verbatim Seedream prompt
   (`character_sheet.json:prompts.front`), `avatar_vision.trust_anchor`, and the
   24h BytePlus-URL TTL.
3. Eyeball against `avatar_prompting_guide.md` §10: anti-uncanny (named
   imperfection actually present? plastic-skin avoided?), IVP fit, background
   credibility (3+ named props, **no legible-text props** — books, diplomas,
   labeled bottles render garbled and are an instant AI-tell).
4. For a fictional/original synthetic avatar, select the strongest grounded passing
   variant by default or re-roll a mechanical miss. Surface options for optional
   casting feedback; pause only when the user explicitly requested selection or all
   variants materially miss. A real person's identity or likeness still requires
   explicit human consent. No score, no Gemini verdict.

### 2. Voice / AUDIO

Judge audio TWO ways — each catches what the other misses.

**(a) Deterministic ground truth — ElevenLabs Scribe v2 transcript.** The real
source of truth for *what words were said and when*.
- `elevenlabs.py` (`transcribe_elevenlabs`, model `scribe_v2`) → word-level
  timestamps.
- `densify.py` → silence-clips inter-word gaps, ~1.20-1.22x stretch, then
  **re-transcribes (PASS 2)** into `transcript.json`. Re-transcription (not
  math-rescale) is the drift-free timing source and lets you compute **effective
  WPM = words / final_duration x 60** (target 215-220 for modern short-form;
  the `_authority_host` slow-brand path stays ~149 natural). WPM and the
  input→output duration delta ARE your objective pacing metric.

  **Pronunciation diff (no Gemini needed):** synthesize → re-transcribe with
  Scribe v2 → diff transcript words against the script `--text`. A divergence =
  a mispronunciation / wrong-word the synth produced. Fix by rewriting the
  offending word phonetically in `--text`.

**(b) Perceptual — Gemini via `score.py`'s `input_audio` block.** `gemini_video.py`
sends VIDEO (`{"type":"video_url",...}`) and has NO audio-only mode. To hand a
raw audio file to Gemini you use `score.py`'s DIFFERENT content block:

```python
import base64, os
from openai import OpenAI

client = OpenAI(base_url="https://openrouter.ai/api/v1",
                api_key=os.environ["OPENROUTER_API_KEY"])
b64 = base64.b64encode(open("<job_dir>/tts/ep_meditations.mp3", "rb").read()).decode("utf-8")
resp = client.chat.completions.create(
    model="google/gemini-2.5-pro",            # score.py's GEMINI_MODEL
    messages=[{"role": "user", "content": [
        {"type": "text", "text": PROMPT_TEXT},
        {"type": "input_audio", "input_audio": {"data": b64, "format": "mp3"}},
    ]}],
    response_format={"type": "json_object"},  # force clean JSON
)
result = resp.choices[0].message.content      # strip ```json fences if present
```

As a CLI, the closest existing invocation is the music-bed audit:
```bash
uv run python agent/tools/score.py --job <id>                # runs the input_audio Gemini pass
uv run python agent/tools/score.py --job <id> --skip-gemini  # mix/diagnose only, no Gemini
```
Its prompt is `agent/skills/gemini_prompts/score_review.md` (observation-only).
There is no `voice_review.md` yet — for a bare VO, author one and feed it via the
`input_audio` block above.

For the Seedance native-audio video path, the voice is judged in-video via
`chunk_review` / `final_review` (Gemini hears the audio track inside the mp4).

What Gemini CAN judge on audio (mechanical, TRUSTWORTHY): pace/WPM and where
delivery speeds/slows (timestamped), pauses/dead air/dropouts mid-clip,
`vocals_detected` on a bed (a ship-blocker — vocals are a generation failure),
voice-band (250Hz-3kHz) collisions for a bed under a voice, clipping/distortion,
loop seams, truncated words, robotic artifacting, mispronunciation of a SPECIFIC
named word, wrong-words-vs-script. What it CANNOT: "sounds natural / sounds AI",
whether the accent/register "lands." For an original, non-cloned synthetic voice,
compare the previews directly with the casting brief and select the strongest grounded
passing option by default; offer optional user casting without waiting for it. Cloning
or impersonating a real person still requires explicit consent. The canonical voice
flow is design → previews → **grounded default selection** → save.

**Recipe (Seedance voice):** generate chunks → `chunk_review --chunk all` → read
each `chunk_review_N.json` → regenerate ONLY on a mechanical audio defect
(dialogue mismatch, dropout, >~1s dead air, accent drift). Never regen on "sounds
flat." After stitch+densify, read `densify_meta.json`, compute WPM, surface it.

### 3. A generated VIDEO CLIP (one Seedance `chunks/chunk_NN.mp4`)

Motion + audio matter → Gemini multimodal is the right tool, with a still backstop.

```bash
# Per-chunk mechanical review (auto-resolves chunks/chunk_00.mp4 → chunk_review_0.json)
uv run python agent/tools/gemini_video.py --job <id> --mode chunk_review --chunk 0

# Review EVERY chunk in parallel (one Gemini call + JSON per chunk)
uv run python agent/tools/gemini_video.py --job <id> --mode chunk_review --chunk all
```

`chunk_review` CAN judge (mechanical): lip-sync wrong-word mouth shapes /
lead-lag with ms estimate; long silence / jumbled or swallowed words / dropout /
clipping; **dialogue-text mismatch** (audio says different words than the
script's `dialogue`); accent/timbre drift vs neighbouring chunks;
identity/continuity drift within the chunk (face/beard/hair/wardrobe/room/
lighting); anatomy (extra/missing fingers, bent limbs, warped face); framing &
motion (unrequested zoom, jitter, drift, subject leaving frame, mechanical cut);
background (shimmer, garbled on-screen text, morphing objects, logo distortion);
and descriptive structural observations (`dialogue_match` exact/close/divergent).

Recipe:
1. `chunk_review --chunk all`, read each `chunk_review_N.json`.
2. Regenerate a chunk ONLY on a mechanical defect it can't ship with: lip-sync
   drift >~150ms or wrong-word mouth, dialogue/audio mismatch, mid-chunk
   dropout/silence, deformed anatomy, identity drift, framing collapse.
3. Do NOT regenerate on taste-adjacent observations ("soulless", "stiff", "lacks
   energy"). If those appear, the template is leaking taste — fix the template.
4. Optional eyes-on-a-still backstop for a suspicious moment:
   `frame_sample.py --job <id> --video chunks/chunk_03.mp4 --at <t> --out check.png`
   → `Read` it.
5. Regen one chunk: `seedance.py --job <id> --chunk N`.

### 4. The FINAL RENDER (`final.mp4`)

A finished render is a complete draft; nothing here has to run before it is shown.
(a) is placement work while you build overlays; (b) is an optional diagnostic look
when you are chasing a specific suspected problem.

**(a) Pre-commit, cheap (no Gemini):**

```bash
# All findWord/findRange anchors in overlays.tsx resolve to the right transcript words
uv run python agent/tools/check_overlay_anchors.py --job <id>

# Red-zone / caption-band / OpenCV Haar face collisions for DECLARED overlays;
# writes caption_luminance.json (renderer auto-flips outline color). Auto-runs in render.
uv run python agent/tools/preflight.py --job <id>            # warn-only
uv run python agent/tools/preflight.py --job <id> --strict   # block render on collision

# verify_render.py — PURE ffmpeg frame extraction, NO audio, NO model.
# Default: ~7 speech-anchored frames (snapped to word starts, never dead air) from final.mp4.
uv run python agent/tools/verify_render.py --job <id>
# Pass every overlay's enter / enter+0.3s / exit timestamp:
uv run python agent/tools/verify_render.py --job <id> --at 5,12,28,45,62,90
# Pre-render avatar quality from final_raw.mp4 (no overlays yet):
uv run python agent/tools/verify_render.py --job <id> --raw
```

`verify_render.py` runs `ffmpeg -ss <t> -i <video> -vframes 1 -q:v 2 <png>` per
timestamp, writes `<job>/verify_frames/frame_<sec>.png`, and prints `Read <path>`
lines. **Seeing JSX overlays:** `preflight.py` **cannot see overlays authored in
`overlays.tsx`** — only declared overlays — so frames at each overlay's enter /
enter+0.3s / exit are the way to see JSX placement: face collision (y≈400-1100),
caption-band collision (y≈1620-1850), off-canvas clipping, z-conflicts. Looking at
them caught the MCC-card-covers-captions bug. On a finished render this is optional;
fix what you find once, per CLAUDE.md "Finishing a render".

**(b) Post-render perceptual (Gemini, eyes + ears) — optional diagnostic:**

```bash
# Final rendered review (auto-resolves <job>/final.mp4 → final_review.json)
uv run python agent/tools/gemini_video.py --job <id> --mode final_review

# Compose dynamically: keep the JSON contract, frame the comparison around THIS job's risk
uv run python agent/tools/gemini_video.py --job <id> --mode final_review \
    --prompt-prefix "Biggest risk: URL pill covering chin at the CTA — scrutinize 0:23-0:28."
```

The mp4 is sent whole (base64 data URL via `video_url`), so Gemini hears the
audio. `final_review` CAN judge (mechanical): caption errors (unreadable
contrast, off-screen, clipped, overlapping another overlay, mistimed,
wrong/missing word, jitter); overlay errors tagged by `overlay_kind`
(hook/lower/url) — covers face, off-screen, red-zone collision, wrong text;
audio (long silence, jumbled words, dialogue/audio mismatch, dropout, clipping,
**background music too loud over speech**); lip-sync drift with timestamp; visual
anomalies (deformed anatomy, extra fingers, identity drift between chunks,
framing collapse, wardrobe/lighting shifts, background glitches); and descriptive
structural observations (`hook_lands_at_sec`, CTA timing, observed cut points,
`reference_match_notes`) — NOT scored.

**"Does this beat fulfil its role" is PARTIAL and only mechanical.** Gemini
reports *where* the hook lands and *how* structure compares to the reference as
flat observations. It will NOT — and is forbidden to — judge whether the hook is
compelling or the payoff satisfying. That is the agent's job, reasoning from the
script's stated intent (log line / mechanism in `vision.md` + `script.json`)
against Gemini's mechanical observations.

**(c) The finished render is a complete draft; the human decides what to change next.
Gemini never does.**

---

## Drop-in summary

```
ASSET            CHEAP / DETERMINISTIC FIRST          EYES (stills)                 EYES+EARS (Gemini)              DECIDES
---------------  -----------------------------------  ----------------------------  ------------------------------  ------------------
Avatar image     avatar_prompting_guide §10 check     Read avatar_front.png inline  (none — still has no motion)    agent default; human for consent/opt-in
Voice / audio    Scribe v2 transcript-diff vs --text; (n/a)                         score.py input_audio block;     agent default; human for consent/opt-in
                 WPM = words/dur*60; densify_meta                                    chunk_review / final_review
                                                                                     (dialogue match, dead air,
                                                                                     dropout, accent drift, lipsync,
                                                                                     music-too-loud)
Video clip       seedance preflight (dialogue,        frame_sample.py on a          chunk_review --chunk all        agent vs script
(Seedance chunk) Image present)                       suspicious moment + Read      (mechanical defects only)       intent; regen on
                                                                                                                     mechanical defect
Final render     check_overlay_anchors.py;            verify_render.py --at ...     final_review                    human ship/no-ship
                 preflight.py (--strict to block)     optional: Read PNGs inline    (compose dynamically)
```

Rules that bind the pattern:
- Pass `--job <id>` on every call.
- Never accept the first output; every generative step gets a real eval first.
- Never judge from a 0.3fps screenshot with no audio — send the real media where
  motion/audio matter.
- Gemini = eyes/ears; it SURFACES, while the agent maps observations to stated
  intent. Strip any taste field that leaks back, and fix the prompt template that
  produced it. Human authority remains for consent, explicit collaboration, and
  final ship/no-ship—not routine intermediate asset selection.
- Cheapest rung that catches the bug class wins: regex anchor check and OpenCV
  preflight cost ~nothing; a still Read costs ~nothing; a Gemini pass costs a
  call — use it only for motion/audio defects stills can't reveal.
- Regenerate Seedance chunks ONLY on mechanical defects, never on taste.
- For anything authored as JSX (`overlays.tsx`), `preflight.py` is blind — frames +
  inline `Read` are how you see its placement.

## Files & ids
- `agent/tools/gemini_video.py` — video→Gemini (`video_url` block,
  `~google/gemini-pro-latest`); hears in-video audio, no audio-only mode. Modes:
  `chunk_review`, `final_review`, `replication_brief`, `score_review`, `custom`.
- `agent/tools/score.py` — the ONLY existing audio→Gemini path (`input_audio`
  block, `google/gemini-2.5-pro`), prompt `score_review.md` (observation-only).
- `agent/tools/verify_render.py` — ffmpeg frame extraction, no audio/model.
- `agent/tools/frame_sample.py` — ad-hoc frame / filmstrip (`--strip`) from any `--video`.
- `agent/tools/preflight.py` — red-zone / caption-band / OpenCV face collision for
  declared overlays; blind to JSX.
- `agent/tools/check_overlay_anchors.py` — static `findWord/findRange` vs `transcript.json`.
- `agent/tools/elevenlabs.py` — transcription only (Scribe v2, `scribe_v2`).
- `agent/tools/densify.py` — silence-clip + ~1.22x stretch + PASS 2 re-transcribe → `transcript.json`.
- Gemini prompt templates: `agent/skills/gemini_prompts/<mode>.md`.
- `.env`: `OPENROUTER_API_KEY` (Gemini eval), `ELEVENLABS_API_KEY` (Scribe).
