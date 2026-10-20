# Music recreation — "same groove, new key, new palette, legally mine"

> ## ⛔ SCOPE: LAUNCH VIDEOS ONLY
> This recipe applies **only to launch video creation**. Do not route here for any other
> work — not organic short-form, not trend duplications, not client ads, not remixes.
> For every other route the standing rules hold: **native platform audio** (attach the
> trending sound in the composer, ship the render silent) or a **licensed/owned track**
> via `score_bed --mode bed`. AI music generation stays opt-in and default-OFF
> (CLAUDE.md), and this recipe does not widen that permission — it narrows it to one
> use-case where an original, sync-locked bed is worth building.
>
> **Why launch videos specifically:** a launch video is the one case where all three
> conditions hold at once — the bed must hit fixed beats in a cut you already locked, the
> temp track you cut against cannot ship, and the asset gets reused across placements
> long enough to justify building an original rather than licensing one.
>
> If a request looks like this recipe but is not a launch video, say so and route to
> `score_bed --mode bed`.

Take a reference track you can't ship (a temp track, a trend's copyrighted bed, a
reference video's soundtrack) and produce an **original bed that inherits only the
non-copyrightable skeleton** — tempo, downbeat phase, hit placement, section structure,
total time — in a **new key and a new palette**.

**The palette is a DECISION, not a default** (§The palette decision).
Synths are one option among many, and this recipe has no house sound. What the skeleton
guarantees is that the bed *lands on the cut*; what it sounds like is a separate choice, made
per job — deduced where the evidence supports it, **asked** where it doesn't.

**This is an AUDIO-LAYER recipe, not one of the forward video recipes.** It produces a
`bed.wav` (+ a `preview.mp4` for A/B) that another workflow drops in via `score_bed --mode
bed` or `compose_render`. It never renders a finished video by itself.

> **⚠️ PRINCIPLES vs INSTANCE:** every number below carrying a unit (a BPM, a timestamp, a
> dB figure) is an illustration and is **worthless on your reference**. The transferable
> method is the *stage order*, the *gates*, and the *hard rules* — re-measure every value.

---

## Inputs
- A **reference** with the music on it — **a URL or a file**, either works:
  a remote reference URL (YouTube / IG / TikTok / X), a `file://…` link, or a local path.
  A URL is ripped **audio-only** (this recipe never looks at pixels) into
  `jobs/<id>/reference/` and cached by URL, so re-running any stage is free; `--regen`
  forces a re-fetch. Remote pulls route through `pull_video`'s acquisition seam — gateway
  when keyed (**a billable pull — announce it**), local yt-dlp otherwise. A private or
  blocked source needs cookies: pull it with
  `pull_video --mode pull --url <url> --audio-only --cookies-from-browser <browser>` and
  pass the resulting file instead.
  **Verify the URL is the job's actual reference before adopting it** — a wrong-reference
  QA loop has happened; diff the link against the job spec's Source line first.
- The **keep / change** brief. Default keep set: BPM, downbeat phase, hit placement,
  section structure, total time. Default change set: key + palette — **and the palette has no
  default value**; it is chosen per job in §The palette decision.
- A **target** to score against: either a silent picture plate (`final_v3.mp4`-style) when
  the bed must sync to picture, or just a duration.
- The **tenant** — read `taste/packs/<tenant>/README.md`; a pack may lock genre, energy, or
  a "never AI-generated music" commitment. **AI music is opt-in and default-OFF in this
  repo** (CLAUDE.md); for trend work the standing rule is native IG audio, render silent.

---

## The palette decision — before anything else

**What the bed sounds like is the first question, and it is not this recipe's to answer by
default.** The skeleton (tempo, phase, hits, structure, length) is measured off the reference
and is not negotiable. The *palette* — instrument family, era, room, energy — is a creative
choice, and choosing it silently is how every launch film ends up sounding like the same
electronic bed regardless of what it is for.

**Deduce first, in this order, and say out loud which source decided it:**

1. **The tenant pack** (`taste/packs/<tenant>/README.md`) — a locked genre, energy, "always
   acoustic", or a never-AI-music commitment wins outright. Most-specific-wins, per CLAUDE.md's
   scope matrix. If the pack settles it, you are done; name the field you read.
