# assemble — the timeline CONTRACT (mandatory) + an EDL executor (convenience)

Deterministic, $0, no API. Two things live here, with different force:

**THE CONTRACT — every assembled timeline declares itself, however it was built.**
`chunk_boundaries.json` + per-beat role-log events are what let `review_output`'s
role-judge work on assembled timelines instead of mislabeling them (the pre-2026-07
chronic defect). Hand-rolled a bespoke ffmpeg/PIL timeline? Often the right call —
the proven idea catalog is [`skills/assembly_craft.md`](../assembly_craft.md). Then
declare what you built:

```
uv run python tools/assemble.py --job <id> --edl <edl.json> --declare
# loose EDL: beats need only {"name", "role", "start", "end"} timeline seconds
```

`--declare` is declaration-only only for that explicit `start`/`end` shape. If it is
passed with the normal source EDL below, `assemble` does not fail or ask you to retry:
it renders normally and writes the declaration automatically. In the normal executor
path, omit `--declare` because rendering already includes it.

**THE EXECUTOR — the convenience path for the boring 80%** (trim → normalize → concat →
mux is re-derived in every hand script; nobody's creativity lives there). The agent
AUTHORS the EDL (beat order, trims, roles — that is the creative work); `assemble`
executes it and declares the timeline as a side effect. Prototype schema came from the
trend-dup build's `edl.json`; validated on a synthetic 3-beat job (video+still+video ·
VO+bed · diegetic · video-only) 2026-07-10.

```
uv run python tools/assemble.py --job <id> [--edl edl.json] [--check] [--output final_raw.mp4]
```

**Always `--check` first** — free; validates sources/trims and prints the beat table +
the VO-vs-timeline delta (a >0.5s delta is the #1 silent assembly bug — fix it BEFORE
captions render on top).

## The EDL (`jobs/<id>/edl.json`)

```json
{
  "fps": 30, "width": 1080, "height": 1920,
  "beats": [
    {"name": "b1_hook", "source": "aroll/base_lipsynced.mp4", "in": 0.0, "out": 8.7,
     "role": "face", "grade": "warm_face"},
    {"name": "b2_card", "source": "images/card.png", "duration": 3.2,
     "role": "card", "motion": "kenburns_in"},
    {"name": "b3_broll", "source": "broll/clip.mp4", "in": 0, "out": 4.0,
     "role": "broll", "grade": "warm_light", "keep_audio": true}
  ],
  "audio": {
    "from_beats": false,
    "vo":  {"source": "edit/audio_densified.mp3", "gain": 1.0},
    "bed": {"source": "audio/bed.mp3"}
  },
  "output": "final_raw.mp4"
}
```

- **beats** — video beats trim by `in`/`out` (or `in`+`duration`); stills need `duration`.
  `name` must be unique (it keys the role-log). `role` is the declared usage_role on
  record for that beat (`face` / `broll` / `card` / `insert` / `hook` / `endcard` / …).
- **motion (stills)** — `kenburns_in` (default — every static gets motion, the
  visual-interest law) · `kenburns_down` · `none` (deliberate only).
- **grade** — `warm_face` (counteracts sync-3's cold wash; proven values) ·
  `warm_light` (b-roll) · `none` (default). Raw escape hatch: `"vf": "<filter>"`.
- **audio** — three shapes: VO(+`bed` at one steady level under it) · `from_beats: true`
  keeps diegetic beat audio (stills + audio-less sources get silence so the track stays
  continuous; per-beat opt-out `keep_audio: false`) · neither → video-only timeline
  (audio muxes later, e.g. in `compose_render --mode retrofit`).
- **bed level** — one constant level, never pumping (videoclaw#321). With no `gain`, the
  bed is matched `under_voice_db` (default 12) below the VO — or below the beats' own
  audio with `from_beats` — by integrated loudness. Skits and recreations: `"under_voice_db":
  15` (one steady bed, a little softer; never cut or muted under a spoken line). An explicit `under_voice_db` is used
  as written; an explicit `gain` too, but never closer than 8 dB under the voice (clamped,
  with a log line). The bed never ducks: a leftover `"duck": true` is ignored with one log
  line, and a `gain` written beside it (chosen for a ducked bed) is ignored too, so the bed
  is levelled 12 dB under.
- **master** — a bed under a voice is mastered to -14 LUFS, true peak ≤ -1 dBTP, without a
  dynamic loudnorm: measured first, then the voice takes one gain + a peak limiter and the
  bed one linear gain that follows it, so the gap holds and the pauses don't pump. Other
  mixes keep the single-pass `loudnorm`; `"audio": {"loudnorm": false}` opts out.
- Sources resolve job-relative first, then repo-relative.

## Outputs

- `jobs/<id>/final_raw.mp4` (or the EDL's `output`) — 1080×1920 x264/aac by default.
- `jobs/<id>/chunk_boundaries.json` — the beat boundaries `review_output` reads.
- `run.log.jsonl` — one `beat_assembled` event per beat carrying `usage_role` + `name`
  (review_output's `_GEN_TOOLS` reads assemble.py as an authoritative role source),
  plus a `timeline_assembled` summary (`estimate_usd: 0`).
- `jobs/<id>/assemble_segs/` — the normalized per-beat segments (rebuilt every run).

## NOT this tool

- **Captions / overlays / brand layer** → `compose_render --mode retrofit` over this
  tool's output. assemble makes `final_raw.mp4`; retrofit makes `final.mp4`.
- **The aroll split-screen (top 1080×1080 + band 1080×840) layout** → not in v1; that
  path keeps the aroll-reel workflow's documented ffmpeg until a `layout: split` lands.
- **Transitions beyond hard cuts** → deliberate; hard cuts are the house grammar
  (transition craft is an open TODO in aroll-reel).
- **Creative decisions** — it will not pick beats, trims, or roles. Author the EDL.
- **Bespoke one-of-one assemblies** (split-screen, PIP composites, kinetic text systems,
  beat-stabbed beds…) — go your own way with the ideas in
  [`skills/assembly_craft.md`](../assembly_craft.md); just `--declare` afterwards.
