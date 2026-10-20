#!/usr/bin/env python3
"""synth.py — the deterministic score-synthesis engine (music-recreation Route D).

A `numpy`/`scipy`-only softsynth: a bar/step grid, a voice bank, Schroeder FX and the
mix helpers needed to write a cue **as code**, so that every event lands on an exact
timestamp BY CONSTRUCTION rather than by nudging a rendered file.

Why this exists: prose cannot bind an event to a timestamp (proven twice — see
`workflows/music-recreation.md` §Route first). When the brief has hard sync marks,
`grid.step(bar, s)` returning an exact float is the whole answer, and re-keying is one
argument instead of a re-roll.

    from synth import Grid, Track, hz, v_bell, v_kick, reverb, finalize

    grid = Grid.from_spec("jobs/<id>/audio/spec.json")   # decode_audio --mode grid
    drums = Track(grid)
    drums.add(v_kick(), grid.step(bar=4, s=0), 0.86)

NO JOB STATE, NO API SURFACE, NO SPEND. This is a library plus a selftest; it takes no
`--job` because it writes nothing to a job (the per-cue score does that). The paid halves
of the recipe live in `tools/score_bed.py` (generation) and `tools/gemini_video.py`
(listening); the measurement half is `tools/decode_audio.py`.

The verification loop this is built for is CLOSED — that is its real advantage over a
generator:

    render → tools/decode_audio.py --mode verify --spec spec.json → change ONE coefficient → re-render

Ceiling, stated honestly: you can only make sounds you can write equations for. When the
brief needs timbre you can't write, route G (generate) and impose the arrangement instead.

    uv run python skills/score_synthesis/synth.py --selftest    # 14 checks, no I/O
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter, sosfilt

SR = 48000

# Module RNG. Seeded so a cue is byte-reproducible; re-seed per cue if you want a
# different humanisation roll without touching the arrangement.
rng = np.random.default_rng(0)


def set_seed(seed: int) -> None:
    """Re-seed the humanisation RNG. Call once, before building."""
    global rng
    rng = np.random.default_rng(seed)


# ── grid ──────────────────────────────────────────────────────────────────────
@dataclass
class Grid:
    """The bar/step clock a cue is written against.

    Every field is a MEASUREMENT of the reference, not a preference — take them from
    `decode_audio --mode grid`'s spec.json and never retype them by ear.
    """

    bpm: float
    phase: float          # absolute time of bar 0's downbeat
    duration: float
    drops: tuple[int, ...] = ()        # bar indices carrying a structural impact
    breakdown: tuple[int, ...] = ()    # bar indices that strip out / filter down

    @property
    def beat(self) -> float:
        return 60.0 / self.bpm

    @property
    def bar(self) -> float:
        return 4.0 * self.beat

    @property
    def s16(self) -> float:
        return self.beat / 4.0

    @property
    def n_bars(self) -> int:
        return int(np.ceil((self.duration - self.phase) / self.bar))

    def t_of(self, bar: float) -> float:
        """Absolute time of a (fractional) bar index."""
        return self.phase + bar * self.bar

    def step(self, bar: int, s: float) -> float:
        """Absolute time of 16th-step `s` (0-based) within `bar`."""
        return self.phase + bar * self.bar + s * self.s16

    def bar_of(self, t: float) -> float:
        """Inverse of t_of — which (fractional) bar a timestamp falls in."""
        return (t - self.phase) / self.bar

    @classmethod
    def from_spec(cls, path: str | Path, *, drops_from_spec: bool = True) -> "Grid":
        """Build the clock from `decode_audio --mode grid`'s spec.json.

        Drop BAR INDICES are derived from the spec's `drops_s` (which decode_audio has
        already snapped to the bar grid — its raw sub-band estimate is ±0.5s, so a
        sample-accurate claim there would be false precision).
        """
        spec = json.loads(Path(path).read_text())
        for k in ("bpm", "downbeat_phase_s", "duration_s"):
            if k not in spec:
                raise SystemExit(f"synth: spec.json is missing '{k}' — "
                                 "run `decode_audio --mode grid` to produce it")
        g = cls(bpm=float(spec["bpm"]),
                phase=float(spec["downbeat_phase_s"]),
                duration=float(spec["duration_s"]))
        if drops_from_spec and spec.get("drops_s"):
            g.drops = tuple(int(round(g.bar_of(t))) for t in spec["drops_s"])
        return g


class Track:
    """A stereo buffer you stamp mono voices into at absolute times."""

    def __init__(self, grid: "Grid | float"):
        dur = grid.duration if isinstance(grid, Grid) else float(grid)
        self.n = int(dur * SR)
        self.buf = np.zeros((self.n, 2))

    def add(self, sig: np.ndarray, t: float, gain: float = 1.0, pan: float = 0.0):
        """Stamp `sig` at absolute time `t`. Out-of-range writes clip, never wrap."""
        i = int(t * SR)
        if i >= self.n:
            return
        sig = sig[: self.n - i]
        if i < 0:
            sig = sig[-i:]
            i = 0
        if len(sig) == 0:
            return
        l = np.sqrt((1 - pan) / 2) * np.sqrt(2)
        r = np.sqrt((1 + pan) / 2) * np.sqrt(2)
        self.buf[i:i + len(sig), 0] += sig * gain * l
        self.buf[i:i + len(sig), 1] += sig * gain * r


# ── envelopes / helpers ───────────────────────────────────────────────────────
def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def env_ad(n: int, atk: float, dec: float, sus: float = 0.0, rel: float = 0.0) -> np.ndarray:
    """Attack / exponential-decay envelope over n samples."""
    t = np.arange(n) / SR
    a = np.clip(t / max(atk, 1e-5), 0, 1)
    d = sus + (1 - sus) * np.exp(-t / max(dec, 1e-5))
    e = a * d
    if rel > 0:
        r = np.clip((n / SR - t) / rel, 0, 1)
        e = e * r
    return e


def jit(t: float, ms: float = 2.5) -> float:
    """Micro-timing humanisation — kills the rigid-quantise feel.

    NEVER apply this to a structural impact that must land on a sync mark; jitter the
    groove, stamp the drops exactly.
    """
    return t + rng.normal(0, ms / 1000.0)


def hum(g: float, amt: float = 0.13) -> float:
    """Velocity humanisation."""
    return g * float(np.clip(1 + rng.normal(0, amt), 0.6, 1.35))


# ── voices ────────────────────────────────────────────────────────────────────
def v_sub(f: float, dur: float, drive: float = 1.6) -> np.ndarray:
    """Triangle-ish sub with soft drive and a short pitch drop on the attack."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    bend = 1 + 0.16 * np.exp(-t / 0.030)
    ph = 2 * np.pi * np.cumsum(f * bend) / SR
    tri = np.arcsin(np.sin(ph)) * (2 / np.pi)
    y = np.tanh(tri * drive) / np.tanh(drive)
    return y * env_ad(n, 0.004, 0.55, sus=0.42, rel=0.05)


