# Video review — the generate → verify method (reference)

How the review of a **rendered video** works in this repo. Validated on two held-out
blind tests (reel_12, reel_13) against human ground-truth: it catches mechanical,
structural, brand, and timing defects at **~90% precision / ~70% recall**, and — by
design — does NOT cry wolf (it quarantines what it can't verify instead of asserting it).

**This is reference material, not an agent step.** A finished render is a complete
draft without it. Agents are never asked to run, wait for, or report this review, and
nothing holds a turn open for it. This file documents how the review works, for
engineers and for standalone methodology work.

Read this with [`skills/evaluation.md`](evaluation.md) (the "Gemini is EYES, not TASTE"
governing law + per-asset-type eval).

## The full review (standalone CLI)

The underlying full-review command is:

```bash
uv run python tools/review_output.py --job <id> --mode full --video final.mp4
```

The full mode integrates the whole-video mechanical review (captions, overlays,
visual artifacts, cut transitions, internal style consistency, and intended
script/beat coherence) and technical audio evidence in one paid full-video pass,
plus deterministic caption/script fidelity and exact locally hashed frame evidence
for timestamped text candidates. It writes
`review_output.json.qa_evidence`, bound to the current render hash. A parse,
audio, or local evidence failure leaves `qa_complete: false`; `qa_gate --mark`
fails closed. At start it copies `final.mp4` to a content-addressed, read-only
job snapshot. Gemini's whole-video pass receives a deterministic bounded copy with
the same aspect ratio, framing, duration, and audio-track presence; the receipt binds
its bytes, conversion recipe, and ffmpeg identity to the exact snapshot.
The bounded copy supports roughly 13.2 minutes with one audio stream (less with
additional tracks), or 30 minutes without audio. Longer inputs are not reviewed;
they are never truncated and their audio is never discarded to fit.
The cadence may drop to 6 fps, so brief motion glitches cannot be certified from
this copy. Local audio
grounding, frame extraction, face, caption, edge, centring, and platform red-zone
checks still read the exact
full-resolution snapshot, while before/after hashes ensure neither input changed. The
report's `qa_evidence.delivery_policy = draft-first/v1` separates `blocking_issues`
from `warning_issues`. Sustained unintended black/frozen picture needs exact-source
confirmation across a declared change between footage sources before it blocks.
That intent comes from the latest completed assembly's durable events, bound to
the current raw output and finished render; transcript boundary rewrites cannot erase it.
Unknown intent, single-shot holds, stills and title cards stay advisory rather
than risking a false severe verdict. Missing/unintelligible narration needs declared
speech intent. Framing, captions, music, pacing, style and continuity findings
remain warnings. `qa_outcome` preserves the existing classification
for older apps and standalone receipts, with confirmed severe findings also producing
`CONTENT_FAIL`. A policy-aware consumer reads both finding lists even when the legacy
outcome is `PASS`; warnings do not receive a clean receipt. This is
workspace-writable execution evidence at an honor boundary: it catches normal
missing/stale/incomplete runs, but it is not a cryptographic attestation and a
workspace-writing agent could fabricate it. A non-forgeable approval must be an
app/gateway-owned receipt outside the repository.

An unavailable or refused review cannot certify a clean pass, and it never withholds
the draft. Manual/contact-sheet inspection is diagnostic only and never becomes a
receipt. On the exact final, the review scans the full timeline and all four frame
edges: text, characters, faces, and the primary subject fully inside frame; the
primary subject centred in the mobile-safe area; captions/overlays covering faces;
obscured faces; and every platform red zone.

Standalone runs work on the exact deliverable bytes in the foreground. The bounded
perceptual copy is only transport for the whole-timeline eyes pass; it receives no
independent ship receipt and cannot replace or weaken exact-final safety. An unbound
hand-made proxy remains diagnostic only. The tool owns its bounded runtime, so no
OS-specific timeout wrapper is needed.

`promise.json` may name `delivery.face_source`: a caption-free copy with exactly the
same dimensions and duration for the local face detector, used when captions could
confuse it. The receipt hashes both that detection source and the exact delivered
video; the semantic full-video review still inspects the final captioned pixels.
Deliberate off-centre or multi-panel composition may be declared with a reason and
exact `start_sec` / `end_sec` under `delivery.composition_exceptions`. Exceptions waive
only the centring heuristic inside that interval. Clipping, hidden faces, caption
collisions, and platform red-zone collisions are warnings for a draft; the standalone
clean-receipt rules remain stricter.

The full review makes one paid full-video request and returns one terminal state:
`PASS`, `CONTENT_FAIL`, or `QA_UNAVAILABLE`. `CONTENT_FAIL` means findings exist;
the draft policy's warning/blocking lists interpret them. `QA_UNAVAILABLE` means a
review service or local check could not finish.

The standalone A–D prompts below are advanced diagnostics for investigating a
specific ambiguous result or doing methodology work. They are not additional
commands and are not substitutes for the integrated full-mode evidence.

> **Why two stages.** A single "find every flaw" prompt has high recall but ~40-50%
> precision — it confabulates generic "amateur-reel" tropes (lip-smacks, dead air,
> phantom jump-cuts, bad lighting) that aren't actually in *this* video. A single
> rigid schema prompt has high precision but misses everything outside its categories.
> **Generate wide, then verify each finding against the evidence.** That's the whole trick.

---

## Advanced diagnostics — standalone generate/verify passes

These are optional methodology diagnostics, not an additional production checklist.
Use **D (story-coherence)** when investigating a message-bearing video; it has no
purpose for a pure montage/loop without an intended story.
**Agnostic = never name the defect you expect** (D is the exception: it is GIVEN the intended
story, because you can only judge coherence against intent). Send the video/frames
+ the prompt to the Gemini transport (reuse `tools/review_output.py`'s `analyse_video()`
for video, or an `image_url` message for frames; model = `GEMINI_VIDEO_MODEL`).
**Always pass `max_output_tokens ≥ 8000`** (reasoning model — see Gotcha below).

**A · Open-critic (full video + audio)** — the recall net.
```
You are the most exacting short-form video editor in the industry, doing the FINAL QC
before this vertical reel ships to a high-paying client who will reject it for any flaw.
Watch the ENTIRE video closely — picture and sound together. Find everything wrong: every
defect, glitch, inconsistency, cheap/amateur moment, mistimed/misplaced element, and
anything a sharp viewer would judge as unprofessional — footage, the person, on-screen
text/captions, graphics/overlays, timing/transitions, and audio. For EACH: [timestamp] —
what you observe — why it's a problem. Be exhaustive and harsh. No praise. Only flaws.
```

**B · Transition-frames** — catches structural glitches uniform sampling averages away
(leftover/duplicate overlays, an element cropping the person's face/body). Extract
full-res frames at **±0.15s around every beat-cut** (from `beats.json`), send as an
ordered labelled image sequence.
```
These are still frames around the moments this vertical video changes, in order, each
labelled with its timestamp. Act as a continuity checker. At each change, describe what
changes, then flag any mistake: a graphic/text element half-gone, left over, or
flickering; an element covering or cropping the person; the body/face cut off or
obscured; mismatched styling between adjacent elements; misalignment; anything that
breaks continuity. For each: [timestamp] — exactly what is wrong.
```

**C · Style-consistency** — catches off-brand/clashing text. Provide the tenant's brand
spec (`taste/packs/<tenant>/README.md`) so it states the VIOLATION, not just internal clash.
```
This vertical video has several kinds of on-screen text: a persistent handle, word-by-word
captions, and large text on graphic cards. For each, state its font character (serif/sans,
weight), color, and screen position. Then report every place these elements are INCONSISTENT
with one another — or with this brand spec: <PASTE taste/packs/<tenant>/README.md text spec> —
in font, weight, color, or placement. Timestamps. Be specific about fonts and colors.
```

**D · Story-coherence ("does it make sense / does it land?")** — the narrative pass. A/B/C
catch *defects*; this catches a video that is mechanically clean but **doesn't tell a
coherent story**. Most useful for any video meant to land a message (ads, narrative spots) —
this is the layer a clean-but-confusing ad fails. Give it the INTENDED story (the script /
the beat-by-beat arc) so it checks the cut against intent, not against its own guess.
```
You are a sharp ad director reviewing a cut for STORY, not for glitches. The intended story
is: <PASTE the beat-by-beat arc / script>. Watch the whole video and answer concretely, with
timestamps: (1) Does the cut actually tell that story in an order a first-time viewer would
follow? (2) What causal links are MISSING or unmotivated — a result shown with no setup, a
character doing something with no on-screen reason ("why is X suddenly doing Y?")? (3) Which
intended beats are absent or too weak to read? (4) TENSION: does the cut keep RAISING the
stakes and HOLD the payoff until late, or is tension released too early (a smile / relief /
resolution before the climax)? Where does tension peak, and is the release held to the end?
(5) Is the emotional turn / payoff present and does it land? (6) What single change would most
improve it? Be specific. Do not comment on render quality, lighting, or AI artifacts — only story.
```
> **Gate on tension, not just coherence.** Early release of tension is the most common,
> most-missed flaw (it bled the payoff out of both validated spots). A coherent cut that
> resolves too soon still under-performs — treat "released too early" as an actionable note.
> Route in VERIFY as a **semantic claim**: a missing/unmotivated beat is checked against the
> script + the actual shot sequence, not against a single frame. Treat its output as
> **advisory editorial** (the human's call on story), but a missing causal link it flags
> with a timestamp is a real, actionable gap — not taste. On the worked example it would
> have caught the "boss dances with no setup" black hole (the headphones-handoff beat was
> never generated).

---

## Stage 2 — VERIFY (precision): blind, class-routed re-check

The open-critic's list is **candidates, not findings.** Verify each before it counts.
The rule the human gave: **do not lead the tool.** Don't ask "is his face covered?" (it
will say yes). Re-examine the *evidence* neutrally and keep only what independently
reproduces.

- **Visual claim** → extract the exact frame(s); send with this blind, taste-banned prompt;
  drop anything that comes back CLEAN:
  ```
  Separate still frames, each labelled with its timestamp; unrelated. For EACH, looking
  ONLY at that frame, report any clear, OBJECTIVE, verifiable visual defect — garbled/
  misspelled text, an element covering/cropping the person's face or body, text colliding
  with another element, a graphic chopped by the frame edge, duplicated/leftover graphics,
  broken/black/corrupted rendering. Do NOT comment on lighting, color, attractiveness,
  composition, focus, framing, or background. If no clear objective defect: respond CLEAN.
  One line per frame: [timestamp] — defect or CLEAN.
  ```
- **Semantic claim** (redundant line, off-message, wrong content format) → a content check
  (compare against script/transcript). The frame-verifier is BLIND to these — route them here.
- **Audio claim** (hum, dropout, music-too-loud, abrupt end) → use the integrated
  full-video audio evidence (`review_output --mode full` captures it), objective-only.
- **Temporal claim** (a "jump-cut") → a single frame can't confirm it; use Pass B's
  transition frames, not a still.

What survives verification = your reported defect list. What doesn't = dropped (likely a
hallucinated trope or taste). **Flag — don't assert — anything you cannot verify** (e.g.
sub-frame lip-sync drift, which the model cannot perceive at 720p; see Limits).

