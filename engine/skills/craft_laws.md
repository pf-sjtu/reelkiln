# Craft laws — how to fill slots and layer footage (extracted from molecules.md, 2026-07-10)

The cross-cutting craft that governs *which source fills a molecule's slot* and *how layers
stack*. Molecules are the moves ([`skills/molecules.md`](molecules.md)); these laws are the
judgment applied inside them. Captured 2026-07-04 from working sessions; provenance noted
per law.

---

## The voice/performer ladder (craft law, 2026-07-04) — how to fill a ⟨VO⟩/performer slot

| Path | Delivery | Visual | Cost | Risk |
|---|---|---|---|---|
| 1. real VO + real footage lipsync | real — **100× better** | real | ~$8/min sync | the gold standard |
| 2. real VO → voice_change → lipsync | real delivery, new identity | real | +pennies over 1 | STS carries source noise |
| 3. TTS (ElevenLabs) → lipsync | synthetic, flattest | real | cheapest | robotic read |
| 4. Seedance native voice | **best synthetic delivery** | generated | most expensive | pronunciation flubs; >15s continuity needs BytePlus refs |

Rules of thumb:
- **Real VO whenever it exists.** A real recording through paths 1–2 beats every synthetic path.
- **Recast beats raw TTS**: if the voice must change, voice_change a real read (delivery
  survives) rather than synthesizing from text.
- **Seedance-native only when the performer is fully synthetic anyway** — it sounds better
  than TTS, but a mispronounced tricky word costs a FULL re-render, or a **flub-splice
  repair** (see molecules §Assembly) that only works in cut-heavy styles. Pre-screen tricky
  words (names, numbers, jargon) via **mispronunciation-diff** / `check_script` BEFORE spend.
- Continuity: Seedance holds one identity past ~15s only via BytePlus signed-URL refs
  (`cast_avatar` output) — plan chunk boundaries accordingly.

## The motion slot (craft law, 2026-07-04)

**If an example of the wanted motion exists in ANY video, motion-transfer beats
generating from scratch** — transfer the example's motion instead of prompting for it:
`mint_video genjutsu` when new people go into that clip (every person swap, any count),
`mint_video reenact` only when a still is the shot and the clip just lends its motion.
Engine split: **Higgsfield genjutsu and Kling reenact transfer motion** (gateway required),
while **Seedance generates de novo**. This is why gen-from-a-real-base usually beats
pure generation when a base take exists.

## Sequencing & realness laws (craft laws, 2026-07-04)

- **Real is first-class.** Some pieces are 10× cooler real and cheap to capture: a quick
  screen recording of an app, a clip from the tenant's index, a phone pan. Exhaust
  these BEFORE generating (extends the retrieval-first priority: mine → shared →
  web-capture → stock → generate).
- **Found beats generated too.** A clip found ONLINE usually outclasses anything
  generated — and it signals EFFORT to the viewer (perceived production value), which
  generated footage never does. Search before you mint.
- **Main-stage pauses expose generic bases.** The base a-roll takes are deliberately
  GENERIC; a colloquial VO (ums, long pauses, heavy emphasis) against them reads wrong —
  hands gesticulate through silence. At pause/emphasis/main-stage moments, either
  (a) cut AWAY to a poignant b-roll beat, or (b) stay on-face but ADJUST the a-roll
  (performance-matched-base, speed-ramp, punch-in). Never leave a generic base
  gesticulating through a pause.
- **Buffer between AI faces and real footage.** Never cut an AI-generated face shot
  back-to-back with real footage — the switch jars. Insert a buffer beat (quick scenic
  pan, b-roll, card) between them.
- **Human gate on AI close-up faces.** Every AI-generated close-up face shot gets USER
  approval before final assembly — face realism is hard for model-QA, instant for a
  human. General principle: route to the user ONLY the judgments that are
  hard-for-AI / easy-for-human. Highest quality, most buy-in, least user work.