def v_pulse(f: float, dur: float, pw: float = 0.30, bright: float = 1.0) -> np.ndarray:
    """PWM pulse bass, additive, with per-harmonic decay = filter-envelope pluck."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(1, 19):
        if f * k > SR / 2.2:
            break
        amp = (2 / (k * np.pi)) * np.sin(np.pi * k * pw)
        dec = 0.105 / (1 + 0.60 * (k - 1) / bright)      # highs die first
        y += amp * np.sin(2 * np.pi * f * k * t + k * 0.7) * np.exp(-t / dec)
    return y * env_ad(n, 0.002, 0.26, sus=0.15, rel=0.02)


def v_body(f: float, dur: float) -> np.ndarray:
    """Sustained mid-bass body — fills the 80-160 Hz band under plucky basses.

    Reach for this when a band-balance read shows 80-160 Hz short: a pluck bass decays
    too fast to sustain there. NOTE a low root may put fewer harmonics in that band than
    the reference's did — check the arithmetic before treating a gap as a mix defect.
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, g in ((1, 1.0), (2, 0.34), (3, 0.16), (4, 0.07)):
        y += g * np.sin(2 * np.pi * f * k * t + k * 1.3)
    y = sosfilt(butter(2, 420, btype="low", fs=SR, output="sos"), y)
    return y * env_ad(n, 0.012, dur * 0.9, sus=0.72, rel=0.09)


