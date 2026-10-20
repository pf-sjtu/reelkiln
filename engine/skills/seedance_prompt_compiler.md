# Seedance Prompt Compiler — the freehand checklist

**Why this exists:** scripted a-roll goes through `check_script` /
`script_preflight`, which audit every chunk against the full
[`seedance_prompting_guide.md`](seedance_prompting_guide.md) automatically.
**Freehand prompts don't** — `mint_video` b-roll inserts, keyframe hero shots,
cinematic-ad beats, and one-off generations get whatever the prompt-writer
remembers. Session-transcript archaeology (2026-07-18) showed the 1,400-line
guide is almost never read at prompt-writing time; the detail decays. This is
the compact pass you run instead: **~2 minutes, in order, before every
freehand Seedance generation.** Each step links to the authoritative guide
section — open it only when a step flags a problem.

---

## The pass (run in order)

### 1. Inventory — what does the model actually get?

List every asset and give each an explicit role in the prompt: first frame /
last frame / character ref / environment / style / camera ref / motion ref /
audio. Never an unassigned reference — name the index AND the role in the
same sentence (guide §4, §17.7). Use the pipeline's `[Image1]` bracket tokens;
the gateway translates them to Fal's provider syntax (guide top note).

### 2. Archetype — what changes over time?

One sentence: what is different at the end of the clip vs the start, and
which archetype is this (pursuit / duel / impact / journey / atmosphere /
reveal / confrontation / interrogation / negotiation — guide §18.4)? If
nothing changes and it isn't a deliberate atmosphere shot, the prompt isn't
ready. The archetype picks the camera behavior; don't pick a camera move
first.

### 3. Draft — the 6-slot formula

Subject + motion (required), environment, style anchor, ONE primary camera
instruction, audio (guide §2). 60–100 words for a single shot; timecoded
`[00:00-00:04]` segments for anything over ~5s (guide §9). Anchor style to a
specific tradition (film stock / director / colorist tool — guide §16.8),
never a bare "cinematic".

### 4. Engine-rule pass — will it render?

Check the draft against §18.1, the renderer failure modes:

- [ ] Actions are intent + named technique, no joint mechanics
- [ ] No chained destruction sequences — force + direction only
- [ ] ≤ 3 tracked characters; acting pair named per shot
- [ ] Nobody exits and re-enters the same continuous shot
- [ ] No beat references a state change that wasn't shown on camera
- [ ] No reflection shots (visor / mirror / blade / puddle) unless probed
- [ ] Only things that can be seen or heard (no smells, no thoughts)
- [ ] Emotions written as physics ("jaw clenches"), not labels ("angry")

### 5. Cut-grammar pass — do the shots connect?

Only for prompts with cuts (guide §18.2):

- [ ] Every cut changes BOTH shot size and camera mode (double contrast)
- [ ] After any cut back into established space: who is where, facing which
      way, screen direction stated
- [ ] Insert cutaways are sub-second, causally motivated, and name WHOSE
      detail (§18.2) — NB this cut-grammar term is NOT `mint_video --mode
      insert` (that's multi-second under-dialogue b-roll, not a cutaway)

### 6. Language pass — kill the slop

- [ ] No banned words (§7 Antislop Ban List: breathtaking, stunning,
      seamlessly, epic, bare "cinematic"/"fast", …)
- [ ] At least one concrete lighting description (§6 — highest leverage)
- [ ] Negative clause present: "avoid jitter and bent limbs" (+ "avoid
      temporal flicker" for 10s+, "avoid identity drift" for characters — §7)
- [ ] Only ONE element is "fast", if any (§6)
- [ ] Camera movement and subject movement described separately (§5 Rule 3)

### 7. Compliance pass — will it get blocked?

- [ ] No photoreal human face uploads — use the seedream → BytePlus URL
      escape hatch (§13, `[[seedance-flags-human-refs]]`)
- [ ] No age markers on any character, any language (§13: boy, girl, kid,
      young, teen, 男孩, 少年, …) — role + wardrobe + action instead
- [ ] Duration, aspect ratio stated and consistent with the job's other clips

---

## When NOT to use this

- Scripted a-roll chunks → `check_script` already audits them against the
  full guide; don't double-gate.
- Pure typography / kinetic text → Remotion, not Seedance.
- Omni-path generations — `--mode edit` (video-to-video restyle) and the
  Kling-default `--mode reenact` (mint_video engine-selection law) → also
  not Seedance; steps 4–5 are the Seedance renderer's failure modes, and the
  Omni engine has its own.

*⚠️-status rules in §18 are community-asserted and pending validation probes —
if a checklist step forces an awkward rewrite of a beat you care about, probe
the rule (§14 one-variable method) instead of contorting the prompt.*