2. **The film this bed is for** — its register, subject and audience. A drawn instrument-panel
   product film, a warm founder story, a fashion drop and a kids' app do not share a soundtrack,
   and the picture usually implies the feel unambiguously. **State the inference in one line**
   so the human can reject it cheaply ("the film is a black-canvas telemetry piece, so:
   restrained electronic" / "the film is hand-shot and personal, so: acoustic, small room").
3. **The reference's measured character** (`spec.json`, Stage 0) — tempo, kick density,
   high-band character, energy arc. ⚠️ These constrain **what will sit correctly on the cut**,
   not what instrument family plays it. A 134 BPM two-step skeleton can be carried by an FM
   bass or by an upright and a brushed kit. **Never read the reference's timbre as a
   prescription** — that is the copyrighted part you are specifically not inheriting.

**⭐ If those do not converge, ASK — one question, before any spend.** Offer three or four
*named* feels with the instrument family each implies, plus the one you'd pick and why. This is
the cheapest question in the whole recipe and the most expensive assumption: the palette is what
a human notices in the first two seconds of the first listen, and undoing it costs a full
re-roll (Route **G**) or a rewritten cue (Route **D**) — never a tweak.

> **The two routes, since they are named before they are defined.** **G = Generate** — a
> gateway-routed music capability makes the bed, you fan out takes and select.
> **D = Deterministic** — you write the score as code (`numpy`), and every hit is placed by
> construction. **The letters are initials, not a sequence — there is no Route A–C, E or F.**
> Full treatment in §Route G and §Route D below; the trade in one line is *G buys timbre and
> costs exactness, D buys exactness and costs timbre.*

> **⛔ Do not default to synths.** They are this repo's most-used palette only because the
> first film in this family was a trading-terminal clone. That is an **instance**, not a law,
> and every example prompt below is one palette among many.

### What each engine can actually make — check this BEFORE promising a palette

**Real instruments are fully available and always have been. Only Route D is synth-only.**

| | **Route G** — `score_bed --mode generate` | **Route D** — `skills/score_synthesis/` |
|---|---|---|
| Engine | `score_bed --mode generate` requests the semantic `music:compose` route; the gateway quote and receipt own provider/model selection. A direct-key fallback is an explicit non-gateway route | locked `numpy`/`scipy` oscillators |
| Piano | **Yes** | **Piano-ish** — `v_piano` models a struck string (inharmonic partials, per-partial decay, hammer thump). Built for a calm bed under a VO, sparse voicings only. Modeled, not sampled — it will not pass for a recorded piano |
| Strings · brass · woodwind · guitar · choir · live room | **Yes** — general text-to-music, any palette you can name | **No** — the bank is 13 synthesized voices (sub, pulse, body, bell, pad, **piano**, kick, clap, hat, riser, impact, revcym, shimmer). No sampler; anything else acoustic needs a new physical model written first |
| Tempo · duration · genre · timbre · density | Yes — measured as surviving the prose translation | Exact by construction |
| Key | Partly — lands within ~1 semitone; correct in Stage 6 | Exact — one `--root` flag |
| Drop / breakdown / fade **at an exact timestamp** | Yes — Stage 7 imposes it in post from `spec.json` with a volume/filter envelope, which is **timbre-agnostic**: it shapes a string section exactly as well as a saw pad | Exact by construction |
| A **new transient** at an exact timestamp (a crash, a piano stab, a downbeat hit that isn't already in the take) | ⚠️ **No** — envelopes *shape* what the take contains; they cannot *add* a hit. "Ducking ≠ muting" (Stage 7) | Yes — `grid.step(bar, s)` places it |

**The only real constraint, stated plainly:** an **acoustic palette that also needs a brand-new
hit at an exact mark** is the one combination neither route covers alone. Close it by sourcing a
**one-shot the tenant owns or licensed** and placing it on the SFX cue sheet against
`clock.json` (`score_bed` never generates SFX — user-supplied only). Everything else about an
acoustic bed — the groove, the structure, the drops, the fades, the ending — is already
reachable through Route G + Stage 7.

*Status note: the acoustic path is unexercised in this repo — every shipped bed so far has been
electronic. Nothing blocks it, but plan one extra fan-out round the first time, and do not
report an acoustic take as verified on the strength of this table.*

Write the chosen palette into the keep/change table (Stage 2) alongside the key, so the human
format-locks the sound at the same checkpoint they lock everything else.

---

## Route second — the decision that changes everything else

Count the **time-indexed constraints** in the brief: events that must land at a specific
timestamp (a drop, an impact, a breakdown, a caption hit, a cut).

### How to count them — the picture's cuts are NOT the count

**A cut is not a mark.** If the bed's tempo and downbeat phase are right, a cut that falls on a
bar line is already in sync — **the grid does that for free, on any bed, from any route.** Count
the cuts and a 35s film with 25 hard cuts reads as "25 constraints, obviously Route D", when the
true count is often two or three. Three filters, in order; a mark survives only if it passes all
three:

1. **Does the AUDIO have to change there?** Not "does something happen in the picture" — does
   the bed have to do something at that timestamp that it would not otherwise do? A drop, a
   breakdown start or end, a full stop, a texture switch, a stinger. A cut over a steady bed
   needs nothing. **Most picture marks die at this filter.**
2. **Is it OFF the music's own structure?** Survivors that land on bar lines, or repeat on a
   regular period (every 8 bars, every 16), are **structure, not constraint** — one rule
   generates all of them, and Stage 7 stamps that rule from `spec.json` in post. A mark
   qualifies as tight only when it is **irregular**: off-grid, syncopated, or at an interval the
   music's own phrasing would never produce on its own.
3. **Does it need a NEW transient, or just a level/filter change?** Stage 7 imposes gain and
   filter envelopes — it *shapes* what the take contains. It cannot *add* a crash, a stab or a
   hit that isn't in the material. A mark needing a new transient is a genuine Route-D mark; a
   mark needing "get loud here" or "hollow out here" is a Route G + Stage 7 mark.

**Then read the survivors:**

| Survivors | Read |
|---|---|
| **0** | Route G alone. |
| **1–3, regular** | Route G + Stage 7. This is the overwhelmingly common case, including for dense-cut films. |
| **A handful, irregular, level/filter only** | Still Route G + Stage 7 — envelopes are timbre-agnostic and land exactly. |
| **Dense AND irregular AND transient-hungry** — the bed must change faster than roughly once every two bars, at times its own phrasing wouldn't produce | Route D. This is the case D exists for, and it is rarer than it looks. |

**Mechanically, if you want the number rather than the judgment:** you already have both clocks —
the musical grid in `spec.json` (`decode_audio --mode grid`: tempo, downbeat phase, bar length)
and the picture's beats from the film's own decode. For each surviving mark, take its position
modulo the bar and ask whether it sits on a beat subdivision within tolerance. ⚠️ **Compute the
chance baseline before believing that answer** — with tolerance `tol` and step `step`, pure noise
scores `2*tol/step` on-grid, and at loose tolerances that is most of the way to 100%. A mark set
that is "90% on-grid" against a 75% baseline is telling you nothing. Where the baseline swamps
the signal, fall back to the interval test in filter 2: are the gaps between marks a constant, or
a multiple of one?

> ## ⭐ ROUTE G IS THE DEFAULT — Route D is the exception
> **Start from Route G and stay there unless the beat requirement is TIGHT** (many events that
> must land on specific timestamps). This is a **standing user commitment**
> ([`taste/GLOBAL.md`](../taste/GLOBAL.md), 2026-08-01), and the reason is the deliverable, not
> the architecture: **Route D music is typically bad.** Its exactness is real, but it buys
> placement with timbre, and a bed that lands perfectly and sounds thin and synthetic is the
> wrong trade for most launch films.
>
> Route D's advantages — sample-exact placement, a closed control loop, $0 vendor spend — are
> genuine and they are also **seductive**, because they are the ones that are easy to *measure*.
> The quality you give up is the one you cannot. Do not let a tidy verification story pick the
> route. **When the sync genuinely demands D, say so in one line before taking it.**

| Time-indexed constraints | Route | Why |
|---|---|---|
| **0** — one loop, no internal structure | **Route G (generate)**, Stages 0–10 | prose carries global properties fine; the generator can own the whole bed |
| **1+** — drops / breakdown / cut-sync | **Route G + Stage 7 (impose)** — the default at this level too | prose CANNOT bind an event to a timestamp, but Stage 7 stamps it in post from `spec.json`, keeping the generator's timbre |
| **MANY, TIGHT — a dense grid of marks the music must hit** *(and a palette you can write as equations)* | **Route D (deterministic)** — see §Route D | the only case where exact-by-construction placement is worth the timbre it costs |

**⭐ The palette picks the route; the route never picks the palette.** Route D can only produce
sounds you can write equations for — synths, drum synthesis, noise, plucks, and a modeled
struck-string piano. So if the palette chosen above is **orchestral, performed or recorded**
(strings, guitar, brass, choir, hand percussion, a live room — or a piano that must sound
*played* rather than modeled), **Route D is unavailable for timbre no matter how tight the sync
is**, and the correct shape is **Route G for timbre + Stage 7 to impose the
arrangement** — which binds every event to its timestamp just as exactly, because Stage 7 does
that in post from `spec.json`, not in the prompt. Picking Route D because the sync looks hard
and *then* discovering the film needs an acoustic bed is the expensive order to do this in.

**What a prompt-driven generator actually preserves, measured:**

| Property | Survived the prose translation? |
|---|---|
| Tempo, duration, genre, timbre, density | **Yes** — 134 BPM at 95.9% on-grid, mean dev 0.049 vs 0.25 for chance; 35.243s exact |
| Key | **Partly** — registered, landed a semitone off (asked B, got B♭) |
| Anything bound to a timestamp | **No** — sub flat at −17…−21 dB for all 35s: no breakdown, no drop, no impacts |

So: **ask the generator only for what survives, and obtain everything that must be exact by
deterministic means.** A prompt that asks for the rest buys nothing and costs a take.

---

# Route G — generate, select, correct, impose

## Stage 0 — Decode the reference by MEASUREMENT `[GENERIC]` (free)

Never open with "listen and describe." You cannot hear; the first artifact is numbers that
reproduce. Extract mono WAV, then measure:

1. **Onset envelope** — spectral flux: short overlapping FFT, log-magnitude, sum the
   positive frame-to-frame change.
2. **Tempo + downbeat phase** — score candidate BPMs directly (grid-fit, not raw
   autocorrelation): for each BPM in 70–200 at 0.1 steps, slide a beat grid through every
   phase and score onset energy landing on grid lines. **Sanity gate: do N whole bars ≈
   clip length?** If not, the tempo is wrong.
3. **Adjudicate the pulse** with an **inter-onset-interval histogram** — the IOI mode must
   equal your 16th. (This is what killed a "172 BPM, high confidence" claim: mode at 110ms
   = the 134 BPM 16th at 111.9ms.)
4. **Loop period** — autocorrelate the bass envelope at long lags.
5. **Structure** — sub-band (< 90 Hz) impacts → drop timestamps; solve downbeat phase as
   the value that puts every impact on a bar line. **Measure each drop's lift above the
   track's own baseline in dB** — a drop that never clears its own baseline is not a drop,
   and this is the easiest measurement to skip.
6. **Kick pattern** — 45–130 Hz transients per 16th slot.
7. **High-band character** — 7–15 kHz transients **per bar**. Sparse (negative space) or a
   running hat? This is a real, checkable palette property.
8. **Energy arc + how the reference ENDS** — per-100ms RMS → `fade_start_s` (the last
   moment it was still at working level), `natural_decay_s`, and `ends_abruptly`. The
   measured decay length is what the bed's release mirrors, so a fade is never a guess:
   one reference's energy "falls off a cliff at 9s" and the tool reads `fade_start_s: 9.0`,
   `natural_decay_s: 1.565`.
9. **Key fingerprint** — per-bar bass-root histogram off a zero-padded FFT, **and** a
   grid-free 1200-bin cent-resolution cyclic spectrum for later interval comparison.

```bash
# --input takes a URL, a file:// link, or a local path
uv run python tools/decode_audio.py --job $JOB --mode grid --input <url|file> --target-root <key>
```

**Write `jobs/<id>/audio/spec.json`.** This is the contract: Stages 2, 5, 6, 7 and 9 all
read it, and **Stage 9 asserts against the same object Stage 0 wrote.** Keep the spec in a
file, not in your head: a defect like "the key came out a semitone off" should fail an
assertion, not surface as a passing remark.

```json
{ "bpm": 134.0, "downbeat_phase_s": 0.134, "sixteenth_s": 0.111940,
  "bar_s": 1.791045, "duration_s": 35.2427, "loop_bars": 4, "loop_period_s": 7.160,
  "tonal_center": "F", "target_tonal_center": "B",
  "breakdown_s": [14.463, 18.045], "drops_s": [18.045, 25.209, 32.373],
  "drop_lift_db": 9.0, "hf_per_bar": 2.8, "fade_start_s": 33.45,
  "band_targets_pct": {"sub":19.4,"bass":13.3,"lomid":8.4,"mid":10.7,"hi":15.6,"air":32.1},
  "sub_rms_ratio": 0.896, "centroid_hz": 4141,
  "key_profile_cents": [ /* 1200 bins */ ] }
```

**This is the only stage that touches the copyrighted source** — and it takes only
non-copyrightable structure. No melodic or harmonic material carries forward.

## Stage 1 — ONE listening pass, for words only `[GENERIC]`

```bash
uv run python tools/gemini_video.py --job $JOB --url <reference> --mode custom \
  --output jobs/$JOB/audio/ref_description.md --prompt "<blind decode prompt>"
```

Ask for: audible layers with time ranges, timbres, mix character, genre reference point.

**Its timbre words describe the REFERENCE, they do not prescribe OURS.** They are one input to
§The palette decision — useful for knowing what you are replacing, and actively misleading if
copied forward, since the reference's sound is the part you are deliberately not inheriting.

**Keep the descriptions. Discard every number.** Not a guideline — it was wrong on the
headline number in *both* runs (120 vs measured 89.2; 172 vs measured 134, plus F minor on
a track whose two rarest pitch classes are A♭ and E♭). **Gemini is EYES, not TASTE**
(CLAUDE.md) — and on measurement it isn't even eyes. Give it ≥8k `max_output_tokens` or it
silently truncates.

## Stage 2 — Keep/change table, then INVERT the prompt `[GENERIC]` (free)

Write the two columns explicitly, keep-column values verbatim from `spec.json`, **and the
chosen palette in the change column with the source that decided it** (§The palette decision).
Show the human this table before spending — it's the cheapest checkpoint in the recipe, and the
only one where the sound can still be changed for free.

Then write the prompt, and **delete every timestamp from it.** If Stage 7 is going to
impose the arrangement, ask for the *opposite* of an arrangement. Two worked examples in
**different palettes** — read them for their SHAPE, never for their instruments:

> *(electronic)* — *"Instrumental liquid drum & bass bed, exactly 134 BPM, B natural minor.
> Two-step break, glassy FM bell plucks, hollow PWM pulse bass, breathy filtered-noise pad.
> **Uniform energy throughout — no breakdowns, no drops, no builds. Consistent loopable
> texture start to finish.** Clean, analytical, driving. No vocals."*

> *(acoustic)* — *"Instrumental acoustic bed, exactly 96 BPM, D major. Fingerpicked nylon
> guitar, upright bass, brushed kit, warm close room. **Uniform energy throughout — no
> breakdowns, no drops, no builds. Consistent loopable texture start to finish.** Intimate,
> unhurried. No vocals."*

The shape both share is the transferable part: *instrumental · exact BPM · forcefully stated
tonic · uniform energy · loopable · no vocals.* Everything between those clauses is the
palette, and it comes from the palette decision — **do not inherit either example's
instruments**. The gateway music route carries timbre and genre faithfully in the recorded
evidence (it is the one property that survives
the prose translation, measured), so this is exactly the field to hand it and let it perform.

Flat is the *deliverable*, because you supply the dynamics. This turns the generator's
biggest weakness into an asset.

```python
assert not re.search(r"\d+\s*(second|s\b|:\d\d)", prompt)  # timestamps deliver nothing
assert "uniform" in prompt.lower()                          # flat is the goal
```

**State the tonic forcefully** — "strictly in the key of X: the tonic is X, every chord is
rooted on X minor, the bass plays X" moved a take from 0.51 to 1.78 semitones off the
reference. Also state the negative-space property in positive terms ("sparse foley clicks,
no continuous hi-hat run") — but see the hi-hat rule below; expect to lose this one.

## Stage 3 — Request params `[GENERIC]`

`--duration-sec > 30` requests the semantic `quality: "long"` route. The current gateway quote
is authoritative for what that request costs and selects; this workflow does not predict a
provider/model. The longer route seeks variation — **the exact thing you're suppressing when
Stage 7 owns the arrangement.** So for a >30s target on the impose path, request **≤30s**
and let the existing seamless-loop post pipeline fill the remainder. Cheaper, faster,
more on-spec. For a ≤30s bed with no imposed structure, request the real length.

## Stage 4 — FAN OUT, don't iterate `[GENERIC]`

```bash
uv run python tools/score_bed.py --job $JOB --mode generate \
  --input <silent plate|reference> --duration-sec 30 \
  --output jobs/$JOB/audio/cand_00_mix.wav --prompt "<Stage 2 prompt>"
```

**N = 2–3 for a simple loop; 6–8 when the brief is tight.** Run each candidate as its own
foreground call, never in the background or as parallel processes. ⚠️ **Above N = 2,
generate one candidate first and verify it end-to-end through Stage 5 before generating
the rest** — a fan-out is the easiest place to spend real money on inputs that
turn out to be malformed. The reason to fan out at all is
structural, not thoroughness: *you cannot close a control loop on a prompt-driven
generator.* Measuring "the sub is 10 points too hot" maps to a specific coefficient in
Route D and to **nothing** in Route G. Selection pressure is the only available substitute
for iteration. The host's current ask-each, capped, or unlimited authority—not this
document—decides whether the next paid wave can run. Keep the fan-out inside that authority.

**Copy every raw output immediately** — the tool overwrites `jobs/$JOB/audio/generated_bed.mp3`
on every run:

```bash
cp jobs/$JOB/audio/generated_bed.mp3 jobs/$JOB/audio/cand_00_raw.mp3
```

**Work from the RAW take, not the tool's trimmed mix** — the post pipeline's trim picks the
loudest window, not a bar line. You cut it yourself in Stage 8.

## Stage 5 — Score and gate mechanically `[GENERIC]` (free)

One scorecard per candidate, ranked. This stage is pure decision — it writes no audio.

```json
{ "id": "cand_03", "measured_bpm": 134.0,
  "tempo": {"on_grid_pct": 95.9, "mean_dev": 0.049, "ratio_err": 0.0000, "pass": true},
  "key": {"root_histogram": {"A#":9,"F":5,"A":3}, "detected": "A#",
          "interval_from_ref_semitones": 1.0, "shift_to_target": 1.0, "verdict": "CORRECT"},
  "bands_pct": {"sub":12.6,"bass":17.0,"lomid":15.8,"mid":15.9,"hi":16.9,"air":20.9},
  "band_l1_error": 34.2, "hf_per_bar": 10.2,
  "vocal_stem_db": -18.2, "vocal_gate": "REJECT", "flatness_ok": true }
```

```bash
uv run python tools/decode_audio.py --job $JOB --mode compare \
  --candidates jobs/$JOB/audio/cand_*_raw.mp3 --vocal-stems <one stem per candidate>
```

**Gates:**

| Check | Threshold | Fail action |
|---|---|---|
| Tempo | `mean_dev < 0.12` on-grid **and** `\|1 − bpm_ratio\| < 0.01` | re-roll — **never stretch** |
| Key closure | candidate must hit `target_tonal_center` **and** differ from the reference by ≥2 semitones | a miss is correctable only when the shift to the explicit target is **≤ 2 semitones**; otherwise re-roll |
| **Which key measurement gates** | the **bass-root vote** when both sides are decisive (≥4 bars, winner ≥1.5× runner-up and ≥30% share); the cent-profile rotation otherwise, **flagged low-confidence** | on a low-confidence read, do not assert a key — eyeball it |
| **Vocals** | vocal stem **< −35 dB** | reject, or keep the instrumental stem |
| Duration | ≥ target (loopable) | re-roll |
| Band balance vs `band_targets_pct` | advisory only | **do not chase** — a different palette *should* have a different signature |
| `flatness_ok` | impose path requires sub-energy range ≤6 dB — **flat PASSES** | re-roll; Stage 7 owns dynamics |

**The vocal gate is the newest check in this recipe — treat its threshold as provisional and
sanity-check a rejection by ear before binning a take.** `force_instrumental` is deliberately NOT
sent on the gateway path (`tools/score_bed.py:479-483` — Lyria 3 rejects negative prompting
outright and it 422'd every generate call until that was removed), so **prompt text is the
only safeguard**. Use the repo's own stem splitter to make it a hard gate:

```bash
uv run python tools/score_bed.py --job $JOB --mode split --input jobs/$JOB/audio/cand_03_raw.mp3
```

Measure energy in the `vocals` stem. A blind critic reported "chopped vocal loops" on a
Lyria bed and it could not be settled by any spectral probe (a syllabic-AM probe scored a
*pure-synth* track higher than the real reference — it measures rhythmic density, not
voices). The split converts an unverifiable claim into a number.

## Stage 6 — Correct, within strict bounds `[GENERIC]` (free)

Two deterministic fixes, and **only** these two:

- **Key:** pitch-shift by the exact measured delta. **≤ 2 semitones, transparent.**
- **Tempo/phase:** micro-stretch to exact BPM **only if `ratio_err < 0.01`**, then align
  the downbeat.

```json
{ "pitch_shift_semitones": 1.0, "time_stretch_ratio": 1.0000,
  "downbeat_offset_ms": -47, "out": "cand_03_corrected.wav" }
```

> **⛔ THE HARD RULE, earned by throwing away finished work:** never pitch-shift **AND**
> retime in the same pass. Resampling down 2.7 semitones plus a 17% phase-vocoder stretch
> to claw the tempo back produced *"slowed-tape character on the drums, underwater smearing
> on the pad, blunted transients"* — mechanically explainable, so it was believed and the
> beds were binned. Shift alone at ≤2 semitones is safe; shift + real stretch is not.
> If a take needs both, **re-roll it.**

Two ffmpeg traps if you shift with `asetrate`:
- **`aresample` BEFORE `asetrate`.** `asetrate` reinterprets the *current* stream rate — a
  44.1k mp3 fed `asetrate=48000*r` shifts by `48000*r/44100`, silently wrong. This
  under-applied a 3-semitone drop to 1.2 semitones and turned 89 BPM into 97.
- `rubberband` is a compile-time ffmpeg option and **this machine's build lacks it** —
  which is *why* the `asetrate`+`atempo` mush happened. `signalsmith-stretch` (MIT) is the
  permissive fix; `pyrubberband` shells out to a GPL-2.0 binary.

## Stage 7 — Finish first, THEN impose the arrangement `[GENERIC]` (free)

> **⚠️ ORDER IS LOAD-BEARING:** arrangement must come AFTER the finish, never before.
> Arrangement timestamps are defined on the **output** timeline, so stamping them before the
> cut puts every drop seconds from its mark. Run `--mode finish` (Stage 8) first, then
> `--mode arrange`, and let arrange re-normalize — imposing dynamics changes loudness by
> design, so −14 LUFS must be set after it.

Only when `drops_s` is non-empty.

Everything prose couldn't carry, stamped from `spec.json` with a volume/filter envelope:

```json
{ "breakdown": {"span_s": [14.463, 18.045], "sub_gain_db": -60, "hp_hz": 340, "release_ms": 40},
  "drops": [{"t": 18.045, "lift_db": 9.0}, {"t": 25.209, "lift_db": 9.0},
            {"t": 32.373, "lift_db": 9.0}],
  "fade": {"start_s": 33.45, "end_s": 35.2427, "curve": 0.55} }
```

**Take `lift_db` from the reference's own measured drop profile at 1-second resolution.**
At 0.1s resolution a drop can look present when it isn't clearing its own baseline — that
resolution error is what let a valid "anti-climactic from 0:20" critique get wrongly
refuted. A drop erupting out of true silence is huge; a drop level with its surroundings
isn't a drop.

Same mechanism for the **tail arc**: if the reference collapses at the end (one measured
−14.2 dB below its own average over the last 1.5s) and your bed runs flat to the cut, a
volume envelope matched it to within 0.9 dB. Ship both the flat and the ring-out cut —
**flat if the bed must loop or sit under a longer edit; ring-out if it IS the whole cue.**
Caveat to state: ducking ≠ muting. If the reference stops the percussion and lets a chord
hang, a duck still has the hat ticking 13 dB down underneath.

## Stage 8 — Finish `[GENERIC]` (free)

Find the bar line by scoring which downbeats carry kick energy across 4 consecutive bars →
cut a window that puts the output downbeat **at the reference's downbeat time** → tempo
trim (only if tiny) → **edge fades** → highpass ~28 Hz → two-pass `loudnorm` to
**−14 LUFS, TP −1.0** (measure, then apply with `measured_*` — single-pass drifts).

**The tail is not a detail — it is the difference between an ending and a cut.**
- **In:** 8 ms de-click is all that's needed; the cut lands on a downbeat.
- **Out:** mirror the reference's own `natural_decay_s`, which `--mode finish` does
  automatically when the spec has one; otherwise `--fade-out` (**default 0.8s**). The old
  0.35s default still read as abrupt on sustained material.
- **Shape it.** A straight line sounds like someone pulled a switch. `--fade-curve qsin`
  (quarter-sine) is the default; `tri` is the linear one to avoid.
- **`--mode arrange` always closes the bed**, unconditionally — never make the fade
  conditional on a spec field, or a bed whose spec omits it ends mid-note.
- **A bed that must LOOP is the exception** — it should end at full level so it doesn't
  punch a hole in the middle of a longer edit. Pass `--loopable` and the closure assertion
  is skipped. Ship both cuts when you're unsure which the edit needs.

## Stage 9 — Verify the OUTPUT, not your intent `[GENERIC]` (free)

Re-measure the finished file and **assert against `spec.json`**. Verifying intent is not
verifying output — a verified-correct transposition still shipped at the wrong tempo once
because the ffmpeg chain silently changed both.

```json
{ "duration_s": {"got": 35.2427, "want": 35.2427, "pass": true},
  "bpm": {"got": 134.0, "want": 134.0, "tol": 0.3, "pass": true},
  "downbeat_s": {"got": 0.418, "want": 0.421, "tol_ms": 15, "pass": true},
  "lufs": {"got": -13.9, "want": -14.0, "tol": 0.5, "pass": true},
  "tonal_center": {"got": "B", "want": "B", "interval_from_ref": 3.08, "pass": true},
  "tail_closes": {"got": -22.3, "want": "<=-20 dB under the clip average", "pass": true},
  "drops_ms_error": [4, -11, 8], "pass": true,
  "vocal_stem_db": {"got": -51.0, "want": "<-35", "pass": true},
  "ALL_PASS": true }
```

First split the finished bed again, then verify; `verify` exits non-zero for any failed gate or
missing vocal evidence:

```bash
uv run python tools/score_bed.py --job $JOB --mode split \
  --input jobs/$JOB/audio/bed.wav
uv run python tools/decode_audio.py --job $JOB --mode verify \
  --input jobs/$JOB/audio/bed.wav --vocal-stem <finished-bed-vocals-stem>
```

Then mux onto the reference picture (or silent plate) so the human can A/B:

```bash
ffmpeg -y -v error -i <picture> -i jobs/$JOB/audio/bed.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest jobs/$JOB/audio/preview.mp4
```

## Stage 10 — QC, then QC the QC `[GENERIC]`

Blind listening pass on `preview.mp4`: *"Ignore the picture entirely. Judge ONLY the audio,
as a mixing engineer doing QC. Report mechanically with timestamps; do not rate or score
anything."* Never name the defect you expect.

**Then route every falsifiable claim to a measurement before it enters the report.** Expect
this pass to refute more than it confirms — roughly **10 refuted/unsubstantiated to every 7
confirmed** — but the confirmed findings drive the real fixes, so it earns its place as a
recall net.

| Claim type | Measurement that settles it |
|---|---|
| "goes quiet / rings out / dead air / hard cut" | per-100ms RMS over that window **at 1s resolution too** |
| "busy hats / sparse / too bright / dull" | 7–15 kHz transients per bar vs `hf_per_bar` |
| "smeared / warbly / slowed-tape / doubled transients" | same metric on the **pre-processing** file — before/after |
| "no sub-bass / boomy" | band % + sub/full RMS ratio vs `band_targets_pct` |
| "BPM is X" / "beats at …" | Stage 0 grid scan **on the output** |
| "clipped / crackling / distorted" | clipped-sample count + true peak; isolate the suspect generator in a unit test |
| "vocals / chopped vocal loops" | `--mode split`, vocal stem dB — **no spectral probe works** |
| "off-grid / clashes" | event times modulo the 16th |
| "cuts off at Ns" | `ffprobe` duration FIRST — a claimed defect past EOF is a confabulation |

Real confabulations caught this way, both of which would have been relayed as fact:
*"resolves and rings out, silence by 9.0s"* (full-level hits at 8.88s, 9.48s, 9.88s) and
*"total silence at 0:36"* (on a 35.24s file). And a real one kept: *"continuous hi-hats"* —
7–15 kHz transients per bar, reference 2.8 vs 8.1 and 10.2.

**Bounded regen ladder:** spend your attempts on a defect **class**, then surface it. "No
continuous hi-hat run" was written into three prompts and overridden in all three takes;
the honest move was reporting it unfixed, not another paid roll. If a defect needs
stem-level surgery (pulling one drum element down), note that standard 4-stem separators
give one fused `drums` stem — **LarsNet** splits kick/snare/toms/hats but is unverified
for license.

---

# Route D — deterministic construction (write the score as code)

> **⚠️ THIS IS THE EXCEPTION ROUTE, NOT THE DEFAULT.** Route G is the default
> ([`taste/GLOBAL.md`](../taste/GLOBAL.md), 2026-08-01) because **Route D music is typically
> bad** — everything below is true and the output still usually loses to a generated take.
> Come here only when the beat requirement is genuinely tight, and say so before you start.

**Entry condition, all THREE required:**

1. **The beat requirement is tight** — many events on specific timestamps, dense enough that
   Stage 7's post-imposition can't carry it. One or two drops is not tight; that is Route G.
2. **The palette is writable as equations** (§The palette decision) — anything acoustic,
   orchestral or performed rules this route out entirely.
3. **You said so out loud** — one line to the human naming why the sync demands it, before the
   first cue is written.

If only the sync half holds, you are on Route G + Stage 7, not here.

When both hold, skip the generator: **placement becomes exact by construction.** `step(bar, s)` returning
`0.134 + bar*1.791045 + s*0.111940` means the drop isn't *near* 18.045s, it's *at* it. Key
is an argument (`--root`), not an aspiration — **re-keying is one flag, not a re-roll.**

**The engine is [`skills/score_synthesis/`](../skills/score_synthesis/README.md)** —
`numpy`/`scipy` only, no API surface, $0 vendor spend. `synth.py` is the library (grid, voice
bank, Schroeder FX, mix/master helpers, `--selftest`); `score_template.py` is a complete
runnable cue you **copy into the job and rewrite**. It reads the clock straight out of
`spec.json`:

```bash
cp skills/score_synthesis/score_template.py jobs/$JOB/audio/score.py
uv run python jobs/$JOB/audio/score.py --spec jobs/$JOB/audio/spec.json \
    --out jobs/$JOB/audio/bed_raw.wav --root 35        # 35 = B1; THIS is the key
```

Then hand off to `--mode finish` (loudness) and `--mode verify` (assert vs `spec.json`) —
loudness is deliberately not done in the synth, so the number is measured, not asserted.
Read that skill's **Traps** section before writing a cue: a drop that never clears its own
baseline, an untuned kick that hijacks key detection, a pad voiced into the bass-root band,
and a block-filtered sweep that clicks are all defects it has already been bitten by.

**Verification becomes a closed control loop** — this is the real advantage. Each round:
render → measure → compare to `spec.json` → change a coefficient → re-render. Eight
iterations, each driven by a measured quantity: sub at 29% vs the reference's 19% → cut the
gain; overshot to 9.8% → split the difference; 80–160 Hz at 5.9% vs 10.9% → lengthen the
pulse decay; melody lifting only +2.2 dB → raise it and cut colliding arp notes.

**⭐ Its ceiling is timbre, and that ceiling is a ROUTING CONSTRAINT, not a caveat you note and
then work around.** You can only produce sounds you can write equations for — oscillators,
synthesized drums, noise, simple plucks — and **no amount of iteration turns that into a piano,
a string section, a nylon guitar or a room.** A cue written to imitate an acoustic palette in
`numpy` lands in the uncanny middle: neither honestly electronic nor convincingly played, and
the whole eight-round control loop below cannot see the problem because every measured quantity
is on target. If the palette is acoustic or performed, leave Route D on the shelf however tight
the sync is. Route D also introduces *your own* analysis bugs: coarse FFT bins
(43 Hz, and one 10.8 Hz bin swallowing all sub energy) made every track read "F and C"
regardless of content, and a riser was misdiagnosed as a crackling source (isolated testing
showed a mild 1.46× boundary artifact).

**Where the two routes' verification sits is the whole difference:** in Route D, measuring a
defect is the first step to fixing it. In Route G, it only tells you whether to keep the
candidate or re-roll. Run the **identical probes and thresholds on both** — that's the only
reason "Lyria is dynamically flat" and "my drops don't clear their own baseline" are
findings on the same scale.

**The hybrid is the honest best of both** when the app-owned quote and spend cap allow it:
Route G for timbre → Stage 6
correction → Stage 7 arrangement imposed from `spec.json`. Vendor polish with picture-lock.

---

## Hard rules

| Rule | The failure that produced it |
|---|---|
| **Route G is the default; Route D is the exception** | Route D music is typically bad — it buys placement with timbre. Take D only for a tight beat requirement (many marks), and announce it in one line first. Standing commitment, `taste/GLOBAL.md` 2026-08-01. |
| **Never let a tidy verification story pick the route** | D's closed control loop and $0 spend are the easiest properties to measure, so they over-argue for D; the quality it costs is the one you can't measure. Measurability is not merit. |
| **Never let the route choose the palette** | Route D can only synthesize what you can write equations for, so choosing it first — because the sync looked hard — silently commits the film to an electronic bed nobody picked. Decide the palette (deduce, else ask), then route. |
| **Never default the palette to synths, and never copy the reference's timbre** | This recipe's worked examples come from one trading-terminal clone; treating that instance as the house sound makes every launch film sound alike. The reference's own timbre is the copyrighted part being replaced — it is evidence, not a brief. |
| **Never say "we can only do synths"** | Route G has always been a general text-to-music engine — piano, brass, strings, acoustic are one prompt away. Only Route D is oscillator-bound. The limit was a doc default, not a capability; check §What each engine can actually make before declining a palette. |
| **Ask when the palette doesn't deduce** | It is the first thing a human hears and the only creative field here with no measurable right answer. One question before spend beats a full re-roll after it. |
| Never pitch-shift **and** retime in one pass | 17% phase-vocoder stretch → slowed-tape drums, underwater pad. Work binned. |
| Never name a key from 12-TET pitch-class bins | Material sits tens of cents off concert; bins smear. One take read "same key" *after* a verified downshift. Use the cent-resolution cyclic profile or a bass-root histogram. |
| Never trust a listening pass's numbers | "120 BPM, high confidence" on a 89.2 BPM clip; "172 / F minor" on a 134 / F-major drone. |
| Never put a timestamp in a generation prompt | Four sentences of timestamped structure delivered nothing, twice. |
| Take the RAW take and cut it yourself | The built-in trim picks the loudest window, not a bar line. |
| Copy the raw output immediately | `generated_bed.mp3` is overwritten every run. |
| `aresample` before `asetrate` | It uses the decoder's rate — wrong ratio, silently. |
| Measure drop lift at 1s resolution, not 0.1s | A valid "anti-climactic" critique got wrongly refuted at 0.1s. |
| `ffprobe` duration before believing any "cuts off at N" | Two separate confabulations were past EOF. |
| Cut from the RAW take — alignment needs a bar of slack | Feeding a 35.2s bed for a 35.2s target leaves nothing to trim, so the downbeat cannot be moved at all: duration and alignment become mutually exclusive. The raw vendor take (27.8s for a 10.58s bed) has the headroom. |
| A pitch shift ALWAYS retimes — pre-compensate instead | `asetrate` moves pitch and tempo by the same ratio, so holding tempo requires a phase vocoder. Ask the generator for `target_bpm ÷ 2^(shift/12)` and a pure resample lands both, with zero stretch. |
| Assert that the bed ENDS, don't just hope | A bed still within 20 dB of its own average in the final 100ms was cut, not ended. `verify` now gates on it — and that gate independently reproduces a judgment that used to need a manual A/B: of two beds shipped from one job, the flat one fails at −13.1 dB and the ring-out passes at −41.2 dB. |
| Never assert tighter than the instrument measures | The sub-band drop locator is ±0.5s on saturated material; asserting 50ms against it is false precision, not rigour. |
| Don't chase band balance to parity | A different palette *should* have a different signature; stop at ~4–6 points. |
| `-map` explicitly when muxing the bed onto video — never rely on default stream selection | A render's existing placeholder audio track silently won over `bed.wav` with no `-map`; the mux exited 0 and shipped near-silent (−91 dB vs the bed's −15 dB). |
| Verify the SHIPPED file's duration in frames, every render, even a re-run of the same command | One render produced 892 frames against a 802-frame request with correct props and exit 0 — an unexplained ~3s overrun that only `ffprobe`'s `nb_frames` caught. |
| Fade the SHIPPED mix, not just `bed.wav` — and size it ≥1–1.5s | A verified-closing bed still shipped with a hard cut downstream (mux had no fade at all); a 0.6s fade on energetic material still read as abrupt on blind QC. |
| Confirm a fade with raw sample peaks, not a narrow-window `astats`/RMS probe | A 0.05–0.1s windowed RMS read flat/unchanged across a real, verified fade; direct peak inspection (19,837 → 486) caught it immediately. |

## Cost ownership

The engine reports the operations it expects to run and can estimate their cost, but it does
not own a budget or authorize spend. Before a paid listening, generation, or QC fan-out, the
canonical app obtains the current gateway quote and applies the video's app-owned spend cap.
Standalone clients may provide their own authorization policy. Route D's synthesis and the
mechanical stages are local and vendor-free once the reference is on disk; acquiring a remote
reference bills the audio-only acquisition rail, and any model-based listening or QC is still
quoted.

## The tool

`tools/decode_audio.py` — six modes, no vendor API surface; numpy + scipy only (no librosa
install needed). The one spend is `resolve_ref`: a remote `http(s)` reference is ripped
through `pull_video`'s audio-only gateway seam and bills on that acquisition rail. Local
paths, `file://` URLs, an already-cached rip (no `--regen`) and `--selftest` are free.

```bash
uv run python tools/decode_audio.py --selftest                    # synthetic ground-truth checks
uv run python tools/decode_audio.py --job <id> --mode grid    --input <ref> --target-root B
uv run python tools/decode_audio.py --job <id> --mode compare --candidates a.mp3 b.mp3 [--vocal-stems …]
uv run python tools/decode_audio.py --job <id> --mode correct --input cand.mp3 --shift-semitones 1 --output c.wav
uv run python tools/decode_audio.py --job <id> --mode finish  --input c.wav --output bed.wav [--match-tail]
uv run python tools/decode_audio.py --job <id> --mode arrange --input bed.wav --output bed_arr.wav
uv run python tools/decode_audio.py --job <id> --mode verify  --input bed_arr.wav --vocal-stem vocals.wav
uv run python tools/qa_gate.py --mark-audio --job <id> --input audio/bed_arr.wav
```

**What it reproduced on the two references** (independent re-measurement, not a replay):

| | measured before, by hand | `decode_audio --mode grid` |
|---|---|---|
| jtx tempo | 134.0 BPM | **134.0** |
| jtx IOI mode | 110 ms (vs a 111.9 ms 16th) | **110.5 ms**, agrees |
| jtx loop | 4 bars / 7.160s | **4 bars / 7.164s** |
| jtx tonal centre | F (votes F:7 F♯:4 C♯:3 A:2) | **F** (F:8 F♯:4 A:3 C♯:3 G♯:1) |
| jtx drop lift | +9 dB | **+9.9 dB** |
| yt-short tempo | 89.2 BPM | **89.16** |
| yt-short HF/bar | 2.8 (sparse) | **3.1** (sparse) |
| yt-short drops | none (flat 4-bar loop) | **none** |
| the two shipped beds' keys | B = tritone from F; Lyria B♭ = IV of F | **+6.00** and **+5.00**, high confidence |

**Where it disagrees with the earlier manual numbers, and why it is right:**
- **The downbeat.** Hand-measured 0.421s; the tool says 0.500s. A direct probe of the raw
  transients lands four separate onsets within 1–3 ms of the tool's grid and 78–136 ms
  from the old one. The old figure came off a 2048-sample STFT whose flux peaks as a
  transient *enters* the window — a systematic ~80 ms early bias. The shipped bed was
  matched to the biased reference number, so its *relative* alignment was still right,
  which is why nothing sounded wrong.
- **The jtx drop timestamps.** Hand-recorded as 18.045 / 25.209 / 32.373. That sub is a
  near-full-scale continuous pedal with no clean transient — a direct probe puts its
  "biggest sub rise" at 18.475 / 25.770 / 32.565. The tool reports drops **snapped to the
  bar grid** with a ±0.5s resolution note, and flags any that fall off the loop pattern
  (one of the three does). Two of three then verified back to within **2 ms** after
  `--mode arrange`.

**Still unexercised:** the parallel fan-out (Stage 4 at N>2) and the vocal gate
(`--vocal-stems`) have never run on a live job.

## Provenance contract

Gateway generations record the semantic route, gateway job id, and authoritative cost fields.
The ordinary gateway job API intentionally withholds provider/model, so the engine records
`provider_model: gateway-resolved` rather than inventing a model from quality or old routing
documentation. Direct-key fallback receipts may name the provider/model they actually invoked.

## Handoff

`bed.wav` is the verified working file. When this workflow itself is the deliverable,
`qa_gate --mark-audio` publishes the byte-identical canonical `audio/master.wav` plus
`audio/master.receipt.json`; a preview or intermediate bed is never the declared output.

- **Bed under a cut** → record a `videoclaw.music-rights/v1` decision bound to the exact
  master hash, then run `score_bed --mode bed --music audio/master.wav
  --rights-evidence rights/music.json` (one flat, quiet bed under the voice + SFX; it never ducks).
- **Beat-synced edit** → feed `spec.json`'s beat grid to `trend-duplication` §5 /
  `cinematic-ad` Stage 4.
- **A new bed makes a new `final.mp4`** — the finished render is a complete draft
  ([Finishing a render](README.md#finishing-a-render)). Stage 10 here covers the *bed*,
  not the film.

### Stage 11 — Build the handoff mux right

Stages 8–10 measure `bed.wav` in isolation. **A clean bed does not mean a clean mux** — a
launch-video job earned this the hard way: `bed.wav` closed properly and measured the
correct duration, yet the muxed `final.mp4` had no audible music and cut off ~3 seconds
into runaway silence, because the defect was in the handoff mux itself. When the target is
a custom or HyperFrames render (not `score_bed --mode bed`'s own pipeline), build the mux
with construction rules 1–3 below; a render command exiting 0 does not prove any of them.
Reading the finished file back (the stream/loudness read in 1, the raw-sample read in 4) is
an optional diagnostic.

**1. `-map` explicitly, always — never trust default stream selection.**
A generated composition can carry its **own audio stream** even when the job has no intended
dialogue or bed — some renders emit a near-silent placeholder track.
`ffmpeg -i video.mp4 -i bed.wav -c:v copy -c:a aac out.mp4` with no `-map` follows ffmpeg's
default per-type stream selection, which can pick that placeholder over `bed.wav` — the mux
exits 0, the file plays, and it is **near-silent** (measured **−91 dB** mean volume vs the
bed's own **−15 dB**). This is silent in every sense: no error, no warning, a normal-looking
file. Always pin both streams by index when you build the mux:
```bash
ffmpeg -y -i final_composited.mp4 -i jobs/$JOB/audio/bed.wav \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest jobs/$JOB/final.mp4
```
Optional diagnostic, if you suspect the mux: `ffprobe -v error -show_entries stream=index,codec_type,nb_frames -of default=noprint_wrappers=1 final.mp4` shows exactly one video and one audio stream when it landed, and
`ffmpeg -i final.mp4 -af volumedetect -f null -` reads close to the bed's own measured
loudness (≈ −14 to −16 dB mean for a −14 LUFS master), never below −60 dB.

**2. Confirm the rendered length in frames before you mux.**
A render command can silently return the wrong length even with correct
`durationSeconds`/`fps` props and exit code 0 — one render in the wild produced **892 frames
(29.73s) instead of the requested 802 (26.73s)**, an unexplained ~3s overrun (a re-run of the
*identical* command immediately after produced the correct 802). Read the frame count off
the picture render you are about to mux:
```bash
ffprobe -v error -show_entries stream=index,codec_type,nb_frames,duration \
  -of default=noprint_wrappers=1 <rendered_file> \
  # every stream's nb_frames / fps must equal the intended durationSeconds — recompute it,
  # don't eyeball it. A mismatch here means RE-RENDER before muxing, not "close enough."
```
Because this failure mode has no known root cause yet and reproduced non-deterministically
in one session, "it worked last time on the same command" is no guarantee.

**3. The bed closing (Stage 8/9) does not mean the muxed file closes.** A `-shortest` trim,
a re-encode, or muxing onto a video whose own duration is wrong (see check 2) can all
re-introduce a hard cut downstream of an already-verified `bed.wav`. Build the fade-out
into the mux itself, sized generously — **≥1.0–1.5s**, not the bare minimum. A 0.6s fade on a busy/energetic bed still read as **abrupt** in a blind model listening
test; 1.5s did not.
```bash
ffmpeg -y -i final_composited.mp4 -i jobs/$JOB/audio/bed.wav \
  -filter:a "afade=t=out:st=<duration_s - 1.5>:d=1.5" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest jobs/$JOB/final.mp4
```

**4. Optional diagnostic — if you check a fade, measure raw samples, not a narrow-window `astats`/RMS probe.**
Short-window (`-t 0.05`–`0.1`) `astats` RMS reads on a `-ss`-seeked extract came back flat
(**~ −15.4 dB, unchanged**) across a fade that demonstrably existed — the tiny window is not
a reliable instrument for this. A direct raw-PCM peak check on the same file caught the real
fade immediately (**peak ~19,837 → ~486** across the last 0.7s):
```bash
uv run python3 -c "
from scipy.io import wavfile
import numpy as np
sr, a = wavfile.read('extracted_audio.wav')
for t in [d - 1.0, d - 0.5, d - 0.3, d - 0.1]:   # d = file duration in seconds
    i = int(t * sr); print(t, np.abs(a[i:i+200]).max())
"
```
Peaks should monotonically fall toward the tail; if they don't, the fade did not apply,
regardless of what a short-window RMS filter reported.

**Follow construction rules 1–3 whenever you mux a new bed OR a new picture render** — a
new picture render is exactly as capable of reintroducing these defects as a new bed is.
The muxed `final.mp4` is then a complete draft ([Finishing a render](README.md#finishing-a-render));
the read-backs above are optional.
