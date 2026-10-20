# Assembly craft — go your own way; here's what's worked

**The stance:** bespoke assembly is a FEATURE of this repo, not a failure mode. When a job
needs a one-of-one timeline (split-screen, PIP composites, kinetic text, beat-stabbed
beds), write the script the job demands — every idiom below came from an agent doing
exactly that. `tools/assemble.py` covers the boring 80% (trim → normalize → concat → mux)
so you never re-derive it; this file is the idea catalog for the other 20%.

**The one rule that survives every path:** DECLARE the timeline when you're done —
`assemble.py --declare` (beats: name/role/start/end) — so every planned cut, still and
hold is on record as intentional.

Every idiom is verbatim-extracted from a shipped job (provenance noted; hand assemblers
historically live in `projects/<job>/assemble.{py,sh}` and `jobs/<job>/*.py`). Copy the
mechanism, re-derive the values. Mined 2026-07-10 across all 40+ job dirs + run logs.

---

## Normalization & concat hygiene (mostly inside assemble.py now — know WHY)

- **Cover-fit**: `scale=W:H:force_original_aspect_ratio=increase,crop=W:H,setsar=1` —
  the single most repeated fragment in the corpus. Its FAILURE mode is real: an inserted
  graphic that skipped it shipped with "ugly uneven black letterbox bars… an uncropped
  screenshot dumped onto the timeline" *(reel_13_his QA)*.
- **Concat timebase caveat**: identically-encoded segments can STILL diverge on `tbn` —
  the house assemblers re-encode at concat ("re-encode for uniform tbn",
  projects/working_habits). assemble.py forces a uniform `-video_track_timescale` and
  falls back copy→re-encode automatically; a hand script should do one or the other.
- **Segments from DIFFERENT generation calls** (multi-segment generated stitches): use the
  concat FILTER with re-encode, `[0:v][0:a][1:v][1:a]…concat=n=N:v=1:a=1`, never the
  demuxer — and pre-plan the video-only fallback, because generated clips can come back
  with NO audio stream *(licensed-scenes runbook)*.
- **"No audio track" ≠ "silent audio."** IG/VP9 pulls are often video-only; a bare
  `ffmpeg -i in.mp4 out.mp3` hard-errors ("Output file does not contain any stream").
  ffprobe for an audio stream first; treat absence as a branch, not a failure
  *(kumar_format_study breakdown crash)*. assemble.py's `has_audio()` is this guard.
- **Per-segment `setpts=PTS-STARTPTS` / `asetpts`** before concat *(jc_kumar)*.
- **Normalize `-pix_fmt yuv420p` on EVERY segment**: image-derived segments encode
  `yuvj420p` (full range), generation-derived ones `yuv420p` (tv range) — mixed in one
  concat list they read as brightness "pops" at cuts *(nn-learn latent bug; assemble.py
  forces yuv420p everywhere)*.
- **Short clip, longer beat** → `-stream_loop -1 -t <dur>` *(jcb_lovable `vid_full`)*;
  in assemble.py: `"loop": true` on the beat.
- **Test-render escape hatch**: a `LIMIT`/`--caps-only` arg that renders only N beats or
  skips finished stages — sample the look before the full render *(wolfram, trend-dup)*.

## Layout & compositing

**Split-screen: ONE cover-fit, THEN split — "the load-bearing rule."** Cover-fit the
source ONCE to the full 1080×1920, then crop that single frame into TOP
(`crop=1080:1080:0:0`) and BAND (`crop=1080:840:0:1080`). Independently cover-cropping
the same source twice produces two different crops that don't tile — the "duplicated
terminal across the hook seam" bug *(reel_12 rebuild postmortem)*.

**Two band-crop offsets, chosen by beat SEMANTICS:** `crop=1080:840:0:1080` =
seamless continuation (on-camera beats — one continuous face, no double face) vs
`crop=1080:840:0:280..400` = face-centered (card/split beats — the person stays visible
UNDER the card) *(reel_12/13, aircreative, humeo assemblers)*.