def v_bell(f: float, dur: float, ratio: float = 3.5, index: float = 5.0) -> np.ndarray:
    """FM glass bell — sine carrier, inharmonic modulator, fast index decay."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    I = index * np.exp(-t / 0.055)
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * ratio * t))
    y += 0.30 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / 0.040)
    return y * env_ad(n, 0.0015, 0.22, sus=0.02, rel=0.03)


def v_pad(freqs, dur: float, atk: float = 0.9, breath: float = 0.35) -> np.ndarray:
    """Detuned-triangle + filtered-noise breath pad."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f in freqs:
        for det in (-7.0, 0.0, 6.0):
            ff = f * 2 ** (det / 1200)
            ph = 2 * np.pi * ff * t + rng.uniform(0, 6.28)
            for k in (1, 3, 5, 7):
                y += (1 / k ** 2.1) * np.sin(k * ph) / 3
    nz = rng.normal(0, 1, n)
    nz = sosfilt(butter(4, [700, 4200], btype="band", fs=SR, output="sos"), nz)
    nz *= 1 + 0.5 * np.sin(2 * np.pi * 0.23 * t)
    y = y / (len(freqs) + 1e-9) + breath * nz * 0.28
    return y * env_ad(n, atk, dur * 1.4, sus=0.85, rel=min(1.2, dur * 0.4))


def v_kick(dur: float = 0.40, base: float = 48.0) -> np.ndarray:
    """Pitch-swept sine kick. `base` is the frequency its tail SETTLES on.

    ⚠️ TUNE `base` TO THE TONIC. A kick whose tail parks on a fixed frequency puts a
    pitched note under every bar, and bass-root key detection reads THAT instead of the
    bass line — the default 48 Hz is G1, so a cue in any key measures as G. It is also
    just good practice: an untuned kick fights the bass.
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = base + 105 * np.exp(-t / 0.028)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.115)
    click = rng.normal(0, 1, n) * np.exp(-t / 0.0016) * 0.35
    click = sosfilt(butter(2, 1800, btype="high", fs=SR, output="sos"), click)
    return np.tanh((y + click) * 1.25)


def v_clap(dur: float = 0.30) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = sosfilt(butter(4, [1400, 7000], btype="band", fs=SR, output="sos"), nz)
    e = np.zeros(n)
    for off, g in ((0.000, 1.0), (0.010, 0.8), (0.021, 0.65)):
        i = int(off * SR)
        e[i:] += g * np.exp(-(t[: n - i]) / 0.011)
    e += 0.5 * np.exp(-t / 0.085)
    body = np.sin(2 * np.pi * 205 * t) * np.exp(-t / 0.045) * 0.30
    return nz * e * 0.75 + body


def v_hat(dur: float = 0.055, open_: bool = False) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = sosfilt(butter(6, 7200, btype="high", fs=SR, output="sos"), nz)
    return nz * np.exp(-t / (0.055 if open_ else 0.0135))


def v_riser(dur: float) -> np.ndarray:
    """Rising filtered-noise sweep.

    ⚠️ Built as a crossfaded bank of fixed band-passes run over the WHOLE buffer, on
    purpose. Filtering in short blocks resets the filter state at every block boundary,
    which stamps an audible click into the sweep at the block rate. Keep filter state
    continuous for anything that sweeps.
    """
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    nz = rng.normal(0, 1, n)
    centres = np.array([400, 700, 1200, 1900, 2900, 4200, 5600])
    bank = []
    for c in centres:
        sos = butter(4, [max(120, c * 0.55), min(SR / 2.2, c * 1.7)],
                     btype="band", fs=SR, output="sos")
        bank.append(sosfilt(sos, nz))                 # whole buffer, state intact
    sweep = 400 * (1 - p) + 5200 * p                  # cutoff over time
    out = np.zeros(n)
    wsum = np.zeros(n)
    for c, y in zip(centres, bank):
        w = np.exp(-((np.log2(sweep / c)) ** 2) / (2 * 0.55 ** 2))
        out += y * w
        wsum += w
    out /= np.maximum(wsum, 1e-9)
    tone = np.sin(2 * np.pi * np.cumsum(220 + 900 * p ** 2.4) / SR) * 0.18
    return (out * 0.55 + tone) * (p ** 2.1)


def v_impact(dur: float = 1.4) -> np.ndarray:
    """The structural drop hit. Stamp it at an EXACT grid time — never jittered."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 30 + 60 * np.exp(-t / 0.055)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.30)
    nz = rng.normal(0, 1, n) * np.exp(-t / 0.14)
    nz = sosfilt(butter(4, [200, 3500], btype="band", fs=SR, output="sos"), nz)
    return np.tanh((boom * 1.15 + nz * 0.30) * 1.2)