**What the two outcomes look like** (illustrative — worked examples live in
`jobs/reel_12/qa_blindtest/`):
- ❌ raw open-critic: "[0:12] lip-smack / dead air — reads amateur" → blind frame + audio
  re-check at 0:12: CLEAN → **dropped** (a confabulated amateur-reel trope).
- ✅ raw open-critic: "[0:23] URL pill covers the speaker's chin" → blind frame re-look at
  0:23: "element covering the person's lower face" → **reported**, with the frame attached.

---

## Stage 2.5 — REFERENCE FIDELITY (duplication & remix jobs)

A reference-grounded render has a second question the passes above never ask: **is it
faithful to the reference?** Same script and vibe is NOT faithful — it matches beat-for-beat,
element-for-element, or the disparity is tabulated for the user. Method (the comprehension
strip, `render_timeline_strip` — one image per ~2s, everything on one time axis):

1. Get beat boundaries for BOTH sides — choose the detector that fits the reference's structure:
   - **cut-based reference** (shots change): detect shots/cuts on the ref and on `final.mp4`;
     REF beats = the ref's shots, OURS beats = your declared timeline / EDL.
   - **cut-less reference** (one continuous subject + a motion-graphics layer — a shot detector
     just returns "1 shot"): use a motion / animation-window detector for the boundaries instead.
   A beat file is only `[{"id","start","end"}]` (or bare edges) — from whichever detector fits.
   Cut markers are optional (a cut-less reference has none).
