# Gemini Video Analysis Guide

Gemini is your eyes. You cannot natively understand video. Use it at every step where visual understanding matters.

## When to call Gemini

| Step | When | What to ask |
|---|---|---|
| Step 2 | Evaluating top 2–3 candidate videos | Deep viral analysis — why did this perform, can we replicate it |
| Step 5 | Before writing the script | Same as above, plus request visual breakdown by timestamp |
| Step 6 | After each generated chunk | Quality review — does it match intent, continuity check |
| Step 7b | After final render | Overall quality pass, caption placement, pacing suggestions |

## How to call Gemini

```bash
# Deep analysis of a reference video
uv run python agent/tools/gemini_video.py \
  --url "https://www.tiktok.com/@handle/video/123" \
  --mode analysis \
  --output agent/output/analysis_video_title.json

# Review a generated chunk
uv run python agent/tools/gemini_video.py \
  --url "file://agent/output/chunks/chunk_00.mp4" \
  --mode chunk_review \
  --chunk 0

# Custom question
uv run python agent/tools/gemini_video.py \
  --url "https://..." \
  --mode custom \
  --prompt "What is the exact camera distance and angle at the 10 second mark?"
```

## Asking good questions

Gemini returns what you ask for. Be specific and verbose. Examples:

**Good:**
> "Describe exactly what is happening between seconds 0 and 5. What does the speaker do physically? What text appears on screen? What is the camera angle? What emotion does this create in the viewer?"

**Bad:**
> "What happens at the start?"

## What Gemini can tell you

- Frame-by-frame visual description at any timestamp
- Speaker body language, facial expressions, gestures
- Text overlays, captions, graphics on screen
- Camera movement, angle, distance (close-up / medium / wide)
- Lighting and background environment
- Pacing and energy — how does it feel to watch?
- Why a specific moment is emotionally effective
- Whether a generated chunk matches the intended prompt

## What Gemini cannot reliably tell you

- Exact pixel-level measurements
- Whether audio is perfectly synced (listen yourself)
- Future viewer behaviour

## Extracting a specific frame

If you need to see a specific moment yourself, use:
```bash
ffmpeg -i video.mp4 -ss 10.5 -frames:v 1 frame_10s.png
```
Then you can look at the image directly.