def v_revcym(dur: float = 0.9) -> np.ndarray:
    """Reverse-swell noise, for lifts into a section."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = sosfilt(butter(4, [2500, 11000], btype="band", fs=SR, output="sos"), nz)
    return nz * (t / dur) ** 3


def v_shimmer(f: float, dur: float) -> np.ndarray:
    """High glass partial — the air layer above the arp."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, g in ((1.0, 1.0), (2.0, 0.45), (3.02, 0.30), (4.98, 0.18)):
        y += g * np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28))
    y = sosfilt(butter(2, 3000, btype="high", fs=SR, output="sos"), y)
    return y * env_ad(n, 0.003, 0.30, sus=0.03, rel=0.05)


VOICES = {
    "sub": v_sub, "pulse": v_pulse, "body": v_body, "bell": v_bell, "pad": v_pad,
    "kick": v_kick, "clap": v_clap, "hat": v_hat, "riser": v_riser,
    "impact": v_impact, "revcym": v_revcym, "shimmer": v_shimmer,
}


# ── effects ───────────────────────────────────────────────────────────────────
def _feedback(x: np.ndarray, D: int, g: float) -> np.ndarray:
    """y[n] = x[n] + g*y[n-D], vectorized.

    The textbook form is `lfilter([1], a, x)` with a length-D denominator, which costs
    O(n·D) — ~1400 taps at a 30 ms delay made a 35 s cue take minutes per render, and
    Route D is an iterate-and-remeasure loop. Because samples D apart are independent
    until the previous block is final, striding by D turns it into O(n/D) numpy ops.
    """
    y = x.astype(float, copy=True)
    if D <= 0:
        return y
    for i in range(D, len(y), D):
        j = min(i + D, len(y))
        y[i:j] += g * y[i - D:i - D + (j - i)]
    return y


def comb(x, delay_s, g):
    return _feedback(x, int(delay_s * SR), g)


def allpass(x, delay_s, g):
    D = int(delay_s * SR)
    v = -g * x
    if D < len(x):
        v[D:] += x[:-D]
    return _feedback(v, D, g)


def reverb(x, mix=0.25, size=1.0):
    wet = np.zeros_like(x)
    for d, g in ((0.0297, 0.805), (0.0371, 0.790), (0.0411, 0.780), (0.0437, 0.770)):
        wet += comb(x, d * size, g)
    wet /= 4
    for d, g in ((0.0050, 0.7), (0.0017, 0.7)):
        wet = allpass(wet, d, g)
    wet = sosfilt(butter(2, 320, btype="high", fs=SR, output="sos"), wet)
    wet = sosfilt(butter(2, 7000, btype="low", fs=SR, output="sos"), wet)
    return x * (1 - mix) + wet * mix


def delay_fx(x, time_s, fb=0.34, mix=0.22):
    D = int(time_s * SR)
    a = np.zeros(D + 1)
    a[0] = 1.0
    a[D] = -fb
    wet = lfilter(np.concatenate([np.zeros(D), [1.0]]), a, x)
    wet = sosfilt(butter(2, 1200, btype="high", fs=SR, output="sos"), wet)
    return x + wet * mix


def stereo(fn, buf: np.ndarray, *a, **kw) -> np.ndarray:
    """Apply a mono effect to both channels of a stereo buffer."""
    return np.stack([fn(buf[:, c], *a, **kw) for c in range(buf.shape[1])], axis=1)