**Frame-exact dual-track lock.** Two parallel tracks (TOP + BAND) drift on seconds-based
trims; encode every segment to an exact FRAME count at CFR and speak in frames:
`-frames:v 159 -r 24 -vsync cfr` per segment, per-track concat, then
`[0:v][1:v]vstack=inputs=2` *(aircreative: 34+36+159+… = 655 frames = 27.292s)*.

**Card-on-mat compositor** *(reel_12/humeo `card_top()`)*: mat cover-fit to the tile +
card `scale=980:-1` + `overlay=(W-w)/2:(H-h)/2:format=auto`, rendered `-frames:v 1` then
looped to the beat length — the "hand-drawn card on a desk mat" look.

**Blur-fill letterbox — mismatched aspect into 9:16 without mangling:**
```
[0:v]split=2[a][b];
[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2,eq=brightness=-0.16[bg];
[b]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2
```
*(videoclaw-hype; the saas-demo "never portrait-crop a dense source" law.)*

**Pre-baked alpha avatar — cut-out person composited per beat WITHOUT re-masking.**
`alphamerge` pairs frames positionally; a 77s avatar + its SAM3 mask (merged from 3
chunked calls) drift apart. Force BOTH to one fps grid, bake alpha ONCE into ProRes
4444, then `-ss` into that single asset per beat:
```
[0:v]fps=24,setpts=PTS-STARTPTS[a];[1:v]fps=24,setpts=PTS-STARTPTS,format=gray[m];
[a][m]alphamerge → -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le avatar_alpha.mov
```
*(wolfram compose_pip.py.)* The SUPERSEDED version is instructive too: a fixed-position
boxed-corner PIP (`overlay=610:1116` + colorkeyed frame graphic) was REJECTED by the
client — the dynamic moving/fullscreen cut-out replaced it *(wolfram pip_filter.txt)*.

**Fullscreen-PIP treatment:** when the cut-out goes hero, the b-roll recedes —
`eq=brightness=-0.18:saturation=0.9,boxblur=6:1` under `scale=-1:1580` avatar anchored
`overlay=(W-w)/2:H-h` *(wolfram)*.

**The decoupled-cadence law.** The avatar holds a corner ~7–9s on its OWN jittered
schedule while b-roll cuts every ~2–2.6s — two independent timelines drifting in and out
of phase. Never move two elements on the same cut; synchronized changes read as
mechanical (direct client feedback) *(wolfram)*.

**Jittered durations everywhere.** Uniform beat lengths read robotic — cycle a jitter
list (`[2.4,2.0,2.6,2.2,1.9,2.8,…]` cuts; `[8.0,7.0,9.0,7.5,8.5]` holds) *(wolfram)*.

**Short base, long VO — two proven extenders:** ping-pong/boomerang loop (forward clip
concat'd with its reversed twin = seamless loop; also used to DOUBLE the dwell on a
payoff beat for free *(wolfram `_pp.txt`; nn-learn `_boom.txt`)*) vs the doubled base
(2× concat + route the seam beat to b-roll, [[lipsync-doubled-base-long-vo]]). Ping-pong
suits idle/ambient bases; doubling suits talking bases where reverse motion would show.

**Freeze-hold punctuation beats** *(nn-learn `_FH` segments)*: a 1.1s frozen frame
(`-loop 1 -i frame.png -t 1.125`) lands a "wrong guess" / punchline beat — a deliberate
exception to every-static-gets-motion, used as PUNCTUATION, ~1s, never a resting state.

**Feathered face-patch composite** *(jc_kumar `*_fixed.mp4` via lipsync_footage
composite)*: re-insert a corrected face region onto the base plate as a
`bbox {x,y,w,h}` + `feather: 30` blend — a soft rectangular patch instead of replacing
the whole frame; per-shot bbox tuning, never a fixed default. (The `face-crop-lipsync`
molecule is the full move.)

**Frozen tail pad — the outro-over-dialogue fix.** Physically extend the video past the
last spoken word so an end-card never covers speech:
`-vf "tpad=stop_mode=clone:stop_duration=1.6" -af "apad=pad_dur=1.6"` (clone freezes the
last frame, not black), then anchor the card to `lastWord.end + 0.25` *(avatar-speaker
rebuild)*. Related QA catch: ending the export on the exact frame the lips close chops
the audio decay — always leave tail runway *(reel_13_his)*.