2. Render the **beat-aligned stacked cards** — REF over OURS, columns paired
   beat-relative (our beats legitimately run longer; wall-clock comparison is invalid).
   The one-call way is `look_at_video --job <id> reference/ref.mp4 final.mp4`: it
   detects both sides' shots and builds the beats, audio and transcript itself (see
   [`primitives/look_at_video.md`](primitives/look_at_video.md)). It does not write the
   standalone receipt in step 5; for that, or with your own beat files from step 1, use:
   ```
   uv run python tools/render_timeline_strip.py --job <id> --stack \
     --ref reference/ref.mp4 --ours final.mp4 \
     --ref-beats <ref-beats.json> --ours-beats <ours-beats.json> \
     [--ref-cuts <ref-cuts.json> --ours-cuts <final-cuts.json>]   # only if the ref has hard cuts \
     --ref-transcript reference/ref_transcript.json --ours-transcript transcript.json
   ```
3. **Read EVERY card COLUMN BY COLUMN** — each column is a REF frame (top) over its OURS frame
   (bottom) at the same moment; check the pair for equivalence in **layout, animation phase,
   color, opacity, type, and presence** (reading a card holistically misses a graphic that's a
   beat early/late, half-opacity, or on the wrong frame). Tabulate one row per disparity —
   timestamp/beat, class (missing element · overlay/HUD motion timing · size · padding · layout ·
   motion · cut rhythm/pacing · typography system · music placement), REF says, OURS says,
   severity. Every row must cite the frame pair; a claim you can't point at is dropped
   (same law as Stage 2).
