#!/usr/bin/env python3
"""score_template.py — a runnable Route-D cue. COPY IT INTO THE JOB AND EDIT IT.

This is the starting point for `workflows/music-recreation.md` Route D: a complete
minor-key electronic bed whose entire clock is read from `decode_audio --mode grid`'s
spec.json, so drops land on the reference's bar lines BY CONSTRUCTION.

    uv run python tools/decode_audio.py --job $JOB --mode grid --input reference/ref.mp4
    cp skills/score_synthesis/score_template.py jobs/$JOB/audio/score.py
    uv run python jobs/$JOB/audio/score.py --spec jobs/$JOB/audio/spec.json \
        --out jobs/$JOB/audio/bed_raw.wav --root 35
    uv run python tools/decode_audio.py --job $JOB --mode finish --spec ... --input bed_raw.wav --output bed.wav
    uv run python tools/decode_audio.py --job $JOB --mode verify --spec ... --input bed.wav

**The arrangement below is a DEFAULT, not a recipe.** It is one groove in one genre. The
transferable parts are the engine (`synth.py`) and the shape: read the grid, write bars,
stamp structural hits at exact times, mix, hand off to `decode_audio --mode finish` for
loudness. Rewrite `build()` freely — that is the point of Route D.

`--root` is the key: MIDI note of the tonic (35 = B1, 36 = C2, …). Re-keying is this one
flag, never a re-render of a generated take.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

# Resolve `synth.py` whether this file is run in place OR copied into a job dir at any
# depth: walk up from here looking for the skill. A hardcoded parent index breaks the
# documented `cp … jobs/$JOB/audio/score.py` workflow.
_here = Path(__file__).resolve()
for _cand in [_here.parent, *(_p / "skills" / "score_synthesis" for _p in _here.parents)]:
    if (_cand / "synth.py").is_file():
        sys.path.insert(0, str(_cand))
        break
else:
    raise SystemExit("score_template: cannot find skills/score_synthesis/synth.py — run "
                     "from the repo, or keep synth.py beside this file")

from synth import (SR, Grid, Track, air_lift, breakdown_filter, delay_fx, fade_tail,  # noqa: E402
                   finalize, hp, hum, hz, jit, report, reverb, set_seed, soft_clip,
                   stereo, v_bell, v_body, v_clap, v_hat, v_impact, v_kick, v_pad,
                   v_pulse, v_revcym, v_shimmer, v_sub, write_wav)


def build(grid: Grid, root: int) -> np.ndarray:
    """Natural-minor i – i – VI – VII bed. Edit everything below."""
    # 4-bar loop: bass scale-degree offsets from the tonic, and the chord above it.
    LOOP_BASS = [0, 0, -4, -2]
    LOOP_CHORD = [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-2, 2, 5]]
    PENT = [0, 3, 5, 7, 10, 12, 14, 15]
    # A 4-bar motif (bar-in-loop, 16th step, scale degree) — an actual tune, not just arp
    # texture. Minor degrees: 0=i 2=ii 3=III 5=iv 7=v 8=VI 10=VII
    MOTIF = [(0, 0, 7), (0, 6, 5), (0, 10, 3),
             (1, 0, 5), (1, 8, 7), (1, 12, 10),
             (2, 0, 3), (2, 6, 2), (2, 10, 0),
             (3, 0, 5), (3, 4, 7), (3, 8, 8), (3, 12, 10)]

    drops = set(grid.drops)
    breakdown = set(grid.breakdown)
    first_drop = min(drops) if drops else grid.n_bars          # groove opens here
    last_bar = grid.n_bars - 1

    tr_drum, tr_bass = Track(grid), Track(grid)
    tr_lead, tr_pad = Track(grid), Track(grid)
    tr_air, tr_fx = Track(grid), Track(grid)

    for bar in range(grid.n_bars):
        t0 = grid.t_of(bar)
        if t0 > grid.duration:
            break
        # Phase the 4-bar loop so a DROP BAR IS THE TONIC. Align it to bar 0 instead and
        # the drops can all land on the same non-tonic degree — every sub-carrying bar is
        # then the VI, and the cue reads as that key, not the one you asked for.
        li = (bar - first_drop) % 4
        bass_m = root + LOOP_BASS[li]
        # Pad sits ABOVE the bass-root analysis band (35-300 Hz) on purpose: voiced an
        # octave lower, a i-VI-VII pad puts the VI under the tonic and the cue MEASURES
        # as the VI — `--root` then no longer controls the key anyone can detect.
        chord = [root + 36 + c for c in LOOP_CHORD[li]]

        intro = bar == 0
        brk = bar in breakdown
        tail = bar >= last_bar
        opened = bar >= first_drop
        fill = li == 3                                  # end-of-phrase variation
        dense = 0.55 if bar <= 3 else (0.8 if not opened else 1.0)
        # Half a bar of sub silence before every drop. Without it a drop is just a crash
        # over a continuous groove: the sub never dips, so it never CLEARS ITS OWN
        # BASELINE and reads as no structural event at all — to a listener and to
        # `decode_audio --mode grid`, which finds impacts by lift above baseline.
        pre_drop = (bar + 1) in drops and not brk

        # ---- drums: kick 1 & 11, clap 5 & 13, hats on 8ths ----
        if not intro and not tail:
            kicks = [0] if brk else ([0, 10] if bar % 2 == 0 else [0, 10, 14])
            if fill and not brk:
                kicks = kicks + [6]
            for s in kicks:
                g = 0.30 if brk else 0.86
                # kick TUNED TO THE TONIC — see v_kick's note on key detection
                tr_drum.add(v_kick(base=hz(root)), jit(grid.step(bar, s)),
                            hum(g * (1.0 if s == 0 else 0.84)))
            if not brk:
                for s in (4, 12):
                    tr_drum.add(v_clap(), jit(grid.step(bar, s)), hum(0.50), pan=0.10)
                if fill:
                    for s in (13, 14, 15):
                        tr_drum.add(v_clap(), jit(grid.step(bar, s)),
                                    hum(0.16 + 0.06 * (s - 13)),
                                    pan=-0.14 + 0.1 * (s - 13))

        if not tail:
            for s in range(16):
                sixteenth = s % 2 == 1
                if sixteenth and not (dense >= 1.0 and (s in (5, 13) or fill)):
                    continue
                accent = s in (2, 6, 10, 14)
                g = (0.30 if accent else 0.17) * (0.55 if brk else 1.0)
                if intro:
                    g *= 0.6 * (0.4 + 0.6 * s / 15)
                if sixteenth:
                    g *= 0.55
                op = s == 14 and li == 3
                tr_drum.add(v_hat(open_=op), jit(grid.step(bar, s), 1.8),
                            hum(g * (1.5 if op else 1.0)),
                            pan=0.26 if s % 4 == 2 else -0.20)

        # ---- sub + pulse bass ----
        if not intro and not brk and not tail:
            # SUB IS HELD OUT UNTIL THE FIRST DROP. This is what makes a drop a drop:
            # the sub has to be absent long enough for its arrival to clear the track's
            # own baseline. Run it from bar 1 and the "drop" is only a crash over an
            # unchanged low end — inaudible as structure, and correctly reported as no
            # drop at all by `decode_audio --mode grid`.
            if opened and not pre_drop:
                for s, ln in ((0, 10 * grid.s16), (10, 6 * grid.s16)):
                    tr_bass.add(v_sub(hz(bass_m), ln), grid.step(bar, s),
                                0.94 if s == 0 else 0.70)
                tr_bass.add(v_body(hz(bass_m + 12), grid.bar * 0.98),
                            grid.step(bar, 0), 0.31)
            patt = [0, 3, 6, 8, 11, 14] if not opened else [0, 3, 6, 7, 10, 13, 14]
            if fill:
                patt = patt + [15]
            if pre_drop:
                patt = [s for s in patt if s < 8]
            for s in patt:
                oct_ = 12 if (s % 4 != 3) else 19
                tr_bass.add(v_pulse(hz(bass_m + oct_), 0.20, pw=0.26 + 0.12 * (s % 2)),
                            jit(grid.step(bar, s)), hum(0.78 * dense),
                            pan=-0.12 + 0.05 * (s % 3))
        elif brk:
            for s in (0, 6, 10):
                tr_bass.add(v_pulse(hz(bass_m + 24), 0.18, pw=0.42, bright=1.6),
                            jit(grid.step(bar, s)), hum(0.24), pan=0.15)

        # ---- pad ----
        if not tail:
            g = 0.16 if intro else (0.13 if brk else 0.20)
            tr_pad.add(v_pad([hz(m) for m in chord], grid.bar * 1.15,
                             atk=0.7 if bar else 1.6), t0, g, pan=-0.05)
            tr_pad.add(v_pad([hz(m + 12) for m in chord], grid.bar * 1.15, atk=1.0,
                             breath=0.6), t0, g * 0.5, pan=0.30)

        # ---- FM bell arp: enters bar 4, opens up after the first drop ----
        if bar >= 4 and not tail:
            seq = [0, 4, 2, 7, 3, 6, 1, 5, 2, 7, 4, 8, 3, 6, 2, 5]
            rot = (bar // 4) * 3                        # rotate per phrase = variation
            busy = {ms for mb, ms, _ in MOTIF if mb == li} if opened else set()
            for s in range(16):
                if s in busy:                           # leave room for the melody
                    continue
                if brk and s % 4 != 0:
                    continue
                if not opened and s % 2 == 1:
                    continue
                deg = PENT[seq[(s + rot) % 16] % len(PENT)]
                oct_ = 36 if (opened and s % 8 == 4) else 24
                g = 0.15 if not opened else 0.20
                if brk:
                    g *= 0.55
                tr_lead.add(v_bell(hz(root + oct_ + deg + LOOP_BASS[li]), 0.42,
                                   index=3.2 if not opened else 5.4),
                            jit(grid.step(bar, s)), hum(g, 0.10),
                            pan=0.42 * np.sin(s * 0.9))

        # ---- the tune, from the first drop on ----
        if opened and not tail:
            for mb, ms, deg in MOTIF:
                if mb != li:
                    continue
                oct_ = 24 if bar < first_drop + 4 else 36
                tr_lead.add(v_bell(hz(root + oct_ + deg), 0.62, ratio=2.01, index=2.6),
                            jit(grid.step(bar, ms)), hum(0.62, 0.08), pan=-0.18)

        # ---- air / shimmer ----
        if not tail and not intro:
            picks = (2, 6, 10, 14) if not opened else (2, 5, 6, 10, 13, 14)
            for s in picks:
                deg = PENT[(s + bar) % len(PENT)]
                g = (0.055 if not opened else 0.085) * (0.4 if brk else 1.0)
                tr_air.add(v_shimmer(hz(root + 48 + deg), 0.28), jit(grid.step(bar, s)),
                           hum(g), pan=0.55 * np.sin(s * 1.7 + bar))

        # ---- section FX. Structural hits are stamped EXACTLY — never jittered. ----
        if bar in drops:
            tr_fx.add(v_impact(), t0, 0.72)
            tr_fx.add(v_revcym(0.7), t0 - 0.7, 0.22)
            if bar != first_drop:
                tr_fx.add(v_riser_lift(grid), t0 - grid.bar * 0.5, 0.20)
        if breakdown and bar == min(breakdown):
            from synth import v_riser
            tr_fx.add(v_riser(len(breakdown) * grid.bar), t0, 0.30)

    # ── mix ──────────────────────────────────────────────────────────────────
    drum = tr_drum.buf
    bass = hp(tr_bass.buf, 38)                          # keep the sub tight
    lead = stereo(delay_fx, tr_lead.buf, grid.beat * 0.75, 0.30, 0.26)
    lead = stereo(reverb, lead, 0.26)
    pad = stereo(reverb, tr_pad.buf, 0.42, 1.15)
    air = stereo(delay_fx, tr_air.buf, grid.beat * 0.5, 0.26, 0.30)
    air = stereo(reverb, air, 0.34)
    fx = stereo(reverb, tr_fx.buf, 0.22)

    mix = (drum * 1.15 + bass * 0.95 + lead * 1.05 + pad * 0.80
           + air * 0.88 + fx * 0.85)

    if breakdown and drops:
        mix = breakdown_filter(mix, grid, min(breakdown), min(drops))

    mix = hp(mix, 32)                                   # clean low end under the SFX
    mix = air_lift(mix)
    mix = soft_clip(mix)
    mix = fade_tail(mix, grid, start_s=max(0.0, grid.duration - 1.95))
    return finalize(mix)


def v_riser_lift(grid: Grid) -> np.ndarray:
    from synth import v_riser
    return v_riser(grid.bar * 0.5)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", required=True,
                    help="spec.json from `decode_audio --mode grid`")
    ap.add_argument("--out", required=True, help="output WAV (raw — not yet loudness-normalized)")
    ap.add_argument("--root", type=int, default=35,
                    help="MIDI note of the tonic (35 = B1). THIS is the key change.")
    ap.add_argument("--seed", type=int, default=0, help="humanisation seed")
    ap.add_argument("--breakdown-bars", type=int, default=2,
                    help="bars of breakdown before the first drop (0 = none)")
    a = ap.parse_args()

    set_seed(a.seed)
    grid = Grid.from_spec(a.spec)
    if grid.drops and a.breakdown_bars > 0:
        d0 = min(grid.drops)
        grid.breakdown = tuple(b for b in range(d0 - a.breakdown_bars, d0) if b >= 0)

    mix = build(grid, a.root)
    out = write_wav(a.out, mix)
    report(grid, mix, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