## Motion on stills

**The Ken Burns variety pack** — five zoompan presets (zoom-in, zoom-out, pan L→R,
pan R→L, zoom-in-bias-up) rotated per beat *(wolfram)*. Now assemble.py's
`motion: "auto"`. **Pre-scale 2×** before zoompan — "so zoompan steps are
sub-pixel-smooth (kills the classic jitter)" *(the documented fix across the projects/
assemblers; trend-dup's 1.14× was a lighter variant)* — and `trim=duration=<dur>` after
(zoompan's frame math can overshoot).

## Text systems (when the caption presets can't express it)

Captions are ALWAYS a named `compose_render` preset first (`retrofit-captions`
molecule). Reach below ONLY to pixel-match a reference or render text the presets can't
— you are forking the caption stack deliberately. And **hide/reposition the caption
layer during full-screen graphic cards** — persistent word-by-word captions over a
card's own typography is a documented clash defect (`--hide_ranges` exists for this)
*(reel_13_his style pass)*.

**Legacy drawtext maintenance only** *(videoclaw-hype build.sh/build2.sh,
wolfram)*: these notes explain existing builds; do not start a new typography
system here. Translate the same timing and visual rules into Remotion, SVG, or
ASS for new production.
- staggered line reveals: per-line `alpha='if(lt(t,0.8),max(0,(t-0.3)/0.5),1)'` with
  offset starts — lines cascade in; windowed text via `enable='between(t,a,b)'`;
- the house shadow: `shadowcolor=black@0.95:shadowx=5:shadowy=5`;
- dim-then-reveal: `drawbox=color=black@0.55:t=fill:enable='gte(t,2.7)'` under the
  payoff word;
- lavfi endcard: `-f lavfi -i "color=c=0x150D06:s=1080x1920:r=30"` + wordmark + an
  accent `drawbox` rule — a designed endcard with zero assets;
- simple persistent labels: drawtext's own `box=1:boxcolor=black@0.45:boxborderw=10`
  beats a separate drawbox+drawtext pair;
- escape literal colons in text (`SOURCE\\:`) or the filtergraph parser eats them;
- define `$COV`/`$WARM`/`$ENC`/`$SH` once as shell vars — every segment splices them;
- iterate via a duplicated "rework" script re-rendering only the changed segments, then
  re-concat *(build2.sh pattern)*.

**Text from sidecar files, not inline** *(taptowand)*: keep caption strings in
ASS/JSON/text sidecars that Remotion/SVG/ASS reads. Apostrophes and asterisks
inside shell filter strings are quoting hazards, and sidecars stage A/B copy
variants as siblings.

**Kinetic-caption chunking (the linguistic layer)** *(jcb-trenddup assemble.py)*:
never flash a lone article or stray "5" — buffer FUNCTION words onto the next content
word, glue numbers/short tokens to the previous chunk, and route chunks between two
fonts by content (serif italic = soft/connective, heavy sans = keywords/numbers). Reveal
window = chunk start → next chunk's start. Swap apostrophes to Unicode ’ instead of
escaping. **Caption sparsity is also a design tool**: rain-city authored 5 caption lines
across 75s with genuinely empty gaps (discontinuous `enable` windows) — omission, not
fade *(rain-city PLAN.md)*.

**Authoritative code-native typography rail — Remotion/SVG/ASS, never word
PNGs.** Build words and cumulative caption states as live Remotion text/SVG
layers or ASS events. Load the exact font before measurement, measure/fill width
in code, keep letter tracking and wrapping as data, and animate
opacity/position from word timestamps. For behind-head words, place the
typography layer under the SAM3 subject matte in the compositor. Reveal window
= this word's start → NEXT word's start (never word-end — no flicker gaps).
Do not rasterize plain typography into standalone `.png` assets and do not call an
image generator for text. These are deterministic layout elements; keep any masks,
SVGs, or timing sidecars in a working directory rather than the user-facing stills
collection.

**PIL receipts & real charts — narrow exception, never typography-only cards** *(humeo
make_receipts.py; reel_13_his render_his_cards.py)*: UI panels (window chrome, traffic
lights, strikethrough rich text) and REAL charts (gaussian sampled every 3px →
`d.polygon` — "a real chart, not a hand-drawn AI illustration") drawn in PIL, because
generated charts are untrustworthy. Prefer HTML/SVG/Remotion for new panel work; use
PIL only when a raster chart or pixel operation is genuinely required. A word on a
flat background is not a designed still and never qualifies for this exception. Pair
true stills with Ken Burns.

**ASS subtitle burn** *(wolfram)*: `subtitles=captions.ass:fontsdir=…` for a full styled
subtitle file rather than drawtext chains.

## Audio architecture

**The three-layer bed: ambient / impacts / drop** *(jc_kumar build_bed_synced.py; the
`beat-synced-impact-bed` molecule)*: from ONE clean instrumental stretch —
- ambient: `highpass=f=220,lowpass=f=9000,loudnorm=I=-26` (kills boomy mud under
  speech), self-extended with `acrossfade=d=0.6`, faded in/out;
- impact one-shot: a 0.9s downbeat slice, `loudnorm=I=-11` + tight fade envelope,
  `adelay=<cut_ms>` onto each cutaway at ESCALATING volumes (0.75 → 0.9 → 1.05);
- drop: full-level loop pinned to the payoff timestamp;
- assemble: `amix=inputs=N:duration=longest:normalize=0` — **normalize=0 always**
  (amix's default rescaling wrecks your leveling); `dropout_transition=0` when inputs
  end at different times *(reel_12)*.

**Bed + master chain.** The bed is FLAT: one constant gain under the VO, never ducked
or sidechained (JC, #321: music one steady level ~12 dB under the voice, live speech
included). The flat mix: `volume=1.0` VO + a constant `volume=` bed +
`amix=duration=first:normalize=0` *(reel_12)*; an `assemble` EDL bed with no `gain` is
matched 12 dB under the VO for you (`"under_voice_db": 15` for skits and recreations). Never
cut or mute the music under the spoken lines, and never swell it between them. Master the finished mix with a measured, linear
gain and a true-peak limiter, never a single-pass dynamic `loudnorm` on voice + music: it
lifts the bed in every pause, the pumping the flat bed exists to remove (#321).

**Audio never clips the timeline.** `-shortest` on the final mux cuts the poster-tail
beat when the VO ends early — `apad` the mix + `-t <video duration>` instead
*(jc_kumar build_final.py; now assemble.py default)*.

**adeclick the VO at mux** when the recording carries mouth clicks *(wolfram)*.

**Muting an ambience bed under a cutaway's own sound**: when the cutaway windows are
KNOWN from the EDL, a per-frame conditional drops the room tone for their SFX —
`volume='if(between(t,a,b)+between(t,c,d),0,BED_VOL)':eval=frame` *(compose_render
episode path)*. It follows the cutaways, never the voice; music is never dipped under
speech.

**`adelay=ms|ms` — both channels, always**: a single scalar delays only channel 0 and
smears the stereo image *(jc_kumar)*. **`aloop=loop=-1:size=2e9` + `atrim`** = "loop
forever, let the trim decide" — no loop-count math for a bed of unknown length
*(compose_render)*. **`duration=first` vs `duration=longest` on amix is a runtime-
ownership CHOICE** (spine owns the runtime vs longest layer does) — and `normalize=0`
on every amix, always (the default auto-gain silently undoes your leveling).

**Trailing-silence-only trim**: `areverse,silenceremove=start_periods=1:…,areverse` —
removes ONLY what was originally the END; internal intentional pauses survive (a global
silenceremove eats them) *(clean_audio)*.

**Pull the VO back OUT of the picture-locked master** (`-vn` extract from
`final_visual.mp4`) when you need it for a mix — it's guaranteed self-aligned with the
concat, unlike re-assembling VO stems per shot *(jc_kumar build_final.py)*.

**When the speech-span detector wobbles, hand-pin the window.** scrub_reference_vo's
auto-detection returned 2 spans then 3 across identical runs — the shipped bed hardcoded
the ONE verified-clean stretch (`-ss 11.87 -t 7.2`) and acrossfade-looped it, explicitly
chosen OVER full stem-split to avoid center-cancel artifacts and bleed *(jc_kumar)*.

**Constant-offset transcript shift**: if captions feel uniformly late after a
listen-through, shift EVERY word timestamp by one flat offset (jc_waves: −0.30s across
~130 words) and record it in a sidecar (`{"shift_applied_s": -0.3, "note": …}`) — don't
re-run ASR for a constant latency bias.

**Texture bed under a score**: an ambience bed under a SCORE (rain under piano) is
lowpassed + set at a fixed offset (~−15 dB under the music) *(rain-city CREDITS.txt)*.

## Pre-flight gates & diagnostics (assembly-adjacent)

- **Eye-open check on a reenact driver's FIRST frame** *(taptowand)*: reenactment
  preserves the driver's opening pose — a closed-eye first frame can reproduce
  through the result. Trim
  the driver (`-ss`) to an open-eye frame; the opencv/`--eye-check-method gemini` guard
  exists.
- **Driver downconform** *(taptowand: 1060×1896@120fps → 1080×1920@30fps)*: conform any
  reenact driver to target fps + EVEN dimensions before spend.
- **Caption-band luminance sample** *(preflight.py, reel_12/promise-demo/quitting)*: 6
  timeline points sampled inside the caption rect → drives the outline/contrast decision
  mechanically, before render. **Known failure mode**: sparse FIXED timestamps miss
  short localized bright beats between samples (jcb_lovable shipped unreadable captions
  on two bright card beats the sampler skipped) — sample ON the beat boundaries too.
  And outline WEIGHT doesn't save a color COLLISION: Outline=8 white captions still
  vanished on a white shirt *(berggruen ASS bug)* — flip the color, don't just thicken.
- **Stillness/motion fingerprint**: `ffprobe -f lavfi … signalstats` → per-frame `YAVG`
  at ~8fps sampling — quantifies whether a span is frozen/still vs moving; used to
  validate pause-handling treatments *(quitting pause_test)*.
- **Variant matrix + blind review**: when an assembly choice is ambiguous (freeze vs
  clip vs as-is on a pause), render ALL candidates and blind-test each with the same
  mechanical-observation Gemini prompt — pick empirically *(quitting pause_test A/B/C/D)*.
- **Reviewer transport (reference)**: the finished-render review makes its own bounded,
  content-addressed same-framing/same-duration copy for the model and binds its recipe and
  hash to the exact final; its face/caption/edge/red-zone checks read the exact final. Do
  not hand-build proxies for it.
- **Retrofit re-encode side effects**: compose_render retrofit shifted 24→30fps and
  `yuv420p`→`yuvj420p` (tv→full range) — invisible in logs, recoverable only by
  ffprobe-diffing. Know it when chasing contrast/black-level shifts *(quitting)*.
- **Timestamp-burned dashboard grids** *(rain-city frames/)*: `beat_grid.jpg` (one
  mid-frame per SOURCE clip, tiled — catches footage REUSE at a glance),
  `timeline_grid.jpg` (20 even-interval frames — pacing/continuity dashboard, day/night
  whiplash shows instantly), versioned re-runs after each fix (`gh2_*`, `_v2`). Burn the
  timestamp INTO each tile (drawtext) so a finding is instantly addressable.
- **Test the WORST-CASE axis**: rain-city's caption A/B swept font/position over the
  hardest background but never tested a contrast TREATMENT (scrim/outline/dim) — and
  shipped exactly that failure. A legibility sweep must include the treatment axis.
- **Render crop candidates as MOTION, not stills** *(rain-city crop_test_*.mp4)*: a
  reframe that looks right on a frame can clip the subject once it moves.

## Liftable idioms from INSIDE the canonical tools

The Remotion/compose_render era hides its ffmpeg, but the filter graphs inside the tools
are quotable for hand builds:

- **Pre-roll slate**: `color=c=black:s=WxH:r=30:d=N[pv]` + `anullsrc…,atrim=0:N[pa]`
  concat'd ahead of the body on PARALLEL v/a chains (timing stays independently exact).
- **Cover-card bake**: still-hold trimmed to `cover_sec` + `anullsrc` silence for the
  card, concat with the body — body audio starts exactly at the cut.
- **Seam-insert overlay**: scale/crop/`tpad=stop_mode=clone` (fill the window even if
  the insert runs short) + `setpts=PTS-STARTPTS+start/TB` +
  `overlay=enable='between(t,start,end)'`, chained across all inserts.
- **`format=rgba` BEFORE `fade=…:alpha=1`** — or the alpha fade is a silent no-op (it
  fades RGB instead) for translucent card fade-ins.
- **Non-linear cut in ONE pass**: `select='between(t,s1,e1)+between(t,s2,e2)+…'` +
  `setpts=N/FRAME_RATE/TB` (and `aselect`/`asetpts=N/SR/TB`) — frame-perfect A/V sync
  on arbitrary disjoint windows without multi-input concat; 30ms `afade` per splice
  kills the pops *(densify's core)*.
- **Silence-snap splitting**: `silencedetect=noise=-30dB:d=0.18`, then snap each target
  split point to the nearest silence-center (±8s window) so long-form seams land in
  silence, never mid-word *(lipsync_footage long)*.

## Process habits that made these builds work

- **Beat plan as JSON first** (`beat_plan.json`, `timeline.json`, `edl.json`, or an
  inline `SEG=[…]` table) — every good script dumped its plan before rendering. Best
  version: ONE manifest feeding ALL downstream scripts (jc_kumar's edl.json drove the
  picture cut AND the bed's adelay offsets — no duplicated timing). That artifact is now
  the `--declare` contract input; the habit predates the tool.
- **Lock picture before sound.** Render a silent animatic/proof cut and check the
  picture before any audio-mix spend; then `final_visual.mp4` (captions burned, pre-mux) and
  `final.mp4` (muxed) stay separate inspectable artifacts *(headphones-ad
  `final_silent.mp4`; jc_kumar `animatic_silent` → `final_visual` → `final`)*.
- **Pixel-diff font selection**: 3 rounds of side-by-side stills against a frame from
  the actual reference before committing to a display face *(jc_kumar fonttest/)* —
  visual diffing beats picking a serif from memory.
- **Cache expensive intermediates** (the baked alpha `.mov`, normalized segments) and
  key rebuilds on existence — caption iteration shouldn't re-render the spine.
- **A/B alternates as sibling files, never overwrites** *(taptowand `m0`/`m0b` +
  duplicated concat lists; `hook.txt`/`hook2.txt`)*: two versions = two files + two
  lists, renderable side-by-side; no regen to compare.
- **Print per-beat progress + ffprobe the output** — silent scripts hide 0-byte
  disasters. Better: route through `_ffmpeg.run_ffmpeg_atomic` (tmp + atomic rename).
- **xstack contact sheet** for reviewing a set of stills at a glance: N inputs each
  scaled, then `xstack=inputs=N:layout=0_0|432_0|…` with computed offsets
  *(carousel rebuild make_contact_sheet.sh)*.
- **Three-stage pipeline: silent picture-lock → skin/grade pass → captions+audio**
  *(nn-learn `silent.mp4` → `silent2_skin.mp4` → compose_render)*: lock the cut silent,
  grade it as its own pass, burn captions/audio last — each layer iterates without
  re-rendering the ones below.
- **Ship what you spec'd — or say you didn't.** nn-learn/trend-dup both show
  planned-vs-shipped gaps (a spec'd SAM3 text-behind beat that shipped as flat
  drawtext; a "captions only over face beats" comment above full-coverage code). When
  you drop a spec'd move, note it in the job (adaptation_notes.md) so the record
  shows the real intent.
- **Why --declare exists**: across the mined jobs, hand assembly was systematically
  INVISIBLE to run.log.jsonl — the craft survived only as artifact forensics, and some
  is simply GONE (ember/fx-*/gwtest left `_matte`, `luma_reveal`, `focus_hunt` artifacts
  whose ffmpeg was never captured anywhere). Declare the timeline; and when a bespoke
  script earns its keep, save it in the job dir — a lost experiment is a re-derived
  experiment.
