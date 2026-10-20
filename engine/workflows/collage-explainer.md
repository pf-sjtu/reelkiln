# collage-explainer — halftone paper-collage metaphors that assemble from empty

A whole-video FACELESS register for explainer / opinion / essay content: every spoken
line becomes ONE paper-collage visual metaphor — black-and-white halftone photographic
cut-outs and colored-cardstock accents on a flat bold color field — that **assembles
itself from an empty field** in crisp stop-motion timing while the narrator speaks.
The look is premium editorial (think a magazine cover that builds itself); the
assemble-from-empty motion is the signature. Impressive on sight, and unusually well
suited to abstract ideas: when the line is "experience gets consumed every time",
there is no real footage to pull — a paper machine eating film strips IS the shot.

> **Status: IMPORTED register — unproven in-repo.** The look and the prompt grammar
> come from [pyang5166/gbro-collage-broll](https://github.com/pyang5166/gbro-collage-broll)
> (MIT; `_ref/` exemplars are frames from its public demos). The engine half is our
> locked Seedance keyframe mode (`skills/broll_styles.md` Method 3, 21 runs); the
> assemble-from-empty chain (Method 20) has not shipped here yet. The first reel
> through this file earns the verdict; replace the vendored exemplars with our own
> minted ones after the first mechanically clean variant.

**The spine is [`broll-voiceover`](broll-voiceover.md)** — VO leads → stills →
animate → bed → compose → captions, every step with its eval. Read that file for the
step mechanics; this file owns what's DIFFERENT: the register spec, the metaphor
discipline, and the assemble-from-empty animation. Molecule:
`collage-assemble-from-empty` (`skills/molecules.md`).

**When to route here:** abstract opinion/concept lines with nothing real to show —
faceless explainers, POV/essay channels, "how to think about X" content.
**Anti-triggers:** product ads (a real product beats paper), real-person content,
anything needing editable layers mid-clip, fast-skim listicles (a metaphor per line
needs lines worth a metaphor).

---

## Input

| Input | Where it comes from |
|---|---|
| **Script lines** | The passage/opinion, chunked so each line carries ONE idea (~5s each, ≈45–60s total). PER-REEL. |
| **Narrator voice** | The tenant's locked `voice_id`, per `skills/voice.md`. Channel asset — reuse. |
| **The register** | FIXED — this file. The per-shot variation is the background FIELD (color semantics below), never the materiality. |
| **Audio bed** | Optional: paper-craft foley / room tone via `bed-find-and-screen`; the register also reads clean bone-dry under VO. |
| **Captions** | Burn last in Remotion; cream or the shot's accent color, never a new hue. Palette **H. Clean Brutalist** or **A. Editorial Italic**. |

---

## The register

### CORE_STYLE_BLOCK

> A premium editorial paper-collage image in a stop-motion paper-craft register: a
> perfectly flat, bold, uniform single-color paper field with subtle uncoated-paper
> fiber, carrying black-and-white halftone photographic cut-outs mixed with selective
> colored-cardstock accent pieces. Visible printed halftone dots on every photographic
> element, crisp machine-cut edges, thin warm-cream paper keylines around every
> cut-out, soft low-opacity physical drop shadows. The composition is 3–6 large
> separable paper groups with generous clean color-field negative space, central
> subject within the middle 70 percent of a locked vertical poster frame.
>
> Avoid: typography, readable letters, numerals, logos, watermark, UI, subtitles,
> glossy 3D, photoreal environment, gradients, full-bleed photography, clutter,
> more than six paper groups.

The materiality lines are verbatim on every mint; only SCENE, the field hex, and the
accents change per shot.

### Color semantics — one design language, varied fields

The batch holds together through the paper materiality; the background FIELD varies
per shot by what the line MEANS. Pick from meaning, never all-one-color, never color
for its own sake:

| Field | Means |
|---|---|
| burnt orange / red | time being consumed, labor, urgency |
| mustard yellow | tools, warning, experience leaking away |
| ink green | cognition, aesthetics, a system reset |
| deep purple | norms, consolidation, long-term memory |
| teal | judgment, collaboration, automated execution |
| cream / off-white | neutral exposition, a blank-slate beat |

Accent cardstock (red/yellow/cyan/orange/purple/cream) serves information hierarchy —
the ONE object the line is about gets the color; everything else stays halftone B&W.

### Drift checks (every mint, before selecting or surfacing variants)

Field truly flat and uniform · halftone dots visible · cream keylines present ·
≤6 separable paper groups · zero legible text (structural here — the register's own
Avoid block bans text props, so the no-legible-text law isn't fighting the style).

---

## The metaphor spec — design the motion before any generation

One line = ONE metaphor. Before anything renders, each `script.json:broll` entry
carries:

- `meaning` — what the viewer must understand
- `metaphor` — one-line visual proposition (a mechanism — machine, clock, film strip,
  funnel, rulebook, chessboard — not an illustration of the words)
- `objects` — the 3–6 paper groups, MAX six (more = weak read + unstable interpolation)
- `field` / `accents` — from the semantics table, with hex
- `assembly_order` — the order pieces enter: structure → subject → connector →
  action → result. **This field becomes the Step-4 animation prompt verbatim** — the
  motion is authored here, at concept time.

Surface the metaphor table with the script when useful for optional feedback (Step 1
of the spine), then continue unless the user explicitly requested review. A wrong
metaphor costs nothing to fix here and a re-mint after Step 3.

---

## Steps — deltas over the broll-voiceover spine

**Steps 0–2 unchanged** (environment · script + `check_script --method voiceover` ·
`synth_voice` — VO sets the reel length). The metaphor spec above rides along with
Step 1's script gate.

### Step 3 — mint the collage stills (the swap point, pinned to this register)
```bash
uv run python tools/mint_image.py --job $JOB --role artistic_still \
  --name <shot> --aspect 2:3 --quality high --variants 2 \
  --reference workflows/collage-explainer/_ref/exemplar.png \
  --prompt "<CORE_STYLE_BLOCK from this file>

  Match the paper materiality, halftone dot screens, cut edges, cream keylines and
  soft shadows of the reference exactly; do not copy its subject or its background
  color — draw the SCENE below on a flat <color> #<hex> paper field.

  SCENE: <subjects, composition, action from the metaphor spec — no style adjectives>"
```
**Reference idiom essential** — flat fields and halftone dots drift on prose alone
(fields grow gradients, cut-outs go full-color photo). Run the drift checks, then the
spine's Step-3 eval (`Read` every PNG inline). Select the mechanically strongest
passing variant by default and surface options when useful for optional feedback.
Pause for a user selection only when they explicitly requested it, or when every
variant materially misses and no acceptable default exists.

### Step 4 — animate assemble-from-empty (`skills/broll_styles.md` Method 20)
```bash
# FIRST frame: an empty flat field at the selected still's exact background hex
ffmpeg -y -f lavfi -i color=c=0x<HEX>:s=720x1280 -frames:v 1 <job>/frames/<shot>_first.png

# interpolate the assembly (Seedance keyframe — Method 3's locked engine)
uv run python tools/mint_video.py --job $JOB --mode keyframe \
  --first-frame <job>/frames/<shot>_first.png \
  --last-frame  <job>/images/<shot>.png \
  --output <job>/footage/<shot>.mp4 --duration 5 --resolution 720p --aspect 9:16 \
  --prompt "Paper-collage stop-motion assembly, using Image 1 as the exact empty first frame and Image 2 as the exact completed last frame. One continuous locked-off vertical shot: open on the empty flat <color> paper field, then assemble the scene piece by piece with crisp physical stop-motion timing — <assembly_order, per piece: how it slides in, snaps into place, connects, completes>. End by holding the supplied completed composition. Preserve the exact framing, <hex> color field, cardstock accents, paper grain, halftone dots, cream keylines, cut edges and soft shadows. Restrained tactile 2D paper craft only. No scene cuts, no camera movement, no zoom, no morphing, no new objects, no text, no letters, no numbers, no logos."
```
The plate hex must match the still's field EXACTLY or the clip fades in instead of
assembling. *"End by holding the supplied completed composition"* is what stops the
model freelancing the final frame.

**Per-clip EVAL — Method 20's mechanical checks, on top of the spine's Step-4 eval:**
1. **Frame-0 emptiness** — extract frame 0; assert near-solid at the expected hex
   (deterministic, ffmpeg/PIL). A paper edge peeking at a border is acceptable; a
   half-assembled first frame means the plate hex didn't match.
2. **End-frame vs selected still** — side-by-side; minor pose/detail drift passes if
   the metaphor reads, composition drift fails.
3. **Contact sheet** (`fps=1`) — the middle must show pieces ENTERING, not a
   crossfade.

**Failure routing:** weak assembly feel → fewer objects + explicit per-piece
slide-in/snap order · end-frame drift → strengthen both "exact … frame" anchors ·
fake text appears → fix the STILL and re-roll, never patch via the video prompt.

**Steps 5–8 unchanged** (bed optional + screened · compose, VO lead, bed steady under it ·
transcribe · burn captions). The rendered video is a complete draft; show it
([Finishing a render](README.md#finishing-a-render)).

---

## Cross-cutting rules

- **One line, one metaphor, ≤6 paper groups** — density kills both the read and the
  interpolation.
- **The field varies semantically; the materiality never varies** — that's what makes
  it one video and not six posters.
- **assembly_order is authored at script time** — Step 4's prompt is a fill-in, not
  an improvisation.
- **Zero text in stills or motion** — captions burn last in Remotion (spine law; here
  it's also the register's own Avoid block).
- All broll-voiceover cross-cutting rules apply (VO sets length, no dead stills, bed
  carries no words, 720p default, eval every step, Gemini is eyes not taste).