4. **Next edit:** present the disparity rows to the user. If they request a revision,
   fix the affected rows and compare the new render. Do not loop autonomously; the
   comparison documents whether the table is empty or
   every remaining row is an ACCEPTED, NAMED deviation (the tenant's personal spin).
   Do not claim a reference match while unexplained differences remain. Creative
   differences go to the user.
5. **Standalone CLI receipt detail (never an agent step):**
   ```
   uv run python tools/qa_gate.py --mark-stack --job <id> --open-rows 0
   #  ...or, for named deliberate deviations:
   #  --open-rows 2 --accepted "tenant's own grade + her sign-off card"
   ```
   `render_timeline_strip --stack` writes the mechanical half to
   `strips/stack_receipt.json` (which cards it wrote, which ref beats they cover, and
   the sha256 of **both** comparison inputs — REF and OURS); `--mark-stack` writes the
   read. `qa_gate --mark` then refuses the receipt unless every reference beat landed on
   a card, every card is still on disk, and a read is recorded — all bound to the CURRENT
   `final.mp4` **and** the current reference. Re-render OR re-cut the reference → hash
   mismatch → the cards go stale → the stage re-arms, exactly like the Stage 1–2 review.
   (Both sides are hashed on purpose: pinning OURS alone would let a re-cut reference
   slip past an old set of cards — the same stale-evidence defect, on the other side of
   the comparison. The reference is matched by CONTENT, so renaming it doesn't false-alarm.)
   What this proves is that the evidence was built from the shipped render and nothing
   went unlooked-at; it cannot prove the read was honest — that stays on you.

   **Applies whenever `jobs/<id>/reference/*.mp4` exists.** That is the trigger, so put
   the reference there (the `--ref` path above already assumes it). A few pre-convention
   jobs keep their ref in `breakdown/` or `compare/` and go ungated — deliberately not
   sniffed, because a trigger loose enough to catch them would fire on non-duplication
   work, and a gate that cries wolf gets waived.

Evidence this catches what Stages 1–2 miss: on the shipped `jcb-trenddup-20260709` job
(which passed the old QA), the stacked cards surfaced a missing signature opening graphic,
static counters where the reference counts up, and 8–10s single-shot stretches against a
~2s reference cut rhythm. This historical evidence explains the value of comparison;
it does not require a repair loop or manual receipt.

---

## Reading the result
- **Read the OBSERVATIONS, never the verdict label.** `slop`/`ai-tell` labels are skewed
  on ffmpeg-assembled timelines (no per-beat role-log → mislabels). Gate ONLY on a
  mechanical observation with a timestamp.
- **Mechanical vs taste vs inherited.** Mechanical (garbled/covered/broken) = actionable.
  Taste (ugly grade, low energy) = advisory, the human's call. Inherited (a flub/pause
  baked into the locked source take) = out of scope — do not regen for it.
- **HUMAN GATE — AI-generated close-up faces (JC law, 2026-07-04).** Every AI-generated
  close-up face shot is routed to the USER for approval before final assembly — face
  realism is hard for model-QA, instant for a human. Route to the user ONLY
  hard-for-AI / easy-for-human judgments; never make them re-review what QA covers.

## Standalone CLI promise and receipt reference

These commands apply only to standalone CLI development and methodology work.
Agents are never asked to run them, and nothing waits on them.

### Stage 3 — PROMISE (the delivery gate) + stamp the receipt
The passes above judge whether the render is *broken* and *good*. The delivery-promise
gate judges whether it delivered **what we committed to at plan time** — catching silent
downgrades (promised real-footage-first but quietly generated; promised motion on every
static but shipped a dead still; promised 45s, rendered 28s; wrong caption preset).

If a job opted into a checkable delivery promise in `jobs/<id>/promise.json`,
that file describes the render's checkable shape and may mirror the tenant's
`## COMMITMENTS`. At QA time:
```
uv run python tools/check_promise.py --job <id>
```
- **HARD breach** (duration outside its window, caption-preset mismatch) → BLOCKS. `qa_gate`
  will refuse the receipt until it's fixed. There is no agent-writable skip marker:
  a file the producer can create cannot prove that the human waived QA.
- **SOFT breach** (footage mix, motion-on-static, music bed, brand strings) → ADVISORY;
  route it into the `review_output` decision like any other observation.
- Editorial promises ("build tension, hold the payoff late") are echoed but never
  mechanically judged — that's Stage 1-D's / the human's call. Gemini is EYES, not TASTE.

Only after integrated `review_output --mode full` → `check_promise` (when a
promise exists) may standalone CLI development stamp its receipt:
```
uv run python tools/qa_gate.py --mark --job <id>
```
The receipt records `promise_kept` and the review hash. It is a local execution
record, not a non-forgeable approval attestation.

`review_output --mode full` records `layers_run`, `final_review`, and
`audio_audit_status` in both its JSON report and its `review_complete` event.
Any `final_review` or `audio_audit_status` other than `ok` blocks the receipt
for new-schema reports, even if per-beat observations exist; skipped or failed
mandatory layers did not complete. A planned music bed is likewise grounded in
the score-bed terminal event, configured/artifact inputs, and a local spectral
energy check. An orphaned `score_bed` start, missing/silent produced mix, or
byte-identical files / identical normalized audio in `final.mp4` and
`final_raw.mp4` after a planned finishing pass blocks the receipt with a named
reason. The local check also requires positive energy in the matching music
source and proves containment by correlating the decoded
`reviewed_final - final_raw` residual with the terminal `output_wav`, with the
terminal `output_video` as a second similarity check. An energetic mix file
beside an unrelated final cannot pass. Gemini's bed-presence boolean is retained as
`music_bed_present_reported`, but cannot override that deterministic evidence.

Intentional silence is a valid modality choice. When `script.json` is explicitly
text-led (`on_screen_text` with no dialogue/narration) and the finished file is
locally proven silent, the integrated run records a completed visual-only audio
audit instead of forcing narration, placeholder music, or fake caption data.
If dialogue or a music bed was promised, missing or silent audio still blocks.

## Gotcha — reasoning-model token budget
The video/audio model is a **reasoning model**: it spends output tokens on reasoning
*before* content. Too small a `max_output_tokens` → it exhausts the budget reasoning and
returns null content / `finish_reason=length` / a JSON parse error. Always budget
generously (≥ 8k; 16k for `final_review`). `review_output.parse_json_lenient` is also
hardened (fence-strip, brace-match, trailing-comma + `strict=False`) — keep that.

## Limits / known gaps (see `workflows/aroll-reel.md` TODOs)
- **Sub-frame lip-sync drift** — not perceivable by the LLM at 720p (4 probes missed it).
  Needs a deterministic AV-offset check (SyncNet/wav2lip-style), NOT an LLM. Flag, don't fake.
- **Semantic-composition judgment** — "this card looks cluttered / is a confusing stack /
  should be a code block" is not yet caught. Closer to taste; the hard frontier.
- **No positive quality judge** — everything here finds ERRORS. "Is this actually *good*?"
  is unbuilt (see aroll-reel TODO 7).
