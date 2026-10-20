# skills/score_synthesis — write a cue as code (music-recreation Route D)

The deterministic half of [`workflows/music-recreation.md`](../../workflows/music-recreation.md).
When a bed has to hit **named timestamps** — a drop on a cut, an impact under a flash — prose
cannot bind an event to a time and a generator will not build an arrangement. Writing the
score as code makes placement **exact by construction**: `grid.step(bar, s)` returns a float,
so the drop isn't *near* the mark, it's *on* it. Re-keying is one argument, not a re-roll.

> **⚠️ THE EXCEPTION ROUTE — check the entry condition before you copy the template.**
> Route G (generate) is the default; **Route D music is typically bad**, because exactness is
> bought with timbre (standing commitment, [`taste/GLOBAL.md`](../../taste/GLOBAL.md),
> 2026-08-01). Everything in this skill is true and the output still usually loses to a
> generated take. Come here only when **the beat requirement is tight** — many marks the music
> must hit, dense enough that Stage 7's post-imposition can't carry it — with a
> **synthesizable palette** (13 synthesized voices, including `v_piano`'s modeled struck
> string — but no strings, brass, woodwind, guitar, choir or room, and no sampler), and **say
> so in one line first**. One or two drops is not tight: that is Route G + Stage 7.

| File | What it is |
|---|---|
| [`synth.py`](synth.py) | the engine — grid, voice bank, Schroeder FX, mix/master helpers. Import it; don't edit it per job. `--selftest` = 18 checks, no I/O, no spend. |
| [`score_template.py`](score_template.py) | a complete, runnable cue. **Copy into the job and rewrite `build()`** — the arrangement is a default, not a recipe. |

`numpy`/`scipy` only. No `--job`, no API surface, **$0 vendor spend** — this writes no job
artifacts, so it is a skill rather than a tool. The paid halves stay where they belong:
`tools/score_bed.py` (generation) and `tools/gemini_video.py` (listening).

---

## The loop

```bash
# 1. MEASURE the reference — never retype a tempo or a key by ear
uv run python tools/decode_audio.py --job $JOB --mode grid --input reference/ref.mp4

# 2. WRITE the cue against that spec
cp skills/score_synthesis/score_template.py jobs/$JOB/audio/score.py
uv run python jobs/$JOB/audio/score.py --spec jobs/$JOB/audio/spec.json \
    --out jobs/$JOB/audio/bed_raw.wav --root 35        # 35 = B1; THIS is the key

# 3. FINISH + VERIFY with the same tool that produced the spec
uv run python tools/decode_audio.py --job $JOB --mode finish --spec jobs/$JOB/audio/spec.json \
    --input jobs/$JOB/audio/bed_raw.wav --output jobs/$JOB/audio/bed.wav
uv run python tools/decode_audio.py --job $JOB --mode verify --spec jobs/$JOB/audio/spec.json \
    --input jobs/$JOB/audio/bed.wav
```

**That closure is the whole advantage.** Route D's verification is a *control loop*: measure a
defect → change one coefficient → re-render. In the generate route, measuring only tells you
whether to keep the take. Run the identical probes on both so their findings sit on one scale.

`score_template.py` renders a 35s cue in ~90s. Plan for that runtime: it is an
iterate-and-remeasure loop, not a one-shot.

---

## Writing the arrangement

`build(grid, root)` gets a `Grid` carrying the reference's measured clock:

```python
grid.bpm  grid.phase  grid.duration      # measured, from spec.json
grid.beat  grid.bar  grid.s16  grid.n_bars
grid.t_of(bar)          # absolute time of a (fractional) bar
grid.step(bar, s)       # absolute time of 16th-step s in that bar
grid.drops              # bar indices carrying a structural impact
grid.breakdown          # bar indices that strip down
```