def hp(buf: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    sos = butter(order, f, btype="high", fs=SR, output="sos")
    return stereo(lambda x: sosfilt(sos, x), buf)


def lp(buf: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    sos = butter(order, f, btype="low", fs=SR, output="sos")
    return stereo(lambda x: sosfilt(sos, x), buf)


# ── mix / master ──────────────────────────────────────────────────────────────
def breakdown_filter(mix: np.ndarray, grid: Grid, start_bar: int, end_bar: int,
                     cutoff: float = 340.0, depth: float = 0.85,
                     release_s: float = 0.040) -> np.ndarray:
    """Ramp a high-pass across a breakdown and release it ON the drop.

    The release is a short RAMP, not a one-sample snap — snapping the blend 0.85→0 in a
    single sample is a click. `release_s` is that ramp.
    """
    n = mix.shape[0]
    t = np.arange(n) / SR
    b0, b1 = grid.t_of(start_bar), grid.t_of(end_bar)
    m = (t >= b0) & (t < b1 + 0.05)
    if not m.any() or b1 <= b0:
        return mix
    filt = hp(mix, cutoff)
    w = np.clip((t - b0) / (b1 - b0), 0, 1)
    rel = np.clip(1 - (t - b1) / release_s, 0, 1)
    env = np.where(t < b1, w * depth, depth * rel)
    blend = env[:, None]
    return mix * (1 - blend) + filt * blend


def air_lift(mix: np.ndarray, f: float = 6500.0, amount: float = 0.34) -> np.ndarray:
    """Shelf the top end back in. A band read that is short above ~6 kHz is the cue."""
    return mix + hp(mix, f) * amount


def soft_clip(mix: np.ndarray, drive: float = 0.85) -> np.ndarray:
    return np.tanh(mix * drive) / np.tanh(drive)


def fade_tail(mix: np.ndarray, grid: Grid, start_s: float,
              curve: float = 0.55, head_s: float = 0.02) -> np.ndarray:
    """Fade to silence by the grid's duration, plus a click-free head.

    `curve < 1` keeps the last half-second from collapsing — a linear fade reads as a
    hard cut to a listener and invites a false "the audio stops dead" QC finding.
    """
    n = mix.shape[0]
    t = np.arange(n) / SR
    end = grid.duration
    f = np.clip((end - t) / max(end - start_s, 1e-6), 0, 1)[:, None] ** curve
    out = mix * f
    h = int(head_s * SR)
    if h > 0:
        out[:h] *= np.linspace(0, 1, h)[:, None]
    return out


def finalize(mix: np.ndarray, peak: float = 0.89) -> np.ndarray:
    """Peak-normalize. Loudness is NOT done here — `decode_audio --mode finish` does the
    two-pass -14 LUFS / -1.0 dBTP normalization, so it is measured, not asserted."""
    p = float(np.abs(mix).max())
    return mix / p * peak if p > 0 else mix


def write_wav(path: str | Path, mix: np.ndarray) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(path), SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
    return path


def report(grid: Grid, mix: np.ndarray, out: Path) -> None:
    """Print the grid claims the render must be verified against."""
    print(f"wrote {out}  {mix.shape[0] / SR:.4f}s  peak {np.abs(mix).max():.3f}")
    print(f"  bpm {grid.bpm}  downbeat {grid.phase:.4f}s  bar {grid.bar:.6f}s")
    if grid.drops:
        print("  drops at " + ", ".join(f"{grid.t_of(b):.3f}s" for b in grid.drops))
    print("  NEXT: decode_audio --mode finish, then --mode verify --spec spec.json")


# ── selftest ──────────────────────────────────────────────────────────────────
def selftest() -> int:
    print("synth --selftest\n")
    ok = fail = 0

    def check(name, cond, detail=""):
        nonlocal ok, fail
        if cond:
            ok += 1
            print(f"  ✅ {name}  {detail}")
        else:
            fail += 1
            print(f"  ❌ {name}  {detail}")

    g = Grid(bpm=120.0, phase=0.25, duration=10.0)
    check("beat/bar/16th derive from bpm",
          abs(g.beat - 0.5) < 1e-9 and abs(g.bar - 2.0) < 1e-9
          and abs(g.s16 - 0.125) < 1e-9, f"beat {g.beat} bar {g.bar} s16 {g.s16}")
    check("t_of is phase + bar*bar_s", abs(g.t_of(3) - (0.25 + 6.0)) < 1e-9,
          f"got {g.t_of(3)}")
    check("step lands on an exact 16th", abs(g.step(2, 6) - (0.25 + 4.0 + 0.75)) < 1e-9,
          f"got {g.step(2, 6)}")
    check("bar_of inverts t_of", abs(g.bar_of(g.t_of(4.5)) - 4.5) < 1e-9)
    check("n_bars covers the duration", g.n_bars * g.bar >= g.duration - g.phase,
          f"n_bars {g.n_bars}")

    tr = Track(g)
    check("Track sized from the grid", tr.n == int(10.0 * SR), f"n {tr.n}")
    tr.add(np.ones(int(0.1 * SR)), 1.0, gain=0.5)
    i = int(1.0 * SR)
    check("add stamps at the right sample",
          abs(tr.buf[i + 10, 0] - 0.5) < 1e-6 and abs(tr.buf[i - 10, 0]) < 1e-12,
          f"{tr.buf[i + 10, 0]:.3f}")
    before = tr.buf.copy()
    tr.add(np.ones(SR), 9.95)                     # runs past the end
    check("add past the end truncates, never wraps",
          tr.buf.shape == before.shape and abs(tr.buf[0, 0]) < 1e-12)
    tr2 = Track(g)
    tr2.add(np.ones(int(0.1 * SR)), 1.0, gain=1.0, pan=-1.0)
    check("pan -1 puts energy left",
          tr2.buf[i + 10, 0] > 1.3 and abs(tr2.buf[i + 10, 1]) < 1e-9,
          f"L {tr2.buf[i + 10, 0]:.3f} R {tr2.buf[i + 10, 1]:.3f}")

    check("hz(69) is A440", abs(hz(69) - 440.0) < 1e-9)
    check("hz is 2x per octave", abs(hz(81) / hz(69) - 2.0) < 1e-9)

    set_seed(7)
    a = v_bell(440.0, 0.3)
    set_seed(7)
    b = v_bell(440.0, 0.3)
    check("voices are deterministic under a fixed seed",
          np.array_equal(a, b), f"len {len(a)}")
    check("every voice returns finite audio in range",
          all(np.all(np.isfinite(v)) and np.abs(v).max() < 20
              for v in (v_sub(55, .3), v_pulse(110, .2), v_body(90, .5),
                        v_bell(440, .3), v_pad([220, 330], .5), v_kick(),
                        v_clap(), v_hat(), v_riser(1.0), v_impact(),
                        v_revcym(), v_shimmer(1200, .3))))

    # Regression guard for the block-boundary click. A bare "max jump vs median" test is
    # NOT diagnostic here — band-limited noise has big sample-to-sample jumps by nature.
    # The discriminating measurement is boundary-vs-interior, whole-buffer state against
    # per-block state (the bug this voice was rewritten to remove).
    def _boundary_ratio(y: np.ndarray, block_s: float) -> float:
        d = np.abs(np.diff(y))
        b = int(block_s * SR)
        idx = np.arange(b - 1, len(d), b)   # d[i] = y[i+1]-y[i]; the seam is d[b-1]
        if len(idx) == 0:
            return 1.0
        interior = np.delete(d, idx)
        return float(d[idx].mean() / max(interior.mean(), 1e-12))

    set_seed(3)
    whole = v_riser(2.0)
    set_seed(3)                                   # same noise, per-block filter state
    n_r = int(2.0 * SR)
    nz = rng.normal(0, 1, n_r)
    sos_r = butter(4, [400, 4000], btype="band", fs=SR, output="sos")
    blk = int(0.05 * SR)
    blocky = np.concatenate([sosfilt(sos_r, nz[i:i + blk]) for i in range(0, n_r, blk)])
    check("riser keeps filter state continuous (no block-rate click)",
          _boundary_ratio(whole, 0.05) < _boundary_ratio(blocky, 0.05),
          f"whole {_boundary_ratio(whole, 0.05):.3f} vs per-block "
          f"{_boundary_ratio(blocky, 0.05):.3f}")

    # the fast recurrences must be bit-comparable to the textbook lfilter forms
    set_seed(11)
    xs = rng.normal(0, 1, 5000)
    Dt, gt = 137, 0.78
    a_ref = np.zeros(Dt + 1)
    a_ref[0], a_ref[Dt] = 1.0, -gt
    b_ap = np.zeros(Dt + 1)
    b_ap[0], b_ap[Dt] = -gt, 1.0
    check("comb matches the lfilter reference",
          np.allclose(comb(xs, Dt / SR, gt), lfilter([1.0], a_ref, xs), atol=1e-9),
          f"max err {np.abs(comb(xs, Dt / SR, gt) - lfilter([1.0], a_ref, xs)).max():.2e}")
    check("allpass matches the lfilter reference",
          np.allclose(allpass(xs, Dt / SR, gt), lfilter(b_ap, a_ref, xs), atol=1e-9),
          f"max err {np.abs(allpass(xs, Dt / SR, gt) - lfilter(b_ap, a_ref, xs)).max():.2e}")

    gd = Grid(bpm=120.0, phase=0.25, duration=10.0)
    m = np.ones((int(10.0 * SR), 2)) * 0.5
    faded = fade_tail(m, gd, start_s=8.0)
    check("fade_tail reaches silence at the duration",
          abs(faded[-1, 0]) < 1e-3 and abs(faded[int(5 * SR), 0] - 0.5) < 1e-6,
          f"last {faded[-1, 0]:.6f}")
    bd = breakdown_filter(m, gd, start_bar=1, end_bar=2)
    check("breakdown_filter releases without a one-sample step",
          np.abs(np.diff(bd[:, 0])).max() < 0.2,
          f"max step {np.abs(np.diff(bd[:, 0])).max():.4f}")

    print(f"\n  {ok} passed, {fail} failed")
    return 1 if fail else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true",
                    help="run the engine checks (no I/O, no spend)")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