- **Emotional beats on face — IF the a-roll is good.** The face is the most personable
  emphasis and beats everything when it lands; when it's weak it's WORSE than neutral.
  High-risk/high-reward: good face > typography hijack > weak face. When the on-face
  moment isn't good, reach for fullscreen-typography-hijack or behind-head typography
  instead (molecules §Extensions / §Trend-duplication).

## Layering algebra (craft laws, 2026-07-04 — being extended by Q&A)

**The north star: it should feel like a HUMAN made it and it took that human a LONG
time.** Beautiful, seamless, not obvious how good it is. Every layering decision is
judged by whether it adds or subtracts from that illusion.

### Ordering laws
- **Time-warps BEFORE lipsync.** Speed-ramps/freezes (e.g. stilling gesticulation
  through a pause) happen on the base before sync — or the identical warp must be
  applied to the audio at the same stamps. Believed mouth-safe; UNTESTED — validate.
- **Corrective layers sit ADJACENT to what they correct.** The warm grade that
  counteracts sync-3's wash goes immediately after the sync, not at the end.
- **Unifying texture/grain goes over EVERYTHING, last — graphics included.** A grain
  pass across the assembled timeline makes disparate layers read as one coherently-shot
  video. Texture/paper grain over typography and cards works (situational); degrading
  graphic edges ("bleed", less-clean edges, Vox-style) is its own texture domain — to
  be spec'd separately.
- **Densify wins 80–90% of the time.** On social, pauses are LOW value — clip silences
  aggressively by default. Protect a pause ONLY when the emphasis is deliberate and
  valuable; when unsure, ask the model's eyes (`gemini_video`): "do the pauses here make sense?"
- **Audio mixing: one law so far.** The music bed sits flat, one steady level about
  12 dB under the voice, never ducked, cut or muted under a spoken line (JC, #321;
  `score_bed`'s default mix); skits and recreations a little softer, about 15 dB under. Beyond
  that there is no known audio equivalent of the grain pass; we are deliberately
  non-prescriptive — use sound-design judgment, what sounds better wins.

### The generative stack budget
- **Degradation comes from generating FROM generated sources.** A generative step
  seeded by real material holds; seeded by another generation, it degrades fast.
- **A-roll consistency law:** to reanimate the consistent a-roll character, STEAL a
  real still from actual footage as the seed (real frame → face-work → reenact →
  lipsync). Only an entirely NEW character can tolerate an all-generated seed chain —
  there is no ground truth to betray.
- **Budget: ~2 generative layers on a-roll before visible degradation; b-roll gets
  at most ONE** (still→video, still→edit, or real-video→generated-variant). Deep
  layering belongs to a-roll, where it maximizes the value of REAL footage.

### The perceived-effort ranking (what reads as production value)
1. Own real/archival footage — **multiple camera angles of the same location/event
   is the coolest** ("this was really filmed").
2. Real camera movement.
3. Found web footage/images from REAL events, matched to the point — high, because a
   human "would have had to" find it and match it.
4. Generated b-roll — LOW ("meh, low effort") UNLESS it passes as real or as a
   handmade artifact, then it re-enters high territory.
The library's embedding search won't surface "random cool clip of me watching
something" — human-FLAGGED footage (curation, not just retrieval) is a needed layer.

### Captured-format realism (the secret lever)
Some formats read authentic BY FORMAT — nobody expects them to be generated: **old/early
iPhone footage, body-cam, security-camera/CCTV, grainy on-the-fly phone video.** The
degraded capture style itself vouches "this predates/escapes AI." Prompt generated
b-roll INTO these formats ("iPhone footage of X happening") to buy realism cheaply.

**Angle grammar follows the format:** multi-angle cuts are only plausible where multiple
cameras are FEASIBLE (studio, office desk setup — "two cameras on one canonical event"
reads real). Single-device formats (on-the-fly phone, body-cam) must NEVER angle-swap —
it breaks the fiction. CCTV sits in both camps (multi-angle plausible AND
authentic-by-format). Angle switches serve realism AND cover repairs (a flub, a pause) —
a repair cut must be indistinguishable from a rhythm cut.