Voices (all return mono float arrays; stamp them with `Track.add(sig, t, gain, pan)`):
`v_sub` `v_pulse` `v_body` `v_bell` `v_pad` `v_kick` `v_clap` `v_hat` `v_riser` `v_impact`
`v_revcym` `v_shimmer`. FX: `reverb` `delay_fx` `comb` `allpass`, `stereo(fn, buf, …)` to run
a mono effect on both channels. Master: `hp` `lp` `breakdown_filter` `air_lift` `soft_clip`
`fade_tail` `finalize`.

Loudness is deliberately NOT done here — `decode_audio --mode finish` does the two-pass
−14 LUFS / −1.0 dBTP normalization, so the number is *measured* rather than asserted.

---

## Traps this engine has already hit

Each of these was a real defect found by measuring the render, not by listening.

**A drop must clear its own baseline.** A structural impact is detected — and heard — as a
*rise above the track's own median*, not as a crash. Run the sub continuously and a "drop" is
only a cymbal over an unchanged low end: `decode_audio` correctly reports **no drops at all**.
Hold the sub out until the first drop and cut it for the bar before each later one. The
template does both; `drop_lift_db` should come back ≥ 4 dB.

> **Read `drops_s` as ±1 bar, and never as a placement check.** The detector locates
> structure on a 1-second series and snaps to *its own* estimated downbeat, which the tool
> documents as ±0.5s on the raw sub-band estimate. Expect a consistent offset across all
> drops and the occasional spurious extra. Your placement is exact by construction — the
> script prints the times it stamped; that print is the ground truth, `drops_s` is the
> independent check that structure EXISTS, not that it is on the mark.

**Tune the kick to the tonic.** `v_kick`'s pitch sweep settles on `base`, which puts a pitched
note under every bar. Left at the 48 Hz default — which is G1 — the bass-root histogram reads
the *kick* rather than the bass line, and a cue in any key measures as G. Verified: at
`--root 30` (F#), with no G anywhere in the bass line, G still dominated the histogram until
`base` was tuned. Pass `v_kick(base=hz(root))`.

> With the kick tuned and the pad lifted, `--root` controls the measured key end to end:
> `--root 35` → `tonal_center B` (B:15, G:2, C:1), `--root 30` → `tonal_center F#`
> (F#:15, D:2, C#:1), both read back by `decode_audio`.

**Keep the pad above the bass-root band.** Bass-root key detection works over ~35–300 Hz. A
i–VI–VII pad voiced into that band puts the VI under the tonic, so the cue measures as the VI
and `--root` stops controlling the detectable key. The template voices the pad at `root + 36`.

**Phase the loop so a drop bar is the tonic.** Align the 4-bar loop to bar 0 and the drops can
all land on the same non-tonic degree — every sub-carrying bar is then the VI.

**Keep filter state continuous through a sweep.** Filtering in short blocks resets the filter
state at each boundary and stamps a click at the block rate. `v_riser` runs its whole bank
over the entire buffer for this reason; the selftest guards it by comparing boundary-vs-interior
discontinuity against a per-block variant (~0.99 vs ~2.6).

**Release a breakdown filter over a ramp, not a sample.** Snapping a blend from 0.85 to 0 in
one sample is a click. `breakdown_filter` takes a `release_s` (default 40 ms).

**Don't chase band balance to parity.** A different palette *should* have a different spectral
signature. Stop at ~4–6 points per band; a live run burned eight iterations here, and one gap
it chased was arithmetically unreachable — a lower root simply puts fewer harmonics in the
band than the reference's root did.

**Validate the probe before believing the verdict.** A "max sample jump vs median" test for
riser clicks reads noise, not discontinuity, and passes or fails at random; a coarse-binned
FFT reported "key unchanged" across a real transposition. If a probe can't discriminate a
known-good from a known-bad input, it is not evidence.

---

## When NOT to use this

The ceiling is timbre: you can only make sounds you can write equations for, and no amount of
iteration fixes that. When the brief wants a texture you can't write, take Route G — generate
for timbre, then impose the arrangement from `spec.json`
([`workflows/music-recreation.md`](../../workflows/music-recreation.md) Stages 4–7). The hybrid
is the honest best of both when the app-owned quote and spend cap allow it.
